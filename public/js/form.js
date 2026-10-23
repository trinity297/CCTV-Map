import { $, el, toLocalInput, fromLocalInput, toast } from './util.js';
import { createPickerMap } from './map.js';
import { createAimMap } from './aim.js';
import { api, ApiError } from './api.js';

let uid = 0;
const nextId = () => `f${(uid += 1)}`;

function field(label, input, { help, span, id } = {}) {
  const inputId = id || nextId();
  input.id = inputId;
  const wrap = el('div', { className: `field${span ? ' span-2' : ''}` }, [
    el('label', { htmlFor: inputId }, label),
    input,
    help ? el('p', { className: 'field__help', style: { margin: '2px 0 0' } }, help) : null,
  ]);
  wrap.dataset.field = input.name || '';
  return wrap;
}

const textInput = (name, value = '', props = {}) =>
  el('input', { type: 'text', name, value: value ?? '', autocomplete: 'off', ...props });

const dtInput = (name, iso) =>
  el('input', { type: 'datetime-local', name, value: toLocalInput(iso) });

function select(name, options, value) {
  const node = el('select', { name });
  for (const option of options) {
    const opt = typeof option === 'string' ? { value: option, label: option } : option;
    node.append(el('option', { value: opt.value, selected: opt.value === value }, opt.label));
  }
  return node;
}

/* ------------------------------------------------------------- cameras */

function cameraRow(camera, { position, onRemove, onChange }) {
  const state = {
    id: camera.id,
    label: camera.label || '',
    bearing: camera.bearing ?? null,
    fov: camera.fov ?? 60,
    range_m: camera.range_m ?? 40,
    covers: camera.covers || '',
  };

  const bearingInput = el('input', {
    type: 'number', min: '0', max: '359', step: '1', placeholder: 'e.g. 270',
    value: state.bearing == null ? '' : String(Math.round(state.bearing)),
  });
  const fovInput = el('input', { type: 'number', min: '5', max: '360', step: '5', value: String(state.fov) });
  const rangeInput = el('input', { type: 'number', min: '1', max: '2000', step: '5', value: String(state.range_m) });
  const coversInput = textInput('', state.covers, { placeholder: 'e.g. front door and pavement outside' });
  const labelInput = textInput('', state.label, { placeholder: 'Camera name, e.g. "Cam 3 - rear yard"' });

  // Aiming happens on a map centred on the premises, so the direction is set
  // against real streets rather than as an abstract compass bearing.
  const aim = createAimMap({
    position,
    bearing: state.bearing,
    fov: state.fov,
    range: state.range_m,
    onChange: ({ bearing, range }) => {
      state.bearing = bearing;
      state.range_m = range;
      bearingInput.value = bearing == null ? '' : String(Math.round(bearing));
      rangeInput.value = String(Math.round(range));
      onChange();
    },
  });

  bearingInput.addEventListener('input', () => {
    const value = bearingInput.value === '' ? null : Number(bearingInput.value);
    state.bearing = value == null || Number.isNaN(value) ? null : ((value % 360) + 360) % 360;
    aim.set({ bearing: state.bearing });
    onChange();
  });
  fovInput.addEventListener('input', () => {
    state.fov = Number(fovInput.value) || 60;
    aim.set({ fov: state.fov });
    onChange();
  });
  rangeInput.addEventListener('input', () => {
    state.range_m = Number(rangeInput.value) || 40;
    aim.set({ range: state.range_m });
    onChange();
  });
  coversInput.addEventListener('input', () => { state.covers = coversInput.value; onChange(); });
  labelInput.addEventListener('input', () => { state.label = labelInput.value; onChange(); });

  const node = el('div', { className: 'camera' }, [
    el('div', { className: 'camera__head' }, [
      labelInput,
      el('button', {
        type: 'button', className: 'btn btn--ghost btn--sm',
        attrs: { 'aria-label': 'Remove this camera' },
        onClick: () => { node.remove(); onRemove(state.id); onChange(); },
      }, 'Remove'),
    ]),
    aim.node,
    el('div', { className: 'camera__numbers' }, [
      field('Looking towards (°)', bearingInput),
      field('Field of view (°)', fovInput),
      field('Sees about (m)', rangeInput),
    ]),
    field('What this camera covers', coversInput),
  ]);

  return { node, state, aim };
}

function camerasSection(initial, position, onChange) {
  const list = el('div', {});
  const states = [];
  const aims = [];

  function add(camera) {
    const row = cameraRow(camera, {
      position,
      onRemove: (id) => {
        const idx = states.findIndex((s) => s.id === id);
        if (idx >= 0) states.splice(idx, 1);
        const ai = aims.indexOf(row.aim);
        if (ai >= 0) aims.splice(ai, 1);
      },
      onChange,
    });
    states.push(row.state);
    aims.push(row.aim);
    list.append(row.node);
  }

  for (const camera of initial.length ? initial : []) add(camera);

  const addButton = el('button', {
    type: 'button', className: 'btn btn--ghost btn--block',
    onClick: () => {
      add({ id: crypto.randomUUID(), label: `Camera ${states.length + 1}`, bearing: null, fov: 60, range_m: 40, covers: '' });
      onChange();
    },
  }, '+ Add a camera');

  const wrap = el('div', { className: 'span-2' }, [
    el('p', { className: 'field__help' },
      'Click each mini-map towards whatever the camera looks at — that sets its direction and how far it sees. ' +
      'This is what lets someone else tell, at a glance, whether this footage covers their scene.'),
    list,
    addButton,
  ]);

  // Every camera map is centred on the premises, so they all follow the pin.
  const setPosition = (next) => aims.forEach((aim) => aim.setPosition(next));

  return { node: wrap, states, setPosition };
}

/* ---------------------------------------------------------------- form */

export function openRecordForm({ dialog, record, mapView, onSaved }) {
  const isEdit = Boolean(record?.id);
  const data = record || {};
  const position = { lat: data.lat ?? null, lng: data.lng ?? null };

  const latlngReadout = el('input', {
    type: 'text', readOnly: true,
    value: position.lat == null ? '' : `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`,
    placeholder: 'Click the map below to drop a pin',
  });

  const pickerHost = el('div', { className: 'picker' });
  let picker = null;

  const setPosition = ({ lat, lng }) => {
    position.lat = lat;
    position.lng = lng;
    latlngReadout.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    // Each camera aims relative to this pin, so move their maps with it.
    cameras.setPosition(position);
  };

  const cameras = camerasSection(data.cameras || [], position, () => {});

  const statuses = (window.__cctvMeta?.statuses || []).map((s) => ({ value: s.value, label: s.label }));
  const systemTypes = ['', ...(window.__cctvMeta?.systemTypes || [])];

  const body = el('div', { className: 'dialog__body' }, [
    el('div', { className: 'form-grid' }, [
      el('div', { className: 'form-section' }, 'Where the footage came from'),
      field('Premises / location name', textInput('premises_name', data.premises_name, { placeholder: 'e.g. Costcutter, 42 High Street' })),
      field('Postcode', textInput('postcode', data.postcode, { placeholder: 'e.g. M1 2AB' })),
      field('Address', el('textarea', { name: 'address', rows: 2, value: data.address || '' }), { span: true }),
      field('Map pin', latlngReadout, { span: true, help: 'Click the map to place it, or drag the marker to fine-tune.' }),
      el('div', { className: 'span-2' }, [pickerHost, el('p', { className: 'picker-note' }, 'Scroll to zoom. The pin is what makes this record findable by other investigators.')]),

      el('div', { className: 'form-section' }, 'The footage you collected'),
      field('Status', select('status', statuses, data.status || 'obtained')),
      field('Date and time you collected it', dtInput('collected_at', data.collected_at)),
      field('Footage covers from', dtInput('footage_start', data.footage_start)),
      field('Footage covers to', dtInput('footage_end', data.footage_end)),
      field('Collected by', textInput('collected_by', data.collected_by, { placeholder: 'Name / collar number' }), { span: true }),

      el('div', { className: 'form-section' }, 'Cameras and direction of view'),
      cameras.node,

      el('div', { className: 'form-section' }, 'The system'),
      field('System type', select('system_type', systemTypes.map((s) => ({ value: s, label: s || '—' })), data.system_type)),
      field('Retention (days before it overwrites)', el('input', {
        type: 'number', name: 'retention_days', min: '0', step: '1',
        value: data.retention_days ?? '', placeholder: 'e.g. 28',
      })),
      field('Quality / resolution', textInput('quality', data.quality, { placeholder: 'e.g. 1080p, good; or "poor, heavily compressed"' })),
      field('Media format', textInput('media_format', data.media_format, { placeholder: 'e.g. MP4 on USB, proprietary player' })),

      el('div', { className: 'form-section' }, 'References and where it is stored'),
      field('Occurrence / crime reference', textInput('reference', data.reference, { placeholder: 'e.g. 01/123456/26' })),
      field('Operation name', textInput('operation', data.operation)),
      field('Exhibit reference', textInput('exhibit_ref', data.exhibit_ref, { placeholder: 'e.g. AB/1' })),
      field('Stored at', textInput('storage_location', data.storage_location, { placeholder: 'e.g. Axon Evidence ref, or shelf / server path' })),

      el('div', { className: 'form-section' }, 'Premises contact'),
      field('Contact name', textInput('contact_name', data.contact_name)),
      field('Contact details', textInput('contact_details', data.contact_details, { placeholder: 'Phone / email' })),

      el('div', { className: 'form-section' }, 'Anything else'),
      field('What the system covers overall', textInput('what_covered', data.what_covered, { placeholder: 'e.g. shop floor, till, and the street outside' }), { span: true }),
      field('Tags', textInput('tags', data.tags, { placeholder: 'Comma separated, e.g. burglary, town centre' }), { span: true }),
      field('Notes', el('textarea', { name: 'notes', rows: 3, value: data.notes || '' }), { span: true }),
    ]),
  ]);

  const form = el('form', { method: 'dialog', noValidate: true }, [
    el('div', { className: 'dialog__head' }, [
      el('h2', {}, isEdit ? 'Edit CCTV record' : 'Log CCTV collected'),
      el('button', { type: 'button', className: 'icon-btn', attrs: { 'aria-label': 'Close' }, onClick: () => dialog.close() }, '×'),
    ]),
    body,
    el('div', { className: 'dialog__foot' }, [
      el('button', { type: 'button', className: 'btn', onClick: () => dialog.close() }, 'Cancel'),
      el('span', { className: 'spacer' }),
      el('button', { type: 'submit', className: 'btn btn--primary' }, isEdit ? 'Save changes' : 'Save record'),
    ]),
  ]);

  dialog.replaceChildren(form);
  dialog.showModal();

  picker = createPickerMap(pickerHost, position, setPosition);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd.entries());
    payload.lat = position.lat;
    payload.lng = position.lng;
    payload.footage_start = fromLocalInput(payload.footage_start);
    payload.footage_end = fromLocalInput(payload.footage_end);
    payload.collected_at = fromLocalInput(payload.collected_at);
    payload.cameras = cameras.states;

    for (const node of form.querySelectorAll('.field--error')) {
      node.classList.remove('field--error');
      node.querySelector('.field__error')?.remove();
    }

    try {
      const saved = isEdit ? await api.update(record.id, payload) : await api.create(payload);
      dialog.close();
      toast(isEdit ? 'Record updated.' : 'CCTV record saved.', 'ok');
      onSaved?.(saved);
    } catch (error) {
      if (error instanceof ApiError && error.fields) {
        let first = null;
        for (const [name, message] of Object.entries(error.fields)) {
          const input = form.querySelector(`[name="${CSS.escape(name)}"]`);
          const wrap = input?.closest('.field') || form.querySelector(`[data-field="${CSS.escape(name)}"]`);
          if (wrap) {
            wrap.classList.add('field--error');
            wrap.append(el('p', { className: 'field__error' }, message));
            first = first || wrap;
          } else {
            toast(message, 'error');
          }
        }
        first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        toast('Some details need fixing.', 'error');
      } else {
        toast(error.message, 'error');
      }
    }
  });

  dialog.addEventListener('close', () => { picker = null; }, { once: true });
  setTimeout(() => form.querySelector('input[name="premises_name"]')?.focus(), 80);
}
