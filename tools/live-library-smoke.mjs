// Explicit opt-in smoke test for this dedicated production library only.
// Anonymous user tokens stay in memory. Creates labeled synthetic revisions only.
import assert from 'node:assert/strict';
import {firebaseConfig as config} from '../src/firebase-config.js';
import {createSharedLibrary,firebaseTransport,ConflictError} from '../src/shared-library.js';
if(process.env.BIOGLOW_LIVE_QA!=='1'||config.projectId!=='fll-bioglow-simulator')throw Error('Explicit dedicated-project QA opt-in required');
async function auth(){const r=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key='+config.apiKey,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})});const v=await r.json();assert.ok(v.idToken,JSON.stringify(v.error||r.status));return {uid:v.localId,token:async()=>v.idToken};}
const users=await Promise.all([auth(),auth()]);
const apis=users.map(who=>createSharedLibrary({session:async()=>who,request:firebaseTransport({databaseURL:config.databaseURL,session:async()=>who})}));
const [a,b]=apis, name='QA Synthetic API 20261008';
const payload={version:1,workspace:{blocks:{languageVersion:0,blocks:[{type:'sim_num',id:'qa-loose',x:80,y:80,fields:{V:42}}]}},start:{x:360,y:430,h:-36}};
let passes=0;const pass=label=>{passes++;console.log('PASS '+label);};
const first=await a.save({name,nickname:'QA API A',payload});assert.deepEqual((await b.load(first.id)).payload,payload);pass('independent anonymous users save and load exact raw workspace and pose');
const changed={...payload,start:{x:450,y:500,h:90}};
const second=await b.save({programId:first.id,base:first.meta,name,nickname:'QA API B',payload:changed});assert.equal(second.meta.seq,2);pass('second anonymous user edits first user program');
await assert.rejects(a.save({programId:first.id,base:first.meta,name,payload}),ConflictError);assert.equal((await a.history(first.id)).items.length,2);pass('stale write rejected without extra revision');
const old=await b.load(first.id,first.meta.revision);const third=await b.save({programId:first.id,base:second.meta,name,payload:old.payload,restoredFrom:first.meta.revision});assert.equal(third.meta.seq,3);assert.deepEqual((await a.load(first.id)).payload,payload);assert.deepEqual((await a.load(first.id,second.meta.revision)).payload,changed);pass('history restore appends and retains prior versions');
const copy=await a.save({name:'QA Synthetic Copy 20261008',payload});assert.notEqual(copy.id,first.id);assert.equal(copy.meta.seq,1);pass('Save a copy gives independent version 1');
const unauth=await fetch(config.databaseURL+'bioglowV1/catalog.json');assert.equal(unauth.status,401);pass('unauthenticated catalog denied');
for(const path of ['bioglowV1','bioglowV1/catalog','bioglowV1/history/'+first.id]){const url=new URL(path+'.json',config.databaseURL);url.searchParams.set('auth',await users[0].token());const r=await fetch(url);assert.equal(r.status,401);}pass('authenticated root and unbounded reads denied');
const url=new URL('bioglowV1/payloads/'+first.id+'/'+first.meta.revision+'.json',config.databaseURL);url.searchParams.set('auth',await users[0].token());const r=await fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({start:{x:1,y:1,h:1}})});assert.equal(r.status,401);assert.deepEqual((await a.load(first.id,first.meta.revision)).payload,payload);pass('immutable synthetic revision rejects overwrite');
console.log(JSON.stringify({passes,project:config.projectId,programId:first.id,copyId:copy.id}));
