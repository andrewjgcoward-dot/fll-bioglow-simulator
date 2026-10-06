import {decodeBundledAsset} from './bundled-model-codec.js';
export function createBundledDecoder(signal) {
  let worker=null,next=0;const pending=new Map();
  const failAll=error=>{for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(error);}pending.clear();worker?.terminate();worker=null;};
  const abort=()=>failAll(new DOMException('Loading cancelled.','AbortError'));
  signal?.addEventListener('abort',abort,{once:true});
  return {
    async decode(bytes,asset) {
      signal?.throwIfAborted();
      if(typeof Worker!=='function')return decodeBundledAsset(bytes,asset);
      if(!worker){const url=new URL('./bundled-model-worker.js',import.meta.url);url.search=new URL(import.meta.url).search;worker=new Worker(url,{type:'module'});
        worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;clearTimeout(p.timer);pending.delete(data.id);data.error?p.reject(new Error(data.error)):p.resolve({bytes:new Uint8Array(data.buffer),verifyMs:data.verifyMs,decompressMs:data.decompressMs});};
        worker.onerror=()=>failAll(new Error('The browser could not prepare this model. Retry loading.'));
      }
      return new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>failAll(new Error('This model took too long to prepare. Retry loading.')),20000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,asset,buffer:bytes.buffer},[bytes.buffer]);});
    },
    dispose(){signal?.removeEventListener('abort',abort);failAll(new DOMException('Loading cancelled.','AbortError'));}
  };
}
