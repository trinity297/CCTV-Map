import { el, fmtDateTime, fmtPeriod, durationText, directionText, retentionWarning, toast } from './util.js';
import { api } from './api.js';

export function statusMeta(value) {
  const found = (window.__cctvMeta?.statuses || []).find((s) => s.value === value);
  return found || { value, label: value, hint: '' };
}

export function statusChip(status) {
  const meta = statusMeta(status);
  return el('span', {
    className: 'chip chip--status',
    style: { '--st': `var(--s-${status})` },
    title: meta.hint,
  }, meta.label);
}

function row(term, value) {
  if (value == null || value === '') return [];
  return [el('dt', {}, term), el('dd', {}, value)];
}

function retentionLine(record) {
  const warning = retentionWarning(record);
  if (!warning) return null;
  const when = fmtDateTime(warning.expires.toISOString());
  return warning.expired
    ? el('div', { className: 'warn-banner' },
        `On a ${record.retention_days}-day retention, the original footage from this period would have been overwritten around ${when}. This log may be the only surviving record that it existed.`)
    : el('div', { className: 'warn-banner' },
        `Original still on the system for roughly ${warning.daysLeft} more day${warning.daysLeft === 1 ? '' : 's'} (until about ${when}) if more is needed.`);
}

export function openDetail({ dialog, record, onEdit, onDeleted, onLocate }) {
  const title = record.premises_name || record.address || 'CCTV record';
  const period = fmtPeriod(record.footage_start, record.footage_end);
  const duration = durationText(record.footage_start, record.footage_end);

  const detail = el('div', { className: 'detail' }, [
    el('p', { className: 'detail__title' }, title),
    el('p', { className: 'detail__sub' }, [
      statusChip(record.status),
      ` ${[record.address, record.postcode].filter(Boolean).join(', ')}`,
    ]),

    retentionLine(record),

    el('dl', {}, [
      ...row('Footage period', period ? `${period}${duration ? ` (${duration})` : ''}` : 'Not recorded'),
      ...row('Collected on', fmtDateTime(record.collected_at)),
      ...row('Collected by', record.collected_by),
      ...row('Occurrence ref', record.reference),
      ...row('Operation', record.operation),
      ...row('Exhibit ref', record.exhibit_ref),
      ...row('Stored at', record.storage_location),
      ...row('System type', record.system_type),
      ...row('Retention', record.retention_days ? `${record.retention_days} days` : ''),
      ...row('Quality', record.quality),
      ...row('Media format', record.media_format),
      ...row('Covers', record.what_covered),
      ...row('Contact', [record.contact_name, record.contact_details].filter(Boolean).join(' — ')),
      ...row('Tags', record.tags),
      ...row('Map pin', record.lat == null ? '' : `${record.lat.toFixed(6)}, ${record.lng.toFixed(6)}`),
    ]),

    record.cameras.length
      ? el('div', {}, [
          el('h3', {}, `Cameras — ${record.cameras.length}`),
          ...record.cameras.map((camera) => el('div', { className: 'detail__cam' }, [
            el('b', {}, camera.label),
            `Looks ${directionText(camera)}`,
            camera.fov ? `, ${Math.round(camera.fov)}° field of view` : '',
            camera.range_m ? `, useful to about ${Math.round(camera.range_m)} m` : '',
            camera.covers ? el('div', { style: { marginTop: '2px' } }, camera.covers) : null,
          ])),
        ])
      : el('p', { className: 'field__help' }, 'No cameras recorded — add them so others can tell what this footage shows.'),

    record.notes
      ? el('div', {}, [el('h3', {}, 'Notes'), el('div', { className: 'detail__note' }, record.notes)])
      : null,

    el('div', {}, [
      el('h3', {}, 'Record history'),
      el('p', { className: 'field__help', id: 'detail-history' }, 'Loading…'),
    ]),
  ]);

  dialog.replaceChildren(
    el('div', { className: 'dialog__head' }, [
      el('h2', {}, 'CCTV record'),
      el('button', { type: 'button', className: 'icon-btn', attrs: { 'aria-label': 'Close' }, onClick: () => dialog.close() }, '×'),
    ]),
    el('div', { className: 'dialog__body' }, detail),
    el('div', { className: 'dialog__foot' }, [
      el('button', {
        type: 'button', className: 'btn btn--danger',
        onClick: async () => {
          if (!confirm(`Delete the record for "${title}"? This cannot be undone.`)) return;
          await api.remove(record.id);
          dialog.close();
          toast('Record deleted.', 'ok');
          onDeleted?.(record.id);
        },
      }, 'Delete'),
      el('span', { className: 'spacer' }),
      record.lat != null
        ? el('button', {
            type: 'button', className: 'btn',
            onClick: () => { dialog.close(); onLocate?.(record); },
          }, 'Show on map')
        : null,
      el('button', {
        type: 'button', className: 'btn btn--primary',
        onClick: () => { dialog.close(); onEdit?.(record); },
      }, 'Edit'),
    ]),
  );

  dialog.showModal();

  api.history(record.id)
    .then(({ history }) => {
      const node = dialog.querySelector('#detail-history');
      if (!node) return;
      node.textContent = history
        .map((h) => `${h.action} ${h.at ? fmtDateTime(h.at) : ''}${h.actor ? ` by ${h.actor}` : ''}`)
        .join(' · ') || 'No history recorded.';
    })
    .catch(() => {
      const node = dialog.querySelector('#detail-history');
      if (node) node.textContent = 'History unavailable.';
    });
}
