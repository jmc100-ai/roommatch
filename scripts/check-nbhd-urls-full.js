#!/usr/bin/env node
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function head(url) {
  try {
    const r = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TravelBoop/1.0)',
        Accept: 'image/*',
      },
    });
    return { status: r.status, ct: r.headers.get('content-type') };
  } catch (e) {
    return { status: `err`, ct: e.message };
  }
}

function host(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return '?';
  }
}

function stripUtm(u) {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) {
      if (k.startsWith('utm_')) x.searchParams.delete(k);
    }
    return x.toString();
  } catch {
    return u;
  }
}

(async () => {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data } = await db
    .from('neighborhoods')
    .select('city,name,photo_url,vibe_photos')
    .in('city', ['Paris', 'Mexico City']);

  const stats = {};
  const bad = [];
  const urls = new Set();

  for (const n of data || []) {
    const list = [n.photo_url];
    for (const arr of Object.values(n.vibe_photos || {})) {
      for (const p of arr || []) list.push(typeof p === 'string' ? p : p?.url);
    }
    for (const raw of list) {
      if (!raw || urls.has(raw)) continue;
      urls.add(raw);
      const u = stripUtm(raw);
      const h = host(u);
      stats[h] = stats[h] || { ok: 0, bad: 0 };
      const r = await head(u);
      if (r.status === 200 && r.ct && r.ct.includes('image')) stats[h].ok++;
      else {
        stats[h].bad++;
        if (bad.length < 25) bad.push({ h, status: r.status, ct: r.ct, u: u.slice(0, 90) });
      }
      await new Promise((res) => setTimeout(res, 80));
    }
  }
  console.log('unique urls', urls.size);
  console.log('by host', stats);
  console.log('sample bad', bad);
})();
