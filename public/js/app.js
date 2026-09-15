import { $, $$, el, debounce, toast, fromLocalInput } from './util.js';
import { api, buildQuery, getActor, setActor } from './api.js';
import { createMapView } from './map.js';
import { renderResults, renderTable } from './list.js';
import { openRecordForm } from './form.js';
import { openDetail } from './detail.js';
import { createCoverageView } from './coverage.js';

const state = {
  view: 'map',
  records: [],
  total: 0,
  activeId: null,
  filters: { q: '', status: [], from: '', to: '', reference: '', operation: '', mappedOnly: false, bbox: null },
};

let mapView = null;
let coverageView = null;

/* --------------------------------------------------------------- startup */

async function boot() {
  const session = await api.session();
  if (session.authRequired && !session.authenticated) {
    showLogin();
    return;
  }
  $('#app').hidden = false;
  $('#sign-out').hidden = !session.authRequired;
  await startApp();
}

function showLogin() {
  const gate = $('#login');
  gate.hidden = false;
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#login-error');
    error.hidden = true;
    try {
      await api.signIn($('#login-passcode').value);
      gate.hidden = true;
      $('#app').hidden = false;
      $('#sign-out').hidden = false;
      await startApp();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  });
  $('#login-passcode').focus();
}

async function startApp() {
  window.__cctvMeta = await api.meta();

  buildStatusFilters();
  buildDatalists();
  wireChrome();

  mapView = createMapView({
    container: $('#map'),
    onSelect: (id) => {
      const record = state.records.find((r) => r.id === id);
      if (record) select(record, { open: true });
    },
    onViewportChange: () => {
      if (state.filters.mappedOnly && $('#filter-bbox').checked) refresh();
    },
  });

  coverageView = createCoverageView({
    root: $('#view-coverage'),
    mapView,
    onOpenRecord: (record) => openRecord(record.id),
    onNeedMap: (back) => setView(back === 'coverage' ? 'coverage' : 'map'),
  });

  await refresh({ fitToResults: true });
}

/* ---------------------------------------------------------------- chrome */

function buildStatusFilters() {
  const host = $('#filter-status');
  host.replaceChildren(...window.__cctvMeta.statuses.map((status) =>
    el('label', { className: 'status-pill', title: status.hint }, [
      el('input', {
        type: 'checkbox', value: status.value,
        onChange: (event) => {
          const set = new Set(state.filters.status);
          if (event.target.checked) set.add(status.value);
          else set.delete(status.value);
          state.filters.status = [...set];
          refresh();
        },
      }),
      el('span', { className: 'dot', style: { '--dot': `var(--s-${status.value})` } }),
      status.label,
    ])));
}

function buildDatalists() {
  const { references, operations } = window.__cctvMeta.stats;
  $('#ref-options').replaceChildren(...references.map((r) => el('option', { value: r.reference })));
  $('#op-options').replaceChildren(...operations.map((o) => el('option', { value: o.operation })));
}

function wireChrome() {
  const actorInput = $('#actor');
  actorInput.value = getActor();
  actorInput.addEventListener('change', () => setActor(actorInput.value.trim()));

  $$('.tab').forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));

  $('#new-record').addEventListener('click', () => openForm(null));

  $('#sign-out').addEventListener('click', async () => {
    await api.signOut();
    location.reload();
  });

  const onSearch = debounce(() => {
    state.filters.q = $('#filter-q').value.trim();
    refresh();
  }, 250);
  $('#filter-q').addEventListener('input', onSearch);

  for (const [id, key] of [['#filter-from', 'from'], ['#filter-to', 'to']]) {
    $(id).addEventListener('change', () => {
      state.filters[key] = fromLocalInput($(id).value);
      refresh();
    });
  }
  for (const [id, key] of [['#filter-reference', 'reference'], ['#filter-operation', 'operation']]) {
    $(id).addEventListener('change', () => {
      state.filters[key] = $(id).value.trim();
      refresh();
    });
  }

  $('#filter-bbox').addEventListener('change', (event) => {
    state.filters.mappedOnly = event.target.checked;
    refresh();
  });

  $('#filters-clear').addEventListener('click', () => {
    state.filters = { q: state.filters.q, status: [], from: '', to: '', reference: '', operation: '', mappedOnly: false, bbox: null };
    $('#filter-from').value = '';
    $('#filter-to').value = '';
    $('#filter-reference').value = '';
    $('#filter-operation').value = '';
    $('#filter-bbox').checked = false;
    $$('#filter-status input').forEach((input) => { input.checked = false; });
    refresh();
  });

  $('#map-legend').replaceChildren(...window.__cctvMeta.statuses.map((status) =>
    el('span', { title: status.hint }, [
      el('span', { className: 'dot', style: { background: `var(--s-${status.value})` } }),
      status.label,
    ])));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && mapView?.isPicking()) mapView.stopPicking();
    if (event.key === 'n' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      openForm(null);
    }
  });
}

function setView(view) {
  state.view = view;
  $$('.tab').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.view === view)));
  $('#view-map').hidden = view !== 'map';
  $('#view-list').hidden = view !== 'list';
  $('#view-coverage').hidden = view !== 'coverage';
  const sidebarHidden = view === 'coverage';
  $('#sidebar').hidden = sidebarHidden;
  $('.layout').classList.toggle('layout--wide', sidebarHidden);
  if (view === 'map') setTimeout(() => mapView?.invalidate(), 30);
}

/* ------------------------------------------------------------------ data */

async function refresh({ fitToResults = false } = {}) {
  const filters = { ...state.filters };
  if (filters.mappedOnly && $('#filter-bbox').checked && mapView) {
    filters.bbox = mapView.bounds();
  }

  let payload;
  try {
    payload = await api.list(filters);
  } catch (error) {
    toast(error.message, 'error');
    return;
  }

  state.records = payload.records;
  state.total = payload.total;

  const shown = payload.records.length;
  $('#result-count').textContent = shown === payload.total
    ? `${payload.total} record${payload.total === 1 ? '' : 's'}`
    : `${shown} of ${payload.total} records`;

  const activeFilters = [
    state.filters.status.length, state.filters.from, state.filters.to,
    state.filters.reference, state.filters.operation, state.filters.mappedOnly,
  ].filter(Boolean).length;
  const badge = $('#filter-count');
  badge.textContent = String(activeFilters);
  badge.hidden = activeFilters === 0;

  renderResults($('#results'), payload.records, {
    activeId: state.activeId,
    onSelect: (record) => select(record, { open: true }),
  });
  renderTable($('#records-table'), payload.records, { onSelect: (record) => openRecord(record.id) });
  $('#list-empty').hidden = payload.records.length > 0;

  mapView?.render(payload.records);
  if (state.activeId) mapView?.setActive(state.activeId);
  if (fitToResults) mapView?.fit(payload.records);

  const query = buildQuery(filters).toString();
  $('#export-csv').href = `/api/export.csv?${query}`;
  $('#export-json').href = `/api/export.json?${query}`;
}

function select(record, { open = false } = {}) {
  state.activeId = record.id;
  $$('.result').forEach((node) => node.classList.toggle('is-active', node.dataset.id === record.id));
  mapView?.setActive(record.id);
  if (open) openRecord(record.id);
}

async function openRecord(id) {
  let record = state.records.find((r) => r.id === id);
  if (!record) {
    try {
      record = await api.get(id);
    } catch (error) {
      toast(error.message, 'error');
      return;
    }
  }
  openDetail({
    dialog: $('#detail-dialog'),
    record,
    onEdit: (r) => openForm(r),
    onDeleted: async () => {
      state.activeId = null;
      await refreshMeta();
      await refresh();
    },
    onLocate: (r) => {
      setView('map');
      setTimeout(() => {
        mapView.invalidate();
        mapView.focus(r.lat, r.lng);
        mapView.setActive(r.id);
      }, 60);
    },
  });
}

function openForm(record) {
  openRecordForm({
    dialog: $('#record-dialog'),
    record,
    mapView,
    onSaved: async (saved) => {
      state.activeId = saved.id;
      await refreshMeta();
      await refresh();
      if (saved.lat != null) {
        setView('map');
        setTimeout(() => {
          mapView.invalidate();
          mapView.focus(saved.lat, saved.lng, 17);
        }, 60);
      }
    },
  });
}

async function refreshMeta() {
  try {
    window.__cctvMeta = await api.meta();
    buildDatalists();
  } catch { /* the list refresh will surface any real problem */ }
}

boot().catch((error) => {
  document.body.append(el('p', { className: 'empty' }, `Could not start: ${error.message}`));
});
