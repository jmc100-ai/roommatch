-- Migration: add structured neighborhood vibe element payloads
-- Run in Supabase SQL editor (project: dmgxrcmdihgsffvqllms)

ALTER TABLE public.neighborhoods
  ADD COLUMN IF NOT EXISTS vibe_elements JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS vibe_photos JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS vibe_data_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS vibe_last_computed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS neighborhoods_city_computed_idx
  ON public.neighborhoods (city, vibe_last_computed_at DESC);

GRANT ALL ON TABLE public.neighborhoods TO anon, authenticated, service_role;
