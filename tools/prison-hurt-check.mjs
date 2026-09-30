#!/usr/bin/env node
/* tools/prison-hurt-check.mjs — LOW HEALTH IN THE PRISON IS ON THE BODY, NOT THE SCREEN.

   Owner, 2026-09-29: "The screen turning red when I'm low health in the jail
   game is dumb." And what replaces it: "they know by blood coming out, by
   looking down and seeing a hole, they know by limping."

   Plain node, no browser (tools/lib/verbs-vm.mjs: the real rig, the real
   verbs, the real CBZ.vitals), plus the real systems/wounds.js and the real
   systems/capture.js (the prison's one CBZ.hurtPlayer). In escape mode:

     1. NOTHING RED: a guard's rounds, a shank, a beating to 1 hp, a fall and a
        tase never add .go to #flash, never raise the vitals veil, and no
        element the DOM stubs hand out is left with a red wash showing.
     2. THE HOLE: every round or blade that opens a bleed in you stamps a
        wound decal ON YOUR RIG (children of CBZ.playerChar's parts).
     3. THE BLOOD: you are bleeding (vitals) and it drips (CBZ.goreDrip
        is called while you stand there) and pools once you lie in it.
     4. THE LIMP: a round in a leg sets your rig's legHurt on that side, the
        walk cycle shortens that leg (limpSpeedMul < 1 after animChar) and
        vitals' speedMul (what physics.js moves you by) drops; a hard fall
        does the same; a healed body clears it.
     5. THE SOURCE: gore.js silences its red lens in escape; fpsmode.js keeps
        your body under the lens in first person in the prison.

     node tools/prison-hurt-check.mjs      exit 0 = ok */
import { loadVerbsVM } from "./lib/verbs-vm.mjs";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
let fails = 0;
const ok = (c, m, d) => { if (!c) fails++; console.log((c ? "ok   " : "FAIL ") + m + (d ? "  (" + d + ")" : "")); };

const v = loadVerbsVM({ mode: "escape", vitals: true });
const { CBZ, THREE, ctx } = v;
let now = 1000;
ctx.setInterval = () => 0; ctx.clearInterval = () => {};
ctx.performance = { now: () => now };

/* ---- a DOM that remembers every red it was asked to show ---- */
const made = [];
const noop = () => {};
function mkEl(id) {
  const cls = new Set();
  const e = {
    id: id || "", style: {}, dataset: {}, children: [], _cls: cls, _goCount: 0,
    classList: {
      add(c) { cls.add(c); if (c === "go") e._goCount++; }, remove(c) { cls.delete(c); },
      toggle(c, on) { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); },
      contains(c) { return cls.has(c); },
    },
    appendChild(c) { e.children.push(c); return c; }, removeChild: noop, remove: noop,
    addEventListener: noop, removeEventListener: noop, setAttribute: noop, getAttribute: () => null,
    querySelector: () => null, querySelectorAll: () => [], getContext: () => null,
    get offsetWidth() { return 0; }, textContent: "", innerHTML: "",
  };
  made.push(e);
  return e;
}
const byId = new Map();
ctx.document.getElementById = (id) => { if (!byId.has(id)) byId.set(id, mkEl(id)); return byId.get(id); };
ctx.document.createElement = () => mkEl();
ctx.document.body = mkEl("body");
const RED = /rgba\(\s*(1[2-9]\d|2[0-5]\d)\s*,\s*([0-5]?\d)\s*,\s*([0-5]?\d)|#ff2a3a|#b[0-9a-f]0000/i;
function redShowing() {
  const out = [];
  for (const e of made) {
    const s = e.style || {};
    const paint = String(s.background || "") + " " + String(s.boxShadow || "") + " " + String(s.backgroundColor || "");
    const op = s.opacity == null || s.opacity === "" ? 1 : +s.opacity;
    const shadowAlpha = /rgba\([^)]*,\s*(0?\.\d+|1)\)/.exec(String(s.boxShadow || ""));
    if (RED.test(paint) && op > 0.01 && (!s.boxShadow || !shadowAlpha || +shadowAlpha[1] > 0.01)) out.push(e.id || "(div)");
  }
  return out;
}

/* ---- what capture.js reads at load ---- */
CBZ.el = { flash: ctx.document.getElementById("flash"), vignette: ctx.document.getElementById("vignette") };
CBZ.scene = new THREE.Scene();
CBZ.scene.add(CBZ.playerChar.group);
CBZ.clock = () => now / 1000;
CBZ.game.elapsed = 0;
CBZ.guards = []; CBZ.npcs = []; CBZ.inmates = [];
const drips = [], pools = [];
CBZ.goreDrip = (x, z, s) => drips.push(s);
CBZ.gorePool = (x, z, g) => pools.push(g);
CBZ.gore = function () {};
CBZ.gore.spray = noop;
CBZ.goreImpact = noop;
CBZ.econ = { addItem: noop, takeItem: noop, rng: Math.random };
CBZ.game.inventory = {};
CBZ.setObjective = noop; CBZ.showHint = noop; CBZ.toast = noop;

const loadErr = [];
for (const f of ["src/systems/wounds.js", "src/systems/capture.js"]) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { loadErr.push(f + ": " + (e && e.message)); }
}
ok(!loadErr.length, "wounds.js + capture.js load in escape", loadErr.join(" | ") || "loaded");
if (!CBZ.hurtPlayer || !CBZ.vitals || !CBZ.bodyWound) {
  console.log("FAIL cannot continue: hurtPlayer=" + !!CBZ.hurtPlayer + " vitals=" + !!CBZ.vitals + " bodyWound=" + !!CBZ.bodyWound);
  process.exit(1);
}
const P = CBZ.player, PC = CBZ.playerChar, VT = CBZ.vitals;
P.captureState = "normal";

// the capture.js/vitals updaters, as the loop runs them
const DT = 1 / 60;
function frames(n, speed) {
  for (let i = 0; i < n; i++) {
    now += DT * 1000; CBZ.now = now; CBZ.game.elapsed += DT;
    for (const u of v.updaters) { try { u.fn(DT); } catch (e) { /* the parts of the prison this vm does not build */ } }
    if (speed != null) { PC.group.position.copy(P.pos); CBZ.animChar(PC, speed, DT); }
  }
}
function decalsOnPlayer() {
  let n = 0;
  PC.group.traverse((o) => { if (o.isMesh && o.userData && o.userData.woundKind) n++; });
  if (n) return n;
  // wounds.js's own ledger when the meshes carry no tag
  const a = CBZ.woundDecalAudit ? CBZ.woundDecalAudit() : null;
  return a ? (a.decals || 0) : 0;
}
let decals0 = 0;
PC.group.traverse(() => { decals0++; });
function rigNodes() { let n = 0; PC.group.traverse(() => { n++; }); return n; }

/* 1 + 2 + 3: a screw's rounds, then a shank, down to the last hp */
const flash = CBZ.el.flash;
const nodes0 = rigNodes();
P.hp = 100;
for (let i = 0; i < 3; i++) { now += 400; CBZ.hurtPlayer(22, P.pos.x + 8, P.pos.z, { weapon: "gun" }); frames(10); }
const nodesShot = rigNodes();
ok(nodesShot > nodes0, "a guard's rounds leave holes ON your rig", `${nodesShot - nodes0} decal meshes under playerChar`);
ok(VT.bleeding(P), "you are bleeding", "rate " + VT.bleedRate(P).toFixed(4));
drips.length = 0;
frames(240);
ok(drips.length > 0, "the blood drips off you while you stand", `${drips.length} drips in 4 s`);
P.hp = 3;
now += 400;
CBZ.hurtPlayer(9, P.pos.x - 1, P.pos.z, { melee: true, sfx: "hit", weapon: "shank", zone: "abdomen",
  point: { x: P.pos.x - 0.15, y: P.pos.y + 1.0, z: P.pos.z }, dirX: 1, dirZ: 0 });
frames(10);
ok(rigNodes() > nodesShot, "a shank leaves a cut on your rig", `${rigNodes() - nodesShot} more meshes`);
P.hp = 2;
for (let i = 0; i < 4; i++) { now += 400; CBZ.hurtPlayer(6, P.pos.x + 1, P.pos.z, { melee: true, weapon: "fist", zone: "body", power: 0.2 }); frames(5); }
ok(P.hp <= 5, "you are at the last of your hp", "hp " + P.hp);
ok(flash._goCount === 0, "#flash never fired (no red full-screen wash)", flash._goCount + " flashes");
ok(!redShowing().length, "no element is showing a red wash at low hp", redShowing().join(",") || "none");

/* the vitals veil: bled but conscious = nothing over the view in the prison */
{
  const R = VT.peek(P);
  R.blood = 0.7; R.koT = 0; R.collapsed = false;
  VT.poses(DT);
  const veil = made.find((e) => e.id === "vitalsVeil");
  const shown = veil && veil.style.opacity != null && +veil.style.opacity > 0.01;
  ok(!shown, "bled to 70% and on your feet: no veil over the view", veil ? "opacity " + veil.style.opacity : "never built");
  R.blood = 1;
}

/* 4: the limp */
{
  VT.reset(P); PC.legHurt = null;
  now += 400;
  CBZ.hurtPlayer(20, P.pos.x + 8, P.pos.z, { weapon: "gun", zone: "legR" });
  frames(2, 2.0);
  const lh = PC.legHurt;
  ok(!!lh && lh.side === 1 && lh.sev > 0.3, "a round in the right leg: your rig favours the right leg", lh ? `side ${lh.side} sev ${lh.sev.toFixed(2)}` : "no legHurt");
  frames(30, 2.0);
  ok(PC.limpSpeedMul != null && PC.limpSpeedMul < 1, "the walk cycle limps (character.js reads it)", "limpSpeedMul " + PC.limpSpeedMul);
  ok(VT.speedMul(P) < 1, "and you are slower (vitals.speedMul, physics.js)", "speedMul " + VT.speedMul(P).toFixed(2));
  // healed = the wounds closed AND the hp back (a man at 2 hp staggers:
  // vitals.js's near-death limp)
  P.hp = 100; VT.reset(P);
  frames(2, 2.0);
  ok(!PC.legHurt, "healed: the limp clears", String(PC.legHurt && PC.legHurt.sev));
  now += 2000;
  const sev = CBZ.prisonFallLand ? CBZ.prisonFallLand(9, {}) : null;
  frames(2, 2.0);
  ok(sev === "broken" && !!PC.legHurt && PC.legHurt.sev > 0.9, "a 9 m fall: broken legs, a hard limp", `${sev} ${PC.legHurt ? PC.legHurt.sev.toFixed(2) : "none"}`);
  ok(VT.speedMul(P) < 0.6, "and a crawl-paced hobble", "speedMul " + VT.speedMul(P).toFixed(2));
  ok(flash._goCount === 0, "the fall painted nothing red", flash._goCount + " flashes");
}

/* 5: the sources */
{
  const gore = read("src/systems/gore.js");
  ok(!/flashV|flashEl/.test(gore), "gore.js: there is no red lens at all (any mode)");
  const cap = read("src/systems/capture.js");
  ok(!/\bflash\(\)/.test(cap) && !/el\.flash/.test(cap), "capture.js: no #flash anywhere");
  const fps = read("src/systems/fpsmode.js");
  ok(/CBZ\.onAlways\(52\.5[\s\S]{0,400}fpBodyWanted\(\)/.test(fps) && /g\.mode !== "escape"/.test(fps),
    "fpsmode.js: first person in the prison keeps your body under the lens");
}

console.log(fails ? `\n${fails} FAIL` : "\nall ok");
process.exit(fails ? 1 : 0);
