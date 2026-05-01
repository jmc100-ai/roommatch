require('dotenv').config();

(async () => {
  // LiteAPI /data/hotels paginates with offset. Let's find true total for Mexico City.
  console.log('Counting LiteAPI hotels for Mexico City...');
  let offset = 0;
  const limit = 1000;
  let total = 0;
  let starDist = {};
  
  while (true) {
    const params = new URLSearchParams({
      cityName: 'Mexico City',
      countryCode: 'MX',
      limit,
      offset,
    });
    const r = await fetch('https://api.liteapi.travel/v3.0/data/hotels?' + params, {
      headers: { 'X-API-Key': process.env.LITEAPI_PROD_KEY, 'accept': 'application/json' }
    });
    const d = await r.json();
    const hotels = d?.data || [];
    if (!hotels.length) break;
    
    total += hotels.length;
    for (const h of hotels) {
      const s = h.starRating || h.star_rating || 0;
      starDist[s] = (starDist[s] || 0) + 1;
    }
    console.log(`  offset=${offset}: got ${hotels.length} hotels (running total: ${total})`);
    
    if (hotels.length < limit) break; // last page
    offset += limit;
    if (offset > 10000) { console.log('Safety cap hit'); break; }
  }

  console.log('\nTotal hotels in LiteAPI for Mexico City:', total);
  console.log('Star rating distribution:');
  // Sort by key
  for (const [k, v] of Object.entries(starDist).sort((a,b) => b[0]-a[0])) {
    console.log(`  ${k} stars: ${v}`);
  }
  console.log('\nOur index: 200 hotels');
  console.log('Gap:', total - 200, 'hotels not yet indexed');
})();
