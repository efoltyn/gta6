#!/usr/bin/env node
/* Focused real-Chrome regression for THE SINKHOLE — world/groundshaft.js.
 *
 * WHAT THIS FILE IS DEFENDING, AND WHY IT EXISTS
 * ----------------------------------------------
 * The ground over a shaft is not cut, it is DISCARDED: a hole is a fragment
 * shader throwing away every pixel inside a mouth, because the island is one
 * 64-triangle disc and the city is a plate and neither can be re-topologised.
 * That makes "is there a hole here" and "is the ground gone here" TWO separate
 * mechanisms — a shader mask and a floor query — and the entire failure family
 * of this feature is the two of them disagreeing. When they do, you get the
 * same artefact every time: the torn lip collar drawn on unbroken ground, road
 * running straight across it, and a forty-metre drop underneath that the floor
 * query happily hands you. A ring you fall through.
 *
 * Three separate bugs of exactly that shape shipped, none of which any existing
 * check could see, because a shaft that is cut, registered, on flat ground and
 * subtracted from the floor passes every assertion anyone had written:
 *
 *   1. the mask's slots were filled in CREATION order, so once the island held
 *      more shafts than slots the NEWEST hole — the one that just opened under
 *      the player — was the one that got no slot;
 *   2. maskGroundAt ran its raycast and its footprint sweep inside ONE `try`,
 *      and in the city root() is the whole scene, whose Sprites make a
 *      cameraless raycast throw — killing the sweep that finds the road. Every
 *      city shaft was a lip ring on intact tarmac;
 *   3. a site was swept ONCE, at the first plug's half radius, so the ring of
 *      road meshes between r/2 and r kept drawing as a partial lid.
 *
 * So the assertion this file is built around is not "a shaft exists". It is
 * THE LID: count the flat surfaces at ground level over the mouth whose
 * material is not being discarded. That number must be zero, in both modes,
 * for every hole, and it is the one measurement all three bugs move.
 *
 * Run: node tools/sinkhole-check.mjs      (CBZ_CHROME overrides the browser)
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "tools", "shots", "sinkhole-qa");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const serverPort = 9480 + Math.floor(Math.random() * 120);
const debugPort = 10980 + Math.floor(Math.random() * 120);
const profile = `/tmp/cbz-sinkhole-${debugPort}`;

/* The sibling checks hard-code /opt/pw-browsers/chromium as the BINARY, which
   is a directory on a Playwright layout (the executable is one or two levels
   down and the revision is in the folder name). Resolve it instead of guessing,
   so this runs unattended wherever the browser happens to live. */
function findChrome() {
  if (process.env.CBZ_CHROME) return process.env.CBZ_CHROME;
  const fixed = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
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
const chromePath = findChrome();
/* A DELIBERATELY SMALL CAP, ON PURPOSE. The original bug hid behind the slot
   count, so the cap's behaviour — nearest-eye ranking, and what a shaft that
   loses a slot does about its own geometry — has to be reachable. It is not
   reachable at the shipping count: hole spacing is LAW (two shafts cut into
   each other hand out the neighbour's stair), so the island saturates at about
   a dozen holes no matter how many events are forced. Rather than chase a cap
   we cannot exceed, run the check with a cap we can, and let the shipping
   default stay chosen for the game instead of for the test. */
const MASK_SLOTS_UNDER_TEST = 4;
const base = `http://127.0.0.1:${serverPort}/?seed=90210&cfg_GROUND_MASK_SLOTS=${MASK_SLOTS_UNDER_TEST}`;

await mkdir(OUT, { recursive: true });
await rm(profile, { recursive: true, force: true });
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], {
  cwd: ROOT, env: { ...process.env, PORT: String(serverPort) }, stdio: "ignore",
});
const chrome = spawn(chromePath, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--mute-audio",
  "--window-size=1200,750", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, base,
], { cwd: ROOT, stdio: "ignore" });

let ws = null, nextId = 1;
const pending = new Map(), browserErrors = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id); reject(new Error(`${method} timed out`));
    }, 300000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const msg = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  const r = msg && msg.result;
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "browser evaluation failed");
  return r && r.result && r.result.value;
}
const json = async (expr) => JSON.parse(await evaluate(`JSON.stringify((function(){${expr}})())`));
async function shot(name) {
  const msg = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = path.join(OUT, `${name}.png`);
  await writeFile(file, Buffer.from(msg.result.data, "base64"));
  return path.relative(ROOT, file);
}

/* Injected once and reused by every phase below.
 *
 * lidOver(h) is THE measurement, and getting its FILTER right is most of the
 * work — a lid metric that counts the wrong things fails on a correct build and
 * then gets ignored, which is worse than not having one.
 *
 * A lid is ground: flat (under 3 m tall), at ground level (top within 3 m of
 * the shaft's own surface height), and BIGGER THAN A PERSON in at least one
 * direction. That last clause is not a fudge, it is the definition — every real
 * ground surface in this game is metres across (the island disc is 240 m, the
 * city plate is the map, a road slab is tens of metres, even a lane stripe is
 * ~3 m long), while the things that legitimately sit over an open mouth are
 * small: a bot's 0.3 m limb boxes as it falls in, debris mid-air. Two earlier
 * drafts of this check failed on a correct build by counting exactly those —
 * once a car at the BOTTOM of the shaft (fixed by the ground-level band), once
 * the feet of bots standing at the rim.
 *
 * Actor rigs are skipped outright for the same reason groundshaft.js's
 * clearInside() skips them: a body over a hole is meant to be drawn, and to
 * fall. Anything under a userData.groundShaft parent is the hole's own geometry.
 *
 * Nothing in that filter can hide a real lid — every surface in all three
 * shipped bugs (the island disc, the ocean plane, mainland-city-surface, road
 * and paint meshes) clears the size floor by an order of magnitude. */
const HELPERS = `
window.__sink = {
  step: function (secs) {
    var n = Math.round(secs * 60);
    for (var i = 0; i < n; i++) {
      CBZ.hitstop = 0; CBZ.slowmo = 0; CBZ.stepSim(1 / 60);
      if (CBZ.player) { CBZ.player.hp = 100; CBZ.player.dead = false; }
    }
  },
  root: function () {
    return (CBZ.game.mode === "survival" && CBZ.surv && CBZ.surv.arena) ? CBZ.surv.arena.root : CBZ.scene;
  },
  actorRigs: function () {
    var rigs = [], i;
    var bots = CBZ.bots || [];
    for (i = 0; i < bots.length; i++) if (bots[i] && bots[i].group) rigs.push(bots[i].group);
    var peds = CBZ.cityPeds || [];
    for (i = 0; i < peds.length; i++) if (peds[i] && peds[i].group) rigs.push(peds[i].group);
    if (CBZ.playerChar && CBZ.playerChar.group) rigs.push(CBZ.playerChar.group);
    return rigs;
  },
  /* IS THIS MATERIAL CARRYING THE MASK? Under core/groundmask.js the discard
     lives in the fog ShaderChunks, so a material carries it unless it has no
     fog chunks at all (fog:false) or it deliberately opted out (CBZ_NOMASK —
     the shaft's own wall, lip and stair, which live inside the band on
     purpose). There is no per-material stamp any more, and that is the point:
     nothing has to be found, so nothing can be missed. */
  masked: function (m) {
    if (!m) return false;
    if (m.fog === false) return false;
    if (m.defines && m.defines.CBZ_NOMASK) return false;
    return true;
  },
  lidOver: function (h) {
    var T = window.THREE, box = new T.Box3(), out = { total: 0, unmasked: 0, names: [] };
    var rigs = window.__sink.actorRigs();
    var MIN_GROUND = 1.5;      // metres: nothing smaller than this is ground
    window.__sink.root().traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.material) return;
      for (var p = o; p; p = p.parent) {
        if (p.userData && p.userData.groundShaft) return;           // the hole itself
        if (rigs.indexOf(p) >= 0) return;                           // a body, not the ground
      }
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (box.max.y - box.min.y > 3) return;                       // not a surface
      if (box.max.y < h.gy - 3) return;                            // down in the hole
      /* IT MUST REACH THE GROUND PLANE. This is the clause that separates a lid
         from a thing STANDING on ground that is gone. Every real ground layer
         touches the surface height — measured on the shipped bugs, the island
         disc, the city plate, road, paint and kerb all sit within 0.10 m of it —
         whereas a parked car's body, a crate or a bot's shin has its underside
         a third of a metre up or more. A car over an open mouth is not a lid;
         it is a car about to fall in, which is the feature working. */
      if (box.min.y > h.gy + 0.35) return;
      if (box.max.x < h.x - h.mouth || box.min.x > h.x + h.mouth) return;
      if (box.max.z < h.z - h.mouth || box.min.z > h.z + h.mouth) return;
      if (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) < MIN_GROUND) return;
      var m = Array.isArray(o.material) ? o.material[0] : o.material;
      out.total++;
      if (window.__sink.masked(m)) return;
      out.unmasked++;
      /* NAME THE THING. "Mesh, Mesh" tells the next reader nothing, and the
         useful question about a surviving lid pixel is always the same one:
         is it the ground, or is it something that arrived AFTER the sweep?
         So the label carries what distinguishes those — the material's own
         name, the parent's name, the footprint, and how far above the shaft
         mouth it sits. */
      if (out.names.length < 8) {
        out.names.push([
          o.name || o.type,
          "mat=" + ((m && (m.name || m.type)) || "?"),
          "parent=" + ((o.parent && (o.parent.name || o.parent.type)) || "-"),
          (box.max.x - box.min.x).toFixed(1) + "x" + (box.max.z - box.min.z).toFixed(1) + "m",
          "top=" + (box.max.y - h.gy).toFixed(2), "base=" + (box.min.y - h.gy).toFixed(2),
        ].join(" "));
      }
    });
    return out;
  },
  // every live hole's lid, plus the audit, in one call
  survey: function () {
    var S = CBZ.groundShafts || [], worst = null, holes = [];
    for (var i = 0; i < S.length; i++) {
      var lid = window.__sink.lidOver(S[i]);
      var floor = CBZ.floorAt ? CBZ.floorAt(S[i].x, S[i].z) : null;
      var rec = {
        i: i, r: +S[i].r.toFixed(1), depth: +S[i].depth.toFixed(1),
        drawn: !!(S[i].grp && S[i].grp.visible),
        lidTotal: lid.total, lidUnmasked: lid.unmasked, lidNames: lid.names,
        // the floor must agree with the picture: standing over the middle of a
        // hole means the ground is gone, not that it is 0.2 m lower
        floorDrop: floor == null ? null : +(S[i].gy - floor).toFixed(1),
      };
      holes.push(rec);
      if (!worst || rec.lidUnmasked > worst.lidUnmasked) worst = rec;
    }
    return { shafts: S.length, audit: CBZ.shaftAudit(), holes: holes, worst: worst };
  },
  standAt: function (i) {
    var S = CBZ.groundShafts || [], h = S[i];
    if (!h) return null;
    var px = h.x + h.r * 1.5, pz = h.z + h.r * 1.5;
    if (CBZ.player && CBZ.player.pos) {
      CBZ.player.pos.set(px, (CBZ.floorAt ? CBZ.floorAt(px, pz) : 0) + 1.2, pz);
      if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.position.copy(CBZ.player.pos);
    }
    window.__sink.step(0.5);
    var a = CBZ.shaftAudit(), lid = window.__sink.lidOver(h);
    return {
      i: i, drawn: !!(h.grp && h.grp.visible), lidUnmasked: lid.unmasked,
      rings: a.ringsOnSolidGround, playerInUnslotted: a.playerInUnslotted,
      unslotted: a.unslottedShafts, nearestUnslotted: a.nearestUnslotted,
    };
  },
  frame: function (i, up) {
    var S = CBZ.groundShafts || [], h = S[i] || S[0];
    if (!h) return false;
    var c = CBZ.camera;
    c.aspect = 1200 / 750; c.fov = 55; c.near = 0.4; c.far = 20000;
    c.position.set(h.x + h.r * 0.9, h.gy + (up || h.r * 3.4), h.z + h.r * 1.4);
    c.lookAt(h.x, h.gy - h.depth * 0.28, h.z);
    c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    if (typeof CBZ.skySync === "function") CBZ.skySync();
    else { var rig = CBZ.skyDome && CBZ.skyDome.parent; if (rig) { rig.position.set(c.position.x, 0, c.position.z); rig.updateMatrixWorld(true); } }
    var cv = CBZ.renderer && CBZ.renderer.domElement;
    for (var k = 0, ch = Array.prototype.slice.call(document.body.children); k < ch.length; k++) {
      if (ch[k] === cv || (cv && ch[k].contains && ch[k].contains(cv))) continue;
      ch[k].style.visibility = "hidden";
    }
    try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {}
    return true;
  },
};
true;`;

try {
  let page = null;
  for (let i = 0; i < 200 && !page; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      page = pages.find((p) => p.type === "page" && p.url.startsWith(`http://127.0.0.1:${serverPort}/`));
    } catch (_) {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error(`Chrome page did not become available (browser: ${chromePath})`);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params?.exceptionDetails;
      const text = d?.exception?.description || d?.text || "runtime exception";
      // the loader fires ProgressEvent for optional assets; not our business
      if (!/ProgressEvent/.test(text)) browserErrors.push(text);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      browserErrors.push(msg.params.args.map((a) => a.value || a.description || "").join(" "));
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg);
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 750, deviceScaleFactor: 1, mobile: false });

  for (let i = 0; i < 220; i++) {
    if (await evaluate("document.readyState==='complete' && !!(window.CBZ && CBZ.setMode && CBZ.stepSim && CBZ.disasters && CBZ.disasters.force && CBZ.shaftAudit && CBZ.groundShaft)")) break;
    await sleep(250);
  }
  await evaluate(HELPERS);

  const failures = [];

  // ---- SURVIVAL: run the roster past the mask's slot count -----------------
  // The cap is what bug (1) hid behind, so the check must exceed it. Six forced
  // events on an island that keeps its holes gets comfortably past eight.
  const boot = await json(`
    CBZ.setMode("survival"); CBZ.resetGame(); CBZ.setState("playing");
    window.requestAnimationFrame = function () { return 0; };
    return { mode: CBZ.game.mode, arena: !!(CBZ.surv && CBZ.surv.arena), slots: CBZ.shaftAudit().maskSlots };`);
  await sleep(150);
  await evaluate(`(function(){__sink.step(2);})()`);

  /* ONE EVENT PER ROUND-TRIP. Six forced events is ~9000 fixed steps and, on a
     software rasteriser, comfortably past any single-evaluate patience. Driving
     them one at a time keeps each call short and makes a stall report which
     event it stalled on instead of just "timed out". */
  /* Roughly two shafts per forced event; the cap under test is small, so six
     events clears it with room to spare. */
  const EVENTS = 6;
  let survival = null;
  for (let e = 0; e < EVENTS; e++) {
    const r = await json(`
      CBZ.disasters.force("sinkhole"); __sink.step(0.2);
      var g = 600; while (g-- > 0 && CBZ.disasters.state() !== "active") __sink.step(0.1);
      __sink.step(24);
      g = 600; while (g-- > 0 && CBZ.disasters.state() !== "idle") __sink.step(0.2);
      __sink.step(1);
      return { shafts: (CBZ.groundShafts || []).length, state: CBZ.disasters.state() };`);
    if (r.state !== "idle") failures.push(`sinkhole event ${e + 1} never returned the director to idle (${r.state})`);
  }
  survival = await json(`return __sink.survey();`);

  // then WALK TO EVERY ONE. The slot ranking is eye-relative, so a survey from
  // one vantage point proves nothing about the hole on the far side.
  const stands = [];
  for (let i = 0; i < survival.shafts; i++) stands.push(await json(`return __sink.standAt(${i});`));
  /* PHOTOGRAPH A HOLE THAT IS ACTUALLY SLOTTED. Under a deliberately small cap
     most shafts are unslotted and therefore not drawn — correct behaviour, and
     a completely useless record shot, which the next reader would file as a
     regression. Stand at the hole first: that pins it a slot by the same
     ranking the game uses. */
  await evaluate(`(function(){__sink.standAt(0); __sink.frame(0);})()`);
  const survivalShot = await shot("survival-shaft");

  if (boot.mode !== "survival" || !boot.arena) failures.push("survival did not boot");
  const A = survival.audit || {};
  /* A build without these fields cannot be judged on them — say THAT once,
     plainly, instead of letting `undefined !== 0` fire the same complaint from
     twenty places and bury the real ones. */
  const INVARIANTS = ["maskSlots", "ringsOnSolidGround", "playerInUnslotted", "unslottedShafts"];
  const missing = INVARIANTS.filter((k) => A[k] === undefined);
  const graded = missing.length === 0;
  if (!graded) {
    failures.push(`shaftAudit is missing ${missing.join(", ")} — this build predates the ground-mask invariants, so the ring-on-solid-ground family cannot be measured at all`);
  }
  if (graded) {
    if (boot.slots !== MASK_SLOTS_UNDER_TEST) {
      failures.push(`the cfg_GROUND_MASK_SLOTS override did not take (asked ${MASK_SLOTS_UNDER_TEST}, got ${boot.slots}) — the cap is untested`);
    }
    if (!(survival.shafts > boot.slots)) {
      failures.push(`only ${survival.shafts} shafts opened against ${boot.slots} slots — the check never exceeded the cap it exists to test`);
    }
    if (A.ringsOnSolidGround !== 0) failures.push(`shaftAudit.ringsOnSolidGround = ${A.ringsOnSolidGround} (a shaft drawn over ground that still is)`);
    if (A.playerInUnslotted !== 0) failures.push(`shaftAudit.playerInUnslotted = ${A.playerInUnslotted}`);
  }
  if (A.holesOnSlopes !== 0) failures.push(`shaftAudit.holesOnSlopes = ${A.holesOnSlopes} (a sinkhole on a mountainside)`);
  if (A.privateHoles !== 0) failures.push(`shaftAudit.privateHoles = ${A.privateHoles}`);
  if (!(A.deepOverWide >= 2)) failures.push(`shaftAudit.deepOverWide = ${A.deepOverWide} (a crater, not a shaft)`);
  if (A.cityFloorWrapped !== true) failures.push("the floor was never wrapped — the stair is drawn and not walkable");
  for (const h of survival.holes) {
    if (h.lidUnmasked !== 0) failures.push(`survival hole ${h.i}: ${h.lidUnmasked}/${h.lidTotal} ground surfaces over the mouth still drawing (${h.lidNames.join(", ")})`);
    if (!(h.floorDrop > h.depth * 0.4)) failures.push(`survival hole ${h.i}: floorAt only drops ${h.floorDrop} m into a ${h.depth} m shaft`);
  }
  for (const s of stands) {
    if (!s) continue;
    if (!s.drawn) failures.push(`standing at hole ${s.i}, that hole is not drawn (unslotted ${s.unslotted})`);
    if (s.lidUnmasked !== 0) failures.push(`standing at hole ${s.i}, ${s.lidUnmasked} surfaces over the mouth still drawing`);
    if (graded && s.rings !== 0) failures.push(`standing at hole ${s.i}, ringsOnSolidGround = ${s.rings}`);
    if (graded && s.playerInUnslotted !== 0) failures.push(`standing at hole ${s.i}, the player is inside an undrawn shaft`);
  }

  // ---- THE CITY: the same primitive, the other root ------------------------
  // root() is the whole scene here, which is what bug (2) turned on. The event
  // is off by default; this opens the door it is meant to be run through.
  const city = await json(`
    CBZ.setMode("city"); CBZ.resetGame(); CBZ.setState("playing");
    window.requestAnimationFrame = function () { return 0; };
    __sink.step(4);
    CBZ.CONFIG.CITY_SINKHOLES = true;
    var seq = CBZ.cityOpenSinkhole({ r: 11, minDist: 30, maxDist: 180, warnSecs: 2.0, growSecs: 3.0 });
    if (!seq) return { opened: false };
    __sink.step(16);
    var s = __sink.survey();
    s.opened = true;
    s.junctionSite = !!seq.opts;
    return s;`);
  let cityShot = null;
  if (city.opened) { await evaluate(`(function(){__sink.frame(0, 78);})()`); cityShot = await shot("city-shaft"); }

  if (!city.opened) failures.push("CBZ.cityOpenSinkhole found no legal site in the main world");
  else {
    if (!(city.shafts >= 1)) failures.push("no city shaft was cut");
    if (graded && city.audit?.ringsOnSolidGround !== 0) failures.push(`city shaftAudit.ringsOnSolidGround = ${city.audit?.ringsOnSolidGround}`);
    if (city.audit?.holesOnSlopes !== 0) failures.push(`city shaftAudit.holesOnSlopes = ${city.audit?.holesOnSlopes}`);
    for (const h of city.holes) {
      if (h.lidTotal === 0) failures.push(`city hole ${h.i}: no ground surfaces found over the mouth at all — the lid measurement is not looking at anything`);
      if (h.lidUnmasked !== 0) failures.push(`city hole ${h.i}: ${h.lidUnmasked}/${h.lidTotal} ground surfaces over the mouth still drawing (${h.lidNames.join(", ")})`);
      if (!(h.floorDrop > h.depth * 0.4)) failures.push(`city hole ${h.i}: floorAt only drops ${h.floorDrop} m into a ${h.depth} m shaft`);
    }
  }

  /* ---- THE MASK MUST REPAIR ITSELF ---------------------------------------
     Everything above measures the mask as INSTALLED — cut a hole, look at the
     ground, count what is still drawing. That is the state the desktop is
     always in, and it is why the ring the owner photographed on a phone
     survived every check in this file: maskMaterial() stamps the discard onto
     the material OBJECT a mesh is wearing at cut time, and nothing re-checks
     it, so a hole that was correctly masked at second 3 can be wearing a lid
     again at second 20 without a single assertion moving.

     So the fault is INJECTED, in both shapes it can take, and the mask is
     required to come back on its own:
       (a) ground that arrives over an open mouth — a batch merge, an LOD swap
       (b) a mesh whose material is replaced by a different object, which is
           exactly what core/gfx.js's Lambert/Standard twin swap does when the
           quality tier moves (and a phone moves tiers; a desktop does not)
     Neither is hypothetical: (b) is a live code path in core/gfx.js today. */
  /* GROUND THAT ARRIVES LATE, AND GROUND THAT CHANGES ITS CLOTHES.
     These two used to need maintenance — a round-robin re-sweep for meshes
     built after a hole was cut, and a per-frame healer for materials swapped by
     a quality-tier change (core/gfx.js's swapTree, which un-masked holes on the
     owner's phone and never on a fixed-tier desktop). Under the chunk mask both
     are true THE INSTANT THEY EXIST, because the discard is in every fogged
     shader by construction. So this phase asserts the stronger claim: NO TIME
     PASSES. If either of these ever needs a tick to become true again, the mask
     has quietly gone back to being a search. */
  const heal = await json(`
    var S = CBZ.groundShafts || []; var h = S[0];
    if (!h) return { skipped: 1 };
    var root = window.__sink.root();
    var before = window.__sink.lidOver(h).total;
    var g = new THREE.Mesh(new THREE.PlaneGeometry(h.mouth * 2.2, h.mouth * 2.2),
                           new THREE.MeshLambertMaterial({ color: 0x53a84e }));
    g.rotation.x = -Math.PI / 2; g.position.set(h.x, h.gy + 0.02, h.z);
    root.add(g);
    g.updateMatrixWorld(true);
    var after = window.__sink.lidOver(h);
    var sawIt = after.total > before;          // the probe is actually looking at it
    var lidNew = after.unmasked;               // must be 0 with NO step
    g.parent && g.parent.remove(g);

    // a material swapped out from under the hole — the phone bug
    var victim = null, vbox = new THREE.Box3();
    root.traverse(function (o) {
      if (victim || !o.isMesh || !o.geometry || !o.material || Array.isArray(o.material)) return;
      if (o === g || !window.__sink.masked(o.material)) return;
      for (var p = o; p; p = p.parent) if (p.userData && p.userData.groundShaft) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      vbox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (vbox.max.y - vbox.min.y > 3) return;
      if (vbox.max.y < h.gy - 3 || vbox.min.y > h.gy + 0.35) return;
      if (vbox.max.x < h.x - h.mouth || vbox.min.x > h.x + h.mouth) return;
      if (vbox.max.z < h.z - h.mouth || vbox.min.z > h.z + h.mouth) return;
      victim = o;
    });
    var swappedStillMasked = null;
    if (victim) {
      victim.material = victim.material.clone();      // exactly what swapTree does
      swappedStillMasked = window.__sink.masked(victim.material);
    }

    // and the hole's OWN liner must be exempt, or the walls of every shaft vanish
    var liners = 0, linersExempt = 0;
    (h.grp ? h.grp : { traverse: function () {} }).traverse(function (o) {
      if (!o.isMesh || !o.material || Array.isArray(o.material)) return;
      liners++;
      if (o.material.defines && o.material.defines.CBZ_NOMASK) linersExempt++;
    });

    return { sawIt: sawIt, lidNew: lidNew, victim: victim ? (victim.name || victim.type) : null,
             swappedStillMasked: swappedStillMasked, liners: liners, linersExempt: linersExempt,
             maskAudit: CBZ.groundMaskAudit ? CBZ.groundMaskAudit() : null };`);

  if (heal.skipped) {
    failures.push("the late-ground phase found no shaft to injure — it proved nothing");
  } else {
    if (!heal.sawIt) failures.push("the late-ground phase injected a mesh the lid probe cannot even see — it is not testing what it claims to");
    if (heal.lidNew !== 0) failures.push(`ground added over an open mouth was NOT masked on arrival (${heal.lidNew} unmasked, with no tick) — the mask is a search again`);
    if (heal.victim == null) failures.push("the late-ground phase found no masked ground mesh over the mouth to injure — it is not testing what it claims to");
    if (heal.victim != null && heal.swappedStillMasked !== true) failures.push(`a ground material swapped out from under the hole lost the mask (${heal.victim})`);
    if (!(heal.liners > 0)) failures.push("the shaft has no liner meshes to check — the exemption test proved nothing");
    if (heal.liners > 0 && heal.linersExempt === 0) failures.push("the shaft's own liner is NOT exempt from the mask — its walls and lip will be discarded with the ground");
    if (heal.maskAudit && heal.maskAudit.installed !== true) failures.push(`core/groundmask.js did not install: ${heal.maskAudit.why}`);
    if (heal.maskAudit && heal.maskAudit.sweptMeshes !== 0) failures.push("the mask is sweeping meshes again");
  }

  if (browserErrors.length) failures.push(`browser errors: ${browserErrors.slice(0, 4).join(" | ")}`);

  const report = {
    browser: chromePath,
    survival: {
      shafts: survival.shafts, slots: boot.slots, audit: survival.audit,
      lidWorst: survival.worst && { hole: survival.worst.i, total: survival.worst.lidTotal, unmasked: survival.worst.lidUnmasked },
      stands,
    },
    city: city.opened ? {
      shafts: city.shafts, audit: city.audit,
      lid: city.holes.map((h) => ({ hole: h.i, total: h.lidTotal, unmasked: h.lidUnmasked, floorDrop: h.floorDrop })),
    } : { opened: false },
    selfHeal: heal,
    shots: [survivalShot, cityShot].filter(Boolean),
    browserErrors,
    failures,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) {
    console.error(`\nSINKHOLE CHECK FAILED (${failures.length}):`);
    for (const f of failures) console.error("  - " + f);
    process.exitCode = 2;
  } else {
    console.error(`\nSINKHOLE CHECK PASSED — ${survival.shafts} survival shafts against ${boot.slots} mask slots, ` +
      `every mouth's ground discarded, city shaft cut and masked.`);
  }
} finally {
  try { if (ws) ws.close(); } catch (_) {}
  try { chrome.kill("SIGTERM"); } catch (_) {}
  try { server.kill("SIGTERM"); } catch (_) {}
  await sleep(250);
  await rm(profile, { recursive: true, force: true });
}
