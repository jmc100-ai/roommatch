-- Populate feature_flags column in room_embeddings from existing feature_summary text.
-- Run AFTER the backfill-feature-embeddings job completes (feature_summary must be final).
-- This is idempotent — re-running overwrites with fresh values.

UPDATE room_embeddings
SET feature_flags = (
  SELECT jsonb_strip_nulls(jsonb_build_object(
    -- Bathroom
    'double_sinks',          CASE WHEN feature_summary ~* '\mSINKS:\s*double sinks' THEN true ELSE NULL END,
    'bathtub',               CASE WHEN feature_summary ~* '\mBATHTUB:' THEN true ELSE NULL END,
    'soaking_tub',           CASE WHEN feature_summary ~* '\mBATHTUB:\s*soaking tub' THEN true ELSE NULL END,
    'clawfoot_tub',          CASE WHEN feature_summary ~* '\mBATHTUB:\s*clawfoot' THEN true ELSE NULL END,
    'walk_in_shower',        CASE WHEN feature_summary ~* '\mSHOWER:\s*walk-in shower' THEN true ELSE NULL END,
    'rainfall_shower',       CASE WHEN feature_summary ~* '\mSHOWER:.*rainfall shower|\mDISTINCTIVE FEATURES:.*rainfall shower' THEN true ELSE NULL END,
    'in_room_jacuzzi',       CASE WHEN feature_summary ~* '\mIN-ROOM HOT TUB OR JACUZZI:\s*yes|\mBATHTUB:\s*(jacuzzi|hot tub)' THEN true ELSE NULL END,
    'bidet',                 CASE WHEN feature_summary ~* '\mBIDET:\s*yes' THEN true ELSE NULL END,
    'separate_toilet_room',  CASE WHEN feature_summary ~* '\mSEPARATE TOILET ROOM:\s*yes' THEN true ELSE NULL END,
    -- Bedroom / Closet
    'king_bed',              CASE WHEN feature_summary ~* '\mBED:.*\mking\M' THEN true ELSE NULL END,
    'four_poster_bed',       CASE WHEN feature_summary ~* '\mBED:.*four[- ]poster' THEN true ELSE NULL END,
    'twin_beds',             CASE WHEN feature_summary ~* '\mBED:.*\mtwins?\M' THEN true ELSE NULL END,
    'walk_in_closet',        CASE WHEN feature_summary ~* '\mWALK-IN CLOSET:\s*yes' THEN true ELSE NULL END,
    -- Space
    'separate_living_area',  CASE WHEN feature_summary ~* '\mSEPARATE LIVING AREA:\s*yes' THEN true ELSE NULL END,
    'high_ceilings',         CASE WHEN feature_summary ~* '\mCEILING HEIGHT:\s*(high ceilings|vaulted ceiling)' THEN true ELSE NULL END,
    'floor_to_ceiling_windows', CASE WHEN feature_summary ~* '\mWINDOWS:\s*floor-to-ceiling windows' THEN true ELSE NULL END,
    -- Outdoor
    'balcony',               CASE WHEN feature_summary ~* '\mBALCONY OR TERRACE:\s*yes' THEN true ELSE NULL END,
    'terrace',               CASE WHEN feature_summary ~* '\mDISTINCTIVE FEATURES:.*\mterrace\M' THEN true ELSE NULL END,
    -- Views
    'city_view',             CASE WHEN feature_summary ~* '\mVIEW:\s*city view' THEN true ELSE NULL END,
    'landmark_view',         CASE WHEN feature_summary ~* '\mVIEW:\s*(Eiffel Tower|landmark|Big Ben|Tower Bridge|Empire State|monument)' THEN true ELSE NULL END,
    'garden_view',           CASE WHEN feature_summary ~* '\mVIEW:\s*garden view' THEN true ELSE NULL END,
    'river_view',            CASE WHEN feature_summary ~* '\mVIEW:\s*(river view|seine|thames|hudson|canal view)' THEN true ELSE NULL END,
    'courtyard_view',        CASE WHEN feature_summary ~* '\mVIEW:\s*courtyard view' THEN true ELSE NULL END,
    'pool_view',             CASE WHEN feature_summary ~* '\mVIEW:\s*pool view' THEN true ELSE NULL END,
    'sea_view',              CASE WHEN feature_summary ~* '\mVIEW:\s*(sea view|ocean view)' THEN true ELSE NULL END,
    'mountain_view',         CASE WHEN feature_summary ~* '\mVIEW:\s*mountain view' THEN true ELSE NULL END,
    -- Features
    'fireplace',             CASE WHEN feature_summary ~* '\mFIREPLACE:\s*yes' THEN true ELSE NULL END,
    'private_pool',          CASE WHEN feature_summary ~* '\mDISTINCTIVE FEATURES:.*\mprivate pool\M' THEN true ELSE NULL END,
    'sofa',                  CASE WHEN feature_summary ~* '\mSOFA:\s*yes' THEN true ELSE NULL END,
    'chaise_lounge',         CASE WHEN feature_summary ~* '\mCHAISE LOUNGE:\s*yes' THEN true ELSE NULL END,
    'dining_table',          CASE WHEN feature_summary ~* '\mDINING TABLE:\s*yes' THEN true ELSE NULL END
  ))
)
WHERE feature_summary IS NOT NULL;

-- Verify coverage
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE feature_flags IS NOT NULL AND feature_flags != '{}') AS rows_with_flags,
  COUNT(*) FILTER (WHERE feature_flags ? 'double_sinks') AS double_sinks_count,
  COUNT(*) FILTER (WHERE feature_flags ? 'soaking_tub')  AS soaking_tub_count,
  COUNT(*) FILTER (WHERE feature_flags ? 'bathtub')      AS bathtub_count,
  COUNT(*) FILTER (WHERE feature_flags ? 'balcony')      AS balcony_count,
  COUNT(*) FILTER (WHERE feature_flags ? 'fireplace')    AS fireplace_count,
  COUNT(*) FILTER (WHERE feature_flags ? 'city_view')    AS city_view_count,
  COUNT(*) FILTER (WHERE feature_flags ? 'landmark_view') AS landmark_view_count,
  COUNT(*) FILTER (WHERE feature_flags ? 'king_bed')     AS king_bed_count
FROM room_embeddings
WHERE city = 'Paris';
