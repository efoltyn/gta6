#!/usr/bin/env node
/* tools/solid-census.mjs — WHERE THE WORLD IS DRAWN AND WHERE IT IS SOLID,
                            AS TWO LEDGERS AND THE ARITHMETIC BETWEEN THEM.

   WHY
   ---
   Owner, on the Diamond Speedway perimeter: "look how parts of it dont have
   colliders and how many parts of it overlap things, but dont look at it
   visually, find a way to show this mathematically so you can find other
   examples throughout gang city."

   That is the right instinct and it names a real hole in this repo's tooling.
   We already measure ONE direction:

     tools/ghost-collider-check.mjs   collider standing where nothing is drawn
     tools/invisible-wall-check.mjs   a rotated wall re-typed as its AABB

   Nothing measured the OTHER direction — a wall you can see and walk through
   — and nothing measured geometry passing through geometry at all. Both are
   invisible to a screenshot (you have to walk into a fence to learn it is
   fake, and a fence buried in a grandstand looks like a fence). Both are
   trivial once you stop looking and start counting.

   THE TWO LEDGERS
   ---------------
     DRAWN   every triangle in CBZ.scene whose normal is near-horizontal is a
             wall face, and its shadow on the ground is a segment. Collapse the
             faces that share a line and you have the world's BARRIER RUNS —
             derived from the geometry, so nothing has to be named, tagged or
             registered for the census to see it.
     SOLID   CBZ.colliders, oriented bodies honoured (an OBB tested as its
             AABB is the exact bug next door; this must not commit it).

   THE SIX NUMBERS  (tools/lib/solid-math.mjs does the arithmetic)
     GHOST     m   drawn barrier with no solid under it        walk through it
     PIERCE    n   one structure's wall crossing another's,
                   interior to both, heights overlapping       drawn inside a thing
     ROADBLOCK m2  solid standing in a carriageway             can't drive it
     ROADCUT   m   barrier drawn across a carriageway          fence over a road
     DOUBLE    m2  two colliders on the same ground            two builders, one wall
     PHANTOM   m2  wall-thin solid with nothing drawn in it    (cf ghost-collider-check)

   Every one is a length or an area, so the leaderboard is honest across the
   whole map: 40 m of ghost fence outranks 3 m of it, everywhere, always.

   USAGE
     node tools/probe.mjs --serve                          # once, ~2 min
     node tools/solid-census.mjs --group speedway          # a named venue
     node tools/solid-census.mjs --at 490,-350 --r 260     # a patch of ground
     node tools/solid-census.mjs --sweep                   # all of gang city
     node tools/solid-census.mjs --group speedway --json out.json
     node tools/solid-census.mjs --group speedway --max-ghost 40   # a ratchet

   --group takes a REGEX matched against scene object names and censuses that
   subtree's world footprint; a miss prints the names that do exist, so a typo
   can never read as a clean bill of health.

   Flags: --owner <substr>   only report structures whose name contains it
          --top N            rows per table (default 12)
          --tile N           tile size, m (default 240 — see TILE below)
          --pad N            metres around a --group footprint (default 20)
          --exclude <re>     override the not-a-barrier name filter
          --no-exclude       count foliage, water and cloth as barriers too
          --quiet            findings only
          --max-ghost / --max-pierce / --max-roadblock / --max-roadcut
                             exit 1 above the limit (use as a gate)        */

import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  merge, coverage, phantom, solidClash, pierce, roadClash, segLen,
} from "./lib/solid-math.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const num = (f, d) => { const v = arg(f, null); return v == null ? d : +v; };

const TOP = num("--top", 12);
const OWNER = arg("--owner", null);
const QUIET = has("--quiet");

// ------------------------------------------------------------------- probing
const DUMP_SRC = await readFile(path.join(ROOT, "tools/lib/solid-dump.js"), "utf8");

function probe(expr) {
  return new Promise((res, rej) => {
    const p = spawn("node", [path.join(ROOT, "tools/probe.mjs"), "--eval-timeout", "180000", expr],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) => {
      if (c !== 0) return rej(new Error("probe exit " + c + "\n" + err.slice(-2000)));
      try { res(JSON.parse(out)); }
      catch (e) {
        rej(new Error(`probe returned non-JSON (${out.length} B): ${e.message}\n` +
          "HEAD " + JSON.stringify(out.slice(0, 240)) + "\nTAIL " + JSON.stringify(out.slice(-240)) +
          "\nSTDERR " + err.slice(-600)));
      }
    });
  });
}

async function dumpBox(box, opts) {
  // The parens around DUMP_SRC are load-bearing: it opens with a block comment
  // containing newlines, and `return` + a line terminator is ASI — the probe
  // came back `null` for exactly that reason before the wrap.
  const expr = `(()=>{window.__CENSUS_BOX=${JSON.stringify(box)};window.__CENSUS_OPTS=${JSON.stringify(opts || {})};` +
               `return (\n${DUMP_SRC.trim().replace(/;\s*$/, "")}\n);})()`;
  return probe(expr);
}

/* World facts, read live. Printed whether or not they resolve, because an
   anchor that quietly returned null would read as "no bugs there" — the
   failure mode ghost-collider-check calls out by name. */
async function anchors() {
  return probe(`(()=>{const o={};const A=CBZ.city&&CBZ.city.arena;
    if(A)o.arena={minX:A.minX,maxX:A.maxX,minZ:A.minZ,maxZ:A.maxZ};
    o.roads=(A&&A.roads||[]).length;o.colliders=CBZ.colliders.length;
    o.mode=CBZ.game&&CBZ.game.mode;o.state=CBZ.game&&CBZ.game.state;
    return o;})()`);
}

/* WHERE IS IT? Ask the scene, never a constant. Every venue in this game is
   a named THREE.Group, and its world AABB is a better region than any centre
   somebody types — move the campus and the census follows it. Also lists the
   near-miss names when nothing matches, so a typo cannot read as "clean". */
async function groupBounds(pattern) {
  return probe(`(()=>{const re=new RegExp(${JSON.stringify(pattern)},"i");
    let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9,n=0,names=[],all=[];
    const m=new THREE.Matrix4(),v=new THREE.Vector3();
    CBZ.scene.updateMatrixWorld(true);
    // NOT Box3.setFromObject: r128's ignores per-instance matrices, so an
    // InstancedMesh of fence posts measures as its base geometry at the
    // ORIGIN — the first run of this resolver returned a 1129 m box reaching
    // from 0,0 out to the speedway because of exactly that.
    function eat(o){
      const g=o.geometry; if(!g)return;
      if(!g.boundingBox){try{g.computeBoundingBox();}catch(e){return;}}
      const b=g.boundingBox; if(!b)return;
      const push=(mat)=>{for(let i=0;i<8;i++){
        v.set(i&1?b.max.x:b.min.x, i&2?b.max.y:b.min.y, i&4?b.max.z:b.min.z).applyMatrix4(mat);
        if(v.x<minX)minX=v.x; if(v.x>maxX)maxX=v.x;
        if(v.z<minZ)minZ=v.z; if(v.z>maxZ)maxZ=v.z;}};
      if(o.isInstancedMesh){for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);m.premultiply(o.matrixWorld);push(m);}}
      else push(o.matrixWorld);
    }
    (function walk(o,inside){
      const hit=inside||(o.name&&re.test(o.name));
      if(o.name&&!inside)all.push(o.name);
      if(hit&&!inside){n++; if(names.length<12)names.push(o.name);}
      if(hit&&o.isMesh)eat(o);
      for(const c of o.children)walk(c,hit);
    })(CBZ.scene,false);
    if(!n||minX>maxX)return{n:n,sample:all.filter((x,i,a)=>a.indexOf(x)===i).sort().slice(0,80)};
    return{n:n,names:names,minX:minX,maxX:maxX,minZ:minZ,maxZ:maxZ};})()`);
}

/* EVERY STRUCTURE IN THE WORLD, AND WHERE IT STANDS.
   A whole-map census cannot be a raster: gang city measures ~17.6 x 15.7 km
   and cutting that into 240 m tiles is 4,700 probes for a map that is mostly
   sea, desert and empty ground. But the world is not uniformly interesting —
   the things a census has anything to say about are BUILT, and everything
   built in this engine hangs under a named THREE.Group. So the sweep walks
   the name list instead of the ground, and only visits places that exist. */
async function structures() {
  return probe(`(()=>{const out=[];const m=new THREE.Matrix4(),v=new THREE.Vector3();
    CBZ.scene.updateMatrixWorld(true);
    function foot(o){let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9,tris=0,n=0;
      (function w(q){ if(q.visible===false)return;
        if(q.isMesh&&q.geometry){const g=q.geometry;
          if(!g.boundingBox){try{g.computeBoundingBox();}catch(e){return;}}
          const b=g.boundingBox;
          if(b){n++;tris+=(((g.index?g.index.count:(g.attributes.position?g.attributes.position.count:0))/3)|0)*(q.isInstancedMesh?q.count:1);
            const push=(mat)=>{for(let i=0;i<8;i++){
              v.set(i&1?b.max.x:b.min.x,i&2?b.max.y:b.min.y,i&4?b.max.z:b.min.z).applyMatrix4(mat);
              if(v.x<minX)minX=v.x;if(v.x>maxX)maxX=v.x;if(v.z<minZ)minZ=v.z;if(v.z>maxZ)maxZ=v.z;}};
            // 400 instances is plenty to bound a footprint and keeps a
            // 40,000-instance forest from costing a second of wall clock
            if(q.isInstancedMesh){const k=Math.min(q.count,400);for(let i=0;i<k;i++){q.getMatrixAt(i,m);m.premultiply(q.matrixWorld);push(m);}}
            else push(q.matrixWorld);}}
        for(const c of q.children)w(c);})(o);
      return {minX,maxX,minZ,maxZ,tris,n};}
    (function walk(o,d){ if(o.visible===false)return;
      if(o.name&&d>0){const f=foot(o);
        if(f.n>0&&isFinite(f.minX)){
          out.push({name:o.name,minX:f.minX,maxX:f.maxX,minZ:f.minZ,maxZ:f.maxZ,tris:f.tris});
          if(d>=3)return;}}
      for(const c of o.children)walk(c,d+1);})(CBZ.scene,0);
    return out;})()`);
}

// ------------------------------------------------------------------ analysis
/* THE ONE JUDGEMENT CALL IN AN OTHERWISE ARITHMETIC TOOL, so it is written
   down, tunable and REPORTED rather than silently applied. Some things are
   drawn with near-vertical faces and are not meant to stop anybody: foliage,
   loose rock, water, cloth, signage faces, wires. The verticality gate in
   solid-dump.js already drops most of it on geometry alone; this catches the
   rest by name. Every metre it removes is printed, so the exclusion can never
   quietly become the reason a report looks clean. */
const ORGANIC = /tree|conifer|spire|foliage|leaf|leaves|canopy|branch|bush|shrub|hedge|palm|fern|grass|reed|cactus|rock|boulder|stone-?scatter|cliff|debris|rubble|smoke|cloud|water|wave|flag|banner|cloth|awning|wire|cable|antenna|rope|corpse|ped-|crowd|npc|^batch-inert$/i;
/* `batch-inert` earns its place on that list by CONTRACT, not by taste.
   core/batch.js:418 spares any mesh carrying a collider ref from the merge,
   and names what it does merge "inert deco" (batch.js:440) — so everything
   inside a batch-inert shell was decorative when it went in. `batch-wall`,
   the other half of the same merge, is NOT excluded: those are walls, they
   are supposed to be solid, and the census duly scores them 95%. */
const EXCL = arg("--exclude", null) ? new RegExp(arg("--exclude", ""), "i") : ORGANIC;
const NO_EXCL = has("--no-exclude");

function analyse(dump) {
  let walls = dump.walls || [];
  if (OWNER) walls = walls.filter((w) => String(w[0]).includes(OWNER));
  let dropped = 0, droppedM = 0;
  if (!NO_EXCL) {
    const keep = [];
    for (const w of walls) {
      if (EXCL.test(String(w[0]))) { dropped++; droppedM += Math.hypot(w[3] - w[1], w[4] - w[2]); continue; }
      keep.push(w);
    }
    walls = keep;
  }
  const runs = merge(walls);
  runs.excluded = { faces: dropped, m: +droppedM.toFixed(1) };
  const solids = dump.solids || [];
  const roads = dump.roads || [];
  const cov = coverage(runs, solids, { minLen: num("--min-run", 2.0) });
  const ph = phantom(runs, solids);
  const dbl = solidClash(solids.filter((s) => !s.prop));
  const pi = pierce(runs);
  const rc = roadClash(runs, solids.filter((s) => !s.roadBarrier), roads);
  return { dump, runs, solids, roads, cov, ph, dbl, pi, rc };
}

// ------------------------------------------------------------------- output
const B = (s) => (process.stdout.isTTY ? "\x1b[1m" + s + "\x1b[0m" : s);
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const rpad = (s, n) => String(s).padStart(n);
const RULE = "═".repeat(78);

// ---------------------------------------------------------------------- main
const AN = await anchors();
if (AN.state !== "playing") {
  console.error(`world is not playing (state=${AN.state}); run: node tools/probe.mjs --serve`);
  process.exit(2);
}
console.log(`[world]  mode=${AN.mode}  colliders=${AN.colliders.toLocaleString()}  carriageways=${AN.roads}`);
if (AN.arena) console.log(`[arena]  x ${AN.arena.minX.toFixed(0)}..${AN.arena.maxX.toFixed(0)}   z ${AN.arena.minZ.toFixed(0)}..${AN.arena.maxZ.toFixed(0)}`);

/* TILE SIZE IS NOT A TASTE. CDP returns an eval by value, and a 1129 x 590 m
   box of this world serialises to more than that channel will carry — the
   first run of this tool got a TRUNCATED payload back and a JSON parse error,
   which is the failure mode most likely to be misread as "nothing found".
   So every region is cut into tiles of at most TILE metres and the findings
   are merged here. Tiles overlap by OVER so a barrier lying on a seam is not
   cut in half; findings are de-duplicated on position afterwards. */
const TILE = num("--tile", 240);
const DUMP_OPTS = {};
if (arg("--max-wall-h", null)) DUMP_OPTS.maxWallH = num("--max-wall-h", 30);
if (arg("--min-wall-h", null)) DUMP_OPTS.minWallH = num("--min-wall-h", 1.0);
if (arg("--flat-cos", null)) DUMP_OPTS.flatCos = num("--flat-cos", 0.15);
const OVER = num("--overlap", 12);

/* THINGS A CENSUS HAS NOTHING TO SAY ABOUT. Ground, sea and sky are drawn as
   named groups too, and they are enormous — sweeping them costs the whole
   budget and returns nothing, because a surface has no vertical faces and no
   colliders to compare them against. Named, not guessed, so a reader can see
   what the sweep declined to visit. */
const NOT_A_PLACE = /-surface(-\d+)?$|^chunk_|terrain|ground|ocean|sea-|water|river|sky|backdrop|horizon|cloud|fog|shadow|light|lod-|proxy|marker|label|decal|billboard/i;

let region = null;      // {x0,z0,x1,z1}
let regionLabel = "";
let sweepRegions = null;
if (has("--sweep")) {
  const all = await structures();
  const min = num("--min-tris", 400), maxSpan = num("--max-span", 500), minSpan = num("--min-span", 6);
  const keep = all.filter((o) => {
    if (NOT_A_PLACE.test(o.name)) return false;
    const w = o.maxX - o.minX, d = o.maxZ - o.minZ;
    if (!isFinite(w) || !isFinite(d)) return false;
    if (Math.max(w, d) > maxSpan || Math.max(w, d) < minSpan) return false;
    return o.tris >= min;
  });
  /* Structures that stand on top of each other are ONE place. Merging them
     matters for more than probe count: the pierce test only sees a fence
     going through a garage if both are inside the same dump. */
  const P = num("--cluster-pad", 15);
  const box = keep.map((o) => ({ x0: o.minX - P, z0: o.minZ - P, x1: o.maxX + P, z1: o.maxZ + P,
                                 tris: o.tris, names: [o.name] }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < box.length; i++) {
      if (!box[i]) continue;
      for (let j = i + 1; j < box.length; j++) {
        const a = box[i], b = box[j];
        if (!b) continue;
        if (a.x1 < b.x0 || b.x1 < a.x0 || a.z1 < b.z0 || b.z1 < a.z0) continue;
        a.x0 = Math.min(a.x0, b.x0); a.z0 = Math.min(a.z0, b.z0);
        a.x1 = Math.max(a.x1, b.x1); a.z1 = Math.max(a.z1, b.z1);
        a.tris += b.tris; a.names.push(...b.names);
        box[j] = null; merged = true;
      }
    }
  }
  const ranked = box.filter(Boolean).sort((a, b) => b.tris - a.tris);
  /* A TILE BUDGET, not just a place limit. One 800 m terrain chunk that slips
     through the filter is 16 tiles on its own, and a sweep that quietly grew
     to 476 of them would have run for hours — take places in size order until
     the budget is spent, and SAY how many were left. */
  const budget = num("--max-tiles", 60);
  sweepRegions = []; let tiles = 0;
  for (const R of ranked.slice(0, num("--limit", 24))) {
    const t = Math.ceil((R.x1 - R.x0) / TILE) * Math.ceil((R.z1 - R.z0) / TILE);
    if (tiles && tiles + t > budget) continue;
    sweepRegions.push(R); tiles += t;
  }
  console.log(`[sweep]  ${all.length} named objects -> ${keep.length} built structures -> ` +
    `${ranked.length} places; censusing ${sweepRegions.length} of them` +
    `${ranked.length > sweepRegions.length ? ` (${ranked.length - sweepRegions.length} skipped: --limit / --max-tiles ${budget})` : ""}`);
  regionLabel = "GANG CITY — " + sweepRegions.length + " places";
} else if (arg("--group", null)) {
  const pat = arg("--group", "");
  const gb = await groupBounds(pat);
  if (!gb || !gb.n || gb.minX == null) {
    console.error(`no scene group matches /${pat}/i${gb && gb.n ? " with any geometry" : ""}.`);
    if (gb && gb.sample) console.error("named objects in the scene (first 80):\n  " + gb.sample.join("\n  "));
    process.exit(2);
  }
  const p = num("--pad", 20);
  regionLabel = `/${pat}/i — ${gb.n} object(s): ${gb.names.slice(0, 4).join(", ")}${gb.n > 4 ? " …" : ""}`;
  region = { x0: gb.minX - p, z0: gb.minZ - p, x1: gb.maxX + p, z1: gb.maxZ + p };
} else {
  const at = (arg("--at", "0,0")).split(",").map(Number);
  const r = num("--r", 200);
  region = { x0: at[0] - r, z0: at[1] - r, x1: at[0] + r, z1: at[1] + r };
  regionLabel = `${at[0]}, ${at[1]}  r=${r}`;
}

const boxes = [];
for (const R of (sweepRegions || [region])) {
  for (let x = R.x0; x < R.x1; x += TILE)
    for (let z = R.z0; z < R.z1; z += TILE)
      boxes.push({ x0: x - OVER, z0: z - OVER,
                   x1: Math.min(x + TILE, R.x1) + OVER, z1: Math.min(z + TILE, R.z1) + OVER,
                   // the label rides on the box: a failed tile is re-queued as
                   // four, which shifts every index after it.
                   place: R.names ? R.names[0] : null });
}

console.log(`[region] ${regionLabel}`);
if (!sweepRegions)
  console.log(`[region] x ${region.x0.toFixed(0)}..${region.x1.toFixed(0)}  z ${region.z0.toFixed(0)}..${region.z1.toFixed(0)}` +
              `  = ${(region.x1 - region.x0).toFixed(0)} x ${(region.z1 - region.z0).toFixed(0)} m in ${boxes.length} tile(s)`);
else
  for (const R of sweepRegions)
    console.log(`         ${pad(R.names[0], 34)} ${rpad((R.x1 - R.x0).toFixed(0), 5)} x ${rpad((R.z1 - R.z0).toFixed(0), 5)} m` +
                `  at ${((R.x0 + R.x1) / 2).toFixed(0)}, ${((R.z0 + R.z1) / 2).toFixed(0)}   (${R.names.length} structure(s))`);
console.log(`[region] ${boxes.length} tile(s) of <=${TILE} m`);

// ------------------------------------------------------------------ gather
const perOwner = new Map();
const gaps = [], pierces = [], roadSolids = [], roadCuts = [], doubles = [], phantoms = [];
const seen = new Set();                       // de-dup across overlapping tiles
const pairIdx = new Map();                    // pierce pairs merge across tiles
const key = (...a) => a.map((v) => (typeof v === "number" ? Math.round(v) : v)).join("|");
const agg = { tris: 0, meshes: 0, faces: 0, runs: 0, solids: 0, exFaces: 0, exM: 0,
               tallFaces: 0, tallM: 0, maxWallH: num("--max-wall-h", 30), capped: 0, failed: 0 };
const jsonTiles = [];

for (let i = 0; i < boxes.length; i++) {
  const box = boxes[i];
  let dump;
  try { dump = await dumpBox(box, DUMP_OPTS); }
  catch (e) {
    // A tile can fail for exactly one interesting reason — too much geometry
    // in it — so retry it as four smaller ones before giving up. Dropping a
    // tile silently would understate every total below it.
    const half = { x: (box.x0 + box.x1) / 2, z: (box.z0 + box.z1) / 2 };
    const quads = [
      { x0: box.x0, z0: box.z0, x1: half.x + OVER, z1: half.z + OVER },
      { x0: half.x - OVER, z0: box.z0, x1: box.x1, z1: half.z + OVER },
      { x0: box.x0, z0: half.z - OVER, x1: half.x + OVER, z1: box.z1 },
      { x0: half.x - OVER, z0: half.z - OVER, x1: box.x1, z1: box.z1 },
    ];
    console.error(`  ~ tile ${i + 1}/${boxes.length} failed (${e.message.split("\n")[0].slice(0, 90)}); splitting into 4`);
    for (const q of quads) q.place = box.place;
    boxes.splice(i + 1, 0, ...quads);
    agg.split = (agg.split || 0) + 1;
    continue;
  }
  if (!dump || dump.error) { agg.failed++; console.error("  ! " + ((dump && dump.error) || "empty dump")); continue; }
  const A = analyse(dump);
  const s = dump.stats;
  agg.tris += s.tris; agg.meshes += s.meshes; agg.faces += s.wallSegs;
  agg.runs += A.runs.length; agg.solids += s.solidsInBox; if (s.capped) agg.capped++;
  agg.exFaces += A.runs.excluded.faces; agg.exM += A.runs.excluded.m;
  agg.tallFaces += s.tallFaces || 0; agg.tallM += s.tallM || 0;

  for (const p of A.cov.per) {
    // per-owner metres are summed over tiles; the overlap band double-counts a
    // little drawn AND a little ghost, so the RATIO stays honest even though
    // the absolute metres run a few percent high on a multi-tile sweep.
    let r = perOwner.get(p.owner);
    if (!r) perOwner.set(p.owner, r = { owner: p.owner, drawnM: 0, ghostM: 0, highM: 0, highGhostM: 0 });
    r.drawnM += p.drawnM; r.ghostM += p.ghostM;
    r.highM += p.highM || 0; r.highGhostM += p.highGhostM || 0;
  }
  for (const g of A.cov.gaps) { const k = key("g", g.owner, g.x, g.z); if (!seen.has(k)) { seen.add(k); gaps.push(g); } }
  for (const p of A.pi) { const k = key("p", p.a, p.b); const e = pairIdx.get(k);
    if (e) { e.n += p.n; if (p.maxDepth > e.maxDepth) { e.maxDepth = p.maxDepth; e.maxDy = p.maxDy; e.x = p.x; e.z = p.z; } }
    else { pairIdx.set(k, { ...p }); pierces.push(pairIdx.get(k)); } }
  for (const r of A.rc.solids) { const k = key("rs", r.x, r.z); if (!seen.has(k)) { seen.add(k); roadSolids.push(r); } }
  for (const r of A.rc.barriers) { const k = key("rb", r.owner, r.x, r.z); if (!seen.has(k)) { seen.add(k); roadCuts.push(r); } }
  for (const d of A.dbl.items) { const k = key("d", d.x, d.z); if (!seen.has(k)) { seen.add(k); doubles.push(d); } }
  for (const p of A.ph.items) { const k = key("ph", p.x, p.z); if (!seen.has(k)) { seen.add(k); phantoms.push(p); } }

  if (boxes.length > 1) {
    const gm = A.cov.per.reduce((a, p) => a + p.ghostM, 0);
    process.stdout.write(`  tile ${String(i + 1).padStart(3)}/${boxes.length}  ` +
      pad(box.place || `x${box.x0.toFixed(0)} z${box.z0.toFixed(0)}`, 26) + "  " +
      `ghost ${rpad(gm.toFixed(0), 5)}m  pierce ${rpad(A.pi.all.length, 4)}  ` +
      `road ${rpad(A.rc.solidArea.toFixed(0), 5)}m2  double ${rpad(A.dbl.totalArea.toFixed(0), 6)}m2\n`);
  }
  if (arg("--json", null)) jsonTiles.push({ box, stats: s, cov: A.cov, pierce: A.pi, road: A.rc, dbl: A.dbl, ph: A.ph });
}

// ----------------------------------------------------------------- totals
const owners = [...perOwner.values()];
const drawnM = owners.reduce((a, p) => a + p.drawnM, 0);
const ghostM = owners.reduce((a, p) => a + p.ghostM, 0);
const highM = owners.reduce((a, p) => a + p.highM, 0);
const highGhostM = owners.reduce((a, p) => a + p.highGhostM, 0);
const roadArea = roadSolids.reduce((a, r) => a + r.area, 0);
const roadCutM = roadCuts.reduce((a, r) => a + r.m, 0);
const dblArea = doubles.reduce((a, d) => a + d.area, 0);
const phArea = phantoms.reduce((a, p) => a + p.area, 0);

gaps.sort((a, b) => b.len - a.len);
pierces.sort((a, b) => b.maxDepth * b.maxDy - a.maxDepth * a.maxDy);
const pierceN = pierces.reduce((a, p) => a + p.n, 0);
roadSolids.sort((a, b) => b.area - a.area);
roadCuts.sort((a, b) => b.m - a.m);
doubles.sort((a, b) => b.area - a.area);
phantoms.sort((a, b) => b.area - a.area);

console.log("");
console.log(B(RULE));
console.log(B("  SOLID CENSUS  ") + regionLabel);
console.log(B(RULE));
if (!QUIET) {
  console.log(`  scanned   ${agg.meshes.toLocaleString()} meshes / ${agg.tris.toLocaleString()} triangles` +
    `${agg.capped ? `  (${agg.capped} TILE(S) HIT THE TRIANGLE CAP)` : ""}`);
  console.log(`            ${agg.faces.toLocaleString()} vertical faces -> ${agg.runs.toLocaleString()} barrier runs` +
    `;  ${agg.solids.toLocaleString()} colliders in region`);
  if (agg.exFaces) console.log(`            ${agg.exFaces.toLocaleString()} faces / ${agg.exM.toFixed(0)} m excluded by name as not-a-barrier (--no-exclude, --exclude)`);
  if (agg.tallFaces) console.log(`            ${agg.tallFaces.toLocaleString()} faces / ${agg.tallM.toFixed(0)} m excluded as taller than ${agg.maxWallH} m — cliff / backdrop, not architecture (--max-wall-h)`);
  if (agg.failed) console.log(`            ${agg.failed} TILE(S) FAILED — the numbers below are incomplete`);
}
console.log("");
console.log(B("  HEADLINE"));
console.log(`    GHOST      ${rpad(ghostM.toFixed(1), 10)} m   of ${drawnM.toFixed(0)} m REACHABLE barrier has no collider   (${(100 * ghostM / (drawnM || 1)).toFixed(1)}%)`);
console.log(`      + high   ${rpad(highGhostM.toFixed(1), 10)} m   of ${highM.toFixed(0)} m starting above head height — seen, never touched`);
console.log(`    PIERCE     ${rpad(pierceN, 10)}      wall-through-wall crossings, between ${pierces.length} pair(s) of structures`);
console.log(`    ROADBLOCK  ${rpad(roadArea.toFixed(1), 10)} m2  of carriageway with a collider standing in it`);
console.log(`    ROADCUT    ${rpad(roadCutM.toFixed(1), 10)} m   of barrier drawn across a carriageway`);
console.log(`    DOUBLE     ${rpad(dblArea.toFixed(1), 10)} m2  where two colliders hold the same ground`);
console.log(`    PHANTOM    ${rpad(phArea.toFixed(1), 10)} m2  of wall-thin solid with nothing drawn in it`);

function table(title, note, head, rows, fmt) {
  if (!rows.length) return;
  console.log("");
  console.log(B("  " + title) + (note ? "   " + note : ""));
  console.log("    " + head);
  for (const r of rows.slice(0, TOP)) console.log("    " + fmt(r));
  if (rows.length > TOP) console.log(`    … ${rows.length - TOP} more`);
}

table("GHOST BY STRUCTURE", "(drawn barrier you can walk straight through)",
  pad("structure", 40) + rpad("drawn m", 10) + rpad("ghost m", 10) + rpad("solid %", 9),
  owners.filter((p) => p.ghostM > 0.5).sort((a, b) => b.ghostM - a.ghostM),
  (p) => pad(p.owner, 40) + rpad(p.drawnM.toFixed(1), 10) + rpad(p.ghostM.toFixed(1), 10) +
         rpad((100 * (1 - p.ghostM / (p.drawnM || 1))).toFixed(1), 9));

const reachGaps = gaps.filter((g) => g.reachable);
table("WIDEST HOLES YOU CAN WALK THROUGH", `(${reachGaps.length} of ${gaps.length} unsolid stretches >= 1.5 m start at ground level)`,
  rpad("len m", 8) + rpad("h m", 7) + rpad("lift", 6) + "  " + pad("structure", 38) + "at (x, z)",
  reachGaps, (g) => rpad(g.len.toFixed(1), 8) + rpad(g.h.toFixed(1), 7) + rpad(g.lift.toFixed(1), 6) + "  " + pad(g.owner, 38) + `${g.x}, ${g.z}`);

table("PIERCES", "(wall crossing wall, interior to both, heights overlapping)",
  rpad("n", 5) + rpad("deepest", 9) + rpad("dy", 7) + "  " + pad("structure A", 26) + pad("structure B", 26) + "at (x, z)",
  pierces, (p) => rpad(p.n, 5) + rpad(p.maxDepth.toFixed(1) + " m", 9) + rpad(p.maxDy.toFixed(1), 7) + "  " +
                  pad(p.a, 26) + pad(p.b, 26) + `${p.x}, ${p.z}`);

table("SOLIDS STANDING IN A CARRIAGEWAY", "(`width` = fraction of the road's width the box spans)",
  rpad("m2", 9) + rpad("width", 8) + "  " + pad("road", 16) + "at (x, z)",
  roadSolids, (s) => rpad(s.area.toFixed(1), 9) + rpad((100 * s.block).toFixed(0) + "%", 8) + "  " +
                     pad((s.road || "road") + " w" + s.w, 16) + `${s.x}, ${s.z}`);

table("BARRIER DRAWN ACROSS A CARRIAGEWAY", "(`width` = fraction of the road's width it spans; 100% = the road is closed)",
  rpad("width", 8) + rpad("m", 7) + rpad("h", 6) + "  " + pad("structure", 34) + "at (x, z)",
  roadCuts, (s) => rpad((100 * s.block).toFixed(0) + "%", 8) + rpad(s.m.toFixed(1), 7) + rpad(s.h.toFixed(1), 6) + "  " +
                   pad(s.owner, 34) + `${s.x}, ${s.z}`);

table("DOUBLE-WALLED", "(two colliders, same ground, overlapping heights)",
  rpad("m2", 9) + rpad("of smaller", 12) + "  at (x, z)",
  doubles, (d) => rpad(d.area.toFixed(1), 9) + rpad((100 * d.frac).toFixed(0) + "%", 12) + `  ${d.x}, ${d.z}`);

if (!QUIET)
  table("PHANTOM SOLID", "(wall-thin collider with nothing drawn in it — cf tools/ghost-collider-check.mjs)",
    rpad("m2", 9) + rpad("of box", 9) + rpad("size", 14) + rpad("kind", 6) + "  at (x, z)",
    phantoms, (p) => rpad(p.area.toFixed(1), 9) + rpad((100 * p.frac).toFixed(0) + "%", 9) +
      rpad(p.w.toFixed(1) + " x " + p.d.toFixed(1), 14) + rpad(p.yaw == null ? "aabb" : "obb", 6) + `  ${p.x}, ${p.z}`);
console.log("");

if (arg("--json", null)) {
  await writeFile(arg("--json", "solid-census.json"), JSON.stringify({
    region, regionLabel, world: AN, totals: { drawnM, ghostM, highM, highGhostM, pierceCrossings: pierceN, piercePairs: pierces.length, roadArea, roadCutM, dblArea, phArea },
    owners, gaps, pierces, roadSolids, roadCuts, doubles, phantoms, scanned: agg,
    tiles: has("--json-tiles") ? jsonTiles : undefined,
  }, null, 1));
  console.log(`[json] ${arg("--json", "")}`);
}

// ------------------------------------------------------------------- ratchet
let fail = 0;
const gate = (flag, val, unit) => {
  const lim = num(flag, null);
  if (lim != null && val > lim) { console.error(`FAIL ${flag.slice(6)} ${val.toFixed(1)} ${unit} > ${lim}`); fail = 1; }
};
gate("--max-ghost", ghostM, "m");
gate("--max-pierce", pierceN, "");
gate("--max-roadblock", roadArea, "m2");
gate("--max-roadcut", roadCutM, "m");
process.exit(fail);
