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
