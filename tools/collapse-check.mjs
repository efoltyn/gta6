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

   Run: node tools/collapse-check.mjs   (npm run test:collapse) */
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
const shotRaw = async (f) => {
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

/* ---- 4. A REAL BUILDING, BLOWN UP FOR REAL ------------------------------ */
// pick a genuinely collapsible lot near the player, stand well clear, and
// condemn it through the ledger's own public seam (never a private helper)
const setup = await evl(`(() => {
  const A = CBZ.city && (CBZ.city.arena || CBZ.city);
  const lots = (A && A.lots) || [];
  const P = CBZ.player;
  let best = null, bd = 1e9;
  for (const L of lots) {
    const b = L.building; if (!b || L.demolished) continue;
    if (!(b.storeys >= 3)) continue;
    const d = Math.hypot(b.ox - P.pos.x, b.oz - P.pos.z);
    if (d < bd) { bd = d; best = L; }
  }
  if (!best) return { found: false };
  const b = best.building;
  /* Park the player clear of the footprint AND POINT THE CAMERA AT IT. The
     first version of this moved the player and left the camera on its own
     yaw, so every screenshot in this gate photographed the countryside with
     the subject clipped off the right-hand edge. CBZ.cam.yaw is the live
     third-person orbit and the loop reads it every frame, so writing it here
     aims the shot for the rest of the run. */
  /* STAND WELL CLEAR. finishCollapse()'s debris field reaches
     max(w,d)*0.6 + h*0.35 and kills the player inside it — and a dead player
     takes CBZ.game.state out of "playing", which stops the ENTIRE updater
     chain, which stops the collapse this gate is trying to photograph. The
     first version of this parked the camera at ~59 m from a 166 m tower whose
     reach is 75 m, so the run wedged watching a frozen job and blamed the
     engine. Stand outside the reach, and heal on every poll besides. */
  const back = Math.max(120, (b.h || 40) * 1.1);
  P.pos.x = b.ox + back * 0.72; P.pos.z = b.oz + back * 0.72;
  if (CBZ.cam) {
    // systems/camera.js: the chase FORWARD is (-sin yaw, -cos yaw) — so
    // pointing at a target is atan2 of the NEGATED delta, and getting that
    // sign wrong aims the shot at whatever is directly behind the subject,
    // which is how this gate spent a run photographing the countryside.
    // Pitch is sin()-scaled camera HEIGHT, default 0.46 (looking down); a
    // small positive value stands the lens near eye level to see up a tower.
    CBZ.cam.yaw = Math.atan2(-(b.ox - P.pos.x), -(b.oz - P.pos.z));
    CBZ.cam.pitch = 0.08;
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

/* …AND WHAT THE CITY LOOKS LIKE. A count of resolved grammars proves the
   picker runs; it does not prove the skyline stopped being a row of painted
   boxes. Framed on the SUBJECT BUILDING's own origin, from far enough back to
   see its block — an averaged "city centroid" put the camera 3 km out in the
   desert, because a lot's cx/cz are not the coordinates a building stands on.
   Never average a coordinate you have not checked is the one you mean. */
if (setup && setup.found) {
  await evl(`(() => {
    const b = window.__collapseTarget.building, P = CBZ.player;
    P.pos.x = b.ox + 120; P.pos.z = b.oz + 120; P.hp = 100;
    if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(-(b.ox - P.pos.x), -(b.oz - P.pos.z)); CBZ.cam.pitch = 0.18; }
    return true;
  })()`);
  await sleep(1600);
  await shotRaw("collapse-0-skyline.png");
}

if (setup && setup.found) {
  /* WOUND IT FIRST, in stages, so the damage skin has to appear and escalate.
     The AMOUNT is a fraction of the building's own capacity, not a constant:
     capacityOf() is 12 + storeys*7 + plan/26, so a fixed "six damage" is four
     rockets to a corner shop and a rounding error to the 52-storey flagship —
     which is exactly how this probe first reported "damage raises no stage"
     against a perfectly working ledger. Ask the ledger what the building can
     take and hit it for a real share of that. */
  const stages = [];
  for (let k = 0; k < 4; k++) {
    await evl(`(() => {
      const st = CBZ.structure.state(window.__collapseTarget);
      const amt = Math.max(4, st.cap * 0.11);
      CBZ.structure.hit(${setup.ox}, 4.5, ${setup.oz}, amt, { kind: "rpg", lot: window.__collapseTarget, dirx: 1, dirz: 0, sudden: true });
      return amt;
    })()`);
    await sleep(500);
    stages.push(await evl(`(() => { const s = CBZ.structure.state(window.__collapseTarget); return { stage: s.stage, skins: CBZ.collapse.skinCount() }; })()`));
  }
  console.log("   staged damage:", JSON.stringify(stages));
  ok("damage raises the ledger stage", stages.some((s) => s && s.stage >= 1), stages);
  ok("damage ESCALATES through the stages (not one flat state)",
    stages.length && stages[stages.length - 1].stage > stages[0].stage, stages);
  ok("the damage skin appears while the building is still standing",
    stages.some((s) => s && s.skins > 0), stages);
  /* THE DRESSING HAS TO BE REAL GEOMETRY. Counting `skins` only proves the
     ledger THINKS it dressed the building. Find the group the engine tagged
     and count what is actually in it — the first version of this looked for
     "a group near the building" and found the BUILDING (3,723 children), which
     is a check that cannot fail and therefore proves nothing. */
  const skinShape = await evl(`(() => {
    const A = CBZ.city && (CBZ.city.arena || CBZ.city);
    const root = (A && A.root) || CBZ.scene;
    let found = null;
    root.traverse(function (o) {
      if (found || !o.userData || !o.userData.cbzCollapseSkin) return;
      let meshes = 0;
      o.traverse(function (n) { if (n.isMesh) meshes++; });
      found = { pieces: meshes, key: o.userData.cbzCollapseSkin };
    });
    return found || { pieces: 0 };
  })()`);
  ok("the wound dressing is real geometry on the facade",
    skinShape && skinShape.pieces > 3, skinShape);
  ok("the skin is rebuilt, not accumulated (one per building)",
    stages.every((s) => !s || s.skins <= 1), stages);
  await shot("collapse-1-wounded.png");

  // NOW BRING IT DOWN
  /* NOT `byPlayer` — deliberately. Crediting the player for the demolition
     posts it to the city event bus as a crime, and a five-star response
     shooting the probe dead halts the updater chain (a dead player takes
     CBZ.game.state out of "playing") in the middle of the collapse this gate
     exists to measure. The engine cannot tell the difference; the police can. */
  const forced = await evl(`CBZ.structure.forceCollapse(window.__collapseTarget, {})`);
  ok("the ledger accepts the condemnation", forced === true, { forced });
  await sleep(400);
  const preSwap = await evl(`({ active: CBZ.collapse.active(), frags: CBZ.collapse.fragCount(), collapsing: CBZ.structure.debug().collapsing })`);
  ok("a collapse job is live", preSwap && preSwap.active >= 1, preSwap);
  ok("it holds a concurrency slot", preSwap && preSwap.collapsing >= 1, preSwap);

  /* WAIT ON THE FALL, NOT ON A CLOCK. A 52-storey tower's collapse front
     takes about eight seconds to reach the ground and a corner shop's takes
     under two, so a fixed "1.4 s later" photographs a different moment of a
     different building every time this runs — and reports "no debris" on the
     tall one purely because it arrived early. The engine publishes how far
     through its fall each live job is; wait for that. */
  let midJob = null;
  for (let i = 0; i < 90; i++) {
    midJob = await evl(`(() => {
      if (CBZ.player) CBZ.player.hp = 100;
      if (CBZ.game && CBZ.game.state !== 'playing') CBZ.game.state = 'playing';
      const d = CBZ.collapse.debug();
      return d.jobs[0] ? Object.assign({ frags: d.frags }, d.jobs[0]) : null;
    })()`);
    if (midJob && (midJob.phase > 1 || (midJob.phase === 1 && midJob.frac >= 0.45))) break;
    if (!midJob) break;
    await sleep(200);
  }
  console.log("   at mid-fall:", JSON.stringify(midJob));
  await shot("collapse-2-midfall.png");
  const dbg = await evl("CBZ.collapse.debug()");
  console.log("   engine:", JSON.stringify(dbg && dbg.jobs));
  ok("the job reports a grammar and a shell", dbg && dbg.jobs.length > 0 && !!dbg.jobs[0].mode && dbg.jobs[0].bands > 0, dbg && dbg.jobs[0]);
  ok("the shell is losing bands as the front eats it",
    dbg && dbg.jobs.length > 0 && dbg.jobs[0].standing < dbg.jobs[0].bands, dbg && dbg.jobs[0]);
  const mid = await evl(`({ active: CBZ.collapse.active(), frags: CBZ.collapse.fragCount() })`);
  console.log("   mid-fall:", JSON.stringify(mid));
  ok("the building disintegrates into real debris mid-fall", mid && mid.frags > 0, mid);

  await sleep(2600);
  await shot("collapse-3-landing.png");

  // let the whole arc finish and check nothing leaked
  let done = null;
  for (let i = 0; i < 40; i++) {
    done = await evl(`(() => { if (CBZ.player) CBZ.player.hp = 100;
      if (CBZ.game && CBZ.game.state !== 'playing') CBZ.game.state = 'playing';
      return ({ active: CBZ.collapse.active(), collapsing: CBZ.structure.debug().collapsing,
                         stage: CBZ.structure.state(window.__collapseTarget).stage,
                         demolished: !!window.__collapseTarget.demolished,
                         frags: CBZ.collapse.fragCount() }); })()`);
    if (done && done.active === 0) break;
    await sleep(500);
  }
  console.log("   after:", JSON.stringify(done));
  ok("the job retires", done && done.active === 0, done);
  ok("the concurrency slot is handed back", done && done.collapsing === 0, done);
  ok("the ledger reaches RUBBLE", done && done.stage === 6, done);
  ok("the lot is handed to demolition.js", done && done.demolished === true, done);
  ok("the rubble field is on the ground", done && done.frags > 0, done);
  await shot("collapse-4-rubble.png");

  // reset clears everything
  const after = await evl(`(() => { CBZ.collapse.reset(); return { active: CBZ.collapse.active(), frags: CBZ.collapse.fragCount(), skins: CBZ.collapse.skinCount() }; })()`);
  ok("reset() frees every shell, fragment and skin",
    after && after.active === 0 && after.frags === 0 && after.skins === 0, after);
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

  // SHAKE IT APART. force("quake") drives the real director; then damage the
  // fragile roster through the island's own ledger by running the quake for
  // long enough that its mainshock condemns something. A quake that has not
  // felled anything yet is not a failure of this change, so give it a real
  // window and only judge what DID come down.
  await evl(`(() => { if (CBZ.disasters && CBZ.disasters.force) CBZ.disasters.force("quake"); return true; })()`);
  let fell = null;
  for (let i = 0; i < 80; i++) {
    await sleep(900);
    fell = await evl(`(() => {
      const a = CBZ.disasterAudit();
      return { legacy: a.legacyFalls, engine: a.engineFalls, frags: CBZ.collapse.fragCount(),
               live: CBZ.collapse.active(), skins: CBZ.collapse.skinCount(),
               fallen: CBZ.surv.arena.fragile.filter(function (b) { return b.fallen; }).length,
               state: CBZ.disasters.state(), cur: CBZ.disasters.current() };
    })()`);
    if (fell && fell.engine > 0 && fell.frags > 0) break;
  }
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
