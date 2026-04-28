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
  { fact: "high_natural_light", rx: /\bnatural light\b|\bbright\b|\bsunlit\b/i },
  { fact: "palette_minimalist", rx: /\bminimalist\b|\bclean lines\b|\bsimple\b/i },
  { fact: "palette_moody", rx: /\bmoody\b|\bdark tones?\b/i },
  { fact: "palette_earth", rx: /\bearth tones?\b|\bnatural palette\b/i },
  { fact: "palette_vibrant", rx: /\bvibrant\b|\bcolorful\b|\beclectic\b/i },
  { fact: "king_bed", rx: /\bking bed\b|\bking-size bed\b/i },
  { fact: "water_view", rx: /\bwater view\b|\bocean view\b|\bsea view\b|\briver view\b/i },
  { fact: "skyline_view", rx: /\bskyline view\b|\bcity lights\b/i },
  { fact: "landmark_view", rx: /\blandmark view\b|\beiffel\b|\biconic view\b/i },
  { fact: "quiet_street", rx: /\bquiet\b|\bpeaceful\b|\btranquil\b/i },
  { fact: "nightlife_noise_risk", rx: /\bnoisy\b|\bnightlife\b|\bloud\b/i },
  { fact: "wifi_quality_high", rx: /\bfast wifi\b|\bgood wifi\b|\breliable wifi\b/i },
  { fact: "step_free_access", rx: /\bstep[- ]free\b|\baccessible\b/i },
];

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
    soft.set("palette_minimalist", { fact_key: "palette_minimalist", weight: 0.45, direction: "prefer" });
    soft.set("ergonomic_workspace", { fact_key: "ergonomic_workspace", weight: 0.35, direction: "prefer" });
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

module.exports = {
  FACT_CATALOG,
  FACT_SET,
  buildFactIntent,
  extractFactsFromSignals,
  scoreFactSet,
};
