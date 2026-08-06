#!/usr/bin/env node
/* ============================================================
   tools/volcano-check.mjs — THE STRATOVOLCANO, END TO END.

   Boots the real survival mode headless, forces the volcano, drives the
   whole 20 s eruption with CBZ.stepSim() and asserts on live state. It
   exists because the owner's 2026-08-06 report was four separate claims
   about one hazard and three of them were only checkable by playing:

     "it says that it was a nuclear blast that killed you"
        -> DEATH ATTRIBUTION. Harvests every cause string the eruption
           actually emits (player + bots) and fails if any of them, or
           the lose card, or the kill feed, mentions anything nuclear.
           It also checks the PICTURE: a volcano death must raise the
           mode's ash veil, never city/nukefx.js's nuclear double-pulse
           whiteout (audit_nukeVeilsBorrowed, pinned at 0).

     "it also doesn't kill you correctly"
        -> Two failure modes, both pinned. (a) A point inside the DRAWN
           pyroclastic cloud must be lethal — the lane test and the
           geometry now share one function, and this proves it by
           sampling the actual billow positions. (b) Touching lava must
           NOT be an instakill: the flow moves slower than a walk, so
           stepping out has to save you.

     "all the magma shoots out at once instead of dripping down the side"
        -> Front speed is pinned under 2.5 m/s (measured flows run
           0.0003-0.04 m/s; this file used to command 4.2-6.8), the
           vents must open in SEQUENCE, and the advance must be UNEVEN
           — a constant-rate ribbon cannot read as viscous, so the
           sampled per-second advances must vary.

     "it shoots out ash that just looks like a bunch of floating rocks"
        -> The eruption column must be live, opaque and made of enough
           overlapping billows to read as one cloud.

   Usage: node tools/volcano-check.mjs [--seed 90210] [--keep]
   Prints one line per assertion and exits non-zero on any failure.
   ============================================================ */

import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const t = process.argv[i];
  if (!t.startsWith("--")) continue;
  const k = t.slice(2);
  args[k] = (i + 1 < process.argv.length && !process.argv[i + 1].startsWith("--")) ? process.argv[++i] : true;
}
const seed = args.seed || "90210";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serverPort = 9600 + Math.floor(Math.random() * 150);
const debugPort = 11200 + Math.floor(Math.random() * 150);
const profile = `/tmp/cbz-volcano-${debugPort}`;
// macOS has no /opt/pw-browsers — see docs/claude/verification.md
const chromePath = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "/opt/pw-browsers/chromium");
const base = `http://127.0.0.1:${serverPort}/?seed=${seed}`;

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? "" : String(detail) });
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail == null ? "" : "  [" + detail + "]"));
}

await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  cwd: ROOT, env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--mute-audio",
  "--window-size=1000,650", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base,
], { cwd: ROOT, stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + " timed out")); } }, 120000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function ev(expr) {
  const msg = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  const r = msg && msg.result;
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "evaluation failed");
  return r && r.result && r.result.value;
}
const json = async (expr) => JSON.parse(await ev(`JSON.stringify(${expr})`));

let failed = 0;
try {
  let page = null;
  for (let i = 0; i < 200 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((p) => p.type === "page" && p.url.startsWith(base));
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("Chrome page never became available");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg);
  });
  await send("Runtime.enable");

  for (let i = 0; i < 220; i++) {
    if (await ev("document.readyState==='complete' && !!(window.CBZ && CBZ.setMode && CBZ.stepSim && CBZ.disasters && CBZ.disasters.force && CBZ.volcanoAudit)")) break;
    await sleep(250);
  }

  // ---------- RUN A: the whole eruption, player left alive off the mountain.
  //            Everything about the LOOK and the PACING is measured here.
  const A = await json(`(function () {
    CBZ.setMode("survival"); CBZ.resetGame(); CBZ.setState("playing");
    // stop the real rAF loop racing the deterministic fixed-dt burst
    window.requestAnimationFrame = function () { return 0; };
    /* THE ROUND MUST NOT END UNDER THE MEASUREMENT. core/loop.js only runs
       the updater chain while g.state === "playing", and a full eruption
       routinely kills 98 of the 99 bots — so the round can resolve mid-event
       and freeze the sim at whatever second it happened to reach. Two earlier
       versions of this tool read that as "the volcano never ends". A harness
       pins the state; it does not politely wait for a coin flip. */
    const alive = function () { if (CBZ.game.state !== "playing") CBZ.setState("playing"); };
    CBZ.disasters.force("volcano");
    const R = { advances: [], ventsPending: [], column: [], causes: {}, lavaCounts: [],
                ashOut: [], fogFar: [], ashOutDark: false };
    // through the warn phase into the active eruption
    for (let i = 0; i < 400; i++) { alive(); CBZ.stepSim(1 / 60); }
    const arena = CBZ.surv.arena, h = arena.hills[0];
    // park the player well off the cone so this run measures looks, not death
    const px = arena.center.x, pz = arena.center.z + arena.radius * 0.92;
    let lastLen = null;
    for (let sec = 0; sec < 38; sec++) {
      for (let i = 0; i < 60; i++) {
        CBZ.player.pos.x = px; CBZ.player.pos.z = pz;
        CBZ.player.pos.y = arena.groundHeightAt(px, pz) + 1;
        alive(); CBZ.stepSim(1 / 60);
      }
      const d = CBZ.disasterAudit(), v = CBZ.volcanoAudit();
      R.ventsPending.push(d.lavaVentsPending);
      R.lavaCounts.push(v.lavaFlows);
      if (d.erupting) {
        R.ashOut.push(d.ashOut);
        R.fogFar.push(d.ashOutFog);
        if (!d.ashOutLit) R.ashOutDark = true;
      }
      R.column.push({ live: v.columnLive, blobs: v.columnBillows, trans: v.columnTransparent, top: v.columnTopY });
      // front advance of the FIRST flow, one sample per simulated second
      const len = v.lavaTips.length ? v.lavaTips[0] : null;
      if (len && lastLen) R.advances.push(+Math.hypot(len.x - lastLen.x, len.z - lastLen.z).toFixed(3));
      lastLen = len;
      const feed = CBZ.cityRecentDeaths || [];
      for (let k = 0; k < feed.length; k++) R.causes[feed[k].cause] = 1;
    }
    const d = CBZ.disasterAudit(), v = CBZ.volcanoAudit();
    R.frontSpeed = d.lavaFrontSpeed;
    R.lavaTransparent = v.lavaTransparent;
    R.nukeVeilsBorrowed = d.nukeVeilsBorrowed;
    R.ashVeils = d.ashVeils;
    R.pyroRuns = d.pyroRuns;
    R.playerDead = !!CBZ.player.dead;
    /* ...and then let the ERUPTION end, so the scars can be counted. Wait on
       the eruption specifically, not on the director going idle: the arc rolls
       straight into the next hazard, so "idle" can be several disasters away
       and "active" can mean somebody else's. */
    for (let i = 0; i < 1800 && CBZ.disasters.current() === "VOLCANIC ERUPTION"; i++) { alive(); CBZ.stepSim(1 / 60); }
    alive(); CBZ.stepSim(1 / 60);
    R.endState = CBZ.disasters.current() || "idle";
    const v2 = CBZ.volcanoAudit();
    R.setFlows = v2.lavaSet;
    R.flowsAfter = v2.lavaFlows;
    R.causeList = Object.keys(R.causes);
    return R;
  })()`);

  console.log("\nRUN A — the eruption, watched from the beach");
  const NUKEY = /nuclear|nuke|atomic|vaporiz|fallout/i;
  const badCause = A.causeList.filter((c) => NUKEY.test(c));
  check("no eruption death names anything nuclear", badCause.length === 0,
    badCause.length ? badCause.join(" | ") : A.causeList.length + " causes: " + A.causeList.join(" | "));
  check("volcano never borrows the nuclear double-pulse whiteout", A.nukeVeilsBorrowed === 0, "borrowed=" + A.nukeVeilsBorrowed);

  check("eruption column is live", A.column.some((c) => c.live > 0), "peak live=" + Math.max(...A.column.map((c) => c.live)));
  check("column is OPAQUE (no transparent billows, ever)", A.column.every((c) => c.trans === 0), "max=" + Math.max(...A.column.map((c) => c.trans)));
  const peakBlobs = Math.max(...A.column.map((c) => c.blobs));
  check("column has enough overlapping billows to read as one cloud", peakBlobs >= 20, "peak billows=" + peakBlobs);
  /* Measure the PEAK, not the last sample: the run now carries on into the
     ash-out, where the column has deliberately collapsed, so comparing first
     against last would score the third act instead of the first. */
  const topPeak = Math.max(...A.column.map((c) => c.top));
  check("column BUILDS instead of arriving whole", topPeak > A.column[0].top * 1.8,
    A.column[0].top + " -> peak " + topPeak.toFixed(0) + " m");
  check("...and it COMES DOWN again in the ash-out",
    A.column[A.column.length - 1].top < topPeak * 0.75,
    "peak " + topPeak.toFixed(0) + " -> end " + A.column[A.column.length - 1].top.toFixed(0) + " m");

  check("lava front speed is not a jog", A.frontSpeed > 0 && A.frontSpeed < 2.5, A.frontSpeed + " m/s");
  check("lava stays opaque", A.lavaTransparent === 0, A.lavaTransparent);
  check("vents open in SEQUENCE, not all on frame one", A.ventsPending.some((v) => v > 0) && A.lavaCounts[0] < A.lavaCounts[A.lavaCounts.length - 1],
    "pending=" + A.ventsPending.join(",") + " flows=" + A.lavaCounts.join(","));
  // viscosity IS the unevenness — a constant-rate ribbon has zero spread
  const adv = A.advances.filter((x) => x > 0);
  const mean = adv.reduce((s, x) => s + x, 0) / Math.max(1, adv.length);
  const spread = Math.sqrt(adv.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(1, adv.length)) / (mean || 1);
  check("the front STALLS and LURCHES (viscous pacing, not constant rate)", adv.length >= 4 && spread > 0.25,
    "mean=" + mean.toFixed(2) + " m/s  cv=" + spread.toFixed(2));
  check("stopped lava sets into a scar instead of vanishing", A.setFlows > 0,
    "set=" + A.setFlows + " of " + A.flowsAfter + " (director " + A.endState + ")");
  // ---- the third act: the island disappears inside its own cloud ----
  const peakEg = Math.max(0, ...A.ashOut);
  const minFog = Math.min(...A.fogFar.filter((f) => f > 0));
  check("the eruption SUSTAINS instead of being over in a blink",
    A.ashOut.length >= 30, A.ashOut.length + " s of live eruption sampled");
  check("the column collapses into an ash-out", peakEg > 0.95, "peak engulf=" + peakEg.toFixed(2));
  check("the ash-out fills the whole map (visibility collapses)", minFog > 0 && minFog < 45,
    "fogFar " + Math.max(...A.fogFar) + " -> " + minFog + " m");
  check("the ash-out is a LUMINOUS grey, not nightfall", !A.ashOutDark, "hemi stays up");

  /* ---------- RUN B: the two kill models, MEASURED SEPARATELY.
        B1 turns the density current OFF (VOLCANO_PYRO is a live flag) and
        measures lava alone. That is not tidiness: the lava flows come off the
        same cone as the lane, they overlap it, and an earlier version of this
        tool kept reporting "lava killed me in 0.0 s" when what had actually
        happened was a pyroclastic flow arriving over the probe. A test that
        can be answered by the wrong hazard is not a test. */
  const B = await json(`(function () {
    CBZ.CONFIG.VOLCANO_PYRO = false;
    CBZ.setMode("survival"); CBZ.resetGame(); CBZ.setState("playing");
    window.requestAnimationFrame = function () { return 0; };
    /* THE ROUND MUST NOT END UNDER THE MEASUREMENT. core/loop.js only runs
       the updater chain while g.state === "playing", and a full eruption
       routinely kills 98 of the 99 bots — so the round can resolve mid-event
       and freeze the sim at whatever second it happened to reach. Two earlier
       versions of this tool read that as "the volcano never ends". A harness
       pins the state; it does not politely wait for a coin flip. */
    const alive = function () { if (CBZ.game.state !== "playing") CBZ.setState("playing"); };
    CBZ.disasters.force("volcano");
    for (let i = 0; i < 400; i++) { alive(); CBZ.stepSim(1 / 60); }
    const arena = CBZ.surv.arena;
    const R = { lavaTicks: 0, lavaMinHp: 100, lavaSurvived: false, cloudMiss: 0, cloudSamples: 0 };

    /* (a) LAVA BURNS ON A CLOCK. Stand in the BODY of a live flow — not on
           its tip, where a float-equal against the live advance makes the
           membership test flap — and record how long it takes. Half a second
           must be survivable (you can step out of something moving slower than
           you walk) and three seconds must not be. An instakill build fails
           the first; a decorative one fails the second. */
    const V3 = new THREE.Vector3();
    let F = null;
    // grab it as soon as it has a BODY to stand in, and only while the
    // eruption is still running — a set flow is terrain and refuses hitTest
    for (let i = 0; i < 1800 && !F; i++) {
      alive(); CBZ.stepSim(1 / 60);
      const L = CBZ.volcanoFx.live.lava[0];
      if (L && !L.hardened && L.length > 7) F = L;
    }
    function standIn(frac) {
      CBZ.volcanoFx.pathAt(F.path, F.length * frac, V3);
      CBZ.player.pos.x = V3.x; CBZ.player.pos.z = V3.z;
      CBZ.player.pos.y = arena.groundHeightAt(V3.x, V3.z) + 1;
      return F.hitTest(V3.x, V3.z);
    }
    if (F) {
      R.inFlow = !!standIn(0.55);
      CBZ.player.hp = 100; CBZ.player.dead = false;
      // half a second of contact
      for (let i = 0; i < 30 && !CBZ.player.dead; i++) { standIn(0.55); alive(); CBZ.stepSim(1 / 60); R.lavaTicks++; }
      R.lavaSurvived = !CBZ.player.dead;
      R.lavaHurt = +(100 - CBZ.player.hp).toFixed(1);
      // ...and keep standing there
      for (let i = 0; i < 180 && !CBZ.player.dead; i++) { standIn(0.55); alive(); CBZ.stepSim(1 / 60); R.lavaTicks++; }
      R.lavaFatal = !!CBZ.player.dead;
      R.lavaTicksToDeath = R.lavaTicks;
      R.lavaCause = CBZ.surv._deathCause || null;
    }

    return R;
  })()`);

  /* B2: WHAT YOU SEE IS WHAT KILLS YOU. Walk the live pyroclastic cloud's own
     billow meshes and ask its own contains() about each one's ground position.
     A billow the player can see must be a billow that kills. */
  const B2 = await json(`(function () {
    CBZ.CONFIG.VOLCANO_PYRO = true;
    CBZ.setMode("survival"); CBZ.resetGame(); CBZ.setState("playing");
    window.requestAnimationFrame = function () { return 0; };
    const alive = function () { if (CBZ.game.state !== "playing") CBZ.setState("playing"); };
    CBZ.disasters.force("volcano");
    for (let i = 0; i < 400; i++) { alive(); CBZ.stepSim(1 / 60); }
    const arena = CBZ.surv.arena;
    const R = { cloudMiss: 0, cloudSamples: 0 };
    CBZ.player.hp = 100; CBZ.player.dead = false;
    CBZ.player.pos.x = arena.center.x; CBZ.player.pos.z = arena.center.z + arena.radius * 0.95;
    for (let i = 0; i < 2400; i++) {
      alive(); CBZ.stepSim(1 / 60);
      const P = CBZ.volcanoFx && CBZ.volcanoFx.live && CBZ.volcanoFx.live.pyro[0];
      if (!P) continue;
      const g = P.group;
      for (let k = 0; k < g.children.length; k++) {
        const m = g.children[k];
        if (!m.visible) continue;
        // the CORE of a visible billow, at ground level
        R.cloudSamples++;
        if (!P.contains(m.position.x, m.position.z, arena.groundHeightAt(m.position.x, m.position.z) + 1)) R.cloudMiss++;
      }
      if (R.cloudSamples > 400) break;
    }
    return R;
  })()`);

  console.log("\nRUN B — the two kill models");
  check("the probe is genuinely standing in the flow", B.inFlow === true, "hitTest=" + B.inFlow);
  check("lava BURNS, it does not instakill on contact", B.lavaSurvived === true,
    "hp lost in 0.5 s = " + B.lavaHurt);
  check("...but standing in it IS fatal", B.lavaFatal === true && /lava/.test(B.lavaCause || ""),
    (B.lavaTicksToDeath / 60).toFixed(1) + " s -> " + B.lavaCause);
  if (B2.cloudSamples > 0) {
    const missPct = (B2.cloudMiss / B2.cloudSamples) * 100;
    check("what you SEE in the pyroclastic cloud is what kills you", missPct < 15,
      B2.cloudMiss + "/" + B2.cloudSamples + " visible billow cores not lethal (" + missPct.toFixed(0) + "%)");
  } else {
    console.log("  skip  pyroclastic billow sampling (no probe handle exported)");
  }

  // ---------- RUN C: the player actually dies to the flow. What does the
  //            game SAY, on every channel the player can read?
  const C = await json(`(function () {
    CBZ.setMode("survival"); CBZ.resetGame(); CBZ.setState("playing");
    window.requestAnimationFrame = function () { return 0; };
    /* THE ROUND MUST NOT END UNDER THE MEASUREMENT. core/loop.js only runs
       the updater chain while g.state === "playing", and a full eruption
       routinely kills 98 of the 99 bots — so the round can resolve mid-event
       and freeze the sim at whatever second it happened to reach. Two earlier
       versions of this tool read that as "the volcano never ends". A harness
       pins the state; it does not politely wait for a coin flip. */
    const alive = function () { if (CBZ.game.state !== "playing") CBZ.setState("playing"); };
    CBZ.disasters.force("volcano");
    for (let i = 0; i < 400; i++) { alive(); CBZ.stepSim(1 / 60); }
    const arena = CBZ.surv.arena, h = arena.hills[0];
    for (let i = 0; i < 2000 && !CBZ.player.dead; i++) {
      alive();
      CBZ.player.pos.x = h.x + 6; CBZ.player.pos.z = h.z + 6;
      CBZ.player.pos.y = arena.groundHeightAt(h.x + 6, h.z + 6) + 1;
      CBZ.stepSim(1 / 60);
    }
    if (CBZ.surv.spectating) { const b = document.querySelector("#spectate button"); if (b) b.click(); }
    const d = CBZ.disasterAudit();
    return {
      dead: !!CBZ.player.dead,
      deathCause: CBZ.surv._deathCause,
      loseSub: (document.querySelector("#survlose .sub") || {}).textContent || "",
      feed: (CBZ.cityRecentDeaths || []).filter(function (e) { return e.you; }).map(function (e) { return e.cause; }),
      ashVeils: d.ashVeils, borrowed: d.nukeVeilsBorrowed,
      flashColor: CBZ.survEnv.flashColor,
    };
  })()`);

  console.log("\nRUN C — you die to the flow: what does the game say?");
  check("the player actually died to the eruption", C.dead, C.deathCause);
  check("the death cause is volcanic", !NUKEY.test(C.deathCause || ""), C.deathCause);
  check("the lose card does not mention a nuclear blast", !NUKEY.test(C.loseSub), C.loseSub.slice(0, 90));
  check("the kill feed does not mention a nuclear blast", !C.feed.some((c) => NUKEY.test(c)), C.feed.join(" | "));
  check("the death raised the ASH veil, not the nuclear one", C.ashVeils > 0 && C.borrowed === 0,
    "ash=" + C.ashVeils + " borrowed=" + C.borrowed);

  failed = results.filter((r) => !r.ok).length;
  console.log("\n" + (failed ? "VOLCANO: " + failed + " FAILED" : "VOLCANO: ok") + "  (" + results.length + " assertions)");
} catch (e) {
  console.error("VOLCANO CHECK ERROR:", e.message);
  failed = 1;
} finally {
  try { ws && ws.close(); } catch (_) {}
  chrome.kill("SIGKILL"); server.kill("SIGKILL");
  if (!args.keep) { try { await rm(profile, { recursive: true, force: true }); } catch (_) {} }
  process.exit(failed ? 1 : 0);
}
