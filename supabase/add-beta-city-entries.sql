-- Append-only log of every city entered via Go or chip (+ email dedupe ledger).
-- Apply after add-beta-activity-notify.sql. Idempotent.

-- 1. Full event log (every Go / chip attempt, including non-launch cities).
CREATE TABLE IF NOT EXISTS beta_city_entries (
  id              BIGSERIAL PRIMARY KEY,
  distinct_id     TEXT,
  raw_city        TEXT NOT NULL,
  resolved_city   TEXT,
  is_launch_city  BOOLEAN NOT NULL DEFAULT FALSE,
  source          TEXT NOT NULL DEFAULT 'go',
  release         TEXT,
  viewport        TEXT,
  user_agent      TEXT,
  ip_addr         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS beta_city_entries_created_idx
  ON beta_city_entries (created_at DESC);

CREATE INDEX IF NOT EXISTS beta_city_entries_raw_idx
  ON beta_city_entries (raw_city);

CREATE INDEX IF NOT EXISTS beta_city_entries_demand_idx
  ON beta_city_entries (is_launch_city, created_at DESC)
  WHERE NOT is_launch_city;

ALTER TABLE beta_city_entries ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.beta_city_entries TO service_role;

-- 2. Email dedupe: at most one notification per browser per UTC day per city (normalized key).
ALTER TABLE beta_activity_notify ADD COLUMN IF NOT EXISTS raw_city TEXT;
ALTER TABLE beta_activity_notify ADD COLUMN IF NOT EXISTS resolved_city TEXT;
ALTER TABLE beta_activity_notify ADD COLUMN IF NOT EXISTS is_launch_city BOOLEAN;
ALTER TABLE beta_activity_notify ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE beta_activity_notify
   SET raw_city = city
 WHERE raw_city IS NULL AND city IS NOT NULL;

-- Normalize legacy dedupe key to lowercase trim (PK component).
UPDATE beta_activity_notify
   SET city = lower(trim(city))
 WHERE city IS NOT NULL AND city <> lower(trim(city));

ALTER TABLE beta_activity_notify DROP CONSTRAINT IF EXISTS beta_activity_notify_pkey;
ALTER TABLE beta_activity_notify ADD PRIMARY KEY (distinct_id, activity_day, city);
