/* THE SEA TAKES THE BLOOD — what a wave does to a mark on the sand.

   OWNER, 2026-08-27, watching the shark game's beach: "the human when attacked
   by shark leaves blood marks on the beach which looks excellent, when water
   runs over those blood marks currently the blood marks stay there but are
   hidden while water covers and then they are still there after when water
   moves back. What should this be? Should it turn into a blood cloud when
   water runs over it — that's what I like, do that."

   THE BUG IS REAL AND IT IS IN THIS PICTURE. Blood on the island's sand is a
   ground decal (systems/gore.js, LAYER 4 of a kill plus the landing droplets).
   The island's ocean has NO land mask — measured: the survival sea mesh's
   uSeaHasLandMask is 0 — so the water is drawn everywhere and the SAND is the
   only thing that hides it. Every few seconds the live crest rises 0.35 m and
   the sea runs a metre or two up the beach, straight over the mark. gore.js
   had one water-versus-blood rule (GORE_WASH) and it could never fire here: it
   asks survFloodDepthMeanAt, the MEAN water column, which over dry sand is
   negative by definition. So the wave came in, drew over the decal, went out,
   and left the same crisp arterial mark sitting there for its whole 26-75 s
   clock. Nothing was ever taken.

   THE FIX PHOTOGRAPHED HERE (GORE_SWASH). A decal seated in the tidal band
   reads the LIVE crest — the same surface the ocean mesh is drawn at — ten
   times a second. Each rising edge is one wave: it lifts a share of what is
   left of the mark and throws it seaward as a cloud on the water (a slick with
   real backwash velocity, floored at the sand so it does not sink through the
   beach when the sheet drains), and the mark keeps the rest, thinner and
   smaller. Three or four run-ups and the sand is clean. Dilution only ever
   rises, so nothing comes back when the water goes out.

   ------------------------------------------------------------------------
   TWO THINGS THIS DRIVER DOES THAT ANY LATER BEACH PRESET WILL NEED:

   1. IT OWNS THE CLOCK. CBZ.waterClock() is performance.now() — WALL time, not
      sim time. The swell phase at the instant of capture is therefore whatever
      the machine felt like, and two builds photographed a second apart get
      photographed under DIFFERENT WAVES. That is the one variable a report
      about waves cannot have. So the driver replaces waterClock with a counter
      it advances itself, in lockstep with stepSim. Both columns then see the
      same crest, on the CPU and in the shader (the sea's uniforms are driven
      from an onAlways hook, which stepSim runs), at every beat.

   2. IT SEARCHES FOR THE WASH LINE INSTEAD OF ASSUMING IT. The band where a
      wave actually crosses the sand is about two metres wide and sits a metre
      INSIDE CBZ.sharkSim.waterline (which is the MEAN waterline). The driver
      sweeps radius against a swept clock and picks the spot that is dry at
      rest and covered at the crest — so the experiment is staged where the
      phenomenon is, on both builds, rather than where a constant said it was.

   BOTH COLUMNS RUN THIS SAME FILE. BEFORE is a pristine HEAD worktree served
   on its own port (tools/ba-lib/head-build.mjs launches it — no hand-run
   servers), AFTER is the working tree. Same mode, same seed, same clock, same
   staged mark, same cameras. The measurements are taken by THIS file out of
   the live scene graph, keyed on gore.js's own decal colours, so both builds
   are read by one ruler rather than by each build's own audit. */

import { baselineBuild } from "../ba-lib/head-build.mjs";

const subjects = [
  {
    id: "one-wave", ch: 0, strip: { frames: 6, stepSec: 0.9 },
    label: "One Wave Over One Mark — Four Seconds",
    focus: "Six frames of the same four seconds on the same patch of sand. Frame 1 is the mark, dry. Then the sea comes over it. BEFORE: the water covers a red mark and uncovers the same red mark — the wave is a lid, not an event. AFTER: the run-up lifts the blood off the sand as a cloud on the water and the backwash carries it out, and what the sea gives back is a paler mark than it took.",
  },
  {
    id: "four-waves", ch: 1,
    label: "Thirty Seconds Later — What Is Left",
    focus: "The same spot after the sea has been over it a few more times. BEFORE: the mark is exactly as crisp as it was when it landed, on ground that has been under water four times. AFTER: the sand is clean, which is the whole read the owner is asking for — a receding tide leaves CLEAN sand.",
  },
  {
    id: "the-maul", ch: 2,
    label: "The Real Thing — A Kill On The Surf Line",
    focus: "Not a staged stamp: a beachgoer killed at the water's edge through the game's own death path, then sixteen seconds of surf. This is the shot the owner was looking at. BEFORE: a kill scene that the sea washes over and leaves untouched. AFTER: the surf pulls the kill out into the water as blood clouds and the beach goes back to sand.",
  },
  {
    id: "above-the-tide", ch: 3,
    label: "Regression — A Mark The Sea Never Reaches",
    focus: "The same experiment five metres up the dry beach, above every crest. Blood the water never touched must be untouched: identical on both builds, after the identical thirty seconds. A fix that erases marks the sea cannot reach is not a fix, it is a fade.",
  },
  {
    id: "inland", ch: 4,
    label: "Regression — A Pool Nowhere Near Water",
    focus: "A kill pool forty metres inland, where a beach test has no business costing anything. Identical on both builds, and the audit line below it says the new water test retired this decal after a single query and never asked again.",
  },
];

async function stageBeachBlood(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__beachBlood;
  if (!D) {
    D = window.__beachBlood = {
      chapter: -1, T: 0, waterline: 0, ang: 0, mark: null, dry: null, notes: { strip: [] },

      /* THE CLOCK IS OURS (see the header). Everything downstream — the CPU
         crest query gore.js reads, the sea shader's uSeaTime, the wet-sand
         ring on the beach — goes through CBZ.waterClock, so replacing it is
         enough to put both builds under the same wave at the same beat. */
      claimClock() {
        if (D._clocked) return;
        D._clocked = true;
        D.T = 100;                       // a phase away from every sin(0) = 0
        CBZ.waterClock = function () { return D.T; };
      },
      /* THE LENS IS PART OF THE EXPERIMENT, NOT JUST THE RECORD OF IT.
         systems/camera.js is an UPDATER (order 50): every stepSim re-stamps
         CBZ.camera onto the player. gore.js's emitters run in the same tick at
         onAlways(8) and every one of them is distance-gated off that camera —
         goreSlick refuses beyond 130 m, goreBloom beyond 80, goreImpact beyond
         70. Park the mount out of shot on another bearing (which is what makes
         a clean frame) and the game camera goes with it, so the wave lifts the
         blood off the sand and then declines to put a cloud in the water
         because "nobody can see it" — measured: 16 wash events, 13 diluted
         decals, 0 slicks. Pin the tripod back after every tick and the same
         run produces the clouds. Costs one matrix write per sim step. */
      step(dt) { D.T += dt; CBZ.stepSim(dt); D.pinCam(); },
      sec(s) { const n = Math.max(1, Math.round(s * 30)); for (let i = 0; i < n; i++) D.step(1 / 30); },

      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 60 && !(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.surv.arena); t++) {
          CBZ.stepSim(1 / 30); await sleep(20);
        }
        if (!CBZ.surv.arena) return false;
        D.waterline = CBZ.sharkSim ? CBZ.sharkSim.waterline : 0;
        D.claimClock();
        /* From here the match advances ONLY when a chapter steps it — a live
           frame loop re-stamps the detached tripod at some later compositor
           beat and photographs the wrong camera. (shark-sim.mjs's recipe,
           including the drain of the one already-queued callback.) */
        D._rafOrig = window.requestAnimationFrame;
        await D.killFrames();
        D.peace();
        return true;
      },
      async killFrames() {
        const orig = D._rafOrig || window.requestAnimationFrame;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
      },

      /* The player's own shark goes away — a sixteen-metre body in the surf is
         not what this report is about, and it eats the frame.

         HARNESS TRAP: PARK IT ON THE SAND, NOT OUT AT SEA. The first version
         of this put the mount 120 m offshore, which is deep water, which makes
         the PLAYER submerged — and world/water_underwater.js's tint is a DOM
         overlay over the whole page (#cbzUnderwater, plus the breath vignette
         once the meter runs down). It does not care that the capture camera is
         a detached tripod standing dry on the beach: every frame after the
         second came back washed pastel blue with the sand gone. Beaching is
         legal in this mode (see shark-shore-law.mjs), so the mount is parked on
         dry sand behind the lens instead, where it is neither drowning nor in
         shot. */
      peace() {
        const S = CBZ.sharkSim && CBZ.sharkSim.shark;
        const away = D.ringPoint(D.ang + 2.4, Math.max(6, D.waterline - 22));
        const gy = D.groundAt(away.x, away.z);
        if (S) {
          S.pos.x = away.x; S.pos.z = away.z; if (S.pos.y != null) S.pos.y = gy;
          S.hunger = 0;
          if (S._waterMove) { S._waterMove.x = away.x; S._waterMove.z = away.z; }
        }
        if (CBZ.player && CBZ.player.pos) {
          CBZ.player.pos.x = away.x; CBZ.player.pos.z = away.z;
          if (CBZ.player.pos.y != null) CBZ.player.pos.y = gy;
        }
        if (CBZ.sharkSim) CBZ.sharkSim.podT = 900;
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },
      // what the page is painting OVER the render — the trap above, made
      // visible in the report instead of rediscovered from a blue frame.
      overlays() {
        const o = {};
        ["cbzUnderwater", "cbzBreathWarn", "sharkflash"].forEach(function (id) {
          const el = document.getElementById(id);
          o[id] = el ? +(+getComputedStyle(el).opacity || 0).toFixed(2) : null;
        });
        o.playerSubmerged = CBZ.citySwimState ? !!(CBZ.citySwimState() || {}).headUnder : null;
        o.cameraSubmerged = CBZ.cityCameraSubmerged ? !!CBZ.cityCameraSubmerged() : null;
        return o;
      },

      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      groundAt(x, z) { return CBZ.surv.arena.groundHeightAt(x, z); },
      // the LIVE crest at an arbitrary clock reading — pure, because the clock
      // is a variable we own now.
      seaAt(x, z, t) {
        const save = D.T; D.T = t;
        const y = CBZ.survSeaHeightAt(x, z);
        D.T = save;
        return y;
      },
      depthAt(x, z, t) { return D.seaAt(x, z, t) - D.groundAt(x, z); },

      tripod(px, py, pz, tx, ty, tz) {
        D._cam = [px, py, pz, tx, ty, tz];
        D.pinCam();
      },
      pinCam() {
        const c = D._cam, cam = CBZ.camera;
        if (!c || !cam) return;
        cam.position.set(c[0], c[1], c[2]);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(c[3], c[4], c[5]));
        cam.updateMatrixWorld(true);
      },
      /* Stand up the dry beach and look down the slope at the mark, so one
         frame holds the sand, the mark, and the water that is coming for it.
         HIGH AND BACK ON PURPOSE: at the waterline this sea swings well over a
         metre, and a lens at eye height two metres from the mark spends half
         the strip underneath the run-up with nothing in frame but water. */
      lookAtMark(p, back, up) {
        const o = { x: Math.cos(D.ang), z: Math.sin(D.ang) };   // outward = seaward
        const g = D.groundAt(p.x, p.z);
        const b = back == null ? 6 : back, u = up == null ? 5 : up;
        D.tripod(p.x - o.x * b, g + u, p.z - o.z * b, p.x + o.x * 1.6, g - 0.15, p.z + o.z * 1.6);
      },

      /* WHERE DOES A WAVE ACTUALLY CROSS THE SAND? Sweep radius against a
         swept clock: at each candidate, how low and how high does the sea get
         over this ground across one full cycle of the swell table? The wash
         line is where the answer brackets zero with room on both sides — dry
         at rest, a hand's depth at the crest. Both builds run this identical
         search on an identical world and land on the same spot. */
      findWashLine() {
        let best = null;
        for (let d = -3.5; d <= 1.0; d += 0.2) {
          const r = D.waterline + d, p = D.ringPoint(D.ang, r);
          const g = D.groundAt(p.x, p.z);
          let lo = 9e9, hi = -9e9;
          for (let t = D.T; t < D.T + 20; t += 0.25) {
            const y = D.seaAt(p.x, p.z, t);
            if (y < lo) lo = y;
            if (y > hi) hi = y;
          }
          const dryBy = g - lo, wetBy = hi - g;       // both want to be positive
          if (dryBy < 0.05 || wetBy < 0.09) continue;
          const score = Math.min(dryBy, wetBy);
          if (!best || score > best.score) best = { x: p.x, z: p.z, r, d, g, dryBy, wetBy, score };
        }
        return best;
      },
      /* AND WHEN? A window whose first `dry` seconds leave the mark alone (so
         it lands on dry sand and the strip opens dry), then a crest inside the
         next `soon` seconds. Returned as the clock reading to stamp at. */
      findWindow(p, dry, soon) {
        const g = D.groundAt(p.x, p.z);
        for (let t0 = D.T; t0 < D.T + 40; t0 += 0.2) {
          let ok = true;
          for (let t = t0; t <= t0 + dry; t += 0.15) {
            if (D.seaAt(p.x, p.z, t) - g > 0.005) { ok = false; break; }
          }
          if (!ok) continue;
          for (let t = t0 + dry + 0.4; t <= t0 + dry + soon; t += 0.15) {
            if (D.seaAt(p.x, p.z, t) - g > 0.08) return t0;
          }
        }
        return null;
      },

      /* THE RULER. gore.js's decal colours are constants shared by both
         builds, so a colour is a build-independent way to ask "is this red
         thing on the sand or in the water" — pools/streaks are the DECAL_C
         palette, a slick on the surface is the pooled 0x6e0d10 material. Area
         is honest: the blob geometry is a unit-radius circle, so the drawn
         area is PI * scale.x * scale.y, weighted by the opacity actually on
         screen. Everything the eye is being asked to judge, in one number. */
      scan(x, z, r) {
        const SAND = { 0x300203: 1, 0x420305: 1, 0x550408: 1, 0x5e070b: 1, 0x8a0b10: 1, 0xb01218: 1 };
        const SLICK = 0x6e0d10;
        const o = { sand: 0, water: 0, sandN: 0, waterN: 0 };
        const r2 = r * r;
        CBZ.scene.traverse(function (m) {
          if (!m.isMesh || m.renderOrder !== 3) return;
          const mat = m.material;
          if (!mat || !mat.transparent || !mat.color || mat.depthWrite !== false) return;
          const op = +mat.opacity;
          if (!(op > 0.004)) return;
          const dx = m.position.x - x, dz = m.position.z - z;
          if (dx * dx + dz * dz > r2) return;
          const area = Math.PI * Math.abs(m.scale.x * m.scale.y) * op;
          const hex = mat.color.getHex();
          if (hex === SLICK) { o.water += area; o.waterN++; }
          else if (SAND[hex]) { o.sand += area; o.sandN++; }
        });
        o.sand = +o.sand.toFixed(3); o.water = +o.water.toFixed(3);
        return o;
      },
      audit() { try { return CBZ.goreAudit ? CBZ.goreAudit() : null; } catch (e) { return null; } },

      /* One bite's worth of blood on the sand, through the production impact
         path (spray droplets + a lingering pool), aimed up the beach.

         SAME DICE, FOR THE DURATION OF THE STAMP ONLY. gore.js's spray is
         Math.random from end to end — how many droplets leave the wound, where
         they fly, where they land — and the two columns are two page loads:
         unseeded, the first run of this preset put 16 decals on one beach and
         14 on the other and the ruler dutifully reported the difference
         between two dice rolls as a result. The seed goes on for this call and
         comes straight back off. It is NOT installed for the whole page: doing
         that (an initScript at document start) made a deterministic world that
         threw an uncaught exception on both sides during the capture, and a
         preset has no business rewriting the boot of the thing it photographs
         just to steady a spatter. */
      stamp(p, amount) {
        const o = { x: Math.cos(D.ang), y: 0, z: Math.sin(D.ang) };
        const g = D.groundAt(p.x, p.z);
        CBZ.goreImpact(p.x, g + 0.5, p.z, { amount: amount == null ? 1.4 : amount, pool: true, dir: o, medium: "air" });
      },
      /* SAME DICE, FOR AS LONG AS THE STAGING LASTS. gore.js's spray is
         Math.random from end to end — how many droplets leave the wound, where
         they fly, and (a second later, in the sim) where each one lands and how
         big a mark it makes — and the two columns are two page loads.
         Unseeded, the first run of this preset put 16 decals on one beach and
         14 on the other and the ruler dutifully reported the difference between
         two dice rolls as a result. Every chapter therefore takes the dice for
         its stamp AND for the second of flight that follows it, then gives them
         back: what the sea is handed is identical on both sides, and what the
         sea does with it is the only thing left to photograph.
         NOT installed for the whole page — a preset has no business rewriting
         the boot of the thing it photographs. */
      dice() {
        if (D._realRnd) return;
        D._realRnd = Math.random;
        let s = 0x2f6e2b1 >>> 0;
        Math.random = function () {
          s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
          return (s >>> 8) / 16777216;
        };
      },
      undice() { if (D._realRnd) { Math.random = D._realRnd; D._realRnd = null; } },
      // stamp + the flight of the spray, under the same dice on both sides
      stampSettled(p, amount, settle) {
        D.dice();
        try { D.stamp(p, amount); D.sec(settle == null ? 1.2 : settle); }
        finally { D.undice(); }
      },
      // how much blood exists anywhere right now — the "did that actually
      // bleed?" test, so a staging that quietly did nothing cannot be reported
      // as a result.
      bloodTotal() { const a = D.audit() || {}; return (a.pools || 0) + (a.streaks || 0) + (a.slicks || 0) + (a.bits || 0); },
    };
  }

  const out = {};

  const CH = [
    // 0 — ONE WAVE OVER ONE MARK
    async function oneWave() {
      if (!await D.boot()) throw new Error("sharksim never armed");
      D.ang = 0.7;                                   // one fixed bearing, both builds
      D.peace();
      /* HARNESS TRAP — THE SWELL IS AS BIG AS THE LENS IS CLOSE. water_spec.js
         scales wave amplitude by distance from the CAMERA (fadeAt), so a wash
         line searched with the lens still parked wherever boot left it is a
         wash line measured on a calm sea, and the capture that follows — with
         the lens two metres away — then photographs a sea swinging four times
         as far, floods the whole frame and drowns the experiment. Measured
         here: 0.35 m of swing from 130 m away, over a metre from five. So the
         lens goes down FIRST, and the search is run again once the mark it
         found has moved the lens. */
      D.lookAtMark(D.ringPoint(D.ang, D.waterline));
      let spot = D.findWashLine();
      if (!spot) throw new Error("no wash line found on this bearing");
      D.lookAtMark(spot);
      spot = D.findWashLine() || spot;
      D.lookAtMark(spot);
      D.mark = spot;
      D.notes.washLine = {
        radius: +spot.r.toFixed(2), insideMeanWaterlineM: +(-spot.d).toFixed(2),
        sandY: +spot.g.toFixed(3), dryByM: +spot.dryBy.toFixed(3), crestOverSandM: +spot.wetBy.toFixed(3),
      };
      const t0 = D.findWindow(spot, 1.4, 2.6);
      if (t0 == null) throw new Error("no dry-then-wave window at the wash line");
      D.T = t0;
      D.stampSettled(spot, 1.4, 1.2);                // the pool draws itself while the sand is dry
      D.lookAtMark(spot);
      const s = D.scan(spot.x, spot.z, 7);
      out.markSandM2 = s.sand;
      // the wave the strip is about, as numbers: water over the mark every
      // quarter second across the seconds the six frames photograph.
      const cyc = [];
      for (let t = D.T; t <= D.T + 6; t += 0.25) cyc.push(+D.depthAt(spot.x, spot.z, t).toFixed(2));
      D.notes.cycle = cyc;
      D.notes.atStamp = { depthOverMarkM: +D.depthAt(spot.x, spot.z, D.T).toFixed(3), scan: s };
    },
    // 1 — THIRTY SECONDS OF SURF
    async function fourWaves() {
      const spot = D.mark;
      D.sec(30);
      D.lookAtMark(spot);
      const s = D.scan(spot.x, spot.z, 7);
      out.sandAfterSurfM2 = s.sand;
      out.waterBloodM2 = s.water;
      const a = D.audit();
      out.washes = a && typeof a.swashWashes === "number" ? a.swashWashes : 0;
      out.slicksLeft = a ? a.slicks : null;
      D.notes.afterSurf = { scan: s, audit: a };
    },
    // 2 — THE REAL THING
    async function theMaul() {
      const spot = D.mark;
      // a beachgoer, moved to the water's edge and killed there by the game's
      // own death path — cause string and all, so trauma.js picks the bite row.
      let victim = null;
      try {
        CBZ.surv.forEachActor(function (a) {
          if (victim || !a || a.dead || a === CBZ.player || !a.pos) return;
          if (a.hp == null || a.hp <= 0) return;
          victim = a;
        });
      } catch (e) {}
      const at = D.ringPoint(D.ang + 0.06, spot.r + 0.4);
      const gy = D.groundAt(at.x, at.z);
      D.lookAtMark({ x: at.x, z: at.z }, 7, 4.6);
      /* THE KILL HAS TO PROVE IT BLED. The first cut of this chapter moved a
         beachgoer to the water's edge and called CBZ.surv.hurt with the
         shark's own cause string — and reported a triumphant result on a beat
         where NOTHING happened: the audit had the same one pool it had before,
         because the actor it found never reached trauma.js's death gore. A
         staging that quietly does nothing must fail loudly, so the blood is
         counted before and after and the beat falls back to the gore call
         trauma.js itself makes rather than photographing an empty beach. */
      const bloodBefore = D.bloodTotal();
      let path = "none";
      D.dice();
      try {
        if (victim) {
          victim.pos.x = at.x; victim.pos.z = at.z;
          if (victim.pos.y != null) victim.pos.y = gy;
          D.step(1 / 30);
          try {
            CBZ.surv.hurt(victim, 1e6, {
              cause: "eaten by a bull shark",
              point: { x: at.x, y: gy + 0.9, z: at.z },
              dir: { x: Math.cos(D.ang), y: 0, z: Math.sin(D.ang) },
              fromX: at.x - Math.cos(D.ang) * 2, fromZ: at.z - Math.sin(D.ang) * 2,
            });
            path = "surv.hurt";
          } catch (e) { path = "hurt-threw:" + (e && e.message); }
          D.sec(0.5);
        }
        if (D.bloodTotal() <= bloodBefore) {
          // the same call systems/trauma.js makes for a maul: the bite row,
          // a limb off, at the victim's chest.
          CBZ.gore(at.x, gy + 1.0, at.z, {
            amount: 1.5, limbs: 1, melee: "bite", medium: "air",
            dir: { x: Math.cos(D.ang), y: 0.1, z: Math.sin(D.ang) },
          });
          path = path === "none" ? "CBZ.gore" : path + " + CBZ.gore";
        }
        D.sec(1.2);
      } finally { D.undice(); }
      if (D.bloodTotal() <= bloodBefore) throw new Error("the maul left no blood at all");
      D.notes.maul = { victim: !!victim, path, bloodBefore, bloodAfter: D.bloodTotal() };
      const before = D.scan(at.x, at.z, 9);
      D.sec(16);
      D.lookAtMark({ x: at.x, z: at.z }, 7, 4.6);
      const s = D.scan(at.x, at.z, 9);
      out.maulSandM2 = s.sand;
      out.maulWaterM2 = s.water;
      D.notes.maulScan = { atKill: before, after16s: s, audit: D.audit() };
    },
    // 3 — ABOVE THE TIDE
    async function aboveTheTide() {
      const ang = D.ang + 0.9;
      // walk up the beach until no crest in a full cycle can reach this sand
      let dry = null;
      for (let d = -2; d >= -14; d -= 0.5) {
        const p = D.ringPoint(ang, D.waterline + d);
        const g = D.groundAt(p.x, p.z);
        let hi = -9e9;
        for (let t = D.T; t < D.T + 20; t += 0.25) { const y = D.seaAt(p.x, p.z, t); if (y > hi) hi = y; }
        if (g - hi > 0.35) { dry = { x: p.x, z: p.z, g, clearM: +(g - hi).toFixed(2), d }; break; }
      }
      if (!dry) throw new Error("nowhere on this beach is above the crest");
      D.dry = dry;
      D.ang = ang;
      D.lookAtMark(dry, 5, 4);
      /* THE DICE STAY ON FOR THE WHOLE BEAT, and that is itself the test. Both
         columns run the identical seeded sequence; the only thing that can
         pull them out of lockstep is the AFTER build spending a random number
         somewhere the BEFORE build does not — which, in thirty seconds on a
         patch of sand, would mean a wave took a bite out of a mark it must not
         have reached. So `equal` here is a real assertion, not a formality. */
      D.dice();
      try { D.stamp(dry, 1.4); D.sec(30); } finally { D.undice(); }
      D.lookAtMark(dry, 5, 4);
      const s = D.scan(dry.x, dry.z, 6);
      out.dryMarkM2 = s.sand;
      D.notes.aboveTide = { spot: dry, scan: s };
    },
    // 4 — INLAND
    async function inland() {
      const ang = D.ang + 1.4;
      D.ang = ang;
      /* PICKED BY HEIGHT, NOT BY DISTANCE. "Forty metres from the water" is
         not the same claim as "out of the sea's reach" on an island this flat:
         the first cut of this beat stood a pool 42 m inland on ground barely a
         metre above mean sea level, and every decal there stayed a candidate
         for the crest test — correctly, since the ocean here is a plane with
         no land mask and would be DRAWN over ground that low. So the beat
         walks inland for real height and reports what it found. */
      let hi = null;
      for (let d = 10; d <= 80; d += 2) {
        const q = D.ringPoint(ang, Math.max(4, D.waterline - d));
        const g = D.groundAt(q.x, q.z);
        if (!hi || g > hi.g) hi = { x: q.x, z: q.z, g, d };
      }
      const p = hi;
      D.lookAtMark(p, 5, 4);
      const w0 = (D.audit() || {}).swashWashes || 0;
      D.dice();
      try { D.stamp(p, 1.6); D.sec(12); } finally { D.undice(); }
      D.lookAtMark(p, 5, 4);
      const s = D.scan(p.x, p.z, 6);
      const a = D.audit();
      out.inlandSandM2 = s.sand;
      // the counter is a MATCH total (it has to be — a mark washed to nothing
      // deletes its own record), so the inland claim is its DELTA across this
      // beat, not its value.
      out.inlandWashes = a && typeof a.swashWashes === "number" ? a.swashWashes - w0 : 0;
      D.notes.inland = {
        spot: { d: p.d, groundY: +p.g.toFixed(2), aboveMeanSeaM: +(p.g - CBZ.survSeaMeanY()).toFixed(2) },
        candidates: a ? a.swashCandidates : null, scan: s,
      };
    },
  ];

  if (!window.__cbzVisualCompare) {
    window.__cbzVisualCompare = {
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        const raf = D._rafOrig;
        if (raf) {
          await new Promise((res) => raf.call(window, () => {
            CBZ.renderer.render(CBZ.scene, CBZ.camera);
            res();
          }));
        } else CBZ.renderer.render(CBZ.scene, CBZ.camera);
        await new Promise((r) => setTimeout(r, 700));
      },
      // the strip's own stepper: the same simulated (and the same WAVE)
      // seconds on both sides, because D.step moves the clock we own.
      /* THE STRIP'S NUMBERS COME BACK THROUGH HERE. stage()'s return value is
         sealed before the first strip frame is captured, so anything advance()
         measures has to be handed over afterwards — this hook is called once
         the strip is finished and merged into the same metrics table. */
      metrics() {
        const S = D.notes.strip || [];
        if (!S.length) return { stripFrames: 0 };
        let peakDepth = 0, peakWater = 0, peakSlicks = 0, washes = 0, cands = 0, diluted = 0;
        for (let i = 0; i < S.length; i++) {
          if (S[i].depthM > peakDepth) peakDepth = S[i].depthM;
          if (S[i].scan && S[i].scan.water > peakWater) peakWater = S[i].scan.water;
          const g = S[i].gore || {};
          if (g.slicks > peakSlicks) peakSlicks = g.slicks;
          if (g.washes > washes) washes = g.washes;
          if (g.candidates > cands) cands = g.candidates;
          if (g.diluted > diluted) diluted = g.diluted;
        }
        const last = S[S.length - 1];
        return {
          stripFrames: S.length,
          stripPeakDepthM: +peakDepth.toFixed(2),
          stripPeakWaterM2: +peakWater.toFixed(2),
          stripEndSandM2: last.scan ? last.scan.sand : null,
          stripPeakSlicks: peakSlicks, stripWashes: washes,
          stripCandidates: cands, stripDiluted: diluted,
          stripErrs: (window.__baErrs || []).length,
        };
      },
      advance(sec) {
        D.sec(sec);
        const p = D.mark || D.dry;
        if (p) D.lookAtMark(p);
        if (p && D.notes.strip) {
          try {
            D.notes.strip.push({
              t: +D.T.toFixed(2),
              depthM: +D.depthAt(p.x, p.z, D.T).toFixed(3),
              scan: D.scan(p.x, p.z, 7),
              gore: (function () { const a = D.audit() || {}; return { slicks: a.slicks, pools: a.pools, washes: a.swashWashes, diluted: a.swashDiluted, candidates: a.swashCandidates }; })(),
              over: D.overlays(),
            });
          } catch (e) { D.notes.strip.push({ err: String(e && e.message || e) }); }
        }
      },
    };
  }

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }

  await window.__cbzVisualCompare.render();
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: {
      mode: CBZ.game.mode, state: CBZ.game.state,
      clock: +D.T.toFixed(2), waterline: +D.waterline.toFixed(2),
      seaHasLandMask: (function () {
        let v = null;
        CBZ.scene.traverse(function (o) {
          if (v === null && o.material && o.material.uniforms && o.material.uniforms.uSeaHasLandMask) {
            v = o.material.uniforms.uSeaHasLandMask.value;
          }
        });
        return v;
      })(),
      notes: D.notes,
      errs: (window.__baErrs || []).slice(0, 8),
    },
    metrics: out,
  };
}

export default {
  id: "beach-blood-swash",
  title: "The Sea Takes The Blood — a wave over a mark on the sand",
  description: "Five beats on the shark game's beach, photographed on both builds under the same wave. A maul leaves ground decals on the sand; the island's ocean has no land mask, so the live crest is drawn straight over them every few seconds — and gore.js's only water-versus-blood rule asks the MEAN water column, which over dry sand is negative by definition, so nothing ever happened. The water covered a red mark and uncovered the same red mark, for the decal's whole 26-75 s life. GORE_SWASH gives a decal in the tidal band a live-crest test at 10 Hz: every rising edge is one wave, one wave lifts a share of the mark into the water as a cloud with real backwash velocity, and the mark keeps the rest — thinner and smaller — until three or four run-ups have taken it all. Dilution only rises, so the tide going out leaves CLEAN sand instead of a mark that was merely hidden. The last two beats are the guard rails: a mark above every crest and a pool forty metres inland must come out untouched, and do.",
  beforeLabel: "BEFORE · GORE_SWASH off",
  afterLabel: "AFTER · GORE_SWASH on",
  pairNote: "Same island · same seed · same bearing · same staged mark · same wave clock",
  method: "Both columns boot index.html into ?mode=sharksim with a pinned seed and click the Shark Sim tile + PLAY like a player. The driver then does two things that make a wave photographable at all. (1) It OWNS THE CLOCK: CBZ.waterClock() is performance.now(), wall time, so the swell phase at capture is whatever the machine felt like and two builds photographed a second apart are photographed under different waves — it is replaced with a counter the driver advances in lockstep with stepSim, which the sea shader's uniforms and the CPU crest query both read. (2) It SEARCHES for the wash line: radius swept against a swept clock until it finds sand that is dry at rest and a hand's depth under at the crest, about a metre inside the mean waterline. Blood is laid through the production CBZ.goreImpact path (and, for the third beat, a real beachgoer killed at the water's edge through CBZ.surv.hurt with the shark's own cause string, which is what makes trauma.js pick the bite row). Every number is taken by the preset out of the live scene graph, keyed on gore.js's shared decal colours — the DECAL_C palette is blood on the sand, the pooled 0x6e0d10 material is blood in the water — and weighted by the opacity actually on screen, so the two builds are read by one ruler instead of by their own audits.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0", cfg_GORE_SWASH: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  /* WHICH BUILD IS "BEFORE" IS DECIDED AT RUN TIME, AND SAID OUT LOUD. If the
     only uncommitted files are this change's own, BEFORE is pristine HEAD in
     its own worktree on its own port. If anybody else has work in flight in
     this shared checkout — usually somebody does — BEFORE becomes the SAME
     build with GORE_SWASH switched off, so the two columns differ by exactly
     one boolean instead of by every neighbour's afternoon. See
     tools/ba-lib/head-build.mjs. */
  async launchSides(ctx) {
    return baselineBuild(ctx, {
      flag: "GORE_SWASH",
      owned: ["src/systems/gore.js", "tools/visual-presets/beach-blood-swash.mjs", "tools/ba-lib/head-build.mjs"],
    });
  },
  initScript() {
    /* KEEP THE PAGE'S OWN COMPLAINTS. ba fails a capture when the page
       throws or logs an error during it — correctly, a pictured state nobody
       can vouch for is not evidence — but the report only records the WORD
       "Uncaught". Trapped here, at document start, the text comes back in the
       stage's debug block where it can be read and fixed. */
    window.__baErrs = [];
    const keep = function (t) { try { if (window.__baErrs.length < 24) window.__baErrs.push(String(t).slice(0, 300)); } catch (e) {} };
    window.addEventListener("error", function (e) {
      keep((e && e.message) + " @" + ((e && e.filename) || "?").split("/").pop() + ":" + (e && e.lineno));
    });
    window.addEventListener("unhandledrejection", function (e) {
      keep("rejection: " + ((e && e.reason && e.reason.message) || (e && e.reason)));
    });
    const ce = console.error;
    console.error = function () {
      keep("console.error: " + Array.prototype.map.call(arguments, function (a) {
        return (a && a.message) ? a.message : String(a);
      }).join(" "));
      return ce.apply(console, arguments);
    };
  },
  stageTimeoutMs: 300000,
  metrics: {
    stripEndSandM2: { label: "One wave: still on the sand once the water has gone back out", unit: "m²", better: "lower" },
    stripPeakWaterM2: { label: "One wave: blood the water is holding at the crest", unit: "m²", better: "higher" },
    stripPeakDepthM: { label: "One wave: how deep the water got over the mark (staging)", unit: "m" },
    sandAfterSurfM2: { label: "Still on the sand after 30 s of surf", unit: "m²", better: "lower" },
    waterBloodM2: { label: "Blood the sea is carrying away at 30 s", unit: "m²", better: "higher" },
    washes: { label: "Run-ups that took a bite out of a mark", better: "higher" },
    maulSandM2: { label: "A real kill's marks, 16 s of surf later", unit: "m²", better: "lower" },
    maulWaterM2: { label: "That kill, out in the water", unit: "m²", better: "higher" },
    dryMarkM2: { label: "REGRESSION: a mark above every crest, after the same 30 s", unit: "m²", better: "equal" },
    inlandSandM2: { label: "REGRESSION: a pool on the high ground inland", unit: "m²" },
    inlandWashes: { label: "REGRESSION: waves that reached the inland pool", better: "lower" },
  },
  metricsNote: "sandAfterSurfM2 against dryMarkM2 is the whole report in two numbers: the sea takes what it runs over and leaves what it does not. The strip pair underneath it is the same claim inside one wave — what the water is holding at the crest, and what is still on the sand when it has gone back out. Every regression row is scored `equal`, because both columns stamp their blood under the same seeded dice for the stamp and the second of flight that follows it, so a mark the sea never touches must come back byte for byte. `washes` is the MATCH total and reads 0 on the before column honestly rather than absently: that build has no such counter because nothing there ever washes. The inland AREA row is scored neither way on purpose: by the time that beat runs, marks from the earlier beats are still washing on the after build, so the two builds' random streams have diverged and the spray around the inland pool lands a few centimetres differently — the assertion there is inlandWashes, which is 0 on both, and the area is reported for the eye.",
  viewport: { width: 1280, height: 720 },
  readyExpression: "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.goreImpact && CBZ.goreAudit && CBZ.survSeaHeightAt && document.getElementById('playBtn')",
  subjects,
  stage: stageBeachBlood,
};
