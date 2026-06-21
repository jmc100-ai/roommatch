-- ─────────────────────────────────────────────────────────────────────────────
-- PostgREST / supabase-js explicit GRANTs (Supabase Data API policy, 2026)
--
-- New Supabase projects (from ~May 30, 2026) and all existing projects
-- (~Oct 30, 2026) require explicit privileges on public tables for anon /
-- authenticated / service_role. Without GRANT, PostgREST returns 42501.
--
-- Run once in the Supabase SQL editor for project dmgxrcmdihgsffvqllms, or
-- fold into your migration runner. Safe to re-run (GRANT is idempotent).
--
-- When you add a new public table, append its name to `api_tables` below
-- (or add inline GRANTs next to the CREATE TABLE in the same migration file).
-- ─────────────────────────────────────────────────────────────────────────────

-- V1 core + search
-- V2 search + cache
-- Neighbourhoods + beta
DO $$
DECLARE
  t text;
  api_tables text[] := ARRAY[
    'indexed_cities',
    'hotels_cache',
    'room_embeddings',
    'room_types_index',
    'room_feature_facts',
    'hotel_profile_index',
    'neighborhoods',
    'vibe_presets',
    'v2_indexed_cities',
    'v2_hotels_cache',
    'v2_room_inventory',
    'v2_room_feature_facts',
    'v2_room_types_index',
    'v2_intent_cache',
    'boop_trip_images',
    'boop_nbhd_scene_images'
  ];
  beta_tables text[] := ARRAY[
    'beta_feedback',
    'beta_consents',
    'beta_invitees',
    'beta_gate_admissions',
    'beta_activity_notify',
    'beta_city_entries'
  ];
BEGIN
  FOREACH t IN ARRAY api_tables
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
        t
      );
      EXECUTE format(
        'GRANT SELECT ON TABLE public.%I TO anon, authenticated',
        t
      );
    END IF;
  END LOOP;

  FOREACH t IN ARRAY beta_tables
  LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
        t
      );
    END IF;
  END LOOP;
END $$;

-- beta_feedback uses BIGSERIAL; only service_role should use the sequence.
DO $$
BEGIN
  IF to_regclass('public.beta_feedback_id_seq') IS NOT NULL THEN
    GRANT USAGE, SELECT ON SEQUENCE public.beta_feedback_id_seq TO service_role;
  END IF;
END $$;

-- Owning sequences for SERIAL/BIGSERIAL inserts (indexer + RPC paths).
DO $$
DECLARE
  s text;
  seqs text[] := ARRAY[
    'indexed_cities_id_seq',
    'room_embeddings_id_seq',
    'room_types_index_id_seq',
    'room_feature_facts_id_seq',
    'neighborhoods_id_seq',
    'vibe_presets_id_seq',
    'v2_room_inventory_id_seq',
    'v2_room_feature_facts_id_seq',
    'v2_room_types_index_id_seq'
  ];
BEGIN
  FOREACH s IN ARRAY seqs
  LOOP
    IF to_regclass(format('public.%I', s)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role',
        s
      );
      EXECUTE format(
        'GRANT USAGE, SELECT ON SEQUENCE public.%I TO anon, authenticated',
        s
      );
    END IF;
  END LOOP;
END $$;
