-- Updated SQL functions for room_types_index management.
-- Apply via Supabase SQL Editor.

-- ── rebuild_room_types_index_city ──────────────────────────────────────────────
-- Rebuilds the room_types_index for a given city using multi-photo confirmation
-- to prevent single-photo Gemini hallucinations from polluting feature flags.
--
-- Confirmation rules per flag:
--   double_sinks, walk_in_shower, rainfall_shower:
--     Primary:  room type has >=2 photos with the flag
--     Fallback: hotel has >=2 total photos with the flag across ANY room types
--               (LiteAPI often indexes 1 bathroom photo per room type; 2 independent
--                Gemini confirmations across different rooms = reliable signal)
--   all other flags: >=2 OR single-photo group (no cross-validation possible)
--
CREATE OR REPLACE FUNCTION public.rebuild_room_types_index_city(p_city text)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_count integer;
BEGIN
  SET LOCAL statement_timeout = '300000';

  INSERT INTO room_types_index (hotel_id, city, country_code, room_name, photo_type, embedding, features)
  WITH groups AS (
    SELECT
      hotel_id, city,
      MAX(country_code) AS country_code,
      room_name, photo_type,
      avg(COALESCE(feature_embedding, embedding))::vector(768) AS embedding
    FROM room_embeddings
    WHERE city = p_city AND embedding IS NOT NULL
    GROUP BY hotel_id, city, room_name, photo_type
  ),
  group_sizes AS (
    SELECT hotel_id, room_name, photo_type, city, COUNT(*) AS group_size
    FROM room_embeddings
    WHERE city = p_city
    GROUP BY hotel_id, room_name, photo_type, city
  ),
  flag_counts AS (
    SELECT re.hotel_id, re.room_name, re.photo_type, re.city, k, COUNT(*) AS flag_count
    FROM room_embeddings re
    CROSS JOIN LATERAL jsonb_object_keys(COALESCE(re.feature_flags, '{}')) AS k
    WHERE re.city = p_city
      AND re.feature_flags IS NOT NULL
      AND re.feature_flags != '{}'
    GROUP BY re.hotel_id, re.room_name, re.photo_type, re.city, k
  ),
  -- Total photos per hotel per flag (across ALL room types) — used for hotel-level fallback.
  hotel_flag_totals AS (
    SELECT hotel_id, city, k, SUM(flag_count) AS hotel_total
    FROM flag_counts
    GROUP BY hotel_id, city, k
  ),
  confirmed_keys AS (
    -- Primary rule: room type has >=2 photos with this flag
    SELECT fc.hotel_id, fc.room_name, fc.photo_type, fc.city, fc.k
    FROM flag_counts fc
    JOIN group_sizes gs USING (hotel_id, room_name, photo_type, city)
    WHERE (
      -- High hallucination-risk flags: always require >=2 photos per room type.
      fc.k = ANY(ARRAY['double_sinks', 'walk_in_shower', 'rainfall_shower'])
      AND fc.flag_count >= 2
    ) OR (
      -- All other flags: >=2 OR single-photo group (no cross-validation possible).
      fc.k != ALL(ARRAY['double_sinks', 'walk_in_shower', 'rainfall_shower'])
      AND (fc.flag_count >= 2 OR gs.group_size = 1)
    )

    UNION

    -- Hotel-level fallback for high-risk flags: hotel has >=3 total photos with
    -- this flag across any room types (LiteAPI often indexes only 1 bathroom photo
    -- per room type at luxury hotels; 3 independent Gemini matches = reliable).
    SELECT fc.hotel_id, fc.room_name, fc.photo_type, fc.city, fc.k
    FROM flag_counts fc
    JOIN hotel_flag_totals hft
      ON hft.hotel_id = fc.hotel_id AND hft.city = fc.city AND hft.k = fc.k
    WHERE fc.k = ANY(ARRAY['double_sinks', 'walk_in_shower', 'rainfall_shower'])
      AND fc.flag_count >= 1
      AND hft.hotel_total >= 2
  ),
  feature_agg AS (
    SELECT hotel_id, room_name, photo_type, city,
      jsonb_object_agg(k, true) AS features
    FROM confirmed_keys
    GROUP BY hotel_id, room_name, photo_type, city
  )
  SELECT
    g.hotel_id, g.city, g.country_code, g.room_name, g.photo_type, g.embedding,
    COALESCE(fa.features, '{}') AS features
  FROM groups g
  LEFT JOIN feature_agg fa
    ON fa.hotel_id = g.hotel_id AND fa.room_name = g.room_name
    AND fa.photo_type = g.photo_type AND fa.city = g.city
  ON CONFLICT (hotel_id, room_name, photo_type) DO UPDATE SET
    embedding    = EXCLUDED.embedding,
    city         = EXCLUDED.city,
    country_code = COALESCE(EXCLUDED.country_code, room_types_index.country_code),
    features     = EXCLUDED.features,
    updated_at   = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;


-- ── score_room_types ──────────────────────────────────────────────────────────
-- Vector similarity search over room_types_index with optional feature pre-filter.
-- required_features: jsonb of {flag: true} pairs — only rooms with ALL flags are returned.
-- Example: {"double_sinks": true, "soaking_tub": true}
-- IMPORTANT: do not cap the raw scan below the indexed city size, or broad semantic
-- queries (e.g. "Art Deco style room" in Paris) will silently return only a subset
-- of hotels. PostgREST row caps are handled separately via pgrst.db_max_rows.
--
CREATE OR REPLACE FUNCTION public.score_room_types(
  query_embedding vector,
  search_city text,
  required_features jsonb DEFAULT NULL,
  hotel_ids text[] DEFAULT NULL
)
RETURNS TABLE(hotel_id text, room_name text, similarity double precision)
LANGUAGE plpgsql
AS $function$
BEGIN
  SET LOCAL ivfflat.probes = 10;
  RETURN QUERY
  WITH raw AS (
    SELECT
      rti.hotel_id,
      rti.room_name,
      1 - (rti.embedding <=> query_embedding) AS sim
    FROM room_types_index rti
    WHERE rti.city = search_city
      AND rti.embedding IS NOT NULL
      AND (hotel_ids IS NULL OR rti.hotel_id = ANY(hotel_ids))
      AND (required_features IS NULL OR required_features = '{}' OR rti.features @> required_features)
    ORDER BY rti.embedding <=> query_embedding
  )
  SELECT r.hotel_id, r.room_name, MAX(r.sim) AS similarity
  FROM raw r
  GROUP BY r.hotel_id, r.room_name
  ORDER BY MAX(r.sim) DESC;
END;
$function$;


-- ── fetch_hotel_photos ────────────────────────────────────────────────────────
-- Returns up to max_per_hotel photos per hotel, ordered by room_name/photo_type/id.
-- SET LOCAL statement_timeout overrides the 8s authenticator role limit.
--
CREATE OR REPLACE FUNCTION public.fetch_hotel_photos(
  hotel_ids text[],
  max_per_hotel integer DEFAULT 40
)
RETURNS TABLE(
  hotel_id text, hotel_name text, room_name text, room_type_id text,
  photo_url text, photo_type text, star_rating double precision, guest_rating double precision
)
LANGUAGE plpgsql
AS $function$
BEGIN
  SET LOCAL statement_timeout = '30000';
  RETURN QUERY
  WITH ranked AS (
    SELECT
      re.hotel_id       AS r_hotel_id,
      re.hotel_name     AS r_hotel_name,
      re.room_name      AS r_room_name,
      re.room_type_id   AS r_room_type_id,
      re.photo_url      AS r_photo_url,
      re.photo_type     AS r_photo_type,
      re.star_rating    AS r_star_rating,
      re.guest_rating   AS r_guest_rating,
      ROW_NUMBER() OVER (
        PARTITION BY re.hotel_id
        ORDER BY re.room_name, re.photo_type, re.id
      ) AS rn
    FROM room_embeddings re
    WHERE re.hotel_id = ANY(hotel_ids)
      AND re.embedding IS NOT NULL
  )
  SELECT r_hotel_id, r_hotel_name, r_room_name, r_room_type_id, r_photo_url, r_photo_type, r_star_rating, r_guest_rating
  FROM ranked
  WHERE rn <= max_per_hotel;
END;
$function$;
