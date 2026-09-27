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
     • the meals go through the same buses as everything else: eaten
       survivors through CBZ.surv.hurt → the killfeed. YOUR OWN death does
       not — it is the shark that dies, not the man riding it, so it is
       owned here (see DYING) and never touches survival's killPlayer,
       its ragdoll, its placement or its battle-royale spectate.

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

     And in the wave after that the pill itself went (2026-08-25): the species
     name, the "→ NEXT" label and the box around them are deleted, because a
     ladder whose whole point is a body that visibly grows does not need to
     print what that body already is. And on 2026-09-27 the rest went too:
     score pill, clock, health/stamina bars, evolve sliver, killfeed. Nothing
     is printed mid-play; hunger is the red screen edge, growth is the body,
     score and best live on the death card. See the HUD section.

     ?cfg_SHARK_SHOW_DONT_TELL=0 restores every line of the old text and
     silences the physical beats — that is the before/after preset's BEFORE. */
  function SDT() { return CFG.SHARK_SHOW_DONT_TELL !== false; }

  /* ---- THE LADDER. `need` is total mass eaten; mass comes off the meal's
     own hit points (massOf), so a mackerel is a snack and a human is a
     meal. The megalodon is the end of the ladder and the start of the win
     condition, not another rung. ---- */
  /* PACED FOR A RUN, NOT A MINUTE (2026-09-27). The old rungs (14/34/75) were
     measured with an autopilot that only steers at the nearest thing in the
     water: it reached the GREAT WHITE in 90 seconds and would have been a
     megalodon inside three minutes, after which the game had nothing left to
     give. At ~35 mass a minute (a mixed diet of swimmers and shoals) these
     rungs land at about 1 min / 3 min / 7-8 min, which is the arc a shark
     game needs: learn to eat, get hunted, turn the tables. */
  const LADDER = [
    { id: "bull_shark",        name: "BULL SHARK",       need: 0 },
    { id: "hammerhead_shark",  name: "GREAT HAMMERHEAD", need: 30 },
    { id: "great_white_shark", name: "GREAT WHITE",      need: 85 },
    { id: "megalodon",         name: "MEGALODON",        need: 200 },
  ];

  CBZ.sharkSimLadder = LADDER;   // tools read the rungs from here, never a private copy
  const sim = {
    on: false,          // a match is live and the player has a shark
    needsTeardown: false, // mount/rider/ring state is out; teardown() owes a restore
    ended: false,       // the shark died — the only way this match resolves
    match: 0,
    shark: null,
    tier: 0, mass: 0, eaten: 0,
    orcas: 0,           // orcas eaten: the run's only trophy, read back on the death card
    biteT: 0, hudT: 0, podT: 0, stockT: 0, strandT: 0, hintT: 0,
    waterline: 0,       // mean radius where the sea meets this island's sand
    clock: 0,           // seconds of THIS match (sim time, not wall time)
    score: 0,           // the run's number: meals x their size x the frenzy
    combo: 0, comboT: 0,// the frenzy: meals chained inside COMBO_WINDOW
    best: null,         // the device's record, read once per match
    starved: false,     // the hunger clock killed this shark, not a predator
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
    // a man sitting in a boat is the FLEET's, not the beach's: counting the
    // crews here starved the beach restock once the sea had sixty people afloat
    for (let i = 0; i < b.length; i++) if (!b[i].dead && !b[i]._aboard) n++;
    return n;
  }
  /* ---- THE SEA IS THE GAME ------------------------------------------------
     OWNER: "check why there's so few others — it's just orca, no other sharks
     or small fish."

     Two things were wrong and only one of them lives here. The other — every
     fish this island was stocked with landing on ONE hardcoded point 187 m
     outside the fence its own navigator walls the sea with, frozen on its
     first step and LOD-hidden all match — is fixed in city/wildlife.js and
     world/water_survival.js, and it is why only the orcas were ever met (the
     shark brain steers those without asking the navigator).

     This is the other half: A SHARK SIM EATS ITS SEA. The island seeds around
     thirty animals for the whole ring, spread over fourteen species, and the
     player's whole job is to remove them. Ten minutes in, an empty sea looks
     exactly like the bug that was just fixed. So the sea is kept stocked the
     way the beach crowd already is — a census against a want, small batches on
     the same one-second clock.

     THREE THINGS THIS IS CAREFUL ABOUT:
       • ARRIVALS ARE UNSEEN — and since 2026-08-29 that is MEASURED rather
         than asserted. The old claim ("45-85 m, past the wildlife LOD radius
         at the lowest quality tier") was never the real reason: the LOD radius
         is 360 u at the shipping tier, so it has never hidden anything at
         45 m. What actually hid an arrival was the water — the underwater fog
         closed at 16-40 m. Now that world/water_underwater.js solves a real
         sighting range (and a look-up line of sight can run half again as far
         as a level one), the floor is read off that range instead of guessed:
         arrivalFloor() below asks CBZ.waterSight.maxRange() for the longest
         sight line this water has and stands the spawner outside it.
       • FISH ARRIVE AS SHOALS, on one anchor, and that is load-bearing rather
         than decorative: city/marine_frenzy.js opens a BAIT BALL when a bait
         species (mackerel, sardine — the two rows whose herd maximum clears
         its school threshold) is on screen with something toothed inside
         130 m, which the player's own shark is. A shoal is what makes that
         fire. Loose singletons scattered round the ring never would.
       • NO ORCAS. podPressure owns the threat curve, and a second spawner for
         the same species is exactly the parallel system that ends with two
         pieces of code arguing about how frightened you should be. -- */
  /* THE WANTS ARE RESEARCHED RATIOS, GAME-SCALED. Real sardine schools run
     from ~25 into the millions and are always the biggest thing in the water
     column; mackerel shoal in the hundreds of thousands but tighter and
     smaller than a sardine ball; a coastal bottlenose pod is 2-15 (the old
     "pod" of 2-3 was a couple, not a pod); great barracuda are solitary as
     adults; green turtles cruise alone. `g` is the NATURAL group range and a
     group is always drawn whole from it — never clipped to the quota gap,
     which is how this sea used to end up with a "school" of 3 sardines and
     every dolphin pod the same size. */
  const SEA_WANT = [
    { id: "fish",       n: 45, g: [12, 30] },  // mackerel — the snack AND the bait ball
    { id: "sardine",    n: 70, g: [20, 45] },  // the big ball, visibly outnumbering everything
    { id: "barracuda",  n: 6,  g: [1, 2] },
    { id: "dolphin",    n: 12, g: [4, 9] },
    { id: "sea_turtle", n: 5,  g: [1, 2] },
  ];
  /* THE RIVALS — other sharks, and how many of them depends on what you are.
     A bull shark's sea has bigger things in it than a great white's does; the
     ladder is what changes, not the ocean. */
  function rivalWant() {
    const t = sim.tier;
    if (t <= 0) return { bull_shark: 3, hammerhead_shark: 1, great_white_shark: 0 };
    if (t === 1) return { bull_shark: 2, hammerhead_shark: 2, great_white_shark: 1 };
    if (t === 2) return { bull_shark: 1, hammerhead_shark: 2, great_white_shark: 2 };
    return { bull_shark: 1, hammerhead_shark: 1, great_white_shark: 2 };
  }
  /* THE CEILING. Wildlife's own tick measures ~985 animals in 1.4 ms, so this
     is not a frame budget — it is a "how full should this ocean feel" knob,
     and the answer for a sea that is the entire playfield is FULL. */
  const SEA_CAP = 170;                 // total live sea bodies before we stop adding
  const seaTally = {};
  function seaCensus() {
    for (const k in seaTally) delete seaTally[k];
    let total = 0;
    const list = CBZ.cityWildlife || [];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a || a.dead || a.external || a === sim.shark) continue;
      if (!a.species || !a.species.aquatic) continue;
      seaTally[a.species.id] = (seaTally[a.species.id] || 0) + 1;
      total++;
    }
    seaTally.$total = total;
    return seaTally;
  }
  function clearanceOf(id) {
    const sp = (CBZ.WILDLIFE_SPECIES || {})[id];
    return CBZ.cityAquaticClearance ? CBZ.cityAquaticClearance(sp) : 18;
  }
  /* A POINT THIS BODY CAN SWIM AT, near the player. CBZ.survNavRing is the
     island's own answer to "where does a body of this clearance fit" — the
     same fence the mover enforces — so a point taken from it can never be one
     of the frozen animals this whole change is about. Null when the species
     does not fit this sea at all, and null is a refusal to spawn. */
  function seaPointNear(clearance, minD, maxD) {
    const P = CBZ.player;
    const ring = CBZ.survNavRing && CBZ.survNavRing(clearance);
    if (!ring || !P) return null;
    const wf = CBZ.waterField;
    for (let i = 0; i < 14; i++) {
      const ang = Math.random() * 6.283;
      const d = minD + Math.random() * (maxD - minD);
      const x = P.pos.x + Math.cos(ang) * d, z = P.pos.z + Math.sin(ang) * d;
      const rr = Math.hypot(x - ring.cx, z - ring.cz);
      if (rr < ring.r0 + 2 || rr > ring.r1 - 2) continue;
      // the ring is only the ENVELOPE — the annulus has islets in it, and a
      // school anchored on a cay's sand is a school frozen on its first step
      if (wf && wf.isNavigableWater && !wf.isNavigableWater(x, z, clearance * 0.6)) continue;
      return { x: x, z: z, ring: ring };
    }
    return null;
  }
  /* A GROUP IS A HERD, not n bodies that happen to share a coordinate. A herd
     is the object wildlife.js's boids steer on — the shared heading and the
     shared centre — and without one, sixteen mackerel dropped on one point
     are sixteen independent random walks that have scattered inside a couple
     of seconds at a mackerel's cruise. A scattered school is invisible (the
     sea's sight lines are shorter than the spacing) and it never balls. */
  /* `pend` continues a school already arriving: same anchor, same herd, so a
     ball bigger than one tick's build budget is still ONE cohesive shoal. */
  /* HOW FAR OUT AN ARRIVAL HAS TO BE TO GO UNWATCHED. The longest sight line
     in this water, plus a margin — never below the 45 m the ring has always
     used, and capped so a freak-clear sea cannot push a school outside the
     navigable annulus and starve the spawner. Above water CBZ.waterSight
     returns the mode's own fog far (hundreds of metres), which is why the
     result is clamped rather than trusted: a surfaced shark is not supposed
     to move the fish spawner to the horizon. */
  function arrivalFloor() {
    let r = 45;
    try {
      const ws = CBZ.waterSight;
      if (ws && CBZ.cityCameraSubmerged && CBZ.cityCameraSubmerged()) r = ws.maxRange() * 1.22;
    } catch (e) {}
    return Math.max(45, Math.min(72, r));
  }

  function spawnGroup(id, n, minD, maxD, pend) {
    const at = pend ? pend.at : seaPointNear(clearanceOf(id), minD, maxD);
    if (!at) return null;
    const ring = at.ring;
    const pts = [];
    for (let i = 0; i < n; i++) {
      let x = at.x + (Math.random() - 0.5) * 18;
      let z = at.z + (Math.random() - 0.5) * 18;
      // Keep the whole shoal inside the swimmable band: one straggler jittered
      // over the fence is one fish that never moves again.
      const dx = x - ring.cx, dz = z - ring.cz;
      const rr = Math.hypot(dx, dz) || 1;
      const want = Math.max(ring.r0 + 2, Math.min(ring.r1 - 2, rr));
      if (want !== rr) { x = ring.cx + dx / rr * want; z = ring.cz + dz / rr * want; }
      pts.push({ x: x, z: z });
    }
    if (CBZ.cityWildlifeSpawnHerd) {
      const made = CBZ.cityWildlifeSpawnHerd(id, pts, pend && pend.herd);
      return { made: made.length, herd: made.length ? made[0].herd : (pend && pend.herd) || null, at: at };
    }
    let made = 0;
    for (const p of pts) if (CBZ.cityWildlifeSpawnAt(id, p.x, p.z)) made++;
    return { made: made, herd: null, at: at };
  }
  function stockSea() {
    if (!CBZ.cityWildlifeSpawnAt || !CBZ.survNavRing || !CBZ.player) return;
    const t = seaCensus();
    if (t.$total >= SEA_CAP) return;
    /* A THIN SEA FILLS FAST, A FULL ONE TRICKLES. Three groups a second while
       the water is genuinely empty (the first seconds of a match, or after a
       feeding run) and one a second after that — so the ocean is populated
       before the player has finished turning round, and the steady-state cost
       is one census and one small batch per second. */
    let budget = t.$total < 60 ? 3 : 1;
    /* ..and a BODY ceiling under the group ceiling, because a body is a
       build(): three groups of sixteen is forty-eight meshes constructed in
       one frame, which is a visible hitch to buy a thing whose whole point is
       that you never notice it arriving. */
    let bodies = 18;
    /* A SCHOOL BIGGER THAN ONE TICK'S BUILD BUDGET arrives in instalments —
       next tick, same anchor, same herd — instead of being clipped to the
       budget (a clipped draw is how every school converged on the same
       size). While one is mid-arrival nothing else starts. */
    const pend = sim.seaPend;
    if (pend) {
      const r = spawnGroup(pend.id, Math.min(pend.left, bodies), arrivalFloor(), arrivalFloor() + 40, pend);
      if (r && r.made) {
        sim.seaAdds = (sim.seaAdds || 0) + r.made;
        pend.left -= r.made; bodies -= r.made; budget--;
        if (!pend.herd) pend.herd = r.herd;
      } else pend.left = 0;                    // the sea refused; let it go
      if (pend.left <= 0) sim.seaPend = null;
    }
    for (let k = 0; k < SEA_WANT.length && budget > 0 && bodies > 0 && !sim.seaPend; k++) {
      sim.seaIx = ((sim.seaIx || 0) + 1) % SEA_WANT.length;
      const row = SEA_WANT[sim.seaIx];
      const have = t[row.id] || 0;
      /* the group is drawn WHOLE from the natural range. If the gap to the
         quota is smaller than the minimum group, the species is full enough:
         skip it rather than top it up with a scrap. */
      if (row.n - have < row.g[0]) continue;
      const size = row.g[0] + ((Math.random() * (row.g[1] - row.g[0] + 1)) | 0);
      const r = spawnGroup(row.id, Math.min(size, bodies), arrivalFloor(), arrivalFloor() + 40);
      if (r && r.made) {
        sim.seaAdds = (sim.seaAdds || 0) + r.made;
        budget--; bodies -= r.made;
        if (size > r.made) sim.seaPend = { id: row.id, left: size - r.made, at: r.at, herd: r.herd };
      }
    }
    // ..and the rivals on their own slower clock: one shark every four passes,
    // because meeting another shark should be an event and not traffic.
    sim.rivalT = (sim.rivalT || 0) - 1;
    if (sim.rivalT > 0) return;
    sim.rivalT = 4;
    const want = rivalWant();
    for (const id in want) {
      if ((t[id] || 0) >= want[id]) continue;
      const r = spawnGroup(id, 1, arrivalFloor() + 10, arrivalFloor() + 50);
      if (r) sim.seaAdds = (sim.seaAdds || 0) + r.made;
      return;
    }
  }
  function restock(dt) {
    sim.stockT -= dt;
    if (sim.stockT > 0) return;
    sim.stockT = 1.0;
    const A = arena(); if (!A) return;
    // keep the buffet stocked — this is also what keeps survival's
    // last-one-standing win check permanently dormant while the sim runs
    if (CBZ.spawnSurvivorBotAt) {
      let want = 40 - liveBots();
      want = Math.min(3, want);
      for (let i = 0; i < want; i++) {
        const a = Math.random() * 6.283;
        const r = A.radius * 1.03 + Math.random() * Math.max(4, sim.waterline - 2 - A.radius * 1.03);
        CBZ.spawnSurvivorBotAt(A.center.x + Math.cos(a) * r, A.center.z + Math.sin(a) * r);
      }
    }
    stockSea();
  }

  /* ---- THE FLEET ---------------------------------------------------------
     A sea with people in it has boats on it. This mode builds nothing physical
     (see the header) and vehicles.js is city-only, so the craft come from
     world/sea_craft.js — real registered hulls with real crews, on the same
     water the crowd wades in — and every one of them is DRIVEN: sea_craft's
     helm brains (§3b there) give each hull a job, and the job is the shape of
     its track. Nobody orbits the island any more.

     THE LADDER IS THE BANDS. Distances are metres past the waterline:

       0-60     paddleboards, kayaks, jetskis: the swimming band, where a bull
                shark starts, and the first thing it learns is it can only TIP
                them
       40-180   anchored skiffs with lines out, tenders and runabouts running
                in and out, a dive boat drifting over a site: the first hulls
                a great white can take a piece out of
       120-330  centre consoles and sportfishers trolling lanes, keelboats
                beating and reaching on the wind, cruisers going somewhere, a
                trawler working a ledge, a yacht at anchor — megalodon food
       300-360  the far traffic: a freighter and a big yacht on passage, just
                inside the fog, so the horizon is never empty

     Nobody is told any of that; the sizes say it.

     A ROW'S KEYS ARE A PREFERENCE LIST, feature-detected against the hull
     registry: the first key water_hulls/yachts registered wins, so a board or
     a dive boat that does not exist in a build falls back to the nearest hull
     that does rather than to nothing.

     Placement is deterministic (CBZ.hash01 + the match number, never
     Math.random) and depth-checked against the island's own bathymetry, so a
     boat can never be spawned sitting on a sandbar; every mark a job picks
     later is checked the same way (sea_craft.js legOk). */
  const FLEET = [
    { keys: ["sup", "kayak"],             n: 3, r0: 8,   r1: 40,  crew: 1, job: "paddle" },
    { keys: ["kayak"],                    n: 4, r0: 12,  r1: 60,  crew: 1, job: "paddle" },
    { keys: ["jetski"],                   n: 3, r0: 18,  r1: 95,  crew: 1, crew2: 0.4, job: "carve" },
    { keys: ["skiff", "dinghy"],          n: 4, r0: 45,  r1: 140, crew: 2, job: "fish" },
    { keys: ["dinghy"],                   n: 2, r0: 25,  r1: 120, crew: 2, job: "transit" },
    { keys: ["boat"],                     n: 2, r0: 50,  r1: 190, crew: 2, crew2: 0.5, job: "transit" },
    { keys: ["diveboat", "console"],      n: 2, r0: 80,  r1: 180, crew: 3, job: "dive" },
    { keys: ["console"],                  n: 2, r0: 120, r1: 250, crew: 2, crew2: 0.5, job: "troll" },
    { keys: ["sportfish", "console"],     n: 2, r0: 170, r1: 300, crew: 3, job: "troll" },
    { keys: ["sloop"],                    n: 3, r0: 140, r1: 320, crew: 2, crew2: 0.5, job: "sail" },
    { keys: ["cruiser"],                  n: 2, r0: 170, r1: 320, crew: 3, job: "transit" },
    { keys: ["trawler", "cruiser"],       n: 2, r0: 230, r1: 330, crew: 2, job: "troll" },
    { keys: ["yacht"],                    n: 2, r0: 230, r1: 320, crew: 3, job: "moor" },
    { keys: ["yacht46", "yacht"],         n: 1, r0: 280, r1: 345, crew: 2, job: "liner" },
    // scenery: a ship on the horizon, never prey (water_hulls marks it so)
    { keys: ["freighter", "yacht46", "trawler"], n: 1, r0: 315, r1: 365, crew: 0, job: "liner" },
  ];
  const fleet = [];              // {row, key, rec, respawnT} — one slot per hull the sea owes
  let fleetSeq = 0;

  function depthAt(x, z) {
    if (typeof CBZ.cityWaterDepthAt === "function") {
      try { return +CBZ.cityWaterDepthAt(x, z) || 0; } catch (e) {}
    }
    return depthMean(x, z);
  }
  function rowKey(row) {
    const R = CBZ.marineHulls;
    if (!R || !R.spec) return row.keys[row.keys.length - 1];
    for (let i = 0; i < row.keys.length; i++) if (R.spec(row.keys[i])) return row.keys[i];
    return "dinghy";
  }
  /* A POINT THIS HULL FLOATS AT. Sixteen deterministic bearings, first one
     that clears the draft wins; null is a refusal to spawn rather than a boat
     on the beach. */
  function craftPoint(ix, row, spec, salt) {
    const A = arena(); if (!A) return null;
    const WL = sim.waterline;
    // the hull's draft with a margin — and never shallower than SWIMMING
    // water (survivorbot's SWIM_ENTER is 1.35 m): a man who goes over the
    // side of a kayak sitting in a metre of water would land on his feet
    const need = Math.max(((spec && spec.draft) || 0.5) + 0.6, 1.6);
    for (let k = 0; k < 16; k++) {
      const a = h01(ix * 5.31 + k * 1.77 + 41, sim.match * 7 + salt) * 6.283;
      const r = WL + row.r0 + h01(ix * 3.13 + k * 2.9 + 77, sim.match * 11 + salt) * (row.r1 - row.r0);
      const x = A.center.x + Math.cos(a) * r, z = A.center.z + Math.sin(a) * r;
      if (depthAt(x, z) > need) return { x: x, z: z, ang: a, r: r };
    }
    return null;
  }
  function spawnCraftFor(slot, salt) {
    const A = arena(); if (!A || !CBZ.seaCraft) return null;
    const R = CBZ.marineHulls;
    const spec = (R && R.spec) ? (R.spec(slot.key) || R.spec("dinghy")) : null;
    const p = craftPoint(slot.ix, slot.row, spec, salt);
    if (!p) return null;
    const row = slot.row, WL = sim.waterline;
    const j = h01(slot.ix * 2.77 + 13, sim.match * 5 + salt);
    // across the band, never pointing at the beach
    const heading = p.ang + (j < 0.5 ? 1 : -1) * Math.PI / 2 + (j - 0.5) * 0.8;
    const crew = row.crew + (row.crew2 && h01(slot.ix * 7.1 + 3, sim.match + salt) < row.crew2 ? 1 : 0);
    return CBZ.seaCraft.spawn(slot.key, p.x, p.z, heading, {
      crew: crew,
      job: row.job,
      band: { cx: A.center.x, cz: A.center.z, r0: WL + row.r0, r1: WL + row.r1, shore: WL + 3 },
      seed: slot.ix * 13.7 + sim.match * 3.1 + salt,
    });
  }
  function spawnFleet() {
    if (!CBZ.seaCraft) return;
    fleet.length = 0; fleetSeq = 0;
    for (let i = 0; i < FLEET.length; i++) {
      const row = FLEET[i], key = rowKey(row);
      for (let k = 0; k < row.n; k++) {
        const slot = { row: row, key: key, ix: fleetSeq++, rec: null, respawnT: 0 };
        slot.rec = spawnCraftFor(slot, 0);
        if (!slot.rec) slot.respawnT = 4;     // no water on any bearing yet: try again shortly
        fleet.push(slot);
      }
    }
  }
  /* RESTOCK, exactly like the beach crowd: a boat that was eaten, tipped-and-
     swamped or sunk is replaced 20-40 s later on a NEW bearing, so the sea
     never quietly empties out under a player who is good at this. */
  function fleetTick(dt) {
    if (!CBZ.seaCraft) return;
    const live = CBZ.seaCraft.list();
    for (let i = 0; i < fleet.length; i++) {
      const s = fleet[i];
      if (s.rec && (s.rec.dead || live.indexOf(s.rec) < 0)) {
        s.rec = null;
        s.respawnT = 20 + h01(i * 9.7 + 5, sim.match * 3 + s.ix) * 20;
      }
      if (s.rec) continue;
      s.respawnT -= dt;
      if (s.respawnT > 0) continue;
      s.rec = spawnCraftFor(s, ++fleetSeq);
      if (!s.rec) s.respawnT = 6;
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
    /* Nose angled IN toward the beach (the tangent turned ~32 degrees
       shoreward), so the first frame of the match has the crowd in it: the
       thing the game is about is in front of you before you touch a key. */
    const tx = A.center.x + Math.cos(ang + 0.30) * (sim.waterline - 4);
    const tz = A.center.z + Math.sin(ang + 0.30) * (sim.waterline - 4);
    a.heading = Math.atan2(tz - z, tx - x); a.faceH = a.heading;
    // the chase lens looks the same way (W swims where the lens looks):
    // physics.js's basis, forward = (-sin yaw, -cos yaw)
    sim.spawnYaw = Math.atan2(-(tx - x), -(tz - z));
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
    if (!SDT() || sim.tier >= 3 || sim.clock < POD_GRACE) { if (podLocked.length) podRestore(); return; }
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
    const calm = sim.clock < POD_GRACE;
    let alive = orcas(function (a) {
      const d = Math.hypot(a.pos.x - P.pos.x, a.pos.z - P.pos.z);
      if (calm) { if (d < 200) a.hunger = Math.min(a.hunger || 0, 0.3); return; }
      if (d < 160 && sim.tier < 3) a.hunger = Math.max(a.hunger || 0, 0.9);
    });
    /* A FULL POD, ALWAYS. This used to fall to ONE orca at megalodon, because
       one orca was all the old win condition needed to exist. There is no win
       any more: the pod is what the endgame IS — the only prey left worth
       chasing once the ladder is done — so the sea keeps three of them. */
    /* ..but it GROWS INTO the full pod. One orca while you are a bull shark
       that has not been in the water three minutes, a pair for a hammerhead,
       the full three from the great white on — the threat curve rises with
       you instead of sitting at its maximum from the first second. */
    const wantPod = sim.tier >= 2 ? 3 : Math.min(3, 1 + sim.tier + (sim.clock > 180 ? 1 : 0));
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
  /* ONE CURRENCY. This formula used to live only here, which is exactly how a
     player-facing ladder and a wild food chain end up as two economies that
     disagree about what a tuna is worth. city/wildlife_traits.js publishes it
     now and every eater in the game — the player, a wild orca, a pod — is paid
     in the same units. The old body is kept verbatim as the degrade path. */
  function massOf(kind, target) {
    if (CBZ.wildlifeMassOf) {
      try { const m = +CBZ.wildlifeMassOf(target, kind); if (m > 0 && isFinite(m)) return m; } catch (e) {}
    }
    if (kind === "survivor" || kind === "ped" || kind === "cop") return 5;
    const hp = (target && (target.maxHp || (target.species && target.species.hp))) || 20;
    return Math.max(1, Math.round(hp / 25));
  }
  CBZ.sharkSimBite = function (kind, target, eater) {
    if (!sim.on || sim.ended || !eater || eater !== sim.shark) return;
    if (!target || !(target.dead || target.hp <= 0)) return;   // a chomp is not a meal until it kills
    const gain = massOf(kind, target);
    sim.mass += gain; sim.eaten++;
    /* ---- THE BODY IS THE PROGRESS BAR ----------------------------------
       OWNER: "each time the shark eats something it should get bigger".
       The LADDER is untouched — `need`, the tiers and the evolve cinematic
       are exactly as they were, and they still swap the FORM. This is the
       other axis: within a form, the body grows continuously with what it has
       eaten, so the bar on screen and the animal under the camera are telling
       the same story and a player who has eaten well LOOKS like it.

       city/wildlife.js owns the write (scale, hp, reach, the hunt kit, the
       saddle and the camera boom all move together) and city/wildlife_traits.js
       owns the curve and the per-species ceiling. `player: true` exempts the
       player's own shark from the WILD_GROWTH flag, so turning wild growth off
       to compare a pod still leaves the player growing. */
    if (CBZ.wildlifeCreditMeal) {
      try { CBZ.wildlifeCreditMeal(eater, target, kind, { player: true }); } catch (e) {}
    }
    const S = sim.shark;
    /* A MEAL IS LIFE. The hunger clock (hungerTick) is always taking; this is
       the only thing that gives back, sized so a mackerel buys ~8 s and a
       swimmer ~20 s at bull-shark rates. The old +5% made a meal a rounding
       error on a bar that never moved on its own, so nothing ever made you
       go and find food. */
    if (S && S.maxHp) S.hp = Math.min(S.maxHp, S.hp + S.maxHp * Math.min(0.5, 0.06 + gain * 0.035));
    mealBeat(gain, kind, target);
    if (kind === "animal" && target.species && target.species.id === "orca") orcaBeat(target);
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
    /* ---- THE LEDGER FOLLOWS YOU UP THE LADDER, REBASED -------------------
       Evolution swaps the FORM; growth is size WITHIN a form. So the new body
       does not inherit the whole lifetime ledger — that would hand a fresh
       megalodon a maxed-out ceiling on its first frame and there would be
       nothing left to earn — it inherits the SURPLUS: the mass eaten beyond
       the rung it just cleared. A player who over-ate before evolving arrives
       already a little bigger than one who evolved on the exact threshold,
       which is the honest reading of the same ledger, and the loop stays whole:
       grow, evolve into a bigger form at ITS base size, grow again. */
    if (CBZ.wildlifeSetEatenMass) {
      const rung = (LADDER[sim.tier] && LADDER[sim.tier].need) || 0;
      try { CBZ.wildlifeSetEatenMass(S1, Math.max(0, sim.mass - rung)); } catch (e) {}
    }
    mountShark();
    if (SDT()) evolveBeat(S1, x, z);
    else {
      if (CBZ.waterSplashAt) CBZ.waterSplashAt(x, seaYAt(x, z), z, 3.6);
      if (CBZ.shake) CBZ.shake(0.55);
      if (CBZ.sfx) { try { CBZ.sfx("win", { volume: 0.5 }); } catch (e) {} }
      flash("YOU ARE THE " + next.name,
        sim.tier >= 3 ? "Nothing outranks you." : "Next: " + LADDER[sim.tier + 1].name);
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
      /* HANDS OFF, MEAL SWELL. city/wildlife_traits.js runs a quarter-second
         pulse on every mouthful and this ceremony owns group.scale outright for
         its three quarters of a second; two writers on one Vector3 is the
         stuck-half-size bug this block's header already warns about. The lock
         is released in growTick/growClear, i.e. on exactly the paths that hand
         the scale back. */
      S1._growLock = 1;
      S1._growP = null;
      growWrite(sim.grow, sim.grow.from);
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
    /* A BEAT, NOT A SLAM. Owner, 2026-08-29: the lens is for what is being
       done TO you; everything else comes almost entirely out. Evolving is the
       biggest thing you do to yourself, so it keeps a jolt — but a third of
       the old one, because the swell, the splash ring and the slow-mo already
       carry it and this one fired straight into a 0.42 s slow-mo. */
    if (CBZ.shake) CBZ.shake(0.35);
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.42);
    if (CBZ.sfx) { try { CBZ.sfx("win", { volume: 0.5 }); } catch (e) {} }
    sim.evolveBeats = (sim.evolveBeats || 0) + 1;
  }
  /* `to` IS RE-READ LIVE, NEVER TRUSTED FROM CAPTURE TIME. It used to be
     snapshotted off the authored species scale, which was the only truth there
     was while a body's size was fixed for its whole life. Now a meal landing
     during the ceremony moves the resting scale under us, and a ceremony that
     handed back its stale snapshot would silently undo that growth. The engine
     publishes the resting scale on _sizeEff; that is the number this beat is
     easing toward and the number it must land on. */
  function growRest(G) {
    const eff = G.a && +G.a._sizeEff;
    return (eff > 0 && isFinite(eff)) ? eff : G.to;
  }
  /* THE GIRTH RIDES ON TOP OF THE CEREMONY. group.scale.y/z carry the fed/lean
     swell (city/wildlife_traits.js, THE BODY CUE) and this beat owns the whole
     vector while it runs, so it has to hand it back with the girth still in
     it — a setScalar() here would leave the shark you just evolved suddenly
     lean until its next mouthful moved the cue again. */
  function growWrite(G, v) {
    const gsc = G.a && G.a.group && G.a.group.scale; if (!gsc) return;
    const gk = (CBZ.animalGirth ? CBZ.animalGirth(G.a) : 1) || 1;
    gsc.set(v, v * gk, v * gk);
  }
  function growTick(dt) {
    const G = sim.grow; if (!G) return;
    const gsc = G.a && G.a.group && G.a.group.scale;
    if (!gsc || G.a.dead || G.a !== sim.shark) {
      sim.grow = null;
      if (G.a) G.a._growLock = 0;
      if (gsc) growWrite(G, growRest(G));
      return;
    }
    G.t += dt;
    const to = growRest(G);
    const e = Math.min(1, G.t / G.dur);
    // ease-out with a 6% overshoot that settles: mass arriving, not a lerp
    const k = 1 - Math.pow(1 - e, 3);
    const over = Math.sin(e * Math.PI) * 0.06;
    growWrite(G, G.from + (to - G.from) * k + to * over);
    if (e >= 1) { growWrite(G, to); sim.grow = null; G.a._growLock = 0; }
  }
  function growClear() {
    const G = sim.grow; if (!G) return;
    if (G.a && G.a.group) growWrite(G, growRest(G));
    if (G.a) G.a._growLock = 0;
    sim.grow = null;
  }

  /* ---- KILLING AN ORCA IS NOT AN ENDING ---------------------------------
     OWNER, 2026-09-01: "That's fucking stupid. Game should not end."

     He is right, and it was the worst possible place to put a stop. This game
     spends four rungs teaching you that eating is how you get bigger, hands
     you the megalodon, and then — the first time you use it on the one animal
     the whole climb was aimed at — took the water away and put up a scoreboard.
     The reward for reaching the top of the food chain was being ejected from
     the game. There is no VICTORY here any more, and no #survwin: the ladder
     ends at the megalodon and then the sea just keeps going, with the pod
     restocking, until something finally kills you. Death is the only end.

     What is left of that moment is the moment itself. An orca is the biggest
     mouthful in the water, so it gets the same physical grammar every other
     big beat in this file uses — the sea breaks over it, the lens jolts once,
     time drops for a beat — and then you are still swimming. The count is
     kept because it is the only trophy this run has: the death card reads it
     back to you. */
  function orcaBeat(target) {
    sim.orcas = (sim.orcas || 0) + 1;
    const x = (target && target.pos && target.pos.x) || 0;
    const z = (target && target.pos && target.pos.z) || 0;
    const y = seaYAt(x, z);
    if (CBZ.waterSplashAt) {
      try {
        CBZ.waterSplashAt(x, y, z, 4.2);
        for (let i = 0; i < 4; i++) {
          const ang = (i / 4) * 6.283 + 0.7;
          CBZ.waterSplashAt(x + Math.cos(ang) * 3.0, y, z + Math.sin(ang) * 3.0, 2.2);
        }
      } catch (e) {}
    }
    if (CBZ.marineSurfaceHit) { try { CBZ.marineSurfaceHit(x, z, 3.6); } catch (e) {} }
    if (CBZ.shake) CBZ.shake(0.3);
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.38);
    if (CBZ.sfx) { try { CBZ.sfx("win", { volume: 0.45 }); } catch (e) {} }
    // the words are the deleted design's, same as every other flash in here
    if (!SDT()) flash("APEX PREDATOR", sim.orcas > 1 ? sim.orcas + " orcas" : "You ate the thing that eats sharks");
  }

  /* ================= DYING ==================================================
     OWNER, 2026-08-30: "when I die in shark sim it's like a person died lol —
     clearly cus of nat disaster death."

     He is describing exactly what the code did. The shark's death was routed
     straight into survival's killPlayer(): the rider was made VISIBLE again on
     the frame the shark died, and then a MAN was flung into the air in a
     spinning ragdoll, sprayed arterial blood over the water, logged to the
     killfeed as "You were eaten by the pod", handed a battle-royale placement
     (#14 of 100) against the beach crowd, put into disaster spectate ("42
     left") and finally shown ELIMINATED · Survived · Disasters. Every one of
     those beats belongs to a different game. In this one the thing that dies
     is a fish, the human on its back is a camera mount, and there is no field
     of rivals to be placed against.

     So the death is the SHARK'S now, end to end:
       • the rider never comes back — he stays hidden through the death, the
         replay and the card; teardown() (leaving the mode) owns the restore;
       • no human ragdoll, no human gore, no human placement. The player is
         never hurt at all: the rider shield STAYS UP through the whole beat,
         where the old code deliberately dropped it to let the kill land;
       • the body that died is what you watch die. The corpse gets wildlife.js's
         own death tumble and sink (it always did — nobody ever saw it), and
         the replay orbit is pointed at it by gluing the camera's anchor to the
         carcass for the hold;
       • one killfeed line, the sanctioned popup, naming what actually killed
         you (marine_predation's own mark on the body, not a guess);
       • then the shark run's own card — see sharkSimFillResult.
     ?cfg_SHARK_DEATHCAM=0 skips the replay hold and cuts straight to it. */
  const DEATH_HOLD = 3.4;                // seconds of corpse before the card

  /* WHO KILLED YOU, asked of the body rather than assumed. marine_predation
     marks its victim on the way in (_mpRoll.by while a pod is rolling it,
     _mpHuntedBy for the one that committed), so the card can name the pod
     without this file re-deriving the pod's own bookkeeping — and a shark that
     somehow died to something else does not get told a lie about it. */
  function killerLabel() {
    if (sim.starved) return "hunger";
    const S = sim.shark;
    const by = S && ((S._mpRoll && S._mpRoll.by) || S._mpHuntedBy);
    const sp = by && !by.isPlayer && by.species;
    if (!sp) return "the pod";
    if (sp.id === "orca") return "the pod";
    return "a " + String(sp.name || "predator").toLowerCase();
  }

  function onSharkDead() {
    if (sim.ended) return;
    sim.ended = true;
    hideHud();                           // the death and its card own the screen
    const S = sim.shark, P = CBZ.player;
    sim.killer = killerLabel();
    writeBest();
    // THE HEALTH BAR IS THE SHARK (see step()), and the shark is dead — so it
    // empties. step() floors the mirror at 1 while you are alive so nothing
    // mistakes it for a death; this is the death, and a full green bar under a
    // sinking carcass was the last thing on screen still saying you were fine.
    if (P) P.hp = 0;
    // ONE PHYSICAL BEAT, on the body that died. The sea breaks over it, the
    // lens jolts once, time drops for half a second — the same grammar
    // evolveBeat uses for the other end of the ladder.
    if (S) {
      const x = S.pos.x, z = S.pos.z;
      if (CBZ.waterSplashAt) { try { CBZ.waterSplashAt(x, seaYAt(x, z), z, 3.4); } catch (e) {} }
      if (CBZ.marineSurfaceHit) { try { CBZ.marineSurfaceHit(x, z, 3); } catch (e) {} }
    }
    growClear();                         // no carcass frozen mid-swell for the replay
    if (CBZ.shake) CBZ.shake(0.8);
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.5);
    if (CBZ.sfx) { try { CBZ.sfx("ko"); } catch (e) {} }
    // the killfeed keeps its one line — with the cause the feed's own city
    // normaliser would have thrown away (survival's reportDeath does the same).
    const cause = "killed by " + sim.killer;
    if (CBZ.cityLogDeath) {
      try { const e = CBZ.cityLogDeath("You", cause, { you: true }); if (e) { e.cause = cause; e.name = "You"; } } catch (e) {}
    }
    sim.death = { t: 0, dur: CFG.SHARK_DEATHCAM === false ? 0 : DEATH_HOLD };
    // The replay is survival's orbit (systems/camera.js) — the one piece of
    // that flow worth keeping, because it is just a camera. It frames
    // player.pos, and deathTick keeps player.pos on the carcass.
    if (CBZ.surv && sim.death.dur > 0) {
      CBZ.surv.spectating = true;
      CBZ.surv.deathCam = { t: 0, dur: sim.death.dur };
    }
    if (sim.death.dur <= 0) deathResolve();
  }

  function deathTick(dt) {
    const D = sim.death; if (!D) return;
    D.t += dt;
    const S = sim.shark, P = CBZ.player;
    // the rider is still a passenger, even on a corpse: nothing may kill him
    // while the carcass sinks, and the lens rides the body down with it.
    if ((g.invuln || 0) < 2) g.invuln = 2;
    if (S && P && !P.dead) {
      const gp = S.group && S.group.position;
      P.pos.x = gp ? gp.x : S.pos.x;
      P.pos.z = gp ? gp.z : S.pos.z;
      P.pos.y = gp ? gp.y : S.pos.y;
      if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.kx = P._phys.kz = 0; }
    }
    if (D.t >= D.dur) deathResolve();
  }

  function deathResolve() {
    sim.death = null;
    if (CBZ.clearSpectate) { try { CBZ.clearSpectate(); } catch (e) {} }
    else if (CBZ.surv) { CBZ.surv.spectating = false; CBZ.surv.deathCam = null; }
    if (CBZ.loseGame) CBZ.loseGame("shark-dead");
  }

  /* ---- THE ONLY CARD IS THE DEATH CARD -----------------------------------
     There is exactly ONE way this game ends now: the shark dies. The victory
     screen it used to put up for eating an orca is gone (see orcaBeat) — with
     it went the "APEX PREDATOR" fill, the win half of this function and the
     sharksim branch in state.js's winGame, because nothing in this mode can
     reach it any more.

     What is left is the loss card, and it still is not the island's. #survlose
     shipped survival's copy — "ELIMINATED · #14 of 100 · 0 Disasters" over a
     dead shark — and a placement against a hundred disaster survivors is not a
     thing this game HAS: the beach crowd is food, it respawns, and being "#14"
     of it is noise. So sharksim fills its own card through the same seam
     gungame uses (systems/state.js dispatches on g.mode), with the numbers
     this run actually produced: how far up the ladder the body got, how long
     it hunted, how much it ate — and, if it ever caught one, the orcas, which
     is the only trophy the run has now that killing one no longer stops it.
     Every other mode reclaims this markup when IT fills, so nothing leaks
     between games. */
  function speciesName() { return (LADDER[sim.tier] && LADDER[sim.tier].name) || LADDER[0].name; }
  function setStat(vid, v, label) {
    const e = document.getElementById(vid);
    if (!e) return;
    e.textContent = v;
    const l = e.nextElementSibling;
    if (l && label != null) l.textContent = label;
  }
  CBZ.sharkSimFillResult = function () {
    const box = document.getElementById("survlose");
    const logo = box && box.querySelector(".logo");
    const sub = box && box.querySelector(".sub");
    if (logo) logo.textContent = sim.starved ? "STARVED" : "EATEN";
    if (sub) {
      const n = sim.orcas || 0;
      const who = "The " + speciesName().toLowerCase() + " ";
      const how = sim.starved ? "starved" : "was killed by " + (sim.killer || "the pod");
      const best = sim.newBest && sim.score > 0 ? "  NEW BEST"
        : (sim.prevBest ? "  Best " + fmtScore(sim.prevBest.score) : "");
      sub.textContent = who + (n ? "ate " + n + (n > 1 ? " orcas" : " orca") + " and " : "") + how + "." + best;
      delete sub.dataset.jailText;       // a jail loss must not think its copy is still up
    }
    // The run's number first, then the two facts that explain it. The form
    // reads as a rung ("3/4"), never as a placement against the crowd.
    setStat("slPlace", fmtScore(sim.score), sim.newBest && sim.score > 0 ? "New best" : "Score");
    setStat("slTime", (sim.tier + 1) + "/" + LADDER.length, "Form");
    setStat("slDis", String(sim.eaten || 0), "Eaten");
    const b = document.getElementById("loseAgainBtn"); if (b) b.textContent = "Try Again";
  };

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

  /* ================= THE LOOP: HUNGER, FRENZY, THE RECORD ==================
     2026-09-27, the "it isn't fun yet" pass. The ladder and the pod were the
     whole game, and neither one asked anything of you minute to minute: the
     health bar only moved when an orca found you, so a player could idle in
     the shallows forever, and a meal was worth the same whether it was the
     first in a minute or the fifth in five seconds. Three rules fix that, and
     they are the three every shark game that works is built on:

       1. HUNGER. The body burns itself. HP drains at a rate that rises with
          the form (a megalodon is a furnace), and a meal is the only thing
          that refills it. The first HUNGER_GRACE seconds are free, so the
          opening teaches eating before it punishes not eating. Starving is a
          real death, with its own card line.
       2. THE FRENZY. Meals chained inside COMBO_WINDOW multiply the score, up
          to x8. That is what makes a beach raid (a crowd of 5-mass swimmers,
          all panicking at once) the best thing you can do, and a bait ball
          the second best: the game's two set pieces are now its two jackpots.
       3. THE RECORD. The run ends in a number, and the device remembers the
          best one. The title shows it; the death card says when you beat it.
          That is the restart loop: one more go to beat it.

     The only mid-play readout is two numbers in the top-right rail where the
     island's survivor count used to sit (a count of FOOD, printed as if it
     were rivals) — score, and the frenzy multiplier while it is live. No
     sentences over the water; the owner's rule stands. */
  const HUNGER = [1 / 120, 1 / 100, 1 / 90, 1 / 80];   // fraction of max HP burned per second, per form
  const HUNGER_GRACE = 20;                            // seconds of free swimming at the start of a match
  const COMBO_WINDOW = 3.5, COMBO_MAX = 8;
  const POD_GRACE = 45;                               // the pod ignores you while you learn to eat
  const BEST_KEY = "CBZ_SHARK_BEST_V1";

  function readBest() {
    try {
      const b = JSON.parse(localStorage.getItem(BEST_KEY) || "null");
      if (b && b.score > 0) return b;
    } catch (e) {}
    return null;
  }
  CBZ.sharkSimBest = readBest;          // the title reads it (modes/shark_title.js)
  function writeBest() {
    const prev = readBest();
    const run = { score: Math.round(sim.score), tier: sim.tier, eaten: sim.eaten, orcas: sim.orcas || 0, t: Math.round(sim.clock) };
    sim.newBest = !prev || run.score > prev.score;
    sim.prevBest = prev;
    if (sim.newBest && run.score > 0) { try { localStorage.setItem(BEST_KEY, JSON.stringify(run)); } catch (e) {} }
  }

  function hungerTick(dt) {
    const S = sim.shark;
    if (!S || S.dead || !S.maxHp || sim.grow) return;
    if (sim.clock < HUNGER_GRACE) return;
    const burn = S.maxHp * (HUNGER[sim.tier] || HUNGER[0]) * dt;
    if (S.hp - burn > 0.5) { S.hp -= burn; return; }
    // the last of it goes through the one animal bus, so the carcass, the
    // tumble and the sink are exactly the ones a pod kill gets
    sim.starved = true;
    if (CBZ.cityWildlifeHit) { try { CBZ.cityWildlifeHit(S, {}, { damage: Math.max(2, S.hp + 2), cause: "starved" }); } catch (e) {} }
    if (!S.dead) { S.hp = 0; S.dead = true; }
  }

  /* THE BEAT A MEAL MAKES. The bite already has blood and a crunch (the mount's
     own attack); this is the part that says it COUNTED: the score ticks, the
     number kicks, the frenzy climbs, and a person or anything bigger than a
     fish lands with a short jolt. Chained meals get a rising chime. */
  function mealBeat(gain, kind, target) {
    const chained = sim.comboT > 0;
    sim.combo = chained ? Math.min(COMBO_MAX, sim.combo + 1) : 1;
    sim.comboT = COMBO_WINDOW;
    const pts = Math.round(gain * 10 * sim.combo * (1 + sim.tier * 0.25));
    sim.score += pts;
    const big = kind !== "animal" || gain >= 3;
    if (big && CBZ.shake) CBZ.shake(Math.min(0.22, 0.08 + gain * 0.02));
    if (CBZ.sfx && sim.combo >= 2) {
      try { CBZ.sfx("coin", { volume: Math.min(0.7, 0.22 + sim.combo * 0.06) }); } catch (e) {}
    }
  }
  function comboTick(dt) {
    if (sim.comboT > 0) { sim.comboT -= dt; if (sim.comboT <= 0) sim.combo = 0; }
  }

  /* ---- NOTHING OVER THE WATER BUT THE WATER ------------------------------
     Owner, 2026-09-27: "every HUD, the overlapping tabs, everything should be
     considered for removal, including the minimap, the timer, the PB run,
     pills that mean nothing. SHOW DON'T TELL."

     So while you swim there is no score pill, no frenzy counter, no clock, no
     health or stamina bar and no evolve meter. Every one of them had a world
     reading already, and the world reading is the one that stays:
       - HUNGER is the red edge of the screen, beating harder as the tank
         empties (starveTick below), and the shark slowing into it.
       - GROWTH is the body. Each meal swells it; each rung is the evolve
         beat, a bigger animal where the smaller one was.
       - A FRENZY is the rising chime and the jolt of a chained meal
         (mealBeat above); the number behind it still counts.
       - SCORE and BEST are kept and shown exactly once, on the death card
         (CBZ.sharkSimFillResult).
     css/shark_title.css hides the island HUD family (the clock, the bars, the
     casualty feed, the hint/toast strip) in this mode. What is left in this
     section is the starving edge and the banner surface the evolve beat and
     the tool seam sim.banner still use. */
  function fmtScore(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  let starveEl = null;
  function buildStarve() {
    if (!starveEl) {
      starveEl = document.createElement("div");
      starveEl.id = "sharkStarve";
      document.body.appendChild(starveEl);
    }
    starveEl.style.opacity = "0";
  }
  function starveTick() {
    if (!starveEl) return;
    const S = sim.shark;
    const f = S && S.maxHp ? S.hp / S.maxHp : 1;
    const burning = sim.clock >= HUNGER_GRACE && !sim.ended;
    // the ONLY hunger readout now, so it speaks from half a tank: a faint slow
    // pulse at 50%, a hard fast red beat as it runs out. Pod damage lands on
    // the same number, so a mauling reads here too.
    const k = burning || f < 0.99 ? Math.max(0, Math.min(1, (0.5 - f) / 0.5)) : 0;
    if (k <= 0) { if (starveEl.style.opacity !== "0") starveEl.style.opacity = "0"; return; }
    const beat = 0.5 + 0.5 * Math.sin(sim.clock * (3 + k * 7));
    starveEl.style.opacity = (0.08 + 0.5 * k * (0.5 + 0.5 * beat)).toFixed(3);
  }

  let flashEl = null, flashSub = null;
  /* The banner surface: the flag-off evolve line and the tool seam
     sim.banner. Never raised by the default game while swimming. */
  function buildFlash() {
    if (flashEl) return;
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
    buildFlash();
    if (flashEl.firstChild && flashEl.firstChild !== flashSub) flashEl.removeChild(flashEl.firstChild);
    flashEl.insertBefore(document.createTextNode(big), flashSub);
    flashSub.textContent = small || "";
    flashEl.style.opacity = "1";
    flashTimer = 2.8;
  }
  function hudNow() {}
  function hudTick(dt) {
    if (flashTimer > 0) { flashTimer -= dt; if (flashTimer <= 0 && flashEl) flashEl.style.opacity = "0"; }
  }
  function hideHud() {
    if (starveEl) starveEl.style.opacity = "0";
    if (flashEl) flashEl.style.opacity = "0";
  }

  /* ---- ONE CAMERA ----------------------------------------------------------
     Owner, 2026-09-27, on his iPad: "the third-person switch doesn't even need
     an option. You're just adding too many buttons." Shark Sim has exactly one
     view, the chase camera. There is no first-person shark, no chooser card,
     no Settings row, no [V], no eye button. This pins it: anything that turns
     fpsmode on while this mode is live (a stale key handler, an armed intro
     handoff) is turned straight back off. The chase camera itself is not
     touched here. */
  function pinChase() {
    if (!(CBZ.fps && CBZ.fps.active)) return;
    if (CBZ.setFPS) { try { CBZ.setFPS(false); } catch (e) {} }
    else if (CBZ.toggleFPS) { try { CBZ.toggleFPS(); } catch (e) {} }
  }

  /* ---- THE CHROME WHILE SWIMMING -------------------------------------------
     Touch: the move stick, RISE / DIVE (touch_vehicle's mount rail) and ONE
     pause button, top left. The bite is automatic. Keyboard players pause
     with Esc (pointer lock) or P. The pause card itself is cut to Resume,
     Restart, Main Menu; the Settings panel (crowd density, total population,
     quality tiers) is hidden in this mode by css/shark_title.css. */
  let pauseBtn = null, restartBtn = null;
  function restartMatch() {
    if (g.mode !== "sharksim" || !CBZ.startRun) return;
    // setup() only runs when sim.on is false: stand the old match down first
    if (sim.needsTeardown) teardown();
    try { CBZ.startRun(); } catch (e) { console.error("[shark restart]", e); }
  }
  function buildChrome() {
    if (!pauseBtn) {
      pauseBtn = document.createElement("button");
      pauseBtn.type = "button";
      pauseBtn.id = "sharkPauseBtn";
      pauseBtn.setAttribute("aria-label", "Pause");
      pauseBtn.innerHTML = "<i></i><i></i>";
      const go = function (e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (g.mode === "sharksim" && g.state === "playing" && CBZ.setState) CBZ.setState("paused");
      };
      pauseBtn.addEventListener("touchstart", go, { passive: false });
      pauseBtn.addEventListener("click", go);
      document.body.appendChild(pauseBtn);
    }
    if (!restartBtn) {
      const resume = document.getElementById("resumeBtn");
      if (resume && resume.parentNode) {
        restartBtn = document.createElement("button");
        restartBtn.type = "button";
        restartBtn.id = "sharkRestartBtn";
        restartBtn.className = "btn";
        restartBtn.textContent = "Restart";
        restartBtn.addEventListener("click", function (e) { if (e) e.preventDefault(); restartMatch(); });
        // straight above Main Menu, whatever settings.js slotted in after Resume
        const menu = document.getElementById("pauseMenuBtn");
        resume.parentNode.insertBefore(restartBtn, menu && menu.parentNode === resume.parentNode ? menu : resume.nextSibling);
      }
    }
  }
  CBZ.sharkSimRestart = restartMatch;
  window.addEventListener("keydown", function (e) {
    if (g.mode !== "sharksim" || e.repeat) return;
    const k = (e.key || "").toLowerCase();
    if (k !== "p" || g.state !== "playing") return;
    // a held mouse would leave the card unclickable: letting it go IS the
    // pause (camera.js's pointerlockchange), exactly like Esc
    if (document.pointerLockElement && document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    if (g.state === "playing" && CBZ.setState) CBZ.setState("paused");
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildChrome); else buildChrome();

  // ---- match lifecycle ---------------------------------------------------
  function setup() {
    const A = arena(); if (!A) { sim.lastSetup = "no-arena"; return; }
    sim.match++;
    despawn(sim.shark);                     // last match's body never lingers
    sim.shark = null;
    sim.tier = 0; sim.mass = 0; sim.eaten = 0; sim.orcas = 0;
    sim.clock = 0; sim.score = 0; sim.combo = 0; sim.comboT = 0;
    sim.starved = false; sim.newBest = false; sim.prevBest = null;
    sim.ended = false;
    sim.death = null; sim.killer = null;
    // stockT 0.4, not 3: the sea top-up rides this same clock now and a match
    // that opens on empty water is the bug this file was opened to fix.
    sim.biteT = 0; sim.podT = 2; sim.stockT = 0.4; sim.strandT = 0; sim.hudT = 0;
    sim.seaIx = 0; sim.rivalT = 0; sim.seaAdds = 0;
    sim._podClose = false;
    podRestore(); growClear();
    sim.podScanT = 0; sim.podWakeT = 0; sim.grow = null;
    sim.waterline = measureWaterline();
    relocateBots();
    // the boats go out with the crowd: same water, same match, same seed
    if (CBZ.seaCraft) { try { CBZ.seaCraft.reset(); } catch (e) {} }
    spawnFleet();
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
    // ..and the lens starts BEHIND that nose, looking where it looks. The ride
    // keeps its own heading copy and the chase camera keeps the castaway's
    // yaw, so without this the match opened side-on to its own shark.
    if (CBZ.cityMountedHeading) { try { CBZ.cityMountedHeading(S.heading); } catch (e) {} }
    if (CBZ.cam && sim.spawnYaw != null) { CBZ.cam.yaw = sim.spawnYaw; CBZ.cam.pitch = 0.06; }
    hideRider();          // the frame you BECOME the shark, not the one after:
                          // step() used to own this and the oracle caught the
                          // one-frame window where a man sits on the shark
    buildStarve();
    sim.on = true;
    sim.needsTeardown = true;
    pinChase();                          // one camera: the chase view
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
    if (sim.death) {
      sim.death = null;
      if (CBZ.clearSpectate) { try { CBZ.clearSpectate(); } catch (e) {} }
    }
    g.invuln = 0;                        // never leak the rider shield into another mode
    CBZ.sharkSimShoreRing = null;
    // the fleet does not outlive the match — and neither do the people on it
    if (CBZ.seaCraft) { try { CBZ.seaCraft.reset(); } catch (e) {} }
    fleet.length = 0;
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
      if (sim.death) deathTick(dt);
      hudTick(dt);
      return;
    }
    if (S.dead) { onSharkDead(); return; }
    // the island's own spawn writes the castaway's yaw back for a few frames
    // after setup; hold the opening lens on the beach until it settles
    if (sim.clock < 0.5 && sim.spawnYaw != null && CBZ.cam && !(CBZ.keys && (CBZ.keys.w || CBZ.keys.a || CBZ.keys.s || CBZ.keys.d))) CBZ.cam.yaw = sim.spawnYaw;
    sim.clock += dt;
    // the pod may only hunt you once you have had the grace period to learn to eat
    S.huntable = sim.clock >= POD_GRACE;
    hungerTick(dt);
    if (S.dead) { onSharkDead(); return; }
    comboTick(dt);
    starveTick();
    // the HUD health bar IS the shark — the rider has no separate body here.
    // Floor at 1 so nothing else mistakes the mirror for a death; the only
    // way to die is the shark dying, and that path is explicit above.
    P.hp = Math.max(1, Math.round(100 * S.hp / (S.maxHp || 1)));
    // ..and the rider is not separately killable: the shark's own death is
    // the ONE mortality in this game (onSharkDead, which drops this shield
    // first). Anything that would kill the HUMAN off the shark's back — a
    // stray blast, an animal that targets the rider — lands on the mirror.
    if ((g.invuln || 0) < 2) g.invuln = 2;
    pinChase();
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
    fleetTick(dt);
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
      // NOT restoreRider(): a man standing on the win card's megalodon, or
      // bobbing over his own shark's corpse, is the bug this mode's death was
      // reported for. teardown() (leaving the mode) owns the restore.
      else if (sim.on && (st === "won" || st === "lost")) { hideHud(); sim.on = false; }
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
    objective: "YOU ARE THE SHARK. Swim with your move keys (sprint to lunge) — the bite is automatic when prey is in front of your mouth. Eat fish and the people off the beach, grow through HAMMERHEAD and GREAT WHITE, and stay away from the orca pod until you are the MEGALODON — then nothing in the water outranks you, and you hunt the pod until something finally kills you.",
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
