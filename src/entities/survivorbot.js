/* ============================================================
   entities/survivorbot.js — the ~99 AI survivors (SURVIVAL mode).

   Reuses the FPS engine's character rig (makeCharacter) and procedural
   locomotion (animChar) — proving the thesis that the movement/animation
   foundation makes a crowd game cheap. The 4800-line prison brain is NOT
   loaded; bots run a lean FSM: WANDER → FLEE (disaster) → PANIC (a
   predator in the water with them) → DEAD. They take damage from the
   same disasters as the player, so eliminations happen naturally with
   no bot-vs-bot combat.

   AND THEY ARE BODIES IN WATER, NOT WALKERS UNDER IT. See the block at
   THE CROWD CAN SWIM below: wading, swimming and panic all come off the
   same depth query, the stroke is entities/character.js's shared swim
   cycle (the player's own), and every stroke lands on
   world/water_impact.js's momentum bus.

   Perf for 100 actors on r128/browser:
     • LOD     — bots far from camera skip animChar (freeze pose).
     • slicing — the brain re-decides every few frames (round-robin by
                 index); locomotion still integrates every frame.
     • grid    — O(n) spatial-hash separation instead of O(n²).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const { makeCharacter, animChar, lerpAngle, damp } = CBZ;

  const BOT_RADIUS = 0.5;
  const ANIM_DIST2 = 62 * 62;     // beyond this, freeze animation
  let frame = 0;

  /* ============================================================
     THE CROWD CAN SWIM.

     Every survivor's mover used to end in these two lines:

         b.pos.y = CBZ.surv.floorAt(b.pos.x, b.pos.z);
         animChar(b.char, b.speed, dt);

     — the RAW SEABED HEIGHT and the LAND WALK CYCLE, with no idea that water
     exists. So in Shark Sim the people in the sea were not swimming badly,
     they were walking on the bottom of it: a land gait, feet planted on the
     bed, the water closing over their heads as the shelf fell away. The whole
     premise of the mode is a crowd in the water and none of them were in it.

     The swimmer this game already has is city/swim.js's, and it is very good —
     graduated submergence, drag-first velocity, a buoyancy oscillator on the
     live wave surface. It is also PLAYER-ONLY and always was. Nothing here
     re-implements it:

       • the STROKE is character.js's shared cycle (CBZ.makeSwimAnim /
         swimAnimStep / poseSwimmer) — the same joints the player swims with,
         because a body is a body;
       • the WATER is asked of the same oracles the player's swimmer asks —
         CBZ.citySeaHeightAt for the live crest, CBZ.survFloodDepthMeanAt for
         the column over the bed (MEAN, so a swell rolling past cannot flip a
         body between wading and swimming several times a second);
       • the SPLASH is world/water_impact.js's momentum bus, the same one the
         player now strokes into.

     What IS this file's own is the three-state body: WADE (feet down, walk
     slowed by the water on you) -> SWIM (prone at the surface, stroking at a
     target) -> PANIC (a shark is in the water with you). The numbers below are
     city/swim.js's own thresholds, deliberately shared so a bot and the player
     stop wading at the same depth.
     ============================================================ */
  const BODY_H = 1.7;             // physics.js's body height — the submergence unit
  const SWIM_ENTER = 1.35;        // swim.js SWIM_DEPTH: this deep and you are off your feet
  const SWIM_LEAVE = 1.05;        // swim.js STAND_DEPTH: shallower and you get them back
  const WADE_SLOW = 0.58;         // swim.js: fraction of the step the water takes
  const FLOAT_DEPTH = 1.275;      // swim.js: feet below the surface on a floating body
  const SWIM_SPEED = 1.15;        // m/s — an unhurried survivor's crawl
  const PANIC_SPEED = 2.10;       // m/s — everything they have
  const WATER_TURN = 0.05;        // per-second retention: a body turns slowly in water
  const PANIC_R = 22;             // m — a predator this close and you stop swimming
  const PANIC_HOLD = 5;           // s — you do not calm down the instant the fin turns

  function seaAt(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -1e9; }
  function bedAt(x, z) { return CBZ.surv ? CBZ.surv.floorAt(x, z) : 0; }
  // Metres of water over the bed here, measured against MEAN sea level.
  function waterDepth(x, z) {
    if (CBZ.survFloodDepthMeanAt) return Math.max(0, CBZ.survFloodDepthMeanAt(x, z));
    return Math.max(0, seaAt(x, z) - bedAt(x, z));
  }

  /* WHO IS IN THE WATER WITH THEM — one list, rebuilt on a slow cadence.
     Scanning the whole bestiary per bot per frame is a hundred scans of an
     array that changes about twice a second; the honest shape is ONE small
     array of things that could eat you (typically three or four: the ridden
     shark, its rivals, an orca pod), rebuilt every REFRESH frames and then
     read by a handful of distance tests inside the brain — which is itself
     already on a 3-or-7 frame stride. */
  const threats = [];
  const THREAT_REFRESH = 12;      // frames (~0.2s at 60Hz)
  function refreshThreats() {
    threats.length = 0;
    const list = CBZ.cityWildlife;
    if (!list) return;
    const ridden = CBZ.sharkSim && CBZ.sharkSim.shark;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a.dead || !a.pos || !a.species) continue;
      if (!a.species.aquatic) continue;
      // danger >= 0.5 is wildlife_species.js's own "charges and bites" line.
      // The player's own shark is ALWAYS a threat regardless of what it is
      // riding as, because that is the animal this whole mode is about.
      if (a !== ridden && !(+a.species.danger >= 0.5)) continue;
      threats.push(a);
    }
  }
  function nearestThreat(x, z) {
    let best = null, bd = PANIC_R * PANIC_R;
    for (let i = 0; i < threats.length; i++) {
      const a = threats[i];
      const dx = a.pos.x - x, dz = a.pos.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  }

  /* THE SPLASH BUDGET. water_impact.js sizes and plays every hit it is given;
     thirty panicking swimmers at two strokes a second would give it sixty. The
     VFX are pooled and cheap and stay — the AUDIO is what would turn a beach
     into white noise, so `quiet` is spent on a small budget near the camera and
     everything else splashes silently. */
  let splashes = 0, entries = 0;
  let audibleT = 0, audibleN = 0;
  function audible(x, z) {
    const cam = CBZ.camera;
    if (!cam) return false;
    const dx = x - cam.position.x, dz = z - cam.position.z;
    if (dx * dx + dz * dz > 30 * 30) return false;
    const now = CBZ.now || 0;
    if (now - audibleT > 1000) { audibleT = now; audibleN = 0; }
    if (audibleN >= 3) return false;
    audibleN++;
    return true;
  }
  // A hand going in. Momentum-true: a forearm at stroke speed, not a body.
  function strokeSplash(b, surf, panic) {
    if (!CBZ.waterHit) return;
    CBZ.waterHit(b.pos.x, surf, b.pos.z, {
      kind: "body",
      mass: panic ? 16 : 6,
      speed: panic ? 3.6 : 2.1,
      quiet: !audible(b.pos.x, b.pos.z),
      src: b,
    });
    splashes++;
  }
  // Leaving your feet: a whole body's worth of water displaced at once.
  function entrySplash(b, surf) {
    if (!CBZ.waterHit) return;
    CBZ.waterHit(b.pos.x, surf, b.pos.z, {
      kind: "body", mass: 78, speed: 2.6,
      quiet: !audible(b.pos.x, b.pos.z), src: b,
    });
    splashes++; entries++;
  }

  // bright Roblox-lobby palette so the crowd reads as 100 distinct players
  const SKIN = [0xf0c39a, 0xe8b58c, 0xc08a5a, 0x8a5a3a, 0x6b4a32, 0xd8a177, 0xf2cbb0];
  const HAIR = [0x2a2018, 0x4a3526, 0x101820, 0xb9b1a6, 0x7a4a2e, 0x222222, 0xdedede];
  const OUTFIT = [0xff5b5b, 0x4f9dff, 0x44d07a, 0xffd166, 0xc792ea, 0xff9e6b, 0x66d9c0,
                  0xf06b9b, 0x5b8bff, 0xff7a1a, 0x39d0c0, 0xe85d8a, 0x7ed957, 0xb07aff];
  function pick(a, r) { return a[(r * a.length) | 0]; }

  // ---- survivor NAMES (so the lobby reads like 100 real players, not props) ----
  const FIRST = [
    "Liam", "Mia", "Noah", "Ava", "Kai", "Zoe", "Leo", "Ivy", "Max", "Ada",
    "Finn", "Cleo", "Ravi", "Yuki", "Omar", "Nina", "Jude", "Wren", "Theo", "Iris",
    "Hugo", "Vera", "Eli", "Luna", "Cy", "Remy", "Sol", "Ona", "Reed", "Lux",
    "Beau", "Esme", "Tariq", "Faye", "Nico", "Indira", "Dane", "Pia", "Arlo", "Suki",
    "Cole", "Mara", "Kofi", "Tess", "Bodhi", "Anya", "Dex", "Lena", "Roman", "Quinn",
    "Soren", "Dahlia", "Ezra", "Noor", "Gus", "Vivi", "Mateo", "Saoirse", "Knox", "Wynn",
  ];
  const LAST_I = "ABCDEFGHJKLMNPRSTVW";
  function pickName(r) { return pick(FIRST, r()) + " " + LAST_I[(r() * LAST_I.length) | 0] + "."; }

  function makeBot(x, z, r) {
    const outfit = pick(OUTFIT, r());
    const skin = pick(SKIN, r());
    const ch = makeCharacter({
      legs: pick(OUTFIT, r()), torso: outfit, collar: outfit, arms: outfit,
      skin: skin, hair: pick(HAIR, r()), shoes: 0x2b2b2b,
    });
    const gy = CBZ.surv ? CBZ.surv.floorAt(x, z) : 0;
    ch.group.position.set(x, gy, z);
    ch.group.rotation.y = r() * 6.28;
    const name = pickName(r);
    const b = {
      char: ch, group: ch.group, pos: ch.group.position,
      name: name, tag: null, outfit: outfit, skin: skin,
      hp: 100, dead: false, deadT: 0, culled: false,
      baseSpeed: 2.0 + r() * 1.0, speed: 0,
      target: new THREE.Vector3(x, 0, z),
      pause: 0, state: "wander", isPlayer: false,
      slice: (r() * 6) | 0,   // think phase offset
      // Temperament and possessions are deliberately independent. Survival
      // only uses the reaction memory today; richer shared verbs can read the
      // same inventory later without changing the contact model.
      reactivity: r(),
      inventory: { medkit: r() < 0.12, lighter: r() < 0.18 },
    };
    return b;
  }

  /* THE CROWD'S OWN STREAM. Every draw a bot makes after it exists — where it
     wanders, how long it stands still — comes from here, reseeded once per
     match so two clients on one seed watch the same hundred people. The bots
     are ticked in array order every tick, so the sequence is the same on both
     ends. (Their APPEARANCE still comes from the spawn LCG below, which was
     already deterministic.) */
  let botRng = null;
  function brnd() { return botRng ? botRng() : Math.random(); }
  let matchNo = 0;

  CBZ.spawnSurvivorBots = function (n) {
    CBZ.clearSurvivorBots();
    const arena = CBZ.buildDisasterArena();
    botRng = CBZ.seedStream ? CBZ.seedStream("surv-crowd-" + (++matchNo)) : null;
    /* THE THINK SCHEDULE STARTS AT THE MATCH, NOT AT THE PAGE.

       `frame` is what decides which bots think on which tick
       ((frame + b.slice) % stride), and it counted every update since the page
       loaded — so which bots thought on tick 1 of a match depended on how many
       frames the TITLE SCREEN had rendered first. Two clients that took
       different times to boot ran different crowds from the first tick, which
       is what tools/determinism-check.mjs kept catching and why the answer
       moved between runs. Zeroed with the crowd it schedules. */
    frame = 0;
    if (CBZ.fixedStep) CBZ.fixedStep.tick = 0;
    let s = 7 + n;
    const rr = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < n; i++) {
      const p = arena.randomPoint(10, arena.radius * 0.8);
      const b = makeBot(p.x, p.z, rr);
      arena.root.add(b.group);
      CBZ.bots.push(b);
    }
  };

  /* WHAT THE CROWD'S SCHEDULE IS DOING. Both numbers are match state that no
     one outside this file could see, and both have already been a divergence:
     `frame` decides which bots think on which tick, and `matchNo` names the
     seeded stream they wander on. tools/determinism-check.mjs reads them, so a
     drift between two clients names itself instead of showing up as ninety-nine
     bodies in the wrong places. */
  CBZ.survBotAudit = function () {
    return { frame: frame, matchNo: matchNo, bots: CBZ.bots.length, seeded: !!botRng };
  };

  /* THE CROWD'S WATER LIFE AS NUMBERS. `onBed` is the bug this block exists to
     kill: living bodies standing on the seabed with more than a body height of
     water over them. It has to read 0. `surfaced` is the same population seen
     from the other side — how many of the people who are out of their depth are
     actually AT the surface. */
  CBZ.survBotWaterAudit = function () {
    const bots = CBZ.bots || [];
    let wet = 0, swimming = 0, panicking = 0, deep = 0, onBed = 0, surfaced = 0;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (!b || b.dead || !b.pos) continue;
      const d = waterDepth(b.pos.x, b.pos.z);
      if (d > 0.25) wet++;
      if (b.swim) swimming++;
      if (b.state === "panic" || b.panicT > 0) panicking++;
      if (d < SWIM_ENTER) continue;
      deep++;
      const surf = seaAt(b.pos.x, b.pos.z);
      if (b.pos.y <= surf - d + 0.35) onBed++;
      if (Math.abs(b.pos.y - (surf - FLOAT_DEPTH)) <= 0.6) surfaced++;
    }
    return {
      wet: wet, swimming: swimming, panicking: panicking,
      deep: deep, onBed: onBed, surfaced: surfaced,
      threats: threats.length, splashes: splashes, entries: entries,
    };
  };

  /* THE SHARK SIM'S LARDER: one bot, at a stated point, mid-match. It joins
     the same array, the same wander stream and the same think schedule as
     the drop's own crowd — makeBot IS the spawner, this is just a door to
     it for a mode that restocks what gets eaten. stats.total keeps the
     spectate line honest about how many people this match has seen. */
  CBZ.spawnSurvivorBotAt = function (x, z) {
    const arena = CBZ.buildDisasterArena();
    const b = makeBot(x, z, brnd);
    arena.root.add(b.group);
    CBZ.bots.push(b);
    if (CBZ.surv && CBZ.surv.stats) CBZ.surv.stats.total++;
    return b;
  };

  CBZ.clearSurvivorBots = function () {
    for (const b of CBZ.bots) {
      if (b.group) {
        if (b.group.parent) b.group.parent.remove(b.group);
        b.group.traverse(function (o) {
          // characters now share cached geometry + materials (world/materials.js)
          // across the whole crowd — NEVER dispose anything tagged `_shared`, or
          // every other actor loses it. Only the per-actor head material is fresh.
          if (o.geometry && !o.geometry._shared && o.geometry.dispose) try { o.geometry.dispose(); } catch (e) {}
          if (o.material) { const m = o.material; if (Array.isArray(m)) m.forEach((x) => x && !x._shared && x.dispose && x.dispose()); else if (!m._shared && m.dispose) m.dispose(); }
        });
      }
    }
    CBZ.bots.length = 0;
  };

  /* HOW FAR OUT YOU HAVE TO SWIM BEFORE YOU ARE SWIMMING. Walked outward along
     one bearing against the arena's own bathymetry rather than assumed, because
     the shelf is not the same steepness twice and a hardcoded "waterline + 25"
     is dry sand on one island and open ocean on another. Returns 0 when this
     bearing has no swimmable water in reach (a lagoon, a spit) and the caller
     falls back to the wade band. Cached per bearing bucket for a second: the
     seabed does not move and this is the only place in the file that probes it
     more than once. */
  const _swimR = new Float32Array(32);
  const _swimRT = new Float32Array(32);
  function swimmableRadius(ring, ang) {
    const k = ((ang / 6.28318) * 32 | 0) & 31;
    const now = CBZ.now || 0;
    if (_swimRT[k] && now - _swimRT[k] < 4000) return _swimR[k];
    const wl = ring.wl != null ? ring.wl : ring.r1;
    const cs = Math.cos(ang), sn = Math.sin(ang);
    let found = 0;
    for (let r = wl; r <= wl + 90; r += 3) {
      if (waterDepth(ring.cx + cs * r, ring.cz + sn * r) >= SWIM_ENTER + 0.55) { found = r; break; }
    }
    _swimR[k] = found; _swimRT[k] = now || 1;
    return found;
  }

  /* YOU GO WHERE YOU DECIDED TO GO.

     `pause` was doing two jobs and doing neither: it was the dwell AND the
     leg's whole lifetime. A target is tens of metres away and pause is 0.6-2.8
     s, so a body never arrived anywhere — it took 1.7 s of one heading, then
     1.7 s of another, for the whole match. Three things fall out of that, all
     measured on HEAD:

       • a swim leg is abandoned a metre and a half into the wade, every time,
         so nobody in this mode could reach swimmable water;
       • the average of headings drawn uniformly round a circle points at the
         island's CENTRE, so the crowd is under a constant inland pull;
       • and the only reason the beach did not visibly empty is the arrival
         freeze in move() below, which pinned every body that ever reached a
         target and stopped it deciding anything again.

     So `pause` is now only the DWELL — how long you stand where you got to —
     and this is the leg: you keep going until you are there (or until the leg
     clock says you plainly cannot get there, which is what stops a body
     walking into a rock for the rest of the match). */
  function committed(b) {
    if (b.pause < -45) return false;                 // gave up: it cannot get there
    const dx = b.target.x - b.pos.x, dz = b.target.z - b.pos.z;
    return dx * dx + dz * dz >= 1;                   // still on its way
  }

  // ---- the lean brain: decide target + state ----
  function think(b) {
    if (b.dead) return;
    let fx = 0, fz = 0, urgent = 0;

    /* A SHARK IN THE WATER WITH YOU OUTRANKS EVERY OTHER REASON TO MOVE, and
       it is the only reason in this file that is not weather. It sits above
       the disaster vector deliberately: a tsunami is a direction, a shark is
       a bearing you keep checking.

       The flee heading is the SHORE and the shark at once. Shore alone swims
       you straight through the animal when it is between you and the beach;
       away-from-shark alone swims you out to sea, which is worse than being
       bitten. Weighted toward the beach because that is where the water ends.

       (No brnd() is drawn on this path, exactly like the disaster branch below
       — the wander stream's DRAW COUNT is match state and only the wander
       branch may spend from it.) */
    if (b.wet) {
      const foe = nearestThreat(b.pos.x, b.pos.z);
      if (foe) { b.panicT = PANIC_HOLD; b.foe = foe; }   // move() bleeds it back down
      if (b.panicT > 0) {
        const a = b.foe && !b.foe.dead ? b.foe : null;
        let ax = 0, az = 0;
        if (a) {
          ax = b.pos.x - a.pos.x; az = b.pos.z - a.pos.z;
          const am = Math.hypot(ax, az) || 1; ax /= am; az /= am;
        }
        const ring = CBZ.sharkSimShoreRing;
        const cx = ring ? ring.cx : (CBZ.surv && CBZ.surv.arena ? CBZ.surv.arena.center.x : b.pos.x);
        const cz = ring ? ring.cz : (CBZ.surv && CBZ.surv.arena ? CBZ.surv.arena.center.z : b.pos.z);
        let sx = cx - b.pos.x, sz = cz - b.pos.z;
        const sm = Math.hypot(sx, sz) || 1; sx /= sm; sz /= sm;
        let gx = sx + ax * 0.85, gz = sz + az * 0.85;
        const gm = Math.hypot(gx, gz) || 1;
        b.state = "panic";
        b.urg = 1;
        b.pause = 0;
        b.target.set(b.pos.x + (gx / gm) * 30, 0, b.pos.z + (gz / gm) * 30);
        return;
      }
    } else if (b.panicT > 0) { b.panicT = 0; b.foe = null; }

    // run from the active disaster (there are no zones — the hazard itself
    // is the only pressure a survivor reacts to)
    if (CBZ.disasters) {
      const fv = CBZ.disasters.fleeVector(b.pos.x, b.pos.z);
      if (fv) { fx += fv.x * (0.6 + fv.w); fz += fv.z * (0.6 + fv.w); urgent = Math.max(urgent, fv.w); }
    }

    if (fx || fz) {
      const m = Math.hypot(fx, fz);
      b.state = urgent > 0.35 ? "flee" : "move";
      b.urg = urgent;                 // move() turns this into a visible sprint
      // aim at a point well ahead in the safe direction
      const reach = 14 + urgent * 16;
      b.target.set(b.pos.x + (fx / m) * reach, 0, b.pos.z + (fz / m) * reach);
      b.pause = 0;
    } else {
      // wander the island
      b.state = "wander";
      b.urg = 0;
      if (b.pause <= 0 && !committed(b)) {
        const arena = CBZ.surv.arena;
        /* SEEDED, because where ninety-nine people wander is match state, not
           decoration: on Math.random two clients on the same seed had a
           different crowd within one second of the drop. brnd() is the match's
           own stream, reseeded in spawnSurvivorBots. The shark-sim ring below
           draws the same two numbers from the same stream, so flipping the
           mode never desyncs a seed. */
        const ring = CBZ.sharkSimShoreRing;   // shark sim: the crowd lives on the sand
        const a = brnd() * 6.28;
        if (ring) {
          /* ONE DRAW, SHAPED, THREE BANDS. Uniform across the whole band put as
             many people out at the deep edge as on the dry sand, which reads as
             a crowd that has waded into the sea for no reason. Still exactly ONE
             brnd(): the draw COUNT is match state (see above), so the shape may
             change and the count may not.

             THE THIRD BAND IS NEW AND IT IS THE POINT. The published ring stops
             at r1 = waterline + 9 m, and this foreshore is 0.83 m deep at
             waterline + 8 — so the deepest anyone ever stood was mid-thigh and
             NOT ONE PERSON IN THIS MODE COULD EVER HAVE BEEN SWIMMING, whatever
             the mover underneath them did. A beach where nobody is out of their
             depth is not a beach, and a shark game whose entire larder is
             standing in a foot of water has no sea in it. So the top of the
             draw goes swimming — 1% of it for a body that is already wet,
             0.1% for one on the sand — at a radius searched for against the same
             depth oracle the mover steers by rather than guessed.

             WHO SWIMS DEPENDS ON WHETHER THEY ARE ALREADY WET, which is both
             the obvious human fact and the only version of this that WORKS. A
             flat 1% across the whole crowd was measured on a real match: three
             outstanding swim legs and ONE person actually off their feet in
             sixty seconds, because the pick is spread over ninety-nine bodies
             of whom eighty are on dry sand thirty metres from water they would
             have to walk to. Somebody standing waist-deep is six metres from
             the shelf and has already made the decision, so the wet band draws
             it at 5% and the towels at 0.5%.

             THOSE TWO NUMBERS ARE A RATE, NOT A SHARE, and they were solved
             against the measured crowd rather than picked. With legs that now
             run to completion a body decides about once every eight seconds,
             so forty survivors make ~5 decisions a second, a quarter of them
             from bodies already in the water: 1.25*0.05 + 3.75*0.005 = 0.08
             swim legs a second. A round trip out past the shelf and back is
             about fifty seconds, so the sea holds ~4 swimmers at a time — a
             handful off a busy beach. The first cut of this used a SEVENTH of
             every draw and made the whole beach a regatta.

             AND THE SHARE IS SELF-LIMITING, which matters because a swim leg is
             not like any other: every other leg is abandoned and re-rolled
             inside ~1.7 s, while a swim leg HOLDS until the body arrives (see
             committed()) and the round trip is most of a minute. So a small
             share of the DRAW is a large share of the SEA — the first cut of
             this used a seventh and turned the whole beach into a regatta.
             The dry/wet split below (0.66) is the number that was already here. */
          const u = brnd();
          const wl = ring.wl != null ? ring.wl : ring.r1;
          const dry = Math.max(0.5, wl - 0.5 - ring.r0);
          const wet = Math.max(0.5, ring.r1 - wl + 0.5);
          const swimU = b.wet ? 0.95 : 0.995;     // see above: wet bodies swim
          /* THE BEARING IS RELATIVE TO THE BODY, NOT TO THE ISLAND, and this is
             the other half of the arrival fix below.

             Every wander target this file has ever set was at a FRESH ABSOLUTE
             bearing round the ring — and because `pause` (~1.7 s) is far shorter
             than the walk to a point tens of metres away, a survivor never
             arrives anywhere: it takes 1.7 s of one heading, then 1.7 s of
             another. With headings drawn uniformly round a circle the average of
             that walk points AT THE CENTRE, so the crowd migrates inland. That
             never showed because bodies used to freeze on arrival (below);
             unfreeze them and the beach empties — measured, 7 people in the
             water at t=5 s and 0 by t=10 s.

             Spent as an OFFSET from where the body already is, the same draw
             makes a crowd that mills ALONG the shore while the band above still
             decides how far up the sand or out into the sea each leg goes. The
             swim band gets a tighter cone because a swim is a committed leg and
             should not start with a hundred-metre walk to a different beach. */
          const own = Math.atan2(b.pos.z - ring.cz, b.pos.x - ring.cx);
          let d;
          if (u < 0.66) d = ring.r0 + (u / 0.66) * dry;
          else if (u < swimU) d = (wl - 0.5) + ((u - 0.66) / (swimU - 0.66)) * wet;
          else d = 0;
          let th = own + (a / 6.28 - 0.5) * (d ? 1.6 : 0.9);
          if (!d) {
            const swimR = swimmableRadius(ring, th);
            const f = (u - swimU) / (1 - swimU);
            d = swimR > 0 ? swimR + f * 14 : (wl - 0.5) + f * wet;
          }
          b.target.set(ring.cx + Math.cos(th) * d, 0, ring.cz + Math.sin(th) * d);
        } else {
          const d = brnd() * arena.radius * 0.6;
          b.target.set(arena.center.x + Math.cos(a) * d, 0, arena.center.z + Math.sin(a) * d);
        }
        b.pause = 0.6 + brnd() * 2.2;
      }
    }
  }

  // ---- VAULT (systems/physics.js characterTraversal) ------------------------
  // The comment on line 151 below has always said bots "don't climb". They do
  // now, over the one band a person can cross without climbing gear: the
  // island's abandoned cars, low walls and rubble. The capability is the SAME
  // one the city gives a fleeing pedestrian — it was refused outside city mode
  // until systems/modecaps.js made it a capability instead of a scenario — and
  // a bot SPRINTING from a tsunami is exactly the body it was written for.
  // Returns true when the vault owns the frame (skip normal locomotion).
  function botTraverse(b, dt, spd) {
    const T = CBZ.characterTraversal;
    if (!T || !b.char || !(CBZ.modeHas && CBZ.modeHas("traverse"))) return false;
    if (b._traversal) {
      if (b.dead) { T.cancel(b, b.char, false, "dead"); return false; }
      const owned = T.step(b, b.char, dt, true);
      if (!b._traversal) b._travCD = 0.4;
      return owned;
    }
    // Only a body with somewhere urgent to be. A wandering islander walks round.
    if (b.state !== "flee" && b.state !== "move") return false;
    b._travCD = (b._travCD || 0) - dt;
    if (b._travCD > 0 || !b.target) return false;
    const tx = b.target.x - b.pos.x, tz = b.target.z - b.pos.z;
    if (tx * tx + tz * tz < 0.81) return false;
    b._travCD = 0.14;
    const started = T.start(b, b.char, tx, tz, {
      speed: spd, radius: BOT_RADIUS,
      height: (b.char.metric && b.char.metric.height) || 1.7,
      allowTop: false, cars: false, npc: true, running: true,
      sprinting: b.state === "flee",
    });
    return !!(started && T.step(b, b.char, dt, true));
  }

  // ---- locomotion (every frame; only for living, non-busy bots) ----
  function move(b, dt, animate) {
    // fleeing reads urgency: a bot brushing a threat jogs (~1.55×), one caught
    // outside the closing zone or under a strike marker SPRINTS (~2.15×). A
    // body with a shark behind it is at the top of that scale by definition.
    const running = b.state === "flee" || b.state === "panic";
    const spd = running ? b.baseSpeed * (1.55 + 0.6 * (b.urg || 0)) : (b.state === "move" ? b.baseSpeed * 1.25 : b.baseSpeed);
    if (botTraverse(b, dt, spd)) return;
    const dx = b.target.x - b.pos.x, dz = b.target.z - b.pos.z;
    const dist = Math.hypot(dx, dz);
    if (b.panicT > 0) b.panicT -= dt;
    // `pause` keeps counting past zero (floored) so committed() has a leg clock
    // and a body that can never reach its target eventually gives up on it.
    // Every read of `pause` is either `<= 0` or Math.max(_, 0.4), so this is
    // invisible to everything that was already here.
    if (b.pause > -90) b.pause -= dt;

    /* HOW MUCH WATER IS ON THIS BODY. One query, every frame, for every living
       survivor — and on dry land it answers 0 and every line below it is the
       code that was always here, to the digit. Measured against MEAN sea level
       (survFloodDepthMeanAt) rather than the live crest, because the wade/swim
       hysteresis reads it: on the wavy surface a swell rolling past flips a
       body between wading and swimming several times a second, and each flip
       is an entry splash. city/swim.js learned this the same way. */
    const depth = waterDepth(b.pos.x, b.pos.z);
    b.wet = depth > 0.25;
    const wasSwim = !!b.swim;
    if (depth >= SWIM_ENTER) b.swim = true;
    else if (depth <= SWIM_LEAVE) b.swim = false;
    if (b.swim) { swimStep(b, dt, dx, dz, dist, depth, animate, !wasSwim); return; }
    if (wasSwim && b.char) b.char.swimming = false;

    // ---- feet on the ground (or on the bed, in the shallows) ---------------
    // Wading is not a state, it is a scale: the water takes more of the step
    // the deeper it gets, and the walk cycle slows with it because b.speed is
    // what animChar reads. At depth 0 this is exactly 1.0 and nothing changed.
    // swim.js's own grading: sub = depth/BODY_H, and control is fully aquatic
    // at SWIM_BLEND (0.5) of a body height.
    const step = depth > 0.02 ? spd * (1 - WADE_SLOW * Math.min(1, depth / (BODY_H * 0.5))) : spd;
    if (dist > 0.5) {
      b.pos.x += (dx / dist) * step * dt;
      b.pos.z += (dz / dist) * step * dt;
      b.group.rotation.y = lerpAngle(b.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0008, dt));
      b.speed = step;
      b._arrived = false;
    } else {
      b.speed = 0;
      /* YOU ARRIVE ONCE. This clamp ran on EVERY frame the body was within half
         a metre of its target, so `pause` was pinned at 0.4 and could never
         reach zero — and think()'s re-roll is gated on `pause <= 0`. A survivor
         that reached its spot therefore STOOD THERE FOR THE REST OF THE MATCH.

         Measured on HEAD, sixty seconds of a ninety-nine-body crowd: the number
         of people standing in water deeper than 0.25 m went 16 -> 17, the
         deepest anyone stood went 0.86 m -> 1.00 m, and the whole population
         produced TWO new wander decisions. The beach is a diorama, and it is
         also why the swim band looked broken before it was — a body cannot
         decide to swim if it has stopped deciding anything.

         The intent was obviously a floor applied ON ARRIVAL: stand here a beat
         before picking somewhere new. Latched, that is what it does. */
      // The dwell is per-body and costs no new draw: `reactivity` is already
      // one, so a twitchy survivor moves on in half a second and a placid one
      // stands in the surf for four.
      if (b.state === "wander" && !b._arrived) {
        b._arrived = true;
        b.pause = Math.max(b.pause, 0.5 + (+b.reactivity || 0) * 3.5);
      }
    }
    // bots walk the terrain only (they don't climb); pass their body span so the
    // height-gated upper-floor walls of buildings don't block them at ground level
    if (CBZ.collide) CBZ.collide(b.pos, BOT_RADIUS, b.pos.y, b.pos.y + 1.7);
    b.pos.y = CBZ.surv ? CBZ.surv.floorAt(b.pos.x, b.pos.z) : 0;
    if (animate) animChar(b.char, b.speed, dt);
  }

  /* ---- IN THE WATER, OFF THE BOTTOM ---------------------------------------
     The body is a float with a stroke on it, not a walker with its feet in the
     wrong place. Nothing here is a second swimmer: the altitude is the same
     float line city/swim.js settles the player on, the surface is the same live
     crest, the pose is character.js's shared cycle, and the splash is
     water_impact.js's momentum bus.

     `animChar` still runs FIRST, at zero speed, and that is deliberate rather
     than wasteful: it is exactly the composition the player's own swim uses
     (physics animates the rig, then the water overwrites the joints it owns),
     it keeps the hip-pivot compensation and the head/torso idle alive under the
     stroke, and it is what makes climbing back out of the water a damped blend
     into the walk instead of a snap. */
  function swimStep(b, dt, dx, dz, dist, depth, animate, entered) {
    /* EVERY BODY ON ITS OWN BEAT. Ten states created at zero on the same tick
       advance by the same dt for ever, so a line of survivors strokes in
       PERFECT UNISON — synchronised swimming, which is a very funny thing to
       find in a shark game and not what anybody asked for. Offset from the
       bot's own `reactivity`, which is already a per-body draw from the spawn
       stream, so the crowd is out of phase and stays deterministic. */
    let st = b.swimAnim;
    if (!st) {
      st = b.swimAnim = CBZ.makeSwimAnim();
      const r = +b.reactivity || 0;
      st.stroke = r * 6.283;
      st.tread = ((r * 3.7) % 1) * 6.283;
    }
    const panic = b.state === "panic" || b.panicT > 0;
    const surf = seaAt(b.pos.x, b.pos.z);
    b._arrived = false;          // the land branch's arrival latch means nothing out here

    // HORIZONTAL. A stroke builds and bleeds; it does not start and stop like a
    // footfall, so the speed is eased rather than assigned and a body that
    // arrives keeps gliding for a beat.
    const want = dist > 0.8 ? (panic ? PANIC_SPEED : SWIM_SPEED) : 0;
    b.speed = damp(b.speed, want, panic ? 3.4 : 1.9, dt);
    if (dist > 1e-4 && b.speed > 1e-4) {
      b.pos.x += (dx / dist) * b.speed * dt;
      b.pos.z += (dz / dist) * b.speed * dt;
    }
    if (dist > 0.8) {
      b.group.rotation.y = lerpAngle(b.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(WATER_TURN, dt));
    }
    if (CBZ.collide) CBZ.collide(b.pos, BOT_RADIUS, b.pos.y, b.pos.y + 1.7);

    /* VERTICAL. The float line is the same one the player settles on —
       FLOAT_DEPTH below the LIVE surface, so the body rides the swell instead
       of sitting on a plane — clamped off the bed so a swimmer crossing a
       shallow bar never sinks through it. Eased rather than assigned, which is
       what makes leaving your feet look like leaving your feet: the body lifts
       off the bottom over about half a second. */
    const bedY = surf - depth;
    const floatY = Math.max(bedY + 0.22, surf - FLOAT_DEPTH);
    if (entered) { b._floatY = b.pos.y; entrySplash(b, surf); }
    b._floatY = b._floatY == null ? floatY : b._floatY + (floatY - b._floatY) * (1 - Math.exp(-6 * dt));

    // ANIMATION. Panic runs the cycle hot AND layers the thrash on top; both
    // ease, so a body that has just seen a fin comes apart over a beat rather
    // than switching animation.
    st.rate = panic ? 2.25 : 1;
    st.thrash = damp(st.thrash || 0, panic ? 1 : 0, panic ? 5 : 3, dt);
    CBZ.swimAnimStep(st, b.speed, dt);
    b.pos.y = b._floatY + st.bob;
    if (st.beat > 0) strokeSplash(b, surf, panic);
    if (animate) {
      animChar(b.char, 0, dt);
      CBZ.poseSwimmer(b.char, st, null);
    }
  }

  // ---- corpse persistence (see the block in the update loop) ----
  // Read live so a quality slider or a console tweak lands mid-round.
  const CORPSE_NEAR2 = 46 * 46;    // "near enough to walk over and look at"
  const CORPSE_FAR_T = 6;          // out of sight: the original flat lifetime, unchanged
  const CORPSE_NEAR_T = 22;        // in sight: long enough to read the body and its pool
  const CORPSE_CAP = 12;           // how many may linger at once
  let lingering = 0;

  // ---- per-frame update (order 23: after player @10, prison npc @22 is gated off) ----
  CBZ.onUpdate(23, function (dt) {
    if (!CBZ.islandModeOn(CBZ.game.mode)) return;
    frame++;
    // ONE scan of the bestiary for the whole crowd, on its own slow clock. See
    // refreshThreats: a hundred bots each scanning it would be a hundred scans
    // of a list that changes twice a second.
    if (frame % THREAT_REFRESH === 0) refreshThreats();
    const camx = CBZ.camera.position.x, camz = CBZ.camera.position.z;   // VIEW: animation + corpse LOD
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;                 // SIM: think cadence (see below)
    const bots = CBZ.bots;
    lingering = 0;                                   // recounted in the pass below
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (b.dead) {                                    // corpse: body.js poses the ragdoll; just count + cull
        if (b.tag) b.tag.visible = false;
        b.deadT = (b.deadT || 0) + dt;
        /* THE BODY DOESN'T VANISH WHILE YOU'RE LOOKING AT IT (SURV_CORPSE_LINGER).
           Every corpse used to be deleted at a flat 6 seconds, wherever it was
           — which is long enough to see someone die and nowhere near long
           enough to walk over and look. Half the evidence this mode now puts
           on a body arrives in that window and then blinks out at arm's length:
           the frost on a man who froze, the char on one the lava took, the pool
           he soaked into. Worse, it POPPED — the rig was simply removed from the
           scene mid-view.

           So distance decides, the way it does everywhere else in this engine:
           a corpse you cannot see still goes at 6 s (the budget is unchanged
           where it matters, which is a field of 99), a corpse near you lies
           there long enough to be read, and only a bounded number of them do
           — past the cap the newest death takes the oldest one's place, so a
           mass-casualty disaster can never stack the whole lobby in front of
           the lens. */
        if (!b.culled) {
          const cdx = b.pos.x - camx, cdz = b.pos.z - camz;
          const seen = (cdx * cdx + cdz * cdz) < CORPSE_NEAR2;
          if (b._linger) lingering++;
          if (b.deadT > CORPSE_FAR_T && !b._linger && seen && lingering <= CORPSE_CAP) { b._linger = true; lingering++; }
          const life = b._linger ? CORPSE_NEAR_T : CORPSE_FAR_T;
          if (b.deadT > life || (b._linger && !seen && b.deadT > CORPSE_FAR_T * 2)) {
            b.culled = true;
            if (b._linger) { b._linger = false; lingering--; }
            if (b.group.parent) b.group.parent.remove(b.group);
          }
        }
        continue;
      }
      const dx = b.pos.x - camx, dz = b.pos.z - camz;
      const dist2 = dx * dx + dz * dz;
      if (b.tag) b.tag.visible = false;                  // identity stays in interaction UI, not over the head
      if (CBZ.body && CBZ.body.busy(b)) continue;       // thrown / knocked down / held → body owns it
      /* ABOARD A BOAT. world/sea_craft.js owns this body's position and pose
         while it is sitting in a hull — a wander leg here walks it off the
         deck and a swim leg drops it over the side, both of which this file
         did to every crewman on its first frame. The craft releases the flag
         when the man goes in the water (or is eaten). */
      if (b._aboard) continue;
      const near = dist2 < ANIM_DIST2;
      /* HOW OFTEN A BOT THINKS IS A SIM DECISION. HOW OFTEN IT ANIMATES IS NOT.

         Both used to be `near`, measured from the CAMERA — so a bot's decision
         cadence depended on where the local player happened to be looking. On
         one machine that is invisible. On two it is fatal: tools/determinism-
         check.mjs found exactly this, three bots out of eight drifting apart
         within four seconds of an identical seed, because two cameras put the
         same bot on opposite sides of the LOD boundary and it thought every
         3rd frame on one client and every 7th on the other.

         The stride is measured from the PLAYER now — a body in the world, at
         the same place on every client. `near` (the camera) still decides
         animation, which is a view decision and is allowed to differ. */
      const sdx = b.pos.x - px, sdz = b.pos.z - pz;
      const stride = (sdx * sdx + sdz * sdz) < ANIM_DIST2 ? 3 : 7;
      if ((frame + b.slice) % stride === 0) think(b);
      move(b, dt, near);
    }
  });

  // ---- O(n) spatial-grid separation (order 26: prison actorcollide @25 gated off) ----
  // Uses the shared alloc-free grid (CBZ.makeGrid) — no per-frame Map/strings.
  const CELL = 2.4;
  const minD = BOT_RADIUS * 2;
  let sepGrid = null;
  const sepList = [];
  const playerEntry = { pos: null, _p: true, isPlayer: true, r: 0.55 };
  function botPos(b) { return b.pos; }
  CBZ.onUpdate(26, function (dt) {
    if (!CBZ.islandModeOn(CBZ.game.mode)) return;
    if (!sepGrid) sepGrid = CBZ.makeGrid(CELL);
    sepList.length = 0;
    for (let i = 0; i < CBZ.bots.length; i++) {
      const b = CBZ.bots[i];
      // a body mid-vault is owned by the traversal spline: the clamp below
      // would shove it back off the car it is crossing.
      // ..and a seated crewman is not a pedestrian: the separation pass would
      // shove him out of his own seat and then clamp him onto the seabed.
      if (!b.dead && !b._aboard && !b._traversal && !(CBZ.body && CBZ.body.busy(b))) sepList.push(b);
    }
    /* A RIDER HAS NO BODY. While the player is mounted, CBZ.player.pos is a
       SEAT the mount republishes every tick — there is no person standing in
       the water. Pushing it in here handed the crowd an invisible 0.55 m
       pedestrian travelling at shark speed, and humancontact.js's on-foot
       charge rule (speed >= 6.2 && sprint, which a swimming shark always
       satisfies) then RAN EVERY SWIMMER OVER by touch: a knockdown, a
       "run-over" reaction, a KO sound and CBZ.shake(0.10) per body, re-armed
       every 0.75 s per person, for as long as you swam through the crowd.
       That is a large part of why Shark Sim felt like an earthquake — see
       tools/shark-shake-check.mjs. The shark's own hull is the physical thing
       in the water and city/wildlife.js owns it; the seat is not a collider. */
    const riding = !!(CBZ.cityMountedAnimal && CBZ.cityMountedAnimal());
    if (!CBZ.player.dead && !riding) { playerEntry.pos = CBZ.player.pos; playerEntry.r = CBZ.player.radius || 0.55; sepList.push(playerEntry); }
    if (CBZ.humanContact) {
      CBZ.humanContact.resolve(sepList, dt, {
        mode: "survival",
        /* A SWIMMER HAS NO FLOOR. This clamp re-planted every separated body on
           the terrain height — which for anyone in the water is the SEABED, and
           it ran at order 26, three orders after the mover had just floated them
           to the surface. So without the `a.swim` test the crowd was pulled
           back down to the bottom every frame by the collision pass and the
           swim looked like it did nothing at all. */
        clamp(a) {
          if (CBZ.collide) CBZ.collide(a.pos, a.r || BOT_RADIUS, a.pos.y, a.pos.y + 1.7);
          if (!a._p && !a.swim) a.pos.y = CBZ.surv ? CBZ.surv.floorAt(a.pos.x, a.pos.z) : 0;
        },
      });
      return;
    }
    sepGrid.rebuild(sepList, botPos);
    for (let i = 0; i < sepList.length; i++) {
      const b = sepList[i];
      const gx = sepGrid.cellIndex(b.pos.x), gz = sepGrid.cellIndex(b.pos.z);
      for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
        const a = sepGrid.bucket(cx, cz); if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const o = a[k];
          if (o === b) continue;
          const dx = b.pos.x - o.pos.x, dz = b.pos.z - o.pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < minD * minD && d2 > 1e-6) {
            const d = Math.sqrt(d2), push = (minD - d) / d * 0.5;
            if (!b._p) { b.pos.x += dx * push; b.pos.z += dz * push; }
            if (!o._p) { o.pos.x -= dx * push; o.pos.z -= dz * push; }
          }
        }
      }
    }
  });
})();
