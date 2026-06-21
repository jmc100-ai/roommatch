#!/usr/bin/env node
/**
 * Watchdog for --phase=geo-backfill (Heathrow / geoQuota zones).
 * Detects stalls and crashed runs; runs repair-fences + rebuild-search when done.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const { createClient } = require("@supabase/supabase-js");
const { isInGeoZone } = require("./geo-index-helpers");
const { getCuratedNeighborhoodFence, listGeoQuotaFences } = require("./neighborhood-fence-overrides");

const STALE_MS = Math.max(
  10 * 60 * 1000,
  Number(process.env.GEO_BACKFILL_STALE_MS) || 15 * 60 * 1000,
);
const COOLDOWN_MS = Math.max(
  3 * 60 * 1000,
  Number(process.env.GEO_BACKFILL_FIX_COOLDOWN_MS) || 5 * 60 * 1000,
);

function getDb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function loadState(statePath) {
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    return {
      lastFixAt: 0,
      lastRestartAt: 0,
      lastZoneCount: 0,
      lastZoneChangeAt: 0,
      postCompleteDone: false,
    };
  }
}

function saveState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function nodeProcessLines() {
  try {
    if (process.platform === "win32") {
      const out = execSync(
        'wmic process where "name=\'node.exe\'" get ProcessId,CommandLine /format:csv',
        { encoding: "utf8", timeout: 15000, windowsHide: true },
      );
      const rows = [];
      for (const row of out.split(/\r?\n/).slice(1)) {
        if (!row.trim()) continue;
        const parts = row.split(",");
        const pid = Number(parts[1]);
        const cmd = parts.slice(2).join(",");
        if (pid && cmd) rows.push({ pid, cmd });
      }
      return rows;
    }
    const out = execSync("ps -ax -o pid=,args=", { encoding: "utf8", timeout: 15000 });
    return out.split(/\r?\n/).filter(Boolean).map((line) => {
      const m = line.match(/^\s*(\d+)\s+(.*)$/);
      return m ? { pid: Number(m[1]), cmd: m[2] } : null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function findGeoBackfillPids(city) {
  const cityKey = String(city || "").toLowerCase().replace(/\s+/g, "");
  return nodeProcessLines()
    .filter(({ cmd }) => {
      const c = cmd.toLowerCase();
      return c.includes("city-launch.js")
        && c.includes("--phase=geo-backfill")
        && c.includes(cityKey);
    })
    .map(({ pid }) => pid);
}

function appendWatchdogLog(logPath, line) {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line);
  } catch (e) {
    console.warn(`[geo-watchdog] ${line.trim()} (${e.code || e.message})`);
  }
}

function spawnDetached(args, watchdogLogPath) {
  const backfillLog = path.join(process.cwd(), "logs", "london-heathrow-geo-backfill.log");
  let outFd;
  try {
    outFd = fs.openSync(backfillLog, "a");
  } catch {
    outFd = "ignore";
  }
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", outFd, outFd],
    windowsHide: true,
  });
  child.unref();
  if (typeof outFd === "number") {
    try { fs.closeSync(outFd); } catch { /* ignore */ }
  }
  appendWatchdogLog(watchdogLogPath, `[geo-watchdog] spawned: node ${args.join(" ")} (pid ${child.pid})\n`);
  return child.pid;
}

function killPids(pids, watchdogLogPath) {
  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore", windowsHide: true });
      } else {
        process.kill(pid, "SIGTERM");
      }
      appendWatchdogLog(watchdogLogPath, `[geo-watchdog] killed pid ${pid}\n`);
    } catch { /* already dead */ }
  }
}

function parseLogProgress(logPath) {
  if (!logPath || !fs.existsSync(logPath)) {
    return { indexedLines: 0, finished: false, summary: null, mtimeMs: 0 };
  }
  const stat = fs.statSync(logPath);
  const content = fs.readFileSync(logPath, "utf8");
  const indexedLines = (content.match(/\[geo-backfill\]\s+\+/g) || []).length;
  const summaryMatch = content.match(/\[geo-backfill\] Heathrow Area: indexed=(\d+)\/(\d+)/);
  const finished = /totalIndexed":\s*\d+/.test(content.slice(-4000))
    || (summaryMatch && Number(summaryMatch[1]) >= Number(summaryMatch[2]));
  return {
    indexedLines,
    finished,
    summary: summaryMatch ? `${summaryMatch[1]}/${summaryMatch[2]}` : null,
    mtimeMs: stat.mtimeMs,
  };
}

async function countHeathrowIndexed(db, city) {
  const zone = getCuratedNeighborhoodFence(city, "Heathrow") || getCuratedNeighborhoodFence(city, "Heathrow Area");
  if (!zone) return { zoneCount: 0, quota: 50, minTarget: 40, zone: null };
  const { data, error } = await db
    .from("v2_hotels_cache")
    .select("hotel_id, lat, lng")
    .eq("city", city)
    .not("lat", "is", null)
    .not("lng", "is", null);
  if (error) throw new Error(error.message);
  const zoneCount = (data || []).filter((h) => isInGeoZone(h.lat, h.lng, zone)).length;
  return {
    zoneCount,
    quota: zone.geoQuota || 50,
    minTarget: zone.minIndexedHotels || 40,
    zone,
  };
}

/**
 * @param {string} city
 * @param {{ logPath: string, statePath: string }} paths
 */
async function snapshot(city, paths = {}) {
  const logPath = paths.logPath || path.join(process.cwd(), "logs", "london-heathrow-geo-backfill.log");
  const db = getDb();
  const { zoneCount, quota, minTarget } = await countHeathrowIndexed(db, city);
  const { count: londonHotels } = await db
    .from("v2_hotels_cache")
    .select("*", { count: "exact", head: true })
    .eq("city", city);
  const log = parseLogProgress(logPath);
  const pids = findGeoBackfillPids(city);
  const zones = listGeoQuotaFences(city);

  return {
    ts: new Date().toISOString(),
    city,
    heathrow: {
      indexed: zoneCount,
      quota,
      minTarget,
      pct: quota ? Math.round((zoneCount / quota) * 100) : null,
    },
    london_hotels: londonHotels ?? 0,
    log: {
      path: logPath,
      indexed_lines: log.indexedLines,
      summary: log.summary,
      finished: log.finished,
      mtime_ms: log.mtimeMs,
      age_min: log.mtimeMs ? Math.round((Date.now() - log.mtimeMs) / 60000) : null,
    },
    process: {
      running: pids.length > 0,
      pids,
      /** Log updated in last 3m — backfill likely alive (PowerShell tee hides node cmdline). */
      log_active: log.mtimeMs != null && Date.now() - log.mtimeMs < 3 * 60 * 1000,
    },
    geo_zones: zones.map((z) => z.hoodName),
  };
}

function formatReport(s, actions = []) {
  const lines = [
    `\n=== ${s.ts} ===`,
    `HEATHROW: ${s.heathrow.indexed}/${s.heathrow.quota} (${s.heathrow.pct}%) | min=${s.heathrow.minTarget}`,
    `LONDON v2_hotels_cache: ${s.london_hotels}`,
    `PROCESS: ${s.process.running ? `running pid(s) ${s.process.pids.join(",")}` : s.process.log_active ? "active (log writing)" : "not running"}`,
    `LOG: +${s.log.indexed_lines} hotels${s.log.summary ? ` | summary ${s.log.summary}` : ""}${s.log.finished ? " | FINISHED" : ""}`,
    s.log.age_min != null ? `  log age: ${s.log.age_min}m` : "",
    ...actions.map((a) => `  >>> ${a}`),
  ].filter(Boolean);
  return lines.join("\n");
}

async function runPostComplete(city, watchdogLogPath) {
  const steps = [
    ["scripts/city-launch.js", `--city=${city}`, "--phase=repair-fences"],
    ["scripts/city-launch.js", `--city=${city}`, "--phase=rebuild-search"],
  ];
  for (const args of steps) {
    appendWatchdogLog(watchdogLogPath, `[geo-watchdog] post-complete: node ${args.join(" ")}\n`);
    execSync(`${process.execPath} ${args.map((a) => `"${a}"`).join(" ")}`, {
      cwd: process.cwd(),
      stdio: "inherit",
      windowsHide: true,
    });
  }
}

/**
 * @returns {Promise<string[]>}
 */
async function checkAndFix(s, { city, logPath, statePath, watchdogLogPath, autoFix = true }) {
  if (!autoFix) return [];
  const actionLog = watchdogLogPath || statePath.replace(/\.state\.json$/, "-actions.log");
  const state = loadState(statePath);
  const now = Date.now();
  const actions = [];
  const { indexed, quota, minTarget } = s.heathrow;
  const targetMet = indexed >= quota || indexed >= minTarget;
  const logDone = s.log.finished && !s.process.running && !s.process.log_active;
  const backfillActive = s.process.running || s.process.log_active;

  if (state.lastZoneCount !== indexed) {
    state.lastZoneCount = indexed;
    state.lastZoneChangeAt = now;
    saveState(statePath, state);
  }

  if ((targetMet || logDone) && !state.postCompleteDone) {
    if (backfillActive) {
      return actions;
    }
    actions.push(`POST-COMPLETE: heathrow=${indexed}/${quota} — repair-fences + rebuild-search`);
    await runPostComplete(city, actionLog);
    state.postCompleteDone = true;
    state.lastFixAt = now;
    saveState(statePath, state);
    return actions;
  }

  if (state.postCompleteDone || targetMet) {
    return actions;
  }

  const staleLog = backfillActive
    && s.log.age_min != null
    && s.log.age_min * 60 * 1000 > STALE_MS;
  const staleZone = backfillActive
    && state.lastZoneChangeAt
    && now - state.lastZoneChangeAt > STALE_MS;
  const crashed = !backfillActive && indexed < quota;

  if ((staleLog || staleZone || crashed) && now - state.lastRestartAt > COOLDOWN_MS) {
    if (s.process.pids.length) {
      killPids(s.process.pids, actionLog);
    }
    spawnDetached(
      ["scripts/city-launch.js", `--city=${city}`, "--phase=geo-backfill"],
      actionLog,
    );
    const reason = crashed
      ? "process not running"
      : staleZone
        ? `no new zone hotels for ${Math.round((now - state.lastZoneChangeAt) / 60000)}m`
        : `log idle ${s.log.age_min}m`;
    actions.push(`AUTO-RESTART geo-backfill (${reason}) at ${indexed}/${quota}`);
    state.lastRestartAt = now;
    state.lastFixAt = now;
    saveState(statePath, state);
  }

  return actions;
}

module.exports = {
  snapshot,
  formatReport,
  checkAndFix,
  STALE_MS,
  findGeoBackfillPids,
};
