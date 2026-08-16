#!/usr/bin/env node
/* tools/prison-doors-check.mjs — CAN YOU SHUT IT? the close-verb gate.

   OWNER (verbatim): "all doors should open or close when pressed. I like auto
   open, don't remove, but I want ability to close. Of course still needing
   key. This is really mostly adding CLOSE BY TAP ON MOBILE, no button needed."

   Before this wave every door in the compound was a one-way valve: five files
   own a door primitive and between them they published ONE public close
   (CBZ.closeDoor), which only systems/lockdown.js and the run reset called.
   Measured on bfaccbd, CBZ.prisonDoorAudit did not exist and closeable read 0.

   Everything below is live state, never pixels:

     1. THE REGISTRY IS THE WHOLE COMPOUND. Every door primitive declares into
        CBZ._prisonDoorSpecs — the yard leaf, the nine wing leaves, the two
        admin leaves, the armoury gate and its cage, the thirteen cell fronts.
        27 doors, and the audit's `closeable` is the number that was 0.
     2. A TAP SHUTS IT. Fired through CBZ.cityTapWorld(x, y) — the documented
        headless hook, i.e. the same function a finger reaches — at the leaf's
        own projected screen position, not at a synthetic API call. Then the
        COLLIDER must be back in CBZ.colliders, because a door that is "closed"
        with no collider is a picture of a door.
     3. THE LATCH HOLDS (LAW 3). Shut a door while standing INSIDE the radius
        that auto-opens it, then run 5 simulated seconds without moving. It
        must still be shut. Getting this wrong is what makes the feature look
        broken, so it is a number here.
     4. IT STILL NEEDS THE KEY. Drop the keycard and tap an open sally gate:
        it must stay open. You may only shut what you could have opened.
     5. A BLOWN DOOR NEVER COMES BACK (LAW 4), and neither does the console
        release: both report "gone" and the leaf stays open.
     6. AUTO-OPEN SURVIVED ALL OF IT. Walk away, walk back with the card: the
        latch has cleared and the door opens on approach exactly as before.

   Boot boilerplate copied from tools/prison-polish-check.mjs (itself
   jail-check's, itself math-gate's), including the macOS Chrome fallback.
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 8930 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const base = `http://127.0.0.1:${port}/`;
const dbg = 9930 + Math.floor(Math.random() * 40);
const profile = `/tmp/cbz-doors-${dbg}`;
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

for (let i = 0; i < 90; i++) { if (await evl("return !!(window.CBZ && CBZ.bootComplete && CBZ.game)")) break; await sleep(500); }
let playing = false;
for (let i = 0; i < 40 && !playing; i++) {
  await evl("try{CBZ.setMode('escape'); CBZ.startRun && CBZ.startRun();}catch(e){return String(e);} return true;");
  await sleep(500);
  playing = await evl("return !!(CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='escape');");
}
console.log("playing(escape):", playing);
if (!playing) { console.log("ERRORS:", [...new Set(errors)].slice(0, 10)); done(2); }

const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond, detail }); console.log((cond ? "  ok  " : "FAIL  ") + name + (detail != null ? "  " + detail : "")); }
function bad(r) { return !r || typeof r !== "object" || r.__err != null; }
function why(r) { return (r && r.__err) ? ("threw: " + String(r.__err).split("\n")[0]) : JSON.stringify(r); }
const step = (n) => evl(`for(var i=0;i<${n | 0};i++) CBZ.stepSim(1/60); return true;`);

/* THE ONE HELPER EVERY BEAT USES. Installed in the page so each probe is a
   short expression rather than a copy of the projection maths.

   tapDoor(id) does what a thumb does: stand the player at the door, put the
   camera at his eye height, look at the CENTRE OF THE LEAF WHERE IT ACTUALLY
   IS (an open pivot leaf has swung a metre out of its own doorway — aiming at
   the doorway would hit nothing and prove nothing), project that point to
   screen pixels and hand those pixels to CBZ.cityTapWorld. */
await evl(`
  window.__doors = {
    spec: function (id) {
      var L = CBZ.prisonDoorList ? CBZ.prisonDoorList() : [];
      for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
      return null;
    },
    colliderIn: function (id) {
      // the leaf's OWN collider, named by the spec (spec.col) rather than
      // guessed from its meshes: a cell front's collider is the face rect
      // world/cellblock.js splices, which is not the sliding bar mesh.
      var s = window.__doors.spec(id); if (!s || !s.col) return -1;
      var c = s.col(); if (!c) return -1;
      return CBZ.colliders.indexOf(c) >= 0 ? 1 : 0;
    },
    stand: function (id, dx, dz) {
      var s = window.__doors.spec(id); if (!s) return null;
      var p = s.at();
      CBZ.player.pos.set(p.x + (dx || 0), 0, p.z + (dz || 0));
      CBZ.player.vy = 0;
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
      return { x: CBZ.player.pos.x, z: CBZ.player.pos.z };
    },
    tap: function (id) {
      var s = window.__doors.spec(id); if (!s) return "no-spec";
      var box = new THREE.Box3(), meshes = s.pick();
      box.makeEmpty();
      for (var i = 0; i < meshes.length; i++) { meshes[i].updateWorldMatrix(true, true); box.expandByObject(meshes[i]); }
      var c = box.getCenter(new THREE.Vector3());
      var cam = CBZ.camera;
      cam.position.set(CBZ.player.pos.x, CBZ.player.pos.y + 1.6, CBZ.player.pos.z);
      cam.lookAt(c);
      cam.updateMatrixWorld(true);
      var v = c.clone().project(cam);
      var r = CBZ.renderer.domElement.getBoundingClientRect();
      var sx = r.left + (v.x * 0.5 + 0.5) * r.width, sy = r.top + (-v.y * 0.5 + 0.5) * r.height;
      var took = CBZ.cityTapWorld(sx, sy);
      return { took: !!took, sx: Math.round(sx), sy: Math.round(sy), open: !!s.isOpen(), latch: !!s._latch };
    },
  };
  return true;
`);

// ---- 1. THE REGISTRY IS THE WHOLE COMPOUND -------------------------------
{
  const r = await evl(`
    if (!CBZ.prisonDoorAudit) return { missing: true };
    var a = CBZ.prisonDoorAudit();
    var ids = a.rows.map(function (x) { return x.id; });
    var fam = function (p) { return ids.filter(function (i) { return i.indexOf(p) === 0; }).length; };
    return { doors: a.doors, open: a.open, closeable: a.closeable,
      yard: ids.indexOf("prison-yard-door") >= 0 ? 1 : 0,
      sally: fam("prison-sally"), cages: fam("prison-tool-crib") + fam("prison-knife-cage") + fam("prison-property"),
      admin: fam("prison-admin-staff") + fam("prison-warden-office"),
      armoury: fam("prison-armory"), cells: fam("prison-cell-"),
      control: fam("prison-control") + fam("prison-segregation"),
      dupes: ids.length - new Set(ids).size };
  `);
  if (bad(r) || r.missing) check("registry: the shared door registry exists", false, why(r));
  else {
    check("registry: every family of door declares a close verb",
      r.yard === 1 && r.sally === 4 && r.cages === 3 && r.admin === 2 && r.armoury === 2 && r.cells >= 13 && r.control === 2,
      JSON.stringify(r));
    check("registry: no door is declared twice", r.dupes === 0, "dupes=" + r.dupes);
    check("registry: 27 doors in the compound expose the verb", r.doors >= 27, "doors=" + r.doors);
  }
}

// ---- 2. A TAP SHUTS IT, AND THE COLLIDER COMES BACK ----------------------
// Four door TYPES, one per primitive: the vertical yard leaf, a wing pivot
// gate, the armoury's vertical gate, a sliding cell front.
const TAPPED = [
  { id: "prison-yard-door", label: "the yard checkpoint (vertical slide)", key: true, stand: [0, 1.2] },
  { id: "prison-sally-w1", label: "a sally gate (pivot leaf)", key: true, stand: [1.2, 0] },
  { id: "prison-armory", label: "the armoury gate (vertical slide)", key: true, stand: [-1.6, 0] },
  { id: "prison-cell-0", label: "a cell front (slider)", key: false, stand: [0, 1.0] },
];
for (const d of TAPPED) {
  const r = await evl(`
    var s = window.__doors.spec(${JSON.stringify(d.id)});
    if (!s) return { no: true };
    CBZ.game.hasKey = true;                     // the credential the OPEN path wants
    window.__doors.stand(${JSON.stringify(d.id)}, ${d.stand[0]}, ${d.stand[1]});
    // open it the way the game does, then let the leaf finish travelling
    var opened = CBZ.prisonDoorSet(${JSON.stringify(d.id)}, true);
    for (var i = 0; i < 90; i++) CBZ.stepSim(1/60);
    var mid = { open: !!s.isOpen(), col: window.__doors.colliderIn(${JSON.stringify(d.id)}) };
    var tap = window.__doors.tap(${JSON.stringify(d.id)});
    for (var j = 0; j < 60; j++) CBZ.stepSim(1/60);
    return { opened: opened, mid: mid, tap: tap,
      after: { open: !!s.isOpen(), col: window.__doors.colliderIn(${JSON.stringify(d.id)}), latch: !!s._latch } };
  `);
  if (bad(r) || r.no) check("tap: " + d.label, false, why(r));
  else {
    check("tap: " + d.label + " was open with its collider out",
      r.mid.open === true && r.mid.col === 0, JSON.stringify(r.mid));
    check("tap: " + d.label + " SHUTS on a synthesized world tap",
      r.tap && r.tap.took === true && r.after.open === false, JSON.stringify(r.tap));
    check("tap: " + d.label + " puts its collider back",
      r.after.col === 1, JSON.stringify(r.after));
  }
}

// ---- 3. THE LATCH HOLDS WHILE YOU STAND IN THE AUTO-OPEN RADIUS ----------
// The failure this exists for: shut the gate, the approach-open notices you
// are still standing on the reader, and re-opens it in the next frame.
for (const d of [
  { id: "prison-yard-door", label: "the yard checkpoint", stand: [0, 1.2] },
  { id: "prison-sally-w1", label: "a sally gate", stand: [1.2, 0] },
  { id: "prison-armory", label: "the armoury gate", stand: [-1.6, 0] },
]) {
  const r = await evl(`
    var s = window.__doors.spec(${JSON.stringify(d.id)});
    CBZ.game.hasKey = true;
    window.__doors.stand(${JSON.stringify(d.id)}, ${d.stand[0]}, ${d.stand[1]});
    CBZ.prisonDoorSet(${JSON.stringify(d.id)}, true);
    for (var i = 0; i < 60; i++) CBZ.stepSim(1/60);
    var tap = window.__doors.tap(${JSON.stringify(d.id)});
    var samples = [];
    // 5 simulated seconds without moving, INSIDE the radius that opened it
    for (var t = 0; t < 5; t++) {
      window.__doors.stand(${JSON.stringify(d.id)}, ${d.stand[0]}, ${d.stand[1]});
      for (var k = 0; k < 60; k++) CBZ.stepSim(1/60);
      samples.push(!!s.isOpen());
    }
    var p = s.at(), dx = CBZ.player.pos.x - p.x, dz = CBZ.player.pos.z - p.z;
    return { tap: tap, samples: samples, latch: !!s._latch,
      dist: +Math.hypot(dx, dz).toFixed(2), autoR: s.autoR };
  `);
  if (bad(r)) check("latch: " + d.label, false, why(r));
  else {
    check("latch: " + d.label + " stays shut for 5 s inside its own auto-open radius",
      r.tap.took === true && r.samples.every((v) => v === false) && r.dist <= r.autoR,
      JSON.stringify({ samples: r.samples, dist: r.dist, autoR: r.autoR, latch: r.latch }));
  }
}

// ---- 3b. THE KEY DOES WHAT THE TAP DOES ---------------------------------
// systems/interactions.js's polled [E] and touch.js's tapWorld end in the same
// doorAct(). Held down it must act ONCE — the door's auto-open is still live,
// so a level-triggered verb would flap the leaf at 60 Hz.
{
  const r = await evl(`
    var id = "prison-sally-w2", s = window.__doors.spec(id);
    CBZ.game.hasKey = true;
    window.__doors.stand(id, 1.2, 0);
    CBZ.prisonDoorSet(id, true);
    for (var i = 0; i < 30; i++) CBZ.stepSim(1/60);
    var wasOpen = !!s.isOpen();
    // face the leaf: the key path requires the door to be in front of you
    var p = s.at(), dx = p.x - CBZ.player.pos.x, dz = p.z - CBZ.player.pos.z;
    CBZ.cam.yaw = Math.atan2(-dx, -dz);
    var flips = 0, was = wasOpen;
    CBZ.keys["e"] = true;
    for (var k = 0; k < 180; k++) {                 // three seconds HELD
      window.__doors.stand(id, 1.2, 0);
      CBZ.cam.yaw = Math.atan2(-dx, -dz);
      CBZ.stepSim(1/60);
      if (!!s.isOpen() !== was) { flips++; was = !!s.isOpen(); }
    }
    CBZ.keys["e"] = false;
    return { wasOpen: wasOpen, flips: flips, open: !!s.isOpen(), latch: !!s._latch };
  `);
  if (bad(r)) check("key: [E] closes the door you are facing", false, why(r));
  else check("key: [E] shuts it once and a HELD key never flaps it",
    r.wasOpen === true && r.open === false && r.flips === 1, JSON.stringify(r));
}

// ---- 4. IT STILL NEEDS THE KEY ------------------------------------------
{
  const r = await evl(`
    var id = "prison-sally-e1", s = window.__doors.spec(id);
    CBZ.game.hasKey = true;
    window.__doors.stand(id, 1.2, 0);
    CBZ.prisonDoorSet(id, true);
    for (var i = 0; i < 60; i++) CBZ.stepSim(1/60);
    var wasOpen = !!s.isOpen();
    CBZ.game.hasKey = false; CBZ.game.role = "inmate";     // drop the card
    var verdict = CBZ.prisonDoorToggle(id);
    var tap = window.__doors.tap(id);
    CBZ.game.hasKey = true;
    return { wasOpen: wasOpen, verdict: verdict, tap: tap, stillOpen: !!s.isOpen() };
  `);
  if (bad(r)) check("credential: a card door refuses a man with no card", false, why(r));
  else check("credential: a man with no keycard cannot shut a sally gate",
    r.wasOpen === true && r.verdict === "denied" && r.stillOpen === true, JSON.stringify(r));
}

// ---- 5. A BLOWN DOOR DOES NOT CLOSE (LAW 4) -----------------------------
{
  const r = await evl(`
    var s = window.__doors.spec("prison-yard-door");
    CBZ.game.hasKey = true;
    window.__doors.stand("prison-yard-door", 0, 1.2);
    CBZ.prisonDoorSet("prison-yard-door", true);
    for (var i = 0; i < 30; i++) CBZ.stepSim(1/60);
    CBZ.door.blown = true;                                  // what the charge leaves behind
    var verdict = CBZ.prisonDoorToggle("prison-yard-door");
    var tap = window.__doors.tap("prison-yard-door");
    var open = !!s.isOpen();
    CBZ.door.blown = false;
    return { verdict: verdict, tap: tap, open: open };
  `);
  if (bad(r)) check("blown: a hole is not a door", false, why(r));
  else check("blown: a breached leaf reports gone and stays open",
    r.verdict === "gone" && r.open === true, JSON.stringify(r));
}

// ---- 6. AUTO-OPEN SURVIVED IT -------------------------------------------
// Walk out of the radius (the latch releases), walk back in with the card, and
// the door must open on approach with nothing pressed — the behaviour the
// owner explicitly asked not to lose.
for (const d of [
  { id: "prison-yard-door", label: "the yard checkpoint", stand: [0, 1.2], away: [0, 24] },
  { id: "prison-sally-w1", label: "a sally gate", stand: [1.2, 0], away: [22, 0] },
]) {
  const r = await evl(`
    var id = ${JSON.stringify(d.id)}, s = window.__doors.spec(id);
    CBZ.game.hasKey = true;
    window.__doors.stand(id, ${d.stand[0]}, ${d.stand[1]});
    CBZ.prisonDoorSet(id, true);
    for (var i = 0; i < 30; i++) CBZ.stepSim(1/60);
    window.__doors.tap(id);
    var shut = !s.isOpen(), latched = !!s._latch;
    window.__doors.stand(id, ${d.away[0]}, ${d.away[1]});   // walk away
    for (var j = 0; j < 90; j++) { window.__doors.stand(id, ${d.away[0]}, ${d.away[1]}); CBZ.stepSim(1/60); }
    var cleared = !s._latch, stillShut = !s.isOpen();
    window.__doors.stand(id, ${d.stand[0]}, ${d.stand[1]});  // and walk back
    for (var k = 0; k < 120; k++) { CBZ.stepSim(1/60); if (s.isOpen()) break; }
    return { shut: shut, latched: latched, cleared: cleared, stillShut: stillShut, reopened: !!s.isOpen() };
  `);
  if (bad(r)) check("auto-open: " + d.label, false, why(r));
  else check("auto-open: " + d.label + " still opens on approach after a manual close",
    r.shut === true && r.latched === true && r.cleared === true && r.stillShut === true && r.reopened === true,
    JSON.stringify(r));
}

// ---- 7. THE NUMBER THE OWNER ASKED FOR ----------------------------------
{
  const r = await evl(`
    CBZ.game.hasKey = true;
    var a = CBZ.prisonDoorAudit();
    // open every door the player holds the credential for, then count again
    var L = CBZ.prisonDoorList(), opened = 0;
    for (var i = 0; i < L.length; i++) if (CBZ.prisonDoorSet(L[i].id, true) === "opened") opened++;
    for (var t = 0; t < 30; t++) CBZ.stepSim(1/60);
    var b = CBZ.prisonDoorAudit();
    return { before: { doors: a.doors, closeable: a.closeable }, opened: opened,
      after: { doors: b.doors, open: b.open, closeable: b.closeable, credentialed: b.credentialed } };
  `);
  if (bad(r)) check("audit: the compound reports its close verbs", false, why(r));
  /* Why `open` is not 27 and must not be asserted as such: the wing and admin
     ticks shut their own leaves behind whoever went through (a WINDOW, never
     a permanent hole), and this probe opens them from across the map with
     nobody near, so their 3 s hold expires on the very next tick. The honest
     invariant is the equality — of the doors that ARE open, the player can
     shut every single one he holds the credential for. It read 0 before this
     wave, because CBZ.prisonDoorAudit did not exist and nor did the verb. */
  else check("audit: every door the player may open, he may also shut",
    r.after.closeable === r.after.open && r.after.open >= 13,
    JSON.stringify(r));
}

// ---- summary -------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
const noise = [...new Set(errors)].filter((e) => !/ProgressEvent/.test(e) && !/computeBoundingSphere/.test(e));
console.log("");
console.log(`PRISON-DOORS: ${results.length - failed.length}/${results.length} ok` + (noise.length ? ` | ${noise.length} console errors` : ""));
if (noise.length) console.log("ERRORS: " + noise.slice(0, 8).join(" | "));
if (failed.length) { console.log("FAILED: " + failed.map((f) => f.name).join(" | ")); done(1); }
console.log("PRISON-DOORS: ok");
done(0);
