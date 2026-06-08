const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { test, expect } = require("@playwright/test");
const {
  SEARCH_TESTS,
  getExpectedHotelCount,
  parseResultCount,
} = require("../scripts/search-test-lib");
const {
  seedBetaConsent,
  ensurePastSiteGate,
  selectCityAndGo,
  skipBoopWizard,
  runVectorSearchQuery,
  waitForSearchResults,
  resultCardLocator,
  dismissVibeTourIfShown,
  isLaunchCity,
} = require("./playwright-helpers");

const UI_TESTS = SEARCH_TESTS;

test.beforeEach(async ({ page }) => {
  test.setTimeout(180_000);
  await seedBetaConsent(page);
});

async function runSearch(page, query, city) {
  await ensurePastSiteGate(page);
  await selectCityAndGo(page, city);
  await skipBoopWizard(page);
  await dismissVibeTourIfShown(page);
  await runVectorSearchQuery(page, query);
  await dismissVibeTourIfShown(page);
  await waitForSearchResults(page);
}

async function topHotels(page, limit = 3) {
  const cards = resultCardLocator(page);
  const count = await cards.count();
  const top = [];

  for (let i = 0; i < Math.min(limit, count); i++) {
    const card = cards.nth(i);
    const name = (await card.locator(".sr2-pick-name, .sr2-more-name, .hotel-name").first().textContent())?.trim() || "(missing name)";
    const matchText = ((await card.locator(".sr2-pick-ring, .match-bubble, .hotel-match-badge").first().textContent().catch(() => "")) || "").trim();
    top.push({ name, matchText });
  }

  return top;
}

for (const searchTest of UI_TESTS) {
  const isV2 = (searchTest.source || "v1") === "v2";
  const minHotels = typeof searchTest.minHotels === "number" ? searchTest.minHotels : 1;
  const launchOk = isLaunchCity(searchTest.city);

  (launchOk ? test : test.skip)(
    `UI search for "${searchTest.query}" in ${searchTest.city}`,
    async ({ page }, testInfo) => {
      const expectedHotels = await getExpectedHotelCount(searchTest);

      await runSearch(page, searchTest.query, searchTest.city);

      const resultCountText = await page.locator("#resultCount").textContent();
      const actualHotels = parseResultCount(resultCountText);
      const top3 = await topHotels(page, 3);

      expect(actualHotels, `Unexpected result count text: ${resultCountText}`).not.toBeNull();
      if (isV2) {
        expect(actualHotels).toBeGreaterThanOrEqual(minHotels);
      } else {
        expect(actualHotels).toBe(expectedHotels);
      }

      const screenshotPath = testInfo.outputPath(`search-${searchTest.id}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      await testInfo.attach("results-summary", {
        body: JSON.stringify({
          query: searchTest.query,
          city: searchTest.city,
          expectedHotels,
          actualHotels,
          resultCountText,
          top3,
          isV2,
        }, null, 2),
        contentType: "application/json",
      });

      console.log(`[ui] "${searchTest.query}" in ${searchTest.city}: expected ${isV2 ? `>=${minHotels}` : expectedHotels}, got ${actualHotels}`);
    }
  );
}
