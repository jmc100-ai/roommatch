-- Boop wizard nbhdScene tiles — per-city photos:
--   buzz_central (Historic & energetic), scenic_open (Central & connected)
-- Gemini + Places/Unsplash picks are computed once per city and reused on every visit.
-- Regenerate during city rollout refresh or via GET /api/boop-nbhd-scene-images?refresh=1 + INDEX_SECRET.

CREATE TABLE IF NOT EXISTS boop_nbhd_scene_images (
  city            TEXT PRIMARY KEY,
  images          JSONB NOT NULL,   -- { buzz_central, scenic_open } URLs
  meta            JSONB,            -- per-slot source / geminiScore / placeName
  prompt_version  TEXT NOT NULL DEFAULT 'v1',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS boop_nbhd_scene_images_generated_at ON boop_nbhd_scene_images (generated_at);

GRANT SELECT ON TABLE public.boop_nbhd_scene_images TO anon, authenticated;
GRANT ALL ON TABLE public.boop_nbhd_scene_images TO service_role;
