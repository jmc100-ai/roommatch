#!/usr/bin/env node
/**
 * Trigger full V2 city rollout on Render and print progress every N minutes.
 *
 *   node scripts/v2-city-rollout-remote.js --city=Paris
 *   node scripts/v2-city-rollout-remote.js --city=Paris --watch-only
 *   node scripts/v2-city-rollout-remote.js --city=Paris --interval=10
 *
 * Env: RENDER_BASE_URL (default https://roommatch-1fg5.onrender.com)
 *      INDEX_SECRET (default roommatch-2026)
 */
require("dotenv").config();

const BASE = (process.env.RENDER_BASE_URL || "https://roommatch-1fg5.onrender.com").replace(/\/$/, "");
const SECRET = process.env.INDEX_SECRET || "roommatch-2026";

function getArg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function apiHeaders() {
  return { "x-index-secret": SECRET, accept: "application/json" };
}

async function apiGet(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: apiHeaders(),
    signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(body)}`);
  return body;
}

async function apiPost(path, payload) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...apiHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(body)}`);
  return body;
}

function formatProgress(snap) {
  const st = snap.v2_indexed_cities || {};
  const c = snap.counts || {};
  const lines = [
    `[${new Date().toISOString()}] ${snap.city}`,
    `  status: ${st.status || "none"} | phase hint: check Render logs [v2-rollout] / [v2-index]`,
    `  v2_hotels_cache: ${c.v2_hotels} | inventory: ${c.v2_inventory} | facts: ${c.v2_facts} | room_types: ${c.v2_room_types}`,
    `  status row: hotels=${st.hotel_count ?? 0} photos=${st.photo_count ?? 0}`,
    `  started: ${st.started_at || "—"} | updated: ${st.updated_at || "—"}`,
  ];
  if (st.last_error) lines.push(`  last_error: ${st.last_error}`);
  if (st.completed_at) lines.push(`  completed_at: ${st.completed_at}`);
  return lines.join("\n");
}

async function fetchStatus(city) {
  try {
    return await apiGet(`/api/v2/city-rollout/status?city=${encodeURIComponent(city)}`);
  } catch (e) {
    if (String(e.message).includes("404")) {
      const legacy = await apiGet(`/api/v2/index-status?city=${encodeURIComponent(city)}`);
      return {
        city,
        v2_indexed_cities: legacy,
        counts: {},
        note: "Deploy latest code for full /api/v2/city-rollout/status",
      };
    }
    throw e;
  }
}

async function startRollout(city, { resume: resumeOpt } = {}) {
  const limitArg = getArg("limit");
  let catalogLimit = limitArg ? Number(limitArg) : null;
  if (!catalogLimit) {
    const pre = await fetchStatus(city);
    const total = pre.catalog_total;
    if (total != null && total > 0) catalogLimit = total + 50;
  }
  const resume = resumeOpt ?? hasFlag("--resume");
  const body = {
    city,
    secret: SECRET,
    force: !resume,
    resume: !!resume,
    keep_v1: hasFlag("--keep-v1"),
    skip_neighborhoods: hasFlag("--skip-neighborhoods"),
    regenerate_neighborhoods: hasFlag("--regenerate-neighborhoods"),
  };
  if (catalogLimit) body.limit = catalogLimit;

  try {
    return await apiPost("/api/v2/city-rollout", body);
  } catch (e) {
    if (String(e.message).includes("404")) {
      console.warn("[remote] /api/v2/city-rollout not deployed — falling back to /api/v2/reindex-city only");
      return apiPost("/api/v2/reindex-city", {
        city,
        secret: SECRET,
        force: body.force,
        limit: body.limit || 5200,
      });
    }
    throw e;
  }
}

async function watchLoop(city, intervalMin) {
  const ms = intervalMin * 60 * 1000;
  const autoResume = !hasFlag("--no-auto-resume");
  let lastHotels = -1;
  let flatTicks = 0;
  console.log(`\nWatching ${city} every ${intervalMin} min (auto_resume=${autoResume})…\n`);
  for (;;) {
    try {
      const snap = await fetchStatus(city);
      console.log(formatProgress(snap));
      const st = snap.v2_indexed_cities?.status;
      const hotels = snap.counts?.v2_hotels ?? 0;

      if (st === "complete" && (snap.counts?.v2_room_types || 0) > 0) {
        console.log("\n✓ Rollout appears complete (status=complete, room_types_index populated).");
        break;
      }
      if (st === "failed") {
        if (autoResume && !hasFlag("--watch-only")) {
          console.warn("\n[watch] status=failed — retrying with resume…");
          await startRollout(city);
        } else if (autoResume) {
          console.warn("\n[watch] status=failed — POST resume (watch-only mode)…");
          const limit = (snap.catalog_total || 5097) + 50;
          await apiPost("/api/v2/city-rollout", { city, secret: SECRET, resume: true, limit });
        } else {
          console.error("\n✗ Rollout failed — see last_error and Render logs.");
          process.exit(1);
        }
      } else if (autoResume && !snap.rollout_running && (st === "indexing" || st === "none")) {
        const flat = hotels === lastHotels && hotels > 0;
        flatTicks = flat ? flatTicks + 1 : 0;
        if (flat || st === "indexing") {
          console.warn(`[watch] stalled (running=false, hotels=${hotels}) — auto-resume…`);
          const limit = (snap.catalog_total || 5097) + 50;
          await apiPost("/api/v2/city-rollout", {
            city, secret: SECRET, resume: true, limit,
          });
          flatTicks = 0;
        }
      } else {
        flatTicks = 0;
      }
      lastHotels = hotels;
    } catch (e) {
      console.error(`[watch] ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, ms));
  }
}

async function main() {
  const city = getArg("city");
  if (!city) {
    console.error("Usage: node scripts/v2-city-rollout-remote.js --city=Paris [--watch-only] [--interval=15]");
    process.exit(1);
  }
  const interval = Number(getArg("interval") || "15");

  console.log(`Render base: ${BASE}`);

  if (!hasFlag("--watch-only")) {
    console.log(`\nStarting rollout on Render for ${city}…`);
    const started = await startRollout(city);
    console.log(JSON.stringify(started, null, 2));
  }

  await watchLoop(city, interval);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
