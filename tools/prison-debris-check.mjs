#!/usr/bin/env node
/* ============================================================
   tools/prison-debris-check.mjs — DOES EVERY PIECE OF PRISON DEBRIS COME OFF
   SOMETHING THAT BROKE?

   Owner, 2026-10-01: "Get rid of fake debris from explosions in the jail
   game." The law (systems/debris.js header, city/crashfx.js CONSERVATION OF
   MATTER): a piece of debris exists only if it was cut out of a mesh that is
   being removed in the same breath, wears that mesh's material, and lands,
   settles and sleeps. Grit and dust off a surface that HELD are allowed and
   are grit-sized.

   Boots index.html?mode=escape headless, presses PLAY, freezes rAF, wraps
   CBZ.debris's entry points to log every spawn, then:

     A. A FRAG ON AN OPEN FLOOR (the shared blast, CBZ.cityBlastCore, kind
        "grenade") in a clear patch of the yard: zero rigid pieces (no
        shatter / shatterBox / pile / adopt), no live bodies, only grit
        (<= 35 mm grain) + dust + smoke, and a scorch mark on the ground.
     B. 5 lb OF C4 IN CONTACT WITH A BREACHABLE WALL (CBZ.contactBreach, the
        verb the brick uses): the wall opens (carve "carved"), pieces arrive,
        and EVERY box-shatter is cut from a mesh the carve removed, in that
        mesh's own material, inside its own bounds. No pile, no invented box.
     C. 5 lb OF C4 ON A RACKED CELL FRONT: the target is defeated, the front
        is open and its collider gone, the leaf is gone from view, and the
        pieces flying are the leaf's own (an Object3D shatter of that mesh;
        the live pieces wear its material). No wall carve on the way.
     D. AFTERMATH: within ~10 s of sim every live piece has slept and baked
        into static rubble, under the device caps; no tracked piece ended
        below the floor it fell on or hanging in the air.

     node tools/prison-debris-check.mjs [--port 9832]
   Exit 0 = pass, 1 = any assertion failed. Node + headless Chrome, no
   screenshots.
============================================================ */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const PORT = Number(opt("--port", 9832));
const DBG = PORT + 1;
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
  "--window-size=1000,640", `--user-data-dir=/tmp/cbz-debris-check-${PORT}`, "about:blank",
], { stdio: "ignore" });

function finish(code) {
  try { chrome.kill("SIGKILL"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  process.exit(code);
}

let wsUrl = null;
for (let i = 0; i < 60 && !wsUrl; i++) {
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
  setTimeout(() => { if (pending.delete(id)) rej(new Error(`CDP timeout: ${method}`)); }, 300000);
});
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r.result && r.result.value;
};

await new Promise((r) => sock.addEventListener("open", r));
await send("Runtime.enable");
await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const nativeRAF = window.requestAnimationFrame.bind(window);
  let left = 1e9;
  window.requestAnimationFrame = function (cb) { return left-- > 0 ? nativeRAF(cb) : 0; };
  window.__dbStopRaf = function (n) { left = n || 0; };
})();` });
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html?mode=escape` });

let ready = false;
for (let i = 0; i < 400 && !ready; i++) {
  await sleep(1000);
  try { ready = await ev("!!(window.CBZ&&CBZ.game&&CBZ.stepSim&&document.getElementById('playBtn'))"); } catch (_) {}
}
if (!ready) { log("FAIL: title card never came up"); errors.slice(0, 10).forEach((e) => log("   " + String(e).split("\n")[0])); finish(1); }
errors.splice(0);

await ev(`(function(){
  if (CBZ.game.mode !== 'escape' && CBZ.setMode) CBZ.setMode('escape');
  window.__dbStopRaf(4);
  document.getElementById('playBtn').click();
  return true;
})()`);
let playing = false;
for (let i = 0; i < 240 && !playing; i++) {
  await sleep(1000);
  try { playing = await ev("CBZ.game.state==='playing'"); } catch (_) {}
}
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail != null ? "  " + JSON.stringify(detail) : ""}`); };
check("PLAY reaches state=playing (escape)", playing);
if (!playing) { errors.slice(0, 15).forEach((e) => log("   " + String(e).split("\n")[0].slice(0, 300))); finish(1); }
await ev("window.__dbStopRaf(0), true");
await sleep(300);
await ev(`(function(){ for (var i=0;i<60;i++) CBZ.stepSim(1/60); return true; })()`);

// ---- instrument CBZ.debris: every spawn is logged with its SOURCE -----------
const inst = await ev(`(function(){
  var D = CBZ.debris; if (!D) return { err: 'no CBZ.debris' };
  var L = window.__dbLog = [];
  function matId(m){ if (Array.isArray(m)) m = m[0]; return m ? m.uuid : null; }
  function wrap(name, rec){
    var f = D[name]; if (typeof f !== 'function') return;
    D[name] = function(){ try { L.push(rec.apply(null, arguments)); } catch (e) { L.push({ fn: name, err: String(e) }); }
      return f.apply(D, arguments); };
  }
  wrap('shatter', function(src, o){
    o = o || {};
    if (src && src.isObject3D) return { fn: 'shatter', kind: 'obj', obj: src.uuid, mats: (function(){ var a=[]; src.traverse(function(q){ if (q.isMesh) a.push(matId(q.material)); }); return a; })(), owner: o.owner || null };
    if (src && src.box) return { fn: 'shatter', kind: 'box', box: src.box, mat: matId(src.material), owner: o.owner || null };
    return { fn: 'shatter', kind: 'other' };
  });
  wrap('shatterBox', function(box, mat, o){ return { fn: 'shatterBox', kind: 'box', box: Object.assign({}, box), mat: matId(mat), owner: (o && o.owner) || null }; });
  wrap('pile', function(o){ return { fn: 'pile', at: o ? [o.x, o.z] : null }; });
  wrap('adopt', function(obj){ return { fn: 'adopt', obj: obj && obj.uuid }; });
  wrap('chips', function(x, y, z, o){ o = o || {}; return { fn: 'chips', size: o.size == null ? null : o.size, count: o.count, kind: o.kind || null }; });
  return { ok: true, stats: D.stats() };
})()`);
check("CBZ.debris instrumented", inst && inst.ok, inst && (inst.err || inst.stats.caps));

const SIM = (n) => ev(`(function(){ for (var i=0;i<${n};i++) CBZ.stepSim(1/60); return true; })()`);
// body tracker: the last pose of every live piece (lowest hull point vs. the
// support under it), sampled while it is still a rigid body
await ev(`(function(){
  window.__dbTrack = new Map();
  window.__dbSample = function(){
    var I = CBZ.debris._internal; if (!I) return 0;
    var live = I.live, n = 0, e, p;
    for (var i = 0; i < live.length; i++) {
      var b = live[i], m = b.mesh; m.updateMatrixWorld(true); e = m.matrixWorld.elements; p = b.pts;
      var low = Infinity, lx = 0, lz = 0;
      for (var k = 0; k < p.length; k += 3) {
        var wy = e[1]*p[k] + e[5]*p[k+1] + e[9]*p[k+2] + e[13];
        if (wy < low) { low = wy; lx = e[0]*p[k] + e[4]*p[k+1] + e[8]*p[k+2] + e[12]; lz = e[2]*p[k] + e[6]*p[k+1] + e[10]*p[k+2] + e[14]; }
      }
      window.__dbTrack.set(b, { x: m.position.x, y: m.position.y, z: m.position.z, low: low, lx: lx, lz: lz, r: b.radius, asleep: !!b.asleep, owner: b.owner });
      n++;
    }
    return n;
  };
  return true;
})()`);
const SIMT = async (frames) => { for (let f = 0; f < frames; f += 6) { await SIM(6); await ev("window.__dbSample()"); } };

// ================= A. FRAG ON AN OPEN FLOOR =================
const spotA = await ev(`(function(){
  var W = CBZ.WORLD.wings, P = CBZ.player.pos, cols = CBZ.colliders || [];
  function clear(x, z, r){ for (var i=0;i<cols.length;i++){ var c=cols[i]; if (c.minX==null) continue;
    var dx = Math.max(c.minX - x, 0, x - c.maxX), dz = Math.max(c.minZ - z, 0, z - c.maxZ);
    if (dx*dx + dz*dz < r*r && (c.y0 == null || c.y0 < 3)) return false; } return true; }
  function noTarget(x, z){ return !(CBZ.breachTargetAt && CBZ.breachTargetAt(x, 1.2, z, 4)); }
  var best = null;
  for (var x = W.x0 + 12; x < W.x1 - 12 && !best; x += 4) for (var z = W.z0 + 12; z < W.z1 - 12 && !best; z += 4) {
    if (Math.hypot(x - P.x, z - P.z) < 22) continue;
    var f = CBZ.floorAt(x, z); if (!(f > -0.3 && f < 0.6)) continue;
    if (!clear(x, z, 6) || !noTarget(x, z)) continue;
    best = { x: x, z: z, floor: +f.toFixed(2) };
  }
  return best;
})()`);
check("found an open floor patch in the yard (6 m clear)", !!spotA, spotA);
if (spotA) {
  const pre = await ev(`(function(){ var a = CBZ.blastFxAudit(); window.__dbLog.length = 0;
    return { marks: a.marks, stats: CBZ.debris.stats() }; })()`);
  await ev(`(function(){ var x=${spotA.x}, z=${spotA.z};
    CBZ.cityBlastCore(x, z, { power: 1, radius: 6, byPlayer: true, kind: 'grenade', y: CBZ.blastSeatY ? CBZ.blastSeatY(x, z) : 1 });
    return true; })()`);
  await SIMT(12);
  const mid = await ev(`(function(){ var a = CBZ.blastFxAudit(); return { puffs: a.puffsLive, marks: a.marks, stats: CBZ.debris.stats() }; })()`);
  await SIMT(180);
  const A = await ev(`(function(){
    var L = window.__dbLog.slice(), by = {};
    L.forEach(function(r){ by[r.fn] = (by[r.fn] || 0) + 1; });
    var sizes = L.filter(function(r){ return r.fn === 'chips'; }).map(function(r){ return r.size; });
    // a PROP the frag really broke (city/props.js cityPropsBlast) sheds itself
    // and is hidden: that is a source. Anything else rigid is invented.
    var invented = L.filter(function(r){
      if (r.fn === 'chips') return false;
      if (r.fn === 'shatter' && r.kind === 'obj') { var o = CBZ.scene.getObjectByProperty('uuid', r.obj); return !!(o && o.visible !== false); }
      return true;
    }).map(function(r){ return r.fn + ':' + (r.kind || ''); });
    var a = CBZ.blastFxAudit();
    return { calls: by, invented: invented, chipSizes: sizes, marks: a.marks, stats: CBZ.debris.stats() };
  })()`);
  log("  A frag: " + JSON.stringify({ pre: pre, mid: mid, A: A }));
  check("A: no rigid chunks off an intact floor (no box/pile/adopt, no shatter of a thing still standing)", A.invented.length === 0, { invented: A.invented, calls: A.calls });
  check("A: no live or new static pieces", A.stats.live === 0 && mid.stats.live === 0 && A.stats.static === pre.stats.static, { live: A.stats.live, midLive: mid.stats.live, static: [pre.stats.static, A.stats.static] });
  check("A: grit only, grit-sized (default grain <= 35 mm)", (A.calls.chips || 0) > 0 && A.chipSizes.every((s) => s == null || s <= 0.035) && mid.stats.grit > pre.stats.grit, { chips: A.calls.chips, sizes: A.chipSizes, grit: [pre.stats.grit, mid.stats.grit] });
  check("A: smoke/dust in the air and a scorch on the floor", mid.puffs > 0 && A.marks > pre.marks, { puffs: mid.puffs, marks: [pre.marks, A.marks] });
}

// ================= B. C4 ON A BREACHABLE WALL =================
const cands = await ev(`(function(){
  var W = CBZ.WORLD.wings, cols = CBZ.colliders || [], out = [];
  for (var i = 0; i < cols.length && out.length < 12; i++) {
    var c = cols[i];
    if (!c.ref || !c.ref.isObject3D || c.noBreach || !c.ref.material || c.ref.material.transparent || c.ref._breached) continue;
    var ex = c.maxX - c.minX, ez = c.maxZ - c.minZ, th = Math.min(ex, ez), sp = Math.max(ex, ez);
    if (th > 0.7 || th < 0.08 || sp < 3) continue;
    var y0 = c.y0 != null ? c.y0 : 0, y1 = c.y1 != null ? c.y1 : 3.2;
    if (y0 > 0.4 || y1 - y0 < 2.2) continue;
    var cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    if (cx < W.x0 || cx > W.x1 || cz < W.z0 || cz > W.z1) continue;
    if (CBZ.breachTargetAt && CBZ.breachTargetAt(cx, 1.2, cz, 3)) continue;
    var alongX = ex >= ez, nx = alongX ? 0 : 1, nz = alongX ? 1 : 0;
    var px = alongX ? cx : c.maxX + 0.06, pz = alongX ? c.maxZ + 0.06 : cz;
    var far = true; for (var k = 0; k < out.length; k++) if (Math.hypot(out[k].x - px, out[k].z - pz) < 12) far = false;
    if (!far) continue;
    out.push({ i: i, x: px, y: y0 + 1.2, z: pz, nx: nx, nz: nz, th: +th.toFixed(2), sp: +sp.toFixed(1) });
  }
  return out;
})()`);
check("found breachable wall candidates inside the wire", cands && cands.length > 0, cands && cands.length);
let B = null;
for (const c of (cands || [])) {
  const r = await ev(`(function(){
    var c = CBZ.colliders[${c.i}], m = c.ref;
    window.__dbLog.length = 0;
    // BEFORE the blast: every solid within 8 m that a carve could take — its
    // mesh's material(s) and its extent (the collider footprint; the height
    // band, or the mesh's own when the collider has none). The carve clips
    // colliders, so this must be read now, not after.
    var snap = [], bx = new THREE.Box3();
    CBZ.colliders.forEach(function(q){
      if (!q.ref || !q.ref.isObject3D || !q.ref.material || q.minX == null) return;
      if (Math.max(q.minX - ${c.x}, 0, ${c.x} - q.maxX) > 8 || Math.max(q.minZ - ${c.z}, 0, ${c.z} - q.maxZ) > 8) return;
      var y0 = q.y0, y1 = q.y1;
      if (y0 == null || y1 == null) { bx.setFromObject(q.ref); y0 = bx.isEmpty() ? -1 : bx.min.y; y1 = bx.isEmpty() ? 99 : bx.max.y; }
      var mt = Array.isArray(q.ref.material) ? q.ref.material.map(function(t){ return t.uuid; }) : [q.ref.material.uuid];
      snap.push({ mats: mt, min: [q.minX, y0, q.minZ], max: [q.maxX, y1, q.maxZ] });
    });
    window.__dbSnap = snap;
    window.__dbWall = m;
    var st0 = CBZ.debris.stats();
    var res = CBZ.contactBreach(${c.x}, ${c.y}, ${c.z}, { lb: 5, contact: true, byPlayer: true, kind: 'c4',
      normal: { x: ${c.nx}, y: 0, z: ${c.nz} }, dir: { x: ${c.nx}, y: 0, z: ${c.nz} } });
    for (var i = 0; i < 4; i++) CBZ.stepSim(1/60);
    var a = CBZ.cityFacadeBreachAudit ? CBZ.cityFacadeBreachAudit() : null;
    return { res: res, carve: a && a.lastCarve, breached: !!m._breached, st0: st0 };
  })()`);
  log(`  B try wall #${c.i} (t ${c.th} m, span ${c.sp} m): ` + JSON.stringify({ result: r.carve && r.carve.result, breached: r.breached, kind: r.res && r.res.kind }));
  if (r.breached) { B = { c, r }; break; }
}
check("B: 5 lb of C4 in contact opens a prison wall", !!B, B && B.r.carve);
if (B) {
  await SIMT(30);
  const Bv = await ev(`(function(){
    var L = window.__dbLog.slice(), by = {};
    L.forEach(function(r){ by[r.fn] = (by[r.fn] || 0) + 1; });
    var rb = window.__dbSnap, wm = window.__dbWall;
    var bad = [], boxes = 0;
    L.forEach(function(r){
      if (r.fn !== 'shatterBox' && !(r.fn === 'shatter' && r.kind === 'box')) return;
      boxes++;
      var b = r.box, ok = rb.some(function(q){
        if (q.mats.indexOf(r.mat) < 0) return false;
        var e = 0.06;
        return b.minX >= q.min[0] - e && b.maxX <= q.max[0] + e && b.minY >= q.min[1] - e && b.maxY <= q.max[1] + e && b.minZ >= q.min[2] - e && b.maxZ <= q.max[2] + e;
      });
      if (!ok) bad.push({ mat: r.mat, box: [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ].map(function(v){ return +v.toFixed(2); }) });
    });
    var objBad = L.filter(function(r){ return r.fn === 'shatter' && r.kind === 'obj'; }).filter(function(r){
      var o = CBZ.scene.getObjectByProperty('uuid', r.obj); return o && o.visible !== false; }).length;
    return { calls: by, boxes: boxes, bad: bad.slice(0, 6), badN: bad.length, solids: rb.length, objBad: objBad, stats: CBZ.debris.stats(),
      wallMat: wm.material && (wm.material.name || wm.material.type), kind: CBZ.debris.kindOf(wm.material, wm) };
  })()`);
  log("  B wall: " + JSON.stringify(Bv));
  check("B: the wall sheds pieces (box-shatters of the carve)", Bv.boxes > 0 && (Bv.stats.live + Bv.stats.static) > B.r.st0.live + B.r.st0.static, { boxes: Bv.boxes, live: Bv.stats.live, static: Bv.stats.static });
  check("B: every piece is cut from a removed mesh, in its material, inside its bounds", Bv.badN === 0 && Bv.objBad === 0, { bad: Bv.bad, objBad: Bv.objBad });
  check("B: no invented heap (pile = 0, adopt = 0)", !(Bv.calls.pile > 0) && !(Bv.calls.adopt > 0), Bv.calls);
}

// ================= C. C4 ON A RACKED CELL FRONT =================
// 23:00, the wing racked: the day plan would slide an open front back open
// (stepped through SIMT so B's pieces keep being sampled while they settle)
for (let i = 0; i < 4; i++) { await ev(`(function(){ if (CBZ.dayPhase) CBZ.dayPhase(${((23 - 6) / 24).toFixed(5)}); return true; })()`); await SIMT(30); }
const Cs = await ev(`(function(){
  var cb = CBZ.cellblock; if (!cb || !cb.cells) return { err: 'no cellblock' };
  var c = null, P = CBZ.player.pos;
  for (var i = 0; i < cb.cells.length; i++) { var k = cb.cells[i];
    if (k.tier || k.player || !k.bars || !k.leafClosed || (k.fy || 0) > 0.5) continue;
    if (Math.hypot(k.x - P.x, k.z - P.z) < 8) continue;
    c = k; break; }
  if (!c) return { err: 'no ground-floor cell' };
  window.__dbCell = c;
  // rack it in THIS turn: the day plan re-opens a front every 0.35 s
  function rack(){ cb.setDoor(c, true, true); c.slide = 0; c.slideT = 0; c.bars.position.x = c.leafClosed.x; c.bars.position.z = c.leafClosed.z; }
  rack();
  window.__dbLog.length = 0;
  var dx = c.leafClosed.x - c.x, dz = c.leafClosed.z - c.z, dl = Math.hypot(dx, dz) || 1;
  var px = c.leafClosed.x + dx / dl * 0.12, pz = c.leafClosed.z + dz / dl * 0.12;
  rack();
  var st0 = CBZ.debris.stats();
  var au = CBZ.breachAudit ? CBZ.breachAudit() : null;
  var dbg = { targets: au && au.targets, near: CBZ.breachTargetAt ? CBZ.breachTargetAt(px, (c.fy || 0) + 1.2, pz, 6) : null,
    at: [+px.toFixed(2), +pz.toFixed(2)], leaf: [+c.leafClosed.x.toFixed(2), +c.leafClosed.z.toFixed(2)], locked: c.locked };
  window.__dbCdbg = dbg;
  var res = CBZ.contactBreach(px, (c.fy || 0) + 1.2, pz, { lb: 5, contact: true, byPlayer: true, kind: 'c4',
    normal: { x: dx / dl, y: 0, z: dz / dl }, dir: { x: dx / dl, y: 0, z: dz / dl } });
  for (var k2 = 0; k2 < 4; k2++) { CBZ.stepSim(1/60); window.__dbSample(); }
  return { cell: c.i, dbg: dbg, res: res, st0: st0 };
})()`);
log("  C cell: " + JSON.stringify(Cs));
if (Cs && !Cs.err) {
  await SIMT(30);
  const Cv = await ev(`(function(){
    var c = window.__dbCell, L = window.__dbLog.slice(), by = {};
    L.forEach(function(r){ by[r.fn] = (by[r.fn] || 0) + 1; });
    var mat = c.bars.material, mu = (Array.isArray(mat) ? mat[0] : mat).uuid;
    var leafCalls = L.filter(function(r){ return r.fn === 'shatter' && r.kind === 'obj' && r.obj === c.bars.uuid; }).length;
    var boxes = L.filter(function(r){ return r.fn === 'shatterBox' || (r.fn === 'shatter' && r.kind === 'box'); }).length;
    var own = 0, other = 0;
    CBZ.debris._internal.live.forEach(function(b){ if (b.owner !== 'door:prison-cell-' + c.i) return;
      var ms = Array.isArray(b.mesh.material) ? b.mesh.material : [b.mesh.material];
      if (ms.some(function(q){ return q && q.uuid === mu; })) own++; else other++; });
    var colIn = (CBZ.colliders || []).indexOf(c.doorCol) >= 0;
    return { calls: by, leafCalls: leafCalls, boxes: boxes, blown: !!c.blown, locked: !!c.locked, leafVisible: c.bars.visible !== false,
      colIn: colIn, ownPieces: own, otherPieces: other, stats: CBZ.debris.stats(),
      kind: CBZ.debris.kindOf(c.bars.material, c.bars) };
  })()`);
  log("  C front: " + JSON.stringify(Cv));
  check("C: the charge defeats the racked front (target opened)", Cs.res && Cs.res.opened && Cs.res.kind === "target" && Cv.blown && !Cv.locked && !Cv.colIn, { res: Cs.res, blown: Cv.blown, locked: Cv.locked, colIn: Cv.colIn });
  check("C: the leaf is gone from view and threw ITS OWN pieces", !Cv.leafVisible && Cv.leafCalls === 1 && Cv.ownPieces > 0 && Cv.otherPieces === 0, { leafVisible: Cv.leafVisible, leafCalls: Cv.leafCalls, own: Cv.ownPieces, other: Cv.otherPieces });
  check("C: the leaf came apart as steel, and no wall was carved for it", Cv.kind === "metal" && Cv.boxes === 0 && !(Cv.calls.pile > 0), { kind: Cv.kind, boxes: Cv.boxes, calls: Cv.calls });
} else check("C: a ground-floor cell to rack and blow", false, Cs);

// ================= D. AFTERMATH =================
let D = null;
for (let s = 0; s < 12; s++) {
  await SIMT(60);
  D = await ev(`(function(){ var s = CBZ.debris.stats(); return { live: s.live, asleep: s.asleep, static: s.static, grit: s.grit, caps: s.caps, device: s.device }; })()`);
  if (D.live === 0) break;
}
log("  D settle: " + JSON.stringify(D));
check("D: every piece settled, slept and baked (live 0)", D && D.live === 0, D);
check("D: rubble within the device caps", D && D.static <= D.caps.static && D.grit <= D.caps.grit, D && { static: D.static, grit: D.grit, caps: D.caps });
const Dp = await ev(`(function(){
  var cols = CBZ.colliders || [], bad = [], n = 0;
  window.__dbTrack.forEach(function(t){
    n++;
    // the support the sim itself reads (centre) and the one under the lowest
    // corner: a piece lying across a bunk edge rests on the bunk
    var sup = Math.max(CBZ.floorAt(t.lx, t.lz, t.y + t.r), CBZ.floorAt(t.x, t.z, t.y + t.r));
    for (var i = 0; i < cols.length; i++) { var c = cols[i]; if (c.y1 == null) continue;
      // a collider top under the corner or the centre, below the centre (the
      // same test debris.js supportUnder makes)
      var inC = !(t.lx < c.minX || t.lx > c.maxX || t.lz < c.minZ || t.lz > c.maxZ) || !(t.x < c.minX || t.x > c.maxX || t.z < c.minZ || t.z > c.maxZ);
      if (!inC) continue;
      if (c.y1 <= t.y + 0.05 && c.y1 > sup) { sup = c.y1; t.on = [c.minX, c.maxX, c.minZ, c.maxZ, c.y0, c.y1].map(function(v){ return v == null ? null : +(+v).toFixed(2); }); } }
    var under = t.low < sup - 0.12, hung = t.low > sup + 1.2;
    if (under || hung) bad.push({ low: +t.low.toFixed(2), cy: +t.y.toFixed(2), sup: +sup.toFixed(2), at: [+t.lx.toFixed(1), +t.lz.toFixed(1)], owner: t.owner, asleep: t.asleep });
  });
  return { tracked: n, bad: bad.length, sample: bad.slice(0, 6) };
})()`);
log("  D poses: " + JSON.stringify(Dp));
check("D: no piece came to rest under its floor or hanging in the air", Dp.tracked > 0 && Dp.bad === 0, Dp);

check("no console errors after PLAY", errors.length === 0, errors.length);
if (errors.length) {
  const seen = new Map();
  errors.forEach((e) => { const k = String(e).split("\n").slice(0, 2).join(" | ").slice(0, 260); seen.set(k, (seen.get(k) || 0) + 1); });
  [...seen].slice(0, 20).forEach(([k, n]) => log(`   x${n} ${k}`));
}
const failed = results.filter((r) => !r.ok).length;
log(failed ? `PRISON DEBRIS: ${failed} FAILED` : "PRISON DEBRIS: PASS");
finish(failed ? 1 : 0);
