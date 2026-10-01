// Share links: the program, robot settings, start position and approach sides packed into the link itself
// (#p=…, deflate-compressed, base64url). Nothing is uploaded; whoever opens the link gets a copy.

const PREFIX = 'p=';
const VERSION = 1;
export const LONG_LINK = 8000; // characters; longer links may get cut off by some apps

const toB64url = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};
const pipe = async (u8, stream) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());

// Block ids only matter inside one editor, so they are left out to keep links short.
export async function encodeShare({ program, cfg, start, approach }) {
  const json = JSON.stringify({ v: VERSION, program, cfg, start, approach }, (k, v) => k === 'id' ? undefined : v);
  return toB64url(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
}

export async function decodeShare(code) {
  let data;
  try { data = JSON.parse(new TextDecoder().decode(await pipe(fromB64url(code), new DecompressionStream('deflate-raw')))); }
  catch { throw new Error('This share link is damaged or incomplete. It may have been cut off when it was sent.'); }
  if (!data || data.v !== VERSION || !data.program || !Array.isArray(data.program.stacks)) throw new Error('This share link is from a different version of the simulator.');
  return data;
}

export async function shareUrl(pageUrl, payload) {
  const u = new URL(pageUrl); u.hash = PREFIX + await encodeShare(payload);
  return u.href;
}

// The share code in a location hash, or null.
export function codeFromHash(hash) {
  const h = String(hash || '').replace(/^#/, '');
  return h.startsWith(PREFIX) ? h.slice(PREFIX.length) : null;
}
