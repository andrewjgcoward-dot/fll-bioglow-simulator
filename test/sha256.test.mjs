import {readBundledFixture} from '../test-support/bundled-model-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {sha256Hex,sha256HexFallback} from '../src/sha256.js';
import {BUNDLED_MANIFEST_URL} from '../src/bundled-models.js';

test('HTTP LAN fallback agrees with SHA-256 known vectors and block boundaries',async()=>{
 const inputs=['','abc','a'.repeat(1000000)].map(s=>new TextEncoder().encode(s));
 for(const length of [1,54,55,56,57,63,64,65,119,120,127,128,129,1024,65537])inputs.push(randomBytes(length));
 for(const data of inputs)assert.equal(sha256HexFallback(data),createHash('sha256').update(data).digest('hex'));
 assert.equal(sha256HexFallback(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 try{Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});assert.equal(await sha256Hex(inputs[1]),createHash('sha256').update(inputs[1]).digest('hex'));}
 finally{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;}
});

test('HTTP fallback verifies every actual bundled GLB',async()=>{
 const root=new URL('./',BUNDLED_MANIFEST_URL),manifest=JSON.parse(await readFile(BUNDLED_MANIFEST_URL,'utf8'));
 for(const a of manifest.assets){const data=Buffer.from(await readBundledFixture(a));assert.equal(sha256HexFallback(data),a.sha256,a.id);}
});
