/* tools/probes/isles-leak.mjs — THE ISLES' LEAK DETECTOR.

   Owner doctrine: the device is the detector. An island the Isles stream in
   and drop again must leave NOTHING behind: no geometry or texture on the
   GPU, no collider or platform, no frame hook, no listener, no venue record,
   no person, no car. This travels Port Royal -> Highgate -> Port Royal three
   times (teleport + sim steps, the real streamer doing the building and the
   dropping) and checks two things:

     1. RETURNS TO BASELINE. The snapshot back on Port Royal after round 1 is
        the baseline (round 1 pays for every cache: shared materials, programs,
        lazily created lists). Rounds 2 and 3 must come back to it: GPU
        geometries / textures / programs (one frame drawn per snapshot so
        three.js counts what it holds), colliders, platforms, sight blockers,
        camera colliders, updaters, always-runners, window/document/canvas
        listeners, scene objects, peds, cars, cops, island venue records, and
        EVERY top-level CBZ array / Map / Set. A count that grew in both round
        2 and round 3 is a leak.
     2. NOTHING POINTS AT A DROPPED ISLAND. With Highgate dropped, every
        record in a top-level CBZ list (and one level down: CBZ.city.*,
        CBZ.island*.*) that stands on Highgate's ground is a leak, named by
        its list.

     node tools/testbus/standalone.mjs tools/probes/isles-leak.mjs [--rounds 3] [-v]
     (or submit it to the bus: node tools/testbus/submit.mjs --probe tools/probes/isles-leak.mjs)

   Exit 0 = clean, 1 = a leak (the report names each one). */
export const meta = { world: "isles", fresh: true, dirties: true, timeoutMs: 40 * 60e3 };

const SNAP = `
  var R = CBZ.renderer, out = { lists: {}, maps: {} };
  try { CBZ.renderFrame(); } catch (e) {}
  var info = R && R.info;
  out.gpuGeo = info ? info.memory.geometries : -1;
  out.gpuTex = info ? info.memory.textures : -1;
  out.programs = info && info.programs ? info.programs.length : -1;
  out.updaters = CBZ.updaters.length; out.always = CBZ.always.length;
  out.colliders = (CBZ.colliders || []).length; out.platforms = (CBZ.platforms || []).length;
  out.los = (CBZ.losBlockers || []).length; out.camCol = (CBZ.camColliders || []).length;
  var n = 0; CBZ.scene.traverse(function () { n++; }); out.sceneObjs = n;
  var alive = function (L) { var k = 0; (L || []).forEach(function (a) { if (a && !a.dead && !a._parked) k++; }); return k; };
  out.peds = (CBZ.cityPeds || []).length; out.pedsAlive = alive(CBZ.cityPeds);
  out.cars = (CBZ.cityCars || []).length; out.cops = (CBZ.cityCops || []).length;
  out.venues = CBZ.islandVenue ? CBZ.islandVenue.list().length : -1;
  out.safes = CBZ.citySafes ? CBZ.citySafes().length : -1;
  out.vaults = CBZ.cityVaults ? CBZ.cityVaults().length : -1;
  out.wildlife = (CBZ.cityWildlife || []).length;
  var seen = new Set();
  for (var k in CBZ) {
    var v; try { v = CBZ[k]; } catch (e) { continue; }
    if (!v || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) out.lists[k] = v.length;
    else if (v instanceof Map || v instanceof Set) out.maps[k] = v.size;
  }
  out.state = CBZ.archipelago.state();
  return out;
`;

/* records standing on a dropped island's ground, by list */
const STRAYS = (id) => `
  var I = CBZ.archipelago.isles().find(function (r) { return r.id === ${JSON.stringify(id)}; });
  if (!I) return { err: "no island" };
  if (I.arena) return { err: "still standing: " + I.state };
  var x0 = I.x, z0 = I.z, RR = I.R + 260;
  var on = function (o) {
    if (!o || typeof o !== "object") return false;
    var p = null;
    try {
      if (o.isObject3D) { if (!o.parent) return false; var w = o.getWorldPosition(new THREE.Vector3()); p = w; }
      else if (typeof o.minX === "number") p = { x: (o.minX + o.maxX) / 2, z: (o.minZ + o.maxZ) / 2 };
      else if (o.pos && typeof o.pos.x === "number") p = o.pos;
      else if (typeof o.x === "number" && typeof o.z === "number") p = o;
      else if (o.position && typeof o.position.x === "number") p = o.position;
      else if (o.group && o.group.position) p = o.group.position;
      else if (o.b && typeof o.b.ox === "number") p = { x: o.b.ox, z: o.b.oz };
    } catch (e) { return false; }
    return !!p && Math.abs(p.x - x0) < RR && Math.abs(p.z - z0) < RR && Math.hypot(p.x - x0, p.z - z0) < RR;
  };
  var hits = {}, seen = new Set();
  var scan = function (name, v, depth) {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    var items = Array.isArray(v) ? v : (v instanceof Map || v instanceof Set) ? Array.from(v.values()) : null;
    if (items) {
      var c = 0;
      for (var i = 0; i < items.length; i++) if (on(items[i])) c++;
      if (c) hits[name] = c;
      return;
    }
    if (depth > 0 && !v.isObject3D && !(v instanceof Node)) {
      for (var k in v) { var w; try { w = v[k]; } catch (e) { continue; } if (w && typeof w === "object") scan(name + "." + k, w, depth - 1); }
    }
  };
  for (var k in CBZ) {
    var v; try { v = CBZ[k]; } catch (e) { continue; }
    if (!v || typeof v !== "object" || v === CBZ.scene || v === CBZ.camera || v === CBZ.renderer) continue;
    // one level down into the registries that keep their lists on an object
    scan(k, v, /^(city|island|isl|bank|police|street|crowd|lodg|venue|dealer|home|prop|archi)/i.test(k) ? 1 : 0);
  }
  if (CBZ.citySafes) { var s = CBZ.citySafes().filter(on).length; if (s) hits["citySafes()"] = s; }
  if (CBZ.cityVaults) { var vv = CBZ.cityVaults().filter(on).length; if (vv) hits["cityVaults()"] = vv; }
  if (CBZ.islandVenue) { var vn = CBZ.islandVenue.list().filter(on).length; if (vn) hits["islandVenue.list()"] = vn; }
  if (CBZ.cityVaultRoom && on(CBZ.cityVaultRoom)) hits.cityVaultRoom = 1;
  // what still DRAWS on that island's ground (a hidden mesh parked at a
  // stale spot, an LOD-frozen animal's body, draws nothing)
  var shown = function (o) { for (var p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  CBZ.scene.traverse(function (o) {
    if (!o.isMesh || o === I.far || !shown(o) || !on(o)) return;
    var p = o, path = []; for (var d = 0; p && d < 4; d++, p = p.parent) path.push(p.name || p.type);
    var k = "drawn: " + path.join("<");
    hits[k] = (hits[k] || 0) + 1;
  });
  return hits;
`;

const TRAVEL = (id, other) => `
  var AR = CBZ.archipelago, I = AR.isles().find(function (r) { return r.id === ${JSON.stringify(id)}; }), P = CBZ.player;
  if (!I) return "no island " + ${JSON.stringify(id)};
  var x = I.x + I.R * 0.15, z = I.z + I.R * 0.15;
  if (P.driving && CBZ.cityExitVehicle) try { CBZ.cityExitVehicle(); } catch (e) {}
  for (var n = 0; n < 9000; n += 15) {
    P.pos.set(x, AR.groundAt(x, z) + 0.05, z); P.vy = 0; P.grounded = true; P.dead = false; P.hp = 100;
    for (var k = 0; k < 15; k++) CBZ.stepSim(1 / 30);
    var s = AR.state();
    var o = s.isles.find(function (r) { return r.id === ${JSON.stringify(other)}; });
    if (s.active === ${JSON.stringify(id)} && o && o.state === "far" && (!s.chores || !s.chores.length)) return n;
  }
  return JSON.stringify({ game: CBZ.game.state, mode: CBZ.game.mode, st: AR.state() });
`;

async function listeners(t) {
  let n = 0;
  for (const expr of ["window", "document", "CBZ.renderer && CBZ.renderer.domElement"]) {
    const r = await t.send("Runtime.evaluate", { expression: expr, returnByValue: false });
    const id = r && r.result && r.result.result && r.result.result.objectId;
    if (!id) continue;
    const L = await t.send("DOMDebugger.getEventListeners", { objectId: id });
    n += (L && L.result && L.result.listeners || []).length;
  }
  return n;
}

/* WHAT HOLDS THE GPU: every geometry / texture three.js uploaded (it hooks
   'dispose' on first upload and unhooks it on dispose), and what each one was
   drawn as the last time a snapshot saw it in the scene. A leak is then
   named: uploaded after the baseline, never disposed, and in no scene. */
const GPU_HOOK = `
  if (window.__gpu) return 1;
  var G = window.__gpu = { live: new Set(), desc: new WeakMap(), base: null };
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
    if (o.geometry) G.desc.set(o.geometry, path(o));
    var ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    ms.forEach(function (m) { if (!m) return; for (var k in m) { var t = m[k]; if (t && t.isTexture) G.desc.set(t, path(o) + " ." + k + " (" + (m.name || m.type) + ") " + String(t.name || "").replace(/[:|].*$/, "")); } });
  });
  return 1;
`;
const GPU_WHY = (verbose) => `
  var G = window.__gpu; if (!G) return null;
  if (!G.base) { G.base = new Set(G.live); return { based: G.base.size }; }
  var inScene = new Set();
  CBZ.scene.traverse(function (o) {
    if (o.geometry) inScene.add(o.geometry);
    var ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    ms.forEach(function (m) { if (!m) return; for (var k in m) { var t = m[k]; if (t && t.isTexture) inScene.add(t); } });
  });
  // (what a live record still owns off-scene is a pool, not a leak: the
  // parked people, the parked cars)
  var owned = new Set();
  var own = function (root) { if (root && root.traverse) root.traverse(function (o) {
    if (o.geometry) owned.add(o.geometry);
    var ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    ms.forEach(function (m) { if (!m) return; for (var k in m) { var t = m[k]; if (t && t.isTexture) owned.add(t); } });
  }); };
  [CBZ.cityPeds, CBZ.cityCars, CBZ.cityCops, CBZ.cityWildlife, CBZ.npcs, CBZ.guards, CBZ.bots].forEach(function (L) { (L || []).forEach(function (a) { if (a) own(a.group); }); });
  var by = {}, n = { geo: 0, tex: 0, pedTex: 0 };
  G.live.forEach(function (x) {
    if (G.base.has(x)) return;
    var tag = inScene.has(x) ? "[in scene] " : owned.has(x) ? "[owned off-scene] " : "";
    var d = G.desc.get(x) || ((x.isTexture ? "texture " : "geometry ") + (x.name || x.type) + " (never seen in the scene)");
    // a body's painted look (city/clothes.js outfit atlases, entities/tattoo.js
    // ink charts): caches that keep every look for the session, by design
    if (!tag && x.isTexture && /character-model|pedinst/.test(d)) tag = "[ped look cache] ";
    if (!tag) { if (x.isTexture) n.tex++; else n.geo++; }
    else if (tag === "[ped look cache] ") n.pedTex++;
    if (tag && tag !== "[ped look cache] " && !${verbose ? 1 : 0}) return;
    d = tag + (x.isTexture ? "TEX " : "GEO ") + d.replace(/pedinst:\\w+/g, "pedinst:*").replace(/[0-9]{3,}/g, "#");
    by[d] = (by[d] || 0) + 1;
  });
  n.list = Object.keys(by).map(function (k) { return [by[k], k]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, ${verbose ? 40 : 20});
  return n;
`;

/* WORK FOR ANOTHER WORLD: blood spilt more than 4 km from every island is
   a system simulating somewhere nobody is (the finding that started this:
   a shark bite's gore 30 km off, in another world's sea). */
const FAR_WATCH = `
  if (window.__farGore) return 1;
  var F = window.__farGore = [];
  var o = CBZ.goreImpact;
  if (typeof o !== "function") return 0;
  CBZ.goreImpact = function (x, y, z) {
    try {
      var near = CBZ.archipelago.isles().some(function (I) { return Math.hypot(x - I.x, z - I.z) < I.R + 4000; });
      if (!near && F.length < 8) F.push({ x: Math.round(x), z: Math.round(z), st: (new Error().stack || "").split("\\n").slice(2, 7).join(" < ").replace(/https?:[^ ]*?\\/src\\//g, "") });
    } catch (e) {}
    return o.apply(this, arguments);
  };
  return 1;
`;

export default async function (t) {
  const rounds = Math.max(2, +t.arg("--rounds", 3) || 3), verbose = t.flag("-v");
  const A = "port-royal", B = "highgate";
  const snap = async (label) => {
    const s = await t.fn(SNAP, 300000);
    if (s && s.__err) throw new Error("snapshot: " + s.__err);
    await t.fn(GPU_SEE, 300000);
    s.listeners = await listeners(t);
    t.log(label, JSON.stringify({ geo: s.gpuGeo, tex: s.gpuTex, prog: s.programs, upd: s.updaters, alw: s.always, col: s.colliders, plat: s.platforms,
      los: s.los, cam: s.camCol, objs: s.sceneObjs, lis: s.listeners, peds: s.peds, cars: s.cars, cops: s.cops, venues: s.venues, safes: s.safes, vaults: s.vaults,
      full: s.state.full, active: s.state.active }));
    return s;
  };
  await t.fn(GPU_HOOK);
  await t.fn(FAR_WATCH);
  await t.step(240);
  const snaps = [await snap("start@" + A)];
  const strays = [];
  for (let r = 1; r <= rounds; r++) {
    const nb = await t.fn(TRAVEL(B, A), 1800000);
    if (typeof nb !== "number") return { ok: false, summary: `round ${r}: never settled on ${B}: ${typeof nb === "string" ? nb.slice(0, 600) : JSON.stringify(nb)}` };
    await t.step(120);
    await snap(`r${r}@${B}`);
    const strayA = await t.fn(STRAYS(A), 300000);
    const na = await t.fn(TRAVEL(A, B), 1800000);
    if (typeof na !== "number") return { ok: false, summary: `round ${r}: never settled back on ${A}: ${typeof na === "string" ? na.slice(0, 600) : JSON.stringify(na)}` };
    await t.step(120);
    snaps.push(await snap(`r${r}@${A}`));
    if (r === 1) await t.fn(GPU_WHY(false), 300000);          // the baseline: what round 1 left is the caches
    const strayB = await t.fn(STRAYS(B), 300000);
    t.log(`r${r} strays of ${A} (while on ${B})`, JSON.stringify(strayA));
    t.log(`r${r} strays of ${B} (back on ${A})`, JSON.stringify(strayB));
    strays.push(strayA, strayB);
  }
  // ---- the verdict
  const leaks = [];
  const base = snaps[1], last = snaps[snaps.length - 1];
  // the registries: back to the baseline exactly
  const STRICT = ["programs", "updaters", "colliders", "platforms", "los", "camCol", "listeners", "venues", "safes", "vaults"];
  for (const k of STRICT) if (last[k] > base[k]) leaks.push(`${k} ${base[k]} -> ${last[k]}`);
  // (a one-off lazy registration in round 2 is not a leak; growth past it is)
  if (last.always > Math.max(base.always, snaps[2].always)) leaks.push(`always ${base.always} -> ${last.always}`);
  /* THE GPU. The island you come back to is a NEW build (new buffers for the
     old ones it disposed), and the crowd's look pools warm up over the first
     rounds, so the totals wander; what is a leak is a buffer held by nothing:
     uploaded after the baseline, never disposed, in no scene, owned by no
     live record. A few a round are bounded caches still filling (a watch
     style first worn, a crowd look first pooled: 2-3 a round, falling);
     what this was written to catch ran 30 to 1,800 a round. */
  const R = rounds - 1;
  const why = await t.fn(GPU_WHY(verbose), 300000);
  const notes = [];
  if (why && why.list) {
    for (const w of why.list) t.log("  gpu held:", w[0], w[1]);
    if (why.geo > 4 * R) leaks.push(`${why.geo} GPU geometries held by nothing (rounds 2..${rounds})`);
    if (why.tex > 4 * R) leaks.push(`${why.tex} GPU textures held by nothing (rounds 2..${rounds})`);
    if (why.pedTex) notes.push(`ped look caches +${why.pedTex} textures (city/clothes.js outfits, entities/tattoo.js charts: kept for the session by design)`);
  }
  if ((last.gpuGeo - base.gpuGeo) / R > 60) leaks.push(`gpuGeo ${base.gpuGeo} -> ${last.gpuGeo} (> 60 a round)`);
  if ((last.sceneObjs - base.sceneObjs) / R > 80) leaks.push(`sceneObjs ${base.sceneObjs} -> ${last.sceneObjs} (> 80 a round)`);
  // people and cars come and go with the hour: growth beyond a crowd's worth is a leak
  for (const k of ["peds", "cars", "cops"]) if (last[k] > base[k] * 1.25 + 8) leaks.push(`${k} ${base[k]} -> ${last[k]}`);
  // every CBZ list / map: growth in EVERY round after the first is a leak
  for (const kind of ["lists", "maps"]) {
    for (const k in last[kind]) {
      let grew = true;
      for (let i = 2; i < snaps.length; i++) if (!(snaps[i][kind][k] > (snaps[i - 1][kind][k] || 0))) { grew = false; break; }
      if (grew) leaks.push(`CBZ.${k} grew every round: ${snaps.map((s) => s[kind][k]).join(" -> ")}`);
      else if (verbose && base[kind][k] !== last[kind][k]) t.log(`  (CBZ.${k} ${base[kind][k]} -> ${last[kind][k]})`);
    }
  }
  const strayKeys = {};
  for (const s of strays) {
    if (!s || s.err) { if (s && s.err) leaks.push("strays: " + s.err); continue; }
    for (const k in s) strayKeys[k] = Math.max(strayKeys[k] || 0, s[k]);
  }
  for (const k in strayKeys) leaks.push(`${k}: ${strayKeys[k]} record(s) on a dropped island`);
  const far = await t.evl("JSON.stringify(window.__farGore || [])");
  for (const f of JSON.parse(far || "[]")) leaks.push(`gore at (${f.x}, ${f.z}), far from every island: ${f.st}`);
  const errs = t.errors();
  if (errs.length) t.log("page errors", JSON.stringify(errs.slice(0, 10)));
  for (const l of leaks) t.log("LEAK", l);
  for (const l of notes) t.log("NOTE", l);
  return { ok: leaks.length === 0, summary: (leaks.length ? `${leaks.length} leak(s): ${leaks.slice(0, 6).join("; ")}` : `clean over ${rounds} round trips ${A} <-> ${B}`) + (notes.length ? "; " + notes.join("; ") : ""),
    data: { leaks, snaps: snaps.map((s) => ({ geo: s.gpuGeo, tex: s.gpuTex, prog: s.programs, upd: s.updaters, col: s.colliders })) } };
}
