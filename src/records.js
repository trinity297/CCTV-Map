import { randomUUID } from 'node:crypto';
import { boundingBox, distanceMetres, bearingBetween, bearingWithinView } from './geo.js';

export const STATUSES = [
  { value: 'obtained',    label: 'Obtained',        hint: 'Footage is in our hands' },
  { value: 'requested',   label: 'Requested',       hint: 'Asked for, not yet received' },
  { value: 'viewed_only', label: 'Viewed only',     hint: 'Seen on site, no copy taken' },
  { value: 'no_footage',  label: 'No footage',      hint: 'Nothing covering the period' },
  { value: 'not_working', label: 'System not working', hint: 'Camera present but dead/dummy' },
  { value: 'refused',     label: 'Refused',         hint: 'Owner would not provide' },
  { value: 'no_reply',    label: 'No reply',        hint: 'Premises not answering' },
  { value: 'to_do',       label: 'To do',           hint: 'Enquiry outstanding' },
];

export const SYSTEM_TYPES = [
  'DVR / NVR', 'Cloud / app based', 'Doorbell (Ring, Nest etc.)', 'Dashcam',
  'Body worn', 'ANPR', 'Local authority / town centre', 'Transport (bus, rail, taxi)',
  'Mobile phone', 'Other',
];

const STATUS_VALUES = new Set(STATUSES.map((s) => s.value));

/** Columns a client is allowed to write, in insert order. */
const WRITABLE = [
  'reference', 'operation', 'exhibit_ref', 'premises_name', 'address', 'postcode',
  'lat', 'lng', 'what_covered', 'system_type', 'retention_days', 'quality', 'status',
  'footage_start', 'footage_end', 'collected_at', 'collected_by', 'contact_name',
  'contact_details', 'media_format', 'storage_location', 'cameras', 'notes', 'tags',
];

const TEXT_FIELDS = new Set([
  'reference', 'operation', 'exhibit_ref', 'premises_name', 'address', 'postcode',
  'what_covered', 'system_type', 'quality', 'status', 'collected_by', 'contact_name',
  'contact_details', 'media_format', 'storage_location', 'notes', 'tags',
]);

class ValidationError extends Error {
  constructor(fields) {
    super('Validation failed');
    this.name = 'ValidationError';
    this.fields = fields;
  }
}
export { ValidationError };

const str = (v) => (v == null ? '' : String(v).trim());

function parseNumber(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/** Accepts an ISO string or a `datetime-local` value; returns ISO UTC or null. */
function parseDateTime(value) {
  if (value === '' || value == null) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? NaN : d.toISOString();
}

function normaliseCameras(value, errors) {
  let list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list || '[]');
    } catch {
      errors.cameras = 'Cameras could not be read.';
      return [];
    }
  }
  if (list == null) return [];
  if (!Array.isArray(list)) {
    errors.cameras = 'Cameras must be a list.';
    return [];
  }
  return list.slice(0, 50).map((raw, i) => {
    const cam = raw && typeof raw === 'object' ? raw : {};
    const bearing = parseNumber(cam.bearing);
    const fov = parseNumber(cam.fov);
    const range = parseNumber(cam.range_m);
    if (Number.isNaN(bearing) || (bearing != null && (bearing < 0 || bearing > 360))) {
      errors[`cameras.${i}.bearing`] = 'Direction must be between 0 and 360 degrees.';
    }
    return {
      id: str(cam.id) || randomUUID(),
      label: str(cam.label) || `Camera ${i + 1}`,
      bearing: Number.isNaN(bearing) ? null : bearing === 360 ? 0 : bearing,
      fov: Number.isNaN(fov) || fov == null ? 60 : Math.min(360, Math.max(5, fov)),
      range_m: Number.isNaN(range) || range == null ? 40 : Math.min(2000, Math.max(1, range)),
      covers: str(cam.covers),
      indoor: Boolean(cam.indoor),
    };
  });
}

/** Validates and normalises an incoming record payload. Throws ValidationError. */
export function normaliseRecord(input = {}) {
  const errors = {};
  const out = {};

  for (const field of TEXT_FIELDS) out[field] = str(input[field]);

  if (!out.premises_name && !out.address) {
    errors.premises_name = 'Give the premises a name or an address so it can be found again.';
  }
  if (!out.status) out.status = 'obtained';
  if (!STATUS_VALUES.has(out.status)) errors.status = 'Unknown status.';

  const lat = parseNumber(input.lat);
  const lng = parseNumber(input.lng);
  if (Number.isNaN(lat) || (lat != null && (lat < -90 || lat > 90))) {
    errors.lat = 'Latitude must be between -90 and 90.';
  }
  if (Number.isNaN(lng) || (lng != null && (lng < -180 || lng > 180))) {
    errors.lng = 'Longitude must be between -180 and 180.';
  }
  if ((lat == null) !== (lng == null)) {
    errors.lat = 'A map pin needs both a latitude and a longitude.';
  }
  out.lat = Number.isNaN(lat) ? null : lat;
  out.lng = Number.isNaN(lng) ? null : lng;

  const retention = parseNumber(input.retention_days);
  if (Number.isNaN(retention) || (retention != null && retention < 0)) {
    errors.retention_days = 'Retention must be a number of days.';
  }
  out.retention_days = Number.isNaN(retention) ? null : retention == null ? null : Math.round(retention);

  for (const field of ['footage_start', 'footage_end', 'collected_at']) {
    const parsed = parseDateTime(input[field]);
    if (Number.isNaN(parsed)) errors[field] = 'Not a valid date and time.';
    out[field] = Number.isNaN(parsed) ? null : parsed;
  }
  if (out.footage_start && out.footage_end && out.footage_start > out.footage_end) {
    errors.footage_end = 'The footage period ends before it starts.';
  }

  out.cameras = JSON.stringify(normaliseCameras(input.cameras, errors));

  if (Object.keys(errors).length) throw new ValidationError(errors);
  return out;
}

/** Turns a database row into the shape the API and UI use. */
export function hydrate(row) {
  if (!row) return null;
  let cameras = [];
  try {
    cameras = JSON.parse(row.cameras || '[]');
  } catch {
    cameras = [];
  }
  return { ...row, cameras };
}

export class RecordStore {
  constructor(db) {
    this.db = db;
  }

  #audit(recordId, action, actor, detail = '') {
    this.db
      .prepare('INSERT INTO audit (record_id, action, actor, at, detail) VALUES (?, ?, ?, ?, ?)')
      .run(recordId, action, actor || '', new Date().toISOString(), detail);
  }

  create(input, actor = '') {
    const data = normaliseRecord(input);
    const id = randomUUID();
    const now = new Date().toISOString();
    const columns = [...WRITABLE, 'id', 'created_at', 'updated_at', 'created_by', 'updated_by'];
    const values = [...WRITABLE.map((c) => data[c]), id, now, now, actor, actor];
    this.db
      .prepare(
        `INSERT INTO records (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      )
      .run(...values);
    this.#audit(id, 'created', actor);
    return this.get(id);
  }

  get(id) {
    return hydrate(this.db.prepare('SELECT * FROM records WHERE id = ?').get(id));
  }

  update(id, input, actor = '') {
    const existing = this.db.prepare('SELECT id FROM records WHERE id = ?').get(id);
    if (!existing) return null;
    const data = normaliseRecord(input);
    const now = new Date().toISOString();
    const assignments = [...WRITABLE.map((c) => `${c} = ?`), 'updated_at = ?', 'updated_by = ?'];
    this.db
      .prepare(`UPDATE records SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...WRITABLE.map((c) => data[c]), now, actor, id);
    this.#audit(id, 'updated', actor);
    return this.get(id);
  }

  remove(id, actor = '') {
    const existing = this.get(id);
    if (!existing) return false;
    this.db.prepare('DELETE FROM records WHERE id = ?').run(id);
    this.#audit(id, 'deleted', actor, existing.premises_name || existing.address);
    return true;
  }

  history(id) {
    return this.db.prepare('SELECT * FROM audit WHERE record_id = ? ORDER BY id DESC').all(id);
  }

  /**
   * Filtered list. `from`/`to` select records whose *footage period overlaps*
   * the window - that is the question an investigator actually asks.
   */
  search({ q, status, from, to, reference, operation, bbox, mappedOnly, limit = 500, offset = 0 } = {}) {
    const where = [];
    const params = [];

    if (q) {
      const fields = [
        'premises_name', 'address', 'postcode', 'reference', 'operation', 'exhibit_ref',
        'what_covered', 'notes', 'tags', 'collected_by', 'storage_location', 'cameras',
      ];
      where.push(`(${fields.map((f) => `${f} LIKE ?`).join(' OR ')})`);
      for (const _ of fields) params.push(`%${q}%`);
    }
    // An empty array must mean "no status filter", not "match nothing" -
    // SQLite accepts `IN ()` happily and would return zero rows.
    const statusList = status == null ? [] : [status].flat().filter(Boolean);
    if (statusList.length) {
      where.push(`status IN (${statusList.map(() => '?').join(', ')})`);
      params.push(...statusList);
    }
    if (reference) {
      where.push('reference = ?');
      params.push(reference);
    }
    if (operation) {
      where.push('operation = ?');
      params.push(operation);
    }
    // Overlap test: start <= windowEnd AND end >= windowStart, treating a
    // missing bound as "open ended" rather than excluding the record.
    if (to) {
      where.push('(footage_start IS NULL OR footage_start <= ?)');
      params.push(to);
    }
    if (from) {
      where.push('(footage_end IS NULL OR footage_end >= ?)');
      params.push(from);
    }
    if (mappedOnly) where.push('lat IS NOT NULL AND lng IS NOT NULL');
    if (bbox) {
      where.push('lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?');
      params.push(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng);
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM records ${clause}`).get(...params).n;
    const rows = this.db
      .prepare(
        `SELECT * FROM records ${clause}
         ORDER BY COALESCE(footage_start, collected_at, created_at) DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, Math.min(Number(limit) || 500, 5000), Number(offset) || 0);
    return { total, records: rows.map(hydrate) };
  }

  /**
   * "Has anyone already got this?" - every record whose location falls within
   * `radiusM` of a point and whose footage overlaps the given window.
   * Results carry the distance, and whether a camera actually faces the point.
   */
  coverage({ lat, lng, radiusM = 150, from, to, status }) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new ValidationError({ lat: 'Pick a point on the map first.' });
    }
    const radius = Math.min(Math.max(Number(radiusM) || 150, 1), 20000);
    const { records } = this.search({
      from, to, status, bbox: boundingBox(lat, lng, radius), mappedOnly: true, limit: 5000,
    });

    return records
      .map((record) => {
        const distance = distanceMetres(lat, lng, record.lat, record.lng);
        const bearingToTarget = bearingBetween(record.lat, record.lng, lat, lng);
        const facing = record.cameras.filter(
          (cam) => bearingWithinView(cam.bearing, cam.fov, bearingToTarget) &&
            distance <= (cam.range_m ?? 40) * 1.5,
        );
        return {
          ...record,
          distance_m: Math.round(distance),
          bearing_to_target: Math.round(bearingToTarget),
          facing_cameras: facing,
          faces_target: record.cameras.length === 0 ? null : facing.length > 0,
        };
      })
      .filter((r) => r.distance_m <= radius)
      .sort((a, b) => {
        // Cameras that actually point at the spot come first.
        const aFaces = a.faces_target === true ? 0 : 1;
        const bFaces = b.faces_target === true ? 0 : 1;
        return aFaces - bFaces || a.distance_m - b.distance_m;
      });
  }

  stats() {
    const byStatus = this.db
      .prepare('SELECT status, COUNT(*) AS n FROM records GROUP BY status')
      .all();
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM records').get().n;
    const mapped = this.db
      .prepare('SELECT COUNT(*) AS n FROM records WHERE lat IS NOT NULL').get().n;
    const references = this.db
      .prepare(`SELECT reference, COUNT(*) AS n FROM records
                WHERE reference <> '' GROUP BY reference ORDER BY n DESC LIMIT 100`)
      .all();
    const operations = this.db
      .prepare(`SELECT operation, COUNT(*) AS n FROM records
                WHERE operation <> '' GROUP BY operation ORDER BY n DESC LIMIT 100`)
      .all();
    return { total, mapped, byStatus, references, operations };
  }
}
