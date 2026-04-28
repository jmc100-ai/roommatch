// Simulate the p75 vs p100 (current max) scoring for Mexico City restaurants + cafes
// Using the actual numbers from the DB

const neighborhoods = [
  { name: 'Roma Norte',       restaurants: 307, cafes: 82,  parks: 16,  area: 2.1 },
  { name: 'Condesa',          restaurants: 366, cafes: 106, parks: 25,  area: 3.5 },
  { name: 'Juarez',           restaurants: 151, cafes: 46,  parks: 18,  area: 2.3 },
  { name: 'Centro Historico', restaurants: 393, cafes: 71,  parks: 66,  area: 9.2 },
  { name: 'Polanco',          restaurants: 189, cafes: 63,  parks: 45,  area: 5.0 },
  { name: 'Coyoacan',         restaurants: 148, cafes: 55,  parks: 44,  area: 2.7 },
  { name: 'San Rafael',       restaurants: 34,  cafes: 11,  parks: 19,  area: 1.5 },
];

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const frac = idx - lo;
  return sorted[lo] + frac * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo]);
}

function score(density, peak) {
  return Math.min(100, Math.max(10, Math.round(Math.sqrt(density / peak) * 100)));
}

for (const cat of ['restaurants', 'cafes', 'parks']) {
  const densities = neighborhoods.map(n => n[cat] / n.area).sort((a, b) => a - b);
  const pMax = Math.max(...densities);
  const p75  = percentile(densities.filter(d => d > 0), 0.75);
  
  console.log(`\n=== ${cat} — peak=${pMax.toFixed(1)}/km²  p75=${p75.toFixed(1)}/km² ===`);
  console.log('Neighborhood'.padEnd(20) + 'density'.padEnd(10) + 'score(max)'.padEnd(12) + 'score(p75)'.padEnd(12) + 'Δ');
  for (const n of neighborhoods) {
    const d = n[cat] / n.area;
    const sMax = score(d, pMax);
    const sP75 = score(d, p75);
    const delta = sP75 - sMax;
    console.log(`${n.name.padEnd(20)}${d.toFixed(1).padEnd(10)}${String(sMax).padEnd(12)}${String(sP75).padEnd(12)}${delta >= 0 ? '+' : ''}${delta}`);
  }
}
