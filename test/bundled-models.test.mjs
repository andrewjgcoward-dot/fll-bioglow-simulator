import {readBundledFixture} from '../test-support/bundled-model-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openBundledModels, BUNDLED_MANIFEST_URL } from '../src/bundled-models.js';
import { validatePackManifest, validatePackGlb } from '../src/model-pack.js';
import { register } from 'node:module';
register('../test-support/field-three-loader.mjs',import.meta.url);
const { GLTFLoader } = await import('../vendor/three/examples/jsm/loaders/GLTFLoader.js');
import { Box3 } from '../vendor/three/build/three.module.js';
const bytes = await readBundledFixture('M08');
const asset = { id:'M08',file:'models/M08.glb',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex') };
const manifest = {schema:'bioglow-local-model-pack',version:1,units:'mm',assetUnits:'m',assets:[asset],placements:[{id:'snail',asset:'M08',position:[10,20,0],yaw:0}]};
const base='https://example.test/fll-bioglow-simulator/assets/field-models/v1/manifest.json';

test('bundled model requests preserve the Pages subpath, cache assets, and report progress',async()=>{
 const calls=[],progress=[];
 const source=await openBundledModels(undefined,{manifestURL:base,fetcher:async(url,options)=>{calls.push({url,options});return new Response(url.endsWith('.json')?JSON.stringify(manifest):bytes);}});
 assert.equal((await source.read(asset,n=>progress.push(n))).length,bytes.length);
 assert.equal(calls[1].url,base.replace('manifest.json',asset.file));
 assert.ok(calls.every(c=>c.options.cache==='force-cache'&&c.options.mode==='same-origin'&&c.options.redirect==='error'));
 assert.equal(progress.at(-1),bytes.length);
 assert.ok(BUNDLED_MANIFEST_URL.pathname.endsWith('/assets/field-models/v1/manifest-r4.json'));
});

test('failed model retries reload only the failed URL and reject corrupt bytes',async()=>{
 let corrupt=true;const calls=[];
 const source=await openBundledModels(undefined,{manifestURL:base,fetcher:async(url,options)=>{calls.push({url,options});return new Response(url.endsWith('.json')?JSON.stringify(manifest):corrupt?new Uint8Array(bytes.length):bytes);}});
 await assert.rejects(source.read(asset),/checksum/);corrupt=false;
 await source.read(asset);
 assert.equal(calls.at(-1).options.cache,'reload');
 await source.read(asset);assert.equal(calls.at(-1).options.cache,'force-cache');
});

test('bundled loader handles HTTP failures, cancellation and bounded responses',async()=>{
 await assert.rejects(openBundledModels(undefined,{manifestURL:base,fetcher:async()=>new Response('',{status:404})}),/HTTP 404/);
 const controller=new AbortController();controller.abort();let fetched=false;
 await assert.rejects(openBundledModels(controller.signal,{manifestURL:base,fetcher:async()=>{fetched=true;}}),{name:'AbortError'});assert.equal(fetched,false);
 await assert.rejects(openBundledModels(undefined,{manifestURL:base,fetcher:async()=>new Response(' '.repeat(128*1024+1))}),/loading limit/);
 for(const file of ['../M08.glb','https://evil.test/M08.glb','/models/M08.glb']){
  await assert.rejects(openBundledModels(undefined,{manifestURL:base,fetcher:async()=>new Response(JSON.stringify({...manifest,assets:[{...asset,file}]}))}),/Missing model file/);
 }
});

test('all 13 published transports decode to original GLB checksums and all 26 placements select real geometry',async()=>{
 const root=new URL('./',BUNDLED_MANIFEST_URL);
 const pack=JSON.parse(await readFile(BUNDLED_MANIFEST_URL,'utf8'));
 validatePackManifest(pack,new Set(pack.assets.map(a=>a.file)));
 assert.equal(pack.assets.length,13);assert.equal(pack.placements.length,26);
 const loader=new GLTFLoader();let placed=0,triangles=0,meshes=0;
 for(const a of pack.assets){
  const data=await readBundledFixture(a);
  assert.equal(data.length,a.bytes);assert.equal(createHash('sha256').update(data).digest('hex'),a.sha256);validatePackGlb(data);
  const gltf=await loader.parseAsync(data.buffer,'');gltf.scene.updateMatrixWorld(true);
  for(const p of pack.placements.filter(p=>p.asset===a.id)){
   for(const name of p.nodes){const node=gltf.scene.getObjectByName(name);assert.ok(node,name);const box=new Box3().setFromObject(node);assert.equal(box.isEmpty(),false,name);assert.ok([...box.min,...box.max].every(Number.isFinite));node.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}});}
   placed++;
  }
 }
 assert.equal(placed,26);assert.ok(meshes<=500);assert.ok(triangles<=4500000);
});
