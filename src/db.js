import './quiet.js'; // must load before node:sqlite - see the note in that file
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  id              TEXT PRIMARY KEY,
  reference       TEXT NOT NULL DEFAULT '',
  operation       TEXT NOT NULL DEFAULT '',
  exhibit_ref     TEXT NOT NULL DEFAULT '',
  premises_name   TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  postcode        TEXT NOT NULL DEFAULT '',
  lat             REAL,
  lng             REAL,
  what_covered    TEXT NOT NULL DEFAULT '',
  system_type     TEXT NOT NULL DEFAULT '',
  retention_days  INTEGER,
  quality         TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'obtained',
  footage_start   TEXT,
  footage_end     TEXT,
  collected_at    TEXT,
  collected_by    TEXT NOT NULL DEFAULT '',
  contact_name    TEXT NOT NULL DEFAULT '',
  contact_details TEXT NOT NULL DEFAULT '',
  media_format    TEXT NOT NULL DEFAULT '',
  storage_location TEXT NOT NULL DEFAULT '',
  cameras         TEXT NOT NULL DEFAULT '[]',
  notes           TEXT NOT NULL DEFAULT '',
  tags            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  created_by      TEXT NOT NULL DEFAULT '',
  updated_by      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_records_footage  ON records (footage_start, footage_end);
CREATE INDEX IF NOT EXISTS idx_records_latlng   ON records (lat, lng);
CREATE INDEX IF NOT EXISTS idx_records_status   ON records (status);
CREATE INDEX IF NOT EXISTS idx_records_ref      ON records (reference);
CREATE INDEX IF NOT EXISTS idx_records_updated  ON records (updated_at);

CREATE TABLE IF NOT EXISTS audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id  TEXT NOT NULL,
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL DEFAULT '',
  at         TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_audit_record ON audit (record_id, id);
`;

/**
 * Opens (and if needed creates) the SQLite database.
 * Pass ':memory:' for tests.
 */
export function openDatabase(file) {
  if (file !== ':memory:') {
    mkdirSync(dirname(resolve(file)), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
