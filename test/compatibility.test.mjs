import test from 'node:test';
import assert from 'node:assert/strict';
import { SPEC, node, lit, emptyProgram } from '../src/blocks.js';
import { prepareProgram, CompatibilityError } from '../src/compatibility.js';
import { buildProject, convertProject, exportLlsp3, importProject } from '../src/spike-io.js';
import { programToJson, jsonToProgram } from '../src/blocks-json.js';
import { installProgram } from '../src/program-transaction.js';
import { encodeShare, decodeShare } from '../src/share.js';
import { Sim } from '../src/sim.js';

const program = (stack = [], extra = {}) => ({ ...emptyProgram(), stacks: [stack], ...extra });
const native = stack => buildProject(program(stack)).project;
const blocks = p => p.targets.find(t => !t.isStage).blocks;
const find = (p, opcode) => Object.values(blocks(p)).find(b => b.opcode === opcode);
const sim = () => new Sim({ collide: false, ramp: 0 }, { x: 1000, y: 600, h: 0 }, []);
const run = (p, seconds = 10) => { const s = sim(); s.run(p); for (let t = 0; s.running && t < seconds; t += .01) s.advance(.01); return s; };
const buffer = a => a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength);

test('stock straight and steering menus/defaults use distinct units', () => {
  assert.deepEqual(SPEC.move.p.dir.opts, ['forward', 'back']);
  assert.deepEqual(SPEC.steer.p.unit.opts, ['rotations', 'degrees', 'seconds']);
  assert.equal(node('move').unit, 'rotations');
  assert.equal(node('setDistance').cm.v, '17.5');
  assert.equal(node('whenDistance').val.v, '8');
  assert.equal(node('distance').unit, '%');
});

test('legacy turns migrate in runtime, editor, native files and old share URLs without changing wheel degrees', async () => {
  for (const dir of ['clockwise', 'counterclockwise']) {
    const old = program([node('move', { dir, val: 180, unit: 'degrees' })]);
    const copy = structuredClone(old), migrated = prepareProgram(old);
    assert.equal(migrated.stacks[0][0].t, 'steer');
    assert.equal(migrated.stacks[0][0].val.v, '180');
    assert.equal(migrated.stacks[0][0].steer.v, dir === 'clockwise' ? '100' : '-100');
    assert.deepEqual(old, copy);
    const s = run(old);
    assert.ok(Math.abs(Math.abs(s.pose.h) - 90) < 2, String(s.pose.h));
    assert.deepEqual(jsonToProgram(programToJson(old)).program, migrated);
    assert.deepEqual((await importProject(buffer(exportLlsp3(old).zip))).program, migrated);
    const raw = new TextEncoder().encode(JSON.stringify({ v: 1, program: old }));
    const packed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const code = Buffer.from(packed).toString('base64url');
    assert.deepEqual((await decodeShare(code)).program, migrated);
  }
  assert.throws(() => prepareProgram(program([node('move', { dir: 'clockwise', unit: 'cm' })])), /unit.*cm/);
});

test('native current opcodes and shadows roundtrip for relative motors, continuous tank, stop and pixels', async () => {
  const p = program([node('motorSetRel'), node('startTank'), node('stopOthers'), node('setPixel'), node('show', { text: node('motorRel') }), node('stop', { opt: 'program' })]);
  const out = buildProject(p);
  for (const op of ['flippermoremotor_motorSetDegreeCounted', 'flippermoremove_startDualSpeed', 'flippercontrol_stopOtherStacks', 'flippermoremotor_position', 'flippercontrol_stop', 'flipperlight_matrix-pixel-index']) assert.ok(find(out.project, op), op);
  assert.equal(find(out.project, 'flippercontrol_stop').fields.STOP_OPTION[0], 'program');
  assert.ok(find(out.project, 'flippermoremotor_multiple-port-selector'));
  assert.equal(out.dropped, 0);
  assert.deepEqual((await importProject(buffer(exportLlsp3(p).zip))).program, p);
});

test('distance %, cm, inches and no-return preserve units through all three blocks', () => {
  for (const unit of ['%', 'cm', 'inches']) {
    const p = program([node('show', { text: node('distance', { port: 'D', unit }) }), node('if', { cond: node('isDistance', { port: 'D', unit, val: 10 }) })], { events: [{ hat: node('whenDistance', { port: 'D', unit }), body: [node('beep')] }] });
    assert.deepEqual(convertProject(buildProject(p).project).program, p);
    const s = sim(); s.sens.dist = 25.4;
    assert.equal(s.val(node('distance', { port: 'D', unit })), unit === '%' ? 12.7 : unit === 'inches' ? 10 : 25.4);
    s.sens.dist = null;
    assert.equal(s.val(node('distance', { port: 'D', unit })), unit === '%' ? 100 : unit === 'inches' ? 200 / 2.54 : 200);
  }
  const s = run(program([node('setDistance', { cm: 7, unit: 'inches' }), node('wait', { val: .1 })]));
  assert.equal(s.cmPerRot, 17.78);
});

test('released button/force predicates are retained; unsupported force magnitude and axes fail closed', () => {
  const p = program([node('if', { cond: node('isPressed', { port: 'F', opt: 'released' }) }), node('if', { cond: node('buttonPressed', { event: 'released' }) })]);
  assert.deepEqual(convertProject(buildProject(p).project).program, p);
  const s = sim(); s.cfg.forcePort = 'F'; s.pressed = () => false;
  assert.equal(s.val(p.stacks[0][0].cond), true);
  assert.equal(s.val(p.stacks[0][1].cond), true);
  s.setButton('left', true); assert.equal(s.val(p.stacks[0][1].cond), false);
  for (const opt of ['hardpressed', 'pressurechanged']) assert.throws(() => prepareProgram(program([], { events: [{ hat: node('whenPressed', { opt }), body: [] }] })), /unsupported option/);
  for (const axis of ['pitch', 'roll']) assert.throws(() => run(program([node('show', { text: node('angle', { axis }) })])), /unsupported option/);
});

test('unknown nested reporters, procedures, commands and event hats block every output path', async () => {
  const cases = [
    program([{ t: 'unknownCommand' }]),
    program([node('if', { cond: node('eq', { a: { t: 'noteR', op: 'flippersensors_force' }, b: 1 }) })]),
    program([], { events: [{ hat: { t: 'whenTilted' }, body: [node('show')] }] }),
    program([], { procs: { bad: { params: [], body: [node('show', { text: { t: 'unknownReporter' } })] } } }),
    program([node('tank')]), program([node('playSound')]), program([], { sounds: { Cat: 1 } })
  ];
  for (const p of cases) {
    const before = structuredClone(p), s = sim(), pose = { ...s.pose };
    for (const fn of [prepareProgram, buildProject, exportLlsp3, programToJson, p => s.run(p)]) assert.throws(() => fn(p), CompatibilityError);
    await assert.rejects(encodeShare({ program: p }), CompatibilityError);
    assert.deepEqual(s.pose, pose); assert.deepEqual(p, before);
  }
});

test('native unsupported hats/reporters/commands, dynamic selectors and extra fields cannot be dropped', () => {
  const examples = [];
  for (const op of ['flipperevents_whenTilted', 'music_playDrumForBeats', 'flippersensors_force']) {
    const p = native([node('show')]); const b = find(p, 'flipperlight_lightDisplayText'); b.opcode = op; examples.push(p);
  }
  const nested = native([node('show', { text: node('add', { a: 1, b: 2 }) })]); find(nested, 'operator_add').opcode = 'flippersensors_force'; examples.push(nested);
  const port = native([node('motor')]); find(port, 'flippermotor_motorTurnForDirection').inputs.PORT = [3, [12, 'portName', 'id'], [10, 'A']]; examples.push(port);
  const field = native([node('move')]); find(field, 'flippermove_move').fields.EXTRA = ['lost', null]; examples.push(field);
  for (const p of examples) assert.throws(() => convertProject(p), CompatibilityError);
});

test('initial values, sound assets, procedure collisions and malformed graphs are rejected explicitly', () => {
  for (const mutate of [
    p => { p.targets[1].variables.v = ['score', 42]; },
    p => { p.targets[1].lists.l = ['items', ['keep me']]; },
    p => { p.targets[1].sounds = [{ name: 'Cat', assetId: 'x' }]; },
    p => { const b = find(p, 'flipperlight_lightDisplayText'); b.next = Object.keys(blocks(p)).find(id => blocks(p)[id] === b); }
  ]) { const p = native([node('show')]); mutate(p); assert.throws(() => convertProject(p), CompatibilityError); }
  const p = program([], { procs: { one: { params: [], body: [] }, two: { params: [], body: [] } } });
  const file = buildProject(p).project;
  const defs = Object.values(blocks(file)).filter(b => b.opcode === 'procedures_prototype');
  defs[1].mutation.proccode = defs[0].mutation.proccode;
  assert.throws(() => convertProject(file), /colliding/);
});

test('events-only native projects and nested typed My Blocks survive roundtrip', () => {
  const p = program([], { stacks: [], events: [{ hat: node('whenButton'), body: [{ t: 'call', name: 'set', args: { value: lit(12), yes: node('eq', { a: 1, b: 1 }) } }] }], procs: { set: { params: [{ name: 'value', kind: 'n' }, { name: 'yes', kind: 'b' }], body: [node('if', { cond: { t: 'arg', name: 'yes' }, body: [node('setVar', { name: 'x', val: { t: 'arg', name: 'value' } })] })] } }, vars: ['x'] });
  const back = convertProject(buildProject(p).project).program;
  assert.equal(back.events.length, 1);
  const s = sim(); s.run(back); s.setButton('left', true); s.advance(.1); assert.equal(s.vars.x, '12');
});

test('this stack, other stacks, all and program have distinct scheduling/exit effects', () => {
  for (const opt of ['this stack', 'all', 'program', 'others']) {
    const stopper = opt === 'others' ? node('stopOthers') : node('stop', { opt });
    const p = program([], { stacks: [[node('wait', { val: .02 }), stopper, node('setVar', { name: 'after', val: 1 })], [node('wait', { val: .1 }), node('setVar', { name: 'other', val: 1 })]] });
    const s = run(p);
    assert.equal(s.vars.after, opt === 'others' ? '1' : undefined, opt);
    assert.equal(s.vars.other, opt === 'this stack' ? '1' : undefined, opt);
    assert.equal(s.exited, opt === 'program', opt);
  }
  for (const [legacy, expected] of [['this script', 'this stack'], ['other scripts in sprite', 'others']]) {
    const p = native([node('stop')]), b = find(p, 'flippercontrol_stop'); b.opcode = 'control_stop'; b.fields.STOP_OPTION[0] = legacy;
    const n = convertProject(p).program.stacks[0][0]; assert.equal(expected === 'others' ? n.t : n.opt, expected === 'others' ? 'stopOthers' : expected);
  }
});

test('individual drive motors move the chassis with mirrored shaft direction, absolute and relative encoders stay independent', () => {
  for (const [port, dir, expectedHeading] of [['A', 'counterclockwise', 1], ['B', 'clockwise', -1]]) {
    const s = run(program([node('motor', { port, dir, val: 90, unit: 'degrees' })]));
    assert.ok(s.pose.y > 610); assert.equal(Math.sign(s.pose.h), expectedHeading);
    assert.ok(Math.abs(Math.abs(s.arms[port]) - 90) < .01);
  }
  const s = run(program([node('motor', { port: 'B', val: 90, unit: 'degrees' }), node('motorSetRel', { port: 'B', val: -720 })]));
  assert.equal(s.val(node('motorPos', { port: 'B' })), 90);
  assert.equal(s.val(node('motorRel', { port: 'B' })), -720);
  s.arms.B = 359.9; assert.equal(s.val(node('motorPos', { port: 'B' })), 0);
  const continuous = run(program([node('motorStart', { port: 'B' }), node('wait', { val: .2 }), node('motorStop', { port: 'B' })]));
  assert.ok(continuous.pose.y > 600); assert.deepEqual(continuous.motorRun, {});
});

test('timed movement and motor durations clamp to 0–60 seconds, speed clamps to ±100', () => {
  for (const t of ['move', 'steer', 'motor']) {
    const s = sim(); const block = node(t, { val: -2, unit: 'seconds', port: 'B' }); s.run(program([block])); s.advance(.1);
    assert.equal(s.pose.y, 600); assert.equal(s.pose.h, 0);
    s.run(program([node(t, { val: 100, unit: 'seconds', port: 'B' })])); s.advance(.01);
    assert.equal((s.driveAction || s.motorActions.B).target, 60);
  }
  const s = run(program([node('speed', { pct: 500 }), node('motorSpeed', { port: 'B', pct: -200 })]));
  assert.equal(s.speedPct, 100); assert.equal(s.motorSpeed.B, -100);
});

test('port multiplicity is permitted only for motor commands; unsupported options never become defaults', () => {
  assert.doesNotThrow(() => buildProject(program([node('motor', { port: 'AEF' })])));
  for (const e of [node('distance', { port: 'AB' }), node('motorPos', { port: 'AB' }), node('isColor', { color: 'azure' })]) assert.throws(() => buildProject(program([node('show', { text: e })])), /unsupported option/);
  const p = native([node('if', { cond: node('isColor') })]); find(p, 'flippersensors_color-selector').fields['field_flippersensors_color-selector'][0] = '-2';
  assert.throws(() => convertProject(p), /unsupported option/);
});

test('transactional editor installation preserves exact workspace on repeated rejection and partial load errors', () => {
  let current = programToJson(program([node('show', { text: 'keep me' })]));
  const before = structuredClone(current);
  const editor = { read: () => structuredClone(current), write: x => { current = structuredClone(x); } };
  for (let i = 0; i < 3; i++) {
    assert.throws(() => installProgram(program([{ t: 'unknown' }]), editor), CompatibilityError);
    assert.deepEqual(current, before);
  }
  let fail = true;
  editor.write = x => { current = structuredClone(x); if (fail) { fail = false; throw new Error('partial editor failure'); } };
  assert.throws(() => installProgram(program([node('beep')]), editor), /partial editor failure/);
  assert.deepEqual(current, before);
  installProgram(program([node('show', { text: 'replacement' })]), editor);
  assert.equal(jsonToProgram(current).program.stacks[0][0].text.v, 'replacement');
  const bad = { blocks: { blocks: [{ type: 'sim_whenUnknown', next: { block: { type: 'sim_show' } } }] } };
  assert.throws(() => jsonToProgram(bad), /sim_whenUnknown/);
});

test('known loose, disabled and disconnected blocks cannot disappear from project output', () => {
  const json=programToJson(program([node('show')]));
  json.blocks.blocks.push({type:'sim_move'});
  assert.throws(()=>jsonToProgram(json),/loose blocks/);
  json.blocks.blocks.pop();json.blocks.blocks[0].next.block.enabled=false;
  assert.throws(()=>jsonToProgram(json),/disabled blocks/);
  const p=native([node('show')]);blocks(p).orphan={opcode:'control_wait',inputs:{DURATION:[1,[4,'1']]},fields:{},next:null,parent:null,shadow:false,topLevel:false};
  assert.throws(()=>convertProject(p),/disconnected block/);
});

test('native variable and list scopes with duplicate names are rejected before name merging', () => {
  for(const kind of ['variables','lists']){
    const p=native([node('show')]),value=kind==='variables'?0:[];
    p.targets[0][kind].global=['same',value];p.targets[1][kind].local=['same',value];
    assert.throws(()=>convertProject(p),/Duplicate .* name/);
  }
});

test('variables, lists, text in numeric sockets and multi-port selections survive editor conversion', () => {
 const p=program([node('setVar',{name:'counter',val:7}),node('listAdd',{list:'samples',item:'keep'}),node('show',{text:node('listContents',{list:'samples'})}),node('motor',{port:'BA',val:lit('not a number')})],{vars:['counter'],lists:['samples']});
 const canonical=prepareProgram(p),back=jsonToProgram(programToJson(p)).program;
 assert.deepEqual(back,canonical);assert.equal(back.stacks[0][3].port,'AB');
 const s=run(program(p.stacks[0].slice(0,3),{vars:p.vars,lists:p.lists}));assert.equal(s.vars.counter,'7');assert.deepEqual(s.lists.samples,['keep']);
});

test('editor normalization that silently loses data rolls back the entire installation', () => {
 let current=programToJson(program([node('show',{text:'original'})]));const before=structuredClone(current);let lose=true;
 const editor={read:()=>structuredClone(current),write:json=>{current=structuredClone(json);if(lose){lose=false;current.variables=[];}}};
 assert.throws(()=>installProgram(program([node('show')],{vars:['unused but important']}),editor),/changed program data/);
 assert.deepEqual(current,before);
});

test('unexpected block properties and object literals cannot be silently discarded', () => {
 assert.throws(()=>prepareProgram(program([{...node('show'),extra:{t:'unknown'}}])),/unsupported block property/);
 assert.throws(()=>prepareProgram(program([node('show',{text:{t:'text',v:{secret:'data'}}})])),/invalid literal/);
});

test('native symbol IDs must match names instead of silently selecting another variable or list', () => {
 for(const [kind,statement,field] of [['variables',node('setVar',{name:'counter'}),'VARIABLE'],['lists',node('listAdd',{list:'items'}),'LIST']]){
  const p=native([statement]);const b=Object.values(blocks(p)).find(b=>b.fields?.[field]);b.fields[field][0]='renamed-without-changing-id';
  assert.throws(()=>convertProject(p),/invalid .* reference/);
 }
});

test('event-only native imports infer sensor ports and trigger their actual runtime handlers', async () => {
 const cases=[
  {hat:node('whenDistance',{port:'E',cmp:'<',val:10,unit:'cm'}),key:'distPort',before:{dist:30},after:{dist:5}},
  {hat:node('whenColor',{port:'F',color:'red'}),key:'colorPort',before:{color:'white'},after:{color:'red'}},
  {hat:node('whenPressed',{port:'C',opt:'pressed'}),key:'forcePort',before:{pressed:false},after:{pressed:true}}
 ];
 for(const {hat,key,before,after} of cases){
  const p=program([],{stacks:[],vars:['fired'],events:[{hat,body:[node('setVar',{name:'fired',val:1})]}]});
  const result=await importProject(buffer(exportLlsp3(p).zip));assert.equal(result.cfg[key],hat.port);
  const s=new Sim({collide:false,ramp:0,...result.cfg},{x:1000,y:600,h:0},[]);
  let reading=before;s.readSensors=()=>({color:'white',reflect:100,dist:30,yaw:0,...reading});s.pressed=()=>!!reading.pressed;
  s.run(result.program);s.advance(.01);assert.equal(s.vars.fired,0,hat.t+' initially false');
  reading=after;for(let i=0;i<5;i++)s.advance(.01);
  assert.equal(s.vars.fired,'1',hat.t+' handler ran');
 }
});

test('same-kind sensor port conflicts reject native imports transactionally and every program output path', async () => {
 for(const [hatType,reporter,key] of [['whenDistance','distance','distPort'],['whenColor','color','colorPort'],['whenPressed','isPressed','forcePort']]){
  const body=reporter==='isPressed'?[node('if',{cond:node(reporter,{port:'E'})})]:[node('show',{text:node(reporter,{port:'E'})})];
  const valid=program(body,{events:[{hat:node(hatType,{port:'E'}),body:[node('show')]}]});
  assert.equal(convertProject(buildProject(valid).project).cfg[key],'E');
  const bad=structuredClone(valid);bad.events[0].hat.port='F';
  for(const fn of [prepareProgram,buildProject,programToJson])assert.throws(()=>fn(bad),/Conflicting .* sensor ports/);
  await assert.rejects(encodeShare({program:bad}),/Conflicting .* sensor ports/);
  const nativeFile=buildProject(valid).project;
  const selector=Object.values(blocks(nativeFile)).find(b=>b.opcode.startsWith('flipperevents_')&&b.opcode.endsWith('sensor-selector'));
  assert.ok(selector);Object.values(selector.fields)[0][0]='F';
  const before={cfg:{pair:'BA',colorPort:'A',distPort:'B',forcePort:'D'},workspace:programToJson(program([node('show',{text:'keep'})]))},state=structuredClone(before);
  const tryImport=()=>{const imported=convertProject(nativeFile);installProgram(imported.program,{read:()=>state.workspace,write:value=>{state.workspace=value}});Object.assign(state.cfg,imported.cfg)};
  for(let i=0;i<2;i++){assert.throws(tryImport,/Conflicting .* sensor ports/);assert.deepEqual(state,before);}
 }
});

test('prototype-sensitive symbols reject before native conversion, runtime and every output path', async()=>{
 for(const name of ['__proto__','constructor','toString','hasOwnProperty'])for(const kind of ['vars','lists','procs','params']){
  const examples = {
   vars: () => program([node('setVar', { name, val: 7 }), node('show', { text: { t: 'var', name } })], { vars: [name] }),
   lists: () => program([node('listAdd', { list: name, item: 'keep' })], { lists: [name] }),
   procs: () => program([], { procs: Object.fromEntries([[name, { params: [], body: [node('show')] }]]) }),
   params: () => program([], { procs: { valid: { params: [{ name, kind: 'n' }], body: [node('show', { text: { t: 'arg', name } })] } } })
  };
  const p = examples[kind]();
  const before=structuredClone(p),s=sim();s.vars.keep=42;
  for(const fn of [prepareProgram,buildProject,programToJson,p=>s.run(p)])assert.throws(()=>fn(p),/unsupported name/);
  await assert.rejects(encodeShare({program:p}),/unsupported name/);assert.equal(s.vars.keep,42);assert.deepEqual(p,before);
 }
 for(const kind of ['vars','lists']){
  assert.throws(()=>prepareProgram(program([],{[kind]:['duplicate','duplicate']})),/duplicate name/);
 }
});

test('workspace symbol IDs cannot hide declarations or overwrite another scope',()=>{
 const ws=programToJson(program([node('setVar',{name:'counter',val:7})],{vars:['counter']}));
 const old=ws.variables[0].id;ws.variables[0].id='__proto__';
 const renamed=JSON.parse(JSON.stringify(ws).replaceAll(old,'__proto__'));
 assert.deepEqual(prepareProgram(jsonToProgram(renamed).program).vars,['counter']);
 const bad=structuredClone(renamed);bad.variables[0].name='__proto__';assert.throws(()=>jsonToProgram(bad),/Unsupported name/);
 const duplicate=structuredClone(ws);duplicate.variables.push({...duplicate.variables[0],type:'list',name:'items'});assert.throws(()=>jsonToProgram(duplicate),/Duplicate workspace symbol ID/);
});
