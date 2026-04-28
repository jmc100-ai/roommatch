// Quick test: call Gemini with the updated prompt for Mexico City and check which neighborhoods it returns
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const dotenv = require('dotenv');
dotenv.config();

const GEMINI_KEY = process.env.GEMINI_KEY;
if (!GEMINI_KEY) { console.error('No GEMINI_KEY'); process.exit(1); }

const city = 'Mexico City';

const prompt = `Act as a local travel expert with deep knowledge of hotel neighborhoods.

For ${city}, return the top 8–10 distinct areas where travelers typically stay.
Cover ALL of these zone types that exist in the city — do NOT omit any category that applies:
1. Iconic first-timer neighborhoods (historic centre, top cultural district)
2. Trendy / bohemian areas (café culture, art galleries, local dining)
3. Upscale / luxury residential areas
4. Major hotel & business corridors (grand boulevards, financial districts with 4-5 star hotels)
   — these are often NOT residential but ARE major hotel zones; include them (e.g. Paseo de la Reforma
   in Mexico City, Champs-Élysées in Paris, Mayfair in London, Midtown in NYC)
5. Authentic local neighborhoods for returning travelers
Do NOT bundle two distinct areas into one entry (e.g. "Reforma/Juárez" should be two separate entries).
If a grand boulevard or hotel strip is distinct from the colonia it runs through, list it separately.
Include a mix of areas for first-time visitors AND returning travelers who want to go deeper.

Return ONLY a valid JSON array — no markdown, no explanation, no code fences, just the array.

Each item: { "name": "...", "bbox": {...}, "polygon": {...}, "vibe_short": "...", "visitor_type": "..." }
(full structure not needed — just name, bbox, vibe_short, visitor_type for this test)`;

const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`;
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
  }),
});
const data = await res.json();
const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
let json;
try {
  const clean = text.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  json = JSON.parse(clean);
} catch(e) {
  console.error('Parse error:', e.message);
  console.log('Raw:', text.slice(0, 500));
  process.exit(1);
}
console.log(`\nGemini returned ${json.length} neighborhoods for ${city}:\n`);
json.forEach((n, i) => console.log(`  ${i+1}. ${n.name} (${n.visitor_type}) — ${n.vibe_short}`));
const hasReforma = json.some(n => n.name.toLowerCase().includes('reforma'));
console.log(`\nReforma included: ${hasReforma ? '✓ YES' : '✗ NO'}`);
