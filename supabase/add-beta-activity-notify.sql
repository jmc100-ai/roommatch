-- Email dedupe ledger for city Go/chip activity emails (POST /api/activity).
-- One notification email per distinct_id per UTC calendar day per city (normalized key in `city`).

CREATE TABLE IF NOT EXISTS beta_activity_notify (
  distinct_id     TEXT NOT NULL,
  activity_day    DATE NOT NULL,
  city            TEXT NOT NULL,
  raw_city        TEXT,
  resolved_city   TEXT,
  is_launch_city  BOOLEAN,
  source          TEXT,
  release         TEXT,
  viewport        TEXT,
  user_agent      TEXT,
  ip_addr         TEXT,
  notified_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (distinct_id, activity_day, city)
);

CREATE INDEX IF NOT EXISTS beta_activity_notify_day_idx
  ON beta_activity_notify (activity_day DESC);

ALTER TABLE beta_activity_notify ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.beta_activity_notify TO service_role;
