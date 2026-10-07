import test from 'node:test';
import assert from 'node:assert/strict';
import {Sim} from '../src/sim.js';
import {node as n,emptyProgram} from '../src/blocks.js';
import {buildProject,convertProject} from '../src/spike-io.js';
const p=stacks=>({...emptyProgram(),stacks}), wait=val=>n('wait',{val});
const make=(stacks,cfg={})=>{const s=new Sim({collide:false,arms:[],ramp:0,...cfg},{x:1000,y:600,h:0},[]);s.run(p(stacks));return s};
const near=(a,b)=>assert.ok(Math.abs(a-b)<.001,`${a} expected ${b}`);

test('all ordered movement pairs complete on the selected shafts without remapping physical wiring',()=>{
 for(const left of 'ABCDEF')for(const right of 'ABCDEF')if(left!==right)for(const ramp of [0,1]){
  const pair=left+right, source=p([[n('pair',{pair}),n('move',{val:90,unit:'degrees'})]]);
  const imported=convertProject(buildProject(source).project);assert.equal(imported.cfg.pair,undefined);
  const s=make(imported.program.stacks,{ramp});s.advance(3);assert.equal(s.running,false,pair+' completes');
  assert.equal(s.physicalPair,'AB');near(s.arms[left],-90);near(s.arms[right],90);
  for(const port of 'ABCDEF')if(!pair.includes(port))near(s.arms[port],0);
  if(!pair.includes('A')&&!pair.includes('B')){near(s.pose.x,1000);near(s.pose.y,600);near(s.pose.h,0)}
 }
});

test('active actions keep their selected ports when another stack changes the movement pair',()=>{
 for(const bounded of [true,false]){
  const s=make([[n('pair',{pair:'EF'}),n(bounded?'move':'startMove',{val:90,unit:'degrees'}),wait(.3),n('stopMove')],[wait(.04),n('pair',{pair:'CD'})]]);
  s.advance(1);assert.equal(s.running,false);near(s.arms.C,0);near(s.arms.D,0);near(s.arms.E,bounded?-90:-150);near(s.arms.F,bounded?90:150);
 }
});

test('physical wiring edits during a bounded run take effect only on a new launch',()=>{
 const s=make([[n('move',{val:360,unit:'degrees'})]]);s.advance(.1);s.configureDrivePair('CD');s.advance(2);
 assert.equal(s.running,false);near(s.arms.A,-360);near(s.arms.B,360);near(s.arms.C,0);near(s.arms.D,0);
 s.run(p([[n('move',{val:90,unit:'degrees'})]]));s.advance(1);near(s.arms.C,-90);near(s.arms.D,90);assert.equal(s.physicalPair,'CD');
});

test('ramped reversals finish at the signed relative or absolute target for either physical shaft',()=>{
 for(const port of 'AB')for(const first of ['clockwise','counterclockwise'])for(const absolute of [false,true]){
  const other=first==='clockwise'?'counterclockwise':'clockwise';
  const s=make([[n('motorStart',{port,dir:first}),wait(.5),n('setVar',{name:'before',val:n('motorRel',{port})}),absolute?n('motorGoTo',{port,dir:other,pos:90}):n('motor',{port,dir:other,val:10,unit:'degrees'})]],{ramp:1});
  s.advance(3);assert.equal(s.running,false);if(absolute)near(s.val(n('motorPos',{port})),90);else near(s.arms[port]-s.vars.before,other==='clockwise'?10:-10);
 }
});

test('speed oscillation cannot turn accumulated travel into bounded net progress',()=>{
 const s=make([[n('motor',{port:'B',val:180,unit:'degrees'}),n('setVar',{name:'done',val:1})]],{ramp:1});
 for(let i=0;i<10;i++){s.motorSpeed.B=i%2?-75:75;s.advance(.1);assert.notEqual(s.vars.done,'1')}
 s.motorSpeed.B=75;s.advance(3);assert.equal(s.vars.done,'1');near(s.arms.B,180);
});

test('a completed bounded shaft stays at its endpoint while another physical motor continues',()=>{
 const s=make([[n('motor',{port:'B',val:20,unit:'degrees'}),wait(1)],[n('motor',{port:'A',val:180,unit:'degrees'})]],{ramp:1});
 s.advance(2);near(s.arms.B,20);near(s.arms.A,180);
});

test('stopping an active drive motor preserves unrelated motion on the newly selected pair', () => {
 const s = make([[
  n('startMove'), n('pair', { pair: 'EF' }), n('motorStart', { port: 'F' }),
  wait(.1), n('motorStop', { port: 'A' }), wait(.2)
 ]]);
 s.advance(.15);
 near(s.arms.A, -50); near(s.arms.B, 50);
 near(s.arms.F, 112.5); assert.equal(s.motorRun.F, 1);
 s.advance(.3);
 // Wait completion can round up by one physics step.
 assert.ok(s.arms.F >= 225 && s.arms.F <= 228); assert.equal(s.running, false);
});

test('cancelling an old bounded drive releases only its waiter and preserves another motor action', () => {
 const s = make([
  [n('move', { val: 10, unit: 'seconds' }), n('setVar', { name: 'driveReleased', val: n('timer') })],
  [n('pair', { pair: 'EF' }), n('motor', { port: 'F', val: 270, unit: 'degrees' }), n('setVar', { name: 'motorFinished', val: n('timer') })],
  [wait(.1), n('motorStop', { port: 'A' })]
 ]);
 s.advance(.15);
 assert.ok(s.vars.driveReleased >= .1 && s.vars.driveReleased < .12);
 assert.ok(s.motorActions.F); near(s.arms.F, 112.5);
 s.advance(.5);
 near(s.arms.F, 270); assert.equal(s.running, false);
 assert.ok(s.vars.motorFinished >= .36 && s.vars.motorFinished < .38);
});

test('a stalled chassis does not complete a disjoint attachment-pair action', () => {
 const s = new Sim({ collide: true, ramp: 0, arms: [] }, { x: 1000, y: 1043, h: 0 }, []);
 s.run(p([[
  n('motorStart', { port: 'A', dir: 'counterclockwise' }), n('motorStart', { port: 'B' }),
  n('pair', { pair: 'EF' }), n('move', { val: 10000, unit: 'degrees' })
 ]]));
 s.advance(2);
 assert.equal(s.hit, 'the wall'); assert.equal(s.running, true);
 near(s.arms.A, 0); near(s.arms.B, 0); near(s.arms.E, -1000); near(s.arms.F, 1000);
 near(s.driveAction.stall, 0);
 s.advance(19);
 assert.equal(s.running, false); near(s.arms.E, -10000); near(s.arms.F, 10000);
 assert.ok(!s.logLines.some(line => line.includes('Motors stalled')));
});

test('a wall stall counts for a mixed pair when its selected physical shaft is moving', () => {
 const s = new Sim({ collide: true, ramp: 0, arms: [] }, { x: 1000, y: 1043, h: 0 }, []);
 s.run(p([[
  n('motorStart', { port: 'B' }), n('pair', { pair: 'AE' }),
  n('move', { val: 10000, unit: 'degrees' })
 ]]));
 s.advance(2);
 assert.equal(s.running, false); near(s.arms.A, 0);
 assert.ok(s.arms.E > 490 && s.arms.E < 520);
 assert.ok(s.logLines.some(line => line.includes('Motors stalled')));
});

test('an idle physical shaft in a mixed pair does not inherit another motor wall stall', () => {
 const s = new Sim({ collide: true, ramp: 0, arms: [] }, { x: 1000, y: 1043, h: 0 }, []);
 s.run(p([[
  n('motorStart', { port: 'B' }), n('pair', { pair: 'EA' }),
  n('steer', { steer: 50, val: 10000, unit: 'degrees' })
 ]]));
 s.advance(2);
 assert.equal(s.hit, 'the wall'); assert.equal(s.running, true);
 near(s.arms.A, 0); near(s.arms.E, -1000); near(s.driveAction.stall, 0);
});

test('an attachment pair still detects its own arm mechanical limit', () => {
 const s = new Sim({ collide: true, ramp: 0 }, { x: 1000, y: 600, h: 0 }, []);
 s.run(p([[n('pair', { pair: 'EF' }), n('move', { dir: 'back', val: 10000, unit: 'degrees' })]]));
 s.advance(2);
 assert.equal(s.running, false); near(s.arms.E, 90);
 assert.ok(s.logLines.some(line => line.includes('Motors stalled')));
});
