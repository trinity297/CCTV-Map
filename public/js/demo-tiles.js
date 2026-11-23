/**
 * A drawn street map, for demonstrating the app where real map imagery is
 * unavailable — a locked-down machine, no network, or a provider that wants
 * an account.
 *
 * It is a proper Leaflet tile layer whose tiles are drawn on a canvas instead
 * of downloaded, so panning and zooming behave exactly as they would with real
 * mapping. The layout is a deterministic function of position, so the same
 * streets appear in the same places every time and tiles line up seamlessly.
 *
 * It is scenery, not geography: nothing here corresponds to a real place.
 */

const Z0 = 16;        // zoom the layout is defined at
const BLOCK = 72;     // Z0 pixels between minor streets
const MAJOR_EVERY = 4;
const TRUNK_EVERY = 12;

/** Where street number `i` sits, in Z0 pixels. Jittered so blocks vary. */
function streetPos(i) {
  return i * BLOCK + (hash(i, 0, 17) - 0.5) * BLOCK * 0.45;
}

/**
 * Water recurs every WATER_PERIOD blocks, wandering as it goes, so a river is
 * always somewhere nearby wherever the records happen to sit.
 */
const WATER_PERIOD = 46;
function isWater(i, j) {
  const centre = Math.round(22 + Math.sin(i / 9) * 6 + Math.sin(i / 23) * 3);
  return (((j - centre) % WATER_PERIOD) + WATER_PERIOD) % WATER_PERIOD === 0;
}

/** Stable pseudo-random value for a grid cell. */
function hash(a, b, salt = 0) {
  let h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function palette() {
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return dark
    ? {
      land: '#1b2029', park: '#1d2c22', water: '#15283b',
      building: '#272e3a', buildingEdge: '#333c4a',
      minorFill: '#394355', minorCase: '#232a35',
      majorFill: '#4a5467', majorCase: '#2b323e',
      trunkFill: '#6b5a3f', trunkCase: '#3b3326',
      label: '#8d97a6',
    }
    : {
      land: '#efe9e1', park: '#cfe5b8', water: '#a9cbe3',
      building: '#dcd3c6', buildingEdge: '#c9bfae',
      minorFill: '#ffffff', minorCase: '#d6cfc4',
      majorFill: '#fdfbe8', majorCase: '#c9bfa6',
      trunkFill: '#fbd6a2', trunkCase: '#d9a96a',
      label: '#8d8575',
    };
}

const STREETS = [
  'High Street', 'Mill Lane', 'Station Road', 'Church Street', 'Market Place',
  'Victoria Road', 'Queens Road', 'Albert Street', 'Bridge Street', 'Park Road',
  'King Street', 'Union Street', 'Castle Street', 'North Parade', 'The Crescent',
];

function drawTile(ctx, coords, size, p) {
  const scale = 2 ** (coords.z - Z0);   // Z0 pixels -> tile pixels
  const originX = (coords.x * size) / scale;
  const originY = (coords.y * size) / scale;
  const span = size / scale;
  const px = (v, origin) => (v - origin) * scale;

  ctx.fillStyle = p.land;
  ctx.fillRect(0, 0, size, size);

  const blockPx = BLOCK * scale;

  /* --- ground cover and buildings ---------------------------------------
   * Zoomed far out a tile spans millions of blocks, so this is skipped
   * rather than looped over: it would be invisible anyway, and iterating it
   * locks the browser up.
   */
  if (blockPx >= 3) {
    const i0 = Math.floor(originX / BLOCK) - 2;
    const i1 = Math.ceil((originX + span) / BLOCK) + 2;
    const j0 = Math.floor(originY / BLOCK) - 2;
    const j1 = Math.ceil((originY + span) / BLOCK) + 2;
    const showBuildings = blockPx > 24;

    for (let i = i0; i <= i1; i += 1) {
      const x = px(streetPos(i), originX);
      const w = px(streetPos(i + 1), originX) - x;

      for (let j = j0; j <= j1; j += 1) {
        const y = px(streetPos(j), originY);
        const h = px(streetPos(j + 1), originY) - y;

        if (isWater(i, j)) {
          // +1 so neighbouring water blocks merge into one river.
          ctx.fillStyle = p.water;
          ctx.fillRect(x, y, w + 1, h + 1);
          continue;
        }
        if (hash(i >> 1, j >> 1, 5) < 0.06) {   // parks come in clumps
          ctx.fillStyle = p.park;
          ctx.fillRect(x, y, w, h);
          continue;
        }
        if (!showBuildings) continue;

        const inset = Math.min(w, h) * 0.12;
        const count = 2 + Math.floor(hash(i, j, 7) * 3);
        for (let k = 0; k < count; k += 1) {
          const a = hash(i, j, 11 + k);
          const b = hash(i, j, 31 + k);
          const bw = w * (0.2 + a * 0.3);
          const bh = h * (0.2 + b * 0.3);
          const bx = x + inset + a * (w - 2 * inset - bw);
          const by = y + inset + b * (h - 2 * inset - bh);
          ctx.fillStyle = p.building;
          ctx.fillRect(bx, by, bw, bh);
          if (blockPx > 70) {
            ctx.strokeStyle = p.buildingEdge;
            ctx.lineWidth = 1;
            ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
          }
        }
      }
    }
  }

  /* --- streets -----------------------------------------------------------
   * Drawn as a casing pass then a fill pass, which is what makes junctions
   * read as junctions rather than as crossing lines. Each tier steps by its
   * own spacing, so the work is bounded however far out you zoom.
   */
  const tiers = [
    { every: 1, fill: p.minorFill, casing: p.minorCase, w: 7 },
    { every: MAJOR_EVERY, fill: p.majorFill, casing: p.majorCase, w: 15 },
    { every: TRUNK_EVERY, fill: p.trunkFill, casing: p.trunkCase, w: 24 },
  ];

  const strokeTier = (tier, width, colour) => {
    if (width < 0.5) return;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    const step = tier.every * BLOCK;
    const kx0 = Math.floor(originX / step) - 1;
    const kx1 = Math.ceil((originX + span) / step) + 1;
    for (let k = kx0; k <= kx1; k += 1) {
      const x = px(streetPos(k * tier.every), originX);
      ctx.moveTo(x, -2);
      ctx.lineTo(x, size + 2);
    }
    const ky0 = Math.floor(originY / step) - 1;
    const ky1 = Math.ceil((originY + span) / step) + 1;
    for (let k = ky0; k <= ky1; k += 1) {
      const y = px(streetPos(k * tier.every), originY);
      ctx.moveTo(-2, y);
      ctx.lineTo(size + 2, y);
    }
    ctx.stroke();
  };

  const visible = tiers.filter((t) => t.w * scale >= 1 && t.every * blockPx >= 4);
  for (const tier of visible) strokeTier(tier, tier.w * scale + 2, tier.casing);
  for (const tier of visible) strokeTier(tier, tier.w * scale, tier.fill);

  /* --- street names, once there is room ---------------------------------- */
  if (blockPx > 140) {
    ctx.fillStyle = p.label;
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    const step = MAJOR_EVERY * BLOCK;
    const k0 = Math.floor(originY / step) - 1;
    const k1 = Math.ceil((originY + span) / step) + 1;
    for (let k = k0; k <= k1; k += 1) {
      const y = px(streetPos(k * MAJOR_EVERY), originY);
      if (y < 10 || y > size - 10) continue;
      ctx.fillText(STREETS[Math.floor(hash(0, k, 3) * STREETS.length)], 10, y - 1);
    }
  }
}

/**
 * A Leaflet layer that draws its own tiles. Used when the configured map
 * background is the drawn demo one.
 */
export function createDemoTileLayer(options = {}) {
  const DemoLayer = L.GridLayer.extend({
    createTile(coords) {
      const size = this.getTileSize().x;
      const tile = document.createElement('canvas');
      tile.width = size;
      tile.height = size;
      drawTile(tile.getContext('2d'), coords, size, palette());
      return tile;
    },
  });

  const layer = new DemoLayer({
    // There is no world to see: the geography is invented, so zooming out
    // past a town's worth of streets would only show empty ground.
    minZoom: 12,
    maxZoom: options.maxZoom || 21,
    attribution: 'Illustrative map — not real geography',
  });

  // Follow the viewer's light/dark setting like the rest of the app.
  window.matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener?.('change', () => layer.redraw());

  return layer;
}
