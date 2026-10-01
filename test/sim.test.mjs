import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Sim } from '../src/sim.js';
import { newBlock, PALETTE } from '../src/blocks.js';
import { importProject, exportLlsp3, makeZip, buildProject } from '../src/spike-io.js';
import { MISSIONS, totalScore } from '../src/field.js';

const prog = (list) => list.map(([t, o]) => newBlock(t, o));
const runToEnd = (sim, program, limit = 60) => { sim.run(program); let t = 0; while (sim.running && t < limit) { sim.advance(0.02); t += 0.02; } return t; };
const strip = (p) => p.filter(b => b.t !== 'note').map(({ id, ...r }) => r);
const ab = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

test('moving forward 20 cm goes 20 cm', () => {
  const sim = new Sim({}, { x: 240, y: 240, h: 0 });
  runToEnd(sim, prog([['move', { dir: 'forward', val: '20', unit: 'cm' }]]));
  assert.ok(Math.abs(sim.pose.y - 440) < 3, 'y was ' + sim.pose.y);
  assert.ok(Math.abs(sim.pose.x - 240) < 1);
});

test('spin until yaw > 90 turns clockwise about 90°', () => {
  const sim = new Sim({}, { x: 240, y: 240, h: 0 });
  runToEnd(sim, prog([['startMove', { dir: 'clockwise' }], ['waitYaw', { cmp: '>', val: '90' }], ['stopMove', {}]]));
  assert.ok(sim.pose.h > 90 && sim.pose.h < 95, 'heading ' + sim.pose.h);
});

test('robot stalls against a wall instead of driving through it', () => {
  const sim = new Sim({}, { x: 1000, y: 300, h: 180 });
  runToEnd(sim, prog([['move', { dir: 'forward', val: '100', unit: 'cm' }]]));
  assert.ok(sim.pose.y >= 99, 'y ' + sim.pose.y);
  assert.ok(sim.logLines.some(l => l.includes('stalled')));
});

const piece = (x, y, extra) => Object.assign({ id: 'p', n: 'P', name: 'test piece', x, y, w: 60, h: 60, r: 0 }, extra);

test('the robot pushes a loose piece ahead of it', () => {
  const sim = new Sim({}, { x: 1600, y: 300, h: 0 }, [piece(1600, 500)]);
  runToEnd(sim, prog([['move', { dir: 'forward', val: '30', unit: 'cm' }]]));
  const p = sim.objects.find(o => o.loose);
  assert.ok(Math.abs(sim.pose.y - 600) < 3, 'robot y ' + sim.pose.y);
  assert.ok(p.y > 725 && p.y < 735, 'piece y ' + p.y);
  assert.ok(Math.abs(p.r) < 1, 'straight push should not turn it: ' + p.r);
});

test('an off-center push turns the piece', () => {
  const sim = new Sim({}, { x: 1560, y: 300, h: 0 }, [piece(1655, 500)]);
  runToEnd(sim, prog([['move', { dir: 'forward', val: '20', unit: 'cm' }]]));
  const p = sim.objects.find(o => o.loose);
  assert.ok(p.y > 520 || p.x > 1665, 'piece should have moved: ' + p.x + ',' + p.y);
  assert.ok(Math.abs(p.r) > 3, 'piece should have turned: ' + p.r);
});

test('a piece pinned against a fixed model stops the robot', () => {
  // M02 sits at (630, 540); pin a piece just below it.
  const sim = new Sim({}, { x: 630, y: 230, h: 0 }, [piece(630, 440)]);
  runToEnd(sim, prog([['move', { dir: 'forward', val: '30', unit: 'cm' }]]));
  const p = sim.objects.find(o => o.loose);
  assert.ok(p.y < 480, 'piece y ' + p.y);
  assert.ok(sim.logLines.some(l => l.includes('Bumped')));
});

test('fixed models block the robot unless shove mode is on', () => {
  const fixed = new Sim({}, { x: 630, y: 300, h: 0 });
  runToEnd(fixed, prog([['move', { dir: 'forward', val: '30', unit: 'cm' }]]));
  assert.equal(fixed.objects.find(o => o.n === '02').y, 540);
  const shove = new Sim({ shove: true }, { x: 630, y: 300, h: 0 });
  runToEnd(shove, prog([['move', { dir: 'forward', val: '30', unit: 'cm' }]]));
  assert.ok(shove.objects.find(o => o.n === '02').y > 560);
});

test('a fresh run puts pushed pieces back; a match keeps them', () => {
  const layout = [piece(1600, 500)];
  const sim = new Sim({}, { x: 1600, y: 300, h: 0 }, layout);
  const push = prog([['move', { dir: 'forward', val: '20', unit: 'cm' }]]);
  runToEnd(sim, push);
  assert.ok(sim.objects.find(o => o.loose).y > 500);
  sim.run(prog([])); assert.equal(sim.objects.find(o => o.loose).y, 500);
  assert.equal(layout[0].y, 500, 'layout is never changed by the simulation');
  sim.startMatch(); runToEnd(sim, push);
  const moved = sim.objects.find(o => o.loose).y;
  sim.run(prog([])); assert.equal(sim.objects.find(o => o.loose).y, moved);
});

test('repeat runs its body N times and if skips when false', () => {
  const sim = new Sim({}, { x: 240, y: 240, h: 0 });
  runToEnd(sim, prog([
    ['repeat', { val: '3' }], ['motor', { port: 'E', dir: 'clockwise', val: '10', unit: 'degrees' }], ['end', {}],
    ['ifColor', { port: 'C', color: 'black' }], ['motor', { port: 'E', dir: 'clockwise', val: '100', unit: 'degrees' }], ['end', {}]
  ]));
  assert.ok(Math.abs(sim.arms.E - 30) < 0.01, 'arm ' + sim.arms.E);
});

test('color sensor sees white in home and black on a mat line', () => {
  const sim = new Sim({}, { x: 240, y: 240, h: 0 });
  assert.equal(sim.sens.color, 'white');
  const onLine = new Sim({ collide: false }, { x: 600, y: 892 - 70, h: 0 });
  assert.equal(onLine.sens.color, 'black');
});

test('interrupting outside home during a match costs a token', () => {
  const sim = new Sim({}, { x: 240, y: 240, h: 0 });
  sim.startMatch();
  sim.run(prog([['move', { dir: 'forward', val: '60', unit: 'cm' }]]));
  sim.advance(2);
  assert.equal(sim.stop(), true);
});

test('every palette block survives export and re-import', async () => {
  const all = [];
  for (const g of PALETTE) for (const [t] of g.items) { if (t === 'end') continue; all.push(newBlock(t)); if (t.startsWith('if') || t === 'repeat') all.push(newBlock('end')); }
  const { zip, dropped } = exportLlsp3(all, 'all blocks');
  assert.equal(dropped, 0);
  const back = await importProject(ab(zip));
  assert.deepEqual(strip(back.program), strip(all));
});

test('nested if inside repeat keeps its structure', async () => {
  const p = prog([['repeat', { val: '2' }], ['ifDist', { port: 'D', cmp: '<', val: '5' }], ['stopMove', {}], ['end', {}], ['wait', { val: '0.1' }], ['end', {}], ['show', { text: 'done' }]]);
  const back = await importProject(ab(exportLlsp3(p, 'n').zip));
  assert.deepEqual(strip(back.program), strip(p));
});

test('reads deflate-compressed files like the SPIKE app writes', async () => {
  const { project } = buildProject(prog([['move', { dir: 'back', val: '2', unit: 'rotations' }]]));
  const deflateZip = (entries) => {
    // Minimal zip writer using method 8 (deflate).
    const chunks = [], central = []; let off = 0;
    for (const [name, data] of entries) {
      const n = Buffer.from(name), c = zlib.deflateRawSync(data);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(c.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
      chunks.push(lh, n, c);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(c.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
      central.push(ch, n); off += 30 + n.length + c.length;
    }
    const cd = Buffer.concat(central); const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    return Buffer.concat([...chunks, cd, end]);
  };
  const sb3 = deflateZip([['project.json', Buffer.from(JSON.stringify(project))]]);
  const llsp3 = deflateZip([['manifest.json', Buffer.from('{}')], ['scratch.sb3', sb3]]);
  const res = await importProject(ab(llsp3));
  assert.equal(res.program.length, 1);
  assert.equal(res.program[0].dir, 'back');
});

test('rejects SPIKE Python projects with a clear message', async () => {
  const zip = makeZip([{ name: 'manifest.json', data: '{}' }, { name: 'projectbody.json', data: '{}' }]);
  await assert.rejects(importProject(ab(zip)), /Python/);
});

test('scoring follows the rulebook rules', () => {
  assert.equal(totalScore({}, 6, false), 50);
  assert.equal(totalScore({ m01b: true }, 0, false), 0, 'bonus needs the main condition');
  assert.equal(totalScore({ m04a: true, m04b: true, m04x: true }, 0, false), 0, 'katydid outside zeroes M04');
  assert.equal(totalScore({ m14a: 2, m14b: 5 }, 0, true), 20 + 10 + 10, 'M14 bonus capped by seeds in station');
  assert.equal(MISSIONS.length, 15);
});

// Optional: point SPIKE_FIXTURES at a folder of your own .llsp3 files (kept out of git).
const fixtures = process.env.SPIKE_FIXTURES;
test('imports and round-trips local SPIKE files', { skip: !fixtures && 'set SPIKE_FIXTURES to a folder of .llsp3 files' }, async () => {
  const files = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.llsp3')) files.push(p); } };
  walk(fixtures);
  assert.ok(files.length > 0, 'no .llsp3 files found');
  for (const f of files) {
    const res = await importProject(ab(fs.readFileSync(f)));
    const back = await importProject(ab(exportLlsp3(res.program, 'rt').zip));
    assert.deepEqual(strip(back.program), strip(res.program), path.basename(f));
    const sim = new Sim(res.cfg, { x: 240, y: 240, h: 0 });
    runToEnd(sim, res.program, 150);
  }
  console.log(`  checked ${files.length} file(s)`);
});
