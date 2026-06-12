-- Per-invite-code use cap: one row per redemption (device/session), not one row per code.
-- BETA_MAX_SLOTS = max successful logins per invite code (e.g. boop88 × 20).
-- Apply via Supabase SQL editor before deploy; safe when table is empty or new.

DROP TABLE IF EXISTS beta_gate_admissions;

CREATE TABLE beta_gate_admissions (
  id               BIGSERIAL PRIMARY KEY,
  gate_cookie_hash TEXT NOT NULL,   -- sha256 hash stored in rm_gate cookie (derived from code)
  code_source      TEXT NOT NULL DEFAULT 'public',  -- public | admin (admin rows exempt from cap)
  admitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash          TEXT,
  user_agent       TEXT
);

CREATE INDEX beta_gate_admissions_code_source_idx
  ON beta_gate_admissions (gate_cookie_hash, code_source);

CREATE INDEX beta_gate_admissions_admitted_at_idx
  ON beta_gate_admissions (admitted_at DESC);

CREATE INDEX beta_gate_admissions_public_code_idx
  ON beta_gate_admissions (gate_cookie_hash, admitted_at DESC)
  WHERE code_source = 'public';

ALTER TABLE beta_gate_admissions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.beta_gate_admissions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.beta_gate_admissions_id_seq TO service_role;
