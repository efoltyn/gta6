#!/usr/bin/env node
/*
  tools/nuke-look.mjs — the nuke (and the B-2) as a storyboard.

  Boots the city headless on the real GPU (ANGLE/Metal on a Mac), fires a
  nuke through the full game path, freezes the rAF loop so CBZ.stepSim is
  the only clock, and at each beat renders from a set of tripods, saving a
  PNG and the GPU cost of the frame with and without the cloud (readPixels
  sync). At the end every shot is laid out as ONE contact sheet
  (rows = beats, columns = camera spots) by tools/contact-sheet.py.

  Usage:
    node tools/nuke-look.mjs --storyboard [--out DIR] [--open]
        beats 0,0.1,0.5,1,2,5,10,20,40,90,180 from ground2k, ground8k,
        aerial and chase (the player's own third-person framing)
    node tools/nuke-look.mjs --b2 [--out DIR] [--open]
        the B-2 parked, rolling, from below, bay open, from above + the B-52
    node tools/nuke-look.mjs [--beats 1,6,34] [--tripods street,bomber,far]
        the old ad-hoc mode
  Common: [--fxonly] (draw-only nuke, fast look loop) [--url URL] [--w 1280 --h 720] [--quality 3] [--swiftshader]
          [--hour 10] [--label before]

  Tripods (distance from ground zero, height above the local deck):
    ground2k  2 km, eye height        ground8k  8 km, eye height
    aerial    9 km out, 1.8 km up (airborne fog)    chase     the player 3 km out, camera
                                                 behind the shoulder
    street/bomber/far — the old three
*/
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith("--")) args[k.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
}
const MODE = args.b2 ? "b2" : (args.storyboard ? "storyboard" : "adhoc");
const OUT = path.resolve(String(args.out || path.join(tmpdir(), "nuke-look-" + MODE)));
const W = Number(args.w || 1280), H = Number(args.h || 720);
const SB_BEATS = "0,0.1,0.5,1,2,5,10,20,40,90,180";
const BEATS = String(args.beats || (MODE === "storyboard" ? SB_BEATS : "0.4,1.2,3,8,16,34,90")).split(",").map(Number);
const Q = Number(args.quality == null ? 3 : args.quality);
const HOUR = Number(args.hour == null ? 10 : args.hour);
const LABEL = String(args.label || "");
await mkdir(OUT, { recursive: true });

const webPort = 8600 + Math.floor(Math.random() * 300);
const debugPort = 10100 + Math.floor(Math.random() * 300);
const url = args.url ? String(args.url) : `http://127.0.0.1:${webPort}/`;
const chromeBin = process.env.CBZ_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profileDir = await mkdtemp(path.join(tmpdir(), "cbz-nuke-look-"));
const children = [];
if (!args.url) {
  children.push(spawn("python3", [path.join(ROOT, "tools", "devserver.py")], {
    cwd: ROOT, env: { ...process.env, PORT: String(webPort) }, stdio: "ignore" }));
}
const gpuFlags = args.swiftshader
  ? ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
  : ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];
children.push(spawn(chromeBin, [
  "--headless=new", "--no-sandbox", "--mute-audio", "--enable-webgl", ...gpuFlags,
  `--window-size=${W},${H}`, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, "about:blank",
], { stdio: "ignore" }));

let ws; let seq = 1; const pending = new Map(); const logs = [];
let gpu = null;
function send(method, params = {}, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const id = seq++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evl(expression, timeoutMs = 120000) {
  const m = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
  if (m.exceptionDetails) throw new Error(m.exceptionDetails.exception?.description || m.exceptionDetails.text);
  return m.result?.value;
}
async function shoot(file) {
  const png = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(file, Buffer.from(png.data, "base64"));
  return file;
}
function sheet(manifest, outPng) {
  const mf = path.join(OUT, path.basename(outPng, ".png") + ".json");
  return writeFile(mf, JSON.stringify(manifest, null, 1)).then(() => {
    const r = spawnSync("python3", [path.join(ROOT, "tools", "contact-sheet.py"), mf, outPng], { encoding: "utf8" });
    if (r.status !== 0) console.error("contact sheet failed:", r.stderr);
    return outPng;
  });
}

// Shared staging: hide the HUD, pin the day clock, freeze rAF.
const STAGE = `
  window.__nlHud = function () {
    const cv = CBZ.renderer.domElement;
    for (const c of Array.from(document.body.children)) {
      if (c === cv || c.contains(cv) || c.id === "nukeFlash") continue;
      c.style.visibility = "hidden";
    }
  };
  window.__nlHour = function (h) { if (CBZ.dayPhase) CBZ.dayPhase((((h - 6) / 24) % 1 + 1) % 1); };
  window.__nlTick = function (dt) { CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(dt);
    // the storyboard is about the sky, not about dying in it: no fall damage
    // off the teleports, no WASTED card over the frames
    if (CBZ.game) CBZ.game.invuln = Math.max(CBZ.game.invuln || 0, 5);
    if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.vy = 0; if (CBZ.player.dead) CBZ.player.dead = false; } };
`;

try {
  let page = null;
  for (let i = 0; i < 120 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((p) => p.type === "page"); } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("no debugger page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
      const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (/shader|WebGL|nuke|THREE|b2|B-2/i.test(text)) logs.push(text.slice(0, 600));
    }
    if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
    if (!m.id || !pending.has(m.id)) return;
    const op = pending.get(m.id); pending.delete(m.id); clearTimeout(op.timer);
    if (m.error) op.reject(new Error(m.error.message)); else op.resolve(m.result);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${url}?seed=90210&cfg_GFX_SHADER_DIAGNOSTICS=1` });

  let booted = false;
  for (let i = 0; i < 900 && !booted; i++) {
    try { booted = !!(await evl("!!(window.CBZ && CBZ.game && (CBZ.bootComplete || CBZ.game.state === 'title') && CBZ.stepSim && document.getElementById('playBtn'))")); } catch (_) {}
    if (!booted) await sleep(300);
  }
  if (!booted) throw new Error("never booted");
  await evl("(() => { CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return true; })()");
  let playing = false;
  for (let i = 0; i < 400 && !playing; i++) {
    playing = await evl("(() => { if (CBZ.game.state === 'playing') return true; const b = document.getElementById('playBtn'); if (b) b.click(); return CBZ.game.state === 'playing'; })()");
    if (!playing) await sleep(250);
  }
  if (!playing) throw new Error("never playing");
  gpu = await evl(`(() => { const gl = CBZ.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info');
    return { webgl2: CBZ.renderer.capabilities.isWebGL2, renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) }; })()`);
  await evl(`(async () => {
    ${STAGE}
    if (CBZ.game.cityCampaign) CBZ.game.cityCampaign.phase = "endless_contracts";
    try { if (CBZ.setQualityLevel) CBZ.setQualityLevel(${Q}); } catch (_) {}
    window.requestAnimationFrame = function () { return 0; };
    await new Promise((r) => setTimeout(r, 700));
    __nlHour(${HOUR});
    for (let i = 0; i < 90; i++) __nlTick(1/60);
    CBZ.renderer.debug.checkShaderErrors = true;
    __nlHud();
    return true;
  })()`, 300000);

  if (MODE === "b2") await runB2();
  else await runNuke();
} finally {
  if (ws && ws.readyState <= 1) ws.close();
  for (const c of children.reverse()) if (!c.killed) c.kill("SIGTERM");
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

/* ======================================================================
   THE NUKE
   ====================================================================== */
async function runNuke() {
  const setup = await evl(`(async () => {
    const lots = (CBZ.city && CBZ.city.arena && CBZ.city.arena.lots) || [];
    let gx = 0, gz = 0, n = 0;
    for (const lot of lots) { const x = +(lot.x ?? lot.cx), z = +(lot.z ?? lot.cz); if (isFinite(x) && isFinite(z)) { gx += x; gz += z; n++; } }
    gx = n ? gx / n : 0; gz = n ? gz / n : 0;
    const gy = (CBZ.floorAt && CBZ.floorAt(gx, gz)) || 0;
    // The chase spot: the player 3 km out on the -Z side, facing ground zero.
    const az = Math.PI * 1.15;
    const px = gx + Math.sin(az) * 3000, pz = gz + Math.cos(az) * 3000;
    const py = (CBZ.floorAt && CBZ.floorAt(px, pz)) || 0;
    window.__nl = { t: 0, gx, gz, gy, az, px, py, pz };
    if (CBZ.player && CBZ.player.pos) CBZ.player.pos.set(px, py + 1.1, pz);
    for (let i = 0; i < 20; i++) __nlTick(1/60);
    // --fxonly: the spectacle without the bus (no damage, no dying city), for
    // fast look iterations; the final storyboard always takes the game path
    if (${!!args.fxonly} && CBZ.cityNukeFX) CBZ.cityNukeFX(gx, gy + 1.2, gz, { byPlayer: false });
    else if (typeof CBZ.strategicNukeDetonate === "function") CBZ.strategicNukeDetonate(gx, gz, { byPlayer: true });
    else CBZ.detonate(gx, gy + 1.2, gz, "nuke", { byPlayer: true });
    return { gx, gz, gy, dbg: CBZ.nukeFxDebug ? CBZ.nukeFxDebug() : null, audit: CBZ.nukeFxAudit ? CBZ.nukeFxAudit() : null };
  })()`, 300000);

  const tripods = {
    street: { dist: 2600, alt: 25, aimK: 0.45, fov: 60 },
    bomber: { dist: 3200, alt: 1000, aimK: 0.35, fov: 55 },
    far: { dist: 9000, alt: 150, aimK: 0.5, fov: 45 },
    ground2k: { dist: 2000, alt: 1.7, aimK: 0.42, fov: 75, azOff: 0.35 },
    ground8k: { dist: 8000, alt: 1.7, aimK: 0.45, fov: 55, azOff: 1.4 },
    aerial: { dist: 9000, alt: 1800, aimK: 0.4, fov: 55, azOff: 1.4, air: true },
    chase: { chase: true, fov: 70 },
  };
  const want = String(args.tripods || (MODE === "storyboard" ? "ground2k,ground8k,aerial,chase" : "street,bomber")).split(",");
  const results = [];
  const cells = {};
  for (const beat of BEATS) {
    const r = await evl(`(async () => {
      const S = window.__nl;
      let simMs = 0, ticks = 0, worst = 0;
      const goal = Math.max(${beat}, 1/60);
      while (S.t < goal - 1e-6) {
        // fine steps through the flash, coarser once the city is busy dying
        // (headless, a tick there costs seconds; nukefx clamps dt at 0.25)
        const dt = S.t < 2 ? 1/120 : S.t < 10 ? 1/30 : S.t < 40 ? 1/15 : 1/8;
        const t0 = performance.now(); __nlTick(Math.min(dt, goal - S.t + 1e-4)); const ms = performance.now() - t0;
        simMs += ms; ticks++; if (ms > worst) worst = ms; S.t += Math.min(dt, goal - S.t + 1e-4);
        if (CBZ.player && CBZ.player.pos) CBZ.player.pos.set(S.px, S.py + 1.1, S.pz);
        if (ticks % 60 === 0) __nlHour(${HOUR});
      }
      const d = CBZ.nukeFxDebug ? CBZ.nukeFxDebug() : null;
      return { t: +S.t.toFixed(2), simAvg: ticks ? +(simMs / ticks).toFixed(1) : 0, simWorst: +worst.toFixed(0), live: d && d.live, flash: d && d.flash,
        flashOpacity: (document.getElementById('nukeFlash') || {}).style ? document.getElementById('nukeFlash').style.opacity : null,
        feed: (document.getElementById('cityKillFeed') || {}).innerText || "" };
    })()`, 900000);
    for (const tp of want) {
      const T = tripods[tp];
      if (!T) continue;
      const shot = await evl(`(async () => {
        const S = window.__nl, cam = CBZ.camera;
        __nlHud();                       // overlays born mid-run (vignettes, cards) too
        const live = CBZ.nukeFxDebug().live;
        const h = live ? Math.max(400, live.capYNow - S.gy + live.capWNow * 0.25) : 900;
        cam.aspect = ${W} / ${H}; cam.fov = ${T.fov || 60}; cam.near = ${T.chase ? 0.2 : 1};
        if (${!!T.chase}) {
          // the third-person framing: 4.6 m behind, 1.9 m up, aimed at the cloud
          const dx = S.gx - S.px, dz = S.gz - S.pz, L = Math.hypot(dx, dz), fx = dx / L, fz = dz / L;
          cam.far = 20000;
          cam.position.set(S.px - fx * 4.6 + fz * 0.9, S.py + 1.1 + 1.9, S.pz - fz * 4.6 - fx * 0.9);
          cam.lookAt(S.gx, S.gy + h * 0.33, S.gz);
          if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(-fx, -fz); }
          const pg = CBZ.playerChar && CBZ.playerChar.group; if (pg) { pg.position.set(S.px, S.py, S.pz); pg.rotation.y = Math.atan2(fx, fz); pg.visible = true; pg.updateMatrixWorld(true); }
        } else {
          const az = S.az + ${T.azOff || 0};
          const cx = S.gx + Math.sin(az) * ${T.dist || 0}, cz = S.gz + Math.cos(az) * ${T.dist || 0};
          const fy = Math.max(0, (CBZ.floorAt && CBZ.floorAt(cx, cz)) || 0);
          cam.far = ${T.alt > 500 ? 40000 : 20000};
          cam.position.set(cx, fy + ${T.alt || 2} + 0.0, cz);
          cam.lookAt(S.gx, S.gy + h * ${T.aimK || 0.4}, S.gz);
        }
        cam.updateProjectionMatrix(); cam.updateMatrixWorld();
        if (CBZ.skySync) CBZ.skySync();
        // HARNESS TRAP: city/mode.js sizes THREE.Fog off the PLAYER's eye
        // height, and the player is parked on the ground at the chase spot. An
        // airborne tripod gets the closing distance an airborne player gets.
        const fog = CBZ.scene.fog, fog0 = fog ? [fog.near, fog.far] : null;
        if (fog && ${!!T.air}) { fog.far = Math.max(fog.far, 11000); fog.near = Math.round(fog.far * 0.16); }
        const gl = CBZ.renderer.getContext(); const px = new Uint8Array(4);
        const time = (n) => { let best = 1e9; for (let i = 0; i < n; i++) { const t0 = performance.now(); CBZ.renderer.render(CBZ.scene, cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); best = Math.min(best, performance.now() - t0); } return +best.toFixed(1); };
        const vol = CBZ.scene.getObjectByName("nukeCloudVolume");
        let without = null;
        if (vol && vol.visible) { vol.visible = false; time(1); without = time(2); vol.visible = true; }
        time(1);
        const withCloud = time(3);
        const calls = CBZ.renderer.info.render.calls;
        // THE CLOUD'S OWN GPU TIME, from a timer query around a draw of the
        // volume alone (depth from the frame above is still bound, so the
        // city occludes it exactly as in play). Wall-clock deltas on a busy
        // machine are noise; this is the number.
        let cloudGpu = null;
        const tq = gl.getExtension("EXT_disjoint_timer_query_webgl2");
        if (tq && vol && vol.visible) {
          const parent = vol.parent, solo = new THREE.Scene();
          const ac = CBZ.renderer.autoClear; CBZ.renderer.autoClear = false;
          const samples = [];
          for (let k = 0; k < 3; k++) {
            const q = gl.createQuery();
            solo.add(vol);
            gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
            CBZ.renderer.render(solo, cam);
            gl.endQuery(tq.TIME_ELAPSED_EXT);
            parent.add(vol);
            let ok = false;
            for (let w = 0; w < 100 && !ok; w++) { await new Promise((r) => setTimeout(r, 10)); ok = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); }
            if (ok && !gl.getParameter(tq.GPU_DISJOINT_EXT)) samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
            gl.deleteQuery(q);
          }
          CBZ.renderer.autoClear = ac;
          if (samples.length) { samples.sort((a, b) => a - b); cloudGpu = +samples[Math.floor(samples.length / 2)].toFixed(2); }
          // repaint the frame the screenshot will capture
          CBZ.renderer.render(CBZ.scene, cam);
        }
        if (fog0) { fog.near = fog0[0]; fog.far = fog0[1]; }
        return { withCloud, without, calls, cloudGpu, steps: live ? live.steps : null };
      })()`);
      const file = path.join(OUT, `t${String(beat).padStart(5, "0")}-${tp}.png`);
      // the flash is a DOM layer over the canvas: captureScreenshot keeps it
      await shoot(file);
      (cells[beat] = cells[beat] || {})[tp] = file;
      results.push({ beat, tripod: tp, ...r, ...shot, file });
      console.error(`t=${beat} ${tp} cloud ${shot.cloudGpu}ms gpu ${shot.withCloud}ms (w/o ${shot.without}) sim avg ${r.simAvg} worst ${r.simWorst}${r.feed ? " FEED: " + JSON.stringify(r.feed.slice(0, 120)) : ""}`);
    }
  }
  const report = { gpu, setup, results, logs };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
  if (MODE === "storyboard") {
    const cloudMs = results.filter((x) => x.cloudGpu != null).map((x) => x.cloudGpu);
    const worstCloud = cloudMs.length ? Math.max(...cloudMs).toFixed(2) : "n/a";
    const out = await sheet({
      title: `Nuke storyboard ${LABEL} (seed 90210, ${HOUR}:00, q${Q}, ${W}x${H})`,
      cols: want.map((t) => ({ ground2k: "ground, 2 km", ground8k: "ground, 8 km", aerial: "aerial, 9 km out / 1.8 km up", chase: "chase cam, player 3 km out" }[t] || t)),
      rows: BEATS.map((b) => ({ label: `t = ${b} s`, cells: want.map((t) => (cells[b] || {})[t] || null) })),
      thumb: [480, 270],
      notes: [`GPU ${gpu.renderer}. Worst cloud-only GPU time (timer query): ${worstCloud} ms.`],
    }, path.join(OUT, "nuke-storyboard.png"));
    console.log(out);
    if (args.open) spawnSync("open", [out]);
  }
  console.log(JSON.stringify({ gpu, logs: logs.slice(0, 20), out: OUT }, null, 1));
}

/* ======================================================================
   THE B-2 (and the B-52 next to it)
   ====================================================================== */
async function runB2() {
  const info = await evl(`(() => {
    const found = []; let b52 = null;
    CBZ.scene.traverse((o) => {
      const d = o.userData && o.userData.aircraftDims;
      if (!d) return;
      if (d.family === "B-2-stealth") found.push(o);
      else if (!b52 && /B-52|bomber|heavy/i.test(String(d.family || d.name || ""))) b52 = o;
    });
    // the Fort Brandt aircraft (other nations' B-2s can sit in city blocks)
    const rec = CBZ.strategicB2Rec ? CBZ.strategicB2Rec() : null;
    const parked = (rec && rec.group) || found[0] || null;
    const wp = new THREE.Vector3();
    if (parked) parked.getWorldPosition(wp);
    let bp = null; if (b52) { bp = new THREE.Vector3(); b52.getWorldPosition(bp); }
    // a flying copy built from the same factory
    const m = CBZ.strategicModels && CBZ.strategicModels.b2 ? CBZ.strategicModels.b2() : null;
    const fly = m && m.group;
    if (fly) { fly.name = "nlB2Fly"; CBZ.scene.add(fly); fly.visible = false; }
    window.__b2 = { parked, fly, b52, wp, bp, heading: parked ? parked.rotation.y : 0 };
    return { parked: !!parked, at: parked ? [wp.x, wp.y, wp.z].map(Math.round) : null, b52: !!b52, b52at: bp ? [bp.x, bp.y, bp.z].map(Math.round) : null,
      b52family: b52 ? b52.userData.aircraftDims.family : null, fly: !!fly, api: fly ? { gear: typeof fly.userData.setGear, bay: typeof fly.userData.setBay } : null };
  })()`);
  console.error("b2 staging", JSON.stringify(info));
  const shots = [
    { id: "parked", label: "parked, 3/4 front" },
    { id: "parked-side", label: "parked, low side" },
    { id: "takeoff", label: "rotating, gear down" },
    { id: "below", label: "overhead, from below" },
    { id: "bay", label: "bay open, from below" },
    { id: "above", label: "from above (intakes, exhaust)" },
    { id: "b52", label: "B-52 parked" },
  ];
  const files = [];
  for (const s of shots) {
    const r = await evl(`(() => {
      const B = window.__b2, cam = CBZ.camera, id = ${JSON.stringify(s.id)};
      cam.aspect = ${W} / ${H}; cam.near = 0.3; cam.far = 8000; cam.fov = 45;
      const fly = B.fly, ud = fly ? fly.userData : {};
      const P = B.wp.clone();
      // the flying copy hangs over the apron, clear of the parked one
      const hd = B.heading, fx = Math.sin(hd), fz = Math.cos(hd), rx = Math.cos(hd), rz = -Math.sin(hd);
      function pose(alt, pitch, gear, bay) {
        if (!fly) return null;
        fly.visible = true;
        // over the parked one (which hides): the apron is clear around it
        if (B.parked) B.parked.visible = false;
        fly.position.set(P.x, P.y + alt, P.z);
        fly.rotation.set(0, 0, 0); fly.rotation.order = "YXZ"; fly.rotation.y = hd; fly.rotation.x = -pitch;
        if (ud.setGear) ud.setGear(gear);
        if (ud.setBay) ud.setBay(bay);
        fly.updateMatrixWorld(true);
        return fly.position.clone();
      }
      if (fly) fly.visible = false;
      if (B.parked) B.parked.visible = true;
      let tgt = P.clone().add(new THREE.Vector3(0, 2.5, 0));
      // HARNESS TRAP: Fort Brandt's apron has city blocks a few tens of metres
      // off each wingtip on some seeds; ground-level tripods there film a wall.
      // Close, raised tripods keep the aircraft in frame.
      if (id === "parked") { cam.position.set(P.x + fx * 30 + rx * 20, P.y + 9, P.z + fz * 30 + rz * 20); }
      else if (id === "parked-side") { cam.position.set(P.x + fx * 4 - rx * 30, P.y + 2.2, P.z + fz * 4 - rz * 30); cam.fov = 60; }
      else if (id === "takeoff") { const q = pose(9, 0.16, 1, 0); tgt = q.clone().add(new THREE.Vector3(0, 2, 0)); cam.position.set(q.x + fx * 38 + rx * 22, q.y + 1, q.z + fz * 38 + rz * 22); }
      else if (id === "below") { const q = pose(420, 0, 0, 0); tgt = q; cam.position.set(q.x - fx * 30 + rx * 8, q.y - 70, q.z - fz * 30 + rz * 8); cam.fov = 55; }
      else if (id === "bay") { const q = pose(420, 0, 0, 1); tgt = q; cam.position.set(q.x - fx * 26 - rx * 14, q.y - 36, q.z - fz * 26 - rz * 14); cam.fov = 55; }
      else if (id === "above") { const q = pose(420, 0, 0, 0); tgt = q; cam.position.set(q.x - fx * 34 + rx * 22, q.y + 26, q.z - fz * 34 + rz * 22); }
      else if (id === "b52") {
        if (!B.b52) return { skip: true };
        const Q = B.bp; const h2 = B.b52.rotation.y; const f2 = [Math.sin(h2), Math.cos(h2)], r2 = [Math.cos(h2), -Math.sin(h2)];
        tgt = Q.clone().add(new THREE.Vector3(0, 3, 0));
        cam.position.set(Q.x + f2[0] * 50 + r2[0] * 34, Q.y + 4, Q.z + f2[1] * 50 + r2[1] * 34);
      }
      cam.lookAt(tgt);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      if (CBZ.skySync) CBZ.skySync();
      CBZ.renderer.render(CBZ.scene, cam);
      return { ok: true };
    })()`);
    if (r && r.skip) continue;
    const file = path.join(OUT, `b2-${s.id}.png`);
    await shoot(file);
    files.push({ ...s, file });
    console.error("shot", s.id);
  }
  // two columns; the cell names are listed under the grid
  const rows = [];
  for (let i = 0; i < files.length; i += 2) rows.push({ label: "", cells: [files[i].file, files[i + 1] ? files[i + 1].file : null] });
  const sheetPng = await sheet({
    title: `B-2 / B-52 ${LABEL}`,
    cols: [files.filter((_, i) => i % 2 === 0).map((f) => f.id).join(" / "), files.filter((_, i) => i % 2 === 1).map((f) => f.id).join(" / ")],
    rows, thumb: [800, 450],
    notes: files.map((f) => f.id + ": " + f.label),
  }, path.join(OUT, "b2-sheet.png"));
  console.log(sheetPng);
  if (args.open) spawnSync("open", [sheetPng]);
  await writeFile(path.join(OUT, "report.json"), JSON.stringify({ gpu: null, info, files, logs }, null, 1));
  console.log(JSON.stringify({ info, logs: logs.slice(0, 20), out: OUT }, null, 1));
}
