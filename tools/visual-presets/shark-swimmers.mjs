/* Shark Sim, before/after — THE PEOPLE IN THE SEA ARE NOT SWIMMING.

   Owner, 2026-08-26, playing Shark Sim:
     "look at the swimming in nat disaster game, that one has real swimming —
      the humans should actually swim in the shark game too like nat disaster."

   He is comparing the game to itself, and he is right to. city/swim.js is a
   genuinely good swimmer — graduated submergence, drag-first velocity, a
   buoyancy oscillator on the live wave surface, a crawl that blends to a
   tread — and it is PLAYER-ONLY and always has been. The ninety-nine other
   people in this mode ran entities/survivorbot.js's mover, whose last two
   lines were:

       b.pos.y = CBZ.surv.floorAt(b.pos.x, b.pos.z);      // RAW SEABED HEIGHT
       animChar(b.char, b.speed, dt);                     // the LAND walk cycle

   So they were not swimming badly. They were WALKING ON THE BOTTOM OF THE SEA,
   heel-toe, with the water closing over their heads as the shelf fell away —
   and a second system, the crowd separation pass at order 26, re-planted every
   one of them on the terrain height every frame in case any of them got ideas.

   A SECOND FINDING, and it is the one that makes this a feature rather than a
   fix: NOBODY IN THIS MODE COULD EVER HAVE BEEN SWIMMING. modes/shark_sim.js
   publishes the crowd's shore ring out to waterline + 9 m, and this foreshore
   is 0.83 m deep at waterline + 8. The deepest human being in Shark Sim stood
   in mid-thigh water. A beach where nobody is out of their depth is not a
   beach, and a shark game whose entire larder is standing in a foot of water
   has no sea in it — so the top of the crowd's wander draw now goes swimming
   (2.5% of it for a body that is already wet, 0.5% for one on the sand), at a radius SEARCHED for against the arena's own bathymetry rather
   than guessed, and a leg that crosses water HOLDS until the body arrives
   instead of being re-rolled 1.7 s in (which is why the first cut of this
   change produced a crowd that repeatedly waded in to its shins and changed
   its mind, and photographed nobody swimming at all).

   WHAT THE AFTER COLUMN IS RUNNING:
     • entities/character.js owns ONE swim cycle now (makeSwimAnim /
       swimAnimStep / poseSwimmer), lifted out of city/swim.js verbatim and
       made char-agnostic. The player's numbers are unchanged to the digit; the
       crowd strokes with the player's own arms.
     • survivorbot.js grew a water body: WADE (feet down, step scaled by the
       water on you) -> SWIM (prone on the live surface, stroking at a target,
       treading when it arrives) -> PANIC (a predator inside 22 m: cadence 2.25x,
       the thrash layered on top, and a heading that is the shore and the shark
       at once).
     • every stroke, every entry and the player's own strokes land on
       world/water_impact.js's momentum bus, which had no swimmer on it at all.

   BOTH COLUMNS RUN THIS SAME DRIVER. BEFORE is pristine HEAD on its own port;
   AFTER is the working tree. The island, the seed, the crowd, the staging
   points, the sim steps and the cameras are identical between them, and every
   number at the bottom is read by THIS file out of the live scene graph by a
   signature both builds share — the bodies' own positions against the game's
   own depth and surface oracles, and the rig joints both builds carry. Neither
   build's audit is trusted for a single figure.

   HARNESS TRAPS THIS FILE PAYS (both learned by shark-flesh.mjs and
   marine-predation.mjs before it, and both cost whole capture runs):
     1. stage() is SERIALIZED into the page. It carries no module scope, so
        every free identifier it names is a ReferenceError and every frame of
        the pass comes back empty. RUN is declared again inside it.
     2. The chase camera is re-stamped by camera.js at onAlways(50), INSIDE
        CBZ.stepSim. A tripod set before a step is gone by the end of it, so
        the lens is re-aimed AFTER every step, never before.
*/

const subjects = [
  {
    id: "wade-band", ch: 0,
    label: "The Beach As It Ships",
    focus:
      "The mode's own crowd, unstaged, given forty-five seconds and photographed from sixty metres out to sea looking back at the sand. THIS IS THE WEAKEST OF THE FIVE AND IT IS HERE HONESTLY: the shore ring stops at waterline + 9 m and this foreshore is 0.83 m deep there, so nobody in the BEFORE column is ever past their waist — but they are also not moving. HEAD freezes a survivor the moment it reaches its spot (see the crowd tape in this subject's debug: sixteen people in the water at t=5 s and seventeen at t=60 s, two new decisions in the whole population), so the beach is a diorama and the difference from forty-five metres is a distribution, not an event. AFTER: legs run to completion, the crowd genuinely mills between the sand and the surf (wet count 15 -> 4 -> 18 across the window as it finds its equilibrium), and the first body goes out past the shelf at t = 45 s. The three staged subjects that follow are where the change is legible; this one is the population it happens in.",
  },
  {
    id: "out-of-their-depth", ch: 1,
    label: "Ten People In Four Metres Of Water",
    focus:
      "Ten survivors put at a searched point where the column is 3.5-5 m deep, then left alone for four seconds. BEFORE: they are not in this picture. Every one of them is standing on the seabed four metres down, because the mover assigns pos.y = surv.floorAt and the separation pass re-plants anyone who drifts. AFTER: ten bodies floating at the surface, treading, riding the same swell the shader draws.",
  },
  {
    id: "on-the-seabed", ch: 2,
    label: "The Bug Itself — A Lens On The Bottom",
    focus:
      "The same ten people, same second, from a camera sitting on the seabed looking along it. This is the frame the complaint was written about. BEFORE: a line of human beings STANDING on the bottom of the ocean doing a walk cycle, arms swinging, four metres of water over their heads. AFTER: the bed is empty and the bodies are silhouettes on the surface above it.",
  },
  {
    id: "swim-for-shore", ch: 3,
    label: "Swimming For The Beach",
    focus:
      "The same ten given the beach as a target and eight seconds of swimming for it. BEFORE: they WALK there — along the seabed, at full land speed, an underwater ramble that the water neither slows nor lifts. AFTER: a crawl at the surface, ~1.15 m/s, a hand entering the water on every half cycle and world/water_impact.js sizing a real splash off it, then a wade up the shelf as the bottom comes back under them.",
  },
  {
    id: "panic", ch: 4,
    label: "A Fin At Twelve Metres",
    focus:
      "The player's own shark held twelve metres off the group in 4.5-9 m of water, and then nothing is driven — both columns are just the crowd's own brain. BEFORE: it has no idea the animal exists. Nothing in the crowd has ever reacted to a predator; they keep walking the bottom. AFTER: PANIC — the cadence goes to 2.25x, the arms come clear of the water and beat over the head, the torso rolls, and the heading is the beach and away from the shark at once. The white water round them is the same momentum bus, fired harder and more often.",
  },
];

async function stageSharkSwimmers(input) {
  const CBZ = window.CBZ, T = window.THREE, sub = input.subject;
  if (!CBZ || !T || !CBZ.stepSim || !CBZ.surv || !CBZ.bots) return { ok: false, missing: "engine" };
  /* A 20 Hz FIXED STEP, declared HERE and not at module scope: stage() is
     serialized into the page and carries no closure with it, so every free
     identifier it names is a ReferenceError in the browser.

     20 and not 60, because chapter 0 has to give the crowd forty-five seconds to
     go wherever its own brain sends it and headless-with-software-GL a single
     CBZ.stepSim over the whole island costs a few hundred milliseconds. Same
     simulated seconds for a third of the steps, and it changes nothing: every
     driver in the chain (the mover, the swim cycle, the buoyancy ease, the
     think stride) integrates dt. */
  const RUN = 1 / 20;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let D = window.__sharkSwim;
  if (!D) {
    D = window.__sharkSwim = {
      chapter: -1, waterline: 0, shot: null, group: [], anchor: null, crowdTape: [],
      beach: null, splashes: 0, wrapped: false, diag: {},

      /* THE LENS HAS TO BE RIGHT *AFTER* THE STEP, NOT BEFORE IT. camera.js
         owns the lens at onAlways(50), which is inside CBZ.stepSim — so a
         tripod set before a step is overwritten during it and the frame comes
         back down the chase camera's barrel. Re-aimed after every tick. */
      step(n) {
        for (let i = 0; i < n; i++) {
          CBZ.hitstop = 0; CBZ.slowmo = 0;
          D.holdCast();
          try { CBZ.stepSim(RUN); } catch (e) { D.diag.stepErr = String(e && e.message || e); }
          D.reshoot();
        }
      },
      sec(s) { D.step(Math.max(1, Math.round(s / RUN))); },

      // ---- the island's own oracles, asked rather than assumed -------------
      seaY(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : 0; },
      // MEAN column over the bed — the same number the mover's wade/swim
      // hysteresis reads, so a swell rolling past cannot move the ruler.
      depth(x, z) {
        return CBZ.survFloodDepthMeanAt ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : 0;
      },
      bedY(x, z) { return CBZ.surv.floorAt ? CBZ.surv.floorAt(x, z) : 0; },
      ringPoint(ang, r) {
        const A = CBZ.surv.arena;
        return { x: A.center.x + Math.cos(ang) * r, z: A.center.z + Math.sin(ang) * r };
      },
      /* WHERE THE WATER IS THE DEPTH I ASKED FOR. Searched against the game's
         own oracle rather than assumed off the waterline, because the shelf is
         not the same steepness twice and a hardcoded radius is dry sand on one
         island and open ocean on another. */
      findWater(ang, dMin, dMax) {
        let best = null;
        for (let r = Math.max(4, D.waterline - 10); r < D.waterline + 220; r += 2) {
          const p = D.ringPoint(ang, r);
          const d = D.depth(p.x, p.z);
          if (d >= dMin && d <= dMax) return { x: p.x, z: p.z, depth: d, r: r, ang: ang };
          // REFUSE TO STAGE A LIE, but keep the deepest thing seen so a shelf
          // that never reaches the asked-for band still names its own best
          // answer instead of returning null and killing the run.
          if (!best || d > best.depth) best = { x: p.x, z: p.z, depth: d, r: r, ang: ang };
        }
        return best && best.depth >= dMin * 0.6 ? best : null;
      },
      dryBeach(ang) {
        for (let r = D.waterline - 2; r > Math.max(6, D.waterline - 50); r -= 1.5) {
          const p = D.ringPoint(ang, r);
          if (D.depth(p.x, p.z) <= 0.02) return { x: p.x, z: p.z, r: r };
        }
        const p = D.ringPoint(ang, Math.max(6, D.waterline - 16));
        return { x: p.x, z: p.z, r: Math.max(6, D.waterline - 16) };
      },

      tripod(px, py, pz, tx, ty, tz) {
        const cam = CBZ.camera; if (!cam) return;
        cam.position.set(px, py, pz);
        cam.up.set(0, 1, 0);
        cam.lookAt(new T.Vector3(tx, ty, tz));
        cam.updateMatrixWorld(true);
      },
      reshoot() { const s = D.shot; if (s) D.tripod(s[0], s[1], s[2], s[3], s[4], s[5]); },
      shoot(px, py, pz, tx, ty, tz) { D.shot = [px, py, pz, tx, ty, tz]; D.tripod(px, py, pz, tx, ty, tz); },

      /* THE SHARK AND THE PLAYER RIDING IT, held. Straight out of
         bite-angles.mjs: the ride's heading is NOT the animal's `heading`
         field, it lives in a closure and is published only through
         CBZ.cityMountedHeading. */
      shark: null, sharkAt: null,
      holdCast() {
        const a = D.sharkAt, S = CBZ.sharkSim && CBZ.sharkSim.shark, P = CBZ.player;
        if (!a || !S) return;
        if (S.hp <= 1) { S.hp = S.maxHp || 100; S.dead = false; }
        S.pos.x = a.x; S.pos.z = a.z; if (a.y != null) S.pos.y = a.y;
        if (S.group) S.group.position.set(a.x, S.group.position.y, a.z);
        if (S._waterMove) { S._waterMove.x = a.x; S._waterMove.z = a.z; }
        if (P && P.pos) { P.pos.x = a.x; P.pos.z = a.z; if (a.y != null) P.pos.y = a.y; }
        if (a.h != null && CBZ.cityMountedHeading) { try { CBZ.cityMountedHeading(a.h); } catch (e) {} }
        // held targets: keeps a driven group aimed without pinning its body
        for (let i = 0; i < D.group.length; i++) {
          const b = D.group[i];
          if (!b || b.dead) continue;
          if (b._drive) { b.target.set(b._drive.x, 0, b._drive.z); b.pause = 99; }
        }
      },

      /* Everything that is not this experiment goes away. A converging pod or a
         rival shark would panic the crowd on its own timing and the two columns
         would stop being the same photograph. */
      peace() {
        const S = CBZ.sharkSim && CBZ.sharkSim.shark;
        for (const a of CBZ.cityWildlife || []) {
          if (!a || a.dead || !a.species || a === S) continue;
          a.pos.x += 1400; a.hunger = 0;
          if (a._waterMove) { a._waterMove.x = a.pos.x; a._waterMove.z = a.pos.z; }
        }
        if (CBZ.sharkSim) { CBZ.sharkSim.podT = 9000; CBZ.sharkSim.stockT = 9000; }
        const f = document.getElementById("sharkflash");
        if (f) { f.style.transition = "none"; f.style.opacity = "0"; }
      },

      /* THE SPLASH COUNTER, from OUTSIDE both builds. world/water_impact.js
         exists on HEAD too, so wrapping CBZ.waterHit measures the same thing on
         both sides: how many times a body actually told the sea it was there.
         BEFORE this is zero, because nothing in the crowd ever called it. */
      wrapSplashes() {
        if (D.wrapped) return;
        D.wrapped = true;
        const orig = CBZ.waterHit;
        if (typeof orig !== "function") return;
        /* ONLY THE BODIES. The first cut counted every waterHit in the world and
           reported 354 splashes for four seconds of ten people, which is not a
           crowd swimming, it is world/water_wake.js's rain firing `drop` hits at
           the surface every frame. The bus carries a `src` and both builds
           forward it untouched, so the honest question is "was this hit made by
           a human body" — a survivor carries `.char`, and the player is the
           player. Everything else in the sea is somebody else's splash. */
        // ...and only THIS EXPERIMENT'S bodies once a group is staged, so the
        // rest of the beach cannot pad the number either.
        CBZ.waterHit = function (x, y, z, o) {
          const s = o && o.src;
          if (s && (s.char || s === CBZ.player) &&
              (!D.group.length || D.group.indexOf(s) >= 0)) D.splashes++;
          return orig.apply(this, arguments);
        };
      },

      liveBots(n, exclude) {
        const out = [], bots = CBZ.bots || [];
        for (let i = 0; i < bots.length && out.length < n; i++) {
          const b = bots[i];
          if (!b || b.dead) continue;
          if (exclude && exclude.indexOf(b) >= 0) continue;
          out.push(b);
        }
        return out;
      },
      /* THE REST OF THE CROWD, PARKED ON DRY LAND. The first cut moved everybody
         900 units along +X, which on this island is OPEN OCEAN: eighty-nine
         survivors were dropped into deep water off the edge of the map, the
         after build correctly started every one of them swimming, and the
         splash counter — which was measuring the whole world — reported 354
         splashes for four seconds of ten people. A staging file that banishes
         its extras into the subject of the experiment is measuring itself.
         They go to the middle of the island instead, which is a hill. */
      clearCrowd(keep) {
        const bots = CBZ.bots || [], c = CBZ.surv.arena.center;
        let n = 0;
        for (let i = 0; i < bots.length; i++) {
          const b = bots[i];
          if (!b || (keep && keep.indexOf(b) >= 0)) continue;
          b.pos.x = c.x + ((n % 14) - 7) * 3;
          b.pos.z = c.z + (((n / 14) | 0) - 4) * 3;
          b.pos.y = D.bedY(b.pos.x, b.pos.z);
          b.swim = false; b._floatY = null; b.panicT = 0;
          b.pause = 9999; n++;
          if (b.target && b.target.set) b.target.set(b.pos.x, 0, b.pos.z);
        }
      },

      async boot() {
        for (let t = 0; t < 600 && !(CBZ.game.state === "playing" && CBZ.game.mode === "sharksim"); t++) {
          const mb = document.querySelector('.mode-btn[data-mode="sharksim"]');
          if (mb) mb.click();
          const pb = document.getElementById("playBtn");
          if (pb) pb.click();
          await sleep(150);
        }
        if (CBZ.game.state !== "playing") return false;
        /* ONE SEEDED STREAM FROM HERE ON. modes/shark_sim.js's restock() picks
           its top-up bodies with bare Math.random(), so without this the two
           columns get a different number of people in a different place within
           a second or two of the match starting and chapter 0's "same crowd"
           claim is false. (The crowd's OWN wander is already seeded — this is
           only for the handful of draws around it.) */
        let seed = 0x9e3779b9 >>> 0;
        Math.random = function () {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return seed / 4294967296;
        };
        for (let t = 0; t < 80 && !D.armed(); t++) { D.step(10); await sleep(20); }
        if (!D.armed()) return false;
        D.waterline = CBZ.sharkSim.waterline;
        /* From here the match advances ONLY when a chapter steps it. The
           already-queued rAF callback has to be DRAINED in a frame we control
           or it re-stamps the camera at an arbitrary later compositor tick. */
        D._rafOrig = window.requestAnimationFrame;
        const orig = D._rafOrig;
        window.requestAnimationFrame = function () { return 0; };
        await new Promise((res) => orig.call(window, () => res()));
        return true;
      },
      armed() {
        return !!(CBZ.sharkSim && CBZ.sharkSim.on && CBZ.sharkSim.shark && CBZ.bots && CBZ.bots.length);
      },
    };

    const ok = await D.boot();
    if (!ok) return { ok: false, err: "never reached a live shark sim" };
    D.wrapSplashes();
    window.__cbzVisualCompare = {
      render() { try { CBZ.renderer.render(CBZ.scene, CBZ.camera); } catch (e) {} },
    };
  }

  // ---- THE ONE RULER, applied to whatever group a chapter names -----------
  // Every figure below is a direct read of a body's own position against the
  // game's own depth/surface oracles, or of a rig joint both builds carry.
  // Nothing asks either build's audit for anything.
  /* THE POPULATION GATE IS 2.0 m, AND IT IS NOT A ROUND NUMBER FOR SHOW.
     "Standing on the bottom" and "floating on the surface" are the same place
     when the water is a body deep, and the first cut measured at 1.35 m: in
     1.4 m of water a body standing on the bed has its feet 1.40 m under, which
     is inside the ±0.55 window round swim.js's 1.275 m float line, so the BEFORE
     column scored five people "floating" who were plainly standing. Below 2.0 m
     the two states are not distinguishable by altitude and the honest thing is
     not to count them. The tests are then explicitly disjoint. */
  function measure(list) {
    const r = {
      n: 0, onTheBed: 0, atSurface: 0, pronePitch: 0, armsOverhead: 0,
      feetBelowSurfM: null, headUnderN: 0,
    };
    let sum = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || b.dead || !b.pos) continue;
      const d = D.depth(b.pos.x, b.pos.z);
      if (d < 2.0) continue;                     // see the note above
      r.n++;
      const surf = D.seaY(b.pos.x, b.pos.z);
      const below = surf - b.pos.y;              // metres from the waterline to the feet
      sum += below;
      if (below > 1.85 && below >= d - 0.45) r.onTheBed++;      // on the bottom, head under
      if (Math.abs(below - 1.275) <= 0.55 && below < d - 0.55) r.atSurface++;
      if (b.pos.y + 1.55 < surf - 0.05) r.headUnderN++;         // eyes below the waterline
      const ch = b.char;
      if (ch && ch.body && ch.body.rotation.x >= 0.25) r.pronePitch++;
      if (ch && ch.parts && ch.parts.la && ch.parts.ra &&
          Math.min(ch.parts.la.rotation.x, ch.parts.ra.rotation.x) <= -0.80) r.armsOverhead++;
    }
    // NULL, not 0, when nobody qualified: a mean of an empty set printed as 0
    // reads in the table as "their feet were at the waterline", which is the
    // opposite of what it means, and marked a whole column as a regression.
    r.feetBelowSurfM = r.n ? +(sum / r.n).toFixed(2) : null;
    return r;
  }
  function distTo(b, x, z) { return Math.hypot(b.pos.x - x, b.pos.z - z); }
  function meanDistTo(list, x, z) {
    let s = 0, n = 0;
    for (const b of list) { if (b && !b.dead && b.pos) { s += distTo(b, x, z); n++; } }
    return n ? s / n : 0;
  }

  const out = {};
  const ref = input.referenceStage || null;
  const CH = [
    /* 0 — THE BEACH AS IT SHIPS. Nothing staged at all beyond emptying the sea
       of rivals: this is the mode's own crowd on the mode's own shore ring,
       given fifteen seconds to go wherever its brain sends it. */
    async function shore() {
      D.peace();
      const ang = 0.6;                       // one fixed bearing, both columns
      D.anchor = D.findWater(ang, 3.0, 6.5) || D.findWater(ang, 1.6, 9.0);
      D.beach = D.dryBeach(ang);
      // the shark parked well clear so nothing in this chapter is a reaction
      const far = D.findWater(ang + 2.6, 4, 30) || D.anchor;
      D.sharkAt = { x: far.x, z: far.z, y: D.seaY(far.x, far.z) - 3.2, h: ang };
      /* FORTY-FIVE SECONDS, AND A TAPE. The number is measured rather than
         chosen: a survivor who draws the swim band has to cross the wade band
         before it is out of its depth, and a probe of the real match had the
         first body off its feet somewhere past half a minute from a standing
         start — twenty seconds photographed people who were still on their way.
         The tape is here because a single end-of-run census cannot tell "nobody
         swims" from "nobody had got there yet", and those want opposite fixes. */
      for (let k = 0; k < 9; k++) {
        D.sec(5);
        const a = typeof CBZ.survBotWaterAudit === "function" ? CBZ.survBotWaterAudit() : null;
        D.crowdTape.push(a ? [(k + 1) * 5, a.wet, a.swimming, a.entries] : [(k + 1) * 5]);
      }
      D.diag.crowdTape = D.crowdTape;
      const all = (CBZ.bots || []).filter((b) => b && !b.dead);
      Object.assign(out, measure(all));
      out.splashes = D.splashes;
      /* THE LENS IS OUT AT SEA LOOKING BACK AT THE SAND, and the first cut was
         not: a lens on the waterline pointed out to sea photographed one man and
         two hundred metres of empty water, because the crowd is spread round the
         WHOLE ring and a single bearing sees almost none of it. From out here
         the sand is the backdrop, the wade band is the middle ground, and
         anybody who is actually swimming is between the two — which is the only
         composition in which "how many people are past the shelf" is a thing you
         can count rather than a thing you are told. */
      const at = D.ringPoint(ang, D.waterline + 62);
      const to = D.ringPoint(ang, D.waterline - 6);
      const sy = D.seaY(at.x, at.z);
      D.shoot(at.x, sy + 15, at.z, to.x, sy + 0.5, to.z);
      D.step(2);
      D.diag.waterline = +D.waterline.toFixed(1);
      D.diag.anchorDepth = D.anchor ? +D.anchor.depth.toFixed(2) : null;
    },

    /* 1 — TEN PEOPLE IN FOUR METRES OF WATER. The group is placed and then
       LEFT ALONE: no target, no drive, pause parked so the wander brain does
       not re-aim them. What each build does with a standing body in water over
       its head is the entire experiment. */
    async function deep() {
      const A = D.anchor;
      if (!A) throw new Error("no water deep enough on this bearing");
      const group = D.liveBots(10);
      D.group = group;
      D.clearCrowd(group);
      const perp = A.ang + Math.PI / 2;
      for (let i = 0; i < group.length; i++) {
        const b = group[i];
        const off = (i - (group.length - 1) / 2) * 2.6;
        const x = A.x + Math.cos(perp) * off, z = A.z + Math.sin(perp) * off;
        b.pos.x = x; b.pos.z = z;
        b.pos.y = D.bedY(x, z);              // START ON THE BED on both sides
        b.hp = 100; b.dead = false; b.state = "wander"; b.speed = 0;
        b.target.set(x, 0, z); b.pause = 999;
        b._drive = null;
        b.group.rotation.y = perp + Math.PI;
        // thrash only. The stroke PHASE is deliberately left alone: the after
        // build offsets it per body from that body's own `reactivity` draw so a
        // line of swimmers is not synchronised swimming, and zeroing it here
        // would photograph exactly the artefact that offset exists to prevent.
        if (b.swimAnim) b.swimAnim.thrash = 0;
        b.swim = false; b._floatY = null;
      }
      D.splashes = 0;
      D.sec(4);
      Object.assign(out, measure(group));
      out.splashes = D.splashes;
      // ABOVE the swell, looking down the line: before, this is empty water.
      const sy = D.seaY(A.x, A.z);
      const eye = D.ringPoint(A.ang, A.r - 14);
      D.shoot(eye.x, sy + 3.0, eye.z, A.x, sy - 0.5, A.z);
      D.step(2);
      D.diag.groupDepth = +D.depth(A.x, A.z).toFixed(2);
    },

    /* 2 — THE SAME SECOND, FROM THE BOTTOM. Same bodies, same tick count, a
       lens sitting on the seabed. Nothing is re-staged; only the camera moves,
       which is what makes this the same photograph from underneath. */
    async function bottom() {
      const A = D.anchor;
      const sy = D.seaY(A.x, A.z);
      /* SEAWARD, NOT INSHORE AND NOT ALONGSHORE. Two cuts of this lens were
         buried in sand. A.r - 11 put it eleven metres closer to the beach where
         the shelf is metres HIGHER; offsetting perpendicular at the same radius
         assumed the bed holds its height along a contour, and on a generated
         island it does not — it hit a dune. The only direction that is
         GUARANTEED deeper than the subject is further out, so the tripod sits
         eighteen metres seaward on the same bearing and looks back inshore, with
         the shelf rising away behind the group. Its altitude is clamped above
         the bed under its own feet and below the live surface, so it can neither
         bury itself nor surface on a swell. */
      const eye = D.ringPoint(A.ang, A.r + 18);
      const ex = eye.x, ez = eye.z;
      const eBed = D.bedY(ex, ez);
      /* WELL UNDER, AND AIMED AT THE FLOAT LINE. A lens a metre below the
         surface put the sea's own underside across the middle of the frame and
         the shot read as a beach under a sky. Three and a half metres down,
         aimed where a floating body sits, puts the surface plainly ABOVE the
         subject: the before column is then people standing on the bottom with
         metres of water over them and the after column is the same people up
         against that ceiling. */
      const eyeY = Math.max(eBed + 1.2, D.seaY(ex, ez) - 3.4);
      D.shoot(ex, eyeY, ez, A.x, D.seaY(A.x, A.z) - 1.5, A.z);
      D.step(2);
      D.diag.bottomEyeY = +eyeY.toFixed(2);
      D.diag.bottomBedY = +eBed.toFixed(2);
      D.diag.bottomSurfY = +sy.toFixed(2);
    },

    /* 3 — SWIMMING FOR THE BEACH. One target, held on both sides, ten seconds.
       The metric is how much of the distance to the sand each column closed and
       what it cost the sea in splashes. */
    async function toShore() {
      const B = D.beach;
      D.splashes = 0;
      for (const b of D.group) { b._drive = { x: B.x, z: B.z }; b.pause = 0; b.state = "wander"; }
      out.startFromBeachM = +meanDistTo(D.group, B.x, B.z).toFixed(2);
      /* READ IT EARLY, NOT AT THE END. The target is the beach, so a crossing
         ENDS in the wade band by construction and a body count taken there is a
         measurement of standing up rather than of swimming. Measured at four
         seconds the population was already ZERO ON BOTH SIDES — the before
         column WALKS at 2-3 m/s and was on the sand, the after column had
         crawled into 2 m of water — so the census is taken at a second and a
         half, when both columns are still where they started, and the distance
         gain below is still the whole eight seconds. */
      D.sec(1.5);
      Object.assign(out, measure(D.group));
      D.sec(6.5);
      out.shoreGainM = +(out.startFromBeachM - meanDistTo(D.group, B.x, B.z)).toFixed(2);
      out.splashes = D.splashes;
      /* THE LENS IS ON THE CORRIDOR, NOT ON THE BODIES. Framing on the live
         centroid frames a DIFFERENT PLACE in each column — the whole claim here
         is that the two columns end up somewhere different — so the shot is
         pinned to the fixed volume the crossing happens in: the midpoint of the
         line from where they started to the sand they were sent to, viewed from
         the side. Whoever is in that volume is in the picture, which is the
         comparison. */
      const A = D.anchor;
      const mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2;
      const sy = D.seaY(mx, mz);
      const side = A.ang + Math.PI / 2;
      D.shoot(mx + Math.cos(side) * 24, sy + 9.5, mz + Math.sin(side) * 24,
        mx, sy - 0.3, mz);
      D.step(2);
    },

    /* 4 — A FIN AT TWELVE METRES. The shark is HELD; nothing else is driven.
       Both columns are the crowd's own brain answering an animal in the water
       with them, and one of the two columns has no answer at all. */
    async function panic() {
      let n = 0;
      for (const b of D.group) if (!b.dead) n++;
      if (!n) throw new Error("the group did not survive to the panic chapter");
      /* PUT THEM BACK, AND FURTHER OUT. The answer to a shark has to be a SWIM,
         and measured: from the 3.5 m anchor a fleeing body covers 2.1 m/s x the
         window and is in the shallows before the shutter opens — the first cut
         of this chapter photographed ten people jogging up a beach, which is a
         true thing that happened and not the thing being claimed. Staged where
         the column is 4.5-9 m so the whole window is spent in real water. */
      const A = D.findWater(D.anchor.ang, 4.5, 9.0) || D.anchor;
      D.deepAnchor = A;
      const perp = A.ang + Math.PI / 2;
      for (let i = 0; i < D.group.length; i++) {
        const b = D.group[i];
        const off = (i - (D.group.length - 1) / 2) * 2.6;
        const x = A.x + Math.cos(perp) * off, z = A.z + Math.sin(perp) * off;
        b.pos.x = x; b.pos.z = z; b.pos.y = D.bedY(x, z);
        b.hp = 100; b.dead = false; b.state = "wander"; b.speed = 0;
        b._drive = null; b.target.set(x, 0, z); b.pause = 999;
        b.swim = false; b._floatY = null;
        if (b.swimAnim) b.swimAnim.thrash = 0;
      }
      D.sec(3);                                    // let them settle / float up
      // the shark, twelve metres seaward of the line, nose on them
      const sx = A.x + Math.cos(A.ang) * 12, sz = A.z + Math.sin(A.ang) * 12;
      D.sharkAt = { x: sx, z: sz, y: D.seaY(sx, sz) - 1.6, h: A.ang + Math.PI };
      for (const b of D.group) { b.pause = 0; }
      D.splashes = 0;
      out.startFromSharkM = +meanDistTo(D.group, sx, sz).toFixed(2);
      /* THE CENSUS IS MID-FLIGHT AND THE DISTANCE IS THE WHOLE WINDOW. A body
         that panics well is a body that is GONE, and at the end of 4.5 s the
         after column had swum itself out of the measurable population entirely
         (n = 0) while the before column, which cannot see the animal, sat in
         five metres of water and scored nine. Reading the bodies at 1.5 s —
         thrashing, still out there — and the distance at 4.5 s measures the
         panic and its result instead of one at the cost of the other. */
      D.sec(1.5);
      Object.assign(out, measure(D.group));
      let rollSum = 0, rollN = 0;
      for (const b of D.group) {
        if (!b || b.dead || !b.char || !b.char.body) continue;
        rollSum += Math.abs(b.char.body.rotation.z); rollN++;
      }
      out.rollDeg = rollN ? +(rollSum / rollN * 57.2958).toFixed(1) : 0;
      D.sec(3);
      out.fleeGainM = +(meanDistTo(D.group, sx, sz) - out.startFromSharkM).toFixed(2);
      out.splashes = D.splashes;
      /* BACK OFF AND GET UP. The first cut put the tripod fifteen metres inshore
         of the line at 2.6 m — inside the group — so two enormous torsos filled
         the frame and the animal the whole subject is about was behind the lens.
         The shot has to hold the line of people AND the shark twelve metres past
         it, which is a 30 m subject: 30 m off to the side and 13 m up, aimed at
         the midpoint of the two. Pinned to the staged geometry, not to the
         bodies, so both columns frame the same water. */
      const mx = (A.x + sx) / 2, mz = (A.z + sz) / 2;
      const sy = D.seaY(mx, mz);
      const side = A.ang + Math.PI / 2;
      D.shoot(mx + Math.cos(side) * 23, sy + 9.5, mz + Math.sin(side) * 23,
        mx, sy - 0.6, mz);
      D.step(2);
    },
  ];

  while (D.chapter < sub.ch) {
    D.chapter++;
    await CH[D.chapter]();
  }

  /* THE AFTER COLUMN REUSES THE BEFORE COLUMN'S LENS. Every camera above is
     computed from deterministic geometry (a fixed bearing, the searched water
     anchor, the arena centre) so the two sides agree by construction — but a
     body that moved differently moves the "follow them" lenses, and a pair
     framed on two different places is not a pair. The before side's camera
     wins wherever the harness hands one over. */
  if (ref && ref.camera && ref.camera.shot) { D.shot = ref.camera.shot.slice(); D.reshoot(); }

  // hide the HUD: the claim here is about bodies in water, and the mode's own
  // corner furniture in shot would only make that harder to read.
  const canvas = CBZ.renderer && CBZ.renderer.domElement;
  for (const child of Array.from(document.body.children)) {
    if (child === canvas || (canvas && child.contains && child.contains(canvas))) continue;
    child.style.visibility = "hidden";
  }
  await window.__cbzVisualCompare.render();

  return {
    ok: true, side: input.side, chapter: sub.ch,
    camera: { shot: D.shot ? D.shot.slice() : null },
    debug: {
      state: CBZ.game.state, mode: CBZ.game.mode,
      diag: D.diag,
      bots: (CBZ.bots || []).length,
      group: D.group.length,
      water: typeof CBZ.survBotWaterAudit === "function" ? CBZ.survBotWaterAudit() : null,
    },
    metrics: out,
  };
}

export default {
  id: "shark-swimmers",
  title: "Shark Sim — The People In The Sea Were Walking On The Bottom Of It",
  description:
    "Five beats of the same crowd, photographed in Shark Sim on both builds. BEFORE is pristine HEAD; " +
    "AFTER is the working tree; the island, the seed, the crowd, the staging points, the sim steps and " +
    "the cameras are identical. The owner asked why the humans in the shark game do not swim when the " +
    "nat-disaster game's swimming is real — and the answer is that they are the SAME GAME and the good " +
    "swimmer (city/swim.js: graduated submergence, drag-first velocity, a buoyancy oscillator on the live " +
    "wave surface, a crawl that blends to a tread) was PLAYER-ONLY. Everyone else ran a mover whose last " +
    "two lines were `pos.y = surv.floorAt(...)` and `animChar(...)` — the raw seabed height and the land " +
    "walk cycle — while the crowd separation pass at order 26 re-planted anyone who drifted off the " +
    "bottom. A second finding made it a feature rather than a fix: the mode's shore ring stops at " +
    "waterline + 9 m and this foreshore is 0.83 m deep there, so NOBODY in Shark Sim could ever have " +
    "been swimming. After: one swim cycle in entities/character.js drives the player and all ninety-nine " +
    "survivors, the crowd wades, swims and PANICS off one depth query, a wet body draws a swim leg forty times more often than a dry one and goes out past the " +
    "shelf on a radius searched against the arena's own bathymetry, and every stroke — the player's " +
    "included — lands on world/water_impact.js's momentum bus, which had no swimmer on it at all.",
  beforeLabel: "BEFORE · pristine HEAD",
  afterLabel: "AFTER · working tree",
  pairNote: "Same island · same seed · same crowd · same staging points · same sim seconds · same cameras",
  method:
    "Both columns boot index.html into ?mode=sharksim with a pinned seed and click the Shark Sim tile + " +
    "PLAY exactly like a player. A per-page driver freezes the frame loop (draining the one already-queued " +
    "rAF callback, or it re-stamps the camera at an arbitrary later compositor tick), empties the sea of " +
    "rivals and pods, and then either leaves the mode's own crowd entirely alone (chapter 0) or stands ten " +
    "survivors at a point SEARCHED against the arena's own bathymetry for 3.5-5 m of water. Nothing drives " +
    "a body: the group is given a target at most, and the panic chapter drives nothing at all — the shark " +
    "is held twelve metres off and both columns are just the crowd's own brain answering it. The lens is " +
    "re-aimed AFTER every CBZ.stepSim, never before, because camera.js owns it at onAlways(50) from inside " +
    "the step. Every number is read by this preset out of the live scene graph — each body's own position " +
    "against CBZ.survFloodDepthMeanAt and CBZ.citySeaHeightAt, and the rig joints both builds carry — plus " +
    "a wrapper on CBZ.waterHit, which exists on HEAD too. Neither build's own audit is trusted for a figure.",
  beforeParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  afterParams: { mode: "sharksim", seed: "90210", cfg_BOOT_METER: "0" },
  stageTimeoutMs: 900000,
  viewport: { width: 1280, height: 720 },
  readyExpression:
    "window.THREE && window.CBZ && CBZ.game && CBZ.stepSim && CBZ.surv && CBZ.bots && CBZ.citySeaHeightAt && CBZ.survFloodDepthMeanAt && document.getElementById('playBtn')",
  subjects,
  stage: stageSharkSwimmers,
  metrics: {
    n: { label: "Bodies measured (in water over 2.0 m deep)", unit: "people" },
    onTheBed: { label: "…STANDING ON THE SEABED under that water", unit: "people", better: "lower" },
    atSurface: { label: "…floating on the surface (swim.js's float line ±0.6 m)", unit: "people", better: "higher" },
    feetBelowSurfM: { label: "Mean depth of a body's feet below the waterline", unit: "m", better: "lower" },
    headUnderN: { label: "…with their eyes under the water", unit: "people", better: "lower" },
    pronePitch: { label: "Bodies pitched prone / treading (a swimmer's torso)", unit: "people", better: "higher" },
    armsOverhead: { label: "Bodies with an arm above the shoulder (a stroke)", unit: "people", better: "higher" },
    splashes: { label: "Splashes the bodies put on the momentum bus", unit: "hits", better: "higher" },
    // NO DIRECTION ON THIS ONE, DELIBERATELY. Walking is faster than swimming
    // and always will be, so a crossing that used to be a 20 m underwater
    // ramble at land speed becomes an 8 m crawl — the number going DOWN is the
    // feature landing, and marking it "higher is better" made the correct
    // result print as a regression. It is a description, so it prints as one.
    shoreGainM: { label: "Mean metres of beach closed in 8 s (walk vs crawl)", unit: "m" },
    fleeGainM: { label: "Mean metres gained on the shark in 4.5 s", unit: "m", better: "higher" },
    rollDeg: { label: "Mean torso roll while the shark is there", unit: "deg", better: "higher" },
  },
  metricsNote:
    "onTheBed is the bug as one number: living human beings standing on the bottom of the sea with more " +
    "than a body height of water over them. It has to reach zero, and not by deleting anybody — `n` is the " +
    "same population counted, and atSurface must rise by what onTheBed loses. feetBelowSurfM is the same " +
    "fact as a distance: before it is the depth of the water, after it is 1.28 m, which is the resting " +
    "float depth city/swim.js has always settled the player at. splashes is measured from OUTSIDE both " +
    "builds by wrapping CBZ.waterHit — the bus exists on HEAD, it simply had no swimmer on it, so BEFORE " +
    "is zero because nothing in the crowd ever called it. fleeGainM and shoreGainM are honest distances " +
    "between two ticks, not intentions. THE PICTURES ARE THE TEST; these numbers only say whether the " +
    "thing in the picture happened at all.",
};
