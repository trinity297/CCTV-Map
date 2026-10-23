/**
 * Where the map's background imagery comes from.
 *
 * This is deliberately configurable. OpenStreetMap's own tile servers are run
 * on donated hardware for the OSM project's benefit, not as a free backend for
 * other people's applications - they block traffic they cannot attribute to a
 * known app, which is what a browser pointed at 127.0.0.1 looks like. So the
 * default here is a provider that offers its basemaps for general use, and any
 * organisation with a proper mapping licence should point this at that instead.
 */

const YEAR = new Date().getFullYear();

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const PRESETS = {
  'carto-voyager': {
    label: 'CARTO Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 20,
    attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
  },
  'carto-positron': {
    label: 'CARTO Positron (pale)',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 20,
    attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
  },
  'carto-dark': {
    label: 'CARTO Dark Matter',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 20,
    attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
  },

  // Ordnance Survey. UK public sector bodies - policing included - generally
  // have access through the Public Sector Geospatial Agreement, and OS mapping
  // is markedly better than anything else for UK street and address detail.
  // Needs CCTV_MAP_OS_API_KEY from an OS Data Hub project.
  'os-road': {
    label: 'Ordnance Survey Road',
    url: 'https://api.os.uk/maps/raster/v1/zxy/Road_3857/{z}/{x}/{y}.png?key={osKey}',
    maxZoom: 20,
    attribution: `Contains OS data &copy; Crown copyright and database rights ${YEAR}`,
    requiresOsKey: true,
  },
  'os-light': {
    label: 'Ordnance Survey Light',
    url: 'https://api.os.uk/maps/raster/v1/zxy/Light_3857/{z}/{x}/{y}.png?key={osKey}',
    maxZoom: 20,
    attribution: `Contains OS data &copy; Crown copyright and database rights ${YEAR}`,
    requiresOsKey: true,
  },
  'os-outdoor': {
    label: 'Ordnance Survey Outdoor',
    url: 'https://api.os.uk/maps/raster/v1/zxy/Outdoor_3857/{z}/{x}/{y}.png?key={osKey}',
    maxZoom: 20,
    attribution: `Contains OS data &copy; Crown copyright and database rights ${YEAR}`,
    requiresOsKey: true,
  },

  // Only appropriate for genuinely light, personal use - see the note above.
  osm: {
    label: 'OpenStreetMap (volunteer servers)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 19,
    attribution: OSM_ATTRIBUTION,
  },

  // Pins and view cones on a plain background. Always works, needs no network.
  none: {
    label: 'No background map',
    url: '',
    maxZoom: 22,
    attribution: '',
  },
};

export const DEFAULT_PRESET = 'carto-voyager';

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Resolves the tile settings sent to the browser.
 * A custom CCTV_MAP_TILE_URL always wins; otherwise a named preset is used,
 * defaulting to Ordnance Survey when an OS key is present.
 */
export function resolveMapConfig(env = process.env) {
  const osKey = (env.CCTV_MAP_OS_API_KEY || '').trim();
  const customUrl = (env.CCTV_MAP_TILE_URL || '').trim();

  let name = (env.CCTV_MAP_TILES || '').trim().toLowerCase();
  const warnings = [];

  if (name && !PRESETS[name] && !customUrl) {
    warnings.push(
      `CCTV_MAP_TILES="${name}" is not a known preset. Using "${DEFAULT_PRESET}" instead. ` +
      `Known presets: ${Object.keys(PRESETS).join(', ')}.`,
    );
    name = '';
  }
  // An OS key with no explicit choice means they want OS mapping.
  if (!name && !customUrl) name = osKey ? 'os-road' : DEFAULT_PRESET;

  const preset = PRESETS[name] || PRESETS[DEFAULT_PRESET];

  if (preset.requiresOsKey && !osKey) {
    warnings.push(
      `CCTV_MAP_TILES="${name}" needs an Ordnance Survey key. Set CCTV_MAP_OS_API_KEY ` +
      `from your OS Data Hub project, or the map will have no background.`,
    );
  }

  const url = customUrl || preset.url.replace('{osKey}', encodeURIComponent(osKey));

  return {
    name: customUrl ? 'custom' : name,
    label: customUrl ? 'Custom tile source' : preset.label,
    url: preset.requiresOsKey && !osKey && !customUrl ? '' : url,
    attribution: env.CCTV_MAP_TILE_ATTRIBUTION ?? preset.attribution,
    maxZoom: num(env.CCTV_MAP_TILE_MAX_ZOOM, preset.maxZoom),
    subdomains: env.CCTV_MAP_TILE_SUBDOMAINS || preset.subdomains || 'abc',
    warnings,
  };
}
