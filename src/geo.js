const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/** Great-circle distance between two points, in metres. */
export function distanceMetres(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * A latitude/longitude box that is guaranteed to contain every point within
 * `radiusM` of the centre. Used to narrow the SQL scan before the exact
 * distance check in JS.
 */
export function boundingBox(lat, lng, radiusM) {
  const latDelta = toDeg(radiusM / EARTH_RADIUS_M);
  // Guard against the cosine collapsing to zero at the poles.
  const cos = Math.max(Math.cos(toRad(lat)), 1e-6);
  const lngDelta = toDeg(radiusM / (EARTH_RADIUS_M * cos));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

/** Compass bearing in degrees from point 1 to point 2 (0 = north). */
export function bearingBetween(lat1, lng1, lat2, lng2) {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * True when a camera at `bearing` with a `fov`-degree field of view could
 * plausibly see something lying at `targetBearing` from it. Angles wrap at 360.
 */
export function bearingWithinView(bearing, fov, targetBearing) {
  if (bearing == null) return true; // direction unknown - don't rule it out
  const half = (fov ?? 60) / 2;
  let diff = Math.abs(((targetBearing - bearing + 540) % 360) - 180);
  return diff <= half;
}

export const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

/** Turns 0-359 into a compass label such as "NNE". */
export function compassLabel(bearing) {
  if (bearing == null || Number.isNaN(bearing)) return '';
  const idx = Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS_POINTS[idx];
}
