import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
await build({entryPoints:[root+'src/firebase-auth.js'],outfile:root+'vendor/firebase-auth.js',bundle:true,minify:true,format:'esm',target:['es2020'],nodePaths:[root+'node_modules'],legalComments:'eof'});

await build({entryPoints:[root+'src/firebase-admin-auth.js'],outfile:root+'vendor/firebase-admin-auth.js',bundle:true,minify:true,format:'esm',target:['es2020'],nodePaths:[root+'node_modules'],legalComments:'eof'});
