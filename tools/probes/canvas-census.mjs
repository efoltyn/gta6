/* tools/probes/canvas-census.mjs — EVERY CANVAS THE PAGE STILL HOLDS, AND WHY.

   iOS counts every canvas backing store against the tab (and caps their sum),
   so a canvas kept after its texture is on the GPU is the picture paid twice.
   This reloads the world with a tracker installed before any game script
   (every document.createElement("canvas") is remembered with the stack that
   made it, weakly), plays a little (frames drawn, a look around), collects
   garbage, and lists the canvases still alive with a real backing store
   (bigger than 1x1) by who made them: count, MB, how many are the image of a
   texture that is already uploaded (paid twice), on the page (HUD), or not a
   texture image at all (a cache / a source another painter reads).
   It never reads .image of a lazy texture (core/texfree.js paints it on read).

     node tools/testbus/standalone.mjs tools/probes/canvas-census.mjs [--world escape] [--frames 600] [--top 30] [--phone]
   Always passes; the numbers are the point. */
export const meta = { world: "escape", fresh: true, dirties: true, timeoutMs: 30 * 60e3 };

const TRACKER = `(() => {
  const L = window.__cv = [];
  const ce = Document.prototype.createElement;
  function where() {
    const s = (new Error().stack || "").split("\\n").slice(2)
      .filter((l) => /\\/(src|games)\\//.test(l) && !/three\\.r128/.test(l)).slice(0, 3)
      .map((l) => l.replace(/^\\s*at\\s*/, "").replace(/https?:\\/\\/[^/]+\\//, "").replace(/\\?v=[^:]*/, ""));
    return s.join(" < ") || "(inline/page)";
  }
  Document.prototype.createElement = function (tag) {
    const el = ce.apply(this, arguments);
    if (String(tag).toLowerCase() === "canvas") L.push({ r: new WeakRef(el), s: where() });
    return el;
  };
})();`;

const ENTER = "(function(){ if (CBZ.game.state==='playing') return; if (CBZ.game.mode!=='escape' && CBZ.setMode) CBZ.setMode('escape'); var m=document.querySelector('[data-mode=\"escape\"]'); if (m) m.click(); var b=document.getElementById('playBtn'); if (b) b.click(); })()";
const READY = "CBZ.game.state==='playing' && CBZ.game.mode==='escape' && (CBZ.npcs||[]).length>0";

export default async function (t) {
  const frames = +t.arg("--frames", 600);
  if (t.flag("--phone")) {
    await t.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  }
  await t.send("Page.addScriptToEvaluateOnNewDocument", { source: TRACKER });
  const href = await t.evl("location.href");
  await t.send("Page.navigate", { url: href });
  await t.sleep(1500);
  if (!(await t.wait("window.CBZ && CBZ.game && CBZ.stepSim", 10 * 60e3, 300))) return { ok: false, summary: "no engine after reload" };
  let ok = false;
  for (let i = 0; i < 600 && !ok; i++) {
    try { await t.evl(`(function(){try{${ENTER}}catch(e){}return 1})()`); } catch (_) {}
    ok = await t.wait(READY, 1000, 250);
  }
  if (!ok) return { ok: false, summary: "world never ready after reload" };
  await t.evl("window.__tbFreeze && __tbFreeze()");
  // play: frames with a draw every 5, the camera turning, the player crossing the block
  await t.fn(`
    var P = CBZ.player, cam = CBZ.camera, spots = [[0, 34], [0, 0], [-11, -39], [10, -20], [0, -30]];
    for (var s = 0; s < ${frames}; s++) {
      if (s % 120 === 0) { var sp = spots[(s / 120) % spots.length | 0]; P.pos.x = sp[0]; P.pos.z = sp[1]; }
      CBZ.stepSim(1 / 60);
      if (s % 5 === 0) CBZ.renderFrame();
    }
    // a full turn at the last spot, so the block's surfaces get drawn
    for (var k = 0; k < 8; k++) { cam.rotation.set(0, k * Math.PI / 4, 0); cam.updateMatrixWorld(true); CBZ.renderer.render(CBZ.scene, cam); }
    return 1;`, 25 * 60e3);
  // texfree sweeps on a 3 s timer and waits STABLE_S: give it the wall time it asks for
  const settle = +t.arg("--settle", 35);
  for (let i = 0; i < settle; i++) { await t.sleep(1000); await t.fn("CBZ.stepSim(1/60); return 1;"); }
  try { await t.send("HeapProfiler.enable"); await t.send("HeapProfiler.collectGarbage"); await t.send("HeapProfiler.collectGarbage"); } catch (_) {}
  await t.evl("window.__ccTop = " + (+t.arg("--top", 30)));
  const r = await t.fn(`
    var R = CBZ.renderer, texOf = new Map();
    function imageOf(tx) {
      var d = Object.getOwnPropertyDescriptor(tx, "image");
      if (d && d.get) return null;                      // lazy / live: never read
      return tx.image;
    }
    function addTex(tx) { if (!tx || !tx.isTexture) return; var im = imageOf(tx); if (!im || typeof im.getContext !== "function") return;
      var L = texOf.get(im) || []; if (L.indexOf(tx) < 0) L.push(tx); texOf.set(im, L); }
    CBZ.scene.traverse(function (o) {
      var M = o.material; if (!M) return; (Array.isArray(M) ? M : [M]).forEach(function (m) {
        for (var k in m) { var v = m[k]; if (v && v.isTexture) addTex(v); }
        if (m.uniforms) for (var u in m.uniforms) { var x = m.uniforms[u] && m.uniforms[u].value; if (x && x.isTexture) addTex(x); }
      });
    });
    var by = {}, tot = { live: 0, MB: 0, upMB: 0, onPage: 0, notTexMB: 0 };
    window.__cv = window.__cv.filter(function (c) {
      var el = c.r.deref(); if (!el) return false;
      var px = el.width * el.height; if (px <= 1) return true;
      var mb = px * 4 / 1048576, txs = texOf.get(el) || [], up = false, freed = false, keep = false, ver = 0;
      txs.forEach(function (tx) { var p = R.properties.get(tx); if (p && p.__webglTexture) up = true; if (tx._cbzKeep) keep = true; ver = Math.max(ver, tx.version); });
      var cls = el.isConnected ? "page" : !txs.length ? "notTex" : up ? (keep ? "upKEEP" : "UPLOADED") : "notUp";
      var row = by[c.s] || (by[c.s] = { n: 0, MB: 0, cls: {} }); row.n++; row.MB += mb; row.cls[cls] = (row.cls[cls] || 0) + 1;
      tot.live++; tot.MB += mb; if (cls === "UPLOADED" || cls === "upKEEP") tot.upMB += mb; if (cls === "page") tot.onPage++; if (cls === "notTex") tot.notTexMB += mb;
      return true;
    });
    var top = Object.keys(by).map(function (k) { return [+by[k].MB.toFixed(2), by[k].n, JSON.stringify(by[k].cls), k]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, +(window.__ccTop || 30));
    var A = CBZ.texFreeAudit ? CBZ.texFreeAudit() : null;
    return { tot: { live: tot.live, MB: +tot.MB.toFixed(1), uploadedMB: +tot.upMB.toFixed(1), notTextureMB: +tot.notTexMB.toFixed(1), onPage: tot.onPage }, top: top, texfree: A && { freed: A.freed, freedMB: A.freedMB, lazyPainted: A.lazyPainted, lazyReleased: A.lazyReleased, repaintedAfterFree: A.repaintedAfterFree } };
  `, 5 * 60e3);
  if (!r || r.__err) return { ok: false, summary: "ERROR " + (r && r.__err) };
  const h = await t.send("Runtime.getHeapUsage"); const u = h.result || h;
  t.log(`canvases alive (>1x1): ${r.tot.live}, ${r.tot.MB} MB; image of an uploaded texture: ${r.tot.uploadedMB} MB; no texture: ${r.tot.notTextureMB} MB; on the page: ${r.tot.onPage}`);
  t.log(`texfree: ${JSON.stringify(r.texfree)}; heap ${(u.usedSize / 1048576).toFixed(1)} MB, ArrayBuffers ${((u.backingStorageSize || 0) / 1048576).toFixed(1)} MB`);
  for (const x of r.top) t.log(`${String(x[0].toFixed(2)).padStart(8)} MB  n${String(x[1]).padEnd(4)} ${x[2].padEnd(34)} ${x[3]}`);
  return { ok: true, summary: `${r.tot.live} canvases, ${r.tot.MB} MB (${r.tot.uploadedMB} MB already on the GPU)`, data: r };
}
