# TravelByVibe closed beta — launch checklist & runbook

**Product:** TravelByVibe · **Site:** [travelbyvibe.com](https://www.travelbyvibe.com) (see `docs/DOMAIN.md` for legacy travelboop.com)  
**Status:** Code ready for phased beta. Ops (Sentry/PostHog/Linear/invites) are manual.  
**Cities:** Mexico City (primary) + Paris  
**Last updated:** 2026-06-15

> Open this file before each launch checkpoint. Tick boxes in order.

---

## Phased rollout (recommended)


| Phase                 | Size    | Goal                                 | Gate                                                            |
| --------------------- | ------- | ------------------------------------ | --------------------------------------------------------------- |
| **0 — Friends**       | 15–25   | Break obvious P0s, fix feedback loop | `/api/health/beta` all instrumentation `true`; 3-device QA done |
| **1 — Closed beta**   | 50–100  | Boop funnel + search quality signal  | <2 open P0; p95 `response_ms` on `vsearch_executed` < 6s cold   |
| **2 — Expanded beta** | 200–500 | Ranking + nbhd UX at scale           | Same + weekly Linear triage; PostHog replays reviewed           |


Use one shared `SITE_PASSWORD` for phases 0–1; rotate before phase 2 or switch to per-cohort passwords if leaks are a concern.

---

## Gap audit (May 2026)

### Already in the repo (ship after deploy + env)


| Capability                                                                                         | Where                                                     |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| PostHog `track()` + `identify(distinct_id)`                                                        | `client/app.js`                                           |
| Funnel events `city_selected`, `boop_completed`, `vsearch_executed` (+ `response_ms`, `server_ms`) | `client/app.js`                                           |
| Sentry browser + server, `setUser({ id: distinct_id })`                                            | `client/index.html`, `client/app.js`                      |
| Feedback FAB + category + rich context → Supabase                                                  | `POST /api/feedback`                                      |
| Slack/email mirrors with PostHog person link (if `POSTHOG_PROJECT_URL` set)                        | `server.js`                                               |
| Beta consent + gate + rate limits                                                                  | `server.js`, `client/`                                    |
| Marketing SEO cluster (CDMX + Paris)                                                               | `client/marketing/`, `docs/marketing-plan-beta-launch.md` |
| JSON readiness probe                                                                               | `GET /api/health/beta`                                    |


### You must do manually (not code)


| Gap                         | Action                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **PostHog session replay**  | PostHog → Project Settings → Recordings → enable; sample 100% for beta                                         |
| **PostHog dashboards**      | Pin funnel: `beta_gate_passed` → `city_selected` → `boop_completed` → `vsearch_executed` → `find_book_clicked` |
| **Sentry → Linear**         | Sentry → Settings → Integrations → Linear; auto-create issues for new errors                                   |
| **Sentry alerts**           | Email/Slack on first seen issue in `production`                                                                |
| **Linear project + labels** | `bug`, `ux`, `search-quality`, `paris`, `mexico-city`, `mobile`, `P0`/`P1`/`P2`                                |
| **Supabase migrations**     | Run `add-beta-tables.sql` then `add-beta-feedback-context.sql`                                                 |
| **Render env**              | Table in §1 below                                                                                              |
| **Resend domain**           | Verify `beta@travelbyvibe.com` (or your from-domain)                                                             |
| **Better Stack**            | External uptime monitors — see §9 (commercial use OK on free tier)                                             |
| **Tester recruitment**      | Friends + Reddit/city subs + PH Upcoming — see §3                                                              |
| **Jam / Marker.io**         | Optional for phase 2 if Slack feedback lacks repro detail                                                      |


### Deferred (post–500 users or public launch)

- Per-user invite codes / magic links  
- EU cookie banner  
- CSP headers  
- V2 search-quality CI redesign (`BETA_LAUNCH.md` §8)  
- `og-image.png` designer pass

---

## 1. Render env vars (set before deploy)


| Var                      | Value                                       | Notes                                                               |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------- |
| `SITE_PASSWORD`          | fresh password                              | Email to testers; rotate between phases.                            |
| `BETA_GATE_ENABLED`      | `1` (on) or `0` (off)                       | **Master switch** — `0` opens the site without clearing passwords or invite codes. |
| `INDEX_SECRET`           | (already set)                               | Re-confirm.                                                         |
| `SENTRY_DSN_SERVER`      | Sentry → Server DSN                         |                                                                     |
| `SENTRY_DSN_CLIENT`      | Sentry → Browser DSN                        | Public-by-design.                                                   |
| `SENTRY_ENV`             | `production`                                |                                                                     |
| `POSTHOG_PROJECT_KEY`    | PostHog project API key                     | Browser.                                                            |
| `POSTHOG_API_KEY`        | same key                                    | Server mirror (`feedback_submitted_server`, etc.).                  |
| `POSTHOG_HOST`           | `https://us.i.posthog.com`                  |                                                                     |
| `POSTHOG_PROJECT_URL`    | e.g. `https://us.posthog.com/project/12345` | **No trailing slash.** Powers replay links in feedback email/Slack. |
| `RESEND_API_KEY`         | resend.com                                  | Invites + feedback email.                                           |
| `BETA_PASSWORD`          | same as `SITE_PASSWORD`                     | Email scripts embed this.                                           |
| `BETA_FROM`              | `TravelByVibe Beta <beta@travelbyvibe.com>`   | Domain verified in Resend (`travelbyvibe.com`).                       |
| `BETA_REPLY_TO`          | `beta@travelbyvibe.com`                       |                                                                     |
| `BETA_BASE_URL`          | `https://www.travelbyvibe.com`                | Invite links + marketing CTAs. **Set on Render 2026-05-28.**        |
| `SITE_PUBLIC_ORIGIN`     | `https://www.travelbyvibe.com`                | Sitemap, OG fallback, outbound User-Agent. **Set on Render 2026-05-28.** |
| `BETA_CALENDAR_URL`      | (optional) Cal.com / Calendly               | Nudge emails.                                                       |
| `SLACK_FEEDBACK_WEBHOOK` | (recommended)                               | Real-time feedback mirror.                                          |
| `BETA_FEEDBACK_EMAIL`    | (recommended)                               | Requires `RESEND_API_KEY` + `BETA_FROM`.                            |
| `BETA_BANNER`            | (optional)                                  | Sticky status line for known issues.                                |


**Verify after deploy:**

```powershell
.\scripts\beta-launch-verify.ps1
# or:
Invoke-RestMethod "https://www.travelbyvibe.com/api/health/beta"
```

Expect `instrumentation.sentry_server`, `posthog`, `site_gate`, `supabase_admin` all `true`. If `/api/health/beta` returns **401**, deploy the latest commit (allowlist for that route was added in-repo).

**Domain note:** Canonical site is **travelbyvibe.com**. See `docs/DOMAIN.md`. Legacy travelboop.com should hit the same Render service or 301 to TravelByVibe.

---

## 2. Supabase migrations

Run in SQL editor (order matters):

```sql
-- 1) supabase/add-beta-tables.sql
-- 2) supabase/add-beta-feedback-context.sql
```

**Applied 2026-05-28:** `beta_*` tables present; `add_beta_feedback_context` migration added `current_city`, `issue_type`, `debug_context`, etc.

Verify:

```sql
SELECT count(*) FROM beta_feedback;
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'beta_feedback' AND column_name IN ('current_city', 'issue_type', 'debug_context');
```

---

## 3. Recruiting testers (200–500)

**Do not use generic QA marketplaces** (UserTesting, Testlio) — you need real trip planners.


| Channel               | Target   | Notes                                                                                     |
| --------------------- | -------- | ----------------------------------------------------------------------------------------- |
| Personal network      | 50–100   | Highest activation; CDMX or Paris trip in next 90 days                                    |
| Reddit                | 50–150   | `r/solotravel`, `r/travel`, `r/mexicocity`, `r/ParisTravelGuide` — honest builder post    |
| Product Hunt Upcoming | waitlist | Brand + email capture                                                                     |
| Travel micro-creators | 10–20    | 60s Boop demo; cap so you can reply                                                       |
| Marketing landings    | ongoing  | UTM → `/?city=Paris` or `/?city=Mexico%20City` — see `docs/marketing-plan-beta-launch.md` |


**Roster:** `beta_invitees` table or a Notion sheet: `email, channel, invite_sent_at, distinct_id, feedback_count, status`.

**Invite email:** `node scripts/email/send-emails.js invite --csv invitees.csv --dry` then send for real.

Pin in Slack/Discord: *Use the Feedback button (bottom-right) for bugs — it attaches city, session id, and category. Chat here for general discussion.*

---

## 4. AI agent bug-fix loop

1. **Sentry** creates Linear issue (stack + release + `user.id` = `distinct_id`).
2. **PostHog** → Persons → paste `distinct_id` → watch session replay before the report.
3. **Slack/email feedback** includes PostHog link when `POSTHOG_PROJECT_URL` is set.
4. **Agent** reproduces with city + Boop path; run `node scripts/test-search-quality.js` for regressions.
5. **Human** approves PR → commit → push → **Render deploy** → re-verify on prod.

Linear issue template (paste into project description):

```
City: Mexico City | Paris
Category: bug | ux | search-quality
Distinct ID: <from feedback>
PostHog: <link>
Steps:
Expected:
Actual:
```

---

## 5. Pre-launch quality gates

### B4 · Mobile QA

iPhone Safari, Android Chrome, iPad: Boop → results → hotel detail → Find & Book. Nbhd map tappable?

### B6 · Booking E2E

Find & Book URL includes `utm_source=travelbyvibe`, `utm_medium=beta`, `utm_campaign=closed_beta_2026`, `tb_distinct=...`.

### T-24h

- `GET /api/debug-sentry?secret=...` → error in Sentry within 30s  
- PostHog Live Events: `beta_gate_passed`, `boop_completed`, `vsearch_executed`  
- Feedback test → row in `beta_feedback` + Slack/email  
- Better Stack monitors green (§9)  
- `SITE_PASSWORD` rotated to beta value

### T-0

- Send invites  
- Monitor 4h: Sentry, PostHog Live, feedback channel, Render logs

---

## 6. Exit criteria (edit before launch)

**Phase 1 (50 users):**

- ≥ 35 activate (≥1 `vsearch_executed`)  
- ≥ 15 power users (≥5 searches / 14 days)  
- p95 `response_ms` on `vsearch_executed` < 6s (cold), < 4s (warm)  
- ≥ 5 Find & Book clicks / active user / week  
- Zero open P0; ≤ 3 P1

**Phase 2 (500 users):** same metrics scaled; add NPS survey (Tally) at day 14.

---

## 7. Ops stack summary


| Purpose                    | Tool                                       |
| -------------------------- | ------------------------------------------ |
| Analytics + session replay | PostHog                                    |
| Crashes                    | Sentry                                     |
| External uptime + incidents | Better Stack (free tier)                  |
| Auto-restart + deploy gate | Render health check on `/api/health`       |
| Tasks / agent queue        | Linear                                     |
| In-app reports             | Built-in feedback → Supabase + Slack/email |
| Beta users                 | Invites + Reddit + marketing pages         |
| Optional richer reports    | Jam (phase 2 only if needed)               |


---

## 8. Code reference (what shipped)


| Capability                | File(s)                                                         |
| ------------------------- | --------------------------------------------------------------- |
| Funnel events             | `client/app.js`                                                 |
| Rich `/api/feedback`      | `server.js`                                                     |
| PostHog person URL helper | `scripts/beta-posthog-person-url.js`                            |
| Health readiness JSON     | `GET /api/health/beta`                                          |
| Feedback UI category      | `client/index.html`                                             |
| Migrations                | `supabase/add-beta-tables.sql`, `add-beta-feedback-context.sql` |
| Marketing plan            | `docs/marketing-plan-beta-launch.md`                            |


---

## 9. Better Stack uptime monitoring

**Provider:** [Better Stack](https://betterstack.com/) (formerly Better Uptime) — chosen for closed beta because the free tier allows **commercial use** (UptimeRobot free does not).

**Stack split:**

| Layer | Tool | What it catches |
| ----- | ---- | --------------- |
| Liveness + auto-restart | Render → `/api/health` | Process down, failed deploy; Render restarts after ~60s of failed probes |
| External uptime | Better Stack | DNS/SSL/edge issues Render won't see; alerts you when users can't reach the site |
| App errors | Sentry | 500s, uncaught exceptions, slow traces |
| Deep readiness | `GET /api/health/beta` | Supabase + instrumentation flags — **Better Stack only**, not Render's probe |

### Monitors to create

| Name | URL | Interval | Expect | Alert |
| ---- | --- | -------- | ------ | ----- |
| **TravelByVibe — liveness** | `https://www.travelbyvibe.com/api/health` | 3 min (free default) | HTTP `200`, body contains `ok` | Email + Slack |
| **TravelByVibe — readiness** (optional) | `https://www.travelbyvibe.com/api/health/beta` | 5 min | HTTP `200`, JSON `"ok": true` | Email + Slack |
| **Render origin** (optional) | `https://roommatch-1fg5.onrender.com/api/health` | 5 min | HTTP `200`, body `ok` | Email only |

Use the **canonical domain** (`www.travelbyvibe.com`) for the primary monitor so you catch DNS/TLS/custom-domain issues, not just Node uptime.

### Do not

- Point **Render's** health check at `/api/health/beta` — it depends on Supabase and can false-fail on DB blips.
- Rely on Better Stack alone for crash visibility — pair with Sentry + Render deploy/unhealthy notifications (Render dashboard → Notifications).

### Pre-launch verify

1. Better Stack dashboard shows all monitors **Up**.
2. Pause one monitor or use Better Stack's test alert → confirm email/Slack delivery.
3. `GET /api/health` and `/api/health/beta` return 200 on production (see §1 verify script).

### Status page (optional)

Better Stack free includes one public status page — useful before phase 2 if you want a shareable “all systems operational” link for testers.

---

*Touch this file when you check items off or change phase targets.*