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

module.exports = {
  LAUNCH_CITIES,
  isLaunchCity,
  seedBetaConsent,
  ensurePastSiteGate,
  dismissBetaConsentIfShown,
  selectCityAndGo,
  skipBoopWizard,
  runVectorSearchQuery,
  waitForSearchResults,
  resultCardLocator,
  dismissVibeTourIfShown,
};
