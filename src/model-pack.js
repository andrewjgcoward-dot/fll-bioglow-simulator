// Local File/Blob only. No upload, persistence, or URL fetching is performed here.
export const PACK_LIMITS = Object.freeze({ file: 256 * 1024 * 1024, entry: 96 * 1024 * 1024, total: 420 * 1024 * 1024, entries: 96, manifest: 128 * 1024 });
const checkAbort = signal => { if (signal?.aborted) throw new DOMException('Loading cancelled.', 'AbortError'); };
const safeName = name => name.length > 0 && name.length <= 150 && /^[A-Za-z0-9_.\/-]+$/.test(name) && !name.startsWith('/') && !name.split('/').some(p => !p || p === '.' || p === '..');
const fail = message => { throw new Error(message); };
async function bytes(file, start, end, signal) { checkAbort(signal); const out = new Uint8Array(await file.slice(start, end).arrayBuffer()); checkAbort(signal); return out; }

export async function inspectPackZip(file, signal) {
  if (!file || file.size < 22 || file.size > PACK_LIMITS.file) fail('Choose a model-pack ZIP smaller than 256 MB.');
  const tail = await bytes(file, Math.max(0, file.size - 65557), file.size, signal), view = new DataView(tail.buffer);
  let end = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === tail.length) { end = i; break; }
  if (end < 0) fail('This file is not a supported ZIP archive.');
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), offset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true) || count > PACK_LIMITS.entries || count === 65535) fail('Split, ZIP64, or unusually large archives are not supported.');
  if (offset + directorySize > file.size - 22 || directorySize > 128 * 1024) fail('The ZIP directory is invalid.');
  const data = await bytes(file, offset, offset + directorySize, signal), dv = new DataView(data.buffer), entries = new Map(), names = new Set();
  let cursor = 0, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > data.length || dv.getUint32(cursor, true) !== 0x02014b50) fail('The ZIP directory is damaged.');
    const flags = dv.getUint16(cursor + 8, true), method = dv.getUint16(cursor + 10, true), crc = dv.getUint32(cursor + 16, true);
    const compressed = dv.getUint32(cursor + 20, true), size = dv.getUint32(cursor + 24, true), n = dv.getUint16(cursor + 28, true), extra = dv.getUint16(cursor + 30, true), comment = dv.getUint16(cursor + 32, true), local = dv.getUint32(cursor + 42, true);
    if (cursor + 46 + n + extra + comment > data.length) fail('The ZIP directory is incomplete.');
    const name = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(cursor + 46, cursor + 46 + n));
    if (!safeName(name) || names.has(name.toLowerCase())) fail('The ZIP contains an unsafe or duplicate filename.');
    if ((flags & 1) || ![0, 8].includes(method)) fail('Use an unencrypted ZIP with standard compression.');
    if (size > PACK_LIMITS.entry || compressed > PACK_LIMITS.entry || (size && !compressed) || size > Math.max(1024 * 1024, compressed * 250)) fail('A model in this pack exceeds the safe loading size.');
    total += size; if (total > PACK_LIMITS.total || local + 30 + compressed > offset) fail('The model pack exceeds the loading limit or has invalid file ranges.');
    entries.set(name, { name, flags, method, crc, compressed, size, local, directoryOffset: offset }); names.add(name.toLowerCase());
    cursor += 46 + n + extra + comment;
  }
  if (cursor !== data.length || !entries.has('manifest.json')) fail('Choose a BIOGLOW model pack containing manifest.json.');
  if (entries.get('manifest.json').size > PACK_LIMITS.manifest) fail('The pack manifest is too large.');
  return entries;
}

const CRC_TABLE = Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n>>>1^(n&1?0xedb88320:0);return n>>>0;});
export function crc32(data) {
  let crc = -1;
  for (const b of data) crc = crc >>> 8 ^ CRC_TABLE[(crc ^ b) & 255];
  return (crc ^ -1) >>> 0;
}

async function inflateWorker(data, expected, signal) {
  checkAbort(signal);
  const worker = new Worker(new URL('./model-pack-worker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const finish = (err, value) => { clearTimeout(timeout); signal?.removeEventListener('abort', abort); worker.terminate(); err ? reject(err) : resolve(value); };
    const abort = () => finish(new DOMException('Loading cancelled.', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('This model took too long to decompress. Try a smaller pack.')), 20000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = e => e.data.error ? finish(new Error(e.data.error)) : finish(null, new Uint8Array(e.data.buffer));
    worker.onerror = () => finish(new Error('The browser could not decompress this model.'));
    worker.postMessage({ buffer: data.buffer, expected }, [data.buffer]);
  });
}

export async function readPackEntry(file, entry, { signal, inflate = inflateWorker } = {}) {
  const header = await bytes(file, entry.local, entry.local + 30, signal), dv = new DataView(header.buffer);
  if (header.length !== 30 || dv.getUint32(0, true) !== 0x04034b50 || dv.getUint16(8, true) !== entry.method || dv.getUint16(6, true) !== entry.flags) fail('The ZIP file header is invalid.');
  const nameLength = dv.getUint16(26, true), start = entry.local + 30 + nameLength + dv.getUint16(28, true);
  const localName = new TextDecoder().decode(await bytes(file, entry.local + 30, entry.local + 30 + nameLength, signal));
  if (localName !== entry.name || start + entry.compressed > entry.directoryOffset) fail('The ZIP file range is invalid.');
  const compressed = await bytes(file, start, start + entry.compressed, signal);
  const result = entry.method === 0 ? compressed : await inflate(compressed, entry.size, signal);
  checkAbort(signal);
  if (result.length !== entry.size || crc32(result) !== entry.crc) fail(`The file ${entry.name} is damaged. Download the pack again.`);
  return result;
}

export function validatePackManifest(manifest, entries) {
  if (manifest?.schema !== 'bioglow-local-model-pack' || manifest.version !== 1 || manifest.units !== 'mm' || manifest.assetUnits !== 'm') fail('This model pack version is not supported. Use BIOGLOW pack version 1.');
  if (!Array.isArray(manifest.assets) || !manifest.assets.length || manifest.assets.length > 40 || !Array.isArray(manifest.placements) || !manifest.placements.length || manifest.placements.length > 64) fail('The pack needs a valid asset and placement list.');
  const ids = new Set(), placementIds = new Set(), vector = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 10000);
  for (const asset of manifest.assets) {
    if (typeof asset.id !== 'string' || !/^[A-Za-z0-9_-]{1,50}$/.test(asset.id) || ids.has(asset.id)) fail('The pack contains invalid or duplicate model IDs.');
    if (typeof asset.file !== 'string' || !safeName(asset.file) || !asset.file.endsWith('.glb') || !entries.has(asset.file)) fail(`Missing model file: ${String(asset.file).slice(0,150)}`);
    ids.add(asset.id);
  }
  for (const p of manifest.placements) {
    if (typeof p.id !== 'string' || p.id.length > 70 || placementIds.has(p.id) || !ids.has(p.asset) || !vector(p.origin || [0,0,0]) || !vector(p.position) || !Number.isFinite(p.yaw) || Math.abs(p.yaw) > 360) fail('A model placement is invalid.');
    if (p.nodes !== undefined && (!Array.isArray(p.nodes) || !p.nodes.length || p.nodes.length > 128 || p.nodes.some(n => typeof n !== 'string' || !n.length || n.length > 180))) fail('A model node selection is invalid.');
    if (p.dockModel !== undefined && !['M13','M14','M15'].includes(p.dockModel) || p.dockYaw !== undefined && (!Number.isFinite(p.dockYaw) || Math.abs(p.dockYaw)>360)) fail('A dock placement is invalid.');
    placementIds.add(p.id);
  }
  return manifest;
}

// glTF buffers use metres; the viewer applies one uniform 1000× unit conversion.
// Never allow a selected pack to cause external network requests through glTF URIs.
export function validatePackGlb(data) {
  if (data.length < 28) fail('A model file is incomplete.');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (dv.getUint32(0,true) !== 0x46546c67 || dv.getUint32(4,true) !== 2 || dv.getUint32(8,true) !== data.length || dv.getUint32(16,true) !== 0x4e4f534a) fail('The pack contains an invalid GLB model.');
  const length = dv.getUint32(12,true);
  if (length > 8 * 1024 * 1024 || 20 + length > data.length) fail('A GLB model has invalid metadata.');
  const json = JSON.parse(new TextDecoder().decode(data.subarray(20,20+length)));
  // Some loader plugins act on nested extensions even when the file omits
  // extensionsUsed/Required. Inspect the whole JSON before any loader allocation.
  // Use an explicit stack so deeply nested metadata cannot exhaust the call stack.
  const pending=[json];
  while(pending.length){
    const current=pending.pop();
    if(!current||typeof current!=='object')continue;
    for(const [key,value] of Object.entries(current)){
      if(key==='extensions'&&(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length))fail('GLB extensions are not supported. Use a core glTF model without extensions.');
      if(value&&typeof value==='object')pending.push(value);
    }
  }
  if (json.asset?.version !== '2.0' || (json.buffers || []).length !== 1 || json.buffers.some(b=>b.uri) || (json.images || []).length || (json.extensionsRequired || []).length || (json.extensionsUsed || []).length) fail('Models must be self-contained GLBs without external files, textures or decoder extensions.');
  if (json.buffers[0].byteLength > PACK_LIMITS.entry || (json.nodes || []).length > 4000 || (json.meshes || []).length > 3000) fail('This GLB model is too complex for the viewer.');
  const bin=20+length, bufferSize=json.buffers[0].byteLength;
  if (length%4 || bin+8>data.length || dv.getUint32(bin+4,true)!==0x004e4942 || bin+8+dv.getUint32(bin,true)!==data.length || !Number.isInteger(bufferSize) || bufferSize<0 || bufferSize>dv.getUint32(bin,true)) fail('A GLB binary buffer is invalid.');
  const views=json.bufferViews||[], accessors=json.accessors||[], integer=n=>Number.isInteger(n)&&n>=0;
  for (const v of views) if (v.buffer!==0 || !integer(v.byteOffset||0) || !integer(v.byteLength) || (v.byteOffset||0)+v.byteLength>bufferSize || v.byteStride!==undefined&&(!integer(v.byteStride)||v.byteStride<4||v.byteStride>252||v.byteStride%4)) fail('A GLB buffer range is invalid.');
  let allocated=0;
  for (const a of accessors) {
    const size=({5120:1,5121:1,5122:2,5123:2,5125:4,5126:4})[a.componentType],components=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16})[a.type],v=views[a.bufferView];
    if (!integer(a.count) || a.count>4500000 || !size || !components || !v || a.sparse || !integer(a.byteOffset||0)) fail('A GLB geometry buffer is invalid.');
    const stride=v.byteStride||size*components, end=(a.byteOffset||0)+(a.count?stride*(a.count-1)+size*components:0);
    if (stride<size*components || end>v.byteLength || (allocated+=a.count*size*components)>128*1024*1024) fail('A GLB geometry buffer exceeds its range or loading limit.');
  }
  // Reject cycles and shared child nodes before the glTF loader traverses them.
  const nodes=json.nodes||[],parents=new Set(), visiting=new Set(),visited=new Set();
  const visit=(i,depth=0)=>{
    if (!integer(i)||!nodes[i]||visiting.has(i)||depth>100) fail('The GLB model hierarchy is invalid.');
    if(visited.has(i))return; visiting.add(i);
    for(const child of nodes[i].children||[]){if(parents.has(child))fail('The GLB model has duplicate child nodes.');parents.add(child);visit(child,depth+1);}
    visiting.delete(i);visited.add(i);
  };
  for(let i=0;i<nodes.length;i++)visit(i);
  if((json.animations||[]).length || (json.skins||[]).length) fail('Use static mission models without skins or animations.');
  const scenes=json.scenes||[];
  if(scenes.length>40)fail('The GLB model has too many scenes.');
  for(const scene of scenes){const roots=scene.nodes||[];if(roots.length>nodes.length||new Set(roots).size!==roots.length||roots.some(i=>!integer(i)||!nodes[i]||parents.has(i)))fail('The GLB scene root list is invalid.');}
  for(const node of nodes)for(const [key,count] of [['matrix',16],['translation',3],['rotation',4],['scale',3]])if(node[key]!==undefined&&(!Array.isArray(node[key])||node[key].length!==count||node[key].some(v=>!Number.isFinite(v))))fail('A GLB model transform is invalid.');
  // GLTFLoader creates one THREE.Mesh per primitive for each referenced node.
  // Count actual scene instances before parsing, including every scene it loads.
  let definitions=0;
  const meshCosts=(json.meshes||[]).map(mesh=>{
    if(!Array.isArray(mesh.primitives)||!mesh.primitives.length||(definitions+=mesh.primitives.length)>500)fail('The GLB model exceeds the mesh primitive loading limit.');
    let triangles=0;
    for(const p of mesh.primitives){
      const position=accessors[p.attributes?.POSITION],index=p.indices===undefined?null:accessors[p.indices];
      if(!position||position.type!=='VEC3'||position.componentType!==5126||p.mode!==undefined&&p.mode!==4||(p.targets||[]).length)fail('Use static triangle meshes with float positions.');
      if(p.indices!==undefined&&(!index||index.type!=='SCALAR'||![5121,5123,5125].includes(index.componentType)))fail('The GLB triangle indices are invalid.');
      const count=(index||position).count;if(count%3)fail('The GLB triangle count is invalid.');triangles+=count/3;
    }
    return {meshes:mesh.primitives.length,triangles};
  });
  for(const node of nodes)if(node.mesh!==undefined&&(!integer(node.mesh)||!meshCosts[node.mesh]))fail('A GLB node references an invalid mesh.');
  let instantiatedMeshes=0,instantiatedTriangles=0,instantiatedNodes=0;
  const countInstance=i=>{
    if(++instantiatedNodes>8000)fail('The GLB model exceeds the scene instance loading limit.');
    const node=nodes[i],cost=meshCosts[node.mesh];
    if(cost){instantiatedMeshes+=cost.meshes;instantiatedTriangles+=cost.triangles;}
    if(instantiatedMeshes>500||instantiatedTriangles>4500000)fail('The GLB scene exceeds the mesh or triangle instance loading limit.');
    for(const child of node.children||[])countInstance(child);
  };
  for(const scene of scenes)for(const root of scene.nodes||[])countInstance(root);
  return json;
}
