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

// maxNativeZoom is the deepest zoom a provider actually has images for.
// maxZoom is how far the map will let you go: past maxNativeZoom, Leaflet
// scales the last real tile up rather than requesting one that does not
// exist. Without this, the final zoom level asks for missing tiles and the
// map looks broken exactly when you are trying to look closely at a doorway.

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const PRESETS = {
  'carto-voyager': {
    label: 'CARTO Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 21,
    maxNativeZoom: 19,
    keyEnv: 'CCTV_MAP_CARTO_API_KEY',
    keyParam: 'api_key',
    attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
  },
  'carto-positron': {
    label: 'CARTO Positron (pale)',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 21,
    maxNativeZoom: 19,
    keyEnv: 'CCTV_MAP_CARTO_API_KEY',
    keyParam: 'api_key',
    attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
  },
  'carto-dark': {
    label: 'CARTO Dark Matter',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    maxZoom: 21,
    maxNativeZoom: 19,
    keyEnv: 'CCTV_MAP_CARTO_API_KEY',
    keyParam: 'api_key',
    attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
  },

  // Ordnance Survey. UK public sector bodies - policing included - generally
  // have access through the Public Sector Geospatial Agreement, and OS mapping
  // is markedly better than anything else for UK street and address detail.
  // Needs CCTV_MAP_OS_API_KEY from an OS Data Hub project.
  'os-road': {
    label: 'Ordnance Survey Road',
    url: 'https://api.os.uk/maps/raster/v1/zxy/Road_3857/{z}/{x}/{y}.png?key={osKey}',
    maxZoom: 21,
    maxNativeZoom: 19,
    attribution: `Contains OS data &copy; Crown copyright and database rights ${YEAR}`,
    requiresOsKey: true,
  },
  'os-light': {
    label: 'Ordnance Survey Light',
    url: 'https://api.os.uk/maps/raster/v1/zxy/Light_3857/{z}/{x}/{y}.png?key={osKey}',
    maxZoom: 21,
    maxNativeZoom: 19,
    attribution: `Contains OS data &copy; Crown copyright and database rights ${YEAR}`,
    requiresOsKey: true,
  },
  'os-outdoor': {
    label: 'Ordnance Survey Outdoor',
    url: 'https://api.os.uk/maps/raster/v1/zxy/Outdoor_3857/{z}/{x}/{y}.png?key={osKey}',
    maxZoom: 21,
    maxNativeZoom: 19,
    attribution: `Contains OS data &copy; Crown copyright and database rights ${YEAR}`,
    requiresOsKey: true,
  },

  // Esri's public basemap endpoint, which needs no account. Attribution is
  // required; check Esri's terms before relying on it for organisational use.
  'esri-street': {
    label: 'Esri World Street Map',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 21,
    maxNativeZoom: 19,
    attribution: 'Tiles &copy; <a href="https://www.esri.com">Esri</a>',
  },
  'esri-imagery': {
    label: 'Esri World Imagery (aerial)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 21,
    maxNativeZoom: 18,
    attribution: 'Tiles &copy; <a href="https://www.esri.com">Esri</a>',
  },

  // Only appropriate for genuinely light, personal use - see the note above.
  osm: {
    label: 'OpenStreetMap (volunteer servers)',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxZoom: 21,
    maxNativeZoom: 19,
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

const num = (value, fallback, { name, warnings } = {}) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  // Silently ignoring a setting someone deliberately typed is how an hour
  // gets lost wondering why it had no effect.
  warnings?.push(`${name}="${value}" is not a positive number — ignoring it.`);
  return fallback;
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

  let url = customUrl || preset.url.replace('{osKey}', encodeURIComponent(osKey));

  // Some providers take a key as a query parameter rather than in the path.
  // If the parameter name turns out to be wrong for your account, set
  // CCTV_MAP_TILE_URL to the exact template the provider gave you instead.
  const providerKey = preset.keyEnv ? (env[preset.keyEnv] || '').trim() : '';
  if (!customUrl && providerKey && preset.keyParam) {
    const join = url.includes('?') ? '&' : '?';
    url += `${join}${preset.keyParam}=${encodeURIComponent(providerKey)}`;
  }

  const maxNativeZoom = num(env.CCTV_MAP_TILE_MAX_NATIVE_ZOOM, preset.maxNativeZoom ?? null,
    { name: 'CCTV_MAP_TILE_MAX_NATIVE_ZOOM', warnings });
  // Never let the map stop short of the imagery that exists.
  const askedMaxZoom = num(env.CCTV_MAP_TILE_MAX_ZOOM, preset.maxZoom,
    { name: 'CCTV_MAP_TILE_MAX_ZOOM', warnings });
  const maxZoom = Math.max(askedMaxZoom, maxNativeZoom || 0);
  if (env.CCTV_MAP_TILE_MAX_ZOOM && maxZoom !== askedMaxZoom) {
    warnings.push(
      `CCTV_MAP_TILE_MAX_ZOOM=${askedMaxZoom} was raised to ${maxZoom} because imagery ` +
      `is requested to zoom ${maxNativeZoom}. If you meant "the provider has no imagery ` +
      `past zoom ${askedMaxZoom}", that is CCTV_MAP_TILE_MAX_NATIVE_ZOOM, not this.`,
    );
  }

  // Which settings the operator actually supplied, so a diagnostic can say
  // whether a line in .env took effect or is still commented out.
  const supplied = Object.fromEntries(
    ['CCTV_MAP_TILES', 'CCTV_MAP_TILE_URL', 'CCTV_MAP_TILE_MAX_ZOOM',
     'CCTV_MAP_TILE_MAX_NATIVE_ZOOM', 'CCTV_MAP_OS_API_KEY', 'CCTV_MAP_CARTO_API_KEY']
      .map((k) => [k, env[k] !== undefined && env[k] !== '']),
  );

  return {
    name: customUrl ? 'custom' : name,
    label: customUrl ? 'Custom tile source' : preset.label,
    url: preset.requiresOsKey && !osKey && !customUrl ? '' : url,
    attribution: env.CCTV_MAP_TILE_ATTRIBUTION ?? preset.attribution,
    maxZoom,
    maxNativeZoom,
    subdomains: env.CCTV_MAP_TILE_SUBDOMAINS || preset.subdomains || 'abc',
    supplied,
    warnings,
  };
}
