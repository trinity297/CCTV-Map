import { RecordStore, STATUSES, SYSTEM_TYPES, ValidationError } from './records.js';
import { toCsv } from './csv.js';
import { readJsonBody, sendJson, sendText } from './http.js';

const actorOf = (req) => String(req.headers['x-cctv-actor'] || '').slice(0, 120);

function parseListQuery(url) {
  const p = url.searchParams;
  const bboxRaw = p.get('bbox');
  let bbox = null;
  if (bboxRaw) {
    const [minLat, minLng, maxLat, maxLng] = bboxRaw.split(',').map(Number);
    if ([minLat, minLng, maxLat, maxLng].every(Number.isFinite)) {
      bbox = { minLat, minLng, maxLat, maxLng };
    }
  }
  return {
    q: p.get('q') || '',
    status: p.getAll('status').filter(Boolean),
    from: p.get('from') || '',
    to: p.get('to') || '',
    reference: p.get('reference') || '',
    operation: p.get('operation') || '',
    mappedOnly: p.get('mapped') === '1',
    bbox,
    limit: p.get('limit') || 500,
    offset: p.get('offset') || 0,
  };
}

/**
 * Returns a handler for /api/*, or null when the path is not ours.
 * Resolves to `true` once it has written a response.
 */
export function createApi({ db, auth, mapConfig }) {
  const store = new RecordStore(db);

  async function handle(req, res, url) {
    const path = url.pathname.replace(/\/+$/, '') || '/api';
    const method = req.method.toUpperCase();

    // --- auth endpoints are always reachable -------------------------------
    if (path === '/api/session' && method === 'GET') {
      return sendJson(res, 200, {
        authRequired: auth.enabled,
        authenticated: auth.isAuthenticated(req),
      });
    }
    if (path === '/api/session' && method === 'POST') {
      const body = await readJsonBody(req);
      if (!auth.check(body.passcode)) {
        return sendJson(res, 401, { error: 'That passcode was not recognised.' });
      }
      const secure = (req.headers['x-forwarded-proto'] || '').includes('https');
      res.setHeader('Set-Cookie', auth.loginCookie(secure));
      return sendJson(res, 200, { authenticated: true });
    }
    if (path === '/api/session' && method === 'DELETE') {
      res.setHeader('Set-Cookie', auth.logoutCookie());
      return sendJson(res, 200, { authenticated: false });
    }

    if (!auth.isAuthenticated(req)) {
      return sendJson(res, 401, { error: 'Sign in to continue.' });
    }

    // --- reference data ----------------------------------------------------
    if (path === '/api/meta' && method === 'GET') {
      // `warnings` are for the operator's console, not the browser.
      const { warnings, ...map } = mapConfig;
      return sendJson(res, 200, {
        statuses: STATUSES,
        systemTypes: SYSTEM_TYPES,
        stats: store.stats(),
        map,
      });
    }

    // --- export ------------------------------------------------------------
    if (path === '/api/export.csv' && method === 'GET') {
      const { records } = store.search({ ...parseListQuery(url), limit: 5000 });
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Disposition', `attachment; filename="cctv-log-${stamp}.csv"`);
      return sendText(res, 200, toCsv(records), 'text/csv; charset=utf-8');
    }
    if (path === '/api/export.json' && method === 'GET') {
      const { records } = store.search({ ...parseListQuery(url), limit: 5000 });
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Disposition', `attachment; filename="cctv-log-${stamp}.json"`);
      return sendJson(res, 200, { exported_at: new Date().toISOString(), records });
    }

    // --- coverage check ----------------------------------------------------
    if (path === '/api/coverage' && method === 'POST') {
      const body = await readJsonBody(req);
      const results = store.coverage({
        lat: Number(body.lat),
        lng: Number(body.lng),
        radiusM: Number(body.radius_m),
        from: body.from || '',
        to: body.to || '',
        status: Array.isArray(body.status) ? body.status : undefined,
      });
      return sendJson(res, 200, { count: results.length, results });
    }

    // --- records -----------------------------------------------------------
    if (path === '/api/records' && method === 'GET') {
      return sendJson(res, 200, store.search(parseListQuery(url)));
    }
    if (path === '/api/records' && method === 'POST') {
      const body = await readJsonBody(req);
      return sendJson(res, 201, store.create(body, actorOf(req)));
    }

    const match = path.match(/^\/api\/records\/([\w-]+)(\/history)?$/);
    if (match) {
      const [, id, historySuffix] = match;
      if (historySuffix && method === 'GET') {
        if (!store.get(id)) return sendJson(res, 404, { error: 'Record not found.' });
        return sendJson(res, 200, { history: store.history(id) });
      }
      if (method === 'GET') {
        const record = store.get(id);
        return record
          ? sendJson(res, 200, record)
          : sendJson(res, 404, { error: 'Record not found.' });
      }
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readJsonBody(req);
        const updated = store.update(id, body, actorOf(req));
        return updated
          ? sendJson(res, 200, updated)
          : sendJson(res, 404, { error: 'Record not found.' });
      }
      if (method === 'DELETE') {
        return store.remove(id, actorOf(req))
          ? sendJson(res, 200, { deleted: true })
          : sendJson(res, 404, { error: 'Record not found.' });
      }
    }

    return sendJson(res, 404, { error: `No API route for ${method} ${path}` });
  }

  return async function apiRouter(req, res, url) {
    try {
      await handle(req, res, url);
    } catch (err) {
      if (err instanceof ValidationError) {
        return sendJson(res, 422, { error: 'Some details need fixing.', fields: err.fields });
      }
      const status = err.statusCode || 500;
      if (status >= 500) console.error('[api]', err);
      sendJson(res, status, { error: status >= 500 ? 'Something went wrong on the server.' : err.message });
    }
    return true;
  };
}
