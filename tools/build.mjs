import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {mkdir, copyFile, rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist/site',{recursive:true});
await mkdir('dist/extension',{recursive:true});
await build({entryPoints:['web/app.js'],bundle:true,format:'esm',outfile:'dist/site/app.js'});
for(const name of ['index.html','style.css','service-worker.js','manifest.webmanifest'])await copyFile(`web/${name}`,`dist/site/${name}`);
await copyFile('wasm/target/wasm32-unknown-unknown/release/evolve_jobs_match.wasm','dist/site/matcher.wasm');
for(const name of ['manifest.json','panel.html','content.js'])await copyFile(`extension/${name}`,`dist/extension/${name}`);
await copyFile('web/style.css','dist/extension/style.css');
await copyFile('dist/site/matcher.wasm','dist/extension/matcher.wasm');
for(const name of ['background','panel'])await build({entryPoints:[`extension/${name}.js`],bundle:true,format:'esm',outfile:`dist/extension/${name}.js`});

execFileSync('python3',['-m','zipfile','-c','dist/site/evolve-jobs-extension.zip','dist/extension']);
