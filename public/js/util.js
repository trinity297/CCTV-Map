export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Creates an element. `props` sets properties; `dataset`/`attrs` are special-cased. */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'attrs') for (const [a, v] of Object.entries(value)) node.setAttribute(a, v);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value != null && value !== false) node[key] = value;
  }
  for (const child of [children].flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

export function compassLabel(bearing) {
  if (bearing == null || Number.isNaN(Number(bearing))) return '';
  const idx = Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS_POINTS[idx];
}

export function directionText(camera) {
  if (!camera || camera.bearing == null) return 'direction not recorded';
  return `${Math.round(camera.bearing)}° ${compassLabel(camera.bearing)}`;
}

/* ------------------------------------------------------------ date/time */

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  day: '2-digit', month: 'short', year: 'numeric',
});
const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit', minute: '2-digit', hour12: false,
});

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : DATE_FMT.format(d);
}

/** "12 Mar 2026, 09:00 → 17:30" when both ends fall on the same day. */
export function fmtPeriod(startIso, endIso) {
  if (!startIso && !endIso) return '';
  if (!startIso) return `up to ${fmtDateTime(endIso)}`;
  if (!endIso) return `from ${fmtDateTime(startIso)}`;
  const a = new Date(startIso);
  const b = new Date(endIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '';
  const sameDay = a.toDateString() === b.toDateString();
  return sameDay
    ? `${DAY_FMT.format(a)}, ${TIME_FMT.format(a)} → ${TIME_FMT.format(b)}`
    : `${DATE_FMT.format(a)} → ${DATE_FMT.format(b)}`;
}

export function durationText(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const ms = new Date(endIso) - new Date(startIso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hours = mins / 60;
  if (hours < 48) return `${(Math.round(hours * 10) / 10).toString().replace(/\.0$/, '')} hr`;
  return `${Math.round(hours / 24)} days`;
}

/** ISO (UTC) -> value for an <input type="datetime-local"> in local time. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (local time) -> ISO UTC string. */
export function fromLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Days left before a system overwrites the period you care about.
 * Returns null when there is nothing to work from.
 */
export function retentionWarning(record) {
  const days = Number(record.retention_days);
  if (!Number.isFinite(days) || days <= 0 || !record.footage_start) return null;
  const expires = new Date(new Date(record.footage_start).getTime() + days * 86400000);
  const left = Math.ceil((expires - Date.now()) / 86400000);
  return { expires, daysLeft: left, expired: left <= 0 };
}

export function metresText(m) {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(2)} km`;
}

/* ---------------------------------------------------------------- toasts */

export function toast(message, kind = 'info', ms = 4200) {
  const host = $('#toasts');
  if (!host) return;
  const node = el('div', { className: `toast toast--${kind}`, role: 'status' }, message);
  host.append(node);
  setTimeout(() => node.remove(), ms);
}

export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
