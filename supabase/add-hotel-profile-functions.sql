-- ────────────────────────────────────────────────────────────────────────────
-- RPCs for Hotel Vibe v4
--   rebuild_hotel_profile_index_city(p_city)  → aggregation (Phase A·3)
--   score_hotels(q_embedding, p_city, hids)   → hotel-vibe search    (Phase B·1)
--   get_primary_nbhd(p_hotel_id)              → nbhd badge           (Phase B·1)
--
-- Apply AFTER add-hotel-profile-embeddings.sql. Idempotent.
-- ────────────────────────────────────────────────────────────────────────────

-- The set of photo_type values considered "hotel-level amenity" photos.
-- These embeddings flow into hotel_profile_index.amenity_avg. Room photos
-- (bathroom/bedroom/living area/view/other) flow into room_avg.
-- Keep in sync with AMENITY_PHOTO_TYPES in scripts/index-city.js.


-- pgvector 0.8 does not define `vector * real` (scalar multiplication),
-- so we add a tiny SQL helper that scales a vector by a scalar via array cast.
-- Used by the blended-vector calculation below.
CREATE OR REPLACE FUNCTION public.vec_scale(v vector, s double precision)
RETURNS vector
LANGUAGE sql IMMUTABLE
AS $$
  SELECT (
    ARRAY(SELECT val::real * s::real FROM unnest(v::real[]) AS val)
  )::vector;
$$;

GRANT EXECUTE ON FUNCTION public.vec_scale(vector, double precision)
  TO anon, authenticated, service_role;


-- ── rebuild_hotel_profile_index_city ────────────────────────────────────────
-- Aggregates per-hotel averages from room_embeddings + hotels_cache,
-- builds the blended vector with graceful fallbacks when a component is
-- missing (e.g. no description, or no amenity photos yet for a hotel).
CREATE OR REPLACE FUNCTION public.rebuild_hotel_profile_index_city(p_city text)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_count integer;
  v_zero  vector(768);
BEGIN
  SET LOCAL statement_timeout = '300000';

  v_zero := ('[' || repeat('0,', 767) || '0]')::vector(768);

  INSERT INTO hotel_profile_index (
    hotel_id, city, country_code,
    amenity_avg, room_avg, description_embedding, blended,
    amenity_photo_count, room_photo_count, updated_at
  )
  WITH
    amenity AS (
      SELECT
        re.hotel_id, re.city,
        MAX(re.country_code) AS country_code,
        avg(COALESCE(re.feature_embedding, re.embedding))::vector(768) AS amenity_avg,
        COUNT(*) AS n
      FROM room_embeddings re
      WHERE re.city = p_city
        AND re.embedding IS NOT NULL
        AND re.photo_type = ANY (ARRAY['lobby','bar','restaurant','pool','spa','exterior','fitness'])
      GROUP BY re.hotel_id, re.city
    ),
    rooms AS (
      SELECT
        re.hotel_id, re.city,
        MAX(re.country_code) AS country_code,
        avg(COALESCE(re.feature_embedding, re.embedding))::vector(768) AS room_avg,
        COUNT(*) AS n
      FROM room_embeddings re
      WHERE re.city = p_city
        AND re.embedding IS NOT NULL
        AND re.photo_type = ANY (ARRAY['bedroom','bathroom','living area','view','other'])
      GROUP BY re.hotel_id, re.city
    ),
    hotels AS (
      SELECT hc.hotel_id, hc.city, hc.country_code, hc.description_embedding
      FROM hotels_cache hc
      WHERE hc.city = p_city
    ),
    -- Full set of hotels to emit: any hotel in the city that has either
    -- amenity photos, room photos, or a description embedding.
    merged AS (
      SELECT
        COALESCE(a.hotel_id, r.hotel_id, h.hotel_id) AS hotel_id,
        p_city AS city,
        COALESCE(a.country_code, r.country_code, h.country_code) AS country_code,
        a.amenity_avg,
        r.room_avg,
        h.description_embedding,
        COALESCE(a.n, 0) AS amenity_photo_count,
        COALESCE(r.n, 0) AS room_photo_count,
        (CASE WHEN a.amenity_avg           IS NULL THEN 0::double precision ELSE 0.60 END) AS w_amenity,
        (CASE WHEN r.room_avg              IS NULL THEN 0::double precision ELSE 0.25 END) AS w_room,
        (CASE WHEN h.description_embedding IS NULL THEN 0::double precision ELSE 0.15 END) AS w_desc
      FROM hotels h
      FULL OUTER JOIN amenity a ON a.hotel_id = h.hotel_id
      FULL OUTER JOIN rooms   r ON r.hotel_id = h.hotel_id
      WHERE COALESCE(a.amenity_avg, r.room_avg, h.description_embedding) IS NOT NULL
    )
  SELECT
    hotel_id, city, country_code,
    amenity_avg, room_avg, description_embedding,
    -- Blended vector: weighted sum of whichever components exist, re-normalised
    -- so missing components don't collapse the vector toward zero. Weights are
    -- renormalised by (w_amenity + w_room + w_desc) so the relative weighting
    -- stays consistent regardless of which components are present.
    (
      public.vec_scale(COALESCE(amenity_avg, v_zero),           w_amenity / GREATEST(w_amenity + w_room + w_desc, 0.0001))
    + public.vec_scale(COALESCE(room_avg, v_zero),              w_room    / GREATEST(w_amenity + w_room + w_desc, 0.0001))
    + public.vec_scale(COALESCE(description_embedding, v_zero), w_desc    / GREATEST(w_amenity + w_room + w_desc, 0.0001))
    )::vector(768) AS blended,
    amenity_photo_count, room_photo_count,
    NOW() AS updated_at
  FROM merged
  ON CONFLICT (hotel_id) DO UPDATE SET
    city                  = EXCLUDED.city,
    country_code          = COALESCE(EXCLUDED.country_code, hotel_profile_index.country_code),
    amenity_avg           = EXCLUDED.amenity_avg,
    room_avg              = EXCLUDED.room_avg,
    description_embedding = EXCLUDED.description_embedding,
    blended               = EXCLUDED.blended,
    amenity_photo_count   = EXCLUDED.amenity_photo_count,
    room_photo_count      = EXCLUDED.room_photo_count,
    updated_at            = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;


-- ── score_hotels ────────────────────────────────────────────────────────────
-- Cosine similarity against hotel_profile_index.blended. Returns one row per
-- hotel in the city, optionally restricted to a hotel_ids[] list.
CREATE OR REPLACE FUNCTION public.score_hotels(
  query_embedding vector,
  search_city text,
  hotel_ids text[] DEFAULT NULL
)
RETURNS TABLE (hotel_id text, similarity double precision)
LANGUAGE plpgsql
AS $function$
BEGIN
  SET LOCAL ivfflat.probes = 10;
  SET LOCAL statement_timeout = '30000';
  RETURN QUERY
  SELECT
    hpi.hotel_id,
    (1 - (hpi.blended <=> query_embedding))::double precision AS similarity
  FROM hotel_profile_index hpi
  WHERE hpi.city = search_city
    AND hpi.blended IS NOT NULL
    AND (hotel_ids IS NULL OR hpi.hotel_id = ANY(hotel_ids))
  ORDER BY hpi.blended <=> query_embedding;
END;
$function$;


-- ── get_primary_nbhd ────────────────────────────────────────────────────────
-- For a given hotel (already in hotels_cache with lat/lng populated), return
-- the neighbourhood whose bbox contains the hotel AND has the smallest area
-- (i.e. most specific / micro-neighbourhood wins over an umbrella district).
--
-- Returns a single row with the neighbourhood id + name + vibe metadata so a
-- single call can populate the results-card pill.
CREATE OR REPLACE FUNCTION public.get_primary_nbhd(
  p_hotel_id text
)
RETURNS TABLE (
  neighborhood_id int,
  name text,
  vibe_short text,
  bbox jsonb,
  bbox_area double precision,
  attributes jsonb
)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_lat double precision;
  v_lng double precision;
  v_city text;
BEGIN
  SELECT hc.lat, hc.lng, hc.city
  INTO v_lat, v_lng, v_city
  FROM hotels_cache hc
  WHERE hc.hotel_id = p_hotel_id;

  IF v_lat IS NULL OR v_lng IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    n.id,
    n.name,
    n.vibe_short,
    n.bbox,
    n.bbox_area,
    n.attributes
  FROM neighborhoods n
  WHERE n.city = v_city
    AND n.bbox IS NOT NULL
    AND (n.bbox->>'lat_min')::double precision <= v_lat
    AND (n.bbox->>'lat_max')::double precision >= v_lat
    AND (n.bbox->>'lon_min')::double precision <= v_lng
    AND (n.bbox->>'lon_max')::double precision >= v_lng
  ORDER BY n.bbox_area NULLS LAST
  LIMIT 1;
END;
$function$;


-- ── get_primary_nbhds_for_hotels ────────────────────────────────────────────
-- Batch version: one RPC call returns primary nbhd for a list of hotel_ids.
-- Used by /api/vsearch to attach a nbhd to every result hotel without N calls.
-- Note: RETURNS TABLE column names collide with plpgsql locals, so we alias
-- everything inside the CTEs to unique names (hid / nid / nname …) and only
-- expose the canonical column names in the final projection.
CREATE OR REPLACE FUNCTION public.get_primary_nbhds_for_hotels(
  p_hotel_ids text[]
)
RETURNS TABLE (
  hotel_id text,
  neighborhood_id int,
  name text,
  vibe_short text,
  attributes jsonb
)
LANGUAGE plpgsql
AS $function$
BEGIN
  SET LOCAL statement_timeout = '30000';
  RETURN QUERY
  WITH hotel_pts AS (
    SELECT hc.hotel_id AS hid, hc.city, hc.lat, hc.lng
    FROM hotels_cache hc
    WHERE hc.hotel_id = ANY(p_hotel_ids)
      AND hc.lat IS NOT NULL AND hc.lng IS NOT NULL
  ),
  joined AS (
    SELECT
      hp.hid        AS hid,
      n.id          AS nid,
      n.name        AS nname,
      n.vibe_short  AS nvibe,
      n.attributes  AS nattrs,
      n.bbox_area   AS narea,
      ROW_NUMBER() OVER (
        PARTITION BY hp.hid
        ORDER BY n.bbox_area NULLS LAST
      ) AS rn
    FROM hotel_pts hp
    JOIN neighborhoods n
      ON  n.city = hp.city
      AND n.bbox IS NOT NULL
      AND (n.bbox->>'lat_min')::double precision <= hp.lat
      AND (n.bbox->>'lat_max')::double precision >= hp.lat
      AND (n.bbox->>'lon_min')::double precision <= hp.lng
      AND (n.bbox->>'lon_max')::double precision >= hp.lng
  )
  SELECT j.hid, j.nid, j.nname, j.nvibe, j.nattrs
  FROM joined j
  WHERE j.rn = 1;
END;
$function$;


-- ── Permissions ─────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.rebuild_hotel_profile_index_city(text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.score_hotels(vector, text, text[])
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_primary_nbhd(text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_primary_nbhds_for_hotels(text[])
  TO anon, authenticated, service_role;
