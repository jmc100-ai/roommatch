const FACT_CATALOG = [
  // Architectural & layout
  "floor_to_ceiling_windows","open_plan","divided_seating","exposed_brick","exposed_concrete","exposed_wood","high_ceilings","loft_layout",
  "private_balcony","juliette_balcony","walk_in_closet","kitchenette","corner_room","swim_up_access",
  // Flooring & materials
  "hardwood_parquet","polished_concrete","stone_tile_floor","wall_to_wall_carpet","area_rugs","statement_wallpaper","textured_upholstery",
  // Power & workspace
  "bedside_outlets","desk_level_outlets","usb_c_ports","universal_sockets","ergonomic_workspace","laptop_lounge_chair","ethernet_port","smart_tv_casting",
  // Bathroom (high priority)
  "double_sinks","soaking_tub","rainfall_shower","handheld_wand","separate_toilet_door","glass_wall_bathroom","bidet_washlet","natural_light_bathroom",
  "stone_surfaces","anti_fog_mirror","makeup_vanity","heated_towel_rack",
  // Vibe & mood
  "high_natural_light","dimmable_lighting","accent_cove_lighting","warm_light_temp","cool_light_temp","blackout_shutters","statement_fixture","floor_lamps","reading_lights",
  // Style & lifestyle
  "palette_minimalist","palette_moody","palette_earth","palette_vibrant","organic_wood_heavy","king_bed","canopy_bed","mid_century_modern","vintage_furniture",
  "record_player","bluetooth_audio","espresso_station","indoor_plants","full_length_mirror","cocktail_station","laptop_safe",
  // Visual style — single mutex enum classification (one true per photo, majority-vote
  // at room level). Boop wizard's `stayVibe` answer injects a soft preference for the
  // matching fact via buildStayVibeIntent. Designed to discriminate where the noisy
  // palette_* booleans cannot (palette_minimalist is set on 83% of MX City hotels).
  "visual_style_sleek_polished","visual_style_cozy_warm","visual_style_vibrant_eclectic",
  "visual_style_moody_dark","visual_style_classic_traditional",
  // Hotel public-area presence (non-mutex; a poolside bar can be both `area_pool` and
  // `area_bar`). Populated by the hotel-public photo classifier from photos in
  // `v2_hotels_cache.hotel_photos` (NOT from in-room photos). Aggregated at hotel level
  // to a coverage value (`rooms_with_area / total_public_photos`) that feeds the
  // hotel_vibe_score. Lets the LLM router answer queries like "hotel with a rooftop bar"
  // by mapping the phrase to {area_rooftop, area_bar} soft preferences.
  "area_lobby","area_pool","area_restaurant","area_bar","area_gym","area_spa",
  "area_exterior","area_courtyard_garden","area_rooftop","area_meeting_room",
  // View & context
  "skyline_view","water_view","green_view","courtyard_view","landmark_view","high_floor","street_level_view","privacy_sheers","balcony_furniture",
  // Added coverage facts
  "step_free_access","roll_in_shower","grab_bars","elevator_access","wheelchair_clearance",
  "soundproofing_high","quiet_street","nightlife_noise_risk",
  "individual_thermostat","ceiling_fan","operable_windows","air_purifier",
  "firm_mattress_option","pillow_menu","hypoallergenic_bedding",
  "sofa_bed","connecting_rooms_possible","crib_available_signal",
  "counter_space_generous","tub_and_shower_separate","strong_water_pressure_signal",
  "wifi_quality_high","desk_large_enough","video_call_friendly_lighting",
  "mini_fridge","microwave","laundry_in_room","pet_friendly_room","family_suite_layout",
  "noise_insulated_windows","romantic_lighting","smart_controls","daybed_window_nook","dining_table_in_room",
];

const FACT_SET = new Set(FACT_CATALOG);

const FACT_SYNONYMS = [
  { fact: "double_sinks", rx: /\bdouble sinks?\b|\btwo sinks?\b|\bdual sinks?\b|\bmultiple sinks?\b/i },
  { fact: "soaking_tub", rx: /\bsoaking tub\b|\bfreestanding tub\b|\bdeep tub\b/i },
  { fact: "rainfall_shower", rx: /\brainfall shower\b|\brain shower\b/i },
  { fact: "walk_in_closet", rx: /\bwalk[- ]in closet\b|\bdressing room\b/i },
  { fact: "private_balcony", rx: /\bprivate balcony\b|\bbalcony\b/i },
  { fact: "desk_level_outlets", rx: /\bdesk outlets?\b|\boutlets? near desk\b|\bplenty of outlets?\b/i },
  { fact: "ergonomic_workspace", rx: /\bergonomic\b|\bproper workspace\b|\bwork desk\b/i },
  // Ambient style/mood facts deliberately omitted from auto-detection: high_natural_light,
  // palette_minimalist, palette_earth, palette_vibrant are triggered by generic BOOP seed
  // words ("natural light", "minimalist", "clean lines") and have very low DB coverage
  // (4–8 hotels in MX City), making them useless discriminators that distort scoring.
  // They are handled by textScore instead. Reintroduce only if coverage improves.
  { fact: "palette_moody", rx: /\bmoody\b|\bdark and moody\b|\bdark tones?\b/i },
  { fact: "king_bed", rx: /\bking bed\b|\bking-size bed\b/i },
  { fact: "water_view", rx: /\bwater view\b|\bocean view\b|\bsea view\b|\briver view\b/i },
  { fact: "skyline_view", rx: /\bskyline view\b|\bcity lights\b/i },
  { fact: "landmark_view", rx: /\blandmark view\b|\beiffel\b|\biconic view\b/i },
  { fact: "quiet_street", rx: /\bquiet\b|\bpeaceful\b|\btranquil\b/i },
  { fact: "nightlife_noise_risk", rx: /\bnoisy\b|\bnightlife\b|\bloud\b/i },
  { fact: "wifi_quality_high", rx: /\bfast wifi\b|\bgood wifi\b|\breliable wifi\b/i },
  { fact: "step_free_access", rx: /\bstep[- ]free\b|\baccessible\b/i },
  // Hotel public-area synonyms (non-mutex). These let the regex router pick up
  // amenity-style phrases that the wizard doesn't capture; the LLM router also
  // sees FACT_DESCRIPTIONS for these and can route richer phrasing.
  { fact: "area_lobby",            rx: /\blobby\b|\blobbies\b|\bfront desk\b|\breception\b/i },
  { fact: "area_pool",             rx: /\bpool\b|\bswimming\b/i },
  { fact: "area_restaurant",       rx: /\brestaurant\b|\bdining room\b|\bbreakfast room\b|\beat in\b/i },
  { fact: "area_bar",              rx: /\bbar\b|\bcocktail\s*bar\b|\blounge\s*bar\b/i },
  { fact: "area_gym",              rx: /\bgym\b|\bfitness\s*(center|centre|room)?\b|\bworkout room\b/i },
  { fact: "area_spa",              rx: /\bspa\b|\bsauna\b|\bsteam room\b|\bjacuzzi\b|\bhot tub\b|\bwellness\b/i },
  { fact: "area_exterior",         rx: /\bexterior\b|\bfacade\b|\bbuilding outside\b/i },
  { fact: "area_courtyard_garden", rx: /\bcourtyard\b|\bgarden\b|\bpatio\b/i },
  { fact: "area_rooftop",          rx: /\brooftop\b|\broof\s*top\b|\bsky\s*bar\b|\bsky\s*deck\b|\broof terrace\b/i },
  { fact: "area_meeting_room",     rx: /\bmeeting room\b|\bconference room\b|\bboardroom\b/i },
];

// ── Human-readable descriptions for LLM NLP router ──────────────────────────
// Used to help Gemini understand what each fact_key means in plain English.
const FACT_DESCRIPTIONS = {
  // Bathroom
  double_sinks:            "two sinks / double vanity in bathroom",
  soaking_tub:             "deep soaking or freestanding bathtub",
  bathtub:                 "any standard bathtub",
  rainfall_shower:         "overhead rainfall shower head",
  walk_in_shower:          "walk-in shower cubicle",
  handheld_wand:           "handheld shower wand/attachment",
  glass_wall_bathroom:     "glass wall or partition in bathroom",
  stone_surfaces:          "stone or marble bathroom surfaces",
  natural_light_bathroom:  "natural light in bathroom",
  heated_towel_rack:       "heated towel rail or rack",
  bidet_washlet:           "bidet or washlet toilet",
  separate_toilet_door:    "toilet in separate room with door",
  anti_fog_mirror:         "anti-fog bathroom mirror",
  makeup_vanity:           "dedicated makeup vanity area",
  tub_and_shower_separate: "separate tub and shower in bathroom",
  counter_space_generous:  "generous bathroom counter space",
  roll_in_shower:          "roll-in accessible shower",
  grab_bars:               "grab bars for safety/accessibility",
  // Bedroom / layout
  king_bed:                "king size bed",
  canopy_bed:              "canopy or four-poster bed",
  floor_to_ceiling_windows:"floor-to-ceiling / wall-of-glass windows",
  private_balcony:         "private balcony or terrace",
  juliette_balcony:        "Juliette / French balcony (no outdoor space)",
  high_ceilings:           "high or vaulted ceilings",
  open_plan:               "open-plan living space",
  loft_layout:             "loft or split-level room layout",
  walk_in_closet:          "walk-in wardrobe / dressing room",
  kitchenette:             "in-room kitchenette or mini kitchen",
  swim_up_access:          "swim-up pool access from room",
  sofa_bed:                "sofa bed or pull-out bed",
  daybed_window_nook:      "daybed, window seat, or reading nook",
  dining_table_in_room:    "dining table inside the room",
  full_length_mirror:      "full-length / floor mirror",
  divided_seating:         "separate sitting / lounge area",
  // Flooring & surfaces
  hardwood_parquet:        "hardwood or parquet floor",
  stone_tile_floor:        "stone, marble, or large-format tile floor",
  polished_concrete:       "polished concrete floor",
  wall_to_wall_carpet:     "wall-to-wall carpet",
  area_rugs:               "decorative area rugs",
  statement_wallpaper:     "bold or designer wallpaper feature wall",
  exposed_brick:           "exposed brick wall",
  exposed_wood:            "exposed wood beams or ceiling",
  // Amenities (visible)
  ergonomic_workspace:     "proper work desk with ergonomic chair",
  espresso_station:        "in-room espresso or capsule coffee machine",
  indoor_plants:           "indoor plants or living greenery",
  cocktail_station:        "cocktail bar or drinks station",
  mini_fridge:             "mini refrigerator",
  microwave:               "microwave oven",
  laundry_in_room:         "washer and/or dryer in room",
  record_player:           "record player / vinyl turntable",
  smart_controls:          "smart room controls for lights/curtains",
  individual_thermostat:   "individual thermostat / AC control",
  ceiling_fan:             "ceiling fan",
  // Light & mood
  high_natural_light:      "flooded with natural daylight, bright interior",
  dimmable_lighting:       "dimmable lighting controls",
  warm_light_temp:         "warm amber/golden lighting tone",
  accent_cove_lighting:    "accent cove or LED indirect lighting",
  floor_lamps:             "floor-standing lamps",
  reading_lights:          "dedicated reading lights by bed",
  blackout_shutters:       "blackout curtains or shutters for darkness",
  statement_fixture:       "designer chandelier or statement light fixture",
  romantic_lighting:       "soft romantic low-level lighting",
  // Style
  palette_minimalist:      "minimalist clean-lines design, uncluttered",
  palette_moody:           "dark moody dramatic atmosphere",
  palette_earth:           "earth tones, warm natural neutral palette",
  palette_vibrant:         "vibrant colourful eclectic interior",
  organic_wood_heavy:      "heavy use of natural wood throughout",
  mid_century_modern:      "mid-century modern furniture and design",
  vintage_furniture:       "vintage or antique furniture pieces",
  // Visual style (single mutex enum). The LLM router should NOT pick these from a
  // free-text query — they are injected separately by buildStayVibeIntent based on
  // boop_profile.answers.stayVibe. Descriptions kept here so debugging tools can
  // print human labels.
  visual_style_sleek_polished:    "sleek polished modern, minimalist clean lines, neutral palette, contemporary",
  visual_style_cozy_warm:         "cozy warm inviting, soft textiles, comfortable, traditional homey",
  visual_style_vibrant_eclectic:  "vibrant eclectic, bold colours, playful patterns, mixed eras, artsy",
  visual_style_moody_dark:        "moody dark dramatic, deep colours, rich textures, sultry sophisticated",
  visual_style_classic_traditional: "classic traditional formal, ornate, elegant, conventional decor",
  // Hotel public-area presence (non-mutex). The LLM router CAN and SHOULD pick these
  // from free-text queries like "rooftop bar", "hotel with a pool", "spa hotel".
  // Coverage is derived from the hotel's PUBLIC photos (not in-room photos).
  area_lobby:              "hotel lobby, reception, or front-of-house lounge area",
  area_pool:               "swimming pool or pool deck (indoor or outdoor)",
  area_restaurant:         "hotel restaurant or main dining room",
  area_bar:                "hotel bar, cocktail lounge, or lounge bar",
  area_gym:                "fitness centre, gym, or workout room",
  area_spa:                "spa, sauna, steam room, hot tub, or wellness centre",
  area_exterior:           "exterior building shot or facade",
  area_courtyard_garden:   "outdoor courtyard, garden, or patio",
  area_rooftop:            "rooftop terrace, rooftop bar, or rooftop pool",
  area_meeting_room:       "meeting room, conference room, or boardroom",
  // Views
  skyline_view:            "city skyline panoramic view",
  water_view:              "ocean, river, sea, or lake view",
  green_view:              "garden, park, or tree canopy view",
  courtyard_view:          "internal courtyard or atrium view",
  landmark_view:           "view of a famous landmark",
  high_floor:              "high floor with elevated views",
  street_level_view:       "street level ground floor room",
  balcony_furniture:       "outdoor furniture on balcony/terrace",
  privacy_sheers:          "privacy sheer curtains or voile",
  // Non-visual (need metadata) — included so LLM can route to them
  // even though they aren't extracted from photos yet
  soundproofing_high:      "well soundproofed, quiet interior, no noise bleed",
  quiet_street:            "quiet street outside, low ambient noise",
  noise_insulated_windows: "noise-insulating double/triple-glazed windows",
  wifi_quality_high:       "fast reliable high-speed WiFi",
  desk_large_enough:       "desk large enough for a laptop + monitor",
  video_call_friendly_lighting: "good lighting for video calls",
  bedside_outlets:         "electrical outlets / USB ports beside the bed",
  desk_level_outlets:      "power outlets at desk level",
  usb_c_ports:             "USB-C charging ports",
  firm_mattress_option:    "firm mattress option available",
  pet_friendly_room:       "pet-friendly room policy",
  family_suite_layout:     "family suite with multiple sleeping areas",
};

// Two-tier cache for NLP routing results:
//   L1 — per-instance in-memory LRU (`_nlpCache`)        — sub-ms
//   L2 — Postgres `v2_intent_cache` (shared across fleet) — ~30-80ms
// On a hit at either tier we return immediately and skip Gemini entirely.
// Gemini results are written through to both tiers; regex fallbacks are NOT
// cached (so the next attempt still tries LLM and may upgrade the intent).
const _nlpCache = new Map();
const NLP_CACHE_MAX = 2000;

function _lruSet(key, value) {
  if (_nlpCache.size >= NLP_CACHE_MAX) _nlpCache.delete(_nlpCache.keys().next().value);
  _nlpCache.set(key, value);
}

// Read the cached intent for `cacheKey` from Postgres. Returns null on miss
// or any error (we never let the cache lookup block the search). Fire-and-
// forget `touch` increments hit_count for analytics.
async function _readIntentFromDb(supabase, cacheKey) {
  if (!supabase || !cacheKey) return null;
  try {
    const { data, error } = await supabase
      .from("v2_intent_cache")
      .select("intent, router_version")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error || !data?.intent) return null;
    // Fire-and-forget hit counter
    supabase.rpc("v2_intent_cache_touch", { p_key: cacheKey }).then(() => {}, () => {});
    // Ensure the cached intent carries the router_version we recorded.
    return { ...data.intent, router_version: data.router_version || data.intent.router_version || "v2-llm-1" };
  } catch (_) {
    return null;
  }
}

// Write-through: upsert intent into v2_intent_cache. Fire-and-forget; failures
// are silent (the search has already returned by this point).
function _writeIntentToDb(supabase, cacheKey, intent) {
  if (!supabase || !cacheKey || !intent) return;
  const factCount =
    (intent.hard_filters?.length || 0) +
    (intent.soft_preferences?.length || 0);
  supabase
    .from("v2_intent_cache")
    .upsert(
      {
        cache_key:      cacheKey,
        intent,
        router_version: intent.router_version || "v2-llm-1",
        fact_count:     factCount,
        updated_at:     new Date().toISOString(),
      },
      { onConflict: "cache_key" }
    )
    .then(() => {}, () => {});
}

/**
 * Build fact intent using Gemini LLM to semantically map the query to
 * weighted facts. Falls back to regex-based buildFactIntent on failure.
 *
 * Caching:
 *  - L1 in-memory LRU (per Render instance)
 *  - L2 Postgres `v2_intent_cache` (shared across fleet) — when `opts.supabase`
 *    is provided. Cold-start LLM timeouts become a ONE-TIME event per unique
 *    query: the first successful LLM call writes through to Postgres, and
 *    every subsequent search anywhere in the fleet skips Gemini entirely.
 *
 * @param {string} query
 * @param {{ mustHaves?: string[], supabase?: object }} opts
 * @param {string} geminiKey
 * @returns {Promise<object>} intent object compatible with scoreFactSet
 */
async function buildFactIntentLLM(query, opts = {}, geminiKey = "") {
  const queryNorm = String(query || "").trim().toLowerCase();
  // Include mustHaves in the cache key so different must_haves get separate cache entries
  const sortedMH = [...(Array.isArray(opts.mustHaves) ? opts.mustHaves : [])].sort().join(",");
  const cacheKey = sortedMH ? `${queryNorm}|mh:${sortedMH}` : queryNorm;

  // L1 — in-memory LRU
  if (_nlpCache.has(cacheKey)) return _nlpCache.get(cacheKey);

  // L2 — Postgres-backed cache (shared across instances)
  if (opts.supabase) {
    const dbIntent = await _readIntentFromDb(opts.supabase, cacheKey);
    if (dbIntent) {
      _lruSet(cacheKey, dbIntent);
      return dbIntent;
    }
  }

  // Short or empty queries — skip LLM, use regex fallback (not persisted to L2)
  if (queryNorm.length < 4) return buildFactIntent(query, opts);

  // visual_style_* facts are injected by buildStayVibeIntent based on the boop
  // wizard's stayVibe answer, NOT from free-text query. Hide them from the LLM
  // prompt so it can't double-pick them (which would conflict with injection).
  const factLines = Object.entries(FACT_DESCRIPTIONS)
    .filter(([k]) => !k.startsWith("visual_style_"))
    .map(([k, desc]) => `${k}: ${desc}`)
    .join("\n");

  const prompt = [
    "You are a hotel room search engine. Given a user's search query, identify which room features are relevant.",
    "Return ONLY valid JSON mapping fact_key → relevance weight (0.0–1.0).",
    "Only include facts with weight >= 0.25. Return {} if no facts match.",
    "",
    `User query: "${cacheKey}"`,
    "",
    "Available facts (key: description):",
    factLines,
    "",
    "Rules:",
    "- Weight 0.9–1.0: explicitly requested, central to the query",
    "- Weight 0.6–0.8: strongly implied by the query",
    "- Weight 0.3–0.5: loosely related or contextually plausible",
    "- Include synonyms and semantically related concepts (e.g. 'quiet' → soundproofing_high, noise_insulated_windows, quiet_street)",
    "- Include style implications: 'romantic' → romantic_lighting, palette_moody, canopy_bed, soaking_tub, dimmable_lighting",
    "- Include work implications: 'remote work' / 'work from hotel' → ergonomic_workspace, desk_large_enough, wifi_quality_high, desk_level_outlets",
    "- Include style implications: 'minimalist' / 'modern clean' → palette_minimalist, high_natural_light, floor_to_ceiling_windows",
    "- Include mood implications: 'cozy' / 'warm' → warm_light_temp, palette_earth, area_rugs, dimmable_lighting",
    "- ALWAYS return at least 1 fact if the query describes a room style or preference",
    "",
    "Examples:",
    'Query "quiet room" → {"soundproofing_high":0.95,"noise_insulated_windows":0.80,"quiet_street":0.65}',
    'Query "romantic getaway" → {"romantic_lighting":0.90,"palette_moody":0.70,"canopy_bed":0.60,"soaking_tub":0.55,"dimmable_lighting":0.50}',
    'Query "modern minimalist clean design" → {"palette_minimalist":0.90,"high_natural_light":0.70,"floor_to_ceiling_windows":0.65,"hardwood_parquet":0.40}',
    'Query "bright airy room" → {"high_natural_light":0.95,"floor_to_ceiling_windows":0.80,"open_plan":0.40}',
    'Query "double sinks luxury bathroom" → {"double_sinks":0.95,"soaking_tub":0.65,"stone_surfaces":0.55,"tub_and_shower_separate":0.40}',
    "Return ONLY JSON, no explanation, no markdown.",
  ].join("\n");

  try {
    // Tight timeout: typical Gemini-flash-lite response is 300-1500ms. When
    // Gemini is degraded, we'd rather fall back to the deterministic regex
    // router (good-enough for most queries) than block the user 10s. Override
    // via NLP_INTENT_TIMEOUT_MS env if needed.
    const timeoutMs = parseInt(process.env.NLP_INTENT_TIMEOUT_MS || "3000", 10);
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 500, temperature: 0 },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    if (!r.ok) throw new Error(`Gemini ${r.status}`);
    const d = await r.json();
    const raw = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "{}";
    const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] || "{}";
    const weights = JSON.parse(jsonStr);

    const mustHaves = Array.isArray(opts.mustHaves) ? opts.mustHaves : [];
    const hard = new Map();
    const soft = new Map();

    // Explicit must-haves always become hard filters
    for (const k of mustHaves) {
      if (FACT_SET.has(k)) hard.set(k, { fact_key: k, value: true, confidence: 0.95, source: "must_haves" });
    }

    // LLM-weighted soft preferences (skip if already a hard filter)
    for (const [k, w] of Object.entries(weights)) {
      if (!FACT_SET.has(k) || hard.has(k)) continue;
      const weight = clamp01(Number(w) || 0);
      if (weight >= 0.25) {
        soft.set(k, { fact_key: k, weight, direction: "prefer" });
      }
    }

    const intent = {
      hard_filters:        [...hard.values()],
      soft_preferences:    [...soft.values()],
      negative_preferences: [],
      strict_mode:         false,
      router_version:      "v2-llm-1",
    };

    // Write-through to both cache tiers. L1 is sync, L2 is fire-and-forget.
    _lruSet(cacheKey, intent);
    _writeIntentToDb(opts.supabase, cacheKey, intent);
    return intent;

  } catch (_err) {
    // LLM failed — fall back to regex-based routing silently. We deliberately
    // do NOT cache the regex result so the next call will retry the LLM. The
    // search-time path also augments thin intents with stayVibe-implied
    // supporting facts (see mergeStayVibeIntoIntent below) so the user still
    // gets a multi-fact ranking even on a cold cache + LLM failure.
    return buildFactIntent(query, opts);
  }
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function triValueFromBool(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  return -1;
}

function buildFactIntent(query, opts = {}) {
  const text = String(query || "").toLowerCase();
  const mustHaves = Array.isArray(opts.mustHaves) ? opts.mustHaves : [];
  const hard = new Map();
  const soft = new Map();
  const negatives = new Map();

  for (const k of mustHaves) {
    if (FACT_SET.has(k)) hard.set(k, { fact_key: k, value: true, confidence: 0.95, source: "must_haves" });
  }

  for (const row of FACT_SYNONYMS) {
    if (row.rx.test(text)) {
      // If already a hard filter (from must_haves), don't double-count as soft.
      if (hard.has(row.fact)) continue;
      const phrase = text.match(row.rx)?.[0] || "";
      const isHard = /\bmust\b|\bneed\b|\brequire\b|\bonly\b/.test(text);
      const isNegative = /\bno\b|\bwithout\b|\bavoid\b/.test(text.slice(Math.max(0, text.indexOf(phrase) - 18), text.indexOf(phrase) + phrase.length + 18));
      if (isNegative) {
        negatives.set(row.fact, { fact_key: row.fact, weight: 0.8, direction: "avoid" });
      } else if (isHard) {
        hard.set(row.fact, { fact_key: row.fact, value: true, confidence: 0.85, source: "nlp" });
      } else {
        soft.set(row.fact, { fact_key: row.fact, weight: 0.7, direction: "prefer" });
      }
    }
  }

  if (/\b(simple|good value|value|affordable|budget|economical)\b/.test(text)) {
    if (!hard.has("palette_minimalist")) soft.set("palette_minimalist", { fact_key: "palette_minimalist", weight: 0.45, direction: "prefer" });
    if (!hard.has("ergonomic_workspace")) soft.set("ergonomic_workspace", { fact_key: "ergonomic_workspace", weight: 0.35, direction: "prefer" });
  }

  return {
    hard_filters: [...hard.values()],
    soft_preferences: [...soft.values()],
    negative_preferences: [...negatives.values()],
    strict_mode: false,
    router_version: "v2-facts-1",
  };
}

function scoreFactSet(features, intent) {
  const src = features || {};
  const has = (k) => src[k] === true;
  const hard = intent.hard_filters || [];
  const soft = intent.soft_preferences || [];
  const neg = intent.negative_preferences || [];

  let hardHit = 0;
  for (const h of hard) if (has(h.fact_key)) hardHit++;
  const hardRatio = hard.length ? hardHit / hard.length : 1;

  let softScore = 0;
  let softWeight = 0;
  for (const s of soft) {
    const w = clamp01(s.weight || 0.5);
    softWeight += w;
    if (has(s.fact_key)) softScore += w;
  }
  const softRatio = softWeight > 0 ? softScore / softWeight : 0.5;

  let negPenalty = 0;
  for (const n of neg) {
    if (has(n.fact_key)) negPenalty += clamp01(n.weight || 0.5);
  }
  const negRatio = neg.length ? Math.min(1, negPenalty / neg.length) : 0;
  const severePenalty = hard.length ? (1 - 0.85 * (1 - hardRatio)) : 1;

  const total = Math.max(0, (0.55 * softRatio + 0.45 * hardRatio) * severePenalty - (0.25 * negRatio));
  return {
    hard_ratio: hardRatio,
    soft_ratio: softRatio,
    negative_ratio: negRatio,
    total_score: clamp01(total),
  };
}

function extractFactsFromSignals({ featureFlags = {}, featureSummary = "", caption = "", roomName = "", photoType = "" } = {}) {
  const factMap = new Map();
  const text = `${featureSummary}\n${caption}\n${roomName}\n${photoType}`.toLowerCase();
  const setFact = (fact, val = true, conf = 0.8, source = "vision") => {
    if (!FACT_SET.has(fact)) return;
    const prev = factMap.get(fact);
    if (!prev || (Number(conf) || 0) > prev.confidence) {
      factMap.set(fact, { fact_key: fact, fact_value: triValueFromBool(val), confidence: clamp01(conf), source });
    }
  };

  for (const [k, v] of Object.entries(featureFlags || {})) {
    if (v === true && FACT_SET.has(k)) setFact(k, true, 0.9, "vision");
  }
  for (const row of FACT_SYNONYMS) {
    if (row.rx.test(text)) setFact(row.fact, true, 0.72, "vision");
  }

  return [...factMap.values()];
}

// ── Structured-caption parser (v2 prompt redesign) ──────────────────────────
// Maps the direct YES/NO/UNKNOWN fields in the new Gemini prompt to fact_keys.
// Field names must match exactly what the prompt asks for (uppercase with underscores).
const STRUCTURED_FIELD_TO_FACT = {
  // ── Bathroom ──────────────────────────────────────────────────────────────
  DOUBLE_SINKS:            "double_sinks",
  SOAKING_TUB:             "soaking_tub",
  BATHTUB:                 "bathtub",
  RAINFALL_SHOWER:         "rainfall_shower",
  WALK_IN_SHOWER:          "walk_in_shower",
  HANDHELD_SHOWER_WAND:    "handheld_wand",
  GLASS_BATHROOM_WALL:     "glass_wall_bathroom",
  STONE_BATHROOM_SURFACES: "stone_surfaces",
  NATURAL_LIGHT_BATHROOM:  "natural_light_bathroom",
  HEATED_TOWEL_RAIL:       "heated_towel_rack",
  BIDET:                   "bidet_washlet",
  SEPARATE_TOILET_DOOR:    "separate_toilet_door",
  ANTI_FOG_MIRROR:         "anti_fog_mirror",
  MAKEUP_VANITY:           "makeup_vanity",
  TUB_AND_SHOWER_SEPARATE: "tub_and_shower_separate",
  COUNTER_SPACE_GENEROUS:  "counter_space_generous",
  ROLL_IN_SHOWER:          "roll_in_shower",
  GRAB_BARS:               "grab_bars",
  // ── Bedroom / layout ──────────────────────────────────────────────────────
  KING_BED:                "king_bed",
  CANOPY_BED:              "canopy_bed",
  FLOOR_TO_CEILING_WINDOWS:"floor_to_ceiling_windows",
  PRIVATE_BALCONY:         "private_balcony",
  JULIETTE_BALCONY:        "juliette_balcony",
  HIGH_CEILINGS:           "high_ceilings",
  OPEN_PLAN:               "open_plan",
  LOFT_LAYOUT:             "loft_layout",
  WALK_IN_CLOSET:          "walk_in_closet",
  KITCHENETTE:             "kitchenette",
  SWIM_UP_ACCESS:          "swim_up_access",
  SOFA_BED:                "sofa_bed",
  DAYBED_WINDOW_NOOK:      "daybed_window_nook",
  DINING_TABLE:            "dining_table_in_room",
  FULL_LENGTH_MIRROR:      "full_length_mirror",
  DIVIDED_SEATING:         "divided_seating",
  // ── Flooring & surfaces ───────────────────────────────────────────────────
  HARDWOOD_FLOOR:          "hardwood_parquet",
  STONE_MARBLE_FLOOR:      "stone_tile_floor",
  POLISHED_CONCRETE_FLOOR: "polished_concrete",
  CARPET_FLOOR:            "wall_to_wall_carpet",
  AREA_RUGS:               "area_rugs",
  STATEMENT_WALLPAPER:     "statement_wallpaper",
  EXPOSED_BRICK:           "exposed_brick",
  EXPOSED_WOOD_BEAMS:      "exposed_wood",
  // ── Amenities (visible) ───────────────────────────────────────────────────
  WORK_DESK:               "ergonomic_workspace",
  ESPRESSO_MACHINE:        "espresso_station",
  INDOOR_PLANTS:           "indoor_plants",
  COCKTAIL_BAR_STATION:    "cocktail_station",
  MINI_FRIDGE:             "mini_fridge",
  MICROWAVE:               "microwave",
  LAUNDRY_IN_ROOM:         "laundry_in_room",
  RECORD_PLAYER:           "record_player",
  SMART_CONTROLS:          "smart_controls",
  INDIVIDUAL_THERMOSTAT:   "individual_thermostat",
  CEILING_FAN:             "ceiling_fan",
  // ── Light & mood ──────────────────────────────────────────────────────────
  HIGH_NATURAL_LIGHT:      "high_natural_light",
  DIMMABLE_LIGHTING:       "dimmable_lighting",
  WARM_LIGHTING:           "warm_light_temp",
  ACCENT_COVE_LIGHTING:    "accent_cove_lighting",
  FLOOR_LAMPS:             "floor_lamps",
  READING_LIGHTS:          "reading_lights",
  BLACKOUT_SHUTTERS:       "blackout_shutters",
  STATEMENT_FIXTURE:       "statement_fixture",
  ROMANTIC_LIGHTING:       "romantic_lighting",
  // ── Style ─────────────────────────────────────────────────────────────────
  MINIMALIST_STYLE:        "palette_minimalist",
  MOODY_DARK_STYLE:        "palette_moody",
  EARTH_TONE_PALETTE:      "palette_earth",
  VIBRANT_COLORFUL:        "palette_vibrant",
  ORGANIC_WOOD_HEAVY:      "organic_wood_heavy",
  MID_CENTURY_MODERN:      "mid_century_modern",
  VINTAGE_FURNITURE:       "vintage_furniture",
  // ── Visual style enum (mutex; Gemini picks exactly one as `yes`) ──────────
  VISUAL_STYLE_SLEEK_POLISHED:    "visual_style_sleek_polished",
  VISUAL_STYLE_COZY_WARM:         "visual_style_cozy_warm",
  VISUAL_STYLE_VIBRANT_ECLECTIC:  "visual_style_vibrant_eclectic",
  VISUAL_STYLE_MOODY_DARK:        "visual_style_moody_dark",
  VISUAL_STYLE_CLASSIC_TRADITIONAL: "visual_style_classic_traditional",
  // ── Hotel public-area presence (non-mutex; only emitted by hotel-public photo
  // pipeline, not by room photos). The same FIELD_NAME → fact_key mapping works
  // because parseStructuredCaption is photo-source agnostic.
  AREA_LOBBY:              "area_lobby",
  AREA_POOL:               "area_pool",
  AREA_RESTAURANT:         "area_restaurant",
  AREA_BAR:                "area_bar",
  AREA_GYM:                "area_gym",
  AREA_SPA:                "area_spa",
  AREA_EXTERIOR:           "area_exterior",
  AREA_COURTYARD_GARDEN:   "area_courtyard_garden",
  AREA_ROOFTOP:            "area_rooftop",
  AREA_MEETING_ROOM:       "area_meeting_room",
  // ── Views & context ───────────────────────────────────────────────────────
  SKYLINE_VIEW:            "skyline_view",
  WATER_VIEW:              "water_view",
  GREEN_VIEW:              "green_view",
  COURTYARD_VIEW:          "courtyard_view",
  LANDMARK_VIEW:           "landmark_view",
  HIGH_FLOOR:              "high_floor",
  STREET_LEVEL_VIEW:       "street_level_view",
  BALCONY_FURNITURE:       "balcony_furniture",
  PRIVACY_SHEERS:          "privacy_sheers",
};

/**
 * Parse a structured Gemini caption (v2 format) into fact objects.
 * Each line: FIELD_NAME: yes|no|unknown
 * Only `yes` lines produce fact_value=1 (true).
 * `no` lines produce fact_value=0 for high-signal bathroom facts (allows
 * explicit absence recording). `unknown` is ignored.
 */
const HIGH_SIGNAL_NEGATIVES = new Set([
  "double_sinks","soaking_tub","rainfall_shower","walk_in_shower",
  "private_balcony","floor_to_ceiling_windows",
]);

function parseStructuredCaption(caption) {
  if (!caption) return [];
  const facts = [];
  for (const raw of caption.split("\n")) {
    const line = raw.trim();
    const m = line.match(/^([A-Z_]+):\s*(yes|no|unknown)\s*$/i);
    if (!m) continue;
    const fieldKey = m[1].toUpperCase();
    const val = m[2].toLowerCase();
    const factKey = STRUCTURED_FIELD_TO_FACT[fieldKey];
    if (!factKey) continue;
    if (val === "yes") {
      facts.push({ fact_key: factKey, fact_value: 1, confidence: 0.88, source: "vision_structured" });
    } else if (val === "no" && HIGH_SIGNAL_NEGATIVES.has(factKey)) {
      facts.push({ fact_key: factKey, fact_value: 0, confidence: 0.85, source: "vision_structured" });
    }
    // "unknown" → skip
  }
  return facts;
}

// ── Visual style enum (mutex classification) ────────────────────────────────
// Five-bucket enum stored as 5 boolean fact_keys (exactly one true per photo).
// Aggregated at room level by `rebuild_v2_room_types_index_city` via the same
// yes_count ≥ 1 / no_count ≥ 2 rule as other facts. The Boop wizard's stayVibe
// answer maps 1:1 to one of these via STAY_VIBE_TO_VISUAL_STYLE so search can
// inject a soft preference without depending on free-text LLM extraction.
const VISUAL_STYLE_FACT_KEYS = [
  "visual_style_sleek_polished",
  "visual_style_cozy_warm",
  "visual_style_vibrant_eclectic",
  "visual_style_moody_dark",
  "visual_style_classic_traditional",
];

const STAY_VIBE_TO_VISUAL_STYLE = {
  sleek_polished:      "visual_style_sleek_polished",
  cozy_warm:           "visual_style_cozy_warm",
  vibrant_eclectic:    "visual_style_vibrant_eclectic",
  distinct_unique:     "visual_style_vibrant_eclectic", // legacy boop label
  simple_value:        "visual_style_sleek_polished", // value stays lean/modern, not boutique-eclectic
  moody_dark:          "visual_style_moody_dark",
  classic_traditional: "visual_style_classic_traditional",
};

// Supporting facts to inject as soft preferences when intent is "thin" (e.g.
// when the LLM router timed out and only the regex `area_*` / visual_style
// facts came through). Mirrors what the LLM would normally emit for the same
// stayVibe so users don't get a 1-fact ranking when Gemini is degraded.
//
// Weights are intentionally LOWER than the visual_style fact (0.9) so the
// canonical style signal still dominates — these are supporting context,
// not replacements. Selected to be facts that ARE present in v2_room_types_index
// (i.e. confirmed via the indexer's caption analysis), not lab-only flags.
const STAY_VIBE_SUPPORTING_FACTS = {
  sleek_polished: [
    { fact_key: "palette_minimalist",       weight: 0.55 },
    { fact_key: "polished_concrete",        weight: 0.40 },
    { fact_key: "floor_to_ceiling_windows", weight: 0.40 },
    { fact_key: "high_natural_light",       weight: 0.40 },
    { fact_key: "hardwood_parquet",         weight: 0.35 },
    { fact_key: "statement_fixture",        weight: 0.30 },
  ],
  cozy_warm: [
    { fact_key: "warm_light_temp",   weight: 0.55 },
    { fact_key: "palette_earth",     weight: 0.50 },
    { fact_key: "area_rugs",         weight: 0.45 },
    { fact_key: "dimmable_lighting", weight: 0.35 },
    { fact_key: "indoor_plants",     weight: 0.30 },
  ],
  vibrant_eclectic: [
    { fact_key: "palette_vibrant",      weight: 0.55 },
    { fact_key: "statement_wallpaper",  weight: 0.45 },
    { fact_key: "vintage_furniture",    weight: 0.40 },
    { fact_key: "mid_century_modern",   weight: 0.35 },
    { fact_key: "textured_upholstery",  weight: 0.30 },
  ],
  distinct_unique: [
    { fact_key: "palette_vibrant",      weight: 0.55 },
    { fact_key: "statement_wallpaper",  weight: 0.45 },
    { fact_key: "vintage_furniture",    weight: 0.40 },
    { fact_key: "mid_century_modern",   weight: 0.35 },
    { fact_key: "textured_upholstery",  weight: 0.30 },
  ],
  simple_value: [
    { fact_key: "palette_minimalist",       weight: 0.60 },
    { fact_key: "ergonomic_workspace",      weight: 0.35 },
    { fact_key: "high_natural_light",       weight: 0.30 },
  ],
  moody_dark: [
    { fact_key: "palette_moody",         weight: 0.55 },
    { fact_key: "accent_cove_lighting",  weight: 0.45 },
    { fact_key: "romantic_lighting",     weight: 0.40 },
    { fact_key: "blackout_shutters",     weight: 0.35 },
    { fact_key: "exposed_brick",         weight: 0.30 },
  ],
  classic_traditional: [
    { fact_key: "canopy_bed",          weight: 0.50 },
    { fact_key: "vintage_furniture",   weight: 0.45 },
    { fact_key: "palette_earth",       weight: 0.40 },
    { fact_key: "stone_surfaces",      weight: 0.35 },
    { fact_key: "high_ceilings",       weight: 0.30 },
  ],
};

/**
 * Return an intent fragment expressing the user's stayVibe preference as a
 * strong soft preference for the matching visual_style fact. Returns null when
 * stayVibe is unset or unknown. Intended to be merged into the intent returned
 * by buildFactIntentLLM/buildFactIntent BEFORE scoring.
 *
 *   weight 0.9 — strong enough to materially shift ranking, not a hard filter
 *   (so a non-matching room can still surface if other facts compensate).
 */
function buildStayVibeIntent(stayVibe) {
  if (!stayVibe || typeof stayVibe !== "string") return null;
  const factKey = STAY_VIBE_TO_VISUAL_STYLE[stayVibe.toLowerCase()];
  if (!factKey || !FACT_SET.has(factKey)) return null;
  return {
    fact_key: factKey,
    weight: 0.9,
    direction: "prefer",
    source: "boop_stayvibe",
  };
}

/**
 * Merge a stayVibe-derived soft preference into an existing intent without
 * mutating callers' references. The new soft pref is appended; if the same
 * fact_key already exists, the higher weight wins.
 *
 * Also injects STAY_VIBE_SUPPORTING_FACTS when the intent is "thin" — i.e.
 * came from the regex fallback router (no LLM-suggested facts) and would
 * otherwise have only the single visual_style fact. This protects ranking
 * quality when Gemini times out: users still get a multi-fact intent that
 * approximates what the LLM would have emitted.
 *
 * Thinness is detected via `intent.router_version === 'v2-facts-1'` (the
 * regex router's marker) OR an empty soft_preferences list. Supporting
 * facts are only added when the slot is empty — existing weights win.
 */
function mergeStayVibeIntoIntent(intent, stayVibe) {
  const frag = buildStayVibeIntent(stayVibe);
  if (!frag) return intent;

  const soft = [...(intent.soft_preferences || [])];

  // 1) Inject (or upgrade) the canonical visual_style fact for this stayVibe.
  const existing = soft.findIndex((s) => s.fact_key === frag.fact_key);
  if (existing >= 0) {
    if ((frag.weight || 0) > (soft[existing].weight || 0)) soft[existing] = frag;
  } else {
    soft.push(frag);
  }

  // 2) When intent is thin (regex fallback or near-empty), augment with
  //    stayVibe-implied supporting facts so ranking has real signal even
  //    when the LLM router missed.
  const isThin =
    (intent.router_version === "v2-facts-1") ||
    ((intent.soft_preferences?.length || 0) === 0);
  if (isThin) {
    const supporting = STAY_VIBE_SUPPORTING_FACTS[String(stayVibe || "").toLowerCase()] || [];
    const have = new Set(soft.map((s) => s.fact_key));
    for (const sf of supporting) {
      if (have.has(sf.fact_key)) continue;
      if (!FACT_SET.has(sf.fact_key)) continue;
      soft.push({
        fact_key:  sf.fact_key,
        weight:    sf.weight,
        direction: "prefer",
        source:    "boop_stayvibe_supporting",
      });
      have.add(sf.fact_key);
    }
  }

  return { ...intent, soft_preferences: soft };
}

/**
 * Minimal prompt for the visual_style classifier-only backfill script. Returns
 * a single label on its own line so the parser doesn't need to handle the full
 * structured-caption format. Used by scripts/classify-visual-style.js.
 *
 * Design goals (v2-vs-2):
 *  - LEAN TOWARD `unknown`. The prior prompt (v2-vs-1) tagged ~67% of all MX
 *    City hotels as sleek_polished because "neutral palette" and "modern"
 *    were interpreted generously. The new prompt requires multiple positive
 *    signals AND explicit exclusion criteria for the dominant bucket, and
 *    says "unknown" is correct for plain/generic rooms.
 *  - Each category lists what it IS plus what DISQUALIFIES it. This forces
 *    real discrimination instead of "everything contemporary = sleek".
 *  - One label per line, no prose. The parser only reads the first word.
 */
function buildVisualStyleClassifierPrompt(photoContext = {}) {
  return [
    "Classify this hotel room photo's PRIMARY visual style. Lean toward `unknown` when in doubt.",
    "",
    "Reply with EXACTLY ONE of the labels below on its own. No explanation, no markdown.",
    "",
    "LABELS:",
    "",
    "sleek_polished — High-end modern hotel aesthetic. REQUIRES at least TWO of:",
    "  • polished surfaces dominate (marble, stone, glass, gloss-painted millwork, mirror)",
    "  • crisp architectural lines and an uncluttered, deliberately curated layout",
    "  • monochrome / restrained palette (whites, greys, blacks, with at most one accent)",
    "  • obviously contemporary, recent fit-out (post-2015 design language)",
    "  DISQUALIFIES: visible warm-toned wood headboards or wardrobes dominating the frame,",
    "  printed/colourful bedspreads, dated furniture, ornate trim, brown/beige earth-tone",
    "  walls, plain budget-hotel rooms with bare painted walls and basic furniture.",
    "",
    "cozy_warm — Warm, traditional, lived-in feel. REQUIRES at least TWO of:",
    "  • warm-tone palette dominates (brown / beige / cream / terracotta / honey wood)",
    "  • soft layered textiles (throws, rugs, patterned cushions, upholstered headboard)",
    "  • traditional or homey furnishings (curved wood furniture, table lamps, framed art)",
    "  DISQUALIFIES: clinical or minimalist look, dark moody walls, bold saturated colours.",
    "",
    "vibrant_eclectic — Bold designer personality. REQUIRES at least ONE of:",
    "  • saturated bold wall colour (teal, pink, mustard, emerald, etc.) on a primary wall",
    "  • strong graphic pattern dominating (wallpaper, headboard, large statement art)",
    "  • intentionally mixed eras / quirky designer furnishings",
    "  DISQUALIFIES: subdued neutral schemes, generic budget rooms.",
    "",
    "moody_dark — Dark and dramatic. REQUIRES BOTH:",
    "  • dominant dark walls or finishes (navy / charcoal / black / dark forest)",
    "  • dim, dramatic, low-key lighting (not just a dark photo of a light room)",
    "  DISQUALIFIES: light/white walls regardless of how the photo was lit.",
    "",
    "classic_traditional — Formal heritage / grand-hotel decor. REQUIRES at least TWO of:",
    "  • ornate mouldings, cornicing, panelling, or chandelier-style fittings",
    "  • antique-style furniture (carved wood, gilt accents, claw-foot legs)",
    "  • brocade / damask / tufted upholstery, formal drapery",
    "  DISQUALIFIES: contemporary minimalist look, modern bedside USB outlets dominant.",
    "",
    "unknown — REPLY THIS when the photo:",
    "  • is not a room interior (exterior, lobby, map, food, amenity, plan view)",
    "  • is a generic budget / 3-star room with plain painted walls and basic furniture",
    "    that doesn't clearly satisfy the criteria above for ANY single label",
    "  • is too cropped, too dark, or too low-quality to assess",
    "  • shows multiple styles equally without a dominant aesthetic",
    "",
    `Context: room="${photoContext.roomName || "unknown"}" type="${photoContext.type || "other"}"`,
    "",
    "Reply with one label only.",
  ].join("\n");
}

/** Parse the classifier's one-line reply into a fact_key (or null). */
function parseVisualStyleReply(text) {
  if (!text) return null;
  const m = String(text).trim().toLowerCase().match(/^[a-z_]+/);
  if (!m) return null;
  const label = m[0];
  if (label === "unknown") return null;
  const factKey = `visual_style_${label}`;
  return FACT_SET.has(factKey) ? factKey : null;
}

// ── Hotel public-area classifier (Phase 1b: hotel-vibe scoring) ─────────────
// Public photos come from `v2_hotels_cache.hotel_photos` (lobbies, pools, bars,
// exteriors, etc.). They are NEVER guest-room interiors. Two parallel signals
// are extracted per photo:
//   1. `area_*` (NON-mutex)  — which kind of public space is in the frame.
//      Multiple can be true on the same photo (rooftop bar = rooftop + bar).
//   2. `visual_style_*` (MUTEX) — same five buckets as room photos so the
//      stayVibe injection works identically across rooms and public areas.
const AREA_FACT_KEYS = [
  "area_lobby","area_pool","area_restaurant","area_bar","area_gym",
  "area_spa","area_exterior","area_courtyard_garden","area_rooftop","area_meeting_room",
];
const AREA_LABEL_TO_FACT = Object.fromEntries(
  AREA_FACT_KEYS.map((k) => [k.replace(/^area_/, ""), k])
);

/**
 * Minimal prompt for the hotel public-area classifier backfill script. Returns
 * two structured lines so a tiny parser can extract both signals deterministically.
 * Used by scripts/classify-hotel-public.js.
 *
 * Design goals:
 *  - `AREAS:` is multi-select. A rooftop bar legitimately occupies both
 *    `area_rooftop` and `area_bar`. List every area visible in the frame.
 *  - `STYLE:` reuses the same strict criteria as room photos so the aesthetic
 *    signal is comparable across rooms and public areas.
 *  - Lean toward `unknown` STYLE for plain generic lobbies / utility spaces;
 *    lean toward `none` AREAS for genuinely unrecognisable photos.
 *  - One photo, one reply, two lines. Parser tolerates whitespace and case.
 */
function buildHotelPublicClassifierPrompt(photoContext = {}) {
  return [
    "This is a HOTEL PUBLIC-AREA photo (lobby, pool, bar, restaurant, gym, spa,",
    "exterior, courtyard, rooftop, or meeting room). It is NEVER a guest-room",
    "interior — guest rooms are classified by a separate prompt.",
    "",
    "Reply with EXACTLY TWO lines, no other text:",
    "",
    "LINE 1 (AREAS, multi-select):",
    "  AREAS: <comma-separated list, one or more of the following labels>",
    "  Labels: lobby, pool, restaurant, bar, gym, spa, exterior,",
    "          courtyard_garden, rooftop, meeting_room",
    "  Pick EVERY label that is clearly visible in this frame. Examples:",
    "    rooftop bar with city view              → AREAS: rooftop,bar",
    "    pool deck with sunbeds                   → AREAS: pool",
    "    indoor restaurant with bar counter       → AREAS: restaurant,bar",
    "    front desk + lounge seating              → AREAS: lobby",
    "    facade of building from street           → AREAS: exterior",
    "    landscaped patio between two buildings   → AREAS: courtyard_garden",
    "  If no labeled area is recognisable, reply: AREAS: none",
    "",
    "LINE 2 (STYLE, single mutex):",
    "  STYLE: <one of: sleek_polished | cozy_warm | vibrant_eclectic | moody_dark | classic_traditional | unknown>",
    "  Apply the SAME strict criteria as for room photos (REQUIRES + DISQUALIFIES",
    "  per category). Lean toward `unknown` for plain corporate-lobby /",
    "  utility-corridor spaces, food close-ups, or low-quality crops. A photo",
    "  showing only the exterior facade or only a sign should usually be STYLE: unknown.",
    "",
    `Context: room="${photoContext.roomName || "__hotel_public__"}" type="${photoContext.type || "other"}"`,
    "",
    "Reply with exactly two lines: AREAS: ...   and   STYLE: ...",
  ].join("\n");
}

/**
 * Parse the hotel-public classifier reply. Returns:
 *   { areas: ["lobby", "bar"], visualStyle: "visual_style_sleek_polished" | null }
 * `areas` is always an array of fact_keys (possibly empty when "none"). The
 * function is forgiving about case, surrounding text, and missing lines.
 */
function parseHotelPublicReply(text) {
  if (!text) return { areas: [], visualStyle: null };
  const lines = String(text).split(/\r?\n/);
  let areaLine = "";
  let styleLine = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (/^areas\s*:/i.test(line))  areaLine  = line.replace(/^areas\s*:\s*/i,  "");
    if (/^style\s*:/i.test(line))  styleLine = line.replace(/^style\s*:\s*/i,  "");
  }
  const areas = [];
  if (areaLine && !/^none\b/i.test(areaLine) && !/^unknown\b/i.test(areaLine)) {
    for (const raw of areaLine.split(",")) {
      const label = raw.trim().toLowerCase().replace(/[^a-z_]/g, "");
      if (!label) continue;
      const factKey = AREA_LABEL_TO_FACT[label];
      if (factKey) areas.push(factKey);
    }
  }
  let visualStyle = null;
  if (styleLine) {
    const m = styleLine.trim().toLowerCase().match(/^[a-z_]+/);
    if (m && m[0] !== "unknown") {
      const fk = `visual_style_${m[0]}`;
      if (FACT_SET.has(fk)) visualStyle = fk;
    }
  }
  return { areas: [...new Set(areas)], visualStyle };
}

module.exports = {
  FACT_CATALOG,
  FACT_SET,
  FACT_DESCRIPTIONS,
  STRUCTURED_FIELD_TO_FACT,
  VISUAL_STYLE_FACT_KEYS,
  STAY_VIBE_TO_VISUAL_STYLE,
  buildFactIntent,
  buildFactIntentLLM,
  buildStayVibeIntent,
  mergeStayVibeIntoIntent,
  buildVisualStyleClassifierPrompt,
  parseVisualStyleReply,
  AREA_FACT_KEYS,
  AREA_LABEL_TO_FACT,
  buildHotelPublicClassifierPrompt,
  parseHotelPublicReply,
  extractFactsFromSignals,
  parseStructuredCaption,
  scoreFactSet,
};
