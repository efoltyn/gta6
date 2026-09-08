#!/usr/bin/env node
// Standalone product, shared engine. Preserve every script boundary and order.
import {readFileSync,writeFileSync,mkdirSync,readdirSync,statSync,copyFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {transform} from 'esbuild';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args=process.argv.slice(2);
const arg=(k,d)=>{const i=args.indexOf(k);return i<0?d:args[i+1];};
const source=path.resolve(arg('--source',ROOT));
const output=path.resolve(arg('--out',path.join(ROOT,'dist-web/shark-sim')));
const mode=arg('--mode','sharksim');
const names={sharksim:'Shark Sim',survival:'Natural Disaster Survival',escape:'Prison Escape'};
if(!names[mode])throw new Error('Unsupported standalone mode');
const name=names[mode];
if(existsSync(output)&&readdirSync(output).length)throw new Error('Output must be empty; use a fresh release directory');
mkdirSync(output,{recursive:true});
let html=readFileSync(path.join(source,'index.html'),'utf8');
html=html.replace('<title>Gang Life</title>',`<title>${name}</title>`);
// HARNESS TRAP: set the mode before ANY game module, not merely config.js.
html=html.replace('</head>',`<meta name="description" content="${mode==='sharksim'?'Become the shark. Hunt, grow, evolve into a megalodon, and survive the orca pod. Play free in your browser.':name}">\n<script>window.CBZ=Object.assign(window.CBZ||{},{START_MODE:${JSON.stringify(mode)}});</script>\n</head>`);
const begin=html.indexOf('<div class="origin-label mode-strip-label">');
const end=html.indexOf('</button>\n    </div>',begin);
if(begin<0||end<begin)throw new Error('More Games markup moved; update product packaging');
html=html.slice(0,begin)+`<div id="modeSelect" class="mode-select" hidden><button class="mode-btn active" type="button" data-mode="${mode}">${name}</button></div>`+html.slice(end+'</button>\n    </div>'.length);
html=html.replace(/<!--[^]*?-->/g,'');
// Keep local dependencies intact, including dynamic workers and currentScript URLs.
const files=[];
async function copyTree(rel){
  for(const e of readdirSync(path.join(source,rel),{withFileTypes:true})){
    const r=path.join(rel,e.name),from=path.join(source,r),to=path.join(output,r);
    if(e.name.startsWith('.')||e.name.endsWith('.orig')||e.name.endsWith('.map'))continue;
    if(e.isDirectory()){await copyTree(r);continue;}
    if(!e.isFile())continue;
    mkdirSync(path.dirname(to),{recursive:true});
    if(/\.(js|css)$/.test(r)&&!r.includes('/vendor/')){
      // HARNESS TRAP: keepNames with identifier minification emits globally
      // named helpers that collide across classic script tags. Preserve names.
      const result=await transform(readFileSync(from,'utf8'),{loader:r.endsWith('.css')?'css':'js',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,target:'safari15',legalComments:'eof'});
      writeFileSync(to,result.code);
    }else copyFileSync(from,to);
    files.push(r);
  }
}
for(const dir of ['src','css','assets'])await copyTree(dir);
writeFileSync(path.join(output,'index.html'),html);files.push('index.html');
writeFileSync(path.join(output,'.nojekyll'),'');files.push('.nojekyll');
const entries=files.map(file=>{const b=readFileSync(path.join(output,file));return{file,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};});
const manifest={product:name,mode,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),createdAt:new Date().toISOString(),fileCount:files.length,totalBytes:entries.reduce((n,e)=>n+e.bytes,0),files:entries};
writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({...manifest,files:undefined,output},null,2));
if(manifest.fileCount>1499||manifest.totalBytes>50*1024*1024)throw new Error('Exceeds CrazyGames Basic Launch package limits; do not submit');
