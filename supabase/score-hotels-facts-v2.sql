-- ─────────────────────────────────────────────────────────────────────────────
-- score_hotels_facts_v2.sql
--
-- Hotel-level vibe scoring RPC. Mirrors the room-level fact-coverage model but
-- aggregates to the hotel level. Used by V2 search to populate `hotelScore`
-- (replacing the empty hotel_profile_index / score_hotels fallback path that
-- always returned 0 rows and forced `hotel_vibe_model = "fallback_rating"`).
--
-- Design notes
-- ────────────
-- 1. Two photo pools per hotel:
--      • ROOM photos   — anything with room_name != '__hotel_public__'
--      • PUBLIC photos — `room_name = '__hotel_public__'` (lobby, pool, bar, ...)
--    Public photos are the strongest single visual signal of hotel personality
--    (lobby aesthetic, pool size, rooftop bar, ...). They're weighted heavier
--    than individual rooms via `p_public_weight` (default 5: one public photo
--    counts as 5 room photos in the combined coverage).
--
-- 2. Coverage is computed from the raw `v2_room_feature_facts` table, NOT
--    from the aggregated `v2_room_types_index.facts` JSONB. Rationale:
--      • The rebuild rule (`yes_count >= 1 AND no_count < 2`) is correct for
--        per-ROOM facts (e.g. "does THIS room have double sinks") but not for
--        per-HOTEL presence facts like `area_pool`.
--      • Working from raw facts lets us mix different aggregation semantics
--        in one function:
--          – area_*       → BINARY PRESENCE (1 if any photo shows it, else 0)
--                           because the hotel-public classifier writes mutex
--                           labels (1 yes + 9 no per photo), so a fractional
--                           coverage shrinks as a hotel adds more public
--                           photos — the wrong direction for "does this hotel
--                           have a rooftop bar".
--          – visual_style → FRACTION of photos for the style, reflecting how
--                           consistently the hotel commits to that aesthetic.
--          – default      → FRACTION (existing behaviour) for everything else.
--
-- 3. `raw_score` is weight-normalised: Σ(weight × coverage) / Σ(weight).
--    Output range is therefore [0.0, 1.0]; the search-v2 ranker applies its
--    own adaptive remap to 0-100 (same shape as room scoring).
--
-- 4. Hotels with no inventory at all return raw_score = 0 (not NULL) so the
--    search ranker can treat them uniformly without null-guards.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.score_hotels_facts_v2(
  p_city          text,
  p_hotel_ids     text[],
  p_fact_weights  jsonb,                 -- {"area_pool": 0.7, "visual_style_sleek_polished": 0.9, ...}
  p_public_weight numeric DEFAULT 5.0    -- one public photo = N room photos in combined coverage
)
RETURNS TABLE (
  hotel_id            text,
  raw_score           double precision,
  room_coverage       jsonb,    -- per-fact coverage from room photos     {fact_key: 0.0..1.0}
  public_coverage     jsonb,    -- per-fact coverage from public photos   {fact_key: 0.0..1.0}
  total_room_photos   int,
  total_public_photos int
)
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  total_weight numeric;
BEGIN
  SET LOCAL statement_timeout = '30000';

  -- Sum of weights for normalisation (guard against 0)
  SELECT COALESCE(SUM(NULLIF((value)::text, '')::numeric), 0)
    INTO total_weight
    FROM jsonb_each_text(p_fact_weights);
  IF total_weight IS NULL OR total_weight <= 0 THEN
    total_weight := 1.0;
  END IF;

  RETURN QUERY
  WITH
  target_hotels AS (
    SELECT unnest(p_hotel_ids) AS hotel_id
  ),
  fact_keys AS (
    SELECT jsonb_object_keys(p_fact_weights) AS fact_key
  ),
  -- Per-(hotel, fact_key, pool) yes / no distinct-photo counts.
  fact_counts AS (
    SELECT
      f.hotel_id,
      f.fact_key,
      CASE WHEN f.room_name = '__hotel_public__' THEN 'public' ELSE 'room' END AS pool,
      COUNT(DISTINCT f.photo_url) FILTER (WHERE f.fact_value = 1) AS yes_count,
      COUNT(DISTINCT f.photo_url) FILTER (WHERE f.fact_value = 0) AS no_count
    FROM v2_room_feature_facts f
    JOIN target_hotels th ON f.hotel_id = th.hotel_id
    JOIN fact_keys     fk ON f.fact_key = fk.fact_key
    WHERE f.city = p_city
    GROUP BY f.hotel_id, f.fact_key, pool
  ),
  fact_coverage AS (
    SELECT
      hotel_id, fact_key, pool,
      CASE
        -- area_*: binary presence (any "yes" photo → 1.0; otherwise 0).
        -- See header note for rationale (mutex labels make fractions wrong).
        WHEN fact_key LIKE 'area\_%' ESCAPE '\' THEN
          CASE WHEN yes_count >= 1 THEN 1.0 ELSE 0.0 END
        -- default: fraction-of-photos coverage (visual_style, etc.)
        WHEN (yes_count + no_count) > 0 THEN
          yes_count::double precision / (yes_count + no_count)::double precision
        ELSE 0.0
      END AS coverage
    FROM fact_counts
  ),
  -- Per-pool total photo counts (denominator for the combined-coverage blend).
  pool_totals AS (
    SELECT
      f.hotel_id,
      CASE WHEN f.room_name = '__hotel_public__' THEN 'public' ELSE 'room' END AS pool,
      COUNT(DISTINCT f.photo_url) AS total_photos
    FROM v2_room_feature_facts f
    JOIN target_hotels th ON f.hotel_id = th.hotel_id
    WHERE f.city = p_city
    GROUP BY f.hotel_id, pool
  ),
  -- One row per (hotel, fact_key) with both pools' coverage + photo counts.
  combined AS (
    SELECT
      th.hotel_id,
      fk.fact_key,
      COALESCE(MAX(CASE WHEN fcv.pool = 'room'   THEN fcv.coverage  END), 0) AS room_cov,
      COALESCE(MAX(CASE WHEN fcv.pool = 'public' THEN fcv.coverage  END), 0) AS pub_cov,
      COALESCE(MAX(CASE WHEN pt.pool  = 'room'   THEN pt.total_photos END), 0)::numeric AS n_room,
      COALESCE(MAX(CASE WHEN pt.pool  = 'public' THEN pt.total_photos END), 0)::numeric AS n_pub
    FROM target_hotels th
    CROSS JOIN fact_keys fk
    LEFT JOIN fact_coverage fcv
      ON fcv.hotel_id = th.hotel_id AND fcv.fact_key = fk.fact_key
    LEFT JOIN pool_totals pt
      ON pt.hotel_id  = th.hotel_id
    GROUP BY th.hotel_id, fk.fact_key
  ),
  weighted AS (
    SELECT
      c.hotel_id,
      c.fact_key,
      c.room_cov,
      c.pub_cov,
      c.n_room,
      c.n_pub,
      (p_fact_weights->>c.fact_key)::numeric AS weight,
      -- combined coverage = (n_room × room_cov + W × n_pub × pub_cov) / (n_room + W × n_pub)
      CASE WHEN (c.n_room + p_public_weight * c.n_pub) > 0
           THEN ((c.room_cov::numeric * c.n_room + p_public_weight * c.pub_cov::numeric * c.n_pub)
                 / (c.n_room + p_public_weight * c.n_pub))::double precision
           ELSE 0.0
      END AS combined_cov
    FROM combined c
  )
  SELECT
    w.hotel_id::text,
    (SUM(w.weight * w.combined_cov) / total_weight)::double precision                AS raw_score,
    jsonb_object_agg(w.fact_key, w.room_cov)                                          AS room_coverage,
    jsonb_object_agg(w.fact_key, w.pub_cov)                                           AS public_coverage,
    COALESCE(MAX(w.n_room), 0)::int                                                   AS total_room_photos,
    COALESCE(MAX(w.n_pub),  0)::int                                                   AS total_public_photos
  FROM weighted w
  GROUP BY w.hotel_id;
END;
$function$;

-- Make it callable from the anon role (search uses anon key for read-only paths
-- but service_key for everything else; granting anon doesn't hurt).
GRANT EXECUTE ON FUNCTION public.score_hotels_facts_v2(text, text[], jsonb, numeric)
  TO anon, authenticated, service_role;
