require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  const tables = ['v2_room_feature_facts', 'v2_room_inventory', 'v2_hotels_cache', 'v2_indexed_cities', 'hotel_profile_index', 'hotels_cache'];
  for (const t of tables) {
    const { error, count } = await db.from(t).delete({ count: 'exact' }).eq('city', 'Kuala Lumpur');
    console.log(t, '→', error ? 'ERROR: ' + error.message : `deleted rows from ${t}`);
  }
  console.log('KL cleaned. Triggering fresh V2 index...');
  const r = await fetch('http://localhost:3000/api/v2/reindex-city', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city: 'Kuala Lumpur', limit: 200, secret: process.env.INDEX_SECRET })
  });
  const d = await r.json();
  console.log('Reindex response:', JSON.stringify(d));
})();
