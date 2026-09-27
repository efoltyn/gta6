#!/usr/bin/env node
/* tools/test-shark-hull-collide.mjs — DOES A SHARK GO THROUGH A BOAT.

   Runs the real src/world/hull_loft.js + src/world/sea_craft.js against the
   vendored three.r128 in a node vm. Each hull is a real lofted skin (the
   same stationsFromLines -> mesh path water_hulls.js builds with), flagged
   hullSurface, so sea_craft.js measures its collider off actual geometry.
   The shark is a group with a named *Hull trunk of its real length and girth.

   The body is driven the way wildlife_tame.js drives the ridden shark: a
   forward speed along a heading, re-accelerated toward the held speed every
   frame, then CBZ.marineHullContact, then W.v = what survives along the
   heading. Printed per case: the deepest penetration LEFT after resolution
   (target 0), where the body ended up, the rams, and what the boat did.

   Run:  node tools/test-shark-hull-collide.mjs
*/
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = vm.createContext({ console, Math, Number, Date, Array, Object, isFinite, Float32Array, Int32Array, Uint16Array, Uint32Array, Map, WeakMap, Set });
ctx.self = ctx; ctx.window = ctx; ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(ROOT, "src/vendor/three.r128.min.js"), "utf8"), ctx, { filename: "three.js" });
const THREE = ctx.THREE;
const CBZ = (ctx.CBZ = {});
const updaters = [];
CBZ.onUpdate = (order, fn) => updaters.push({ order, fn });
CBZ.scene = new THREE.Scene();
CBZ.game = { mode: "sharksim" };
vm.runInContext(fs.readFileSync(path.join(ROOT, "src/world/hull_loft.js"), "utf8"), ctx, { filename: "hull_loft.js" });

const LINES = {
  kayak: { loa: 4.2, beam: 0.72, draft: 0.12, freeboard: 0.28, roundBilge: true, n: 21, massT: 0.03 },
  dinghy: { loa: 4.5, beam: 2.0, draft: 0.4, freeboard: 0.55, n: 15, massT: 0.7 },
  boat: { loa: 6.2, beam: 2.1, draft: 0.5, freeboard: 0.7, n: 15, massT: 1.6 },
  cruiser: { loa: 14, beam: 4.2, draft: 1.1, freeboard: 1.3, n: 17, massT: 16 },
};
const SPECS = {};
for (const k in LINES) {
  const L = LINES[k];
  SPECS[k] = { loa: L.loa, beam: L.beam, draft: L.draft, massT: L.massT, freeboard: L.freeboard, cruiseMs: 5, rideAbove: 0.05,
    stab: { gm: 0.05 + L.beam * 0.2, phiV: 1, freeboard: L.freeboard, swampT: 10, crew: 1, seats: [] } };
}
const HL = CBZ.hullLoft;
CBZ.marineHulls = {
  get: (k) => (SPECS[k] ? { key: k } : null),
  spec: (k) => SPECS[k],
  specFor: (c) => c._hullSpec,
  feel: () => ({ marine: true }),
  build: (k) => {
    const g = new THREE.Group();
    const m = HL.mesh(HL.stationsFromLines(LINES[k]), new THREE.MeshBasicMaterial(), {});
    m.userData.hullSurface = true;
    g.add(m);
    return g;
  },
};
const SHARKS = {
  bull: { len: 2.4 }, white: { len: 6.0 }, meg: { len: 18 },
};
CBZ.marineBodyLen = (a) => a.len;
CBZ.marineGape = (a) => a.len * 0.22;
CBZ.marineTonnes = (a) => 0.014 * Math.pow(a.len, 2.8);
vm.runInContext(fs.readFileSync(path.join(ROOT, "src/world/sea_craft.js"), "utf8"), ctx, { filename: "sea_craft.js" });
const SC = CBZ.seaCraft;
const tick = updaters.find((u) => u.order === 37.9).fn;

function makeShark(id) {
  const len = SHARKS[id].len;
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(0.5, 12, 8);
  geo.scale(len, len * 0.19, len * 0.17);          // trunk: len long, ~0.18 len girth
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  m.name = "sharkHull";
  g.add(m);
  CBZ.scene.add(g);
  return { id, len, group: g, pos: g.position, species: { id, aquatic: true } };
}

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
const T = [0.05, 0.19, 0.35, 0.51, 0.67, 0.81, 0.95], PR = [0.28, 0.62, 0.92, 1.0, 0.9, 0.66, 0.52];
function residual(rec, a, B) {
  const S = SC.collider(rec);
  const cap = a._hullCap;
  const R = cap.R;
  _q.copy(rec.group.quaternion).invert();
  let worst = 0;
  const o = {};
  for (let i = 0; i < T.length; i++) {
    const s = cap.x0 + (cap.x1 - cap.x0) * T[i];
    _v.set(B.x + B.ax * s - rec.group.position.x, B.y + B.ay * s - rec.group.position.y, B.z + B.az * s - rec.group.position.z).applyQuaternion(_q);
    const d = SC.hullSdf(S, _v.x, _v.y, _v.z, o);
    worst = Math.max(worst, R * PR[i] - d);
  }
  return worst;
}

/* One run: a shark starting `start` m away on bearing `approach` (deg,
   relative to the hull's beam) at depth y, holding `speed`. */
function run(hull, sharkId, speed, approachDeg, yRel) {
  SC.reset();
  const rec = SC.spawn(hull, 0, 0, 0, { crew: 0 });
  rec.engineDead = true;           // drifting: only what we do to her moves her
  tick(1 / 60);                    // let her settle on the water first
  const a = makeShark(sharkId);
  const S = SC.collider(rec);
  const y = rec.group.position.y + yRel;   // depth is relative to where she floats
  const ap = (approachDeg * Math.PI) / 180;
  // heading in the animal convention (fwd = cos h, sin h). approach 0 =
  // broadside from starboard (+x world at heading 0), 90 = at the bow.
  const dirX = -Math.cos(ap), dirZ = -Math.sin(ap);
  const startD = S.R + a.len * 0.6 + 1;
  const B = { x: -dirX * startD, y, z: -dirZ * startD, ax: dirX, ay: 0, az: dirZ, vx: 0, vy: 0, vz: 0, skipHeadOf: null, ramOK: true };
  let v = speed, worst = 0, contacts = 0, heelPk = 0;
  const secs = 2 + (startD + S.R + a.len) / speed;
  const dt = 1 / 60;
  for (let f = 0; f < secs * 60; f++) {
    tick(dt);
    v += Math.max(-10 * dt, Math.min(10 * dt, speed - v));
    B.x += dirX * v * dt; B.z += dirZ * v * dt;
    B.vx = dirX * v; B.vz = dirZ * v; B.vy = 0;
    a.group.position.set(B.x, B.y, B.z);
    if (CBZ.marineHullContact(a, B)) {
      contacts++;
      v = Math.max(0, B.vx * dirX + B.vz * dirZ);
    }
    worst = Math.max(worst, residual(rec, a, B));
    heelPk = Math.max(heelPk, Math.abs(rec._heel || 0));
  }
  const along = (B.x - rec.pos.x) * dirX + (B.z - rec.pos.z) * dirZ;
  const where = along > S.R ? (contacts ? "slid past" : "passed clear") : "held at hull";
  const aud = SC.audit();
  CBZ.scene.remove(a.group);
  return {
    pen: worst, contacts, where, rams: aud.rams, nudges: aud.nudges, capsized: !!rec._capsized,
    heelDeg: (heelPk * 180) / Math.PI, boatMoved: Math.hypot(rec.pos.x, rec.pos.z),
    keel: Math.min(...S.keel), src: S.src,
  };
}

let fails = 0;
function row(label, r, expect) {
  const ok = r.pen < 0.02 && (!expect || expect(r));
  if (!ok) fails++;
  console.log((ok ? "  ok   " : "  FAIL ") + label.padEnd(44) +
    ("pen " + r.pen.toFixed(3)).padEnd(11) + r.where.padEnd(14) +
    ("rams " + r.rams).padEnd(8) + ("nudges " + r.nudges).padEnd(11) +
    ("heel " + r.heelDeg.toFixed(1) + "deg").padEnd(14) + ("boat moved " + r.boatMoved.toFixed(2) + "m").padEnd(18) +
    (r.capsized ? "CAPSIZED" : ""));
}

console.log("THE COLLIDER each hull measured off its own lofted skin\n");
for (const k in LINES) {
  const rec = SC.spawn(k, 0, 0, 0, { crew: 0 });
  const S = SC.collider(rec);
  const mid = S.hb.reduce((m, x) => Math.max(m, x), 0);
  console.log("  " + k.padEnd(9) + "src " + S.src + "  stern " + S.z0.toFixed(2) + " -> stem " + S.z1.toFixed(2) +
    "  half-beam " + mid.toFixed(2) + " (spec " + (SPECS[k].beam / 2).toFixed(2) + ")  keel " + Math.min(...S.keel).toFixed(2) +
    "  sheer " + Math.max(...S.sheer).toFixed(2));
  SC.despawn(rec);
}
console.log("");

const surf = 0;     // body origin at her waterline
for (const hull of ["kayak", "dinghy", "boat", "cruiser"]) {
  console.log(hull.toUpperCase());
  for (const sid of ["bull", "white", "meg"]) {
    const R = SHARKS[sid].len * 0.09;
    for (const sp of [1, 4, 12]) {
      row(`${sid} ${sp} m/s broadside at the surface`, run(hull, sid, sp, 0, surf),
        (r) => r.contacts > 0 && (sid === "meg" || r.capsized || r.where === "held at hull" || r.boatMoved > 0.3));
    }
    row(`${sid} 8 m/s at the bow`, run(hull, sid, 8, 90, surf), (r) => r.contacts > 0);
    row(`${sid} 8 m/s at 45 deg`, run(hull, sid, 8, 45, surf), (r) => r.contacts > 0);
    const S = SC.collider(SC.spawn(hull, 0, 0, 0, {}));
    const under = Math.min(...S.keel) - R - 0.25;
    row(`${sid} 8 m/s broadside under the keel (y ${under.toFixed(1)})`, run(hull, sid, 8, 0, under),
      (r) => r.contacts === 0 && r.where === "passed clear");
  }
  console.log("");
}

// THE BITE STILL REACHES THE RAIL. Nose-on at 6 m/s into the topsides: how
// far the snout tip sits from the hull skin when the body stops, with the
// jaws uncommitted (whole body collides) and committed (head stands down,
// the bite's own surface stop owns it in game).
for (const hull of ["dinghy", "cruiser"]) {
  for (const commit of [false, true]) {
    SC.reset();
    const rec = SC.spawn(hull, 0, 0, 0, { crew: 0 });
    rec.engineDead = true;
    tick(1 / 60);
    const a = makeShark("white");
    const S = SC.collider(rec);
    const y = rec.group.position.y;
    const B = { x: S.hbMax + a.len, y, z: 0, ax: -1, ay: 0, az: 0, vx: 0, vy: 0, vz: 0, skipHeadOf: commit ? rec : null, ramOK: false };
    let v = 6;
    for (let f = 0; f < 90; f++) {
      B.x -= v * (1 / 60); B.vx = -v;
      if (CBZ.marineHullContact(a, B)) v = Math.max(0, -B.vx);
      rec.pos.set(0, rec.pos.y, 0); rec.vx = rec.vz = 0;          // hold her still: this is about the jaw
    }
    const cap = a._hullCap;
    const tip = B.x - cap.x1;                                       // snout tip x
    const o = {};
    const d = SC.hullSdf(S, tip - rec.group.position.x, B.y - rec.group.position.y, 0, o);
    const dy = B.y - y;
    const ok = commit ? d <= 0.05 : d < 0.35;
    if (!ok) fails++;
    console.log((ok ? "  ok   " : "  FAIL ") + `great white nose-on into a ${hull}, jaws ${commit ? "committed  " : "uncommitted"}: snout tip ${d >= 0 ? d.toFixed(2) + " m off" : (-d).toFixed(2) + " m into"} the skin (body pushed ${dy.toFixed(2)} m vertically)`);
    CBZ.scene.remove(a.group);
  }
}

// boat vs boat: two dinghies driven into each other
{
  SC.reset();
  const A = SC.spawn("boat", -2.5, 0, 0, { crew: 0 }), Bc = SC.spawn("boat", 2.5, 0, 0, { crew: 0 });
  A.engineDead = Bc.engineDead = true;
  let minGap = Infinity;
  for (let f = 0; f < 120; f++) {
    A.vx = 3; Bc.vx = -3;
    tick(1 / 60);
    minGap = Math.min(minGap, Math.abs(Bc.pos.x - A.pos.x));
  }
  const want = SC.collider(A).hbMax * 2;
  const ok = minGap > want * 0.9;
  if (!ok) fails++;
  console.log((ok ? "  ok   " : "  FAIL ") + "boat vs boat, beam to beam at 3 m/s each: closest centres " + minGap.toFixed(2) + " m (hulls " + want.toFixed(2) + " m wide), pairs " + SC.audit().boatPairs);
}

console.log(fails ? `\n${fails} FAIL` : "\nall ok");
process.exit(fails ? 1 : 0);
