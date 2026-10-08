import {encodeSave, decodeSave, validateSave} from './save-format.js';
export const LIBRARY_LIMIT = 128 * 1024;
export const PAGE_SIZE = 20;
export const validProjectName = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(name);
const validId = id => typeof id === 'string' && /^[a-f0-9]{32}$/.test(id);
const id = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
export class ConflictError extends Error { constructor(){super('Someone saved a newer version. Your workspace is unchanged. Load the latest version or choose Save a copy.');this.name='ConflictError';} }
export function createRevision({programId,revision=id(),base,name,nickname='',uid,payload,restoredFrom=''}) {
  if(!validId(programId)||!validId(revision)||!validProjectName(name)||!/^[A-Za-z0-9 _-]{0,32}$/.test(nickname)||typeof uid!=='string') throw new Error('Use a project name of 1–64 letters, numbers, spaces, dashes or underscores.');
  if(base && (!validId(base.revision)||!Number.isInteger(base.seq)||base.seq<1)) throw new Error('Invalid base revision.');
  if(restoredFrom && !validId(restoredFrom))throw new Error('Invalid history revision.');
  const encoded=encodeSave(payload);
  if(new TextEncoder().encode(encoded).byteLength>LIBRARY_LIMIT)throw new Error('Shared saves are limited to 128 KiB. Export a file for larger projects.');
  const meta={revision,seq:(base?.seq||0)+1,name,nickname,uid,updatedAt:{'.sv':'timestamp'}};
  return {
    [`catalog/${programId}`]:meta,
    [`history/${programId}/${revision}`]:{...meta,previous:base?.revision||'',restoredFrom},
    [`payloads/${programId}/${revision}`]:{version:1,workspace:JSON.stringify(payload.workspace),start:{...payload.start}}
  };
}
export function createSharedLibrary({request,session,newId=id}) {
  const safeId=value=>{if(!validId(value))throw new Error('Invalid library identifier.');return value;};
  const header=async programId=>request('catalog/'+safeId(programId));
  return {
    async list(cursor=null){
      const query={orderBy:'"$key"',limitToFirst:PAGE_SIZE};
      if(cursor)query.startAt=JSON.stringify(safeId(cursor));
      const value=await request('catalog', {query});
      const rows=Object.entries(value||{}).sort(([a],[b])=>a.localeCompare(b)).map(([id,meta])=>({id,...meta}));
      // Fetch one overlapping item when paging; skip it without a gallery subscription.
      return {items:rows.filter(row=>row.id!==cursor),cursor:rows.length===PAGE_SIZE?rows.at(-1).id:null};
    },
    header,
    async load(programId,revision){
      safeId(programId);
      const meta=revision?await request(`history/${programId}/${safeId(revision)}`):await header(programId);
      if(!meta)throw new Error('This save no longer exists.');
      const record=await request(`payloads/${programId}/${safeId(meta.revision)}`);
      if(!record||typeof record.workspace!=='string'||record.workspace.length>LIBRARY_LIMIT)throw new Error('Invalid shared save.');
      let payload;
      try { payload=decodeSave(JSON.stringify({version:record.version,workspace:JSON.parse(record.workspace),start:record.start})); }
      catch { throw new Error('This shared revision contains invalid workspace data. Your current work is unchanged.'); }
      if(new TextEncoder().encode(encodeSave(payload)).byteLength>LIBRARY_LIMIT)throw new Error('Shared save exceeds 128 KiB.');
      return {id:programId,meta,payload};
    },
    async history(programId,after=0){
      const value=await request('history/'+safeId(programId),{query:{orderBy:'"seq"',startAt:after+1,limitToFirst:PAGE_SIZE}});
      const rows=Object.values(value||{}).sort((a,b)=>a.seq-b.seq);
      return {items:rows,cursor:rows.length===PAGE_SIZE?rows.at(-1).seq:null};
    },
    async save({programId=newId(),base=null,name,nickname='',payload,restoredFrom=''}){
      validateSave(payload);
      const {uid}=await session();
      const patch=createRevision({programId,revision:newId(),base,name,nickname,uid,payload,restoredFrom});
      try {await request('',{method:'PATCH',body:patch});}
      catch(err){
        // Do not retry or rebase automatically: the user's explicit base stays fixed.
        // Recover an uncertain successful write without creating a duplicate revision.
        try {
          const current=await header(programId),next=patch['catalog/'+programId];
          if(current?.revision===next.revision)return {id:programId,meta:current};
          if((current?.revision||null)!==(base?.revision||null))throw new ConflictError();
        } catch(check){if(check instanceof ConflictError)throw check;}
        throw err;
      }
      return {id:programId,meta:patch['catalog/'+programId]};
    }
  };
}
export function firebaseTransport({databaseURL,session,fetcher=fetch,namespace}) {
  const base=new URL(databaseURL);
  const loopback=['127.0.0.1','localhost'].includes(base.hostname);
  if(namespace) {
    if(!loopback || !namespace.startsWith('demo-'))throw new Error('Emulators require a loopback address and demo project.');
  } else if(base.protocol!=='https:'||!/^[-a-z0-9.]+\.(firebaseio\.com|firebasedatabase\.app)$/.test(base.hostname))throw new Error('Invalid Firebase Realtime Database URL.');
  if(base.username||base.password||base.search||base.hash||base.pathname!=='/')throw new Error('Invalid database address.');
  return async(path,{method='GET',body,query={}}={})=>{
    if(!/^(?:catalog(?:\/[a-f0-9]{32})?|history\/[a-f0-9]{32}(?:\/[a-f0-9]{32})?|payloads\/[a-f0-9]{32}\/[a-f0-9]{32})?$/.test(path))throw new Error('Invalid library path.');
    const auth=await session();
    const url=new URL('bioglowV1'+(path?'/'+path:'')+'.json',base);
    url.searchParams.set('auth',await auth.token());
    if(namespace)url.searchParams.set('ns',namespace);
    for(const [k,v] of Object.entries(query))url.searchParams.set(k,String(v));
    if(method==='PATCH')url.searchParams.set('print','silent');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const res=await fetcher(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
      if(!res.ok)throw new Error(res.status===401||res.status===403?'The save was rejected. Refresh the list and check your connection.':'Shared library unavailable. Check your Internet connection and try again.');
      if(res.status===204)return null;
      const reader=res.body.getReader();let bytes=0,chunks=[];
      while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>1024*1024){await reader.cancel();throw new Error('Library response is too large.');}chunks.push(part.value);}
      const raw=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
      return JSON.parse(new TextDecoder().decode(raw));
    }catch(err){if(err.name==='AbortError')throw new Error('The request timed out. Your workspace is unchanged.');throw err;}
    finally{clearTimeout(timer);}
  };
}
