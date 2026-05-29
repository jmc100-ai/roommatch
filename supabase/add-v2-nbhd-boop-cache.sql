-- Neighbourhood BOOP scoring cache (profile id→match% + per-city hotel→nbhd assignments).

CREATE TABLE IF NOT EXISTS v2_nbhd_boop_cache (
  cache_key        TEXT PRIMARY KEY,
  city             TEXT NOT NULL,
  scoring_version  TEXT NOT NULL,
  id_to_match      JSONB NOT NULL,
  hit_count        INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS v2_nbhd_boop_cache_city
  ON v2_nbhd_boop_cache (city);

CREATE TABLE IF NOT EXISTS v2_nbhd_primary_by_city (
  city             TEXT PRIMARY KEY,
  primary_by_hotel JSONB NOT NULL,
  hotel_count      INT NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION v2_nbhd_boop_cache_touch(p_key TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE v2_nbhd_boop_cache
  SET hit_count = hit_count + 1, updated_at = NOW()
  WHERE cache_key = p_key;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON v2_nbhd_boop_cache TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON v2_nbhd_primary_by_city TO service_role;
GRANT EXECUTE ON FUNCTION v2_nbhd_boop_cache_touch(TEXT) TO service_role;
