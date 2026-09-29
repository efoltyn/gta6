#!/usr/bin/env node
/* tools/city-slice-trace.mjs — MEASURE WHERE EVERY LANDMASS BUILDER DRAWS.

   City slices (src/core/slice.js) boot one piece of Gang City as its own
   world. To skip a landmass builder the slice has to know, BEFORE running
   it, where that builder draws and what plain data it registers. Guessing
   from file names is how a slice ends up with a hole in the coastline, so it
   is measured: one full city build with ?sliceTrace=1, where
   city/worldmap.js records after every builder
     • the 400 m cells its new meshes, colliders and platforms touch,
     • whether it is TERRAIN (a ground-height oracle or a far-fogged
       surface: the horizon, never skipped),
     • the regions, roads, water bodies, no-spawn zones, biome blends and
       frontier records it registered (replayed when it is skipped).
   The result is written to src/city/slice_manifest.js (a slice boot loads it;
   a normal boot never does).

     node tools/city-slice-trace.mjs            # write the manifest
     node tools/city-slice-trace.mjs --print    # ... and print the builder table
     node tools/city-slice-trace.mjs --check    # exit 1 if the manifest is stale
                                                # (a builder added/removed/renamed)

   Re-run it when a landmass builder moves, is added, or changes what it
   registers. A stale manifest never breaks a slice: an unknown builder runs.
   Costs one full city build plus a tree walk per builder (~1-2 min). */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { launch, ROOT } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const OUT = path.join(ROOT, "src/city/slice_manifest.js");
const SEED = arg("--seed", "90210");

const rig = await launch({ rafBudget: 30 });
let code = 0;
try {
  await rig.open("index.html", `mode=city&seed=${SEED}&sliceTrace=1`);
  if (!await rig.wait("window.CBZ && CBZ.bootComplete && CBZ.startRun && document.readyState === 'complete'", 300000)) throw new Error("engine never came up");
  console.error("[slice-trace] booted — building the whole city with the recorder on");
  const t0 = Date.now();
  await rig.evl("(function(){ window.__stopRaf && window.__stopRaf(); CBZ.startRun(); return 1; })()");
  const T = await rig.evl("JSON.stringify(CBZ.SLICE_TRACE_OUT || null)");
  if (!T || T === "null") throw new Error("no trace — did city/worldmap.js run cityWorldGeo with ?sliceTrace=1?");
  const trace = JSON.parse(T);
  /* THE COST MAP. What the finished city (after the batch pass, the way it
     is drawn) holds per 400 m cell: draw-able meshes, triangles, geometry MB.
     core/citystream.js sizes a streamed slice so its keep circle holds about
     what the jail holds (tools/speed.mjs --modes escape). Terrain and the sea
     are excluded: they are the horizon every slice keeps. */
  trace.cellCost = JSON.parse(await rig.evl(`(function(){
    var C = CBZ, root = C.city.arena.root, cell = ${trace.cell || 400}, out = {}, seen = new Set();
    var v = new THREE.Vector3(), m4 = new THREE.Matrix4(), box = new THREE.Box3();
    root.updateMatrixWorld(true);
    function bytes(g){ if (seen.has(g)) return 0; seen.add(g); var b = 0, a = g.attributes || {}; for (var k in a) if (a[k] && a[k].array) b += a[k].array.byteLength; if (g.index) b += g.index.array.byteLength; return b; }
    function add(x, z, d, t, b){ var k = Math.floor(x / cell) + "," + Math.floor(z / cell); var e = out[k] || (out[k] = [0, 0, 0]); e[0] += d; e[1] += t; e[2] += b; }
    root.traverse(function(o){
      if (!(o.isMesh || o.isPoints || o.isLine) || !o.geometry) return;
      var u = o.userData || {}, m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (u.worldSurface || u.terrain || u.metroFar || (m && (m.isShaderMaterial || (m.userData && m.userData._cbzFogScaled)))) return;
      var g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
      var p = g.attributes.position; if (!p) return;
      var tris = (g.index ? g.index.count : p.count) / 3, b = bytes(g);
      if (o.isInstancedMesh) {
        var n = Math.max(1, o.count); b += o.instanceMatrix.array.byteLength;
        for (var i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); v.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld); add(v.x, v.z, 1 / n, tris, b / n); }
        return;
      }
      box.copy(g.boundingBox).applyMatrix4(o.matrixWorld); box.getCenter(v);
      add(v.x, v.z, 1, tris, b);
    });
    for (var k in out) out[k] = [Math.round(out[k][0] * 10) / 10, Math.round(out[k][1]), Math.round(out[k][2] / 1024)];
    return JSON.stringify(out);
  })()`));
  const keys = Object.keys(trace.builders);
  console.error(`[slice-trace] ${keys.length} builders traced in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  if (has("--check")) {
    const cur = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
    const m = /SLICE_MANIFEST = (\{[\s\S]*\});/.exec(cur);
    const old = m ? JSON.parse(m[1]) : { builders: {} };
    const a = Object.keys(old.builders).sort().join("|"), b = keys.slice().sort().join("|");
    if (a !== b) { console.error("slice_manifest.js is STALE (builder set changed) — run: node tools/city-slice-trace.mjs"); code = 1; }
    else console.log("slice manifest covers the current builder set (" + keys.length + ")");
  } else {
    const body = JSON.stringify({ generatedAt: new Date().toISOString(), seed: trace.seed, cell: trace.cell, cellCost: trace.cellCost, builders: trace.builders });
    writeFileSync(OUT, `/* GENERATED by tools/city-slice-trace.mjs — do not edit. Re-run the tool when a
   landmass builder moves, is added, or changes what it registers.
   Per builder: the 400 m cells it draws in, whether it is terrain (never
   skipped), and the plain data it registers (replayed when a slice skips it).
   cellCost: per 400 m cell of the finished city, [draws, triangles, geometry KB].
   Loaded only by a slice boot (core/slice.js document.writes it). */
window.CBZ = window.CBZ || {};
window.CBZ.SLICE_MANIFEST = ${body};
`);
    console.error(`[slice-trace] wrote ${path.relative(ROOT, OUT)} (${(body.length / 1024).toFixed(0)} KB)`);
  }
  if (has("--print") || has("--check")) {
    const rows = keys.map((k) => [k, trace.builders[k]]).sort((x, y) => x[1].order - y[1].order);
    for (const [k, r] of rows) {
      const d = Object.entries(r.data).map(([n, v]) => n + ":" + v.length).join(" ");
      console.log(`${String(r.order).padStart(9)} ${k.padEnd(28)} ${String(r.ms).padStart(5)} ms ${r.oracle ? "ORACLE " : r.terrain ? "TERRAIN" : r.wide ? "WIDE   " : r.surface ? "surface" : "       "} cells ${String(r.cells.length).padStart(4)} meshes ${String(r.meshes).padStart(6)} cols ${String(r.colliders).padStart(6)}  ${d}`);
    }
  }
  if (rig.errors.length) console.error("[slice-trace] page errors: " + rig.errors.length + " (first: " + rig.errors[0] + ")");
} catch (e) {
  console.error("[slice-trace] " + (e && e.stack || e));
  code = 2;
} finally {
  await rig.close();
}
process.exit(code);
