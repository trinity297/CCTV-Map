import { el, compassLabel } from './util.js';
import { addTileLayer, conePoints, destination, bearingBetween, distanceMetres } from './map.js';

/**
 * A small map for aiming one camera. The premises pin sits at the centre and
 * you click (or drag the handle) towards whatever the camera looks at - which
 * is how people actually know a camera's direction, rather than as a bearing
 * off a compass. One click sets both the direction and how far it sees.
 */
export function createAimMap({ position, bearing, fov, range, onChange }) {
  const state = {
    position: position && position.lat != null ? { ...position } : null,
    bearing: bearing ?? null,
    fov: fov ?? 60,
    range: range ?? 40,
  };

  const readout = el('p', { className: 'aim__readout' });
  const canvas = el('div', { className: 'aim__canvas' });
  const prompt = el('p', { className: 'aim__prompt' },
    'Place the premises pin above first — then aim the camera here.');

  const node = el('div', { className: 'aim' }, [canvas, prompt, readout]);

  let map = null;
  let cone = null;
  let handle = null;
  let centreMarker = null;

  function describe() {
    if (state.bearing == null) {
      readout.textContent = state.position
        ? 'Click the map where this camera looks.'
        : '';
      return;
    }
    readout.replaceChildren(
      el('strong', {}, `${Math.round(state.bearing)}° ${compassLabel(state.bearing)}`),
      ` · sees about ${Math.round(state.range)} m · ${Math.round(state.fov)}° wide`,
    );
  }

  function redraw() {
    if (!map || !state.position) return;
    const { lat, lng } = state.position;

    if (cone) cone.remove();
    cone = null;
    if (state.bearing != null) {
      cone = L.polygon(conePoints(lat, lng, state.bearing, state.fov, state.range), {
        color: 'var(--accent)',
        weight: 1.5,
        fillOpacity: 0.2,
        interactive: false,
        className: 'aim__cone',
      }).addTo(map);
    }

    const tip = state.bearing == null
      ? null
      : destination(lat, lng, state.bearing, state.range);
    if (tip) {
      if (handle) handle.setLatLng(tip);
      else {
        handle = L.marker(tip, {
          draggable: true,
          icon: L.divIcon({
            className: '',
            html: '<div class="aim__handle" title="Drag to aim"></div>',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          }),
        }).addTo(map);
        handle.on('drag', (event) => aimAt(event.target.getLatLng(), false));
        handle.on('dragend', () => onChange({ bearing: state.bearing, range: state.range }));
      }
    } else if (handle) {
      handle.remove();
      handle = null;
    }

    describe();
  }

  /** Turns a clicked point into a bearing and a viewing distance. */
  function aimAt(latlng, commit = true) {
    if (!state.position) return;
    const { lat, lng } = state.position;
    const metres = distanceMetres(lat, lng, latlng.lat, latlng.lng);
    if (metres < 1) return; // a click on the pin itself tells us nothing
    state.bearing = bearingBetween(lat, lng, latlng.lat, latlng.lng);
    state.range = Math.min(2000, Math.max(1, Math.round(metres)));
    redraw();
    if (commit) onChange({ bearing: state.bearing, range: state.range });
  }

  /**
   * Leaflet measures its container when the map is created. A camera row is
   * built before it is appended to the dialog, so at that moment the canvas
   * has no size and any zoom calculated from it is meaningless. Wait for the
   * element to actually have a size before setting the map up.
   */
  function whenSized(target, run, attempt = 0) {
    if (target.offsetWidth > 0 && target.offsetHeight > 0) return run();
    if (attempt > 90) return run(); // ~1.5s; drawing late beats never drawing
    requestAnimationFrame(() => whenSized(target, run, attempt + 1));
  }

  function build() {
    if (map || !state.position) return;
    prompt.hidden = true;
    canvas.hidden = false;
    whenSized(canvas, create);
  }

  function create() {
    if (map || !state.position) return;

    map = L.map(canvas, {
      zoomControl: true,
      attributionControl: false,
      // Leave the page scroll alone - this map lives inside a scrolling dialog.
      scrollWheelZoom: false,
    });
    addTileLayer(map);

    centreMarker = L.marker([state.position.lat, state.position.lng], {
      interactive: false,
      icon: L.divIcon({
        className: '',
        html: '<div class="aim__centre"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    }).addTo(map);

    map.on('click', (event) => aimAt(event.latlng));
    map.invalidateSize();
    fit();
    redraw();
  }

  function fit() {
    if (!map || !state.position) return;
    const size = map.getSize();
    if (!size.x || !size.y) return; // nothing sensible to fit to yet
    const { lat, lng } = state.position;
    // Show a little beyond the camera's reach so there is context to aim at.
    map.fitBounds(L.latLng(lat, lng).toBounds(Math.max(state.range * 3, 120)));
  }

  if (state.position) build();
  else {
    canvas.hidden = true;
    describe();
  }

  return {
    node,

    /** Called when the numeric inputs change. */
    set({ bearing: b, fov: f, range: r }) {
      const rangeChanged = r != null && r !== state.range;
      if (b !== undefined) state.bearing = b;
      if (f != null) state.fov = f;
      if (r != null) state.range = r;
      redraw();
      if (rangeChanged) fit();
    },

    /** Called when the premises pin is placed or moved. */
    setPosition(next) {
      if (!next || next.lat == null) return;
      state.position = { ...next };
      if (!map) {
        build();
        return;
      }
      centreMarker.setLatLng([next.lat, next.lng]);
      fit();
      redraw();
    },

    invalidate() {
      map?.invalidateSize();
    },
  };
}
