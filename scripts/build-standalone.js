/**
 * Builds a single self-contained HTML file: the whole app, no server, no
 * database, no install. For showing the idea to colleagues on a machine where
 * you cannot run anything.
 *
 *   npm run build:standalone
 *
 * Everything is inlined — Leaflet, the styles, every module and the example
 * records — and the server API is swapped for demo-store.js, which keeps
 * records in the browser's own storage. Every other module is used unchanged,
 * so the demo cannot drift from the real app.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMapConfig } from '../src/map-config.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');

/**
 * Modules in dependency order. They are concatenated into one module script,
 * which works because every import between them is a plain named import.
 */
const MODULES = [
  ['public/js/geo-core.js', 'geo-core.js'],
  ['public/js/record-core.js', 'record-core.js'],
  ['public/js/util.js', 'util.js'],
  ['src/csv.js', 'csv.js'],
  ['public/js/demo-store.js', 'demo-store.js'],
  ['public/js/map.js', 'map.js'],
  ['public/js/aim.js', 'aim.js'],
  ['public/js/detail.js', 'detail.js'],
  ['public/js/list.js', 'list.js'],
  ['public/js/form.js', 'form.js'],
  ['public/js/coverage.js', 'coverage.js'],
  ['public/js/app.js', 'app.js'],
];

/** Strips the module syntax so the files can share one scope. */
function flatten(source, name) {
  if (/^export\s+\*\s+from/m.test(source)) {
    throw new Error(`${name} is a re-export shim, not an implementation — point the build at the real file.`);
  }
  return source
    // import ... from './x.js';  (including multi-line braces)
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    // import './x.js';
    .replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '')
    // export { a, b };  — the names are already in scope
    .replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    // export const/function/class ...
    .replace(/^export\s+(?=(const|let|var|function|class|async))/gm, '')
    .trim();
}

/** Fails loudly if two modules declare the same top-level name. */
function assertNoCollisions(parts) {
  const seen = new Map();
  const clashes = [];
  for (const { name, code } of parts) {
    const names = [...code.matchAll(/^(?:const|let|var|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm)]
      .map((m) => m[1]);
    for (const n of names) {
      if (seen.has(n)) clashes.push(`${n} (${seen.get(n)} and ${name})`);
      else seen.set(n, name);
    }
  }
  if (clashes.length) {
    throw new Error(
      'Top-level names collide once the modules share a scope:\n  ' + clashes.join('\n  ') +
      '\nRename one of each pair, or the standalone build will behave differently from the app.',
    );
  }
}

/* ----------------------------------------------------------- the pieces */

const parts = MODULES.map(([path, name]) => ({ name, code: flatten(read(path), name) }));
assertNoCollisions(parts);

// The app reaches for `api` from api.js; here it comes from demo-store.js.
// getActor/setActor live in api.js too, so they are provided alongside.
const shim = `
/* --- standalone shims ------------------------------------------------- */
const ACTOR_KEY = 'cctvmap.actor';
function getActor() {
  try { return localStorage.getItem(ACTOR_KEY) || ''; } catch { return ''; }
}
function setActor(value) {
  try { localStorage.setItem(ACTOR_KEY, value || ''); } catch { /* ignore */ }
}
class ApiError extends Error {
  constructor(message, { status, fields } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields || null;
  }
}
/** The form expects ApiError-shaped failures; ValidationError carries fields. */
function asApiError(error) {
  return error instanceof ValidationError
    ? new ApiError('Some details need fixing.', { status: 422, fields: error.fields })
    : error;
}
function buildQuery() { return new URLSearchParams(); }
`;

// Seed records, taken from the same source the server demo uses.
const seedSource = read('scripts/seed.js');
// Take the whole block, not just the array literal: it relies on a local
// helper for the dates, and slicing the array alone left that behind.
const seedStart = seedSource.indexOf('const day =');
const seedEnd = seedSource.indexOf('\nconst existing');
if (seedStart < 0 || seedEnd < 0) {
  throw new Error('scripts/seed.js no longer has the shape this build expects.');
}
const seedBlock = seedSource.slice(seedStart, seedEnd).trim();
if (!seedBlock.includes('const examples = [')) {
  throw new Error('Could not find the example records in scripts/seed.js.');
}

const mapConfig = resolveMapConfig({ CCTV_MAP_TILES: process.env.CCTV_MAP_TILES || '' });

const bootstrap = `
/* --- standalone bootstrap --------------------------------------------- */
const DEMO_SEED = (() => {
${seedBlock}
  return examples;
})();
window.__cctvDemoMap = ${JSON.stringify({
  url: mapConfig.url,
  attribution: mapConfig.attribution,
  maxZoom: mapConfig.maxZoom,
  maxNativeZoom: mapConfig.maxNativeZoom,
  subdomains: mapConfig.subdomains,
  label: mapConfig.label,
})};
seedIfEmpty(DEMO_SEED.map((e) => ({ ...e, operation: 'DEMO' })));

/* Export and import, without a server: build the file in the browser. */
(() => {
  const download = (name, text, type) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const stamp = () => new Date().toISOString().slice(0, 10);

  const csvLink = document.getElementById('export-csv');
  const jsonLink = document.getElementById('export-json');

  csvLink?.addEventListener('click', (event) => {
    event.preventDefault();
    download(\`cctv-log-\${stamp()}.csv\`, toCsv(allRecords()), 'text/csv;charset=utf-8');
  });
  jsonLink?.addEventListener('click', (event) => {
    event.preventDefault();
    download(\`cctv-log-\${stamp()}.json\`,
      JSON.stringify({ exported_at: new Date().toISOString(), records: allRecords() }, null, 2),
      'application/json');
  });

  // Let someone load a colleague's export, so a demo can use real-ish data.
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = '.json,application/json';
  picker.hidden = true;
  document.body.append(picker);

  const importLink = document.createElement('a');
  importLink.href = '#';
  importLink.textContent = 'Import';
  importLink.title = 'Load records from a JSON export (replaces what is here)';
  importLink.addEventListener('click', (event) => { event.preventDefault(); picker.click(); });
  jsonLink?.after(importLink);

  picker.addEventListener('change', async () => {
    const file = picker.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed.records;
      if (!Array.isArray(incoming)) throw new Error('No records found in that file.');
      if (!confirm(\`Replace the \${allRecords().length} record(s) here with \${incoming.length} from the file?\`)) return;
      replaceAll(incoming);
      location.reload();
    } catch (error) {
      alert(\`Could not read that file: \${error.message}\`);
    } finally {
      picker.value = '';
    }
  });
})();

/* The demo notice: dismissible, and it stays dismissed. */
(() => {
  const note = document.getElementById('demo-note');
  if (!note) return;
  const DISMISSED = 'cctvmap.demo.noteDismissed';
  const hide = () => { note.hidden = true; document.body.classList.remove('has-demo-note'); };
  let dismissed = false;
  try { dismissed = localStorage.getItem(DISMISSED) === '1'; } catch { /* ignore */ }
  if (dismissed) { hide(); return; }
  document.body.classList.add('has-demo-note');
  note.querySelector('.demo-note__close').addEventListener('click', () => {
    hide();
    try { localStorage.setItem(DISMISSED, '1'); } catch { /* ignore */ }
  });
})();
`;

// app.js starts the app as soon as it is evaluated, so the seed and the map
// settings have to be in place before it appears in the bundle.
const appIndex = parts.findIndex((p) => p.name === 'app.js');
if (appIndex < 0) throw new Error('app.js is missing from the module list.');

const script = [
  '/* CCTV Map — standalone demo build. Generated by scripts/build-standalone.js.',
  '   Records are kept in this browser only. Nothing is sent anywhere. */',
  shim,
  ...parts.slice(0, appIndex).map((p) => `\n/* --- ${p.name} --- */\n${p.code}`),
  bootstrap,
  ...parts.slice(appIndex).map((p) => `\n/* --- ${p.name} --- */\n${p.code}`),
].join('\n');

/* --------------------------------------------------------------- output */

let html = read('public/index.html');

/**
 * Replace a placeholder with a block of code.
 *
 * The replacement MUST go through a function. With a plain string,
 * String.replace treats $$, $&, $` and $' inside it as substitution patterns,
 * so any code containing them is silently corrupted - which turned util.js's
 * $$ helper into $ and stopped the whole build booting.
 */
function inline(haystack, marker, replacement) {
  if (!haystack.includes(marker)) {
    throw new Error(`index.html no longer contains ${marker} — the build needs updating.`);
  }
  return haystack.replace(marker, () => replacement);
}

const leafletCss = read('public/vendor/leaflet/leaflet.css');
const appCss = read('public/css/app.css');
const leafletJs = read('public/vendor/leaflet/leaflet.js');

html = inline(html, '<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">',
  `<style>\n${leafletCss}\n</style>`);
html = inline(html, '<link rel="stylesheet" href="/css/app.css">',
  `<style>\n${appCss}\n</style>`);
html = inline(html, '<script src="/vendor/leaflet/leaflet.js"></script>',
  `<script>\n${leafletJs}\n</script>`);
html = inline(html, '<script type="module" src="/js/app.js"></script>',
  `<script type="module">\n${script}\n</script>`);

// Prove nothing was mangled on the way in.
for (const [label, chunk] of [['Leaflet CSS', leafletCss], ['app CSS', appCss],
  ['Leaflet', leafletJs], ['app script', script]]) {
  if (!html.includes(chunk)) {
    throw new Error(`${label} was altered while being inlined — refusing to write a corrupt file.`);
  }
}

// Leaflet asks for marker images relative to the page; this build uses none.
html = inline(html, '<body>', '<body>\n' + DEMO_BANNER());

function DEMO_BANNER() {
  return `<div class="demo-note" id="demo-note">
  <strong>Demo build.</strong> Everything you add is stored in this browser only —
  nothing is sent anywhere, and closing the tab keeps it. Use
  <strong>JSON</strong> above the list to take your records with you.
  <button type="button" class="demo-note__close" aria-label="Hide this notice">&times;</button>
</div>`;
}

const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'cctv-map-demo.html');
writeFileSync(outFile, html);

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`\nBuilt ${outFile}`);
console.log(`  ${kb} KB, one file, no dependencies`);
console.log(`  map background: ${mapConfig.label}`);
console.log('\nOpen it by double-clicking, or send it to someone who can.\n');
