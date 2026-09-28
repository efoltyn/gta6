#!/usr/bin/env node
/* ============================================================
   tools/prison-cop-check.mjs — DOES THE PRISON'S COP ROLE PLAY?

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
     · the interact card on a standing inmate has no CUFF (arrest.js's rule:
       down or surrendered only); hands up it does, and CUFF lands
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
const PORT = Number(opt("--port", 9812));
const DBG = PORT + 1;
const STEPS = Number(opt("--steps", 3600));
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
  "--window-size=1000,640", `--user-data-dir=/tmp/cbz-cop-check-${PORT}`, "about:blank",
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
for (let i = 0; i < 300 && !ready; i++) {
  await sleep(1000);
  try { ready = await ev("!!(window.CBZ&&CBZ.game&&CBZ.stepSim&&CBZ.setRole&&document.getElementById('playBtn'))"); } catch (_) {}
}
if (!ready) { log("FAIL: title card never came up"); errors.slice(0, 10).forEach((e) => log("   " + String(e).split("\n")[0])); finish(1); }
const preErrors = errors.splice(0);
if (preErrors.length) { log(`  pre-PLAY errors (${preErrors.length}):`); preErrors.slice(0, 10).forEach((e) => log("   " + String(e).split("\n")[0].slice(0, 200))); }

// THE PLAYER'S PATH: escape mode, tap COP, tap PLAY.
await ev(`(function(){
  if (CBZ.game.mode !== 'escape' && CBZ.setMode) CBZ.setMode('escape');
  var b = document.querySelector('.role-btn[data-role="cop"]'); if (b) b.click();
  window.__copPicked = CBZ.game.role;
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
check("PLAY reaches state=playing", playing);
if (!playing) { errors.slice(0, 15).forEach((e) => log("   " + String(e).split("\n").slice(0, 6).join(" / ").slice(0, 900))); finish(1); }
await ev("window.__copStopRaf(0), true");
await sleep(500);

const snap = `(function(){
  var p = CBZ.player, g = CBZ.game, sp = CBZ.COP_SPAWN;
  var hunted = (CBZ.guards||[]).filter(function(gd){ return !gd.dead && (gd.state==='chase'||gd.state==='arrest'||gd.state==='hunt'||(gd.alert||0)>0.5); }).map(function(gd){ return gd.state; });
  return {
    picked: window.__copPicked, role: g.role, playerRole: p.role, state: g.state, mode: g.mode,
    pos: [+p.pos.x.toFixed(1), +p.pos.y.toFixed(1), +p.pos.z.toFixed(1)],
    spawn: sp ? [+sp.x.toFixed(1), +sp.y.toFixed(1), +sp.z.toFixed(1)] : null,
    distSpawn: sp ? +Math.hypot(p.pos.x - sp.x, p.pos.z - sp.z).toFixed(1) : null,
    hp: p.hp, dead: p.dead, capture: p.captureState, cuffed: !!(CBZ.playerChar && CBZ.playerChar.cuffed),
    weapons: (CBZ.weaponInventory||[]).slice(), current: CBZ.currentWeaponId,
    detection: g.detection, complaints: g.complaints, hunted: hunted,
    objective: (document.getElementById('objective')||{}).textContent || '',
  };
})()`;
const s0 = await ev(snap);
log("  at spawn: " + JSON.stringify(s0));
check("the picker set role=cop", s0.picked === "cop" && s0.role === "cop" && s0.playerRole === "cop", { picked: s0.picked, role: s0.role, playerRole: s0.playerRole });
check("spawned at the officer post", s0.distSpawn != null && s0.distSpawn < 3, { pos: s0.pos, spawn: s0.spawn });
check("cop loadout: sidearm + taser", s0.weapons.includes("sidearm") && s0.weapons.includes("taser"), s0.weapons);
// ~60 s of sim in bursts; errors in the updater chain surface as console errors.
const burst = 300;
let s = s0;
for (let done = 0; done < STEPS; done += burst) {
  try { await ev(`(function(){ for (var i=0;i<${burst};i++) CBZ.stepSim(1/60); return true; })()`); }
  catch (e) { log("  stepSim threw: " + e.message.split("\n")[0]); break; }
  s = await ev(snap);
  if (s.state !== "playing" || s.dead || s.capture !== "normal" || s.cuffed || s.hunted.length) {
    log(`  t=${((done + burst) / 60).toFixed(0)}s ` + JSON.stringify(s));
  }
}
log("  after sim: " + JSON.stringify(s));
const hb = await ev(`(function(){
  var a = CBZ.hotbarAudit ? CBZ.hotbarAudit() : null;
  var bar = document.getElementById('hotbar');
  return { audit: a, cells: bar ? bar.children.length : -1 };
})()`);
log("  hotbar: " + JSON.stringify(hb));
check("hotbar shows the belt: 2 guns, torch, keycard", hb.audit && hb.audit.allowed && hb.audit.guns === 2 && hb.audit.kinds.flashlight === 1 && hb.audit.kinds.keycard === 1 && hb.audit.shown && hb.cells === 4, hb.audit && hb.audit.kinds);


check("still playing, alive, not captured after ~" + Math.round(STEPS / 60) + "s", s.state === "playing" && !s.dead && s.capture === "normal" && !s.cuffed, { state: s.state, dead: s.dead, capture: s.capture, cuffed: s.cuffed });
check("guards are not after the officer", s.hunted.length === 0 && (s.detection || 0) < 1, { hunted: s.hunted, detection: s.detection });

// CUFF: walk up to the nearest plain inmate and run the card's verb.
const cuff = await ev(`(function(){
  var p = CBZ.player, best = null, bd = 1e9;
  // a PLAIN inmate: not the dealer or a merchant with a stall, nobody walking up with an offer
  (CBZ.npcs||[]).forEach(function(n){ if (n.dead || n.ko > 0 || n.escaped || !n.group || n.kind !== 'inmate') return;
    if (n.role === 'dealer' || n.role === 'merchant' || (n.approach && n.approach.t > 0) || n.aiState === 'approachPlayer') return;
    var d = Math.hypot(n.group.position.x - p.pos.x, n.group.position.z - p.pos.z); if (d < bd) { bd = d; best = n; } });
  if (!best) return { err: 'no inmate' };
  // stand him in front of the officer
  // walk the officer up to him (the brain owns his feet, so move the player)
  var on = null;
  for (var k = 0; k < 30 && on !== best; k++) {
    var gp = best.group.position;
    p.pos.set(gp.x, p.pos.y, gp.z - 1.2);
    if (CBZ.playerChar) CBZ.playerChar.group.position.copy(p.pos);
    CBZ.stepSim(1/60);
    on = CBZ.prisonInteractTarget ? CBZ.prisonInteractTarget() : null;
  }
  // THE RULE (systems/arrest.js): a man on his feet who has not given up is
  // not cuffed. Standing: no Cuff on his card. Then he puts his hands up (the
  // surrender a drawn weapon gets out of him) and Cuff is there.
  var standingVerbs = CBZ.prisonVerbsFor ? CBZ.prisonVerbsFor(best) : null;
  best.intimidMode = 'scared'; best.poseHandsUp = true; if (best.char) best.char.handsUp = true;
  var verbs = CBZ.prisonVerbsFor ? CBZ.prisonVerbsFor(best) : null;
  var idx = verbs ? verbs.indexOf('detain') : -1;
  var r = 'no detain on the card';
  if (on !== best) r = 'card is on ' + (on ? (on.kind || '') + ' ' + (on.data && on.data.name) : 'nobody');
  else if (idx >= 0) { try { CBZ.doInteract(idx); r = 'pressed'; } catch (e) { return { err: 'detain threw: ' + e.message, verbs: verbs }; } }
  window.__copTarget = best;
  return { name: best.data && best.data.name, dist: +bd.toFixed(1), standingVerbs: standingVerbs, verbs: verbs, result: r };
})()`);
log("  cuff: " + JSON.stringify(cuff));
for (let i = 0; i < 6; i++) await ev(`(function(){ for (var i=0;i<60;i++) CBZ.stepSim(1/60); return true; })()`);
const after = await ev(`(function(){ var a = window.__copTarget; if (!a) return null; var V = CBZ.verbs;
  return { ko: +(a.ko||0).toFixed(1), cuffed: !!(V && V.cuffed && V.cuffed(a)), ai: a.aiState }; })()`);
log("  target after 6s: " + JSON.stringify(after));
check("a standing inmate who has not given up offers no Cuff", cuff && Array.isArray(cuff.standingVerbs) && !cuff.standingVerbs.includes("detain"), cuff && cuff.standingVerbs);
check("hands up, the card offers Cuff", cuff && Array.isArray(cuff.verbs) && cuff.verbs.includes("detain"), cuff && cuff.verbs);
check("CUFF lands on an inmate", !cuff.err && after && (after.cuffed || after.ko > 0), after);

// ---- THE KEYS, AND A DOOR OFF THE CLOCK (systems/prisondoorwatch.js) --------
// The officer's keys open the yard gate and a racked cell; a cell he opens
// after lock-up is noticed by a screw, who calls it and walks over.
const creds = await ev(`(function(){
  var a = CBZ.prisonDoorAudit ? CBZ.prisonDoorAudit() : null; if (!a) return null;
  var r = {}; a.rows.forEach(function(x){ if (x.id === 'prison-yard-door' || x.id === 'prison-armory') r[x.id] = x.cred; });
  return r;
})()`);
check("the officer's keys open the yard gate and the armory", creds && creds["prison-yard-door"] && creds["prison-armory"], creds);
// 23:00: the wing is racked shut
const phase = ((23 - 6) / 24).toFixed(5);
for (let i = 0; i < 6; i++) await ev(`(function(){ if (CBZ.dayPhase) CBZ.dayPhase(${phase}); for (var i=0;i<30;i++) CBZ.stepSim(1/60); return true; })()`);
const setup = await ev(`(function(){
  var S = CBZ.prisonSchedule, cb = CBZ.cellblock;
  if (!S || !cb || !cb.cells) return { err: 'no schedule/cellblock' };
  if (window.__copTarget) { window.__copTarget.cuffed = false; }
  var c = null;
  for (var i = 0; i < cb.cells.length; i++) { var k = cb.cells[i]; if (k.locked && !k.tier && k.leafClosed && !k.player) { c = k; break; } }
  // the wing can still be holding leaves for stragglers: rack one ourselves
  if (!c && S.cellsLocked()) for (var j = 0; j < cb.cells.length && !c; j++) { var q = cb.cells[j]; if (!q.tier && q.leafClosed && !q.player && cb.setDoor(q, true)) c = q; }
  if (!c) return { err: 'no locked cell', block: S.id(), locked: S.cellsLocked() };
  // the officer in the aisle, facing the bars
  var dx = c.leafClosed.x - c.x, dz = c.leafClosed.z - c.z, dl = Math.hypot(dx, dz) || 1;
  var px = c.leafClosed.x + dx / dl * 1.3, pz = c.leafClosed.z + dz / dl * 1.3;
  var p = CBZ.player; p.pos.set(px, c.fy || 0, pz);
  if (CBZ.playerChar) CBZ.playerChar.group.position.copy(p.pos);
  if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-(c.leafClosed.x - px), -(c.leafClosed.z - pz));
  // a screw a few metres down the aisle, awake and looking this way
  var gd = (CBZ.guards||[]).filter(function(g){ return !g.dead && g.kind !== 'warden'; })[0];
  if (gd) {
    gd.asleep = false; gd.pause = 0; gd.hunt = 0;
    var ax = -dz / dl, az = dx / dl;   // along the aisle
    gd.group.position.set(px + ax * 6, p.pos.y, pz + az * 6);
    gd.group.rotation.y = Math.atan2(px - gd.group.position.x, pz - gd.group.position.z);
  }
  CBZ.stepSim(1/60);
  var r = CBZ.prisonDoorVerbNearest ? CBZ.prisonDoorVerbNearest() : 'no verb';
  window.__copCell = c;
  return { block: S.id(), locked: S.cellsLocked(), cell: c.i, result: r, open: !c.locked };
})()`);
log("  door setup: " + JSON.stringify(setup));
check("the officer opens a racked cell with his keys", setup && setup.result === "opened" && setup.open, setup);
let dw = null, reacted = false, shut = false;
for (let i = 0; i < 40 && !(reacted && shut); i++) {
  await ev(`(function(){ for (var i=0;i<30;i++) CBZ.stepSim(1/60); return true; })()`);
  dw = await ev(`(function(){ var a = CBZ.prisonDoorWatch.audit(); a.cellLocked = !!(window.__copCell && window.__copCell.locked); return a; })()`);
  if (i % 6 === 0) log(`   +${((i + 1) * 0.5).toFixed(1)}s ` + JSON.stringify(dw.live));
  if (dw.log.challenged > 0 || dw.log.radioed > 0) reacted = true;
  if (reacted && dw.cellLocked) shut = true;
}
log("  door watch: " + JSON.stringify(dw));
check("a screw reacts to the cell opened off the clock", reacted, dw && dw.log);
check("the cell ends up shut again (by him, or the officer on his word)", shut, dw && { locked: dw.cellLocked, log: dw.log });

check("no console errors after PLAY", errors.length === 0, errors.length);
if (errors.length) {
  const seen = new Map();
  errors.forEach((e) => { const k = String(e).split("\n").slice(0, 2).join(" | ").slice(0, 260); seen.set(k, (seen.get(k) || 0) + 1); });
  [...seen].slice(0, 20).forEach(([k, n]) => log(`   x${n} ${k}`));
}
const failed = results.filter((r) => !r.ok).length;
log(failed ? `PRISON COP: ${failed} FAILED` : "PRISON COP: PASS");
finish(failed ? 1 : 0);
