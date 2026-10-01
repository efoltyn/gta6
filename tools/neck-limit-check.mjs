#!/usr/bin/env node
/* tools/neck-limit-check.mjs — DOES A SHOT MAN'S HEAD STAY ON A NECK?

   Owner: "when shot in the jail game, people's head turns backward, which
   would break the neck." The REAL rig (entities/character.js), the REAL hit
   reactions (entities/meleeposes.js + systems/verbs_strike.js), the corpse
   fall (systems/bodyfall.js) and the city's verlet body (city/ragdoll.js),
   frame by frame in plain node (tools/lib/verbs-vm.mjs).

   Fires rounds from 16 compass directions at men facing 4 ways:
     LIVING   head / torso / either arm / either leg, four rounds a second,
              plus a hook to the jaw from each side
     DEAD     the jail's corpse (prisoncorpse -> bodyFall.start, dead) from
              every side, then a round into the head every third of a second
     RAGDOLL  the city's verlet throw from every side, hard
   and holds the neck to CBZ.human.neckLimits (yaw ~80, chin down ~60, back
   ~50, tilt ~40 degrees) in two ways:
     DRAWN    the angles the neck's matrix actually composes (what renders,
              what the hit zones read) — must always be inside the range
     STORED   rig.neck.rotation itself — a living or dead body's writers must
              not wind it past the range either (the drawn clamp is the
              safety net, not the fix)
   Plus the snap reads right: a head shot from the front throws the head
   back (chin up), from behind drives it forward (chin down).

     node tools/neck-limit-check.mjs        exit 0 = ok */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const DT = 1 / 60, D2R = 180 / Math.PI, EPS = 0.004;
let fails = 0;
function check(name, ok, detail) { console.log((ok ? "ok   " : "FAIL ") + name + (detail ? "  " + detail : "")); if (!ok) fails++; }

function meter(CBZ, THREE) {
  const L = CBZ.human && CBZ.human.neckLimits;
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
  const M = {
    L,
    reset() { M.drawn = { x0: 0, x1: 0, y: 0, z: 0 }; M.stored = { x0: 0, x1: 0, y: 0, z: 0 }; M.n = 0; },
    sample(ch) {
      const n = ch.neck, r = n.rotation;
      if (!(r.x === r.x && r.y === r.y && r.z === r.z)) { M.stored.y = Infinity; return; }
      n.updateMatrix();
      n.matrix.decompose(p, q, s);
      e.setFromQuaternion(q, r.order);
      for (const [o, v] of [[M.drawn, e], [M.stored, r]]) {
        o.x0 = Math.min(o.x0, v.x); o.x1 = Math.max(o.x1, v.x);
        o.y = Math.max(o.y, Math.abs(v.y)); o.z = Math.max(o.z, Math.abs(v.z));
      }
      M.n++;
    },
    inside(o) { return o.x1 <= L.flex + EPS && o.x0 >= -L.ext - EPS && o.y <= L.yaw + EPS && o.z <= L.roll + EPS; },
    fmt(o) { return "yaw " + (o.y * D2R).toFixed(0) + "  pitch " + (o.x0 * D2R).toFixed(0) + ".." + (o.x1 * D2R).toFixed(0) + "  roll " + (o.z * D2R).toFixed(0); },
  };
  M.reset();
  return M;
}

/* ---------------- LIVING + DEAD (the jail's paths) ---------------- */
{
  const W = loadVerbsVM({ mode: "escape" });
  const { CBZ, THREE } = W;
  const V = CBZ.verbs;
  if (!CBZ.human || !CBZ.human.neckLimits || !CBZ.human.clampNeck) { console.log("FAIL: CBZ.human.neckLimits / clampNeck missing"); process.exit(1); }
  if (!V || !V.shot || !CBZ.bodyFall) { console.log("FAIL: verbs.shot / bodyFall did not load"); process.exit(1); }
  const M = meter(CBZ, THREE);
  const L = M.L;
  check("limits are anatomical",
    L.yaw >= 70 / D2R && L.yaw <= 80.5 / D2R && L.flex >= 55 / D2R && L.flex <= 62 / D2R && L.ext >= 45 / D2R && L.ext <= 52 / D2R && L.roll >= 35 / D2R && L.roll <= 42 / D2R,
    "yaw " + (L.yaw * D2R).toFixed(0) + " flex " + (L.flex * D2R).toFixed(0) + " ext " + (L.ext * D2R).toFixed(0) + " roll " + (L.roll * D2R).toFixed(0));

  // the safety net itself: a writer that leaves the head turned backward
  {
    W.clearActors(); W.world({});
    const a = W.actor({ x: 0, z: 0, yaw: 0 });
    M.reset();
    for (const [x, y, z] of [[0, Math.PI, 0], [0, -2.6, 0], [-Math.PI * 0.9, 0, 0], [2.4, 0, 0], [0, 0, 1.6], [-2, 2.2, -1.4]]) {
      a.char.neck.rotation.set(x, y, z); M.sample(a.char);
    }
    check("drawn neck clamps a backward head", M.inside(M.drawn), M.fmt(M.drawn));
    a.char.neck.rotation.set(0, 0, 0);
  }

  const spawn = (yaw) => {
    W.clearActors(); W.world({});
    const a = W.actor({ x: 0, z: 0, yaw });
    for (let i = 0; i < 6; i++) W.frame(DT);
    return a;
  };
  const pointOf = (a, zone) => {
    const ch = a.char, p = new THREE.Vector3();
    a.group.updateMatrixWorld(true);
    if (zone === "head") ch.head.getWorldPosition(p);
    else if (zone === "torso") { ch.body.getWorldPosition(p); p.y += 0.5; }
    else if (zone === "armL" || zone === "armR") { (zone === "armL" ? ch.low.la : ch.low.ra).getWorldPosition(p); }
    else { (zone === "legL" ? ch.low.ll : ch.low.rl).getWorldPosition(p); p.y += 0.1; }
    return p;
  };
  const YAWS = [0, 0.3, 1.9, -2.4];
  for (const zone of ["head", "torso", "armL", "armR", "legL", "legR"]) {
    M.reset();
    for (const yaw of YAWS) for (let d = 0; d < 16; d++) {
      const a = spawn(yaw);
      const ang = d / 16 * Math.PI * 2, dx = Math.sin(ang), dz = Math.cos(ang);
      for (let s = 0; s < 4; s++) {
        V.shot(a, { point: pointOf(a, zone), dir: { x: dx, z: dz }, cal: 1.2, head: zone === "head" });
        for (let i = 0; i < 15; i++) { W.frame(DT); M.sample(a.char); }
      }
      for (let i = 0; i < 150; i++) { W.frame(DT); M.sample(a.char); }
    }
    check("living " + zone + ": drawn", M.inside(M.drawn), M.fmt(M.drawn));
    check("living " + zone + ": stored", M.inside(M.stored), M.fmt(M.stored));
  }
  // hooks to the jaw from either side (the stance's own counter-turn)
  if (V.react) {
    M.reset();
    for (const yaw of YAWS) for (const side of [1, -1]) {
      const a = spawn(yaw);
      for (let s = 0; s < 5; s++) {
        V.react(a, { zone: "jaw", kind: "hook", arm: side > 0 ? "l" : "r", power: 1, dir: { x: Math.cos(yaw) * side, z: -Math.sin(yaw) * side } });
        for (let i = 0; i < 20; i++) { W.frame(DT); M.sample(a.char); }
      }
      for (let i = 0; i < 90; i++) { W.frame(DT); M.sample(a.char); }
    }
    check("living hooks: drawn", M.inside(M.drawn), M.fmt(M.drawn));
    check("living hooks: stored", M.inside(M.stored), M.fmt(M.stored));
  }
  // the snap goes along the round: front -> head back, behind -> chin down
  {
    const snap = (from) => {
      const a = spawn(0);
      const base = a.char.neck.rotation.x;
      let lo = 0, hi = 0;
      V.shot(a, { point: pointOf(a, "head"), dir: { x: 0, z: from === "front" ? -1 : 1 }, cal: 1, head: true });
      for (let i = 0; i < 20; i++) { W.frame(DT); const dx = a.char.neck.rotation.x - base; lo = Math.min(lo, dx); hi = Math.max(hi, dx); }
      return { lo, hi };
    };
    const f = snap("front"), b = snap("back");
    check("head shot from the front throws the head back", f.lo < -0.15 && -f.lo > f.hi, "pitch " + (f.lo * D2R).toFixed(0) + ".." + (f.hi * D2R).toFixed(0));
    check("head shot from behind drives the chin down", b.hi > 0.15 && b.hi > -b.lo, "pitch " + (b.lo * D2R).toFixed(0) + ".." + (b.hi * D2R).toFixed(0));
  }

  // DEAD: the jail corpse falls along the round, then takes more rounds in the head
  M.reset();
  for (const yaw of YAWS) for (let d = 0; d < 16; d++) {
    const a = spawn(yaw);
    const ang = d / 16 * Math.PI * 2, dx = Math.sin(ang), dz = Math.cos(ang);
    a.dead = true;
    CBZ.bodyFall.start(a, { dirX: dx, dirZ: dz, force: 7, dead: true, hold: true });
    for (let i = 0; i < 240; i++) {
      CBZ.bodyFall.tick(a, DT); M.sample(a.char);
      if (i > 60 && i % 20 === 0) { const hp = new THREE.Vector3(); a.char.head.getWorldPosition(hp); CBZ.bodyFall.poke(a, dx, dz, 12, hp); }
    }
  }
  check("dead fall + rounds: drawn", M.inside(M.drawn), M.fmt(M.drawn));
  check("dead fall + rounds: stored", M.inside(M.stored), M.fmt(M.stored));
  if (W.errors.length) check("no runtime errors (jail vm)", false, W.errors[0]);
}

/* ---------------- RAGDOLL (the city's verlet body) ---------------- */
{
  const W = loadVerbsVM({ mode: "city" });
  const { CBZ, THREE } = W;
  CBZ.CONFIG.RAGDOLL_ANY_MODE = true;
  vm.runInContext(readFileSync(new URL("../src/city/ragdoll.js", import.meta.url), "utf8"), W.ctx, { filename: "src/city/ragdoll.js" });
  W.updaters.sort((x, y) => x.order - y.order);
  if (!CBZ.cityRagdoll) { check("city/ragdoll.js loads", false); }
  else {
    const M = meter(CBZ, THREE);
    let refused = 0;
    for (let d = 0; d < 16; d++) for (const py of [1.6, 1.0]) {
      W.clearActors(); W.world({});
      const a = W.actor({ x: 0, z: 0, yaw: d * 0.7 });
      CBZ.cityPeds = [a];
      for (let i = 0; i < 6; i++) W.frame(DT);
      const ang = d / 16 * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang);
      a.dead = true;
      if (!CBZ.cityRagdoll(a, { x: -dx * 0.25, y: py, z: -dz * 0.25 }, { x: dx, y: 0, z: dz }, 30)) { refused++; continue; }
      for (let i = 0; i < 360; i++) { W.frame(DT); M.sample(a.char); }
      CBZ.ragdollDrop(a);
      CBZ.cityPeds = [];
    }
    check("ragdoll took every body", refused === 0, refused + " refused");
    check("ragdoll death: drawn", M.inside(M.drawn), M.fmt(M.drawn));
    check("ragdoll death: stored", M.inside(M.stored), M.fmt(M.stored));
    if (W.errors.length) check("no runtime errors (city vm)", false, W.errors[0]);
  }
}

console.log(fails ? "\n" + fails + " FAIL" : "\nneck-limit-check: all ok");
process.exit(fails ? 1 : 0);
