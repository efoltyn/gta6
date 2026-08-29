#!/usr/bin/env node
/* tools/gungame-quiet-check.mjs — GUN GAME IS NOT THE PRISON.

   THE COMPLAINT THIS GATE EXISTS FOR (owner, 2026-08-19, verbatim): "In gun
   game, I'm seeing fucking dialogue pop ups. Why should there be dialogue?"

   He was right and it was worse than dialogue. modes/gungame.js borrows the
   prison's GEOMETRY — a deathmatch played on CBZ.prisonRoot — and the prison's
   own systems were gated by exception lists ("not survival", "not city") or by
   nothing at all, so a gun-game match inherited the entire ESCAPE SIMULATION:

     · systems/interactions.js had NO mode gate (its gate was the win check at
       the bottom), so the breakout's props kept offering themselves mid-match:
       "Crouch [C] to enter vent / hatch" — and that vent teleports you off the
       map — plus "Press [E] to Sabotage Power" and a keycard whose pickup
       rewrote your objective to "scout tunnels for another way out".
     · systems/detection.js ran the whole wanted machine. Measured before the
       fix, 45 s of an ordinary match: 17 crimes reported, heat 31/100, 1608
       guard-sight ticks, and — because trySnitch walks CBZ.npcs, which is
       where gun game registers its BOTS — "<the man you are shooting> saw
       that." printed at you.
     · systems/killstreaks.js popped its centre card on EVERY kill in a mode
       made of kills, and its reward cards at 3/5/7 of the eight kills a ladder
       takes, narrating a prison to somebody who is not in one ("Guards marked",
       "Yard confused", "Searchlights stumble"). Its 25-streak nuke drops
       CBZ.npcs and calls winGame — a streak reward that ends a ladder match.

   All three now ask the same question, `mode === "escape"`, because a world's
   own GAME is a scenario question (systems/modecaps.js is for shared engine
   verbs, and its revert path answers `mode === "city"` — wrong shape for this).

   This gate holds BOTH sides, which is the only way it means anything: the
   prison sim must be silent in gun game AND intact in escape. A revert that
   quiets the prison everywhere passes half of it and fails here.

   Usage:  node tools/gungame-quiet-check.mjs   (npm run test:gungame-quiet)
   Exit 0 = ok.                                                              */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);

const port = 8930 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9930 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-ggq-${dbg}`;
await rm(profile, { recursive: true, force: true });
await sleep(700);
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1280,800",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, base,
], { stdio: "ignore" });

function done(code) {
  if (!has("--keep")) { try { chrome.kill("SIGTERM"); } catch (_) {} }
  try { server.kill("SIGTERM"); } catch (_) {}
  process.exit(code);
}

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(base)); } catch (_) {}
  if (!page) await sleep(250);
}
if (!page) { console.error("GUNGAME-QUIET: FAIL no page"); done(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`); }
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 160)); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description).slice(0, 200) };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");
for (let i = 0; i < 160; i++) { if (await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)")) break; await sleep(500); }

/* THE PROBE, RUN IN BOTH MODES. Nothing here reimplements a system: it calls
   the SHIPPING entry points every prison caller uses — CBZ.reportCrime (the
   choke point fpsmode's every shot and combat.js's every punch go through),
   CBZ.addHeat and CBZ.killstreakOnDown — and reads the DOM the player reads.
   `chain` counts how far a report actually travelled, because an escape-mode
   report can legitimately end in a snitch walking off to tell somebody rather
   than in an instant heat number. */
const CHAIN = ["witnessGuard", "addCasePressure", "npcWitnessCrime", "sendNpcToSnitch", "addHeat"];
const probe = `
  var g = CBZ.game;
  var chain = 0;
  var KEYS = ${JSON.stringify(CHAIN)};
  KEYS.forEach(function (k) {
    if (typeof CBZ[k] !== "function") return;
    var f = CBZ[k]; CBZ[k] = function () { chain++; return f.apply(this, arguments); }; CBZ[k]._w = f;
  });
  CBZ.reportCrime && CBZ.reportCrime(44, { type: "gunfire" });
  KEYS.forEach(function (k) { if (CBZ[k] && CBZ[k]._w) CBZ[k] = CBZ[k]._w; });

  var h0 = g.detection;
  CBZ.addHeat && CBZ.addHeat(9);
  var heatDirect = Math.round((g.detection - h0) * 100) / 100;

  // the streak card, through the same call fpsmode makes on a lethal hit
  var fake = { data: { name: "Test Target" }, group: { position: { x: 0, y: 0, z: 0 } } };
  CBZ.killstreakOnDown && CBZ.killstreakOnDown(fake, "sidearm");
  var card = (function () { var e = document.getElementById("streakHud"); return !!(e && e.classList.contains("pop")); })();
  var meter = (function () { var e = document.getElementById("streakMeter"); return e ? e.style.display : null; })();

  // the centre hint band: the surface the breakout prompts print on
  var hint = (function () { var e = document.getElementById("hint"); return e ? (e.textContent || "").trim() : ""; })();
  var leak = (CBZ.gungameAudit && g.mode === "gungame") ? CBZ.gungameAudit().prisonLeak : 0;
  return { mode: g.mode, chain: chain, heatDirect: heatDirect, card: card, meter: meter, hint: hint, leak: leak };
`;

const results = {};
for (const [mode, map] of [["gungame", "jail"], ["escape", null]]) {
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    await evl(`try{ ${map ? `CBZ.setGungameMap('${map}');` : ""} CBZ.setMode('${mode}'); CBZ.startRun && CBZ.startRun(); }catch(e){} return 1;`);
    await sleep(800);
    ok = await evl(`return !!(CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='${mode}');`);
  }
  if (!ok) { console.log("GUNGAME-QUIET: FAIL never reached " + mode); console.log([...new Set(errors)].slice(0, 6)); done(2); }
  await sleep(2500);
  const r = await evl(probe);
  if (!r || r.__err) { console.log("GUNGAME-QUIET: FAIL probe threw in " + mode + ": " + (r && r.__err)); done(1); }
  results[mode] = r;
}

const gg = results.gungame, esc = results.escape;
console.log("gungame " + JSON.stringify(gg));
console.log("escape  " + JSON.stringify(esc));

const fails = [];
// --- the arena is quiet ---
if (gg.chain !== 0) fails.push("reportCrime ran " + gg.chain + " prison calls inside a match (want 0)");
if (gg.heatDirect !== 0) fails.push("addHeat wrote the wanted ledger inside a match (+" + gg.heatDirect + ", want 0)");
if (gg.card) fails.push("the killstreak card popped inside a match");
if (gg.meter !== "none") fails.push("the streak meter is on screen inside a match (display:" + gg.meter + ")");
if (gg.hint) fails.push("the centre hint band printed inside a match: " + JSON.stringify(gg.hint));
if (gg.leak > 0) fails.push("gungameAudit().prisonLeak is " + gg.leak + " (ratchet 0)");
// --- and the prison still has its game ---
if (!(esc.chain > 0)) fails.push("ESCAPE REGRESSION: a reported crime reached no witness/heat path at all");
if (esc.heatDirect !== 9) fails.push("ESCAPE REGRESSION: addHeat(9) moved the ledger by " + esc.heatDirect);
if (!esc.card) fails.push("ESCAPE REGRESSION: the killstreak card no longer pops");

if (fails.length) {
  console.log("GUNGAME-QUIET: FAIL");
  fails.forEach((f) => console.log("  - " + f));
  done(1);
}
if (errors.length) { console.log("GUNGAME-QUIET: FAIL console errors"); console.log([...new Set(errors)].slice(0, 6)); done(1); }
console.log("GUNGAME-QUIET: OK — the prison sim is silent in gun game and intact in escape");
done(0);
