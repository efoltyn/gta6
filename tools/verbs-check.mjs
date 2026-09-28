#!/usr/bin/env node
/* tools/verbs-check.mjs — DO THE HANDS ACTUALLY GO ON, AND DOES THE WORLD
   DECIDE WHAT HAPPENS?

   Two REAL rigs (entities/character.js makeCharacter, with the first-person
   hands) and the REAL late pass (systems/verbs.js + entities/verbposes.js,
   physics.js's groundAt/collide, grapple.js's body physics), run frame by
   frame at 60 fps in plain node (tools/lib/verbs-vm.mjs). For EVERY verb:

     1. every phase it enters comes in the canonical order (approach, align,
        contact, drive, outcome, hold, release) and the session ENDS;
     2. while a hand is marked on (contact/drive/hold), the posed hand's grip
        point is within 5 cm of the partner's contact point, measured off the
        live rig (not trusted from the solver);
     3. the two torsos never interpenetrate (oriented-box SAT on the chest and
        waist meshes, 1.5 cm allowance for cloth);
     4. context() names the right feature for a wall, a waist-high rail with a
        drop behind it, a ledge, water, a bed, a table and open ground, and a
        shove / throw into each lands where that feature sends a body;
     5. cuffed wrists: behind the back, the wrist creases within 5 cm of each
        other, each tie ring ON its wrist (< 3 cm) and the link between them
        within 3 cm of each wrist.

     node tools/verbs-check.mjs          exit 0 = ok      --verbose  per-frame */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";

const VERBOSE = process.argv.includes("--verbose");
const DT = 1 / 60;
const TOL_HAND = 0.05, TOL_PEN = 0.015;
const PH = ["approach", "align", "contact", "drive", "outcome", "hold", "release"];
const rows = [];
let fails = 0;
const t0 = Date.now();

function vmFor(mode) { return loadVerbsVM({ mode }); }

/* ---- oriented-box SAT: how deep do two boxes overlap (<=0 = apart) ---- */
function boxOf(THREE, mesh) {
  const g = mesh.geometry.parameters || {};
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld, c = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(c, q, s);
  const ax = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((v) => v.applyQuaternion(q));
  return { c, ax, h: [(g.width || 0) * s.x / 2, (g.height || 0) * s.y / 2, (g.depth || 0) * s.z / 2] };
}
function penetration(THREE, A, B) {
  const axes = [...A.ax, ...B.ax];
  for (const a of A.ax) for (const b of B.ax) { const c = new THREE.Vector3().crossVectors(a, b); if (c.lengthSq() > 1e-8) axes.push(c.normalize()); }
  const d = new THREE.Vector3().subVectors(B.c, A.c);
  let minOver = Infinity;
  for (const L of axes) {
    const ra = A.h[0] * Math.abs(A.ax[0].dot(L)) + A.h[1] * Math.abs(A.ax[1].dot(L)) + A.h[2] * Math.abs(A.ax[2].dot(L));
    const rb = B.h[0] * Math.abs(B.ax[0].dot(L)) + B.h[1] * Math.abs(B.ax[1].dot(L)) + B.h[2] * Math.abs(B.ax[2].dot(L));
    const over = ra + rb - Math.abs(d.dot(L));
    if (over < minOver) minOver = over;
    if (minOver <= 0) return minOver;
  }
  return minOver;
}
function torsoPen(THREE, a, b) {
  const ta = a.char.skinSlots.torso, tb = b.char.skinSlots.torso;
  let worst = -Infinity;
  for (const ma of ta) for (const mb of tb) {
    if (!ma.parent || !mb.parent) continue;
    worst = Math.max(worst, penetration(THREE, boxOf(THREE, ma), boxOf(THREE, mb)));
  }
  return worst;
}

/* ---- one verb, frame by frame ---- */
function runVerb(v, spec, bodies) {
  const { CBZ, THREE } = v;
  const V = CBZ.verbs;
  v.clearActors();
  v.world(spec.world || {});
  const a = v.actor(Object.assign({ x: 0, z: 0, yaw: 0, bot: true, name: "A", physique: bodies ? bodies[0] : "average" }, spec.a || {}));
  const t = v.actor(Object.assign({ x: 0, z: 0.9, yaw: Math.PI, bot: true, name: "T", build: (bodies && bodies[2]) || "f", physique: bodies ? bodies[1] : "average" }, spec.t || {}));
  for (let i = 0; i < 6; i++) v.frame(DT);                 // settle both rigs into their idle
  if (spec.pre) spec.pre(v, a, t);
  const S = V[spec.verb](a, t, spec.opts || {});
  const row = { name: spec.name + (bodies && (bodies[0] !== "average" || bodies[1] !== "average") ? " " + bodies[0].slice(0, 3) + "/" + bodies[1].slice(0, 3) + (bodies[2] ? bodies[2] : "") : ""), verb: spec.verb, phases: [], okOrder: true, ended: false, onFrames: 0,
    maxA: 0, maxT: 0, pen: -1, outcome: "", ok: true, notes: [] };
  if (!S) { row.ok = false; row.notes.push("start() returned null"); return row; }
  const hp = new THREE.Vector3(), cp = new THREE.Vector3();
  let frames = 0, after = 0;
  const maxFrames = spec.frames || 600;
  while (frames < maxFrames) {
    v.frame(DT); frames++;
    if (!S.done) {
      if (row.phases[row.phases.length - 1] !== S.phase) row.phases.push(S.phase);
      if (spec.releaseAt && S.phase === "hold" && S.pt > spec.releaseAt && !S.how) V.release(S, spec.releaseHow || "set");
      if (spec.onFrame) spec.onFrame(v, S, a, t);
      // measured hands: grabber's
      for (let h = 0; h < 2; h++) {
        if (!S.onA[h] || !S.handsA[h] || S.tFree) continue;
        V.handPoint(a.char, h === 0 ? "l" : "r", hp);
        V.contactPoint(t.char, S.handsA[h], cp);
        const d = hp.distanceTo(cp);
        row.maxA = Math.max(row.maxA, d); row.onFrames++;
        if (VERBOSE && d > TOL_HAND) console.log(`  ${spec.name} f${frames} ${S.phase} k${S.k.toFixed(2)} A.${h ? "r" : "l"}->${S.handsA[h]} ${d.toFixed(3)}`);
      }
      for (let h = 0; h < 2; h++) {
        if (!S.onT[h] || !S.handsT[h] || S.tFree) continue;
        V.handPoint(t.char, h === 0 ? "l" : "r", hp);
        V.contactPoint(a.char, S.handsT[h], cp);
        const d = hp.distanceTo(cp);
        row.maxT = Math.max(row.maxT, d);
        if (VERBOSE && d > TOL_HAND) console.log(`  ${spec.name} f${frames} ${S.phase} k${S.k.toFixed(2)} T.${h ? "r" : "l"}->${S.handsT[h]} ${d.toFixed(3)}`);
      }
      if (S.phase !== "approach" && !S.tFree) {
        const p = torsoPen(THREE, a, t);
        if (p > row.pen) { row.pen = p; row.penAt = S.phase + "@" + S.k.toFixed(2); }
      }
    } else {
      // keep running while a follow-on session (a throw out of a grab), a
      // flight or grapple's body physics still has him
      after++;
      const busy = V.sessions.length || V.flights.length || (CBZ.body && CBZ.body.busy && CBZ.body.busy(t) && after < 150);
      if (!busy || after > 300) break;
    }
    // what he came to rest ON (a bed / table catches a body; we look while it lies there)
    const fl = V.flights.find((f) => f.a === t);
    if (fl && fl.mode === "down" && fl.surface && t.pos.y > fl.surface.y - 0.1) row.restedOn = fl.kind;
  }
  row.ended = S.done;
  row.outcome = (S.result && S.result.outcome) || "";
  // phase order
  let last = -1;
  for (const p of row.phases) { const i = PH.indexOf(p); if (i < last) row.okOrder = false; last = i; }
  if (!row.ended) { row.ok = false; row.notes.push("session never ended"); }
  if (!row.okOrder) { row.ok = false; row.notes.push("phase order " + row.phases.join(">")); }
  for (const need of spec.need || ["contact", "release"]) if (!row.phases.includes(need)) { row.ok = false; row.notes.push("no " + need); }
  if (row.maxA > TOL_HAND) { row.ok = false; row.notes.push(`grabber hand ${row.maxA.toFixed(3)} m off`); }
  if (row.maxT > TOL_HAND) { row.ok = false; row.notes.push(`target hand ${row.maxT.toFixed(3)} m off`); }
  if (row.pen > TOL_PEN) { row.ok = false; row.notes.push(`torsos overlap ${(row.pen * 100).toFixed(1)} cm (${row.penAt})`); }
  if (spec.expect && row.outcome !== spec.expect) { row.ok = false; row.notes.push(`outcome ${row.outcome || "-"} != ${spec.expect}`); }
  if (spec.after) { const msg = spec.after(v, S, a, t, row); if (msg) { row.ok = false; row.notes.push(msg); } }
  const errs = v.errors.splice(0);
  if (errs.length) { row.ok = false; row.notes.push("threw: " + errs[0].split("\n")[0]); }
  return row;
}

/* ---- the fake worlds (target stands at z 0.9 facing -z; the grabber at the
       origin faces +z, so every outcome is "along +z past him") ---- */
const W = {
  open: {},
  wall: { colliders: [{ minX: -3, maxX: 3, minZ: 1.75, maxZ: 2.15 }] },
  rail: { colliders: [{ minX: -3, maxX: 3, minZ: 1.55, maxZ: 1.62, y0: 0, y1: 1.05 }], floor: (x, z) => (z > 1.62 ? -4 : 0) },
  ledge: { floor: (x, z) => (z > 1.55 ? -4 : 0) },
  water: { floor: (x, z) => (z > 1.5 ? -2.2 : 0), water: (x, y, z) => (z > 1.5 ? 0 - y : 0) },
  bed: { beds: [{ x: 0, y: 0, z: 2.3, top: 0.55, kind: "bed" }] },
  table: { platforms: [{ minX: -0.7, maxX: 0.7, minZ: 1.75, maxZ: 2.6, top: 0.78 }] },
};

function contextChecks(v) {
  const { CBZ, THREE } = v;
  const out = [];
  for (const k of Object.keys(W)) {
    v.world(W[k]);
    const c = CBZ.verbs.context(new THREE.Vector3(0, 0, 0.9), { x: 0, z: 1 }, 2.2);
    out.push({ want: k, got: c.kind, dist: c.dist });
  }
  v.world({});
  return out;
}

function landedAfter(kind) {
  return function (v, S, a, t, row) {
    const p = t.pos;
    switch (kind) {
      case "wall": {
        const hit = v.slams.some((s) => s.a === t && s.wall);
        if (!hit) return "no wall slam registered";
        if (p.z > 1.75) return `went through the wall (z ${p.z.toFixed(2)})`;
        return null;
      }
      case "rail": return p.z > 1.62 && p.y < -2 ? null : `not over the rail (z ${p.z.toFixed(2)} y ${p.y.toFixed(2)})`;
      case "ledge": return p.y < -2 ? null : `did not go off the ledge (y ${p.y.toFixed(2)})`;
      case "water": return p.z > 1.5 ? null : `not in the water (z ${p.z.toFixed(2)})`;
      case "bed": return row.restedOn === "bed" ? null : `never lay on the bed (end z ${p.z.toFixed(2)} y ${p.y.toFixed(2)})`;
      case "table": return row.restedOn === "table" ? null : `never lay on the table (end y ${p.y.toFixed(2)})`;
      case "open": return Math.abs(p.y) < 0.2 ? null : `not on the ground (y ${p.y.toFixed(2)})`;
    }
    return null;
  };
}

/* ---- the table of verbs ---- */
const specs = [];
specs.push({ name: "grab", verb: "grab", need: ["contact", "drive", "hold", "release"], releaseAt: 1.0 });
specs.push({ name: "mug", verb: "mug", need: ["contact", "drive", "outcome", "release"], expect: "took" });
specs.push({ name: "carry", verb: "carry", need: ["contact", "drive", "hold", "release"], releaseAt: 1.2, frames: 900 });
specs.push({ name: "carry+walk", verb: "carry", need: ["contact", "drive", "hold", "release"], releaseAt: 2.0, frames: 900,
  onFrame(v, S, a) { if (S.phase === "hold") { a.pos.z += 1.2 * DT; v.setSpeed(a, 1.2); } else v.setSpeed(a, 0); } });
specs.push({ name: "escort+walk", verb: "escort", need: ["contact", "hold", "release"], releaseAt: 2.0,
  onFrame(v, S, a) { if (S.phase === "hold") { a.pos.z += 1.3 * DT; v.setSpeed(a, 1.3); } else v.setSpeed(a, 0); } });
specs.push({ name: "shield", verb: "shield", need: ["contact", "hold", "release"], releaseAt: 1.0, t: { z: 3.0 } });
specs.push({ name: "choke", verb: "choke", need: ["contact", "drive", "hold", "release"], opts: { ko: 2.0 }, expect: "ko" });
specs.push({ name: "frisk", verb: "frisk", need: ["contact", "drive", "release"] });
specs.push({ name: "cuff", verb: "cuff", need: ["contact", "drive", "outcome", "release"], expect: "cuffed",
  after(v, S, a, t) { return cuffCheck(v, t); } });
specs.push({ name: "uncuff", verb: "uncuff", need: ["contact", "drive", "outcome", "release"], expect: "uncuffed",
  pre(v, a, t) { v.CBZ.verbs.setCuffs(t, true); for (let i = 0; i < 20; i++) v.frame(DT); },
  after(v, S, a, t) { return t.char.cuffed ? "still cuffed" : null; } });
specs.push({ name: "drag", verb: "drag", need: ["contact", "hold", "release"], releaseAt: 1.5, frames: 900,
  pre(v, a, t) { t.ko = 30; v.CBZ.body.knockdown(t, { dir: { x: 0, z: 1 }, t: 30 }); for (let i = 0; i < 60; i++) v.frame(DT); },
  onFrame(v, S, a) { if (S.phase === "hold") { a.pos.z -= 1.0 * DT; v.setSpeed(a, 1.0); } else v.setSpeed(a, 0); } });
specs.push({ name: "tackle", verb: "tackle", need: ["contact", "drive", "outcome", "release"], expect: "open", t: { z: 2.2 } });
specs.push({ name: "tackle@wall", verb: "tackle", need: ["contact", "drive", "outcome", "release"], expect: "wall", world: W.wall, t: { z: 1.2 },
  after: landedAfter("wall") });
for (const k of ["open", "wall", "rail", "ledge", "water", "bed", "table"]) {
  specs.push({ name: "shove@" + k, verb: "shove", need: ["contact", "drive", "release"], expect: k, world: W[k], after: landedAfter(k) });
  specs.push({ name: "throw@" + k, verb: "throw", need: ["contact", "drive", "release"], expect: k, world: W[k], after: landedAfter(k) });
}
specs.push({ name: "grab>throw@ledge", verb: "grab", need: ["contact", "drive", "hold"], world: W.ledge,
  onFrame(v, S) { if (S.phase === "hold" && S.pt > 0.4) v.CBZ.verbs.release(S, "throw"); },
  after(v, S, a, t) { return t.pos.y < -2 ? null : `the throw out of the grab did not go off the ledge (y ${t.pos.y.toFixed(2)})`; } });
specs.push({ name: "carry>throw@water", verb: "carry", need: ["contact", "drive", "hold"], world: W.water, frames: 900,
  onFrame(v, S) { if (S.phase === "hold" && S.pt > 0.4) v.CBZ.verbs.release(S, "throw"); },
  after(v, S, a, t) { return t.pos.z > 1.5 ? null : `the throw off the shoulder did not reach the water (z ${t.pos.z.toFixed(2)})`; } });

function cuffCheck(v, t) {
  const { CBZ, THREE } = v;
  for (let i = 0; i < 30; i++) v.frame(DT);
  const ch = t.char;
  if (!ch.cuffed) return "not cuffed";
  const L = new THREE.Vector3(), R = new THREE.Vector3();
  CBZ.verbPoses.wristWorld(ch, 1, L); CBZ.verbPoses.wristWorld(ch, -1, R);
  const gap = L.distanceTo(R);
  // behind the back: in the body's own frame, past the back surface
  const P = ch.profile, back = Math.max(P.torsoD, P.pelvisD, P.waistD || 0) / 2;
  const lL = ch.body.worldToLocal(L.clone()), lR = ch.body.worldToLocal(R.clone());
  const rings = [], link = [];
  ch.group.traverse((o) => { if (o.name === "cuff-ring") rings.push(o); if (o.name === "cuff-link") link.push(o); });
  const rc = rings.map((r) => r.getWorldPosition(new THREE.Vector3()));
  const ringOff = Math.max(Math.min(rc[0].distanceTo(L), rc[0].distanceTo(R)), Math.min(rc[1].distanceTo(L), rc[1].distanceTo(R)));
  const lc = link[0] ? link[0].getWorldPosition(new THREE.Vector3()) : null;
  const linkOff = lc ? Math.max(lc.distanceTo(L), lc.distanceTo(R)) : 9;
  cuffStats = { gap, zL: lL.z, zR: lR.z, back, ringOff, linkOff };
  if (gap > 0.05) return `wrists ${(gap * 100).toFixed(1)} cm apart`;
  if (lL.z > -back || lR.z > -back) return "wrists not behind the back";
  if (rings.length !== 2 || ringOff > 0.03) return `ties not on the wrists (${(ringOff * 100).toFixed(1)} cm)`;
  if (linkOff > 0.03) return `tie link ${(linkOff * 100).toFixed(1)} cm off a wrist`;
  return null;
}
let cuffStats = null;

// ---- run: survival (grapple integrates the bots) and escape (verbs flies them)
const results = [];
const vS = vmFor("survival");
const ctxRows = contextChecks(vS);
for (const c of ctxRows) if (c.want !== c.got) { fails++; console.log(`FAIL context ${c.want}: got ${c.got}`); }
/* EVERY BODY TYPE (character.js PHYSIQUE): the contact points are read off
   each body's own shape, so the verbs run on every physique, same-type pairs
   and the two broad types against each other (the widest chest meets the
   deepest belly). */
const PAIRS = [["average", "average"], ["slim", "slim"], ["heavy", "heavy"], ["muscular", "muscular"], ["heavy", "muscular"], ["muscular", "heavy"], ["slim", "heavy"], ["heavy", "heavy", "m"], ["muscular", "heavy", "m"]];
for (const bodies of PAIRS) for (const s of specs) { const r = runVerb(vS, s, bodies); r.mode = "surv"; results.push(r); }
// ---- the survival PLAYER's keys (systems/grapple.js), through the player adapter
function playerRun(v, name, act, check) {
  const { CBZ } = v;
  v.clearActors(); v.world(W.ledge);
  CBZ.player.pos.set(0, 0, 0);
  CBZ.playerChar.group.position.set(0, 0, 0);
  CBZ.playerChar.group.rotation.set(0, 0, 0);
  CBZ.cam.yaw = Math.PI;                                  // looking down +z
  const t = v.actor({ x: 0, z: 1.0, yaw: Math.PI, bot: true, build: "f", name: "T" });
  v.actors.push({ char: CBZ.playerChar, pos: CBZ.player.pos, dead: false, name: "player" });
  for (let i = 0; i < 6; i++) v.frame(DT);
  const row = { name, verb: name, mode: "surv", phases: [], okOrder: true, onFrames: 0, maxA: 0, maxT: 0, pen: -1, outcome: "", ok: true, notes: [] };
  act(v, t, row);
  const msg = check(v, t, row);
  if (msg) { row.ok = false; row.notes.push(msg); }
  const errs = v.errors.splice(0);
  if (errs.length) { row.ok = false; row.notes.push("threw: " + errs[0].split("\n")[0]); }
  return row;
}
results.push(playerRun(vS, "player E>LMB", (v, t, row) => {
  const V = v.CBZ.verbs, G = v.CBZ.grapple;
  G.grab();
  const S = V.sessionOf(t);
  for (let i = 0; i < 90; i++) { v.frame(DT); if (S && row.phases[row.phases.length - 1] !== S.phase) row.phases.push(S.phase); }
  row.outcome = G.holding() ? "held" : "-";
  G.punch();                                             // LMB while holding = throw
  for (let i = 0; i < 240; i++) v.frame(DT);
}, (v, t, row) => (row.outcome !== "held" ? "grapple.grab() did not take hold" : t.pos.y < -2 ? null : `the throw did not send him off the ledge (y ${t.pos.y.toFixed(2)})`)));
results.push(playerRun(vS, "player RMB", (v, t, row) => {
  v.CBZ.grapple.push();
  const S = v.CBZ.verbs.sessionOf(t);
  for (let i = 0; i < 240; i++) { v.frame(DT); if (S && !S.done && row.phases[row.phases.length - 1] !== S.phase) row.phases.push(S.phase); }
  row.outcome = S && S.result ? S.result.outcome : "-";
}, (v, t, row) => (row.outcome === "ledge" && t.pos.y < -2 ? null : `shove did not put him off the ledge (${row.outcome}, y ${t.pos.y.toFixed(2)})`)));
results.push(playerRun(vS, "player LMB", (v, t, row) => {
  const hp0 = t.hp;
  v.CBZ.surv = { hurt(a, dmg) { a.hp -= dmg; } };
  v.CBZ.grapple.punch();
  for (let i = 0; i < 60; i++) v.frame(DT);
  row.outcome = t.hp < hp0 ? "landed" : "whiff";
  v.CBZ.surv = undefined;
}, (v, t, row) => (v.CBZ.verbs.strike ? (row.outcome === "landed" ? null : "the punch never landed on a man in reach") : null)));

const vE = vmFor("escape");

// ---- PHASE 2 ROUTES (prison): a guard's hands on the PLAYER, and the cast's ownership
function measureHands(v, S, row) {
  const { CBZ, THREE } = v, V = CBZ.verbs;
  const hp = new THREE.Vector3(), cp = new THREE.Vector3();
  for (let h = 0; h < 2; h++) {
    if (!S.onA[h] || !S.handsA[h] || S.tFree) continue;
    V.handPoint(S.A.ch, h === 0 ? "l" : "r", hp);
    V.contactPoint(S.T.ch, S.handsA[h], cp);
    row.maxA = Math.max(row.maxA, hp.distanceTo(cp)); row.onFrames++;
  }
}
function prisonRow(name) { return { name, verb: name, mode: "esc", phases: [], okOrder: true, onFrames: 0, maxA: 0, maxT: 0, pen: -1, outcome: "", ok: true, notes: [] }; }
{
  // THE ARREST, as capture.js runs it: tackle the man, he goes down, he gets
  // up, turned and cuffed standing, then marched (the guard walks, V.walk).
  const v = vE, { CBZ } = v, V = CBZ.verbs;
  v.clearActors(); v.world({});
  CBZ.player.pos.set(0, 0, 2.4); CBZ.playerChar.group.position.set(0, 0, 2.4); CBZ.playerChar.group.rotation.set(0, Math.PI, 0);
  const gd = v.actor({ x: 0, z: 0, yaw: 0, name: "guard" });
  CBZ.guards = [gd]; CBZ.npcs = [];
  v.actors.push({ char: CBZ.playerChar, pos: CBZ.player.pos, dead: false, name: "player" });
  for (let i = 0; i < 6; i++) v.frame(DT);
  const row = prisonRow("arrest (player)");
  // (rng: the braced-and-fresh "keep your feet" roll is arrest-check.mjs's; here he goes down)
  let S = V.tackle(gd, V.playerActor(), { far: true, rng: () => 0.99 });
  const seq = [];
  const run = (S, max, fn) => { for (let i = 0; i < max && S && !S.done; i++) { v.frame(DT); if (seq[seq.length - 1] !== S.verb + ":" + S.phase) seq.push(S.verb + ":" + S.phase); measureHands(v, S, row); if (fn) fn(S); } };
  run(S, 400);
  const tk = S ? S.result && S.result.outcome : "none";
  const fellDown = !!(CBZ.playerChar.fall && CBZ.playerChar.fall.on);
  if (V.getUp) V.getUp(V.playerActor());
  for (let i = 0; i < 180 && CBZ.playerChar.fall && CBZ.playerChar.fall.on; i++) v.frame(DT);
  S = V.cuff(gd, V.playerActor(), { far: true });
  run(S, 400);
  const cuffed = !!CBZ.playerChar.cuffed;
  S = V.escort(gd, V.playerActor(), { far: true });
  const z0 = CBZ.player.pos.z;
  run(S, 360, (S) => { if (S.phase === "hold") { if (V.walk(S, S, 0, 12, 1.35, DT) < 0.1) V.release(S, "set"); if (S.pt > 3) V.release(S, "set"); } });
  const marched = CBZ.player.pos.z - z0;
  row.phases = seq.map((x) => x.replace(/:(....).*/, ":$1"));
  row.outcome = cuffed ? "cuffed" : "-";
  const errs = v.errors.splice(0);
  if (tk !== "open") row.notes.push("tackle outcome " + tk);
  if (!fellDown) row.notes.push("no fall after the tackle");
  if (!cuffed) row.notes.push("not cuffed");
  if (!(marched > 1.5)) row.notes.push(`not marched (${marched.toFixed(2)} m)`);
  if (row.maxA > TOL_HAND) row.notes.push(`guard hand ${row.maxA.toFixed(3)} m off`);
  if (errs.length) row.notes.push("threw: " + errs[0].split("\n")[0]);
  row.ok = !row.notes.length;
  row.phases = ["tackle>fall>getup>cuff>escort " + marched.toFixed(1) + "m"];
  results.push(row);
  V.setCuffs(V.playerActor(), false);
  CBZ.guards = []; v.actors.length = 0;
}
{
  // A HELD INMATE IS THE VERB'S: V.held names him (npc.js / guards.js skip
  // him), the verb animates him, and a mover obeying that guard leaves him put.
  const v = vE, { CBZ } = v, V = CBZ.verbs;
  v.clearActors(); v.world({});
  const gd = v.actor({ x: 0, z: 0, yaw: 0, name: "guard" }), n = v.actor({ x: 0, z: 0.9, yaw: Math.PI, name: "inmate", build: "f" });
  CBZ.guards = [gd]; CBZ.npcs = [n];
  for (let i = 0; i < 6; i++) v.frame(DT);
  const row = prisonRow("held inmate");
  const S = V.escort(gd, n, {});
  let heldFrames = 0, drift = 0;
  for (let i = 0; i < 400 && !S.done; i++) {
    // the prison's own movers, with the one-line guard they now carry
    if (!(V.held && V.held(n))) n.pos.x += 1.5 * DT;
    v.frame(DT); measureHands(v, S, row);
    if (S.phase === "hold") {
      heldFrames++;
      const yaw = gd.char.group.rotation.y;
      drift = Math.max(drift, Math.abs((n.pos.x - gd.pos.x) * Math.cos(yaw) - (n.pos.z - gd.pos.z) * Math.sin(yaw)));
      if (S.pt > 1) V.release(S, "set");
    }
  }
  row.outcome = S.ownT ? "owned" : "-";
  if (!S.ownT) row.notes.push("prison cast not owned");
  if (!heldFrames) row.notes.push("never held");
  if (drift > 0.05) row.notes.push(`moved off the hold by ${drift.toFixed(2)} m`);
  if (V.held(n)) row.notes.push(`still held after release (done ${S.done} ${S.phase} flights ${V.flights.length} sess ${!!V.sessionOf(n)})`);
  if (row.maxA > TOL_HAND) row.notes.push(`hand ${row.maxA.toFixed(3)} m off`);
  const errs = v.errors.splice(0); if (errs.length) row.notes.push("threw: " + errs[0].split("\n")[0]);
  row.ok = !row.notes.length;
  row.phases = ["escort hold, AI mover guarded"];
  results.push(row);
  CBZ.guards = []; CBZ.npcs = [];
}
for (const bodies of PAIRS) for (const s of specs.filter((s) => /^(shove|throw)@/.test(s.name) || s.name === "tackle" || s.name === "carry")) {
  const r = runVerb(vE, s, bodies); r.mode = "esc"; results.push(r);
}

// ---- THE STRUGGLE (systems/arrest.js's contest): timed wrenches break a weak
// grip in a few; a guard's takes more; tools/arrest-check.mjs has the odds
{
  const v = vE, { CBZ } = v, V = CBZ.verbs;
  function tryBreak(grabberOpts, presses) {
    v.clearActors(); v.world({});
    CBZ.player.pos.set(0, 0, 0.9); CBZ.playerChar.group.position.set(0, 0, 0.9); CBZ.playerChar.group.rotation.set(0, Math.PI, 0);
    const a = v.actor(Object.assign({ x: 0, z: 0, yaw: 0, name: "grabber" }, grabberOpts));
    if (grabberOpts.kind) a.kind = grabberOpts.kind;
    v.actors.push({ char: CBZ.playerChar, pos: CBZ.player.pos, dead: false, name: "player" });
    for (let i = 0; i < 6; i++) v.frame(DT);
    const S = V.grab(a, V.playerActor(), {});
    let n = 0, lastPressBeat = -1;
    for (let i = 0; i < 900 && !S.done; i++) {
      v.frame(DT);
      // press once per beat, in the ease (the grabber's brace letting off)
      if (S.phase === "hold" && S.beat >= 0.6 && S.beat < 0.8 && n < presses && lastPressBeat !== Math.floor(S.age * 1.55)) {
        lastPressBeat = Math.floor(S.age * 1.55); V.press(); n++;
      }
      if (S.phase === "hold" && n >= presses && S.pt > 12) V.release(S, "set");
    }
    const out = { escaped: !!(S.result && S.result.outcome === "escaped"), grip0: S.grip0, presses: n };
    CBZ.player._wind = 1; CBZ.player._grappleT = 0;
    v.actors.length = 0;
    return out;
  }
  const weak = tryBreak({ build: "f", age: 13 }, 14);
  const strongMore = tryBreak({ kind: "guard" }, 14);
  // cuffs, once closed, hold whatever he does; an NPC that opts in fights a weak grip off
  v.clearActors();
  CBZ.player.pos.set(0, 0, 0.9); CBZ.playerChar.group.position.set(0, 0, 0.9); CBZ.playerChar.group.rotation.set(0, Math.PI, 0);
  const cop = v.actor({ x: 0, z: 0, yaw: 0, name: "cop" }); cop.kind = "cop";
  v.actors.push({ char: CBZ.playerChar, pos: CBZ.player.pos, dead: false, name: "player" });
  V.setCuffs(V.playerActor(), true);
  const E = V.escort(cop, V.playerActor(), {});
  // a press now and then (no pulling) does not tear a man in cuffs off his escort
  for (let i = 0; i < 400 && !E.done; i++) { v.frame(DT); if (E.phase === "hold" && i % 45 === 0) V.press(); if (E.phase === "hold" && E.pt > 5) V.release(E, "set"); }
  const cuffHeld = !(E.result && E.result.outcome === "escaped");
  V.setCuffs(V.playerActor(), false); v.actors.length = 0;
  v.clearActors();
  const bully = v.actor({ x: 0, z: 0, yaw: 0, build: "f", age: 12, name: "kid" }), fighter = v.actor({ x: 0, z: 0.9, yaw: Math.PI, name: "fighter" });
  for (let i = 0; i < 6; i++) v.frame(DT);
  const N = V.grab(bully, fighter, { struggle: 1 });
  for (let i = 0; i < 900 && !N.done; i++) v.frame(DT);
  const npcBroke = !!(N.result && N.result.outcome === "escaped");
  const row = prisonRow("struggle");
  if (!cuffHeld) row.notes.push("a few idle presses tore a cuffed man off his escort");
  if (!npcBroke) row.notes.push("an opted-in NPC never broke a weak grab");
  row.outcome = weak.escaped ? "escaped" : "-";
  if (!weak.escaped) row.notes.push(`a weak grip (${weak.grip0.toFixed(2)}) held through ${weak.presses} timed presses`);
  if (!strongMore.escaped) row.notes.push(`a guard's grip never broke (${strongMore.presses} presses)`);
  if (weak.escaped && strongMore.escaped && !(weak.presses < strongMore.presses)) row.notes.push(`a guard's grip broke as fast as a child's (${strongMore.presses} vs ${weak.presses})`);
  if (strongMore.escaped && strongMore.presses < 4) row.notes.push(`a guard's grip broke on ${strongMore.presses} presses`);
  const errs = v.errors.splice(0); if (errs.length) row.notes.push("threw: " + errs[0].split("\n")[0]);
  row.ok = !row.notes.length;
  row.phases = [`grip ${weak.grip0.toFixed(2)} in ${weak.presses} / guard ${strongMore.grip0.toFixed(2)} in ${strongMore.presses}, cuffs hold, npc brk`];
  results.push(row);
}

const pad = (s, n) => String(s).padEnd(n);
const QUIET = !VERBOSE && !process.argv.includes("--all");   // other physiques print only when they fail
console.log(pad("verb", 28) + pad("mode", 6) + pad("phases", 44) + pad("on", 5) + pad("handA", 7) + pad("handT", 7) + pad("pen cm", 8) + pad("outcome", 10) + "ok");
for (const r of results) {
  if (!r.ok) fails++;
  if (QUIET && r.ok && / [a-z]{3}\/[a-z]{3}m?$/.test(r.name)) continue;
  const ph = r.phases.map((p) => (p.indexOf(" ") >= 0 ? p : p.slice(0, 4))).join(">");
  console.log(pad(r.name, 28) + pad(r.mode, 6) + pad(ph, 44) + pad(r.onFrames, 5) + pad(r.maxA.toFixed(3), 7) + pad(r.maxT.toFixed(3), 7) +
    pad(r.pen > 0 ? (r.pen * 100).toFixed(1) : "-", 8) + pad(r.outcome || "-", 10) + (r.ok ? "ok" : "FAIL  " + r.notes.join("; ")));
}
console.log("context: " + ctxRows.map((c) => `${c.want}->${c.got}`).join("  "));
if (cuffStats) console.log(`cuffs: wrists ${(cuffStats.gap * 100).toFixed(1)} cm apart, z ${cuffStats.zL.toFixed(2)}/${cuffStats.zR.toFixed(2)} (back ${(-cuffStats.back).toFixed(2)}), ring on wrist ${(cuffStats.ringOff * 100).toFixed(1)} cm, link ${(cuffStats.linkOff * 100).toFixed(1)} cm`);
console.log(`loaded: ${JSON.stringify(vS.loaded)}  ${results.length} runs, ${fails} failing, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fails ? 1 : 0);
