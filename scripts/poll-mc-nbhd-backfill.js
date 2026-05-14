/**
 * POST Mexico City neighborhood vibe backfill, poll Supabase every 2 min until
 * all rows have vibe_last_computed_at strictly greater than pre-run max.
 */
require("dotenv").config();
const https = require("https");
const { createClient } = require("@supabase/supabase-js");

const CITY = "Mexico City";
const EXPECT = 10;
const POLL_MS = 2 * 60 * 1000;
const MAX_POLLS = 45;

function postBackfill(secret) {
  const body = JSON.stringify({ city: CITY, secret });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "roommatch-1fg5.onrender.com",
        path: "/api/backfill-neighborhood-vibes",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ status: res.statusCode, body: d }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const secret = process.env.INDEX_SECRET;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!secret || !url || !key) {
    console.error("Need INDEX_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY in .env");
    process.exit(1);
  }
  const db = createClient(url, key);

  const { data: before, error: e0 } = await db
    .from("neighborhoods")
    .select("name,vibe_last_computed_at")
    .eq("city", CITY)
    .order("name");
  if (e0) throw e0;
  if ((before?.length || 0) !== EXPECT) {
    console.error(`Expected ${EXPECT} rows for ${CITY}, got ${before?.length}`);
    process.exit(1);
  }
  let preMax = "1970-01-01T00:00:00.000Z";
  for (const r of before) {
    if (r.vibe_last_computed_at && r.vibe_last_computed_at > preMax) preMax = r.vibe_last_computed_at;
  }
  console.log(`[poll] pre_max=${preMax} (anchor: all rows must become strictly newer)`);

  const pr = await postBackfill(secret);
  console.log(`[poll] POST backfill → HTTP ${pr.status} ${pr.body}`);
  if (pr.status !== 200) {
    console.error("[poll] POST failed");
    process.exit(1);
  }

  for (let i = 1; i <= MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const { data: rows, error } = await db
      .from("neighborhoods")
      .select("name,vibe_last_computed_at")
      .eq("city", CITY)
      .order("name");
    if (error) throw error;
    const done = rows.filter((r) => r.vibe_last_computed_at && r.vibe_last_computed_at > preMax).length;
    const iso = new Date().toISOString();
    console.log(`[poll] ${iso} #${i}/${MAX_POLLS}: ${done}/${EXPECT} updated (ts > pre_max)`);
    for (const r of rows) {
      const ok = r.vibe_last_computed_at && r.vibe_last_computed_at > preMax;
      console.log(`       ${ok ? "✓" : "…"} ${r.name}  ${r.vibe_last_computed_at || "null"}`);
    }
    if (done === EXPECT) {
      console.log("[poll] COMPLETE — all neighbourhoods refreshed.");
      process.exit(0);
    }
  }
  console.error("[poll] TIMEOUT — not all rows passed pre_max within max polls.");
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
