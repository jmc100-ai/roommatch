"""
RoomMatch — server.py
Hotelbeds API for hotel search + room-tagged photos
Gemini Vision for room photo analysis

Required environment variables (set in Render dashboard):
  HOTELBEDS_KEY    — your Hotelbeds API key
  HOTELBEDS_SECRET — your Hotelbeds shared secret
  GEMINI_KEY       — from aistudio.google.com (free)

Optional:
  GOOGLE_KEY       — Google Places key (used as fallback for hotel thumbnails)
"""

import os, base64, asyncio, re, json, hashlib, time
from typing import Optional
import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager

HOTELBEDS_KEY    = os.getenv("HOTELBEDS_KEY", "")
HOTELBEDS_SECRET = os.getenv("HOTELBEDS_SECRET", "")
GEMINI_KEY       = os.getenv("GEMINI_KEY", "")
GOOGLE_KEY       = os.getenv("GOOGLE_KEY", "")
PORT             = int(os.getenv("PORT", 8000))
HOTELBEDS_BASE   = "https://api.test.hotelbeds.com"  # sandbox

# ── Hardcoded destination codes for common cities ──────────────────────────────
# Avoids real-time Content API calls which Hotelbeds explicitly discourages.
# Add more as needed from: developer.hotelbeds.com dashboard → Content API → Destinations
CITY_CODES = {
    "paris": "PAR", "london": "LON", "new york": "NYC", "barcelona": "BCN",
    "madrid": "MAD", "rome": "ROM", "amsterdam": "AMS", "berlin": "BER",
    "prague": "PRG", "vienna": "VIE", "lisbon": "LIS", "athens": "ATH",
    "istanbul": "IST", "dubai": "DXB", "tokyo": "TYO", "bangkok": "BKK",
    "singapore": "SIN", "hong kong": "HKG", "sydney": "SYD", "miami": "MIA",
    "los angeles": "LAX", "chicago": "CHI", "las vegas": "LAS",
    "san francisco": "SFO", "new orleans": "MSY", "seattle": "SEA",
    "toronto": "YTO", "mexico city": "MEX", "cancun": "CUN",
    "rio de janeiro": "RIO", "buenos aires": "BUE", "bogota": "BOG",
    "cairo": "CAI", "cape town": "CPT", "nairobi": "NBO",
    "munich": "MUC", "milan": "MIL", "florence": "FLR", "venice": "VCE",
    "zurich": "ZRH", "geneva": "GVA", "brussels": "BRU", "Copenhagen": "CPH",
    "oslo": "OSL", "stockholm": "STO", "helsinki": "HEL",
    "budapest": "BUD", "warsaw": "WAW", "bucharest": "OTP",
    "mumbai": "BOM", "delhi": "DEL", "bali": "DPS", "maldives": "MLE",
    "marrakech": "RAK", "casablanca": "CAS",
}

async def resolve_destination(name: str) -> tuple[str, str]:
    """Resolve city name to Hotelbeds destination code using local lookup table."""
    key  = name.strip().lower()
    code = CITY_CODES.get(key)

    # Try partial match if exact not found
    if not code:
        for city, c in CITY_CODES.items():
            if key in city or city in key:
                code = c
                break

    if not code:
        available = ", ".join(sorted(CITY_CODES.keys())[:20])
        raise HTTPException(404,
            f"City '{name}' not in supported list. Try one of: {available}...")

    logger.info(f"[destinations] resolved '{name}' → {code}")
    return code, ""

import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("roommatch")

# ── Keepalive ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(self_ping())
    yield
    task.cancel()

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

app = FastAPI(title="RoomMatch API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers={"Access-Control-Allow-Origin": "*"},
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={"Access-Control-Allow-Origin": "*"},
    )

# ── Hotelbeds signature auth ───────────────────────────────────────────────────
def hb_headers() -> dict:
    """Generate Hotelbeds required auth headers."""
    ts  = str(int(time.time()))
    sig = hashlib.sha256((HOTELBEDS_KEY + HOTELBEDS_SECRET + ts).encode()).hexdigest()
    return {
        "Api-key":       HOTELBEDS_KEY,
        "X-Signature":   sig,
        "Accept":        "application/json",
        "Accept-Encoding": "gzip",
        "Content-Type":  "application/json",
    }

# ── Models ─────────────────────────────────────────────────────────────────────
class SearchRequest(BaseModel):
    destination: str
    checkin:     str   # YYYY-MM-DD
    checkout:    str   # YYYY-MM-DD
    adults:      int = 2
    min_rating:  float = 0.0

class AnalyzeRequest(BaseModel):
    hotel_code:  str
    style_attrs: dict

# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "ok", "service": "RoomMatch API — Hotelbeds"}

# ── Step 1: Get hotel codes for a destination from Content API ────────────────
async def get_hotel_codes_for_destination(dest_code: str, min_category: int = 3) -> list[int]:
    """Use Content API to get hotel codes for a destination code."""
    url    = f"{HOTELBEDS_BASE}/hotel-content-api/1.0/hotels"
    params = {
        "destinationCode": dest_code,
        "fields":          "code,name,categoryCode",
        "language":        "ENG",
        "from":            1,
        "to":              20,
    }
    logger.info(f"[hotel_codes] querying dest_code={dest_code}")
    async with httpx.AsyncClient(timeout=20) as c:
        res = await c.get(url, headers=hb_headers(), params=params)
    logger.info(f"[hotel_codes] response {res.status_code}: {res.text[:600]}")
    if res.status_code != 200:
        return []
    hotels = res.json().get("hotels", [])
    logger.info(f"[hotel_codes] total hotels returned: {len(hotels)}")
    if not hotels:
        return []
    # Return all codes — don't filter by category in sandbox as data may be sparse
    codes = [h["code"] for h in hotels if h.get("code")]
    logger.info(f"[hotel_codes] codes: {codes[:10]}")
    return codes[:15]

# ── Step 2: Search hotels using Content API (no availability call needed) ──────
@app.post("/search")
async def search_hotels(req: SearchRequest):
    if not HOTELBEDS_KEY:
        raise HTTPException(500, "HOTELBEDS_KEY not set in Render environment")

    dest_code, _ = await resolve_destination(req.destination)
    logger.info(f"[search] {req.destination} → {dest_code}")

    url    = f"{HOTELBEDS_BASE}/hotel-content-api/1.0/hotels"
    params = {
        "destinationCode": dest_code,
        "fields":          "code,name,categoryCode,address,images,facilities",
        "language":        "ENG",
        "from":            1,
        "to":              20,
    }
    async with httpx.AsyncClient(timeout=20) as c:
        res = await c.get(url, headers=hb_headers(), params=params)

    if res.status_code != 200:
        raise HTTPException(502, f"Hotel content failed ({res.status_code}): {res.text[:200]}")

    raw_hotels = res.json().get("hotels", [])
    logger.info(f"[search] got {len(raw_hotels)} hotels")

    if not raw_hotels:
        raise HTTPException(404, f"No hotels found for '{req.destination}'. Try London, Barcelona or Tokyo.")

    hotels = []
    for h in raw_hotels[:12]:
        images    = h.get("images", [])
        room_imgs = [i for i in images if i.get("imageTypeCode") == "HAB"]
        thumb_img = room_imgs[0] if room_imgs else (images[0] if images else None)
        thumbnail = f"https://photos.hotelbeds.com/giata/original/{thumb_img['path']}" if thumb_img else ""

        cat      = h.get("categoryCode", "")
        star_num = int("".join(filter(str.isdigit, cat))) if any(c.isdigit() for c in cat) else 0

        addr_obj  = h.get("address", {})
        address   = addr_obj.get("content", "") if isinstance(addr_obj, dict) else str(addr_obj)

        raw_name  = h.get("name", {})
        name      = raw_name.get("content", "Hotel") if isinstance(raw_name, dict) else str(raw_name)

        facilities = h.get("facilities", [])
        amenities  = []
        for f in facilities[:6]:
            desc = f.get("description", {})
            txt  = desc.get("content", "") if isinstance(desc, dict) else str(desc)
            if txt:
                amenities.append(txt)

        hotels.append({
            "id":          str(h["code"]),
            "name":        name,
            "rating":      0,
            "reviewCount": 0,
            "starRating":  star_num,
            "price":       "",
            "thumbnail":   thumbnail,
            "neighborhood": "",
            "address":     address,
            "amenities":   amenities,
        })

    return {"hotels": hotels, "destination": req.destination}

# ── Fetch thumbnails for hotel list ───────────────────────────────────────────
async def fetch_thumbnails(codes: list[str]) -> dict:
    """Quick fetch of one thumbnail per hotel for the results grid."""
    if not codes:
        return {}
    url    = f"{HOTELBEDS_BASE}/hotel-content-api/1.0/hotels"
    params = {
        "codes":    ",".join(codes[:12]),
        "fields":   "code,images",
        "language": "ENG",
        "from":     1,
        "to":       len(codes),
    }
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            res = await c.get(url, headers=hb_headers(), params=params)
        if res.status_code != 200:
            return {}
        result = {}
        for hotel in res.json().get("hotels", []):
            images = hotel.get("images", [])
            # Prefer room images (HAB), fall back to any
            room_imgs = [i for i in images if i.get("imageTypeCode") == "HAB"]
            chosen    = room_imgs[0] if room_imgs else (images[0] if images else None)
            if chosen:
                path = chosen.get("path", "")
                result[str(hotel["code"])] = f"https://photos.hotelbeds.com/giata/original/{path}"
        return result
    except Exception:
        return {}

# ── Step 3: Fetch room photos for a specific hotel ────────────────────────────
async def fetch_room_photos(hotel_code: str) -> list[str]:
    """
    Fetch images tagged HAB (room) from Hotelbeds Content API.
    Returns list of full image URLs.
    """
    url    = f"{HOTELBEDS_BASE}/hotel-content-api/1.0/hotels"
    params = {
        "codes":    hotel_code,
        "fields":   "images",
        "language": "ENG",
        "from":     1,
        "to":       1,
    }
    async with httpx.AsyncClient(timeout=15) as c:
        res = await c.get(url, headers=hb_headers(), params=params)

    if res.status_code != 200:
        return []

    hotels = res.json().get("hotels", [])
    if not hotels:
        return []

    images     = hotels[0].get("images", [])
    room_imgs  = [i for i in images if i.get("imageTypeCode") == "HAB"]
    other_imgs = [i for i in images if i.get("imageTypeCode") != "HAB"]

    # Use room photos, fall back to other photos if none
    chosen = room_imgs[:6] if room_imgs else other_imgs[:4]

    return [
        f"https://photos.hotelbeds.com/giata/original/{img['path']}"
        for img in chosen
        if img.get("path")
    ]

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

# ── Step 4: Analyze hotel room photos with Gemini Vision ──────────────────────
@app.post("/analyze/{hotel_code}")
async def analyze_hotel(hotel_code: str, req: AnalyzeRequest):
    attrs = req.style_attrs

    # Get room-tagged photos from Hotelbeds
    photo_urls = await fetch_room_photos(hotel_code)

    if not photo_urls:
        return {
            "hotelCode": hotel_code, "score": 50,
            "features": {}, "summary": "No room photos available",
            "photos": [], "roomPhotoCount": 0,
        }

    # Download up to 4 photos as base64 in parallel
    b64_results = await asyncio.gather(*[fetch_b64(u) for u in photo_urls[:4]])
    images      = [r for r in b64_results if r]

    if not images:
        return {
            "hotelCode": hotel_code, "score": 50,
            "features": {}, "summary": "Could not load room photos",
            "photos": photo_urls[:3], "roomPhotoCount": len(photo_urls),
        }

    prompt = f"""You are analyzing actual hotel ROOM photos (bedroom, bathroom, suite interiors).
Score how well these rooms match the traveler's preferences.

The traveler wants:
- Style: {attrs.get('overall_style', 'unknown')}
- Luxury level: {attrs.get('luxury_score', 5)}/10
- Room size preference: {attrs.get('room_size', 'standard')}
- Large bathroom: {attrs.get('large_bathroom', False)}
- Double sinks: {attrs.get('double_sinks', False)}
- Bathtub: {attrs.get('bathtub', False)}
- Sofa or lounge seating in room: {attrs.get('sofa', False)}
- Workspace or desk: {attrs.get('workspace', False)}
- Great view from room: {attrs.get('great_view', False)}
- Spacious room: {attrs.get('large_room', False)}
- Modern/contemporary style: {attrs.get('modern_style', False)}

Return ONLY valid JSON, no markdown, no explanation:
{{
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
  "standout_features": ["2-3 specific things you can see in these room photos"],
  "match_summary": "one sentence explaining why this room does or doesn't match"
}}"""

    parts = []
    for b64, mime in images:
        parts.append({"inline_data": {"mime_type": mime, "data": b64}})
    parts.append({"text": prompt})

    async with httpx.AsyncClient(timeout=45) as c:
        res = await c.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={GEMINI_KEY}",
            headers={"Content-Type": "application/json"},
            json={"contents": [{"parts": parts}]},
        )

    if res.status_code != 200:
        # Return a partial result with photos even if Gemini fails
        return {
            "hotelCode": hotel_code, "score": 55,
            "features": {}, "summary": f"Vision analysis unavailable ({res.status_code})",
            "photos": photo_urls[:4], "roomPhotoCount": len(photo_urls),
        }

    text  = (res.json()
               .get("candidates", [{}])[0]
               .get("content", {})
               .get("parts", [{}])[0]
               .get("text", ""))

    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return {
            "hotelCode": hotel_code, "score": 50, "features": {},
            "summary": "Analysis parse error", "photos": photo_urls[:4],
            "roomPhotoCount": len(photo_urls),
        }

    analysis  = json.loads(m.group())
    feat_keys = ["large_bathroom","double_sinks","bathtub","sofa",
                 "workspace","great_view","large_room","modern_style"]

    return {
        "hotelCode":        hotel_code,
        "score":            analysis.get("match_score", 50),
        "features":         {k: analysis[k] for k in feat_keys if k in analysis},
        "roomStyle":        analysis.get("room_style", ""),
        "standoutFeatures": analysis.get("standout_features", []),
        "summary":          analysis.get("match_summary", ""),
        "photos":           photo_urls[:4],
        "roomPhotoCount":   len(photo_urls),
    }

# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=True)
