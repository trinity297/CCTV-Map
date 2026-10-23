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
if (!config.url && config.name !== 'none') {
  fail('no tile URL resolved, so the map will have no background',
    'Set CCTV_MAP_OS_API_KEY, or pick a preset: ' + Object.keys(PRESETS).join(', '));
}

/* ------------------------------------------------- 5. live tile test --- */
if (config.url) {
  console.log('\nFetching one real map tile');
  // Zoom 12 over central Manchester: somewhere guaranteed to have imagery.
  const url = config.url
    .replace('{z}', '12').replace('{x}', '2017').replace('{y}', '1324')
    .replace('{s}', 'a').replace('{r}', '');
  const shown = url.replace(/key=[^&]+/, 'key=<hidden>');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const type = res.headers.get('content-type') || '';
    if (res.ok && type.startsWith('image/')) {
      tick(`tile server responded ${res.status}, ${type} — this is working`);
    } else if (res.status === 401 || res.status === 403) {
      fail(`tile server rejected the key (${res.status})`,
        'Check the key is right, and that any referer/IP restriction on it in the ' +
        'OS Data Hub allows this machine');
    } else if (res.status === 404) {
      fail('tile server returned 404 — that map style was not found',
        'In the OS Data Hub, confirm your project has the *OS Maps API* added. ' +
        'OS NGD API – Tiles and OS Vector Tile API serve vector tiles, which this app cannot draw');
    } else if (res.status === 429) {
      fail('rate limited (429)', 'You have hit the plan limit — check your Data Hub plan');
    } else {
      fail(`unexpected response ${res.status} (${type || 'no content type'})`, `Tried: ${shown}`);
    }
  } catch (err) {
    fail(`could not reach the tile server: ${err.message}`,
      'Check this machine can reach the internet, and whether a proxy or firewall ' +
      'is blocking it. The app still works without a background map — set ' +
      'CCTV_MAP_TILES=none to stop trying');
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
