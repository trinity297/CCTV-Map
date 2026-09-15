import { el, fmtPeriod, fmtDateTime, directionText, retentionWarning } from './util.js';
import { statusChip } from './detail.js';

function cameraSummary(record) {
  if (!record.cameras.length) return 'No cameras recorded';
  return record.cameras
    .map((c) => `${c.label}: ${directionText(c)}`)
    .join(' · ');
}

/** Renders the left-hand result cards. */
export function renderResults(host, records, { activeId, onSelect }) {
  host.replaceChildren();
  if (!records.length) {
    host.append(el('p', { className: 'empty' }, 'Nothing matches these filters yet.'));
    return;
  }

  for (const record of records) {
    const warning = retentionWarning(record);
    const card = el('button', {
      type: 'button',
      className: `result${record.id === activeId ? ' is-active' : ''}`,
      dataset: { id: record.id },
      attrs: { role: 'listitem' },
      onClick: () => onSelect(record),
    }, [
      el('div', { className: 'result__top' }, [
        el('span', { className: 'result__name' }, record.premises_name || record.address || 'Unnamed location'),
        statusChip(record.status),
      ]),
      record.address || record.postcode
        ? el('div', { className: 'result__line' }, [record.address, record.postcode].filter(Boolean).join(', '))
        : null,
      el('div', { className: 'result__line result__line--mono' },
        fmtPeriod(record.footage_start, record.footage_end) || 'Footage period not recorded'),
      el('div', { className: 'result__line' }, cameraSummary(record)),
      el('div', { className: 'result__tags' }, [
        record.reference ? el('span', { className: 'chip' }, record.reference) : null,
        record.operation ? el('span', { className: 'chip' }, record.operation) : null,
        record.lat == null ? el('span', { className: 'chip' }, 'No map pin') : null,
        warning?.expired ? el('span', { className: 'chip', style: { color: 'var(--warn)' } }, 'Original likely overwritten') : null,
      ]),
    ]);
    host.append(card);
  }
}

/** Renders the full-width table on the List tab. */
export function renderTable(table, records, { onSelect }) {
  const tbody = table.querySelector('tbody');
  tbody.replaceChildren();

  for (const record of records) {
    const tr = el('tr', {
      dataset: { id: record.id },
      onClick: () => onSelect(record),
      style: { cursor: 'pointer' },
    }, [
      el('td', { dataset: { label: 'Premises' } }, [
        el('div', { style: { fontWeight: '620' } }, record.premises_name || 'Unnamed location'),
        el('div', { className: 'muted', style: { fontSize: '12px' } },
          [record.address, record.postcode].filter(Boolean).join(', ')),
      ]),
      el('td', { dataset: { label: 'Ref' } }, [
        record.reference || el('span', { className: 'muted' }, '—'),
        record.operation ? el('div', { className: 'muted', style: { fontSize: '12px' } }, record.operation) : null,
      ]),
      el('td', { dataset: { label: 'Status' } }, statusChip(record.status)),
      el('td', { dataset: { label: 'Footage period' } },
        fmtPeriod(record.footage_start, record.footage_end) || el('span', { className: 'muted' }, '—')),
      el('td', { dataset: { label: 'Cameras' } },
        record.cameras.length
          ? el('div', {}, record.cameras.map((c) => el('div', { style: { fontSize: '12.5px' } }, `${c.label}: ${directionText(c)}`)))
          : el('span', { className: 'muted' }, 'none recorded')),
      el('td', { dataset: { label: 'Collected' } }, [
        fmtDateTime(record.collected_at) || el('span', { className: 'muted' }, '—'),
        record.collected_by ? el('div', { className: 'muted', style: { fontSize: '12px' } }, record.collected_by) : null,
      ]),
      el('td', {}, el('span', { className: 'muted' }, '›')),
    ]);
    tbody.append(tr);
  }
}
