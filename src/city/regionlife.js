/* ============================================================================
 * regionlife.js — STREAMING AMBIENT LIFE for the new archipelago.
 *
 * WHY: the new world (worldmap.js: islands + open biomes — speedway, airport,
 *      military, desert, forest, farmland, snow) was empty wilderness once you
 *      left the mainland city. The owner's complaint: "spread of NPCs better
 *      throughout the map." A place only feels real if it is INHABITED — a
 *      farm has a farmer, an airport has travelers, a forest has a hiker. But
 *      the engine is DRAW-CALL / ENTITY-COUNT bound: we cannot pre-populate a
 *      huge archipelago with hundreds of full-rig peds. So this module is the
 *      classic open-world answer — a STREAMING ambient layer that keeps only a
 *      handful of NPCs alive AROUND THE PLAYER, spawning them just out of sight
 *      and despawning ones that drift far behind, biome-flavoured so the people
 *      you meet belong to the land you're standing on.
 *
 * DESIGN (verified against peds.js / worldmap.js):
 *   - CBZ.cityMakePed(x, z, rng, opts) builds a ped; we add its group to
 *     CBZ.city.arena.root and push it to CBZ.cityPeds so the existing ped AI
 *     drives it (walk / react / flee). We TAG each one ped._regionLife=true so
 *     we only ever manage (move-goal / despawn) OUR peds — never story, island,
 *     vendor, gang, or mainland-crowd NPCs.
 *   - BUDGET: a small per-frame-throttled population around the player. Hard
 *     cap REGION_CAP (≤18). We never fight the mainland crowd: we only act when
 *     the player is in / near a REGISTERED new region (CBZ.cityAnyRegion), and
 *     we leave biome 'city' to the existing systems.
 *   - STREAMING: spawn in a ring just outside the visible/keep distance, despawn
 *     past a hard outer radius (despawn ring). Spawn a few per second max.
 *
 * Pure window.CBZ IIFE, Three.js r128, no build step. Never throws in the loop.
 * ========================================================================== */
(function () {
  "use strict";
  var CBZ = window.CBZ; if (!CBZ) return;

  // ---- tunables ----------------------------------------------------------
  // DEMOTED TO A FLAVOUR-RIG LAYER: the instanced city crowd (crowd.js) now
  // provides the MASS in every biome via its near-player "biome bubble" (it
  // relocates a share of its 760 instanced bodies into the active region —
  // zero new draw calls). regionlife no longer carries the population; it only
  // streams a FEW characterful full rigs the instanced crowd can't express
  // (armed AK soldiers, hunters with shotguns, jobbed farmers). Rosters are
  // disjoint: crowd.js only manages its own indices, regionlife only manages
  // _regionLife-tagged peds — so the two never double-spawn the same body.
  // hard ceiling on simultaneous live region NPCs (flavour rigs only) —
  // rides the LIVE quality tier (pause-menu slider): ~3 at tier 0 up to ~12
  // at tier 4 (mid-tier ≈ the old 6). Read at use time — never snapshotted.
  function REGION_CAP() { return CBZ.qScale ? CBZ.qScale(3, 12) : 6; }
  var SPAWN_RING_IN = 46;    // spawn no closer than this (just out of sight)
  var SPAWN_RING_OUT= 74;    // spawn no farther than this
  var DESPAWN_RAD   = 118;   // past this from player → recycle the body
  var ACTIVE_RAD    = 140;   // only stream when player is within this of a region edge
  var SPAWN_COOLDOWN= 0.42;  // seconds between spawns (≈2-3/sec) — no hitch bursts
  var STROLL_RETARGET = 6.5; // seconds between fresh wander goals per ped
  // per-biome desired live count of FLAVOUR rigs — the table is the RELATIVE
  // mix; the actual count rides the LIVE quality tier (scaled ×0.5..×2 at the
  // read site, mid-tier ≈ these base numbers), then clamped under REGION_CAP.
  // 'city'
  // = 0: the mainland crowd owns those streets — we never add there. These are
  // small "special" counts: the instanced biome bubble in crowd.js carries the
  // ambient mass now, so here we keep only the characterful/armed/jobbed rigs.
  // BIOME_BUDGET_FULL (the OLD pre-bubble counts, for revert if crowd.js's
  // CBZ.crowdBiomeBubble is turned off and regionlife must carry the mass again):
  //   { city:0, speedway:14, airport:16, military:10, desert:8, forest:9, farmland:10, snow:8 }
  var BIOME_BUDGET = {
    city: 0, military: 5, farmland: 3, forest: 3,
    desert: 3, airport: 3, speedway: 2, snow: 2,
    // T6 — the 4 urban mini-cities (citytemplates/minicities). Kept modest
    // (≤4, under REGION_CAP): the instanced crowd bubble carries the MASS;
    // regionlife only streams the few characterful/jobbed full rigs each
    // place needs to read as itself (dockworkers, suits, gamblers, factory
    // hands) — plus its lone guard/bouncer/foreman.
    capeharbor: 4, goldspire: 4, neonreef: 4, foundry: 3,
    // X5 — the 4 new countries' settlements (city/countries.js), keyed by
    // SETTLEMENT id (registerCityRegion stamps `biome: s.id` — see that
    // file's buildSettlement), same convention as the mini-cities above.
    // Capitals: 4-5, mixed workers/vendors (an economy actually running).
    // Villages: 3, adult farmer/villager/vendor casts — no anchor jobs
    // beyond farming, since a village has no fields/ranch/office to route
    // to (unlike biome_farmland.js's real crop parcels).
    veridiacity: 5, lowport: 3,
    keshtown: 4, kesh_north: 3, kesh_east: 3,
    solaracity: 4,
    mbeyacity: 4, mbeya_west: 3, mbeya_south: 3, mbeya_east: 3,
  };

  // ---- TIME-OF-DAY DENSITY (GTA popcycle pattern, PROCGEN.md roadmap #4/5) --
  // WHY: a base isn't the same place at noon and at 3am — the farm empties out
  // after dark, the lodge crowd thickens in the evening. A small per-biome
  // {day, night} multiplier on BIOME_BUDGET; anything not listed stays flat
  // (1/1). Feature-detects schedule.js's cached sun-hour clock so this is a
  // no-op (flat budgets) on a headless build / before schedule.js loads.
  // Runtime-only (Math.random-adjacent territory, no rng()/build-time effect).
  var BIOME_DAYNIGHT = {
    military: { day: 1.2, night: 0.6 },   // base ops run the daylight shift
    farmland: { day: 1.3, night: 0.4 },   // farmers/ranchers work daylight, thin out at night
    snow:     { day: 0.75, night: 1.25 }, // the lodge crowd thickens toward evening
    airport:  { day: 1.15, night: 0.7 },  // travelers cluster around daytime flights
  };
  function dayNightMul(biome) {
    var h = CBZ.citySunHour ? CBZ.citySunHour() : null;
    var f = BIOME_DAYNIGHT[biome];
    if (h == null || !f) return 1;
    var night = (h < 6 || h >= 20);
    return night ? f.night : f.day;
  }

  // ---- biome cast: archetype/job/look/behaviour fed straight into makePed --
  // Each entry returns makePed opts. WHY-first: every cast belongs to its land.
  var CAST = {
    airport: function (r) {
      // travelers (rolling luggage energy) + the odd ground-crew handler. The
      // "ground crew" job routes to the terminal/apron work-anchor (turns the
      // planes); travelers stay anchorless ambient (they wander the concourse).
      if (r() < 0.22) return { job: "ground crew", archetype: "resident", kind: "civilian", outfit: 0xffc81f };
      return { job: "traveler", archetype: r() < 0.18 ? "tycoon" : "resident", kind: "civilian", outfit: pickCol(r, OUT_TRAVEL) };
    },
    military: function (r) {
      // soldiers — armed, disciplined, the olive cap read comes off job 'soldier'.
      return { job: "soldier", archetype: "resident", kind: "civilian",
               armed: r() < 0.75, weapon: "AK-47", aggr: 0.55 + r() * 0.2,
               outfit: pickCol(r, OUT_MIL) };
    },
    farmland: function (r) {
      // farmers / ranchers — working the land in earth tones.
      return { job: r() < 0.5 ? "farmer" : "rancher", archetype: "resident",
               kind: "civilian", armed: r() < 0.12, weapon: "Shotgun",
               outfit: pickCol(r, OUT_FARM) };
    },
    forest: function (r) {
      // a park ranger (routes to the trailhead work-anchor — walks the trails),
      // hikers + the occasional hunter (rifle out here is plausible, not menace).
      const k = r();
      if (k < 0.25) return { job: "park ranger", archetype: "resident", kind: "civilian",
                             armed: r() < 0.5, weapon: "Pistol", outfit: 0x4a5a32, aggr: 0.25 };
      if (k < 0.5) return { job: "hunter", archetype: "resident", kind: "civilian",
                            armed: r() < 0.6, weapon: "Shotgun", outfit: pickCol(r, OUT_FOREST) };
      return { job: "hiker", archetype: "resident", kind: "civilian", outfit: pickCol(r, OUT_FOREST) };
    },
    desert: function (r) {
      // drifters + bikers — the lonesome road crowd, a little harder-edged.
      if (r() < 0.35) return { job: "biker", archetype: "resident", kind: "civilian",
                               armed: r() < 0.4, weapon: "Pistol", aggr: 0.45 + r() * 0.25,
                               outfit: pickCol(r, OUT_DESERT) };
      return { job: "drifter", archetype: "vagrant", kind: "civilian", outfit: pickCol(r, OUT_DESERT) };
    },
    snow: function (r) {
      // skiers / cold-weather hikers — bright jackets against the white.
      return { job: r() < 0.5 ? "skier" : "hiker", archetype: "resident",
               kind: "civilian", outfit: pickCol(r, OUT_SNOW) };
    },
    speedway: function (r) {
      // race fans — a loud, casual crowd milling the grandstands.
      return { job: "spectator", archetype: "resident", kind: "civilian", outfit: pickCol(r, OUT_FAN) };
    },
    // ---- T6: the four urban mini-cities (minicities.js) ------------------
    // PORT — dock/warehouse crews in hi-vis, plus the odd customs guard. The
    // 'dock worker'/'warehouse worker' jobs route to the port's hardware/fuel
    // lots; 'security guard' routes to the customs/port-authority lot.
    capeharbor: function (r) {
      if (r() < 0.18) return { job: "security guard", archetype: "resident", kind: "civilian",
                               armed: r() < 0.6, weapon: "Pistol", aggr: 0.4, outfit: 0x2a3a4a };
      return { job: r() < 0.5 ? "dock worker" : "warehouse worker", archetype: "resident",
               kind: "civilian", outfit: pickCol(r, OUT_DOCK) };
    },
    // FINANCE — suits (office/accountant, tycoon energy) + an armed guard for
    // the vaults. Dark business colours; the suits route to the bank towers.
    goldspire: function (r) {
      if (r() < 0.2) return { job: "security guard", archetype: "resident", kind: "civilian",
                              armed: r() < 0.7, weapon: "Pistol", aggr: 0.45, outfit: 0x23262e };
      return { job: r() < 0.5 ? "office worker" : "accountant",
               archetype: r() < 0.35 ? "tycoon" : "resident", kind: "civilian",
               outfit: pickCol(r, OUT_SUIT) };
    },
    // CASINO — gamblers / club-goers in bright clothes + a bouncer at the door.
    // The bouncer (security guard) routes to the casino/club lot; the gamblers
    // are anchorless ambient (they work the floor / mill the strip).
    neonreef: function (r) {
      if (r() < 0.18) return { job: "security guard", archetype: "resident", kind: "civilian",
                               armed: r() < 0.5, weapon: "Pistol", aggr: 0.55, outfit: 0x1a1a22 };
      return { job: "gambler", archetype: r() < 0.22 ? "tycoon" : "resident", kind: "civilian",
               outfit: pickCol(r, OUT_NEON) };
    },
    // FACTORY — line/warehouse hands in work coveralls + a foreman (a guard
    // role so he reads as the boss watching the floor). Workers route to the
    // foundry's hardware/chop/carlot lots.
    foundry: function (r) {
      if (r() < 0.16) return { job: "security guard", archetype: "resident", kind: "civilian",
                               armed: r() < 0.3, weapon: "Pistol", aggr: 0.4, outfit: 0x4a3a28 };
      return { job: r() < 0.5 ? "construction worker" : "warehouse worker",
               archetype: "resident", kind: "civilian", outfit: pickCol(r, OUT_WORK) };
    },
    // ---- X5: the 4 new countries (city/countries.js) — capitals get a
    // mixed working/vendor cast (a real, if modest, economy running); the
    // villages (X5's hut/mud-brick kit, city/villagekit.js) get the SAME
    // adult farmer/villager/vendor cast every rural settlement earns —
    // no soldiers/tycoons, this is a poor farm hamlet, not a garrison.
    veridiacity: function (r) {
      if (r() < 0.18) return { job: "security guard", archetype: "resident", kind: "civilian",
                               armed: r() < 0.5, weapon: "Pistol", aggr: 0.4, outfit: 0x2c3e5c };
      return { job: r() < 0.5 ? "office worker" : "vendor",
               archetype: r() < 0.25 ? "tycoon" : "resident", kind: "civilian", outfit: pickCol(r, OUT_VERIDIA) };
    },
    lowport: function (r) {
      if (r() < 0.2) return { job: "dock worker", archetype: "resident", kind: "civilian", outfit: pickCol(r, OUT_VERIDIA) };
      return { job: "vendor", archetype: "resident", kind: "civilian", outfit: pickCol(r, OUT_VERIDIA) };
    },
    keshtown: function (r) {
      if (r() < 0.15) return { job: "guard", archetype: "resident", kind: "civilian",
                               armed: r() < 0.4, weapon: "Pistol", aggr: 0.35, outfit: 0x6b5238 };
      return { job: r() < 0.5 ? "clerk" : "vendor", archetype: "resident", kind: "civilian", outfit: pickCol(r, OUT_KESH) };
    },
    kesh_north: villageCast(function () { return OUT_KESH; }),
    kesh_east: villageCast(function () { return OUT_KESH; }),
    solaracity: function (r) {
      if (r() < 0.16) return { job: "security guard", archetype: "resident", kind: "civilian",
                               armed: r() < 0.5, weapon: "Pistol", aggr: 0.4, outfit: 0x2a3a4a };
      return { job: r() < 0.5 ? "dock worker" : "vendor", archetype: "resident", kind: "civilian", outfit: pickCol(r, OUT_SOLARA) };
    },
    mbeyacity: function (r) {
      if (r() < 0.14) return { job: "guard", archetype: "resident", kind: "civilian",
                               armed: r() < 0.35, weapon: "Pistol", aggr: 0.3, outfit: 0x4a3a28 };
      return { job: r() < 0.5 ? "clerk" : "vendor", archetype: "resident", kind: "civilian", outfit: pickCol(r, OUT_MBEYA) };
    },
    mbeya_west: villageCast(function () { return OUT_MBEYA; }),
    mbeya_south: villageCast(function () { return OUT_MBEYA; }),
    mbeya_east: villageCast(function () { return OUT_MBEYA; }),
  };
  // shared adult farmer/villager/vendor cast for a X5 village settlement —
  // takes a THUNK (not the array itself) since it's built as a CAST entry
  // before OUT_KESH/OUT_MBEYA are declared below (function hoisting covers
  // the def; the thunk defers the array lookup to call time).
  function villageCast(paletteFn) {
    return function (r) {
      var pal = paletteFn();
      var k = r();
      // mirrors biome_farmland.js's own farmer cast (armed r()<0.12, Shotgun)
      // — a working farm hand, not a threat.
      if (k < 0.55) return { job: "farmer", archetype: "resident", kind: "civilian",
                             armed: r() < 0.12, weapon: "Shotgun", outfit: pickCol(r, pal) };
      if (k < 0.85) return { job: "villager", archetype: "resident", kind: "civilian", outfit: pickCol(r, pal) };
      return { job: "vendor", archetype: "resident", kind: "civilian", outfit: pickCol(r, pal) };
    };
  }
  // outfit palettes (plain colours; clothes/outfits modules paint roles).
  var OUT_TRAVEL = [0x3a4a6b, 0x6b6b6b, 0x8a4a4a, 0x4a6b5a, 0xb0b0b0];
  var OUT_MIL    = [0x44503a, 0x4e5740, 0x3a4030];
  var OUT_FARM   = [0x6b5d3a, 0x7a5a3a, 0x4a5a3a, 0x8a6b4a, 0xa03030];
  var OUT_FOREST = [0x3a5a3a, 0x5a6b3a, 0x6b4a2a, 0x4a4a3a];
  var OUT_DESERT = [0x8a7050, 0x6b5a40, 0x303030, 0x9a6a3a];
  var OUT_SNOW   = [0xd03030, 0x3060c0, 0xe0a020, 0x20a060, 0xe0e0e0];
  var OUT_FAN    = [0xd03030, 0x3060c0, 0xe0a020, 0x20a060, 0x9030c0, 0xf0f0f0];
  // T6 mini-city palettes (plain colours; clothes/outfits paint roles).
  var OUT_DOCK   = [0xe0a020, 0xf08020, 0x3a4a6b, 0x6b6b3a, 0xc0c020];  // hi-vis + work blues
  var OUT_SUIT   = [0x23262e, 0x2a3040, 0x303030, 0x3a3a4a, 0x40404a];  // dark business suits
  var OUT_NEON   = [0xff3070, 0x30c0ff, 0xffd020, 0xa030ff, 0x30ffa0, 0xffffff];  // bright strip wear
  var OUT_WORK   = [0x4a4842, 0x5a5248, 0x6b5a44, 0x3a4a3a, 0x6a4a32];  // grey/brown coveralls
  // X5 country palettes (plain colours; clothes/outfits paint roles).
  var OUT_VERIDIA = [0x8a939c, 0x2c3e5c, 0xe8e6e0, 0x33573b, 0x6e2b33];  // cool European business/harbour tones
  var OUT_KESH    = [0x6b5238, 0xa9895c, 0xc9a23a, 0x8a6a3a, 0x7a5a30];  // warm gold/earthen monarchy tones
  var OUT_SOLARA  = [0x4f86b8, 0xe6ebf0, 0x2a3a4a, 0x7ea6c2, 0xd8c98a];  // bright coastal city-state tones
  var OUT_MBEYA   = [0x8a6b45, 0xa3653a, 0xc9a97a, 0x6b4a2a, 0xb98c58];  // earthy federation/village tones

  function pickCol(r, arr) { return arr[(r() * arr.length) | 0]; }

  // does this ped's job route to a WORK-ANCHOR (biome work)? Such peds are owned
  // by the aigoals job/schedule brain — regionlife must not stroll-stomp them.
  function hasAnchorJob(ped) {
    if (!ped || ped.dead) return false;
    var J = CBZ.cityJobs && CBZ.cityJobs[ped.job];
    return !!(J && J.anchor);
  }

  // a tiny deterministic-enough rng (Math.random wrapper) makePed expects an
  // rng FUNCTION; spawns are transient/ambient so true randomness is fine.
  function rng() { return Math.random(); }

  // ---- live roster of OUR peds (subset of cityPeds, tagged _regionLife) ----
  var mine = [];     // refs to peds we spawned (still alive + ours)
  var spawnCD = 0;

  // ---- region geometry pick: a {x,z} inside `reg`, near the player ----------
  function spawnPointNear(reg, px, pz) {
    // try a few candidate points on the spawn ring around the player that also
    // land ON the region; fall back to the region's shared scatter helper.
    for (var i = 0; i < 8; i++) {
      var a = Math.random() * Math.PI * 2;
      var d = SPAWN_RING_IN + Math.random() * (SPAWN_RING_OUT - SPAWN_RING_IN);
      var x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      if (CBZ.cityRegionHit && CBZ.cityRegionHit(reg, x, z, 1.5)) return { x: x, z: z };
    }
    // fallback: any scattered region point that's at least SPAWN_RING_IN away.
    if (CBZ.cityScatterInRegion) {
      var pts = CBZ.cityScatterInRegion(reg, 6, Math.random, 8);
      for (var j = 0; j < pts.length; j++) {
        var dx = pts[j].x - px, dz = pts[j].z - pz;
        if (dx * dx + dz * dz >= SPAWN_RING_IN * SPAWN_RING_IN) return pts[j];
      }
      if (pts.length) return pts[0];
    }
    return null;
  }

  // ---- fresh wander goal inside the region (believable stroll) --------------
  function strollGoal(ped, reg) {
    if (!CBZ.cityScatterInRegion) return;
    var pts = CBZ.cityScatterInRegion(reg, 3, Math.random, 8);
    // prefer a point within a comfortable stroll radius so they don't sprint off
    var best = null, bestD = Infinity;
    for (var i = 0; i < pts.length; i++) {
      var dx = pts[i].x - ped.pos.x, dz = pts[i].z - ped.pos.z;
      var dd = dx * dx + dz * dz;
      if (dd < bestD) { bestD = dd; best = pts[i]; }
    }
    if (best && ped.target && ped.target.set && ped.state !== "flee" &&
        ped.state !== "fight" && ped.state !== "confront") {
      ped.target.set(best.x, 0, best.z);
      ped.state = "walk";
    }
  }

  // ---- bias toward UNFILLED work-anchors: now and then spawn a fresh rig at
  //      (just off) an anchor in this biome that still has open capacity, so the
  //      fields/gates/slopes actually fill up with workers instead of staying
  //      empty while ambient hikers wander. Returns a {x,z} or null.
  function unfilledAnchorPoint(biome, px, pz) {
    var list = CBZ.cityWorkAnchors;
    if (!list || !list.length) return null;
    var cands = [];
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a.biome !== biome) continue;
      if ((a.occupants ? a.occupants.length : 0) >= (a.cap | 0)) continue;
      // only if it's within streaming reach so the spawn lands near the player
      var dx = a.x - px, dz = a.z - pz;
      if (dx * dx + dz * dz > (DESPAWN_RAD + 20) * (DESPAWN_RAD + 20)) continue;
      cands.push(a);
    }
    if (!cands.length) return null;
    var pick = cands[(Math.random() * cands.length) | 0];
    // spawn at the anchor's home if it has one (reads as "arriving for work"),
    // else just off the anchor itself.
    var base = pick.home || { x: pick.x, z: pick.z };
    return { x: base.x + (Math.random() - 0.5) * 6, z: base.z + (Math.random() - 0.5) * 6 };
  }

  // ---- spawn one ambient NPC for a biome, near the player ------------------
  function spawnOne(reg, biome, px, pz) {
    if (!CBZ.cityMakePed || !CBZ.cityPeds) return false;
    var A = CBZ.city && CBZ.city.arena; if (!A || !A.root) return false;
    // ~40% of the time, bias toward filling an open work-anchor in this biome.
    var pt = null;
    if (Math.random() < 0.4) pt = unfilledAnchorPoint(biome, px, pz);
    if (!pt) pt = spawnPointNear(reg, px, pz);
    if (!pt) return false;
    var castFn = CAST[biome]; if (!castFn) return false;
    var opts;
    try { opts = castFn(rng) || {}; } catch (e) { opts = {}; }
    var ped;
    try { ped = CBZ.cityMakePed(pt.x, pt.z, rng, opts); } catch (e) { return false; }
    if (!ped || !ped.group) return false;
    ped._regionLife = true;            // OUR tag — only we manage these
    ped._regionBiome = biome;
    ped._strollT = STROLL_RETARGET * (0.4 + Math.random() * 0.8);
    try {
      A.root.add(ped.group);
      CBZ.cityPeds.push(ped);
      mine.push(ped);
    } catch (e) { return false; }
    return true;
  }

  // ---- despawn one of OUR peds cleanly (mirrors clearCityPeds disposal) -----
  function despawn(ped) {
    try {
      if (ped.group && ped.group.parent) ped.group.parent.remove(ped.group);
      if (ped.group && ped.group.traverse) {
        ped.group.traverse(function (o) {
          if (o.isSprite) return;     // shared sprite geometry singleton — never dispose
          if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
          if (o.material) {
            var m = o.material;
            if (Array.isArray(m)) { for (var i = 0; i < m.length; i++) { var x = m[i]; if (x && !x._shared && x.dispose) try { x.dispose(); } catch (e) {} } }
            else if (!m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
          }
        });
      }
    } catch (e) {}
    // remove from the global ped roster
    if (CBZ.cityPeds) {
      var gi = CBZ.cityPeds.indexOf(ped);
      if (gi >= 0) CBZ.cityPeds.splice(gi, 1);
    }
  }

  // prune from `mine` any ped that died, got removed elsewhere, or is no longer
  // ours (defensive). Returns nothing; mutates `mine`.
  function reconcile() {
    var peds = CBZ.cityPeds;
    for (var i = mine.length - 1; i >= 0; i--) {
      var p = mine[i];
      var stillIn = peds && peds.indexOf(p) >= 0;
      if (!p || p.dead || !stillIn || !p._regionLife) {
        // it died or someone else removed it — let the normal death/corpse
        // pipeline own dead bodies; we just stop tracking them.
        mine.splice(i, 1);
      }
    }
  }

  // ============================================================
  //  THE STREAMING LOOP
  // ============================================================
  CBZ.onUpdate(62, function (dt) {
    var g = CBZ.game; if (!g || g.mode !== "city") { if (mine.length) clearAll(); return; }
    var P = CBZ.player; if (!P || !P.pos) return;
    var A = CBZ.city && CBZ.city.arena; if (!A || !A.regions || !A.regions.length) return;
    if (!CBZ.cityAnyRegion || !CBZ.cityBiomeAt) return;
    if (typeof dt !== "number" || dt <= 0 || dt > 0.5) dt = 0.016;  // sane clamp

    var px = P.pos.x, pz = P.pos.z;

    try {
      reconcile();

      // 1) DESPAWN ring: recycle our peds that drifted far behind the player.
      for (var i = mine.length - 1; i >= 0; i--) {
        var p = mine[i];
        var dx = p.pos.x - px, dz = p.pos.z - pz;
        if (dx * dx + dz * dz > DESPAWN_RAD * DESPAWN_RAD) {
          despawn(p);
          mine.splice(i, 1);
        }
      }

      // 2) Which new region is the player in / near? (skip mainland 'city'.)
      var reg = CBZ.cityAnyRegion(A, px, pz, 0);
      if (!reg) {
        // not standing on a new landmass — but maybe near one's edge; find the
        // nearest registered region whose edge is within ACTIVE_RAD. Uses the
        // shared worldmap export (crowd.js calls the same one).
        reg = CBZ.cityNearestRegion ? CBZ.cityNearestRegion(A, px, pz, ACTIVE_RAD) : null;
      }
      if (!reg || !reg.biome) return;
      var biome = reg.biome;
      var budget = BIOME_BUDGET[biome];
      if (!budget) return;                  // 'city' or unknown → leave it alone
      // table = RELATIVE mix; scale by day/night AND the LIVE quality tier at read time
      budget = Math.max(1, Math.round(budget * dayNightMul(biome) * (CBZ.qScale ? CBZ.qScale(0.5, 2) : 1)));
      budget = Math.min(budget, REGION_CAP());

      // 3) STROLL: hand our nearby peds a believable new wander goal on a timer.
      //    BUT: a ped whose job now routes to a WORK-ANCHOR (farmer/rancher/
      //    ranger/soldier/ski instructor/ground crew) is owned by the aigoals
      //    brain — it commutes to its field/gate/slope and works the shift. We
      //    must NOT overwrite its goal with a random wander, or it'd never reach
      //    work. Only ANCHORLESS casts (hiker/drifter/spectator/traveler) get the
      //    ambient stroll; the rest are handed to the job brain.
      for (var s = 0; s < mine.length; s++) {
        var mp = mine[s];
        if (hasAnchorJob(mp)) continue;       // job-brain owns it — never stroll-stomp
        mp._strollT -= dt;
        if (mp._strollT <= 0) {
          mp._strollT = STROLL_RETARGET * (0.6 + Math.random() * 0.9);
          // only retarget peds in the active region (cheap + relevant)
          if (CBZ.cityRegionHit && CBZ.cityRegionHit(reg, mp.pos.x, mp.pos.z, 0)) strollGoal(mp, reg);
        }
      }

      // 4) SPAWN: throttle, then top up toward the biome budget (and cap).
      spawnCD -= dt;
      var live = countInRegion(reg);
      if (spawnCD <= 0 && live < budget && mine.length < REGION_CAP()) {
        if (spawnOne(reg, biome, px, pz)) spawnCD = SPAWN_COOLDOWN;
        else spawnCD = SPAWN_COOLDOWN * 0.5;   // failed point find — retry sooner
      }
    } catch (e) {
      // never let ambient streaming break the frame
      if (CBZ._regionLifeWarned !== true) { CBZ._regionLifeWarned = true; try { console.warn("[regionlife]", e); } catch (e2) {} }
    }
  });

  // count OUR peds currently standing inside the active region
  function countInRegion(reg) {
    var n = 0;
    for (var i = 0; i < mine.length; i++) {
      var p = mine[i];
      if (CBZ.cityRegionHit && CBZ.cityRegionHit(reg, p.pos.x, p.pos.z, 0)) n++;
    }
    return n;
  }

  // (nearestRegionWithin promoted to the shared CBZ.cityNearestRegion in
  //  worldmap.js — used here and by crowd.js's biome bubble.)

  // clear ALL of ours (mode exit / cleanup)
  function clearAll() {
    for (var i = mine.length - 1; i >= 0; i--) despawn(mine[i]);
    mine.length = 0;
  }
  // if the city is rebuilt / peds cleared elsewhere, drop our stale refs.
  CBZ.regionLifeReset = function () { mine.length = 0; spawnCD = 0; };
})();
