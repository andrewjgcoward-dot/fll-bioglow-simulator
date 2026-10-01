// Read SPIKE projects straight from a GitHub repository (read-only).
// A private repo needs a fine-grained personal access token with Contents: Read-only.
// The token is only ever sent to api.github.com.

const API = 'https://api.github.com';
const PROJECT = /\.(llsp3|llsp|sb3)$/i;

// Accepts "owner/repo", a github.com URL, or a URL pointing into a folder or file of the repo.
export function parseRepo(input) {
  const s = String(input || '').trim().replace(/\.git$/, '');
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i) || s.match(/^([\w.-]+)\/([\w.-]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export class GitHubError extends Error {}

async function call(path, token, fetchFn, accept = 'application/vnd.github+json') {
  const headers = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = 'Bearer ' + token;
  let res;
  try { res = await fetchFn(API + path, { headers }); }
  catch { throw new GitHubError('Could not reach GitHub. Check the internet connection.'); }
  if (res.ok) return res;
  if (res.status === 401) throw new GitHubError('GitHub did not accept the token. It may have expired or been revoked: make a new one and paste it here.');
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') throw new GitHubError('GitHub’s request limit was reached. Try again in a few minutes' + (token ? '.' : ', or add a token.'));
  if (res.status === 403 || res.status === 404) throw new GitHubError(token
    ? 'Repository not found, or the token can’t read it. Check the name, and that the token includes this repository with Contents: Read-only.'
    : 'Repository not found. If it is private, add a token.');
  throw new GitHubError(`GitHub answered ${res.status}.`);
}

// Every SPIKE project file in the repo's default branch: [{ path, name, folder, sha, size }], grouped by folder.
export async function listProjects({ owner, repo }, token, fetchFn = fetch) {
  const info = await (await call(`/repos/${owner}/${repo}`, token, fetchFn)).json();
  const branch = encodeURIComponent(info.default_branch || 'main');
  const tree = await (await call(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, token, fetchFn)).json();
  const files = (tree.tree || []).filter(e => e.type === 'blob' && PROJECT.test(e.path)).map(e => {
    const cut = e.path.lastIndexOf('/');
    return { path: e.path, name: e.path.slice(cut + 1), folder: cut < 0 ? '' : e.path.slice(0, cut), sha: e.sha, size: e.size };
  });
  files.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
  return { files, truncated: !!tree.truncated, branch: info.default_branch };
}

// The file's bytes as an ArrayBuffer.
export async function fetchProject({ owner, repo }, file, token, fetchFn = fetch) {
  const res = await call(`/repos/${owner}/${repo}/git/blobs/${file.sha}`, token, fetchFn, 'application/vnd.github.raw+json');
  return res.arrayBuffer();
}
