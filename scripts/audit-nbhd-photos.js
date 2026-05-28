#!/usr/bin/env node
/** Quick audit: neighborhood photo URLs + CSS url() breakage */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

function escHtml(s) {
  return (s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}
function cssUrlBroken(url) {
  const css = `background-image:url('${escHtml(url)}')`;
  // Unencoded ) inside single-quoted url() terminates the function in CSS
  const inner = url.replace(/%28/gi, '(').replace(/%29/gi, ')');
  const m = inner.match(/url\('([^']*)'\)/);
  if (!m) return false;
  const path = m[1];
  return path.includes(')');
}

(async () => {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data, error } = await db
    .from('neighborhoods')
    .select('city,name,photo_url,vibe_photos,vibe_elements')
    .in('city', ['Paris', 'Mexico City']);
  if (error) throw error;

  let cssBroken = 0;
  let missingHero = 0;
  let thinCats = 0;
  const gaps = [];

  for (const n of data || []) {
    if (!n.photo_url) {
      missingHero++;
      gaps.push({ city: n.city, name: n.name, issue: 'no photo_url' });
    }
    if (n.photo_url && cssUrlBroken(n.photo_url)) {
      cssBroken++;
      gaps.push({ city: n.city, name: n.name, issue: 'css-broken hero', url: n.photo_url.slice(0, 100) });
    }
    const vp = n.vibe_photos || {};
    for (const [k, arr] of Object.entries(vp)) {
      const len = (arr || []).length;
      if (len < 3) thinCats++;
      if (len === 0) gaps.push({ city: n.city, name: n.name, issue: `empty ${k}` });
      for (const p of arr || []) {
        const u = typeof p === 'string' ? p : p?.url;
        if (u && cssUrlBroken(u)) {
          cssBroken++;
          gaps.push({ city: n.city, name: n.name, issue: `css-broken ${k}`, url: u.slice(0, 100) });
        }
      }
    }
    const ve = n.vibe_elements || {};
    for (const key of Object.keys(ve)) {
      if (!vp[key] || !vp[key].length) {
        gaps.push({ city: n.city, name: n.name, issue: `element ${key} no photos` });
      }
    }
  }

  console.log('hoods', data.length, 'cssBroken', cssBroken, 'missingHero', missingHero, 'thinCats', thinCats);
  gaps.slice(0, 30).forEach((g) => console.log(g));
})();
