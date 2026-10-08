import {firebaseConfig} from './firebase-config.js';
import {createSharedLibrary,firebaseTransport,validProjectName} from './shared-library.js';
export function setupLibrary({capture,restore,validateCandidate,message,provider}) {
  const $=id=>document.getElementById(id),dialog=$('shared-library');
  let connection,selected=null,generation=0,mode='list',busy=false,listCursor=null,historyCursor=0;
  const status=text=>{$('library-status').textContent=text;};
  function selection(value){selected=value;$('library-current').textContent=value?`${value.meta.name} · version ${value.meta.seq}`:'Shared library · no program selected';$('library-history').disabled=!value;}
  async function connect(){
    if(provider)return provider;
    if(!firebaseConfig)throw new Error('Shared library setup is pending. Your current workspace and SPIKE import/export still work.');
    if(!connection)connection=(async()=>{
      const {anonymousSession}=await import('../vendor/firebase-auth.js');
      const auth=await anonymousSession(firebaseConfig);
      const session=async()=>auth;
      return createSharedLibrary({session,request:firebaseTransport({databaseURL:firebaseConfig.databaseURL,session})});
    })().catch(err=>{connection=null;throw err;});
    return connection;
  }
  const current=turn=>turn===generation&&dialog.open;
  function setBusy(value){busy=value;dialog.querySelectorAll('button:not(#library-cancel)').forEach(button=>button.disabled=value);}
  function close(){generation++;dialog.close();}
  $('library-cancel').onclick=close;
  dialog.addEventListener('cancel',()=>generation++);
  function row(label,callback){const button=document.createElement('button');button.className='gh-file';button.type='button';button.textContent=label;button.onclick=callback;$('library-list').appendChild(button);}
  async function loadRow(entry,turn){
    if(busy)return;setBusy(true);status('Loading…');
    try{
      const api=await connect(),item=await api.load(entry.id);
      if(!current(turn))return;
      validateCandidate(item.payload);
      if(!confirm(`Load “${item.meta.name}”? This replaces your workspace and starting pose. Unsaved edits will be lost.`)){status('Load canceled. Your workspace is unchanged.');return;}
      restore(item.payload);selection(item);close();message(`Loaded “${item.meta.name}”, version ${item.meta.seq}, including its starting pose.`);
    }catch(err){if(current(turn))status(err.message);}
    finally{setBusy(false);}
  }
  async function showList(append=false){
    const turn=generation;
    setBusy(true);
    if(!append){listCursor=null;$('library-list').replaceChildren();}
    status('Loading shared programs…');
    try{
      const api=await connect(),page=await api.list(listCursor);
      if(!current(turn))return;
      for(const entry of page.items)row(`${entry.name} · v${entry.seq} · ${entry.nickname||'student'} · ${entry.id.slice(0,6)}`,()=>loadRow(entry,turn));
      listCursor=page.cursor;$('library-more').hidden=!listCursor;
      status($('library-list').childElementCount?'Anyone using this simulator can edit these programs. Use project names or nicknames only.':'No shared programs yet. Save a copy to start one.');
    }catch(err){if(current(turn))status(err.message);}
    finally{setBusy(false);}
  }
  async function showHistory(append=false){
    const turn=generation,program=selected;
    if(!program)return;
    setBusy(true);if(!append){historyCursor=0;$('library-list').replaceChildren();}
    status('Loading revision history…');
    try{
      const api=await connect(),page=await api.history(program.id,historyCursor);
      if(!current(turn))return;
      for(const revision of page.items)row(`Restore v${revision.seq} · ${revision.nickname||'student'} · ${new Date(revision.updatedAt).toLocaleString()}`,async()=>{
        if(busy)return;setBusy(true);
        try{
          const item=await api.load(program.id,revision.revision);
          if(!current(turn))return;
          validateCandidate(item.payload);
          if(!confirm(`Restore version ${revision.seq} of “${program.meta.name}”? This publishes a new version for everyone and replaces your workspace. Old history stays intact.`))return;
          const saved=await api.save({programId:program.id,base:program.meta,name:program.meta.name,nickname:$('library-nickname').value,payload:item.payload,restoredFrom:revision.revision});
          if(current(turn)){restore(item.payload);selection(saved);close();message(`Restored version ${revision.seq} as new version ${saved.meta.seq}. History is intact.`);}
          else message('The requested history restore was saved to the shared library. Your current workspace was left unchanged.');
        }catch(err){if(current(turn))status(err.message);}
        finally{setBusy(false);}
      });
      historyCursor=page.cursor;$('library-more').hidden=!historyCursor;
      status('History is permanent. Restoring creates a new shared version; it never changes the old one.');
    }catch(err){if(current(turn))status(err.message);}
    finally{setBusy(false);}
  }
  function open(nextMode){
    if(busy)return;
    generation++;mode=nextMode;
    $('library-list').replaceChildren();$('library-more').hidden=true;
    $('library-save-fields').hidden=!['save','copy'].includes(mode);
    $('library-submit').hidden=!['save','copy'].includes(mode);
    $('library-title').textContent=mode==='list'?'Shared programs':mode==='history'?'Revision history':mode==='copy'?'Save a copy':'Save shared program';
    $('library-name').value=selected?selected.meta.name+(mode==='copy'?' copy':''):'';
    $('library-nickname').value='';status('');dialog.showModal();
    if(mode==='list')showList();else if(mode==='history')showHistory();
    else{status('Everyone can load and edit these programs. No real names or personal information. Internet required.');$('library-name').focus();}
  }
  $('library-open').onclick=()=>open('list');
  $('library-save').onclick=()=>open(selected?'save':'copy');
  $('library-copy').onclick=()=>open('copy');
  $('library-history').onclick=()=>open('history');
  $('library-more').onclick=()=>mode==='history'?showHistory(true):showList(true);
  $('library-submit').onclick=async()=>{
    if(busy)return;
    const name=$('library-name').value.trim(),nickname=$('library-nickname').value.trim();
    if(!validProjectName(name)){status('Name: 1–64 letters, numbers, spaces, dashes or underscores; start with a letter or number.');return;}
    if(!/^[A-Za-z0-9 _-]{0,32}$/.test(nickname)){status('Nickname: up to 32 letters, numbers, spaces, dashes or underscores.');return;}
    const turn=generation,base=mode==='save'?selected:null;
    let payload;
    try{payload=capture();validateCandidate(payload);}catch(err){status(err.message);return;}
    if(base&&!confirm(`Save a new version of “${base.meta.name}” for everyone? Previous versions stay in history.`))return;
    setBusy(true);status('Saving…');
    try{
      const api=await connect();if(!current(turn))return;
      const result=await api.save({...(base?{programId:base.id,base:base.meta}:{}),name,nickname,payload});
      if(current(turn)){selection(result);close();}
      message(`Saved “${name}” to the shared library as version ${result.meta.seq}.`);
    }catch(err){if(current(turn))status(err.message);}
    finally{setBusy(false);}
  };
  selection(null);
  return {clearSelection:()=>selection(null)};
}
