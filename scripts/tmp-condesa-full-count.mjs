// Verify POI counts inside the NEW Condesa polygon using pointInPolygon
const ring = [
  {lat:19.421,lng:-99.183},{lat:19.421,lng:-99.163},{lat:19.414,lng:-99.163},
  {lat:19.407,lng:-99.164},{lat:19.403,lng:-99.166},{lat:19.399,lng:-99.171},
  {lat:19.400,lng:-99.179},{lat:19.406,lng:-99.183},{lat:19.414,lng:-99.182},
  {lat:19.421,lng:-99.183}
];

function pointInPolygon(lat, lng, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i].lng, yi = ring[i].lat;
    const xj = ring[j].lng, yj = ring[j].lat;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const lat_min = 19.399, lon_min = -99.183, lat_max = 19.421, lon_max = -99.163;

const q = `[out:json][timeout:25];(
  node["amenity"~"^(restaurant|fast_food|bar|pub|food_court)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["amenity"="cafe"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["tourism"~"^(museum|gallery)$"](${lat_min},${lon_min},${lat_max},${lon_max});
  node["shop"](${lat_min},${lon_min},${lat_max},${lon_max});
);out center tags;`;

const res = await fetch(OVERPASS, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'data=' + encodeURIComponent(q),
});
const text = await res.text();
if (text.startsWith('<')) { console.log('Rate limited'); process.exit(1); }
const data = JSON.parse(text);

const counts = { restaurants: 0, cafes: 0, museums: 0, shops: 0 };
for (const el of data.elements) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!lat || !pointInPolygon(lat, lng, ring)) continue;
  const t = el.tags || {};
  if (t.amenity === 'cafe') counts.cafes++;
  else if (['restaurant','fast_food','bar','pub','food_court'].includes(t.amenity)) counts.restaurants++;
  else if (['museum','gallery'].includes(t.tourism)) counts.museums++;
  else if (t.shop) counts.shops++;
}
console.log('New Condesa polygon POI counts:');
console.log(counts);
