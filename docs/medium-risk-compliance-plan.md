# Plan: address “medium” API / policy risks (excluding LiteAPI)

**Scope:** Items rated **Medium** in `docs/api-licensing-audit.md`, **not** including LiteAPI (which was **High**) and **not** expanding scope to LiteAPI-derived mitigations.

**Covered providers:** Google Street View Static API, Google Places API (New), Unsplash API, Flickr API, Wikimedia Commons API, OpenStreetMap Nominatim (plus public **Overpass** usage already paired with Nominatim in code), Hugging Face Inference (clip path).

**Out of scope for this plan:** LiteAPI contract/architecture, **Low**/**Low–medium** rows (Gemini commercial nuances, Geoapify plan tier, Pexels, Render, Google Fonts privacy-only).

---

## Goals

1. **Attribution & branding:** Meet Google Maps Platform display rules for Street View and Places content; meet Unsplash/Flickr/Wikimedia attribution; show **© OpenStreetMap contributors** where OSM-derived geography is surfaced.
2. **Key hygiene:** Reduce risk from **Google API keys** appearing in URLs delivered to the browser (Street View image URLs).
3. **Correctness:** Stop **misleading credits** (e.g. Google or hotel photos labeled as “Unsplash”).
4. **Operational compliance:** Unsplash **download** reporting where required; HF clip path **safe default** for public beta.
5. **Traceability:** Persist **source + license** metadata where the UI shows third-party photos (Flickr/Wikimedia especially).

---

## Phase 1 — Google Maps (Street View + Places)

### 1A. Street View Static API

**Build**

- **`client/index.html` (vibe tour):** For every scene with `sourceTag === 'street-view'` (or any full-screen Street View image), add a **persistent, visible** attribution strip per [Street View policies](https://developers.google.com/maps/documentation/streetview/policies): e.g. **Google Maps** wordmark or approved logo + link, not removable by scroll, readable on dark photos (contrast / backdrop).
- **`server.js` `/api/street-view`:** Prefer **not** returning raw Static API URLs that embed `key=` for client-side `<img src>`.
  - **Option A (recommended):** Add `GET /api/street-view/image?...` (or signed path params) that **proxies** the image: server fetches Google with the secret key, streams bytes to the client, sets short cache headers aligned with [Maps Platform caching rules](https://developers.google.com/maps/documentation/tile/policies). Client only sees same-origin URLs.
  - **Option B (lighter):** Keep returning Google URLs but **lock down** the key in Google Cloud Console (HTTP referrer restrictions, API restrictions to Street View Static + Metadata only) and accept residual key-exposure risk; still add visible attribution.
- Document in `CLAUDE.md` or env comments: billing surfaces (metadata + image requests per tour).

**UX**

- **Footer chrome:** Google requires visible attribution; on small tour cards it can feel busy. Mitigate: single compact bar (“Imagery © Google”) fixed to the bottom of the tour modal, high contrast, tap-through disabled only on the link area.
- **Latency:** Proxy adds **one hop** per image; mitigate with **in-memory** or short CDN cache on the server for repeated `hotelId` (you already cache URL list; extend to bytes if proxying).
- **Missing coverage:** Unchanged user message when `urls.length === 0`; no false attribution.

### 1B. Google Places API (New) — hero + `vibe_photos`

**Build**

- **Persist `photo_source` (or extend `photo_credit`):** When writing neighborhood rows in `scripts/neighborhood-generator.js`, store `source: google_places | unsplash | flickr | wikimedia | pexels` (and for Places, optional `google_maps_uri` / raw `authorAttributions[]` from API) so the client never guesses.
- **`client/index.html`:** Replace hard-coded **“on Unsplash”** in `renderNeighborhoodCard` (legacy flow, ~9971) with **branching copy**: Unsplash (“Photo by … on Unsplash” + UTM); Google (“© Google Maps” + contributor link from `authorAttributions`); Flickr/Wikimedia (see Phase 3).
- **New neighborhood UI (`renderNbhdCard`):** Today credit is generic “Photo: &lt;link&gt;”. Extend to **source-aware** line: Unsplash vs **Google Maps** (logo/text) vs others, matching stored metadata.
- **Vibe element carousels / lightbox:** Where `vibe_photos` entries include Google Place photo URLs, show **per-slide** attribution (contributor + Google) when the slide is visible, not only on hero.

**UX**

- **Long contributor names** on narrow cards: truncate with ellipsis, full name in `title` tooltip or lightbox.
- **Multiple Google attributions** in one carousel: one consolidated “Google Maps · Data © contributors” row plus per-photo contributor where required by policy.

---

## Phase 2 — Unsplash API

**Build**

- **Server:** After choosing a photo from search results in `scripts/neighborhood-generator.js` (`fetchNeighborhoodPhoto`), **POST** to Unsplash `download_location` when the API returns it ([guidelines](https://help.unsplash.com/api-guidelines/unsplash-api-guidelines)). Do this **once per stored hero** at generation time (and optionally once on first API response if you defer persistence).
- **Links:** Ensure outbound photographer / Unsplash links use **`utm_source=travelboop`** (or your canonical app slug) per Unsplash attribution guidelines.
- **Client:** Only use **`urls.*`** from API responses for Unsplash heroes (already hotlinking); do not re-upload to your CDN without checking API terms.

**UX**

- **Extra line of credit** under neighborhood cards: slightly taller card footer; keep typography small but **legible** (accessibility: contrast ratio).
- **Regeneration:** If heroes are re-fetched, avoid double-counting downloads (idempotent: only ping `download_location` when hero URL changes).

---

## Phase 3 — Flickr + Wikimedia (optional keys)

**Build**

- **`scripts/neighborhood-vibe-data.js`:** When returning Flickr/Wikimedia hits, attach **`license_id` / `license_name` / `author` / `source_page_url`** on each photo object stored in `vibe_photos` JSON (schema backward-compatible: new fields optional).
- **`client/index.html`:** For any slide where `source === 'flickr' | 'wikimedia'`, render **license badge** (short code, e.g. “CC BY-SA”) + “Photo: …” link; tap opens attribution page. For **ShareAlike** assets, add internal legal note (product docs / privacy appendix), not necessarily in UI.
- **Filtering (optional):** Admin or build-time flag to prefer **CC-BY** / **CC0** only for beta to reduce compliance surface.

**UX**

- **License chips** can intimidate casual users: place them in **secondary** style (outline pill) next to photographer link; hero stays visual-first.
- **Broken license metadata** on old rows: fallback string “Photo credit — see source” + link to neighborhood detail or regenerate job.

---

## Phase 4 — OpenStreetMap Nominatim + Overpass

**Build**

- **Nominatim:** Code already spaces calls (~**1100 ms**) between `fetchOsmBoundary` invocations in `generateNeighborhoods` and polygon backfill; **audit** any other entry points that call `fetchOsmBoundary` without a gap.
- **UI:** Where you show a **map**, **bbox chip**, or “drawn” neighborhood boundary derived from OSM, add **“© OpenStreetMap contributors”** (link to `https://www.openstreetmap.org/copyright`) in the same area as other map credits.
- **Docs / legal appendix:** Short paragraph on **ODbL** for stored `polygon` derived from OSM (derivative database if republished at scale); counsel to validate.

**UX**

- **Copyright line** on dense mobile headers: use a **single** combined “Map data © OSM · Imagery © …” row when both OSM and Google appear in one flow.

---

## Phase 5 — Hugging Face Inference (`/api/clip-search`)

**Build**

- **Default off for public beta:** `CLIP_SEARCH_ENABLED=false` (or absence of `HUGGINGFACE_KEY` already disables scoring path partially—align UI so **no** `EventSource` to `/api/clip-search` when disabled).
- **Admin-only or staging:** If you keep the endpoint, gate with `SITE_PASSWORD`, separate env, or non-production host only.
- **Docs:** Note model license (**Llama** vision) and HF Terms for any future re-enable.

**UX**

- **Feature removal:** If the UI exposes “CLIP” or streaming search mode, hide it cleanly so users do not hit a **500** or empty stream; one-line “Visual match mode is temporarily unavailable” if you want a placeholder.

---

## Implementation order (recommended)

| Order | Phase | Rationale |
|-------|--------|-----------|
| 1 | **1B** Places + wrong Unsplash label | Fast UI fix; high correctness impact; low infra cost |
| 2 | **1A** Street View attribution + key/proxy | Security + Google policy in one user-visible flow |
| 3 | **2** Unsplash download + UTM | Server-only + small client link tweaks |
| 4 | **3** Flickr/Wikimedia metadata + UI | Only if those keys are enabled in prod |
| 5 | **4** OSM credit + path audit | Mostly copy + audit; Nominatim throttling largely done |
| 6 | **5** HF clip default off | Single flag + UI guard |

---

## Testing checklist (non-legal)

- [ ] Legacy neighborhood card: Google hero → shows **Google**, not “Unsplash”.
- [ ] New neighborhood card: credits match `photo_credit.source`.
- [ ] Vibe tour: first **Street View** slide shows **Google** attribution for entire modal session.
- [ ] Street View: Network tab shows **no** exposed `key=` **if** proxy shipped; or key restricted in GCP if Option B.
- [ ] Unsplash: Server logs or Unsplash dashboard show **download** events after regen (spot-check).
- [ ] OSM: Any screen with polygon/bbox context shows **© OpenStreetMap contributors**.
- [ ] Clip search: With flag off, no client request to `/api/clip-search`.

---

## UX summary (risks + mitigations)

| Issue | Mitigation |
|--------|------------|
| Attribution clutter on mobile | One consolidated bottom bar; truncate names; tooltips for full text |
| Wrong source confuses users and violates ToS | Source field from server; never hard-code “Unsplash” |
| Proxy latency for Street View | Server-side cache by `hotelId` + heading bucket; reuse across users |
| License chips feel “legalistic” | Secondary styling; keep hero imagery dominant |
| Disabling clip search | Hide entry points; avoid dead buttons |

---

## What this plan does **not** solve

- **LiteAPI** storage, embeddings from their photos, or ML enrichment of their inventory (explicitly excluded).
- **Legal sign-off:** Google, Unsplash, Flickr, Wikimedia, and ODbL still warrant counsel for a **public** beta scale.

---

## Related files (implementation touchpoints)

- `client/index.html` — `renderNeighborhoodCard`, `renderNbhdCard`, vibe tour Street View scenes, optional clip UI
- `server.js` — `/api/street-view`, env flags for clip proxy
- `scripts/neighborhood-generator.js` — `photo_credit`, Unsplash download ping, `fetchNeighborhoodPhoto` return shape
- `scripts/neighborhood-vibe-data.js` — Flickr/Wikimedia payload enrichment
