/**
 * Geographic indexing helpers — haversine zones, airport quality rules, catalog coords.
 */

const EARTH_RADIUS_MI = 3958.8;

function haversineMi(lat1, lng1, lat2, lng2) {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180)
    * Math.cos((lat2 * Math.PI) / 180)
    * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

/** @param {{ geoAnchor: { lat: number, lng: number }, geoRadiusMi: number }} zone */
function isInGeoZone(lat, lng, zone) {
  if (lat == null || lng == null || !zone?.geoAnchor || !zone.geoRadiusMi) return false;
  return haversineMi(zone.geoAnchor.lat, zone.geoAnchor.lng, lat, lng) <= zone.geoRadiusMi;
}

function bboxEnclosingRadius(lat, lng, radiusMi) {
  const latDelta = radiusMi / 69.0;
  const lngDelta = radiusMi / (69.0 * Math.cos((lat * Math.PI) / 180));
  return {
    lat_min: lat - latDelta,
    lat_max: lat + latDelta,
    lon_min: lng - lngDelta,
    lon_max: lng + lngDelta,
  };
}

function hotelListLatLng(hotel) {
  return {
    lat: hotel.latitude ?? hotel.location?.latitude ?? hotel.lat ?? null,
    lng: hotel.longitude ?? hotel.location?.longitude ?? hotel.lng ?? null,
  };
}

function detailLatLng(detail) {
  return {
    lat: detail.location?.latitude ?? detail.latitude ?? detail.lat ?? null,
    lng: detail.location?.longitude ?? detail.longitude ?? detail.lng ?? null,
  };
}

/**
 * Standard rule: any room type with ≥ minRoomPhotos photos.
 * Airport-zone exception: ≥ minHotelImages hotel-level photos AND ≥1 photo on some room.
 */
function passesRoomQuality(detail, minRoomPhotos, geoQuality) {
  const rooms = detail.rooms || [];
  const hasQualityRoom = rooms.some((room) => (room.photos || []).length >= minRoomPhotos);
  if (hasQualityRoom) return true;
  if (!geoQuality) return false;
  const { lat, lng } = detailLatLng(detail);
  if (!isInGeoZone(lat, lng, geoQuality)) return false;
  const minImages = Math.max(1, Number(geoQuality.minHotelImages) || 6);
  const hotelImages = detail.hotelImages || [];
  if (hotelImages.length < minImages) return false;
  return rooms.some((room) => (room.photos || []).length >= 1);
}

module.exports = {
  EARTH_RADIUS_MI,
  haversineMi,
  isInGeoZone,
  bboxEnclosingRadius,
  hotelListLatLng,
  detailLatLng,
  passesRoomQuality,
};
