/**
 * V2 UI journey audit — results cards, sorts, detail pages, client timings.
 *
 *   npx playwright test tests/audit-v2-ui-journey.spec.js --workers=1
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { test, expect } = require("@playwright/test");

const BASE = (process.env.PLAYWRIGHT_BASE_URL || "https://www.travelbyvibe.com").replace(/\/$/, "");

const UI_SCENARIOS = [
  { id: "mx_sleek", city: "Mexico City", query: "sleek modern minimalist room clean lines", dates: ["2026-07-10", "2026-07-14"] },
  { id: "mx_cozy", city: "Mexico City", query: "cozy warm traditional room soft textiles", dates: null },
  { id: "mx_balcony", city: "Mexico City", query: "room with private balcony city view", dates: ["2026-08-01", "2026-08-04"] },
  { id: "paris_sleek", city: "Paris", query: "sleek polished contemporary luxury room", dates: ["2026-09-12", "2026-09-16"] },
  { id: "paris_artdeco", city: "Paris", query: "art deco style room ornate elegant", dates: null },
];

async function ensurePastSiteGate(page) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const authForm = page.locator('form[action="/auth"]');
  if (await authForm.isVisible().catch(() => false)) {
    const pw = process.env.SITE_PASSWORD || process.env.PLAYWRIGHT_SITE_PASSWORD;
    if (!pw) throw new Error("SITE_PASSWORD required for gated site");
    await page.locator('input[name="password"]').fill(pw);
    await Promise.all([
      page.waitForSelector("#cityInput", { state: "visible", timeout: 30000 }),
      authForm.locator('button[type="submit"]').click(),
    ]);
  }
}

async function dismissBetaConsentIfShown(page) {
  const btn = page.getByRole("button", { name: /Sounds good/i });
  try {
    await btn.waitFor({ state: "visible", timeout: 4000 });
    await btn.click();
    await page.waitForTimeout(300);
  } catch { /* already accepted or no modal */ }
}

async function dismissVibeTourIfShown(page) {
  const btn = page.getByRole("button", { name: "Continue to hotel list" });
  try {
    await btn.waitFor({ state: "visible", timeout: 35000 });
    await btn.click();
  } catch { /* no tour */ }
}

async function selectCityAndGo(page, city) {
  const input = page.locator("#cityInput").first();
  await input.click();
  await input.fill("");
  await input.fill(city);
  await page.waitForTimeout(600);
  const opt = page.locator("#cityDropdown .city-option").first();
  try {
    await opt.waitFor({ state: "visible", timeout: 12000 });
    await opt.click();
    return;
  } catch { /* fallback */ }
  const goBtn = page.locator("button", { hasText: "Go" }).first();
  await goBtn.click();
}

async function runSearchUI(page, scenario) {
  await ensurePastSiteGate(page);
  await dismissBetaConsentIfShown(page);
  await selectCityAndGo(page, scenario.city);

  const skipWizard = page.locator(".boop-skip-tray button", { hasText: "Skip" });
  await expect(skipWizard).toBeVisible({ timeout: 30000 });

  const t0 = Date.now();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/vsearch") && r.ok(), { timeout: 120000 }),
    skipWizard.click(),
  ]);
  let vsearchMs = Date.now() - t0;

  await dismissVibeTourIfShown(page);

  if (scenario.query) {
    await expect(page.locator("#cmd-q")).toBeVisible({ timeout: 30000 });
    await page.locator("#cmd-q").fill(scenario.query);
    const t1 = Date.now();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/vsearch") && r.ok(), { timeout: 120000 }),
      page.locator(".cmd-go").click(),
    ]);
    await dismissVibeTourIfShown(page);
    vsearchMs = Date.now() - t1;
  }

  return { vsearchMs };
}

for (const sc of UI_SCENARIOS) {
  test(`UI journey: ${sc.id}`, async ({ page }, testInfo) => {
    const timings = await runSearchUI(page, sc);
    const tCards = Date.now();
    const card = page.locator("#results .hotel-card, .results-empty-state").first();
    await expect(card).toBeVisible({ timeout: 90000 });
    timings.firstCardMs = Date.now() - tCards + timings.vsearchMs;

    const findings = [];
    const isEmpty = await page.locator(".results-empty-state").isVisible().catch(() => false);
    const cardCount = await page.locator("#results .hotel-card").count();
    const resultCountText = await page.locator("#resultCount").textContent();

    if (!resultCountText?.match(/\d/)) findings.push("missing_result_count");

    if (!isEmpty) {
      if (cardCount < 1) findings.push("no_hotel_cards");
      const firstCard = page.locator("#results .hotel-card").first();
      const name = (await firstCard.locator(".hotel-name, [id^='hotel-name-']").first().textContent())?.trim();
      if (!name || name === "Hotel" || name.length < 3) findings.push(`weak_name:${name || "empty"}`);

      const badge = ((await firstCard.locator(".hotel-match-badge").first().textContent().catch(() => "")) || "").trim();
      if (!/\d/.test(badge)) findings.push("missing_match_badge");

      const detailsBtn = firstCard.locator(".hotel-details-btn").first();
      if (await detailsBtn.isVisible().catch(() => false)) {
        const tDet = Date.now();
        const detailResp = page.waitForResponse((r) => r.url().includes("/api/hotel/") && r.ok(), { timeout: 45000 });
        await detailsBtn.click();
        await detailResp;
        timings.detailMs = Date.now() - tDet;
        await expect(page.locator(".hpage, #st-hotel-detail")).toBeVisible({ timeout: 20000 });
        const hpName = (await page.locator(".hpage .hp-name, .hpage h1").first().textContent())?.trim();
        if (!hpName) findings.push("detail_missing_name");
        await page.locator(".hpage-topbar button").first().click().catch(() => page.goBack());
      }
    }

    await testInfo.attach("ui-audit", {
      body: JSON.stringify({ scenario: sc, timings, findings, resultCountText, cardCount, isEmpty }, null, 2),
      contentType: "application/json",
    });

    console.log(`[ui] ${sc.id}: vsearch=${timings.vsearchMs}ms cards=${cardCount} empty=${isEmpty} findings=${findings.length}`);
    expect(findings, findings.join("; ")).toEqual([]);
  });
}
