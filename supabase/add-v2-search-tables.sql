CREATE TABLE IF NOT EXISTS v2_indexed_cities (
  city TEXT PRIMARY KEY,
  country_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  hotel_count INT NOT NULL DEFAULT 0,
  photo_count INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS v2_hotels_cache (
  hotel_id TEXT PRIMARY KEY,
  city TEXT NOT NULL,
  country_code TEXT,
  name TEXT,
  address TEXT,
  star_rating REAL,
  guest_rating REAL,
  main_photo TEXT,
  hotel_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS v2_hotels_cache_city_idx ON v2_hotels_cache (city);
CREATE INDEX IF NOT EXISTS v2_hotels_cache_city_coords_idx ON v2_hotels_cache (city, lat, lng);

CREATE TABLE IF NOT EXISTS v2_room_inventory (
  id BIGSERIAL PRIMARY KEY,
  hotel_id TEXT NOT NULL,
  city TEXT NOT NULL,
  country_code TEXT,
  room_name TEXT,
  room_type_id TEXT,
  photo_url TEXT NOT NULL,
  photo_type TEXT,
  caption TEXT,
  feature_summary TEXT,
  source TEXT NOT NULL DEFAULT 'vision',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, photo_url)
);
CREATE INDEX IF NOT EXISTS v2_room_inventory_city_hotel_idx ON v2_room_inventory (city, hotel_id);
CREATE INDEX IF NOT EXISTS v2_room_inventory_city_roomtype_idx ON v2_room_inventory (city, room_type_id);

CREATE TABLE IF NOT EXISTS v2_room_feature_facts (
  id BIGSERIAL PRIMARY KEY,
  hotel_id TEXT NOT NULL,
  room_type_id TEXT,
  city TEXT NOT NULL,
  country_code TEXT,
  room_name TEXT,
  photo_url TEXT,
  fact_key TEXT NOT NULL,
  fact_value SMALLINT NOT NULL DEFAULT -1, -- 1=true, 0=false, -1=unknown
  confidence REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'vision',
  extractor_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, room_type_id, photo_url, fact_key)
);
CREATE INDEX IF NOT EXISTS v2_room_feature_facts_city_fact_idx ON v2_room_feature_facts (city, fact_key, fact_value);
CREATE INDEX IF NOT EXISTS v2_room_feature_facts_hotel_room_idx ON v2_room_feature_facts (hotel_id, room_type_id);
