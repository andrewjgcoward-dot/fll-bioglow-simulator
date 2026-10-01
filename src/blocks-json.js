// Converts between the simulator's flat program list and Blockly workspace JSON
// (the format of Blockly.serialization.workspaces.save/load). Pure data, no Blockly needed.

import { newBlock } from './blocks.js';

// Field names of each statement block (Blockly type is 'sim_' + type).
export const FIELDS = {
  move: ['dir', 'val', 'unit'], steer: ['steer', 'val', 'unit'], startMove: ['dir'], startSteer: ['steer'],
  stopMove: [], speed: ['pct'], pair: ['pair'],
  motor: ['port', 'dir', 'val', 'unit'], motorGoTo: ['port', 'val'], motorSpeed: ['port', 'pct'], motorStop: ['port'],
  wait: ['val'], resetYaw: [], show: ['text'], beep: ['note', 'val'], note: ['op']
};

// Condition (boolean) blocks and the program block types they turn into.
export const CONDS = {
  color: { fields: ['port', 'color'], wait: 'waitColor', if: 'ifColor' },
  dist: { fields: ['port', 'cmp', 'val'], wait: 'waitDist', if: 'ifDist' },
  yaw: { fields: ['cmp', 'val'], wait: 'waitYaw', if: 'ifYaw' }
};
const COND_OF = {};
for (const [k, c] of Object.entries(CONDS)) { COND_OF[c.wait] = ['wait', k]; COND_OF[c.if] = ['if', k]; }

const pick = (obj, keys) => { const f = {}; for (const k of keys) if (obj[k] !== undefined) f[k] = String(obj[k]); return f; };

// Flat program -> workspace JSON with one "when program starts" stack.
export function programToJson(program) {
  let i = 0;
  const seq = () => {
    const out = [];
    while (i < program.length) {
      const it = program[i++];
      if (it.t === 'end') return out;
      out.push(toBlock(it));
    }
    return out;
  };
  const chain = (arr) => { for (let k = arr.length - 2; k >= 0; k--) arr[k].next = { block: arr[k + 1] }; return arr[0]; };
  const toBlock = (it) => {
    const c = COND_OF[it.t];
    if (c) {
      const cond = { type: 'sim_cond_' + c[1], fields: pick(it, CONDS[c[1]].fields) };
      if (c[0] === 'wait') return { type: 'sim_wait_until', inputs: { COND: { block: cond } } };
      const b = { type: 'sim_if', inputs: { COND: { block: cond } } };
      const body = seq(); if (body.length) b.inputs.DO = { block: chain(body) };
      return b;
    }
    if (it.t === 'repeat') {
      const b = { type: 'sim_repeat', fields: pick(it, ['val']), inputs: {} };
      const body = seq(); if (body.length) b.inputs.DO = { block: chain(body) };
      return b;
    }
    return { type: 'sim_' + (FIELDS[it.t] ? it.t : 'note'), fields: pick(it, FIELDS[it.t] || ['op']) };
  };
  const body = seq();
  const hat = { type: 'sim_start', x: 40, y: 40 };
  if (body.length) hat.next = { block: chain(body) };
  return { blocks: { languageVersion: 0, blocks: [hat] } };
}

// Workspace JSON -> { program, ids, warn }. ids[i] is the Blockly block id behind program[i]
// (the C-block for an `end`), so the running block can be highlighted.
export function jsonToProgram(json) {
  const tops = (json && json.blocks && json.blocks.blocks) || [];
  const hats = tops.filter(b => b.type === 'sim_start').sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
  const warn = [];
  if (!hats.length) return { program: [], ids: [], warn: ['Add a “when program starts” block to run your program.'] };
  if (hats.length > 1) warn.push('Only the top “when program starts” stack runs.');
  const program = [], ids = [];
  const push = (t, fields, id) => { program.push(newBlock(t, fields)); ids.push(id); };
  const fieldsOf = (b, keys) => pick(b.fields || {}, keys);
  const walk = (b) => {
    for (; b; b = b.next && b.next.block) {
      if (b.enabled === false) continue;
      const type = b.type.replace(/^sim_/, '');
      if (type === 'wait_until' || type === 'if') {
        const c = b.inputs && b.inputs.COND && b.inputs.COND.block;
        const kind = c && c.type.replace(/^sim_cond_/, '');
        if (!c || !CONDS[kind]) {
          // An empty condition is false: "wait until" never finishes, "if" skips its blocks.
          warn.push('A “' + (type === 'if' ? 'if' : 'wait until') + '” block has no condition.');
          if (type === 'wait_until') push('note', { op: 'wait until (empty)' }, b.id);
          continue;
        }
        push(CONDS[kind][type === 'if' ? 'if' : 'wait'], fieldsOf(c, CONDS[kind].fields), b.id);
        if (type === 'if') { walk(b.inputs.DO && b.inputs.DO.block); push('end', {}, b.id); }
      } else if (type === 'repeat') {
        push('repeat', fieldsOf(b, ['val']), b.id);
        walk(b.inputs && b.inputs.DO && b.inputs.DO.block);
        push('end', {}, b.id);
      } else if (FIELDS[type]) {
        push(type, fieldsOf(b, FIELDS[type]), b.id);
      }
    }
  };
  walk(hats[0].next && hats[0].next.block);
  return { program, ids, warn };
}
