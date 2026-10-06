import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {BUNDLED_MANIFEST_URL} from '../src/bundled-models.js';

export const bundledManifest=JSON.parse(await readFile(BUNDLED_MANIFEST_URL,'utf8'));
// Node's independent decoder supplies fixtures without checked-in raw GLBs.
export async function readBundledFixture(assetOrId) {
 const asset=typeof assetOrId==='string'?bundledManifest.assets.find(a=>a.id===assetOrId):assetOrId;
 assert.ok(asset?.transport, 'every published asset needs a compressed transport');
 const encoded=await readFile(new URL(asset.transport.file,BUNDLED_MANIFEST_URL));
 assert.equal(encoded.length,asset.transport.bytes);
 assert.equal(createHash('sha256').update(encoded).digest('hex'),asset.transport.sha256);
 const decoded=new Uint8Array(gunzipSync(encoded,{maxOutputLength:asset.bytes}));
 assert.equal(decoded.length,asset.bytes);
 assert.equal(createHash('sha256').update(decoded).digest('hex'),asset.sha256);
 return decoded;
}
