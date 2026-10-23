import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDatabase } from '../src/db.js';
import { createAuth } from '../src/auth.js';
import { createRequestHandler } from '../src/app.js';

let server;
let base;

before(async () => {
  const db = openDatabase(':memory:');
  const auth = createAuth({});
  server = createServer(createRequestHandler({ db, auth }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const sample = {
  premises_name: 'Test Newsagent',
  address: '1 Test Street',
  lat: 53.4808,
  lng: -2.2426,
  footage_start: '2026-03-12T08:00:00.000Z',
  footage_end: '2026-03-12T20:00:00.000Z',
  status: 'obtained',
  reference: 'TEST/1',
  cameras: [{ label: 'Cam 1', bearing: 90, fov: 90, range_m: 60, covers: 'the street' }],
};

test('the app shell is served', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /CCTV/);
});

test('static assets are served and directory traversal is refused', async () => {
  assert.equal((await fetch(base + '/css/app.css')).status, 200);
  // Percent-encoded so fetch cannot normalise the traversal away before it is sent.
  for (const path of ['/%2e%2e%2fpackage.json', '/js/%2e%2e%2f%2e%2e%2fserver.js', '/..%2f..%2fsrc%2fdb.js']) {
    const body = await (await fetch(base + path)).text();
    assert.ok(!body.includes('cctv-map'.concat('"')), `leaked a file outside public/ via ${path}`);
    assert.ok(!body.includes('openDatabase'), `leaked source via ${path}`);
  }
});

test('meta exposes statuses, system types and the map source', async () => {
  const meta = await (await fetch(base + '/api/meta')).json();
  assert.ok(meta.statuses.some((s) => s.value === 'obtained'));
  assert.ok(meta.systemTypes.length > 0);
  assert.equal(typeof meta.stats.total, 'number');
  assert.ok(meta.map.url, 'the browser needs a tile url');
  assert.ok(meta.map.label);
  assert.equal(meta.map.warnings, undefined, 'operator warnings stay on the server');
});

test('create, read, update and delete a record over HTTP', async () => {
  const created = await (await post('/api/records', sample, { 'X-CCTV-Actor': 'PC 99' })).json();
  assert.ok(created.id);
  assert.equal(created.created_by, 'PC 99');
  assert.equal(created.cameras[0].bearing, 90);

  const fetched = await (await fetch(`${base}/api/records/${created.id}`)).json();
  assert.equal(fetched.premises_name, 'Test Newsagent');

  const updateRes = await fetch(`${base}/api/records/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...sample, status: 'requested' }),
  });
  assert.equal((await updateRes.json()).status, 'requested');

  const history = await (await fetch(`${base}/api/records/${created.id}/history`)).json();
  assert.equal(history.history.length, 2);

  const delRes = await fetch(`${base}/api/records/${created.id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);
  assert.equal((await fetch(`${base}/api/records/${created.id}`)).status, 404);
});

test('invalid records come back as 422 with per-field messages', async () => {
  const res = await post('/api/records', { premises_name: '', address: '' });
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.ok(body.fields.premises_name);
});

test('coverage endpoint answers the "already collected?" question', async () => {
  await post('/api/records', sample);
  const res = await post('/api/coverage', {
    lat: 53.4808, lng: -2.2421, radius_m: 200,
    from: '2026-03-12T10:00:00Z', to: '2026-03-12T11:00:00Z',
  });
  const body = await res.json();
  assert.ok(body.count >= 1);
  assert.equal(body.results[0].faces_target, true);
  assert.ok(Number.isFinite(body.results[0].distance_m));
});

test('CSV export is downloadable and includes camera directions', async () => {
  const res = await fetch(base + '/api/export.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="cctv-log-/);
  const text = await res.text();
  assert.match(text, /Cameras \/ direction of view/);
  assert.match(text, /Cam 1: looking 90/);
});

test('JSON export returns the filtered set', async () => {
  const body = await (await fetch(base + '/api/export.json?q=Newsagent')).json();
  assert.ok(body.records.length >= 1);
  assert.ok(body.exported_at);
});

test('unknown API routes 404 as JSON', async () => {
  const res = await fetch(base + '/api/nope');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /json/);
});

test('malformed JSON bodies are rejected cleanly', async () => {
  const res = await fetch(base + '/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(res.status, 400);
});
