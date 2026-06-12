-- Beta gate admission ledger — caps redemptions per invite code (POST /auth).
-- One row per successful login; BETA_MAX_SLOTS = max uses per code.
-- Apply via Supabase SQL editor before setting BETA_MAX_SLOTS on Render.

CREATE TABLE IF NOT EXISTS beta_gate_admissions (
  id               BIGSERIAL PRIMARY KEY,
  gate_cookie_hash TEXT NOT NULL,
  code_source      TEXT NOT NULL DEFAULT 'public',  -- public | admin (admin exempt from cap)
  admitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash          TEXT,
  user_agent       TEXT
);

CREATE INDEX IF NOT EXISTS beta_gate_admissions_code_source_idx
  ON beta_gate_admissions (gate_cookie_hash, code_source);

CREATE INDEX IF NOT EXISTS beta_gate_admissions_admitted_at_idx
  ON beta_gate_admissions (admitted_at DESC);

CREATE INDEX IF NOT EXISTS beta_gate_admissions_public_code_idx
  ON beta_gate_admissions (gate_cookie_hash, admitted_at DESC)
  WHERE code_source = 'public';

ALTER TABLE beta_gate_admissions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.beta_gate_admissions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.beta_gate_admissions_id_seq TO service_role;
