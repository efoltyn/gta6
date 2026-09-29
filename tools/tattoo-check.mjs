#!/usr/bin/env node
/* tools/tattoo-check.mjs — INK IN SKIN, checked in plain node.

   Runs the REAL three r128 + materials.js + fphands.js + tattoo.js +
   character.js + heritage.js + clothes.js + outfits.js (a stub 2D canvas, so
   charts "paint" without a browser) and asserts the seams entities/tattoo.js
   depends on:

     1. UVs: the arm loft packs upper arm / forearm into the two halves of one
        chart; every hand geometry (FP + both body LODs, both sides, every
        pose) carries a chart uv; the back of each finger maps to the centre
        of its column and reads left-to-right on BOTH hands (the left hand's
        mirror is undone); the palm side and the palm's underside read the
        blank texel; the first-person forearm never smears a triangle across
        its u seam.
     2. PROFILES: deterministic per seed; homemade ink never on machine-only
        styles; no child is ever inked; a quarter-ish of city men; the player
        always carries something.
     3. MATERIALS: a tank's bare arms and the hands wear SHARED ink materials
        (one per skin tone x chart, so pedinstance pools them); a jumpsuit's
        sleeves never do; a recolour to cloth takes the ink off; colour reads
        (cityArmColors / fphands dressOf) see the skin under the ink; the
        head's own material carries its chart; charts stay pageable.
     4. FIRST PERSON: the player's FP hand and forearm swap to a twin of the
        caller's material carrying the chart, and back when sleeved/gloved.

     node tools/tattoo-check.mjs        exit 0 = ok */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const ctx = vm.createContext({ console, Math, performance });
ctx.window = ctx; ctx.self = ctx;

// a 2D context that accepts every call (charts and outfit atlases "paint")
function stubCtx(cv) {
  const grad = { addColorStop() {} };
  const t = {
    canvas: cv, filter: "none",
    measureText: (s) => ({ width: String(s).length * 20 }),
    createRadialGradient: () => grad, createLinearGradient: () => grad, createPattern: () => ({}),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4).fill(200) }),
  };
  return new Proxy(t, { get(o, k) { return k in o ? o[k] : function () {}; }, set(o, k, v) { o[k] = v; return true; } });
}
function stubCanvas(w, h) {
  const cv = { width: w || 1, height: h || 1, style: {}, addEventListener() {}, appendChild() {} };
  const c2 = stubCtx(cv);
  cv.getContext = () => c2;
  return cv;
}
ctx.document = {
  createElement(tag) { return tag === "canvas" ? stubCanvas(1, 1) : { style: {}, appendChild() {}, addEventListener() {}, getContext() { return null; } }; },
  getElementById() { return null; }, addEventListener() {}, body: { appendChild() {} },
  getElementsByTagName() { return []; }, querySelector() { return null; },
};
ctx.addEventListener = () => {};
ctx.location = { search: "" };
ctx.CBZ = { CONFIG: {}, game: {}, onAlways() {}, onUpdate() {}, on() {}, emit() {} };
ctx.CBZ.tattoo = { _mkCanvas: stubCanvas, lazy: false };
for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/systems/fphands.js", "src/entities/tattoo.js",
  "src/entities/footwear.js", "src/entities/character.js", "src/entities/headwear.js", "src/entities/heritage.js",
  "src/city/clothes.js", "src/city/outfits.js"]) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log("load " + f + " threw: " + e.message); process.exit(2); }
}
const { THREE, CBZ } = ctx;
const T = CBZ.tattoo, H = CBZ.fpHands;
let fails = 0, checks = 0;
const DEBUG = process.argv.includes("--debug");
function check(ok, msg) { checks++; if (!ok) { fails++; console.log("  FAIL " + msg); } }

// ------------------------------------------------------------ 1. UVs
{
  const ch = CBZ.makeCharacter({ skin: 0xc08a5a, torso: 0x444444, legs: 0x333333, arms: 0xc08a5a, shortSleeve: true });
  const s = ch.skinSlots;
  const vr = (m) => { const a = m.geometry.attributes.uv.array; let lo = 9, hi = -9; for (let i = 1; i < a.length; i += 2) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); } return [lo, hi]; };
  const up = vr(s.arms[0]), lo = vr(s.armsLower[0]), S = T.ARM_SPLIT;
  check(up[0] >= 1 - S - 1e-6 && up[1] <= 1 + 1e-6 && up[1] > 0.99, `upper arm v in [${(1 - S).toFixed(2)}, 1] (got ${up[0].toFixed(3)}..${up[1].toFixed(3)})`);
  check(lo[0] >= -1e-6 && lo[1] <= 1 - S + 1e-6 && lo[0] < 0.01, `forearm v in [0, ${(1 - S).toFixed(2)}] (got ${lo[0].toFixed(3)}..${lo[1].toFixed(3)})`);
  const bare = s.arms[0].userData.bare;
  if (bare) { const b = vr(bare); check(b[0] >= 1 - S - 1e-6 && b[1] <= 1 + 1e-6, `the bare piece below a tee's sleeve samples the upper-arm half (${b[0].toFixed(3)}..${b[1].toFixed(3)})`); }
}
const HAND = T.HAND;
function handGeos() {
  const out = [];
  for (const p of ["relaxed", "fist", "open", "pistol", "grip", "trig34", "hold40", "plant", "point", "card"]) {
    if (!H.POSES[p]) continue;
    for (const sd of [1, -1]) {
      out.push(["fp " + p + " " + sd, H.handGeometry(sd, p), sd]);
      out.push(["lod1 " + p + " " + sd, H.bodyHandGeometry(sd, p, 1), sd]);
      out.push(["lod2 " + p + " " + sd, H.bodyHandGeometry(sd, p, 2), sd]);
    }
  }
  return out;
}
for (const [name, g] of handGeos()) {
  const uv = g.attributes.uv, pos = g.attributes.position;
  check(!!uv && uv.count === pos.count, `${name}: uv on every vertex`);
  if (!uv) continue;
  let finite = true, inRange = true;
  for (let i = 0; i < uv.array.length; i++) { const x = uv.array[i]; if (!Number.isFinite(x)) finite = false; if (x < -0.3 || x > 1.3) inRange = false; }
  check(finite && inRange, `${name}: uv finite and on the chart`);
}
// the back of the fingers (relaxed, both sides): centre of the column, and
// u rising with x on the back of the hand for BOTH hands (letters read true)
for (const lod of ["fp", 1]) for (const sd of [1, -1]) {
  const g = lod === "fp" ? H.handGeometry(sd, "open") : H.bodyHandGeometry(sd, "open", 1);
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
  const cols = {};
  for (let i = 0; i < P.count; i++) {
    const u = U.getX(i), v = U.getY(i);
    if (u >= HAND.palmX || v < 1 - HAND.fingerH + 0.02) continue;          // the finger block only
    if (N.getY(i) < 0.45) continue;                                         // the back of a finger
    const c = Math.floor(u / HAND.col);
    (cols[c] = cols[c] || []).push([P.getX(i), u - c * HAND.col]);
  }
  const ks = Object.keys(cols).map(Number);
  check(ks.length >= 4, `${lod} side ${sd}: the backs of four fingers land in finger columns (${ks.join(",")})`);
  for (const c of ks) {
    const pts = cols[c];
    const mid = pts.reduce((a, p) => a + p[1], 0) / pts.length / HAND.col;
    check(Math.abs(mid - 0.5) < 0.2, `${lod} side ${sd} col ${c}: finger backs centred in the column (${mid.toFixed(2)})`);
    if (pts.length >= 3) {
      const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, mu = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      let cov = 0; for (const p of pts) cov += (p[0] - mx) * (p[1] - mu);
      check(cov > 0, `${lod} side ${sd} col ${c}: u grows with x across the back (text reads true)`);
    }
  }
  // the finger ORDER: seen from the back, column index follows x on the right
  // hand and runs against it on the left (index is the thumb side)
  const cx = ks.filter((c) => c < 4).map((c) => [c, cols[c].reduce((a, p) => a + p[0], 0) / cols[c].length]).sort((a, b) => a[0] - b[0]);
  const rising = cx.every((e, i) => i === 0 || e[1] > cx[i - 1][1]);
  const falling = cx.every((e, i) => i === 0 || e[1] < cx[i - 1][1]);
  check(sd > 0 ? rising : falling, `${lod} side ${sd}: index..little run ${sd > 0 ? "toward +x" : "toward -x"} (thumb side first)`);
  // palm side: blank; back of the hand: its patch
  let under = 0, underBlank = 0, back = 0, backPatch = 0;
  for (let i = 0; i < P.count; i++) {
    const u = U.getX(i), v = U.getY(i), ny = N.getY(i);
    const isBlank = Math.abs(u - 0.30) < 1e-4 && Math.abs(v - 0.05) < 1e-4;
    if (ny < -0.9) { under++; if (isBlank || (u < HAND.palmX && v >= 1 - HAND.fingerH - 1e-3 && Math.abs((u / HAND.col) % 1 - 0.5) > 0.2)) underBlank++; else if (DEBUG) console.log("   under miss", P.getX(i).toFixed(3), P.getY(i).toFixed(3), P.getZ(i).toFixed(3), u.toFixed(3), v.toFixed(3)); }
    if (ny > 0.95 && P.getZ(i) > -0.07 && P.getZ(i) < -0.02 && Math.abs(P.getX(i)) < 0.02) { back++; if (u >= HAND.palmX - 1e-6) backPatch++; else if (DEBUG) console.log("   back miss", P.getX(i).toFixed(3), P.getY(i).toFixed(3), P.getZ(i).toFixed(3), u.toFixed(3), v.toFixed(3)); }
  }
  check(under > 0 && underBlank / under > 0.97, `${lod} side ${sd}: the palm side reads blank skin (${underBlank}/${under})`);
  check(back > 0 && backPatch / back > 0.9, `${lod} side ${sd}: the back of the hand lands on its patch (${backPatch}/${back})`);
}
{
  // first-person forearm: no triangle spans the u seam
  const arm = H.makeArm({ fore: new THREE.MeshLambertMaterial({ color: 0xc08a5a }) }, 1);
  const g = arm.userData.parts.fore.geometry, U = g.attributes.uv, I = g.index.array;
  check(!!U, "FP forearm has a uv");
  let worst = 0, vOk = true;
  for (let t = 0; t < I.length; t += 3) {
    const us = [U.getX(I[t]), U.getX(I[t + 1]), U.getX(I[t + 2])];
    const vs = [U.getY(I[t]), U.getY(I[t + 1]), U.getY(I[t + 2])];
    if (vs.some((v) => v < -1e-6 || v > 1 + 1e-6)) vOk = false;
    if (Math.min(...vs) > 0.02) worst = Math.max(worst, Math.max(...us) - Math.min(...us));      // (the wrist dome's apex fan aside)
  }
  check(worst < 0.2, `FP forearm: no tube triangle smears across the u seam (widest ${worst.toFixed(3)})`);
  check(vOk, "FP forearm: v runs wrist 0 .. elbow 1");
  check(arm.userData.side === 1, "makeArm keeps its side");
}

// ------------------------------------------------------------ 2. PROFILES
{
  const fams = ["chicano", "paisa", "dots", "block", "script", "teardrop", "web", "blackwork", "vory", "sleeve", "yant", "batok", "tribal", "chest", "trad", "fine", "armband", "color", "geo"];
  for (const f of fams) {
    const a = T.build(f, T.rngOf("x" + f), { prison: true }), b = T.build(f, T.rngOf("x" + f), { prison: true });
    check(JSON.stringify(a) === JSON.stringify(b), `${f}: a seed rolls the same man twice`);
    if (a) for (const k of [...a.arm, ...a.hand, a.head]) if (k) {
      const d = T.parseKey(k);
      check(d.fam === f && (d.side === "L" || d.side === "R"), `${f}: key ${k} parses`);
    }
  }
  let homePro = 0;
  for (let i = 0; i < 400; i++) for (const f of ["sleeve", "yant", "trad", "color", "tribal", "batok"]) { const p = T.build(f, T.rngOf("h" + i + f), { prison: true }); if (p && p.home) homePro++; }
  check(homePro === 0, "machine-only styles are never homemade");
  let home = 0, n = 0;
  for (let i = 0; i < 400; i++) { const p = T.build("blackwork", T.rngOf("b" + i), { prison: true }); if (p) { n++; if (p.home) home++; } }
  check(home > n * 0.3 && home < n * 0.6, `prison blackwork is homemade about 45% of the time (${home}/${n})`);
  check(!T.hasInk("arm", "teardrop", "R", 0) && T.hasInk("head", "teardrop", "R", 0), "a teardrop is on the face, not the arm");
  check(!T.hasInk("arm", "chest", "L", 1) && !T.hasInk("head", "chest", "R", 1), "chest ink never shows");
  // the street
  const mk = (seed, P) => ({ group: { id: seed }, profile: P, skinSlots: {} });
  let men = 0, menInk = 0, women = 0, womenInk = 0, kids = 0;
  for (let i = 0; i < 2000; i++) {
    const m = mk(i, { fem: false, ageYears: 30 }); men++; if (T.profile(m)) menInk++;
    const w = mk(100000 + i, { fem: true, ageYears: 30 }); women++; if (T.profile(w)) womenInk++;
    const k = mk(200000 + i, { child: true, ageYears: 9 }); if (T.profile(k)) kids++;
  }
  check(menInk / men > 0.15 && menInk / men < 0.3, `city men inked ${(100 * menInk / men).toFixed(1)}% (15-30)`);
  check(womenInk < menInk && womenInk / women > 0.05, `city women inked less (${(100 * womenInk / women).toFixed(1)}%)`);
  check(kids === 0, "no child is ever inked");
  const pl = mk(7, { ageYears: 28 });
  CBZ.playerChar = pl;
  const pp = T.profile(pl);
  check(!!pp && (pp.arm[0] || pp.arm[1]), "the player always carries a piece on an arm");
  CBZ.playerChar = null;
}

// ------------------------------------------------------------ 3. MATERIALS
const cat = CBZ.cityOutfitCatalog();
function inmate(seed, fam, skin) {
  const look = CBZ.heritageRoll("mexican_american", seed, { ink: fam, skin: skin, tank: true });
  const ch = CBZ.makeCharacter(Object.assign({ torso: 0xf27a1f, legs: 0xf27a1f, arms: 0xf27a1f, collar: 0xffa14a, shoes: 0x25282d }, look));
  CBZ.heritageApply(ch, look);
  return ch;
}
{
  const skin = 0xc08a5a;
  const a = inmate("yard man a", "blackwork", skin), b = inmate("yard man a", "blackwork", skin);
  const pa = T.profile(a), pb = T.profile(b);
  check(!!pa && JSON.stringify(pa) === JSON.stringify(pb), "a named inmate rolls the same ink every boot");
  CBZ.cityRecolorRig(a, cat.inmate_tank.colors, cat.inmate_tank);
  CBZ.cityRecolorRig(b, cat.inmate_tank.colors, cat.inmate_tank);
  const s = a.skinSlots;
  for (let i = 0; i < 2; i++) {
    const want = pa.arm[i];
    for (const m of [s.arms[i], s.armsLower[i]]) {
      if (want) {
        check(T.isInk(m.material), `tank: ${i ? "right" : "left"} ${m === s.arms[i] ? "upper arm" : "forearm"} wears ink`);
        check(m.material._shared === true && T.skinOf(m.material) === skin && m.material.color.getHex() === skin, "ink material: shared, tinted the skin");
      } else check(!T.isInk(m.material), `tank: ${i ? "right" : "left"} arm has no piece, no ink`);
    }
    if (want) check(s.armsLower[i].material === b.skinSlots.armsLower[i].material, "two men with one tone and one piece share ONE material (one crowd pool)");
  }
  const head = s.head[0];
  if (pa.head) check(head.material.map && head.material.map.userData.cbzInk === "head|" + pa.head, "head: its own material carries its chart");
  const hands = s.hands;
  for (const h of hands) {
    const k = pa.hand[h.userData.side < 0 ? 0 : 1];
    check(k ? T.isInk(h.material) : !T.isInk(h.material), `hand ${h.userData.side}: ink ${k ? "on" : "off"}`);
  }
  // colour reads see the skin
  const ac = CBZ.cityArmColors(a);
  if (pa.arm[0]) check(ac && ac.sleeve === skin, "cityArmColors reads the skin under an inked forearm");
  // charts stay pageable (pedinstance: canvas, <= 496 wide, clamp, flipY)
  const m = s.armsLower[1].material.map || s.armsLower[0].material.map;
  if (m) check(m.image.width <= 496 && m.wrapS === THREE.ClampToEdgeWrapping && m.flipY === true && m.offset.x === 0 && m.repeat.x === 1, "arm chart is pageable");
  // re-dress into the jumpsuit: sleeves are cloth, never ink
  CBZ.cityRecolorRig(a, cat.inmate.colors, cat.inmate);
  for (let i = 0; i < 2; i++) for (const mm of [s.arms[i], s.armsLower[i]]) check(!T.isInk(mm.material), "jumpsuit: sleeves carry no ink");
  for (const h of hands) { const k = pa.hand[h.userData.side < 0 ? 0 : 1]; if (k) check(T.isInk(h.material), "jumpsuit: the hands keep their ink"); }
  // and back to the tank
  CBZ.cityRecolorRig(a, cat.inmate_tank.colors, cat.inmate_tank);
  if (pa.arm[1]) check(T.isInk(s.armsLower[1].material), "back in the tank: the ink is back");
  // a flat recolour to cloth takes it off
  CBZ.cityPaintSlot(s.armsLower, 0x2244aa);
  check(!T.isInk(s.armsLower[0].material) && !T.isInk(s.armsLower[1].material) && s.armsLower[1].material.color.getHex() === 0x2244aa, "cityPaintSlot to a sleeve colour drops the ink (no tattoo printed on a shirt)");
  // gloves: the hands stop reading as skin
  const clean = inmate("clean man", "", skin);
  CBZ.cityRecolorRig(clean, cat.inmate_tank.colors, cat.inmate_tank);
  check(!T.profile(clean) && !T.isInk(clean.skinSlots.armsLower[0].material), "a man with no ink stays clean");
  check(H.dressOf(a).skin === skin, "fphands.dressOf reads the tone under ink");
}
{
  // the street: a tee shows forearms; its sleeves are the shirt
  let tee = null;
  for (let i = 0; i < 400 && !tee; i++) {
    const ch = CBZ.makeCharacter({ skin: 0xe0b48e, torso: 0x335577, legs: 0x333333, arms: 0x335577, shortSleeve: true });
    const p = T.profile(ch);
    if (p && (p.arm[0] || p.arm[1])) tee = ch;
  }
  check(!!tee, "some street man has arm ink");
  if (tee) {
    T.refresh(tee);
    const p = T.profile(tee), s = tee.skinSlots;
    for (let i = 0; i < 2; i++) if (p.arm[i]) {
      check(T.isInk(s.armsLower[i].material), "tee: the bare forearm wears the piece");
      check(!T.isInk(s.arms[i].material), "tee: the sleeve does not");
    }
  }
}

{
  // LAZY CHARTS: a rig asking for a chart nobody has painted yet shows plain
  // skin, waits, and is inked when the queue drains
  T.lazy = true;
  const look = CBZ.heritageRoll("white", "lazy man", { ink: "vory", skin: 0xe8c39a });
  const ch = CBZ.makeCharacter(Object.assign({ torso: 0xf27a1f, legs: 0xf27a1f, arms: 0xf27a1f, collar: 0xffa14a, shoes: 0x25282d }, look));
  CBZ.heritageApply(ch, look);
  const p = T.profile(ch);
  CBZ.cityRecolorRig(ch, cat.inmate_tank.colors, cat.inmate_tank);
  const want = p && (p.arm[1] ? 1 : p.arm[0] ? 0 : -1);
  if (want >= 0) {
    const fresh = !T.chartTex || T._queued() > 0;
    check(fresh ? !T.isInk(ch.skinSlots.armsLower[want].material) : true, "lazy: a queued chart leaves plain skin meanwhile");
    T._drain(1e9);
    check(T._queued() === 0, "lazy: the queue drains");
    check(T.isInk(ch.skinSlots.armsLower[want].material), "lazy: the waiting rig is inked when its chart lands");
  }
  T.lazy = false;
  // a stand-in body (portrait / mugshot) wears its subject's ink
  const stand = CBZ.makeCharacter({ skin: 0xe8c39a, torso: 0x444444, legs: 0x333333, arms: 0x444444 });
  stand._inkFrom = ch;
  check(T.sigOf(stand) === T.sigOf(ch) && T.sigOf(ch) !== "", "a portrait rig mirrors its subject's pieces");
}

// ------------------------------------------------------------ 4. FIRST PERSON
{
  const skin = 0xd9a983;
  const me = CBZ.makeCharacter({ skin: skin, torso: 0x444444, legs: 0x333333, arms: skin, shortSleeve: true });
  CBZ.playerChar = me;
  me._inkProfile = undefined;
  const prof = T.profile(me);
  prof.hand = ["hand:block:L:0:0", "hand:block:R:0:0"];
  T.refresh(me);
  const base = new THREE.MeshLambertMaterial({ color: skin });
  base.transparent = true;
  const hand = H.makeHand(1, "relaxed", base);
  hand.onBeforeRender();
  check(hand.material !== base && hand.material.map && hand.material.map.userData.cbzInk === "fphand|hand:block:R:0:0", "FP right hand wears the player's right-hand chart");
  check(hand.material.transparent === true && hand.material.color.getHex() === skin, "the FP twin keeps the viewmodel's flags and colour");
  base.color.setHex(0x111111);                                             // gloved
  hand.onBeforeRender();
  check(hand.material === base, "a gloved FP hand gets its own material back");
  base.color.setHex(skin);
  const fore = new THREE.MeshLambertMaterial({ color: skin });
  const arm = H.makeArm({ fore: fore, upper: fore }, -1);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  H.poseArm(arm, V(-0.2, -0.2, -0.4), V(-0.25, -0.35, -0.1), V(-0.3, -0.4, 0.2), new THREE.Quaternion(), 1.9, false);
  const f = arm.userData.parts.fore;
  f.onBeforeRender();
  if (prof.arm[0]) {
    check(f.material !== fore && f.material.map && f.material.map.userData.cbzInk === "fore|" + prof.arm[0], "FP left forearm wears the player's left-arm piece at FP density");
    check(f.material.map.wrapS === THREE.RepeatWrapping && Math.abs(f.material.map.offset.x - 0.125) < 1e-9, "FP forearm chart wraps, left offset");
  }
  H.poseArm(arm, V(-0.2, -0.2, -0.4), V(-0.25, -0.35, -0.1), V(-0.3, -0.4, 0.2), new THREE.Quaternion(), 1.9, true);
  f.onBeforeRender();
  check(f.material === fore, "a sleeved FP forearm shows its sleeve");
  CBZ.playerChar = null;
}

console.log(fails ? `${fails}/${checks} checks FAILED` : `${checks}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
