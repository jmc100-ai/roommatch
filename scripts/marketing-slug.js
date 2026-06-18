/**
 * URL slug helpers for marketing + /stays/ hotel pages.
 */
function stripAccents(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function slugify(text, maxLen = 72) {
  const base = stripAccents(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.slice(0, maxLen).replace(/-+$/g, "") || "hotel";
}

function citySlug(city) {
  if (city === "Mexico City") return "mexico-city";
  if (city === "Paris") return "paris";
  return slugify(city, 32);
}

function hotelStaySlug(name, city, hotelId) {
  const cs = citySlug(city);
  let slug = `${slugify(name, 48)}-${cs}`;
  if (slug.length < 8) slug = `${slug}-${String(hotelId).slice(-6)}`;
  return slug;
}

function neighborhoodPathSlug(name) {
  return slugify(name, 48);
}

function hotelsInPath(name) {
  return `/hotels-in-${neighborhoodPathSlug(name)}`;
}

module.exports = {
  slugify,
  citySlug,
  hotelStaySlug,
  neighborhoodPathSlug,
  hotelsInPath,
  stripAccents,
};
