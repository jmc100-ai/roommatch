// Debug: compute ring areas and densities to understand why Juárez scores 100/100
// Uses the actual polygon rings from the DB (hardcoded for this analysis)

const JUAREZ_RING = [{"lat":19.420616,"lng":-99.176814},{"lat":19.423528,"lng":-99.16357},{"lat":19.423327,"lng":-99.16347},{"lat":19.423198,"lng":-99.163335},{"lat":19.423112,"lng":-99.163159},{"lat":19.423087,"lng":-99.163032},{"lat":19.423088,"lng":-99.162892},{"lat":19.423117,"lng":-99.162762},{"lat":19.423212,"lng":-99.16258},{"lat":19.423445,"lng":-99.162396},{"lat":19.423607,"lng":-99.162352},{"lat":19.423751,"lng":-99.162355},{"lat":19.423896,"lng":-99.162398},{"lat":19.425452,"lng":-99.155457},{"lat":19.430619,"lng":-99.151712},{"lat":19.430972,"lng":-99.151462},{"lat":19.435187,"lng":-99.149848},{"lat":19.434748,"lng":-99.151168},{"lat":19.433311,"lng":-99.154312},{"lat":19.433045,"lng":-99.154474},{"lat":19.432859,"lng":-99.154932},{"lat":19.430987,"lng":-99.159258},{"lat":19.430856,"lng":-99.1597},{"lat":19.428988,"lng":-99.163457},{"lat":19.429077,"lng":-99.16354},{"lat":19.429132,"lng":-99.16374},{"lat":19.429114,"lng":-99.163827},{"lat":19.429033,"lng":-99.163951},{"lat":19.42892,"lng":-99.164014},{"lat":19.428796,"lng":-99.164019},{"lat":19.427184,"lng":-99.167275},{"lat":19.427295,"lng":-99.16737},{"lat":19.427388,"lng":-99.167592},{"lat":19.427333,"lng":-99.167863},{"lat":19.42719,"lng":-99.16801},{"lat":19.427037,"lng":-99.168063},{"lat":19.426895,"lng":-99.168054},{"lat":19.425199,"lng":-99.17148},{"lat":19.42525,"lng":-99.171523},{"lat":19.425284,"lng":-99.171595},{"lat":19.425277,"lng":-99.17169},{"lat":19.42524,"lng":-99.17175},{"lat":19.42516,"lng":-99.171794},{"lat":19.425079,"lng":-99.171788},{"lat":19.423329,"lng":-99.175461},{"lat":19.423159,"lng":-99.175096},{"lat":19.42275,"lng":-99.175261},{"lat":19.422723,"lng":-99.175343},{"lat":19.422722,"lng":-99.175507},{"lat":19.422596,"lng":-99.175661},{"lat":19.420616,"lng":-99.176814}];

function ringAreaKm2(ring) {
  const coords = ring.map(p => ({ lat: p.lat, lon: p.lng }));
  if (!coords || coords.length < 4) return null;
  const first = coords[0], last = coords[coords.length - 1];
  if (Math.abs(first.lat - last.lat) > 1e-7 || Math.abs(first.lon - last.lon) > 1e-7) return null;
  let latSum = 0;
  for (const p of coords) latSum += p.lat;
  const refLat = (latSum / coords.length) * (Math.PI / 180);
  const mPerLat = 111_000;
  const mPerLon = 111_000 * Math.cos(refLat);
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const x1 = coords[i].lon * mPerLon, y1 = coords[i].lat * mPerLat;
    const x2 = coords[i+1].lon * mPerLon, y2 = coords[i+1].lat * mPerLat;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum / 2) / 1e6;
}

function bboxArea(bbox) {
  const mPerLat = 111_000;
  const refLat = ((bbox.lat_min + bbox.lat_max) / 2) * (Math.PI / 180);
  const mPerLon = 111_000 * Math.cos(refLat);
  return (bbox.lat_max - bbox.lat_min) * mPerLat * (bbox.lon_max - bbox.lon_min) * Math.abs(mPerLon) / 1e6;
}

// Data from DB
const nbhds = [
  { name:'Roma Norte',     counts:{restaurants:307,cafes:82,parks:16,museums:8,icon_spots:8},   bbox:{lat_min:19.410435,lat_max:19.425839,lon_min:-99.176905,lon_max:-99.15369},  poly_verts:49  },
  { name:'Condesa',        counts:{restaurants:366,cafes:106,parks:25,museums:7,icon_spots:19}, bbox:{lat_min:19.399,lat_max:19.421,lon_min:-99.183,lon_max:-99.163},             poly_verts:10  },
  { name:'Juárez',         counts:{restaurants:151,cafes:46,parks:18,museums:5,icon_spots:18},  bbox:{lat_min:19.420616,lat_max:19.435187,lon_min:-99.176814,lon_max:-99.149848}, poly_verts:51, ring:JUAREZ_RING },
  { name:'Centro Histórico',counts:{restaurants:393,cafes:71,parks:66,museums:58,icon_spots:104},bbox:{lat_min:19.418822,lat_max:19.44637,lon_min:-99.156438,lon_max:-99.110238},poly_verts:51  },
  { name:'Polanco',        counts:{restaurants:189,cafes:63,parks:45,museums:10,icon_spots:89}, bbox:{lat_min:19.421,lat_max:19.443,lon_min:-99.204,lon_max:-99.175},             poly_verts:6   },
  { name:'Coyoacán',       counts:{restaurants:148,cafes:55,parks:44,museums:7,icon_spots:19},  bbox:{lat_min:19.335,lat_max:19.362,lon_min:-99.178,lon_max:-99.158},             poly_verts:11  },
  { name:'San Rafael',     counts:{restaurants:34,cafes:11,parks:6,museums:1,icon_spots:5},     bbox:{lat_min:19.432269,lat_max:19.443612,lon_min:-99.169678,lon_max:-99.15567},  poly_verts:19  },
];

// Approximate ring areas for polygons we don't have (using bbox * shape factor):
// Roma Norte: well-known to be ~2.1 km² (49-vert Nominatim)
// Centro Histórico: ~9.2 km² (earlier calc)
// Coyoacán: ~2.7 km² (manually set to walkable core)
// San Rafael: ~1.5 km²
// Polanco: 6-vert might be a bbox approximation → ~7.4 km²
// Condesa: manually set 10-vert → ~3.5 km²
const KNOWN_AREAS = {
  'Roma Norte': 2.1,
  'Condesa': 3.5,
  'Centro Histórico': 9.2,
  'Polanco': 7.4,
  'Coyoacán': 2.7,
  'San Rafael': 1.5,
};

const cats = ['restaurants', 'cafes', 'parks', 'museums', 'icon_spots'];

// Compute areas and densities
for (const n of nbhds) {
  if (n.ring) {
    n.areaKm2 = ringAreaKm2(n.ring);
    console.log(`${n.name}: ring area = ${n.areaKm2?.toFixed(2)} km²  (bbox area = ${bboxArea(n.bbox).toFixed(2)} km²)`);
  } else {
    n.areaKm2 = KNOWN_AREAS[n.name] ?? bboxArea(n.bbox);
    console.log(`${n.name}: area = ${n.areaKm2?.toFixed(2)} km² (${KNOWN_AREAS[n.name] ? 'known' : 'bbox approx'})`);
  }
}

// Compute p75 ceiling per category
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), frac = idx - lo;
  return sorted[lo] + frac * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo]);
}

const p75 = {};
for (const cat of cats) {
  const densities = nbhds.map(n => (n.counts[cat] || 0) / (n.areaKm2 || 1)).filter(d => d > 0).sort((a,b) => a-b);
  p75[cat] = percentile(densities, 0.75);
}
console.log('\np75 ceilings:', Object.fromEntries(Object.entries(p75).map(([k,v]) => [k, v.toFixed(1)])));

// Score each neighborhood
console.log('\nScores (p75 ceiling):');
console.log('Neighborhood'.padEnd(20) + cats.map(c => c.slice(0,7).padEnd(9)).join('') + 'boop(avg)');
for (const n of nbhds) {
  const scores = cats.map(cat => {
    const d = (n.counts[cat] || 0) / (n.areaKm2 || 1);
    return Math.min(100, Math.max(10, Math.round(Math.sqrt(d / p75[cat]) * 100)));
  });
  const boop = Math.round(scores.reduce((a,b)=>a+b,0) / scores.length);
  console.log(`${n.name.padEnd(20)}${scores.map(s=>String(s).padEnd(9)).join('')}${boop}`);
}
