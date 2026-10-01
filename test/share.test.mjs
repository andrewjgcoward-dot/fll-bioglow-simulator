import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeShare, decodeShare, shareUrl, codeFromHash } from '../src/share.js';
import { DEMO } from '../src/blocks.js';
import { DEFAULT_CONFIG } from '../src/sim.js';

const strip = (p) => JSON.parse(JSON.stringify(p, (k, v) => k === 'id' ? undefined : v));

test('a share link carries the program, robot and start position', async () => {
  const program = DEMO(), cfg = { ...DEFAULT_CONFIG, wheel: 88 }, start = { x: 1700, y: 300, h: 90 };
  const url = await shareUrl('https://example.org/sim/?x=1#old', { program, cfg, start });
  assert.ok(url.startsWith('https://example.org/sim/?x=1#p='));
  assert.match(url.split('#p=')[1], /^[A-Za-z0-9_-]+$/); // safe in links, email and chat
  const back = await decodeShare(codeFromHash(new URL(url).hash));
  assert.deepEqual(back.program, strip(program));
  assert.equal(back.cfg.wheel, 88);
  assert.deepEqual(back.start, start);
  assert.ok(url.length < 2000, `demo link is ${url.length} characters`);
});

test('only #p= hashes are share links', () => {
  assert.equal(codeFromHash('#p=abc'), 'abc');
  assert.equal(codeFromHash('p=abc'), 'abc');
  assert.equal(codeFromHash('#score'), null);
  assert.equal(codeFromHash(''), null);
});

test('cut-off or foreign links give a clear message', async () => {
  const code = await encodeShare({ program: DEMO(), cfg: {}, start: {} });
  await assert.rejects(decodeShare(code.slice(0, code.length / 2)), /damaged or incomplete/);
  await assert.rejects(decodeShare('not-a-link'), /damaged or incomplete/);
  const other = await encodeShare({ program: { nope: 1 }, cfg: {}, start: {} });
  await assert.rejects(decodeShare(other), /different version/);
});
