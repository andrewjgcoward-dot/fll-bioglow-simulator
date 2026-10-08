import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeSave,decodeSave,validSaveName,MAX_SAVE_BYTES} from '../src/save-format.js';
import {installSavedWorkspace} from '../src/workspace-transaction.js';
const fixture=()=>({version:1,start:{x:350,y:420,h:-35},workspace:{variables:[{id:'v1',name:'score',type:''}],blocks:{languageVersion:0,blocks:[{type:'sim_num',id:'loose',x:54,y:88,fields:{V:15},enabled:false,icons:{comment:{text:'unfinished',pinned:true,width:180,height:80}}}]}}});
test('portable save preserves full raw workspace, comments, disconnected block, IDs and pose',()=>{
 const data=fixture(); assert.deepEqual(decodeSave(encodeSave(data)),data);
});
test('empty workspace is a valid save',()=>{
 const data=fixture();data.workspace={};assert.deepEqual(decodeSave(encodeSave(data)),data);
});
test('reject incompatible versions and extra envelope fields',()=>{
 for(const patch of [{version:2},{program:{}},{filename:'../outside'}])assert.throws(()=>encodeSave({...fixture(),...patch}));
});
test('reject malformed and nonfinite starting poses',()=>{
 for(const start of [{x:-1,y:0,h:0},{x:0,y:1144,h:0},{x:0,y:0,h:Infinity},{x:0,y:0},{x:'1',y:0,h:0}])assert.throws(()=>encodeSave({...fixture(),start}));
});
test('limits UTF-8 bytes, including multibyte payloads',()=>{
 const data=fixture();data.workspace.blocks.blocks=Array.from({length:150},(_,i)=>({type:'sim_text',id:'large'+i,fields:{V:'é'.repeat(4096)}}));assert.throws(()=>encodeSave(data),/1 MiB/);
 assert.throws(()=>decodeSave(' '.repeat(MAX_SAVE_BYTES+1)),/1 MiB/);
});
test('reject unsafe object keys, cycles and non-JSON values',()=>{
 const data=fixture();data.workspace.blocks.blocks[0].extraState=JSON.parse('{"__proto__":{}}');assert.throws(()=>encodeSave(data));
 const cyclic=fixture();cyclic.workspace.blocks.blocks[0].next=cyclic;assert.throws(()=>encodeSave(cyclic));
 const bad=fixture();bad.workspace.blocks.blocks[0].fields.V=NaN;assert.throws(()=>encodeSave(bad));
});
test('strict portable names reject traversal, encoded separators and extensions',()=>{
 for(const name of ['../escape','/escape','a%2fb','a\\b','.hidden','a.json','x'.repeat(65),''])assert.equal(validSaveName(name),false);
 assert.equal(validSaveName('Mission-03_test'),true);
});
test('invalid JSON cannot yield a partial save',()=>assert.throws(()=>decodeSave('{"version":1,')));
function editor(failVisible=false) {
 const visible={data:{blocks:{languageVersion:0,blocks:[]}}};
 const B={Workspace:class {constructor(){this.data={};}dispose(){}},Events:{disable(){},enable(){}},serialization:{workspaces:{save:ws=>structuredClone(ws.data),load:(json,ws)=>{ws.data=structuredClone(json);if(failVisible && ws===visible && json.blocks?.blocks.length)throw Error('editor rejected load');}}}};
 return {B,visible};
}
test('staged full workspace installation retains exact layout',()=>{
 const {B,visible}=editor();assert.deepEqual(installSavedWorkspace(fixture(),B,visible),fixture().workspace);
});
test('partial editor failure rolls back the prior visible workspace',()=>{
 const {B,visible}=editor(true);const before=structuredClone(visible.data);
 assert.throws(()=>installSavedWorkspace(fixture(),B,visible),/rejected/);assert.deepEqual(visible.data,before);
});
test('accepts actual Blockly omitted scalar type and variable reporter',()=>{
 const data=fixture();data.workspace.variables=[{name:'count',id:'count-id'}];data.workspace.blocks.blocks=[{type:'sim_var',id:'read-count',fields:{name:{id:'count-id'}},x:20,y:40}];assert.deepEqual(decodeSave(encodeSave(data)),data);
});
test('rejects silent normalization in headless staging without touching editor',()=>{
 const {B,visible}=editor();const before=structuredClone(visible.data),original=B.serialization.workspaces.load;
 B.serialization.workspaces.load=(json,ws)=>{original(json,ws);if(ws!==visible)delete ws.data.blocks;};assert.throws(()=>installSavedWorkspace(fixture(),B,visible),/preserve/);assert.deepEqual(visible.data,before);
});
