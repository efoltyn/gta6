#!/usr/bin/env node
/* tools/prison-witness-check.mjs — THE RADIO WINDOW gate (2026-08-18).

   OWNER: heat may only come from the people (and lenses) who actually get
   the word out. Asserted as numbers against a live escape run:

     1. STANDING IN THE ARMORY IS NOT A READING. Unseen, in-zone, the wanted
        panel stays quiet and detection stays on the floor.
     2. A SIGHTING IS A MAN, NOT A NUMBER. A guard who sees you in the zone
        opens his radio window (radioT) and comes for you — and the global
        meter has still not moved.
     3. SILENCERS WORK. Knock him out before the call lands: the window dies,
        no heat. Hands up at gunpoint (intimidMode "scared"): the window
        HOLDS and his eyes (guardSees) answer false.
     4. THE CALL LANDS. Left alone, the window runs out: heat arrives, the
        panel comes up, and while you are still in the zone it names the
        trespass — the label earned its screen time.
     5. ROPE IS A VERB. prisonRestrainTarget on a held-up guard spends the
        Bedsheet Rope, ties him, blinds him, and kills his pending call.

   Boot boilerplate from tools/prison-polish-check.mjs (itself math-gate's).
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8970 + Math.floor(Math.random() * 25);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9970 + Math.floor(Math.random() * 25);
const profile = `/tmp/cbz-witness-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1440,900",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

function done(code) { try { chrome.kill("SIGTERM"); } catch (_) {} try { server.kill("SIGTERM"); } catch (_) {} rm(profile, { recursive: true, force: true }).catch(() => {}); process.exit(code); }

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("FAIL: no page"); done(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true });
  if (r.result && r.result.exceptionDetails) return { __err: (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || "").split("\n")[0] };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

const results = [];
function check(name, ok, detail) { results.push({ name, ok }); console.log(`  ${ok ? "ok " : "FAIL"} ${name}${detail ? "  " + detail : ""}`); }
const bad = (r) => r && r.__err;
const why = (r) => (r && r.__err) || "";

for (let i = 0; i < 90; i++) { if (await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 40 && !playing; i++) {
  await evl("try{CBZ.setMode('escape'); CBZ.startRun && CBZ.startRun();}catch(e){} return true;");
  await sleep(400);
  playing = await evl("return !!(CBZ.game.state==='playing' && CBZ.game.mode==='escape');");
}
check("boot: escape runs", playing);
if (!playing) done(1);
await sleep(600);

// THE LAB BENCH: player alone in the armory zone, every other sensor off.
// Guards parked far away and pinned (speed 0 — a hunting guard that cannot
// close means tryCapture can never fire mid-test), cameras dark, searchlight
// term off, heat floored.
// (SwiftShader frames are slow, so game time crawls vs wall time — every
// wait below polls the game's own state instead of trusting the wall clock.)
const bench = await evl(`
  CBZ.CONFIG.JAIL_SEARCHLIGHT_DETECT = false;
  (CBZ.cameras || []).forEach(function (c) { c.offline = true; });
  (CBZ.guards || []).forEach(function (gd) {
    gd.speed = 0; gd.hunt = 0; gd.alert = 0; gd.investigate = null; gd.approach = null;
    gd.radioT = null; gd._radioed = false; gd.ko = 0; gd.dead = false;
    gd.group.position.set(-60, 0, -60);
  });
  CBZ.game.invuln = 0;
  CBZ.player.pos.x = 24; CBZ.player.pos.z = 1;
  CBZ.game.detection = 0; CBZ.game.witnessReportT = 0; CBZ.game.lastKnown = null;
  return { on: CBZ.CONFIG.JAIL_WITNESS_REPORT !== false, guards: (CBZ.guards || []).length };
`);
check("bench: witness flag on, guards present", !bad(bench) && bench.on === true && bench.guards >= 2, JSON.stringify(bench));

// ---- 1. in-zone, unseen: quiet ---------------------------------------------
await sleep(1000);
{
  const r = await evl(`
    CBZ.player.pos.x = 24; CBZ.player.pos.z = 1;
    return { det: CBZ.game.detection, quiet: document.getElementById("detectWrap").classList.contains("quiet"),
      state: document.getElementById("detectState").textContent };
  `);
  check("zone: standing in the armory is not a reading", !bad(r) && r.det < 6 && r.quiet === true, JSON.stringify(r));
}

// ---- 2. the sighting opens a window, not the meter -------------------------
{
  await evl(`
    var gd = CBZ.guards[0];
    gd.group.position.set(24, 0, 4.2); gd.group.rotation.y = Math.PI;   // 3.2 m out, facing you
    return true;
  `);
  let r = null;
  for (let i = 0; i < 50; i++) {   // poll: the sighting lands on the first frame he sees you
    await sleep(400);
    r = await evl(`
      CBZ.player.pos.x = 24; CBZ.player.pos.z = 1;
      var gd = CBZ.guards[0];
      return { sees: CBZ.guardSees(gd), radioT: gd.radioT, hunt: gd.hunt, det: CBZ.game.detection };
    `);
    if (!bad(r) && r.radioT != null) break;
  }
  check("sighting: his window opens and he comes for you", !bad(r) && r.radioT != null && r.hunt > 0, JSON.stringify(r));
  check("sighting: the meter has not moved", !bad(r) && r.det < 8, JSON.stringify({ det: r.det }));
}

// ---- 3a. silencer: knock him out before the call lands ---------------------
{
  await evl("CBZ.guards[0].ko = 30.0; return true;");
  let r = null;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    r = await evl("var gd = CBZ.guards[0]; return { radioT: gd.radioT === null ? null : gd.radioT, det: CBZ.game.detection };");
    if (!bad(r) && r.radioT === null) break;
  }
  check("silencer: a KO kills the pending call", !bad(r) && r.radioT === null && r.det < 8, JSON.stringify(r));
}

// ---- 3b. silencer: hands up HOLDS the window and blinds him ----------------
{
  await evl("var gd = CBZ.guards[0]; gd.ko = 0; gd.group.rotation.z = 0; return true;");
  let r0 = null;
  for (let i = 0; i < 50; i++) {   // he re-sights: a fresh window opens
    await sleep(400);
    r0 = await evl("CBZ.player.pos.x = 24; CBZ.player.pos.z = 1; return { radioT: CBZ.guards[0].radioT, el: CBZ.game.elapsed };");
    if (!bad(r0) && r0.radioT != null) break;
  }
  // pin the hold the way a live muzzle does (intimidate.js re-arms intimidT
  // every aimed frame; without it guardReleased fires next frame BY DESIGN)
  await evl("var gd = CBZ.guards[0]; gd.intimidMode = 'scared'; gd.intimidT = 999; return true;");
  // held = the window does not tick while GAME time visibly advances
  let r = null;
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    r = await evl(`
      var gd = CBZ.guards[0];
      return { radioT: gd.radioT, el: CBZ.game.elapsed, blind: !CBZ.guardSees(gd), det: CBZ.game.detection };
    `);
    if (!bad(r) && r.el - r0.el > 0.8) break;   // close to a game-second passed under the hold
  }
  check("silencer: hands up holds the call and blinds his eyes",
    !bad(r0) && r0.radioT != null && !bad(r) && r.radioT != null &&
    Math.abs(r.radioT - r0.radioT) < 0.05 && r.el - r0.el > 0.5 && r.blind === true && r.det < 8,
    JSON.stringify({ opened: r0 && r0.radioT, held: r && r.radioT, gameDt: r && r0 && +(r.el - r0.el).toFixed(2), blind: r && r.blind, det: r && r.det }));
}

// ---- 4. left alone, the call lands and the panel earns its screen time -----
{
  // release the hold and burn the fuse down so the landing (the machinery
  // under test) does not spend a minute of SwiftShader time getting here
  await evl("var gd = CBZ.guards[0]; gd.intimidMode = null; gd.intimidT = 0; if (gd.radioT != null) gd.radioT = 0.3; return true;");
  let landed = null, last = null;
  for (let i = 0; i < 60 && !landed; i++) {
    await sleep(400);
    const r = last = await evl(`
      CBZ.player.pos.x = 24; CBZ.player.pos.z = 1;
      var gd = CBZ.guards[0];
      return { radioed: gd._radioed, det: CBZ.game.detection,
        quiet: document.getElementById("detectWrap").classList.contains("quiet"),
        state: document.getElementById("detectState").textContent };
    `);
    if (!bad(r) && r.radioed && r.det >= 15 && r.quiet === false) landed = r;
  }
  check("call: it lands, heat arrives, the panel comes up", !!landed, JSON.stringify(landed || last));
  // the live label may be the trespass itself or the search it dispatched —
  // either way it must name THIS event's place, and never read Clear.
  check("call: the live label names the place", !!landed && /trespass|armory/i.test(landed.state || ""), JSON.stringify({ state: (landed || last || {}).state }));
}

// ---- 5. rope: restrain a held-up screw -------------------------------------
{
  const r = await evl(`
    var gd = CBZ.guards[1];
    gd.group.position.set(25.5, 0, 1); gd.ko = 0; gd.dead = false; gd.radioT = 2.0; gd.intimidMode = "scared";
    CBZ.econ.addItem("Bedsheet Rope", 1);
    var out = CBZ.prisonRestrainTarget(gd);
    return { out: out, tied: gd.tied === true, ko: gd.ko, radioT: gd.radioT,
      ropeLeft: !!(CBZ.game.inventory["Bedsheet Rope"] > 0), blind: !CBZ.guardSees(gd) };
  `);
  check("rope: ties him, spends the rope, kills the call, blinds him",
    !bad(r) && r.out === "tied" && r.tied && r.ko > 100 && r.radioT === null && r.ropeLeft === false && r.blind === true,
    JSON.stringify(r));
}

const failed = results.filter((r) => !r.ok);
console.log("");
console.log(`PRISON-WITNESS: ${results.length - failed.length}/${results.length} ok`);
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join(" | ")); done(1); }
console.log("PRISON-WITNESS: ok");
done(0);
