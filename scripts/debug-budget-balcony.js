#!/usr/bin/env node
/**
 * Full client filter-chain simulation for balcony + budget + avail + hotels.
 * Usage: node scripts/debug-budget-balcony.js [baseUrl] [--any-budget]
 */
const BASE = process.argv.find((a) => a.startsWith('http')) || 'http://127.0.0.1:3000';
const ANY_BUDGET = process.argv.includes('--any-budget');
const H = { 'x-index-secret': 'roommatch-2026' };

const roomSeed =
  'sleek modern contemporary room, clean lines, minimalist, soft greys, natural light. ' +
  'clean practical guest room, comfortable basics, unpretentious good value. ' +
  'private balcony, outdoor terrace, view from room';
const hotelSeed =
  'first-time visitor, iconic central location. good value practical hotel. ' +
  'historic energetic neighbourhood, culture landmarks classic city energy';

function flexMax(base) {
  return Math.round(base + Math.min(60, base * 0.15));
}

function isGuestRoom(rt) {
  return String(rt?.name || '').trim().toLowerCase() !== '__hotel_public__';
}

function hotelAvail(h) {
  const rp = h.roomPrices;
  if (!rp) return false;
  for (const _k in rp) return true;
  return false;
}

/** Mirrors client hotelPassesMustHaveFilter (post-fix). */
function hotelMustHave(h) {
  if (h?.hotel_must_haves_met === true) return true;
  if (h?.hotel_must_haves_met === false) return false;
  if (h?.featured_room?.must_haves_met === true) return true;
  const mb = h?.match_breakdown?.must_haves_summary;
  if (mb && mb.total > 0 && mb.met >= 1) return true;
  const rooms = (h.roomTypes || []).filter(isGuestRoom);
  if (rooms.some((rt) => rt?.must_haves_met === true)) return true;
  const hasExplicit = rooms.some(
    (rt) => rt?.must_haves_met === true || rt?.must_haves_met === false,
  );
  if (!hasExplicit && h?.featured_room) {
    const fr = h.featured_room;
    if (
      rooms.find(
        (rt) =>
          (fr.roomTypeId != null && String(rt.roomTypeId) === String(fr.roomTypeId)) ||
          (fr.name && rt.name === fr.name),
      )
    ) {
      return true;
    }
  }
  return false;
}

function hotelBudgetClient(h, maxCap) {
  if (maxCap == null) return true;
  if (h.price != null && h.price <= maxCap) return true;
  for (const p of Object.values(h.roomPrices || {})) {
    if (Number(p) <= maxCap) return true;
  }
  return false;
}

function hotelBudgetLegacy(h, maxCap) {
  const rooms = (h.roomTypes || []).filter(isGuestRoom);
  let eligible = rooms.filter((rt) => rt?.must_haves_met === true);
  for (const rt of eligible) {
    const p = h.roomPrices?.[rt.roomTypeId] ?? h.roomPrices?.[String(rt.roomTypeId)];
    if (p != null && Number(p) <= maxCap) return true;
  }
  if (!eligible.length) {
    for (const p of Object.values(h.roomPrices || {})) {
      if (Number(p) <= maxCap) return true;
    }
  }
  return false;
}

function propHotel(h) {
  const pt = h.property_type || 'hotel';
  const n = pt === 'apartment_rental' ? 'apartment' : pt;
  return n === 'hotel';
}

async function main() {
  const { buildBoopProfile } = require('../lib/boop-wizard');
  const profile = buildBoopProfile(
    { trip: 'first', stayVibe: 'sleek_polished', nbhdScene: 'buzz_central', group_size: 'couple' },
    ['balcony']
  );
  const params = new URLSearchParams({
    city: 'Mexico City',
    query: roomSeed,
    hotel_query: hotelSeed,
    checkin: '2026-07-14',
    checkout: '2026-07-16',
    currency: 'USD',
    search_version: 'v2',
    boop_profile: JSON.stringify(profile),
  });
  const j = await fetch(`${BASE}/api/vsearch?${params}`, { headers: H }).then((r) => r.json());
  const hotels = j.hotels || [];
  const pm = j.rates?.prices || {};
  const rpm = j.rates?.roomPrices || {};
  for (const h of hotels) {
    const id = String(h.id);
    if (pm[id] != null) h.price = pm[id];
    if (rpm[id]) h.roomPrices = { ...(h.roomPrices || {}), ...rpm[id] };
  }

  const maxCap = ANY_BUDGET ? null : flexMax(400);
  const stats = {
    total: hotels.length,
    withRoomTypes: hotels.filter((h) => (h.roomTypes || []).length > 0).length,
    hotelMustFlag: hotels.filter((h) => h.hotel_must_haves_met === true).length,
    mustMet: hotels.filter(hotelMustHave).length,
    avail: hotels.filter(hotelAvail).length,
    mustAndAvail: hotels.filter((h) => hotelMustHave(h) && hotelAvail(h)).length,
    passBudgetLegacy: 0,
    passBudgetClient: 0,
    passAllLegacy: 0,
    passAllClient: 0,
    budgetMode: ANY_BUDGET ? 'any' : `under_${maxCap}`,
  };

  for (const h of hotels) {
    if (!hotelAvail(h)) continue;
    if (!hotelMustHave(h)) continue;

    const leg = maxCap != null ? hotelBudgetLegacy(h, maxCap) : true;
    const cur = hotelBudgetClient(h, maxCap);
    if (leg) stats.passBudgetLegacy++;
    if (cur) stats.passBudgetClient++;
    if (leg && propHotel(h)) stats.passAllLegacy++;
    if (cur && propHotel(h)) stats.passAllClient++;
  }

  console.log(JSON.stringify(stats, null, 2));
  console.log(`\nClient pipeline (avail → must → budget${ANY_BUDGET ? '=any' : ''} → hotels):`);
  for (const h of hotels) {
    if (!hotelAvail(h) || !hotelMustHave(h) || !hotelBudgetClient(h, maxCap) || !propHotel(h)) continue;
    console.log(
      ' ',
      h.id,
      (h.name || '').slice(0, 38),
      h.price != null ? `$${h.price}` : '—',
      `vs=${h.vectorScore || 0}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
