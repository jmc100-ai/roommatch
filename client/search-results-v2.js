/**
 * SearchResultsV2 — curated results UX (isolated from classic list render in app.js).
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'rm_results_ux';
  const MODE_CLASSIC = 'classic';
  const MODE_V2 = 'v2';
  const MORE_HOTELS_COUNT = 8;
  const VIEW_CURATED = 'curated';
  const VIEW_FULL = 'full';

  const BEST_MATCHES_SUB =
    'Each card highlights a different strength—overall vibe, room experience, area fit, or style.';
  const PICK_RING_CIRC = 213.6;

  const PICK_SLOTS = [
    {
      id: 'overall',
      badge: 'Best overall',
      badgeClass: 'pick-badge--overall',
      priceClass: 'sr2-pick-price--overall',
      ringClass: 'pick-ring--overall',
      ringColor: '#c9a96e',
      ringDim: 'Overall',
      metricLabel: 'Overall match',
      icon: 'trophy',
    },
    {
      id: 'room_match',
      badge: 'Best room',
      badgeClass: 'pick-badge--room',
      priceClass: 'sr2-pick-price--room',
      ringClass: 'pick-ring--room',
      ringColor: '#a882dc',
      ringDim: 'Room',
      metricLabel: 'Room vibe match',
      icon: 'bed',
    },
    {
      id: 'area_fit',
      badge: 'Best area',
      badgeClass: 'pick-badge--area',
      priceClass: 'sr2-pick-price--area',
      ringClass: 'pick-ring--area',
      ringColor: '#5ab482',
      ringDim: 'Area',
      metricLabel: 'Area fit',
      icon: 'pin',
    },
    {
      id: 'stylish',
      badge: 'Most stylish',
      badgeClass: 'pick-badge--stylish',
      priceClass: 'sr2-pick-price--style',
      ringClass: 'pick-ring--style',
      ringColor: '#dc78a0',
      ringDim: 'Style',
      metricLabel: 'Hotel style match',
      icon: 'sparkles',
    },
  ];

  const LENSES = [
    {
      id: 'quiet',
      title: 'Quiet & Peaceful',
      desc: 'Calm streets, green pockets, slower pace',
      iconClass: 'lens-icon--quiet',
      icon: '◌',
    },
    {
      id: 'historic',
      title: 'Historic Charm',
      desc: 'Culture, landmarks, classic city energy',
      iconClass: 'lens-icon--historic',
      icon: '⌂',
    },
    {
      id: 'luxury',
      title: 'Luxury Picks',
      desc: 'Polished stays, high guest ratings, upscale feel',
      iconClass: 'lens-icon--luxury',
      icon: '✦',
    },
    {
      id: 'central',
      title: 'Central & Walkable',
      desc: 'Connected, easy to explore on foot',
      iconClass: 'lens-icon--central',
      icon: '◎',
    },
    {
      id: 'hidden',
      title: 'Hidden Gems',
      desc: 'Local character, less touristy bustle',
      iconClass: 'lens-icon--hidden',
      icon: '◇',
    },
    {
      id: 'trendy',
      title: 'Trendy Boutique',
      desc: 'Distinct style, cafés, creative neighborhoods',
      iconClass: 'lens-icon--trendy',
      icon: '◆',
    },
  ];

  let _ctx = null;
  let _v2Subview = VIEW_CURATED;
  let _offerState = null;
  let _scrollRestoreY = 0;
  let _fullListScrollY = 0;

  function bridge() {
    return global.RoomMatchResultsBridge || null;
  }

  function hotelKey(h) {
    if (!h) return null;
    const id = h.id ?? h.hotel_id;
    return id != null && String(id).trim() ? String(id).trim() : null;
  }

  /**
   * Fuzzy brand key so sibling properties (e.g. Ritz-Carlton + Ritz-Carlton Residences)
   * count as one family for Top Picks diversity — not used for filtering the main list.
   */
  function hotelBrandKey(h) {
    const b = bridge();
    let name = String(b?.hotelDisplayTitle?.(h) || h?.name || '').toLowerCase().trim();
    if (!name) return '';
    name = name.replace(/^the\s+/, '');
    name = name.split(',')[0].trim();
    name = name.replace(
      /\b(residences|residence|suites|suite|apartments|apartment|extended stay|condo|condos)\b/gi,
      ' ',
    );
    const city = String(h?.city || '').toLowerCase().trim();
    if (city && name.endsWith(city)) name = name.slice(0, -city.length).trim();
    return name.replace(/[^a-z0-9]+/g, '');
  }

  /** Pull latest sorted hotels from classic pipeline (app.js bridge). */
  function buildCtxFromBridge() {
    const b = bridge();
    if (!b) return { hotels: [], sortedHotels: [], total: 0 };
    const sorted = (typeof b.getSortedHotelsForDisplay === 'function'
      ? b.getSortedHotelsForDisplay()
      : null) || (typeof b.getLastHotels === 'function' ? b.getLastHotels() : null) || [];
    if (!sorted.length) return { hotels: [], sortedHotels: [], total: 0 };
    return { hotels: sorted, sortedHotels: sorted, total: sorted.length };
  }

  function refreshCtx() {
    const built = buildCtxFromBridge();
    if (built) _ctx = built;
    return _ctx;
  }

  function readStoredMode() {
    return MODE_V2;
  }

  function writeStoredMode() {
    try {
      sessionStorage.setItem(STORAGE_KEY, MODE_V2);
    } catch (_) { /* private mode */ }
  }

  function getMode() {
    return MODE_V2;
  }

  function isV2Mode() {
    return true;
  }

  function esc(s) {
    const b = bridge();
    return b ? b.escHtml(s) : String(s ?? '');
  }

  function nbhdAttr(h, key) {
    const attrs = h?.primary_nbhd?.attributes;
    if (!attrs || typeof attrs !== 'object') return 0;
    const v = attrs[key];
    return Number.isFinite(Number(v)) ? Number(v) : 0;
  }

  function pickMetricPct(h, pickId) {
    if (!h) return 0;
    const b = bridge();
    if (pickId === 'overall') {
      return b ? b.overallMatchDisplayPct(h) : Math.round(Number(h.vectorScore) || 0);
    }
    if (pickId === 'room_match') {
      return b ? b.bestRoomPickDisplayPct(h) : Math.round(Number(h.vectorScore) || 0);
    }
    if (pickId === 'area_fit') {
      return h.nbhd_fit_pct != null ? Math.round(h.nbhd_fit_pct) : 0;
    }
    if (pickId === 'stylish') {
      return b ? b.hotelStyleMatchDisplayPct(h) : Math.round(Number(h.hotelScore) || 0);
    }
    return 0;
  }

  function pickSortScore(h, pickId) {
    if (pickId === 'area_fit') {
      return h.nbhd_fit_pct != null ? Number(h.nbhd_fit_pct) : -1;
    }
    if (pickId === 'room_match') {
      const b = bridge();
      return b ? b.bestRoomPickSortScore(h) : pickMetricPct(h, pickId);
    }
    return pickMetricPct(h, pickId);
  }

  function lensSortScore(h, lensId) {
    const room = bridge()?.roomVibeMatchDisplayPct(h) ?? h.vectorScore ?? 0;
    const hotel = Number(h.hotelScore) || 0;
    const nbhd = h.nbhd_fit_pct ?? 0;
    const stars = Number(h.starRating) || 0;
    const guest = Number(h.rating) || 0;
    const a = nbhdAttr(h, 'calm') + nbhdAttr(h, 'green') * 0.9;
    const culture = nbhdAttr(h, 'culture') + nbhdAttr(h, 'iconic');
    const walk = nbhdAttr(h, 'walkability') + nbhdAttr(h, 'central');
    const local = nbhdAttr(h, 'local');
    const lux = nbhdAttr(h, 'luxury');

    switch (lensId) {
      case 'quiet':
        return a * 4 + nbhd * 0.35 + room * 0.15 - nbhdAttr(h, 'nightlife') * 2;
      case 'historic':
        return culture * 5 + nbhd * 0.4 + room * 0.2;
      case 'luxury':
        return lux * 4 + stars * 8 + guest * 3 + hotel * 0.5 + (h.price != null ? -Math.min(h.price / 200, 40) : 0);
      case 'central':
        return walk * 5 + nbhd * 0.35 + room * 0.2;
      case 'hidden':
        return local * 5 + guest * 2 + room * 0.35 - nbhdAttr(h, 'touristy') * 3;
      case 'trendy':
        return local * 3 + nbhdAttr(h, 'cafes') * 2 + hotel * 0.55 + room * 0.25;
      default:
        return room;
    }
  }

  function sortHotelsForLens(hotels, lensId) {
    if (!lensId) return [...hotels];
    return [...hotels].sort((a, b) => lensSortScore(b, lensId) - lensSortScore(a, lensId));
  }

  function selectTopPicks(hotels) {
    const list = hotels || [];
    const usedIds = new Set();
    const usedBrands = new Set();
    const picks = {};

    const claim = (h) => {
      const id = hotelKey(h);
      if (!id) return false;
      usedIds.add(id);
      const brand = hotelBrandKey(h);
      if (brand) usedBrands.add(brand);
      return true;
    };

    const isBlocked = (h) => {
      const id = hotelKey(h);
      if (!id || usedIds.has(id)) return true;
      const brand = hotelBrandKey(h);
      return !!(brand && usedBrands.has(brand));
    };

    const takeBest = (slotId, pool) => {
      let best = null;
      let bestScore = -Infinity;
      const b = bridge();
      for (const h of pool) {
        if (isBlocked(h)) continue;
        if (slotId === 'room_match' && b?.eligibleForBestRoomPick && !b.eligibleForBestRoomPick(h)) {
          continue;
        }
        if (slotId === 'room_match' && b?.compareBestRoomPick) {
          if (!best || b.compareBestRoomPick(h, best) > 0) {
            best = h;
            bestScore = pickSortScore(h, slotId);
          }
          continue;
        }
        const s = pickSortScore(h, slotId);
        if (s > bestScore) {
          bestScore = s;
          best = h;
        }
      }
      if (best) claim(best);
      return best;
    };

    if (list.length) {
      const first = list[0];
      if (claim(first)) picks.overall = first;
    }
    picks.room_match = takeBest('room_match', list);
    picks.area_fit = takeBest('area_fit', list);
    picks.stylish = takeBest('stylish', list);

    return picks;
  }

  /**
   * Next N hotels in the active sort, excluding every Top Pick (by id).
   * Top Picks are metric-specific and often sit at ranks #2–#5, not only #1.
   */
  /** Max cards from the same primary_nbhd in the "More hotels" row. */
  const MORE_HOTELS_MAX_PER_NBHD = 2;

  function selectMoreHotels(sorted, picks, limit) {
    const list = sorted || [];
    const cap = Math.max(0, Number(limit) || 0);
    if (!list.length || cap === 0) return [];

    const pickIds = new Set();
    if (picks && typeof picks === 'object') {
      for (const h of Object.values(picks)) {
        const id = hotelKey(h);
        if (id) pickIds.add(id);
      }
    }

    const out = [];
    const nbhdCounts = new Map();
    for (const h of list) {
      const id = hotelKey(h);
      if (!id || pickIds.has(id)) continue;
      const nbhd = h.primary_nbhd?.name || '';
      if (nbhd) {
        const n = nbhdCounts.get(nbhd) || 0;
        if (n >= MORE_HOTELS_MAX_PER_NBHD) continue;
        nbhdCounts.set(nbhd, n + 1);
      }
      out.push(h);
      if (out.length >= cap) break;
    }
    return out;
  }

  /** Top Picks + More Hotels — may rank outside sync meta top-N; always prefetch these. */
  function getCuratedHighlightHotelIds(sorted) {
    const list = sorted || [];
    const picks = selectTopPicks(list);
    const more = selectMoreHotels(list, picks, MORE_HOTELS_COUNT);
    const out = [];
    const seen = new Set();
    const add = (h) => {
      const id = hotelKey(h);
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    };
    add(picks.overall);
    add(picks.room_match);
    add(picks.area_fit);
    add(picks.stylish);
    for (const h of more) add(h);
    return out;
  }

  function repaintCuratedPanel() {
    if (getV2Subview() !== VIEW_CURATED) return;
    if (document.getElementById('st-results')?.classList.contains('results-pending')) return;
    paintV2Panel();
  }

  function overallMatchPct(h) {
    if (!h) return 0;
    const b = bridge();
    return b ? b.overallMatchDisplayPct(h) : Math.round(Number(h.vectorScore) || 0);
  }

  function getV2Subview() {
    return _v2Subview === VIEW_FULL ? VIEW_FULL : VIEW_CURATED;
  }

  function resetToCuratedView() {
    _v2Subview = VIEW_CURATED;
    const st = document.getElementById('st-results');
    if (st) {
      st.classList.remove('sr2-view-full');
      st.classList.add('sr2-view-curated');
    }
  }

  function heroPhotoUrl(h) {
    const b = bridge();
    if (b?.pickCardHeroPhoto) return b.pickCardHeroPhoto(h) || '';
    if (h?.mainPhoto) return h.mainPhoto;
    if (Array.isArray(h?.hotelPhotos) && h.hotelPhotos[0]) return h.hotelPhotos[0];
    const rooms = h?.roomTypes || [];
    for (const rt of rooms) {
      const p = (rt.photos || [])[0];
      if (p) return typeof p === 'string' ? p : p.url;
    }
    return '';
  }

  function priceLine(h) {
    const b = bridge();
    const sym = b ? b.ratesCurrencySymbol() : '$';
    const ui = b?.getSearchUiState?.() || {};
    const datesEntered = !!(ui.datesEntered || ui.hasDateSearch);
    if (h?.price != null && Number.isFinite(Number(h.price))) {
      return { text: `From ${sym}${Number(h.price).toLocaleString()} / night` };
    }
    if (datesEntered && (ui.fetchingPrices || (!ui.pricesLoaded && !ui.ratesFetchDone))) {
      return { text: 'Checking rates…' };
    }
    if (datesEntered && ui.pricesLoaded) return { text: 'No rates for your dates' };
    const link = b?.addDatesLinkHtml?.('Add dates for rates');
    return link ? { html: link } : { text: 'Add dates for rates' };
  }

  function priceLineMarkup(h) {
    const pl = priceLine(h);
    return pl.html != null ? pl.html : esc(pl.text || '');
  }

  function pickBadgeIconSvg(type) {
    switch (type) {
      case 'bed':
        return '<svg class="sr2-pick-badge-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 14c1.66 0 3-1.34 3-3S8.66 8 7 8s-3 1.34-3 3 1.34 3 3 3zm0-4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm12-3h-8v7H3V7c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2v10h-2V7z"/></svg>';
      case 'pin':
        return '<svg class="sr2-pick-badge-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>';
      case 'sparkles':
        return '<svg class="sr2-pick-badge-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.5 4.5H18l-3.7 2.7 1.4 4.3L12 11.8 8.3 13.5l1.4-4.3L6 6.5h4.5L12 2z"/></svg>';
      default:
        return '<svg class="sr2-pick-badge-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7-6.3-4.6L5.7 21 8 14 2 9.4h7.6L12 2z"/></svg>';
    }
  }

  function renderPickBadge(slot) {
    return `<span class="sr2-pick-badge ${slot.badgeClass}">${pickBadgeIconSvg(slot.icon)}${esc(slot.badge)}</span>`;
  }

  function renderPickMatchRing(pct, slot) {
    const offset = (PICK_RING_CIRC * (1 - pct / 100)).toFixed(2);
    return `
      <div class="sr2-pick-ring ${slot.ringClass}" aria-label="${esc(slot.metricLabel)} ${pct} percent">
        <svg viewBox="0 0 76 76" aria-hidden="true">
          <circle cx="38" cy="38" r="34" fill="rgba(12,12,14,0.88)" stroke="rgba(255,255,255,0.12)" stroke-width="4"/>
          <circle cx="38" cy="38" r="34" fill="none" stroke="${slot.ringColor}" stroke-width="4" stroke-linecap="round"
            stroke-dasharray="${PICK_RING_CIRC}" stroke-dashoffset="${offset}" transform="rotate(-90 38 38)"/>
        </svg>
        <div class="sr2-pick-ring-label">
          <span class="sr2-pick-ring-pct">${pct}%</span>
          <span class="sr2-pick-ring-dim">${esc(slot.ringDim)}</span>
        </div>
      </div>`;
  }

  function renderBestMatchesHead(opts) {
    const includeTooltip = opts?.tooltip !== false;
    const sub = opts?.sub ?? BEST_MATCHES_SUB;
    const tooltip = includeTooltip
      ? `<div class="sr2-scores-tip-wrap">
            <button type="button" class="sr2-scores-tip-btn" id="sr2-scores-tip-btn"
              onclick="SearchResultsV2.toggleScoresTip(event)"
              aria-expanded="false" aria-controls="sr2-scores-tip" aria-label="Why are these scores different?">i</button>
            <div class="sr2-scores-tip" id="sr2-scores-tip" hidden role="dialog" aria-labelledby="sr2-scores-tip-title">
              <h3 id="sr2-scores-tip-title">Why are these scores different?</h3>
              <p>Each card shows the best match for a different dimension. That's why the scores aren't in descending order.</p>
              <button type="button" class="sr2-scores-tip-close" onclick="SearchResultsV2.closeScoresTip(event)">Got it</button>
            </div>
          </div>`
      : '';
    return `
      <div class="sr2-section-head sr2-section-head--picks">
        <div class="sr2-picks-title-block">
          <div class="sr2-picks-title-row">
            <h2 id="sr2-picks-heading" class="sr2-heading sr2-heading--picks">Best matches for your vibe</h2>
            ${tooltip}
          </div>
          <p class="sr2-sub sr2-sub--picks">${esc(sub)}</p>
        </div>
      </div>`;
  }

  function starsHtml(h) {
    const n = Math.min(5, Math.max(0, Math.round(Number(h.starRating) || 0)));
    if (!n) return '';
    return `<span class="sr2-stars" aria-label="${n} stars">${'★'.repeat(n)}</span>`;
  }

  function renderEmptyPickCard(showAdjustHint) {
    const hint = showAdjustHint
      ? '<p class="sr2-pick-empty-hint">Try adjusting dates, must-haves or budget</p>'
      : '';
    return (
      '<div class="sr2-pick-card sr2-pick-card--empty">' +
      '<div class="sr2-pick-empty-copy">' +
      '<p class="sr2-pick-empty">Not enough matches yet</p>' +
      hint +
      '</div></div>'
    );
  }

  function renderPickCard(h, slot, showAdjustHint) {
    if (!h) {
      return renderEmptyPickCard(!!showAdjustHint);
    }
    const pct = pickMetricPct(h, slot.id);
    const photo = heroPhotoUrl(h);
    const b = bridge();
    const title = b ? b.hotelDisplayTitle(h) : (h.name || 'Hotel');
    const nbhd = h.primary_nbhd?.name || h.city || '';
    const stars = starsHtml(h);
    const metaLine = nbhd || stars
      ? `<p class="sr2-pick-meta">${nbhd ? `<span class="sr2-pick-nbhd">${esc(nbhd)}</span>` : ''}${nbhd && stars ? ' · ' : ''}${stars}</p>`
      : '';
    const guestLine = h.rating > 0
      ? `<p class="sr2-pick-guest"><strong>${Number(h.rating).toFixed(1)}</strong> (${formatReviewCount(h.reviewCount)})</p>`
      : '';
    const img = photo
      ? `<img class="sr2-pick-img" src="${esc(photo)}" alt="" loading="lazy" />`
      : `<div class="sr2-pick-img sr2-pick-img--ph" aria-hidden="true"></div>`;

    const hid = hotelKey(h);
    return `
      <article class="sr2-pick-card" data-hotel-id="${esc(hid)}" data-pick="${esc(slot.id)}"
        role="button" tabindex="0"${detailPrefetchAttrs(hid)}
        onclick="SearchResultsV2.openOffer('${esc(hid)}', '${esc(slot.id)}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();SearchResultsV2.openOffer('${esc(hid)}', '${esc(slot.id)}');}">
        <div class="sr2-pick-media">
          ${img}
          ${renderPickBadge(slot)}
          ${renderPickMatchRing(pct, slot)}
        </div>
        <div class="sr2-pick-body">
          <h3 class="sr2-pick-name">${esc(title)}</h3>
          ${metaLine}
          ${guestLine}
          <p class="sr2-pick-price ${slot.priceClass}">${priceLineMarkup(h)}</p>
        </div>
      </article>`;
  }

  function formatReviewCount(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return 'guest reviews';
    if (v >= 1000) return `${(v / 1000).toFixed(1)}k reviews`;
    return `${Math.round(v)} reviews`;
  }

  function renderMoreHotelCard(h) {
    if (!h) return '';
    const pct = overallMatchPct(h);
    const photo = heroPhotoUrl(h);
    const b = bridge();
    const title = b ? b.hotelDisplayTitle(h) : (h.name || 'Hotel');
    const nbhd = h.primary_nbhd?.name || h.city || '';
    const rating = h.rating > 0
      ? `<span class="sr2-more-rating">${starsHtml(h)} <strong>${Number(h.rating).toFixed(1)}</strong> (${formatReviewCount(h.reviewCount)})</span>`
      : '';
    const img = photo
      ? `<img class="sr2-more-img" src="${esc(photo)}" alt="" loading="lazy" />`
      : `<div class="sr2-more-img sr2-more-img--ph" aria-hidden="true"></div>`;
    const hid = hotelKey(h);
    return `
      <article class="sr2-more-card" data-hotel-id="${esc(hid)}" role="button" tabindex="0"${detailPrefetchAttrs(hid)}
        onclick="SearchResultsV2.openOffer('${esc(hid)}', 'overall')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();SearchResultsV2.openOffer('${esc(hid)}', 'overall');}">
        <div class="sr2-more-media">
          ${img}
          <span class="match-bubble match-bubble--more" aria-label="Overall match ${pct} percent">${pct}%<small>Overall</small></span>
        </div>
        <div class="sr2-more-body">
          <h3 class="sr2-more-name">${esc(title)}</h3>
          <p class="sr2-more-meta"><span class="sr2-more-nbhd">📍 ${esc(nbhd)}</span>${rating}</p>
          <p class="sr2-more-price">${priceLineMarkup(h)}</p>
        </div>
      </article>`;
  }

  function renderMoreHotelsSection(sorted, picks, total) {
    const more = selectMoreHotels(sorted, picks, MORE_HOTELS_COUNT);
    const cards = more.length
      ? more.map((h) => renderMoreHotelCard(h)).join('')
      : '<p class="sr2-more-empty">No additional matches to show yet.</p>';
    const seeAllLabel = `See all ${total} match${total === 1 ? '' : 'es'} →`;
    return `
      <section class="sr2-section sr2-section--more" aria-labelledby="sr2-more-heading">
        <div class="sr2-section-head">
          <h2 id="sr2-more-heading" class="sr2-heading sr2-heading--more">
            More hotels you'll probably love
          </h2>
          <button type="button" class="sr2-link-btn" onclick="SearchResultsV2.openSeeAllFullList()">${esc(seeAllLabel)}</button>
        </div>
        <p class="sr2-sub">More stays that fit your vibe and trip preferences.</p>
        <div class="sr2-more-grid" role="list">${cards}</div>
      </section>`;
  }

  function renderMoreHotelsSectionSkeleton() {
    const skel = Array(MORE_HOTELS_COUNT)
      .fill('<div class="sr2-more-card sr2-more-card--skel" aria-hidden="true"></div>')
      .join('');
    return (
      '<section class="sr2-section sr2-section--more" aria-hidden="true">' +
      '<div class="sr2-section-head"><h2 class="sr2-heading sr2-heading--more">More hotels you\'ll probably love</h2></div>' +
      `<div class="sr2-more-grid">${skel}</div></section>`
    );
  }

  function renderEmptyStateHtml() {
    return (
      '<div class="sr2-root">' +
      '<section class="sr2-section sr2-section--picks">' +
      renderBestMatchesHead({ tooltip: false, sub: 'Run a search first to see curated matches and more hotels.' }) +
      '<div class="sr2-picks-grid">' +
      PICK_SLOTS.map(() => '<div class="sr2-pick-card sr2-pick-card--empty"><p class="sr2-pick-empty">No results yet</p></div>').join('') +
      '</div></section>' +
      renderMoreHotelsSectionSkeleton() +
      '</div>'
    );
  }

  function renderFilteredEmptyStateHtml(rawCount) {
    const b = bridge();
    const filters = b?.describeActiveResultFilters?.() || [];
    const filterLine = filters.length
      ? `<p class="sr2-sub">Active filters: <strong>${esc(filters.join(' · '))}</strong></p>`
      : '';
    return (
      '<div class="sr2-root">' +
      '<section class="sr2-section sr2-section--picks">' +
      renderBestMatchesHead({
        tooltip: false,
        sub: `We found ${rawCount} vibe matches, but none pass your current filters.`,
      }) +
      filterLine +
      '<p class="sr2-sub">Must-haves stay on whether <strong>Available only</strong> is on or off. Use Clear budget if price is blocking results.</p>' +
      '<div class="sr2-empty-actions">' +
      '<button type="button" class="sr2-link-btn" onclick="relaxResultFiltersForEmptyState()">Clear budget filter</button>' +
      '<button type="button" class="sr2-link-btn" onclick="openFineTuneSheet()">Fine-tune preferences</button>' +
      '</div>' +
      '<div class="sr2-picks-grid">' +
      PICK_SLOTS.map(() => '<div class="sr2-pick-card sr2-pick-card--empty"><p class="sr2-pick-empty">No matches with current filters</p></div>').join('') +
      '</div></section>' +
      renderMoreHotelsSectionSkeleton() +
      '</div>'
    );
  }

  function renderMainPanel(ctx) {
    const sorted = ctx.sortedHotels || [];
    const picks = selectTopPicks(sorted);
    let firstEmptyHint = true;
    const pickCards = PICK_SLOTS.map((slot) => {
      const h = picks[slot.id];
      const showHint = !h && firstEmptyHint;
      if (!h) firstEmptyHint = false;
      return renderPickCard(h, slot, showHint);
    }).join('');
    const total = ctx.total ?? sorted.length;
    return `
      <div class="sr2-root">
        <section class="sr2-section sr2-section--picks" aria-labelledby="sr2-picks-heading">
          ${renderBestMatchesHead()}
          <div class="sr2-picks-grid">${pickCards}</div>
        </section>
        ${renderMoreHotelsSection(sorted, picks, total)}
        <aside class="sr2-explainer" aria-label="How matching works">
          <span class="sr2-explainer-icon" aria-hidden="true">✦</span>
          <p class="sr2-explainer-text">
            We show a small set of strong matches first — each card highlights a different strength.
            The grid <span class="sr2-grid-dir sr2-grid-dir--desktop">below</span><span class="sr2-grid-dir sr2-grid-dir--mobile">above</span> follows your current sort. See all matches for the full searchable list with
            filters and sort controls.
          </p>
          <button type="button" class="sr2-link-btn" onclick="SearchResultsV2.openHowModal()">How it works →</button>
        </aside>
      </div>`;
  }

  function ensureModals() {
    if (!document.body || document.getElementById('sr2-modal-host')) return;
    const host = document.createElement('div');
    host.id = 'sr2-modal-host';
    host.innerHTML = `
      <div class="sr2-modal" id="sr2-modal-how" hidden role="dialog" aria-modal="true" aria-labelledby="sr2-modal-how-title">
        <div class="sr2-modal-backdrop" onclick="SearchResultsV2.closeModals()"></div>
        <div class="sr2-modal-panel">
          <button type="button" class="sr2-modal-close" onclick="SearchResultsV2.closeModals()" aria-label="Close">×</button>
          <h2 id="sr2-modal-how-title">How it works</h2>
          <p>TravelByVibe scores real room photos and hotel character against your saved vibe preferences and room description. Best matches highlight different strengths; the list below follows your current sort. Use <strong>See all matches</strong> for the full searchable grid with the same filters.</p>
        </div>
      </div>`;
    document.body.appendChild(host);
  }

  function renderOfferSheet(hotelId, pickId) {
    const b = bridge();
    const hotel = (b?.getLastHotels() || []).find((h) => hotelKey(h) === String(hotelId))
      || (_ctx?.sortedHotels || []).find((h) => hotelKey(h) === String(hotelId));
    const slot = PICK_SLOTS.find((s) => s.id === pickId) || PICK_SLOTS[0];
    const root = document.getElementById('st-v2-hotel-offer');
    if (!root || !hotel || !b) return;

    const pct = pickMetricPct(hotel, pickId);
    const title = b.hotelDisplayTitle(hotel);
    const photo = heroPhotoUrl(hotel);
    const roomsHtml = b.renderRoomsSection(hotel, pickId);

    root.innerHTML = `
      <div class="sr2-offer">
        <header class="sr2-offer-top">
          <button type="button" class="sr2-offer-back" onclick="SearchResultsV2.closeOffer()">← Back to results</button>
        </header>
        <div class="sr2-offer-hero">
          ${photo ? `<img src="${esc(photo)}" alt="" class="sr2-offer-hero-img" />` : '<div class="sr2-offer-hero-img sr2-offer-hero-img--ph"></div>'}
          <div class="sr2-offer-hero-meta">
            <h1 class="sr2-offer-name">${esc(title)}</h1>
            <p class="sr2-offer-loc">${esc(hotel.primary_nbhd?.name || hotel.city || '')} · ${starsHtml(hotel)}</p>
          </div>
        </div>
        <div class="sr2-offer-context">
          <span class="sr2-offer-match-ring">${pct}%</span>
          <div>
            <p class="sr2-offer-context-title">${esc(slot.badge)}</p>
            <p class="sr2-offer-context-sub">${esc(slot.metricLabel)} for this search</p>
          </div>
        </div>
        <div class="sr2-offer-rooms" id="sr2-offer-rooms">${roomsHtml}</div>
        <footer class="sr2-offer-ft">
          <button type="button" class="sr2-offer-ghost" onclick="SearchResultsV2.openVibeTour('${esc(String(hotel.id))}')">Vibe tour</button>
          ${b.bookLinkHTML(hotel, null, 'card_header', { className: 'sr2-offer-book', label: 'Find & Book →' })}
          <button type="button" class="sr2-offer-link"${detailPrefetchAttrs(hotel.id)} onclick="SearchResultsV2.openFullDetail('${esc(String(hotel.id))}')">Full hotel details →</button>
        </footer>
      </div>`;

    const roomsEl = document.getElementById('sr2-offer-rooms');
    if (roomsEl) b.bindFeaturedStripNavs(roomsEl);
  }

  function ensureFullListBar() {
    const stack = document.getElementById('resultsStack');
    const results = document.getElementById('results');
    if (!stack || !results) return null;
    let bar = document.getElementById('sr2-full-list-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'sr2-full-list-bar';
      bar.className = 'sr2-full-list-bar';
      bar.innerHTML =
        '<button type="button" class="sr2-full-list-back" onclick="SearchResultsV2.showCuratedView()">← Best matches for your vibe</button>';
      stack.insertBefore(bar, results);
    }
    return bar;
  }

  function onSearchLoadingStart() {
    resetToCuratedView();
    const st = document.getElementById('st-results');
    if (!st?.classList.contains('results-pending')) return;
    applyLayout();
  }

  /** Toggle DOM visibility only (no list re-render). */
  function applyLayoutClasses() {
    const st = document.getElementById('st-results');
    const classic = document.getElementById('results');
    const panel = document.getElementById('results-v2');
    const full = getV2Subview() === VIEW_FULL;
    const curated = !full;
    const bar = ensureFullListBar();

    if (st) {
      st.classList.add('results-ux-mode-v2');
      st.classList.remove('results-ux-mode-classic');
      st.classList.toggle('sr2-view-full', full);
      st.classList.toggle('sr2-view-curated', curated);
    }
    if (classic) {
      classic.hidden = !full;
      classic.setAttribute('aria-hidden', full ? 'false' : 'true');
    }
    if (panel) {
      panel.hidden = !curated;
      panel.classList.toggle('sr2-panel--visible', curated);
      panel.setAttribute('aria-hidden', curated ? 'false' : 'true');
    }
    if (bar) {
      bar.hidden = !full;
      bar.setAttribute('aria-hidden', full ? 'false' : 'true');
    }
  }

  /**
   * @param {{ renderFullList?: boolean }} opts
   * renderFullList: when true in full subview, call app.js renderSorted() once.
   */
  function applyLayout(opts) {
    const pending = document.getElementById('st-results')?.classList.contains('results-pending');
    const full = getV2Subview() === VIEW_FULL;
    const curated = !full;

    applyLayoutClasses();
    if (curated) {
      paintV2Panel();
      return;
    }
    if (full && !pending && opts?.renderFullList !== false) {
      bridge()?.renderFullResultsList?.();
    }
  }

  function v2PendingHtml() {
    return (
      '<div class="sr2-root sr2-root--pending">' +
      '<p class="sr2-sub">Finding hotels that match your vibe…</p>' +
      '<div class="sr2-picks-grid">' +
      Array(4).fill('<div class="sr2-pick-card sr2-pick-card--skel" aria-hidden="true"></div>').join('') +
      '</div>' +
      renderMoreHotelsSectionSkeleton() +
      '</div>'
    );
  }

  /** Paint #results-v2 markup (runs in classic mode too — panel stays hidden until toggled). */
  function paintV2Panel() {
    const panel = document.getElementById('results-v2');
    if (!panel) return;
    try {
      const pending = document.getElementById('st-results')?.classList.contains('results-pending');
      if (pending) {
        panel.innerHTML = v2PendingHtml();
        panel.dataset.shellReady = '1';
        panel.dataset.moreCount = '0';
        return;
      }
      const ctx = refreshCtx();
      const rawCount = bridge()?.getLastHotels?.()?.length ?? 0;
      if (!ctx || !ctx.sortedHotels?.length) {
        panel.innerHTML = rawCount > 0 ? renderFilteredEmptyStateHtml(rawCount) : renderEmptyStateHtml();
      } else {
        panel.innerHTML = renderMainPanel(ctx);
      }
      panel.dataset.shellReady = '1';
      panel.dataset.moreCount = String(panel.querySelectorAll('.sr2-more-card:not(.sr2-more-card--skel)').length);
    } catch (err) {
      console.error('[SearchResultsV2] paintV2Panel failed', err);
      panel.innerHTML = renderEmptyStateHtml();
      panel.dataset.shellReady = '1';
      panel.dataset.moreCount = '0';
    }
  }

  function renderV2Panel() {
    paintV2Panel();
  }

  function setMode() {
    writeStoredMode();
    refreshCtx();
    applyLayout();
    return MODE_V2;
  }

  function syncFromSearchContext(ctx) {
    if (ctx && Array.isArray(ctx.sortedHotels)) {
      _ctx = ctx;
    } else {
      refreshCtx();
    }
    // Full list: renderSorted() in app.js already painted #results — do not
    // call applyLayout() here or we loop (applyLayout → renderSorted → sync → …).
    if (getV2Subview() === VIEW_FULL) {
      return;
    }
    applyLayout();
    const panel = document.getElementById('results-v2');
    const n = panel?.querySelectorAll('.sr2-more-card:not(.sr2-more-card--skel)').length ?? 0;
    console.log('[SearchResultsV2] sync', {
      hotels: _ctx?.sortedHotels?.length ?? 0,
      moreCards: n,
      subview: getV2Subview(),
      mode: getMode(),
    });
  }

  function openSeeAllFullList() {
    const keepY = window.scrollY || 0;
    _fullListScrollY = keepY;
    _v2Subview = VIEW_FULL;
    applyLayoutClasses();
    requestAnimationFrame(() => {
      bridge()?.renderFullResultsList?.();
      // Layout swap hides the curated panel — restore scroll so we don't nudge down.
      window.scrollTo(0, keepY);
    });
  }

  function showCuratedView() {
    _v2Subview = VIEW_CURATED;
    applyLayout({ renderFullList: false });
    window.scrollTo({ top: _fullListScrollY || 0, behavior: 'smooth' });
  }

  /** Legacy name — opens full list inside V2 (not Classic UI). */
  function seeAllClassic() {
    openSeeAllFullList();
  }

  /** Top-pick / more-hotels cards — same full detail page as classic search cards. */
  function openOffer(hotelId, pickId) {
    openFullDetail(hotelId, pickId);
  }

  function closeOffer(opts) {
    opts = opts || {};
    _offerState = null;
    const root = document.getElementById('st-v2-hotel-offer');
    if (root) {
      root.hidden = true;
      root.setAttribute('aria-hidden', 'true');
      root.innerHTML = '';
    }
    if (document.body) document.body.classList.remove('has-v2-hotel-offer');
    if (!opts.silent) {
      window.scrollTo(0, _scrollRestoreY);
      try {
        if (history.state?.v2Offer) history.back();
      } catch (_) {}
    }
  }

  function findHotelById(hotelId) {
    const id = String(hotelId);
    const b = bridge();
    return (b?.getLastHotels?.() || []).find((h) => hotelKey(h) === id)
      || (_ctx?.sortedHotels || []).find((h) => hotelKey(h) === id)
      || null;
  }

  /** Warms /api/hotel/:id before the user clicks through to the full detail page. */
  function detailPrefetchAttrs(hotelId) {
    if (!bridge()?.prefetchHotelDetail) return '';
    const id = String(hotelId).replace(/['"\\]/g, '');
    if (!id) return '';
    return ` onpointerenter="prefetchHotelDetail('${id}')" ontouchstart="prefetchHotelDetail('${id}')"`;
  }

  /** Pick context + metric for blended hotel detail (full page + search rooms). */
  function buildDetailPageOpts(hotelId, pickId) {
    if (!pickId) return {};
    const hotel = findHotelById(hotelId);
    const slot = PICK_SLOTS.find((s) => s.id === pickId) || PICK_SLOTS[0];
    return {
      sr2_pick: pickId,
      sr2_badge: slot.badge,
      sr2_metric_label: slot.metricLabel,
      sr2_match_pct: pickMetricPct(hotel, pickId),
    };
  }

  function openFullDetail(hotelId, pickId) {
    const b = bridge();
    if (!b?.openHotelDetailPage) return;
    b.openHotelDetailPage(hotelId, buildDetailPageOpts(hotelId, pickId));
  }

  function openVibeTour(hotelId) {
    const b = bridge();
    if (b?.openVibeTourForHotel) b.openVibeTourForHotel(hotelId);
  }

  function toggleScoresTip(ev) {
    ev?.stopPropagation?.();
    const tip = document.getElementById('sr2-scores-tip');
    const btn = document.getElementById('sr2-scores-tip-btn');
    if (!tip || !btn) return;
    const opening = tip.hidden;
    tip.hidden = !opening;
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
  }

  function closeScoresTip(ev) {
    ev?.stopPropagation?.();
    const tip = document.getElementById('sr2-scores-tip');
    const btn = document.getElementById('sr2-scores-tip-btn');
    if (tip) tip.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function openWhyModal() {
    toggleScoresTip();
  }

  function openHowModal() {
    ensureModals();
    closeScoresTip();
    const el = document.getElementById('sr2-modal-how');
    if (el) el.hidden = false;
  }

  function closeModals() {
    closeScoresTip();
    const el = document.getElementById('sr2-modal-how');
    if (el) el.hidden = true;
  }

  function onPopState() {
    if (_offerState && !history.state?.v2Offer) closeOffer({ silent: true });
  }

  function init() {
    ensureModals();
    writeStoredMode();
    applyLayout();
    window.addEventListener('popstate', onPopState);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (_offerState) closeOffer();
        else closeModals();
      }
    });
    document.addEventListener('click', (e) => {
      const tip = document.getElementById('sr2-scores-tip');
      const btn = document.getElementById('sr2-scores-tip-btn');
      if (!tip || tip.hidden) return;
      if (tip.contains(e.target) || e.target === btn || btn?.contains(e.target)) return;
      closeScoresTip();
    });
  }

  // Test hooks (node unit tests)
  global.SearchResultsV2 = {
    MODE_CLASSIC,
    MODE_V2,
    PICK_SLOTS,
    LENSES,
    getMode,
    setMode,
    init,
    applyLayout,
    applyLayoutClasses,
    onSearchLoadingStart,
    syncFromSearchContext,
    isV2Mode,
    selectTopPicks,
    hotelBrandKey,
    sortHotelsForLens,
    lensSortScore,
    pickMetricPct,
    overallMatchPct,
    selectMoreHotels,
    getCuratedHighlightHotelIds,
    repaintCuratedPanel,
    MORE_HOTELS_COUNT,
    getV2Subview,
    resetToCuratedView,
    openSeeAllFullList,
    showCuratedView,
    seeAllClassic,
    openOffer,
    closeOffer,
    openFullDetail,
    openVibeTour,
    openWhyModal,
    toggleScoresTip,
    closeScoresTip,
    openHowModal,
    closeModals,
    refreshCtx,
    buildCtxFromBridge,
    renderV2Panel,
    paintV2Panel,
    getPanelDebugState() {
      const panel = document.getElementById('results-v2');
      return {
        mode: getMode(),
        isV2Mode: isV2Mode(),
        bridge: !!bridge(),
        panelHidden: panel?.hidden ?? null,
        shellReady: panel?.dataset?.shellReady ?? null,
        subview: getV2Subview(),
        moreCards: panel ? panel.querySelectorAll('.sr2-more-card:not(.sr2-more-card--skel)').length : 0,
        innerLen: panel?.innerHTML?.length ?? 0,
      };
    },
  };

  if (typeof window !== 'undefined') {
    window.SearchResultsV2 = global.SearchResultsV2;
    console.log('[SearchResultsV2] module loaded', { moreHotels: MORE_HOTELS_COUNT });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
