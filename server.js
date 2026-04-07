/**
 * RoomMatch — server.js
 * Room-search for hotel discovery + hotel detail for full room inventory
 */

const express = require("express");
const cors    = require("cors");
const path    = require("path");
const crypto  = require("crypto");
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { indexCity }    = require("./scripts/index-city");
const { generateNeighborhoods, refreshHotelCounts, recomputeNeighborhoodVibes } = require("./scripts/neighborhood-generator");
const { backfillCity } = require("./scripts/backfill-latlng");

// ── Password gate helpers ─────────────────────────────────────────────────────
const SITE_PASSWORD = process.env.SITE_PASSWORD || "";
const SITE_PASSWORD_HASH = SITE_PASSWORD
  ? crypto.createHash("sha256").update(SITE_PASSWORD + "rm-salt-2026").digest("hex")
  : "";

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.split("=");
    out[k.trim()] = decodeURIComponent(v.join("=").trim());
  }
  return out;
}

function loginHtml(error = "") {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>TravelBoop</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet"/>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
           background: #0c0c0e; font-family: 'DM Sans', sans-serif; color: #e8e4dc; }
    .card { background: #18181c; border: 1px solid rgba(255,255,255,0.07); border-radius: 16px;
            padding: 48px 40px; width: 100%; max-width: 380px; text-align: center; }
    h1 { font-family: 'Cormorant Garamond', serif; font-size: 28px; font-weight: 300;
         letter-spacing: 0.05em; margin-bottom: 8px; color: #c9a96e; }
    p.sub { font-size: 13px; color: rgba(232,228,220,0.5); margin-bottom: 32px; }
    input[type=password] { width: 100%; padding: 12px 16px; background: #0c0c0e;
      border: 1px solid rgba(201,169,110,0.3); border-radius: 8px; color: #e8e4dc;
      font-family: 'DM Sans', sans-serif; font-size: 15px; margin-bottom: 16px; outline: none; }
    input[type=password]:focus { border-color: rgba(201,169,110,0.7); }
    button { width: 100%; padding: 12px; background: linear-gradient(135deg, #c9a96e, #a8893d);
             border: none; border-radius: 8px; color: #0c0c0e; font-family: 'DM Sans', sans-serif;
             font-size: 14px; font-weight: 500; letter-spacing: 0.08em; cursor: pointer; }
    .error { color: #e87070; font-size: 13px; margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>TravelBoop</h1>
    <p class="sub">Private access only</p>
    <form method="POST" action="/auth">
      <input type="password" name="password" placeholder="Password" autofocus/>
      <button type="submit">Enter</button>
      ${error ? `<p class="error">${error}</p>` : ""}
    </form>
  </div>
</body>
</html>`;
}

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;
const supabaseAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const app         = express();
// Use production key if set, fall back to sandbox
const LITEAPI_KEY = process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY || "";
const IS_PROD     = !!process.env.LITEAPI_PROD_KEY;
const PORT        = process.env.PORT || 3000;

const CITY_COORDS = {
  "new york": [40.7128, -74.006], "new york city": [40.7128, -74.006],
  "nyc": [40.7128, -74.006], "manhattan": [40.758, -73.9855],
  "washington dc": [38.9072, -77.0369], "washington d.c.": [38.9072, -77.0369],
  "chiang mai": [18.7883, 98.9853], "kuala lumpur": [3.139, 101.6869],
  "sao paulo": [-23.5505, -46.6333], "rio de janeiro": [-22.9068, -43.1729],
  "buenos aires": [-34.6037, -58.3816], "cape town": [-33.9249, 18.4241],
  "tel aviv": [32.0853, 34.7818], "hong kong": [22.3193, 114.1694],
  "abu dhabi": [24.4539, 54.3773], "new orleans": [29.9511, -90.0715],
  "mexico city": [19.4326, -99.1332], "las vegas": [36.1699, -115.1398],
  "san francisco": [37.7749, -122.4194], "los angeles": [34.0522, -118.2437],
  "los angeles": [34.0522, -118.2437], "la": [34.0522, -118.2437],
  "chicago": [41.8781, -87.6298], "miami": [25.7617, -80.1918],
  "las vegas": [36.1699, -115.1398], "san francisco": [37.7749, -122.4194],
  "seattle": [47.6062, -122.3321], "boston": [42.3601, -71.0589],
  "washington dc": [38.9072, -77.0369], "dc": [38.9072, -77.0369],
  "new orleans": [29.9511, -90.0715], "austin": [30.2672, -97.7431],
  "toronto": [43.6532, -79.3832], "vancouver": [49.2827, -123.1207],
  "mexico city": [19.4326, -99.1332], "cancun": [21.1619, -86.8515],
  "rio de janeiro": [-22.9068, -43.1729], "rio": [-22.9068, -43.1729],
  "buenos aires": [-34.6037, -58.3816], "sao paulo": [-23.5505, -46.6333],
  "london": [51.5074, -0.1278], "paris": [48.8566, 2.3522],
  "barcelona": [41.3851, 2.1734], "madrid": [40.4168, -3.7038],
  "rome": [41.9028, 12.4964], "milan": [45.4654, 9.1859],
  "florence": [43.7696, 11.2558], "venice": [45.4408, 12.3155],
  "amsterdam": [52.3676, 4.9041], "berlin": [52.52, 13.405],
  "munich": [48.1351, 11.582], "prague": [50.0755, 14.4378],
  "vienna": [48.2082, 16.3738], "budapest": [47.4979, 19.0402],
  "lisbon": [38.7223, -9.1393], "athens": [37.9838, 23.7275],
  "istanbul": [41.0082, 28.9784], "zurich": [47.3769, 8.5417],
  "brussels": [50.8503, 4.3517], "copenhagen": [55.6761, 12.5683],
  "oslo": [59.9139, 10.7522], "stockholm": [59.3293, 18.0686],
  "dublin": [53.3498, -6.2603], "edinburgh": [55.9533, -3.1883],
  "dubai": [25.2048, 55.2708], "abu dhabi": [24.4539, 54.3773],
  "cairo": [30.0444, 31.2357], "cape town": [-33.9249, 18.4241],
  "nairobi": [-1.2921, 36.8219], "marrakech": [31.6295, -7.9811],
  "tel aviv": [32.0853, 34.7818], "doha": [25.2854, 51.531],
  "tokyo": [35.6762, 139.6503], "osaka": [34.6937, 135.5023],
  "kyoto": [35.0116, 135.7681], "bangkok": [13.7563, 100.5018],
  "singapore": [1.3521, 103.8198], "hong kong": [22.3193, 114.1694],
  "bali": [-8.3405, 115.092], "kuala lumpur": [3.139, 101.6869],
  "sydney": [-33.8688, 151.2093], "melbourne": [-37.8136, 144.9631],
  "mumbai": [19.076, 72.8777], "delhi": [28.6139, 77.209],
  "phuket": [7.8804, 98.3923], "koh samui": [9.5120, 100.0136],
  "beijing": [39.9042, 116.4074], "shanghai": [31.2304, 121.4737],
  "seoul": [37.5665, 126.978], "busan": [35.1796, 129.0756],
  "taipei": [25.0330, 121.5654], "ho chi minh city": [10.8231, 106.6297],
  "hanoi": [21.0285, 105.8542], "da nang": [16.0544, 108.2022],
  "hoi an": [15.8801, 108.3380], "siem reap": [13.3633, 103.8564],
  "phnom penh": [11.5564, 104.9282], "yangon": [16.8661, 96.1951],
  "colombo": [6.9271, 79.8612], "kathmandu": [27.7172, 85.3240],
  "dhaka": [23.8103, 90.4125], "karachi": [24.8607, 67.0011],
  "lahore": [31.5204, 74.3587], "islamabad": [33.6844, 73.0479],
  "goa": [15.2993, 74.1240], "jaipur": [26.9124, 75.7873],
  "agra": [27.1767, 78.0081], "varanasi": [25.3176, 82.9739],
  "udaipur": [24.5854, 73.7125], "kochi": [9.9312, 76.2673],
  "hyderabad": [17.3850, 78.4867], "chennai": [13.0827, 80.2707],
  "bangalore": [12.9716, 77.5946], "kolkata": [22.5726, 88.3639],
  "brisbane": [-27.4698, 153.0251], "perth": [-31.9505, 115.8605],
  "adelaide": [-34.9285, 138.6007], "gold coast": [-28.0167, 153.4000],
  "cairns": [-16.9186, 145.7781], "auckland": [-36.8485, 174.7633],
  "wellington": [-41.2866, 174.7756], "queenstown": [-45.0312, 168.6626],
  "christchurch": [-43.5321, 172.6362],
  "cape town": [-33.9249, 18.4241], "johannesburg": [-26.2041, 28.0473],
  "durban": [-29.8587, 31.0218], "cairo": [30.0444, 31.2357],
  "luxor": [25.6872, 32.6396], "marrakech": [31.6295, -7.9811],
  "casablanca": [33.5731, -7.5898], "nairobi": [-1.2921, 36.8219],
  "zanzibar": [-6.1659, 39.2026], "addis ababa": [9.0320, 38.7469],
  "kigali": [-1.9441, 30.0619], "accra": [5.6037, -0.1870],
  "lagos": [6.5244, 3.3792], "dakar": [14.7167, -17.4677],
  "havana": [23.1136, -82.3666], "nassau": [25.0480, -77.3554],
  "santo domingo": [18.4861, -69.9312], "punta cana": [18.5820, -68.4050],
  "san juan": [18.4655, -66.1057], "montego bay": [18.4762, -77.8939],
  "reykjavik": [64.1355, -21.8954], "tallinn": [59.4370, 24.7536],
  "riga": [56.9460, 24.1059], "vilnius": [54.6872, 25.2797],
  "sofia": [42.6977, 23.3219], "belgrade": [44.7866, 20.4489],
  "zagreb": [45.8150, 15.9819], "split": [43.5081, 16.4402],
  "dubrovnik": [42.6507, 18.0944], "sarajevo": [43.8563, 18.4131],
  "ljubljana": [46.0569, 14.5058], "bratislava": [48.1486, 17.1077],
  "wroclaw": [51.1079, 17.0385], "krakow": [50.0647, 19.9450],
  "gdansk": [54.3520, 18.6466], "salzburg": [47.8095, 13.0550],
  "innsbruck": [47.2692, 11.4041], "lucerne": [47.0502, 8.3093],
  "bern": [46.9480, 7.4474], "basel": [47.5596, 7.5886],
  "bruges": [51.2093, 3.2247], "ghent": [51.0500, 3.7303],
  "antwerp": [51.2213, 4.4051], "luxembourg": [49.6117, 6.1319],
  "nice": [43.7102, 7.2620], "bordeaux": [44.8378, -0.5792],
  "lyon": [45.7640, 4.8357], "marseille": [43.2965, 5.3698],
  "seville": [37.3891, -5.9845], "valencia": [39.4699, -0.3763],
  "malaga": [36.7213, -4.4214], "bilbao": [43.2630, -2.9350],
  "ibiza": [38.9067, 1.4206], "naples": [40.8518, 14.2681],
  "palermo": [38.1157, 13.3615], "bologna": [44.4949, 11.3426],
  "turin": [45.0703, 7.6869], "amalfi": [40.6340, 14.6027],
  "santorini": [36.3932, 25.4615], "mykonos": [37.4467, 25.3289],
  "thessaloniki": [40.6401, 22.9444], "edinburgh": [55.9533, -3.1883],
  "manchester": [53.4808, -2.2426], "liverpool": [53.4084, -2.9916],
  "bristol": [51.4545, -2.5879], "bath": [51.3781, -2.3597],
  "oxford": [51.7520, -1.2577], "birmingham": [52.4862, -1.8904],
  "galway": [53.2707, -9.0568], "florence": [43.7696, 11.2558],
  "porto": [41.1579, -8.6291], "lisbon": [38.7223, -9.1393],
  "algarve": [37.0179, -7.9307], "madeira": [32.7607, -16.9595],
  "oslo": [59.9139, 10.7522], "bergen": [60.3929, 5.3241],
  "gothenburg": [57.7089, 11.9746], "helsinki": [60.1699, 24.9384],
  "copenhagen": [55.6761, 12.5683], "stockholm": [59.3293, 18.0686],
  "brussels": [50.8503, 4.3517], "amsterdam": [52.3676, 4.9041],
  "rotterdam": [51.9244, 4.4777], "berlin": [52.52, 13.405],
  "hamburg": [53.5753, 10.0153], "munich": [48.1351, 11.582],
  "frankfurt": [50.1109, 8.6821], "cologne": [50.9333, 6.9500],
  "dresden": [51.0504, 13.7373], "stuttgart": [48.7758, 9.1829],
  "vienna": [48.2082, 16.3738], "prague": [50.0755, 14.4378],
  "budapest": [47.4979, 19.0402], "warsaw": [52.2297, 21.0122],
  "bucharest": [44.4268, 26.1025], "istanbul": [41.0082, 28.9784],
  "antalya": [36.8841, 30.7056], "bodrum": [37.0344, 27.4305],
  "cappadocia": [38.6431, 34.8289], "beirut": [33.8938, 35.5018],
  "amman": [31.9454, 35.9284], "jerusalem": [31.7683, 35.2137],
  "riyadh": [24.7136, 46.6753], "jeddah": [21.5433, 39.1728],
  "muscat": [23.5880, 58.3829], "doha": [25.2854, 51.531],
  "manama": [26.2154, 50.5832], "tashkent": [41.2995, 69.2401],
  "almaty": [43.2220, 76.8512], "tbilisi": [41.7151, 44.8271],
  "yerevan": [40.1872, 44.5152], "baku": [40.4093, 49.8671],
  "ho chi minh": [10.8231, 106.6297], "saigon": [10.8231, 106.6297],
  "penang": [5.4141, 100.3288], "langkawi": [6.3500, 99.8000],
  "lombok": [-8.5833, 116.1167], "yogyakarta": [-7.7956, 110.3695],
  "manila": [14.5995, 120.9842], "cebu": [10.3157, 123.8854],
  "boracay": [11.9674, 121.9248], "palawan": [9.8349, 118.7384],
  "luang prabang": [19.8845, 102.1348], "vientiane": [17.9757, 102.6331],
  "chengdu": [30.5728, 104.0668], "xian": [34.3416, 108.9398],
  "hangzhou": [30.2741, 120.1551], "guilin": [25.2736, 110.2899],
  "macau": [22.1987, 113.5439], "kaohsiung": [22.6273, 120.3014],
  "osaka": [34.6937, 135.5023], "kyoto": [35.0116, 135.7681],
  "hiroshima": [34.3853, 132.4553], "sapporo": [43.0618, 141.3545],
  "fukuoka": [33.5904, 130.4017], "nara": [34.6851, 135.8050],
  "guadalajara": [20.6597, -103.3496], "monterrey": [25.6866, -100.3161],
  "tulum": [20.2114, -87.4654], "cabo san lucas": [22.8905, -109.9167],
  "playa del carmen": [20.6296, -87.0739], "cancun": [21.1619, -86.8515],
  "medellin": [6.2442, -75.5812], "cartagena": [10.3910, -75.4794],
  "cusco": [13.5319, -71.9675], "montevideo": [-34.9011, -56.1645],
  "quito": [-0.1807, -78.4678], "la paz": [-16.5000, -68.1193],
  "salvador": [-12.9714, -38.5014], "brasilia": [-15.7801, -47.9292],
  "asuncion": [-25.2637, -57.5759], "lima": [-12.0464, -77.0428],
  "mendoza": [-32.8908, -68.8272], "santiago": [-33.4489, -70.6693],
  "bora bora": [-16.5004, -151.7415], "tahiti": [-17.6509, -149.4260],
  "fiji": [-18.1416, 178.4419], "maldives": [3.2028, 73.2207],
  "seychelles": [-4.6796, 55.4920], "mauritius": [-20.3484, 57.5522],
  "reunion": [-21.1151, 55.5364], "zanzibar": [-6.1659, 39.2026],
  "kampala": [0.3476, 32.5825], "mombasa": [-4.0435, 39.6682],
  "dar es salaam": [-6.7924, 39.2083], "sharm el sheikh": [27.9158, 34.3300],
  "hurghada": [27.2578, 33.8117], "luxor": [25.6872, 32.6396],
  "fez": [34.0181, -5.0078], "tangier": [35.7595, -5.8340],
  "tunis": [36.8065, 10.1815], "algiers": [36.7538, 3.0588],
  "accra": [5.6037, -0.1870], "abuja": [9.0765, 7.3986],
  "dakar": [14.7167, -17.4677], "addis ababa": [9.0320, 38.7469],
  "kigali": [-1.9441, 30.0619], "harare": [-17.8252, 31.0335],
  "nashville": [36.1627, -86.7816], "atlanta": [33.7490, -84.3880],
  "dallas": [32.7767, -96.7970], "houston": [29.7604, -95.3698],
  "phoenix": [33.4484, -112.0740], "san diego": [32.7157, -117.1611],
  "minneapolis": [44.9778, -93.2650], "detroit": [42.3314, -83.0458],
  "philadelphia": [39.9526, -75.1652], "orlando": [28.5383, -81.3792],
  "salt lake city": [40.7608, -111.8910], "kansas city": [39.0997, -94.5786],
  "pittsburgh": [40.4406, -79.9959], "portland": [45.5051, -122.6750],
  "denver": [39.7392, -104.9903], "austin": [30.2672, -97.7431],
  "calgary": [51.0447, -114.0719], "ottawa": [45.4215, -75.6919],
  "quebec city": [46.8139, -71.2082], "edmonton": [53.5461, -113.4938],
  "winnipeg": [49.8951, -97.1384],
};

// ── HyDE (Hypothetical Document Embeddings) ──────────────────────────────────
// For each user query, Gemini Flash Lite generates a short structured caption
// using the same vocabulary stored in room_embeddings. Embedding that caption
// rather than the raw query bridges vocabulary gaps ("multiple sinks" → "double
// sinks"), handles abstract terms ("spa bathroom", "romantic suite"), and
// naturally strips negations ("no carpet" → bedroom photo type only).
// Results are cached in-memory (4h TTL) — repeated queries pay zero overhead.
const HYDE_TTL  = 4 * 60 * 60 * 1000;   // 4 hours
const hydeCache = new Map();             // cacheKey → { hypothetical, embedding, ts }

function hydeKey(q) {
  return `v1:${q.toLowerCase().trim().replace(/\s+/g, ' ')}`;
}

// Extract negated concepts for logging and future post-filter work.
// e.g. "double sinks without bathtub" → { negations: ["bathtub"], positiveQuery: "double sinks" }
function extractNegations(query) {
  const negated = [];
  const PATTERNS = [
    /\bno\s+([\w][\w\s]{1,30}?)(?=\s*[,.]|\s+(?:and|but|with|just|only|please)|\s*$)/i,
    /\bwithout\s+(?:a\s+|an\s+)?([\w][\w\s]{1,30}?)(?=\s*[,.]|\s+(?:and|but|with|just|only|please)|\s*$)/i,
    /\bnot\s+(?:a\s+|an\s+)?([\w][\w\s]{1,30}?)(?=\s*[,.]|\s+(?:and|but|with|just|only|please)|\s*$)/i,
    /\bavoid(?:ing)?\s+([\w][\w\s]{1,30}?)(?=\s*[,.]|\s+(?:and|but|with|just|only|please)|\s*$)/i,
  ];
  let cleaned = query;
  for (const p of PATTERNS) {
    const gp = new RegExp(p.source, 'gi');
    let m;
    while ((m = gp.exec(query)) !== null) {
      const concept = m[1].trim().toLowerCase();
      if (concept.length > 1) negated.push(concept);
    }
    cleaned = cleaned.replace(new RegExp(p.source, 'gi'), ' ');
  }
  return { negations: negated, positiveQuery: cleaned.replace(/\s+/g, ' ').trim() || null };
}

// Derive intentType from the hypothetical PHOTO TYPE field, with keyword fallback.
function extractIntentType(hydeText, query) {
  if (hydeText) {
    const m = hydeText.match(/^PHOTO TYPE:\s*(\w[\w ]*)/m);
    if (m) {
      const pt = m[1].toLowerCase().trim();
      if (pt === 'bathroom')    return 'bathroom';
      if (pt === 'bedroom')     return 'bedroom';
      if (pt === 'view')        return 'view';
      if (pt === 'living area') return 'living area';
    }
  }
  const q = query.toLowerCase();
  if (/\b(baths?|tubs?|showers?|sinks?|toilets?|bidet|bathroom|soaking|jacuzzi|spa)\b/.test(q)) return 'bathroom';
  if (/\b(beds?|bedroom|sleep|pillow|king|queen|twin|mattress)\b/.test(q)) return 'bedroom';
  if (/\b(views?|balcon(y|ies)|terrace|window|skyline|ocean|sea|city view)\b/.test(q)) return 'view';
  if (/\b(living|sofa|lounge|sitting|couch|armchair)\b/.test(q)) return 'living area';
  return null;
}

// Regex → DB feature flags (shared by /api/vsearch strict + soft modes)
const VSEARCH_FEATURE_FLAGS = [
  { label: 'double sinks',             flag: 'double_sinks',           queryMatch: /\bdouble sinks?\b|\btwo sinks?\b|\bdual sinks?\b|\btwin sinks?\b|\bmultiple sinks?\b|\bseveral sinks?\b/i },
  { label: 'soaking tub',              flag: 'soaking_tub',            queryMatch: /\b(soaking|freestanding|clawfoot)\s*tub\b/i },
  { label: 'bathtub',                  flag: 'bathtub',                queryMatch: /\bbathtub\b|\bbath tub\b/i },
  { label: 'walk-in shower',           flag: 'walk_in_shower',         queryMatch: /\bwalk[- ]in shower\b/i },
  { label: 'rainfall shower',          flag: 'rainfall_shower',        queryMatch: /\brainfall shower\b/i },
  { label: 'jacuzzi',                  flag: 'in_room_jacuzzi',        queryMatch: /\bjacuzzi\b|\bin[- ]room hot tub\b|\bwhirlpool\b/i },
  { label: 'bidet',                    flag: 'bidet',                  queryMatch: /\bbidet\b/i },
  { label: 'king bed',                 flag: 'king_bed',               queryMatch: /\bking(?:[- ]size(?:d)?)?\s*bed\b|\bking bed\b/i },
  { label: 'four-poster bed',          flag: 'four_poster_bed',        queryMatch: /\bfour[- ]poster\b/i },
  { label: 'walk-in closet',           flag: 'walk_in_closet',         queryMatch: /\bwalk[- ]in closet\b|\bdressing room\b/i },
  { label: 'separate living area',     flag: 'separate_living_area',   queryMatch: /\bseparate living\b|\bliving room\b/i },
  { label: 'high ceilings',            flag: 'high_ceilings',          queryMatch: /\bhigh ceilings?\b|\bvaulted ceiling\b/i },
  { label: 'floor-to-ceiling windows', flag: 'floor_to_ceiling_windows', queryMatch: /\bfloor[- ]to[- ]ceiling windows?\b|\bpanoramic windows?\b/i },
  { label: 'balcony',                  flag: 'balcony',                queryMatch: /\bbalcon(y|ies)\b/i },
  { label: 'terrace',                  flag: 'terrace',                queryMatch: /\bterrace\b/i },
  { label: 'Eiffel Tower view',        flag: 'landmark_view',          queryMatch: /\bEiffel Tower\b|\bEiffel view\b/i },
  { label: 'city view',                flag: 'city_view',              queryMatch: /\bcity view\b/i },
  { label: 'garden view',              flag: 'garden_view',            queryMatch: /\bgarden view\b/i },
  { label: 'river view',               flag: 'river_view',             queryMatch: /\briver view\b|\bSeine view\b|\bThames view\b/i },
  { label: 'fireplace',                flag: 'fireplace',              queryMatch: /\bfireplace\b/i },
];

const SOFT_FLAG_COVERAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const softFlagCoverageCache = new Map();

function getCachedSoftFlagCoverage(city, flagKeys) {
  const key = `${city}::${[...flagKeys].sort().join(',')}`;
  const hit = softFlagCoverageCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  return null;
}

function setCachedSoftFlagCoverage(city, flagKeys, data) {
  const key = `${city}::${[...flagKeys].sort().join(',')}`;
  softFlagCoverageCache.set(key, { data, expires: Date.now() + SOFT_FLAG_COVERAGE_CACHE_TTL_MS });
}

async function fetchFlagCoverageBatched(city, flagKeys, hotelIds, fetchClient) {
  const BATCH = 400;
  const hotelFlagHits = new Map();
  const n = flagKeys.length;
  if (n === 0) return new Map();

  for (let i = 0; i < hotelIds.length; i += BATCH) {
    const batch = hotelIds.slice(i, i + BATCH);
    const { data, error } = await fetchClient
      .from('room_types_index')
      .select('hotel_id, features')
      .eq('city', city)
      .in('hotel_id', batch);
    if (error) {
      console.error('[soft_flags] coverage batch error:', error.message);
      throw error;
    }
    for (const row of data || []) {
      if (!hotelFlagHits.has(row.hotel_id)) hotelFlagHits.set(row.hotel_id, new Set());
      const hits = hotelFlagHits.get(row.hotel_id);
      for (const fk of flagKeys) {
        if (row.features && row.features[fk] === true) hits.add(fk);
      }
    }
  }

  const coverageMap = new Map();
  for (const [hotelId, hits] of hotelFlagHits) {
    coverageMap.set(hotelId, hits.size / n);
  }
  return coverageMap;
}

function buildSoftFlagCoveragePromise(city, detectedFlagKeys, fetchClient) {
  if (!detectedFlagKeys.length) return Promise.resolve(null);
  const cached = getCachedSoftFlagCoverage(city, detectedFlagKeys);
  if (cached) return Promise.resolve(cached);

  const cap = parseInt(process.env.SOFT_FLAG_HOTEL_CAP || '1500', 10);
  return fetchClient
    .from('hotels_cache')
    .select('hotel_id')
    .eq('city', city)
    .then(({ data, error }) => {
      if (error) throw error;
      const ids = (data || []).map(h => h.hotel_id).slice(0, cap);
      return fetchFlagCoverageBatched(city, detectedFlagKeys, ids, fetchClient);
    })
    .then((map) => {
      setCachedSoftFlagCoverage(city, detectedFlagKeys, map);
      return map;
    })
    .catch((e) => {
      console.error('[soft_flags] coverage fetch failed:', e.message);
      return null;
    });
}

/** How many detected query flags are true on this photo's feature_flags jsonb. */
function countPhotoFlagMatches(featureFlags, detectedFlagKeys) {
  if (!featureFlags || !detectedFlagKeys?.length) return 0;
  let n = 0;
  for (const fk of detectedFlagKeys) {
    if (featureFlags[fk] === true) n++;
  }
  return n;
}

/** In-place sort: confirmed flags first, then intent, then similarity. */
function sortHotelPhotosForDisplay(photos, intentType, detectedFlagKeys, flagMode) {
  const useFlagOrder = detectedFlagKeys.length > 0 && flagMode === "soft";
  photos.sort((a, b) => {
    if (useFlagOrder) {
      const fa = countPhotoFlagMatches(a.feature_flags, detectedFlagKeys);
      const fb = countPhotoFlagMatches(b.feature_flags, detectedFlagKeys);
      if (fb !== fa) return fb - fa;
    }
    const aIntent = (!intentType || a.photo_type === intentType) ? 1 : 0;
    const bIntent = (!intentType || b.photo_type === intentType) ? 1 : 0;
    if (bIntent !== aIntent) return bIntent - aIntent;
    return b.similarity - a.similarity;
  });
}

// System prompt for HyDE caption generation.
const HYDE_SYSTEM_PROMPT = `You are a hotel room photo caption assistant for a visual search engine.
Given a user search query about hotel rooms, generate a MINIMAL structured caption representing what a matching photo would look like.

RULES:
- Include ONLY fields directly implied by the query. Do NOT add anything the user did not request.
- Use ONLY the vocabulary listed for each field.
- Always output in English.
- Strip negations ("no carpet", "without bathtub") — only describe what the ideal room SHOULD have.
- If the query is NOT about visual room features (price, location, hotel brand, pet policy, parking, breakfast, Wi-Fi), output exactly: NOT_ROOM_QUERY

VALID FIELDS AND VALUES:
PHOTO TYPE: bedroom | bathroom | living area | view | other
SINKS: single sink | double sinks | triple sinks
COUNTER SPACE: small counter | large counter
BATHTUB: built-in tub | freestanding tub | soaking tub
SHOWER: rainfall shower | walk-in shower | shower over bath | steam shower
SEPARATE TOILET ROOM: yes
BED: single bed | twin beds | double bed | queen bed | king bed
WALK-IN CLOSET: yes
NATURAL LIGHT: bright natural light | low light
WINDOWS: large windows | floor-to-ceiling windows | small windows
VIEW: city view | Eiffel Tower view | garden view | pool view | sea view | courtyard view
BALCONY OR TERRACE: yes
SIZE IMPRESSION: spacious | compact
SEPARATE LIVING AREA: yes
SOFA: yes
FIREPLACE: yes
IN-ROOM HOT TUB OR JACUZZI: yes
DISTINCTIVE FEATURES: [brief description]

EXAMPLES:
Query: "double sinks"
PHOTO TYPE: bathroom
SINKS: double sinks

Query: "two sinks"
PHOTO TYPE: bathroom
SINKS: double sinks

Query: "multiple sinks"
PHOTO TYPE: bathroom
SINKS: double sinks

Query: "soaking tub"
PHOTO TYPE: bathroom
BATHTUB: soaking tub

Query: "freestanding bathtub"
PHOTO TYPE: bathroom
BATHTUB: freestanding tub

Query: "big windows city view"
PHOTO TYPE: bedroom
WINDOWS: large windows
VIEW: city view

Query: "floor to ceiling windows"
PHOTO TYPE: bedroom
WINDOWS: floor-to-ceiling windows

Query: "king bed lots of natural light"
PHOTO TYPE: bedroom
BED: king bed
NATURAL LIGHT: bright natural light

Query: "spa bathroom"
PHOTO TYPE: bathroom
BATHTUB: soaking tub
SHOWER: rainfall shower

Query: "room with balcony"
PHOTO TYPE: bedroom
BALCONY OR TERRACE: yes

Query: "fireplace"
PHOTO TYPE: bedroom
FIREPLACE: yes

Query: "romantic suite"
PHOTO TYPE: bedroom
SIZE IMPRESSION: spacious
SEPARATE LIVING AREA: yes

Query: "modern bathroom with rainfall shower"
PHOTO TYPE: bathroom
SHOWER: rainfall shower
DISTINCTIVE FEATURES: modern style

Query: "views of the Eiffel Tower"
PHOTO TYPE: view
VIEW: Eiffel Tower view

Query: "double sinks no bathtub"
PHOTO TYPE: bathroom
SINKS: double sinks

Query: "hotel near Eiffel Tower"
NOT_ROOM_QUERY

Query: "cheap price"
NOT_ROOM_QUERY

Query: "pet friendly"
NOT_ROOM_QUERY

Now generate for this query (output ONLY the caption, no explanation):`;

// Generate a hypothetical caption via Gemini Flash Lite. Returns null on failure
// or when the query is not about room visuals — callers fall back to raw query.
async function hydeGenerate(query, geminiKey) {
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: HYDE_SYSTEM_PROMPT }] },
          contents: [{ parts: [{ text: `Query: "${query}"` }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 150 },
        }),
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!resp.ok) { console.warn(`[hyde] HTTP ${resp.status}`); return null; }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text || text === 'NOT_ROOM_QUERY') return null;
    return text;
  } catch (err) {
    console.warn(`[hyde] timeout/error (falling back to raw query): ${err.message}`);
    return null;
  }
}

function resolveCoords(city) {
  const key = city.trim().toLowerCase();
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  for (const [k, v] of Object.entries(CITY_COORDS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

async function liteGet(path) {
  const r = await fetch(`https://api.liteapi.travel/v3.0${path}`, {
    headers: { "X-API-Key": LITEAPI_KEY, "accept": "application/json" }
  });
  return { ok: r.ok, status: r.status, data: await r.json() };
}

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use((_, res, next) => { res.setHeader("X-Robots-Tag", "noindex, nofollow"); next(); });

// ── Password gate (only active when SITE_PASSWORD env var is set) ─────────────
if (SITE_PASSWORD) {
  // Handle login form submission
  app.post("/auth", express.urlencoded({ extended: false }), (req, res) => {
    const entered = crypto.createHash("sha256")
      .update((req.body.password || "").trim() + "rm-salt-2026")
      .digest("hex");
    if (entered === SITE_PASSWORD_HASH) {
      res.setHeader("Set-Cookie",
        `rm_gate=${SITE_PASSWORD_HASH}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict`);
      return res.redirect("/");
    }
    return res.send(loginHtml("Wrong password — please try again."));
  });

  // Gate the frontend — intercept GET / before static middleware serves index.html
  app.get("/", (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.rm_gate === SITE_PASSWORD_HASH) return next();
    return res.send(loginHtml());
  });
}

app.use(express.static(path.join(__dirname, "client")));

app.get("/api/health", (_, res) => res.json({ status: "ok" }));

// ── Photo fields debug — shows raw LiteAPI photo object structure ─────────────
app.get("/api/debug-photos", async (req, res) => {
  const hotelId = req.query.hotelId;
  if (!hotelId) return res.status(400).json({ error: "hotelId required" });
  const r = await liteGet(`/data/hotel?hotelId=${hotelId}`);
  if (!r.ok) return res.status(500).json({ error: "LiteAPI failed", status: r.status });
  const detail = r.data?.data || {};
  const rooms = detail.rooms || [];

  // Scan top-level hotel fields for any photo-like arrays (hotel gallery, exterior, lobby, etc.)
  const topLevelPhotoFields = {};
  for (const [k, v] of Object.entries(detail)) {
    if (k === "rooms") continue;
    if (Array.isArray(v) && v.length > 0) {
      const first = v[0];
      if (typeof first === "string" && (first.includes("http") || first.includes(".jpg") || first.includes(".png"))) {
        topLevelPhotoFields[k] = { count: v.length, sample: v.slice(0, 3) };
      } else if (typeof first === "object" && first !== null && (first.url || first.hd_url || first.imageUrl)) {
        topLevelPhotoFields[k] = { count: v.length, sampleFields: Object.keys(first), sample: v.slice(0, 2) };
      }
    }
  }

  // All top-level keys (excluding rooms) so we know what the response shape is
  const topLevelKeys = Object.keys(detail).filter(k => k !== "rooms");

  const sample = rooms.slice(0, 3).map(room => ({
    roomName: room.roomName || room.name,
    photoCount: (room.photos||[]).length,
    firstPhotoFields: room.photos?.[0] ? Object.keys(room.photos[0]) : [],
    samplePhotos: (room.photos||[]).slice(0, 3).map(p => ({
      url: (p.url||p.hd_url||"").slice(-40),
      ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'url' && k !== 'hd_url')),
    })),
  }));
  res.json({ hotelId, topLevelKeys, topLevelPhotoFields, roomCount: rooms.length, sample });
});

// ── Debug rates for a single hotel ───────────────────────────────────────────
// Shows parsed room types AND raw LiteAPI response for full structure inspection.
// Usage: GET /api/debug-rates?hotelId=lp6556dea4&checkin=2026-03-30&checkout=2026-04-02
app.get("/api/debug-rates", async (req, res) => {
  const { hotelId, checkin, checkout } = req.query;
  if (!hotelId || !checkin || !checkout) return res.status(400).json({ error: "hotelId, checkin, checkout required" });
  const nights = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);
  const liteRes = await fetch("https://api.liteapi.travel/v3.0/hotels/rates", {
    method: "POST",
    headers: { "X-API-Key": LITEAPI_KEY, "Content-Type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ hotelIds: [hotelId], checkin, checkout, currency: "EUR", guestNationality: "US",
      occupancies: [{ adults: 2 }], maxRatesPerHotel: 20, roomMapping: true, timeout: 22 }),
  });
  const json = await liteRes.json();
  const ratesList = json?.data?.rates ?? json?.data ?? json?.rates ?? [];
  const hotel = ratesList[0];
  if (!hotel) return res.json({ httpStatus: liteRes.status, foundHotel: false, raw: json });
  const roomTypes = (hotel.roomTypes || []).map(rt => {
    const firstRate = rt.rates?.[0] || {};
    // Check multiple possible price locations in LiteAPI response
    const fromRetailTotal  = firstRate.retailRate?.total?.[0]?.amount;
    const fromRetailNet    = firstRate.retailRate?.net?.[0]?.amount;
    const fromTotal        = firstRate.total;
    const fromNet          = firstRate.net;
    const resolved = fromRetailTotal ?? fromRetailNet ?? fromTotal ?? fromNet ?? null;
    return {
      roomTypeId:      rt.roomTypeId,
      rateCount:       rt.rates?.length,
      mappedRoomId:    firstRate.mappedRoomId,
      name:            firstRate.name,
      retailTotal:     fromRetailTotal,
      retailNet:       fromRetailNet,
      directTotal:     fromTotal,
      directNet:       fromNet,
      resolvedAmount:  resolved,
      perNight:        resolved ? Math.round(resolved / nights) : null,
    };
  });
  res.json({ httpStatus: liteRes.status, hotelId, nights, roomTypeCount: roomTypes.length, roomTypes, rawKeys: Object.keys(json) });
});

// ── Gemini model debug endpoint ───────────────────────────────────────────────
app.get("/api/debug-gemini", async (req, res) => {
  const GEMINI_KEY = process.env.GEMINI_KEY || "";
  if (!GEMINI_KEY) return res.status(500).json({ error: "GEMINI_KEY not set" });

  const models = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash-lite-preview-06-17",
    "gemini-2.5-flash-lite-001",
    "gemini-2.5-flash",
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
  ];

  // Tiny valid 2x2 red PNG in base64
  const testB64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==";
  const testMime = "image/png";

  const results = [];

  for (const model of models) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [
              { inline_data: { mime_type: testMime, data: testB64 } },
              { text: "What colour is this image? One word answer." }
            ]}],
            generationConfig: { maxOutputTokens: 10 }
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      const data = await r.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
      const err  = data?.error?.message || null;
      results.push({ model, status: r.status, ok: r.ok, response: text, error: err });
      console.log(`[debug-gemini] ${model}: ${r.status} ${text || err || ""}`);
    } catch(e) {
      results.push({ model, status: "timeout", ok: false, error: e.message });
      console.log(`[debug-gemini] ${model}: ERROR ${e.message}`);
    }
  }

  const working = results.filter(r => r.ok && r.response);

  // Test embedding models
  const embedModels = [
    "text-embedding-004",
    "text-embedding-005",
    "gemini-embedding-001",
    "embedding-001",
    "text-multilingual-embedding-002",
  ];
  const embedResults = [];
  for (const model of embedModels) {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: { parts: [{ text: "test hotel room" }] } }),
          signal: AbortSignal.timeout(8000),
        }
      );
      const data = await r.json();
      const dims = data?.embedding?.values?.length || null;
      const err  = data?.error?.message || null;
      embedResults.push({ model, status: r.status, ok: r.ok, dims, error: err });
      console.log(`[debug-gemini] embed ${model}: ${r.status} dims=${dims} ${err||""}`);
    } catch(e) {
      embedResults.push({ model, status: "timeout", ok: false, error: e.message });
    }
  }

  res.json({
    visionResults: results,
    workingVision: working.map(r => r.model),
    embedResults,
    workingEmbeds: embedResults.filter(r => r.ok && r.dims).map(r => `${r.model} (${r.dims} dims)`),
  });
});

// ── Deep debug endpoint — tests all LiteAPI params for a city ─────────────────
app.get("/api/debug-city", async (req, res) => {
  const city = (req.query.city || "Paris").trim();
  const report = { city, tests: [] };

  async function test(label, path) {
    try {
      const r = await liteGet(path);
      const data = r.data?.data || r.data || [];
      const count = Array.isArray(data) ? data.length : (r.data?.total ?? "?");
      const sample = Array.isArray(data) && data[0]
        ? { id: data[0].id || data[0].hotelId, name: data[0].name }
        : null;
      report.tests.push({ label, status: r.status, count, sample, ok: r.ok });
      console.log(`[debug] ${label}: status=${r.status} count=${count}`);
    } catch(e) {
      report.tests.push({ label, error: e.message });
      console.log(`[debug] ${label}: ERROR ${e.message}`);
    }
  }

  const coords = resolveCoords(city);
  const cc = { "paris":"FR","london":"GB","new york city":"US","nyc":"US",
                "tokyo":"JP","sydney":"AU","dubai":"AE","barcelona":"ES" }[city.toLowerCase()] || "";

  // ── Full hotel catalog tests ───────────────────────────────────────────────
  await test("hotels: countryCode+cityName limit=50",
    `/data/hotels?countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=50`);

  await test("hotels: countryCode+cityName limit=200",
    `/data/hotels?countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=200`);

  if (coords) {
    await test("hotels: lat/lng radius=15000m limit=50",
      `/data/hotels?latitude=${coords[0]}&longitude=${coords[1]}&radius=15000&limit=50`);
    await test("hotels: lat/lng radius=30000m limit=200",
      `/data/hotels?latitude=${coords[0]}&longitude=${coords[1]}&radius=30000&limit=200`);
  }

  // ── Room-search index tests ────────────────────────────────────────────────
  const q = encodeURIComponent("hotel room");

  await test("room-search: countryCode+cityName limit=50",
    `/data/hotels/room-search?query=${q}&countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=50`);

  await test("room-search: countryCode+cityName limit=100",
    `/data/hotels/room-search?query=${q}&countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=100`);

  if (coords) {
    await test("room-search: lat/lng radius=30 limit=50",
      `/data/hotels/room-search?query=${q}&latitude=${coords[0]}&longitude=${coords[1]}&radius=30&limit=50`);
    await test("room-search: lat/lng radius=50 limit=100",
      `/data/hotels/room-search?query=${q}&latitude=${coords[0]}&longitude=${coords[1]}&radius=50&limit=100`);
  }

  await test("room-search: city param only limit=50",
    `/data/hotels/room-search?query=${q}&city=${encodeURIComponent(city)}&limit=50`);

  await test("room-search: no geo limit=100",
    `/data/hotels/room-search?query=${q}&limit=100`);

  await test("room-search: countryCode+cityName limit=200",
    `/data/hotels/room-search?query=${q}&countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=200`);

  // Broader queries as suggested by LiteAPI docs
  const qBroad = encodeURIComponent("room OR suite OR bedroom");
  await test("room-search: broad OR query countryCode+cityName limit=200",
    `/data/hotels/room-search?query=${qBroad}&countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=200`);

  // Full catalog with high limit
  await test("hotels: countryCode+cityName limit=500",
    `/data/hotels?countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=500`);

  await test("hotels: countryCode+cityName limit=1000",
    `/data/hotels?countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=1000`);

  // Check total count via offset
  const r500 = await liteGet(`/data/hotels?countryCode=${cc}&cityName=${encodeURIComponent(city)}&limit=1&offset=0`);
  report.totalHotelsInCatalog = r500.data?.total || r500.data?.count || "unknown";
  console.log(`[debug] total hotels in LiteAPI catalog for ${city}: ${report.totalHotelsInCatalog}`);

  // ── Summary ───────────────────────────────────────────────────────────────
  const roomSearchMax = Math.max(...report.tests
    .filter(t => t.label.includes("room-search"))
    .map(t => typeof t.count === "number" ? t.count : 0));
  const hotelCatalogMax = Math.max(...report.tests
    .filter(t => t.label.includes("hotels:"))
    .map(t => typeof t.count === "number" ? t.count : 0));

  report.summary = {
    hotelCatalogMax,
    roomSearchIndexMax: roomSearchMax,
    gap: `${roomSearchMax} room-search vs ${hotelCatalogMax} full catalog`,
    conclusion: roomSearchMax < hotelCatalogMax * 0.1
      ? "Room-search index is VERY sparse for this city (<10% of catalog)"
      : roomSearchMax < hotelCatalogMax * 0.5
      ? "Room-search index is PARTIAL for this city (<50% of catalog)"
      : "Room-search index covers most of the catalog"
  };

  res.json(report);
});

// ── City autocomplete via Geoapify (free tier: 3000 req/day, no card needed) ──
// Get a free key at: https://myprojects.geoapify.com
const GEOAPIFY_KEY = process.env.GEOAPIFY_KEY || "";

app.get("/api/places", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q || q.length < 2) return res.json({ places: [] });

  // No key — return empty, frontend will just have no suggestions
  if (!GEOAPIFY_KEY) {
    console.warn("[places] GEOAPIFY_KEY not set");
    return res.json({ places: [] });
  }

  try {
    const url = "https://api.geoapify.com/v1/geocode/autocomplete?" + new URLSearchParams({
      text:    q,
      type:    "city",
      limit:   8,
      format:  "json",
      apiKey:  GEOAPIFY_KEY,
    });
    const r    = await fetch(url);
    const data = await r.json();

    const places = (data.results || [])
      .filter(p => p.city || p.name)
      .map(p => ({
        name:         p.city || p.name || "",
        country:      p.country || "",
        state:        p.state   || "",
        country_code: (p.country_code || "").toUpperCase() || null,
        lat:          p.lat ?? null,
        lng:          p.lon ?? null,
      }))
      // Deduplicate by name+country
      .filter((p, i, arr) =>
        arr.findIndex(x => x.name === p.name && x.country === p.country) === i
      );

    res.json({ places });
  } catch (err) {
    console.error("[places]", err.message);
    res.json({ places: [] });
  }
});


// ── Main search endpoint ───────────────────────────────────────────────────────
app.get("/api/room-search", async (req, res) => {
  const { query, city } = req.query;
  if (!query || !city) return res.status(400).json({ error: "query and city are required" });
  if (!LITEAPI_KEY)    return res.status(500).json({ error: "LITEAPI_KEY not configured" });

  // ── Step 1: room-search with 3-attempt strategy to maximise results ─────────
  const coords = resolveCoords(city);

  async function trySearch(extraParams) {
    const p = new URLSearchParams({ query, limit: 50, ...extraParams });
    // Remove empty values
    for (const [k, v] of [...p.entries()]) { if (v === "" || v === undefined) p.delete(k); }
    console.log(`[search] trying: ${p.toString()}`);
    const r = await liteGet(`/data/hotels/room-search?${p}`);
    const count = r.data?.data?.length ?? 0;
    console.log(`[search] got ${count} hotels`);
    return r.ok ? (r.data?.data || []) : [];
  }

  // Look up country code for the city
  const COUNTRY_CODES = {
    // Europe
    "paris": "FR", "nice": "FR", "lyon": "FR", "marseille": "FR", "bordeaux": "FR",
    "london": "GB", "edinburgh": "GB", "manchester": "GB", "liverpool": "GB",
    "barcelona": "ES", "madrid": "ES", "seville": "ES", "valencia": "ES", "ibiza": "ES",
    "rome": "IT", "milan": "IT", "florence": "IT", "venice": "IT", "naples": "IT",
    "amsterdam": "NL", "berlin": "DE", "munich": "DE", "hamburg": "DE", "frankfurt": "DE",
    "vienna": "AT", "zurich": "CH", "geneva": "CH", "brussels": "BE",
    "prague": "CZ", "budapest": "HU", "warsaw": "PL", "krakow": "PL",
    "athens": "GR", "lisbon": "PT", "porto": "PT", "oslo": "NO",
    "stockholm": "SE", "copenhagen": "DK", "helsinki": "FI", "dublin": "IE",
    "istanbul": "TR", "reykjavik": "IS",
    // Americas
    "new york city": "US", "new york": "US", "nyc": "US", "los angeles": "US",
    "chicago": "US", "miami": "US", "san francisco": "US", "las vegas": "US",
    "seattle": "US", "boston": "US", "washington dc": "US", "austin": "US",
    "denver": "US", "nashville": "US", "atlanta": "US", "dallas": "US",
    "houston": "US", "portland": "US", "new orleans": "US", "tacoma": "US",
    "toronto": "CA", "vancouver": "CA", "montreal": "CA",
    "mexico city": "MX", "cancun": "MX",
    "rio de janeiro": "BR", "sao paulo": "BR", "buenos aires": "AR",
    "bogota": "CO", "lima": "PE", "santiago": "CL",
    // Asia
    "tokyo": "JP", "osaka": "JP", "kyoto": "JP",
    "seoul": "KR", "beijing": "CN", "shanghai": "CN",
    "hong kong": "HK", "singapore": "SG",
    "bangkok": "TH", "phuket": "TH", "chiang mai": "TH",
    "bali": "ID", "jakarta": "ID", "kuala lumpur": "MY",
    "mumbai": "IN", "delhi": "IN", "goa": "IN",
    "dubai": "AE", "abu dhabi": "AE", "doha": "QA",
    // Africa & Middle East
    "cairo": "EG", "marrakech": "MA", "cape town": "ZA",
    "nairobi": "KE", "tel aviv": "IL",
    // Oceania
    "sydney": "AU", "melbourne": "AU", "auckland": "NZ",
  };
  const countryCode = COUNTRY_CODES[city.trim().toLowerCase()] || "";

  // Attempt 1: countryCode + cityName (recommended by LiteAPI support)
  let searchData = countryCode
    ? await trySearch({ countryCode, cityName: city })
    : [];

  // Attempt 2: lat/lng with radius
  if (searchData.length < 15 && coords) {
    const r2 = await trySearch({ latitude: coords[0], longitude: coords[1], radius: 30 });
    if (r2.length > searchData.length) {
      searchData = r2;
      console.log(`[search] lat/lng attempt better, using it`);
    }
  }

  // Attempt 3: city name only
  if (searchData.length < 15) {
    const r3 = await trySearch({ city });
    if (r3.length > searchData.length) {
      searchData = r3;
      console.log(`[search] city-name attempt better, using it`);
    }
  }

  // Attempt 4: no geo filter
  if (searchData.length < 15) {
    const r4 = await trySearch({});
    if (r4.length > searchData.length) {
      searchData = r4;
      console.log(`[search] no-geo attempt better, using it`);
    }
  }

  console.log(`[search] final pool: ${searchData.length} hotels`);
  if (searchData.length === 0 && !countryCode && !coords) {
    return res.json({ hotels: [], query, city });
  }

  // Normalise similarity scores to 30–95% range
  const rawScores = searchData.map(h => h.rooms?.[0]?.similarity || 0);
  const maxS = Math.max(...rawScores) || 1;
  const minS = Math.min(...rawScores.filter(s => s > 0)) || 0;
  const norm = s => s > 0 ? Math.round(30 + ((s - minS) / (maxS - minS || 1)) * 65) : null;

  // Build a map of hotelId → best match info from room-search
  const bestMatchMap = {};
  const matchedIds = new Set();
  searchData.forEach(h => {
    const r = h.rooms?.[0];
    bestMatchMap[h.id] = {
      roomName: r?.room_name || "",
      imageUrl: r?.image_url || "",
      score:    norm(r?.similarity || 0),
    };
    matchedIds.add(h.id);
  });

  // ── Hybrid: pad with regular hotel list if room-search returned < 15 ─────────
  let paddingHotels = [];
  if (searchData.length < 15) {
    const needed = 20 - searchData.length;
    const padParams = new URLSearchParams({ limit: needed + 5 }); // fetch a few extra to filter dupes
    if (countryCode) { padParams.set("countryCode", countryCode); padParams.set("cityName", city); }
    else if (coords)  { padParams.set("latitude", coords[0]); padParams.set("longitude", coords[1]); padParams.set("radius", 15000); }
    else               { padParams.set("city", city); }

    const padRes = await liteGet(`/data/hotels?${padParams}`);
    if (padRes.ok) {
      paddingHotels = (padRes.data?.data || [])
        .filter(h => !matchedIds.has(h.id || h.hotelId))
        .slice(0, needed);
      console.log(`[search] hybrid: adding ${paddingHotels.length} unmatched hotels to pad results`);
    }
  }

  // ── Step 2: parallel-fetch hotel details ─────────────────────────────────────
  const top20 = searchData.slice(0, 20);
  const detailResults = await Promise.all([
    ...top20.map(h => liteGet(`/data/hotel?hotelId=${h.id}`).catch(() => null)),
    ...paddingHotels.map(h => liteGet(`/data/hotel?hotelId=${h.id || h.hotelId}`).catch(() => null)),
  ]);
  const top20Details     = detailResults.slice(0, top20.length);
  const paddingDetails   = detailResults.slice(top20.length);

  // ── Step 3: build structured hotel + room-type response ──────────────────────
  function buildHotel(h, detail, best, isMatched) {

    // Group detail rooms by roomName, collecting all photos per type
    const roomTypeMap = new Map();
    for (const room of (detail?.rooms || [])) {
      const name    = room.roomName || room.name || "Room";
      const photos  = (room.photos || []).map(p => p.url || p.hd_url || "").filter(Boolean);
      const size    = room.roomSizeSquare
        ? `${room.roomSizeSquare} ${room.roomSizeUnit || "sqm"}`
        : "";
      const amenities = (room.roomAmenities || []).map(a => a.name).filter(Boolean).slice(0, 5);
      const beds    = (room.bedTypes || []).map(b => `${b.quantity}× ${b.bedType}`).join(", ");
      const views   = (room.views || []).map(v => v.view).filter(Boolean).join(", ");

      if (!roomTypeMap.has(name)) {
        roomTypeMap.set(name, { name, photos: [], size, amenities, beds, views, score: null });
      }
      // Merge photos, deduplicate by URL
      const existing = roomTypeMap.get(name);
      for (const p of photos) {
        if (!existing.photos.includes(p)) existing.photos.push(p);
      }
    }

    // Assign the best-match score to the matching room type (fuzzy name match)
    if (best.roomName) {
      const bestNameLower = best.roomName.toLowerCase();
      let matched = false;
      for (const [name, rt] of roomTypeMap) {
        if (name.toLowerCase() === bestNameLower ||
            name.toLowerCase().includes(bestNameLower) ||
            bestNameLower.includes(name.toLowerCase())) {
          rt.score = best.score;
          // Ensure the best-match image is first in photos
          if (best.imageUrl && !rt.photos.includes(best.imageUrl)) {
            rt.photos.unshift(best.imageUrl);
          }
          matched = true;
          break;
        }
      }
      // If no name match, inject the best-match room as its own entry at the top
      if (!matched && best.imageUrl) {
        roomTypeMap.set("__best__" + best.roomName, {
          name: best.roomName, photos: [best.imageUrl],
          size: "", amenities: [], beds: "", views: "", score: best.score
        });
      }
    }

    // Sort: scored room first, then rest alphabetically
    const roomTypes = [...roomTypeMap.values()].sort((a, b) => {
      if (a.score !== null && b.score === null) return -1;
      if (b.score !== null && a.score === null) return 1;
      return (b.score || 0) - (a.score || 0);
    });

    return {
      id:         h.id || h.hotelId,
      name:       detail?.name      || h.name     || "Hotel",
      address:    detail?.address   || h.address  || "",
      city:       detail?.city      || h.city     || city,
      country:    detail?.country   || h.country  || "",
      starRating: detail?.starRating || h.starRating || h.stars || 0,
      rating:     detail?.rating    || h.rating   || h.guestRating || 0,
      roomTypes:  roomTypes.slice(0, 6),
      isMatched,  // flag so frontend can show section divider
    };
  }

  const matchedHotels  = top20.map((h, i) => buildHotel(h, top20Details[i]?.data?.data, bestMatchMap[h.id], true));
  const paddedHotels   = paddingHotels.map((h, i) => buildHotel(h, paddingDetails[i]?.data?.data, { roomName:"", imageUrl:"", score:null }, false));
  const hotels         = [...matchedHotels, ...paddedHotels];

  // Re-sort hotels by their best room score (highest first) after enrichment
  // Room-search order can drift once we merge detail data
  // Cap display at 20 best matches even if API returned more
  const sortedHotels = hotels
    .map(h => ({
      ...h,
      _bestScore: h.roomTypes.find(rt => rt.score !== null)?.score ?? 0,
    }))
    .sort((a, b) => b._bestScore - a._bestScore)
    .map(({ _bestScore, ...h }) => h);

  console.log(`[search] done — ${sortedHotels.length} hotels sorted by score: ${sortedHotels.map(h => h.roomTypes.find(rt=>rt.score)?.score ?? 0).join(",")}`);
  res.json({ hotels: sortedHotels, query, city });
});

// ── CLIP search via HuggingFace + LiteAPI full catalog ────────────────────────
// Streams results via SSE so hotels appear progressively as they score
const HF_KEY = process.env.HUGGINGFACE_KEY || "";
const VLM_MODEL = "meta-llama/Llama-3.2-11B-Vision-Instruct";

const COUNTRY_CODES_CLIP = {
  "paris":"FR","nice":"FR","lyon":"FR","marseille":"FR","bordeaux":"FR",
  "london":"GB","edinburgh":"GB","manchester":"GB","liverpool":"GB","bristol":"GB",
  "barcelona":"ES","madrid":"ES","seville":"ES","valencia":"ES","ibiza":"ES","malaga":"ES",
  "rome":"IT","milan":"IT","florence":"IT","venice":"IT","naples":"IT","bologna":"IT",
  "amsterdam":"NL","rotterdam":"NL",
  "berlin":"DE","munich":"DE","hamburg":"DE","frankfurt":"DE","cologne":"DE","dresden":"DE",
  "vienna":"AT","salzburg":"AT","zurich":"CH","geneva":"CH","bern":"CH","lucerne":"CH",
  "brussels":"BE","bruges":"BE","ghent":"BE",
  "prague":"CZ","budapest":"HU","warsaw":"PL","krakow":"PL","gdansk":"PL","wroclaw":"PL",
  "athens":"GR","santorini":"GR","mykonos":"GR","thessaloniki":"GR",
  "lisbon":"PT","porto":"PT",
  "oslo":"NO","bergen":"NO","stockholm":"SE","gothenburg":"SE","copenhagen":"DK",
  "helsinki":"FI","reykjavik":"IS","dublin":"IE","galway":"IE",
  "istanbul":"TR","antalya":"TR","bodrum":"TR",
  "new york city":"US","new york":"US","nyc":"US","manhattan":"US",
  "los angeles":"US","chicago":"US","miami":"US","san francisco":"US","las vegas":"US",
  "seattle":"US","boston":"US","washington dc":"US","austin":"US","denver":"US",
  "nashville":"US","atlanta":"US","dallas":"US","houston":"US","portland":"US",
  "new orleans":"US","tacoma":"US","phoenix":"US","san diego":"US","orlando":"US",
  "toronto":"CA","vancouver":"CA","montreal":"CA","calgary":"CA",
  "mexico city":"MX","cancun":"MX","tulum":"MX",
  "rio de janeiro":"BR","sao paulo":"BR","salvador":"BR",
  "buenos aires":"AR","bogota":"CO","cartagena":"CO","lima":"PE","santiago":"CL",
  "tokyo":"JP","osaka":"JP","kyoto":"JP","hiroshima":"JP","sapporo":"JP",
  "seoul":"KR","busan":"KR",
  "beijing":"CN","shanghai":"CN","chengdu":"CN","guilin":"CN",
  "hong kong":"HK","macau":"MO","taipei":"TW",
  "bangkok":"TH","chiang mai":"TH","phuket":"TH","koh samui":"TH","krabi":"TH",
  "singapore":"SG","kuala lumpur":"MY","penang":"MY","langkawi":"MY",
  "bali":"ID","jakarta":"ID","yogyakarta":"ID","lombok":"ID",
  "hanoi":"VN","ho chi minh city":"VN","da nang":"VN","hoi an":"VN",
  "siem reap":"KH","phnom penh":"KH","luang prabang":"LA",
  "mumbai":"IN","delhi":"IN","bangalore":"IN","goa":"IN","jaipur":"IN","agra":"IN",
  "dubai":"AE","abu dhabi":"AE","doha":"QA","riyadh":"SA","muscat":"OM",
  "tel aviv":"IL","jerusalem":"IL","amman":"JO","beirut":"LB",
  "cairo":"EG","luxor":"EG","hurghada":"EG","sharm el sheikh":"EG",
  "marrakech":"MA","casablanca":"MA","fez":"MA",
  "cape town":"ZA","johannesburg":"ZA","nairobi":"KE","zanzibar":"TZ",
  "sydney":"AU","melbourne":"AU","brisbane":"AU","perth":"AU","cairns":"AU",
  "auckland":"NZ","queenstown":"NZ",
  "maldives":"MV","bora bora":"PF","fiji":"FJ",
};

// ── HuggingFace CLIP scoring ──────────────────────────────────────────────────
// Rate limit: free tier = 200 req / 5 min → throttle to max 30 req/min to be safe
let _hfReqCount = 0;
let _hfWindowStart = Date.now();

async function hfThrottle() {
  const now = Date.now();
  if (now - _hfWindowStart > 60000) { _hfReqCount = 0; _hfWindowStart = now; }
  if (_hfReqCount >= 30) {
    const wait = 60000 - (now - _hfWindowStart) + 100;
    console.log(`[clip] rate limit pause ${wait}ms`);
    await new Promise(r => setTimeout(r, wait));
    _hfReqCount = 0; _hfWindowStart = Date.now();
  }
  _hfReqCount++;
}

async function clipScore(imageUrl, textQuery) {
  if (!HF_KEY) return 0;
  try {
    await hfThrottle();

    // Use Llama Vision via HuggingFace router — ask it to rate how well the image matches
    const prompt = `Rate how well this hotel room photo matches the description: "${textQuery}". Reply with ONLY a number from 0 to 100, where 100 is a perfect match and 0 is no match. Consider visual features like room style, bathroom features, furniture, lighting. Reply with just the number.`;

    const r = await fetch(
      `https://router.huggingface.co/hf-inference/models/${VLM_MODEL}`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${HF_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: imageUrl } },
                { type: "text", text: prompt }
              ]
            }
          ],
          max_tokens: 10,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!r.ok) {
      const err = await r.text();
      console.warn(`[clip] HF error ${r.status}: ${err.slice(0, 100)}`);
      return 0;
    }

    const data = await r.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || "0";
    const score = Math.min(100, Math.max(0, parseInt(text.replace(/[^0-9]/g, "")) || 0));
    return score / 100; // normalise to 0-1
  } catch (e) {
    console.warn(`[clip] error:`, e.message);
    return 0;
  }
}

app.get("/api/clip-search", async (req, res) => {
  const { query, city } = req.query;
  if (!query || !city) return res.status(400).json({ error: "query and city are required" });
  if (!LITEAPI_KEY)    return res.status(500).json({ error: "LITEAPI_KEY not configured" });
  if (!HF_KEY)         return res.status(500).json({ error: "HUGGINGFACE_KEY not configured" });

  // SSE headers — allows streaming hotels to frontend as they score
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const send = (data) => res.write(`data: ${JSON.stringify(data)}

`);

  try {
    // Step 1: fetch full hotel catalog for city
    const cityKey     = city.trim().toLowerCase();
    const countryCode = COUNTRY_CODES_CLIP[cityKey] || "";
    const hotelParams = new URLSearchParams({ limit: 50 });
    if (countryCode) { hotelParams.set("countryCode", countryCode); hotelParams.set("cityName", city); }
    else             { hotelParams.set("latitude", resolveCoords(city)?.[0] || ""); hotelParams.set("longitude", resolveCoords(city)?.[1] || ""); hotelParams.set("radius", 15000); }

    send({ type: "status", message: `Fetching hotels in ${city}…` });
    const hotelsRes = await liteGet(`/data/hotels?${hotelParams}`);
    const allHotels = hotelsRes.data?.data || [];
    if (!allHotels.length) { send({ type: "done", total: 0 }); return res.end(); }

    const top10 = allHotels.slice(0, 10);
    send({ type: "status", message: `Scoring ${top10.length} hotels with CLIP…` });

    // Step 2: for each hotel fetch details + score all room photos
    for (let i = 0; i < top10.length; i++) {
      const h = top10[i];
      send({ type: "status", message: `Analyzing hotel ${i + 1} of ${top10.length}: ${h.name || h.id}` });

      // Fetch hotel detail
      const detailRes = await liteGet(`/data/hotel?hotelId=${h.id || h.hotelId}`);
      const detail    = detailRes.data?.data || null;

      // Collect all room photos grouped by room type
      const roomTypeMap = new Map();
      for (const room of (detail?.rooms || [])) {
        const name   = room.roomName || room.name || "Room";
        const photos = (room.photos || []).map(p => p.url || p.hd_url || "").filter(Boolean);
        const size   = room.roomSizeSquare ? `${room.roomSizeSquare} ${room.roomSizeUnit || "sqm"}` : "";
        const beds   = (room.bedTypes || []).map(b => `${b.quantity}× ${b.bedType}`).join(", ");
        const amenities = (room.roomAmenities || []).map(a => a.name).filter(Boolean).slice(0, 5);
        if (!roomTypeMap.has(name)) {
          roomTypeMap.set(name, { name, photos: [], size, beds, amenities, scores: [] });
        }
        const rt = roomTypeMap.get(name);
        for (const p of photos) {
          if (!rt.photos.includes(p)) rt.photos.push(p);
        }
      }

      // Score all photos for each room type with CLIP
      console.log(`[clip] hotel "${h.name}" has ${roomTypeMap.size} room types`);
      for (const rt of roomTypeMap.values()) {
        console.log(`[clip]   "${rt.name}" — ${rt.photos.length} photos`);
        const photoScores = await Promise.all(
          rt.photos.slice(0, 1).map(url => clipScore(url, query))
        );
        rt.scores = photoScores;
        console.log(`[clip]   scores: ${photoScores.map(s => s.toFixed(3)).join(", ")}`);
      }

      // Build room types sorted by best photo score
      const roomTypes = [...roomTypeMap.values()]
        .map(rt => {
          const bestIdx   = rt.scores.indexOf(Math.max(...rt.scores, 0));
          const bestScore = rt.scores[bestIdx] || 0;
          // Re-order photos: best scoring first
          const orderedPhotos = rt.photos.length
            ? [rt.photos[bestIdx], ...rt.photos.filter((_, i) => i !== bestIdx)]
            : rt.photos;
          return {
            name:      rt.name,
            photos:    orderedPhotos,
            size:      rt.size,
            beds:      rt.beds,
            amenities: rt.amenities,
            score:     bestScore > 0 ? Math.round(bestScore * 100) : null,
            rawScore:  bestScore,
          };
        })
        .sort((a, b) => (b.rawScore || 0) - (a.rawScore || 0));

      const hotelBestScore = roomTypes[0]?.rawScore || 0;

      send({
        type: "hotel",
        hotel: {
          id:         h.id || h.hotelId || "",
          name:       detail?.name      || h.name || "Hotel",
          address:    detail?.address   || h.address || "",
          city:       detail?.city      || h.city   || city,
          country:    detail?.country   || h.country || "",
          starRating: detail?.starRating || h.starRating || h.stars || 0,
          rating:     detail?.rating    || h.rating || h.guestRating || 0,
          roomTypes:  roomTypes.slice(0, 6),
          clipScore:  Math.round(hotelBestScore * 100),
          isMatched:  true,
        }
      });
    }

    send({ type: "done", total: top10.length });
  } catch (err) {
    console.error("[clip-search]", err);
    send({ type: "error", message: err.message });
  }

  res.end();
});

// ── Vector search endpoint ────────────────────────────────────────────────────
app.get("/api/vsearch", async (req, res) => {
  const { query } = req.query;
  // Normalize city to Title Case so "paris" and "Paris" resolve the same
  const city = (req.query.city || "").trim().replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  if (!query || !city) return res.status(400).json({ error: "query and city required" });
  if (!supabase)       return res.status(500).json({ error: "Supabase not configured" });

  const CC_MAP = {
    "paris":"FR","london":"GB","new york city":"US","new york":"US","nyc":"US",
    "tokyo":"JP","sydney":"AU","dubai":"AE","barcelona":"ES","rome":"IT",
    "amsterdam":"NL","berlin":"DE","madrid":"ES","vienna":"AT","prague":"CZ",
    "bangkok":"TH","singapore":"SG","hong kong":"HK","seoul":"KR","milan":"IT",
  };

  const t0 = Date.now();
  try {
    // 1. Check if city is indexed
    const { data: cityRow } = await supabase
      .from("indexed_cities")
      .select("status, hotel_count, photo_count")
      .eq("city", city)
      .single();

    const status = cityRow?.status || "none";
    const hotelCount = cityRow?.hotel_count || 0;

    // Already indexing but has partial data — allow search to proceed on whatever's indexed
    // Only block entirely if there is truly nothing indexed yet
    if (status === "indexing" && hotelCount === 0) {
      console.log(`[vsearch] ${city} indexing with no data yet — returning status`);
      return res.json({
        hotels: [], query, city,
        indexing: true,
        indexStatus: "indexing",
        message: `Visual index for ${city} is being built. Check back in a few minutes.`
      });
    }

    // Not indexed at all — trigger background indexing and fall back
    if (status === "none" || !cityRow) {
      console.log(`[vsearch] ${city} not indexed — triggering background index`);
      if (supabaseAdmin) {
        // Atomic insert — only succeeds if city doesn't already exist
        // Prevents duplicate runs if two requests come in simultaneously
        const { error: insertErr } = await supabaseAdmin
          .from("indexed_cities")
          .insert({ city, country_code: CC_MAP[city.toLowerCase()] || "", status: "indexing",
                    started_at: new Date().toISOString(), updated_at: new Date().toISOString() });

        if (!insertErr) {
          // We won the race — start indexing
          indexCity(city, 200).catch(e => console.error("[indexer]", e.message));
        } else {
          console.log(`[vsearch] ${city} indexing already started by another request`);
        }
      }
      return res.json({
        hotels: [], query, city,
        indexing: true,
        indexStatus: "started",
        message: `Building visual index for ${city}. Check back in a few minutes.`
      });
    }

    // Proceed with vector search (complete or partially-indexed city)
    const indexing = status === "indexing"; // let client know if still in progress

    const fetchClient = supabaseAdmin || supabase;
    const GALLERY_LIMIT = 250;

    // Feature flags from raw query — before HyDE so soft-flag coverage can run in parallel with HyDE + Phase A.
    const detectedFlags = VSEARCH_FEATURE_FLAGS.filter(f => f.queryMatch.test(query));
    const flagMode =
      (process.env.VSEARCH_FLAG_MODE || "soft").toLowerCase() === "strict" ||
      String(req.query.flag_mode || "").toLowerCase() === "strict"
        ? "strict"
        : "soft";
    const required_features =
      flagMode === "strict" && detectedFlags.length > 0
        ? Object.fromEntries(detectedFlags.map(f => [f.flag, true]))
        : null;
    const detectedFlagKeys = detectedFlags.map(f => f.flag);

    if (detectedFlags.length) {
      console.log(
        `[vsearch] feature flags: ${detectedFlags.map(f => f.label).join(", ")}` +
          (flagMode === "strict" ? " → DB pre-filter" : " → soft boost (no hard filter)")
      );
    }

    let coveragePromise = Promise.resolve(null);
    if (flagMode === "soft" && detectedFlagKeys.length > 0) {
      coveragePromise = buildSoftFlagCoveragePromise(city, detectedFlagKeys, fetchClient);
    }

    const hotelsPromise = fetchClient.from("hotels_cache").select("*").eq("city", city);

    // 2. HyDE: generate a hypothetical caption matching the room_embeddings vocabulary,
    // then embed it. This handles vocabulary gaps ("multiple sinks" → "double sinks"),
    // abstract queries ("spa bathroom", "romantic suite"), and negations ("no carpet"
    // → positive features only). Cache miss adds ~500ms; hits are free (4h TTL).
    const { negations } = extractNegations(query);
    if (negations.length) {
      console.log(`[vsearch] negations detected: [${negations.join(', ')}]`);
    }

    const tStartEmbed = Date.now();
    let queryEmbedding;
    let hydeText = null;
    const hydeKey_str = hydeKey(query);
    const cachedHyde  = hydeCache.get(hydeKey_str);

    if (cachedHyde && Date.now() - cachedHyde.ts < HYDE_TTL) {
      queryEmbedding = cachedHyde.embedding;
      hydeText       = cachedHyde.hypothetical;
      console.log(`[vsearch] HyDE cache hit: "${query}"`);
    } else {
      hydeText = await hydeGenerate(query, process.env.GEMINI_KEY);
      const textToEmbed = hydeText ?? query;
      if (hydeText) {
        console.log(`[vsearch] HyDE: "${query}" → "${hydeText.replace(/\n/g, ' ').slice(0, 120)}"`);
      }

      const embedRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: { parts: [{ text: textToEmbed }] } }),
          signal: AbortSignal.timeout(8000),
        }
      );
      if (!embedRes.ok) throw new Error("Gemini embedding failed");
      const embedData = await embedRes.json();
      const rawEmbedding = embedData?.embedding?.values;
      if (!rawEmbedding) throw new Error("No embedding returned");
      queryEmbedding = rawEmbedding.slice(0, 768);
      hydeCache.set(hydeKey_str, { hypothetical: hydeText, embedding: queryEmbedding, ts: Date.now() });
    }

    // 3. intentType from HyDE (photo-type focus for scoring).
    const intentType = extractIntentType(hydeText, query);

    // ── bbox pre-filter: if bbox param provided, resolve hotel_ids within bounding box ──
    let bboxHotelIds = null;
    const bboxParam = req.query.bbox;
    if (bboxParam) {
      const parts = bboxParam.split(",").map(Number);
      if (parts.length === 4 && parts.every(n => !isNaN(n))) {
        const [lat_min, lat_max, lon_min, lon_max] = parts;
        const { data: bboxHotels } = await supabase
          .from("hotels_cache")
          .select("hotel_id")
          .eq("city", city)
          .gte("lat", lat_min).lte("lat", lat_max)
          .gte("lng", lon_min).lte("lng", lon_max);
        bboxHotelIds = bboxHotels?.map(h => h.hotel_id) ?? [];
        console.log(`[vsearch] bbox filter: ${bboxHotelIds.length} hotels in bbox`);
        // If bbox resolves to zero hotels (lat/lng not yet backfilled), ignore bbox to avoid empty results
        if (bboxHotelIds.length === 0) bboxHotelIds = null;
      }
    }

    // ── Phase A: room-type scoring (full city) + hotel metadata cache — in PARALLEL ──
    // score_room_types scans room_types_index (~7k rows for Paris) for all hotels in the
    // city. No pre-filter needed: hotel score = MAX room-type similarity across all rooms.
    // Running alongside hotels_cache eliminates a full sequential round trip vs the old
    // 3-phase flow (score_hotels → score_room_types → score_hotel_photos).
    const tAfterEmbed = Date.now();
    const [roomTypesResult, cachedResult, coverageMap] = await Promise.all([
      fetchClient.rpc("score_room_types", {
        query_embedding: queryEmbedding,
        search_city: city,
        ...(required_features ? { required_features } : {}),
        ...(bboxHotelIds ? { hotel_ids: bboxHotelIds } : {}),
      }),
      hotelsPromise,
      coveragePromise,
    ]);
    const tPhaseA = Date.now();
    console.log(`[vsearch] HyDE+embed: ${tAfterEmbed - tStartEmbed}ms  phaseA(room_types): ${tPhaseA - tAfterEmbed}ms`);

    if (roomTypesResult.error) throw new Error("score_room_types: " + roomTypesResult.error.message);
    if (cachedResult.error) console.error("[vsearch] hotels_cache error:", cachedResult.error.message);

    const cached = cachedResult.data;

    // Hotel score = MAX room-type similarity (best room wins, not average)
    const hotelSimMap    = new Map();  // hotel_id → max similarity
    const roomTypeSimMap = new Map();  // "hotel_id::room_name" → similarity
    for (const rt of (roomTypesResult.data || [])) {
      const prev = hotelSimMap.get(rt.hotel_id) ?? 0;
      if (rt.similarity > prev) hotelSimMap.set(rt.hotel_id, rt.similarity);
      roomTypeSimMap.set(`${rt.hotel_id}::${rt.room_name}`, rt.similarity);
    }

    // If bbox search returned 0 results, retry city-wide as a fallback
    if (!hotelSimMap.size && bboxHotelIds) {
      console.log(`[vsearch] 0 results in bbox — retrying city-wide`);
      const fallback = await fetchClient.rpc("score_room_types", {
        query_embedding: queryEmbedding,
        search_city: city,
        ...(required_features ? { required_features } : {}),
      });
      if (fallback.error) throw new Error("score_room_types fallback: " + fallback.error.message);
      for (const rt of (fallback.data || [])) {
        const prev = hotelSimMap.get(rt.hotel_id) ?? 0;
        if (rt.similarity > prev) hotelSimMap.set(rt.hotel_id, rt.similarity);
        roomTypeSimMap.set(`${rt.hotel_id}::${rt.room_name}`, rt.similarity);
      }
    }

    if (!hotelSimMap.size) {
      return res.json({ hotels: [], query, city, indexing, indexStatus: status });
    }

    // Max raw cosine across all hotels (for display % — independent of soft-flag re-order).
    const maxRawSim = Math.max(...hotelSimMap.values());

    let rankedHotels = [...hotelSimMap.entries()]
      .map(([hotel_id, similarity]) => ({ hotel_id, similarity }))
      .sort((a, b) => b.similarity - a.similarity);

    // Soft flag-heavy: multiplicative boost by coverage + mild penalty when coverage < 1
    // (replaces legacy additive SOFT_FLAG_BONUS_MAX — see SOFT_FLAG_COVERAGE_MULT).
    const covMult = parseFloat(process.env.SOFT_FLAG_COVERAGE_MULT || "0.28");
    const missPen = parseFloat(process.env.SOFT_FLAG_MISS_PENALTY || "0.08");
    if (flagMode === "soft" && coverageMap && detectedFlagKeys.length > 0) {
      let withCov = 0;
      for (const h of rankedHotels) {
        const c = coverageMap.get(h.hotel_id) ?? 0;
        if (c > 0) withCov++;
        let boosted = h.similarity * (1 + covMult * c);
        boosted *= 1 - missPen * (1 - c);
        h.s_boosted = Math.min(0.999, boosted);
      }
      rankedHotels.sort((a, b) => (b.s_boosted ?? b.similarity) - (a.s_boosted ?? a.similarity));
      if (rankedHotels.length >= 2) {
        const top = rankedHotels[0];
        const second = rankedHotels[1];
        if (
          top.similarity < 0.55 &&
          second.similarity > 0.65 &&
          (top.s_boosted ?? top.similarity) > (second.s_boosted ?? second.similarity)
        ) {
          console.warn(
            `[soft_flags] rank inversion: top ${top.hotel_id} raw=${top.similarity.toFixed(3)} vs #2 ${second.hotel_id} raw=${second.similarity.toFixed(3)}`
          );
        }
      }
      console.log(
        `[vsearch] soft_flags: cov_mult=${covMult} miss_penalty=${missPen} hotels_with_coverage=${withCov}/${rankedHotels.length}`
      );
    } else {
      rankedHotels.forEach(h => { h.s_boosted = h.similarity; });
    }

    console.log(`[vsearch] ranked: ${rankedHotels.length} hotels from room-type scoring`);

    // ── Phase B: photo fetch (zero vector computation) ──────────────────────────
    // fetch_hotel_photos returns photo metadata; similarity per photo comes from
    // room_types_index scores already computed in Phase A.
    const topHotelIds = rankedHotels.slice(0, GALLERY_LIMIT).map(h => h.hotel_id);
    const photosResult = await fetchClient.rpc("fetch_hotel_photos", { hotel_ids: topHotelIds });
    const tPhaseB = Date.now();
    console.log(`[vsearch] phaseB: ${tPhaseB - tPhaseA}ms`);

    if (photosResult.error) throw new Error("fetch_hotel_photos: " + photosResult.error.message);
    const photos = photosResult.data || [];
    console.log(`[vsearch] photos for top ${topHotelIds.length} hotels: ${photos.length}`);

    // 4. Build hotelPhotosMap and hotelScoreMap.
    // Photo similarity = room_type similarity from Phase A (same room → same score).
    // Photos whose room_name isn't in roomTypeSimMap fall back to hotel-level similarity.
    const cacheMap       = new Map((cached || []).map(h => [h.hotel_id, h]));
    const hotelPhotosMap = new Map();  // hotel_id → [{...photo, similarity, caption?}]
    const hotelScoreMap  = new Map();  // hotel_id → {scores[], intentScores[], captions[]}

    for (const p of photos) {
      // For feature-filtered queries, rooms not returned by score_room_types (i.e., rooms
      // that don't have the required feature) get similarity 0 so they sort to the bottom.
      // Without this, they'd inherit the hotel-level max and incorrectly appear first.
      const roomTypeSim = roomTypeSimMap.get(`${p.hotel_id}::${p.room_name}`);
      const similarity  = roomTypeSim ?? (required_features ? 0 : (hotelSimMap.get(p.hotel_id) ?? 0));

      if (!hotelPhotosMap.has(p.hotel_id)) hotelPhotosMap.set(p.hotel_id, []);
      hotelPhotosMap.get(p.hotel_id).push({ ...p, similarity });

      if (!hotelScoreMap.has(p.hotel_id)) hotelScoreMap.set(p.hotel_id, { scores: [], intentScores: [] });
      const hs = hotelScoreMap.get(p.hotel_id);
      hs.scores.push(similarity);
      if (!intentType || p.photo_type === intentType) hs.intentScores.push(similarity);
    }

    for (const arr of hotelPhotosMap.values()) {
      sortHotelPhotosForDisplay(arr, intentType, detectedFlagKeys, flagMode);
    }

    // Log similarity distribution (from room_types scores, not per-photo)
    if (rankedHotels.length > 0) {
      const sims = rankedHotels.slice(0, Math.min(rankedHotels.length, 200)).map(h => h.similarity);
      const top5 = sims.slice(0, 5).map(s => s.toFixed(4)).join(', ');
      const p95  = sims[Math.floor(sims.length * 0.05)]?.toFixed(4);
      console.log(`[vsearch] room_type similarity — top5: [${top5}]  p95: ${p95}`);
    }

    // 5. Compute topScore per hotel.
    //    Top GALLERY_LIMIT hotels use per-photo similarity (accurate) with structural penalty.
    //    Hotels beyond GALLERY_LIMIT use room-type-level similarity with no penalty
    //    (no captions available to verify, ranked far down anyway).
    // Adaptive normalization: SIM_MAX = max raw similarity in the result set (not boosted order).
    // Spread fixed at 0.30.
    const SIM_MAX = maxRawSim > 0 ? maxRawSim : 0.9;
    const SIM_MIN = Math.max(SIM_MAX - 0.30, 0);
    const simSpan = Math.max(SIM_MAX - SIM_MIN, 1e-9);
    const photoHotelIds = new Set(hotelPhotosMap.keys());

    // Score = mean of top-3 similarities (intent-type photos first, fallback to all).
    // Feature flag pre-filter in score_room_types ensures every hotel here has confirmed
    // the required features — no post-hoc penalty or boost needed.
    const photoHotelScores = [...photoHotelIds].map(hotelId => {
      const hs       = hotelScoreMap.get(hotelId);
      const arr      = hs.intentScores.length > 0 ? hs.intentScores : hs.scores;
      arr.sort((a, b) => b - a);
      const rawScore = arr.slice(0, 3).reduce((s, x) => s + x, 0) / Math.min(3, arr.length);
      let score = Math.max(0, Math.min(100, (rawScore - SIM_MIN) / simSpan * 100));
      // Photo-count penalty: penalises hotels with too few photos overall (poor visual coverage).
      const hpAll = hotelPhotosMap.get(hotelId) || [];
      if (hpAll.length < 3) {
        const photoFactor = hpAll.length / 3;
        score *= photoFactor;
        console.log(`[vsearch] photo-count penalty: ${hotelId} only ${hpAll.length} total photos → score now ${score.toFixed(1)}`);
      }
      return { hotelId, topScore: score, hasPhotos: true };
    });

    // Scores for hotels beyond GALLERY_LIMIT (room-type similarity, no penalty)
    const remainingHotelScores = rankedHotels
      .filter(h => !photoHotelIds.has(h.hotel_id))
      .map(h => {
        const score = Math.max(0, Math.min(100, (h.similarity - SIM_MIN) / simSpan * 100));
        return { hotelId: h.hotel_id, topScore: score, hasPhotos: false };
      });

    const allHotels = [...photoHotelScores, ...remainingHotelScores]
      .sort((a, b) => b.topScore - a.topScore);

    // 6. Build response for all hotels
    const hotels = allHotels.map(({ hotelId, topScore, hasPhotos }) => {
      const meta           = cacheMap.get(hotelId) || {};
      const score          = Math.round(topScore);
      const hotelPhotos    = hotelPhotosMap.get(hotelId) || [];
      const fallbackName   = hotelPhotos[0]?.hotel_name || null;

      // Hotels without photo data (beyond GALLERY_LIMIT): return stub with no room types.
      // They appear in the sorted list with their match score from room_types_index.
      if (!hasPhotos) {
        return {
          id:          hotelId,
          name:        meta.name || hotelId,
          address:     meta.address || "",
          city,
          country:     "",
          starRating:  meta.star_rating || 0,
          rating:      meta.guest_rating || 0,
          mainPhoto:   meta.main_photo || null,
          hotelPhotos: meta.hotel_photos || [],
          roomTypes:   [],
          isMatched:   score > 0,
          vectorScore: score,
        };
      }

      // Group photos by room_name; hotelPhotos is already sorted similarity DESC.
      // room_type_id comes from LiteAPI (stored at index time) — may be null for older rows.
      const roomMap = new Map();
      for (const p of hotelPhotos) {
        const rName = p.room_name || "Room";
        if (!roomMap.has(rName)) roomMap.set(rName, { photos: [], roomTypeId: p.room_type_id || null });
        const entry = roomMap.get(rName);
        if (entry.photos.length < 12) {
          entry.photos.push({
            url: p.photo_url,
            type: p.photo_type,
            similarity: p.similarity,
            feature_flags: p.feature_flags,
          });
        }
      }

      const roomEntries = [...roomMap.entries()].map(([name, entry]) => {
        const fm = entry.photos.reduce(
          (m, ph) => Math.max(m, countPhotoFlagMatches(ph.feature_flags, detectedFlagKeys)),
          0
        );
        return { name, entry, flagMatch: fm };
      });
      roomEntries.sort((a, b) => {
        if (detectedFlagKeys.length > 0 && flagMode === "soft") {
          if (b.flagMatch !== a.flagMatch) return b.flagMatch - a.flagMatch;
        }
        return (b.entry.photos[0]?.similarity ?? 0) - (a.entry.photos[0]?.similarity ?? 0);
      });

      const roomTypes = roomEntries.map(({ name, entry, flagMatch }) => {
        const photoEntries = entry.photos;
        // Per-room score: use intent-filtered photos (same filter as hotel-level score)
        // so bedroom photos don't dilute a bathroom query score and vice versa.
        // Fall back to all photos if the room has no photos of the intent type.
        const intentPhotos = intentType
          ? photoEntries.filter(p => p.type === intentType)
          : [];
        const scoringPhotos = intentPhotos.length > 0 ? intentPhotos : photoEntries;
        const sims = scoringPhotos.map(p => p.similarity).sort((a, b) => b - a);
        const rawRoom = sims.length > 0
          ? sims.slice(0, 3).reduce((s, x) => s + x, 0) / Math.min(3, sims.length)
          : 0;
        let roomScore = Math.max(0, Math.min(100, (rawRoom - SIM_MIN) / simSpan * 100));
        // Photo-count penalty at room level: rooms with < 3 photos rank lower.
        if (photoEntries.length < 3) roomScore *= photoEntries.length / 3;
        return {
          name,
          roomTypeId: entry.roomTypeId,
          photos:     photoEntries.map(p => p.url),
          score:      Math.round(roomScore),
          size:       "",
          beds:       "",
          amenities:  [],
          flagMatch,
        };
      });

      // Flag-heavy soft: rooms with confirmed query flags first, then by score.
      roomTypes.sort((a, b) => {
        if (detectedFlagKeys.length > 0 && flagMode === "soft") {
          if (b.flagMatch !== a.flagMatch) return b.flagMatch - a.flagMatch;
        }
        return (b.score || 0) - (a.score || 0);
      });
      for (const rt of roomTypes) delete rt.flagMatch;

      return {
        id:          hotelId,
        name:        meta.name || fallbackName || hotelId,
        address:     meta.address || "",
        city,
        country:     "",
        starRating:  meta.star_rating || 0,
        rating:      meta.guest_rating || 0,
        mainPhoto:   meta.main_photo || null,
        hotelPhotos: meta.hotel_photos || [],
        roomTypes:   roomTypes.slice(0, 8),
        isMatched:   score > 0,
        vectorScore: score,
      };
    });

    const tTotal = Date.now() - t0;
    const kpiFlag = tTotal > 3000 ? " ⚠️ KPI BREACH" : "";
    console.log(`[vsearch] TOTAL: ${tTotal}ms${kpiFlag} | ${city}: ${hotels.length} hotels, top score ${allHotels[0]?.topScore?.toFixed(3)}`);

    const stats = { indexed: cityRow?.photo_count || 0 };
    if (String(req.query.debug || "") === "1") {
      const sample = rankedHotels.slice(0, 10).map(h => ({
        hotel_id: h.hotel_id,
        raw: h.similarity,
        boosted: h.s_boosted ?? h.similarity,
        coverage: coverageMap?.get?.(h.hotel_id) ?? 0,
      }));
      stats.softFlags = {
        mode: flagMode,
        detected: detectedFlagKeys,
        coverageMult: covMult,
        missPenalty: missPen,
        sample,
      };
    }

    res.json({ hotels, query, city, indexing, indexStatus: status, stats });

  } catch(err) {
    console.error("[vsearch]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Index status endpoint ──────────────────────────────────────────────────────
app.get("/api/index-status", async (req, res) => {
  const { city } = req.query;
  if (!city || !supabase) return res.json({ status: "unknown" });
  const { data } = await supabase
    .from("indexed_cities")
    .select("status, hotel_count, photo_count, started_at, completed_at")
    .eq("city", city)
    .single();
  res.json(data || { status: "none" });
});

// ── Cancel indexing endpoint ──────────────────────────────────────────────────
app.post("/api/index-cancel", async (req, res) => {
  const { city, secret } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  if (!supabaseAdmin) return res.status(500).json({ error: "Supabase not configured" });

  const { error } = await supabaseAdmin
    .from("indexed_cities")
    .update({ stop_requested: true, updated_at: new Date().toISOString() })
    .eq("city", city);

  if (error) return res.status(500).json({ error: error.message });

  console.log(`[indexer] Cancel requested for ${city}`);
  res.json({ message: `Cancel requested for ${city} — will stop after current batch` });
});

// ── Live pricing endpoint ──────────────────────────────────────────────────────
// Fetches cheapest available rate per hotel for a given city + date range.
// Fires a single batched POST to LiteAPI /hotels/rates with all hotel IDs.
// Returns { prices: { hotel_id: $/night }, currency, nights, pricedCount }
app.get("/api/rates", async (req, res) => {
  const { city, checkin } = req.query;
  let { checkout } = req.query;
  if (!city || !checkin || !checkout) {
    return res.status(400).json({ error: "city, checkin and checkout required" });
  }
  let nights = Math.round((new Date(checkout) - new Date(checkin)) / 86400000);
  if (nights < 1) {
    return res.status(400).json({ error: "checkout must be after checkin" });
  }
  // Cap at 30 nights — LiteAPI doesn't support longer stays. Clamp instead of erroring.
  if (nights > 30) {
    const cappedCheckout = new Date(checkin);
    cappedCheckout.setDate(cappedCheckout.getDate() + 30);
    checkout = cappedCheckout.toISOString().slice(0, 10);
    nights   = 30;
  }

  try {
    // If the frontend passes ranked hotel IDs directly, use them.
    // Otherwise fall back to fetching all hotel IDs for the city from the DB.
    let hotelIds;
    const rawIds = req.query.hotelIds;
    if (rawIds && typeof rawIds === 'string' && rawIds.length > 0) {
      hotelIds = rawIds.split(',').map(s => s.trim()).filter(Boolean).slice(0, 200);
      console.log(`[rates] ${city}: using ${hotelIds.length} ranked hotel IDs from client, ${checkin}→${checkout}`);
    } else {
      const fc = supabaseAdmin || supabase;
      const { data: hotelRows, error: dbErr } = await fc
        .from("hotels_cache").select("hotel_id").eq("city", city);
      if (dbErr) throw new Error("DB: " + dbErr.message);
      if (!hotelRows?.length) return res.json({ prices: {}, currency: "EUR", nights, pricedCount: 0 });
      hotelIds = hotelRows.map(h => h.hotel_id);
      console.log(`[rates] ${city}: fetching rates for ${hotelIds.length} hotels from DB, ${checkin}→${checkout}`);
    }

    const liteRes = await fetch("https://api.liteapi.travel/v3.0/hotels/rates", {
      method: "POST",
      headers: { "X-API-Key": LITEAPI_KEY, "Content-Type": "application/json", "accept": "application/json" },
      body: JSON.stringify({
        hotelIds,
        checkin,
        checkout,
        currency: "EUR",
        guestNationality: "US",
        occupancies: [{ adults: 2 }],
        maxRatesPerHotel: 20,
        roomMapping: true,
        timeout: 22,
      }),
    });

    if (liteRes.status === 429) {
      console.warn("[rates] LiteAPI rate limited");
      return res.json({ prices: {}, roomPrices: {}, currency: "EUR", nights, pricedCount: 0, rateLimited: true });
    }
    if (!liteRes.ok) {
      console.error("[rates] LiteAPI error", liteRes.status);
      return res.json({ prices: {}, roomPrices: {}, currency: "EUR", nights, pricedCount: 0 });
    }

    const json = await liteRes.json();
    // LiteAPI v3 wraps in { data: { rates: [...] } } or { data: [...] } — handle both
    const ratesList = json?.data?.rates ?? json?.data ?? json?.rates ?? [];
    const prices     = {};  // hotel_id → cheapest $/night (hotel-level display)
    const roomPrices = {};  // hotel_id → { room_type_id → $/night }

    // Normalize room name for matching: lowercase, trim, collapse whitespace
    const normName = s => (s || "").toLowerCase().trim().replace(/\s+/g, " ");

    // Diagnostic: log raw structure for the first hotel with rooms
    const sampleHotel = ratesList.find(h => (h.roomTypes||[]).length > 0);
    if (sampleHotel) {
      const srt = sampleHotel.roomTypes[0];
      const srate = srt?.rates?.[0];
      console.log(`[rates] sample hotel ${sampleHotel.hotelId}: roomTypes=${sampleHotel.roomTypes.length}`);
      console.log(`[rates] sample rate name: "${srate?.name}", mappedRoomId: ${srate?.mappedRoomId}, roomTypeId: ${srt?.roomTypeId}`);
      // Dump all room types for first hotel to see which have mappedRoomId
      sampleHotel.roomTypes.slice(0, 5).forEach((r, i) => {
        const rate = r.rates?.[0];
        console.log(`[rates]   room[${i}] mappedRoomId=${rate?.mappedRoomId} name="${rate?.name}" total=${rate?.retailRate?.total?.[0]?.amount}`);
      });
    }

    let totalRoomTypes = 0, withMappedId = 0;
    for (const hotel of ratesList) {
      const hotelId = hotel.hotelId;
      for (const rt of (hotel.roomTypes || [])) {
        totalRoomTypes++;
        const total = rt.rates?.[0]?.retailRate?.total?.[0]?.amount;
        if (!total || total <= 0) continue;
        const perNight = Math.round(total / nights);

        // Hotel-level cheapest — always update regardless of room name
        if (!prices[hotelId] || perNight < prices[hotelId]) {
          prices[hotelId] = perNight;
        }

        // mappedRoomId links back to /data/hotel integer room IDs (stored as room_type_id in DB)
        const mappedRoomId = rt.rates?.[0]?.mappedRoomId;
        if (mappedRoomId) {
          withMappedId++;
          const key = String(mappedRoomId);
          if (!roomPrices[hotelId]) roomPrices[hotelId] = {};
          if (!roomPrices[hotelId][key] || perNight < roomPrices[hotelId][key]) {
            roomPrices[hotelId][key] = perNight;
          }
        }
      }
    }
    console.log(`[rates] roomTypes in response: ${totalRoomTypes} total, ${withMappedId} with mappedRoomId`);

    const pricedCount = Object.keys(prices).length;
    const roomPricedCount = Object.values(roomPrices).reduce((s, rm) => s + Object.keys(rm).length, 0);
    console.log(`[rates] ${city}: ${pricedCount}/${hotelIds.length} hotels priced, ${roomPricedCount} room type rates`);
    res.json({ prices, roomPrices, currency: "EUR", nights, pricedCount });

  } catch (err) {
    console.error("[rates]", err.message);
    res.json({ prices: {}, currency: "EUR", nights: nights || 1, pricedCount: 0 });
  }
});

// ── feature_summary extractor (mirrors index-city.js version) ────────────────
// Keeps only POSITIVE/PRESENT values; drops FLOORING & DECOR section entirely.
// Must stay in sync with extractFeatureSummary() in scripts/index-city.js.
//
// photoType-aware: each photo type only embeds its own relevant sections so
// the resulting vector isn't diluted by unrelated fields.  For example, a
// bathroom embedding should encode sink/bathtub/shower features — not "queen
// bed" or "armchair" — so it scores closely against a HyDE query like
// "PHOTO TYPE: bathroom\nSINKS: double sinks".
function extractFeatureSummary(caption, photoType = null) {
  if (!caption) return null;

  // Sections that carry no useful signal for the given photo type.
  // FLOORING & DECOR is always skipped (hallucination-prone, rarely queried).
  const PHOTO_TYPE_SKIP = {
    'bathroom':    ['BEDROOM', 'FURNITURE'],
    'bedroom':     ['BATHROOM'],
    'living area': ['BATHROOM', 'BEDROOM'],
    'view':        ['BATHROOM', 'BEDROOM', 'FURNITURE', 'NOTABLE FEATURES'],
  };
  const skipExtra = photoType ? (PHOTO_TYPE_SKIP[photoType] || []) : [];
  const SKIP_SECTIONS = new Set(['FLOORING & DECOR', ...skipExtra]);
  const SKIP_VALUES   = new Set(['no', 'none', 'unknown', 'standard', 'standard ceiling', 'moderate light']);
  const lines = caption.split('\n');
  const kept  = [];
  let skipSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const secMatch = line.match(/^([A-Z][A-Z &]+):$/);
    if (secMatch) { skipSection = SKIP_SECTIONS.has(secMatch[1]); continue; }
    if (skipSection) continue;
    if (line.startsWith('PHOTO TYPE:') && line.includes('|')) { kept.push(line); continue; }
    if (line.startsWith('Room type:')) { kept.push(line); continue; }
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const value = line.slice(colonIdx + 1).trim().toLowerCase();
      if (!value || SKIP_VALUES.has(value)) continue;
      if (value.startsWith('no ') || value.includes('not visible')) continue;
      // Normalise vocabulary to match common user query terms
      const normalised = line
        .replace(/:\s*two sinks\b/i,       ': double sinks')
        .replace(/:\s*one sink\b/i,        ': single sink')
        .replace(/:\s*three sinks\b/i,     ': triple sinks')
        .replace(/:\s*shower over bath\b/i,': shower over bath, rainfall shower');
      kept.push(normalised);
    }
  }
  return kept.length > 1 ? kept.join('\n') : null;
}

// Parses a feature_summary string into an explicit boolean flags object.
// Only present keys are true (absent = not confirmed). Must stay in sync with
// the SQL UPDATE in supabase/feature-flags.sql and the copy in scripts/index-city.js.
function extractFeatureFlags(featureSummary) {
  if (!featureSummary) return {};
  const f = featureSummary;
  const flags = {};

  // Bathroom
  if (/^SINKS:\s*double sinks/im.test(f))                                              flags.double_sinks = true;
  if (/^BATHTUB:/im.test(f))                                                           flags.bathtub = true;
  if (/^BATHTUB:\s*soaking tub/im.test(f))                                            flags.soaking_tub = true;
  if (/^BATHTUB:\s*clawfoot/im.test(f))                                               flags.clawfoot_tub = true;
  if (/^SHOWER:\s*walk-in shower/im.test(f))                                          flags.walk_in_shower = true;
  if (/^SHOWER:.*rainfall shower/im.test(f) ||
      /^DISTINCTIVE FEATURES:.*rainfall shower/im.test(f))                            flags.rainfall_shower = true;
  if (/^IN-ROOM HOT TUB OR JACUZZI:\s*yes/im.test(f) ||
      /^BATHTUB:\s*(?:jacuzzi|hot tub)/im.test(f))                                    flags.in_room_jacuzzi = true;
  if (/^BIDET:\s*yes/im.test(f))                                                      flags.bidet = true;
  if (/^SEPARATE TOILET ROOM:\s*yes/im.test(f))                                       flags.separate_toilet_room = true;

  // Bedroom / Closet
  if (/^BED:.*\bking\b/im.test(f))                                                    flags.king_bed = true;
  if (/^BED:.*four[- ]poster/im.test(f))                                              flags.four_poster_bed = true;
  if (/^BED:.*\btwins?\b/im.test(f))                                                  flags.twin_beds = true;
  if (/^WALK-IN CLOSET:\s*yes/im.test(f))                                             flags.walk_in_closet = true;

  // Space
  if (/^SEPARATE LIVING AREA:\s*yes/im.test(f))                                       flags.separate_living_area = true;
  if (/^CEILING HEIGHT:\s*(?:high ceilings|vaulted ceiling)/im.test(f))              flags.high_ceilings = true;
  if (/^WINDOWS:\s*floor-to-ceiling windows/im.test(f))                              flags.floor_to_ceiling_windows = true;

  // Outdoor
  if (/^BALCONY OR TERRACE:\s*yes/im.test(f))                                        flags.balcony = true;
  if (/^DISTINCTIVE FEATURES:.*\bterrace\b/im.test(f))                               flags.terrace = true;

  // Views
  if (/^VIEW:\s*city view/im.test(f))                                                 flags.city_view = true;
  if (/^VIEW:\s*(?:Eiffel Tower|landmark|Big Ben|Tower Bridge|Empire State|monument)/im.test(f)) flags.landmark_view = true;
  if (/^VIEW:\s*garden view/im.test(f))                                               flags.garden_view = true;
  if (/^VIEW:\s*(?:river view|seine|thames|hudson|canal view)/im.test(f))             flags.river_view = true;
  if (/^VIEW:\s*courtyard view/im.test(f))                                            flags.courtyard_view = true;
  if (/^VIEW:\s*pool view/im.test(f))                                                 flags.pool_view = true;
  if (/^VIEW:\s*(?:sea view|ocean view)/im.test(f))                                   flags.sea_view = true;
  if (/^VIEW:\s*mountain view/im.test(f))                                             flags.mountain_view = true;

  // Features
  if (/^FIREPLACE:\s*yes/im.test(f))                                                  flags.fireplace = true;
  if (/^DISTINCTIVE FEATURES:.*\bprivate pool\b/im.test(f))                          flags.private_pool = true;
  if (/^SOFA:\s*yes/im.test(f))                                                       flags.sofa = true;
  if (/^CHAISE LOUNGE:\s*yes/im.test(f))                                              flags.chaise_lounge = true;
  if (/^DINING TABLE:\s*yes/im.test(f))                                               flags.dining_table = true;

  return flags;
}

// ── Backfill feature_embedding for existing rows (protected) ─────────────────
// Reads each row's raw caption, applies the improved extractFeatureSummary()
// to get a clean signal-dense text (positive features only, no flooring noise),
// embeds it with gemini-embedding-001, and stores both the cleaned text and
// the vector. After ALL rows are done, rebuilds room_types_index in one SQL
// call instead of per-hotel RPCs.
// Usage: POST /api/backfill-feature-embeddings {"city":"Paris","secret":"..."}
app.post("/api/backfill-feature-embeddings", async (req, res) => {
  const { city, secret } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });

  const GEMINI_KEY = process.env.GEMINI_KEY || "";
  if (!GEMINI_KEY) return res.status(500).json({ error: "GEMINI_KEY not set" });

  const { force } = req.body || {};
  const fc = supabaseAdmin || supabase;
  let countQuery = fc.from("room_embeddings")
    .select("*", { count: "exact", head: true })
    .eq("city", city);
  if (!force) countQuery = countQuery.is("feature_embedding", null);
  const { count } = await countQuery;

  res.json({ message: `Backfill started for ${city} (force=${!!force})`, todo: count });

  (async () => {
    console.log(`[feat-embed] starting backfill for ${city}: ${count} rows (force=${!!force})`);
    const BATCH = 200, CHUNK = 20, RATE = 900;
    let done = 0, failed = 0, lastId = 0;
    const startMs = Date.now();

    // Rate limiter (per 60s window)
    let windowStart = Date.now(), windowCount = 0;
    async function rateLimitedEmbed(text) {
      const now = Date.now();
      if (now - windowStart > 60000) { windowStart = now; windowCount = 0; }
      if (windowCount >= RATE) {
        const wait = 61000 - (now - windowStart);
        console.log(`[feat-embed] rate limit, pausing ${Math.round(wait / 1000)}s`);
        await new Promise(r => setTimeout(r, wait));
        windowStart = Date.now(); windowCount = 0;
      }
      windowCount++;
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: { parts: [{ text }] } }),
          signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) return null;
      const d = await r.json();
      const vals = d?.embedding?.values;
      return vals ? vals.slice(0, 768) : null;
    }

    // Cursor-based pagination (avoids offset drift if rows are written mid-run)
    while (true) {
      let rowQuery = fc.from("room_embeddings")
        .select("id, caption, photo_type")
        .eq("city", city)
        .gt("id", lastId)
        .order("id", { ascending: true })
        .limit(BATCH);
      if (!force) rowQuery = rowQuery.is("feature_embedding", null);
      const { data: rows, error } = await rowQuery;

      if (error) { console.error("[feat-embed] fetch error:", error.message); break; }
      if (!rows?.length) break;
      lastId = rows[rows.length - 1].id;

      for (let i = 0; i < rows.length; i += CHUNK) {
        await Promise.all(rows.slice(i, i + CHUNK).map(async row => {
          // Re-derive feature_summary using photo-type-specific section filtering
          const summary = extractFeatureSummary(row.caption, row.photo_type);
          if (!summary) { failed++; return; }
          const vec = await rateLimitedEmbed(summary);
          if (!vec) { failed++; return; }
          const { error: upErr } = await fc.from("room_embeddings")
            .update({ feature_embedding: vec, feature_summary: summary, feature_flags: extractFeatureFlags(summary) })
            .eq("id", row.id);
          if (upErr) { failed++; console.warn("[feat-embed] update err:", upErr.message); }
          else done++;
        }));
      }

      const elapsed = Math.round((Date.now() - startMs) / 1000);
      console.log(`[feat-embed] progress: ${done} done, ${failed} failed — ${(done / (elapsed || 1)).toFixed(1)}/s`);
    }

    console.log(`[feat-embed] embeddings done: ${done} updated, ${failed} failed`);

    // Verify completeness before rebuilding the index
    const { count: remaining } = await fc.from("room_embeddings")
      .select("*", { count: "exact", head: true })
      .eq("city", city).is("feature_embedding", null);
    if (remaining > 0) {
      console.warn(`[feat-embed] ${remaining} rows still missing feature_embedding — index rebuild may be partial`);
    }

    // Single bulk SQL call instead of ~1000 per-hotel RPCs
    console.log(`[feat-embed] rebuilding room_types_index for ${city}...`);
    const { data: rebuildCount, error: rebuildErr } = await fc
      .rpc("rebuild_room_types_index_city", { p_city: city });
    if (rebuildErr) {
      console.error("[feat-embed] rebuild error:", rebuildErr.message);
    } else {
      console.log(`[feat-embed] room_types_index rebuilt: ${rebuildCount} rows — backfill complete`);
    }
  })().catch(err => console.error("[feat-embed] fatal:", err.message));
});

// ── Backfill hotel_photos gallery for existing hotels_cache rows (protected) ──
// Fetches LiteAPI /data/hotel for each hotel where hotel_photos = '[]',
// extracts hotelImages[], and updates hotels_cache.hotel_photos.
// Usage: POST /api/backfill-hotel-gallery {"city":"Paris","secret":"roommatch-2026"}
app.post("/api/backfill-hotel-gallery", async (req, res) => {
  const { city, secret, dryRun } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });

  res.json({ message: `Hotel gallery backfill started for ${city}`, dryRun: !!dryRun });

  (async () => {
    const t0 = Date.now();
    console.log(`[gallery-backfill] Starting for ${city} dryRun=${!!dryRun}`);

    // Fetch all hotels_cache rows for city (including those already done, for resume safety)
    const { data: allHotels, error: fetchErr } = await supabaseAdmin
      .from("hotels_cache")
      .select("hotel_id, main_photo, hotel_photos")
      .eq("city", city);

    if (fetchErr || !allHotels) {
      console.error("[gallery-backfill] hotels_cache fetch failed:", fetchErr?.message);
      return;
    }

    // Only process hotels where gallery is empty
    const todo = allHotels.filter(h => !h.hotel_photos || h.hotel_photos.length === 0);
    console.log(`[gallery-backfill] ${allHotels.length} hotels total, ${todo.length} need gallery`);

    const CONCURRENCY = 20;
    let done = 0, filled = 0, empty = 0;

    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      const batch = todo.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (row) => {
        try {
          const r = await liteGet(`/data/hotel?hotelId=${row.hotel_id}`);
          if (!r.ok) { done++; empty++; return; }
          const detail = r.data?.data || {};
          const mainPhotoUrl = row.main_photo || "";

          const rawPhotos = [
            ...(detail.hotelImages || []),
            ...(detail.photos      || []),
            ...(detail.images      || []),
            ...(detail.gallery     || []),
          ];
          const photos = rawPhotos
            .map(p => (typeof p === "string" ? p : p?.urlHd || p?.url || p?.hd_url || ""))
            .filter(Boolean)
            .filter(u => u !== mainPhotoUrl)
            .slice(0, 8);

          if (!dryRun && photos.length > 0) {
            await supabaseAdmin
              .from("hotels_cache")
              .update({ hotel_photos: photos })
              .eq("hotel_id", row.hotel_id);
          }

          done++;
          if (photos.length > 0) filled++; else empty++;
          if (done % 50 === 0) {
            console.log(`[gallery-backfill] ${done}/${todo.length} done, ${filled} filled, ${empty} empty`);
          }
        } catch (e) {
          done++; empty++;
          console.warn(`[gallery-backfill] ${row.hotel_id} error:`, e.message);
        }
      }));
    }

    const elapsed = Math.round((Date.now() - t0) / 1000);
    console.log(`[gallery-backfill] Done in ${elapsed}s — ${filled}/${todo.length} hotels got photos, ${empty} empty`);
  })().catch(err => console.error("[gallery-backfill] fatal:", err.message));
});

// ── Backfill room_type_id for existing rows (protected) ───────────────────────
app.post("/api/backfill-room-ids", async (req, res) => {
  const { city, secret, dryRun } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });

  // Run async, stream progress to logs
  res.json({ message: `Backfill started for ${city}`, dryRun: !!dryRun });

  (async () => {
    const norm = s => (s||"").toLowerCase().replace(/[^a-z0-9 ]/g,"").replace(/\s+/g," ").trim();
    const matchScore = (a, b) => {
      const na = norm(a), nb = norm(b);
      if (na === nb) return 3;
      if (na.includes(nb) || nb.includes(na)) return 2;
      const wa = new Set(na.split(" ")), wb = new Set(nb.split(" "));
      return [...wa].filter(w => wb.has(w) && w.length > 2).length >= 2 ? 1 : 0;
    };

    const fc = supabaseAdmin || supabase;
    const { data: rows, error } = await fc
      .from("room_embeddings").select("hotel_id, room_name")
      .eq("city", city).is("room_type_id", null);
    if (error) { console.error("[backfill]", error.message); return; }
    if (!rows?.length) { console.log("[backfill] Nothing to backfill"); return; }

    const byHotel = new Map();
    for (const r of rows) {
      if (!byHotel.has(r.hotel_id)) byHotel.set(r.hotel_id, new Set());
      byHotel.get(r.hotel_id).add(r.room_name);
    }
    console.log(`[backfill] ${rows.length} rows across ${byHotel.size} hotels`);

    let updated = 0, failed = 0;
    for (const [hotelId, roomNames] of byHotel) {
      try {
        const r = await fetch(`https://api.liteapi.travel/v3.0/data/hotel?hotelId=${hotelId}`, {
          headers: { "X-API-Key": LITEAPI_KEY, "accept": "application/json" },
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) { console.warn(`[backfill] ${hotelId}: LiteAPI ${r.status}`); failed += roomNames.size; continue; }
        const detail = (await r.json())?.data || {};
        const liteRooms = (detail.rooms || []).map(rm => ({
          id: rm.id || rm.roomId || rm.roomTypeId || null,
          name: rm.roomName || rm.name || "",
        })).filter(rm => rm.id);

        for (const dbName of roomNames) {
          let best = null, bestScore = 0;
          for (const lr of liteRooms) {
            const s = matchScore(dbName, lr.name);
            if (s > bestScore) { bestScore = s; best = lr; }
          }
          if (!best || bestScore === 0) { console.warn(`[backfill] ${hotelId}: no match for "${dbName}"`); failed++; continue; }
          console.log(`[backfill] ${hotelId}: "${dbName}" → ${best.id} (score ${bestScore})`);
          if (!dryRun) {
            const { error: upErr } = await fc.from("room_embeddings")
              .update({ room_type_id: best.id })
              .eq("hotel_id", hotelId).eq("room_name", dbName).is("room_type_id", null);
            if (upErr) { console.error(`[backfill] update error:`, upErr.message); failed++; }
            else updated++;
          } else { updated++; }
        }
        await new Promise(r => setTimeout(r, 150)); // gentle LiteAPI pacing
      } catch(e) { console.warn(`[backfill] ${hotelId}: ${e.message}`); failed += roomNames.size; }
    }
    console.log(`[backfill] Done — ${updated} updated, ${failed} unmatched`);
  })();
});

// ── Neighborhoods endpoint ─────────────────────────────────────────────────────
// GET /api/neighborhoods?city=Paris
// Returns 5-8 Gemini-generated neighborhood cards with vibes + Unsplash photos.
// Gated to indexed cities only. Caches in DB — first call takes ~4-8s.
const neighborhoodGenerating = new Set(); // track in-flight generation per city

app.get("/api/neighborhoods", async (req, res) => {
  const city = (req.query.city || "").trim();
  if (!city) return res.status(400).json({ error: "city required" });
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  try {
    // Return cached rows immediately if they exist
    const { data: cached } = await supabase
      .from("neighborhoods")
      .select("*")
      .eq("city", city)
      .order("id");
    if (cached?.length > 0) {
      return res.json({ neighborhoods: cached, city });
    }

    // If generation already in-flight for this city, return 202
    if (neighborhoodGenerating.has(city)) {
      return res.status(202).json({ status: "generating", city });
    }

    // Kick off generation
    neighborhoodGenerating.add(city);
    try {
      const rows = await generateNeighborhoods(
        city, supabaseAdmin || supabase,
        process.env.GEMINI_KEY, process.env.UNSPLASH_KEY
      );
      neighborhoodGenerating.delete(city);
      return res.json({ neighborhoods: rows, city });
    } catch (e) {
      neighborhoodGenerating.delete(city);
      console.error(`[neighborhoods] generation failed for ${city}:`, e.message);
      return res.status(500).json({ error: "Neighborhood generation failed", detail: e.message });
    }
  } catch (err) {
    console.error("[neighborhoods]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Vibe presets endpoint ──────────────────────────────────────────────────────
// GET /api/vibe-presets?city=Paris
// Returns 8 canonical room-style photos + captions for photo-tap search.
const VIBE_STYLES = [
  { label: "Bright & Minimal",    query: "bright white room large windows minimal modern" },
  { label: "Warm Art Deco",       query: "art deco warm tones dark wood ornate details" },
  { label: "Romantic & Soft",     query: "soft lighting romantic canopy bed pastel tones" },
  { label: "Bold & Contemporary", query: "bold contemporary design statement furniture dramatic" },
  { label: "Classic Luxury",      query: "classic luxury marble chandelier high ceilings gold" },
  { label: "Cozy & Intimate",     query: "cozy intimate warm textures fireplace reading nook" },
  { label: "Urban & Industrial",  query: "urban industrial exposed brick concrete loft dark" },
  { label: "Serene & Spa-Like",   query: "serene spa bathroom soaking tub natural light zen" },
];

app.get("/api/vibe-presets", async (req, res) => {
  const city = (req.query.city || "").trim();
  if (!city) return res.status(400).json({ error: "city required" });
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  try {
    // Return cached presets if available
    const { data: cached } = await supabase
      .from("vibe_presets")
      .select("style_label, query_used, photo_url, caption")
      .eq("city", city)
      .order("id");
    if (cached?.length >= VIBE_STYLES.length) {
      return res.json({ presets: cached, city });
    }

    // Generate: run vsearch for each style, take top photo
    const presets = [];
    for (const style of VIBE_STYLES) {
      try {
        // Inline vsearch to get top photo without an HTTP round-trip
        const embedRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.GEMINI_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: { parts: [{ text: style.query }] } }),
          }
        );
        if (!embedRes.ok) continue;
        const embedData = await embedRes.json();
        const embedding = embedData?.embedding?.values?.slice(0, 768);
        if (!embedding) continue;

        const fc = supabaseAdmin || supabase;
        const { data: roomTypes } = await fc.rpc("score_room_types", {
          query_embedding: embedding,
          search_city: city,
        });
        if (!roomTypes?.length) continue;

        const topHotelId = roomTypes[0].hotel_id;
        const { data: photos } = await fc.rpc("fetch_hotel_photos", {
          hotel_ids: [topHotelId],
          max_per_hotel: 5,
        });
        const photo = photos?.find(p => p.photo_url);
        if (!photo) continue;

        presets.push({
          city,
          style_label: style.label,
          query_used:  style.query,
          photo_url:   photo.photo_url,
          caption:     photo.caption || style.query,
          hotel_id:    topHotelId,
        });
      } catch (e) {
        console.warn(`[vibe-presets] style "${style.label}" failed:`, e.message);
      }
    }

    if (presets.length > 0) {
      await (supabaseAdmin || supabase)
        .from("vibe_presets")
        .upsert(presets, { onConflict: "city,style_label" });
    }

    res.json({ presets: presets.map(p => ({
      style_label: p.style_label, query_used: p.query_used,
      photo_url: p.photo_url, caption: p.caption,
    })), city });
  } catch (err) {
    console.error("[vibe-presets]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Backfill neighborhood vibe elements/photos (protected) ────────────────────
// POST /api/backfill-neighborhood-vibes {"secret":"roommatch-2026","city":"Paris"}
app.post("/api/backfill-neighborhood-vibes", async (req, res) => {
  const { city, secret } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  if (!supabase) return res.status(500).json({ error: "Supabase not configured" });

  const db = supabaseAdmin || supabase;
  res.json({ message: `backfill-neighborhood-vibes started for ${city}` });

  (async () => {
    try {
      const updated = await recomputeNeighborhoodVibes(city, db, process.env.UNSPLASH_KEY);
      console.log(`[backfill-neighborhood-vibes] ${city}: ${updated} neighborhoods refreshed`);
    } catch (e) {
      console.error(`[backfill-neighborhood-vibes] ${city} failed:`, e.message);
    }
  })();
});

// ── Backfill lat/lng endpoint (protected) ─────────────────────────────────────
// POST /api/backfill-latlng {"secret":"roommatch-2026","city":"Paris"}
app.post("/api/backfill-latlng", async (req, res) => {
  const { city, secret, dry_run } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const db = supabaseAdmin || supabase;
  const cities = city ? [city] : ["Paris", "Kuala Lumpur"];
  res.json({ message: `backfill-latlng started for: ${cities.join(", ")}` });
  (async () => {
    for (const c of cities) {
      try {
        const updated = await backfillCity(c, db, !!dry_run);
        console.log(`[backfill-latlng] ${c}: ${updated} updated`);
        // Refresh hotel_count for neighborhoods after backfill
        await refreshHotelCounts(c, db).catch(() => {});
      } catch (e) {
        console.error(`[backfill-latlng] ${c} error:`, e.message);
      }
    }
    console.log("[backfill-latlng] done");
  })();
});

// ── Manual trigger endpoint (protected) ───────────────────────────────────────
app.post("/api/index-city", async (req, res) => {
  const { city, limit, secret } = req.body || {};
  if (secret !== (process.env.INDEX_SECRET || "roommatch-index")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!city) return res.status(400).json({ error: "city required" });
  // Fire and forget
  indexCity(city, limit || 200)
    .catch(e => {
      console.error(`[indexer] FAILED for ${city}:`, e.message);
    });
  res.json({ message: `Indexing ${city} started`, city, limit: limit || 200 });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "index.html"));
});

// ── Graceful shutdown: fix any cities stuck at "indexing" when Render deploys ──
async function gracefulShutdown(signal) {
  console.log(`[shutdown] ${signal} received — cleaning up stuck indexing jobs`);
  if (!supabaseAdmin) { process.exit(0); return; }
  try {
    // Find any cities still marked as indexing
    const { data: stuck } = await supabaseAdmin
      .from("indexed_cities")
      .select("city")
      .eq("status", "indexing");

    for (const row of (stuck || [])) {
      // Update to "complete" with actual counts from room_embeddings
      const { data: counts } = await supabaseAdmin
        .from("room_embeddings")
        .select("hotel_id", { count: "exact" })
        .eq("city", row.city);

      const { count: photoCount } = await supabaseAdmin
        .from("room_embeddings")
        .select("*", { count: "exact", head: true })
        .eq("city", row.city);

      const hotelIds = new Set((counts || []).map(r => r.hotel_id));

      await supabaseAdmin.from("indexed_cities").update({
        status:      photoCount > 0 ? "complete" : "failed",
        hotel_count: hotelIds.size,
        photo_count: photoCount || 0,
        completed_at: new Date().toISOString(),
      }).eq("city", row.city);

      console.log(`[shutdown] ${row.city}: marked ${photoCount > 0 ? "complete" : "failed"} (${hotelIds.size} hotels, ${photoCount} photos)`);
    }
  } catch (e) {
    console.warn("[shutdown] cleanup error:", e.message);
  }
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

app.listen(PORT, () => {
  console.log(`[config] Using ${IS_PROD ? "PRODUCTION" : "SANDBOX"} LiteAPI key`);
  console.log(`TravelBoop on port ${PORT}`);

  // ── Keepalive: ping self every 10 min to prevent Render free tier spin-down
  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_URL) {
    console.log(`[keepalive] pinging ${RENDER_URL} every 10 min`);
    setInterval(async () => {
      try {
        await fetch(`${RENDER_URL}/api/health`);
        console.log('[keepalive] ping ok');
      } catch (e) {
        console.warn('[keepalive] ping failed:', e.message);
      }
    }, 10 * 60 * 1000);
  }
});
