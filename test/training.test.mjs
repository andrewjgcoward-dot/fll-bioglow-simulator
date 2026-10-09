import test from 'node:test';
import assert from 'node:assert/strict';
import {Sim} from '../src/sim.js';
import {flatToAst,node,lit,emptyProgram} from '../src/blocks.js';
import {CHALLENGES,challenge,configureChallenge,observeChallenge,evaluateChallenge,reliabilityTrials,trialParameters,trainingScene} from '../src/training.js';
import {createPracticeSession} from '../src/practice-session.js';
const p=flat=>flatToAst(flat);
const drive=cm=>p([{t:'move',dir:'forward',unit:'cm',val:cm}]);
function run(id,program,variation=null,start){const c=challenge(id),s=new Sim();configureChallenge(s,c,variation);if(start)s.start=start;const obs={samples:0,onLine:0,collision:false};s.onStep=()=>observeChallenge(c,s,obs);s.run(program);while(s.running&&s.t<c.limit)s.advance(.02);return {s,obs,result:evaluateChallenge(c,s,obs,s.running?'timeout':'finished')};}
const examples={
 target:drive(40),
 heading:p([{t:'steer',steer:100,val:180,unit:'degrees'}]),
 line:p([{t:'speed',pct:30},{t:'startMove',dir:'forward'},{t:'waitColor',port:'C',color:'black'},{t:'stopMove'}]),
 obstacle:p([{t:'speed',pct:30},{t:'startMove',dir:'forward'},{t:'waitDist',port:'D',cmp:'<',val:15},{t:'stopMove'}])
};
for(const [id,program] of Object.entries(examples))test(`validated ${id} scene accepts measured reference program and rejects empty program`,()=>{
 const {s,result}=run(id,program);assert.ok(result.success,result.feedback);assert.ok(s.t>0);assert.equal(run(id,emptyProgram()).result.success,false);
});
test('motor degrees are not chassis heading: 180 motor degrees turns default chassis 90 degrees',()=>{
 const {s}=run('heading',examples.heading);assert.ok(Math.abs(s.pose.h-90)<.2);assert.ok(Math.abs(Math.abs(s.arms.A)-180)<.2);
});
test('paused clock freezes all stacks, motors, sensor events and match time; single step advances all together',()=>{
 const s=new Sim();configureChallenge(s,challenge('target'));s.startMatch();s.run({...emptyProgram(),vars:['a','b'],stacks:[[node('wait',{val:.5}),node('setVar',{name:'a',val:1})],[node('wait',{val:.5}),node('setVar',{name:'b',val:1})]]});s.pause();const before=JSON.stringify({t:s.t,match:s.matchT,pose:s.pose,vars:s.vars,sens:s.sens});s.advance(10);assert.equal(JSON.stringify({t:s.t,match:s.matchT,pose:s.pose,vars:s.vars,sens:s.sens}),before);s.singleStep();assert.ok(Math.abs(s.t-.02)<1e-10);assert.ok(Math.abs(s.matchT-.02)<1e-10);assert.equal(s.paused,true);for(let i=0;i<26;i++)s.singleStep();assert.equal(Number(s.vars.a),1);assert.equal(Number(s.vars.b),1);s.stop();assert.equal(s.paused,false);
});
test('stepped concurrent movement equals unpaused fixed-time execution',()=>{
 const prog={...emptyProgram(),stacks:[[node('move',{val:40,unit:'cm'})],[node('wait',{val:.1}),node('show',{text:'parallel'})]]};
 const a=new Sim(),b=new Sim();for(const s of [a,b]){configureChallenge(s,challenge('target'));s.run(prog);}b.pause();for(let i=0;i<50;i++){a.advance(.02);b.singleStep();}assert.deepEqual(a.pose,b.pose);assert.equal(a.t,b.t);assert.equal(a.display,b.display);
});
test('condition outcomes come from real execution without a second reporter evaluation',()=>{
 const s=new Sim();configureChallenge(s,challenge('target'));let draws=0;s.random=()=>{draws++;return .8;};s.run({...emptyProgram(),stacks:[[node('if',{id:'condition',cond:node('gt',{a:node('random',{a:0,b:10}),b:5}),body:[node('show',{text:'true'})]})]]});s.advance(.02);assert.equal(draws,1);assert.ok(s.trace.some(t=>t.id==='condition'&&t.outcome===true));assert.equal(s.display,'true');
});
test('trial results reproduce exactly including paths and seeded program random/list reporters',()=>{
 const args={id:'target',program:examples.target,seed:452,variation:{xy:10,heading:2,leftBias:.2,rightBias:-.3,wheelJitter:.1,reflection:3,distance:5}};
 const a=[...reliabilityTrials(args)].filter(x=>x.kind==='result'),b=[...reliabilityTrials(args)].filter(x=>x.kind==='result');assert.equal(a.length,20);assert.deepEqual(a,b);assert.notDeepEqual(a,[...reliabilityTrials({...args,seed:453})].filter(x=>x.kind==='result'));
});
test('ideal trials have identical paths and all target successes; fixed bias persists and jitter varies per trial',()=>{
 const r=[...reliabilityTrials({id:'target',program:examples.target,seed:1})].filter(x=>x.kind==='result');assert.equal(r.length,20);assert.ok(r.every(x=>x.success));assert.ok(r.every(x=>JSON.stringify(x.path)===JSON.stringify(r[0].path)));
 const c=challenge('target'),a=trialParameters(c,12,0,{leftBias:1,rightBias:-1}),b=trialParameters(c,12,1,{leftBias:1,rightBias:-1});assert.deepEqual(a.variation,b.variation);assert.equal(a.variation.leftTravel,1.01);assert.equal(a.variation.rightTravel,.99);
 assert.notDeepEqual(trialParameters(c,12,0,{xy:10}).start,trialParameters(c,12,1,{xy:10}).start);
});
test('rolling variation changes ground path without inventing encoder rotation',()=>{
 const ideal=run('target',drive(40)).s,biased=run('target',drive(40),{leftTravel:1.01,rightTravel:.99}).s;
 assert.deepEqual(ideal.arms,biased.arms);assert.ok(Math.abs(biased.pose.x-ideal.pose.x)>1);
});
test('1 degree initial heading gives 17.45mm lateral per metre; gradual 0-to-1 degree curvature gives about half',()=>{
 const start={x:400,y:500,h:91};const straight=run('target',drive(100),null,start).s;const lateral=start.y-straight.pose.y;assert.ok(Math.abs(lateral-1000*Math.sin(Math.PI/180))<.02);
 const difference=(Math.PI/180)*112/1000;const curved=run('target',drive(100),{leftTravel:1+difference/2,rightTravel:1-difference/2},{...start,h:90}).s;assert.ok(Math.abs(curved.pose.h-91)<.01);assert.ok(Math.abs((start.y-curved.pose.y)-lateral/2)<.03);
});
test('reflection and distance biases have declared units; no per-read noise',()=>{
 const s=new Sim();configureChallenge(s,challenge('obstacle'),{reflect:4,distanceMm:5});const first=s.readSensors(s.pose);assert.equal(first.reflect,94);assert.equal(first.dist,48.5);assert.deepEqual(first,s.readSensors(s.pose));
});
test('trial validation rejects unknown scenes, invalid ranges and invalid seed before simulation',()=>{
 for(const args of [{id:'M03'},{id:'target',seed:NaN},{id:'target',variation:{heading:-1}},{id:'target',variation:{leftBias:Infinity}}])assert.throws(()=>[...reliabilityTrials({program:examples.target,...args})]);
});
test('timeout, interruption and collision cannot pass a challenge',()=>{
 const {s,obs}=run('target',examples.target);for(const reason of ['timeout','interrupted'])assert.equal(evaluateChallenge(challenge('target'),s,obs,reason).success,false);assert.equal(evaluateChallenge(challenge('target'),s,{collision:true}).success,false);
 const infinite=p([{t:'startMove',dir:'forward'},{t:'waitColor',port:'C',color:'red'}]);assert.equal(run('line',infinite).result.success,false);
});
test('training scenes exclude mission mechanisms and reset repeatably',()=>{
 for(const c of CHALLENGES){const s=new Sim();configureChallenge(s,c);assert.equal(s.objects.length,(c.objects||[]).length);s.run(examples.target);s.advance(.1);s.reset();assert.deepEqual(s.pose,c.start);assert.equal(s.scene.sample([50,50]).color,'white');}
});
function session(fail){let state={ws:{loose:{value:42},disabled:true},start:{x:100,y:200,h:17},sounds:{custom:3},cfg:{track:115}},storage={},changes=[];const original=structuredClone(state);const session=createPracticeSession({capture:()=>structuredClone(state),install:(v,id)=>{state=structuredClone(v);if(fail?.(id))throw Error('load failed');},makeDraft:id=>({ws:{id},start:{x:600,y:300,h:0}}),writeDraft:(id,v)=>storage[id]=structuredClone(v),changed:id=>changes.push(id)});return {session,original,get:()=>state,set:v=>state=v,storage,changes};}
test('practice preserves raw unfinished/disabled main workspace, sounds and robot through switches and repeated exit',()=>{
 const f=session();f.session.enter('target');f.set({...f.get(),ws:{edited:1}});f.session.enter('line');f.session.enter('target');assert.deepEqual(f.get().ws,{edited:1});f.session.leave();assert.deepEqual(f.get(),f.original);f.session.leave();assert.deepEqual(f.get(),f.original);assert.deepEqual(f.storage.target.ws,{edited:1});
});
test('failed practice entry/switch rolls back visible workspace and mode; repeated same entry is harmless',()=>{
 const f=session(id=>id==='bad');assert.throws(()=>f.session.enter('bad'));assert.equal(f.session.active,null);assert.deepEqual(f.get(),f.original);f.session.enter('target');const before=structuredClone(f.get());assert.throws(()=>f.session.enter('bad'));assert.equal(f.session.active,'target');assert.deepEqual(f.get(),before);f.session.enter('target');assert.deepEqual(f.get(),before);f.session.leave();assert.deepEqual(f.get(),f.original);
});
test('bending-line scene validates an actual reflection feedback controller; straight drive fails',()=>{
 const prog={...emptyProgram(),stacks:[[node('speed',{pct:20}),node('repeatUntil',{cond:node('gt',{a:node('timer'),b:6}),body:[node('startSteer',{steer:node('mul',{a:node('sub',{a:49,b:node('reflection',{port:'C'})}),b:.8})})]}),node('stopMove')]]};
 const good=run('follow',prog);assert.ok(good.result.success,good.result.feedback);assert.ok(good.s.trace.some(t=>t.type==='repeatUntil'&&t.outcome===true));assert.equal(run('follow',drive(52)).result.success,false);
 const results=[...reliabilityTrials({id:'follow',program:prog})].filter(x=>x.kind==='result');assert.equal(results.length,20);assert.ok(results.every(x=>x.success));
});
test('seeded random reporters and random list indices reproduce in trial programs',()=>{
 const prog={...emptyProgram(),lists:['choices'],stacks:[[node('listAdd',{list:'choices',item:30}),node('listAdd',{list:'choices',item:40}),node('move',{val:node('add',{a:node('listItem',{list:'choices',index:'random'}),b:node('random',{a:0,b:3})}),unit:'cm'})]]};
 const r=seed=>[...reliabilityTrials({id:'target',program:prog,seed})].filter(x=>x.kind==='result');assert.deepEqual(r(84),r(84));assert.notDeepEqual(r(84),r(85));
});
test('abandoning an interrupted trial iterator cannot change a foreground simulator or supplied program/config',()=>{
 const sim=new Sim();sim.run(drive(5));sim.pause();const before=structuredClone({pose:sim.pose,t:sim.t,program:sim.program,cfg:sim.cfg});const program=examples.target,cfg={wheel:60,track:120};const inputs=JSON.stringify({program,cfg});const it=reliabilityTrials({id:'target',program,cfg,seed:123});it.next();it.return();assert.equal(JSON.stringify({program,cfg}),inputs);assert.deepEqual({pose:sim.pose,t:sim.t,program:sim.program,cfg:sim.cfg},before);assert.equal(sim.paused,true);
});
test('leaving practice during storage failure still restores protected original and remembers draft in memory',()=>{
 let current={ws:{original:1}},fail=false;const s=createPracticeSession({capture:()=>current,install:v=>current=v,makeDraft:()=>({ws:{draft:1}}),writeDraft:()=>{throw Error('quota');}});s.enter('target');current.ws.draft=2;s.remember();s.leave();assert.deepEqual(current,{ws:{original:1}});s.enter('target');assert.equal(current.ws.draft,2);
});
test('recursion guard abort cannot be a challenge or batch success even after reaching the target',()=>{
 const program={...examples.target,stacks:[[...examples.target.stacks[0],node('call',{name:'loop'})]],procs:{loop:{params:[],body:[node('call',{name:'loop'})]}}};const {s,result}=run('target',program);assert.match(s.runError,/too many/);assert.equal(result.success,false);assert.match(result.feedback,/Program failed/);assert.ok([...reliabilityTrials({id:'target',program})].filter(x=>x.kind==='result').every(x=>!x.success));
});
test('heading grading wraps arbitrary negative/positive turns and obstacle orientation',()=>{
 const rotated=run('heading',p([{t:'steer',steer:-100,val:1260,unit:'degrees'}]));assert.ok(rotated.result.success,rotated.result.feedback);
 const {s,obs}=run('obstacle',examples.obstacle);for(const angle of [-720,-360,0,360,720]){s.pose.h=angle;assert.equal(evaluateChallenge(challenge('obstacle'),s,obs).success,true);}
});
for(const [id,hat] of [['line',node('whenColor',{port:'C',color:'black'})],['obstacle',node('whenDistance',{port:'D',cmp:'<',val:15,unit:'cm'})]])test(`event-driven ${id} stop succeeds after settling and traces actual hat outcome`,()=>{
 const program={...emptyProgram(),stacks:[[node('speed',{pct:30}),node('startMove',{dir:'forward'})]],events:[{hat:{...hat,id:'sensor-hat'},body:[node('stopMove')]}]};
 const c=challenge(id),s=new Sim();configureChallenge(s,c);const obs={samples:0,onLine:0,collision:false};s.onStep=()=>observeChallenge(c,s,obs);s.run(program);let result;
 while(s.running&&s.t<c.limit){s.advance(.02);result=evaluateChallenge(c,s,obs);if(result.success)break;}
 assert.ok(result.success,result.feedback);assert.ok(s.t<5);assert.ok(s.trace.some(t=>t.id==='sensor-hat'&&t.outcome===true));
 assert.ok([...reliabilityTrials({id,program})].filter(x=>x.kind==='result').every(x=>x.success));
});
test('pending timed stack at goal cannot claim idle-listener completion',()=>{
 const c=challenge('target'),s=new Sim();configureChallenge(s,c);const obs={};s.onStep=()=>observeChallenge(c,s,obs);s.run({...emptyProgram(),stacks:[[...examples.target.stacks[0],node('wait',{val:10})]],events:[{hat:node('whenColor',{port:'C',color:'red'}),body:[node('stopMove')]}]});s.advance(3);assert.equal(evaluateChallenge(c,s,obs).success,false);
});
