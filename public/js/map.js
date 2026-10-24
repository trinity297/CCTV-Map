import { el } from './util.js';

const EARTH_RADIUS_M = 6371008.8;
const DEFAULT_CENTRE = [54.0, -2.2]; // roughly the middle of the UK
const VIEW_KEY = 'cctvmap.view';

/**
 * Tile settings come from the server (see src/map-config.js) so the imagery
 * source can be changed without touching the front end. An empty url means
 * "no background map" - the pins and view cones still draw.
 */
function tileConfig() {
  return window.__cctvMeta?.map || { url: '', attribution: '', maxZoom: 19, subdomains: 'abc' };
}

export function addTileLayer(map) {
  const config = tileConfig();
  if (!config.url) return null;
  return L.tileLayer(config.url, {
    maxZoom: config.maxZoom || 19,
    // Past this, Leaflet scales the deepest real tile up instead of asking
    // for one the provider does not have.
    maxNativeZoom: config.maxNativeZoom || undefined,
    subdomains: config.subdomains || 'abc',
    attribution: config.attribution || '',
  }).addTo(map);
}

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Point reached by travelling `distance` metres along `bearing` from a point. */
export function destination(lat, lng, bearing, distance) {
  const ang = distance / EARTH_RADIUS_M;
  const br = toRad(bearing);
  const lat1 = toRad(lat);
  const lng1 = toRad(lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br),
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(br) * Math.sin(ang) * Math.cos(lat1),
    Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
  );
  return [toDeg(lat2), ((toDeg(lng2) + 540) % 360) - 180];
}

/** Compass bearing in degrees from one point to another (0 = north). */
export function bearingBetween(lat1, lng1, lat2, lng2) {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle distance between two points, in metres. */
export function distanceMetres(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Polygon outlining what a camera can see: apex at the camera, arc at its range. */
export function conePoints(lat, lng, bearing, fov = 60, range = 40, steps = 16) {
  const spread = Math.min(360, Math.max(5, fov));
  if (spread >= 355) {
    // Effectively a full-circle (360 / fisheye) camera.
    return Array.from({ length: 36 }, (_, i) => destination(lat, lng, i * 10, range));
  }
  const start = bearing - spread / 2;
  const points = [[lat, lng]];
  for (let i = 0; i <= steps; i += 1) {
    points.push(destination(lat, lng, start + (spread * i) / steps, range));
  }
  return points;
}

function statusColour(status) {
  const styles = getComputedStyle(document.documentElement);
  return styles.getPropertyValue(`--s-${status}`).trim() || styles.getPropertyValue('--accent').trim();
}

export function createMapView({ container, onSelect, onMapClick, onViewportChange }) {
  const map = L.map(container, { zoomControl: true, preferCanvas: true });

  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
  } catch { /* ignore */ }
  map.setView(saved?.centre || DEFAULT_CENTRE, saved?.zoom ?? (saved ? 15 : 6));

  const tiles = addTileLayer(map);
  if (tiles) {
    // Only warn when the provider is genuinely unreachable. A handful of
    // missing tiles - a gap in coverage, one request that timed out - is not
    // worth an alarming banner while the rest of the map is drawing fine.
    const banner = () => document.querySelector('#map-offline');
    let errors = 0;
    let loaded = 0;
    tiles.on('tileerror', () => {
      errors += 1;
      if (loaded === 0 && errors >= 4) banner()?.removeAttribute('hidden');
    });
    tiles.on('tileload', () => {
      loaded += 1;
      errors = 0;
      banner()?.setAttribute('hidden', '');
    });
  }

  const coneLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const overlayLayer = L.layerGroup().addTo(map);

  const markers = new Map(); // record id -> marker
  let activeId = null;
  let pickMode = null;
  let hintNode = null;

  const persistView = () => {
    try {
      const c = map.getCenter();
      localStorage.setItem(VIEW_KEY, JSON.stringify({ centre: [c.lat, c.lng], zoom: map.getZoom() }));
    } catch { /* ignore */ }
  };

  map.on('moveend zoomend', () => {
    persistView();
    onViewportChange?.(bounds());
  });

  map.on('click', (event) => {
    const point = { lat: event.latlng.lat, lng: event.latlng.lng };
    if (pickMode) {
      const done = pickMode;
      stopPicking();
      done(point);
      return;
    }
    onMapClick?.(point);
  });

  function bounds() {
    const b = map.getBounds();
    return {
      minLat: b.getSouth(), maxLat: b.getNorth(),
      minLng: b.getWest(), maxLng: b.getEast(),
    };
  }

  function makeIcon(record, isActive) {
    const colour = statusColour(record.status);
    return L.divIcon({
      className: '',
      html: `<div class="pin${isActive ? ' pin--active' : ''}" style="background:${colour}"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  function render(records) {
    markerLayer.clearLayers();
    coneLayer.clearLayers();
    markers.clear();

    for (const record of records) {
      if (record.lat == null || record.lng == null) continue;
      const colour = statusColour(record.status);

      for (const camera of record.cameras || []) {
        if (camera.bearing == null) continue;
        L.polygon(conePoints(record.lat, record.lng, camera.bearing, camera.fov, camera.range_m), {
          color: colour,
          weight: 1,
          opacity: 0.55,
          fillColor: colour,
          fillOpacity: 0.14,
          interactive: false,
        }).addTo(coneLayer);
      }

      const marker = L.marker([record.lat, record.lng], {
        icon: makeIcon(record, record.id === activeId),
        title: record.premises_name || record.address || 'CCTV record',
        keyboard: true,
        alt: record.premises_name || record.address || 'CCTV record',
      });
      marker.on('click', () => onSelect?.(record.id));
      marker.addTo(markerLayer);
      markers.set(record.id, { marker, record });
    }
  }

  function setActive(id) {
    const previous = markers.get(activeId);
    activeId = id;
    if (previous) previous.marker.setIcon(makeIcon(previous.record, false));
    const next = markers.get(id);
    if (next) {
      next.marker.setIcon(makeIcon(next.record, true));
      map.panTo(next.marker.getLatLng(), { animate: true });
    }
  }

  function focus(lat, lng, zoom = 18) {
    if (lat == null || lng == null) return;
    map.setView([lat, lng], Math.max(map.getZoom(), zoom));
  }

  function fit(records) {
    const points = records
      .filter((r) => r.lat != null && r.lng != null)
      .map((r) => [r.lat, r.lng]);
    if (points.length === 1) map.setView(points[0], 17);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
  }

  function startPicking(callback, label = 'Click the map to place the pin') {
    pickMode = callback;
    container.style.cursor = 'crosshair';
    hintNode = el('div', { className: 'map__hint' }, label);
    container.parentElement.append(hintNode);
  }

  function stopPicking() {
    pickMode = null;
    container.style.cursor = '';
    hintNode?.remove();
    hintNode = null;
  }

  /** Transient overlay used by the coverage check: the point and its radius. */
  function showSearchArea(lat, lng, radiusM) {
    overlayLayer.clearLayers();
    if (lat == null || lng == null) return;
    L.circle([lat, lng], {
      radius: radiusM,
      color: statusColour('requested'),
      weight: 1.5,
      dashArray: '4 4',
      fillOpacity: 0.06,
      interactive: false,
    }).addTo(overlayLayer);
    L.circleMarker([lat, lng], {
      radius: 6, color: '#fff', weight: 2,
      fillColor: statusColour('requested'), fillOpacity: 1, interactive: false,
    }).addTo(overlayLayer);
    map.fitBounds(L.latLng(lat, lng).toBounds(Math.max(radiusM * 2.4, 200)));
  }

  function clearOverlay() {
    overlayLayer.clearLayers();
  }

  return {
    map, render, setActive, focus, fit, bounds,
    startPicking, stopPicking, showSearchArea, clearOverlay,
    invalidate: () => map.invalidateSize(),
    isPicking: () => Boolean(pickMode),
  };
}

/**
 * A small self-contained Leaflet map used inside the record form for
 * choosing the premises location.
 */
export function createPickerMap(container, initial, onChange) {
  const map = L.map(container, { zoomControl: true, attributionControl: false });
  addTileLayer(map);

  // A divIcon rather than Leaflet's default marker: it matches the pins on the
  // main map, and keeps the app free of binary image assets.
  const icon = L.divIcon({
    className: '',
    html: '<div class="pin pin--picker"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  let marker = null;
  const place = (lat, lng) => {
    if (marker) marker.setLatLng([lat, lng]);
    else marker = L.marker([lat, lng], { draggable: true, icon }).addTo(map)
      .on('dragend', (e) => {
        const p = e.target.getLatLng();
        onChange({ lat: p.lat, lng: p.lng });
      });
  };

  if (initial?.lat != null && initial?.lng != null) {
    map.setView([initial.lat, initial.lng], 18);
    place(initial.lat, initial.lng);
  } else {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    } catch { /* ignore */ }
    map.setView(saved?.centre || DEFAULT_CENTRE, saved?.zoom ?? 6);
  }

  map.on('click', (e) => {
    place(e.latlng.lat, e.latlng.lng);
    onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
  });

  // The dialog animates open; Leaflet needs a nudge once it has its size.
  setTimeout(() => map.invalidateSize(), 60);
  return { map, place, invalidate: () => map.invalidateSize() };
}
