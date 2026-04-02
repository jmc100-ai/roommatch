-- Migration: add lat/lng to hotels_cache for bounding-box geo filtering
-- Run in Supabase SQL editor (project: dmgxrcmdihgsffvqllms)

ALTER TABLE hotels_cache ADD COLUMN IF NOT EXISTS lat FLOAT;
ALTER TABLE hotels_cache ADD COLUMN IF NOT EXISTS lng FLOAT;

-- Composite index for bbox queries: WHERE city=... AND lat BETWEEN ... AND lng BETWEEN ...
CREATE INDEX IF NOT EXISTS hotels_cache_coords ON hotels_cache(city, lat, lng);
