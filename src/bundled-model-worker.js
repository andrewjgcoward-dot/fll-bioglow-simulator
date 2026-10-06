import {decodeBundledAsset} from './bundled-model-codec.js';
self.onmessage=async({data})=>{
  try{const result=await decodeBundledAsset(new Uint8Array(data.buffer),data.asset);self.postMessage({id:data.id,buffer:result.bytes.buffer,verifyMs:result.verifyMs,decompressMs:result.decompressMs},[result.bytes.buffer]);}
  catch(error){self.postMessage({id:data.id,error:error.message});}
};
