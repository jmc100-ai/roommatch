const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { test, expect } = require("@playwright/test");
const {
  SEARCH_TESTS,
  getExpectedHotelCount,
  parseResultCount,
} = require("../scripts/search-test-lib");

const UI_TESTS = SEARCH_TESTS;

/** When SITE_PASSWORD is set, GET / is a login form until POST /auth succeeds. */
async function ensurePastSiteGate(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const authForm = page.locator('form[action="/auth"]');
  const hasGate = await authForm.isVisible().catch(() => false);
  if (!hasGate) {
    await expect(page.locator("#cityInput")).toBeVisible({ timeout: 15_000 });
    return;
  }
  const pw = process.env.SITE_PASSWORD || process.env.PLAYWRIGHT_SITE_PASSWORD;
  if (!pw) {
    throw new Error(
      "Server is using SITE_PASSWORD; set SITE_PASSWORD in .env (or PLAYWRIGHT_SITE_PASSWORD) so UI tests can sign in."
    );
  }
  await page.locator('input[name="password"]').fill(pw);
  await Promise.all([
    page.waitForSelector("#cityInput", { state: "visible", timeout: 20_000 }),
    authForm.locator('button[type="submit"]').click(),
  ]);
}

/** After Boop skip, first vsearch may open the vibe tour before hotel cards render. */
async function dismissVibeTourIfShown(page) {
  const continueBtn = page.getByRole("button", { name: "Continue to hotel list" });
  try {
    await continueBtn.waitFor({ state: "visible", timeout: 45_000 });
    await continueBtn.click();
  } catch {
    // No tour (or Street View slow-failed) — results may already be visible.
  }
}

async function runSearch(page, query, city) {
  await ensurePastSiteGate(page);

  await page.locator("#cityInput").fill(city);
  const cityOptions = page.locator("#cityDropdown .city-option");
  await expect(cityOptions.first()).toBeVisible({ timeout: 20_000 });
  await cityOptions.first().click();

  const skipWizard = page.locator(".boop-skip-tray button", { hasText: "Skip" });
  await expect(skipWizard).toBeVisible({ timeout: 20_000 });
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/vsearch") && r.ok(), { timeout: 120_000 }),
    skipWizard.click(),
  ]);

  await dismissVibeTourIfShown(page);

  await expect(page.locator("#cmd-q")).toBeVisible({ timeout: 30_000 });
  await page.locator("#cmd-q").fill(query);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/vsearch") && r.ok(), { timeout: 120_000 }),
    page.locator(".cmd-go").click(),
  ]);

  await dismissVibeTourIfShown(page);

  const resultCount = page.locator("#resultCount");
  await expect(resultCount).not.toHaveText(/^\s*$/);
  await expect(page.locator("#results .hotel-card").first()).toBeVisible({ timeout: 60_000 });
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
