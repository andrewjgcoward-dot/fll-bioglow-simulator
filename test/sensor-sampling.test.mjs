import test from 'node:test';
import assert from 'node:assert/strict';
import {SPOT_R,SPOT_OFFSETS,SURFACE_RGB,areaSampler} from '../src/sensor-sampling.js';
import {photoSampler} from '../src/mat-photo.js';
import {Sim,plainMatSample} from '../src/sim.js';
import {trainingScene,challenge,reliabilityTrials} from '../src/training.js';
import {flatToAst} from '../src/blocks.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} ≠ ${b}`);
const surface=(black,white=98)=>p=>({rgb:SURFACE_RGB[black(p)?'black':'white'],reflect:black(p)?8:white});
function photo(black,w=100,h=100){const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;data.set([...SURFACE_RGB[black([x,h-y])?'black':'white'],255],i);}return photoSampler(data,w,h,w,h);}
test('nominal disk is 8mm diameter with 49 symmetric equally weighted probes',()=>{
 assert.equal(SPOT_R,4);assert.equal(SPOT_OFFSETS.length,49);
 for(const [x,y] of SPOT_OFFSETS){assert.ok(x*x+y*y<=SPOT_R**2);assert.ok(SPOT_OFFSETS.some(([a,b])=>a===-x&&b===-y));}
});
test('all modes preserve homogeneous black and white endpoint readings',()=>{
 for(const black of [true,false]){const expected={color:black?'black':'white',reflect:black?8:98};assert.deepEqual(areaSampler(surface(()=>black),100,100)([50,50]),expected);assert.deepEqual(photo(()=>black)([50,50]),expected);}
 assert.deepEqual(plainMatSample([600,892]),{color:'black',reflect:8});assert.deepEqual(plainMatSample([100,100]),{color:'white',reflect:98});
 const scene=trainingScene(challenge('line'));assert.deepEqual(scene.sample([600,700]),{color:'black',reflect:8});assert.deepEqual(scene.sample([600,600]),{color:'white',reflect:90});
});
test('photo and synthetic surfaces use identical geometry at fractional mixed edges',()=>{
 const black=([x])=>x<50,synthetic=areaSampler(surface(black),100,100),photographic=photo(black);
 for(let x=44;x<=56;x+=.125)assert.deepEqual(photographic([x,50]),synthetic([x,50]));
 close(synthetic([49.5,50]).reflect,53);assert.equal(synthetic([49.5,50]).color,'none','mixed RGB is classified, not center color');
});
test('practice line edges change monotonically and continuously with submillimetre motion',()=>{
 const scene=trainingScene(challenge('line'));let prev=90,intermediate=new Set();
 for(let y=684;y<=696;y+=.125){const r=scene.sample([600,y]).reflect;assert.ok(r<=prev+1e-9);assert.ok(prev-r<3);if(r>8&&r<90)intermediate.add(r);prev=r;}
 assert.ok(intermediate.size>40);close(scene.sample([600,689.5]).reflect,49);close(prev,8);
});
test('plain mat uses mixed area response too, preserving assigned surface reflectance',()=>{
 let prev=8;for(let y=898;y<=908;y+=.125){const r=plainMatSample([600,y]).reflect;assert.ok(r>=prev-1e-9);assert.ok(r<=25);prev=r;}close(prev,25);
 assert.ok(plainMatSample([600,902]).reflect>8);assert.ok(plainMatSample([600,902]).reflect<25);
});
test('edge extension preserves white at every boundary; outside and nonfinite centers have no reading',()=>{
 const sample=photo(()=>false);for(const p of [[0,0],[100,100],[0,50],[100,50],[50,0],[50,100]])assert.deepEqual(sample(p),{color:'white',reflect:98});
 for(const p of [[-.01,50],[100.01,50],[50,-.01],[50,100.01],[NaN,50],[50,Infinity]])assert.equal(sample(p),null);
 const s=new Sim();s.variation={reflect:20};s.cfg.color={...s.cfg.color,x:0,y:0};const reading=s.readSensors({x:-1,y:50,h:0});assert.equal(reading.color,'none');assert.equal(reading.reflect,0);
});
test('rotated and offset sensor samples the same world footprint; scene/photo/fallback switches are coherent',()=>{
 const s=new Sim();s.cfg.color={...s.cfg.color,x:10,y:70};const pose={x:530,y:710,h:90};s.scene=trainingScene(challenge('line'));let reading=s.readSensors(pose);close(reading.spot[0],600);close(reading.spot[1],700);assert.equal(reading.color,'black');
 s.matPhoto=()=>({color:'red',reflect:60});assert.equal(s.readSensors(pose).color,'black','practice takes precedence');s.scene=null;assert.equal(s.readSensors(pose).color,'red');s.matPhoto=null;assert.deepEqual(s.readSensors(pose).reflect,plainMatSample([600,700]).reflect);
 s.scene=trainingScene(challenge('line'));assert.equal(s.readSensors(pose).color,'black');
});
test('edge-driven line-stop reliability remains reproducible under seeded reflection and launch variation',()=>{
 const program=flatToAst([{t:'speed',pct:30},{t:'startMove',dir:'forward'},{t:'waitColor',port:'C',color:'black'},{t:'stopMove'}]);
 const args={id:'line',program,seed:994,variation:{xy:2,heading:.1,reflection:4}};
 const a=[...reliabilityTrials(args)].filter(x=>x.kind==='result'),b=[...reliabilityTrials(args)].filter(x=>x.kind==='result');assert.equal(a.length,20);assert.deepEqual(a,b);assert.ok(a.every(x=>x.success));
});
