-- One-time data repair: Santa Fe had a degenerate OSM polygon (0 hotels in bbox);
-- Aeropuerto had manual_override blocking polygon backfill (null polygon for map).
-- Applied to project dmgxrcmdihgsffvqllms 2026-05-16. After this, run:
--   node scripts/recompute-neighborhood-vibes-only.js "Mexico City"
-- (or POST /api/backfill-neighborhood-vibes) so poi_counts / vibe_* match the new fences.

UPDATE neighborhoods
SET manual_override = false
WHERE city = 'Mexico City' AND name = 'Aeropuerto';

UPDATE neighborhoods
SET
  bbox = '{"lat_min":19.354,"lat_max":19.398,"lon_min":-99.286,"lon_max":-99.232}'::jsonb,
  polygon = '{"ring":[
    {"lat":19.354,"lng":-99.286},
    {"lat":19.354,"lng":-99.259},
    {"lat":19.354,"lng":-99.232},
    {"lat":19.376,"lng":-99.232},
    {"lat":19.398,"lng":-99.232},
    {"lat":19.398,"lng":-99.259},
    {"lat":19.398,"lng":-99.286},
    {"lat":19.376,"lng":-99.286},
    {"lat":19.354,"lng":-99.286}
  ]}'::jsonb,
  hotel_count = (
    SELECT count(*)::int FROM v2_hotels_cache h
    WHERE h.city = 'Mexico City'
      AND h.lat BETWEEN 19.354 AND 19.398
      AND h.lng BETWEEN -99.286 AND -99.232
  )
WHERE city = 'Mexico City' AND name = 'Santa Fe';

-- Octagonal fence from existing Aeropuerto axis-aligned bbox (map + POI scoring).
UPDATE neighborhoods
SET polygon = '{"ring":[
  {"lat":19.4,"lng":-99.1},
  {"lat":19.4,"lng":-99.08},
  {"lat":19.4,"lng":-99.06},
  {"lat":19.43,"lng":-99.06},
  {"lat":19.46,"lng":-99.06},
  {"lat":19.46,"lng":-99.08},
  {"lat":19.46,"lng":-99.1},
  {"lat":19.43,"lng":-99.1},
  {"lat":19.4,"lng":-99.1}
]}'::jsonb
WHERE city = 'Mexico City' AND name = 'Aeropuerto';

-- POI counts for corrected Santa Fe fence (Overpass snapshot 2026-05-16). Full
-- `recomputeNeighborhoodVibes` still recommended so vibe_elements / vibe_photos
-- and city-wide density normalization match.
UPDATE neighborhoods
SET attributes = jsonb_set(
    COALESCE(attributes, '{}'::jsonb),
    '{poi_counts}',
    '{"parks":41,"restaurants":54,"cafes":20,"museums":0,"shops":335,"icon_spots":21,"trees":1244,"trees_street":320}'::jsonb,
    true
  )
WHERE city = 'Mexico City' AND name = 'Santa Fe';
