#!/usr/bin/env node
/* ============================================================
   tools/prison-onthing-check.mjs — ARE THE VERBS ON THE PERSON?

   Owner, 2026-09-30: "Put the interaction options ONTO the thing being
   interacted with ... On touch, interaction options should only show when
   you touch the character or thing." Plus Grab (the disaster game's grab,
   its hold set swapped in), Trade (two pockets on one table, items move for
   real) and a warden with more than Snitch.

   Boots index.html headless as an inmate, freezes rAF and drives
   CBZ.stepSim, then asserts:
     - the faced inmate wears his verbs (E/J/K/L pills in #prisonPrompts),
       no #interact card, no #pinteract rail, the noun audit is 0
     - Grab holds him and swaps in the hold set; Set down gives the verbs back
     - Trade opens the table with real items; a gift and a request+Accept
       move items between g.inventory and his loadout
     - the warden wears two or more verbs
     - touch: nothing until select(), his verbs after, gone on select(null)

     node tools/prison-onthing-check.mjs [--port 9822]
   Exit 0 = pass, 1 = any assertion failed.
============================================================ */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const PORT = Number(opt("--port", 9822));
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
  "--window-size=1000,640", `--user-data-dir=/tmp/cbz-onthing-check-${PORT}`, "about:blank",
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
errors.splice(0);
// THE PLAYER'S PATH: escape mode, inmate (default role), tap PLAY.
await ev(`(function(){
  if (CBZ.game.mode !== 'escape' && CBZ.setMode) CBZ.setMode('escape');
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
await sleep(400);
await ev(`(function(){ for (var i=0;i<120;i++) CBZ.stepSim(1/60); return true; })()`);

// a stage helper in the page: stand the player in front of an actor, facing him
await ev(`(function(){
  window.__face = function (a, d) {
    var p = CBZ.player, q = a.group.position; d = d || 1.3;
    var ang = (a.group.rotation && a.group.rotation.y) || 0;
    p.pos.set(q.x + Math.sin(ang) * d, q.y, q.z + Math.cos(ang) * d);
    if (CBZ.playerChar) CBZ.playerChar.group.position.copy(p.pos);
    if (CBZ.cam) CBZ.cam.yaw = Math.atan2(-(q.x - p.pos.x), -(q.z - p.pos.z));
  };
  window.__step = function (n) { for (var i=0;i<(n||1);i++) { CBZ.hitstop = 0; CBZ.stepSim(1/60); CBZ.player.hp = 100; } };
  window.__pills = function () {
    return Array.from(document.querySelectorAll('#prisonPrompts .wprompt')).filter(function (w) { return w.style.display !== 'none' && w.style.visibility !== 'hidden'; })
      .map(function (w) { var v = w.querySelector('.wverb'), k = w.querySelector('.wkey'); return (k ? k.textContent + ':' : '') + (v ? v.textContent : ''); });
  };
  return true;
})()`);

// 1) AN INMATE WEARS HIS VERBS ON HIM (desktop)
const inmate = await ev(`(function(){
  var p = CBZ.player, best = null, bd = 1e9;
  (CBZ.npcs||[]).forEach(function(n){ if (n.dead || n.ko > 0 || n.escaped || !n.group || n.kind !== 'inmate' || n._crowd) return;
    if (n.approach && n.approach.t > 0) return;
    var d = Math.hypot(n.group.position.x - p.pos.x, n.group.position.z - p.pos.z); if (d < bd) { bd = d; best = n; } });
  if (!best) return { err: 'no inmate' };
  window.__inmate = best;
  for (var k = 0; k < 20; k++) { __face(best); __step(1); }
  var sh = CBZ.prisonPeople.shown();
  return { name: best.data.name, target: CBZ.prisonInteractTarget() === best, shownOn: sh && sh.who === best, verbs: sh && sh.verbs, pills: __pills(),
    audit: CBZ.prisonPromptAudit(), oldCard: document.getElementById('interact').classList.contains('show'), rail: !!document.getElementById('pinteract') };
})()`);
log("  inmate: " + JSON.stringify(inmate));
check("the faced inmate wears his verbs", inmate && inmate.shownOn && inmate.pills && inmate.pills.length >= 3, inmate && inmate.pills);
check("verbs are E/J/K/L and include Grab + Trade", inmate && inmate.verbs && inmate.verbs.indexOf("grab") >= 0 && inmate.verbs.indexOf("trade") >= 0 && inmate.pills.some((x) => /^E:/.test(x)), inmate && inmate.verbs);
check("no fixed card, no rail", inmate && !inmate.oldCard && !inmate.rail);
check("noun audit stays 0", inmate && inmate.audit && inmate.audit.nouned === 0, inmate && inmate.audit);

// 2) GRAB swaps in the hold set; he struggles; release
const grab = await ev(`(function(){
  var a = window.__inmate; __face(a, 1.0); __step(2);
  var v = CBZ.prisonVerbsFor(a), i = v.indexOf('grab');
  if (i < 0) return { err: 'no grab', v: v };
  CBZ.doInteract(i);
  var seen = [];
  for (var k = 0; k < 90; k++) { __step(1); if (k % 15 === 0) seen.push(JSON.stringify(CBZ.prisonVerbsFor(a))); }
  var held = CBZ.grapple && CBZ.grapple.holding();
  var sh = CBZ.prisonPeople.shown();
  return { held: held, verbs: sh && sh.verbs, pills: __pills(), seen: seen, grudge: a.playerGrudge || 0 };
})()`);
log("  grab: " + JSON.stringify(grab));
check("Grab takes hold of him", grab && grab.held, grab);
check("holding swaps in the hold set on him", grab && grab.verbs && grab.verbs.some((x) => /^h:/.test(x)), grab && grab.verbs);
const rel = await ev(`(function(){
  var a = window.__inmate, v = CBZ.prisonVerbsFor(a), i = v.indexOf('h:setDown');
  if (i < 0) i = v.indexOf('h:letGo');
  if (i >= 0) CBZ.doInteract(i);
  __step(150);
  return { held: CBZ.grapple && CBZ.grapple.holding(), verbs: CBZ.prisonVerbsFor(a) };
})()`);
log("  release: " + JSON.stringify(rel));
check("Set down lets him go, the normal verbs come back", rel && !rel.held && rel.verbs.indexOf("grab") >= 0, rel);

// 3) TRADE: the table opens with both pockets, a gift moves for real
const trade = await ev(`(function(){
  var a = window.__inmate; a.ko = 0; __face(a, 1.3); __step(30);
  var v = CBZ.prisonVerbsFor(a), i = v.indexOf('trade');
  if (i < 0) return { err: 'no trade', v: v };
  CBZ.econ.addItem('Soap', 2); CBZ.econ.addCigs(30);
  CBZ.doInteract(i); __step(2);
  var T = CBZ.prisonTrade, A0 = T.audit();
  var tiles = document.querySelectorAll('#prisonTrade.show .ptr-tile').length;
  var his0 = (a.loadout && a.loadout.items.length) || 0, cigs0 = CBZ.game.cigs, soap0 = CBZ.game.inventory.Soap || 0;
  T.put('mine', 'Soap', 1); T.offer(); __step(2);
  var soap1 = CBZ.game.inventory.Soap || 0, his1 = (a.loadout && a.loadout.items.length) || 0;
  // a request: ask for his priciest thing, he names a price, accept
  var his = T.audit().his || {}, want = null, wv = -1;
  for (var k in his) { var vv = CBZ.econ.itemValue(k); if (vv > wv) { wv = vv; want = k; } }
  var req = null;
  if (want) { T.put('theirs', want, 1); T.request(); var A1 = T.audit(); req = { want: want, counter: !!A1.counter, mine: A1.mine, ask: A1.ask };
    if (A1.counter) { var had = CBZ.game.inventory[want] || 0; T.accept(); req.got = (CBZ.game.inventory[want] || 0) - had; } }
  var open = T.isOpen(); T.close();
  return { opened: A0.open, tiles: tiles, gift: { soap0: soap0, soap1: soap1, his0: his0, his1: his1 }, req: req, stillOpen: open, cigs0: cigs0, cigs1: CBZ.game.cigs };
})()`);
log("  trade: " + JSON.stringify(trade));
check("Trade opens the two-sided table with real items", trade && trade.opened && trade.tiles >= 2, trade);
check("an offered gift moves for real", trade && trade.gift && trade.gift.soap1 === trade.gift.soap0 - 1 && trade.gift.his1 === trade.gift.his0 + 1, trade && trade.gift);
check("a request gets his price and Accept moves the item", trade && (!trade.req || !trade.req.counter || trade.req.got === 1), trade && trade.req);

// 4) THE WARDEN has more than Snitch
const warden = await ev(`(function(){
  var w = (CBZ.npcs||[]).concat(CBZ.guards||[]).filter(function(x){ return x.kind === 'warden' && !x.dead; })[0];
  if (!w) return { err: 'no warden' };
  __face(w, 1.4); __step(20);
  var floorV = CBZ.prisonVerbsFor(w);
  var sh = CBZ.prisonPeople.shown();
  return { floor: floorV, shownOnHim: sh && sh.who === w, pills: __pills(), labels: floorV.map(function (v) { return v; }) };
})()`);
log("  warden: " + JSON.stringify(warden));
check("the warden wears more than one verb", warden && warden.floor && warden.floor.length >= 2 && warden.shownOnHim, warden);

// 5) TOUCH: nothing until tapped, then on him; tap elsewhere hides
const touch = await ev(`(function(){
  var a = window.__inmate; a.ko = 0; CBZ.touchMode = true; document.body.classList.add('touch');
  __face(a, 1.4); __step(20);
  var before = __pills().length;
  // THE REAL TAP: a finger on his chest, through touch.js's raycast
  CBZ.camera.updateMatrixWorld();
  var v = new THREE.Vector3(a.group.position.x, a.group.position.y + 1.2, a.group.position.z).project(CBZ.camera);
  var p0 = CBZ.player.pos.clone();
  var tapped = CBZ.cityTapWorld ? CBZ.cityTapWorld((v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight) : null;
  var sel = CBZ.prisonPeople.selected() === a;
  __step(30);
  var moved = +CBZ.player.pos.distanceTo(p0).toFixed(2);
  if (!sel) CBZ.prisonPeople.select(a);
  __step(3);
  var after = __pills();
  CBZ.prisonPeople.select(null); __step(3);
  var gone = __pills().length;
  CBZ.touchMode = false; document.body.classList.remove('touch'); __step(2);
  return { before: before, after: after, gone: gone, tapped: tapped, selectedByTap: sel, moved: moved, ndc: [+v.x.toFixed(2), +v.y.toFixed(2)] };
})()`);
log("  touch: " + JSON.stringify(touch));
check("touch: nothing on him until he is tapped", touch && touch.before === 0, touch);
check("touch: a real tap on his body selects him", touch && touch.selectedByTap && touch.moved < 1.0, touch);
check("touch: tapped, his verbs are on him", touch && touch.after.length >= 3, touch);
check("touch: tap elsewhere puts them away", touch && touch.gone === 0, touch);

check("no console errors after PLAY", errors.length === 0, errors.length);
if (errors.length) {
  const seen = new Map();
  errors.forEach((e) => { const k = String(e).split("\n").slice(0, 3).join(" | ").slice(0, 300); seen.set(k, (seen.get(k) || 0) + 1); });
  [...seen].slice(0, 20).forEach(([k, n]) => log(`   x${n} ${k}`));
}
const failed = results.filter((r) => !r.ok).length;
log(failed ? `PRISON ON-THE-THING: ${failed} FAILED` : "PRISON ON-THE-THING: PASS");
finish(failed ? 1 : 0);
