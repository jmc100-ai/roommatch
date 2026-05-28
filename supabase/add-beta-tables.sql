-- ─────────────────────────────────────────────────────────────────────────────
-- Beta launch tables — feedback intake, consent ledger, invite roster
-- Apply via Supabase SQL editor or `supabase db push`. Idempotent (uses IF NOT EXISTS).
-- Created 2026-05-07 as part of TravelByVibe closed-beta launch (TravelBoop, LLC).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. beta_feedback — every in-app feedback button submission lands here.
--    POST /api/feedback inserts. Slack webhook (optional) mirrors out.
CREATE TABLE IF NOT EXISTS beta_feedback (
  id              BIGSERIAL PRIMARY KEY,
  distinct_id     TEXT,                 -- pseudonymous browser UUID (PostHog distinct_id)
  user_email      TEXT,                 -- optional, lowercased
  sentiment       SMALLINT,             -- 1-5 (lower = bad, higher = great); nullable
  message         TEXT NOT NULL,        -- freeform body, capped at 4000 chars in API
  current_url     TEXT,
  current_search  TEXT,                 -- the active vsearch query (helps reproduce)
  current_city    TEXT,                 -- added in add-beta-feedback-context.sql if missing
  release         TEXT,
  viewport        TEXT,
  issue_type      TEXT,                 -- bug | ux | ranking | praise | other
  debug_context   JSONB,                -- coarse repro (no query text)
  user_agent      TEXT,
  ip_addr         TEXT,                 -- last-resort identifier; not used for tracking
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS beta_feedback_created_at_idx ON beta_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS beta_feedback_email_idx      ON beta_feedback(user_email) WHERE user_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS beta_feedback_sentiment_idx  ON beta_feedback(sentiment)  WHERE sentiment IS NOT NULL;

-- 2. beta_consents — first-time consent acceptance ledger. One row per browser.
CREATE TABLE IF NOT EXISTS beta_consents (
  distinct_id   TEXT PRIMARY KEY,
  user_email    TEXT,
  ip_addr       TEXT,
  user_agent    TEXT,
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  policy_version TEXT NOT NULL DEFAULT 'v1-2026-05-07'
);

CREATE INDEX IF NOT EXISTS beta_consents_accepted_at_idx ON beta_consents(accepted_at DESC);
CREATE INDEX IF NOT EXISTS beta_consents_email_idx       ON beta_consents(user_email) WHERE user_email IS NOT NULL;

-- 3. beta_invitees — manually-curated roster for outbound emails (Resend).
--    Used by scripts/email/send-*.js to filter who's been emailed and who's
--    pending follow-up. Emails are added by hand or via a CSV import.
CREATE TABLE IF NOT EXISTS beta_invitees (
  email             TEXT PRIMARY KEY,
  first_name        TEXT,
  channel           TEXT,              -- e.g. 'friends', 'twitter', 'reddit', 'referral'
  invite_sent_at    TIMESTAMPTZ,
  welcome_sent_at   TIMESTAMPTZ,
  nudge_sent_at     TIMESTAMPTZ,
  call_invite_sent_at TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'pending',
                                       -- pending | invited | active | dormant | churned
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS beta_invitees_status_idx       ON beta_invitees(status);
CREATE INDEX IF NOT EXISTS beta_invitees_invite_sent_idx  ON beta_invitees(invite_sent_at);

-- Auto-update updated_at when rows are touched.
CREATE OR REPLACE FUNCTION _beta_invitees_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS beta_invitees_touch_trg ON beta_invitees;
CREATE TRIGGER beta_invitees_touch_trg
  BEFORE UPDATE ON beta_invitees
  FOR EACH ROW EXECUTE FUNCTION _beta_invitees_touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Permissions: feedback + consent are written by the anon role via the API
-- (server uses the service key, so RLS does not need to be opened). We do not
-- expose these tables for direct client read/write.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE beta_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE beta_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE beta_invitees ENABLE ROW LEVEL SECURITY;
-- (No CREATE POLICY blocks — service role bypasses RLS, which is the only path
--  that should ever touch these tables.)
