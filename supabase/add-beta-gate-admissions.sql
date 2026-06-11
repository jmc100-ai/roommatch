-- Beta gate admission ledger — caps new invite-code logins (POST /auth).
-- Existing rm_gate cookies keep working; only new admissions are counted.
-- Apply via Supabase SQL editor before setting BETA_MAX_SLOTS on Render.

CREATE TABLE IF NOT EXISTS beta_gate_admissions (
  gate_cookie_hash TEXT PRIMARY KEY,   -- sha256 hash stored in rm_gate cookie
  code_source      TEXT NOT NULL DEFAULT 'public',  -- public | admin (admin exempt from cap)
  admitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash          TEXT,
  user_agent       TEXT
);

CREATE INDEX IF NOT EXISTS beta_gate_admissions_admitted_at_idx
  ON beta_gate_admissions(admitted_at DESC);

CREATE INDEX IF NOT EXISTS beta_gate_admissions_public_idx
  ON beta_gate_admissions(admitted_at DESC)
  WHERE code_source = 'public';

ALTER TABLE beta_gate_admissions ENABLE ROW LEVEL SECURITY;
