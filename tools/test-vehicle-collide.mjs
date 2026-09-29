#!/usr/bin/env node
/* tools/test-vehicle-collide.mjs — THE CAR IS A BOX, AND IT DOES NOT TUNNEL.

   Loads the pure VEHCOL section of src/city/vehicles.js (between the
   ==VEHCOL:BEGIN== / ==VEHCOL:END== markers: SAT, contact point, deepest-
   first resolve, continuous sweep, wall impulse) in a node vm and drives
   it with hand-built colliders in the exact record shapes CBZ.colliders
   holds ({minX,maxX,minZ,maxZ[,y0,y1]} and the oriented {cx,cz,hw,hd,yaw}).

   Asserted:
     1. a 16 m truck running flush along a wall (and along a wall chopped
        into 2 m facade segments) keeps every metre of its step: no phantom stop
     2. a diagonal corner hit reads the WALL's normal, the contact lands at
        the struck corner, and the impulse yaws the car the right way
     3. 60 m/s at 10 fps (6 m a step) into a 0.3 m wall, forward and sliding
        sideways into a 0.3 m bollard: never through
     4. a 10-degree glancing hit keeps its speed along the wall
     5. band gating: an overpass deck over the road does not stop a car, a
        kerb still does
     6. a car already half through a thin wall goes back the way it came
     7. OBB-vs-OBB (car vs car) finds the true flank overlap, not the
        centre-line guess
     8. oriented colliders (a diagonal chord) resolve on their own normal

   Usage: node tools/test-vehicle-collide.mjs      Exit 0 = ok.            */
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = await readFile(path.join(ROOT, "src/city/vehicles.js"), "utf8");
const a = src.indexOf("/* ==VEHCOL:BEGIN==");
const b = src.indexOf("/* ==VEHCOL:END== */");
if (a < 0 || b < 0) { console.error("VEHCOL markers not found"); process.exit(1); }
const sandbox = { CBZ: {} };
vm.createContext(sandbox);
vm.runInContext('"use strict";' + src.slice(a, b), sandbox, { filename: "vehicles.js#VEHCOL" });
const VC = sandbox.CBZ._vehCol;

let fails = 0, passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; console.log("  ok   " + msg); }
  else { fails++; console.log("  FAIL " + msg); }
}
const near = (x, y, eps = 1e-3) => Math.abs(x - y) <= eps;
const aabb = (minX, maxX, minZ, maxZ, y0, y1) => (y0 == null ? { minX, maxX, minZ, maxZ } : { minX, maxX, minZ, maxZ, y0, y1 });
function obb(cx, cz, hw, hd, yaw) {
  // conservative outer AABB the same way physics.js keeps it on the record
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const ex = Math.abs(c) * hw + Math.abs(s) * hd, ez = Math.abs(s) * hw + Math.abs(c) * hd;
  return { cx, cz, hw, hd, yaw, minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez };
}
const hitRec = () => ({ count: 0, nx: 0, nz: 0, px: 0, pz: 0, pen: 0, col: null });
// one frame of collideVehicle: body integrated to (x1,z1), anchored at (x0,z0)
function step(car, x0, z0, x1, z1, cols, hit) {
  const A = VC.setCarBox(VC.box(), x1, z1, car.h, car.hw, car.hl);
  VC.move(A, true, x0, z0, cols, cols.length, hit || hitRec(), true);
  return A;
}

// ---- 1. TRUCK FLUSH ALONG A WALL --------------------------------------
console.log("1. long truck parallel to a wall");
{
  const truck = { h: 0, hw: 1.3, hl: 8 };                 // heading +z, 2.6 x 16 m
  const wall = aabb(1.32, 1.8, -100, 100);               // face 2 cm off the flank
  let z = 0, hit = hitRec();
  let touched = 0;
  for (let i = 0; i < 20; i++) { const A = step(truck, 0, z, 0, z + 3, [wall], hit); z = A.cz; touched += hit.count; }
  ok(touched === 0, "flank 2 cm clear: no contact in 20 steps");
  ok(near(z, 60), "20 steps of 3 m along a wall 2 cm off the flank: travelled 60 m (got " + z.toFixed(3) + ")");
  // flank 5 cm INTO a wall chopped into 2 m facade segments, rolling along it
  const segs = [];
  for (let s = -40; s < 80; s += 2) segs.push(aabb(1.25, 1.8, s, s + 2));
  let x = 0; z = 0;
  for (let i = 0; i < 20; i++) { hit = hitRec(); const A = step(truck, x, z, x, z + 3, segs, hit); x = A.cx; z = A.cz; }
  ok(near(z, 60, 1e-6), "segmented facade, flank rubbing: all 60 m kept (got " + z.toFixed(4) + ")");
  ok(x < -0.049 && x > -0.06, "pushed out along the wall normal only (x " + x.toFixed(4) + ")");
  // the old circle model: a 1.6 m disc — the rear 6 m of the truck was not solid
  const tail = aabb(-0.5, 0.5, -7.5, -6.5);              // a bollard under the trailer's tail
  const A = VC.setCarBox(VC.box(), 0, 0, 0, 1.3, 8);
  const h = hitRec();
  VC.resolve(A, [tail], 1, false, 0, 0, h, 4);
  ok(h.count > 0, "a bollard under the trailer's tail is IN the truck (circle model missed it)");
  ok(h.pz < -6 && h.pz > -8, "contact reported at the tail (pz " + h.pz.toFixed(2) + ")");
}

// ---- 2. DIAGONAL CORNER HIT -------------------------------------------
console.log("2. diagonal corner hit");
{
  const wall = aabb(-50, 50, 3.0, 3.5);                  // face at z = 3
  const h = Math.PI / 4, car = { h, hw: 1, hl: 2.2 };
  // car centre such that its front-most corner pokes 0.2 m past z = 3
  const A0 = VC.setCarBox(VC.box(), 0, 0, h, 1, 2.2);
  const reachZ = VC.radiusOn(A0, 0, 1);
  const hit = hitRec();
  const A = step(car, 0, 3 - reachZ - 0.8, 0, 3 - reachZ + 0.2, [wall], hit);
  ok(hit.count > 0, "corner contact detected");
  ok(near(hit.nx, 0, 1e-9) && near(hit.nz, -1, 1e-9), "normal is the wall's own face normal (" + hit.nx.toFixed(3) + "," + hit.nz.toFixed(3) + ")");
  ok(near(A.cz + reachZ, 3, 0.01), "corner stopped at the face (front z " + (A.cz + reachZ).toFixed(3) + ")");
  // heading 45: forward (0.707,0.707), right (0.707,-0.707): the most +z corner is front-LEFT
  const fl = { x: A.cx + A.fx * 2.2 - A.ux * 1, z: A.cz + A.fz * 2.2 - A.uz * 1 };
  ok(Math.hypot(hit.px - fl.x, hit.pz - fl.z) < 0.05, "contact point is the front-left corner");
  const imp = VC.impulse(Math.sin(h) * 20, Math.cos(h) * 20, 0, hit.px - A.cx, hit.pz - A.cz, hit.nx, hit.nz, 1, 2.2, 0.15, 0.3, {});
  ok(imp.vn > 14 && imp.vn < 14.2, "speed into the wall = 20 cos45 = 14.1 (" + imp.vn.toFixed(2) + ")");
  // the leading corner is stopped, the body carries on: the car swings round to
  // lie ALONG the wall (heading 45 -> 90, the +x tangent), i.e. w > 0
  ok(imp.w > 0.5, "the corner clip yaws the car toward the wall's tangent (w " + imp.w.toFixed(2) + " rad/s)");
  const sq = VC.impulse(0, 20, 0, 0, 2.2, 0, -1, 1, 2.2, 0.15, 0.3, {});
  ok(Math.abs(sq.w) < 1e-9, "a square hit on the bumper centre does not spin");
  ok(imp.vz < 0.2 * 14.2 && imp.vz > 0, "normal speed reversed small (vz " + imp.vz.toFixed(2) + ")");
  // the old phantom: nose disc 0.75 r at 0.8 m ahead snagged a corner the BODY cleared
  const post = aabb(1.55, 1.95, 2.4, 2.8);               // just off the right flank of a car heading +z
  const B = VC.setCarBox(VC.box(), 0, 0, 0, 1, 2.2);
  ok(VC.resolve(B, [post], 1, false, 0, 0, null, 4) === 0, "a post 0.5 m off the front-right corner does not stop the body");
}

// ---- 3. NO TUNNELLING -------------------------------------------------
console.log("3. 60 m/s, 10 fps, thin things");
{
  const car = { h: 0, hw: 1, hl: 2.2 };
  const wall = aabb(-20, 20, 10, 10.3);                  // 0.3 m wall across the road
  const z0 = 10 - 2.2 - 3;                               // nose 3 m short of it
  const hit = hitRec();
  const A = step(car, 0, z0, 0, z0 + 6, [wall], hit);     // endpoint: nose 3 m past it, tail past it too? no: tail at +0.8
  ok(A.cz + 2.2 <= 10 + 1e-3, "forward at 6 m/step: stopped at the wall (nose z " + (A.cz + 2.2).toFixed(3) + ")");
  ok(hit.count > 0 && near(hit.nz, -1, 1e-9), "reported as a head-on (n " + hit.nz + ")");
  // a step so long the WHOLE body lands clear past the wall — both ends outside
  const h2 = hitRec(), A2 = step(car, 0, z0, 0, z0 + 12, [wall], h2);
  ok(A2.cz + 2.2 <= 10 + 1e-3, "12 m step, both ends clear of the wall: still stopped (nose " + (A2.cz + 2.2).toFixed(3) + ")");
  // sliding SIDEWAYS (a drift) at 60 m/s into a 0.3 m bollard
  const bol = aabb(5, 5.3, -0.15, 0.15);
  const h3 = hitRec(), A3 = step(car, 5 - 1 - 2.9, 0, 5 - 1 + 3.1, 0, [bol], h3);
  ok(A3.cx + 1 <= 5 + 1e-3, "sideways 6 m/step into a 0.3 m bollard: stopped at it (flank x " + (A3.cx + 1).toFixed(3) + ")");
  // the oriented guardrail at 30 deg, 0.25 m thick
  const rail = obb(0, 12, 10, 0.125, Math.PI / 6);
  const h4 = hitRec(), A4 = step(car, 0, 0, 0, 20, [rail], h4);
  const Bx = VC.setColliderBox(VC.box(), rail);
  ok(VC.sat(A4, Bx, false, 0, 0, {}) <= 0 && A4.cz < 12, "20 m step into a diagonal 0.25 m rail: on the near side, not in it (z " + A4.cz.toFixed(2) + ")");
  // a legit long step with nothing in the way is untouched
  const A5 = step(car, 0, -100, 0, -94, [wall], hitRec());
  ok(near(A5.cz, -94, 1e-9), "clear road at 6 m/step: untouched");
}

// ---- 4. GLANCING HIT KEEPS ITS SPEED ----------------------------------
console.log("4. glancing hit");
{
  const wall = aabb(2.0, 3.0, -100, 100);                // face at x = 2
  const ang = 10 * Math.PI / 180, car = { h: ang, hw: 1, hl: 2.2 };
  const A0 = VC.setCarBox(VC.box(), 0, 0, ang, 1, 2.2);
  const rx = VC.radiusOn(A0, 1, 0);
  const hit = hitRec();
  const A = step(car, 2 - rx - 0.3, 0, 2 - rx + 0.2, 0 + 2.8, [wall], hit);
  ok(hit.count > 0 && near(hit.nx, -1, 1e-9), "wall normal (-1,0)");
  ok(A.cz > 2.79, "the step's along-wall travel is kept (z " + A.cz.toFixed(3) + " of 2.8)");
  const V = 30, vx = Math.sin(ang) * V, vz = Math.cos(ang) * V;
  const imp = VC.impulse(vx, vz, 0, hit.px - A.cx, hit.pz - A.cz, hit.nx, hit.nz, 1, 2.2, 0.15, 0.3, {});
  ok(imp.vz > 0.9 * vz, "along-wall speed kept > 90% (" + imp.vz.toFixed(2) + " of " + vz.toFixed(2) + ")");
  ok(imp.vx <= 0.2 * vx + 1e-9 && imp.vx > -0.2 * vx, "into-wall speed gone, small bounce (vx " + imp.vx.toFixed(2) + ")");
  const sep = VC.impulse(-5, 30, 0, 0, 2, -1, 0, 1, 2.2, 0.15, 0.3, {});
  ok(sep.vn === 0 && sep.vx === -5, "a car already leaving the wall gets no impulse");
}

// ---- 5. BAND GATING ----------------------------------------------------
console.log("5. overpass band");
{
  const feet = -0.9, head = 1.5 + 0.15;                 // wallSpan for a 1.5 m car at y 0
  const deck = aabb(-6, 6, -30, 30, 5.2, 6.4);
  const pier = aabb(-6, -4.5, -1, 1);                    // full-height pier beside the lane
  const kerb = aabb(-10, 10, 8, 8.3, 0, 0.22);
  ok(!VC.inBand(deck, feet, head), "deck at 5.2 m is above the roof: not a wall");
  ok(VC.inBand(pier, feet, head), "full-height pier: a wall");
  ok(VC.inBand(kerb, feet, head), "0.22 m kerb: still hit");
  const cols = [deck, pier].filter(c => VC.inBand(c, feet, head));
  const A = step({ h: 0, hw: 1, hl: 2.2 }, 0, -20, 0, -14, cols, hitRec());
  ok(near(A.cz, -14, 1e-9) && near(A.cx, 0, 1e-9), "driving under the deck: untouched");
  ok(VC.inBand(deck, 4.5, 7.2), "a car ON the upper level (feet 4.5) meets the deck band");
}

// ---- 6. HALF THROUGH GOES BACK -----------------------------------------
console.log("6. ref side");
{
  const wall = aabb(-20, 20, 0, 0.3);
  const A = VC.setCarBox(VC.box(), 0, 0.5, 0, 1, 2.2);    // centre PAST the wall (nose 2.7 m through)
  VC.resolve(A, [wall], 1, true, 0, -3, null, 4);         // came from z = -3
  ok(A.cz + 2.2 <= 1e-3, "sent back to the side it came from (nose z " + (A.cz + 2.2).toFixed(3) + ")");
  const B = VC.setCarBox(VC.box(), 0, 0.5, 0, 1, 2.2);
  VC.resolve(B, [wall], 1, false, 0, 0, null, 4);
  ok(B.cz - 2.2 >= 0.3 - 1e-3, "(control: with no history it takes the shortest exit, out the far side)");
}

// ---- 7. CAR vs CAR -----------------------------------------------------
console.log("7. OBB vs OBB");
{
  const A = VC.setCarBox(VC.box(), 0, 0, 0, 1, 2.3);
  const B = VC.setCarBox(VC.box(), 1.8, 1.0, 0, 1, 2.3);   // side-by-side, 0.2 m overlap, offset along
  const s = {};
  const pen = VC.sat(A, B, false, 0, 0, s);
  ok(near(pen, 0.2, 1e-9) && near(s.nx, -1, 1e-9), "flank overlap 0.2 m on the side axis (got " + pen.toFixed(3) + ", n " + s.nx + ")");
  // the old centre-line support guess on the same pair
  const dx = 1.8, dz = 1.0, d = Math.hypot(dx, dz), nx = dx / d, nz = dz / d;
  const sup = (n1, n2) => Math.abs(n2) * 2.3 + Math.abs(n1) * 1;
  const old = 2 * sup(nx, nz) - d;
  ok(old > pen + 0.5, "(the old centre-line estimate called it " + old.toFixed(2) + " m deep)");
  const C = VC.setCarBox(VC.box(), 2.3, 0, Math.PI / 2, 1, 2.3); // a T-bone: C's nose 0 m into A's flank... move in
  C.cx = 2.0 + 0.3 - 0.1 + 1;                                  // nose 0.1 m into A's right flank
  const s2 = {};
  const p2 = VC.sat(A, C, false, 0, 0, s2);
  ok(p2 > 0 && Math.abs(s2.nx) > 0.99, "T-bone reads a side-on normal (pen " + p2.toFixed(3) + ")");
  const far = VC.setCarBox(VC.box(), 2.2, 4.8, 0.3, 1, 2.3);
  ok(VC.sat(A, far, false, 0, 0, {}) <= 0, "clear pair: separated");
}

// ---- 8. ORIENTED COLLIDER ----------------------------------------------
console.log("8. oriented chord");
{
  const yaw = Math.PI / 4;
  const chord = obb(0, 0, 3, 0.12, yaw);                 // 6 m chord, 0.24 m thick, at 45 deg
  // its AABB is ~4.4 m square; a car at (1.9,1.9) sits inside that AABB but clear of the chord
  const A = VC.setCarBox(VC.box(), 1.9, 1.9, 0, 1, 2.2);
  ok(VC.resolve(A, [chord], 1, false, 0, 0, null, 4) === 0, "no invisible wall off a diagonal chord's AABB");
  const Bc = VC.setCarBox(VC.box(), 0.8, -0.2, yaw, 1, 2.2);    // parallel to it, overlapping
  const h = hitRec();
  VC.resolve(Bc, [chord], 1, false, 0, 0, h, 4);
  // the chord's normal (its local +z) in world = (sin yaw, cos yaw)
  ok(h.count > 0 && Math.abs(Math.abs(h.nx * Math.sin(yaw) + h.nz * Math.cos(yaw)) - 1) < 1e-6, "pushed along the chord's own normal");
  const Bs = VC.setColliderBox(VC.box(), chord);
  ok(VC.sat(Bc, Bs, false, 0, 0, {}) <= 0, "and clear of it after");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
