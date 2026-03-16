/**
 * RoomMatch — server.js
 * Node.js / Express backend using LiteAPI room-search
 *
 * Environment variables (set in Render dashboard):
 *   LITEAPI_KEY  — sandbox key from dashboard.liteapi.travel
 */

const express = require("express");
const cors    = require("cors");
const path    = require("path");
require("dotenv").config();

const app        = express();
const LITEAPI_KEY = process.env.LITEAPI_KEY || "";
const PORT        = process.env.PORT || 3000;

// ── City → lat/lng for geo-filtered room search ───────────────────────────────
const CITY_COORDS = {
  "new york": [40.7128, -74.006], "new york city": [40.7128, -74.006],
  "nyc": [40.7128, -74.006], "manhattan": [40.758, -73.9855],
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
  "phuket": [7.8804, 98.3923], "beijing": [39.9042, 116.4074],
  "shanghai": [31.2304, 121.4737], "seoul": [37.5665, 126.978],
};

function resolveCoords(city) {
  const key = city.trim().toLowerCase();
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  for (const [k, v] of Object.entries(CITY_COORDS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return null;
}

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "client")));

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "RoomMatch — LiteAPI" });
});

// ── Room search ───────────────────────────────────────────────────────────────
app.get("/api/room-search", async (req, res) => {
  const { query, city } = req.query;

  if (!query || !city) {
    return res.status(400).json({ error: "query and city are required" });
  }
  if (!LITEAPI_KEY) {
    return res.status(500).json({ error: "LITEAPI_KEY not configured" });
  }

  const params = new URLSearchParams({ query, limit: 20 });

  // Add geo filter using lat/lng (most reliable)
  const coords = resolveCoords(city);
  if (coords) {
    params.set("latitude",  coords[0]);
    params.set("longitude", coords[1]);
    params.set("radius",    15); // km
  } else {
    // Fall back to city name param
    params.set("city", city);
  }

  console.log(`[room-search] query="${query}" city="${city}" → ${params}`);

  try {
    const response = await fetch(
      `https://api.liteapi.travel/v3.0/data/hotels/room-search?${params}`,
      { headers: { "X-API-Key": LITEAPI_KEY, "accept": "application/json" } }
    );

    const raw = await response.json();
    console.log(`[room-search] status=${response.status} hotels=${raw?.data?.length ?? 0}`);
    if (raw?.data?.length > 0) {
      const first = raw.data[0];
      console.log("[room-search] first hotel keys:", Object.keys(first));
      console.log("[room-search] first rooms:", JSON.stringify((first.rooms || []).slice(0,1), null, 2));
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: raw?.error?.description || raw?.error?.message || "LiteAPI error"
      });
    }

    // Normalise response
    const rawHotels = (raw.data || []).map(h => ({
      id:          h.id          || h.hotelId || "",
      name:        h.name        || h.hotelName || "Hotel",
      address:     h.address     || "",
      city:        h.city        || city,
      country:     h.country     || "",
      starRating:  h.starRating  || h.stars || 0,
      rating:      h.rating      || h.guestRating || 0,
      mainPhoto:   h.main_photo  || h.mainPhoto || "",
      rooms: (h.rooms || []).map(r => ({
        name:       r.room_name  || r.roomName  || r.name || "",
        imageUrl:   r.image_url  || r.imageUrl  || r.image || r.url || "",
        score:      r.similarity || r.score || 0,
      }))
    }));

    // Normalise scores: cosine similarity ranges ~0.15–0.35, looks bad as raw %.
    // Scale so the best result = 95% and floor = 30%, everything else scales between.
    const allScores = rawHotels.flatMap(h => h.rooms.map(r => r.score)).filter(s => s > 0);
    const maxScore  = allScores.length > 0 ? Math.max(...allScores) : 1;
    const minScore  = allScores.length > 0 ? Math.min(...allScores) : 0;
    const range     = maxScore - minScore || 1;
    const FLOOR = 30, CEIL = 95;

    const hotels = rawHotels.map(h => ({
      ...h,
      rooms: h.rooms.map(r => ({
        ...r,
        score: r.score > 0
          ? Math.round(FLOOR + ((r.score - minScore) / range) * (CEIL - FLOOR))
          : 0
      }))
    }));

    res.json({ hotels, query, city });
  } catch (err) {
    console.error("[room-search] error:", err);
    res.status(500).json({ error: "Search failed: " + err.message });
  }
});

// ── Serve frontend ────────────────────────────────────────────────────────────
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "index.html"));
});

app.listen(PORT, () => console.log(`RoomMatch running on port ${PORT}`));
