/** Shared Playwright helpers for TravelByVibe UI tests. */

const LAUNCH_CITIES = new Set(["Mexico City", "Paris"]);

async function seedBetaConsent(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("TB_BETA_CONSENT_V1", "v1-playwright");
    } catch (_) { /* ignore */ }
  });
}

async function ensurePastSiteGate(page) {
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60_000 });
  const authForm = page.locator('form[action="/auth"]');
  const hasGate = await authForm.isVisible().catch(() => false);
  if (!hasGate) {
    await page.locator("#cityInput").first().waitFor({ state: "visible", timeout: 20_000 });
    return;
  }
  const pw = process.env.SITE_PASSWORD || process.env.PLAYWRIGHT_SITE_PASSWORD;
  if (!pw) {
    throw new Error(
      "SITE_PASSWORD required when beta gate is active (set in .env or PLAYWRIGHT_SITE_PASSWORD)."
    );
  }
  await page.locator('input[name="password"]').fill(pw);
  await Promise.all([
    page.locator("#cityInput").first().waitFor({ state: "visible", timeout: 20_000 }),
    authForm.locator('button[type="submit"]').click(),
  ]);
}

async function dismissBetaConsentIfShown(page) {
  const btn = page.getByRole("button", { name: /Sounds good/i });
  try {
    await btn.waitFor({ state: "visible", timeout: 3000 });
    await btn.click();
    await page.waitForTimeout(300);
  } catch { /* already accepted via localStorage */ }
}

async function selectCityAndGo(page, city) {
  if (!LAUNCH_CITIES.has(city)) {
    throw new Error(`"${city}" is not a launch city (only Mexico City + Paris).`);
  }
  const input = page.locator("#cityInput").first();
  await input.click();
  await input.fill("");
  await input.fill(city);
  const chip = page.locator(".city-chip", { hasText: city }).first();
  if (await chip.isVisible().catch(() => false)) {
    await chip.click();
    return;
  }
  await page.locator("#cityGoBtn").first().click();
  await page.waitForTimeout(400);
}

async function skipBoopWizard(page) {
  const onResults = await page.locator("#st-results").isVisible().catch(() => false);
  if (onResults && (await page.locator("#resultCount").textContent())?.match(/\d/)) return;

  const skipWizard = page.locator(".boop-skip-tray button", { hasText: "Skip" });
  const visible = await skipWizard.isVisible().catch(() => false);
  if (!visible) {
    // Boop may have auto-advanced or city chip put us on results already.
    await page.locator("#st-boop, #st-results").first().waitFor({ state: "visible", timeout: 15_000 });
    if (await page.locator("#st-results").isVisible()) return;
  }
  await skipWizard.waitFor({ state: "visible", timeout: 30_000 });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/vsearch") && r.ok(), { timeout: 120_000 }),
    skipWizard.click(),
  ]);
}

async function runVectorSearchQuery(page, query) {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/vsearch") && r.ok(), { timeout: 120_000 }),
    page.evaluate((q) => {
      const btn = { disabled: false, textContent: "" };
      startVectorSearch(q, S.city, btn, null);
    }, query),
  ]);
}

async function waitForSearchResults(page) {
  const { expect } = require("@playwright/test");
  await expect(page.locator("#resultCount")).toContainText(/\d/, { timeout: 60_000 });
  // Curated view hides #results .hotel-card — wait for visible sr2 cards or empty state.
  const visibleResults = page.locator(
    ".sr2-pick-card[data-hotel-id]:visible, .sr2-more-card[data-hotel-id]:visible, .results-empty-state:visible"
  );
  await expect(visibleResults.first()).toBeVisible({ timeout: 60_000 });
}

function resultCardLocator(page) {
  return page.locator(
    ".sr2-pick-card[data-hotel-id]:visible, .sr2-more-card[data-hotel-id]:visible, #results .hotel-card:visible"
  );
}

async function dismissVibeTourIfShown(page) {
  const btn = page.getByRole("button", { name: "Continue to hotel list" });
  try {
    await btn.waitFor({ state: "visible", timeout: 8000 });
    await btn.click();
  } catch { /* no tour */ }
}

function isLaunchCity(city) {
  return LAUNCH_CITIES.has(city);
}

/** ISO check-in / check-out at least 2 nights apart (picker rule: co >= ci + 2 days). */
function futureTravelDates(checkinOffsetDays = 18, nights = 3) {
  const ci = new Date();
  ci.setDate(ci.getDate() + checkinOffsetDays);
  const co = new Date(ci);
  co.setDate(co.getDate() + Math.max(nights, 2));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { checkin: fmt(ci), checkout: fmt(co) };
}

async function setTravelDates(page, checkin, checkout) {
  await page.evaluate(({ checkin, checkout }) => {
    for (const id of ["city-d-ci", "d-ci", "ct-ci"]) {
      const el = document.getElementById(id);
      if (el) el.value = checkin;
    }
    for (const id of ["city-d-co", "d-co", "ct-co"]) {
      const el = document.getElementById(id);
      if (el) el.value = checkout;
    }
    onCityDatesChanged();
  }, { checkin, checkout });
}

/**
 * Click through Boop Q1–Q4 via in-page handlers (faster + more stable than card clicks).
 * Returns parsed /api/vsearch JSON.
 */
async function completeBoopWizard(page, answers = {}, options = {}) {
  const {
    dealbreakers = [],
    priceMatters = 0,
    group_size = "couple",
  } = options;

  await page.locator("#boop-wrap, #st-boop").first().waitFor({ state: "visible", timeout: 45_000 });

  const vsearchWait = page.waitForResponse(
    (r) => r.url().includes("/api/vsearch") && r.ok(),
    { timeout: 180_000 }
  );

  await page.evaluate(({ answers, dealbreakers, priceMatters, group_size }) => {
    BOOP.idx = 0;
    BOOP.dealbreakers = new Set();
    BOOP.answers = { group_size, priceMatters: Number(priceMatters) || 0 };
    renderBoopQuestion();
    boopChoose("trip", answers.trip || "repeat");
    boopChoose("stayVibe", answers.stayVibe || "sleek_polished");
    boopChoose("nbhdScene", answers.nbhdScene || "hip_local");
    for (const d of dealbreakers) boopToggleDealbreaker(d);
    boopFinish();
  }, { answers, dealbreakers, priceMatters, group_size });

  const resp = await vsearchWait;
  const data = await resp.json();
  await dismissVibeTourIfShown(page);
  await waitForSearchResults(page);
  return data;
}

async function waitForRatesLoaded(page, timeoutMs = 120_000) {
  await page.waitForFunction(
    () => window.RoomMatchResultsBridge?.getSearchUiState()?.pricesLoaded === true,
    null,
    { timeout: timeoutMs }
  );
}

async function openFullResultsList(page) {
  const seeAll = page.getByRole("button", { name: /See all/i }).first();
  if (await seeAll.isVisible().catch(() => false)) {
    await seeAll.click();
  }
  await page.locator("#results .hotel-card, #results .hotel-row").first().waitFor({
    state: "visible",
    timeout: 45_000,
  });
}

async function clickSortBy(page, sortKey) {
  const desktop = page.locator(`.sort-group--desktop .sort-btn[data-sort="${sortKey}"]`);
  if (await desktop.isVisible().catch(() => false)) {
    await desktop.click();
  } else {
    if (sortKey === "rating" || sortKey === "stars") {
      await page.locator("#sortMoreTrigger").click();
    }
    await page.locator(`.sort-btn[data-sort="${sortKey}"]`).first().click();
  }
  await page.waitForFunction(() => {
    const sr = document.getElementById("st-results");
    return sr && !sr.classList.contains("results-pending");
  }, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function getVisibleFullListHotelIds(page, limit = 15) {
  return page.evaluate((limit) => {
    const cards = [...document.querySelectorAll("#results .hotel-card")];
    return cards.slice(0, limit).map((c) => c.id.replace(/^hotel-card-/, ""));
  }, limit);
}

async function getBridgeHotelsSnapshot(page) {
  return page.evaluate(() => {
    const bridge = window.RoomMatchResultsBridge;
    if (!bridge) return null;
    const ui = bridge.getSearchUiState();
    const hotels = bridge.getLastHotels() || [];
    const sorted = bridge.getSortedHotelsForDisplay() || [];
    return {
      ui,
      hotels: hotels.slice(0, 50).map((h) => ({
        id: String(h.id),
        vectorScore: h.vectorScore,
        hotelScore: h.hotelScore,
        nbhd_fit_pct: h.nbhd_fit_pct,
        price: h.price,
        rating: h.rating ?? h.guestRating,
        starRating: h.starRating,
        roomTypes: (h.roomTypes || []).length,
      })),
      sortedIds: sorted.slice(0, 20).map((h) => String(h.id)),
      displayScores: sorted.slice(0, 10).map((h) => ({
        id: String(h.id),
        overall: bridge.overallMatchDisplayPct(h),
        room: bridge.roomVibeMatchDisplayPct(h),
      })),
    };
  });
}

async function getVisibleHotelPrices(page, limit = 12) {
  return page.evaluate((limit) => {
    const cards = [...document.querySelectorAll("#results .hotel-card")].slice(0, limit);
    return cards.map((c) => {
      const id = c.id.replace(/^hotel-card-/, "");
      const text = document.getElementById(`hotel-price-${id}`)?.textContent || "";
      const m = text.match(/\$([\d,]+(?:\.\d+)?)/);
      return { id, price: m ? Number(m[1].replace(/,/g, "")) : null };
    });
  }, limit);
}

async function auditVsearchApiPayload(data, topN = 50, profile = null) {
  const { auditVsearchHotels, formatAuditFailures } = require("../lib/v2-server-rank");
  const audit = auditVsearchHotels(data, topN, profile);
  return { audit, failures: formatAuditFailures(audit, data.stats || {}) };
}

async function auditCuratedTopPicks(page) {
  const { expect } = require("@playwright/test");
  const findings = [];
  const pickCount = await page.locator(".sr2-pick-card[data-hotel-id]:visible").count();
  if (pickCount < 3) findings.push(`sr2_picks_sparse:${pickCount}`);

  const badges = page.locator(".sr2-pick-card:visible .sr2-pick-ring, .sr2-more-card:visible .match-bubble");
  const n = await badges.count();
  for (let i = 0; i < Math.min(n, 8); i++) {
    const t = ((await badges.nth(i).textContent()) || "").trim();
    if (!/\d/.test(t)) findings.push(`pick_badge_missing_pct:#${i}`);
  }

  await expect(page.locator("#sortBar")).toBeVisible();
  if (!(await page.locator("#resultCount").textContent())?.match(/\d/)) {
    findings.push("missing_result_count");
  }
  return findings;
}

async function auditHotelDetailPage(page) {
  const { expect } = require("@playwright/test");
  const findings = [];
  await expect(page.locator("#st-hotel-detail")).toBeVisible({ timeout: 25_000 });
  await expect(page.locator("body")).toHaveClass(/has-hotel-detail/);
  await page.locator("#st-hotel-detail .hp-name, #st-hotel-detail h1").first().waitFor({ state: "visible", timeout: 15_000 });

  const name = (await page.locator("#st-hotel-detail .hp-name, #st-hotel-detail h1").first().textContent())?.trim();
  if (!name || name === "Hotel" || name.length < 3) findings.push(`detail_weak_name:${name || "empty"}`);

  const hero = page.locator("#st-hotel-detail .hp-carousel img").first();
  if (await hero.count()) {
    const src = await hero.getAttribute("src");
    if (!src || /^data:/.test(src)) findings.push("detail_bad_hero_src");
  } else {
    findings.push("detail_no_hero_img");
  }

  const book = page
    .locator("#st-hotel-detail")
    .locator('a, button')
    .filter({ hasText: /Book/i })
    .first();
  if (!(await book.isVisible().catch(() => false))) {
    findings.push("detail_missing_book_cta");
  } else {
    const href = await book.getAttribute("href");
    const tag = await book.evaluate((el) => el.tagName.toLowerCase());
    if (tag === "a" && (!href || href === "#")) findings.push("detail_book_href_empty");
  }

  return findings;
}

async function closeHotelDetailPage(page) {
  const back = page.locator(".hpage-topbar button").first();
  if (await back.isVisible().catch(() => false)) {
    await back.click();
  } else {
    await page.goBack();
  }
  await page.locator("#st-results").waitFor({ state: "visible", timeout: 20_000 });
}

module.exports = {
  LAUNCH_CITIES,
  isLaunchCity,
  futureTravelDates,
  seedBetaConsent,
  ensurePastSiteGate,
  dismissBetaConsentIfShown,
  selectCityAndGo,
  setTravelDates,
  skipBoopWizard,
  completeBoopWizard,
  runVectorSearchQuery,
  waitForSearchResults,
  waitForRatesLoaded,
  openFullResultsList,
  clickSortBy,
  getVisibleFullListHotelIds,
  getBridgeHotelsSnapshot,
  getVisibleHotelPrices,
  auditVsearchApiPayload,
  auditCuratedTopPicks,
  auditHotelDetailPage,
  closeHotelDetailPage,
  resultCardLocator,
  dismissVibeTourIfShown,
};
