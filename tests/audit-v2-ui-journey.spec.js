/**
 * V2 UI journey audit — results cards, sorts, detail pages, client timings.
 *
 *   npx playwright test tests/audit-v2-ui-journey.spec.js --workers=1
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { test, expect } = require("@playwright/test");
const {
  seedBetaConsent,
  ensurePastSiteGate,
  dismissBetaConsentIfShown,
  selectCityAndGo,
  skipBoopWizard,
  runVectorSearchQuery,
  waitForSearchResults,
  resultCardLocator,
  dismissVibeTourIfShown,
} = require("./playwright-helpers");

const UI_SCENARIOS = [
  { id: "mx_sleek", city: "Mexico City", query: "sleek modern minimalist room clean lines" },
  { id: "mx_cozy", city: "Mexico City", query: "cozy warm traditional room soft textiles" },
  { id: "mx_balcony", city: "Mexico City", query: "room with private balcony city view" },
  { id: "paris_sleek", city: "Paris", query: "sleek polished contemporary luxury room" },
  { id: "paris_artdeco", city: "Paris", query: "art deco style room ornate elegant" },
];

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  await seedBetaConsent(page);
});

async function runSearchUI(page, scenario) {
  await ensurePastSiteGate(page);
  await dismissBetaConsentIfShown(page);
  await selectCityAndGo(page, scenario.city);

  const t0 = Date.now();
  await skipBoopWizard(page);
  let vsearchMs = Date.now() - t0;
  await dismissVibeTourIfShown(page);

  if (scenario.query) {
    const t1 = Date.now();
    await runVectorSearchQuery(page, scenario.query);
    await dismissVibeTourIfShown(page);
    vsearchMs = Date.now() - t1;
  }

  await waitForSearchResults(page);
  return { vsearchMs };
}

for (const sc of UI_SCENARIOS) {
  test(`UI journey: ${sc.id}`, async ({ page }, testInfo) => {
    const timings = await runSearchUI(page, sc);
    const findings = [];

    const isEmpty = await page.locator(".results-empty-state").isVisible().catch(() => false);
    const cardCount = await resultCardLocator(page).count();
    const resultCountText = await page.locator("#resultCount").textContent();

    if (!resultCountText?.match(/\d/)) findings.push("missing_result_count");
    if (!isEmpty && cardCount < 1) findings.push("no_hotel_cards");

    if (!isEmpty && cardCount > 0) {
      const firstCard = resultCardLocator(page).first();
      const name = (await firstCard.locator(".sr2-pick-name, .sr2-more-name, .hotel-name").first().textContent())?.trim();
      if (!name || name === "Hotel" || name.length < 3) findings.push(`weak_name:${name || "empty"}`);

      const badge = ((await firstCard.locator(".match-bubble, .hotel-match-badge").first().textContent().catch(() => "")) || "").trim();
      if (!/\d/.test(badge)) findings.push("missing_match_badge");

      const seeAll = page.locator('button:has-text("See all")').first();
      if (await seeAll.isVisible().catch(() => false)) {
        await seeAll.click();
        await page.locator("#results .hotel-card, .hotel-details-btn").first().waitFor({ state: "visible", timeout: 30_000 });
      }

      const detailsBtn = page.locator(".hotel-details-btn, button:has-text('Full hotel details')").first();
      if (await detailsBtn.isVisible().catch(() => false)) {
        const tDet = Date.now();
        const detailResp = page.waitForResponse((r) => r.url().includes("/api/hotel/") && r.ok(), { timeout: 45_000 });
        await detailsBtn.click();
        await detailResp;
        timings.detailMs = Date.now() - tDet;
        await expect(page.locator("#st-hotel-detail")).toBeVisible({ timeout: 20_000 });
        const hpName = (await page.locator("#st-hotel-detail .hp-name, #st-hotel-detail h1").first().textContent())?.trim();
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
