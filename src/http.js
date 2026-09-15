import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const err = new Error('Body is not valid JSON');
    err.statusCode = 400;
    throw err;
  }
}

/** Serves a file from `root`, refusing anything that escapes the directory. */
export async function serveStatic(root, urlPath, res) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const filePath = join(root, relative === '' ? 'index.html' : relative);
  if (!filePath.startsWith(root + sep) && filePath !== join(root, 'index.html')) {
    sendText(res, 403, 'Forbidden');
    return true;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}
