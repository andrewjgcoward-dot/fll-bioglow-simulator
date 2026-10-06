import {readBundledFixture} from '../test-support/bundled-model-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {register} from 'node:module';
import {BUNDLED_MANIFEST_URL} from '../src/bundled-models.js';
import {Sim} from '../src/sim.js';
register('../test-support/field-three-loader.mjs',import.meta.url);
const {createField3D}=await import('../src/field-3d.js');
const renderer=await import('../test-support/field-renderer-stub.mjs');
const {Vector3}=renderer;

class Element {
 constructor(){this.style={};this.dataset={};}
 addEventListener(){} removeEventListener(){} setAttribute(){} append(){} replaceChildren(){}
 getRootNode(){return document;}
 getBoundingClientRect(){return {width:700,height:350};}
 getContext(){return {fillRect(){},beginPath(){},moveTo(){},arc(){},fill(){},lineTo(){},stroke(){}};}
}
test('M03 rotates about its registered source anchor, with red pivots toward home and flag toward left edge',async()=>{
 const manifest=JSON.parse(await readFile(BUNDLED_MANIFEST_URL,'utf8'));
 const previous=JSON.parse(await readFile(new URL('manifest.json',BUNDLED_MANIFEST_URL),'utf8'));
 const p=manifest.placements.find(p=>p.id==='M03-mission');
 assert.equal(p.yaw,180);assert.deepEqual(p.origin,[92.0001,16.5568,49.96565]);assert.deepEqual(p.position,[80,658,0]);
 const restored=structuredClone(manifest);for(const asset of restored.assets)delete asset.transport;restored.placements.find(p=>p.id==='M03-mission').yaw=0;
 assert.deepEqual(restored,previous,'only M03 yaw changes; sources, bytes, dimensions and all other placements stay identical');
 const data=await readBundledFixture('M03');
 const source={manifest:{...manifest,assets:manifest.assets.filter(a=>a.id==='M03'),placements:[p]},read:async()=>data};
 const saved=new Map(),frames=new Map();let next=0,api;
 const set=(name,value)=>{saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});};
 set('document',{hidden:false,createElement:()=>new Element(),createElementNS:()=>new Element(),addEventListener(){},removeEventListener(){}});set('window',{devicePixelRatio:1});set('devicePixelRatio',1);
 set('ResizeObserver',class{observe(){}disconnect(){}});set('IntersectionObserver',class{observe(){}disconnect(){}});
 set('requestAnimationFrame',fn=>{frames.set(++next,fn);return next;});set('cancelAnimationFrame',id=>frames.delete(id));
 const elements=new Map(),panel=new Element();panel.querySelector=s=>{if(!elements.has(s))elements.set(s,new Element());return elements.get(s);};
 const pump=()=>{const current=[...frames.values()];frames.clear();for(const fn of current)fn(performance.now()+100);};
 try {
  api=createField3D(panel,new Sim(),{autoLoad:false,openBundledModels:async()=>source});
  let done=false;const loading=api.loadBundled().finally(()=>{done=true;});
  for(let i=0;!done&&i<80;i++){await new Promise(r=>setImmediate(r));pump();}await loading;pump();
  assert.equal(panel.dataset.packState,'loaded');
  const placed=renderer.renderedScene.getObjectByName('M03-mission'),content=placed.children[0];renderer.renderedScene.updateMatrixWorld(true);
  const near=(v,expected)=>v.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<.001,`${n} != ${expected[i]}`));
  near(content.localToWorld(new Vector3(...p.origin.map(v=>v/1000))).toArray(),[80,0,-658]);
  // Landmarks from Komurobo/LDraw registration: red pivot z=60 LDU;
  // flag hinge [350.0008,-51.392,-160] LDU. Converted GLB axes are x,-y,-z.
  const red=content.localToWorld(new Vector3(.148,.044,.024));
  near(red.toArray(),[24.0001,27.4432,-632.03435]);assert.ok(-red.z<658,'red pivots face the home end');
  const flag=content.localToWorld(new Vector3(.14000032,.0205568,.064));
  near(flag.toArray(),[31.99978,4,-672.03435]);assert.ok(flag.x<80,'flag sits toward the left field edge');
 }finally{api?.destroy();for(const [name,d] of saved)d?Object.defineProperty(globalThis,name,d):delete globalThis[name];}
});
