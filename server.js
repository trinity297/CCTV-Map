import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { openDatabase } from './src/db.js';
import { createAuth } from './src/auth.js';
import { createRequestHandler } from './src/app.js';
import { resolveMapConfig } from './src/map-config.js';

const here = dirname(fileURLToPath(import.meta.url));

// Settings can live in a `.env` file next to this one, so they do not have to
// be retyped on every start. Real environment variables still win over it, and
// `.env` is git-ignored so keys never reach the repository.
try {
  process.loadEnvFile(join(here, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error(`\n  Could not read ${join(here, '.env')}: ${err.message}\n`);
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const DB_FILE = resolve(process.env.CCTV_MAP_DB || join(here, 'data', 'cctv-map.db'));

const db = openDatabase(DB_FILE);
const auth = createAuth({
  passcode: process.env.CCTV_MAP_PASSCODE,
  secret: process.env.CCTV_MAP_SECRET,
});

const mapConfig = resolveMapConfig();

const server = createServer(createRequestHandler({ db, auth, mapConfig }));

server.listen(PORT, HOST, () => {
  const openness = auth.enabled
    ? 'passcode required'
    : 'NO PASSCODE - anyone who can reach this port has full access';
  console.log('');
  console.log('  CCTV Map');
  console.log('  ------------------------------------------------------------');
  console.log(`  Open in a browser:  http://${HOST}:${PORT}`);
  console.log(`  Database file:      ${DB_FILE}`);
  console.log(`  Access:             ${openness}`);
  console.log(`  Map background:     ${mapConfig.label}`);
  console.log('');
  for (const warning of mapConfig.warnings) {
    console.log(`  ! ${warning}`);
    console.log('');
  }
  console.log('  Press Ctrl+C to stop.');
  console.log('');
});

const shutdown = () => {
  server.close(() => {
    try { db.close(); } catch { /* already closed */ }
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
