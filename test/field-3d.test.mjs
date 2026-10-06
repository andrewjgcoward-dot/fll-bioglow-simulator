import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {zipSync,strToU8} from '../vendor/fflate/fflate.module.js';
import {inspectPackZip,readPackEntry} from '../src/model-pack.js';
import {Sim} from '../src/sim.js';
register('../test-support/field-three-loader.mjs',import.meta.url);
const {createField3D}=await import('../src/field-3d.js');
const renderer=await import('../test-support/field-renderer-stub.mjs');

class Element {
  constructor(){this.style={};this.dataset={};this.listeners=new Map();}
  addEventListener(name,listener){this.listeners.set(name,listener);}
  removeEventListener(name){this.listeners.delete(name);}
  setAttribute(){} append(){} replaceChildren(){}
  getRootNode(){return document;}
  getBoundingClientRect(){return {width:700,height:350};}
  getContext(){return {fillRect(){},beginPath(){},moveTo(){},arc(){},fill(){},lineTo(){},stroke(){}};}
}
function fixture(){
  const names=['M13-model','M13-dock','M14-model','M14-dock','M15-model','M15-dock'];
  const g={asset:{version:'2.0'},scene:0,scenes:[{nodes:names.map((_,i)=>i)}],nodes:names.map(name=>({name,mesh:0})),meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],buffers:[{byteLength:44}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:6}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[.01,.01,0]},{bufferView:1,componentType:5123,count:3,type:'SCALAR'}]};
  const raw=JSON.stringify(g),json=strToU8(raw+' '.repeat((4-raw.length%4)%4)),bytes=new Uint8Array(28+json.length+44),v=new DataView(bytes.buffer);
  v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,bytes.length,true);v.setUint32(12,json.length,true);v.setUint32(16,0x4e4f534a,true);bytes.set(json,20);v.setUint32(20+json.length,44,true);v.setUint32(24+json.length,0x004e4942,true);
  const start=28+json.length;[0,0,0,.01,0,0,0,.01,0].forEach((n,i)=>v.setFloat32(start+i*4,n,true));[0,1,2].forEach((n,i)=>v.setUint16(start+36+i*2,n,true));
  const manifest={schema:'bioglow-local-model-pack',version:1,units:'mm',assetUnits:'m',assets:[{id:'example',file:'models/example.glb'}],placements:names.map(id=>({id,asset:'example',nodes:[id],position:[1,2,7],yaw:0,dockModel:id.slice(0,3),dockYaw:12}))};
  return new Blob([zipSync({'manifest.json':strToU8(JSON.stringify(manifest)),'models/example.glb':bytes},{level:0})]);
}

test('loading while idle immediately applies swapped dock assignments to both models and docks',async()=>{
  const saved=new Map(),set=(name,value)=>{saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});};
  const documentStub=new Element();documentStub.hidden=false;documentStub.createElement=()=>new Element();documentStub.createElementNS=()=>new Element();
  const frames=new Map();let nextFrame=0;
  set('document',documentStub);set('devicePixelRatio',1);set('ResizeObserver',class{observe(){}disconnect(){}});set('IntersectionObserver',class{observe(){}disconnect(){}});
  set('requestAnimationFrame',fn=>{frames.set(++nextFrame,fn);return nextFrame;});set('cancelAnimationFrame',id=>frames.delete(id));set('performance',{now:()=>1000});
  const elements=new Map(),panel=new Element();panel.querySelector=s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s);};
  const sim=new Sim();
  // A saved non-default mapping, independent of the pack's default positions.
  sim.objects=sim.objects.filter(o=>!o.dock).concat([{dock:true,holds:'M15',x:1880,y:1030,r:-40},{dock:true,holds:'M14',x:998,y:627,r:0},{dock:true,holds:'M13',x:1282,y:91,r:0}]);
  let api;
  const pump=()=>{const current=[...frames.values()];frames.clear();for(const fn of current)fn(1000);};
  try {
    api=createField3D(panel,sim,{autoLoad:false});pump();assert.equal(sim.running,false);assert.equal(sim.matchOn,false);
    let done=false;const loading=api.loadPack(fixture()).finally(()=>{done=true;});
    for(let i=0;!done&&i<30;i++){await new Promise(resolve=>setImmediate(resolve));pump();}
    await loading;assert.equal(panel.dataset.packState,'loaded',elements.get('[data-pack-status]').textContent);
    // No call to api.update(), no simulation run, and no post-load animation frame.
    for(const dock of sim.objects.filter(o=>o.dock))for(const suffix of ['model','dock']){
      const group=renderer.renderedScene.getObjectByName(`${dock.holds}-${suffix}`);
      assert.deepEqual(group.position.toArray(),[dock.x,7,-dock.y]);assert.ok(Math.abs(group.rotation.y+(dock.r+12)*Math.PI/180)<1e-12);
    }
    api.destroy();api=null;
    const file=fixture(),entries=await inspectPackZip(file);
    const manifest=JSON.parse(new TextDecoder().decode(await readPackEntry(file,entries.get('manifest.json'))));
    const data=await readPackEntry(file,entries.get('models/example.glb'));
    let requests=0,reads=0,release;
    const source={manifest,read:async()=>{reads++;return data;}};
    const openBundledModels=async()=>{requests++;if(requests===1)await new Promise(resolve=>{release=resolve;});return source;};
    api=createField3D(panel,sim,{openBundledModels});
    assert.equal(requests,1);assert.equal(panel.dataset.packState,'loading');
    await api.loadBundled();assert.equal(requests,1,'duplicate load is ignored');
    sim.reset();api.update();assert.equal(requests,1,'reset does not restart a download');
    api.unload();assert.equal(panel.dataset.packState,'empty');
    let done2=false;const replacement=api.loadBundled().finally(()=>done2=true);
    for(let i=0;!done2&&i<30;i++){await new Promise(resolve=>setImmediate(resolve));pump();}
    await replacement;
    assert.equal(panel.dataset.modelSource,'bundled');assert.equal(panel.dataset.placementCount,'6');
    release();await new Promise(resolve=>setImmediate(resolve));pump();
    assert.equal(panel.dataset.packState,'loaded','cancelled request cannot overwrite replacement');
    assert.equal(reads,1,'cancelled request stops before downloading geometry');
    await api.loadBundled();sim.reset();api.update();assert.equal(requests,2,'loaded models survive reset without downloading');
    api.unload();
    api.destroy();api=null;
    api=createField3D(panel,sim,{openBundledModels:async()=>{throw new Error('offline');}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(panel.dataset.packState,'error');assert.equal(elements.get('[data-pack-retry]').hidden,false);
    assert.match(elements.get('[data-pack-status]').textContent,/offline/);

  } finally {
    api?.destroy();for(const [name,descriptor] of saved)descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name];
  }
});
