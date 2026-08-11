#!/usr/bin/env node
/* tools/night-watch-check.mjs — DOES THE ONE-SHOT ACTUALLY PLAY?

   games/night-watch.html is the dogfood for the four services promoted out of
   the prison wave (day / light / rest / push). A dogfood that only BOOTS
   proves the manifest; this plays the game to its last frame and asserts the
   four services did the work the packs claim, in a building that is not a
   prison and not a city:

     day    the plan walks open → closing → night → dawn on its own clock and
            the sun it publishes goes with it.
     light  a gallery that reads 1.0 at noon reads dark at 02:00, the case
            lights survive lights-out, and the master breaker floods it back.
     rest   staff SIT during opening hours, the porter LIES DOWN at night, and
            waking him steps him clear of the cot (standers stays 0).
     push   a crate is shoved by CONTACT alone, its collider goes with it, the
            two of them seal a 3.2 m doorway against a 0.92 m body, and its
            standable top is real ground the player can climb to reach a panel
            mounted deliberately out of arm's reach.

   The whole run is CBZ.stepSim bursts — no rendering — so a 280-second museum
   day costs a few seconds of CPU. Exit 0 = ok.                              */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [], notes = [];
const ok = (cond, what, detail) => {
  (cond ? notes : fails).push((cond ? "  ok   " : "  FAIL ") + what + (detail != null ? "   " + detail : ""));
};

async function claimPort(lo, n, probe) {
  for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } }
  throw new Error("no free port");
}
const port = await claimPort(9750, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false; for (let i = 0; i < 50 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("NIGHTWATCH: FAIL devserver never came up"); process.exit(1); } }

const dbg = await claimPort(10950, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-nightwatch-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=560,340",
  `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
  `${origin}games/night-watch.html`,
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 240 && !page; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = ps.find((p) => p.type === "page" && p.url.indexOf("night-watch") >= 0);
  } catch (_) {}
  if (!page) await sleep(100);
}
const done = (code, msg) => { if (msg) console.log(msg); chrome.kill("SIGTERM"); server.kill("SIGTERM"); process.exit(code); };
if (!page) done(1, "NIGHTWATCH: FAIL no page");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push(`${(d.url || "?").split("/").pop()}:${d.lineNumber} ${((d.exception && d.exception.description) || d.text || "").split("\n")[0]}`);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push("console.error: " + m.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 240));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) {
    const d = r.result.exceptionDetails;
    errors.push("eval: " + String((d.exception && d.exception.description) || d.text).split("\n")[0]);
    return null;
  }
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");

let ready = false;
for (let i = 0; i < 200 && !ready; i++) { ready = await evl("!!(window.__watch && window.__watch.ready)"); if (!ready) await sleep(250); }
if (!ready) done(1, "NIGHTWATCH: FAIL the page never came up");

/* ---- the harness the whole run drives through. Key injection, not a
     back door: it presses the SAME CBZ.micro.input the studio's controls()
     surface reads, so this exercises the control layer as well as the game. */
await evl(`(function(){
  const CBZ = window.CBZ, W = window.__watch;
  CBZ.micro.stop();                       // only our bursts advance time
  const IN = CBZ.micro.input;
  window.__H = {
    keys: function (o) { for (const k in o) { if (o[k]) { IN.keys[k] = true; } else { delete IN.keys[k]; } } },
    tap: function (code) { IN.down[code] = true; },
    step: function (n, dt) { for (let i = 0; i < (n|0); i++) CBZ.stepSim(dt || 1/60); },
    // walk the player at a point by pressing the same four keys a hand would,
    // through the SAME doorway graph the game's own bodies use — a probe that
    // walks through walls is not testing the building it says it is
    leg: function (x, z, secs, sprint) {
      const me = W.me, N = Math.round((secs || 3) * 60);
      for (let i = 0; i < N; i++) {
        const dx = x - me.pos.x, dz = z - me.pos.z;
        if (Math.hypot(dx, dz) < 0.3) break;
        window.__H.keys({ KeyW: dz < -0.12, KeyS: dz > 0.12, KeyA: dx < -0.12, KeyD: dx > 0.12, ShiftLeft: !!sprint });
        CBZ.stepSim(1/60);
      }
      window.__H.keys({ KeyW: 0, KeyS: 0, KeyA: 0, KeyD: 0, ShiftLeft: 0 });
      return +Math.hypot(x - W.me.pos.x, z - W.me.pos.z).toFixed(2);
    },
    walk: function (x, z, secs, sprint) {
      const legs = W.route(W.roomAt(W.me.pos.x, W.me.pos.z), W.roomAt(x, z));
      for (let i = 0; i < legs.length; i++) {
        const d = legs[i];
        // stand off the doorway on the near side, then step through it
        window.__H.leg(d.x, d.z, secs || 8, sprint);
      }
      return window.__H.leg(x, z, secs || 8, sprint);
    },
    // SHOVE a registered prop toward a point the way a body does it: stand on
    // the far side of it from where it should go, and walk into it. Contact
    // only — there is no verb for this and that is the whole design.
    /* ONE SHOVE ALONG ONE AXIS: get behind the prop, then LEAN ON IT for the
       whole distance. Repeated approach-and-nudge passes do not work, and the
       reason is worth writing down — walking to a spot beside a crate walks
       THROUGH the crate, so every pass undid the last one and the atrium crate
       wandered 17 m the wrong way. A body pushes furniture by staying in
       contact with it, which is also how a person would do it. The caller
       routes the approach so it does not cross the prop; that is the caller's
       job because only the caller knows the room. 1.15 m/s is the measured
       shove speed of a 30 kg crate at a 3.2 m/s walk. */
    shove: function (p, dx, dz, metres) {
      window.__H.leg(p.x - dx * 1.62, p.z - dz * 1.62, 8);
      window.__H.push(dx, dz, metres / 1.15 + 0.8);
      return [+p.x.toFixed(2), +p.z.toFixed(2)];
    },
    // get UP on a prop: stand off it and jump in
    climbOnto: function (p) {
      const W2 = window.__watch;
      for (let n = 0; n < 6; n++) {
        // approach from whichever side has room; south first
        window.__H.leg(p.x, p.z + 2.3, 6);
        window.__H.keys({ KeyW: 1 });
        window.__H.tap("Space");
        for (let i = 0; i < 40; i++) CBZ.stepSim(1/60);
        window.__H.keys({ KeyW: 0 });
        for (let i = 0; i < 20; i++) CBZ.stepSim(1/60);
        if (W2.me.pos.y > 0.5) return +W2.me.pos.y.toFixed(2);
      }
      return +W2.me.pos.y.toFixed(2);
    },
    // hold a direction for N seconds regardless of arrival — this is a SHOVE
    push: function (dx, dz, secs) {
      const N = Math.round(secs * 60);
      window.__H.keys({ KeyW: dz < -0.12, KeyS: dz > 0.12, KeyA: dx < -0.12, KeyD: dx > 0.12 });
      for (let i = 0; i < N; i++) CBZ.stepSim(1/60);
      window.__H.keys({ KeyW: 0, KeyS: 0, KeyA: 0, KeyD: 0 });
    },
    // run the clock until the plan reaches a block (or we give up)
    until: function (blockId, maxSecs) {
      const N = Math.round((maxSecs || 400) * 60);
      for (let i = 0; i < N; i++) { CBZ.stepSim(1/60); if (W.plan.is(blockId)) return true; }
      return false;
    },
    untilFn: function (fnSrc, maxSecs) {
      // the trailing call matters: returning the FUNCTION rather than calling
      // it is truthy, so the first sample passes and the burst never runs.
      // (No backticks in here: this whole block is one template literal.)
      const f = new Function("W", "CBZ", "return (" + fnSrc + ")(W, CBZ);");
      const N = Math.round((maxSecs || 200) * 60);
      for (let i = 0; i < N; i++) { CBZ.stepSim(1/60); if (f(W, CBZ)) return true; }
      return false;
    },
  };
  W.start();
  return true;
})()`);

const S = async () => await evl("JSON.stringify(__watch.state())").then(JSON.parse);
const A = async () => await evl("JSON.stringify(__watch.audits())").then(JSON.parse);

/* ============================================================ 1. THE DAY */
let s = await S();
ok(s.block === "open", "the shift opens in public hours", "block=" + s.block + " hour=" + s.hour);
ok(s.running === true, "the game is running");
const noonLevel = await evl("+__watch.level(-24, -5).toFixed(3)");
ok(noonLevel >= 0.98, "a gallery is fully lit while the museum is open", "level=" + noonLevel);

/* ============================================================ 2. PUSH — the door */
const gap0 = await evl("+__watch.doorGap().toFixed(2)");
// crate 0 sits at (5.6,-26) and crate 1 at (14.4,-26); the doorway is x 8.4..11.6 at z=-30.
// Shove each one into the gap by walking INTO it — contact only, no verb.
await evl(`(function(){
  const C = __watch.crates;
  __H.leg(0, -9.9, 6); __H.leg(0, -14.5, 5); __H.leg(4.0, -24.0, 7);
  __H.shove(C[0], 1, 0, 3.55);                       // east, onto the door's line
  __H.leg(C[0].x - 1.7, -24.4, 5); __H.leg(C[0].x, -24.4, 4);
  __H.shove(C[0], 0, -1, 3.6);                       // north, into the opening
})()`);
const crate0 = await evl("JSON.stringify({x:+__watch.crates[0].x.toFixed(2), z:+__watch.crates[0].z.toFixed(2), moved:+__watch.crates[0].moved.toFixed(2)})").then(JSON.parse);
ok(crate0.moved > 1.0, "a crate moves on CONTACT alone, no prompt and no key", "moved " + crate0.moved + " m to (" + crate0.x + "," + crate0.z + ")");
await evl(`(function(){
  const C = __watch.crates;
  __H.leg(C[0].x, -23.4, 5); __H.leg(16, -23.4, 6);
  __H.shove(C[1], -1, 0, 3.7);
  __H.leg(C[1].x + 1.8, -23.6, 5); __H.leg(C[1].x, -23.6, 4);
  __H.shove(C[1], 0, -1, 3.7);
})()`);
const gap1 = await evl("+__watch.doorGap().toFixed(2)");
const sealed = await evl("__watch.doorSealed()");
ok(gap1 < gap0 - 0.5, "shoving crates narrows the loading door", gap0 + " m clear -> " + gap1 + " m");
ok(sealed === true, "two crates SEAL it against a 0.92 m body", "widest clear span " + gap1 + " m");
let a = await A();
ok(a.pushEscaped === 0, "no prop left its leash", "escaped=" + a.pushEscaped);
ok(a.pushStandLost === 0, "every standable top stayed on its own prop");

/* ---- ...and un-seal it again, because a night with nobody in it proves
     nothing about the other three services. Same physics, sideways: the door
     is sealed, so the watchman cannot walk round to the far side of his own
     barricade — he has to slide one leaf along the wall from inside. ---- */
await evl(`(function(){ const C = __watch.crates; __H.leg(C[1].x - 2.6, C[1].z + 1.4, 6); __H.shove(C[1], 1, 0, 1.6); })()`);
const gap2 = await evl("+__watch.doorGap().toFixed(2)");
ok(!(await evl("__watch.doorSealed()")), "sliding one leaf along the wall opens it again", "clear " + gap2 + " m");

/* ============================================================ 3. REST — the day staff */
const seatedNow = (await S()).seated;
ok(seatedNow >= 1, "staff are SITTING during opening hours", "seated=" + seatedNow);

/* ============================================================ 4. PUSH — the climb */
// crate 2 starts in the atrium at (-4,-6); the breaker is at (0,-11.4), 2.35 m up
await evl(`(function(){
  const C = __watch.crates;
  // every leg routed CLEAR of the crate: a probe that bumps it on the way past
  // has already shoved it, and the push that follows is measuring the bump
  __H.leg(4, -20, 6); __H.leg(0, -14, 6); __H.leg(0, -3.0, 7); __H.leg(-4.0, -3.0, 5);
  __H.shove(C[2], 0, -1, 4.6);                       // north, up to the wall
  __H.leg(-7.0, C[2].z + 1.9, 6); __H.leg(-7.0, C[2].z, 4);
  __H.shove(C[2], 1, 0, 3.2);                        // east, under the panel
})()`);
const crateAt = await evl("JSON.stringify({x:+__watch.crates[2].x.toFixed(2), z:+__watch.crates[2].z.toFixed(2)})").then(JSON.parse);
const under = Math.hypot(crateAt.x - 0, crateAt.z + 11.0).toFixed(2);
ok(under < 1.6, "a crate can be walked all the way under the breaker", "crate at (" + crateAt.x + "," + crateAt.z + "), " + under + " m off the mark");
const standY = await evl(`__H.climbOnto(__watch.crates[2])`);
ok(standY > 0.5, "the shoved crate is real ground: the player stands on it", "player y=" + standY + " on a " + 0.86 + " m crate");
const verb = await evl("(function(){ const v = __watch.verb(); return v ? v.label : null; })()");
ok(verb === "ALL LIGHTS", "and only from up there can he reach the breaker", "verb=" + verb);

/* ============================================================ 5. DAY -> NIGHT */
const wentDark = await evl(`__H.until("night", 200)`);
ok(wentDark === true, "the plan reaches night on its own clock");
s = await S();
ok(s.dayness < 0.02, "and the plan's own sun is down", "dayness=" + s.dayness);
const nightLevel = await evl("+__watch.level(-24, -5).toFixed(3)");
const caseLevel = await evl("+__watch.level(-24.0, -5.0).toFixed(3)");
const darkCorner = await evl("+__watch.level(-16, 10).toFixed(3)");
ok(nightLevel < noonLevel, "the gallery that read 1.0 at noon is darker at night", noonLevel + " -> " + nightLevel);
ok(darkCorner < 0.35, "a corner between fittings is genuinely dark", "level=" + darkCorner);
ok(caseLevel > 0.2, "the case lights survive lights-out and are what you steer by", "level=" + caseLevel);

/* ============================================================ 6. REST — the porter */
// give him the walk to the break room he has been ordered on since `closing`
await evl(`__H.untilFn("function(W){ return W.state().asleep > 0; }", 60)`);
s = await S();
ok(s.asleep === 1, "the night porter is LYING on the cot", "asleep=" + s.asleep);
a = await A();
ok(a.restStanders === 0, "nobody is standing inside the bedding", "standers=" + a.restStanders);
const cotAt = await evl("JSON.stringify({x:+CBZ.propBeds[0].x.toFixed(2), z:+CBZ.propBeds[0].z.toFixed(2)})").then(JSON.parse);
await evl(`__H.walk(${cotAt.x}, ${(cotAt.z - 2.2).toFixed(2)}, 26, true)`);
const wakeVerb = await evl("(function(){ const v = __watch.verb(); return v ? v.label : null; })()");
ok(wakeVerb === "WAKE HIM", "a sleeping man is something you can do something about", "verb=" + wakeVerb);
await evl(`(function(){ __watch.verb().fn(); __H.step(120); })()`);
s = await S(); a = await A();
ok(s.awakePorter === true && s.asleep === 0, "he gets up", "asleep=" + s.asleep);
ok(a.restStanders === 0, "and steps CLEAR of the cot rather than standing in it", "standers=" + a.restStanders);

/* ============================================================ 7. LIGHT — the stealth trade */
const camein = await evl(`__H.untilFn("function(W){ return W.thieves.some(function(t){ return t.state!=='wait' && !t.done; }); }", 120)`);
ok(camein === true, "thieves come in through the loading door once it is open");
// wait for a thief who is actually IN THE DARK: one standing under the lit
// emergency fitting over the loading door is legitimately visible, and a
// stealth test run on him measures nothing.
await evl(`__H.untilFn("function(W){ return W.thieves.some(function(t){ return t.state!=='wait' && !t.done && W.level(t.group.position.x, t.group.position.z) < 0.16; }); }", 90)`);
const trade = await evl(`(function(){
  const W = window.__watch, CBZ = window.CBZ;
  let t = null, best = 9;
  W.thieves.forEach(function (x) {
    if (x.state === "wait" || x.done) return;
    const L = W.level(x.group.position.x, x.group.position.z);
    if (L < best) { best = L; t = x; }
  });
  if (!t) return null;
  const g = t.group.position;
  // stand 11 m off him with a clear line: the LIGHT is the variable under
  // test, so a wall in the way would answer the wrong question
  const held = { x: W.me.pos.x, z: W.me.pos.z };
  // the distance is DERIVED, not chosen: just past what the dark is worth, and
  // inside the lamp's own throw. Picking a round number tests the number.
  const offR = 26 * CBZ.fixtures.get("museum").scale({ flashlightOn: false }, g.x, g.z);
  const D = Math.min(14.4, offR + 1.6);
  if (!(D > offR + 0.4)) return JSON.stringify({ skip: "no trade at this light", offR: +offR.toFixed(2) });
  let placed = false;
  for (let i = 0; i < 12 && !placed; i++) {
    const a = i * Math.PI / 6, px = g.x + Math.cos(a) * D, pz = g.z + Math.sin(a) * D;
    if (W.roomAt(px, pz) !== W.roomAt(g.x, g.z)) continue;
    if (CBZ.micro.segmentBlocked(px, 1.5, pz, g.x, 1.5, g.z)) continue;
    W.me.pos.set(px, W.me.pos.y, pz); placed = true;
  }
  if (!placed) return null;
  // one frame each way: the lamp is a FIXTURE, and a fixture's level is what
  // the rig's last drive made it — asking on the same tick you flip the switch
  // is asking about the previous frame's museum
  const sample = function (on) {
    W.me.flashlightOn = on;
    const hx = W.me.pos.x, hz = W.me.pos.z;
    CBZ.stepSim(1/60);
    W.me.pos.set(hx, W.me.pos.y, hz);            // the frame may have drifted him
    CBZ.stepSim(1/60);
    W.me.pos.set(hx, W.me.pos.y, hz);
    return { see: W.see(t), seenBy: W.seenBy(t) };
  };
  const off = sample(false), on = sample(true);
  W.me.flashlightOn = false;
  W.me.pos.set(held.x, W.me.pos.y, held.z);
  return JSON.stringify({ off: off, on: on, lit: +best.toFixed(3), state: t.state, d: +D.toFixed(2), offR: +offR.toFixed(2) });
})()`).then((r) => r && JSON.parse(r));
ok(trade && trade.off.see === false, "past what the dark is worth, a thief is invisible",
   trade ? ("level " + trade.lit + ", dark sight " + trade.offR + " m, tested at " + trade.d + " m") : "no dark thief to test");
ok(trade && trade.on.see === true, "the lamp finds him");
ok(trade && trade.off.seenBy === false && trade.on.seenBy === true, "and shows him you at the same instant", "one function answers both directions");

/* ============================================================ 8. THE CATCH */
const grabbed = await evl(`(function(){
  const W = window.__watch, CBZ = window.CBZ;
  const t = W.thieves.find(function(x){ return x.state !== "wait" && !x.done; });
  if (!t) return "none";
  const g = t.group.position;
  W.me.pos.set(g.x + 1.2, W.me.pos.y, g.z + 1.2);
  CBZ.stepSim(1/60);
  const v = W.verb();
  if (!v) return "no verb";
  v.fn();
  CBZ.stepSim(1/60);
  return W.state().caught;
})()`);
ok(grabbed === 1, "a watchman lays hands on a thief", "caught=" + grabbed);

/* ============================================================ 9. THE BREAKER */
const flood = await evl(`(function(){
  const W = window.__watch, CBZ = window.CBZ;
  const before = +W.level(-24, -5).toFixed(3);
  W.breaker.burn = 13; W.breaker.cool = 34;
  CBZ.stepSim(1/60);
  return JSON.stringify({ before: before, after: +W.level(-24, -5).toFixed(3), out: CBZ.fixtures.get("museum").kinds.ceiling.out });
})()`).then(JSON.parse);
ok(flood.after > flood.before + 0.4, "the master breaker floods a dark gallery", flood.before + " -> " + flood.after);

/* ============================================================ 10. TO DAWN */
const finished = await evl(`__H.untilFn("function(W){ return W.state().ended; }", 400)`);
s = await S();
ok(finished === true || s.ended === true, "the shift ends", "block=" + s.block + " ended=" + s.ended);
a = await A();
for (const [k, want] of [["studio", 0], ["dayGaps", 0], ["dayOrdered", 1], ["lightUnknown", 0],
                          ["lightNoon", 1], ["restStanders", 0], ["restDupes", 0],
                          ["pushEscaped", 0], ["pushStandLost", 0], ["pushUnbatched", 0],
                          ["furnishMismatch", 0], ["propBlocked", 0]]) {
  ok(a[k] === want, "ratchet " + k + " = " + want, "got " + a[k]);
}
ok(errors.length === 0, "it ran clean", errors.length ? errors.slice(0, 4).join(" | ") : "no console errors");

console.log(notes.join("\n"));
if (fails.length) { console.log(fails.join("\n")); done(1, "NIGHTWATCH: FAIL (" + fails.length + ")"); }
done(0, "NIGHTWATCH: ok — " + notes.length + " checks, a whole museum day in " + Math.round(process.uptime()) + "s");
