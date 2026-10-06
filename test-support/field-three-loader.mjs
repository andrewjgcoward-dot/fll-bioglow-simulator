// Keep the real Three.js scene graph and GLTFLoader; replace only the GPU renderer.
export function resolve(specifier,context,nextResolve){
  if(specifier==='three')return {url:new URL('../vendor/three/build/three.module.js',import.meta.url).href,shortCircuit:true};
  if(specifier==='../vendor/three/build/three.module.js'&&context.parentURL.endsWith('/src/field-3d.js'))return {url:new URL('./field-renderer-stub.mjs',import.meta.url).href,shortCircuit:true};
  return nextResolve(specifier,context);
}
