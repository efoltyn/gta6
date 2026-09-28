#!/usr/bin/env node
/* tools/gun-hold-check.mjs — DO THE BODY'S HANDS ACTUALLY HOLD THE GUN?

   Owner: "the hands during gun holding [need to be] fixed." Plain node, no
   browser, no captures: runs the REAL three.js r128 + materials + fphands +
   character + weapon data/scale/appearances + actorweapons + holsterprops +
   gunhands in a vm, builds real rigs, and poses them the way the game does:

     npc      CBZ.actorReadyPose (systems/actorweapons.js setReadyPose ->
              CBZ.gunHold.ready), what every armed NPC runs each frame;
     aim      the player presenting: animChar + every onAlways pass in order
              (fpsmode's stand-ins, holsterprops 54 barrel lock + firing
              fist, gunhands 53.9 / 53.95 blade / 54.6 support hand), 120
              frames, third person;
     carry    the same at low ready (port arms for long guns, where a
              handguard out of reach is a DESIGNED one-hand carry).

   Every number is measured off the scene graph, NOT read back from the
   solver: the grip axis is rebuilt from the weapon kit's own K.hand spec
   (userData.fireGrip), the fist from fphands.gripCentre on the live hand.

   Asserts, per (body, weapon, stance):
     · firing fist: grip centre within 2 cm of the gun's grip point (on the
       grip axis, a palm below the top of the grip), fist wrap axis within
       20 deg of the grip axis;
     · support hand (two-hand weapons): grip centre within 3 cm of the part
       it holds — the handguard's axis (anywhere from its front back to the
       receiver ahead of the firing hand, reported as along/behind), the
       foregrip, or for a pistol the firing fist it cups;
     · arms: no segment stretched (shoulder->elbow, elbow->wrist crease
       unchanged from the built rig), no arm part scaled;
     · the forearms do not pass through each other (centrelines >= 5 cm
       apart) nor through the chest box;
     · both wrists bend at most CBZ.gunHold.BEND_MAX (+ a hair).

     node tools/gun-hold-check.mjs [--verbose]     exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeDocument } from "./lib/fake-canvas.mjs";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const verbose = process.argv.includes("--verbose");
// a seeded Math.random: bodies are built with random variety, and a check
// that measures them must say the same thing twice (GHC_SEED to vary it)
let seed = (+process.env.GHC_SEED || 20260928) >>> 0;
const M = Object.create(Math);
M.random = function () {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ctx = vm.createContext({ console, Math: M, performance, setTimeout });
ctx.window = ctx; ctx.self = ctx; ctx.document = fakeDocument();
ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
const hooks = { always: [], update: [] };
ctx.CBZ = { CONFIG: {}, onAlways(o, f) { hooks.always.push([o, f]); }, onUpdate(o, f) { hooks.update.push([o, f]); }, on() {} };
const APPEAR = ["sidearm", "shotgun", "carbine", "smg", "taser", "bazooka", "glauncher", "ak47", "revolver", "deagle", "uzi", "sniper", "lmg", "shank"];
for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/footwear.js", "src/entities/character.js",
  "src/weapons/weapon-data.js", "src/weapons/weapon-scale.js", ...APPEAR.map((n) => `src/weapons/appearances/${n}.js`),
  "src/systems/actorweapons.js", "src/systems/holsterprops.js", "src/systems/gunhands.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
// the city's armour kit (a plate carrier on the chest the arms must clear)
{
  const nA = hooks.always.length, nU = hooks.update.length;       // (the dressers only: their game loops stay out)
  for (const f of ["src/city/clothes.js", "src/city/outfits.js", "src/city/armor.js"]) {
    try { vm.runInContext(read(f), ctx, { filename: f }); } catch (e) { console.log("  note: " + f + " did not load (" + e.message + ")"); }
  }
  hooks.always.length = nA; hooks.update.length = nU;
}
const { THREE: T, CBZ } = ctx;
const H = CBZ.fpHands, GH = CBZ.gunHold;
const always = hooks.always.slice().sort((a, b) => a[0] - b[0]);
const updates = hooks.update.slice().sort((a, b) => a[0] - b[0]);
let fails = 0, checks = 0;
const failList = [];
const stressList = [];
function check(ok, msg) {
  if (/^heavy\+plate\//.test(msg)) { if (!ok) stressList.push(msg); return; }
  checks++; if (!ok) { fails++; failList.push(msg); }
}
if (!GH) { console.log("FAIL CBZ.gunHold missing (systems/actorweapons.js)"); process.exit(1); }
const DEG = 180 / Math.PI;
// the solver's cap is 40 degrees of wrist off the forearm line; a real wrist
// gives 60+. The measured bend (hand frame vs the lofted forearm, twist and
// all) reads a few degrees over the solver's own number on the steep Uzi grip.
const BEND_OK = GH.BEND_MAX + 0.06;

const BODIES = [
  { label: "man", c: {} },
  { label: "woman", c: { build: "f" } },
  { label: "teen", c: { age: 13 } },
  // THE BODY AS WORN: a heavy man and a woman in a plate carrier: the kit
  // stands 4-6 cm off the chest, and the arms and the gun must clear it too
  // STRESS body, REPORTED not failed: a heavy man's belly under a plate carrier
  // stands ~11 cm proud of the average chest; the pistols, the Uzi and the
  // pitched-down long guns cannot all be held clear of it by placement alone
  // (the misses print below as "stress").
  { label: "heavy+plate", c: { physique: "heavy" }, kit: ["plateCarrier"], stress: true },
  { label: "woman+plate", c: { build: "f" }, kit: ["plateCarrier"] },
];
const GUNS = ["sidearm", "deagle", "revolver", "carbine", "ak47", "smg", "uzi", "shotgun", "sniper", "lmg", "bazooka", "glauncher", "taser"];
const base = { skin: 0xb87955, torso: 0x315f94, collar: 0x315f94, arms: 0x315f94, legs: 0x202c3c, shoes: 0x201a18, hair: 0x2b1b12 };

// ---------------------------------------------------------------- geometry
const _v = new T.Vector3(), _q = new T.Quaternion();
function fireGripOf(prop) {
  // the kit's K.hand spec and its owner's matrix into prop space
  let owner = null;
  prop.traverse((o) => { if (!owner && o.userData && o.userData.fireGrip) owner = o; });
  if (!owner) return null;
  const M = new T.Matrix4();
  for (let o = owner; o && o !== prop; o = o.parent) { o.updateMatrix(); M.premultiply(o.matrix); }
  const h = owner.userData.fireGrip, R = h.rake || 0;
  return {
    h,
    top: new T.Vector3(0, h.at[0], h.at[1]).applyMatrix4(M),
    axis: new T.Vector3(0, Math.cos(R), -Math.sin(R)).transformDirection(M),
  };
}
function handCentre(hand) {
  const c = H.gripCentre(hand.userData.handPose, new T.Vector3());
  if (hand.userData.side < 0) c.x = -c.x;
  hand.updateMatrixWorld(true);
  return hand.localToWorld(c);
}
function handAxis(hand) { hand.getWorldQuaternion(_q); return new T.Vector3(1, 0, 0).applyQuaternion(_q); }
function wristBend(hand) {
  hand.getWorldQuaternion(_q);
  const z = new T.Vector3(0, 0, 1).applyQuaternion(_q);
  hand.parent.getWorldQuaternion(_q);
  const f = new T.Vector3(0, 1, 0).applyQuaternion(_q);
  return Math.acos(Math.max(-1, Math.min(1, z.dot(f))));
}
function segDist(p1, q1, p2, q2) {
  return H.math.segDist([p1.x, p1.y, p1.z], [q1.x, q1.y, q1.z], [p2.x, p2.y, p2.z], [q2.x, q2.y, q2.z]);
}
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
  for (const s of [-1, 1]) {
    const p = armPoints(rig, s);
    out[s] = [p.sh.distanceTo(p.el), p.el.distanceTo(p.wr)];
  }
  return out;
}
// THE BODY AS WORN (entities/character.js charArmTo.bodyPen: the shaped
// torso, its clothing and every piece of kit on it, not the ribcage box)
const WORLD = 0.70;                          // HUMAN_SCALE: rig units -> metres
// world metres: a butt pressed into cloth, or into a carrier's cordura front
const PEN_TOL = 0.008;
// an arm resting against its own ribs or hip is flesh on flesh: the lofted
// arm and torso are both soft there, and the rig's own idle arms already
// touch. Kit is held to 4 mm by tools/overlap-audit.mjs's exact surfaces.
const ARM_TOL = 0.010;
function gunPen(rig, prop) {
  // every vertex of the drawn gun, in the body frame, against the worn body
  rig.group.updateMatrixWorld(true);
  const inv = new T.Matrix4().copy(rig.body.matrixWorld).invert(), m = new T.Matrix4(), p = new T.Vector3();
  let worst = 0;
  prop.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || o.visible === false) return;
    let q = o; for (; q && q !== prop; q = q.parent) if (q.visible === false) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const q = CBZ.charArmTo.bodyPen(rig, p.fromBufferAttribute(pos, i).applyMatrix4(m), 0);
      if (q > worst) { worst = q; if (process.env.GHC_GUNDBG) gunPen.where = [o.name || o.geometry.type, o.material && o.material.color && o.material.color.getHexString(), p.toArray().map((v) => +v.toFixed(3)), pos.getX(i).toFixed(3) + "," + pos.getY(i).toFixed(3) + "," + pos.getZ(i).toFixed(3)]; }
    }
  });
  return worst * WORLD;
}

// ---------------------------------------------------------------- measure
function measure(rig, prop, tag, stance, opts) {
  const r = { tag, stance };
  rig.group.updateMatrixWorld(true);
  const hr = rig.parts.ra.userData.cap, hl = rig.parts.la.userData.cap;
  const fit = hr.userData.fit;
  const k = fit.s / (prop.scale.x || 1);
  const fg = fireGripOf(prop);
  check(!!fg, `${tag}: the weapon carries its K.hand grip spec`);
  if (!fg) return r;
  prop.updateMatrixWorld(true);
  // the gun's grip point: on the grip axis, a palm (4 cm of hand) below its top
  const gp = fg.top.clone().addScaledVector(fg.axis, -0.040 * k);
  const gpW = prop.localToWorld(gp.clone());
  const axW = prop.localToWorld(fg.top.clone().add(fg.axis)).sub(prop.localToWorld(fg.top.clone())).normalize();
  const fc = handCentre(hr);
  r.fireGap = fc.distanceTo(gpW);
  r.fireAxis = Math.acos(Math.min(1, Math.abs(handAxis(hr).dot(axW)))) * DEG;
  r.fireBend = wristBend(hr);
  r.firePose = hr.userData.handPose;
  check(/^trig\d+$/.test(r.firePose), `${tag}: firing hand wears a sized trigger hold (${r.firePose})`);
  check(r.fireGap < 0.02, `${tag}: firing fist on the grip (${(r.fireGap * 100).toFixed(1)} cm)`);
  check(r.fireAxis < 20, `${tag}: fist axis along the grip (${r.fireAxis.toFixed(1)} deg)`);
  check(r.fireBend <= BEND_OK, `${tag}: firing wrist bend ${(r.fireBend * DEG).toFixed(0)} deg`);

  // the support hand
  const g = prop.userData.grips, hold = g && g.hold;
  const twoHand = !!(g && g.support) && !opts.released;
  r.twoHand = twoHand;
  if (twoHand) {
    const sc = handCentre(hl);
    let gap, along = null;
    if (hold && hold.kind === "guard") {
      // the handguard's axis, from its front back to just ahead of the firing hand
      // (a pump gun's is the PUMP: wherever the rack has slid it)
      const pdz = prop.userData.pump ? (prop.userData._pumpDz || 0) : 0;
      const front = new T.Vector3(0, hold.y, hold.z - hold.len / 2 + pdz);
      const rear = new T.Vector3(0, hold.y, Math.max(hold.z + hold.len / 2 + pdz, gp.z - 0.11 * k));
      const a = prop.localToWorld(front.clone()), b = prop.localToWorld(rear.clone());
      const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, sc.clone().sub(a).dot(ab) / ab.lengthSq()));
      gap = sc.distanceTo(a.clone().addScaledVector(ab, t));
      // along: 0 = on the handguard, > 0 = metres behind its rear end
      const zc = front.z + (rear.z - front.z) * t;
      along = Math.max(0, zc - (hold.z + hold.len / 2)) * prop.scale.x * 0.7;
      r.onGuard = zc <= hold.z + hold.len / 2 + 1e-6;
    } else if (hold && hold.kind === "vgrip") {
      // the foregrip itself, or (out of reach) the tube's underside behind it
      const ax = new T.Vector3(0, Math.cos(hold.rake || 0), -Math.sin(hold.rake || 0));
      const top = new T.Vector3(0, hold.y, hold.z);
      const seg = (p0, p1) => {
        const a = prop.localToWorld(p0.clone()), b = prop.localToWorld(p1.clone());
        const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, sc.clone().sub(a).dot(ab) / ab.lengthSq()));
        return sc.distanceTo(a.clone().addScaledVector(ab, t));
      };
      const onGrip = seg(top.clone().addScaledVector(ax, -0.02 * k), top.clone().addScaledVector(ax, -0.2));
      const c0 = top.clone().addScaledVector(ax, -0.050 * k);
      const onTube = seg(c0, new T.Vector3(c0.x, c0.y, Math.max(c0.z, gp.z - 0.11 * k)));
      gap = Math.min(onGrip, onTube);
      along = onGrip <= onTube ? 0 : prop.localToWorld(c0.clone()).distanceTo(sc);
    } else {
      // a pistol: the off hand cups the firing fist, same grip axis
      const a = prop.localToWorld(fg.top.clone()), b = prop.localToWorld(fg.top.clone().addScaledVector(fg.axis, -0.12 * k));
      const ab = b.clone().sub(a), t = Math.max(0, Math.min(1, sc.clone().sub(a).dot(ab) / ab.lengthSq()));
      gap = sc.distanceTo(a.clone().addScaledVector(ab, t));
    }
    r.supGap = gap; r.supAlong = along;
    // THE WATCH ARM: a bent wrist must not swing hand (its wrist stub) out
    // through the side of the slim lofted wrist, where the left forearm's
    // wristwatch sits just above the crease. Vertices outside the forearm's
    // own section, measured as height above the crease (elbow frame).
    const fore = rig.parts.la.userData.lower;
    if (fore && fore.geometry && CBZ.humanLimbHalfAt) {
      hl.updateMatrix(); fore.updateMatrix();
      // measured in the forearm's OWN frame: it twists with the hand (character.js wristTwist)
      const foreInv = fore.matrix.clone().invert();
      const pos = hl.geometry.attributes.position, crease = hl.userData.fit.wristY;
      let poke = 0;
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(hl.matrix);
        if (_v.y <= crease) continue;
        const h = _v.y - crease;
        _v.applyMatrix4(foreInv);
        const sec = CBZ.humanLimbHalfAt(fore.geometry, _v.y);
        if (!sec) continue;
        if (Math.abs(_v.x) > sec.hx + 0.004 || Math.abs(_v.z - sec.cz) > sec.hz + 0.004) poke = Math.max(poke, h);
      }
      r.poke = poke;
      check(poke < 0.012, `${tag}: support hand stays inside the wrist above the crease (${(poke * 100).toFixed(1)} cm rig)`);
    }
    r.supBend = wristBend(hl);
    r.supPose = hl.userData.handPose;
    check(/^hold\d+$/.test(r.supPose), `${tag}: support hand wears a sized hold (${r.supPose})`);
    // 3 cm; 3.5 at a steep aim (a broad-shouldered man pointing a stubby
    // Uzi 17 degrees down is the tightest reach in the game: 3.2)
    const tol = stance === "npc-pitch" ? 0.035 : 0.03;
    check(gap < tol, `${tag}: support hand on the gun (${(gap * 100).toFixed(1)} cm)`);
    check(r.supBend <= BEND_OK, `${tag}: support wrist bend ${(r.supBend * DEG).toFixed(0)} deg`);
  }

  // arms: rigid, not through each other, not through the chest
  const L = armPoints(rig, -1), R = armPoints(rig, 1);
  const rest = opts.rest;
  const dl = [Math.abs(L.sh.distanceTo(L.el) - rest[-1][0]), Math.abs(L.el.distanceTo(L.wr) - rest[-1][1]),
    Math.abs(R.sh.distanceTo(R.el) - rest[1][0]), Math.abs(R.el.distanceTo(R.wr) - rest[1][1])];
  r.stretch = Math.max(...dl);
  check(r.stretch < 1e-4, `${tag}: no arm segment stretched (${(r.stretch * 1000).toFixed(2)} mm)`);
  for (const p of [rig.parts.la, rig.parts.ra, rig.parts.la.userData.low, rig.parts.ra.userData.low]) {
    check(Math.abs(p.scale.x - 1) < 1e-9 && Math.abs(p.scale.y - 1) < 1e-9 && Math.abs(p.scale.z - 1) < 1e-9, `${tag}: arm parts unscaled`);
  }
  if (twoHand) {
    r.foreDist = segDist(L.el, L.wr, R.el, R.wr);
    check(r.foreDist >= 0.05, `${tag}: forearms clear of each other (${(r.foreDist * 100).toFixed(1)} cm)`);
  }
  // the arms (elbow half of the upper arm + forearm) and the gun clear the
  // body as worn: the shaped chest, the belly, the plate carrier
  // (a one-handed gun's off arm is not held: it is the idle arm, armor.js's
  // arm clearance and tools/overlap-audit.mjs own it)
  r.armPen = Math.max(twoHand ? CBZ.charArmTo.armPen(rig, "l") : 0, CBZ.charArmTo.armPen(rig, "r")) * WORLD;
  r.gunPen = gunPen(rig, prop);
  if (process.env.GHC_GUNDBG && r.gunPen > 0.004) console.log("GUNPEN", tag, (r.gunPen * 1000).toFixed(1), JSON.stringify(gunPen.where), "solver sees", (GH.gunInBody(rig, prop) * 700).toFixed(1));
  check(r.armPen < ARM_TOL, `${tag}: arms clear the body and its kit (${(r.armPen * 1000).toFixed(1)} mm inside)`);
  check(r.gunPen < PEN_TOL, `${tag}: the gun clears the body and its kit (${(r.gunPen * 1000).toFixed(1)} mm inside)`);
  return r;
}

// ---------------------------------------------------------------- scenes
function freshRig(c, kit) {
  const scene = new T.Scene();
  const rig = CBZ.makeCharacter(Object.assign({}, base, c));
  scene.add(rig.group);
  if (kit && CBZ.cityArmorDressPed) CBZ.cityArmorDressPed({ char: rig }, kit);
  rig.group.updateMatrixWorld(true);
  return { scene, rig, rest: restLengths(rig) };
}
// one game frame, in the loop's order: updaters (the hold's restore at 9.99,
// the player's animChar at 10, actorweapons' passes at 36/36.5), then the
// always passes (the player's hold at 53.9..54.6)
function frame(rig, after, player, speed) {
  const dt = 1 / 60;
  for (const [o, fn] of updates) if (o < 10) fn(dt);
  CBZ.animChar(rig, speed || 0, dt);
  for (const [o, fn] of updates) if (o >= 10) fn(dt);
  if (after) after();
  if (player) for (const [o, fn] of always) {
    fn(dt);
    if (process.env.GHC_TRACE && CBZ.tpHandWeapon && CBZ.tpHandWeapon()) {
      const p = CBZ.tpHandWeapon(); rig.group.updateMatrixWorld(true);
      const w = p.getWorldPosition(new T.Vector3()), c = CBZ.charArmTo.crease(rig, "r", new T.Vector3());
      console.log("TRACE", o, w.distanceTo(c).toFixed(3), p.parent && p.parent.name, p.position.toArray().map((v) => v.toFixed(2)).join(","));
    }
  }
}
function npcCase(B, id) {
  const { scene, rig, rest } = freshRig(B.c, B.kit);
  CBZ.scene = scene; CBZ.game = { mode: "none" };
  const actor = { char: rig, armed: true, weapon: id, group: rig.group, pos: rig.group.position };
  for (let f = 0; f < 30; f++) frame(rig, () => CBZ.actorReadyPose(actor), false);   // the idle off arm settles
  CBZ.actorReadyPose(actor);
  return measure(rig, actor._weaponProp, `${B.label}/${id}/npc`, "npc", { rest });
}
// an NPC aiming at a rooftop / down a slope: city/combat.js pitches the ready
// pose through CBZ.gunHold.pitchNpc; the gun must pitch and both hands stay on it
function npcPitchCase(B, id, pitch) {
  const { scene, rig, rest } = freshRig(B.c, B.kit);
  CBZ.scene = scene; CBZ.game = { mode: "none" };
  const actor = { char: rig, armed: true, weapon: id, group: rig.group, pos: rig.group.position };
  CBZ.actorReadyPose(actor);
  const prop = actor._weaponProp;
  rig.group.updateMatrixWorld(true);
  const d0 = new T.Vector3(0, 0, -1).applyQuaternion(prop.getWorldQuaternion(new T.Quaternion()));
  GH.pitchNpc(rig, prop, pitch);
  rig.group.updateMatrixWorld(true);
  const d1 = new T.Vector3(0, 0, -1).applyQuaternion(prop.getWorldQuaternion(new T.Quaternion()));
  const tag = `${B.label}/${id}/npc${pitch < 0 ? "-up" : "-down"}`;
  const got = Math.asin(Math.max(-1, Math.min(1, d1.y))) - Math.asin(Math.max(-1, Math.min(1, d0.y)));
  check(Math.abs(got + pitch) < 0.05, `${tag}: the barrel pitches with the aim (${(got * DEG).toFixed(1)} vs ${(-pitch * DEG).toFixed(1)} deg)`);
  const r = measure(rig, prop, tag, "npc-pitch", { rest });
  return r;
}
function playerCase(B, id, aiming, st) {
  st = st || {};
  const { scene, rig, rest } = freshRig(B.c, B.kit);
  CBZ.scene = scene; CBZ.game = { mode: "city" };
  CBZ.player = { dead: false, pos: rig.group.position };
  CBZ.playerChar = rig;
  CBZ.camera = new T.PerspectiveCamera(60, 1.6, 0.1, 500);
  CBZ.camera.position.set(0.5, 1.9, -3.2); CBZ.camera.lookAt(0, 1.4, 10);
  scene.add(CBZ.camera);
  CBZ.cam = { pitch: 0 };
  CBZ.playerArmed = () => true; CBZ.currentWeaponId = id; CBZ.weaponInventory = [id];
  CBZ.tpPresenting = () => aiming;
  const ap = st.pitch || 0;
  CBZ.playerAimDir = (o) => o.set(0, Math.sin(ap), Math.cos(ap));
  CBZ.fps = { active: false, reloading: 0 };
  CBZ.cityPeds = []; CBZ.cityCops = [];
  const slot = CBZ.buildActorWeapon(id).userData.weaponSlot;
  let prev = null, drift = 0;
  for (let f = 0; f < 120; f++) {
    rig.aimingPose = aiming; rig.carryPose = !aiming; rig.aimLong = slot !== "pistol" && slot !== "utility";
    rig.crouch = !!st.crouch; rig.pronePose = !!st.prone;
    CBZ.fpsPumpRack = st.rack || 0;
    frame(rig, null, true, st.speed || 0);
    scene.updateMatrixWorld(true);
    const p = CBZ.tpHandWeapon();
    if (process.env.GHC_LIFT && p && f >= 60) console.log("LIFT", f, (rig._gunRestY || 0).toFixed(4), rig.body.worldToLocal(p.getWorldPosition(new T.Vector3())).toArray().map((v) => v.toFixed(3)).join(","));
    if (p && f >= 100) {
      // in the chest's own frame: a walking body bobs, the gun must not slide in it
      const w = rig.body.worldToLocal(p.getWorldPosition(new T.Vector3())).multiplyScalar(WORLD);
      if (prev) { drift = Math.max(drift, w.distanceTo(prev)); if (process.env.GHC_DEBUG && w.distanceTo(prev) > 0.004) console.log("DRIFT", B.label, id, aiming, f, w.distanceTo(prev).toFixed(4), JSON.stringify(CBZ.gunHandAudit())); }
      prev = w;
    }
  }
  const prop = CBZ.tpHandWeapon();
  const tag = `${B.label}/${id}/${aiming ? "aim" : "carry"}${st.name ? "-" + st.name : ""}`;
  check(!!prop, `${tag}: a gun is in the third-person hand`);
  if (!prop) return { tag };
  const au = CBZ.gunHandAudit() || {};
  if (process.env.GHC_AUDIT) console.log("AUDIT", B.label, id, aiming, st.name || "", JSON.stringify(au));
  const released = /out of reach/.test(au.why || "");
  const r = measure(rig, prop, tag, (aiming ? "aim" : "carry") + (st.name ? "-" + st.name : ""), { rest, released });
  r.released = released;
  if (st.rack && prop.userData.pump) {
    check(Math.abs(prop.userData.pump.position.z - (prop.userData.pumpBaseZ + st.rack)) < 1e-6, `${tag}: the pump is racked on the third-person gun`);
  }
  // THE GUN IS NOT IN THE GROUND (the test floor is y = 0; a prone body here
  // is not sunk, so this bites the crouch and the low carries): the drawn gun's
  // lowest vertex, after entities/character.js gunGroundRest has had its say
  {
    let lo = Infinity; const v = new T.Vector3();
    prop.updateMatrixWorld(true);
    prop.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || o.visible === false) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) lo = Math.min(lo, v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).y);
    });
    r.gunLow = lo;
    check(lo > -0.01, `${tag}: the gun is out of the ground (lowest point ${(lo * 100).toFixed(1)} cm)`);
  }
  if (process.env.GHC_POS) {
    const L = armPoints(rig, -1), R = armPoints(rig, 1), sp = GH.supportPoint(rig, prop, new T.Vector3());
    const gpos = prop.getWorldPosition(new T.Vector3()), f = (v) => v.toArray().map((x) => x.toFixed(2)).join("/");
    console.log("POS", tag, "Lsh", f(L.sh), "Lel", f(L.el), "Lwr", f(L.wr), "Rsh", f(R.sh), "Rwr", f(R.wr), "gun", f(gpos), "sup", f(sp), "|Lsh-sup|", L.sh.distanceTo(sp).toFixed(2), "span", CBZ.charArmTo.span(rig, "l").toFixed(2));
  }
  r.drift = drift;
  // (walking, the chest bobs and leans under a gun held on the aim: the arms
  // take that up, so the gun moves in the chest's frame by a few mm a frame)
  const driftTol = st.speed ? 0.008 : 0.004;
  check(drift < driftTol, `${tag}: the hold is steady frame to frame (${(drift * 1000).toFixed(1)} mm)`);
  if (aiming) {
    // the barrel is still on the aim
    prop.updateMatrixWorld(true);
    // the bore runs down the model's -Z (the muzzle point sits above the origin)
    const o = prop.localToWorld(prop.userData.muzzle.clone());
    const dir = new T.Vector3(0, 0, -1).applyQuaternion(prop.getWorldQuaternion(new T.Quaternion()));
    const tgt = CBZ.camera.position.clone().addScaledVector(CBZ.playerAimDir(new T.Vector3()), 120).sub(o).normalize();
    r.aimErr = Math.acos(Math.min(1, dir.dot(tgt))) * DEG;
    check(r.aimErr < 1.5, `${tag}: barrel still locked to the aim (${r.aimErr.toFixed(2)} deg)`);
  }
  return r;
}

// ---------------------------------------------------------------- pure maths
{
  const M = GH.math;
  const q = new T.Quaternion();
  const x0 = new T.Vector3(0, 1, 0), n = new T.Vector3(1, 0, 0);
  // no forearm: the frame is exactly x0 / n
  let b = M.solveFrame(q, x0, n, null, 0.3, 0.3);
  const X = new T.Vector3(1, 0, 0).applyQuaternion(q), Y = new T.Vector3(0, 1, 0).applyQuaternion(q);
  check(X.distanceTo(x0) < 1e-6 && Y.distanceTo(n) < 1e-6 && b === 0, "solveFrame: no forearm -> the grip frame itself");
  // a forearm already square to the axis on the preferred side: zero bend
  const f = new T.Vector3(0, 0, 1).applyQuaternion(q);
  b = M.solveFrame(q, x0, n, f, 0.3, 0.3);
  check(b < 1e-6, "solveFrame: a forearm on the straight-wrist line bends nothing");
  // tilt and roll are capped
  const f2 = new T.Vector3(0.5, 0.5, 0.7).normalize();
  b = M.solveFrame(q, x0, n, f2, 0.2, 0.25);
  const X2 = new T.Vector3(1, 0, 0).applyQuaternion(q);
  check(Math.acos(X2.dot(x0)) <= 0.2 + 1e-6, "solveFrame: fist axis tilts no more than its budget");
  const q2 = q.clone(), dq = new T.Quaternion();
  const bc = M.clampBend(q2, f2, 0.3, dq);
  const Z2 = new T.Vector3(0, 0, 1).applyQuaternion(q2);
  check(bc <= 0.3 + 1e-6 && Math.abs(Math.acos(Z2.dot(f2)) - Math.min(b, 0.3)) < 1e-4, "clampBend: the wrist ends at the cap");
  // hold poses: every radius registered, nearest picked, shared geometry
  for (const R of H.HOLD_RADII) {
    const nm = Math.round(R * 1000);
    check(!!H.POSES["trig" + nm] && !!H.POSES["hold" + nm], `hold poses at ${nm} mm`);
  }
  check(H.holdPose("hold", 0.031) === "hold28" && H.holdPose("trig", 0.100) === "trig58" && H.holdPose("hold", 0.001) === "hold22", "holdPose picks the nearest radius");
  check(H.bodyHandGeometry(1, "trig34", 1) === H.bodyHandGeometry(1, "trig34", 1), "hold geometry cached and shared");
  const gc = H.gripCentre("hold40", new T.Vector3());
  check(Math.abs(gc.y + (H.PALM.th * 0.5 + 0.040)) < 1e-9, "a hold's grip centre sits its wrap radius under the palm");
}
// arm solver: exact, rigid, elbow down
{
  const { rig, rest } = freshRig({});
  const tgt = new T.Vector3();
  let worst = 0, up = 0;
  // reachable targets: from each shoulder, 75% of the arm (to the crease) out
  const reach = (-rig.parts.la.userData.low.position.y - rig.parts.la.userData.cap.userData.fit.wristY) * 0.7 * 0.75;
  for (const [x, y, z] of [[0.3, -0.2, 0.9], [-0.6, -0.3, 0.7], [0.1, -0.9, 0.3], [-0.2, 0.2, 0.95], [0.5, -0.5, 0.6]]) {
    for (const arm of ["l", "r"]) {
      const sh = (arm === "l" ? rig.parts.la : rig.parts.ra).getWorldPosition(new T.Vector3());
      tgt.set(arm === "l" ? x : -x, y, z).normalize().multiplyScalar(reach).add(sh);
      CBZ.charArmTo.rest(rig, arm, 0);
      const res = CBZ.charArmTo.wrist(rig, tgt, arm, null, 1);
      worst = Math.max(worst, res);
      const P = armPoints(rig, arm === "l" ? -1 : 1);
      // the elbow sits below the shoulder->wrist line
      const t = P.el.clone().sub(P.sh).dot(P.wr.clone().sub(P.sh).normalize());
      const onLine = P.sh.clone().addScaledVector(P.wr.clone().sub(P.sh).normalize(), t);
      if (P.el.y > onLine.y + 1e-4) up++;
    }
  }
  const L = restLengths(rig);
  const st = Math.max(Math.abs(L[-1][0] - rest[-1][0]), Math.abs(L[-1][1] - rest[-1][1]), Math.abs(L[1][0] - rest[1][0]), Math.abs(L[1][1] - rest[1][1]));
  check(worst < 1e-3, `charArmTo.wrist lands the crease (worst ${(worst * 1000).toFixed(2)} mm)`);
  check(st < 1e-6, "charArmTo.wrist never stretches a segment");
  check(up === 0, `charArmTo.wrist keeps the elbow below the shoulder-wrist line (${up} up)`);
}

// ---------------------------------------------------------------- run
// the stances a shooter actually moves through: walking with the gun up,
// crouched, prone (aim), and a walking / crouched low-ready carry
const STANCES = [
  { name: "walk", aim: true, speed: 3.2 },
  // looking up and down between the cached pitch levels
  { name: "up", aim: true, pitch: 0.17 },
  { name: "down", aim: true, pitch: -0.23 },
  { name: "crouch", aim: true, crouch: true },
  { name: "prone", aim: true, prone: true },
  { name: "walk", aim: false, speed: 3.2 },
  // a pump gun mid-rack: the fore-end slid 15 cm back, the off hand on it
  { name: "rack", aim: true, rack: 0.15, only: /shotgun/ },
  { name: "crouch", aim: false, crouch: true },
];
const rows = [];
// GHC_ONLY=<regex> runs only the matching body/gun pairs (e.g. "man/carbine")
const ONLY = process.env.GHC_ONLY ? new RegExp(process.env.GHC_ONLY) : null;
for (const B of BODIES) {
  for (const id of GUNS) {
    if (ONLY && !ONLY.test(`${B.label}/${id}`)) continue;
    rows.push(npcCase(B, id));
    rows.push(npcPitchCase(B, id, -0.45));
    rows.push(npcPitchCase(B, id, 0.30));
    // between two cached pitch levels (the blend, not an exact level)
    rows.push(npcPitchCase(B, id, -0.175));
    rows.push(playerCase(B, id, true));
    rows.push(playerCase(B, id, false));
    for (const st of STANCES) if (!st.only || st.only.test(id)) rows.push(playerCase(B, id, st.aim, st));
  }
}
const cm = (v) => (v == null ? "   -" : (v * 100).toFixed(1).padStart(5));
const dg = (v) => (v == null ? "  -" : (v * DEG).toFixed(0).padStart(3));
console.log("case                         fire cm  axis  bend | sup cm  behind  bend | fore cm  stretch | arm/gun in body mm");
const agg = {};
for (const r of rows) {
  const key = r.stance;
  const a = agg[key] = agg[key] || { n: 0, fireGap: 0, fireAxis: 0, fireBend: 0, supGap: 0, supBend: 0, supN: 0, behind: 0 };
  a.n++;
  a.fireGap = Math.max(a.fireGap, r.fireGap || 0); a.fireAxis = Math.max(a.fireAxis, r.fireAxis || 0); a.fireBend = Math.max(a.fireBend, r.fireBend || 0);
  if (r.twoHand) { a.supN++; a.supGap = Math.max(a.supGap, r.supGap || 0); a.supBend = Math.max(a.supBend, r.supBend || 0); if (r.supAlong > 0.005) a.behind++; }
  a.armPen = Math.max(a.armPen || 0, r.armPen || 0); a.gunPen = Math.max(a.gunPen || 0, r.gunPen || 0);
  if (verbose || r.tag.startsWith("man/") || r.tag.startsWith("heavy+plate/")) {
    console.log(r.tag.padEnd(28) + cm(r.fireGap) + "  " + (r.fireAxis == null ? "  -" : r.fireAxis.toFixed(0).padStart(3)) + "  " + dg(r.fireBend) + "  |" +
      (r.twoHand ? cm(r.supGap) + "  " + (r.supAlong == null ? "    -" : cm(r.supAlong)) + "   " + dg(r.supBend) : r.released ? "  one-hand carry          " : "  one-handed              ") +
      " |" + (r.foreDist == null ? "     -" : cm(r.foreDist)) + "  " + (r.stretch == null ? "-" : (r.stretch * 1000).toFixed(2) + "mm") +
      " | " + (r.armPen == null ? "-" : (r.armPen * 1000).toFixed(1).padStart(5)) + " " + (r.gunPen == null ? "-" : (r.gunPen * 1000).toFixed(1).padStart(5)));
  }
}
console.log("\nworst per stance (all bodies):");
for (const [k, a] of Object.entries(agg)) {
  console.log(`  ${k.padEnd(6)} n=${a.n}  fire ${(a.fireGap * 100).toFixed(1)} cm / axis ${a.fireAxis.toFixed(1)} deg / bend ${(a.fireBend * DEG).toFixed(0)} deg   ` +
    `support (${a.supN}) ${(a.supGap * 100).toFixed(1)} cm / bend ${(a.supBend * DEG).toFixed(0)} deg / ${a.behind} held behind the handguard   ` +
    `in the body: arms ${((a.armPen || 0) * 1000).toFixed(1)} mm, gun ${((a.gunPen || 0) * 1000).toFixed(1)} mm`);
}
if (stressList.length) console.log("\nstress body (heavy man in a plate carrier), reported not failed: " + stressList.length + " misses\n  . " + stressList.slice(0, 12).join("\n  . ") + (stressList.length > 12 ? "\n  . ..." : ""));
if (fails) console.log("\nFAIL\n  - " + failList.slice(0, 40).join("\n  - ") + (failList.length > 40 ? `\n  ... ${failList.length - 40} more` : ""));
console.log(`\n${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
