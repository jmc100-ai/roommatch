-- ────────────────────────────────────────────────────────────────────────────
-- Migration: hotel-level embeddings for the BOOP Vibe v4 "Hotel Vibe" score
-- ────────────────────────────────────────────────────────────────────────────
-- Adds:
--   1) hotels_cache.description + description_embedding (one-per-hotel prose vec)
--   2) hotel_profile_index: aggregated per-hotel amenity_avg / room_avg / blended
--      embeddings used by score_hotels RPC at search time.
--   3) neighborhoods.bbox_area generated column + index — used by
--      get_primary_nbhd() to pick the *smallest* matching bbox for overlapping
--      neighbourhoods.
--
-- Apply via Supabase SQL editor (project: dmgxrcmdihgsffvqllms).
-- Idempotent: re-running is safe.
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1. hotels_cache description + vector ────────────────────────────────────
ALTER TABLE public.hotels_cache
  ADD COLUMN IF NOT EXISTS description            TEXT,
  ADD COLUMN IF NOT EXISTS description_embedding  vector(768);

COMMENT ON COLUMN public.hotels_cache.description IS
  'LiteAPI hotel description text (paragraph-level prose). Captured during indexing.';
COMMENT ON COLUMN public.hotels_cache.description_embedding IS
  'gemini-embedding-001 vector (768d) of description — blended into hotel_profile_index.blended.';


-- ── 2. hotel_profile_index ──────────────────────────────────────────────────
-- One row per (hotel_id, city). Rebuilt by rebuild_hotel_profile_index_city().
CREATE TABLE IF NOT EXISTS public.hotel_profile_index (
  hotel_id              TEXT PRIMARY KEY,
  city                  TEXT NOT NULL,
  country_code          TEXT,
  amenity_avg           vector(768),   -- avg of lobby/bar/pool/restaurant/spa/exterior/fitness
  room_avg              vector(768),   -- avg of bedroom/bathroom/living/view photos
  description_embedding vector(768),   -- copy of hotels_cache.description_embedding at build time
  blended               vector(768),   -- 0.60*amenity + 0.25*room + 0.15*description (fallbacks inside)
  amenity_photo_count   INT DEFAULT 0,
  room_photo_count      INT DEFAULT 0,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS hpi_city ON public.hotel_profile_index(city);

-- ivfflat on the blended vector — this is what score_hotels() searches against.
-- Using lists=50 to match the existing room_embeddings ivfflat config.
CREATE INDEX IF NOT EXISTS hpi_blended_idx
  ON public.hotel_profile_index
  USING ivfflat (blended vector_cosine_ops)
  WITH (lists = 50);

GRANT ALL ON TABLE public.hotel_profile_index TO anon, authenticated, service_role;

COMMENT ON TABLE public.hotel_profile_index IS
  'Aggregated hotel-level embeddings (amenity photos + description + room avg) used '
  'by score_hotels() to drive the "Hotel Vibe %" score. Rebuilt by '
  'rebuild_hotel_profile_index_city(city) after indexing.';


-- ── 3. neighborhoods.bbox_area — used for smallest-bbox primary match ───────
-- bbox is stored as JSONB: {lat_min, lat_max, lon_min, lon_max}.
-- Area is (lat_max - lat_min) * (lon_max - lon_min) — adequate for relative
-- "smallest containing bbox" decisions without needing PostGIS.
ALTER TABLE public.neighborhoods
  ADD COLUMN IF NOT EXISTS bbox_area DOUBLE PRECISION
  GENERATED ALWAYS AS (
    CASE
      WHEN bbox IS NULL THEN NULL
      WHEN bbox->>'lat_max' IS NULL OR bbox->>'lat_min' IS NULL
        OR bbox->>'lon_max' IS NULL OR bbox->>'lon_min' IS NULL THEN NULL
      ELSE
        ((bbox->>'lat_max')::double precision - (bbox->>'lat_min')::double precision)
        *
        ((bbox->>'lon_max')::double precision - (bbox->>'lon_min')::double precision)
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS neighborhoods_city_bbox_area
  ON public.neighborhoods(city, bbox_area);

COMMENT ON COLUMN public.neighborhoods.bbox_area IS
  'Generated — (lat_max - lat_min) * (lon_max - lon_min). Used by get_primary_nbhd() '
  'to pick the smallest (most specific) neighbourhood bbox containing a hotel.';


-- ── 4. work_desk feature flag (regex backfill on existing feature_summary) ──
-- Captions already include "DESK: (no desk / small desk / large desk)" so the
-- signal is there; we just need to parse it into the feature_flags jsonb.
-- This is idempotent: re-running overwrites the work_desk bit.
UPDATE public.room_embeddings
SET feature_flags = COALESCE(feature_flags, '{}'::jsonb) ||
    jsonb_build_object(
      'work_desk',
      CASE WHEN feature_summary ~* '\mDESK:\s*(?:small|large) desk' THEN true ELSE NULL END
    )
WHERE feature_summary IS NOT NULL
  AND feature_summary ~* '\mDESK:\s*(?:small|large) desk'
  AND NOT (feature_flags ? 'work_desk');

-- Strip any future re-runs that overwrote with null (jsonb_build_object preserves nulls).
UPDATE public.room_embeddings
SET feature_flags = feature_flags - 'work_desk'
WHERE feature_flags ? 'work_desk'
  AND (feature_flags->>'work_desk') IS NULL;


-- ── 5. Verify ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  has_hpi BOOLEAN;
  has_desc BOOLEAN;
  has_bbox_area BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='hotel_profile_index') INTO has_hpi;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='hotels_cache' AND column_name='description_embedding') INTO has_desc;
  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='neighborhoods' AND column_name='bbox_area') INTO has_bbox_area;
  RAISE NOTICE 'Migration check — hotel_profile_index:% hotels_cache.description_embedding:% neighborhoods.bbox_area:%',
    has_hpi, has_desc, has_bbox_area;
END$$;
