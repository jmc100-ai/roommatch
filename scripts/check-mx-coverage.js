require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
  // Mexico City V2 index stats
  const { data: mx } = await db.from('v2_indexed_cities').select('status,hotel_count,photo_count,completed_at').eq('city', 'Mexico City').single();
  const { count: mxHotels } = await db.from('v2_hotels_cache').select('hotel_id', { count: 'exact', head: true }).eq('city', 'Mexico City');
  const { count: mxFacts } = await db.from('v2_room_feature_facts').select('id', { count: 'exact', head: true }).eq('city', 'Mexico City');
  const { count: mxInventory } = await db.from('v2_room_inventory').select('id', { count: 'exact', head: true }).eq('city', 'Mexico City');

  // Photos per hotel distribution
  const { data: photoSample } = await db.from('v2_room_feature_facts')
    .select('hotel_id')
    .eq('city', 'Mexico City')
    .limit(1);

  console.log('=== Mexico City V2 Index ===');
  console.log('Status:', mx?.status);
  console.log('v2_indexed_cities: hotels=' + mx?.hotel_count + ' photos=' + mx?.photo_count + ' completed=' + mx?.completed_at?.substring(0,10));
  console.log('v2_hotels_cache rows:', mxHotels);
  console.log('v2_room_feature_facts rows:', mxFacts);
  console.log('v2_room_inventory rows:', mxInventory);
  console.log('Facts per hotel (avg):', mxFacts && mxHotels ? Math.round(mxFacts / mxHotels) : 'n/a');

  // Check LiteAPI total hotels for Mexico City
  console.log('\n=== LiteAPI Coverage Check ===');
  const params = new URLSearchParams({ cityName: 'Mexico City', countryCode: 'MX', limit: 1000 });
  const r = await fetch('https://api.liteapi.travel/v3.0/data/hotels?' + params, {
    headers: { 'X-API-Key': process.env.LITEAPI_PROD_KEY, 'accept': 'application/json' }
  });
  const d = await r.json();
  const hotels = d?.data || [];
  console.log('LiteAPI total hotels for Mexico City:', hotels.length);
  console.log('(LiteAPI limit=1000, may be capped)');

  // How many have photos vs not
  const withPhotos = hotels.filter(h => h.main_photo || h.hotelImages?.length > 0 || h.main_photo).length;
  console.log('Hotels with main_photo:', withPhotos);

  // Star rating distribution
  const byStars = {};
  for (const h of hotels) {
    const s = h.starRating || 0;
    byStars[s] = (byStars[s] || 0) + 1;
  }
  console.log('By star rating:', JSON.stringify(byStars));

  // Gap: hotels in LiteAPI but not in our index
  const indexedIds = new Set((await db.from('v2_hotels_cache').select('hotel_id').eq('city', 'Mexico City')).data?.map(h => h.hotel_id) || []);
  const liteIds = new Set(hotels.map(h => h.id));
  const notIndexed = [...liteIds].filter(id => !indexedIds.has(id));
  const onlyInIndex = [...indexedIds].filter(id => !liteIds.has(id));
  console.log('\nNot indexed (in LiteAPI, not in our DB):', notIndexed.length);
  console.log('Only in index (in DB, not returned by LiteAPI query):', onlyInIndex.length);
  console.log('(Note: LiteAPI query may use limit=1000 — total could be higher)');
})();
