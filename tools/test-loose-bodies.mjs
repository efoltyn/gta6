#!/usr/bin/env node
/* tools/test-loose-bodies.mjs — LOOSE BODIES MEET THE WORLD.

   Plain node, no browser: the real three r128, physics.js (collider grid),
   systems/debris.js (rigid debris + CBZ.looseContact + CBZ.PHYS) and
   city/ragdoll.js in the verbs vm (tools/lib/verbs-vm.mjs).

     1. contact primitive: a segment through a 0.2 m wall stops on the near
        face (AABB and a diagonal oriented wall), a segment that starts inside
        a box is not trapped, a side-only query ignores tops
     2. a debris piece at 40 m/s does not tunnel a 0.2 m wall
     3. a piece older than 4 s still stops at a wall (the old cutoff)
     4. a piece dropped on a banded roof collider rests ON it
     5. a diagonal (yaw) wall stops a fast piece
     6. sleep engages for a calm piece, bakes after, a blast impulse wakes a
        sleeper, and removing what it lies on wakes it
     7. a human ragdoll thrown hard at a 0.2 m wall: no point ends up or
        passes through to the far side
     8. CBZ.PHYS carries the three gravities

     node tools/test-loose-bodies.mjs        exit 0 = ok
     RAGDOLL_SRC=/path/old-ragdoll.js ...   measure another ragdoll.js */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";

let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log("FAIL " + m); } else console.log("ok   " + m); };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const v = loadVerbsVM({ mode: "city" });
const { CBZ, THREE } = v;
CBZ.CONFIG.RAGDOLL_ANY_MODE = true;
CBZ.scene = new THREE.Scene();
vm.runInContext(read("src/systems/debris.js"), v.ctx, { filename: "src/systems/debris.js" });
const RSRC = process.env.RAGDOLL_SRC ? readFileSync(process.env.RAGDOLL_SRC, "utf8") : read("src/city/ragdoll.js");
vm.runInContext(RSRC, v.ctx, { filename: "src/city/ragdoll.js" });
v.updaters.sort((a, b) => a.order - b.order);
if (!CBZ.debris || !CBZ.looseContact) { console.log("FAIL debris.js did not load"); process.exit(1); }
const D = CBZ.debris, I = D._internal, LC = CBZ.looseContact;

// ---- 8. gravities --------------------------------------------------------
ok(CBZ.PHYS && CBZ.PHYS.G_REAL === 9.81 && CBZ.PHYS.G_ACTOR === 22 && CBZ.PHYS.G_VEHICLE === 19.2,
  `CBZ.PHYS = { G_REAL ${CBZ.PHYS.G_REAL}, G_ACTOR ${CBZ.PHYS.G_ACTOR} (TUNE.gravity), G_VEHICLE ${CBZ.PHYS.G_VEHICLE} }`);

// ---- 1. the primitive ----------------------------------------------------
const WALL = { minX: 5, maxX: 5.2, minZ: -5, maxZ: 5, y0: 0, y1: 3 };
const hit = {};
{
  const r = LC.segment(4.9, 1, 0, 5.6, 1, 0, 0.1, [WALL], hit, null);
  ok(r && Math.abs(hit.x - 4.9) < 0.01 && hit.nx === -1, `segment 4.9->5.6 stops on the near face (x ${hit.x && hit.x.toFixed(3)}, n ${hit.nx})`);
  ok(!LC.segment(5.1, 1, 0, 5.9, 1, 0, 0.1, [WALL], hit, null), "a segment starting inside the wall is not trapped");
  ok(!LC.segment(4, 3.5, 0, 6, 3.5, 0, 0.1, [WALL], hit, null), "a segment over the band top passes");
  const top = LC.segment(5.1, 5, 0, 5.1, 2, 0, 0.1, [WALL], hit, null);
  ok(top && hit.ny === 1 && Math.abs(hit.y - 3.1) < 0.01, `a falling segment lands on the top face (y ${hit.y && hit.y.toFixed(3)})`);
  ok(!LC.segment(5.1, 5, 0, 5.1, 2, 0, 0.1, [WALL], hit, { sides: true }), "sides-only ignores the top face");
  const bed = { minX: -1, maxX: 1, minZ: -0.5, maxZ: 0.5, y0: 0, y1: 0.6 };
  ok(!LC.pushOut(0.2, 0.75, 0, 0.22, bed, hit, { sides: true, padY: 0.1 }), "a ragdoll point lying ON a low box is not shoved off its side (padY)");
  ok(LC.pushOut(0.95, 0.4, 0, 0.1, bed, hit, { sides: true }) && hit.nx === 1, "a point inside a box leaves by the nearest side");
  const ori = CBZ.orientedCollider(0, 0, 3, 0.1, 0.6, 0, 3);
  const nx = Math.sin(0.6), nz = Math.cos(0.6);             // the wall's local +z in world
  const r2 = LC.segment(-nx, 1, -nz, nx, 1, nz, 0.05, [ori], hit, null);
  ok(r2 && Math.abs(hit.nx * nx + hit.nz * nz + 1) < 1e-6 && Math.abs((hit.x * nx + hit.z * nz) + 0.15) < 0.01,
    `oriented wall: stops on its near face along its own normal (d ${(hit.x * nx + hit.z * nz).toFixed(3)})`);
}

// ---- debris body helpers -------------------------------------------------
const mat = new THREE.MeshLambertMaterial();
function body(size, x, y, z, kind) {
  kind = kind || "concrete";
  const t = [];
  I.boxTris({ minX: -size / 2, maxX: size / 2, minY: -size / 2, maxY: size / 2, minZ: -size / 2, maxZ: size / 2 }, 0, t);
  const vol = I.volumeOf(t);
  const piece = I.buildPiece({ t, V: vol.V, cx: vol.cx, cy: vol.cy, cz: vol.cz }, [mat], -1);
  piece.mesh.position.set(x, y, z);
  return I.addBody(piece, {}, D.KINDS[kind], kind, vol.V);
}
function setWorld(cols) { v.world({ colliders: cols }); }
function run(b, secs, each) {
  for (let t = 0; t < secs; t += 1 / 60) { D.update(1 / 60); if (each) each(b); if (b.frozen) break; }
}

// ---- 2. 40 m/s into a 0.2 m wall -----------------------------------------
{
  D.clear(); setWorld([Object.assign({}, WALL)]);
  let worst = -Infinity;
  for (const sz of [0.12, 0.3, 0.6]) {
    const b = body(sz, 0, 1.2, 0);
    b.v.set(40, 1.5, 0.3);
    run(b, 3, (bb) => { worst = Math.max(worst, bb.mesh.position.x); });
  }
  ok(worst < 5, `40 m/s pieces (0.12/0.3/0.6 m) never cross a 0.2 m wall (max centre x ${worst.toFixed(3)}, wall face 5.0)`);
  D.clear();
  const b = body(0.2, 0, 1.2, 0); b.v.set(60, 0, 0);
  let w2 = -Infinity; run(b, 2, (bb) => { w2 = Math.max(w2, bb.mesh.position.x); });
  ok(w2 < 5, `60 m/s shard also held (max x ${w2.toFixed(3)})`);
}

// ---- 3. after the old 4 s cutoff -----------------------------------------
{
  D.clear(); setWorld([{ minX: 2, maxX: 2.2, minZ: -5, maxZ: 5, y0: 0, y1: 3 }]);
  const b = body(0.3, 0, 0.4, 0); b.t = 5; b.v.set(9, 0, 0);
  let worst = -Infinity; run(b, 2, (bb) => { worst = Math.max(worst, bb.mesh.position.x); });
  ok(worst < 2, `a piece at t=5 s still stops at the wall (max x ${worst.toFixed(3)})`);
}

// ---- 4. lands ON a roof collider -----------------------------------------
{
  D.clear(); setWorld([{ minX: -2, maxX: 2, minZ: -2, maxZ: 2, y0: 0, y1: 4 }]);
  const b = body(0.4, 0.3, 9, 0.2); b.v.set(0, -30, 0);
  let low = Infinity; run(b, 4, (bb) => { low = Math.min(low, bb.mesh.position.y); });
  ok(low > 4 && b.mesh.position.y > 4, `a piece dropped at 30 m/s rests on the 4 m roof (lowest centre y ${low.toFixed(3)})`);
}

// ---- 5. diagonal wall -----------------------------------------------------
{
  D.clear();
  const ori = CBZ.orientedCollider(10, 0, 3, 0.1, 0.6, 0, 3);
  setWorld([ori]);
  const nx = Math.sin(0.6), nz = Math.cos(0.6);
  const b = body(0.25, 10 - nx * 2, 1, -nz * 2); b.v.set(nx * 40, 0, nz * 40);
  let worst = -Infinity; run(b, 2, (bb) => { const p = bb.mesh.position; worst = Math.max(worst, (p.x - 10) * nx + p.z * nz); });
  ok(worst < -0.1, `40 m/s piece into a diagonal wall stays on its side (max signed d ${worst.toFixed(3)})`);
}

// ---- 6. sleep --------------------------------------------------------------
{
  D.clear(); setWorld([]);
  const b = body(0.4, 0, 0.2, 0);                      // lying on the floor
  D.update(1 / 60);
  if (!b.frozen) {
    b.v.set(0.05, 0, 0); b.w.set(0, 0.7, 0); b.calm = 0.29; b.quiet = 0;
    D.update(1 / 60);
    ok(b.asleep === true && D.stats().asleep === 1, `a calm piece (spinning 0.7 rad/s on the floor) goes to sleep (asleep ${b.asleep})`);
    const before = b.mesh.position.clone();
    D.update(1 / 60); D.update(1 / 60);
    ok(b.mesh.position.distanceTo(before) === 0, "a sleeper is not integrated");
    D.impulse(b.mesh.position.x - 1, b.mesh.position.y, b.mesh.position.z, 4, 8);
    ok(!b.asleep && b.v.length() > 1, `a blast impulse wakes it and throws it (v ${b.v.length().toFixed(2)} m/s)`);
    // sleep again, then bake
    run(b, 4);
    ok(b.frozen === true, "a woken piece settles and bakes into rubble");
  } else ok(false, "sleep test piece froze before it could be tested");
  // support removed
  D.clear();
  const roof = { minX: -2, maxX: 2, minZ: -2, maxZ: 2, y0: 0, y1: 2 };
  setWorld([roof]);
  const s = body(0.4, 0, 2.3, 0);
  for (let i = 0; i < 20 && !s.frozen; i++) D.update(1 / 60);
  I.sleepBody(s);
  setWorld([]);                                        // the roof goes
  for (let i = 0; i < 12; i++) D.update(1 / 60);
  ok(!s.frozen && (!s.asleep || s.mesh.position.y < 2.1), `a sleeper whose roof is removed wakes and falls (asleep ${s.asleep}, y ${s.mesh.position.y.toFixed(2)})`);
  D.clear();
}

// ---- 7. human ragdoll thrown at a wall ------------------------------------
{
  const WX = 1.3;                                      // wall face
  let worstEnd = -Infinity, worstFly = -Infinity, bodies = 0, awake = 0;
  for (const mag of [34, 60, 90]) {
    for (const yaw of [0, 1.2, 2.6]) {
      v.clearActors();
      v.world({ colliders: [{ minX: WX, maxX: WX + 0.2, minZ: -6, maxZ: 6, y0: 0, y1: 3 }] });
      const a = v.actor({ x: 0, z: 0, yaw, name: "thrown" });
      CBZ.scene.add(a.group);                          // an unparented body is released as culled
      CBZ.cityPeds = [a];
      for (let i = 0; i < 4; i++) v.frame(1 / 60);
      a.dead = true;
      if (!CBZ.cityRagdoll(a, { x: -0.25, y: 1.1, z: 0 }, { x: 1, y: 0.15, z: 0 }, mag)) { ok(false, "cityRagdoll refused"); break; }
      bodies++;
      for (let t = 0; t < 6; t += 1 / 60) {
        v.frame(1 / 60);
        const P = CBZ.ragdollPoints(a);
        if (P) for (let i = 0; i < P.length; i += 3) worstFly = Math.max(worstFly, P[i]);
        if (t > 0.2 && CBZ.ragdollAudit().solving === 0) break;
      }
      const P = CBZ.ragdollPoints(a);
      if (P) for (let i = 0; i < P.length; i += 3) worstEnd = Math.max(worstEnd, P[i]);
      if (CBZ.ragdollAudit().solving) awake++;
      CBZ.ragdollDrop(a); CBZ.scene.remove(a.group);
    }
  }
  // AT BLAST SPEED: the kick API caps a throw near 9 m/s, so the fast case
  // is staged by hand — every point advanced 0.4 m past its verlet previous
  // (0.4 m a 1/120 s substep = 48 m/s), 1.5 m short of the wall.
  let fastFly = -Infinity, fastN = 0;
  for (const yaw of [0, 1.2, 2.6]) {
    v.clearActors();
    const FX = 3;
    v.world({ colliders: [{ minX: FX, maxX: FX + 0.2, minZ: -6, maxZ: 6, y0: 0, y1: 3 }] });
    const a = v.actor({ x: 0, z: 0, yaw, name: "hurled" });
    CBZ.scene.add(a.group); CBZ.cityPeds = [a];
    for (let i = 0; i < 4; i++) v.frame(1 / 60);
    a.dead = true;
    if (!CBZ.cityRagdoll(a, { x: -0.25, y: 1.1, z: 0 }, { x: 1, y: 0.1, z: 0 }, 34)) continue;
    v.frame(1 / 60);
    const P0 = CBZ.ragdollPoints(a);
    let mx = -Infinity; for (let i = 0; i < P0.length; i += 3) mx = Math.max(mx, P0[i]);
    const shift = FX - 1.5 - mx;
    for (let i = 0; i < P0.length; i += 3) P0[i] += shift + 0.4;   // q stays behind: +0.4 m/substep
    fastN++;
    for (let t = 0; t < 4; t += 1 / 60) {
      v.frame(1 / 60);
      const P = CBZ.ragdollPoints(a); if (!P) break;
      for (let i = 0; i < P.length; i += 3) fastFly = Math.max(fastFly, P[i]);
      if (t > 0.2 && CBZ.ragdollAudit().solving === 0) break;
    }
    CBZ.ragdollDrop(a); CBZ.scene.remove(a.group);
  }
  ok(fastN > 0 && fastFly < 3, `${fastN} bodies hurled at ~48 m/s into a 0.2 m wall: no point crosses its face (max x ${fastFly.toFixed(3)}, wall 3.0)`);
  ok(bodies > 0 && worstFly < WX + 0.1, `${bodies} bodies thrown (kick 34/60/90) at a 0.2 m wall: no point ever past its middle (max x in flight ${worstFly.toFixed(3)}, wall ${WX}-${WX + 0.2})`);
  ok(worstEnd < WX, `...and every body comes to rest on the near side (max x at rest ${worstEnd.toFixed(3)})`);
  ok(awake === 0, `...and every body against the wall goes to sleep within 6 s (${awake} still solving)`);
}

if (v.errors.length) { console.log("vm errors:"); for (const e of v.errors.slice(0, 5)) console.log("  " + e.split("\n")[0]); }
console.log(`\n${checks - fails}/${checks} ok`);
process.exit(fails ? 1 : 0);
