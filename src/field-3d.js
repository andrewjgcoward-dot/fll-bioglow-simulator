import * as THREE from '../vendor/three/build/three.module.js';
import { OrbitControls } from '../vendor/three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { openBundledModels } from './bundled-models.js';
import { FW, FH, LINES, HOME_R } from './field.js';
import { robotScene, robotMeshData } from './robot-3d.js';
import { inspectPackZip, readPackEntry, validatePackManifest, validatePackGlb } from './model-pack.js';

const radians = n => n * Math.PI / 180;
export const toFieldWorld = (x, y, height = 0) => [x, height, -y];
const toRobotWorld = p => [p[0], p[2], -p[1]];
const colorCache = new Map();
function rgb(hex) { if (!colorCache.has(hex)) colorCache.set(hex, new THREE.Color(hex).toArray()); return colorCache.get(hex); }
function disposeGroup(group, keep = null) {
  const geometries = new Set(), materials = new Set();
  group.traverse(o => { if (o.geometry) geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) materials.add(m); });
  for (const g of geometries) if (!keep?.geometries.has(g)) g.dispose();
  for (const m of materials) if (!keep?.materials.has(m)) m.dispose();
}
function resources(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse(o => { if (o.geometry) geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) materials.add(m); });
  return { geometries, materials };
}
function makeRobotGeometry(data) {
  const buckets = [{ p: [], c: [] }, { p: [], c: [] }];
  const polygon = (points, color, decal = false) => {
    if (points.length < 3) return;
    const bucket = buckets[decal ? 1 : 0], centre = [0,0,0];
    for (const p of points) for (let i=0;i<3;i++) centre[i] += p[i] / points.length;
    const value = rgb(color);
    for (let i=0;i<points.length;i++) for (const p of [centre,points[i],points[(i+1)%points.length]]) { bucket.p.push(...toRobotWorld(p)); bucket.c.push(...value); }
  };
  for (const p of data.polygons) polygon(p.points,p.color,p.decal);
  for (const line of data.segments) {
    const a = new THREE.Vector3(...line.a), b = new THREE.Vector3(...line.b), direction = b.clone().sub(a).normalize();
    const side = new THREE.Vector3().crossVectors(direction, Math.abs(direction.z) < .9 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(1,0,0)).normalize();
    const up = new THREE.Vector3().crossVectors(direction,side), ring = centre => Array.from({length:8},(_,i)=>centre.clone().addScaledVector(side,Math.cos(i*Math.PI/4)*line.thickness/2).addScaledVector(up,Math.sin(i*Math.PI/4)*line.thickness/2).toArray());
    const x=ring(a),y=ring(b);for(let i=0;i<8;i++)polygon([x[i],x[(i+1)%8],y[(i+1)%8],y[i]],line.color);
    polygon(x,line.color);polygon(y,line.color);
  }
  return buckets.map(b=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(b.c,3));g.computeVertexNormals();return g;});
}

function plainMat() {
  const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=1143;
  const c=canvas.getContext('2d');c.fillStyle='#365f42';c.fillRect(0,0,FW,FH);
  c.fillStyle='#f2f1e9';
  for(const x of [0,FW]){c.beginPath();c.moveTo(x,FH);c.arc(x,FH,HOME_R,Math.PI,Math.PI*2);c.fill();}
  c.strokeStyle='#111';c.lineWidth=20;c.lineCap='round';c.lineJoin='round';
  for(const line of LINES){c.beginPath();line.forEach(([x,y],i)=>i?c.lineTo(x,FH-y):c.moveTo(x,FH-y));c.stroke();}
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;return t;
}

export function createField3D(panel, sim, options = {}) {
  const mount=panel.querySelector('[data-field-canvas]'),status=panel.querySelector('[data-pack-status]'),input=panel.querySelector('[data-model-file]');
  const retryButton=panel.querySelector('[data-pack-retry]');
  const cancelButton=panel.querySelector('[data-pack-cancel]'),unloadButton=panel.querySelector('[data-pack-unload]'),followButton=panel.querySelector('[data-camera="follow"]');
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'default'});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setClearColor('#182b27');renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('role','img');renderer.domElement.setAttribute('aria-label','3D BIOGLOW field. Drag to orbit, scroll or pinch to zoom. Camera buttons offer fixed views.');mount.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(43,1,5,14000),controls=new OrbitControls(camera,renderer.domElement);
  controls.minDistance=180;controls.maxDistance=5200;controls.maxPolarAngle=Math.PI*.485;controls.enableDamping=false;controls.screenSpacePanning=false;
  scene.add(new THREE.HemisphereLight('#f5f7ff','#7c745a',2.2));const sun=new THREE.DirectionalLight('#fff6de',2.6);sun.position.set(300,1800,700);scene.add(sun);
  const plain=plainMat(),matMaterial=new THREE.MeshStandardMaterial({map:plain,roughness:1});
  const mat=new THREE.Mesh(new THREE.PlaneGeometry(FW,FH),matMaterial);mat.rotation.x=-Math.PI/2;mat.position.set(FW/2,0,-FH/2);scene.add(mat);
  const table=new THREE.Mesh(new THREE.BoxGeometry(FW+26,28,FH+26),new THREE.MeshStandardMaterial({color:'#544934',roughness:1}));table.position.set(FW/2,-16,-FH/2);scene.add(table);
  let photo=null,matMode='',destroyed=false,dirty=true,visible=true,follow=false,lastRender=0,lastRobotBuild=0,robotKey='',robotPending=true,activeController=null,modelGroup=null,modelPlacements=[],loadedName='',generation=0,pendingModelFrame=false;
  new THREE.TextureLoader().load('assets/mat.jpg',t=>{if(destroyed){t.dispose();return;}photo=t;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());matMode='';dirty=true;},undefined,()=>{status.textContent='Mat photo unavailable; showing the plain mat. The mission models can still load.';});
  const robot=new THREE.Group();scene.add(robot);
  const robotMaterials=[new THREE.MeshStandardMaterial({vertexColors:true,roughness:.82,side:THREE.DoubleSide}),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1})];
  const robotMeshes=robotMaterials.map(m=>{const mesh=new THREE.Mesh(new THREE.BufferGeometry(),m);robot.add(mesh);return mesh;});
  const loose=new Map(),looseMaterial=new THREE.MeshStandardMaterial({color:'#b18be6',roughness:.8}),looseGeometry=new THREE.BoxGeometry(1,1,1);
  let lastPose=new THREE.Vector3(sim.pose.x,70,-sim.pose.y);
  const setFollow=value=>{follow=value;followButton.setAttribute('aria-pressed',String(value));};
  const focusRobot=()=>{setFollow(false);controls.target.set(sim.pose.x,70,-sim.pose.y);camera.position.copy(controls.target).add(new THREE.Vector3(430,420,550));controls.update();dirty=true;};
  const resetCamera=()=>{setFollow(false);controls.target.set(FW/2,30,-FH/2);camera.position.set(FW/2,1700,1200);controls.update();dirty=true;};
  const onView=e=>{const button=e.target.closest('[data-camera]');if(!button)return;
    switch(button.dataset.camera){
      case 'reset':resetCamera();break;
      case 'robot':focusRobot();break;
      case 'top':setFollow(false);controls.target.set(FW/2,0,-FH/2);camera.position.set(FW/2,2400,-FH/2+1);controls.update();dirty=true;break;
      case 'follow':if(follow)setFollow(false);else{focusRobot();setFollow(true);}break;
    }
  };
  panel.addEventListener('click',onView);controls.addEventListener('change',()=>{dirty=true;});resetCamera();
  const resize=()=>{const {width,height}=mount.getBoundingClientRect();if(width<1||height<1)return;camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height,false);dirty=true;};
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(mount);resize();
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)dirty=true;},{rootMargin:'100px'});intersection.observe(mount);
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();status.textContent='Graphics paused by the browser. Waiting for recovery; 2D simulation still works.';});
  renderer.domElement.addEventListener('webglcontextrestored',()=>{dirty=true;status.textContent=loadedName?`${loadedName} loaded. Mission mechanisms are static.`:'Graphics restored.';});

  function clearModels() {
    if(modelGroup){scene.remove(modelGroup);disposeGroup(modelGroup);modelGroup=null;}
    modelPlacements=[];loadedName='';unloadButton.disabled=true;dirty=true;renderer.renderLists.dispose();
    panel.dataset.packState='empty';delete panel.dataset.modelCount;delete panel.dataset.triangles;delete panel.dataset.placementCount;delete panel.dataset.modelSource;
  }
  function cancelLoad() { activeController?.abort();activeController=null;generation++;cancelButton.hidden=true;retryButton.hidden=false; }
  const unload=()=>{cancelLoad();clearModels();status.textContent='Models unloaded. Load bundled models to show them again, or choose a local ZIP.';input.value='';};
  cancelButton.addEventListener('click',()=>{cancelLoad();panel.dataset.packState=modelGroup?'loaded':'empty';status.textContent='Loading cancelled. Load bundled models to try again, or choose a local ZIP.';});unloadButton.addEventListener('click',unload);
  const loadPack=file=>loadModels(file);
  function loadBundled() {
    if (activeController || panel.dataset.modelSource === 'bundled') return Promise.resolve();
    return loadModels();
  }
  retryButton.addEventListener('click',loadBundled);
  async function loadModels(file) {
    if(destroyed)return;
    cancelLoad();const ownGeneration=++generation,controller=new AbortController();activeController=controller;cancelButton.hidden=false;retryButton.hidden=true;panel.dataset.packState='loading';
    const staging=new THREE.Group(),sources=[];let stagedPlacements=[],bundledSource=null;
    const stillCurrent=()=>{if(controller.signal.aborted||generation!==ownGeneration)throw new DOMException('Loading cancelled.','AbortError');};
    try {
      status.textContent=file?'Checking local model pack…':'Loading bundled model list…';
      let manifest,readAsset;
      if(file){
        const entries=await inspectPackZip(file,controller.signal);
        const raw=await readPackEntry(file,entries.get('manifest.json'),{signal:controller.signal});
        manifest=validatePackManifest(JSON.parse(new TextDecoder().decode(raw)),entries);
        readAsset=asset=>readPackEntry(file,entries.get(asset.file),{signal:controller.signal});
      }else{
        bundledSource=await (options.openBundledModels||openBundledModels)(controller.signal);
        manifest=bundledSource.manifest;readAsset=bundledSource.read;
      }
      stillCurrent();
      clearModels();panel.dataset.packState='loading'; // release the previous pack before allocating a replacement on mobile
      const manager=new THREE.LoadingManager();manager.setURLModifier(()=>{throw new Error('External model resources are not allowed.');});
      const loader=new GLTFLoader(manager);
      let triangles=0,renderedTriangles=0,renderedMeshes=0;
      for(let index=0;index<manifest.assets.length;index++) {
        const asset=manifest.assets[index];status.textContent=`Loading ${index+1} of ${manifest.assets.length} · ${asset.id}…`;
        const bytes=await readAsset(asset,(received,progress)=>{if(generation===ownGeneration)status.textContent=progress?.phase==='prepare'?`Preparing ${index+1} of ${manifest.assets.length} · ${asset.id}…`:`Loading ${index+1} of ${manifest.assets.length} · ${asset.id} · ${Math.round(received/asset.bytes*100)}%…`;});stillCurrent();validatePackGlb(bytes);
        const buffer=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes.buffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
        const parseStart=performance.now(),gltf=await loader.parseAsync(buffer,'');performance.measure?.('bioglow.models.parse',{start:parseStart,end:performance.now(),detail:{asset:asset.id}});sources.push(gltf.scene);stillCurrent();gltf.scene.updateMatrixWorld(true);const setupStart=performance.now();
        for(const p of manifest.placements.filter(p=>p.asset===asset.id)) {
          const placed=new THREE.Group(),content=new THREE.Group();content.scale.setScalar(1000);content.position.set(...(p.origin||[0,0,0]).map(n=>-n));placed.add(content);
          const nodes=p.nodes?p.nodes.map(name=>{const node=gltf.scene.getObjectByName(name);if(!node)throw new Error(`Missing model group: ${name}`);return node;}):[gltf.scene];
          for(const node of nodes){
            node.traverse(o=>{if(o.isMesh){renderedTriangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;renderedMeshes++;}});
            if(renderedTriangles>4500000||renderedMeshes>500)throw new Error('The selected model placements are too detailed for the field viewer.');
            const clone=node.clone(true);clone.matrix.copy(node.matrixWorld);clone.matrix.decompose(clone.position,clone.quaternion,clone.scale);content.add(clone);
          }
          const [x,y,height]=p.position;placed.position.set(...toFieldWorld(x,y,height));placed.rotation.y=-radians(p.yaw);placed.name=p.id;staging.add(placed);stagedPlacements.push({group:placed,placement:p});
        }
        performance.measure?.('bioglow.models.setup',{start:setupStart,end:performance.now(),detail:{asset:asset.id}});
        gltf.scene.traverse(o=>{if(o.isMesh){o.material.side=THREE.DoubleSide;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}});
        if(triangles>4500000)throw new Error('This model pack is too detailed for the field viewer.');
        await new Promise(resolve=>requestAnimationFrame(resolve));stillCurrent();
      }
      stillCurrent();const keep=resources(staging);for(const source of sources)disposeGroup(source,keep);
      scene.add(staging);modelGroup=staging;modelPlacements=stagedPlacements;loadedName=String(manifest.title||'BIOGLOW model pack').slice(0,100);unloadButton.disabled=false;
      update(); // Apply saved dock assignments immediately, including while idle.
      status.textContent=`${loadedName} · ${manifest.assets.length} models · ${manifest.placements.length} placements loaded${file?' from local ZIP':''}. Approximate placements; mission mechanisms are static.`;
      panel.dataset.packState='loaded';panel.dataset.modelCount=String(manifest.assets.length);panel.dataset.placementCount=String(stagedPlacements.length);panel.dataset.modelSource=file?'local':'bundled';pendingModelFrame=true;panel.dataset.triangles=String(Math.round(triangles));dirty=true;
    } catch(error) {
      disposeGroup(staging);for(const source of sources)disposeGroup(source);
      if(generation===ownGeneration){status.textContent=error.name==='AbortError'?'Loading cancelled.':`Could not load models: ${error.message}`;panel.dataset.packState='error';retryButton.hidden=false;}
    } finally { bundledSource?.dispose?.();if(generation===ownGeneration){activeController=null;cancelButton.hidden=true;input.value='';} }
  }
  input.addEventListener('change',()=>{const file=input.files?.[0];if(file)loadPack(file);});
  function update() {
    const mode=options.getMatMode?.()||'photo';if(matMode!==mode){matMode=mode;matMaterial.map=mode==='photo'&&photo?photo:plain;matMaterial.needsUpdate=true;}
    const p=sim.pose,next=new THREE.Vector3(p.x,70,-p.y);
    if(follow){const delta=next.clone().sub(lastPose);camera.position.add(delta);controls.target.add(delta);controls.update();}lastPose.copy(next);
    robot.position.set(...toFieldWorld(p.x,p.y));robot.rotation.y=-radians(p.h);
    const now=performance.now();
    if(now-lastRobotBuild>45){const state=robotScene(sim),key=JSON.stringify([state.cfg,state.wheels,state.arms,state.matrix]);
      if(key!==robotKey){const geometries=makeRobotGeometry(robotMeshData(state));robotMeshes.forEach((mesh,i)=>{mesh.geometry.dispose();mesh.geometry=geometries[i];});robotKey=key;}lastRobotBuild=now;robotPending=false;}else robotPending=true;
    const present=new Set();for(const o of sim.objects.filter(o=>o.loose)){
      const id=o.id;present.add(id);let mesh=loose.get(id);if(!mesh){mesh=new THREE.Mesh(looseGeometry,looseMaterial);loose.set(id,mesh);scene.add(mesh);}mesh.scale.set(o.w,o.seed?8:24,o.h);mesh.position.set(o.x,o.seed?4:12,-o.y);mesh.rotation.y=-radians(o.r||0);mesh.visible=!o.lifted;
    }
    for(const [id,mesh] of loose)if(!present.has(id)){scene.remove(mesh);loose.delete(id);}
    for(const {group,placement} of modelPlacements)if(placement.dockModel){const dock=sim.objects.find(o=>o.dock&&o.holds===placement.dockModel);if(dock){group.position.set(dock.x,placement.position[2],-dock.y);group.rotation.y=-radians(dock.r+(placement.dockYaw||0));}}
    dirty=true;
  }
  let frameId;
  const frame=time=>{if(destroyed)return;frameId=requestAnimationFrame(frame);if(!visible||document.hidden||time-lastRender<32)return;
    if(sim.running||sim.matchOn||robotPending)update();if(dirty){const renderStart=performance.now();renderer.render(scene,camera);if(pendingModelFrame){performance.measure?.('bioglow.models.first-render',{start:renderStart,end:performance.now()});pendingModelFrame=false;}dirty=false;lastRender=time;panel.dataset.drawCalls=String(renderer.info.render.calls);}
  };
  update();frameId=requestAnimationFrame(frame);status.textContent='Loading bundled BIOGLOW models…';
  if(options.autoLoad!==false)loadBundled();
  return {update,loadPack,loadBundled,unload,resetCamera,destroy(){destroyed=true;cancelLoad();cancelAnimationFrame(frameId);intersection.disconnect();resizeObserver.disconnect();controls.dispose();clearModels();disposeGroup(robot);mat.geometry.dispose();matMaterial.dispose();plain.dispose();photo?.dispose();table.geometry.dispose();table.material.dispose();looseGeometry.dispose();looseMaterial.dispose();renderer.dispose();mount.replaceChildren();panel.removeEventListener('click',onView);}};
}
