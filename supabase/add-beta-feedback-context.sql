-- Extra context on beta_feedback for agent triage (PostHog replay lookup, repro).
-- Apply after add-beta-tables.sql. Idempotent.

ALTER TABLE beta_feedback ADD COLUMN IF NOT EXISTS current_city TEXT;
ALTER TABLE beta_feedback ADD COLUMN IF NOT EXISTS release TEXT;
ALTER TABLE beta_feedback ADD COLUMN IF NOT EXISTS viewport TEXT;
ALTER TABLE beta_feedback ADD COLUMN IF NOT EXISTS issue_type TEXT;
ALTER TABLE beta_feedback ADD COLUMN IF NOT EXISTS debug_context JSONB;

CREATE INDEX IF NOT EXISTS beta_feedback_distinct_id_idx ON beta_feedback(distinct_id) WHERE distinct_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS beta_feedback_issue_type_idx  ON beta_feedback(issue_type)  WHERE issue_type IS NOT NULL;
