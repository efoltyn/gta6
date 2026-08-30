#!/usr/bin/env node
/* tools/splash-timing-check.mjs — WHEN DOES THE SEA ANSWER?

   Owner, 2026-08-29: "when i jump out of the water, sometimes the splash
   animation is delayed which is really funny and fucking dumb."

   Every splash in a breach is fired from a SCALAR TEST ON THE BODY ORIGIN —
   city/wildlife_tame.js launches when `W.y >= effTop - 0.12` and lands when
   `W.y <= surf - max(0.18, swimDepth*0.12)`. The origin is the middle of the
   animal. The thing the player watches cross the waterline is the NOSE, and on
   a twenty-metre body flying at fifty degrees the nose is metres ahead of the
   origin in both space and time. So the splash is not "animated late" — it is
   fired off the wrong point on the body, and the size of the error scales with
   the animal, which is exactly why it is "sometimes".

   THIS FILE MEASURES THAT, from outside both blocks and with one ruler:

     • per fixed step, the world BOX of the drawn rig (Box3.setFromObject), so
       "the body touched the water" is the DRAWN body's own extreme, not a
       number either build chose to publish;
     • every CBZ.waterHit / CBZ.waterCrown the arc produces, stamped with the
       step index it fired on and the point it was placed at.

   Reported per size tier:
     exitLagFrames   nose broke the surface on frame A, the exit splash fired
                     on frame B.  B - A.  Negative = the sea answered BEFORE
                     the animal arrived.
     entryLagFrames  same for the re-entry. Positive = the funny one: the
                     shark is already underwater and then the splash pops.
     entryOffsetM    how far the splash was placed from the point the body
                     actually went in.

   Usage: node tools/splash-timing-check.mjs [--tier 1|2|3] [--all]
   Exit 0 always: this is an instrument, not a gate.                        */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const WILD = argv.includes("--wild") || argv.includes("--all");
const TIERS = argv.includes("--all") ? [1, 2, 3]
  : [+((argv[argv.indexOf("--tier") + 1]) || 2) || 2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function claimPort(lo, n, probe) { for (let p = lo; p < lo + n; p++) { try { await probe(p); } catch (_) { return p; } } throw new Error("no port"); }

const port = await claimPort(9450, 150, (p) => fetch(`http://127.0.0.1:${p}/`));
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")], { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
const origin = `http://127.0.0.1:${port}/`;
{ let up = false; for (let i = 0; i < 60 && !up; i++) { try { await fetch(origin); up = true; } catch (_) { await sleep(100); } } if (!up) { console.error("FAIL devserver"); process.exit(1); } }
const dbg = await claimPort(11850, 200, (p) => fetch(`http://127.0.0.1:${p}/json/version`));
const profile = `/tmp/cbz-splashtime-${dbg}`;
await rm(profile, { recursive: true, force: true });
const CHROME_BIN = process.env.CBZ_CHROME || (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/opt/pw-browsers/chromium");
const chrome = spawn(CHROME_BIN, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl",
  "--mute-audio", "--window-size=480,300", `--remote-debugging-port=${dbg}`,
  `--user-data-dir=${profile}`, `${origin}?seed=90210&mode=sharksim`], { stdio: "ignore" });
let page = null;
for (let i = 0; i < 300 && !page; i++) { try { const ps = await (await fetch(`http://127.0.0.1:${dbg}/json/list`)).json(); page = ps.find((p) => p.type === "page" && p.url.startsWith(origin)); } catch (_) {} if (!page) await sleep(100); }
if (!page) { console.error("FAIL no page"); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
let id = 1; const pend = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") errors.push(((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || "").split("\n")[0]);
});
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evl = async (e, ms = 240000) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true, timeout: ms });
  const ed = r.result && r.result.exceptionDetails;
  if (ed) { console.error("EVAL THREW:", (ed.exception && ed.exception.description) || ed.text); return null; }
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable");
for (let i = 0; i < 900; i++) { if (await evl("!!window.CBZ && !!CBZ.stepSim && !!document.getElementById('playBtn')")) break; await sleep(500); }

// ---------------------------------------------------------------- the driver
const DRIVER = `(async () => {
  const CBZ = window.CBZ, T = window.THREE;
  const RUN = 1 / 30;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = { tiers: [], err: null };
  try {
    // ---- boot the mode ---------------------------------------------------
    for (let t = 0; t < 400 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
      const mb = document.querySelector('.mode-btn[data-mode="sharksim"]'); if (mb) mb.click();
      const pb = document.getElementById("playBtn"); if (pb) pb.click();
      await sleep(150);
    }
    const armed = () => !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
      CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
    for (let t = 0; t < 120 && !armed(); t++) { for (let k = 0; k < 12; k++) CBZ.stepSim(RUN); await sleep(20); }
    if (!armed()) { out.err = "never armed"; return out; }
    window.requestAnimationFrame = function () { return 0; };

    const seaY = (x, z) => CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0;
    const col = (x, z) => CBZ.cityWaterDepthAt ? Math.max(0, CBZ.cityWaterDepthAt(x, z)) : 0;
    function deepSpot(minD, ang) {
      const A = CBZ.surv.arena;
      for (let r = A.radius; r < A.radius + 460; r += 4) {
        const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
        if (col(x, z) > minD) return { x: x, z: z, r: r, ang: ang };
      }
      return null;
    }
    function peace() {
      for (const a of CBZ.cityWildlife || []) {
        if (!a || a.dead || !a.species) continue;
        if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
        a.pos.x += 1400; a.hunger = 0;
        if (a.group) a.group.position.x = a.pos.x;
        if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
      }
      if (CBZ.sharkSim) { const S = CBZ.sharkSim.shark; if (S) S.hp = S.maxHp; CBZ.sharkSim.podT = 9000; }
    }
    function climbTo(tier) {
      for (let g = 0; g < 40 && CBZ.sharkSim.tier < tier; g++) {
        const meal = { dead: true, hp: 0, maxHp: 900, pos: { x: 0, y: 0, z: 0 } };
        try { CBZ.sharkSimBite("animal", meal, CBZ.sharkSim.shark); } catch (e) {}
        for (let k = 0; k < 8; k++) CBZ.stepSim(RUN);
      }
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      for (let k = 0; k < 30; k++) CBZ.stepSim(RUN);
      CBZ.hitstop = 0; CBZ.slowmo = 0;
      return CBZ.sharkSim.tier;
    }
    function keys(w, shift, rise, dive) {
      const K = CBZ.keys || (CBZ.keys = {});
      K.w = !!w; K.shift = !!shift; K[" "] = !!rise; K.control = !!dive;
    }

    const box = new T.Box3();
    const TIERS = ${JSON.stringify(TIERS)};
    for (const tier of TIERS) {
      peace();
      const got = climbTo(tier);
      peace();
      const spot = deepSpot(24, 0.7 + tier * 0.4);
      if (!spot) { out.tiers.push({ tier: got, err: "no deep water" }); continue; }
      const heading = spot.ang + Math.PI * 0.5;
      const P = CBZ.player, a = CBZ.cityMountedAnimal();
      P.pos.x = spot.x; P.pos.z = spot.z;
      if (a.pos) { a.pos.x = spot.x; a.pos.z = spot.z; }
      if (a.group) { a.group.position.x = spot.x; a.group.position.z = spot.z; }
      if (a._waterMove) { a._waterMove.x = spot.x; a._waterMove.z = spot.z; }
      if (CBZ.cityMountedHeading) { try { CBZ.cityMountedHeading(heading); } catch (e) {} }
      if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(-Math.cos(heading), -Math.sin(heading)); CBZ.cam.pitch = 0.06; }
      for (let k = 0; k < 6; k++) CBZ.stepSim(RUN);

      // ---- the instruments, installed for exactly this arc ---------------
      const fx = [];
      let frame = -1;          // anything fired before the tape starts
      const origHit = CBZ.waterHit, origCrown = CBZ.waterCrown, origEmit = CBZ.waterEmit;
      let emitN = 0, emitFrames = 0, pageErr = null;
      if (typeof origEmit === "function") CBZ.waterEmit = function () { emitN++; return origEmit.apply(this, arguments); };
      CBZ.waterHit = function (x, y, z, o) {
        try { fx.push({ f: frame, what: "hit", kind: (o && o.kind) || "?", mass: Math.round(+((o && o.mass) || 0)), speed: +(+((o && o.speed) || 0)).toFixed(2), x: x, y: y, z: z }); } catch (e) {}
        return origHit.apply(this, arguments);
      };
      if (typeof origCrown === "function") CBZ.waterCrown = function (o) {
        try { fx.push({ f: frame, what: "crown", h: +(+((o && o.h) || 0)).toFixed(2), x: o && o.x, z: o && o.z }); } catch (e) {}
        return origCrown.apply(this, arguments);
      };

      // ---- the run-up, then the leap -------------------------------------
      keys(true, true, false, false);
      for (let k = 0; k < 60; k++) CBZ.stepSim(RUN);
      keys(true, true, true, false);
      frame = -1;

      const rows = [];
      const g = a.group;
      for (let k = 0; k < 240; k++) {
        emitN = 0;
        try { CBZ.stepSim(RUN); } catch (e) { pageErr = String(e && e.message || e); }
        if (emitN >= 6) emitFrames++;
        frame = rows.length;
        box.setFromObject(g);
        const surf = seaY(g.position.x, g.position.z);
        let air = false; try { air = !!CBZ.aquaticMountAudit().airborne; } catch (e) {}
        // THE ANALYTIC NOSE, for the sign-convention check only: the model the
        // fix is built on (origin + forward * len/2 through the live pitch)
        // has to agree with the DRAWN body's own deepest point on the way in.
        let fwd = 2; try { fwd = (CBZ.marineBodyEnds(a) || {}).fwd || 2; } catch (e) {}
        const pit = g.rotation.z || 0, hd = a.heading || 0;
        const nx = g.position.x + Math.cos(hd) * Math.cos(pit) * fwd;
        const nz = g.position.z + Math.sin(hd) * Math.cos(pit) * fwd;
        const ny = g.position.y + Math.sin(pit) * fwd;
        rows.push({
          i: frame, air: air ? 1 : 0,
          oy: +(g.position.y - surf).toFixed(3),      // ORIGIN above the water
          top: +(box.max.y - surf).toFixed(3),        // highest drawn point
          bot: +(box.min.y - surf).toFixed(3),        // lowest drawn point
          nose: +(ny - seaY(nx, nz)).toFixed(3),      // analytic nose above water
          nx: nx, nz: nz,
          x: g.position.x, z: g.position.z, surf: surf,
        });
        if (rows.length > 30 && !air && rows[rows.length - 2] && !rows[rows.length - 2].air &&
            rows.some((r) => r.air)) {
          // the arc is over and the body has been back in the water 1 frame
          let seen = 0; for (const r of rows) if (r.air) seen++;
          if (seen > 3) break;
        }
      }
      keys(false, false, false, false);
      CBZ.waterHit = origHit; if (typeof origCrown === "function") CBZ.waterCrown = origCrown;
      if (typeof origEmit === "function") CBZ.waterEmit = origEmit;

      // ---- read the tape --------------------------------------------------
      // The DRAWN body leaving the water: the first frame its lowest point is
      // above the surface is "fully out"; the first frame its highest point is
      // above is "breaking through". The splash belongs to the second.
      let noseOut = -1, noseIn = -1, fullyOut = -1, firstAir = -1;
      for (const r of rows) {
        if (firstAir < 0 && r.air) firstAir = r.i;
        if (noseOut < 0 && r.top > 0) noseOut = r.i;
        if (noseOut >= 0 && fullyOut < 0 && r.bot > 0) fullyOut = r.i;
        if (fullyOut >= 0 && noseIn < 0 && r.i > fullyOut && r.bot <= 0) noseIn = r.i;
      }
      const hits = fx.filter((e) => e.what === "hit");
      const exitHit = hits.length ? hits[0] : null;
      const entryHit = hits.length > 1 ? hits[hits.length - 1] : null;
      /* HOW FAR THE SEA'S ANSWER LANDED FROM WHERE THE ANIMAL WENT IN — and
         "where it went in" is the NOSE at the crossing frame, not the origin.
         Measuring against the origin was the right ruler only while the splash
         was fired from the origin; against a long body at fifty degrees the
         nose is legitimately most of a body-length ahead of it, and scoring
         that as error would reward putting the splash back in the middle of
         the animal. */
      let entryOffset = null, entryOffsetFromOrigin = null;
      if (entryHit && noseIn >= 0) {
        const r = rows[noseIn];
        entryOffset = +Math.hypot(entryHit.x - r.nx, entryHit.z - r.nz).toFixed(2);
        entryOffsetFromOrigin = +Math.hypot(entryHit.x - r.x, entryHit.z - r.z).toFixed(2);
      }
      let noseModelIn = -1;
      for (const r of rows) {
        if (fullyOut >= 0 && noseModelIn < 0 && r.i > fullyOut && r.nose <= 0) noseModelIn = r.i;
      }
      let apex = -99, len = 0;
      for (const r of rows) if (r.top > apex) apex = r.top;
      try { len = +(+CBZ.marineBodyLenLive(a)).toFixed(2); } catch (e) {}
      out.tiers.push({
        tier: got, species: a.species && a.species.id, lenM: len,
        frames: rows.length, apexM: +apex.toFixed(2),
        noseOutFrame: noseOut, fullyOutFrame: fullyOut, noseInFrame: noseIn,
        firstAirFrame: firstAir,
        /* THE EXIT IS A WINDOW, NOT AN INSTANT. The drawn box already pokes
           through the surface before a breach (that is what a dorsal fin is),
           so there is no honest single frame to call "the nose came out". What
           IS honest: the sea must answer while the body is on its way out —
           after it leaves, before it is clear. A splash fired outside that is a
           splash with nobody in it. */
        exitInWindow: (exitHit && firstAir >= 0 && fullyOut >= 0)
          ? (exitHit.f >= firstAir - 2 && exitHit.f <= fullyOut) : null,
        noseModelInFrame: noseModelIn,
        modelVsDrawn: (noseModelIn >= 0 && noseIn >= 0) ? noseModelIn - noseIn : null,
        exitHitFrame: exitHit ? exitHit.f : null,
        entryHitFrame: entryHit ? entryHit.f : null,
        exitLagFrames: (exitHit && noseOut >= 0) ? exitHit.f - noseOut : null,
        entryLagFrames: (entryHit && noseIn >= 0) ? entryHit.f - noseIn : null,
        exitLagSec: (exitHit && noseOut >= 0) ? +((exitHit.f - noseOut) * RUN).toFixed(3) : null,
        entryLagSec: (entryHit && noseIn >= 0) ? +((entryHit.f - noseIn) * RUN).toFixed(3) : null,
        emitFrames: emitFrames, stepErr: pageErr,
        entryOffsetM: entryOffset,
        entryOffsetFromOriginM: entryOffsetFromOrigin,
        hits: hits.map((h) => h.f + ":" + h.kind + "/" + h.mass + "kg@" + h.speed),
        crowns: fx.filter((e) => e.what === "crown").map((c) => c.f + ":h" + c.h),
        tape: rows.filter((r) => r.i >= Math.max(0, (noseOut < 0 ? 0 : noseOut) - 3))
                  .slice(0, 60)
                  .map((r) => r.i + (r.air ? "A" : "-") + " o" + r.oy + " t" + r.top + " b" + r.bot + " n" + r.nose),
      });
    }
    /* ---- AND THE WILD PATH ------------------------------------------------
       city/wildlife_shark.js drives its own breaches and now calls the same
       tracker through its own adapter. The ridden chapters above never touch
       that code, and a tracker that throws inside a wild shark's pass would
       take every shark in the sea down with it. So: find a wild one, fire its
       own CBZ.sharkBreachNow, and watch. */
    if (${WILD ? 1 : 0}) {
      const P = CBZ.player;
      let wild = null;
      for (const a of CBZ.cityWildlife || []) {
        if (!a || a.dead || !a.species || !a.species.aquatic) continue;
        if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
        if ((a.species.danger || 0) < 0.5 || a.species.id === "orca") continue;
        wild = a; break;
      }
      if (!wild) { out.wild = { err: "no wild shark in the world" }; }
      else {
        // bring it alongside, in water deep enough to leap out of
        const spot = deepSpot(24, 2.6) || { x: P.pos.x + 40, z: P.pos.z };
        wild.pos.x = spot.x; wild.pos.z = spot.z;
        if (wild.group) { wild.group.position.x = spot.x; wild.group.position.z = spot.z; }
        if (wild._waterMove) { wild._waterMove.x = spot.x; wild._waterMove.z = spot.z; }
        P.pos.x = spot.x + 26; P.pos.z = spot.z;
        for (let k = 0; k < 20; k++) CBZ.stepSim(RUN);
        const hits = [];
        const oh = CBZ.waterHit;
        CBZ.waterHit = function (x, y, z, o) {
          try { hits.push(((o && o.kind) || "?") + "/" + Math.round(+((o && o.mass) || 0)) + "kg"); } catch (e) {}
          return oh.apply(this, arguments);
        };
        let fired = false, err = null;
        try { fired = !!(CBZ.sharkBreachNow && CBZ.sharkBreachNow(wild, "idle")); } catch (e) { err = String(e); }
        for (let k = 0; k < 90; k++) {
          try { CBZ.stepSim(RUN); } catch (e) { if (!err) err = String(e && e.message || e); }
        }
        CBZ.waterHit = oh;
        out.wild = {
          species: wild.species.id, fired: fired, err: err,
          tracked: !!wild._wl, hits: hits.slice(0, 8),
          audit: (typeof CBZ.sharkBreachAudit === "function") ? CBZ.sharkBreachAudit() : null,
        };
      }
    }
  } catch (e) { out.err = String(e && e.stack || e); }
  return out;
})()`;

const res = await evl(DRIVER);
console.log(JSON.stringify(res, null, 2));
if (errors.length) console.error("PAGE ERRORS:", errors.slice(0, 6));
try { ws.close(); } catch (_) {}
chrome.kill(); server.kill();
process.exit(0);
