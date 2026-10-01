// SPIKE-style drag-and-drop block editor, built on Blockly (loaded as the global `Blockly`)
// with the Scratch-like "zelos" renderer.

import { PORTS, PAIRS, DIRS4, UNITS, COLORS } from './blocks.js';

const BLOCKLY_VERSION = '11.2.2';

// SPIKE App category colors.
const COLOR = { motor: '#0090F5', move: '#FF4CCD', light: '#9966FF', sound: '#CF63CF', events: '#FFBF00', control: '#FFAB19', sensor: '#4CBFE6', note: '#9AA5A0' };

// Motor ports seen in imported files that aren't single letters (e.g. "AE" runs two motors).
const extraPorts = new Set();
export function registerPorts(program) {
  for (const b of program) if (b.port && !PORTS.includes(b.port)) extraPorts.add(b.port);
}

const dd = (name, opts) => ({ type: 'field_dropdown', name, options: opts.map(o => Array.isArray(o) ? o : [o, o]) });
const portDd = (name = 'port') => ({ type: 'field_dropdown', name, options: () => PORTS.concat([...extraPorts]).map(p => [p, p]) });
const num = (name, value, extra) => Object.assign({ type: 'field_number', name, value }, extra);
const stmt = (type, colour, message0, args0, extra) => Object.assign({ type, message0, args0: args0 || [], previousStatement: null, nextStatement: null, colour }, extra);
const cond = (type, message0, args0) => ({ type, message0, args0, output: 'Boolean', colour: COLOR.sensor });

const DEFS = [
  { type: 'sim_start', message0: 'when program starts', nextStatement: null, colour: COLOR.events, extensions: ['sim_hat'] },

  stmt('sim_motor', COLOR.motor, '%1 run %2 for %3 %4', [portDd(), dd('dir', ['clockwise', 'counterclockwise']), num('val', 1), dd('unit', ['rotations', 'degrees', 'seconds'])]),
  stmt('sim_motorGoTo', COLOR.motor, '%1 go shortest path to position %2', [portDd(), num('val', 0, { min: 0, max: 359 })]),
  stmt('sim_motorSpeed', COLOR.motor, '%1 set speed to %2 %%', [portDd(), num('pct', 75, { min: -100, max: 100 })]),
  stmt('sim_motorStop', COLOR.motor, '%1 stop motor', [portDd()]),

  stmt('sim_move', COLOR.move, 'move %1 for %2 %3', [dd('dir', DIRS4), num('val', 10), dd('unit', UNITS)]),
  stmt('sim_steer', COLOR.move, 'move %1 steering for %2 %3', [num('steer', 30, { min: -100, max: 100 }), num('val', 10), dd('unit', UNITS)]),
  stmt('sim_startMove', COLOR.move, 'start moving %1', [dd('dir', DIRS4)]),
  stmt('sim_startSteer', COLOR.move, 'start moving with %1 steering', [num('steer', 30, { min: -100, max: 100 })]),
  stmt('sim_stopMove', COLOR.move, 'stop moving'),
  stmt('sim_speed', COLOR.move, 'set movement speed to %1 %%', [num('pct', 50, { min: -100, max: 100 })]),
  stmt('sim_pair', COLOR.move, 'set movement motors to %1', [dd('pair', PAIRS)]),

  stmt('sim_show', COLOR.light, 'write %1', [{ type: 'field_input', name: 'text', text: 'Hello' }]),
  stmt('sim_beep', COLOR.sound, 'beep %1 for %2 seconds', [num('note', 60, { min: 0, max: 127 }), num('val', 0.2, { min: 0 })]),

  stmt('sim_wait', COLOR.control, 'wait %1 seconds', [num('val', 1, { min: 0 })]),
  stmt('sim_repeat', COLOR.control, 'repeat %1', [num('val', 10, { min: 0, precision: 1 })], { message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }] }),
  stmt('sim_if', COLOR.control, 'if %1 then', [{ type: 'input_value', name: 'COND', check: 'Boolean' }], { message1: '%1', args1: [{ type: 'input_statement', name: 'DO' }] }),
  stmt('sim_wait_until', COLOR.control, 'wait until %1', [{ type: 'input_value', name: 'COND', check: 'Boolean' }]),

  cond('sim_cond_color', '%1 is color %2 ?', [portDd(), dd('color', COLORS)]),
  cond('sim_cond_dist', '%1 is %2 %3 cm ?', [portDd(), dd('cmp', ['<', '>']), num('val', 10, { min: 0 })]),
  cond('sim_cond_yaw', 'yaw angle %1 %2 ?', [dd('cmp', ['>', '<']), num('val', 90)]),
  stmt('sim_resetYaw', COLOR.sensor, 'set yaw angle to 0°'),

  stmt('sim_note', COLOR.note, 'not simulated yet: %1', [{ type: 'field_label_serializable', name: 'op', text: '?' }])
];

const cat = (name, colour, types) => ({ kind: 'category', name, colour, contents: types.map(type => ({ kind: 'block', type })) });
const TOOLBOX = {
  kind: 'categoryToolbox',
  contents: [
    cat('Motors', COLOR.motor, ['sim_motor', 'sim_motorGoTo', 'sim_motorSpeed', 'sim_motorStop']),
    cat('Movement', COLOR.move, ['sim_move', 'sim_steer', 'sim_startMove', 'sim_startSteer', 'sim_stopMove', 'sim_speed', 'sim_pair']),
    cat('Light', COLOR.light, ['sim_show']),
    cat('Sound', COLOR.sound, ['sim_beep']),
    cat('Events', COLOR.events, ['sim_start']),
    cat('Control', COLOR.control, ['sim_wait', 'sim_repeat', 'sim_if', 'sim_wait_until']),
    cat('Sensors', COLOR.sensor, ['sim_cond_color', 'sim_cond_dist', 'sim_cond_yaw', 'sim_resetYaw'])
  ]
};

let defined = false;
export function createWorkspace(container) {
  const B = window.Blockly;
  if (!B) throw new Error('The block editor could not load. Check the internet connection and reload.');
  if (!defined) {
    // Rounded "hat" top on the start block, like SPIKE's event blocks.
    B.Extensions.register('sim_hat', function () { this.hat = 'cap'; });
    B.defineBlocksWithJsonArray(DEFS);
    defined = true;
  }
  const theme = B.Theme.defineTheme('bioglow', {
    base: B.Themes.Classic,
    componentStyles: {
      workspaceBackgroundColour: '#F5F6F8', toolboxBackgroundColour: '#FFFFFF', toolboxForegroundColour: '#575E75',
      flyoutBackgroundColour: '#EEF1F4', flyoutForegroundColour: '#575E75', flyoutOpacity: 1,
      scrollbarColour: '#C6CBD1', insertionMarkerColour: '#000000', insertionMarkerOpacity: 0.2
    },
    fontStyle: { family: '"Atkinson Hyperlegible", system-ui, sans-serif', weight: '700', size: 12 }
  });
  return B.inject(container, {
    toolbox: TOOLBOX, renderer: 'zelos', theme,
    media: `https://cdn.jsdelivr.net/npm/blockly@${BLOCKLY_VERSION}/media/`,
    zoom: { controls: true, wheel: true, startScale: 0.75, maxScale: 2, minScale: 0.35 },
    move: { scrollbars: true, drag: true, wheel: false },
    grid: { spacing: 40, length: 3, colour: '#DDE1E6', snap: false },
    trashcan: true, sounds: false
  });
}
