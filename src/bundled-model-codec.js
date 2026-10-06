import { sha256Hex } from './sha256.js';
import { PACK_LIMITS, crc32 } from './model-pack.js';
import { gunzipSync } from '../vendor/fflate/fflate.module.js';

export async function decodeBundledAsset(bytes, asset) {
  const encoded=asset.transport||asset, start=performance.now();
  if(!Number.isSafeInteger(asset.bytes)||asset.bytes<28||asset.bytes>PACK_LIMITS.entry||!Number.isSafeInteger(encoded.bytes)||encoded.bytes<28||encoded.bytes>PACK_LIMITS.entry||bytes.length!==encoded.bytes)throw new Error(`${asset.id} download is incomplete.`);
  if(await sha256Hex(bytes)!==encoded.sha256)throw new Error(`${asset.id} checksum does not match.`);
  const verifyMs=performance.now()-start;
  if(!asset.transport)return {bytes,verifyMs,decompressMs:0};
  if(encoded.compression!=='gzip'||asset.bytes>Math.max(1024*1024,encoded.bytes*250))throw new Error('Unsupported model compression or expansion size.');
  const inflateStart=performance.now(),trailer=new DataView(bytes.buffer,bytes.byteOffset+bytes.length-8,8);
  // Our deterministic preprocessing emits one gzip member with no optional headers.
  if(bytes[0]!==31||bytes[1]!==139||bytes[2]!==8||bytes[3]!==0||trailer.getUint32(4,true)!==asset.bytes)throw new Error('Invalid compressed model header or size.');
  let output;
  if(typeof DecompressionStream==='function') {
    const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),chunks=[];let size=0;
    try {for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>asset.bytes)throw new Error('Model decompression limit exceeded.');chunks.push(value);}}
    finally{await reader.cancel();}
    if(size!==asset.bytes)throw new Error('Decompressed model size does not match.');
    output=new Uint8Array(size);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
  } else {
    // Fixed output allocation bounds the fallback even for a malicious compressed stream.
    output=gunzipSync(bytes,{out:new Uint8Array(asset.bytes)});
    if(output.length!==asset.bytes||crc32(output)!==trailer.getUint32(0,true))throw new Error('Compressed model is damaged.');
  }
  return {bytes:output,verifyMs,decompressMs:performance.now()-inflateStart};
}
