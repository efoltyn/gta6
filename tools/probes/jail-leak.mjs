/* tools/probes/jail-leak.mjs — DOES A JAIL RUN GROW WHILE YOU PLAY?

   Owner report: the prison loads fast, then a phone tab dies mid-play
   ("memory overload"). The device is the detector: something allocated per
   frame / per hit / per death is never handed back. This plays the real
   escape world for --blocks x 10 s of sim (the real loop: CBZ.stepSim + a
   drawn frame every few steps so render-path work runs too):
     - the player walks from inmate to inmate across the block (cells, yard,
       corridors), guards and inmates doing whatever they do,
     - the nearest inmate is set on the player (requestInmateHunt),
     - the player punches whoever is in front, and stabs one man to death
       per block (blood, gore, corpses, ragdolls, sounds, the law).
   After each block: forced GC, then JS heap (CDP Runtime.getHeapUsage),
   three.js renderer.info (geometries / textures / programs), scene node
   count, unique materials/geometries in the scene, DOM nodes, and every
   top-level CBZ array / Map / Set. Anything that climbs block after block
   once the first two blocks paid for their caches is a leak.

     node tools/testbus/standalone.mjs tools/probes/jail-leak.mjs [--blocks 12] [--render-every 30] [--track] [--sample] [--phone]

   Exit 0 = flat, 1 = something grew every block (named in the report). */
export const meta = { world: "escape", fresh: true, dirties: true, timeoutMs: 40 * 60e3 };

const SNAP = `
  var R = CBZ.renderer, out = { lists: {}, maps: {} };
  try { CBZ.renderFrame(); } catch (e) {}
  var info = R && R.info;
  out.geo = info ? info.memory.geometries : -1;
  out.tex = info ? info.memory.textures : -1;
  out.prog = info && info.programs ? info.programs.length : -1;
  var n = 0, mats = new Set(), geos = new Set();
  CBZ.scene.traverse(function (o) { n++;
    if (o.geometry) geos.add(o.geometry);
    if (o.material) { if (Array.isArray(o.material)) o.material.forEach(function (m) { mats.add(m); }); else mats.add(o.material); } });
  out.nodes = n; out.mats = mats.size; out.geos = geos.size;
  out.dom = document.getElementsByTagName("*").length;
  out.updaters = CBZ.updaters.length; out.always = CBZ.always.length;
  out.npcs = (CBZ.npcs || []).length;
  out.dead = (CBZ.npcs || []).filter(function (c) { return c && c.dead; }).length;
  var seen = new Set();
  for (var k in CBZ) {
    var v; try { v = CBZ[k]; } catch (e) { continue; }
    if (!v || typeof v !== "object" || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) out.lists[k] = v.length;
    else if (v instanceof Map || v instanceof Set) out.maps[k] = v.size;
  }
  return out;
`;


/* GPU ORPHAN TRACKER (installed after boot). three r128's WebGLGeometries /
   WebGLTextures subscribe to an object's "dispose" event the first time they
   upload it, and keep it (by id) until that event fires. So: every object
   that gets that subscription is recorded; one that later leaves every
   reachable place (the scene, the camera) without dispose() is an orphan the
   renderer holds forever, heap and GPU both. Each is tagged with the stack
   that built it (first setAttribute / first needsUpdate=true). */
const TRACK = `
  if (window.__gt) return true;
  var GT = window.__gt = { geo: new Set(), tex: new Set(), stk: new WeakMap() };
  function where() { var s = (new Error().stack || "").split("\\n").slice(3)
      .filter(function (l) { return !/three\\.r128|__gt|<anonymous>/.test(l); }).slice(0, 3)
      .map(function (l) { return l.replace(/^\\s*at\\s*/, "").replace(/https?:\\/\\/[^/]+\\//, "").replace(/\\?v=[^:]*/, ""); });
    return s.join(" < "); }
  var BG = THREE.BufferGeometry.prototype, sa = BG.setAttribute, si = BG.setIndex;
  BG.setAttribute = function (n, a) { if (!GT.stk.has(this)) GT.stk.set(this, where()); return sa.apply(this, arguments); };
  BG.setIndex = function () { if (!GT.stk.has(this)) GT.stk.set(this, where()); return si.apply(this, arguments); };
  var ael = BG.addEventListener;
  BG.addEventListener = function (type, fn) { if (type === "dispose") GT.geo.add(this); return ael.apply(this, arguments); };
  var rel = BG.removeEventListener;
  BG.removeEventListener = function (type, fn) { if (type === "dispose") GT.geo.delete(this); return rel.apply(this, arguments); };
  var TP = THREE.Texture.prototype;
  var d = Object.getOwnPropertyDescriptor(TP, "needsUpdate");
  if (d && d.set) Object.defineProperty(TP, "needsUpdate", { configurable: true, get: d.get,
    set: function (v) { if (v && !GT.stk.has(this)) GT.stk.set(this, where()); d.set.call(this, v); } });
  var tael = TP.addEventListener, trel = TP.removeEventListener;
  TP.addEventListener = function (type, fn) { if (type === "dispose") GT.tex.add(this); return tael.apply(this, arguments); };
  TP.removeEventListener = function (type, fn) { if (type === "dispose") GT.tex.delete(this); return trel.apply(this, arguments); };
  // canvases made after this point (iOS counts every backing store)
  GT.cv = []; var ce = document.createElement;
  document.createElement = function (tag) { var el = ce.apply(this, arguments);
    if (String(tag).toLowerCase() === "canvas") GT.cv.push({ r: new WeakRef(el), s: where() }); return el; };
  // GL bytes created after this point and not yet deleted (memscope's hook, net of deletes)
  var OBJ = new WeakMap(); GT.gl = { buf: 0, tex: 0, rb: 0, nbuf: 0, ntex: 0, nrb: 0 };
  function setB(o, k, key, b) { if (!o) return; var r = OBJ.get(o); if (!r) { r = { k: k, t: 0, p: {} }; OBJ.set(o, r); GT.gl["n" + k]++; }
    var old = r.p[key] || 0; r.p[key] = b; r.t += b - old; GT.gl[k] += b - old; }
  function freeB(o) { var r = o && OBJ.get(o); if (!r) return; GT.gl[r.k] -= r.t; GT.gl["n" + r.k]--; OBJ.delete(o); }
  [window.WebGLRenderingContext, window.WebGL2RenderingContext].forEach(function (C) { if (!C) return; var P = C.prototype;
    function W(n, f) { var o = P[n]; if (!o) return; P[n] = function () { var r = o.apply(this, arguments); try { f.call(this, arguments); } catch (e) {} return r; }; }
    W("bindBuffer", function (a) { (this.__bb || (this.__bb = {}))[a[0]] = a[1]; });
    W("bufferData", function (a) { var d = a[1]; setB(this.__bb && this.__bb[a[0]], "buf", "d", typeof d === "number" ? d : (d ? d.byteLength : 0)); });
    W("deleteBuffer", function (a) { freeB(a[0]); }); W("deleteTexture", function (a) { freeB(a[0]); }); W("deleteRenderbuffer", function (a) { freeB(a[0]); });
    W("activeTexture", function (a) { this.__u = a[0]; });
    W("bindTexture", function (a) { var tb = this.__tb || (this.__tb = {}); (tb[this.__u || 33984] || (tb[this.__u || 33984] = {}))[a[0] >= 34069 && a[0] <= 34074 ? 34067 : a[0]] = a[1]; });
    function bound(gl, t) { var tb = gl.__tb && gl.__tb[gl.__u || 33984]; return tb && tb[t >= 34069 && t <= 34074 ? 34067 : t]; }
    W("texImage2D", function (a) { var w, h, s; if (a.length === 6) { s = a[5]; w = s && (s.naturalWidth || s.videoWidth || s.width) || 0; h = s && (s.naturalHeight || s.videoHeight || s.height) || 0; } else { w = a[3]; h = a[4]; }
      setB(bound(this, a[0]), "tex", a[0] + ":" + a[1], w * h * 4); });
    W("texStorage2D", function (a) { setB(bound(this, a[0]), "tex", "s", a[3] * a[4] * 4 * (a[1] > 1 ? 4 / 3 : 1)); });
    W("bindRenderbuffer", function (a) { this.__rb = a[1]; });
    W("renderbufferStorage", function (a) { setB(this.__rb, "rb", "s", a[2] * a[3] * 4); });
    W("renderbufferStorageMultisample", function (a) { setB(this.__rb, "rb", "s", a[3] * a[4] * 4 * Math.max(1, a[1])); });
  });
  return true;
`;

const ORPHANS = `
  var GT = window.__gt; if (!GT) return null;
  var live = new Set(), tlive = new Set();
  function texOf(m) { if (!m) return; for (var k in m) { var v = m[k]; if (v && v.isTexture) tlive.add(v); }
    if (m.uniforms) for (var u in m.uniforms) { var x = m.uniforms[u] && m.uniforms[u].value; if (x && x.isTexture) tlive.add(x); } }
  function walk(root) { root.traverse(function (o) { if (o.geometry) live.add(o.geometry);
    var M = o.material; if (Array.isArray(M)) M.forEach(texOf); else texOf(M); if (o.skeleton && o.skeleton.boneTexture) tlive.add(o.skeleton.boneTexture); }); }
  walk(CBZ.scene); if (CBZ.camera) walk(CBZ.camera);
  if (CBZ.scene.background && CBZ.scene.background.isTexture) tlive.add(CBZ.scene.background);
  var by = {}, tby = {}, gN = 0, gB = 0, tN = 0, tB = 0;
  GT.geo.forEach(function (g) { var inS = live.has(g); if (!inS) gN++;
    var b = 0; for (var k in g.attributes) { var a = g.attributes[k]; b += a.array ? a.array.byteLength : 0; } if (g.index && g.index.array) b += g.index.array.byteLength;
    if (!inS) gB += b; var key = (inS ? "[scene] " : "[ORPHAN] ") + (GT.stk.get(g) || ("(pre-track) " + g.type)); var r = by[key] || (by[key] = [0, 0]); r[0]++; r[1] += b; });
  GT.tex.forEach(function (t) { var inS = tlive.has(t); if (!inS) tN++;
    // (never read .image of a lazy canvas texture: core/texfree.js paints it again on read)
    var im = t._cbzLazyW != null ? { width: t._cbzLazyW, height: t._cbzLazyH } : t.image, b = im && im.width ? im.width * im.height * 4 : 0; if (!inS) tB += b;
    var key = (inS ? "[scene] " : "[ORPHAN] ") + (GT.stk.get(t) || ("(pre-track) " + (t.constructor && t.constructor.name))); var r = tby[key] || (tby[key] = [0, 0]); r[0]++; r[1] += b; });
  function top(o) { return Object.keys(o).map(function (k) { return [o[k][0], Math.round(o[k][1] / 1024), k]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 16); }
  var cvBy = {}, cvN = 0, cvPx = 0;
  GT.cv = GT.cv.filter(function (c) { var el = c.r.deref(); if (!el) return false; cvN++; var px = el.width * el.height; cvPx += px;
    var r = cvBy[c.s] || (cvBy[c.s] = [0, 0]); r[0]++; r[1] += px * 4; return true; });
  return { canvases: { n: cvN, MB: +(cvPx * 4 / 1048576).toFixed(2), top: top(cvBy).slice(0, 6) }, gl: { bufMB: +(GT.gl.buf / 1048576).toFixed(2), texMB: +(GT.gl.tex / 1048576).toFixed(2), rbMB: +(GT.gl.rb / 1048576).toFixed(2), nbuf: GT.gl.nbuf, ntex: GT.gl.ntex, nrb: GT.gl.nrb }, tracked: GT.geo.size, ttracked: GT.tex.size, gN: gN, gKB: Math.round(gB / 1024), tN: tN, tKB: Math.round(tB / 1024), geo: top(by), tex: top(tby) };
`;

const PLAY = (steps, every, block) => `
  var P = CBZ.player, list = CBZ.npcs || [];
  var live = list.filter(function (c) { return c && !c.dead && !c.ko && c.group && c.kind !== "guard"; });
  // walk toward a different inmate each block (the whole block gets toured)
  var goal = live.length ? live[(${block} * 7) % live.length] : null;
  // start a few metres off him: the walk is the last stretch, the rest is the fight
  if (goal) { var a0 = ${block} * 2.1; P.pos.x = goal.group.position.x + Math.sin(a0) * 6; P.pos.z = goal.group.position.z + Math.cos(a0) * 6; P.pos.y = goal.group.position.y; }
  var stabbed = 0, punches = 0, renders = 0, kills = 0;
  for (var s = 0; s < ${steps}; s++) {
    if (goal && goal.group) {
      var gx = goal.group.position.x, gz = goal.group.position.z;
      var dx = gx - P.pos.x, dz = gz - P.pos.z, d = Math.hypot(dx, dz);
      if (d > 1.4) { var st = Math.min(d - 1.2, 4.5 / 60); P.pos.x += dx / d * st; P.pos.z += dz / d * st;
        if (CBZ.groundAt) { var gy = CBZ.groundAt(P.pos.x, P.pos.z, P.pos.y + 1); if (isFinite(gy)) P.pos.y = gy; } }
      if (CBZ.playerChar && d > 0.01) CBZ.playerChar.group.rotation.y = Math.atan2(dx, dz);
      if (s === Math.round(${steps} * 0.1) && CBZ.requestInmateHunt && !goal.dead) CBZ.requestInmateHunt(goal, 20, "wronged");
      if (s > ${steps} * 0.15 && s % 25 === 0 && d < 2.2 && !goal.dead && CBZ.punch) { try { CBZ.punch(goal); punches++; } catch (e) {} }
      if (s === Math.round(${steps} * 0.8) && !goal.dead && CBZ.aiKill) { try { CBZ.aiKill(goal, CBZ.player, {}); kills++; } catch (e) {} }
      if (s > ${steps} * 0.5 && s % 20 === 0 && d < 2.2 && !goal.dead && CBZ.prisonStab) { try { CBZ.prisonStab(goal); stabbed++; } catch (e) {} }
    }
    P.hp = 100; P.dead = false; P.stun = 0; if (CBZ.game) { CBZ.game.invuln = 0; if (CBZ.game.state !== "playing") CBZ.game.state = "playing"; }
    CBZ.stepSim(1 / 60);
    if (s % ${every} === 0) { CBZ.renderFrame(); renders++; }
  }
  return { punches: punches, stabs: stabbed, kills: kills, renders: renders, goalDead: !!(goal && goal.dead) };
`;

export default async function (t) {
  const blocks = +t.arg("--blocks", 12);
  const every = +t.arg("--render-every", 30);
  await t.evl("window.__tbFreeze && __tbFreeze()");
  await t.fn(`for (var w = 0; w < 300; w++) CBZ.stepSim(1/60); return true;`);
  if (t.flag("--track")) t.log("track", await t.fn(TRACK));
  try { await t.send("HeapProfiler.enable"); } catch (_) {}
  const heap = async () => {
    try { await t.send("HeapProfiler.collectGarbage"); await t.send("HeapProfiler.collectGarbage"); } catch (_) {}
    try { const h = await t.send("Runtime.getHeapUsage"); const u = h.result || h; return [+(u.usedSize / 1048576).toFixed(1), +((u.backingStorageSize || 0) / 1048576).toFixed(1)]; } catch (_) { return [-1, -1]; }
  };
  const rows = [];
  const snap = async (label, extra) => {
    const s = await t.fn(SNAP, 120000);
    const hh = await heap(); s.heap = hh[0]; s.abuf = hh[1];
    s.label = label; Object.assign(s, extra || {});
    rows.push(s);
    const line = (`${label.padEnd(8)} heap ${String(s.heap).padStart(6)} MB  abuf ${s.abuf} MB  geo ${s.geo} tex ${s.tex} prog ${s.prog}  nodes ${s.nodes} mats ${s.mats} geos ${s.geos} dom ${s.dom}  npcs ${s.npcs} dead ${s.dead}` + (extra ? "  " + JSON.stringify(extra) : ""));
    t.log(line); process.stderr.write("[jail-leak] " + line + "\n");
    if (t.flag("--track")) { const o = await t.fn(ORPHANS, 120000); s.orphans = o;
      const ol = "  gl since track " + JSON.stringify(o && o.gl) + "\n  canvases since track " + JSON.stringify(o && o.canvases) + "\n  orphans: geo " + (o && o.gN) + " (" + (o && o.gKB) + " KB) tex " + (o && o.tN) + " (" + (o && o.tKB) + " KB)\n" +
        (o && o.geo ? o.geo.map((r) => "    G " + r[0] + " x " + r[1] + "KB  " + r[2]).join("\n") + "\n" + o.tex.map((r) => "    T " + r[0] + " x " + r[1] + "KB  " + r[2]).join("\n") : JSON.stringify(o));
      t.log(ol); process.stderr.write(ol + "\n"); }
  };
  // live bytes still held, allocated since sampling began, by the game's own frames (3 deep)
  const THREE_FR = t.flag("--three");
  const sampleTop = async () => {
    try { await t.send("HeapProfiler.collectGarbage"); } catch (_) {}
    const m = await t.send("HeapProfiler.getSamplingProfile");
    const prof = (m.result || m).profile;
    const by = new Map();
    const walk = (n, stack) => {
      const cf = n.callFrame, f = (cf.url || "").split("/").pop().replace(/\?.*$/, "");
      const here = f && (THREE_FR || !/three\.r128/.test(f)) ? `${cf.functionName || "(anon)"}@${f}:${cf.lineNumber + 1}${/three/.test(f) ? ":" + (cf.columnNumber + 1) : ""}` : null;
      const st = here ? [here].concat(stack).slice(0, THREE_FR ? 6 : 3) : stack;
      if (n.selfSize) { const k = st.join(" < ") || "(native/three)"; by.set(k, (by.get(k) || 0) + n.selfSize); }
      for (const c of n.children || []) walk(c, st);
    };
    if (prof) walk(prof.head, []);
    return { by, tot: [...by.values()].reduce((x, y) => x + y, 0) };
  };
  const midAt = Math.max(3, Math.round((blocks + 2) / 2));
  let mid = null;
  if (t.flag("--phone")) {
    // phone metrics + the touch layer (systems/touch.js builds on the first touchstart)
    await t.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await t.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    t.log("touch", await t.fn("window.dispatchEvent(new Event('resize')); try { window.dispatchEvent(Object.assign(new Event('touchstart'), { changedTouches: [], touches: [] })); } catch (e) {} for (var i = 0; i < 5; i++) CBZ.stepSim(1/60); return !!CBZ.touchMode;"));
  }
  await snap("boot");
  for (let b = 0; b < blocks; b++) {
    if (b === 2 && t.flag("--sample")) { await t.send("HeapProfiler.startSampling", { samplingInterval: 4096 }); t.log("sampling heap from block 3"); }
    const r = await t.fn(PLAY(+t.arg("--steps", 600), every, b), 20 * 60e3);
    await snap("b" + (b + 1), r && !r.__err ? r : { err: r && r.__err });
    if (t.flag("--sample") && b + 1 === midAt) mid = await sampleTop();
  }
  if (t.flag("--sample")) {
    const end = await sampleTop();
    const keys = [...end.by.entries()].sort((x, y) => y[1] - x[1]).slice(0, 35).map((e) => e[0]);
    const txt = "LIVE heap allocated after block 2 (sampled): mid (block " + midAt + ") " + (mid ? (mid.tot / 1048576).toFixed(2) : "-") + " MB -> end " + (end.tot / 1048576).toFixed(2) + " MB\n" +
      keys.map((k) => "  " + (mid ? ((mid.by.get(k) || 0) / 1024).toFixed(0) : "-").padStart(7) + " -> " + (end.by.get(k) / 1024).toFixed(0).padStart(6) + " KB  " + k).join("\n");
    t.log(txt); process.stderr.write(txt + "\n");
    await t.send("HeapProfiler.stopSampling");
  }
  // what grew every block after the second (the first two pay for caches)
  const base = rows[2] || rows[0], last = rows[rows.length - 1];
  const grew = [];
  const num = ["heap", "abuf", "geo", "tex", "prog", "nodes", "mats", "geos", "dom", "updaters", "always"];
  for (const k of num) if (last[k] > base[k] * 1.05 + 2) grew.push(`${k} ${base[k]} -> ${last[k]}`);
  for (const k of Object.keys(last.lists)) { const a = base.lists[k] || 0, z = last.lists[k]; if (z > a + 5 && z > a * 1.2) grew.push(`CBZ.${k}[] ${a} -> ${z}`); }
  for (const k of Object.keys(last.maps)) { const a = base.maps[k] || 0, z = last.maps[k]; if (z > a + 5 && z > a * 1.2) grew.push(`CBZ.${k} (map/set) ${a} -> ${z}`); }
  t.log("GREW (block 2 -> end): " + (grew.join("; ") || "nothing"));
  const errs = t.errors(); t.log("page errors: " + errs.length); for (const e of errs.slice(0, 12)) t.log("  " + e); process.stderr.write("[jail-leak] page errors " + errs.length + "\n" + errs.slice(0, 12).join("\n") + "\n");
  return { ok: grew.length === 0, summary: grew.length ? "grew: " + grew.join("; ") : `flat over ${blocks} blocks`, data: { rows } };
}
