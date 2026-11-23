/**
 * Validation and reference data shared by the server, the browser app and the
 * standalone build, so all three agree on what a valid record is. Nothing here
 * touches a database or the filesystem: it runs unchanged in a browser.
 */

// Available in both Node 19+ and every browser that runs this app.
export const randomUUID = () => globalThis.crypto.randomUUID();

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
export const WRITABLE = [
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
