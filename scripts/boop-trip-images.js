/**
 * City-specific Boop wizard images for "Have you been to this city before?"
 *
 * Slots:
 *   first  — iconic landmark (clear, recognizable)
 *   repeat — wide city skyline / panorama
 *   expert — café-lined neighbourhood street (row of sidewalk terraces, not one storefront)
 *
 * Pipeline (all cities):
 *   1. Gemini text → 5 search queries for the city + slot
 *   2. Google Places + Unsplash → candidate pool (deduped)
 *   3. Gemini vision → pick best candidate (batched, 4 per call)
 *   → static fallbacks when APIs or Gemini miss
 */

const { photoSearchCityPhrase } = require("./neighborhood-vibe-data");

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const PROMPT_VERSION = "v1";
const MIN_GEMINI_SCORE = 6;
const MAX_CANDIDATES = 8;
const GEMINI_BATCH_SIZE = 4;

const SLOT_BRIEFS = {
  first: {
    title: "First time here",
    brief:
      "A clear, recognizable iconic landmark or monument tourists instantly associate with this city. Hero-shot feel, landscape orientation.",
    reject:
      "generic streets, single shopfronts, cafe interiors, ambiguous architecture, wrong city",
  },
  repeat: {
    title: "Been before",
    brief:
      "A wide city skyline or panoramic cityscape — many buildings, urban scale, possibly from a hill, riverbank, or elevated viewpoint.",
    reject:
      "single landmark close-up only, street-level cafe, one building, interior, wrong city",
  },
  expert: {
    title: "I know it well",
    brief:
      "A neighbourhood street with multiple outdoor cafes visible — sidewalk tables/chairs, terrace seating along the street. Local, lived-in vibe.",
    reject:
      "the storefront of ONE cafe only, empty street with no cafes, highway, mall interior, wrong city",
  },
};

/** Static fallbacks when APIs miss (relative paths are Mexico City hand-picks). */
const STATIC_FALLBACKS = {
  first: "https://images.unsplash.com/photo-1521216774850-01bc1c5fe0da?auto=format&fit=crop&w=1200&q=80",
  repeat: "images/wizard/trip-been-before.png",
  expert: "images/wizard/trip-know-well.png",
};

const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_MEDIA_BASE = "https://places.googleapis.com/v1";

const CHAIN_BLOCKLIST = new Set([
  "starbucks", "mcdonald's", "mcdonalds", "dunkin", "costa coffee", "pret a manger",
  "oxxo", "7-eleven", "subway", "burger king", "walmart", "costco",
]);

function normalizeCityKey(city) {
  return String(city || "").trim().toLowerCase();
}

function isBlockedPlaceName(name) {
  const n = String(name || "").toLowerCase();
  if (!n) return false;
  for (const bad of CHAIN_BLOCKLIST) {
    if (n.includes(bad)) return true;
  }
  if (/\bplayground\b|\bschool\b|\bhospital\b|\bparking\b/i.test(n)) return true;
  return false;
}

function genericQueries(slotId, cityPhrase) {
  const templates = {
    first: [
      `${cityPhrase} iconic landmark monument`,
      `${cityPhrase} famous landmark tourist attraction`,
      `${cityPhrase} historic monument plaza`,
    ],
    repeat: [
      `${cityPhrase} skyline aerial panorama`,
      `${cityPhrase} cityscape from above wide`,
      `${cityPhrase} downtown skyline panoramic view`,
    ],
    expert: [
      `${cityPhrase} outdoor cafe terraces sidewalk tables`,
      `${cityPhrase} sidewalk cafes outdoor seating street`,
      `${cityPhrase} neighbourhood street cafes terraces`,
    ],
  };
  return templates[slotId] || [];
}

function parseGeminiJson(text) {
  const raw = String(text || "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fence ? fence[1] : raw).trim();
  const jsonBit = body.startsWith("[") ? body : body.slice(body.indexOf(body.includes("{") ? "{" : "["));
  return JSON.parse(jsonBit);
}

async function geminiGenerateContent(geminiKey, parts, genConfig = {}) {
  const res = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.2, ...genConfig },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

/** Gemini text: 5 diverse image-search queries for this city + wizard slot. */
async function geminiGenerateSearchQueries(city, slotId, geminiKey) {
  if (!geminiKey) return [];
  const brief = SLOT_BRIEFS[slotId];
  if (!brief) return [];
  const cityPhrase = photoSearchCityPhrase(city);
  try {
    const text = await geminiGenerateContent(
      geminiKey,
      [{
        text: `You are a travel photo editor writing image search queries for Unsplash and Google Places.

City: ${cityPhrase}
Wizard card: "${brief.title}"
Visual goal: ${brief.brief}
Avoid: ${brief.reject}

Return ONLY a JSON array of exactly 5 diverse English search query strings.
Rules:
- Every query must name ${cityPhrase} or a specific well-known neighbourhood/district in that city.
- Queries should find landscape-oriented travel photos, not logos or interiors.
- For cafe/street cards, target streets known for outdoor dining terraces, not a single named cafe.
- No duplicate phrasing; vary angle (landmark name, neighbourhood, activity).

Example for Paris + landmark: ["Eiffel Tower Paris France", "Notre Dame cathedral Paris", ...]`,
      }],
      { maxOutputTokens: 400 }
    );
    const parsed = parseGeminiJson(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((q) => String(q || "").trim())
      .filter((q) => q.length > 8)
      .slice(0, 5);
  } catch (e) {
    console.warn(`[boop-trip-images] query gen failed for ${city}/${slotId}: ${e.message}`);
    return [];
  }
}

async function fetchUnsplashPhotos(query, unsplashKey, perPage = 6) {
  if (!unsplashKey) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`;
  const res = await fetch(url, {
    headers: { Authorization: `Client-ID ${unsplashKey}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.results || [];
}

async function fetchPlacesPhotoUrl(photoName, placesKey, maxWidth = 1200) {
  try {
    const res = await fetch(
      `${PLACES_MEDIA_BASE}/${photoName}/media?maxWidthPx=${maxWidth}&skipHttpRedirect=true`,
      { headers: { "X-Goog-Api-Key": placesKey }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.photoUri || null;
  } catch {
    return null;
  }
}

async function googleCandidatesFromQuery(textQuery, placesKey, perQuery = 2) {
  if (!placesKey || !textQuery) return [];
  const out = [];
  try {
    const res = await fetch(PLACES_SEARCH_TEXT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": placesKey,
        "X-Goog-FieldMask": "places.displayName,places.photos",
      },
      body: JSON.stringify({ textQuery, maxResultCount: 8 }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    for (const place of data.places || []) {
      if (out.length >= perQuery) break;
      const name = place.displayName?.text || "";
      if (isBlockedPlaceName(name)) continue;
      if (!place.photos?.length) continue;
      const url = await fetchPlacesPhotoUrl(place.photos[0].name, placesKey);
      if (!url) continue;
      out.push({
        url,
        source: "google_places",
        query: textQuery,
        placeName: name,
      });
    }
  } catch {
    return [];
  }
  return out;
}

async function unsplashCandidatesFromQuery(query, unsplashKey, perQuery = 2) {
  if (!unsplashKey) return [];
  const results = await fetchUnsplashPhotos(query, unsplashKey, 6);
  const out = [];
  for (const photo of results) {
    if (out.length >= perQuery) break;
    if (!photo?.urls?.regular) continue;
    out.push({
      url: photo.urls.regular,
      source: "unsplash",
      query,
      placeName: photo.alt_description?.slice(0, 80) || null,
    });
  }
  return out;
}

async function gatherCandidates(slotId, queries, opts = {}) {
  const { placesKey, unsplashKey } = opts;
  const seen = new Set();
  const candidates = [];

  const add = (hit) => {
    if (!hit?.url || seen.has(hit.url)) return;
    seen.add(hit.url);
    candidates.push(hit);
  };

  for (const q of queries) {
    if (candidates.length >= MAX_CANDIDATES) break;
    const [gHits, uHits] = await Promise.all([
      googleCandidatesFromQuery(q, placesKey, 2),
      unsplashCandidatesFromQuery(q, unsplashKey, 2),
    ]);
    for (const h of [...gHits, ...uHits]) {
      add(h);
      if (candidates.length >= MAX_CANDIDATES) break;
    }
  }
  return candidates;
}

async function fetchImageB64(photoUrl) {
  try {
    const smallUrl = String(photoUrl).replace(/maxWidthPx=\d+/, "maxWidthPx=480");
    const imgRes = await fetch(smallUrl, { signal: AbortSignal.timeout(10000) });
    if (!imgRes.ok) return null;
    const imgBuf = await imgRes.arrayBuffer();
    return {
      b64: Buffer.from(imgBuf).toString("base64"),
      mime: imgRes.headers.get("content-type") || "image/jpeg",
    };
  } catch {
    return null;
  }
}

/** Gemini vision: pick best photo from a batch of up to 4 candidates. */
async function geminiPickFromBatch(batch, city, slotId, geminiKey) {
  if (!geminiKey || !batch.length) return null;
  const brief = SLOT_BRIEFS[slotId];
  const cityPhrase = photoSearchCityPhrase(city);

  const loaded = [];
  for (let i = 0; i < batch.length; i++) {
    const img = await fetchImageB64(batch[i].url);
    if (img) loaded.push({ index: i, candidate: batch[i], ...img });
  }
  if (!loaded.length) return null;

  const parts = [{
    text: `You are picking ONE photo for a hotel search wizard card.

City: ${cityPhrase}
Card: "${brief.title}"
Visual goal: ${brief.brief}
Hard reject: ${brief.reject}
Also reject: black & white, wrong city/region, distressing subjects, interior-only shots.

${loaded.length} candidates attached in order (1 to ${loaded.length}).
${loaded.map((l, i) => `Candidate ${i + 1}: ${l.candidate.placeName || l.candidate.query || "photo"}`).join("\n")}

Reply ONLY with JSON:
{"pick": <1-based index of best, or 0 if ALL unsuitable>, "scores": [<0-10 per candidate>], "reason": "<short>"}

Scoring: 9-10 perfect; 6-8 acceptable; 0-5 reject.`,
  }];
  for (let i = 0; i < loaded.length; i++) {
    parts.push({ text: `Candidate ${i + 1}:` });
    parts.push({ inlineData: { mimeType: loaded[i].mime, data: loaded[i].b64 } });
  }

  try {
    const raw = await geminiGenerateContent(geminiKey, parts, { maxOutputTokens: 200, temperature: 0 });
    const parsed = parseGeminiJson(raw);
    const pick = Number(parsed.pick) || 0;
    const scores = Array.isArray(parsed.scores) ? parsed.scores.map(Number) : [];
    const reason = String(parsed.reason || "").slice(0, 120);

    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < loaded.length; i++) {
      const sc = Number.isFinite(scores[i]) ? scores[i] : -1;
      if (sc > bestScore) {
        bestScore = sc;
        bestIdx = i;
      }
    }
    if (pick >= 1 && pick <= loaded.length) {
      const pickScore = Number.isFinite(scores[pick - 1]) ? scores[pick - 1] : bestScore;
      if (pickScore >= MIN_GEMINI_SCORE) {
        return {
          ...loaded[pick - 1].candidate,
          geminiScore: pickScore,
          geminiReason: reason,
        };
      }
    }
    if (bestIdx >= 0 && bestScore >= MIN_GEMINI_SCORE) {
      return {
        ...loaded[bestIdx].candidate,
        geminiScore: bestScore,
        geminiReason: reason,
      };
    }
    return null;
  } catch (e) {
    console.warn(`[boop-trip-images] vision pick failed ${city}/${slotId}: ${e.message}`);
    return null;
  }
}

async function geminiPickBestCandidate(candidates, city, slotId, geminiKey) {
  let best = null;
  for (let i = 0; i < candidates.length; i += GEMINI_BATCH_SIZE) {
    const batch = candidates.slice(i, i + GEMINI_BATCH_SIZE);
    const picked = await geminiPickFromBatch(batch, city, slotId, geminiKey);
    if (!picked) continue;
    if (!best || (picked.geminiScore || 0) > (best.geminiScore || 0)) {
      best = picked;
    }
  }
  return best;
}

async function resolveSlot(slotId, city, opts = {}) {
  const { placesKey, unsplashKey, geminiKey } = opts;
  const phrase = photoSearchCityPhrase(city);

  const geminiQueries = geminiKey
    ? await geminiGenerateSearchQueries(city, slotId, geminiKey)
    : [];
  const queries = [...new Set([...geminiQueries, ...genericQueries(slotId, phrase)])].slice(0, 8);

  const candidates = await gatherCandidates(slotId, queries, { placesKey, unsplashKey });

  if (geminiKey && candidates.length) {
    const picked = await geminiPickBestCandidate(candidates, city, slotId, geminiKey);
    if (picked) {
      return {
        slot: slotId,
        url: picked.url,
        source: "gemini",
        query: picked.query,
        placeName: picked.placeName,
        geminiScore: picked.geminiScore,
        geminiReason: picked.geminiReason,
        candidateCount: candidates.length,
      };
    }
  }

  if (candidates.length) {
    return {
      slot: slotId,
      url: candidates[0].url,
      source: candidates[0].source,
      query: candidates[0].query,
      placeName: candidates[0].placeName,
      candidateCount: candidates.length,
    };
  }

  return {
    slot: slotId,
    url: STATIC_FALLBACKS[slotId] || null,
    source: "static",
    query: null,
    placeName: null,
  };
}

/** Load cached trip wizard images for a city (null when missing). */
async function loadBoopTripImagesFromDb(db, city) {
  if (!db || !city) return null;
  const { data, error } = await db
    .from("boop_trip_images")
    .select("city, images, meta, prompt_version, generated_at")
    .eq("city", String(city).trim())
    .maybeSingle();
  if (error) {
    console.warn(`[boop-trip-images] db read failed for ${city}: ${error.message}`);
    return null;
  }
  if (!data?.images || typeof data.images !== "object") return null;
  if (data.prompt_version && data.prompt_version !== PROMPT_VERSION) return null;
  const images = data.images;
  if (!images.first && !images.repeat && !images.expert) return null;
  return {
    city: data.city || city,
    images: {
      first: images.first || null,
      repeat: images.repeat || null,
      expert: images.expert || null,
    },
    meta: data.meta || null,
    generated_at: data.generated_at || null,
    db_cached: true,
  };
}

/** Upsert trip wizard images after a fresh Gemini/Places run. */
async function saveBoopTripImagesToDb(db, city, result) {
  if (!db || !city || !result?.images) return;
  const row = {
    city: String(city).trim(),
    images: result.images,
    meta: result.meta || null,
    prompt_version: PROMPT_VERSION,
    generated_at: new Date().toISOString(),
  };
  const { error } = await db.from("boop_trip_images").upsert(row, { onConflict: "city" });
  if (error) console.warn(`[boop-trip-images] db write failed for ${city}: ${error.message}`);
}

/**
 * Return cached row or compute + persist. Used by city rollout and admin backfill.
 * @returns {Promise<{ city, images, meta, db_cached?: boolean }>}
 */
async function ensureBoopTripImages(city, db, opts = {}) {
  const {
    force = false,
    log = console.log,
    placesKey = process.env.GOOGLE_PLACES_KEY || null,
    unsplashKey = process.env.UNSPLASH_KEY || null,
    geminiKey = process.env.GEMINI_KEY || null,
  } = opts;

  const resolvedCity = String(city || "").trim();
  if (!resolvedCity) throw new Error("city required");

  if (!force && db) {
    const cached = await loadBoopTripImagesFromDb(db, resolvedCity);
    if (cached) {
      log(`[boop-trip-images] ${resolvedCity}: db cache hit`);
      return cached;
    }
  }

  const t0 = Date.now();
  const result = await fetchTripWizardImages(resolvedCity, { placesKey, unsplashKey, geminiKey });
  if (db) await saveBoopTripImagesToDb(db, resolvedCity, result);
  log(
    `[boop-trip-images] ${resolvedCity}: computed first=${result.meta?.first?.source} ` +
    `repeat=${result.meta?.repeat?.source} expert=${result.meta?.expert?.source} in ${Date.now() - t0}ms`
  );
  return { ...result, db_cached: false };
}

/**
 * @returns {Promise<{ first: object, repeat: object, expert: object, city: string }>}
 */
async function fetchTripWizardImages(city, opts = {}) {
  const resolvedCity = String(city || "").trim();
  if (!resolvedCity) {
    throw new Error("city required");
  }
  const [first, repeat, expert] = await Promise.all([
    resolveSlot("first", resolvedCity, opts),
    resolveSlot("repeat", resolvedCity, opts),
    resolveSlot("expert", resolvedCity, opts),
  ]);
  return {
    city: resolvedCity,
    images: {
      first: first.url,
      repeat: repeat.url,
      expert: expert.url,
    },
    meta: { first, repeat, expert },
  };
}

/** Mexico City litmus — URLs we expect to be city-appropriate (not pixel-equal). */
const LITMUS_MEXICO_CITY = {
  first: STATIC_FALLBACKS.first,
  repeat: STATIC_FALLBACKS.repeat,
  expert: STATIC_FALLBACKS.expert,
};

module.exports = {
  fetchTripWizardImages,
  loadBoopTripImagesFromDb,
  saveBoopTripImagesToDb,
  ensureBoopTripImages,
  PROMPT_VERSION,
  STATIC_FALLBACKS,
  LITMUS_MEXICO_CITY,
  SLOT_BRIEFS,
  geminiGenerateSearchQueries,
  geminiPickFromBatch,
  gatherCandidates,
  photoSearchCityPhrase,
};
