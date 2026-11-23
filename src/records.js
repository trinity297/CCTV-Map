import { boundingBox, distanceMetres, bearingBetween, bearingWithinView } from './geo.js';
import {
  STATUSES, SYSTEM_TYPES, ValidationError, normaliseRecord, hydrate, WRITABLE, randomUUID,
} from './record-core.js';

export { STATUSES, SYSTEM_TYPES, ValidationError, normaliseRecord, hydrate };

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
