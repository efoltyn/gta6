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
     - NO OVERLAP, live (owner, 2026-09-30: "it can't be overlapping them.
       It can't block them at all"), measured in px^2 every frame of a walk
       around the target with the camera turning:
         desktop  the verb cluster vs his projected body (capsule + rig
                  bounds), and a door's pill vs its leaf + frame: 0
         touch    (852x393 iPhone landscape, touch emulated, real controls)
                  the dock vs the joystick, the fire/jump/eye cluster, pause,
                  Plan and the belt: 0; grab's hold set and the trade table's
                  verbs + card too; every tap target >= 44 px

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
    // HARNESS TRAP: Chrome can list a non-page target (a service worker, an
    // extension) first; driving that one never reaches the title card.
    const t = tabs.find((x) => x.type === "page" && x.webSocketDebuggerUrl);
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

// GEOMETRY, MEASURED INDEPENDENTLY OF THE LAYOUT: a man is an upright 0.30 m
// capsule feet to 1.9 m, unioned with his rig's own mesh bounds; a door is its
// shut slab(s) plus its leaf mesh. Projected through the live camera every frame.
await ev(`(function(){
  function proj(boxes) {
    var cam = CBZ.camera; cam.updateMatrixWorld();
    var v = new THREE.Vector3(), l = 1e9, t = 1e9, r = -1e9, b = -1e9, n = 0;
    boxes.forEach(function (B) {
      for (var k = 0; k < 8; k++) {
        v.set(k & 1 ? B[3] : B[0], k & 2 ? B[4] : B[1], k & 4 ? B[5] : B[2]).project(cam);
        if (v.z > 1) continue;
        var x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
        l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); n++;
      }
    });
    return n ? { l: l, t: t, r: r, b: b } : null;
  }
  function meshBox(o, cap) {
    var bx = new THREE.Box3().setFromObject(o);
    if (bx.isEmpty()) return null;
    if (cap && (bx.max.x - bx.min.x > cap || bx.max.y - bx.min.y > cap || bx.max.z - bx.min.z > cap)) return null;
    return [bx.min.x, bx.min.y, bx.min.z, bx.max.x, bx.max.y, bx.max.z];
  }
  window.__geo = {
    body: function (a) {
      var q = a.group.position, R = 0.30, y = q.y || 0;
      var boxes = [[q.x - R, y, q.z - R, q.x + R, y + 1.9, q.z + R]];
      var m = meshBox(a.group, 2.3); if (m && m[3] - m[0] < 1.1 && m[5] - m[2] < 1.1) boxes.push(m);
      return proj(boxes);
    },
    door: function (s) {
      var boxes = [];
      var cols = s.cols ? s.cols() : [s.col()];
      (cols || []).forEach(function (c) { if (!c) return; var fy = s.floor ? s.floor() : (c.y0 || 0);
        boxes.push([c.minX, Math.max(fy, c.y0 != null ? c.y0 : fy), c.minZ, c.maxX, Math.min(c.y1 != null ? c.y1 : fy + 2.3, fy + 3), c.maxZ]); });
      (s.pick ? s.pick() : []).forEach(function (m) { if (m && m.visible) { var mb = meshBox(m, 8); if (mb) boxes.push(mb); } });
      return proj(boxes);
    },
    // the shown cluster: every visible prompt wrap, as one rect
    cluster: function () {
      var l = 1e9, t = 1e9, r = -1e9, b = -1e9, n = 0, minH = 1e9;
      document.querySelectorAll('#prisonPrompts .wprompt').forEach(function (w) {
        if (w.style.display === 'none' || w.style.visibility === 'hidden') return;
        var q = w.getBoundingClientRect(); if (q.width < 2) return;
        l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); n++;
        var p = w.querySelector('.tpill'); if (p) minH = Math.min(minH, p.getBoundingClientRect().height);
      });
      return n ? { l: l, t: t, r: r, b: b, n: n, minH: minH } : null;
    },
    rectOf: function (el) {
      if (!el) return null;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return null;
      var q = el.getBoundingClientRect(); if (q.width < 2 || q.height < 2) return null;
      return { l: q.left, t: q.top, r: q.right, b: q.bottom, id: el.id || el.className };
    },
    controls: function () {
      var out = [];
      document.querySelectorAll('#touch button, #tstick, #hudPauseBtn, #planBtn, #hotbar, #weaponStrip').forEach(function (el) {
        var r = __geo.rectOf(el); if (r) out.push(r);
      });
      return out;
    },
    area: function (a, b) {
      if (!a || !b) return 0;
      return Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
    },
  };
  return true;
})()`);

// 1b) DESKTOP, LIVE: walking round him and turning the camera, the cluster
// never touches his body (zero intersection px^2, every frame it is shown)
const deskLive = await ev(`(function(){
  var a = window.__inmate; a.ko = 0;
  var frames = 0, shown = 0, hitFrames = 0, maxArea = 0, flips = 0, lastSide = 0, offGlass = 0;
  var base = null;
  for (var k = 0; k < 300; k++) {
    var q = a.group.position;
    if (base === null) base = Math.atan2(CBZ.player.pos.x - q.x, CBZ.player.pos.z - q.z);
    var ang = base + 0.6 * Math.sin(k / 40), d = 1.5 + 0.45 * Math.sin(k / 23);
    var P = CBZ.player.pos;
    P.set(q.x + Math.sin(ang) * d, q.y, q.z + Math.cos(ang) * d);
    if (CBZ.playerChar) CBZ.playerChar.group.position.copy(P);
    CBZ.cam.yaw = Math.atan2(-(q.x - P.x), -(q.z - P.z)) + 0.32 * Math.sin(k / 17);
    CBZ.cam.pitch = -0.05;
    __step(1); frames++;
    var sh = CBZ.prisonPeople.shown();
    var c = __geo.cluster();
    if (!c || !sh || sh.who !== a) continue;
    shown++;
    var B = __geo.body(a);
    var ar = __geo.area(c, B);
    if (ar > 0) hitFrames++;
    maxArea = Math.max(maxArea, Math.round(ar));
    if (c.l < 0 || c.r > innerWidth || c.t < 0 || c.b > innerHeight) offGlass++;
    var side = B ? ((c.l + c.r) / 2 > (B.l + B.r) / 2 ? 1 : -1) : 0;
    if (lastSide && side !== lastSide) flips++;
    lastSide = side;
  }
  return { frames: frames, shown: shown, hitFrames: hitFrames, maxArea: maxArea, flips: flips, offGlass: offGlass };
})()`);
log("  desktop live: " + JSON.stringify(deskLive));
check("desktop live: the cluster is shown on him while walking + turning", deskLive && deskLive.shown >= 150, deskLive);
check("desktop live: ZERO overlap with his body, every frame", deskLive && deskLive.hitFrames === 0 && deskLive.maxArea === 0, deskLive);
check("desktop live: steady (at most 2 side flips in 300 frames), on the glass", deskLive && deskLive.flips <= 2 && deskLive.offGlass === 0, deskLive);

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
  // HARNESS TRAP: the inmate from the trade often stands in the warden's reach and wins the faced test; clear a 4 m ring first
  (CBZ.npcs||[]).concat(CBZ.guards||[]).forEach(function (o) { if (o === w || !o.group) return; var op = o.group.position, wq = w.group.position; if (Math.hypot(op.x - wq.x, op.z - wq.z) < 4) op.set(wq.x + 9, op.y, wq.z + 9); });
  __face(w, 1.4); __step(20);
  var floorV = CBZ.prisonVerbsFor(w);
  var sh = CBZ.prisonPeople.shown();
  return { floor: floorV, shownOnHim: sh && sh.who === w, pills: __pills(), labels: floorV.map(function (v) { return v; }) };
})()`);
log("  warden: " + JSON.stringify(warden));
check("the warden wears more than one verb", warden && warden.floor && warden.floor.length >= 2 && warden.shownOnHim, warden);

// 4b) A DOOR'S VERB IS BESIDE THE DOOR (desktop, live): an open cell front,
// walked across and looked about; the pill never sits on the leaf or its frame
const doorLive = await ev(`(function(){
  var cb = CBZ.cellblock, cells = (cb && cb.cells) || [], c = null;
  for (var i = 0; i < cells.length; i++) if (cells[i].player && !cells[i].tier) { c = cells[i]; break; }
  if (!c) for (var i = 0; i < cells.length; i++) if (!cells[i].tier && cells[i].leafClosed) { c = cells[i]; break; }
  if (!c) return { err: 'no ground cell' };
  var s = (CBZ.prisonDoorList ? CBZ.prisonDoorList() : []).filter(function (x) { return x.id === 'prison-cell-' + c.i; })[0];
  if (!s) return { err: 'no door spec' };
  try { s.set(true); } catch (e) {}
  var shown = 0, hitFrames = 0, maxArea = 0, verbs = {};
  for (var k = 0; k < 200; k++) {
    var P = CBZ.player.pos;
    P.set(c.leafClosed.x + 0.5 * Math.sin(k / 25), c.fy || 0, c.leafClosed.z + 1.5 + 0.25 * Math.sin(k / 31)); CBZ.player.vy = 0;
    if (CBZ.playerChar) CBZ.playerChar.group.position.copy(P);
    CBZ.cam.yaw = 0.22 * Math.sin(k / 19); CBZ.cam.pitch = 0;
    __step(1);
    var sh = CBZ.prisonPromptShown && CBZ.prisonPromptShown();
    if (!sh || sh.id !== 'door') continue;
    var cl = __geo.cluster(); if (!cl) continue;
    shown++; verbs[sh.verb] = 1;
    var ar = __geo.area(cl, __geo.door(s));
    if (ar > 0) hitFrames++;
    maxArea = Math.max(maxArea, Math.round(ar));
  }
  return { door: s.id, shown: shown, hitFrames: hitFrames, maxArea: maxArea, verbs: Object.keys(verbs) };
})()`);
log("  door live: " + JSON.stringify(doorLive));
check("desktop door: its verb is shown at the open cell front", doorLive && doorLive.shown >= 60, doorLive);
check("desktop door: ZERO overlap with the leaf and its frame, every frame", doorLive && doorLive.hitFrames === 0 && doorLive.maxArea === 0, doorLive);

// 5) TOUCH, A REAL PHONE LAYOUT: iPhone landscape (852x393), touch emulated,
// the touch layer switched on by a real touchstart (so the joystick, the
// fire/jump/eye cluster, pause and Plan are the live ones), a belt to carry.
// Nothing on him until he is tapped; then his verbs sit in THE DOCK, and the
// dock never covers a single touch control while you walk and turn.
await send("Emulation.setDeviceMetricsOverride", { width: 852, height: 393, deviceScaleFactor: 1, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await ev(`(function(){ CBZ.econ.addItem('Lighter', 1); CBZ.econ.addItem('Soap', 1); return true; })()`);
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 430, y: 60 }] });
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(300);
const touch = await ev(`(function(){
  var a = window.__inmate; a.ko = 0;
  if (CBZ.prisonPeople) CBZ.prisonPeople.select(null);
  if (window.dispatchEvent) window.dispatchEvent(new Event('resize'));
  __face(a, 1.4); __step(30);
  var before = __pills().length;
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
  // LIVE: walk round him and turn, the dock against every live touch control
  var shown = 0, hitFrames = 0, maxArea = 0, worst = null, minH = 1e9, ctlIds = {}, dockArea = 0, base = null;
  for (var k = 0; k < 240; k++) {
    var q = a.group.position, P = CBZ.player.pos;
    if (base === null) base = Math.atan2(P.x - q.x, P.z - q.z);
    var ang = base + 0.6 * Math.sin(k / 40), d = 1.6 + 0.5 * Math.sin(k / 23);
    P.set(q.x + Math.sin(ang) * d, q.y, q.z + Math.cos(ang) * d);
    if (CBZ.playerChar) CBZ.playerChar.group.position.copy(P);
    CBZ.cam.yaw = Math.atan2(-(q.x - P.x), -(q.z - P.z)) + 0.4 * Math.sin(k / 17);
    __step(1);
    var c = __geo.cluster(); if (!c) continue;
    shown++; minH = Math.min(minH, c.minH); dockArea = Math.max(dockArea, Math.round((c.r - c.l) * (c.b - c.t)));
    var ctl = __geo.controls(), worstHere = 0;
    ctl.forEach(function (o) { ctlIds[o.id] = 1; var ar = __geo.area(c, o); if (ar > worstHere) { worstHere = ar; if (ar > maxArea) worst = o.id; } });
    if (worstHere > 0) hitFrames++;
    maxArea = Math.max(maxArea, Math.round(worstHere));
  }
  var dock = __geo.cluster();
  CBZ.prisonPeople.select(null); __step(3);
  var gone = __pills().length;
  return { before: before, after: after, gone: gone, tapped: tapped, selectedByTap: sel, moved: moved,
    live: { shown: shown, hitFrames: hitFrames, maxArea: maxArea, worst: worst, minPillH: Math.round(minH), dockAreaPx: dockArea, controls: Object.keys(ctlIds) },
    dock: dock && { l: Math.round(dock.l), t: Math.round(dock.t), r: Math.round(dock.r), b: Math.round(dock.b) } };
})()`);
log("  touch: " + JSON.stringify(touch));
check("touch: nothing on him until he is tapped", touch && touch.before === 0, touch && touch.before);
check("touch: a real tap on his body selects him", touch && touch.selectedByTap && touch.moved < 1.0, touch && { sel: touch.selectedByTap, moved: touch.moved });
check("touch: tapped, his verbs show in the dock", touch && touch.after.length >= 3, touch && touch.after);
check("touch: tap elsewhere puts them away", touch && touch.gone === 0, touch && touch.gone);
check("touch live: the dock sees the real controls (stick, cluster, pause)", touch && touch.live.controls.length >= 4, touch && touch.live.controls);
check("touch live: ZERO overlap with every touch control, walking + turning", touch && touch.live.shown >= 150 && touch.live.hitFrames === 0 && touch.live.maxArea === 0, touch && touch.live);
check("touch: tap targets at least 44 px tall", touch && touch.live.minPillH >= 44, touch && touch.live.minPillH);

// 5b) TOUCH GRAB: the hold set swaps into the same dock, still clear of every control
const tgrab = await ev(`(function(){
  var a = window.__inmate; a.ko = 0; __face(a, 1.0); __step(2);
  CBZ.prisonPeople.select(a); __step(2);
  var i = CBZ.prisonVerbsFor(a).indexOf('grab');
  if (i < 0) return { err: 'no grab', v: CBZ.prisonVerbsFor(a) };
  for (var tries = 0; tries < 3 && !(CBZ.grapple && CBZ.grapple.holding()); tries++) {
    __face(a, 1.0); var j = CBZ.prisonVerbsFor(a).indexOf('grab'); if (j >= 0) CBZ.doInteract(j);
    for (var k = 0; k < 200 && !(CBZ.grapple && CBZ.grapple.holding()); k++) __step(1);
  }
  __step(10);
  var held = !!(CBZ.grapple && CBZ.grapple.holding());
  var c = __geo.cluster(), maxArea = 0, worst = null;
  __geo.controls().forEach(function (o) { var ar = __geo.area(c, o); if (ar > maxArea) { maxArea = ar; worst = o.id; } });
  var out = { held: held, verbs: CBZ.prisonVerbsFor(a), pills: __pills(), maxArea: Math.round(maxArea), worst: worst };
  var v = CBZ.prisonVerbsFor(a), s = v.indexOf('h:setDown'); if (s < 0) s = v.indexOf('h:letGo');
  if (s >= 0) CBZ.doInteract(s);
  __step(150);
  CBZ.prisonPeople.select(null); __step(2);
  return out;
})()`);
log("  touch grab: " + JSON.stringify(tgrab));
check("touch grab: the hold set shows in the dock, clear of every control", tgrab && tgrab.held && tgrab.pills.length >= 2 && tgrab.maxArea === 0, tgrab);

// 5c) TOUCH TRADE: Offer/Request/Leave in the dock, the table in the free glass,
// neither on a control
const ttrade = await ev(`(function(){
  var a = window.__inmate; a.ko = 0; __face(a, 1.3); __step(20);
  CBZ.prisonPeople.select(a); __step(2);
  var i = CBZ.prisonVerbsFor(a).indexOf('trade');
  if (i < 0) return { err: 'no trade', v: CBZ.prisonVerbsFor(a) };
  CBZ.econ.addCigs(10);
  CBZ.doInteract(i); __step(3);
  var root = document.getElementById('prisonTrade');
  var acts = __geo.rectOf(root && root.querySelector('.ptr-acts')), card = __geo.rectOf(root && root.querySelector('.ptr-card'));
  var maxActs = 0, maxCard = 0, worst = null;
  __geo.controls().forEach(function (o) {
    var x = __geo.area(acts, o), y = __geo.area(card, o);
    if (x > maxActs) { maxActs = x; worst = 'acts/' + o.id; } if (y > maxCard) { maxCard = y; worst = 'card/' + o.id; }
  });
  var minH = 1e9; root.querySelectorAll('.ptr-act').forEach(function (b) { var r = b.getBoundingClientRect(); if (r.height > 2) minH = Math.min(minH, r.height); });
  var res = { open: CBZ.prisonTrade.isOpen(), touch: CBZ.prisonTrade.audit().touch, acts: acts, card: card,
    actsOnControls: Math.round(maxActs), cardOnControls: Math.round(maxCard), worst: worst, minActH: Math.round(minH),
    actsInCard: Math.round(__geo.area(acts, card)) };
  CBZ.prisonTrade.close(); __step(2);
  return res;
})()`);
log("  touch trade: " + JSON.stringify(ttrade));
check("touch trade: the table opens docked (no sheet over the controls)", ttrade && ttrade.open && ttrade.touch, ttrade);
check("touch trade: its verbs and its table are on no control, 44 px targets", ttrade && ttrade.actsOnControls === 0 && ttrade.cardOnControls === 0 && ttrade.minActH >= 44, ttrade);

check("no console errors after PLAY", errors.length === 0, errors.length);
if (errors.length) {
  const seen = new Map();
  errors.forEach((e) => { const k = String(e).split("\n").slice(0, 3).join(" | ").slice(0, 300); seen.set(k, (seen.get(k) || 0) + 1); });
  [...seen].slice(0, 20).forEach(([k, n]) => log(`   x${n} ${k}`));
}
const failed = results.filter((r) => !r.ok).length;
log(failed ? `PRISON ON-THE-THING: ${failed} FAILED` : "PRISON ON-THE-THING: PASS");
finish(failed ? 1 : 0);
