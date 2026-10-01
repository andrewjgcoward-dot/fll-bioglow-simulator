// Draws the robot from its configuration, in robot-local SVG units (mm):
// origin at the middle of the wheel axle, +x to the right, -y forward.
// Used both on the field (inside a rotated group) and in the Robot tab editor.

import { armGeom, DIR_ANGLE } from './sim.js';

const NS = 'http://www.w3.org/2000/svg';
const ARM_COLOR = '#FF8A3D';

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.appendChild(e);
  return e;
}

// angles: motor angles by port. opts: { editor, selected, colorFill, stroke }
export function drawRobot(g, cfg, angles, opts = {}) {
  g.textContent = '';
  const w = cfg.robotW, l = cfg.robotL, front = l - cfg.axleBack;
  const bodyMid = -(front - l / 2);
  const ed = !!opts.editor;
  const sel = (part) => ed && opts.selected === part;

  el('rect', { x: -w / 2, y: -front, width: w, height: l, rx: 16, fill: '#F5C518', stroke: opts.stroke || '#1A1A1A', 'stroke-width': 4 }, g);
  el('rect', { x: -w / 4, y: bodyMid - l * 0.18, width: w / 2, height: l * 0.36, rx: 8, fill: '#fff', stroke: '#1A1A1A', 'stroke-width': 4 }, g);
  el('rect', { x: -w * 0.3, y: -front - 4, width: w * 0.6, height: 14, rx: 4, fill: '#1A1A1A' }, g);
  // Wheels sit at the wheel spacing (track), centered on the axle; drag them in the editor.
  const wh = Math.max(30, cfg.wheel), tx = cfg.track / 2;
  for (const side of [-1, 1]) {
    const wg = el('g', { 'data-part': side < 0 ? 'wheel-l' : 'wheel-r', class: ed ? 'drag' : '' }, g);
    el('rect', { x: side * tx - 10, y: -wh / 2, width: 20, height: wh, rx: 4, fill: '#1A1A1A', stroke: sel('wheel') ? '#8FE3B0' : 'none', 'stroke-width': 5 }, wg);
  }
  if (ed) {
    const t = el('text', { x: 0, y: -front - 18, 'text-anchor': 'middle', class: 'ed-l' }, g); t.textContent = 'FRONT';
    el('line', { x1: -w / 2 - 24, y1: 0, x2: w / 2 + 24, y2: 0, stroke: '#1A1A1A', 'stroke-width': 2, 'stroke-dasharray': '6 6' }, g);
  }

  // Dials for attachment ports that have no arm drawn.
  const armed = new Set((cfg.arms || []).map(a => a.port));
  ['E', 'F'].filter(p => !armed.has(p) && !ed).forEach((port, i) => {
    const d = el('g', { transform: `translate(${(i ? 1 : -1) * w * 0.25} ${bodyMid + l * 0.28})` }, g);
    el('circle', { r: 20, fill: '#0B62AD', stroke: '#1A1A1A', 'stroke-width': 3 }, d);
    el('line', { x1: 0, y1: 0, x2: 0, y2: -16, stroke: '#fff', 'stroke-width': 5, 'stroke-linecap': 'round', transform: `rotate(${((angles[port] || 0) % 360).toFixed(1)})` }, d);
    const t = el('text', { 'text-anchor': 'middle', y: 42, class: 'dial-l' }, d); t.textContent = port;
  });

  for (const arm of cfg.arms || []) {
    const part = 'arm:' + arm.id;
    const a = el('g', { 'data-part': part, class: ed ? 'drag' : '' }, g);
    const geo = armGeom(arm, angles[arm.port] || 0);
    const rad = geo.ang * Math.PI / 180;
    if (ed) {
      // Reach: where the arm can get to (flat for a lift arm, the full circle for a sweep arm).
      if (arm.motion === 'sweep') el('circle', { cx: arm.x, cy: -arm.y, r: arm.len, fill: 'none', stroke: ARM_COLOR, 'stroke-width': 2, 'stroke-dasharray': '6 8', opacity: .7 }, a);
      else {
        const b = (DIR_ANGLE[arm.dir] || 0) * Math.PI / 180;
        el('line', { x1: arm.x, y1: -arm.y, x2: arm.x + Math.sin(b) * arm.len, y2: -(arm.y + Math.cos(b) * arm.len), stroke: ARM_COLOR, 'stroke-width': 14, 'stroke-linecap': 'round', opacity: .3 }, a);
      }
    }
    if (geo.proj > 2) {
      el('line', { x1: arm.x, y1: -arm.y, x2: arm.x + Math.sin(rad) * geo.proj, y2: -(arm.y + Math.cos(rad) * geo.proj), stroke: ARM_COLOR, 'stroke-width': 14, 'stroke-linecap': 'round', opacity: geo.solid ? 1 : .5 }, a);
    }
    el('circle', { cx: arm.x, cy: -arm.y, r: sel(part) ? 17 : 13, fill: '#0B62AD', stroke: sel(part) ? '#8FE3B0' : '#1A1A1A', 'stroke-width': sel(part) ? 6 : 3 }, a);
    const t = el('text', { x: arm.x, y: -arm.y + 7, 'text-anchor': 'middle', class: 'arm-l' }, a); t.textContent = arm.port;
  }

  const d = cfg.dist;
  const ds = el('g', { 'data-part': 'dist', class: ed ? 'drag' : '', transform: `translate(${d.x} ${-d.y}) rotate(${DIR_ANGLE[d.dir] || 0})` }, g);
  el('rect', { x: -24, y: -13, width: 48, height: 26, rx: 7, fill: '#1A1A1A', stroke: sel('dist') ? '#8FE3B0' : '#1A1A1A', 'stroke-width': sel('dist') ? 6 : 2 }, ds);
  el('circle', { cx: -11, cy: -1, r: 7, fill: '#fff' }, ds);
  el('circle', { cx: 11, cy: -1, r: 7, fill: '#fff' }, ds);
  if (ed) el('path', { d: 'M-8 -18 L0 -30 L8 -18 Z', fill: '#1A1A1A' }, ds);

  const c = cfg.color;
  const cs = el('g', { 'data-part': 'color', class: ed ? 'drag' : '' }, g);
  el('circle', { cx: c.x, cy: -c.y, r: sel('color') ? 16 : 13, fill: opts.colorFill || '#fff', stroke: sel('color') ? '#8FE3B0' : '#1A1A1A', 'stroke-width': sel('color') ? 6 : 4 }, cs);
}
