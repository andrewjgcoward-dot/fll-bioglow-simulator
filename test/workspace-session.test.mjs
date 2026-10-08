import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceSession} from '../src/workspace-session.js';
import {exportLlsp3} from '../src/spike-io.js';
import {createSharedLibrary} from '../src/shared-library.js';
const valid=()=>({version:1,workspace:{blocks:{languageVersion:0,blocks:[{type:'sim_start',id:'start',x:40,y:40}]}},start:{x:240,y:240,h:0}});
const loose=()=>({...valid(),workspace:{blocks:{languageVersion:0,blocks:[{type:'sim_num',id:'loose',x:80,y:80,fields:{V:42}}]}},start:{x:360,y:430,h:-36}});
const disabled=()=>({...valid(),workspace:{blocks:{languageVersion:0,blocks:[{type:'sim_start',id:'disabled',x:40,y:40,disabledReasons:['MANUALLY_DISABLED']}]}},start:{x:120,y:250,h:90}});
function appSession(snapshot=valid().workspace) {
 const ws={data:structuredClone(snapshot)};
 const B={Workspace:class {constructor(){this.data={};}dispose(){}},Events:{disable(){},enable(){}},serialization:{workspaces:{save:w=>structuredClone(w.data),load:(json,w)=>{w.data=structuredClone(json);}}}};
 const state={ws:null,program:{stacks:[[{t:'wait',secs:{t:'num',v:1}}]],events:[],procs:{},vars:[],lists:[]},start:{...valid().start},sounds:{}};
 let persisted,stopped=0,reset=0,lastStatus;
 const session=createWorkspaceSession({state,getWorkspace:()=>ws,getBlockly:()=>B,persist:()=>persisted=structuredClone(state),status:s=>lastStatus=s,beforeRestore:()=>stopped++,afterRestore:()=>reset++});
 return {session,state,ws,read:()=>({persisted,stopped,reset,lastStatus})};
}
for(const [name,fixture] of [['disconnected number',loose],['disabled start',disabled]]) {
 test(`actual app session callbacks restore/capture/autosave ${name} without executable validation`,()=>{
  const {session,state,read}=appSession();const data=fixture();session.validateCandidate(data);assert.doesNotThrow(()=>session.restore(data));assert.deepEqual(session.capture(),data);assert.deepEqual(state.ws,data.workspace);assert.deepEqual(state.start,data.start);assert.deepEqual(read().persisted.ws,data.workspace);assert.equal(read().stopped,1);assert.equal(read().reset,1);assert.deepEqual(read().lastStatus.workspace,data.workspace);
  assert.doesNotThrow(()=>session.sync());assert.deepEqual(read().persisted.ws,data.workspace);
  assert.throws(()=>session.executable(),/loose|disabled/);assert.throws(()=>exportLlsp3(session.executable()),/loose|disabled/);assert.deepEqual(state.program.stacks,[[]]); // no previous runnable program
 });
 test(`history workflow publishes then successfully applies ${name} through app callback`,async()=>{
  const {session}=appSession();const id='a'.repeat(32),old='b'.repeat(32),fresh='c'.repeat(32);let writes=0;
  const api=createSharedLibrary({session:async()=>({uid:'test-user'}),newId:()=>fresh,request:async(_p,opts)=>{if(opts?.method==='PATCH')writes++;return null;}});
  const data=fixture();session.validateCandidate(data);const result=await api.save({programId:id,base:{revision:old,seq:1},name:'Restored draft',payload:data,restoredFrom:old});assert.equal(result.meta.seq,2);assert.doesNotThrow(()=>session.restore(data));assert.deepEqual(session.capture(),data);assert.equal(writes,1);
 });
}
test('editing an unfinished workspace into a supported one restores normal executable/export behavior',()=>{
 const {session,ws}=appSession();session.restore(loose());assert.throws(()=>session.executable());ws.data=valid().workspace;session.sync();assert.doesNotThrow(()=>session.executable());assert.ok(exportLlsp3(session.executable()).zip.length>0);
});
test('malformed restore fails before persistence, simulator mutation or workspace replacement',()=>{
 const {session,read,ws}=appSession();const before=structuredClone(ws.data);assert.throws(()=>session.restore({...loose(),start:{x:-1,y:0,h:0}}));assert.deepEqual(ws.data,before);assert.equal(read().stopped,0);assert.equal(read().reset,0);assert.equal(read().persisted,undefined);
});

// Exercise setupLibrary's real click callbacks with the same session callbacks
// installed by app.js. The DOM shim only supplies the controls used by this flow.
import {setupLibrary} from '../src/library-ui.js';
function libraryDom() {
 class Element {
  children=[];open=false;value='';textContent='';disabled=false;
  addEventListener(){} querySelectorAll(){return [];} focus(){}
  appendChild(child){this.children.push(child);} replaceChildren(){this.children=[];}
  get childElementCount(){return this.children.length;}
  showModal(){this.open=true;} close(){this.open=false;}
 }
 const elements=new Map();
 return {elements,get:id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},Element};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
for(const [name,fixture] of [['disconnected number',loose],['disabled start',disabled],['malformed pose',()=>({...loose(),start:{x:-1,y:0,h:0}})]]) {
 test(`real library history click callback: ${name}`,async()=>{
  const dom=libraryDom(),previousDocument=globalThis.document,previousConfirm=globalThis.confirm;
  globalThis.document={getElementById:dom.get,createElement:()=>new dom.Element()};globalThis.confirm=()=>true;
  try {
   const {session}=appSession();let writes=0,message='';const original=valid(),draft=fixture();
   const current={id:'a'.repeat(32),meta:{name:'Draft',seq:2,revision:'b'.repeat(32)},payload:original};
   const provider={list:async()=>({items:[{...current.meta,id:current.id}],cursor:null}),load:async(_id,revision)=>revision?{...current,payload:draft}:current,history:async()=>({items:[{seq:1,revision:'c'.repeat(32),updatedAt:1}],cursor:0}),save:async()=>{writes++;return {...current,meta:{...current.meta,seq:3},payload:draft};}};
   setupLibrary({capture:session.capture,restore:session.restore,validateCandidate:session.validateCandidate,message:value=>message=value,provider});
   dom.get('library-open').onclick();await settle();await dom.get('library-list').children[0].onclick();
   assert.deepEqual(session.capture(),original);
   dom.get('library-history').onclick();await settle();await dom.get('library-list').children[0].onclick();
   if(name==='malformed pose') {
    assert.equal(writes,0,'known local validation failure must precede publication');assert.deepEqual(session.capture(),original);assert.equal(dom.get('shared-library').open,true);assert.match(dom.get('library-status').textContent,/pose|start|bounds/i);
   } else {
    assert.equal(writes,1);assert.deepEqual(session.capture(),draft);assert.equal(dom.get('shared-library').open,false);assert.match(message,/Restored version 1 as new version 3/);assert.throws(()=>session.executable(),/loose|disabled/);
   }
  } finally {globalThis.document=previousDocument;globalThis.confirm=previousConfirm;}
 });
}
