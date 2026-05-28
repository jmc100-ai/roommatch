# TravelByVibe — domains & branding

**Last updated:** 2026-05-28

## Canonical public site

| Role | Value |
|------|--------|
| **Product name** | TravelByVibe |
| **Primary domain** | [https://www.travelbyvibe.com](https://www.travelbyvibe.com) |
| **Apex** | [https://travelbyvibe.com](https://travelbyvibe.com) (should redirect to `www` if you use www canonical) |

Set in Render:

- `SITE_PUBLIC_ORIGIN=https://www.travelbyvibe.com`
- `BETA_BASE_URL=https://www.travelbyvibe.com` (invite emails, marketing CTAs)

Code default when env is unset: `https://www.travelbyvibe.com` (`server.js` → `SITE_PUBLIC_ORIGIN`).

## Legacy domain (TravelBoop)

| Role | Value |
|------|--------|
| **Legacy app domain** | travelboop.com — keep DNS pointing at the same Render service **or** 301 redirect to `www.travelbyvibe.com` |
| **Legal entity** | TravelBoop, LLC (footer, terms — unchanged) |
| **LiteAPI white-label** | `travelboop.nuitee.link` — partner booking hostname; **do not** rename |
| **GitHub / Render service** | `roommatch` repo, `roommatch-1fg5.onrender.com` — infrastructure names, not user-facing brand |

CORS allows both `travelbyvibe.com` and `travelboop.com` during transition.

## Email

Beta / contact addresses in docs and UI use **`@travelbyvibe.com`** (e.g. `beta@travelbyvibe.com`). Verify the domain in Resend and add DNS (SPF/DKIM) before sending invites.

## UTM / attribution

Booking links use `utm_source=travelbyvibe` (not `travelboop`). PostHog/Sentry use the pseudonymous `TB_DISTINCT_ID` — not the marketing domain.

## Maptiler / Google referrers

Add to API key allowlists:

- `https://www.travelbyvibe.com/*`
- `https://travelbyvibe.com/*`
- Keep legacy `travelboop.com` entries until redirects are retired.

See also: `docs/gcp-streetview-referrers.md`, `BETA_LAUNCH.md`, `docs/marketing-plan-beta-launch.md`.
