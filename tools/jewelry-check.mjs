#!/usr/bin/env node
/* tools/jewelry-check.mjs — JEWELRY LIES ON THE BODY IT IS WORN ON.

   Runs the REAL materials.js + fphands.js + character.js + watch.js +
   entities/jewelry_kit.js in plain node (no browser, no captures) and asserts:

     1. geometry: the brilliant, every link, pendant, ring, earring, grill,
        tiara and bracelet build finite, wound outward (positive signed
        volume on the closed solids), inside a triangle budget;
     2. THE DRAPE, on a man, a woman, a big man and a teen: every chain point
        in front of the neck axis is OUT of the torso (>= the chain's own
        half-thickness off rig.torsoFrontZ), no point behind it is inside the
        collar ring; the loop is closed, the bail is the lowest front point,
        below the collarbone notch and above the waist; the pendant's rest
        chord does not enter the chest;
     3. rings ride the hand at a finger base; earrings sit at the lobe drawn
        by earGeometry (inside the ear's own box), both sides;
     4. the pendulum: an upright body leaves the pendant on the chest; a body
        pitched 60 degrees forward swings it OFF the chest (a < 0); it never
        swings into it.

     node tools/jewelry-check.mjs        exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math, performance, Date });
ctx.window = ctx; ctx.self = ctx;
const always = [];
ctx.CBZ = { CONFIG: {}, onAlways(o, f) { always.push(f); }, onUpdate() {}, on() {} };
for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/footwear.js", "src/entities/character.js", "src/entities/watch.js", "src/entities/jewelry_kit.js"]) {
  vm.runInContext(read(f), ctx, { filename: f });
}
const { THREE: T, CBZ } = ctx;
const J = CBZ.jewel, X = J._test;
let fails = 0, checks = 0;
function check(ok, msg) { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } }
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const finite = (g) => Array.prototype.every.call(g.attributes.position.array, Number.isFinite);
function vol(g) {
  const p = g.attributes.position, idx = g.index ? g.index.array : null, n = idx ? idx.length : p.count;
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  let v = 0;
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(p, idx ? idx[i] : i); b.fromBufferAttribute(p, idx ? idx[i + 1] : i + 1); c.fromBufferAttribute(p, idx ? idx[i + 2] : i + 2);
    v += a.dot(b.clone().cross(c)) / 6;
  }
  return v;
}

// ---- 1. geometry ---------------------------------------------------------
{
  const G = new X.Geo();
  G.add(X.brilliant(), null);
  const g = G.build();
  check(finite(g) && tris(g) === 112, "brilliant: 112 finite facets (" + tris(g) + ")");
  check(vol(g) > 0, "brilliant wound outward");
  const L = X.linkTemplate(0.012, 0.009, 0.0016, 0.6, 12, 6);
  const lg = new X.Geo(); lg.add(L, null); const lgg = lg.build();
  check(vol(lgg) > 0, "link wound outward (" + vol(lgg).toExponential(2) + ")");
  for (const k of ["cross", "medallion", "solitaire", "drop"]) {
    const parts = X.pendantParts(k);
    check(parts.length > 0, k + ": has parts");
    for (const p of parts) {
      check(finite(p.geo), k + "/" + p.finish + ": finite");
      check(tris(p.geo) < 12000, k + "/" + p.finish + ": " + tris(p.geo) + " tris");
      p.geo.computeBoundingBox();
      check(p.geo.boundingBox.max.y < 0.001, k + "/" + p.finish + ": hangs below its bail (max y " + p.geo.boundingBox.max.y.toFixed(4) + ")");
    }
  }
  for (const st of ["solitaire", "rock", "pinky"]) {
    const P = X.ringParts(st, 0.0091);
    check(finite(P.metal) && vol(P.metal) > 0, "ring " + st + ": metal finite + outward");
    P.metal.computeBoundingBox();
    const bb = P.metal.boundingBox;
    check(bb.max.x < 0.02 && bb.min.x > -0.02, "ring " + st + ": real size (" + (bb.max.x - bb.min.x).toFixed(4) + " m across)");
  }
  for (const st of ["hoop", "stud"]) { const P = X.earParts(st); check(finite(P.metal), "earring " + st + ": finite"); }
  const tp = X.tiaraParts();
  check(finite(tp.metal) && finite(tp.gem) && tris(tp.gem) < 40000, "tiara: finite, " + tris(tp.gem) + " gem tris");
  const gu = X.grillGeo(true, 0.1, 0.014);
  check(finite(gu), "grill: finite");
  gu.computeBoundingBox();
  check(gu.boundingBox.max.z > 0.002, "grill caps stand in front of the teeth strip");
}

// ---- 2. the drape on real bodies -----------------------------------------
CBZ.scene = new T.Scene();
const bodies = [
  { label: "man", c: { build: "m" } },
  { label: "woman", c: { build: "f" } },
  { label: "teen", c: { build: "m", age: 14 } },
  { label: "heavy", c: { build: "m", physique: "heavy" } },
];
for (const B of bodies) {
  const rig = CBZ.makeCharacter(Object.assign({ legs: 0x223344, torso: 0x445566, arms: 0x445566, skin: 0xc89a78, shoes: 0x222222 }, B.c));
  CBZ.scene.add(rig.group);
  rig.group.updateMatrixWorld(true);
  const S = rig.torsoShape;
  for (const style of ["curb", "cuban", "riviera", "cable"]) {
    const st = J.CHAIN[style];
    const D = X.drape(rig, st);
    const tag = B.label + "/" + style;
    check(D.pts.every((p) => p.every(Number.isFinite)), tag + ": finite path");
    const half = st.half * 1.2 * D.U;
    let worst = Infinity, worstBack = Infinity;
    for (const p of D.pts) {
      if (p[2] > S.nZc && p[1] < S.yN - 0.03 * S.vs) {
        const z = rig.torsoFrontZ(p[0], p[1]);
        worst = Math.min(worst, p[2] - z - half);
      } else if (p[2] <= S.nZc) {
        const rx0 = (S.nRx + 0.022 * S.vs) * 1.02, rz0 = (S.nRz + 0.022 * S.vs) * 1.02;
        const e = Math.hypot(p[0] / rx0, (p[2] - S.nZc) / rz0);
        worstBack = Math.min(worstBack, e);
      }
    }
    check(worst > -0.002, tag + ": chain clear of the chest (worst " + (worst / D.U * 1000).toFixed(1) + " mm)");
    check(worstBack >= 1.0, tag + ": chain outside the collar at the nape (" + worstBack.toFixed(3) + ")");
    const bail = D.bail, notch = S.yN - S.tf - 0.03 * S.vs;
    const minY = Math.min(...D.pts.map((p) => p[1]));
    check(Math.abs(bail[1] - minY) < 0.01, tag + ": the bail is the lowest point");
    check(bail[1] < notch - 0.01 && bail[1] > S.chestBot, tag + ": bail on the chest (" + ((notch - bail[1]) / D.U * 100).toFixed(1) + " cm under the notch)");
    check(Math.abs(bail[0]) < 1e-6, tag + ": bail on the centre line");
    // the pendant's chord: 4.5 cm down it, still off the chest
    const Lp = 0.045 * 1.2 * D.U, q = [bail[0] + D.down[0] * Lp, bail[1] + D.down[1] * Lp, bail[2] + D.down[2] * Lp];
    check(q[2] >= rig.torsoFrontZ(q[0], q[1]) - 1e-4, tag + ": pendant chord off the chest");
    const cumL = D.pts.reduce((a, p, i) => { const o = D.pts[(i + 1) % D.pts.length]; return a + Math.hypot(o[0] - p[0], o[1] - p[1], o[2] - p[2]); }, 0);
    const Lm = cumL / D.U;
    check(Lm > 0.38 && Lm < 1.45, tag + ": loop length " + (Lm * 100).toFixed(0) + " cm (real-ish)");
    if (style === "curb" && B.label === "man") console.log("  man/curb: loop " + (Lm * 100).toFixed(1) + " cm, drop " + ((notch - bail[1]) / D.U * 100).toFixed(1) + " cm, clearance min " + (worst / D.U * 1000).toFixed(1) + " mm");
  }
  // build + mount + release every piece
  for (const style of ["curb", "cuban", "riviera"]) {
    const n = J.necklace(rig, style, true);
    check(n && n.parent === rig.body, B.label + "/" + style + ": necklace on the body");
    let meshes = 0, trisN = 0;
    n.traverse((o) => { if (o.isMesh) { meshes++; trisN += tris(o.geometry); check(o.userData.pedInstSkip === true, "jewel mesh skips instancing"); } });
    check(meshes >= 2 && trisN < 60000, B.label + "/" + style + ": " + meshes + " meshes, " + trisN + " tris");
    J.release(n);
    check(!n.parent, "released");
  }
  const lm = CBZ.charHeadLandmarks(rig);
  check(lm && lm.lobe.every(Number.isFinite), B.label + ": head landmarks");
  const ears = J.earrings(rig, "hoop");
  check(ears.length === 2 && ears[0].parent === rig.neck, B.label + ": two earrings on the neck group");
  // inside the ear's own box (HAIR_EAR: x .290-.354, y .228-.382, z -.087-.017 face units) scaled hk, head at y hs/2
  const hk = lm.hk, hs = rig.profile.headSize;
  const lx = lm.lobe[0] / hk, ly = (lm.lobe[1] - hs / 2) / hk + 0.30, lz = lm.lobe[2] / hk;
  check(lx > 0.29 && lx < 0.36 && ly > 0.20 && ly < 0.30 && lz > -0.09 && lz < 0.02, B.label + ": lobe in the ear (" + [lx, ly, lz].map((v) => v.toFixed(3)).join(",") + ")");
  ears.forEach((e) => J.release(e));
  const gr = J.grill(rig);
  check(gr.length === 2 && gr[0].parent === rig.mouthIn.teethUp, B.label + ": grill rides the teeth");
  gr.forEach((m) => J.release(m));
  const ti = J.tiara(rig);
  check(ti && ti.parent === rig.neck, B.label + ": tiara on the head");
  J.release(ti);
  // the ring on the right hand mesh
  const lmA = CBZ.charArmLandmarks(rig);
  if (lmA && lmA.ringHand) {
    const r = J.ring(lmA.ringHand, lmA.ringFingers[2], "rock");
    check(r && r.parent === lmA.ringHand, B.label + ": ring on the hand");
    J.release(r);
  }
  const wp = CBZ.wristwatch.wristPlace(rig, true);
  check(wp && wp.anchor && wp.fit.a > 0, B.label + ": right wrist measured");
  if (wp) { const br = J.bracelet(wp.anchor, wp); check(br && br.parent === wp.anchor, B.label + ": bracelet on the right wrist"); J.release(br); }
}

// ---- 4. the pendulum --------------------------------------------------------
{
  const rig = CBZ.makeCharacter({ build: "m" });
  CBZ.scene.add(rig.group);
  CBZ.camera = new T.PerspectiveCamera();
  CBZ.camera.position.set(0, 1.6, 3); CBZ.camera.updateMatrixWorld(true);
  const n = J.necklace(rig, "curb", true);
  let pv = null;
  n.traverse((o) => { if (o.userData && o.userData.swing) pv = o; });
  check(!!pv, "pendant pivot exists");
  const run = (frames) => { for (let i = 0; i < frames; i++) { rig.group.updateMatrixWorld(true); J.tick(); const t0 = Date.now(); while (Date.now() - t0 < 2); } };
  run(40);
  const W = pv.userData.swing;
  check(Math.abs(W.a) < 0.05, "upright: pendant rests on the chest (a " + W.a.toFixed(3) + ")");
  rig.body.rotation.x = 1.05;                                  // bow forward 60 degrees
  run(120);
  check(W.a < -0.4, "bowed: pendant hangs off the chest (a " + W.a.toFixed(3) + ")");
  rig.body.rotation.x = -1.2;                                  // lean far back
  run(120);
  check(W.a <= 1e-9, "leaning back: never into the chest (a " + W.a.toFixed(3) + ")");
  J.release(n);
}

// ---- the shop's pieces are the same pieces ---------------------------------
for (const [k, a] of [["necklace", "curb"], ["necklace", "cuban"], ["necklace", "riviera"], ["ring", "solitaire"], ["ring", "rock"], ["grill"], ["tiara"]]) {
  const g = J.display[k](a, 0.03);
  let n = 0, ok = true;
  g.traverse((o) => { if (o.isMesh) { n++; ok = ok && finite(o.geometry); } });
  check(n > 0 && ok, "display " + k + " " + (a || "") + ": " + n + " finite meshes");
}

// ---- 5. bling.js mounts every look through the kit --------------------------
{
  CBZ.game = { mode: "city" };
  CBZ.boxGeom = CBZ.boxGeom || ((w, h, d) => new T.BoxGeometry(w, h, d));
  vm.runInContext(read("src/city/bling.js"), ctx, { filename: "src/city/bling.js" });
  const looks = ["chainGold", "chainDiamond", "chainIced", "bracelet", "ring", "ringRock", "ringPinky", "earrings", "earringsIce", "tiara", "grill", "shades", "shadesAviator"];
  for (const look of looks) {
    const rig = CBZ.makeCharacter({ build: "f" });
    const parts = CBZ.cityBlingLookParts(look);
    check(parts && parts.length, look + ": has parts");
    const out = CBZ.cityBlingBuild(parts, rig.neck, [], null, rig);
    check(out.length > 0, look + ": mounted " + out.length);
    for (const o of out) J.release(o);
  }
  check(CBZ.cityBlingClassify("Earrings").look === "earrings", "Earrings are earrings, not a ring");
  check(CBZ.cityBlingClassify("Engagement Ring").look === "ringRock", "Engagement Ring is the rock");
  check(CBZ.cityBlingClassify("Tennis Bracelet").slot === "wristR", "Tennis Bracelet on the right wrist");
}

console.log((fails ? "FAIL" : "ok") + " — " + checks + " checks, " + fails + " failed");
process.exit(fails ? 1 : 0);
