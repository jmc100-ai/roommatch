-- Migration: neighbourhood geo fence as polygon (WGS84 ring in JSONB)
-- Run in Supabase SQL editor after add-neighborhoods.sql

ALTER TABLE public.neighborhoods
  ADD COLUMN IF NOT EXISTS polygon JSONB;

COMMENT ON COLUMN public.neighborhoods.polygon IS
  'Optional fence: { "ring": [ { "lat", "lng" }, ... ] } closed ring; when set, POI/hotel/search logic uses point-in-polygon instead of axis-aligned bbox only';
