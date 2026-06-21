#!/usr/bin/env node
/**
 * London V2 launch watchdog — detect stalled index / search lag and auto-fix.
 * Used by monitor-london-launch.js and city-launch --phase=watch --auto-fix
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { createClient } = require("@supabase/supabase-js");
const { rebuildV2RoomTypesIndex } = require("./index-city-v2");

const STALE_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.LAUNCH_STALE_MS) || 12 * 60 * 1000,
);
const COOLDOWN_MS = Math.max(
  3 * 60 * 1000,
  Number(process.env.LAUNCH_FIX_COOLDOWN_MS) || 5 * 60 * 1000,
);
const SEARCH_LAG_MIN = Math.max(
  10,
  Number(process.env.LAUNCH_SEARCH_LAG_MIN) || 40,
);

function getDb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function loadState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return { lastFixAt: 0, lastResumeAt: 0, lastRebuildAt: 0 };
  }
}

function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function indexProcessCommandLines() {
  try {
    if (process.platform === "win32") {
      const out = execSync(
        'wmic process where "name=\'node.exe\'" get CommandLine /format:list',
        { encoding: "utf8", timeout: 15000, windowsHide: true },
      );
      return out
        .split(/\r?\n/)
        .filter((l) => l.startsWith("CommandLine="))
        .map((l) => l.slice("CommandLine=".length).trim())
        .filter(Boolean);
    }
    const out = execSync("ps -ax -o args= 2>/dev/null || ps aux", {
      encoding: "utf8",
      timeout: 15000,
    });
    return out.split(/\r?\n/).filter((l) => /node/.test(l));
  } catch {
    return [];
  }
}

function findIndexPids(city) {
  const needle = `city-launch.js`;
  const lines = indexProcessCommandLines();
  const pids = [];
  for (const line of lines) {
    if (!line.includes(needle) || !/--phase=index/.test(line)) continue;
    if (city && !line.includes(`--city=${city}`) && !line.includes(`--city=${city.replace(/ /g, "")}`)) {
      if (!line.toLowerCase().includes(city.toLowerCase().replace(/ /g, ""))) continue;
    }
    const m = line.match(/(?:^|\s)(?:\/|\)?\s*)?(\d+)/);
    if (process.platform !== "win32") {
      const pm = line.match(/^\s*(\d+)/);
      if (pm) pids.push(Number(pm[1]));
    }
  }
  if (process.platform === "win32") {
    try {
      const out = execSync(
        'wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /format:csv',
        { encoding: "utf8", timeout: 15000, windowsHide: true },
      );
      for (const row of out.split(/\r?\n/).slice(1)) {
        if (!row.trim()) continue;
        const parts = row.split(",");
        const cmd = parts.slice(2).join(",").toLowerCase();
        const pid = Number(parts[1]);
        if (!pid || !cmd.includes("city-launch.js") || !cmd.includes("--phase=index")) continue;
        if (city && !cmd.includes(city.toLowerCase().replace(/ /g, ""))) continue;
        pids.push(pid);
      }
    } catch { /* ignore */ }
  }
  return [...new Set(pids.filter(Boolean))];
}

function spawnDetached(args, logPath) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  child.unref();
  const line = `[watchdog] spawned: node ${args.join(" ")} (pid ${child.pid})\n`;
  fs.appendFileSync(logPath, line);
  return child.pid;
}

function killPids(pids, logPath) {
  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore", windowsHide: true });
      } else {
        process.kill(pid, "SIGTERM");
      }
      fs.appendFileSync(logPath, `[watchdog] killed hung index pid ${pid}\n`);
    } catch { /* already dead */ }
  }
}

async function snapshot(city) {
  const db = getDb();
  const { data: st } = await db
    .from("v2_indexed_cities")
    .select("status, hotel_count, photo_count, updated_at, index_progress, last_error, completed_at")
    .eq("city", city)
    .maybeSingle();

  const counts = {};
  for (const t of ["v2_hotels_cache", "v2_room_inventory", "neighborhoods"]) {
    const { count } = await db.from(t).select("*", { count: "exact", head: true }).eq("city", city);
    counts[t] = count ?? 0;
  }

  const { data: rtRows } = await db.from("v2_room_types_index").select("hotel_id").eq("city", city);
  const searchHotels = new Set((rtRows || []).map((r) => r.hotel_id)).size;

  const { data: nbhds } = await db
    .from("neighborhoods")
    .select("name, vibe_last_computed_at")
    .eq("city", city);

  const prog = st?.index_progress || {};
  const cap = prog.index_cap ?? 4000;
  const cacheHotels = counts.v2_hotels_cache;

  return {
    ts: new Date().toISOString(),
    city,
    index: {
      status: st?.status || "none",
      hotels: cacheHotels,
      cap,
      pct: cap ? Math.round((cacheHotels / cap) * 100) : null,
      photos: counts.v2_room_inventory,
      search_hotels: searchHotels,
      search_lag: cacheHotels - searchHotels,
      queue: prog.queue_offset != null ? `${prog.queue_offset}/${prog.queue_total}` : null,
      updated_at: st?.updated_at,
      heartbeat_ms: st?.updated_at ? Date.now() - new Date(st.updated_at).getTime() : null,
      last_error: st?.last_error,
      completed_at: st?.completed_at,
    },
    neighborhoods: {
      count: counts.neighborhoods,
      with_vibe: (nbhds || []).filter((n) => n.vibe_last_computed_at).length,
      names: (nbhds || []).map((n) => n.name),
    },
  };
}

function formatReport(s, actions = []) {
  const lines = [
    `\n=== ${s.ts} ===`,
    `INDEX: ${s.index.status} | ${s.index.hotels}/${s.index.cap} (${s.index.pct}%) | photos=${s.index.photos} | search=${s.index.search_hotels} (lag ${s.index.search_lag})`,
    s.index.queue ? `  queue: ${s.index.queue}` : "",
    s.index.updated_at
      ? `  heartbeat: ${Math.round((s.index.heartbeat_ms || 0) / 60000)}m ago`
      : "",
    s.index.last_error ? `  ERROR: ${s.index.last_error}` : "",
    `NBHD: ${s.neighborhoods.count} rows | ${s.neighborhoods.with_vibe} with vibes`,
    s.neighborhoods.names.length
      ? `  areas: ${s.neighborhoods.names.join(", ")}`
      : "  (none in DB yet)",
    ...actions.map((a) => `  >>> ${a}`),
  ].filter(Boolean);
  return lines.join("\n");
}

/**
 * @returns {Promise<string[]>} human-readable actions taken
 */
async function checkAndFix(s, { city, logPath, statePath, autoFix = true }) {
  if (!autoFix) return [];
  if (s.index.status === "complete" || s.index.hotels >= s.index.cap) return [];

  const state = loadState(statePath);
  const now = Date.now();
  const actions = [];
  const stale = (s.index.heartbeat_ms || 0) > STALE_MS;
  const indexPids = findIndexPids(city);

  if (s.index.status === "indexing" && stale && now - state.lastResumeAt > COOLDOWN_MS) {
    if (indexPids.length) {
      killPids(indexPids, logPath);
    }
    spawnDetached(
      ["scripts/city-launch.js", `--city=${city}`, "--phase=index", "--resume"],
      logPath,
    );
    actions.push(
      `AUTO-RESUME: no heartbeat for ${Math.round(s.index.heartbeat_ms / 60000)}m` +
        (indexPids.length ? ` (killed ${indexPids.length} stale process(es))` : ""),
    );
    state.lastResumeAt = now;
    state.lastFixAt = now;
  }

  if (
    s.index.search_lag >= SEARCH_LAG_MIN &&
    s.index.hotels > 0 &&
    now - state.lastRebuildAt > COOLDOWN_MS
  ) {
    const db = getDb();
    const ok = await rebuildV2RoomTypesIndex(db, city, {
      label: `watchdog lag=${s.index.search_lag}`,
    });
    if (ok) {
      actions.push(`AUTO-REBUILD-SEARCH: cache=${s.index.hotels} search=${s.index.search_hotels}`);
      state.lastRebuildAt = now;
      state.lastFixAt = now;
    }
  }

  if (actions.length) saveState(statePath, state);
  return actions;
}

module.exports = {
  snapshot,
  formatReport,
  checkAndFix,
  STALE_MS,
  SEARCH_LAG_MIN,
};
