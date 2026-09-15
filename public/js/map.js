import { el } from './util.js';

const TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const EARTH_RADIUS_M = 6371008.8;
const DEFAULT_CENTRE = [54.0, -2.2]; // roughly the middle of the UK
const VIEW_KEY = 'cctvmap.view';

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

  const tiles = L.tileLayer(TILES, { maxZoom: 19, attribution: TILE_ATTRIBUTION });
  let tileErrors = 0;
  tiles.on('tileerror', () => {
    tileErrors += 1;
    if (tileErrors === 4) document.querySelector('#map-offline')?.removeAttribute('hidden');
  });
  tiles.on('tileload', () => {
    tileErrors = 0;
    document.querySelector('#map-offline')?.setAttribute('hidden', '');
  });
  tiles.addTo(map);

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
  L.tileLayer(TILES, { maxZoom: 19 }).addTo(map);

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
