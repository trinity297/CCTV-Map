const ACTOR_KEY = 'cctvmap.actor';

export function getActor() {
  try {
    return localStorage.getItem(ACTOR_KEY) || '';
  } catch {
    return '';
  }
}

export function setActor(value) {
  try {
    localStorage.setItem(ACTOR_KEY, value || '');
  } catch { /* private browsing - not worth failing over */ }
}

export class ApiError extends Error {
  constructor(message, { status, fields } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields || null;
  }
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      'X-CCTV-Actor': getActor(),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = (response.headers.get('content-type') || '').includes('json');
  const payload = isJson ? await response.json().catch(() => ({})) : null;

  if (!response.ok) {
    throw new ApiError(payload?.error || `Request failed (${response.status})`, {
      status: response.status,
      fields: payload?.fields,
    });
  }
  return payload;
}

/** Builds the query string shared by the list, map and export endpoints. */
export function buildQuery(filters = {}) {
  const p = new URLSearchParams();
  if (filters.q) p.set('q', filters.q);
  if (filters.from) p.set('from', filters.from);
  if (filters.to) p.set('to', filters.to);
  if (filters.reference) p.set('reference', filters.reference);
  if (filters.operation) p.set('operation', filters.operation);
  if (filters.mappedOnly) p.set('mapped', '1');
  if (filters.bbox) {
    const b = filters.bbox;
    p.set('bbox', [b.minLat, b.minLng, b.maxLat, b.maxLng].join(','));
  }
  for (const s of filters.status || []) p.append('status', s);
  return p;
}

export const api = {
  session: () => request('/api/session'),
  signIn: (passcode) => request('/api/session', { method: 'POST', body: { passcode } }),
  signOut: () => request('/api/session', { method: 'DELETE' }),
  meta: () => request('/api/meta'),
  list: (filters) => request(`/api/records?${buildQuery(filters)}`),
  get: (id) => request(`/api/records/${id}`),
  create: (record) => request('/api/records', { method: 'POST', body: record }),
  update: (id, record) => request(`/api/records/${id}`, { method: 'PUT', body: record }),
  remove: (id) => request(`/api/records/${id}`, { method: 'DELETE' }),
  history: (id) => request(`/api/records/${id}/history`),
  coverage: (query) => request('/api/coverage', { method: 'POST', body: query }),
};
