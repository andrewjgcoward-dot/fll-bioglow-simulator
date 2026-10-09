// Teaching approximation, not measured SPIKE optics. All scene types use the
// same 4 mm radius disk, 49 equally weighted probes, and a bilinear 1 mm surface
// reconstruction. Interpolation avoids abrupt whole-probe changes at edges.
export const SPOT_R = 4;
export const SPOT_OFFSETS = Object.freeze(Array.from({length:9},(_,y)=>y-4)
  .flatMap(y=>Array.from({length:9},(_,x)=>x-4).filter(x=>x*x+y*y<=16).map(x=>Object.freeze([x,y]))));
export const SURFACE_RGB = Object.freeze({black:[0,0,0],white:[255,255,255],red:[217,52,43],blue:[30,111,217],green:[47,143,78],yellow:[232,194,30],none:[119,119,119]});
export function classify(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max / 255, s = max ? (max - min) / max : 0;
  if (v < 0.22) return 'black';
  if (s < 0.22) return v > 0.6 ? 'white' : v < 0.35 ? 'black' : 'none';
  let h;
  if (max === r) h = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h *= 60;
  if (h < 18 || h >= 330) return 'red';
  if (h < 70) return 'yellow';
  if (h < 175) return 'green';
  if (h < 200) return 'azure';
  if (h < 255) return 'blue';
  return 'violet';
}


// Center outside the mat: no reading. At an edge, each probe is clamped to
// the field boundary (edge extension), never darkened by imaginary black space.
// Surface RGB and modeled reflectance are averaged separately: reflectance
// need not equal the visual palette's brightness on a synthetic teaching mat.
export function areaSampler(surface, width, height) {
  return ([x,y])=>{
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>width||y<0||y>height)return null;
    const rgb=[0,0,0];let reflect=0;
    for(const [dx,dy] of SPOT_OFFSETS){
      const px=Math.max(0,Math.min(width,x+dx)),py=Math.max(0,Math.min(height,y+dy));
      const x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;
      for(const [xx,wx] of [[x0,1-fx],[Math.min(width,x0+1),fx]])for(const [yy,wy] of [[y0,1-fy],[Math.min(height,y0+1),fy]]){
        const weight=wx*wy;if(!weight)continue;
        const sample=surface([xx,yy]);
        for(let c=0;c<3;c++)rgb[c]+=sample.rgb[c]*weight;
        reflect+=sample.reflect*weight;
      }
    }
    const n=SPOT_OFFSETS.length;return {color:classify(...rgb.map(v=>v/n)),reflect:reflect/n};
  };
}
