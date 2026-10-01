// SPIKE-style drag-and-drop block editor, built on Blockly (loaded as the global `Blockly`)
// with the Scratch-like "zelos" renderer. Block shapes come from SPEC in blocks.js.

import { SPEC, PORTS, walkProgram } from './blocks.js';

const BLOCKLY_VERSION = '11.2.2';

// SPIKE App category colors.
export const COLOR = {
  motor: '#0090F5', move: '#FF4CCD', light: '#9966FF', sound: '#CF63CF', events: '#FFBF00', control: '#FFAB19',
  sensor: '#4CBFE6', op: '#59C059', var: '#FF8C1A', my: '#FF6680', note: '#9AA5A0'
};
const CATEGORIES = [
  ['Motors', 'motor'], ['Movement', 'move'], ['Light', 'light'], ['Sound', 'sound'], ['Events', 'events'],
  ['Control', 'control'], ['Sensors', 'sensor'], ['Operators', 'op']
];
const SHAPE = { HEXAGON: 1, ROUND: 2 };

// Motor ports seen in imported files that aren't single letters (e.g. "AE" runs two motors).
const extraPorts = new Set();
export function registerPorts(prog) {
  walkProgram(prog, (n) => { if (n.port && !PORTS.includes(n.port)) extraPorts.add(n.port); });
}

function argFor(key, d) {
  if (key === 'name') return { type: 'field_variable', name: 'name', variable: 'my variable' };
  if (!d) return { type: 'field_label_serializable', name: key, text: '' };
  if (d.kind === 'menu' || d.kind === 'field') {
    if (d.ports) return { type: 'field_dropdown', name: key, options: () => PORTS.concat([...extraPorts]).map(p => [p, p]) };
    return { type: 'field_dropdown', name: key, options: d.opts.map(o => [o, o]) };
  }
  if (d.kind === 'bool') return { type: 'input_value', name: key, check: 'Boolean' };
  return { type: 'input_value', name: key };
}

function defFor(t, s) {
  const args = [];
  // %name -> %1, %2 ...; any other % is a literal percent sign (written %% for Blockly).
  const message0 = s.text.replace(/%(\w+)/g, (_, k) => { args.push(argFor(k, s.p && s.p[k])); return '\u0001' + args.length; })
    .replace(/%/g, '%%').replace(/\u0001/g, '%');
  const def = { type: 'sim_' + t, message0, args0: args, colour: COLOR[s.cat], inputsInline: true };
  if (s.shape === 'hat') { def.nextStatement = null; def.extensions = ['sim_hat']; }
  else if (s.shape === 'n') { def.output = null; def.outputShape = SHAPE.ROUND; }
  else if (s.shape === 'b') { def.output = 'Boolean'; def.outputShape = SHAPE.HEXAGON; }
  else { def.previousStatement = null; if (!s.end) def.nextStatement = null; }
  if (s.body) { def.message1 = '%1'; def.args1 = [{ type: 'input_statement', name: 'DO' }]; }
  if (s.else) { def.message2 = 'else'; def.message3 = '%1'; def.args3 = [{ type: 'input_statement', name: 'ELSE' }]; }
  return def;
}

function defineBlocks(B) {
  B.Extensions.register('sim_hat', function () { this.hat = 'cap'; });
  B.defineBlocksWithJsonArray(Object.entries(SPEC).map(([t, s]) => defFor(t, s)).concat([
    { type: 'sim_num', message0: '%1', args0: [{ type: 'field_number', name: 'V', value: 0 }], output: null, outputShape: SHAPE.ROUND, colour: '#FFFFFF' },
    { type: 'sim_text', message0: '%1', args0: [{ type: 'field_input', name: 'V', text: '' }], output: null, outputShape: SHAPE.ROUND, colour: '#FFFFFF' },
    { type: 'sim_var', message0: '%1', args0: [{ type: 'field_variable', name: 'name', variable: 'my variable' }], output: null, outputShape: SHAPE.ROUND, colour: COLOR.var },
    { type: 'sim_arg', message0: '%1', args0: [{ type: 'field_label_serializable', name: 'name', text: 'input' }], output: null, outputShape: SHAPE.ROUND, colour: COLOR.my },
    { type: 'sim_arg_b', message0: '%1', args0: [{ type: 'field_label_serializable', name: 'name', text: 'input' }], output: 'Boolean', outputShape: SHAPE.HEXAGON, colour: COLOR.my }
  ]));

  const label = (name, params) => name + params.map(p => p.kind === 'b' ? ` <${p.name}>` : ` (${p.name})`).join('');
  // "define" hat for a My Block. Its name and inputs are fixed when it is made.
  B.Blocks.sim_define = {
    init() {
      this.procName = ''; this.params = [];
      this.appendDummyInput().appendField('define').appendField(new B.FieldLabelSerializable(''), 'LABEL');
      this.setNextStatement(true); this.setColour(COLOR.my); this.hat = 'cap';
    },
    saveExtraState() { return { name: this.procName, params: this.params }; },
    loadExtraState(st) { this.procName = st.name || ''; this.params = st.params || []; this.setFieldValue(label(this.procName, this.params), 'LABEL'); }
  };
  // A call to a My Block, with one slot per input.
  B.Blocks.sim_call = {
    init() {
      this.procName = ''; this.params = [];
      this.appendDummyInput('HEAD').appendField(new B.FieldLabelSerializable(''), 'LABEL');
      this.setPreviousStatement(true); this.setNextStatement(true); this.setColour(COLOR.my); this.setInputsInline(true);
    },
    saveExtraState() { return { name: this.procName, params: this.params }; },
    loadExtraState(st) {
      this.procName = st.name || ''; this.params = st.params || [];
      this.setFieldValue(this.procName, 'LABEL');
      for (let i = 0; this.getInput('ARG' + i); i++) this.removeInput('ARG' + i);
      this.params.forEach((p, i) => { const inp = this.appendValueInput('ARG' + i); if (p.kind === 'b') inp.setCheck('Boolean'); });
    }
  };
}

const slotShadow = (d) => ({ shadow: { type: d.kind === 'text' || d.def === '' ? 'sim_text' : 'sim_num', fields: { V: d.def } } });
const flyoutBlock = (t) => {
  const s = SPEC[t], b = { kind: 'block', type: 'sim_' + t };
  for (const [k, d] of Object.entries(s.p || {})) if (d.kind === 'num' || d.kind === 'text') (b.inputs = b.inputs || {})[k] = slotShadow(d);
  return b;
};

function toolbox() {
  const contents = CATEGORIES.map(([name, cat]) => ({
    kind: 'category', name, colour: COLOR[cat],
    contents: Object.keys(SPEC).filter(t => SPEC[t].cat === cat).map(flyoutBlock)
  }));
  contents.push({ kind: 'category', name: 'Variables', colour: COLOR.var, custom: 'SIM_VARIABLES' });
  contents.push({ kind: 'category', name: 'My Blocks', colour: COLOR.my, custom: 'SIM_MYBLOCKS' });
  return { kind: 'categoryToolbox', contents };
}

function variablesFlyout(ws) {
  const items = [{ kind: 'button', text: 'Make a Variable', callbackKey: 'SIM_MAKE_VAR' }];
  const vars = ws.getVariablesOfType('');
  if (vars.length) {
    const first = { name: { id: vars[0].getId() } };
    for (const v of vars) items.push({ kind: 'block', type: 'sim_var', fields: { name: { id: v.getId() } } });
    items.push({ kind: 'block', type: 'sim_setVar', fields: first, inputs: { val: slotShadow(SPEC.setVar.p.val) } });
    items.push({ kind: 'block', type: 'sim_changeVar', fields: first, inputs: { val: slotShadow(SPEC.changeVar.p.val) } });
  }
  return items;
}

function myBlocksFlyout(ws) {
  const items = [{ kind: 'button', text: 'Make a Block', callbackKey: 'SIM_MAKE_BLOCK' }];
  for (const d of ws.getTopBlocks(false).filter(b => b.type === 'sim_define')) {
    const call = { kind: 'block', type: 'sim_call', extraState: { name: d.procName, params: d.params }, inputs: {} };
    d.params.forEach((p, i) => { if (p.kind !== 'b') call.inputs['ARG' + i] = { shadow: { type: 'sim_text', fields: { V: '' } } }; });
    items.push(call);
    for (const p of d.params) items.push({ kind: 'block', type: p.kind === 'b' ? 'sim_arg_b' : 'sim_arg', fields: { name: p.name } });
  }
  return items;
}

// SPIKE's "Make a Block": a name plus optional inputs. "height, fast?" makes a number input
// called height and a true/false input called fast.
function makeBlock(ws) {
  const name = (window.prompt('Name your block:') || '').trim();
  if (!name) return;
  if (ws.getTopBlocks(false).some(b => b.type === 'sim_define' && b.procName === name)) { window.alert('There is already a block called “' + name + '”.'); return; }
  const raw = window.prompt('Inputs, separated by commas (leave empty for none).\nEnd an input with ? to make it true/false, like: distance, slow?') || '';
  const params = raw.split(',').map(s => s.trim()).filter(Boolean).map(s => s.endsWith('?') ? { name: s.slice(0, -1).trim(), kind: 'b' } : { name: s, kind: 'n' });
  const m = ws.getMetricsManager().getViewMetrics(true);
  window.Blockly.serialization.blocks.append({ type: 'sim_define', extraState: { name, params }, x: m.left + 60, y: m.top + 60 }, ws);
  const tb = ws.getToolbox(); if (tb) tb.refreshSelection();
}

let defined = false;
export function createWorkspace(container) {
  const B = window.Blockly;
  if (!B) throw new Error('The block editor could not load. Check the internet connection and reload.');
  if (!defined) { defineBlocks(B); defined = true; }
  const theme = B.Theme.defineTheme('bioglow', {
    base: B.Themes.Classic,
    componentStyles: {
      workspaceBackgroundColour: '#F5F6F8', toolboxBackgroundColour: '#FFFFFF', toolboxForegroundColour: '#575E75',
      flyoutBackgroundColour: '#EEF1F4', flyoutForegroundColour: '#575E75', flyoutOpacity: 1,
      scrollbarColour: '#C6CBD1', insertionMarkerColour: '#000000', insertionMarkerOpacity: 0.2
    },
    fontStyle: { family: '"Atkinson Hyperlegible", system-ui, sans-serif', weight: '700', size: 12 }
  });
  const ws = B.inject(container, {
    toolbox: toolbox(), renderer: 'zelos', theme,
    media: `https://cdn.jsdelivr.net/npm/blockly@${BLOCKLY_VERSION}/media/`,
    zoom: { controls: true, wheel: true, startScale: 0.75, maxScale: 2, minScale: 0.35 },
    move: { scrollbars: true, drag: true, wheel: false },
    grid: { spacing: 40, length: 3, colour: '#DDE1E6', snap: false },
    trashcan: true, sounds: false
  });
  ws.registerToolboxCategoryCallback('SIM_VARIABLES', variablesFlyout);
  ws.registerToolboxCategoryCallback('SIM_MYBLOCKS', myBlocksFlyout);
  ws.registerButtonCallback('SIM_MAKE_VAR', (btn) => B.Variables.createVariableButtonHandler(btn.getTargetWorkspace(), null, ''));
  ws.registerButtonCallback('SIM_MAKE_BLOCK', () => makeBlock(ws));
  return ws;
}
