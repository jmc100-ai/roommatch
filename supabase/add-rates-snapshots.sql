-- Full-city LiteAPI rates snapshot (cross-instance warm cache, 30 min TTL enforced in app).
CREATE TABLE IF NOT EXISTS rates_snapshots (
  cache_key   TEXT PRIMARY KEY,
  city        TEXT NOT NULL,
  checkin     DATE NOT NULL,
  checkout    DATE NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'USD',
  payload     JSONB NOT NULL,
  priced_count INT NOT NULL DEFAULT 0,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rates_snapshots_fetched_at ON rates_snapshots (fetched_at);
CREATE INDEX IF NOT EXISTS rates_snapshots_city_dates ON rates_snapshots (city, checkin, checkout);
