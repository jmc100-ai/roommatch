/**
 * City-specific Boop wizard images for nbhdScene tiles:
 *   buzz_central — Historic & energetic
 *   scenic_open  — Central & connected
 *
 * Pipeline per slot:
 *   1. Gemini text → 5 search queries
 *   2. Google Places + Unsplash → candidate pool
 *   3. Gemini vision → pick best candidate
 *   → static PNG fallback when APIs miss
 */

const { gatherCandidates, photoSearchCityPhrase } = require("./boop-trip-images");

const GEMINI_MODEL = "gemini-2.5-flash-lite";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const PROMPT_VERSION = "v3";
const SLOT_IDS = ["buzz_central", "scenic_open"];
const MIN_GEMINI_SCORE = 6;
const MAX_CANDIDATES = 8;
const GEMINI_BATCH_SIZE = 4;

const SLOT_CONFIGS = {
  buzz_central: {
    title: "Historic & energetic",
    brief:
      "The city's single most famous, instantly recognizable major icon landmark — cathedral, palace, monument, or historic main square — shown in a BUSY central tourist area with crowds, traffic, or lively street energy. Think postcard hero shot of the #1 sight everyone associates with this city, surrounded by classic urban bustle.",
    reject:
      "minor or niche historic site, quiet empty plaza with no people, residential side street, peripheral suburb, modern glass skyscraper only, trendy cafe-only street, beach resort, highway, mall interior, wrong city, black and white, interior-only shot",
    staticFallback: "images/wizard/historic-energetic.png",
    genericQueries: (cityPhrase) => [
      `${cityPhrase} most famous landmark busy plaza crowds`,
      `${cityPhrase} iconic monument tourist square central`,
      `${cityPhrase} main historic square lively street energy`,
      `${cityPhrase} number one landmark cathedral busy area`,
      `${cityPhrase} historic center iconic sight crowds tourists`,
    ],
    queryRules: `Rules:
- Target the #1 most famous icon landmark in the city's busy historic core — the sight on every postcard.
- Prefer queries that will return photos with crowds, traffic, or lively plaza energy around that landmark.
- Name specific monuments/squares (e.g. Eiffel Tower, Zócalo, Big Ben, Notre-Dame) — not generic "old town" alone.
- Landscape-oriented travel photos; not logos, interiors, or empty dawn shots.
- No duplicate phrasing; vary angle (landmark name, main square + crowds, cathedral + busy plaza).

Example for Mexico City: ["Zócalo Mexico City busy plaza cathedral", "Palacio de Bellas Artes Mexico City landmark crowds", ...]`,
    visionScoring: `When scoring, strongly favor candidates that show BOTH:
1) a major, instantly recognizable city icon landmark (the #1 tourist sight), AND
2) visible bustle — crowds, cars, busy plaza, or lively street life around it.
Penalize secondary historic sites, empty plazas, or pretty-but-calm architecture with no energy.

Scoring: 9-10 = top icon landmark + clear busy energy; 6-8 = strong landmark or busy historic core; 0-5 = reject.`,
    visionAlsoReject:
      "wrong city/region, distressing subjects, interior-only shots, single cafe storefront, empty quiet square with no urban energy",
  },
  scenic_open: {
    title: "Central & connected",
    brief:
      "The city's central business / downtown core — well-connected, transit-friendly, professional urban energy. Show a major central boulevard, business district, or transit hub with tall buildings (if the city has them), office towers, wide avenues, metro/rail station exterior, or a skyline view of the commercial center. Balanced city feel: easy to get everywhere, not historic-old-town and not leafy residential.",
    reject:
      "historic cathedral or old-town plaza only, quiet residential suburb, leafy park-only scene, beach, countryside, single cafe street, mall food court interior, highway interchange only, wrong city, black and white, interior-only shot",
    staticFallback: "images/wizard/central-connected.png",
    genericQueries: (cityPhrase) => [
      `${cityPhrase} downtown business district skyline towers`,
      `${cityPhrase} central business district boulevard transit`,
      `${cityPhrase} financial district skyscrapers avenue`,
      `${cityPhrase} main metro station downtown exterior`,
      `${cityPhrase} central connected downtown office towers`,
    ],
    queryRules: `Rules:
- Target the city's primary downtown / CBD / business corridor — Reforma, La Défense, City of London, Midtown, etc.
- Prefer queries that return central boulevards, office towers, transit stations (metro/rail), or skyline views of the commercial core.
- Include transit or connectivity cues where natural (metro entrance, central station, wide avenue with buses/trams).
- Tall buildings are a plus when the city has them; for low-rise cities, a busy central avenue or main station still works.
- Landscape-oriented travel photos; not logos, interiors, or empty dawn shots.
- No duplicate phrasing; vary angle (business district name, central station, main boulevard + towers).

Example for Mexico City: ["Paseo de la Reforma Mexico City skyline towers", "Torre Latinoamericana Reforma business district", "Bellas Artes metro area downtown Mexico City", ...]
Example for Paris: ["La Défense Paris business district towers", "Châtelet Les Halles Paris transit hub", "Avenue des Champs-Élysées Paris central avenue", ...]`,
    visionScoring: `When scoring, strongly favor candidates that show:
1) a clearly CENTRAL / downtown / business-district location (not old town, not suburbs), AND
2) connectivity or urban scale — transit (metro/rail/bus), wide central boulevard, office towers, or commercial skyline.
Tall buildings score higher when authentic for this city; penalize historic-only plazas, parks, and quiet residential streets.

Scoring: 9-10 = unmistakable CBD/transit hub with urban scale; 6-8 = central avenue or station with city energy; 0-5 = reject.`,
    visionAlsoReject:
      "wrong city/region, distressing subjects, interior-only shots, historic-only tourist square with no business/transit feel, empty suburban street",
  },
};

function slotConfig(slotId) {
  return SLOT_CONFIGS[slotId] || null;
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

async function geminiGenerateSearchQueries(city, slotId, geminiKey) {
  if (!geminiKey) return [];
  const cfg = slotConfig(slotId);
  if (!cfg) return [];
  const cityPhrase = photoSearchCityPhrase(city);
  try {
    const text = await geminiGenerateContent(
      geminiKey,
      [{
        text: `You are a travel photo editor writing image search queries for Unsplash and Google Places.

City: ${cityPhrase}
Wizard card: "${cfg.title}"
Visual goal: ${cfg.brief}
Avoid: ${cfg.reject}

Return ONLY a JSON array of exactly 5 diverse English search query strings.
${cfg.queryRules}`,
      }],
      { maxOutputTokens: 450 }
    );
    const parsed = parseGeminiJson(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((q) => String(q || "").trim())
      .filter((q) => q.length > 8)
      .slice(0, 5);
  } catch (e) {
    console.warn(`[boop-nbhd-scene-images] query gen failed for ${city}/${slotId}: ${e.message}`);
    return [];
  }
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

async function geminiPickFromBatch(batch, city, slotId, geminiKey) {
  if (!geminiKey || !batch.length) return null;
  const cfg = slotConfig(slotId);
  if (!cfg) return null;
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
Card: "${cfg.title}"
Visual goal: ${cfg.brief}
Hard reject: ${cfg.reject}
Also reject: ${cfg.visionAlsoReject}

${cfg.visionScoring}

${loaded.length} candidates attached in order (1 to ${loaded.length}).
${loaded.map((l, i) => `Candidate ${i + 1}: ${l.candidate.placeName || l.candidate.query || "photo"}`).join("\n")}

Reply ONLY with JSON:
{"pick": <1-based index of best, or 0 if ALL unsuitable>, "scores": [<0-10 per candidate>], "reason": "<short>"}`,
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
    console.warn(`[boop-nbhd-scene-images] vision pick failed ${city}/${slotId}: ${e.message}`);
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
  const cfg = slotConfig(slotId);
  if (!cfg) throw new Error(`unknown slot: ${slotId}`);
  const { placesKey, unsplashKey, geminiKey } = opts;
  const phrase = photoSearchCityPhrase(city);

  const geminiQueries = geminiKey ? await geminiGenerateSearchQueries(city, slotId, geminiKey) : [];
  const queries = [...new Set([...geminiQueries, ...cfg.genericQueries(phrase)])].slice(0, 8);
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
    url: cfg.staticFallback,
    source: "static",
    query: null,
    placeName: null,
  };
}

function imagesCacheComplete(images) {
  return SLOT_IDS.every((id) => typeof images?.[id] === "string" && images[id].length > 0);
}

async function loadBoopNbhdSceneImagesFromDb(db, city) {
  if (!db || !city) return null;
  const { data, error } = await db
    .from("boop_nbhd_scene_images")
    .select("city, images, meta, prompt_version, generated_at")
    .eq("city", String(city).trim())
    .maybeSingle();
  if (error) {
    console.warn(`[boop-nbhd-scene-images] db read failed for ${city}: ${error.message}`);
    return null;
  }
  if (!data?.images || typeof data.images !== "object") return null;
  if (data.prompt_version && data.prompt_version !== PROMPT_VERSION) return null;
  if (!imagesCacheComplete(data.images)) return null;
  return {
    city: data.city || city,
    images: {
      buzz_central: data.images.buzz_central,
      scenic_open: data.images.scenic_open,
    },
    meta: data.meta || null,
    generated_at: data.generated_at || null,
    db_cached: true,
  };
}

async function saveBoopNbhdSceneImagesToDb(db, city, result) {
  if (!db || !city || !result?.images) return;
  const row = {
    city: String(city).trim(),
    images: result.images,
    meta: result.meta || null,
    prompt_version: PROMPT_VERSION,
    generated_at: new Date().toISOString(),
  };
  const { error } = await db.from("boop_nbhd_scene_images").upsert(row, { onConflict: "city" });
  if (error) console.warn(`[boop-nbhd-scene-images] db write failed for ${city}: ${error.message}`);
}

async function fetchNbhdSceneWizardImages(city, opts = {}) {
  const resolvedCity = String(city || "").trim();
  if (!resolvedCity) throw new Error("city required");
  const [buzz, scenic] = await Promise.all([
    resolveSlot("buzz_central", resolvedCity, opts),
    resolveSlot("scenic_open", resolvedCity, opts),
  ]);
  return {
    city: resolvedCity,
    images: {
      buzz_central: buzz.url,
      scenic_open: scenic.url,
    },
    meta: {
      buzz_central: buzz,
      scenic_open: scenic,
    },
  };
}

async function ensureBoopNbhdSceneImages(city, db, opts = {}) {
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
    const cached = await loadBoopNbhdSceneImagesFromDb(db, resolvedCity);
    if (cached) {
      log(`[boop-nbhd-scene-images] ${resolvedCity}: db cache hit`);
      return cached;
    }
  }

  const t0 = Date.now();
  const result = await fetchNbhdSceneWizardImages(resolvedCity, { placesKey, unsplashKey, geminiKey });
  if (db) await saveBoopNbhdSceneImagesToDb(db, resolvedCity, result);
  log(
    `[boop-nbhd-scene-images] ${resolvedCity}: buzz_central=${result.meta?.buzz_central?.source} ` +
    `scenic_open=${result.meta?.scenic_open?.source} in ${Date.now() - t0}ms` +
    (result.meta?.buzz_central?.geminiScore != null ? ` buzz_score=${result.meta.buzz_central.geminiScore}` : "") +
    (result.meta?.scenic_open?.geminiScore != null ? ` scenic_score=${result.meta.scenic_open.geminiScore}` : "")
  );
  return { ...result, db_cached: false };
}

module.exports = {
  fetchNbhdSceneWizardImages,
  loadBoopNbhdSceneImagesFromDb,
  saveBoopNbhdSceneImagesToDb,
  ensureBoopNbhdSceneImages,
  resolveSlot,
  PROMPT_VERSION,
  SLOT_IDS,
  SLOT_CONFIGS,
  geminiGenerateSearchQueries,
};
