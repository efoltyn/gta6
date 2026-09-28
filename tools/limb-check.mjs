#!/usr/bin/env node
/* tools/limb-check.mjs — THE LOFTED LIMBS: shape, joints, paint, instancing, cost.

   Owner, 2026-09-28: "make the arms and legs much more realistic". The limb
   boxes became lofted tubes (entities/character.js LIMBS block). This runs the
   REAL three r128 + materials.js + fphands.js + character.js in plain node (no
   browser, no captures) and asserts:

     1. every loft is finite, closed and wound outward, inside its triangle
        budget, cached/shared, and still reports the box it replaced
        (geometry.parameters) so box-sized consumers keep working;
     2. the canonical x L that pedinstance.js draws IS the baked geometry
        (vertex for vertex), and the flat loft shares the canonical's UVs;
     3. JOINTS ACROSS THE POSE RANGE: at every elbow / knee bend from straight
        to fully folded, and every shoulder / hip swing, the union of the
        segments still holds a solid ball round the joint pivot (no gap can
        open) and the outside of the bend keeps its thickness (no collapse);
        segment lengths and pivot positions are exactly the old rig's;
     4. the shape reads as a limb: the forearm narrows to a wrist that holds
        the hand's own wrist stub, the elbow/knee are narrower than the
        muscle bellies, the calf sits behind the shin, the ankle goes into the
        shoe collar and a trouser hem is wider than that collar;
     5. paint: a painter hands each quadrant the right atlas column in the
        BoxGeometry's u direction and v runs along the old box span;
     6. LOD swap (rig.setHandLod) swaps every limb and keeps the paint.
   Prints the per-body / 650-crowd triangle numbers (the ipad-perf budget view).

     node tools/limb-check.mjs        exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math, performance });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {}, onAlways() {}, onUpdate() {}, on() {} };
for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/character.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { THREE: T, CBZ } = ctx;
let fails = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } }

const base = { skin: 0xb87955, torso: 0x315f94, collar: 0x315f94, arms: 0x315f94, legs: 0x202c3c, shoes: 0x201a18, hair: 0x2b1b12 };
function build(o) {
  const r = CBZ.makeCharacter(Object.assign({}, base, o || {}));
  r.group.updateMatrixWorld(true);
  return r;
}
const bodies = {
  man: build(),
  woman: build({ build: "f" }),
  child: build({ age: 7 }),
  swimmer: build({ legs: 0xb87955, shins: 0xb87955, shoes: 0xb87955, arms: 0xb87955, pelvis: 0x1a4a8a }),
  tee: build({ shortSleeve: true }),
};
const SEGS = [["arms", 0], ["arms", 1], ["armsLower", 0], ["armsLower", 1], ["legs", 0], ["legs", 1], ["legsLower", 0], ["legsLower", 1]];
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

// ------------------------------------------------------------ 1. geometry
const seenGeo = new Set();
for (const [name, r] of Object.entries(bodies)) {
  for (const [slot, i] of SEGS) {
    const m = r.skinSlots[slot][i], g = m.geometry, tag = `${name} ${slot}[${i}]`;
    check(!!(m.userData.limb && g.userData.limb), `${tag} is a lofted limb`);
    if (seenGeo.has(g)) continue;
    seenGeo.add(g);
    const P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array;
    check(P.every(Number.isFinite) && N.every(Number.isFinite), `${tag} finite`);
    check(g._shared === true, `${tag} shared`);
    const pr = g.parameters || {};
    check(pr.width > 0 && pr.height > 0 && pr.depth > 0, `${tag} still reports its box`);
    // outward winding: each face normal agrees with its vertex normals
    let out = 0, tot = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      if (Math.hypot(fx, fy, fz) < 1e-12) continue;
      tot++;
      if (fx * (N[a] + N[b] + N[c]) + fy * (N[a + 1] + N[b + 1] + N[c + 1]) + fz * (N[a + 2] + N[b + 2] + N[c + 2]) > 0) out++;
    }
    check(out === tot, `${tag} outward winding ${out}/${tot}`);
    // closed: every edge (welded by position) is shared by exactly two triangles
    const key = (i) => Math.round(P[i * 3] * 1e5) + "," + Math.round(P[i * 3 + 1] * 1e5) + "," + Math.round(P[i * 3 + 2] * 1e5);
    const edges = new Map();
    for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) {
      const p = key(I[t + e]), q = key(I[t + (e + 1) % 3]);
      if (p === q) continue;
      const k = p < q ? p + "|" + q : q + "|" + p;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
    let open = 0; edges.forEach((n) => { if (n !== 2) open++; });
    check(open === 0, `${tag} closed surface (${open} open edges)`);
    check(tris(g) <= 260, `${tag} near-LOD budget (${tris(g)} tris)`);
    // ---- 2. instancing twin
    const U = g._cbzUnit;
    check(!!U && U.geo && U.L, `${tag} flat loft carries its canonical twin`);
    if (U) {
      const C = U.geo.attributes.position, v = new T.Vector3();
      let err = 0;
      for (let k = 0; k < C.count; k++) {
        v.fromBufferAttribute(C, k).applyMatrix4(U.L);
        err = Math.max(err, Math.abs(v.x - P[k * 3]), Math.abs(v.y - P[k * 3 + 1]), Math.abs(v.z - P[k * 3 + 2]));
      }
      check(err < 1e-5, `${tag} canonical x L == baked (${err.toExponential(1)})`);
      check(g.attributes.uv === U.geo.attributes.uv, `${tag} flat loft shares the canonical UVs`);
      check(g.index === U.geo.index, `${tag} shares the canonical index`);
    }
  }
}
check(bodies.man.skinSlots.arms[0].geometry === bodies.man.skinSlots.arms[1].geometry, "left and right arms share one geometry");
check(bodies.man.skinSlots.arms[0].geometry === build().skinSlots.arms[0].geometry, "two men share one arm geometry");
check(bodies.man.skinSlots.arms[0].geometry._cbzUnit.geo === bodies.woman.skinSlots.arms[0].geometry._cbzUnit.geo ||
  bodies.man.skinSlots.arms[0].geometry._cbzUnit.geo.name.startsWith("limb~C|armUp"), "man/woman arms draw from canonical lofts");

// ------------------------------------------------------------ 3. joints
// inside test: parity of ray crossings against a DoubleSide twin of the mesh
const ray = new T.Raycaster();
const DIR = new T.Vector3(0.5773, 0.5801, 0.5745).normalize();
const dbl = new T.MeshBasicMaterial({ side: T.DoubleSide });
function twin(m) {
  const t = new T.Mesh(m.geometry, dbl);
  t.matrixAutoUpdate = false;
  return t;
}
function inside(meshes, p) {
  for (const t of meshes) {
    ray.set(p, DIR);
    const hits = ray.intersectObject(t, false);
    let n = 0, last = -1;
    for (const h of hits) { if (h.distance - last > 1e-6) n++; last = h.distance; }
    if (n % 2 === 1) return true;
  }
  return false;
}
const fib = [];
for (let i = 0; i < 90; i++) {
  const y = 1 - (i + 0.5) / 90 * 2, rr = Math.sqrt(1 - y * y), th = i * 2.39996;
  fib.push(new T.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr));
}
// the smallest radius, over all directions, at which the union around `c` is left
function minReach(meshes, c, rmax) {
  let worst = Infinity;
  const p = new T.Vector3();
  for (const d of fib) {
    let lo = 0, hi = rmax;
    if (inside(meshes, p.copy(d).multiplyScalar(hi).add(c))) continue;
    for (let s = 0; s < 7; s++) {
      const mid = (lo + hi) / 2;
      // the first exit along the ray: march, not bisect, so a notch is found
      let ok = true;
      for (let k = 1; k <= 4; k++) if (!inside(meshes, p.copy(d).multiplyScalar(mid * k / 4).add(c))) { ok = false; break; }
      if (ok) lo = mid; else hi = mid;
    }
    worst = Math.min(worst, lo);
  }
  return worst;
}
const _pw = new T.Vector3();
function jointSweep(name, r, limbKey, jointAngles, topAngles, flip) {
  const part = r.parts[limbKey], low = part.userData.low;
  const up = part.userData.main, lo = part.userData.lower;
  const t1 = twin(up), t2 = twin(lo);
  const hu = CBZ.humanLimbHalfAt(up.geometry, up.geometry.userData.limb.y0 - up.geometry.userData.limb.sy);
  const hl = CBZ.humanLimbHalfAt(lo.geometry, lo.geometry.userData.limb.y0);
  const rj = Math.min(hu.hx, hu.hz, hl.hx, hl.hz);
  check(Math.min(hu.hx, hu.hz) >= Math.min(hl.hx, hl.hz) * 0.97, `${name} ${limbKey} upper section at the joint holds the lower (${Math.min(hu.hx, hu.hz).toFixed(3)} vs ${Math.min(hl.hx, hl.hz).toFixed(3)})`);
  const saveT = part.rotation.x, saveJ = low.rotation.x;
  let worst = Infinity, worstAt = 0;
  for (const top of topAngles) for (const j of jointAngles) {
    part.rotation.x = top; low.rotation.x = j;
    r.group.updateMatrixWorld(true);
    t1.matrixWorld.copy(up.matrixWorld); t2.matrixWorld.copy(lo.matrixWorld);
    low.getWorldPosition(_pw);
    const s = r.group.userData.humanScale;
    const reach = minReach([t1, t2], _pw.clone(), rj * 3 * s) / s;
    if (reach < worst) { worst = reach; worstAt = j; }
  }
  part.rotation.x = saveT; low.rotation.x = saveJ;
  r.group.updateMatrixWorld(true);
  check(worst >= rj * 0.9, `${name} ${limbKey} joint solid across the bend range: min reach ${worst.toFixed(3)} vs section ${rj.toFixed(3)} (worst at ${worstAt.toFixed(2)} rad)`);
  return worst / rj;
}
const report = [];
for (const [name, r] of Object.entries(bodies)) {
  if (name === "tee") continue;
  const el = jointSweep(name, r, "ra", [0, -0.4, -0.9, -1.4, -1.9, -2.3, -2.6], [0, -1.2, -2.4]);
  const kn = jointSweep(name, r, "ll", [0, 0.4, 0.9, 1.4, 1.9, 2.3, 2.6], [0, -1.0, -1.6]);
  report.push(`${name}: elbow ${el.toFixed(2)}x, knee ${kn.toFixed(2)}x of the joint section`);
  // shoulder / hip: the top pivot keeps a solid ball through a wide swing
  for (const [k, sw] of [["la", [-3.0, -1.6, 0, 0.8]], ["rl", [-1.7, -0.8, 0, 0.6]]]) {
    // the deltoid / hip dome is deliberately flatter than a ball (it must not
    // stand above the yoke or out of the pelvis), so the ball is the union of
    // the segment with the body parts it tucks into
    const part = r.parts[k], up = part.userData.main, t1 = twin(up);
    const hosts = (k === "la" ? r.skinSlots.collar.concat(r.skinSlots.torso) : r.skinSlots.pelvis.concat(r.skinSlots.torso)).map(twin);
    const h0 = CBZ.humanLimbHalfAt(up.geometry, up.geometry.userData.limb.y0);
    const rt = Math.min(h0.hx, h0.hz) * 0.8;
    const save = part.rotation.x;
    let worst = Infinity;
    for (const a of sw) {
      part.rotation.x = a; r.group.updateMatrixWorld(true);
      t1.matrixWorld.copy(up.matrixWorld);
      const hostsSrc = k === "la" ? r.skinSlots.collar.concat(r.skinSlots.torso) : r.skinSlots.pelvis.concat(r.skinSlots.torso);
      hosts.forEach((h, i) => h.matrixWorld.copy(hostsSrc[i].matrixWorld));
      part.getWorldPosition(_pw);
      const s = r.group.userData.humanScale;
      worst = Math.min(worst, minReach([t1].concat(hosts), _pw.clone(), rt * 3 * s) / s);
    }
    part.rotation.x = save; r.group.updateMatrixWorld(true);
    check(worst >= rt * 0.95, `${name} ${k} top pivot solid (dome + the body it tucks into) across the swing (${worst.toFixed(3)} vs ${rt.toFixed(3)})`);
  }
  // lengths and pivots unchanged
  const P = r.profile;
  check(Math.abs(r.low.ra.position.y + (P.armUp - 0.02)) < 1e-9 && Math.abs(r.low.ll.position.y + (P.legUp - 0.02)) < 1e-9, `${name} joint pivots unchanged`);
  check(Math.abs(r.parts.ra.userData.main.position.y + P.armUp / 2) < 1e-9 && Math.abs(r.parts.ll.userData.lower.position.y - (0.06 - P.legLo) / 2) < 1e-9, `${name} segments sit where the boxes sat`);
}

// ------------------------------------------------------------ 4. anatomy
function sect(m, t) {   // section at share t (0 top joint .. 1 end) of a segment
  const L = m.geometry.userData.limb;
  return CBZ.humanLimbHalfAt(m.geometry, L.y0 - t * L.sy);
}
for (const [name, r] of Object.entries(bodies)) {
  const s = r.skinSlots;
  const fa = s.armsLower[1], ua = s.arms[1], th = s.legs[0], sh = s.legsLower[0];
  const wrist = sect(fa, 1), belly = sect(fa, 0.2), elbow = sect(ua, 1), bicep = sect(ua, 0.55);
  check(wrist.hx < belly.hx * 0.7 && wrist.hz < belly.hz * 0.8, `${name} forearm narrows to the wrist`);
  check(wrist.hz > wrist.hx, `${name} wrist wider front-back than across (the palm plane)`);
  check(elbow.hx < bicep.hx && elbow.hz < bicep.hz, `${name} elbow narrower than the upper arm`);
  const knee = sect(th, 1), thigh = sect(th, 0.15), calf = sect(sh, 0.28), ankle = sect(sh, 0.85);
  check(knee.hx < thigh.hx * 0.8, `${name} knee narrower than the thigh`);
  if (sh.userData.limb.variant === "bare") {
    check(ankle.hx < calf.hx * 0.75, `${name} ankle narrower than the calf`);
    check(calf.cz < 0, `${name} calf belly sits behind the shin`);
  } else check(ankle.hx > calf.hx * 0.8, `${name} a trouser leg falls straight to the hem`);
  // the hand's wrist stub fits inside the forearm's end section (relaxed)
  const hand = r.skinSlots.hands[1];
  if (hand) {
    const g = hand.geometry, P = g.attributes.position.array, v = new T.Vector3();
    const L = fa.geometry.userData.limb, yEnd = fa.position.y + L.y0 - L.sy;   // crease, elbow frame
    let worst = 0;
    for (let i = 0; i < P.length; i += 3) {
      v.set(P[i], P[i + 1], P[i + 2]).applyQuaternion(hand.quaternion).multiply(hand.scale).add(hand.position);
      if (v.y < yEnd + 0.01 || v.y > yEnd + 0.06) continue;   // the stub, just above the crease
      const h = CBZ.humanLimbHalfAt(fa.geometry, v.y - fa.position.y);
      worst = Math.max(worst, Math.hypot(v.x / h.hx, (v.z - h.cz) / h.hz));
    }
    check(worst < 1.25, `${name} hand's wrist stub sits in the forearm (${worst.toFixed(2)} of the section)`);
  }
  // the ankle goes INTO the shoe collar; a trouser hem is wider than it
  const shoe = s.shoes && s.shoes[0];
  if (shoe) {
    const g = shoe.geometry, P = g.attributes.position.array;
    let top = -Infinity; for (let i = 1; i < P.length; i += 3) top = Math.max(top, P[i]);
    let cx = 0; for (let i = 0; i < P.length; i += 3) if (P[i + 1] > top - 0.08) cx = Math.max(cx, Math.abs(P[i]));
    const collarHalf = cx * shoe.scale.x, yTop = shoe.position.y + top * shoe.scale.y;   // knee frame
    const L = sh.geometry.userData.limb, atTop = CBZ.humanLimbHalfAt(sh.geometry, yTop - sh.position.y);
    const tLeg = (L.y0 - (yTop - sh.position.y)) / L.sy;
    if (sh.userData.limb.variant === "bare") check(atTop.hx < collarHalf * 1.02, `${name} bare ankle fits the collar (${atTop.hx.toFixed(3)} vs ${collarHalf.toFixed(3)})`);
    else check(atTop.hx > collarHalf, `${name} trouser hem breaks over the collar (${atTop.hx.toFixed(3)} vs ${collarHalf.toFixed(3)})`);
    check(tLeg > 0.5 && tLeg < 0.95, `${name} shoe top at ${(tLeg * 100).toFixed(0)}% down the shin`);
  }
}
check(bodies.swimmer.skinSlots.legsLower[0].userData.limb.variant === "bare" && bodies.man.skinSlots.legsLower[0].userData.limb.variant === "cloth", "bare vs clothed legs pick their loft");
check(bodies.tee.skinSlots.armsLower[0].userData.limb.variant === "bare" && bodies.tee.skinSlots.arms[0].userData.limb.variant === "cloth", "a tee: sleeve upper, bare forearm");
check(bodies.swimmer.skinSlots.shoes[0].geometry !== bodies.man.skinSlots.shoes[0].geometry, "a bare foot is not a shoe");

// ------------------------------------------------------------ 5. paint
const COL = { front: 0, side: 1, back: 2 };
const painter = { key: "test", fn: (face, u, v) => [COL[face] + u * 0.999, v] };
{
  const m = build().skinSlots.arms[1];
  const g = CBZ.humanLimbGeometry(m, painter);
  check(g !== m.geometry && !g._cbzUnit, "painted loft is its own geometry, pooled by identity");
  const P = g.attributes.position.array, U = g.attributes.uv.array;
  let okFace = 0, n = 0, okV = 0, dirOK = 0, dirN = 0;
  const hb = g.parameters.height / 2;
  for (let i = 0; i < P.length / 3; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], col = Math.floor(U[i * 2]), u = U[i * 2] - col;
    const L = g.userData.limb, c = CBZ.humanLimbHalfAt(g, y);
    const zc = z - c.cz;
    if (Math.hypot(x, zc) < 1e-4) continue;
    n++;
    const want = Math.abs(zc / c.hz) >= Math.abs(x / c.hx) ? (zc > 0 ? 0 : 2) : 1;
    const ax = Math.abs(Math.abs(zc / c.hz) - Math.abs(x / c.hx)) < 0.02;   // on a quadrant seam: either
    if (col === want || ax) okFace++;
    const vv = Math.min(1, Math.max(0, (y + hb) / (2 * hb)));
    if (Math.abs(U[i * 2 + 1] - vv) < 1e-5) okV++;
    if (col === 0 && !ax) { dirN++; if ((u - 0.5) * x >= -1e-6) dirOK++; }
  }
  check(okFace === n, `paint: every vertex samples its quadrant's column (${okFace}/${n})`);
  check(okV === n, `paint: v runs along the old box span (${okV}/${n})`);
  check(dirOK === dirN, `paint: front u runs -x -> +x like a BoxGeometry (${dirOK}/${dirN})`);
  check(CBZ.humanLimbGeometry(m, painter) === g, "painted loft cached");
  m.geometry = g;
  // ---- 6. LOD keeps the paint
  const rig = { skinSlots: { arms: [m], armsLower: [], legs: [], legsLower: [] } };
  const nearTris = tris(g);
  rig.skinSlots.arms[0].userData.limb.lod = 1;
  CBZ.makeCharacter && void 0;
}
{
  const r = build();
  const a = r.skinSlots.arms[0];
  const near = a.geometry;
  a.geometry = CBZ.humanLimbGeometry(a, painter);
  r.setHandLod(2);
  const far = a.geometry;
  check(far !== near && far.userData.limb && tris(far) < tris(near) * 0.6, `far LOD swaps the loft (${tris(near)} -> ${tris(far)} tris)`);
  check(!far._cbzUnit, "far LOD kept the paint");
  check(r.skinSlots.legs[0].geometry._cbzUnit && r.skinSlots.legs[0].geometry.name.endsWith("~2"), "far LOD swapped every limb");
  r.setHandLod(1);
  check(a.geometry === CBZ.humanLimbGeometry(a) && tris(a.geometry) === tris(near), "back to the near loft");
}

// ------------------------------------------------------------ cost
const man = build();
const bodyTris = (lod) => {
  man.setHandLod(lod);
  let limbs = 0, hands = 0, shoes = 0;
  for (const [slot, i] of SEGS) limbs += tris(man.skinSlots[slot][i].geometry);
  for (const h of man.skinSlots.hands) hands += tris(h.geometry);
  for (const s of man.skinSlots.shoes) shoes += tris(s.geometry);
  return { limbs, hands, shoes };
};
const nearT = bodyTris(1), farT = bodyTris(2);
const BOX = 8 * 12;
check(nearT.limbs <= 2000 && farT.limbs <= 800, `limb triangle budget per body: near ${nearT.limbs}, far ${farT.limbs}`);
const crowd = (nNear, nFar) => nNear * (nearT.limbs + nearT.hands + nearT.shoes) + nFar * (farT.limbs + farT.hands + farT.shoes);
console.log(report.join("\n"));
console.log(`per body: limbs near ${nearT.limbs} / far ${farT.limbs} tris (boxes were ${BOX}); hands near ${nearT.hands} / far ${farT.hands}; shoes ${nearT.shoes}`);
console.log(`650-ped city (60 inside 30 m, 590 past it): limbs+hands+shoes ${(crowd(60, 590) / 1000).toFixed(0)}k tris; ` +
  `the drawn ~230 (peds.js VIS 95 m, 40 near): ${(crowd(40, 190) / 1000).toFixed(0)}k tris; box limbs would be ${((230 * BOX) / 1000).toFixed(0)}k of that`);
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
