/**
 * RoomMatch — server.js
 * Room-search for hotel discovery + hotel detail for full room inventory
 */

const express = require("express");
const cors    = require("cors");
const path    = require("path");
require("dotenv").config();

const app         = express();
const LITEAPI_KEY = process.env.LITEAPI_KEY || "";
const PORT        = process.env.PORT || 3000;

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

// ── Main search endpoint ───────────────────────────────────────────────────────
app.get("/api/room-search", async (req, res) => {
  const { query, city } = req.query;
  if (!query || !city) return res.status(400).json({ error: "query and city are required" });
  if (!LITEAPI_KEY)    return res.status(500).json({ error: "LITEAPI_KEY not configured" });

  // ── Step 1: room-search → ranked hotels + best matching room per hotel ──────
  const params = new URLSearchParams({ query, limit: 20 });
  const coords = resolveCoords(city);
  if (coords) {
    params.set("latitude", coords[0]);
    params.set("longitude", coords[1]);
    params.set("radius", 15);
  } else {
    params.set("city", city);
  }

  console.log(`[search] "${query}" in ${city}`);
  const searchRes = await liteGet(`/data/hotels/room-search?${params}`);
  if (!searchRes.ok) {
    return res.status(searchRes.status).json({
      error: searchRes.data?.error?.description || "Room search failed"
    });
  }

  const searchData = searchRes.data?.data || [];
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
  const detailResults = await Promise.all(
    searchData.map(h => liteGet(`/data/hotel?hotelId=${h.id}`).catch(() => null))
  );

  // ── Step 3: build structured hotel + room-type response ──────────────────────
  const hotels = searchData.map((h, i) => {
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

  console.log(`[search] done — ${hotels.length} hotels, room types: ${hotels.map(h => h.roomTypes.length).join(",")}`);
  res.json({ hotels, query, city });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client", "index.html"));
});

app.listen(PORT, () => console.log(`RoomMatch on port ${PORT}`));
