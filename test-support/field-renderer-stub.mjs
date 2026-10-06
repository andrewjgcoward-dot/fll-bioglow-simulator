export * from '../vendor/three/build/three.module.js';
export let renderedScene;
export class WebGLRenderer {
  constructor(){this.domElement=document.createElement('canvas');this.capabilities={getMaxAnisotropy:()=>1};this.renderLists={dispose(){}};this.info={render:{calls:0}};}
  setPixelRatio(){} setClearColor(){} setSize(){} dispose(){}
  render(scene){renderedScene=scene;}
}
