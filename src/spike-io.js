// Read and write LEGO Education SPIKE App 3 Word Blocks files (.llsp3).
// An .llsp3 is a zip holding manifest.json, icon.svg and scratch.sb3;
// scratch.sb3 is another zip holding a Scratch 3 project.json.

import { DIRS4, CODE_COLOR, COLOR_CODE, OPENERS, newBlock } from './blocks.js';

const num = (v, d) => { const x = parseFloat(v); return isFinite(x) ? x : d; };

// ---------- zip ----------

let CRC_T = null;
function crc32(u8) {
  if (!CRC_T) {
    CRC_T = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Writes an uncompressed ("stored") zip.
export function makeZip(entries) {
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(12, 33, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(14, 33, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = parts.concat(central, [new Uint8Array(end.buffer)]);
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

export function readZip(buf) {
  const dv = new DataView(buf); let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true); const files = {}; const dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), loff = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
    const start = loff + 30 + dv.getUint16(loff + 26, true) + dv.getUint16(loff + 28, true);
    files[name] = { method, data: new Uint8Array(buf, start, csize) };
    p += 46 + nlen + elen + clen;
  }
  return files;
}

async function unzipEntry(e) {
  if (e.method === 0) return e.data.slice();
  if (e.method === 8) {
    const s = new Blob([e.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  throw new Error('Unsupported compression in file');
}

const findEntry = (files, test) => { for (const k in files) if (test(k.split('/').pop())) return files[k]; return null; };

// ---------- import ----------

// Accepts an .llsp3/.llsp, an .sb3, or a bare project.json.
export async function importProject(buf) {
  let proj;
  const files = readZip(buf);
  if (!files) proj = JSON.parse(new TextDecoder().decode(new Uint8Array(buf)));
  else {
    let pj = findEntry(files, n => n === 'project.json');
    if (!pj) {
      const sb3 = findEntry(files, n => n.endsWith('.sb3'));
      if (sb3) { const inner = readZip((await unzipEntry(sb3)).buffer); pj = inner && findEntry(inner, n => n === 'project.json'); }
    }
    if (!pj) {
      if (findEntry(files, n => n === 'projectbody.json')) throw new Error('This looks like a SPIKE Python project. Only Word Blocks projects can be imported for now.');
      throw new Error('No block program found in this file.');
    }
    proj = JSON.parse(new TextDecoder().decode(await unzipEntry(pj)));
  }
  return convertProject(proj);
}

// Scratch 3 project.json -> { program, warn, cfg }.
// cfg holds robot settings found in the blocks (drive pair, sensor ports).
export function convertProject(proj) {
  const warn = []; const cfg = {}; let blocks = null, hat = null, best = -1, stacks = 0;
  for (const t of (proj.targets || [])) {
    const bl = t.blocks || {};
    for (const id in bl) {
      const b = bl[id];
      if (!b || Array.isArray(b) || !b.topLevel) continue;
      stacks++;
      if (b.opcode === 'flipperevents_whenProgramStarts') {
        let n = 0, c = b.next; while (c && bl[c] && n < 1000) { n++; c = bl[c].next; }
        if (n > best) { best = n; blocks = bl; hat = id; }
      }
    }
  }
  if (!hat) throw new Error('No “when program starts” stack found.');
  if (stacks > 1) warn.push('Used the longest “when program starts” stack; ' + (stacks - 1) + ' other stack' + (stacks > 2 ? 's' : '') + ' (loose blocks or other hats) left out.');

  const out = [];
  const lit = (b, name) => {
    const inp = b.inputs && b.inputs[name]; if (!inp) return undefined;
    for (let i = 1; i < inp.length; i++) {
      const v = inp[i];
      if (Array.isArray(v)) return String(v[1]);
      if (typeof v === 'string' && blocks[v]) { const sb = blocks[v]; const f = sb.fields && Object.keys(sb.fields)[0]; if (sb.shadow && f) return String(sb.fields[f][0]); }
    }
    return undefined;
  };
  const ref = (b, name) => { const inp = b.inputs && b.inputs[name]; const v = inp && inp[1]; return typeof v === 'string' ? blocks[v] : null; };
  const fld = (b, name) => b.fields && b.fields[name] ? String(b.fields[name][0]) : undefined;
  const dir = (d) => d === 'backward' ? 'back' : (DIRS4.indexOf(d) >= 0 ? d : 'forward');
  const add = (t, o) => { const clean = {}; for (const k in o) if (o[k] !== undefined) clean[k] = o[k]; out.push(newBlock(t, clean)); };
  const skipped = {};
  const note = (op) => { add('note', { op }); skipped[op] = (skipped[op] || 0) + 1; };
  const port1 = (b) => lit(b, 'PORT') || 'E';

  const cond = (c, mode) => {
    const T = (w, i) => mode === 'if' ? i : w;
    if (!c) return null;
    if (c.opcode === 'flippersensors_isColor') {
      const port = lit(c, 'PORT'); if (port && !cfg.colorPort) cfg.colorPort = port;
      return [T('waitColor', 'ifColor'), { port, color: CODE_COLOR[lit(c, 'VALUE') || lit(c, 'COLOR')] || 'black' }];
    }
    if (c.opcode === 'flippersensors_isDistance') {
      const port = lit(c, 'PORT'); if (port && !cfg.distPort) cfg.distPort = port;
      const u = fld(c, 'UNIT') || lit(c, 'UNIT') || 'cm'; let v = num(lit(c, 'VALUE'), 10); if (u === 'in') v = Math.round(v * 2.54);
      return [T('waitDist', 'ifDist'), { port, cmp: fld(c, 'COMPARATOR') || lit(c, 'COMPARATOR') || '<', val: String(v) }];
    }
    if (c.opcode === 'operator_gt' || c.opcode === 'operator_lt') {
      const a = ref(c, 'OPERAND1'), b2 = ref(c, 'OPERAND2'); const isYaw = (x) => x && x.opcode === 'flippersensors_orientationAxis';
      const cmp = c.opcode === 'operator_gt' ? '>' : '<';
      if (isYaw(a)) return [T('waitYaw', 'ifYaw'), { cmp, val: lit(c, 'OPERAND2') }];
      if (isYaw(b2)) return [T('waitYaw', 'ifYaw'), { cmp: cmp === '>' ? '<' : '>', val: lit(c, 'OPERAND1') }];
    }
    return null;
  };

  const walk = (id) => {
    while (id && out.length < 600) {
      const b = blocks[id]; if (!b) break; const op = b.opcode;
      switch (op) {
        case 'flippermove_move': add('move', { dir: dir(lit(b, 'DIRECTION')), val: lit(b, 'VALUE'), unit: fld(b, 'UNIT') }); break;
        case 'flippermove_steer': add('steer', { steer: lit(b, 'STEERING'), val: lit(b, 'VALUE'), unit: fld(b, 'UNIT') }); break;
        case 'flippermove_startMove': add('startMove', { dir: dir(lit(b, 'DIRECTION')) }); break;
        case 'flippermove_startSteer': add('startSteer', { steer: lit(b, 'STEERING') }); break;
        case 'flippermove_stopMove': add('stopMove', {}); break;
        case 'flippermove_movementSpeed': case 'flippermove_setMovementSpeed': add('speed', { pct: lit(b, 'SPEED') }); break;
        case 'flippermove_setMovementPair': { const pr = lit(b, 'PAIR'); if (pr && !cfg.pair) cfg.pair = pr; add('pair', { pair: pr }); break; }
        case 'flippermotor_motorTurnForDirection':
          add('motor', { port: port1(b), dir: lit(b, 'DIRECTION') === 'counterclockwise' ? 'counterclockwise' : 'clockwise', val: lit(b, 'VALUE'), unit: fld(b, 'UNIT') }); break;
        case 'flippermotor_motorSetSpeed': add('motorSpeed', { port: port1(b), pct: lit(b, 'SPEED') }); break;
        case 'flippermotor_motorStop': add('motorStop', { port: port1(b) }); break;
        case 'flippermotor_motorGoDirectionToPosition':
          if ((fld(b, 'DIRECTION') || 'shortest') !== 'shortest') warn.push('“go to position” direction ' + fld(b, 'DIRECTION') + ' is simulated as shortest path.');
          add('motorGoTo', { port: port1(b), val: lit(b, 'POSITION') }); break;
        case 'flippersound_beepForTime': add('beep', { note: lit(b, 'NOTE'), val: lit(b, 'DURATION') }); break;
        case 'control_wait': add('wait', { val: lit(b, 'DURATION') }); break;
        case 'control_wait_until': {
          const c = cond(ref(b, 'CONDITION'), 'wait');
          if (c) add(c[0], c[1]); else note('wait until ' + ((ref(b, 'CONDITION') || {}).opcode || '(empty)'));
          break;
        }
        case 'control_if': case 'control_if_else': {
          const c = cond(ref(b, 'CONDITION'), 'if');
          if (!c) { note('if ' + ((ref(b, 'CONDITION') || {}).opcode || '(empty)')); break; }
          add(c[0], c[1]); walk(b.inputs.SUBSTACK && b.inputs.SUBSTACK[1]); add('end', {});
          if (op === 'control_if_else') warn.push('An “else” branch was left out (not supported yet).');
          break;
        }
        case 'control_repeat': add('repeat', { val: lit(b, 'TIMES') }); walk(b.inputs.SUBSTACK && b.inputs.SUBSTACK[1]); add('end', {}); break;
        case 'control_forever': add('repeat', { val: '1000' }); walk(b.inputs.SUBSTACK && b.inputs.SUBSTACK[1]); add('end', {}); warn.push('“forever” became “repeat 1000”.'); break;
        case 'flippersensors_resetYaw': case 'flippersensors_resetYawAxis': case 'flippersensors_setYaw': add('resetYaw', {}); break;
        case 'flipperlight_lightDisplayText': add('show', { text: lit(b, 'TEXT') }); break;
        default: note(op);
      }
      id = b.next;
    }
  };
  walk(blocks[hat].next);
  const sk = Object.keys(skipped);
  if (sk.length) warn.push('Shown in gray, not simulated yet: ' + sk.map(k => k + (skipped[k] > 1 ? ' ×' + skipped[k] : '')).join(', ') + '.');
  return { program: out, warn, cfg };
}

// ---------- export ----------

// Simulator program -> Scratch 3 project.json. Gray (unsupported) blocks are dropped.
export function buildProject(program) {
  const blocks = {}; let n = 0;
  const nid = () => 'sim' + (++n) + Math.random().toString(36).slice(2, 8);
  const mk = (opcode, parent, extra) => { const id = nid(); blocks[id] = Object.assign({ opcode, next: null, parent, inputs: {}, fields: {}, shadow: false, topLevel: false }, extra || {}); return id; };
  const sh = (parent, opcode, value) => { const id = mk(opcode, parent, { shadow: true }); blocks[id].fields['field_' + opcode] = [String(value), null]; return [1, id]; };
  const numIn = (v, kind) => [1, [kind || 4, String(v)]];
  const hat = mk('flipperevents_whenProgramStarts', null, { topLevel: true, x: 0, y: 0 });
  let dropped = 0;

  const condBlock = (b, parent) => {
    if (b.t === 'waitColor' || b.t === 'ifColor') {
      const c = mk('flippersensors_isColor', parent);
      blocks[c].inputs.PORT = sh(c, 'flippersensors_color-sensor-selector', b.port);
      blocks[c].inputs.VALUE = sh(c, 'flippersensors_color-selector', COLOR_CODE[b.color]);
      return c;
    }
    if (b.t === 'waitDist' || b.t === 'ifDist') {
      const c = mk('flippersensors_isDistance', parent);
      blocks[c].inputs.PORT = sh(c, 'flippersensors_distance-sensor-selector', b.port);
      blocks[c].inputs.VALUE = numIn(b.val);
      blocks[c].fields.COMPARATOR = [b.cmp, null]; blocks[c].fields.UNIT = ['cm', null];
      return c;
    }
    const c = mk(b.cmp === '<' ? 'operator_lt' : 'operator_gt', parent);
    const y = mk('flippersensors_orientationAxis', c); blocks[y].fields.AXIS = ['yaw', null];
    blocks[c].inputs.OPERAND1 = [3, y, [10, '']]; blocks[c].inputs.OPERAND2 = [1, [10, String(b.val)]];
    return c;
  };

  // One frame per open if/repeat: prev = last block placed, owner = the C-block, first = no child yet.
  const frames = [{ prev: hat, owner: null, first: false }];
  for (const b of program) {
    const fr = frames[frames.length - 1];
    if (b.t === 'end') { if (frames.length > 1) frames.pop(); continue; }
    const parent = fr.first ? fr.owner : fr.prev;
    let id = null;
    const blk = (op) => { id = mk(op, parent); return blocks[id]; };
    switch (b.t) {
      case 'move': { const k = blk('flippermove_move'); k.inputs.DIRECTION = sh(id, 'flippermove_custom-icon-direction', b.dir); k.inputs.VALUE = numIn(b.val); k.fields.UNIT = [b.unit, null]; break; }
      case 'steer': { const k = blk('flippermove_steer'); k.inputs.STEERING = sh(id, 'flippermove_rotation-wheel', b.steer); k.inputs.VALUE = numIn(b.val); k.fields.UNIT = [b.unit, null]; break; }
      case 'startMove': { const k = blk('flippermove_startMove'); k.inputs.DIRECTION = sh(id, 'flippermove_custom-icon-direction', b.dir); break; }
      case 'startSteer': { const k = blk('flippermove_startSteer'); k.inputs.STEERING = sh(id, 'flippermove_rotation-wheel', b.steer); break; }
      case 'stopMove': blk('flippermove_stopMove'); break;
      case 'speed': { const k = blk('flippermove_movementSpeed'); k.inputs.SPEED = numIn(b.pct); break; }
      case 'pair': { const k = blk('flippermove_setMovementPair'); k.inputs.PAIR = sh(id, 'flippermove_movement-port-selector', b.pair); break; }
      case 'motor': { const k = blk('flippermotor_motorTurnForDirection'); k.inputs.PORT = sh(id, 'flippermotor_multiple-port-selector', b.port); k.inputs.DIRECTION = sh(id, 'flippermotor_custom-icon-direction', b.dir); k.inputs.VALUE = numIn(b.val); k.fields.UNIT = [b.unit, null]; break; }
      case 'motorSpeed': { const k = blk('flippermotor_motorSetSpeed'); k.inputs.PORT = sh(id, 'flippermotor_multiple-port-selector', b.port); k.inputs.SPEED = numIn(b.pct); break; }
      case 'motorStop': { const k = blk('flippermotor_motorStop'); k.inputs.PORT = sh(id, 'flippermotor_multiple-port-selector', b.port); break; }
      case 'motorGoTo': { const k = blk('flippermotor_motorGoDirectionToPosition'); k.inputs.PORT = sh(id, 'flippermotor_multiple-port-selector', b.port); k.inputs.POSITION = sh(id, 'flippermotor_custom-angle', b.val); k.fields.DIRECTION = ['shortest', null]; break; }
      case 'beep': { const k = blk('flippersound_beepForTime'); k.inputs.NOTE = sh(id, 'flippersound_custom-piano', b.note); k.inputs.DURATION = numIn(b.val); break; }
      case 'wait': { const k = blk('control_wait'); k.inputs.DURATION = numIn(b.val, 5); break; }
      case 'waitColor': case 'waitDist': case 'waitYaw': { const k = blk('control_wait_until'); k.inputs.CONDITION = [2, condBlock(b, id)]; break; }
      case 'ifColor': case 'ifDist': case 'ifYaw': { const k = blk('control_if'); k.inputs.CONDITION = [2, condBlock(b, id)]; break; }
      case 'repeat': { const k = blk('control_repeat'); k.inputs.TIMES = numIn(b.val, 6); break; }
      case 'resetYaw': blk('flippersensors_resetYaw'); break;
      case 'show': { const k = blk('flipperlight_lightDisplayText'); k.inputs.TEXT = [1, [10, String(b.text)]]; break; }
      default: dropped++; break;
    }
    if (!id) continue;
    if (fr.first) { blocks[fr.owner].inputs.SUBSTACK = [2, id]; fr.first = false; } else blocks[fr.prev].next = id;
    fr.prev = id;
    if (OPENERS[b.t]) frames.push({ prev: id, owner: id, first: true });
  }

  const EMPTY = 'd41d8cd98f00b204e9800998ecf8427e'; // md5 of an empty file
  const costume = (name, cx, cy) => ({ assetId: EMPTY, name, bitmapResolution: 1, md5ext: EMPTY + '.svg', dataFormat: 'svg', rotationCenterX: cx, rotationCenterY: cy });
  const project = {
    targets: [
      { isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0, costumes: [costume('backdrop1', 47, 55)], sounds: [], volume: 100, layerOrder: 0, tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null },
      { isStage: false, name: 'BioGlowSim', variables: {}, lists: {}, broadcasts: {}, blocks, comments: {}, currentCostume: 0, costumes: [costume('costume1', 240, 180)], sounds: [], volume: 100, layerOrder: 1, visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around' }
    ],
    monitors: [],
    extensions: ['flipperevents', 'flippermove', 'flippermotor', 'flippersensors', 'flipperlight', 'flippersound'],
    meta: { semver: '3.0.0', vm: '0.2.0', agent: 'BioGlow Simulator' }
  };
  return { project, dropped };
}

export function exportLlsp3(program, name) {
  const { project, dropped } = buildProject(program);
  const now = new Date().toISOString();
  const sb3 = makeZip([
    { name: 'project.json', data: JSON.stringify(project) },
    { name: 'd41d8cd98f00b204e9800998ecf8427e.svg', data: new Uint8Array(0) }
  ]);
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  const manifest = {
    type: 'word-blocks', autoDelete: false, created: now, id: uuid, lastsaved: now, size: 0, name,
    slotIndex: 0, workspaceX: 0, workspaceY: 0, zoomLevel: 0.675, showAllBlocks: false, version: 38, hardware: {},
    extensions: project.extensions,
    state: { playMode: 'download', canvasDrawerTab: 'monitorTab', canvasDrawerOpen: false, hasMonitors: false },
    extraFiles: [], lastConnectedHubType: 'flipper'
  };
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" rx="10" fill="#2D5A3B"/><circle cx="30" cy="30" r="12" fill="#8FE3B0"/></svg>';
  const zip = makeZip([
    { name: 'manifest.json', data: JSON.stringify(manifest) },
    { name: 'scratch.sb3', data: sb3 },
    { name: 'icon.svg', data: icon }
  ]);
  return { zip, dropped };
}
