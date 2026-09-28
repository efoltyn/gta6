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
  const { makeCharacter, animChar, damp } = CBZ;
  // THE ONE LOCOMOTION LAYER (entities/moves.js): every survivor on land walks
  // through it; one options record, mutated per body (no per-frame allocation).
  const MV = CBZ.moves;
  const _mo = { speed: 0, stop: 0.5, face: null, nbrs: null, nbrN: 0, lod: 0, radius: 0.42 };
  const SWIM_TURN = 1.5;          // rad/s a crawling swimmer can come round
  const SWIM_TURN_PANIC = 2.3;    // rad/s with a fin behind it

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
  const PANIC_R = 22;             // m — a predator this close and you stop swimming
  const PANIC_HOLD = 5;           // s — you do not calm down the instant the fin turns

  function seaAt(x, z) { return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -1e9; }
  function bedAt(x, z) { return CBZ.surv ? CBZ.surv.floorAt(x, z) : 0; }
  /* WHERE THE FEET GO. Survival bodies stand on the same walkable surfaces the
     player does (physics.js groundAt: floors, landings, the stair ramps, with
     its step-up rule), so a survivor can take the stairs to the first floor
     when the storm surge is coming. Everywhere else (Shark Sim) the feet stay
     on the terrain exactly as before. `_lift` is how far above the terrain the
     body stands, which the water test subtracts: a dry first floor is dry. */
  function standY(b) {
    const bed = bedAt(b.pos.x, b.pos.z);
    if (!CBZ.groundAt || !CBZ.game || CBZ.game.mode !== "survival") { b._lift = 0; return bed; }
    // groundAt only knows the terrain the mode registered, not the sinkholes
    // surv.floorAt cuts into it: take its answer only when it is a PLATFORM
    // (above the bare terrain), otherwise the hole-aware bed stands
    const g = CBZ.groundAt(b.pos.x, b.pos.z, b.pos.y);
    const A = CBZ.surv.arena;
    const terr = A && A.groundHeightAt ? A.groundHeightAt(b.pos.x, b.pos.z) : bed;
    const y = g > terr + 0.02 && g > bed ? g : bed;
    b._lift = y - bed;
    return y;
  }
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
    const swim = CBZ.beachSwimwear ? CBZ.beachSwimwear(r, skin, HAIR) : null;   // Shark Sim: swimwear (city/beach.js)
    const ch = makeCharacter(swim || {
      legs: pick(OUTFIT, r()), torso: outfit, collar: outfit, arms: outfit,
      skin: skin, hair: pick(HAIR, r()), shoes: 0x2b2b2b,
    });
    const gy = CBZ.surv ? CBZ.surv.floorAt(x, z) : 0;
    ch.group.position.set(x, gy, z);
    ch.group.rotation.y = r() * 6.28;
    const name = pickName(r);
    const b = {
      char: ch, group: ch.group, pos: ch.group.position,
      name: name, tag: null, outfit: swim ? swim.cloth : outfit, skin: skin,
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
    // the brain's clock and memory are match state too
    simT = 0; adv = null; advKey = ""; advEp = 0; shelterArena = null; shelters = null; occ = null; shelterThr = null; minThreat = 0;
    let s = 7 + n;
    const rr = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < n; i++) {
      const p = arena.randomPoint(arena.hills && arena.hills[0] ? arena.hills[0].r + 2 : 10, arena.radius * 0.8);   // in the town, not on the cone
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

  /* ============================================================
     THE SURVIVOR BRAIN (survival mode only).

     The crowd's only answer to a disaster used to be fleeVector(): walk down
     the local threat gradient, and only once the threat at your own feet was
     over 0.15. Nobody ever went to the RIGHT KIND of place, so every "mega"
     disaster took most of the lobby at random. Measured on seed 90210 with the
     death-share governor stubbed off, one disaster forced on a fresh 99:
     hurricane 76 dead, meteor 52, volcano 35, tsunami 28, storm 19, quake 22,
     blizzard 2 (full matches: hurricanes took 91/99, 47/48, 46/47).

     Now every disaster has an answer (CBZ.disasters.advice().kind) and each
     survivor goes for it with its own skill:

       high         a hill that stays dry for THIS water: the mountain for a
                    tsunami (its flood tops the small hills), any hill for a
                    flash flood; never the volcano in an eruption
       indoors      inside an intact building, under a slab; in a hurricane
                    UPSTAIRS first, because the surge floods every ground floor
                    on this island (it is flat, 0-1 m)
       indoors_far  a building on the far side of `from` (the volcano), past
                    the director's own safeAt() line
       open         out of the buildings, clear of them by safeAt()'s rule
       clear        clear of the trees by safeAt()'s rule (9 m, 14 m burning)
       away         the old fleeVector gradient (tornado, sinkholes)

     SKILL is one number per body, hashed from two spawn draws the body
     already has (reactivity, baseSpeed), so it costs the match stream no draw
     at all. It sets how long you stand and stare at the thing before moving
     (0.3 to 4 s after the card), whether you pick the best shelter, a sloppy
     one (the nearest, the second best, ignoring the far-side rule), or just
     run down the gradient, and whether you follow someone: a low-skill body
     with no plan latches onto a smarter neighbour within 16 m and copies where
     they are going, which is what makes the smart ones worth watching.

     Buildings are boxes with the ground-floor door on the -z face. A plan is a
     short list of waypoints: round the corner if you are behind it, the step
     in front of the door, the step inside it, then your own spot (or up the
     stair ramp to one on the first floor: survival bodies now stand on the
     same walkable platforms the player does, see standY). Spots are sampled
     once per building (under a slab, clear of every wall) and are the
     capacity: when a building is full the next body picks another, and a
     good head also avoids buildings the live threat has reached. A steep
     local hazard (a strike marker, lava at the door) beats the plan for as
     long as it is there. After the all-clear everybody inside walks back
     down and out of the door and goes back to wandering.

     Cost: the advice is read ONCE per frame; a plan is built once per body per
     disaster (31 buildings, a dozen samples); following it is a distance test.
     ============================================================ */
  const KIND_OF = {
    flood: "high", flashflood: "high", storm: "indoors", hurricane: "indoors",
    blizzard: "indoors", meteor: "indoors", volcano: "indoors_far", nuke: "indoors_far",
    quake: "open", wildfire: "clear", tornado: "away", sinkhole: "away",
  };
  let adv = null, advEp = 0, advKey = "";
  let simT = 0;                                  // match sim clock (deterministic)
  let shelters = null, shelterArena = null;      // per-building door + spots, lazily
  let occ = null;                                // occupants per building this episode
  let shelterThr = null, minThreat = 0;          // live threat at each building, refreshed ~3x/s
  function threatOf(s) { return shelterThr ? shelterThr[s.i] : 0; }
  function refreshShelterThreat() {
    if (!shelters || !CBZ.disasters.threatAt) return;
    if (!shelterThr || shelterThr.length !== shelters.length) shelterThr = new Float32Array(shelters.length);
    let m = 1e9;
    for (let i = 0; i < shelters.length; i++) {
      const b = shelters[i].b;
      const t = b.fallen ? 1 : Math.max(CBZ.disasters.threatAt(b.ox, b.oz), CBZ.disasters.threatAt(b.ox, b.oz - b.d / 2 - 1.7));
      shelterThr[i] = t;
      if (!b.fallen && t < m) m = t;
    }
    minThreat = m === 1e9 ? 0 : m;
  }

  function survOn() { return CBZ.game && CBZ.game.mode === "survival"; }

  // one read per frame; a new disaster (or a new occurrence of one) is a new episode
  function readAdvice() {
    const D = CBZ.disasters;
    let a = null;
    if (D && survOn()) {
      if (D.advice) a = D.advice();
      else if (D.currentId) {
        // fallback until the director publishes advice(): the same table, no brief
        const id = D.currentId(), st = D.state();
        if (id && st !== "idle") {
          const A = CBZ.surv && CBZ.surv.arena;
          a = { id: id, phase: st, kind: KIND_OF[id] || "away", tLeft: st === "warn" ? D.timeLeft() : -D.timeLeft(),
            from: (id === "volcano" || id === "nuke") && A && A.hills[0] ? { x: A.hills[0].x, z: A.hills[0].z } : null };
        }
      }
    }
    const key = a ? a.id + ":" + (a.n != null ? a.n : "") : "";
    if (key !== advKey) {
      advKey = key;
      if (a) { advEp++; if (occ) occ.fill(0); if (shelterThr) shelterThr.fill(0); minThreat = 0; }
    }
    adv = a;
    if (a && a.phase !== "brief" && frame % 20 === 0 && shelterReady()) refreshShelterThreat();
  }

  // integer hash -> [0,1). Pure arithmetic, identical on every client.
  function hmix(a, b) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  function hidOf(b) {
    if (b._hid == null) b._hid = (((+b.reactivity || 0) * 1e9) | 0) ^ ((((+b.baseSpeed || 2) * 1e6) | 0) << 3);
    return b._hid;
  }
  // 0 = panics, 1 = cool head. Skewed a little low: most people are not experts.
  function skillOf(b) {
    if (b._skill == null) b._skill = Math.pow(hmix(hidOf(b), 1), 1.15);
    return b._skill;
  }

  // ---- the buildings as shelters ------------------------------------------
  function inside(s, x, z, pad) {
    return Math.abs(x - s.b.ox) < s.b.w / 2 - (pad || 0) && Math.abs(z - s.b.oz) < s.b.d / 2 - (pad || 0);
  }
  function buildShelters(arena) {
    shelters = []; shelterArena = arena;
    const list = arena.fragile || [];
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      const zf = b.oz - b.d / 2;
      shelters.push({
        b: b, i: i, spots: null, cap: 0,
        out: { x: b.ox, z: zf - 1.7 },          // the step in front of the door
        door: { x: b.ox, z: zf + 1.3 },         // the step inside it
      });
    }
    occ = new Int16Array(shelters.length);
  }
  /* SPOTS: where a body stands inside. The ground floor under the first slab,
     and (when the building has a flight of stairs) the FIRST FLOOR under the
     second one, reached up the stair ramp: foot of the flight, top of it, the
     landing, then the floor. Everything is read off the building's own
     platform and collider records, so a building grammar that changes shape
     changes its spots with it. Sampled once per building per arena. */
  function sampleFloor(b, top, x0, x1, z0, z1, out) {
    const plats = b.platforms || [], cols = b.colliders || [];
    for (let z = z1; z >= z0; z -= 1.25) {
      for (let x = x0; x <= x1; x += 1.25) {
        const y = top == null ? bedAt(x, z) : top, head = y + 2.1;
        let roof = false, ramp = false;
        for (let k = 0; k < plats.length; k++) {
          const p = plats[k];
          if (x < p.minX - 0.3 || x > p.maxX + 0.3 || z < p.minZ - 0.3 || z > p.maxZ + 0.3) continue;
          if (p.ramp) { if (p.ramp.y1 > y + 0.2 && p.ramp.y0 < head) ramp = true; continue; }
          if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ && p.top > head) roof = true;
        }
        if (!roof || ramp) continue;
        if (top != null) {                                    // upstairs: there must be floor under you
          let floor = false;
          for (let k = 0; k < plats.length && !floor; k++) {
            const p = plats[k];
            if (!p.ramp && Math.abs(p.top - top) < 0.05 && x > p.minX + 0.45 && x < p.maxX - 0.45 && z > p.minZ + 0.45 && z < p.maxZ - 0.45) floor = true;
          }
          if (!floor) continue;
        }
        let hit = false;
        for (let k = 0; k < cols.length && !hit; k++) {
          const c = cols[k];
          if (c.y1 != null && (c.y1 < y + 0.3 || c.y0 > y + 1.7)) continue;
          if (x > c.minX - 0.6 && x < c.maxX + 0.6 && z > c.minZ - 0.6 && z < c.maxZ + 0.6) hit = true;
        }
        if (!hit) out.push({ x: x, z: z, y: y });
      }
    }
    return out;
  }
  function spotsOf(s) {
    if (s.spots) return s.spots;
    const b = s.b;
    const x0 = b.ox - b.w / 2 + 0.9, x1 = b.ox + b.w / 2 - 0.9;
    const z0 = b.oz - b.d / 2 + 1.6, z1 = b.oz + b.d / 2 - 0.9;
    s.spots = sampleFloor(b, null, x0, x1, z0, z1, []);
    s.cap = Math.min(s.spots.length, Math.max(2, Math.floor((b.w * b.d) / 5)));
    // the first flight: the ramp that starts on the ground floor
    s.up = null; s.upCap = 0;
    const plats = b.platforms || [];
    let r0 = null;
    for (let k = 0; k < plats.length; k++) {
      const p = plats[k];
      if (p.ramp && Math.abs(p.ramp.y0 - b.gy) < 0.35 && p.ramp.axis !== "x") { r0 = p; break; }
    }
    if (r0 && (b.storeys || 1) >= 2) {
      const R = r0.ramp, top = R.y1, dz = R.z1 > R.z0 ? 1 : -1;
      const lx = (r0.minX + r0.maxX) / 2;
      let landing = null, slab = null, la = 0;
      for (let k = 0; k < plats.length; k++) {
        const p = plats[k];
        if (p.ramp || Math.abs(p.top - top) > 0.05) continue;
        const area = (p.maxX - p.minX) * (p.maxZ - p.minZ);
        if (area > la) { la = area; slab = p; }
        if (R.z1 + dz * 0.5 >= p.minZ && R.z1 + dz * 0.5 <= p.maxZ && lx >= p.minX - 0.2 && lx <= p.maxX + 0.2) landing = p;
      }
      if (slab && landing && slab !== landing) {
        const spots = sampleFloor(b, top, slab.minX + 0.6, slab.maxX - 0.6, slab.minZ + 0.6, slab.maxZ - 0.6, []);
        if (spots.length) {
          /* Tight arrival radii (r) on the stair: the flight is a lane with a
             drop on one side, and a body that turns for the next waypoint
             while still on the ramp steps off it and lands on the ground
             floor. The TOP waypoint is already on the landing for the same
             reason, and the floor is entered along the landing's own line
             (the next flight up starts beside it; cutting the corner walks
             into the stairwell). */
          const lcx = (landing.minX + landing.maxX) / 2, lcz = (landing.minZ + landing.maxZ) / 2;
          const cl = function (v, a, c) { return v < a ? a : (v > c ? c : v); };
          s.up = {
            wps: [
              { x: lx, z: R.z0 + dz * 0.4, r: 0.65 },                          // foot of the flight
              { x: lx, z: R.z1 + dz * 0.55, r: 0.65 },                        // top of it, on the landing
              { x: lcx, z: lcz, r: 0.7 },                                     // the landing
              { x: cl(lcx, slab.minX + 0.8, slab.maxX - 0.8), z: cl(lcz, slab.minZ + 0.8, slab.maxZ - 0.8), r: 0.7 },
            ],
            spots: spots, y: top,
          };
          s.upCap = Math.min(spots.length, Math.max(2, Math.floor(((slab.maxX - slab.minX) * (slab.maxZ - slab.minZ)) / 5)));
        }
      }
    }
    s.capAll = s.cap + s.upCap;
    return s.spots;
  }
  function shelterReady(arena) {
    const A = arena || (CBZ.surv && CBZ.surv.arena);
    if (!A) return false;
    if (shelterArena !== A) buildShelters(A);
    return shelters.length > 0;
  }
  function shelterAt(x, z) {
    if (!shelters) return null;
    for (let i = 0; i < shelters.length; i++) if (!shelters[i].b.fallen && inside(shelters[i], x, z, 0)) return shelters[i];
    return null;
  }

  // waypoints from (x,z) to a building's door: round the near corner(s) first
  // if the body is not already in front of the -z face
  function pushDoorPath(wps, s, x, z) {
    const b = s.b, zf = b.oz - b.d / 2, zb = b.oz + b.d / 2;
    const side = x >= b.ox ? 1 : -1, cx = b.ox + side * (b.w / 2 + 1.7);
    const beside = Math.abs(x - b.ox) > b.w / 2 + 0.8;
    if (z > zf - 0.8) {
      if (z > zb - 0.5 && !beside) wps.push({ x: cx, z: zb + 1.7 });
      wps.push({ x: cx, z: zf - 1.7 });
    }
    wps.push(s.out, s.door);
  }
  // the way out of whatever building the body is standing in
  function pushExit(wps, x, z, y) {
    const s = shelterAt(x, z);
    if (!s) return null;
    spotsOf(s);
    if (s.up && y != null && y > s.b.gy + 1.2) {              // upstairs: back down the flight first
      const u = s.up.wps;
      for (let k = u.length - 1; k >= 0; k--) wps.push(u[k]);
    }
    wps.push(s.door, { x: s.out.x, z: s.out.z - 1.5 });
    return s;
  }

  // ---- choosing -------------------------------------------------------------
  // how far from `from` counts as the far side: the director's safeAt() line
  // plus a couple of metres, so a body that gets there is safe by the HUD's rule
  function farEnough() { return adv && adv.id === "nuke" ? 72 : 57; }
  function pickShelter(b, far, sloppy) {
    if (!shelterReady()) return null;
    const from = adv && adv.from;
    let best = null, bs = 1e9, second = null, ss = 1e9;
    for (let i = 0; i < shelters.length; i++) {
      const s = shelters[i];
      if (s.b.fallen) continue;
      spotsOf(s);
      if (!s.capAll || occ[i] >= s.capAll) continue;
      const dx = s.out.x - b.pos.x, dz = s.out.z - b.pos.z;
      let score = Math.hypot(dx, dz);
      if (!sloppy) {
        score += (occ[i] / s.capAll) * 14;                    // spread the crowd
        score += Math.max(0, threatOf(s) - minThreat) * 70;   // not where the hazard is going
        if (adv && adv.id === "hurricane" && !s.up) score += 25; // the surge floods every ground floor
        if (b.pos.z > s.b.oz - s.b.d / 2) score += s.b.w * 0.8; // the walk round to the door
      }
      if (far && from) {
        const fd = Math.hypot(s.b.ox - from.x, s.b.oz - from.z);
        if (!sloppy) { if (fd < farEnough()) continue; score -= fd * 0.9; }
      }
      if (score < bs) { second = best; ss = bs; best = s; bs = score; }
      else if (score < ss) { second = s; ss = score; }
    }
    // a middling head sometimes settles for the second-best door
    if (second && sloppy === 1 && hmix(hidOf(b), advEp * 13 + 5) < 0.5) return second;
    return best;
  }
  function pickHigh(b, sloppy) {
    const A = CBZ.surv.arena;
    const hills = A.hills || [];
    const noVol = adv && (adv.id === "volcano" || adv.id === "nuke");
    // a tsunami's flood reaches 4.6-14.3 m above the sea: only the mountain is
    // certain. A flash flood is under two metres: any hill will do.
    const need = adv && adv.id === "flood" ? 16 : 6;
    let best = null, bs = 1e9;
    for (let i = 0; i < hills.length; i++) {
      if (i === 0 && noVol) continue;
      const h = hills[i];
      if (bedAt(h.x, h.z) < 2) continue;                      // a shoal is not a refuge
      const d = Math.hypot(h.x - b.pos.x, h.z - b.pos.z);
      const score = sloppy ? d : d + (h.peak < need ? 400 : 0) - h.peak * 2;
      if (score < bs) { bs = score; best = h; }
    }
    if (!best) return null;
    // the highest ground on the near side of it, not a hand-typed summit
    // (hills[0] is a caldera: its rim, not its centre, is the top)
    const own = Math.atan2(b.pos.z - best.z, b.pos.x - best.x);
    const jit = (hmix(hidOf(b), 7) - 0.5) * 1.4;
    let gx = best.x, gz = best.z, gy = -1e9;
    for (let k = 0; k < 5; k++) {
      const r = best.r * (0.08 + k * 0.1);
      for (let j = -1; j <= 1; j++) {
        const a = own + jit + j * 0.5;
        const x = best.x + Math.cos(a) * r, z = best.z + Math.sin(a) * r;
        const y = bedAt(x, z) - r * 0.01;
        if (y > gy) { gy = y; gx = x; gz = z; }
      }
    }
    return { x: gx, z: gz };
  }
  // open ground: dry, and farther from every building than it is tall (quake),
  // or clear of the trees (wildfire: 9 m from a live one, 14 m from a burning one)
  function pickOpen(b, trees) {
    const A = CBZ.surv.arena;
    const list = trees ? (A.flammable || []) : (A.fragile || []);
    const base = hmix(hidOf(b), advEp * 3 + 11) * 6.283;
    let best = null, bs = -1e9;
    for (let k = 0; k < 10; k++) {
      const a = base + k * 0.628, r = k < 5 ? 14 : 26;
      const x = b.pos.x + Math.cos(a) * r, z = b.pos.z + Math.sin(a) * r;
      const y = bedAt(x, z);
      if (waterDepth(x, z) > 0.05) continue;                  // dry land, not the sea
      let clear = 1e9;
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        // the clearances are the director's own safeAt() rules, so a body that
        // gets there is standing where the HUD would call the player safe
        let d;
        if (trees) {
          if (o.burnt) continue;
          d = Math.hypot(o.x - x, o.z - z) - (o.burning ? 14 : 9);
        } else {
          if (o.fallen) continue;
          const ex = Math.max(0, Math.abs(x - o.ox) - o.w / 2), ez = Math.max(0, Math.abs(z - o.oz) - o.d / 2);
          d = Math.hypot(ex, ez) - Math.max(6, Math.min(24, (o.h || 10) * 0.6));
        }
        if (d < clear) clear = d;
      }
      const score = Math.min(clear, 30) - r * 0.08 - Math.max(0, y - 6) * 0.5;
      if (score > bs) { bs = score; best = { x: x, z: z }; }
    }
    return best;
  }

  // ---- the plan ---------------------------------------------------------
  // b.plan = { ep, kind, s (shelter) | null, wps: [...], wi, spot, t (built),
  //            best (closest so far to the current waypoint), bestT, detours }
  function roomIn(s) { spotsOf(s); return occ[s.i] < s.capAll; }
  // which spot the n-th occupant gets: the storm surge sends them upstairs first
  function assignSpot(s, wps) {
    const n = occ[s.i]++;
    const upFirst = !!(adv && adv.id === "hurricane");
    const upN = upFirst ? n : n - s.cap;
    if (s.up && upN >= 0 && upN < s.upCap) {
      for (let k = 0; k < s.up.wps.length; k++) wps.push(s.up.wps[k]);
      wps.push(s.up.spots[upN % s.up.spots.length]);
      return;
    }
    const L = s.spots.length;
    const gN = upFirst ? n - s.upCap : n;
    wps.push(s.spots[((gN % L) + L) % L]);
  }
  function makePlan(b, kind, sloppy, forceShelter) {
    const wps = [];
    const from = pushExit(wps, b.pos.x, b.pos.z, b.pos.y);
    const p = { ep: advEp, kind: kind, s: null, wps: wps, wi: 0, t: simT, best: 1e9, bestT: simT, detours: 0 };
    if (kind === "indoors" || kind === "indoors_far") {
      const far = kind === "indoors_far";
      let s = forceShelter && !forceShelter.b.fallen && roomIn(forceShelter) ? forceShelter : null;
      // already indoors somewhere that will do: stay there
      if (!s && from && !from.b.fallen && roomIn(from) && threatOf(from) < minThreat + 0.3 &&
        (!far || !adv.from || Math.hypot(from.b.ox - adv.from.x, from.b.oz - adv.from.z) > farEnough())) s = from;
      if (!s) s = pickShelter(b, far, sloppy);
      if (!s || (!s.spots.length && !s.up)) return null;
      if (from === s) wps.length = 0;                         // already in it
      else pushDoorPath(wps, s, from ? from.out.x : b.pos.x, from ? from.out.z - 1.5 : b.pos.z);
      assignSpot(s, wps);
      p.s = s;
    } else if (kind === "high") {
      const g = pickHigh(b, sloppy);
      if (!g) return null;
      wps.push(g);
    } else if (kind === "open" || kind === "clear") {
      const g = pickOpen(b, kind === "clear");
      if (!g) return null;
      wps.push(g);
    } else return null;
    return p;
  }
  function dropPlan(b) {
    const p = b.plan;
    if (p && p.s && p.ep === advEp && occ && occ[p.s.i] > 0) occ[p.s.i]--;
    b.plan = null;
  }

  // walk the plan: returns true while it owns the body this think
  function followPlan(b, urg) {
    const p = b.plan;
    if (p.s && p.s.b.fallen) { dropPlan(b); return false; }
    let w = p.wps[p.wi];
    if (!w) { dropPlan(b); return false; }
    const last = p.wi === p.wps.length - 1;
    let d = Math.hypot(w.x - b.pos.x, w.z - b.pos.z);
    // (never under 0.55: move() stops 0.5 m short of any target)
    if (!last && d < Math.max(0.55, w.r || 1.1)) {
      p.wi++; w = p.wps[p.wi]; p.best = 1e9; p.bestT = simT;
      d = Math.hypot(w.x - b.pos.x, w.z - b.pos.z);
    }
    // stuck: no progress for a while -> step sideways, then give up
    if (d < p.best - 0.3) { p.best = d; p.bestT = simT; }
    else if (d > 0.9 && simT - p.bestT > 2.6) {
      if (++p.detours > 4) { dropPlan(b); return false; }
      const side = (p.detours & 1) ? 1 : -1;
      const nx = -(w.z - b.pos.z) / (d || 1), nz = (w.x - b.pos.x) / (d || 1);
      p.wps.splice(p.wi, 0, { x: b.pos.x + nx * side * 3.5 - (w.x - b.pos.x) / (d || 1) * 1.2, z: b.pos.z + nz * side * 3.5 - (w.z - b.pos.z) / (d || 1) * 1.2 });
      w = p.wps[p.wi]; p.best = 1e9; p.bestT = simT;
    }
    b.target.set(w.x, 0, w.z);
    b.pause = 0;
    if (last && d < 1.2) {                                     // there: stay put
      b.state = p.exit ? "wander" : "hide"; b.urg = 0;
      if (p.exit) { b.plan = null; b.pause = 0.5; }
      return true;
    }
    b.urg = urg;
    b.state = urg > 0.35 ? "flee" : "move";
    return true;
  }

  // a panicking body looks round for somebody who seems to know where they
  // are going, and goes there too
  function herd(b, sk) {
    if (sk > 0.55 || simT < (b._herdT || 0)) return false;
    b._herdT = simT + 1.2;
    const bots = CBZ.bots;
    let lead = null, bd = 16 * 16;
    for (let i = 0; i < bots.length; i++) {
      const o = bots[i];
      if (o === b || o.dead || !o.plan || o.plan.exit || o.plan.ep !== advEp) continue;
      if (skillOf(o) < sk + 0.2) continue;
      const dx = o.pos.x - b.pos.x, dz = o.pos.z - b.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; lead = o; }
    }
    if (!lead) return false;
    const lp = lead.plan;
    const p = makePlan(b, lp.kind, 0, lp.s);
    if (!p) return false;
    if (!lp.s) {                                              // same hill / clearing, own patch of it
      const g = lp.wps[lp.wps.length - 1];
      const j = hmix(hidOf(b), 17) * 6.283;
      p.wps[p.wps.length - 1] = { x: g.x + Math.cos(j) * 2.5, z: g.z + Math.sin(j) * 2.5 };
    }
    p.herd = true;
    b.plan = p;
    return true;
  }

  /* One think of the survivor brain. true = it owns the body this tick. */
  function survivorThink(b) {
    // the all-clear: whoever is still holding a plan walks back out of the door
    if (!adv) {
      if (b.plan && !b.plan.exit) {
        b.plan = null;
        const wps = [];
        if (pushExit(wps, b.pos.x, b.pos.z, b.pos.y)) b.plan = { ep: advEp, exit: true, kind: "exit", s: null, wps: wps, wi: 0, t: simT, best: 1e9, bestT: simT, detours: 0 };
      }
      b._seenEp = 0;
      if (b.plan && b.plan.exit) return followPlan(b, 0);
      return false;
    }
    if (b.plan && b.plan.ep !== advEp) dropPlan(b);
    const sk = skillOf(b);
    if (b._seenEp !== advEp) {                                // first sight of this card
      b._seenEp = advEp;
      b._reactT = simT + 0.3 + 3.7 * Math.pow(1 - sk, 1.6);
      const roll = hmix(hidOf(b), advEp * 7 + 3);
      // 0 = best answer, 1 = second-best / nearest, 2 = ignores the advice and
      // runs down the gradient. At skill 0: 45% run, 45% sloppy, 10% right.
      // At skill 0.5: 16% / 22% / 62%. Past 0.9 almost always right.
      const u = 1 - sk, pRun = 0.45 * Math.pow(u, 1.5), pSloppy = 0.45 * u;
      b._mode = roll < pRun ? 2 : (roll < pRun + pSloppy ? 1 : 0);
      b._planned = false;
    }
    const kind = adv.kind;
    const tLeft = adv.tLeft > 0 ? adv.tLeft : 0;
    const urg = adv.phase === "active" ? 1 : Math.max(0.2, Math.min(1, 1.15 - tLeft / 14));

    // THE STARE. Before the reaction lands the body stops and looks at it.
    if (simT < b._reactT) {
      const fv = CBZ.disasters.fleeVector(b.pos.x, b.pos.z);
      if (fv && fv.w > 0.5) { b._reactT = simT; }             // it is already on you: go
      else {
        const f = adv.from;
        if (f) { b._lookX = f.x; b._lookZ = f.z; }
        else if (fv && (fv.x || fv.z)) { b._lookX = b.pos.x - fv.x * 10; b._lookZ = b.pos.z - fv.z * 10; }
        else b._lookX = null;
        b.state = "look"; b.urg = 0; b.pause = 0;
        b.target.set(b.pos.x, 0, b.pos.z);
        return true;
      }
    }
    b._lookX = null;

    if (!b.plan && !b._planned && kind !== "away") {
      b._planned = true;
      if (b._mode < 2) b.plan = makePlan(b, kind, b._mode);
    }
    if (!b.plan && kind !== "away" && herd(b, sk)) { /* following someone */ }
    // clearing is a moving target: the fire spreads, look again now and then
    if (b.plan && kind === "clear" && simT - b.plan.t > 4 && b.plan.wi === b.plan.wps.length - 1) {
      dropPlan(b); b.plan = makePlan(b, kind, b._mode ? 1 : 0);
    }
    if (!b.plan) return false;                                // the old gradient

    /* A LOCAL HAZARD BEATS THE PLAN: a strike marker on your roof, lava at the
       door. Only a steep one — the threat here is much worse than a dozen
       metres downhill of it — so a storm that is bad everywhere never pulls
       anybody back out of the shelter it is the answer to. A good head also
       gives up a shelter the hazard has reached and picks another. */
    if (adv.phase !== "brief") {
      const fv = CBZ.disasters.fleeVector(b.pos.x, b.pos.z);
      if (fv && fv.w > 0.55 && (fv.x || fv.z)) {
        const t2 = CBZ.disasters.threatAt ? CBZ.disasters.threatAt(b.pos.x + fv.x * 12, b.pos.z + fv.z * 12) : 0;
        if (fv.w - t2 > 0.3) {
          if (b.plan.s && b._mode === 0 && threatOf(b.plan.s) > minThreat + 0.35 && simT - b.plan.t > 2) {
            dropPlan(b); b.plan = makePlan(b, kind, 0);
          }
          return false;                                        // the gradient has this one
        }
      }
    }
    return followPlan(b, urg);
  }

  /* THE BRAIN AS NUMBERS: what the crowd is doing about the current card.
     `shelters` lists [spots, cap, occupants] per building; `under` is how many
     living bodies are standing under a slab right now. */
  CBZ.survBrainAudit = function () {
    const out = { advice: adv ? adv.id + "/" + adv.phase + "/" + adv.kind : null, ep: advEp, plans: 0, herd: 0, look: 0, exit: 0, modes: [0, 0, 0], shelters: [] };
    const bots = CBZ.bots || [];
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (b.dead) continue;
      if (b.plan) { out.plans++; if (b.plan.herd) out.herd++; if (b.plan.exit) out.exit++; }
      if (b.state === "look") out.look++;
      if (b._seenEp === advEp && b._mode != null) out.modes[b._mode]++;
    }
    if (shelterReady()) for (let i = 0; i < shelters.length; i++) { const s = shelters[i]; spotsOf(s); out.shelters.push([s.spots.length, s.cap, s.up ? s.up.spots.length : 0, s.upCap, occ[i], +threatOf(s).toFixed(2)]); }
    return out;
  };

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

    // the survivor brain goes to the right KIND of place (see above); when it
    // has no plan (a panicker, a tornado, a sinkhole) the gradient below runs
    if (survOn() && CBZ.disasters && survivorThink(b)) return;

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
          // the town ring, not the volcano: a uniform draw inside 0.6 R put
          // a third of the island strolling up bare scoria on a live cone.
          // Same single draw (the count is match state), reshaped.
          const cone = arena.hills && arena.hills[0] ? arena.hills[0].r * 0.85 : 0;
          const d = cone + brnd() * Math.max(4, arena.radius * 0.84 - cone);
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
  function move(b, dt, animate, simD2) {
    const m = MV.motor(b);
    // fleeing reads urgency: a bot brushing a threat jogs (~1.55×), one caught
    // outside the closing zone or under a strike marker SPRINTS (~2.15×). A
    // body with a shark behind it is at the top of that scale by definition.
    const running = b.state === "flee" || b.state === "panic";
    const spd = running ? b.baseSpeed * (1.55 + 0.6 * (b.urg || 0)) : (b.state === "move" ? b.baseSpeed * 1.25 : b.baseSpeed);
    if (botTraverse(b, dt, spd)) { MV.reset(m, b.pos); return; }
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
    const depth = Math.max(0, waterDepth(b.pos.x, b.pos.z) - (b._lift || 0));
    b.wet = depth > 0.25;
    const wasSwim = !!b.swim;
    if (depth >= SWIM_ENTER) b.swim = true;
    else if (depth <= SWIM_LEAVE) b.swim = false;
    if (b.swim) { swimStep(b, m, dt, dx, dz, dist, depth, animate, !wasSwim); return; }
    if (wasSwim) MV.reset(m, b.pos);    // out of the water: the walk starts from rest
    if (wasSwim && b.char) {
      b.char.swimming = false;
      // the prone stroke turns the head; nothing on land ever resets that axis
      if (b.char.neck) b.char.neck.rotation.y = 0;
    }

    // ---- feet on the ground (or on the bed, in the shallows) ---------------
    // Wading is not a state, it is a scale: the water takes more of the step
    // the deeper it gets, and the walk cycle slows with it because b.speed is
    // what animChar reads. At depth 0 this is exactly 1.0 and nothing changed.
    // swim.js's own grading: sub = depth/BODY_H, and control is fully aquatic
    // at SWIM_BLEND (0.5) of a body height.
    const step = depth > 0.02 ? spd * (1 - WADE_SLOW * Math.min(1, depth / (BODY_H * 0.5))) : spd;
    // CBZ.moves carries the walk: speeds up and brakes into the spot (no
    // full-speed-then-dead-stop at half a metre), turns at a human rate, keeps
    // right past the people coming the other way. The rig reads the MEASURED
    // speed, so a body held on a wall or a boulder stands instead of running.
    // LOD is by distance to the PLAYER, never the camera: the walk is sim, and
    // the sim must match on every client (see the think cadence below).
    const O = _mo;
    O.speed = step;
    O.nbrs = CBZ.bots; O.nbrN = CBZ.bots.length;
    O.lod = MV.lodFor(simD2, true);
    // the stare: a body waiting to react, at its spot, turns to face the thing coming
    O.face = (dist <= 0.5 && b.state === "look" && b._lookX != null)
      ? Math.atan2(b._lookX - b.pos.x, b._lookZ - b.pos.z) : null;
    MV.step(m, b.pos, b.group.rotation.y, b.target.x, b.target.z, O, dt);
    b.group.rotation.y = m.yaw;
    b.speed = m.gs;
    if (dist > 0.5) {
      b._arrived = false;
    } else {
      /* YOU ARRIVE ONCE. This clamp ran on EVERY frame the body was within half
         a metre of its target, so `pause` was pinned at 0.4 and could never
         reach zero — and think()'s re-roll is gated on `pause <= 0`. A survivor
         that reached its spot therefore STOOD THERE FOR THE REST OF THE MATCH.

         The intent was obviously a floor applied ON ARRIVAL: stand here a beat
         before picking somewhere new. Latched, that is what it does. The dwell
         is per-body: `reactivity` is already one, so a twitchy survivor moves
         on in half a second and a placid one stands in the surf for four. */
      if (b.state === "wander" && !b._arrived) {
        b._arrived = true;
        b.pause = Math.max(b.pause, 0.5 + (+b.reactivity || 0) * 3.5);
      }
    }
    // bots walk the terrain only (they don't climb); pass their body span so the
    // height-gated upper-floor walls of buildings don't block them at ground level
    if (CBZ.collide) CBZ.collide(b.pos, BOT_RADIUS, b.pos.y, b.pos.y + 1.7);
    b.pos.y = CBZ.surv ? standY(b) : 0;
    if (animate) animChar(b.char, m.gs, dt);
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
  function swimStep(b, m, dt, dx, dz, dist, depth, animate, entered) {
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
      // a real stroke, flat on the water (character.js poseSwimmerProne):
      // about a third of the beach swims breaststroke, head up, the rest crawl
      st.prone = true;
      st.floatD = FLOAT_DEPTH;
      st.breast = ((r * 7.31) % 1) < 0.34;
    }
    const panic = b.state === "panic" || b.panicT > 0;
    const surf = seaAt(b.pos.x, b.pos.z);
    b._arrived = false;          // the land branch's arrival latch means nothing out here

    // HORIZONTAL. A stroke builds and bleeds; it does not start and stop like a
    // footfall, so the speed is eased rather than assigned and a body that
    // arrives keeps gliding for a beat.
    // HEADING: a swimmer comes round slowly (bounded rate through CBZ.moves.face,
    // never a lerp that whips a 180 in a few frames), and the stroke only drives
    // the body the way it is pointing, so a turning swimmer slows instead of
    // sliding sideways through the water.
    let gate = 1;
    if (dist > 0.8) {
      const wantYaw = Math.atan2(dx, dz);
      b.group.rotation.y = MV.face(m, b.group.rotation.y, wantYaw, dt, panic ? SWIM_TURN_PANIC : SWIM_TURN);
      const c = Math.cos(MV.wrap(wantYaw - b.group.rotation.y));
      gate = c > 0.9 ? 1 : Math.max(0.2, (c + 0.3) / 1.2);
    }
    const want = dist > 0.8 ? (panic ? PANIC_SPEED : SWIM_SPEED) * gate : 0;
    b.speed = damp(b.speed, want, panic ? 3.4 : 1.9, dt);
    if (dist > 1e-4 && b.speed > 1e-4) {
      b.pos.x += (dx / dist) * b.speed * dt;
      b.pos.z += (dz / dist) * b.speed * dt;
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
    if (entered) { b._floatY = b.pos.y; entrySplash(b, surf); MV.reset(m, b.pos); }
    b._floatY = b._floatY == null ? floatY : b._floatY + (floatY - b._floatY) * (1 - Math.exp(-6 * dt));

    // ANIMATION. Panic runs the cycle hot AND layers the thrash on top; both
    // ease, so a body that has just seen a fin comes apart over a beat rather
    // than switching animation.
    /* FLEEING IS SWIMMING, THRASHING IS WHAT HAPPENS WHEN IT FAILS. A panicked
       swimmer with a fin behind it sprints: a frantic head-up crawl, big kicks,
       glances back at the thing (st.look is its bearing off the body's nose).
       Only when the animal is right ON them do they come upright and go to
       pieces. The breaststroke is slower than the crawl and runs a longer
       cycle, so its cadence is eased down. */
    let foeD = 99;
    const foe = b.foe && !b.foe.dead && b.foe.pos ? b.foe : null;
    if (foe) {
      const fx = foe.pos.x - b.pos.x, fz = foe.pos.z - b.pos.z;
      foeD = Math.hypot(fx, fz);
      let rel = Math.atan2(fx, fz) - b.group.rotation.y;
      while (rel > Math.PI) rel -= 6.283185307; while (rel < -Math.PI) rel += 6.283185307;
      st.look = rel;
    } else st.look = 0;
    st.rate = panic ? 2.25 : (st.breast ? 0.8 : 1);
    st.flee = damp(st.flee || 0, panic ? 1 : 0, panic ? 5 : 2, dt);
    const close = panic ? Math.max(0, Math.min(1, (9 - foeD) / 5)) : 0;
    st.thrash = damp(st.thrash || 0, close, close > (st.thrash || 0) ? 5 : 3, dt);
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
    simT += dt;
    readAdvice();                                    // once per frame for the whole crowd
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
      if (CBZ.body && CBZ.body.busy(b)) { if (b._mv) MV.reset(b._mv, b.pos); continue; }   // thrown / knocked down / held → body owns it
      /* ABOARD A BOAT. world/sea_craft.js owns this body's position and pose
         while it is sitting in a hull — a wander leg here walks it off the
         deck and a swim leg drops it over the side, both of which this file
         did to every crewman on its first frame. The craft releases the flag
         when the man goes in the water (or is eaten). */
      if (b._aboard) { if (b._mv) MV.reset(b._mv, b.pos); continue; }
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
      move(b, dt, near, sdx * sdx + sdz * sdz);
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
          if (!a._p && !a.swim) a.pos.y = CBZ.surv ? standY(a) : 0;
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
