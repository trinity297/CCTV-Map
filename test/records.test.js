import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.js';
import { RecordStore, normaliseRecord, ValidationError } from '../src/records.js';

let store;

beforeEach(() => {
  store = new RecordStore(openDatabase(':memory:'));
});

const base = {
  premises_name: 'Costcutter',
  address: '42 High Street',
  lat: 53.4808,
  lng: -2.2426,
  footage_start: '2026-03-12T08:00:00.000Z',
  footage_end: '2026-03-12T20:00:00.000Z',
  status: 'obtained',
};

test('a record needs a name or an address', () => {
  assert.throws(() => normaliseRecord({ premises_name: '', address: '' }), ValidationError);
  assert.doesNotThrow(() => normaliseRecord({ address: 'somewhere' }));
});

test('footage period must not run backwards', () => {
  assert.throws(
    () => normaliseRecord({ ...base, footage_start: '2026-03-12T20:00:00Z', footage_end: '2026-03-12T08:00:00Z' }),
    (err) => err instanceof ValidationError && 'footage_end' in err.fields,
  );
});

test('a map pin needs both coordinates', () => {
  assert.throws(() => normaliseRecord({ ...base, lng: '' }), ValidationError);
});

test('coordinates are range checked', () => {
  assert.throws(() => normaliseRecord({ ...base, lat: 120 }), ValidationError);
  assert.throws(() => normaliseRecord({ ...base, lng: -400 }), ValidationError);
});

test('create and read back a record with cameras', () => {
  const created = store.create({
    ...base,
    cameras: [{ label: 'Cam 1', bearing: 270, fov: 90, range_m: 30, covers: 'pavement' }],
  }, 'PC 1234');

  assert.ok(created.id);
  assert.equal(created.created_by, 'PC 1234');
  assert.equal(created.cameras.length, 1);
  assert.equal(created.cameras[0].bearing, 270);
  assert.ok(created.cameras[0].id, 'each camera gets a stable id');

  const fetched = store.get(created.id);
  assert.equal(fetched.premises_name, 'Costcutter');
  assert.equal(fetched.cameras[0].covers, 'pavement');
});

test('cameras default sensibly and clamp out-of-range values', () => {
  const created = store.create({ ...base, cameras: [{ label: 'Cam', range_m: 99999, fov: 1 }] });
  assert.equal(created.cameras[0].range_m, 2000);
  assert.equal(created.cameras[0].fov, 5);
  assert.equal(created.cameras[0].bearing, null);
});

test('update replaces fields and records an audit entry', () => {
  const created = store.create(base, 'PC 1');
  const updated = store.update(created.id, { ...base, status: 'requested' }, 'PC 2');
  assert.equal(updated.status, 'requested');
  assert.equal(updated.updated_by, 'PC 2');

  const history = store.history(created.id).map((h) => h.action);
  assert.deepEqual(history, ['updated', 'created']);
});

test('update and delete on a missing id are handled', () => {
  assert.equal(store.update('nope', base), null);
  assert.equal(store.remove('nope'), false);
});

test('delete removes the record', () => {
  const created = store.create(base);
  assert.equal(store.remove(created.id, 'PC 1'), true);
  assert.equal(store.get(created.id), null);
});

/* ------------------------------------------------------------- searching */

test('date filters match overlapping footage, not just containment', () => {
  store.create({ ...base, premises_name: 'Morning', footage_start: '2026-03-12T06:00:00Z', footage_end: '2026-03-12T10:00:00Z' });
  store.create({ ...base, premises_name: 'Evening', footage_start: '2026-03-12T18:00:00Z', footage_end: '2026-03-12T23:00:00Z' });

  // A window of 09:00-11:00 overlaps the morning record only.
  const { records } = store.search({ from: '2026-03-12T09:00:00Z', to: '2026-03-12T11:00:00Z' });
  assert.deepEqual(records.map((r) => r.premises_name), ['Morning']);
});

test('a record with no recorded period is not silently excluded', () => {
  store.create({ premises_name: 'Unknown period', address: 'x' });
  const { records } = store.search({ from: '2026-03-12T09:00:00Z', to: '2026-03-12T11:00:00Z' });
  assert.equal(records.length, 1);
});

test('free text search covers premises, refs, notes and camera text', () => {
  store.create({ ...base, premises_name: 'Bakery', notes: 'spoke to the manager' });
  store.create({ ...base, premises_name: 'Chemist', cameras: [{ label: 'Cam', covers: 'the alleyway' }] });

  assert.equal(store.search({ q: 'manager' }).records.length, 1);
  assert.equal(store.search({ q: 'alleyway' }).records[0].premises_name, 'Chemist');
  assert.equal(store.search({ q: 'nothing here' }).records.length, 0);
});

test('status filter accepts several values', () => {
  store.create({ ...base, status: 'obtained' });
  store.create({ ...base, status: 'refused' });
  store.create({ ...base, status: 'to_do' });
  assert.equal(store.search({ status: ['obtained', 'refused'] }).records.length, 2);
});

test('search reports the unpaginated total', () => {
  for (let i = 0; i < 5; i += 1) store.create({ ...base, premises_name: `Shop ${i}` });
  const result = store.search({ limit: 2 });
  assert.equal(result.records.length, 2);
  assert.equal(result.total, 5);
});

/* -------------------------------------------------------------- coverage */

test('coverage finds nearby records whose footage overlaps the window', () => {
  const near = store.create({
    ...base,
    premises_name: 'Newsagent opposite',
    lat: 53.4808, lng: -2.2426,
    cameras: [{ label: 'Cam 1', bearing: 90, fov: 90, range_m: 60, covers: 'the street' }],
  });
  store.create({ ...base, premises_name: 'Far away', lat: 53.9, lng: -2.9 });

  // A point roughly 30m east of the newsagent, inside that camera's view.
  const results = store.coverage({
    lat: 53.4808, lng: -2.2421,
    radiusM: 150,
    from: '2026-03-12T10:00:00Z',
    to: '2026-03-12T11:00:00Z',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, near.id);
  assert.ok(results[0].distance_m < 60);
  assert.equal(results[0].faces_target, true);
  assert.equal(results[0].facing_cameras.length, 1);
});

test('coverage marks records whose cameras point the wrong way', () => {
  store.create({
    ...base,
    lat: 53.4808, lng: -2.2426,
    cameras: [{ label: 'Cam 1', bearing: 270, fov: 60, range_m: 60 }],
  });
  const results = store.coverage({ lat: 53.4808, lng: -2.2421, radiusM: 150 });
  assert.equal(results.length, 1, 'still listed - the pin is close by');
  assert.equal(results[0].faces_target, false, 'but flagged as facing elsewhere');
});

test('coverage reports null facing when no cameras are recorded', () => {
  store.create({ ...base, lat: 53.4808, lng: -2.2426, cameras: [] });
  const results = store.coverage({ lat: 53.4808, lng: -2.2421, radiusM: 150 });
  assert.equal(results[0].faces_target, null);
});

test('coverage excludes records outside the radius', () => {
  store.create({ ...base, lat: 53.4808, lng: -2.2426 });
  assert.equal(store.coverage({ lat: 53.4808, lng: -2.2421, radiusM: 5 }).length, 0);
});

test('coverage puts facing cameras before merely-close ones', () => {
  store.create({
    ...base, premises_name: 'Close but looking away',
    lat: 53.48081, lng: -2.24255,
    cameras: [{ label: 'Cam', bearing: 270, fov: 40, range_m: 60 }],
  });
  store.create({
    ...base, premises_name: 'Further but looking at it',
    lat: 53.4808, lng: -2.2434,
    cameras: [{ label: 'Cam', bearing: 90, fov: 60, range_m: 120 }],
  });
  const results = store.coverage({ lat: 53.4808, lng: -2.2421, radiusM: 300 });
  assert.equal(results[0].premises_name, 'Further but looking at it');
});

test('coverage needs a point', () => {
  assert.throws(() => store.coverage({ lat: NaN, lng: NaN }), ValidationError);
});

test('stats summarise the log', () => {
  store.create({ ...base, status: 'obtained', reference: 'REF1' });
  store.create({ ...base, status: 'refused', reference: 'REF1', lat: null, lng: null });
  const stats = store.stats();
  assert.equal(stats.total, 2);
  assert.equal(stats.mapped, 1);
  assert.equal(stats.references[0].n, 2);
});

test('an empty status list means "no filter", not "match nothing"', () => {
  store.create(base);
  assert.equal(store.search({ status: [] }).records.length, 1);
  assert.equal(store.search({ status: '' }).records.length, 1);
  assert.equal(store.search({ status: ['no_footage'] }).records.length, 0);
});
