-- Migration: neighborhoods and vibe_presets tables
-- Run in Supabase SQL editor (project: dmgxrcmdihgsffvqllms)

CREATE TABLE IF NOT EXISTS neighborhoods (
  id              SERIAL PRIMARY KEY,
  city            TEXT NOT NULL,
  name            TEXT NOT NULL,
  bbox            JSONB,    -- {lat_min, lat_max, lon_min, lon_max} — canonical format
  vibe_short      TEXT,     -- max 6 words, comma-separated descriptors
  vibe_long       TEXT,     -- exactly 2 sentences
  tags            TEXT[],   -- 3-5 values from allowed set
  visitor_type    TEXT,     -- "first-timer" | "returning" | "both"
  attributes      JSONB,    -- {walkability_dining, walkability_tourist_spots,
                            --  green_spaces, skyline_character,
                            --  street_energy, transport_dependency}
  photo_url       TEXT,     -- Unsplash URL (fallback: hotels_cache.main_photo)
  photo_credit    JSONB,    -- {photographer, profile_url} — required Unsplash attribution
  hotel_count     INT DEFAULT 0,
  manual_override BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(city, name)
);

CREATE INDEX IF NOT EXISTS neighborhoods_city ON neighborhoods(city);

CREATE TABLE IF NOT EXISTS vibe_presets (
  id          SERIAL PRIMARY KEY,
  city        TEXT NOT NULL,
  style_label TEXT NOT NULL,   -- "Bright & Minimal", "Warm Art Deco", etc.
  query_used  TEXT NOT NULL,   -- canonical query that found this photo
  photo_url   TEXT NOT NULL,
  caption     TEXT NOT NULL,   -- stored caption — becomes the search query on tap
  hotel_id    TEXT,
  created_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE(city, style_label)
);

CREATE INDEX IF NOT EXISTS vibe_presets_city ON vibe_presets(city);

-- Permissions
GRANT ALL ON TABLE public.neighborhoods TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.neighborhoods_id_seq TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.vibe_presets TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.vibe_presets_id_seq TO anon, authenticated, service_role;
