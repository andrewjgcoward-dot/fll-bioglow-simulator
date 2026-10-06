import {readBundledFixture} from '../test-support/bundled-model-fixtures.mjs';
import {zipSync,inflateSync} from '../vendor/fflate/fflate.module.js';
import {inspectPackZip,readPackEntry,validatePackManifest,validatePackGlb} from '../src/model-pack.js';
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {gzipSync} from 'node:zlib';
import {decodeBundledAsset} from '../src/bundled-model-codec.js';import {openBundledModels,BUNDLED_MANIFEST_URL} from '../src/bundled-models.js';import {createBundledDecoder} from '../src/bundled-model-decoder.js';
const root=new URL('./',BUNDLED_MANIFEST_URL),pack=JSON.parse(await readFile(BUNDLED_MANIFEST_URL,'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');

test('compressed-only models preserve geometry hashes and alignment keeps assets unchanged',async()=>{
 const previous=JSON.parse(await readFile(new URL('manifest-r3.json',root),'utf8'));assert.deepEqual(pack.assets,previous.assets);
 for(const a of pack.assets){const compressed=new Uint8Array(await readFile(new URL(a.transport.file,root))),original=await readBundledFixture(a),result=await decodeBundledAsset(compressed,a);assert.deepEqual(result.bytes,original,a.id);assert.equal(sha(result.bytes),a.sha256);}
 assert.ok(pack.assets.find(a=>a.id==='M07').transport.bytes<11*1024*1024);
});

test('gzip preparation rejects corrupt checksum, CRC, forged expansion size and truncated content',async()=>{
 const a=pack.assets.find(a=>a.id==='M08'),data=new Uint8Array(await readFile(new URL(a.transport.file,root)));
 const bad=data.slice();bad[20]^=1;await assert.rejects(decodeBundledAsset(bad,a),/checksum/);
 const crc=data.slice();crc[crc.length-8]^=1;const changed={...a,transport:{...a.transport,sha256:sha(crc)}};await assert.rejects(decodeBundledAsset(crc,changed));
 await assert.rejects(decodeBundledAsset(data,{...a,bytes:a.bytes-4}),/header or size/);
 await assert.rejects(decodeBundledAsset(data.subarray(0,data.length-4),a),/incomplete/);
 const saved=globalThis.DecompressionStream;try{globalThis.DecompressionStream=undefined;assert.equal(sha((await decodeBundledAsset(data,a)).bytes),a.sha256);await assert.rejects(decodeBundledAsset(crc,changed),/damaged/);}finally{globalThis.DecompressionStream=saved;}
});

test('transport paths and compressed sizes are bounded; decoded GLB extensions remain rejected',async()=>{
 const a=pack.assets.find(a=>a.id==='M08'),badPaths=['../M08.glb.gz','https://evil.test/x.glb.gz','compressed/%2e%2e.glb.gz','compressed//M08.glb.gz'];
 for(const transport of [...badPaths.map(file=>({...a.transport,file})),{...a.transport,bytes:96*1024*1024},{...a.transport,compression:'br'},{...a.transport,sha256:'bad'}]){const p={...pack,assets:[{...a,transport}],placements:pack.placements.filter(p=>p.asset===a.id)};await assert.rejects(openBundledModels(undefined,{fetcher:async()=>new Response(JSON.stringify(p))}),/compressed model metadata/);}
 const raw=Buffer.from(await readBundledFixture(a)),oldLength=raw.readUInt32LE(12),j=JSON.parse(raw.subarray(20,20+oldLength));j.extensions={UNTRUSTED:{}};let json=Buffer.from(JSON.stringify(j));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const header=Buffer.from(raw.subarray(0,20)),bad=Buffer.concat([header,json,raw.subarray(20+oldLength)]);bad.writeUInt32LE(bad.length,8);bad.writeUInt32LE(json.length,12);const encoded=gzipSync(bad,{mtime:0}),asset={...a,bytes:bad.length,sha256:sha(bad),transport:{...a.transport,bytes:encoded.length,sha256:sha(encoded)}};
 const source=await openBundledModels(undefined,{fetcher:async url=>new Response(url.endsWith('.json')?JSON.stringify({...pack,assets:[asset],placements:pack.placements.filter(p=>p.asset===a.id)}):encoded)});try{await assert.rejects(source.read(asset),/extension/i);}finally{source.dispose();}
});

test('aborting active background preparation rejects it and terminates its worker',async()=>{
 const previous=globalThis.Worker;let terminated=0;
 globalThis.Worker=class{postMessage(){}terminate(){terminated++}};
 const controller=new AbortController(),decoder=createBundledDecoder(controller.signal);
 try{const p=decoder.decode(new Uint8Array(32),{id:'test'});controller.abort();await assert.rejects(p,{name:'AbortError'});assert.equal(terminated,1);decoder.dispose();assert.equal(terminated,1);}finally{globalThis.Worker=previous;}
});

test('compressed transport URLs preserve the GitHub Pages repository subpath',async()=>{
 const a=pack.assets.find(a=>a.id==='M08'),manifest={...pack,assets:[a],placements:pack.placements.filter(p=>p.asset===a.id)},requests=[];
 const source=await openBundledModels(undefined,{manifestURL:'https://example.test/fll-bioglow-simulator/assets/field-models/v1/manifest-r3.json',fetcher:async(url,options)=>{requests.push({url,options});return new Response(url.endsWith('.json')?JSON.stringify(manifest):await readFile(new URL(a.transport.file,root)));}});
 try{assert.equal(sha(await source.read(a)),a.sha256);assert.equal(requests[1].url,'https://example.test/fll-bioglow-simulator/assets/field-models/v1/'+a.transport.file);assert.equal(requests[1].options.mode,'same-origin');assert.equal(requests[1].options.redirect,'error');}finally{source.dispose();}
});

test('the active pack loads all 13 models using only published compressed files',async()=>{
 const requested=[];
 const source=await openBundledModels(undefined,{fetcher:async url=>{requested.push(url);return new Response(await readFile(new URL(url)));}});
 try{for(const asset of source.manifest.assets){assert.ok(asset.transport);assert.equal(sha(await source.read(asset)),asset.sha256);}}
 finally{source.dispose();}
 assert.equal(requested.length,14);
 assert.ok(requested.slice(1).every(url=>url.endsWith('.glb.gz')));
});

test('a recovered original model remains compatible with optional local ZIP import',async()=>{
 const sourceAsset=pack.assets.find(a=>a.id==='M08'),asset={...sourceAsset};delete asset.transport;
 const raw=await readBundledFixture(sourceAsset),manifest={...pack,assets:[asset],placements:pack.placements.filter(p=>p.asset===asset.id)};
 const file=new Blob([zipSync({'manifest.json':new TextEncoder().encode(JSON.stringify(manifest)),[asset.file]:raw})]);
 const entries=await inspectPackZip(file),inflate=(data,expected)=>inflateSync(data,{out:new Uint8Array(expected)});
 const imported=validatePackManifest(JSON.parse(new TextDecoder().decode(await readPackEntry(file,entries.get('manifest.json'),{inflate}))),entries);
 const decoded=await readPackEntry(file,entries.get(imported.assets[0].file),{inflate});
 assert.equal(sha(decoded),asset.sha256);assert.equal(validatePackGlb(decoded).asset.version,'2.0');
});
