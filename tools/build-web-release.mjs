#!/usr/bin/env node
/* Standalone browser products from the shared engine.

     node tools/build-web-release.mjs --source <clean worktree> --out <empty dir> --mode sharksim
       one mode-locked page (index.html), no cross-promotion: the CrazyGames build.

     node tools/build-web-release.mjs --source <clean worktree> --out <empty dir> --portal [--thumbs <dir>]
       every game: one mode-locked page per mode (shark-sim.html, ...), the
       standalone pages under games/, and a portal index.html — the chart —
       whose thumbnails are ba covers from <thumbs>/<slug>.png (real footage,
       never art). Every page shares ONE copy of src/, css/ and assets/.

   Every script boundary and order is preserved; JS/CSS is whitespace-and-
   syntax minified only (HARNESS TRAP: identifier minification emitted helper
   names that COLLIDED across classic script tags). A sha256 manifest is
   written so `ship web` can verify every byte before it publishes. */
import {readFileSync,writeFileSync,mkdirSync,readdirSync,copyFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {transform} from 'esbuild';

const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args=process.argv.slice(2);
const arg=(k,d)=>{const i=args.indexOf(k);return i<0?d:args[i+1];};
const has=(k)=>args.includes(k);
const source=path.resolve(arg('--source',ROOT));
const output=path.resolve(arg('--out',path.join(ROOT,'dist-web/shark-sim')));
const portal=has('--portal');
const thumbs=arg('--thumbs',null);

/* THE CHART. slug = page name; mode = index.html mode lock; page = a standalone
   page copied as-is. hook = the one line under the title. heavy = a warning on
   the card, because Gang City builds a 25 km world before it draws a frame. */
const GAMES=[
  {slug:'shark-sim',        mode:'sharksim', name:'Shark Sim',          hook:'Eat. Grow. Become the megalodon.', desc:'Become the shark. Hunt, grow, evolve into a megalodon, and survive the orca pod. Play free in your browser.'},
  {slug:'disaster-survival',mode:'survival', name:'Disaster Survival',  hook:'100 on an island. One disaster. Last one alive.', desc:'A hundred survivors on a procedurally generated island. A tsunami, a volcano, a quake, a wildfire or a nuke. Be the last one standing.'},
  {slug:'prison-escape',    mode:'escape',   name:'Prison Escape',      hook:'Cell Block Z. Get out.', desc:'Inmate or cop in a working prison: cells, yard, corridors, contraband, guards with tasers. Escape, or keep them in.'},
  {slug:'gang-city',        mode:'city',     name:'Gang City',          hook:'Turf, gangs, cops. The whole city.', desc:'An open city with gangs, cops, cars, planes and boats. Pick a story and take over.', heavy:true},
  {slug:'gun-game',         mode:'gungame',  name:'Gun Game',           hook:'Every kill climbs the ladder. The last rung is fists.', desc:'Weapon-ladder deathmatch on picked maps. Every kill climbs the ladder; the final rung is bare fists.'},
  {slug:'npc-war',          page:'games/battle.html',        name:'NPC War',        hook:'Two armies. Any size. You hold the clock.', desc:'Two armies of any size fight with the city\'s own combat brain while you fly the camera and run the clock.'},
  {slug:'bomb-survivor',    page:'games/bomb-survivor.html', name:'Bomb Survivor',  hook:'6 v 6 over the real city.', desc:'Six against six, the real island and the real downtown, three minutes each way.'},
  {slug:'desert-warlord',   page:'games/warlord.html',       name:'Desert Warlord', hook:'Your army. Your dead stay dead.', desc:'The men of NPC War, but they are yours: paid for or frightened into joining, and the ones who die stay dead.'},
];

if(existsSync(output)&&readdirSync(output).length)throw new Error('Output must be empty; use a fresh release directory');
mkdirSync(output,{recursive:true});
const files=[];
const put=(rel,content)=>{const to=path.join(output,rel);mkdirSync(path.dirname(to),{recursive:true});writeFileSync(to,content);files.push(rel);};

/* ---- a mode-locked page out of index.html ---- */
const indexSrc=readFileSync(path.join(source,'index.html'),'utf8');
function modePage(game,{home}){
  let html=indexSrc.replace('<title>Gang Life</title>',`<title>${game.name}</title>`);
  // HARNESS TRAP: set the mode before ANY game module, not merely config.js.
  html=html.replace('</head>',`<meta name="description" content="${game.desc.replace(/"/g,'&quot;')}">\n<script>window.CBZ=Object.assign(window.CBZ||{},{START_MODE:${JSON.stringify(game.mode)}});</script>\n</head>`);
  const begin=html.indexOf('<div class="origin-label mode-strip-label">');
  const end=html.indexOf('</button>\n    </div>',begin);
  if(begin<0||end<begin)throw new Error('More Games markup moved; update product packaging');
  html=html.slice(0,begin)+`<div id="modeSelect" class="mode-select" hidden><button class="mode-btn active" type="button" data-mode="${game.mode}">${game.name}</button></div>`+html.slice(end+'</button>\n    </div>'.length);
  html=html.replace(/<!--[^]*?-->/g,'');
  if(home){
    // the portal build may point back at its own chart; the CrazyGames build may not (no cross-promotion)
    html=html.replace('</body>',`<a href="./" id="portalHome" style="position:fixed;left:12px;top:10px;z-index:2147483000;font:700 13px/1 Fredoka,Arial,sans-serif;letter-spacing:.08em;color:#fff;text-decoration:none;background:rgba(4,20,36,.55);padding:8px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.25)">◀ ALL GAMES</a>\n<style>body.state-playing #portalHome{display:none}</style>\n</body>`);
  }
  return html;
}

/* ---- the shared tree, minified in place ---- */
async function copyTree(rel){
  const from0=path.join(source,rel); if(!existsSync(from0))return;
  for(const e of readdirSync(from0,{withFileTypes:true})){
    const r=path.join(rel,e.name),from=path.join(source,r),to=path.join(output,r);
    if(e.name.startsWith('.')||e.name.endsWith('.orig')||e.name.endsWith('.map'))continue;
    if(e.isDirectory()){await copyTree(r);continue;}
    if(!e.isFile())continue;
    mkdirSync(path.dirname(to),{recursive:true});
    if(/\.(js|css)$/.test(r)&&!r.includes('/vendor/')){
      const result=await transform(readFileSync(from,'utf8'),{loader:r.endsWith('.css')?'css':'js',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,target:'safari15',legalComments:'eof'});
      writeFileSync(to,result.code);
    }else copyFileSync(from,to);
    files.push(r);
  }
}
for(const dir of ['src','css','assets'])await copyTree(dir);

let product;
if(!portal){
  const mode=arg('--mode','sharksim');
  const game=GAMES.find(g=>g.mode===mode);
  if(!game)throw new Error('Unsupported standalone mode '+mode);
  product=game.name;
  put('index.html',modePage(game,{home:false}));
}else{
  product='Play';
  for(const g of GAMES){
    if(g.mode)put(g.slug+'.html',modePage(g,{home:true}));
  }
  // the standalone pages resolve the engine as ../src off their own script tag
  await copyTree('games');
  for(const g of GAMES){
    if(g.page&&!files.includes(g.page))throw new Error('standalone page missing from source: '+g.page);
    if(g.page){
      const p=path.join(output,g.page);
      let html=readFileSync(p,'utf8');
      html=html.replace('</body>',`<a href="../" id="portalHome" style="position:fixed;left:12px;top:10px;z-index:2147483000;font:700 13px/1 Fredoka,Arial,sans-serif;letter-spacing:.08em;color:#fff;text-decoration:none;background:rgba(4,20,36,.55);padding:8px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.25)">◀ ALL GAMES</a>\n</body>`);
      writeFileSync(p,html);
    }
  }
  // thumbnails: ba covers, 16:9, converted to 960x540 JPEG so the chart is light
  const thumbFor={};
  if(thumbs){
    for(const g of GAMES){
      const src=path.join(thumbs,g.slug+'.png');
      if(!existsSync(src))continue;
      const rel=path.join('thumbs',g.slug+'.jpg');
      mkdirSync(path.join(output,'thumbs'),{recursive:true});
      execFileSync('ffmpeg',['-v','error','-y','-i',src,'-vf','scale=960:540','-q:v','3',path.join(output,rel)]);
      files.push(rel); thumbFor[g.slug]=rel;
    }
  }
  const cards=GAMES.map(g=>{
    const href=g.mode?g.slug+'.html':g.page;
    const thumb=thumbFor[g.slug]?`<img src="${thumbFor[g.slug]}" alt="${g.name}" loading="lazy">`:`<div class="nothumb">${g.name}</div>`;
    return `<a class="card" href="${href}">${thumb}<div class="meta"><b>${g.name}</b><span>${g.hook}</span>${g.heavy?'<em>Big world · desktop · 30 s load</em>':''}</div></a>`;
  }).join('\n');
  put('index.html',`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Play</title>
<meta name="description" content="Free browser games, all one engine: Shark Sim, Disaster Survival, Prison Escape, Gang City, Gun Game, NPC War, Bomb Survivor, Desert Warlord.">
<link rel="stylesheet" href="css/fonts.css">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0b1622;color:#e8ecf2;font-family:Fredoka,system-ui,sans-serif}
header{display:flex;align-items:center;gap:16px;padding:14px 24px;background:#0f1d2c;border-bottom:1px solid #1e2f42}
header b{font-size:22px;letter-spacing:.06em}
header span{opacity:.6;font-size:13px}
main{padding:22px 24px 60px;max-width:1500px;margin:0 auto}
h1{font-size:30px;margin:6px 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:18px 14px}
.card{display:block;color:inherit;text-decoration:none;border-radius:12px;overflow:hidden;background:#13243a;border:1px solid #1e2f42;transition:transform .12s ease,border-color .12s ease}
.card:hover{transform:translateY(-3px);border-color:#4da3ff}
.card img,.card .nothumb{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#0a1420}
.card .nothumb{display:flex;align-items:center;justify-content:center;font-weight:700;opacity:.5}
.meta{padding:10px 12px 12px}
.meta b{display:block;font-size:16px;margin-bottom:3px}
.meta span{display:block;font-size:12.5px;opacity:.72;line-height:1.3}
.meta em{display:block;margin-top:6px;font-size:11px;font-style:normal;color:#ffb27a;letter-spacing:.04em}
footer{padding:20px 24px;font-size:12px;opacity:.5}
</style></head>
<body>
<header><b>PLAY</b><span>free browser games · one engine · thumbnails are real gameplay</span></header>
<main><h1>All games</h1><div class="grid">
${cards}
</div></main>
<footer>Every game here is built with three.js and runs in your browser. Nothing to install.</footer>
</body></html>`);
}
put('.nojekyll','');

const entries=files.map(file=>{const b=readFileSync(path.join(output,file));return{file,bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};});
const manifest={product,mode:portal?'portal':arg('--mode','sharksim'),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),createdAt:new Date().toISOString(),fileCount:files.length,totalBytes:entries.reduce((n,e)=>n+e.bytes,0),files:entries};
writeFileSync(path.join(output,'release-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({...manifest,files:undefined,output},null,2));
if(!portal&&(manifest.fileCount>1499||manifest.totalBytes>50*1024*1024))throw new Error('Exceeds CrazyGames Basic Launch package limits; do not submit');
