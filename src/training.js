import {areaSampler,SURFACE_RGB} from './sensor-sampling.js';
import {FW,FH} from './field.js';
import {Sim, normalizeConfig} from './sim.js';
import {emptyProgram, node, lit} from './blocks.js';

const pose = {x:600,y:300,h:0};
export const CHALLENGES = [
  {id:'target',level:'1 · Foundations',title:'Drive to a target',goal:'Stop the axle within 2 cm of the target, 40 cm ahead. Finish within 20 simulation seconds.',start:pose,target:[600,700],limit:20,
    hints:['Use a measured move and let it finish.','One wheel rotation travels π × wheel diameter. The default 56 mm wheel travels about 17.6 cm.','Try move forward for 40 cm. Motor degrees measure shaft rotation, not distance or chassis heading.']},
  {id:'heading',level:'1 · Foundations',title:'Turn to a heading',goal:'Turn clockwise to 90° ±5° and stop within 5 cm of the starting axle position, within 20 seconds.',start:pose,target:[600,300],limit:20,
    hints:['Watch the existing yaw readout while turning. Start yaw is zero.','Motor degrees and chassis heading are different. With equal opposite wheel travel, heading change = wheel degrees × wheel diameter ÷ wheel spacing.','With the default 56 mm wheels and 112 mm track, an in-place 90° turn needs 180 motor degrees. Or turn until yaw reaches 90°, then stop.']},
  {id:'line',level:'2 · Sensors',title:'Stop on a black line',goal:'Drive forward and stop with the color sensor on the black strip, within 20 seconds. The strip is 2 cm wide.',start:pose,line:[[350,700],[850,700]],width:20,limit:20,
    hints:['The color sensor is ahead of the axle. Watch its circle on the mat.','Start moving, wait until the color sensor sees black, then stop movement.','Use port C for the default color sensor. A slower movement speed gives a smaller overshoot.']},
  {id:'obstacle',level:'2 · Sensors',title:'Stop before an obstacle',goal:'Stop facing the obstacle with a sensor gap of 10–20 cm, after driving at least 20 cm. Do not collide. Finish within 20 seconds.',start:pose,objects:[{name:'Training obstacle',x:600,y:900,w:400,h:40,r:0}],limit:20,
    hints:['Distance is measured from the sensor, not the axle or wheels.','Start moving, wait until distance is less than a chosen gap, then stop.','Try port D, distance below 15 cm, and a moderate speed. The beam marks the measured gap.']},
  {id:'follow',level:'3 · Feedback',title:'Follow a bending line',goal:'Follow the line to the finish, then stop with the color sensor within 5 cm of the finish. Stay within 3 cm of the line for at least 90% of sampled driving time; finish within 30 seconds.',start:pose,line:[[600,370],[600,520],[690,650],[690,820]],width:24,target:[690,820],limit:30,
    hints:['A repeated sensor decision can correct drift. Begin near one edge of the line.','Use reflection to choose a small left or right steering correction. The field uses 8% black and 90% white.','Slow down and use a repeat loop: steer one way on black and the other on white. Use distance traveled or a timer to stop near the finish.']}
];
export function challenge(id) { const c=CHALLENGES.find(c=>c.id===id); if(!c)throw Error('Choose a supported training challenge.');return c; }
export function lineDistance(p, points) {
  let d=Infinity;
  for(let i=1;i<points.length;i++) {const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));d=Math.min(d,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy));}
  return d;
}
export function trainingScene(c) { return {objects:c.objects||[],sample:areaSampler(p=>{const black=c.line && lineDistance(p,c.line)<=c.width/2;return {rgb:SURFACE_RGB[black?'black':'white'],reflect:black?8:90};},FW,FH)}; }
export function configureChallenge(sim,c,variation=null) {
  sim.scene=trainingScene(c);sim.variation=variation;sim.matchOn=false;sim.start={...c.start};sim.reset();
}
export function observeChallenge(c,sim,observation={samples:0,onLine:0,collision:false},dt=.004) {
  observation.collision ||= !!sim.hit;
  const still = !sim.driveAction && !Object.keys(sim.motorActions).length && !Object.keys(sim.motorRun).length &&
    !(sim.drive?.L || sim.drive?.R) && !(sim.vel?.L || sim.vel?.R);
  observation.settled = still ? (observation.settled || 0) + dt : 0;
  if(c.id==='follow' && sim.driveSpeedPct()>0) {observation.samples++;if(lineDistance(sim.sens.spot,c.line)<=30)observation.onLine++;}
  return observation;
}
export function evaluateChallenge(c,sim,observation={},reason='finished') {
  const p=sim.pose,s=sim.sens,stopped=!sim.running || (sim.threads.every(t=>t.done||t.stopped) && (observation.settled||0)>=.3),drift=Math.hypot(p.x-c.start.x,p.y-c.start.y),heading=Math.abs((((p.h-90+180)%360)+360)%360-180);
  let value,pass,feedback;
  if(c.id==='target') {value=Math.hypot(p.x-c.target[0],p.y-c.target[1]);pass=value<=20;feedback=`Axle ${ (value/10).toFixed(1)} cm from target (goal ≤2 cm).`;}
  if(c.id==='heading') {pass=heading<=5&&drift<=50;feedback=`Heading error ${heading.toFixed(1)}° (goal ≤5°); axle drift ${(drift/10).toFixed(1)} cm (goal ≤5 cm).`;}
  if(c.id==='line') {value=lineDistance(s.spot,c.line);pass=value<=c.width/2&&p.y>c.start.y+200;feedback=`Color sensor ${s.color}; ${(value/10).toFixed(1)} cm from strip center (goal ≤1 cm).`;}
  if(c.id==='obstacle') {pass=s.dist!==null&&s.dist>=10&&s.dist<=20&&drift>=200&&Math.abs((((p.h+180)%360)+360)%360-180)<=10;feedback=`Sensor gap ${s.dist===null?'out of range':s.dist.toFixed(1)+' cm'} (goal 10–20 cm); travel ${(drift/10).toFixed(1)} cm (goal ≥20 cm).`;}
  if(c.id==='follow') {value=Math.hypot(s.spot[0]-c.target[0],s.spot[1]-c.target[1]);const fraction=observation.samples?observation.onLine/observation.samples:0;pass=value<=50&&fraction>=.9&&observation.samples>10;feedback=`Sensor ${(value/10).toFixed(1)} cm from finish (goal ≤5 cm); near line ${(fraction*100).toFixed(0)}% of driving samples (goal ≥90%).`;}
  const complete=reason==='finished' && stopped && sim.t<=c.limit+1e-6;
  return {success:!!pass&&complete&&!observation.collision&&!sim.runError,feedback:`${feedback} ${observation.collision?'Collision recorded. ':''}${sim.runError?'Program failed: '+sim.runError:reason==='timeout'?'Time limit reached.':reason==='interrupted'?'Run interrupted; not scored as a success.':!stopped?'Stop to finish.':''}`.trim(),time:sim.t};
}
export function starterProgram() {const p=emptyProgram();p.stacks=[[node('speed',{pct:lit(30)})]];return p;}

// Uniform, independent draws with an explicit integer seed. Fixed biases apply
// to every trial; jitter is drawn once per trial, not per renderer/sensor read.
export function seededRandom(seed) {let n=seed>>>0;return ()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
export const ZERO_VARIATION={xy:0,heading:0,leftBias:0,rightBias:0,wheelJitter:0,reflection:0,distance:0};
export function validateVariation(input) {
  const v={...ZERO_VARIATION,...input};
  for(const [k,max] of Object.entries({xy:50,heading:10,leftBias:10,rightBias:10,wheelJitter:5,reflection:20,distance:30})) {
    if(!Number.isFinite(v[k])||Math.abs(v[k])>max||(!k.endsWith('Bias')&&v[k]<0))throw Error(`Invalid ${k} variation.`);
  }
  return v;
}
export function trialParameters(c,seed,index,input) {
  const v=validateVariation(input),random=seededRandom((seed>>>0)+Math.imul(index+1,0x9E3779B9)),j=n=>((random()*2-1)*n)||0;
  return {start:{x:c.start.x+j(v.xy),y:c.start.y+j(v.xy),h:c.start.h+j(v.heading)},variation:{leftTravel:1+(v.leftBias+j(v.wheelJitter))/100,rightTravel:1+(v.rightBias+j(v.wheelJitter))/100,reflect:j(v.reflection),distanceMm:j(v.distance)},random};
}
export function* reliabilityTrials({id,program,cfg,seed=1,variation=ZERO_VARIATION}) {
  const c=challenge(id);validateVariation(variation);
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('Seed must be an integer from 0 to 4294967295.');
  // Trial Sim instances never touch the editor, foreground robot or library.
  for(let i=0;i<20;i++) {
    const setup=trialParameters(c,seed,i,variation),sim=new Sim(normalizeConfig(cfg),setup.start,[]);
    configureChallenge(sim,c,setup.variation);sim.start=setup.start;sim.random=setup.random;sim.run(program);
    const observed={samples:0,onLine:0,collision:false};let ticks=0;sim.onStep=dt=>observeChallenge(c,sim,observed,dt);
    while(sim.running&&sim.t<c.limit) {sim.advance(.02);if(sim.running && evaluateChallenge(c,sim,observed).success)sim.finish('Challenge complete: stopped with idle event listeners.');if(++ticks%100===0)yield {kind:'progress',index:i,time:sim.t};}
    const result=evaluateChallenge(c,sim,observed,sim.running?'timeout':'finished');
    yield {kind:'result',index:i,...result,path:[[setup.start.x,setup.start.y],...sim.trail,[sim.pose.x,sim.pose.y]],setup:{start:setup.start,variation:setup.variation}};
  }
}
