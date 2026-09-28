#!/usr/bin/env node
/* ============================================================
   tools/prison-tell-check.mjs — DOES TELLING WORK IN THE REAL ENGINE?

   (Scaffold shared with tools/prison-cop-check.mjs.) Boots the prison as an
   INMATE, steps ~30 s of sim, then stages the owner's ask end to end through
   the real card: the player knows a man stabbed another, presses TELL on the
   guard at his elbow, picks the item; an officer walks over, tosses the man
   and he leaves the yard. Also: the warden is in the suit, and a hunt put on
   the warden lands on an officer instead.

     node tools/prison-tell-check.mjs [--port 9872] [--steps 1800]

   What follows is the cop check's original header, kept for the scaffold:

   Owner, 2026-09-28, on his tablet: "the cop version doesn't work in the
   prison game." The title card's role picker (#roleSelect, .role-btn
   data-role="cop") had no check of its own, so a day of waves that rewired
   brains, verbs, the body and the hotbar could break it silently.

   Boots index.html headless, picks COP on the title card, presses PLAY,
   freezes rAF after a few frames and drives CBZ.stepSim for ~60 s of sim,
   then asserts:
     · no console errors / exceptions after PLAY
     · role is cop and the player spawned at the officer post (COP_SPAWN),
       alive, not captured, not cuffed, dressed as corrections
     · the cop loadout is real items (sidearm + taser on the weapon list)
     · the interact card on an inmate offers the cop's verbs
       (question / search / detain) and CUFF on him lands: he ends cuffed/down
     · no guard is hunting / arresting the player officer

     node tools/prison-cop-check.mjs [--port 9812] [--steps 3600]
   Exit 0 = pass, 1 = any assertion failed.
============================================================ */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const PORT = Number(opt("--port", 9872));
const DBG = PORT + 1;
const STEPS = Number(opt("--steps", 1800));
const log = (s) => process.stdout.write(s + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const CHROME = process.env.CBZ_CHROME ||
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${DBG}`, "--no-sandbox",
  "--disable-dev-shm-usage", "--enable-webgl", "--enable-unsafe-swiftshader",
  "--use-gl=angle", "--use-angle=swiftshader", "--mute-audio",
  "--no-first-run", "--no-default-browser-check",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
  "--window-size=1000,640", `--user-data-dir=/tmp/cbz-tell-check-${PORT}`, "about:blank",
], { stdio: "ignore" });

function finish(code) {
  try { chrome.kill("SIGKILL"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  process.exit(code);
}

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  await sleep(500);
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
    const t = tabs.find((x) => x.webSocketDebuggerUrl);
    if (t) wsUrl = t.webSocketDebuggerUrl;
  } catch (_) {}
}
if (!wsUrl) { log("FAIL: chromium never came up"); finish(1); }

const sock = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map();
const errors = [];
sock.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
  } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    errors.push(m.params.args.map((a) => a.value || a.description || "").join(" "));
  }
});
const send = (method, params) => new Promise((res, rej) => {
  const id = ++msgId;
  pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
  sock.send(JSON.stringify({ id, method, params: params || {} }));
  setTimeout(() => { if (pending.delete(id)) rej(new Error(`CDP timeout: ${method}`)); }, 180000);
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result && r.result.value;
};

await new Promise((r) => sock.addEventListener("open", r));
await send("Runtime.enable");
await send("Page.enable");
// rAF budget: a handful of software frames, then frozen; the sim is stepped by hand.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const nativeRAF = window.requestAnimationFrame.bind(window);
  let left = 1e9;
  window.requestAnimationFrame = function (cb) { return left-- > 0 ? nativeRAF(cb) : 0; };
  window.__copStopRaf = function (n) { left = n || 0; };
})();` });
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html?mode=escape` });

let ready = false;
for (let i = 0; i < 360 && !ready; i++) {
  await sleep(1000);
  try { ready = await ev("!!(window.CBZ&&CBZ.game&&CBZ.stepSim&&CBZ.setRole&&document.getElementById('playBtn'))"); } catch (_) {}
}
if (!ready) { log("FAIL: title card never came up"); errors.slice(0, 10).forEach((e) => log("   " + String(e).split("\n")[0])); finish(1); }
const preErrors = errors.splice(0);
if (preErrors.length) { log(`  pre-PLAY errors (${preErrors.length}):`); preErrors.slice(0, 10).forEach((e) => log("   " + String(e).split("\n")[0].slice(0, 200))); }

// THE PLAYER'S PATH: escape mode, INMATE, PLAY.
await ev(`(function(){
  if (CBZ.game.mode !== 'escape' && CBZ.setMode) CBZ.setMode('escape');
  var b = document.querySelector('.role-btn[data-role="inmate"]'); if (b) b.click();
  window.__copStopRaf(4);
  document.getElementById('playBtn').click();
  return true;
})()`);
let playing = false;
for (let i = 0; i < 180 && !playing; i++) {
  await sleep(1000);
  try { playing = await ev("CBZ.game.state==='playing'"); } catch (_) {}
}
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail != null ? "  " + JSON.stringify(detail) : ""}`); };
check("PLAY reaches state=playing (inmate)", playing);
if (!playing) { errors.slice(0, 15).forEach((e) => log("   " + String(e).split("\n").slice(0, 6).join(" / ").slice(0, 900))); finish(1); }
await ev("window.__copStopRaf(0), true");
await sleep(500);
const step = (n) => ev(`(function(){ for (var i=0;i<${n};i++) CBZ.stepSim(1/60); return true; })()`);
for (let done = 0; done < STEPS; done += 300) {
  try { await step(300); } catch (e) { log("  stepSim threw: " + e.message.split("\n")[0]); break; }
}
const w0 = await ev(`(function(){ var a = CBZ.prisonWardenAudit ? CBZ.prisonWardenAudit() : null;
  var w = (CBZ.guards||[]).find(function(g){ return g.kind==='warden'; });
  return { audit: a, role: CBZ.game.role, dress: w && w.char ? w.char._prisonOutfitKey : null, hat: w && CBZ.headwear ? CBZ.headwear.worn(w.char) : 'n/a', state: w ? w.state : null }; })()`);
log("  warden: " + JSON.stringify(w0));
check("the warden wears the warden's record (the suit), bareheaded", w0.dress === "warden" && !w0.hat, { dress: w0.dress, hat: w0.hat });
// STAGE: a man the player watched stab someone, and a guard at the player's elbow
const staged = await ev(`(function(){
  var p = CBZ.player, gs = CBZ.guards.filter(function(g){ return g.kind==='guard' && !g.dead && !(g.ko>0) && !g.asleep && !g._reinf; });
  var gd = gs[0];
  var inm = CBZ.npcs.filter(function(n){ return n.group && !n.dead && !n.escaped && !(n.ko>0) && n.role !== 'merchant'; });
  var a = inm[0], b = inm[1];
  if (!gd || !a || !b) return { err: 'no cast' };
  var gp = gd.group.position;
  a.loadout = a.loadout || { items: [], cigs: 3 }; a.loadout.items = (a.loadout.items || []).concat(['Shiv']);
  CBZ.prisonSnitch.learn({ kind: 'stab', whoA: a, otherA: b, sole: true });
  window.__tell = { gd: gd, a: a };
  var on = null;
  for (var k = 0; k < 40 && on !== gd; k++) { p.pos.set(gp.x + 1.2, p.pos.y, gp.z); if (CBZ.playerChar) CBZ.playerChar.group.position.copy(p.pos); CBZ.stepSim(1/60); on = CBZ.prisonInteractTarget ? CBZ.prisonInteractTarget() : null; }
  var v0 = CBZ.prisonVerbsFor(gd);
  var i = v0.indexOf('tell');
  if (on !== gd || i < 0) return { err: 'no tell', on: on && on.data && on.data.name, verbs: v0 };
  CBZ.doInteract(i);
  for (var k2 = 0; k2 < 30; k2++) { p.pos.set(gd.group.position.x + 1.2, p.pos.y, gd.group.position.z); CBZ.stepSim(1/60); }
  var v1 = CBZ.prisonVerbsFor(gd);
  var lab = CBZ.prisonSnitch.label('tellA');
  CBZ.doInteract(v1.indexOf('tellA'));
  return { verbs0: v0, verbs1: v1, label: lab, who: a.data.name, audit: CBZ.prisonSnitch.audit() };
})()`);
log("  staged: " + JSON.stringify(staged).slice(0, 900));
check("TELL is on the guard's card and opens what the player knows", !staged.err && staged.verbs1 && staged.verbs1[0] === "tellA" && /stabbed/.test(staged.label), staged.err || staged.verbs1);
check("an officer is sent", staged.audit && staged.audit.tasks && staged.audit.tasks.length === 1);
let res = null;
for (let s = 0; s < 40; s++) {
  await step(120);
  res = await ev(`(function(){ var t = window.__tell; var A = CBZ.prisonSnitch.audit();
    return { seg: !!t.a._seg, cuffed: !!t.a.cuffed, shiv: (t.a.loadout.items||[]).indexOf('Shiv') >= 0, tasks: A.tasks, segs: A.seg, log: A.log, rep: A.rep }; })()`);
  if (res.seg) break;
}
log("  after: " + JSON.stringify(res));
check("the stabber was tossed (blade gone) and moved off the yard", res && res.seg && !res.shiv, res && { seg: res.seg, shiv: res.shiv });
const w1 = await ev(`(function(){ var w = (CBZ.guards||[]).find(function(g){ return g.kind==='warden'; }); if (!w) return null;
  var before = CBZ.guards.filter(function(g){ return g !== w && (g.hunt||0) > 0; }).length;
  w.hunt = 4; CBZ.stepSim(1/60);
  return { hunt: w.hunt, state: w.state, before: before, others: CBZ.guards.filter(function(g){ return g !== w && (g.hunt||0) > 0; }).length }; })()`);
log("  warden hunt handoff: " + JSON.stringify(w1));
check("a hunt put on the warden goes to an officer, not him", w1 && w1.hunt === 0 && w1.others > w1.before, w1);
check("no console errors after PLAY", errors.length === 0, errors.length);
if (errors.length) {
  const seen = new Map();
  errors.forEach((e) => { const k = String(e).split("\n").slice(0, 2).join(" | ").slice(0, 260); seen.set(k, (seen.get(k) || 0) + 1); });
  [...seen].slice(0, 20).forEach(([k, n]) => log(`   x${n} ${k}`));
}
const failed = results.filter((r) => !r.ok).length;
log(failed ? `PRISON TELL: ${failed} FAILED` : "PRISON TELL: PASS");
finish(failed ? 1 : 0);
