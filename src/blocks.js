// Block types the simulator understands. A program is a flat list of blocks;
// `if...` and `repeat` open a section that a later `end` block closes.

export const PORTS = ['A', 'B', 'C', 'D', 'E', 'F'];
export const DIRS4 = ['forward', 'back', 'clockwise', 'counterclockwise'];
export const UNITS = ['cm', 'in', 'rotations', 'degrees', 'seconds'];
export const COLORS = ['black', 'white', 'red', 'blue', 'green', 'yellow', 'none'];
export const PAIRS = [];
for (const a of 'ABCDEF') for (const b of 'ABCDEF') if (a !== b) PAIRS.push(a + b);

// SPIKE color ids used by the color-selector fields.
export const COLOR_CODE = { black: 0, magenta: 1, blue: 3, azure: 4, green: 6, yellow: 7, red: 9, white: 10, none: -1 };
export const CODE_COLOR = { '0': 'black', '1': 'magenta', '3': 'blue', '4': 'azure', '5': 'green', '6': 'green', '7': 'yellow', '9': 'red', '10': 'white', '-1': 'none' };

export const CATEGORIES = {
  move: { name: 'Movement', bg: '#A72A8C' },
  motor: { name: 'Motors', bg: '#0B62AD' },
  sensor: { name: 'Sensors', bg: '#12708C' },
  control: { name: 'Control', bg: '#94570A' },
  light: { name: 'Light', bg: '#6643C4' },
  sound: { name: 'Sound', bg: '#8A3A9E' },
  note: { name: 'Note', bg: '#4A5852' }
};

export const BLOCK_CAT = {
  move: 'move', steer: 'move', startMove: 'move', startSteer: 'move', stopMove: 'move', speed: 'move', pair: 'move',
  motor: 'motor', motorSpeed: 'motor', motorStop: 'motor', motorGoTo: 'motor',
  wait: 'control', ifColor: 'control', ifDist: 'control', ifYaw: 'control', repeat: 'control', end: 'control',
  waitColor: 'sensor', waitDist: 'sensor', waitYaw: 'sensor', resetYaw: 'sensor',
  show: 'light', beep: 'sound', note: 'note'
};

export const OPENERS = { ifColor: true, ifDist: true, ifYaw: true, repeat: true };

export const DEFAULTS = {
  move: { dir: 'forward', val: '10', unit: 'cm' }, steer: { steer: '30', val: '10', unit: 'cm' },
  startMove: { dir: 'forward' }, startSteer: { steer: '30' }, stopMove: {}, speed: { pct: '50' }, pair: { pair: 'AB' },
  motor: { port: 'E', dir: 'clockwise', val: '90', unit: 'degrees' }, motorSpeed: { port: 'E', pct: '75' },
  motorStop: { port: 'E' }, motorGoTo: { port: 'E', val: '0' },
  wait: { val: '1' }, waitColor: { port: 'C', color: 'black' }, waitDist: { port: 'D', cmp: '<', val: '10' },
  waitYaw: { cmp: '>', val: '90' }, resetYaw: {}, show: { text: 'Hi' }, beep: { note: '60', val: '0.2' },
  ifColor: { port: 'C', color: 'black' }, ifDist: { port: 'D', cmp: '<', val: '10' }, ifYaw: { cmp: '>', val: '90' },
  repeat: { val: '4' }, end: {}, note: { op: '?' }
};

export const PALETTE = [
  { cat: 'move', items: [['move', 'move forward 10 cm'], ['steer', 'move with steering'], ['startMove', 'start moving'], ['startSteer', 'start steering'], ['stopMove', 'stop moving'], ['speed', 'set movement speed'], ['pair', 'set movement motors']] },
  { cat: 'motor', items: [['motor', 'run motor for'], ['motorGoTo', 'go to position'], ['motorSpeed', 'set motor speed'], ['motorStop', 'stop motor']] },
  { cat: 'sensor', items: [['waitColor', 'wait until color'], ['waitDist', 'wait until distance'], ['waitYaw', 'wait until yaw'], ['resetYaw', 'reset yaw']] },
  { cat: 'control', items: [['wait', 'wait seconds'], ['repeat', 'repeat'], ['ifColor', 'if color'], ['ifDist', 'if distance'], ['ifYaw', 'if yaw'], ['end', 'end of if / repeat']] },
  { cat: 'light', items: [['show', 'write text']] },
  { cat: 'sound', items: [['beep', 'beep']] }
];

// Layout of each block: text pieces and editable fields.
// { text } | { num: key } | { sel: key, opts } | { str: key }
export function blockParts(b) {
  const T = (text) => ({ text });
  const N = (k, aria) => ({ num: k, aria });
  const S = (k, opts, aria) => ({ sel: k, opts, aria });
  const X = (k, aria) => ({ str: k, aria });
  switch (b.t) {
    case 'move': return [T('move'), S('dir', DIRS4, 'Direction'), T('for'), N('val', 'Amount'), S('unit', UNITS, 'Unit')];
    case 'steer': return [T('move'), N('steer', 'Steering'), T('steering for'), N('val', 'Amount'), S('unit', UNITS, 'Unit')];
    case 'startMove': return [T('start moving'), S('dir', DIRS4, 'Direction')];
    case 'startSteer': return [T('start moving with steering'), N('steer', 'Steering')];
    case 'stopMove': return [T('stop moving')];
    case 'speed': return [T('set movement speed to'), N('pct', 'Speed percent'), T('%')];
    case 'pair': return [T('set movement motors to'), S('pair', PAIRS, 'Movement motor pair')];
    case 'motor': return [S('port', PORTS, 'Motor port'), T('run'), S('dir', ['clockwise', 'counterclockwise'], 'Direction'), T('for'), N('val', 'Amount'), S('unit', ['rotations', 'degrees', 'seconds'], 'Unit')];
    case 'motorSpeed': return [S('port', PORTS, 'Motor port'), T('set speed to'), N('pct', 'Speed percent'), T('%')];
    case 'motorStop': return [S('port', PORTS, 'Motor port'), T('stop motor')];
    case 'motorGoTo': return [S('port', PORTS, 'Motor port'), T('go to position'), N('val', 'Position degrees'), T('° shortest path')];
    case 'wait': return [T('wait'), N('val', 'Seconds'), T('seconds')];
    case 'waitColor': return [T('wait until'), S('port', PORTS, 'Sensor port'), T('is color'), S('color', COLORS, 'Color')];
    case 'waitDist': return [T('wait until'), S('port', PORTS, 'Sensor port'), T('is'), S('cmp', ['<', '>'], 'Comparison'), N('val', 'Distance'), T('cm')];
    case 'waitYaw': return [T('wait until yaw angle'), S('cmp', ['>', '<'], 'Comparison'), N('val', 'Degrees'), T('°')];
    case 'resetYaw': return [T('set yaw angle to 0')];
    case 'show': return [T('write'), X('text', 'Text')];
    case 'beep': return [T('beep note'), N('note', 'Note'), T('for'), N('val', 'Seconds'), T('seconds')];
    case 'ifColor': return [T('if'), S('port', PORTS, 'Sensor port'), T('is color'), S('color', COLORS, 'Color'), T('then')];
    case 'ifDist': return [T('if'), S('port', PORTS, 'Sensor port'), T('is'), S('cmp', ['<', '>'], 'Comparison'), N('val', 'Distance'), T('cm then')];
    case 'ifYaw': return [T('if yaw angle'), S('cmp', ['>', '<'], 'Comparison'), N('val', 'Degrees'), T('° then')];
    case 'repeat': return [T('repeat'), N('val', 'Times'), T('times')];
    case 'end': return [T('end')];
    default: return [T('not simulated yet: ' + b.op)];
  }
}

// Pairs each opener with its `end` (both directions) so the runner can jump.
export function matchBlocks(prog) {
  const m = {}, stack = [];
  prog.forEach((b, i) => {
    if (OPENERS[b.t]) stack.push(i);
    else if (b.t === 'end' && stack.length) { const o = stack.pop(); m[o] = i; m[i] = o; }
  });
  return m;
}

let nextId = 1;
export function newBlock(t, extra) {
  return Object.assign({ id: nextId++, t }, DEFAULTS[t], extra || {});
}
