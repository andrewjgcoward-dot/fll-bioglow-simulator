// One fail-closed boundary for files, saved programs, share links and execution.
import { SPEC, lit, walkProgram } from './blocks.js';

export class CompatibilityError extends Error {
  constructor(issues) {
    super('Project is not supported:\n' + issues.map(x => '• ' + x).join('\n') + '\nKeep the original project. Replace the listed blocks/options in SPIKE and try again.');
    this.name = 'CompatibilityError';
    this.issues = issues;
  }
}

// Plain-object maps are used by Blockly and native export. Reject names that
// would address their prototypes before any conversion or execution mutates them.
export const supportedSymbolName = name => typeof name === 'string' && name.length > 0 && !Object.hasOwn(Object.prototype, name);

const SENSOR_PORT_CONFIG = {
  whenColor: 'colorPort', isColor: 'colorPort', isReflection: 'colorPort', color: 'colorPort', reflection: 'colorPort',
  whenDistance: 'distPort', isDistance: 'distPort', distance: 'distPort',
  whenPressed: 'forcePort', isPressed: 'forcePort'
};
const SENSOR_NAMES = { colorPort: 'color', distPort: 'distance', forcePort: 'force' };

// Each sensor kind has one physical reading in this simulator. All uses,
// including event hats, must refer to that same configured port.
export function learnSensorPort(config, node) {
  const key = Object.hasOwn(SENSOR_PORT_CONFIG, node.t) && SENSOR_PORT_CONFIG[node.t];
  if (!key) return;
  if (config[key] !== undefined && config[key] !== node.port)
    throw new CompatibilityError([`Conflicting ${SENSOR_NAMES[key]} sensor ports ${config[key]} and ${node.port}. Only one ${SENSOR_NAMES[key]} sensor is modeled; use one port consistently.`]);
  config[key] = node.port;
}

// Work on a copy: a failed migration/validation must never damage the caller's program.
export function migrateProgram(program) {
  try { JSON.stringify(program); } catch { throw new CompatibilityError(['Program contains a cycle or is too deeply nested.']); }
  const p = structuredClone(program);
  if (!p || !Array.isArray(p.stacks)) throw new CompatibilityError(['Invalid program: missing stacks.']);
  p.events ??= []; p.procs ??= {}; p.vars ??= []; p.lists ??= []; p.sounds ??= {};
  walkProgram(p, n => {
    for (const [key, d] of Object.entries(SPEC[n.t]?.p || {})) {
      if (d.ports && d.multiple && typeof n[key] === 'string') n[key] = n[key].split('').sort().join('');
    }
    if (['move', 'startMove'].includes(n.t) && ['clockwise', 'counterclockwise'].includes(n.dir)) {
      n.t = n.t === 'move' ? 'steer' : 'startSteer';
      n.steer = lit(n.dir === 'clockwise' ? 100 : -100);
      delete n.dir; // VALUE remains wheel travel, never chassis-heading degrees.
    }
    if (['distance', 'isDistance', 'whenDistance', 'setDistance'].includes(n.t)) n.unit ??= 'cm';
    if (n.t === 'isPressed') n.opt ??= 'pressed';
    if (n.t === 'buttonPressed') n.event ??= 'pressed';
    if (n.t === 'stop' && n.opt === 'this script') n.opt = 'this stack';
    if (n.t === 'stop' && n.opt === 'other scripts in sprite') { n.t = 'stopOthers'; delete n.opt; }
  });
  return p;
}

export function validateProgram(p) {
  const issues = [], issue = (path, message) => issues.push(`${path}: ${message}`);
  const sensorConfig = {};
  const checkName = (name, path) => { if (!supportedSymbolName(name)) issue(path, `unsupported name “${String(name)}”; rename this symbol before importing or running.`); };
  for (const kind of ['vars', 'lists']) {
    if (!Array.isArray(p?.[kind])) { issue(kind, 'expected a list of symbol names'); continue; }
    const seen = new Set();
    for (const name of p[kind]) { checkName(name, kind); if (seen.has(name)) issue(kind, `duplicate name “${name}”`); seen.add(name); }
  }
  if (!p || !Array.isArray(p.stacks)) throw new CompatibilityError(['Invalid program: missing stacks.']);
  if (Object.keys(p.sounds || {}).length) issue('Sound assets', 'sound files/durations cannot be preserved by this simulator.');
  if (Object.keys(p.initialVars || {}).length || Object.keys(p.initialLists || {}).length)
    issue('Stored data', 'initial variable/list values are unsupported; initialize them with blocks.');
  const visit = (n, path, role, args = []) => {
    if (n == null && role === 'expr') return;
    if (!n || typeof n !== 'object' || Array.isArray(n)) { issue(path, 'invalid block'); return; }
    const s = Object.hasOwn(SPEC, n.t) && SPEC[n.t];
    if (['num', 'text', 'var', 'arg'].includes(n.t)) {
      if (role !== 'expr') issue(path, `${n.t} is a reporter, not a command.`);
      if (['num', 'text'].includes(n.t) && !['string', 'number'].includes(typeof n.v)) issue(path, 'invalid literal value');
      if (n.t === 'num' && !Number.isFinite(Number(n.v))) issue(path, 'invalid numeric literal');
      if (['var', 'arg'].includes(n.t)) checkName(n.name, path);
      if (n.t === 'arg' && !args.includes(n.name)) issue(path, `argument “${n.name}” has no parameter in this My Block.`);
      return;
    }
    if (n.t === 'call') {
      if (role !== 'stmt') issue(path, 'My Block call is not a reporter.');
      checkName(n.name, path);
      const proc = Object.hasOwn(p.procs || {}, n.name) && p.procs[n.name];
      if (!proc) issue(path, `My Block “${n.name}” has no definition.`);
      for (const [k, v] of Object.entries(n.args || {})) {
        checkName(k, path);
        if (proc && !proc.params.some(q => q.name === k)) issue(path, `unknown argument “${k}”.`);
        visit(v, path + '.' + k, 'expr', args);
      }
      return;
    }
    if (!s || ['note', 'noteR'].includes(n.t) || s.unsupported) {
      issue(path, `${n.op || n.t}: ${s?.unsupported || 'block is unsupported; it cannot be skipped or replaced with zero.'}`); return;
    }
    const shape = s.shape === 'hat' ? 'hat' : s.shape ? 'expr' : 'stmt';
    if (shape !== role) issue(path, `${n.t} cannot be used as a ${role}.`);
    try { learnSensorPort(sensorConfig, n); } catch (error) { for (const message of error.issues) issue(path, message); }
    const allowed = new Set(['t', 'id', ...Object.keys(s.p || {})]);
    if (s.body) allowed.add('body'); if (s.else) allowed.add('else');
    for (const key of Object.keys(n)) if (!allowed.has(key)) issue(path, `unsupported block property ${key}; it cannot be discarded.`);
    for (const [k, d] of Object.entries(s.p || {})) {
      const v = n[k], where = `${path} (${n.t}).${k}`;
      if (['num', 'text', 'bool'].includes(d.kind)) {
        if (v == null && d.kind !== 'bool') issue(where, 'missing input');
        else visit(v, where, 'expr', args);
      }
      else if (['menu', 'field'].includes(d.kind)) {
        const portsOK = d.ports && typeof v === 'string' && /^[A-F]+$/.test(v) && new Set(v).size === v.length && (d.multiple || v.length === 1);
        if (!(d.ports ? portsOK : d.opts.includes(v))) issue(where, `unsupported option “${typeof v === 'object' ? 'dynamic selector' : v}”; supported: ${d.ports && d.multiple ? 'one or more distinct A–F ports' : d.opts.join(', ')}.`);
      } else if (d.kind === 'matrix' && !/^[0-9]{25}$/.test(v)) issue(where, 'expected 25 brightness digits (0–9).');
      else if (['var', 'list', 'msg'].includes(d.kind)) checkName(v, where);
    }
    if (s.body) sequence(n.body || [], path + '.body', args);
    if (s.else) sequence(n.else || [], path + '.else', args);
  };
  const sequence = (list, path, args = []) => {
    if (!Array.isArray(list)) { issue(path, 'expected a stack'); return; }
    list.forEach((n, i) => visit(n, `${path}[${i + 1}]`, 'stmt', args));
  };
  p.stacks.forEach((s, i) => sequence(s, `Start stack ${i + 1}`));
  (p.events || []).forEach((e, i) => { visit(e.hat, `Event ${i + 1}`, 'hat'); sequence(e.body, `Event ${i + 1}.body`); });
  for (const [name, proc] of Object.entries(p.procs || {})) {
    checkName(name, `My Block ${name}`);
    const args = (proc.params || []).map(q => q.name);
    for (const arg of args) checkName(arg, `My Block ${name} parameter`);
    if (new Set(args).size !== args.length || proc.params?.some(q => !['n', 'b'].includes(q.kind))) issue(`My Block ${name}`, 'duplicate or invalid parameters.');
    sequence(proc.body, `My Block ${name}`, args);
  }
  if (issues.length) throw new CompatibilityError(issues);
  return p;
}

export const prepareProgram = p => validateProgram(migrateProgram(p));
