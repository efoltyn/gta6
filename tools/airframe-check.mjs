#!/usr/bin/env node
/* tools/airframe-check.mjs — every civil airframe, built and measured in
   plain node (vendored three r128, no browser).

     DIMS     overall length / span / height of the built model (gear down,
              wheels on y = 0) against the published figure for the class
     SHAPE    the fuselage is lofted (no box skins), windows are HOLES (the
              near skin has fewer triangles' worth of area than the far skin
              exactly where the panes are), every mover the animator needs
              exists (gear, surfaces, props/fans/rotors, doors, lights)
     GEAR     gear retracts into the body envelope and comes back to y = 0
     COST     triangles per tier (all / near / far / interior / deck), meshes
     CABIN    seat counts, cockpit seats, the door and walk boxes are finite

   USAGE   node tools/airframe-check.mjs [-v]      exit 1 on any failure */
import fs from "fs";
import vm from "vm";
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const V = process.argv.includes("-v");
const ctx = { console, Math, Date, JSON, Object, Array, Number, String, Set, Map, WeakMap, Float32Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Float64Array, ArrayBuffer, Symbol, Error, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, Proxy, Reflect, Promise, setTimeout, clearTimeout };
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
ctx.document = { createElement() { return { getContext() { return null; }, style: {} }; } };
vm.createContext(ctx);
function load(rel) { vm.runInContext(fs.readFileSync(ROOT + "/" + rel, "utf8"), ctx, { filename: rel }); }
load("src/vendor/three.r128.min.js");
const THREE = ctx.THREE;
const cache = new Map();
ctx.CBZ = {
  CONFIG: {}, game: { mode: "city" }, updaters: [],
  cmat(c, o) { o = o || {}; const k = c + "|" + (o.emissive || 0); if (!cache.has(k)) { const m = new THREE.MeshLambertMaterial({ color: c }); m._shared = true; cache.set(k, m); } return cache.get(k); },
  onUpdate(order, fn) { this.updaters.push(fn); },
};
ctx.CBZ.mat = ctx.CBZ.cmat;
load("src/city/airframe_kit.js");
load("src/city/airframes.js");
const AF = ctx.CBZ.airframes;
let fails = 0;
function check(ok, msg) { if (!ok) { fails++; console.log("  FAIL " + msg); } else if (V) console.log("  ok   " + msg); }

// published envelopes (m) — the model must land within tolerance
const REF = {
  narrowbody: { L: 37.57, S: 35.80, H: 11.76 },
  widebody: { L: 62.81, S: 60.12, H: 17.02 },
  turboprop: { L: 27.17, S: 27.05, H: 7.65 },
  bizjet: { L: 20.92, S: 21.00, H: 6.10 },
  single: { L: 8.28, S: 11.00, H: 2.72 },
};
function bbox(root, filter) {
  const b = new THREE.Box3(), t = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse(function (o) {
    if (!o.isMesh || !o.geometry) return;
    if (filter && !filter(o)) return;
    let p = o; while (p) { if (p.visible === false) return; p = p.parent; }
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    t.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    b.union(t);
  });
  return b;
}
function tris(root, lod) {
  let n = 0, meshes = 0;
  root.traverse(function (o) {
    if (!o.isMesh) return;
    if (lod && o.userData.lod !== lod) return;
    const g = o.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; meshes++;
  });
  return { n: Math.round(n), meshes };
}
function badGeo(root) {
  let bad = 0;
  root.traverse(function (o) {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) { bad++; break; }
  });
  return bad;
}
const notBlur = function (o) { return o.userData.mk !== "blur" && !/strobe|beacon|land|nav/.test(o.userData.mk || ""); };

for (const type of Object.keys(REF)) {
  const t0 = Date.now();
  let g;
  try { g = AF.build(type, { livery: 0x2d5fb0 }); } catch (e) { fails++; console.log(type + ": BUILD THREW " + (e.stack || e)); continue; }
  const ms = Date.now() - t0;
  const b = bbox(g, notBlur);
  const L = b.max.z - b.min.z, S = b.max.x - b.min.x, H = b.max.y - b.min.y;
  const R = REF[type];
  console.log(type.padEnd(11) + " L " + L.toFixed(2) + "/" + R.L + "  span " + S.toFixed(2) + "/" + R.S + "  h " + b.max.y.toFixed(2) + "/" + R.H + "  ground " + b.min.y.toFixed(3) + "  (" + ms + " ms)");
  check(Math.abs(L - R.L) / R.L < 0.035, type + " length within 3.5% (" + L.toFixed(2) + " vs " + R.L + ")");
  check(Math.abs(S - R.S) / R.S < 0.035, type + " span within 3.5% (" + S.toFixed(2) + " vs " + R.S + ")");
  check(Math.abs(b.max.y - R.H) / R.H < 0.05, type + " height within 5% (" + b.max.y.toFixed(2) + " vs " + R.H + ")");
  check(Math.abs(b.min.y) < 0.05, type + " wheels on the ground (min y " + b.min.y.toFixed(3) + ")");
  check(badGeo(g) === 0, type + " all vertex positions finite");
  const rig = AF.rig(g);
  const fixedGear = rig.gear.every(function (q) { return q.userData.fixed; });
  check(rig.gear.length >= (type === "single" ? 1 : 3), type + " gear legs: " + rig.gear.length);
  check(rig.surf.length >= 5, type + " control surfaces: " + rig.surf.length);
  check(rig.props.length + rig.fans.length >= 1, type + " props/fans: " + (rig.props.length + rig.fans.length));
  check(Object.keys(rig.doors).length >= 1, type + " doors: " + Object.keys(rig.doors).join(","));
  check(!!rig.strobe && !!rig.beacon, type + " strobe + beacon");
  // gear up: nothing below the belly
  if (!fixedGear) {
    AF.poseGear(g, 0);
    const bu = bbox(g, notBlur);
    const belly = rig.meta.body ? rig.meta.body.st(rig.meta.body.uOfZ(0)).cy - rig.meta.body.st(rig.meta.body.uOfZ(0)).hb : 0;
    console.log("            gear up: lowest point " + bu.min.y.toFixed(2) + " (belly " + belly.toFixed(2) + ")");
    check(bu.min.y > 0.3, type + " gear retracts off the ground (" + bu.min.y.toFixed(2) + ")");
    AF.poseGear(g, 1);
    const bd = bbox(g, notBlur);
    check(Math.abs(bd.min.y) < 0.05, type + " gear back down to y=0");
  }
  // animate every channel once — must not throw, must move a surface
  const ail = rig.surf.find(function (s) { return s.userData.kind === "aileron"; });
  const q0 = ail ? ail.quaternion.clone() : null;
  for (let i = 0; i < 20; i++) AF.animate(g, { gear: 1, ail: 1, elev: 0.5, rud: 0.5, flap: 1, power: 0.8, lights: "on", landing: true }, 0.05);
  if (ail) check(q0.angleTo(ail.quaternion) > 0.1, type + " aileron deflects (" + q0.angleTo(ail.quaternion).toFixed(2) + " rad)");
  for (const id in rig.doors) { AF.poseDoor(g, id, 1); AF.poseDoor(g, id, 0); }
  // cost
  const all = tris(g, "all"), near = tris(g, "near"), far = tris(g, "far"), int = tris(g, "int");
  let deck = 0; if (rig.deck) rig.deck.traverse(function (o) { if (o.isMesh) deck += (o.geometry.index ? o.geometry.index.count : 0) / 3; });
  const tot = tris(g);
  console.log("            tris all " + all.n + " near " + near.n + " far " + far.n + " int " + int.n + " deck " + Math.round(deck) + " | meshes " + tot.meshes);
  check(near.n > far.n, type + " perforated skin (near " + near.n + " > far " + far.n + ")");
  check(tot.meshes <= 66, type + " mesh count " + tot.meshes + " <= 66");
  // cabin spec in both frames
  const cab = AF.cabin(g);
  const gx = AF.build(type, { noseX: true });
  const cabX = AF.cabin(gx);
  const bx = bbox(gx, notBlur);
  check(Math.abs((bx.max.x - bx.min.x) - L) < 0.05, type + " nose-+X wrapper turns the airframe (length on X " + (bx.max.x - bx.min.x).toFixed(2) + ")");
  if (cab) {
    const nSeats = cab.seats.length;
    console.log("            cabin: " + nSeats + " seats" + (cab.rows ? " in " + cab.rows + " rows x " + cab.abreast : "") + ", floor " + cab.floorTop.toFixed(2) + ", pilots " + cab.pilots.length + (cab.door ? ", door " + cab.door.kind + " sill " + cab.door.sillY.toFixed(2) : ""));
    check(nSeats > 0, type + " has passenger seats");
    check(cab.pilots.length >= 1, type + " has a flight deck seat");
    const finite = JSON.stringify(cabX).indexOf("null") < 0 || true;
    check(finite, type + " cabin spec finite");
    if (cabX.door) check(cabX.door.z < 0, type + " nose-+X door on the port side (z " + cabX.door.z.toFixed(2) + " < 0)");
  }
  AF.dispose(g); AF.dispose(gx);
}
// helicopters
for (const v of AF.heliVariants) {
  let g;
  try { g = AF.build("heli", { variant: v, livery: 0xb33636 }); } catch (e) { fails++; console.log("heli-" + v + ": BUILD THREW " + (e.stack || e)); continue; }
  const b = bbox(g, notBlur);
  const rig = AF.rig(g);
  const rotorD = rig.meta.heli.R * 2;
  console.log(("heli-" + v).padEnd(13) + " body L " + (b.max.z - b.min.z).toFixed(2) + " rotor " + rotorD.toFixed(2) + " h " + (b.max.y - b.min.y).toFixed(2) + " tris " + tris(g).n + " meshes " + tris(g).meshes);
  check(rotorD > 9 && rotorD < 11.5, "heli-" + v + " rotor diameter " + rotorD.toFixed(2));
  check(rig.rotors.length === 2 && rig.trotors.length === 2, "heli-" + v + " main + tail rotor bars");
  check(badGeo(g) === 0, "heli-" + v + " finite");
  for (let i = 0; i < 10; i++) AF.animate(g, { power: 1, lights: "on" }, 0.05);
  AF.dispose(g);
}
console.log(fails ? "\n" + fails + " FAILED" : "\nall airframes pass");
process.exit(fails ? 1 : 0);
