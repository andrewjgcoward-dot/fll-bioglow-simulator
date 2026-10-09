import test from 'node:test';
import assert from 'node:assert/strict';
import {setupAdminUI} from '../src/admin-ui.js';
import {createSharedLibrary,PAGE_SIZE} from '../src/shared-library.js';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture({signed=true,allowed=true,change}={}) {
 const elements=new Map(),buttons=[];
 class Element {children=[];value='';textContent='';open=false;hidden=false;disabled=false;listeners={};appendChild(x){this.children.push(x);}replaceChildren(){this.children=[];}get childElementCount(){return this.children.length;}showModal(){this.open=true;}close(){this.open=false;}focus(){}addEventListener(n,f){this.listeners[n]=f;}}
 const $=id=>{if(!elements.has(id)){const el=new Element();if(/sign-|refresh|more|confirm|cancel/.test(id))buttons.push(el);elements.set(id,el);}return elements.get(id);};
 $('admin-filter').value='active';
 const document={getElementById:$,querySelectorAll:()=>buttons,createElement:tag=>{const el=new Element();if(tag==='button')buttons.push(el);return el;}};
 let user=signed?{email:'owner@example.test'}:null,calls=[],listCalls=0;
 const rows=[{id:'a'.repeat(32),revision:'b'.repeat(32),seq:1,name:'Test program',archived:false},{id:'c'.repeat(32),revision:'d'.repeat(32),seq:2,name:'Archived program',archived:true}];
 const auth={current:()=>user,signIn:async()=>{user={email:'owner@example.test'};},signOut:async()=>{user=null;}};
 const api={authorize:async()=>{if(!allowed)throw Error('denied');},list:async()=>{listCalls++;return {items:structuredClone(rows),cursor:null};},change:async x=>{calls.push(x);return change?change(x):{meta:{seq:2}};}};
 setupAdminUI({document,auth,api});return {$,calls,rows,api,auth,listCalls:()=>listCalls};
}
test('unsigned and unauthorized accounts cannot reach admin controls',async()=>{
 for(const options of [{signed:false},{allowed:false}]){const f=fixture(options);await tick();assert.equal(f.listCalls(),0);assert.equal(f.$('admin-list').childElementCount,0);assert.equal(f.$('admin-refresh').disabled,true);assert.equal(f.calls.length,0);}
});
test('active/archive views separate programs and cancel has no side effect',async()=>{
 const f=fixture();await tick();let rows=f.$('admin-list').children;assert.equal(rows.length,1);assert.equal(rows[0].children[0].textContent,'Test program');rows[0].children[2].onclick();assert.equal(f.$('admin-dialog').open,true);f.$('admin-cancel').onclick();await f.$('admin-confirm').onclick();assert.equal(f.calls.length,0);
 f.$('admin-filter').value='archived';f.$('admin-filter').onchange();rows=f.$('admin-list').children;assert.equal(rows[0].children[0].textContent,'Archived program');assert.equal(rows[0].children[3].textContent,'Restore');
});
test('repeated dialogs and repeated submit cannot duplicate an admin revision',async()=>{
 let complete;const f=fixture({change:()=>new Promise(r=>complete=r)});await tick();const row=f.$('admin-list').children[0];row.children[2].onclick();row.children[3].onclick();f.$('admin-name').value='Renamed';const first=f.$('admin-confirm').onclick();await f.$('admin-confirm').onclick();f.$('admin-cancel').onclick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'rename');assert.equal(f.calls[0].base.revision,'b'.repeat(32));assert.equal(f.$('admin-dialog').open,true);complete({meta:{seq:2}});await first;assert.equal(f.$('admin-dialog').open,false);
});
test('conflict keeps dialog and proposed name intact; canceled retry writes nothing',async()=>{
 const f=fixture({change:async()=>{throw Error('Someone saved a newer version.');}});await tick();f.$('admin-list').children[0].children[2].onclick();f.$('admin-name').value='Proposed name';await f.$('admin-confirm').onclick();assert.equal(f.$('admin-dialog').open,true);assert.equal(f.$('admin-name').value,'Proposed name');assert.match(f.$('admin-action-status').textContent,/newer/);f.$('admin-cancel').onclick();await f.$('admin-confirm').onclick();assert.equal(f.calls.length,1);
});
test('archive and restore use the selected immutable base and explicit confirmation',async()=>{
 const f=fixture();await tick();f.$('admin-list').children[0].children[3].onclick();assert.match(f.$('admin-action-text').textContent,/cannot be edited until restored/);assert.equal(f.calls.length,0);await f.$('admin-confirm').onclick();assert.equal(f.calls[0].action,'archive');
 f.$('admin-filter').value='archived';f.$('admin-filter').onchange();f.$('admin-list').children[0].children[3].onclick();await f.$('admin-confirm').onclick();assert.equal(f.calls[1].action,'restore');assert.equal(f.calls[1].base.archived,true);
});
test('sign out clears admin results and disables mutations',async()=>{
 const f=fixture();await tick();await f.$('admin-sign-out').onclick();assert.equal(f.$('admin-list').childElementCount,0);assert.equal(f.$('admin-identity').textContent,'');assert.equal(f.$('admin-refresh').disabled,true);
});
test('student pages hide archived rows but retain paging cursor through full archived pages',async()=>{
 const rows=Object.fromEntries(Array.from({length:PAGE_SIZE},(_,n)=>[n.toString(16).padStart(32,'0'),{archived:true,name:'Hidden'}]));const args={request:async()=>rows,session:async()=>({uid:'x'})};const student=await createSharedLibrary(args).list();assert.equal(student.items.length,0);assert.ok(student.cursor);assert.equal((await createSharedLibrary({...args,administrative:true}).list()).items.length,PAGE_SIZE);
});
