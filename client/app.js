  const BACKEND = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3000' : '';

  let PUBLIC_CLIP_SEARCH_ENABLED = false;
  (function loadPublicConfig() {
    const base = BACKEND || '';
    fetch(`${base}/api/public-config`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => {
        PUBLIC_CLIP_SEARCH_ENABLED = !!j.clipSearchEnabled;
        // Late-arriving telemetry/banner config: only apply if the server-injected
        // placeholder wasn't replaced (e.g. local file:// dev). Keeps prod (which
        // injects via serveAppHtml) idempotent.
        const looksLikePlaceholder = (v) => !v || /^__/.test(v);
        if (looksLikePlaceholder(window._POSTHOG_KEY) && j.posthogKey) {
          window._POSTHOG_KEY  = j.posthogKey;
          window._POSTHOG_HOST = j.posthogHost || window._POSTHOG_HOST;
          // PostHog snippet may have already inited a stub; only init for real
          // if the stub is still present and we now have a key.
          try {
            if (window.posthog && typeof window.posthog.init === 'function' && !window.posthog.__loaded) {
              window.posthog.init(j.posthogKey, { api_host: j.posthogHost || 'https://us.i.posthog.com', capture_pageview: false, autocapture: false });
            }
          } catch (_) {}
        }
        if (looksLikePlaceholder(window._BETA_BANNER) && j.betaBanner) {
          window._BETA_BANNER = j.betaBanner;
          if (typeof initBetaBanner === 'function') initBetaBanner();
        }
        if (looksLikePlaceholder(window._RELEASE) && j.release) window._RELEASE = j.release;
        if (looksLikePlaceholder(window._ENV)     && j.env)     window._ENV     = j.env;
      })
      .catch(() => {});
  })();

  // ── Telemetry helpers ──────────────────────────────────────────────────────
  // Persistent per-browser pseudonymous identifier. Used to correlate sessions
  // in PostHog and inserted into LiteAPI booking URLs as `tb_distinct` so we
  // can stitch search → click → conversion if a partner ever shares booking
  // attribution. Stored in localStorage; never includes PII.
  function _getOrMakeDistinctId() {
    try {
      const KEY = 'TB_DISTINCT_ID';
      let v = localStorage.getItem(KEY);
      if (!v) {
        v = (crypto && crypto.randomUUID) ? crypto.randomUUID()
          : 'tb-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(KEY, v);
      }
      return v;
    } catch (_) {
      return 'tb-anon';
    }
  }
  const _TB_DISTINCT_ID = _getOrMakeDistinctId();
  window._TB_DISTINCT_ID = _TB_DISTINCT_ID;

  function track(event, properties) {
    try {
      if (window.posthog && typeof window.posthog.capture === 'function') {
        window.posthog.capture(event, Object.assign({
          release: window._RELEASE || undefined,
          env:     window._ENV     || undefined,
        }, properties || {}));
      }
    } catch (_) {}
  }
  window._tbTrack = track;

  let currentMode = 'vector';
  let clipES = null;
  let clipDone = 0, clipTotal = 10;
  let _lastHotels     = [];
  let _vibeTourPending = false;
  let _vibeTourVisible = false;
  let _vibeTourLastHotels = [];
  let _vibeTourScene = 0;
  let _vibeTourSceneCount = 3;
  let _vibeTourTimer = null;
  let _vibeTouchStartX = null;
  let _vibeTouchStartY = null;
  /** Cleared on close — paired with _vibeTourLoadWaitResolve so skip never hangs the async opener. */
  let _vibeTourLoadWaitTimer = null;
  let _vibeTourLoadWaitResolve = null;
  let _vibeTourAudio = null;
  let _vibeTourPseudoFullscreen = false;
  let _deferResultsRenderUntilTourClose = false;
  /** hotelId → Street View URL array (possibly empty after a completed fetch) */
  const _svFrameCache = {};        // hotelId → urls[] (settled results)
  const _svFrameInFlight = {};     // hotelId → Promise (in-flight dedup)
  const VIBE_TOUR_DEBUG = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
  /** Last /api/vsearch `stats` — used to align match sort with server nbhd blend weight */
  let _lastVsearchStats = null;
  /** Last full /api/vsearch response hotels array — for debug snapshot */
  let _lastVsearchHotels = null;
  /** Last vsearch URL params — for debug snapshot */
  let _lastVsearchUrl = null;

  // ── White-label booking config ──────────────────────────────────────────────
  // Set LITEAPI_WL_DOMAIN in Render env (e.g. "travelboop.nuitee.link").
  // The server injects window._WL_BASE_URL into index.html so it's available
  // BEFORE this module runs. We also read at CALL TIME (not module init) so
  // any late /api/config fallback fetch is honoured too.
  // Leave empty to fall back to Google search (placeholder).
  function _wlBaseUrl() {
    return (window._WL_BASE_URL || '').replace(/\/$/, '');
  }

  /** Append UTM + tb_distinct to any LiteAPI WL URL so we can attribute booking
   *  conversions back to the search/result that produced the click. */
  function _withBookAttribution(urlStr, hotel, roomTypeId) {
    try {
      const u = new URL(urlStr);
      // Don't double-tag; preserve any UTM the partner might already inject.
      if (!u.searchParams.get('utm_source'))   u.searchParams.set('utm_source',   'travelboop');
      if (!u.searchParams.get('utm_medium'))   u.searchParams.set('utm_medium',   'beta');
      if (!u.searchParams.get('utm_campaign')) u.searchParams.set('utm_campaign', 'closed_beta_2026');
      if (!u.searchParams.get('utm_content')) {
        u.searchParams.set('utm_content', roomTypeId ? 'room_offer' : 'hotel_page');
      }
      if (!u.searchParams.get('tb_distinct')) u.searchParams.set('tb_distinct', _TB_DISTINCT_ID);
      return u.toString();
    } catch (_) {
      return urlStr;
    }
  }

  /** Build a white-label deep link for a specific room offer (offerId) or hotel page. */
  function buildBookUrl(hotel, roomTypeId) {
    const wl = _wlBaseUrl();
    if (!wl) {
      // Fallback: Google search until white label is configured
      return `https://www.google.com/search?q=${encodeURIComponent((hotel.name||'') + ' ' + (hotel.city||'') + ' hotel booking')}`;
    }
    // If we have an offerId for this specific room → go straight to checkout
    const offerId = hotel.offerIds?.[roomTypeId];
    if (offerId) return _withBookAttribution(`${wl}/booking?offerId=${encodeURIComponent(offerId)}`, hotel, roomTypeId);

    // Hotel details page with dates pre-filled (user picks their room on the WL).
    // `tab=rooms` opens the Rooms tab instead of Overview on Nuitée WL (e.g. travelboop.nuitee.link).
    const params = new URLSearchParams();
    params.set('tab', 'rooms');
    if (S.checkin)  params.set('checkin',  S.checkin);
    if (S.checkout) params.set('checkout', S.checkout);
    params.set('occupancies', btoa(JSON.stringify([{ adults: 2, children: [] }])));
    return _withBookAttribution(`${wl}/hotels/${hotel.id}?${params.toString()}`, hotel, roomTypeId);
  }

  /** Fire-and-forget PostHog event for any "Find & Book" click. Inline-callable
   *  from onclick attributes; resilient if the SDK isn't loaded. */
  function fireFindBookClick(hotelId, roomTypeId, surface) {
    track('find_book_clicked', {
      hotel_id:     String(hotelId || ''),
      room_type_id: roomTypeId || null,
      surface:      surface || 'unknown',
      city:         (typeof S !== 'undefined' && S.city) || null,
      has_dates:    !!(typeof S !== 'undefined' && S.checkin && S.checkout),
    });
  }
  window._tbFireFindBookClick = fireFindBookClick;
  let selectedNeighborhood = null; // { name, bbox?, polygon? } — polygon is geo JSON for /api/vsearch
  let NEIGHBORHOOD_FLOW_ROWS = []; // indexed rows for fetchAndShowNeighborhoods → selectNeighborhoodFlow
  /** True when neighbourhood grid was opened from hotel results (change area) — different chrome + Choose returns to results. */
  let _nbhdBrowseFromResults = false;

  /**
   * Maps primary_nbhd → neighbourhood vibe % using the SAME pipeline as the nbhd picker
   * (deriveNbhdSignals from vibe_elements + computeBoopMatch + 45–95 city spread).
   * Hotel cards used to use prefs × categorical attributes only — different numbers.
   */
  let _nbhdPickerMatchCache = null; // { city, profileKey, map: Map<string, number> }

  function clearNbhdPickerMatchCache() {
    _nbhdPickerMatchCache = null;
  }

  function nbhdProfileScoringCacheKey() {
    const p = getEffectiveBoopProfileForScoring();
    const prefs = mergeBoopFreetextIntoPrefs(p?.prefs || {}, p?.freetext || '');
    return JSON.stringify({
      prefs,
      dealbreakers: p?.dealbreakers || [],
    });
  }

  function normalizeNbhdNameKey(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/['']/g, '')
      .replace(/\b(center)\b/g, 'centre')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fillNbhdPickerMatchCacheFromRanked(city, rankedHoods) {
    const cityN = normalizeCityName(city || '');
    const profileKey = nbhdProfileScoringCacheKey();
    const map = new Map();
    for (const h of rankedHoods || []) {
      if (typeof h._boop_match !== 'number') continue;
      if (h.name) map.set(normalizeNbhdNameKey(h.name), h._boop_match);
      if (h.id != null && h.id !== '') map.set('__id__:' + String(h.id), h._boop_match);
    }
    _nbhdPickerMatchCache = { city: cityN, profileKey, map };
  }

  function lookupNbhdPickerMatch(nbhd) {
    const c = _nbhdPickerMatchCache;
    if (!c?.map || !nbhd) return null;
    if (c.city !== normalizeCityName(S.city || '')) return null;
    if (c.profileKey !== nbhdProfileScoringCacheKey()) return null;
    if (nbhd.id != null && nbhd.id !== '') {
      const byId = c.map.get('__id__:' + String(nbhd.id));
      if (typeof byId === 'number') return byId;
    }
    if (nbhd.name) {
      const byName = c.map.get(normalizeNbhdNameKey(nbhd.name));
      if (typeof byName === 'number') return byName;
    }
    return null;
  }

  async function prefetchNbhdPickerMatchMap(city) {
    const cityN = normalizeCityName(city || '');
    if (!cityN) return;
    const pk = nbhdProfileScoringCacheKey();
    if (_nbhdPickerMatchCache && _nbhdPickerMatchCache.city === cityN && _nbhdPickerMatchCache.profileKey === pk) return;
    try {
      const resp = await fetch(`${BACKEND}/api/neighborhoods?city=${encodeURIComponent(cityN)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (resp.status === 202 || data.status === 'generating') return;
      const raw = data.neighborhoods || [];
      if (!raw.length) return;
      NBHD_CITY_ROWS[cityKey(cityN)] = raw;
      const ranked = rankNeighborhoodsByBoop(raw.map(h => ({ ...h })));
      fillNbhdPickerMatchCacheFromRanked(cityN, ranked);
    } catch (_) { /* non-fatal */ }
  }
  let selectedCityData     = null; // {name, country_code, lat, lng} from Geoapify autocomplete
  const NBHD_CITY_ROWS = {};
  /** Visible labels for sort buttons — used when re-rendering arrow indicators. */
  const SORT_LABELS = {
    match:                'Best Match',
    'match+price':        'Match + Price',
    'match+price+rating': 'Best Value',
    price:                'Best Price',
    rating:               'Guest Rating',
    stars:                'Stars',
  };
  let _currentSort    = 'match';
  /** Clicking the active sort again flips direction (see getSortedHotelsForDisplay). */
  let _sortReverse    = false;
  let _viewMode       = localStorage.getItem('rmViewMode') || 'cards';
  let _displayedCount = 10;
  let _ratesReqId     = 0;   // incremented per search to discard stale rate responses
  let _pricesLoaded   = false;
  let _fetchingPrices = false;  // true while /api/rates is in flight (shows skeleton)
  let _hasDateSearch  = false;  // true after prices fetched with specific dates
  let _showAvailOnly  = true;   // toggle: only show available rooms (default on when dates entered)
  let _requireFreeCancel = false; // Boop "Free cancellation" must-have: filter using /api/rates policies
  let _propTypeFilter = 'all'; // dropdown: all | hotel | apartment | vacation_home | villa | hostel
  let _priceCurrency  = 'EUR';  // currency returned by rates API
  // Debug-only search version controls (set in console):
  // localStorage.setItem('searchVersion','v2')
  // localStorage.setItem('searchCompare','1')
  const SEARCH_VERSION_OVERRIDE = (() => {
    try {
      const v = (localStorage.getItem('searchVersion') || '').toLowerCase().trim();
      return (v === 'v1' || v === 'v2') ? v : null;
    } catch (_) { return null; }
  })();
  const SEARCH_COMPARE_OVERRIDE = (() => {
    try { return localStorage.getItem('searchCompare') === '1'; } catch (_) { return false; }
  })();
  const QUERY_HISTORY_KEY = 'roomsearch.recentQueries';
  const CITY_HISTORY_KEY  = 'roomsearch.recentCities';
  const BOOP_PROFILE_KEY  = 'roomsearch.boopProfileByCity.v1';
  const HISTORY_LIMIT     = 6;
  /** Default city field + initial `S.city` — launch market (V2 catalog). */
  const DEFAULT_HOME_CITY = 'Mexico City';

  // ════════════════════════════════════════════════════════
  //  DISCOVERY FLOW — 4-step state machine
  // ════════════════════════════════════════════════════════

  // Hardcoded neighbourhood fallback for non-indexed cities
  // Cities that are indexed in our DB (real neighbourhood data available)
  const DB_INDEXED_CITIES = ['Paris', 'Kuala Lumpur'];

  // Returns true if a city has neighbourhood data (DB or fallback hardcoded)
  function cityHasNeighbourhoods(name) {
    const n = name.trim().toLowerCase();
    if (DB_INDEXED_CITIES.some(c => c.toLowerCase() === n)) return true;
    return Object.keys(NBHDS_FALLBACK).some(c => c.toLowerCase() === n);
  }

  const NBHDS_FALLBACK = {
    'London': [
      {name:'Mayfair',       vibe_short:'Luxury, hushed, white-glove',  vibe_long:'London\'s most prestigious postcode — Georgian townhouses, Michelin-starred dining, and the kind of quiet money that doesn\'t need to announce itself.',       tags:['luxury','quiet','returning'],      hotel_count:35, bg:'linear-gradient(160deg,#161010 0%,#0e0c0c 100%)'},
      {name:'Shoreditch',    vibe_short:'Creative, gritty, electric',   vibe_long:'East London\'s creative heartland, where street art covers Victorian warehouses and independent coffee shops outnumber chains.',                               tags:['artsy','nightlife','returning'],   hotel_count:28, bg:'linear-gradient(160deg,#0c0c18 0%,#080810 100%)'},
      {name:'Covent Garden', vibe_short:'Central, theatrical, lively',  vibe_long:'Perpetually busy and unapologetically touristy — but brilliantly placed. Street performers, West End theatres, and some of London\'s oldest market buildings.', tags:['first-timers','central','culture'], hotel_count:42, bg:'linear-gradient(160deg,#121008 0%,#0a0c06 100%)'},
      {name:'South Bank',    vibe_short:'Cultural, riverside, open',    vibe_long:'The Thames at its most accessible — the Tate Modern, the Globe Theatre, and some of the best people-watching in London.',                                      tags:['culture','walkable','views'],      hotel_count:31, bg:'linear-gradient(160deg,#080e16 0%,#060a10 100%)'},
    ],
    'Tokyo': [
      {name:'Shinjuku',  vibe_short:'Neon, electric, never sleeps',  vibe_long:'The city within the city — Shinjuku packs more density into a square kilometre than anywhere on earth. Kabukicho neon, quiet izakayas down hidden alleys.',    tags:['nightlife','first-timers','intense'], hotel_count:80, bg:'linear-gradient(160deg,#0e0818 0%,#080610 100%)'},
      {name:'Shibuya',   vibe_short:'Youth culture, fashion, chaos',  vibe_long:'The crossroads that launched a thousand photos. Shibuya is Tokyo\'s youth and fashion epicentre — equal parts overwhelming and exhilarating.',                 tags:['shopping','nightlife','trendy'],     hotel_count:65, bg:'linear-gradient(160deg,#180808 0%,#100606 100%)'},
      {name:'Ginza',     vibe_short:'Upscale, polished, serene',      vibe_long:'Tokyo\'s answer to the Champs-Élysées, but quieter and more considered. Flagship boutiques, department store basement food halls.',                              tags:['luxury','shopping','calm'],         hotel_count:40, bg:'linear-gradient(160deg,#12100a 0%,#0c0c08 100%)'},
      {name:'Asakusa',   vibe_short:'Old Tokyo, temples, calm',       vibe_long:'Senso-ji Temple, rickshaw rides, and the city that existed before the neon arrived. Tokyo\'s most atmospheric traditional neighbourhood.',                       tags:['culture','returning','historic'],   hotel_count:35, bg:'linear-gradient(160deg,#0c1008 0%,#080c06 100%)'},
    ],
    'New York': [
      {name:'Midtown Manhattan', vibe_short:'Central, iconic, always on',  vibe_long:'The New York of the movies — Times Square, Grand Central, the Empire State Building. Everything is within 20 minutes.',                             tags:['first-timers','business','central'], hotel_count:120, bg:'linear-gradient(160deg,#0e0e18 0%,#080810 100%)'},
      {name:'SoHo',              vibe_short:'Fashion, loft living, art',   vibe_long:'Cast-iron facades, designer boutiques, and the kind of loft aesthetic that inspired a thousand hotel Instagram accounts.',                           tags:['artsy','shopping','style'],         hotel_count:45,  bg:'linear-gradient(160deg,#181008 0%,#100c06 100%)'},
      {name:'Brooklyn',          vibe_short:'Local, diverse, emerging',    vibe_long:'The borough that outgrew its underdog status — Williamsburg\'s rooftops, DUMBO\'s bridges, and Park Slope\'s brownstones.',                         tags:['local-feel','foodie','returning'],   hotel_count:38,  bg:'linear-gradient(160deg,#0c1008 0%,#080c06 100%)'},
      {name:'Lower East Side',   vibe_short:'Gritty cool, nightlife dense', vibe_long:'The best bar density in Manhattan, a legendary music scene, and prices that still make sense. Legendary immigrant neighbourhood turned nightlife hub.', tags:['nightlife','artsy','local-feel'],   hotel_count:28,  bg:'linear-gradient(160deg,#140a0e 0%,#0c0808 100%)'},
    ],
  };

  const STYLES = [
    {
      name:'Bright & Airy Retreat', emoji:'☀️',
      query:'bright airy hotel room large windows natural light open spacious bathroom wide counter sunlit',
      intent:'Sun-filled rooms with large windows and bright, open bathrooms featuring wide counters and plenty of natural light.',
      kws:['large windows','natural light','wide counters'],
      badge:'Bedroom · Bathroom', bg:'linear-gradient(160deg,#1a160a 0%,#0e0c06 100%)',
      photo:'https://images.openai.com/static-rsc-4/fuBKMKPbmfou2khUgBTIsw1HJeco0-MusogTQZvg1zIcuqDARmoh5fpfVRmpWzChUEv_YxoE2IXlXqVa0Khk_8oL6dU18TspmW3aWSMWFyrGD9JDvsU1TOfrmUMaJqHfh_XwSQqAXzTa7Tx6nx3STprdpstB9XCe_34lIc8X5d9GiPY80LtIRiH2WCRaAssQ?purpose=fullsize',
      photos:['https://images.openai.com/static-rsc-4/fuBKMKPbmfou2khUgBTIsw1HJeco0-MusogTQZvg1zIcuqDARmoh5fpfVRmpWzChUEv_YxoE2IXlXqVa0Khk_8oL6dU18TspmW3aWSMWFyrGD9JDvsU1TOfrmUMaJqHfh_XwSQqAXzTa7Tx6nx3STprdpstB9XCe_34lIc8X5d9GiPY80LtIRiH2WCRaAssQ?purpose=fullsize','https://images.openai.com/static-rsc-4/h-bAg7tKE2HCzhJ8KYSUnBy3PTQEyKKrh_nILPcjmKZYQ7j0beeW5BdTdTvjpeCRr7zJPDa5IucMsi2-FLhcoD1o0Ctbmf49jKVuTYOO2Y_1m74NDE6Ko7P40tlsY1OCba0LoMOoCnQgINhH0yL3SED40j8yIUb9AcSSSn-Hgw67YYv9C_rXAg9lmato_9Ek?purpose=fullsize','https://images.openai.com/static-rsc-4/g05Ftb01wA3fXWjsREaleE8q0iKXOzJybQ0sdskh0qZK28cyHVMuatBt4yo1m0X4rSl57EmaqPqcXQFFQfxxk7HNgbrv3hz7XfNGT4byOIJ_MrH_iUVXEXwR_pbvCnZ2X0E8DEI4tNSG46iqz0pG2hGOuudckPcWemyPqLGlE8qPKl0_IS5TbeHUcJ44UWu_?purpose=fullsize']
    },
    {
      name:'Modern Lounge Room', emoji:'🛋️',
      query:'modern hotel room lounge sofa sitting area contemporary sleek design dedicated seating',
      intent:'Sleek, contemporary rooms with a dedicated sitting area—great for relaxing, working, or entertaining.',
      kws:['sofa seating','contemporary','sleek design'],
      badge:'Bedroom · Suite', bg:'linear-gradient(160deg,#10101a 0%,#0a0a12 100%)',
      photo:'https://images.openai.com/static-rsc-4/mu9sKLumh9qP3Xx4f8d7S8nLAfvwoMaygUln7BJaJ-QkXMin2HA3g3nTPtcdjf8PvCqtdlqHTAG1liNSPx7I3K0W4tv35CR0LWEnlLRTf5aWxB8_0wOT7VCNXbU8g33mIRl5wwqmlbowoLTiZnnp1kYoejQvZYdS1xirSl9GGhgdT6en0t15ZusN-NHzhr10?purpose=fullsize',
      photos:['https://images.openai.com/static-rsc-4/mu9sKLumh9qP3Xx4f8d7S8nLAfvwoMaygUln7BJaJ-QkXMin2HA3g3nTPtcdjf8PvCqtdlqHTAG1liNSPx7I3K0W4tv35CR0LWEnlLRTf5aWxB8_0wOT7VCNXbU8g33mIRl5wwqmlbowoLTiZnnp1kYoejQvZYdS1xirSl9GGhgdT6en0t15ZusN-NHzhr10?purpose=fullsize','https://images.openai.com/static-rsc-4/62VqMuSOwUu-VBhKWbhV4L1U1EmOnGkoeEpe7f9SY75NRtoQ8EIpYMYIEcUVBb2gJ4htqEY1BZT6zfuDnu1bmZ3C7hzgCyTFDDnXOw58S3DMqm-bXO9DTRvte1ktc9iZH2Q6TqoPgjJTHwR3uQro3xSxjAiETtAmnCD5_DQRO_P8OB46oXL5F1DDNNibEl99?purpose=fullsize','https://images.openai.com/static-rsc-4/lkAi3DkCmL4ip6F2Ql6-Z1kqVDN5KjfjgXN_JvSH96aWSN3QjrrSmakPZAdLc5lgSapqnoU2LsrJWvDDfTLw4jYKyX6-YbLCPahED4QaAWklhIdI6tHtY-ZAkC8LHSIi6BJNaVvU99qpvxl3Nk0IT-l4M7roGn-iP2PgqCHd0xzTv9eD_cvKjFZFnO8727ap?purpose=fullsize']
    },
    {
      name:'Cozy Boutique Hideaway', emoji:'🕯️',
      query:'cozy boutique hotel room warm lighting layered textures intimate charming snug wood inviting',
      intent:'Warm lighting, layered textures, and intimate design create a snug, inviting atmosphere.',
      kws:['warm lighting','layered textures','intimate'],
      badge:'Boutique · Bedroom', bg:'linear-gradient(160deg,#1e1008 0%,#100a06 100%)',
      photo:'https://images.openai.com/static-rsc-4/wyY5p-q0fK9SnO6qbEO8BuKh3BCuf_AUrsiTR245OhDvnoFIY9MAaZ9g4mBctTyx-T1KmGwjcgvm3mfqcOZWEZWZSoI03Mi2nC0wpvnGBt8Daxb7cB1Z3vEyJVivvjvRFTiBYdwQlsW79YUe7UkhD65prlVNnAA3-iln8cdHeP40Me5UJFwkzB9vAkkHo6Ct?purpose=fullsize',
      photos:['https://images.openai.com/static-rsc-4/wyY5p-q0fK9SnO6qbEO8BuKh3BCuf_AUrsiTR245OhDvnoFIY9MAaZ9g4mBctTyx-T1KmGwjcgvm3mfqcOZWEZWZSoI03Mi2nC0wpvnGBt8Daxb7cB1Z3vEyJVivvjvRFTiBYdwQlsW79YUe7UkhD65prlVNnAA3-iln8cdHeP40Me5UJFwkzB9vAkkHo6Ct?purpose=fullsize','https://images.openai.com/static-rsc-4/7lcl_4XHpTkNxTvOBmP6ipoIfMp9wO9EGZt1sHRAF463utIs2MG6ZfDkKAVXcGTfvgA6LEHEQGq5qA7S-6QaQrZAc64Vnwxylb5lavQhzxlSF6nBngif0ZuT5Nzo51KakrpKYx0msLp2pWip_lrH45VVJ_aO6OlrcPPTq490WHAeAuo6XTbVmB_u38XPF86I?purpose=fullsize','https://images.openai.com/static-rsc-4/L5HDAuoTRUIkcqqhm3uAYgmGa6njZ7iUcIbe6ihTUFmdqFX8Wob_mki-gBeE7IeJ7R5mMi58QRWxK5-hkvW9FOPFajHBU2IGEDg6jaCUZwKcLaK2r9rz-9sa1a7hT-E9SZgo0HK7CZ4jkFPotFz7INCiWaJITMffaJNq68tD7gQCLdYQMclcNcsHZBOUuL-D?purpose=fullsize']
    },
    {
      name:'Ocean View Escape', emoji:'🌊',
      query:'ocean view hotel room water view balcony sea coastal scenic relaxing waves',
      intent:'Rooms centered around stunning water views, often with balconies for a relaxing, scenic stay.',
      kws:['water views','balcony','scenic'],
      badge:'View · Balcony', bg:'linear-gradient(160deg,#061420 0%,#040c14 100%)',
      photo:'https://images.openai.com/static-rsc-4/8SI-HEOK2yc8idCFU1pw4cYQr3GXkhjaKblgneiHFyLwwB8LtssVViT_OetHmnSr49spmqK7whQIEEk0FrN0C5o7a9qTKGzPxtKjGJURdPpMYhzetIlJ2zNQeo57YCzdXikkdU7jI8MdL2Bw4qObYp0l5cbQXxEwrFSh3n0fAQuL590mvSd4GtWwqPYYbHHx?purpose=fullsize',
      photos:['https://images.openai.com/static-rsc-4/8SI-HEOK2yc8idCFU1pw4cYQr3GXkhjaKblgneiHFyLwwB8LtssVViT_OetHmnSr49spmqK7whQIEEk0FrN0C5o7a9qTKGzPxtKjGJURdPpMYhzetIlJ2zNQeo57YCzdXikkdU7jI8MdL2Bw4qObYp0l5cbQXxEwrFSh3n0fAQuL590mvSd4GtWwqPYYbHHx?purpose=fullsize','https://images.openai.com/static-rsc-4/HuLom2TEKH6R1Qh13JyOUaNeFN11plllH10r5SOY18Rs66mGOReuf8bImx6Kk95wPMGE_0GkYnhWnkl0x6Bq1uU8ZyFpN6rXtprW_Ftid1ZIjPSMX0XqkQ9cYRll4B-Z8oqn3EoWYxcSJY7RB6IjsPHaSMR3TYkpWcRzsVeT9yL3J4HTw1rsJQ1uVUL4Gvlg?purpose=fullsize','https://images.openai.com/static-rsc-4/M2_ynZQBfknZUk8PDTTeEAlmgv0J8ObUtvkyXsKEUdhFW_ecgjzlZdZw6wS_dciQWa7L10mgWa5XNWWgI3d2RtSnlw5I5ww9xnv05qlfIzt7Av7hkUdmtiO_fvpt0OsElnRkTTH8YI515genE83Sk6DuXK1xruUmzf8Lj-kx_Ex5bmF4BIzOe9mi-bPI_4A3?purpose=fullsize']
    },
    {
      name:'Luxury Spa Suite', emoji:'🛁',
      query:'luxury spa suite hotel bathroom soaking tub double sinks rainfall shower expansive counter high-end',
      intent:'High-end suites featuring spa-style bathrooms with soaking tubs, double sinks, and expansive counter space.',
      kws:['soaking tub','double sinks','spa finishes'],
      badge:'Suite · Spa Bathroom', bg:'linear-gradient(160deg,#0e1818 0%,#080e10 100%)',
      photo:'https://images.openai.com/static-rsc-4/WpegHOHo8BdNcC3UTFYN46CTsUiEJ7K2Gsr2dpsj9_MzuHryWfrgZdEXd5H4Mz_PkR8JSLaeeomiFVtxs6L3NHLaLwbjiqSD0AzYHM0JGXancfpwk7_Qb_2WFZszJbfHuqUooyf1c2BnJmjlkBU2hfAKuVfSkIVsK5pBE0oyERSNsK1d9TJSuTt5f0vN61Pd?purpose=fullsize',
      photos:['https://images.openai.com/static-rsc-4/WpegHOHo8BdNcC3UTFYN46CTsUiEJ7K2Gsr2dpsj9_MzuHryWfrgZdEXd5H4Mz_PkR8JSLaeeomiFVtxs6L3NHLaLwbjiqSD0AzYHM0JGXancfpwk7_Qb_2WFZszJbfHuqUooyf1c2BnJmjlkBU2hfAKuVfSkIVsK5pBE0oyERSNsK1d9TJSuTt5f0vN61Pd?purpose=fullsize','https://images.openai.com/static-rsc-4/9FzjJo8z8LkvL91iq2_VaI-ByJEw2JOdbDzh85hrtLdxHfnYrYgLygiZs6ST92Ywc7eSrB4es1NgRVJnNoTF4-1ZdwJgw5XpoW3OYnJ9YWDCCZ8W_VhuUt-RhyBJPqKyNkTqmhNtF6_3b-CfEb7XqA07puFnOE6gyyGTofTOWguwoCA3W579U-96-sPKXhFS?purpose=fullsize','https://images.openai.com/static-rsc-4/pSNpQoH1ypfwT-oGt3TjRVFXCki9bkcj9oY8f4FKnT6DVT0RwDRdxVpSyfU6VMbLQs0V_bqmaLvgPgqhAqYyehF_-Mnym5T9o8K2Ht2kYcgX8rEXcQVRiCUPCh5KDtM7jo7Yr0cGWnGvALeGoAyhlQuraEiC0P9sp_9BesIUtXrTQnt6rWBwtIfR7hLWTMhv?purpose=fullsize']
    },
    {
      name:'Work-Friendly Room', emoji:'💼',
      query:'work-friendly hotel room ergonomic desk strong lighting clutter-free business productivity clean layout',
      intent:'Designed for productivity with ergonomic desks, strong lighting, and clutter-free layouts.',
      kws:['desk workspace','strong lighting','clean layout'],
      badge:'Bedroom · Desk', bg:'linear-gradient(160deg,#10141e 0%,#0a0e14 100%)',
      photo:'https://images.openai.com/static-rsc-4/CZzelGAMYeAezplMrQKTX6NkgcNiV8XqbMI1Wy_kKR74I1cqtSUIg2fWwQ2mDhXxL7vhiHGzgCzyjfEs9BAJR-ifZm120vrpc-JwxV3tvjk4fXyldnUXaCPKExrt5ScyOKFGb6qzMJ_uxi3g7bfKvTk9z77dP5FWbPp44XxkD51VcBXs0_l2-krpS78W5P9X?purpose=fullsize',
      photos:['https://images.openai.com/static-rsc-4/CZzelGAMYeAezplMrQKTX6NkgcNiV8XqbMI1Wy_kKR74I1cqtSUIg2fWwQ2mDhXxL7vhiHGzgCzyjfEs9BAJR-ifZm120vrpc-JwxV3tvjk4fXyldnUXaCPKExrt5ScyOKFGb6qzMJ_uxi3g7bfKvTk9z77dP5FWbPp44XxkD51VcBXs0_l2-krpS78W5P9X?purpose=fullsize','https://images.openai.com/static-rsc-4/3gUk1HBeArHZQhUN92kqzxFUPBGnFxvX3f8pHB1zE90JcVllWVccATQGTYiAy0AUwHwRdBpeX3z2oC6UIV9RcTJXDkb2CQVtE5-tkLPlbpG826sYcGOdPurL5sc2vLxxuSGYCbP51ZUQpIQe427YE0_1UMLpW2i4uI3Rd0y-xqd8O5bYVjUk7yrv1d6ob2tA?purpose=fullsize','https://images.openai.com/static-rsc-4/7TbQ4dsYPWjixp5q-brodBNOS3g8XphYM1o9YK3RvilNpXa0rm-VDbKtYDOne1zzW4f2iFvXNn3mmmyS7Gr9ltI_w1xNsqe1vy6rU4tU49gVENIAVyeYOTwQrpzXb19RW16VuNq4tS6u0c_Sm5NFvfcn9uClJpj-xHSAr2FJbkyYhEyAQiivOxFJvt0K_uGZ?purpose=fullsize']
    },
    {
      name:'Family Suite', emoji:'👨‍👩‍👧',
      query:'family suite hotel room multiple beds spacious sofa bed organized kids family-friendly large room',
      intent:'Spacious layouts with multiple beds or sofa beds, giving families room to relax and stay organized.',
      kws:['multiple beds','spacious','sofa bed'],
      badge:'Suite · Family', bg:'linear-gradient(160deg,#12100c 0%,#0c0a08 100%)',
      photo:'https://images.openai.com/static-rsc-4/T5L6we-SmmhGuuMfwhbl2NX3wLLOBBhX6s0MOuAJsSUEnnE2L_Q0Ptcxq0XLFE-HkN8WdzAZqaTjv2EGIenMRlgJwrV5mX4GXuXJGC2RIeVWu-WXj0CsF0BIII8PdF4yfZirxvSBkEaiawDumu4l8UaHrF-7fKv2tZn0QdxxPcso_h9bIoAvypj27KupoPtD?purpose=fullsize',
      photos:['https://images.openai.com/static-rsc-4/T5L6we-SmmhGuuMfwhbl2NX3wLLOBBhX6s0MOuAJsSUEnnE2L_Q0Ptcxq0XLFE-HkN8WdzAZqaTjv2EGIenMRlgJwrV5mX4GXuXJGC2RIeVWu-WXj0CsF0BIII8PdF4yfZirxvSBkEaiawDumu4l8UaHrF-7fKv2tZn0QdxxPcso_h9bIoAvypj27KupoPtD?purpose=fullsize','https://images.openai.com/static-rsc-4/cBAiXZ3FTI8Ycn1cBbjoDrhA9UNvRjwJx3Q4XOMhhE30TeoaTwi4fwmETKuzQH5_Ml3UExh1zoLICl3LOQNV05AKKn_3YoxN6Xg2we4uNAOJHl7Jo99xtgO8PMU68JQP9RG0V1Na6i0_rFKdG1ROb-mNDW7WvWY4tEPlyDIC3j2NvxWI9qzDMtwBt2fyWA17?purpose=fullsize','https://images.openai.com/static-rsc-4/mTvW68-NHn776rzojKhpPpo9wr1_u9pNrQ5TL0lBcetBph9la7WnM7wb6k7efeBwTF68Uq0a4qZ4yOhiuInxh3abdDnTEAyA-3W9MQggtmKL68fsNwQnC6f2TfDA5yuPj1xA-QOOWZN15d1FYX4CBybcWYhciq6kJf3DWhvERMddnSXl5IBcOnMqQH4vH-kT?purpose=fullsize']
    },
    {
      name:'Romantic Minimalist', emoji:'🌙',
      query:'romantic minimalist hotel room soft lighting clean calm uncluttered double vanity bathroom couple intimate',
      intent:'Clean, calming spaces with soft lighting and streamlined bathrooms designed for two to get ready comfortably.',
      kws:['soft lighting','minimal','double vanity'],
      badge:'Bedroom · Couples', bg:'linear-gradient(160deg,#160c14 0%,#0e080c 100%)',
      photo:'https://images.openai.com/static-rsc-4/3x_dSnv1MlAz9_NPokIT9jaAhbQNBfLkHb7waPJah8024p9PrU6xlPrpz3tp397LIKNNigjsljeOpmc8bULsQ4hUXLYMyB8x9IUZZ-czqGzOGITZ9eRDfWeAEceELA8QBI51HcTYMhWgsO8eVt4LarS3wQAJK_IFVQssFu6FHGHpE9tdrfMztO3vfxpa4wL9?purpose=fullsize',
      photos:['https://images.openai.com/static-rsc-4/3x_dSnv1MlAz9_NPokIT9jaAhbQNBfLkHb7waPJah8024p9PrU6xlPrpz3tp397LIKNNigjsljeOpmc8bULsQ4hUXLYMyB8x9IUZZ-czqGzOGITZ9eRDfWeAEceELA8QBI51HcTYMhWgsO8eVt4LarS3wQAJK_IFVQssFu6FHGHpE9tdrfMztO3vfxpa4wL9?purpose=fullsize','https://images.openai.com/static-rsc-4/zWdDs8DUcbvPf-M4sN6jrNxv5q59wzgVLQiQI6hWe_c86UN8vOZ-zZu7u8bc_h0iq3CaWIUGe_6jQS8VHkJm6rW1RdZlVpjFtFa7BO5eSwC5gLfipApd22DNpWeuLg95Z3xK8LwoZTNHaavjxv6JOmNfhlQzvfvPXnEPyrxFgQvULSiy5e_3Gv6BjcVQ-zxx?purpose=fullsize','https://images.openai.com/static-rsc-4/3aLgltJN880PtnYDsiESpfyX4vKv_yjEPVL-eOL38fSNuL_kIt9gUoTtktVupu8oVeuLepr6aWynGHTPn4_cQN4lq-LJtpxirehav3iEdUEcLVHfNZTofMvsG_rMtjZcDgyxarGpWkDW86LJFc6HBdF8mLwzQwcLthC4rJMetL6OcsmGEgPCn4dcsGkaUe9b?purpose=fullsize']
    },
    {
      name:'Urban High-Rise View', emoji:'🌆',
      query:'urban high-rise hotel room city view sweeping skyline panoramic elevated floor-to-ceiling windows night',
      intent:'Elevated rooms with sweeping city views—perfect for travelers who want an energetic, urban feel.',
      kws:['city skyline','high floor','panoramic windows'],
      badge:'High Floor · Views', bg:'linear-gradient(160deg,#081420 0%,#060a12 100%)',
      photo:'https://images.openai.com/static-rsc-4/8MnKNtEVc10jLMVZa735WInkG6GPprdetN-5vxH1xcarVfqXcbJoTeUgxtmI07L2JRAXwLCVeyN4gOdAAaho-kZQ45kRH7PfFmDqbePzOF2kOOgt7-onJv3P5hJPAGa1q2-5gTUw0yW70VGEtCIGO7TxTtp92dtLD6i8-mXmNbJ-3ROjJW-R4rSZ941oOSr_?purpose=fullsize',
      photos:['https://images.openai.com/static-rsc-4/8MnKNtEVc10jLMVZa735WInkG6GPprdetN-5vxH1xcarVfqXcbJoTeUgxtmI07L2JRAXwLCVeyN4gOdAAaho-kZQ45kRH7PfFmDqbePzOF2kOOgt7-onJv3P5hJPAGa1q2-5gTUw0yW70VGEtCIGO7TxTtp92dtLD6i8-mXmNbJ-3ROjJW-R4rSZ941oOSr_?purpose=fullsize','https://images.openai.com/static-rsc-4/8BOqO4AHyw4io0KadHFF__CwMQLN0R6K0MoOeoxqzcMT8alrHmwp3TXd7CF5Cmcpqnh0qlEtie4SXN83FQNNGa1rG0JIYQdwlRmKUlf5GC8WBfXDtFnYbgRr4uwudNKqJOxenb6y5Da0QEuu9Zqqa-HJTO8YEy2M6ffmd8-dgThUoPnvs-V-TISMlNdPLDc7?purpose=fullsize','https://images.openai.com/static-rsc-4/tTVqBLetcwy0kr2j00925VU97jNApjgwDHRE9lgWmSa0e4U884e7OP-ov3riPYOIFBoQLctiJrO6FKNqm7kkcADVDuJhNZGm4fpLCV2UUAGf0tx1pReaTFletsEhAZ4H96HCiobeOQj5YwNlYwqLWCIdD_d3nHZO9tu_iqsOyhleu5o-BIUTtb46JLjiIr2q?purpose=fullsize']
    },
    {
      name:'Nature-Inspired Retreat', emoji:'🌿',
      query:'nature-inspired hotel room earthy materials outdoor view greenery natural wood garden calm organic',
      intent:'Earthy materials and outdoor views create a calming environment that blends comfort with nature.',
      kws:['earthy materials','garden view','natural wood'],
      badge:'Garden · Nature', bg:'linear-gradient(160deg,#0c1808 0%,#081006 100%)',
      photo:'https://images.openai.com/static-rsc-4/tVGf54g8ICwVa-xLwCv-WkaYc27jICsjJolWbq05Lq43x4QmX_jbqZA7mUK0Ci0VSq7MkWQozp0gFSKo1pak_08HATglLsrDEjSwf4xbgGvGrWsw7dXRtJsYc3izGnLX1DJgFa2yMsfAX0BAY44BOgb59nC9qPpAm2WBeR7jWHZLh1vzyBtzRFdtYEAr4NYL?purpose=fullsize',
      photos:['https://images.openai.com/static-rsc-4/tVGf54g8ICwVa-xLwCv-WkaYc27jICsjJolWbq05Lq43x4QmX_jbqZA7mUK0Ci0VSq7MkWQozp0gFSKo1pak_08HATglLsrDEjSwf4xbgGvGrWsw7dXRtJsYc3izGnLX1DJgFa2yMsfAX0BAY44BOgb59nC9qPpAm2WBeR7jWHZLh1vzyBtzRFdtYEAr4NYL?purpose=fullsize','https://images.openai.com/static-rsc-4/eSELWLXYClW5HFIvgTetsK93GmtG1goAenCA23R9LZc5bWOwVBKZDbsIGE36P1KG-EpfKA89620CtNDfDXbh8Sqlql0toVx74QaFd-2Zl0WKzVnTGjuWoAGSNuDc2V5nkKNoMzv82EfwZnHpx3S5JTGefkA66ggQs3b3WsdozVFh4dBF_6XR59aTaot9k-xs?purpose=fullsize','https://images.openai.com/static-rsc-4/14I8gY6VaoXl9ak3H5MOhmjdoN9hThhDw6Sz7tlSjLxzD2U911kOMgzjdVDspUodJJo0QIXIDxcYRz4wuwQqe1xBbHw66BksakKUSNl-izdBgoOGdFJB1mhUrkbohuHtUJbfp6N3zemF0YVMYE3vwT-zqcKS3zms-trd9PyGemdT0Sr5pyXBP-ImlfczedIP?purpose=fullsize']
    },
    {
      name:'Double Vanity Suite', emoji:'🪞',
      query:'hotel bathroom double vanity double sinks generous counter space couples get-ready bathroom wide mirror',
      intent:'Rooms built around spacious bathrooms with double sinks and generous counter space—ideal for couples or group stays.',
      kws:['double sinks','wide counter','couples'],
      badge:'Bathroom · Couples', bg:'linear-gradient(160deg,#141218 0%,#0c0a10 100%)',
      photo:'https://images.openai.com/static-rsc-4/pSNpQoH1ypfwT-oGt3TjRVFXCki9bkcj9oY8f4FKnT6DVT0RwDRdxVpSyfU6VMbLQs0V_bqmaLvgPgqhAqYyehF_-Mnym5T9o8K2Ht2kYcgX8rEXcQVRiCUPCh5KDtM7jo7Yr0cGWnGvALeGoAyhlQuraEiC0P9sp_9BesIUtXrTQnt6rWBwtIfR7hLWTMhv?purpose=fullsize',
      photos:['https://images.openai.com/static-rsc-4/pSNpQoH1ypfwT-oGt3TjRVFXCki9bkcj9oY8f4FKnT6DVT0RwDRdxVpSyfU6VMbLQs0V_bqmaLvgPgqhAqYyehF_-Mnym5T9o8K2Ht2kYcgX8rEXcQVRiCUPCh5KDtM7jo7Yr0cGWnGvALeGoAyhlQuraEiC0P9sp_9BesIUtXrTQnt6rWBwtIfR7hLWTMhv?purpose=fullsize','https://images.openai.com/static-rsc-4/jmCky3GwRCqlR4gkHP39IM52UktXSqRCmrVe6n9ePwhuSbdDandwswRn7-jD5scrvVlUW6qenpNrfxZGMqP06EpMnYocCSdCb9k7md4_afJkUnXxzmEhQgCEw0E8x2AjPlkC4sQ76vWcU92i-hQi6N4I2DWS0dhcqzx2Dgry9dBKLg6O90D_rKW_CgI2v_di?purpose=fullsize','https://images.openai.com/static-rsc-4/YLi36zxImng2sSMhL_xzgwJ4v_n9g5tGA_Uv9NLju4bcd4yCOE6yy9iuYu1jaC5MZIgZupII7Xpcf66WmvquBUy2lDiO34VW4aRS8QieBy_C75HKh8gSgceMppwEYUI3KFp1y37hnNb7kPaN0pqdzRTxnCnWNx9TvxwgZCY8fijvZfS3rLW-n2s75PbthBCB?purpose=fullsize']
    },
  ];

  // App state
  const S = { city: DEFAULT_HOME_CITY, nbhd:null, nbhdBbox:null, style:null, q:null, checkin:null, checkout:null, hotelQ:null, mustHaves:null, boopReentryFromChip:false };
  let _flowFeatIdx = 0;

  // Boop intro profile (persisted per city).
  // `dealbreakers` is the legacy multi-select Set; it's reused as the
  // must-haves picker (each id matches a BOOP_QUESTIONS musthaves option).
  // `freetext` is optional prose appended to room + hotel HyDE seeds and used for light nbhd pref nudges.
  // `advancedKeywords` is an optional editable override for the auto-generated room HyDE seed
  // surfaced on the Q5 (extras) screen as "Search keywords (advanced)".
  const BOOP = { idx:0, prefs:{}, answers:{ group_size:'couple' }, dealbreakers:new Set(), slider:0, saved:null, freetext:'', advancedKeywords:'' };
  const BOOP_WIZARD_IMAGES = {}; // cityKey -> { questionId: { optionId: url } }
  const BOOP_WIZARD_CITY_FALLBACKS = {}; // cityKey -> { questionId: url }
  const BOOP_WIZARD_FETCHING = new Set();
  // BOOP v5 wizard — 5 screens:
  //   1. Trip context       (3 cards)
  //   2. Stay vibe          (4 cards; maps to roomStyle + hotelPersonality internally)
  //   3. Neighbourhood scene (5 cards — pace + location combined; see NBHD_SCENE_SEEDS)
  //   4. Must-haves         (multi-select)
  //   5. Optional free-text (room + hotel seeds; keyword nudges → prefs)
  //
  // Weights accumulate into BOOP.prefs; trip / nbhdScene / stayVibe-derived
  // hotelPersonality + roomStyle drive HyDE seeds in buildBoopSeeds().
  const STAY_VIBE_DERIVED = {
    sleek_polished: { roomStyle: 'sleek',    hotelPersonality: 'polished' },
    cozy_warm:      { roomStyle: 'cozy',     hotelPersonality: 'unique' },
    distinct_unique:{ roomStyle: 'distinct', hotelPersonality: 'unique' },
    simple_value:   { roomStyle: 'sleek',    hotelPersonality: 'economical' },
  };

  const BOOP_QUESTIONS = [
    {
      id:'trip',
      label:'Your trip',
      title:'Have you been to this city before?',
      sub:'We will lean your picks toward classic highlights or quieter local pockets based on what you choose.',
      type:'cards',
      options:[
        { id:'first',  emoji:'🗺️', title:'First time',        note:'Central, iconic, easy to navigate.', image:'https://images.unsplash.com/photo-1521216774850-01bc1c5fe0da?auto=format&fit=crop&w=1200&q=80', weights:{ central:20, iconic:18, calm:8, local:-6 } },
        { id:'repeat', emoji:'🔍', title:'Been before',       note:'Something new each visit.',         image:'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?auto=format&fit=crop&w=1200&q=80', weights:{ local:18, culture:8, central:-3 } },
        { id:'expert', emoji:'🧭', title:'I know it well',    note:'Neighbourhood streets, cafés, trees.', image:'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?auto=format&fit=crop&w=1200&q=80', weights:{ local:20, calm:6, central:-8, iconic:-5 } },
      ]
    },
    // Screen 2 — stay vibe. One UX choice writes both roomStyle + hotelPersonality
    // so room photo search and hotel-profile search keep their separate signals.
    {
      id:'stayVibe',
      label:'Stay style',
      title:'What kind of stay feels right?',
      sub:'This steers both the room look and the hotel personality we search for.',
      type:'cards',
      options:[
        { id:'sleek_polished', emoji:'✨', title:'Sleek & polished', note:'Clean modern rooms, refined service, calm luxury.', image:'images/wizard/sleek-polished.png', weights:{ luxury:14, central:4, calm:8 } },
        { id:'cozy_warm', emoji:'🕯️', title:'Warm & cozy', note:'Warm lighting, texture, comfort, and a relaxed feel.', image:'images/wizard/warm-cozy.png',
          weights:{ calm:14, local:12, culture:6, green:6, cafes:6, iconic:-8, central:-6, luxury:-2, nightlife:2 } },
        { id:'distinct_unique', emoji:'🎨', title:'Distinct & characterful', note:'Boutique, design-led, expressive, or one-of-a-kind.', image:'images/wizard/distinct-characterful.png',
          weights:{ culture:14, local:14, luxury:6, iconic:2 } },
        { id:'simple_value', emoji:'💡', title:'Simple & good value', note:'Clean, functional, practical, and well-priced.', image:'https://images.pexels.com/photos/18201945/pexels-photo-18201945.jpeg?auto=compress&cs=tinysrgb&w=1200',
          weights:{ luxury:-16, iconic:-8, shopping:-8, nightlife:-6, local:8, calm:6 } },
      ]
    },
    // Screen 3 — neighbourhood pace + location in one pick (maps to legacy pace + location for seeds).
    {
      id:'nbhdScene',
      label:'Area',
      title:'What kind of area do you want to stay in?',
      sub:'Pick the street energy and location that feel right — one gut choice.',
      type:'cards',
      options:[
        { id:'buzz_central', emoji:'🌆', label:'Icons & energy', title:'Icons & energy', note:'Sights, crowds, movement — stay in the thick of it.', image:'images/wizard/vibrant-busy.png', weights:{ nightlife:14, central:22, iconic:10, walkability:12, calm:-8, local:-4 } },
        { id:'calm_central', emoji:'🏙️', label:'Calm & central', title:'Calm & central', note:'Easy access without a party outside your window.', image:'images/wizard/nbhd-central.png', weights:{ calm:18, central:20, iconic:10, walkability:8, nightlife:-8, green:6, local:4 } },
        { id:'hip_local', emoji:'🧭', label:'Hip & local', title:'Hip & local', note:'Neighbourhood buzz — cafés and small shops away from postcard corners.', image:'images/wizard/nbhd-trendy.png', weights:{ nightlife:16, local:24, cafes:14, restaurants:14, walkability:12, central:-14, calm:-2, iconic:-18, touristy:-18, luxury:-6 } },
        { id:'leafy_local', emoji:'🌿', label:'Leafy & residential', title:'Leafy & residential', note:'Quiet streets, trees, everyday local pace.', image:'images/wizard/quiet-residential.png', weights:{ calm:18, green:10, local:20, nightlife:-10, cafes:6 } },
        { id:'scenic_open', emoji:'🌊', label:'Open & scenic', title:'Open & scenic', note:'Views, water or skyline — room to breathe.', image:'images/wizard/nbhd-scenic-open.png', weights:{ calm:14, green:12, iconic:16, walkability:8, central:6, local:6, nightlife:-10 } },
      ]
    },
    // Screen 4 — room must-haves (multi-select).
    // These map to DB feature_flags that become must_haves[] on /api/vsearch.
    // "spa_bathroom" & "spacious" don't have single canonical flags — they're
    // handled via composite flags + HyDE seed nudges (see buildBoopSeeds).
    {
      id:'musthaves',
      label:'Must-haves',
      title:'What matters most?',
      type:'chips',
      options:[
        { id:'free_cancellation', flag:null, label:'Free cancellation', hint:'When your dates are set, we favour rates you can cancel without a fee.', image:'https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=1200&q=80', meta:'Add check-in and check-out first' },
        { id:'balcony',      flag:'balcony',   label:'Balcony or view',    hint:'Outdoor space or a real view from the room.',                         image:'images/wizard/musthave-balcony.png' },
        { id:'spa_bathroom', flag:null,        label:'Spa-style bathroom', hint:'Soaking tub or rain shower plus larger counter / double vanity.',     image:'images/wizard/musthave-spa-bathroom.png', seed:'spa-like bathroom, soaking tub, rainfall shower, marble vanity, generous counter space, double sinks' },
        { id:'spacious',     flag:null,        label:'Spacious room',      hint:'Room to spread out, not a closet.',                                    image:'images/wizard/musthave-spacious.png', seed:'spacious hotel room, generous layout, open feel' },
        { id:'work_desk',    flag:'work_desk', label:'Work desk',          hint:'Proper desk to get a few hours done.',                                 image:'images/wizard/musthave-work-desk.png' },
      ]
    },
    // Optional prose; merged into room + hotel seeds; keyword nudges merged into prefs for nbhd vibe %.
    {
      id:'extras',
      label:'Your notes',
      title:'Anything else we should know?',
      sub:'Describe anything else you are looking for across your neighbourhood, hotel, and room vibe — street energy, character, views, or small details.',
      type:'freetext',
    }
  ];

  // nbhdScene tiles → legacy pace + location (HyDE snippets + trip vs area reconciliation).
  const NBHD_SCENE_SEEDS = {
    buzz_central:  { pace: 'vibrant', location: 'central' },
    calm_central:  { pace: 'quiet',   location: 'central' },
    hip_local:     { pace: 'vibrant', location: 'trendy' },
    leafy_local:   { pace: 'quiet',   location: 'trendy' },
    scenic_open:   { pace: 'quiet',   location: 'scenic' },
  };

  function resolveNbhdScene(answers) {
    if (!answers) return 'leafy_local';
    const id = answers.nbhdScene;
    if (id && NBHD_SCENE_SEEDS[id]) return id;
    const p = answers.nbhdPace;
    const l = answers.nbhdLocation;
    if (l === 'scenic') return 'scenic_open';
    if (p === 'vibrant' && l === 'central') return 'buzz_central';
    if (p === 'quiet' && l === 'central') return 'calm_central';
    if (p === 'vibrant' && l === 'trendy') return 'hip_local';
    if (p === 'quiet' && l === 'trendy') return 'leafy_local';
    if (l === 'central') return p === 'vibrant' ? 'buzz_central' : 'calm_central';
    if (l === 'trendy') return p === 'vibrant' ? 'hip_local' : 'leafy_local';
    if (p === 'vibrant') return 'buzz_central';
    if (p === 'quiet') return 'leafy_local';
    return 'leafy_local';
  }

  function migrateBoopProfileAnswersIfNeeded(answers) {
    if (!answers || typeof answers !== 'object') return answers;
    const a = { ...answers };
    if (!a.stayVibe) {
      if (a.hotelPersonality === 'economical') a.stayVibe = 'simple_value';
      else if (a.roomStyle === 'distinct') a.stayVibe = 'distinct_unique';
      else if (a.roomStyle === 'cozy') a.stayVibe = 'cozy_warm';
      else if (a.roomStyle === 'sleek' || a.hotelPersonality === 'polished') a.stayVibe = 'sleek_polished';
      else if (a.hotelPersonality === 'unique') a.stayVibe = 'distinct_unique';
    }
    if (a.stayVibe && STAY_VIBE_DERIVED[a.stayVibe]) {
      a.roomStyle = STAY_VIBE_DERIVED[a.stayVibe].roomStyle;
      a.hotelPersonality = STAY_VIBE_DERIVED[a.stayVibe].hotelPersonality;
    }
    if (!a.nbhdScene && (a.nbhdPace != null || a.nbhdLocation != null)) {
      a.nbhdScene = resolveNbhdScene(a);
    }
    if (a.nbhdScene) {
      delete a.nbhdPace;
      delete a.nbhdLocation;
    }
    const pm = Number(a.priceMatters);
    if (!Number.isFinite(pm)) a.priceMatters = 0;
    else a.priceMatters = Math.max(-100, Math.min(100, Math.round(pm)));
    return a;
  }

  const NBHD_PACE_HOTEL_SNIPPETS = {
    vibrant: 'vibrant busy street, cafés, shops, movement and buzz outside',
    quiet:   'quiet residential streets, leafy, calm, local pace outside',
  };
  const NBHD_LOCATION_HOTEL_SNIPPETS = {
    central: 'popular central area, close to iconic sights, easy sightseeing access',
    trendy:  'trendy local pocket, authentic neighbourhood feel away from tourist crowds',
    scenic:  'scenic open area, skyline and water views, breathing room, resort or waterfront destination feel',
  };

  // ── Flow helpers ──────────────────────────────────────
  const FLOW_STEPS = ['city','review','boop','nbhd','style','dates'];

  function showFlowStep(id) {
    FLOW_STEPS.forEach(s => {
      const el = document.getElementById('st-'+s);
      if (el) el.style.display = (s === id) ? '' : 'none';
    });
    const df = document.getElementById('discovery-flow');
    if (df) df.setAttribute('data-active-step', id);
    const story = document.getElementById('story');
    if (story) {
      const showStory = id !== 'city' && id !== 'boop' && id !== 'review' && !(id === 'nbhd' && _nbhdBrowseFromResults);
      story.classList.toggle('show', showStory);
    }
    window.scrollTo({ top:0, behavior:'smooth' });
  }

  function goToStep(id) {
    let nbhdOpenedFromResults = false;
    // If currently showing results, switch back to discovery flow
    if (document.body.classList.contains('has-results')) {
      nbhdOpenedFromResults = id === 'nbhd';
      document.body.classList.remove('has-results');
      document.getElementById('st-results').style.display     = 'none';
      document.getElementById('discovery-flow').style.display = '';
    }
    if (id === 'city')  { document.getElementById('story').classList.remove('show'); showFlowStep('city'); return; }
    if (id === 'boop'  && !S.city)  return;
    if (id === 'nbhd'  && !S.city)  return;
    if (id === 'style' && !S.nbhd)  { flashMsg('Choose a neighbourhood first'); return; }
    if (id === 'dates' && !S.style) { flashMsg('Choose a room vibe first'); return; }
    if (id === 'boop') {
      startBoopStep();
      showFlowStep('boop');
      return;
    }
    if (id === 'nbhd') {
      _nbhdBrowseFromResults = nbhdOpenedFromResults;
      enterNeighborhoodStep();
    } else {
      _nbhdBrowseFromResults = false;
      document.getElementById('story').classList.add('show');
      showFlowStep(id);
    }
    refreshStory(id);
  }

  function nbhdBackClick() {
    if (_nbhdBrowseFromResults) exitNbhdBrowseToResults();
    else goToStep('city');
  }

  function exitNbhdBrowseToResults() {
    _nbhdBrowseFromResults = false;
    document.getElementById('discovery-flow').style.display = 'none';
    document.getElementById('st-results').style.display     = 'block';
    document.body.classList.add('has-results');
    const story = document.getElementById('story');
    if (story) story.classList.remove('show');
    syncCommandBarFromState();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function completeNbhdBrowseSelection() {
    _nbhdBrowseFromResults = false;
    _nbhdFilter = null;
    syncCommandBarFromState();
    const fakeBtn = { disabled: false, textContent: '' };
    startVectorSearch(S.q, S.city, fakeBtn, S.nbhdBbox);
  }

  function clearResultsNeighborhood(ev) {
    if (ev) {
      ev.stopPropagation();
      ev.preventDefault();
    }
    if (!S.nbhd && !S.nbhdBbox && !selectedNeighborhood) return;
    S.nbhd = null;
    S.nbhdBbox = null;
    selectedNeighborhood = null;
    _nbhdFilter = null;
    syncCommandBarFromState();
    flashMsg('Searching all of ' + S.city + ' — updating results…');
    if (S.q && S.city) {
      const fakeBtn = { disabled: false, textContent: '' };
      startVectorSearch(S.q, S.city, fakeBtn, null);
    } else {
      renderSorted();
    }
  }

  function refreshStory(curId) {
    const order = ['city','nbhd','style'];
    const vals  = { city:S.city, nbhd:S.nbhd, style:S.style };
    const ci    = order.indexOf(curId);
    order.forEach((k,i) => {
      const chip = document.getElementById('sc-'+k);
      const val  = document.getElementById('sv-'+k);
      if (!chip) return;
      chip.className = 's-chip';
      if (vals[k]) {
        chip.classList.add('done');
        val.className  = 's-val';
        val.textContent = vals[k].length > 20 ? vals[k].slice(0,18)+'…' : vals[k];
      } else if (i === ci) {
        chip.classList.add('current');
      } else if (i === ci+1) {
        chip.classList.add('next-up');
      }
    });
    const db = document.getElementById('s-dates-btn');
    if (S.checkin && S.checkout) {
      db.textContent = fmtDate(S.checkin) + ' – ' + fmtDate(S.checkout);
      db.classList.add('set');
    } else {
      db.textContent = '+ Add dates';
      db.classList.remove('set');
    }
  }

  function flashMsg(msg, ms=2400) {
    const b = document.getElementById('mbanner');
    b.textContent = msg; b.classList.add('show');
    setTimeout(() => b.classList.remove('show'), ms);
  }

  function fmtDate(d) {
    // d is YYYY-MM-DD string
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  }

  // ── BOOP INTRO (after city, before neighbourhood) ───
  function cityKey(name) {
    return (name || '').trim().toLowerCase();
  }

  function normalizeCityName(name) {
    return String(name || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }

  function readBoopProfiles() {
    try {
      const raw = JSON.parse(localStorage.getItem(BOOP_PROFILE_KEY) || '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  function writeBoopProfiles(map) {
    localStorage.setItem(BOOP_PROFILE_KEY, JSON.stringify(map || {}));
  }

  function loadBoopProfileForCity(city) {
    const key = cityKey(city);
    if (!key) return null;
    const map = readBoopProfiles();
    const raw = map[key];
    if (!raw) return null;
    return { ...raw, answers: migrateBoopProfileAnswersIfNeeded({ ...(raw.answers || {}) }) };
  }

  function saveBoopProfileForCity(city, profile) {
    const key = cityKey(city);
    if (!key) return;
    const map = readBoopProfiles();
    map[key] = { ...profile, updatedAt: Date.now() };
    writeBoopProfiles(map);
  }

  // True if profile carries wizard answers, prefs, must-haves, or freetext worth scoring on.
  function boopProfileHasAnySignal(profile) {
    if (!profile || typeof profile !== 'object') return false;
    if (String(profile.freetext || '').trim()) return true;
    if (Array.isArray(profile.dealbreakers) && profile.dealbreakers.length) return true;
    const prefs = profile.prefs;
    if (prefs && typeof prefs === 'object' && Object.keys(prefs).some(k => Number(prefs[k]) !== 0)) return true;
    const ans = profile.answers;
    if (ans && typeof ans === 'object' && Object.keys(ans).length) return true;
    return false;
  }

  /**
   * In-memory defaults when user skips with no answers and no saved profile.
   * Not persisted — avoids overwriting real data; gives stable HyDE + nbhd% baselines.
   * Tune: balanced "repeat visitor / calm-central / polished / sleek" (not extreme on any axis).
   */
  function buildEphemeralDefaultBoopProfile() {
    const answers = {
      trip: 'repeat',
      stayVibe: 'sleek_polished',
      roomStyle: 'sleek',
      nbhdScene: 'calm_central',
      hotelPersonality: 'polished',
      priceMatters: 0,
    };
    const normalizedAnswers = migrateBoopProfileAnswersIfNeeded({ ...answers });
    const prefs = {
      walkability: 6, central: 4, local: 6, calm: 5, culture: 5, iconic: 4,
      nightlife: 3, green: 5, cafes: 4, shopping: 3, luxury: 4, foodie: 4,
    };
    const reconciledPrefs = reconcileTripEnvWeights(normalizedAnswers, { ...prefs });
    return {
      answers: normalizedAnswers,
      prefs: reconciledPrefs,
      dealbreakers: [],
      freetext: '',
      updatedAt: Date.now(),
    };
  }

  /**
   * Live wizard answers + prefs (same shape as boopFinish) — only when the user
   * has actually interacted this run. Used so nbhd % updates per screen instead
   * of staying stuck on S.boopProfile from localStorage for the whole wizard.
   */
  function buildLiveWizardBoopProfileForScoring() {
    if (!boopCurrentWizardHasSignal()) return null;
    const normalizedAnswers = migrateBoopProfileAnswersIfNeeded({ ...BOOP.answers });
    const reconciledPrefs = reconcileTripEnvWeights(normalizedAnswers, { ...BOOP.prefs });
    return {
      answers: normalizedAnswers,
      prefs: reconciledPrefs,
      dealbreakers: Array.from(BOOP.dealbreakers || []),
      freetext: BOOP.freetext || '',
      updatedAt: Date.now(),
    };
  }

  /** Profile for nbhd %, refine strip, and neighbourhood ranking — never null when city is set. */
  function getEffectiveBoopProfileForScoring() {
    const activeStep = document.getElementById('discovery-flow')?.getAttribute('data-active-step');
    if (activeStep === 'boop') {
      const live = buildLiveWizardBoopProfileForScoring();
      if (live) return live;
    }
    const fromSession = S.boopProfile;
    const fromDisk = loadBoopProfileForCity(S.city);
    if (boopProfileHasAnySignal(fromSession)) return fromSession;
    if (boopProfileHasAnySignal(fromDisk)) return fromDisk;
    return buildEphemeralDefaultBoopProfile();
  }

  function resetBoopState() {
    BOOP.idx = 0;
    BOOP.prefs = {};
    BOOP.answers = { group_size: 'couple', priceMatters: 0 };
    BOOP.dealbreakers = new Set();
    BOOP.slider = 0;
    BOOP.freetext = '';
    BOOP.advancedKeywords = '';
  }

  function applyBoopWeights(weights) {
    Object.entries(weights || {}).forEach(([k, v]) => {
      BOOP.prefs[k] = (BOOP.prefs[k] || 0) + v;
    });
  }

  function boopEnvLabel(v) {
    if (v <= -60) return 'Very quiet and green';
    if (v <= -20) return 'Leaning calm and leafy';
    if (v < 20) return 'Balanced';
    if (v < 60) return 'Leaning busy and social';
    return 'Very lively and dense';
  }

  function boopBlend(v) {
    return Math.max(0, Math.min(1, (Number(v) + 100) / 200));
  }

  function boopProgressPct() {
    return Math.round(((BOOP.idx + 1) / BOOP_QUESTIONS.length) * 100);
  }

  function boopExtractUrl(entry) {
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    return entry.url || '';
  }

  const BOOP_OPTION_INTENTS = {
    morning: {
      cafe:     { tags:['walkable'], preferElements:['cafes','street_feel','restaurants'], attrs:{ walkability:0.8, culture:0.3, nightlife:-0.2 } },
      park:     { tags:['nature'], preferElements:['parks','street_feel'], attrs:{ nature:1.0, walkability:0.3, nightlife:-0.3 } },
      shopping: { tags:['shopping','luxury'], preferElements:['shops','street_feel'], attrs:{ luxury:1.0, walkability:0.3, nightlife:0.2 } },
      historic: { tags:['culture'], preferElements:['museums','icon_spots','street_feel'], attrs:{ culture:1.0, walkability:0.4, business:-0.2 } },
    },
    night: {
      chill:  { tags:['romantic'], preferElements:['restaurants','cafes','street_feel'], attrs:{ nightlife:-0.6, walkability:0.3, culture:0.2 } },
      street: { tags:['local','walkable'], preferElements:['restaurants','street_feel','cafes'], attrs:{ nightlife:0.2, walkability:0.6, culture:0.3 } },
      trendy: { tags:['nightlife','shopping'], preferElements:['restaurants','shops','street_feel'], attrs:{ nightlife:0.8, luxury:0.6, culture:0.1 } },
      late:   { tags:['nightlife'], preferElements:['street_feel','restaurants','shops'], attrs:{ nightlife:1.0, walkability:0.4, nature:-0.2 } },
    },
    mobility: {
      walk: { tags:['walkable','first-timers'], preferElements:['street_feel','icon_spots','cafes'], attrs:{ walkability:1.0, culture:0.2, business:-0.2 } },
      mix:  { tags:['both','walkable'], preferElements:['street_feel','cafes','restaurants'], attrs:{ walkability:0.7, business:0.2, nightlife:0.1 } },
      ride: { tags:['returning'], preferElements:['icon_spots','street_feel','shops'], attrs:{ walkability:-0.5, business:0.4, luxury:0.2 } },
    },
    environment: {
      calm_green:    { tags:['nature'], preferElements:['parks','street_feel'], attrs:{ nature:1.0, nightlife:-0.8, business:-0.2 } },
      calm_cafe:     { tags:['walkable'], preferElements:['cafes','street_feel'], attrs:{ walkability:0.7, nightlife:-0.5, culture:0.3 } },
      urban_mix:     { tags:['walkable','both'], preferElements:['street_feel','cafes','shops'], attrs:{ walkability:0.8, nightlife:0.2, culture:0.2 } },
      lively_central:{ tags:['nightlife','shopping'], preferElements:['street_feel','shops','restaurants'], attrs:{ nightlife:1.0, luxury:0.4, nature:-0.4 } },
    },
    dealbreakers: {
      noisy:    { tags:['calm'], preferElements:['parks','cafes','street_feel'], attrs:{ nightlife:-1.0, nature:0.4 } },
      far:      { tags:['first-timers','walkable'], preferElements:['icon_spots','street_feel'], attrs:{ walkability:1.0, business:0.2 } },
      touristy: { tags:['returning','local'], preferElements:['street_feel','cafes','restaurants'], attrs:{ culture:0.6, nightlife:0.2 } },
      lowFood:  { tags:['food'], preferElements:['restaurants','cafes','street_feel'], attrs:{ nightlife:0.2, walkability:0.3 } },
    }
  };

  function boopIntentScoreNeighborhood(h, intent) {
    let score = 0;
    const tags = (h.tags || []).map(t => String(t).toLowerCase());
    const visitorType = String(h.visitor_type || '').toLowerCase();
    const attrs = h.attributes || {};

    (intent.tags || []).forEach(tag => {
      if (tags.includes(String(tag).toLowerCase())) score += 1.2;
    });
    (intent.visitor || []).forEach(v => {
      if (visitorType === String(v).toLowerCase()) score += 1.1;
    });

    Object.entries(intent.attrs || {}).forEach(([k, w]) => {
      const raw = Number(attrs[k]);
      const n = Number.isFinite(raw) ? Math.max(0, Math.min(10, raw)) / 10 : 0.5;
      score += (w >= 0 ? n * w : (1 - n) * Math.abs(w));
    });
    return score;
  }

  function boopCollectUrlsFromHood(h, intent) {
    const urls = [];
    const keys = intent.preferElements || [];
    for (const key of keys) {
      const arr = (h.vibe_photos || {})[key] || [];
      for (const p of arr) {
        const u = boopExtractUrl(p);
        if (u) urls.push(u);
      }
    }
    if (h.photo_url) urls.push(h.photo_url);
    return urls;
  }

  function boopPickIntentImage(scored, intent, usedUrls) {
    for (const item of scored) {
      const urls = boopCollectUrlsFromHood(item.hood, intent);
      for (const u of urls) {
        if (!usedUrls.has(u)) {
          usedUrls.add(u);
          return u;
        }
      }
    }
    for (const item of scored) {
      const u = item.hood?.photo_url || '';
      if (u && !usedUrls.has(u)) {
        usedUrls.add(u);
        return u;
      }
    }
    return '';
  }

  function boopNeighborhoodGreenScore(h) {
    const attrs = h?.attributes || {};
    const gs = String(attrs.green_spaces || '').toLowerCase();
    const greenBucket = gs === 'lots' ? 3 : (gs === 'some' ? 2 : 0);
    const parks = Number(attrs?.poi_counts?.parks);
    const parkBucket = Number.isFinite(parks) ? Math.min(3, parks / 4) : 0;
    const tags = (h?.tags || []).map(t => String(t).toLowerCase());
    const tagBoost = (tags.includes('green') || tags.includes('nature')) ? 1 : 0;
    return greenBucket + parkBucket + tagBoost;
  }

  function boopIsGreenParkPhoto(p) {
    const q = String(p?.query || '').toLowerCase();
    if (!q) return true; // no metadata; don't over-reject
    if (/\b(playground|play area|swings?\b|jungle gym|tot lot|splash pad|skatepark)\b/.test(q)) return false;
    return /(\bpark\b|garden|botanic|forest|nature|trail|lake|meadow|lawn|trees?|\bgreen\b|greenway|greenery)/.test(q);
  }

  function boopIsLeafyStreetPhoto(p) {
    const q = String(p?.query || '').toLowerCase();
    if (!q) return false;
    const greenCue = /(tree|trees|leafy|green|garden|boulevard|shaded|residential)/.test(q);
    const streetCue = /(street|sidewalk|walkable|pedestrian|avenue|neighborhood)/.test(q);
    const antiCue = /(skyline|high[-\s]?rise|skyscraper|downtown towers?)/.test(q);
    return greenCue && streetCue && !antiCue;
  }

  function boopIsStreetFoodPhoto(p) {
    const q = String(p?.query || '').toLowerCase();
    if (!q) return false;
    // Prefer explicit vendor/market/street-food cues over generic restaurant photos.
    return /(street food|food stall|vendor|taqueria|taco|night market|market|hawker|cart|mercado|puestos?)/.test(q);
  }

  function boopIsLiveMusicBarPhoto(p) {
    const q = String(p?.query || '').toLowerCase();
    if (!q) return false;
    // Strong nightlife intent: bars + live music / crowd cues.
    return /(bar|pub|cantina|cocktail|mezcal|speakeasy|club|jazz|live music|dj|band|karaoke|music venue|dance|crowd|packed|nightlife)/.test(q);
  }

  function boopIsWineBarInteriorPhoto(p) {
    const q = String(p?.query || '').toLowerCase();
    if (!q) return false;
    // Calm evening intent: explicitly wine-bar + indoor/interior atmosphere.
    const wineBarCue = /(wine bar|wine lounge|vinoteca|enoteca|wine cellar|cocktail bar)/.test(q);
    const interiorCue = /(interior|indoors|inside|cozy|intimate|dim|candle|bar stools?|lounge)/.test(q);
    return wineBarCue && interiorCue;
  }

  function boopPickStrictElementImage(hoods, elementKey, usedUrls, opts = {}) {
    const {
      sourcePriority = [],
      photoPredicate = null,
      allowLoose = true,
      rankScore = null,
    } = opts;
    const ranked = [...hoods].sort((a, b) => {
      const sa = rankScore ? rankScore(a) : 0;
      const sb = rankScore ? rankScore(b) : 0;
      return sb - sa;
    });
    const passes = sourcePriority.length ? sourcePriority : [null];

    for (const source of passes) {
      for (const h of ranked) {
        const arr = (h.vibe_photos || {})[elementKey] || [];
        for (const p of arr) {
          if (source && String(p?.source || '') !== source) continue;
          if (photoPredicate && !photoPredicate(p)) continue;
          const u = boopExtractUrl(p);
          if (u && !usedUrls.has(u)) {
            usedUrls.add(u);
            return u;
          }
        }
      }
    }

    if (!allowLoose) return '';
    for (const h of ranked) {
      const arr = (h.vibe_photos || {})[elementKey] || [];
      for (const p of arr) {
        const u = boopExtractUrl(p);
        if (u && !usedUrls.has(u)) {
          usedUrls.add(u);
          return u;
        }
      }
    }
    return '';
  }

  function boopBuildCityWizardImages(city, hoods) {
    const cityK = cityKey(city);
    if (!cityK || !Array.isArray(hoods) || !hoods.length) return;
    const result = {};
    const usedUrls = new Set();
    Object.entries(BOOP_OPTION_INTENTS).forEach(([qId, options]) => {
      result[qId] = {};
      Object.entries(options).forEach(([oId, intent]) => {
        const scored = hoods
          .map(h => ({ hood: h, s: boopIntentScoreNeighborhood(h, intent) }))
          .sort((a, b) => b.s - a.s);
        result[qId][oId] = boopPickIntentImage(scored, intent, usedUrls);
      });
    });

    // Tight intent lock: "Park walk or jog" must come from park imagery.
    if (result.morning) {
      const greenSorted = [...hoods].sort((a, b) => boopNeighborhoodGreenScore(b) - boopNeighborhoodGreenScore(a));
      const greenCandidates = greenSorted.filter(h => boopNeighborhoodGreenScore(h) >= 3);
      const parkUrl = boopPickStrictElementImage(
        greenCandidates.length ? greenCandidates : greenSorted,
        'parks',
        usedUrls,
        {
          sourcePriority: ['google_places', 'unsplash', 'unsplash_city'],
          photoPredicate: boopIsGreenParkPhoto,
          allowLoose: false,
          rankScore: boopNeighborhoodGreenScore,
        }
      );
      // If no "green park" match, leave dynamic empty so static card image is used.
      result.morning.park = parkUrl || '';
    }

    if (result.environment) {
      const greenSorted = [...hoods].sort((a, b) => boopNeighborhoodGreenScore(b) - boopNeighborhoodGreenScore(a));
      const greenCandidates = greenSorted.filter(h => boopNeighborhoodGreenScore(h) >= 3);
      // Use a dedicated set so this critical card can still pick the best local
      // green-street image even if similar URLs were consumed by earlier cards.
      const calmGreenUsed = new Set();
      const calmGreenUrl =
        boopPickStrictElementImage(greenCandidates.length ? greenCandidates : greenSorted, 'street_feel', calmGreenUsed, {
          // Prefer city-specific street imagery first; Google Places often returns
          // off-intent interiors for this card.
          sourcePriority: ['unsplash_city', 'unsplash', 'google_places'],
          // Keep this loose enough to avoid rejecting valid local street photos.
          photoPredicate: null,
          allowLoose: false,
          rankScore: boopNeighborhoodGreenScore,
        }) ||
        boopPickStrictElementImage(greenCandidates.length ? greenCandidates : greenSorted, 'parks', calmGreenUsed, {
          sourcePriority: ['unsplash_city', 'unsplash', 'google_places'],
          photoPredicate: boopIsGreenParkPhoto,
          allowLoose: false,
          rankScore: boopNeighborhoodGreenScore,
        });
      // Prefer a local leafy-street scene; if unavailable, keep existing fallback behavior.
      result.environment.calm_green = calmGreenUrl || '';
      if (calmGreenUrl) usedUrls.add(calmGreenUrl);
    }

    if (result.night) {
      const wineBarInteriorUrl =
        boopPickStrictElementImage(hoods, 'restaurants', usedUrls, {
          sourcePriority: ['google_places', 'unsplash', 'unsplash_city'],
          photoPredicate: boopIsWineBarInteriorPhoto,
          allowLoose: false,
        }) ||
        boopPickStrictElementImage(hoods, 'cafes', usedUrls, {
          sourcePriority: ['unsplash', 'unsplash_city', 'google_places'],
          photoPredicate: boopIsWineBarInteriorPhoto,
          allowLoose: false,
        });
      // If we can't prove "wine bar interior", keep the static calm-dinner tile image.
      result.night.chill = wineBarInteriorUrl || '';

      const streetFoodUrl =
        boopPickStrictElementImage(hoods, 'restaurants', usedUrls, {
          sourcePriority: ['google_places', 'unsplash', 'unsplash_city'],
          photoPredicate: boopIsStreetFoodPhoto,
          allowLoose: false,
        }) ||
        boopPickStrictElementImage(hoods, 'street_feel', usedUrls, {
          sourcePriority: ['unsplash', 'unsplash_city', 'google_places'],
          photoPredicate: boopIsStreetFoodPhoto,
          allowLoose: false,
        });
      // If we can't prove "street food", keep the static street-food tile image.
      result.night.street = streetFoodUrl || '';

      const lateNightBarUrl =
        boopPickStrictElementImage(hoods, 'restaurants', usedUrls, {
          sourcePriority: ['google_places', 'unsplash', 'unsplash_city'],
          photoPredicate: boopIsLiveMusicBarPhoto,
          allowLoose: false,
        }) ||
        boopPickStrictElementImage(hoods, 'street_feel', usedUrls, {
          sourcePriority: ['google_places', 'unsplash', 'unsplash_city'],
          photoPredicate: boopIsLiveMusicBarPhoto,
          allowLoose: false,
        });
      // If we can't prove "bar + live music", keep the static late-night tile image.
      result.night.late = lateNightBarUrl || '';
    }

    // Per-question city fallback images (still city-specific, no city hardcoding).
    const pickCityQuestionFallback = (questionId, elementKeys = []) => {
      for (const h of hoods) {
        for (const key of elementKeys) {
          const arr = (h.vibe_photos || {})[key] || [];
          for (const p of arr) {
            const u = boopExtractUrl(p);
            if (u) return u;
          }
        }
      }
      for (const h of hoods) {
        if (h.photo_url) return h.photo_url;
      }
      return '';
    };
    BOOP_WIZARD_CITY_FALLBACKS[cityK] = {
      morning: pickCityQuestionFallback('morning', ['cafes', 'parks', 'icon_spots']),
      night: pickCityQuestionFallback('night', ['restaurants', 'street_feel']),
      mobility: pickCityQuestionFallback('mobility', ['street_feel']),
      environment: pickCityQuestionFallback('environment', ['parks', 'street_feel']),
      // dealbreakers: pickCityQuestionFallback('dealbreakers', ['street_feel', 'shops', 'restaurants']),
    };

    BOOP_WIZARD_IMAGES[cityK] = result;
  }

  // True when neighbourhood prefetch produced URLs keyed to *current* BOOP_QUESTIONS ids/options.
  // Used to avoid re-rendering the whole wizard after prefetch: that reloads every <img> and causes
  // a visible flash even when src is unchanged (legacy morning/night maps do not apply to v4 cards).
  function boopWizardCityMapTouchesActiveQuestions(cityK) {
    const map = BOOP_WIZARD_IMAGES[cityK];
    if (!map || typeof map !== 'object') return false;
    return BOOP_QUESTIONS.some(q => {
      const sub = map[q.id];
      if (!sub || typeof sub !== 'object') return false;
      return (q.options || []).some(o => {
        const u = sub[o.id];
        return typeof u === 'string' && u.length > 0;
      });
    });
  }

  function boopGetDynamicImage(questionId, optionId, fallback) {
    // Trip context uses fixed Unsplash art per option; swapping in city-specific
    // hood photos after /api/neighborhoods resolves caused a visible flash.
    if (questionId === 'trip') return fallback;
    // Scenic & Open uses a single curated hero asset (must not swap after prefetch).
    if (questionId === 'nbhdScene' && optionId === 'scenic_open') return fallback;
    // Keep this card literal: users expect a car visual cue.
    if (questionId === 'mobility' && optionId === 'ride') return fallback;
    // Keep dealbreakers literal so intent images never drift.
    if (questionId === 'dealbreakers') return fallback;
    const cityK = cityKey(S.city);
    const cityMap = cityK ? BOOP_WIZARD_IMAGES[cityK] : null;
    const cityFallback = cityK ? BOOP_WIZARD_CITY_FALLBACKS[cityK]?.[questionId] : '';
    const v = cityMap?.[questionId]?.[optionId];
    if (v) return v;
    // Builder sets '' when strict intent photos miss — must use this card's static
    // fallback. Using || would treat '' as missing and reuse one cityFallback URL
    // for every option (e.g. all four "night" tiles looked identical).
    if (v === undefined && cityFallback) return cityFallback;
    return fallback;
  }

  function preloadBoopTripWizardImages() {
    const trip = BOOP_QUESTIONS.find(q => q.id === 'trip');
    if (!trip?.options) return;
    for (const o of trip.options) {
      const href = o.image;
      if (!href || !/^https?:/.test(href)) continue;
      const rid = 'preload-boop-trip-' + o.id;
      if (document.getElementById(rid)) continue;
      const link = document.createElement('link');
      link.id = rid;
      link.rel = 'preload';
      link.as = 'image';
      link.href = href;
      document.head.appendChild(link);
    }
  }

  async function prefetchBoopWizardImages(city) {
    const cityK = cityKey(city);
    if (!cityK || BOOP_WIZARD_IMAGES[cityK] || BOOP_WIZARD_FETCHING.has(cityK)) return;
    BOOP_WIZARD_FETCHING.add(cityK);
    try {
      const resp = await fetch(`${BACKEND}/api/neighborhoods?city=${encodeURIComponent(city)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      const hoods = data.neighborhoods || [];
      if (!hoods.length) return;
      boopBuildCityWizardImages(city, hoods);
      if (
        boopWizardCityMapTouchesActiveQuestions(cityK) &&
        document.getElementById('st-boop')?.style.display !== 'none'
      ) {
        renderBoopQuestion();
      }
    } catch (e) {
      // silently keep static fallbacks
    } finally {
      BOOP_WIZARD_FETCHING.delete(cityK);
    }
  }

  function boopEnergyLabelFromEnv(envValue) {
    if (typeof envValue === 'string') {
      const labels = {
        calm_green: 'Very calm',
        calm_cafe: 'Calm-leaning',
        urban_mix: 'Balanced',
        lively_central: 'Lively-leaning'
      };
      return labels[envValue] || 'Balanced';
    }
    if (typeof envValue !== 'number') return 'Balanced';
    if (envValue <= -40) return 'Calm-leaning';
    if (envValue >= 40) return 'Lively-leaning';
    return 'Balanced';
  }

  function boopEnergyPctFromEnv(envValue) {
    if (typeof envValue === 'string') {
      const p = {
        calm_green: 18,
        calm_cafe: 35,
        urban_mix: 52,
        lively_central: 82
      };
      return p[envValue] ?? 50;
    }
    if (typeof envValue !== 'number') return 50;
    return Math.max(0, Math.min(100, Math.round(((envValue + 100) / 200) * 100)));
  }

  // ── BOOP v4 — Returning-user review screen ────────────────────────────────
  function _reviewChipFor(qId, answerId, freetext) {
    if (qId === '__freetext__') {
      const text = (freetext || '').trim();
      if (!text) return null;
      return { label:'Your notes', value: text.length > 40 ? text.slice(0,38)+'…' : text, qId:'extras' };
    }
    const q = BOOP_QUESTIONS.find(x => x.id === qId);
    if (!q) return null;
    if (q.type === 'chips') {
      const picks = (answerId instanceof Array) ? answerId : [];
      if (!picks.length) return { label:q.label||q.id, value:'None', qId };
      const names = picks.map(id => (q.options || []).find(o => o.id === id)?.label || id);
      return { label:q.label||'Must-haves', value: names.join(', '), qId };
    }
    const opt = (q.options || []).find(o => o.id === answerId);
    if (!opt) return null;
    return { label:q.label || q.id, value: opt.label || opt.title || answerId, qId };
  }

  function renderReviewScreen(profile) {
    const city = S.city || '';
    const cityEl = document.getElementById('review-city-label');
    if (cityEl) cityEl.textContent = city;
    const chipsEl = document.getElementById('review-chips');
    const metaEl  = document.getElementById('review-meta');
    const ans   = profile?.answers || {};
    const deals = Array.isArray(profile?.dealbreakers) ? profile.dealbreakers : [];
    const freetext = profile?.freetext || '';

    const chipSpecs = [];
    for (const q of BOOP_QUESTIONS) {
      if (q.id === 'musthaves') {
        const spec = _reviewChipFor(q.id, deals);
        if (spec) chipSpecs.push(spec);
      } else {
        const spec = _reviewChipFor(q.id, ans[q.id]);
        if (spec) chipSpecs.push(spec);
      }
    }
    const freeSpec = _reviewChipFor('__freetext__', null, freetext);
    if (freeSpec) chipSpecs.push(freeSpec);

    if (chipsEl) {
      chipsEl.innerHTML = chipSpecs.map(s => `
        <button class="review-chip" onclick="reviewEditAnswer('${s.qId}')" title="Edit ${escHtml(s.label)}">
          <span class="review-chip-l">${escHtml(s.label)}</span>
          <span class="review-chip-v">${escHtml(s.value)}</span>
          <span class="review-chip-edit">edit</span>
        </button>
      `).join('');
    }
    if (metaEl) {
      const when = profile?.updatedAt ? new Date(profile.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '';
      metaEl.textContent = when ? `Last updated ${when}` : '';
    }
  }

  function reviewFindHotels() {
    const profile = S.boopProfile || loadBoopProfileForCity(S.city);
    if (!profile) { reviewRetake(); return; }
    runBoopSearch(profile);
  }

  function reviewRetake() {
    // Start fresh wizard, preserving nothing — profile stays in storage until
    // boopFinish() overwrites it.
    startBoopStep();
    refreshStory('boop');
    showFlowStep('boop');
  }

  function reviewEditAnswer(qId) {
    const profile = S.boopProfile || loadBoopProfileForCity(S.city);
    if (!profile) { reviewRetake(); return; }
    // Pre-fill BOOP state with saved answers + prefs so edits only need to
    // flow through the single question the user wants to change.
    BOOP.answers = { ...(profile.answers || {}) };
    BOOP.prefs   = { ...(profile.prefs   || {}) };
    BOOP.dealbreakers = new Set(Array.isArray(profile.dealbreakers) ? profile.dealbreakers : []);
    BOOP.freetext = profile.freetext || '';
    BOOP.saved = profile;
    const qIdx = BOOP_QUESTIONS.findIndex(q => q.id === qId);
    BOOP.idx = qIdx >= 0 ? qIdx : 0;
    showFlowStep('boop');
    renderBoopQuestion();
    refreshStory('boop');
  }

  function startBoopStep() {
    const saved = loadBoopProfileForCity(S.city);
    BOOP.saved = saved;
    resetBoopState();
    renderBoopQuestion();
  }

  function boopUseSaved() {
    const saved = loadBoopProfileForCity(S.city);
    if (!saved) return;
    S.boopProfile = {
      answers: saved.answers || {},
      prefs: saved.prefs || {},
      dealbreakers: Array.isArray(saved.dealbreakers) ? saved.dealbreakers : [],
      freetext: saved.freetext || '',
      updatedAt: saved.updatedAt || Date.now(),
    };
    flashMsg('Using your saved vibe for ' + S.city, 1800);
    enterNeighborhoodStep();
  }

  /** True if current wizard UI has accumulated any weighted answers or picks. */
  function boopCurrentWizardHasSignal() {
    if ((BOOP.freetext || '').trim()) return true;
    if (BOOP.dealbreakers && BOOP.dealbreakers.size > 0) return true;
    if (BOOP.prefs && Object.keys(BOOP.prefs).some(k => Number(BOOP.prefs[k]) !== 0)) return true;
    if (BOOP.answers && Object.keys(BOOP.answers).length > 0) return true;
    return false;
  }

  /**
   * Skip wizard → search.
   * - If the user already made picks, same as Find hotels (persist + search).
   * - If they skipped with an empty wizard, do NOT overwrite localStorage with blanks:
   *   reuse last saved profile for this city if it has signal; else in-memory defaults for this search only.
   */
  function boopSkipToResults() {
    if (!S.city) return;
    flashMsg('Skipping intro — searching hotels', 1800);
    if (boopCurrentWizardHasSignal()) {
      boopFinish();
      return;
    }
    const saved = loadBoopProfileForCity(S.city);
    if (boopProfileHasAnySignal(saved)) {
      S.boopProfile = saved;
      runBoopSearch(saved);
      return;
    }
    const defaults = buildEphemeralDefaultBoopProfile();
    S.boopProfile = defaults;
    runBoopSearch(defaults);
  }

  function boopChoose(questionId, optionId) {
    const q = BOOP_QUESTIONS.find(x => x.id === questionId);
    const o = (q?.options || []).find(x => x.id === optionId);
    if (!q || !o) return;
    // In overlay re-entry mode the user may re-pick the same question. Subtract
    // the previously-applied weights for that question first so prefs do not
    // double-accumulate.
    const prevOptionId = BOOP.answers[questionId];
    if (S.boopReentryFromChip && prevOptionId && prevOptionId !== optionId) {
      const prev = (q.options || []).find(x => x.id === prevOptionId);
      if (prev && prev.weights) {
        Object.entries(prev.weights).forEach(([k, v]) => {
          BOOP.prefs[k] = (BOOP.prefs[k] || 0) - v;
        });
      }
    }
    BOOP.answers[questionId] = optionId;
    if (questionId === 'stayVibe' && STAY_VIBE_DERIVED[optionId]) {
      BOOP.answers.roomStyle = STAY_VIBE_DERIVED[optionId].roomStyle;
      BOOP.answers.hotelPersonality = STAY_VIBE_DERIVED[optionId].hotelPersonality;
    }
    // Only apply weights if this is a new pick (or no previous pick). Re-picking
    // the same option is a no-op so we don't double up.
    if (!S.boopReentryFromChip || prevOptionId !== optionId) {
      applyBoopWeights(o.weights);
    }
    if (S.boopReentryFromChip) {
      // In overlay mode stay on the same screen so the user can confirm by
      // pressing the explicit "Find hotels →" button.
      renderBoopQuestion();
    } else {
      BOOP.idx += 1;
      renderBoopQuestion();
    }
  }

  function boopSliderChanged(v) {
    BOOP.slider = Number(v);
    const label = boopEnvLabel(BOOP.slider);
    const val = document.getElementById('boop-slider-value');
    if (val) val.textContent = label;
    const cap = document.getElementById('boop-slider-caption');
    if (cap) cap.textContent = label;
    const blend = boopBlend(BOOP.slider);
    const qimg = document.getElementById('boop-quiet-img');
    const bimg = document.getElementById('boop-busy-img');
    if (qimg) qimg.style.opacity = (1 - blend).toFixed(2);
    if (bimg) bimg.style.opacity = blend.toFixed(2);
  }

  function boopConfirmSlider() {
    BOOP.answers.environment = BOOP.slider;
    const n = BOOP.slider / 100;
    applyBoopWeights({
      green: Math.round(-n * 14),
      calm: Math.round(-n * 16),
      nightlife: Math.round(n * 16),
      shopping: Math.round(n * 10),
    });
    BOOP.idx += 1;
    renderBoopQuestion();
  }

  function boopToggleDealbreaker(id) {
    if (BOOP.dealbreakers.has(id)) BOOP.dealbreakers.delete(id);
    else BOOP.dealbreakers.add(id);
    renderBoopQuestion();
  }

  function boopSetGroupSize(size) {
    BOOP.answers.group_size = size;
    renderBoopQuestion();
  }

  /** Stay-vibe screen: -100 less … 0 neutral … +100 price very important (Match+Price blend). */
  function boopPriceMattersCaption(n) {
    const v = Math.max(-100, Math.min(100, Number(n) || 0));
    if (v <= -33) return 'Less important';
    if (v >= 33) return 'Very important';
    return 'Neutral';
  }

  function boopPriceMattersInput(v) {
    const n = Math.max(-100, Math.min(100, parseInt(v, 10) || 0));
    BOOP.answers.priceMatters = n;
    const el = document.getElementById('boop-price-matter-cur');
    if (el) el.textContent = boopPriceMattersCaption(n);
  }

  function boopNext() {
    BOOP.idx += 1;
    renderBoopQuestion();
  }

  function boopBack() {
    if (BOOP.idx <= 0) { goToStep('city'); return; }
    BOOP.idx -= 1;
    renderBoopQuestion();
  }

  // ── BOOP v4 — Trip ↔ neighbourhood scene weight reconciliation ───────────
  // Trip (first/repeat/expert) and nbhdScene (central / trendy / scenic) both
  // touch central/local/nightlife/calm. Same dampen/amplify rules as before.
  const BOOP_RECONCILE_KEYS = ['central','local','nightlife','calm'];
  function reconcileTripEnvWeights(answers, rawPrefs) {
    const trip = answers?.trip;
    const sceneId = resolveNbhdScene(answers || {});
    const loc = NBHD_SCENE_SEEDS[sceneId]?.location;
    if (!trip || !loc) return rawPrefs;
    const tripDir = {
      first:  { central:+1, local:-1, iconic:+1, calm:+1 },
      repeat: { central:-1, local:+1 },
      expert: { central:-1, local:+1, calm:+1, iconic:-1 },
    }[trip] || {};
    const locDir = {
      central: { central:+1, local:-1, iconic:+1 },
      trendy:  { central:-1, local:+1 },
      scenic:  { central:-1, local:+1, calm:+1 },
    }[loc] || {};
    const out = { ...rawPrefs };
    for (const k of BOOP_RECONCILE_KEYS) {
      const t = tripDir[k];  const e = locDir[k];
      if (!t || !e) continue;
      const agree = (t > 0 && e > 0) || (t < 0 && e < 0);
      if (out[k] == null) continue;
      out[k] = Math.round(out[k] * (agree ? 0.65 : 1.25));
    }
    return out;
  }

  // ── BOOP v4 — Build search seeds from wizard answers + must-haves ────────
  // roomSeed: natural-language HyDE seed embedded against room_types_index.
  //   Built from roomStyle choice + musthaves picks + optional freetext (extras screen).
  // hotelSeed: trip / hotelPersonality / nbhdScene (pace+location) + optional freetext
  //   — embedded against hotel_profile_index (lobby/bar/pool/description vibe).
  // mustHaves: array of DB feature_flag names → passed as must_haves[] on /api/vsearch.
  function buildBoopSeeds(profile) {
    const ans = profile?.answers || {};
    const picked = new Set(profile?.dealbreakers || []);
    const freetext = (profile?.freetext || '').trim();

    const mustHavesQ = BOOP_QUESTIONS.find(q => q.id === 'musthaves');
    const mustHaveOptions = (mustHavesQ?.options || []).filter(o => picked.has(o.id));

    const mustHaves = [];
    const seedExtras = [];
    for (const o of mustHaveOptions) {
      if (o.flag) mustHaves.push(o.flag);
      if (o.seed) seedExtras.push(o.seed);

      // Extra synonym nudges for flag-only options so HyDE lands near the
      // right photo embeddings even when the DB flag filter is what's really
      // doing the work.
      if (o.id === 'balcony')   seedExtras.push('private balcony, outdoor terrace, view from room');
      if (o.id === 'work_desk') seedExtras.push('work desk, proper workspace, ergonomic chair');
    }

    // Detect explicit feature requests in freetext and elevate them to must_haves.
    // This ensures e.g. "double sinks" typed by the user is treated as a primary
    // criterion rather than a same-weight soft preference alongside ambient style cues.
    const FREETEXT_FLAG_PATTERNS = [
      { rx: /\bdouble\s+sink/i,            flag: 'double_sinks' },
      { rx: /\brainfall\s+shower/i,         flag: 'rainfall_shower' },
      { rx: /\brain\s+shower/i,             flag: 'rainfall_shower' },
      { rx: /\bsoaking\s+tub\b/i,           flag: 'soaking_tub' },
      { rx: /\bfreestanding\s+tub\b/i,      flag: 'soaking_tub' },
      { rx: /\bwalk[\s-]in\s+shower\b/i,    flag: 'walk_in_shower' },
      { rx: /\bwalk[\s-]in\s+closet\b/i,    flag: 'walk_in_closet' },
      { rx: /\bprivate\s+balcony\b/i,       flag: 'private_balcony' },
      { rx: /\bbalcony\b/i,                 flag: 'private_balcony' },
      { rx: /\bking\s+bed\b/i,              flag: 'king_bed' },
      { rx: /\bwater\s+view\b|\bocean\s+view\b|\bsea\s+view\b/i, flag: 'water_view' },
      { rx: /\bskyline\s+view\b/i,          flag: 'skyline_view' },
      { rx: /\bbidet\b/i,                   flag: 'bidet_washlet' },
      { rx: /\bespresso\b/i,                flag: 'espresso_station' },
    ];
    if (freetext) {
      for (const { rx, flag } of FREETEXT_FLAG_PATTERNS) {
        if (rx.test(freetext) && !mustHaves.includes(flag)) {
          mustHaves.push(flag);
        }
      }
    }

    // Room seed: roomStyle aesthetic → primary signal + feature nudges + freetext.
    const roomStyleLabel = {
      sleek: 'sleek modern contemporary room, clean lines, minimalist, soft greys, natural light',
      cozy:  'warm cozy hotel room, layered textures, wood accents, warm ambient lighting, inviting',
      distinct: 'distinctive hotel room, bold expressive design, striking decor with personality, artistic character, eclectic mix of materials and textures, curated art pieces, unconventional and one-of-a-kind aesthetic',
    }[ans.roomStyle] || '';
    const roomValueNudge = ans.hotelPersonality === 'economical'
      ? 'clean practical guest room, comfortable basics, unpretentious good value'
      : '';
    const roomBits = [
      roomStyleLabel || 'hotel room',
      roomValueNudge,
      seedExtras.join(', '),
      freetext,
    ].filter(Boolean);
    const roomSeed = roomBits.join('. ') || 'a comfortable hotel room';

    // Hotel seed: trip + hotelPersonality + nbhdScene (pace + location snippets).
    const tripLabel = {
      first:  'first-time visitor, iconic central location',
      repeat: 'returning visitor, local neighbourhood feel',
      expert: 'local expert, hidden-gem neighbourhood, non-touristy',
    }[ans.trip] || '';
    const personalityLabel = {
      polished: 'polished refined hotel, calm luxury, attentive service, elegant lobby, marble, soft lighting',
      unique:   'boutique hotel with character, design-led, unique personality, quirky art, independent feel',
      economical: 'affordable straightforward hotel, clean functional rooms and lobby, practical amenities, great value, simple comfortable stay without luxury frills',
    }[ans.hotelPersonality] || '';
    const sceneId = resolveNbhdScene(ans);
    const sceneSeed = NBHD_SCENE_SEEDS[sceneId] || NBHD_SCENE_SEEDS.leafy_local;
    const paceLabel = NBHD_PACE_HOTEL_SNIPPETS[sceneSeed.pace] || '';
    const locationLabel = NBHD_LOCATION_HOTEL_SNIPPETS[sceneSeed.location] || '';
    const hotelCharacterNudge = ans.roomStyle === 'distinct'
      ? 'boutique hotel with strong design character, artistic personality, distinctive interiors, independent or lifestyle brand, memorable and expressive spaces'
      : '';
    const hotelBits = [
      tripLabel ? `hotel for ${tripLabel}` : 'hotel',
      personalityLabel,
      locationLabel,
      paceLabel,
      hotelCharacterNudge,
      'thoughtful amenities, bar, restaurant, welcoming arrival',
      freetext ? `Guest priorities and atmosphere notes: ${freetext}` : '',
    ].filter(Boolean);
    const hotelSeed = hotelBits.join('. ');

    return { roomSeed, hotelSeed, mustHaves };
  }

  // Light keyword nudges so optional free-text influences neighbourhood vibe %
  // (merged into prefs for picker ranking + hotel nbhd % when using the picker cache).
  function mergeBoopFreetextIntoPrefs(prefs, freetext) {
    const t = (freetext || '').toLowerCase();
    if (!t.trim()) return { ...(prefs || {}) };
    const out = { ...(prefs || {}) };
    const add = (delta) => {
      Object.entries(delta).forEach(([k, v]) => {
        out[k] = (out[k] || 0) + v;
      });
    };
    if (/\b(quiet|calm|peaceful|tranquil|serene|leafy|residential)\b/.test(t)) add({ calm: 5, nightlife: -3 });
    if (/\b(lively|nightlife|bars|clubs|party|late[-\s]?night|buzzing)\b/.test(t)) add({ nightlife: 6, calm: -3 });
    if (/\b(walkable|walkability|walking distance|stroll|pedestrian)\b/.test(t)) add({ walkability: 5 });
    if (/\b(central|downtown|city centre|city center|heart of)\b/.test(t)) add({ central: 5, iconic: 3 });
    if (/\b(local|authentic|neighbourhood|neighborhood|off the beaten)\b/.test(t)) add({ local: 6, central: -2 });
    if (/\b(luxury|luxurious|upscale|five[-\s]?star|5[-\s]?star|boutique)\b/.test(t)) add({ luxury: 5 });
    if (/\b(budget|affordable|cheap|value|economical)\b/.test(t)) add({ luxury: -5 });
    if (/\b(museum|museums|culture|cultural|art gallery|theatre|theater|historic)\b/.test(t)) add({ culture: 5, iconic: 2 });
    if (/\b(nature|park|parks|garden|green|trees|outdoor)\b/.test(t)) add({ green: 5, calm: 2 });
    if (/\b(shop|shopping|retail|boutiques)\b/.test(t)) add({ shopping: 4 });
    if (/\b(café|cafe|coffee|brunch)\b/.test(t)) add({ cafes: 4 });
    if (/\b(view|views|skyline|rooftop|waterfront|river|canal)\b/.test(t)) add({ iconic: 3, calm: 1 });
    return out;
  }

  function boopFinish() {
    const normalizedAnswers = migrateBoopProfileAnswersIfNeeded({ ...BOOP.answers });
    const reconciledPrefs = reconcileTripEnvWeights(normalizedAnswers, BOOP.prefs);
    const advancedKw = (BOOP.advancedKeywords || '').trim();
    const profile = {
      answers: normalizedAnswers,
      prefs: reconciledPrefs,
      dealbreakers: Array.from(BOOP.dealbreakers),
      freetext: BOOP.freetext || '',
      advancedKeywords: advancedKw || null,
      updatedAt: Date.now(),
    };
    BOOP.answers = normalizedAnswers;
    S.boopProfile = profile;
    saveBoopProfileForCity(S.city, profile);
    clearNbhdPickerMatchCache();

    // Drop the overlay-mode chrome before transitioning to results so the
    // results screen renders cleanly (no fixed backdrop / blur left behind).
    if (S.boopReentryFromChip) {
      document.body.classList.remove('boop-overlay-mode');
      // Hide #discovery-flow immediately to avoid a visual flash while the
      // search request is being kicked off.
      const df = document.getElementById('discovery-flow');
      if (df) df.style.display = 'none';
      const sr = document.getElementById('st-results');
      if (sr) sr.style.display = 'block';
      document.body.classList.add('has-results');
    }

    // BOOP v4 — skip nbhd + style selection; go straight to results.
    // User can still refine neighbourhood via the results-page refine strip.
    runBoopSearch(profile);
  }

  // ── Vibe chips on results toolbar ────────────────────────────────
  // Steps that surface as taps on the results-page chip strip. Q5 (extras) is
  // exposed via the separate "Advanced search ▾" button next to the chips.
  const VIBE_CHIP_STEPS = ['trip', 'stayVibe', 'nbhdScene', 'musthaves'];

  // Icon for the must-have chip. Mirrors the labels in BOOP_QUESTIONS musthaves.
  const MUSTHAVE_ICONS = {
    free_cancellation: '✓',
    balcony: '🌅',
    spa_bathroom: '🛁',
    spacious: '🏠',
    work_desk: '💼',
  };
  const GROUP_ICONS = { solo: '👤', couple: '👥', group: '👥' };
  const GROUP_LABELS = { solo: 'Solo', couple: 'Couple', group: 'Group' };

  function syncRequireFreeCancelFlag() {
    const db = S.boopProfile?.dealbreakers;
    _requireFreeCancel = Array.isArray(db) && db.includes('free_cancellation');
  }

  function updateFreeCancelHint() {
    const el = document.getElementById('freeCancelHint');
    if (!el) return;
    el.classList.remove('is-on');
    if (!_requireFreeCancel) {
      el.textContent = '';
      return;
    }
    const hasDates = !!(S.checkin && S.checkout && S.checkin < S.checkout);
    if (!hasDates) {
      el.textContent = 'Free cancellation: add travel dates to filter.';
      el.classList.add('is-on');
      return;
    }
    if (!_pricesLoaded) {
      el.textContent = 'Free cancellation: checking live rate policies…';
      el.classList.add('is-on');
      return;
    }
    el.textContent = '';
  }

  function _activeBoopProfileForChips() {
    if (boopProfileHasAnySignal(S.boopProfile)) return S.boopProfile;
    if (S.city) {
      const saved = loadBoopProfileForCity(S.city);
      if (boopProfileHasAnySignal(saved)) return saved;
    }
    return null;
  }

  function renderVibeChips() {
    const row = document.getElementById('vibe-chip-row');
    if (!row) return;
    const profile = _activeBoopProfileForChips() || {};
    const ans = profile.answers || {};
    const dealbreakers = new Set(Array.isArray(profile.dealbreakers) ? profile.dealbreakers : []);
    const groupSize = ans.group_size || 'couple';

    const chips = [];
    for (const stepKey of VIBE_CHIP_STEPS) {
      if (stepKey === 'musthaves') {
        const mh = BOOP_QUESTIONS.find(q => q.id === 'musthaves');
        const pickedOpts = (mh?.options || []).filter(o => dealbreakers.has(o.id));
        const groupIcon = GROUP_ICONS[groupSize] || '👥';
        const groupLabel = GROUP_LABELS[groupSize] || 'Couple';
        let text, icon = groupIcon;
        if (pickedOpts.length === 0) {
          text = groupLabel;
        } else if (pickedOpts.length === 1) {
          icon = MUSTHAVE_ICONS[pickedOpts[0].id] || groupIcon;
          text = `${groupLabel} · ${pickedOpts[0].label}`;
        } else {
          icon = MUSTHAVE_ICONS[pickedOpts[0].id] || groupIcon;
          text = `${groupLabel} · ${pickedOpts.length} must-haves`;
        }
        chips.push(_chipHtml(stepKey, icon, text, false));
        continue;
      }
      const q = BOOP_QUESTIONS.find(x => x.id === stepKey);
      const optId = ans[stepKey];
      const opt = (q?.options || []).find(o => o.id === optId);
      if (opt) {
        chips.push(_chipHtml(stepKey, opt.emoji || '', opt.title || opt.label || '', false));
      } else {
        chips.push(_chipHtml(stepKey, '', _emptyChipLabelFor(stepKey), true));
      }
    }
    row.innerHTML = chips.join('');
  }

  function _emptyChipLabelFor(stepKey) {
    if (stepKey === 'trip') return '+ Trip';
    if (stepKey === 'stayVibe') return '+ Stay vibe';
    if (stepKey === 'nbhdScene') return '+ Neighbourhood';
    return '+ Add';
  }

  function _chipHtml(stepKey, icon, label, isEmpty) {
    const safeLabel = escHtml(label);
    const safeStep = escHtml(stepKey);
    if (isEmpty) {
      return `<button type="button" class="vibe-chip vibe-chip-empty" onclick="openBoopFromChip('${safeStep}')">${safeLabel}</button>`;
    }
    const iconHtml = icon ? `<span class="vibe-chip-icon">${escHtml(icon)}</span>` : '';
    return `<button type="button" class="vibe-chip" onclick="openBoopFromChip('${safeStep}')" aria-label="Edit ${safeLabel}">${iconHtml}<span class="vibe-chip-text">${safeLabel}</span><span class="vibe-chip-pencil" aria-hidden="true">✎</span></button>`;
  }

  // Open the existing Boop wizard at a specific question, rendered as a modal
  // overlay over the results screen. Reuses #st-boop markup + renderBoopQuestion
  // so the look/feel matches the first-time flow.
  function openBoopFromChip(stepKey) {
    if (!S.city) { flashMsg('Pick a city first'); return; }
    const allSteps = ['trip', 'stayVibe', 'nbhdScene', 'musthaves', 'extras'];
    let idx = allSteps.indexOf(stepKey);
    if (idx < 0) idx = BOOP_QUESTIONS.findIndex(q => q.id === stepKey);
    if (idx < 0) idx = 0;
    // Hydrate BOOP state from whatever profile we have (S.boopProfile or saved
    // for this city) so re-picks operate on the user's existing answers and
    // any text in extras / advanced keywords pre-populates correctly.
    const profile = _activeBoopProfileForChips()
      || (S.city ? loadBoopProfileForCity(S.city) : null)
      || null;
    resetBoopState();
    if (profile) {
      BOOP.answers = { ...(profile.answers || { group_size: 'couple' }) };
      BOOP.prefs = { ...(profile.prefs || {}) };
      BOOP.dealbreakers = new Set(Array.isArray(profile.dealbreakers) ? profile.dealbreakers : []);
      BOOP.freetext = profile.freetext || '';
      BOOP.advancedKeywords = (profile.advancedKeywords || '').toString();
      BOOP.saved = profile;
    }
    BOOP.idx = idx;
    S.boopReentryFromChip = true;
    document.body.classList.add('boop-overlay-mode');
    // Make sure the wizard chapter is visible inside #discovery-flow before
    // we display the flow as an overlay. showFlowStep wires the panel display
    // toggles; the .boop-overlay-mode CSS handles the rest.
    showFlowStep('boop');
    renderBoopQuestion();
    // Trap scroll on the results page while the overlay is open.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  function closeBoopOverlay() {
    document.body.classList.remove('boop-overlay-mode');
    S.boopReentryFromChip = false;
    // Hide the wizard chapter and restore the results view.
    const df = document.getElementById('discovery-flow');
    if (df) df.style.display = 'none';
    const sr = document.getElementById('st-results');
    if (sr) sr.style.display = 'block';
    document.body.classList.add('has-results');
    // Refresh the chip labels in case anything was edited mid-session.
    renderVibeChips();
  }

  // ESC + click-on-backdrop close the overlay. We attach once on script load
  // and let the .boop-overlay-mode body class gate behaviour.
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('boop-overlay-mode')) {
        e.preventDefault();
        closeBoopOverlay();
      }
    });
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('boop-overlay-mode')) return;
      // Backdrop click = the overlay container itself, not its modal child.
      const df = document.getElementById('discovery-flow');
      if (df && e.target === df) closeBoopOverlay();
    });
  }

  // Build seeds + trigger vector search. Shared by boopFinish() and the
  // returning-user review screen's "Find hotels" button.
  function runBoopSearch(profile) {
    const { roomSeed: autoRoomSeed, hotelSeed, mustHaves } = buildBoopSeeds(profile);
    // If the user edited the "Search keywords (advanced)" textarea on Q5 we
    // honour their override as the room-side HyDE seed. The hotel seed +
    // mustHaves are still derived from the wizard answers.
    const overrideKw = (profile?.advancedKeywords || '').trim();
    const roomSeed = overrideKw || autoRoomSeed;
    S.q = roomSeed;   // store as the active query so breadcrumbs + refinements work
    S.hotelQ = hotelSeed;
    S.mustHaves = mustHaves;
    _vibeTourPending = true;
    _vibeTourVisible = false;
    _vibeTourScene = 0;
    const fakeBtn = { disabled:false, textContent:'' };
    // Use any previously selected neighbourhood bbox (if user jumped to nbhd then back)
    selectedNeighborhood = null; // reset to city-wide by default
    startVectorSearch(roomSeed, S.city, fakeBtn, null);
  }

  function renderBoopQuestion() {
    const wrap = document.getElementById('boop-wrap');
    if (!wrap) return;
    const q = BOOP_QUESTIONS[BOOP.idx];
    if (!q) { boopFinish(); return; }
    wrap.className = 'boop-wrap'
      + (q.type === 'chips' ? ' boop-wrap--deal' : '')
      + (q.type === 'freetext' ? ' boop-wrap--freetext' : '');
    const p = boopProgressPct();
    /* Saved vibe banner — restore to show Use saved / Retake on first screen when a profile exists
    const saved = loadBoopProfileForCity(S.city);
    const savedTs = saved?.updatedAt ? new Date(saved.updatedAt).toLocaleDateString() : null;
    const savedUi = (BOOP.idx === 0 && saved)
      ? `<div class="boop-saved"><strong>Saved vibe found</strong>${savedTs ? ` · last updated ${savedTs}` : ''}. <button class="boop-btn subtle" style="margin-left:8px" onclick="boopUseSaved()">Use saved</button> <button class="boop-btn subtle" style="margin-left:6px" onclick="resetBoopState();renderBoopQuestion()">Retake</button></div>`
      : '';
    */
    const savedUi = '';

    const overlayMode = !!S.boopReentryFromChip;
    let body = '';
    if (q.type === 'cards') {
      const gridClass = (q.options && q.options.length === 4)
        ? ' boop-grid--quad'
        : ((q.options && q.options.length >= 3) ? ' boop-grid--triple' : '');
      const currentPick = BOOP.answers[q.id];
      let priceMatterBlock = '';
      if (q.id === 'stayVibe') {
        if (BOOP.answers.priceMatters == null || !Number.isFinite(Number(BOOP.answers.priceMatters))) {
          BOOP.answers.priceMatters = 0;
        }
        const pm = Math.max(-100, Math.min(100, Number(BOOP.answers.priceMatters) || 0));
        const pmCaption = boopPriceMattersCaption(pm);
        priceMatterBlock = `<div class="boop-price-matter">
          <div class="boop-price-matter-label">How much should price matter?</div>
          <div class="boop-price-matter-ends">
            <span>Less important</span>
            <span>Very important</span>
          </div>
          <input type="range" class="boop-price-matter-range" id="boop-price-matter-range" min="-100" max="100" step="1" value="${pm}"
            oninput="boopPriceMattersInput(this.value)"
            aria-valuemin="-100" aria-valuemax="100" aria-valuenow="${pm}" aria-valuetext="${escHtml(pmCaption)}" />
          <div class="boop-price-matter-cur" id="boop-price-matter-cur">${escHtml(pmCaption)}</div>
        </div>`;
      }
      body = `${priceMatterBlock}<div class="boop-grid${gridClass}">${q.options.map((o, cardIdx) => {
        const isCurrent = overlayMode && o.id === currentPick;
        return `
        <button class="boop-card${isCurrent ? ' boop-card--current' : ''}" onclick="boopChoose('${q.id}','${o.id}')">
          <div class="boop-card-media">
            <img src="${boopGetDynamicImage(q.id, o.id, o.image)}" alt="${o.title}" ${q.id === 'trip' ? `loading="eager" decoding="async"${cardIdx === 0 ? ' fetchpriority="high"' : ''}` : 'loading="lazy"'} onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1200&q=80';" />
            <div class="boop-card-grad"></div>
            <div class="boop-card-body">
              <div class="boop-card-emoji">${o.emoji}</div>
              <div class="boop-card-title">${o.title}</div>
              <div class="boop-card-note">${o.note || ''}</div>
            </div>
          </div>
        </button>
      `;
      }).join('')}</div>`;
      // Overlay re-entry from a chip: surface an explicit "Find hotels" button
      // so the user can commit the (re-)pick without auto-advancing.
      if (overlayMode) {
        body += `<div class="boop-actions" style="margin-top:18px">
          <button type="button" class="boop-btn subtle" onclick="closeBoopOverlay()">Cancel</button>
          <button type="button" class="boop-btn primary" onclick="boopFinish()">Find hotels →</button>
        </div>`;
      }
    } else if (q.type === 'slider') {
      const blend = boopBlend(BOOP.slider);
      body = `<div class="boop-slider-wrap">
        <div class="boop-slider-img">
          <img id="boop-quiet-img" src="https://images.unsplash.com/photo-1519331379826-f10be5486c6f?auto=format&fit=crop&w=1400&q=80" alt="Quiet and green" style="opacity:${(1-blend).toFixed(2)}" />
          <img id="boop-busy-img" src="https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1400&q=80" alt="Busy and lively" style="opacity:${blend.toFixed(2)}" />
          <div class="shade"></div>
        </div>
        <div class="boop-slider-row"><span>Quiet + green</span><span>Busy + lively</span></div>
        <input type="range" min="-100" max="100" value="${BOOP.slider}" oninput="boopSliderChanged(this.value)" style="width:100%;accent-color:#d8b27a" />
        <div class="boop-slider-val" id="boop-slider-value">${boopEnvLabel(BOOP.slider)}</div>
        <div class="boop-slider-val">Current mood: <strong id="boop-slider-caption">${boopEnvLabel(BOOP.slider)}</strong></div>
      </div>
      <div class="boop-actions">
        <button class="boop-btn subtle" onclick="boopBack()">Back</button>
        <button class="boop-btn primary" onclick="boopConfirmSlider()">Use this preference</button>
      </div>`;
    } else if (q.type === 'chips') {
      const mustHaveInstruction = overlayMode
        ? 'Update what matters most, then re-run your search.'
        : 'Optional - pick any that matter.';
      const gs = BOOP.answers.group_size || 'couple';
      const groupPickHtml = `
      <div class="boop-group-pick">
        <div class="boop-group-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <div class="boop-group-content">
          <div class="boop-group-label">Who's coming?</div>
          <div class="boop-group-sub">This helps us show you the best fit for your group.</div>
          <div class="boop-group-btns">
            <button type="button" class="boop-group-btn ${gs==='solo'?'active':''}" onclick="boopSetGroupSize('solo')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <span>1 person</span>
            </button>
            <button type="button" class="boop-group-btn ${gs==='couple'?'active':''}" onclick="boopSetGroupSize('couple')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>2 people</span>
            </button>
            <button type="button" class="boop-group-btn ${gs==='group'?'active':''}" onclick="boopSetGroupSize('group')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M1 21v-2a4 4 0 0 1 3-3.87"/><path d="M8 3.13a4 4 0 0 0 0 7.75"/></svg>
              <span>3+ people</span>
            </button>
          </div>
        </div>
      </div>`;
      const continueLabel = overlayMode ? 'Find hotels →' : 'Continue →';
      const continueHandler = overlayMode ? 'boopFinish()' : 'boopNext()';
      const backHandler = overlayMode ? 'closeBoopOverlay()' : 'boopBack()';
      const backLabel = overlayMode ? 'Cancel' : '&lt; back';
      body = `<div class="boop-deal-toolbar boop-deal-toolbar--compact">
        <div class="boop-deal-toolbar-actions">
          <a class="boop-deal-back-link" href="#" onclick="event.preventDefault();${backHandler};">${backLabel}</a>
          <button type="button" class="boop-btn primary" onclick="${continueHandler}">${continueLabel}</button>
        </div>
      </div>
      ${groupPickHtml}
      <p class="boop-note boop-musthave-instruction">${mustHaveInstruction}</p>
      <div class="boop-deal-list-shell"><div class="boop-deal-list">${q.options.map(o => `
        <button type="button" class="boop-deal-row ${BOOP.dealbreakers.has(o.id) ? 'active' : ''}" aria-pressed="${BOOP.dealbreakers.has(o.id) ? 'true' : 'false'}" aria-label="${escHtml(o.label)}${o.hint ? '. ' + escHtml(o.hint) : ''}" onclick="boopToggleDealbreaker('${o.id}')">
          <div class="boop-deal-row-media">
            <img src="${boopGetDynamicImage(q.id, o.id, o.image || 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1200&q=80')}" alt="" role="presentation" loading="lazy" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1200&q=80'" />
          </div>
          <div class="boop-deal-row-text">
            <div class="boop-deal-row-title">${o.label}</div>
            <div class="boop-deal-row-hint">${o.hint || ''}</div>
            ${o.meta ? `<div class="boop-deal-row-meta">${o.meta}</div>` : ''}
          </div>
          <div class="boop-deal-row-check" aria-hidden="true">${BOOP.dealbreakers.has(o.id) ? '✓' : '+'}</div>
        </button>
      `).join('')}</div></div>`;
    } else if (q.type === 'freetext') {
      // Build the would-be auto-generated room HyDE seed from the live BOOP
      // state so the user can see exactly what we're going to embed and tweak
      // it if they want fine control (Q5 advanced search).
      const previewProfile = {
        answers: { ...(BOOP.answers || {}) },
        prefs: { ...(BOOP.prefs || {}) },
        dealbreakers: Array.from(BOOP.dealbreakers || []),
        freetext: BOOP.freetext || '',
      };
      let autoKeywords = '';
      try { autoKeywords = buildBoopSeeds(previewProfile).roomSeed || ''; } catch (_) { autoKeywords = ''; }
      const kwValue = (BOOP.advancedKeywords && BOOP.advancedKeywords.trim()) ? BOOP.advancedKeywords : autoKeywords;
      const backLabel = overlayMode ? 'Cancel' : 'Back';
      const backHandler = overlayMode ? 'closeBoopOverlay()' : 'boopBack()';
      body = `<div class="boop-freetext-block">
        <div class="boop-deal-freetext" style="margin-top:0">
          <label for="boop-freetext-input" class="boop-deal-freetext-label">Your words <span class="boop-deal-freetext-opt">(optional)</span></label>
          <input id="boop-freetext-input" type="text" placeholder="e.g. quiet side street, small design hotel, dark moody suite, river views"
                 value="${escHtml(BOOP.freetext)}"
                 oninput="BOOP.freetext=this.value"
                 onkeydown="if(event.key==='Enter'){event.preventDefault();boopFinish();}"
                 class="boop-deal-freetext-input" />
        </div>
        <details class="boop-keywords-details">
          <summary class="boop-keywords-summary">
            <span class="boop-keywords-summary-label">Fine-tune room search text</span>
            <span class="boop-keywords-summary-arr" aria-hidden="true">▸</span>
          </summary>
          <div class="boop-keywords-block">
            <div class="boop-keywords-help">We build this line from your answers so room results stay on-theme — tweak it only if you want to nudge the wording.</div>
            <textarea id="boop-keywords-input" class="boop-keywords-input"
                      placeholder="Filled in from your answers"
                      oninput="BOOP.advancedKeywords=this.value">${escHtml(kwValue)}</textarea>
          </div>
        </details>
      </div>
      <div class="boop-freetext-actions">
        <button type="button" class="boop-btn subtle" onclick="${backHandler}">${backLabel}</button>
        <button type="button" class="boop-btn primary" onclick="boopFinish()">Find hotels →</button>
      </div>`;
    } else {
      body = '';
    }

    const backBtn = BOOP.idx > 0 ? `<button class="boop-btn subtle" onclick="boopBack()">Back</button>` : '<span></span>';
    // In overlay (chip re-entry) mode the cards body already renders its own
    // Cancel + "Find hotels →" footer — skip the legacy back-only nav row.
    const nav = (q.type === 'cards' && !overlayMode)
      ? (BOOP.idx > 0 ? `<div class="boop-actions">${backBtn}</div>` : '')
      : '';

    const stepIdx = BOOP.idx + 1;
    const stepTotal = BOOP_QUESTIONS.length;
    wrap.innerHTML = `
      ${overlayMode ? '' : `
      <div class="boop-progress-row" role="group" aria-label="Question ${stepIdx} of ${stepTotal}">
        <span class="boop-progress-step">${stepIdx} of ${stepTotal}</span>
        <div class="boop-progress"><i style="width:${p}%"></i></div>
        <div class="boop-skip-tray"><button type="button" class="boop-btn subtle" onclick="boopSkipToResults()">Skip</button></div>
      </div>`}
      <div class="boop-q-head">
        <div class="boop-q-title">${q.title}</div>
        ${q.sub ? `<div class="boop-q-sub">${q.sub}</div>` : ''}
      </div>
      ${savedUi}
      ${body}
      ${nav}
    `;
    if (typeof window.matchMedia !== 'undefined' && window.matchMedia('(max-width:760px)').matches) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }

  // ── CITY ─────────────────────────────────────────────
  function pickCity(name) {
    const city = normalizeCityName(name);
    S.city = city;
    document.getElementById('cityInput').value = city;
    document.getElementById('sv-city').textContent = city.length > 20 ? city.slice(0,18)+'…' : city;
    // Save to history and rebuild chips so next visit shows it as recent
    writeHistory(CITY_HISTORY_KEY, city);
    buildCityChips();
    // Reset downstream selections when city changes
    S.nbhd = null;
    S.nbhdBbox = null;
    selectedNeighborhood = null;
    S.style = null;
    S.q = null;
    S.hotelQ = null;
    S.mustHaves = null;
    clearNbhdPickerMatchCache();
    preloadBoopTripWizardImages();
    prefetchBoopWizardImages(city);

    // BOOP v4 — saved-profile review screen temporarily disabled; always send
    // users straight into the wizard. We still load the saved profile so the
    // wizard can pre-populate answers if that's ever wired up, but the review
    // UI is hidden for now.
    const saved = loadBoopProfileForCity(city);
    if (saved) S.boopProfile = saved;

    startBoopStep();
    refreshStory('boop');
    showFlowStep('boop');
  }

  function enterNeighborhoodStep() {
    if (!S.city) return;
    const backEl = document.getElementById('nbhd-back-text');
    if (backEl) backEl.textContent = _nbhdBrowseFromResults ? 'Back to hotel list' : 'Back to City';
    const eyebrow = document.getElementById('nbhd-eyebrow-line');
    if (eyebrow) eyebrow.textContent = _nbhdBrowseFromResults ? S.city : `${S.city} · Step 3 of 5`;
    const sub = document.getElementById('nbhd-chapter-sub');
    if (sub) {
      sub.textContent = _nbhdBrowseFromResults
        ? 'Browse the areas below. Tap Choose on a card to narrow your hotel list, or stay on the whole city.'
        : 'Each card is a slice of the city — pick the mood that fits your trip, or search everywhere at once.';
    }
    fetchAndShowNeighborhoodsNew(S.city);
    refreshStory('nbhd');
    showFlowStep('nbhd');
  }

  // ── NEIGHBOURHOOD ────────────────────────────────────
  const NBHD_ELEMENT_ORDER = [
    { key: 'parks',       label: 'Parks'        },
    { key: 'greenery',    label: 'Green Streets' },
    { key: 'restaurants', label: 'Food'          },
    { key: 'cafes',       label: 'Cafes'         },
    { key: 'street_feel', label: 'Street Feel'   },
    { key: 'icon_spots',  label: 'Icon Spots'    },
    { key: 'museums',     label: 'Museums'       },
    { key: 'shops',       label: 'Shops'         },
  ];
  const NBHD_CARD_DATA = {};
  // Set of photo_url values used as the primary hero of any neighborhood in the
  // current city. Used by buildHeroPhotos to prevent a neighbor's hero from
  // bleeding into another neighborhood's carousel.
  let NBHD_RESERVED_HEROES = new Set();

  function textHasAny(text, arr) {
    const t = (text || '').toLowerCase();
    return arr.some(k => t.includes(k));
  }

  // Derive explicit comparable signals from neighborhood data.
  function deriveNbhdSignals(h) {
    const e = h.vibe_elements || {};
    const v = k => Number(e[k]?.score || 0);
    const tags = (h.tags || []).map(t => String(t).toLowerCase());
    const txt = `${h.vibe_short || ''} ${h.vibe_long || ''}`.toLowerCase();
    const poi = h.attributes?.poi_counts || {};
    const cafeCount = Number(poi.cafes || 0);
    const restaurantCount = Number(poi.restaurants || 0);
    const cafeDensity = Math.min(100, Math.round((Math.min(cafeCount, 120) / 120) * 100));
    const restaurantDensity = Math.min(100, Math.round((Math.min(restaurantCount, 400) / 400) * 100));

    const s = {
      walkability: Math.round((v('street_feel') * 0.55) + (v('cafes') * 0.20) + (v('parks') * 0.25)),
      green:       Math.round(v('parks') * 0.9 + (tags.includes('nature') ? 15 : 0)),
      cafes:       Math.round((v('cafes') * 0.45) + (cafeDensity * 0.55) + (tags.includes('foodie') ? 6 : 0)),
      restaurants: Math.round((v('restaurants') * 0.45) + (restaurantDensity * 0.55) + (tags.includes('foodie') ? 6 : 0)),
      foodie:      Math.round((v('restaurants') * 0.65) + (v('cafes') * 0.35)),
      culture:     Math.round((v('museums') * 0.55) + (v('icon_spots') * 0.45)),
      shopping:    Math.round(v('shops') * 0.9 + (tags.includes('shopping') ? 12 : 0)),
      nightlife:   Math.round((v('street_feel') * 0.40) + (v('restaurants') * 0.35) + (tags.includes('nightlife') ? 18 : 0)),
      calm:        Math.round((v('parks') * 0.50) + (v('cafes') * 0.25) + ((100 - v('street_feel')) * 0.25)),
      central:     Math.round((v('icon_spots') * 0.55) + (v('street_feel') * 0.25) + (textHasAny(txt, ['central', 'heart', 'iconic']) ? 14 : 0)),
      local:       Math.round((v('cafes') * 0.35) + (v('street_feel') * 0.35) + (v('restaurants') * 0.30) + (tags.includes('returning') ? 10 : 0)),
      iconic:      Math.round(v('icon_spots') * 0.9 + (textHasAny(txt, ['iconic', 'landmark']) ? 10 : 0)),
      luxury:      Math.round(v('shops') * 0.55 + (tags.includes('luxury') ? 28 : 0)),
      touristy:    Math.round((v('icon_spots') * 0.55) + (textHasAny(txt, ['touristy', 'tourist']) ? 18 : 0)),
    };
    Object.keys(s).forEach(k => { s[k] = Math.max(0, Math.min(100, s[k])); });
    return s;
  }

  function normalizeSignalsByCity(hoods) {
    if (!hoods?.length) return {};
    const dims = ['walkability','green','cafes','restaurants','foodie','culture','shopping','nightlife','calm','central','local','iconic','luxury','touristy'];
    const raw = hoods.map(h => ({ name: h.name, s: deriveNbhdSignals(h) }));
    const minMax = {};
    dims.forEach(d => {
      const vals = raw.map(r => r.s[d]);
      minMax[d] = { min: Math.min(...vals), max: Math.max(...vals) };
    });
    const normByName = {};
    raw.forEach(r => {
      const out = {};
      dims.forEach(d => {
        const { min, max } = minMax[d];
        out[d] = (max - min) < 0.0001 ? 50 : Math.round(((r.s[d] - min) / (max - min)) * 100);
      });
      normByName[r.name] = out;
    });
    return normByName;
  }

  function computeBoopMatch(h, profile, normByName) {
    if (!profile || !profile.prefs) return null;
    const sig = normByName[h.name] || deriveNbhdSignals(h);
    const prefs = profile.prefs || {};

    // Weighted fit in [0..1]: positive weights want higher signal, negative weights want lower.
    let sum = 0;
    let denom = 0;
    Object.entries(prefs).forEach(([k, wRaw]) => {
      if (typeof sig[k] !== 'number') return;
      const w = Number(wRaw);
      if (!Number.isFinite(w) || w === 0) return;
      const importance = Math.abs(w);
      const x = Math.max(0, Math.min(1, sig[k] / 100));
      const fit = w >= 0 ? x : (1 - x);
      sum += importance * fit;
      denom += importance;
    });
    let fit = denom > 0 ? (sum / denom) : 0.5; // 0..1

    // Dealbreaker penalties in fit space to avoid hard clipping near 99.
    const db = new Set(profile.dealbreakers || []);
    if (db.has('noisy'))   fit -= ((1 - ((sig.calm ?? 50) / 100)) * 0.20);
    if (db.has('far'))     fit -= ((1 - ((sig.central ?? 50) / 100)) * 0.16);
    if (db.has('touristy'))fit -= (((sig.touristy ?? 50) / 100) * 0.18);
    if (db.has('lowFood')) fit -= ((1 - ((sig.foodie ?? 50) / 100)) * 0.18);

    fit = Math.max(0, Math.min(1, fit));
    return fit; // raw fit, normalized later per city
  }

  function rankNeighborhoodsByBoop(hoods) {
    const profile = getEffectiveBoopProfileForScoring();
    const mergedPrefs = mergeBoopFreetextIntoPrefs(profile?.prefs || {}, profile?.freetext || '');
    const profileForMatch = { ...profile, prefs: mergedPrefs };
    const norm = normalizeSignalsByCity(hoods);
    const ranked = [...hoods].map(h => ({ ...h, _boop_raw: computeBoopMatch(h, profileForMatch, norm) }));

    // City-relative spread: convert raw fits into a readable 45..95 range.
    const vals = ranked.map(h => h._boop_raw).filter(v => typeof v === 'number');
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    ranked.forEach(h => {
      const v = typeof h._boop_raw === 'number' ? h._boop_raw : 0.5;
      let pct;
      if ((max - min) < 0.0001) {
        pct = 75; // all similar
      } else {
        const rel = (v - min) / (max - min); // 0..1
        pct = 45 + (rel * 50); // 45..95
      }
      h._boop_match = Math.round(Math.max(0, Math.min(99, pct)));
    });

    return ranked.sort((a, b) => (b._boop_match || 0) - (a._boop_match || 0));
  }

  function escHtml(s) {
    return (s||'').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;');
  }

  /** Hero / card `photo_credit` from API — source-aware attribution. */
  function formatNbhdHeroCreditHtml(pc) {
    if (!pc) return '';
    let src = pc.source || '';
    if (!src && pc.profile_url && String(pc.profile_url).includes('unsplash.com')) src = 'unsplash';
    const name = escHtml(pc.photographer || '');
    const prof = pc.profile_url || '';
    const linkInner = name || 'Contributor';
    const urlA = prof
      ? `<a href="${escHtml(prof)}" target="_blank" rel="noopener">${linkInner}</a>`
      : linkInner;
    if (src === 'unsplash') {
      return `<div class="nbhd-hero-credit-line">Photo by ${urlA} on Unsplash</div>`;
    }
    if (src === 'google_places') {
      return `<div class="nbhd-hero-credit-line">Imagery © Google Maps${name ? ` · ${urlA}` : ''}</div>`;
    }
    if (src === 'flickr' || src === 'wikimedia') {
      const lic = pc.license_name ? escHtml(pc.license_name) : '';
      const lab = src === 'flickr' ? 'Flickr' : 'Wikimedia';
      return `<div class="nbhd-hero-credit-line">${lab}${lic ? ` · ${lic}` : ''}${(prof || name) ? ` · ${urlA}` : ''}</div>`;
    }
    if (src === 'pexels') {
      return `<div class="nbhd-hero-credit-line">Pexels${prof ? ` · ${urlA}` : ''}</div>`;
    }
    return `<div class="nbhd-hero-credit-line">Photo: ${urlA}</div>`;
  }

  function vibePhotoAttribTags(photos) {
    const tags = [];
    const seen = new Set();
    const add = (t) => { if (t && !seen.has(t)) { seen.add(t); tags.push(t); } };
    for (const p of photos || []) {
      const o = typeof p === 'string' ? null : p;
      const src = o?.source;
      const u = typeof p === 'string' ? p : o?.url;
      if (src === 'google_places' || (typeof u === 'string' && (u.includes('googleusercontent.com') || u.includes('places.googleapis.com')))) {
        add('Google Maps');
      } else if (src === 'unsplash') add('Unsplash');
      else if (src === 'flickr') add(o.license_name ? `Flickr (${o.license_name})` : 'Flickr');
      else if (src === 'wikimedia') add(o.license_name ? `Wikimedia (${o.license_name})` : 'Wikimedia');
      else if (src === 'pexels') add('Pexels');
    }
    return tags;
  }

  function nbhdFirstElementKey(h) {
    const data = h?.vibe_elements || {};
    const present = NBHD_ELEMENT_ORDER
      .filter(e => data[e.key])
      .sort((a,b) => (data[b.key]?.score || 0) - (data[a.key]?.score || 0));
    return present[0]?.key || 'restaurants';
  }

  function nbhdElementPanelHTML(h, elementKey, cardId) {
    const element = (h.vibe_elements || {})[elementKey];
    if (!element) return `<div class="nbhd-el-empty">Element data unavailable.</div>`;
    const photos = (h.vibe_photos || {})[elementKey] || [];
    const photoTiles = photos.slice(0, 6).map((p, i) => {
      const url = typeof p === 'string' ? p : p?.url;
      if (!url) return '';
      const clickAttr = cardId
        ? `onclick="openNbhdPhotoLightbox(event,'${escHtml(cardId)}','${escHtml(elementKey)}',${i})" style="cursor:zoom-in"`
        : `onclick="event.stopPropagation()"`;
      return `<div class="nbhd-el-photo" ${clickAttr}><img src="${escHtml(url)}" loading="lazy" alt="${escHtml(h.name)} ${escHtml(elementKey)}"></div>`;
    }).join('');
    const facts = (element.facts || []).slice(0, 3).map(f => `<li>${escHtml(f)}</li>`).join('');
    const m = element.metrics || {};
    // Extra context lines replacing the metric bars
    const walkPct   = Math.round(m.walkability ?? m.confidence ?? 0);
    // const densityPct = Math.round(m.density ?? m.signal_strength ?? 0);
    // const densityLabel = densityPct >= 67 ? 'high' : densityPct >= 34 ? 'moderate' : 'low';
    const extraLines = [
      walkPct > 0 ? `Walkability: ${walkPct}%` : null,
      // densityPct > 0 ? `Local density: ${densityLabel} (${densityPct}%)` : null,
    ].filter(Boolean).map(l => `<li>${escHtml(l)}</li>`).join('');
    const attribTags = vibePhotoAttribTags(photos.slice(0, 6));
    const attribLine = attribTags.length
      ? `<div class="nbhd-el-attrib" aria-label="Photo sources">Includes: ${attribTags.map((t) => escHtml(t)).join(' · ')}</div>`
      : '';
    const galleryInner = photoTiles
      ? `<div class="nbhd-el-gallery">${photoTiles}</div>
         <button class="nbhd-gal-arrow nbhd-gal-prev" onclick="scrollGallery(this,-1,event)" aria-label="Scroll left">&#8249;</button>
         <button class="nbhd-gal-arrow nbhd-gal-next" onclick="scrollGallery(this,1,event)" aria-label="Scroll right">&#8250;</button>`
      : `<div class="nbhd-el-empty">No photos yet</div>`;
    return `<div class="nbhd-el-body">
      <div class="nbhd-el-gallery-wrap">${galleryInner}${attribLine}</div>
      <div class="nbhd-el-info">
        <ul class="nbhd-el-facts">${facts}</ul>
        ${extraLines ? `<ul class="nbhd-el-extra-facts">${extraLines}</ul>` : ''}
        <!-- metric bars commented out — replaced by text bullets above
        <div class="nbhd-el-bars">
          <div class="nbhd-el-bar-row"><span>Density</span><span>${Math.round(m.density ?? m.signal_strength ?? 0)}%</span></div>
          <div class="nbhd-el-bar"><i style="width:${Math.round(m.density ?? m.signal_strength ?? 0)}%"></i></div>
          <div class="nbhd-el-bar-row"><span>Walkability</span><span>${Math.round(m.walkability ?? m.confidence ?? 0)}%</span></div>
          <div class="nbhd-el-bar"><i style="width:${Math.round(m.walkability ?? m.confidence ?? 0)}%"></i></div>
          <div class="nbhd-el-bar-row"><span>vibe</span><span>${Math.round(m.boop_vibe ?? m.user_fit ?? 0)}%</span></div>
          <div class="nbhd-el-bar"><i style="width:${Math.round(m.boop_vibe ?? m.user_fit ?? 0)}%"></i></div>
        </div>
        -->
      </div>
    </div>`;
  }

  function nbhdHeroUrlFromEntry(p) {
    if (typeof p === 'string') return p;
    return p?.url || '';
  }
  function nbhdPhotoEntryFromRaw(p, fallbackLabel = '') {
    if (typeof p === 'string') return { url: p, query: '', source: '', label: fallbackLabel };
    return {
      url: p?.url || '',
      query: p?.query || p?.query_used || '',
      source: p?.source || '',
      label: p?.label || fallbackLabel || '',
    };
  }
  function inferPhotoSourceFromUrl(url) {
    const u = String(url || '').toLowerCase();
    if (u.includes('googleusercontent.com') || u.includes('places.googleapis.com')) return 'google_places';
    if (u.includes('upload.wikimedia.org') || u.includes('wikimedia.org')) return 'wikimedia';
    if (u.includes('images.unsplash.com') || u.includes('unsplash.com')) return 'unsplash';
    if (u.includes('pexels.com')) return 'pexels';
    if (u.includes('flickr.com') || u.includes('staticflickr.com')) return 'flickr';
    return '';
  }
  function nbhdHeroIsFallback(p) {
    return typeof p === 'object' && p && p.is_fallback === true;
  }
  function nbhdHeroIsNewPlacesUrl(url) {
    return url && url.includes('/place-photos/');
  }
  /** One URL per vibe element: prefer new Places URL, then non-fallback, then any. */
  function pickOneHeroUrlFromElement(arr, seen, h) {
    if (!arr || !arr.length) return null;
    const rows = [];
    for (const p of arr) {
      const url = nbhdHeroUrlFromEntry(p);
      if (!url) continue;
      rows.push({ url, fb: nbhdHeroIsFallback(p) });
    }
    const tryTier = pred => {
      for (const c of rows) {
        if (!pred(c)) continue;
        if (seen.has(c.url)) continue;
        if (NBHD_RESERVED_HEROES.has(c.url) && c.url !== h.photo_url) continue;
        return c.url;
      }
      return null;
    };
    return tryTier(c => !c.fb && nbhdHeroIsNewPlacesUrl(c.url))
      || tryTier(c => !c.fb)
      || tryTier(() => true);
  }
  // Elements that get a second hero slide when enough photos are available.
  const NBHD_HERO_DOUBLE = new Set(['icon_spots', 'parks', 'greenery', 'museums']);

  /** Hero strip: one photo per vibe element (two for icon_spots/parks/museums),
   *  ordered by vibe score highest first. Skips street_feel. */
  function buildHeroPhotos(h) {
    const vibePhotos = h.vibe_photos || {};
    const vibeElements = h.vibe_elements || {};
    const ordered = NBHD_ELEMENT_ORDER
      .filter(e => e.key !== 'street_feel')
      .filter(e => Array.isArray(vibePhotos[e.key]) && vibePhotos[e.key].length > 0 && vibeElements[e.key])
      .sort((a, b) => (vibeElements[b.key]?.score || 0) - (vibeElements[a.key]?.score || 0));
    const photos = [];
    const seen = new Set();
    for (const e of ordered) {
      const slots = NBHD_HERO_DOUBLE.has(e.key) ? 2 : 1;
      for (let i = 0; i < slots; i++) {
        const url = pickOneHeroUrlFromElement(vibePhotos[e.key], seen, h);
        if (url) {
          photos.push(url);
          seen.add(url);
        }
      }
    }
    if (!photos.length && h.photo_url) photos.push(h.photo_url);
    return photos;
  }

  function nbhdHeroScrollSync(scrollEl) {
    const wrap = scrollEl.closest('.nbhd-hero-wrap');
    if (!wrap) return;
    const w = scrollEl.clientWidth;
    if (!w) return;
    const h = NBHD_CARD_DATA[wrap.dataset.card];
    const n = h ? buildHeroPhotos(h).length : 0;
    let idx = Math.round(scrollEl.scrollLeft / w);
    if (n > 0) idx = Math.max(0, Math.min(n - 1, idx));
    wrap.dataset.heroIdx = String(idx);
    wrap.querySelectorAll('.nbhd-hero-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  }

  function nbhdHeroAdvance(wrap, dir, ev) {
    if (!wrap) return;
    if (ev) ev.stopPropagation();
    const scroll = wrap.querySelector('.nbhd-hero-scroll');
    const cardId = wrap.dataset.card;
    const h = NBHD_CARD_DATA[cardId];
    if (!h || !scroll) return;
    const photos = buildHeroPhotos(h);
    if (photos.length < 2) return;
    let idx = parseInt(wrap.dataset.heroIdx || '0', 10);
    idx = (idx + dir + photos.length) % photos.length;
    const cw = scroll.clientWidth;
    scroll.scrollTo({ left: idx * cw, behavior: 'smooth' });
    wrap.dataset.heroIdx = String(idx);
    wrap.querySelectorAll('.nbhd-hero-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  }

  function nbhdHeroNav(btn, dir, ev) {
    nbhdHeroAdvance(btn.closest('.nbhd-hero-wrap'), dir, ev);
  }

  function nbhdHeroDot(dotEl, idx, ev) {
    ev.stopPropagation();
    const wrap = dotEl.closest('.nbhd-hero-wrap');
    const scroll = wrap.querySelector('.nbhd-hero-scroll');
    const cardId = wrap.dataset.card;
    const h = NBHD_CARD_DATA[cardId];
    if (!h || !scroll) return;
    const photos = buildHeroPhotos(h);
    if (!photos[idx]) return;
    const cw = scroll.clientWidth;
    scroll.scrollTo({ left: idx * cw, behavior: 'smooth' });
    wrap.dataset.heroIdx = String(idx);
    wrap.querySelectorAll('.nbhd-hero-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  }

  /**
   * openNbhdHeroLightbox — open the shared lightbox for the neighbourhood hero
   * photo(s).  Clicking the hero area (but not arrows/dots which stopPropagation)
   * opens the full-screen view starting at the currently visible photo.
   */
  function openNbhdHeroLightbox(wrapEl, ev) {
    ev.stopPropagation();
    const scroll = wrapEl.querySelector('.nbhd-hero-scroll');
    if (scroll) nbhdHeroScrollSync(scroll);
    const cardId = wrapEl.dataset.card;
    const h = NBHD_CARD_DATA[cardId];
    if (!h) return;
    const photos = buildHeroPhotos(h);
    if (!photos.length) return;
    const startIdx = parseInt(wrapEl.dataset.heroIdx || '0', 10);
    const regKey   = '_nbhd_' + cardId;
    _lbRegistry[regKey] = {
      photos,
      name:  h.name,
      score: null,
    };
    openLightbox(regKey, startIdx);
  }

  function scrollGallery(btn, dir, ev) {
    if (ev) ev.stopPropagation();
    const gallery = btn.closest('.nbhd-el-gallery-wrap').querySelector('.nbhd-el-gallery');
    if (gallery) gallery.scrollBy({ left: dir * 260, behavior: 'smooth' });
  }

  function openNbhdPhotoLightbox(ev, cardId, elementKey, idx) {
    ev.stopPropagation();
    const h = NBHD_CARD_DATA[cardId];
    if (!h) return;
    const raw = (h.vibe_photos || {})[elementKey] || [];
    const photos = raw.map(p => typeof p === 'string' ? p : p?.url).filter(Boolean);
    if (!photos.length) return;
    // Register a temporary entry so the existing lightbox can render it
    const regKey = _lbRegistry.length;
    _lbRegistry.push({ photos, name: h.name + ' · ' + elementKey, score: null });
    openLightbox(regKey, idx);
  }

  function setNbhdElement(cardId, elementKey, ev) {
    if (ev) ev.stopPropagation();
    const h = NBHD_CARD_DATA[cardId];
    if (!h) return;
    const tabs = document.querySelectorAll(`.nbhd-el-tab[data-card='${cardId}']`);
    tabs.forEach(t => t.classList.toggle('active', t.dataset.key === elementKey));
    const panel = document.getElementById(`nbhd-el-panel-${cardId}`);
    if (panel) panel.innerHTML = nbhdElementPanelHTML(h, elementKey, cardId);
  }

  /** Max 202 polls (~4 min) so we never spin forever if the server stays on "generating". */
  const NBHD_GENERATE_MAX_POLLS = 80;

  async function fetchAndShowNeighborhoodsNew(city, isRetry, pollCount = 0) {
    const grid = document.getElementById('nbhd-grid');
    if (!grid) {
      console.error('[nbhd] #nbhd-grid not found');
      return;
    }

    // Show skeletons with a hint on first call
    if (!isRetry) {
      grid.innerHTML = Array.from({length:6}, () =>
        `<div class="nbhd-skel-new"></div>`).join('') +
        `<div class="nbhd-gen-hint">✦ Mapping neighbourhood vibes…</div>`;
    }

    // Fetch from API (works for any city — Gemini generates on first call)
    try {
      const resp = await fetch(`${BACKEND}/api/neighborhoods?city=${encodeURIComponent(city)}`);
      if (resp.ok) {
        const data = await resp.json();
        // 202 = still generating — poll again in 3s
        if (resp.status === 202 || data.status === 'generating') {
          if (pollCount >= NBHD_GENERATE_MAX_POLLS) {
            const allCity = 'All of ' + city;
            grid.innerHTML = `<div class="nbhd-gen-hint" style="color:var(--muted);max-width:42ch">
              Neighbourhood data is taking longer than expected. You can search the whole city instead.
            </div>
            <button type="button" class="boop-summary-edit" style="margin-top:12px" onclick='pickNbhd(${JSON.stringify(allCity)}, null)'>Search all of ${escHtml(city)} →</button>`;
            return;
          }
          grid.innerHTML = Array.from({length:6}, () =>
            `<div class="nbhd-skel-new"></div>`).join('') +
            `<div class="nbhd-gen-hint">✦ Finding your ${escHtml(city)} neighbourhood vibes with AI… (${pollCount + 1}/${NBHD_GENERATE_MAX_POLLS})</div>`;
          setTimeout(() => fetchAndShowNeighborhoodsNew(city, true, pollCount + 1), 3000);
          return;
        }
        const hoods = rankNeighborhoodsByBoop(data.neighborhoods || []);
        NBHD_CITY_ROWS[cityKey(city)] = data.neighborhoods || [];
        fillNbhdPickerMatchCacheFromRanked(city, hoods);
        if (hoods.length) {
          Object.keys(NBHD_CARD_DATA).forEach(k => delete NBHD_CARD_DATA[k]);
          NBHD_RESERVED_HEROES = new Set(hoods.map(h => h.photo_url).filter(Boolean));
          const cardEntries = hoods.map((h, idx) => ({ cardId: `n${idx}`, h }));
          for (const { cardId, h } of cardEntries) NBHD_CARD_DATA[cardId] = h;
          grid.innerHTML = cardEntries.map(({ cardId, h }) => renderNbhdCard(h, cardId)).join('') + renderNbhdSkip(city);
          renderNbhdMap(city, cardEntries);
          return;
        }
      }
    } catch(e) { /* fall through to hardcoded */ }

    // Fallback to hardcoded data (London, Tokyo, New York)
    const fallback = NBHDS_FALLBACK[city];
    if (fallback && fallback.length) {
      NBHD_CITY_ROWS[cityKey(city)] = fallback;
      Object.keys(NBHD_CARD_DATA).forEach(k => delete NBHD_CARD_DATA[k]);
      NBHD_RESERVED_HEROES = new Set(fallback.map(h => h.photo_url).filter(Boolean));
      const rankedFallback = rankNeighborhoodsByBoop(fallback);
      fillNbhdPickerMatchCacheFromRanked(city, rankedFallback);
      const fallbackEntries = rankedFallback.map((h, idx) => ({ cardId: `f${idx}`, h }));
      for (const { cardId, h } of fallbackEntries) NBHD_CARD_DATA[cardId] = h;
      grid.innerHTML = fallbackEntries.map(({ cardId, h }) => renderNbhdCard(h, cardId)).join('') + renderNbhdSkip(city);
      renderNbhdMap(city, fallbackEntries);
    } else {
      // No neighbourhood data at all — skip step gracefully
      pickNbhd('All of ' + city, null);
    }
  }

  function nbhdBoopVibeScore(h) {
    if (typeof h._boop_match === 'number') return Math.max(0, Math.min(99, Math.round(h._boop_match)));
    // Neighborhood-level vibe = mean of all element boop_vibe metrics
    // Falls back to mean of element scores if boop_vibe metric not populated
    const elems = Object.values(h.vibe_elements || {});
    if (!elems.length) return 0;
    const vals = elems.map(e => e?.metrics?.boop_vibe ?? e?.score ?? 0).filter(v => v > 0);
    if (!vals.length) return 0;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  function renderNbhdCard(h, cardId) {
    const bbox = h.bbox
      ? `${h.bbox.lat_min},${h.bbox.lat_max},${h.bbox.lon_min},${h.bbox.lon_max}`
      : '';
    const tags = (h.tags || []).slice(0,4);
    const count = h.hotel_count > 0 ? h.hotel_count : '—';
    const boopVibe = nbhdBoopVibeScore(h);
    const heroPhotos = buildHeroPhotos(h);
    const firstPhoto = heroPhotos[0] || '';
    const slidesHtml = heroPhotos.length
      ? heroPhotos.map(url => `<div class="nbhd-hero-slide" style="background-image:url('${escHtml(url)}')"></div>`).join('')
      : `<div class="nbhd-hero-slide" style="background:${h.bg || 'linear-gradient(160deg,#1a1008 0%,#0e0a06 100%)'}"></div>`;
    const credit = formatNbhdHeroCreditHtml(h.photo_credit);
    const firstEl = nbhdFirstElementKey(h);
    const tabs = NBHD_ELEMENT_ORDER
      .filter(e => (h.vibe_elements || {})[e.key])
      .map(e => `<button class="nbhd-el-tab ${e.key===firstEl?'active':''}" data-card="${cardId}" data-key="${e.key}" onclick="setNbhdElement('${cardId}','${e.key}',event)">${e.label} - ${(h.vibe_elements[e.key]?.score ?? 0)}%</button>`)
      .join('');
    // Hero slideshow controls — only shown when multiple photos available
    const heroControls = heroPhotos.length > 1 ? `
      <button class="nbhd-hero-arrow nbhd-hero-prev" onclick="nbhdHeroNav(this,-1,event)" aria-label="Previous photo">&#8249;</button>
      <button class="nbhd-hero-arrow nbhd-hero-next" onclick="nbhdHeroNav(this,1,event)" aria-label="Next photo">&#8250;</button>
      <div class="nbhd-hero-dots">${heroPhotos.map((_,i)=>`<span class="nbhd-hero-dot${i===0?' active':''}" onclick="nbhdHeroDot(this,${i},event)"></span>`).join('')}</div>` : '';
    const zoomable  = firstPhoto ? ' nbhd-hero-zoomable' : '';
    const zoomClick = firstPhoto ? ' onclick="openNbhdHeroLightbox(this,event)"' : '';
    return `<div class="nbhd-card-new">
      <div class="nbhd-hero-wrap${zoomable}" data-card="${escHtml(cardId)}" data-hero-idx="0"${zoomClick}>
        <div class="nbhd-hero-scroll" onscroll="nbhdHeroScrollSync(this)">${slidesHtml}</div>
        <div class="nbhd-hero-zoom-icon">⤢</div>
        <div class="nbhd-hero-grad"></div>
        <div class="nbhd-hero-top">
          ${boopVibe > 0 ? `<div class="nbhd-bv-badge"><strong>${boopVibe}%</strong> vibe</div>` : ''}
          <div class="nbhd-tags-new">${tags.map(t=>`<span class="nbhd-tag-new">${escHtml(t)}</span>`).join('')}</div>
        </div>
        <div class="nbhd-hero-btm">
          <div class="nbhd-name-new">${escHtml(h.name)}</div>
          <div class="nbhd-vibe-new">${escHtml(h.vibe_short||'')}</div>
        </div>
        ${heroControls}
      </div>
      <div class="nbhd-detail-new">
        <div class="nbhd-detail-desc-new">${escHtml(h.vibe_long||h.vibe_short||'')}</div>
        <div class="nbhd-best-for-new">${tags.map(f=>`<span class="nbhd-bf-pill-new">✓ ${escHtml(f)}</span>`).join('')}</div>
        <div class="nbhd-el-tabs">${tabs || ''}</div>
        <div id="nbhd-el-panel-${cardId}">${nbhdElementPanelHTML(h, firstEl, cardId)}</div>
        <div class="nbhd-detail-row-new">
          <div>
            <div class="nbhd-hotel-count-new">${count} hotels</div>
            <div class="nbhd-hotel-sub-new">in this area</div>
          </div>
          <button class="nbhd-pick-btn-new" onclick="pickNbhdFromCard('${escHtml(cardId)}')">Choose →</button>
        </div>
        ${credit}
      </div>
    </div>`;
  }

  function renderNbhdSkip(city) {
    const esc = s => s.replace(/'/g,"&#39;");
    return `<div class="nbhd-skip-new" onclick="pickNbhd('All of ${esc(city)}',null)">
      <div style="text-align:center;padding:24px">
        <div style="font-size:28px;opacity:.25;margin-bottom:10px">◎</div>
        <div style="font-size:14px;color:var(--muted)">All of ${esc(city)}</div>
        <div style="font-size:11px;color:rgba(154,149,144,.4);margin-top:3px">No area filter</div>
      </div>
    </div>`;
  }

  function pickNbhdFromCard(cardId) {
    const h = NBHD_CARD_DATA[cardId];
    if (!h) return;
    const bbox = h.bbox
      ? `${h.bbox.lat_min},${h.bbox.lat_max},${h.bbox.lon_min},${h.bbox.lon_max}`
      : '';
    pickNbhd(h.name, bbox, h.polygon || null);
  }

  // ── Neighbourhood map module (MapLibre GL + Maptiler tiles) ────────────────
  // Lazy-loaded on first render. Renders polygons (when available) + circular
  // vibe-% markers for each neighbourhood. Click a marker → scroll to the
  // matching card in the grid below + flash highlight. Hover (desktop) →
  // bidirectional highlight between marker and card.
  const NBHD_MAP_LIB_URL = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
  const NBHD_MAP_CSS_URL = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
  let _nbhdMapLibPromise = null;
  let _nbhdMap           = null;
  let _nbhdMapMarkers    = [];          // [{cardId, marker, hover, click}]
  let _nbhdMapBounds     = null;        // last fitBounds target so Reset works
  let _nbhdMapCardListenersBound = false;

  function _vibeColorForPct(p) {
    if (p >= 85) return { bg: '#c9a96e', tier: 4 };
    if (p >= 70) return { bg: '#d8a85c', tier: 3 };
    if (p >= 50) return { bg: '#9b8a6a', tier: 2 };
    if (p >  0)  return { bg: '#6f6a64', tier: 1 };
    return            { bg: '#5b5650', tier: 0 };
  }

  function _setNbhdMapStatus(text, isError) {
    const el = document.getElementById('nbhd-map-status');
    if (!el) return;
    if (text == null) {
      el.classList.add('is-hidden');
      el.classList.remove('is-error');
      return;
    }
    el.textContent = text;
    el.classList.remove('is-hidden');
    el.classList.toggle('is-error', !!isError);
  }

  function _bboxCentroid(bbox) {
    if (!bbox) return null;
    const lat_min = Number(bbox.lat_min), lat_max = Number(bbox.lat_max);
    const lon_min = Number(bbox.lon_min), lon_max = Number(bbox.lon_max);
    if (![lat_min, lat_max, lon_min, lon_max].every(Number.isFinite)) return null;
    return { lat: (lat_min + lat_max) / 2, lng: (lon_min + lon_max) / 2 };
  }

  // polygon.ring is stored as [[lat, lng], ...] (lat first). MapLibre needs
  // GeoJSON [lng, lat]. Returns null if the ring is malformed.
  function _polygonRingToGeoJSON(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const coords = ring
      .map(p => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) ? [+p[1], +p[0]] : null)
      .filter(Boolean);
    if (coords.length < 3) return null;
    if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
      coords.push(coords[0]); // close the ring for GeoJSON
    }
    return [coords]; // GeoJSON Polygon: [outerRing]
  }

  function _bindNbhdCardHoverListeners() {
    if (_nbhdMapCardListenersBound) return;
    const grid = document.getElementById('nbhd-grid');
    if (!grid) return;
    grid.addEventListener('mouseover', e => {
      const card = e.target.closest && e.target.closest('.nbhd-card-new[data-nbhd-card]');
      if (!card) return;
      _setNbhdMarkerHover(card.dataset.nbhdCard, true);
    });
    grid.addEventListener('mouseout', e => {
      const card = e.target.closest && e.target.closest('.nbhd-card-new[data-nbhd-card]');
      if (!card) return;
      const next = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.nbhd-card-new[data-nbhd-card]');
      if (next === card) return;
      _setNbhdMarkerHover(card.dataset.nbhdCard, false);
    });
    _nbhdMapCardListenersBound = true;
  }

  function _setNbhdMarkerHover(cardId, on) {
    const entry = _nbhdMapMarkers.find(m => m.cardId === cardId);
    if (!entry) return;
    entry.markerEl.classList.toggle('is-hover', !!on);
  }

  function _setNbhdCardHover(cardId, on) {
    const card = document.querySelector(`.nbhd-card-new[data-nbhd-card="${CSS.escape(cardId)}"]`);
    if (!card) return;
    card.classList.toggle('is-map-hover', !!on);
  }

  function _scrollAndFlashCard(cardId) {
    const card = document.querySelector(`.nbhd-card-new[data-nbhd-card="${CSS.escape(cardId)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('is-map-flash'); // restart animation
    void card.offsetWidth;
    card.classList.add('is-map-flash');
    setTimeout(() => card.classList.remove('is-map-flash'), 1500);
  }

  function _ensureMapLibre() {
    if (window.maplibregl && document.querySelector('link[data-maplibre]')?.dataset?.loaded === '1') {
      return Promise.resolve(window.maplibregl);
    }
    if (_nbhdMapLibPromise) return _nbhdMapLibPromise;
    _nbhdMapLibPromise = new Promise((resolve, reject) => {
      // CSS MUST be parsed before the map initializes — otherwise MapLibre's
      // controls render at the document origin (top:0,left:0) and the canvas
      // sizing rules (.maplibregl-canvas-container) don't apply, leaving the
      // gl canvas effectively invisible / mispositioned.
      const cssReady = new Promise((res, rej) => {
        let link = document.querySelector('link[data-maplibre]');
        if (link) {
          if (link.dataset.loaded === '1') return res();
          link.addEventListener('load',  () => { link.dataset.loaded = '1'; res(); }, { once: true });
          link.addEventListener('error', () => rej(new Error('MapLibre CSS failed to load')), { once: true });
          return;
        }
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = NBHD_MAP_CSS_URL;
        link.dataset.maplibre = '1';
        link.addEventListener('load',  () => { link.dataset.loaded = '1'; res(); }, { once: true });
        link.addEventListener('error', () => rej(new Error('MapLibre CSS failed to load')), { once: true });
        document.head.appendChild(link);
      });
      const jsReady = new Promise((res, rej) => {
        if (window.maplibregl) return res(window.maplibregl);
        const s = document.createElement('script');
        s.src = NBHD_MAP_LIB_URL;
        s.async = true;
        s.crossOrigin = 'anonymous';
        s.onload  = () => window.maplibregl ? res(window.maplibregl) : rej(new Error('maplibregl missing after load'));
        s.onerror = () => rej(new Error('Failed to load MapLibre GL from CDN'));
        document.head.appendChild(s);
      });
      Promise.all([cssReady, jsReady])
        .then(([, ml]) => resolve(ml || window.maplibregl))
        .catch(reject);
    });
    return _nbhdMapLibPromise;
  }

  function _styleUrlForMaptiler(key) {
    if (!key) return null;
    // Streets style; switch to "outdoor-v2" or "basic-v2" if you prefer.
    return `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(key)}`;
  }

  function _fallbackRasterStyle() {
    // Free OSM raster fallback so the module still works without a Maptiler key.
    // OSM's tile usage policy discourages high-volume embedding — only used as a
    // courtesy until MAPTILER_KEY is configured.
    return {
      version: 8,
      sources: {
        'osm': {
          type: 'raster',
          tiles: [
            'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
            'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
          maxzoom: 19,
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    };
  }

  function resetNbhdMap() {
    if (!_nbhdMap || !_nbhdMapBounds) return;
    _nbhdMap.fitBounds(_nbhdMapBounds, {
      padding: { top: 38, bottom: 50, left: 36, right: 36 },
      duration: 600,
      maxZoom: 15,
    });
  }

  // Tag each card in the grid with data-nbhd-card so map ↔ card lookup works.
  // Card order in the DOM matches the entries[] order produced upstream.
  function _annotateCardsForMap(entries) {
    const cards = document.querySelectorAll('#nbhd-grid .nbhd-card-new');
    cards.forEach((el, i) => {
      const cardId = entries[i]?.cardId;
      if (cardId) el.setAttribute('data-nbhd-card', cardId);
    });
  }

  async function renderNbhdMap(city, entries) {
    const root = document.getElementById('nbhd-map-module');
    if (!root) return;

    // Tag each card so click + hover wiring can find them.
    _annotateCardsForMap(entries);
    _bindNbhdCardHoverListeners();

    // Filter to neighbourhoods that have at least a bbox.
    const plottable = entries.filter(({ h }) => _bboxCentroid(h.bbox));
    if (plottable.length === 0) {
      _setNbhdMapStatus('No map data for this city yet', true);
      root.classList.remove('is-ready');
      return;
    }

    let maplibregl;
    try {
      _setNbhdMapStatus('Loading map…');
      maplibregl = await _ensureMapLibre();
    } catch (e) {
      console.warn('[nbhd-map]', e.message);
      _setNbhdMapStatus('Map library unavailable', true);
      return;
    }

    const key      = (window._MAPTILER_KEY || '').trim();
    const styleUrl = _styleUrlForMaptiler(key);
    const initialStyle = styleUrl || _fallbackRasterStyle();

    // Compute the union of every plottable bbox — used by the "Show all"
    // reset button so users can zoom back out to the full city view.
    let minLat =  90, maxLat = -90, minLng =  180, maxLng = -180;
    for (const { h } of plottable) {
      const b = h.bbox;
      minLat = Math.min(minLat, +b.lat_min);
      maxLat = Math.max(maxLat, +b.lat_max);
      minLng = Math.min(minLng, +b.lon_min);
      maxLng = Math.max(maxLng, +b.lon_max);
    }
    const bounds = new maplibregl.LngLatBounds([minLng, minLat], [maxLng, maxLat]);
    _nbhdMapBounds = bounds;

    // Pick the top-match neighbourhood (highest BOOP vibe %) and use ITS bbox
    // as the initial camera target. Falls back to the full city bounds when
    // no neighbourhood has a meaningful score (e.g. profile not yet loaded).
    let topEntry = null;
    let topPct   = -1;
    for (const entry of plottable) {
      const pct = nbhdBoopVibeScore(entry.h);
      if (pct > topPct) { topPct = pct; topEntry = entry; }
    }
    let initialBounds = bounds;
    if (topEntry && topPct > 0) {
      const tb = topEntry.h.bbox;
      initialBounds = new maplibregl.LngLatBounds(
        [+tb.lon_min, +tb.lat_min],
        [+tb.lon_max, +tb.lat_max]
      );
      console.log(`[nbhd-map] initial focus: ${topEntry.h.name} (${topPct}% match)`);
    }

    // Tear down previous map (city change, profile re-rank).
    if (_nbhdMap) {
      try { _nbhdMap.remove(); } catch (_) {}
      _nbhdMap = null;
      _nbhdMapMarkers = [];
    }

    const canvas = document.getElementById('nbhd-map-canvas');
    if (!canvas) return;

    // Wait one paint frame so the container has measured dimensions before
    // MapLibre creates its WebGL canvas (otherwise it bakes in 0×0 forever).
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw < 50 || ch < 50) {
      console.warn('[nbhd-map] container too small at init:', cw, 'x', ch);
    }

    let map;
    try {
      map = new maplibregl.Map({
        container: canvas,
        style: initialStyle,
        bounds: initialBounds,
        // Padding leaves room for the marker label below each centroid and the
        // badge above it. maxZoom 14 is a good "neighbourhood + a couple of
        // surrounding blocks" zoom level — tight enough to feel focused on the
        // top match but loose enough to show context. The "Show all" button
        // re-fits to the full city bounds (`_nbhdMapBounds`).
        fitBoundsOptions: { padding: { top: 38, bottom: 50, left: 36, right: 36 }, maxZoom: 14 },
        attributionControl: { compact: true },
      });
    } catch (e) {
      console.warn('[nbhd-map] init failed', e.message);
      _setNbhdMapStatus('Could not load map', true);
      return;
    }
    _nbhdMap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    // Defensive: re-fit + resize on container size changes (orientation change,
    // dev-tools open, parent reflow). Stops the WebGL canvas from getting stuck
    // at the size it had at init time.
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        try { map.resize(); } catch (_) {}
      });
      ro.observe(canvas);
      map.on('remove', () => ro.disconnect());
    }

    map.on('load', () => {
      // Force a resize on the same frame the load fires; some browsers measure
      // the container as 0×0 at construction even after rAF, then settle.
      try { map.resize(); } catch (_) {}
      // And once more after a short delay in case the parent flow was still
      // animating in (e.g. step transition).
      setTimeout(() => { try { map.resize(); } catch (_) {} }, 250);
      // Polygon overlay layer (one source with all neighbourhood features).
      const features = [];
      for (const { cardId, h } of plottable) {
        const ring = h.polygon && Array.isArray(h.polygon.ring) ? h.polygon.ring : null;
        const coords = ring ? _polygonRingToGeoJSON(ring) : null;
        if (!coords) continue;
        const pct = nbhdBoopVibeScore(h);
        const { bg } = _vibeColorForPct(pct);
        features.push({
          type: 'Feature',
          properties: { cardId, name: h.name, color: bg, pct },
          geometry: { type: 'Polygon', coordinates: coords },
        });
      }
      if (features.length) {
        map.addSource('nbhd-polys', { type: 'geojson', data: { type: 'FeatureCollection', features } });
        map.addLayer({
          id:   'nbhd-poly-fill',
          type: 'fill',
          source: 'nbhd-polys',
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': 0.18,
            'fill-outline-color': ['get', 'color'],
          },
        });
        map.addLayer({
          id:   'nbhd-poly-outline',
          type: 'line',
          source: 'nbhd-polys',
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 2,
            'line-opacity': 0.85,
          },
        });
        // Click polygon → same as click marker
        map.on('click', 'nbhd-poly-fill', e => {
          const id = e.features?.[0]?.properties?.cardId;
          if (id) _scrollAndFlashCard(id);
        });
        map.on('mouseenter', 'nbhd-poly-fill', () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', 'nbhd-poly-fill', () => map.getCanvas().style.cursor = '');
      }

      // Custom HTML markers (one per neighbourhood).
      _nbhdMapMarkers = [];
      for (const { cardId, h } of plottable) {
        const c = _bboxCentroid(h.bbox);
        if (!c) continue;
        const pct = nbhdBoopVibeScore(h);
        const { bg, tier } = _vibeColorForPct(pct);

        const el = document.createElement('div');
        el.className = `nbhd-marker nbhd-marker--t${tier}`;
        el.style.setProperty('--marker-bg', bg);
        el.dataset.cardId = cardId;
        el.innerHTML = `
          <div class="nbhd-marker-pill">
            <span class="nbhd-marker-pct">${pct > 0 ? pct + '%' : '—'}</span>
            <span class="nbhd-marker-name">${escHtml(h.name || '')}</span>
          </div>
          <div class="nbhd-marker-pointer"></div>
        `;
        // Hover on marker → highlight card
        el.addEventListener('mouseenter', () => _setNbhdCardHover(cardId, true));
        el.addEventListener('mouseleave', () => _setNbhdCardHover(cardId, false));
        // Click marker → scroll + flash card
        el.addEventListener('click', e => {
          e.stopPropagation();
          _scrollAndFlashCard(cardId);
        });

        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -5] })
          .setLngLat([c.lng, c.lat])
          .addTo(map);
        _nbhdMapMarkers.push({ cardId, marker, markerEl: el });
      }

      _setNbhdMapStatus(null);
      root.classList.add('is-ready');
    });

    map.on('error', e => {
      // Style errors (bad key / network) — fall back to OSM raster if not already.
      const msg = (e && e.error && e.error.message) || '';
      console.warn('[nbhd-map] map error:', msg);
      if (key && /key|auth|forbidden|401|403/i.test(msg)) {
        try { map.setStyle(_fallbackRasterStyle()); } catch (_) {}
      }
    });
  }
  // expose for inline onclick on the Reset button
  window.resetNbhdMap = resetNbhdMap;
  // ── End neighbourhood map module ───────────────────────────────────────────

  function pickNbhd(name, bbox, polygon) {
    S.nbhd    = name;
    S.nbhdBbox = bbox || null;
    selectedNeighborhood = name && !name.startsWith('All of')
      ? { name, bbox, polygon: polygon || null }
      : null;
    if (_nbhdBrowseFromResults) {
      const isAll = name.startsWith('All of');
      flashMsg(isAll ? '📍 Searching all of ' + S.city + ' — updating results…'
                     : '✓ ' + name + ' — updating results…');
      completeNbhdBrowseSelection();
      return;
    }
    refreshStory('style');
    buildVibeStyles();
    const isAll = name.startsWith('All of');
    flashMsg(isAll ? '📍 Searching all of ' + S.city + ' · Choose your room vibe →'
                   : '✓ ' + name + ' · Now choose your room vibe →');
    showFlowStep('style');
  }

  // ── ROOM VIBE ────────────────────────────────────────
  function buildVibeStyles() {
    setFeaturedVibe(0);
    const row = document.getElementById('style-thumbs');
    row.innerHTML = STYLES.map((s,i) => {
      const bgStyle = s.photo
        ? `background:${s.bg};background-image:url('${s.photo}');background-size:cover;background-position:center;`
        : `background:${s.bg};`;
      return `
      <div class="sthumb ${i===0?'active':''}" id="sth-${i}" onclick="setFeaturedVibe(${i})">
        <div class="sthumb-bg" style="${bgStyle}"></div>
        <div class="sthumb-ov">
          <div>
            <div style="font-size:15px;margin-bottom:2px">${s.emoji}</div>
            <div class="sthumb-name">${s.name}</div>
          </div>
        </div>
      </div>`;
    }).join('');

    const stack = document.getElementById('style-stack-mobile');
    if (stack) {
      const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
      stack.innerHTML = STYLES.map((s,i) => {
        const bgStyle = s.photo
          ? `background:${s.bg};background-image:url('${s.photo}');background-size:cover;background-position:center;`
          : `background:${s.bg};`;
        const kws = s.kws.map(k => `<span class="sf-kw">${esc(k)}</span>`).join('');
        return `
      <article class="mstyle-card" data-mstyle-idx="${i}">
        <div class="mstyle-hero">
          <div class="mstyle-bg" style="${bgStyle}"></div>
          <div class="mstyle-grad"></div>
          <div class="mstyle-content">
            <div class="sf-badge">${esc(s.badge)}</div>
            <div class="sf-title">${esc(s.emoji + ' ' + s.name)}</div>
            <div class="sf-desc">"${esc(s.intent)}"</div>
            <div class="sf-kws">${kws}</div>
            <button type="button" class="sf-cta" onclick="pickStyleAtIndex(${i})">
              <span>Select this vibe</span><span>→</span>
            </button>
          </div>
        </div>
        <div class="mstyle-overlap">
          <div class="sf-overlap-or">or describe it yourself</div>
          <div class="sf-overlap-input">
            <input type="text" class="mstyle-describe-inp"
              placeholder="e.g. dark moody suite, rain shower, city views…"
              onkeydown="if(event.key==='Enter')pickCustomStyleMobile(this)"/>
            <button type="button" class="sf-overlap-go" onclick="pickCustomStyleMobile(this)">Go →</button>
          </div>
        </div>
      </article>`;
      }).join('');
    }
  }

  function setFeaturedVibe(idx) {
    const s = STYLES[idx]; _flowFeatIdx = idx;
    const bg = document.getElementById('sf-bg');
    if (s.photo) {
      bg.style.background = s.bg;
      bg.style.backgroundImage = `url('${s.photo}')`;
      bg.style.backgroundSize = 'cover';
      bg.style.backgroundPosition = 'center';
    } else {
      bg.style.background = s.bg;
      bg.style.backgroundImage = '';
    }
    document.getElementById('sf-title').innerHTML = s.emoji + ' ' + s.name;
    document.getElementById('sf-desc').textContent  = '"' + s.intent + '"';
    document.getElementById('sf-badge').textContent  = s.badge;
    document.getElementById('sf-kws').innerHTML = s.kws.map(k=>`<span class="sf-kw">${k}</span>`).join('');
    document.getElementById('sf-cta-text').textContent = 'Choose this vibe';
    document.querySelectorAll('.sthumb').forEach((t,i) => t.classList.toggle('active', i===idx));
    document.getElementById('style-featured').classList.remove('sel');
  }

  function pickStyleAtIndex(i) {
    const s = STYLES[i];
    if (!s) return;
    _flowFeatIdx = i;
    S.style = s.name;
    S.q = s.query;
    document.getElementById('style-featured').classList.add('sel');
    document.getElementById('dates-style-label').textContent = '"' + s.name + '"';
    const cq = document.getElementById('cmd-q'); if (cq) cq.value = s.query;
    refreshStory('dates');
    flashMsg('Great choice — almost there: when are you going?', 2000);
    setTimeout(() => showFlowStep('dates'), 300);
  }

  function pickStyleFromFeatured() {
    pickStyleAtIndex(_flowFeatIdx);
  }

  function pickCustomStyle() {
    const el = document.getElementById('describe-input');
    const v = (el && el.value || '').trim();
    if (!v) return;
    applyCustomStyleQuery(v);
  }

  function pickCustomStyleMobile(btn) {
    const card = btn && btn.closest && btn.closest('.mstyle-card');
    const inp = card && card.querySelector('.mstyle-describe-inp');
    const v = (inp && inp.value || '').trim();
    if (!v) return;
    applyCustomStyleQuery(v);
  }

  function applyCustomStyleQuery(v) {
    S.style = v.length > 24 ? v.slice(0,22)+'…' : v;
    S.q = v;
    document.getElementById('dates-style-label').textContent = '"' + S.style + '"';
    const cq = document.getElementById('cmd-q'); if (cq) cq.value = v;
    refreshStory('dates');
    flashMsg('Got it — when are you going?', 2000);
    setTimeout(() => showFlowStep('dates'), 300);
  }

  // ── DATES ────────────────────────────────────────────
  /** YYYY-MM-DD + n calendar days (local), ISO date string out */
  function ymdAddDays(ymd, n) {
    if (!ymd || typeof ymd !== 'string') return '';
    const p = ymd.split('-').map(Number);
    if (p.length !== 3 || p.some(x => !Number.isFinite(x))) return '';
    const d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() + n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function ymdFromLocalDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function ymdToLocalDate(ymd) {
    if (!ymd || typeof ymd !== 'string') return null;
    const p = ymd.split('-').map(Number);
    if (p.length !== 3 || p.some(x => !Number.isFinite(x))) return null;
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function ymdDiffDays(start, end) {
    const a = ymdToLocalDate(start);
    const b = ymdToLocalDate(end);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000);
  }

  /** Checkout must be ≥ check-in + 2 calendar days; sets default + input min when check-in changes */
  function ensureMinCheckoutAfterCheckin(ciEl, coEl) {
    if (!ciEl || !coEl) return;
    const ci = ciEl.value;
    if (!ci) {
      coEl.removeAttribute('min');
      return;
    }
    const minCo = ymdAddDays(ci, 2);
    if (!minCo) return;
    coEl.min = minCo;
    const co = coEl.value;
    if (!co || co <= ci || co < minCo) coEl.value = minCo;
  }

  function onFlowDatesPairChanged(ciId, coId) {
    ensureMinCheckoutAfterCheckin(document.getElementById(ciId), document.getElementById(coId));
  }

  const CITY_DATE_WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const CITY_DATE_PICKER = { cursor: null, selecting: 'checkin', context: 'city' };

  function cityDateIds(context = CITY_DATE_PICKER.context || 'city') {
    return context === 'cmd'
      ? {
        wrapper:'cmd-date-range', ci:'ct-ci', co:'ct-co', trigger:'cmd-date-trigger',
        pop:'cmd-date-pop', months:'cmd-date-months', value:'cmd-date-value',
        summary:'cmd-date-summary', sub:'cmd-date-pop-sub',
      }
      : {
        wrapper:'city-dates', ci:'city-d-ci', co:'city-d-co', trigger:'city-date-trigger',
        pop:'city-date-pop', months:'city-date-months', value:'city-date-value',
        summary:'city-date-summary', sub:'city-date-pop-sub',
      };
  }

  function closeDateRangePicker(context = CITY_DATE_PICKER.context || 'city') {
    const ids = cityDateIds(context);
    const pop = document.getElementById(ids.pop);
    const trigger = document.getElementById(ids.trigger);
    if (pop) pop.classList.remove('open');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (context === 'cmd' && window.matchMedia && window.matchMedia('(max-width: 640px)').matches) {
      document.getElementById('cmd-tray')?.classList.remove('open');
    }
    document.body.classList.remove('city-date-modal-open');
  }

  function closeAllDateRangePickers() {
    closeDateRangePicker('city');
    closeDateRangePicker('cmd');
  }

  function cityDateMonthStart(ymd) {
    const base = ymdToLocalDate(ymd) || new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  }

  function syncCityDateRangeUI(context = CITY_DATE_PICKER.context || 'city') {
    const ids = cityDateIds(context);
    const ci = document.getElementById(ids.ci)?.value || '';
    const co = document.getElementById(ids.co)?.value || '';
    const value = document.getElementById(ids.value);
    const summary = document.getElementById(ids.summary);
    const sub = document.getElementById(ids.sub);

    if (value) {
      if (ci && co) {
        const nights = ymdDiffDays(ci, co);
        value.textContent = `${fmtDate(ci)} — ${fmtDate(co)}`;
        value.classList.remove('ph');
        if (summary) summary.innerHTML = `<strong>${fmtDate(ci)} to ${fmtDate(co)}</strong> · ${nights} night${nights === 1 ? '' : 's'}`;
      } else if (ci) {
        value.textContent = `${fmtDate(ci)} — Select checkout`;
        value.classList.remove('ph');
        if (summary) summary.innerHTML = `<strong>${fmtDate(ci)}</strong> · choose checkout`;
      } else {
        value.textContent = 'Check-in — Check-out';
        value.classList.add('ph');
        if (summary) summary.textContent = 'No dates selected';
      }
    }
    if (sub) {
      sub.textContent = CITY_DATE_PICKER.selecting === 'checkout'
        ? 'Pick a check-out date. It must be at least two days after check-in.'
        : 'Select a check-in date, then choose your check-out date.';
    }
  }

  function syncAllDateRangeUIs() {
    syncCityDateRangeUI('city');
    syncCityDateRangeUI('cmd');
  }

  function syncCityDatePartialSelection() {
    const ids = cityDateIds();
    const ci = document.getElementById(ids.ci)?.value || '';
    const co = document.getElementById(ids.co)?.value || '';
    S.checkin = ci || null;
    S.checkout = co || null;
    ['city-d-ci','d-ci','ct-ci'].forEach(id => { const el = document.getElementById(id); if (el && ci) el.value = ci; });
    ['city-d-co','d-co','ct-co'].forEach(id => { const el = document.getElementById(id); if (el) el.value = co || ''; });
    syncAllDateRangeUIs();
  }

  function updateCityDatePopoverPosition() {
    const ids = cityDateIds();
    const pop = document.getElementById(ids.pop);
    const trigger = document.getElementById(ids.trigger);
    if (!pop || !trigger) return;
    if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) {
      pop.style.removeProperty('--city-date-pop-max-h');
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const available = (CITY_DATE_PICKER.context === 'cmd')
      ? window.innerHeight - rect.bottom - 24
      : rect.top - 18;
    const maxH = Math.max(240, Math.floor(available));
    pop.style.setProperty('--city-date-pop-max-h', `${maxH}px`);
  }

  function openCityDateRangePicker(context = 'city') {
    CITY_DATE_PICKER.context = context;
    closeDateRangePicker(context === 'city' ? 'cmd' : 'city');
    const ids = cityDateIds(context);
    const pop = document.getElementById(ids.pop);
    const trigger = document.getElementById(ids.trigger);
    if (!pop || !trigger) return;
    const ci = document.getElementById(ids.ci)?.value || '';
    CITY_DATE_PICKER.cursor = cityDateMonthStart(ci || ymdFromLocalDate(new Date()));
    CITY_DATE_PICKER.selecting = ci ? 'checkout' : 'checkin';
    updateCityDatePopoverPosition();
    pop.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('city-date-modal-open');
    syncCityDateRangeUI();
    renderCityDateRangePicker();
  }

  function closeCityDateRangePicker() {
    closeDateRangePicker(CITY_DATE_PICKER.context || 'city');
  }

  function toggleCityDateRangePicker() {
    CITY_DATE_PICKER.context = 'city';
    const pop = document.getElementById('city-date-pop');
    if (pop && pop.classList.contains('open')) closeCityDateRangePicker();
    else openCityDateRangePicker('city');
  }

  function toggleCmdDateRangePicker() {
    CITY_DATE_PICKER.context = 'cmd';
    const pop = document.getElementById('cmd-date-pop');
    if (pop && pop.classList.contains('open')) closeCityDateRangePicker();
    else openCityDateRangePicker('cmd');
  }

  function shiftCityDateMonth(delta) {
    const cur = CITY_DATE_PICKER.cursor || cityDateMonthStart();
    CITY_DATE_PICKER.cursor = new Date(cur.getFullYear(), cur.getMonth() + delta, 1);
    renderCityDateRangePicker();
  }

  function cityDateMonthHTML(monthDate) {
    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();
    const title = monthDate.toLocaleDateString('en-US', { month:'long', year:'numeric' });
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const ids = cityDateIds();
    const ci = document.getElementById(ids.ci)?.value || '';
    const co = document.getElementById(ids.co)?.value || '';
    const today = ymdFromLocalDate(new Date());
    const minCheckout = ci ? ymdAddDays(ci, 2) : '';
    const cells = [];

    for (let i = 0; i < firstDay; i++) cells.push('<button type="button" class="city-date-day is-muted" tabindex="-1" disabled></button>');
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = ymdFromLocalDate(new Date(y, m, d));
      const isPast = ymd < today;
      const isTooSoonCheckout = CITY_DATE_PICKER.selecting === 'checkout' && ci && ymd > ci && ymd < minCheckout;
      const disabled = isPast || isTooSoonCheckout;
      const classes = ['city-date-day'];
      if (ci && ymd === ci) classes.push('is-start');
      if (co && ymd === co) classes.push('is-end');
      if (ci && co && ymd > ci && ymd < co) classes.push('is-in-range');
      cells.push(`<button type="button" class="${classes.join(' ')}" ${disabled ? 'disabled' : ''} onclick="selectCityDate('${ymd}')">${d}</button>`);
    }

    return `<div class="city-date-month">
      <div class="city-date-month-title">${title}</div>
      <div class="city-date-weekdays">${CITY_DATE_WEEKDAYS.map(w => `<span>${w}</span>`).join('')}</div>
      <div class="city-date-grid">${cells.join('')}</div>
    </div>`;
  }

  function renderCityDateRangePicker() {
    const ids = cityDateIds();
    const monthsEl = document.getElementById(ids.months);
    if (!monthsEl) return;
    const cur = CITY_DATE_PICKER.cursor || cityDateMonthStart();
    const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    monthsEl.innerHTML = cityDateMonthHTML(cur) + cityDateMonthHTML(next);
    syncAllDateRangeUIs();
  }

  function selectCityDate(ymd) {
    const ids = cityDateIds();
    const ciEl = document.getElementById(ids.ci);
    const coEl = document.getElementById(ids.co);
    if (!ciEl || !coEl) return;
    const ci = ciEl.value || '';

    if (!ci || CITY_DATE_PICKER.selecting !== 'checkout' || ymd <= ci) {
      ciEl.value = ymd;
      coEl.value = '';
      CITY_DATE_PICKER.selecting = 'checkout';
      syncCityDatePartialSelection();
    } else {
      const minCo = ymdAddDays(ci, 2);
      if (ymd < minCo) {
        flashMsg('Check-out must be at least two days after check-in');
        return;
      }
      coEl.value = ymd;
      CITY_DATE_PICKER.selecting = 'checkin';
      onCityDatesChanged();
    }

    renderCityDateRangePicker();
  }

  function _initFlowDates() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const ciStr = ymdFromLocalDate(tomorrow);
    const coStr = ymdAddDays(ciStr, 2);
    const ci = document.getElementById('d-ci');
    const co = document.getElementById('d-co');
    if (ci) ci.value = ciStr;
    if (co) co.value = coStr;
    ensureMinCheckoutAfterCheckin(ci, co);
    const ct1 = document.getElementById('ct-ci');
    const ct2 = document.getElementById('ct-co');
    if (ct1) ct1.value = ciStr;
    if (ct2) ct2.value = coStr;
    ensureMinCheckoutAfterCheckin(ct1, ct2);
  }

  function confirmDates() {
    const ciEl = document.getElementById('d-ci');
    const coEl = document.getElementById('d-co');
    ensureMinCheckoutAfterCheckin(ciEl, coEl);
    const ci = ciEl && ciEl.value;
    const co = coEl && coEl.value;
    if (!ci || !co) { flashMsg('Please select both check-in and check-out dates'); return; }
    if (ci >= co)   { flashMsg('Check-out must be after check-in'); return; }
    S.checkin  = ci;
    S.checkout = co;
    const ct1 = document.getElementById('ct-ci');
    const ct2 = document.getElementById('ct-co');
    if (ct1) ct1.value = ci;
    if (ct2) ct2.value = co;
    ensureMinCheckoutAfterCheckin(ct1, ct2);
    refreshStory('results');
    startSearch();
  }

  // BOOP v4 — optional inline dates on the city step.
  function onCityDatesChanged() {
    const ids = cityDateIds();
    const ciEl = document.getElementById(ids.ci);
    const coEl = document.getElementById(ids.co);
    ensureMinCheckoutAfterCheckin(ciEl, coEl);
    const nci = (ciEl && ciEl.value) || '';
    const nco = (coEl && coEl.value) || '';
    if (nci && nco && nci >= nco) {
      flashMsg('Check-out must be after check-in');
      return;
    }
    S.checkin  = nci || null;
    S.checkout = nco || null;
    // Mirror into the existing st-dates + cmd tray inputs so downstream UX sees them.
    ['city-d-ci','d-ci','ct-ci'].forEach(id => { const el = document.getElementById(id); if (el && nci) el.value = nci; });
    ['city-d-co','d-co','ct-co'].forEach(id => { const el = document.getElementById(id); if (el && nco) el.value = nco; });
    ensureMinCheckoutAfterCheckin(document.getElementById('d-ci'), document.getElementById('d-co'));
    ensureMinCheckoutAfterCheckin(document.getElementById('ct-ci'), document.getElementById('ct-co'));
    syncAllDateRangeUIs();
  }

  function clearCityDates() {
    S.checkin  = null;
    S.checkout = null;
    ['city-d-ci','city-d-co','d-ci','d-co','ct-ci','ct-co'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    ensureMinCheckoutAfterCheckin(document.getElementById('city-d-ci'), document.getElementById('city-d-co'));
    ensureMinCheckoutAfterCheckin(document.getElementById('d-ci'), document.getElementById('d-co'));
    ensureMinCheckoutAfterCheckin(document.getElementById('ct-ci'), document.getElementById('ct-co'));
    CITY_DATE_PICKER.selecting = 'checkin';
    syncAllDateRangeUIs();
    renderCityDateRangePicker();
  }

  function clearResultsDates(ev) {
    if (ev) {
      ev.stopPropagation();
      ev.preventDefault();
    }
    const hadDates = !!(S.checkin && S.checkout);
    clearCityDates();
    syncCommandBarFromState();
    if (hadDates && S.q && S.city) {
      const fakeBtn = { disabled: false, textContent: '' };
      startVectorSearch(S.q, S.city, fakeBtn, S.nbhdBbox);
    }
  }

  function skipDates() {
    S.checkin  = null;
    S.checkout = null;
    refreshStory('results');
    startSearch();
  }

  // ── SEARCH ───────────────────────────────────────────
  function syncCommandBarFromState() {
    const cv = document.getElementById('cv-city');
    if (cv) cv.textContent = S.city || '—';
    const cn = document.getElementById('cv-nbhd');
    if (cn) {
      const n = S.nbhd || '—';
      cn.textContent = n.length > 30 ? n.slice(0, 28) + '…' : n;
    }
    const cnClear = document.getElementById('cv-nbhd-clear');
    if (cnClear) cnClear.classList.toggle('visible', !!S.nbhd && !String(S.nbhd).startsWith('All of'));
    // cmd-q was removed when the toolbar was replaced by the vibe-chip row;
    // the legacy lookup is left as a defensive no-op (`if (cq)`) so other
    // callers that may still reference it don't break.
    const cq = document.getElementById('cmd-q');
    if (cq && S.q) cq.value = S.q;
    renderVibeChips();
    const cd = document.getElementById('cv-dates');
    if (cd) {
      if (S.checkin && S.checkout) {
        cd.textContent = fmtDate(S.checkin) + ' – ' + fmtDate(S.checkout);
        cd.classList.remove('ph');
      } else {
        cd.textContent = 'Add dates';
        cd.classList.add('ph');
      }
    }
    const md = document.getElementById('cmd-mobile-dates-label');
    if (md) {
      if (S.checkin && S.checkout) {
        md.textContent = fmtDate(S.checkin) + ' – ' + fmtDate(S.checkout);
        md.classList.remove('ph');
      } else {
        md.textContent = 'Add dates';
        md.classList.add('ph');
      }
    }
    const mdClear = document.getElementById('cmd-mobile-dates-clear');
    if (mdClear) mdClear.classList.toggle('visible', !!(S.checkin && S.checkout));
    if (S.checkin) {
      const ct1 = document.getElementById('ct-ci');
      if (ct1) ct1.value = S.checkin;
    }
    if (S.checkout) {
      const ct2 = document.getElementById('ct-co');
      if (ct2) ct2.value = S.checkout;
    }
  }

  function buildResultsSkeletonCardsHTML(count) {
    const parts = [];
    for (let i = 0; i < count; i++) {
      parts.push(`<div class="hotel-card hotel-card--skeleton" aria-hidden="true">
        <div class="hotel-hero-wrap"><div class="sk-hero"></div></div>
        <div class="sk-body">
          <div class="sk-line sk-line--lg"></div>
          <div class="sk-line sk-line--sm"></div>
        </div>
      </div>`);
    }
    return parts.join('');
  }

  function enterResultsLoadingMode() {
    // Always exit any chip-re-entry overlay before showing results so the
    // fixed backdrop / blur is removed and #discovery-flow can hide cleanly.
    document.body.classList.remove('boop-overlay-mode');
    S.boopReentryFromChip = false;
    syncCommandBarFromState();
    renderVibeChips();
    document.getElementById('discovery-flow').style.display = 'none';
    document.getElementById('st-results').style.display = 'block';
    document.body.classList.add('has-results');
    const st = document.getElementById('st-results');
    if (st) st.classList.add('results-pending');
    const slo = document.getElementById('searchLoadingOverlay');
    if (slo) {
      slo.setAttribute('aria-hidden', 'false');
      slo.setAttribute('aria-busy', 'true');
    }
    const dmRescue = document.getElementById('availFilterMountDesktop');
    const afRescue = document.getElementById('availFilter');
    if (dmRescue && afRescue) dmRescue.appendChild(afRescue);
    const strip = document.getElementById('nbhd-refine-strip');
    if (strip) {
      strip.style.display = 'none';
      strip.innerHTML = '';
    }
    const resultsEl = document.getElementById('results');
    if (resultsEl) {
      resultsEl.classList.add('no-anim');
      resultsEl.innerHTML = buildResultsSkeletonCardsHTML(5);
    }
    const rc = document.getElementById('resultCount');
    if (rc) rc.textContent = 'Finding hotels that match your vibe…';
    const availFilter = document.getElementById('availFilter');
    if (availFilter) availFilter.style.display = 'none';
    scheduleSyncAvailFilterMount();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function exitResultsPendingMode() {
    const st = document.getElementById('st-results');
    if (st) st.classList.remove('results-pending');
    const slo = document.getElementById('searchLoadingOverlay');
    if (slo) {
      slo.setAttribute('aria-hidden', 'true');
      slo.setAttribute('aria-busy', 'false');
    }
  }

  function startSearch() {
    _vibeTourPending = false;
    _deferResultsRenderUntilTourClose = false;
    closeVibeTourPopup();
    // Show results view, hide discovery flow
    document.getElementById('discovery-flow').style.display = 'none';
    document.getElementById('st-results').style.display     = 'block';
    document.body.classList.add('has-results');
    syncCommandBarFromState();
    // Write city to history
    writeHistory(CITY_HISTORY_KEY, S.city);
    if (S.q) writeHistory(QUERY_HISTORY_KEY, S.q);
    // Fire search
    const fakeBtn = { disabled:false, textContent:'' };
    startVectorSearch(S.q, S.city, fakeBtn, S.nbhdBbox);
  }

  // ── COMMAND BAR ──────────────────────────────────────
  // The long search-text input was replaced by the vibe-chip row + the wizard's
  // Q5 "Search keywords (advanced)" textarea (May 2026). The Search button
  // here is now a refresh affordance — it re-runs the existing query for the
  // current city / neighbourhood / dates state.
  function cmdSearch() {
    if (!S.q) {
      // No query yet — funnel back into the wizard via Advanced search so the
      // user can build one (this should be rare; chip clicks already cover it).
      openBoopFromChip('extras');
      return;
    }
    if (!S.city) { flashMsg('Pick a city first'); return; }
    startSearch();
  }

  function toggleDatesTray(ev) {
    if (ev) ev.stopPropagation();
    const tray = document.getElementById('cmd-tray');
    const opening = tray && !tray.classList.contains('open');
    tray.classList.toggle('open');
    if (opening) {
      const ctCi = document.getElementById('ct-ci');
      const ctCo = document.getElementById('ct-co');
      if (ctCi) ctCi.value = S.checkin || '';
      if (ctCo) ctCo.value = S.checkout || '';
      openCityDateRangePicker('cmd');
    } else {
      closeDateRangePicker('cmd');
    }
  }

  function openMobileResultsDatePicker(ev) {
    if (ev) ev.stopPropagation();
    const tray = document.getElementById('cmd-tray');
    if (tray) tray.classList.add('open');
    const ctCi = document.getElementById('ct-ci');
    const ctCo = document.getElementById('ct-co');
    if (ctCi) ctCi.value = S.checkin || '';
    if (ctCo) ctCo.value = S.checkout || '';
    openCityDateRangePicker('cmd');
  }

  function cmdConfirmDates() {
    const ciEl = document.getElementById('ct-ci');
    const coEl = document.getElementById('ct-co');
    ensureMinCheckoutAfterCheckin(ciEl, coEl);
    const ci = ciEl && ciEl.value;
    const co = coEl && coEl.value;
    if (!ci || !co) return;
    if (ci >= co) { flashMsg('Check-out must be after check-in'); return; }
    S.checkin  = ci; S.checkout = co;
    const dCi = document.getElementById('d-ci');
    const dCo = document.getElementById('d-co');
    const cCi = document.getElementById('city-d-ci');
    const cCo = document.getElementById('city-d-co');
    if (dCi) dCi.value = ci;
    if (dCo) dCo.value = co;
    if (cCi) cCi.value = ci;
    if (cCo) cCo.value = co;
    ensureMinCheckoutAfterCheckin(dCi, dCo);
    ensureMinCheckoutAfterCheckin(cCi, cCo);
    syncAllDateRangeUIs();
    const cd = document.getElementById('cv-dates');
    if (cd) { cd.textContent = fmtDate(ci) + ' – ' + fmtDate(co); cd.classList.remove('ph'); }
    const sb = document.getElementById('s-dates-btn');
    if (sb) { sb.textContent = fmtDate(ci) + ' – ' + fmtDate(co); sb.classList.add('set'); }
    closeDateRangePicker('cmd');
    document.getElementById('cmd-tray').classList.remove('open');
    syncCommandBarFromState();
    startSearch();
  }



  function readHistory(key) {
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(raw) ? raw.filter(v => typeof v === 'string' && v.trim()) : [];
    } catch {
      return [];
    }
  }

  function writeHistory(key, value) {
    const next = [value.trim(), ...readHistory(key).filter(v => v.toLowerCase() !== value.trim().toLowerCase())]
      .slice(0, HISTORY_LIMIT);
    localStorage.setItem(key, JSON.stringify(next));
  }

  function hideRecentDropdown(id) {
    const dd = document.getElementById(id);
    if (!dd) return;
    dd.classList.remove('visible');
    dd.innerHTML = '';
  }

  function showRecentDropdown({ inputId, dropdownId, storageKey, selectFn, emptyText, icon, label }) {
    const input = document.getElementById(inputId);
    const dd = document.getElementById(dropdownId);
    if (!input || !dd) return;
    const term = input.value.trim().toLowerCase();
    const items = readHistory(storageKey).filter(v => !term || v.toLowerCase().includes(term));
    if (!items.length) {
      dd.innerHTML = `<div class="recent-empty">${emptyText}</div>`;
      dd.classList.remove('visible');
      return;
    }
    dd.innerHTML = items.map(value => {
      const safe = value.replace(/'/g, "\\'");
      return `<div class="recent-option" onmousedown="${selectFn}('${safe}')">
        <span class="recent-option-icon">${icon}</span>
        <span>${value}</span>
        <span class="recent-option-sub">${label}</span>
      </div>`;
    }).join('');
    dd.classList.add('visible');
  }

  function selectRecentQuery(value) {
    document.getElementById('queryInput').value = value;
    hideRecentDropdown('queryHistoryDropdown');
  }

  function selectRecentCity(value) {
    hideRecentDropdown('cityHistoryDropdown');
    document.getElementById('cityDropdown').classList.remove('visible');
    pickCity(value);
  }

  // Pre-fill date inputs on DOMContentLoaded (called below)

  function setMode(mode) {
    closeStaticPage();
    closeTopnavMobileMenu();
    currentMode = mode;
    const el = document.getElementById('results');
    if (el) el.innerHTML = '';
    document.body.classList.remove('has-results');
    document.getElementById('st-results').style.display     = 'none';
    document.getElementById('discovery-flow').style.display = '';
    _lastHotels     = [];
    _vibeTourPending = false;
    closeVibeTourPopup();
    _displayedCount = 10;
    hideBanner();
    setStatus('');
    // Return to discovery flow
    showFlowStep('city');
    document.getElementById('story').classList.remove('show');
  }

  function closeTopnavMobileMenu() {
    const links = document.getElementById('topnav-links');
    const btn = document.getElementById('topnav-menu-btn');
    if (links) links.classList.remove('topnav-links--open');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Open menu');
    }
  }

  function getStaticPageContent(id) {
    const commonFoot = `<p class="static-muted">TravelBoop is in beta — this page is a friendly overview, not legal advice, and we may refresh it as the product changes.</p>`;
    const pages = {
      how: {
        title: 'How it works',
        html: `
          <p>TravelBoop walks you through three simple layers: <strong>where you are going</strong>, <strong>what the neighbourhood should feel like</strong>, and <strong>what the room should look like</strong>.</p>
          <h2>1 · City &amp; dates</h2>
          <p>Pick your destination and, if you like, your stay dates. Dates unlock live prices when our partners have them.</p>
          <h2>2 · Your vibe &amp; the map</h2>
          <p>A short wizard captures how you like to travel. Neighbourhood cards (and the map on larger screens) describe the rhythm of each area so you pick a base that fits your trip — not just a dot on a map.</p>
          <h2>3 · Room search in your own words</h2>
          <p>Describe the bathroom, bed, light, or layout you want. We rank hotels using real room photos so you are judging spaces, not brochure copy alone.</p>
          <h2>While we are in beta</h2>
          <p>Coverage and polish will keep improving. Always confirm anything important — price, policy, accessibility — on the hotel or booking site before you pay.</p>
          ${commonFoot}`,
      },
      about: {
        title: 'About TravelBoop',
        html: `
          <p><strong>TravelBoop</strong> helps you find a hotel that fits your trip — not just a place to sleep.</p>
          <p>We focus on neighborhood vibe and real room photos, so you can better understand what a stay will actually feel like before you book.</p>
          <p>Answer a few quick questions about your travel style, and we'll recommend hotels and areas that match — from walkable cafés and local character to quiet streets or nightlife.</p>
          <p>The goal: fewer booking surprises and more \u201Cthis is exactly what I wanted.\u201D</p>
          <h2>Currently in Beta</h2>
          <p>TravelBoop is still growing, with more cities, smarter recommendations, and ongoing improvements added regularly. Use the purple <strong>Feedback</strong> button anytime — your feedback directly shapes what we build next.</p>
          <p class="static-muted">TravelBoop is in beta, so features and information may change as the product evolves. Information here is for orientation only and is not legal or professional advice.</p>`,
      },
      privacy: {
        title: 'Privacy',
        html: `
          <p>Here is the plain-language version — the standalone <a href="/privacy" target="_blank" rel="noopener">/privacy</a> page has the same story with a little more room to breathe.</p>
          <h2>What we collect</h2>
          <ul>
            <li><strong>What you type</strong> — city, searches, wizard answers, and optional feedback.</li>
            <li><strong>Basic technical info</strong> — things like IP address and browser type to keep the site safe.</li>
            <li><strong>A sign-in cookie</strong> — only when we use a beta code, so you do not have to re-enter it on every click.</li>
          </ul>
          <h2>Partners</h2>
          <p>Hotels, photos, and prices come from travel partners. Some smart features use Google’s AI. Hosting, maps, email, and anonymous analytics each run through vendors with their own policies.</p>
          <h2>Questions or removals</h2>
          <p>Email <a href="mailto:beta@travelboop.com">beta@travelboop.com</a> — we are a small team and will help as quickly as we can.</p>
          ${commonFoot}`,
      },
      terms: {
        title: 'Terms of service',
        html: `
          <p>By using TravelBoop during beta you agree to these terms. If you disagree, please stop using the site.</p>
          <h2>Not professional advice</h2>
          <p>TravelBoop is not legal, financial, or travel-agent advice. Neighbourhood notes and match hints are for discovery — they can be incomplete or wrong.</p>
          <h2>No guarantees</h2>
          <p>The service is provided “as is.” We do not promise availability, perfect prices, or that any hotel suits your trip.</p>
          <h2>Bookings</h2>
          <p>When you leave us to book elsewhere, their rules apply. We are not part of your reservation.</p>
          <h2>Play fair</h2>
          <p>Please do not abuse or overload the product. We may pause access that hurts other beta users.</p>
          <h2>Liability</h2>
          <p>To the fullest extent the law allows, TravelBoop and its operators are not liable for indirect or consequential damages from using the beta.</p>
          <h2>Changes</h2>
          <p>We may update these terms. Continuing to use the site means you accept the latest version.</p>
          ${commonFoot}`,
      },
      contact: {
        title: 'Contact',
        html: `
          <p>We read every note we can — weird matches, slow searches, wild ideas, all of it helps.</p>
          <h2>Email</h2>
          <p><a href="mailto:hello@travelboop.com">hello@travelboop.com</a> — general hellos and product thoughts.</p>
          <p><a href="mailto:beta@travelboop.com">beta@travelboop.com</a> — beta access, privacy, or data questions.</p>
          <h2>Developers</h2>
          <p>Found a bug in the open-source pieces? <a href="https://github.com/jmc100-ai/roommatch/issues" target="_blank" rel="noopener noreferrer">Open an issue on GitHub</a>.</p>
          ${commonFoot}`,
      },
    };
    return pages[id] || pages.about;
  }

  function openStaticPage(id) {
    const ov = document.getElementById('static-overlay');
    const body = document.getElementById('static-body');
    if (!ov || !body) return;
    const { title, html } = getStaticPageContent(id);
    body.innerHTML = `<h1 id="static-title">${title}</h1>${html}`;
    ov.classList.add('is-open');
    ov.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    closeTopnavMobileMenu();
    const closeBtn = ov.querySelector('.static-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeStaticPage() {
    const ov = document.getElementById('static-overlay');
    if (!ov || !ov.classList.contains('is-open')) return;
    ov.classList.remove('is-open');
    ov.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    const body = document.getElementById('static-body');
    if (body) body.innerHTML = '';
  }

  function initTopnavMenuAndStatic() {
    const btn = document.getElementById('topnav-menu-btn');
    const links = document.getElementById('topnav-links');
    if (btn && links) {
      btn.addEventListener('click', () => {
        const open = !links.classList.contains('topnav-links--open');
        links.classList.toggle('topnav-links--open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      });
    }
    const ov = document.getElementById('static-overlay');
    if (ov) {
      ov.addEventListener('click', (e) => {
        if (e.target === ov) closeStaticPage();
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const o = document.getElementById('static-overlay');
      if (o && o.classList.contains('is-open')) {
        e.preventDefault();
        closeStaticPage();
      }
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    initTopnavMenuAndStatic();
    scheduleSyncAvailFilterMount();
    // Restore property-type filter from sessionStorage
    try {
      const saved = sessionStorage.getItem('propTypeFilter');
      if (saved && saved !== 'all') {
        _propTypeFilter = saved;
        const sel = document.getElementById('propTypeSelect');
        if (sel) sel.value = saved;
      }
    } catch (_) {}
  });

  function setQuery(chip) {
    document.getElementById('queryInput').value = chip.textContent.trim();
    document.getElementById('queryInput').focus();
  }

  const _suggestions = [
    'Luxury bathroom with soaking tub',
    'Modern suite with city view',
    'Cozy suite with fireplace',
    'Double sinks and walk-in shower',
    'Art deco room with warm lighting',
    'Bright minimalist room with desk',
    'Large bedroom with balcony and mountain view',
    'Romantic suite with bathtub and candles',
    'Contemporary room with floor-to-ceiling windows',
  ];
  function randomSuggestion() {
    const inp = document.getElementById('queryInput');
    const cur = inp.value.trim();
    const pool = _suggestions.filter(s => s !== cur);
    inp.value = pool[Math.floor(Math.random() * pool.length)];
    inp.focus();
  }

  // ── Debug snapshot ──────────────────────────────────────────────────────────
  // Copies a compact JSON blob you can paste into a chat to debug search results.
  function copyDebugSnapshot() {
    const btn = document.getElementById('debugCopyBtn');
    if (!_lastVsearchUrl && !_lastVsearchStats) {
      if (btn) { btn.textContent = '✗ no data'; setTimeout(() => { btn.textContent = '⎘ debug'; }, 1500); }
      return;
    }
    const hotels = (_lastVsearchHotels || []).slice(0, 10).map((h, i) => ({
      rank: i + 1,
      name: h.name,
      vectorScore: h.vectorScore,
      hotelScore: h.hotelScore ?? null,
      nbhd_fit_pct: h.nbhd_fit_pct ?? null,
      primary_nbhd: h.primary_nbhd?.name ?? null,
      effectiveScore: Math.max(0, ...(h.roomTypes || []).map(rt => rt.score || 0)),
      topRoom: h.roomTypes?.[0]
        ? { name: h.roomTypes[0].name, score: h.roomTypes[0].score }
        : null,
      rooms: (h.roomTypes || []).slice(0, 5).map(r => ({ name: r.name, score: r.score })),
    }));
    const snap = {
      url: _lastVsearchUrl,
      stats: {
        ..._lastVsearchStats,
        luxury_star_penalty_applied: _lastVsearchStats?.luxury_star_penalty_applied ?? false,
        luxury_pref: _lastVsearchStats?.luxury_pref ?? null,
      },
      top10: hotels,
    };
    const text = JSON.stringify(snap, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      if (btn) { btn.textContent = '✓ copied!'; setTimeout(() => { btn.textContent = '⎘ debug'; }, 2000); }
    }).catch(() => {
      // Fallback: open in a small overlay
      const pre = document.createElement('pre');
      pre.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9999;background:#111;color:#eee;padding:12px;border-radius:8px;font-size:11px;max-width:500px;max-height:80vh;overflow:auto;white-space:pre-wrap;word-break:break-all;border:1px solid #444';
      pre.textContent = text;
      const close = document.createElement('button');
      close.textContent = '✕ close';
      close.style.cssText = 'display:block;margin-bottom:8px;background:#333;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px';
      close.onclick = () => pre.remove();
      pre.prepend(close);
      document.body.appendChild(pre);
    });
  }
  // ────────────────────────────────────────────────────────────────────────────

  function setStatus(msg, loading = false) {
    document.getElementById('status').innerHTML = loading
      ? `<div class="spinner"></div><span>${msg}</span>`
      : `<span>${msg}</span>`;
  }

  function toggleRoom(row) {
    row.classList.toggle('open');
  }

  function toggleFeatured(el) {
    el.classList.toggle('open');
    const lbl = el.querySelector('.room-featured-collapse');
    if (lbl) lbl.textContent = el.classList.contains('open') ? '▾ collapse' : '▶ expand';
    if (el.classList.contains('open')) {
      const sc = el.querySelector('.room-featured-scroll');
      if (sc) requestAnimationFrame(() => updateFeaturedStripNavState(sc));
    }
  }

  function featuredStripNav(btn, dir) {
    const wrap = btn.closest('.room-featured-scroll-wrap');
    if (!wrap) return;
    const sc = wrap.querySelector('.room-featured-scroll');
    if (!sc) return;
    const step = Math.max(Math.floor(sc.clientWidth * 0.88), 160) * dir;
    sc.scrollBy({ left: step, behavior: 'smooth' });
  }

  function updateFeaturedStripNavState(sc) {
    const wrap = sc.closest('.room-featured-scroll-wrap');
    if (!wrap) return;
    const prev = wrap.querySelector('.room-featured-nav--prev');
    const next = wrap.querySelector('.room-featured-nav--next');
    if (!prev || !next) return;
    const max = sc.scrollWidth - sc.clientWidth;
    const tol = 3;
    const canScroll = max > tol && sc.clientWidth > 0;
    wrap.classList.toggle('room-featured-scroll-wrap--scrollable', canScroll);
    prev.classList.toggle('is-disabled', !canScroll || sc.scrollLeft <= tol);
    next.classList.toggle('is-disabled', !canScroll || sc.scrollLeft >= max - tol);
  }

  function bindFeaturedStripNavs(root) {
    if (!root) return;
    root.querySelectorAll('.room-featured-scroll-wrap').forEach(wrap => {
      const sc = wrap.querySelector('.room-featured-scroll');
      const strip = wrap.querySelector('.room-featured-strip');
      if (!sc || sc.dataset.navBound === '1') return;
      sc.dataset.navBound = '1';
      const update = () => updateFeaturedStripNavState(sc);
      sc.addEventListener('scroll', update, { passive: true });
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(update);
        ro.observe(sc);
        if (strip) ro.observe(strip);
      }
      wrap.querySelectorAll('.room-featured-strip img').forEach(img => {
        img.addEventListener('load', update, { passive: true });
        img.addEventListener('error', update, { passive: true });
      });
      requestAnimationFrame(update);
    });
  }

  async function handleSearch(e) {
    e.preventDefault();
    const query = document.getElementById('queryInput').value.trim();
    const city  = document.getElementById('cityInput').value.trim();
    if (!query) { alert("Please describe the room you're looking for."); return; }
    if (!city)  { alert('Please enter a city.'); return; }
    writeHistory(QUERY_HISTORY_KEY, query);
    writeHistory(CITY_HISTORY_KEY, city);
    hideRecentDropdown('queryHistoryDropdown');
    hideRecentDropdown('cityHistoryDropdown');
    hideNeighborhoodSection();
    if (clipES) { clipES.close(); clipES = null; }
    const btn = document.getElementById('searchBtn');
    btn.disabled = true; btn.textContent = 'Searching…';
    // Free-text search does not use BOOP v4 wizard seeds — clear them.
    S.hotelQ = null;
    S.mustHaves = null;
    if (currentMode === 'vector') startVectorSearch(query, city, btn);
    else if (currentMode === 'clip' && PUBLIC_CLIP_SEARCH_ENABLED) startClip(query, city, btn);
    else if (currentMode === 'clip') {
      setStatus('Extra photo mode is off here — running the standard photo match instead.', true);
      startVectorSearch(query, city, btn);
    }
    else startLiteApi(query, city, btn);
  }

  async function startLiteApi(query, city, btn) {
    setStatus(`Searching for "${query}" in ${city}…`, true);
    try {
      const resp = await fetch(`${BACKEND}/api/room-search?` + new URLSearchParams({ query, city }));
      if (!resp.ok) throw new Error(`Search failed (${resp.status})`);
      const data = await resp.json();
      _lastVsearchStats = null;
      const hotels = data.hotels || [];
      if (!hotels.length) { setStatus(''); renderEmpty(query, city); }
      else {
        const totalTypes = hotels.reduce((n, h) => n + (h.roomTypes?.length || 0), 0);
        setStatus(`${hotels.length} hotels · ${totalTypes} room types in ${city} — tap a card to explore`);
        render(hotels);
      }
    } catch (err) { setStatus(''); renderError(err.message); }
    finally { btn.disabled = false; btn.textContent = 'Search rooms'; }
  }

  async function startVectorSearch(query, city, btn, bbox) {
    const activeBbox = bbox ?? selectedNeighborhood?.bbox ?? null;
    const activePoly = selectedNeighborhood?.polygon;
    const nbhdLabel  = selectedNeighborhood?.name;
    const statusSuffix = nbhdLabel ? ` in ${nbhdLabel}, ${city}` : ` in ${city}`;
    if (typeof city === 'string' && city.trim()) S.city = normalizeCityName(city.trim());
    if (typeof query === 'string' && query.trim()) S.q = query.trim();
    syncRequireFreeCancelFlag();
    hideBanner();
    enterResultsLoadingMode();
    setStatus('');

    // Increment race ID — any in-flight rates response with an older ID will be discarded
    const reqId = ++_ratesReqId;

    // Determine dates before vsearch so we know whether to fetch prices
    const checkin  = S.checkin  || '';
    const checkout = S.checkout || '';
    const hasDates = checkin && checkout && checkin < checkout;

    const nbhdPickerScoresP = prefetchNbhdPickerMatchMap(S.city);
    const _t0search = Date.now();
    console.log(`[perf] search start`);
    try {
      const vsearchParams = { query, city };
      if (activePoly) {
        vsearchParams.polygon = typeof activePoly === 'string' ? activePoly : JSON.stringify(activePoly);
      } else if (activeBbox) {
        vsearchParams.bbox = activeBbox;
      }
      // BOOP v4 — pass hotel_query + must_haves when boopFinish populated them.
      if (S.hotelQ)    vsearchParams.hotel_query = S.hotelQ;
      if (Array.isArray(S.mustHaves) && S.mustHaves.length) {
        vsearchParams.must_haves = S.mustHaves.join(',');
      }
      if (S.boopProfile && typeof S.boopProfile === 'object') {
        try { vsearchParams.boop_profile = JSON.stringify(S.boopProfile); } catch (_) {}
      }
      if (SEARCH_VERSION_OVERRIDE) vsearchParams.search_version = SEARCH_VERSION_OVERRIDE;
      if (SEARCH_COMPARE_OVERRIDE) vsearchParams.compare = '1';
      _lastVsearchUrl = `${BACKEND}/api/vsearch?` + new URLSearchParams(vsearchParams);
      _lastVsearchHotels = null;
      const resp = await fetch(_lastVsearchUrl);
      console.log(`[perf] search response: ${Date.now() - _t0search}ms`);
      await nbhdPickerScoresP.catch(() => {});
      if (!resp.ok) {
        let errMsg = `Search failed (${resp.status})`;
        try { const e = await resp.json(); errMsg = e.error || errMsg; } catch(_) {}
        throw new Error(errMsg);
      }
      const data = await resp.json();
      _lastVsearchStats = data.stats || null;
      _lastVsearchHotels = data.hotels || [];
      const st = data.stats;
      if (st && (st.nbhd_rank_weight_config != null || st.nbhd_blend_applied != null)) {
        console.info(
          '[vsearch nbhd]',
          'config_weight=', st.nbhd_rank_weight_config,
          'active_weight=', st.nbhd_rank_weight_active,
          'blend_applied=', !!st.nbhd_blend_applied,
          'boop_profile=', !!st.boop_profile_received,
          'sort_uses_blend=', typeof st.nbhd_rank_weight === 'number'
        );
      }

      const hotels = data.hotels || [];

      if (data.indexing && !hotels.length) {
        showBanner(data.message || `Still loading hotels in ${city} — hang tight…`, true);
        setTimeout(() => pollIndexStatus(query, city), 15000);
      }

      if (!hotels.length && !data.indexing) {
        setStatus(''); renderEmpty(query, city);
      } else if (hotels.length) {
        setStatus('');
        console.log(`[perf] render called: ${Date.now() - _t0search}ms`);
        render(hotels, hasDates);  // resets _pricesLoaded = false, sets _fetchingPrices
        // Lazy-fetch metadata for hotels beyond META_SYNC_LIMIT (server returns
        // their IDs in data.deferred_meta_ids). Server has already kicked off a
        // background warm of these IDs so the cache is usually hot by the time
        // we ask. Patches name / stars / location / rating in place per card.
        if (Array.isArray(data.deferred_meta_ids) && data.deferred_meta_ids.length) {
          lazyFetchHotelMeta(data.deferred_meta_ids, reqId);
        }
        if (hasDates) {
          fetchPrices(city, checkin, checkout, reqId);
        } else {
          // No dates — unlock price sort buttons immediately, no availability state
          _pricesLoaded = true;
          _fetchingPrices = false;
          _hasDateSearch = false;
          _setPriceBtnsState(true);
        }
      } else if (data.indexing && data.indexStatus === 'indexing') {
        setStatus(`We are still adding hotels in ${city}. Try a broader search or check back soon.`, false);
      } else {
        setStatus(''); renderEmpty(query, city);
      }
    } catch(err) { setStatus(''); renderError(err.message); }
    finally { btn.disabled = false; btn.textContent = 'Search rooms'; }
  }

  async function pollIndexStatus(query, city) {
    try {
      const r = await fetch(`${BACKEND}/api/index-status?` + new URLSearchParams({ city }));
      const d = await r.json();
      if (d.status === 'complete') {
        hideBanner();
        const fakeBtn = { disabled:false, textContent:'' };
        startVectorSearch(query, city, fakeBtn);
      } else if (d.status === 'indexing') {
        showBanner(`Loading more hotels in ${city}… ${d.hotel_count || 0} ready so far. This page will refresh on its own.`, true);
        setTimeout(() => pollIndexStatus(query, city), 15000);
      }
    } catch(e) {}
  }

  function showBanner(msg, loading = false) {
    const b = document.getElementById('indexBanner');
    b.style.display = 'flex';
    b.innerHTML = loading
      ? `<div class="spinner"></div><span>${msg}</span>`
      : `<span>${msg}</span>`;
  }

  function hideBanner() {
    document.getElementById('indexBanner').style.display = 'none';
  }

  function startClip(query, city, btn) {
    setStatus(`Starting a deeper photo pass for “${query}” in ${city}…`, true);
    const prog = document.getElementById('clipProgress');
    const fill = document.getElementById('clipProgressFill');
    prog.style.display = 'block'; fill.style.width = '0%';
    clipDone = 0; clipTotal = 10;
    const scored = [];
    clipES = new EventSource(`${BACKEND}/api/clip-search?` + new URLSearchParams({ query, city }));
    clipES.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'status') { setStatus(msg.message, true); }
      else if (msg.type === 'hotel') {
        clipDone++;
        fill.style.width = `${Math.round((clipDone / clipTotal) * 100)}%`;
        scored.push(msg.hotel);
        const sorted = [...scored].sort((a, b) => (b.clipScore||0) - (a.clipScore||0));
        document.getElementById('results').innerHTML = sorted.map(hotelHTML).join('');
        setStatus(`Compared photos for ${clipDone} of ${clipTotal} hotels — best visual matches on top`);
      }
      else if (msg.type === 'done') {
        clipES.close(); clipES = null;
        btn.disabled = false; btn.textContent = 'Search rooms';
        fill.style.width = '100%';
        setTimeout(() => { prog.style.display = 'none'; }, 800);
        if (!scored.length) { setStatus(''); renderEmpty(query, city); }
        else setStatus(`${scored.length} hotels · ranked by closest photo match`);
      }
      else if (msg.type === 'error') {
        clipES.close(); clipES = null;
        btn.disabled = false; btn.textContent = 'Search rooms';
        prog.style.display = 'none'; setStatus(''); renderError(msg.message);
      }
    };
    clipES.onerror = () => {
      if (clipES) { clipES.close(); clipES = null; }
      btn.disabled = false; btn.textContent = 'Search rooms';
      prog.style.display = 'none'; setStatus(''); renderError('That deeper photo search could not finish. Try the standard search instead.');
    };
  }

  // ── Render + sort ──────────────────────────────────────────────────────────

  function render(hotels, hasDates = false) {
    const resPre = document.getElementById('results');
    _lbRegistry.length = 0;  // reset photo registry for each new search result
    _lastHotels     = hotels;
    // Telemetry: each successful render is one "search executed" event from the
    // user's perspective. Properties stay coarse (no query text) so PostHog
    // never sees the search query itself.
    try {
      const top = (hotels && hotels[0]) || null;
      track('vsearch_executed', {
        city:           (S && S.city) || null,
        result_count:   (hotels || []).length,
        has_dates:      !!hasDates,
        has_query:      !!(S && (S.q || S.query)),
        nbhd_filter:    !!(typeof selectedNeighborhood !== 'undefined' && selectedNeighborhood && selectedNeighborhood.name),
        search_version: (typeof _lastVsearchUrl === 'string' && /search_version=v1/.test(_lastVsearchUrl)) ? 'v1' : 'v2',
        top_score:      top ? Math.round((top.vectorScore ?? top.score ?? 0)) : null,
      });
    } catch (_) {}
    // Prefetch street-view frames for the top hotel immediately — fire-and-forget so
    // the tour overlay shows with images already cached rather than waiting on-demand.
    if (hotels?.length) {
      const prefetchId = hotels[0]?.id;
      if (prefetchId && !Object.prototype.hasOwnProperty.call(_svFrameCache, prefetchId)) {
        fetchStreetViewFrames(prefetchId); // intentionally not awaited
      }
    }
    const shouldOpenVibeTour = !!(_vibeTourPending && hotels?.length && S.boopProfile);
    _deferResultsRenderUntilTourClose = shouldOpenVibeTour;
    _vibeTourPending = false;
    _currentSort    = 'match';
    _sortReverse    = false;
    _displayedCount = 10;
    _nbhdFilter     = null;  // BOOP v4 — reset the top-nbhd refine strip filter
    _pricesLoaded   = false;
    _fetchingPrices = !!hasDates;
    _hasDateSearch  = false;
    _showAvailOnly  = false;
    const availFilter = document.getElementById('availFilter');
    if (availFilter) availFilter.style.display = 'none';
    // Show property-type dropdown when results include non-hotel property types (V2 cities)
    const hasPropertyTypes = (hotels || []).some(h => h.property_type && h.property_type !== 'hotel');
    const propTypeFilter = document.getElementById('propTypeFilter');
    if (propTypeFilter) propTypeFilter.style.display = hasPropertyTypes ? 'flex' : 'none';
    // Reset dropdown to current state
    const propTypeSelect = document.getElementById('propTypeSelect');
    if (propTypeSelect) propTypeSelect.value = _propTypeFilter;
    scheduleSyncAvailFilterMount();
    _setRatesStatus('', '');
    document.body.classList.add('has-results');
    document.getElementById('discovery-flow').style.display = 'none';
    document.getElementById('st-results').style.display     = 'block';
    document.querySelectorAll('.sort-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sort === 'match');
      b.disabled = false;
      b.classList.remove('loading');
    });
    syncSortMoreTriggerAccent();
    syncSortDirectionIndicators();
    if (shouldOpenVibeTour) {
      if (resPre) resPre.classList.add('no-anim');
      const sortedHotels = getSortedHotelsForDisplay();
      const topForTour = sortedHotels[0] || hotels[0];
      updateFreeCancelHint();
      setTimeout(() => openVibeTourWithStreetView(topForTour ? [topForTour] : hotels), 120);
      return;
    }
    exitResultsPendingMode();
    if (resPre) resPre.classList.remove('no-anim');
    renderSorted();
  }

  function _setPriceBtnsState(loaded) {
    document.querySelectorAll('[data-sort="match+price"],[data-sort="match+price+rating"],[data-sort="price"]').forEach(b => {
      b.disabled = !loaded;
      b.classList.toggle('loading', !loaded);
    });
  }

  function _setRatesStatus(state, text) {
    const el = document.getElementById('ratesStatus');
    if (!el) return;
    el.className = `rates-status${state ? ' ' + state : ''}`;
    el.textContent = text;
    if (state === 'done') {
      // Fade out after 4s so it doesn't clutter the UI permanently
      setTimeout(() => { el.classList.add('fade'); }, 4000);
      setTimeout(() => { el.textContent = ''; el.className = 'rates-status'; }, 4600);
    }
  }

  // Fires parallel to vsearch. reqId lets us discard stale responses if user re-searches.
  async function fetchPrices(city, checkin, checkout, reqId, hotelIds = []) {
    _setPriceBtnsState(false);  // show spinner only while fetch is in flight
    _setRatesStatus('loading', 'Checking live rates…');
    try {
      const params = new URLSearchParams({ city, checkin, checkout });
      if (hotelIds.length > 0) params.set('hotelIds', hotelIds.join(','));
      const resp = await fetch(`${BACKEND}/api/rates?` + params);
      if (reqId !== _ratesReqId) return;  // stale — a new search was started
      if (!resp.ok) { _fetchingPrices = false; _setPriceBtnsState(true); return; }
      const data = await resp.json();
      if (reqId !== _ratesReqId) return;
      _fetchingPrices = false;
      applyPrices(data.prices || {}, data.roomPrices || {}, data.currency || 'EUR', data.pricedCount || 0, data);
    } catch (e) {
      console.warn('[prices]', e.message);
      if (reqId === _ratesReqId) {
        _fetchingPrices = false;
        _setPriceBtnsState(true);
        _setRatesStatus('', '');
        updateFreeCancelHint();
      }
    }
  }

  // Updates hotel prices, badges, and room rows in-place without wiping #results.
  // Used when the sort order doesn't change on price arrival (match / rating / stars).
  // For price-dependent sorts (match+price, price) a full renderSorted() is still needed.
  function applyPricesInPlace(sym) {
    for (const h of _lastHotels) {
      // --- hotel-level price ---
      const priceEl = document.getElementById(`hotel-price-${h.id}`);
      if (priceEl) {
        priceEl.className = 'price-value';
        priceEl.innerHTML = h.price != null
          ? `${sym}${h.price.toLocaleString()}<span class="price-per">/night</span>`
          : `--<span class="price-per">/night</span>`;
      }
      const noteEl = document.getElementById(`hotel-price-note-${h.id}`);
      if (noteEl) {
        noteEl.textContent = h.price != null ? 'Lowest available' : 'No rates found';
      }

      // --- row view price (list mode) ---
      const rowPriceEl = document.getElementById(`hotel-row-price-${h.id}`);
      if (rowPriceEl) {
        rowPriceEl.innerHTML = h.price != null
          ? `<div class="hotel-row-price-main">${sym}${Math.round(h.price).toLocaleString()}</div><div class="hotel-row-price-per">/night</div>`
          : `<div class="hotel-row-price-per" style="margin-top:4px">No rates</div>`;
      }

      // --- twin vibe badges (effectiveScore changes once _pricesLoaded=true) ---
      const badgeWrap = document.getElementById(`hotel-badge-wrap-${h.id}`);
      if (badgeWrap) {
        const roomVibe  = Math.round(hotelEffectiveScore(h) || 0);
        const hotelVibe = Math.round(h.hotelScore || 0);
        const nbhdVibe  = h.nbhd_fit_pct != null ? Math.round(h.nbhd_fit_pct) : computeNbhdVibe(h);
        badgeWrap.innerHTML = buildVibeTriplet(roomVibe, hotelVibe, nbhdVibe);
      }

      // --- room rows: rebuild and inject using roomsSectionHTML ---
      const roomsEl = document.getElementById(`hotel-rooms-${h.id}`);
      if (roomsEl) {
        // Preserve a user-expanded compact row only; never default-open a compact row (featured shows best match).
        const currentRows = roomsEl.querySelectorAll('.room-type-row');
        const openIdx = [...currentRows].findIndex(r => r.classList.contains('open'));
        const openCompactIdx = openIdx >= 0 ? openIdx : -1;

        const allRoomTypes = h.roomTypes || [];
        const isAvail = rt => rt.roomTypeId != null && h.roomPrices?.[rt.roomTypeId] != null;
        const canFilter = _showAvailOnly && _hasDateSearch && _pricesLoaded;
        const availRoomTypes = allRoomTypes.filter(isAvail);
        const hasHotelAvail = h.price != null;
        const visibleRooms = canFilter
          ? (availRoomTypes.length > 0 ? availRoomTypes : (hasHotelAvail ? allRoomTypes : []))
          : allRoomTypes;
        const noAvailRooms = canFilter && visibleRooms.length === 0;
        const isStub = allRoomTypes.length === 0;
        const notice = noAvailRooms
          ? (isStub && hasHotelAvail
              ? `<div class="no-avail-notice">Available for your dates — room photos not in our visual index yet</div>`
              : `<div class="no-avail-notice">No rooms available for these dates — <button class="no-avail-link" onclick="setAvailFilter(false);document.getElementById('availOnlyCheck').checked=false">show all room types</button></div>`)
          : '';
        roomsEl.innerHTML = roomsSectionHTML(visibleRooms, h.vectorScore, h.roomPrices, _hasDateSearch, notice, openCompactIdx, h);
        bindFeaturedStripNavs(roomsEl);
      }
    }

  }

  // ── Lazy hotel-meta fetch ──────────────────────────────────────────────────
  // Server caps synchronous LiteAPI metadata to top META_SYNC_LIMIT (~30) hotels
  // and returns the rest in data.deferred_meta_ids. We chunk-fetch the rest
  // here so cards beyond #30 fill in their name / stars / location / rating
  // shortly after first paint without blocking TTFB.
  let _metaLazyReqId = 0;
  async function lazyFetchHotelMeta(deferredIds, searchReqId) {
    if (!Array.isArray(deferredIds) || !deferredIds.length) return;
    const ourReqId = ++_metaLazyReqId;
    const t0 = Date.now();
    const CHUNK = 100;
    for (let i = 0; i < deferredIds.length; i += CHUNK) {
      // Bail if a newer search started — those hotels aren't on screen anymore.
      if (ourReqId !== _metaLazyReqId) return;
      const slice = deferredIds.slice(i, i + CHUNK);
      try {
        const r = await fetch(`${BACKEND}/api/hotels-meta?ids=${encodeURIComponent(slice.join(','))}`);
        if (!r.ok) continue;
        const d = await r.json();
        if (ourReqId !== _metaLazyReqId) return;
        if (d?.hotels) applyMetaInPlace(d.hotels);
      } catch (_) { /* non-fatal */ }
    }
    console.log(`[perf] lazy meta: ${deferredIds.length} hotels in ${Date.now() - t0}ms`);
  }

  // Patches DOM elements per hotel ID: hotel-name, hotel-meta (stars + location
  // + guest score). Mirrors applyPricesInPlace pattern. Mutates _lastHotels so
  // subsequent re-renders (sort, filter) keep the metadata.
  function applyMetaInPlace(metaMap) {
    if (!metaMap || typeof metaMap !== 'object') return;
    for (const h of _lastHotels) {
      const m = metaMap[h.id];
      if (!m) continue;
      // Mutate hotel object so future renders persist these values.
      if (m.name)        h.name        = m.name;
      if (m.mainPhoto)   h.mainPhoto   = m.mainPhoto;
      if (m.starRating)  h.starRating  = m.starRating;
      if (m.guestRating) h.rating      = m.guestRating;
      if (m.address)     h.address     = m.address;

      // Patch the visible card without a full re-render.
      const nameEl = document.getElementById(`hotel-name-${h.id}`);
      if (nameEl && m.name) nameEl.textContent = m.name;

      const metaEl = document.getElementById(`hotel-meta-${h.id}`);
      if (metaEl) {
        const stars    = '★'.repeat(Math.min(Math.max(Math.round(h.starRating || 0), 0), 5));
        const location = [h.address, h.city, h.country].filter(Boolean).join(', ');
        const rating   = h.rating > 0
          ? `<button type="button" class="hotel-guest-score" data-hotel-id="${escHtml(String(h.id))}" onclick="event.stopPropagation();openHotelDetailPage(this.dataset.hotelId, { scrollTo: 'reviews' })" title="See guest reviews"><strong>${parseFloat(h.rating).toFixed(1)}</strong> guest score</button>`
          : '';
        const propChip =
          h.property_type === 'apartment_rental' ? '<span class="property-type-chip">🏠 Apartment</span>' :
          h.property_type === 'hostel'           ? '<span class="property-type-chip">🛏 Hostel</span>'   : '';
        metaEl.innerHTML =
          (stars ? `<span class="stars">${stars}</span>` : '') +
          (location ? `<span class="hotel-location">${location}</span>` : '') +
          rating + propChip;
      }
    }
  }

  function applyPrices(priceMap, roomPriceMap, currency, pricedCount, ratesData = {}) {
    const sym = currency === 'EUR' ? '€' : '$';
    _priceCurrency = currency;

    // Merge hotel-level and per-room prices + offerIds onto hotel objects for re-render persistence
    let roomPricedRooms = 0;
    for (const hotel of _lastHotels) {
      if (priceMap[hotel.id] !== undefined) hotel.price = priceMap[hotel.id];
      if (roomPriceMap[hotel.id]) {
        hotel.roomPrices = roomPriceMap[hotel.id];
        roomPricedRooms += Object.keys(roomPriceMap[hotel.id]).length;
      }
      // Store offerIds for white-label checkout deep links
      if (ratesData.offerIds?.[hotel.id]) hotel.offerIds = ratesData.offerIds[hotel.id];
      if (ratesData.roomFreeCancel?.[hotel.id]) hotel.roomFreeCancel = ratesData.roomFreeCancel[hotel.id];
      if (ratesData.hotelFreeCancel && Object.prototype.hasOwnProperty.call(ratesData.hotelFreeCancel, hotel.id)) {
        hotel.hotelFreeCancel = !!ratesData.hotelFreeCancel[hotel.id];
      }
    }
    console.log(`[prices] hotel prices: ${Object.keys(priceMap).length}, room prices: ${roomPricedRooms} rooms across ${Object.keys(roomPriceMap).length} hotels`);
    _pricesLoaded  = true;
    _hasDateSearch = true;
    // Default availability filter to OFF so the match-sorted list stays stable.
    // User can enable it via the toggle to filter to available rooms only.
    _showAvailOnly = false;
    _setPriceBtnsState(true);

    // Show availability toggle (unchecked = off by default)
    const availFilter = document.getElementById('availFilter');
    if (availFilter) {
      availFilter.style.display = 'flex';
      document.getElementById('availOnlyCheck').checked = false;
    }
    scheduleSyncAvailFilterMount();

    // Route by sort mode:
    //  - match / rating / stars: order doesn't change with prices → update in-place,
    //    no re-render, no flash, list stays stable.
    //  - match+price / price: user expects re-ranking by price → full re-sort.
    const priceDependentSort = _currentSort === 'match+price' || _currentSort === 'match+price+rating' || _currentSort === 'price';
    if (priceDependentSort || _requireFreeCancel) {
      renderSortedSmooth();
    } else {
      applyPricesInPlace(sym, pricedCount);
    }
    updateFreeCancelHint();

    // Show "Live rates" confirmation then fade out
    _setRatesStatus('done', '✓ Live rates');

    // Update the result count to show pricing coverage
    const total = _lastHotels.length;
    const showing = Math.min(_displayedCount, total);
    const remaining = total - _displayedCount;
    const countEl = document.getElementById('resultCount');
    const pricedNote = pricedCount > 0 ? ` · ${pricedCount} priced` : '';
    if (countEl) countEl.textContent = remaining > 0
      ? `Showing ${showing} of ${total} hotels${pricedNote}`
      : `${total} hotel${total !== 1 ? 's' : ''}${pricedNote}`;
  }

  function closeSortMorePop() {
    const w = document.getElementById('sortMoreWrap');
    if (w) w.classList.remove('is-open');
    const btn = document.getElementById('sortMoreTrigger');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function toggleSortMorePop(ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    const w = document.getElementById('sortMoreWrap');
    if (!w) return;
    w.classList.toggle('is-open');
    const btn = document.getElementById('sortMoreTrigger');
    if (btn) btn.setAttribute('aria-expanded', w.classList.contains('is-open') ? 'true' : 'false');
  }

  function syncSortMoreTriggerAccent() {
    const btn = document.getElementById('sortMoreTrigger');
    if (!btn) return;
    const onSurface = _currentSort === 'match' || _currentSort === 'match+price';
    btn.classList.toggle('sort-more-trigger--accent', !onSurface);
  }

  /** Updates sort pill text + ▲/▼ for the active control (aria-sort for a11y). */
  function syncSortDirectionIndicators() {
    document.querySelectorAll('.sort-btn[data-sort]').forEach(btn => {
      const sort = btn.dataset.sort;
      const label = SORT_LABELS[sort] || sort;
      const active = btn.classList.contains('active');
      btn.removeAttribute('aria-sort');
      if (!active) {
        btn.textContent = label;
        return;
      }
      // Price: default cheap-first = ascending $; others: default "strongest first" = descending on score/combined.
      const ascending = sort === 'price' ? !_sortReverse : _sortReverse;
      btn.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
      const glyph = ascending ? '\u25B2' : '\u25BC';
      btn.innerHTML = `${label}<span class="sort-btn__dir" aria-hidden="true">${glyph}</span>`;
    });
  }

  function setSortBy(sort) {
    if ((sort === 'match+price' || sort === 'match+price+rating' || sort === 'price') && !_pricesLoaded) return;
    if (sort === _currentSort) {
      _sortReverse = !_sortReverse;
    } else {
      _currentSort = sort;
      _sortReverse = false;
    }
    _displayedCount = 10;
    document.querySelectorAll('.sort-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.sort === _currentSort);
    });
    closeSortMorePop();
    syncSortMoreTriggerAccent();
    syncSortDirectionIndicators();
    renderSorted();
  }

  function setAvailFilter(availOnly) {
    _showAvailOnly  = availOnly;
    _displayedCount = 10;
    renderSorted();
  }

  function setPropTypeFilter(val) {
    _propTypeFilter = val || 'all';
    try { sessionStorage.setItem('propTypeFilter', _propTypeFilter); } catch (_) {}
    _displayedCount = 10;
    renderSorted();
  }

  // Returns the hotel's effective match score for sorting and badge display.
  // When the "available only" filter is active, uses only the scores of rooms
  // that have confirmed availability — so a hotel with one 20% available room
  // ranks as 20%, not as the 80% score of an unavailable room.
  function hotelEffectiveScore(h) {
    const allRooms = h.roomTypes || [];
    // When prices have loaded, any hotel absent from the rates response
    // (h.roomPrices === undefined) is treated as fully unavailable → score 0.
    const canFilter = _showAvailOnly && _hasDateSearch && _pricesLoaded;
    if (canFilter) {
      const availRooms = allRooms.filter(rt => rt.roomTypeId != null && h.roomPrices?.[rt.roomTypeId] != null);
      if (availRooms.length > 0) return Math.max(0, ...availRooms.map(rt => rt.score || 0));
      // Fall back to hotel-level availability: LiteAPI returned a price → hotel is bookable.
      // Covers stubs (beyond GALLERY_LIMIT, roomTypes=[]) and hotels where mappedRoomId
      // doesn't match our indexed room_type_id. Use vector score so they rank with peers.
      if (h.price != null) return h.vectorScore || 0;
      return 0;
    }
    return Math.max(0, ...allRooms.map(rt => rt.score || 0));
  }

  // Re-render while suppressing the card entrance animation and preserving scroll.
  // Used when prices arrive so the re-sort is invisible to the user.
  function renderSortedSmooth() {
    const scrollY = window.scrollY;
    const resultsEl = document.getElementById('results');
    if (resultsEl) resultsEl.classList.add('no-anim');
    renderSorted();
    window.scrollTo(0, scrollY);
    requestAnimationFrame(() => { if (resultsEl) resultsEl.classList.remove('no-anim'); });
  }

  function firstUsablePhoto(list) {
    return (list || []).find(Boolean) || '';
  }

  function topRoomForVibeTour(hotel) {
    const rooms = hotel?.roomTypes || [];
    return rooms.find(r => (r.photos || []).length) || rooms[0] || null;
  }

  function vibeTourPhotoForNeighborhood(nbhd, hotel) {
    const vibePhotos = nbhd?.vibe_photos || {};
    for (const key of ['street_feel','cafes','restaurants','parks','icon_spots']) {
      const row = vibePhotos[key] || [];
      const url = row.map(nbhdHeroUrlFromEntry).find(Boolean);
      if (url) return url;
    }
    if (nbhd?.photo_url) return nbhd.photo_url;
    return hotel?.mainPhoto || firstUsablePhoto(hotel?.hotelPhotos) || '';
  }

  function vibeTourPhotoKey(url) {
    try {
      const u = new URL(String(url));
      let path = u.pathname.replace(/\/+$/, '').toLowerCase();
      // Google/Places image URLs often encode only sizing after "=".
      path = path.replace(/=w\d+.*$/i, '').replace(/=s\d+.*$/i, '').replace(/=h\d+.*$/i, '');
      return `${u.hostname.toLowerCase()}${path}`;
    } catch (_) {
      return String(url || '').split('?')[0].replace(/\/+$/, '').toLowerCase();
    }
  }

  function pushUniquePhoto(out, url, label) {
    if (!url) return;
    const key = vibeTourPhotoKey(url);
    if (out.some(p => p.key === key || p.url === url)) return;
    out.push({ url, label, key });
  }

  function shuffledVibeTourItems(items) {
    return [...(items || [])].sort(() => Math.random() - 0.5);
  }
  function isLikelyOutdoorNeighborhoodPhoto(url, label = '') {
    const t = `${String(url || '')} ${String(label || '')}`.toLowerCase();
    // Reject obvious indoor/hotel-room cues.
    if (/\b(lobby|interior|inside|reception|atrium|corridor|hallway|suite|guest\s*room|bed(room)?|bath(room)?|toilet|shower|sink|spa|gym|meeting|conference|ballroom)\b/.test(t)) return false;
    // Prefer explicit outdoor cues when present.
    if (/\b(street|avenue|boulevard|sidewalk|plaza|square|park|garden|outdoor|skyline|facade|façade|neighborhood|district)\b/.test(t)) return true;
    // Otherwise allow as neutral (we still dedupe and prioritize strong outdoor buckets).
    return true;
  }
  function isLikelyStreetNeighborhoodScene(entry, elementKey = '', nbhdName = '') {
    const source = entry?.source || inferPhotoSourceFromUrl(entry?.url);
    const t = `${entry?.url || ''} ${entry?.query || ''} ${entry?.label || ''} ${elementKey || ''} ${nbhdName || ''}`.toLowerCase();
    if (!isLikelyOutdoorNeighborhoodPhoto(entry?.url, `${entry?.label || ''} ${entry?.query || ''}`)) return false;
    // Hard rejects: transport infrastructure / non-neighborhood vibes.
    if (/\b(parking|garage|freeway|highway|overpass|underpass|interchange|viaduct|expressway|traffic)\b/.test(t)) return false;
    // Flickr keyword dumps are often generic and can drift far from neighborhood intent.
    if (source === 'flickr' && /\bstreet,urban,architecture,neighborhood,alley\b/.test(t)) return false;
    return true;
  }
  function neighborhoodTourCandidateScore(entry, elementKey = '', nbhdName = '') {
    const source = entry?.source || inferPhotoSourceFromUrl(entry?.url);
    let score = 0;
    if (source === 'google_places') score += 80;
    else if (source === 'wikimedia') score += 60;
    else if (source === 'unsplash') score += 40;
    else if (source === 'pexels') score += 25;
    else if (source === 'flickr') score += 5;
    if (elementKey === 'street_feel') score += 24;
    if (elementKey === 'icon_spots') score += 18;
    if (elementKey === 'parks' || elementKey === 'greenery') score += 12;
    const t = `${entry?.query || ''} ${entry?.label || ''}`.toLowerCase();
    const n = String(nbhdName || '').toLowerCase();
    if (n && t.includes(n)) score += 10;
    if (/\b(street|avenue|boulevard|plaza|square|park|garden|neighborhood|district)\b/.test(t)) score += 8;
    if (/\b(landmark|historic|facade|façade|tree-lined)\b/.test(t)) score += 6;
    return score;
  }

  function fullNeighborhoodForVibeTour(nbhd) {
    const rows = NBHD_CITY_ROWS[cityKey(S.city)] || Object.values(NBHD_CARD_DATA || {});
    if (!rows.length) return nbhd || null;
    const target = String(nbhd?.name || selectedNeighborhood?.name || '').trim().toLowerCase();
    if (!target) return rows[0] || nbhd || null;
    return rows.find(h => String(h.name || '').trim().toLowerCase() === target)
      || rows.find(h => target.includes(String(h.name || '').trim().toLowerCase()) || String(h.name || '').trim().toLowerCase().includes(target))
      || nbhd
      || rows[0]
      || null;
  }

  function neighborhoodPhotosForVibeTour(nbhd, hotel) {
    const out = [];
    const full = fullNeighborhoodForVibeTour(nbhd);
    const cityRows = NBHD_CITY_ROWS[cityKey(S.city)] || Object.values(NBHD_CARD_DATA || {});
    // Only outdoor-leaning buckets — cafes/restaurants/museums tend to have interior shots
    const preferredKeys = ['street_feel','parks','greenery','icon_spots','shops'];
    const sources = [];
    const seen = new Set();
    const addSource = h => {
      if (!h) return;
      const sig = String(h.id || h.name || JSON.stringify(h.bbox || '')).toLowerCase();
      if (seen.has(sig)) return;
      seen.add(sig);
      sources.push(h);
    };

    addSource(full);
    addSource(nbhd);
    addSource(selectedNeighborhood);
    cityRows.forEach(addSource);

    const nbhdName = full?.name || nbhd?.name || selectedNeighborhood?.name || '';
    // For tour scenes, avoid generic/random picks. Rank candidates by source + query quality.
    const candidates = [];
    for (const h of sources) {
      const vibePhotos = h?.vibe_photos || {};
      for (const key of preferredKeys) {
        for (const p of (vibePhotos[key] || [])) {
          const entry = nbhdPhotoEntryFromRaw(p, h?.name || key.replace('_', ' '));
          if (!entry.url) continue;
          if (!isLikelyStreetNeighborhoodScene(entry, key, nbhdName)) continue;
          candidates.push({
            url: entry.url,
            label: entry.label || h?.name || key.replace('_', ' '),
            key,
            score: neighborhoodTourCandidateScore(entry, key, nbhdName),
          });
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const c of candidates) {
      pushUniquePhoto(out, c.url, c.label);
      if (out.length >= 2) break;
    }

    // Secondary fallback: hero photos, still filtered to avoid indoor cues.
    for (const h of sources) {
      for (const url of buildHeroPhotos(h || {})) {
        const entry = nbhdPhotoEntryFromRaw({ url, source: inferPhotoSourceFromUrl(url), query: '' }, h?.name || 'Neighborhood');
        if (!isLikelyStreetNeighborhoodScene(entry, 'hero', nbhdName)) continue;
        pushUniquePhoto(out, url, h?.name || 'Neighborhood');
        if (out.length >= 2) break;
      }
      if (out.length >= 2) break;
    }

    for (const h of sources) {
      if (!isLikelyOutdoorNeighborhoodPhoto(h?.photo_url, h?.name || 'Neighborhood')) continue;
      pushUniquePhoto(out, h?.photo_url, h?.name || 'Neighborhood');
      if (out.length >= 2) break;
    }

    return out.slice(0, 2);
  }

  function hotelArrivalPhotosForVibeTour(hotel, roomPhoto) {
    const out = [];
    pushUniquePhoto(out, hotel?.mainPhoto, hotel?.name || 'Hotel arrival');
    (hotel?.hotelPhotos || []).forEach((url, idx) => {
      if (isLikelyHotelInteriorPhoto(url, idx)) return;
      pushUniquePhoto(out, url, hotel?.name || 'Hotel arrival');
    });
    // Room photos have their own tour segment — keep arrival to building / exterior only
    return out.slice(0, 2);
  }

  function isLikelyHotelInteriorPhoto(url, idx) {
    const u = String(url || '').toLowerCase();
    if (/\b(lobby|reception|interior|bar|restaurant|lounge|atrium|spa|pool|terrace|amenity|public|common)\b/.test(u)) return true;
    if (/\b(room|bed|bath|suite|guestroom|bathroom|shower|toilet|sink)\b/.test(u)) return false;
    // LiteAPI gallery order often places public-space photos near the front.
    return idx > 0 && idx < 8;
  }

  function hotelInteriorPhotosForVibeTour(hotel, roomPhoto) {
    const out = [];
    (hotel?.hotelPhotos || []).forEach((url, idx) => {
      if (!isLikelyHotelInteriorPhoto(url, idx)) return;
      pushUniquePhoto(out, url, 'Inside the hotel');
    });
    pushUniquePhoto(out, hotel?.mainPhoto, 'Inside the hotel');
    pushUniquePhoto(out, roomPhoto, 'Inside the hotel');
    return out.slice(0, 4);
  }

  function roomPhotosForVibeTour(room, hotel) {
    const out = [];
    for (const url of (room?.photos || [])) {
      pushUniquePhoto(out, url, room?.name || 'Room reveal');
      if (out.length >= 4) break;
    }
    for (const rt of (hotel?.roomTypes || [])) {
      for (const url of (rt.photos || [])) {
        pushUniquePhoto(out, url, rt.name || 'Room reveal');
        if (out.length >= 4) break;
      }
      if (out.length >= 4) break;
    }
    pushUniquePhoto(out, hotel?.mainPhoto, room?.name || 'Room reveal');
    return out.slice(0, 4);
  }

  function vibeTourPillHTML(items) {
    return (items || []).filter(Boolean).slice(0, 4)
      .map(x => `<span class="vibe-tour-pill">${escHtml(String(x))}</span>`)
      .join('');
  }

  function buildVibeTourHTML(hotels, svUrls = []) {
    if (!hotels?.length) return '';
    const h = hotels[0];
    const nbhd = h.primary_nbhd || selectedNeighborhood || null;
    const room = topRoomForVibeTour(h);
    const roomPhoto = firstUsablePhoto(room?.photos) || h.mainPhoto || '';
    const roomVibeBase = Number(hotelEffectiveScore(h));
    const roomVibeFallback =
      Number.isFinite(Number(h.vectorScore)) ? Number(h.vectorScore)
      : Number.isFinite(Number(h.score)) ? Number(h.score)
      : 0;
    const roomVibe = Math.max(0, Math.round((Number.isFinite(roomVibeBase) && roomVibeBase > 0) ? roomVibeBase : roomVibeFallback));
    const nbhdVibeRaw = h.nbhd_fit_pct != null ? Math.round(h.nbhd_fit_pct) : computeNbhdVibe(h);
    const nbhdVibe = Math.max(0, Math.round(nbhdVibeRaw || 0));
    const nbhdForBlend = nbhdVibe > 0 ? nbhdVibe : roomVibe;
    const derivedHotelVibe = Math.round((roomVibe * 0.65) + (nbhdForBlend * 0.35));
    const hotelVibeRaw = Number.isFinite(Number(h.hotelScore)) && Number(h.hotelScore) > 0 ? Number(h.hotelScore) : derivedHotelVibe;
    const hotelVibe = Math.max(0, Math.round(hotelVibeRaw));
    const hotelVibeLabel = `${hotelVibe}%`;
    const nbhdName = nbhd?.name || selectedNeighborhood?.name || S.city || 'the neighborhood';
    const nbhdDesc = nbhd?.vibe_short || nbhd?.vibe_long || 'This is the local setting around your stay.';
    const roomName = room?.name || 'Best matching room';
    const roomBits = [
      room?.score ? `${Math.round(room.score)}% room match` : null,
      room?.beds,
      room?.size,
    ].filter(Boolean);
    const scorePills = [
      nbhdVibe > 0 ? `${nbhdVibe}% neighborhood vibe` : null,
      hotelVibe > 0 ? `${hotelVibe}% hotel vibe` : null,
      roomVibe > 0 ? `${roomVibe}% room vibe` : null,
    ];
    const scenes = [];
    const hotelScenes = [];
    const areaScenes = [];
    const roomScenes = [];
    const addScene = (target, scene) => target.push({ ...scene, nbhdLabel: nbhdName, showNbhdLine: scene.showNbhdLine !== false });

    // Street View frames — real street-level photos of the hotel's block
    const svPhotosSeen = new Set();
    (svUrls || []).forEach((url, i) => {
      if (!url || svPhotosSeen.has(url)) return;
      svPhotosSeen.add(url);
      addScene(areaScenes, {
        key:`sv-${i}`,
        kind:'neighborhood',
        kicker:`Neighborhood vibe match ${nbhdVibe > 0 ? `${nbhdVibe}%` : '—'} - ${nbhdName}`,
        title:h.name || 'Your matched hotel',
        copy:i === 0
          ? (nbhdDesc + ' Here is the actual sidewalk and façades near this hotel (outdoor Street View).')
          : 'Same corner, different angle — a slow look up and down the block.',
        caption:'📍 Google Street View (outdoor)',
        photo:url,
        pills:[...(nbhd?.tags || []), scorePills[0]],
        arrival:i === 0,
        showNbhdLine:false,
        sourceTag:'street-view',
      });
    });

    neighborhoodPhotosForVibeTour(nbhd, h).forEach((p, i) => {
      if (svPhotosSeen.has(p.url)) return; // don't duplicate if SV happened to match
      addScene(areaScenes, {
        key:`neighborhood-${i}`,
        kind:'neighborhood',
        kicker:`Neighborhood vibe match ${nbhdVibe > 0 ? `${nbhdVibe}%` : '—'} - ${nbhdName}`,
        title:h.name || 'Your matched hotel',
        copy:i === 0
          ? 'Curated stills from the area cards — texture, parks, and street energy after the live curb views.'
          : 'Another outdoor-forward glimpse of the district around this match.',
        caption:i === 0 ? 'Area around your stay' : 'Neighborhood gallery',
        photo:p.url,
        pills:[...(nbhd?.tags || []), scorePills[0]],
        arrival:false,
        showNbhdLine:false,
        sourceTag:p.label || 'neighborhood',
      });
    });
    const arrivalList = hotelArrivalPhotosForVibeTour(h, roomPhoto);
    const interiorPool = hotelInteriorPhotosForVibeTour(h, roomPhoto);
    const hotelTour = [];
    for (const p of arrivalList) {
      if (hotelTour.length >= 2) break;
      hotelTour.push({ p, seg: 'arrival' });
    }
    for (const p of interiorPool) {
      if (hotelTour.length >= 2) break;
      hotelTour.push({ p, seg: 'interior' });
    }
    let hotelArrivalIdx = 0;
    let hotelInsideIdx = 0;
    hotelTour.forEach(({ p, seg }) => {
      if (seg === 'arrival') {
        const i = hotelArrivalIdx++;
        addScene(hotelScenes, {
          key:`hotel-arrival-${i}`,
          kind:'hotel',
          kicker:`Hotel vibe match ${hotelVibeLabel}`,
          title:h.name || 'Your matched hotel',
          copy:i === 0
            ? (h.name || 'This hotel') + ` is the strongest current hotel match for your trip vibe (${hotelVibeLabel}).`
            : 'Another exterior angle before we go indoors or to the room.',
          caption:i === 0 ? 'Approach and façade.' : 'Hotel from the street side.',
          photo:p.url,
          pills:[scorePills[1], h.rating > 0 ? `${Number(h.rating).toFixed(1)} guest score` : null, h.starRating ? `${Math.round(h.starRating)} star` : null],
        });
      } else {
        const i = hotelInsideIdx++;
        addScene(hotelScenes, {
          key:`hotel-inside-${i}`,
          kind:'hotel',
          kicker:`Hotel vibe match ${hotelVibeLabel} - Inside ${i + 1}`,
          title:'Step inside',
          copy:'Shared spaces and personality before the room.',
          caption:i === 0 ? 'Lobby or public space when we can detect it.' : 'Another interior cue.',
          photo:p.url,
          pills:[scorePills[1], 'hotel personality'],
        });
      }
    });
    roomPhotosForVibeTour(room, h).forEach((p, i) => addScene(roomScenes, {
      key:`room-${i}`,
      kind:'room',
      kicker:`Room vibe match ${roomVibe > 0 ? `${roomVibe}%` : '—'} - ${roomName}`,
      title:h.name || 'Your matched hotel',
      copy:i === 0
        ? (room ? 'Open the door to the room type we would show first based on your visual room vibe.' : 'Room photos are limited for this hotel, but it still matched your broader stay vibe.')
        : 'Keep looking through the room details: sleep area, bathroom, light, texture, and view when available.',
      caption:i === 0 ? 'End the tour where you would actually sleep.' : 'Another look at the room before the list.',
      photo:p.url,
      pills:[scorePills[2], ...roomBits],
    }));

    // Requested sequence: hotel first, then area, then room.
    scenes.push(...hotelScenes.slice(0, 2), ...areaScenes.slice(0, 3), ...roomScenes);
    const titlePhoto = hotelScenes[0]?.photo || h.mainPhoto || roomPhoto;
    if (titlePhoto) {
      scenes.unshift({
        key:'title-card',
        kind:'title',
        kicker:`Hotel vibe match: ${hotelVibe}%`,
        title:h.name || 'Your matched hotel',
        nbhdLabel:'',
        showNbhdLine:false,
        titleMeta:[
          { key: `${nbhdName}:`, val: `Neighborhood vibe match ${nbhdVibe > 0 ? `${nbhdVibe}%` : '—'}` },
          { key: `${roomName}:`, val: `Room vibe match ${roomVibe > 0 ? `${roomVibe}%` : '—'}` },
        ],
        copy:'',
        caption:'A quick cinematic summary before the tour starts.',
        photo:titlePhoto,
        pills:[],
        durationMs:4000,
      });
    }
    if (!scenes.length) return '';
    _vibeTourSceneCount = scenes.length;
    _vibeTourScene = Math.max(0, Math.min(scenes.length - 1, _vibeTourScene || 0));
    const sceneHTML = scenes.map((s, i) => `<article class="vibe-tour-scene vibe-tour-scene--${escHtml(s.kind || 'photo')} ${s.arrival ? 'vibe-tour-scene--arrival' : ''} ${i === _vibeTourScene ? 'active' : ''}" data-scene="${i}" data-duration="${Math.max(1200, Number(s.durationMs) || 4000)}">
      <div class="vibe-tour-bg motion-${i % 3}" style="background-image:url('${escHtml(s.photo || '')}')"></div>
      <div class="vibe-tour-shade"></div>
      ${(VIBE_TOUR_DEBUG && s.sourceTag) ? `<div class="vibe-tour-debug-source">${escHtml(String(s.sourceTag))}</div>` : ''}
      ${s.arrival ? `<div class="vibe-tour-arrival-map" aria-hidden="true">
        <div class="vibe-tour-map-route"></div>
        <div class="vibe-tour-map-pin"></div>
        <div class="vibe-tour-map-label">Arriving in ${escHtml(nbhdName)}</div>
      </div>` : ''}
      <div class="vibe-tour-content">
        <div class="vibe-tour-kicker">${escHtml(s.kicker)}</div>
        <div class="vibe-tour-title">${escHtml(s.title)}</div>
        ${s.showNbhdLine === false ? '' : `<div class="vibe-tour-neighborhood">${escHtml(s.nbhdLabel || nbhdName)}</div>`}
        <div class="vibe-tour-copy">${Array.isArray(s.titleMeta) && s.titleMeta.length
          ? `<div class="vibe-tour-title-meta-wrap">${s.titleMeta.map(m => `<div class="vibe-tour-title-meta-line"><span class="vibe-tour-title-meta-key">${escHtml(m.key || '')}</span> <span class="vibe-tour-title-meta-val">${escHtml(m.val || '')}</span></div>`).join('')}</div>`
          : escHtml(s.copy).replace(/\n/g, '<br>')}</div>
        <div class="vibe-tour-caption">${escHtml(s.caption)}</div>
        <div class="vibe-tour-pills">${vibeTourPillHTML(s.pills)}</div>
      </div>
    </article>`).join('');
    const progressHTML = scenes.map((s, i) => `<button type="button" class="${i === _vibeTourScene ? 'active' : ''}" aria-label="Show ${escHtml(s.key)} scene" onclick="setVibeTourScene(${i}, true)"></button>`).join('');
    const showSvAttrib = (svUrls && svUrls.length) || scenes.some((s) => s.sourceTag === 'street-view');
    const svAttribHtml = showSvAttrib
      ? `<div class="vibe-tour-maps-attr" role="note"><a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">Imagery © Google</a></div>`
      : '';
    return `<section class="vibe-tour" id="vibe-tour" data-scene="${_vibeTourScene}" aria-label="Cinematic vibe tour preview">
      <div class="vibe-tour-stage">
        ${sceneHTML}
        <div class="vibe-tour-topbar">
          <div class="vibe-tour-progress">${progressHTML}</div>
          <div class="vibe-tour-top-actions">
            <button type="button" class="vibe-tour-icon-btn vibe-tour-icon-btn--icon" id="vibe-tour-fullscreen-btn" aria-label="Enter fullscreen" title="Fullscreen" onclick="toggleVibeTourFullscreen()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>
            </button>
            <button type="button" class="vibe-tour-icon-btn" id="vibe-tour-audio-btn" onclick="toggleVibeTourAudio()">Music off</button>
        <button type="button" class="vibe-tour-icon-btn" onclick="closeVibeTourPopup()">Close</button>
          </div>
        </div>
        <button type="button" class="vibe-tour-nav prev" aria-label="Previous scene" onclick="shiftVibeTourScene(-1)">&#8249;</button>
        <button type="button" class="vibe-tour-nav next" aria-label="Next scene" onclick="shiftVibeTourScene(1)">&#8250;</button>
      </div>
      ${svAttribHtml}
      <div class="vibe-tour-actions">
        <button type="button" class="btn-pri" onclick="closeVibeTourPopup(true)">Continue to hotel list</button>
        <button type="button" class="btn-sec" onclick="closeVibeTourPopup();goToStep('nbhd')">Try another neighborhood</button>
        <button type="button" class="btn-sec" onclick="setVibeTourScene(0, true)">Replay</button>
      </div>
    </section>`;
  }

  async function fetchStreetViewFrames(hotelId) {
    if (!hotelId) return [];
    // Settled cache hit — return immediately
    if (Object.prototype.hasOwnProperty.call(_svFrameCache, hotelId)) {
      return _svFrameCache[hotelId];
    }
    // In-flight dedup — reuse the existing promise rather than firing a second request
    if (_svFrameInFlight[hotelId]) return _svFrameInFlight[hotelId];
    const promise = (async () => {
      try {
        const cityParam = S.city ? `&city=${encodeURIComponent(S.city)}` : '';
      const resp = await fetch(`${BACKEND}/api/street-view?hotelId=${encodeURIComponent(hotelId)}${cityParam}`);
        const urls = resp.ok ? ((await resp.json()).urls || []) : [];
        _svFrameCache[hotelId] = urls;
        return urls;
      } catch (_) {
        _svFrameCache[hotelId] = [];
        return [];
      } finally {
        delete _svFrameInFlight[hotelId];
      }
    })();
    _svFrameInFlight[hotelId] = promise;
    return promise;
  }

  function ensureVibeTourOverlay() {
    let ov = document.getElementById('vibe-tour-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'vibe-tour-overlay';
      ov.className = 'vibe-tour-overlay';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.setAttribute('aria-label', 'Vibe video tour');
      ov.addEventListener('click', (ev) => {
        if (ev.target === ov) closeVibeTourPopup();
      });
      document.body.appendChild(ov);
    }
    return ov;
  }

  function buildVibeTourLoadingHTML(hotel) {
    const name = escHtml(hotel?.name || 'Your matched hotel');
    return `<section class="vibe-tour vibe-tour--loading" id="vibe-tour" aria-busy="true" aria-label="Preparing street-level tour">
      <div class="vibe-tour-loading-topbar">
        <button type="button" class="vibe-tour-icon-btn" onclick="closeVibeTourPopup()">Close</button>
      </div>
      <div class="vibe-tour-loading-spinner" aria-hidden="true"></div>
      <p class="vibe-tour-loading-title">Loading street view</p>
      <p class="vibe-tour-loading-sub">${name}</p>
      <p class="vibe-tour-loading-hint">We are fetching outdoor Street View panos so the tour can start on the sidewalk — not on a gallery photo.</p>
    </section>`;
  }

  function openVibeTourPopup(hotels, svUrls = []) {
    if (!hotels?.length) return;
    _vibeTourLastHotels = hotels;
    _vibeTourVisible = true;
    _vibeTourScene = 0;
    _vibeTourSceneCount = 3;
    const ov = ensureVibeTourOverlay();
    ov.innerHTML = buildVibeTourHTML(hotels, svUrls);
    ov.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    bindVibeTourSwipe();
    syncVibeTourFullscreenButton();
    startVibeTourAutoAdvance();
  }

  async function openVibeTourWithStreetView(hotels) {
    if (!hotels?.length) return;
    const hotelId = hotels[0]?.id;
    if (hotelId && Object.prototype.hasOwnProperty.call(_svFrameCache, hotelId)) {
      openVibeTourPopup(hotels, _svFrameCache[hotelId]);
      return;
    }
    const ov = ensureVibeTourOverlay();
    _vibeTourLastHotels = hotels;
    _vibeTourVisible = true;
    _vibeTourScene = 0;
    _vibeTourSceneCount = 0;
    if (_vibeTourTimer) {
      clearTimeout(_vibeTourTimer);
      _vibeTourTimer = null;
    }
    if (_vibeTourLoadWaitTimer) {
      clearTimeout(_vibeTourLoadWaitTimer);
      _vibeTourLoadWaitTimer = null;
    }
    ov.innerHTML = buildVibeTourLoadingHTML(hotels[0]);
    ov.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    const minLoadMs = 720;
    const t0 = Date.now();
    console.log(`[perf] street-view fetch start`);
    const svUrls = await fetchStreetViewFrames(hotelId);
    const elapsed = Date.now() - t0;
    console.log(`[perf] street-view fetch done: ${elapsed}ms (${svUrls.length} urls, cache=${elapsed < 5 ? 'HIT' : 'MISS'})`);
    if (elapsed < minLoadMs && _vibeTourVisible) {
      await new Promise(r => {
        _vibeTourLoadWaitResolve = r;
        _vibeTourLoadWaitTimer = setTimeout(() => {
          _vibeTourLoadWaitTimer = null;
          const done = _vibeTourLoadWaitResolve;
          _vibeTourLoadWaitResolve = null;
          if (done) done();
        }, minLoadMs - elapsed);
      });
    }
    if (!_vibeTourVisible) return;
    console.log(`[perf] tour popup open`);
    openVibeTourPopup(hotels, svUrls);
  }

  function openVibeTourForHotel(hotelId) {
    const target = (_lastHotels || []).find(h => String(h.id) === String(hotelId));
    if (!target) return;
    openVibeTourWithStreetView([target]);
  }

  function closeVibeTourPopup(scrollToList = false) {
    const ov = document.getElementById('vibe-tour-overlay');
    if (ov) {
      ov.setAttribute('aria-hidden', 'true');
      ov.classList.remove('vibe-tour-overlay--max');
      ov.innerHTML = '';
    }
    _vibeTourPseudoFullscreen = false;
    _vibeTourVisible = false;
    _vibeTourPending = false;
    if (_vibeTourTimer) clearTimeout(_vibeTourTimer);
    _vibeTourTimer = null;
    if (_vibeTourLoadWaitTimer) clearTimeout(_vibeTourLoadWaitTimer);
    _vibeTourLoadWaitTimer = null;
    if (_vibeTourLoadWaitResolve) {
      const r = _vibeTourLoadWaitResolve;
      _vibeTourLoadWaitResolve = null;
      try { r(); } catch (_) {}
    }
    stopVibeTourAudio();
    document.body.style.overflow = '';
    if (_deferResultsRenderUntilTourClose) {
      _deferResultsRenderUntilTourClose = false;
      const resEl = document.getElementById('results');
      exitResultsPendingMode();
      if (resEl) resEl.classList.remove('no-anim');
      renderSorted();
    }
    if (scrollToList) {
      document.getElementById('results')?.querySelector('.hotel-card,.hotel-row')?.scrollIntoView({ behavior:'smooth', block:'start' });
    }
  }

  function syncVibeTourFullscreenButton() {
    const btn = document.getElementById('vibe-tour-fullscreen-btn');
    if (!btn) return;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement || null;
    const active = !!fsEl || _vibeTourPseudoFullscreen;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
    btn.setAttribute('title', active ? 'Exit fullscreen' : 'Fullscreen');
    btn.innerHTML = active
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3H3v6M15 3h6v6M21 15v6h-6M3 15v6h6"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5"/></svg>';
  }

  async function toggleVibeTourFullscreen() {
    const ov = document.getElementById('vibe-tour-overlay');
    if (!ov) return;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement || null;
    const hasNativeFs = !!(ov.requestFullscreen || ov.webkitRequestFullscreen);
    try {
      if (fsEl) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } else if (_vibeTourPseudoFullscreen) {
        _vibeTourPseudoFullscreen = false;
        ov.classList.remove('vibe-tour-overlay--max');
      } else if (hasNativeFs) {
        if (ov.requestFullscreen) await ov.requestFullscreen();
        else if (ov.webkitRequestFullscreen) ov.webkitRequestFullscreen();
      } else {
        _vibeTourPseudoFullscreen = true;
        ov.classList.add('vibe-tour-overlay--max');
      }
    } catch (_) {}
    syncVibeTourFullscreenButton();
  }

  function syncVibeTourSceneDOM() {
    const tour = document.getElementById('vibe-tour');
    if (!tour) return;
    tour.dataset.scene = String(_vibeTourScene);
    tour.querySelectorAll('.vibe-tour-scene').forEach((s, i) => s.classList.toggle('active', i === _vibeTourScene));
    tour.querySelectorAll('.vibe-tour-progress button').forEach((b, i) => b.classList.toggle('active', i === _vibeTourScene));
  }

  function bindVibeTourSwipe() {
    const stage = document.querySelector('#vibe-tour .vibe-tour-stage');
    if (!stage || stage.dataset.swipeBound === '1') return;
    stage.dataset.swipeBound = '1';
    stage.addEventListener('touchstart', (ev) => {
      const t = ev.changedTouches?.[0];
      if (!t) return;
      _vibeTouchStartX = t.clientX;
      _vibeTouchStartY = t.clientY;
    }, { passive:true });
    stage.addEventListener('touchend', (ev) => {
      const t = ev.changedTouches?.[0];
      if (!t || _vibeTouchStartX == null || _vibeTouchStartY == null) return;
      const dx = t.clientX - _vibeTouchStartX;
      const dy = t.clientY - _vibeTouchStartY;
      _vibeTouchStartX = null;
      _vibeTouchStartY = null;
      if (Math.abs(dx) < 44 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;
      shiftVibeTourScene(dx < 0 ? 1 : -1);
      startVibeTourAutoAdvance();
    }, { passive:true });
  }

  function setVibeTourScene(idx, restartTimer = false) {
    const maxIdx = Math.max(0, (_vibeTourSceneCount || 1) - 1);
    _vibeTourScene = Math.max(0, Math.min(maxIdx, Number(idx) || 0));
    syncVibeTourSceneDOM();
    if (restartTimer) startVibeTourAutoAdvance();
  }

  function shiftVibeTourScene(delta) {
    const n = Math.max(1, _vibeTourSceneCount || 1);
    setVibeTourScene((_vibeTourScene + delta + n) % n, true);
  }

  function startVibeTourAutoAdvance() {
    if (_vibeTourTimer) clearTimeout(_vibeTourTimer);
    _vibeTourTimer = null;
    if (!_vibeTourVisible) return;
    const activeScene = document.querySelector('#vibe-tour .vibe-tour-scene.active');
    const duration = Math.max(1200, Number(activeScene?.dataset.duration) || 4000);
    _vibeTourTimer = setTimeout(() => shiftVibeTourScene(1), duration);
  }

  function stopVibeTourAudio() {
    if (!_vibeTourAudio) return;
    try {
      _vibeTourAudio.gain.gain.setTargetAtTime(0, _vibeTourAudio.ctx.currentTime, 0.08);
      setTimeout(() => {
        try { _vibeTourAudio.osc.forEach(o => o.stop()); _vibeTourAudio.ctx.close(); } catch (_) {}
      }, 180);
    } catch (_) {}
    _vibeTourAudio = null;
    const btn = document.getElementById('vibe-tour-audio-btn');
    if (btn) {
      btn.textContent = 'Music off';
      btn.classList.remove('active');
    }
  }

  function toggleVibeTourAudio() {
    if (_vibeTourAudio) { stopVibeTourAudio(); return; }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) { flashMsg('Audio is not supported in this browser'); return; }
    try {
      const ctx = new AudioCtx();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.connect(ctx.destination);
      const freqs = [146.83, 220, 329.63];
      const osc = freqs.map((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = i === 1 ? 'triangle' : 'sine';
        o.frequency.value = f;
        g.gain.value = i === 1 ? 0.12 : 0.08;
        o.connect(g);
        g.connect(gain);
        o.start();
        return o;
      });
      gain.gain.setTargetAtTime(0.055, ctx.currentTime, 0.35);
      _vibeTourAudio = { ctx, gain, osc };
      const btn = document.getElementById('vibe-tour-audio-btn');
      if (btn) {
        btn.textContent = 'Music on';
        btn.classList.add('active');
      }
    } catch (_) {
      flashMsg('Could not start music');
    }
  }
  document.addEventListener('fullscreenchange', syncVibeTourFullscreenButton);
  document.addEventListener('webkitfullscreenchange', syncVibeTourFullscreenButton);

  function dismissVibeTour() {
    closeVibeTourPopup();
  }

  function setViewMode(mode) {
    _viewMode = mode;
    localStorage.setItem('rmViewMode', mode);
    document.getElementById('viewBtnCards').classList.toggle('active', mode === 'cards');
    document.getElementById('viewBtnRows').classList.toggle('active', mode === 'rows');
    renderSorted();
  }

  function toggleHotelRow(hotelId) {
    const row  = document.getElementById(`hrow-${hotelId}`);
    const body = document.getElementById(`hrow-body-${hotelId}`);
    if (!row || !body) return;
    const isOpen = row.classList.contains('row-open');
    row.classList.toggle('row-open', !isOpen);
    body.classList.toggle('open', !isOpen);
  }

  function toggleRowRoom(hotelId, ri) {
    const item = document.getElementById(`rrow-${hotelId}-${ri}`);
    if (!item) return;
    item.classList.toggle('room-row-open');
  }

  function openRowThumb(hotelId, ri, pi) {
    // Open lightbox for photo pi of room ri, and also expand the hotel row + room row
    const row  = document.getElementById(`hrow-${hotelId}`);
    const body = document.getElementById(`hrow-body-${hotelId}`);
    if (row && !row.classList.contains('row-open')) {
      row.classList.add('row-open');
      body.classList.add('open');
    }
    const item = document.getElementById(`rrow-${hotelId}-${ri}`);
    if (item && !item.classList.contains('room-row-open')) {
      item.classList.add('room-row-open');
    }
    // Find the registry key stored on the item
    const regKey = item ? parseInt(item.dataset.regkey, 10) : -1;
    if (regKey >= 0) openLightbox(regKey, pi);
  }

  function hotelRowHTML(h) {
    const sym   = _priceCurrency === 'EUR' ? '€' : '$';
    const score = hotelEffectiveScore(h);
    const hotelIdAttr = escHtml(String(h.id));
    const allRoomTypes = h.roomTypes || [];
    const canFilter    = _showAvailOnly && _hasDateSearch && _pricesLoaded;
    const availRTs     = allRoomTypes.filter(rt => rt.roomTypeId != null && h.roomPrices?.[rt.roomTypeId] != null);
    const visibleRooms = canFilter
      ? (availRTs.length > 0 ? availRTs : (h.price != null ? allRoomTypes : []))
      : allRoomTypes;

    const topRoom = visibleRooms[0];
    const previewPhotos = topRoom ? (topRoom.photos || []).slice(0, 3) : [];

    const thumbHTML = h.mainPhoto
      ? `<img class="hotel-row-thumb" src="${h.mainPhoto}" alt="${h.name}" loading="lazy" onerror="this.outerHTML='<div class=hotel-row-thumb-placeholder></div>'">`
      : `<div class="hotel-row-thumb-placeholder"></div>`;

    const stars  = h.starRating > 0 ? '★'.repeat(Math.min(Math.round(h.starRating), 5)) : '';
    const rating = h.rating > 0 ? `· ${parseFloat(h.rating).toFixed(1)} ★` : '';

    const previewsHTML = previewPhotos.map((url, pi) =>
      `<img class="row-preview-thumb" src="${url}" loading="lazy"
           onclick="event.stopPropagation();openRowThumb('${h.id}',0,${pi})"
           onerror="this.style.display='none'">`
    ).join('');

    const priceHTML = h.price != null
      ? `<div class="hotel-row-price-main">${sym}${Math.round(h.price).toLocaleString()}</div>
         <div class="hotel-row-price-per">/night</div>
         ${_hasDateSearch && S.checkin && S.checkout ? `<div class="hotel-row-price-total">${sym}${Math.round(h.price * (Math.round((new Date(S.checkout) - new Date(S.checkin)) / 86400000) || 1)).toLocaleString()} total</div>` : ''}`
      : _fetchingPrices
        ? `<div class="hotel-row-price-skeleton"></div>`
        : `<div class="hotel-row-price-per" style="margin-top:4px">${_pricesLoaded ? 'No rates' : 'Add dates'}</div>`;

    // Build room sub-rows
    const roomRowsHTML = visibleRooms.map((rt, ri) => {
      const regKey = _lbRegistry.length;
      _lbRegistry.push({ photos: rt.photos || [], name: rt.name, score: rt.score });
      const photoHTML = (rt.photos || []).slice(0, 10).map((url, pi) =>
        `<div class="row-photo-cell" onclick="openLightbox(${regKey},${pi})">
          <img src="${url}" alt="${rt.name}" loading="lazy" onerror="this.parentElement.style.display='none'">
        </div>`
      ).join('');
      const scoreBadge = rt.score > 0
        ? `<span class="room-score-badge${rt.score < 20 ? ' room-score-badge--low' : ''}">${rt.score}%</span>`
        : '';
      return `
        <div class="row-room-item${ri === 0 ? ' room-row-open' : ''}" id="rrow-${h.id}-${ri}" data-regkey="${regKey}"
             onclick="toggleRowRoom('${h.id}',${ri})">
          <img class="row-room-thumb" src="${(rt.photos||[])[0]||''}" loading="lazy" onerror="this.style.display='none'">
          <span class="row-room-name">${rt.name}</span>
          ${scoreBadge}
          <span class="row-room-chevron">▼</span>
        </div>
        <div class="row-photo-strip-wrap${ri === 0 ? ' open' : ''}" style="${ri === 0 ? 'max-height:200px' : ''}">
          <div class="row-photo-strip">${photoHTML}</div>
        </div>`;
    }).join('');

    const moreCount = allRoomTypes.length - visibleRooms.length;
    const moreHTML  = moreCount > 0
      ? `<div class="row-more-rooms" onclick="event.stopPropagation()">▾ ${moreCount} more room type${moreCount > 1 ? 's' : ''}</div>`
      : '';

    return `
      <div class="hotel-row" id="hrow-${h.id}" onclick="toggleHotelRow('${h.id}')">
        ${thumbHTML}
        <div class="hotel-row-info">
          <div class="hotel-row-name">${h.name}</div>
          <div class="hotel-row-meta">${stars ? `<span style="color:var(--accent);font-size:10px">${stars}</span> · ` : ''}${h.address || h.city || ''}</div>
          <div class="hotel-row-score">${rating}</div>
        </div>
        <div class="hotel-row-previews">${previewsHTML}</div>
        <div class="hotel-row-match">
          <div class="hotel-row-match-pct">${score > 0 ? score + '%' : '—'}</div>
          <div class="hotel-row-match-label">match</div>
          ${topRoom ? `<div class="hotel-row-match-room">${topRoom.name}</div>` : ''}
          <button type="button" class="hotel-row-tour-link" data-hotel-id="${hotelIdAttr}" onclick="event.stopPropagation();openVibeTourForHotel(this.dataset.hotelId)">Vibe tour</button>
        </div>
        <div class="hotel-row-price" id="hotel-row-price-${h.id}">${priceHTML}</div>
        <span class="hotel-row-chevron">▼</span>
      </div>
      <div class="hotel-row-body" id="hrow-body-${h.id}">
        <div class="row-room-list">${roomRowsHTML}</div>
        ${moreHTML}
      </div>`;
  }

  // Returns true if the hotel should be shown given the current availability filter.
  // When "available rooms only" is active, hotels with no rate data from LiteAPI
  // are hidden entirely rather than shown at 0% — cleaner UX than showing a result
  // the user can't act on.
  function hotelPassesAvailFilter(h) {
    if (!(_showAvailOnly && _hasDateSearch && _pricesLoaded)) return true;
    if (h.price != null) return true;
    const availRooms = (h.roomTypes || []).filter(rt => rt.roomTypeId != null && h.roomPrices?.[rt.roomTypeId] != null);
    return availRooms.length > 0;
  }

  function hotelPassesFreeCancelFilter(h) {
    if (!_requireFreeCancel) return true;
    if (!_hasDateSearch || !_pricesLoaded) return true;
    if (h.hotelFreeCancel === true) return true;
    const rfc = h.roomFreeCancel;
    if (!rfc || typeof rfc !== 'object') return false;
    for (const rt of (h.roomTypes || [])) {
      const id = rt.roomTypeId;
      if (id == null || h.roomPrices?.[id] == null) continue;
      if (rfc[id] === true || rfc[String(id)] === true) return true;
    }
    return false;
  }

  /** Wizard "How much should price matter" (-100…100) for Match+Price ranking. */
  function boopPriceMattersForSort() {
    const pm = Number(S.boopProfile?.answers?.priceMatters);
    if (!Number.isFinite(pm)) return 0;
    return Math.max(-100, Math.min(100, pm));
  }

  function getSortedHotelsForDisplay() {
    let hotels = [..._lastHotels].filter(hotelPassesAvailFilter).filter(hotelPassesFreeCancelFilter);
    if (_nbhdFilter) {
      hotels = hotels.filter(h => h?.primary_nbhd?.name === _nbhdFilter);
    }
    if (_propTypeFilter && _propTypeFilter !== 'all') {
      hotels = hotels.filter(h => {
        const pt = h.property_type || 'hotel';
        // legacy apartment_rental maps to apartment
        const normalized = pt === 'apartment_rental' ? 'apartment' : pt;
        return normalized === _propTypeFilter;
      });
    }
    if (_currentSort === 'rating') {
      hotels.sort((a, b) => {
        const cmp = (b.rating || 0) - (a.rating || 0);
        return _sortReverse ? -cmp : cmp;
      });
    } else if (_currentSort === 'stars') {
      hotels.sort((a, b) => {
        const cmp = (b.starRating || 0) - (a.starRating || 0);
        return _sortReverse ? -cmp : cmp;
      });
    } else if (_currentSort === 'price') {
      hotels.sort((a, b) => {
        const cmp = (a.price ?? Infinity) - (b.price ?? Infinity);
        return _sortReverse ? -cmp : cmp;
      });
    } else if (_currentSort === 'match+price') {
      // Match tier first. Then blend match % with a price score shaped by Boop
      // "price matters" slider (-100 less → +100 very) and the sort-direction toggle.
      const tier = s => s >= 40 ? 0 : s >= 15 ? 1 : 2;
      const priced = hotels.filter(h => h.price != null).map(h => h.price).sort((a, b) => a - b);
      let p10 = 0;
      let p90 = 0;
      let priceRange = 1;
      if (priced.length) {
        p10 = priced[Math.floor(priced.length * 0.10)] ?? priced[0];
        p90 = priced[Math.floor(priced.length * 0.90)] ?? priced[priced.length - 1];
        priceRange = Math.max(p90 - p10, 1);
      }
      const normPriceCheap = p => {
        if (p == null) return 0;
        if (!priced.length) return 50;
        return Math.max(0, Math.min(100, ((p90 - p) / priceRange) * 100));
      };
      const normPriceExpensive = p => {
        if (p == null) return 0;
        if (!priced.length) return 50;
        return Math.max(0, Math.min(100, ((p - p10) / priceRange) * 100));
      };
      const pm = boopPriceMattersForSort();
      const gamma = (100 - pm) / 200;
      const normSlider = p => {
        if (p == null) return 0;
        if (!priced.length) return 50;
        return gamma * normPriceExpensive(p) + (1 - gamma) * normPriceCheap(p);
      };
      const MATCH_W = 0.25 + gamma * 0.53;
      const PRICE_W = 1 - MATCH_W;
      hotels.sort((a, b) => {
        const aScore = hotelEffectiveScore(a);
        const bScore = hotelEffectiveScore(b);
        const tierDiff = tier(aScore) - tier(bScore);
        if (tierDiff !== 0) return tierDiff;
        if (!priced.length) {
          const cmp = bScore - aScore;
          return _sortReverse ? -cmp : cmp;
        }
        const aComb = MATCH_W * aScore + PRICE_W * normSlider(a.price);
        const bComb = MATCH_W * bScore + PRICE_W * normSlider(b.price);
        const d = bComb - aComb;
        if (Math.abs(d) > 1e-6) {
          const sign = d > 0 ? 1 : -1;
          return _sortReverse ? -sign : sign;
        }
        if (bScore !== aScore) return bScore - aScore;
        if (a.price != null && b.price != null) {
          return _sortReverse ? a.price - b.price : b.price - a.price;
        }
        if (a.price != null) return -1;
        if (b.price != null) return 1;
        return 0;
      });
    } else if (_currentSort === 'match+price+rating') {
      const tier = s => s >= 40 ? 0 : s >= 15 ? 1 : 2;
      const pricedHotels = hotels.filter(h => h.price != null).map(h => h.price).sort((a, b) => a - b);
      const p10 = pricedHotels[Math.floor(pricedHotels.length * 0.10)] ?? pricedHotels[0] ?? 100;
      const p90 = pricedHotels[Math.floor(pricedHotels.length * 0.90)] ?? pricedHotels[pricedHotels.length - 1] ?? 500;
      const priceRange = Math.max(p90 - p10, 1);
      const normPrice  = p => p == null ? 50 : Math.max(0, Math.min(100, (p90 - p) / priceRange * 100));
      const normRating = r => r > 0 ? (r / 10) * 100 : 60;
      hotels.sort((a, b) => {
        const aScore = hotelEffectiveScore(a);
        const bScore = hotelEffectiveScore(b);
        const tierDiff = tier(aScore) - tier(bScore);
        if (tierDiff !== 0) return tierDiff;
        const scoreDiff = bScore - aScore;
        let cmp = 0;
        if (Math.abs(scoreDiff) > 3) cmp = scoreDiff;
        else {
          const aValue = 0.50 * normPrice(a.price) + 0.50 * normRating(a.rating);
          const bValue = 0.50 * normPrice(b.price) + 0.50 * normRating(b.rating);
          cmp = bValue - aValue;
        }
        return _sortReverse ? -cmp : cmp;
      });
    } else if (_currentSort === 'match') {
      const wNbhd = typeof _lastVsearchStats?.nbhd_rank_weight === 'number' ? _lastVsearchStats.nbhd_rank_weight : 0;
      const canFilter = _showAvailOnly && _hasDateSearch && _pricesLoaded;
      hotels.sort((a, b) => {
        let cmp = 0;
        if (wNbhd > 0 && a.nbhd_fit_pct != null && b.nbhd_fit_pct != null) {
          // Use vectorScore (hotel-level, matches server sort basis) unless
          // availability filtering is active (then room-level effective score is correct).
          const ra = canFilter ? hotelEffectiveScore(a) / 100 : (a.vectorScore || 0) / 100;
          const rb = canFilter ? hotelEffectiveScore(b) / 100 : (b.vectorScore || 0) / 100;
          const ca = (1 - wNbhd) * ra + wNbhd * (a.nbhd_fit_pct / 100);
          const cb = (1 - wNbhd) * rb + wNbhd * (b.nbhd_fit_pct / 100);
          const d = cb - ca;
          if (Math.abs(d) > 1e-9) cmp = d > 0 ? 1 : -1;
        }
        if (cmp === 0) cmp = hotelEffectiveScore(b) - hotelEffectiveScore(a);
        return _sortReverse ? -cmp : cmp;
      });
    }
    return hotels;
  }

  function renderSorted() {
    if (document.getElementById('st-results')?.classList.contains('results-pending')) return;
    const hotels = getSortedHotelsForDisplay();

    const toShow    = hotels.slice(0, _displayedCount);
    const remaining = hotels.length - _displayedCount;
    const total     = hotels.length;

    // Update result count in sort bar
    const showing = toShow.length;
    const nbhdSuffix = selectedNeighborhood?.name ? ` · ${selectedNeighborhood.name}` : '';
    document.getElementById('resultCount').textContent =
      remaining > 0 ? `Showing ${showing} of ${total} hotels${nbhdSuffix}` : `${total} hotel${total !== 1 ? 's' : ''}${nbhdSuffix}`;
    const dbgBtn = document.getElementById('debugCopyBtn');
    if (dbgBtn) dbgBtn.style.display = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? '' : 'none';

    const resultsEl = document.getElementById('results');
    resultsEl.classList.toggle('results-rows', _viewMode === 'rows');

    // BOOP v4 — populate the top-neighbourhood refine strip (lives above #results)
    renderNbhdRefineStrip(hotels);

    _lbRegistry.length = 0;
    let html = toShow.map(_viewMode === 'rows' ? hotelRowHTML : hotelHTML).join('');

    // Sentinel triggers loading more
    if (remaining > 0) {
      const nextBatch = Math.min(remaining, 10);
      html += `<div id="scroll-sentinel" style="height:48px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px">
        Loading ${nextBatch} more…
      </div>`;
    }

    resultsEl.innerHTML = html;
    bindFeaturedStripNavs(resultsEl);

    if (remaining > 0) {
      const sentinel = document.getElementById('scroll-sentinel');
      const obs = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
          obs.disconnect();
          _displayedCount += 10;
          renderSorted();
        }
      }, { rootMargin: '300px' });
      obs.observe(sentinel);
    }
    updateFreeCancelHint();
    syncSortDirectionIndicators();
  }

  // ── showMoreRooms ─────────────────────────────────────────────────────────
  // Reveals hidden compact room rows and removes the "Show N more" button.
  function showMoreRooms(btn) {
    const container = btn.closest('.rooms-other');
    if (!container) return;
    container.querySelectorAll('.room-hidden').forEach(r => r.classList.remove('room-hidden'));
    btn.remove();
  }

  // ── roomsSectionHTML ──────────────────────────────────────────────────────
  // Generates the full rooms section (divider band + featured room + compact list).
  // Called by both hotelHTML() and applyPricesInPlace() to keep output in sync.
  //
  // Best match uses the featured 3-photo block only. Compact rows stay collapsed unless
  // openCompactIdx >= 0 (user had that row expanded before an in-place rebuild).
  const COMPACT_SHOW = 3;

  function roomsSectionHTML(roomTypes, hotelScore, roomPrices, hasDateSearch, noAvailNotice, openCompactIdx = -1, hotel = null) {
    if (roomTypes.length === 0) return noAvailNotice;

    const featured = roomTypes[0];
    const others   = roomTypes.slice(1);

    const featuredHTML = roomTypeHTML(featured, true, hotelScore, roomPrices, hasDateSearch, 'featured', false, hotel);

    let othersSection = '';
    if (others.length > 0) {
      const visibleOthers = others.slice(0, COMPACT_SHOW);
      const hiddenOthers  = others.slice(COMPACT_SHOW);

      const visibleHTML = visibleOthers.map((rt, ci) =>
        roomTypeHTML(rt, openCompactIdx >= 0 && ci === openCompactIdx, hotelScore, roomPrices, hasDateSearch, 'compact', false, hotel)
      ).join('');

      const hiddenHTML = hiddenOthers.map(rt =>
        roomTypeHTML(rt, false, hotelScore, roomPrices, hasDateSearch, 'compact', true, hotel)
      ).join('');

      const showMoreBtn = hiddenOthers.length > 0
        ? `<button class="rooms-show-more" onclick="showMoreRooms(this)">Show ${hiddenOthers.length} more room type${hiddenOthers.length !== 1 ? 's' : ''} ↓</button>`
        : '';

      othersSection = `
        <div class="rooms-other-header">OTHER ROOM TYPES (${others.length})</div>
        <div class="rooms-other">${visibleHTML}${hiddenHTML}${showMoreBtn}</div>`;
    }

    return `${noAvailNotice}
      <div class="hotel-divider-band">BEST MATCHING ROOM</div>
      ${featuredHTML}
      ${othersSection}`;
  }

  // ── BOOP v4 — Top-neighbourhood refine strip ─────────────────────────────
  // Tallies hotels by primary_nbhd, takes top 10 (min 2 hotels). On desktop the
  // first 5 (after "All") render inline; the rest live behind a "More ▾" button
  // that toggles a dropdown panel. On mobile (≤640px) the dropdown is hidden
  // via CSS and ALL chips render inline so users can swipe-scroll.
  let _nbhdFilter = null;
  let _nbhdRefineDropdownOpen = false;
  const NBHD_REFINE_INLINE_LIMIT = 5;

  let _availMountRaf = null;
  function scheduleSyncAvailFilterMount() {
    if (_availMountRaf != null) cancelAnimationFrame(_availMountRaf);
    _availMountRaf = requestAnimationFrame(() => {
      _availMountRaf = null;
      syncAvailFilterMount();
    });
  }

  /** Desktop: filters stay in sort bar. Mobile: move both into nbhd strip. */
  function syncAvailFilterMount() {
    const avail        = document.getElementById('availFilter');
    const propType     = document.getElementById('propTypeFilter');
    const desktopMount = document.getElementById('availFilterMountDesktop');
    const stripSlot    = document.getElementById('nbhd-refine-avail-slot');
    if (!desktopMount) return;
    const mobile = typeof window.matchMedia !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
    [propType, avail].forEach(el => {
      if (!el) return;
      if (mobile && stripSlot) stripSlot.appendChild(el);
      else desktopMount.appendChild(el);
    });
  }

  window.addEventListener('resize', scheduleSyncAvailFilterMount);

  function closeNbhdRefineDropdown() {
    const dd = document.getElementById('nbhd-refine-dropdown');
    const btn = document.getElementById('nbhd-refine-more-btn');
    if (dd) dd.hidden = true;
    if (btn) btn.setAttribute('aria-expanded', 'false');
    _nbhdRefineDropdownOpen = false;
  }

  function toggleNbhdRefineExpand(ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    const dd = document.getElementById('nbhd-refine-dropdown');
    const btn = document.getElementById('nbhd-refine-more-btn');
    if (!dd || !btn) return;
    _nbhdRefineDropdownOpen = !_nbhdRefineDropdownOpen;
    dd.hidden = !_nbhdRefineDropdownOpen;
    btn.setAttribute('aria-expanded', _nbhdRefineDropdownOpen ? 'true' : 'false');
  }

  function renderNbhdRefineStrip(hotelsAfterFilters) {
    const strip = document.getElementById('nbhd-refine-strip');
    if (!strip) return;
    // Tally across the *full* _lastHotels (not filtered by this strip) so the
    // counts reflect the base result set, not the currently-narrowed one.
    const tallySource = _lastHotels || [];
    const counts = new Map();
    for (const h of tallySource) {
      const n = h?.primary_nbhd;
      if (!n || !n.name) continue;
      const key = n.name;
      const cur = counts.get(key) || { count:0, nbhd:n };
      cur.count++;
      counts.set(key, cur);
    }
    const entries = Array.from(counts.values())
      .filter(e => e.count >= 2)
      .sort((a,b) => b.count - a.count)
      .slice(0, 10);
    if (entries.length < 2) {
      const dm0 = document.getElementById('availFilterMountDesktop');
      const af0 = document.getElementById('availFilter');
      if (dm0 && af0) dm0.appendChild(af0);
      strip.style.display = 'none';
      strip.innerHTML = '';
      closeNbhdRefineDropdown();
      scheduleSyncAvailFilterMount();
      return;
    }
    const chipHtml = (e, extraOnClick) => {
      const isActive = _nbhdFilter === e.nbhd.name ? 'active' : '';
      const safeName = e.nbhd.name.replace(/'/g, "\\'");
      const handler = extraOnClick
        ? `${extraOnClick};setNbhdFilter('${safeName}')`
        : `setNbhdFilter('${safeName}')`;
      return `<button type="button" class="nbhd-chip ${isActive}" onclick="${handler}" title="${escHtml(e.nbhd.vibe_short || '')}">
          <span class="nbhd-chip-name">${escHtml(e.nbhd.name)}</span>
          <span class="nbhd-chip-count">${e.count}</span>
        </button>`;
    };
    // Desktop layout: "All" + first 5 stay inline; rest go into the dropdown.
    // Mobile (≤640px) hides the More wrap via CSS and reveals the overflow
    // chips inline (wrapped in .nbhd-refine-mobile-overflow) so swipe-scroll
    // still shows every chip.
    const inlineEntries = entries.slice(0, NBHD_REFINE_INLINE_LIMIT);
    const overflowEntries = entries.slice(NBHD_REFINE_INLINE_LIMIT);
    const desktopInlineHtml = [
      `<button type="button" class="nbhd-chip ${_nbhdFilter ? '' : 'active'}" onclick="setNbhdFilter(null)">All</button>`,
      ...inlineEntries.map(e => chipHtml(e))
    ].join('');
    const mobileOverflowHtml = overflowEntries.map(e => chipHtml(e)).join('');
    const dropdownHtml = overflowEntries
      .map(e => chipHtml(e, 'closeNbhdRefineDropdown()'))
      .join('');
    const showMore = overflowEntries.length > 0;
    closeNbhdRefineDropdown();
    strip.className = 'nbhd-refine-strip';
    const dmStrip = document.getElementById('availFilterMountDesktop');
    const afStrip = document.getElementById('availFilter');
    if (dmStrip && afStrip) dmStrip.appendChild(afStrip);
    const osmCredit =
      selectedNeighborhood && selectedNeighborhood.polygon && Array.isArray(selectedNeighborhood.polygon.ring) && selectedNeighborhood.polygon.ring.length >= 4
        ? `<div class="nbhd-osm-credit">Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors</div>`
        : '';
    strip.innerHTML = `
      <div class="nbhd-refine-inner">
        <div class="nbhd-refine-toprow">
          <span class="nbhd-refine-label">Top neighbourhoods</span>
          <div class="nbhd-refine-avail-slot" id="nbhd-refine-avail-slot"></div>
        </div>
        <div class="nbhd-refine-main">
          <div class="nbhd-refine-chips" id="nbhd-refine-chips">${desktopInlineHtml}<span class="nbhd-refine-mobile-overflow">${mobileOverflowHtml}</span></div>
          ${showMore ? `
          <div class="nbhd-refine-more-wrap">
            <button type="button" class="nbhd-refine-more" id="nbhd-refine-more-btn" onclick="toggleNbhdRefineExpand(event)" aria-expanded="false" aria-haspopup="true" aria-controls="nbhd-refine-dropdown">More <span class="nbhd-refine-more-arr">▾</span></button>
            <div class="nbhd-refine-dropdown" id="nbhd-refine-dropdown" role="menu" hidden>${dropdownHtml}</div>
          </div>` : ''}
        </div>
        ${osmCredit}
      </div>`;
    strip.style.display = '';
    scheduleSyncAvailFilterMount();
  }

  function setNbhdFilter(name) {
    _nbhdFilter = name;
    renderSorted();
  }

  // ── BOOP v4 — Nbhd vibe score (client-side) ──────────────────────────────
  // Dot-product of the user's saved prefs × the neighbourhood's attribute
  // vector, normalised to 0-100. Falls back gracefully when either side is
  // missing (returns 0 → pill hidden).

  // Nbhd rows in Supabase were generated with a categorical schema
  // (green_spaces="some", street_energy="lively", …) but BOOP prefs are
  // numeric weights on { central, local, calm, walkability, nightlife, green,
  // cafes, foodie, luxury, shopping, culture, iconic }. Translate one to the
  // other so the dot product is meaningful. Unknown categories → neutral (5).
  const _NBHD_CAT_SCORE = {
    minimal:2, some:5, abundant:8, plenty:8, extensive:8, significant:7,
    quiet:2, moderate:5, lively:8, vibrant:8, bustling:9,
    limited:3, good:6, excellent:8, outstanding:9, fair:4,
    high:3, medium:5, low:7  // transport_dependency — low dep = high walkability
  };
  function _nbhdCatToNum(s) {
    const v = _NBHD_CAT_SCORE[String(s || '').toLowerCase()];
    return Number.isFinite(v) ? v : 5;
  }
  function _nbhdAttrsToBoopAxes(attrs) {
    if (!attrs) return {};
    // Support both the categorical legacy schema and numeric attrs (future).
    const already = Object.values(attrs).every(v => Number.isFinite(Number(v)));
    if (already) return attrs;
    const green     = _nbhdCatToNum(attrs.green_spaces);
    const energy    = _nbhdCatToNum(attrs.street_energy);
    const transport = _nbhdCatToNum(attrs.transport_dependency);
    const walkD     = _nbhdCatToNum(attrs.walkability_dining);
    const walkT     = _nbhdCatToNum(attrs.walkability_tourist_spots);
    const skyline   = String(attrs.skyline_character || '').toLowerCase();
    return {
      green,
      calm:        Math.max(0, 10 - energy),
      nightlife:   energy,
      walkability: Math.round((walkD + walkT + transport) / 3),
      central:     transport,
      iconic:      walkT,
      cafes:       walkD,
      foodie:      walkD,
      luxury:      skyline.includes('modern high-rise') ? 7 : 5,
      culture:     /historic|classic|old|heritage/.test(skyline) ? 8 : 5,
      local:       Math.max(0, 10 - walkT),
      shopping:    Math.round((walkD + energy) / 2)
    };
  }

  function computeNbhdVibe(h) {
    const nbhd = h?.primary_nbhd;
    if (!nbhd) return 0;
    const fromPicker = lookupNbhdPickerMatch(nbhd);
    if (typeof fromPicker === 'number') return fromPicker;
    if (!nbhd.attributes) return 0;
    const profile = getEffectiveBoopProfileForScoring();
    const prefs = mergeBoopFreetextIntoPrefs(profile?.prefs || {}, profile?.freetext || '');
    if (!prefs || !Object.keys(prefs).length) return 0;
    const attrs = _nbhdAttrsToBoopAxes(nbhd.attributes);
    // Dot-product over BOOP pref axes (keys both sides now agree on).
    // Attributes are 0-10 (centered at 5); prefs are BOOP weighted integers
    // (~±0-30). Normalise each side and sum, scaled to 0-100.
    let dot = 0, norm = 0;
    for (const k of Object.keys(attrs)) {
      const a = Number(attrs[k]);
      const p = Number(prefs[k] || 0);
      if (!Number.isFinite(a) || !Number.isFinite(p)) continue;
      const pN = Math.max(-1, Math.min(1, p / 30));
      const aN = (a - 5) / 5;
      dot  += pN * aN;
      norm += Math.abs(pN);
    }
    if (norm < 0.01) return 0;
    // dot ∈ [-norm, +norm]; map to 0..100 (0.5 = neutral).
    const raw = 0.5 + (dot / Math.max(norm, 0.01)) * 0.5;
    return Math.max(0, Math.min(100, Math.round(raw * 100)));
  }

  function _vibeClass(v) {
    if (v >= 75) return 'vbp-high';
    if (v >= 50) return 'vbp-mid';
    if (v >= 20) return 'vbp-low';
    return 'vbp-vlow';
  }

  function buildVibeTriplet(room, hotel, nbhd) {
    const pills = [];
    if (room  > 0) pills.push(`<span class="vibe-pill ${_vibeClass(room)}"  title="Room Vibe — how this hotel's rooms match your room vibe"><b>${room}%</b><i>Room</i></span>`);
    if (hotel > 0) pills.push(`<span class="vibe-pill ${_vibeClass(hotel)}" title="Hotel Vibe — how the hotel's lobby, bar, amenities match your trip vibe"><b>${hotel}%</b><i>Hotel</i></span>`);
    if (nbhd  > 0) pills.push(`<span class="vibe-pill ${_vibeClass(nbhd)}"  title="Neighbourhood Vibe — how this area matches your trip preferences"><b>${nbhd}%</b><i>Nbhd</i></span>`);
    if (!pills.length) return '';
    return `<div class="vibe-triplet">${pills.join('')}</div>`;
  }

  // ── Hotel Details — full page (replaces the legacy slide-out panel) ────────
  // Route:    GET /hotel/:hotelId
  // Container: #st-hotel-detail (parallel to #st-results / #discovery-flow).
  // Reuses the existing /api/hotel/:hotelId data + the hp-* element styles
  // (carousel, lightbox, sections, reviews, amenities) inside a richer page
  // layout (.hpage-*) with sticky sidebar + mobile sticky CTA bar.

  let _detailHotelId    = null;
  let _detailHotelData  = null;       // last loaded payload (for sticky-sidebar duplication, etc.)
  const _detailInflight = new Map();
  // Saved view state so closing the detail page restores the user's prior
  // results/discovery view + scroll position without re-running search.
  let _detailReturnState = null;      // { results: bool, scrollY: number }
  let _hpCarouselIdx  = 0;
  let _hpLightboxIdx  = 0;
  let _hpLightboxUrls = [];
  // Reviews UI state — purely in-memory, never persisted client-side either.
  // (We rely on the server for caching; this just tracks pagination + IO observer.)
  const _hpReviewsState = { hotelId: null, offset: 0, limit: 10, total: null, loading: false, observer: null };

  function _detailHotelIdFromPath() {
    const m = location.pathname.match(/^\/hotel\/([^\/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Build the URL for /hotel/:id while preserving useful search context
  // (city / q / hotel) so the page is shareable AND back-context survives reload.
  function _detailHrefFor(hotelId) {
    const params = new URLSearchParams();
    if (S.city)   params.set('city', S.city);
    if (S.q)      params.set('q',    S.q);
    const qs = params.toString();
    return `/hotel/${encodeURIComponent(hotelId)}${qs ? '?' + qs : ''}`;
  }

  // Public entry — called by Details button, hero image click, guest-score badge.
  // opts: { scrollTo?: 'reviews', _fromPopstate?: bool } (internal)
  async function openHotelDetailPage(hotelId, opts) {
    if (!hotelId) return;
    opts = opts || {};
    const scrollTo = opts.scrollTo;
    const fromPop  = !!opts._fromPopstate;

    // Telemetry — fire even if we're already on this hotel (scroll-intent
    // counts as engagement). Coarse properties only.
    try {
      track('hotel_detail_opened', {
        hotel_id:  String(hotelId),
        from_pop:  !!fromPop,
        scroll_to: scrollTo || null,
        city:      (S && S.city) || null,
      });
    } catch (_) {}

    // Already showing this hotel — just honor scroll intent.
    if (_detailHotelId === hotelId) {
      if (scrollTo === 'reviews') _hpScrollToReviews({ smooth: true });
      return;
    }

    // Capture return state on first transition into the page (not on popstate forward).
    if (!fromPop) {
      _detailReturnState = {
        results: document.body.classList.contains('has-results'),
        scrollY: window.scrollY || 0,
      };
    }

    _detailHotelId   = hotelId;
    _detailHotelData = null;
    _hpCarouselIdx   = 0;
    _hpLightboxIdx   = 0;

    const root = document.getElementById('st-hotel-detail');
    if (!root) return;

    // Toggle visibility purely via body class (CSS owns hide/show of other views).
    root.style.display = 'block';
    document.body.classList.add('has-hotel-detail');
    document.body.style.overflow = ''; // ensure not stuck locked from any prior modal

    // Render skeleton while we fetch.
    root.innerHTML = hotelDetailPageSkeletonHTML();
    window.scrollTo(0, 0);

    // Push URL only when not arriving via popstate (avoids history loop).
    if (!fromPop) {
      const href = _detailHrefFor(hotelId);
      try {
        history.pushState({ hotelDetail: hotelId }, '', href);
      } catch (_) {}
    }

    try {
      if (!_detailInflight.has(hotelId)) {
        _detailInflight.set(hotelId,
          fetch(`${BACKEND}/api/hotel/${encodeURIComponent(hotelId)}`)
            .then(r => r.json())
            .finally(() => _detailInflight.delete(hotelId))
        );
      }
      const data = await _detailInflight.get(hotelId);
      if (_detailHotelId !== hotelId) return; // user navigated away
      _detailHotelData = data;
      root.innerHTML = hotelDetailPageHTML(data);
      _attachHpReviewsObserver(hotelId);
      // Defer scroll to reviews until after layout settles.
      if (scrollTo === 'reviews') {
        requestAnimationFrame(() => _hpScrollToReviews({ smooth: false }));
      }
    } catch (e) {
      root.innerHTML = `<div class="hpage-error">
        <div class="hpage-error-msg">Couldn't load hotel details.</div>
        <button class="hp-close-btn" onclick="closeHotelDetailPage()">Back</button>
      </div>`;
    }
  }

  // Internal close — restores prior view + URL.
  // fromPop=true means popstate triggered the close (don't push history again).
  function closeHotelDetailPage(opts) {
    opts = opts || {};
    const fromPop = !!opts._fromPopstate;

    const root = document.getElementById('st-hotel-detail');
    if (!root || root.style.display === 'none') return;

    root.style.display = 'none';
    root.innerHTML = ''; // free memory
    document.body.classList.remove('has-hotel-detail');
    _detailHotelId   = null;
    _detailHotelData = null;

    // Tear down reviews observer so a fresh open re-arms it.
    if (_hpReviewsState.observer) {
      try { _hpReviewsState.observer.disconnect(); } catch (_) {}
      _hpReviewsState.observer = null;
    }
    _hpReviewsState.hotelId = null;
    _hpReviewsState.offset  = 0;
    _hpReviewsState.total   = null;
    _hpReviewsState.loading = false;

    // Restore prior view (the CSS rules tied to body.has-results / its absence
    // already drive #st-results vs. #discovery-flow visibility, so we just
    // restore scroll position).
    if (_detailReturnState && _detailReturnState.results) {
      const y = _detailReturnState.scrollY || 0;
      requestAnimationFrame(() => window.scrollTo(0, y));
    } else {
      // Fresh load to /hotel/:id (no prior results in memory) — go home cleanly.
      window.scrollTo(0, 0);
    }
    _detailReturnState = null;

    // Reset URL to root (or wherever we returned to).
    if (!fromPop) {
      try {
        history.pushState({}, '', '/');
      } catch (_) {}
    }
  }

  // Browser back/forward handler.
  window.addEventListener('popstate', e => {
    const onDetailUrl = !!_detailHotelIdFromPath();
    if (onDetailUrl) {
      // Forward into a hotel page (e.g. user pressed Forward).
      const id = _detailHotelIdFromPath();
      if (id && id !== _detailHotelId) openHotelDetailPage(id, { _fromPopstate: true });
    } else if (_detailHotelId) {
      // Back out of a hotel page.
      closeHotelDetailPage({ _fromPopstate: true });
    }
  });

  // ESC closes detail page (mirrors panel behavior; lightbox handles its own ESC).
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _detailHotelId) {
      const lb = document.getElementById('hp-lightbox');
      if (lb && lb.classList.contains('open')) return; // lightbox owns ESC first
      closeHotelDetailPage();
    }
  });

  // Direct deep-load: if the page loaded at /hotel/:id, jump straight to the
  // detail page (instead of the discovery flow).
  document.addEventListener('DOMContentLoaded', () => {
    const id = _detailHotelIdFromPath();
    if (id) openHotelDetailPage(id);
  });

  function hotelDetailPageSkeletonHTML() {
    return `
      <div class="hpage-topbar">
        <button class="hpage-back" onclick="closeHotelDetailPage()" aria-label="Back">‹ Back</button>
      </div>
      <div class="hpage-hero hp-skeleton"></div>
      <div class="hpage-grid">
        <div class="hpage-content">
          <div class="hp-meta">
            <div class="hp-skeleton" style="height:24px;width:60%;margin-bottom:8px;border-radius:6px"></div>
            <div class="hp-skeleton" style="height:14px;width:40%;border-radius:6px"></div>
          </div>
          <div class="hp-section">
            <div class="hp-skeleton" style="height:12px;width:30%;margin-bottom:10px;border-radius:4px"></div>
            <div class="hp-skeleton" style="height:60px;border-radius:8px"></div>
          </div>
          <div class="hp-section">
            <div class="hp-skeleton" style="height:12px;width:30%;margin-bottom:10px;border-radius:4px"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">${Array(6).fill('<div class="hp-skeleton" style="height:28px;width:80px;border-radius:100px"></div>').join('')}</div>
          </div>
        </div>
        <aside class="hpage-sidebar">
          <div class="hp-skeleton" style="height:120px;border-radius:12px"></div>
        </aside>
      </div>`;
  }

  function hotelDetailPageHTML(d) {
    const stars   = '★'.repeat(Math.min(Math.max(Math.round(d.star_rating || 0), 0), 5));

    // Build full photo list: hotel_photos first, then room photos to fill gaps
    const allPhotos = [...(d.hotel_photos || [])];
    for (const rt of (d.room_types || [])) {
      for (const url of (rt.photos || [])) {
        if (!allPhotos.includes(url)) allPhotos.push(url);
        if (allPhotos.length >= 30) break;
      }
      if (allPhotos.length >= 30) break;
    }
    const photoCount = allPhotos.length;

    // Photo carousel
    const carouselImgs = allPhotos.map((url, i) =>
      `<img class="hp-carousel-img${i === 0 ? ' active' : ''}" src="${escHtml(url)}" data-idx="${i}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}" onerror="this.closest('.hp-carousel-slide')?.remove();hpCarouselReindex()" onclick="openHpLightbox(${i})">`
    ).join('');
    const carouselHTML = photoCount > 0 ? `
      <div class="hp-carousel" id="hp-carousel">
        <div class="hp-carousel-track" id="hp-carousel-track">${carouselImgs}</div>
        ${photoCount > 1 ? `
        <button class="hp-carousel-btn hp-carousel-prev" onclick="hpCarouselStep(-1)" aria-label="Previous photo">‹</button>
        <button class="hp-carousel-btn hp-carousel-next" onclick="hpCarouselStep(1)" aria-label="Next photo">›</button>
        <div class="hp-carousel-dots" id="hp-carousel-dots">${allPhotos.map((_,i) => `<span class="hp-dot${i===0?' active':''}" onclick="hpCarouselGo(${i})"></span>`).join('')}</div>
        ` : ''}
      </div>` : `<div class="hp-hero-placeholder"></div>`;

    // Lightbox
    const lightboxHTML = photoCount > 0 ? `
      <div class="hp-lightbox" id="hp-lightbox" onclick="closeHpLightbox()">
        <button class="hp-lb-close" onclick="closeHpLightbox()">✕</button>
        <button class="hp-lb-prev" onclick="event.stopPropagation();hpLightboxStep(-1)">‹</button>
        <img class="hp-lb-img" id="hp-lb-img" src="" alt="">
        <button class="hp-lb-next" onclick="event.stopPropagation();hpLightboxStep(1)">›</button>
        <div class="hp-lb-counter" id="hp-lb-counter"></div>
      </div>` : '';

    const propChip = d.property_type === 'apartment_rental'
      ? `<span class="hp-proptype-chip">🏠 Apartment</span>`
      : d.property_type === 'hostel' ? `<span class="hp-proptype-chip">🛏 Hostel</span>` : '';
    const nbhdName = d.primary_nbhd?.name || '';
    const nbhdChip = nbhdName
      ? `<button class="hp-nbhd-chip" onclick="closeHotelDetailPage();goToStep('nbhd')" title="Explore this neighbourhood">📍 ${escHtml(nbhdName)}</button>` : '';
    const ratingBadge = d.guest_rating > 0
      ? `<button type="button" class="hp-rating hp-rating--btn" onclick="_hpScrollToReviews({smooth:true})" title="See guest reviews">${parseFloat(d.guest_rating).toFixed(1)}</button>`
      : '';
    const timesHTML = (d.check_in || d.check_out)
      ? `<div class="hp-times">${d.check_in ? `<span>Check-in <strong>${escHtml(d.check_in)}</strong></span>` : ''}${d.check_out ? `<span>Check-out <strong>${escHtml(d.check_out)}</strong></span>` : ''}</div>` : '';

    // Description
    const descHTML = d.description
      ? `<div class="hp-section">
          <div class="hp-section-title">About</div>
          <div class="hp-desc clamped" id="hp-desc-text">${escHtml(d.description)}</div>
          <button class="hp-desc-toggle" onclick="toggleHpDesc()">Read more</button>
         </div>` : '';

    // Amenities
    const amenList = Array.isArray(d.amenities) ? d.amenities : [];
    const amenFirst8 = amenList.slice(0, 8).map(a => `<span class="hp-amenity">${escHtml(a)}</span>`).join('');
    const amenRest   = amenList.slice(8);
    const amenDataAll = amenRest.length > 0 ? ` data-all='${escHtml(JSON.stringify(amenList))}'` : '';
    const amenHTML = amenList.length > 0
      ? `<div class="hp-section">
          <div class="hp-section-title">Amenities</div>
          <div class="hp-amenities" id="hp-amenities-wrap"${amenDataAll}>${amenFirst8}</div>
          ${amenRest.length > 0 ? `<button class="hp-amenities-more" onclick="toggleHpAmenities()">+ ${amenRest.length} more</button>` : ''}
         </div>` : '';

    // CTAs — primary "Find & Book" goes to LiteAPI (existing buildBookUrl); secondary "Vibe tour" reuses the existing per-hotel vibe tour modal/flow.
    const hotelIdAttr = escHtml(String(d.hotel_id));
    const bookUrl     = buildBookUrl({ id: d.hotel_id, name: d.name }, null);
    const ctaPrimary  = `<a class="hpage-cta hpage-cta--primary" href="${escHtml(bookUrl)}" target="_blank" rel="noopener">Find &amp; Book →</a>`;
    const ctaVibe     = `<button type="button" class="hpage-cta hpage-cta--secondary" onclick="openVibeTourForHotel('${hotelIdAttr}')">Vibe tour</button>`;

    // Sidebar (desktop) — duplicates name + key meta + CTAs in a sticky rail.
    const sidebarPriceLine = ''; // pricing comes from search-results state; not surfaced here yet.
    const sidebarHTML = `
      <aside class="hpage-sidebar">
        <div class="hpage-sidebar-card">
          <div class="hpage-sb-name">${escHtml(d.name || d.hotel_id)}</div>
          <div class="hpage-sb-sub">
            ${stars ? `<span class="hp-stars">${stars}</span>` : ''}
            ${ratingBadge}
          </div>
          ${nbhdChip ? `<div class="hpage-sb-row">${nbhdChip}</div>` : ''}
          ${propChip ? `<div class="hpage-sb-row">${propChip}</div>` : ''}
          ${timesHTML}
          ${sidebarPriceLine}
          <div class="hpage-sb-ctas">
            ${ctaPrimary}
            ${ctaVibe}
          </div>
          <div class="hpage-sb-share">
            <button type="button" class="hpage-share-btn" onclick="copyHotelDetailLink(this)" title="Copy shareable link">Copy link</button>
          </div>
        </div>
      </aside>`;

    // Mobile sticky bottom bar — primary Find&Book + secondary Vibe tour.
    const mobileCTAHTML = `
      <div class="hpage-mobile-cta" role="group" aria-label="Hotel actions">
        <a class="hpage-cta hpage-cta--primary hpage-cta--mobile" href="${escHtml(bookUrl)}" target="_blank" rel="noopener">Find &amp; Book →</a>
        <button type="button" class="hpage-cta hpage-cta--secondary hpage-cta--mobile hpage-cta--small" onclick="openVibeTourForHotel('${hotelIdAttr}')">Vibe tour</button>
      </div>`;

    return `
      ${lightboxHTML}
      <div class="hpage-topbar">
        <button class="hpage-back" onclick="closeHotelDetailPage()" aria-label="Back">‹ Back</button>
        <div class="hpage-topbar-spacer"></div>
      </div>
      <div class="hpage-hero">${carouselHTML}</div>
      <div class="hpage-grid">
        <div class="hpage-content">
          <div class="hp-meta">
            <h1 class="hp-name">${escHtml(d.name || d.hotel_id)}</h1>
            <div class="hp-sub">
              ${stars ? `<span class="hp-stars">${stars}</span>` : ''}
              ${ratingBadge}
              ${nbhdChip}
              ${propChip}
            </div>
            ${timesHTML}
          </div>
          ${descHTML}
          ${amenHTML}
          ${hotelDetailReviewsSectionHTML(d)}
        </div>
        ${sidebarHTML}
      </div>
      ${mobileCTAHTML}`;
  }

  // Copy current /hotel/:id URL to clipboard (sidebar Share).
  function copyHotelDetailLink(btn) {
    const url = location.origin + location.pathname + location.search;
    const done = (ok) => {
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = ok ? 'Link copied' : 'Press ⌘C';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
    } else {
      done(false);
    }
  }

  // ── Reviews (live-only, fetched from /api/hotel/:id/reviews) ───────────────
  // Lazy-loads when the section scrolls into view; "Show more" paginates +10.
  // Per LiteAPI ToS: never persist text to DB; never feed into embeddings/HyDE.
  function hotelDetailReviewsSectionHTML(d) {
    return `
      <div class="hp-section hp-reviews-section" id="hp-reviews-section" data-hotel-id="${escHtml(String(d.hotel_id))}">
        <div class="hp-section-title">Guest reviews</div>
        <div class="hp-reviews-body" id="hp-reviews-body">
          <div class="hp-reviews-placeholder">Loading reviews…</div>
        </div>
        <button type="button" class="hp-reviews-more" id="hp-reviews-more" style="display:none" onclick="loadMoreHpReviews()">Show more reviews</button>
        <div class="hp-reviews-attr">Reviews provided via <a href="https://liteapi.travel" target="_blank" rel="noopener">LiteAPI</a></div>
      </div>`;
  }

  function _attachHpReviewsObserver(hotelId) {
    if (_hpReviewsState.observer) {
      try { _hpReviewsState.observer.disconnect(); } catch (_) {}
      _hpReviewsState.observer = null;
    }
    _hpReviewsState.hotelId = hotelId;
    _hpReviewsState.offset  = 0;
    _hpReviewsState.total   = null;
    _hpReviewsState.loading = false;

    const section = document.getElementById('hp-reviews-section');
    if (!section) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Older browsers — just load immediately.
      loadHpReviews(hotelId);
      return;
    }
    const obs = new IntersectionObserver(entries => {
      for (const ent of entries) {
        if (ent.isIntersecting) {
          obs.disconnect();
          _hpReviewsState.observer = null;
          loadHpReviews(hotelId);
          break;
        }
      }
    }, { rootMargin: '200px 0px' });
    obs.observe(section);
    _hpReviewsState.observer = obs;
  }

  function _hpScrollToReviews(opts) {
    const section = document.getElementById('hp-reviews-section');
    if (!section) return;
    section.scrollIntoView({ behavior: opts && opts.smooth ? 'smooth' : 'auto', block: 'start' });
    // Force-load immediately if user explicitly jumped here (don't wait for IO).
    if (_hpReviewsState.hotelId && _hpReviewsState.offset === 0 && !_hpReviewsState.loading) {
      if (_hpReviewsState.observer) {
        try { _hpReviewsState.observer.disconnect(); } catch (_) {}
        _hpReviewsState.observer = null;
      }
      loadHpReviews(_hpReviewsState.hotelId);
    }
  }

  async function loadHpReviews(hotelId) {
    if (_hpReviewsState.loading) return;
    if (_hpReviewsState.hotelId !== hotelId) return;
    _hpReviewsState.loading = true;

    const body    = document.getElementById('hp-reviews-body');
    const moreBtn = document.getElementById('hp-reviews-more');
    if (!body) { _hpReviewsState.loading = false; return; }

    if (_hpReviewsState.offset === 0) {
      body.innerHTML = hpReviewsSkeletonHTML(3);
    } else if (moreBtn) {
      moreBtn.disabled    = true;
      moreBtn.textContent = 'Loading…';
    }

    try {
      const url = `${BACKEND}/api/hotel/${encodeURIComponent(hotelId)}/reviews?limit=${_hpReviewsState.limit}&offset=${_hpReviewsState.offset}`;
      const r   = await fetch(url, { credentials: 'same-origin' });
      if (_hpReviewsState.hotelId !== hotelId) return; // user navigated away
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data    = await r.json();
      const reviews = Array.isArray(data?.reviews) ? data.reviews : [];

      _hpReviewsState.total = (typeof data?.total === 'number') ? data.total : _hpReviewsState.total;

      if (_hpReviewsState.offset === 0 && reviews.length === 0) {
        body.innerHTML = `<div class="hp-reviews-empty">No reviews available yet for this property.</div>`;
        if (moreBtn) moreBtn.style.display = 'none';
      } else {
        const newHTML = reviews.map(hpReviewItemHTML).join('');
        let firstNewCard = null;
        if (_hpReviewsState.offset === 0) {
          body.innerHTML = newHTML;
          firstNewCard = body.firstElementChild;
        } else {
          const existingCount = body.querySelectorAll('.hp-review-card').length;
          body.insertAdjacentHTML('beforeend', newHTML);
          firstNewCard = body.querySelectorAll('.hp-review-card')[existingCount] || null;
        }
        // Reveal "Read more" only on cards whose body actually overflows the clamp.
        // Run on next frame so layout has settled (fonts may still be loading).
        requestAnimationFrame(() => _maybeShowHpReviewToggles(body));

        _hpReviewsState.offset += reviews.length;
        const hasMore = data?.has_more === true && reviews.length > 0;
        if (moreBtn) {
          moreBtn.disabled    = false;
          moreBtn.textContent = 'Show more reviews';
          moreBtn.style.display = hasMore ? 'block' : 'none';
        }
      }
    } catch (e) {
      if (_hpReviewsState.hotelId !== hotelId) return;
      if (_hpReviewsState.offset === 0) {
        body.innerHTML = `<div class="hp-reviews-error">Couldn't load reviews. <button class="hp-reviews-retry" onclick="loadHpReviews('${escHtml(String(hotelId))}')">Try again</button></div>`;
      } else if (moreBtn) {
        moreBtn.disabled    = false;
        moreBtn.textContent = 'Try again';
      }
    } finally {
      _hpReviewsState.loading = false;
    }
  }

  function loadMoreHpReviews() {
    if (!_hpReviewsState.hotelId) return;
    loadHpReviews(_hpReviewsState.hotelId);
  }

  function hpReviewsSkeletonHTML(n) {
    let html = '';
    for (let i = 0; i < n; i++) {
      html += `
        <div class="hp-review-card hp-review-card--sk">
          <div class="hp-review-row">
            <div class="hp-skeleton" style="width:42px;height:18px;border-radius:6px"></div>
            <div class="hp-skeleton" style="flex:1;height:14px;border-radius:6px"></div>
          </div>
          <div class="hp-skeleton" style="height:12px;width:80%;margin-top:10px;border-radius:6px"></div>
          <div class="hp-skeleton" style="height:12px;width:60%;margin-top:6px;border-radius:6px"></div>
        </div>`;
    }
    return html;
  }

  function hpReviewItemHTML(r) {
    const score    = (typeof r.score === 'number' && Number.isFinite(r.score)) ? r.score.toFixed(1) : null;
    const dateStr  = formatHpReviewDate(r.date);
    const headline = (r.headline || '').trim();
    const pros     = (r.pros || '').trim();
    const cons     = (r.cons || '').trim();
    const author   = (r.name || '').trim();
    const country  = (r.country || '').trim().toUpperCase();
    const source   = (r.source || '').trim();

    const meta = [author, country, dateStr].filter(Boolean).join(' · ');
    const headlineHtml = headline ? `<div class="hp-review-headline">${escHtml(headline)}</div>` : '';
    const prosHtml     = pros     ? `<div class="hp-review-line"><span class="hp-review-tag hp-review-tag--pros">+</span> ${escHtml(pros)}</div>` : '';
    const consHtml     = cons     ? `<div class="hp-review-line"><span class="hp-review-tag hp-review-tag--cons">−</span> ${escHtml(cons)}</div>` : '';
    const sourceHtml   = source   ? `<div class="hp-review-source">via ${escHtml(source)}</div>` : '';

    // Body is clamped to ~4 lines by default; toggle is shown only if content overflows
    // (measured after mount in _maybeShowHpReviewToggles).
    return `
      <div class="hp-review-card">
        <div class="hp-review-row">
          ${score ? `<span class="hp-review-score" aria-label="Score ${score} out of 10">${score}</span>` : ''}
          <span class="hp-review-meta">${escHtml(meta)}</span>
        </div>
        <div class="hp-review-content clamped">
          ${headlineHtml}
          ${prosHtml}
          ${consHtml}
        </div>
        <button type="button" class="hp-review-toggle" hidden onclick="toggleHpReviewExpand(this)">Read more</button>
        ${sourceHtml}
      </div>`;
  }

  // After review HTML is inserted into the DOM, measure each .hp-review-content
  // and reveal the "Read more" button only if the content actually overflows
  // its 4-line clamp. Cheap to run; called once per fetched batch.
  function _maybeShowHpReviewToggles(scope) {
    const root = scope || document.getElementById('hp-reviews-body');
    if (!root) return;
    const cards = root.querySelectorAll('.hp-review-card');
    cards.forEach(card => {
      const content = card.querySelector('.hp-review-content');
      const btn     = card.querySelector('.hp-review-toggle');
      if (!content || !btn) return;
      // Reset to clamped before measuring (in case user already expanded)
      const wasExpanded = !content.classList.contains('clamped');
      if (wasExpanded) content.classList.add('clamped');
      const overflows = content.scrollHeight - content.clientHeight > 1;
      if (overflows) {
        btn.hidden = false;
      } else {
        btn.hidden = true;
        btn.textContent = 'Read more';
      }
      if (wasExpanded) {
        // restore prior expanded state
        content.classList.remove('clamped');
        if (overflows) btn.textContent = 'Show less';
      }
    });
  }

  function toggleHpReviewExpand(btn) {
    const card = btn.closest('.hp-review-card');
    const content = card && card.querySelector('.hp-review-content');
    if (!content) return;
    const clamped = content.classList.toggle('clamped');
    btn.textContent = clamped ? 'Read more' : 'Show less';
  }

  function formatHpReviewDate(s) {
    if (!s) return '';
    const t = Date.parse(String(s).replace(' ', 'T') + 'Z');
    if (!Number.isFinite(t)) return String(s).slice(0, 10);
    const d = new Date(t);
    try {
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) {
      return String(s).slice(0, 10);
    }
  }

  function toggleHpDesc() {
    const el  = document.getElementById('hp-desc-text');
    const btn = el?.nextElementSibling;
    if (!el) return;
    const clamped = el.classList.toggle('clamped');
    if (btn) btn.textContent = clamped ? 'Read more' : 'Show less';
  }

  function toggleHpAmenities() {
    const wrap = document.getElementById('hp-amenities-wrap');
    const btn  = wrap?.nextElementSibling;
    if (!wrap || !btn) return;
    const allJson = wrap.dataset.all;
    if (allJson) {
      try {
        const all = JSON.parse(allJson);
        wrap.innerHTML = all.map(a => `<span class="hp-amenity">${escHtml(a)}</span>`).join('');
        btn.remove();
      } catch (_) {}
    }
  }

  // ── Hotel panel photo carousel ────────────────────────────────────────────

  function hpCarouselGo(idx) {
    const track = document.getElementById('hp-carousel-track');
    if (!track) return;
    const imgs = track.querySelectorAll('.hp-carousel-img');
    if (!imgs.length) return;
    _hpCarouselIdx = ((idx % imgs.length) + imgs.length) % imgs.length;
    imgs.forEach((img, i) => img.classList.toggle('active', i === _hpCarouselIdx));
    const dots = document.querySelectorAll('#hp-carousel-dots .hp-dot');
    dots.forEach((d, i) => d.classList.toggle('active', i === _hpCarouselIdx));
  }

  function hpCarouselStep(dir) { hpCarouselGo(_hpCarouselIdx + dir); }

  function hpCarouselReindex() {
    const track = document.getElementById('hp-carousel-track');
    if (!track) return;
    const imgs = track.querySelectorAll('.hp-carousel-img');
    imgs.forEach((img, i) => img.dataset.idx = i);
    if (_hpCarouselIdx >= imgs.length) hpCarouselGo(imgs.length - 1);
  }

  // Swipe support for carousel on mobile
  (function() {
    let swipeX = 0;
    document.addEventListener('touchstart', e => {
      const el = e.target.closest('#hp-carousel');
      if (el) swipeX = e.touches[0].clientX;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      const el = e.target.closest('#hp-carousel');
      if (!el) return;
      const dx = e.changedTouches[0].clientX - swipeX;
      if (Math.abs(dx) > 40) hpCarouselStep(dx < 0 ? 1 : -1);
    }, { passive: true });
  })();

  // ── Hotel panel lightbox ───────────────────────────────────────────────────

  function openHpLightbox(idx) {
    // Only open lightbox on desktop (non-touch)
    if (window.matchMedia('(hover: none)').matches) return;
    const track = document.getElementById('hp-carousel-track');
    if (!track) return;
    _hpLightboxUrls = Array.from(track.querySelectorAll('.hp-carousel-img')).map(img => img.src);
    if (!_hpLightboxUrls.length) return;
    const lb = document.getElementById('hp-lightbox');
    if (!lb) return;
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    hpLightboxGo(idx);
  }

  function closeHpLightbox() {
    const lb = document.getElementById('hp-lightbox');
    if (!lb) return;
    lb.classList.remove('open');
    // Only restore overflow if panel is also not needing it locked
    if (_detailHotelId) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
  }

  function hpLightboxGo(idx) {
    _hpLightboxIdx = ((idx % _hpLightboxUrls.length) + _hpLightboxUrls.length) % _hpLightboxUrls.length;
    const img = document.getElementById('hp-lb-img');
    const counter = document.getElementById('hp-lb-counter');
    if (img) img.src = _hpLightboxUrls[_hpLightboxIdx];
    if (counter) counter.textContent = `${_hpLightboxIdx + 1} / ${_hpLightboxUrls.length}`;
  }

  function hpLightboxStep(dir) { hpLightboxGo(_hpLightboxIdx + dir); }

  // Keyboard nav for lightbox
  document.addEventListener('keydown', e => {
    const lb = document.getElementById('hp-lightbox');
    if (!lb?.classList.contains('open')) return;
    if (e.key === 'ArrowRight') hpLightboxStep(1);
    else if (e.key === 'ArrowLeft') hpLightboxStep(-1);
    else if (e.key === 'Escape') closeHpLightbox();
  });

  // ── End Hotel Details Page ─────────────────────────────────────────────────

  function hotelHTML(h) {
    const stars    = '★'.repeat(Math.min(Math.max(Math.round(h.starRating || 0), 0), 5));
    const location = [h.address, h.city, h.country].filter(Boolean).join(', ');
    const rating   = h.rating > 0
      ? `<button type="button" class="hotel-guest-score" data-hotel-id="${escHtml(String(h.id))}" onclick="event.stopPropagation();openHotelDetailPage(this.dataset.hotelId, { scrollTo: 'reviews' })" title="See guest reviews"><strong>${parseFloat(h.rating).toFixed(1)}</strong> guest score</button>`
      : '';
    const bookUrl  = buildBookUrl(h, null);
    const clipBadge = h.clipScore > 0 ? `<span class="clip-score-badge">&#9889; ${h.clipScore}% photo match</span>` : '';
    const hotelIdAttr = escHtml(String(h.id));

    // BOOP v4 — three vibe % scores on every card:
    //   roomVibe = h.vectorScore        (set by score_room_types + HyDE room seed)
    //   hotelVibe = h.hotelScore        (set by score_hotels + hotel_query seed)
    //   nbhdVibe = same % as neighbourhood picker when cache hit (vibe_elements + prefs + 45–95 spread); else prefs × primary_nbhd.attributes
    const effectiveScore = hotelEffectiveScore(h);
    const roomVibe  = Math.round(effectiveScore || 0);
    const hotelVibe = Math.round(h.hotelScore || 0);
    // Prefer server nbhd % (same value used for ranking blend) when present.
    const nbhdVibe  = h.nbhd_fit_pct != null ? Math.round(h.nbhd_fit_pct) : computeNbhdVibe(h);
    const tripletHTML = buildVibeTriplet(roomVibe, hotelVibe, nbhdVibe);
    const matchBadgeWrap = `<span class="hotel-hero-badge-wrap hotel-hero-badge-triplet" id="hotel-badge-wrap-${h.id}">${tripletHTML}</span>`;

    // Neighbourhood pill — top-left of hero, click refocuses the results by nbhd.
    const nbhd     = h.primary_nbhd;
    const nbhdPill = nbhd?.name
      ? `<button class="hotel-nbhd-pill" type="button"
                 onclick="event.stopPropagation();goToStep('nbhd')"
                 title="${escHtml(nbhd.vibe_short || '')}">
           <span class="hotel-nbhd-pill-icon">📍</span>
           <span class="hotel-nbhd-pill-text"><span class="hotel-nbhd-pill-name">${escHtml(nbhd.name)}</span><span class="hotel-nbhd-pill-suffix hotel-nbhd-pill-suffix--full"> · neighborhood vibe · ${nbhdVibe}% match</span><span class="hotel-nbhd-pill-suffix hotel-nbhd-pill-suffix--short"> · vibe · ${nbhdVibe}% match</span></span>
         </button>`
      : '';

    // ── Room filtering (availability toggle) ────────────────────────────────
    const allRoomTypes = h.roomTypes || [];
    const isAvail  = rt => rt.roomTypeId != null && h.roomPrices?.[rt.roomTypeId] != null;
    const canFilter = _showAvailOnly && _hasDateSearch && _pricesLoaded;
    const availRoomTypes = allRoomTypes.filter(isAvail);
    const hasHotelAvail  = h.price != null;
    const roomTypes = canFilter
      ? (availRoomTypes.length > 0 ? availRoomTypes : (hasHotelAvail ? allRoomTypes : []))
      : allRoomTypes;
    const noAvailRooms = canFilter && roomTypes.length === 0;
    const isStub = allRoomTypes.length === 0;
    const noAvailNotice = noAvailRooms
      ? (isStub && hasHotelAvail
          ? `<div class="no-avail-notice">Available for your dates — room photos not in our visual index yet</div>`
          : `<div class="no-avail-notice">No rooms available for these dates — <button class="no-avail-link" onclick="setAvailFilter(false);document.getElementById('availOnlyCheck').checked=false">show all room types</button></div>`)
      : '';

    // ── Hotel hero: mainPhoto (large left) + up to 2 gallery/room photos (stacked right) ──
    const heroPhotos = [];
    if (h.mainPhoto) heroPhotos.push(h.mainPhoto);
    const galleryFill = (h.hotelPhotos && h.hotelPhotos.length > 0) ? h.hotelPhotos : [];
    for (const url of galleryFill) {
      if (!heroPhotos.includes(url)) heroPhotos.push(url);
      if (heroPhotos.length >= 3) break;
    }
    if (heroPhotos.length < 3) {
      for (const rt of (h.roomTypes || [])) {
        for (const photo of (rt.photos || [])) {
          if (!heroPhotos.includes(photo)) { heroPhotos.push(photo); break; }
        }
        if (heroPhotos.length >= 3) break;
      }
    }
    const heroCount = heroPhotos.length;
    const heroClass = heroCount <= 1 ? 'hero-1' : heroCount === 2 ? 'hero-2' : '';
    const heroImgs  = heroPhotos.map(url =>
      `<img class="hotel-hero-img" src="${url}" alt="" loading="lazy" onerror="this.classList.add('hotel-hero-blank');this.style.visibility='hidden'">`
    ).join('');
    // Hero is clickable → opens dedicated /hotel/:id page. Inner pills/badges stop propagation so they keep their own actions.
    const heroOnClick = `onclick="openHotelDetailPage('${hotelIdAttr}')" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openHotelDetailPage('${hotelIdAttr}');}"`;
    const heroInner = heroCount > 0
      ? `<div class="hotel-hero hotel-hero--clickable ${heroClass}" ${heroOnClick}>${heroImgs}</div>`
      : `<div class="hotel-hero hotel-hero--clickable hero-1" ${heroOnClick}><div class="hotel-hero-img hotel-hero-blank"></div></div>`;
    const heroStrip = `<div class="hotel-hero-wrap">${nbhdPill}${matchBadgeWrap}${heroInner}</div>`;

    // ── Price display ────────────────────────────────────────────────────────
    const priceDisplay = h.price != null
      ? `€${h.price.toLocaleString()}<span class="price-per">/night</span>`
      : _fetchingPrices
        ? `<span class="price-skeleton"></span>`
        : `--<span class="price-per">/night</span>`;
    const priceNote = h.price != null ? 'Lowest available'
      : _fetchingPrices ? 'Loading rates…'
      : _pricesLoaded   ? 'No rates found'
      :                   'Add dates for rates';

    return `
      <div class="hotel-card" id="hotel-card-${h.id}">
        ${heroStrip}
        <div class="hotel-header">
          <div class="hotel-header-left">
            <div class="hotel-name" id="hotel-name-${h.id}">${h.name}</div>
            <div class="hotel-meta" id="hotel-meta-${h.id}">
              ${stars ? `<span class="stars">${stars}</span>` : ''}
              ${location ? `<span class="hotel-location">${location}</span>` : ''}
              ${rating}${clipBadge}
              ${h.property_type === 'apartment_rental' ? '<span class="property-type-chip">🏠 Apartment</span>' : ''}
              ${h.property_type === 'hostel' ? '<span class="property-type-chip">🛏 Hostel</span>' : ''}
            </div>
          </div>
          <div class="hotel-header-right">
            <div class="hotel-actions">
              <div class="hotel-price">
                <span class="price-value" id="hotel-price-${h.id}">${priceDisplay}</span>
                <span class="price-note" id="hotel-price-note-${h.id}">${priceNote}</span>
              </div>
              <button type="button" class="hotel-tour-link" data-hotel-id="${hotelIdAttr}" onclick="openVibeTourForHotel(this.dataset.hotelId)">Vibe tour</button>
              <button type="button" class="hotel-details-btn" data-hotel-id="${hotelIdAttr}" onclick="openHotelDetailPage(this.dataset.hotelId)">Details</button>
              <a class="book-btn" href="${bookUrl}" target="_blank" rel="noopener">Find &amp; Book →</a>
            </div>
          </div>
        </div>
        <div id="hotel-rooms-${h.id}">
          ${roomsSectionHTML(roomTypes, h.vectorScore, h.roomPrices, _hasDateSearch, noAvailNotice, -1, h)}
        </div>
      </div>`;
  }

  function roomTypeHTML(rt, isTopMatch, hotelScore, hotelRoomPrices, hasDateSearch, variant = 'compact', isHidden = false, hotel = null) {
    const sizeHTML = rt.size ? `<span class="room-size">${rt.size}</span>` : '';
    const bedsHTML = rt.beds ? `<span class="room-beds">${rt.beds}</span>` : '';

    const hasPrice  = rt.roomTypeId != null && hotelRoomPrices?.[rt.roomTypeId] != null;
    const isUnavail = hasDateSearch && hotelRoomPrices != null && rt.roomTypeId != null && !hasPrice;
    const rid = rt.roomTypeId;
    const fcMap = hotel?.roomFreeCancel;
    const showFc = hasPrice && fcMap && (fcMap[rid] === true || fcMap[String(rid)] === true);
    const fcBadge = showFc ? '<span class="room-fc-badge">Free cancel</span>' : '';

    const photos  = rt.photos || [];
    const regKey  = _lbRegistry.length;
    _lbRegistry.push({ photos, name: rt.name, score: rt.score });

    const priceHTML = hasPrice
      ? `<span class="room-rate">€${hotelRoomPrices[rt.roomTypeId].toLocaleString()}<span class="room-rate-per">/night</span></span>${fcBadge}`
      : isUnavail
        ? `<span class="room-unavail-badge">not available</span>`
        : '';

    // Per-room Book button: show when there's a price (has offerId → direct checkout; else hotel page)
    const roomBookUrl = hasPrice && hotel ? buildBookUrl(hotel, rt.roomTypeId) : null;
    const roomBookHTML = roomBookUrl
      ? `<a class="book-btn book-btn--room" href="${roomBookUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Book →</a>`
      : '';

    // ── Featured variant (top match room — scrollable strip, same indices as lightbox) ──
    if (variant === 'featured') {
      const vibeOverlay = rt.score > 0
        ? `<span class="room-featured-vibe-badge">Room vibe - ${rt.score}% match</span>`
        : (isTopMatch && hotelScore === 0 && _currentSort === 'match'
            ? `<span class="room-featured-vibe-badge room-featured-vibe-badge--low">Room vibe - browse</span>` : '');

      const toShow = photos.length > 0 ? photos.slice(0, 10) : [null];
      const stripCells = toShow.map((url, pi) => {
        const heroCls = pi === 0 ? ' room-photo-cell--featured-hero' : '';
        const overlay = pi === 0 ? vibeOverlay : '';
        const lbClick = `event.stopPropagation(); openLightbox(${regKey}, ${pi})`;
        if (!url) {
          return `<div class="room-photo-cell${heroCls}">${overlay}<div class="no-photo">🛏</div></div>`;
        }
        return `<div class="room-photo-cell${heroCls}" onclick="${lbClick}">
          ${overlay}
          <img src="${url}" alt="${rt.name}" loading="lazy"
               onerror="this.parentElement.innerHTML='<div class=no-photo>🛏</div>'">
          <div class="zoom-hint">⤢</div>
        </div>`;
      }).join('');

      return `
        <div class="room-featured open" onclick="toggleFeatured(this)">
          <div class="room-featured-scroll-wrap">
            <button type="button" class="room-featured-nav room-featured-nav--prev" aria-label="Previous photos" onclick="event.stopPropagation();featuredStripNav(this,-1)">&#8249;</button>
            <div class="room-featured-scroll">
              <div class="room-featured-strip">${stripCells}</div>
            </div>
            <button type="button" class="room-featured-nav room-featured-nav--next" aria-label="Next photos" onclick="event.stopPropagation();featuredStripNav(this,1)">&#8250;</button>
          </div>
          <div class="room-featured-info">
            <div class="room-featured-name">${rt.name}${bedsHTML ? `<span class="room-meta-sep"> · </span>${bedsHTML}` : ''}${sizeHTML ? `<span class="room-meta-sep"> · </span>${sizeHTML}` : ''}</div>
            <div class="room-featured-meta">${priceHTML}${roomBookHTML}<span class="room-featured-collapse">▾ collapse</span></div>
          </div>
        </div>`;
    }

    // ── Compact variant (other rooms — collapsible with match bar) ────────────
    const matchBar = rt.score > 0
      ? `<div class="room-match-bar-wrap"><div class="room-match-bar-fill" style="width:${rt.score}%"></div></div>`
      : '';

    const scoreBadge = rt.score > 0
      ? `<span class="room-score-badge${rt.score < 20 ? ' room-score-badge--low' : ''}">${rt.score}%</span>`
      : '';

    const amenityHTML = rt.amenities?.length
      ? `<div class="amenity-tags">${rt.amenities.map(a => `<span class="amenity-tag">${a}</span>`).join('')}</div>`
      : '';

    const photoHTML = photos.length
      ? photos.slice(0, 10).map((url, pi) =>
          `<div class="room-photo-cell" onclick="openLightbox(${regKey}, ${pi})">
            <img src="${url}" alt="${rt.name}" loading="lazy"
                 onerror="this.parentElement.innerHTML='<div class=no-photo>🛏</div>'">
            <div class="zoom-hint">⤢</div>
          </div>`).join('')
      : `<div class="room-photo-cell"><div class="no-photo">🛏</div></div>`;

    const openClass   = isTopMatch ? ' open' : '';
    const unavailClass = isUnavail ? ' room-unavailable' : '';
    const hiddenClass  = isHidden  ? ' room-hidden' : '';

    return `
      <div class="room-type-row${openClass}${unavailClass}${hiddenClass}">
        <div class="room-type-header" onclick="toggleRoom(this.parentElement)">
          ${photos[0] ? `<img class="room-thumb" src="${photos[0]}" alt="${rt.name}" loading="lazy" onerror="this.style.display='none'">` : ''}
          <div class="room-type-left">
            <span class="room-type-name">${rt.name}</span>
            ${matchBar}
            ${scoreBadge}
            ${priceHTML}
          </div>
          <span class="chevron">▼</span>
        </div>
        <div class="photo-strip-wrap">
          <div class="photo-strip">${photoHTML}</div>
          ${amenityHTML}
        </div>
      </div>`;
  }

  function friendlyApiErrorMessage(raw) {
    const s = String(raw || '').trim();
    if (!s) return 'Please try again in a moment.';
    const low = s.toLowerCase();
    if (low.includes('beta_gate_required') || low === 'unauthorized') {
      return 'Your session expired. Refresh the page and enter the beta code again.';
    }
    if (low.includes('rate_limited')) {
      return 'You are tapping a little faster than our guardrails allow. Pause a few seconds and try again.';
    }
    if (/^search failed \(\d+\)$/i.test(s) || /^http \d+$/i.test(s)) {
      return 'We could not finish that search. Check your connection and try again.';
    }
    return s;
  }

  function renderEmpty(query, city) {
    exitResultsPendingMode();
    const resE = document.getElementById('results');
    if (resE) resE.classList.remove('no-anim');
    document.body.classList.add('has-results');
    document.getElementById('discovery-flow').style.display = 'none';
    document.getElementById('st-results').style.display     = 'block';
    document.getElementById('results').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">No matches yet</div>
        <div class="empty-sub">We couldn’t find rooms that fit “${escHtml(query)}” in ${escHtml(city)}.<br>Try simpler words, a nearby area, or another city.</div>
      </div>`;
  }

  function renderError(msg) {
    exitResultsPendingMode();
    const resEr = document.getElementById('results');
    if (resEr) resEr.classList.remove('no-anim');
    document.body.classList.add('has-results');
    document.getElementById('discovery-flow').style.display = 'none';
    document.getElementById('st-results').style.display     = 'block';
    const detail = escHtml(friendlyApiErrorMessage(msg));
    document.getElementById('results').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Something went wrong</div>
        <div class="empty-sub">${detail}</div>
      </div>`;
  }

  // ── City autocomplete ──────────────────────────────────────────────────────
  let cityTimer = null;
  let activeIdx = -1;

  async function onCityInput(val) {
    /* GEO_AUTOCOMPLETE PAUSED — homepage chip conflict; remove this line + closing comment to restore */
    return;
    /*
    clearTimeout(cityTimer);
    const dd = document.getElementById('cityDropdown');
    if (val.length < 2) {
      dd.classList.remove('visible');
      dd.innerHTML = '';
      showRecentDropdown({
        inputId: 'cityInput',
        dropdownId: 'cityHistoryDropdown',
        storageKey: CITY_HISTORY_KEY,
        selectFn: 'selectRecentCity',
        emptyText: 'Recent cities will appear here',
        icon: '🕘',
        label: 'Recent'
      });
      return;
    }

    hideRecentDropdown('cityHistoryDropdown');

    dd.innerHTML = '<div class="city-loading">Searching…</div>';
    dd.classList.add('visible');
    activeIdx = -1;

    cityTimer = setTimeout(async () => {
      try {
        const resp = await fetch(`${BACKEND}/api/places?q=${encodeURIComponent(val)}`);
        if (!resp.ok) return;
        const data = await resp.json();
        const places = data.places || [];
        if (!places.length) {
          dd.innerHTML = '<div class="city-loading">No cities found</div>';
          return;
        }
        dd.innerHTML = places.map((p, i) => {
          const label    = p.name;
          const subParts = [p.state, p.country].filter(Boolean);
          const sub      = subParts.join(', ');
          const safe = JSON.stringify(p).replace(/'/g, "&#39;");
          return `
            <div class="city-option" data-name="${label}" data-idx="${i}"
                 onmousedown="selectCity(${safe})">
              <span class="city-option-icon">📍</span>
              <span>${label}</span>
              ${sub ? `<span class="city-option-sub">${sub}</span>` : ''}
            </div>`;
        }).join('');
      } catch {
        dd.classList.remove('visible');
      }
    }, 250);
    */
  }

  // cityData: {name, country_code, lat, lng} from autocomplete, or plain string from history/keyboard
  // ── Top world cities shown as default chips ──────────────────────────────
  const TOP_CITIES = [
    {name:'Paris',         flag:'🇫🇷'},
    {name:'London',        flag:'🇬🇧'},
    {name:'New York',      flag:'🇺🇸'},
    {name:'Tokyo',         flag:'🇯🇵'},
    {name:'Dubai',         flag:'🇦🇪'},
    {name:'Singapore',     flag:'🇸🇬'},
    {name:'Kuala Lumpur',  flag:'🇲🇾'},
    {name:'Barcelona',     flag:'🇪🇸'},
  ];

  // Cap at 5 total so the chip row stays on a single line (see .city-chips
  // CSS: flex-wrap:nowrap + overflow:hidden). Recents come first, then top
  // cities fill any remaining slots.
  function buildCityChips() {
    const MAX_CHIPS = 5;
    const container = document.getElementById('city-chips');
    if (!container) return;
    // Recents must include cities that are also in TOP_CITIES (e.g. Kuala Lumpur
    // is both — old code filtered those out, then TOP_CITIES.slice(0, remaining)
    // only ever took Paris…Dubai, so KL never appeared on the home row).
    const recent = readHistory(CITY_HISTORY_KEY);
    const html = [];
    const shown = new Set();
    const recentCount = Math.min(recent.length, 2, MAX_CHIPS);
    recent.slice(0, recentCount).forEach(r => {
      shown.add(r.trim().toLowerCase());
      html.push(`<div class="city-chip city-chip-recent" onclick="selectCity({name:'${r.replace(/'/g,"\\'")}'})" title="Recent">🕐 ${r}</div>`);
    });
    const remaining = Math.max(0, MAX_CHIPS - html.length);
    TOP_CITIES.filter(c => !shown.has(c.name.toLowerCase())).slice(0, remaining).forEach(c => {
      html.push(`<div class="city-chip" onclick="selectCity({name:'${c.name}'})">${c.flag} ${c.name}</div>`);
    });
    container.innerHTML = html.join('');
  }

  function onCityGo() {
    const val = (document.getElementById('cityInput').value || '').trim();
    if (val) selectCity({ name: val });
  }

  function selectCity(cityData) {
    const name = typeof cityData === 'string' ? cityData : (cityData?.name || cityData);
    document.getElementById('cityDropdown').classList.remove('visible');
    hideRecentDropdown('cityHistoryDropdown');
    selectedCityData = typeof cityData === 'object' ? cityData : { name };
    pickCity(name);
  }

  function selectRecentCityNew(value) {
    hideRecentDropdown('cityHistoryDropdown');
    document.getElementById('cityDropdown').classList.remove('visible');
    selectCity({ name: value });
  }

  function onCityKeydown(e) {
    const dd   = document.getElementById('cityDropdown');
    const opts = dd.querySelectorAll('.city-option');
    if (e.key === 'Enter') {
      if (activeIdx >= 0 && opts[activeIdx]) {
        e.preventDefault();
        selectCity({ name: opts[activeIdx].dataset.name });
      } else if (e.target.value.trim()) {
        e.preventDefault();
        selectCity({ name: e.target.value.trim() });
      }
    } else if (e.key === 'ArrowDown' && opts.length) {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, opts.length - 1);
      opts.forEach((o, i) => o.classList.toggle('active', i === activeIdx));
    } else if (e.key === 'ArrowUp' && opts.length) {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      opts.forEach((o, i) => o.classList.toggle('active', i === activeIdx));
    } else if (e.key === 'Escape') {
      dd.classList.remove('visible');
    }
  }

  function hideCitySuggestions() {
    setTimeout(() => {
      document.getElementById('cityDropdown').classList.remove('visible');
      hideRecentDropdown('cityHistoryDropdown');
    }, 150);
  }

  function clearCitySelection() {
    const el = document.getElementById('cityInput');
    if (el) {
      el.value = DEFAULT_HOME_CITY;
      el.focus();
    }
    S.city = normalizeCityName(DEFAULT_HOME_CITY);
    selectedCityData = null;
    hideNeighborhoodSection();
    clearNeighborhood();
  }

  function showNeighborhoodSection() {
    const city = document.getElementById('cityInput').value.trim();
    if (!city) return;
    document.getElementById('nbhd-step-city').textContent = city;
    document.getElementById('neighborhood-section').classList.add('visible');
    document.getElementById('neighborhood-section').setAttribute('aria-hidden', 'false');
  }

  function hideNeighborhoodSection() {
    document.getElementById('neighborhood-section').classList.remove('visible');
    document.getElementById('neighborhood-section').setAttribute('aria-hidden', 'true');
  }

  async function fetchAndShowNeighborhoods(city) {
    const section = document.getElementById('neighborhood-section');
    const grid = document.getElementById('nbhdGrid');
    document.getElementById('nbhd-step-city').textContent = city;

    // Show skeleton
    grid.innerHTML = renderNeighborhoodSkeletons(6);
    section.classList.add('visible');
    section.setAttribute('aria-hidden', 'false');

    try {
      const resp = await fetch(`${BACKEND}/api/neighborhoods?city=${encodeURIComponent(city)}`);
      if (!resp.ok) {
        // City not indexed or error — hide neighborhood section, proceed to search directly
        hideNeighborhoodSection();
        return;
      }
      const data = await resp.json();

      // 202 = still generating — poll once more after 3s
      if (resp.status === 202 || data.status === 'generating') {
        grid.innerHTML = renderNeighborhoodSkeletons(6);
        setTimeout(() => fetchAndShowNeighborhoods(city), 3000);
        return;
      }

      const hoods = (data.neighborhoods || []).sort((a, b) => {
        const bv = h => Object.values(h.vibe_elements || {})[0]?.metrics?.boop_vibe || 0;
        return bv(b) - bv(a);
      });
      if (!hoods.length) {
        hideNeighborhoodSection();
        return;
      }

      NEIGHBORHOOD_FLOW_ROWS = hoods;
      grid.innerHTML = hoods.map((h, i) => renderNeighborhoodCard(h, i)).join('') + renderExploreAllCard(city);
    } catch {
      hideNeighborhoodSection();
    }
  }

  function renderNeighborhoodSkeletons(n) {
    return Array.from({ length: n }, () => `
      <div class="nbhd-skeleton">
        <div class="skel-photo"></div>
        <div class="skel-body">
          <div class="skel-line" style="height:14px;width:55%"></div>
          <div class="skel-line" style="height:11px;width:80%"></div>
          <div class="skel-line" style="height:11px;width:65%"></div>
          <div class="skel-line" style="height:10px;width:40%;margin-top:4px"></div>
        </div>
      </div>`).join('');
  }

  function renderNeighborhoodCard(hood, idx) {
    const esc = s => (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const bboxStr = hood.bbox
      ? `${hood.bbox.lat_min},${hood.bbox.lat_max},${hood.bbox.lon_min},${hood.bbox.lon_max}`
      : '';
    const tags = (hood.tags || []).slice(0, 4).map(t =>
      `<span class="nbhd-card-tag">${esc(t)}</span>`).join('');
    const count = hood.hotel_count > 0 ? `${hood.hotel_count} hotels` : '—';
    const visitorLabel = hood.visitor_type === 'first-timer' ? 'First visit'
      : hood.visitor_type === 'returning' ? 'Off the beaten path' : '';
    const creditInner = formatNbhdHeroCreditHtml(hood.photo_credit);
    const credit = creditInner ? `<div class="nbhd-card-credit">${creditInner}</div>` : '';

    return `<div class="nbhd-card">
      ${hood.photo_url
        ? `<img class="nbhd-card-photo" src="${esc(hood.photo_url)}" alt="${esc(hood.name)}" loading="lazy">`
        : `<div class="nbhd-card-photo-placeholder"></div>`}
      ${credit}
      <div class="nbhd-card-body">
        <div class="nbhd-card-name">${esc(hood.name)}</div>
        <div class="nbhd-card-vibe">${esc(hood.vibe_short || '')}</div>
        <div class="nbhd-card-tags">${tags}</div>
        <div class="nbhd-card-footer">
          <span class="nbhd-card-count">${count}</span>
          ${visitorLabel ? `<span class="nbhd-card-visitor">${visitorLabel}</span>` : ''}
          <button type="button" class="nbhd-pick-btn-new" onclick="selectNeighborhoodFlow(${idx})">Choose →</button>
        </div>
      </div>
    </div>`;
  }

  function renderExploreAllCard(city) {
    return `<div class="nbhd-card nbhd-card-all" onclick="selectNeighborhood(null, null)">
      <div class="nbhd-card-all-label">
        <span class="nbhd-card-all-icon">🌍</span>
        Explore all of ${city}
      </div>
    </div>`;
  }

  function selectNeighborhoodFlow(idx) {
    const hood = NEIGHBORHOOD_FLOW_ROWS[idx];
    if (!hood) return;
    const bboxStr = hood.bbox
      ? `${hood.bbox.lat_min},${hood.bbox.lat_max},${hood.bbox.lon_min},${hood.bbox.lon_max}`
      : '';
    selectNeighborhood(hood.name, bboxStr, hood.polygon || null);
  }

  function selectNeighborhood(name, bbox, polygon) {
    selectedNeighborhood = name ? { name, bbox, polygon: polygon || null } : null;
    S.nbhd    = name || null;
    S.nbhdBbox = bbox || null;
    hideNeighborhoodSection();

    const chip = document.getElementById('neighborhood-chip');
    if (name) {
      document.getElementById('nbhd-chip-name').textContent = name;
      chip.style.display = 'flex';
    } else {
      chip.style.display = 'none';
    }

    // Focus query input ready to search
    setTimeout(() => document.getElementById('queryInput').focus(), 100);

    // Load vibe presets for this city
    const city = document.getElementById('cityInput').value.trim();
    loadVibePresets(city);
  }

  function clearNeighborhood() {
    selectedNeighborhood = null;
    document.getElementById('neighborhood-chip').style.display = 'none';
    document.getElementById('vibe-row').style.display = 'none';
  }

  async function loadVibePresets(city) {
    if (!city) return;
    const row = document.getElementById('vibe-row');
    const scroll = document.getElementById('vibeScroll');

    // Show skeletons while loading
    scroll.innerHTML = Array.from({ length: 6 }, () => `<div class="vibe-skel-card"></div>`).join('');
    row.style.display = 'block';

    try {
      const resp = await fetch(`${BACKEND}/api/vibe-presets?city=${encodeURIComponent(city)}`);
      if (!resp.ok) { row.style.display = 'none'; return; }
      const data = await resp.json();
      const presets = data.presets || [];
      if (!presets.length) { row.style.display = 'none'; return; }

      scroll.innerHTML = presets.map(p => `
        <div class="vibe-preset-card" onclick="selectVibe(${JSON.stringify(p).replace(/"/g,'&quot;')})" title="${(p.style_label||'').replace(/"/g,'&quot;')}">
          <img src="${(p.photo_url||'').replace(/"/g,'&quot;')}" alt="${(p.style_label||'').replace(/"/g,'&quot;')}" loading="lazy">
          <div class="vibe-preset-label">${p.style_label || ''}</div>
        </div>`).join('');
    } catch { row.style.display = 'none'; }
  }

  function selectVibe(preset) {
    S.style = preset.style_label || preset.query_used;
    S.q     = preset.caption || preset.query_used;
    startSearch();
  }


  document.addEventListener('click', (ev) => {
    const w = document.getElementById('sortMoreWrap');
    if (!w || !w.classList.contains('is-open')) return;
    if (!w.contains(ev.target)) closeSortMorePop();
  });
  document.addEventListener('click', (ev) => {
    if (!_nbhdRefineDropdownOpen) return;
    const wrap = document.querySelector('.nbhd-refine-more-wrap');
    if (!wrap) return;
    if (!wrap.contains(ev.target)) closeNbhdRefineDropdown();
  });
  document.addEventListener('click', (ev) => {
    const ids = cityDateIds();
    const picker = document.getElementById(ids.wrapper);
    const pop = document.getElementById(ids.pop);
    if (!picker || !pop || !pop.classList.contains('open')) return;
    const path = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
    if (!picker.contains(ev.target) && !path.includes(picker) && !path.includes(pop)) {
      closeCityDateRangePicker();
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeSortMorePop();
    if (ev.key === 'Escape') closeCityDateRangePicker();
    if (ev.key === 'Escape') closeNbhdRefineDropdown();
  });
  window.addEventListener('resize', () => {
    const pop = document.getElementById(cityDateIds().pop);
    if (pop && pop.classList.contains('open')) updateCityDatePopoverPosition();
  });

  // Keyboard nav on city input
  document.addEventListener('DOMContentLoaded', () => {
    // Restore persisted view mode
    const vCards = document.getElementById('viewBtnCards');
    const vRows  = document.getElementById('viewBtnRows');
    if (vCards) vCards.classList.toggle('active', _viewMode === 'cards');
    if (vRows)  vRows.classList.toggle('active',  _viewMode === 'rows');

    // Init date inputs with sensible defaults
    _initFlowDates();
    syncCityDateRangeUI();

    // Build city quick-pick chips (top cities + recent)
    buildCityChips();

    // City input: keyboard nav + history dropdown
    const cityInput = document.getElementById('cityInput');
    if (!cityInput) return;
    if (!cityInput.value.trim()) cityInput.value = DEFAULT_HOME_CITY;
    S.city = normalizeCityName(cityInput.value.trim()) || DEFAULT_HOME_CITY;

    /* Recent popover on focus + duplicate arrow-key nav — paused with Geo autocomplete (use onCityKeydown on input)
    cityInput.addEventListener('focus', () => {
      if (cityInput.value.trim().length < 2) {
        showRecentDropdown({
          inputId: 'cityInput',
          dropdownId: 'cityHistoryDropdown',
          storageKey: CITY_HISTORY_KEY,
          selectFn: 'selectRecentCity',
          emptyText: 'Recent cities will appear here',
          icon: '🕘',
          label: 'Recent'
        });
      }
    });

    cityInput.addEventListener('keydown', e => {
      const dd   = document.getElementById('cityDropdown');
      const opts = dd.querySelectorAll('.city-option');
      if (!opts.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = Math.min(activeIdx + 1, opts.length - 1);
        opts.forEach((o, i) => o.classList.toggle('active', i === activeIdx));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        opts.forEach((o, i) => o.classList.toggle('active', i === activeIdx));
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        selectCity({ name: opts[activeIdx].dataset.name });
      } else if (e.key === 'Escape') {
        dd.classList.remove('visible');
      }
    });
    */

    // Focus city input on load
    setTimeout(() => cityInput.focus(), 100);
  });

  // ── Lightbox ──────────────────────────────────────────────────────────────
  const _lbRegistry = [];  // [{photos:[url,...], name:string}] populated per render
  let _lbKey = -1, _lbIdx = 0;

  function openLightbox(regKey, idx) {
    const entry = _lbRegistry[regKey];
    if (!entry || !entry.photos.length) return;
    _lbKey = regKey;
    _lbIdx = idx;
    // Build thumbnail strip
    const thumbsEl = document.getElementById('lb-thumbs');
    thumbsEl.innerHTML = entry.photos.map((url, i) =>
      `<img class="lb-thumb${i === idx ? ' active' : ''}" src="${url}" onclick="lbGoTo(${i})" alt="">`
    ).join('');
    _lbUpdate();
    document.getElementById('lightbox').classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function lbGoTo(idx) {
    _lbIdx = idx;
    _lbUpdate();
  }

  function closeLightbox() {
    document.getElementById('lightbox').classList.remove('active');
    document.body.style.overflow = '';
  }

  function lbNav(dir) {
    const entry = _lbRegistry[_lbKey];
    if (!entry) return;
    _lbIdx = (_lbIdx + dir + entry.photos.length) % entry.photos.length;
    _lbUpdate();
  }

  function _lbUpdate() {
    const entry = _lbRegistry[_lbKey];
    if (!entry) return;
    document.getElementById('lb-img').src = entry.photos[_lbIdx];
    document.getElementById('lb-room-name').textContent = entry.name;
    const badge = document.getElementById('lb-match-badge');
    if (entry.score !== null && entry.score > 0) {
      badge.textContent = `${entry.score}% match`;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
    document.getElementById('lb-counter').textContent = `${_lbIdx + 1} / ${entry.photos.length}`;
    document.querySelectorAll('.lb-thumb').forEach((t, i) => {
      t.classList.toggle('active', i === _lbIdx);
      if (i === _lbIdx) t.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  }

  document.addEventListener('keydown', e => {
    if (!document.getElementById('lightbox').classList.contains('active')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); lbNav(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); lbNav(-1); }
    else if (e.key === 'Escape') closeLightbox();
  });

  document.addEventListener('DOMContentLoaded', () => {
    const lbWrap = document.querySelector('.lb-img-wrap');
    if (!lbWrap) return;
    let t0x = 0, t0y = 0, tracking = false;
    const threshold = 48;
    lbWrap.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) return;
      tracking = true;
      t0x = e.touches[0].clientX;
      t0y = e.touches[0].clientY;
    }, { passive: true });
    lbWrap.addEventListener('touchmove', e => {
      if (!tracking || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - t0x;
      const dy = e.touches[0].clientY - t0y;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 12) e.preventDefault();
    }, { passive: false });
    lbWrap.addEventListener('touchend', e => {
      if (!tracking) return;
      tracking = false;
      const lb = document.getElementById('lightbox');
      if (!lb || !lb.classList.contains('active')) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - t0x;
      const dy = t.clientY - t0y;
      if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) lbNav(1);
      else lbNav(-1);
    }, { passive: true });
  });

  // Prevent the browser from restoring mid-page scroll on the landing page.
  // This keeps a fresh homepage load pinned to the very top.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.addEventListener('pageshow', () => {
    if (!document.body.classList.contains('has-results') && !location.hash) {
      window.scrollTo(0, 0);
    }
  });


/* === Block 2: client config fetch (was second inline <script> at end of body) === */

  // Fetch client config from server (WL domain, etc.) non-blocking.
  // WL_BASE_URL is consumed by buildBookUrl() — it reads window._WL_BASE_URL.
  (async () => {
    try {
      const cfg = await fetch(`${BACKEND}/api/config`).then(r => r.json());
      if (cfg.wl_base_url) window._WL_BASE_URL = cfg.wl_base_url;
    } catch (_) {}
  })();


/* ──────────────────────────────────────────────────────────────────────────
 * Block 3: Beta launch — banner, feedback FAB/modal, consent modal, and
 * instrumentation init (PostHog identify + global error listeners).
 * Functions are declared on the global scope so inline onclick="…" works.
 * ────────────────────────────────────────────────────────────────────────── */

  // ── Beta banner (sticky top, dismissible, persists per-browser) ─────────────
  const _BETA_BANNER_DISMISS_KEY = 'TB_BETA_BANNER_DISMISSED';
  function initBetaBanner() {
    const el = document.getElementById('beta-banner');
    if (!el) return;
    const text = (window._BETA_BANNER || '').trim();
    const looksLikePlaceholder = !text || /^__/.test(text);
    if (looksLikePlaceholder) { el.hidden = true; return; }
    let dismissed = '';
    try { dismissed = localStorage.getItem(_BETA_BANNER_DISMISS_KEY) || ''; } catch (_) {}
    if (dismissed === text) { el.hidden = true; return; }
    const t = document.getElementById('beta-banner-text');
    if (t) t.textContent = text;
    el.hidden = false;
    document.body.classList.add('has-beta-banner');
  }
  function dismissBetaBanner() {
    const el = document.getElementById('beta-banner');
    if (!el) return;
    el.hidden = true;
    document.body.classList.remove('has-beta-banner');
    try { localStorage.setItem(_BETA_BANNER_DISMISS_KEY, (window._BETA_BANNER || '').trim()); } catch (_) {}
    track('beta_banner_dismissed', {});
  }

  // ── Beta feedback modal ─────────────────────────────────────────────────────
  let _betaSentiment = null;
  function openBetaFeedback() {
    const m = document.getElementById('beta-feedback-modal');
    if (!m) return;
    track('feedback_button_clicked', {});
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const ta = document.getElementById('bf-message');
      if (ta) ta.focus();
    }, 50);
  }
  function closeBetaFeedback() {
    const m = document.getElementById('beta-feedback-modal');
    if (!m) return;
    m.hidden = true;
    document.body.style.overflow = '';
    _betaSentiment = null;
    document.querySelectorAll('.beta-sent-btn').forEach(b => b.classList.remove('active'));
    const status = document.getElementById('bf-status');
    if (status) status.textContent = '';
  }
  function setBetaSentiment(n) {
    _betaSentiment = Number(n);
    document.querySelectorAll('.beta-sent-btn').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.sent) === _betaSentiment);
    });
  }
  async function submitBetaFeedback() {
    const ta    = document.getElementById('bf-message');
    const email = document.getElementById('bf-email');
    const btn   = document.getElementById('bf-submit');
    const status = document.getElementById('bf-status');
    const message = (ta?.value || '').trim();
    if (!message) {
      if (status) status.textContent = 'Please add a short message before sending.';
      ta?.focus();
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    if (status) status.textContent = '';
    try {
      const r = await fetch(`${BACKEND}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message,
          email: (email?.value || '').trim() || null,
          sentiment: _betaSentiment,
          distinctId: _TB_DISTINCT_ID,
          currentUrl: location.pathname, // strip query/hash
          currentSearch: (typeof S !== 'undefined' && (S.q || S.query)) || null,
        }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      track('feedback_submitted', { sentiment: _betaSentiment, message_length: message.length, has_email: !!(email?.value || '').trim() });
      if (status) status.textContent = 'Thanks — we read every message.';
      if (ta) ta.value = '';
      if (email) email.value = '';
      setTimeout(closeBetaFeedback, 1200);
    } catch (e) {
      if (status) status.textContent = 'Could not send right now — please try again in a minute.';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send feedback →'; }
    }
  }

  // ── Beta consent modal (one-time per browser) ───────────────────────────────
  const _BETA_CONSENT_KEY = 'TB_BETA_CONSENT_V1';
  function maybeShowBetaConsent() {
    let accepted = '';
    try { accepted = localStorage.getItem(_BETA_CONSENT_KEY) || ''; } catch (_) {}
    if (accepted) return;
    const m = document.getElementById('beta-consent-modal');
    if (!m) return;
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    track('beta_consent_shown', {});
  }
  function acceptBetaConsent() {
    const m = document.getElementById('beta-consent-modal');
    if (m) m.hidden = true;
    document.body.style.overflow = '';
    try { localStorage.setItem(_BETA_CONSENT_KEY, 'v1-' + Date.now()); } catch (_) {}
    track('beta_consent_accepted', {});
    fetch(`${BACKEND}/api/beta-consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ distinctId: _TB_DISTINCT_ID, policyVersion: 'v1-2026-05-07' }),
    }).catch(() => {});
  }

  // ── Instrumentation init ────────────────────────────────────────────────────
  // Identifies the persistent distinct_id with PostHog and adds a window error
  // listener so unhandled exceptions surface in Sentry + a coarse PostHog event.
  function initBetaInstrumentation() {
    try {
      if (window.posthog && typeof window.posthog.identify === 'function') {
        window.posthog.identify(_TB_DISTINCT_ID, { release: window._RELEASE || undefined, env: window._ENV || undefined });
      }
    } catch (_) {}
    window.addEventListener('error', (e) => {
      try {
        track('error_shown', {
          message: String(e.message || '').slice(0, 200),
          source:  String(e.filename || '').slice(0, 200).split('?')[0],
          line:    e.lineno || null,
        });
      } catch (_) {}
    });
    window.addEventListener('unhandledrejection', (e) => {
      try {
        const reason = (e.reason && (e.reason.message || String(e.reason))) || '';
        track('unhandled_promise_rejection', { message: String(reason).slice(0, 200) });
      } catch (_) {}
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initBetaInstrumentation();
    initBetaBanner();
    // Reveal the feedback FAB once the app is up.
    const fab = document.getElementById('beta-feedback-fab');
    if (fab) fab.hidden = false;
    // Consent shown after the first paint so it doesn't compete with a slow
    // Sentry/PostHog network call.
    setTimeout(maybeShowBetaConsent, 600);

    // Auto-open the in-app legal overlay if the URL says so. Lets us share
    // /?legal=privacy or /?legal=terms while still preserving the standalone
    // /privacy and /terms server-rendered pages for indexing/sharing.
    try {
      const sp = new URLSearchParams(location.search);
      const legal = (sp.get('legal') || '').toLowerCase();
      if (legal === 'privacy' || legal === 'terms') {
        setTimeout(() => { try { openStaticPage(legal); } catch (_) {} }, 200);
      }
    } catch (_) {}

    // Telemetry: emit a single beta_gate_passed (we know we got past the gate
    // because the SPA loaded). Distinct from beta_consent_accepted.
    track('beta_gate_passed', { path: location.pathname });
  });
