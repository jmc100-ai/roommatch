-- Migration: add room_type_id to room_embeddings
-- Run in Supabase SQL Editor

ALTER TABLE room_embeddings
  ADD COLUMN IF NOT EXISTS room_type_id TEXT;

CREATE INDEX IF NOT EXISTS re_room_type_id ON room_embeddings(room_type_id)
  WHERE room_type_id IS NOT NULL;

-- Update score_city_photos to return room_type_id
CREATE OR REPLACE FUNCTION score_city_photos(
  query_embedding  vector(768),
  search_city      TEXT
)
RETURNS TABLE (
  hotel_id      TEXT,
  hotel_name    TEXT,
  room_name     TEXT,
  room_type_id  TEXT,
  photo_url     TEXT,
  photo_type    TEXT,
  caption       TEXT,
  star_rating   FLOAT,
  guest_rating  FLOAT,
  similarity    FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    re.hotel_id,
    re.hotel_name,
    re.room_name,
    re.room_type_id,
    re.photo_url,
    re.photo_type,
    re.caption,
    re.star_rating,
    re.guest_rating,
    1 - (re.embedding <=> query_embedding) AS similarity
  FROM room_embeddings re
  WHERE re.city   = search_city
    AND re.embedding IS NOT NULL
  ORDER BY re.embedding <=> query_embedding;
$$;

GRANT EXECUTE ON FUNCTION score_city_photos(vector, text) TO anon, authenticated, service_role;
