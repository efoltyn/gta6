/* ============================================================
   modes/shark_sim.js — SHARK SIM (a real mode on the disaster island).

   THE PITCH (owner): "you upgrade types of shark as you eat fish and npcs
   and orcas can kill you till megladon … put it on full nat disaster island
   water and put humans in random places around beach". And the control
   contract: "there's no control other than move that's needed … shark bites
   eats when there's something to bite in front already, all we need is
   pilot, it works all devices like nat disaster and prison game."

   So this file is deliberately thin. It BUILDS NOTHING physical:
     • the world is the disaster island — build()/reset() DELEGATE to
       modes/survival.js's descriptor, the exact shape gungame's ISLAND
       map already ships, so one island serves two games and survival's
       own descriptor is never touched;
     • the sea is already stocked (CBZ.cityWildlifeStock — fish, sharks,
       orca pods all live around this island since the wildlife seam);
     • the body is a native wildlife actor, ridden through the existing
       aquatic mount (wildlife_tame.js) — WASD/shift or the touch stick,
       exactly the piloting every device already has;
     • the bite is the mount's own attack, pulled automatically whenever
       the mount's own target selection says something is in front
       (CBZ.cityAquaticBiteProbe);
     • deaths go through the same buses as everything else: eaten
       survivors through CBZ.surv.hurt → the killfeed, the player's own
       death through killPlayer → spectate → the survival lose card.

   What it ADDS is the game: the evolution ladder (bull shark →
   hammerhead → great white → MEGALODON), mass from kills, the pod as the
   threat curve (the player's shark is marked `huntable`, the one flag
   marine_predation.js honours for exactly this file), the beach crowd as
   the larder (survivorbot.js wanders the shore ring while
   CBZ.sharkSimShoreRing is set, and respawns keep the buffet stocked so
   survival's last-one-standing check stays dormant), and the win: as the
   megalodon, eat the thing that eats sharks.

   DOOR: the Shark Sim tile on the title card, or ?mode=sharksim — a
   registered mode like any other in-build game. (The old door, a ?shark=1
   flag that hijacked whatever survival run it touched and then stuck in
   the URL so every later "Disaster Survival" run was secretly this game,
   is gone.) The disasters DIRECTOR is gated g.mode === "survival"
   (systems/disasters.js), so no disaster fires here: the island is calm
   and the pod is the whole threat curve.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  /* ---- SHOW, DON'T TELL ---------------------------------------------------
     Owner, 2026-08-25: "I HATE WORDS POPPING UP ON THE SCREEN. Like 'the pod
     has your scent' — it's dumb slop. SHOW don't tell."

     He is right, and the rule is categorical: a sentence that appears over
     the water mid-play is this file admitting it could not stage the thing it
     is describing. So every mid-play sentence is GONE and each one was
     replaced by the physical event it was narrating:

       "the pod has your scent"      -> podShow(): the orcas come UP, their
                                        dorsals cut, they leave wake, and the
                                        moment they commit is a hit of white
                                        water and a shake. No words.
       "YOU ARE THE <SPECIES>"       -> evolveBeat(): the body visibly SWELLS
       (the evolution banner)           out of the old one with a splash ring,
                                        a shake and a beat of slow motion.
       "point your mouth at food"    -> deleted. The bite is automatic; the
                                        first thing you eat teaches it.
       "Riding You · Fire bites..."  -> suppressed (the mount toast, which
                                        fired again on every evolution).

     What survives is a HUD, not a popup: one pill that holds the species name
     and the progress bar, and the title/end cards that own the screen when
     play is not happening.

     ?cfg_SHARK_SHOW_DONT_TELL=0 restores every line of the old text and
     silences the physical beats — that is the before/after preset's BEFORE. */
  function SDT() { return CFG.SHARK_SHOW_DONT_TELL !== false; }

  /* ---- THE LADDER. `need` is total mass eaten; mass comes off the meal's
     own hit points (massOf), so a mackerel is a snack and a human is a
     meal. The megalodon is the end of the ladder and the start of the win
     condition, not another rung. ---- */
  const LADDER = [
    { id: "bull_shark",        name: "BULL SHARK",       need: 0 },
    { id: "hammerhead_shark",  name: "GREAT HAMMERHEAD", need: 14 },
    { id: "great_white_shark", name: "GREAT WHITE",      need: 34 },
    { id: "megalodon",         name: "MEGALODON",        need: 75 },
  ];

  const sim = {
    on: false,          // a match is live and the player has a shark
    needsTeardown: false, // mount/rider/ring state is out; teardown() owes a restore
    ended: false,       // this match resolved (died or won) — stop driving
    apex: false,        // won as the megalodon
    match: 0,
    shark: null,
    tier: 0, mass: 0, eaten: 0,
    biteT: 0, hudT: 0, podT: 0, stockT: 0, strandT: 0, hintT: 0, winT: 0,
    waterline: 0,       // mean radius where the sea meets this island's sand
  };
  CBZ.sharkSim = sim;
  CBZ.sharkSimShoreRing = null;   // read by entities/survivorbot.js's wander
  sim.banner = function (big, small) { flash(big, small); };   // tooling seam: the before/after preset re-shows a beat's banner at capture time

  function depthMean(x, z) {
    return CBZ.survFloodDepthMeanAt ? Math.max(0, CBZ.survFloodDepthMeanAt(x, z)) : 0;
  }
  function seaYAt(x, z) {
    return CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) : -0.8;
  }
  function arena() { return CBZ.surv && CBZ.surv.arena; }
  function h01(a, b) { return CBZ.hash01 ? CBZ.hash01(a, b, 0x5aac01) : Math.random(); }

  /* Where the sea meets the sand, averaged around the island. Everything
     placed "on the beach" or "wading" hangs off this one number, and it is
     re-measured per match because a surge can move it. */
  function measureWaterline() {
    const A = arena(); if (!A) return 0;
    let sum = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 6.283;
      let lo = A.radius * 0.9, hi = A.radius + 44;
      for (let it = 0; it < 20; it++) {
        const mid = (lo + hi) / 2;
        if (depthMean(A.center.x + Math.cos(a) * mid, A.center.z + Math.sin(a) * mid) > 0.02) hi = mid;
        else lo = mid;
      }
      sum += (lo + hi) / 2;
    }
    return sum / 16;
  }

  // ---- the crowd: humans in random places around the beach --------------
  function relocateBots() {
    const A = arena(); if (!A || !CBZ.bots) return;
    const WL = sim.waterline;
    /* THE WADE BAND HAS TO BE WORTH SWIMMING TO. It used to end at WL+4,
       which on this foreshore (measured: 0.24 m at WL+2, 0.45 at WL+4, 0.83
       at WL+8, 0.97 at WL+10) is 0.43 m — the DEEPEST any bot ever stood,
       with a 0.15 m mean across the whole crowd. That was
       fine when the shark stopped half a metre out and pointless now that it
       grounds at a hand's depth: the crowd was a line of ankles. WL+9 puts
       the far edge just under a metre, so a real slice of the beach is people
       standing thigh-deep with something under them. `wl` is published for
       entities/survivorbot.js's wander, which shapes the same band. */
    CBZ.sharkSimShoreRing = { cx: A.center.x, cz: A.center.z, r0: A.radius * 1.02, r1: WL + 9, wl: WL };
    for (let i = 0; i < CBZ.bots.length; i++) {
      const b = CBZ.bots[i];
      if (!b || b.dead) continue;
      const roll = h01(i * 1.71 + 3, sim.match);
      if (roll > 0.86) continue;                       // a few stay inland
      const a = h01(i * 2.13 + 9, sim.match) * 6.283;
      const wade = roll > 0.55;                        // ~a third of the crowd is IN the water
      const r = wade ? (WL - 1 + h01(i, sim.match + 7) * 10)
                     : (A.radius * 1.03 + h01(i, sim.match + 11) * Math.max(4, WL - 3 - A.radius * 1.03));
      b.pos.x = A.center.x + Math.cos(a) * r;
      b.pos.z = A.center.z + Math.sin(a) * r;
      b.pos.y = CBZ.surv.floorAt(b.pos.x, b.pos.z);
      b.target.set(b.pos.x, 0, b.pos.z);
      b.pause = 0.5 + h01(i, sim.match + 13) * 3;
    }
  }

  function liveBots() {
    let n = 0; const b = CBZ.bots || [];
    for (let i = 0; i < b.length; i++) if (!b[i].dead) n++;
    return n;
  }
  function restock(dt) {
    sim.stockT -= dt;
    if (sim.stockT > 0) return;
    sim.stockT = 1.0;
    if (!CBZ.spawnSurvivorBotAt) return;
    const A = arena(); if (!A) return;
    // keep the buffet stocked — this is also what keeps survival's
    // last-one-standing win check permanently dormant while the sim runs
    let want = 40 - liveBots();
    want = Math.min(3, want);
    for (let i = 0; i < want; i++) {
      const a = Math.random() * 6.283;
      const r = A.radius * 1.03 + Math.random() * Math.max(4, sim.waterline - 2 - A.radius * 1.03);
      CBZ.spawnSurvivorBotAt(A.center.x + Math.cos(a) * r, A.center.z + Math.sin(a) * r);
    }
  }

  // ---- the shark ---------------------------------------------------------
  function claim(a) {
    a.tamed = true;         // the mount system's key
    a.huntable = true;      // ..and marine_predation's exception: the pod may still eat you
    a.petName = "You";
    a.alarm = 0; a.state = "wander"; a.stateT = 0;
  }
  function despawn(a) {
    if (!a) return;
    a.dead = true; a.huntable = false; a.tamed = false;
    if (a.group && a.group.parent) a.group.parent.remove(a.group);
    const list = CBZ.cityWildlife || [];
    const i = list.indexOf(a);
    if (i >= 0) list.splice(i, 1);
  }
  function findWild(id) {
    const list = CBZ.cityWildlife || [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a && !a.dead && !a.external && !a.tamed && !a.ridden && a.species && a.species.id === id && a.grow == null) return a;
    }
    return null;
  }
  function placeShark(a) {
    const A = arena(), P = CBZ.player;
    // just offshore of wherever the match dropped the player, so the swap
    // from castaway to shark reads instantly
    const ang = Math.atan2(P.pos.z - A.center.z, P.pos.x - A.center.x) || 0;
    const r = sim.waterline + 26;
    const x = A.center.x + Math.cos(ang) * r, z = A.center.z + Math.sin(ang) * r;
    a.pos.x = x; a.pos.z = z;
    a.pos.y = seaYAt(x, z) - (a.swimDepth || 1.2);
    a.home = { x: x, z: z };
    a.heading = ang + Math.PI / 2; a.faceH = a.heading;
    if (a._waterMove) { a._waterMove.x = x; a._waterMove.z = z; a._waterMove.heading = a.heading; a._waterMove.blocked = false; }
  }
  function mountShark() {
    const S = sim.shark;
    if (!S || S.dead || !CBZ.cityMountAnimal) return;
    const cur = CBZ.cityMountedAnimal && CBZ.cityMountedAnimal();
    if (cur === S) return;                 // cityMountAnimal TOGGLES — never call it on the current mount
    if (cur && CBZ.cityDismount) CBZ.cityDismount();
    /* SILENTLY. The mount system announces itself with a toast ("Riding You ·
       Fire bites; E dismounts.") which is correct for a city pet and wrong
       here twice over: there is no dismount key in this game and the mount
       re-binds on EVERY evolution, so the toast fired four times a match to
       tell you about a control you do not have. Gag it for exactly this call
       and put it straight back — the city's own toast is untouched. */
    const city = CBZ.city;
    const note0 = SDT() && city && city.note;
    if (note0) city.note = function () {};
    try { CBZ.cityMountAnimal(S); } finally { if (note0) city.note = note0; }
  }

  function orcas(fn) {
    const list = CBZ.cityWildlife || [];
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a && !a.dead && !a.external && a.species && a.species.id === "orca") { n++; if (fn) fn(a); }
    }
    return n;
  }
  /* The threat curve. The pod already exists (stocked with the island's
     sea); this keeps it real: a match that starts with the orcas hunted out
     gets a fresh pod in deep water, and orcas that catch the scent stay
     motivated (hunger is what marine_predation hunts on). */
  /* ---- THE POD, SHOWN --------------------------------------------------
     This is what "the pod has your scent" became. The words said a thing was
     true; this makes it VISIBLE from a shark's eye-level camera, using only
     what the sea already owns:

       • THEY TURN AND COME AT YOU. Three fins milling on their own errands
         and three fins all pointed at you are completely different pictures,
         and only the second one is a threat you can read. A clamped nudge of
         each locked orca's heading toward you — the same blend wildlife_orca
         uses to make a spy-hop actually LOOK at the boat, never a snap — is
         what turns the pod into a convergence.
       • THEY LEAVE WAKE. One marineSurfaceHit behind each locked orca, a few
         times a second, scaled by how close it is: white water converging on
         you from three directions is the read, and it gets faster as they do.
       • THEY MEAN IT. hunger is what marine_predation hunts on; locked orcas
         are pinned at the top of it, every frame, not once every eight seconds.
       • AND THERE IS A MOMENT. The frame the lock trips — the exact frame that
         used to print the sentence — the nearest one hits the surface hard and
         the camera takes it. That is the sentence, in water.

     WHAT THIS DELIBERATELY DOES NOT DO, and it was measured before it was
     cut: an earlier version also halved each locked orca's draft (swimDepth)
     to bring the dorsals up. The preset's own numbers killed it — a closing
     pod already rides 0.37 m under the surface, so the write bought nothing
     visible, and raising them off the shark's depth band cost them contact on
     the flank pass. The fin was never the missing thing; the CONVERGENCE was.

     Same 55/75 m hysteresis the text used: the threshold keeps its meaning,
     only its expression changed. */
  const podLocked = [];              // the orcas currently in the read
  const POD_TURN = 0.11;             // rad per scan of steering authority we borrow
  function podRestore() {
    podLocked.length = 0;
    sim._podClose = false;
  }
  function shortest(a) {
    while (a > Math.PI) a -= 6.283185307;
    while (a < -Math.PI) a += 6.283185307;
    return a;
  }
  function podShow(dt) {
    if (!SDT() || sim.tier >= 3) { if (podLocked.length) podRestore(); return; }
    const P = CBZ.player;
    sim.podScanT = (sim.podScanT || 0) - dt;
    sim.podWakeT = (sim.podWakeT || 0) - dt;
    if (sim.podScanT > 0 && sim.podWakeT > 0) return;
    const scan = sim.podScanT <= 0;
    if (scan) sim.podScanT = 0.2;
    let near = 1e9, nearest = null;
    podLocked.length = 0;
    orcas(function (a) {
      const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
      if (d < near) { near = d; nearest = a; }
      if (d > 110) return;
      podLocked.push(a);
    });
    // enter at 55 m, let go at 75 — a read that flickers is a read ignored
    const was = !!sim._podClose;
    sim._podClose = near < (was ? 75 : 55);
    for (let i = 0; i < podLocked.length; i++) {
      const a = podLocked[i];
      const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
      a.hunger = Math.max(a.hunger || 0, sim._podClose ? 1 : 0.9);
      const k = Math.max(0, Math.min(1, (d - 18) / 92));
      // CONVERGE. Borrowed authority, not seized: a clamped step toward the
      // bearing to you, so the mover keeps owning the turn and the fins come
      // round rather than snapping. Only while the lock holds.
      if (scan && sim._podClose && a.heading != null) {
        const want = Math.atan2(P.pos.z - a.pos.z, P.pos.x - a.pos.x);
        const dh = shortest(want - a.heading);
        a.heading += Math.max(-POD_TURN, Math.min(POD_TURN, dh));
        if (a._waterMove) a._waterMove.heading = a.heading;
      }
      // THE WAKE, behind the fin, faster the nearer it is.
      if (sim.podWakeT <= 0 && CBZ.marineSurfaceHit && d < 95) {
        const L = CBZ.marineBodyLen ? CBZ.marineBodyLen(a) : 7;
        const h = a.heading || 0;
        try {
          CBZ.marineSurfaceHit(a.pos.x - Math.cos(h) * L * 0.35, a.pos.z - Math.sin(h) * L * 0.35,
            0.6 + (1 - k) * 1.3);
        } catch (e) {}
      }
    }
    if (sim.podWakeT <= 0) sim.podWakeT = sim._podClose ? 0.28 : 0.55;
    // THE COMMIT. The frame the old text appeared, staged instead.
    if (sim._podClose && !was && nearest) {
      sim.podShows = (sim.podShows || 0) + 1;
      const x = nearest.pos.x, z = nearest.pos.z;
      if (CBZ.waterSplashAt) { try { CBZ.waterSplashAt(x, seaYAt(x, z), z, 3.2); } catch (e) {} }
      if (CBZ.marineSurfaceHit) { try { CBZ.marineSurfaceHit(x, z, 3.4); } catch (e) {} }
      if (CBZ.shake) CBZ.shake(0.32);
      if (CBZ.sfx) { try { CBZ.sfx("hit", { volume: 0.35 }); } catch (e) {} }
    }
  }

  function podPressure(dt) {
    sim.podT -= dt;
    if (sim.podT > 0) return;
    sim.podT = 8;
    const A = arena(), P = CBZ.player;
    let alive = orcas(function (a) {
      const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
      if (d < 160 && sim.tier < 3) a.hunger = Math.max(a.hunger || 0, 0.9);
    });
    const wantPod = sim.tier < 3 ? 3 : 1;   // the megalodon still needs ONE orca to exist — it's the win
    if (alive < wantPod && CBZ.cityWildlifeSpawnAt) {
      const ang = Math.random() * 6.283;
      for (let i = alive; i < wantPod; i++) {
        const r = sim.waterline + 90 + i * 14;
        const a2 = CBZ.cityWildlifeSpawnAt("orca",
          A.center.x + Math.cos(ang + i * 0.3) * r, A.center.z + Math.sin(ang + i * 0.3) * r);
        if (a2) a2.hunger = 0.8;
      }
    }
  }

  // ---- meals -------------------------------------------------------------
  function massOf(kind, target) {
    if (kind === "survivor" || kind === "ped" || kind === "cop") return 5;
    const hp = (target && (target.maxHp || (target.species && target.species.hp))) || 20;
    return Math.max(1, Math.round(hp / 25));
  }
  CBZ.sharkSimBite = function (kind, target, eater) {
    if (!sim.on || sim.ended || !eater || eater !== sim.shark) return;
    if (!target || !(target.dead || target.hp <= 0)) return;   // a chomp is not a meal until it kills
    const gain = massOf(kind, target);
    sim.mass += gain; sim.eaten++;
    const S = sim.shark;
    if (S && S.maxHp) S.hp = Math.min(S.maxHp, S.hp + S.maxHp * (0.05 + Math.min(0.25, gain * 0.012)));
    if (kind === "animal" && target.species && target.species.id === "orca" && sim.tier >= 3) { apexWin(); return; }
    const next = LADDER[sim.tier + 1];
    if (next && sim.mass >= next.need) evolve();
    else hudNow();
  };

  function evolve() {
    const S0 = sim.shark, next = LADDER[sim.tier + 1];
    if (!S0 || !next || !CBZ.cityWildlifeSpawnAt) return;
    const x = S0.pos.x, z = S0.pos.z, y = S0.pos.y, hd = S0.heading || 0;
    const S1 = CBZ.cityWildlifeSpawnAt(next.id, x, z);
    if (!S1) return;                        // spawn failed: stay this species, try again next meal
    sim.tier++;
    S1.pos.y = y; S1.heading = hd; S1.faceH = hd;
    if (S1._waterMove) { S1._waterMove.x = x; S1._waterMove.z = z; S1._waterMove.heading = hd; }
    claim(S1);
    if (CBZ.cityDismount) CBZ.cityDismount();
    despawn(S0);
    sim.shark = S1;
    mountShark();
    if (SDT()) evolveBeat(S1, x, z);
    else {
      if (CBZ.waterSplashAt) CBZ.waterSplashAt(x, seaYAt(x, z), z, 3.6);
      if (CBZ.shake) CBZ.shake(0.55);
      if (CBZ.sfx) { try { CBZ.sfx("win", { volume: 0.5 }); } catch (e) {} }
      flash("YOU ARE THE " + next.name,
        sim.tier >= 3 ? "Now eat an orca." : "Next: " + LADDER[sim.tier + 1].name);
    }
    hudNow();
  }

  /* ---- WHAT EVOLVING LOOKS LIKE ----------------------------------------
     The banner said "YOU ARE THE GREAT WHITE" over a body that had already
     silently been swapped for a bigger one between two frames. Nobody ever
     SAW the growth — which is the one thing this whole ladder is about.

     So the new body starts at the OLD body's size and swells into its own
     over three quarters of a second, with an overshoot at the top so it lands
     with weight; the sea breaks in a ring around it; the screen shakes and
     time drops to a third for a beat so you cannot miss it. No words.

     growTick() owns group.scale for the duration and hands it back exactly
     (growTo is captured from the authored scale, never recomputed), so a
     ceremony interrupted by a death or a mode change cannot leave a shark
     stuck half-size — teardown/setup clear it too. */
  function evolveBeat(S1, x, z) {
    const gsc = S1.group && S1.group.scale;
    if (gsc) {
      const prev = LADDER[sim.tier - 1];
      const from = (prev && CBZ.WILDLIFE_SPECIES && CBZ.WILDLIFE_SPECIES[prev.id] &&
        CBZ.WILDLIFE_SPECIES[prev.id].scale) || 0;
      const to = gsc.x || 1;
      const own = (S1.species && S1.species.scale) || to;
      /* THE FLOOR AND THE CEILING ARE BOTH DELIBERATE. Starting the swell at
         the previous species' true size ratio is the honest number and it is
         a bad beat: a hammerhead and a great white are authored close enough
         that the ratio is 0.9, so the "growth" was a 10% twitch nobody would
         see (measured on the preset, which is what caught it). Cap the start
         at 0.7 so every rung arrives with real mass, and floor it at 0.32 so
         the megalodon does not erupt out of a marble. */
      sim.grow = {
        a: S1, t: 0, dur: 0.75, to: to,
        from: to * Math.max(0.32, Math.min(0.70, from > 0 && own > 0 ? from / own : 0.55)),
      };
      gsc.setScalar(sim.grow.from);
    }
    const y = seaYAt(x, z);
    if (CBZ.waterSplashAt) {
      try {
        CBZ.waterSplashAt(x, y, z, 4.6);
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * 6.283 + 0.4, r = 3.4;
          CBZ.waterSplashAt(x + Math.cos(ang) * r, y, z + Math.sin(ang) * r, 2.4);
        }
      } catch (e) {}
    }
    if (CBZ.marineSurfaceHit) { try { CBZ.marineSurfaceHit(x, z, 4); } catch (e) {} }
    if (CBZ.shake) CBZ.shake(1.0);
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.42);
    if (CBZ.sfx) { try { CBZ.sfx("win", { volume: 0.5 }); } catch (e) {} }
    sim.evolveBeats = (sim.evolveBeats || 0) + 1;
  }
  function growTick(dt) {
    const G = sim.grow; if (!G) return;
    const gsc = G.a && G.a.group && G.a.group.scale;
    if (!gsc || G.a.dead || G.a !== sim.shark) { sim.grow = null; if (gsc) gsc.setScalar(G.to); return; }
    G.t += dt;
    const e = Math.min(1, G.t / G.dur);
    // ease-out with a 6% overshoot that settles: mass arriving, not a lerp
    const k = 1 - Math.pow(1 - e, 3);
    const over = Math.sin(e * Math.PI) * 0.06;
    gsc.setScalar(G.from + (G.to - G.from) * k + G.to * over);
    if (e >= 1) { gsc.setScalar(G.to); sim.grow = null; }
  }
  function growClear() {
    const G = sim.grow; if (!G) return;
    const gsc = G.a && G.a.group && G.a.group.scale;
    if (gsc) gsc.setScalar(G.to);
    sim.grow = null;
  }

  /* THE WIN CARD DOES NOT CUT THE FINISH OFF. Killing an orca as the
     megalodon starts wildlife_tame's clamp/death-roll ceremony, and the old
     code put the victory screen up on the same frame — so the one shot this
     whole game builds toward was covered by a card before it happened. Hold
     the win until the jaws let go (plus a beat), then resolve exactly as
     before. sim.ended is still set immediately, so nothing else can start. */
  function apexWin() {
    if (sim.ended) return;
    const hold = CBZ.cityAquaticClampT ? CBZ.cityAquaticClampT() : 0;
    if (hold > 0 && SDT()) {
      sim.ended = true; sim.apex = true;
      sim.winT = hold + 0.7;
      return;
    }
    apexResolve();
  }
  function apexResolve() {
    sim.winT = 0;
    sim.ended = true; sim.apex = true;
    restoreRider();
    hideHud();                           // the win card owns the screen now
    if (CBZ.surv && CBZ.surv.stats) CBZ.surv.stats.placement = 1;
    if (CBZ.winGame) CBZ.winGame("apex");
    const sub = document.querySelector("#survwin .sub");
    if (sub) sub.textContent = "APEX PREDATOR — you ate the thing that eats sharks";
  }

  function onSharkDead() {
    if (sim.ended) return;
    sim.ended = true;
    restoreRider();
    hideHud();                           // ELIMINATED + spectate own the screen now
    g.invuln = 0;                        // drop the rider shield so the kill lands
    const S = sim.shark;
    if (CBZ.surv && CBZ.surv.hurt) {
      CBZ.surv.hurt(CBZ.surv.playerActor, 1e6, {
        cause: "eaten by the pod",
        fromX: S ? S.pos.x : CBZ.player.pos.x + 1, fromZ: S ? S.pos.z : CBZ.player.pos.z, fling: 4,
      });
    }
  }

  // ---- the rider is a passenger, not a picture ---------------------------
  function hideRider() {
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = false;
  }
  function restoreRider() {
    if (CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.visible = true;
  }

  /* BEACHING IS A MOVE, AND THIS IS ONLY THE SAFETY NET.
     A sprint up the swash or a breach that lands past the waterline leaves
     the body genuinely aground — belly on sand, jaws still working, movement
     reduced to a thrash. That is the whole point, so nothing here interrupts
     it. Your own thrashing gets BEACH_PATIENCE seconds to work the animal
     back to the sea; only after that does the island quietly help, ramping a
     seaward slide so a player who has run out of ideas cannot be softlocked
     on the sand. No damage — orcas do this deliberately.

     WHAT WAS WRONG. Three things. (1) The thresholds were a second, private
     copy of the ride's shore law, and they disagreed with it: it triggered at
     0.30 m and only released at 0.50 m — deeper than the water a great white,
     a hammerhead or a megalodon was allowed to swim in — so the "rescue" was
     a conveyor ring nine feet off the beach that shoved the shark away from
     the entire crowd standing on it. It now ASKS the ride
     (CBZ.cityAquaticShoreLaw) instead of guessing. (2) Between 0.10 m and
     0.50 m the timer was neither advanced nor cleared, so a body that crawled
     into that band froze whatever count it arrived with. The timer now has
     honest hysteresis: it runs from aground until genuinely swimmable.
     (3) It fired after 0.6 s at a flat 3.2 m/s, which is faster than the
     beaching itself — you could not stay beached long enough to eat. */
  const BEACH_PATIENCE = 3.4;          // seconds of your own thrashing before the island helps
  function strandedFix(dt) {
    const A = arena(), P = CBZ.player;
    if (!A) return;
    const law = CBZ.cityAquaticShoreLaw && CBZ.cityAquaticShoreLaw();
    const ground = law ? law.ground : 0.22;
    const release = law ? law.release : 0.38;
    const d = depthMean(P.pos.x, P.pos.z);
    if (d >= release) { sim.strandT = 0; return; }      // swimming again: hands off
    if (d >= ground && sim.strandT <= 0) return;        // shallow, but not aground
    // A PLAYER STILL THRASHING IS NOT STUCK. Working the body over the sand is
    // the escape; the clock runs at half rate against it, so a deliberate
    // beaching lasts about seven seconds of effort and an ABANDONED one about
    // three and a half. (Without this, holding W up the beach was fought by
    // the rescue at 2.6 m/s and you could not stay beached long enough to eat.)
    sim.strandT += dt * (law && law.moving ? 0.5 : 1);
    if (sim.strandT < BEACH_PATIENCE) return;
    // ..and then a ramp, not a shove: deeper is always radially outward here.
    const dx = P.pos.x - A.center.x, dz = P.pos.z - A.center.z;
    const rr = Math.hypot(dx, dz) || 1;
    const slide = Math.min(2.6, 0.7 + (sim.strandT - BEACH_PATIENCE) * 1.6);
    P.pos.x += (dx / rr) * slide * dt;
    P.pos.z += (dz / rr) * slide * dt;
  }

  // ---- HUD ---------------------------------------------------------------
  let hud = null, hudLine1 = null, hudBar = null, hudLine2 = null, flashEl = null, flashSub = null;
  function buildHud() {
    if (hud) { hud.style.display = "block"; return; }
    hud = document.createElement("div");
    hud.id = "sharkhud";
    hud.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:45;" +
      "pointer-events:none;font-family:Fredoka,system-ui,sans-serif;text-align:center;" +
      "background:rgba(8,12,20,.62);border-radius:14px;padding:7px 16px 9px;min-width:230px;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.35)";
    hudLine1 = document.createElement("div");
    hudLine1.style.cssText = "color:#eaf4ff;font-size:17px;font-weight:700;letter-spacing:1px";
    const barWrap = document.createElement("div");
    barWrap.style.cssText = "height:6px;border-radius:3px;background:rgba(255,255,255,.14);margin:5px 0 4px;overflow:hidden";
    hudBar = document.createElement("div");
    hudBar.style.cssText = "height:100%;width:0%;border-radius:3px;background:linear-gradient(90deg,#39c06a,#9fe870);transition:width .25s ease";
    barWrap.appendChild(hudBar);
    hudLine2 = document.createElement("div");
    hudLine2.style.cssText = "color:#bcd0e2;font-size:12.5px";
    hud.appendChild(hudLine1); hud.appendChild(barWrap); hud.appendChild(hudLine2);
    document.body.appendChild(hud);
    flashEl = document.createElement("div");
    flashEl.id = "sharkflash";
    flashEl.style.cssText = "position:fixed;left:0;right:0;top:26vh;z-index:46;pointer-events:none;text-align:center;" +
      "font-family:Fredoka,system-ui,sans-serif;font-weight:700;font-size:clamp(30px,6vw,54px);color:#9fe870;" +
      "letter-spacing:2px;text-shadow:0 4px 0 #14532d,0 8px 18px rgba(0,0,0,.55);opacity:0;transition:opacity .5s ease";
    flashSub = document.createElement("div");
    flashSub.style.cssText = "font-size:clamp(14px,2.4vw,20px);color:#eaf4ff;letter-spacing:1px;text-shadow:0 2px 6px rgba(0,0,0,.6);margin-top:6px";
    flashEl.appendChild(flashSub);
    document.body.appendChild(flashEl);
  }
  let flashTimer = 0;
  function flash(big, small) {
    if (!flashEl) return;
    if (flashEl.firstChild && flashEl.firstChild !== flashSub) flashEl.removeChild(flashEl.firstChild);
    flashEl.insertBefore(document.createTextNode(big), flashSub);
    flashSub.textContent = small || "";
    flashEl.style.opacity = "1";
    flashTimer = 2.8;
  }
  function hudNow() { sim.hudT = 0; }
  /* ONE pill, and under SHOW-DON'T-TELL it holds no sentences at all: the
     species you are, a bar for how far the next form is, and the NAME of that
     next form as a label — the kind of thing a HUD is for. Everything this
     line used to narrate (the pod, the opening hint) now happens in the water
     instead; see podShow() and evolveBeat(). The shark's health is NOT
     repeated here — the bottom health bar already mirrors it, and a HUD that
     says the same number twice is a HUD shouting. */
  function hudTick(dt) {
    if (!hud) return;
    if (flashTimer > 0) { flashTimer -= dt; if (flashTimer <= 0) flashEl.style.opacity = "0"; }
    sim.hudT -= dt;
    if (sim.hudT > 0) return;
    sim.hudT = 0.25;
    const S = sim.shark; if (!S) return;
    const show = SDT();
    hudLine1.textContent = LADDER[sim.tier].name;
    const next = LADDER[sim.tier + 1];
    if (next) {
      const prev = LADDER[sim.tier].need;
      hudBar.style.width = Math.min(100, Math.round(100 * (sim.mass - prev) / (next.need - prev))) + "%";
      hudLine2.textContent = show
        ? "→ " + next.name
        : "eat " + Math.max(0, next.need - sim.mass) + " more → " + next.name;
    } else {
      hudBar.style.width = "100%";
      hudLine2.textContent = show ? "→ ORCA" : "eat an orca";
    }
    hudLine2.style.color = "#bcd0e2";
    // Everything past this point is the OLD TEXT and only runs with the flag
    // off. podShow() owns the pod read now, and it owns it in the water.
    if (show) return;
    if (sim.tier < 3) {
      const P = CBZ.player;
      let near = 1e9;
      orcas(function (a) { const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z); if (d < near) near = d; });
      // enter at 55 m, let go at 75 — a warning that flickers is a warning ignored
      sim._podClose = near < (sim._podClose ? 75 : 55);
      if (sim._podClose) {
        hudLine2.textContent = "the pod has your scent";
        hudLine2.style.color = "#ffd06b";
        sim.hintT = 0;
      }
    } else sim._podClose = false;
    if (sim.hintT > 0) hudLine2.textContent = "point your mouth at food — the bite is automatic";
  }
  function hideHud() {
    if (hud) hud.style.display = "none";
    if (flashEl) flashEl.style.opacity = "0";
  }

  // ---- match lifecycle ---------------------------------------------------
  function setup() {
    const A = arena(); if (!A) { sim.lastSetup = "no-arena"; return; }
    sim.match++;
    despawn(sim.shark);                     // last match's body never lingers
    sim.shark = null;
    sim.tier = 0; sim.mass = 0; sim.eaten = 0;
    sim.ended = false; sim.apex = false;
    sim.biteT = 0; sim.podT = 2; sim.stockT = 3; sim.strandT = 0; sim.hudT = 0; sim.hintT = 5;
    sim._podClose = false; sim.winT = 0;
    podRestore(); growClear();
    sim.podScanT = 0; sim.podWakeT = 0; sim.grow = null;
    sim.waterline = measureWaterline();
    relocateBots();
    // heal a boot race: PLAY clicked before wildlife.js parsed leaves the
    // island unstocked (survival.reset now heals this too; belt and braces
    // because this mode is UNPLAYABLE without a sea)
    if (!(CBZ.cityWildlife && CBZ.cityWildlife.length) && CBZ.cityWildlifeStock) {
      try { CBZ.cityWildlifeStock(A); } catch (e) {}
    }
    let S = findWild("bull_shark");
    sim.lastSetup = S ? "wild" : "spawn";
    if (!S && CBZ.cityWildlifeSpawnAt) S = CBZ.cityWildlifeSpawnAt("bull_shark", A.center.x + sim.waterline + 26, A.center.z);
    if (!S) { sim.lastSetup = "no-shark"; return; }   // wildlife absent — no shark to be; retry next frame
    placeShark(S);
    claim(S);
    sim.shark = S;
    mountShark();
    hideRider();          // the frame you BECOME the shark, not the one after:
                          // step() used to own this and the oracle caught the
                          // one-frame window where a man sits on the shark
    buildHud();
    hudNow();
    flash("YOU ARE THE SHARK", "eat fish and swimmers · avoid the pod · become the MEGALODON");
    sim.on = true;
    sim.needsTeardown = true;
  }

  function teardown() {
    // The mount must not outlive the game: a stale ride binding keeps
    // P._mountedAnimal pointing at a shark in another mode's sea and holds
    // survival's own verb panel suppressed. Dismount only OUR shark — a pet
    // the player mounted elsewhere is none of this file's business.
    const cur = CBZ.cityMountedAnimal && CBZ.cityMountedAnimal();
    if (cur && cur === sim.shark && CBZ.cityDismount) { try { CBZ.cityDismount(); } catch (e) {} }
    restoreRider();
    hideHud();
    g.invuln = 0;                        // never leak the rider shield into another mode
    CBZ.sharkSimShoreRing = null;
    podRestore();                        // every orca we raised goes back to its own draft
    growClear();                         // and no shark is left frozen mid-swell
    if (sim.shark) { sim.shark.huntable = false; }   // whatever survives goes back to being a pet
    sim.on = false;
    sim.needsTeardown = false;
  }

  function step(dt) {
    const P = CBZ.player, S = sim.shark;
    sim.stepN = (sim.stepN || 0) + 1;          // heartbeat for tools/shark-sim-check.mjs
    if (!S) return;
    if (sim.ended) {
      if (sim.winT > 0) { sim.winT -= dt; growTick(dt); if (sim.winT <= 0) apexResolve(); }
      hudTick(dt);
      return;
    }
    if (S.dead) { onSharkDead(); return; }
    if (sim.hintT > 0) sim.hintT -= dt;
    // the HUD health bar IS the shark — the rider has no separate body here.
    // Floor at 1 so nothing else mistakes the mirror for a death; the only
    // way to die is the shark dying, and that path is explicit above.
    P.hp = Math.max(1, Math.round(100 * S.hp / (S.maxHp || 1)));
    // ..and the rider is not separately killable: the shark's own death is
    // the ONE mortality in this game (onSharkDead, which drops this shield
    // first). Anything that would kill the HUMAN off the shark's back — a
    // stray blast, an animal that targets the rider — lands on the mirror.
    if ((g.invuln || 0) < 2) g.invuln = 2;
    if (!P.dead) {
      mountShark();                          // E/dismount is not a control in this game
      hideRider();
      strandedFix(dt);
      sim.biteT -= dt;
      if (sim.biteT <= 0) {
        sim.biteT = 0.12;
        const pick = CBZ.cityAquaticBiteProbe && CBZ.cityAquaticBiteProbe();
        if (pick && CBZ.cityMountedAnimalAttack) {
          sim.fireN = (sim.fireN || 0) + 1;    // heartbeat: trigger pulls
          CBZ.cityMountedAnimalAttack(true);
        }
      }
    }
    podPressure(dt);
    podShow(dt);
    growTick(dt);
    restock(dt);
    hudTick(dt);
  }

  CBZ.onAlways(94, function (dt) {
    if (!dt || dt > 0.5) dt = 0.05;
    // needsTeardown, not sim.on, is the restore trigger: after a win/loss
    // sim.on is already false (the card owns the screen, the megalodon stays
    // visible under it) but the mount, the rider state and the shore ring
    // are still out — leaving this mode by ANY route must put them back.
    if (g.mode !== "sharksim") { if (sim.needsTeardown) teardown(); return; }
    const st = g.state;
    if (st !== "playing") {
      if (sim.needsTeardown && st === "title") teardown();
      else if (sim.on && (st === "won" || st === "lost")) { restoreRider(); hideHud(); sim.on = false; }
      return;
    }
    if (!sim.on) setup();
    else step(dt);
  });

  /* ---- the mode's face: same island, different game ----------------------
     Registered like every other in-build game (config.js CBZ.registerMode),
     standing the island up by DELEGATING to survival's descriptor — the
     exact shape gungame's ISLAND map ships (modes/gungame.js
     MAPS.island.ensure). Survival's own descriptor is never touched.

     Ground height dispatches on the exact mode string
     (systems/solidground.js), so sharksim declares the island's field under
     its own key — lazily, because the arena may not exist until first build. */
  CBZ.registerGroundBase("sharksim", function (x, z) {
    const A = CBZ.surv && CBZ.surv.arena;
    return A ? A.groundHeightAt(x, z) : 0;
  });
  CBZ.registerMode("sharksim", {
    id: "sharksim",
    label: "Shark Sim",
    objective: "YOU ARE THE SHARK. Swim with your move keys (sprint to lunge) — the bite is automatic when prey is in front of your mouth. Eat fish and the people off the beach, grow through HAMMERHEAD and GREAT WHITE, and stay away from the orca pod until you are the MEGALODON. Then eat an orca.",
    build() {
      const m = CBZ.modes.survival;
      if (m && m.build) { try { m.build(); } catch (e) { console.error("[sharksim build]", e); } }
    },
    reset(game) {
      /* survival's reset stands the WHOLE island up: arena visible + reset,
         the bot crowd, the player spawn, the env baseline, the killfeed. It
         also arms CBZ.disasters.start() — harmless here, the director's tick
         is gated g.mode === "survival" (systems/disasters.js), so no
         disaster ever fires in this mode. The shark side of the match stands
         up one frame later, in the onAlways(94) hook's setup(). */
      const m = CBZ.modes.survival;
      if (m && m.reset) m.reset(game);
    },
    /* The capability declaration systems/modecaps.js reads off this
       descriptor: same island verbs as survival, every funnel routed to
       survival's own buses — this game's people ARE the island's crowd. */
    caps: { traverse: 1, stepLedge: 1, blast: 1, blastActors: 1, breach: 1 },
    actors(out) {
      const b = CBZ.bots || [];
      for (let i = 0; i < b.length; i++) out.push(b[i]);
      return out;
    },
    hurt(a, dmg, imp) {
      if (!CBZ.surv || !CBZ.surv.hurt) return false;
      CBZ.surv.hurt(a, dmg, imp);
      return true;
    },
    hurtPlayer(dmg, x, z, cause) {
      if (!CBZ.surv || !CBZ.surv.hurt) return false;
      CBZ.surv.hurt(CBZ.surv.playerActor, dmg, { fromX: x, fromZ: z, fling: 4, cause: cause });
      return true;
    },
    route: "surv.hurt (survival's island buses)",
  });
})();
