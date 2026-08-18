#!/usr/bin/env node
/* tools/shaft-mask-probe.mjs — WHY IS THE HOLE A RING ON A PHONE?
 *
 * The lid regression (tools/sinkhole-check.mjs) passes on this machine and the
 * storyboard photographs an open shaft on both sides, while the same build on
 * the owner's iPhone draws grass and road straight across the mouth. That is a
 * mask that JS thinks it applied, so the interesting question is not "did
 * maskMaterial run" (it did) but "did the program the GPU is actually running
 * come out with the discard in it".
 *
 * RE-POINTED for core/groundmask.js. The discard is no longer stamped onto
 * materials one at a time — it lives in THREE.ShaderChunk's fog chunks, so it
 * is in every fogged program by construction. That deletes the class of fault
 * this probe was built to chase (a material JS believed it had patched), but
 * NOT the question, which is the good one and is now global: does the program
 * the GPU actually linked contain the discard and the uniform?
 *
 * So this probe asks the GL context directly, per ground material:
 *   masked              does JS believe this material carries the mask
 *   program LINK_STATUS core/renderer.js sets debug.checkShaderErrors = false
 *                       by default, so a failed link is SILENT and the mesh
 *                       just "renders wrong" — exactly the reported symptom
 *   uCbzHoles[0] location  is the uniform actually in the linked program
 *   uCbzHoles in source    is the discard in the shader the GPU compiled
 *
 * and reports the device limits the injection spends: one extra varying
 * (vec3 vCbzGW) and GROUND_MASK_SLOTS vec4s of fragment uniform.
 *
 * Run: node tools/shaft-mask-probe.mjs [--webgl1] [--mobile]
 *   --webgl1  force a WebGL1 context (older iOS Safari) instead of WebGL2
 *   --mobile  iPhone metrics + user agent + touch
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "tools", "shots", "shaft-mask-probe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const WEBGL1 = argv.includes("--webgl1");
const MOBILE = argv.includes("--mobile");
const tag = `${WEBGL1 ? "webgl1" : "webgl2"}-${MOBILE ? "mobile" : "desktop"}`;

const serverPort = 9700 + Math.floor(Math.random() * 150);
const debugPort = 11300 + Math.floor(Math.random() * 150);
const profile = `/tmp/cbz-maskprobe-${debugPort}`;

function findChrome() {
  if (process.env.CBZ_CHROME) return process.env.CBZ_CHROME;
  const fixed = [
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  ];
  for (const c of fixed) if (existsSync(c)) return c;
  const pw = "/opt/pw-browsers";
  if (existsSync(pw)) {
    for (const dir of readdirSync(pw).filter((d) => d.startsWith("chromium")).sort().reverse()) {
      for (const leaf of ["chrome-linux/chrome", "chrome-linux/headless_shell"]) {
        const c = path.join(pw, dir, leaf);
        if (existsSync(c)) return c;
      }
    }
  }
  return "chromium";
}

await mkdir(OUT, { recursive: true });
await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  cwd: ROOT, env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
// shader diagnostics ON: the whole point is to see the error the shipping
// build deliberately swallows
const base = `http://127.0.0.1:${serverPort}/?seed=90210&cfg_GFX_SHADER_DIAGNOSTICS=1`;
const flags = [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--mute-audio",
  "--window-size=1200,750", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
];
if (WEBGL1) flags.push("--disable-es3-gl-context", "--disable-webgl2");
const chrome = spawn(findChrome(), [...flags, base], { cwd: ROOT, stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 300000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const msg = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  const r = msg && msg.result;
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r && r.result && r.result.value;
}
const json = async (expr) => JSON.parse(await evaluate(`JSON.stringify((function(){${expr}})())`));

const PROBE = String.raw`
window.__probe = {
  step: function (secs) {
    var n = Math.round(secs * 60);
    for (var i = 0; i < n; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; } }
  },
  root: function () {
    return (CBZ.game.mode === "survival" && CBZ.surv && CBZ.surv.arena) ? CBZ.surv.arena.root : CBZ.scene;
  },
  caps: function () {
    var gl = CBZ.renderer.getContext();
    var hf = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    var mf = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT);
    return {
      webgl2: !!CBZ.renderer.capabilities.isWebGL2,
      rendererPrecision: CBZ.renderer.capabilities.precision,
      fragHighpBits: hf ? hf.precision : -1,
      fragMediumpBits: mf ? mf.precision : -1,
      maxVaryingVectors: gl.getParameter(gl.MAX_VARYING_VECTORS),
      maxFragUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
      maxVertUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
      shaftSlots: CBZ.shaftAudit ? CBZ.shaftAudit().maskSlots : null,
      checkShaderErrors: !!CBZ.renderer.debug.checkShaderErrors,
    };
  },
  /* THE MEASUREMENT: for every ground-ish material over a mouth, ask the GL
     context what actually got linked — not what maskMaterial believes. */
  programs: function () {
    /* RENDER FIRST. A material's program is created on its first draw, so
       reading renderer.properties before a frame leaves program null for
       everything — which used to make this probe report a green that had
       inspected nothing at all. */
    /* compile() initialises every material in the scene whether or not it is
       on screen this frame; a plain render only reaches what survived culling,
       which is why aiming the camera elsewhere left this probe with nothing. */
    try { CBZ.renderer.compile(CBZ.scene, CBZ.camera); } catch (e) {}
    try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}
    var gl = CBZ.renderer.getContext();
    var props = CBZ.renderer.properties;
    var S = CBZ.groundShafts || [];
    var out = [], seen = [];
    if (!S.length) return out;
    var box = new THREE.Box3();
    for (var s = 0; s < S.length; s++) {
      var h = S[s];
      window.__probe.root().traverse(function (o) {
        if (!o.isMesh || !o.geometry || !o.material) return;
        for (var p = o; p; p = p.parent) if (p.userData && p.userData.groundShaft) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        if (box.max.y - box.min.y > 3) return;
        if (box.max.y < h.gy - 3 || box.min.y > h.gy + 0.35) return;
        if (box.max.x < h.x - h.mouth || box.min.x > h.x + h.mouth) return;
        if (box.max.z < h.z - h.mouth || box.min.z > h.z + h.mouth) return;
        if (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) < 1.5) return;
        var m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (!m || seen.indexOf(m.uuid) >= 0) return;
        seen.push(m.uuid);
        var rec = {
          mat: m.name || m.type, mesh: o.name || o.type,
          // no per-material stamp exists any more: a material carries the mask
          // unless it has no fog chunks (fog:false) or opted out (CBZ_NOMASK)
          masked: m.fog !== false && !(m.defines && m.defines.CBZ_NOMASK),
          exempt: !!(m.defines && m.defines.CBZ_NOMASK), noFog: m.fog === false,
          program: null, linked: null, uHolesLoc: null, srcHasUHoles: null,
          srcHasDiscard: null, glError: null,
        };
        /* r128 STORES IT AS currentProgram. This probe read .program,
           which does not exist on a material's property entry in this revision
           — so every record came back program:null and the probe reported a
           confident green having inspected nothing, including while it was
           being used to chase the phone regression. Found by dumping
           Object.keys(renderer.properties.get(mat)). */
        var pr = props.get(m).currentProgram;
        if (pr) {
          rec.program = true;
          var gp = pr.program;
          rec.linked = !!gl.getProgramParameter(gp, gl.LINK_STATUS);
          rec.uHolesLoc = gl.getUniformLocation(gp, "uCbzHoles[0]") !== null;
          try {
            var shaders = gl.getAttachedShaders(gp) || [];
            for (var k = 0; k < shaders.length; k++) {
              var src = gl.getShaderSource(shaders[k]) || "";
              if (src.indexOf("gl_FragColor") >= 0 || src.indexOf("pc_fragColor") >= 0) {
                rec.srcHasUHoles = src.indexOf("uCbzHoles") >= 0;
                rec.srcHasDiscard = src.indexOf("discard") >= 0;
                rec.compiled = !!gl.getShaderParameter(shaders[k], gl.COMPILE_STATUS);
                rec.log = (gl.getShaderInfoLog(shaders[k]) || "").slice(0, 400);
              }
            }
          } catch (e) { rec.glError = String(e).slice(0, 200); }
        }
        out.push(rec);
      });
    }
    return out;
  },
};
true;`;

const failures = [];
let result = {};
try {
  let page = null;
  for (let i = 0; i < 240 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((p) => p.type === "page" && p.url.startsWith(`http://127.0.0.1:${serverPort}/`));
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("Chrome page never appeared");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params?.exceptionDetails;
      const t = d?.exception?.description || d?.text || "exception";
      if (!/ProgressEvent/.test(t)) browserErrors.push(t.slice(0, 500));
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      browserErrors.push(msg.params.args.map((a) => a.value || a.description || "").join(" ").slice(0, 800));
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  if (MOBILE) {
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Emulation.setUserAgentOverride", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    });
  } else {
    await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 750, deviceScaleFactor: 1, mobile: false });
  }

  for (let i = 0; i < 240; i++) {
    if (await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.setMode && CBZ.stepSim && CBZ.disasters && CBZ.shaftAudit)")) break;
    await sleep(250);
  }
  await evaluate(PROBE);

  await json(`CBZ.setMode("survival"); CBZ.resetGame(); CBZ.setState("playing");
    window.requestAnimationFrame = function(){return 0;}; return {ok:1};`);
  await sleep(200);
  await evaluate(`(function(){__probe.step(2);})()`);
  const caps = await json(`return __probe.caps();`);

  await json(`CBZ.disasters.force("sinkhole"); __probe.step(0.2);
    var g=600; while(g-->0 && CBZ.disasters.state()!=="active") __probe.step(0.1);
    __probe.step(26); return {state:CBZ.disasters.state()};`);

  /* THE REPRODUCTION. core/gfx.js swaps mesh.material between a Lambert and a
     Standard twin whenever the quality tier's pbr flag flips, and core/gfx.js
     promoteMerged() swaps merged batch output the same way. The shaft mask is
     a stamp on the material OBJECT, applied once when the hole was cut — so a
     tier flip hands every ground mesh a material that has never been masked
     and the ground draws straight back over the mouth. A desktop sits at a
     fixed tier and never sees it; a phone drops tiers exactly when a disaster
     is running, which is when a sinkhole exists to be covered up. */
  const tierFlip = await json(`
    var before = CBZ.shaftAudit().lidsOverMouth;
    CBZ.gfxSyncMaterials(false); __probe.step(0.1);
    var demoted = CBZ.shaftAudit().lidsOverMouth;
    CBZ.gfxSyncMaterials(true); __probe.step(0.1);
    var promoted = CBZ.shaftAudit().lidsOverMouth;
    CBZ.gfxSyncMaterials(false); __probe.step(0.1);
    var back = CBZ.shaftAudit().lidsOverMouth;
    return { lidsBefore: before, lidsAfterDemote: demoted, lidsAfterPromote: promoted, lidsBackToLambert: back };`);

  /* THE SELF-HEAL, PROVED WITHOUT A PHONE. I could not reproduce the owner's
     exact trigger here (the tier swap above does not touch the survival
     island's raw Lambert ground), so the fix is deliberately cause-blind and
     this is what pins it: hand the game the two shapes the failure can take —
     ground that did not exist when the shaft was cut, and a mesh whose
     material got swapped for a different object — and require the mask to
     come back on its own. */
  const selfHeal = await json(`
    var S = CBZ.groundShafts || []; var h = S[0];
    if (!h) return { skipped: 1 };
    var root = (CBZ.surv && CBZ.surv.arena) ? CBZ.surv.arena.root : CBZ.scene;

    // (1) ground that arrives AFTER the hole — a batch merge, an LOD swap
    var g = new THREE.Mesh(new THREE.PlaneGeometry(h.mouth * 2.2, h.mouth * 2.2),
                           new THREE.MeshLambertMaterial({ color: 0x53a84e }));
    g.rotation.x = -Math.PI / 2; g.position.set(h.x, h.gy + 0.02, h.z);
    root.add(g);
    // a freshly added mesh carries an identity matrixWorld until something
    // renders, and every footprint test in this file is in WORLD space — so
    // without this the probe measures a plane sitting at the origin
    g.updateMatrixWorld(true);
    var newGround = CBZ.shaftAudit().lidsOverMouth;
    __probe.step(3.0);
    var newGroundHealed = CBZ.shaftAudit().lidsOverMouth;

    // (2) a mesh whose material is replaced by a different object, which is
    //     exactly what core/gfx.js's Lambert/Standard twin swap does
    var victim = null;
    root.traverse(function (o) {
      if (victim || !o.isMesh || !o.material || Array.isArray(o.material)) return;
      if (o === g || !o.material._shaftMasked) return;
      if (!o.geometry || !o.geometry.boundingBox) { if (o.geometry) o.geometry.computeBoundingBox(); }
      victim = o;
    });
    var swapped = null, swappedHealed = null;
    if (victim) {
      victim.material = victim.material.clone();     // clone drops _shaftMasked
      swapped = !!victim.material._shaftMasked;
      __probe.step(0.2);
      swappedHealed = !!victim.material._shaftMasked;
    }
    var a = CBZ.shaftAudit();
    return {
      lidsWhenNewGroundArrives: newGround, lidsAfterReSweep: newGroundHealed,
      swappedMaskedImmediately: swapped, swappedMaskedAfterHeal: swappedHealed,
      reMasked: a.reMasked, reSweeps: a.reSweeps, sweptMeshes: a.sweptMeshes,
    };`);

  const audit = await json(`return CBZ.shaftAudit();`);
  const programs = await json(`return __probe.programs();`);

  // render one frame at the shaft so the screenshot shows what the GPU makes of it
  await evaluate(`(function(){
    var S = CBZ.groundShafts || []; var h = S[0]; if (!h) return;
    var c = CBZ.camera; c.fov = 55; c.near = 0.4; c.far = 20000;
    c.position.set(h.x + h.r*8, h.gy + h.r*8*Math.tan(9*Math.PI/180), h.z + h.r*8);
    c.lookAt(h.x, h.gy - 0.5, h.z); c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    if (typeof CBZ.skySync === "function") CBZ.skySync();
    var cv = CBZ.renderer && CBZ.renderer.domElement;
    for (var k=0, ch=Array.prototype.slice.call(document.body.children); k<ch.length; k++) {
      if (ch[k]===cv || (cv && ch[k].contains && ch[k].contains(cv))) continue;
      ch[k].style.visibility="hidden";
    }
    CBZ.renderer.render(CBZ.scene, CBZ.camera);
  })()`);
  const png = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(OUT, `${tag}.png`), Buffer.from(png.result.data, "base64"));

  /* A PROBE THAT INSPECTED NOTHING MUST NOT REPORT GREEN. This is the same
     discipline the sinkhole check applies to its own phases: the failure mode
     of a device probe is not a wrong answer, it is a confident answer about an
     empty set. */
  {
    const linked = programs.filter((r) => r.program && r.linked);
    if (!programs.length) failures.push("no ground material over any mouth was found — the probe inspected nothing");
    else if (!linked.length) failures.push(`inspected ${programs.length} ground materials and NONE had a linked GL program — the probe proved nothing`);
    else {
      const noUniform = linked.filter((r) => r.uHolesLoc !== true);
      const noDiscard = linked.filter((r) => r.srcHasUHoles !== true);
      if (noUniform.length) failures.push(`${noUniform.length}/${linked.length} linked ground programs lack the uCbzHoles uniform`);
      if (noDiscard.length) failures.push(`${noDiscard.length}/${linked.length} linked ground programs lack the discard in their compiled source`);
    }
  }

  if (!selfHeal.skipped) {
    if (selfHeal.lidsAfterReSweep > 0) failures.push(`ground added over an open mouth was never re-swept (lids ${selfHeal.lidsWhenNewGroundArrives} -> ${selfHeal.lidsAfterReSweep})`);
    if (selfHeal.swappedMaskedImmediately === false && selfHeal.swappedMaskedAfterHeal === false) failures.push("a swapped-out ground material was never re-masked");
  }
  if (tierFlip.lidsAfterDemote > tierFlip.lidsBefore || tierFlip.lidsAfterPromote > tierFlip.lidsBefore || tierFlip.lidsBackToLambert > tierFlip.lidsBefore) {
    failures.push(`a quality-tier material swap un-masks the ground: lids ${tierFlip.lidsBefore} -> demote ${tierFlip.lidsAfterDemote} / promote ${tierFlip.lidsAfterPromote} / back ${tierFlip.lidsBackToLambert}`);
  }

  result = { tag, caps, tierFlip, selfHeal, audit: {
    shafts: audit.shafts, lidsOverMouth: audit.lidsOverMouth,
    ringsOnSolidGround: audit.ringsOnSolidGround, throatShade: audit.throatShade,
  }, programs, browserErrors: browserErrors.slice(0, 12), failures };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(failures.length ? `\nPROBE FOUND: ${failures.join("; ")}\n` : `\nPROBE: every ground program carries the discard (${tag})\n`);
} catch (err) {
  process.stdout.write(`PROBE ERROR: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch (_) {}
  chrome.kill("SIGKILL");
  server.kill("SIGKILL");
  await rm(profile, { recursive: true, force: true });
}
