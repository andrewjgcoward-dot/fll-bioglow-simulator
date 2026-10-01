// Converts between program trees (see blocks.js) and Blockly workspace JSON
// (the format of Blockly.serialization.workspaces.save/load). Pure data, no Blockly needed.

import { SPEC, lit, walkProgram } from './blocks.js';

const varId = (name) => 'var_' + name;
const listId = (name) => 'list_' + name;

// ---------- program -> workspace JSON ----------

export function programToJson(prog) {
  const vars = new Set(prog.vars || []), lists = new Set(prog.lists || []);
  walkProgram(prog, (n) => {
    if (n.t === 'var') vars.add(n.name);
    for (const [k, d] of Object.entries((SPEC[n.t] && SPEC[n.t].p) || {})) { if (d.kind === 'var') vars.add(n[k]); if (d.kind === 'list') lists.add(n[k]); }
  });

  let argKinds = {}; // parameter kinds of the My Block being converted
  const slot = (d, e) => {
    const blank = e && (e.t === 'num' || e.t === 'text') ? e.v : d.def;
    const lt = d.kind === 'text' || blank === '' ? 'sim_text' : 'sim_num';
    const input = { shadow: { type: lt, fields: { V: lt === 'sim_num' ? Number(blank) || 0 : String(blank ?? '') } } };
    if (e && e.t !== 'num' && e.t !== 'text') input.block = expr(e);
    return input;
  };
  const fill = (j, n) => {
    const spec = SPEC[n.t] || {};
    for (const [k, d] of Object.entries(spec.p || {})) {
      if (d.kind === 'menu' || d.kind === 'field') (j.fields = j.fields || {})[k] = n[k] ?? d.opts[0];
      else if (d.kind === 'var') (j.fields = j.fields || {})[k] = { id: varId(n[k]) };
      else if (d.kind === 'list') (j.fields = j.fields || {})[k] = { id: listId(n[k]) };
      else if (d.kind === 'msg' || d.kind === 'matrix' || d.kind === 'sound') (j.fields = j.fields || {})[k] = String(n[k] ?? '');
      else if (d.kind === 'bool') { if (n[k]) (j.inputs = j.inputs || {})[k] = { block: expr(n[k]) }; }
      else (j.inputs = j.inputs || {})[k] = slot(d, n[k]);
    }
    if (spec.body && n.body && n.body.length) (j.inputs = j.inputs || {}).DO = { block: chain(n.body) };
    if (spec.else && n.else && n.else.length) (j.inputs = j.inputs || {}).ELSE = { block: chain(n.else) };
    if (n.id) j.id = n.id;
    return j;
  };
  const expr = (e) => {
    if (e.t === 'var') return { type: 'sim_var', fields: { name: { id: varId(e.name) } } };
    if (e.t === 'arg') return { type: argKinds[e.name] === 'b' ? 'sim_arg_b' : 'sim_arg', fields: { name: e.name } };
    if (e.t === 'noteR' || !SPEC[e.t]) return { type: 'sim_noteR', fields: { op: e.op || e.t } };
    return fill({ type: 'sim_' + e.t }, e);
  };
  const stmt = (n) => {
    if (n.t === 'call') {
      const proc = prog.procs && prog.procs[n.name];
      const params = proc ? proc.params : [];
      const j = { type: 'sim_call', extraState: { name: n.name, params }, inputs: {} };
      params.forEach((p, i) => {
        const a = n.args && n.args[p.name];
        if (p.kind === 'b') { if (a) j.inputs['ARG' + i] = { block: expr(a) }; }
        else j.inputs['ARG' + i] = slot({ kind: 'text', def: '' }, a);
      });
      if (n.id) j.id = n.id; return j;
    }
    if (n.t === 'note' || !SPEC[n.t] || SPEC[n.t].shape) return { type: 'sim_note', fields: { op: n.op || n.t } };
    return fill({ type: 'sim_' + n.t }, n);
  };
  function chain(list) {
    const arr = list.map(stmt);
    for (let k = arr.length - 2; k >= 0; k--) arr[k].next = { block: arr[k + 1] };
    return arr[0];
  }

  const tops = [];
  (prog.stacks || [[]]).forEach((stack, i) => {
    const hat = { type: 'sim_start', x: 40 + i * 420, y: 40 };
    if (stack.length) hat.next = { block: chain(stack) };
    tops.push(hat);
  });
  (prog.events || []).forEach((e, i) => {
    const hat = fill({ type: 'sim_' + e.hat.t, x: 40 + i * 420, y: 1300 }, e.hat);
    if (e.body.length) hat.next = { block: chain(e.body) };
    tops.push(hat);
  });
  Object.entries(prog.procs || {}).forEach(([name, p], i) => {
    const def = { type: 'sim_define', extraState: { name, params: p.params }, x: 40 + i * 420, y: 700 };
    argKinds = Object.fromEntries(p.params.map(q => [q.name, q.kind]));
    if (p.body.length) def.next = { block: chain(p.body) };
    argKinds = {};
    tops.push(def);
  });
  const out = { blocks: { languageVersion: 0, blocks: tops } };
  const variables = [...vars].map(name => ({ name, id: varId(name), type: '' })).concat([...lists].map(name => ({ name, id: listId(name), type: 'list' })));
  if (variables.length) out.variables = variables;
  return out;
}

// ---------- workspace JSON -> program ----------

export function jsonToProgram(json) {
  const warn = [];
  const tops = ((json && json.blocks && json.blocks.blocks) || []).slice().sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0));
  const varNames = {}, listNames = {};
  for (const v of (json && json.variables) || []) (v.type === 'list' ? listNames : varNames)[v.id] = v.name;
  const listOf = (f) => f && typeof f === 'object' ? (listNames[f.id] || f.name || f.id) : String(f ?? '');
  const varOf = (f) => f && typeof f === 'object' ? (varNames[f.id] || f.name || f.id) : String(f ?? '');

  const literal = (sh) => { const v = sh && sh.fields ? sh.fields.V : ''; return sh && sh.type === 'sim_text' ? { t: lit(v).t, v: String(v ?? '') } : lit(v); };
  const slot = (inp, d) => inp && inp.block ? expr(inp.block) : inp && inp.shadow ? literal(inp.shadow) : lit(d ? d.def : '');
  const fromSpec = (b, t) => {
    const spec = SPEC[t], n = { t };
    for (const [k, d] of Object.entries(spec.p || {})) {
      const inp = b.inputs && b.inputs[k];
      if (d.kind === 'menu' || d.kind === 'field') n[k] = String((b.fields && b.fields[k]) ?? d.opts[0]);
      else if (d.kind === 'var') n[k] = varOf(b.fields && b.fields[k]);
      else if (d.kind === 'list') n[k] = listOf(b.fields && b.fields[k]);
      else if (d.kind === 'msg' || d.kind === 'matrix' || d.kind === 'sound') n[k] = String((b.fields && b.fields[k]) ?? '');
      else if (d.kind === 'bool') n[k] = inp && inp.block ? expr(inp.block) : null;
      else n[k] = slot(inp, d);
    }
    if (spec.body) n.body = chain(b.inputs && b.inputs.DO && b.inputs.DO.block);
    if (spec.else) n.else = chain(b.inputs && b.inputs.ELSE && b.inputs.ELSE.block);
    return n;
  };
  const expr = (b) => {
    const type = b.type.replace(/^sim_/, '');
    if (type === 'var') return { t: 'var', name: varOf(b.fields && b.fields.name) };
    if (type === 'arg' || type === 'arg_b') return { t: 'arg', name: String(b.fields && b.fields.name) };
    if (type === 'num' || type === 'text') return literal(b);
    if (type === 'noteR' || !SPEC[type]) return { t: 'noteR', op: String((b.fields && b.fields.op) || type) };
    return fromSpec(b, type);
  };
  const stmt = (b) => {
    const type = b.type.replace(/^sim_/, '');
    let n;
    if (type === 'call') {
      const st = b.extraState || {}, args = {};
      (st.params || []).forEach((p, i) => { const inp = b.inputs && b.inputs['ARG' + i]; args[p.name] = p.kind === 'b' ? (inp && inp.block ? expr(inp.block) : null) : slot(inp, { def: '' }); });
      n = { t: 'call', name: st.name, args };
    } else if (type === 'note' || !SPEC[type] || SPEC[type].shape) n = { t: 'note', op: String((b.fields && b.fields.op) || type) };
    else n = fromSpec(b, type);
    if (b.id) n.id = b.id;
    return n;
  };
  function chain(b) {
    const out = [];
    for (; b; b = b.next && b.next.block) if (b.enabled !== false) out.push(stmt(b));
    return out;
  }

  const stacks = tops.filter(b => b.type === 'sim_start').map(h => chain(h.next && h.next.block));
  if (!stacks.length) { warn.push('Add a “when program starts” block to run your program.'); stacks.push([]); }
  const procs = {};
  for (const d of tops.filter(b => b.type === 'sim_define')) {
    const st = d.extraState || {};
    if (st.name) procs[st.name] = { params: st.params || [], body: chain(d.next && d.next.block) };
  }
  const events = tops.filter(b => { const t = b.type.replace(/^sim_/, ''); return t !== 'start' && SPEC[t] && SPEC[t].shape === 'hat'; })
    .map(b => ({ hat: fromSpec(b, b.type.replace(/^sim_/, '')), body: chain(b.next && b.next.block) }));
  const program = { stacks, events, procs, vars: Object.values(varNames), lists: Object.values(listNames), sounds: (json && json.sounds) || {} };
  let empty = 0;
  walkProgram(program, (n) => { if (['if', 'ifElse', 'waitUntil', 'repeatUntil'].includes(n.t) && !n.cond) empty++; });
  if (empty) warn.push(empty + ' block' + (empty > 1 ? 's have' : ' has') + ' an empty condition (it counts as false).');
  return { program, warn };
}
