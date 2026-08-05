#!/usr/bin/env node
/*
  tools/nuke-smoke-check.mjs — IS THE NUCLEAR CLOUD SMOKE, OR IS IT ROCKS?

  The owner has now filed the same complaint twice from opposite directions,
  and both are legitimate:
    2026-08-03  "slightly opaque orange floating rocks"  -> the BODY of the
                cloud must not be see-through.
    2026-08-05  "they look like rocks... a little geometric instead of
                looking like smoke"                      -> a lobe must not
                have an outline, so its RIM must not be opaque.
  One per-lobe alpha cannot satisfy both. Overlap can, and this probe is the
  arithmetic that says whether it did: it fires one real nuke through the full
  game path, renders each beat (which is also the only way to force the lobe
  shader to actually COMPILE — a broken onBeforeCompile patch once shipped as
  an invisible cloud), and reads CBZ.nukeSmokeAudit() off the LIVE instance
  matrices.

  It asserts, per cold layer, per beat:
    * the layer blends instead of writing depth (else overlaps hard-clip and
      a soft rim reveals sky rather than the lobe behind it)
    * accumulated coverage through the body >= BODY_MIN  (not see-through)
  ...plus: the compiled programs all carry the same smoke patch id (all four
  lobe materials declare one customProgramCacheKey — r128 keys the cache on
  onBeforeCompile SOURCE, so a per-material closure would silently fork or
  silently merge), and no shader-compile error reached the console.

  WHAT THIS PROBE DELIBERATELY DOES NOT MEASURE, and the trap worth naming:
  the first draft also asserted a per-lobe alpha CEILING as a stand-in for
  "the rim still wisps". That is the wrong quantity. Per-lobe alpha is the
  density at the CENTRE of a lobe; the rim is driven to zero by the shader's
  own falloff (thickness term x mask erosion, no floor), independent of it.
  Worse, on a single-file layer like the stem — where a ray crosses ~1.6
  lobes — a centre ceiling and a body floor are arithmetically incompatible,
  so the pair could only ever be satisfied by making the cloud see-through.
  A dense middle is not what looked like rock. The no-floor silhouette is
  asserted where it is actually decidable, in the source, by
  tools/test-nukefx-phases.mjs; how it LOOKS is the owner's call.

  It also times 8 repeat renders per beat. Blended lobes lose the early-z
  rejection a depth-writing pass gave them, so the cloud's overdraw goes up;
  --cfg NUKE_FX_SMOKE_LOBES=0 runs the same beats on the old path so the two
  numbers can be read side by side instead of asserted away. (SwiftShader, so
  the ratio is the signal, not the absolute ms.)

  Usage: node tools/nuke-smoke-check.mjs [--seed 90210] [--url URL] [--json]
                                         [--cfg FLAG=0]
  (starts its own devserver when --url is omitted)
*/

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const token = process.argv[i];
  if (token.startsWith("--")) {
    args[token.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
      ? process.argv[++i] : true;
  }
}
const SEED = Number(args.seed || 90210);
/* The body must read as one mass. 0.93 is the measured floor across the
   sequence with a little margin, not a wish: the thinnest live layer is the
   stem at t=15 (1.56 lobes crossed, 0.84 each -> 0.943). Raising this means
   raising per-lobe density, which is the axis that trades back toward
   opaque-object; lower it only with a measurement, never to make a run pass. */
const BODY_MIN = 0.93;
const BEATS = [3.5, 8, 15, 26];
// ?cfg_<FLAG>=0/1 overrides a CBZ.CONFIG flag BEFORE boot — the only way to
// A/B a build-time flag headless (a same-page reset reuses the built world).
const CFG = typeof args.cfg === "string" ? String(args.cfg) : "";

const webPort = 8600 + Math.floor(Math.random() * 300);
const debugPort = 10100 + Math.floor(Math.random() * 300);
const url = args.url ? String(args.url) : `http://127.0.0.1:${webPort}/`;
const chromeBin = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const profileDir = await mkdtemp(path.join(tmpdir(), "cbz-nuke-smoke-"));
const children = [];
if (!args.url) {
  children.push(spawn("python3", [path.join(ROOT, "tools", "devserver.py")], {
    cwd: ROOT, env: { ...process.env, PORT: String(webPort) }, stdio: "ignore",
  }));
}
children.push(spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--mute-audio",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--window-size=960,600",
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, "about:blank",
], { cwd: ROOT, stdio: "ignore" }));

let ws; let seq = 1; const pending = new Map();
const consoleErrors = [];
function send(method, params = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = seq++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evl(expression, timeoutMs = 120000) {
  const message = await send("Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (message.exceptionDetails) {
    throw new Error(message.exceptionDetails.exception?.description || message.exceptionDetails.text);
  }
  return message.result?.value;
}

let failures = [];
try {
  const deadline = Date.now() + 30000;
  let page = null;
  while (Date.now() < deadline && !page) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((candidate) => candidate.type === "page") || null;
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("no debugger page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      const text = (message.params.args || [])
        .map((a) => String(a.value ?? a.description ?? "")).join(" ");
      consoleErrors.push(text);
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const op = pending.get(message.id);
    pending.delete(message.id); clearTimeout(op.timer);
    if (message.error) op.reject(new Error(message.error.message)); else op.resolve(message.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  const navUrl = `${url}?seed=${SEED}` + (CFG ? `&cfg_${CFG}` : "");
  await send("Page.navigate", { url: navUrl });

  let booted = false;
  for (let i = 0; i < 600 && !booted; i++) {
    try {
      booted = !!(await evl(
        "!!(window.CBZ && CBZ.game && (CBZ.bootComplete || CBZ.game.state === 'title') && CBZ.stepSim && document.getElementById('playBtn'))"));
    } catch (_) {}
    if (!booted) await sleep(300);
  }
  if (!booted) throw new Error("never booted");
  await evl("(() => { if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return true; })()");
  let playing = false;
  for (let i = 0; i < 300 && !playing; i++) {
    playing = await evl("(() => { if (CBZ.game.state === 'playing') return true; const b = document.getElementById('playBtn'); if (b) b.click(); return CBZ.game.state === 'playing'; })()");
    if (!playing) await sleep(250);
  }
  if (!playing) throw new Error("never playing");

  const report = await evl(`(async () => {
    const CBZ = window.CBZ;
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    // Headless settles into the LOW quality tier, which halves the lobe
    // counts; the owner plays high, so pin the tier BEFORE the cloud composes
    // or the coverage arithmetic describes a build nobody looks at.
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(3); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await new Promise((r) => setTimeout(r, 700));
    for (let i = 0; i < 120; i++) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1/60); }

    const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
    let gx = 0, gz = 0, n = 0;
    for (const lot of lots) {
      const x = Number(lot.x != null ? lot.x : lot.cx), z = Number(lot.z != null ? lot.z : lot.cz);
      if (Number.isFinite(x) && Number.isFinite(z)) { gx += x; gz += z; n++; }
    }
    gx = n ? gx / n : 0; gz = n ? gz / n : 0;
    const gy = (CBZ.floorAt && CBZ.floorAt(gx, gz)) || 0;
    if (CBZ.player && CBZ.player.pos && CBZ.player.pos.set) {
      CBZ.player.pos.set(gx, gy + 1.1, gz + 5000);
      CBZ.player.hp = 100;
    }

    if (typeof CBZ.strategicNukeDetonate === "function") CBZ.strategicNukeDetonate(gx, gz, { byPlayer: false });
    else CBZ.detonate(gx, gy + 1.2, gz, "nuke", { byPlayer: false });

    const beats = ${JSON.stringify(BEATS)};
    const out = [];
    let t = 0;
    const cam = CBZ.camera;
    for (const target of beats) {
      while (t < target - 1e-6) {
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        CBZ.stepSim(1/60); t += 1/60;
        if (CBZ.player) CBZ.player.hp = 100;
      }
      // RENDER: the only thing that compiles the lobe shader. A patch that
      // fails to compile shows up as a console error here, never in the math.
      cam.far = 60000; cam.near = 2;
      cam.position.set(gx, gy + 600, gz + 6000);
      cam.lookAt(gx, gy + 1600, gz);
      cam.updateProjectionMatrix();
      try { CBZ.renderer.render(CBZ.scene, cam); } catch (e) {}
      // FILL RATE: repeat renders of the identical frame. The first one pays
      // shader compilation, so it is thrown away.
      const samples = [];
      for (let i = 0; i < 8; i++) {
        const t0 = performance.now();
        try { CBZ.renderer.render(CBZ.scene, cam); } catch (e) {}
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      const audit = typeof CBZ.nukeSmokeAudit === "function" ? CBZ.nukeSmokeAudit() : null;
      out.push({
        t: Number(t.toFixed(2)), audit: audit,
        renderMs: Number(samples[Math.floor(samples.length / 2)].toFixed(1)),
      });
    }
    // r128 keys the program cache on the customProgramCacheKey string; all
    // four lobe materials declare the same one, so they must share ONE.
    const smokeKeys = [];
    try {
      const programs = (CBZ.renderer.info && CBZ.renderer.info.programs) || [];
      for (const p of programs) {
        const key = String(p.cacheKey || "");
        // NEVER slice before matching: three appends customProgramCacheKey at
        // the END of the cache key, so a head slice hides the very thing this
        // is looking for (it silently reported "none" once).
        const id = (key.match(/cbzSmokeLobes[0-9]+/) || [])[0];
        if (id) smokeKeys.push(id);
      }
    } catch (e) {}
    return {
      beats: out, smokeKeys: smokeKeys,
      flags: typeof CBZ.nukeFxDebug === "function" ? CBZ.nukeFxDebug().flags : null,
    };
  })()`, 600000);

  if (args.json) console.log(JSON.stringify(report, null, 1));

  const shaderErrors = consoleErrors.filter((line) => /shader|program|GLSL|WebGL/i.test(line));
  const rows = [];
  for (const beat of report.beats) {
    const audit = beat.audit;
    if (!audit) { failures.push(`t=${beat.t}: CBZ.nukeSmokeAudit() missing`); continue; }
    if (!audit.smokeLobes) failures.push(`t=${beat.t}: NUKE_FX_SMOKE_LOBES is off`);
    if (!audit.mask) failures.push(`t=${beat.t}: no smoke mask bound`);
    for (const key of ["cap", "crown", "stem", "surge"]) {
      const layer = audit.layers[key];
      if (!layer) { failures.push(`t=${beat.t} ${key}: layer missing`); continue; }
      if (!layer.visible || !layer.coverage) continue;   // not up yet at this beat
      if (layer.depthWrite) failures.push(`t=${beat.t} ${key}: still writing depth`);
      // The crown/collar is a SHELL over the cap and a SKIRT under its rim —
      // a ring, not a mass — so no ray through the cloud's axis crosses more
      // than about one of its lobes and a body-coverage floor is meaningless
      // for it. Its mass is the cap behind it. It is still held to the rim
      // rule, which is the half that says "no outline".
      if (key !== "crown" && layer.coverage.mean < BODY_MIN) {
        failures.push(`t=${beat.t} ${key}: body coverage ${layer.coverage.mean} < ${BODY_MIN} (see-through)`);
      }
      rows.push({
        t: beat.t, layer: key, lobes: layer.lobes, alpha: layer.perLobeAlpha,
        depthWrite: layer.depthWrite, hitsMean: layer.hits.mean,
        bodyCov: layer.coverage.mean, renderMs: beat.renderMs,
      });
    }
  }
  /* One compiled program per DISTINCT r128 cache key. The four lobe
     materials all declare the same customProgramCacheKey, so they may never
     fork on our patch — but the renderer legitimately keeps more than one
     entry when something outside the material changes mid-run (the quality
     tier this probe pins re-specs the shadow map, which re-keys every
     program). So the rule is: our key must be present, and every entry
     carrying it must agree on the patch identity. */
  if (!report.smokeKeys.length) failures.push("no compiled program carries the smoke patch");
  const patchIds = new Set(report.smokeKeys);
  if (patchIds.size > 1) {
    failures.push(`lobe materials forked into ${patchIds.size} smoke programs: ${[...patchIds].join(", ")}`);
  }
  if (shaderErrors.length) failures.push(`shader errors: ${shaderErrors.slice(0, 2).join(" | ")}`);

  console.table(rows);
  console.log("render ms (median of 8, SwiftShader): " +
    report.beats.map((b) => `t=${b.t}:${b.renderMs}`).join("  "));
  console.log(`smoke programs: ${report.smokeKeys.length} (patch ids: ${[...patchIds].join(", ") || "none"}) ` +
    `· flags.smokeLobes: ${report.flags && report.flags.smokeLobes}`);
  if (failures.length) {
    console.error("\nnuke smoke check: FAIL");
    for (const line of failures) console.error("  - " + line);
  } else {
    console.log(`\nnuke smoke check: OK (body >= ${BODY_MIN} through every live ` +
      `mass layer, nothing writes depth, one shared smoke program)`);
  }
} finally {
  if (ws && ws.readyState <= 1) ws.close();
  for (const child of children.reverse()) if (!child.killed) child.kill("SIGTERM");
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
process.exit(failures.length ? 1 : 0);
