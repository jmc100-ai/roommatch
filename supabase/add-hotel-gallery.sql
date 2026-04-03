-- Hotel gallery photos (Option B) — captured from LiteAPI /data/hotel at index time
-- Stores up to 5 hotel-level photos: exterior, lobby, bar, pool, restaurant etc.
-- Populated by index-city.js and backfill-latlng.js; used by vsearch for hero strip.

ALTER TABLE hotels_cache ADD COLUMN IF NOT EXISTS hotel_photos JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN hotels_cache.hotel_photos IS
  'Up to 5 hotel-level photos (exterior, lobby, bar, etc.) as JSON array of URL strings. '
  'Captured from LiteAPI /data/hotel at index time. Empty array until backfill runs.';

-- Index for checking which hotels still need gallery backfill
CREATE INDEX IF NOT EXISTS hotels_cache_no_gallery
  ON hotels_cache (city)
  WHERE hotel_photos = '[]'::jsonb OR hotel_photos IS NULL;
