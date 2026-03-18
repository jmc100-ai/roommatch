/**
 * RoomMatch — server.js
 * Room-search for hotel discovery + hotel detail for full room inventory
 */

const express = require("express");
const cors    = require("cors");
const path    = require("path");
require("dotenv").config();

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
app.use(express.static(path.join(__dirname, "client")));

app.get("/api/health", (_, res) => res.json({ status: "ok" }));

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
        name:    p.city || p.name || "",
        country: p.country || "",
        state:   p.state   || "",
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
    console.log(`[search] trying: ${p.toString()}`);
    const r = await liteGet(`/data/hotels/room-search?${p}`);
    const count = r.data?.data?.length ?? 0;
    console.log(`[search] got ${count} hotels`);
    return r.ok ? (r.data?.data || []) : [];
  }

  // Attempt 1: lat/lng with radius
  let searchData = coords
    ? await trySearch({ latitude: coords[0], longitude: coords[1], radius: 30 })
    : [];

  // Attempt 2: city name if lat/lng gave < 15
  if (searchData.length < 15) {
    const r2 = await trySearch({ city });
    if (r2.length > searchData.length) {
      searchData = r2;
      console.log(`[search] city-name attempt better, using it`);
    }
  }

  // Attempt 3: no geo filter if still sparse
  if (searchData.length < 15) {
    const r3 = await trySearch({});
    if (r3.length > searchData.length) {
      searchData = r3;
      console.log(`[search] no-geo attempt better, using it`);
    }
  }

  console.log(`[search] final pool: ${searchData.length} hotels`);
  if (searchData.length === 0) return res.json({ hotels: [], query, city });

  // Normalise similarity scores to 30–95% range
  const rawScores = searchData.map(h => h.rooms?.[0]?.similarity || 0);
  const maxS = Math.max(...rawScores) || 1;
  const minS = Math.min(...rawScores.filter(s => s > 0)) || 0;
  const norm = s => s > 0 ? Math.round(30 + ((s - minS) / (maxS - minS || 1)) * 65) : null;

  // Build a map of hotelId → best match info from room-search
  const bestMatchMap = {};
  searchData.forEach((h, i) => {
    const r = h.rooms?.[0];
    bestMatchMap[h.id] = {
      roomName: r?.room_name || "",
      imageUrl: r?.image_url || "",
      score:    norm(r?.similarity || 0),
    };
  });

  // ── Step 2: parallel-fetch hotel details for full room inventory ─────────────
  // Only enrich top 20 — avoids unnecessary API calls for low-ranked hotels
  const top20 = searchData.slice(0, 20);
  const detailResults = await Promise.all(
    top20.map(h => liteGet(`/data/hotel?hotelId=${h.id}`).catch(() => null))
  );

  // ── Step 3: build structured hotel + room-type response ──────────────────────
  const hotels = top20.map((h, i) => {
    const detail  = detailResults[i]?.data?.data || null;
    const best    = bestMatchMap[h.id];

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
      id:         h.id,
      name:       detail?.name      || h.name,
      address:    detail?.address   || h.address || "",
      city:       detail?.city      || h.city    || city,
      country:    detail?.country   || h.country || "",
      starRating: detail?.starRating || h.starRating || 0,
      rating:     detail?.rating    || h.rating  || 0,
      roomTypes:  roomTypes.slice(0, 6), // max 6 room types per hotel
    };
  });

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

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "index.html"));
});

app.listen(PORT, () => {
  console.log(`[config] Using ${IS_PROD ? "PRODUCTION" : "SANDBOX"} LiteAPI key`);
  console.log(`RoomMatch on port ${PORT}`);

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
