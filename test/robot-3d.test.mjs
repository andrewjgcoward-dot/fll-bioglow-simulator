import test from 'node:test';
import { flatToAst } from '../src/blocks.js';
import assert from 'node:assert/strict';
import { Sim, DEFAULT_CONFIG, armGeom, migrateArmHome } from '../src/sim.js';
import { robotScene, armLocalPoint, projectPoint, fitViewport, renderRobot3D, createRobot3D, orbitCamera, DEFAULT_CAMERA } from '../src/robot-3d.js';

test('3D arm endpoints follow the simulator geometry, motor direction and gear ratio', () => {
  const sim = new Sim();
  for (const motor of [0, 45, 90, 180, -90]) {
    sim.arms.E = motor;
    const arm = robotScene(sim).arms[0], expected = armGeom(sim.cfg.arms[0], motor);
    assert.deepEqual(arm.geometry, expected);
    assert.equal(arm.motor, motor);
    assert.ok(Math.abs(Math.hypot(arm.tip[0]-arm.pivot[0], arm.tip[1]-arm.pivot[1])-expected.proj)<1e-9);
    assert.ok(Math.abs(arm.tip[2]-arm.pivot[2]-Math.sin(expected.tilt*Math.PI/180)*arm.len)<1e-9);
    assert.deepEqual(armLocalPoint(arm,[0,arm.len,0]),arm.tip);
    const left=armLocalPoint(arm,[-28,arm.len,-arm.len*.16]),right=armLocalPoint(arm,[28,arm.len,-arm.len*.16]);
    assert.ok(Math.abs(Math.hypot(...left.map((v,i)=>v-right[i]))-56)<1e-9,'hoop cross axle stays rigid through lift');
  }
  Object.assign(sim.cfg.arms[0], { ratio: 2, cw: 'raises', rest: 'down', dir: 'right' });
  sim.arms.E=20;
  const arm=robotScene(sim).arms[0];
  assert.equal(arm.geometry.tilt,40);
  assert.ok(arm.tip[0]>arm.pivot[0]);
  assert.equal(arm.tip[1],arm.pivot[1]);
});

test('3D reflects sweep arms, configured dimensions, drive ports and reset immediately', () => {
  const cfg=structuredClone(DEFAULT_CONFIG);
  cfg.pair='CD';cfg.robotW=190;cfg.track=150;cfg.wheel=88;
  cfg.arms=[{id:'sweep',port:'F',motion:'sweep',x:12,y:70,dir:'front',len:110,ratio:2,cw:'left'}];
  const sim=new Sim(cfg,{x:300,y:400,h:30});
  sim.pose={x:650,y:700,h:90};sim.arms.F=30;sim.arms.C=123;sim.arms.D=456;
  let scene=robotScene(sim);
  assert.deepEqual(scene.pose,{x:650,y:700,h:90});
  assert.equal(scene.arms[0].geometry.ang,-60);
  assert.equal(scene.arms[0].tip[2],scene.arms[0].pivot[2]);
  assert.deepEqual(scene.wheels.map(w=>[w.x,w.port,w.angle]),[[-75,'C',123],[75,'D',456]]);
  sim.reset();scene=robotScene(sim);
  assert.deepEqual(scene.pose,{x:300,y:400,h:30});
  assert.equal(scene.arms[0].motor,0);
  assert.deepEqual(scene.wheels.map(w=>w.angle),[0,0]);
  sim.cfg.arms=[];assert.match(renderRobot3D(robotScene(sim)).armText,/No arms configured/);
});

test('viewport resizes without clipping normal geometry or changing scale with arm motion', () => {
  const sim=new Sim();
  for (const [width,height] of [[280,270],[700,340],[1100,380]]) {
    const scene=robotScene(sim),view=fitViewport(scene,width,height,DEFAULT_CAMERA);
    assert.ok(Number.isFinite(view.scale)&&view.scale>0);
    sim.arms.E=90;
    assert.equal(fitViewport(robotScene(sim),width,height,DEFAULT_CAMERA).scale,view.scale);
    const svg=renderRobot3D(scene,DEFAULT_CAMERA,width,height).markup;
    assert.ok(!/NaN|Infinity|undefined/.test(svg));
    for(const part of ['7×11 frame','medium drive motor','rear ball caster','large arm motor E','12T motor bevel gear','12T hoop bevel gear','hoop cross axle E','hoop side E'])assert.ok(svg.includes(`data-part="${part}"`));
    assert.match(svg,/data-part="color sensor"/);assert.match(svg,/data-part="distance sensor"/);
  }
  assert.deepEqual(projectPoint([10,0,0],{azimuth:0,elevation:0}),[10,0,0]);
  assert.equal(orbitCamera(DEFAULT_CAMERA,0,10000).elevation,85);
  assert.equal(orbitCamera(DEFAULT_CAMERA,0,-10000).elevation,8);
});

class Element {
  constructor(){this.listeners={};this.attrs={};this.width=700;this.height=340;this.innerHTML='';this.textContent='';}
  addEventListener(k,v){this.listeners[k]=v;}
  removeEventListener(k){delete this.listeners[k];}
  setAttribute(k,v){this.attrs[k]=v;}
  getBoundingClientRect(){return {width:this.width,height:this.height};}
  setPointerCapture(){}
}
test('panel updates on state changes, resize, orbit and view reset without modifying simulation', () => {
  const sim=new Sim(),svg=new Element(),arm=new Element(),pose=new Element(),panel=new Element();
  panel.querySelector=s=>s==='svg'?svg:s==='[data-arm-state]'?arm:pose;
  let resized,disconnected=false;
  class Observer {constructor(fn){resized=fn;}observe(){}disconnect(){disconnected=true;}}
  const view=createRobot3D(panel,sim,{ResizeObserver:Observer});
  const initial=svg.innerHTML;
  assert.match(arm.textContent,/Up.*lift 90°.*motor 0°/);
  sim.arms.E=90;view.update();assert.match(arm.textContent,/Down.*lift 0°.*motor 90°/);
  assert.notEqual(svg.innerHTML,initial);
  sim.reset();view.update();assert.equal(svg.innerHTML,initial);
  const state=JSON.stringify({pose:sim.pose,arms:sim.arms,cfg:sim.cfg});
  svg.listeners.pointerdown({button:0,pointerId:1,clientX:0,clientY:0});
  svg.listeners.pointermove({pointerId:1,clientX:50,clientY:30});
  svg.listeners.pointerup({});assert.notEqual(svg.innerHTML,initial);
  view.resetView();assert.equal(svg.innerHTML,initial);
  let prevented=false;svg.listeners.keydown({key:'ArrowLeft',preventDefault(){prevented=true;}});assert.ok(prevented);
  panel.listeners.click({target:{closest(){return {dataset:{view:'reset'}};}}});assert.equal(svg.innerHTML,initial);
  svg.width=320;svg.height=270;resized();assert.equal(svg.attrs.viewBox,'0 0 320 270');
  assert.equal(JSON.stringify({pose:sim.pose,arms:sim.arms,cfg:sim.cfg}),state);
  view.destroy();assert.ok(disconnected);assert.deepEqual(svg.listeners,{});
});

test('restoring raised home migrates earlier down defaults once without changing programs or custom wiring',()=>{
  for(const priorVersion of [undefined,1]) {
    const saved={robotHomeVersion:priorVersion,cfg:structuredClone(DEFAULT_CONFIG),program:{stacks:[[{t:'wait',val:1}]]},ws:'keep-workspace'};
    Object.assign(saved.cfg,{pair:'CD',wheel:88,track:147});
    Object.assign(saved.cfg.arms[0],{port:'F',ratio:2,cw:'raises',rest:'down',len:111,x:17,y:63});
    saved.cfg.arms.push({id:'s',motion:'sweep',port:'B',rest:'down',cw:'left'});
    const original=structuredClone(saved),next=migrateArmHome(saved);
    assert.deepEqual(saved,original);
    assert.deepEqual(next,{...original,robotHomeVersion:2,cfg:{...original.cfg,arms:[{...original.cfg.arms[0],rest:'up'},original.cfg.arms[1]]}});
    next.cfg.arms[0].rest='down';
    assert.equal(migrateArmHome(next),next,'a later explicit home edit is not overridden');
  }
  const sim=new Sim(migrateArmHome().cfg);
  assert.equal(robotScene(sim).arms[0].state,'Up');assert.equal(sim.arms.E,0);
});

test('first load, Run and reset start up; Stop preserves a partly lowered hoop',()=>{
  const sim=new Sim({collide:false},{x:400,y:400,h:0},[]);
  const program=flatToAst([{t:'motor',port:'E',dir:'clockwise',val:90,unit:'degrees'},{t:'wait',val:1},{t:'motor',port:'E',dir:'counterclockwise',val:90,unit:'degrees'}]);
  assert.equal(robotScene(sim).arms[0].state,'Up');
  sim.run(program);sim.advance(.08);
  const mid=robotScene(sim).arms[0];assert.ok(mid.geometry.tilt>0&&mid.geometry.tilt<90);
  sim.stop();sim.advance(.5);assert.equal(sim.arms.E,mid.motor);
  sim.run(program);assert.equal(sim.arms.E,0);assert.equal(robotScene(sim).arms[0].state,'Up');
  let sawDown=false;
  for(let i=0;i<300&&sim.running;i++){sim.advance(.02);if(robotScene(sim).arms[0].geometry.tilt<1)sawDown=true;}
  assert.ok(sawDown);assert.equal(sim.running,false);assert.equal(robotScene(sim).arms[0].state,'Up');
  sim.arms.E=45;sim.reset();assert.equal(sim.arms.E,0);assert.equal(robotScene(sim).arms[0].state,'Up');
  sim.startMatch();sim.arms.E=45;sim.run(flatToAst([{t:'wait',val:1}]));assert.equal(sim.arms.E,0);assert.equal(robotScene(sim).arms[0].state,'Up');
});

test('Robot drive-pair edits update idle wheels and preserve active physical wiring until next launch',()=>{
  const sim=new Sim();
  sim.arms.C=12;sim.arms.D=34;sim.configureDrivePair('CD');
  assert.deepEqual(robotScene(sim).wheels.map(w=>[w.port,w.angle]),[['C',12],['D',34]]);
  sim.run(flatToAst([{t:'pair',pair:'AB'},{t:'wait',val:2}]));sim.advance(.02);
  assert.equal(sim.pair,'AB');
  sim.configureDrivePair('EF');assert.equal(sim.cfg.pair,'EF');assert.equal(sim.pair,'AB');
  assert.deepEqual(robotScene(sim).wheels.map(w=>w.port),['C','D']);
  sim.stop();sim.configureDrivePair('CD');assert.equal(sim.pair,'CD');
  sim.run(flatToAst([{t:'wait',val:1}]));assert.equal(sim.pair,'CD');
});

test('a differently geared lift on F moves from its down home without affecting drive ports',()=>{
  const cfg=structuredClone(DEFAULT_CONFIG);cfg.pair='CD';cfg.arms[0]={...cfg.arms[0],port:'F',ratio:2,cw:'raises',dir:'right',rest:'down'};
  const sim=new Sim(cfg);sim.run(flatToAst([{t:'motor',port:'F',dir:'clockwise',val:45,unit:'degrees'}]));
  for(let i=0;i<200&&sim.running;i++)sim.advance(.02);
  assert.equal(robotScene(sim).arms[0].state,'Up');assert.equal(sim.arms.F,45);
  assert.deepEqual(robotScene(sim).wheels.map(w=>[w.port,w.angle]),[['C',0],['D',0]]);
  sim.reset();assert.equal(robotScene(sim).arms[0].state,'Down');
});
