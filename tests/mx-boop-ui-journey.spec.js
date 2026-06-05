/**
 * Mexico City Boop wizard UI journey — curated picks, full list, sorts, detail pages,
 * match scores vs client sort bridge, optional fact DB cross-check.
 *
 *   npx playwright test tests/mx-boop-ui-journey.spec.js --workers=1
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { test, expect } = require("@playwright/test");
const { buildBoopProfile } = require("../lib/boop-wizard");
const { sortHotelsBestMatch } = require("../lib/client-match-sort");
const { fetchDistinctHotelIds } = require("../scripts/search-test-lib");
const {
  seedBetaConsent,
  ensurePastSiteGate,
  dismissBetaConsentIfShown,
  selectCityAndGo,
  setTravelDates,
  futureTravelDates,
  completeBoopWizard,
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
  dismissVibeTourIfShown,
} = require("./playwright-helpers");

const CITY = "Mexico City";

const SCENARIOS = [
  {
    id: "hip_sleek",
    answers: { trip: "repeat", stayVibe: "sleek_polished", nbhdScene: "hip_local", group_size: "couple", priceMatters: 0 },
    dealbreakers: [],
    dates: false,
    factFlag: null,
  },
  {
    id: "leafy_cozy",
    answers: { trip: "first", stayVibe: "cozy_warm", nbhdScene: "leafy_local", group_size: "couple", priceMatters: 0 },
    dealbreakers: [],
    dates: true,
    factFlag: null,
  },
  {
    id: "buzz_value",
    answers: { trip: "repeat", stayVibe: "simple_value", nbhdScene: "buzz_central", group_size: "couple", priceMatters: 80 },
    dealbreakers: [],
    dates: false,
    factFlag: null,
  },
  {
    id: "distinct_balcony",
    answers: { trip: "repeat", stayVibe: "distinct_unique", nbhdScene: "hip_local", group_size: "couple", priceMatters: 0 },
    dealbreakers: ["balcony"],
    dates: false,
    factFlag: "private_balcony",
  },
];

test.beforeEach(async ({ page }) => {
  test.setTimeout(300_000);
  await seedBetaConsent(page);
});

/** Count sort-score inversions (tie-breakers can legitimately invert a few slots). */
function countSortInversions(sorted, sortScoreFn, depth = 15, tolerance = 0.05) {
  let n = 0;
  for (let i = 1; i < Math.min(depth, sorted.length); i++) {
    const prev = sortScoreFn(sorted[i - 1]);
    const cur = sortScoreFn(sorted[i]);
    if (cur > prev + tolerance) n++;
  }
  return n;
}

for (const sc of SCENARIOS) {
  test(`MX Boop UI: ${sc.id}`, async ({ page }, testInfo) => {
    const findings = [];
    const travelDates = sc.dates ? futureTravelDates(20, 3) : null;

    await ensurePastSiteGate(page);
    await dismissBetaConsentIfShown(page);

    if (travelDates) {
      await setTravelDates(page, travelDates.checkin, travelDates.checkout);
    }

    await selectCityAndGo(page, CITY);

    const vsearchData = await completeBoopWizard(page, sc.answers, {
      dealbreakers: sc.dealbreakers,
    });

    findings.push(...(await auditCuratedTopPicks(page)));

    const profile = buildBoopProfile(sc.answers, sc.dealbreakers);
    const { audit: apiAudit, failures: apiFailures } = await auditVsearchApiPayload(vsearchData, 50, profile);
    if (apiFailures.length) {
      findings.push(...apiFailures.map((f) => `api:${f}`));
    }

    if (vsearchData.stats?.hotel_vibe_model && vsearchData.stats.hotel_vibe_model !== "v2_facts") {
      findings.push(`vibe_model:${vsearchData.stats.hotel_vibe_model}`);
    }

    const bridge0 = await getBridgeHotelsSnapshot(page);
    expect(bridge0?.hotels?.length, "bridge hotels empty").toBeGreaterThan(20);

    // Match badges on curated cards should be 1–100 when present.
    for (const row of bridge0.displayScores.slice(0, 4)) {
      if (row.overall < 1 || row.overall > 100) {
        findings.push(`overall_pct_oob:${row.id}:${row.overall}`);
      }
    }

    const ctx = {
      pricesLoaded: !!bridge0.ui?.pricesLoaded,
      hasDateSearch: !!bridge0.ui?.hasDateSearch,
      showAvailOnly: !!bridge0.ui?.showAvailOnly,
    };
    const { hotels: expectedSorted, meta } = sortHotelsBestMatch(
      vsearchData.hotels.map((h) => ({ ...h })),
      vsearchData.stats || {},
      profile,
      ctx
    );
    // Undated Boop: client re-sorts on first paint. Dated searches use server bookable order.
    if (!sc.dates) {
      const sortInversions = countSortInversions(expectedSorted, meta.sortScore, 15);
      if (sortInversions > 4) {
        findings.push(`client_sort_inversions:${sortInversions}`);
      }
    }

    if (sc.factFlag) {
      try {
        const flagged = await fetchDistinctHotelIds(CITY, sc.factFlag, "v2");
        const top15 = (vsearchData.hotels || []).slice(0, 15);
        const hits = top15.filter((h) => flagged.has(String(h.id))).length;
        if (hits < 1) findings.push(`fact_top15_miss:${sc.factFlag}`);
      } catch (e) {
        findings.push(`fact_db_skip:${e.message.slice(0, 80)}`);
      }
    }

    if (sc.dates) {
      try {
        await waitForRatesLoaded(page, 120_000);
        await expect(page.locator("#availFilter")).toBeVisible({ timeout: 15_000 });
      } catch {
        findings.push("rates_not_loaded");
      }
    }

    await openFullResultsList(page);

    // Best Match — DOM order should match client sort bridge (allow 2 stale slots).
    await clickSortBy(page, "match");
    const bridgeMatch = await getBridgeHotelsSnapshot(page);
    const expectedFirst = bridgeMatch.sortedIds[0];
    if (expectedFirst) {
      await page.waitForFunction(
        (id) => document.querySelector("#results .hotel-card")?.id === `hotel-card-${id}`,
        expectedFirst,
        { timeout: 15_000 }
      ).catch(() => {});
    }
    const domMatchIds = await getVisibleFullListHotelIds(page, 12);
    const expectedMatchIds = bridgeMatch.sortedIds.slice(0, domMatchIds.length);
    let sortMismatches = 0;
    for (let i = 0; i < Math.min(domMatchIds.length, expectedMatchIds.length); i++) {
      if (domMatchIds[i] !== expectedMatchIds[i]) sortMismatches++;
    }
    if (sortMismatches > 2) {
      findings.push(
        `dom_match_sort_mismatch:${sortMismatches} dom=[${domMatchIds.slice(0, 5).join(",")}] bridge=[${expectedMatchIds.slice(0, 5).join(",")}]`
      );
    }

    if (sc.dates && bridgeMatch.ui?.pricesLoaded) {
      await clickSortBy(page, "price");
      const priced = await getVisibleHotelPrices(page, 10);
      const withPrice = priced.filter((p) => p.price != null);
      for (let i = 1; i < withPrice.length; i++) {
        if (withPrice[i].price < withPrice[i - 1].price - 0.5) {
          findings.push(`price_sort_inversion:${withPrice[i - 1].id}->${withPrice[i].id}`);
          break;
        }
      }
    }

    await clickSortBy(page, "rating");
    const domRatingIds = await getVisibleFullListHotelIds(page, 8);
    if (domRatingIds.length >= 4) {
      const ratings = await page.evaluate((ids) => {
        return ids.map((id) => {
          const meta = document.getElementById(`hotel-meta-${id}`);
          const m = meta?.textContent?.match(/([\d.]+)\s*guest/i);
          return { id, rating: m ? Number(m[1]) : null };
        });
      }, domRatingIds);
      const withRating = ratings.filter((r) => r.rating != null);
      for (let i = 1; i < withRating.length; i++) {
        if (withRating[i].rating > withRating[i - 1].rating + 0.05) {
          findings.push(`rating_dom_inversion:${withRating[i - 1].id}->${withRating[i].id}`);
          break;
        }
      }
    }

    // Detail page from first full-list card with Details button.
    const detailsBtn = page.locator(".hotel-details-btn").first();
    await expect(detailsBtn).toBeVisible({ timeout: 15_000 });
    const detailResp = page.waitForResponse(
      (r) => r.url().includes("/api/hotel/") && r.ok(),
      { timeout: 60_000 }
    );
    await detailsBtn.click();
    await detailResp;
    findings.push(...(await auditHotelDetailPage(page)));
    await closeHotelDetailPage(page);
    await dismissVibeTourIfShown(page);

    await testInfo.attach("mx-boop-ui-audit", {
      body: JSON.stringify(
        {
          scenario: sc,
          travelDates,
          findings,
          apiAudit,
          resultCount: await page.locator("#resultCount").textContent(),
          topPickScores: bridge0.displayScores,
          vsearchTop5: (vsearchData.hotels || []).slice(0, 5).map((h) => ({
            id: h.id,
            vectorScore: h.vectorScore,
            hotelScore: h.hotelScore,
            nbhd_fit_pct: h.nbhd_fit_pct,
          })),
        },
        null,
        2
      ),
      contentType: "application/json",
    });

    console.log(`[mx-ui] ${sc.id}: findings=${findings.length}${findings.length ? " " + findings.join("; ") : ""}`);
    expect(findings, findings.join("; ")).toEqual([]);
  });
}
