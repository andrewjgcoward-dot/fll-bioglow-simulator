// Synthetic loopback emulator fixtures only; refuses production endpoints.
import {readFile} from 'node:fs/promises';
import {createSharedLibrary,firebaseTransport} from '../src/shared-library.js';
const origin='http://127.0.0.1:9008/';
const rules=await readFile(new URL('../firebase/database.rules.json',import.meta.url),'utf8');
const r=await fetch(origin+'.settings/rules.json?ns=demo-bioglow',{method:'PUT',headers:{Authorization:'Bearer owner'},body:rules});if(!r.ok)throw Error(await r.text());
const a=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({returnSecureToken:true})});const user=await a.json();if(!user.idToken)throw Error('Emulator auth failed');
const session=async()=>({uid:user.localId,token:async()=>user.idToken});
const api=createSharedLibrary({session,request:firebaseTransport({databaseURL:origin,namespace:'demo-bioglow',session})});
const payload=blocks=>({version:1,workspace:{blocks:{languageVersion:0,blocks}},start:{x:360,y:430,h:-36}});
for(const [name,blocks] of [
 ['Draft loose number',[{type:'sim_num',id:'loose-number',x:80,y:80,fields:{V:42}}]],
 ['Draft disabled start',[{type:'sim_start',id:'disabled-start',x:40,y:40,disabledReasons:['MANUALLY_DISABLED']}]]
]){
 const first=await api.save({name,payload:payload(blocks)});
 const second=await api.save({programId:first.id,base:first.meta,name,payload:payload([{type:'sim_start',id:'ordinary-start',x:40,y:40}])});
 console.log(JSON.stringify({name,id:first.id,unfinishedRevision:first.meta.revision,currentVersion:second.meta.seq}));
}
