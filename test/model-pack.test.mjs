import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8, inflateSync } from '../vendor/fflate/fflate.module.js';
import { inspectPackZip, readPackEntry, validatePackManifest, validatePackGlb, PACK_LIMITS } from '../src/model-pack.js';
import { Sim } from '../src/sim.js';
import { robotScene, robotMeshData } from '../src/robot-3d.js';

const manifest=()=>({schema:'bioglow-local-model-pack',version:1,units:'mm',assetUnits:'m',assets:[{id:'demo',file:'models/demo.glb'}],placements:[{id:'demo',asset:'demo',position:[120,400,0],origin:[0,0,0],yaw:30}]});
function glb(change=()=>{}) {
  const data={asset:{version:'2.0'},buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'}],nodes:[],meshes:[]};change(data);
  const raw=JSON.stringify(data),json=strToU8(raw+' '.repeat((4-raw.length%4)%4)),binarySize=data.buffers[0].byteLength,bytes=new Uint8Array(28+json.length+binarySize),view=new DataView(bytes.buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.length,true);view.setUint32(12,json.length,true);view.setUint32(16,0x4e4f534a,true);bytes.set(json,20);view.setUint32(20+json.length,binarySize,true);view.setUint32(24+json.length,0x004e4942,true);return bytes;
}
const archive=(extra={})=>zipSync({'manifest.json':strToU8(JSON.stringify(manifest())),'models/demo.glb':glb(),...extra});
const inflate=(data,expected)=>inflateSync(data,{out:new Uint8Array(expected)});

test('one local ZIP supplies a versioned manifest and self-contained GLB with CRC validation',async()=>{
  const file=new Blob([archive()]),entries=await inspectPackZip(file);
  const data=await readPackEntry(file,entries.get('manifest.json'),{inflate});
  assert.equal(validatePackManifest(JSON.parse(new TextDecoder().decode(data)),entries).assets.length,1);
  assert.equal(validatePackGlb(await readPackEntry(file,entries.get('models/demo.glb'),{inflate})).asset.version,'2.0');
});
test('ZIP rejects traversal, duplicate names, encryption, truncated input and oversized declarations',async()=>{
  for(const key of ['../outside','/absolute','models\\outside','models/../outside'])await assert.rejects(inspectPackZip(new Blob([archive({[key]:strToU8('x')})])),/unsafe/);
  await assert.rejects(inspectPackZip(new Blob([archive({'MANIFEST.JSON':strToU8('{}')})])),/duplicate/);
  await assert.rejects(inspectPackZip(new Blob([new Uint8Array(50)])),/ZIP/);
  for(const [offset,value] of [[8,1],[24,PACK_LIMITS.entry+1]]){
    const bytes=archive(),v=new DataView(bytes.buffer);let at=0;for(;at<bytes.length-4;at++)if(v.getUint32(at,true)===0x02014b50)break;
    offset===8?v.setUint16(at+offset,value,true):v.setUint32(at+offset,value,true);
    await assert.rejects(inspectPackZip(new Blob([bytes])),offset===8?/unencrypted/:/loading size/);
  }
});
test('CRC mismatch, wrong local filename and cancelled loads fail cleanly',async()=>{
  const bytes=archive(),file=new Blob([bytes]),entries=await inspectPackZip(file),entry=entries.get('models/demo.glb');
  await assert.rejects(readPackEntry(file,{...entry,crc:0},{inflate}),/damaged/);
  await assert.rejects(readPackEntry(file,{...entry,name:'wrong.glb'},{inflate}),/range/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(inspectPackZip(file,controller.signal),{name:'AbortError'});
  await assert.rejects(readPackEntry(file,entry,{inflate,signal:controller.signal}),{name:'AbortError'});
});
test('manifest reports missing models and rejects unsupported versions, coordinates and dock rotations',()=>{
  const entries=new Map([['models/demo.glb',{}]]);
  for(const edit of [m=>m.version=2,m=>m.assets[0].file='missing.glb',m=>m.placements[0].position[0]=NaN,m=>m.placements[0].dockYaw=Infinity,m=>m.placements[0].nodes=['']]){
    const m=manifest();edit(m);assert.throws(()=>validatePackManifest(m,entries));
  }
});
test('GLBs cannot fetch external resources, request decoders, overrun buffers or form cyclic hierarchies',()=>{
  for(const edit of [g=>g.buffers[0].uri='https://example.invalid/model.bin',g=>g.images=[{uri:'x.png'}],g=>g.extensionsUsed=['EXT_meshopt_compression'],g=>g.accessors[0].count=1000,g=>g.nodes=[{children:[0]}],g=>g.nodes=[{children:[1,1]},{}],g=>{g.nodes=[{}];g.scenes=[{nodes:[0,0]}];},g=>g.nodes=[{translation:[0,'bad',0]}],g=>g.animations=[{}]])assert.throws(()=>validatePackGlb(glb(edit)));
  const invalid=glb();new DataView(invalid.buffer).setUint32(8,32,true);assert.throws(()=>validatePackGlb(invalid));
});
test('shared robot mesh preserves millimetre geometry and changes with live motors without baking the field pose',()=>{
  const sim=new Sim(),first=robotMeshData(robotScene(sim));
  assert.ok(first.polygons.length>100);assert.ok(first.segments.length>0);
  assert.ok(first.polygons.flatMap(p=>p.points.flat()).every(Number.isFinite));
  sim.pose={x:1200,y:700,h:90};assert.deepEqual(robotMeshData(robotScene(sim)),first);
  sim.arms.E=45;assert.notDeepEqual(robotMeshData(robotScene(sim)),first);
});

test('GLB preflight rejects primitive and scene-instance multiplication before loader allocation',()=>{
  const scene=(g,primitiveCount,nodeCount)=>{
    g.meshes=[{primitives:Array.from({length:primitiveCount},()=>({attributes:{POSITION:0}}))}];
    g.nodes=Array.from({length:nodeCount},()=>({mesh:0}));g.scenes=[{nodes:g.nodes.map((_,i)=>i)}];
  };
  assert.throws(()=>validatePackGlb(glb(g=>scene(g,10000,1))),/primitive loading limit/);
  assert.throws(()=>validatePackGlb(glb(g=>scene(g,500,4000))),/instance loading limit/);
  assert.throws(()=>validatePackGlb(glb(g=>{scene(g,300,1);g.scenes.push({nodes:[0]});})),/instance loading limit/);
  assert.throws(()=>validatePackGlb(glb(g=>{
    scene(g,1,500);g.buffers[0].byteLength=60036;
    g.bufferViews.push({buffer:0,byteOffset:36,byteLength:60000});g.accessors.push({bufferView:1,componentType:5123,count:30000,type:'SCALAR'});g.meshes[0].primitives[0].indices=1;
  })),/triangle instance loading limit/);
  assert.doesNotThrow(()=>validatePackGlb(glb(g=>scene(g,2,20))));
});

test('GLB preflight rejects undeclared instancing and nested extensions before loader allocation',()=>{
  const instancing=g=>{
    g.buffers[0].byteLength=126036;
    g.bufferViews.push({buffer:0,byteOffset:36,byteLength:6000},{buffer:0,byteOffset:6036,byteLength:120000});
    g.accessors.push({bufferView:1,componentType:5123,count:3000,type:'SCALAR'},{bufferView:2,componentType:5126,count:10000,type:'VEC3'});
    g.meshes=[{primitives:[{attributes:{POSITION:0},indices:1}]}];
    g.nodes=[{mesh:0,extensions:{EXT_mesh_gpu_instancing:{attributes:{TRANSLATION:2}}}}];g.scenes=[{nodes:[0]}];
    // Intentionally no extensionsUsed or extensionsRequired declarations.
  };
  const bytes=glb(instancing);assert.ok(bytes.length<128*1024,'bounded input; never instantiate its ten million triangles');
  assert.throws(()=>validatePackGlb(bytes),/extensions are not supported/);
  assert.doesNotThrow(()=>validatePackGlb(glb(g=>{instancing(g);delete g.nodes[0].extensions;})),'the core geometry fits the existing budgets without the hidden amplification');
  for(const edit of [g=>g.extensions={UNSUPPORTED:{}},g=>g.meshes=[{primitives:[{extensions:{UNSUPPORTED:{}}}]}],g=>g.materials=[{pbrMetallicRoughness:{extensions:{UNSUPPORTED:{}}}}],g=>g.bufferViews[0].extensions={UNSUPPORTED:{}},g=>g.extras={nested:[{extensions:{UNSUPPORTED:{}}}]}])assert.throws(()=>validatePackGlb(glb(edit)),/extensions are not supported/);
  assert.doesNotThrow(()=>validatePackGlb(glb(g=>{g.extensions={};g.extras={nested:[{extensions:{}}]};})));
});
