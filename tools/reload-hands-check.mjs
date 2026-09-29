#!/usr/bin/env node
/* tools/reload-hands-check.mjs — DO THE HANDS RELOAD THE REAL GUN?

   Owner: "reload hand paths for every gun (FP and 3P): support hand goes to
   the real magazine/pump/bolt/shell, mag comes out and goes in, bolt-action
   works the bolt."

   Plain node, no browser, no captures. Runs the REAL three.js r128 + rig +
   weapon kit and appearances + actorweapons + holsterprops + gunhands (third
   person: animChar and every onAlways pass in the game's order, the reload
   clock driven exactly as fpsmode drives fps.reloading), and fpsmode's own
   first-person arm block (fitOffHand + fpReloadHands + poseFpArms, cut out
   by their markers like tools/fp-hands-check.mjs), for every gun.

   Per gun, both views, it walks one full reload (and the bolt gun's cycle
   between shots) and asserts at the path's key moments — every dwell row of
   CBZ.gunReload's table, sampled mid-row:
     · the hand that row belongs to is ON the named part: within 3 cm of the
       anchor measured on that part, and within 3 cm of the part's drawn
       surface (real metres);
     · the magazine / ammo box leaves the well (third person: a copy handed
       to the debris sim and the part hidden; first person: it falls out
       along its own way out of the gun, then is gone), the fresh one is IN
       the carrying hand (its grab point within 1.5 cm of the palm), and it
       ends seated exactly home;
     · the bolt travels (lifted and drawn back at least 80% of its throw) and
       ends home, the firing hand on its knob and OFF the grip while the gun
       stays in the support hand; the cylinder swings out and shuts; the
       M249 cover lifts and closes; the slide / charging handle comes back;
     · no arm stretch: third person the rig's segments keep their built
       lengths; first person the drawn upper arm never exceeds its bone.

     node tools/reload-hands-check.mjs [--verbose]     exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeDocument } from "./lib/fake-canvas.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const verbose = process.argv.includes("--verbose");
let seed = 20260928 >>> 0;
const M = Object.create(Math);
M.random = function () {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let fails = 0, checks = 0;
const failList = [];
function check(ok, msg) { checks++; if (!ok) { fails++; failList.push(msg); } }
const GUNS = ["sidearm", "deagle", "revolver", "carbine", "ak47", "smg", "uzi", "shotgun", "sniper", "lmg", "bazooka", "glauncher", "taser"];
const APPEAR = ["sidearm", "shotgun", "carbine", "smg", "taser", "bazooka", "glauncher", "ak47", "revolver", "deagle", "uzi", "sniper", "lmg", "shank"];
const GUN_K = 2.0;                 // appearance model units per real metre (the kit's scale)
const TOL = 0.03;                  // 3 cm, real
const CARRY_TOL = 0.015;
const DWELL_PART = {               // which drawn part a dwell anchor is ON
  well: "mag", charge: "charge", bolt: "bolt", cyl: "cylinder", cylFace: "cylinder",
  latch: "cover", box: "box", port: null, round: "round", tray: null,
};

// ================================================================ THIRD PERSON
const ctx = vm.createContext({ console, Math: M, performance, setTimeout: () => 0 });
ctx.window = ctx; ctx.self = ctx; ctx.document = fakeDocument();
ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const hooks = { always: [], update: [] };
ctx.CBZ = { CONFIG: {}, onAlways(o, f) { hooks.always.push([o, f]); }, onUpdate(o, f) { hooks.update.push([o, f]); }, on() {} };
for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/footwear.js", "src/entities/character.js",
  "src/weapons/weapon-data.js", "src/weapons/weapon-scale.js", ...APPEAR.map((n) => `src/weapons/appearances/${n}.js`),
  "src/systems/actorweapons.js", "src/systems/holsterprops.js", "src/systems/gunhands.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { THREE: T, CBZ } = ctx;
const RL = CBZ.gunReload;
if (!RL) { console.log("FAIL CBZ.gunReload missing (systems/gunhands.js)"); process.exit(1); }
const always = hooks.always.slice().sort((a, b) => a[0] - b[0]);
const updates = hooks.update.slice().sort((a, b) => a[0] - b[0]);
const base = { skin: 0xb87955, torso: 0x315f94, collar: 0x315f94, arms: 0x315f94, legs: 0x202c3c, shoes: 0x201a18, hair: 0x2b1b12 };

function armPoints(rig, side) {
  const part = side < 0 ? rig.parts.la : rig.parts.ra, low = part.userData.low, hand = part.userData.cap;
  part.updateMatrixWorld(true);
  return {
    sh: part.getWorldPosition(new T.Vector3()),
    el: low.getWorldPosition(new T.Vector3()),
    wr: low.localToWorld(new T.Vector3(0, hand.userData.fit.wristY, 0)),
  };
}
function restLengths(rig) {
  const out = {};
  for (const s of [-1, 1]) { const p = armPoints(rig, s); out[s] = [p.sh.distanceTo(p.el), p.el.distanceTo(p.wr)]; }
  return out;
}
// every triangle of the named part's meshes, world space
function partTris(obj) {
  const tris = [];
  if (!obj) return tris;
  obj.updateMatrixWorld(true);
  obj.traverse((m) => {
    if (!m.isMesh || !m.geometry || !m.geometry.attributes.position || /^fp_hand/.test(m.name)) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, p = g.attributes.position;
    for (let i = 0; i + 2 < p.count; i += 3) {
      tris.push(new T.Triangle(new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld),
        new T.Vector3().fromBufferAttribute(p, i + 1).applyMatrix4(m.matrixWorld), new T.Vector3().fromBufferAttribute(p, i + 2).applyMatrix4(m.matrixWorld)));
    }
  });
  return tris;
}
const _cp = new T.Vector3();
function surfDist(tris, p) { let d = Infinity; for (const t of tris) { if (t.getArea() < 1e-12) continue; t.closestPointToPoint(p, _cp); const e = _cp.distanceTo(p); if (e < d) d = e; } return d; }
// the drawn part a dwell anchor is on
function partFor(model, key) {
  const R = RL.rig(model);
  const name = DWELL_PART[key];
  if (key === "port") {
    let o = null;
    model.traverse((m) => { if (!o && (m.name === "part_receiver" || m.name === "part_action")) o = m; });
    return o;
  }
  if (key === "round") return model.userData.warhead || null;
  if (name === "mag") return R.pv.mag || null;
  return (name && R.pv[name]) || null;
}

// ONE BODY THROUGH EVERY GUN, as the game does it (a state one reload leaves
// behind must not poison the next gun): the last pass reuses one rig
let shared = null;
function freshRig(c, keep) {
  if (keep && shared) return shared;
  const scene = new T.Scene();
  const rig = CBZ.makeCharacter(Object.assign({}, base, c || {}));
  scene.add(rig.group);
  rig.group.updateMatrixWorld(true);
  const r = { scene, rig, rest: restLengths(rig) };
  if (keep) shared = r;
  return r;
}
// flat ground under the player (the ground rest, the floor clamp and weaponPhysics all read it)
CBZ.floorAt = () => 0;
const drops = [];
// the REAL debris sim takes the empties (its bodies then live in the world
// the player stands in); wrapped only to count what it was handed
if (process.env.RHC_REAL_DEBRIS) {
  try { vm.runInContext(read("src/systems/debris.js"), ctx, { filename: "src/systems/debris.js" }); } catch (e) { console.log("  note: debris.js did not load (" + e.message + ")"); }
}
if (CBZ.debris && CBZ.debris.adopt) {
  const real = CBZ.debris.adopt;
  CBZ.debris.adopt = function (m, o) { m.updateMatrixWorld(true); drops.push(m.getWorldPosition(new T.Vector3())); return real(m, o); };
} else CBZ.debris = { adopt(m) { m.updateMatrixWorld(true); drops.push(m.getWorldPosition(new T.Vector3())); } };
function frame(rig, dt) {
  for (const [o, fn] of updates) if (o < 10) fn(dt);
  CBZ.animChar(rig, 0, dt);
  for (const [o, fn] of updates) if (o >= 10) fn(dt);
  for (const [, fn] of always) fn(dt);
}
const rowsTP = [];
const BODIES = [{ label: "man", c: {} }, { label: "woman", c: { build: "f" } }, { label: "teen", c: { age: 13 } }, { label: "one-rig", c: {}, keep: true }, { label: "aimed", c: {}, keep: true, aim: true }];
function tpCase(id, B) {
  const { scene, rig, rest } = freshRig(B.c, B.keep);
  CBZ.scene = scene; CBZ.game = { mode: "city" };
  CBZ.player = { dead: false, pos: rig.group.position };
  CBZ.playerChar = rig;
  CBZ.camera = new T.PerspectiveCamera(60, 1.6, 0.1, 500);
  CBZ.camera.position.set(0.5, 1.9, -3.2); CBZ.camera.lookAt(0, 1.4, 10);
  scene.add(CBZ.camera);
  CBZ.cam = { pitch: 0 };
  CBZ.playerArmed = () => true; CBZ.currentWeaponId = id; CBZ.weaponInventory = [id];
  CBZ.tpPresenting = () => !!B.aim;
  CBZ.playerAimDir = (o) => o.set(0, 0, 1);
  const wi = CBZ.FPS_WEAPONS.findIndex((w) => w.id === id);
  const row = CBZ.FPS_WEAPONS[wi];
  CBZ.fps = { active: false, reloading: 0, weapon: wi, rounds: CBZ.FPS_WEAPONS.map(() => 0) };
  CBZ.fpsPumpRack = 0; CBZ.fpsBoltCycle = -1;
  CBZ.cityPeds = []; CBZ.cityCops = [];
  const slot = CBZ.buildActorWeapon(id).userData.weaponSlot;
  const dt = 1 / 60;
  const setPose = () => { rig.aimingPose = !!B.aim; rig.carryPose = !B.aim; rig.aimLong = slot !== "pistol" && slot !== "utility"; };
  for (let f = 0; f < 60; f++) { setPose(); frame(rig, dt); }
  const prop = CBZ.tpHandWeapon();
  const tag = `3p/${B.label}/${id}`;
  check(!!prop, `${tag}: a gun in the third-person hand`);
  if (!prop) return;
  const rec = RL.recipe(prop), R = RL.rig(prop);
  const out = { tag, style: R.style, worst: 0, worstSurf: 0, stretch: 0, carry: 0, parts: Object.keys(R.pv).join("+") };
  // ---- one reload, the game's own clock
  drops.length = 0;
  CBZ.fps.reloading = row.reload;
  // (sampled finer than a frame: the anchors a hand ARRIVES at are brief)
  const rdt = dt / 2;
  const total = Math.ceil(row.reload / rdt) + 2;
  let sawGone = false, sawHidden = false, boltBack = 0, sawOpen = 0, coverUp = 0, chargeBack = 0, offGrip = Infinity;
  const pvHome = (pv) => pv.position.distanceTo(pv.userData.homeP) < 1e-6 && pv.quaternion.angleTo(pv.userData.homeQ) < 1e-6;
  for (let f = 0; f < total; f++) {
    setPose();
    CBZ.fps.reloading = Math.max(0, CBZ.fps.reloading - rdt);
    frame(rig, rdt);
    scene.updateMatrixWorld(true);
    const rp = CBZ.gunReloadPose();
    if (!rp.active) continue;
    const p = rp.p;
    // no arm stretched
    const L = restLengths(rig);
    const fin = [-1, 1].every((sd) => { const q = armPoints(rig, sd); return Number.isFinite(q.sh.x + q.el.y + q.wr.z); });
    if (!fin) { check(false, `${tag}: the arms went non-finite at p ${p.toFixed(2)}`); break; }
    out.stretch = Math.max(out.stretch, ...[-1, 1].flatMap((s) => [Math.abs(L[s][0] - rest[s][0]), Math.abs(L[s][1] - rest[s][1])]));
    // the parts
    const f0 = R.fresh;
    if (rec.eject != null && p > rec.eject + 0.01 && p < rec.grab - 0.01 && f0 && !R.made) sawHidden = sawHidden || f0.visible === false;
    if (R.pv.bolt) boltBack = Math.max(boltBack, R.pv.bolt.position.z - R.pv.bolt.userData.homeP.z);
    if (R.pv.cylinder) sawOpen = Math.max(sawOpen, R.pv.cylinder.quaternion.angleTo(R.pv.cylinder.userData.homeQ));
    if (R.pv.cover) coverUp = Math.max(coverUp, R.pv.cover.quaternion.angleTo(R.pv.cover.userData.homeQ));
    if (R.pv.charge) chargeBack = Math.max(chargeBack, R.pv.charge.position.z - R.pv.charge.userData.homeP.z);
    // hands at the key moments
    for (const hand of ["l", "r"]) {
      const rows = rec[hand];
      if (!rows) continue;
      const s = RL.seg(rows, p);
      const sock = hand === "l" ? rig.sockets.leftHand : rig.sockets.rightHand;
      const hw = sock.getWorldPosition(new T.Vector3());
      // the fresh one in the carrying hand
      if (hand === rec.carry && f0 && p > rec.grab + 0.01 && p < rec.seat - 0.01 && f0.visible) {
        let g;
        if (R.made) g = f0.getWorldPosition(new T.Vector3());
        else if (R.style === "rocket") g = prop.localToWorld(f0.position.clone().sub(R.spareHome).add(R.freshGrab));
        else g = prop.localToWorld(f0.position.clone().sub(f0.userData.homeP).add(R.freshGrab));
        out.carry = Math.max(out.carry, g.distanceTo(hw));
      }
      // the key moments: mid-dwell on a part, and arriving at one
      const key = s.dwell ? (s.u >= 0.35 && s.u <= 0.65 ? s.a : null) : (s.u >= 0.985 ? s.b : null);
      if (!key || !(key in DWELL_PART)) continue;
      const a = RL.point(prop, key, new T.Vector3());
      if (!a) { check(false, `${tag}: no anchor "${key}"`); continue; }
      const aw = prop.localToWorld(a);
      const gap = hw.distanceTo(aw);
      if (process.env.RHC_DEBUG && gap > TOL) {
        const au = CBZ.gunHandAudit() || {};
        const sh = (hand === "l" ? rig.parts.la : rig.parts.ra).getWorldPosition(new T.Vector3());
        console.log("DBG", tag, hand, key, p.toFixed(2), "gap", gap.toFixed(3), "resid", au.residual, "why", au.why, "sh->anchor", sh.distanceTo(aw).toFixed(3), "span", CBZ.charArmTo.span(rig, hand).toFixed(3), "anchorBody", rig.body.worldToLocal(aw.clone()).toArray().map((v) => v.toFixed(2)).join(","));
      }
      out.worst = Math.max(out.worst, gap);
      check(gap < TOL, `${tag}: ${hand} hand on "${key}" at p ${p.toFixed(2)} (${(gap * 100).toFixed(1)} cm)`);
      const part = partFor(prop, key);
      if (part) {
        const sd = surfDist(partTris(part), hw);
        out.worstSurf = Math.max(out.worstSurf, sd);
        check(sd < TOL, `${tag}: ${hand} hand on the drawn ${DWELL_PART[key] || key} at p ${p.toFixed(2)} (${(sd * 100).toFixed(1)} cm off its surface)`);
      }
      if (hand === "r" && key === "bolt") {
        // the hand left the grip and the gun did not go with it
        const fg = CBZ.holds.anchorWorld(prop, "grip", new T.Vector3());
        if (fg) offGrip = Math.min(offGrip, fg.distanceTo(hw));
      }
    }
  }
  scene.updateMatrixWorld(true);
  check(!CBZ.gunReloadPose().active, `${tag}: the reload ran out`);
  for (const k in R.pv) check(pvHome(R.pv[k]), `${tag}: ${k} back home after the reload`);
  if (R.fresh && !R.made && R.style !== "rocket") check(R.fresh.visible !== false, `${tag}: the fresh magazine / box is seated and drawn`);
  if (R.fresh && (R.made || R.style === "rocket")) check(R.fresh.visible === false, `${tag}: nothing left in the hand`);
  if (rec.eject != null && (R.style === "mag" || R.style === "belt")) {
    check(drops.length === 1, `${tag}: the empty dropped once (${drops.length})`);
    check(sawHidden, `${tag}: the empty left the well`);
  }
  if (R.style === "cylinder") { check(drops.length === 1, `${tag}: the empties fell (${drops.length})`); check(sawOpen > 1.2, `${tag}: the cylinder swung out (${sawOpen.toFixed(2)} rad)`); }
  if (R.style === "belt") check(coverUp > 0.8, `${tag}: the feed cover lifted (${coverUp.toFixed(2)} rad)`);
  if (R.style === "mag" && R.pv.charge) check(chargeBack > R.chargeTravel * 0.9, `${tag}: the ${R.pv.charge.name.replace("reload:", "")} came back (${chargeBack.toFixed(3)})`);
  if (R.style === "bolt") {
    check(boltBack > R.boltTravel * 0.8, `${tag}: the bolt drawn back (${boltBack.toFixed(3)} of ${R.boltTravel.toFixed(3)})`);
    check(offGrip > 0.06, `${tag}: the firing hand left the grip for the bolt (${(offGrip * 100).toFixed(1)} cm)`);
  }
  check(out.carry < CARRY_TOL, `${tag}: the fresh one rides the hand (${(out.carry * 100).toFixed(1)} cm)`);
  check(out.stretch < 1e-4, `${tag}: no arm segment stretched (${(out.stretch * 1000).toFixed(2)} mm)`);
  // ---- the bolt gun between shots
  if (RL.cycle(prop)) {
    let back = 0, onKnob = 0, n = 0;
    for (let u = 0; u <= 1.0001; u += 1 / 50) {
      CBZ.fpsBoltCycle = Math.min(1, u);
      setPose(); frame(rig, dt); scene.updateMatrixWorld(true);
      back = Math.max(back, R.pv.bolt.position.z - R.pv.bolt.userData.homeP.z);
      const s = RL.seg(RL.cycle(prop).r, u);
      if (s.dwell && s.u > 0.3 && s.u < 0.7) {
        const hw = rig.sockets.rightHand.getWorldPosition(new T.Vector3());
        const a = prop.localToWorld(RL.point(prop, "bolt", new T.Vector3()));
        onKnob = Math.max(onKnob, hw.distanceTo(a)); n++;
      }
    }
    CBZ.fpsBoltCycle = -1;
    setPose(); frame(rig, dt);
    check(back > R.boltTravel * 0.8, `${tag}: between shots the bolt is worked back (${back.toFixed(3)})`);
    check(n > 0 && onKnob < TOL, `${tag}: between shots the firing hand is on the knob (${(onKnob * 100).toFixed(1)} cm)`);
    check(pvHome(R.pv.bolt), `${tag}: the bolt closed after the cycle`);
    out.cycle = back;
  }
  rowsTP.push(out);
}
for (const B of BODIES) for (const id of GUNS) tpCase(id, B);

// ================================================================ FIRST PERSON
const fctx = vm.createContext({ console, Math });
fctx.window = fctx; fctx.self = fctx;
fctx.CBZ = { CONFIG: {}, weaponAppearance: {} };
for (const f of ["src/vendor/three.r128.min.js", "src/systems/fphands.js", ...APPEAR.map((n) => `src/weapons/appearances/${n}.js`),
  "src/entities/watch.js", "src/systems/gunhands.js"]) {
  vm.runInContext(read(f), fctx, { filename: f });
}
const FT = fctx.THREE, FC = fctx.CBZ, FRL = FC.gunReload;
function block(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a + 1);
  if (!(a >= 0 && b > a)) throw new Error(`markers ${from} .. ${to}`);
  return src.slice(a, b);
}
const FPS = read("src/systems/fpsmode.js");
let reloadP = -1;
FC.gunReloadPose = () => reloadP >= 0 ? { active: true, p: reloadP } : { active: false };
const armSrc = `
  const THREE = window.THREE; const CBZ = window.CBZ;
  const mat = { skin: new THREE.MeshLambertMaterial() };
  const camera = new THREE.Group(); CBZ.camera = camera;
  const vm = new THREE.Group(); camera.add(vm);
  const gun = new THREE.Group();
  const weaponModels = [];
  let ddT = -1; const fps = { weapon: 0 }; const WEAPONS = [];
  let punchT = 0, vmPunch = 0, guardK = 0;
  const fistT = [{ vis: false }, { vis: false }];
` + block(FPS, "  const FPH = CBZ.fpHands || null;", "  WEAPONS.forEach((w, i) => {")
  + block(FPS, "  const fists = new THREE.Group();", "  vm.add(gun, fists, fpArms);")
  + `  vm.add(gun, fists, fpArms); fists.visible = false;`
  + block(FPS, "  /* ---- THE ARMS, SOLVED EVERY FRAME", "  let aimHeld = false;")
  + `
  return { vm, gun, weaponModels, mat, fitOffHand, poseFpArms, armR, armL, ARM_BODY, worldScaleInVm, HAND_PALM };`;
const A = vm.runInContext("(function(){" + armSrc + "})()", fctx);
const box = (parent, sx, sy, sz, m, x, y, z, rx, ry, rz) => { const o = new FT.Mesh(new FT.BoxGeometry(sx, sy, sz), m); o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0); parent.add(o); return o; };
const cyl = (parent, r, len, m, x, y, z, rx, ry, rz) => { const o = new FT.Mesh(new FT.CylinderGeometry(r, r, len, 8), m); o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0); parent.add(o); return o; };
const mats = {};
for (const k of ["dark", "black", "bore", "steel", "worn", "tan", "polymer", "brass", "redShell", "wood"]) mats[k] = new FT.MeshLambertMaterial();
mats.skin = A.mat.skin;
const actx = { THREE: FT, box, cyl, mat: mats };
const rowsFP = [];
// model space helpers
const toModel = (o, model) => { const m = new FT.Matrix4(); for (let p = o; p && p !== model; p = p.parent) { p.updateMatrix(); m.premultiply(p.matrix); } return m; };
const palmOf = (model, hand) => { hand.updateMatrix(); return new FT.Vector3(hand.userData.side * A.HAND_PALM[0], A.HAND_PALM[1], A.HAND_PALM[2]).applyMatrix4(hand.matrix).applyMatrix4(toModel(hand.parent, model)); };
function partTrisM(model, obj) {
  const tris = [];
  if (!obj) return tris;
  obj.traverse((m) => {
    if (!m.isMesh || !m.geometry || /^fp_hand/.test(m.name)) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry, p = g.attributes.position, Mm = toModel(m, model);
    for (let i = 0; i + 2 < p.count; i += 3) tris.push(new FT.Triangle(new FT.Vector3().fromBufferAttribute(p, i).applyMatrix4(Mm),
      new FT.Vector3().fromBufferAttribute(p, i + 1).applyMatrix4(Mm), new FT.Vector3().fromBufferAttribute(p, i + 2).applyMatrix4(Mm)));
  });
  return tris;
}
const _cpF = new FT.Vector3();
function surfDistF(tris, p) { let d = Infinity; for (const t of tris) { if (t.getArea() < 1e-12) continue; t.closestPointToPoint(p, _cpF); const e = _cpF.distanceTo(p); if (e < d) d = e; } return d; }
function partForF(model, key) {
  const R = FRL.rig(model), name = DWELL_PART[key];
  if (key === "port") { let o = null; model.traverse((m) => { if (!o && (m.name === "part_receiver" || m.name === "part_action")) o = m; }); return o; }
  if (key === "round") return model.userData.warhead || null;
  return (name && R.pv[name]) || null;
}
// THE REACH: the wrist within the arm's two bones of its shoulder (the
// viewmodel's upper arm is a sleeve spanning elbow -> shoulder, so its drawn
// length says nothing; the shoulder-to-wrist distance does)
function reachOf(arm, k) {
  const P = arm.userData.parts;
  const S = P.upper.position.clone().add(new FT.Vector3(0, 0, 1).applyQuaternion(P.upper.quaternion).multiplyScalar(P.upper.scale.z));
  return P.fore.position.distanceTo(S) / ((A.ARM_BODY[0] + A.ARM_BODY[1]) * k);
}
function fpCase(id) {
  const model = FC.weaponAppearance[id](actx);
  model.scale.setScalar(1.28);
  A.fitOffHand(model, {});
  A.weaponModels.length = 0; A.weaponModels.push(model);
  A.gun.children.slice().forEach((c) => A.gun.remove(c)); A.gun.add(model);
  A.vm.visible = true; A.gun.visible = true;
  const tag = `fp/${id}`;
  const fire = model.userData.fpFire, sup0 = model.userData.fpSupport || model.userData.fpReloadHand;
  check(!!fire && !!sup0, `${tag}: a firing hand and an off hand for the reload`);
  if (!fire || !sup0) return;
  const R = FRL.rig(model), rec = FRL.recipe(model);
  const out = { tag, style: R.style, worst: 0, worstSurf: 0, carry: 0, stretch: 0, parts: Object.keys(R.pv).join("+") };
  const kM = (h) => { let k = 1; for (let p = h; p && p !== model; p = p.parent) k *= p.scale.x; return k; };   // hand model units per real metre
  // the reload pose of the viewmodel (fpsmode's dip)
  A.vm.position.set(0.36, -0.47, -0.72); A.vm.rotation.set(0.004, 0, 0);
  reloadP = -1; FC.fpsBoltCycle = -1;
  // the hold's own reach (the viewmodel's rifles are held out at arm's length)
  A.poseFpArms(1 / 60);
  let holdReach = 0;
  for (const [arm, h] of [[A.armR, fire], [A.armL, model.userData.fpSupport]]) if (arm.visible && h) holdReach = Math.max(holdReach, reachOf(arm, A.worldScaleInVm(h)));
  out.holdReach = holdReach;
  let worstAt = "";
  let fellAway = 0, gone = false, boltBack = 0;
  const fw = [0, 0, 0, 0, 0];
  for (let p = 0.005; p < 1; p += 0.01) {
    reloadP = p;
    // the viewmodel's reload pose, as fpsmode sets it (the dip + the style's work offset)
    FRL.fpWork(model, p, fw);
    A.vm.position.set(0.36 + fw[0], -0.47 + fw[1], -0.72 + fw[2]); A.vm.rotation.set(0.004, fw[3], fw[4]);
    A.poseFpArms(1 / 60);
    for (const hand of ["l", "r"]) {
      const rows = rec[hand];
      if (!rows) continue;
      const h = hand === "l" ? (model.userData.fpSupport || model.userData.fpReloadHand) : fire;
      const s = FRL.seg(rows, p);
      const palm = palmOf(model, h);
      if (hand === rec.carry && p > rec.grab + 0.01 && p < rec.seat - 0.01 && R.fresh && R.fresh.visible !== false) {
        let g;
        if (R.made) g = R.fresh.position.clone();
        else if (R.style === "rocket") g = R.fresh.position.clone().sub(R.spareHome).add(R.freshGrab);
        else g = R.fresh.position.clone().sub(R.fresh.userData.homeP).add(R.freshGrab);
        out.carry = Math.max(out.carry, g.distanceTo(palm) / GUN_K);
      }
      // the key moments: mid-dwell on a part, and arriving at one
      const key = s.dwell ? (s.u >= 0.35 && s.u <= 0.65 ? s.a : null) : (s.u >= 0.985 ? s.b : null);
      if (!key || !(key in DWELL_PART)) continue;
      const a = FRL.point(model, key, new FT.Vector3());
      if (!a) { check(false, `${tag}: no anchor "${key}"`); continue; }
      const gap = a.distanceTo(palm) / GUN_K;
      out.worst = Math.max(out.worst, gap);
      check(gap < TOL, `${tag}: ${hand} palm on "${key}" at p ${p.toFixed(2)} (${(gap * 100).toFixed(1)} cm)`);
      const part = partForF(model, key);
      if (part) {
        const sd = surfDistF(partTrisM(model, part), palm) / GUN_K;
        out.worstSurf = Math.max(out.worstSurf, sd);
        check(sd < TOL, `${tag}: ${hand} palm on the drawn ${DWELL_PART[key] || key} at p ${p.toFixed(2)} (${(sd * 100).toFixed(1)} cm off)`);
      }
    }
    // the empty falls out of the well and is gone
    if (rec.eject != null && !R.made && R.style !== "rocket" && R.fresh) {
      if (p > rec.eject && p < rec.grab) {
        if (R.fresh.visible === false) gone = true;
        else fellAway = Math.max(fellAway, R.fresh.position.clone().sub(R.fresh.userData.homeP).dot(R.dropDir));
      }
    }
    if (R.pv.bolt) boltBack = Math.max(boltBack, R.pv.bolt.position.z - R.pv.bolt.userData.homeP.z);
    // the arms: every wrist within its arm's reach of its shoulder
    for (const [arm, h] of [[A.armR, fire], [A.armL, model.userData.fpSupport || model.userData.fpReloadHand]]) {
      if (!arm.visible || !h) continue;
      const rc = reachOf(arm, A.worldScaleInVm(h));
      if (rc > out.stretch) { out.stretch = rc; worstAt = (arm === A.armR ? "r" : "l") + "@" + p.toFixed(2); }
    }
  }
  reloadP = -1;
  A.poseFpArms(1 / 60);
  for (const k in R.pv) check(R.pv[k].position.distanceTo(R.pv[k].userData.homeP) < 1e-6 && R.pv[k].quaternion.angleTo(R.pv[k].userData.homeQ) < 1e-6, `${tag}: ${k} home after the reload`);
  check(fire.position.distanceTo(fire.userData.basePos) < 1e-9, `${tag}: the firing hand back on its grip`);
  if (rec.eject != null && !R.made && R.style !== "rocket" && R.fresh) {
    check(fellAway > 0.05 && gone, `${tag}: the empty fell out of the well (${fellAway.toFixed(3)}) and is gone (${gone})`);
    check(R.fresh.visible !== false, `${tag}: the fresh one seated and drawn`);
  }
  if (R.style === "bolt") check(boltBack > R.boltTravel * 0.8, `${tag}: the bolt drawn back (${boltBack.toFixed(3)})`);
  check(out.carry < CARRY_TOL, `${tag}: the fresh one rides the palm (${(out.carry * 100).toFixed(1)} cm)`);
  out.worstAt = worstAt;
  // (the viewmodel's long guns are HELD past arm's length already: never further than that)
  check(out.stretch <= Math.max(1.0, holdReach) + 0.02, `${tag}: no arm stretched: every wrist within reach of its shoulder (${(out.stretch * 100).toFixed(0)}% of the arm, the hold ${(holdReach * 100).toFixed(0)}%)`);
  // the bolt gun between shots
  if (FRL.cycle(model)) {
    let back = 0, onKnob = 0, n = 0;
    for (let u = 0; u <= 1.0001; u += 0.02) {
      FC.fpsBoltCycle = Math.min(1, u);
      A.poseFpArms(1 / 60);
      back = Math.max(back, R.pv.bolt.position.z - R.pv.bolt.userData.homeP.z);
      const s = FRL.seg(FRL.cycle(model).r, u);
      if (s.dwell && s.u > 0.3 && s.u < 0.7) { onKnob = Math.max(onKnob, FRL.point(model, "bolt", new FT.Vector3()).distanceTo(palmOf(model, fire)) / GUN_K); n++; }
    }
    FC.fpsBoltCycle = -1;
    A.poseFpArms(1 / 60);
    check(back > R.boltTravel * 0.8, `${tag}: between shots the bolt is worked back (${back.toFixed(3)})`);
    check(n > 0 && onKnob < TOL, `${tag}: between shots the firing palm is on the knob (${(onKnob * 100).toFixed(1)} cm)`);
    check(fire.position.distanceTo(fire.userData.basePos) < 1e-9, `${tag}: the firing hand back on the grip after the cycle`);
  }
  rowsFP.push(out);
}
for (const id of GUNS) fpCase(id);

// ================================================================ report
const cm = (v) => (v * 100).toFixed(1).padStart(5);
console.log("view/body/gun     style     parts                      hand->anchor  hand->part  carry   stretch");
for (const r of rowsTP.concat(rowsFP)) {
  console.log(r.tag.padEnd(22) + String(r.style).padEnd(10) + String(r.parts || "-").padEnd(27) + cm(r.worst) + " cm   " + cm(r.worstSurf) + " cm  " + cm(r.carry) + " cm  " +
    (r.tag.startsWith("3p") ? (r.stretch * 1000).toFixed(2) + " mm" : "reach " + (r.stretch * 100).toFixed(0) + "% (hold " + (r.holdReach * 100).toFixed(0) + "%) " + r.worstAt));
}
if (fails) console.log("\nFAIL\n  - " + failList.slice(0, 60).join("\n  - ") + (failList.length > 60 ? `\n  ... ${failList.length - 60} more` : ""));
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
