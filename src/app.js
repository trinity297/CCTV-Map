import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApi } from './api.js';
import { serveStatic, sendText } from './http.js';
import { resolveMapConfig } from './map-config.js';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** Builds the single request handler used by both the server and the tests. */
export function createRequestHandler({
  db,
  auth,
  mapConfig = resolveMapConfig(),
  publicDir = PUBLIC_DIR,
}) {
  const api = createApi({ db, auth, mapConfig });

  return async function handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (url.pathname.startsWith('/api/')) {
      await api(req, res, url);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method not allowed');
      return;
    }

    if (await serveStatic(publicDir, url.pathname, res)) return;
    // Unknown path: hand back the shell so client-side routing keeps working.
    if (await serveStatic(publicDir, '/index.html', res)) return;
    sendText(res, 404, 'Not found');
  };
}
