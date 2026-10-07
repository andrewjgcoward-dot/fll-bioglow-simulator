import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { node, lit, emptyProgram } from '../src/blocks.js';
import { buildProject, convertProject, exportLlsp3, importProject } from '../src/spike-io.js';
import { Sim } from '../src/sim.js';

// Sanitized blocks from a working native SPIKE project (manifest v38).
// Original block IDs, workspace positions, hub identity and assets are omitted.
const native = JSON.parse(fs.readFileSync(new URL('./data/spike-native-movement.json', import.meta.url)));
const program = stack => ({ ...emptyProgram(), stacks: [stack] });
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const blocksOf = project => project.targets.find(t => !t.isStage).blocks;

// Compare opcodes, field values and input shapes, independently of generated IDs.
function commands(project) {
  const blocks = blocksOf(project);
  const describe = b => ({ opcode: b.opcode, shadow: b.shadow, fields: b.fields,
    inputs: Object.fromEntries(Object.entries(b.inputs).map(([k, input]) =>
      [k, input.map((v, i) => i > 0 && typeof v === 'string' ? describe(blocks[v]) : v)])) });
  const hats = Object.values(blocks).filter(b => b.topLevel);
  assert.equal(hats.length, 1);
  const out = [];
  for (let b = hats[0]; b; b = blocks[b.next]) out.push(describe(b));
  return out;
}

function checkGraph(project) {
  const blocks = blocksOf(project);
  for (const [id, b] of Object.entries(blocks)) {
    if (b.topLevel) assert.equal(b.parent, null);
    else assert.ok(blocks[b.parent], id + ' has a parent');
    if (b.next) assert.equal(blocks[b.next].parent, id);
    for (const input of Object.values(b.inputs)) for (const v of input.slice(1)) {
      if (typeof v === 'string') assert.equal(blocks[v].parent, id);
    }
  }
}

test('exported inch moves and right turns match the native SPIKE fixture', async () => {
  const source = program([
    node('move', { dir: 'forward', val: 7, unit: 'in' }),
    node('move', { dir: 'clockwise', val: 180, unit: 'degrees' }),
    node('move', { dir: 'forward', val: 60, unit: 'in' }),
    node('move', { dir: 'clockwise', val: 180, unit: 'degrees' }),
    node('move', { dir: 'forward', val: 18, unit: 'cm' })
  ]);
  const built = buildProject(source);
  assert.equal(built.dropped, 0);
  checkGraph(built.project);
  assert.deepEqual(commands(built.project), commands(native));
  const loaded = await importProject(buffer(exportLlsp3(source, 'movement regression').zip));
  assert.deepEqual(loaded.warn, []);
  assert.deepEqual(commands(buildProject(loaded.program).project), commands(native));
});

test('native inches and labeled steering import as simulator units and numbers', () => {
  const result = convertProject(native);
  assert.deepEqual(result.warn, []);
  const stack = result.program.stacks[0];
  assert.equal(stack[0].unit, 'in');
  assert.equal(stack[2].unit, 'in');
  assert.deepEqual(stack[1].steer, lit(100));
  assert.deepEqual(stack[3].steer, lit(100));
  assert.deepEqual(commands(buildProject(result.program).project), commands(native));
});

test('left and continuous spins use official SPIKE steering serialization', async () => {
  // LEGO's app migration explicitly maps clockwise -> "right: 100" and
  // counterclockwise -> "left: -100"; this is source-backed, not a left-turn fixture.
  const source = program([
    node('move', { dir: 'counterclockwise', val: 180, unit: 'degrees' }),
    node('startMove', { dir: 'clockwise' }),
    node('startMove', { dir: 'counterclockwise' })
  ]);
  const project = buildProject(source).project;
  checkGraph(project);
  const chain = commands(project).slice(1);
  assert.deepEqual(chain.map(b => b.opcode), ['flippermove_steer', 'flippermove_startSteer', 'flippermove_startSteer']);
  assert.deepEqual(chain.map(b => b.inputs.STEERING[1].fields['field_flippermove_rotation-wheel'][0]), ['left: -100', 'right: 100', 'left: -100']);
  const loaded = await importProject(buffer(exportLlsp3(source, 'left and continuous').zip));
  assert.deepEqual(loaded.program.stacks[0].map(b => b.steer.v), ['-100', '100', '-100']);
  assert.deepEqual(commands(buildProject(loaded.program).project), commands(project));
});

test('numeric steering, reporter inputs and their shadow defaults survive export', async () => {
  const source = program([
    node('steer', { steer: -35, val: 2, unit: 'rotations' }),
    node('steer', { steer: 0 }),
    node('steer', { steer: { t: 'add', a: lit(20), b: lit(10) } }),
    node('startSteer', { steer: { t: 'var', name: 'steering' } })
  ]);
  source.vars = ['steering'];
  const project = buildProject(source).project;
  checkGraph(project);
  const chain = commands(project).slice(1);
  assert.equal(chain[0].inputs.STEERING[1].fields['field_flippermove_rotation-wheel'][0], 'left: -35');
  assert.equal(chain[1].inputs.STEERING[1].fields['field_flippermove_rotation-wheel'][0], 'straight: 0');
  assert.equal(chain[2].inputs.STEERING[0], 3);
  assert.equal(chain[2].inputs.STEERING[2].fields['field_flippermove_rotation-wheel'][0], 'right: 30');
  const loaded = await importProject(buffer(exportLlsp3(source, 'steering expressions').zip));
  assert.deepEqual(loaded.program, source);
});

test('encoding spins as steering preserves wheel units, not chassis-heading degrees', () => {
  // No program is executed. Check the same numerical helpers used by the simulator.
  const sim = new Sim({ collide: false });
  assert.equal(sim.wheelDegrees(180, 'degrees'), 180);
  assert.deepEqual(sim.dirFactors('clockwise'), sim.steerFactors(100));
  assert.deepEqual(sim.dirFactors('counterclockwise'), sim.steerFactors(-100));
  // At default 56 mm wheels and 112 mm track, 180 wheel degrees imply 90 heading degrees.
  assert.equal(180 * sim.cfg.wheel / sim.cfg.track, 90);
});
