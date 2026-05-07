# TravelBoop Closed Beta — Launch Checklist & Runbook

**Status:** Code complete (branch). Awaiting env config + manual ops items below.
**Beta size:** 50 invitees · **Access:** shared `SITE_PASSWORD` · **Launch city:** Mexico City
**Source plan:** `.cursor/plans/travelboop_closed_beta_launch_*.plan.md`

> Open this file before each launch checkpoint and tick boxes. Coding is done; the rest is config + outreach.

---

## 1. Render env vars to set before deploy

Set these in the Render dashboard (Environment tab, then Manual Deploy):


| Var                      | Value                                                 | Notes                                                                         |
| ------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| `SITE_PASSWORD`          | a fresh password (NOT the dev one)                    | The one you'll email to all 50 testers. Rotate before launch.                 |
| `INDEX_SECRET`           | (already set)                                         | Re-confirm before launch.                                                     |
| `SENTRY_DSN_SERVER`      | DSN from Sentry → Settings → Projects → Server        | Free tier 5k errors/mo.                                                       |
| `SENTRY_DSN_CLIENT`      | DSN from Sentry → Settings → Projects → Browser       | Public-by-design.                                                             |
| `SENTRY_ENV`             | `production`                                          | Tagged on every event.                                                        |
| `POSTHOG_PROJECT_KEY`    | "Project API Key" from PostHog → Project Settings     | Public, used in browser.                                                      |
| `POSTHOG_API_KEY`        | same key                                              | Used by server-side `posthog-node` for the `vsearch_executed` mirror.         |
| `POSTHOG_HOST`           | `https://us.i.posthog.com`                            | Default for US Cloud.                                                         |
| `RESEND_API_KEY`         | from resend.com/api-keys                              | For sending invite/welcome/nudge emails (via `scripts/email/send-emails.js`). |
| `BETA_PASSWORD`          | same value as `SITE_PASSWORD`                         | Used by email scripts to embed in the invite body.                            |
| `BETA_FROM`              | `TravelBoop Beta <beta@travelboop.com>`               | Domain must be verified in Resend.                                            |
| `BETA_REPLY_TO`          | `beta@travelboop.com`                                 | Where replies go.                                                             |
| `BETA_CALENDAR_URL`      | (optional) e.g. `https://cal.com/your-handle`         | Embedded in emails.                                                           |
| `SLACK_FEEDBACK_WEBHOOK` | (optional)                                            | Mirrors every `/api/feedback` POST to a Slack channel.                        |
| `BETA_BANNER`            | (optional) e.g. "Slow searches today — fix in flight" | Shown sticky-top to all users when set.                                       |


**Render-managed vars (already exist, just verify):**
`LITEAPI_PROD_KEY`, `GEMINI_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `LITEAPI_WL_DOMAIN`, `MAPTILER_KEY`, `GEOAPIFY_KEY`, `RENDER_EXTERNAL_URL`.

---

## 2. Supabase — apply beta migration

Run once in the Supabase SQL editor (or `supabase db push`):

```sql
-- file: supabase/add-beta-tables.sql
-- creates: beta_feedback, beta_consents, beta_invitees
```

Verify:

```sql
SELECT count(*) FROM beta_feedback;   -- 0
SELECT count(*) FROM beta_consents;   -- 0
SELECT count(*) FROM beta_invitees;   -- 0 (will be populated as you invite people)
```

---

## 3. Pre-launch manual setup (D items)

### A8 · UptimeRobot

- Create free account: [https://uptimerobot.com](https://uptimerobot.com)
- Add HTTP(s) monitor: `https://www.travelboop.com/api/health` — interval 5 min
- Set alert contact: SMS or Pushover or email-to-SMS
- Verify "down" alert by stopping the Render service for 1 minute

### C6 · Mailbox forwarding

- Set up `hello@travelboop.com` → your inbox (DNS provider's email forwarding, free)
- Same for `beta@`, `support@`
- Configure Gmail "Send mail as" so replies go out from `beta@travelboop.com`
- Send a test from each address (yourself → yourself) to verify SPF/DKIM/DMARC pass

### C7 · Favicon polish

- Open `/` on Safari (Mac), check pinned-tab icon (the SVG renders in monochrome — tweak `fill` if needed)
- Open `/` on iPhone, "Add to Home Screen" — verify the app icon
- (Optional) Add a `favicon-192.png` for older Android home-screens

### D1 · Recruit 50 testers

- 15 friends / family — DM invites (highest activation)
- 15 from a single Twitter/LinkedIn post about the launch
- 10 from one travel-niche community post (Reddit r/solotravel, Indie Hackers, etc.)
- 10 reserved for week-2 referrals from happy testers

### D2 · Roster spreadsheet (or Notion table)

Columns: `name, email, channel, invite_sent_at, gate_passed_at, first_search_at, distinct_id, feedback_count, calls_scheduled, status`. Or skip the sheet and rely on the `beta_invitees` Supabase table you imported via CSV.

### D3 · Invite email

- Customize the copy in `scripts/email/send-emails.js` (function `templates`, key `invite`) if you want different tone
- Dry-run: `node scripts/email/send-emails.js invite --csv invitees.csv --dry`
- Send for real once testers are confirmed

### D5 · Feedback channel

- Create one of: Slack Connect channel, Discord server, or Telegram group
- Set webhook URL as `SLACK_FEEDBACK_WEBHOOK` so in-app feedback mirrors there in real-time
- Pin a welcome message: "Hi! Use the round Feedback button (bottom-right) for bug reports — it tags the page and search you were on. Use this channel for chatty stuff."

### D6 · 1:1 calls

- Set up Cal.com or Calendly free tier with a 30-min slot template
- Set `BETA_CALENDAR_URL` env var so it gets embedded in welcome and nudge emails
- Aim for 5–8 calls in week 1–2 with the most engaged testers

### D7 · Linear project

- Create project "TravelBoop Beta v1"
- Triage feedback daily; tag `P0/P1/P2`
- Use the Linear MCP integration in Cursor to create issues from chat

### D8 · Beta exit criteria (lock these BEFORE launch)

Default suggested targets (edit if you want different bar):

- ≥ 35 of 50 invitees activate (one or more searches)
- ≥ 15 power users (≥ 5 searches over 14 days)
- < 5% of searches error or return zero results
- p95 search latency < 4s warm, < 6s cold (verify via PostHog `vsearch_executed` event)
- ≥ 5 Find & Book clicks per active user / week
- NPS ≥ 30 from end-of-beta survey
- Zero open P0 bugs, ≤ 3 open P1s

### D9 · Lock the timeline

Suggested 14-day cadence:

- D-7: All P0 code merged + deployed (this is done)
- D-3: Manual QA on real devices (B4) + booking E2E (B6)
- D-2: Dry run with 3 friends; fix anything they hit
- D-0: **Tuesday 10am local** — send 50 invites
- D+1: Monitor every search; reply to all feedback within 4h
- D+3: Day-2 nudge to non-activators (`node scripts/email/send-emails.js welcome`)
- D+7: Week-1 nudge (`node scripts/email/send-emails.js nudge`) + book 1:1 calls
- D+14: Send post-survey; review exit criteria; decide extend / open public / keep iterating

---

## 4. Quality gates (B items — most are manual)

### B3 · Cold-start TTFB measurement

- Trigger a Render redeploy to force cold start
- Within 10 seconds of `/api/health` returning 200, run:
  ```powershell
  Measure-Command { Invoke-WebRequest -UseBasicParsing "https://roommatch-1fg5.onrender.com/api/vsearch?city=Mexico%20City&query=walk%20in%20shower&distinct_id=cold-test" }
  ```
- Repeat 5 times back-to-back, capture p95
- Update CLAUDE.md "V2 Search Latency" section with the new baseline

### B4 · Mobile QA

- **iPhone Safari** (latest iOS, 375pt width): Boop wizard → results → hotel detail → Find & Book click. Lightbox swipes? Date picker reachable? Map markers tappable?
- **Android Chrome** (Pixel/Samsung): same flow.
- **iPad Safari** (portrait + landscape): does the two-column hotel detail page lay out cleanly?
- **iPhone SE** specifically — narrowest common viewport. Vibe quintuple cards stack?

### B5 · Cross-browser smoke (1h)

Walk one full search end-to-end on each:

- Chrome (Mac or Win) — desktop
- Safari (Mac)
- Firefox
- Edge

### B6 · Booking flow E2E

- Search MX City for "modern bathroom with rainfall shower"
- Click Find & Book on top result → verify URL has `?utm_source=travelboop_beta&...&tb_distinct=...`
- Verify WL page loads with correct hotel + dates pre-filled
- Repeat for 2 more random hotels (one with offerId, one without)

---

## 5. Day-1 launch checklist (E)

### T-24h

- All P0 items above complete and deployed to Render main
- Hit `https://www.travelboop.com/api/debug-sentry` — verify error appears in Sentry within 30s
- Open PostHog → Live Events — see `beta_gate_passed` when you load `/`
- PostHog dashboard: pin a funnel chart `city_selected → boop_completed → vsearch_executed → find_book_clicked`
- Sentry → Alerts: "any new error" → email yourself
- UptimeRobot active and tested
- Run a manual `pg_dump` (or trigger Supabase snapshot) for belt-and-suspenders backup
- `SITE_PASSWORD` rotated to the beta value

### T-2h

- Walk full flow on prod from a fresh browser (incognito) — gate password works, consent modal appears, search works, feedback button sends
- Same on phone
- Slack/Discord channel created + pinned
- Have your monitoring tabs open: Render logs, Sentry issues, PostHog Live Events, your inbox, the feedback channel

### T-0

- Run: `node scripts/email/send-emails.js invite --csv invitees.csv`
- Post in Slack: "🚀 Beta is live. Watching everything."
- Sit at desk for 4 hours, watch Sentry + feedback like a hawk

---

## 6. Post-launch weekly cadence (F)


| Cadence            | What                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------- |
| **Daily (week 1)** | Read every feedback message, reply same-day, triage Sentry, glance at PostHog funnel      |
| **Weekly**         | Ship one release with the top fixes, send progress digest to all 50, book 2 new 1:1 calls |
| **End of week 2**  | Send NPS survey (Tally form, link in email). Score against D8 exit criteria.              |
| **End of week 4**  | Decision point — extend beta, expand to 200, or open public                               |


---

## 7. What this codebase NOW has (for reference)


| Capability                                   | File(s)                                                    | Env required                                      |
| -------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| API rate limiting (per-IP)                   | `server.js` lines ~860-895                                 | none                                              |
| API beta gate (cookie + INDEX_SECRET bypass) | `server.js` lines ~898-918                                 | `SITE_PASSWORD`                                   |
| Helmet + tightened CORS + cookie hardening   | `server.js` lines ~830-855                                 | none                                              |
| Sentry server tracking                       | `server.js` top + bottom                                   | `SENTRY_DSN_SERVER`                               |
| Sentry browser tracking                      | `client/index.html` head + injected DSN                    | `SENTRY_DSN_CLIENT`                               |
| PostHog client analytics                     | `client/index.html` snippet + `track()` in `client/app.js` | `POSTHOG_PROJECT_KEY`                             |
| PostHog server mirror (vsearch_executed)     | `server.js` `trackServer()`                                | `POSTHOG_API_KEY`                                 |
| In-app feedback button + modal               | `client/index.html` + `client/app.js` end                  | DB migration                                      |
| `/api/feedback` endpoint                     | `server.js` end                                            | DB migration                                      |
| Beta consent modal (one-time)                | `client/index.html` + `client/app.js`                      | DB migration                                      |
| `/api/beta-consent` endpoint                 | `server.js` end                                            | DB migration                                      |
| BETA_BANNER sticky banner                    | `client/index.html` + `app.js` `initBetaBanner()`          | `BETA_BANNER`                                     |
| UTM + tb_distinct on Find & Book             | `client/app.js` `buildBookUrl()`                           | none                                              |
| `find_book_clicked` PostHog event            | `client/app.js` `_tbFireFindBookClick`                     | `POSTHOG_PROJECT_KEY`                             |
| Standalone `/privacy` & `/terms`             | `server.js` lines ~990-1100                                | none (public, indexable)                          |
| Open Graph + Twitter cards                   | `client/index.html` head                                   | (drop a `og-default.png` 1200x630 into `client/`) |
| Footer marketing + legal links               | `client/index.html` footer                                 | none                                              |
| `/api/debug-sentry` test endpoint            | `server.js` end                                            | `SENTRY_DSN_SERVER`                               |
| MX City search quality tests                 | `scripts/search-test-lib.js` IDs 100-112                   | `SUPABASE_SERVICE_KEY`                            |
| k6 load test                                 | `scripts/load-test/vsearch.js`                             | k6 binary                                         |
| GitHub Actions CI                            | `.github/workflows/ci.yml`                                 | repo secrets                                      |
| Resend email scripts                         | `scripts/email/send-emails.js`                             | `RESEND_API_KEY`, `BETA_PASSWORD`                 |


---

## 8. Coding items deliberately NOT done (deferred)


| Item                               | Why                                                                    | When to revisit                               |
| ---------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| EU cookie consent banner           | Closed beta is US-only initially                                       | Before public launch                          |
| `/og-default.png` (1200x630 image) | Needs a designer or screenshot session                                 | Before public launch — placeholder URL is set |
| CSP headers                        | Many third-party scripts (Sentry, PostHog, Maptiler) need allowlisting | Before public launch                          |
| Per-user invite codes              | Shared password is fine for 50 trusted users                           | If/when graduating to 200+ open beta          |
| Magic-link auth                    | Same reasoning                                                         | Public launch + user accounts                 |
| `npm audit fix` for moderate vulns | The 3 vulns are in dev-only deps                                       | Roll into a chore PR post-launch              |


---

*Last updated: 2026-05-07. Touch this file when you check items off.*