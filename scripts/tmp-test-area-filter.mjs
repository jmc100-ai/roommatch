const bb = "19.415,-99.182,19.427,-99.166";
const q = `[out:json][timeout:35];
(
  way["leisure"~"^(park|garden)$"](${bb})(if: geom.area() > 500.0);
  relation["leisure"~"^(park|garden)$"](${bb})(if: geom.area() > 500.0);
);
out tags;`;

const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: `data=${encodeURIComponent(q)}`,
});
const txt = await res.text();
if (!res.ok) {
  console.error(res.status, txt.slice(0, 800));
  process.exit(1);
}
const d = JSON.parse(txt);
console.log("count", (d.elements || []).length);
console.log("sample tags", (d.elements || []).slice(0, 3).map((e) => e.tags));
