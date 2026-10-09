import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Sim,normalizeConfig} from '../src/sim.js';
import {createPracticeSession} from '../src/practice-session.js';
import {installSavedWorkspace} from '../src/workspace-transaction.js';
import {programToJson} from '../src/blocks-json.js';
import * as trainingAPI from '../src/training.js';
const source=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
const setup=source.slice(source.indexOf('function setupTraining()'),source.indexOf('function beginTrainingRun()'));
const persist=source.slice(source.indexOf('function save()'),source.indexOf('\nconst sim ='));
let focused=null;
class El {
 constructor(){this.dataset={};this.disabled=false;this.hidden=false;this.open=false;this.value='';this.textContent='';this.children=[];this.events={};this.attrs={};}
 append(x){this.children.push(x)}replaceChildren(){this.children=[]}
 click(){this.onclick?.()}addEventListener(name,fn){this.events[name]=fn}
 focus(){focused=this}setAttribute(k,v){this.attrs[k]=v}
 querySelectorAll(){return this.children.flatMap(c=>[...(c.dataset.challenge?[c]:[]),...c.querySelectorAll()]);}
 showModal(){this.open=true;focused=$('training-close')}
 close(){this.open=false;this.events.close?.()}
 getBoundingClientRect(){return {left:10,right:100,top:10,bottom:100}}
}
const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id)};
$('library-current').textContent='Loaded shared program v7';$('library-history').disabled=false;$('trial-scenario').value='ideal';
const document={createElement:()=>new El(),querySelector:s=>s==='dialog[open]'?($('training-picker').open?$('training-picker'):null):new El(),querySelectorAll:()=>[]};
const B={Workspace:class {constructor(){this.data={}}dispose(){}},Events:{disable(){},enable(){}},serialization:{workspaces:{save:w=>structuredClone(w.data),load:(data,w)=>{w.data=structuredClone(data)}}}};
const raw={blocks:{languageVersion:0,blocks:[{type:'sim_num',id:'draft',fields:{V:42},disabledReasons:['MANUALLY_DISABLED']}]}};
const ws={data:structuredClone(raw),addChangeListener(){}};
const state={ws:raw,program:{},sounds:{retained:3},cfg:normalizeConfig({track:119}),start:{x:140,y:230,h:17},pieces:[{id:'piece',x:300,y:500,w:20,h:20}],docks:{D1:'M13'},approach:{},score:{m02:2},tokens:4,mat:'plain',soundOn:false,scale:.5};
const sim=new Sim(state.cfg,state.start,state.pieces),storage=new Map();
const localStorage={setItem:(k,v)=>storage.set(k,v)};
const noop=()=>{};
const ctx={...trainingAPI,createPracticeSession,installSavedWorkspace,programToJson,normalizeConfig,state,ws,sim,$,document,window:{Blockly:B},localStorage,refs:{},AUTO_KEYS:[],setMat:noop,renderStart:noop,renderRobot:noop,renderScore:noop,renderDocks:noop,drawField:noop,showMsg:noop,startTrials:noop,finishTrainingRun:noop};
const api=Function(...Object.keys(ctx),`let training=null,loadingWs=false,projectGeneration=0,trialGeneration=0,trainingRun=null,trialPaths=[],hintCount=0,trialBusy=false,lastMission='',recoveryError=null;const STORE='main',PRACTICE_STORE='practice',practiceDrafts={};function cancelTrials(){trialGeneration++;trialBusy=false;} ${persist}\n${setup}\nsave();setupTraining();return {training,save,setRecovery:value=>recoveryError=value};`)(...Object.values(ctx));
const before=structuredClone(state),stored=storage.get('main');

const buttons=$('training-list').querySelectorAll('button');assert.equal(buttons.length,5);assert.equal($('training-list').children.length,3);
const open=()=>{$('training-open').click();assert.equal($('training-picker').open,true)};
const enter=id=>{open();buttons.find(b=>b.dataset.challenge===id).click();assert.equal($('training-picker').open,false);assert.equal(api.training.active,id);assert.equal(focused,$('training-title'));};
for(let i=0;i<2;i++){
 open();$('training-close').click();assert.equal(focused,$('training-open'));assert.deepEqual(state,before);assert.equal(storage.get('main'),stored);
 open();$('training-picker').events.click({target:$('training-picker'),clientX:50,clientY:50});assert.equal($('training-picker').open,true,'interior whitespace must not dismiss');
 $('training-picker').events.click({target:$('training-picker'),clientX:1,clientY:1});assert.equal($('training-picker').open,false);assert.deepEqual(ws.data,before.ws);
}
enter('target');assert.equal($('library-save').disabled,true);assert.equal(storage.get('main'),stored);ws.data.blocks.blocks[0].id='edited-practice';api.save();assert.equal(storage.get('main'),stored);
$('training-switch').click();assert.equal($('training-picker').open,true);assert.equal(buttons[0].attrs['aria-pressed'],'true');$('training-close').click();assert.equal(focused,$('training-switch'));assert.equal(ws.data.blocks.blocks[0].id,'edited-practice');
for(const id of ['line','heading','obstacle','follow','target'])enter(id);
assert.equal(ws.data.blocks.blocks[0].id,'edited-practice');assert.equal($('training-help').open,false);assert.equal($('trial-options').open,false);
$('training-leave').click();assert.equal(focused,$('training-open'));assert.equal($('training-panel').hidden,true);assert.deepEqual(state,before);assert.deepEqual(ws.data,before.ws);assert.deepEqual(sim.cfg,before.cfg);assert.deepEqual(sim.start,before.start);assert.equal($('library-save').disabled,false);assert.equal($('library-history').disabled,false);assert.equal($('library-current').textContent,'Loaded shared program v7');assert.equal(storage.get('main'),stored);
$('training-leave').click();assert.deepEqual(state,before);enter('target');assert.equal(ws.data.blocks.blocks[0].id,'edited-practice');$('training-leave').click();assert.deepEqual(state,before);
console.log('PASS actual app modal/setup/save callbacks: open, cancel, backdrop, all five labs, switch, leave, focus destinations and unsaved main restoration. DOM/Blockly shims; no browser rendering claim.');

open();api.setRecovery('blocked');buttons[0].click();assert.equal($('training-picker').open,true);assert.match($('training-picker-status').textContent,/Recover/);assert.deepEqual(state,before);api.setRecovery(null);$('training-close').click();
const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),css=await readFile(new URL('../style.css',import.meta.url),'utf8');
assert.match(html,/<dialog id="training-picker" aria-labelledby="training-picker-title" aria-describedby="training-picker-description">/);
assert.match(html,/<button id="training-close"[^>]*autofocus/);
assert.match(html,/<section id="training-panel"[^>]* hidden>/);
assert.doesNotMatch(html,/id="training-choice"|id="training-enter"|class="debugger-panel" open/);
assert.match(html,/<button id="gh-open" hidden /);assert.match(css,/#gh-open\[hidden\]\{display:none!important\}/);
for(const id of ['file','share','library-open','gh-open'])assert.ok(html.includes('id="'+id+'"'),id+' setup target retained');
assert.match(source,/\$\('gh-open'\)\.onclick/);assert.match(html,/<dialog id="gh"/);
