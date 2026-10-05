// Dependency-free, orthographic 3D schematic. The simulator owns all robot state.
// x = robot right, y = robot front, z = up; millimetres except schematic heights.
import { armGeom, DIR_ANGLE } from './sim.js';

const rad = d => d * Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const escape = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const DEFAULT_CAMERA = Object.freeze({ azimuth: -35, elevation: 28 });
export function orbitCamera(camera, dx, dy) {
  return { azimuth: camera.azimuth + dx * .5, elevation: clamp(camera.elevation + dy * .35, 8, 85) };
}

// Hoop coordinates rotate about the transverse axle, using the simulator's
// clamped lift angle (including direction and gearing), never an independent animation.
export function armLocalPoint(arm, p) {
  const [x,y,z]=arm.pivot, a=rad(arm.geometry.ang), t=rad(arm.lift?arm.geometry.tilt:0);
  return [x+p[0]*Math.cos(a)+(p[1]*Math.cos(t)-p[2]*Math.sin(t))*Math.sin(a),
    y-p[0]*Math.sin(a)+(p[1]*Math.cos(t)-p[2]*Math.sin(t))*Math.cos(a),z+p[1]*Math.sin(t)+p[2]*Math.cos(t)];
}

export function robotScene(sim) {
  const cfg = sim.cfg, r = cfg.wheel / 2, deck = Math.max(12, r * .65) + 20;
  const pivotZ = deck + 26;
  const arms = (cfg.arms || []).map(arm => {
    const motor = sim.arms[arm.port] || 0, geometry = armGeom(arm, motor);
    const a = rad(geometry.ang), lift = arm.motion !== 'sweep';
    const pivot = [arm.x, arm.y, pivotZ];
    const tip = [arm.x + Math.sin(a) * geometry.proj, arm.y + Math.cos(a) * geometry.proj,
      pivotZ + (lift ? Math.sin(rad(geometry.tilt)) * arm.len : 0)];
    return { ...arm, motor, geometry, pivot, tip, lift,
      state: lift ? geometry.tilt < 1 ? 'Down' : geometry.tilt > 89 ? 'Up' : 'Partway' : 'Sweeping' };
  });
  const pair = String(sim.pair || cfg.pair);
  return { cfg, deck, pose: { ...sim.pose }, arms,
    wheels: [0, 1].map(i => ({ x: (i ? 1 : -1) * cfg.track / 2, angle: sim.arms[pair[i]] || 0, port: pair[i] })),
    matrix: sim.matrix || [], color: sim.sens?.color || 'none',
    status: sim.hit ? 'Touching an obstacle' : sim.running ? 'Running' : 'Stopped' };
}

// Projection also returns depth for painter-ordering the solid faces.
export function projectPoint(p, camera) {
  const a = rad(camera.azimuth), e = rad(camera.elevation);
  const depth = p[0] * Math.sin(a) + p[1] * Math.cos(a);
  return [p[0] * Math.cos(a) - p[1] * Math.sin(a), depth * Math.sin(e) - p[2] * Math.cos(e), depth * Math.cos(e) + p[2] * Math.sin(e)];
}

export function fitViewport(scene, width, height, camera) {
  width = Math.max(1, width); height = Math.max(1, height);
  const c = scene.cfg;
  const radius = Math.max(Math.hypot(c.robotW / 2, Math.max(c.axleBack, c.robotL - c.axleBack)), c.track / 2 + 16,
    Math.hypot(c.dist.x, c.dist.y) + 28, Math.hypot(c.color.x, c.color.y) + 15,
    ...scene.arms.map(a => Math.hypot(a.x, a.y) + a.len)) + 15;
  const high = Math.max(scene.deck + 114, ...scene.arms.map(a => a.pivot[2] + a.len + 8));
  // Fixed bounds for all arm angles and headings prevent zooming as the arm moves.
  const extentX = radius * 2, extentY = radius * 2 * Math.sin(rad(camera.elevation)) + high * Math.cos(rad(camera.elevation));
  const scale = Math.max(.001, Math.min((width - 32) / extentX, (height - 32) / extentY));
  return { width, height, scale, x: width / 2, y: height / 2 + high * Math.cos(rad(camera.elevation)) * scale / 2 };
}

export function renderRobot3D(scene, camera = DEFAULT_CAMERA, width = 700, height = 340) {
  const c = scene.cfg, view = fitViewport(scene, width, height, camera), faces = [];
  const h = rad(scene.pose.h), cs = Math.cos(h), sn = Math.sin(h);
  const world = ([x, y, z]) => [x * cs + y * sn, -x * sn + y * cs, z];
  const screen = p => { const q = projectPoint(p, camera); return [view.x + q[0] * view.scale, view.y + q[1] * view.scale, q[2]]; };
  const point = p => screen(world(p));
  const points = ps => ps.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  const face = (ps, fill, stroke = '#10221b', label = '', decals = []) => {
    const q = ps.map(point); faces.push({ depth: q.reduce((s, p) => s + p[2], 0) / q.length,
      markup: `<polygon points="${points(q)}" fill="${fill}" stroke="${stroke}" stroke-width="1" stroke-linejoin="round"${label ? ` data-part="${escape(label)}"` : ''}/>` + decals.map(d => `<polygon points="${points(d.points.map(point))}" fill="${d.fill}" stroke="#34443c" stroke-width=".5"/>`).join('') });
  };
  const box = (x, y, z, w, l, ht, color, label = '', transform = p => p, decals = {}) => {
    const vertices = [[x-w/2,y-l/2,z],[x+w/2,y-l/2,z],[x+w/2,y+l/2,z],[x-w/2,y+l/2,z],
      [x-w/2,y-l/2,z+ht],[x+w/2,y-l/2,z+ht],[x+w/2,y+l/2,z+ht],[x-w/2,y+l/2,z+ht]].map(transform);
    [[0,1,2,3],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0],[4,7,6,5]].forEach((f,i) => {
      face(f.map(k => vertices[k]), color[i % color.length], '#10221b', label, (decals[i] || []).map(d => ({ ...d, points:d.points.map(transform) })));
    });
  };
  const line = (a, b, color, thickness = 2, label = '') => {
    const q = point(a), r = point(b);
    faces.push({ depth: (q[2] + r[2]) / 2 + .05, markup: `<line x1="${q[0]}" y1="${q[1]}" x2="${r[0]}" y2="${r[1]}" stroke="${color}" stroke-width="${Math.max(1,thickness*view.scale)}" stroke-linecap="round"${label ? ` data-part="${escape(label)}"` : ''}/>` });
  };
  const circle = (center, radius, plane='xy', count=16) => Array.from({length:count},(_,i)=>{
    const a=i*Math.PI*2/count,p=[...center],axes=plane==='xy'?[0,1]:plane==='xz'?[0,2]:[1,2];
    p[axes[0]]+=Math.cos(a)*radius;p[axes[1]]+=Math.sin(a)*radius;return p;
  });
  const cylinder = (x, y, z, radius, thick, angle = 0, label = '') => {
    const ring = side => Array.from({length:20},(_,i) => [x+side*thick/2,y+Math.cos(i*Math.PI/10)*radius,z+Math.sin(i*Math.PI/10)*radius]);
    const a=ring(-1), b=ring(1);
    for(let i=0;i<20;i++) face([a[i],a[(i+1)%20],b[(i+1)%20],b[i]], i%2 ? '#66bbd4' : '#73c8df', '#417e90', label);
    for(const side of [-1,1]) {
      const xx=x+side*thick/2,decals=[{points:circle([xx,y,z],radius*.82,'yz'),fill:'#252a2e'}];
      for(let j=0;j<3;j++) {
        const t=rad(angle+j*120),r1=radius*.22,r2=radius*.72;
        decals.push({points:[[xx,y+Math.cos(t-.18)*r1,z+Math.sin(t-.18)*r1],[xx,y+Math.cos(t-.14)*r2,z+Math.sin(t-.14)*r2],
          [xx,y+Math.cos(t+.14)*r2,z+Math.sin(t+.14)*r2],[xx,y+Math.cos(t+.18)*r1,z+Math.sin(t+.18)*r1]],fill:'#e7ebed'});
      }
      decals.push({points:circle([xx,y,z],radius*.16,'yz'),fill:'#f7c625'});
      face(side<0?a:b,'#73c8df','#417e90',label,decals);
    }
  };
  const white=['#b9c5cd','#e2e8eb','#f5f7f8'],blue=['#2487a8','#58b6d2','#71c9e0'],black=['#202428','#373e42','#4b545a'],pink=['#783463','#ad418e','#ca57a7'];
  const bodyMid=(c.robotL-2*c.axleBack)/2,sx=c.robotW/160,sy=c.robotL/200,deck=scene.deck;
  // LEGO's Practice Driving Base: an open 7×11 frame, two angular motors,
  // longitudinal 15L beams and the yellow hub with its white control face.
  const beam=(x,y,z,w,l,ht,colors,label,transform=p=>p)=>{
    const holes=[];for(let yy=y-l/2+4;yy<y+l/2;yy+=8)holes.push({points:circle([x,yy,z+ht],Math.min(2.7,w*.32)),fill:'#182127'});
    box(x,y,z,w,l,ht,colors,label,transform,{0:holes.map(d=>({...d,points:d.points.map(p=>[p[0],p[1],z])})),5:holes});
  };
  for(const side of [-1,1]) {
    beam(side*24*sx,bodyMid,12,8*sx,88*sy,8,pink,'7×11 frame');
    box(side*27*sx,bodyMid,17,27*sx,64*sy,24,blue,'medium drive motor');
    box(side*27*sx,bodyMid+17*sy,36,27*sx,30*sy,8,white,'drive motor cover');
    beam(side*40*sx,bodyMid,deck+4,8*sx,120*sy,8,black,'15L side beam');
  }
  for(const end of [-1,1])box(0,bodyMid+end*40*sy,12,56*sx,8*sy,8,pink,'7×11 frame');
  for(const side of [-1,1])for(const end of [-1,1])box(side*22*sx,bodyMid-14*sy+end*32*sy,deck+3,8,8,8,blue,'hub mounting pin');
  box(0,bodyMid+44*sy,deck+4,88*sx,8,8,white,'front mounting beam');
  box(0,bodyMid-14*sy,deck+10,56*sx,96*sy,28,['#c28d08','#f1ba12','#ffda38'],'hub');
  const top=deck+44,hubY=bodyMid-14*sy,pixels=[];
  for(let row=0;row<5;row++) for(let col=0;col<5;col++) {
    const on=(scene.matrix[row*5+col]||0)>0,x=(col-2)*5*sx,y=hubY+(2-row)*5*sy;
    pixels.push({points:circle([x,y,top],1.1),fill:on?'#ffcc4a':'#d5dce0'});
  }
  pixels.push({points:circle([0,hubY-30*sy,top],8),fill:'#cbd7df'}, {points:circle([-17*sx,hubY+34*sy,top],3.5),fill:'#bccbd4'});
  for(const sign of [-1,1])pixels.push({points:[[sign*14*sx,hubY-30*sy,top],[sign*19*sx,hubY-33*sy,top],[sign*19*sx,hubY-27*sy,top]],fill:'#7c929f'});
  for(const x of [-23,23])for(const y of [-41,41])pixels.push({points:circle([x*sx,hubY+y*sy,top],3),fill:'#81929b'});
  box(0,hubY,deck+38,56*sx,96*sy,6,white,'hub face',p=>p,{5:pixels});
  for(const side of [-1,1])for(let i=0;i<3;i++)box(side*29*sx,hubY+(i-1)*24*sy,deck+29,5,13,8,['#4a5054','#171d20'],'hub port');
  for(const wheel of scene.wheels)cylinder(wheel.x,0,c.wheel/2,c.wheel/2,16,wheel.angle,'wheel '+wheel.port);
  // Rear ball caster, tucked beneath the back of the frame.
  const casterY=bodyMid-62*sy;
  box(0,casterY,13,24,20,14,blue,'rear caster mount');
  for(let j=0;j<8;j++)for(let i=0;i<16;i++){
    const ball=(u,v)=>[9.5*Math.sin(u)*Math.cos(v),casterY+9.5*Math.sin(u)*Math.sin(v),9.5+9.5*Math.cos(u)];
    face([ball(j*Math.PI/8,i*Math.PI/8),ball((j+1)*Math.PI/8,i*Math.PI/8),ball((j+1)*Math.PI/8,(i+1)*Math.PI/8),ball(j*Math.PI/8,(i+1)*Math.PI/8)],j<4?'#edf2f3':'#b9c6ce','#a4b6bf','rear ball caster');
  }
  // Color sensor face points at the mat; its white housing is on a low bracket.
  beam(c.color.x,c.color.y-12,20,8,40,8,white,'color sensor bracket');
  box(c.color.x,c.color.y,7,24,24,15,white,'color sensor',p=>p,{0:[{points:circle([c.color.x,c.color.y,7],6),fill:'#152433'},{points:circle([c.color.x,c.color.y,7],3),fill:'#81d7f1'}]});
  box(c.color.x,c.color.y-5,22,24,13,5,black,'color sensor top');
  const sensorAngle=rad(DIR_ANGLE[c.dist.dir]||0);
  const orient=p=>[c.dist.x+p[0]*Math.cos(sensorAngle)+p[1]*Math.sin(sensorAngle),c.dist.y-p[0]*Math.sin(sensorAngle)+p[1]*Math.cos(sensorAngle),p[2]];
  // Extend the mount back to the hub for the configured sensor position.
  const mountReach=Math.max(56,Math.hypot(c.dist.x,c.dist.y-bodyMid)-20);
  beam(0,(-mountReach+3)/2,deck+44,8,mountReach+3,8,white,'distance sensor support',orient);
  box(0,-12,deck+52,24,16,8,blue,'distance sensor mount',orient);
  box(0,-12,deck+60,24,24,52,white,'distance sensor',orient);
  const eyes=[];
  for(const z of [deck+73,deck+100])eyes.push({points:circle([0,.15,z],8,'xz'),fill:'#91a3af'}, {points:circle([0,.15,z],5.7,'xz'),fill:'#26333b'});
  box(0,-.5,deck+62,22,1,50,black,'distance sensor eyes',orient,{3:eyes});
  for(const arm of scene.arms) {
    const [x,y,z]=arm.pivot,angle=rad(arm.geometry.ang),moving=p=>armLocalPoint(arm,p);
    const fixed=p=>[x+p[0]*Math.cos(angle)+p[1]*Math.sin(angle),y-p[0]*Math.sin(angle)+p[1]*Math.cos(angle),z+p[2]];
    box(0,-23,-36,40,42,22,blue,'large arm motor '+arm.port,fixed);
    box(0,-23,-14,40,42,6,white,'arm motor cover',fixed);
    for(const side of [-1,1]) {
      beam(side*22,0,-24,8,8,32,pink,'5L bearing beam',fixed);
      box(side*22,4,-16,8,8,24,blue,'3×5 bearing bracket',fixed);
    }
    box(0,4,2,52,8,8,blue,'bearing cross beam',fixed);
    line(fixed([-32,0,0]),fixed([32,0,0]),'#edc32b',5,'pivot axle');
    // Perpendicular 12-tooth bevel gears. Their centers stay fixed as the hoop lifts.
    // Transform the gears through the mount orientation, independent of hoop lift.
    const gearAt=(center,axis,turn,label)=>{
      const ring=side=>Array.from({length:48},(_,i)=>{
        const t=rad(turn)+i*Math.PI/24,r=i%4<2?8:6.5,p=[...center];
        if(axis==='x'){p[0]+=side*2;p[1]+=Math.cos(t)*r;p[2]+=Math.sin(t)*r;}
        else{p[2]+=side*2;p[0]+=Math.cos(t)*r;p[1]+=Math.sin(t)*r;}return fixed(p);
      });
      const a=ring(-1),b=ring(1);for(let i=0;i<48;i++)face([a[i],a[(i+1)%48],b[(i+1)%48],b[i]],i%2?'#7a878f':'#aeb8bf','#59656d',label);
      face(a,'#8a969e','#53616b',label);face(b,'#c4cbd0','#53616b',label);
    };
    gearAt([0,-8,-6],'z',arm.motor,'12T motor bevel gear');
    gearAt([0,0,0],'x',arm.geometry.tilt,'12T hoop bevel gear');
    // Two bent 3×7-style side beams and their grey cross axle form an open hoop.
    const half=Math.max(18,Math.min(32,arm.len*.32)),bend=arm.len*.16;
    for(const side of [-1,1]) {
      beam(side*half,arm.len*.35,-4,8,arm.len*.7,8,black,'hoop side '+arm.port,moving);
      const a=[side*half,arm.len*.7,0],b=[side*half,arm.len*.87,-bend];
      line(moving(a),moving(b),'#4b545a',8,'hoop bend '+arm.port);
      beam(side*half,arm.len*.935,-bend-4,8,arm.len*.13,8,black,'hoop end '+arm.port,moving);
      box(side*(half+1),arm.len,-bend-4,8,10,8,white,'axle connector',moving);
    }
    line(moving([-half-8,arm.len,-bend]),moving([half+8,arm.len,-bend]),'#b6c1c8',5,'hoop cross axle '+arm.port);
    line(moving([-half-8,arm.len,-bend-1]),moving([half+8,arm.len,-bend-1]),'#606e78',1,'axle groove');
  }
  const ground=[];const r=190;
  for(let i=-240;i<=240;i+=40) {
    const ox=((scene.pose.x%40)+40)%40,oy=((scene.pose.y%40)+40)%40;
    for(const [a,b] of [[[i-ox,-r,0],[i-ox,r,0]],[[-r,i-oy,0],[r,i-oy,0]]]) {
      const p=screen(a),q=screen(b);ground.push(`<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="#28453a" stroke-width="1"/>`);
    }
  }
  const frontLabel=point([c.robotW*.85,c.robotL-c.axleBack+22,0]);
  const markup=`<g aria-hidden="true">${ground.join('')}${faces.sort((a,b)=>a.depth-b.depth).map(f=>f.markup).join('')}<text x="${frontLabel[0]}" y="${frontLabel[1]+14}" text-anchor="middle" fill="#9bddc2" font-size="11" font-family="system-ui">FRONT</text></g>`;
  return { markup, view, armText: scene.arms.length ? scene.arms.map(a => `${a.port} · ${a.state} · ${a.lift ? `lift ${Math.round(a.geometry.tilt)}°` : `sweep ${Math.round(a.geometry.ang)}°`} · motor ${Math.round(a.motor)}°`).join('   |   ') : 'No arms configured — add one in the Robot tab.',
    poseText: `${scene.status} · x ${(scene.pose.x/10).toFixed(1)} cm · y ${(scene.pose.y/10).toFixed(1)} cm · heading ${Math.round(((scene.pose.h%360)+360)%360)}°` };
}

export function createRobot3D(panel, sim, options = {}) {
  const svg=panel.querySelector('svg'), armReadout=panel.querySelector('[data-arm-state]'), poseReadout=panel.querySelector('[data-robot-pose]');
  let camera={...DEFAULT_CAMERA}, previous='', drag=null;
  const render=()=>{
    const rect=svg.getBoundingClientRect(), width=rect.width||700,height=rect.height||340;
    const scene=robotScene(sim), key=JSON.stringify([scene,camera,width,height]);
    if(key===previous)return;
    previous=key;
    const result=renderRobot3D(scene,camera,width,height);
    svg.setAttribute('viewBox',`0 0 ${width} ${height}`);svg.innerHTML=result.markup;
    armReadout.textContent=result.armText;poseReadout.textContent=result.poseText;
    svg.setAttribute('aria-label',`3D schematic. ${result.armText}. ${result.poseText}. Use arrow keys to orbit.`);
  };
  const setView=event=>{
    const button=event.target.closest('[data-view]');if(!button)return;
    const view=button.dataset.view;
    camera=view==='side'?{azimuth:90+sim.pose.h,elevation:12}:view==='top'?{azimuth:0,elevation:85}:{...DEFAULT_CAMERA};
    render();
  };
  const down=e=>{if(e.button!==undefined&&e.button!==0)return;drag={x:e.clientX,y:e.clientY,id:e.pointerId};svg.setPointerCapture?.(e.pointerId);};
  const move=e=>{if(!drag||drag.id!==e.pointerId)return;camera=orbitCamera(camera,e.clientX-drag.x,e.clientY-drag.y);drag={x:e.clientX,y:e.clientY,id:e.pointerId};render();};
  const up=()=>{drag=null;};
  const key=e=>{const delta={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,20],ArrowDown:[0,-20]}[e.key];if(!delta)return;e.preventDefault();camera=orbitCamera(camera,...delta);render();};
  panel.addEventListener('click',setView);svg.addEventListener('pointerdown',down);svg.addEventListener('pointermove',move);svg.addEventListener('pointerup',up);svg.addEventListener('pointercancel',up);svg.addEventListener('lostpointercapture',up);svg.addEventListener('keydown',key);
  const Observer=options.ResizeObserver??globalThis.ResizeObserver;
  const observer=Observer?new Observer(render):null;observer?.observe(svg);
  render();
  return { update:render, resetView:()=>{camera={...DEFAULT_CAMERA};render();}, destroy:()=>{
    observer?.disconnect();panel.removeEventListener('click',setView);
    for(const [name,fn] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['lostpointercapture',up],['keydown',key]])svg.removeEventListener(name,fn);
  } };
}
