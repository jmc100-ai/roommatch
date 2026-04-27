# API & licensing audit — TravelBoop / RoomMatch

**Purpose:** Inventory of external APIs (hotel data, images, maps, ML, hosting), how the codebase uses them, terms highlights, risk levels, and mitigations for a **public beta**.

**Last updated:** April 2026

**Disclaimer:** This is engineering research, not legal advice. Treat LiteAPI, Google Maps Platform, and OSM-derived data rows as “counsel or written vendor approval” items before a wide public beta.

---

## Scope — production code paths

| Area | Primary files |
|------|-----------------|
| Backend | `server.js` |
| Indexing | `scripts/index-city.js`, `scripts/backfill-latlng.js`, `scripts/backfill-room-ids.js` |
| Neighborhoods / vibe imagery | `scripts/neighborhood-generator.js`, `scripts/neighborhood-vibe-data.js` |
| Frontend → your API | `client/index.html` (`BACKEND` → `/api/*`) |
| Fonts (browser) | `server.js` (inline HTML head), `client/index.html` |

Design HTML under `design/` may hardcode Unsplash or Google Fonts URLs; they are not the live API surface unless those files are shipped as product.

---

## Full review table

| # | Provider / API | How we use it (concrete) | Data / assets involved | Terms / policy (official) | Public-beta risk | Changes / mitigations / alternatives |
|---|----------------|--------------------------|-------------------------|---------------------------|------------------|--------------------------------------|
| 1 | **LiteAPI (Nuitée)** `https://api.liteapi.travel/v3.0` | `liteGet`: `/data/hotels`, `/data/hotel`, `/data/hotels/room-search`; POST `https://api.liteapi.travel/v3.0/hotels/rates` (`server.js`, `scripts/index-city.js`, `scripts/backfill-latlng.js`). Header: `X-API-Key`. | Hotel lists, detail, **room photo URLs**, rates, IDs, addresses, coordinates when present. | [LiteAPI Terms of Service](https://www.liteapi.travel/terms/) (updated **12 Sep 2025**): licensed **solely** to deliver travel services (browse, show rates/availability, enable bookings). **Prohibited:** storing/copying/creating databases outside permitted scope; mapping to third-party datasets; ML training/enrichment; scraping/bulk download. | **High** for current pattern: persistent **`hotels_cache`**, **`room_embeddings`** (captions, `photo_url`, embeddings), bulk indexing. Even “derivative” ML may fall under “enrich third-party datasets / models.” | **1)** Written clarification or enterprise terms from Nuitée (`hello@nuitee.com`). **2)** “Embeddings-only + live photo fetch” (see `CLAUDE.md`). **3)** Long-term: **Hotelbeds Cache API**, **GIATA**, or other suppliers with explicit cache rights. **4)** Public beta: narrow city list and disclaimers do **not** fix contract/IP risk. |
| 2 | **Google Gemini (Generative Language API)** `generativelanguage.googleapis.com` | HyDE + captioning: `gemini-2.5-flash-lite` `generateContent`; embeddings: `gemini-embedding-001` `embedContent` (`server.js`, `scripts/index-city.js`, `scripts/neighborhood-generator.js`). | Text in/out; **image URLs** to Gemini for multimodal captioning in the indexer. | [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms); [Generative AI Additional Terms](https://policies.google.com/terms/generative-ai); [Usage policies](https://ai.google.dev/gemini-api/docs/usage-policies). Google generally does **not** claim ownership of API outputs; prohibited uses include safety bypass and certain high-risk domains. **EEA/CH/UK:** paid-tier rules are called out in Gemini terms. | **Low–medium** for using the API commercially if policies and billing are satisfied. **Medium** if inputs are **third-party hotel images** without clear upstream rights (separate from Google’s terms). | Correct **paid / region** plan for target users; console settings for **retention / training**; stay within **allowed use**. |
| 3 | **Supabase** (PostgREST + Postgres) | `@supabase/supabase-js`; RPCs such as `score_room_types`, `fetch_hotel_photos`; tables for hotels, embeddings, neighborhoods (`server.js` + scripts). | All persisted app data including **LiteAPI-derived** rows. | [Supabase Terms of Service](https://supabase.com/terms); [Shared responsibility](https://supabase.com/docs/guides/platform/shared-responsibility-model). | **Low** as vendor; **high** as **storage** if underlying LiteAPI use is not permitted—legal exposure is yours. | RLS, key hygiene, DPA if needed. **Legal fix is supplier terms + data model**, not Supabase configuration alone. |
| 4 | **Geoapify** `api.geoapify.com` | City **autocomplete** via `/api/places` in `server.js`; **geocode** in `scripts/backfill-latlng.js`. Env: `GEOAPIFY_KEY`. | Place names, bbox/country when returned; lat/lng for hotels. | [Geoapify Terms and Conditions](https://www.geoapify.com/terms-and-conditions/) | **Low–medium**: normal app use; confirm **persistence** of geocodes/addresses against your plan (free vs paid). | Paid production plan; reasonable caching; alternatives: OpenCage, HERE, Google Geocoding if contract clarity matters. |
| 5 | **Google Maps — Street View Static API** `maps.googleapis.com/maps/api/streetview` + `.../metadata` | `GET /api/street-view` in `server.js`; env `GOOGLE_STREETVIEW_KEY`. Client calls your API then loads Google image URLs. | Hotel coordinates → Google panorama images; **API key may appear in image URLs** returned to the browser. | [Street View policies & attribution](https://developers.google.com/maps/documentation/streetview/policies); [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms). Attribution required; caching rules differ for metadata vs imagery. | **Medium**: billing; ToS/attribution; **key exposure** if raw `key=` URLs are sent to the client. | Restrict key by referrer/API; show **Google Maps** attribution; review caching vs in-memory + JSON response; proxy or short-lived URLs if your Google contract supports it. |
| 6 | **Google Places API (New)** `places.googleapis.com` | `searchText`, `searchNearby`, Place Photo media (`scripts/neighborhood-generator.js`, `scripts/neighborhood-vibe-data.js`). Env: `GOOGLE_PLACES_KEY`. | POI/place data; photos; attributions for hero/cards. | [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies); [Place Photos (New)](https://developers.google.com/maps/documentation/places/web-service/place-photos). **Author attributions** for photos; Maps attribution. | **Medium**: display rules; **caching** of place/photo metadata must follow Maps Platform terms. | UI shows **`authorAttributions`** + Google attribution; refresh cached metadata per policy; API key restricted to Places only. |
| 7 | **Unsplash API** `api.unsplash.com` | Neighborhood hero search in `scripts/neighborhood-generator.js`. Env: `UNSPLASH_KEY` (server-side only). | Stock photos; **hotlinked** URLs stored in DB. | [API Guidelines](https://help.unsplash.com/api-guidelines/unsplash-api-guidelines); [API Terms](https://unsplash.com/api-terms); [Attribution](https://help.unsplash.com/api-guidelines/guideline-attribution); [Hotlinking](https://help.unsplash.com/api-guidelines/more-on-each-guideline/guideline-hotlinking-images). | **Medium**: free tier limits; mandatory **attribution** and **hotlink**; misuse can terminate access. | Client: “Photo by … on Unsplash” + UTM links; trigger **`links.download_location`** when required; never expose API key in the browser. |
| 8 | **Pexels API** `api.pexels.com` | Optional in `scripts/neighborhood-vibe-data.js`; env `PEXELS_KEY` (wired from admin routes in `server.js`). | Stock photos for vibe imagery. | [Pexels API documentation](https://www.pexels.com/api/documentation/) | **Low–medium**: generally app-friendly; verify attribution and redistribution for stored URLs. | One stock provider + consistent credit line in UI. |
| 9 | **Flickr API** `api.flickr.com/services/rest` | Optional geo `flickr.photos.search` in `scripts/neighborhood-vibe-data.js`. Env: `FLICKR_KEY`. | Geo-tagged photos; **license varies per photo**. | [Flickr API](https://www.flickr.com/services/api/) + [Community guidelines](https://www.flickr.com/help/guidelines) | **Medium**: per-image license and attribution; rate limits. | Store license + author in DB; link to photographer; filter by license if needed. |
| 10 | **Wikimedia Commons API** `commons.wikimedia.org/w/api.php` | Optional search in `scripts/neighborhood-vibe-data.js`. | Free media; **per-file license** (e.g. CC BY-SA). | [Commons: Reusing content outside Wikimedia](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia) | **Medium**: attribution; some licenses (e.g. **ShareAlike**) affect derivatives. | Store license + author; automate attribution in UI. |
| 11 | **OpenStreetMap Nominatim** `nominatim.openstreetmap.org` | Polygon lookup in `scripts/neighborhood-generator.js` (custom User-Agent). | OSM-derived polygons; **ODbL** if you republish substantial derived geodata. | [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/) (e.g. **1 req/s**, identify app); [ODbL](https://wiki.openstreetmap.org/wiki/Open_Database_License) | **Medium**: rate and bulk rules; license for redistributed derivatives. | Self-host Nominatim or commercial OSM provider; throttle batch jobs; attribute **© OpenStreetMap contributors**. |
| 12 | **Hugging Face Inference Router** `router.huggingface.co` | Optional `/api/clip-search` in `server.js`: hotel `imageUrl` + user query to `meta-llama/Llama-3.2-11B-Vision-Instruct`. Env: `HUGGINGFACE_KEY`. | **LiteAPI image URLs** + query sent to third-party inference. | [Hugging Face Terms](https://huggingface.co/terms-of-service); **Llama** model license on the model card. | **Medium**: HF ToS + model license for commercial use; **supplier chain** (hotel images to another processor). | Disable for beta unless essential; self-hosted VLM; align with LiteAPI permission first. |
| 13 | **Render** | Hosts `server.js`; optional keepalive via `RENDER_EXTERNAL_URL`. | Hosting only. | [Render Terms](https://render.com/legal/terms) | **Low** standard hosting. | Secrets in dashboard; plan for uptime/SLA. |
| 14 | **Google Fonts** (browser) | `fonts.googleapis.com` / `fonts.gstatic.com` in `client/index.html` and `server.js`. | Font requests to Google. | [Google Fonts FAQ](https://developers.google.com/fonts/faq) | **Low** operational; **privacy** if strict GDPR (some teams self-host fonts). | Self-host font files to avoid third-party font requests. |
| 15 | **Your own API** (`/api/vsearch`, `/api/rates`, …) | `client/index.html` → `BACKEND` | N/A | Your **Privacy Policy** / **Terms** for end users. | **Operational**: you are data controller for logs/analytics. | Publish beta Terms, Privacy, and third-party disclosure (this document as source). |

---

## Cross-cutting public-beta notes

1. **Contract bottleneck:** LiteAPI’s **September 2025** terms are the dominant **database / ML / redistribution** risk; other providers are mostly **attribution, quotas, and key hygiene**.

2. **Attribution stack:** Where the UI combines **LiteAPI**, **Google Maps / Places / Street View**, **Unsplash**, **Flickr / Wikimedia**, use a **visible, mobile-safe** credits pattern so nothing is obscured.

3. **Keys in the browser:** If Street View image URLs include `key=`, lock the key in Google Cloud (referrer / API restrictions) and treat rotation as normal ops.

4. **Optional vs core:** **Core beta path:** LiteAPI + Gemini + Supabase + Geoapify + rates. **Neighborhood imagery:** Unsplash / Places / OSM / Pexels / Flickr / Wikimedia. **Experimental:** Hugging Face clip-search.

---

## Quick reference links

| Provider | URL |
|----------|-----|
| LiteAPI Terms | https://www.liteapi.travel/terms/ |
| Gemini API Additional Terms | https://ai.google.dev/gemini-api/terms |
| Google Maps / Street View policies | https://developers.google.com/maps/documentation/streetview/policies |
| Places API policies | https://developers.google.com/maps/documentation/places/web-service/policies |
| Unsplash API guidelines | https://help.unsplash.com/api-guidelines/unsplash-api-guidelines |
| Nominatim usage policy | https://operations.osmfoundation.org/policies/nominatim/ |
| Supabase Terms | https://supabase.com/terms |
| Geoapify Terms | https://www.geoapify.com/terms-and-conditions/ |

---

## Related in-repo context

- `CLAUDE.md` — “Data Source Licensing” and embeddings-only architecture summary.
- `render.yaml` — documents several env vars (not exhaustive vs `server.js`).
