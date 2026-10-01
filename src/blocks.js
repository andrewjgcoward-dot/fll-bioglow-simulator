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
