import {areaSampler} from './sensor-sampling.js';
export {SPOT_R,classify} from './sensor-sampling.js';

export function reflectOf(r, g, b) {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return Math.round(8 + 90 * lum);
}

// Photo pixels are mapped to a 1 mm field surface, then sampled with the same
// area kernel as plain/practice scenes. Photo y runs opposite field y.
export function photoSampler(data,w,h,fw,fh) {
  return areaSampler(([x,y])=>{
    const px=Math.min(w-1,Math.max(0,Math.floor(x*w/fw)));
    const py=Math.min(h-1,Math.max(0,Math.floor((fh-y)*h/fh)));
    const i=(py*w+px)*4,rgb=[data[i],data[i+1],data[i+2]];
    return {rgb,reflect:reflectOf(...rgb)};
  },fw,fh);
}
