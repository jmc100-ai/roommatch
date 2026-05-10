-- ─────────────────────────────────────────────────────────────────────────────
-- add-photo-type-counts.sql
-- Adds photo_type_counts JSONB column to v2_room_types_index so Phase A scoring
-- in scripts/search-v2.js can apply intent-type filtering (e.g. only count
-- bathroom photos for "double sinks" queries) for ALL hotels in the city, not
-- just the top 250 that load actual photos.
--
-- Shape: { "bathroom": 3, "bedroom": 5, "view": 2, "living": 1, "other": 4 }
-- Source: v2_room_inventory (the canonical location of photo_type per photo).
-- May differ slightly from photo_count (which is sourced from v2_room_feature_facts —
-- only photos with at least one extracted fact). For ranking we want the inventory
-- counts because that matches what Phase B's photo loop sees today.
--
-- This migration:
--   1. Adds the column (default '{}'::jsonb so existing reads don't break).
--   2. Replaces rebuild_v2_room_types_index_city to populate it.
--
-- Run order:
--   1. Apply this migration in Supabase SQL editor (or via execute_sql MCP).
--   2. Backfill Mexico City: SELECT rebuild_v2_room_types_index_city('Mexico City');
--   3. Repeat for any other V2 city as needed.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE v2_room_types_index
  ADD COLUMN IF NOT EXISTS photo_type_counts JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION rebuild_v2_room_types_index_city(p_city TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  n              INT;
  high_ambiguity TEXT[] := ARRAY[
    'double_sinks','soaking_tub','walk_in_shower','rainfall_shower',
    'in_room_hot_tub','fireplace','private_plunge_pool'
  ];
BEGIN
  SET LOCAL statement_timeout = '300000';

  DELETE FROM v2_room_types_index WHERE city = p_city;

  WITH
  -- Per (hotel, room, fact): count distinct yes/no photos.
  room_fact_counts AS (
    SELECT
      hotel_id, room_name, fact_key,
      MAX(country_code)                                        AS country_code,
      COUNT(DISTINCT photo_url) FILTER (WHERE fact_value = 1)  AS yes_count,
      COUNT(DISTINCT photo_url) FILTER (WHERE fact_value = 0)  AS no_count
    FROM v2_room_feature_facts
    WHERE city = p_city AND fact_key IS NOT NULL AND photo_url IS NOT NULL
    GROUP BY hotel_id, room_name, fact_key
  ),
  -- Per (hotel, fact): hotel-level yes count for high-ambiguity facts only.
  hotel_fact_counts AS (
    SELECT hotel_id, fact_key,
           COUNT(DISTINCT photo_url) FILTER (WHERE fact_value = 1) AS hotel_yes
    FROM v2_room_feature_facts
    WHERE city = p_city AND fact_key = ANY(high_ambiguity)
    GROUP BY hotel_id, fact_key
  ),
  confirmed AS (
    SELECT
      rfc.hotel_id, rfc.room_name, rfc.country_code, rfc.fact_key,
      CASE
        WHEN rfc.fact_key = ANY(high_ambiguity) AND rfc.yes_count >= 2
          THEN true
        WHEN rfc.fact_key = ANY(high_ambiguity)
             AND rfc.yes_count >= 1
             AND COALESCE(hfc.hotel_yes, 0) >= 2
          THEN true
        WHEN rfc.fact_key = ANY(high_ambiguity) AND rfc.no_count >= 2
          THEN false
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
  room_facts AS (
    SELECT
      hotel_id, room_name,
      MAX(country_code) AS country_code,
      jsonb_object_agg(fact_key, confirmed_val)
        FILTER (WHERE confirmed_val IS NOT NULL) AS facts
    FROM confirmed
    GROUP BY hotel_id, room_name
  ),
  -- Per (hotel, room): total distinct photos (sourced from facts table — same as before).
  room_photos AS (
    SELECT hotel_id, room_name,
           COUNT(DISTINCT photo_url) AS photo_count
    FROM v2_room_feature_facts
    WHERE city = p_city
    GROUP BY hotel_id, room_name
  ),
  -- Per (hotel, room, photo_type): inventory-level photo counts. Sourced from
  -- v2_room_inventory because that's where photo_type lives. For rooms with a
  -- mix of types this lets search-v2.js compute the intent-type-filtered photo
  -- subset (e.g. "bathroom photos only") at scoring time without loading rows.
  room_photo_types AS (
    SELECT hotel_id, room_name,
           jsonb_object_agg(photo_type, cnt) AS photo_type_counts
    FROM (
      SELECT hotel_id, room_name,
             COALESCE(NULLIF(LOWER(TRIM(photo_type)), ''), 'other') AS photo_type,
             COUNT(DISTINCT photo_url) AS cnt
      FROM v2_room_inventory
      WHERE city = p_city AND room_name IS NOT NULL
      GROUP BY hotel_id, room_name, COALESCE(NULLIF(LOWER(TRIM(photo_type)), ''), 'other')
    ) sub
    GROUP BY hotel_id, room_name
  )
  INSERT INTO v2_room_types_index
    (hotel_id, city, country_code, room_name, facts, photo_count, photo_type_counts, updated_at)
  SELECT
    rf.hotel_id, p_city, rf.country_code, rf.room_name,
    COALESCE(rf.facts, '{}'::jsonb),
    COALESCE(rp.photo_count, 0),
    COALESCE(rpt.photo_type_counts, '{}'::jsonb),
    NOW()
  FROM room_facts rf
  LEFT JOIN room_photos      rp  USING (hotel_id, room_name)
  LEFT JOIN room_photo_types rpt USING (hotel_id, room_name)
  ON CONFLICT (hotel_id, room_name) DO UPDATE SET
    facts             = EXCLUDED.facts,
    photo_count       = EXCLUDED.photo_count,
    photo_type_counts = EXCLUDED.photo_type_counts,
    updated_at        = NOW();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION rebuild_v2_room_types_index_city(text) TO service_role, anon, authenticated;
