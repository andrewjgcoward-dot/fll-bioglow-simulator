import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedLibrary,createRevision,firebaseTransport,ConflictError,LIBRARY_LIMIT} from '../src/shared-library.js';
const id='a'.repeat(32),rev='b'.repeat(32),uid='synthetic-user';
const payload=()=>({version:1,workspace:{blocks:{languageVersion:0,blocks:[]}},start:{x:240,y:240,h:0}});
const session=async()=>({uid,token:async()=>'synthetic-token'});
test('one save is a single atomic patch with metadata/history/payload and previous revision',()=>{
 const base={revision:'c'.repeat(32),seq:4};const patch=createRevision({programId:id,revision:rev,base,name:'Mission 3',uid,payload:payload()});assert.equal(Object.keys(patch).length,3);assert.equal(patch['catalog/'+id].seq,5);assert.equal(patch[`history/${id}/${rev}`].previous,base.revision);assert.deepEqual(patch[`payloads/${id}/${rev}`].start,payload().start);
});
test('invalid identifiers, traversal names and excessive content rejected before network',()=>{
 for(const bad of ['../escape','x/y','a%2fb'])assert.throws(()=>createRevision({programId:bad,revision:rev,name:'Test',uid,payload:payload()}));
 const data=payload();data.workspace.blocks.blocks=Array.from({length:20},(_,i)=>({type:'sim_text',id:'n'+i,fields:{V:'é'.repeat(4096)}}));assert.throws(()=>createRevision({programId:id,revision:rev,name:'Test',uid,payload:data}),/128 KiB/);
});
test('metadata list query is bounded and pagination skips overlap',async()=>{
 let query;const request=async(_p,opts)=>{query=opts.query;return {[id]:{name:'A'},[rev]:{name:'B'}};};const api=createSharedLibrary({session,request});assert.deepEqual((await api.list(id)).items.map(x=>x.id),[rev]);assert.equal(query.limitToFirst,20);assert.equal(query.orderBy,'"$key"');
});
test('history query fetches only 20 headers after explicit sequence',async()=>{
 let path,opts;const api=createSharedLibrary({session,request:async(p,o)=>{path=p;opts=o;return {};}});await api.history(id,20);assert.equal(path,'history/'+id);assert.deepEqual(opts.query,{orderBy:'"seq"',startAt:21,limitToFirst:20});
});
test('uncertain successful network response recovers committed revision without second write',async()=>{
 let writes=0,metadata;const api=createSharedLibrary({session,newId:()=>rev,request:async(p,o)=>{if(o?.method==='PATCH'){writes++;metadata=o.body['catalog/'+id];throw Error('connection lost');}return metadata;}});assert.equal((await api.save({programId:id,name:'Test',payload:payload()})).meta.revision,rev);assert.equal(writes,1);
});
test('stale base reports conflict and never automatically rebases',async()=>{
 let writes=0;const api=createSharedLibrary({session,newId:()=>rev,request:async(p,o)=>{if(o?.method==='PATCH'){writes++;throw Error('denied');}return {revision:'d'.repeat(32),seq:9};}});await assert.rejects(api.save({programId:id,base:{revision:'c'.repeat(32),seq:1},name:'Test',payload:payload()}),ConflictError);assert.equal(writes,1);
});
test('invalid saved workspace fails before any editor callback or mutation',async()=>{
 const bad={version:1,start:{x:1,y:1,h:1},workspace:JSON.stringify({blocks:{languageVersion:0,blocks:[{type:'external_script'}]}})};
 const api=createSharedLibrary({session,request:async p=>p.startsWith('catalog')?{revision:rev}:bad});await assert.rejects(api.load(id),/invalid workspace/);
});
test('transport refuses untrusted production endpoint and non-loopback emulator',()=>{
 for(const databaseURL of ['http://my.firebaseio.com/','https://evil.example/','https://x.firebaseio.com/?token=x'])assert.throws(()=>firebaseTransport({databaseURL,session}));
 assert.throws(()=>firebaseTransport({databaseURL:'http://192.168.4.40:9008/',namespace:'demo-bioglow',session}));
});
test('transport routes no arbitrary paths and does not queue failed writes',async()=>{
 let calls=0;const request=firebaseTransport({databaseURL:'https://example-default-rtdb.firebaseio.com/',session,fetcher:async()=>{calls++;return new Response('denied',{status:401});}});await assert.rejects(request('../elsewhere'));assert.equal(calls,0);await assert.rejects(request('',{method:'PATCH',body:{}}),/rejected/);assert.equal(calls,1);
});
