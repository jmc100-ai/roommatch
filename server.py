"""
RoomMatch — server.py
FastAPI backend: proxies Hotels.com (RapidAPI) and runs Claude Vision on room photos.
Deploy to Render as a Web Service. Set env vars in the Render dashboard.

Required environment variables:
  RAPIDAPI_KEY   — from rapidapi.com (hotels-com-provider by tipsters)
  ANTHROPIC_KEY  — from console.anthropic.com
"""

import os, base64, asyncio, re, json
from typing import Optional
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from contextlib import asynccontextmanager

RAPIDAPI_KEY  = os.getenv("RAPIDAPI_KEY", "")
ANTHROPIC_KEY = os.getenv("ANTHROPIC_KEY", "")
PORT          = int(os.getenv("PORT", 8000))

# ── Keepalive: ping self every 10 min so Render free tier doesn't sleep ────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(self_ping())
    yield
    task.cancel()

async def self_ping():
    await asyncio.sleep(60)           # wait for server to fully start
    render_url = os.getenv("RENDER_EXTERNAL_URL", "")
    if not render_url:
        return                        # skip if not on Render
    async with httpx.AsyncClient() as client:
        while True:
            try:
                await client.get(f"{render_url}/", timeout=10)
            except Exception:
                pass
            await asyncio.sleep(600)  # ping every 10 minutes

app = FastAPI(title="RoomMatch API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

HOTELS_HOST    = "hotels-com-provider.p.rapidapi.com"
HOTELS_HEADERS = {
    "X-RapidAPI-Key":  RAPIDAPI_KEY,
    "X-RapidAPI-Host": HOTELS_HOST,
}

# ── Models ─────────────────────────────────────────────────────────────────────
class SearchRequest(BaseModel):
    destination: str
    checkin:     str    # YYYY-MM-DD
    checkout:    str    # YYYY-MM-DD
    adults:      int = 2
    min_rating:  float = 0.0

class AnalyzeRequest(BaseModel):
    hotel_id:    str
    style_attrs: dict

# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"status": "ok", "service": "RoomMatch API"}

# ── Destination lookup ─────────────────────────────────────────────────────────
@app.get("/destinations")
async def get_destinations(q: str):
    url    = f"https://{HOTELS_HOST}/locations/v3/search"
    params = {"q": q, "locale": "en_US", "langid": "1033", "siteid": "300000001"}
    async with httpx.AsyncClient(timeout=12) as c:
        res = await c.get(url, headers=HOTELS_HEADERS, params=params)
    if res.status_code != 200:
        raise HTTPException(502, f"Location lookup failed ({res.status_code})")
    for item in res.json().get("sr", []):
        if item.get("type") in ("CITY", "REGION", "NEIGHBORHOOD", "AIRPORT"):
            return {
                "regionId":    item.get("gaiaId") or item.get("regionId"),
                "displayName": item.get("regionNames", {}).get("fullName", q),
            }
    raise HTTPException(404, f"No destination found for '{q}'")

# ── Hotel search ───────────────────────────────────────────────────────────────
@app.post("/search")
async def search_hotels(req: SearchRequest):
    dest      = await get_destinations(req.destination)
    region_id = dest["regionId"]

    def parse_date(d):
        y, m, day = d.split("-")
        return {"day": int(day), "month": int(m), "year": int(y)}

    payload = {
        "currency": "USD", "eapid": 1, "locale": "en_US", "siteId": 300000001,
        "destination":   {"regionId": str(region_id)},
        "checkInDate":   parse_date(req.checkin),
        "checkOutDate":  parse_date(req.checkout),
        "rooms":         [{"adults": req.adults}],
        "resultsStartingIndex": 0,
        "resultsSize":   15,
        "sort":          "REVIEW",
        "filters":       {"price": {"max": 99999, "min": 1}},
    }

    async with httpx.AsyncClient(timeout=20) as c:
        res = await c.post(
            f"https://{HOTELS_HOST}/properties/v2/list",
            headers={**HOTELS_HEADERS, "Content-Type": "application/json"},
            json=payload,
        )
    if res.status_code != 200:
        raise HTTPException(502, f"Hotel search failed ({res.status_code}): {res.text[:200]}")

    properties = (res.json()
                  .get("data", {})
                  .get("propertySearch", {})
                  .get("properties", []))

    hotels = []
    for p in properties:
        rating = p.get("reviews", {}).get("score", 0) or 0
        if req.min_rating > 0 and rating < req.min_rating:
            continue
        price_info = p.get("price", {}).get("lead", {})
        hotels.append({
            "id":           p.get("id"),
            "name":         p.get("name", "Hotel"),
            "rating":       rating,
            "reviewCount":  p.get("reviews", {}).get("total", 0),
            "starRating":   p.get("star", 0),
            "price":        price_info.get("formatted", ""),
            "priceRaw":     price_info.get("amount", 0),
            "thumbnail":    p.get("propertyImage", {}).get("image", {}).get("url", ""),
            "neighborhood": p.get("neighborhood", {}).get("name", ""),
        })

    return {"hotels": hotels[:12], "destination": dest["displayName"]}

# ── Hotel room photos ──────────────────────────────────────────────────────────
async def fetch_room_photos(hotel_id: str, checkin: str, checkout: str):
    def parse_date(d):
        y, m, day = d.split("-")
        return {"day": int(day), "month": int(m), "year": int(y)}

    payload = {
        "currency": "USD", "eapid": 1, "locale": "en_US", "siteId": 300000001,
        "propertyId":  hotel_id,
        "checkInDate": parse_date(checkin),
        "checkOutDate":parse_date(checkout),
        "rooms":       [{"adults": 2}],
    }
    async with httpx.AsyncClient(timeout=20) as c:
        res = await c.post(
            f"https://{HOTELS_HOST}/properties/v2/detail",
            headers={**HOTELS_HEADERS, "Content-Type": "application/json"},
            json=payload,
        )
    if res.status_code != 200:
        return {"photos": [], "amenities": [], "rooms": [], "address": ""}

    data      = res.json()
    prop_info = data.get("data", {}).get("propertyInfo", {})
    all_imgs  = prop_info.get("propertyGallery", {}).get("images", [])

    room_imgs, other_imgs = [], []
    for img in all_imgs:
        url  = img.get("image", {}).get("url", "")
        cat  = (img.get("imageCategory", "") or "").lower()
        desc = (img.get("image", {}).get("description", "") or "").lower()
        if not url:
            continue
        if any(k in cat + desc for k in ["room", "bathroom", "suite", "bath", "bedroom"]):
            room_imgs.append({"url": url, "desc": desc})
        else:
            other_imgs.append({"url": url, "desc": desc})

    selected = room_imgs[:6] or other_imgs[:4]

    amenities = [
        item.get("text", "")
        for item in (prop_info.get("summary", {})
                               .get("amenities", {})
                               .get("topAmenities", {})
                               .get("items", []))
        if item.get("text")
    ]

    rooms = []
    for unit in (data.get("data", {}).get("propertyOffers", {}).get("units", [])[:3]):
        name  = unit.get("header", {}).get("text", "")
        plans = unit.get("ratePlans", [])
        price = ""
        if plans:
            details = plans[0].get("priceDetails", [])
            if details:
                price = details[0].get("price", {}).get("lead", {}).get("formatted", "")
        if name:
            rooms.append({"name": name, "price": price})

    address = (prop_info.get("summary", {})
                         .get("location", {})
                         .get("address", {})
                         .get("addressLine", ""))

    return {"photos": selected, "amenities": amenities, "rooms": rooms, "address": address}

# ── Fetch image as base64 ──────────────────────────────────────────────────────
async def fetch_b64(url: str) -> Optional[tuple]:
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=True) as c:
            res = await c.get(url, headers={"User-Agent": "Mozilla/5.0"})
        if res.status_code != 200:
            return None
        mime = res.headers.get("content-type", "image/jpeg").split(";")[0]
        return base64.b64encode(res.content).decode(), mime
    except Exception:
        return None

# ── Analyze hotel rooms with Claude Vision ─────────────────────────────────────
@app.post("/analyze/{hotel_id}")
async def analyze_hotel(hotel_id: str, req: AnalyzeRequest):
    attrs    = req.style_attrs
    checkin  = attrs.get("checkin",  "2025-06-01")
    checkout = attrs.get("checkout", "2025-06-02")

    photo_data = await fetch_room_photos(hotel_id, checkin, checkout)
    photos     = photo_data.get("photos", [])

    if not photos:
        return {
            "hotelId": hotel_id, "score": 50,
            "features": {}, "summary": "No room photos available",
            "photos": [], "amenities": photo_data.get("amenities", []),
            "rooms": photo_data.get("rooms", []),
        }

    # Download up to 4 photos in parallel
    b64_results = await asyncio.gather(*[fetch_b64(p["url"]) for p in photos[:4]])
    images      = [r for r in b64_results if r]

    if not images:
        return {
            "hotelId": hotel_id, "score": 50,
            "features": {}, "summary": "Could not load room photos",
            "photos": [p["url"] for p in photos[:3]],
            "amenities": photo_data.get("amenities", []),
            "rooms": photo_data.get("rooms", []),
        }

    prompt = f"""Analyze these hotel room photos and score how well they match this traveler's preferences.

Traveler wants:
- Style: {attrs.get('overall_style','unknown')}
- Luxury level: {attrs.get('luxury_score',5)}/10
- Room size: {attrs.get('room_size','standard')}
- Large bathroom: {attrs.get('large_bathroom',False)}
- Double sinks: {attrs.get('double_sinks',False)}
- Bathtub: {attrs.get('bathtub',False)}
- Sofa/lounge: {attrs.get('sofa',False)}
- Workspace: {attrs.get('workspace',False)}
- Great view: {attrs.get('great_view',False)}
- Spacious room: {attrs.get('large_room',False)}
- Modern style: {attrs.get('modern_style',False)}

Return ONLY valid JSON, no markdown or explanation:
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
  "standout_features": ["2-3 specific things visible in the photos"],
  "match_summary": "one sentence why this room does or doesn't match"
}}"""

    content = []
    for b64, mime in images:
        content.append({"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}})
    content.append({"type": "text", "text": prompt})

    async with httpx.AsyncClient(timeout=45) as c:
        res = await c.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key":         ANTHROPIC_KEY,
                "anthropic-version": "2023-06-01",
                "Content-Type":      "application/json",
            },
            json={"model": "claude-sonnet-4-20250514", "max_tokens": 600,
                  "messages": [{"role": "user", "content": content}]},
        )

    if res.status_code != 200:
        raise HTTPException(502, f"Claude error: {res.text[:200]}")

    text  = "".join(b.get("text", "") for b in res.json().get("content", []))
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return {"hotelId": hotel_id, "score": 50, "features": {},
                "summary": "Analysis parse error", "photos": [p["url"] for p in photos[:3]]}

    analysis = json.loads(match.group())
    feat_keys = ["large_bathroom","double_sinks","bathtub","sofa",
                 "workspace","great_view","large_room","modern_style"]

    return {
        "hotelId":          hotel_id,
        "score":            analysis.get("match_score", 50),
        "features":         {k: analysis[k] for k in feat_keys if k in analysis},
        "roomStyle":        analysis.get("room_style", ""),
        "standoutFeatures": analysis.get("standout_features", []),
        "summary":          analysis.get("match_summary", ""),
        "photos":           [p["url"] for p in photos[:4]],
        "amenities":        photo_data.get("amenities", []),
        "rooms":            photo_data.get("rooms", []),
        "address":          photo_data.get("address", ""),
    }

# ── Entry point (for local dev) ────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=PORT, reload=True)
