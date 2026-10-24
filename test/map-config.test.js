import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMapConfig, PRESETS, DEFAULT_PRESET } from '../src/map-config.js';

test('defaults to a provider that permits application use', () => {
  const config = resolveMapConfig({});
  assert.equal(config.name, DEFAULT_PRESET);
  assert.ok(config.url.startsWith('https://'));
  assert.ok(config.attribution.includes('OpenStreetMap'), 'OSM data still needs crediting');
  assert.deepEqual(config.warnings, []);
});

test('does not point at OpenStreetMap volunteer servers by default', () => {
  // They block application traffic; using them as a default is what broke.
  assert.ok(!resolveMapConfig({}).url.includes('tile.openstreetmap.org'));
});

test('an Ordnance Survey key switches to OS mapping and is substituted in', () => {
  const config = resolveMapConfig({ CCTV_MAP_OS_API_KEY: 'secret key/value' });
  assert.equal(config.name, 'os-road');
  assert.ok(config.url.includes('api.os.uk'));
  assert.ok(config.url.includes(encodeURIComponent('secret key/value')), 'key must be URL encoded');
  assert.ok(config.attribution.includes('Crown copyright'));
});

test('asking for OS without a key warns instead of serving a broken URL', () => {
  const config = resolveMapConfig({ CCTV_MAP_TILES: 'os-light' });
  assert.equal(config.url, '');
  assert.equal(config.warnings.length, 1);
  assert.match(config.warnings[0], /CCTV_MAP_OS_API_KEY/);
});

test('an explicit preset is honoured', () => {
  assert.equal(resolveMapConfig({ CCTV_MAP_TILES: 'osm' }).url,
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(resolveMapConfig({ CCTV_MAP_TILES: 'CARTO-DARK' }).name, 'carto-dark');
});

test('"none" yields no tile layer but stays a valid config', () => {
  const config = resolveMapConfig({ CCTV_MAP_TILES: 'none' });
  assert.equal(config.url, '');
  assert.deepEqual(config.warnings, []);
});

test('an unknown preset falls back and says so', () => {
  const config = resolveMapConfig({ CCTV_MAP_TILES: 'not-a-preset' });
  assert.equal(config.name, DEFAULT_PRESET);
  assert.match(config.warnings[0], /not a known preset/);
});

test('a custom URL overrides everything, including a preset name', () => {
  const config = resolveMapConfig({
    CCTV_MAP_TILES: 'osm',
    CCTV_MAP_TILE_URL: 'https://tiles.internal.example/{z}/{x}/{y}.png',
    CCTV_MAP_TILE_ATTRIBUTION: 'Force GIS team',
    CCTV_MAP_TILE_MAX_ZOOM: '21',
  });
  assert.equal(config.name, 'custom');
  assert.equal(config.url, 'https://tiles.internal.example/{z}/{x}/{y}.png');
  assert.equal(config.attribution, 'Force GIS team');
  assert.equal(config.maxZoom, 21);
});

test('a bad max zoom falls back to the preset value', () => {
  assert.equal(resolveMapConfig({ CCTV_MAP_TILE_MAX_ZOOM: 'nonsense' }).maxZoom,
    PRESETS[DEFAULT_PRESET].maxZoom);
});

test('every preset is well formed', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    assert.ok(preset.label, `${name} needs a label`);
    assert.equal(typeof preset.url, 'string', `${name} needs a url`);
    assert.ok(preset.maxZoom > 0, `${name} needs a max zoom`);
    if (preset.url && !preset.requiresOsKey) {
      assert.ok(preset.attribution, `${name} must carry attribution`);
    }
  }
});

test('every preset declares the deepest zoom it really has imagery for', () => {
  // Requesting a zoom the provider lacks makes the map go blank exactly when
  // you zoom in to look at a doorway - the thing this app is for.
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (!preset.url) continue;
    assert.ok(preset.maxNativeZoom > 0, `${name} must declare maxNativeZoom`);
    assert.ok(preset.maxZoom >= preset.maxNativeZoom,
      `${name} must let the map reach the imagery it has`);
  }
});

test('the map may zoom past the imagery, so Leaflet upscales instead of 404ing', () => {
  const config = resolveMapConfig({});
  assert.ok(config.maxZoom > config.maxNativeZoom);
});

test('native zoom can be corrected for a provider without touching code', () => {
  const config = resolveMapConfig({ CCTV_MAP_TILE_MAX_NATIVE_ZOOM: '17' });
  assert.equal(config.maxNativeZoom, 17);
});

test('max zoom is never left below the imagery that exists', () => {
  const config = resolveMapConfig({
    CCTV_MAP_TILE_MAX_ZOOM: '12',
    CCTV_MAP_TILE_MAX_NATIVE_ZOOM: '20',
  });
  assert.equal(config.maxZoom, 20, 'otherwise real imagery would be unreachable');
});

test('a custom tile url still gets a native zoom so it is not left unbounded', () => {
  const config = resolveMapConfig({ CCTV_MAP_TILE_URL: 'https://x/{z}/{x}/{y}.png' });
  assert.ok(config.maxNativeZoom > 0);
});

test('settings report whether the operator actually supplied them', () => {
  // A line left commented out in .env must be distinguishable from one that
  // worked, or there is no way to tell why a setting had no effect.
  assert.equal(resolveMapConfig({}).supplied.CCTV_MAP_TILE_MAX_NATIVE_ZOOM, false);
  assert.equal(
    resolveMapConfig({ CCTV_MAP_TILE_MAX_NATIVE_ZOOM: '16' }).supplied.CCTV_MAP_TILE_MAX_NATIVE_ZOOM,
    true,
  );
  assert.equal(resolveMapConfig({ CCTV_MAP_TILE_MAX_NATIVE_ZOOM: '' }).supplied.CCTV_MAP_TILE_MAX_NATIVE_ZOOM, false);
});

test('a malformed numeric setting warns instead of being silently dropped', () => {
  const config = resolveMapConfig({ CCTV_MAP_TILE_MAX_NATIVE_ZOOM: '16 # inline comment' });
  assert.equal(config.maxNativeZoom, 19, 'falls back to the preset');
  assert.match(config.warnings.join(' '), /not a positive number/);
});

test('a negative or zero zoom is rejected', () => {
  assert.match(resolveMapConfig({ CCTV_MAP_TILE_MAX_ZOOM: '-3' }).warnings.join(' '), /not a positive number/);
});

test('setting max zoom when native zoom was meant is explained, not swallowed', () => {
  // Capping the map below the imagery it requests does nothing, because the
  // cap is raised back up. Saying so beats leaving someone to wonder.
  const config = resolveMapConfig({ CCTV_MAP_TILE_MAX_ZOOM: '16' });
  assert.equal(config.maxZoom, 19);
  assert.match(config.warnings.join(' '), /CCTV_MAP_TILE_MAX_NATIVE_ZOOM, not this/);
});

test('a max zoom above the imagery is left alone and not warned about', () => {
  const config = resolveMapConfig({ CCTV_MAP_TILE_MAX_ZOOM: '22' });
  assert.equal(config.maxZoom, 22);
  assert.deepEqual(config.warnings, []);
});
