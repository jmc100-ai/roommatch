/**
 * Boop wizard profile + seed builders (Node). Keep in sync with client/app.js BOOP v5 block.
 */

const STAY_VIBE_DERIVED = {
  sleek_polished: { roomStyle: "sleek", hotelPersonality: "polished" },
  cozy_warm: { roomStyle: "cozy", hotelPersonality: "unique" },
  distinct_unique: { roomStyle: "distinct", hotelPersonality: "unique" },
  simple_value: { roomStyle: "sleek", hotelPersonality: "economical" },
};

const {
  MUSTHAVE_CHIP_SPECS,
  buildMustHaveSpecFromDealbreakers,
  flattenMustHavesForUrl,
} = require("./must-have-spec");

/** @deprecated use MUSTHAVE_CHIP_SPECS — kept for tests importing MUSTHAVE_OPTIONS */
const MUSTHAVE_OPTIONS = MUSTHAVE_CHIP_SPECS.map((c) => ({
  id: c.id,
  flag: c.fact || null,
  orFacts: c.orFacts,
  seed: c.seed,
  label: c.label,
}));

const NBHD_SCENE_WEIGHTS = {
  buzz_central: { iconic: 18, culture: 14, central: 20, nightlife: 12, walkability: 10, calm: -10, local: -2, luxury: -8 },
  calm_central: { luxury: 28, shopping: 14, calm: 14, central: 4, walkability: 10, nightlife: -14, iconic: 2, local: 2 },
  hip_local: { local: 26, cafes: 16, restaurants: 12, nightlife: 14, walkability: 12, central: -12, calm: -2, iconic: -18, touristy: -18, luxury: -10 },
  leafy_local: { calm: 24, green: 24, local: 20, nightlife: -18, iconic: -18, central: -16, luxury: -14, touristy: -12, shopping: -6, cafes: 10, walkability: 6 },
  scenic_open: { central: 20, walkability: 16, calm: 8, iconic: 10, green: 4, nightlife: -4 },
};

const NBHD_SCENE_SEEDS = {
  buzz_central: { pace: "vibrant", location: "central" },
  calm_central: { pace: "quiet", location: "upscale" },
  hip_local: { pace: "vibrant", location: "trendy" },
  leafy_local: { pace: "quiet", location: "residential" },
  scenic_open: { pace: "moderate", location: "central" },
};

const BOOP_RECONCILE_KEYS = ["central", "local", "nightlife", "calm"];

const NBHD_PACE_HOTEL_SNIPPETS = {
  vibrant: "vibrant busy street, cafés, shops, movement and buzz outside",
  quiet: "quiet residential streets, leafy, calm, local pace outside",
};
const NBHD_LOCATION_HOTEL_SNIPPETS = {
  central: "popular central area, close to iconic sights, easy sightseeing access",
  trendy: "trendy local pocket, authentic neighborhood feel away from tourist crowds",
  scenic: "scenic open area, skyline and water views, breathing room, resort or waterfront destination feel",
};

function resolveNbhdScene(answers) {
  if (!answers) return "leafy_local";
  const id = answers.nbhdScene;
  if (id && NBHD_SCENE_SEEDS[id]) return id;
  return "leafy_local";
}

function migrateBoopProfileAnswersIfNeeded(answers) {
  if (!answers || typeof answers !== "object") return answers;
  const a = { ...answers };
  if (!a.stayVibe) {
    if (a.hotelPersonality === "economical") a.stayVibe = "simple_value";
    else if (a.roomStyle === "distinct") a.stayVibe = "distinct_unique";
    else if (a.roomStyle === "cozy") a.stayVibe = "cozy_warm";
    else if (a.roomStyle === "sleek" || a.hotelPersonality === "polished") a.stayVibe = "sleek_polished";
    else if (a.hotelPersonality === "unique") a.stayVibe = "distinct_unique";
  }
  if (a.stayVibe && STAY_VIBE_DERIVED[a.stayVibe]) {
    a.roomStyle = STAY_VIBE_DERIVED[a.stayVibe].roomStyle;
    a.hotelPersonality = STAY_VIBE_DERIVED[a.stayVibe].hotelPersonality;
  }
  if (!a.nbhdScene && (a.nbhdPace != null || a.nbhdLocation != null)) {
    a.nbhdScene = resolveNbhdScene(a);
  }
  if (a.nbhdScene) {
    delete a.nbhdPace;
    delete a.nbhdLocation;
  }
  const pm = Number(a.priceMatters);
  if (!Number.isFinite(pm)) a.priceMatters = 0;
  else a.priceMatters = Math.max(-100, Math.min(100, Math.round(pm)));
  return a;
}

function reconcileTripEnvWeights(answers, rawPrefs) {
  const trip = answers?.trip;
  const sceneId = resolveNbhdScene(answers || {});
  const loc = NBHD_SCENE_SEEDS[sceneId]?.location;
  if (!trip || !loc) return rawPrefs;
  const tripDir = {
    first: { central: +1, local: -1, iconic: +1, calm: +1 },
    repeat: { central: -1, local: +1 },
    expert: { central: -1, local: +1, calm: +1, iconic: -1 },
  }[trip] || {};
  const locDir = {
    central: { central: +1, local: -1, iconic: +1 },
    trendy: { central: -1, local: +1 },
    scenic: { central: -1, local: +1, calm: +1 },
  }[loc] || {};
  const out = { ...rawPrefs };
  for (const k of BOOP_RECONCILE_KEYS) {
    const t = tripDir[k];
    const e = locDir[k];
    if (!t || !e) continue;
    const agree = (t > 0 && e > 0) || (t < 0 && e < 0);
    if (out[k] == null) continue;
    out[k] = Math.round(out[k] * (agree ? 0.65 : 1.25));
  }
  return out;
}

/**
 * First-time central/iconic boost fights quiet/local nbhd scenes — drop corridor bias
 * when the user explicitly picked leafy or hip local.
 */
function reconcileTripSceneConflict(answers, prefs) {
  if (!prefs || answers?.trip !== "first") return prefs;
  const scene = answers.nbhdScene;
  if (scene !== "leafy_local" && scene !== "hip_local") return prefs;
  const out = { ...prefs };
  out.central = (out.central || 0) - 20;
  out.iconic = (out.iconic || 0) - 18;
  out.local = (out.local || 0) + 6;
  return out;
}

function accumulatePrefsFromAnswers(answers) {
  const prefs = {};
  const add = (weights) => {
    if (!weights) return;
    for (const [k, v] of Object.entries(weights)) {
      prefs[k] = (prefs[k] || 0) + v;
    }
  };
  if (answers.trip === "first") {
    const scene = answers.nbhdScene;
    if (scene === "leafy_local" || scene === "hip_local") {
      add({ calm: 8, local: 6, green: 4 });
    } else {
      add({ central: 20, iconic: 18, calm: 8, local: -6 });
    }
  } else if (answers.trip === "repeat") {
    add({ local: 18, culture: 8, central: -3 });
  } else if (answers.trip === "expert") {
    add({ local: 20, calm: 6, central: -8, iconic: -5 });
  }
  const scene = answers.nbhdScene;
  if (scene && NBHD_SCENE_WEIGHTS[scene]) add(NBHD_SCENE_WEIGHTS[scene]);
  return reconcileTripEnvWeights(answers, prefs);
}

function buildBoopSeeds(profile) {
  const ans = profile?.answers || {};
  const picked = new Set(profile?.dealbreakers || []);
  const freetext = (profile?.freetext || "").trim();

  const seedExtras = [];
  const freetextFacts = [];
  for (const o of MUSTHAVE_CHIP_SPECS) {
    if (!picked.has(o.id)) continue;
    if (o.seed) seedExtras.push(o.seed);
    if (o.id === "balcony") seedExtras.push("private balcony, outdoor terrace, view from room");
    if (o.id === "work_desk") seedExtras.push("work desk, proper workspace, ergonomic chair");
  }

  const FREETEXT_FLAG_PATTERNS = [
    { rx: /\bdouble\s+sink/i, flag: "double_sinks" },
    { rx: /\brainfall\s+shower/i, flag: "rainfall_shower" },
    { rx: /\brain\s+shower/i, flag: "rainfall_shower" },
    { rx: /\bsoaking\s+tub\b/i, flag: "soaking_tub" },
    { rx: /\bwalk[\s-]in\s+shower\b/i, flag: "walk_in_shower" },
    { rx: /\bbalcony\b/i, flag: "private_balcony" },
    { rx: /\bking\s+bed\b/i, flag: "king_bed" },
  ];
  if (freetext) {
    for (const { rx, flag } of FREETEXT_FLAG_PATTERNS) {
      if (rx.test(freetext)) freetextFacts.push(flag);
    }
  }

  const mustHaveSpec = buildMustHaveSpecFromDealbreakers(
    [...picked],
    freetextFacts
  );
  const mustHaves = flattenMustHavesForUrl(mustHaveSpec);

  const roomStyleLabel = {
    sleek: "sleek modern contemporary room, clean lines, minimalist, soft greys, natural light",
    cozy: "warm cozy hotel room, layered textures, wood accents, warm ambient lighting, inviting",
    distinct:
      "distinctive hotel room, bold expressive design, striking decor with personality, artistic character, eclectic mix of materials and textures, curated art pieces, unconventional and one-of-a-kind aesthetic",
  }[ans.roomStyle] || "";
  const roomValueNudge =
    ans.hotelPersonality === "economical"
      ? "clean practical guest room, comfortable basics, unpretentious good value"
      : "";
  const roomBits = [roomStyleLabel || "hotel room", roomValueNudge, seedExtras.join(", "), freetext].filter(Boolean);
  const roomSeed = roomBits.join(". ") || "a comfortable hotel room";

  const tripLabel = {
    first: "first-time visitor, iconic central location",
    repeat: "returning visitor, local neighborhood feel",
    expert: "local expert, hidden-gem neighborhood, non-touristy",
  }[ans.trip] || "";
  const personalityLabel = {
    polished: "polished refined hotel, calm luxury, attentive service, elegant lobby, marble, soft lighting",
    unique: "boutique hotel with character, design-led, unique personality, quirky art, independent feel",
    economical:
      "affordable straightforward hotel, clean functional rooms and lobby, practical amenities, great value, simple comfortable stay without luxury frills",
  }[ans.hotelPersonality] || "";
  const sceneId = resolveNbhdScene(ans);
  const sceneSeed = NBHD_SCENE_SEEDS[sceneId] || NBHD_SCENE_SEEDS.leafy_local;
  const paceLabel = NBHD_PACE_HOTEL_SNIPPETS[sceneSeed.pace] || "";
  const locationLabel = NBHD_LOCATION_HOTEL_SNIPPETS[sceneSeed.location] || "";
  const hotelCharacterNudge =
    ans.roomStyle === "distinct"
      ? "boutique hotel with strong design character, artistic personality, distinctive interiors, independent or lifestyle brand, memorable and expressive spaces"
      : "";
  const hotelBits = [
    tripLabel ? `hotel for ${tripLabel}` : "hotel",
    personalityLabel,
    locationLabel,
    paceLabel,
    hotelCharacterNudge,
    "thoughtful amenities, bar, restaurant, welcoming arrival",
    freetext ? `Guest priorities and atmosphere notes: ${freetext}` : "",
  ].filter(Boolean);
  const hotelSeed = hotelBits.join(". ");

  return { roomSeed, hotelSeed, mustHaves, mustHaveSpec };
}

/** Build a finished wizard profile from answer selections. */
function buildBoopProfile(answers, dealbreakers = [], freetext = "") {
  const normalizedAnswers = migrateBoopProfileAnswersIfNeeded({ ...answers });
  const prefs = accumulatePrefsFromAnswers(normalizedAnswers);
  const db = Array.isArray(dealbreakers) ? dealbreakers : [];
  const profile = {
    answers: normalizedAnswers,
    prefs,
    dealbreakers: [...db],
    freetext: freetext || "",
    advancedKeywords: null,
    updatedAt: Date.now(),
  };
  const seeds = buildBoopSeeds(profile);
  profile.mustHaveSpec = seeds.mustHaveSpec;
  return profile;
}

module.exports = {
  STAY_VIBE_DERIVED,
  MUSTHAVE_OPTIONS,
  NBHD_SCENE_WEIGHTS,
  buildBoopProfile,
  buildBoopSeeds,
  migrateBoopProfileAnswersIfNeeded,
  accumulatePrefsFromAnswers,
  reconcileTripSceneConflict,
};
