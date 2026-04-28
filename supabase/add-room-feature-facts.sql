CREATE TABLE IF NOT EXISTS room_feature_facts (
  id BIGSERIAL PRIMARY KEY,
  hotel_id TEXT NOT NULL,
  room_type_id TEXT,
  city TEXT NOT NULL,
  country_code TEXT,
  fact_key TEXT NOT NULL,
  fact_value SMALLINT NOT NULL DEFAULT -1, -- 1=true, 0=false, -1=unknown
  confidence REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'vision',
  supplier_value SMALLINT,
  vision_value SMALLINT,
  supplier_confidence REAL,
  vision_confidence REAL,
  extractor_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hotel_id, room_type_id, fact_key)
);

CREATE INDEX IF NOT EXISTS room_feature_facts_city_fact_idx
  ON room_feature_facts (city, fact_key, fact_value);

CREATE INDEX IF NOT EXISTS room_feature_facts_hotel_room_idx
  ON room_feature_facts (hotel_id, room_type_id);
