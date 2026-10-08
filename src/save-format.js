import { SPEC } from './blocks.js';
// Portable format shared by file downloads, file pickers and any future backend.
// Captures the raw Blockly workspace: no AST conversion that could discard layout,
// comments, disabled blocks, or disconnected work in progress.
export const MAX_SAVE_BYTES = 1024 * 1024;
export const validSaveName = name => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name);
const reserved = name => ['__proto__','constructor','prototype','__new__'].includes(name);
const fail = message => { throw new Error(message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed, required=[]) => record(value) && Object.keys(value).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(value,k));
export function validateSave(data) {
  if (!keys(data,['version','workspace','start'],['version','workspace','start']) || data.version !== 1)
    fail('Unknown or invalid simulator save format.');
  if (!keys(data.start,['x','y','h'],['x','y','h']) || !Object.values(data.start).every(Number.isFinite)
      || data.start.x < 0 || data.start.x > 2000 || data.start.y < 0 || data.start.y > 1143 || Math.abs(data.start.h) > 1000000)
    fail('Invalid starting pose.');
  if (!keys(data.workspace,['blocks','variables'])) fail('Invalid workspace.');
  if (Object.hasOwn(data.workspace,'blocks') && (!keys(data.workspace.blocks,['languageVersion','blocks'],['languageVersion','blocks'])
    || data.workspace.blocks.languageVersion !== 0 || !Array.isArray(data.workspace.blocks.blocks))) fail('Invalid block workspace.');
  if (Object.hasOwn(data.workspace,'variables') && !Array.isArray(data.workspace.variables)) fail('Invalid variables.');
  const types = new Set([...Object.keys(SPEC).map(t=>'sim_'+t), 'sim_var','sim_start','sim_define','sim_call','sim_arg','sim_arg_b','sim_num','sim_text','sim_note','sim_noteR']);
  const variables = data.workspace.variables || [], ids = new Set(), blockIds = new Set();
  if (variables.length > 1000) fail('Too many variables.');
  for (const v of variables) {
    if (!keys(v,['name','id','type'],['name','id']) || typeof v.name !== 'string' || reserved(v.name) || v.name.length>4096 || typeof v.id!=='string' || v.id.length>200 || ids.has(v.id) || !['','list'].includes(v.type ?? '')) fail('Invalid variable declaration.');
    ids.add(v.id);
  }
  let blocks=0;
  function block(b,depth=0) {
    if(++blocks>2000 || depth>80) fail('Workspace has too many blocks or nesting levels.');
    if(!keys(b,['type','id','x','y','fields','inputs','next','extraState','enabled','disabledReasons','collapsed','inline','deletable','movable','editable','data','icons'],['type']) || !types.has(b.type)) fail('Unknown or malformed block.');
    if(Object.hasOwn(b,'id')) { if(typeof b.id!=='string'||b.id.length>200||blockIds.has(b.id))fail('Invalid block ID.'); blockIds.add(b.id); }
    for(const key of ['x','y'])if(Object.hasOwn(b,key)&&(!Number.isFinite(b[key])||Math.abs(b[key])>1000000))fail('Invalid block position.');
    for(const key of ['enabled','collapsed','inline','deletable','movable','editable'])if(Object.hasOwn(b,key)&&typeof b[key]!=='boolean')fail('Invalid block flag.');
    if(Object.hasOwn(b,'disabledReasons')&&(!Array.isArray(b.disabledReasons)||b.disabledReasons.length>20||b.disabledReasons.some(x=>typeof x!=='string'||x.length>200)))fail('Invalid disabled block.');
    if(Object.hasOwn(b,'data')&&(typeof b.data!=='string'||b.data.length>4096))fail('Invalid block data.');
    if(Object.hasOwn(b,'fields')) {
      if(!record(b.fields)||Object.keys(b.fields).length>40)fail('Invalid fields.');
      for(const [key,value] of Object.entries(b.fields)) {
        if (key === 'msg' && value === '__new__') fail('Invalid message name.');
        if(record(value)){if(!keys(value,['id'],['id'])||!ids.has(value.id))fail('Invalid variable reference.');}
        else if(!['string','number','boolean'].includes(typeof value)||(typeof value==='string'&&value.length>4096))fail('Invalid field value.');
      }
    }
    if(Object.hasOwn(b,'extraState')) {
      const e=b.extraState;
      if(!keys(e,['name','params'],['name','params'])||typeof e.name!=='string'||reserved(e.name)||e.name.length>4096||!Array.isArray(e.params)||e.params.length>100)fail('Invalid custom block.');
      for(const p of e.params)if(!keys(p,['name','kind'],['name','kind'])||typeof p.name!=='string'||reserved(p.name)||p.name.length>4096||!['n','b'].includes(p.kind))fail('Invalid custom block parameter.');
    }
    if(Object.hasOwn(b,'icons')) {
      if(!keys(b.icons,['comment']))fail('Invalid block icon.');
      if(Object.hasOwn(b.icons,'comment')) {
        const c=b.icons.comment;if(!keys(c,['text','pinned','height','width']))fail('Invalid comment.');
        if(Object.hasOwn(c,'text')&&(typeof c.text!=='string'||c.text.length>4096))fail('Invalid comment text.');
        if(Object.hasOwn(c,'pinned')&&typeof c.pinned!=='boolean')fail('Invalid comment state.');
        for(const key of ['height','width'])if(Object.hasOwn(c,key)&&(!Number.isFinite(c[key])||c[key]<0||c[key]>10000))fail('Invalid comment size.');
      }
    }
    if(Object.hasOwn(b,'inputs')) {
      if(!record(b.inputs)||Object.keys(b.inputs).length>100)fail('Invalid inputs.');
      for(const input of Object.values(b.inputs)){if(!keys(input,['block','shadow']))fail('Invalid input block.');for(const child of Object.values(input))block(child,depth+1);}
    }
    if(Object.hasOwn(b,'next')){if(!keys(b.next,['block'],['block']))fail('Invalid next block.');block(b.next.block,depth+1);}
  }
  for(const b of data.workspace.blocks?.blocks||[])block(b);
  let nodes=0;
  const seen=new Set();
  function visit(value,depth=0) {
    if (++nodes > 50000 || depth > 180) fail('Save is too complex.');
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail('Invalid number in save.'); return; }
    if (typeof value !== 'object' || seen.has(value)) fail('Save must contain ordinary JSON data.');
    seen.add(value);
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('Save must contain ordinary JSON data.');
    for (const [key,item] of Object.entries(value)) {
      if (['__proto__','constructor','prototype'].includes(key)) fail('Unsafe key in save.');
      visit(item,depth+1);
    }
    seen.delete(value);
  }
  visit(data);
  return data;
}
export function encodeSave(data) {
  validateSave(data);
  const text=JSON.stringify(data,null,2);
  if (new TextEncoder().encode(text).byteLength > MAX_SAVE_BYTES) fail('Save exceeds 1 MiB.');
  return text;
}
export function decodeSave(text) {
  if(typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_SAVE_BYTES) fail('Save exceeds 1 MiB.');
  return validateSave(JSON.parse(text));
}
