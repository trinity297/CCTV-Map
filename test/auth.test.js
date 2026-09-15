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
  const auth = createAuth({ passcode: 'open-sesame', secret: 'test-secret' });
  server = createServer(createRequestHandler({ db, auth }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('records are refused without a session', async () => {
  const res = await fetch(base + '/api/records');
  assert.equal(res.status, 401);
});

test('the session endpoint reports that a passcode is required', async () => {
  const body = await (await fetch(base + '/api/session')).json();
  assert.equal(body.authRequired, true);
  assert.equal(body.authenticated, false);
});

test('a wrong passcode is refused', async () => {
  const res = await fetch(base + '/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: 'wrong' }),
  });
  assert.equal(res.status, 401);
});

test('the right passcode issues a session cookie that unlocks the API', async () => {
  const login = await fetch(base + '/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: 'open-sesame' }),
  });
  assert.equal(login.status, 200);

  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  assert.match(cookie, /^cctvmap_session=/);

  const res = await fetch(base + '/api/records', { headers: { cookie } });
  assert.equal(res.status, 200);
});

test('a tampered cookie is refused', async () => {
  const res = await fetch(base + '/api/records', {
    headers: { cookie: `cctvmap_session=${Date.now() + 100000}.forgedsignature` },
  });
  assert.equal(res.status, 401);
});
