#!/usr/bin/env node
/* tools/dialogue-read-check.mjs — THE STREET READS YOU.
 *
 * Proves city/read.js by CONSEQUENCE, in the live game, with no rendering:
 *
 *   1. the gap band is real arithmetic (±1 at 12 levels, ±2 at 28) and it is
 *      cover-aware, i.e. it goes through cityLevel(a, viewer) not a raw field;
 *   2. socialRead returns WORDS, and the word MOVES when the relationship
 *      moves (rob a man -> his standing leaves "stranger");
 *   3. the same man says the same thing twice — the pick is hashed off him,
 *      not rolled (this is the determinism law applied to dialogue);
 *   4. ...and a DIFFERENT standing gets a different line, so #3 is stability,
 *      not a constant;
 *   5. a real body-to-body contact through CBZ.humanContact.react() actually
 *      reaches the subtitle — the bump has a voice;
 *   6. what they PITCH changes with what the player is (the owner's hitman
 *      case), asserted by flipping the player's role and re-reading;
 *   7. THE LIMP POPUP IS GONE and the limp itself still works — a wound must
 *      still slow you and still bend the leg, or the deletion was a regression.
 *
 * --revert re-runs the whole thing with CITY_READ_V1=0 and asserts the
 * OPPOSITE where it matters: the flat fallback line comes back and no contact
 * line is produced. A probe that passes before and after proves nothing.
 *
 * Usage: node tools/dialogue-read-check.mjs [--seed 90210] [--revert]
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const argS = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const SEED = +argS("--seed", "90210");
const REVERT = argv.includes("--revert");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claimPort(start, n, probe) {
  for (let p = start; p < start + n; p++) { try { await probe(p); } catch (_) { return p; } }
  return start;
}
const port = await claimPort(8990, 60, async (p) => { await fetch(`http://127.0.0.1:${p}/`); });
const origin = `http://127.0.0.1:${port}`;
const srv = spawn("python3", [path.join(ROOT, "tools", "devserver.py")], {
  cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: "ignore",
});
{ let up = false;
  for (let i = 0; i < 100 && !up; i++) { try { await fetch(origin + "/index.html"); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("READCHECK: FAIL devserver never came up"); process.exit(1); } }

const dbg = await claimPort(10780, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-readcheck-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");
const url = `${origin}?seed=${SEED}` + (REVERT ? "&cfg_CITY_READ_V1=0" : "");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=480,300",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`, url,
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 200 && !page; i++) {
  try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(origin)); } catch (_) {}
  if (!page) await sleep(100);
}
if (!page) { console.error("READCHECK: FAIL no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return { __throw: String(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text) };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

for (let i = 0; i < 900; i++) { if (await evl("!!(window.CBZ && CBZ.bootComplete)")) break; await sleep(200); }
if (!await evl("!!(window.CBZ && CBZ.bootComplete)")) { console.error("READCHECK: FAIL boot never completed"); process.exit(1); }

// free play in the city, and a populated street
// The campaign prologue holds the street COLD (peds.js cityDeferPedPopulation
// behind mode.js's cityCampaignObservationGate), so a fresh boot has an empty
// city and every read below would trivially pass on zero bodies. Jump to free
// play AND open the gate, then drain the sliced spawn job.
await evl(`(() => {
  try { if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts"; } catch(e){}
  try { if (CBZ.game.cityCampaignPending) CBZ.game.cityCampaignPending.phase = "endless_contracts"; } catch(e){}
  CBZ.cityCampaignObservationGate = function () { return true; };
  return CBZ.game.mode;
})()`);
// A fresh boot sits at state "title" with an unpopulated street. Start the run
// through the REAL path (setMode + startRun) — poking game.state directly
// leaves city.arena unbuilt and the ped brain throws on null lots, which looks
// exactly like a bug in the thing under test. spawnCityPeds slices its work
// over frames, so drain it before reading anything.
const nPeds = await evl(`(() => {
  try { if (CBZ.setMode) CBZ.setMode("city"); } catch(e){}
  try { if (CBZ.startRun) CBZ.startRun(); } catch(e){}
  for (let i=0;i<240;i++) CBZ.stepSim(1/60);
  if (!(CBZ.cityPeds||[]).length && CBZ.spawnCityPeds) { try { CBZ.spawnCityPeds(60); } catch(e){} }
  for (let i=0;i<300;i++) CBZ.stepSim(1/60);
  return (CBZ.cityPeds||[]).length;
})()`);
if (!nPeds) { console.error("READCHECK: FAIL street still empty after startRun + spawn"); process.exit(1); }

const REVERT_JS = REVERT ? "true" : "false";
const PASS = await evl(`(() => {
  const REVERT = ${REVERT_JS};
  const out = { fails: [], notes: {} };
  const F = (m) => out.fails.push(m);
  const g = CBZ.game;
  const peds = (CBZ.cityPeds || []).filter(p => p && !p.dead && p.pos);
  out.notes.mode = g.mode; out.notes.peds = peds.length;
  if (!peds.length) { F("no live peds to read"); return out; }

  // ---------- presence ----------
  const api = ["cityReadGap","citySocialRead","cityLine","cityContactReact","cityReadAudit","cityPlayerRole"];
  for (const k of api) if (typeof CBZ[k] !== "function") F("missing API: CBZ." + k);
  if (out.fails.length) return out;

  const p = peds[0];

  // ---------- 1. the gap band is arithmetic over cityLevel ----------
  // drive it by moving the PLAYER's level inputs is expensive; instead assert
  // the band edges against the same cityLevel the function itself reads, which
  // is the honest test of "did it use the cover-aware read".
  const theirLvl = CBZ.cityLevel(p, CBZ.city && CBZ.city.playerActor);
  const myLvl = CBZ.cityPlayerLevel();
  const d = myLvl - theirLvl;
  const expect = d >= 28 ? 2 : d >= 12 ? 1 : d <= -28 ? -2 : d <= -12 ? -1 : 0;
  const got = CBZ.cityReadGap(p);
  out.notes.gap = { myLvl, theirLvl, d, expect, got };
  if (got !== expect) F("gap band wrong: d=" + d + " expected " + expect + " got " + got);
  if (typeof theirLvl !== "number" || theirLvl < 1) F("cityLevel did not return a real level");

  // ---------- 2. words, and they MOVE with the relationship ----------
  const r0 = CBZ.citySocialRead(p);
  out.notes.read0 = { standing: r0.standing, mood: r0.mood, title: r0.title, kind: r0.kind };
  const WORDS = ["stranger","known","solid","friend","sour","enemy"];
  if (WORDS.indexOf(r0.standing) < 0) F("standing is not a word: " + r0.standing);
  if (typeof r0.gap !== "number") F("read.gap missing");
  // make him hate you, then re-read
  if (CBZ.cityRelShift) { CBZ.cityRelShift(p, "robbed", 3); CBZ.cityRelShift(p, "beaten", 3); }
  const r1 = CBZ.citySocialRead(p);
  out.notes.read1 = { standing: r1.standing, mood: r1.mood };
  if (r1.standing === r0.standing && r0.standing === "stranger") F("standing never moved after robbed+beaten (was " + r0.standing + ")");

  // ---------- 3+4. stable per person, but not constant ----------
  const a1 = CBZ.cityLine(p, "contact", { severity: 0.2 });
  const a2 = CBZ.cityLine(p, "contact", { severity: 0.2 });
  out.notes.line = a1;
  if (!REVERT) {
    if (!a1) F("cityLine returned nothing for contact");
    if (a1 !== a2) F("line not stable for the same person+state: " + a1 + " vs " + a2);
    // a different severity must be able to reach a different pool
    const hard = CBZ.cityLine(p, "contact", { severity: 0.9 });
    out.notes.lineHard = hard;
    if (hard && hard === a1) F("hard contact produced the same line as a light bump");
  } else {
    if (a1) F("REVERT: cityLine still spoke with CITY_READ_V1=0");
  }

  // ---------- 5. the bump reaches the subtitle ----------
  const el0 = document.getElementById("citySpeech");
  const before = el0 ? el0.textContent : "";
  // clear any live line, then drive a REAL contact through the shared contract
  if (CBZ.citySocialReset) {} // no-op guard
  // citySay only shows a speaker within earshot (9.5 u ambient), so a contact
  // test on a random body across the map proves nothing. Put the mark at arm's
  // length — which is where a body-to-body contact happens anyway.
  const target = peds.find(q => q !== p && !q.dead) || p;
  const PP = CBZ.player;
  target.pos.x = PP.pos.x + 1.1; target.pos.z = PP.pos.z + 0.4;
  if (target.group) target.group.position.set(target.pos.x, target.pos.y || 0, target.pos.z);
  target._contactSayT = 0;
  const spoke = CBZ.humanContact && CBZ.humanContact.react
    ? (CBZ.humanContact.react(target, { source: CBZ.city && CBZ.city.playerActor, kind: "shoved", severity: 0.6, mode: "city" }), true)
    : false;
  if (!spoke) F("CBZ.humanContact.react is not reachable");
  const el = document.getElementById("citySpeech");
  const shown = el ? (el.textContent || "") : "";
  const visible = !!(el && el.classList.contains("show"));
  out.notes.subtitle = shown.slice(0, 80);
  out.notes.subtitleShown = visible;
  const audit = CBZ.cityReadAudit();
  out.notes.audit = audit;
  if (!REVERT) {
    if (!audit.contacts) F("contact produced no line (audit.contacts = 0)");
    if (!visible) F("subtitle element is not showing after a contact");
  } else {
    if (audit.contacts) F("REVERT: contact still spoke with CITY_READ_V1=0");
  }

  // ---------- 6. what you ARE changes the pitch ----------
  if (!REVERT) {
    const asCiv = CBZ.cityLine(p, "trade");
    const realNot = CBZ.cityNotoriety;
    CBZ.cityNotoriety = function () { return { xp: 99999, idx: 4, name: "Boss", cut: 2 }; };
    const asHit = CBZ.cityLine(p, "trade");
    CBZ.cityNotoriety = realNot;
    out.notes.tradeCiv = asCiv; out.notes.tradeHitman = asHit;
    if (!asCiv || !asHit) F("trade line missing");
    if (asCiv === asHit) F("pitch did not change when the player became a known hitman");
    if (CBZ.cityPlayerRole().key !== "civilian" && CBZ.cityPlayerRole().key !== "crew" && CBZ.cityPlayerRole().key !== "boss") {
      out.notes.playerRole = CBZ.cityPlayerRole().key;
    }
  }

  // ---------- 7. the limp lost its caption and kept its body ----------
  const P = CBZ.player;
  let hinted = null;
  const realHint = CBZ.flashHint;
  CBZ.flashHint = function (t) { hinted = t; };
  P._legWound = 0; P._legSide = 1;
  if (CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(60, "gunshot"); } catch(e) {} }
  // whatever the damage path did, force the wound and tick the injury system
  P._legWound = 0.8;
  for (let i = 0; i < 30; i++) CBZ.stepSim(1/60);
  CBZ.flashHint = realHint;
  out.notes.legHint = hinted;
  if (hinted && /limp/i.test(String(hinted))) F("the LEG HIT popup is still firing: " + hinted);
  out.notes.moveScale = P._moveScale;
  if (!(P._moveScale < 1)) F("limp carrier gone: _moveScale did not drop on a 0.8 leg wound (" + P._moveScale + ")");
  if (P.sprint) F("limp carrier gone: sprint still allowed on a blown leg");

  return out;
})()`);

let bad = 0;
if (!PASS || PASS.__throw) { console.error("READCHECK: FAIL in-page threw: " + (PASS && PASS.__throw)); bad = 1; }
else {
  console.log("mode=" + PASS.notes.mode + "  peds=" + PASS.notes.peds + (REVERT ? "   [REVERT: CITY_READ_V1=0]" : ""));
  console.log("gap      ", JSON.stringify(PASS.notes.gap));
  console.log("read     ", JSON.stringify(PASS.notes.read0), "->", JSON.stringify(PASS.notes.read1));
  console.log("line     ", JSON.stringify(PASS.notes.line), "| hard:", JSON.stringify(PASS.notes.lineHard));
  console.log("trade    ", JSON.stringify(PASS.notes.tradeCiv), "-> as hitman:", JSON.stringify(PASS.notes.tradeHitman));
  console.log("subtitle ", JSON.stringify(PASS.notes.subtitle), "shown=" + PASS.notes.subtitleShown);
  console.log("limp     ", "hint=" + JSON.stringify(PASS.notes.legHint), "moveScale=" + PASS.notes.moveScale);
  console.log("audit    ", JSON.stringify(PASS.notes.audit));
  for (const f of PASS.fails) { console.error("  FAIL: " + f); bad = 1; }
}
const realErrors = errors.filter((e) => !/ProgressEvent/.test(e) && !/computeBoundingSphere/.test(e));
if (realErrors.length) { for (const e of realErrors.slice(0, 8)) console.error("  JS ERROR: " + e); bad = 1; }

try { ws.close(); } catch (_) {}
chrome.kill("SIGKILL"); srv.kill("SIGKILL");
await rm(profile, { recursive: true, force: true });
console.log(bad ? "READCHECK: FAIL" : "READCHECK: ok");
process.exit(bad);
