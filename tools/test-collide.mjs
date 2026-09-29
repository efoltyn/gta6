#!/usr/bin/env node
/* tools/test-collide.mjs — THE COLLISION CORE, IN NODE.
   Loads the REAL src/systems/physics.js into a vm with a bare CBZ stub (no
   THREE, no world) and asserts the resolver contract on hand-built boxes:

     1. corner wedge      a body jammed into an inside corner comes out of
                          BOTH walls in one CBZ.collide call
     2. acute wedge       two walls meeting at 30 deg: out of both
     3. OBB push          an oriented (45 deg) wall pushes along its own
                          normal, and the AABB-only corner is NOT solid
     4. centre inside     a centre inside a box exits the nearest face
     5. band gating       a body over / under a banded box is not pushed;
                          one inside the band is
     6. big radius        a 1.3 m hull next to a wall in the NEXT grid cell
                          is still pushed (the old one-bucket gather missed it)
     7. sweepCircle       a 30 m/s circle stops before a 0.2 m wall (one
                          0.1 s frame = 3 m step), OBB too, corner circle
     8. rayColliders      hits an OBB at the right t, skips a band miss,
                          nearest-of-many across grid cells, any/inside/minT
     9. colliderRayT2     the per-box 2-D primitive
    10. perf              open-air + one-wall resolves stay cheap

     node tools/test-collide.mjs          exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const noop = () => {};
const CBZ = {
  colliders: [], platforms: [], TUNE: {}, CONFIG: {}, keys: {},
  player: { pos: { x: 0, y: 0, z: 0 }, radius: 0.38 }, playerChar: {},
  lerpAngle: (a) => a, animChar: noop, onUpdate: noop,
  game: { mode: "escape" },
};
const ctx = vm.createContext({ window: { CBZ }, console, Math, performance: { now: () => Date.now() } });
ctx.window.window = ctx.window;
vm.runInContext(readFileSync(new URL("src/systems/physics.js", ROOT), "utf8"), ctx, { filename: "src/systems/physics.js" });

let fails = 0, passes = 0;
function check(ok, name, detail) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
}
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
function world(list) {
  CBZ.colliders.length = 0;
  for (const c of list) CBZ.colliders.push(c);
  CBZ.markCollidersDirty();
}
const box = (minX, maxX, minZ, maxZ, y0, y1) => (y0 == null ? { minX, maxX, minZ, maxZ } : { minX, maxX, minZ, maxZ, y0, y1 });
// signed-ish clearance of a circle from a collider (>= r - eps means clear)
function dist(px, pz, c) {
  if (c.yaw) {
    const co = Math.cos(c.yaw), si = Math.sin(c.yaw), rx = px - c.cx, rz = pz - c.cz;
    const lx = rx * co - rz * si, lz = rx * si + rz * co;
    return Math.hypot(Math.max(Math.abs(lx) - c.hw, 0), Math.max(Math.abs(lz) - c.hd, 0));
  }
  return Math.hypot(Math.max(c.minX - px, 0, px - c.maxX), Math.max(c.minZ - pz, 0, pz - c.maxZ));
}

// ---- 1. corner wedge: walls along x=0 (west) and z=0 (south), body at the corner
{
  const W = box(-1, 0, -5, 5), S = box(-5, 5, -1, 0);
  // listed S first: the old single pass resolved S, then W, in array order
  world([S, W]);
  const p = { x: 0.2, z: 0.1 };
  const moved = CBZ.collide(p, 0.5);
  check(moved === true && dist(p.x, p.z, W) >= 0.4999 && dist(p.x, p.z, S) >= 0.4999,
    "corner wedge resolves out of both walls", `-> (${p.x.toFixed(3)}, ${p.z.toFixed(3)})`);
}
// ---- 2. acute wedge: a wall along z=0 and one leaning at 30 deg over it
{
  const S = box(-6, 6, -1, 0);
  const yaw = -Math.PI / 6;                       // local +x runs 30 deg up from world +x
  const hw = 4, hd = 0.2;
  const co = Math.cos(yaw), si = Math.sin(yaw);
  // place the leaning wall so its lower-left end sits on the origin
  const lx = hw, lz = hd;                          // local offset from centre to that end is (-hw,-hd)
  const cx = lx * co + lz * si, cz = -lx * si + lz * co;
  const L = CBZ.orientedCollider(cx, cz, hw, hd, yaw);
  world([S, L]);
  const p = { x: 1.2, z: 0.3 };
  CBZ.collide(p, 0.4);
  const ok = dist(p.x, p.z, S) >= 0.3999 && dist(p.x, p.z, L) >= 0.3999;
  check(ok, "acute 30deg wedge resolves out of both walls", `-> (${p.x.toFixed(3)}, ${p.z.toFixed(3)}) dS=${dist(p.x, p.z, S).toFixed(3)} dL=${dist(p.x, p.z, L).toFixed(3)}`);
}
// ---- 3. OBB push
{
  const c = CBZ.orientedCollider(0, 0, 3, 0.1, Math.PI / 4);
  check(!!c.yaw, "orientedCollider keeps the yaw on a diagonal wall");
  world([c]);
  // local +z (the wall normal) in world = (sin, cos) of yaw
  const nx = Math.sin(Math.PI / 4), nz = Math.cos(Math.PI / 4);
  const p = { x: nx * 0.3, z: nz * 0.3 };
  CBZ.collide(p, 0.5);
  const d = p.x * nx + p.z * nz;
  check(near(d, 0.6, 1e-3) && near(p.x * nz - p.z * nx, 0, 1e-6), "OBB pushes along its own normal to r + half-thickness", `n-dist=${d.toFixed(4)}`);
  // a point inside the AABB but 1.5 m clear of the thin wall body: no push
  const q = { x: 2.0, z: -0.3 };
  const before = { ...q };
  check(dist(q.x, q.z, c) > 0.6 && !CBZ.collide(q, 0.5) && q.x === before.x && q.z === before.z, "OBB: its AABB corner is not solid");
}
// ---- 4. centre inside a box: exit through the nearest face
{
  const c = box(0, 4, 0, 1);
  world([c]);
  const p = { x: 1.0, z: 0.8 };                   // 0.2 from the +z face
  CBZ.collide(p, 0.5);
  check(near(p.x, 1.0) && near(p.z, 1.5), "centre inside exits the min-penetration face", `-> (${p.x}, ${p.z})`);
}
// ---- 5. band gating
{
  const c = box(0, 2, 0, 2, 0.0, 0.9);            // a table
  world([c]);
  const over = { x: 1, z: 2.2 };
  CBZ.collide(over, 0.5, 1.0, 2.7);               // standing on top of it
  const under = { x: 1, z: 2.2 };
  const hi = box(0, 2, 0, 2, 2.5, 3.0);           // an awning
  const inBand = { x: 1, z: 2.2 };
  CBZ.collide(inBand, 0.5, 0.42, 1.7);
  world([hi]);
  CBZ.collide(under, 0.5, 0.42, 1.7);
  const full = { x: 1, z: 2.2 };
  world([c]);
  CBZ.collide(full, 0.5);                          // no band args: full height
  check(over.z === 2.2, "band: a body above the box is not pushed");
  check(under.z === 2.2, "band: a body below the box is not pushed");
  check(near(inBand.z, 2.5), "band: a body inside the band is pushed", `z=${inBand.z}`);
  check(near(full.z, 2.5), "band: no feet/head args = full-height (legacy contract)");
}
// ---- 6. big radius near a cell edge (cells are 8 m; pad 1.0)
{
  // wall occupies x in [8.0, 8.3] -> filed in cells gx=0 (8.0-1 = 7.0 >= 0) ... make it further:
  // body at x=6.9 (cell 0), wall face at 8.05: 1.15 m away, inside a 1.3 m hull.
  // wall filed from floor((8.05-1)/8)=0 .. ok that is still cell 0; push the body to cell -1:
  const c = box(0.2, 0.5, -3, 3);                 // filed from floor(-0.8/8) = -1 .. 0
  const c2 = box(-9.5, -9.2, -3, 3);              // filed from floor(-10.5/8) = -2 .. floor(-8.2/8) = -2
  world([c, c2]);
  const p = { x: -8.0 + 1.25 - 0.1 - 1.0, z: 0 };  // x = -7.85, cell -1; c2 face at -9.2 is 1.35 away -> clear
  const q = { x: -8.05, z: 0 };                    // cell -2 ... face of c2 at -9.2: 1.15 away -> must push
  const r = { x: -1.05, z: 0 };                    // cell -1; c face at 0.2: 1.25 away
  CBZ.collide(p, 1.3); CBZ.collide(q, 1.3); CBZ.collide(r, 1.3);
  check(near(q.x, -9.2 + 1.3), "big radius: hull pushed by a wall filed only in its own cell", `x=${q.x}`);
  const s = { x: -7.95, z: 0 };                    // cell -1; c2 (cell -2 only) face 1.25 away
  CBZ.collide(s, 1.3);
  check(near(s.x, -9.2 + 1.3), "big radius: hull pushed by a wall filed only in the NEXT cell", `x=${s.x}`);
  check(near(r.x, 0.2 - 1.3), "big radius: straight push", `x=${r.x}`);
}
// ---- 7. sweepCircle
{
  const wall = box(1.5, 1.7, -5, 5);
  world([wall]);
  const out = {};
  const hit = CBZ.sweepCircle({ x: 0, z: 0 }, { x: 3, z: 0 }, 0.3, undefined, undefined, out);   // 30 m/s x 0.1 s
  check(hit && near(out.t, 0.4) && out.x < 1.2 && out.x > 1.17 && out.nx === -1 && out.c === wall,
    "sweep: 30 m/s circle stops before a 0.2 m wall", `t=${out.t} x=${out.x}`);
  // static collide alone WOULD have tunnelled: end point is past the wall middle
  const p = { x: 3, z: 0 }; CBZ.collide(p, 0.3);
  check(p.x === 3, "sweep premise: the position resolver alone lets that step through");
  // leaving a wall you touch is not a hit; driving into it is t=0
  const leave = CBZ.sweepCircle({ x: 1.25, z: 0 }, { x: -1, z: 0 }, 0.3, undefined, undefined, out);
  check(!leave, "sweep: a body leaving a wall it touches is free");
  const into = CBZ.sweepCircle({ x: 1.25, z: 0 }, { x: 4, z: 0 }, 0.3, undefined, undefined, out);
  check(into && out.t === 0, "sweep: a body already touching and driving in is stopped at t=0");
  // miss past the end of the wall
  check(!CBZ.sweepCircle({ x: 0, z: 5.4 }, { x: 3, z: 5.4 }, 0.3, undefined, undefined, out), "sweep: path clear of the wall end misses");
  // rounded corner: path grazes the corner circle
  const hitC = CBZ.sweepCircle({ x: 1.6, z: 7 }, { x: 1.6 + 0.0, z: 3 }, 0.3, undefined, undefined, out);
  check(hitC && near(out.t, (7 - 5.3) / 4, 1e-6) && near(out.nz, 1), "sweep: head-on into the wall end", `t=${out.t}`);
  const hitK = CBZ.sweepCircle({ x: 1.9, z: 7 }, { x: 1.9, z: 3 }, 0.3, undefined, undefined, out);
  // corner (1.7, 5): contact where dz^2 + 0.2^2 = 0.09 -> dz = sqrt(0.05)
  check(hitK && near(out.z, 5 + Math.sqrt(0.05) + 0.01, 1e-3), "sweep: rounded corner meets the corner circle exactly", `z=${out.z}`);
  // band: a sweep over a low wall
  world([box(1.5, 1.7, -5, 5, 0, 0.5)]);
  check(!CBZ.sweepCircle({ x: 0, z: 0 }, { x: 3, z: 0 }, 0.3, 0.8, 2.5, out), "sweep: band gate (body above the wall)");
  // oriented thin wall at 45 deg
  const o = CBZ.orientedCollider(2, 0, 3, 0.1, Math.PI / 4);
  world([o]);
  const hitO = CBZ.sweepCircle({ x: 0, z: 0 }, { x: 4, z: 0 }, 0.3, undefined, undefined, out);
  const d = dist(out.x, out.z, o);
  check(hitO && d > 0.299 && d < 0.32, "sweep: stops before a 45deg OBB", `clear=${d.toFixed(4)}`);
}
// ---- 8. rayColliders
{
  const o = CBZ.orientedCollider(5, 0, 2, 0.25, Math.PI / 4, 0, 3);
  const low = box(2, 2.5, -1, 1, 0, 0.5);          // a kerb the ray passes over
  const far = box(30, 31, -2, 2);                  // across several grid cells
  world([low, o, far]);
  const out = {};
  const hit = CBZ.rayColliders(0, 1, 0, 1, 0, 0, 100, out);
  // entry: the local z-face at hd=0.25; along world +x the local z rate is sin(yaw)
  const tExp = 5 - 0.25 / Math.sin(Math.PI / 4);
  check(hit === o && near(out.t, tExp, 1e-6), "ray: hits the OBB at the right t (and skips the band miss)", `t=${out.t.toFixed(5)} want ${tExp.toFixed(5)}`);
  check(near(out.nx, -Math.sin(Math.PI / 4), 1e-6) && near(out.nz, -Math.cos(Math.PI / 4), 1e-6), "ray: OBB normal in world", `n=(${out.nx.toFixed(3)},${out.nz.toFixed(3)})`);
  check(CBZ.rayColliders(0, 0.3, 0, 1, 0, 0, 100, out) === low && near(out.t, 2) && out.nx === -1, "ray: inside the band it hits the kerb");
  check(CBZ.rayColliders(0, 4, 0, 1, 0, 0, 100, out) === far && near(out.t, 30), "ray: above the band, the far box across cells");
  check(CBZ.rayColliders(0, 4, 0, 1, 0, 0, 20, out) === null && out.hit === false, "ray: maxT respected");
  check(CBZ.rayColliders(0, 4, 0, 1, 0, 0, 100, out, { skip: far }) === null, "ray: skip");
  check(CBZ.rayColliders(0, 1, 0, 1, 0, 0, 100, out, { filter: (c) => c !== o }) === far, "ray: filter");
  // descending ray lands on the kerb top
  const top = CBZ.rayColliders(2.25, 3, 0, 0, -1, 0, 10, out);
  check(top === low && near(out.t, 2.5) && out.ny === 1, "ray: vertical ray hits a banded top (ny=+1)");
  // inside
  check(CBZ.rayColliders(30.5, 1, 0, 1, 0, 0, 100, out) === null, "ray: a box containing the origin is skipped by default");
  check(CBZ.rayColliders(30.5, 1, 0, 1, 0, 0, 100, out, { inside: true }) === far && out.t === 0, "ray: inside:true counts it at t=0");
  check(CBZ.rayColliders(0, 0.3, 0, 1, 0, 0, 100, out, { minT: 2.5 }) === o, "ray: minT ignores a nearer box");
  // segment form, diagonal, negative direction, crossing cell corners
  world([box(-20.2, -19.8, -30, 30)]);
  const seg = CBZ.rayColliders(-2, 1, 3, -30, 0, -10, 1, out);
  check(seg && near(out.x, -19.8, 1e-9), "ray: segment form (d = b - a, maxT 1), negative diagonal", `x=${out.x}`);
  // any: first hit
  world([box(5, 6, -1, 1), box(2, 3, -1, 1)]);
  check(!!CBZ.rayColliders(0, 1, 0, 1, 0, 0, 100, out, { any: true }), "ray: any");
  check(CBZ.rayColliders(0, 1, 0, 1, 0, 0, 100, out) === CBZ.colliders[1], "ray: nearest wins within one cell regardless of order");
  // city gate
  world([Object.assign(box(2, 3, -1, 1), { _city: true })]);
  check(CBZ.rayColliders(0, 1, 0, 1, 0, 0, 100, out) === null, "ray: city-stamped boxes are skipped out of city mode");
  CBZ.game.mode = "city";
  check(!!CBZ.rayColliders(0, 1, 0, 1, 0, 0, 100, out), "ray: ...and hit in city mode");
  CBZ.game.mode = "escape";
}
// ---- 9. colliderRayT2
{
  const c = box(2, 3, -1, 1);
  check(near(CBZ.colliderRayT2(c, 0, 0, 1, 0), 2) && CBZ.colliderRayT2(c, 0, 0, 1, 0, 0, 1.5) === -1 && CBZ.colliderRayT2(c, 2.5, 0, 1, 0) === 0 && near(CBZ.colliderRayT2(c, 0, 0, 1, 0, 0.5), 1.5),
    "colliderRayT2: entry / maxT / inside / pad");
  const o = CBZ.orientedCollider(5, 0, 2, 0.25, Math.PI / 4);
  check(near(CBZ.colliderRayT2(o, 0, 0, 1, 0), 5 - 0.25 / Math.sin(Math.PI / 4), 1e-9), "colliderRayT2: oriented");
}
// ---- 10. perf: 200 boxes in one cell, open air and one-wall bodies
{
  const list = [];
  for (let i = 0; i < 200; i++) list.push(box((i % 20) * 0.35 + 0.5, (i % 20) * 0.35 + 0.6, Math.floor(i / 20) * 0.7 + 0.2, Math.floor(i / 20) * 0.7 + 0.3));
  world(list);
  const N = 200000, p = { x: 0, z: 0 };
  let t = performance.now();
  for (let i = 0; i < N; i++) { p.x = 0.05; p.z = 7.9; CBZ.collide(p, 0.38); }
  const open = (performance.now() - t) / N * 1e6;
  t = performance.now();
  for (let i = 0; i < N; i++) { p.x = 0.62; p.z = 0.1; CBZ.collide(p, 0.38); }
  const one = (performance.now() - t) / N * 1e6;
  console.log(`      perf: open-air ${open.toFixed(0)} ns/call, touching ${one.toFixed(0)} ns/call (200-box bucket)`);
  check(open < 20000 && one < 40000, "perf: resolves stay cheap");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
