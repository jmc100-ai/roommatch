#!/usr/bin/env node
/** HEAD-check neighborhood hero + sample gallery URLs */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function head(url) {
  try {
    const r = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'TravelBoop/1.0 (neighborhood audit)' },
    });
    return r.status;
  } catch (e) {
    return `err:${e.message}`;
  }
}

(async () => {
  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data } = await db
    .from('neighborhoods')
    .select('city,name,photo_url')
    .in('city', ['Paris', 'Mexico City']);
  const bad = [];
  for (const n of data || []) {
    const st = await head(n.photo_url);
    if (st !== 200) bad.push({ city: n.city, name: n.name, status: st, url: n.photo_url });
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log('heroes checked', data.length, 'bad', bad.length);
  bad.forEach((b) => console.log(b));
})();
