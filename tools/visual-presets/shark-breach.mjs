/* Shark Sim, before/after — THE JUMP.

   Owner: "animate the beautiful jump out of water by the sharks — and the
   landing, and the splash from the landing."

   Three separate things were wrong and none of them was the absence of a
   feature:

     1. THE RIDDEN BREACH WAS A SKIP, NOT A LEAP. city/wildlife_tame.js's
        launch ran `W.v = Math.max(W.v, R.sprint * 1.04)` — it ADDED forward
        speed at the exact moment the animal is supposed to be spending it on
        climb — and then the forward accelerator kept running for the whole
        1.2 s the body was in the air, because nothing in that block ever asked
        whether there was any water left to push against. A great white left
        the sea at 10.6 m/s up and 16.2 m/s along, a 33-degree flight path, and
        by the entry frame it was back at full sprint and down to 28 degrees.
        The apex was measured from the LAUNCH, not from the sea, so the bigger
        the animal the more of its authored air it spent just getting to the
        surface: MEASURED, a fully grown megalodon clamped 3.4 m under its own
        surface got 1.84 m of air out of an authored 5.84. And the body did not
        roll at all, because the
        turn-roll line below the arc overwrote the arc's roll every frame.

     2. THE MEGALODON SPLASHED LIKE A SWIMMER. Every breach in this game went
        through the legacy CBZ.waterSplashAt, whose contract clamps its
        strength dial to 2.5 and then reports the impact bus a SEVENTY-EIGHT
        KILOGRAM body. So a bull shark, a great white and a sixteen-metre
        megalodon re-entered the sea as the same 78 kg diver at the same
        clamped 16.6 m/s, and the "make it bigger" number the callers were turning
        had been saturated for years. This preset measures that by WRAPPING
        CBZ.waterHit for the duration of the arc and reading what the sea was
        actually told — the same instrument on both builds.

     3. WILD SHARKS COULD NOT LEAVE THE WATER AT ALL. city/wildlife_shark.js's
        depth() has two clamps and the first ("keep the torso under") was
        unconditional, so every wild shark in the game had a hard ceiling 0.92
        of its own draft below the waterline, forever. The single most
        photographed thing a great white does was not expressible.

   BOTH COLUMNS RUN THIS SAME DRIVER. BEFORE is pristine wave-start HEAD served
   on its own port; AFTER is the working tree. Same island, same seed, same
   ladder climb through the mode's own CBZ.sharkSimBite, the same production
   keys held for the same number of fixed steps, and the same cameras. Every
   number at the bottom is read by THIS file — off the live scene graph, off a
   wrapper this file installs, or off the droplet pool's own free count — so
   both columns are measured by one ruler rather than by each build's own audit.

   HARNESS TRAP (git show ff27038): in this engine several emitters distance-
   gate on CBZ.camera, and camera.js owns the lens at onAlways(50) — so inside
   ONE CBZ.stepSim they read the camera the PREVIOUS step left behind. Every
   step here therefore re-stamps the tripod AFTER the step, never only before.
*/

/* A 30 Hz FIXED STEP. A breach is 1.2 seconds of ballistics and the three
   ridden frames this page photographs (launch / apex / entry) have to be
   caught within a frame or two of the real event; at 1/15 the apex sample can
   be a third of a metre off the top of the arc, which is a third of the claim.
   The whole page simulates well under two minutes, so it fits. */
const RUN = 1 / 30;
/* ...AND IT HAS TO BE DECLARED AGAIN INSIDE stage(). The stage function is
   SERIALIZED and evaluated inside the page, so it carries no module scope with
   it: every free identifier it names is a ReferenceError in the browser and
   every frame of the pass comes back empty. This is the one rule of this tool
   and it costs a whole run to learn. */

const subjects = [
  {
    id: "ride-launch", ch: 0,
    label: "The Launch — the charge becomes height",
    focus:
      "The frame the great white leaves the water, after the same two-second sprint on both sides. BEFORE: the launch ADDS forward speed (W.v = max(W.v, sprint * 1.04)) at the instant the animal should be spending it on climb, so the body leaves on a shallow path and skips. AFTER: the run-up is converted, the nose points exactly where the animal is going, and the hole it came out of throws a curtain of water up after it. Look at the angle of the body against the horizon.",
  },
  {
    id: "ride-apex", ch: 1,
    label: "The Apex — the whole animal, off the flank, shedding",
    focus:
      "The top of the same arc. AFTER: the body has come over onto its flank (the turn-roll line used to overwrite the arc's roll every frame, so a breach came out perfectly upright no matter what), it is level across the top because the pose is DERIVED from the velocity vector rather than animated, and it is trailing the water it carried out of the sea. Also the fog test: the world must not still be tinted underwater while the animal is metres above it.",
  },
  {
    id: "ride-entry", ch: 2,
    label: "The Entry — a tonne and a half of animal, nose first",
    focus:
      "The frame the body touches the water again. AFTER: nose-down at the true flight-path angle, still carrying flank roll into the water, and the splash is sized from the animal's own mass and its real entry speed instead of the flat 78 kg the legacy splash call reported for every body in the game. The number to read is landingKg.",
  },
  {
    id: "ride-after", ch: 3,
    label: "Down Through The Surface — the fog follows the EYE",
    focus:
      "0.7 s of aftermath, and then the dive key: the animal is driven back down through the waterline with the chase camera behind it, and the frame is taken from under the sea on purpose. Everything world/water_underwater.js draws is graded from the CAMERA's depth, not the animal's, so this is where the two crossing numbers come from — camUpLagFrames (the eye leaving the water behind the body, which nothing owned before this pass: the ride's dive-camera stands down the instant the body goes airborne) and camDownLagFrames (the eye going back under, which is a chase camera correctly staying dry while the body is only a foot below, and is unchanged).",
  },
  {
    id: "wild-strike", ch: 4,
    label: "A Wild Great White, From Under A Dolphin",
    focus:
      "A hungry great white on a wounded dolphin held at the surface, photographed mid-strike. BEFORE: it cannot happen — wildlife_shark.js's depth() clamps every wild shark's torso under the waterline unconditionally, so the strike ends as a bump under the surface and the sea stays flat. AFTER: the charge carries through and the animal clears the water with its mouth open. Nothing here drives it: the trigger is the shark's own committed rush, at the range where its climb and its charge arrive together.",
  },
  {
    id: "meg-landing", ch: 5,
    label: "A Megalodon Comes Down",
    focus:
      "The same ladder, three rungs up, on a body that has eaten its way to twenty-two metres. BEFORE: tens of tonnes of animal re-enters the sea as a 78 kg diver at a clamped speed — literally the same splash a swimmer makes — and its authored 5.84 m of air is measured from a launch point 3.4 m under the surface, so it clears the water by 1.84. AFTER: the apex is measured from the sea, and world/water_impact.js is handed the animal's real kilograms, which puts it in the vocabulary that file already calibrated for a vehicle going in. Both sides are photographed five frames after the entry with the animal surfacing, so the chase camera is over the waterline in both columns and the splash is what differs.",
  },
];

const readyExpression =
  "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && " +
  "CBZ.citySeaHeightAt && CBZ.cityMountedAnimal && CBZ.aquaticMountAudit && " +
  "document.getElementById('playBtn')";

async function stageSharkBreach(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv) return { ok: false, missing: "engine" };
  const RUN = 1 / 30;               // see the note above: no module scope in here
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DEG = 57.29577951308232;

  let D = window.__sharkBreach;
  if (!D) {
    D = window.__sharkBreach = {
      chapter: -1, shot: null, _rafOrig: null,
      m: {},                        // the measurements, carried across chapters
      arc: [], anchor: null, wild: null, prey: null,
      hits: [],                     // every CBZ.waterHit the arc produced

      // ---------------- the page's own clock ----------------
      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
        cam.updateMatrixWorld(true);
      },
      reshoot() { const s = D.shot; if (s) D.tripod(s[0], s[1], s[2], s[3], s[4], s[5]); },
      shoot(px, py, pz, tx, ty, tz) { D.shot = [px, py, pz, tx, ty, tz]; D.tripod(px, py, pz, tx, ty, tz); },
      /* HARNESS TRAP (ff27038): the lens has to be right DURING the step, not
         after it — several emitters distance-gate on CBZ.camera and read the
         camera the previous step left behind. Re-stamped on both sides. */
      step(n) { for (let i = 0; i < n; i++) { CBZ.stepSim(RUN); D.reshoot(); } },
      sec(s) { D.step(Math.max(1, Math.round(s / RUN))); },

      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        for (let t = 0; t < 90 && !D.armed(); t++) { D.step(12); await sleep(20); }
        if (!D.armed()) return false;
        /* From here the match advances ONLY when a chapter steps it. Killing
           the page's frame loop is what lets a detached tripod survive to the
           capture, and the already-queued callback has to be DRAINED in a frame
           we control or it re-stamps the camera at some later compositor tick. */
        D._rafOrig = window.requestAnimationFrame;
        const orig = D._rafOrig;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
        return true;
      },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark &&
          CBZ.cityMountedAnimal && CBZ.cityMountedAnimal() === CBZ.sharkSim.shark);
      },

      // ---------------- the island's own oracles ----------------
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0; },
      col(x, z) { return CBZ.cityWaterDepthAt ? Math.max(0, CBZ.cityWaterDepthAt(x, z)) : 0; },
      /* WHERE THE WATER IS DEEP ENOUGH TO JUMP OUT OF. Searched against the
         game's own bathymetry rather than assumed, because every clamp in both
         breach paths is written against the real column and a chapter staged
         over the shelf photographs a shark that correctly declines to leap. */
      deepSpot(minD, ang) {
        const A = CBZ.surv.arena;
        for (let r = A.radius; r < A.radius + 460; r += 4) {
          const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
          if (D.col(x, z) > minD) return { x: x, z: z, r: r, ang: ang, d: D.col(x, z) };
        }
        return null;
      },

      /* Everything that is not this experiment goes away. A converging pod or a
         wild shark wandering into the shot would breach on its own timing and
         the two columns would stop being the same photograph. */
      peace() {
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || !a.species) continue;
          if (CBZ.sharkSim && a === CBZ.sharkSim.shark) continue;
          if (a === D.wild || a === D.prey) continue;
          a.pos.x += 1400; a.hunger = 0;
          if (a.group) a.group.position.x = a.pos.x;
          if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
        }
        if (CBZ.sharkSim) {
          const S = CBZ.sharkSim.shark;
          if (S) S.hp = S.maxHp;
          CBZ.sharkSim.podT = 9000;
        }
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
      },

      /* UP THE LADDER THROUGH THE MODE'S OWN DOOR. CBZ.sharkSimBite is the call
         shark_sim.js makes on every kill; feeding it a dead body of a chosen
         weight is the only honest way to reach a great white or a megalodon
         without this file owning a second progression. It exists identically on
         both builds, so the two columns arrive at the same species with the
         same eaten-mass surplus and therefore the same body size. */
      climbTo(tier) {
        for (let guard = 0; guard < 40 && CBZ.sharkSim.tier < tier; guard++) {
          const meal = { dead: true, hp: 0, maxHp: 900, pos: { x: 0, y: 0, z: 0 } };
          try { CBZ.sharkSimBite("animal", meal, CBZ.sharkSim.shark); } catch (e) {}
          D.step(8);                            // let the evolve cinematic settle
        }
        // the ceremony owns slow-motion and a scale animator; drain both
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        D.step(30);
        CBZ.hitstop = 0; CBZ.slowmo = 0;
        return CBZ.sharkSim.tier;
      },

      // put the ridden body in deep water, pointed along a fixed bearing
      park(spot, heading) {
        const P = CBZ.player, a = CBZ.cityMountedAnimal && CBZ.cityMountedAnimal();
        P.pos.x = spot.x; P.pos.z = spot.z;
        if (a) {
          if (a.pos) { a.pos.x = spot.x; a.pos.z = spot.z; }
          if (a.group) a.group.position.x = spot.x, a.group.position.z = spot.z;
          if (a._waterMove) { a._waterMove.x = spot.x; a._waterMove.z = spot.z; }
        }
        if (CBZ.cityMountedHeading) { try { CBZ.cityMountedHeading(heading); } catch (e) {} }
        // the ride steers off the camera yaw, so the keys below push this way
        if (CBZ.cam) { CBZ.cam.yaw = Math.atan2(-Math.cos(heading), -Math.sin(heading)); CBZ.cam.pitch = 0.06; }
        D.step(6);
      },
      keys(w, shift, rise, dive) {
        const K = CBZ.keys || (CBZ.keys = {});
        K.w = !!w; K.shift = !!shift; K[" "] = !!rise; K.control = !!dive;
      },

      // ---------------- THE RULERS ----------------
      // Everything below reads state that exists on BOTH builds. Nothing asks a
      // new audit for a number the old build cannot produce.
      mount() { return CBZ.cityMountedAnimal ? CBZ.cityMountedAnimal() : null; },
      bodyY() { const a = D.mount(); return a && a.group ? a.group.position.y : 0; },
      airborne() {
        try { return !!CBZ.aquaticMountAudit().airborne; } catch (e) { return false; }
      },
      camY() { const c = CBZ.camera; return c ? c.position.y : 0; },
      // droplets alive in world/water_wake.js's pool, from OUTSIDE: the pool
      // publishes how many slots are spare, so the change across a step is how
      // many it just took. Same instrument on both builds.
      // is the world being graded as underwater RIGHT NOW — the engine's own
      // answer, which both builds publish
      submerged() {
        if (typeof CBZ.cityCameraSubmerged !== "function") return false;
        try { return !!CBZ.cityCameraSubmerged(); } catch (e) { return false; }
      },
      poolFree() {
        if (typeof CBZ.waterEmitFree !== "function") return -1;
        try { return CBZ.waterEmitFree() | 0; } catch (e) { return -1; }
      },

      /* WHAT THE SEA WAS TOLD. The whole "a megalodon splashes like a swimmer"
         claim is one argument to one call, so the call is wrapped for exactly
         the duration of the arc and every impact it produces is recorded. This
         is measured from OUTSIDE both blocks, the way marine-predation.mjs
         counts HUD lines, because a counter either build wrote for itself would
         only ever report the number its own author chose. */
      catchHits(on) {
        if (on) {
          if (D._origHit) return;
          D._origHit = CBZ.waterHit;
          if (typeof D._origHit !== "function") { D._origHit = null; return; }
          CBZ.waterHit = function (x, y, z, o) {
            try {
              D.hits.push({
                kind: (o && o.kind) || "debris",
                mass: Math.round(+((o && o.mass) || 0)),
                speed: +(+((o && o.speed) || 0)).toFixed(2),
              });
            } catch (e) {}
            return D._origHit.apply(this, arguments);
          };
        } else if (D._origHit) {
          CBZ.waterHit = D._origHit; D._origHit = null;
        }
      },
      /* THE HEAVIEST THING THE SEA WAS TOLD ABOUT, by MOMENTUM rather than by
         mass, because momentum is what world/water_impact.js actually sizes a
         splash from: `strength = (sqrt(mass) * speed / 70) ^ 0.55`. Ranking by
         mass alone would let a heavier body that barely touched the water beat
         the one that made the splash in the picture. */
      heaviestHit() {
        let best = null, bm = -1;
        for (const h of D.hits) {
          const m = Math.sqrt(Math.max(0, h.mass)) * Math.max(0, h.speed);
          if (m > bm) { bm = m; best = h; }
        }
        return best ? { kind: best.kind, mass: best.mass, speed: best.speed, mom: Math.round(bm) } : null;
      },

      /* THE ARC, SAMPLED. One row per fixed step: where the body is against the
         live surface, where the EYE is against the live surface under the eye
         (which is the number world/water_underwater.js's eyeDepth() actually
         grades the world from), the body's attitude, and the velocity vector
         reconstructed from successive positions. The last of those is what
         makes `alignErrDeg` an honest measurement rather than a restatement:
         nothing here asks the build what pitch it intended. */
      sample(i) {
        const a = D.mount(), g = a && a.group;
        if (!g) return null;
        const surf = D.seaY(g.position.x, g.position.z);
        const c = CBZ.camera;
        const camSurf = c ? D.seaY(c.position.x, c.position.z) : surf;
        const p = D._prev;
        const row = {
          i: i,
          bodyAbove: g.position.y - surf,
          camAbove: c ? c.position.y - camSurf : 0,
          /* IS THE WORLD ACTUALLY TINTED. Not inferred from the geometry — the
             engine's own answer, which both builds publish. world/
             water_underwater.js decides this from the camera's eyeDepth with
             hysteresis, so a geometric guess can disagree with the thing on
             screen by a frame either way, and it is the thing on screen that
             the owner is looking at. */
          sub: (typeof CBZ.cityCameraSubmerged === "function") ? !!CBZ.cityCameraSubmerged()
            : (c ? c.position.y < camSurf : false),
          pitch: g.rotation.z, roll: g.rotation.x,
          air: D.airborne() ? 1 : 0,
          vy: p ? (g.position.y - p.y) / RUN : 0,
          hv: p ? Math.hypot(g.position.x - p.x, g.position.z - p.z) / RUN : 0,
          x: g.position.x, y: g.position.y, z: g.position.z, surf: surf,
        };
        D._prev = { x: g.position.x, y: g.position.y, z: g.position.z };
        return row;
      },
      /* Step until a predicate goes true, sampling every frame. Returns the
         index it stopped at, or -1. Both columns run the same budget, so a
         build in which the thing never happens spends the same seconds.

         THE SAMPLE IS TAKEN BEFORE THE TRIPOD GOES BACK ON, and that ordering
         is the whole honesty of the fog measurement. systems/camera.js owns the
         lens at onAlways(50) and cannot be held across a step, so a preset's
         tripod is only ever what gets RENDERED — every underwater grade in the
         frame was decided during the step, from the GAME's own chase camera.
         Sampling after the re-stamp would measure this file's tripod and
         cheerfully report that the world was never wrongly tinted. */
      until(test, budget) {
        for (let k = 0; k < budget; k++) {
          CBZ.stepSim(RUN);
          const row = D.sample(D.arc.length);
          D.reshoot();
          if (row) { D.arc.push(row); if (test(row, D.arc)) return D.arc.length - 1; }
        }
        return -1;
      },
      arcStats() {
        let apex = -99, up = 0, down = 0, roll = 0, align = 0, air = 0, tintWrong = 0;
        let flown = 0;
        for (const r of D.arc) {
          if (!r.air) continue;
          air++; flown++;
          if (r.bodyAbove > apex) apex = r.bodyAbove;
          if (r.pitch > up) up = r.pitch;
          if (r.pitch < down) down = r.pitch;
          if (Math.abs(r.roll) > roll) roll = Math.abs(r.roll);
          /* THE BODY'S ATTITUDE AGAINST ITS OWN RECONSTRUCTED VELOCITY VECTOR.
             The FIRST airborne frame is deliberately excluded and it is not a
             convenience: the launch is a velocity discontinuity, so on that one
             frame the position delta describes the trajectory the body just
             LEFT (a fast, flat swim) while the pose already describes the one it
             is about to fly. Both builds score ~35-45 degrees there and neither
             is doing anything wrong. What this metric is for is the FLIGHT: over
             every frame after the launch the attitude must be the velocity
             vector, and a number that creeps up is somebody animating a pose
             instead of deriving one. */
          if (flown > 1 && (r.hv > 0.2 || Math.abs(r.vy) > 0.2)) {
            const e = Math.abs(r.pitch - Math.atan2(r.vy, Math.max(0.8, r.hv)));
            if (e > align) align = e;
          }
          // the fog bug, as a count: the animal is out of the water and the
          // world is still being graded as if the eye were under it
          if (r.bodyAbove > 0.1 && r.sub) tintWrong++;
        }
        return {
          apexM: apex > -90 ? +apex.toFixed(2) : 0,
          airFrames: air,
          pitchUpDeg: +(up * 57.29577951308232).toFixed(1),
          pitchDownDeg: +(down * 57.29577951308232).toFixed(1),
          pitchSweepDeg: +((up - down) * 57.29577951308232).toFixed(1),
          rollDeg: +(roll * 57.29577951308232).toFixed(1),
          alignErrDeg: +(align * 57.29577951308232).toFixed(2),
          tintWrongFrames: tintWrong,
        };
      },
      // how many frames the EYE trailed the BODY across the waterline, each way
      crossLag() {
        let ub = -1, uc = -1, db = -1, dc = -1;
        for (const r of D.arc) {
          if (ub < 0 && r.bodyAbove > 0) ub = r.i;
          if (ub >= 0 && uc < 0 && !r.sub) uc = r.i;
          if (ub >= 0 && db < 0 && r.bodyAbove < 0 && r.i > ub + 2) db = r.i;
          if (db >= 0 && dc < 0 && r.sub) dc = r.i;
        }
        return {
          upLag: (ub >= 0 && uc >= 0) ? Math.max(0, uc - ub) : null,
          downLag: (db >= 0 && dc >= 0) ? Math.max(0, dc - db) : null,
        };
      },
    };

    window.__cbzVisualCompare = {
      /* Awaited before every capture. Under SwiftShader the compositor takes
         over a second to PRESENT a rendered canvas, and a canvas rendered
         outside an animation frame is never presented at all — so render inside
         ONE borrowed real frame (the game's own chain is already dead, so
         lending rAF back for a single callback cannot restart it) and then wait
         the compositor out. */
      /* HARNESS TRAP — A BACKGROUNDED TAB NEVER FIRES rAF, AND THIS AWAITED IT
         FOREVER. Under SwiftShader the compositor takes over a second to
         PRESENT a rendered canvas, and a canvas rendered outside an animation
         frame may not be presented at all — hence borrowing one real frame back
         (the game's own chain is already dead, so lending rAF for a single
         callback cannot restart it). But `document.hidden` is not ours to
         control: anything that takes focus while a run is in flight — another
         Chrome window, a second capture tab — backgrounds this page, and a
         backgrounded page's requestAnimationFrame is never called. MEASURED on
         a stalled run: `rAF NEVER FIRED (visibility=hidden hidden=true)`, the
         stage sat there until the 15-minute stage timeout, and every remaining
         subject would have done the same. So the borrowed frame is RACED: if it
         has not arrived in 1.5 s, render directly and carry on. A frame drawn
         outside rAF is worth infinitely more than a frame that never comes. */
      async render() {
        if (CBZ.bootMeter && CBZ.bootMeter.hide) { try { CBZ.bootMeter.hide(); } catch (e) {} }
        if (!CBZ.renderer) return;
        const draw = () => { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} };
        const raf = D._rafOrig;
        let drew = false;
        if (raf) {
          await new Promise((res) => {
            let done = false;
            const finish = () => { if (!done) { done = true; res(); } };
            raf.call(window, () => { draw(); drew = true; finish(); });
            setTimeout(finish, 1500);
          });
        }
        if (!drew) draw();                       // the tab was hidden: draw anyway
        await new Promise((r) => setTimeout(r, 1200));
      },
    };
  }

  const out = {};
  const CH = [
    /* 0 — THE LAUNCH. The mount is climbed to a great white through the mode's
       own meal call, parked in genuinely deep water, and then driven with the
       REAL KEYS: two seconds of sprint (which is what makes it a leap rather
       than a standing pop — the launch spends the charge, so a shark that has
       not charged does not get an arc), then the rise key on top. Stepped one
       frame at a time until the mount's own audit says the body is off the
       water, which is a signature both builds carry. */
    async function launch() {
      if (!await D.boot()) throw new Error("sharksim never armed");
      D.peace();
      out.tier = D.climbTo(2);                       // 2 = GREAT WHITE
      D.peace();
      const spot = D.deepSpot(24, 0.7);
      if (!spot) throw new Error("no deep water off this island");
      D.anchor = spot;
      const heading = spot.ang + Math.PI * 0.5;      // run along the shore, across the lens
      D.park(spot, heading);

      // THE RUN-UP. No rise key yet: the breach gate wants sprint AND rise AND
      // the body already at the top of its column, so holding all three from a
      // standstill produces a vertical pop off a 4 m/s body. Two seconds of
      // sprint first is what a player does and what makes the arc a spear.
      D.keys(true, true, false, false);
      D.sec(2.0);
      const a0 = D.mount();
      out.species = a0 && a0.species ? a0.species.id : null;
      out.runUpSpeed = +(CBZ.player.speed || 0).toFixed(2);

      // the lens: abeam the launch point, low over the swell, looking back
      // along the run. Framed on the ANCHOR, which is identical on both sides
      // by construction, never on the animal (which is allowed to move).
      const g = a0.group;
      const lx = g.position.x, lz = g.position.z, ls = D.seaY(lx, lz);
      const nx = Math.cos(heading + Math.PI * 0.5), nz = Math.sin(heading + Math.PI * 0.5);
      /* ONE FIXED LENS FOR THE WHOLE ARC, and close. The first cut stood 27 m
         off and the animal was four percent of the frame — every claim this
         page makes is about the SHAPE of a five-metre body and none of it was
         legible. 15 m abeam puts the shark across about a fifth of the width
         and still holds both arcs: the after arc is ~11 m of range and the
         before arc ~21 m, so the lens is aimed 7 m down the run, between the
         two apexes, and the four ridden frames read as one photograph series
         through a static frame. */
      D.shoot(lx + nx * 15 + Math.cos(heading) * 7, ls + 3.6, lz + nz * 15 + Math.sin(heading) * 7,
        lx + Math.cos(heading) * 7, ls + 1.9, lz + Math.sin(heading) * 7);

      D.arc.length = 0; D.hits.length = 0; D._prev = null;
      D.catchHits(true);
      D.keys(true, true, true, false);
      const li = D.until((r) => r.air === 1, 300);
      if (li < 0) throw new Error("the mount never left the water");
      out.launchFrame = li;
      out.launchPitchDeg = +(D.arc[li].pitch * DEG).toFixed(1);
      out.launchHv = +D.arc[li].hv.toFixed(2);
      /* The readout box has to say something true about THIS frame. One
         airborne frame is not an arc, so the arc statistics are whatever the
         launch instant is worth and no more — and the exit splash has already
         fired by now, so its mass is real. Reporting zeros here read as "the
         breach did not happen", which is exactly the wrong thing for the frame
         that IS the breach happening. */
      const st0 = D.arcStats();
      out.pitchUpDeg = st0.pitchUpDeg;
      out.rollDeg = st0.rollDeg;
      out.airFrames = st0.airFrames;
      const h0 = D.heaviestHit();
      out.launchKg = h0 ? h0.mass : 0;
      D.reshoot();
    },

    /* 1 — THE APEX. Step until the body stops rising. */
    async function apex() {
      const ai = D.until((r) => r.air === 1 && r.vy <= 0, 120);
      out.apexFrame = ai;
      const st = D.arcStats();
      out.apexM = st.apexM;
      out.tintWrongFrames = st.tintWrongFrames;
      out.rollDeg = st.rollDeg;
      D.reshoot();
    },

    /* 2 — THE ENTRY. Step until the mount's audit says it is back in the water;
       the impact fires on that frame, so the pool is sampled either side of it
       and the wrapped waterHit has the mass the sea was told. */
    async function entry() {
      const free0 = D.poolFree();
      const ei = D.until((r) => r.air === 0 && r.i > 4, 160);
      const free1 = D.poolFree();
      out.entryFrame = ei;
      out.splashDrops = (free0 >= 0 && free1 >= 0) ? Math.max(0, free0 - free1) : 0;
      const st = D.arcStats();
      out.airFrames = st.airFrames;
      out.apexM = st.apexM;
      out.pitchUpDeg = st.pitchUpDeg;
      out.pitchDownDeg = st.pitchDownDeg;
      out.pitchSweepDeg = st.pitchSweepDeg;
      out.rollDeg = st.rollDeg;
      out.alignErrDeg = st.alignErrDeg;
      out.tintWrongFrames = st.tintWrongFrames;
      const h = D.heaviestHit();
      out.landingKg = h ? h.mass : 0;
      out.landingMomentum = h ? h.mom : 0;
      out.landingClass = h ? (h.kind === "vehicle" ? 1 : 0) : 0;
      out.camAboveAtEntryM = ei >= 0 ? +D.arc[ei].camAbove.toFixed(2) : 0;
      D.m.rideHits = D.hits.slice(0, 8);
      D.reshoot();
    },

    /* 3 — THE AFTERMATH, and the fog crossings. The lens is left where it was
       and the match runs on; then the dive key is held so the body goes DOWN
       through the surface with the chase camera behind it, which is the second
       half of the crossing test — the world must retint when the EYE goes
       under, not a second before or after. */
    async function after() {
      D.keys(false, false, false, false);
      D.sec(0.7);
      D.reshoot();
      // droplets still alive around the entry point, counted the same way on
      // both builds: the pool's spare slots against its idle baseline
      const busy = D.poolFree();
      D.catchHits(false);

      // now drive it under and watch the eye follow
      const preLen = D.arc.length;
      D.keys(true, false, false, true);
      D.until((r) => r.camAbove < -0.4 && r.i > preLen + 4, 200);
      D.keys(false, false, false, false);
      const cl = D.crossLag();
      out.camUpLagFrames = cl.upLag == null ? 0 : cl.upLag;
      out.camDownLagFrames = cl.downLag == null ? 0 : cl.downLag;
      const st = D.arcStats();
      out.tintWrongFrames = st.tintWrongFrames;
      out.apexM = st.apexM;
      out.airFrames = st.airFrames;
      out.pitchSweepDeg = st.pitchSweepDeg;
      out.rollDeg = st.rollDeg;
      out.alignErrDeg = st.alignErrDeg;
      const hh = D.heaviestHit();
      out.landingKg = hh ? hh.mass : 0;
      out.landingMomentum = hh ? hh.mom : 0;
      D.m.poolBusy = busy;
      // put the lens back on the entry point for the picture
      const s = D.shot;
      if (s) D.tripod(s[0], s[1], s[2], s[3], s[4], s[5]);
    },

    /* 4 — THE WILD STRIKE. A wounded dolphin HELD at the surface and a starving
       great white 70 m out, both spawned with the game's own builder. From
       there nothing in this file drives the shark: city/marine_predation.js
       adopts the pair, CBZ.predatorHunt runs the commit, and the strike gate in
       wildlife_shark.js decides on its own whether the charge becomes a leap.
       The starter seam is pulled only if the natural trigger has not come up
       inside the shared budget — it runs the identical code path, and on the
       BEFORE build it does not exist at all, which is the finding. */
    async function wildStrike() {
      // get the player (and therefore the LOD and the breach pass radius) close
      const spot = D.deepSpot(28, -0.6);
      if (!spot) throw new Error("no deep water for the strike");
      const heading = spot.ang + Math.PI * 0.5;
      D.park(spot, heading);
      D.keys(false, false, false, false);

      const P = CBZ.player;
      const px = spot.x + Math.cos(heading + Math.PI * 0.5) * 34;
      const pz = spot.z + Math.sin(heading + Math.PI * 0.5) * 34;
      P.pos.x = px; P.pos.z = pz;
      const a = D.mount();
      if (a) {
        if (a.pos) { a.pos.x = px; a.pos.z = pz; }
        if (a.group) a.group.position.x = px, a.group.position.z = pz;
      }
      D.step(4);

      const spawn = (id, x, z) => {
        if (!CBZ.cityWildlifeSpawnAt) return null;
        try { return CBZ.cityWildlifeSpawnAt(id, x, z); } catch (e) { return null; }
      };
      const prey = spawn("dolphin", spot.x, spot.z);
      const gw = spawn("great_white_shark", spot.x - Math.cos(heading) * 70, spot.z - Math.sin(heading) * 70);
      if (!prey || !gw) throw new Error("could not spawn the dolphin / great white");
      D.prey = prey; D.wild = gw;
      D.peace();
      gw.hunger = 1; gw.hp = gw.maxHp || gw.hp;
      prey.hp = Math.round((prey.maxHp || 60) * 0.32);        // hurt: it bleeds, it draws

      /* THE LENS IS ON THE DOLPHIN, NOT ON THE SHARK. The dolphin is the one
         thing in this scene that is held still, so framing on it is the only
         way the two columns are framed identically by construction — and it is
         also where the action is, because the shark comes to it. Framing on the
         shark would put the before column (which correctly never leaves the
         water and wanders) on a different patch of sea from the after one, and
         the pair would stop being a pair. */
      const surf = D.seaY(spot.x, spot.z);
      D.shoot(spot.x + Math.cos(heading + Math.PI * 0.5) * 22 + Math.cos(heading) * 5, surf + 4.4,
        spot.z + Math.sin(heading + Math.PI * 0.5) * 22 + Math.sin(heading) * 5,
        spot.x, surf + 2.0, spot.z);

      D.hits.length = 0;
      D.catchHits(true);
      const hold = () => {
        // the prey is the CONDITION being tested: it has to be at the surface
        prey.pos.x = spot.x; prey.pos.z = spot.z;
        prey.group.position.x = spot.x; prey.group.position.z = spot.z;
        prey.group.position.y = D.seaY(spot.x, spot.z) - 0.3;
        if (prey._waterMove) { prey._waterMove.x = spot.x; prey._waterMove.z = spot.z; }
      };
      const gs = gw.group;
      /* THE RISE KEY IS HELD FOR THE WHOLE CHAPTER, and it is not about the
         ridden shark at all — it is about the LENS. systems/camera.js owns the
         camera at onAlways(50) and cannot be held across a step, so every
         underwater grade in the frame was decided from the GAME's chase camera
         wherever it happened to be; a tripod only changes what is rendered,
         never what the fog was graded from. MEASURED: left to coast for twenty
         seconds while the hunt played out, the player's mount settled deep
         enough to put that camera under, and BOTH columns came back as a flat
         green rectangle with the whole scene fogged out. Rise (with no sprint
         and no direction, so the launch gate cannot open) pins the mount at the
         top of its own column and the lens over the waterline. */
      D.keys(false, false, true, false);
      // let the pair find each other and the lens settle — a fixed budget, so
      // both columns simulate exactly the same seconds
      for (let k = 0; k < 300; k++) { hold(); CBZ.stepSim(RUN); D.reshoot(); }
      for (let k = 0; k < 120 && D.submerged(); k++) { hold(); CBZ.stepSim(RUN); D.reshoot(); }
      out.lensUnderAtStart = D.submerged() ? 1 : 0;

      /* THE STRIKE, through the block's own starter. Every step downstream of
         this — the climb from depth, the exit burst, the ballistic arc, the
         pose, the shed trail, the landing — is what the shark's own committed
         rush runs when it decides for itself; the seam only skips the wait,
         which a page that has to photograph the same instant on two builds
         cannot afford. On the BEFORE build the function does not exist, so that
         column simply spends the same steps with the animal under the water,
         which IS the finding. (The natural trigger is real and is measured
         separately: it fired on its own inside 30 s of staged hunting in the
         development probe.) */
      let forced = 0;
      if (typeof CBZ.sharkBreachNow === "function") {
        try { forced = CBZ.sharkBreachNow(gw, "strike") ? 1 : 0; } catch (e) { forced = 0; }
      }
      /* RIDE IT TO THE TOP OF ITS OWN ARC. Stopping on "is it above the
         waterline" needs a surface oracle to agree with the one the breach
         integrates against, and this file has no business assuming that; the
         body's own peak is a RELATIVE test that cannot be wrong. Two frames
         past the top is the frame with the whole animal in it. */
      let peak = -1e9, peakK = -1, outOfWater = -1;
      for (let k = 0; k < 110; k++) {
        hold();
        CBZ.stepSim(RUN); D.reshoot();
        const y = gs.position.y;
        if (y - D.seaY(gs.position.x, gs.position.z) > 0.15 && outOfWater < 0) outOfWater = k;
        if (y > peak) { peak = y; peakK = k; }
        else if (peakK >= 0 && k > peakK + 2) break;
      }
      D.catchHits(false);
      const s2 = D.seaY(gs.position.x, gs.position.z);
      out.wildAboveSurfM = +(gs.position.y - s2).toFixed(2);
      out.wildAirborne = gs.position.y - s2 > 0.1 ? 1 : 0;
      out.wildForced = forced;
      out.wildPitchDeg = +(gs.rotation.z * DEG).toFixed(1);
      out.wildForcedFrame = outOfWater;
      out.lensUnderAtShot = D.submerged() ? 1 : 0;
      const h = D.heaviestHit();
      out.landingKg = h ? h.mass : 0;
      out.landingMomentum = h ? h.mom : 0;
      D.keys(false, false, false, false);
      D.reshoot();
    },

    /* 5 — THE MEGALODON. Same ladder, two rungs further up, same production
       keys, photographed on the frame it comes back down. */
    async function meg() {
      // clear the strike cast so ten tonnes of animal has the water to itself
      for (const o of [D.wild, D.prey]) {
        if (!o) continue;
        o.dead = true; o._despawned = true;
        const wl = CBZ.cityWildlife || []; const ix = wl.indexOf(o);
        if (ix >= 0) wl.splice(ix, 1);
        if (o.group && o.group.parent) o.group.parent.remove(o.group);
      }
      D.wild = null; D.prey = null;
      out.tier = D.climbTo(3);                       // 3 = MEGALODON
      D.peace();
      const spot = D.deepSpot(34, 1.9);
      if (!spot) throw new Error("no deep water for a megalodon");
      const heading = spot.ang + Math.PI * 0.5;
      D.park(spot, heading);
      const a = D.mount();
      out.species = a && a.species ? a.species.id : null;

      D.keys(true, true, false, false);
      D.sec(2.2);
      const g = a.group;
      const lx = g.position.x, lz = g.position.z, ls = D.seaY(lx, lz);
      const nx = Math.cos(heading + Math.PI * 0.5), nz = Math.sin(heading + Math.PI * 0.5);
      // twice the animal, so about twice the standoff of the great white's
      D.shoot(lx + nx * 28 + Math.cos(heading) * 9, ls + 7.5, lz + nz * 28 + Math.sin(heading) * 9,
        lx + Math.cos(heading) * 9, ls + 3.0, lz + Math.sin(heading) * 9);

      D.arc.length = 0; D.hits.length = 0; D._prev = null;
      D.catchHits(true);
      D.keys(true, true, true, false);
      const li = D.until((r) => r.air === 1, 300);
      if (li < 0) throw new Error("the megalodon never left the water");
      const ei = D.until((r) => r.air === 0 && r.i > li + 4, 200);
      const free0 = D.poolFree();
      /* THE SHOT IS FIVE FRAMES AFTER THE ENTRY, WITH THE RISE KEY HELD, and
         both halves of that are about the LENS rather than the splash.
         systems/camera.js owns the camera at onAlways(50) and cannot be held
         across a step, so every underwater grade in the frame was decided from
         the game's own chase camera — and a body that has just punched ten
         tonnes of itself under the surface takes that camera down with it. The
         first cut photographed the before column through a green screen of
         underwater fog with nothing visible in it at all. Surfacing the animal
         puts the eye back over the waterline on BOTH sides, and 0.17 s is also
         when the crown this page is about is at its tallest. */
      /* THREE FRAMES AFTER THE ENTRY, AND NOT ONE MORE — and that is about the
         LENS, not the splash. systems/camera.js owns the camera at onAlways(50)
         and cannot be held across a step, so every underwater grade in the
         frame was decided from the GAME's chase camera; a tripod only changes
         what is rendered. Ten tonnes of animal punching under the surface takes
         that camera down with it within about a fifth of a second, and MEASURED
         it takes far longer than the crown lasts to bring it back — a run that
         waited for the lens to surface photographed both columns through the
         fog with the splash already gone. The eye is still over the waterline
         on the entry frame (it has just watched the animal fall past it), so
         the shot is taken there, while the crown is going up. */
      D.keys(false, false, true, false);
      D.until((r) => r.i > ei + 3, 8);
      const free1 = D.poolFree();
      out.lensUnderAtShot = D.submerged() ? 1 : 0;
      D.keys(false, false, false, false);
      D.catchHits(false);
      const st = D.arcStats();
      out.apexM = st.apexM;
      out.airFrames = st.airFrames;
      out.pitchUpDeg = st.pitchUpDeg;
      out.pitchDownDeg = st.pitchDownDeg;
      out.pitchSweepDeg = st.pitchSweepDeg;
      out.rollDeg = st.rollDeg;
      out.alignErrDeg = st.alignErrDeg;
      out.tintWrongFrames = st.tintWrongFrames;
      out.splashDrops = (free0 >= 0 && free1 >= 0) ? Math.max(0, free0 - free1) : 0;
      const h = D.heaviestHit();
      out.landingKg = h ? h.mass : 0;
      out.landingMomentum = h ? h.mom : 0;
      out.landingClass = h ? (h.kind === "vehicle" ? 1 : 0) : 0;
      D.m.megHits = D.hits.slice(0, 8);
      D.reshoot();
    },
  ];

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }

  // ---- the overlay ----------------------------------------------------------
  let ov = document.getElementById("__breachOverlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "__breachOverlay";
    ov.style.cssText = "position:fixed;inset:0;pointer-events:none;color:#f2f8fc;text-shadow:0 2px 9px #001019;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
    ov.innerHTML = "<div data-side></div><div data-name></div><div data-focus></div><div data-read></div>";
    document.body.appendChild(ov);
  }
  const before = input.side === "before";
  const put = (k, text, css) => {
    const el = ov.querySelector("[data-" + k + "]");
    if (!el) return; el.textContent = text; el.style.cssText = css;
  };
  put("side", before ? input.beforeLabel : input.afterLabel,
    "position:absolute;top:20px;left:24px;padding:7px 11px;border-radius:7px;background:" +
    (before ? "#c94c4c" : "#218b60") + ";font-size:12px;font-weight:900;letter-spacing:.12em");
  put("name", sub.label, "position:absolute;top:58px;left:24px;font-size:25px;font-weight:800;letter-spacing:-.02em;text-shadow:0 2px 12px #001019,0 0 26px #001019");
  put("focus", sub.focus, "position:absolute;top:94px;left:22px;color:#dfeaf2;font-size:13px;font-weight:600;max-width:700px;line-height:1.4;background:rgba(4,16,26,.62);padding:9px 12px;border-radius:8px");
  put("read",
    (out.apexM ? "apex " + out.apexM + " m · air " + (out.airFrames || 0) + " f"
               : "launch pitch " + (out.launchPitchDeg == null ? "-" : out.launchPitchDeg) + "°") +
    "\npitch " + (out.pitchUpDeg || 0) + "° / " + (out.pitchDownDeg || 0) + "° · roll " + (out.rollDeg || 0) + "°" +
    "\n" + (out.landingKg ? "landing " : "exit ") +
      (out.landingKg || out.launchKg || 0) + " kg · momentum " + (out.landingMomentum || 0) +
    "\nalign err " + (out.alignErrDeg == null ? "-" : out.alignErrDeg) + "° · fog-wrong " + (out.tintWrongFrames || 0) + " f",
    "position:absolute;right:22px;top:20px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#a6f0c8;white-space:pre;text-align:right;background:rgba(4,16,26,.66);padding:8px 11px;border-radius:8px;line-height:1.5");

  await window.__cbzVisualCompare.render();
  return {
    ok: true, side: input.side, chapter: sub.ch,
    debug: {
      mode: CBZ.game.mode, tier: CBZ.sharkSim ? CBZ.sharkSim.tier : null,
      anchor: D.anchor, hits: D.hits.slice(0, 10),
      rideHits: D.m.rideHits || null, megHits: D.m.megHits || null,
      mountAudit: (typeof CBZ.aquaticMountAudit === "function") ? CBZ.aquaticMountAudit() : null,
      wildAudit: (typeof CBZ.sharkBreachAudit === "function") ? CBZ.sharkBreachAudit() : "absent",
      impact: (typeof CBZ.waterImpactStats === "function") ? CBZ.waterImpactStats() : null,
    },
    metrics: out,
  };
}

export default {
  id: "shark-breach",
  title: "Shark Sim — The Jump: the arc, the body, and the weight of the landing",
  description:
    "Six frames of sharks leaving and re-entering the sea, in Shark Sim on both sides. BEFORE is pristine " +
    "wave-start HEAD; AFTER is the working tree; the island, the seed, the ladder climb, the keys held and " +
    "the cameras are identical between them. Three failures: the RIDDEN BREACH was a skip because the launch " +
    "ADDED forward speed at the moment the animal should have been spending it on climb and the forward " +
    "accelerator kept running for the whole time the body was in the air (there is no water up there to push " +
    "against), while the apex was measured from a launch point metres under the surface so the bigger the " +
    "animal the more of its authored air it lost; the MEGALODON SPLASHED LIKE A SWIMMER because every breach " +
    "in the game went through CBZ.waterSplashAt, which clamps its dial and then reports the impact bus a flat " +
    "78 kg body no matter what made the splash; and WILD SHARKS COULD NOT LEAVE THE WATER AT ALL, because " +
    "wildlife_shark.js's depth() clamped every torso under the waterline unconditionally. After: the nose " +
    "points exactly where the animal is going all the way through the arc, the body comes over onto its flank " +
    "and sheds the water it carried out with it, the sea is told the animal's real kilograms, and a great " +
    "white takes a dolphin by coming out from under it.",
  beforeLabel: "BEFORE · wave-start HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · same seed · same ladder · same keys · same fixed steps · same cameras",
  method:
    "Both columns boot index.html into ?mode=sharksim at a pinned seed and click the Shark Sim tile + PLAY " +
    "exactly like a player. A per-page driver freezes the frame loop (draining the one already-queued rAF " +
    "callback, or it re-stamps the camera at an arbitrary later tick), empties the pod and the rest of the " +
    "sea, and climbs the ladder through the mode's OWN meal call (CBZ.sharkSimBite) so both sides arrive at " +
    "the same species with the same eaten-mass surplus. The breach is then driven with the REAL KEYS — two " +
    "seconds of sprint and then the rise key, held for the same number of fixed 1/30 steps on both sides — " +
    "and the run is advanced one frame at a time until the mount's own audit says the body is off the water, " +
    "which is a signature both builds carry. The wild strike spawns a wounded dolphin and a starving great " +
    "white with the game's own builder and then drives nothing: marine_predation adopts the pair, " +
    "CBZ.predatorHunt runs the commit, and the strike gate decides for itself. " +
    "EVERY NUMBER IS READ BY THE PRESET, off state both builds have: body and camera height against the live " +
    "surface under each of them, rotation.z and rotation.x off the rig, the velocity vector RECONSTRUCTED " +
    "from successive positions (so alignErrDeg is a measurement and not a restatement of what the build " +
    "intended), the droplet pool's own spare-slot count across the landing step, and — for landingKg — a " +
    "wrapper this file installs over CBZ.waterHit for exactly the duration of the arc, which is the only " +
    "honest way to ask what the sea was told it had been hit by.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 900000,
  viewport: { width: 1280, height: 720 },
  subjects,
  readyExpression,
  stage: stageSharkBreach,
  metrics: {
    apexM: { label: "Body above the live surface at the top of the arc", unit: "m", better: "higher" },
    airFrames: { label: "Frames the body spent out of the water", unit: "frames", better: "higher" },
    pitchSweepDeg: { label: "Pitch travelled nose-up to nose-down through the arc", unit: "deg", better: "higher" },
    pitchUpDeg: { label: "Nose-up at the steepest point of the climb", unit: "deg", better: "higher" },
    pitchDownDeg: { label: "Nose-down at the entry (more negative is steeper)", unit: "deg", better: "lower" },
    rollDeg: { label: "Flank roll at the top of the arc", unit: "deg", better: "higher" },
    alignErrDeg: { label: "Body attitude vs its own velocity vector (must stay ~0)", unit: "deg", better: "lower" },
    landingKg: { label: "Kilograms the sea was told the landing weighed", unit: "kg", better: "higher" },
    landingMomentum: { label: "Momentum the sea was hit with (sqrt(kg) x m/s — what sizes the splash)", better: "higher" },
    camAboveAtEntryM: { label: "Where the eye was when the animal landed (+ = above the waterline)", unit: "m", better: "higher" },
    landingClass: { label: "Landing entered the heavy (vehicle-mass) vocabulary", better: "higher" },
    splashDrops: { label: "Droplets the landing put in the water", unit: "drops", better: "higher" },
    tintWrongFrames: { label: "Frames the world was tinted underwater with the animal in the air", unit: "frames", better: "lower" },
    camUpLagFrames: { label: "Frames the eye trailed the body leaving the water", unit: "frames", better: "lower" },
    camDownLagFrames: { label: "Frames the eye trailed the body going back under", unit: "frames", better: "lower" },
    wildAirborne: { label: "A WILD shark got clear of the water", better: "higher" },
    wildAboveSurfM: { label: "How far clear of the sea the wild shark got", unit: "m", better: "higher" },
  },
  metricsNote:
    "landingKg is the whole splash complaint as one number, and it is measured from OUTSIDE both builds by " +
    "wrapping CBZ.waterHit: on HEAD it is 78 for every animal in the game, because CBZ.waterSplashAt hard-codes " +
    "a human body and clamps the strength dial its callers were turning. alignErrDeg is the opposite kind of " +
    "metric — it must stay at zero, in both columns: it is how far the body's attitude ever sat from its own " +
    "reconstructed velocity vector, and a non-zero value means a pose is being animated instead of derived. " +
    "tintWrongFrames is the fog test: frames in which the animal was out of the water and the world was still " +
    "being graded as if the eye were under it (world/water_underwater.js grades from the CAMERA, and nothing " +
    "owned the up-crossing before this pass). wildAirborne is either 0 or 1 and on HEAD it can only be 0 — " +
    "wildlife_shark.js's depth() clamped every wild torso under the waterline unconditionally. THE PICTURES " +
    "ARE THE TEST; these numbers only say whether the thing in the picture happened at all.",
};
