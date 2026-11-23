/**
 * A drop-in replacement for api.js that keeps everything in the browser.
 *
 * It exists so the whole app can be shipped as one HTML file with no server
 * and no database — for showing the idea to people on a machine where you
 * cannot install anything. Records live in localStorage, so they survive a
 * refresh on that browser and go nowhere else.
 *
 * It mirrors the real API's shapes exactly, so every other module is unchanged
 * between the served app and the standalone file.
 */
import { STATUSES, SYSTEM_TYPES, normaliseRecord, ValidationError } from './record-core.js';
import { boundingBox, distanceMetres, bearingBetween, bearingWithinView } from './geo-core.js';

const KEY = 'cctvmap.demo.records';
const AUDIT_KEY = 'cctvmap.demo.audit';

const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback; // private browsing, or someone cleared site data mid-demo
  }
};

const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // quota, or storage disabled - the demo still works in memory
  }
};

let records = load(KEY, null);
let audit = load(AUDIT_KEY, []);

/** Seeded on first run so there is something to look at immediately. */
export function seedIfEmpty(seed) {
  if (records !== null) return;
  records = seed.map((example) => build(example, 'example data'));
  save(KEY, records);
}

export function resetToSeed(seed) {
  records = seed.map((example) => build(example, 'example data'));
  audit = [];
  save(KEY, records);
  save(AUDIT_KEY, audit);
}

export function replaceAll(incoming) {
  records = incoming.map((example) => build(example, 'imported'));
  save(KEY, records);
}

export function allRecords() {
  return records || [];
}

function build(input, actor) {
  const data = normaliseRecord(input);
  const now = new Date().toISOString();
  return {
    ...data,
    cameras: JSON.parse(data.cameras),
    id: input.id || crypto.randomUUID(),
    created_at: input.created_at || now,
    updated_at: now,
    created_by: input.created_by || actor || '',
    updated_by: actor || '',
  };
}

const note = (recordId, action, actor, detail = '') => {
  audit.unshift({ record_id: recordId, action, actor: actor || '', at: new Date().toISOString(), detail });
  audit = audit.slice(0, 500);
  save(AUDIT_KEY, audit);
};

const persist = () => save(KEY, records);

/* ------------------------------------------------------------- filtering */

const HAYSTACK = [
  'premises_name', 'address', 'postcode', 'reference', 'operation', 'exhibit_ref',
  'what_covered', 'notes', 'tags', 'collected_by', 'storage_location',
];

function matches(record, f) {
  if (f.q) {
    const needle = f.q.toLowerCase();
    const inFields = HAYSTACK.some((k) => String(record[k] || '').toLowerCase().includes(needle));
    const inCameras = JSON.stringify(record.cameras || []).toLowerCase().includes(needle);
    if (!inFields && !inCameras) return false;
  }
  const statuses = [f.status].flat().filter(Boolean);
  if (statuses.length && !statuses.includes(record.status)) return false;
  if (f.reference && record.reference !== f.reference) return false;
  if (f.operation && record.operation !== f.operation) return false;
  // Overlap, with a missing bound treated as open ended - same as the server.
  if (f.to && record.footage_start && record.footage_start > f.to) return false;
  if (f.from && record.footage_end && record.footage_end < f.from) return false;
  if (f.mappedOnly && (record.lat == null || record.lng == null)) return false;
  if (f.bbox) {
    if (record.lat == null || record.lng == null) return false;
    const b = f.bbox;
    if (record.lat < b.minLat || record.lat > b.maxLat) return false;
    if (record.lng < b.minLng || record.lng > b.maxLng) return false;
  }
  return true;
}

const sortKey = (r) => r.footage_start || r.collected_at || r.created_at || '';

function search(filters = {}) {
  const hits = (records || []).filter((r) => matches(r, filters));
  hits.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const limit = Math.min(Number(filters.limit) || 500, 5000);
  return { total: hits.length, records: hits.slice(0, limit) };
}

function stats() {
  const byStatus = Object.entries(
    (records || []).reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}),
  ).map(([status, n]) => ({ status, n }));
  const tally = (field) => Object.entries(
    (records || []).filter((r) => r[field]).reduce((acc, r) => ({ ...acc, [r[field]]: (acc[r[field]] || 0) + 1 }), {}),
  ).map(([value, n]) => ({ [field]: value, n })).sort((a, b) => b.n - a.n);
  return {
    total: (records || []).length,
    mapped: (records || []).filter((r) => r.lat != null).length,
    byStatus,
    references: tally('reference'),
    operations: tally('operation'),
  };
}

/* -------------------------------------------------------------- coverage */

function coverage({ lat, lng, radius_m: radiusM = 150, from, to, status }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new ValidationError({ lat: 'Pick a point on the map first.' });
  }
  const radius = Math.min(Math.max(Number(radiusM) || 150, 1), 20000);
  const { records: near } = search({
    from, to, status, bbox: boundingBox(lat, lng, radius), mappedOnly: true, limit: 5000,
  });

  return near
    .map((record) => {
      const distance = distanceMetres(lat, lng, record.lat, record.lng);
      const bearingToTarget = bearingBetween(record.lat, record.lng, lat, lng);
      const facing = (record.cameras || []).filter(
        (cam) => bearingWithinView(cam.bearing, cam.fov, bearingToTarget)
          && distance <= (cam.range_m ?? 40) * 1.5,
      );
      return {
        ...record,
        distance_m: Math.round(distance),
        bearing_to_target: Math.round(bearingToTarget),
        facing_cameras: facing,
        faces_target: (record.cameras || []).length === 0 ? null : facing.length > 0,
      };
    })
    .filter((r) => r.distance_m <= radius)
    .sort((a, b) => {
      const aFaces = a.faces_target === true ? 0 : 1;
      const bFaces = b.faces_target === true ? 0 : 1;
      return aFaces - bFaces || a.distance_m - b.distance_m;
    });
}

/* ------------------------------------------------------- the api surface */

const actor = () => {
  try {
    return localStorage.getItem('cctvmap.actor') || '';
  } catch {
    return '';
  }
};

const clone = (value) => JSON.parse(JSON.stringify(value));

export const api = {
  session: async () => ({ authRequired: false, authenticated: true }),
  signIn: async () => ({ authenticated: true }),
  signOut: async () => ({ authenticated: false }),

  meta: async () => ({
    statuses: STATUSES,
    systemTypes: SYSTEM_TYPES,
    stats: stats(),
    map: window.__cctvDemoMap,
  }),

  list: async (filters) => clone(search(filters)),

  get: async (id) => {
    const found = (records || []).find((r) => r.id === id);
    return found ? clone(found) : null;
  },

  create: async (input) => {
    const record = build(input, actor());
    records = records || [];
    records.unshift(record);
    persist();
    note(record.id, 'created', actor());
    return clone(record);
  },

  update: async (id, input) => {
    records = records || [];
    const index = records.findIndex((r) => r.id === id);
    if (index < 0) return null;
    const record = build({ ...input, id, created_at: records[index].created_at, created_by: records[index].created_by }, actor());
    records[index] = record;
    persist();
    note(id, 'updated', actor());
    return clone(record);
  },

  remove: async (id) => {
    records = records || [];
    const index = records.findIndex((r) => r.id === id);
    if (index < 0) return { deleted: false };
    const [gone] = records.splice(index, 1);
    persist();
    note(id, 'deleted', actor(), gone.premises_name || gone.address);
    return { deleted: true };
  },

  history: async (id) => ({ history: audit.filter((a) => a.record_id === id) }),

  coverage: async (query) => {
    const results = coverage(query);
    return { count: results.length, results: clone(results) };
  },
};

export { ValidationError };
