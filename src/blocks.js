// Every block the simulator knows, described once. The Blockly editor, SPIKE file
// import/export and the runner all read this table.
//
// A program is a tree:
//   { stacks: [[stmt, ...], ...],            one list per "when program starts" stack
//     procs: { name: { params: [{ name, kind: 'n'|'b' }], body: [stmt, ...] } },
//     vars: [name, ...] }
// Statements and expressions are nodes { t: type, id?, ...params }. Number/text params hold
// expression nodes ({ t: 'num', v } literals or reporters); menu/field params hold strings.
// Bodies are lists: node.body, node.else.

export const PORTS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const DIRS4 = ['forward', 'back', 'clockwise', 'counterclockwise'];
export const UNITS = ['cm', 'in', 'rotations', 'degrees', 'seconds'];
export const COLORS = ['black', 'violet', 'blue', 'azure', 'green', 'yellow', 'red', 'white', 'none'];
export const PAIRS = [];
for (const a of 'ABCDEF') for (const b of 'ABCDEF') if (a !== b) PAIRS.push(a + b);

// SPIKE color ids (also what the "color" reporter returns).
export const COLOR_CODE = { black: 0, violet: 1, magenta: 1, blue: 3, azure: 4, green: 6, yellow: 7, red: 9, white: 10, none: -1 };
export const CODE_COLOR = { '0': 'black', '1': 'violet', '3': 'blue', '4': 'azure', '5': 'green', '6': 'green', '7': 'yellow', '9': 'red', '10': 'white', '-1': 'none' };
const colorMap = { to: (v) => String(COLOR_CODE[v] ?? 0), from: (v) => CODE_COLOR[String(v)] || 'black' };

// Param kinds: 'menu' (dropdown; a shadow block in SPIKE files), 'field' (dropdown; a field),
// 'num' / 'text' (slots that also take reporters), 'bool' (hexagon slot).
const menu = (opts, key, shadow, map) => ({ kind: 'menu', opts, key, shadow, map });
const port = (shadow = 'flippermotor_multiple-port-selector', key = 'PORT') => ({ kind: 'menu', opts: PORTS, key, shadow, ports: true });
const field = (opts, key, map) => ({ kind: 'field', opts, key, map });
const num = (def, key, o = {}) => ({ kind: 'num', def, key, numType: o.numType || 4, shadow: o.shadow });
const text = (def, key) => ({ kind: 'text', def, key, numType: 10 });
const bool = (key) => ({ kind: 'bool', key });

const MOTOR_DIR = menu(['clockwise', 'counterclockwise'], 'DIRECTION', 'flippermotor_custom-icon-direction');
const MOVE_DIR = menu(DIRS4, 'DIRECTION', 'flippermove_custom-icon-direction');
const CMP = field(['<', '>', '='], 'COMPARATOR');
const COLOR_PORT = port('flippersensors_color-sensor-selector');

// shape: 'stmt' (default) | 'hat' | 'n' (number/text reporter, round) | 'b' (boolean, hexagon)
export const SPEC = {
  start: { cat: 'events', shape: 'hat', text: 'when program starts', scratch: ['flipperevents_whenProgramStarts'] },

  motor: { cat: 'motor', text: '%port run %dir for %val %unit', scratch: ['flippermotor_motorTurnForDirection'], p: { port: port(), dir: MOTOR_DIR, val: num(1, 'VALUE'), unit: field(['rotations', 'degrees', 'seconds'], 'UNIT') } },
  motorGoTo: { cat: 'motor', text: '%port go %dir to position %pos', scratch: ['flippermotor_motorGoDirectionToPosition'], p: { port: port(), dir: field(['shortest', 'clockwise', 'counterclockwise'], 'DIRECTION'), pos: num(0, 'POSITION', { shadow: 'flippermotor_custom-angle' }) } },
  motorStart: { cat: 'motor', text: '%port start motor %dir', scratch: ['flippermotor_motorStartDirection'], p: { port: port(), dir: MOTOR_DIR } },
  motorStop: { cat: 'motor', text: '%port stop motor', scratch: ['flippermotor_motorStop'], p: { port: port() } },
  motorSpeed: { cat: 'motor', text: '%port set speed to %pct %', scratch: ['flippermotor_motorSetSpeed'], p: { port: port(), pct: num(75, 'SPEED') } },
  motorSetRel: { cat: 'motor', text: '%port set relative position to %val', scratch: ['flippermotor_motorSetDegreeCounted'], p: { port: port(), val: num(0, 'VALUE') } },
  motorPos: { cat: 'motor', shape: 'n', text: '%port position', scratch: ['flippermotor_absolutePosition'], p: { port: port('flippermotor_single-motor-selector') } },
  motorRel: { cat: 'motor', shape: 'n', text: '%port relative position', scratch: ['flippermotor_relativePosition', 'flippermotor_motorRelativePosition'], p: { port: port('flippermotor_single-motor-selector') } },

  move: { cat: 'move', text: 'move %dir for %val %unit', scratch: ['flippermove_move'], p: { dir: MOVE_DIR, val: num(10, 'VALUE'), unit: field(UNITS, 'UNIT') } },
  steer: { cat: 'move', text: 'move %steer steering for %val %unit', scratch: ['flippermove_steer'], p: { steer: num(30, 'STEERING', { shadow: 'flippermove_rotation-wheel' }), val: num(10, 'VALUE'), unit: field(UNITS, 'UNIT') } },
  startMove: { cat: 'move', text: 'start moving %dir', scratch: ['flippermove_startMove'], p: { dir: MOVE_DIR } },
  startSteer: { cat: 'move', text: 'start moving %steer steering', scratch: ['flippermove_startSteer'], p: { steer: num(30, 'STEERING', { shadow: 'flippermove_rotation-wheel' }) } },
  tank: { cat: 'move', text: 'move left %left % right %right % for %val %unit', scratch: ['flippermove_moveDualSpeed'], p: { left: num(50, 'LEFT'), right: num(50, 'RIGHT'), val: num(10, 'VALUE'), unit: field(UNITS, 'UNIT') } },
  startTank: { cat: 'move', text: 'start moving left %left % right %right %', scratch: ['flippermove_startDualSpeed'], p: { left: num(50, 'LEFT'), right: num(50, 'RIGHT') } },
  stopMove: { cat: 'move', text: 'stop moving', scratch: ['flippermove_stopMove'] },
  speed: { cat: 'move', text: 'set movement speed to %pct %', scratch: ['flippermove_movementSpeed', 'flippermove_setMovementSpeed'], p: { pct: num(50, 'SPEED') } },
  pair: { cat: 'move', text: 'set movement motors to %pair', scratch: ['flippermove_setMovementPair'], p: { pair: menu(PAIRS, 'PAIR', 'flippermove_movement-port-selector') } },
  setDistance: { cat: 'move', text: 'set 1 motor rotation to %cm cm moved', scratch: ['flippermove_setDistance'], p: { cm: num(17.6, 'DISTANCE') }, fixed: { UNIT: 'cm' } },

  show: { cat: 'light', text: 'write %text', scratch: ['flipperlight_lightDisplayText'], p: { text: text('Hello', 'TEXT') } },
  beep: { cat: 'sound', text: 'beep %note for %val seconds', scratch: ['flippersound_beepForTime'], p: { note: num(60, 'NOTE', { shadow: 'flippersound_custom-piano' }), val: num(0.2, 'DURATION') } },

  wait: { cat: 'control', text: 'wait %val seconds', scratch: ['control_wait'], p: { val: num(1, 'DURATION', { numType: 5 }) } },
  repeat: { cat: 'control', text: 'repeat %times', scratch: ['control_repeat'], p: { times: num(10, 'TIMES', { numType: 6 }) }, body: 'SUBSTACK' },
  forever: { cat: 'control', text: 'forever', scratch: ['control_forever'], body: 'SUBSTACK', end: true },
  if: { cat: 'control', text: 'if %cond then', scratch: ['control_if'], p: { cond: bool('CONDITION') }, body: 'SUBSTACK' },
  ifElse: { cat: 'control', text: 'if %cond then', scratch: ['control_if_else'], p: { cond: bool('CONDITION') }, body: 'SUBSTACK', else: 'SUBSTACK2' },
  waitUntil: { cat: 'control', text: 'wait until %cond', scratch: ['control_wait_until'], p: { cond: bool('CONDITION') } },
  repeatUntil: { cat: 'control', text: 'repeat until %cond', scratch: ['control_repeat_until'], p: { cond: bool('CONDITION') }, body: 'SUBSTACK' },
  stop: { cat: 'control', text: 'stop %opt', scratch: ['control_stop'], p: { opt: field(['all', 'this stack'], 'STOP_OPTION', { to: (v) => v === 'all' ? 'all' : 'this script', from: (v) => v === 'all' ? 'all' : 'this stack' }) }, end: true },

  isColor: { cat: 'sensor', shape: 'b', text: '%port is color %color ?', scratch: ['flippersensors_isColor'], p: { port: COLOR_PORT, color: menu(COLORS, 'VALUE', 'flippersensors_color-selector', colorMap) } },
  isReflection: { cat: 'sensor', shape: 'b', text: '%port reflection %cmp %val % ?', scratch: ['flippersensors_isReflectivity'], p: { port: COLOR_PORT, cmp: CMP, val: num(50, 'VALUE') } },
  isDistance: { cat: 'sensor', shape: 'b', text: '%port is %cmp %val cm ?', scratch: ['flippersensors_isDistance'], p: { port: port('flippersensors_distance-sensor-selector'), cmp: CMP, val: num(15, 'VALUE') }, fixed: { UNIT: 'cm' } },
  isPressed: { cat: 'sensor', shape: 'b', text: '%port is pressed ?', scratch: ['flippersensors_isPressed'], p: { port: port('flippersensors_force-sensor-selector') }, fixed: { OPTION: 'pressed' } },
  color: { cat: 'sensor', shape: 'n', text: '%port color', scratch: ['flippersensors_color'], p: { port: COLOR_PORT } },
  reflection: { cat: 'sensor', shape: 'n', text: '%port reflected light', scratch: ['flippersensors_reflectivity'], p: { port: COLOR_PORT } },
  distance: { cat: 'sensor', shape: 'n', text: '%port distance in cm', scratch: ['flippersensors_distance'], p: { port: port('flippersensors_distance-sensor-selector') }, fixed: { UNIT: 'cm' } },
  angle: { cat: 'sensor', shape: 'n', text: '%axis angle', scratch: ['flippersensors_orientationAxis'], p: { axis: field(['yaw', 'pitch', 'roll'], 'AXIS') } },
  resetYaw: { cat: 'sensor', text: 'set yaw angle to 0°', scratch: ['flippersensors_resetYaw', 'flippersensors_resetYawAxis', 'flippersensors_setYaw'] },
  timer: { cat: 'sensor', shape: 'n', text: 'timer', scratch: ['flippersensors_timer'] },
  resetTimer: { cat: 'sensor', text: 'reset timer', scratch: ['flippersensors_resetTimer'] },

  add: { cat: 'op', shape: 'n', text: '%a + %b', scratch: ['operator_add'], p: { a: num('', 'NUM1'), b: num('', 'NUM2') } },
  sub: { cat: 'op', shape: 'n', text: '%a - %b', scratch: ['operator_subtract'], p: { a: num('', 'NUM1'), b: num('', 'NUM2') } },
  mul: { cat: 'op', shape: 'n', text: '%a × %b', scratch: ['operator_multiply'], p: { a: num('', 'NUM1'), b: num('', 'NUM2') } },
  div: { cat: 'op', shape: 'n', text: '%a ÷ %b', scratch: ['operator_divide'], p: { a: num('', 'NUM1'), b: num('', 'NUM2') } },
  random: { cat: 'op', shape: 'n', text: 'pick random %a to %b', scratch: ['operator_random'], p: { a: num(1, 'FROM'), b: num(10, 'TO') } },
  gt: { cat: 'op', shape: 'b', text: '%a > %b', scratch: ['operator_gt'], p: { a: text('', 'OPERAND1'), b: text('50', 'OPERAND2') } },
  lt: { cat: 'op', shape: 'b', text: '%a < %b', scratch: ['operator_lt'], p: { a: text('', 'OPERAND1'), b: text('50', 'OPERAND2') } },
  eq: { cat: 'op', shape: 'b', text: '%a = %b', scratch: ['operator_equals'], p: { a: text('', 'OPERAND1'), b: text('50', 'OPERAND2') } },
  and: { cat: 'op', shape: 'b', text: '%a and %b', scratch: ['operator_and'], p: { a: bool('OPERAND1'), b: bool('OPERAND2') } },
  or: { cat: 'op', shape: 'b', text: '%a or %b', scratch: ['operator_or'], p: { a: bool('OPERAND1'), b: bool('OPERAND2') } },
  not: { cat: 'op', shape: 'b', text: 'not %a', scratch: ['operator_not'], p: { a: bool('OPERAND') } },
  join: { cat: 'op', shape: 'n', text: 'join %a %b', scratch: ['operator_join'], p: { a: text('apple ', 'STRING1'), b: text('banana', 'STRING2') } },
  letterOf: { cat: 'op', shape: 'n', text: 'letter %a of %b', scratch: ['operator_letter_of'], p: { a: num(1, 'LETTER', { numType: 6 }), b: text('apple', 'STRING') } },
  length: { cat: 'op', shape: 'n', text: 'length of %a', scratch: ['operator_length'], p: { a: text('apple', 'STRING') } },
  contains: { cat: 'op', shape: 'b', text: '%a contains %b ?', scratch: ['operator_contains'], p: { a: text('apple', 'STRING1'), b: text('a', 'STRING2') } },
  mod: { cat: 'op', shape: 'n', text: '%a mod %b', scratch: ['operator_mod'], p: { a: num('', 'NUM1'), b: num('', 'NUM2') } },
  round: { cat: 'op', shape: 'n', text: 'round %a', scratch: ['operator_round'], p: { a: num('', 'NUM') } },
  mathop: { cat: 'op', shape: 'n', text: '%fn of %a', scratch: ['operator_mathop'], p: { fn: field(['abs', 'floor', 'ceiling', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'ln', 'log', 'e ^', '10 ^'], 'OPERATOR'), a: num('', 'NUM') } },

  // Variables and My Blocks have extra handling in spike-io.js and workspace.js.
  setVar: { cat: 'var', text: 'set %name to %val', scratch: ['data_setvariableto'], p: { val: text('0', 'VALUE') } },
  changeVar: { cat: 'var', text: 'change %name by %val', scratch: ['data_changevariableby'], p: { val: num(1, 'VALUE') } },

  note: { cat: 'note', text: 'not simulated yet: %op' },
  noteR: { cat: 'note', shape: 'n', text: '%op' }
};

export const lit = (v) => ({ t: typeof v === 'number' || (v !== '' && v !== null && v !== undefined && isFinite(v)) ? 'num' : 'text', v: String(v ?? '') });

// A new node of type `t` with default params (overridden by `o`; plain values become literals).
export function node(t, o = {}) {
  const n = { t };
  const p = (SPEC[t] && SPEC[t].p) || {};
  for (const [k, d] of Object.entries(p)) {
    const v = o[k];
    if (d.kind === 'num' || d.kind === 'text') n[k] = v && typeof v === 'object' ? v : lit(v === undefined ? d.def : v);
    else if (d.kind === 'bool') n[k] = v || null;
    else n[k] = v === undefined ? d.opts[0] : String(v);
  }
  for (const k of ['body', 'else', 'name', 'args', 'op', 'id', 'axis']) if (o[k] !== undefined) n[k] = o[k];
  if (SPEC[t] && SPEC[t].body && !n.body) n.body = [];
  if (SPEC[t] && SPEC[t].else && !n.else) n.else = [];
  return n;
}

export const emptyProgram = () => ({ stacks: [[]], procs: {}, vars: [] });

// Convert the older flat list format (if/repeat closed by `end` blocks) into a program tree.
export function flatToAst(flat) {
  let i = 0;
  const yaw = (b) => ({ t: b.cmp === '<' ? 'lt' : 'gt', a: node('angle', { axis: 'yaw' }), b: lit(b.val) });
  const cond = (b) => b.t.endsWith('Color') ? node('isColor', { port: b.port, color: b.color })
    : b.t.endsWith('Dist') ? node('isDistance', { port: b.port, cmp: b.cmp, val: b.val }) : yaw(b);
  const seq = () => {
    const out = [];
    while (i < flat.length) {
      const b = flat[i++];
      if (b.t === 'end') return out;
      if (b.t === 'waitColor' || b.t === 'waitDist' || b.t === 'waitYaw') out.push(node('waitUntil', { cond: cond(b) }));
      else if (b.t === 'ifColor' || b.t === 'ifDist' || b.t === 'ifYaw') { const c = cond(b); out.push(node('if', { cond: c, body: seq() })); }
      else if (b.t === 'repeat') { const times = b.val; out.push(node('repeat', { times, body: seq() })); }
      else if (b.t === 'motorGoTo') out.push(node('motorGoTo', { port: b.port, pos: b.val }));
      else if (SPEC[b.t]) out.push(node(b.t, b));
      else out.push(node('note', { op: b.op || b.t }));
    }
    return out;
  };
  return { stacks: [seq()], procs: {}, vars: [] };
}

export const DEMO = () => flatToAst([
  { t: 'speed', pct: '50' }, { t: 'move', dir: 'forward', val: '30', unit: 'cm' },
  { t: 'startMove', dir: 'clockwise' }, { t: 'waitYaw', cmp: '>', val: '88' }, { t: 'stopMove' },
  { t: 'startMove', dir: 'forward' }, { t: 'waitDist', port: 'D', cmp: '<', val: '8' }, { t: 'stopMove' },
  { t: 'motor', port: 'E', dir: 'clockwise', val: '90', unit: 'degrees' }, { t: 'wait', val: '0.5' },
  { t: 'motor', port: 'E', dir: 'counterclockwise', val: '90', unit: 'degrees' },
  { t: 'move', dir: 'back', val: '15', unit: 'cm' },
  { t: 'startMove', dir: 'counterclockwise' }, { t: 'waitYaw', cmp: '<', val: '2' }, { t: 'stopMove' },
  { t: 'move', dir: 'back', val: '32', unit: 'cm' }, { t: 'show', text: 'Home' }
]);

// Visit every node in a program (statements and expressions).
export function walkProgram(prog, fn) {
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (n.t) fn(n);
    for (const [k, v] of Object.entries(n)) if (k !== 't' && v && typeof v === 'object') visit(v);
  };
  prog.stacks.forEach(visit);
  Object.values(prog.procs || {}).forEach(p => visit(p.body));
}
