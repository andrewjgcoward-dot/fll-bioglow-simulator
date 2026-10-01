import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRepo, listProjects, fetchProject, GitHubError } from '../src/github.js';

// A stand-in for fetch that answers from a table of API paths and records what was asked.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    const r = routes[url.replace('https://api.github.com', '')];
    if (!r) return { ok: false, status: 404, headers: new Headers() };
    if (r.status) return { ok: false, status: r.status, headers: new Headers(r.headers || {}) };
    return { ok: true, status: 200, json: async () => r, arrayBuffer: async () => r.bytes };
  };
  fn.calls = calls;
  return fn;
}

test('repository names and links are understood', () => {
  assert.deepEqual(parseRepo('team/robots'), { owner: 'team', repo: 'robots' });
  assert.deepEqual(parseRepo(' https://github.com/team/robots.git '), { owner: 'team', repo: 'robots' });
  assert.deepEqual(parseRepo('github.com/team/my.robots/tree/main/robot_game'), { owner: 'team', repo: 'my.robots' });
  assert.equal(parseRepo('robots'), null);
  assert.equal(parseRepo('https://gitlab.com/team/robots'), null);
});

test('project list finds SPIKE files in every folder, with the token sent only to GitHub', async () => {
  const f = fakeFetch({
    '/repos/team/robots': { default_branch: 'main' },
    '/repos/team/robots/git/trees/main?recursive=1': { tree: [
      { type: 'blob', path: 'robot_game/b run/Run.llsp3', sha: 's2', size: 4096 },
      { type: 'blob', path: 'robot_game/a run/project.json', sha: 'x', size: 10 },
      { type: 'tree', path: 'robot_game/a run.llsp3', sha: 'x' },
      { type: 'blob', path: 'Top.LLSP3', sha: 's1', size: 2000 },
    ] },
  });
  const { files, branch, truncated } = await listProjects({ owner: 'team', repo: 'robots' }, 'tok', f);
  assert.equal(branch, 'main'); assert.equal(truncated, false);
  assert.deepEqual(files.map(x => [x.folder, x.name, x.sha]), [['', 'Top.LLSP3', 's1'], ['robot_game/b run', 'Run.llsp3', 's2']]);
  assert.ok(f.calls.every(c => c.url.startsWith('https://api.github.com/') && c.headers.Authorization === 'Bearer tok'));
});

test('no token: no Authorization header', async () => {
  const f = fakeFetch({ '/repos/a/b': { default_branch: 'dev' }, '/repos/a/b/git/trees/dev?recursive=1': { tree: [] } });
  await listProjects({ owner: 'a', repo: 'b' }, '', f);
  assert.ok(f.calls.every(c => !('Authorization' in c.headers)));
});

test('downloading a project asks for the raw blob', async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]).buffer;
  const f = fakeFetch({ '/repos/a/b/git/blobs/s1': { bytes } });
  const buf = await fetchProject({ owner: 'a', repo: 'b' }, { sha: 's1' }, 'tok', f);
  assert.equal(buf, bytes);
  assert.equal(f.calls[0].headers.Accept, 'application/vnd.github.raw+json');
});

test('GitHub errors become plain advice', async () => {
  const where = { owner: 'a', repo: 'b' };
  await assert.rejects(listProjects(where, 'old', fakeFetch({ '/repos/a/b': { status: 401 } })), (e) => e instanceof GitHubError && /expired/.test(e.message));
  await assert.rejects(listProjects(where, 'tok', fakeFetch({})), /Contents: Read-only/);
  await assert.rejects(listProjects(where, '', fakeFetch({})), /private, add a token/);
  await assert.rejects(listProjects(where, '', fakeFetch({ '/repos/a/b': { status: 403, headers: { 'x-ratelimit-remaining': '0' } } })), /request limit/);
  await assert.rejects(listProjects(where, '', async () => { throw new TypeError('offline'); }), /internet/);
});
