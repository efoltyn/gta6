#!/usr/bin/env node
/* tools/face-check.mjs — THE FACE (entities/character.js) in plain node.

   Builds male / female / child bodies in every eye shape and heritage, poses
   them through the real CBZ.human.facePose, and shoots RAYS at them (three's
   own Raycaster, front faces only, hidden meshes skipped) to prove:
     1. EYES ARE SEEN: open, a ray at the pupil from in front hits the eyeball
        first (not skin, not a lid).
     2. EYES SIT IN SOCKETS: the ball's front is flush with the face plane (not
        stuck on it), and a ray at the eye from the side (80 deg) hits skull or
        lid first — the eye is sunk in the head, not a marble glued to it.
     3. CLOSED IS CLOSED: blink 1 — rays from 7 viewpoints (front, +/-25 deg
        yaw, +/-15 deg pitch, corners) at a grid of points over the whole eye
        opening never reach the eyeball. Checked at rest, wide (fear) and
        looking down / up / sideways.
     4. THE MOUTH SHUTS: open 0 — the cavity and teeth are hidden and rays
        along the lip seam hit LIP, never the skull behind it, for every
        closed expression.
     5. THE MOUTH OPENS: open 0.03 — a ray at the middle of the gap hits the
        dark cavity or the teeth.
     6. THE TIER: faceLod(false) swaps to the light skull, hides the near eyes,
        shows the eye line; faceLod(true) puts it all back.

     node tools/face-check.mjs          PASS/FAIL + counts (3 heritages)
     node tools/face-check.mjs --all    every heritage
*/
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math, Map, Set, Float32Array, Float64Array, Int32Array, Uint16Array, Uint32Array });
ctx.window = ctx; ctx.self = ctx;
ctx.CBZ = { CONFIG: {} };
vm.runInContext(read("src/vendor/three.r128.min.js"), ctx, { filename: "three" });
vm.runInContext(`
  (function(){
    const gc = new Map(), mc = new Map();
    CBZ.mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    CBZ.cmat = (c) => { let m = mc.get(c); if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); m._shared = true; mc.set(c, m); } return m; };
    CBZ.boxGeom = (w, h, d) => { const k = w + "," + h + "," + d; let g = gc.get(k); if (!g) { g = new THREE.BoxGeometry(w, h, d); g._shared = true; gc.set(k, g); } return g; };
  })();`, ctx);
for (const f of ["src/systems/fphands.js", "src/entities/footwear.js", "src/entities/character.js", "src/entities/heritage.js"]) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { if (!f.includes("fphands")) throw e; }
}
const { THREE: T, CBZ } = ctx;
const H = CBZ.human;
let fails = 0, checks = 0;
const firstFail = new Map();
function check(ok, msg) { checks++; if (!ok) { fails++; const k = msg.replace(/\S+\//, ""); if (!firstFail.has(k)) { firstFail.set(k, 0); console.log("  FAIL " + msg); } firstFail.set(k, firstFail.get(k) + 1); } }

const ray = new T.Raycaster();
function shown(o) { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; }
// only the head's own meshes can stand between a ray and a face
function meshes(rig) {
  if (rig._fcMeshes) return rig._fcMeshes;
  const out = [];
  rig.neck.traverse((o) => { if (o.isMesh) out.push(o); });
  return (rig._fcMeshes = out);
}
// first VISIBLE hit along a ray from face-frame point `from` toward face-frame point `to`
const _a = new T.Vector3(), _b = new T.Vector3();
function hitFirst(rig, frame, from, to) {
  _a.set(from[0], from[1], from[2]); frame.localToWorld(_a);
  _b.set(to[0], to[1], to[2]); frame.localToWorld(_b);
  ray.set(_a, _b.sub(_a).normalize());
  const hits = ray.intersectObjects(meshes(rig), false);
  for (const h of hits) if (shown(h.object)) return h.object;
  return null;
}
function pose(rig, p) { H.facePose(rig, Object.assign({}, H.faceRestPose, p)); rig.group.updateMatrixWorld(true); }

const forms = [
  { tag: "male", c: {} },
  { tag: "female", c: { build: "f" } },
  { tag: "child6", c: { age: 6 } },
];
let bodies = 0;
const IDS = process.argv.includes("--all") ? CBZ.HERITAGE_IDS : ["black", "white", "eastasian"];
for (const id of IDS) for (const b of forms) for (const shape of [0, 1, 2]) {
  const look = CBZ.heritageRoll(id, id + "|" + b.tag + "|" + shape);
  const c = Object.assign({ torso: 0x445566, arms: 0x445566, legs: 0x223344, shoes: 0x1a1a1a }, look, b.c, { eyeShape: shape });
  delete c.beard; c.bald = true; c.hairStyle = null;               // nothing between the rays and the face
  const rig = H.build(c);
  bodies++;
  const tag = `${id}/${b.tag}/shape${shape}`;
  const f = rig.face, R = rig.faceRest, frame = rig.faceNodes.near;
  const eyeRad = f.eyeL.geometry.parameters.radius;
  pose(rig, {});

  // 1 + 2: seen, and sunk
  for (const s of [-1, 1]) {
    const ex = s * R.eyeX, ball = s < 0 ? f.eyeL : f.eyeR;
    check(hitFirst(rig, frame, [ex, R.eyeY, 3], [ex, R.eyeY, R.eyeZ]) === ball, `${tag} open eye visible from the front`);
    const front = R.eyeZ + eyeRad;
    check(front <= 0.306 && front >= 0.29, `${tag} eyeball front flush with the face plane (${front.toFixed(3)})`);
    const side = [ex + s * 3 * Math.sin(1.4), R.eyeY, R.eyeZ + 3 * Math.cos(1.4)];
    check(hitFirst(rig, frame, side, [ex, R.eyeY, R.eyeZ]) !== ball, `${tag} eye sunk in its socket (side ray blocked)`);
  }

  // 3: closed is closed
  const views = [[0, 0], [0.44, 0], [-0.44, 0], [0, 0.26], [0, -0.26], [0.3, -0.2], [-0.3, -0.2]];
  const closedPoses = [{ blink: 1 }, { blink: 1, lidU: -0.2, brow: "f" }, { blink: 1, pitch: -0.35 }, { blink: 1, pitch: 0.35 }, { blink: 1, yaw: 0.5 }, { blink: 1, lidL: 0.15, lidU: 0.2 }];
  for (const cp of closedPoses) {
    pose(rig, cp);
    let leak = 0, n = 0;
    for (const s of [-1, 1]) {
      const ball = s < 0 ? f.eyeL : f.eyeR, ex = s * R.eyeX;
      for (let i = -3; i <= 3; i++) for (let j = -2; j <= 2; j++) {
        const az = i / 3 * 1.15, el = j / 2 * 0.62;
        const tgt = [ex + eyeRad * Math.cos(el) * Math.sin(az), R.eyeY + eyeRad * Math.sin(el), R.eyeZ + eyeRad * Math.cos(el) * Math.cos(az)];
        for (const v of views) {
          const from = [tgt[0] + 3 * Math.sin(v[0]) * Math.cos(v[1]), tgt[1] + 3 * Math.sin(v[1]), tgt[2] + 3 * Math.cos(v[0]) * Math.cos(v[1])];
          n++;
          if (hitFirst(rig, frame, from, tgt) === ball) leak++;
        }
      }
    }
    check(leak === 0, `${tag} closed lids cover the eye ${JSON.stringify(cp)} (${leak}/${n} rays reached the ball)`);
  }

  // 4: the mouth shuts, in every closed expression
  const lips = new Set([f.mouth, f.lipLow]);
  for (const ex of ["n", "smile", "fear"]) {
    pose(rig, { mouth: ex });
    const M = rig.mouthIn;
    check(!M.cavity.visible && !M.teethUp.visible && !M.teethLow.visible, `${tag} shut mouth (${ex}) hides cavity + teeth`);
    let bad = 0;
    for (let i = -6; i <= 6; i++) {
      const x = i / 6 * 0.055 * R.lipSx, t = x / (0.08 * R.lipSx);
      const seamY = R.mouthY + (ex === "smile" ? 0.020 : ex === "fear" ? -0.010 : 0) * t * t * R.lipSy;
      for (const dy of [-0.002, 0, 0.002]) {
        const o = hitFirst(rig, rig.face.mouth.parent, [x, seamY + dy, 3], [x, seamY + dy, 0.25]);
        if (!lips.has(o)) bad++;
      }
    }
    check(bad === 0, `${tag} shut mouth (${ex}): the lips meet along the seam (${bad} rays hit something else)`);
  }
  // 5: the mouth opens
  pose(rig, { open: 0.03 });
  {
    const o = hitFirst(rig, rig.face.mouth.parent, [0, R.mouthY - 0.012, 3], [0, R.mouthY - 0.012, 0.25]);
    const M = rig.mouthIn;
    check(o === M.cavity || o === M.teethUp || o === M.teethLow, `${tag} open mouth shows the inside (hit ${o && o.name})`);
  }
  pose(rig, { open: 0.02, mouth: "snarl" });
  check(rig.mouthIn.teethUp.visible, `${tag} snarl bares the teeth`);

  // 6: the tier
  pose(rig, {});
  const nearGeo = rig.head.geometry;
  H.faceLod(rig, false);
  check(rig.head.geometry !== nearGeo && !rig.faceNodes.near.visible && rig.faceNodes.far.visible, `${tag} far tier: light skull, eye line`);
  H.faceLod(rig, true);
  check(rig.head.geometry === nearGeo && rig.faceNodes.near.visible && !rig.faceNodes.far.visible, `${tag} near tier restored`);
}
// 7: systems/facial.js drives a face: blinks, talks in time with a line,
//    looks at the player, shuts its eyes when he dies, drops to the far tier
{
  let tickFn = null;
  CBZ.onAlways = (o, fn) => { tickFn = fn; };
  CBZ.now = 0;
  vm.runInContext(read("src/systems/facial.js"), ctx, { filename: "facial.js" });
  check(typeof tickFn === "function" && typeof CBZ.faceRegister === "function", "facial.js registers its tick + CBZ.faceRegister");
  const scene = new T.Scene();
  const cam = new T.PerspectiveCamera(60, 1, 0.1, 500);
  cam.position.set(0, 1.6, 3); scene.add(cam); CBZ.camera = cam;
  const rig = H.build({ torso: 0x445566, arms: 0x445566, legs: 0x223344, shoes: 0x1a1a1a, skin: 0xc08a5a, hair: 0x221a14 });
  scene.add(rig.group);
  const a = { char: rig, group: rig.group, pos: rig.group.position };
  CBZ.npcs = [a];
  CBZ.player = { pos: new T.Vector3(0, 0, 3) };
  const R = rig.faceRest, f = rig.face;
  const step = (secs, fn) => { for (let t = 0; t < secs; t += 1 / 60) { CBZ.now += 1000 / 60; scene.updateMatrixWorld(true); tickFn(1 / 60); if (fn) fn(); } };
  let blinks = 0, wasShut = false, maxYaw = 0;
  step(12, () => { const shut = f.lidUp.rotation.x > R.lidClose * 0.8; if (shut && !wasShut) blinks++; wasShut = shut; });
  check(blinks >= 2 && blinks <= 8, `idle face blinks at a human rate (${blinks} in 12 s)`);
  check(!rig.mouthIn.cavity.visible, "idle mouth stays shut");
  // the player steps to his left: the eyes (and head) go with him
  CBZ.player.pos.set(2.2, 0, 2.5); cam.position.set(2.2, 1.6, 2.5);
  step(1.5, () => { maxYaw = Math.max(maxYaw, f.eyeL.rotation.y); });
  check(maxYaw > 0.1 || rig.neck.rotation.y > 0.1, `gaze follows the player (eye yaw ${maxYaw.toFixed(2)}, neck ${rig.neck.rotation.y.toFixed(2)})`);
  // a line: the lips move with it, then shut
  rig._say = { t0: CBZ.now, text: "Hey man, what are you looking at?", rate: 14, loud: false };
  let opens = 0, closes = 0, prevOpen = false, maxGap = 0;
  step(2.2, () => { const o = rig.mouthIn.cavity.visible; const g = R.mouthY - f.lipLow.position.y; maxGap = Math.max(maxGap, g); if (o && !prevOpen) opens++; if (!o && prevOpen) closes++; prevOpen = o; });
  check(opens >= 3 && closes >= 2 && maxGap > 0.012, `the mouth moves with the words (${opens} opens, ${closes} closes, max gap ${maxGap.toFixed(3)})`);
  step(1.5);
  check(!rig.mouthIn.cavity.visible && Math.abs(f.lipLow.position.y - R.mouthY) < 0.002, "the mouth shuts when the line is said");
  a.aiState = "fight";
  step(1);
  check(R.browExpr === "a" && f.lidLow.rotation.x < -0.05, "fighting: brows down, eyes narrowed");
  a.aiState = "flee";
  step(1);
  check(R.browExpr === "f" && R.lipExpr === "fear", "afraid: brows up, lips pulled back");
  a.aiState = null; a.dead = true;
  step(3);
  check(f.lidUp.rotation.x > R.lidClose - 0.02, `dead: eyes shut (${f.lidUp.rotation.x.toFixed(2)} of ${R.lidClose.toFixed(2)})`);
  a.dead = false;
  cam.position.set(0, 1.6, 40);
  step(0.5);
  check(!R.near && !rig.faceNodes.near.visible && rig.faceNodes.far.visible, "40 m away: the far tier");
  cam.position.set(0, 1.6, 4);
  step(0.5);
  check(R.near && rig.faceNodes.near.visible, "back up close: the near tier");
}
for (const [k, n] of firstFail) if (n > 1) console.log(`  (${n}x) ${k}`);
console.log(`${fails ? "FAIL" : "PASS"}  ${checks - fails}/${checks} face checks over ${bodies} faces`);
process.exit(fails ? 1 : 0);
