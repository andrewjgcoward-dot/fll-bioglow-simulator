// DOM-only controller with injectable Auth/API for isolated tests and previews.
export function setupAdminUI({document,auth,api}) {
  const $=id=>document.getElementById(id);
  let rows=[],cursor=null,busy=false,authorized=false,generation=0,pending=null;
  const status=text=>{$('admin-status').textContent=text;};
  function lock(value){busy=value;document.querySelectorAll('button').forEach(b=>b.disabled=value);$('admin-sign-in').disabled=value||authorized;$('admin-sign-out').disabled=value||!auth.current();$('admin-refresh').disabled=value||!authorized;$('admin-more').disabled=value||!authorized;}
  function render(){
    $('admin-list').replaceChildren();const archived=$('admin-filter').value==='archived';
    for(const row of rows.filter(r=>(r.archived===true)===archived)) {
      const item=document.createElement('article');item.className='admin-row';
      const title=document.createElement('h2');title.textContent=row.name;item.appendChild(title);
      const detail=document.createElement('p');detail.textContent=`Version ${row.seq} · ${row.archived?'Archived':'Active'} · ${row.id.slice(0,8)}`;item.appendChild(detail);
      for(const [action,label] of [['rename','Rename'],[archived?'restore':'archive',archived?'Restore':'Archive']]) {
        const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>open(row,action);item.appendChild(button);
      }
      $('admin-list').appendChild(item);
    }
    $('admin-more').hidden=!cursor;
    $('admin-empty').hidden=$('admin-list').childElementCount>0;
    $('admin-empty').textContent=cursor?'No matching programs on the pages loaded. Choose Load more.':'No programs in this view.';
  }
  async function refresh(append=false){
    if(busy||!authorized)return;const turn=++generation;lock(true);status('Loading programs…');
    try{const page=await api.list(append?cursor:null);if(turn!==generation)return;rows=append?[...rows,...page.items]:page.items;cursor=page.cursor;render();status('Choose a program. Changes add a revision; history is retained.');}
    catch(e){status(e.message);}finally{lock(false);}
  }
  function open(row,action){
    if(busy||pending||!authorized)return;
    pending={id:row.id,base:structuredClone(row),action};
    $('admin-action-title').textContent=action==='rename'?'Rename program':action==='archive'?'Archive program':'Restore program';
    $('admin-action-text').textContent=action==='archive'?`Archive “${row.name}”? It disappears from the student list and cannot be edited until restored. All revisions stay intact.`:action==='restore'?`Restore “${row.name}” to the student list? Students can edit it again. History stays intact.`:`Rename “${row.name}”? Its ID, blocks, pose and earlier revisions stay intact.`;
    $('admin-name-label').hidden=action!=='rename';$('admin-name').value=row.name;
    $('admin-action-status').textContent='';$('admin-confirm').textContent=action==='rename'?'Rename':action==='archive'?'Archive':'Restore';
    $('admin-dialog').showModal();if(action==='rename')$('admin-name').focus();else $('admin-cancel').focus();
  }
  function cancel(){if(busy)return;pending=null;$('admin-dialog').close();}
  $('admin-cancel').onclick=cancel;
  $('admin-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else pending=null;});
  $('admin-confirm').onclick=async()=>{
    if(busy||!pending)return;const operation={...pending,name:$('admin-name').value};lock(true);$('admin-action-status').textContent='Saving…';
    try{const result=await api.change(operation);pending=null;$('admin-dialog').close();status(`Saved version ${result.meta.seq}.`);}
    catch(e){$('admin-action-status').textContent=e.message;return;}
    finally{lock(false);}
    await refresh();
  };
  async function check(){
    authorized=false;rows=[];cursor=null;render();lock(true);
    try{if(!auth.current()){status('Sign in with the approved administrator Google account.');return;}await api.authorize();authorized=true;$('admin-identity').textContent=auth.current().email||'Administrator';status('Administrator verified.');}
    catch(e){status('Admin access could not be verified. Use the approved Google account and check your connection. '+e.message);}
    finally{lock(false);}
    if(authorized)await refresh();
  }
  $('admin-sign-in').onclick=async()=>{if(busy)return;lock(true);try{await auth.signIn();}catch(e){status(e.message);lock(false);return;}lock(false);await check();};
  $('admin-sign-out').onclick=async()=>{if(busy)return;lock(true);try{await auth.signOut();generation++;authorized=false;pending=null;rows=[];cursor=null;$('admin-identity').textContent='';render();status('Signed out.');}catch(e){status(e.message);}finally{lock(false);}};
  $('admin-refresh').onclick=()=>refresh();$('admin-more').onclick=()=>refresh(true);$('admin-filter').onchange=render;
  check();return {refresh};
}
