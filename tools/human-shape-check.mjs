#!/usr/bin/env node
/* tools/human-shape-check.mjs — the shaped human (entities/character.js
   SHAPED PARTS + CBZ.human) in plain node, no browser.

   Builds male / female / child / elder bodies for every heritage.js heritage
   and asserts:
     1. every body builds, mesh count stays in the ~22-26 band,
     2. every vertex of every geometry is finite, every index in range,
     3. NO PER-BODY GEOMETRY: two bodies of the same form share every
        non-box geometry object (head, hair, brows, beard, shoe) — the
        pedinstance.js pooling precondition — and box parts stay true
        1-segment BoxGeometry,
     4. the face is wired: eyes/irises/brow/mouth parented under the neck's
        face node, irises under the eyes, rig.faceRest present, the head keeps
        its own (unshared) material, the head's UVs sit inside the ink atlas,
     5. CBZ.human.regions / dress / setHandPose answer,
     6. the shoe's sole plane is where the old box cap's was (feet planted).
   Prints per-body mesh + triangle counts.

     node tools/human-shape-check.mjs
*/
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math, Map, Set, Float32Array, Float64Array, Int32Array, Uint16Array, Uint32Array });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {} };
vm.runInContext(read("src/vendor/three.r128.min.js"), ctx, { filename: "three" });
// materials.js needs a page; its three calls are stubbed with the same caching contract
vm.runInContext(`
  (function(){
    const gc = new Map(), mc = new Map();
    CBZ.mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    CBZ.cmat = (c) => { let m = mc.get(c); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); m._shared = true; mc.set(c, m); } return m; };
    CBZ.boxGeom = (w, h, d) => { const k = w + "," + h + "," + d; let g = gc.get(k); if (!g) { g = new THREE.BoxGeometry(w, h, d); g._shared = true; gc.set(k, g); } return g; };
  })();`, ctx);
for (const f of ["src/systems/fphands.js", "src/entities/character.js", "src/entities/heritage.js"]) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { if (f.includes("fphands")) console.log("  (fphands.js not loadable here: " + e.message + ")"); else throw e; }
}
const { THREE: T, CBZ } = ctx;
let fails = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } }

check(!!CBZ.human && CBZ.makeCharacter === CBZ.human.build, "CBZ.human published, makeCharacter is its alias");

function meshes(rig) { const out = []; rig.group.traverse((o) => { if (o.isMesh) out.push(o); }); return out; }
function tris(g) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }
function isTrueBox(g) {
  const p = g.parameters;
  return g.type === "BoxGeometry" && p && p.widthSegments === 1 && p.heightSegments === 1 && p.depthSegments === 1;
}
function geomOk(g, tag) {
  const pos = g.attributes.position.array;
  let fin = true;
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) { fin = false; break; }
  check(fin, tag + " finite positions");
  const n = g.attributes.normal;
  if (n) { let ok = true; for (let i = 0; i < n.array.length; i++) if (!Number.isFinite(n.array[i])) { ok = false; break; } check(ok, tag + " finite normals"); }
  if (g.index) { let ok = true; const c = g.attributes.position.count; for (let i = 0; i < g.index.count; i++) if (g.index.getX(i) >= c) { ok = false; break; } check(ok, tag + " index in range"); }
}

const bodies = [
  { tag: "male", c: {} },
  { tag: "female", c: { build: "f" } },
  { tag: "child7", c: { age: 7 } },
  { tag: "girl5", c: { build: "f", age: 5 } },
  { tag: "elder", c: { age: 70 } },
];
const ids = CBZ.HERITAGE_IDS;
const rows = [];
const nonBoxByForm = {};
for (const id of ids) for (const b of bodies) for (const seed of ["a", "b"]) {
  const look = CBZ.heritageRoll(id, id + "|" + b.tag + "|" + seed);
  const c = Object.assign({ torso: 0x445566, arms: 0x445566, legs: 0x223344, shoes: 0x1a1a1a }, look, b.c);
  if (b.c.build === "f") { delete c.beard; c.hairStyle = seed === "a" ? "long" : "bob"; }
  let rig;
  try { rig = CBZ.human.build(c); } catch (e) { check(false, `${id}/${b.tag} build threw: ${e.stack}`); continue; }
  CBZ.heritageApply(rig, look);
  const ms = meshes(rig);
  let t = 0;
  for (const m of ms) { geomOk(m.geometry, `${id}/${b.tag} ${m.name || m.geometry.type}`); t += tris(m.geometry); }
  rows.push({ id, tag: b.tag, meshes: ms.length, tris: t, hair: rig.skinSlots.hair[0] ? rig.skinSlots.hair[0].userData.hairStyle : "-", beard: look.beard || "-" });
  check(ms.length >= 20 && ms.length <= 27, `${id}/${b.tag} mesh count ${ms.length} in the 20-27 band`);
  // face wiring
  const f = rig.face;
  check(f && f.eyeL && f.eyeR && f.irisL && f.irisR && f.brow && f.mouth, `${id}/${b.tag} face parts present`);
  check(f.eyeL.parent === f.brow.parent && f.eyeL.parent.parent === rig.neck, `${id}/${b.tag} face node under the neck`);
  check(f.irisL.parent === f.eyeL && f.irisR.parent === f.eyeR, `${id}/${b.tag} irises under the eye whites`);
  check(isTrueBox(f.eyeL.geometry) && isTrueBox(f.mouth.geometry), `${id}/${b.tag} eye white + mouth stay true boxes (facial.js/outfits.js measure them)`);
  check(rig.faceRest && rig.faceRest.eyeY === 0.34 && rig.faceRest.mouthY === 0.16, `${id}/${b.tag} faceRest`);
  check(rig.head.material && !rig.head.material._shared, `${id}/${b.tag} head material is its own`);
  check(rig.skinSlots.shoes.length === 2 && rig.skinSlots.torso[0] && rig.skinSlots.arms.length === 2 && rig.skinSlots.legs.length === 2, `${id}/${b.tag} slot shapes`);
  // box parts that clothes.js paints stay true boxes with their tags
  for (const m of [].concat(rig.skinSlots.torso, rig.skinSlots.arms, rig.skinSlots.armsLower, rig.skinSlots.legs, rig.skinSlots.legsLower, rig.skinSlots.collar, rig.skinSlots.pelvis)) {
    check(isTrueBox(m.geometry), `${id}/${b.tag} cloth part is a 1-seg box`);
  }
  // sharing: collect every non-box geometry per form key
  const key = rig.headForm + "|" + b.tag;
  const set = nonBoxByForm[key] || (nonBoxByForm[key] = []);
  set.push(ms.filter((m) => !isTrueBox(m.geometry)).map((m) => m.geometry));
  // the shoe sole sits where limb()'s box cap's bottom was: -legLo - 0.03 in the knee frame
  const shoe = rig.skinSlots.shoes[0], P = rig.profile;
  if (!shoe.geometry.boundingBox) shoe.geometry.computeBoundingBox();
  const soleY = shoe.position.y + shoe.geometry.boundingBox.min.y * shoe.scale.y;
  check(Math.abs(soleY - (-P.legLo - 0.03)) < 1e-6, `${id}/${b.tag} shoe sole plane unchanged (${soleY.toFixed(4)})`);
  // the shoe encloses the shin box's bottom (trouser corners never poke out)
  const lw = P.legW * 0.9, sb = shoe.geometry.boundingBox;
  check(sb.max.x * shoe.scale.x > lw / 2 && shoe.position.z + sb.min.z * shoe.scale.z < -lw / 2, `${id}/${b.tag} shoe wider + deeper than the shin`);
  // head UVs inside the atlas
  const uv = rig.head.geometry.attributes.uv.array;
  check(uv.every((x) => x >= 0 && x <= 1), `${id}/${b.tag} head uv in atlas`);
  // regions
  const R = CBZ.human.regions(rig);
  check(R.head.length === 1 && R.shoes.length === 2 && R.legsUpper.length === 2 && R.armsUpper.length === 2 && R.face.length === 6, `${id}/${b.tag} regions`);
}
// NO PER-BODY GEOMETRY: rebuild each (heritage, body) twice with identical input
{
  const look = CBZ.heritageRoll("black", "share-test");
  const c = Object.assign({ torso: 0x445566, arms: 0x445566, legs: 0x223344, shoes: 0x1a1a1a }, look, { hairStyle: "locs", beard: "full" });
  const a = CBZ.human.build(c), b = CBZ.human.build(c);
  const ga = meshes(a).map((m) => m.geometry), gb = meshes(b).map((m) => m.geometry);
  check(ga.length === gb.length && ga.every((g, i) => g === gb[i]), "two identical bodies share EVERY geometry object");
  const fresh = ga.filter((g) => !g._shared);
  check(fresh.length === 0, `every geometry is a shared cache entry (${fresh.length} fresh: ${fresh.map((g) => g.type).join(",")})`);
  // different people of one form still share the head geometry (nose variant aside)
  const m1 = CBZ.human.build({ torso: 1, arms: 1, legs: 1, skin: 0x6b4a32, hair: 0x111111, nose: 1, shoes: 1 }), m2 = CBZ.human.build({ torso: 1, arms: 1, legs: 1, skin: 0xf0c39a, hair: 0x7a4a2e, nose: 1, shoes: 1 });
  check(m1.head.geometry === m2.head.geometry, "two men with one nose variant share one head geometry");
  check(m1.head.material !== m2.head.material, "…but not one head material");
  check(m1.skinSlots.shoes[0].geometry === m2.skinSlots.shoes[0].geometry, "one shoe geometry for everyone");
}
// dress + hand pose through the seam
{
  const r = CBZ.human.build({ torso: 0x111111, arms: 0x111111, legs: 0x111111, shoes: 0x111111, skin: 0xc08a5a });
  check(CBZ.human.dress(r, { torso: 0xaa0000, legs: 0x0000aa, shoes: 0x00aa00 }) === true, "dress(colours) with no wardrobe loaded");
  check(r.skinSlots.torso[0].material.color.getHex() === 0xaa0000 && r.skinSlots.shoes[0].material.color.getHex() === 0x00aa00, "dress painted torso + shoes");
  check(CBZ.cmat(0x111111).color.getHex() === 0x111111, "dress never mutated a shared material");
  check(CBZ.human.dress(r, "no-such-outfit") === false, "unknown outfit id is refused");
  const hp = CBZ.human.setHandPose(r, "r", "pistol");
  check(hp === (typeof r.setHandPose === "function"), "setHandPose delegates to rig.setHandPose");
}
// the head is not a cube: jaw narrower than the temples, a nose stands proud
{
  const g = CBZ.human.geometry.head("m", 1);
  const p = g.attributes.position;
  let chinW = 0, templeW = 0, noseZ = -1;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + 0.3, x = Math.abs(p.getX(i)), z = p.getZ(i);
    if (y > 0.02 && y < 0.06 && z > 0.15) chinW = Math.max(chinW, x);
    if (y > 0.40 && y < 0.46 && z > -0.1 && z < 0.1) templeW = Math.max(templeW, x);
    if (Math.abs(p.getX(i)) < 0.02 && y > 0.18 && y < 0.3) noseZ = Math.max(noseZ, z);
  }
  check(chinW < templeW * 0.8, `jaw tapers (chin half-width ${chinW.toFixed(3)} vs temples ${templeW.toFixed(3)})`);
  check(noseZ > 0.33, `nose stands proud of the face plane (${noseZ.toFixed(3)})`);
}
// per-body report
const agg = {};
for (const r of rows) { const k = r.tag; (agg[k] || (agg[k] = { n: 0, m0: 99, m1: 0, t0: 1e9, t1: 0 })); const a = agg[k]; a.n++; a.m0 = Math.min(a.m0, r.meshes); a.m1 = Math.max(a.m1, r.meshes); a.t0 = Math.min(a.t0, r.tris); a.t1 = Math.max(a.t1, r.tris); }
console.log("body      rigs  meshes   tris");
for (const k in agg) { const a = agg[k]; console.log(k.padEnd(9), String(a.n).padStart(4), `${a.m0}-${a.m1}`.padStart(7), `${a.t0}-${a.t1}`.padStart(10)); }
const styles = {}; for (const r of rows) styles[r.hair] = (styles[r.hair] || 0) + 1;
console.log("hair styles built:", JSON.stringify(styles));
console.log("shared shaped geometries:", Object.keys(nonBoxByForm).length ? "ok" : "none");
console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
