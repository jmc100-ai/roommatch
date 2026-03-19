-- RoomMatch vector search schema
-- Run this in Supabase SQL Editor

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ── Indexed cities tracking ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS indexed_cities (
  id            SERIAL PRIMARY KEY,
  city          TEXT NOT NULL UNIQUE,
  country_code  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  hotel_count   INT DEFAULT 0,
  photo_count   INT DEFAULT 0,
  last_error    TEXT,
  started_at    TIMESTAMP,
  completed_at  TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- ── Hotel cache ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hotels_cache (
  hotel_id      TEXT PRIMARY KEY,
  city          TEXT NOT NULL,
  country_code  TEXT,
  name          TEXT,
  address       TEXT,
  star_rating   FLOAT DEFAULT 0,
  guest_rating  FLOAT DEFAULT 0,
  main_photo    TEXT,
  cached_at     TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS hotels_cache_city ON hotels_cache(city);

-- ── Room photo embeddings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS room_embeddings (
  id            BIGSERIAL PRIMARY KEY,
  hotel_id      TEXT NOT NULL,
  city          TEXT NOT NULL,
  country_code  TEXT,
  room_name     TEXT,
  photo_url     TEXT NOT NULL,
  photo_type    TEXT DEFAULT 'unknown',
  caption       TEXT,
  embedding     vector(768),
  star_rating   FLOAT DEFAULT 0,
  guest_rating  FLOAT DEFAULT 0,
  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE(hotel_id, photo_url)
);

CREATE INDEX IF NOT EXISTS re_city       ON room_embeddings(city);
CREATE INDEX IF NOT EXISTS re_hotel      ON room_embeddings(hotel_id);
CREATE INDEX IF NOT EXISTS re_city_type  ON room_embeddings(city, photo_type);
CREATE INDEX IF NOT EXISTS re_embedding_idx
  ON room_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- ── Vector search function ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_rooms(
  query_embedding  vector(768),
  search_city      TEXT,
  match_count      INT DEFAULT 100
)
RETURNS TABLE (
  hotel_id     TEXT,
  city         TEXT,
  room_name    TEXT,
  photo_url    TEXT,
  photo_type   TEXT,
  caption      TEXT,
  star_rating  FLOAT,
  guest_rating FLOAT,
  similarity   FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    re.hotel_id, re.city, re.room_name, re.photo_url,
    re.photo_type, re.caption, re.star_rating, re.guest_rating,
    1 - (re.embedding <=> query_embedding) AS similarity
  FROM room_embeddings re
  WHERE re.city = search_city
    AND re.embedding IS NOT NULL
  ORDER BY re.embedding <=> query_embedding
  LIMIT match_count;
$$;
