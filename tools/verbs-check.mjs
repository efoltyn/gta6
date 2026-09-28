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
function runVerb(v, spec) {
  const { CBZ, THREE } = v;
  const V = CBZ.verbs;
  v.clearActors();
  v.world(spec.world || {});
  const a = v.actor(Object.assign({ x: 0, z: 0, yaw: 0, bot: true, name: "A" }, spec.a || {}));
  const t = v.actor(Object.assign({ x: 0, z: 0.9, yaw: Math.PI, bot: true, name: "T", build: "f" }, spec.t || {}));
  for (let i = 0; i < 6; i++) v.frame(DT);                 // settle both rigs into their idle
  if (spec.pre) spec.pre(v, a, t);
  const S = V[spec.verb](a, t, spec.opts || {});
  const row = { name: spec.name, verb: spec.verb, phases: [], okOrder: true, ended: false, onFrames: 0,
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
for (const s of specs) { const r = runVerb(vS, s); r.mode = "surv"; results.push(r); }
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
for (const s of specs.filter((s) => /^(shove|throw)@/.test(s.name) || s.name === "tackle" || s.name === "carry")) {
  const r = runVerb(vE, s); r.mode = "esc"; results.push(r);
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("verb", 20) + pad("mode", 6) + pad("phases", 44) + pad("on", 5) + pad("handA", 7) + pad("handT", 7) + pad("pen cm", 8) + pad("outcome", 10) + "ok");
for (const r of results) {
  if (!r.ok) fails++;
  const ph = r.phases.map((p) => p.slice(0, 4)).join(">");
  console.log(pad(r.name, 20) + pad(r.mode, 6) + pad(ph, 44) + pad(r.onFrames, 5) + pad(r.maxA.toFixed(3), 7) + pad(r.maxT.toFixed(3), 7) +
    pad(r.pen > 0 ? (r.pen * 100).toFixed(1) : "-", 8) + pad(r.outcome || "-", 10) + (r.ok ? "ok" : "FAIL  " + r.notes.join("; ")));
}
console.log("context: " + ctxRows.map((c) => `${c.want}->${c.got}`).join("  "));
if (cuffStats) console.log(`cuffs: wrists ${(cuffStats.gap * 100).toFixed(1)} cm apart, z ${cuffStats.zL.toFixed(2)}/${cuffStats.zR.toFixed(2)} (back ${(-cuffStats.back).toFixed(2)}), ring on wrist ${(cuffStats.ringOff * 100).toFixed(1)} cm, link ${(cuffStats.linkOff * 100).toFixed(1)} cm`);
console.log(`loaded: ${JSON.stringify(vS.loaded)}  ${results.length} runs, ${fails} failing, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fails ? 1 : 0);
