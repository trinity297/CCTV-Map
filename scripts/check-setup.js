/**
 * Checks that the app is configured correctly, without ever printing a key.
 *
 *   npm run check
 *
 * Run it on the machine the app runs on. It reads .env exactly as the server
 * does, then - if an Ordnance Survey key is configured - asks OS for one real
 * tile to prove the key actually works.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMapConfig, PRESETS } from '../src/map-config.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const envPath = join(root, '.env');

const tick = (m) => console.log(`  ✓ ${m}`);
const cross = (m) => console.log(`  ✗ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const problems = [];
const fail = (m, fix) => { problems.push({ m, fix }); cross(m); };

console.log('\nCCTV Map — setup check');
console.log('='.repeat(62));

/* ---------------------------------------------------------- 1. node ---- */
console.log('\nNode');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 22 || (major === 22 && minor >= 13)) tick(`version ${process.versions.node}`);
else fail(`Node ${process.versions.node} is too old`, 'Install Node 22.13 or newer from nodejs.org');

/* ----------------------------------------------------------- 2. .env --- */
console.log('\nSettings file');
if (existsSync(envPath)) {
  tick(`found ${envPath}`);
  try {
    process.loadEnvFile(envPath);
    tick('read successfully');
  } catch (err) {
    fail(`could not be read: ${err.message}`, 'Check the file is plain text, one NAME=value per line');
  }
} else {
  warn(`no .env file at ${envPath}`);
  // The classic Windows mistake: Notepad silently appends .txt
  const lookalikes = readdirSync(root).filter(
    (f) => f !== '.env' && f !== '.env.example' && f.toLowerCase().startsWith('.env'),
  );
  for (const f of lookalikes) {
    fail(`found "${f}" instead of ".env"`,
      `Rename "${f}" to exactly ".env". In Windows Explorer turn on ` +
      '"File name extensions" first, or in a terminal: ren "' + f + '" .env');
  }
  if (!lookalikes.length) {
    warn('That is fine if you meant to use the default map. To use Ordnance Survey:');
    warn('  cp .env.example .env     then put your key in it');
  }
}

/* ------------------------------------------------------- 3. the key ---- */
console.log('\nOrdnance Survey key');
const key = (process.env.CCTV_MAP_OS_API_KEY || '').trim();
if (!key) {
  warn('CCTV_MAP_OS_API_KEY is not set — the map will use the default background');
} else {
  tick(`set — ${key.length} characters`); // length only, never the value
  if (!/^[A-Za-z0-9_-]+$/.test(key)) {
    fail('the key contains unexpected characters',
      'Re-copy it from the OS Data Hub. Stray quotes, spaces or a line break break it');
  }
  if (key.length < 20) {
    warn(`only ${key.length} characters — OS project keys are longer than this.`);
    warn('  Have you pasted the project *secret* instead of the project *API key*?');
  }
}

/* ---------------------------------------------------- 4. resolved map -- */
console.log('\nMap background');
const config = resolveMapConfig();
tick(`using: ${config.label}`);
for (const w of config.warnings) warn(w);
if (config.url) {
  // Redact before printing - the key lives in this URL.
  console.log(`    ${config.url.replace(/key=[^&]+/, 'key=<hidden>')}`);
}
// Say where each value came from, so a line still commented out in .env is
// obvious rather than looking like the setting simply did not work.
const source = (name) => (config.supplied[name] ? 'from your settings' : 'default — not set by you');
console.log(`    max zoom ${config.maxZoom} · imagery to zoom ${config.maxNativeZoom}` +
  ` (${source('CCTV_MAP_TILE_MAX_NATIVE_ZOOM')})`);
if (!config.supplied.CCTV_MAP_TILE_MAX_NATIVE_ZOOM) {
  warn('CCTV_MAP_TILE_MAX_NATIVE_ZOOM is not taking effect.');
  warn('  If you edited that line in .env, check it does not still start with "#".');
}
if (!config.url && config.name !== 'none') {
  fail('no tile URL resolved, so the map will have no background',
    'Set CCTV_MAP_OS_API_KEY, or pick a preset: ' + Object.keys(PRESETS).join(', '));
}

/* ------------------------------------------------- 5. live tile test --- */
/** Slippy-map tile covering a lat/lng at a zoom level. */
function tileFor(lat, lng, z) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
}

const tileUrl = (z) => {
  const { x, y } = tileFor(53.4808, -2.2426, z); // central Manchester
  return config.url
    .replace('{z}', z).replace('{x}', x).replace('{y}', y)
    .replace('{s}', 'a').replace('{r}', '');
};

async function fetchTile(z) {
  try {
    const res = await fetch(tileUrl(z), { signal: AbortSignal.timeout(15000) });
    const type = res.headers.get('content-type') || '';
    return { ok: res.ok && type.startsWith('image/'), status: res.status, type };
  } catch (err) {
    return { ok: false, status: 0, type: '', error: err.message };
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Walks zoom levels to find the deepest one with real imagery.
 * Only a 404 means "no tile here". Anything else - a rate limit, an auth
 * problem, a timeout - is inconclusive, and must not be mistaken for the
 * provider's limit, or we would tell people to cripple a working map.
 */
async function findDeepestZoom(from) {
  let deepest = from;
  for (const z of [16, 17, 18, 19, 20, 21, 22]) {
    await pause(350); // do not trip the provider's rate limit
    let result = await fetchTile(z);
    if (!result.ok && result.status !== 404) {
      await pause(1500);
      result = await fetchTile(z); // one retry before believing a failure
    }
    if (result.ok) {
      deepest = z;
      continue;
    }
    if (result.status === 404) return { deepest, conclusive: true };
    return { deepest, conclusive: false, status: result.status, error: result.error, z };
  }
  return { deepest, conclusive: true };
}

if (config.url) {
  console.log('\nFetching real map tiles');
  const base = await fetchTile(14);
  if (base.ok) {
    tick(`tile server responded ${base.status}, ${base.type} — this is working`);
  } else if (base.status === 401 || base.status === 403) {
    fail(`tile server rejected the key (${base.status})`,
      'Check the key is right, and that any referer/IP restriction on it in the ' +
      'OS Data Hub allows this machine');
  } else if (base.status === 404) {
    fail('tile server returned 404 — that map style was not found',
      'In the OS Data Hub, confirm your project has the *OS Maps API* added. ' +
      'OS NGD API – Tiles and OS Vector Tile API serve vector tiles, which this app cannot draw');
  } else if (base.status === 429) {
    fail('rate limited (429)', 'You have hit the plan limit — check your Data Hub plan');
  } else if (base.status === 0) {
    fail(`could not reach the tile server: ${base.error}`,
      'Check this machine can reach the internet, and whether a proxy or firewall ' +
      'is blocking it. The app still works without a background map — set ' +
      'CCTV_MAP_TILES=none to stop trying');
  } else {
    fail(`unexpected response ${base.status} (${base.type || 'no content type'})`,
      `Tried: ${tileUrl(14).replace(/key=[^&]+/, 'key=<hidden>')}`);
  }

  // How far in does this provider actually have imagery? Asking for a zoom
  // it does not have is what makes the map look broken when you zoom right in.
  if (base.ok) {
    const probe = await findDeepestZoom(14);
    const configured = config.maxNativeZoom;

    if (!probe.conclusive) {
      warn(`could not establish the zoom limit: zoom ${probe.z} returned ` +
        `${probe.status || probe.error}, which is not "no imagery here".`);
      warn(`  Imagery confirmed to at least zoom ${probe.deepest}. If that status was a`);
      warn('  rate limit, wait a minute and run this again before changing anything.');
    } else {
      console.log(`    deepest zoom with real imagery: ${probe.deepest}`);
      if (configured > probe.deepest) {
        fail(`configured to request zoom ${configured}, but imagery stops at ${probe.deepest}`,
          'This is what makes the map fail when you zoom right in. Put ' +
          `CCTV_MAP_TILE_MAX_NATIVE_ZOOM=${probe.deepest} in your .env — as a real line, ` +
          'not one starting with "#"');
      } else if (configured < probe.deepest) {
        warn(`imagery goes to zoom ${probe.deepest} but only ${configured} is requested — ` +
          `set CCTV_MAP_TILE_MAX_NATIVE_ZOOM=${probe.deepest} for a sharper map close in`);
      } else {
        tick(`zoom settings match the imagery available (native max ${probe.deepest})`);
      }
    }
  }
}

/* ---------------------------------------------------------- 6. data ---- */
console.log('\nDatabase');
const dbFile = resolve(process.env.CCTV_MAP_DB || join(root, 'data', 'cctv-map.db'));
console.log(`    ${dbFile}`);
tick(existsSync(dbFile) ? 'exists' : 'does not exist yet — it is created on first run');

/* --------------------------------------------------------- verdict ----- */
console.log(`\n${'='.repeat(62)}`);
if (!problems.length) {
  console.log('\nAll good. Start the app with:  node server.js\n');
} else {
  console.log(`\n${problems.length} thing${problems.length === 1 ? '' : 's'} to fix:\n`);
  problems.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.m}`);
    console.log(`     ${p.fix}\n`);
  });
  process.exitCode = 1;
}
