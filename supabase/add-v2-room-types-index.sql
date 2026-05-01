-- v2_room_types_index: pre-aggregated per-room confirmed facts for efficient search scoring.
-- Mirrors V1's room_types_index but for the V2 fact-based architecture.
-- Rebuilt after each city index via rebuild_v2_room_types_index_city().

CREATE TABLE IF NOT EXISTS v2_room_types_index (
  id          BIGSERIAL PRIMARY KEY,
  hotel_id    TEXT        NOT NULL,
  city        TEXT        NOT NULL,
  country_code TEXT,
  room_name   TEXT        NOT NULL,
  -- Confirmed boolean facts per room type: {fact_key: true/false}
  -- NULL entries are excluded; only confirmed true/false values stored.
  facts       JSONB       NOT NULL DEFAULT '{}',
  photo_count INT         NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(hotel_id, room_name)
);

CREATE INDEX IF NOT EXISTS v2_rti_city      ON v2_room_types_index(city);
CREATE INDEX IF NOT EXISTS v2_rti_facts_gin ON v2_room_types_index USING gin(facts);

GRANT ALL   ON TABLE v2_room_types_index TO service_role;
GRANT SELECT ON TABLE v2_room_types_index TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE v2_room_types_index_id_seq TO service_role;

-- Additional indices on v2_room_feature_facts for Phase B queries at 3600-hotel scale
CREATE INDEX IF NOT EXISTS v2_rff_city_hotel
  ON v2_room_feature_facts(city, hotel_id);

CREATE INDEX IF NOT EXISTS v2_rff_hotel_fact_val
  ON v2_room_feature_facts(hotel_id, fact_key, fact_value)
  WHERE fact_value = 1;

-- ── rebuild_v2_room_types_index_city ─────────────────────────────────────────
-- Aggregates v2_room_feature_facts → v2_room_types_index for one city.
-- Confirmation rules (mirrors V1 rebuild_room_types_index_city):
--   HIGH_AMBIGUITY facts (double_sinks, soaking_tub, walk_in_shower, etc.):
--     confirmed=true  IF room yes_count >= 2
--                  OR (room yes_count >= 1 AND hotel-level yes_count >= 2)
--     confirmed=false IF no_count >= 2
--   All other facts:
--     confirmed=true  IF yes_count >= 1 AND no_count < 2
--     confirmed=false IF no_count >= 2
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION rebuild_v2_room_types_index_city(p_city TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  n                   INT;
  high_ambiguity      TEXT[] := ARRAY[
    'double_sinks','soaking_tub','walk_in_shower','rainfall_shower',
    'in_room_hot_tub','fireplace','private_plunge_pool'
  ];
BEGIN
  SET LOCAL statement_timeout = '300000'; -- 5 min for large cities

  DELETE FROM v2_room_types_index WHERE city = p_city;

  WITH
  -- Per (hotel, room, fact): count distinct yes/no photos
  room_fact_counts AS (
    SELECT
      hotel_id, room_name, fact_key,
      MAX(country_code)                                             AS country_code,
      COUNT(DISTINCT photo_url) FILTER (WHERE fact_value = 1)      AS yes_count,
      COUNT(DISTINCT photo_url) FILTER (WHERE fact_value = 0)      AS no_count
    FROM v2_room_feature_facts
    WHERE city = p_city AND fact_key IS NOT NULL AND photo_url IS NOT NULL
    GROUP BY hotel_id, room_name, fact_key
  ),
  -- Per (hotel, fact): hotel-level yes count for high-ambiguity facts only
  hotel_fact_counts AS (
    SELECT hotel_id, fact_key,
           COUNT(DISTINCT photo_url) FILTER (WHERE fact_value = 1) AS hotel_yes
    FROM v2_room_feature_facts
    WHERE city = p_city AND fact_key = ANY(high_ambiguity)
    GROUP BY hotel_id, fact_key
  ),
  -- Apply confirmation rules per (hotel, room, fact)
  confirmed AS (
    SELECT
      rfc.hotel_id,
      rfc.room_name,
      rfc.country_code,
      rfc.fact_key,
      CASE
        -- High-ambiguity: need >=2 room-level yes, OR >=1 room + >=2 hotel-level
        WHEN rfc.fact_key = ANY(high_ambiguity) AND rfc.yes_count >= 2
          THEN true
        WHEN rfc.fact_key = ANY(high_ambiguity)
             AND rfc.yes_count >= 1
             AND COALESCE(hfc.hotel_yes, 0) >= 2
          THEN true
        WHEN rfc.fact_key = ANY(high_ambiguity) AND rfc.no_count >= 2
          THEN false
        -- Standard facts: 1 yes without being dominated by no
        WHEN rfc.fact_key != ALL(high_ambiguity) AND rfc.yes_count >= 1 AND rfc.no_count < 2
          THEN true
        WHEN rfc.fact_key != ALL(high_ambiguity) AND rfc.no_count >= 2
          THEN false
        ELSE NULL
      END AS confirmed_val
    FROM room_fact_counts rfc
    LEFT JOIN hotel_fact_counts hfc
      ON rfc.hotel_id = hfc.hotel_id AND rfc.fact_key = hfc.fact_key
  ),
  -- Aggregate per (hotel, room): JSONB facts, excluding NULLs
  room_facts AS (
    SELECT
      hotel_id,
      room_name,
      MAX(country_code) AS country_code,
      jsonb_object_agg(fact_key, confirmed_val)
        FILTER (WHERE confirmed_val IS NOT NULL) AS facts
    FROM confirmed
    GROUP BY hotel_id, room_name
  ),
  -- Per (hotel, room): total distinct photos
  room_photos AS (
    SELECT hotel_id, room_name,
           COUNT(DISTINCT photo_url) AS photo_count
    FROM v2_room_feature_facts
    WHERE city = p_city
    GROUP BY hotel_id, room_name
  )
  INSERT INTO v2_room_types_index
    (hotel_id, city, country_code, room_name, facts, photo_count, updated_at)
  SELECT
    rf.hotel_id, p_city, rf.country_code, rf.room_name,
    COALESCE(rf.facts, '{}'::jsonb),
    COALESCE(rp.photo_count, 0),
    NOW()
  FROM room_facts rf
  LEFT JOIN room_photos rp USING (hotel_id, room_name)
  ON CONFLICT (hotel_id, room_name) DO UPDATE SET
    facts       = EXCLUDED.facts,
    photo_count = EXCLUDED.photo_count,
    updated_at  = NOW();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION rebuild_v2_room_types_index_city(text) TO service_role, anon, authenticated;
