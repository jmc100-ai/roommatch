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
    # North America
    "new york": "NYC", "new york city": "NYC", "nyc": "NYC", "manhattan": "NYC",
    "los angeles": "LAX", "la": "LAX", "chicago": "CHI", "miami": "MIA",
    "las vegas": "LAS", "san francisco": "SFO", "seattle": "SEA",
    "new orleans": "MSY", "boston": "BOS", "washington": "WAS", "dc": "WAS",
    "toronto": "YTO", "vancouver": "YVR", "montreal": "YMQ",
    "mexico city": "MEX", "cancun": "CUN",
    # South America
    "rio de janeiro": "RIO", "rio": "RIO", "buenos aires": "BUE", "bogota": "BOG",
    "lima": "LIM", "santiago": "SCL",
    # Europe
    "london": "LON", "paris": "PAR", "barcelona": "BCN", "madrid": "MAD",
    "rome": "ROM", "milan": "MIL", "florence": "FLR", "venice": "VCE",
    "amsterdam": "AMS", "berlin": "BER", "munich": "MUC", "hamburg": "HAM",
    "prague": "PRG", "vienna": "VIE", "budapest": "BUD", "warsaw": "WAW",
    "lisbon": "LIS", "porto": "OPO", "athens": "ATH", "istanbul": "IST",
    "zurich": "ZRH", "geneva": "GVA", "brussels": "BRU", "copenhagen": "CPH",
    "oslo": "OSL", "stockholm": "STO", "helsinki": "HEL", "bucharest": "OTP",
    "dublin": "DUB", "edinburgh": "EDI", "amsterdam": "AMS",
    # Middle East & Africa
    "dubai": "DXB", "abu dhabi": "AUH", "cairo": "CAI",
    "cape town": "CPT", "nairobi": "NBO", "marrakech": "RAK", "casablanca": "CAS",
    "tel aviv": "TLV",
    # Asia Pacific
    "tokyo": "TYO", "osaka": "OSA", "kyoto": "UKY",
    "bangkok": "BKK", "singapore": "SIN", "hong kong": "HKG",
    "bali": "DPS", "jakarta": "JKT", "kuala lumpur": "KUL",
    "sydney": "SYD", "melbourne": "MEL", "auckland": "AKL",
    "mumbai": "BOM", "delhi": "DEL", "new delhi": "DEL",
    "maldives": "MLE", "phuket": "HKT", "chiang mai": "CNX",
    "beijing": "BJS", "shanghai": "SHA", "seoul": "SEL",
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
        "to":              50,
    }
    async with httpx.AsyncClient(timeout=30) as c:
        res = await c.get(url, headers=hb_headers(), params=params)

    if res.status_code == 403:
        try:
            err = res.json().get("error", "")
        except Exception:
            err = res.text[:100]
        if "quota" in err.lower() or "quota" in res.text.lower():
            raise HTTPException(429, "Hotelbeds sandbox quota exceeded. Please wait a few minutes and try again — the sandbox has limited free calls per hour.")
        raise HTTPException(403, f"Hotelbeds access denied: {err}")

    if res.status_code != 200:
        raise HTTPException(502, f"Hotel content failed ({res.status_code}): {res.text[:200]}")

    raw_hotels = res.json().get("hotels", [])
    logger.info(f"[search] got {len(raw_hotels)} hotels from content API")

    if not raw_hotels:
        raise HTTPException(404, f"No hotels found for '{req.destination}'. Try London, Barcelona or Tokyo.")

    # Sort by star rating descending so best hotels appear first
    def star_num(h):
        cat = h.get("categoryCode", "")
        return int("".join(filter(str.isdigit, cat))) if any(c.isdigit() for c in cat) else 0

    raw_hotels.sort(key=star_num, reverse=True)

    hotels = []
    for h in raw_hotels[:30]:
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

    if res.status_code == 403:
        logger.warning(f"[room_photos] Hotelbeds quota exceeded for hotel {hotel_code}")
        return []
    if res.status_code != 200:
        return []
    if not hotels:
        return []

    images     = hotels[0].get("images", [])
    room_imgs  = [i for i in images if i.get("imageTypeCode") == "HAB"]
    other_imgs = [i for i in images if i.get("imageTypeCode") != "HAB"]

    # Return more room photos so Gemini has more to work with for ranking
    chosen = room_imgs[:10] if room_imgs else other_imgs[:6]

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

    # Download up to 6 photos in parallel for better ranking coverage
    b64_results = await asyncio.gather(*[fetch_b64(u) for u in photo_urls[:6]])
    indexed_images = [(i, r) for i, r in enumerate(b64_results) if r]

    if not indexed_images:
        return {
            "hotelCode": hotel_code, "score": 50,
            "features": {}, "summary": "Could not load room photos",
            "photos": photo_urls[:3], "roomPhotoCount": len(photo_urls),
        }

    # Build list of features the user actually cares about for photo ranking
    wanted_features = []
    if attrs.get('double_sinks'):   wanted_features.append("double sinks / two bathroom sinks")
    if attrs.get('large_bathroom'): wanted_features.append("large spacious bathroom")
    if attrs.get('bathtub'):        wanted_features.append("bathtub or soaking tub")
    if attrs.get('sofa'):           wanted_features.append("sofa or lounge seating area")
    if attrs.get('workspace'):      wanted_features.append("desk or workspace")
    if attrs.get('great_view'):     wanted_features.append("window view or panoramic view")
    if attrs.get('large_room'):     wanted_features.append("spacious room layout")
    if attrs.get('modern_style'):   wanted_features.append("modern contemporary design")

    wanted_str = ", ".join(wanted_features) if wanted_features else "overall room quality and style"

    prompt = f"""You are analyzing {len(indexed_images)} hotel room photos numbered 0 to {len(indexed_images)-1}.

The traveler's key preferences are: {wanted_str}

Tasks:
1. Identify which photos best show the traveler's desired features (e.g. if they want double sinks, rank bathroom photos showing sinks first)
2. Score the overall match
3. Detect which features are actually visible across all photos

Return ONLY valid JSON, no markdown:
{{
  "photo_ranking": [list of photo indices 0-{len(indexed_images)-1} ordered from most relevant to least, e.g. [2,0,3,1]],
  "photo_features": {{
    "0": ["features visible in photo 0, e.g. double sinks, bathtub"],
    "1": ["features visible in photo 1"],
    ...
  }},
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
    for idx, (orig_idx, (b64, mime)) in enumerate(indexed_images):
        parts.append({"inline_data": {"mime_type": mime, "data": b64}})
    parts.append({"text": prompt})

    async with httpx.AsyncClient(timeout=60) as c:
        res = await c.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={GEMINI_KEY}",
            headers={"Content-Type": "application/json"},
            json={"contents": [{"parts": parts}]},
        )

    if res.status_code != 200:
        return {
            "hotelCode": hotel_code, "score": 55,
            "features": {}, "summary": f"Vision analysis unavailable ({res.status_code})",
            "photos": photo_urls[:4], "roomPhotoCount": len(photo_urls),
        }

    text = (res.json()
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

    # Re-order photos by Gemini's ranking so best-match photos appear first
    ranking      = analysis.get("photo_ranking", list(range(len(indexed_images))))
    ordered_urls = []
    for rank_idx in ranking:
        if rank_idx < len(indexed_images):
            orig_idx = indexed_images[rank_idx][0]
            if orig_idx < len(photo_urls):
                ordered_urls.append(photo_urls[orig_idx])
    # Append any remaining photos not in ranking
    ranked_set = set(ordered_urls)
    for url in photo_urls[:6]:
        if url not in ranked_set:
            ordered_urls.append(url)

    # Build per-photo feature labels for the UI
    photo_features = analysis.get("photo_features", {})
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
