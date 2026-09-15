import { compassLabel } from './geo.js';

const COLUMNS = [
  ['reference', 'Occurrence / crime ref'],
  ['operation', 'Operation'],
  ['exhibit_ref', 'Exhibit ref'],
  ['status', 'Status'],
  ['premises_name', 'Premises'],
  ['address', 'Address'],
  ['postcode', 'Postcode'],
  ['lat', 'Latitude'],
  ['lng', 'Longitude'],
  ['what_covered', 'What it covers'],
  ['cameras_summary', 'Cameras / direction of view'],
  ['footage_start', 'Footage from'],
  ['footage_end', 'Footage to'],
  ['collected_at', 'Collected on'],
  ['collected_by', 'Collected by'],
  ['system_type', 'System type'],
  ['retention_days', 'Retention (days)'],
  ['quality', 'Quality'],
  ['media_format', 'Media format'],
  ['storage_location', 'Stored at'],
  ['contact_name', 'Contact'],
  ['contact_details', 'Contact details'],
  ['tags', 'Tags'],
  ['notes', 'Notes'],
  ['created_at', 'Created'],
  ['updated_at', 'Last updated'],
];

const escape = (value) => {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function camerasSummary(cameras = []) {
  return cameras
    .map((c) => {
      const dir = c.bearing == null ? 'direction not recorded' : `${Math.round(c.bearing)}° ${compassLabel(c.bearing)}`;
      const covers = c.covers ? ` - ${c.covers}` : '';
      return `${c.label}: looking ${dir}${covers}`;
    })
    .join(' | ');
}

export function toCsv(records) {
  const lines = [COLUMNS.map(([, header]) => escape(header)).join(',')];
  for (const record of records) {
    const row = { ...record, cameras_summary: camerasSummary(record.cameras) };
    lines.push(COLUMNS.map(([key]) => escape(row[key])).join(','));
  }
  // Excel opens UTF-8 CSV correctly only when it sees a byte order mark.
  return `﻿${lines.join('\r\n')}\r\n`;
}
