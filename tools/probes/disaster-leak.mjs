/* tools/probes/disaster-leak.mjs — THE DISASTER GAME'S LEAK DETECTOR.

   Owner report (2026-10-29): "loads fast, then at some point while playing
   the tab dies. Only on phone. Memory." The device is the detector; this is
   the desk version of it. It runs every disaster through a whole round
   (forced warn -> active -> end -> the calm that settles the island) TWICE,
   and after each round snapshots, after a forced GC:

     heap      JS heap used (CDP Runtime.getHeapUsage after collectGarbage)
     geo/tex   three's live GPU geometries / textures (one frame drawn first)
     prog      shader programs
     objs      scene graph nodes
     upd/alw   frame hooks
     CBZ.*     every top-level CBZ array / Map / Set

   Cycle 1 pays for every cache (a program compiled, a pool filled). Cycle 2
   must land where cycle 1 did, disaster for disaster. Then a NEW MATCH
   (CBZ.disasters.start + a third pass over a few) must not stand on top of
   the last one. What grew is named: GPU buffers uploaded after the baseline,
   never disposed, in no scene ("held by nothing"), and CBZ lists that grew
   every round.

     node tools/testbus/standalone.mjs tools/probes/disaster-leak.mjs [--only quake,volcano] [--cycles 2] [-v] [--heap]
       --cycles N   N matches (each ends in CBZ.startRun, the game's own new match)
       --heap       heap snapshots at the start of match 2 and of the last match,
                    diffed: what survived N-2 matches, by class and retainer path
       --every K    draw a frame every K sim ticks (default 45) so buffers upload

   Exit 0 = clean, 1 = a leak. */
export const meta = { world: "survival", fresh: true, dirties: true, timeoutMs: 60 * 60e3 };
// memscope is imported as a library below: without this its CLI main() runs
// (a whole city boot in a second Chrome, then process.exit)
process.env.MEMSCOPE_LIB = "1";

const IDS = ["quake", "storm", "flashflood", "flood", "wildfire", "tornado", "hurricane", "blizzard", "meteor", "sinkhole", "volcano", "nuke"];

const SETUP = `
  // the player is the camera, not a contestant: nothing a disaster does ends the run
  var S = CBZ.surv, h = S.hurt;
  if (!S.__leakWrapped) { S.__leakWrapped = 1; S.hurt = function (a) { if (a && a.isPlayer) return; return h.apply(this, arguments); }; }
  if (CBZ.disasterHurt && !CBZ.disasterHurt.__leak) { var dh = CBZ.disasterHurt; CBZ.disasterHurt = function () {}; for (var k in dh) CBZ.disasterHurt[k] = dh[k]; CBZ.disasterHurt.__leak = 1; }
  return 1;
`;

const SNAP = `
  var R = CBZ.renderer, out = { lists: {}, maps: {} };
  try { CBZ.renderFrame(); } catch (e) {}
  var info = R && R.info;
  out.gpuGeo = info ? info.memory.geometries : -1;
  out.gpuTex = info ? info.memory.textures : -1;
  out.programs = info && info.programs ? info.programs.length : -1;
  // which programs are new since the last snapshot, by name (a shader that
  // keeps compiling new variants is a GPU + driver leak three never frees)
  if (info && info.programs) {
    var prev = window.__progPrev || new Set(), now = new Set(), nw = {};
    var olds = [];
    info.programs.forEach(function (p) { if (prev.has(p)) olds.push(p); });
    info.programs.forEach(function (p) {
      now.add(p); if (prev.has(p)) return;
      var k = p.name || "?"; nw[k] = (nw[k] || 0) + 1;
      // WHAT made it new: the cache-key fields it differs in from the
      // nearest program already alive (same length key, fewest differences)
      var a = String(p.cacheKey || "").split(","), best = null, bd = 1e9;
      for (var i = 0; i < olds.length; i++) {
        var b = String(olds[i].cacheKey || "").split(",");
        if (b.length !== a.length) continue;
        var d = 0; for (var j = 0; j < a.length && d < bd; j++) if (a[j] !== b[j]) d++;
        if (d < bd) { bd = d; best = b; }
      }
      var why = best ? [] : ["(no peer)"];
      if (best) for (var j2 = 0; j2 < a.length; j2++) if (a[j2] !== best[j2]) why.push("#" + j2 + ":" + String(best[j2]).slice(0, 24) + "->" + String(a[j2]).slice(0, 24));
      var wk = why.slice(0, 4).join(" ");
      (out.progWhy = out.progWhy || {})[wk] = ((out.progWhy || {})[wk] || 0) + 1;
    });
    window.__progPrev = now; out.newPrograms = nw;
  }
  out.updaters = CBZ.updaters ? CBZ.updaters.length : -1; out.always = CBZ.always ? CBZ.always.length : -1;
  out.colliders = (CBZ.colliders || []).length; out.platforms = (CBZ.platforms || []).length;
  var n = 0, drawn = new Set(); CBZ.scene.traverse(function (o) { n++; if (o.geometry) drawn.add(o.geometry); }); out.sceneObjs = n;
  // GPU geometries held while drawn by nothing in the scene: what a leak looks
  // like (the drawn ones move with the camera, the car LOD tier, the rubble)
  if (window.__gpu) { var off = 0; window.__gpu.live.forEach(function (x) { if (!x.isTexture && !drawn.has(x)) off++; }); out.geoOff = off; }
  out.geoIn = drawn.size;
  // unique scene geometries by where they hang (for the match-to-match diff)
  var where = {}, seenG = new Set();
  CBZ.scene.traverse(function (o) {
    if (!o.geometry || seenG.has(o.geometry)) return; seenG.add(o.geometry);
    var p = o, path = []; for (var d = 0; p && d < 4; d++, p = p.parent) path.push((p.name || p.type).replace(/[0-9]{2,}/g, "#"));
    var k = path.join("<"); where[k] = (where[k] || 0) + 1;
  });
  out.where = where;
  try { out.structs = CBZ.collapse && CBZ.collapse._structs ? CBZ.collapse._structs.length : -1; } catch (e) {}
  try { var ds = CBZ.debris && CBZ.debris.stats ? CBZ.debris.stats() : null; if (ds) out.debris = { live: ds.live, static: ds.static, kept: ds.kept, frozen: ds.frozen, buckets: ds.buckets, watched: ds.watched }; } catch (e) {}
  try { var cc = CBZ.cityCarCacheSizes ? CBZ.cityCarCacheSizes() : null; out.cars = { looks: CBZ.cityCarBodyTemplates ? CBZ.cityCarBodyTemplates().looks : -1, merge: cc ? cc.merge : -1, vc: cc ? cc.vc : -1 }; } catch (e) {}
  // OLD CROWDS: every bot of every earlier match is held weakly; one that is
  // still alive after a GC is held by something that outlived its match
  try {
    var W = window.__botRefs || (window.__botRefs = { seen: new WeakSet(), refs: [] });
    var alive = 0, cur = new Set(CBZ.bots || []);
    W.refs = W.refs.filter(function (r) { var b = r.deref(); if (!b) return false; if (!cur.has(b)) alive++; return true; });
    (CBZ.bots || []).forEach(function (b) { if (b && !W.seen.has(b)) { W.seen.add(b); W.refs.push(new WeakRef(b)); } });
    out.oldBots = alive;
  } catch (e) {}
  out.bots = CBZ.surv && CBZ.surv.liveBots ? CBZ.surv.liveBots() : -1;
  out.state = CBZ.game.state;
  var seen = new Set();
  for (var k in CBZ) {
    var v; try { v = CBZ[k]; } catch (e) { continue; }
    if (!v || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) out.lists[k] = v.length;
    else if (v instanceof Map || v instanceof Set) out.maps[k] = v.size;
  }
  return out;
`;

/* step the live director through one forced round: until it has gone ACTIVE
   and come back to IDLE, then `settle` more seconds of the calm. A frame is
   drawn every `every` ticks so effect buffers really reach the GPU. */
const ROUND = (id, settle, every) => `
  var D = CBZ.disasters, dt = 1 / 30, P = CBZ.player;
  if (!D.force(${JSON.stringify(id)})) return { err: "force refused" };
  var seenActive = false, t = 0, n = 0, maxT = 600;
  var keep = function () { if (P) { P.hp = 100; P.dead = false; } };
  while (t < maxT) {
    keep(); __tb.step(1, dt); t += dt; n++;
    if (n % ${every} === 0) try { CBZ.renderFrame(); } catch (e) {}
    var s = D.state();
    if (s === "active") seenActive = true;
    if (seenActive && s === "idle") break;
    if (CBZ.game.state !== "playing") return { err: "game " + CBZ.game.state, t: t };
  }
  var endT = t;
  for (var k = 0; k < ${settle} / dt; k++) { keep(); __tb.step(1, dt); n++; if (n % ${every} === 0) try { CBZ.renderFrame(); } catch (e) {} }
  return { t: Math.round(endT), seenActive: seenActive };
`;

const GPU_HOOK = `
  if (window.__gpu) return 1;
  var G = window.__gpu = { live: new Set(), desc: new WeakMap(), base: null, progBy: {} };
  // WHICH RENDER compiled a program: wrapped outside every other hook (the
  // light pin's included), so a scene, camera and caller are named
  var R = CBZ.renderer;
  var watch = function (orig, tag) { return function (scene, camera) {
    var n0 = R.info.programs ? R.info.programs.length : 0;
    var out = orig.apply(this, arguments);
    var n1 = R.info.programs ? R.info.programs.length : 0;
    if (n1 > n0) {
      var st = String(new Error().stack || "").split("\\n").slice(2, 5).map(function (l) { return l.replace(/^\\s*at\\s*/, "").replace(/\\(?https?:[^ ]*?\\/src\\//, "").replace(/\\?v=[^:]*/, "").replace(/\\)$/, ""); }).join(" < ");
      var k = tag + " " + (scene === CBZ.scene ? "MAIN" : "scene:" + (scene && (scene.name || scene.uuid.slice(0, 6)))) + " cam:" + (camera && (camera.name || camera.type)) + " L" + (camera && camera.layers.mask) + " rt:" + (R.getRenderTarget() ? 1 : 0) + " | " + st;
      G.progBy[k] = (G.progBy[k] || 0) + (n1 - n0);
    }
    return out;
  }; };
  R.render = watch(R.render, "render");
  if (R.compile) R.compile = watch(R.compile, "compile");
  [THREE.BufferGeometry.prototype, THREE.Texture.prototype].forEach(function (P) {
    var add = P.addEventListener, rem = P.removeEventListener;
    P.addEventListener = function (type, fn) { if (type === "dispose") G.live.add(this); return add.call(this, type, fn); };
    P.removeEventListener = function (type, fn) { if (type === "dispose") G.live.delete(this); return rem.call(this, type, fn); };
  });
  return 1;
`;
const GPU_SEE = `
  var G = window.__gpu; if (!G) return 0;
  var path = function (o) { var p = o, out = []; for (var d = 0; p && d < 5; d++, p = p.parent) out.push(p.name || p.type); return out.join("<"); };
  CBZ.scene.traverse(function (o) {
    if (o.geometry) G.desc.set(o.geometry, path(o) + " [" + (o.geometry.type || "") + "]");
    var ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    ms.forEach(function (m) { if (!m) return; for (var k in m) { var t = m[k]; if (t && t.isTexture) G.desc.set(t, path(o) + " ." + k + " (" + (m.name || m.type) + ")"); } });
  });
  return 1;
`;
const GPU_WHY = (base, verbose) => `
  var G = window.__gpu; if (!G) return null;
  if (${base ? 1 : 0}) { G.base = new Set(G.live); return { based: G.base.size }; }
  var inScene = new Set();
  CBZ.scene.traverse(function (o) {
    if (o.geometry) inScene.add(o.geometry);
    var ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    ms.forEach(function (m) { if (!m) return; for (var k in m) { var t = m[k]; if (t && t.isTexture) inScene.add(t); } });
  });
  var R = CBZ.renderer, held = function (x) {
    if (x.isTexture) { var p = R.properties.get(x); return !!(p && p.__webglTexture); }
    var a = x.index || (x.attributes && (x.attributes.position || x.attributes[Object.keys(x.attributes)[0]]));
    if (!a) return true;
    if (a.isInterleavedBufferAttribute) a = a.data;
    return true;
  };
  var by = {}, n = { geo: 0, tex: 0, geoScene: 0, texScene: 0 };
  G.live.forEach(function (x) {
    if (G.base.has(x) || !held(x)) return;
    var sc = inScene.has(x);
    if (sc) { if (x.isTexture) n.texScene++; else n.geoScene++; }
    else { if (x.isTexture) n.tex++; else n.geo++; }
    if (sc && !${verbose ? 1 : 0}) return;
    var d = (sc ? "[in scene] " : "") + (x.isTexture ? "TEX " : "GEO ") + (G.desc.get(x) || ((x.name || x.type) + " (never seen in the scene)"));
    d = d.replace(/[0-9]{3,}/g, "#");
    by[d] = (by[d] || 0) + 1;
  });
  n.list = Object.keys(by).map(function (k) { return [by[k], k]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, 30);
  return n;
`;

/* --heap: a V8 heap snapshot streamed over CDP and reduced with memscope's
   own parser + dominator tree (tools/memscope.mjs, imported as a library),
   so "what did the match leave" comes back as classes and retainer paths. */
async function heapSnapshot(t) {
  process.env.MEMSCOPE_LIB = "1";
  const { SnapParser } = await import(new URL("../memscope.mjs", import.meta.url).href);
  const p = new SnapParser(); let bytes = 0;
  const off = t.on((m) => { if (m.method === "HeapProfiler.addHeapSnapshotChunk") { bytes += m.params.chunk.length; p.push(m.params.chunk); } });
  try {
    await t.send("HeapProfiler.enable", {});
    await t.send("HeapProfiler.collectGarbage", {}, 120000);
    await t.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false, captureNumericValue: false }, 900000);
  } finally { off(); }
  p.jsonMB = bytes / 1048576;
  return p;
}
async function heapAnalyze(snap, prevIds) {
  const { analyze } = await import(new URL("../memscope.mjs", import.meta.url).href);
  return analyze(snap, { prevIds, top: 25 });
}

export default async function (t) {
  const cycles = Math.max(2, +t.arg("--cycles", 2) || 2), verbose = t.flag("-v");
  const only = t.arg("--only", "");
  const ids = only ? only.split(",") : IDS;
  const settle = +t.arg("--settle", 14) || 14, every = +t.arg("--every", 45) || 45;
  const heap = async () => {
    try { await t.send("HeapProfiler.collectGarbage", {}); } catch (_) {}
    const r = await t.send("Runtime.getHeapUsage", {});
    const u = (r && r.result && r.result.usedSize) || (r && r.usedSize) || 0;
    return Math.round(u / 1048576 * 10) / 10;
  };
  const snap = async (label, extra) => {
    try { await t.send("HeapProfiler.collectGarbage", {}); } catch (_) {}
    const s = await t.fn(SNAP, 300000);
    if (s && s.__err) throw new Error("snapshot: " + s.__err);
    await t.fn(GPU_SEE, 300000);
    s.heap = await heap();
    s.label = label;
    if (verbose && s.newPrograms && Object.keys(s.newPrograms).length) {
      t.log("   new programs:", JSON.stringify(s.newPrograms));
      const w = Object.entries(s.progWhy || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
      for (const [k, n] of w) t.log(`      ${String(n).padStart(4)} x ${k}`);
    }
    t.log(label.padEnd(22), JSON.stringify({ heap: s.heap, geo: s.gpuGeo, geoIn: s.geoIn, geoOff: s.geoOff, tex: s.gpuTex, prog: s.programs, objs: s.sceneObjs, upd: s.updaters, alw: s.always, col: s.colliders, plat: s.platforms, structs: s.structs, debris: s.debris, cars: s.cars, oldBots: s.oldBots, bots: s.bots, ...(extra || {}) }));
    return s;
  };
  await t.fn(GPU_HOOK);
  await t.fn(SETUP);
  await t.step(240);
  /* --prewarm: draw every mesh of the island once (frustum culling off for one
     frame) so first-sight uploads (three's buffers + its attribute records for
     a part of the island seen for the first time from this match's spawn) are
     paid before the measurement instead of looking like growth. */
  if (t.flag("--prewarm")) {
    t.log("prewarm:", JSON.stringify(await t.fn(`
      var R = CBZ.renderer, keep = [], n0 = R.info.memory.geometries;
      CBZ.scene.traverse(function (o) { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) { if (o.frustumCulled) { keep.push(o); o.frustumCulled = false; } } });
      try { CBZ.renderFrame(); } finally { for (var i = 0; i < keep.length; i++) keep[i].frustumCulled = true; }
      return { uploadedBefore: n0, after: R.info.memory.geometries };
    `, 600000)));
  }
  const base = await snap("start");
  const by = {};           // id -> [snap per cycle]
  const all = [base];
  const run = async (cyc) => {
    for (const id of ids) {
      const r = await t.fn(ROUND(id, settle, every), 1800000);
      if (r && (r.err || r.__err)) { t.log(`c${cyc} ${id}: ${JSON.stringify(r)}`); if (/game/.test(r.err || "")) return false; continue; }
      const s = await snap(`c${cyc} ${id}`, { secs: r.t, act: r.seenActive });
      (by[id] = by[id] || []).push(s);
      all.push(s);
    }
    return true;
  };
  /* a cycle is a MATCH: every disaster, then the game's own new match
     (CBZ.startRun: the mode reset puts the island back, a fresh crowd).
     What a match leaves behind after the next one starts is what a phone
     dies of; match 1 pays for the caches. */
  const restart = !t.flag("--no-restart");
  const ends = [], wantHeap = t.flag("--heap"), heapFrom = Math.max(1, +t.arg("--heap-from", 1) || 1);
  let heapIds = null;
  for (let c = 1; c <= cycles; c++) {
    if (!(await run(c))) break;
    if (restart) {
      await t.fn("CBZ.startRun(); if (window.__tbFreeze) __tbFreeze(); return 1;");
      await t.fn(SETUP);
      await t.step(300);
      const s = await snap(`match ${c + 1} start`);
      all.push(s); ends.push(s);
      // what the scene draws that it did not at the last match start
      if (verbose && ends.length > 1 && s.where) {
        const a = ends[ends.length - 2].where || {}, d = [];
        for (const k in s.where) { const x = s.where[k] - (a[k] || 0); if (x) d.push([x, k]); }
        for (const k in a) if (!(k in s.where)) d.push([-a[k], k]);
        d.sort((p, q) => q[0] - p[0]);
        t.log("   scene geometries vs last match start:", JSON.stringify(d.slice(0, 10)), "...", JSON.stringify(d.slice(-4)));
      }
      if (wantHeap && (c === heapFrom || c === cycles)) {
        const hs = await heapSnapshot(t);
        const A = await heapAnalyze(hs, heapIds);
        if (!heapIds) {
          heapIds = A._ids;
          t.log(`heap @${s.label}: ${A.totalMB.toFixed(1)} MB in ${A.nodes} nodes; top classes`);
          for (const k of A.classes.slice(0, 12)) t.log(`   ${String(k.MB).padStart(8)} MB ${String(k.n).padStart(8)}  ${k.cls}`);
          for (const u of A.unowned.slice(0, 10)) t.log(`   dom ${String(u.MB).padStart(7)} MB ${u.cls}  ${u.path}`);
        } else if (A.diff) {
          t.log(`heap NEW since match ${heapFrom + 1} start: ${A.diff.newMB} MB, ${A.diff.newObjects} objects`);
          for (const k of A.diff.clusters) t.log(`   ${String(k.MB).padStart(8)} MB ${String(k.n).padStart(7)}  ${k.cls}  <- ${k.path}`);
          t.log("heap NEW, big objects by retainer path:");
          for (const k of A.diff.paths || []) t.log(`   ${String(k.MB).padStart(8)} MB ${String(k.n).padStart(6)}  ${k.path}`);
        }
      }
    }
    if (c === 1) await t.fn(GPU_WHY(true), 300000);
  }
  const why = await t.fn(GPU_WHY(false, verbose), 300000);
  if (verbose) {
    const pb = await t.fn("return window.__gpu ? window.__gpu.progBy : null;");
    if (pb) for (const [k, n] of Object.entries(pb).sort((a, b) => b[1] - a[1]).slice(0, 12)) t.log(`  programs compiled by: ${String(n).padStart(4)}  ${k}`);
  }
  const leaks = [];
  if (why && why.list) for (const w of why.list) t.log("  gpu since cycle 1:", w[0], w[1]);
  if (why) {
    t.log("gpu since cycle 1:", JSON.stringify({ geoHeldByNothing: why.geo, texHeldByNothing: why.tex, geoInScene: why.geoScene, texInScene: why.texScene }));
    if (why.geo > 6) leaks.push(`${why.geo} GPU geometries uploaded after cycle 1 and held by nothing`);
    if (why.tex > 4) leaks.push(`${why.tex} GPU textures uploaded after cycle 1 and held by nothing`);
  }
  for (const id of ids) {
    const L = by[id]; if (!L || L.length < 2) continue;
    const a = L[0], b = L[L.length - 1];
    const d = { heap: Math.round((b.heap - a.heap) * 10) / 10, geo: b.gpuGeo - a.gpuGeo, tex: b.gpuTex - a.gpuTex, objs: b.sceneObjs - a.sceneObjs, upd: b.updaters - a.updaters };
    t.log(`  ${id.padEnd(11)} cycle1->${L.length}`, JSON.stringify(d));
  }
  // the island at the start of match 2 against the start of the last match
  // (or, without restarts, the end of cycle 1 against the end)
  const c1 = ends.length >= 2 ? ends[0] : all.find((s) => /^c1 /.test(s.label) && s.label.endsWith(ids[ids.length - 1]));
  const last = all[all.length - 1];
  if (c1 && c1 !== last) {
    const d = (k) => last[k] - c1[k];
    const R = Math.max(1, ends.length - 1);
    t.log(`${c1.label} -> ${last.label}`, JSON.stringify({ heap: Math.round((last.heap - c1.heap) * 10) / 10, geo: d("gpuGeo"), tex: d("gpuTex"), objs: d("sceneObjs"), upd: d("updaters"), alw: d("always"), col: d("colliders"), plat: d("platforms") }));
    if ((last.heap - c1.heap) / R > 6) leaks.push(`heap ${c1.heap} -> ${last.heap} MB`);
    if (d("gpuGeo") / R > 20) leaks.push(`gpuGeo ${c1.gpuGeo} -> ${last.gpuGeo}`);
    if (d("gpuTex") / R > 3) leaks.push(`gpuTex ${c1.gpuTex} -> ${last.gpuTex}`);
    if (d("sceneObjs") / R > 60) leaks.push(`sceneObjs ${c1.sceneObjs} -> ${last.sceneObjs}`);
    for (const k of ["updaters", "always", "programs", "colliders", "platforms"]) if (last[k] > c1[k] + 2) leaks.push(`${k} ${c1[k]} -> ${last[k]}`);
    for (const kind of ["lists", "maps"]) for (const k in last[kind]) {
      const v0 = c1[kind][k] || 0, v1 = last[kind][k];
      if (v1 > v0 + 10 && v1 > v0 * 1.2) leaks.push(`CBZ.${k} ${v0} -> ${v1}`);
      else if (verbose && v0 !== v1) t.log(`  (CBZ.${k} ${v0} -> ${v1})`);
    }
  }
  const errs = t.errors();
  if (errs.length) t.log("page errors", JSON.stringify(errs.slice(0, 8)));
  for (const l of leaks) t.log("LEAK", l);
  return { ok: leaks.length === 0, summary: leaks.length ? `${leaks.length} leak(s): ${leaks.slice(0, 6).join("; ")}` : `clean over ${cycles} cycles of ${ids.length} disasters`,
    data: { leaks, snaps: all.map((s) => ({ label: s.label, heap: s.heap, geo: s.gpuGeo, geoIn: s.geoIn, geoOff: s.geoOff, tex: s.gpuTex, objs: s.sceneObjs })) } };
}
