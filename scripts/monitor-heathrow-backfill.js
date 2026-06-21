#!/usr/bin/env node
/**
 * Poll Heathrow geo-backfill every 5m; auto-restart on stall; post-steps when done.
 *
 *   node scripts/monitor-heathrow-backfill.js
 *   node scripts/monitor-heathrow-backfill.js --once
 *   node scripts/monitor-heathrow-backfill.js --no-auto-fix
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { snapshot, formatReport, checkAndFix } = require("./geo-backfill-watchdog");

const CITY = "London";
const INTERVAL_MIN = Number((process.argv.find((a) => a.startsWith("--interval=")) || "").split("=")[1]) || 5;
const ONCE = process.argv.includes("--once");
const AUTO_FIX = !process.argv.includes("--no-auto-fix");
const LOG_PATH = path.join(process.cwd(), "logs", "heathrow-backfill-monitor.log");
const BACKFILL_LOG = path.join(process.cwd(), "logs", "london-heathrow-geo-backfill.log");
const STATE_PATH = path.join(process.cwd(), "logs", "heathrow-backfill-watchdog.state.json");
const WATCHDOG_ACTIONS_LOG = path.join(process.cwd(), "logs", "heathrow-backfill-watchdog-actions.log");

async function tick() {
  const s = await snapshot(CITY, { logPath: BACKFILL_LOG });
  const actions = await checkAndFix(s, {
    city: CITY,
    logPath: BACKFILL_LOG,
    statePath: STATE_PATH,
    watchdogLogPath: WATCHDOG_ACTIONS_LOG,
    autoFix: AUTO_FIX && !ONCE,
  });
  const report = formatReport(s, actions);
  console.log(report);
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, report + "\n");
  return s;
}

async function main() {
  const mode = AUTO_FIX && !ONCE ? "auto-fix ON" : "observe only";
  console.log(`Monitoring Heathrow geo-backfill every ${INTERVAL_MIN}m (${mode})`);
  console.log(`  backfill log: ${BACKFILL_LOG}`);
  console.log(`  monitor log: ${LOG_PATH}\n`);
  await tick();
  if (ONCE) return;
  for (;;) {
    await new Promise((r) => setTimeout(r, INTERVAL_MIN * 60 * 1000));
    await tick();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
