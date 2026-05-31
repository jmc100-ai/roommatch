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

  const PICK_SLOTS = [
    { id: 'overall', badge: 'Best Overall', badgeClass: 'pick-badge--overall', metricLabel: 'Overall match' },
    { id: 'room_match', badge: 'Best Room Match', badgeClass: 'pick-badge--room', metricLabel: 'Room vibe match' },
    { id: 'area_fit', badge: 'Best Area Fit', badgeClass: 'pick-badge--area', metricLabel: 'Area fit' },
    { id: 'stylish', badge: 'Most Stylish', badgeClass: 'pick-badge--stylish', metricLabel: 'Hotel style match' },
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
      desc: 'Distinct style, cafés, creative neighbourhoods',
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
    try {
      return sessionStorage.getItem(STORAGE_KEY) === MODE_V2 ? MODE_V2 : MODE_CLASSIC;
    } catch (_) {
      return MODE_CLASSIC;
    }
  }

  function writeStoredMode(mode) {
    try {
      sessionStorage.setItem(STORAGE_KEY, mode);
    } catch (_) { /* private mode */ }
  }

  function getMode() {
    return readStoredMode();
  }

  function isV2Mode() {
    return getMode() === MODE_V2;
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
      return b ? b.roomVibeMatchDisplayPct(h) : Math.round(Number(h.vectorScore) || 0);
    }
    if (pickId === 'area_fit') {
      return h.nbhd_fit_pct != null ? Math.round(h.nbhd_fit_pct) : 0;
    }
    if (pickId === 'stylish') {
      return Math.round(Number(h.hotelScore) || 0);
    }
    return 0;
  }

  function pickSortScore(h, pickId) {
    if (pickId === 'area_fit') {
      return h.nbhd_fit_pct != null ? Number(h.nbhd_fit_pct) : -1;
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
    const used = new Set();
    const picks = {};

    const takeBest = (slotId, pool) => {
      let best = null;
      let bestScore = -Infinity;
      for (const h of pool) {
        const id = hotelKey(h);
        if (!id || used.has(id)) continue;
        const s = pickSortScore(h, slotId);
        if (s > bestScore) {
          bestScore = s;
          best = h;
        }
      }
      if (best) used.add(hotelKey(best));
      return best;
    };

    if (list.length) {
      const first = list[0];
      const firstId = hotelKey(first);
      if (firstId) {
        picks.overall = first;
        used.add(firstId);
      }
    }
    picks.room_match = takeBest('room_match', list);
    picks.area_fit = takeBest('area_fit', list);
    picks.stylish = takeBest('stylish', list);

    return picks;
  }

  /**
   * Next N hotels in the active sort — ranks #2..#(N+1), same rows as the top of "See all".
   * Top Picks are curated separately (#1 is usually Best Overall); this grid mirrors the main list.
   */
  function selectMoreHotels(sorted, picks, limit) {
    void picks;
    const list = sorted || [];
    if (list.length <= 1) return [];
    return list.slice(1, 1 + limit);
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
    if (!isV2Mode() || getV2Subview() !== VIEW_CURATED) return;
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
      return `From ${sym}${Number(h.price).toLocaleString()} / night`;
    }
    if (datesEntered && (ui.fetchingPrices || (!ui.pricesLoaded && !ui.ratesFetchDone))) {
      return 'Checking rates…';
    }
    if (datesEntered && ui.pricesLoaded) return 'No rates for your dates';
    return 'Add dates for rates';
  }

  function starsHtml(h) {
    const n = Math.min(5, Math.max(0, Math.round(Number(h.starRating) || 0)));
    if (!n) return '';
    return `<span class="sr2-stars" aria-label="${n} stars">${'★'.repeat(n)}</span>`;
  }

  function renderPickCard(h, slot) {
    if (!h) {
      return `<div class="sr2-pick-card sr2-pick-card--empty"><p class="sr2-pick-empty">Not enough matches yet</p></div>`;
    }
    const pct = pickMetricPct(h, slot.id);
    const photo = heroPhotoUrl(h);
    const b = bridge();
    const title = b ? b.hotelDisplayTitle(h) : (h.name || 'Hotel');
    const nbhd = h.primary_nbhd?.name || h.city || '';
    const rating = h.rating > 0
      ? `<span class="sr2-rating"><strong>${Number(h.rating).toFixed(1)}</strong> (${formatReviewCount(h.reviewCount)})</span>`
      : '';
    const img = photo
      ? `<img class="sr2-pick-img" src="${esc(photo)}" alt="" loading="lazy" />`
      : `<div class="sr2-pick-img sr2-pick-img--ph" aria-hidden="true"></div>`;

    const hid = hotelKey(h);
    return `
      <article class="sr2-pick-card" data-hotel-id="${esc(hid)}" data-pick="${esc(slot.id)}"
        role="button" tabindex="0"
        onclick="SearchResultsV2.openOffer('${esc(hid)}', '${esc(slot.id)}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();SearchResultsV2.openOffer('${esc(hid)}', '${esc(slot.id)}');}">
        <div class="sr2-pick-media">
          ${img}
          <span class="sr2-pick-badge ${slot.badgeClass}">${esc(slot.badge)}</span>
          <span class="match-bubble sr2-pick-match" aria-label="${esc(slot.metricLabel)} ${pct} percent">${pct}%<small>Match</small></span>
        </div>
        <div class="sr2-pick-body">
          <h3 class="sr2-pick-name">${esc(title)}</h3>
          <p class="sr2-pick-meta">
            <span class="sr2-pick-nbhd">${esc(nbhd)}</span>
            ${starsHtml(h)}
            ${rating}
          </p>
          <p class="sr2-pick-price">${esc(priceLine(h))}</p>
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
      ? `<span class="sr2-more-rating"><span class="sr2-stars">${'★'.repeat(Math.min(5, Math.max(0, Math.round(Number(h.starRating) || 0))))}</span> (${formatReviewCount(h.reviewCount)})</span>`
      : '';
    const img = photo
      ? `<img class="sr2-more-img" src="${esc(photo)}" alt="" loading="lazy" />`
      : `<div class="sr2-more-img sr2-more-img--ph" aria-hidden="true"></div>`;
    const hid = hotelKey(h);
    return `
      <article class="sr2-more-card" data-hotel-id="${esc(hid)}" role="button" tabindex="0"
        onclick="SearchResultsV2.openOffer('${esc(hid)}', 'overall')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();SearchResultsV2.openOffer('${esc(hid)}', 'overall');}">
        <div class="sr2-more-media">
          ${img}
          <span class="match-bubble match-bubble--more">${pct}%<small>Match</small></span>
        </div>
        <div class="sr2-more-body">
          <h3 class="sr2-more-name">${esc(title)}</h3>
          <p class="sr2-more-meta"><span class="sr2-more-nbhd">📍 ${esc(nbhd)}</span>${rating}</p>
          <p class="sr2-more-price">${esc(priceLine(h))}</p>
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
          <h2 id="sr2-more-heading" class="sr2-heading">
            <span class="sr2-heading-icon" aria-hidden="true">✦</span> More Hotels You'll Probably Love
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
      '<div class="sr2-section-head"><h2 class="sr2-heading">More Hotels You\'ll Probably Love</h2></div>' +
      `<div class="sr2-more-grid">${skel}</div></section>`
    );
  }

  function renderEmptyStateHtml() {
    return (
      '<div class="sr2-root">' +
      '<section class="sr2-section sr2-section--picks">' +
      '<div class="sr2-section-head"><h2 class="sr2-heading"><span class="sr2-heading-icon" aria-hidden="true">✦</span> Top Picks For Your Vibe</h2></div>' +
      '<p class="sr2-sub">Run a search first to see curated top picks and more matches.</p>' +
      '<div class="sr2-picks-grid">' +
      PICK_SLOTS.map(() => '<div class="sr2-pick-card sr2-pick-card--empty"><p class="sr2-pick-empty">No results yet</p></div>').join('') +
      '</div></section>' +
      renderMoreHotelsSectionSkeleton() +
      '</div>'
    );
  }

  function renderMainPanel(ctx) {
    const sorted = ctx.sortedHotels || [];
    const picks = selectTopPicks(sorted);
    const pickCards = PICK_SLOTS.map((slot) => renderPickCard(picks[slot.id], slot)).join('');
    const total = ctx.total ?? sorted.length;
    const sub = `Different ways to match your vibe · ${total} hotel${total === 1 ? '' : 's'} in this search`;

    return `
      <div class="sr2-root">
        <section class="sr2-section sr2-section--picks" aria-labelledby="sr2-picks-heading">
          <div class="sr2-section-head">
            <h2 id="sr2-picks-heading" class="sr2-heading">
              <span class="sr2-heading-icon" aria-hidden="true">✦</span> Top Picks For Your Vibe
            </h2>
            <button type="button" class="sr2-link-btn" onclick="SearchResultsV2.openWhyModal()">Why these?</button>
          </div>
          <p class="sr2-sub">${sub}</p>
          <div class="sr2-picks-grid">${pickCards}</div>
        </section>
        ${renderMoreHotelsSection(sorted, picks, total)}
        <aside class="sr2-explainer" aria-label="How matching works">
          <span class="sr2-explainer-icon" aria-hidden="true">✦</span>
          <p class="sr2-explainer-text">
            We show a small set of strong matches first — each top pick highlights a different strength.
            The grid below follows your current sort. See all matches for the full searchable list with
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
      <div class="sr2-modal" id="sr2-modal-why" hidden role="dialog" aria-modal="true" aria-labelledby="sr2-modal-why-title">
        <div class="sr2-modal-backdrop" onclick="SearchResultsV2.closeModals()"></div>
        <div class="sr2-modal-panel">
          <button type="button" class="sr2-modal-close" onclick="SearchResultsV2.closeModals()" aria-label="Close">×</button>
          <h2 id="sr2-modal-why-title">Why these hotels?</h2>
          <p>Each of the four cards is a different hotel — chosen for a distinct strength in your search.
            Best Overall follows your main ranking; the other three optimize room match, neighbourhood fit,
            or hotel style without repeating the same property.</p>
        </div>
      </div>
      <div class="sr2-modal" id="sr2-modal-how" hidden role="dialog" aria-modal="true" aria-labelledby="sr2-modal-how-title">
        <div class="sr2-modal-backdrop" onclick="SearchResultsV2.closeModals()"></div>
        <div class="sr2-modal-panel">
          <button type="button" class="sr2-modal-close" onclick="SearchResultsV2.closeModals()" aria-label="Close">×</button>
          <h2 id="sr2-modal-how-title">How it works</h2>
          <p>TravelByVibe scores room photos and hotel character against your Boop vibe. Top picks use
            badge-specific match scores; the grid below uses your overall match. Change sort anytime —
            see all matches for the full list with the same filters as this search.</p>
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
          <button type="button" class="sr2-offer-link" onclick="SearchResultsV2.openFullDetail('${esc(String(hotel.id))}')">Full hotel details →</button>
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
        '<button type="button" class="sr2-full-list-back" onclick="SearchResultsV2.showCuratedView()">← Top picks for your vibe</button>';
      stack.insertBefore(bar, results);
    }
    return bar;
  }

  function onSearchLoadingStart() {
    resetToCuratedView();
    const st = document.getElementById('st-results');
    if (!st?.classList.contains('results-pending')) return;
    if (isV2Mode()) applyLayout();
    else paintV2Panel();
  }

  /** Toggle DOM visibility only (no list re-render). */
  function applyLayoutClasses() {
    const st = document.getElementById('st-results');
    const classic = document.getElementById('results');
    const panel = document.getElementById('results-v2');
    const btn = document.getElementById('resultsUxSwitch');
    const v2 = isV2Mode();
    const full = v2 && getV2Subview() === VIEW_FULL;
    const curated = v2 && !full;
    const bar = ensureFullListBar();

    if (st) {
      st.classList.toggle('results-ux-mode-v2', v2);
      st.classList.toggle('results-ux-mode-classic', !v2);
      st.classList.toggle('sr2-view-full', full);
      st.classList.toggle('sr2-view-curated', curated);
    }
    if (classic) {
      const showClassic = !v2 || full;
      classic.hidden = !showClassic;
      classic.setAttribute('aria-hidden', showClassic ? 'false' : 'true');
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
    if (btn) {
      btn.textContent = v2 ? 'Classic UI' : 'SearchResultsV2';
      btn.setAttribute('aria-pressed', v2 ? 'true' : 'false');
    }
  }

  /**
   * @param {{ renderFullList?: boolean }} opts
   * renderFullList: when true in full subview, call app.js renderSorted() once.
   */
  function applyLayout(opts) {
    const pending = document.getElementById('st-results')?.classList.contains('results-pending');
    const v2 = isV2Mode();
    const full = v2 && getV2Subview() === VIEW_FULL;
    const curated = v2 && !full;

    applyLayoutClasses();
    if (!v2 && !pending) closeOffer({ silent: true });
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
      const ctx = _ctx || refreshCtx();
      if (!ctx || !ctx.sortedHotels?.length) {
        panel.innerHTML = renderEmptyStateHtml();
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

  function setMode(mode) {
    const next = mode === MODE_V2 ? MODE_V2 : MODE_CLASSIC;
    writeStoredMode(next);
    if (next === MODE_V2) {
      refreshCtx();
    } else {
      resetToCuratedView();
    }
    applyLayout();
    if (next === MODE_CLASSIC) bridge()?.renderFullResultsList?.();
    return next;
  }

  function toggle(ev) {
    if (ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }
    const next = isV2Mode() ? MODE_CLASSIC : MODE_V2;
    console.log('[SearchResultsV2] toggle →', next);
    return setMode(next);
  }

  function syncFromSearchContext(ctx) {
    if (ctx && Array.isArray(ctx.sortedHotels)) {
      _ctx = ctx;
    } else {
      refreshCtx();
    }
    // Full list: renderSorted() in app.js already painted #results — do not
    // call applyLayout() here or we loop (applyLayout → renderSorted → sync → …).
    if (isV2Mode() && getV2Subview() === VIEW_FULL) {
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
    if (!isV2Mode()) return;
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
    if (!isV2Mode()) return;
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

  function openWhyModal() {
    ensureModals();
    const el = document.getElementById('sr2-modal-why');
    if (el) el.hidden = false;
  }

  function openHowModal() {
    ensureModals();
    const el = document.getElementById('sr2-modal-how');
    if (el) el.hidden = false;
  }

  function closeModals() {
    ['sr2-modal-why', 'sr2-modal-how'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
  }

  function onPopState() {
    if (_offerState && !history.state?.v2Offer) closeOffer({ silent: true });
  }

  function bindSwitcher() {
    const btn = document.getElementById('resultsUxSwitch');
    if (!btn || btn.dataset.sr2Bound === '1') return;
    btn.dataset.sr2Bound = '1';
    btn.removeAttribute('onclick');
    btn.addEventListener('click', (ev) => toggle(ev));
  }

  function init() {
    ensureModals();
    bindSwitcher();
    applyLayout();
    window.addEventListener('popstate', onPopState);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (_offerState) closeOffer();
        else closeModals();
      }
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
    toggle,
    init,
    applyLayout,
    applyLayoutClasses,
    onSearchLoadingStart,
    syncFromSearchContext,
    isV2Mode,
    selectTopPicks,
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
