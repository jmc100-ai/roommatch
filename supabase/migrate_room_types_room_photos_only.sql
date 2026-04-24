-- room_types_index is for room-level vector search only.
-- Exclude hotel-level amenity embeddings (lobby/bar/… with NULL room_name) and
-- any row missing a real room name so refresh_room_types_index_entry never
-- violates room_types_index.room_name NOT NULL.

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
    WHERE city = p_city
      AND embedding IS NOT NULL
      AND room_name IS NOT NULL AND btrim(room_name) <> ''
      AND photo_type = ANY (ARRAY['bedroom','bathroom','living area','view','other'])
    GROUP BY hotel_id, city, room_name, photo_type
  ),
  group_sizes AS (
    SELECT hotel_id, room_name, photo_type, city, COUNT(*) AS group_size
    FROM room_embeddings
    WHERE city = p_city
      AND room_name IS NOT NULL AND btrim(room_name) <> ''
      AND photo_type = ANY (ARRAY['bedroom','bathroom','living area','view','other'])
    GROUP BY hotel_id, room_name, photo_type, city
  ),
  flag_counts AS (
    SELECT re.hotel_id, re.room_name, re.photo_type, re.city, k, COUNT(*) AS flag_count
    FROM room_embeddings re
    CROSS JOIN LATERAL jsonb_object_keys(COALESCE(re.feature_flags, '{}')) AS k
    WHERE re.city = p_city
      AND re.room_name IS NOT NULL AND btrim(re.room_name) <> ''
      AND re.photo_type = ANY (ARRAY['bedroom','bathroom','living area','view','other'])
      AND re.feature_flags IS NOT NULL
      AND re.feature_flags != '{}'
    GROUP BY re.hotel_id, re.room_name, re.photo_type, re.city, k
  ),
  hotel_flag_totals AS (
    SELECT hotel_id, city, k, SUM(flag_count) AS hotel_total
    FROM flag_counts
    GROUP BY hotel_id, city, k
  ),
  confirmed_keys AS (
    SELECT fc.hotel_id, fc.room_name, fc.photo_type, fc.city, fc.k
    FROM flag_counts fc
    JOIN group_sizes gs USING (hotel_id, room_name, photo_type, city)
    WHERE (
      fc.k = ANY(ARRAY['double_sinks', 'walk_in_shower', 'rainfall_shower'])
      AND fc.flag_count >= 2
    ) OR (
      fc.k != ALL(ARRAY['double_sinks', 'walk_in_shower', 'rainfall_shower'])
      AND (fc.flag_count >= 2 OR gs.group_size = 1)
    )

    UNION

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


CREATE OR REPLACE FUNCTION public.refresh_room_types_index_entry(
  p_hotel_id text,
  p_city text,
  p_country_code text DEFAULT NULL::text
)
RETURNS void
LANGUAGE sql
AS $function$
  INSERT INTO room_types_index (hotel_id, city, country_code, room_name, photo_type, embedding)
  SELECT
    hotel_id,
    city,
    MAX(country_code) AS country_code,
    room_name,
    photo_type,
    avg(COALESCE(feature_embedding, embedding))::vector(768) AS embedding
  FROM room_embeddings
  WHERE hotel_id = p_hotel_id
    AND city = p_city
    AND embedding IS NOT NULL
    AND room_name IS NOT NULL AND btrim(room_name) <> ''
    AND photo_type = ANY (ARRAY['bedroom','bathroom','living area','view','other'])
  GROUP BY hotel_id, city, room_name, photo_type
  ON CONFLICT (hotel_id, room_name, photo_type) DO UPDATE SET
    embedding    = EXCLUDED.embedding,
    city         = EXCLUDED.city,
    country_code = COALESCE(EXCLUDED.country_code, room_types_index.country_code),
    updated_at   = NOW();
$function$;
