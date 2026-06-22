/**
 * TravelByVibe marketing pages — dynamic hotel cards (public, indexable landings).
 * Reads curated IDs from data attributes; enriches via /api/public/marketing-hotels.
 */
(function () {
  'use strict';

  function marketingCity() {
    const body = document.body;
    if (body && body.dataset && body.dataset.marketingCity) return body.dataset.marketingCity;
    const el = document.querySelector('[data-city]');
    if (el && el.getAttribute('data-city')) return el.getAttribute('data-city');
    return 'Mexico City';
  }

  function marketingCampaign() {
    const body = document.body;
    if (body && body.dataset && body.dataset.marketingCampaign) return body.dataset.marketingCampaign;
    const city = marketingCity();
    if (city === 'Paris') return 'paris_seo_2026';
    if (city === 'London') return 'london_seo_2026';
    return 'cdmx_seo_2026';
  }

  function cityLabel(city) {
    if (city === 'Paris') return 'Paris';
    if (city === 'London') return 'London';
    return 'Mexico City';
  }

  function stars(n) {
    const s = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    if (!s) return '';
    return '★'.repeat(s) + '☆'.repeat(5 - s);
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function hotelDetailUrl(id, city) {
    const base = window.location.origin || '';
    return base + '/hotel/' + encodeURIComponent(id) + '?city=' + encodeURIComponent(city || marketingCity());
  }

  function searchUrl(utmContent, extra, city) {
    const base = window.location.origin || '';
    const c = city || marketingCity();
    const q = new URLSearchParams({
      city: c,
      utm_source: 'travelbyvibe',
      utm_medium: 'landing',
      utm_campaign: marketingCampaign(),
      utm_content: utmContent || 'marketing-hotel-card',
    });
    if (extra) Object.keys(extra).forEach((k) => q.set(k, extra[k]));
    return base + '/?' + q.toString();
  }

  function renderCard(h, meta, utmContent, city) {
    const id = h.id;
    const m = meta[id] || {};
    const c = city || marketingCity();
    const name = m.name || h.fallbackName || (cityLabel(c) + ' hotel');
    const photo = m.mainPhoto || '';
    const starStr = stars(m.starRating);
    const rating = m.guestRating ? (Number(m.guestRating).toFixed(1) + '/10 guests') : '';
    const tag = h.tag || '';
    const detail = hotelDetailUrl(id, c);
    const vibe = searchUrl(utmContent, { hotel: id }, c);

    return (
      '<article class="mhotel-card">' +
        '<a class="mhotel-img" href="' + esc(detail) + '" tabindex="-1" aria-hidden="true">' +
          (photo
            ? '<img src="' + esc(photo) + '" alt="" loading="lazy" width="400" height="260" />'
            : '<div class="mhotel-img-ph" aria-hidden="true"></div>') +
        '</a>' +
        '<div class="mhotel-body">' +
          '<h3 class="mhotel-name"><a href="' + esc(detail) + '">' + esc(name) + '</a></h3>' +
          (starStr ? '<p class="mhotel-stars" aria-label="' + esc(String(m.starRating || 0) + ' star hotel') + '">' + starStr + '</p>' : '') +
          (rating ? '<p class="mhotel-rating">' + esc(rating) + '</p>' : '') +
          (tag ? '<p class="mhotel-tag">' + esc(tag) + '</p>' : '') +
          '<p class="mhotel-actions">' +
            '<a class="mhotel-link" href="' + esc(detail) + '">View hotel →</a>' +
            '<a class="mhotel-link mhotel-link-muted" href="' + esc(vibe) + '">Match vibe →</a>' +
          '</p>' +
        '</div>' +
      '</article>'
    );
  }

  function parseHotels(raw) {
    if (!raw) return [];
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch (_) {
      return [];
    }
  }

  async function fetchMeta(ids) {
    if (!ids.length) return {};
    const url = '/api/public/marketing-hotels?ids=' + encodeURIComponent(ids.join(','));
    try {
      const res = await fetch(url);
      if (!res.ok) return {};
      const data = await res.json();
      return data.hotels || {};
    } catch (_) {
      return {};
    }
  }

  async function mountGrid(el) {
    const city = el.getAttribute('data-city') || marketingCity();
    const hotels = parseHotels(el.getAttribute('data-hotels'));
    if (!hotels.length) {
      el.innerHTML = '<p class="mhotel-empty">Hotel picks loading soon — <a href="' + esc(searchUrl(el.getAttribute('data-utm') || 'marketing-empty', null, city)) + '">browse ' + esc(cityLabel(city)) + ' hotels</a>.</p>';
      return;
    }
    el.innerHTML = '<div class="mhotel-loading">Loading hotel photos…</div>';
    const ids = hotels.map((h) => h.id).filter(Boolean);
    const meta = await fetchMeta(ids);
    const utm = el.getAttribute('data-utm') || 'marketing-hotels';
    el.innerHTML = '<div class="mhotel-grid">' + hotels.map((h) => renderCard(h, meta, utm, city)).join('') + '</div>';
  }

  async function mountPreset(el) {
    const preset = el.getAttribute('data-preset');
    const tier = el.getAttribute('data-tier');
    const city = el.getAttribute('data-city') || marketingCity();
    if (!preset) return;
    try {
      const res = await fetch('/marketing/marketing-hotels.json');
      if (!res.ok) throw new Error('preset fetch failed');
      const all = await res.json();
      let hotels = [];
      if (tier && all[preset] && all[preset][tier]) {
        hotels = all[preset][tier];
      } else if (Array.isArray(all[preset])) {
        hotels = all[preset];
      } else if (all[preset] && typeof all[preset] === 'object') {
        const sub = el.getAttribute('data-sub');
        if (sub && all[preset][sub]) hotels = all[preset][sub];
        else hotels = [].concat(...Object.values(all[preset]).filter(Array.isArray));
      }
      el.setAttribute('data-hotels', JSON.stringify(hotels));
      await mountGrid(el);
    } catch (_) {
      el.innerHTML = '<p class="mhotel-empty">Could not load hotel picks. <a href="' + esc(searchUrl('marketing-preset-fail', null, city)) + '">Search ' + esc(cityLabel(city)) + ' hotels →</a></p>';
    }
  }

  function init() {
    document.querySelectorAll('[data-preset]').forEach((el) => { void mountPreset(el); });
    document.querySelectorAll('[data-hotels]:not([data-preset])').forEach((el) => { void mountGrid(el); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
