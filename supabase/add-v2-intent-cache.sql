-- ─────────────────────────────────────────────────────────────────────────────
-- v2_intent_cache.sql
--
-- Persistent (Postgres-backed) cache for Gemini NLP-intent results, replacing
-- the per-instance in-memory `_nlpCache` LRU in scripts/fact-catalog.js as
-- the source of truth across Render restarts and multiple instances.
--
-- Problem this solves
-- ───────────────────
-- `buildFactIntentLLM` calls Gemini with a 3-second timeout. When the LLM
-- responds within the budget we get a high-quality multi-fact intent
-- (router_version=v2-llm-1, typically 6–8 facts). When it times out we fall
-- back to the deterministic regex router (v2-facts-1, typically 0–3 facts).
-- Probe data showed the SAME query alternating between 1-fact and 8-fact
-- intent across consecutive calls — i.e. ranking quality silently depends on
-- whether Gemini happened to respond in time.
--
-- With this table, the FIRST successful LLM call for a query writes through
-- to Postgres. Every subsequent search (any instance) reads the cached
-- intent and skips Gemini entirely. The result is deterministic, fast, and
-- shared across the fleet — cold-start non-determinism becomes a one-time
-- event per unique query (until a cache miss happens, which still falls
-- back gracefully).
--
-- Lookup key
-- ──────────
-- `query_norm` is `lower(trim(query))`. mustHaves are part of the cache key
-- when present, because they materially change the intent. We store a
-- composite key as a single text column with the format:
--   `<query_norm>` or `<query_norm>|mh:<sorted,comma,joined>`
-- which mirrors the in-memory LRU key in fact-catalog.js (so we can keep
-- the same key-builder function).
--
-- The table is intentionally small (a few thousand rows for a healthy app)
-- and unbounded growth is fine — we can prune by `hit_count = 0 AND
-- updated_at < now() - interval '90 days'` later if needed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS v2_intent_cache (
  cache_key       TEXT PRIMARY KEY,
  intent          JSONB        NOT NULL,
  router_version  TEXT,
  fact_count      INT          NOT NULL DEFAULT 0,
  hit_count       INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS v2_intent_cache_updated_at
  ON v2_intent_cache (updated_at);

GRANT SELECT, INSERT, UPDATE ON TABLE v2_intent_cache
  TO service_role, anon, authenticated;

-- Helper RPC: increment hit_count atomically on cache hit. Search-v2 will
-- not block on this — fire-and-forget — but the SQL is correct under load.
CREATE OR REPLACE FUNCTION v2_intent_cache_touch(p_key TEXT)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE v2_intent_cache
     SET hit_count  = hit_count + 1,
         updated_at = NOW()
   WHERE cache_key = p_key;
$$;

GRANT EXECUTE ON FUNCTION v2_intent_cache_touch(text)
  TO service_role, anon, authenticated;
