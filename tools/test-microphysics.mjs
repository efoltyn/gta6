#!/usr/bin/env node
/* ============================================================
   tools/test-microphysics.mjs — THE SLICE-PAGE PHYSICS CORE, WITHOUT A BROWSER.

   src/core/microboot.js is physics.js for every games/ page (Warlord,
   Battle, Bomb Survivor): the collider registry, the disc resolver, the
   swept disc, the ray and the line-of-sight test. This loads the real
   three.r128 + the real microboot.js into a node vm with a stub DOM and
   checks the claims those pages stand on:

     • an oriented box pushes a disc out along ITS face, not the AABB's
     • y0/y1 bands gate exactly like physics.js (under / over / touching)
     • a disc wedged into an inside corner clears both walls in one call
     • segmentBlocked sees a turned wall exactly (no AABB ghost corners)
     • a fast sweep cannot tunnel through a thin wall, OBB included
     • the grid stays right through add / remove / move, array never swapped
     • rayColliders reports the face it entered

       node tools/test-microphysics.mjs
============================================================ */
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function boot() {
  const noop = () => {};
  const el = () => new Proxy(function () {}, {
    get: (t, k) => k === "style" ? {} :
      (k === "classList" ? { add: noop, remove: noop, toggle: noop, contains: () => false } : el()),
    apply: () => el(),
  });
  const document = {
    createElement: () => el(), head: el(), body: el(), documentElement: el(),
    addEventListener: noop, getElementById: () => null, querySelector: () => null,
  };
  const win = {
    document, addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1,
    innerWidth: 800, innerHeight: 600, navigator: { userAgent: "node", maxTouchPoints: 0 },
    location: { search: "" }, performance, requestAnimationFrame: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    console, setTimeout, clearTimeout, URLSearchParams,
  };
  win.window = win; win.self = win;
  const ctx = vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/vendor/three.r128.min.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "src/core/microboot.js"), "utf8"), ctx, { filename: "microboot.js" });
  return ctx;
}

let pass = 0;
const fails = [];
function ok(cond, name, info) {
  if (cond) pass++;
  else fails.push(name + (info !== undefined ? "  " + JSON.stringify(info) : ""));
}
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

const CTX = boot();
const CBZ = CTX.CBZ;
const M = CBZ.micro;
ok(!!M && typeof M.resolveCircle === "function", "microboot loaded headless");
ok(CBZ.colliders === M.colliders, "CBZ.colliders IS micro.colliders");
for (const k of ["collide", "collideSlide", "sweepCircle", "rayColliders", "colliderAdd", "colliderRemove",
  "orientedCollider", "segmentHitsCollider", "queryCollidersNear", "markCollidersDirty"]) {
  ok(typeof CBZ[k] === "function", "publishes CBZ." + k);
}
const arr = M.colliders;

// ---------------------------------------------------------------- OBB push
{
  M.clearColliders();
  // a 6 m x 0.4 m wall turned 45 degrees at the origin
  const yaw = Math.PI / 4;
  const w = M.addBoxCollider(0, 1, 0, 6, 2, 0.4, { yaw });
  ok(w.yaw === yaw && near(w.hw, 3) && near(w.hd, 0.2), "addBoxCollider extra.yaw makes an oriented record", w);
  ok(!("yaw" in M.addBoxCollider(50, 1, 50, 2, 2, 2, { yaw: Math.PI / 2 })), "right-angle yaw stays a plain AABB");
  // the wall's local +z normal in world = (sin, cos)
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  // a disc just touching the face from outside (0.3 m from the face, r 0.5)
  const p = { x: nx * 0.5, z: nz * 0.5 };
  const hit = CBZ.collide(p, 0.5, 0, 1.8);
  const dist = p.x * nx + p.z * nz;
  ok(hit && near(dist, 0.7, 1e-3), "OBB pushes along its own face normal", { dist, p });
  // a point in the AABB corner but nowhere near the turned wall is FREE
  const q = { x: 2.0, z: 2.0 };
  const hitQ = CBZ.collide(q, 0.4, 0, 1.8);
  ok(!hitQ && q.x === 2 && q.z === 2, "no ghost wall in the AABB's empty corner", q);
  // centre inside: leaves through the nearest local face
  const c = { x: 0.05 * nx, z: 0.05 * nz };
  CBZ.collide(c, 0.3, 0, 1.8);
  ok(near(c.x * nx + c.z * nz, 0.5, 1e-3), "centre-inside exits through the near face", c);
  ok(M.colliderContains(w, 0, 0) && !M.colliderContains(w, 2, 2), "colliderContains is exact on an OBB");
}

// --------------------------------------------------------------- band gate
{
  M.clearColliders();
  M.addCollider({ minX: -1, maxX: 1, minZ: -1, maxZ: 1, y0: 2, y1: 3 });   // a beam at 2..3 m
  let p = { x: 1.2, z: 0 };
  ok(!CBZ.collide(p, 0.5, 0, 1.8), "body wholly under a band passes");
  p = { x: 1.2, z: 0 };
  ok(!CBZ.collide(p, 0.5, 3, 4.8), "body wholly over a band passes");
  p = { x: 1.2, z: 0 };
  ok(!CBZ.collide(p, 0.5, 0, 2), "head exactly at y0 passes (physics.js <=)");
  p = { x: 1.2, z: 0 };
  ok(CBZ.collide(p, 0.5, 1, 2.8) && near(p.x, 1.5), "body inside the band is pushed", p);
  p = { x: 1.2, z: 0 };
  ok(CBZ.collide(p, 0.5) && near(p.x, 1.5), "no feet/head = full height", p);
  p = { x: 1.2, z: 0 };
  ok(!M.resolveCircle(p, 0.5, 3, 1.8), "resolveCircle(y,height) standing on top passes");
}

// ------------------------------------------------------------- corner wedge
{
  M.clearColliders();
  // an inside corner: a wall along x (z in [0,0.4]) and a wall along z (x in [0,0.4])
  M.addCollider({ minX: 0, maxX: 10, minZ: 0, maxZ: 0.4 });
  M.addCollider({ minX: 0, maxX: 0.4, minZ: 0, maxZ: 10 });
  const p = { x: 0.6, z: 0.6 };               // r 0.45 overlaps both walls
  CBZ.collide(p, 0.45, 0, 1.8);
  ok(p.x >= 0.85 - 1e-6 && p.z >= 0.85 - 1e-6, "inside corner clears both walls in one call", p);
  // the same wedge with a turned pair (a V of two OBB walls)
  M.clearColliders();
  const a = 0.5;
  M.addBoxCollider(Math.cos(a) * 3, 1, -Math.sin(a) * 3, 6, 2, 0.3, { yaw: a });
  M.addBoxCollider(Math.sin(a) * 3, 1, Math.cos(a) * 3, 0.3, 2, 6, { yaw: a });
  const q = { x: 0.5 * (Math.cos(a) + Math.sin(a)), z: 0.5 * (Math.cos(a) - Math.sin(a)) };
  CBZ.collide(q, 0.5, 0, 1.8);
  let bad = 0;
  const probe = { x: q.x, z: q.z };
  CBZ.collide(probe, 0.499, 0, 1.8);
  if (Math.hypot(probe.x - q.x, probe.z - q.z) > 1e-6) bad++;
  ok(!bad, "turned inside corner converges (no residual overlap)", q);
  ok(CBZ.collideSlide({ x: 0.3, z: 0.3 }, 0.5, 0, 1.8) === true, "collideSlide reports moved");
}

// --------------------------------------------------------- segmentBlocked
{
  M.clearColliders();
  // a thin wall 8 m long turned 30 degrees, centred at (0,0)
  const yaw = Math.PI / 6;
  M.addBoxCollider(0, 1.5, 0, 8, 3, 0.2, { yaw });
  const nx = Math.sin(yaw), nz = Math.cos(yaw);        // wall normal
  const tx = Math.cos(yaw), tz = -Math.sin(yaw);       // wall tangent
  ok(M.segmentBlocked(-nx * 5, 1, -nz * 5, nx * 5, 1, nz * 5), "line through the turned wall is blocked");
  // a line parallel to the wall, 1 m off it: inside the AABB, clear of the wall
  ok(!M.segmentBlocked(nx * 1 - tx * 3, 1, nz * 1 - tz * 3, nx * 1 + tx * 3, 1, nz * 1 + tz * 3),
    "parallel line inside the AABB but beside the wall is clear");
  ok(!M.segmentBlocked(-nx * 5, 3.5, -nz * 5, nx * 5, 3.5, nz * 5), "line over the wall top is clear");
  const nb = M.addBoxCollider(100, 1, 0, 1, 2, 1, { noBlock: true });
  ok(!M.segmentBlocked(95, 1, 0, 105, 1, 0) && !!nb, "noBlock records never block sight");
  // long segment across many cells: a far wall is still found
  M.addBoxCollider(600, 1, 0, 0.3, 2, 4);
  ok(M.segmentBlocked(-400, 1, 0, 900, 1, 0), "long segment finds a wall 600 m out");
}

// ------------------------------------------------------ sweep, no tunnel
{
  M.clearColliders();
  M.addCollider({ minX: 10, maxX: 10.1, minZ: -5, maxZ: 5 });   // a 10 cm wall
  const out = {};
  const hit = CBZ.sweepCircle({ x: 0, z: 0 }, { x: 40, z: 0 }, 0.3, 0, 1.8, out);
  ok(hit && out.hit && near(out.t * 40, 9.7, 1e-4) && near(out.nx, -1) && near(out.nz, 0) && out.c, "40 m step stops at a 10 cm wall", out);
  ok(near(out.x, 9.69, 1e-4), "safe centre is backed off 1 cm along the path", out.x);
  const miss = {};
  ok(!CBZ.sweepCircle({ x: 0, z: 6 }, { x: 40, z: 6 }, 0.3, 0, 1.8, miss) && miss.t === 1 && miss.x === 40 && !miss.hit, "sweep past the wall end is free, out = to");
  // the corner disc: graze past the end at 0.2 m, r 0.3 -> hits the rounded corner
  const o2 = {};
  ok(CBZ.sweepCircle({ x: 0, z: 5.2 }, { x: 40, z: 5.2 }, 0.3, 0, 1.8, o2) && o2.nz > 0 && o2.nx < 0, "rounded corner contact with a diagonal normal", o2);
  // turned wall, fast
  M.clearColliders();
  const yaw = 0.7;
  M.addBoxCollider(20, 1, 0, 12, 2, 0.12, { yaw: yaw + Math.PI / 2 });   // roughly across the x axis
  const o3 = {};
  ok(CBZ.sweepCircle({ x: 0, z: 0 }, { x: 60, z: 0 }, 0.25, 0, 1.8, o3) && o3.t < 1, "no tunnel through a 12 cm turned wall", o3);
  const land = { x: o3.x, z: o3.z };
  ok(!CBZ.collide(land, 0.2499, 0, 1.8), "sweep contact point is outside the wall");
  // embedded + moving out = not blocked; moving deeper = t 0
  M.clearColliders();
  M.addCollider({ minX: 0, maxX: 1, minZ: -5, maxZ: 5 });
  ok(!CBZ.sweepCircle({ x: -0.2, z: 0 }, { x: -3, z: 0 }, 0.3, 0, 1.8, {}), "embedded disc moving OUT is not blocked");
  const o4 = {};
  ok(CBZ.sweepCircle({ x: -0.2, z: 0 }, { x: 3, z: 0 }, 0.3, 0, 1.8, o4) && o4.t === 0 && near(o4.nx, -1), "embedded disc moving IN hits at t 0", o4);
  ok(!CBZ.sweepCircle({ x: 0.5, z: 0 }, { x: 3, z: 0 }, 0.3, 0, 1.8, {}), "centre already inside is collide()'s job");
  // resting exactly against the face and pushing in: blocked at once
  const o5 = {};
  ok(CBZ.sweepCircle({ x: -0.3, z: 0 }, { x: 2, z: 0 }, 0.3, 0, 1.8, o5) && o5.t < 1e-6, "touching disc pushing in is blocked", o5);
  ok(!CBZ.sweepCircle({ x: -0.3, z: 0 }, { x: -0.3, z: 3 }, 0.3, 0, 1.8, {}), "touching disc sliding along the face is free");
  // band gate on the sweep
  M.clearColliders();
  M.addCollider({ minX: 5, maxX: 6, minZ: -5, maxZ: 5, y0: 0, y1: 0.4 });
  ok(!CBZ.sweepCircle({ x: 0, z: 0 }, { x: 10, z: 0 }, 0.3, 0.5, 2.3, {}), "sweep over a kerb band passes");
  ok(CBZ.sweepCircle({ x: 0, z: 0 }, { x: 10, z: 0 }, 0.3, 0, 1.8, {}), "sweep into a kerb band at foot height hits");
}

// ------------------------------------------------------------------ ray
{
  M.clearColliders();
  M.addCollider({ minX: 5, maxX: 6, minZ: -1, maxZ: 1, y0: 0, y1: 2 });
  const o = {};
  const rc = CBZ.rayColliders(0, 1, 0, 1, 0, 0, 100, o);
  ok(rc && rc === o.c && o.hit && near(o.t, 5) && o.nx === -1 && o.ny === 0, "ray hits the -x face, returns the record", o);
  ok(CBZ.rayColliders(5.5, 1, 0, 1, 0, 0, 100, {}) === null, "origin inside is skipped by default");
  const oi = {};
  ok(CBZ.rayColliders(5.5, 1, 0, 1, 0, 0, 100, oi, { inside: true }) && oi.t === 0 && oi.nx === -1, "opts.inside hits at t 0, normal -d", oi);
  ok(CBZ.rayColliders(0, 1, 0, 1, 0, 0, 100, {}, { filter: () => false }) === null, "opts.filter false ignores");
  ok(CBZ.rayColliders(0, 1, 0, 1, 0, 0, 100, {}, { skip: rc }) === null, "opts.skip ignores the record");
  const o2 = {};
  ok(CBZ.rayColliders(5.5, 10, 0, 0, -1, 0, 100, o2) && near(o2.t, 8) && o2.ny === 1, "ray down hits the top", o2);
  ok(CBZ.rayColliders(0, 1, 0, 1, 0, 0, 4, {}) === null, "ray shorter than the gap misses");
  M.clearColliders();
  const yaw = Math.PI / 4;
  M.addBoxCollider(10, 1, 0, 0.2, 2, 6, { yaw });   // thin wall turned 45
  const o3 = {};
  const h3 = CBZ.rayColliders(0, 1, 0, 1, 0, 0, 50, o3);
  // local +x of the wall in world is (cos, -sin); the ray enters its -x face
  ok(h3 && near(o3.nx, -Math.cos(yaw)) && near(o3.nz, Math.sin(yaw)), "ray normal on a turned wall is its face", o3);
  ok(near(o3.t, 10 - 0.1 * Math.SQRT2, 1e-3), "ray t on a turned wall is exact", o3.t);
}

// ------------------------------------------------- registry mutations
{
  M.clearColliders();
  const a = M.addCollider({ minX: 0, maxX: 1, minZ: 0, maxZ: 1, ref: "crate" });
  const b = M.addCollider({ minX: 100, maxX: 101, minZ: 0, maxZ: 1 });
  ok(M.colliders === arr && CBZ.colliders === arr, "array identity kept through clear/add");
  ok(M.removeCollider("crate") === 1 && M.colliders.indexOf(a) < 0, "remove by ref");
  let p = { x: 0.5, z: 1.2 };
  ok(!CBZ.collide(p, 0.3), "removed record no longer collides");
  // raw push (materials.js addBox style) is caught by the length check
  CBZ.colliders.push({ minX: 200, maxX: 201, minZ: 0, maxZ: 1 });
  p = { x: 200.5, z: 1.2 };
  ok(CBZ.collide(p, 0.3), "raw-pushed record collides without the doorbell");
  // splice + push (same length) + doorbell
  CBZ.colliders.splice(CBZ.colliders.indexOf(b), 1);
  CBZ.colliders.push({ minX: 300, maxX: 301, minZ: 0, maxZ: 1 });
  CBZ.markCollidersDirty();
  p = { x: 100.5, z: 1.2 };
  ok(!CBZ.collide(p, 0.3), "spliced record gone after the doorbell");
  p = { x: 300.5, z: 1.2 };
  ok(CBZ.collide(p, 0.3), "same-length replacement found after the doorbell");
  // move: shift an OBB across a cell border and it collides where it IS
  const m = M.addBoxCollider(10, 1, 10, 2, 2, 0.4, { yaw: 0.6 });
  M.shiftCollider(m, 100, 0);
  p = { x: 10, z: 10 };
  ok(!CBZ.collide(p, 0.3), "moved record is gone from where it was");
  p = { x: 110, z: 10 };
  ok(CBZ.collide(p, 0.3) && near(m.cx, 110), "moved record collides where it is (OBB centre moved too)");
  // meshCollider-shaped record (OBB fields, no AABB) gets its AABB
  const r = M.addCollider({ cx: 500, cz: 0, hw: 2, hd: 0.2, yaw: 0.3, y0: 0, y1: 2, ref: "mesh" });
  ok(r.minX < 500 && r.maxX > 500 && CBZ.collide({ x: 500, z: 0 }, 0.3, 0, 1.8), "OBB-only record is indexed and solid");
  CBZ.colliderRemove(r);
  ok(!CBZ.collide({ x: 500, z: 0 }, 0.3, 0, 1.8), "CBZ.colliderRemove unindexes");
  // colliderAt with band
  M.addCollider({ minX: 600, maxX: 601, minZ: 0, maxZ: 1, y0: 0, y1: 1 });
  ok(M.colliderAt(600.5, 0.5, 0.5) && !M.colliderAt(600.5, 1.5, 0.5), "colliderAt honours the band");
}

// ---------------------------------- segmentBlocked, endpoint inside a box
{
  M.clearColliders();
  M.addCollider({ minX: -2, maxX: 2, minZ: -2, maxZ: 2, y0: 0, y1: 3 });   // a bunker
  ok(M.segmentBlocked(0, 1, 0, 20, 1, 0), "a man inside the bunker is behind its walls");
}

// ---------------------- systems/meshcollider.js records on the micro grid
// (another builder's file; tested here only for how ITS records land on
// THIS registry. Skipped, not failed, while the file is absent.)
{
  const mcPath = path.join(ROOT, "src/systems/meshcollider.js");
  if (fs.existsSync(mcPath)) {
    vm.runInContext(fs.readFileSync(mcPath, "utf8"), CTX, { filename: "meshcollider.js" });
    ok(!!CBZ.meshCollider && typeof CBZ.solidFromMesh === "function", "meshcollider.js publishes on a micro page");
    M.clearColliders();
    const T = CTX.THREE;
    const g = new T.Group();
    const m = new T.Mesh(new T.BoxGeometry(6, 2, 0.4), new T.MeshBasicMaterial());
    m.position.set(0, 1, 0);
    g.add(m);
    g.position.set(30, 0, 30);
    g.rotation.y = 0.6;
    const recs = CBZ.solidFromMesh(g, { ref: "wall" }) || [];
    ok(recs.length >= 1 && M.colliders.length === recs.length, "solidFromMesh lands on micro.colliders", recs.length);
    const r0 = recs[0] || {};
    ok(r0.yaw != null && Math.abs(Math.abs(Math.sin(r0.yaw)) - Math.abs(Math.sin(0.6))) < 0.05 || Math.abs(Math.abs(Math.cos(r0.yaw)) - Math.abs(Math.sin(0.6))) < 0.05,
      "mesh record is oriented at the group's yaw", r0);
    // walk into it along its normal: stopped at the face, not at the AABB
    const nx = Math.sin(0.6), nz = Math.cos(0.6);
    const p = { x: 30 + nx * 0.3, z: 30 + nz * 0.3 };
    CBZ.collide(p, 0.4, 0, 1.8);
    const dist = (p.x - 30) * nx + (p.z - 30) * nz;
    ok(Math.abs(dist - 0.6) < 0.06, "disc stops at the mesh wall's face", { dist });
    const q = { x: 30 + Math.cos(0.6) * 2.9 + nx * 2.2, z: 30 - Math.sin(0.6) * 2.9 + nz * 2.2 };
    ok(!CBZ.collide(q, 0.4, 0, 1.8), "no ghost in the mesh wall's AABB corner");
    ok(CBZ.meshCollider.remove("wall") >= 1 && M.colliders.length === 0 && !CBZ.collide({ x: 30, z: 30 }, 0.4, 0, 1.8),
      "meshCollider.remove unindexes from the micro grid");
  } else console.log("  (meshcollider.js absent: mesh section skipped)");
}

// --------------------------- warlord/props.js place(): turned props, turned boxes
{
  let P = null;
  try {
    for (const f of ["src/core/seed.js", "src/warlord/core.js", "src/warlord/props.js"]) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), CTX, { filename: f });
    }
    P = CBZ.warlord && CBZ.warlord.props;
  } catch (e) { fails.push("props.js load: " + e.message); }
  if (P) {
    M.clearColliders();
    const yaw = 0.7;
    const sb = P.sandbags({});
    P.place(sb, 100, 0, 100, yaw);
    const typed = sb.userData.colliders.filter((c) => !(c.cover === false && c.solid === false)).length;
    ok(M.colliders.length === typed && M.colliders.every((c) => c.yaw), "place() registers every typed box, turned", M.colliders.length);
    P.unplace(sb);
    ok(M.colliders.length === 0, "unplace() takes them all back out");

    const ct = P.container({});
    P.place(ct, 200, 0, 200, yaw);
    const rec = M.colliders[0];
    ok(rec && near(rec.yaw, yaw) && near(rec.hd * 2, 2.44, 0.01), "a turned container is a turned 2.44 m box", rec);
    // stand 0.3 m off its long face: pushed to r off the face, not to the AABB
    const nx = Math.sin(yaw), nz = Math.cos(yaw);
    const p = { x: 200 + nx * (1.22 + 0.3), z: 200 + nz * (1.22 + 0.3) };
    CBZ.collide(p, 0.45, 0, 1.8);
    const dd = (p.x - 200) * nx + (p.z - 200) * nz;
    ok(near(dd, 1.22 + 0.45, 1e-3), "container face stops a body at its real face", dd);
    const corner = { x: rec.maxX - 0.5, z: rec.maxZ - 0.5 };
    ok(!CBZ.collide(corner, 0.3, 0, 1.8), "no invisible wall in the container's AABB corner");
    P.unplace(ct);

    const bd = P.cover("boulder", { w: 3, h: 1.6, d: 1.6, seed: 5 });
    P.place(bd, 300, 0, 300, 0.3);
    if (CBZ.meshCollider) {
      ok(M.colliders.length >= 1 && M.colliders.every((c) => /^mesh/.test(c.src || "")), "a flagged boulder takes its collider from the rock mesh", M.colliders.map((c) => c.src));
    } else {
      ok(M.colliders.length === 1 && M.colliders[0].yaw, "boulder falls back to its turned typed box");
    }
    P.unplace(bd);
    ok(M.colliders.length === 0, "mesh-derived records unplace too");
  }
}

console.log(`test-microphysics: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log("  FAIL " + f);
process.exit(fails.length ? 1 : 0);
