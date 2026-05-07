// k6 load test for the closed-beta launch.
// Mix: 70% /api/vsearch, 20% /api/rates, 10% /api/hotels-meta — modelled on the
// real funnel for a Mexico City visitor who searches, sees rates, and scrolls.
//
// Run locally:
//   k6 run scripts/load-test/vsearch.js
//
// Run with custom target & gate cookie (prod):
//   k6 run -e BASE_URL=https://www.travelboop.com -e GATE_PW=your-beta-password scripts/load-test/vsearch.js
//
// Tune profile via env (with defaults):
//   k6 run -e VUS_PEAK=25 -e DURATION_S=300 scripts/load-test/vsearch.js
//
// Pass criteria (auto-checked by k6 thresholds below):
//   * vsearch p95 < 5000ms
//   * vsearch error rate < 1%
//   * any 429 from rate-limit triggers a warning (we want headroom)
//
// Install k6 (Windows):  winget install k6 -- or scoop install k6
// Docs:                  https://k6.io/docs/

import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import crypto from 'k6/crypto';
import encoding from 'k6/encoding';

// ── Config ──────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'https://roommatch-1fg5.onrender.com';
const GATE_PW  = __ENV.GATE_PW  || ''; // SITE_PASSWORD — set when gate is on
const VUS_PEAK = parseInt(__ENV.VUS_PEAK || '25', 10);
const DURATION_S = parseInt(__ENV.DURATION_S || '300', 10);
const SEARCH_VERSION = __ENV.SEARCH_VERSION || 'v2';

// Real CDMX queries from the search-quality suite (B1). Mix of feature, vibe,
// and edge cases to exercise different code paths in /api/vsearch.
const QUERIES = [
  'walk in shower',
  'double sinks',
  'soaking tub',
  'rainfall shower',
  'balcony',
  'city view',
  'bathtub',
  'rooftop',
  'dark moody romantic suite',
  'bright airy room with large windows',
  'luxury suite marble bathroom',
  'minimalist modern design',
  'modern bathroom in Roma Norte',
  'family suite for 4',
];

// 50 known CDMX hotel IDs to use for /api/rates and /api/hotels-meta. Hardcoded
// here so the load test does not have to first hit /api/vsearch to discover IDs
// (which would skew the request mix). Pulled from a fresh prod search snapshot.
const HOTEL_IDS = [
  'lp1bb5f','lp1c1ed','lp1bbb0','lp1c4d6','lp1c34c','lp1c34d','lp1c0a9','lp1c20d','lp1c2cc','lp1c0e5',
  'lp1c4ad','lp1bbb4','lp1c3c2','lp1c1ec','lp1c2dd','lp1c156','lp1c0fc','lp1c4af','lp1c3a3','lp1c2e5',
];

// ── Custom metrics ──────────────────────────────────────────────────────────
const rateLimitHits = new Counter('rate_limit_hits');
const vsearchErrors = new Rate('vsearch_errors');
const vsearchLatency = new Trend('vsearch_latency_ms', true);

// ── Stage profile ───────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '60s',           target: Math.max(1, Math.floor(VUS_PEAK / 2)) },
        { duration: `${DURATION_S}s`, target: VUS_PEAK },
        { duration: '60s',           target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'http_req_failed':                    ['rate<0.01'],   // < 1% errors total
    'vsearch_latency_ms':                 ['p(95)<5000', 'p(99)<8000'],
    'http_req_duration{ep:vsearch}':      ['p(95)<5000'],
    'http_req_duration{ep:rates}':        ['p(95)<8000'],
    'http_req_duration{ep:hotels-meta}':  ['p(95)<3000'],
    'rate_limit_hits':                    ['count<50'],    // a few are fine; surge means we should raise the limit
  },
  // Reduce noise in summary
  summaryTrendStats: ['min', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ── Setup: pass the beta gate once and reuse the cookie across VUs ──────────
export function setup() {
  if (!GATE_PW) {
    console.log('[load] no GATE_PW provided — assuming beta gate is OFF');
    return { cookie: '' };
  }
  // Mirror server.js loginHtml() / POST /auth flow.
  const r = http.post(
    `${BASE_URL}/auth`,
    `password=${encodeURIComponent(GATE_PW)}`,
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirects: 0 }
  );
  const setCookie = r.headers['Set-Cookie'] || r.headers['set-cookie'] || '';
  const m = String(setCookie).match(/rm_gate=([^;]+)/);
  if (!m) {
    console.error('[load] failed to obtain gate cookie. Status:', r.status);
    throw new Error('beta gate auth failed');
  }
  console.log('[load] beta gate passed; reusing cookie for all VUs');
  return { cookie: `rm_gate=${m[1]}` };
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function distinctIdForVU(__VU) {
  // Stable per-VU id so the server-side mirror events look like "users".
  return `loadtest_vu_${__VU}_${crypto.md5(String(__VU), 'hex').slice(0, 8)}`;
}

// ── Workload ────────────────────────────────────────────────────────────────
export default function (data) {
  const headers = data.cookie ? { Cookie: data.cookie } : {};
  const distinct = distinctIdForVU(__VU);

  const r = Math.random();
  if (r < 0.7) {
    // ── /api/vsearch (70%) ────────────────────────────────────────────────
    group('vsearch', () => {
      const q = pick(QUERIES);
      const url = `${BASE_URL}/api/vsearch?` + [
        `query=${encodeURIComponent(q)}`,
        `city=Mexico%20City`,
        `search_version=${SEARCH_VERSION}`,
        `distinct_id=${distinct}`,
      ].join('&');
      const t0 = Date.now();
      const res = http.get(url, { headers, tags: { ep: 'vsearch' } });
      vsearchLatency.add(Date.now() - t0);
      vsearchErrors.add(res.status >= 400);
      if (res.status === 429) rateLimitHits.add(1);
      check(res, {
        'vsearch status 200': (r) => r.status === 200,
        'vsearch has hotels':  (r) => {
          try { return Array.isArray(JSON.parse(r.body).hotels); } catch { return false; }
        },
      });
    });
  } else if (r < 0.9) {
    // ── /api/rates (20%) ──────────────────────────────────────────────────
    group('rates', () => {
      // Random check-in 14-44 days out, 2-4 night stay
      const ci = new Date(Date.now() + (14 + Math.floor(Math.random() * 30)) * 86400000);
      const co = new Date(ci.getTime() + (2 + Math.floor(Math.random() * 3)) * 86400000);
      const fmt = (d) => d.toISOString().slice(0, 10);
      const url = `${BASE_URL}/api/rates?city=Mexico%20City&checkin=${fmt(ci)}&checkout=${fmt(co)}`;
      const res = http.get(url, { headers, tags: { ep: 'rates' } });
      if (res.status === 429) rateLimitHits.add(1);
      check(res, { 'rates status 200/204': (r) => r.status === 200 || r.status === 204 });
    });
  } else {
    // ── /api/hotels-meta (10%) ────────────────────────────────────────────
    group('hotels-meta', () => {
      // Pick a random 5-15 hotel IDs to fetch in one batch (mirrors lazy-fetch)
      const n = 5 + Math.floor(Math.random() * 10);
      const ids = [];
      for (let i = 0; i < n; i++) ids.push(pick(HOTEL_IDS));
      const url = `${BASE_URL}/api/hotels-meta?ids=${encodeURIComponent(ids.join(','))}`;
      const res = http.get(url, { headers, tags: { ep: 'hotels-meta' } });
      if (res.status === 429) rateLimitHits.add(1);
      check(res, { 'hotels-meta status 200': (r) => r.status === 200 });
    });
  }

  // Each VU thinks for 1-3 seconds between actions (real users don't spam).
  sleep(1 + Math.random() * 2);
}

// ── Summary banner ──────────────────────────────────────────────────────────
export function handleSummary(data) {
  const m = data.metrics;
  const get = (k, sub = 'p(95)') => m[k] && m[k].values ? m[k].values[sub] || 0 : 0;
  const summary = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TravelBoop closed-beta load test summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Target:               ${BASE_URL}
Peak VUs:             ${VUS_PEAK}
Soak duration:        ${DURATION_S}s

Total requests:       ${m.http_reqs?.values?.count || 0}
Failed requests:      ${(get('http_req_failed', 'rate') * 100).toFixed(2)}%
Rate-limit (429) hits:${m.rate_limit_hits?.values?.count || 0}

vsearch p95:          ${get('vsearch_latency_ms').toFixed(0)} ms
rates p95:            ${get('http_req_duration{ep:rates}').toFixed(0)} ms
hotels-meta p95:      ${get('http_req_duration{ep:hotels-meta}').toFixed(0)} ms

Pass thresholds: see options.thresholds in scripts/load-test/vsearch.js
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  return {
    'stdout': summary,
    'load-test-summary.json': JSON.stringify(data, null, 2),
  };
}
