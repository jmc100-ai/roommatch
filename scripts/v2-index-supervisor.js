/**
 * Auto-resume V2 city reindex on Render when jobs stall, fail with a duplicate-start
 * race, or the instance restarts mid-run. Keeps Paris (etc.) moving without manual polls.
 */
const STALE_MS = Math.max(60_000, Number(process.env.V2_SUPERVISOR_STALE_MS) || 12 * 60 * 1000);
const TICK_MS = Math.max(60_000, Number(process.env.V2_SUPERVISOR_INTERVAL_MS) || 5 * 60 * 1000);
const BOOT_DELAY_MS = Math.max(5000, Number(process.env.V2_SUPERVISOR_BOOT_DELAY_MS) || 45_000);

function parseCities() {
  const raw = process.env.V2_SUPERVISOR_CITIES || "Paris";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function isBenignFailed(lastError) {
  return /already running/i.test(String(lastError || ""));
}

function catalogIncomplete(row) {
  const prog = row?.index_progress;
  if (!prog || prog.catalog_limit == null) return true;
  const scanned = Number(prog.catalog_scanned) || 0;
  const limit = Number(prog.catalog_limit) || 0;
  return limit > 0 && scanned < limit;
}

function isStaleRow(row) {
  if (!row?.updated_at) return true;
  return Date.now() - new Date(row.updated_at).getTime() > STALE_MS;
}

function shouldAutoResume(row) {
  if (!row) return false;
  if (row.status === "complete") return false;
  if (row.status === "indexing") {
    return isStaleRow(row) && catalogIncomplete(row);
  }
  if (row.status === "failed") {
    if (isBenignFailed(row.last_error)) return catalogIncomplete(row);
    return isStaleRow(row) && catalogIncomplete(row);
  }
  return false;
}

async function getCatalogLimit(city, core) {
  const cc = core.countryCode(city);
  const total = await core.liteCatalogTotal(
    city,
    cc,
    process.env.LITEAPI_PROD_KEY || process.env.LITEAPI_KEY,
  );
  return total + 50;
}

/**
 * @param {object} opts
 * @param {import('@supabase/supabase-js').SupabaseClient} opts.db
 * @param {function} opts.reindexFn
 * @param {function} opts.isReindexActive - (city) => boolean
 * @param {function} opts.isRolloutActive - (city) => boolean
 * @param {object} opts.rolloutCore - v2-city-rollout-core module
 */
function startV2IndexSupervisor(opts) {
  const { db, reindexFn, isReindexActive, isRolloutActive, rolloutCore } = opts;
  if (!db) {
    console.warn("[v2-supervisor] disabled — no Supabase admin client");
    return;
  }
  if (process.env.V2_INDEX_SUPERVISOR === "0") {
    console.log("[v2-supervisor] disabled (V2_INDEX_SUPERVISOR=0)");
    return;
  }

  const cities = parseCities();
  console.log(
    `[v2-supervisor] enabled cities=${cities.join(", ")} tick=${Math.round(TICK_MS / 60000)}m stale=${Math.round(STALE_MS / 60000)}m`,
  );

  async function tick() {
    for (const city of cities) {
      try {
        if (isReindexActive(city) || isRolloutActive(city)) continue;

        const { data: row } = await db
          .from("v2_indexed_cities")
          .select("status, last_error, index_progress, updated_at")
          .eq("city", city)
          .maybeSingle();

        if (!shouldAutoResume(row)) continue;

        const limit = await getCatalogLimit(city, rolloutCore);
        await db.from("v2_indexed_cities").update({
          status: "indexing",
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq("city", city);

        console.log(
          `[v2-supervisor] auto-resume ${city} (was ${row?.status}, ` +
          `scanned=${row?.index_progress?.catalog_scanned ?? "?"}/${row?.index_progress?.catalog_limit ?? limit})`,
        );

        reindexFn(city, limit, false)
          .then((r) => console.log(`[v2-supervisor] ${city} reindex finished:`, r?.totalHotels ?? r))
          .catch((e) => {
            if (/already running/i.test(e.message)) return;
            console.error(`[v2-supervisor] ${city} reindex error:`, e.message);
          });
      } catch (e) {
        console.warn(`[v2-supervisor] tick error ${city}:`, e.message);
      }
    }
  }

  setTimeout(() => {
    tick().catch((e) => console.warn("[v2-supervisor] boot tick:", e.message));
  }, BOOT_DELAY_MS);
  setInterval(() => {
    tick().catch((e) => console.warn("[v2-supervisor] tick:", e.message));
  }, TICK_MS);
}

module.exports = { startV2IndexSupervisor, shouldAutoResume, isBenignFailed };
