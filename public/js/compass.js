import { el } from './util.js';
import { compassLabel } from './util.js';

const SIZE = 96;
const C = SIZE / 2;
const R = SIZE / 2 - 3;
const SVG_NS = 'http://www.w3.org/2000/svg';

const pointAt = (bearing, radius) => [
  C + radius * Math.sin((bearing * Math.PI) / 180),
  C - radius * Math.cos((bearing * Math.PI) / 180),
];

/** SVG path for the wedge a camera can see. */
export function wedgePath(bearing, fov) {
  const spread = Math.min(359.9, Math.max(5, fov || 60));
  const [x1, y1] = pointAt(bearing - spread / 2, R);
  const [x2, y2] = pointAt(bearing + spread / 2, R);
  const largeArc = spread > 180 ? 1 : 0;
  return `M ${C} ${C} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
}

/**
 * A click-and-drag compass dial. Returns the element plus a setter so the
 * numeric inputs and the dial stay in step.
 */
export function createCompass({ bearing, fov, onChange }) {
  let current = bearing;
  let currentFov = fov ?? 60;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('class', 'compass__cone');
  svg.setAttribute('aria-hidden', 'true');

  const wedge = document.createElementNS(SVG_NS, 'path');
  wedge.setAttribute('fill', 'currentColor');
  wedge.setAttribute('opacity', '0.22');
  svg.append(wedge);

  const needle = document.createElementNS(SVG_NS, 'line');
  needle.setAttribute('x1', C);
  needle.setAttribute('y1', C);
  needle.setAttribute('stroke', 'currentColor');
  needle.setAttribute('stroke-width', '2');
  needle.setAttribute('stroke-linecap', 'round');
  svg.append(needle);

  const readout = el('span', { className: 'compass__readout' });

  const dial = el('div', {
    className: 'compass',
    attrs: { role: 'slider', tabindex: '0', 'aria-label': 'Direction the camera looks', 'aria-valuemin': '0', 'aria-valuemax': '359' },
    style: { color: 'var(--accent)' },
  }, [
    el('span', { className: 'compass__label compass__n' }, 'N'),
    el('span', { className: 'compass__label compass__e' }, 'E'),
    el('span', { className: 'compass__label compass__s' }, 'S'),
    el('span', { className: 'compass__label compass__w' }, 'W'),
    svg,
    readout,
  ]);

  function paint() {
    if (current == null) {
      wedge.setAttribute('d', '');
      needle.setAttribute('x2', C);
      needle.setAttribute('y2', C);
      readout.textContent = '—';
      dial.removeAttribute('aria-valuenow');
      dial.setAttribute('aria-valuetext', 'Direction not recorded');
      return;
    }
    wedge.setAttribute('d', wedgePath(current, currentFov));
    const [nx, ny] = pointAt(current, R - 2);
    needle.setAttribute('x2', nx.toFixed(2));
    needle.setAttribute('y2', ny.toFixed(2));
    readout.textContent = compassLabel(current);
    dial.setAttribute('aria-valuenow', String(Math.round(current)));
    dial.setAttribute('aria-valuetext', `${Math.round(current)} degrees, ${compassLabel(current)}`);
  }

  function bearingFromEvent(event) {
    const rect = dial.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    return (((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;
  }

  function commit(value) {
    current = value == null ? null : ((value % 360) + 360) % 360;
    paint();
    onChange(current);
  }

  let dragging = false;
  dial.addEventListener('pointerdown', (event) => {
    dragging = true;
    dial.setPointerCapture(event.pointerId);
    commit(Math.round(bearingFromEvent(event)));
  });
  dial.addEventListener('pointermove', (event) => {
    if (dragging) commit(Math.round(bearingFromEvent(event)));
  });
  const endDrag = () => { dragging = false; };
  dial.addEventListener('pointerup', endDrag);
  dial.addEventListener('pointercancel', endDrag);

  dial.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 15 : 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') commit((current ?? 0) - step);
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') commit((current ?? 0) + step);
    else if (event.key === 'Home') commit(0);
    else if (event.key === 'Delete' || event.key === 'Backspace') commit(null);
    else return;
    event.preventDefault();
  });

  paint();

  return {
    node: dial,
    set(nextBearing, nextFov) {
      current = nextBearing;
      if (nextFov != null) currentFov = nextFov;
      paint();
    },
  };
}
