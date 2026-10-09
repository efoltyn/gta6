#!/usr/bin/env node
/* tools/crowd-front-check.mjs — THE FRONT LINE IS REAL, in plain node.

   Owner (2026-10-09): "When I tell my Secret Service to shoot at a protester,
   the bullets don't show up on them... The front line, the people you're
   interacting with, should not be fake." And: "Shoot a protester. The sign
   stays up like a ghost is holding it."

   Loads the real entities/crowdstore.js + city/mob.js + systems/debris.js
   on three r128 in a vm, with the rig factory stubbed to a THREE.Group body
   (cityPostNpc) and the wound / kill funnels recording, then:
     A. a 2,000-strong protest held behind a police line: after the rig ticks
        the front rows (pressed on the line, in front of the player) are full
        rigs, inside the device budget;
     B. a round at a FRONT-ROW member (from the line): the man is a rig and
        the wound is on HIS body in the same step;
     C. a round at a MID-CROWD instanced member: the store promotes them on
        that very call (no step between) and the wound is on the new rig;
     D. a SIGN-HOLDER shot mid-crowd: the rig holds the sign at its hands the
        instant it is promoted; killed, the sign leaves the hands that
        instant as a loose rigid body, falls, and lies on the ground;
     E. a sign-holder who dies still instanced (no promotion): the sign drops
        (a loose body near the lens, flat on the ground past it), never hangs.

     node tools/crowd-front-check.mjs      exit 0 = PASS, 1 = FAIL */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeDocument } from "./lib/fake-canvas.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math, setTimeout, clearTimeout, performance, Date });
ctx.window = ctx; ctx.self = ctx; ctx.document = fakeDocument();
ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
ctx.addEventListener = () => {}; ctx.requestAnimationFrame = () => 0;
vm.runInContext(read("src/vendor/three.r128.min.js"), ctx, { filename: "three" });
const THREE = ctx.THREE;
const CBZ = ctx.CBZ = { CONFIG: {}, game: { mode: "city" }, onUpdate() {}, onAlways() {}, onReset() {}, onModeEnter() {}, deviceClass: "tablet" };
CBZ.scene = new THREE.Scene();
CBZ.floorAt = () => 0;
CBZ.cityPeds = []; CBZ.cityCops = [];
const P = CBZ.player = { pos: new THREE.Vector3(0, 0, -14) };
CBZ.camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 2000);
CBZ.camera.position.set(0, 1.7, -14); CBZ.camera.lookAt(0, 1.4, 30); CBZ.camera.updateMatrixWorld(true);

// ---- the recording funnels ----
const WOUNDS = [];
CBZ.bodyWound = (actor, p, o) => { WOUNDS.push({ actor, x: p.x, y: p.y, z: p.z, head: !!(o && o.head), step: STEP }); };
CBZ.cityKillPed = (ped, imp) => {
  if (!ped || ped.dead) return;
  ped.dead = true; ped.hp = 0;
  if (CBZ.dropHeldProp) CBZ.dropHeldProp(ped, imp);       // the line peds.js cityKillPed carries
};
CBZ.cityStreetShot = () => true;
// a full rig: a real THREE body you can hang a sign on (cityPostNpc's contract)
let PEDN = 0;
CBZ.cityPostNpc = (x, z, o) => {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = o.face || 0;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.3)); torso.position.y = 0.9; g.add(torso);
  CBZ.scene.add(g);
  const ped = { id: ++PEDN, pos: g.position, group: g, char: { sockets: {} }, hp: 100, state: "idle", kind: "civilian" };
  CBZ.cityPeds.push(ped);
  return ped;
};
CBZ.citySpawnCop = (x, z) => { const p = CBZ.cityPostNpc(x, z, {}); p.kind = "cop"; return p; };
CBZ.cityUnpostNpc = (ped) => { if (ped.group.parent) ped.group.parent.remove(ped.group); const i = CBZ.cityPeds.indexOf(ped); if (i >= 0) CBZ.cityPeds.splice(i, 1); return true; };
// president_public.js's placard, as it builds it (the board over both hands)
const boardMat = new THREE.MeshLambertMaterial({ color: 0xefe6cf });
CBZ.presidentPublic = { props: {
  sign(ped, text) {
    const pr = new THREE.Group(); pr.position.set(0, 1.8, 0.2);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 1.0, 6), boardMat); st.position.y = -0.12; pr.add(st);
    const bd = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.52, 0.02), boardMat); bd.position.y = 0.6; pr.add(bd);
    ped.group.add(pr); ped._pubProp = pr; ped._sign = text; if (ped.char) ped.char._pubProp = pr;
  },
  flag(ped) {
    const pr = new THREE.Group(); pr.position.set(-0.22, 1.72, 0.3);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.9, 6), boardMat); pr.add(st);
    ped.group.add(pr); ped._pubProp = pr; if (ped.char) ped.char._pubProp = pr;
  },
  signMats() { return null; },
} };

for (const f of ["src/systems/debris.js", "src/entities/crowdstore.js", "src/city/mob.js"]) vm.runInContext(read(f), ctx, { filename: f });
const ST = CBZ.crowds, M = CBZ.mob, D = CBZ.debris;
const fails = [];
const ok = (c, msg) => { if (!c) fails.push(msg); return c; };
let STEP = 0;
function step(n, dt = 1 / 30) {
  for (let k = 0; k < n; k++) { STEP++; ST._step(dt); M._step(dt); if (D && D.update) D.update(dt); }
}

// ---- A. a 2,000-strong protest, held behind a police line, facing the player
const id = M.form({ at: { x: 0, z: 0 }, face: Math.PI, size: 2000, side: "opposition", kind: "protest", hold: true, quiet: true, slogans: ["RESIGN"], violent: 0.1 });
ok(!!id, "the protest did not form");
M.line(id, { at: { x: 0, z: -1.6 }, face: 0, width: 16, n: 10, kind: "police" });
step(150);                                   // 5 s: the rig ticks run 25 times
const A = M._agents(), B = M.budget(), au = M.audit();
const G = M.group(id);
let front = 0, frontRig = 0, rigs = 0;
for (const i of G.rows) {
  if (A.amob[i] < 0 || A.aside[i] !== 0) continue;
  if (M.rigOf(i)) rigs++;
  if (M.tierOf(i) <= 3) { front++; if (M.rigOf(i)) frontRig++; }
}
console.log(`A. protest ${G.rows.length} rows, budget ${B.rigs} rigs (+${B.cops} officers): ${rigs} civilian rigs, front-tier ${frontRig}/${front} real, officers real ${au.copRigs}`);
ok(G.rows.length >= 1900, "the store holds " + G.rows.length + " rows, not 2,000");
ok(rigs <= B.rigs + 1, "over the rig budget: " + rigs);
ok(frontRig >= Math.min(front, B.rigs) - 2, "front rows not real: " + frontRig + " of " + front);
ok(au.copRigs > 0, "no line officer is a rig");

// a shooter's round through the shared path (mob.js lineFire): whoever is in
// the way through the store (promoted on the call), else the man aimed at
function fire(o, tgtPed, tx, ty, tz) {
  const dx0 = tx - o.x, dy0 = ty - o.y, dz0 = tz - o.z, l = Math.hypot(dx0, dy0, dz0);
  const dx = dx0 / l, dy = dy0 / l, dz = dz0 / l;
  const h = ST.ray(o.x, o.y, o.z, dx, dy, dz, tgtPed ? l - 0.6 : l + 2);
  if (h) { ST.shoot(h.row, { head: false, cal: 1, fromX: o.x, fromZ: o.z, point: { x: h.x, y: h.y, z: h.z } }); return { row: h.row, ped: ST.lastShotPed() }; }
  if (tgtPed) { ST.roundOnPed(tgtPed, { cal: 1, fromX: o.x, fromZ: o.z, point: { x: tx, y: ty, z: tz } }); return { row: -1, ped: tgtPed }; }
  return null;
}

// ---- B. the front row: the man pressed on the shields
let fRow = -1, best = -1e9;
for (const i of G.rows) {
  if (A.amob[i] < 0 || A.aside[i] !== 0 || !M.rigOf(i)) continue;
  const p = M.rigOf(i).pos;
  if (Math.abs(p.x) < 4 && -p.z > best) { best = -p.z; fRow = i; }
}
ok(fRow >= 0, "no front-row rig in front of the line");
if (fRow >= 0) {
  const ped = M.rigOf(fRow), w0 = WOUNDS.length, s0 = STEP;
  const r = fire({ x: ped.pos.x, y: 1.45, z: -1.6 }, ped, ped.pos.x, 1.3, ped.pos.z);
  const w = WOUNDS.slice(w0).filter((q) => q.actor === ped);
  console.log(`B. front row #${fRow}: rig ${!!ped}, wounds on him this step ${w.length}, hp ${ped.hp}`);
  ok(r && r.ped === ped, "the front-row round did not land on his rig");
  ok(w.length === 1 && w[0].step === s0, "the front-row wound was not on his body in the same step");
}

// ---- C. mid-crowd: an instanced body ten metres into the knot, shot from above
function midRow(pred) {
  for (const i of G.rows) {
    if (A.amob[i] < 0 || A.aside[i] !== 0 || M.rigOf(i) || ST.S.hide[i] || ST.life(i) !== ST.ALIVE) continue;
    const x = ST.S.x[i], z = ST.S.z[i];
    if (z > 8 && z < 14 && Math.abs(x) < 6 && pred(i)) return i;
  }
  return -1;
}
const cRow = midRow(() => true);
ok(cRow >= 0, "no instanced mid-crowd member");
if (cRow >= 0) {
  const x = ST.S.x[cRow], z = ST.S.z[cRow], w0 = WOUNDS.length, s0 = STEP, r0 = M.audit().rigs;
  const r = fire({ x: x, y: 9, z: z - 0.5 }, null, x, 1.2, z);
  const ped = M.rigOf(cRow);
  const w = WOUNDS.slice(w0).filter((q) => q.actor === ped);
  console.log(`C. mid-crowd #${cRow}: struck row ${r && r.row}, rig now ${!!ped} (hidden ${ST.S.hide[cRow]}), wounds on the new rig this step ${w.length}, rigs ${r0} -> ${M.audit().rigs}`);
  ok(r && r.row === cRow, "the round did not strike the mid-crowd member");
  ok(!!ped && ST.S.hide[cRow] === 1, "the struck mid-crowd member is still instanced");
  ok(w.length === 1 && w[0].step === s0, "the mid-crowd wound did not land on the new rig in the same step");
  ok(M.audit().rigs <= B.rigs + 1, "the forced promotion blew the budget");
}

// ---- D. a sign-holder, shot mid-crowd, then killed
const ROLE_SIGN = 3;
const dRow = midRow((i) => A.arole[i] === ROLE_SIGN);
ok(dRow >= 0, "no instanced sign-holder mid-crowd");
if (dRow >= 0) {
  const x = ST.S.x[dRow], z = ST.S.z[dRow], s0 = STEP;
  fire({ x: x, y: 9, z: z - 0.5 }, null, x, 1.2, z);
  const ped = M.rigOf(dRow);
  const pr = ped && ped._pubProp;
  const held = !!(pr && pr.parent === ped.group && Math.abs(pr.position.y - 1.8) < 0.05);
  console.log(`D. sign-holder #${dRow}: rig ${!!ped} on step ${STEP - s0}, sign in his hands ${held}, instanced role now ${A.arole[dRow]}`);
  ok(!!ped, "the shot sign-holder was not promoted");
  ok(held, "the promoted rig is not holding the sign at its hands");
  if (ped && pr) {
    const live0 = D.stats().live;
    ST.roundOnPed(ped, { head: true, cal: 1, fromX: x, fromZ: z - 6 });     // the kill
    const left = !ped._pubProp && pr.parent !== ped.group;
    const live1 = D.stats().live;
    console.log(`   killed (dead ${!!ped.dead}): sign out of his hands ${left}, loose rigid bodies ${live0} -> ${live1}`);
    ok(ped.dead, "the head shot did not kill him");
    ok(left, "the sign stayed with the dead man (the ghost holding it)");
    ok(live1 > live0, "the sign did not become a loose rigid body");
    // fall: track the newest body until it lies down
    const body = D._internal.live[D._internal.live.length - 1];
    const g0 = body ? new THREE.Box3().setFromObject(body.mesh) : null;
    // follow it down until it settles (sleeps) or is baked where it lies
    let g = g0, n = 0;
    while (n < 240 && body && D._internal.live.indexOf(body) >= 0 && !body.asleep) { step(1); n++; body.mesh.updateMatrixWorld(true); g = new THREE.Box3().setFromObject(body.mesh); }
    console.log(`   the sign fell: top ${g0 ? g0.max.y.toFixed(2) : "?"} m -> lying with its top at ${g ? g.max.y.toFixed(2) : "?"} m, lowest point ${g ? g.min.y.toFixed(3) : "?"} m, after ${(n / 30).toFixed(1)} s (${body && body.asleep ? "asleep" : "baked"})`);
    ok(!!g0 && g0.max.y > 2, "the sign was not up at the hands when it let go");
    ok(!!g && g.max.y < 0.6 && g.min.y > -0.08, "the dropped sign did not come to rest on the ground");
  }
}

// ---- E. an instanced sign-holder killed without promotion (a mass death)
const eRow = midRow((i) => A.arole[i] === ROLE_SIGN);
if (eRow >= 0) {
  const live0 = D.stats().live, fl0 = M._fallen().length;
  ST.shoot(eRow, { head: true, noPromote: true, fromX: 0, fromZ: -10 });
  const dead = ST.life(eRow) !== ST.ALIVE;
  const dropped = D.stats().live > live0 || M._fallen().length > fl0;
  console.log(`E. instanced sign-holder #${eRow} down (${dead}) without promotion: sign dropped ${dropped} (role now ${A.arole[eRow]})`);
  ok(!dead || dropped, "an instanced death left the sign in the air");
  ok(!dead || A.arole[eRow] !== ROLE_SIGN, "the instanced body still carries the sign");
}

console.log("audit " + JSON.stringify(M.audit(), ["rigs", "copRigs", "rigCap", "realized", "front", "propsPhys", "propsFlat", "fallen"]));
if (fails.length) { console.log("FAIL\n  " + fails.join("\n  ")); process.exit(1); }
console.log("PASS");
