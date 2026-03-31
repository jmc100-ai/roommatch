const { test, expect } = require("@playwright/test");
const {
  SEARCH_TESTS,
  getExpectedHotelCount,
  parseResultCount,
} = require("../scripts/search-test-lib");

const UI_TESTS = SEARCH_TESTS;

async function runSearch(page, query, city) {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.locator("#queryInput").fill(query);
  await page.locator("#cityInput").fill(city);

  const cityOptions = page.locator("#cityDropdown .city-option");
  await expect(cityOptions.first()).toBeVisible();
  await cityOptions.first().click();

  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/vsearch") && response.ok()),
    page.locator("#searchBtn").click(),
  ]);

  const resultCount = page.locator("#resultCount");
  await expect(resultCount).not.toHaveText(/^\s*$/);
  await expect(page.locator("#results .hotel-card").first()).toBeVisible();
}

async function topHotels(page, limit = 3) {
  const cards = page.locator("#results .hotel-card");
  const count = await cards.count();
  const top = [];

  for (let i = 0; i < Math.min(limit, count); i++) {
    const card = cards.nth(i);
    const name = (await card.locator(".hotel-name").textContent())?.trim() || "(missing name)";
    const matchText = ((await card.locator(".hotel-match-badge").first().textContent().catch(() => "")) || "").trim();
    top.push({ name, matchText });
  }

  return top;
}

for (const searchTest of UI_TESTS) {
  test(`UI search matches DB count for "${searchTest.query}" in ${searchTest.city}`, async ({ page }, testInfo) => {
    const expectedHotels = await getExpectedHotelCount(searchTest);

    await runSearch(page, searchTest.query, searchTest.city);

    const resultCountText = await page.locator("#resultCount").textContent();
    const actualHotels = parseResultCount(resultCountText);
    const top3 = await topHotels(page, 3);

    expect(actualHotels, `Unexpected result count text: ${resultCountText}`).not.toBeNull();
    expect(actualHotels).toBe(expectedHotels);

    const screenshotPath = testInfo.outputPath(`search-${searchTest.id}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach("results-screenshot", {
      path: screenshotPath,
      contentType: "image/png",
    });
    await testInfo.attach("results-summary", {
      body: JSON.stringify({
        query: searchTest.query,
        city: searchTest.city,
        expectedHotels,
        actualHotels,
        resultCountText,
        top3,
      }, null, 2),
      contentType: "application/json",
    });

    console.log(`[ui] "${searchTest.query}" in ${searchTest.city}: expected ${expectedHotels}, got ${actualHotels}`);
    top3.forEach((hotel, index) => {
      console.log(`  ${index + 1}. ${hotel.name} ${hotel.matchText}`.trim());
    });
  });
}
