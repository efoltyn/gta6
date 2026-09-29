#!/usr/bin/env node
/* tools/shark-marks-check.mjs — ARE THE BITE MARKS ON THE BODY?

   Owner, 2026-09-29, Shark Sim: marks on swimmers, sharks and orcas "show
   very poorly" and are "not even on the body but floating".

   The REAL human rig (entities/character.js through tools/lib/verbs-vm.mjs),
   the REAL great white and orca builds (city/wildlife/aquatic.js,
   city/wildlife_orca.js) with the REAL swim rig (city/wildlife_rig.js), and
   the REAL systems/wounds.js, in plain node. No browser.

     1. a swimmer bitten on torso, head, arm and leg: every vertex of every
        skin mark lies on the rig's REAL surface (not its legacy box), and a
        clothed part gets its fabric torn;
     2. bullet / blade decals (bodyWound) are pulled onto the real skin too;
     3. a great white and an orca bitten along the back, flank and belly:
        jaw print + rake + blood on the part the teeth met, every vertex on
        that part's surface, the rake PALE on dark skin and RED-BROWN on white;
     4. the body then SWIMS (animateSwim, 3 s, tail beating) and dies and rolls:
        every mark vertex, measured in WORLD space against the posed body, is
        still on the skin — nothing floats;
     5. a wound mesh recycled from a matrix-frozen body is re-armed;
     6. budgets: the ring is capped and a reset clears it.

     node tools/shark-marks-check.mjs            exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
let fails = 0;
const ok = (c, m, d) => { if (!c) fails++; console.log((c ? "ok   " : "FAIL ") + m + (d ? "  (" + d + ")" : "")); };
const TOL_CM = 1.0;          // a mark vertex may stand this far off the skin

// ---- shared: distance from a WORLD point to a mesh's WORLD surface, cm ------
function surfTools(THREE) {
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), O = new THREE.Vector3(), Q = new THREE.Vector3();
  const T = new THREE.Triangle();
  const cache = new Map();
  function worldTris(mesh) {
    // world-space triangles of the host AS POSED NOW (cache per call site)
    const g = mesh.geometry, p = g.attributes.position, idx = g.index ? g.index.array : null;
    const n = idx ? idx.length / 3 : p.count / 3, out = new Float32Array(n * 9);
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx[t * 3 + k] : t * 3 + k;
        A.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        out[t * 9 + k * 3] = A.x; out[t * 9 + k * 3 + 1] = A.y; out[t * 9 + k * 3 + 2] = A.z;
      }
    }
    return out;
  }
  function dist(tris, P) {
    let best = 1e9;
    for (let t = 0; t < tris.length; t += 9) {
      A.set(tris[t], tris[t + 1], tris[t + 2]); B.set(tris[t + 3], tris[t + 4], tris[t + 5]); C.set(tris[t + 6], tris[t + 7], tris[t + 8]);
      T.set(A, B, C); T.closestPointToPoint(P, O); const d = O.distanceToSquared(P); if (d < best) best = d;
    }
    return Math.sqrt(best) * 100;
  }
  // worst distance (cm) of a mark's vertices from its host's surface, sampled
  function markGap(mark, stride) {
    const host = mark.parent;
    let tris = cache.get(host);
    if (!tris) { tris = worldTris(host); cache.set(host, tris); }
    const p = mark.geometry.attributes.position;
    let worst = 0;
    for (let i = 0; i < p.count; i += (stride || 7)) {
      Q.fromBufferAttribute(p, i).applyMatrix4(mark.matrixWorld);
      const d = dist(tris, Q); if (d > worst) worst = d;
    }
    return worst;
  }
  return { markGap, dist, worldTris, reset: () => cache.clear() };
}

// which atlas cells (bite | blood / rake) one merged flesh mesh paints from
function cellsOf(r) {
  const out = {};
  if (r.kind === "tear") { out.tear = 1; return out; }
  const c = r.cell;
  for (let i = 0; i < c.length; i += 2) {
    const k = c[i] === 0 && c[i + 1] === 0 ? "bite" : (c[i] > 0.25 ? "blood" : "rake");
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

// =============================================================================
// 1 + 2 + 5: THE SWIMMER
// =============================================================================
{
  const v = loadVerbsVM({ mode: "escape" });
  const { CBZ, THREE, ctx } = v;
  let now = 1000;
  ctx.performance = { now: () => now };
  CBZ.scene = new THREE.Scene();
  CBZ.gore = function () {}; CBZ.gore.spray = () => {};
  vm.runInContext(read("src/systems/wounds.js"), ctx, { filename: "wounds.js" });
  v.clearActors(); v.world({});
  const a = v.actor({ build: "m", x: 0, z: 0, yaw: 0, bot: true, name: "swimmer" });
  CBZ.scene.add(a.group);
  CBZ.camera.position.set(0, 2, -3);
  for (let i = 0; i < 8; i++) v.frame(1 / 60);
  const S = a.char.skinSlots;
  const U = surfTools(THREE);
  const P = new THREE.Vector3();
  const parts = { torso: S.torso[0], head: S.head[0], arm: S.arms[0], forearm: S.armsLower[0], thigh: S.legs[0], shin: S.legsLower[0] };
  let marks = 0, worst = 0, tears = 0;
  const cellsSeen = {};
  for (const k in parts) {
    for (const side of [[0, -0.6], [0.6, 0], [0, 0.6]]) {
      const part = parts[k];
      a.group.updateMatrixWorld(true);
      part.getWorldPosition(P);
      now += 1000;
      const before = new Set(CBZ._woundSkinList().map((r) => r.m));
      CBZ.bodyBite(a, { x: P.x + side[0], y: P.y + 0.02, z: P.z + side[1] }, { jaw: 0.3, sev: 0.9 });
      a.group.updateMatrixWorld(true);
      U.reset();
      for (const r of CBZ._woundSkinList()) {
        if (before.has(r.m)) continue;
        marks++;
        if (r.kind === "tear") tears++;
        for (const c in cellsOf(r)) cellsSeen[c] = (cellsSeen[c] || 0) + 1;
        const g = U.markGap(r.m, 5);
        if (g > worst) worst = g;
      }
    }
  }
  const au = CBZ.woundDecalAudit();
  ok(marks >= 18 && au.biteMarks === au.biteCalls && cellsSeen.bite >= 18 && cellsSeen.blood >= 18,
    "every bite on a swimmer lays a jaw print + blood", `${marks} meshes ${JSON.stringify(cellsSeen)}, ledger ${au.biteMarks}/${au.biteCalls}, last refusal '${au.lastRefusal}'`);
  ok(worst <= TOL_CM, "every mark vertex is ON the real skin (not the legacy box)", `worst ${worst.toFixed(2)} cm`);
  ok(tears > 0, "clothed parts get the fabric torn", `${tears} tears`);

  // bullets / blades: the flat decals are pulled onto the skin
  let n = 0, sum = 0, w = 0;
  const kids0 = new Set();
  a.group.traverse((o) => kids0.add(o));
  for (const k in parts) {
    const part = parts[k];
    part.getWorldPosition(P);
    now += 400;
    CBZ.bodyWound(a, { x: P.x + 0.04, y: P.y + 0.03, z: P.z - 0.5 }, { cal: 1, fromX: P.x, fromZ: P.z - 3 });
    now += 400;
    CBZ.bodyWound(a, { x: P.x - 0.03, y: P.y - 0.02, z: P.z - 0.5 }, { melee: "blade", fromX: P.x, fromZ: P.z - 3 });
  }
  a.group.updateMatrixWorld(true);
  U.reset();
  a.group.traverse((o) => {
    if (kids0.has(o) || !o.isMesh || !o.parent || !o.parent.isMesh) return;
    o.getWorldPosition(P);
    let tris = U.worldTris(o.parent);
    const d = U.dist(tris, P);
    if (process.env.MARKS_DEBUG && d > 1) console.log("   off:", d.toFixed(2), "cm on", o.parent.name || o.parent.geometry.name || "?", "ro", o.renderOrder);
    n++; sum += d; if (d > w) w = d;
  });
  ok(n >= 12, "bullet and blade decals were stamped", `${n}`);
  ok(sum / Math.max(1, n) <= 1.2 && w <= 2.5, "their centres sit on the skin", `mean ${(sum / Math.max(1, n)).toFixed(2)} cm, worst ${w.toFixed(2)} cm`);

  // 5: a mesh frozen by a matrix LOD, then recycled, is re-armed
  a.group.traverse((o) => { o.matrixAutoUpdate = false; });
  CBZ.clearWounds();
  const b = v.actor({ build: "f", x: 3, z: 0, yaw: 0, bot: true, name: "second" });
  CBZ.scene.add(b.group);
  for (let i = 0; i < 4; i++) v.frame(1 / 60);
  b.char.skinSlots.torso[0].getWorldPosition(P);
  now += 1000;
  CBZ.bodyWound(b, { x: P.x, y: P.y, z: P.z - 0.5 }, { cal: 1, fromX: P.x, fromZ: P.z - 3 });
  let frozen = 0, seen = 0;
  b.group.traverse((o) => { if (o.isMesh && o.parent && o.parent.isMesh && o.material && o.material._shared) { seen++; if (!o.matrixAutoUpdate) frozen++; } });
  ok(seen > 0 && frozen === 0, "a recycled decal never keeps a frozen matrix", `${seen} decals, ${frozen} frozen`);
  const sk = CBZ.woundSkinAudit();
  ok(sk.marks === 0, "a reset clears the skin marks", JSON.stringify(sk));
}

// =============================================================================
// 3 + 4 + 6: THE GREAT WHITE AND THE ORCA
// =============================================================================
function marineVM() {
  const ctx = vm.createContext({ console, Math, performance, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Map, Set, WeakMap });
  ctx.window = ctx; ctx.self = ctx;
  ctx.document = { createElement: () => ({ getContext: () => null, style: {} }), addEventListener() {} };
  const CBZ = (ctx.CBZ = { CONFIG: {}, onAlways() {}, onUpdate() {}, on() {}, game: { mode: "sharksim" } });
  const run = (f) => vm.runInContext(read(f), ctx, { filename: f });
  run("src/vendor/three.r128.min.js");
  const THREE = ctx.THREE;
  CBZ.hash01 = (a, b, s) => { const x = Math.sin(a * 12.9898 + b * 78.233 + (s | 0) * 37.719) * 43758.5453; return x - Math.floor(x); };
  const gc = {};
  CBZ.boxGeom = (w, h, d) => gc[w + "," + h + "," + d] || (gc[w + "," + h + "," + d] = new THREE.BoxGeometry(w, h, d));
  run("src/city/wildlife_species.js");
  run("src/city/wildlife_rig.js");
  run("src/city/wildlife/aquatic.js");
  run("src/city/wildlife_orca.js");
  CBZ.scene = new THREE.Scene();
  CBZ.camera = new THREE.PerspectiveCamera(); CBZ.camera.position.set(0, 2, 0);
  CBZ.goreMedium = () => "water";
  const blooms = [], chums = [];
  CBZ.goreBloom = (x, y, z) => blooms.push([x, y, z]);
  CBZ.goreChum = (fx) => { const h = { rate: 1, ttl: 1, fx }; chums.push(h); return h; };
  CBZ.goreChumStop = () => {};
  run("src/systems/wounds.js");
  return { ctx, CBZ, THREE, blooms, chums };
}
for (const id of ["great_white_shark", "orca"]) {
  const { CBZ, THREE, chums } = marineVM();
  const sp = CBZ.WILDLIFE_SPECIES[id];
  if (!sp) { ok(false, id + " species loads"); continue; }
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const grp = sp.build({ THREE, mat, rng: () => 0.5 });
  grp.scale.setScalar(sp.scale || 1);
  grp.position.set(3, -3, 1);
  CBZ.scene.add(grp);
  const a = { species: sp, group: grp, pos: grp.position, heading: 0, animal: true, _spdSmooth: 0 };
  CBZ.buildSwimRig(a);
  grp.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(grp), c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
  // back, flank, belly along the body, and the tail
  const pts = [];
  for (const fx of [-0.3, -0.1, 0.12, 0.3]) {
    pts.push([c.x + fx * s.x, c.y + s.y * 0.3, c.z]);           // back
    pts.push([c.x + fx * s.x, c.y, c.z + s.z * 0.28]);          // flank
    pts.push([c.x + fx * s.x, c.y - s.y * 0.3, c.z]);           // belly
  }
  pts.push([bb.min.x + s.x * 0.06, c.y, c.z + s.z * 0.3]);      // the tail
  let took = 0;
  const t0 = process.hrtime.bigint();
  for (const p of pts) {
    const t = CBZ.creatureBiteChunk(a, { x: p[0], y: p[1], z: p[2] }, { jaw: 0.45, sev: 0.8, dir: { x: 1, y: 0, z: 0 } });
    if (t) took++;
    else if (process.env.MARKS_DEBUG) console.log("   refused at", p.map((x) => x.toFixed(2)).join(","), "centre", c.toArray().map((x) => x.toFixed(2)).join(","));
  }
  const msPerBite = Number(process.hrtime.bigint() - t0) / 1e6 / pts.length;
  console.log(`     ${id}: ${msPerBite.toFixed(1)} ms per bite (whole creatureBiteChunk, cold JIT)`);
  const list = CBZ._woundSkinList();
  const kinds = {};
  for (const r of list) for (const c in cellsOf(r)) kinds[c] = (kinds[c] || 0) + 1;
  if (process.env.MARKS_DEBUG) {
    const hosts = {};
    for (const r of list) { const h = r.m.parent; const k = h ? (h.name || h.geometry.name || "?") : "-"; hosts[k] = (hosts[k] || 0) + 1; }
    console.log("   hosts:", JSON.stringify(hosts));
  }
  ok(took >= pts.length - 1 && kinds.bite >= pts.length - 1 && kinds.rake >= pts.length - 1 && kinds.blood >= pts.length - 1,
    `${id}: every bite lays a jaw print, a rake and blood`, `${took}/${pts.length} bites, ${list.length} meshes, ${JSON.stringify(kinds)}`);
  ok(list.length <= took * 4, `${id}: one draw per bite per part it covers (print, rake and blood share a mesh)`, `${list.length} meshes for ${took} bites`);
  ok(chums.length > 0, `${id}: the wound bleeds into the water (chum trail)`, `${chums.length}`);

  // tone: rakes on the dark back are PALE, rakes on the white belly RED-BROWN
  let pale = 0, red = 0;
  for (const r of list) {
    if (r.kind === "tear") continue;
    const col = r.m.geometry.attributes.color.array, cl = r.cell;
    for (let v = 0; v < cl.length / 2; v++) {
      if (!(cl[v * 2] === 0 && cl[v * 2 + 1] === 0.5)) continue;     // rake cell only
      if (col[v * 4 + 1] > 0.6) pale++; else if (col[v * 4] > 0.5 && col[v * 4 + 1] < 0.4) red++;
    }
  }
  ok(pale > 0 && red > 0, `${id}: rakes read pale on dark skin and red on white skin`, `${pale} pale verts, ${red} red verts`);

  const U = surfTools(THREE);
  const worstNow = () => {
    grp.updateMatrixWorld(true); U.reset();
    let w = 0, n = 0;
    for (const r of list) { if (!r.m.parent) continue; n++; const g = U.markGap(r.m, 9); if (g > w) w = g; }
    return { w, n };
  };
  let g0 = worstNow();
  ok(g0.n > 0 && g0.w <= TOL_CM, `${id}: every mark vertex is on the skin at the bite`, `${g0.n} marks, worst ${g0.w.toFixed(2)} cm`);

  // SWIM: 3 s of a hard-beating tail, turning and pitching
  const dt = 1 / 30;
  for (let i = 0; i < 90; i++) {
    a.heading += 0.02; grp.position.x += Math.cos(a.heading) * 0.25; grp.position.z += Math.sin(a.heading) * 0.25;
    grp.position.y += Math.sin(i * 0.2) * 0.05;
    try { CBZ.animateSwim(a, dt); } catch (e) { if (i === 0) console.log("  (animateSwim: " + e.message + ")"); }
  }
  // the tail really moved (or this proves nothing)
  const tailMoved = a.swim && a.swim.parts && a.swim.parts.some((p) => Math.abs(p.m.position.z - p.bz) + Math.abs(p.m.position.y - p.by) + Math.abs(p.m.rotation.y - p.ry) + Math.abs(p.m.rotation.z - p.rz) > 1e-3);
  const g1 = worstNow();
  ok(tailMoved && g1.w <= TOL_CM, `${id}: after 3 s of swimming the marks are still on the skin`, `tail posed: ${tailMoved}, worst ${g1.w.toFixed(2)} cm`);
  // DEATH ROLL + the fed-girth cue (non-uniform group scale)
  grp.rotation.x = 2.6; grp.rotation.z = 0.4; grp.scale.y *= 1.1; grp.scale.z *= 1.1;
  if (CBZ.aquaticDeathBegin) { try { a.dead = true; CBZ.aquaticDeathBegin(a); for (let i = 0; i < 40; i++) CBZ.aquaticDeathStep(a, dt); } catch (e) {} }
  const g2 = worstNow();
  ok(g2.w <= TOL_CM, `${id}: rolled belly-up and fattened, still on the skin`, `worst ${g2.w.toFixed(2)} cm`);

  // budget: bite it until the ring is full; it holds (and, warm, what it costs)
  const t1 = process.hrtime.bigint();
  let nb = 0;
  for (let k = 0; k < 30; k++) {
    for (const p of pts) { CBZ.creatureBiteChunk(a, { x: p[0] + grp.position.x - 3, y: p[1] + grp.position.y + 3, z: p[2] + grp.position.z - 1 }, { jaw: 0.45, sev: 0.5 }); nb++; }
  }
  console.log(`     ${id}: ${(Number(process.hrtime.bigint() - t1) / 1e6 / nb).toFixed(2)} ms per bite warm`);
  const au = CBZ.woundSkinAudit();
  ok(au.marks <= 48 && au.attached === au.marks, `${id}: the per-body budget holds`, JSON.stringify(au));
  CBZ.creatureBiteChunkRestore(a);
  ok(CBZ.woundSkinAudit().marks === 0, `${id}: a restore heals the skin`);
}

console.log(fails ? `shark-marks check: ${fails} failure(s)` : "shark-marks check: OK");
process.exit(fails ? 1 : 0);
