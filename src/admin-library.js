import {createSharedLibrary,ConflictError,validProjectName} from './shared-library.js';
export function createAdminLibrary({request,session,newId}) {
  const library=createSharedLibrary({request,session,newId,administrative:true});
  const authorize=async()=>{await request('adminAccess');return true;};
  return {
    authorize,
    async list(cursor){await authorize();return library.list(cursor);},
    async history(id,cursor){await authorize();return library.history(id,cursor);},
    async change({id,base,action,name}) {
      if(!['rename','archive','restore'].includes(action))throw new Error('Unknown admin action.');
      if(!base?.revision)throw new Error('Refresh the list before changing this program.');
      const nextName=action==='rename'?String(name||'').trim():base.name;
      if(!validProjectName(nextName))throw new Error('Name: 1–64 letters, numbers, spaces, dashes or underscores; start with a letter or number.');
      if(action==='rename' && nextName===base.name)throw new Error('Enter a different name.');
      if(action==='archive' && base.archived===true || action==='restore' && base.archived!==true)throw new Error('This action no longer applies. Refresh the list.');
      await authorize();
      const current=await library.header(id);
      if(current?.revision!==base.revision)throw new ConflictError();
      // Copy the stored payload exactly rather than parsing/re-serializing it.
      // Admins must also be able to archive a malformed student revision.
      const payload=await request(`payloads/${id}/${base.revision}`);
      if(!payload)throw new Error('The stored revision is missing. No change was made.');
      const {uid}=await session();
      const revision=newId?newId():crypto.randomUUID().replaceAll('-','');
      const meta={revision,seq:current.seq+1,name:nextName,nickname:'Administrator',uid,
        updatedAt:{'.sv':'timestamp'},archived:action==='archive'?true:action==='restore'?false:base.archived===true};
      const patch={['catalog/'+id]:meta,[`history/${id}/${revision}`]:{...meta,previous:base.revision,restoredFrom:''},[`payloads/${id}/${revision}`]:payload};
      try{await request('',{method:'PATCH',body:patch});}
      catch(e){
        const latest=await library.header(id);
        if(latest?.revision===revision)return {id,meta:latest};
        if(latest?.revision!==base.revision)throw new ConflictError();
        throw e;
      }
      return {id,meta};
    }
  };
}
