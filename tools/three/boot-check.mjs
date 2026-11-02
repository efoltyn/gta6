#!/usr/bin/env node
/* tools/three/boot-check.mjs — does every page boot on this three.js, with
   zero page errors and zero shader compile errors? And what does it look like?

     node tools/three/boot-check.mjs                     # every target
     node tools/three/boot-check.mjs city escape race    # some targets
     node tools/three/boot-check.mjs --root <dir>        # check ANOTHER tree (e.g. an r128 export) the same way
     node tools/three/boot-check.mjs --gpu webgpu        # the opt-in WebGPU path (?gpu=webgpu)
     node tools/three/boot-check.mjs --shots <dir>       # PNG per target (after N frames) for a before/after sheet
     node tools/three/boot-check.mjs --json <file>       # machine-readable result

   ONE headless Chrome for the whole run (shared Mac), killed at the end.
   Shader diagnostics are forced on (?cfg_GFX_SHADER_DIAGNOSTICS=1, which sets
   renderer.debug.checkShaderErrors), so a broken program is a console error
   ("THREE.WebGLProgram: Shader Error ...") instead of a silent black mesh.
   Every console.error / console.warn and uncaught throw is captured from the
   very first script (a preload wraps console), grouped and counted.

   A target is a page + an optional door (JS to walk through the title
   screen) + a ready predicate. Frames: after ready the page renders on its
   own rAF for --settle ms (default 6000) so the materials the first frames
   see get compiled; then the shot, then the log is read. */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const ROOT = path.resolve(opt("--root", path.join(HERE, "../..")));
const GPU = opt("--gpu", "");
const SHOTS = opt("--shots", "");
const JSON_OUT = opt("--json", "");
const SETTLE = +opt("--settle", "6000");
const BOOT_MS = +opt("--boot", "900000");
const NO_DIAG = argv.includes("--no-diag"); if (NO_DIAG) argv.splice(argv.indexOf("--no-diag"), 1);

// the tree being checked serves itself (its own devserver + cdp lib)
const { launch, sleep } = await import(pathToFileURL(path.join(ROOT, "tools/lib/cdp.mjs")).href);

const MODE = (m) => ({
  page: "index.html", query: "mode=" + m + "&seed=90210",
  enter: `(function(){ if (CBZ.game.state==='playing') return; var t=document.querySelector('[data-mode="${m}"]'); if (t && !t.classList.contains('active')) t.click(); if (CBZ.game.state==='title' && CBZ.startRun) CBZ.startRun(); })()`,
  ready: `CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='${m}'`,
});
export const TARGETS = {
  city: { page: "index.html", query: "seed=90210",
    enter: "(function(){ if (CBZ.game.state==='playing') return; var t=document.querySelector('[data-mode=\"city\"]'); if (t && !t.classList.contains('active')) t.click(); if (CBZ.game.state==='title' && CBZ.startRun) CBZ.startRun(); })()",
    ready: "CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='city' && !!(CBZ.city&&CBZ.city.arena)" },
  escape: MODE("escape"),
  isles: MODE("archipelago"),
  survival: MODE("survival"),
  sharksim: MODE("sharksim"),
  gungame: MODE("gungame"),
  disaster: { page: "disaster.html", query: "seed=1",
    enter: "(function(){ if (CBZ.game.state==='playing') return; var m=document.querySelector('.mode-btn[data-mode=\"survival\"]'); if (m) m.click(); if (CBZ.game.state==='title' && CBZ.startRun) CBZ.startRun(); })()",
    ready: "CBZ.game && CBZ.game.state==='playing' && CBZ.game.mode==='survival'" },
  battle: { page: "games/battle.html", query: "auto=1&map=dunes&red=40&blue=40", ready: "!!(window.__battle && __battle.audit().started)" },
  bomb: { page: "games/bomb-survivor.html", query: "", ready: "!!(window.CBZ && CBZ.renderer && ((CBZ.renderer.info.render.frame || CBZ.renderer.info.frame || 0) > 30))" },
  warlord: { page: "games/warlord.html", query: "", ready: "!!(window.CBZ && CBZ.renderer && ((CBZ.renderer.info.render.frame || CBZ.renderer.info.frame || 0) > 30))" },
  president: { page: "games/president.html", query: "", ready: "document.readyState==='complete' && performance.now() > 4000" },
  race: { page: "games/race.html", query: "", ready: "document.readyState==='complete' && performance.now() > 6000" },
  ocean: { page: "games/ocean.html", query: "", ready: "document.readyState==='complete' && performance.now() > 5000" },
  lab: { page: "lab.html", query: "kit=empty", ready: "!!(window.__lab && __lab.boot)" },
};

// console capture from the first script on
const PRELOAD = `(() => {
  const L = window.__cbzLog = [];
  for (const k of ["error", "warn"]) {
    const f = console[k].bind(console);
    console[k] = function () {
      try { L.push(k + ": " + Array.from(arguments).map((a) => a && a.stack ? String(a.stack).split("\\n").slice(0, 2).join(" | ") : (typeof a === "object" ? (() => { try { return JSON.stringify(a).slice(0, 200); } catch (e) { return String(a); } })() : String(a))).join(" ").slice(0, 12000)); } catch (e) {}
      return f.apply(console, arguments);
    };
  }
  addEventListener("error", (e) => L.push("throw: " + (e.message || e) + " @ " + (e.filename || "").split("/").pop() + ":" + e.lineno));
  addEventListener("unhandledrejection", (e) => L.push("reject: " + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
})();`;

function group(lines) {
  const m = new Map();
  for (const l of lines) {
    // a shader error is long: key it by its first error line
    const k = /Shader Error|THREE\.WebGLProgram/.test(l) ? (l.match(/ERROR: [^\n|]*/g) || [l.slice(0, 200)]).slice(0, 2).join(" ; ").slice(0, 300) + "  [" + l.slice(0, 80) + "]" : l.slice(0, 300);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const want = argv.filter((a) => !a.startsWith("--"));
const names = want.length ? want : Object.keys(TARGETS);
// --real-gpu: the Mac's own GPU (ANGLE/Dawn on Metal: a real WebGPU adapter headless), not SwiftShader
const REAL = argv.includes("--real-gpu"); if (REAL) argv.splice(argv.indexOf("--real-gpu"), 1);
const rig = await launch({ rafBudget: 0, preload: PRELOAD, gpu: REAL ? "real" : undefined });
const results = [];
try {
  for (const name of names) {
    const T = TARGETS[name];
    if (!T) { console.log(`unknown target ${name}`); continue; }
    const u = new URL(T.page, rig.origin);
    for (const [k, v] of new URLSearchParams(T.query)) u.searchParams.set(k, v);
    if (!NO_DIAG) u.searchParams.set("cfg_GFX_SHADER_DIAGNOSTICS", "1");
    if (GPU) u.searchParams.set("gpu", GPU);
    try { await rig.send("Storage.clearDataForOrigin", { origin: rig.origin.replace(/\/$/, ""), storageTypes: "local_storage,indexeddb,cache_storage,service_workers" }); } catch (_) {}
    rig.clearErrors();
    const t0 = Date.now();
    await rig.send("Page.navigate", { url: u.href });
    await sleep(800);
    let ok = false;
    const until = t0 + BOOT_MS;
    while (Date.now() < until) {
      if (T.enter) { try { await rig.evl(`(function(){try{${T.enter}}catch(e){}return 1})()`); } catch (_) {} }
      try { ok = !!(await rig.evl(`(function(){try{return !!(${T.ready})}catch(e){return false}})()`)); } catch (_) {}
      if (ok) break;
      await sleep(700);
    }
    const bootMs = Date.now() - t0;
    if (ok) await sleep(SETTLE);
    let info = null;
    try {
      info = await rig.evl(`(function(){ var R = (window.CBZ && CBZ.renderer) || window.__renderer || null; var i = R && R.info;
        return { three: window.THREE && THREE.REVISION, backend: R ? (R.isWebGPURenderer ? (R.backend && R.backend.isWebGPUBackend ? 'webgpu' : 'webgpu-gl') : 'webgl') : null,
          calls: i && i.render && i.render.calls, tris: i && i.render && i.render.triangles, programs: i && i.programs ? i.programs.length : null,
          geos: i && i.memory && i.memory.geometries, tex: i && i.memory && i.memory.textures }; })()`);
    } catch (_) {}
    // THE r187 SAMPLER TRAP: an sRGB-tagged texture is decoded by the GPU
    // (SRGB8_ALPHA8) in EVERY shader now; r128 decoded only in the built-in
    // map chunks and handed a custom sampler the raw bytes. So a custom
    // sampler bound to an sRGB texture reads different numbers than it did.
    let srgbSamplers = null;
    try {
      srgbSamplers = await rig.evl(`(function(){
        var R = (window.CBZ && CBZ.renderer) || null; if (!R || !R.properties) return null;
        var B = {map:1,alphaMap:1,aoMap:1,bumpMap:1,normalMap:1,displacementMap:1,emissiveMap:1,envMap:1,lightMap:1,metalnessMap:1,roughnessMap:1,
          specularMap:1,clearcoatMap:1,clearcoatNormalMap:1,clearcoatRoughnessMap:1,gradientMap:1,matcap:1,transmissionMap:1,thicknessMap:1,
          sheenColorMap:1,sheenRoughnessMap:1,specularColorMap:1,specularIntensityMap:1,iridescenceMap:1,iridescenceThicknessMap:1,anisotropyMap:1,
          pointShadowMap:1,directionalShadowMap:1,spotShadowMap:1,sunShadowMap:1,spotLightMap:1,ltc_1:1,ltc_2:1,transmissionSamplerMap:1,
          transmissionDepthMap:1,morphTargetsTexture:1,boneTexture:1,dfgLUT:1};
        var out = {}, seen = new Set();
        var roots = [window.CBZ && CBZ.scene].filter(Boolean);
        roots.forEach(function(S){ S.traverse(function(o){
          var ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
          if (o.customDepthMaterial) ms = ms.concat([o.customDepthMaterial]);
          ms.forEach(function(m){
            if (!m || seen.has(m)) return; seen.add(m);
            var p = R.properties.get(m), u = p && p.uniforms; if (!u) return;
            var custom = m.isShaderMaterial || m.isRawShaderMaterial;
            for (var k in u) {
              if (!custom && B[k]) continue;
              var v = u[k] && u[k].value, arr = Array.isArray(v) ? v : [v];
              for (var i = 0; i < arr.length; i++) { var t = arr[i];
                if (t && t.isTexture && t.colorSpace === THREE.SRGBColorSpace) { var key = (m.name || m.type) + " ." + k + (custom ? " (shader)" : " (hook)"); out[key] = (out[key] || 0) + 1; } }
            }
          });
        }); });
        return out; })()`);
    } catch (_) {}
    let shot = null;
    if (SHOTS && ok) {
      try {
        const r = await rig.send("Page.captureScreenshot", { format: "png" });
        if (r.result && r.result.data) { mkdirSync(SHOTS, { recursive: true }); shot = path.join(SHOTS, name + ".png"); writeFileSync(shot, Buffer.from(r.result.data, "base64")); }
      } catch (_) {}
    }
    let log = [];
    try { log = (await rig.evl("(window.__cbzLog||[]).slice(0, 4000)")) || []; } catch (_) {}
    const errs = log.filter((l) => !l.startsWith("warn:")).concat(rig.errors.filter((e) => !e.startsWith("console.error")).map((e) => "cdp: " + e));
    const warns = log.filter((l) => l.startsWith("warn:"));
    const shaderErrs = errs.filter((l) => /Shader Error|THREE\.WebGLProgram|shader/i.test(l)).length;
    const res = { name, ok, bootMs, errors: errs.length, shaderErrors: shaderErrs, warnings: warns.length, info, shot, srgbSamplers,
      errorGroups: group(errs).slice(0, 25), warnGroups: group(warns).slice(0, 25), allErrors: errs };
    results.push(res);
    console.log(`\n== ${name}: ${ok ? "BOOTED" : "NOT READY"} in ${(bootMs / 1000).toFixed(1)} s  errors ${errs.length} (shader ${shaderErrs})  warnings ${warns.length}  ${info ? JSON.stringify(info) : ""}`);
    for (const [k, n] of res.errorGroups) console.log(`   E x${n}  ${k}`);
    for (const [k, n] of res.warnGroups.slice(0, 12)) console.log(`   W x${n}  ${k.slice(0, 220)}`);
    // samplers already reviewed for the trap (their shader expects GPU-decoded texels)
    const REVIEWED = /\.(uGnd[GDSR]|uVolGrass|uCamo|uMap) \(/;
    const rev = Object.keys(srgbSamplers || {}).filter((k) => REVIEWED.test(k)).length;
    for (const [k, n] of Object.entries(srgbSamplers || {})) if (!REVIEWED.test(k)) console.log(`   S x${n}  sRGB texture on a custom sampler (REVIEW): ${k}`);
    if (rev) console.log(`   S (${rev} reviewed sRGB samplers: ground skin / volcano grass / camo / tree bake)`);
  }
} finally {
  await rig.close();
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(results, null, 1));
const bad = results.filter((r) => !r.ok || r.errors);
console.log(`\n${results.length - bad.length}/${results.length} clean${bad.length ? "; not clean: " + bad.map((r) => r.name).join(", ") : ""}`);
process.exit(bad.length ? 1 : 0);
