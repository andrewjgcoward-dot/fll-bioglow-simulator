import { createBundledDecoder } from './bundled-model-decoder.js';
import { PACK_LIMITS, validatePackManifest, validatePackGlb } from './model-pack.js';

// Version the manifest when placements change; version asset paths if model bytes change.
// Every published r3 asset has a compressed transport; asset.file is its decoded logical name.
// Keeping unchanged transport URLs lets old visits reuse their cached downloads.
export const BUNDLED_MANIFEST_URL = new URL('../assets/field-models/v1/manifest-r3.json', import.meta.url);
const failedURLs = new Set();

async function fetchBytes(url, limit, signal, onProgress, fetcher) {
  signal?.throwIfAborted();
  try {
    const response = await fetcher(url.href, { signal, cache: failedURLs.has(url.href) ? 'reload' : 'force-cache', mode: 'same-origin', redirect: 'error' });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.pathname.split('/').pop()}`);
    const declared = Number(response.headers.get('content-length'));
    if (declared > limit) throw new Error('A bundled model exceeds its loading limit.');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) throw new Error('A bundled model exceeds its loading limit.');
        chunks.push(value); onProgress?.(size);
      }
    } finally { await reader.cancel(); }
    signal?.throwIfAborted();
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    failedURLs.delete(url.href);
    return bytes;
  } catch (error) { if (error.name !== 'AbortError') failedURLs.add(url.href); throw error; }
}

export async function openBundledModels(signal, { manifestURL = BUNDLED_MANIFEST_URL, fetcher = fetch } = {}) {
  const url = new URL(manifestURL), directory = new URL('./', url);
  let manifest;
  const measure=(name,start,detail)=>performance.measure?.('bioglow.models.'+name,{start,end:performance.now(),detail});
  try {
    const bytes = await fetchBytes(url, PACK_LIMITS.manifest, signal, null, fetcher);
    manifest = JSON.parse(new TextDecoder().decode(bytes));
    validatePackManifest(manifest, new Set((manifest?.assets || []).map(a => a.file)));
    let total = 0;
    for (const asset of manifest.assets) {
      if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 28 || asset.bytes > PACK_LIMITS.entry || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid bundled model size or checksum.');
      if(asset.transport){const t=asset.transport;if(t.compression!=='gzip'||typeof t.file!=='string'||!/^compressed\/[A-Za-z0-9_-]+\.glb\.gz$/.test(t.file)||!Number.isSafeInteger(t.bytes)||t.bytes<28||t.bytes>PACK_LIMITS.entry||t.bytes>asset.bytes+1024||!/^[a-f0-9]{64}$/.test(t.sha256)||asset.bytes>Math.max(1024*1024,t.bytes*250))throw new Error('Invalid compressed model metadata.');}
      total += asset.bytes;
      const assetURL = new URL(asset.file, directory);
      if (assetURL.origin !== url.origin || !assetURL.pathname.startsWith(directory.pathname)) throw new Error('Invalid bundled model URL.');
    }
    if (total > PACK_LIMITS.total) throw new Error('The bundled models exceed the loading limit.');
  } catch (error) { if (error.name !== 'AbortError') failedURLs.add(url.href); throw error; }
  const decoder=createBundledDecoder(signal);
  return {
    manifest,
    dispose:()=>decoder.dispose(),
    async read(asset, onProgress) {
      const encoded=asset.transport||asset,assetURL=new URL(encoded.file,directory);
      try {
        const start=performance.now(),bytes=await fetchBytes(assetURL,encoded.bytes,signal,n=>onProgress?.(n/encoded.bytes*asset.bytes),fetcher);measure('fetch',start,{asset:asset.id,bytes:encoded.bytes});
        onProgress?.(asset.bytes,{phase:'prepare'});const prep=performance.now(),result=await decoder.decode(bytes,asset);signal?.throwIfAborted();measure('prepare',prep,{asset:asset.id,verifyMs:result.verifyMs,decompressMs:result.decompressMs,worker:typeof Worker==='function'});
        const validation=performance.now();validatePackGlb(result.bytes);measure('validate',validation,{asset:asset.id});
        return result.bytes;
      } catch (error) { if (error.name !== 'AbortError') failedURLs.add(assetURL.href); throw error; }
    }
  };
}
