import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSharedLibrary,firebaseTransport,createRevision,ConflictError} from '../src/shared-library.js';
import {createAdminLibrary} from '../src/admin-library.js';
const enabled=process.env.BIOGLOW_ADMIN_EMULATOR_TEST==='1';
const origin=process.env.BIOGLOW_DATABASE_ORIGIN||'http://127.0.0.1:9018',ns=process.env.BIOGLOW_DEMO_PROJECT||'demo-bioglow-admin',authOrigin=process.env.BIOGLOW_AUTH_ORIGIN||'http://127.0.0.1:9108';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname)||!ns.startsWith('demo-'))throw Error('Admin tests require local demo emulators');
const fixture=()=>({version:1,workspace:{blocks:{languageVersion:0,blocks:[{type:'sim_num',id:'loose',x:80,y:80,fields:{V:42}}]}},start:{x:360,y:430,h:-36}});
const id=()=>crypto.randomUUID().replaceAll('-','');
async function login(kind,email,verified=true){
 let method='signUp',body={returnSecureToken:true};
 if(kind==='google') {
  const claims={sub:email,email,email_verified:verified,iss:'https://accounts.google.com',aud:'demo-client',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600};
  const jwt=Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.';
  method='signInWithIdp';body={requestUri:'http://localhost',postBody:new URLSearchParams({providerId:'google.com',id_token:jwt}).toString(),returnSecureToken:true};
 } else if(kind==='password')body={...body,email,password:'Synthetic-emulator-password-123'};
 const r=await fetch(authOrigin+'/identitytoolkit.googleapis.com/v1/accounts:'+method+'?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const v=await r.json();assert.ok(v.idToken,JSON.stringify(v.error));
 return {uid:v.localId,token:async()=>v.idToken,claims:JSON.parse(Buffer.from(v.idToken.split('.')[1],'base64url'))};
}
async function raw(path,body,who,method='PATCH',query={}) {const url=new URL('/bioglowV1'+(path?'/'+path:'')+'.json',origin);url.searchParams.set('ns',ns);if(who)url.searchParams.set('auth',await who.token());for(const[k,v]of Object.entries(query))url.searchParams.set(k,String(v));return fetch(url,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
const requestFor=who=>firebaseTransport({databaseURL:origin,namespace:ns,session:async()=>who});
const shared=who=>createSharedLibrary({session:async()=>who,request:requestFor(who)});
test('admin rule and adapter security on isolated Firebase emulators',{skip:!enabled},async t=>{
 await fetch(authOrigin+'/emulator/v1/projects/'+ns+'/accounts',{method:'DELETE'});
 const rules=await readFile(new URL('../firebase/database.rules.json',import.meta.url),'utf8');
 const r=await fetch(`${origin}/.settings/rules.json?ns=${ns}`,{method:'PUT',headers:{Authorization:'Bearer owner'},body:rules});assert.equal(r.status,200,await r.text());
 const anonymous=await login('anonymous'),wrong=await login('google','other-coach@example.test'),owner=await login('google','mike.coward@gmail.com');
 // The local RTDB emulator supports unsigned synthetic auth tokens. Mutate one
 // claim at a time to prove the rules require both verification and provider.
 function mockClaims(change){const claims=structuredClone(owner.claims);change(claims);const token=Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.';return {uid:owner.uid,claims,token:async()=>token};}
 const unverified=mockClaims(c=>c.email_verified=false),wrongProvider=mockClaims(c=>c.firebase.sign_in_provider='password');
 assert.equal(owner.claims.firebase.sign_in_provider,'google.com');assert.equal(owner.claims.email_verified,true);assert.equal(unverified.claims.email_verified,false);
 const student=shared(anonymous),admin=createAdminLibrary({session:async()=>owner,request:requestFor(owner)});
 const denied=async(path,body,who=anonymous,method='PATCH')=>{const response=await raw(path,body,who,method);assert.equal(response.status,401,await response.text());};
 let first,current;
 await t.test('only verified approved Google identity passes server admin gate',async()=>{
  assert.equal(await admin.authorize(),true);
  for(const actor of [anonymous,wrong,unverified,wrongProvider,null])await denied('adminAccess',undefined,actor,'GET');
 });
 await t.test('legacy programs without archive field remain editable',async()=>{
  const programId=id(),patch=createRevision({programId,uid:anonymous.uid,name:'QA Admin Legacy',payload:fixture()});for(const value of Object.values(patch))delete value.archived;
  const response=await raw('',patch,anonymous);assert.equal(response.status,200,await response.text());first=await student.load(programId);current=await student.save({programId,base:first.meta,name:first.meta.name,payload:fixture()});assert.equal(current.meta.seq,2);
 });
 await t.test('anonymous direct API rename/archive and forged admin fields are denied',async()=>{
  for(const change of [{name:'Hijacked name'},{archived:true}])await denied('',createRevision({programId:first.id,base:current.meta,uid:anonymous.uid,name:current.meta.name,payload:fixture(),...change}));
  await denied('adminAccess',true,anonymous,'PUT');assert.equal((await student.header(first.id)).revision,current.meta.revision);
 });
 await t.test('other Google and unverified owner cannot rename or archive',async()=>{
  for(const actor of [wrong,unverified,wrongProvider])await denied('',createRevision({programId:first.id,base:current.meta,uid:actor.uid,name:'Wrong admin rename',payload:fixture()}),actor);
 });
 await t.test('owner rename preserves ID, raw draft, pose and old revisions',async()=>{
  const renamed=await admin.change({id:first.id,base:current.meta,action:'rename',name:'QA Admin Renamed'});assert.equal(renamed.id,first.id);assert.equal(renamed.meta.seq,3);assert.deepEqual((await student.load(first.id)).payload,fixture());assert.equal((await student.load(first.id,first.meta.revision)).meta.name,'QA Admin Legacy');current=renamed;
 });
 await t.test('student stale pre-rename save and stale admin rename conflict',async()=>{
  await assert.rejects(student.save({programId:first.id,base:first.meta,name:first.meta.name,payload:fixture()}),ConflictError);
  await assert.rejects(admin.change({id:first.id,base:first.meta,action:'rename',name:'Stale rename'}),ConflictError);
 });
 await t.test('admin cannot combine metadata change with altered blocks or pose',async()=>{
  for(const payload of [{...fixture(),start:{x:1,y:2,h:3}},{...fixture(),workspace:{blocks:{languageVersion:0,blocks:[]}}}])await denied('',createRevision({programId:first.id,base:current.meta,uid:owner.uid,name:'Sneaky rename',payload}),owner);
 });
 await t.test('archive is recoverable, hidden from student list, visible to admin',async()=>{
  current=await admin.change({id:first.id,base:current.meta,action:'archive'});assert.equal(current.meta.archived,true);assert.equal((await student.list()).items.some(x=>x.id===first.id),false);assert.equal((await admin.list()).items.find(x=>x.id===first.id).archived,true);assert.equal((await admin.history(first.id)).items.length,4);
 });
 await t.test('archived student loads, edits, direct restore and old-client writes are denied',async()=>{
  await assert.rejects(student.load(first.id),/archived/);
  await denied(`payloads/${first.id}/${current.meta.revision}`,undefined,anonymous,'GET');
  for(const archived of [true,false])await denied('',createRevision({programId:first.id,base:current.meta,uid:anonymous.uid,name:current.meta.name,payload:fixture(),archived}));
  const legacy=createRevision({programId:first.id,base:current.meta,uid:anonymous.uid,name:current.meta.name,payload:fixture()});for(const v of Object.values(legacy))delete v.archived;await denied('',legacy);
 });
 await t.test('owner archive restore preserves content, re-enables students, and history stays immutable',async()=>{
  const archivedRevision=current.meta.revision;
  current=await admin.change({id:first.id,base:current.meta,action:'restore'});assert.equal(current.meta.archived,false);assert.equal(current.meta.seq,5);assert.deepEqual((await student.load(first.id)).payload,fixture());assert.equal((await student.list()).items.some(x=>x.id===first.id),true);
  assert.equal((await shared(owner).load(first.id,archivedRevision)).meta.archived,true);
  const changed={...fixture(),start:{x:500,y:410,h:90}};current=await student.save({programId:first.id,base:current.meta,name:current.meta.name,payload:changed});assert.equal(current.meta.seq,6);
  for(const actor of [anonymous,owner]){await denied('catalog/'+first.id,null,actor,'DELETE');await denied(`history/${first.id}/${first.meta.revision}`,{name:'tamper'},actor);await denied(`payloads/${first.id}/${first.meta.revision}`,null,actor,'DELETE');}
 });
 await t.test('archive versus student edit has exactly one winner; retry requires refreshed base',async()=>{
  const base=current.meta;const results=await Promise.allSettled([admin.change({id:first.id,base,action:'archive'}),student.save({programId:first.id,base,name:base.name,payload:fixture()})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.ok(results.find(x=>x.status==='rejected').reason instanceof ConflictError);
 });
 await t.test('admin can archive malformed raw JSON without changing its bytes',async()=>{
  const programId=id(),patch=createRevision({programId,uid:anonymous.uid,name:'QA Malformed Student Draft',payload:fixture()});
  const key=Object.keys(patch).find(k=>k.startsWith('payloads/'));patch[key].workspace='{invalid JSON';
  const response=await raw('',patch,anonymous);assert.equal(response.status,200,await response.text());const base=await student.header(programId);
  const archived=await admin.change({id:programId,base,action:'archive'});assert.equal(archived.meta.archived,true);
  const original=await (await raw(key,undefined,owner,'GET')).json(),copy=await (await raw(`payloads/${programId}/${archived.meta.revision}`,undefined,owner,'GET')).json();assert.deepEqual(copy,original);
 });
 await t.test('save copy remains independent even after source is archived',async()=>{
  const copy=await student.save({name:'QA Student Independent Copy',payload:fixture()});assert.notEqual(copy.id,first.id);assert.equal(copy.meta.seq,1);assert.deepEqual((await student.load(copy.id)).payload,fixture());
 });
});
