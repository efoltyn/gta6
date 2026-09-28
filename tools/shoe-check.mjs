#!/usr/bin/env node
/* tools/shoe-check.mjs — THE LEG ENDS INSIDE THE SHOE, in every shoe, every
   body, every pose.

   Owner, 2026-09-28: "When a guy is on the ground and his feet are up, his
   heels show his legs, so his legs go through his shoes." Before this wave
   the shoe was bolted to the shin (no ankle) and the lower-leg tube ran on
   inside it to the sole line: its end dome came out 0.04 shoe-heights under
   the sole and within millimetres of the heel's rounded back, so a man lying
   with his feet toward you showed his trouser leg through his heel.

   Runs the REAL three r128 + character.js + entities/footwear.js (and, for
   the pose sweep, the real animChar, meleeposes falls, grapple knockdowns
   and deathPose through tools/lib/verbs-vm.mjs) in plain node and asserts:

     1. GEOMETRY: every style x lod x side is finite, every piece of it is a
        CLOSED solid (each edge shared by exactly two triangles), wound
        outward (positive volume), shared/cached, inside its triangle budget.
     2. CONTAINMENT over the ankle's whole range: for every style x body (man,
        woman, child; trousers and bare shins) x ankle angle across the
        style's flex range x a roll, no leg vertex lies OUTSIDE the shoe
        while shoe material is still ABOVE it along the leg (that is exactly
        "the leg shows through the shoe below its collar": through the sole,
        the heel, the side), and nothing of the leg hangs below the ankle
        pivot outside the shoe. A vertex is first pulled 5 mm (rig) in along
        its own normal, so two surfaces kissing is not a failure.
     3. THE POSE SWEEP: the same containment on the live rig through stand,
        walk, run, crouch, kneel, sit, sleep on a bed (back and side), a
        melee KO fall (back and face), a grapple knockdown and the three
        deathPose templates; plus
          · standing and sitting, both soles sit FLAT on the floor: the sole's
            lowest point within 1 cm of the ground, the heel and the ball
            level with each other (no floating, no sinking, no tiptoe);
          · lying (sleep, KO, knockdown, dead), the feet fall slack: the foot
            is plantar-flexed off the shin (toes away), not standing up at
            90 degrees ("his feet are up").
     4. ROLE: the wardrobe's restyle picks the job's shoe (inmates slip-ons,
        officers boots, suits oxfords, lifeguards flip-flops, swimmers bare),
        keeps the slot mesh's identity and re-ends the shin in the new shoe.

     node tools/shoe-check.mjs        exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

let fails = 0, checks = 0;
const failed = new Map();
function check(ok, msg, key) {
  checks++;
  if (ok) return;
  fails++;
  const k = key || msg;
  const n = (failed.get(k) || 0) + 1;
  failed.set(k, n);
  if (n <= 3) console.log("  FAIL " + msg);
}

// ---------------------------------------------------------------- the rig (plain)
const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math, performance });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {}, onAlways() {}, onUpdate() {}, on() {} };
for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/footwear.js", "src/entities/character.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { THREE: T, CBZ } = ctx;
const FW = CBZ.footwear;
const STYLES = FW.styles();

// ---------------------------------------------------------------- solids
/* Split a geometry into its closed pieces (connected by shared vertex
   positions) once; each piece keeps its triangles and bounding box. */
const PIECES = new WeakMap();
function pieces(g) {
  let out = PIECES.get(g);
  if (out) return out;
  const P = g.attributes.position.array, I = g.index.array, n = P.length / 3;
  const key = new Int32Array(n), map = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.round(P[i * 3] * 1e5) + "," + Math.round(P[i * 3 + 1] * 1e5) + "," + Math.round(P[i * 3 + 2] * 1e5);
    let id = map.get(k); if (id === undefined) { id = map.size; map.set(k, id); } key[i] = id;
  }
  const par = new Int32Array(map.size).map((_, i) => i);
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < I.length; t += 3) {
    const a = find(key[I[t]]), b = find(key[I[t + 1]]), c = find(key[I[t + 2]]);
    par[b] = a; par[find(c)] = a;
  }
  const groups = new Map();
  for (let t = 0; t < I.length; t += 3) {
    const r = find(key[I[t]]);
    let G = groups.get(r);
    if (!G) groups.set(r, G = { tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], keys: [] });
    for (let k = 0; k < 3; k++) {
      const v = I[t + k];
      G.tris.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
      G.keys.push(key[v]);
      for (let d = 0; d < 3; d++) { G.min[d] = Math.min(G.min[d], P[v * 3 + d]); G.max[d] = Math.max(G.max[d], P[v * 3 + d]); }
    }
  }
  out = [...groups.values()].map((G) => ({ tris: new Float64Array(G.tris), keys: G.keys, min: G.min, max: G.max }));
  PIECES.set(g, out);
  return out;
}
function rayHits(pc, o, d) {
  let c = 0;
  const A = pc.tris;
  for (let t = 0; t < A.length; t += 9) {
    const e1x = A[t + 3] - A[t], e1y = A[t + 4] - A[t + 1], e1z = A[t + 5] - A[t + 2];
    const e2x = A[t + 6] - A[t], e2y = A[t + 7] - A[t + 1], e2z = A[t + 8] - A[t + 2];
    const hx = d[1] * e2z - d[2] * e2y, hy = d[2] * e2x - d[0] * e2z, hz = d[0] * e2y - d[1] * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-14) continue;
    const f = 1 / det, sx = o[0] - A[t], sy = o[1] - A[t + 1], sz = o[2] - A[t + 2];
    const u = f * (sx * hx + sy * hy + sz * hz); if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = f * (d[0] * qx + d[1] * qy + d[2] * qz); if (v < 0 || u + v > 1) continue;
    if (f * (e2x * qx + e2y * qy + e2z * qz) > 1e-9) c++;
  }
  return c;
}
const DIRS = [[1, 0.0131, 0.0077], [0.0113, 1, 0.0171], [0.0191, 0.0037, 1]];
function insidePiece(pc, p) {
  for (let d = 0; d < 3; d++) if (p[d] < pc.min[d] - 1e-6 || p[d] > pc.max[d] + 1e-6) return false;
  let votes = 0;
  for (const d of DIRS) if (rayHits(pc, p, d) & 1) votes++;
  return votes >= 2;
}
function rayHitsAny(pcs, p, d) {
  for (const pc of pcs) if (rayHits(pc, p, d) > 0) return true;
  return false;
}

// every solid of a dressed shoe, in the SLOT mesh's local (unit) space
function shoeSolids(shoe) {
  const out = [];
  shoe.updateMatrixWorld(true);
  for (const o of [shoe, shoe.userData.trim, shoe.userData.skinFoot]) {
    if (!o || !o.visible) continue;
    for (const pc of pieces(o.geometry)) out.push(pc);
  }
  return out;
}

/* THE CONTAINMENT TEST on one leg as posed now. Returns the violations. */
const _v = new T.Vector3(), _n = new T.Vector3(), _ax = new T.Vector3(), _m = new T.Matrix4(), _nm = new T.Matrix3();
function legLeaks(leg) {
  const shoe = leg.userData.cap, shin = leg.userData.lower, foot = leg.userData.foot;
  leg.updateMatrixWorld(true);
  const solids = shoeSolids(shoe);
  const inv = _m.copy(shoe.matrixWorld).invert();
  // the leg's axis (knee frame +y) in the shoe's unit space
  _ax.set(0, 1, 0).transformDirection(leg.userData.low.matrixWorld);
  const axW = _ax.clone();
  const ax = axW.clone().applyMatrix3(new T.Matrix3().setFromMatrix4(inv)); // direction (unnormalised is fine)
  const axd = [ax.x, ax.y, ax.z];
  const pos = shin.geometry.attributes.position, nor = shin.geometry.attributes.normal;
  _nm.getNormalMatrix(shin.matrixWorld);
  const pivotW = new T.Vector3().setFromMatrixPosition(foot.matrixWorld);
  const scale = shoe.matrixWorld.getMaxScaleOnAxis() / Math.max(shoe.scale.x, shoe.scale.y, shoe.scale.z);   // world units per rig unit
  const EPS = 0.005 * scale;
  let bad = 0, worst = 0, where = "";
  const p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(shin.matrixWorld);
    _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
    _v.addScaledVector(_n, -EPS);
    const belowPivot = _v.clone().sub(pivotW).dot(axW) < -1e-6;
    _v.applyMatrix4(inv);
    p[0] = _v.x; p[1] = _v.y; p[2] = _v.z;
    let inside = false;
    for (const pc of solids) if (insidePiece(pc, p)) { inside = true; break; }
    if (inside) continue;
    const under = rayHitsAny(solids, p, axd);
    if (under || belowPivot) {
      bad++;
      if (!where) where = `unit (${p.map((x) => x.toFixed(2)).join(", ")})${under ? " under the shoe" : " below the ankle"}`;
    }
  }
  return { bad, where };
}

// ---------------------------------------------------------------- 1. geometry
console.log("GEOMETRY");
for (const st of STYLES) for (const lod of [1, 2]) for (const side of [-1, 1]) {
  const G = FW.geometry(st, lod, side), tag = `${st} lod${lod} side${side}`;
  check(G === FW.geometry(st, lod, side), `${tag} cached`);
  let tris = 0;
  for (const [nm, g] of [["upper", G.upper], ["trim", G.trim], ["skin", G.skin]]) {
    if (!g) continue;
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    check(P.every(Number.isFinite) && N.every(Number.isFinite), `${tag} ${nm} finite`);
    check(g._shared === true, `${tag} ${nm} shared`);
    tris += g.index.count / 3;
    for (const pc of pieces(g)) {
      // closed: every undirected edge (by welded vertex) used exactly twice
      const E = new Map();
      for (let t = 0; t < pc.keys.length; t += 3) for (let k = 0; k < 3; k++) {
        const a = pc.keys[t + k], b = pc.keys[t + (k + 1) % 3];
        if (a === b) continue;
        const e = a < b ? a + "_" + b : b + "_" + a;
        E.set(e, (E.get(e) || 0) + 1);
      }
      let open = 0; for (const c of E.values()) if (c !== 2) open++;
      check(open === 0, `${tag} ${nm}: a closed solid (${open} open edges)`, `${st} ${nm} closed`);
      // outward: positive signed volume
      let vol = 0; const A = pc.tris;
      for (let t = 0; t < A.length; t += 9) {
        vol += (A[t] * (A[t + 4] * A[t + 8] - A[t + 5] * A[t + 7]) - A[t + 1] * (A[t + 3] * A[t + 8] - A[t + 5] * A[t + 6]) + A[t + 2] * (A[t + 3] * A[t + 7] - A[t + 4] * A[t + 6])) / 6;
      }
      check(vol > 0, `${tag} ${nm}: wound outward (volume ${vol.toExponential(2)})`, `${st} ${nm} outward`);
    }
  }
  check(lod === 1 ? tris <= 800 : tris <= 320, `${tag}: ${tris} tris in budget`);
  if (side === 1) console.log(`  ${st.padEnd(9)} lod${lod}: ${tris} tris`);
}

// ---------------------------------------------------------------- 2. containment over the ankle range
console.log("CONTAINMENT (ankle range sweep)");
const base = { skin: 0xb87955, torso: 0x315f94, collar: 0x315f94, arms: 0x315f94, legs: 0x202c3c, shoes: 0x201a18, hair: 0x2b1b12 };
const BODIES = {
  man: {}, woman: { build: "f" }, child: { age: 7 },
  "man shorts": { shins: 0xb87955 }, "woman shorts": { build: "f", shins: 0xb87955 },
};
let sweeps = 0;
for (const st of STYLES) {
  for (const [bn, o] of Object.entries(BODIES)) {
    const c = Object.assign({}, base, o, { footwear: st });
    if (st === "bare") c.shoes = c.skin;
    const r = CBZ.makeCharacter(c);
    const legs = [r.parts.ll, r.parts.rl];
    check(r.parts.ll.userData.cap.userData.shoeStyle === st, `${bn} ${st}: wears it (${r.parts.ll.userData.cap.userData.shoeStyle})`);
    const fl = FW.STYLES[st].flex;
    let worst = null;
    for (let k = 0; k <= 6; k++) {
      const a = fl[0] + (fl[1] - fl[0]) * k / 6;
      for (const roll of [0, 0.12, -0.12]) {
        for (const leg of legs) { leg.userData.foot.rotation.set(a, 0, roll); }
        r.group.updateMatrixWorld(true);
        for (const leg of legs) {
          const L = legLeaks(leg);
          sweeps++;
          check(L.bad === 0, `${bn} ${st} ankle ${a.toFixed(2)} roll ${roll}: ${L.bad} leg vertices show through the shoe at ${L.where}`, `sweep ${st} ${bn}`);
          if (L.bad && !worst) worst = a;
        }
      }
    }
  }
}
console.log(`  ${sweeps} leg x angle sweeps`);
// the test has teeth: put the OLD bug back (the shin running on to the sole
// line and past it) and it must be caught, stood up and lying
{
  for (const [bn, o] of [["trousers", {}], ["bare shin", { shins: 0xb87955 }]]) {
    const r = CBZ.makeCharacter(Object.assign({}, base, o, { footwear: "sneaker" }));
    const leg = r.parts.ll, P = r.profile;
    CBZ.humanSetShinEnd(leg, P.legLo + 0.02 + 0.03);
    r.group.updateMatrixWorld(true);
    const L = legLeaks(leg);
    check(L.bad > 0, `self-test (${bn}): a shin run through the sole is caught (${L.bad} vertices)`);
  }
}

// ---------------------------------------------------------------- 3. the pose sweep (real animChar)
console.log("POSE SWEEP (live rig)");
const vmx = loadVerbsVM({ mode: "survival" });
const X = vmx.CBZ, XT = vmx.THREE;
check(!!(X.footwear && X.charAnkleSolve), "the verbs vm loaded footwear + the ankle solve");
const DT = 1 / 60;
// the renderer updates every matrixWorld once a frame; the vm has no renderer
function run(a, sec, speed) { vmx.setSpeed(a, speed || 0); for (let t = 0; t < sec; t += DT) { vmx.frame(DT); for (const x of vmx.actors) x.char.group.updateMatrixWorld(true); } }
const footAngle = (leg) => leg.userData.foot.rotation.x;
function soleStats(ch, leg) {
  // the sole's bottom face: the lowest (unit space) vertices under the heel and
  // under the ball, in the world
  const shoe = leg.userData.cap, src = shoe.userData.trim && shoe.userData.trim.visible ? shoe.userData.trim : shoe;
  src.updateMatrixWorld(true);
  const pos = src.geometry.attributes.position, v = new XT.Vector3();
  const heelZ = (z) => z < -0.3, ballZ = (z) => z > 0.12 && z < 0.34;
  let hMin = Infinity, bMin = Infinity;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i), y = pos.getY(i);
    if (heelZ(z)) hMin = Math.min(hMin, y); else if (ballZ(z)) bMin = Math.min(bMin, y);
  }
  let min = Infinity; const heel = [], ball = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const uz = v.z, uy = v.y;
    v.applyMatrix4(src.matrixWorld);
    min = Math.min(min, v.y);
    if (heelZ(uz) && uy < hMin + 0.01) heel.push(v.y); else if (ballZ(uz) && uy < bMin + 0.01) ball.push(v.y);
  }
  const avg = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  return { min, heel: avg(heel), ball: avg(ball) };
}
function containment(ch, tag, st) {
  for (const leg of [ch.parts.ll, ch.parts.rl]) {
    const L = legLeaks(leg);
    check(L.bad === 0, `${tag} [${st}]: ${L.bad} leg vertices show through the shoe at ${L.where}`, `pose ${tag} ${st}`);
  }
}
const POSE_STYLES = ["sneaker", "oxford", "combat", "cowboy", "slipon", "sandal", "bare"];
const summary = [];
for (const st of POSE_STYLES) {
  const mk = (o) => {
    vmx.clearActors();
    const c = Object.assign({ footwear: st, bot: true }, o || {});
    if (st === "bare") { c.skin = 0xc68e62; c.shoes = 0xc68e62; c.legs = 0x1a4a8a; c.shins = 0xc68e62; }
    const a = vmx.actor(c);
    a.char.group.position.set(0, 0, 0);
    return a;
  };
  // STAND
  let a = mk();
  run(a, 1.2, 0);
  a.char.group.updateMatrixWorld(true);
  containment(a.char, "stand", st);
  for (const leg of [a.char.parts.ll, a.char.parts.rl]) {
    const s = soleStats(a.char, leg);
    check(Math.abs(s.min) < 0.01, `stand [${st}]: the sole sits on the floor (lowest point ${s.min.toFixed(3)})`, `stand floor ${st}`);
    check(Math.abs(s.heel - s.ball) < 0.012, `stand [${st}]: the sole is flat (heel ${s.heel.toFixed(3)} ball ${s.ball.toFixed(3)})`, `stand flat ${st}`);
  }
  // WALK + RUN (sample through the cycle)
  for (const [nm, sp] of [["walk", 3.2], ["run", 9]]) {
    a = mk();
    run(a, 0.6, sp);
    for (let k = 0; k < 8; k++) { run(a, 0.09, sp); a.char.group.updateMatrixWorld(true); containment(a.char, nm, st); }
  }
  // CROUCH, KNEEL, SIT
  a = mk(); a.char.crouch = true; run(a, 1.0, 0); a.char.group.updateMatrixWorld(true); containment(a.char, "crouch", st);
  a = mk(); a.char.kneelB = 1; run(a, 1.0, 0); a.char.group.updateMatrixWorld(true); containment(a.char, "kneel", st);
  a = mk(); a.char.sitting = true; run(a, 1.2, 0); a.char.group.updateMatrixWorld(true); containment(a.char, "sit", st);
  {
    let flat = 0;
    for (const leg of [a.char.parts.ll, a.char.parts.rl]) { const s = soleStats(a.char, leg); flat = Math.max(flat, Math.abs(s.heel - s.ball)); }
    check(flat < 0.03 || FW.STYLES[st].flex[1] < 0.3, `sit [${st}]: the soles lie flat (heel/ball ${flat.toFixed(3)})`, `sit flat ${st}`);
  }
  // SLEEP on a bed: back and side (propuse rolls the rig; the lying branch poses it)
  const lieAngles = [], lieWho = [];
  const lieAt = (who, ...v) => { for (const x of v) { lieAngles.push(x); lieWho.push(who); } };
  for (const [nm, rot] of [["sleep back", { x: -Math.PI / 2 }], ["sleep side", { z: Math.PI / 2 }]]) {
    a = mk(); a.char.lying = { back: nm.includes("back"), vary: 0.5 };
    if (rot.x) a.char.group.rotation.x = rot.x; if (rot.z) a.char.group.rotation.z = rot.z;
    a.char.group.position.y = 0.5;
    a.char.group.updateMatrixWorld(true);
    run(a, 1.2, 0); a.char.group.updateMatrixWorld(true);
    containment(a.char, nm, st);
    lieAt(nm, footAngle(a.char.parts.ll), footAngle(a.char.parts.rl));
  }
  // KO FALL (meleeposes): back and face
  if (X.meleePoses && X.meleePoses.startFall) {
    for (const v of ["back", "face"]) {
      a = mk(); run(a, 0.2, 0);
      X.meleePoses.startFall(a.char, { variant: v, hold: true, dur: 30 });
      for (let k = 0; k < 6; k++) { run(a, 0.35, 0); a.char.group.updateMatrixWorld(true); containment(a.char, "KO fall " + v, st); }
      lieAt("KO " + v, footAngle(a.char.parts.ll), footAngle(a.char.parts.rl));
    }
  }
  // GRAPPLE KNOCKDOWN (the downed body grapple.js owns; animChar is skipped)
  if (X.body && X.body.hit) {
    a = mk(); run(a, 0.2, 0);
    X.body.hit(a, { force: 9, knockdown: 3, dir: { x: 0, z: 1 } });
    for (let k = 0; k < 5; k++) { run(a, 0.3, 0); a.char.group.updateMatrixWorld(true); containment(a.char, "knockdown", st); }
    const tilt = Math.abs(a.char.group.rotation.x);
    if (tilt > 1.0) lieAt("knockdown", footAngle(a.char.parts.ll), footAngle(a.char.parts.rl));
    check(tilt > 1.0, `knockdown [${st}]: the body is down (${tilt.toFixed(2)} rad)`, "knockdown down");
  }
  // DEAD: the three deathPose templates
  for (const [seed, fall] of [[0.1, 0.0], [0.33, 0.6], [0.9, 1.0], [1.7, 0.2], [2.9, 0.9]]) {
    a = mk(); run(a, 0.2, 0);
    a.dead = true;
    X.deathPose(a.char, seed, fall);
    a.char.group.rotation.x = -Math.PI / 2; a.char.group.updateMatrixWorld(true);
    containment(a.char, "dead", st);
    lieAt("dead " + seed, footAngle(a.char.parts.ll), footAngle(a.char.parts.rl));
  }
  // lying feet fall slack (plantar flexion, to the style's own limit)
  const want = Math.min(0.2, FW.STYLES[st].flex[1] - 0.01);
  const low = Math.min(...lieAngles), lowWho = lieWho[lieAngles.indexOf(low)];
  check(low >= want, `lying [${st}]: the feet fall slack (least ${low.toFixed(2)} rad in ${lowWho}, want >= ${want.toFixed(2)})`, `lying slack ${st}`);
  summary.push(`${st} lying feet ${low.toFixed(2)}..${Math.max(...lieAngles).toFixed(2)} rad`);
}
console.log("  " + summary.join("\n  "));
if (vmx.errors.length) console.log("  vm errors: " + vmx.errors.slice(0, 3).join(" | "));

// ---------------------------------------------------------------- 4. role
console.log("ROLE");
const role = (rec, extra) => {
  const r = CBZ.makeCharacter(Object.assign({}, base, extra || {}));
  const slot = r.skinSlots.shoes[0], len0 = r.skinSlots.legsLower[0].userData.limb.len;
  FW.restyle(r, rec, Object.assign({}, base, extra || {}, rec.colors || {}));
  return { r, slot, len0, style: r.parts.ll.userData.cap.userData.shoeStyle };
};
for (const [id, want] of [["inmate", "slipon"], ["corrections", "combat"], ["suit", "oxford"], ["lifeguard", "flipflop"], ["sheriff", "cowboy"], ["construction", "work"], ["hoodie", "sneaker"], ["cabincrew", "loafer"]]) {
  const R = role({ id, tier: "work" });
  check(R.style === want, `${id} wears ${want} (got ${R.style})`);
  check(R.r.skinSlots.shoes[0] === R.slot && R.r.parts.ll.userData.cap === R.slot, `${id}: the slot mesh keeps its identity`);
  const L = R.r.skinSlots.legsLower[0], end = L.position.y + L.geometry.userData.limb.y0 - L.geometry.userData.limb.sy;
  const foot = R.r.parts.ll.userData.foot, d = foot.userData.dims;
  check(Math.abs(end - (d.sole + FW.STYLES[want].hem * d.H)) < 1e-6, `${id}: the trouser leg re-ends at the ${want}'s hem`);
}
{
  const sw = CBZ.makeCharacter(Object.assign({}, base, { legs: 0xb87955, shins: 0xb87955, shoes: 0xb87955, pelvis: 0x1a4a8a }));
  check(sw.parts.ll.userData.cap.userData.shoeStyle === "bare", "a swimmer's skin-coloured shoe is a bare foot");
  const g = sw.parts.ll.userData.cap.geometry, g2 = sw.parts.rl.userData.cap.geometry;
  check(g !== g2, "bare feet are a left and a right foot (the big toe on the inside)");
}

console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
