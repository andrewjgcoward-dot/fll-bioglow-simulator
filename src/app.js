import { FW, FH, HOME_R, LINES, MISSIONS, TOKEN_PTS, missionPoints, totalScore } from './field.js';
import { PORTS, PAIRS, DEMO, flatToAst, emptyProgram } from './blocks.js';
import { programToJson, jsonToProgram } from './blocks-json.js';
import { createWorkspace, registerNames } from './workspace.js';
import { Sim, normalizeConfig, LOOSE_DEFAULTS, inside } from './sim.js';
import { drawRobot } from './robot-view.js';
import { importProject, exportLlsp3 } from './spike-io.js';

const SWATCH = { black: '#111111', violet: '#7A4FD6', white: '#F5F5F0', red: '#D9342B', blue: '#1E6FD9', green: '#2F8F4E', yellow: '#E8C21E', none: '#5B7066', magenta: '#C2329E', azure: '#3FA9F5' };
const demoProgram = () => DEMO();
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- state (program, robot and score survive a reload) ----------

const STORE = 'bioglow-sim-v2';
function load() {
  try {
    const v2 = JSON.parse(localStorage.getItem(STORE));
    if (v2) return v2;
    // Carry over settings (and the program) saved by the previous version.
    const v1 = JSON.parse(localStorage.getItem('bioglow-sim-v1'));
    if (v1) { delete v1.ws; if (Array.isArray(v1.program)) v1.program = flatToAst(v1.program); return v1; }
  } catch { /* storage unavailable or unreadable */ }
  return {};
}
const saved = load();
const state = {
  tab: 'code',
  program: saved.program && saved.program.stacks ? saved.program : demoProgram(),
  sounds: saved.sounds || {}, soundOn: saved.soundOn ?? true,
  ws: saved.ws || null,
  cfg: normalizeConfig(saved.cfg), sel: 'color',
  start: Object.assign({ x: 240, y: 240, h: 0 }, saved.start),
  pieces: Array.isArray(saved.pieces) ? saved.pieces : structuredClone(LOOSE_DEFAULTS),
  score: saved.score || {}, tokens: saved.tokens ?? 6, inspection: !!saved.inspection,
  grid: saved.grid ?? true, scale: 1
};
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      program: state.program, ws: state.ws, sounds: state.sounds, soundOn: state.soundOn, cfg: state.cfg, start: state.start, pieces: state.pieces,
      score: state.score, tokens: state.tokens, inspection: state.inspection, grid: state.grid
    }));
  } catch { /* storage unavailable: keep working without it */ }
}

const sim = new Sim(state.cfg, state.start, state.pieces);
sim.cfg = state.cfg; // share the object so Robot tab edits apply immediately
sim.onLog = () => renderLog();

// ---------- hub: light matrix, center light, buttons, variables, sound ----------

const matrixCells = [];
for (let i = 0; i < 25; i++) { const c = document.createElement('span'); $('r-matrix').appendChild(c); matrixCells.push(c); }
let lastVars = '';
function drawHub() {
  sim.matrix.forEach((b, i) => { matrixCells[i].style.background = b > 0 ? `rgba(255, 244, 214, ${0.25 + 0.75 * b / 100})` : '#2C2C2C'; });
  $('r-center').style.background = SWATCH[sim.centerLight] || '#F5F5F0';
  const lines = Object.entries(sim.vars).map(([k, v]) => `${k} = ${typeof v === 'number' ? +v.toFixed(3) : v}`)
    .concat(Object.entries(sim.lists).map(([k, l]) => `${k}: [${l.slice(0, 20).join(', ')}${l.length > 20 ? ', …' : ''}]`));
  const text = lines.join('\n');
  if (text !== lastVars) { lastVars = text; $('r-vars').textContent = text; $('r-vars-card').hidden = !text; }
}
for (const side of ['left', 'right']) {
  const b = $('hub-' + side);
  const set = (down) => { sim.setButton(side, down); b.classList.toggle('down', down); };
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); set(true); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => set(false));
  b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set(true); } });
  b.addEventListener('keyup', () => set(false));
}

// Beeps play as tones. Sounds from SPIKE's library play a short stand-in chirp for their length.
let audio = null, beepVoice = null;
const voices = new Set();
function audioCtx() { if (!audio) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audio = new AC(); } return audio; }
function tone(freq, seconds, volume, type) {
  const a = audioCtx(); if (!a || !state.soundOn) return null;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq; g.gain.value = 0.08 * volume / 100;
  o.connect(g).connect(a.destination); o.start();
  if (seconds) o.stop(a.currentTime + seconds / state.scale);
  voices.add(o); o.onended = () => voices.delete(o);
  return o;
}
sim.onSound = (e) => {
  if (e.type === 'stop') { for (const o of voices) { try { o.stop(); } catch { /* already stopped */ } } voices.clear(); beepVoice = null; return; }
  if (e.type === 'beep') {
    if (beepVoice) { try { beepVoice.stop(); } catch { /* already stopped */ } }
    beepVoice = tone(440 * Math.pow(2, (e.note - 69) / 12), e.seconds, e.volume, 'square');
  } else if (e.type === 'sound') {
    const secs = Math.min(e.seconds, 1.5), o = tone(500, secs, e.volume, 'triangle');
    if (o) o.frequency.exponentialRampToValueAtTime(1200, audioCtx().currentTime + secs / state.scale);
  }
};
function renderSoundToggle() {
  $('sound').setAttribute('aria-pressed', String(state.soundOn));
  $('sound').setAttribute('aria-label', state.soundOn ? 'Sound on' : 'Sound off');
}
$('sound').onclick = () => { state.soundOn = !state.soundOn; if (!state.soundOn) sim.onSound({ type: 'stop' }); renderSoundToggle(); save(); };
renderSoundToggle();
sim.log('Ready. Press Run to try the program.');

// ---------- field (SVG in millimetres; y flipped so +y points away from home) ----------

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const Y = (y) => FH - y;
const field = $('field');
const refs = {};

function buildField() {
  field.innerHTML = '';
  svgEl('rect', { x: 0, y: 0, width: FW, height: FH, fill: '#2D5A3B' }, field);
  svgEl('path', { d: `M0 ${FH} L0 ${FH - HOME_R} A${HOME_R} ${HOME_R} 0 0 1 ${HOME_R} ${FH} Z`, fill: '#F3F1EA', stroke: '#D9342B', 'stroke-width': 8 }, field);
  svgEl('path', { d: `M${FW} ${FH} L${FW} ${FH - HOME_R} A${HOME_R} ${HOME_R} 0 0 0 ${FW - HOME_R} ${FH} Z`, fill: '#F3F1EA', stroke: '#1E6FD9', 'stroke-width': 8 }, field);
  refs.grid = svgEl('g', { 'pointer-events': 'none' }, field);
  for (let x = 200; x < FW; x += 200) svgEl('line', { x1: x, y1: 0, x2: x, y2: FH, stroke: 'rgba(255,255,255,.18)', 'stroke-width': 2 }, refs.grid);
  for (let y = 200; y < FH; y += 200) svgEl('line', { x1: 0, y1: Y(y), x2: FW, y2: Y(y), stroke: 'rgba(255,255,255,.18)', 'stroke-width': 2 }, refs.grid);
  'ABCDEFGHIJ'.split('').forEach((c, i) => { const t = svgEl('text', { x: i * 200 + 100, y: FH - 14, 'text-anchor': 'middle', class: 'gl' }, refs.grid); t.textContent = c; });
  for (let r = 1; r <= 6; r++) { const t = svgEl('text', { x: 18, y: Y(r === 6 ? 1071 : r * 200 - 100) + 8, 'text-anchor': 'middle', class: 'gl' }, refs.grid); t.textContent = r; }
  for (const L of LINES) svgEl('polyline', { points: L.map(([x, y]) => `${x},${Y(y)}`).join(' '), fill: 'none', stroke: '#0A0A0A', 'stroke-width': 20, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, field);
  refs.objs = svgEl('g', {}, field); refs.objEls = [];
  refs.trail = svgEl('polyline', { fill: 'none', stroke: '#8FE3B0', 'stroke-width': 6, 'stroke-opacity': .7, 'stroke-dasharray': '2 10', 'stroke-linecap': 'round', 'pointer-events': 'none' }, field);
  refs.seen = svgEl('g', { 'pointer-events': 'none' }, field); refs.seenPaths = {};
  refs.beam = svgEl('line',{ stroke: 'rgba(143,227,176,.6)', 'stroke-width': 4, 'pointer-events': 'none' }, field);
  refs.robot = svgEl('g', { 'pointer-events': 'none' }, field);
  const style = svgEl('style', {}, field);
  style.textContent = '.gl{font:600 26px "JetBrains Mono",monospace;fill:rgba(255,255,255,.55)} .model-l{font:700 28px "JetBrains Mono",monospace;fill:#3B2F1E} .dock-l{font:700 24px "JetBrains Mono",monospace;fill:#F2C48A} .piece{cursor:grab;touch-action:none} .piece-l{font:700 28px "JetBrains Mono",monospace;fill:#2A1747} .dial-l{font:700 22px "JetBrains Mono",monospace;fill:#1A1A1A} .arm-l{font:700 20px "JetBrains Mono",monospace;fill:#fff}';
}

// Mission models, docks and loose pieces come from the simulation, since they can move.
function drawObject(o) {
  const g = svgEl('g', {});
  if (o.dock) {
    svgEl('rect', { x: -o.w / 2, y: -o.h / 2, width: o.w, height: o.h, rx: 8, fill: 'rgba(242,196,138,.18)', stroke: '#F2C48A', 'stroke-width': 4, 'stroke-dasharray': '12 8' }, g);
    g.label = svgEl('text', { 'text-anchor': 'middle', y: 8, class: 'dock-l' }, g); g.label.textContent = '13–15';
    return g;
  }
  const shape = o.round ? svgEl('ellipse', { rx: o.w / 2, ry: o.h / 2 }, g) : svgEl('rect', { x: -o.w / 2, y: -o.h / 2, width: o.w, height: o.h, rx: 6 }, g);
  shape.setAttribute('fill', o.loose ? '#C9A3FF' : '#E9DDBF');
  shape.setAttribute('stroke', o.loose ? '#2A1747' : '#3B2F1E'); shape.setAttribute('stroke-width', 4);
  if (o.loose) g.setAttribute('class', 'piece');
  svgEl('title', {}, g).textContent = o.name + (o.loose ? ' (drag to move)' : '');
  if (o.n) { g.label = svgEl('text', { 'text-anchor': 'middle', y: 9, class: o.loose ? 'piece-l' : 'model-l' }, g); g.label.textContent = o.n; }
  return g;
}

function syncObjects() {
  const objs = sim.objects;
  if (refs.objEls.length !== objs.length || refs.objEls.some((g, i) => g.obj !== objs[i])) {
    refs.objs.innerHTML = '';
    refs.objEls = objs.map(o => { const g = drawObject(o); g.obj = o; refs.objs.appendChild(g); return g; });
  }
  for (const g of refs.objEls) {
    const o = g.obj;
    g.setAttribute('transform', `translate(${o.x.toFixed(1)} ${Y(o.y).toFixed(1)}) rotate(${o.r.toFixed(1)})`);
    if (g.label) g.label.setAttribute('transform', `rotate(${(-o.r).toFixed(1)})`);
  }
}

function drawField() {
  const p = sim.pose, s = sim.sens;
  syncObjects();
  refs.robot.setAttribute('transform', `translate(${p.x} ${Y(p.y)}) rotate(${p.h})`);
  drawRobot(refs.robot, state.cfg, sim.arms, { stroke: sim.hit ? '#F2A6A0' : sim.running ? '#8FE3B0' : '#1A1A1A', colorFill: SWATCH[s.color] || '#5B7066' });
  refs.trail.setAttribute('points', sim.trail.map(([x, y]) => `${x.toFixed(0)},${Y(y).toFixed(0)}`).join(' '));
  // Dots where the color sensor saw something other than plain mat (one path per color).
  const byColor = {};
  for (const [x, y, c] of sim.seen) (byColor[c] = byColor[c] || []).push(`M${x.toFixed(0)} ${Y(y).toFixed(0)}h0`);
  for (const c of new Set(Object.keys(byColor).concat(Object.keys(refs.seenPaths)))) {
    if (!refs.seenPaths[c]) refs.seenPaths[c] = svgEl('path', { fill: 'none', stroke: SWATCH[c] || '#999', 'stroke-width': 14, 'stroke-linecap': 'round', 'stroke-opacity': .9 }, refs.seen);
    refs.seenPaths[c].setAttribute('d', (byColor[c] || []).join(''));
  }
  const a = s.dirAng * Math.PI / 180, o = s.origin;
  refs.beam.setAttribute('x1', o[0]); refs.beam.setAttribute('y1', Y(o[1]));
  refs.beam.setAttribute('x2', o[0] + Math.sin(a) * s.rayLen); refs.beam.setAttribute('y2', Y(o[1] + Math.cos(a) * s.rayLen));
  refs.grid.style.display = state.grid ? '' : 'none';

  $('r-cport').textContent = state.cfg.colorPort; $('r-dport').textContent = state.cfg.distPort;
  $('r-swatch').style.background = SWATCH[s.color] || '#5B7066'; $('r-color').textContent = s.color;
  $('r-dist').textContent = s.dist === null ? 'none (over 200 cm)' : s.dist.toFixed(1) + ' cm';
  $('r-yaw').textContent = Math.round(s.yaw) + '°';
  $('r-arms').textContent = Math.round(sim.arms.E) + '° · ' + Math.round(sim.arms.F) + '°';
  $('r-display').textContent = sim.display || '—';
  drawHub();
  $('pos').textContent = `Or click the mat. Now at x ${(p.x / 10).toFixed(1)} cm, y ${(p.y / 10).toFixed(1)} cm, heading ${Math.round(((p.h % 360) + 360) % 360)}°`;
  const left = 150 - sim.matchT;
  $('clock').textContent = sim.clockText();
  $('clock').classList.toggle('low', sim.matchOn && left <= 15);
  $('match').classList.toggle('on', sim.matchOn);
  $('match-label').textContent = sim.matchOn ? 'End match' : 'Start 2:30 match';
  // Light up the block that is running.
  const lit = new Set(sim.activeIds());
  if (ws && [...lit].join() !== [...lastLit].join()) {
    for (const id of lastLit) { const b = !lit.has(id) && ws.getBlockById(id); if (b) b.getSvgRoot().classList.remove('sim-running'); }
    for (const id of lit) { const b = ws.getBlockById(id); if (b) b.getSvgRoot().classList.add('sim-running'); }
    lastLit = lit;
  }
}

function renderLog() { $('log').innerHTML = sim.logLines.map(l => `<div>${esc(l)}</div>`).join(''); }

function renderStart() {
  $('sx').value = +(state.start.x / 10).toFixed(1); $('sy').value = +(state.start.y / 10).toFixed(1); $('sh').value = state.start.h;
  const left = state.start.x < FW / 2;
  document.querySelectorAll('#side button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.side === 'left') === left)));
}

function setStart(patch) {
  Object.assign(state.start, patch); sim.start = state.start; save(); renderStart();
  if (!sim.running) { sim.placeRobot(); drawField(); }
}

// Mirror the start position onto the other half of the table (same spot in the other home).
const normDeg = (d) => { d = ((d % 360) + 360) % 360; return d > 180 ? d - 360 : d; };
$('side').addEventListener('click', (e) => {
  const b = e.target.closest('[data-side]'); if (!b || sim.running) return;
  const left = state.start.x < FW / 2;
  if ((b.dataset.side === 'left') !== left) setStart({ x: FW - state.start.x, h: normDeg(-state.start.h) });
});

// ---------- code tab (drag-and-drop blocks) ----------

let ws = null, lastLit = new Set(), loadingWs = false;

// Show a program in the block editor (after an import, the demo, or Clear).
function showProgram(program) {
  if (!ws) { state.program = program; save(); return; }
  registerNames(program);
  loadingWs = true;
  try { window.Blockly.serialization.workspaces.load(programToJson(program), ws); } finally { loadingWs = false; }
  syncProgram();
}

// Statements in the program (stacks and My Blocks), for the status line.
function countBlocks(prog) {
  const count = (list) => list.reduce((n, s) => n + 1 + count(s.body || []) + count(s.else || []), 0);
  return prog.stacks.reduce((n, st) => n + count(st), 0) + Object.values(prog.procs).reduce((n, p) => n + count(p.body), 0);
}

// Read the program back out of the editor whenever the kids change it.
function syncProgram() {
  const json = window.Blockly.serialization.workspaces.save(ws);
  const res = jsonToProgram(json);
  res.program.sounds = state.sounds; // sound lengths from the last imported file
  state.program = res.program; state.ws = json;
  const n = countBlocks(res.program);
  $('code-status').textContent = `${n} block${n === 1 ? '' : 's'}` + (res.warn.length ? ' · ' + res.warn[0] : '');
  save();
}

function initCode() {
  $('tab-code').innerHTML = `
    <div class="code-head">
      <span class="muted" id="code-status"></span>
      <div class="row"><button type="button" class="ghost" data-act="demo">Demo</button><button type="button" class="ghost" data-act="clear">Clear</button></div>
    </div>
    <div id="blockly"></div>
    <div class="fine">Drag blocks out of the menu and snap them under “when program starts”. Drag a block back to the menu to delete it.</div>`;
  try { ws = createWorkspace($('blockly')); }
  catch (err) { $('blockly').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  let loaded = false;
  if (state.ws) {
    try { registerNames(state.program); loadingWs = true; window.Blockly.serialization.workspaces.load(state.ws, ws); loaded = true; }
    catch { /* saved layout from an older version: rebuild from the program */ }
    finally { loadingWs = false; }
  }
  if (loaded) syncProgram(); else showProgram(state.program);
  ws.addChangeListener((e) => { if (!e.isUiEvent && !loadingWs) syncProgram(); });
}

$('tab-code').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]'); if (!btn) return;
  if (btn.dataset.act === 'demo') { showProgram(demoProgram()); setStart({ x: 240, y: 240, h: 0 }); }
  else if (btn.dataset.act === 'clear') showProgram(emptyProgram());
});

// ---------- score tab ----------

function renderScore() {
  const sc = state.score;
  const total = totalScore(sc, state.tokens, state.inspection);
  $('total-tab').textContent = total;
  $('tab-score').innerHTML = `
    <div class="score-total"><div><div class="section-h">Match score</div><div class="fine">Tick what your robot actually achieved.</div></div><div class="big">${total}</div></div>
    <label class="line"><input type="checkbox" data-insp${state.inspection ? ' checked' : ''}><span class="grow">Equipment inspection: everything fits in one launch area, under 305 mm</span><span class="mono">20</span></label>
    <div class="line"><span class="grow">Precision tokens left (lose one per interruption outside home)</span>
      <button type="button" class="step" data-tok="-1" aria-label="Remove a precision token">−</button><span class="mono">${state.tokens}</span>
      <button type="button" class="step" data-tok="1" aria-label="Add a precision token">+</button><span class="mono">${TOKEN_PTS[state.tokens]}</span></div>
    ${MISSIONS.map(m => `<div class="mission">
      <div class="mission-h"><span class="mid">${m.id}</span><strong class="grow">${esc(m.name)}</strong>${m.noEquip ? '<span class="tag">not touching equipment</span>' : ''}<span class="mono">${missionPoints(m, sc)}</span></div>
      ${m.items.map(it => `<div class="mitem">${it.count
        ? `<span class="grow">${esc(it.label)}</span><button type="button" class="step" data-cnt="${it.k}" data-d="-1" aria-label="Fewer">−</button><span class="mono">${sc[it.k] || 0}</span><button type="button" class="step" data-cnt="${it.k}" data-d="1" aria-label="More">+</button>`
        : `<label><input type="checkbox" data-chk="${it.k}" data-group="${it.group || ''}"${sc[it.k] ? ' checked' : ''}><span>${esc(it.label)}</span></label>`
      }<span class="pts">${it.zero ? '×0' : it.count ? it.pts + ' ea' : it.pts}</span></div>`).join('')}
    </div>`).join('')}
    <button type="button" class="btn" data-clear-score>Clear score sheet</button>
    <div class="fine">Point values from the 2026–27 BioGlow Robot Game Rulebook. Check the official Challenge Updates for changes. Gracious Professionalism® points are scored separately.</div>`;
}
$('tab-score').addEventListener('change', (e) => {
  const t = e.target;
  if (t.hasAttribute('data-insp')) state.inspection = t.checked;
  else if (t.dataset.chk) {
    if (t.checked && t.dataset.group) for (const m of MISSIONS) for (const it of m.items) if (it.group === t.dataset.group) state.score[it.k] = false;
    state.score[t.dataset.chk] = t.checked;
  }
  save(); renderScore();
});
$('tab-score').addEventListener('click', (e) => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.dataset.tok) state.tokens = Math.max(0, Math.min(6, state.tokens + +t.dataset.tok));
  else if (t.dataset.cnt) state.score[t.dataset.cnt] = Math.max(0, Math.min(20, (state.score[t.dataset.cnt] || 0) + +t.dataset.d));
  else if (t.hasAttribute('data-clear-score')) { state.score = {}; state.inspection = false; state.tokens = 6; }
  else return;
  save(); renderScore();
});

// ---------- robot tab ----------

const NUM_FIELDS = [['wheel', 'Wheel diameter (mm)'], ['track', 'Wheel spacing (mm)'], ['top', 'Top wheel speed (°/s)'], ['robotW', 'Robot width (mm)'], ['robotL', 'Robot length (mm)'], ['axleBack', 'Wheels from back edge (mm)']];
const FACES = ['front', 'right', 'back', 'left'];
const SNAP = 5, REACH = 260;
const opt = (opts, cur, label = (o) => o) => opts.map(o => `<option value="${o}"${o === cur ? ' selected' : ''}>${esc(label(o))}</option>`).join('');

function renderRobot() {
  const c = state.cfg;
  $('tab-robot').innerHTML = `
    <div class="section-h">Robot layout</div>
    <div class="fine">Drag the color sensor (circle), distance sensor (eyes) and arms (orange, blue pivot). Tap one to change it. Positions snap to ${SNAP} mm.</div>
    <svg id="robot-editor" viewBox="${-REACH} ${-REACH} ${REACH * 2} ${REACH * 2}" role="img" aria-label="Top view of the robot. Drag parts to place them."></svg>
    <div class="row"><button type="button" class="btn small" data-add-arm>Add arm</button><span class="muted" id="ed-pos"></span></div>
    <div id="part-props" class="props"></div>
    <div class="section-h">Drive base</div>
    <div class="form-grid">${NUM_FIELDS.map(([k, label]) => `<label>${label}<input type="number" step="any" data-cfgnum="${k}" value="${c[k]}"></label>`).join('')}
      <label>Drive motors (left, right)<select data-cfg="pair">${opt(PAIRS, c.pair)}</select></label>
      <label>Force sensor port (front bumper)<select data-cfg="forcePort">${opt(['none'].concat(PORTS), c.forcePort)}</select></label>
    </div>
    <label class="check"><input type="checkbox" data-cfgbool="yawCW"${c.yawCW ? ' checked' : ''}>Yaw angle increases when turning clockwise</label>
    <label class="check"><input type="checkbox" data-cfgbool="collide"${c.collide ? ' checked' : ''}>Models and pieces are solid (off: drive through everything)</label>
    <label class="check"><input type="checkbox" data-cfgbool="shove"${c.shove ? ' checked' : ''}>Robot can shove fixed mission models (just for fun; real ones are held down)</label>
    <label class="check"><input type="checkbox" data-grid${state.grid ? ' checked' : ''}>Show the 20 cm wireframe grid</label>
    <div class="fine">Importing a SPIKE file sets the drive motors and sensor ports from its blocks. Arms push loose pieces and stop when they press on a model or the mat; mission mechanisms themselves aren't simulated yet. Model positions are traced from the wireframe and are approximate.</div>`;
  renderEditor(); renderProps();
}

function renderEditor() {
  const svg = $('robot-editor'); if (!svg) return;
  svg.textContent = '';
  const NS = 'http://www.w3.org/2000/svg';
  const grid = document.createElementNS(NS, 'g'); svg.appendChild(grid);
  for (let v = -REACH + 10; v < REACH; v += 50) {
    for (const [x1, y1, x2, y2] of [[v, -REACH, v, REACH], [-REACH, v, REACH, v]]) {
      const l = document.createElementNS(NS, 'line');
      Object.entries({ x1, y1, x2, y2, stroke: 'rgba(255,255,255,.08)', 'stroke-width': 2 }).forEach(([k, val]) => l.setAttribute(k, val));
      grid.appendChild(l);
    }
  }
  const g = document.createElementNS(NS, 'g'); svg.appendChild(g);
  drawRobot(g, state.cfg, {}, { editor: true, selected: state.sel });
}

function partOf(sel) {
  if (sel === 'color') return state.cfg.color;
  if (sel === 'dist') return state.cfg.dist;
  if (sel && sel.startsWith('arm:')) return state.cfg.arms.find(a => a.id === sel.slice(4));
  return null;
}

function renderProps() {
  const box = $('part-props'); if (!box) return;
  const c = state.cfg, part = partOf(state.sel);
  if (!part) { box.innerHTML = '<div class="fine">Tap a part to edit it.</div>'; return; }
  const xy = `<label>Right of axle middle (mm)<input type="number" step="${SNAP}" data-pp="x" value="${part.x}"></label>
              <label>Ahead of axle (mm)<input type="number" step="${SNAP}" data-pp="y" value="${part.y}"></label>`;
  if (state.sel === 'color') {
    box.innerHTML = `<div class="props-h">Color sensor</div><div class="form-grid">
      <label>Port<select data-cfg="colorPort">${opt(PORTS, c.colorPort)}</select></label>${xy}</div>`;
  } else if (state.sel === 'dist') {
    box.innerHTML = `<div class="props-h">Distance sensor</div><div class="form-grid">
      <label>Port<select data-cfg="distPort">${opt(PORTS, c.distPort)}</select></label>
      <label>Faces<select data-pp="dir">${opt(FACES, part.dir)}</select></label>${xy}</div>`;
  } else {
    const lift = part.motion !== 'sweep';
    box.innerHTML = `<div class="props-h">Arm on motor ${esc(part.port)}</div><div class="form-grid">
      <label>Motor port<select data-pp="port">${opt(PORTS, part.port)}</select></label>
      <label>Movement<select data-pp="motion">${opt(['lift', 'sweep'], part.motion, o => o === 'lift' ? 'Lift / press (up and down)' : 'Sweep (side to side, flat)')}</select></label>
      <label>Points<select data-pp="dir">${opt(FACES, part.dir)}</select></label>
      <label>Length (mm)<input type="number" step="${SNAP}" data-pp="len" value="${part.len}"></label>
      ${lift
        ? `<label>Starts<select data-pp="rest">${opt(['up', 'down'], part.rest)}</select></label>
           <label>Motor clockwise<select data-pp="cw">${opt(['lowers', 'raises'], part.cw)}</select></label>`
        : `<label>Motor clockwise swings<select data-pp="cw">${opt(['right', 'left'], part.cw)}</select></label>`}
      <label>Gear ratio (arm ° per motor °)<input type="number" step="any" data-pp="ratio" value="${part.ratio}"></label>
      ${xy}</div>
      <button type="button" class="btn small red" data-remove-arm>Remove this arm</button>`;
  }
}

function robotChanged() { save(); sim.sens = sim.readSensors(sim.pose); drawField(); renderEditor(); }

$('tab-robot').addEventListener('change', (e) => {
  const t = e.target, part = partOf(state.sel);
  if (t.dataset.cfgnum) { const v = parseFloat(t.value); if (isFinite(v) && v > 0) state.cfg[t.dataset.cfgnum] = v; }
  else if (t.dataset.cfg) state.cfg[t.dataset.cfg] = t.value;
  else if (t.dataset.cfgbool) state.cfg[t.dataset.cfgbool] = t.checked;
  else if (t.hasAttribute('data-grid')) state.grid = t.checked;
  else if (t.dataset.pp && part) {
    const k = t.dataset.pp;
    if (['x', 'y', 'len', 'ratio'].includes(k)) {
      const v = parseFloat(t.value);
      if (isFinite(v) && (k === 'x' || k === 'y' || v > 0)) part[k] = k === 'x' || k === 'y' ? Math.max(-REACH + 10, Math.min(REACH - 10, v)) : v;
    } else {
      part[k] = t.value;
      if (k === 'motion') part.cw = t.value === 'sweep' ? 'right' : 'lowers';
      renderProps();
    }
  }
  robotChanged();
});

$('tab-robot').addEventListener('click', (e) => {
  if (e.target.closest('[data-add-arm]')) {
    const used = new Set(state.cfg.arms.map(a => a.port).concat(state.cfg.pair.split(''), [state.cfg.colorPort, state.cfg.distPort]));
    const port = ['E', 'F', 'D', 'C', 'B', 'A'].find(p => !used.has(p)) || 'F';
    const arm = { id: 'a' + Date.now().toString(36), port, motion: 'lift', x: 0, y: state.cfg.robotL - state.cfg.axleBack, dir: 'front', len: 90, rest: 'up', cw: 'lowers', ratio: 1 };
    state.cfg.arms.push(arm); state.sel = 'arm:' + arm.id; renderProps(); robotChanged();
  } else if (e.target.closest('[data-remove-arm]')) {
    state.cfg.arms = state.cfg.arms.filter(a => 'arm:' + a.id !== state.sel); state.sel = 'color'; renderProps(); robotChanged();
  }
});

// Dragging parts in the editor (mouse, pen or touch).
let edDrag = null;
const edPoint = (e) => {
  const svg = $('robot-editor'); const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: loc.x, y: -loc.y };
};
const snapMm = (v) => Math.max(-REACH + 10, Math.min(REACH - 10, Math.round(v / SNAP) * SNAP));
$('tab-robot').addEventListener('pointerdown', (e) => {
  const hit = e.target.closest('#robot-editor [data-part]'); if (!hit) return;
  state.sel = hit.dataset.part; const part = partOf(state.sel); if (!part) return;
  const p = edPoint(e);
  edDrag = { part, dx: part.x - p.x, dy: part.y - p.y };
  try { $('robot-editor').setPointerCapture(e.pointerId); } catch { /* pointer gone */ }
  e.preventDefault(); renderEditor(); renderProps();
});
$('tab-robot').addEventListener('pointermove', (e) => {
  if (!edDrag) return;
  const p = edPoint(e);
  edDrag.part.x = snapMm(p.x + edDrag.dx); edDrag.part.y = snapMm(p.y + edDrag.dy);
  $('ed-pos').textContent = `${edDrag.part.x} mm right, ${edDrag.part.y} mm ahead of the axle`;
  renderEditor(); drawField();
});
const edEnd = () => { if (!edDrag) return; edDrag = null; renderProps(); robotChanged(); };
$('tab-robot').addEventListener('pointerup', edEnd);
$('tab-robot').addEventListener('pointercancel', edEnd);

// ---------- tabs, toolbar, start position ----------

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  state.tab = b.dataset.tab;
  document.querySelectorAll('.tabs [data-tab]').forEach(x => x.setAttribute('aria-selected', String(x.dataset.tab === state.tab)));
  for (const t of ['code', 'score', 'robot']) $('tab-' + t).hidden = t !== state.tab;
  if (state.tab === 'code' && ws) window.Blockly.svgResize(ws);
});

// Read the blocks right before running/exporting, so the newest edits always count.
const latestProgram = () => { if (ws) syncProgram(); return state.program; };
$('run').onclick = () => { const a = audioCtx(); if (a && a.state === 'suspended') a.resume(); sim.run(latestProgram()); drawField(); };
$('stop').onclick = () => { if (sim.stop()) { state.tokens = Math.max(0, state.tokens - 1); save(); renderScore(); } drawField(); };
$('reset').onclick = () => { sim.reset(); sim.log('Robot back at the start position.'); drawField(); };
$('match').onclick = () => {
  if (sim.matchOn) sim.endMatch();
  else { sim.startMatch(); state.tokens = 6; save(); renderScore(); }
  renderLog(); drawField();
};
$('scales').addEventListener('click', (e) => {
  const b = e.target.closest('[data-scale]'); if (!b) return;
  state.scale = +b.dataset.scale;
  document.querySelectorAll('#scales button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
});
$('sx').onchange = (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) setStart({ x: Math.max(0, Math.min(FW, v * 10)) }); };
$('sy').onchange = (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) setStart({ y: Math.max(0, Math.min(FH, v * 10)) }); };
$('sh').onchange = (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) setStart({ h: v }); };
const toMm = (e) => { const r = field.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * FW, (1 - (e.clientY - r.top) / r.height) * FH]; };

// Drag loose pieces (any time the robot isn't running); a plain click places the robot.
let drag = null, dragged = false;
field.addEventListener('pointerdown', (e) => {
  if (sim.running) return;
  const pt = toMm(e);
  const o = sim.objects.slice().reverse().find(o => o.loose && inside(pt, o));
  if (!o) return;
  drag = { o, dx: o.x - pt[0], dy: o.y - pt[1] }; dragged = true; // a tap on a piece never moves the robot
  try { field.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  e.preventDefault();
});
field.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const pt = toMm(e); const o = drag.o;
  o.x = Math.max(o.w / 2, Math.min(FW - o.w / 2, pt[0] + drag.dx));
  o.y = Math.max(o.h / 2, Math.min(FH - o.h / 2, pt[1] + drag.dy));
  const lp = state.pieces.find(p => p.id === o.id); if (lp) { lp.x = Math.round(o.x); lp.y = Math.round(o.y); lp.r = Math.round(o.r); }
  dragged = true; drawField();
});
const endDrag = () => { if (!drag) return; drag = null; save(); sim.sens = sim.readSensors(sim.pose); drawField(); };
field.addEventListener('pointerup', endDrag);
field.addEventListener('pointercancel', endDrag);
field.addEventListener('click', (e) => {
  if (dragged) { dragged = false; return; }
  if (sim.running) return;
  const [x, y] = toMm(e);
  setStart({ x: Math.round(x), y: Math.round(y) });
});

$('add-piece').onclick = () => {
  const k = state.pieces.length;
  const p = { id: 'p' + Date.now().toString(36), n: String(k), name: 'Loose piece ' + k, x: 820 + (k % 5) * 80, y: 900, w: 50, h: 50, r: 0 };
  state.pieces.push(p); sim.objects.push(Object.assign({}, p, { loose: true })); save(); drawField();
};
$('reset-pieces').onclick = () => {
  state.pieces = structuredClone(LOOSE_DEFAULTS); sim.pieces = state.pieces;
  if (!sim.running) sim.resetObjects();
  save(); drawField();
};

// ---------- import / export ----------

function showMsg(text, link) {
  const m = $('msg'); m.hidden = false; m.textContent = text;
  if (link) m.appendChild(link);
}

$('file').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const res = await importProject(await file.arrayBuffer());
    Object.assign(state.cfg, res.cfg);
    state.sounds = res.program.sounds || {};
    showProgram(res.program);
    const setup = [];
    if (res.cfg.pair) setup.push('drive motors ' + res.cfg.pair.split('').join(' + '));
    if (res.cfg.colorPort) setup.push('color sensor on ' + res.cfg.colorPort);
    if (res.cfg.distPort) setup.push('distance sensor on ' + res.cfg.distPort);
    if (res.cfg.forcePort) setup.push('force sensor on ' + res.cfg.forcePort);
    sim.reset(); renderRobot(); drawField();
    showMsg(`Imported “${file.name}”: ${countBlocks(res.program)} blocks.` + (setup.length ? ' Robot set to: ' + setup.join(', ') + '.' : '') + (res.warn.length ? '\n' + res.warn.slice(0, 6).join('\n') : ''));
  } catch (err) { showMsg(`Could not import “${file.name}”: ${err.message}`); }
});

let lastUrl = null;
$('export').onclick = () => {
  const { zip, dropped } = exportLlsp3(latestProgram(), 'BioGlow sim export');
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(new Blob([zip], { type: 'application/octet-stream' }));
  const a = document.createElement('a'); a.href = lastUrl; a.download = 'bioglow-sim.llsp3'; a.className = 'btn save'; a.textContent = 'Save bioglow-sim.llsp3';
  showMsg('Export ready. Opening it in the SPIKE app is still untested; it re-imports here.' + (dropped ? ` ${dropped} gray (unsupported) block${dropped > 1 ? 's were' : ' was'} left out.` : '') + '\n', a);
  a.click();
};

// ---------- loop ----------

// Physics runs on a timer (not animation frames) so slow or throttled drawing doesn't slow the robot.
// Up to 0.25 s per tick keeps sim time real-time; longer gaps (a hidden tab) pause it.
let last = performance.now(), dirty = false;
setInterval(() => {
  const now = performance.now(); const dt = Math.min(0.25, (now - last) / 1000); last = now;
  if (sim.running || sim.matchOn) {
    const wasMatch = sim.matchOn;
    sim.advance(dt * state.scale); dirty = true;
    if (wasMatch && !sim.matchOn) renderLog();
  }
  if (dirty && now - lastDraw > 250) draw(); // animation frames starved: draw from here
}, 16);
let lastDraw = 0;
function draw() { dirty = false; lastDraw = performance.now(); drawField(); }
function frame() { if (dirty) draw(); requestAnimationFrame(frame); }

buildField(); renderStart(); initCode(); renderScore(); renderRobot(); renderLog(); drawField();
requestAnimationFrame(frame);
// Save the latest blocks when the page is hidden or closed.
document.addEventListener('visibilitychange', () => { if (document.hidden && ws) syncProgram(); });
window.addEventListener('pagehide', () => { if (ws) syncProgram(); });
