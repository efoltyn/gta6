#!/usr/bin/env node
/* tools/invisible-wall-check.mjs — THE INVISIBLE WALL, MEASURED.
   ------------------------------------------------------------------
   An AABB cannot describe a diagonal wall. Every curved ring in this game
   (the arena bowl's rails and facade, the beast pit, venue perimeter fences,
   speedway grandstands and SAFER barriers) is built by walking an arc as
   short ROTATED chords — and each one used to be handed to physics.js as its
   own axis-aligned bounding box. On a 45-degree chord that box is a square as
   wide as the chord is long, so the player was stopped METRES short of a wall
   they could see through. It measured worst on the speedway perimeter: 0.32 m
   of chain-link registered as boxes up to 12.7 m across.

   This gate boots the real game and asks the only question that matters:
   IS THERE GROUND THE PLAYER IS PUSHED OUT OF THAT NO WALL OCCUPIES?

   For every oriented collider in the live world it samples the gap between
   the true wall body and that collider's own bounding box — ground the old
   form made solid and this one must not — and calls the SHIPPING resolver
   (CBZ.collide, the same function the player runs) on each sample. Any push
   at all is an invisible wall and fails the gate.

   It also re-runs every sample against the box-only form, so the report
   states what was actually reclaimed rather than asserting an improvement.

   Usage:
     node tools/invisible-wall-check.mjs            # default seed
     node tools/invisible-wall-check.mjs 90210 1 2  # several seeds
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const seeds = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [90210];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CBZ_CHROME
  || (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");

const port = 8890 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
await sleep(700);

let failures = 0;

/* ---- THE PROBE, run inside the page against the live world -------------
   PLAYER_R is read from the live TUNE, never re-typed: the comments in
   physics.js still say 0.55 while config.js ships 0.38, and a gate that
   guesses which is a gate measuring the wrong body. */
const PROBE = `(() => {
  const cols = CBZ.colliders || [];
  const R = (CBZ.TUNE && CBZ.TUNE.playerRadius) || (CBZ.player && CBZ.player.radius) || 0.38;
  // distance from a point to an oriented box, in the box's own frame
  function distOri(px, pz, c) {
    const co = Math.cos(c.yaw), si = Math.sin(c.yaw);
    const rx = px - c.cx, rz = pz - c.cz;
    const lx = rx * co - rz * si, lz = rx * si + rz * co;
    const dx = Math.max(Math.abs(lx) - c.hw, 0), dz = Math.max(Math.abs(lz) - c.hd, 0);
    return Math.hypot(dx, dz);
  }
  function distAabb(px, pz, c) {
    const dx = Math.max(c.minX - px, 0, px - c.maxX);
    const dz = Math.max(c.minZ - pz, 0, pz - c.maxZ);
    return Math.hypot(dx, dz);
  }
  let oriented = 0, sampled = 0, stuckNow = 0, stuckBefore = 0;
  let worstNow = 0, worstBefore = 0, worstWhere = null;
  const p = { x: 0, z: 0 };
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (!c.yaw) continue;
    oriented++;
    // sample the collider's own bounding box on a grid; keep only the points
    // that are CLEAR of the real wall by more than a body radius. Those are
    // the metres the AABB form invented, and nothing may stand in them.
    const N = 9;
    for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) {
      const x = c.minX + (c.maxX - c.minX) * a / N;
      const z = c.minZ + (c.maxZ - c.minZ) * b / N;
      if (distOri(x, z, c) <= R + 0.02) continue;       // legitimately touching the wall
      sampled++;
      // 1) the SHIPPING resolver, on this collider alone (feetY/headY inside
      //    its band so the height gate cannot mask the answer)
      const mid = (c.y0 != null) ? (c.y0 + c.y1) / 2 : 1.0;
      p.x = x; p.z = z;
      CBZ.collide(p, R, mid - 0.2, mid + 0.2);
      const moved = Math.hypot(p.x - x, p.z - z);
      if (moved > 1e-4) {
        // SOMETHING ELSE MAY LEGITIMATELY BE STANDING HERE, and on a ring it
        // usually is: consecutive chords on an arc overlap at their ends, so
        // a point clear of chord A is routinely inside chord B. A sample only
        // indicts the geometry if NO collider in the world has real body
        // within a radius of it — and each one is measured by its TRUE shape
        // (oriented ones oriented), never by the box we are here to disprove.
        let other = false;
        for (let k = 0; k < cols.length && !other; k++) {
          const o = cols[k]; if (o === c) continue;
          if (o.y0 != null && (mid + 0.2 <= o.y0 || mid - 0.2 >= o.y1)) continue;
          if (o.yaw ? (distOri(x, z, o) < R) : (distAabb(x, z, o) < R)) other = true;
        }
        if (!other) {
          stuckNow++;
          if (moved > worstNow) { worstNow = moved; worstWhere = { x: +x.toFixed(1), z: +z.toFixed(1) }; }
        }
      }
      // 2) the same point against the BOX-ONLY form this collider replaced
      const dB = distAabb(x, z, c);
      if (dB < R) { stuckBefore++; const w = R - dB; if (w > worstBefore) worstBefore = w; }
    }
  }
  return { total: cols.length, oriented, sampled, stuckNow, stuckBefore,
           worstNow: +worstNow.toFixed(3), worstBefore: +worstBefore.toFixed(3),
           worstWhere, radius: R };
})()`;

for (const seed of seeds) {
  const dbg = 9890 + Math.floor(Math.random() * 100);
  const profile = `/tmp/cbz-invwall-${dbg}`;
  await rm(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
    "--enable-webgl", "--mute-audio", "--window-size=1000,800",
    `--remote-debugging-port=${dbg}`, `--user-data-dir=${profile}`,
    `http://127.0.0.1:${port}/?seed=${seed}`,
  ], { stdio: "ignore" });

  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    try {
      const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json();
      page = ps.find((q) => q.type === "page" && q.url.includes("seed="));
    } catch (_) { /* chrome not up yet */ }
    if (!page) await sleep(250);
  }
  if (!page) { console.error(`seed ${seed}: no page`); chrome.kill("SIGKILL"); failures++; continue; }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  let id = 1; const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((r) => {
    const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evl = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false });
    if (r.result && r.result.exceptionDetails) {
      console.error("  EXC:", JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    }
    return r.result && r.result.result && r.result.result.value;
  };
  await send("Runtime.enable"); await send("Page.enable");

  for (let i = 0; i < 60; i++) {
    if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break;
    await sleep(500);
  }
  let playing = false;
  for (let i = 0; i < 120 && !playing; i++) {
    await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()");
    await sleep(600);
    playing = await evl("!!(CBZ.game && CBZ.game.state === 'playing')");
  }
  if (!playing) { console.error(`seed ${seed}: never reached play`); chrome.kill("SIGKILL"); failures++; continue; }
  await sleep(4000);                     // let the lazy world finish building

  const r = await evl(PROBE);
  chrome.kill("SIGKILL");
  // best-effort: a just-killed Chrome can still be writing its profile, and
  // losing a temp directory is not a reason to lose the measurement
  try { await rm(profile, { recursive: true, force: true }); } catch (_) { /* ignore */ }

  if (!r) { console.error(`seed ${seed}: probe returned nothing`); failures++; continue; }
  console.log(`\nseed ${seed} — body radius ${r.radius}`);
  console.log(`  colliders ${r.total}, oriented ${r.oriented}`);
  console.log(`  samples in reclaimed ground: ${r.sampled}`);
  console.log(`  blocked by the OLD box form: ${r.stuckBefore} (worst overlap ${r.worstBefore} m)`);
  console.log(`  blocked NOW:                 ${r.stuckNow} (worst push ${r.worstNow} m)`);

  // THE RATCHETS.
  if (r.oriented === 0) {
    console.error("  ✗ no oriented colliders in the world — a rotated wall has been re-typed as an AABB");
    failures++;
  } else if (r.stuckNow > 0) {
    console.error(`  ✗ ${r.stuckNow} samples still pushed, worst ${r.worstNow} m at ` +
      JSON.stringify(r.worstWhere) + " — invisible wall");
    failures++;
  } else {
    console.log(`  ✓ every one of ${r.sampled} reclaimed samples walks free`);
  }
}

server.kill("SIGKILL");
if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log("\nPASS");
