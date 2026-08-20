#!/usr/bin/env node
/* tools/collapse-check.mjs — the gate for city/collapse.js.

   The collapse is a four-second animation, which makes it exactly the kind of
   feature that "looks fine" in a screenshot and is broken in every way that
   matters: a shell that never disposes, a job that holds a concurrency slot
   forever, a grammar that picks the same motion for a timber shack and a
   52-storey tower, a fragment pool that grows without bound.

   So this asserts the MECHANISM, not the picture:

     1. every registered facade grammar declares what it is made of
        (CBZ.collapse.audit().hardcoded === 0 — the ratchet)
     2. the grammar picker actually discriminates: a slender masonry stack
        topples, a ductile frame pancakes, a timber bungalow folds
     3. gang city is wearing facades
     4. a real city building, blown up for real, goes through the whole arc:
        shell raised → fragments in the air → shell disposed → lot handed to
        demolition.js → the concurrency slot handed back
     5. nothing leaks: shells, jobs, fragments and skins all return to zero
     6. the damage skin appears at the stages it is supposed to and is
        rebuilt, not accumulated
     7. screenshots of a collapse mid-fall for the eye to check

   Run: node tools/collapse-check.mjs   (npm run test:collapse)

   RUNTIME. Under software WebGL (SwiftShader, which is what a CI box and this
   container have) a single Page.captureScreenshot of a 1280x800 city frame
   costs minutes, not milliseconds — the screenshots dominate the whole run.
   They are the evidence a person actually looks at, so they stay on by
   default; set CBZ_COLLAPSE_NO_SHOTS=1 to skip every capture and get just the
   assertions, which is what you want when you are iterating on the engine
   rather than judging the picture. */
import { spawn } from "node:child_process";
import { rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUTDIR = path.join(ROOT, "tools", "shots");
await mkdir(OUTDIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8960 + Math.floor(Math.random() * 9);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9960 + Math.floor(Math.random() * 9);
const profile = `/tmp/cbz-collapse-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1280,800",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  base + (process.env.CBZ_COLLAPSE_CFG ? "?" + process.env.CBZ_COLLAPSE_CFG : ""),
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = ps.find((p) => p.type === "page" && p.url.startsWith(base));
  } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    errors.push(((m.params.exceptionDetails.exception || {}).description
      || m.params.exceptionDetails.text || "").split("\n")[0]);
  }
});
const send = (method, params = {}) => new Promise((r) => {
  const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
});
const evl = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    return { __err: (r.result.exceptionDetails.exception || {}).description || r.result.exceptionDetails.text };
  }
  return r.result && r.result.result && r.result.result.value;
};
const NO_SHOTS = process.env.CBZ_COLLAPSE_NO_SHOTS === "1";
const shotRaw = async (f) => {
  if (NO_SHOTS) { console.log("   shot skipped (CBZ_COLLAPSE_NO_SHOTS):", f); return; }
  const s = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(OUTDIR, f), Buffer.from(s.result.data, "base64"));
  console.log("   shot:", "tools/shots/" + f);
};
const shot = async (f) => {
  // re-seat + re-aim: the world is live under these shots (fire, panic, the
  // collapse's own kill radius), so a camera set once drifts by the fourth one
  await evl(`(() => {
    const L = window.__collapseTarget; if (!L || !L.building || !CBZ.player) return false;
    const b = L.building, P = CBZ.player;
    const back = Math.max(120, (b.h || 40) * 1.1);
    P.pos.x = b.ox + back * 0.72; P.pos.z = b.oz + back * 0.72; P.hp = 100;
    // a dead player halts every updater, so the storyboard would freeze
    if (CBZ.game && CBZ.game.state !== 'playing') CBZ.game.state = 'playing';
    if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(-(b.ox - P.pos.x), -(b.oz - P.pos.z)); CBZ.cam.pitch = 0.08; }
    return true;
  })()`).catch(() => {});
  await sleep(250);
  if (NO_SHOTS) { console.log("   shot skipped (CBZ_COLLAPSE_NO_SHOTS):", f); return; }
  const s = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(OUTDIR, f), Buffer.from(s.result.data, "base64"));
  console.log("   shot:", "tools/shots/" + f);
};
await send("Runtime.enable"); await send("Page.enable");

const failures = [];
const ok = (name, cond, detail) => {
  console.log(`${cond ? " OK " : "FAIL"}  ${name}${detail != null ? "  " + JSON.stringify(detail) : ""}`);
  if (!cond) failures.push(name + (detail != null ? " " + JSON.stringify(detail) : ""));
};

for (let i = 0; i < 60; i++) {
  if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break;
  await sleep(500);
}
let playing = false;
for (let i = 0; i < 120 && !playing; i++) {
  await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()");
  await sleep(600);
  playing = await evl("!!(CBZ.game && CBZ.game.state === 'playing')");
}
ok("city boots and plays", playing);
await sleep(3500);

/* ---- 1. THE RATCHET ---------------------------------------------------- */
const audit = await evl("CBZ.collapse ? CBZ.collapse.audit() : null");
ok("collapse engine loaded", !!audit);
ok("every facade grammar declares its material (ratchet)",
  audit && audit.hardcoded === 0, audit && { facades: audit.facades, undeclared: audit.missing });
ok("five grammars registered", audit && audit.modes.length >= 5, audit && audit.modes);

/* ---- 2. THE PICKER DISCRIMINATES --------------------------------------- */
const picks = await evl(`(() => {
  const P = (o) => CBZ.collapse.predict(o, { nx: 1, nz: 0, floor: 0 });
  return {
    steelTower:   P({ w: 26, d: 26, h: 170, storeys: 52, style: "megabrace" }),
    masonryStack: P({ w: 9,  d: 9,  h: 40,  storeys: 12, style: "gothic" }),
    timberHouse:  P({ w: 12, d: 10, h: 6.4, storeys: 2,  style: "ranch" }),
    adobeShop:    P({ w: 14, d: 12, h: 7,   storeys: 2,  style: "adobe" }),
    glassBlock:   P({ w: 30, d: 24, h: 60,  storeys: 18, style: "intl" }),
  };
})()`);
console.log("   grammar picks:", JSON.stringify(picks, null, 0));
ok("a slender masonry stack topples", picks && picks.masonryStack.mode === "topple", picks && picks.masonryStack);
ok("a timber house folds", picks && picks.timberHouse.mode === "fold", picks && picks.timberHouse);
ok("a steel tower pancakes", picks && picks.steelTower.mode === "pancake", picks && picks.steelTower);
ok("a curtain-wall block pancakes", picks && picks.glassBlock.mode === "pancake", picks && picks.glassBlock);
ok("adobe does not pancake", picks && picks.adobeShop.mode !== "pancake", picks && picks.adobeShop);
ok("the five picks are not all the same motion",
  picks && new Set(Object.values(picks).map((p) => p.mode)).size >= 3,
  picks && Object.values(picks).map((p) => p.mode));

/* ---- 3. GANG CITY IS WEARING FACADES ----------------------------------- */
const dressed = await evl(`(() => {
  const on = !!(CBZ.CONFIG && CBZ.CONFIG.FACADE_KIT_CITY);
  const A = CBZ.city && (CBZ.city.arena || CBZ.city);
  const lots = (A && A.lots) || [];
  let n = 0, styles = {};
  for (const L of lots) {
    const b = L.building; if (!b) continue;
    const s = CBZ.facadePick ? CBZ.facadePick(b.ox, b.oz, b.storeys, b.dress || null) : null;
    if (s) { n++; styles[s] = (styles[s] || 0) + 1; }
  }
  return { on, lots: lots.length, dressed: n, distinct: Object.keys(styles).length };
})()`);
console.log("   facades:", JSON.stringify(dressed));
ok("FACADE_KIT_CITY is on in gang city", dressed && dressed.on === true);
ok("city lots resolve a facade grammar", dressed && dressed.dressed > 0, dressed);
ok("the skyline wears more than one grammar", dressed && dressed.distinct >= 4, dressed);

/* ---- 4. A REAL BUILDING, BLOWN UP FOR REAL ------------------------------

   DRIVEN ON A FROZEN CLOCK, IN ONE EVALUATE. The first version of this ran
   the arc as forty CDP round trips against a live renderer, and against a
   software rasterizer at ~1 fps every `Runtime.evaluate` queues behind a
   multi-second frame — a four-second collapse took the better part of half an
   hour to poll, and a run that was working looked identical to one that had
   wedged. It is also not a measurement: what it samples depends on how fast
   the machine happens to be.

   So: stub requestAnimationFrame (the loop re-schedules itself every frame,
   so this freezes it), make CBZ.stepSim the only clock, and run the whole
   storyboard — four rockets, the condemnation, the fall, the settle — inside
   ONE evaluate that returns the readings from every beat. Same technique the
   visual presets use, for the same reason, and now both sides of the tool
   agree about what "mid-fall" means.
------------------------------------------------------------------------- */
/* Pick the subject FROM THE LIVE WORLD, never from a typed coordinate: the
   nearest genuinely collapsible building of a few storeys, which is what a
   player would actually aim a rocket at. Park the player clear of it and aim
   the camera, so the screenshots below photograph the subject rather than the
   countryside behind it. */
const setup = await evl(`(() => {
  const A = CBZ.city && (CBZ.city.arena || CBZ.city);
  const lots = (A && A.lots) || [];
  const P = CBZ.player;
  /* A MID-RISE, not the flagship. "Nearest building of three storeys or more"
     picks the 52-storey tower, whose collapse front takes eight simulated
     seconds — about eleven hundred stepSim calls over a 329-lot city, which
     is minutes of CPU for a run measuring the same code path a six-storey
     block exercises in a quarter of the time. Prefer 3..8 storeys, and fall
     back to anything collapsible if this block has none. */
  let best = null, bd = 1e9, any = null, ad = 1e9;
  for (const L of lots) {
    const b = L.building; if (!b || L.demolished) continue;
    if (!(b.storeys >= 3)) continue;
    const d = Math.hypot(b.ox - P.pos.x, b.oz - P.pos.z);
    if (d < ad) { ad = d; any = L; }
    if (b.storeys > 8) continue;
    if (d < bd) { bd = d; best = L; }
  }
  if (!best) best = any;
  if (!best) return { found: false };
  const b = best.building;
  /* STAND WELL CLEAR. finishCollapse()'s debris field reaches
     max(w,d)*0.6 + h*0.35 and kills the player inside it — and a dead player
     takes CBZ.game.state out of "playing", which stops the ENTIRE updater
     chain, which stops the collapse this gate is trying to photograph. */
  const back = Math.max(120, (b.h || 40) * 1.1);
  P.pos.x = b.ox + back * 0.72; P.pos.z = b.oz + back * 0.72; P.hp = 100;
  /* systems/camera.js: the chase FORWARD is (-sin yaw, -cos yaw), so aiming
     at a target is atan2 of the NEGATED delta — the un-negated form points at
     whatever is directly behind the subject. Pitch is sin()-scaled camera
     HEIGHT (default 0.46, looking down); a small value stands the lens near
     eye level to see up a tower. */
  if (CBZ.cam) {
    CBZ.cam.yaw = Math.atan2(-(b.ox - P.pos.x), -(b.oz - P.pos.z));
    CBZ.cam.pitch = 0.12;
  }
  window.__collapseTarget = best;
  return { found: true, ox: b.ox, oz: b.oz, storeys: b.storeys, w: b.w, d: b.d,
           predict: CBZ.collapse.predict({ w: b.w, d: b.d, h: b.h, storeys: b.storeys,
             FH: b.FH, wall: b.wallColor, masonry: b.masonry,
             style: CBZ.facadePick ? CBZ.facadePick(b.ox, b.oz, b.storeys, b.dress || null) : null },
             { nx: 1, nz: 0, floor: 1 }) };
})()`);
console.log("   target:", JSON.stringify(setup));
ok("found a collapsible city building", setup && setup.found);
await sleep(1500);
await shotRaw("collapse-0-skyline.png");

const arc = await evl(`(() => {
  const L = window.__collapseTarget;
  if (!L) return { err: "no target" };
  const b = L.building;
  const step = (n) => { for (let i = 0; i < n; i++) {
    CBZ.hitstop = 0; CBZ.slowmo = 0;
    CBZ.stepSim(1 / 60);
    if (CBZ.player) CBZ.player.hp = 100;
    // a dead player takes game.state out of "playing" and STOPS every
    // updater — including the collapse this is measuring
    if (CBZ.game && CBZ.game.state !== "playing") CBZ.game.state = "playing";
  } };
  window.requestAnimationFrame = function () { return 0; };
  const out = { stages: [], skinPieces: 0 };

  const skinOf = () => {
    const A = CBZ.city && (CBZ.city.arena || CBZ.city);
    const root = (A && A.root) || CBZ.scene;
    let found = 0;
    root.traverse(function (o) {
      if (found || !o.userData || !o.userData.cbzCollapseSkin) return;
      let m = 0; o.traverse(function (n) { if (n.isMesh) m++; }); found = m;
    });
    return found;
  };

  /* A ROCKET IS A SHARE OF THE BUILDING, NOT A CONSTANT. capacityOf() is
     12 + storeys*7 + plan/26, so a fixed "six damage" is four rockets to a
     corner shop and a rounding error to the 52-storey flagship — which is
     how this probe first reported "damage raises no stage" against a
     perfectly working ledger. */
  for (let k = 0; k < 4; k++) {
    const st0 = CBZ.structure.state(L);
    CBZ.structure.hit(b.ox, 4.5, b.oz, Math.max(4, st0.cap * 0.11),
      { kind: "rpg", lot: L, dirx: 1, dirz: 0, sudden: true });
    step(20);
    const st = CBZ.structure.state(L);
    out.stages.push({ stage: st.stage, skins: CBZ.collapse.skinCount() });
  }
  out.skinPieces = skinOf();

  /* NOT byPlayer — deliberately. Crediting the player posts the demolition to
     the city event bus as a crime, and a five-star response shooting the
     probe dead halts the updater chain mid-collapse. */
  out.forced = CBZ.structure.forceCollapse(L, {});
  step(6);
  out.atCondemn = { active: CBZ.collapse.active(), collapsing: CBZ.structure.debug().collapsing };

  // run to mid-fall on the ENGINE'S OWN reported progress, never on a count
  // of seconds: a 52-storey front takes ~8 s and a corner shop under 2
  let guard = 0;
  while (guard++ < 3000) {
    const j = CBZ.collapse.debug().jobs[0];
    if (!j) break;
    if (j.phase > 1 || (j.phase === 1 && j.frac >= 0.45)) break;
    step(1);
  }
  const d = CBZ.collapse.debug();
  out.mid = d.jobs[0] ? Object.assign({ frags: d.frags }, d.jobs[0]) : { frags: d.frags };

  // …and on to the end of the whole arc
  guard = 0;
  while (guard++ < 4000 && CBZ.collapse.active()) step(1);
  step(60);
  out.after = {
    active: CBZ.collapse.active(),
    collapsing: CBZ.structure.debug().collapsing,
    stage: CBZ.structure.state(L).stage,
    demolished: !!L.demolished,
    frags: CBZ.collapse.fragCount(),
    settled: CBZ.collapse.debug().settled,
  };
  return out;
})()`);
console.log("   arc:", JSON.stringify(arc));

if (arc && arc.stages) {
  ok("damage raises the ledger stage", arc.stages.some((s) => s.stage >= 1), arc.stages);
  ok("damage ESCALATES through the stages (not one flat state)",
    arc.stages[arc.stages.length - 1].stage > arc.stages[0].stage, arc.stages);
  ok("the damage skin appears while the building is still standing",
    arc.stages.some((s) => s.skins > 0), arc.stages);
  ok("the skin is one group per building, rebuilt not accumulated",
    arc.stages.every((s) => s.skins <= 1), arc.stages);
  ok("the wound dressing is real geometry on the facade", arc.skinPieces > 3, { pieces: arc.skinPieces });
  await shot("collapse-1-wounded.png");

  ok("the ledger accepts the condemnation", arc.forced === true, { forced: arc.forced });
  ok("a collapse job is live and holds a concurrency slot",
    arc.atCondemn && arc.atCondemn.active >= 1 && arc.atCondemn.collapsing >= 1, arc.atCondemn);

  ok("the job reports a grammar and a raised shell",
    arc.mid && !!arc.mid.mode && arc.mid.bands > 0, arc.mid);
  ok("the shell is losing bands as the front eats it",
    arc.mid && arc.mid.standing < arc.mid.bands, arc.mid);
  ok("the building disintegrates into real debris mid-fall", arc.mid && arc.mid.frags > 0, arc.mid);
  await shot("collapse-2-midfall.png");

  ok("the job retires", arc.after && arc.after.active === 0, arc.after);
  ok("the concurrency slot is handed back", arc.after && arc.after.collapsing === 0, arc.after);
  ok("the ledger reaches RUBBLE", arc.after && arc.after.stage === 6, arc.after);
  ok("the lot is handed to demolition.js", arc.after && arc.after.demolished === true, arc.after);
  ok("the debris came to rest on the ground", arc.after && arc.after.settled > 0, arc.after);
  await shot("collapse-3-rubble.png");

  const cleared = await evl(`(() => { CBZ.collapse.reset(); return { active: CBZ.collapse.active(), frags: CBZ.collapse.fragCount(), skins: CBZ.collapse.skinCount() }; })()`);
  ok("reset() frees every shell, fragment and skin",
    cleared && cleared.active === 0 && cleared.frags === 0 && cleared.skins === 0, cleared);
} else {
  ok("the collapse arc ran", false, arc);
}

/* ---- 5. THE DISASTER ISLAND RUNS THE SAME ENGINE -----------------------
   Half the brief is "earthquake in nat disaster", and the island had its own
   collapse — sink the group into the ground, tilt it, hide it — which is the
   second system this whole change exists to delete. Proving the city works
   proves nothing about the island, so this reboots into survival, shakes the
   place apart, and asserts that every building that came down came down
   through the shared engine.
------------------------------------------------------------------------- */
console.log("\n-- disaster island --");
await send("Page.navigate", { url: base });
await sleep(2500);
for (let i = 0; i < 90; i++) {
  if (await evl("!!(window.CBZ && CBZ.game && document.querySelector('[data-mode=\"survival\"]'))")) break;
  await sleep(500);
}
let islandPlaying = false;
for (let i = 0; i < 90 && !islandPlaying; i++) {
  await evl(`(() => {
    const m = document.querySelector('[data-mode="survival"]'); if (m) m.click();
    const b = document.getElementById('playBtn'); if (b) b.click();
    return true;
  })()`);
  await sleep(700);
  islandPlaying = await evl("!!(CBZ.game && CBZ.game.state === 'playing' && CBZ.game.mode === 'survival' && CBZ.surv && CBZ.surv.arena)");
}
ok("the disaster island boots", islandPlaying);

if (islandPlaying) {
  await sleep(2000);
  const before = await evl("CBZ.disasterAudit ? { legacy: CBZ.disasterAudit().legacyFalls, engine: CBZ.disasterAudit().engineFalls, shared: CBZ.disasterAudit().collapseShared, fragile: CBZ.surv.arena.fragile.length } : null");
  console.log("   island before:", JSON.stringify(before));
  ok("the island is wired to the shared collapse engine", before && before.shared === true, before);
  ok("the island has buildings to fell", before && before.fragile > 0, before);

  /* SHAKE IT APART, on a frozen clock, in one evaluate — same reason as the
     city arc above. force("quake") drives the REAL director (warn phase,
     mainshock, aftershocks); stepSim is then the only time, so the quake runs
     at the machine's CPU speed instead of its frame rate and the whole event
     takes seconds rather than the two real minutes it occupies in play. */
  const fell = await evl(`(() => {
    const step = (n) => { for (let i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      CBZ.stepSim(1 / 60);
      if (CBZ.player) CBZ.player.hp = 100;
      if (CBZ.game && CBZ.game.state !== "playing") CBZ.game.state = "playing";
    } };
    window.requestAnimationFrame = function () { return 0; };
    if (!CBZ.disasters || !CBZ.disasters.force) return { err: "no CBZ.disasters.force" };
    CBZ.disasters.force("quake");
    const read = () => {
      const a = CBZ.disasterAudit();
      return { legacy: a.legacyFalls, engine: a.engineFalls, shared: a.collapseShared,
               frags: CBZ.collapse.fragCount(), live: CBZ.collapse.active(),
               fallen: CBZ.surv.arena.fragile.filter(function (b) { return b.fallen; }).length,
               state: CBZ.disasters.state(), cur: CBZ.disasters.current() };
    };
    // run the warn phase and the mainshock out; a quake that has not felled
    // anything YET is not a failure of this change, so give it a real window
    // and only judge what did come down
    let g = 0;
    while (g++ < 9000) { step(4); const r = read(); if (r.engine > 0 && r.frags > 0) break; }
    step(120);                                        // let the fall play out
    return read();
  })()`);
  console.log("   island after:", JSON.stringify(fell));
  await shotRaw("collapse-5-island-quake.png");
  ok("the earthquake fells island buildings", fell && fell.fallen > 0, fell);
  ok("they come down through the SHARED engine", fell && fell.engine > 0, fell);
  ok("none fell back to the island's old sink-into-the-ground ticker (ratchet 0)",
    fell && fell.legacy === 0, fell);
  ok("island collapses make real debris", fell && fell.frags > 0, fell);
}

/* ---- 6. NO CONSOLE EXCEPTIONS ----------------------------------------- */
// ProgressEvent is a failed SUBRESOURCE fetch in headless (an audio file, a
// texture the sandbox declines), not a JS fault — the pre-existing checks in
// this directory ignore it for the same reason.
const real = errors.filter((e) => !/favicon|net::ERR|ProgressEvent/i.test(e));
ok("no uncaught exceptions", real.length === 0, real.slice(0, 5));

ws.close(); chrome.kill(); server.kill();
await sleep(400);
try { await rm(profile, { recursive: true, force: true }); } catch (e) { /* chrome still unlinking */ }
if (failures.length) { console.error("\nFAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
console.log("\nall collapse checks passed");
process.exit(0);
