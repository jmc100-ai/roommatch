# TravelByVibe — Beta marketing plan (Paris + Mexico City)

**Brand:** TravelByVibe (product) · **Domain:** [travelbyvibe.com](https://www.travelbyvibe.com) (canonical)  
**Legacy:** [travelboop.com](https://www.travelboop.com) may still resolve during DNS transition — see `docs/DOMAIN.md`.  
**Last updated:** May 2026  
**Status:** Paris landing pages added; Mexico City pages already live.  
**Domains:** Canonical **travelbyvibe.com** — `docs/DOMAIN.md`. Beta ops: `BETA_LAUNCH.md`.

---

## 1. Executive summary

TravelByVibe is a **photo-first hotel discovery** product for beta. We win when travellers are overwhelmed by star ratings and identical lobby shots and want to answer: *“Does this room actually look like my trip?”*

**Core promise:** Describe the vibe (room + neighbourhood). Our AI reads **real hotel room and bathroom photos** and **neighbourhood character**, then ranks hotels you can browse before booking.

**Launch cities:** Mexico City (deepest index, primary) and Paris (V2 indexed, beta destination).

**Marketing job:** Indexable landing pages → organic search + paid traffic → Boop wizard in app → beta sign-up / repeat use → partner booking handoff.

---

## 2. Unique selling proposition (USP)

### What we are


| Pillar                 | Message                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| **Visual room match**  | Search by describing the room—rain shower, Haussmann light, moody boutique—not just “4-star near Eiffel.” |
| **Neighbourhood vibe** | Match area pace (icons, calm, hip local, leafy) to where you sleep, with map + vibe cards.                |
| **AI on real photos**  | We index and score **actual property photography**, not marketing copy alone.                             |
| **Boop wizard**        | Fast trip context (first visit vs return, stay vibe, area scene, must-haves) before results.              |
| **Browse then book**   | No paywall to explore; add dates for live rates; hand off to booking partner when ready.                  |


### One-line positioning

> **TravelByVibe: See the room—and the neighbourhood—before you book.**

### Elevator (30 seconds)

> Hotel sites show one hero image and a star count. TravelByVibe lets you describe the stay you want in plain English, uses AI to compare your words to thousands of real room photos, and blends in neighbourhood fit so you do not book a perfect bathroom in the wrong arrondissement. Built for design-conscious travellers planning Mexico City or Paris in beta.

---

## 3. Competitive landscape & differentiation


| Competitor                             | What they optimize for             | Our wedge                                                               |
| -------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| **Booking.com / Expedia / Hotels.com** | Price, inventory, reviews, filters | **Photo-level room truth** + vibe language, not amenity checkboxes      |
| **Google Hotels / Maps**               | Price aggregation, location pin    | **Inside-the-room** and **neighbourhood personality**, not just map dot |
| **KAYAK / Skyscanner**                 | Fare comparison                    | We are **pre-booking discovery**, not OTA price shopping                |
| **TripAdvisor**                        | Reviews & rankings                 | **Visual proof** from indexed photos; less reading, more seeing         |
| **Airbnb**                             | Whole-home, host narrative         | **Hotels** with room-type granularity and partner rates                 |
| **Pinterest / Instagram**              | Inspiration only                   | **Actionable ranked hotels** tied to your sentence                      |
| **ChatGPT / generic AI**               | Open-ended advice                  | **Structured index** of Paris/Mexico City room photos + live product    |


**Moat (beta):** Proprietary visual index + neighbourhood vibe model + Boop intent → hard to replicate without our indexing pipeline and photo-level facts.

**Honest limits (use in FAQ / trust):** We help you *choose*; booking is via partners. Beta cities only. Illustrative stock on marketing pages ≠ specific partner hotels.

---

## 4. Target audiences

1. **Design-forward leisure travellers** — care about bathroom, light, bed, aesthetic (Paris, CDMX).
2. **Repeat city visitors** — know they want Marais vs Opéra or Roma vs Polanco, need room proof.
3. **Couples / small groups** — must-haves: double vanity, suite space, quiet street.
4. **Remote-work bleisure** — neighbourhood pace + desk/workspace implied in search.
5. **Beta early adopters** — frustrated with filter fatigue; willing to try invite-only product.

---

## 5. Marketing site map — all indexable URLs

Replace `https://www.travelbyvibe.com` with your production origin. Local dev: `http://localhost:3000`.

### Hub


| Page                 | URL             | Purpose                              |
| -------------------- | --------------- | ------------------------------------ |
| **Destinations hub** | `/destinations` | SEO hub + links to all city clusters |


### Mexico City cluster


| Page                      | URL                          | Primary keywords                                            |
| ------------------------- | ---------------------------- | ----------------------------------------------------------- |
| Mexico City hotels        | `/mexico-city-hotels`        | mexico city hotels, cdmx hotels, hotel rooms mexico city    |
| CDMX neighbourhood stays  | `/cdmx-neighborhood-stays`   | where to stay mexico city, cdmx neighborhoods hotels        |
| Mexico City visual search | `/mexico-city-visual-search` | search hotel rooms mexico city, hotel with rain shower cdmx |


**App deep link:** `/?city=Mexico%20City`

### Paris cluster (new)


| Page                      | URL                         | Primary keywords                                                                |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| Paris hotels              | `/paris-hotels`             | paris hotels, hotels in paris, paris hotel rooms                                |
| Paris neighbourhood stays | `/paris-neighborhood-stays` | where to stay in paris, best area to stay paris, paris arrondissement hotels    |
| Paris visual search       | `/paris-visual-search`      | paris hotel with rain shower, boutique hotel paris search, haussmann hotel room |


**App deep link:** `/?city=Paris`

### App & legal (existing)


| Page                      | URL            | Indexable                            |
| ------------------------- | -------------- | ------------------------------------ |
| App (beta gate may apply) | `/`            | noindex                              |
| Privacy                   | `/privacy`     | yes                                  |
| Terms                     | `/terms`       | yes                                  |
| Sitemap                   | `/sitemap.xml` | yes (auto-includes marketing routes) |


### Full link list (copy-paste)

```
https://www.travelbyvibe.com/destinations
https://www.travelbyvibe.com/mexico-city-hotels
https://www.travelbyvibe.com/cdmx-neighborhood-stays
https://www.travelbyvibe.com/mexico-city-visual-search
https://www.travelbyvibe.com/paris-hotels
https://www.travelbyvibe.com/paris-neighborhood-stays
https://www.travelbyvibe.com/paris-visual-search
https://www.travelbyvibe.com/privacy
https://www.travelbyvibe.com/terms
https://www.travelbyvibe.com/sitemap.xml
```

**CTA pattern:** Every marketing page ends with “Start in [City]” → `/?city=Paris` or `/?city=Mexico%20City`.

---

## 6. SEO strategy

### Technical (already in codebase)

- Marketing routes in `server.js` → **indexable** (no global `noindex`).
- Canonical URLs, Open Graph, Twitter cards, JSON-LD `WebPage` on city pages.
- `/sitemap.xml` generated from `MARKETING_HTML` routes.
- Fast static HTML + `marketing.css`; Unsplash + Wikimedia images with attribution.

### Content cluster (topic authority)

```
/destinations
├── Mexico City
│   ├── /mexico-city-hotels          (head term)
│   ├── /cdmx-neighborhood-stays     (neighbourhood intent)
│   └── /mexico-city-visual-search   (long-tail feature)
└── Paris
    ├── /paris-hotels
    ├── /paris-neighborhood-stays
    └── /paris-visual-search
```

**Internal linking:** Every page cross-links siblings + hub + app CTA. Footers link both cities.

### Keyword themes to own (6–12 months)

**Paris:** paris hotels, where to stay paris, le marais hotel, saint germain hotel, paris hotel rain shower, boutique hotel paris, haussmann hotel room, paris hotel with view eiffel (careful with view claims).

**Mexico City:** mexico city hotels, where to stay cdmx, roma condesa hotels, polanco hotels, cdmx hotel rain shower, boutique hotel mexico city.

**Branded:** travelbyvibe, travel boop, hotel vibe search, visual hotel search.

### On-page checklist (per new city)

- Unique H1 + meta title ≤ 60 chars
- Meta description 150–160 chars with CTA verb
- 1,200+ words substantive copy (hero + sections + FAQ)
- 6+ images with alt text
- 3 internal links minimum
- Schema.org WebPage
- Submit URL in Google Search Console after deploy

### Off-page SEO

- Press / beta listicles: “AI hotel search that reads room photos”
- Travel subreddits (r/paris, r/MexicoCity, r/travel) — helpful comments, not spam; link to neighbourhood guide
- HARO / journalist queries on “how to pick a hotel in Paris”
- Guest posts on design/travel blogs with canonical to our guides
- Wikipedia / Wikimedia photo credits build trust (already used on pages)

### Domain note

If **travelbyvibe.com** is the marketing domain:

1. **Canonical:** `www.travelbyvibe.com`. Optional 301 from `www.travelboop.com` → TravelByVibe (see `docs/DOMAIN.md`).
2. Single canonical host (www vs apex) in Search Console.
3. Update `marketingOrigin()` / `BETA_BASE_URL` env to match public URL.

---

## 7. Paid advertising

### Google Ads (high intent)


| Campaign       | Keywords                                        | Landing page                |
| -------------- | ----------------------------------------------- | --------------------------- |
| Paris hotels   | paris hotels, hotels paris france               | `/paris-hotels`             |
| Paris areas    | where to stay in paris, best neighborhood paris | `/paris-neighborhood-stays` |
| Paris features | paris hotel rain shower, paris suite bathtub    | `/paris-visual-search`      |
| CDMX mirror    | mexico city hotels, where to stay cdmx          | respective CDMX URLs        |


**Extensions:** Sitelinks to Visual search, Neighbourhood guide, Destinations.  
**Negatives:** cheap hostel (if positioning upscale), flight-only, jobs.  
**Beta:** Cap spend $30–50/day; measure CTR → app load with `?city=` and beta gate completion.

### Meta (Facebook / Instagram)

- **Creative:** Carousel of room moods (bath, bright bed, moody) — “Describe your Paris room. We show real matches.”
- **Audience:** Interest: Paris travel, boutique hotels, design hotels; age 28–55; US/UK/FR/MX.
- **Landing:** `/paris-hotels` or `/paris-visual-search` for feature angle.

### Pinterest

- Strong fit for “Paris hotel aesthetic”, “Haussmann interior”, “luxury bathroom hotel”.
- Pin to `/paris-visual-search` and `/paris-neighborhood-stays`.

### Reddit / niche communities (organic + small boost)

- Promoted posts in travel planning subs only if copy is genuinely useful (neighbourhood guide).

---

## 8. Distribution & launch channels (non-paid)


| Channel                   | Tactic                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| **Beta invite email**     | Deep link per city in invite template (`BETA_BASE_URL` + path)       |
| **Product Hunt**          | “Visual hotel search by vibe” — link `/destinations`                 |
| **Newsletter**            | Substack / Beehiiv: “How we rank Paris hotels by bathroom photos”    |
| **Twitter / X**           | Before/after: filter list vs one sentence in TravelByVibe            |
| **LinkedIn**              | B2B angle: AI + travel tech beta for PMs and travel creators         |
| **Travel creators**       | Offer free beta access for 60s demo video using Boop + visual search |
| **Partners**              | LiteAPI / booking partner co-marketing once allowed                  |
| **Google Search Console** | Submit sitemap; inspect each marketing URL                           |
| **Bing Webmaster**        | Same sitemap                                                         |


---

## 9. Messaging matrix (ads & social)


| Audience pain  | Headline                                              | Body                                | CTA                    |
| -------------- | ----------------------------------------------------- | ----------------------------------- | ---------------------- |
| Wrong room     | “Your Paris hotel room shouldn’t be a surprise.”      | Real photos. AI match.              | Try Paris free         |
| Wrong area     | “Stay in the Paris that fits your trip.”              | Neighbourhood vibe + hotels.        | Explore neighbourhoods |
| Filter fatigue | “Skip fifty filters. Describe the room.”              | Rain shower. Haussmann light. Mood. | Visual search          |
| CDMX depth     | “Mexico City has 3,000+ hotels. See the rooms first.” | Launch city, deepest index.         | Start in CDMX          |


---

## 10. Measurement (beta)

**Ops runbook:** `BETA_LAUNCH.md` (env, migrations, phased 50 → 500 users, Sentry/Linear/PostHog setup).

**PostHog funnel (pin in dashboard):**  
`beta_gate_passed` → `city_selected` → `boop_completed` → `vsearch_executed` → `find_book_clicked`


| Metric                 | Tool                        | Target                                     |
| ---------------------- | --------------------------- | ------------------------------------------ |
| Landing sessions       | PostHog                     | Baseline week 1                            |
| CTR to app (`/?city=`) | UTM on all CTAs             | > 8%                                       |
| Boop completion        | PostHog `boop_completed`    | > 40% of gate passers                      |
| Search success         | PostHog `vsearch_executed`  | `result_count` > 0, p95 `response_ms` < 6s |
| Booking intent         | PostHog `find_book_clicked` | ≥ 5 / active user / week (beta)            |
| Beta gate pass         | `beta_gate_passed`          | Track invite conversion                    |
| Feedback volume        | `beta_feedback` (Supabase)  | Reply same-day week 1                      |
| Organic impressions    | Search Console              | Grow MoM per city URL                      |
| Paid CPA               | Ad platforms                | TBD after 2 weeks                          |


**UTM template:**  
`?utm_source=google&utm_medium=cpc&utm_campaign=paris_hotels_2026&utm_content=hero_cta`

---

## 11. Content roadmap (post–beta launch)


| Phase        | Deliverable                                                                              |
| ------------ | ---------------------------------------------------------------------------------------- |
| **Now**      | Paris 3-page cluster + destinations hub (done in repo)                                   |
| **+2 weeks** | Blog posts: “How to pick a Paris hotel by bathroom photos”, “Roma vs Condesa vs Polanco” |
| **+1 month** | London/NYC landing stubs when indexed                                                    |
| **Ongoing**  | FAQ schema on marketing pages; video embed on `/paris-visual-search`                     |


---

## 12. Legal & brand guardrails

- Marketing images: Unsplash + Wikimedia — **not** specific partner hotels unless licensed.
- Do not claim “lowest price” unless rate API proves it.
- Attribute Unsplash/Wikimedia in footer (already on pages).
- Beta gate: marketing pages are **public**; app may require invite code.

---

## 13. Implementation checklist (engineering)

**App / beta ops**

- Run Supabase `add-beta-tables.sql` + `add-beta-feedback-context.sql`
- Set Render env per `BETA_LAUNCH.md` §1 (Sentry, PostHog, `POSTHOG_PROJECT_URL`, feedback email/Slack)
- Verify `GET /api/health/beta` on production
- Enable PostHog session replay; wire Sentry → Linear
- Phase 0 dry run: 3 friends, feedback + replay end-to-end

**Marketing**

- Paris HTML pages in `client/marketing/`
- Routes in `server.js` `MARKETING_HTML`
- Sitemap auto-includes new routes
- Cross-links MX ↔ Paris + `/destinations`
- Deploy to Render + verify live URLs
- Google Search Console: request indexing for Paris URLs + hub
- Confirm `travelbyvibe.com` DNS → Render (and optional 301 from travelboop.com) per `docs/DOMAIN.md`
- Beta invite email links to `BETA_BASE_URL` + city deep links (`/?city=Paris`)

---

## 14. Files in this repo


| File                                             | Role                    |
| ------------------------------------------------ | ----------------------- |
| `client/marketing/paris-hotels.html`             | Paris hub landing       |
| `client/marketing/paris-neighborhood-stays.html` | Paris neighbourhood SEO |
| `client/marketing/paris-visual-search.html`      | Paris feature SEO       |
| `client/marketing/destinations.html`             | City hub                |
| `client/marketing/mexico-city-*.html`            | Existing CDMX cluster   |
| `client/marketing/marketing.css`                 | Shared styles           |
| `server.js`                                      | Routes + sitemap        |
| `docs/marketing-plan-beta-launch.md`             | This document           |


---

*Questions or next city (London, NYC): duplicate the 3-page cluster pattern and add routes to `MARKETING_HTML`.*