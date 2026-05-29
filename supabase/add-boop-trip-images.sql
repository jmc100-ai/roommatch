-- Boop wizard "Have you been to this city before?" — per-city trip card photos.
-- Gemini + Places/Unsplash picks are computed once per city and reused on every visit.
-- Regenerate during city rollout refresh or via GET /api/boop-trip-images?refresh=1 + INDEX_SECRET.

CREATE TABLE IF NOT EXISTS boop_trip_images (
  city            TEXT PRIMARY KEY,
  images          JSONB NOT NULL,   -- { first, repeat, expert } URLs
  meta            JSONB,            -- per-slot source / geminiScore / placeName
  prompt_version  TEXT NOT NULL DEFAULT 'v1',
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS boop_trip_images_generated_at ON boop_trip_images (generated_at);

GRANT SELECT ON TABLE public.boop_trip_images TO anon, authenticated;
GRANT ALL ON TABLE public.boop_trip_images TO service_role;
