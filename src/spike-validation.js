import { SPEC } from './blocks.js';
import { CompatibilityError, supportedSymbolName } from './compatibility.js';

// Inspect the entire native graph before conversion, including loose/unused blocks.
// Unknown shadows/reporters must not be flattened to their first field value.
export function validateNativeProject(project) {
  const issues = [], specs = new Map(), shadows = new Set([
    'math_number', 'math_integer', 'math_whole_number', 'math_positive_number', 'math_angle', 'text', 'event_broadcast_menu',
    'flippermotor_multiple-port-selector', 'flippermotor_single-motor-selector'
  ]);
  for (const s of Object.values(SPEC)) {
    for (const op of s.scratch || []) specs.set(op, s);
    for (const d of Object.values(s.p || {})) if (d.shadow) shadows.add(d.shadow);
  }
  const special = new Set(['procedures_definition', 'procedures_prototype', 'procedures_call', 'argument_reporter_string_number', 'argument_reporter_boolean', 'data_variable']);
  const targets = (project.targets || []).filter(t => Object.keys(t.blocks || {}).length);
  if (targets.length !== 1) issues.push('Expected exactly one Word Blocks target; multiple targets cannot be merged safely.');
  const names = {variables: new Map(), lists: new Map()};
  const symbols = {variables: new Map(), lists: new Map()};
  for (const t of project.targets || []) for (const kind of ['variables', 'lists'])
    for (const [id, value] of Object.entries(t[kind] || {})) {
      if (symbols[kind].has(id)) issues.push(`Duplicate ${kind} ID ${id} cannot be preserved.`);
      symbols[kind].set(id, value?.[0]);
    }
  for (const t of project.targets || []) {
    for (const kind of ['variables', 'lists']) for (const [id, value] of Object.entries(t[kind] || {})) {
      const name = value?.[0];
      if (!supportedSymbolName(name)) issues.push(`Unsupported name “${name}” in ${kind}; rename it before importing.`);
      else if (names[kind].has(name)) issues.push(`Duplicate ${kind} name “${name}” across IDs or scopes cannot be merged safely.`);
      else names[kind].set(name, id);
    }
    for (const v of Object.values(t.variables || {})) if (v[1] !== 0 && v[1] !== '0') issues.push(`Variable “${v[0]}” has a stored value. Initialize it with a set-variable block instead.`);
    for (const v of Object.values(t.lists || {})) if (!Array.isArray(v[1]) || v[1].length) issues.push(`List “${v[0]}” has stored contents. Initialize it with list blocks instead.`);
    if (t.sounds?.length) issues.push('Sound assets cannot be preserved. Remove them in a copy of the SPIKE project before importing.');
    const blocks = t.blocks || {}, edges = new Map();
    for (const [id, b] of Object.entries(blocks)) {
      const label = `${b?.opcode || 'Invalid block'} [${id}]`, fail = m => issues.push(`${label}: ${m}`);
      if (!b || Array.isArray(b)) { fail('unsupported serialized block shape'); continue; }
      if (b.disabled || b.enabled === false) fail('disabled blocks cannot be preserved; enable or remove the block');
      const reference = (kind, value) => {
        if (!Array.isArray(value) || !symbols[kind].has(value[1]) || symbols[kind].get(value[1]) !== value[0])
          fail(`invalid ${kind} reference; its name and ID must match a declared symbol`);
      };
      if (b.fields?.VARIABLE) reference('variables', b.fields.VARIABLE);
      if (b.fields?.LIST) reference('lists', b.fields.LIST);
      for (const input of Object.values(b.inputs || {})) for (const value of input.slice(1)) {
        if (Array.isArray(value) && [12, 13].includes(value[0])) reference(value[0] === 12 ? 'variables' : 'lists', value.slice(1));
      }
      const s = specs.get(b.opcode);
      if (b.shadow) {
        if (!shadows.has(b.opcode) && !special.has(b.opcode)) fail('unsupported shadow block');
      } else if (!s && !special.has(b.opcode)) fail('unsupported command, reporter or event hat');
      if (s?.unsupported) fail(s.unsupported);
      if (b.topLevel && !b.shadow && s?.shape !== 'hat' && b.opcode !== 'procedures_definition') fail('loose blocks would be omitted; connect or remove them in SPIKE first');
      if (s) {
        const fields = new Set(Object.values(s.p || {}).filter(d => ['field', 'var', 'list'].includes(d.kind) || d.asField).map(d => d.key));
        const inputs = new Set(Object.values(s.p || {}).filter(d => !fields.has(d.key)).map(d => d.key));
        if (s.body) inputs.add(s.body); if (s.else) inputs.add(s.else);
        for (const k of Object.keys(b.fields || {})) if (!fields.has(k)) fail(`unsupported field ${k}`);
        for (const k of Object.keys(b.inputs || {})) if (!inputs.has(k)) fail(`unsupported input ${k}`);
        for (const d of Object.values(s.p || {})) {
          const input = b.inputs?.[d.key];
          if (!input) continue;
          const v = input[1];
          if (['menu', 'matrix', 'sound', 'msg'].includes(d.kind) && !d.asField) {
            if ((typeof v === 'string' && !blocks[v]?.shadow) || (Array.isArray(v) && [12, 13].includes(v[0]))) fail(`${d.key} is a dynamic selector; select a literal option instead`);
            if (typeof v === 'string' && blocks[v]?.shadow && d.shadow && blocks[v].opcode !== d.shadow && !(['flippermotor_multiple-port-selector', 'flippermotor_single-motor-selector'].includes(blocks[v].opcode))) fail(`${d.key} uses an incompatible shadow ${blocks[v].opcode}`);
          }
        }
      }
      if (b.opcode === 'procedures_prototype') {
        const name = String(b.mutation?.proccode || '').split('%')[0].trim();
        if (!supportedSymbolName(name)) fail(`unsupported My Block name “${name}”; rename it before importing`);
        try {
          const names = JSON.parse(b.mutation?.argumentnames || '[]');
          if (!Array.isArray(names) || names.some(n => !supportedSymbolName(n))) fail('unsupported My Block parameter name');
        } catch { fail('invalid My Block parameter names'); }
        if (b.mutation?.warp === true || b.mutation?.warp === 'true') fail('run without screen refresh is unsupported');
        const code = b.mutation?.proccode;
        if (typeof code !== 'string' || !/^([^%]*?)(?:\s+%[sbn])*$/.test(code)) fail('interleaved My Block labels cannot be preserved; use a name followed by inputs');
      }
      const refs = [b.next, ...Object.values(b.inputs || {}).flatMap(v => v.slice(1).filter(x => typeof x === 'string'))].filter(Boolean);
      edges.set(id, refs);
      for (const ref of refs) if (!blocks[ref]) fail(`missing referenced block ${ref}`);
    }
    const visiting = new Set(), done = new Set();
    const walk = id => {
      if (visiting.has(id)) { issues.push(`Block ${id}: cyclic block graph`); return; }
      if (done.has(id)) return;
      visiting.add(id); for (const next of edges.get(id) || []) walk(next); visiting.delete(id); done.add(id);
    };
    for (const id of edges.keys()) walk(id);
    const reachable = new Set(), todo = Object.keys(blocks).filter(id => blocks[id]?.topLevel);
    while (todo.length) { const id = todo.pop(); if (reachable.has(id)) continue; reachable.add(id); todo.push(...(edges.get(id) || [])); }
    for (const id of edges.keys()) if (!reachable.has(id)) issues.push(`Block ${id}: disconnected block would be omitted; connect or remove it.`);
  }
  if (issues.length) throw new CompatibilityError(issues);
  return targets[0];
}
