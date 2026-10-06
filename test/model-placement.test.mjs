import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {modelPlacementTransform} from '../src/model-placement.js';
import {validatePackManifest} from '../src/model-pack.js';
import {BUNDLED_MANIFEST_URL} from '../src/bundled-models.js';
import {Sim} from '../src/sim.js';
const manifest=JSON.parse(await readFile(BUNDLED_MANIFEST_URL,'utf8'));
const placements=new Map(manifest.placements.map(p=>[p.id,p]));
const world=(p,point)=>{
 const t=p.yaw*Math.PI/180,c=Math.cos(t),s=Math.sin(t),x=point[0]-p.origin[0],z=point[2]-p.origin[2];
 return [p.position[0]+c*x-s*z,p.position[1]-s*x-c*z,p.position[2]+point[1]-p.origin[1]];
};
const near=(a,b)=>a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<.001,`${a} != ${b}`));

test('all six dock assignments keep source receiver and insert axle landmarks mated without changing collision docks',()=>{
 const sim=new Sim(),before=structuredClone(sim.objects.filter(o=>o.dock));
 const assignments=[['M13','M14','M15'],['M13','M15','M14'],['M14','M13','M15'],['M14','M15','M13'],['M15','M13','M14'],['M15','M14','M13']];
 for(const ids of assignments){
  sim.docks=Object.fromEntries(['mine','city','farm'].map((key,i)=>[key,ids[i]]));sim.reset();
  for(const [asset,mission] of [['M11','M13'],['M12','M14'],['M13','M15']]){
   const dock=placements.get(asset+'-dock'),module=placements.get(asset+'-mission');
   const dt={...dock,...modelPlacementTransform(dock,sim.objects,manifest.dockSites)},mt={...module,...modelPlacementTransform(module,sim.objects,manifest.dockSites)};
   // Source dock receiver axles x=132, z=4/100; insert axles x=28,
   // z=(module center +/-48). Heights are compared separately: mounting plane is y=0.
   for(const sign of [-1,1])near(world(dt,[132,0,52+sign*48]),world(mt,[28,0,module.origin[2]-sign*48]));
   assert.equal(dt.yaw,manifest.dockSites[Object.keys(sim.docks).find(k=>sim.docks[k]===mission)].yaw);
  }
  assert.deepEqual(sim.objects.filter(o=>o.dock).map(({holds,...d})=>d),before.map(({holds,...d})=>d));
 }
});

test('legacy packs use simulation docks and an undocked placement retains its source transform',()=>{
 const p={position:[10,20,3],yaw:15,dockModel:'M13',dockYaw:180};
 assert.deepEqual(modelPlacementTransform(p,[{dock:true,holds:'M13',key:'mine',x:12,y:34,r:-40}]),{position:[12,34,3],yaw:140});
 assert.deepEqual(modelPlacementTransform(p,[],manifest.dockSites),{position:p.position,yaw:15});
});

test('shared M06 attachment retains every source offset and the elevated mycelium height',()=>{
 const nest=placements.get('M06-nest'),mycelium=placements.get('M06-mycelium');
 for(const k of ['origin','position','yaw'])assert.deepEqual(mycelium[k],nest[k]);
 for(const point of [[0,44.5414,0],[25,60,-20],[-40,75,90]])near(world(nest,point),world(mycelium,point));
 assert.ok(world(mycelium,[0,44.5414,0])[2]>44,'mycelium is not independently grounded');
});

test('leaf handles seat in three distinct nest slots at a common height',()=>{
 const leaves=['a','b','c'].map(n=>placements.get('M04-leaf-'+n));
 assert.deepEqual(leaves.map(p=>p.yaw),[90,135,180]);
 assert.ok(leaves.every(p=>Math.abs(world(p,p.origin)[2]-20)<.001));
 for(let i=0;i<leaves.length;i++)for(let j=i+1;j<leaves.length;j++)assert.ok(Math.hypot(...leaves[i].position.slice(0,2).map((v,k)=>v-leaves[j].position[k]))>20);
});

test('render dock calibration rejects malformed, unbounded and unexpected sites',()=>{
 const entries=new Map(manifest.assets.map(a=>[a.file,{}]));
 assert.doesNotThrow(()=>validatePackManifest(manifest,entries));
 for(const sites of [null,[],{mine:{position:[0,0],yaw:0}},{mine:{position:[0,NaN,0],yaw:0}},{mine:{position:[10001,0,0],yaw:0}},{mine:{position:[0,0,0],yaw:Infinity}},{mine:{position:[0,0,0],yaw:361}},{unknown:{position:[0,0,0],yaw:0}}])assert.throws(()=>validatePackManifest({...manifest,dockSites:sites},entries),/dock site/i);
});
