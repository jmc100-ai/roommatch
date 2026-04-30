#!/usr/bin/env node
// Quick sanity test for the expanded 75-field Gemini prompt.
require("dotenv").config();
const { parseStructuredCaption, STRUCTURED_FIELD_TO_FACT } = require("./fact-catalog");
const { createClient } = require("@supabase/supabase-js");

const GEMINI_KEY = process.env.GEMINI_KEY;
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const FIELDS = Object.keys(STRUCTURED_FIELD_TO_FACT);

function buildPrompt(roomName, photoType) {
  const isLikelyBath = /bath/i.test(roomName) || photoType === "bathroom";
  return [
    "Analyze this hotel room photo. For each field answer ONLY: yes | no | unknown",
    "Use EXACTLY these field names and format (one per line, no extra text):",
    "PHOTO_TYPE: bedroom|bathroom|living|view|other",
    ...FIELDS.map(f => `${f}: yes|no|unknown`),
    `Context: room="${roomName}" type="${photoType}"`,
    isLikelyBath ? "This is likely a bathroom — answer all bathroom fields carefully." : "Answer bathroom fields as unknown unless clearly visible.",
    "Only answer yes for features CLEARLY visible in this photo. Use unknown when uncertain.",
  ].join("\n");
}

async function testPhoto(photoUrl, roomName, photoType) {
  const imgRes = await fetch(photoUrl, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
  if (!imgRes.ok) throw new Error("image fetch failed: " + imgRes.status);
  const b64 = Buffer.from(await imgRes.arrayBuffer()).toString("base64");
  const mime = imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(40000),
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: buildPrompt(roomName, photoType) }] }],
      generationConfig: { maxOutputTokens: 700, temperature: 0.1 },
    }),
  });
  const d = await r.json();
  return d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

(async () => {
  console.log(`Prompt covers ${FIELDS.length} facts out of 109 in catalog.\n`);

  const { data: photos } = await db.from("v2_room_inventory")
    .select("photo_url,room_name,photo_type")
    .eq("city", "Mexico City")
    .in("photo_type", ["bathroom", "bedroom"])
    .limit(4);

  const bathroom = photos?.find(p => p.photo_type === "bathroom");
  const bedroom  = photos?.find(p => p.photo_type === "bedroom");

  for (const p of [bathroom, bedroom].filter(Boolean)) {
    console.log(`=== ${p.photo_type.toUpperCase()}: ${p.room_name?.slice(0, 50)} ===`);
    const cap = await testPhoto(p.photo_url, p.room_name, p.photo_type);
    const facts = parseStructuredCaption(cap);
    const trues  = facts.filter(f => f.fact_value === 1).map(f => f.fact_key);
    const falses = facts.filter(f => f.fact_value === 0).map(f => f.fact_key);
    const totalLines = (cap || "").split("\n").filter(l => l.trim()).length;
    console.log(`Response lines: ${totalLines} | TRUE: ${trues.length} | FALSE: ${falses.length}`);
    console.log(`TRUE:  ${trues.join(", ") || "(none)"}`);
    console.log(`FALSE (high-signal): ${falses.join(", ") || "(none)"}`);
    console.log();
  }
})();
