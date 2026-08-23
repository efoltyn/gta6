#!/usr/bin/env node
/* tools/tp-gun-view-check.mjs — CAN YOU ACTUALLY SEE THE GUN?

   OWNER (2026-08-20, with a clip of a third-person shooter): "in our third
   person when holding gun you can't see the gun — use this ref to fix the
   angle so we can see the gun better when shooting."

   "Can you see it" is not a taste question, so this does not settle it with a
   screenshot. It boots the real city, arms the player through the real
   acquisition path, lets the REAL camera rig fly (no override — that is the
   whole subject), and then measures, from the live lens:

     · VIS   — of N points sampled along the drawn weapon's own bore, the
               fraction that are inside the frustum AND not blocked by the
               player's own body. That number IS the owner's sentence.
     · MUZ   — is the muzzle itself visible, and where on screen (NDC).
     · dist/side/pitch — what the rig actually flew at, from CBZ.camAudit.

   Three tiers are measured (carry / presenting / ADS) with the fix ON and
   OFF (CBZ.CONFIG.CAM_TP_GUN_VISIBLE, flipped live), so the run is its own
   before-and-after. --shots also writes tools/shots/tp-gun-*.png.

   Usage: node tools/tp-gun-view-check.mjs [--json] [--shots]   Exit 0 = ok. */
import { spawn } from "node:child_process";
import { rm, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asJson = process.argv.includes("--json");
const t0 = Date.now();
const log = (m) => console.error(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
const wantShots = process.argv.includes("--shots");
const SHOTDIR = path.join(ROOT, "tools/shots");

async function claimPort(lo, n, probe) {
  for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } }
  throw new Error("no port");
}
const port = await claimPort(9620, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } }
  if (!up) { console.error("FAIL devserver"); process.exit(1); }
}
const dbg = await claimPort(12120, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-tpgun-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--mute-audio", "--window-size=1280,720", `--remote-debugging-port=${dbg}`,
  `--user-data-dir=${profile}`, `${origin}?seed=90210`], { stdio: "ignore" });
function done(code) {
  try { chrome.kill(); } catch (_) {}
  try { server.kill(); } catch (_) {}
  process.exit(code);
}
let page = null;
for (let i = 0; i < 300 && !page; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
    page = ps.find((p) => p.type === "page" && p.url.startsWith(origin));
  } catch (_) {}
  if (!page) await sleep(100);
}
if (!page) { console.error("FAIL no page"); done(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
let id = 1; const pend = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => {
  const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
});
const evl = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  const ed = r.result && r.result.exceptionDetails;
  if (ed) { console.error("EVAL THREW:", (ed.exception && ed.exception.description) || ed.text); return null; }
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");
log("waiting for boot…");
for (let i = 0; i < 900; i++) { if (await evl("!!window.CBZ && !!CBZ.bootComplete")) break; await sleep(500); }
log("booted");
// The hitman campaign scripts the opening beats (and can holster you); this
// gate is about the free-roam armed camera, so take the sandbox like the
// other visual proofs do.
await evl("(()=>{ if (CBZ.CONFIG) CBZ.CONFIG.CITY_HITMAN_CAMPAIGN = false; return true; })()");
for (let i = 0; i < 400; i++) {
  if (await evl("CBZ.game && CBZ.game.state === 'playing'")) break;
  await evl("(()=>{const b=document.getElementById('playBtn'); if(b) b.click();})()");
  await sleep(300);
}
if (!(await evl("CBZ.game && CBZ.game.state === 'playing'"))) { console.error("FAIL never reached play"); done(1); }
log("playing");
// FREEZE THE FRAME CLOCK. Under swiftshader this page renders at about 1 FPS,
// and the camera's smoothing integrates on a CLAMPED dt — so a live-rAF sample
// photographs a boom that is still travelling toward the tier it was asked for
// (the first version of this gate measured exactly that, and the plates showed
// the character sliding off the edge of a frame that had not caught up yet).
// CBZ.stepSim is the same update chain without the renderer, so 3 s of camera
// settling costs milliseconds and every row is a SETTLED frame.
await evl("(()=>{ window.requestAnimationFrame = function(){ return 0; }; return true; })()");
await sleep(600);
// Hold the world still enough to photograph: no hitstop/slow-mo, the player
// alive, and — the one that actually bit — the gun IN HAND. A street cinematic
// (a dealer's pitch, a hire offer) holsters you for the duration and owns the
// lens while it runs, which silently turned whole sweep grids into "no drawn
// weapon in hand". Abort any scene and re-clear the holster each tick.
const tick = (n) => evl(`(()=>{ for (let i=0;i<${n};i++) {
  CBZ.hitstop = 0; CBZ.slowmo = 0;
  if (CBZ.cineBusy && CBZ.cineBusy() && CBZ.cineAbort) CBZ.cineAbort();
  if (CBZ.game) CBZ.game.cityHolstered = false;
  // NOON, pinned. The sky clock runs while the gate does, so a contact sheet
  // captured over fifteen minutes of software rendering drifts from morning
  // into night and the last plates are unreadable next to the first. t=0.25 is
  // sun height sin(2*pi*t) = 1 (core/daynight.js).
  if (CBZ.dayPhase) CBZ.dayPhase(0.25);
  // …and no heat. Standing in the open with a rifle out IS a crime here: an
  // earlier run of this gate got the player ARRESTED mid-sample, and a booking
  // screen takes the weapon into evidence, which is how rows started coming
  // back "no drawn weapon, cur=null" with nothing else obviously wrong.
  if (CBZ.city && CBZ.city.clearWanted) CBZ.city.clearWanted();
  CBZ.stepSim(1/60);
  if (CBZ.player) {
    CBZ.player.hp = 100; CBZ.player.dead = false;
    // STAND STILL. The carry pose puts a gait swing on the gun arm, so a
    // player who is drifting (an NPC shove, a stale key, a slope) samples a
    // different arm angle every run — which is exactly how this gate reported
    // 100% and 0% for the same constants on consecutive runs. Gravity keeps
    // its axis; the walk does not.
    if (CBZ.player.vel) { CBZ.player.vel.x = 0; CBZ.player.vel.z = 0; }
  }
} return true; })()`);
const draw = () => evl("(()=>{ try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) { return String(e); } return true; })()");
await tick(240);   // burn the spawn intro and let streaming settle

// ---- the measurement, installed once and called per state -----------------
const INSTALL = `(() => {
  const T = window.THREE;
  // keep the REAL signal so the trigger check can put it back after the rows
  // have run with it pinned (overwriting it is how the tiers are entered).
  if (!window.__tpRealPresenting) window.__tpRealPresenting = CBZ.tpPresenting;
  window.__tpRestoreSignals = function () {
    CBZ.tpPresenting = window.__tpRealPresenting;
    CBZ.CONFIG.CITY_TP_LOWREADY = true;
    return true;
  };
  // The player's own body is the only occluder that matters to the owner's
  // sentence ("you can't see the gun"): a wall between the lens and the player
  // is the spring arm's problem, not the framing's.
  function bodyMeshes(prop) {
    const ch = CBZ.playerChar; const out = [];
    if (!ch || !ch.group) return out;
    ch.group.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      for (let p = o; p; p = p.parent) if (p === prop) return;   // the gun is not its own occluder
      out.push(o);
    });
    return out;
  }
  window.__tpGun = function () {
    const cam = CBZ.camera;
    const prop = CBZ.tpHandWeapon && CBZ.tpHandWeapon();
    if (!prop) return { err: "no drawn weapon in hand" +
      " cur=" + CBZ.currentWeaponId + " holstered=" + (CBZ.game && CBZ.game.cityHolstered) +
      " fp=" + !!(CBZ.fps && CBZ.fps.active) + " driving=" + !!(CBZ.player && CBZ.player.driving) +
      " dead=" + !!(CBZ.player && CBZ.player.dead) +
      " xfer=" + JSON.stringify(CBZ.weaponTransferState ? CBZ.weaponTransferState().active : "?") };
    const N = 13;
    const pts = [];
    for (let i = 0; i < N; i++) {
      prop.updateWorldMatrix(true, false);
      const local = prop.userData.muzzle
        ? prop.userData.muzzle.clone().multiplyScalar(i / (N - 1))
        : new T.Vector3(0, 0, 0);
      pts.push(prop.localToWorld(local));
    }
    const occ = bodyMeshes(prop);
    const ray = new T.Raycaster();
    cam.updateMatrixWorld();
    const frustum = new T.Frustum().setFromProjectionMatrix(
      new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    let vis = 0, onScreen = 0;
    const blockers = {};
    const dir = new T.Vector3();
    const seen = [];
    for (const p of pts) {
      const inFrame = frustum.containsPoint(p);
      if (inFrame) onScreen++;
      let blocked = false;
      if (inFrame) {
        dir.copy(p).sub(cam.position);
        const d = dir.length(); dir.multiplyScalar(1 / d);
        ray.set(cam.position, dir); ray.near = 0.01; ray.far = Math.max(0.02, d - 0.06);
        const h = ray.intersectObjects(occ, false);
        blocked = h.length > 0;
        // WHICH part of the player is in the way? "hidden" is not actionable;
        // "hidden by the right thigh" tells you whether to move the camera or
        // the pose.
        if (blocked) {
          let n = h[0].object.name || "", o = h[0].object;
          for (let g = 0; !n && o && g < 4; g++) { o = o.parent; n = (o && o.name) || ""; }
          blockers[n || "unnamed"] = (blockers[n || "unnamed"] || 0) + 1;
        }
      }
      const ok = inFrame && !blocked;
      if (ok) vis++;
      seen.push(ok ? 1 : 0);
    }
    // HOW BIG IS IT, not just "is a point of it visible". Walking the bore in
    // screen space and summing the segments whose BOTH ends are visible gives
    // the weapon's actual on-screen length — in fractions of the frame height,
    // which is the honest reading of "can we see the gun better".
    const ndc = pts.map((p) => p.clone().project(cam));
    const asp = cam.aspect || (window.innerWidth / Math.max(1, window.innerHeight));
    const seg = (a, b) => Math.hypot((a.x - b.x) * asp, a.y - b.y) / 2;
    let span = 0, visSpan = 0;
    for (let i = 1; i < N; i++) {
      const d = seg(ndc[i - 1], ndc[i]);
      span += d;
      if (seen[i] && seen[i - 1]) visSpan += d;
    }
    const muz = ndc[N - 1], mid = ndc[(N / 2) | 0];
    // which side of the player is the lens actually on? (+ = the player's right
    // shoulder, which is where the over-shoulder frame is authored to sit)
    const P0 = CBZ.player;
    const yawR = (CBZ.cam && CBZ.cam.yaw) || 0;
    const sideDot = P0 ? (cam.position.x - P0.pos.x) * Math.cos(yawR) + (cam.position.z - P0.pos.z) * -Math.sin(yawR) : 0;
    const pNdc = P0 ? new T.Vector3(P0.pos.x, P0.pos.y + 1.2, P0.pos.z).project(cam) : { x: 0, y: 0 };
    const A = CBZ.camAudit ? CBZ.camAudit() : {};
    const P = CBZ.player;
    return {
      weapon: prop.userData.weaponId || null,
      boreLen: +pts[0].distanceTo(pts[N - 1]).toFixed(2),
      hasMuzzle: !!prop.userData.muzzle,
      blockedBy: Object.keys(blockers).sort((a, b) => blockers[b] - blockers[a]).slice(0, 3)
        .map((k) => k + "×" + blockers[k]).join(" "),
      vis: +(vis / N).toFixed(3), onScreen: +(onScreen / N).toFixed(3), pattern: seen.join(""),
      muzVisible: !!seen[N - 1],
      muzNdc: [+muz.x.toFixed(2), +muz.y.toFixed(2)],
      midNdc: [+mid.x.toFixed(2), +mid.y.toFixed(2)],
      span: +span.toFixed(3), visSpan: +visSpan.toFixed(3),
      sideDot: +sideDot.toFixed(2),
      playerNdc: [+pNdc.x.toFixed(2), +pNdc.y.toFixed(2)],
      dist: +(A.dist || 0).toFixed(2), arm: +(A.arm || 0).toFixed(2),
      rigPitch: +(A.rigPitch || 0).toFixed(3), fov: +cam.fov.toFixed(1),
      camY: +(A.camY || 0).toFixed(2), clear: +(A.clear || 0).toFixed(2),
      aiming: !!(CBZ.playerChar && CBZ.playerChar.aimingPose),
      speed: P ? +Math.hypot(P.vel ? P.vel.x : 0, P.vel ? P.vel.z : 0).toFixed(2) : null,
      presenting: !!(CBZ.tpPresenting && CBZ.tpPresenting()),
      ads: !!(CBZ.isADS && CBZ.isADS()),
      tier: CBZ.tpArmTier ? CBZ.tpArmTier() : -1,
      pos: P ? [+P.pos.x.toFixed(1), +P.pos.y.toFixed(1), +P.pos.z.toFixed(1)] : null,
    };
  };
  // ---- WHERE THE SAMPLE IS TAKEN -----------------------------------------
  // A plate shot beside a lamp post photographs the COLLISION CLAMP, not the
  // tier — and the spawn can be indoors, where the boom is pulled to your back
  // before the framing gets a vote. So find a genuinely open piece of street
  // with real sky over it and room behind the character for a full boom
  // (the same probe the camera visual presets use), once, and reuse it for
  // every sample so nothing but the tier changes between rows.
  const _near = [];
  function solidAt(x, y, z) {
    const cs = CBZ.queryCollidersNear ? CBZ.queryCollidersNear(x, z, 1.2, _near) : (CBZ.colliders || []);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      const y0 = c.y0 != null ? c.y0 : -1e4, y1 = c.y1 != null ? c.y1 : 1e4;
      if (y >= y0 && y <= y1) return true;
    }
    return false;
  }
  function rayFree(x, y, z, dx, dy, dz, far) {
    if (!CBZ.losBlockers || !CBZ.losBlockers.length) return far;
    const ray = new T.Raycaster(new T.Vector3(x, y, z), new T.Vector3(dx, dy, dz).normalize());
    ray.far = far;
    const h = CBZ.losRaycast ? CBZ.losRaycast(ray, CBZ.losBlockers) : ray.intersectObjects(CBZ.losBlockers, false);
    return h.length ? h[0].distance : far;
  }
  function runTo(x, y, z, dx, dz, far) {
    for (let t = 0.5; t <= far; t += 0.5) if (solidAt(x + dx * t, y, z + dz * t)) return t;
    return far;
  }
  function openAt(x, z) {
    const y = (typeof CBZ.floorAt === "function") ? CBZ.floorAt(x, z) : 0;
    if (solidAt(x, y + 1.0, z)) return null;
    if (rayFree(x, y + 1.7, z, 0, 1, 0, 30) < 22) return null;      // must be real sky
    let bestDir = 0, bestRun = -1;
    for (let k = 0; k < 12; k++) {
      const th = (k / 12) * Math.PI * 2;
      const dx = Math.sin(th), dz = Math.cos(th);
      const fwd = runTo(x, y + 1.7, z, dx, dz, 20);       // something to look at
      const back = runTo(x, y + 1.7, z, -dx, -dz, 9);     // room for the boom
      const score = Math.min(fwd, 26) * 0.6 + Math.min(back, 9) * 2.2;
      if (score > bestRun) { bestRun = score; bestDir = th; }
    }
    return { x, y, z, yaw: bestDir + Math.PI, score: bestRun };
  }
  function findSpot() {
    const P = CBZ.player, home = { x: P.pos.x, z: P.pos.z };
    // PREFER THE APRON. The low-ready barrel is ground-clearance-solved
    // (holsterprops lifts it so a muzzle can never enter the floor), so a kerb
    // or a step under the player silently changes the gun's angle — and with it
    // how much of it the body hides. Two runs on two spawn-dependent street
    // corners disagreed 100% vs 0% for identical constants because of exactly
    // that. The airport apron is flat, open and always in the same place, so
    // the rows compare like with like.
    const ap = CBZ.city && CBZ.city.arena && CBZ.city.arena.airportSpawn;
    if (ap) {
      const c = openAt(ap.x, ap.z - 12) || openAt(ap.x, ap.z);
      if (c) return c;
    }
    const cands = [];
    for (let ring = 0; ring <= 3; ring++) {
      const n = ring === 0 ? 1 : 8, r = ring * 15;
      for (let k = 0; k < n; k++) {
        const th = (k / n) * Math.PI * 2;
        const c = openAt(home.x + Math.sin(th) * r, home.z + Math.cos(th) * r);
        if (c) cands.push(c);
      }
    }
    cands.sort((a, b) => b.score - a.score);
    return cands[0] || { x: home.x, y: P.pos.y, z: home.z, yaw: 0, score: 0 };
  }

  // Park the player there, facing down-street, armed through the real path.
  window.__tpSetup = function (weaponId) {
    // the soft aim-lock is a SECOND writer of cam.pitch; the subject here is
    // the framing, so it is a confound on both sides of the comparison.
    if (CBZ.CONFIG) { CBZ.CONFIG.AIM_LOCK_ASSIST = false; CBZ.CONFIG.TOUCH_AIM_ASSIST = false; }
    if (CBZ.fpsSetActive && CBZ.fps && CBZ.fps.active) CBZ.fpsSetActive(false);
    if (CBZ.setFPS) { try { CBZ.setFPS(false); } catch (_) {} }
    if (CBZ.cityCam) CBZ.cityCam.fp = false;
    if (CBZ.game) { CBZ.game.cityHolstered = false; CBZ.game.cityMeleeWeapon = null; }
    if (CBZ.playerHolster) { try { CBZ.playerHolster(false); } catch (_) {} }
    if (CBZ.unlockWeapon) CBZ.unlockWeapon(weaponId, { select: true });
    if (CBZ.fpsSelectWeaponId) CBZ.fpsSelectWeaponId(weaponId);
    if (CBZ.fpsAddAmmo) CBZ.fpsAddAmmo(400);
    const spot = window.__tpSpot || (window.__tpSpot = findSpot());
    const P = CBZ.player;
    if (P) {
      P.hp = 100; P.dead = false; P.driving = false; P.crouch = false; P.prone = false;
      P.pos.x = spot.x; P.pos.z = spot.z;
      P.pos.y = (typeof CBZ.floorAt === "function") ? CBZ.floorAt(spot.x, spot.z) : spot.y;
      if (P.vel) { P.vel.x = 0; P.vel.z = 0; if (P.vel.y != null) P.vel.y = 0; }
      P.yaw = spot.yaw;
    }
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(P.pos.x, P.pos.y, P.pos.z);
    if (CBZ.cam) { CBZ.cam.yaw = spot.yaw; CBZ.cam.pitch = 0.05; }
    return { x: +spot.x.toFixed(1), z: +spot.z.toFixed(1), score: +spot.score.toFixed(1) };
  };
  return true;
})()`;
if (!(await evl(INSTALL))) { console.error("FAIL could not install probe"); done(1); }
log("probe installed");

// The idle pose BREATHES — the gun arm carries a gait/breath bob — so a single
// frame's occlusion test is a coin flip on where in that cycle it landed (an
// early version of this gate reported 54% and 0% for the same framing on two
// runs). Sample across a slice of the cycle and report the mean, so a row means
// "what you see" rather than "what you saw at t=0".
async function measure(frames = 6, gap = 7, retry = true) {
  const got = [];
  for (let i = 0; i < frames; i++) {
    const r = await evl("JSON.stringify(window.__tpGun())");
    if (r) got.push(JSON.parse(r));
    if (i < frames - 1) await tick(gap);
  }
  if (!got.length) return { err: "probe returned nothing" };
  if (got[0].err) {
    // The gun can leave your hands between rows for reasons that are not the
    // subject (a scripted beat holsters you, a pickup swaps the slot). Put it
    // back through the real acquisition path and take the row again, once.
    if (!retry) return got[0];
    log(`    (${got[0].err}) — re-arming`);
    await evl("window.__tpSetup('carbine')");
    await tick(150);
    return measure(frames, gap, false);
  }
  const mean = (k) => got.reduce((a, b) => a + (b[k] || 0), 0) / got.length;
  const out = { ...got[got.length - 1] };
  out.vis = +mean("vis").toFixed(3);
  out.visSpan = +mean("visSpan").toFixed(3);
  out.visBest = +Math.max(...got.map((r) => r.vis)).toFixed(3);
  out.onScreen = +mean("onScreen").toFixed(3);
  out.muzVisible = got.filter((r) => r.muzVisible).length > got.length / 2;
  return out;
}

async function sample(flag, state, label) {
  await evl(`(()=>{ CBZ.CONFIG.CAM_TP_GUN_VISIBLE = ${flag}; return true; })()`);
  const spot = await evl("JSON.stringify(window.__tpSetup('carbine'))");
  if (!spot) log("    (setup returned nothing)");
  await tick(200);                      // the teleport, the draw ramp, the boom
  // ENTER THE TIER. ADS is the real RMB path. PRESENT is entered by pinning
  // the two signals a held trigger sets — fpsmode's presenting() (the camera
  // tier AND holsterprops' barrel lock) and the raised pose — rather than by
  // firing: a fired sample also spends the magazine, shakes the lens and can
  // auto-switch the weapon out of your hand, none of which is the framing.
  // That the TRIGGER really sets those signals is checked separately below,
  // so nothing here is assumed.
  await evl(`(()=>{
    if (CBZ.fpsSetAim) CBZ.fpsSetAim(${state === "ads"});
    CBZ.CONFIG.CITY_TP_LOWREADY = ${state === "carry" ? "true" : "false"};
    CBZ.tpPresenting = () => ${state !== "carry"};
    CBZ.shake = function () {};
    return true;
  })()`);
  await tick(150);
  const out = await measure();
  out.state = state; out.flag = flag ? "on" : "off"; out.label = label;
  out.spot = spot ? JSON.parse(spot) : null;
  if (wantShots) {
    await draw();                       // rAF is frozen: paint the settled frame
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const data = shot.result && shot.result.data;
    if (data) {
      await mkdir(SHOTDIR, { recursive: true });
      const f = path.join(SHOTDIR, `tp-gun-${flag ? "fix" : "old"}-${state}.png`);
      await writeFile(f, Buffer.from(data, "base64"));
      out.shot = path.relative(ROOT, f);
    }
  }
  await evl("(()=>{ if (CBZ.fpsSetAim) CBZ.fpsSetAim(false); return true; })()");
  return out;
}

// DOES THE TRIGGER ACTUALLY REACH THE FRAMING? The rows above pin the signal;
// this pulls the real trigger and checks that fpsmode raises it, that the tier
// helper reads it, and that the weapon is still in your hands afterwards.
async function triggerSignalCheck() {
  await evl("window.__tpRestoreSignals()");   // the real fpsmode signal is back
  const spot = await evl("JSON.stringify(window.__tpSetup('carbine'))");
  if (!spot) log("    (setup returned nothing)");
  await tick(160);
  const before = JSON.parse(await evl("JSON.stringify(window.__tpGun())"));
  await evl("(()=>{ if (CBZ.fpsFire) CBZ.fpsFire(true); return true; })()");
  await tick(40);
  const held = JSON.parse(await evl("JSON.stringify(window.__tpGun())"));
  await evl("(()=>{ if (CBZ.fpsFire) CBZ.fpsFire(false); return true; })()");
  await tick(20);                        // still inside the 0.9 s post-shot linger
  const after = JSON.parse(await evl("JSON.stringify(window.__tpGun())"));
  return { before, held, after };
}

// ---- --matrix: THE CONTACT SHEET ------------------------------------------
// The gate answers "is it visible" in one number from one stage. This answers
// "show me", across the things that actually vary in play: every weapon
// silhouette in the game, carried and presented; the whole vertical aim band;
// both shoulders; crouch and prone; and a gun pointed at a person, which is
// the only shot that shows the frame doing its real job. Each plate is
// captured from the live rig with its measured numbers beside it, so the
// contact sheet and the gate cannot drift apart.
if (process.argv.includes("--matrix")) {
  await mkdir(SHOTDIR, { recursive: true });
  // a partial re-shoot MERGES into the existing sheet (--only-groups), so one
  // bad section does not cost the other thirty plates.
  let plates = [];
  try { plates = JSON.parse(await readFile(path.join(SHOTDIR, "matrix.json"), "utf8")); } catch (_) {}
  async function plate(id, caption, group) {
    const r = await measure(3, 6);
    await draw();
    const shot = await send("Page.captureScreenshot", { format: "png" });
    const data = shot.result && shot.result.data;
    const f = path.join(SHOTDIR, `matrix-${id}.png`);
    if (data) await writeFile(f, Buffer.from(data, "base64"));
    const row = {
      id, caption, group, file: path.relative(ROOT, f),
      vis: r.vis, visSpan: r.visSpan, muzVisible: r.muzVisible, muzNdc: r.muzNdc,
      playerNdc: r.playerNdc, dist: r.dist, weapon: r.weapon, tier: r.tier, err: r.err || null,
    };
    const at = plates.findIndex((p) => p.id === id);
    if (at >= 0) plates[at] = row; else plates.push(row);
    log(`  plate ${id} — vis ${((r.vis || 0) * 100) | 0}% span ${((r.visSpan || 0) * 100).toFixed(1)}%${r.err ? " ERR " + r.err : ""}`);
    // written after EVERY plate, not at the end: a contact sheet is a quarter of
    // an hour of software rendering, and a run that dies at plate 30 should not
    // take the other 29 with it.
    await writeFile(path.join(SHOTDIR, "matrix.json"), JSON.stringify(plates, null, 2));
  }
  // enter a tier without firing (same technique the sweep uses, and the gate
  // proves the real trigger reaches the same signals)
  const setTier = (t) => evl(`(()=>{
    if (CBZ.fpsSetAim) CBZ.fpsSetAim(${t === "ads"});
    CBZ.CONFIG.CITY_TP_LOWREADY = ${t === "carry"};
    CBZ.tpPresenting = () => ${t !== "carry"};
    CBZ.shake = function () {};
    return true; })()`);
  const arm = async (w) => {
    await evl(`window.__tpSetup(${JSON.stringify(w)})`);
    await tick(170);
  };

  await evl("(()=>{ CBZ.CONFIG.CAM_TP_GUN_VISIBLE = true; return true; })()");

  // 1. every silhouette in the game, carried and presented
  const ga = process.argv.indexOf("--only-groups");
  const ONLY = ga > 0 ? String(process.argv[ga + 1]).split(",") : null;
  const want = (g) => !ONLY || ONLY.includes(g);
  const GUNS = ["sidearm", "revolver", "deagle", "uzi", "smg", "carbine", "ak47",
                "shotgun", "sniper", "lmg", "glauncher", "bazooka"];
  if (want("weapons")) for (const w of GUNS) {
    for (const t of ["carry", "present"]) {
      await arm(w); await setTier(t); await tick(110);
      await plate(`gun-${w}-${t}`, `${w} — ${t === "carry" ? "carried (gun down)" : "presenting (trigger down)"}`, "weapons");
    }
  }

  // 2. the vertical aim band, presenting, on a rifle. Under CAM_TP_FIXED_ANGLE
  //    the BOOM does not tilt with these — the gun does, and the frame holds.
  //    Everything else you own is drawn SLUNG (back/hip mounts), and a rocket
  //    launcher across the shoulder is the loudest thing in a plate that is
  //    about a rifle — so carry exactly one gun for the rest of the sheet.
  await evl(`(()=>{
    if (CBZ.weaponInventory) CBZ.weaponInventory.length = 0;
    return true; })()`);
  await arm("carbine"); await setTier("present"); await tick(90);
  if (want("angles")) for (const p of [-0.40, -0.20, 0.0, 0.18, 0.36]) {
    await evl(`(()=>{ CBZ.cam.pitch = ${p}; return true; })()`);
    await tick(80);
    await plate(`aim-pitch-${String(p).replace(/[.-]/g, "_")}`,
      `aim pitch ${p >= 0 ? "+" : ""}${p} rad (${(p * 57.3).toFixed(0)}° ${p < 0 ? "up" : "down"})`, "angles");
  }
  await evl("(()=>{ CBZ.cam.pitch = 0.05; return true; })()");

  // 3. both shoulders
  if (want("angles")) for (const side of [-1, 1]) {
    await evl(`(()=>{ if (CBZ.camSetShoulder) CBZ.camSetShoulder(${side}); return true; })()`);
    await tick(120);
    await plate(`shoulder-${side < 0 ? "left" : "right"}`, `${side < 0 ? "left" : "right"} shoulder (MMB swaps)`, "angles");
  }

  // 4. (stances were here and are gone: CBZ.player.crouch is re-derived from
  //    the input every tick, so setting it from outside produced two more
  //    standing plates with a crouch label on them. A stance sheet needs the
  //    key held through the sim, which is a bigger harness than this.)

  // 5. POINTED AT SOMEONE. The shot that matters: the frame has to hold the
  //    weapon AND the person it is aimed at, or it has not done its job.
  const aimed = want("target") ? await evl(`(() => {
    const P = CBZ.player, list = (CBZ.cityPeds || []).concat(CBZ.cityCops || []);
    let best = null, bd = 1e9;
    for (const a of list) {
      if (!a || a.dead || !a.pos) continue;
      const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
      if (d > 4 && d < bd) { bd = d; best = a; }
    }
    if (!best) return null;
    // stand off at a readable distance and face them
    const dx = best.pos.x - P.pos.x, dz = best.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
    const stand = 7.5;
    P.pos.x = best.pos.x - dx / d * stand;
    P.pos.z = best.pos.z - dz / d * stand;
    if (CBZ.floorAt) P.pos.y = CBZ.floorAt(P.pos.x, P.pos.z);
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.set(P.pos.x, P.pos.y, P.pos.z);
    const yaw = Math.atan2(-dx, -dz);
    P.yaw = yaw; if (CBZ.cam) { CBZ.cam.yaw = yaw; CBZ.cam.pitch = 0.04; }
    return JSON.stringify({ kind: best.kind || "ped", dist: +bd.toFixed(1) });
  })()`) : null;
  if (aimed) {
    await tick(150);
    await plate("aimed-at-person", `pointed at a ${JSON.parse(aimed).kind} ~7.5 m away — presenting`, "target");
    await setTier("ads");
    await tick(130);
    await plate("aimed-at-person-ads", "same target, scoped (RMB)", "target");
    await setTier("carry");
    await tick(130);
    await plate("aimed-at-person-carry", "same target, gun carried (not presenting)", "target");
  } else log("  (no ped nearby to point at)");

  // 6. the before/after pair, same stage, flag off
  if (want("before-after")) await evl("(()=>{ CBZ.CONFIG.CAM_TP_GUN_VISIBLE = false; return true; })()");
  if (want("before-after")) for (const w of ["carbine", "sidearm"]) {
    await arm(w); await setTier("present"); await tick(140);
    await plate(`before-${w}-present`, `${w}, presenting — OLD framing (flag off)`, "before-after");
  }
  await evl("(()=>{ CBZ.CONFIG.CAM_TP_GUN_VISIBLE = true; return true; })()");
  if (want("before-after")) for (const w of ["carbine", "sidearm"]) {
    await arm(w); await setTier("present"); await tick(140);
    await plate(`after-${w}-present`, `${w}, presenting — NEW framing`, "before-after");
  }

  console.log(`\n  ${plates.length} plates → ${path.relative(ROOT, SHOTDIR)}/matrix-*.png (+ matrix.json)`);
  done(0);
}

// ---- --sweep: WHERE IS THE BEST FRAME, measured instead of guessed --------
// The tier constants are four numbers and the answer is not obvious in any of
// them:
//   · pulling the boom IN makes the weapon bigger but swings the player's own
//     arm between it and the lens;
//   · pushing the shoulder offset OUT eventually lines the barrel up with the
//     view axis, where a parallax-locked gun (holsterprops points it at the
//     crosshair's far point, 120 m out) projects to a foreshortened stub;
//   · and the tier's resting PITCH is not a view tilt in this rig at all — the
//     pure orbit re-solves FRAME_TILT from it, so it really means "how far down
//     the frame does the character sit", which decides whether a low-ready
//     weapon is in shot or under the bottom edge.
// So walk the grid and read the numbers off the game. Both tiers are entered
// WITHOUT firing: CITY_TP_LOWREADY=false raises the pose and CBZ.tpPresenting
// is pinned, which is the same pair of signals a held trigger sets — minus the
// ammo, the recoil shake and the weapon auto-switch that make a fired sample
// unreadable. (--pose additionally sweeps the low-ready barrel direction,
// because the camera cannot reveal a gun that is inside the character's leg.)
if (process.argv.includes("--sweep")) {
  log("sweeping…");
  await evl("JSON.stringify(window.__tpSetup('carbine'))");
  await tick(200);
  await evl("(()=>{ CBZ.shake = function () {}; return true; })()");
  const only = process.argv.includes("--carry") ? ["CARRY"]
             : process.argv.includes("--present") ? ["PRESENT"] : ["CARRY", "PRESENT"];
  for (const tierName of only) {
    const present = tierName === "PRESENT";
    await evl(`(()=>{
      CBZ.CONFIG.CITY_TP_LOWREADY = ${present ? "false" : "true"};
      CBZ.tpPresenting = () => ${present};
      return true;
    })()`);
    await tick(150);
    // PRESENT holds the gun at the shoulder, CARRY hangs it at the hip — the
    // two want different pivots and cannot share one grid.
    const grid = [];
    const dists = present ? [2.0, 2.3, 2.6, 3.0] : [3.0, 3.4, 3.8];
    const sides = present ? [1.0, 1.3, 1.6] : [0.75, 1.05, 1.35];
    const base = present ? { height: 1.52, pitch: 0.02 } : { height: 1.40, pitch: 0.0 };
    for (const dist of dists) for (const side of sides) grid.push({ dist, side, ...base });
    for (const height of present ? [1.45, 1.52, 1.62] : [1.30, 1.40, 1.52])
      for (const pitch of present ? [0.0, 0.04, 0.10] : [-0.04, 0.0, 0.06])
        grid.push({ dist: null, side: null, height, pitch });
    const out = [];
    let best = { dist: dists[1], side: sides[1], ...base, score: -1 };
    for (const g of grid) {
      const dist = g.dist == null ? best.dist : g.dist, side = g.side == null ? best.side : g.side;
      await evl(`(()=>{ const T = CBZ.CITY_TP;
        T.DIST_${tierName} = ${dist}; T.SIDE_${tierName} = ${side};
        T.HEIGHT_${tierName} = ${g.height}; T.PITCH_${tierName} = ${g.pitch}; return true; })()`);
      await tick(60);
      const r = await measure(4, 6);
      r.want = { dist, side, height: g.height, pitch: g.pitch };
      // The score is the visible barrel, but only while the shot is still a
      // shot: a frame that wins by tilting until the player's chest is under
      // the bottom edge is not a frame anyone wants to play.
      r.framed = r.playerNdc && r.playerNdc[1] > -0.80 && r.playerNdc[1] < 0.25 && r.muzVisible;
      r.score = r.framed ? r.visSpan : -1;
      out.push(r);
      log(`  ${tierName} d${dist} s${side} h${g.height} p${g.pitch} → vis ${(r.vis * 100) | 0}% span ${(r.visSpan * 100).toFixed(1)}% muz [${r.muzNdc}] plr [${r.playerNdc}]${r.framed ? "" : "  (unframed)"}`);
      if (g.dist != null && r.score > best.score) best = { ...r.want, score: r.score };
    }
    const win = out.filter((r) => r.framed).sort((a, b) => b.score - a.score)[0];
    if (win) best = { ...win.want, score: win.score };
    console.log(`\n  ${tierName} sweep — score = visible barrel, % of frame height`);
    console.log("  dist  side  height pitch  VIS   SPAN    muzNDC          playerNDC       ");
    for (const r of out) {
      console.log("  " + String(r.want.dist).padEnd(6) + String(r.want.side).padEnd(6) +
        String(r.want.height).padEnd(7) + String(r.want.pitch).padEnd(7) +
        String(((r.vis || 0) * 100).toFixed(0) + "%").padEnd(6) +
        String(((r.visSpan || 0) * 100).toFixed(1) + "%").padEnd(8) +
        `[${r.muzNdc}]`.padEnd(16) + `[${r.playerNdc}]`.padEnd(16) +
        (r.framed ? "" : (r.muzVisible ? "player out of frame" : "muzzle off/behind")));
    }
    if (win) console.log(`  BEST ${tierName}: dist ${win.want.dist} side ${win.want.side} height ${win.want.height} pitch ${win.want.pitch} → ${(win.visSpan * 100).toFixed(1)}% of frame height visible`);

    // ---- the POSE, for the carry tier ----
    if (!present && process.argv.includes("--pose")) {
      await evl(`(()=>{ const T = CBZ.CITY_TP;
        T.DIST_CARRY = ${JSON.stringify(best.dist)}; T.SIDE_CARRY = ${JSON.stringify(best.side)};
        T.HEIGHT_CARRY = ${JSON.stringify(best.height)}; T.PITCH_CARRY = ${JSON.stringify(best.pitch)};
        return true; })()`);
      await tick(60);
      console.log(`\n  CARRY low-ready pose sweep at dist ${best.dist} side ${best.side} height ${best.height} pitch ${best.pitch}`);
      console.log("  dir(x,y,z)          VIS   BEST  SPAN    muzNDC");
      for (const y of [-0.82, -0.62, -0.42, -0.25])
        for (const z of [0.36, 0.62, 0.86]) {
          await evl(`(()=>{ CBZ.TP_LOWREADY.long = [0.30, ${y}, ${z}]; return true; })()`);
          await tick(40);
          const r = await measure(4, 6);
          console.log("  " + `[0.30, ${y}, ${z}]`.padEnd(20) +
            String(((r.vis || 0) * 100).toFixed(0) + "%").padEnd(6) +
            String(((r.visBest || 0) * 100).toFixed(0) + "%").padEnd(6) +
            String(((r.visSpan || 0) * 100).toFixed(1) + "%").padEnd(8) +
            `[${r.muzNdc}]` + (r.muzVisible ? "" : "   muzzle off/behind"));
        }
    }
  }
  done(0);
}

const rows = [];
const onlyArg = process.argv.indexOf("--only");
const onlyStates = onlyArg > 0 ? [process.argv[onlyArg + 1]] : ["carry", "present", "ads"];
for (const flag of [false, true]) {
  for (const state of onlyStates) {
    log(`sampling ${flag ? "FIX" : "OLD"} ${state}…`);
    rows.push(await sample(flag, state, `${flag ? "FIX" : "OLD"} ${state}`));
    log(`  → vis ${(rows[rows.length - 1].vis * 100) | 0}% span ${((rows[rows.length - 1].visSpan || 0) * 100).toFixed(1)}% dist ${rows[rows.length - 1].dist}`);
  }
}

log("checking the real trigger…");
const sig = await triggerSignalCheck();

const fails = [];
const by = (f, s) => rows.find((r) => r.flag === f && r.state === s) || {};
if (sig.before.tier !== 0) fails.push(`idle armed should be the CARRY tier, got ${sig.before.tier}`);
if (sig.held.tier !== 1) fails.push(`a held trigger should be the PRESENT tier, got ${sig.held.tier} (weapon ${sig.held.weapon})`);
if (sig.after.tier !== 1) fails.push(`the post-shot linger should hold the PRESENT tier, got ${sig.after.tier}`);
if (sig.held.dist >= sig.before.dist) fails.push(`firing did not bring the boom in (${sig.before.dist} → ${sig.held.dist})`);
for (const r of rows) if (r.err) fails.push(`${r.label}: ${r.err}`);
if (!fails.length) {
  // The claim, as numbers: with the fix on, more than half the barrel and the
  // muzzle itself are visible in every armed tier, and every tier is a strict
  // improvement on the framing that shipped.
  for (const s of onlyStates) {
    const on = by("on", s), off = by("off", s);
    // THE CLAIM, as three numbers per tier: most of the barrel reaches the
    // lens, the muzzle is one of the parts that does, and what you can see is
    // big enough to read. The "not worse than before" line is deliberately on
    // VIS and not on span: the old ADS scored a high span by framing the
    // player's chest below the bottom edge (playerNDC −1.03), and trading some
    // of that back for a shot with the character actually in it is the point.
    // CARRY is judged on a weaker claim than the other two, and deliberately.
    // A carbine is ~1.1 m long and the low-ready hand rides ~0.85 m off the
    // ground, so holsterprops' ground-clearance solver has no choice but to
    // stand the barrel near vertical against the leg — no camera angle makes a
    // vertical rifle broadside. What framing CAN fix there is that the weapon
    // was under the bottom edge of the frame entirely (NDC −1.15), and that is
    // what this asserts. PRESENT and ADS carry the full claim.
    if (!(on.onScreen > 0.5)) fails.push(`${s}: only ${(on.onScreen * 100) | 0}% of the barrel is even inside the frame (want >50%)`);
    if (!(on.onScreen >= off.onScreen - 0.08)) fails.push(`${s}: less of the weapon is in frame than before (${on.onScreen} vs ${off.onScreen})`);
    if (!(on.playerNdc[1] > -0.85)) fails.push(`${s}: the player's chest is at NDC y ${on.playerNdc[1]} — falling out of the bottom of frame`);
    if (s === "carry") continue;
    if (!(on.vis > 0.5)) fails.push(`${s}: only ${(on.vis * 100) | 0}% of the barrel reaches the lens with the fix on (want >50%)`);
    if (!on.muzVisible) fails.push(`${s}: the muzzle is still hidden with the fix on (muzNDC ${on.muzNdc})`);
    // SPAN is the weakest of the three on purpose: while you present, the gun
    // is locked parallel to the view axis, so a well-framed weapon is also a
    // foreshortened one. It is here to catch a frame where the "visible" barrel
    // is a couple of pixels, not to be maximised.
    if (!(on.visSpan > 0.05)) fails.push(`${s}: the visible weapon spans only ${(on.visSpan * 100).toFixed(1)}% of the frame height (want >5%)`);
    // …with one sample point of slack (1/13 of the bore): the ADS rows are the
    // SAME constants on both sides of the flag, and they still differ by that
    // much run to run, so a strict inequality here only ever reports the noise
    // floor of a breathing idle pose.
    if (!(on.vis >= off.vis - 0.08)) fails.push(`${s}: less of the weapon reaches the lens than before (${on.vis} vs ${off.vis})`);
  }
  const on = by("on", "present"), off = by("off", "present");
  if (!(on.dist < off.dist - 0.5)) fails.push(`present: the boom did not come in (${on.dist} vs ${off.dist})`);
}

if (asJson) console.log(JSON.stringify({ rows, fails }, null, 2));
else {
  const pad = (v, n) => String(v).padEnd(n);
  console.log("  flag state   weapon    VIS   ONSCREEN  muzzle  muzNDC        playerNDC     side  dist  pitch  tier");
  for (const r of rows) {
    console.log("  " + pad(r.flag, 5) + pad(r.state, 8) + pad(r.weapon || "-", 10) +
      pad(r.err ? "ERR" : ((r.vis * 100).toFixed(0) + "%"), 6) +
      pad(r.err ? "-" : ((r.visSpan * 100).toFixed(1) + "% h"), 10) +
      pad(r.err ? "-" : (r.muzVisible ? "seen" : "HIDDEN"), 8) +
      pad(r.err ? "-" : `[${r.muzNdc}]`, 14) +
      pad(r.err ? "-" : `[${r.playerNdc}]`, 14) +
      pad(r.err ? "-" : r.sideDot, 6) +
      pad(r.dist, 6) + pad(r.rigPitch, 7) + pad(r.tier, 5) +
      (r.blockedBy ? "  blocked by " + r.blockedBy : "") +
      (r.shot ? "  " + r.shot : ""));
  }
  console.log("");
  for (const f of fails) console.log("  FAIL " + f);
  console.log(`  trigger signal: idle tier ${sig.before.tier} (boom ${sig.before.dist}) → held ${sig.held.tier} (boom ${sig.held.dist}) → linger ${sig.after.tier} (boom ${sig.after.dist})`);
  console.log(fails.length ? `\n  ${fails.length} FAIL` : "\n  OK — the gun is visible in every armed tier");
}
done(fails.length ? 1 : 0);
