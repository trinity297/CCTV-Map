import { el, fmtPeriod, metresText, compassLabel, directionText, toast } from './util.js';
import { statusChip } from './detail.js';
import { api } from './api.js';

function summaryLine(results, radiusM) {
  const facing = results.filter((r) => r.faces_target === true);
  const obtained = results.filter((r) => r.status === 'obtained');

  if (!results.length) {
    return el('div', { className: 'cov-summary cov-summary--miss' }, [
      el('strong', {}, 'Nothing on file.'),
      ' No CCTV has been logged within ',
      metresText(radiusM),
      ' of that point for the period you asked about. This enquiry still needs doing.',
    ]);
  }

  return el('div', { className: 'cov-summary cov-summary--hit' }, [
    el('strong', {}, results.length === 1
      ? '1 record already covers this.'
      : `${results.length} records already cover this.`),
    ' ',
    `${obtained.length} already obtained`,
    facing.length ? `, and ${facing.length} with a camera pointing at your spot` : '',
    '. Check these before making the visit.',
  ]);
}

function resultCard(result, onOpen) {
  const facing = result.faces_target === true;
  return el('article', {
    className: `cov-card${facing ? ' cov-card--facing' : ''}`,
    onClick: () => onOpen(result),
  }, [
    el('div', { className: 'cov-card__head' }, [
      el('span', { className: 'cov-card__name' }, result.premises_name || result.address || 'Unnamed location'),
      statusChip(result.status),
      el('span', { className: 'cov-card__dist' },
        `${metresText(result.distance_m)} away, bearing ${result.bearing_to_target}° ${compassLabel(result.bearing_to_target)}`),
    ]),
    el('div', { className: 'cov-card__body' }, [
      fmtPeriod(result.footage_start, result.footage_end) || 'Footage period not recorded',
      result.reference ? ` · ${result.reference}` : '',
      result.collected_by ? ` · collected by ${result.collected_by}` : '',
    ]),
    facing
      ? el('ul', { className: 'cov-card__cams' },
          result.facing_cameras.map((c) => el('li', {}, [
            el('b', {}, c.label), ` looks ${directionText(c)}`,
            c.covers ? ` — ${c.covers}` : '',
          ])))
      : result.faces_target === false
        ? el('p', { className: 'cov-card__cams', style: { listStyle: 'none', paddingLeft: '0' } },
            'Cameras here are recorded as pointing elsewhere — worth a look, but may not show your scene.')
        : el('p', { className: 'cov-card__cams', style: { listStyle: 'none', paddingLeft: '0' } },
            'No camera directions recorded for this location.'),
    result.storage_location ? el('div', { className: 'cov-card__body' }, `Stored at: ${result.storage_location}`) : null,
  ]);
}

export function createCoverageView({ root, mapView, onOpenRecord, onNeedMap }) {
  const form = root.querySelector('#coverage-form');
  const latlngInput = root.querySelector('#coverage-latlng');
  const pickButton = root.querySelector('#coverage-pick');
  const radiusInput = root.querySelector('#coverage-radius');
  const radiusOut = root.querySelector('#coverage-radius-out');
  const fromInput = root.querySelector('#coverage-from');
  const toInput = root.querySelector('#coverage-to');
  const resultsHost = root.querySelector('#coverage-results');

  let point = null;

  const showRadius = () => {
    const m = Number(radiusInput.value);
    radiusOut.textContent = metresText(m);
    if (point) mapView.showSearchArea(point.lat, point.lng, m);
  };
  radiusInput.addEventListener('input', showRadius);

  function setPoint(next) {
    point = next;
    latlngInput.value = `${next.lat.toFixed(6)}, ${next.lng.toFixed(6)}`;
    mapView.showSearchArea(next.lat, next.lng, Number(radiusInput.value));
  }

  pickButton.addEventListener('click', () => {
    onNeedMap();
    mapView.startPicking((p) => {
      setPoint(p);
      onNeedMap('coverage');
      toast('Pin dropped — now set the period and check.', 'ok');
    }, 'Click the map where your enquiry is');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!point) {
      toast('Drop a pin on the map first.', 'error');
      return;
    }
    resultsHost.replaceChildren(el('p', { className: 'empty' }, 'Checking…'));
    try {
      const { results } = await api.coverage({
        lat: point.lat,
        lng: point.lng,
        radius_m: Number(radiusInput.value),
        from: fromInput.value ? new Date(fromInput.value).toISOString() : '',
        to: toInput.value ? new Date(toInput.value).toISOString() : '',
      });
      resultsHost.replaceChildren(
        summaryLine(results, Number(radiusInput.value)),
        ...results.map((r) => resultCard(r, onOpenRecord)),
      );
    } catch (error) {
      resultsHost.replaceChildren(el('p', { className: 'empty' }, error.message));
    }
  });

  showRadius();

  return {
    setPoint,
    hasPoint: () => Boolean(point),
    refreshOverlay: showRadius,
  };
}
