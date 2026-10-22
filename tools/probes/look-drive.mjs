/* tools/probes/look-drive.mjs — A LONG DRIVE THROUGH GANG CITY: DO THE
   PEOPLE'S LOOKS PILE UP ON THE GPU?

   Every person's outfit atlas (city/clothes.js) and ink chart
   (entities/tattoo.js) is a texture shared by everyone wearing it. A look
   nobody in the scene wears must give its GPU copy back (core/texfree.js
   CBZ.lookTex). This carries the player along the streets at driving speed
   for --mins sim minutes (default 20), draws a frame every 2 sim seconds (so
   the people met are really uploaded), and samples once a sim minute: GPU
   textures (three's count and the accounted MB of every live texture),
   the looks resident / worn / put away. A plateau passes; a count that is
   still climbing over the last third of the drive is the pile-up.

   It also NAMES what piles up (the ledger below): every texture, geometry
   and render target three uploads during the drive, by the game code that
   built it. Each sample prints the makers whose GPU-resident count / MB grew
   since minute 1 (HELD), and the end prints what was garbage-collected while
   still on the GPU, never disposed (LOST).
     --diag        + the streamer's / car LOD cache's counters and every CBZ
                   list that grew
     --why a,b     + who still holds the oldest live object made at a maker
                   matching each substring (a reference path from window)

     node tools/testbus/standalone.mjs tools/probes/look-drive.mjs [--mins 20] [--mps 25] [--diag] [--why airport_kit.js:537]
   Exit 0 = plateau, 1 = still climbing (textures, or geometries +150). */
export const meta = { world: "city", fresh: true, dirties: true, timeoutMs: 90 * 60e3 };

/* THE LEDGER. Every texture / geometry / render target three puts on the GPU
   from here on (it adds a "dispose" listener the moment it uploads one, and
   removes it when the thing is disposed) is entered by WEAK reference with
   the game code that BUILT it: a setter on a field each constructor assigns
   sees every birth and keeps the stack's first game frames. Two verdicts come out of it:
     LOST  the object was garbage-collected while still on the GPU: nobody
           called dispose() and nobody can any more. A leak, named by its maker.
     HELD  live on the GPU now, counted per maker per sample: a maker whose
           count keeps climbing while the drive repeats the same loop is
           holding what it should give back (a cache with no cap, a pool that
           never reuses). */
const HOOK = `
  if (window.__lt) return 1;
  var G = window.__lt = { live: new Map(), geo: new Map(), rt: new Map(), lost: {}, seq: 0, hist: [] };
  Error.stackTraceLimit = 30;
  var site = function () {
    var st = (new Error().stack || "").split("\\n"), out = [];
    for (var i = 2; i < st.length && out.length < 3; i++) {
      var m = st[i].match(/\\/(src\\/[^?:]+)[^:]*:(\\d+)/);
      if (!m || /vendor\\/three|core\\/texfree\\.js/.test(m[1])) continue;
      out.push(m[1].replace(/^src\\//, "") + ":" + m[2]);
    }
    return out.join(" < ") || "?";
  };
  // (a field each constructor assigns: Texture's uuid; BufferGeometry's uuid
  // is made lazily by our three build, so its morphTargetsRelative instead.
  // The setter stamps the maker, then leaves a plain own property behind.)
  [[THREE.BufferGeometry, "morphTargetsRelative"], [THREE.Texture, "uuid"]].forEach(function (KF) {
    var f = KF[1];
    Object.defineProperty(KF[0].prototype, f, { configurable: true,
      set: function (v) {
        if (!this.__cs) Object.defineProperty(this, "__cs", { value: site(), writable: true });
        Object.defineProperty(this, f, { value: v, writable: true, enumerable: true, configurable: true });
      } });
  });
  var texMB = function (t) {
    var im = t._cbzLazyW ? null : t.image;
    var w = t._cbzLazyW || (im && im.width) || 0, h = t._cbzLazyH || (im && im.height) || 0;
    if (im && im.data && im.depth) h *= im.depth;
    var f = t.format, bpp = (f === THREE.LuminanceFormat || f === THREE.AlphaFormat || f === THREE.RedFormat) ? 1 : (f === THREE.LuminanceAlphaFormat || f === THREE.RGFormat) ? 2 : 4;
    if (t.type === THREE.FloatType) bpp *= 4; else if (t.type === THREE.HalfFloatType) bpp *= 2;
    return w * h * bpp * (t.generateMipmaps !== false && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? 4 / 3 : 1) / 1048576;
  };
  var geoMB = function (g) {
    var b = 0, A = g.attributes || {};
    for (var k in A) { var a = A[k]; var arr = a && (a.array || (a.data && a.data.array)); if (arr && arr.byteLength) b += arr.byteLength; }
    if (g.index && g.index.array) b += g.index.array.byteLength;
    return b / 1048576;
  };
  G.texMB = texMB; G.geoMB = geoMB;
  var reg = new FinalizationRegistry(function (h) {
    var M = G[h.kind]; M.delete(h.id);
    if (!h.gpu) return;                      // never seen on the GPU: nothing to lose
    var k = h.kind + " " + h.cs, e = G.lost[k] || (G.lost[k] = { n: 0, mb: 0, name: h.name });
    e.n++; e.mb += h.mb;
  });
  var track = function (K, kind) {
    var P = K.prototype, add = P.addEventListener, rem = P.removeEventListener;
    P.addEventListener = function (type, fn) {
      if (type === "dispose" && !this.__ltId) {
        var id = ++G.seq;
        Object.defineProperty(this, "__ltId", { value: id, writable: true, configurable: true });
        var cs = kind === "rt" ? "rt< " + ((this.texture && this.texture.__cs) || "(before the hook)") : (this.__cs || "(made before the hook)");
        var mb = kind === "live" ? texMB(this) : kind === "geo" ? geoMB(this) : (this.width * this.height * 4 / 1048576);
        var rec = { ref: new WeakRef(this), cs: cs, mb: mb, kind: kind, id: id, name: this.name || "", gpu: !this.isTexture };
        G[kind].set(id, rec);
        reg.register(this, rec, this);
      }
      return add.call(this, type, fn);
    };
    P.removeEventListener = function (type, fn) {
      if (type === "dispose" && this.__ltId) { G[kind].delete(this.__ltId); reg.unregister(this); this.__ltId = 0; }
      return rem.call(this, type, fn);
    };
  };
  track(THREE.Texture, "live"); track(THREE.BufferGeometry, "geo"); track(THREE.WebGLRenderTarget, "rt");
  return 1;
`;

/* the ledger read once a sim minute, after a forced collection */
const ATTRIB = `
  var G = window.__lt, out = { lost: [], grow: [] };
  // (a texture counts once three really holds it: other code listens for
  // "dispose" too, entities/pedinstance.js on every chart it copies)
  var R = CBZ.renderer, onGPU = function (o) { if (!o.isTexture) return true; var p = R.properties.get(o); return !!(p && p.__webglInit); };
  var sum = function (M) {
    var g = {};
    M.forEach(function (r) { var o = r.ref.deref(); if (!o || !onGPU(o)) return; r.gpu = true; var e = g[r.cs] || (g[r.cs] = { n: 0, mb: 0, name: "" }); e.n++; e.mb += r.mb; if (!e.name && o.name) e.name = o.name; });
    return g;
  };
  var now = { tex: sum(G.live), geo: sum(G.geo), rt: sum(G.rt) };
  G.hist.push(now);
  var base = G.hist[0], prev = G.hist[G.hist.length - 2] || base;
  ["tex", "geo", "rt"].forEach(function (kind) {
    var N = now[kind], B = base[kind], P = prev[kind];
    for (var k in N) {
      var b = B[k] || { n: 0, mb: 0 }, p = P[k] || { n: 0, mb: 0 }, e = N[k];
      if (e.n - b.n >= 3 || e.mb - b.mb >= 0.5) out.grow.push([kind, e.n - b.n, +(e.mb - b.mb).toFixed(2), e.n - p.n, e.n, k, e.name]);
    }
  });
  out.grow.sort(function (a, b) { return (b[2] - a[2]) || (b[1] - a[1]); });
  out.grow = out.grow.slice(0, 18);
  for (var k in G.lost) { var e = G.lost[k]; out.lost.push([e.n, +e.mb.toFixed(2), k, e.name]); }
  out.lost.sort(function (a, b) { return (b[1] - a[1]) || (b[0] - a[0]); });
  out.lost = out.lost.slice(0, 18);
  var M = function (Mp) { var n = 0, mb = 0; Mp.forEach(function (r) { var o = r.ref.deref(); if (o && onGPU(o)) { n++; mb += r.mb; } }); return [n, +mb.toFixed(1)]; };
  out.ledger = { tex: M(G.live), geo: M(G.geo), rt: M(G.rt) };
  return out;
`;

/* the route: the speed tool's road walk (nearest road, straight on where it
   can, turning at crossings), and back along itself when it runs out */
const ROUTE = `
  var A = CBZ.city && CBZ.city.arena, Pl = CBZ.player;
  var R0 = (A && A.roads || []).filter(function (r) { return r && r.x != null && r.z != null && r.len > 8; });
  var ends = function (r) { var h = r.len / 2; return r.vertical ? [[r.x, r.z - h], [r.x, r.z + h]] : [[r.x - h, r.z], [r.x + h, r.z]]; };
  var cur = null, bd = Infinity;
  for (var i = 0; i < R0.length; i++) { var dd = Math.hypot(R0[i].x - Pl.pos.x, R0[i].z - Pl.pos.z); if (dd < bd) { bd = dd; cur = R0[i]; } }
  if (!cur) return null;
  var E = ends(cur), used = new Set([cur]), route = [[cur.x, cur.z], E[1]], at2 = E[1], dir = cur.vertical ? [0, 1] : [1, 0], len = 0, guard = 0;
  while (len < 40000 && guard++ < 2000) {
    var best = null, bs = -Infinity, bend = null;
    for (var j = 0; j < R0.length; j++) {
      var r2 = R0[j]; if (used.has(r2)) continue;
      var e2 = ends(r2), hl = r2.len / 2;
      var onIt = r2.vertical ? (Math.abs(at2[0] - r2.x) < 14 && at2[1] > r2.z - hl - 14 && at2[1] < r2.z + hl + 14)
                             : (Math.abs(at2[1] - r2.z) < 14 && at2[0] > r2.x - hl - 14 && at2[0] < r2.x + hl + 14);
      if (!onIt) continue;
      for (var k = 0; k < 2; k++) {
        var f = e2[k], vx = f[0] - at2[0], vz = f[1] - at2[1], vl = Math.hypot(vx, vz) || 1;
        if (vl < 30) continue;
        var sc = (vx * dir[0] + vz * dir[1]) / vl * 50 + r2.len * 0.05;
        if (sc > bs && (vx * dir[0] + vz * dir[1]) / vl > -0.2) { bs = sc; best = r2; bend = f; }
      }
    }
    if (!best) break;
    used.add(best);
    var cross = best.vertical ? [best.x, at2[1]] : [at2[0], best.z];
    if (Math.hypot(cross[0] - at2[0], cross[1] - at2[1]) > 0.5) route.push(cross);
    route.push(bend); len += Math.hypot(bend[0] - cross[0], bend[1] - cross[1]);
    var bl = Math.hypot(bend[0] - at2[0], bend[1] - at2[1]) || 1;
    dir = [(bend[0] - at2[0]) / bl, (bend[1] - at2[1]) / bl];
    at2 = bend;
  }
  window.__ltRoute = route;
  return { legs: route.length - 1, km: +(len / 1000).toFixed(1) };
`;

/* SECS sim seconds of driving: 15 steps a sim second, a drawn frame every 2 s.
   A minute is six of these with the page's event loop let run between
   them: the car LOD worker's results, idle callbacks and timers only land
   between tasks, and one 60 s block starved them (the LOD twins' queue sat
   ~900 deep for minutes and their uploads read as a geometry climb). */
const MINUTE = (mps, d0, secs) => `
  var C = CBZ, Pl = C.player, A = C.city && C.city.arena, route = window.__ltRoute;
  var legs = [], tot = 0;
  for (var i = 0; i + 1 < route.length; i++) { var L = Math.hypot(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1]); legs.push(L); tot += L; }
  var at = function (d) {
    d = d % (2 * tot); if (d > tot) d = 2 * tot - d;          // there and back
    for (var i = 0; i < legs.length; i++) { if (d <= legs[i] || i === legs.length - 1) { var f = Math.min(1, d / legs[i]); return [route[i][0] + (route[i + 1][0] - route[i][0]) * f, route[i][1] + (route[i + 1][1] - route[i][1]) * f, Math.atan2(route[i + 1][0] - route[i][0], route[i + 1][1] - route[i][1])]; } d -= legs[i]; }
  };
  var gh = function (x, z) { try { var y = A && A.groundHeightAt ? A.groundHeightAt(x, z) : 0; return isFinite(y) ? y : 0; } catch (e) { return 0; } };
  var d = ${d0};
  for (var s = 0; s < ${secs}; s++) {
    for (var k = 0; k < 15; k++) {
      d += ${mps} / 15;
      var q = at(d);
      Pl.pos.set(q[0], gh(q[0], q[1]) + 0.05, q[1]); Pl.vy = 0; Pl.grounded = true; Pl.dead = false; Pl.hp = 100;
      if (C.cam) C.cam.yaw = q[2] + Math.PI;
      C.stepSim(1 / 15);
    }
    if (s % 2 === 0) { try { C.renderFrame(); } catch (e) {} }
  }
  var G = window.__lt, mb = 0;
  G.live.forEach(function (r) { var o = r.ref.deref(), p = o && C.renderer.properties.get(o); if (p && p.__webglInit) mb += r.mb; });
  var info = C.renderer.info.memory;
  return { d: d, tex: info.textures, geo: info.geometries, texMB: +mb.toFixed(1), look: C.lookTex ? C.lookTex.audit() : null,
    peds: (C.cityPeds || []).length, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1 };
`;

/* --why <maker substring>: who still holds the OLDEST live ledger entry made
   there? A breadth-first walk of the page's object graph from window (own
   data properties, array slots, Map / Set entries; never a getter, which
   could build what it reads) prints the first path that reaches it. A path
   through a closure is invisible to this walk: "not reachable" then means a
   function's captured variable (or three's own internals) holds it. */
const WHY = (pat) => `
  var G = window.__lt, pat = ${JSON.stringify(pat)}, tgt = null, best = Infinity, kind = "";
  ["live", "geo", "rt"].forEach(function (k) { G[k].forEach(function (r, id) { if (r.cs.indexOf(pat) >= 0 && id < best) { var o = r.ref.deref(); if (o) { best = id; tgt = o; kind = k; } } }); });
  if (!tgt) return { none: true };
  var seen = new Set([G]), q = [], head = 0, N = 0, LIM = 6000000;
  var push = function (o, from, key) {
    if (o === null || (typeof o !== "object" && typeof o !== "function") || seen.has(o)) return false;
    if (ArrayBuffer.isView(o) || o instanceof ArrayBuffer) return false;
    seen.add(o); q.push([o, from, key]);
    return o === tgt;
  };
  var path = function (i) { var out = []; while (i >= 0) { var e = q[i]; out.unshift(String(e[2]) + (e[0] && e[0].constructor && e[0].constructor.name ? "{" + e[0].constructor.name + (e[0].name ? ":" + e[0].name : "") + "}" : "")); i = e[1]; } return out.join(" . "); };
  push(window, -1, "window");
  while (head < q.length && N < LIM) {
    var i = head++, o = q[i][0]; N++;
    var hit = false;
    try {
      if (o instanceof Map) { var j = 0; o.forEach(function (v, k) { if (push(k, i, "<key" + j + ">") || push(v, i, "<" + (typeof k === "string" ? k : j) + ">")) hit = true; j++; }); }
      else if (o instanceof Set) { var j2 = 0; o.forEach(function (v) { if (push(v, i, "<" + (j2++) + ">")) hit = true; }); }
      if (!hit) {
        var ks = Object.getOwnPropertyNames(o);
        for (var a = 0; a < ks.length && !hit; a++) {
          var d = Object.getOwnPropertyDescriptor(o, ks[a]);
          if (d && "value" in d && push(d.value, i, ks[a])) hit = true;
        }
      }
    } catch (e) {}
    if (hit) return { kind: kind, id: best, name: tgt.name || "", walked: N, path: path(q.length - 1) };
  }
  return { kind: kind, id: best, name: tgt.name || "", walked: N, path: null, inScene: (function () { var f = false; CBZ.scene.traverse(function (c) { if (c.geometry === tgt) f = true; var m = c.material; if (m && !Array.isArray(m)) for (var k in m) if (m[k] === tgt) f = true; }); return f; })() };
`;

/* --diag: the streamer's and the car LOD cache's own counters, and every
   CBZ / city list that grew since the first minute */
const DIAG = `
  var C = CBZ, A = C.city && C.city.arena, out = { lists: {} };
  var S = C.streamStats || {};
  out.stream = { built: S.built, parked: S.parked, freed: S.freed, queued: S.queued };
  var J = C.streamJobs || [], runs = {};
  J.forEach(function (j) { if (j.freed) runs[j.name || "?"] = (runs[j.name || "?"] || 0) + j.freed; });
  out.freedJobs = runs;
  out.carLod = C.carLodAudit ? C.carLodAudit() : null;
  out.updaters = (C.updaters || []).length; out.always = (C.always || []).length;
  var n = function (pre, o) { for (var k in o) { var v; try { v = o[k]; } catch (e) { continue; } if (Array.isArray(v)) out.lists[pre + k] = v.length; else if (v instanceof Map || v instanceof Set) out.lists[pre + k] = v.size; } };
  n("", C); if (A) n("city.", A);
  var G = window.__lt;
  // the car LOD twins on the GPU, by the code that made their SOURCE geometry
  var tw = {}, srcs = new Set();
  G.geo.forEach(function (r) { var o = r.ref.deref(); if (!o || !o._carLodSrc) return; srcs.add(o._carLodSrc); var k = o._carLodSrc.__cs || "(before the hook)"; tw[k] = (tw[k] || 0) + 1; });
  out.twins = { n: Object.keys(tw).reduce(function (a, k) { return a + tw[k]; }, 0), sources: srcs.size,
    top: Object.keys(tw).sort(function (a, b) { return tw[b] - tw[a]; }).slice(0, 6).map(function (k) { return tw[k] + " " + k; }) };
  if (!G.lists0) { G.lists0 = out.lists; out.lists = {}; return out; }
  var grew = {};
  for (var k in out.lists) { var b = G.lists0[k] || 0; if (out.lists[k] - b >= 20) grew[k] = b + "->" + out.lists[k]; }
  out.lists = grew;
  return out;
`;

export default async function (t) {
  const mins = Math.max(3, +t.arg("--mins", 20) || 20), mps = +t.arg("--mps", 25) || 25;
  await t.fn(HOOK);
  await t.step(120);
  const r = await t.fn(ROUTE, 300000);
  if (!r || r.__err) return { ok: false, summary: "no route: " + JSON.stringify(r) };
  t.log("route", JSON.stringify(r));
  const rows = [];
  let d = 0, lastA = null;
  for (let m = 1; m <= mins; m++) {
    let s = null;
    for (let c = 0; c < 6; c++) {
      s = await t.fn(MINUTE(mps, d, 10), 1800000);
      if (!s || s.__err) return { ok: false, summary: `minute ${m}: ${JSON.stringify(s)}` };
      d = s.d;
      await t.sleep(40);
    }
    rows.push(s);
    const L = s.look || {};
    try { await t.send("HeapProfiler.collectGarbage"); } catch (_) {}
    await t.sleep(300);                                  // finalizers run between tasks
    const a = await t.fn(ATTRIB, 300000);
    t.log(`min ${m}`, JSON.stringify({ tex: s.tex, texMB: s.texMB, geo: s.geo, heap: s.heap, peds: s.peds, looks: L.looks, resident: L.resident, residentMB: L.residentMB, idleMB: L.idleResidentMB, evicted: L.evicted, revived: L.revived, ledger: a && a.ledger }));
    if (a && a.__err) t.log("  ledger error " + JSON.stringify(a));
    else if (a && m > 1 && (m % 2 === 0 || m === mins)) {
      for (const g of a.grow) t.log(`    HELD ${g[0]} +${g[1]} (+${g[2]} MB, +${g[3]} this min, ${g[4]} live)  ${g[5]} ${g[6] || ""}`);
    }
    if (a && !a.__err) lastA = a;
    if (t.flag("--diag")) t.log("  diag " + JSON.stringify(await t.fn(DIAG, 120000)));
  }
  for (const pat of String(t.arg("--why", "") || "").split(",").filter(Boolean)) t.log(`  why ${pat}: ` + JSON.stringify(await t.fn(WHY(pat), 600000)));
  if (lastA) for (const l of lastA.lost) t.log(`    LOST ${l[0]} (${l[1]} MB)  ${l[2]} ${l[3] || ""}`);
  // the verdict: the last third of the drive must not keep climbing
  const third = Math.max(2, Math.floor(rows.length / 3));
  const tail = rows.slice(-third), head = rows[rows.length - third - 1] || rows[0];
  const maxTail = Math.max(...tail.map((s) => s.tex)), first = tail[0].tex, last = tail[tail.length - 1].tex;
  const climbing = last > head.tex + 12 && last >= maxTail && first < last - 8;
  const geoClimb = tail[tail.length - 1].geo > head.geo + 150;
  return { ok: !climbing && !geoClimb,
    summary: `${mins} sim min at ${mps} m/s: GPU textures ${rows[0].tex} -> ${rows[Math.floor(rows.length / 2)].tex} -> ${last} (${rows[0].texMB} -> ${rows[rows.length - 1].texMB} MB), ` +
      `geometries ${rows[0].geo} -> ${rows[rows.length - 1].geo}; ` +
      `looks resident ${rows[rows.length - 1].look ? rows[rows.length - 1].look.resident : "?"}, put away ${rows[rows.length - 1].look ? rows[rows.length - 1].look.evicted : "?"}` +
      (climbing || geoClimb ? " — STILL CLIMBING" : " — plateau") + (lastA && lastA.lost.length ? `; ${lastA.lost.reduce((n, l) => n + l[0], 0)} dropped without dispose` : ""),
    data: rows.map((s) => [s.tex, s.texMB, s.geo, s.look && s.look.resident]) };
}
