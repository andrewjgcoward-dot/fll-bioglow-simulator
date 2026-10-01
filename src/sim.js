// Robot simulation: a two-wheel SPIKE Prime drive base on the BioGlow mat.
// Heading is in degrees, clockwise from "north" (away from the home wall).

import { FW, FH, HOME_R, MODELS, DOCKS, LINES, MATCH_SECONDS } from './field.js';
import { matchBlocks } from './blocks.js';

// Robot-local coordinates: origin at the middle of the wheel axle, x to the right, y forward (mm).
export const DEFAULT_CONFIG = {
  wheel: 56,        // wheel diameter, mm
  track: 112,       // distance between wheels, mm
  top: 1000,        // wheel speed at 100 %, degrees per second
  robotW: 160, robotL: 200,
  axleBack: 100,    // distance from the back edge of the body to the wheel axle, mm
  pair: 'AB', colorPort: 'C', distPort: 'D',
  color: { x: 0, y: 70 },                 // color sensor, looking down
  dist: { x: 0, y: 100, dir: 'front' },   // distance sensor and the way it faces
  // Arms: 'sweep' turns flat over the mat; 'lift' tilts up and down (0° = flat on the mat, 90° = straight up).
  arms: [{ id: 'a1', port: 'E', motion: 'lift', x: 0, y: 100, dir: 'front', len: 90, rest: 'up', cw: 'lowers', ratio: 1 }],
  yawCW: true,      // yaw grows when turning clockwise
  collide: true,    // models and pieces are solid (off = drive through everything)
  shove: false      // the robot can push fixed mission models too (not like the real field)
};

export const DIR_ANGLE = { front: 0, right: 90, back: 180, left: -90 };
const ARM_WIDTH = 16;      // mm, for collisions
const LIFT_SOLID = 30;     // a lift arm tilted at most this far up is low enough to hit things

// Fill in defaults and convert settings saved by older versions.
export function normalizeConfig(saved) {
  const cfg = Object.assign(structuredClone(DEFAULT_CONFIG), saved || {});
  if (saved && (saved.colorOff !== undefined || saved.colorSide !== undefined) && !saved.color) cfg.color = { x: saved.colorSide || 0, y: saved.colorOff ?? 70 };
  delete cfg.colorOff; delete cfg.colorSide;
  if (saved && saved.axleBack === undefined) cfg.axleBack = cfg.robotL / 2;
  return cfg;
}

// Where an arm points (degrees clockwise from the robot's front), how long it looks from above,
// and whether it is low enough to touch things, for a given motor angle.
export function armGeom(arm, motorDeg) {
  const base = DIR_ANGLE[arm.dir] || 0, turn = motorDeg * (arm.ratio || 1);
  if (arm.motion === 'sweep') {
    return { ang: base + (arm.cw === 'left' ? -turn : turn), proj: arm.len, solid: true, tilt: 0, raw: 0 };
  }
  const raw = (arm.rest === 'down' ? 0 : 90) + (arm.cw === 'raises' ? turn : -turn);
  const tilt = clamp(raw, 0, 90);
  return { ang: base, proj: arm.len * Math.cos(rad(tilt)), solid: tilt <= LIFT_SOLID, tilt, raw };
}

// Loose pieces start here; teams can drag them anywhere and add more.
export const LOOSE_DEFAULTS = [
  { id: 'keystone', n: 'K', name: 'Keystone species (your build)', x: 400, y: 110, w: 64, h: 64, r: 0, loose: true }
];

const DRIVE_S = { forward: 0, back: 0, clockwise: 100, counterclockwise: -100 };
const STEP = 0.004;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => { const x = parseFloat(v); return isFinite(x) ? x : d; };
const rad = (d) => d * Math.PI / 180;

export function axes(deg) { const a = rad(deg); return { f: [Math.sin(a), Math.cos(a)], r: [Math.cos(a), -Math.sin(a)] }; }

export function corners(b) {
  const { f, r } = axes(b.r); const hw = b.w / 2, hh = b.h / 2; const out = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) out.push([b.x + r[0] * hw * sx + f[0] * hh * sy, b.y + r[1] * hw * sx + f[1] * hh * sy]);
  return out;
}

// Separating-axis test for two rotated rectangles.
export function overlap(A, B) {
  const ca = corners(A), cb = corners(B); const aa = axes(A.r), ab = axes(B.r);
  for (const ax of [aa.f, aa.r, ab.f, ab.r]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of ca) { const d = p[0] * ax[0] + p[1] * ax[1]; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of cb) { const d = p[0] * ax[0] + p[1] * ax[1]; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

// Minimum translation to separate B from A: { depth, axis } with axis pointing from A toward B, or null.
export function mtv(A, B) {
  const ca = corners(A), cb = corners(B); const aa = axes(A.r), ab = axes(B.r);
  let best = null;
  for (const ax of [aa.f, aa.r, ab.f, ab.r]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of ca) { const d = p[0] * ax[0] + p[1] * ax[1]; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of cb) { const d = p[0] * ax[0] + p[1] * ax[1]; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    const o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o <= 0) return null;
    if (!best || o < best.depth) best = { depth: o, axis: ax };
  }
  if ((B.x - A.x) * best.axis[0] + (B.y - A.y) * best.axis[1] < 0) best.axis = [-best.axis[0], -best.axis[1]];
  return best;
}

export function inside(p, b) {
  const { f, r } = axes(b.r); const dx = p[0] - b.x, dy = p[1] - b.y;
  return Math.abs(dx * r[0] + dy * r[1]) <= b.w / 2 && Math.abs(dx * f[0] + dy * f[1]) <= b.h / 2;
}

function rayBox(o, d, b) {
  const { f, r } = axes(b.r); const rx = o[0] - b.x, ry = o[1] - b.y;
  const lx = rx * r[0] + ry * r[1], ly = rx * f[0] + ry * f[1];
  const dx = d[0] * r[0] + d[1] * r[1], dy = d[0] * f[0] + d[1] * f[1];
  let t0 = -Infinity, t1 = Infinity;
  for (const [p, v, h] of [[lx, dx, b.w / 2], [ly, dy, b.h / 2]]) {
    if (Math.abs(v) < 1e-9) { if (p < -h || p > h) return null; continue; }
    let a = (-h - p) / v, c = (h - p) / v; if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  return t0 > 0 ? t0 : 0;
}

function segDist(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const t = clamp(((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t);
}

export function matColor(pt) {
  const [x, y] = pt;
  if (x < 0 || x > FW || y < 0 || y > FH) return 'none';
  for (const L of LINES) for (let i = 0; i < L.length - 1; i++) if (segDist(pt, L[i], L[i + 1]) <= 10) return 'black';
  const dl = Math.hypot(x, y), dr = Math.hypot(x - FW, y);
  if (Math.abs(dl - HOME_R) <= 7) return 'red';
  if (Math.abs(dr - HOME_R) <= 7) return 'blue';
  if (dl < HOME_R || dr < HOME_R) return 'white';
  return 'green';
}

export class Sim {
  // pieces: layout of loose pieces (shared with the caller so drags persist across resets).
  constructor(config, start, pieces) {
    this.cfg = normalizeConfig(config);
    this.start = Object.assign({ x: 240, y: 240, h: 0 }, start);
    this.pieces = pieces || [];
    this.logLines = [];
    this.onLog = null;
    this.matchOn = false;
    this.matchT = 0;
    this.reset();
  }

  log(msg) {
    const line = (this.matchOn ? '[' + this.clockText() + '] ' : '') + msg;
    this.logLines.push(line);
    if (this.logLines.length > 8) this.logLines.shift();
    if (this.onLog) this.onLog(line);
  }

  clockText() {
    const left = Math.max(0, MATCH_SECONDS - this.matchT);
    return Math.floor(left / 60) + ':' + String(Math.floor(left % 60)).padStart(2, '0');
  }

  // Field objects for this run: fixed models, docks, then loose pieces.
  resetObjects() {
    this.objects = MODELS.map(m => Object.assign({}, m))
      .concat(DOCKS.map(d => Object.assign({ dock: true }, d)))
      .concat(this.pieces.map(p => Object.assign({}, p, { loose: true })));
  }

  // Put the robot at the start position without touching the rest of the field.
  placeRobot() {
    const s = this.start;
    this.pose = { x: s.x, y: s.y, h: s.h };
    this.yawZero = s.h; this.trail = []; this.seen = []; this.trailT = 0; this.hit = null;
    this.sens = this.readSensors(this.pose);
  }

  reset() {
    const s = this.start;
    this.resetObjects();
    this.pose = { x: s.x, y: s.y, h: s.h };
    this.yawZero = s.h;
    this.prog = []; this.pc = 0; this.cur = null; this.running = false; this.drive = null;
    this.match = {}; this.loops = {};
    this.speedPct = 50;
    this.motorSpeed = { A: 75, B: 75, C: 75, D: 75, E: 75, F: 75 };
    this.arms = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
    this.pair = this.cfg.pair;
    this.display = '';
    this.trail = []; this.seen = []; this.trailT = 0;
    this.hit = null;
    this.sens = this.readSensors(this.pose);
  }

  // Robot-local point (x right, y forward from the axle middle) to field coordinates.
  toWorld(p, lx, ly) { const { f, r } = axes(p.h); return [p.x + r[0] * lx + f[0] * ly, p.y + r[1] * lx + f[1] * ly]; }

  bodyBox(p) {
    const c = this.cfg; const [x, y] = this.toWorld(p, 0, c.robotL / 2 - c.axleBack);
    return { x, y, w: c.robotW, h: c.robotL, r: p.h, part: 'robot' };
  }
  robotBox(p) { return this.bodyBox(p); }

  // Top-view rectangle of an arm, or null when it is too short to matter.
  // touching: only arms low enough to hit things (sweep arms always, lift arms when lowered).
  armBox(p, arm, motorDeg, touching = true) {
    const g = armGeom(arm, motorDeg);
    if ((touching && !g.solid) || g.proj < 5) return null;
    const a = rad(g.ang);
    const [x, y] = this.toWorld(p, arm.x + Math.sin(a) * g.proj / 2, arm.y + Math.cos(a) * g.proj / 2);
    return { x, y, w: ARM_WIDTH, h: g.proj, r: p.h + g.ang, part: 'arm ' + arm.port };
  }

  solidBoxes(p) {
    const out = [this.bodyBox(p)];
    for (const arm of this.cfg.arms || []) { const b = this.armBox(p, arm, this.arms[arm.port] || 0); if (b) out.push(b); }
    return out;
  }

  pushable(o) { return o.loose || (this.cfg.shove && !o.dock); }

  // A pushed object may not leave the mat or overlap a fixed model or another piece.
  // Docks are low platforms, so pieces can slide onto them.
  objectBlocked(o) {
    for (const q of corners(o)) if (q[0] < 0 || q[0] > FW || q[1] < 0 || q[1] > FH) return true;
    for (const other of this.objects) if (other !== o && !other.dock && overlap(o, other)) return true;
    return false;
  }

  // Push loose objects out of `boxes`. Returns the name of what blocked, or null (pushes kept).
  pushOut(boxes) {
    for (const box of boxes) for (const q of corners(box)) if (q[0] < 0 || q[0] > FW || q[1] < 0 || q[1] > FH) return 'the wall';
    if (!this.cfg.collide) return null;
    const moved = [];
    const undo = () => { for (const [o, s] of moved) Object.assign(o, s); };
    for (const box of boxes) for (const o of this.objects) {
      const m = mtv(box, o); if (!m) continue;
      if (!this.pushable(o)) { undo(); return o.name; }
      const saved = { x: o.x, y: o.y, r: o.r };
      const push = m.depth + 0.5;
      // Where the robot touches the object (before the push), for turning it when pushed off-center.
      const pts = corners(box).filter(q => inside(q, o)).concat(corners(o).filter(q => inside(q, box)));
      o.x += m.axis[0] * push; o.y += m.axis[1] * push;
      if (pts.length) {
        const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length - saved.x, cy = pts.reduce((s, q) => s + q[1], 0) / pts.length - saved.y;
        const cross = cx * m.axis[1] * push - cy * m.axis[0] * push;
        const r2 = (o.w * o.w + o.h * o.h) / 4;
        o.r -= (cross / r2) * 0.6 * 180 / Math.PI;
      }
      if (this.objectBlocked(o)) {
        o.r = saved.r;
        if (this.objectBlocked(o)) { Object.assign(o, saved); undo(); return o.name; }
      }
      moved.push([o, saved]);
    }
    return null;
  }

  // Try to move the robot (body and lowered arms) to pose p.
  tryMove(p) { return this.pushOut(this.solidBoxes(p)); }

  // Try to turn the motor on `port` to motorDeg. Returns what stopped the arm, or null.
  tryArm(port, motorDeg) {
    const arm = (this.cfg.arms || []).find(a => a.port === port);
    if (!arm) return null;
    const g = armGeom(arm, motorDeg);
    if (arm.motion !== 'sweep' && (g.raw < -0.01 || g.raw > 90.01)) return g.raw < 0 ? 'the mat' : 'its top stop';
    const box = this.armBox(this.pose, arm, motorDeg);
    if (!box) return null;
    if (arm.motion === 'sweep') return this.pushOut([box]);
    // A lift arm coming down presses on whatever is under it instead of shoving it aside.
    for (const q of corners(box)) if (q[0] < 0 || q[0] > FW || q[1] < 0 || q[1] > FH) return 'the wall';
    if (this.cfg.collide) for (const o of this.objects) if (!o.dock && overlap(box, o)) return o.name;
    return null;
  }

  collides(p) {
    for (const box of this.solidBoxes(p)) {
      for (const q of corners(box)) if (q[0] < 0 || q[0] > FW || q[1] < 0 || q[1] > FH) return 'the wall';
      if (this.cfg.collide) for (const o of this.objects) if (overlap(box, o)) return o.name;
    }
    return null;
  }

  // The robot, including any arm sticking out, is completely inside one of the home areas.
  inHome(p = this.pose) {
    const boxes = [this.bodyBox(p)];
    for (const arm of this.cfg.arms || []) { const b = this.armBox(p, arm, this.arms[arm.port] || 0, false); if (b) boxes.push(b); }
    const pts = boxes.flatMap(corners);
    const within = (cx) => pts.every(q => Math.hypot(q[0] - cx, q[1]) <= HOME_R);
    return within(0) || within(FW);
  }

  readSensors(p) {
    const c = this.cfg;
    const sp = this.toWorld(p, c.color.x, c.color.y);
    const o = this.toWorld(p, c.dist.x, c.dist.y);
    const dirAng = p.h + (DIR_ANGLE[c.dist.dir] || 0); const { f } = axes(dirAng);
    let t = Infinity;
    if (f[0] > 1e-9) t = Math.min(t, (FW - o[0]) / f[0]);
    if (f[0] < -1e-9) t = Math.min(t, -o[0] / f[0]);
    if (f[1] > 1e-9) t = Math.min(t, (FH - o[1]) / f[1]);
    if (f[1] < -1e-9) t = Math.min(t, -o[1] / f[1]);
    for (const b of this.objects || []) { const h = rayBox(o, f, b); if (h !== null) t = Math.min(t, h); }
    let yaw = p.h - (this.yawZero === undefined ? p.h : this.yawZero);
    yaw = ((yaw % 360) + 540) % 360 - 180;
    if (!c.yawCW) yaw = -yaw;
    return { color: matColor(sp), spot: sp, dist: t <= 2000 ? Math.max(0, t) / 10 : null, rayLen: Math.min(Math.max(0, t), 2000), origin: o, dirAng, yaw };
  }

  cond(b, s) {
    const cfg = this.cfg;
    if (b.t === 'waitColor' || b.t === 'ifColor') return b.port === cfg.colorPort && s.color === b.color;
    if (b.t === 'waitDist' || b.t === 'ifDist') {
      if (b.port !== cfg.distPort) return false;
      const v = num(b.val, 10);
      if (s.dist === null) return b.cmp === '>';
      return b.cmp === '<' ? s.dist < v : s.dist > v;
    }
    if (b.t === 'waitYaw' || b.t === 'ifYaw') { const v = num(b.val, 90); return b.cmp === '<' ? s.yaw < v : s.yaw > v; }
    return true;
  }

  // Launch a program. Outside a match every run starts on a fresh field.
  // In a match the field stays as it is and the robot relaunches from home.
  run(program) {
    if (!this.matchOn) this.reset();
    else {
      if (!this.inHome()) { this.log('Relaunch from home: robot moved back to the start position.'); this.placeRobot(); }
      this.cur = null; this.drive = null; this.yawZero = this.pose.h;
    }
    this.prog = program.map(b => Object.assign({}, b));
    this.pc = 0; this.match = matchBlocks(this.prog); this.loops = {};
    this.speedPct = 50; this.pair = this.cfg.pair;
    this.motorSpeed = { A: 75, B: 75, C: 75, D: 75, E: 75, F: 75 };
    this.running = true;
    this.log('Launched.');
  }

  // Returns true when the stop costs a precision token (interrupted outside home during a match).
  stop() {
    const was = this.running || this.drive;
    this.running = false; this.drive = null; this.cur = null;
    if (was && this.matchOn && !this.inHome()) { this.log('Interrupted outside home: lost a precision token.'); return true; }
    if (was) this.log('Stopped.');
    return false;
  }

  startMatch() { this.reset(); this.matchT = 0; this.matchOn = true; this.logLines = []; this.log('Match started. Press Run to launch.'); }
  endMatch() { this.matchOn = false; this.running = false; this.drive = null; this.log('Match stopped.'); }

  begin(b) {
    const cfg = this.cfg;
    const jumpPast = () => { const e = this.match[this.pc]; return { done: true, jump: e === undefined ? this.prog.length : e + 1 }; };
    switch (b.t) {
      case 'move': case 'steer': {
        const s = b.t === 'steer' ? clamp(num(b.steer, 0), -100, 100) : (DRIVE_S[b.dir] || 0);
        let sign = b.t === 'move' && b.dir === 'back' ? -1 : 1;
        let val = num(b.val, 0); if (val < 0) { sign = -sign; val = -val; }
        this.drive = null;
        if (b.unit === 'seconds') return { kind: 'drive', mode: 'time', target: val, t: 0, stall: 0, drive: { s, sign } };
        const circ = Math.PI * cfg.wheel;
        const target = b.unit === 'cm' ? val * 10 / circ * 360 : b.unit === 'in' ? val * 25.4 / circ * 360 : b.unit === 'rotations' ? val * 360 : val;
        return { kind: 'drive', mode: 'deg', target, prog: 0, t: 0, stall: 0, drive: { s, sign } };
      }
      case 'startMove': this.drive = { s: DRIVE_S[b.dir] || 0, sign: b.dir === 'back' ? -1 : 1 }; return { done: true };
      case 'startSteer': this.drive = { s: clamp(num(b.steer, 0), -100, 100), sign: 1 }; return { done: true };
      case 'stopMove': this.drive = null; return { done: true };
      case 'speed': this.speedPct = clamp(num(b.pct, 50), -100, 100); return { done: true };
      case 'pair': this.pair = String(b.pair || cfg.pair); return { done: true };
      case 'motorSpeed':
        for (const pt of String(b.port).split('')) if (this.motorSpeed[pt] !== undefined) this.motorSpeed[pt] = clamp(num(b.pct, 75), -100, 100);
        return { done: true };
      case 'motorStop': return { done: true };
      case 'motor': case 'motorGoTo': {
        const ports = String(b.port).split('').filter(pt => this.arms[pt] !== undefined);
        if (ports.some(pt => this.pair.indexOf(pt) >= 0)) this.log('Note: port ' + b.port + ' includes a drive motor; it only turns the dial here.');
        if (b.t === 'motorGoTo') {
          const a = this.arms[ports[0]] || 0; const cur = ((a % 360) + 360) % 360;
          const d = ((num(b.val, 0) - cur) % 360 + 540) % 360 - 180;
          return { kind: 'motor', mode: 'deg', ports, sign: d < 0 ? -1 : 1, target: Math.abs(d), prog: 0, t: 0 };
        }
        let sign = b.dir === 'counterclockwise' ? -1 : 1;
        let val = num(b.val, 0); if (val < 0) { sign = -sign; val = -val; }
        if (b.unit === 'seconds') return { kind: 'motor', mode: 'time', ports, sign, target: val, t: 0 };
        return { kind: 'motor', mode: 'deg', ports, sign, target: b.unit === 'rotations' ? val * 360 : val, prog: 0, t: 0 };
      }
      case 'wait': return { kind: 'wait', target: num(b.val, 1), t: 0 };
      case 'beep': return { kind: 'wait', target: num(b.val, 0.2), t: 0 };
      case 'waitColor':
        if (b.port !== cfg.colorPort) this.log('No color sensor on port ' + b.port + ' (it is on ' + cfg.colorPort + ').');
        return { kind: 'until', b, t: 0 };
      case 'waitDist':
        if (b.port !== cfg.distPort) this.log('No distance sensor on port ' + b.port + ' (it is on ' + cfg.distPort + ').');
        return { kind: 'until', b, t: 0 };
      case 'waitYaw': return { kind: 'until', b, t: 0 };
      case 'ifColor': case 'ifDist': case 'ifYaw': {
        const ok = this.cond(b, this.sens);
        const what = b.t === 'ifColor' ? b.port + ' is ' + b.color : b.t === 'ifDist' ? 'distance ' + b.cmp + ' ' + b.val : 'yaw ' + b.cmp + ' ' + b.val;
        this.log('if ' + what + ': ' + (ok ? 'yes' : 'no') + ' (checked once)');
        return ok ? { done: true } : jumpPast();
      }
      case 'repeat': {
        const n = Math.floor(num(b.val, 0));
        if (n <= 0) return jumpPast();
        this.loops[this.pc] = n; return { done: true };
      }
      case 'end': {
        const o = this.match[this.pc];
        if (o !== undefined && this.prog[o].t === 'repeat') { this.loops[o]--; if (this.loops[o] > 0) return { done: true, jump: o + 1 }; }
        return { done: true };
      }
      case 'resetYaw': this.yawZero = this.pose.h; return { done: true };
      case 'show': this.display = String(b.text || ''); return { done: true };
      default: this.log('Skipped unsupported block: ' + b.op); return { done: true };
    }
  }

  // Advance the simulation by dt seconds (any size; it is split into small steps).
  advance(dt) {
    while (dt > 1e-9) { const h = Math.min(STEP, dt); this.step(h); dt -= h; }
  }

  step(dt) {
    const cfg = this.cfg;
    if (this.running) {
      let guard = 0;
      while (this.running && guard++ < 60) {
        if (!this.cur) {
          const b = this.prog[this.pc];
          if (!b) { this.running = false; this.drive = null; this.log('Program finished.'); break; }
          this.cur = this.begin(b);
        }
        if (this.cur.done) { this.pc = this.cur.jump !== undefined ? this.cur.jump : this.pc + 1; this.cur = null; continue; }
        break;
      }
    }
    const cmd = this.cur && this.cur.drive ? this.cur.drive : this.drive;
    let fast = 0, stalled = false;
    if (cmd) {
      const sp = this.speedPct / 100 * cfg.top * cmd.sign;
      const ratio = 1 - 2 * Math.abs(cmd.s) / 100;
      const L = cmd.s >= 0 ? sp : sp * ratio, R = cmd.s >= 0 ? sp * ratio : sp;
      const k = Math.PI * cfg.wheel / 360;
      const vL = L * k, vR = R * k, v = (vL + vR) / 2, w = (vL - vR) / cfg.track;
      const h0 = rad(this.pose.h), h1 = h0 + w * dt, hm = (h0 + h1) / 2;
      const np = { x: this.pose.x + v * Math.sin(hm) * dt, y: this.pose.y + v * Math.cos(hm) * dt, h: h1 * 180 / Math.PI };
      const hit = this.tryMove(np);
      if (hit) { stalled = true; if (this.hit !== hit) this.log('Bumped into ' + hit + '.'); this.hit = hit; }
      else { this.pose = np; fast = Math.abs(sp) * dt; this.hit = null; }
      this.trailT += dt;
      if (!stalled && this.trailT > 0.06) {
        this.trailT = 0; this.trail.push([this.pose.x, this.pose.y]); if (this.trail.length > 2000) this.trail.shift();
      }
    }
    this.sens = this.readSensors(this.pose);
    // Remember where the color sensor saw something other than plain mat, to draw on the field.
    if (cmd && !stalled && this.sens.color !== 'green') {
      const last = this.seen[this.seen.length - 1], sp = this.sens.spot;
      if (!last || Math.hypot(last[0] - sp[0], last[1] - sp[1]) > 8) { this.seen.push([sp[0], sp[1], this.sens.color]); if (this.seen.length > 3000) this.seen.shift(); }
    }
    const c = this.cur;
    if (this.running && c && !c.done) {
      c.t += dt;
      if (c.kind === 'drive') {
        if (c.mode === 'time') { if (c.t >= c.target) c.done = true; }
        else { c.prog += fast; if (c.prog >= c.target) c.done = true; }
        if (stalled) { c.stall += dt; if (c.stall > 1) { c.done = true; this.log('Motors stalled for 1 s, moving to the next block.'); } }
        else c.stall = 0;
      } else if (c.kind === 'motor') {
        const ds = Math.abs(this.motorSpeed[c.ports[0]] || 75) / 100 * cfg.top * dt;
        const st = c.mode === 'time' ? ds : Math.min(ds, c.target - c.prog);
        // Each motor turns unless its arm runs into something (or its end stop).
        let blockedBy = null;
        for (const pt of c.ports) {
          const next = this.arms[pt] + c.sign * st;
          const hit = this.tryArm(pt, next);
          if (hit) blockedBy = blockedBy || [pt, hit]; else this.arms[pt] = next;
        }
        if (!c.ports.length) c.done = true;
        else if (blockedBy) {
          // SPIKE motors stop a "run for" block when they stall.
          c.stall = (c.stall || 0) + dt;
          if (c.stall > 0.3) {
            c.done = true;
            const [pt, what] = blockedBy;
            this.log(what === 'the mat' ? 'Arm ' + pt + ' pressed down on the mat.' : what === 'its top stop' ? 'Arm ' + pt + ' is all the way up.' : 'Arm ' + pt + ' pressed against ' + what + '.');
          }
        } else {
          c.stall = 0;
          if (c.mode === 'time') { if (c.t >= c.target) c.done = true; }
          else { c.prog += st; if (c.prog >= c.target - 1e-6) c.done = true; }
        }
      } else if (c.kind === 'wait') { if (c.t >= c.target) c.done = true; }
      else if (c.kind === 'until') { if (this.cond(c.b, this.sens)) c.done = true; }
    }
    if (this.matchOn) {
      this.matchT += dt;
      if (this.matchT >= MATCH_SECONDS) {
        this.matchT = MATCH_SECONDS; this.matchOn = false; this.running = false; this.drive = null; this.cur = null;
        this.log('Match over. Score what is on the field.');
      }
    }
  }
}
