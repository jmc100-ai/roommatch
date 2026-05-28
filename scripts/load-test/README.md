# Load testing — scripts/load-test/

Single k6 script for the closed-beta launch. Verifies headroom for ~25
concurrent users (5x our 50-tester beta load) before going live.

## Install k6

Windows (PowerShell): `winget install k6` or `scoop install k6`
Mac: `brew install k6`
Docker: `docker run --rm -i grafana/k6 run - <vsearch.js`

## Run

Default (against prod, gate off):
```
k6 run scripts/load-test/vsearch.js
```

Against prod with the beta gate on (recommended for realism):
```
k6 run -e BASE_URL=https://www.travelbyvibe.com -e GATE_PW=your-beta-password scripts/load-test/vsearch.js
```

Quick smoke (10 VUs, 60s soak):
```
k6 run -e VUS_PEAK=10 -e DURATION_S=60 scripts/load-test/vsearch.js
```

Full peak (50 VUs, 10 min — only at off-hours; will trigger Gemini rate
limits if your tier is too low):
```
k6 run -e VUS_PEAK=50 -e DURATION_S=600 scripts/load-test/vsearch.js
```

## Pass criteria

The `options.thresholds` block in `vsearch.js` automatically fails the run when:
- Overall HTTP error rate > 1%
- /api/vsearch p95 > 5s (or p99 > 8s)
- /api/rates p95 > 8s
- /api/hotels-meta p95 > 3s
- Total 429 (rate-limit) hits > 50 across the run

Output also writes `load-test-summary.json` next to the script for archiving.

## What to watch in Render logs while it runs

- `[v2-meta] sync fetched` lines — confirm meta sync limit is honoured
- `[hotel-meta] background warm` — confirm cache stays warm
- Any `[error]` with stack traces — these are gold; address before launch
- Rate-limit hits — if you see them under 25 VUs, raise the limits in
  `server.js` (search "rateLimit" / look at `limiterSearch` etc.)

## Tip: run once cold, once warm

Render rotates instances every 1-3 hours. To get the realistic worst-case:
1. Wait until `/api/health` returns slowly (or kick a deploy)
2. Run the test *immediately* — first ~30 seconds will show cold-cache numbers
3. Re-run 5 minutes later for warm-cache numbers

Compare both against the targets in CLAUDE.md "V2 Search Latency".
