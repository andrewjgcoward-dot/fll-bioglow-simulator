import { inflateSync } from '../vendor/fflate/fflate.module.js';
self.onmessage = ({ data }) => {
  try {
    if (!Number.isInteger(data.expected) || data.expected < 0 || data.expected > 96 * 1024 * 1024) throw new Error('Model decompression limit exceeded.');
    const output = inflateSync(new Uint8Array(data.buffer), { out: new Uint8Array(data.expected) });
    self.postMessage({ buffer: output.buffer }, [output.buffer]);
  } catch { self.postMessage({ error: 'This model could not be decompressed.' }); }
};
