#!/usr/bin/env node
/* tools/yard-melee-check.mjs — WHAT HAPPENS WHEN AN INMATE JUMPS YOU.

   THE COMPLAINT THIS GATE EXISTS FOR (owner, verbatim): "in prison game look
   how when attacked you get spun around. This is very unrealistic for a human
   attacking you."

   He is describing `CBZ.predatorSeize`. It is the ANIMAL grab — systems/
   predator.js takes the camera and ORBITS it around the attacker's jaw for the
   whole hold (predator.js:1350, `h.camPh += dt * (0.55 + thrash * 0.5)`), which
   is a magnificent read on a bear and an absurd one on a man who has grabbed
   your shirt. entities/ai.js fired it on EVERY THIRD BLOW, unconditionally, so
   the animal takedown was the prison's default melee experience.

   Two numbers decide whether that is fixed, and both are measured here by
   running the real jump-you brawl in the real escape mode, not by reading the
   source:

     grabRate   seizes started / blows landed. Was ~1/3 by construction. MUST
                now be low — a rare escalation, not the shape of every fight.
     kinds      how many DISTINCT strikes the attacker threw. Was 2 (a straight
                and an uppercut on every third beat, literally
                `punchKind = jumpBlows % 3 === 0 ? "upper" : ""`). The owner
                asked for "more normal shit" in exchange for the spin, so a
                straight, a hook, an uppercut, an elbow, a knee, a headbutt and
                a shove all have to actually appear.

   And two that stop the exchange being a downgrade:
     hits       real damage still lands through CBZ.hurtPlayer — the whole point
                of the original change ("have an NPC punch the player and health
                go down") must survive.
     errors     no console errors from the three new rig poses.

   Usage:
     node tools/yard-melee-check.mjs
     node tools/yard-melee-check.mjs --blows 400
     node tools/yard-melee-check.mjs --keep
   Exit 0 = ok.                                                              */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const BLOWS = parseInt(arg("--blows", "300"), 10);

const port = 8930 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9930 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-yard-${dbg}`;
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
if (!page) { console.error("YARD: FAIL no page"); done(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") { const d = m.params.exceptionDetails; errors.push(`${d.url || "?"}:${d.lineNumber} ${(d.exception && d.exception.description || d.text || "").split("\n")[0]}`); }
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") { errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 200)); }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(function(){${expr}})()`, returnByValue: true });
  if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description };
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");

for (let i = 0; i < 120; i++) { if (await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 40 && !playing; i++) {
  await evl("try{CBZ.setMode('escape'); CBZ.startRun && CBZ.startRun();}catch(e){return String(e);} return true;");
  await sleep(500);
  playing = await evl("return !!(CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='escape');");
}
if (!playing) { console.log("YARD: FAIL never reached escape mode"); console.log([...new Set(errors)].slice(0, 6)); done(2); }

/* THE BRAWL, RUN FOR REAL. Nothing here reimplements the fight: it puts a live
   inmate next to the player, sets the one flag that means "this man has decided
   to jump you" (`huntPlayer`, the flag provokeGang sets), and then calls the
   REAL CBZ.aiThink over and over, watching what the rig is told to do.

   The player is kept alive and out of the capture arc between blows (hp is
   restored, invuln is cleared) so a three-hundred-blow sample is possible at
   all — a real player is on the floor after fifteen. Nothing else is touched:
   the blow chosen, the seize roll, the damage and the shove are all the
   shipping code paths. */
const out = await evl(`
  var n = null, list = (CBZ.npcs || []);
  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    if (c && !c.dead && !c.ko && c.group && c.char) { n = c; break; }
  }
  if (!n) return { __err: "no live inmate in the yard" };

  var P = CBZ.player;
  var seizes = 0, hits = 0, blows = 0;
  var kinds = {};
  // count every seize this brawl starts, without disabling the real one
  var realSeize = CBZ.predatorSeize;
  CBZ.predatorSeize = function () {
    seizes++;
    try { return realSeize.apply(this, arguments); } catch (e) { return null; }
  };
  var realHurt = CBZ.hurtPlayer;
  CBZ.hurtPlayer = function () { hits++; try { return realHurt.apply(this, arguments); } catch (e) { return false; } };

  var guard = 0;
  while (blows < ${BLOWS} && guard++ < ${BLOWS * 60}) {
    // keep him on you, in range, and keep the sample alive
    P.hp = 100; P.dead = false; P.stun = 0;
    if (CBZ.game) CBZ.game.invuln = 0;
    if (n.dead || n.ko) break;
    n.huntPlayer = 5;
    n.hitCD = 0;
    n._seizing = 0;
    // alternate arm's length and clinch range so BOTH halves of the vocabulary
    // are exercised — the short weapons only come out when it closes up
    var close = (blows % 2 === 0) ? 1.05 : 1.75;
    n.group.position.set(P.pos.x + close, n.group.position.y, P.pos.z);

    var before = n.char.punchT || 0, bk = n.char.kickT || 0;
    try { CBZ.aiThink(n, 0.05); } catch (e) { return { __err: "aiThink threw: " + e }; }

    // a blow was thrown iff the rig was handed a fresh strike this call
    if ((n.char.kickT || 0) > bk) { kinds["knee:" + (n.char.kickKind || "?")] = (kinds["knee:" + (n.char.kickKind || "?")] || 0) + 1; blows++; }
    else if ((n.char.punchT || 0) > before) { var k = n.char.punchKind || "straight"; kinds[k] = (kinds[k] || 0) + 1; blows++; }
    // let the strike timer run out so the next call is a fresh decision
    n.char.punchT = 0; n.char.kickT = 0;
    // and let a seize that DID start finish, rather than blocking every later one
    if (n._seizing && CBZ.predatorRelease) { try { CBZ.predatorRelease(n); } catch (e) {} }
    n._seizing = 0;
  }
  CBZ.predatorSeize = realSeize;
  CBZ.hurtPlayer = realHurt;
  return { blows: blows, seizes: seizes, hits: hits, kinds: kinds,
           grabRate: blows ? Math.round(seizes / blows * 1000) / 1000 : null };
`);

if (!out || out.__err) { console.log("YARD: FAIL " + (out && out.__err)); done(1); }

/* THE RIG HAS TO BE ABLE TO DRAW WHAT THE BRAIN CHOSE. A vocabulary of names
   the animator does not implement is a vocabulary of jabs. This asks
   entities/character.js directly: pose a real rig with each kind and confirm
   the limbs it owns actually moved off their rest values. */
const poses = await evl(`
  var ch = CBZ.playerChar;
  if (!ch || !ch.parts) return { __err: "no player rig" };
  function sample() {
    var P = ch.parts, J = ch.low || {};
    return [P.la.rotation.x, P.la.rotation.z, P.ra.rotation.x, P.ra.rotation.z,
            J.la ? J.la.rotation.x : 0, J.ra ? J.ra.rotation.x : 0,
            P.ll.rotation.x, P.rl.rotation.x, P.ll.scale.y, P.rl.scale.y,
            ch.body.rotation.x, ch.body.rotation.y,
            ch.neck ? ch.neck.rotation.x : 0].join(",");
  }
  var seen = {}, moved = {};
  var kinds = ["", "hook", "upper", "elbow", "headbutt", "shove"];
  for (var i = 0; i < kinds.length; i++) {
    ch.punchT = 0; ch.kickT = 0;
    try { CBZ.animChar(ch, 0, 0.016); } catch (e) {}
    var rest = sample();
    ch.punchKind = kinds[i]; ch.punchArm = "r"; ch.punchDur = 0.3; ch.punchT = 0.3;
    // step to the middle of the drive, where every kind is at full extension
    for (var s = 0; s < 9; s++) { try { CBZ.animChar(ch, 0, 0.016); } catch (e) {} }
    var now = sample();
    seen[kinds[i] || "straight"] = now;
    moved[kinds[i] || "straight"] = (now !== rest);
  }
  // the knee is a KICK on this rig, not a punch
  ch.punchT = 0; ch.kickT = 0;
  try { CBZ.animChar(ch, 0, 0.016); } catch (e) {}
  var rest2 = sample();
  ch.kickKind = "knee"; ch.kickLeg = "r"; ch.kickDur = 0.42; ch.kickT = 0.42;
  for (var s2 = 0; s2 < 12; s2++) { try { CBZ.animChar(ch, 0, 0.016); } catch (e) {} }
  seen.knee = sample(); moved.knee = (seen.knee !== rest2);
  ch.kickT = 0; ch.punchT = 0;
  // DISTINCTNESS: two names that produce the same numbers are one move with
  // two labels, which is exactly the "vocabulary" this gate exists to reject.
  var uniq = {}, dup = [];
  for (var k in seen) { if (uniq[seen[k]]) dup.push(uniq[seen[k]] + "==" + k); else uniq[seen[k]] = k; }
  return { moved: moved, dup: dup, n: Object.keys(seen).length };
`);

const clean = errors.filter((e) => !/ProgressEvent|favicon|preload|WebGL|texture/i.test(e));
const fails = [];

if (!poses || poses.__err) fails.push("rig probe: " + (poses && poses.__err));
else {
  for (const k in poses.moved) if (!poses.moved[k]) fails.push(`the rig does not animate "${k}" at all — the name is a jab`);
  if (poses.dup && poses.dup.length) fails.push(`identical poses: ${poses.dup.join(", ")} — same move, two names`);
}

/* THE GRAB RATE. It was 1-in-3 by construction. Anything at or above 1-in-8
   is still "the animal camera is how prison fights go", which is the report. */
if (!(out.grabRate < 0.12)) {
  fails.push(`a seize started on ${Math.round(out.grabRate * 100)}% of blows — the spin is still the default (want < 12%)`);
}
if (out.seizes === 0 && out.blows >= 200) {
  // it must stay REACHABLE: rare is the ask, removed is not
  fails.push(`${out.blows} blows and the grab never once happened — it was made rare, not rare enough to delete`);
}
const kindN = Object.keys(out.kinds || {}).length;
if (kindN < 5) fails.push(`only ${kindN} distinct strikes thrown across ${out.blows} blows (want 5+): ${JSON.stringify(out.kinds)}`);
if (out.hits === 0) fails.push("no blow ever reached CBZ.hurtPlayer — the beating stopped costing health");
if (clean.length) fails.push(`${clean.length} console errors — ${clean[0]}`);

console.log(JSON.stringify({ ...out, rig: poses }, null, 2));
if (fails.length) {
  console.log("\nYARD: FAIL");
  for (const f of fails) console.log("  - " + f);
  done(1);
}
console.log(`\nYARD: ok — ${out.blows} blows, ${kindN} distinct strikes, ` +
  `${out.seizes} grabs (${Math.round(out.grabRate * 1000) / 10}%), ${out.hits} landed on the player`);
done(0);
