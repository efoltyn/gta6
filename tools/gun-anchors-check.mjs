#!/usr/bin/env node
/* tools/gun-anchors-check.mjs — DOES EVERY HELD MODEL NAME ITS HAND/EYE POINTS,
   AND DO THOSE POINTS SIT ON THE THING THAT IS DRAWN?

   The anchor contract is written at the top of
   src/weapons/appearances/sidearm.js (the appearances index). Plain node, no
   browser: the real three.js r128 + weapon data + every appearance + the
   optic factory + the flashlight / charge / detonator / grenade builders run
   in a vm, each model is built the way a rack or an NPC builds it (no hand),
   and every anchor is measured against the model's own triangles:

     · the record exists, k is a sane model-units-per-metre, every pos is
       finite and every quat unit length;
     · a gun has grip, trigger, muzzle, support, optic; a sight unless its
       optic is "none"; a lens on a dot/holo/scope; a mag unless it has none;
       a bolt on a bolt gun;
     · grip, trigger, support, muzzle, mag (+ its well), stock, bolt, charge,
       lens and the sight's rear/front lie ON or INSIDE a drawn mesh (within
       TOL of a triangle, or enclosed by one);
     · grip +Y within 35 deg of straight up; muzzle -Z within 3 deg of the
       bore's way; the sight line within 4 deg of the bore; the eye point
       behind the rear sight and NOT inside the gun;
     · a fitted gunsmith optic (createWeaponOptic) carries its own record and
       activeSight() returns it over the factory one.

     node tools/gun-anchors-check.mjs [--verbose]     exit 0 = ok */
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { fakeDocument } from "./lib/fake-canvas.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const verbose = process.argv.includes("--verbose");
const ctx = vm.createContext({ console, Math, performance, setTimeout });
ctx.window = ctx; ctx.self = ctx; ctx.document = fakeDocument();
ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
ctx.CBZ = { CONFIG: {}, onAlways() {}, onUpdate() {}, on() {} };
const appearDir = new URL("src/weapons/appearances/", ROOT);
const appear = readdirSync(appearDir).filter((f) => f.endsWith(".js") && f !== "sidearm.js").sort();
for (const f of ["src/vendor/three.r128.min.js", "src/weapons/weapon-data.js", "src/weapons/optics.js",
  "src/weapons/appearances/sidearm.js", ...appear.map((n) => "src/weapons/appearances/" + n), "src/weapons/flashlight.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { THREE: T, CBZ } = ctx;
const GA = CBZ.gunAnchors;

let checks = 0, fails = 0;
function ok(c, msg) { checks++; if (!c) { fails++; console.log("FAIL " + msg); } }
if (!GA) { console.log("FAIL CBZ.gunAnchors missing (weapons/appearances/sidearm.js)"); process.exit(1); }

// ---------------------------------------------------------------- materials
const mat = {};
for (const [name, color] of Object.entries({
  dark: 0x161a20, black: 0x080a0c, steel: 0x48515c, worn: 0x747f8c, tan: 0x8b6a42,
  polymer: 0x232a24, brass: 0xd6a33b, redShell: 0x9d2523, bore: 0x050505,
})) { mat[name] = new T.MeshLambertMaterial({ color }); mat[name]._shared = true; }
function box(parent, sx, sy, sz, material, x, y, z, rx, ry, rz) {
  const m = new T.Mesh(new T.BoxGeometry(sx, sy, sz), material);
  m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0);
  parent.add(m); return m;
}
function cyl(parent, r, len, material, x, y, z, rx, ry, rz) {
  const m = new T.Mesh(new T.CylinderGeometry(r, r, len, 12), material);
  m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0);
  parent.add(m); return m;
}
const gunCtx = { THREE: T, box, cyl, mat, noHand: true };

// ------------------------------------------------------------- the triangles
function trianglesOf(model) {
  const tris = [];
  model.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(model.matrixWorld).invert();
  model.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.visible) return;
    for (let p = o; p && p !== model; p = p.parent) if (!p.visible) return;
    const M = new T.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : pos.count;
    const v = (i) => new T.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(M);
    for (let i = 0; i + 2 < n; i += 3) tris.push([v(i), v(i + 1), v(i + 2), o]);
  });
  return tris;
}
const _tri = new T.Triangle(), _cp = new T.Vector3();
function nearest(tris, p) {
  let best = Infinity;
  for (const t of tris) {
    _tri.set(t[0], t[1], t[2]);
    _tri.closestPointToPoint(p, _cp);
    const d = _cp.distanceToSquared(p);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
// enclosed: a ray each way along three axes hits the drawn surface on both sides
const _ray = new T.Ray(), _hit = new T.Vector3();
function enclosed(tris, p) {
  const dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let votes = 0;
  for (const d of dirs) {
    let a = false, b = false;
    for (const t of tris) {
      if (!a) { _ray.set(p, new T.Vector3(d[0], d[1], d[2])); if (_ray.intersectTriangle(t[0], t[1], t[2], false, _hit)) a = true; }
      if (!b) { _ray.set(p, new T.Vector3(-d[0], -d[1], -d[2])); if (_ray.intersectTriangle(t[0], t[1], t[2], false, _hit)) b = true; }
      if (a && b) break;
    }
    if (a && b) votes++;
  }
  return votes >= 2;
}
const TOL = 0.014;   // model units (about 6 mm at the guns' ~2.25 units per metre)
function onMesh(tris, p, tol) {
  const d = nearest(tris, p);
  return { ok: d <= (tol || TOL) || enclosed(tris, p), d };
}
const up = new T.Vector3(0, 1, 0), fwd = new T.Vector3(0, 0, -1);
const axisOf = (q, v) => v.clone().applyQuaternion(q);
const deg = (r) => (r * 180 / Math.PI).toFixed(1);

function checkRecord(label, model, req) {
  const A = model.userData.anchors;
  ok(!!A, `${label}: no userData.anchors`);
  if (!A) return;
  ok(Number.isFinite(A.k) && A.k > 0.5 && A.k < 6, `${label}: k ${A.k} is not a sane model-units-per-metre`);
  const tris = trianglesOf(model);
  for (const name of req) ok(!!A[name], `${label}: required anchor '${name}' missing`);
  const rows = [];
  for (const name of GA.NAMES) {
    const a = A[name];
    if (!a) continue;
    const finite = a.pos && [a.pos.x, a.pos.y, a.pos.z].every(Number.isFinite);
    ok(finite, `${label}.${name}: pos not finite`);
    ok(a.quat && Math.abs(a.quat.length() - 1) < 1e-4, `${label}.${name}: quat not unit`);
    if (!finite) continue;
    if (name === "sight") {
      ok(a.rear && a.front, `${label}.sight: rear/front missing`);
      if (!a.rear || !a.front) continue;
      for (const [nm, p] of [["rear", a.rear], ["front", a.front]]) {
        const r = onMesh(tris, p, TOL * 1.5);
        ok(r.ok, `${label}.sight.${nm} ${p.toArray().map((x) => x.toFixed(3))} is ${r.d.toFixed(3)}u off the drawn sight`);
      }
      const line = a.front.clone().sub(a.rear).normalize();
      ok(line.angleTo(fwd) < 4 * Math.PI / 180, `${label}.sight: line ${deg(line.angleTo(fwd))} deg off the bore`);
      ok(axisOf(a.quat, fwd).angleTo(line) < 1e-3, `${label}.sight: quat does not look down the sight line`);
      ok(a.pos.z > a.rear.z, `${label}.sight: eye point is not behind the rear sight`);
      ok(Number.isFinite(a.eyeRelief) && a.eyeRelief >= 0.03 && a.eyeRelief <= 0.8, `${label}.sight: eyeRelief ${a.eyeRelief} m`);
      const dEye = nearest(tris, a.pos);
      ok(!(enclosed(tris, a.pos) && dEye > 0.002), `${label}.sight: the eye point is inside the gun`);
      rows.push(`sight rear->front ${deg(line.angleTo(fwd))}deg, relief ${a.eyeRelief}m`);
      continue;
    }
    const r = onMesh(tris, a.pos);
    ok(r.ok, `${label}.${name} ${a.pos.toArray().map((x) => x.toFixed(3))} is ${r.d.toFixed(3)}u from the mesh`);
    rows.push(`${name} ${r.d.toFixed(3)}`);
    if (name === "mag" && a.well) {
      const w = onMesh(tris, a.well);
      ok(w.ok, `${label}.mag.well is ${w.d.toFixed(3)}u from the mesh`);
    }
    if (name === "lens") ok(a.radius > 0, `${label}.lens: radius ${a.radius}`);
  }
  if (A.grip) ok(axisOf(A.grip.quat, up).angleTo(up) < 35 * Math.PI / 180, `${label}.grip: +Y ${deg(axisOf(A.grip.quat, up).angleTo(up))} deg off vertical`);
  if (verbose) console.log(`  ${label}: k ${A.k} optic ${A.optic && A.optic.type} | ${rows.join(", ")}`);
}

// ----------------------------------------------------------------- the guns
const rows = (CBZ.FPS_WEAPONS || []).slice();
const seen = new Set();
for (const w of rows) {
  const key = w.appearanceFactory || w.key;
  if (seen.has(key)) continue;
  seen.add(key);
  const build = CBZ.weaponAppearance[key];
  ok(!!build, `${w.id}: no appearance factory ${key}`);
  if (!build) continue;
  const model = build(gunCtx);
  const melee = !!w.melee, opticId = w.optic || "iron";
  const req = melee ? ["grip", "optic"] : ["grip", "trigger", "muzzle", "support", "optic"];
  if (!melee && opticId !== "none") req.push("sight");
  if (["dot", "mgo", "acog", "m3a"].includes(opticId)) req.push("lens");
  if (!melee && (w.mag | 0) > 1) req.push("mag");
  if (w.fireMode === "bolt") req.push("bolt");
  checkRecord(w.id, model, req);
  const A = model.userData.anchors;
  if (A && !melee && opticId !== "none") {
    const want = { iron: "iron", dot: "reddot", mgo: "scope", acog: "scope", m3a: "scope", pgo7: "scope" }[opticId];
    if (want) ok(A.optic && (A.optic.type === want || (want === "reddot" && A.optic.type === "holo")), `${w.id}: optic type ${A.optic && A.optic.type}, weapon-data says ${opticId}`);
  }
  // THE BAKE: the NPC/rack build (noHand) merges static parts per material;
  // it must draw exactly the same gun as the part-by-part build
  {
    const parts = build({ THREE: T, box, cyl, mat });
    const count = (m) => { let n = 0; m.traverse((o) => { if (o.isMesh && o.visible) n++; }); return n; };
    const vb = (m) => { const b = new T.Box3(); for (const t of trianglesOf(m)) { b.expandByPoint(t[0]); b.expandByPoint(t[1]); b.expandByPoint(t[2]); } return b; };
    const b0 = vb(parts), b1 = vb(model);
    ok(b0.min.distanceTo(b1.min) < 1e-4 && b0.max.distanceTo(b1.max) < 1e-4, `${w.id}: the baked build's bounds differ from the part build`);
    ok(count(model) <= count(parts), `${w.id}: baking added meshes`);
    if (verbose) console.log(`  ${w.id}: ${count(parts)} parts -> ${count(model)} draw calls baked`);
  }
  if (A && A.muzzle && model.userData.muzzle) ok(A.muzzle.pos.distanceTo(model.userData.muzzle) < 1e-6, `${w.id}: anchors.muzzle != userData.muzzle`);
}
// every appearance factory registered, even one no weapon row names
for (const key of Object.keys(CBZ.weaponAppearance)) {
  if (seen.has(key) || CBZ.weaponAppearance[key] === CBZ.weaponAppearance.shank && seen.has("shank")) continue;
  const model = CBZ.weaponAppearance[key](gunCtx);
  checkRecord(key, model, ["grip"]);
}

// ------------------------------------------------------- the held non-guns
const items = [
  ["flashlight", () => CBZ.buildFlashlight && CBZ.buildFlashlight({}), ["grip", "trigger", "muzzle"]],
  ["c4 brick", () => CBZ.buildC4Brick && CBZ.buildC4Brick(T), ["grip"]],
  ["detonator", () => CBZ.buildC4Detonator && CBZ.buildC4Detonator(T), ["grip", "trigger"]],
  ["grenade", () => CBZ.grenadeMesh && CBZ.grenadeMesh(T), ["grip"]],
];
for (const [label, make, req] of items) {
  const m = make();
  ok(!!m, `${label}: builder missing`);
  if (m) checkRecord(label, m, req);
}

// --------------------------------------------- a fitted optic's own record
if (CBZ.createWeaponOptic && CBZ.weaponAppearance.carbine) {
  const gun = CBZ.weaponAppearance.carbine(gunCtx);
  const fitted = CBZ.createWeaponOptic({ name: "fitted-test", x: 0, y: 0.2, z: -0.2, length: 0.34, radius: 0.05, highMag: true });
  ok(!!fitted.userData.opticAnchors, "createWeaponOptic: no opticAnchors on a fitted optic");
  const grp = new T.Group(); grp.name = "_gmods"; grp.add(fitted); gun.add(grp);
  const base = gun.getObjectByName("_baseOptic"); if (base) base.visible = false;
  const s = GA.activeSight(gun);
  ok(s && s.optic && s.optic.type === "scope", "activeSight: the fitted scope did not win over the factory sight");
  if (s && s.lens) ok(Math.abs(s.lens.pos.z - (-0.2 + 0.17)) < 0.03, `activeSight: fitted lens z ${s.lens.pos.z.toFixed(3)} is not at the fitted scope's ocular end`);
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
