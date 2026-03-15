"""
RoomMatch — server.py
LiteAPI (Nuitee) for hotel search + room-mapped photos
Gemini Vision for room photo analysis and ranking

Required environment variables (set in Render dashboard):
  LITEAPI_KEY  — from dashboard.liteapi.travel (sandbox key, instant signup)
  GEMINI_KEY   — from aistudio.google.com (free)
"""

import os, base64, asyncio, re, json, logging
from typing import Optional
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("roommatch")

LITEAPI_KEY  = os.getenv("LITEAPI_KEY", "")
GEMINI_KEY   = os.getenv("GEMINI_KEY", "")
PORT         = int(os.getenv("PORT", 8000))
LITEAPI_BASE = "https://api.liteapi.travel/v3.0"

# ── In-memory caches ───────────────────────────────────────────────────────────
_hotel_cache:      dict = {}   # iata_code → list of hotels
_room_photo_cache: dict = {}   # hotel_id  → list of photo URLs

# ── City → lat/lng lookup ─────────────────────────────────────────────────────
# LiteAPI /data/hotels requires countryCode, lat+lng+radius, placeId, or hotelIds.
# We use lat/lng with a 15km radius — unambiguous and works for any city.
CITY_COORDS = {
    # North America
    "new york": (40.7128, -74.0060), "new york city": (40.7128, -74.0060),
    "nyc": (40.7128, -74.0060), "manhattan": (40.7580, -73.9855),
    "los angeles": (34.0522, -118.2437), "la": (34.0522, -118.2437),
    "chicago": (41.8781, -87.6298), "miami": (25.7617, -80.1918),
    "las vegas": (36.1699, -115.1398), "san francisco": (37.7749, -122.4194),
    "seattle": (47.6062, -122.3321), "boston": (42.3601, -71.0589),
    "washington": (38.9072, -77.0369), "dc": (38.9072, -77.0369),
    "washington dc": (38.9072, -77.0369), "new orleans": (29.9511, -90.0715),
    "austin": (30.2672, -97.7431), "denver": (39.7392, -104.9903),
    "portland": (45.5051, -122.6750), "toronto": (43.6532, -79.3832),
    "vancouver": (49.2827, -123.1207), "montreal": (45.5017, -73.5673),
    "mexico city": (19.4326, -99.1332), "cancun": (21.1619, -86.8515),
    # South America
    "rio de janeiro": (-22.9068, -43.1729), "rio": (-22.9068, -43.1729),
    "sao paulo": (-23.5505, -46.6333), "buenos aires": (-34.6037, -58.3816),
    "bogota": (4.7110, -74.0721), "lima": (-12.0464, -77.0428),
    "santiago": (-33.4489, -70.6693),
    # Europe
    "london": (51.5074, -0.1278), "paris": (48.8566, 2.3522),
    "barcelona": (41.3851, 2.1734), "madrid": (40.4168, -3.7038),
    "rome": (41.9028, 12.4964), "milan": (45.4654, 9.1859),
    "florence": (43.7696, 11.2558), "venice": (45.4408, 12.3155),
    "amsterdam": (52.3676, 4.9041), "berlin": (52.5200, 13.4050),
    "munich": (48.1351, 11.5820), "hamburg": (53.5753, 10.0153),
    "prague": (50.0755, 14.4378), "vienna": (48.2082, 16.3738),
    "budapest": (47.4979, 19.0402), "warsaw": (52.2297, 21.0122),
    "lisbon": (38.7223, -9.1393), "porto": (41.1579, -8.6291),
    "athens": (37.9838, 23.7275), "istanbul": (41.0082, 28.9784),
    "zurich": (47.3769, 8.5417), "geneva": (46.2044, 6.1432),
    "brussels": (50.8503, 4.3517), "copenhagen": (55.6761, 12.5683),
    "oslo": (59.9139, 10.7522), "stockholm": (59.3293, 18.0686),
    "helsinki": (60.1699, 24.9384), "bucharest": (44.4268, 26.1025),
    "dublin": (53.3498, -6.2603), "edinburgh": (55.9533, -3.1883),
    "manchester": (53.4808, -2.2426),
    # Middle East & Africa
    "dubai": (25.2048, 55.2708), "abu dhabi": (24.4539, 54.3773),
    "cairo": (30.0444, 31.2357), "cape town": (-33.9249, 18.4241),
    "nairobi": (-1.2921, 36.8219), "marrakech": (31.6295, -7.9811),
    "tel aviv": (32.0853, 34.7818), "doha": (25.2854, 51.5310),
    # Asia Pacific
    "tokyo": (35.6762, 139.6503), "osaka": (34.6937, 135.5023),
    "kyoto": (35.0116, 135.7681), "bangkok": (13.7563, 100.5018),
    "singapore": (1.3521, 103.8198), "hong kong": (22.3193, 114.1694),
    "bali": (-8.3405, 115.0920), "jakarta": (-6.2088, 106.8456),
    "kuala lumpur": (3.1390, 101.6869), "sydney": (-33.8688, 151.2093),
    "melbourne": (-37.8136, 144.9631), "auckland": (-36.8485, 174.7633),
    "mumbai": (19.0760, 72.8777), "delhi": (28.6139, 77.2090),
    "new delhi": (28.6139, 77.2090), "phuket": (7.8804, 98.3923),
    "chiang mai": (18.7883, 98.9853), "maldives": (3.2028, 73.2207),
    "beijing": (39.9042, 116.4074), "shanghai": (31.2304, 121.4737),
    "seoul": (37.5665, 126.9780),
}

def resolve_coords(city: str) -> tuple:
    key    = city.strip().lower()
    coords = CITY_COORDS.get(key)
    if not coords:
        for k, v in CITY_COORDS.items():
            if key in k or k in key:
                coords = v
                break
    if not coords:
        raise HTTPException(404, f"City '{city}' not recognised. Try: London, Paris, New York, Tokyo, Dubai…")
    return coords

# ── Auth header ────────────────────────────────────────────────────────────────
def la_headers() -> dict:
    return {"X-API-Key": LITEAPI_KEY, "accept": "application/json"}

# ── Keepalive ping (prevents Render free tier sleep) ──────────────────────────
async def self_ping():
    await asyncio.sleep(60)
    render_url = os.getenv("RENDER_EXTERNAL_URL", "")
    if not render_url:
        return
    async with httpx.AsyncClient() as c:
        while True:
            try:
                await c.get(f"{render_url}/", timeout=10)
            except Exception:
                pass
            await asyncio.sleep(600)

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(self_ping())
    yield
    task.cancel()

app = FastAPI(title="RoomMatch API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"], allow_credentials=False)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": str(exc)},
                        headers={"Access-Control-Allow-Origin": "*"})

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail},
                        headers={"Access-Control-Allow-Origin": "*"})

# ── Models ─────────────────────────────────────────────────────────────────────
class SearchRequest(BaseModel):
    destination: str
    checkin:     str
    checkout:    str
    adults:      int = 2
    min_rating:  float = 0.0

class AnalyzeRequest(BaseModel):
    hotel_code:  str
    style_attrs: dict

# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "ok", "service": "RoomMatch API — LiteAPI"}

# ── Search hotels by city ──────────────────────────────────────────────────────
@app.post("/search")
async def search_hotels(req: SearchRequest):
    if not LITEAPI_KEY:
        raise HTTPException(500, "LITEAPI_KEY not set in Render environment")

    city        = req.destination.strip()
    lat, lng    = resolve_coords(city)
    cache_key   = city.lower()

    if cache_key in _hotel_cache:
        logger.info(f"[search] cache hit for '{city}'")
        raw_hotels = _hotel_cache[cache_key]
    else:
        logger.info(f"[search] fetching hotels for '{city}' → ({lat},{lng})")
        async with httpx.AsyncClient(timeout=30) as c:
            res = await c.get(f"{LITEAPI_BASE}/data/hotels", headers=la_headers(),
                              params={"latitude": lat, "longitude": lng,
                                      "radius": 15, "limit": 50})

        logger.info(f"[search] status={res.status_code} body={res.text[:300]}")

        if res.status_code == 401:
            raise HTTPException(401, "Invalid LITEAPI_KEY — check Render environment variables")
        if res.status_code == 429:
            raise HTTPException(429, "LiteAPI rate limit — please wait a moment and try again")
        if res.status_code != 200:
            raise HTTPException(502, f"Hotel search failed ({res.status_code}): {res.text[:200]}")

        data       = res.json()
        raw_hotels = data.get("data", data.get("hotels", []))

        if not raw_hotels:
            raise HTTPException(404, f"No hotels found for '{city}'. Try 'London', 'Paris' or 'Tokyo'.")

        _hotel_cache[cache_key] = raw_hotels
        logger.info(f"[search] fetched {len(raw_hotels)} hotels for '{city}', cached")

    def stars(h):
        r = h.get("starRating") or h.get("stars") or h.get("rating") or 0
        try:
            return float(str(r).replace("*","").strip())
        except Exception:
            return 0

    sorted_hotels = sorted(raw_hotels, key=stars, reverse=True)

    hotels = []
    for h in sorted_hotels[:30]:
        hotel_id = str(h.get("id") or h.get("hotelId") or h.get("hotel_id") or "")
        if not hotel_id:
            continue

        name   = h.get("name") or h.get("hotelName") or "Hotel"
        images = h.get("images") or h.get("hotelImages") or []
        thumbnail = ""
        if images:
            first = images[0]
            thumbnail = first if isinstance(first, str) else (
                first.get("url") or first.get("link") or first.get("path") or "")

        facilities = h.get("facilities") or h.get("amenities") or []
        amenities  = []
        for f in facilities[:6]:
            label = f if isinstance(f, str) else (
                f.get("name") or f.get("title") or f.get("description") or "")
            if label:
                amenities.append(label)

        addr    = h.get("address") or {}
        address = addr if isinstance(addr, str) else (
            addr.get("line1") or addr.get("street") or addr.get("addressLine1") or
            ", ".join(filter(None, [addr.get("city"), addr.get("country")])) or "")

        hotels.append({
            "id":           hotel_id,
            "name":         name,
            "rating":       float(h.get("guestRating") or h.get("reviewScore") or 0),
            "reviewCount":  int(h.get("reviewCount") or h.get("numReviews") or 0),
            "starRating":   stars(h),
            "price":        "",
            "thumbnail":    thumbnail,
            "neighborhood": h.get("neighborhood") or h.get("area") or "",
            "address":      address,
            "amenities":    amenities,
        })

    if not hotels:
        raise HTTPException(404, f"No hotels with usable data for '{city}'.")

    return {"hotels": hotels, "destination": city}


# ── Fetch room photos for a specific hotel ─────────────────────────────────────
async def fetch_room_photos(hotel_id: str) -> list[str]:
    if hotel_id in _room_photo_cache:
        return _room_photo_cache[hotel_id]

    logger.info(f"[room_photos] fetching detail for hotel {hotel_id}")
    async with httpx.AsyncClient(timeout=20) as c:
        res = await c.get(f"{LITEAPI_BASE}/data/hotel", headers=la_headers(),
                          params={"hotelId": hotel_id})

    if res.status_code != 200:
        logger.warning(f"[room_photos] failed {res.status_code} for hotel {hotel_id}")
        return []

    data  = res.json()
    hotel = data.get("data") or data

    all_images = hotel.get("images") or hotel.get("hotelImages") or []
    room_imgs, other_imgs = [], []

    for img in all_images:
        url = img if isinstance(img, str) else (
            img.get("url") or img.get("link") or img.get("path") or "")
        if not url:
            continue
        img_type = "" if isinstance(img, str) else (
            img.get("type") or img.get("category") or img.get("tag") or "").lower()
        if any(t in img_type for t in ["room", "bedroom", "bathroom", "suite"]):
            room_imgs.append(url)
        else:
            other_imgs.append(url)

    chosen = room_imgs[:10] if room_imgs else other_imgs[:8]
    logger.info(f"[room_photos] hotel {hotel_id}: {len(room_imgs)} room + {len(other_imgs)} other → {len(chosen)} chosen")
    _room_photo_cache[hotel_id] = chosen
    return chosen


# ── Fetch image as base64 ──────────────────────────────────────────────────────
async def fetch_b64(url: str) -> Optional[tuple]:
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as c:
            res = await c.get(url, headers={"User-Agent": "Mozilla/5.0"})
        if res.status_code != 200:
            return None
        mime = res.headers.get("content-type", "image/jpeg").split(";")[0]
        return base64.b64encode(res.content).decode(), mime
    except Exception:
        return None


# ── Analyze hotel room photos with Gemini Vision ───────────────────────────────
@app.post("/analyze/{hotel_code}")
async def analyze_hotel(hotel_code: str, req: AnalyzeRequest):
    attrs      = req.style_attrs
    photo_urls = await fetch_room_photos(hotel_code)

    if not photo_urls:
        return {"hotelCode": hotel_code, "score": 50, "features": {},
                "summary": "No room photos available", "photos": [], "roomPhotoCount": 0}

    b64_results    = await asyncio.gather(*[fetch_b64(u) for u in photo_urls[:6]])
    indexed_images = [(i, r) for i, r in enumerate(b64_results) if r]

    if not indexed_images:
        return {"hotelCode": hotel_code, "score": 50, "features": {},
                "summary": "Could not load room photos",
                "photos": photo_urls[:3], "roomPhotoCount": len(photo_urls)}

    wanted_features = []
    if attrs.get("double_sinks"):   wanted_features.append("double sinks / two bathroom sinks")
    if attrs.get("large_bathroom"): wanted_features.append("large spacious bathroom")
    if attrs.get("bathtub"):        wanted_features.append("bathtub or soaking tub")
    if attrs.get("sofa"):           wanted_features.append("sofa or lounge seating area")
    if attrs.get("workspace"):      wanted_features.append("desk or workspace")
    if attrs.get("great_view"):     wanted_features.append("window view or panoramic view")
    if attrs.get("large_room"):     wanted_features.append("spacious room layout")
    if attrs.get("modern_style"):   wanted_features.append("modern contemporary design")
    wanted_str = ", ".join(wanted_features) if wanted_features else "overall room quality and style"

    prompt = f"""You are analyzing {len(indexed_images)} hotel room photos numbered 0 to {len(indexed_images)-1}.

The traveler's key preferences are: {wanted_str}

Tasks:
1. Rank photos so those best showing the traveler's desired features appear first
2. Score the overall match
3. Note which features are visible in each photo

Return ONLY valid JSON, no markdown:
{{
  "photo_ranking": [list of photo indices 0-{len(indexed_images)-1} ordered most to least relevant],
  "photo_features": {{"0": ["features in photo 0"], "1": ["features in photo 1"]}},
  "match_score": 0-100,
  "large_bathroom": true/false,
  "double_sinks": true/false,
  "bathtub": true/false,
  "sofa": true/false,
  "workspace": true/false,
  "great_view": true/false,
  "large_room": true/false,
  "modern_style": true/false,
  "room_style": "one word",
  "standout_features": ["2-3 specific features visible"],
  "match_summary": "one sentence explaining the match"
}}"""

    parts = []
    for _, (b64, mime) in indexed_images:
        parts.append({"inline_data": {"mime_type": mime, "data": b64}})
    parts.append({"text": prompt})

    async with httpx.AsyncClient(timeout=60) as c:
        res = await c.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={GEMINI_KEY}",
            headers={"Content-Type": "application/json"},
            json={"contents": [{"parts": parts}]},
        )

    if res.status_code != 200:
        return {"hotelCode": hotel_code, "score": 55, "features": {},
                "summary": f"Vision analysis unavailable ({res.status_code})",
                "photos": photo_urls[:4], "roomPhotoCount": len(photo_urls)}

    text = (res.json().get("candidates", [{}])[0]
                      .get("content", {})
                      .get("parts", [{}])[0]
                      .get("text", ""))

    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return {"hotelCode": hotel_code, "score": 50, "features": {},
                "summary": "Analysis parse error", "photos": photo_urls[:4],
                "roomPhotoCount": len(photo_urls)}

    analysis  = json.loads(m.group())
    feat_keys = ["large_bathroom","double_sinks","bathtub","sofa",
                 "workspace","great_view","large_room","modern_style"]

    ranking      = analysis.get("photo_ranking", list(range(len(indexed_images))))
    ordered_urls = []
    for rank_idx in ranking:
        if rank_idx < len(indexed_images):
            orig_idx = indexed_images[rank_idx][0]
            if orig_idx < len(photo_urls):
                ordered_urls.append(photo_urls[orig_idx])
    ranked_set = set(ordered_urls)
    for url in photo_urls[:6]:
        if url not in ranked_set:
            ordered_urls.append(url)

    photo_features       = analysis.get("photo_features", {})
    photos_with_features = []
    for i, url in enumerate(ordered_urls[:4]):
        feats = photo_features.get(str(ranking[i] if i < len(ranking) else i), [])
        photos_with_features.append({"url": url, "features": feats})

    return {
        "hotelCode":          hotel_code,
        "score":              analysis.get("match_score", 50),
        "features":           {k: analysis[k] for k in feat_keys if k in analysis},
        "roomStyle":          analysis.get("room_style", ""),
        "standoutFeatures":   analysis.get("standout_features", []),
        "summary":            analysis.get("match_summary", ""),
        "photos":             ordered_urls[:4],
        "photosWithFeatures": photos_with_features,
        "roomPhotoCount":     len(photo_urls),
    }


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=True)
