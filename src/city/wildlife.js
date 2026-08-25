/* ============================================================
   city/wildlife.js — THE WILDLIFE + HUNTING ENGINE (RDR2-style).

   The archipelago's biomes were scenery with a handful of decorative deer.
   This turns them into a living ECOSYSTEM you can HUNT: every biome (and the
   open ocean) is stocked with the RIGHT species for its climate — whitetail
   and black bears in the woods, lions & elephants on the savanna, polar bears
   and wolves on the ice, sharks & whales in the sea — plus a scattering of
   INCREDIBLY RARE legendary animals whose pelts are a fortune.

   THE HUNT LOOP (Red Dead Redemption 2 is the north star):
     1. TRACK  — animals wander/graze/flee in herds inside their home biome.
     2. KILL   — they're real hitscan targets (registered in CBZ.cityWildlife,
                 scanned by fpsmode's findActorHit; see the tiny hook there).
                 A clean one-shot / headshot yields a PRISTINE pelt; a messy
                 kill (many shots, body) ruins the hide's quality.
     3. SKIN   — walk up to the carcass; the interaction registry offers
                 "Skin" (hold). You get the PELT (worth $ by species & quality)
                 plus a field-dressing cash bounty. Legendary animals drop a
                 unique, luxe pelt worth a small fortune.
     4. SELL   — pelts are tag:"valuable", so the pawn shop / fence already
                 buys them. No new selling UI — the loot economy absorbs furs.

   SPECIES live in CBZ.WILDLIFE_SPECIES (see wildlife_species.js). Each carries
   its home biome, rarity, HP, pelt name + value, and a low-poly build(ctx)
   that returns a THREE.Group (feet at y=0, nose toward +X).

   PERFORMANCE (owner rule #4 — draw-call bound): there is NO population
   budget. Species spawn their natural populations; the ONE quality knob
   (core/quality.js tier, the pause-menu perf/quality slider) governs cost via
   a per-tier LOD visibility radius + default frustum culling. Each animal is
   a small hand-built mesh group with no physics or per-limb colliders.

   Deterministic (owner rule #5): a single seeded rng places every herd, so the
   same animals stand in the same meadow every run. Ambient motion uses
   Math.random for liveliness only (never world state).

   Gated behind CBZ.WILDLIFE !== false (default ON).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const mat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  /* THE BODY RIG LIVES IN city/wildlife_rig.js NOW (the BLOCK LAW: battle
     armies and the beast pit walk the same animals, so the gait could not
     stay private to the hunting engine). This file binds the shared names —
     faceAnimalHeading, CLASSES, classify, buildGaitRig,
     gaitAnimate — and behaves exactly as it always did. The rig file loads
     one line above this one in index.html; without it there is no wildlife,
     said out loud rather than half-working. */
  const RIG = CBZ.wildlifeRig;
  if (!RIG) { console.error("[wildlife] city/wildlife_rig.js must load first"); return; }
  const faceAnimalHeading = CBZ.faceAnimalHeading;

  /* ---- INDIVIDUALS (city/wildlife_traits.js) ---------------------------
     OWNER: "all wildlife including sharks should have varying size (viable)
     and varying hunger (visible behavior and movement)."

     Every animal in this file used to be EXACTLY its species: one line,
     `grp.scale.setScalar(sp.scale)`, and forty identical mackerel. The two
     facts that fix it — a per-individual size drawn off the spawn position
     and a hunger scalar that drifts and drops — live in wildlife_traits.js,
     which owns the curves; this file owns SPENDING them.

     SZ(a) is the single most important line in the change. Every `sp.scale`
     read in this file meant "how big is this animal", and every one of them
     was answering with "how big is this SPECIES". They all go through here
     now, so hp, bite, reach, turn rate, ragdoll mass, herd spacing, LOD
     radius, swim depth and the butchered meat yield are all the individual's.

     Degrade-safe in both directions: no traits file (or the flag off) and SZ
     collapses to sp.scale, HUNGER to a flat 0.5, and every multiplier below
     multiplies by one. */
  const TRAITS = CBZ.wildlifeTraits || null;
  function SZ(a) {
    const e = a && a._sizeEff;
    return e > 0 ? e : ((a && a.species && a.species.scale) || 1);
  }
  function HUNGER(a) { return TRAITS ? TRAITS.hunger(a) : 0.5; }
  // The behaviour scratch (speed / restlessness / loiter / sense / patience /
  // boldness / will-it-hunt). One cached object per actor; see the traits file.
  const CALM = { h: 0.5, spd: 1, restless: 1, loiter: 1, sense: 1, patience: 1, bold: 1, hunt: 1 };
  function DRIVE(a) { return TRAITS ? TRAITS.drive(a) : CALM; }
  // Is hunger switched on at all? The behaviours hunger ADDS (scavenging, herd
  // bunching) are gated on this rather than on a drive multiplier, because a
  // multiplier can only scale something that already existed.
  function HGON() { return !!(TRAITS && TRAITS.HUNGER_ON()); }

  // ---- WILDLIFE_LIVE — the one-line revert for the living-wildlife overhaul.
  // ON (default): animal groups are tagged userData.dynamic so the static
  // batcher (core/batch.js) and matrix freezer (core/staticfreeze.js) leave
  // them alone (without the tag the build-time sweep at city/mode.js merges
  // their meshes into static deco and freezes their matrices — the "statues
  // that can't be shot" bug), plus gaits, grazing, stalking, gunshot panic,
  // hit flinches and the animated death topple. OFF: exactly the old build.
  if (CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_LIVE == null) CBZ.CONFIG.WILDLIFE_LIVE = true;
  function LIVE() { return !(CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_LIVE === false); }

  // ---- tuning -----------------------------------------------------------
  // NO POPULATION BUDGET. Every species spawns its NATURAL population (packs ×
  // real herd sizes). Render cost is governed by the game's one true knob —
  // the performance/quality tier (core/quality.js, CBZ.qualityLevel): animals
  // LOD-hide beyond a tier-driven visibility radius, and frustum culling does
  // the rest. Gameplay content is never clamped by a hardcoded perf number.
  const ANIMAL_VIS = [90, 130, 190, 270, 360];   // vis radius (u) per quality tier 0..4
  // THE OCEAN BAND. OWNER: "make water absolutely massive and make fish and
  // potential predator like shark spawn in like npc in that water."
  //
  // 560..1500 was measured against a sea whose FLAT rect reached ~6.1 km; the
  // world is V4-scale now (CBZ.WORLD_SEA_SPAN 25000, half-span 12500), and a
  // 940 u-wide annulus in a 25 km sea is a puddle with fish in it. The outer
  // edge walks out to 2200, which is 2.4x the AREA (1.94 Mu^2 -> 4.57 Mu^2) and
  // still well inside the terrain ring, and the inner edge comes in to 520 so
  // the band actually reaches the water a swimmer is in rather than starting
  // half a kilometre past it. Every candidate point is still validated against
  // the real bathymetry by waterField.randomWaterPoint at the species' OWN
  // declared clearance, so widening the band can never put an animal on land —
  // it only gives the validator more sea to choose from.
  /* THE OCEAN BAND IS A PROPERTY OF THE ARENA, NOT OF THIS FILE.

     These four numbers used to be module constants, and they were GANG CITY'S
     ocean typed out by hand — which is why Natural Disaster mode, whose whole
     headline event is a tsunami, had no wildlife in it at all: nothing was
     stopping the sea life, the sea was simply somewhere else. Now they are
     the DEFAULT for an arena that carries land regions (i.e. the city, whose
     band stays exactly as tuned) and are DERIVED for anything that does not.

     `deriveField` is the only writer and it runs once per arena at stock time,
     so the per-frame cost is zero and the fallback for a lone unit-loaded
     module is the same city band it always was. */
  const CITY_BAND = { cx: 0, cz: -700, r0: 520, r1: 2200 };  // matches terrain.js CX/CZ
  const FIELD = { cx: CITY_BAND.cx, cz: CITY_BAND.cz, r0: CITY_BAND.r0, r1: CITY_BAND.r1 };

  /* An island in open water gets a RING of sea around it rather than a band
     around a continent's shoulder: inside `r0` is the beach, and `r1` is far
     enough out that a shark has somewhere to be that is not on top of you but
     close enough that a tsunami can carry it into the streets. Both are
     multiples of the arena's OWN radius, so a bigger island automatically gets
     a bigger sea and nobody has to retune anything. */
  const ISLE_R0 = 1.12, ISLE_R1 = 6.5;

  function deriveField(A, opts) {
    // 1. an explicit band always wins — a mode that knows its own water says so
    const o = (opts && opts.ocean) || (A && A.oceanBand) || null;
    if (o && o.r1 > 0) {
      FIELD.cx = +o.cx || 0; FIELD.cz = +o.cz || 0;
      FIELD.r0 = Math.max(0, +o.r0 || 0); FIELD.r1 = +o.r1;
      return FIELD;
    }
    // 2. an arena with LAND REGIONS is a city: its band is the tuned one.
    if (A && A.regions && A.regions.length) {
      FIELD.cx = CITY_BAND.cx; FIELD.cz = CITY_BAND.cz;
      FIELD.r0 = CITY_BAND.r0; FIELD.r1 = CITY_BAND.r1;
      return FIELD;
    }
    // 3. anything else that knows where it is and how big it is — the disaster
    //    island — gets a ring derived from its own footprint.
    const c = (A && A.center) || null;
    const R = A && +A.radius;
    if (c && Number.isFinite(+c.x) && R > 0) {
      FIELD.cx = +c.x; FIELD.cz = +c.z;
      FIELD.r0 = R * ISLE_R0; FIELD.r1 = R * ISLE_R1;
      /* ..UNLESS THE WORLD ITSELF ANSWERS, in which case the multiples above
         are a guess and this is a fact. 6.5R is 780 m of "sea" around a 120 m
         island, and the disaster island's navigator walls the swimmable water
         at radius+150 — so five hundred metres of that band was water no
         animal placed in it could move a metre in, and most of the sea life
         landed there. CBZ.survNavRing (world/water_survival.js) is the same
         fence measured rather than repeated here; asked for a mid-size body
         (a dolphin's 23 m of clearance) it describes the sea generally
         instead of one species' corner of it. */
      const ring = CBZ.survNavRing && CBZ.survNavRing(23);
      if (ring && ring.r1 > ring.r0) { FIELD.r0 = ring.r0; FIELD.r1 = ring.r1; }
      return FIELD;
    }
    return FIELD;                                  // keep whatever we had
  }
  const SKIN_REACH = 4.2;        // how close you must be to skin a carcass
  const CARCASS_LINGER = 150;    // s a skinned/ignored carcass stays before fading
  const BREED_EVERY = 26;        // s between breeding passes
  const BREED_RATE = 0.09;       // per LIVE animal chance to reproduce each pass (× room left)
  const GROW_TIME = 75;          // s a newborn takes to reach full size

  // ---- deterministic rng (mulberry32) -----------------------------------
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = makeRng(0x5EED10);

  // live actor list — the hitscan hook in fpsmode.js scans this every shot.
  const animals = CBZ.cityWildlife = [];
  const carcasses = [];          // skinnable / fading remains
  /* WHICH ARENA ARE WE STOCKED FOR? This was a bare `built` boolean, which is
     the same city-bound assumption the ocean band carried: once Gang City had
     built, no other mode could ever get wildlife, because the guard could not
     tell "already done" from "done for somewhere else". It is the arena
     reference now, so handing this file a DIFFERENT world restocks it and
     handing it the same one twice is still free.
     `wired` is separate on purpose: the pelt catalog, the interaction
     registry, the gunshot/blast wraps and the update hook are GLOBAL and must
     be installed exactly once however many worlds get stocked. */
  let root = null, builtFor = null, wired = false;
  // The arena we were handed at build time. CRITICAL: during buildCity(),
  // `CBZ.city.arena` is NOT yet assigned (the assignment awaits buildCity's
  // return), so every region lookup MUST go through this stored reference, not
  // the global — otherwise land regions read as empty and only ocean spawns.
  let arena = null;
  function ARENA() { return arena || (CBZ.city && CBZ.city.arena); }

  // ============================================================
  //  PELT ECONOMY — register every species' hide into cityEcon.ITEMS so the
  //  pawn shop / fence already buys it. A PRISTINE variant (clean kill) is
  //  worth ~2.1x; legendary pelts are flagged luxe (thinner fence haircut).
  //
  //  THE HUNT PAYS IN MEALS (2026-07-28). OWNER: "I killed a wild boar, and I
  //  skinned it. I should get the pelt, and I should get the food. And I should
  //  eat that food." He got both — and could eat NEITHER, because every meat
  //  this loop registered was written `tag:"valuable"` with no `heal`. That one
  //  word is the whole bug: `city/hunger.js`'s cityEat refuses anything without
  //  a heal, fpsmode's hotbar only carries tag food/drug/throwable, and
  //  interact.js's "Eat the X" pocket card matches on `.heal`. So a boar fed
  //  nobody. Meat is FOOD now, and `meat:true` stays exactly where it was so
  //  wildlife_tame.js's predator feeding still finds it.
  //
  //  THE FILL IS DERIVED, NOT TYPED. A portion's nourishment scales with how
  //  RICH the meat is (the bestiary's own meatValue: rabbit 5 -> whale 50) and
  //  how BIG the animal is (its own `scale`, because a big beast yields a big
  //  cut). No species is named and no row is authored, so the next species in
  //  the bestiary is edible for free:
  //      fill = 26 * (meatValue/12)^0.5 * scale^0.45,  clamped 10..55
  //  Anchored against the shop catalog it must live beside (Soda 12, Fries 20,
  //  Hotdog 28, Pizza 34, Burger 42): a rabbit is a snack (10), venison a
  //  proper meal (26), boar pork 27 at meatYield 2 (so ONE boar is 27-81 food),
  //  moose 40, and a whale caps out at the 55 nothing may exceed.
  // ============================================================
  function mealFill(meatValue, scale) {
    const mv = Math.max(1, meatValue || 8);
    const sc = Math.max(0.15, scale || 1);
    const v = 26 * Math.pow(mv / 12, 0.5) * Math.pow(sc, 0.45);
    return Math.max(10, Math.min(55, Math.round(v)));
  }
  CBZ.wildlifeMealFill = mealFill;

  // A `fur` is a HIDE — except when the species is aquatic and the yield is the
  // whole animal ("Fresh Fish"). A fin, a tooth and blubber are trade goods; a
  // fish is dinner. Derived from the name, so a new fish species named "Fresh
  // Trout" is edible with no edit here and no species table anywhere.
  function furIsFood(sp) {
    if (!sp || !sp.aquatic || !sp.fur) return false;
    return /^fresh\b|\bfish$|\bfillet\b|\broe\b/i.test(sp.fur);
  }

  function registerPelts() {
    const econ = CBZ.cityEcon; if (!econ || !econ.ITEMS) return;
    const S = CBZ.WILDLIFE_SPECIES || {};
    for (const id in S) {
      const sp = S[id];
      if (!sp.fur) continue;
      const edibleFur = furIsFood(sp);
      if (!econ.ITEMS[sp.fur]) {
        econ.ITEMS[sp.fur] = edibleFur
          // the whole catch: food you can eat AND still sell (a fish is both)
          ? {
              value: sp.furValue || 8, tag: "food",
              heal: mealFill(sp.furValue || 8, sp.scale),
              fish: true, wild: true, species: id,
            }
          : {
              value: sp.furValue || 20, tag: "valuable",
              luxe: sp.rarity === "legendary" || undefined,
              pelt: true, species: id,
            };
      }
      const pri = "Pristine " + sp.fur;
      if (!edibleFur && sp.rarity !== "legendary" && !econ.ITEMS[pri]) {
        econ.ITEMS[pri] = {
          value: Math.round((sp.furValue || 20) * 2.1), tag: "valuable",
          pelt: true, pristine: true, species: id,
        };
      }
      // WILD MEAT — real food (eat it, sell it at a butcher/pawn) that also
      // FEEDS your dog and any tamed predator (dogs.js / wildlife_tame.js read
      // `meat`, which is why that field must stay).
      if (sp.meat && !econ.ITEMS[sp.meat]) {
        econ.ITEMS[sp.meat] = {
          value: sp.meatValue || 8, tag: "food",
          heal: mealFill(sp.meatValue, sp.scale),
          meat: true, wild: true, species: id,
        };
      }
    }
  }
  // Exported so any grant path can make sure the catalog exists before it adds
  // (fishing.js can land a catch on a map where no wildlife build ever ran).
  // Idempotent by construction — every write is behind an existence check.
  CBZ.wildlifeRegisterItems = registerPelts;

  // ============================================================
  //  SPAWNING — stock each biome region with the species that call it home,
  //  plus an ocean band of aquatic life. Legendary animals roll a single,
  //  rare spawn so an encounter feels like a real event.
  // ============================================================
  function biomeRegions(biome) {
    const A = ARENA();
    const regs = (A && A.regions) || [];
    const out = [];
    for (let i = 0; i < regs.length; i++) if (regs[i].biome === biome) out.push(regs[i]);
    return out;
  }

  function regionPoint(reg, r) {
    // a random point comfortably inside a region (rect or circle)
    if (reg.kind === "circle") {
      const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * Math.max(4, reg.r - 14);
      return { x: reg.cx + Math.cos(a) * rad, z: reg.cz + Math.sin(a) * rad };
    }
    const pad = 16;
    return {
      x: reg.minX + pad + r() * Math.max(1, (reg.maxX - reg.minX) - pad * 2),
      z: reg.minZ + pad + r() * Math.max(1, (reg.maxZ - reg.minZ) - pad * 2),
    };
  }

  function aquaticClearance(sp) {
    if (!sp) return 18;
    // A SPECIES DECLARES ITS OWN WATER. This used to be a name table and
    // nothing else, so a new row could not be honest about where it lives —
    // every fish added after the original four got the same generic band, and
    // "a whale does not swim in 2 m of surf" was true only for the four names
    // typed here. `clearance` is metres of shore clearance the animal needs;
    // wildlife.js converts it through the same bathymetry every spawn uses. The
    // four names below stay as the authored fallback so this change is
    // byte-identical for them.
    if (Number.isFinite(sp.clearance)) return Math.max(4, +sp.clearance);
    if (sp.id === "megalodon") return 88;
    if (sp.id === "humpback_whale") return 58;
    if (sp.id === "great_white_shark") return 34;
    return 16 + Math.min(22, (sp.scale || 1) * 8);
  }

  // How far the authored model origin sits below the animated surface. Big
  // animals retain a dorsal/back read; little fish remain genuinely submerged.
  function aquaticBodyDepth(sp) {
    if (!sp) return 1;
    // Declared per row, same reason and same fallback as aquaticClearance.
    if (Number.isFinite(sp.swimDepth)) return Math.max(0.15, +sp.swimDepth);
    if (sp.id === "megalodon") return 7.8;
    if (sp.id === "humpback_whale") return 2.8;
    if (sp.id === "great_white_shark") return 2.45;
    if (sp.id === "dolphin") return 1.55;
    return 0.72;
  }

  /* ---- WHERE A BODY IN THE WATER BELONGS -------------------------------
     OWNER (2026-08-03): "sharks occasionally glitch — you see their fin poking
     out of the water correctly, but then you see the full shark and another
     fin above the fin, floating. It's an issue with all marine life and a
     water issue in general."

     ONE law, for every marine animal and every path that moves one — wander,
     hunt, death. `draft` is how far the authored model origin sits under the
     surface (aquaticBodyDepth above); `lift` is how far that origin stands
     over the bed once the animal is AGROUND.

     NEVER ASK CBZ.floorAt OUT HERE, and that is the whole bug. floorAt is the
     WALKABLE floor; city/world.js clamps every provider through
     `Math.max(0, real)`, so over the entire sea it answers 0 — about half a
     metre ABOVE the waterline. A seabed clamp written against it cannot hold a
     body down, it can only launch one, which is exactly the shark hovering
     over its own (correctly placed) fin proxy. city/waterfield.js publishes
     the real bed as CBZ.citySeaBedY.

     AGROUND_MIN_SUB is the other half. Where the water is genuinely shallower
     than the animal is deep, the bed is allowed to win — a stranded shark
     SHOULD show its back, and that is the scarier read — but only until half
     its authored draft is still wet. Past that line it has stopped being
     stranded and started flying, and no clamp in this game may cross it. */
  const AGROUND_MIN_SUB = 0.5;
  function aquaticSurfY(x, z, t) {
    if (CBZ.citySeaHeightAt) {
      const s = +CBZ.citySeaHeightAt(x, z, t);
      if (Number.isFinite(s)) return s;
    }
    // NATURAL DISASTER has its own sea (world/disaster_arena.js), surge and
    // all, and it is the whole reason a shark can end up in a flooded street.
    // Asking for it here is what makes every marine body in this file — wander,
    // hunt and death alike — sit at the right height in that mode too.
    if (CBZ.survSeaHeightAt) {
      const s = +CBZ.survSeaHeightAt(x, z, t);
      if (Number.isFinite(s)) return s;
    }
    if (CBZ.waterSeaY) { const s = +CBZ.waterSeaY(); if (Number.isFinite(s)) return s; }
    return CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48;
  }
  // The HIGHEST a body may be pushed by the bed at (x,z) — i.e. the aground
  // rest height, capped so it can never leave the water. -Infinity when no bed
  // is knowable, which degrades every caller to "no bed clamp at all".
  function aquaticBedRestY(x, z, draft, lift, t, surf) {
    const s = Number.isFinite(surf) ? surf : aquaticSurfY(x, z, t);
    // Ask for the COLUMN, not the bed's world Y: this runs per sea creature per
    // frame and the caller already has the surface, so going through
    // citySeaBedY would evaluate the whole swell table a second time.
    let bed;
    /* THE ISLAND'S BOTTOM FIRST when the island is the world we are stocked
       for. CBZ.citySeaBedDepth is waterfield's RAW city answer and is defined
       even where the city was never built, so out here it reported 0 and this
       function returned -Infinity — i.e. NO BED CLAMP AT ALL — for every body
       in the disaster island's sea. Two property reads on the city path. */
    if (CBZ.surv && CBZ.surv.arena === ARENA() && CBZ.survFloodDepthMeanAt) {
      const col = +CBZ.survFloodDepthMeanAt(x, z);
      if (!(col > 0)) return -Infinity;
      bed = s - col;
    } else if (CBZ.citySeaBedDepth) {
      const col = +CBZ.citySeaBedDepth(x, z);
      if (!(col > 0)) return -Infinity;           // no water column here at all
      bed = s - col;
    } else if (CBZ.citySeaBedY) {
      bed = +CBZ.citySeaBedY(x, z, t);
    } else if (CBZ.survSeaBedYAt) {
      bed = +CBZ.survSeaBedYAt(x, z);            // the disaster island's bottom
    } else return -Infinity;
    if (!Number.isFinite(bed)) return -Infinity;
    return Math.min(bed + (lift || 0), s - Math.max(0, draft) * AGROUND_MIN_SUB);
  }
  // ...and the complete answer: draft under the live surface, lifted onto the
  // bed where the water is too shallow to float the animal.
  function aquaticBodyY(x, z, draft, lift, t) {
    const surf = aquaticSurfY(x, z, t);
    const y = surf - Math.max(0, draft);
    const rest = aquaticBedRestY(x, z, draft, lift, t, surf);
    return y < rest ? rest : y;
  }
  // How far an animal's origin stands over the bed when it is aground. Derived
  // from its own scale, so a new species costs no row (the 0.9 factor is the
  // one wildlife_shark.js's bed clamp has always used).
  // Takes a SPECIES or an ACTOR: `sp.scale` was only ever a stand-in for "how
  // big is the body sitting on this bed", and with individual size that answer
  // belongs to the animal, not the row. wildlife_shark.js and any other caller
  // that still hands it a species keeps the old answer exactly.
  function aquaticBedLift(sp) {
    if (sp && sp.animal) return SZ(sp) * 0.9;
    return ((sp && sp.scale) || 1) * 0.9;
  }
  CBZ.cityAquaticBedRestY = aquaticBedRestY;
  CBZ.cityAquaticBodyY = aquaticBodyY;
  CBZ.cityAquaticBedLift = aquaticBedLift;
  // ..and the shore clearance a species declares, for the same reason: a mode
  // that places one body of its own (modes/shark_sim.js keeps the sim's sea
  // stocked as the player eats it) must ask the SAME question this file's
  // spawner asks, not carry a second copy of the ladder that drifts from it.
  CBZ.cityAquaticClearance = aquaticClearance;

  function oceanPoint(r, sp) {
    // Spawn from the same signed coast the visible sea uses. This is the
    // water equivalent of navmesh random-point sampling: a radius candidate
    // is accepted only when its whole body has shoreline clearance.
    if (CBZ.waterField && CBZ.waterField.randomWaterPoint) {
      const p = CBZ.waterField.randomWaterPoint(r, {
        cx: FIELD.cx, cz: FIELD.cz, r0: FIELD.r0, r1: FIELD.r1,
        clearance: aquaticClearance(sp),
      });
      /* FALL THROUGH ON NULL, and that is not defensive noise — it is the
         difference between Natural Disaster having sharks and not. waterfield
         answers for GANG CITY's bathymetry; ask it about a disaster island and
         it truthfully says "no water here", seedIndividuals bails on the null,
         and the mode silently gets an empty sea. The ring sampler below is the
         geometric answer for a world the city's field does not describe. */
      if (p) return p;
    }
    /* THE RING SAMPLER. Used for isolated unit loads and for any arena the
       city water field does not cover. A candidate is rejected if it is on a
       registered land region and validated against the WATER COLUMN the live
       world reports, so an island's beaches and its interior are excluded
       without this file knowing anything about them. */
    const clear = aquaticClearance(sp);
    // ..and where the live world publishes the band a body of this size can
    // actually swim in, sample THAT rather than the derived ring: it is the
    // same fence the mover enforces, so a point from it can never be a frozen
    // animal. Null means the body does not fit this sea at all (a blue marlin
    // wants 150 m of clearance in a 270 m bowl) — and the honest answer to
    // that is no spawn, not a spawn nobody will ever see move.
    const ring = CBZ.survNavRing && CBZ.survNavRing(clear);
    for (let tries = 0; tries < 40; tries++) {
      const a = r() * Math.PI * 2;
      let x, z;
      if (ring) {
        const rad = ring.r0 + Math.min(r(), r()) * (ring.r1 - ring.r0);
        x = ring.cx + Math.cos(a) * rad; z = ring.cz + Math.sin(a) * rad;
      } else {
        const rad = FIELD.r0 + r() * (FIELD.r1 - FIELD.r0);
        x = FIELD.cx + Math.cos(a) * rad; z = FIELD.cz + Math.sin(a) * rad;
      }
      if (CBZ.cityAnyRegion && CBZ.cityAnyRegion(ARENA(), x, z, 30)) continue;
      /* DEEP ENOUGH FOR THIS ANIMAL. A whale does not belong in the shallows a
         mackerel is happy in, and `clearance` is already that per-species
         number. */
      if (!(seaColumnAt(x, z) > Math.max(1.2, clear * 0.12))) continue;
      return { x, z };
    }
    /* NO POINT IS THE ANSWER WHEN THERE IS NO POINT. This used to return a
       CONSTANT — the mid-radius of the band, due east of its centre — which
       is how a disaster island ended up with its entire sea life stacked on
       one dead coordinate 187 m outside the navigable fence: frozen on their
       first step, LOD-hidden for being 300 m from anybody, all match, every
       match. seedIndividuals knows how to skip. */
    return null;
  }

  /* METRES OF WATER OVER THE BOTTOM, from the oracle that answers for the
     world we are STOCKED FOR.

     This used to be a three-tier else-if ladder whose first rung was
     `CBZ.citySeaBedDepth` — waterfield's RAW city bathymetry, which is
     published unconditionally at load and answers 0 for every coordinate of
     a world where the city terrain was never built. So on the disaster
     island the first rung was always taken, always said "no water", and the
     two rungs under it that would have answered correctly were unreachable
     code. The wrapped names (world/water_survival.js) are the ones that know
     which world is live; the island's own is asked directly because the
     arena we hold IS the answer to "which world". */
  function seaColumnAt(x, z) {
    if (CBZ.surv && CBZ.surv.arena === ARENA() && CBZ.survFloodDepthMeanAt) {
      return Math.max(0, +CBZ.survFloodDepthMeanAt(x, z) || 0);
    }
    if (CBZ.citySeaBedDepthAt) return Math.max(0, +CBZ.citySeaBedDepthAt(x, z) || 0);
    if (CBZ.citySeaBedDepth) return Math.max(0, +CBZ.citySeaBedDepth(x, z) || 0);
    const gh = (ARENA() && ARENA().groundHeightAt) || null;
    if (gh) return Math.max(0, aquaticSurfY(x, z, 0) - gh(x, z));
    return CBZ.survWaterAt && CBZ.survWaterAt(x, z) ? 99 : 0;
  }

  function wetPointNear(x, z, sp, radius) {
    const wf = CBZ.waterField;
    if (!wf || !wf.nearestWater) return { x: x, z: z };
    const p = wf.nearestWater(x, z, aquaticClearance(sp), radius || 240);
    /* NULL MEANS "not MY water", not "not water". In a mode whose sea the city
       water field does not describe, every jittered herd position would come
       back null and seedIndividuals would skip the whole school — the caller
       has already validated the anchor through oceanPoint, so handing the
       point straight back is the honest answer. */
    return p || { x: x, z: z };
  }

  function makeActor(sp, x, z) {
    let grp;
    try { grp = sp.build({ THREE: THREE, mat: mat, rng: rng }); }
    catch (e) { grp = fallbackMesh(sp); }
    if (!grp) grp = fallbackMesh(sp);
    /* ---- THIS ANIMAL'S OWN SIZE. Drawn from where it stands, never from the
       seeded rng stream: hash01 is order-independent, so adding a species
       tomorrow cannot resize the fish that spawned before it, and the same
       world seed grows the same sea forever. */
    const kSize = TRAITS ? TRAITS.sampleSize(sp, x, z) : 1;
    const s = (sp.scale || 1) * kSize;
    grp.scale.setScalar(s);
    // creature_combat.js caches actor._baseScale off group.scale.x the first
    // time anything attacks and then forces all three components back to it.
    // Handing it the right number up front is what stops a strike from
    // snapping a monster shark back to the species constant mid-bite.
    const swimDepth = sp.aquatic ? aquaticBodyDepth(sp) * Math.pow(kSize, 0.9) : 0;
    const waterY = sp.aquatic && CBZ.citySeaHeightAt ? CBZ.citySeaHeightAt(x, z) - swimDepth : 0;
    grp.position.set(x, sp.aquatic ? waterY : groundY(x, z), z);
    const initialHeading = rng() * 6.283;
    faceAnimalHeading(grp, initialHeading);
    // castShadow for the read; leave frustumCulled at its DEFAULT (true) so the
    // dozens of animals scattered across the map only draw when actually on
    // screen — never force ~1000 wildlife meshes to render every frame.
    grp.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    // CRITICAL (the "statues" bug): animals spawn DURING buildCity(), i.e.
    // BEFORE city/mode.js runs CBZ.batchStaticUnder + CBZ.freezeStaticUnder
    // over the same root. Without this tag the batcher merges every animal
    // mesh into static per-tile deco (originals removed!) and the freezer
    // stamps matrixAutoUpdate=false on the group — the sim keeps moving the
    // (now invisible) hitbox while a frozen statue stays behind, so animals
    // neither move nor line up with the player's crosshair. userData.dynamic
    // is the batcher's & freezer's own "leave this subtree alive" contract.
    if (LIVE()) grp.userData.dynamic = true;
    root.add(grp);
    /* SIZE IS LOAD-BEARING, and this is where it becomes so. hp goes as k^2.1
       (a monster takes nearly three times the killing), straight-line speed as
       k^-0.18 (big things cruise slower; landWalk's turn clamp already made
       them turn worse and now reads the individual too). Everything downstream
       — bite, reach, sense radius, seize hold, ragdoll mass, car-impact mass —
       reads SZ(a) rather than the species row. */
    const hpK = Math.pow(kSize, 2.1);
    const hp0 = Math.max(4, Math.round((sp.hp || 40) * hpK));
    // BASE0 is this individual's own cruise speed. Every `(sp.spd || 1.4) * k`
    // in this file meant "how fast is this animal" and answered with the
    // species row; they all read it now, so a monster is genuinely slower in a
    // straight line and a runt is genuinely faster, in every state.
    const spd0 = (sp.spd || 1.4) * Math.pow(kSize, -0.18);
    const a = {
      species: sp, kind: "animal", animal: true,
      group: grp, pos: grp.position,      // fpsmode/interactions read .group.position and .pos
      hp: hp0, maxHp: hp0, dead: false, ko: 0, escaped: false,
      heading: initialHeading, faceH: initialHeading, turnT: rng() * 3,
      spd: spd0, _spd0: spd0,
      state: "wander", alarm: 0, home: { x: x, z: z },
      bob: rng() * 6.283, hitCount: 0, cleanKill: false,
      stateT: 0,                          // seconds left in the current timed behavior
      _sizeMul: kSize,                    // this individual's own multiplier
      _sizeEff: s,                        // ..and its effective world scale (grow-aware)
      // DID IT COME OFF THE MONSTER TAIL? Stamped rather than inferred from a
      // threshold: a wide-spread species reaches 1.4 on its ordinary
      // distribution, so "k >= 1.3" would report a perfectly normal big shark
      // as a legend and the ratchet would be measuring nothing.
      _bigOne: !!(TRAITS && TRAITS.isBigOne(sp, x, z)),
      _baseScale: s,                      // creature_combat's rest scale, seeded correctly
    };
    // HUNGER starts spread across the population, deterministically, so the
    // world does not begin with every animal on the same stomach — the ocean
    // is meant to hold a fed shark drifting past a starving one on minute one.
    if (TRAITS && TRAITS.HUNGER_ON()) {
      a.hunger = 0.14 + (CBZ.hash01 ? CBZ.hash01(x, z, 0x8A79E4) : 0.5) * 0.72;
    }
    if (sp.aquatic) {
      // A bigger body needs more water under it and swims deeper; a runt will
      // come into shallows the adult refuses. Both are the same k, at the
      // exponents the clearance/depth ladders were already shaped for.
      a.waterClearance = aquaticClearance(sp) * Math.pow(kSize, 0.7);
      a.swimDepth = swimDepth;
      a._swimDepth0 = swimDepth;          // hunger leans on this; never compound
      a._waterMove = { x: x, z: z, heading: initialHeading, blocked: false, shore: -999 };
      a._baseClear = a.waterClearance;    // hunger leans on this; never compound
    }
    // discover the rig ONCE: legs/head for walkers, tail/jaw for swimmers.
    // Each builder bails on the other's animals, so this is one line per actor.
    if (LIVE()) { buildGaitRig(a); buildSwimRig(a); }
    // snakes carry a segment chain the engine undulates (slither) — cache the
    // parts the build() registered on userData so the anim loop is allocation-free.
    if (sp.snake && grp.userData) {
      a.snake = true;
      a.segs = grp.userData.segs || [];
      a.hood = grp.userData.hood || null;
      a.rattle = grp.userData.rattle || null;
      a.rear = grp.userData.rear || 0;
      a.spacing = grp.userData.spacing || 0.2;
      a.baseY = grp.userData.baseY || 0.08;
      a.phase = rng() * 6.283; a.reared = false; a.strikeT = 0; a.strikeAnim = 0; a.grabT = 0;
    }
    animals.push(a);
    return a;
  }

  /* THE ONE PLACE AN ANIMAL'S SCALE IS WRITTEN. There were three (spawn, the
     newborn in breed(), and the grow-up in tick()) and they each re-derived
     `sp.scale * something`, which is precisely how the individual multiplier
     would have been silently thrown away the first time a calf grew up.
     `grow` is 0..1 how far along a newborn is (null = adult).

     It also keeps creature_combat's _baseScale honest, which was a real latent
     bug before this change: that file caches group.scale.x at the first strike
     and forces the group back to it forever after, so a calf attacked while
     small stayed calf-sized for the rest of its life. */
  function applyScale(a, grow) {
    const k = a._sizeMul > 0 ? a._sizeMul : 1;
    const g = grow == null ? 1 : (0.4 + 0.6 * grow);
    const s = ((a.species && a.species.scale) || 1) * k * g;
    a._sizeEff = s;
    a._baseScale = s;
    a._hgInv = null;                     // metabolism follows the body it feeds
    if (a.group) a.group.scale.setScalar(s);
    return s;
  }

  function fallbackMesh(sp) {
    // never let a broken build() crash the world — a plain quadruped box.
    const gp = new THREE.Group();
    const c = sp.color || 0x8a6a44;
    const body = new THREE.Mesh(CBZ.boxGeom(1.5, 0.8, 0.7), mat(c)); body.position.y = 0.9; gp.add(body);
    const head = new THREE.Mesh(CBZ.boxGeom(0.5, 0.5, 0.45), mat(c)); head.position.set(1.0, 1.1, 0); gp.add(head);
    [[-0.55, 0.22], [0.55, 0.22], [-0.55, -0.22], [0.55, -0.22]].forEach(function (o) {
      const leg = new THREE.Mesh(CBZ.boxGeom(0.16, 0.9, 0.16), mat(c));
      leg.position.set(o[0], 0.45, o[1]); gp.add(leg);
    });
    return gp;
  }

  function groundY(x, z) { return (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) || 0; }

  // BEHAVIOR CLASSES + classify() live in city/wildlife_rig.js (shared with
  // the battle page and the beast pit). Same table, same objects — cls
  // identity tests (cls === CLASSES.stalker) keep working.
  const CLASSES = RIG.CLASSES;
  const classify = RIG.classify;

  function sq(v) { return v * v; }

  // GAIT RIG discovery + the per-frame gait live in city/wildlife_rig.js.
  const buildGaitRig = RIG.buildGait;
  const gaitAnimate = RIG.animateGait;
  // Aquatic articulation has the same single owner.  Keeping a second copy in
  // this hunting engine meant a new authored-mouth field could work in Battle
  // (wildlife_rig) and silently disappear in Gang City (this file overwrote the
  // globals later).  Use the shared functions directly so one mouth contract
  // reaches every game and every visual preset.
  const buildSwimRig = RIG.buildSwim;
  const animateSwim = RIG.animateSwim;

  // ============================================================
  //  AGGRO EYES — the Minecraft-wolf moment: the eyes of a hunting predator
  //  GLOW RED. Unlit MeshBasicMaterial so they read at gameplay distance in
  //  any light; created lazily on the discovered head box the first time an
  //  animal aggros, swollen slightly bigger the moment it commits to the
  //  charge. Off in stalk-free states and on death.
  // ============================================================
  let eyeMat = null;
  function aggroEyeMat() {
    if (!eyeMat) eyeMat = new THREE.MeshBasicMaterial({ color: 0xff2015 });
    return eyeMat;
  }
  function makeEyes(a) {
    const hm = a.gait && a.gait.headMesh;
    if (!hm || !hm.geometry) return null;
    const p = hm.geometry.parameters || {};
    const w = p.width || 0.4, h = p.height || 0.4, dep = p.depth || 0.4;
    const s = Math.max(0.07, Math.min(0.17, dep * 0.26));
    const eyes = [];
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const e = new THREE.Mesh(CBZ.boxGeom(s, s, s), aggroEyeMat());
      // straddle the front-top CORNERS so the glow pokes out of the front
      // AND side faces — readable head-on, in profile, and three-quarter.
      e.position.set(w / 2 - s * 0.1, h * 0.22, sgn * (dep / 2 - s * 0.1));
      e.visible = false;
      hm.add(e);                                   // rides every head dip/turn
      eyes.push(e);
    }
    return eyes;
  }
  /* THE EYES ARE A HUNGER READ TOO. Charging and stalking light them as they
     always did; on top of that a predator that is genuinely STARVING carries
     them lit while it is merely cruising, so the shape moving along the
     treeline at night tells you what it wants before it has decided who. A
     fed one is dark, which is the whole difference. Costs nothing:
     setAggroEyes early-returns unless the mode actually changed, and the
     hunger drive behind it is a cached scratch re-derived every few seconds. */
  const EYE_STARVED = 0.82;
  function eyeMode(a) {
    if (a.state === "charge") return 2;
    if (a.state === "stalk") return 1;
    return (HUNGER(a) >= EYE_STARVED && a.species && predSpecies(a.species)) ? 1 : 0;
  }

  function setAggroEyes(a, mode) {   // 0 off · 1 stalking (lit) · 2 charging (lit + swollen)
    if (a._eyeMode === mode) return;
    a._eyeMode = mode;
    if (!a._eyes && mode) a._eyes = makeEyes(a);
    const eyes = a._eyes; if (!eyes) return;
    for (let i = 0; i < eyes.length; i++) {
      eyes[i].visible = mode > 0;
      eyes[i].scale.setScalar(mode === 2 ? 1.5 : 1);
    }
  }

  // ---- matrix LOD: a hidden animal's subtree stops paying r128's per-frame
  //      updateMatrix() tax (the whole point of core/staticfreeze.js — we keep
  //      its saving without its bug by freezing/thawing on visibility flips).
  function setLiveMats(a, on) {
    if (a._mOn === on) return;
    a._mOn = on;
    a.group.traverse(function (o) { o.matrixAutoUpdate = on; if (!on) o.updateMatrix(); });
  }

  // ============================================================
  //  HERDS — a herd moves as ONE cohesive body (boids: alignment + cohesion +
  //  separation) and PANICS as one: spook or shoot a single member and the
  //  alarm ripples through the whole herd, so a bison herd stampedes as a wall
  //  and a deer herd bolts together. Each herd carries a live centroid + mean
  //  heading (recomputed once per frame, O(n) total, not O(n²)).
  // ============================================================
  const herds = [];
  // `bunch` (0..1) is how hard a hungry predator nearby has packed this group
  // in — raised by alarmFromPredator, decayed here, spent by the two cohesion
  // blocks. It is deliberately NOT `panic`: a herd can be tight and calm (the
  // wolf is only peckish) or scattered and terrified (a rifle shot).
  function newHerd(sp) { const hr = { sp: sp, members: [], cx: 0, cz: 0, heading: rng() * 6.283, n: 0, panic: 0, bunch: 0, fleeHx: 0, fleeHz: 0 }; herds.push(hr); return hr; }
  function joinHerd(a, hr) { a.herd = hr; if (hr) hr.members.push(a); }
  function leaveHerd(a) {
    const hr = a.herd; if (!hr) return;
    const i = hr.members.indexOf(a); if (i >= 0) hr.members.splice(i, 1);
    a.herd = null;
  }
  function updateHerds(dt) {
    for (let h = 0; h < herds.length; h++) {
      const hr = herds[h];
      let sx = 0, sz = 0, hx = 0, hz = 0, n = 0, panic = 0;
      for (let m = 0; m < hr.members.length; m++) {
        const a = hr.members[m];
        if (a.dead || a.tamed || a.ridden) continue;          // corpses & pets leave the wander flock
        sx += a.pos.x; sz += a.pos.z;
        hx += Math.cos(a.heading); hz += Math.sin(a.heading);
        n++;
        if (a.alarm > panic) panic = a.alarm;                 // loudest alarm carries the herd
      }
      hr.n = n;
      if (n) { hr.cx = sx / n; hr.cz = sz / n; if (hx || hz) hr.heading = Math.atan2(hz, hx); }
      hr.panic = Math.max(0, panic);
      // the knot loosens over about eight seconds once the hunter has moved
      // off, so a herd relaxing is something you can watch happen.
      if (hr.bunch > 0) hr.bunch = Math.max(0, hr.bunch - dt * 0.12);
    }
  }

  function seedIndividuals(sp, count) {
    // place `count` individuals of a species, clustered into herds of the
    // species' NATURAL size. Herd size is a per-species TRAIT (how they group);
    // `count` is set by the ratio system (how many exist). The two are
    // decoupled — that's what makes the mix scalable.
    let placed = 0, guard = 0, dry = 0;
    while (placed < count && guard++ < 400) {
      const regs = sp.aquatic ? null : biomeRegions(sp.biome);
      if (!sp.aquatic && (!regs || !regs.length)) return placed;
      const anchor = sp.aquatic ? oceanPoint(rng, sp) : regionPoint(regs[(rng() * regs.length) | 0], rng);
      /* NO VALIDATED WATER MEANS NO AQUATIC SPAWN — but a single miss is a
         miss, not a verdict. oceanPoint can decline one candidate ring in a
         sea it can still place the species in; three in a row is the sea
         telling you this body does not fit (a marlin in a 270 m bowl), and
         THAT is the species to leave out rather than freeze in place. */
      if (!anchor) { if (!sp.aquatic || ++dry >= 3) return placed; continue; }
      let herd = sp.herd ? (sp.herd[0] + ((rng() * (sp.herd[1] - sp.herd[0] + 1)) | 0)) : 1;
      herd = Math.min(herd, count - placed);
      const hr = newHerd(sp);            // this cluster moves & panics as ONE unit
      for (let h = 0; h < herd; h++) {
        let jx = anchor.x + (rng() - 0.5) * (sp.aquatic ? 60 : 22);
        let jz = anchor.z + (rng() - 0.5) * (sp.aquatic ? 60 : 22);
        if (sp.aquatic) {
          const wet = wetPointNear(jx, jz, sp, 260);
          if (!wet) continue;
          jx = wet.x; jz = wet.z;
        }
        const a = makeActor(sp, jx, jz); placed++;
        joinHerd(a, hr);
        // a herd of 2+ trails a BABY (a tiny scaled-down copy — see grow logic).
        if (h === herd - 1 && herd >= 2 && rng() < 0.75) {
          a.grow = rng() * 0.4;
          applyScale(a, a.grow);
        }
      }
    }
    return placed;
  }

  // ============================================================
  //  THE RATIO SYSTEM — population by PROPORTION, not per-species numbers.
  //
  //  Grounded in real ecology (energy pyramid / 10% rule: predators are far
  //  rarer than prey) and RDR2's feel (prey in big herds, pack hunters in
  //  packs, apex predators lurking singly & rare, legendaries unique).
  //
  //  Three layers of pure ratios + ONE design scalar. Nothing per-species is
  //  hardcoded, so adding/removing a species auto-rebalances and the world
  //  total never drifts. NOTE: DENSITY is ECOLOGICAL richness (a design knob),
  //  NOT a perf budget — render cost is the quality slider's job (LOD below).
  //    1. DENSITY        how many animals conceptually inhabit the world.
  //    2. BIOME_SHARE    how that splits across biomes (sums to 1).
  //    3. RARITY_WEIGHT  a common is 12x a rare — so "rare" stays rare no
  //                      matter how many rare species exist. Species in a tier
  //                      split their tier's slice evenly.
  //    4. PRED_MAX       predators can't exceed this fraction of a biome
  //                      (the pyramid backstop); the surplus reweights to prey.
  //  Legendaries are outside all of this: exactly ONE individual each.
  // ============================================================
  // DENSITY sized so a gregarious species forms a REAL herd, not a few strays:
  // e.g. snow ~16% x 850 ≈ 136 animals, of which bison (an uncommon) work out
  // to ~18 — one proper stampeding herd. A world of a few hundred could never
  // hold a legit herd. This is ECOLOGICAL richness (a design knob), NOT a perf
  // budget: distant animals FREEZE (see tick) and LOD-hide (quality slider), so
  // only the herds near you actually think and draw — the world scales cheaply.
  const DENSITY = 850;
  // water 0.20 -> 0.30. The share is a PER-BIOME multiplier of DENSITY, not a
  // slice of a fixed pie (each biome's target is DENSITY * its own share), so
  // this adds sea life without taking one animal off the land. 170 -> 255
  // bodies, spread over 2.4x the area and 13 species instead of 5 — which is
  // roughly the same density you could already swim through, in an ocean that
  // now has regions: bull sharks in the surf, marlin and orca in blue water.
  const BIOME_SHARE = { forest: 0.25, farmland: 0.16, desert: 0.23, snow: 0.16, water: 0.30 };
  const RARITY_WEIGHT = { common: 12, uncommon: 4, rare: 1 };
  const PRED_MAX = 0.20;                    // ≤ ~1 predator per 4 prey per biome
  // TROPHIC ROLE (diet), for the pyramid — distinct from `danger` (will it hurt
  // you). Only true CARNIVORES count as predators; a bison, moose, rhino or boar
  // is dangerous PREY (charges when threatened but eats plants), so it must NOT
  // suppress the predator pool. A species can override via sp.predator (true =
  // hunter). This is the one place trophic role lives; extend the set for new
  // carnivores, or set sp.predator on the species itself.
  const CARNIVORE = {
    gray_wolf: 1, arctic_wolf: 1, coyote: 1, red_fox: 1,
    black_bear: 1, brown_bear: 1, polar_bear: 1,
    bengal_tiger: 1, lion: 1, white_lion: 1, cheetah: 1, snow_leopard: 1,
    rattlesnake: 1, king_cobra: 1, black_mamba: 1, green_anaconda: 1,
    great_white_shark: 1, megalodon: 1,
  };
  function isPredator(sp) { return sp.predator != null ? !!sp.predator : !!CARNIVORE[sp.id]; }

  function planBiome(list, target) {
    // list = non-legendary species in one biome. Returns { id: count }.
    let wSum = 0;
    for (const sp of list) wSum += (RARITY_WEIGHT[sp.rarity] || 1);
    const ideal = {};
    for (const sp of list) ideal[sp.id] = target * (RARITY_WEIGHT[sp.rarity] || 1) / wSum;
    // PREDATOR CEILING: if predators overshoot their share of the biome, scale
    // them down and hand the freed budget to prey (proportionally) — a biome
    // rich in predator SPECIES still stays prey-dominated, per the pyramid.
    let predSum = 0, preySum = 0;
    for (const sp of list) (isPredator(sp) ? (predSum += ideal[sp.id]) : (preySum += ideal[sp.id]));
    const predCap = target * PRED_MAX;
    if (predSum > predCap && preySum > 0) {
      const kPred = predCap / predSum, freed = predSum - predCap;
      for (const sp of list) if (isPredator(sp)) ideal[sp.id] *= kPred;
      for (const sp of list) if (!isPredator(sp)) ideal[sp.id] += freed * (ideal[sp.id] / preySum);
    }
    // round to integers with largest-remainder so the biome total is exact,
    // and guarantee every species is PRESENT (min 1 — presence is not optional).
    const counts = {}; let floorSum = 0; const rema = [];
    for (const sp of list) {
      const v = Math.max(1, ideal[sp.id]);
      const f = Math.floor(v); counts[sp.id] = f; floorSum += f;
      rema.push({ id: sp.id, r: v - f });
    }
    let leftover = Math.max(0, Math.round(target) - floorSum);
    rema.sort((a, b) => b.r - a.r);
    for (let i = 0; i < leftover; i++) counts[rema[i % rema.length].id]++;
    return counts;
  }

  /* HOW MANY ANIMALS THIS WORLD GETS, relative to Gang City's DENSITY. A
     disaster island's ring of sea is a fraction of a 25 km coastline and would
     otherwise be handed a continent's worth of fish; a mode says how much of
     the budget it wants and everything downstream (per-biome share, per-species
     plan, carrying capacity) follows automatically. 1 = the city. */
  let densityK = 1;

  function spawnAll() {
    const S = CBZ.WILDLIFE_SPECIES || {};
    // bucket non-legendary species by biome
    const buckets = {};
    for (const id in S) { const sp = S[id]; if (sp.rarity === "legendary") continue; (buckets[sp.biome] || (buckets[sp.biome] = [])).push(sp); }
    for (const biome in buckets) {
      const target = Math.round(DENSITY * densityK * (BIOME_SHARE[biome] || 0.15));
      const counts = planBiome(buckets[biome], target);
      for (const sp of buckets[biome]) seedIndividuals(sp, counts[sp.id] || 1);
    }
    // LEGENDARY — the incredibly rare ones. Exactly ONE each, deep in range.
    for (const id in S) {
      const sp = S[id]; if (sp.rarity !== "legendary") continue;
      let pt;
      if (sp.aquatic) pt = oceanPoint(rng, sp);
      else { const regs = biomeRegions(sp.biome); if (!regs.length) continue; pt = regionPoint(regs[(rng() * regs.length) | 0], rng); }
      if (!pt) continue;
      const a = makeActor(sp, pt.x, pt.z); a.legendary = true;
    }
  }

  // ============================================================
  //  BREEDING — population-relative spawning. There is NO magic respawn: new
  //  animals only ever come FROM living animals of the same species (each pass,
  //  every live animal has a small chance to produce a newborn beside it,
  //  logistic-damped by how full the world is). The consequence is real
  //  ecology: a thriving herd recovers on its own, a hunted-down herd recovers
  //  SLOWLY, and a species hunted to ZERO is EXTINCT — forever. Zero breeds
  //  zero. Legendaries (respawn:false) are unique and never breed: kill the
  //  White Stag and there will never be another.
  // ============================================================
  function liveCount() {
    let n = 0;
    for (let i = 0; i < animals.length; i++) if (!animals[i].dead) n++;
    return n;
  }

  // per-species carrying capacity = the population the world was SEEDED with.
  // This is ECOLOGY, not a perf budget: it's the natural herd size each species
  // breeds back toward (a herd at its natural size simply has no room to grow).
  const CAPS = {};
  function recordCaps() {
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i]; if (a.dead) continue;
      CAPS[a.species.id] = (CAPS[a.species.id] || 0) + 1;
    }
  }

  function breed() {
    // bucket the LIVING by species (the dead don't reproduce)
    const bySpecies = {};
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      if (a.dead) continue;
      const sp = a.species;
      if (sp.rarity === "legendary" || sp.respawn === false) continue;   // unique — never bred
      (bySpecies[sp.id] || (bySpecies[sp.id] = [])).push(a);
    }
    const P = CBZ.player && CBZ.player.pos;
    for (const id in bySpecies) {
      const herd = bySpecies[id];               // extinct species simply aren't here
      const sp = herd[0].species;
      // logistic growth toward THIS species' own carrying capacity: births ∝
      // current population × how far below its natural size the herd is. A
      // full herd births nothing; a herd of 1 recovers slowly; 0 breeds 0.
      const cap = CAPS[id] || 4;
      const room = 1 - herd.length / cap;
      if (room <= 0) continue;
      let births = 0;
      for (let i = 0; i < herd.length; i++) if (Math.random() < BREED_RATE * room) births++;
      births = Math.min(births, 2);             // one pass never explodes a herd
      for (let b = 0; b < births; b++) {
        const parent = herd[(Math.random() * herd.length) | 0];
        const jit = sp.aquatic ? 26 : 8;
        let nx = parent.pos.x + (Math.random() - 0.5) * jit;
        let nz = parent.pos.z + (Math.random() - 0.5) * jit;
        if (sp.aquatic) {
          const wet = wetPointNear(nx, nz, sp, 180);
          if (!wet) continue;
          nx = wet.x; nz = wet.z;
        }
        // don't pop a newborn in right under the player's nose
        if (P && Math.hypot(nx - P.x, nz - P.z) < 50) continue;
        const kid = makeActor(sp, nx, nz);
        kid.grow = 0;                            // born tiny; grows up in tick()
        applyScale(kid, 0);                      // small from frame one, at ITS OWN size
        kid.home = { x: parent.home.x, z: parent.home.z };
        joinHerd(kid, parent.herd);              // born into the parent's herd
      }
    }
  }

  // ============================================================
  //  THE KILL — routed here from fpsmode.cityGunHit for any a.animal target.
  //  Tracks kill quality (a clean one-shot / headshot => pristine pelt) and
  //  turns the animal into a skinnable carcass on death.
  // ============================================================
  CBZ.cityWildlifeHit = function (a, hit, w) {
    if (!a || a.dead) return { head: false, down: false, dmg: 0 };
    // EXTERNAL actors (dogs) ride the CBZ.cityWildlife registry so the same
    // guns hit them, but their own module owns the reaction — delegate whole.
    if (a.onShot) return a.onShot(hit, w);
    // same range falloff the human targets get (WILDLIFE_LIVE only — flag
    // off keeps the old flat multiply). Callers that pass a bare {damage:n}
    // (dogs, companions) have no hit.dist and skip the falloff.
    const fall = (LIVE() && CBZ.weaponFalloffMul && hit && hit.dist != null && w && w.damage != null)
      ? (CBZ.weaponFalloffMul(w, hit.dist) || 1) : 1;
    const dmg = Math.max(1, Math.round((w && w.damage || 20) * (hit && hit.head ? (w && w.headMult || 2) : 1) * fall));
    a.hitCount++;
    a.hp -= dmg;
    // blood spritz where reachable (reuse the shared gore if present).
    if (hit && hit.point && CBZ.gore && CBZ.gore.spray) {
      try { CBZ.gore.spray(hit.point, hit.head ? 0.9 : 0.55, hit.dir || null); } catch (e) {}
    }
    if (a.hp <= 0) {
      // a PRISTINE pelt needs a clean kill: down in one or two hits, ideally a
      // headshot. Sloppy magazine-dumps ruin the hide (RDR2 rewards precision).
      a.cleanKill = (a.hitCount <= 1) || (a.hitCount <= 2 && !!(hit && hit.head));
      killAnimal(a, hit, w);
      return { head: !!(hit && hit.head), down: true, dmg: dmg };
    }
    // WOUNDED — predators charge, prey bolts. (A TAMED animal never turns on
    // its owner: it just takes the hit — shooting your own pet is on you.)
    if (a.tamed) return { head: !!(hit && hit.head), down: false, dmg: dmg };
    a.alarm = 8;
    // WHO HURT IT decides which way it runs. Before the food chain the only
    // possible answer was "the player", so the flee heading was hard-coded away
    // from CBZ.player — which made a deer bitten by a wolf sprint TOWARD the
    // wolf whenever the player happened to be on the far side. `w.by` (a hunter,
    // a car) names the real source; absent still means you.
    const by = (w && w.by) || null;
    const byPos = (by && by.pos) || (hit && hit.from) || null;
    const P = byPos || (CBZ.player && CBZ.player.pos);
    if (LIVE()) {
      // a visible recoil so every hit READS (creature_combat's shudder), then
      // the wound decides: anything with teeth turns on you, prey bolts hard.
      if (!a.snake && CBZ.creatureFlinch) { try { CBZ.creatureFlinch(a); } catch (e) {} }
      const cls = classify(a.species);
      // A MIGRATED HUNTER IS NOT PROVOKED BY POKING a.state. predatorHunt owns
      // stalk/charge for it, and a hot state written behind the driver's back
      // runs the legacy charge FSM while the driver still believes it is
      // cruising — two brains, one body, and it only shows up as the animal
      // behaving twice. It is provoked through the grammar instead:
      // predatorProvoke clears the cooldown, kills the fake-out, resets the
      // ambush timer and jumps it straight to `scent` with the notice stinger,
      // while deliberately leaving menace/commits alone (those two ARE the
      // anti-habituation rule and a rifle must not reset them). Without it a
      // shot bear could shrug for the 3-7s of a post-commit cooldown, which
      // reads as broken rather than tense.
      // A WOUND IS A PROVOCATION — for every damage class, because every damage
      // class arrives HERE. Gunfire (fpsmode), melee (combat.js), blasts
      // (blastWildlife), cars (cityWildlifeCarHit), another predator's bite
      // (preyOpts.onHit), a dog and a companion all call cityWildlifeHit, so
      // this one branch is the whole rule and there is nowhere else to put it.
      //
      // canDefend() replaces the old bare `danger > 0.15`, which was a threshold
      // that happened to be true for a moose and false for an elk while both
      // carry the same antlers. It also refuses a TAMED animal (shooting your
      // own pet is on you — see the early return above), a RECENTLY ROUTED one
      // (it already decided), and anything without the mass or the weapon to
      // answer at all.
      const fights = FIGHT() ? canDefend(a) : (a.species.danger > 0.15);
      if (fights && P) {
        // IT FIGHTS BACK AT WHAT ACTUALLY BIT IT. `by` is null for a player
        // shot, which is the old behaviour byte for byte; when another ANIMAL
        // drew the blood, the wound re-targets the hunt onto it instead of
        // onto whoever happens to be standing across the meadow. Satiation and
        // any half-finished meal are cleared: being eaten outranks being full.
        const foe = (by && by.animal && by.pos && !by.dead) ? by : (CBZ.player || null);
        a._feedT = 0; a._feedOn = null; a._satT = 0;
        // ..but only a MEAT EATER converts "it bit me" into "it is now my prey".
        // A moose that turns on a wolf is defending, not shopping, and its
        // target lives on `_defendOn`; writing `_prey` for it would put a wolf
        // on a herbivore's menu and hand it a carcass to feed at.
        a._prey = (foe && foe.animal && predSpecies(a.species)) ? foe : null;
        // ..UNTIL IT HAS TAKEN ENOUGH. A defender under a third of its health
        // stops defending and RUNS, which is the honest break-off the whole
        // mechanic needs to avoid being a fight to the death every time.
        const maxHp = a.maxHp || a.species.hp || 40;
        if (FIGHT() && a.hp <= maxHp * ROUT_HP) {
          routAnimal(a, P.x, P.z);
        } else if (FIGHT() && licenceDefend(a, "hurt", foe, DEF_RAGE + Math.random() * DEF_RAGE_RAND)) {
          // licenceDefend has already run predatorProvoke: the cooldown is
          // cleared, the fake-out is off, the peak-veto is suspended for a beat
          // (so a bullet can never be shrugged off) and the FSM is on `scent`.
          // Deliberately NOT reset: menace and commits, which ARE the
          // anti-habituation rule. A rifle does not buy a fresh animal.
        } else if (!huntsShared(a)) { a.state = "charge"; a._burstT = null; }
        else if (CBZ.predatorProvoke) {
          try { CBZ.predatorProvoke(a, foe); } catch (e) {}
        }
      }
      else {
        a.state = "flee"; a.stateT = (cls.fleeT || 4) + 2;
        if (P) a.heading = Math.atan2(a.pos.z - P.z, a.pos.x - P.x);
        a.spd = (a._spd0 || 1.4) * 2.2;
      }
    } else if (a.species.danger > 0.15 && P) { a.state = "charge"; }
    else { a.state = "flee"; if (P) { a.heading = Math.atan2(a.pos.z - P.z, a.pos.x - P.x); } a.spd = (a._spd0 || 1.4) * 2.2; }
    return { head: !!(hit && hit.head), down: false, dmg: dmg };
  };

  // ============================================================
  //  THE DEATH TUMBLE — the shared single-rigid-body fall, LIFTED OUT of
  //  killAnimal so it can actually be CALLED.
  //
  //  OWNER: "when they are killed they don't have death ragdoll like humans
  //  they just sit head pointed to sky dumb death animation." Two different
  //  files were literally doing that — dogs.js eased `rotation.z` to ±1.25 and
  //  arena_fights.js's pit loser snapped it to 1.35 — while THIS physics, which
  //  is a real (if rigid) fall, sat locked inside a function neither of them
  //  could reach. Nothing here is new: it is the same impulse, spin, bounce and
  //  side-biased rest wildlife has run on a shot deer for months.
  //
  //  It is deliberately the SECOND-best death. systems/quadruped_ragdoll.js
  //  takes the body whenever it can (near the camera, legs discoverable, solver
  //  budget free) and then the limbs really do flail; this is what a far kill,
  //  a snake, a fish or a full pool gets. Either way the killing round's
  //  DIRECTION is carried, so a deer shot from the road lands off the road.
  //
  //  `impulse` is the RAW impulse before mass damping (pass ~3-9); mass is
  //  derived here from the species' own scale so no caller has to know it.
  // ============================================================
  const _kdir = { x: 0, y: 0, z: 0 };
  function killDir(a, hit) {
    let dx = hit && hit.dir ? (+hit.dir.x || 0) : 0;
    let dy = hit && hit.dir ? (+hit.dir.y || 0) : 0;
    let dz = hit && hit.dir ? (+hit.dir.z || 0) : 0;
    let dl = Math.hypot(dx, dz);
    if (dl < 0.01) {
      // no travel direction (a blast, a bite, a car with no vector): fall away
      // from whatever killed it, else from the player, else anywhere.
      const src = (hit && hit.from) || null;
      const P = src || (CBZ.player && CBZ.player.pos);
      if (P) { dx = a.group.position.x - P.x; dz = a.group.position.z - P.z; dl = Math.hypot(dx, dz); }
    }
    if (dl < 0.01) { const ah = Math.random() * Math.PI * 2; dx = Math.cos(ah); dz = Math.sin(ah); dl = 1; }
    _kdir.x = dx / dl; _kdir.y = dy; _kdir.z = dz / dl;
    return _kdir;
  }

  // WHERE A CARCASS COMES TO REST. Land: the walkable floor, as it always was.
  // Water: the SAME column its living body swam in (aquaticBodyY) — a dead
  // shark stays a shark under the sea instead of a shark lying on top of it.
  // systems/quadruped_ragdoll.js refuses aquatic species outright, so this
  // tumble is the ONLY thing that ever settles a marine body, and it was
  // settling every one of them on floorAt — flat 0, i.e. half a metre of air
  // above the waterline. Measured 2026-08-03: a killed fish rested at y=+0.04
  // with the surface at -0.53.
  function carcassRestY(a, x, z, scale) {
    const sp = (a && a.species) || {};
    if (sp.aquatic) {
      return aquaticBodyY(x, z, a.swimDepth || aquaticBodyDepth(sp), aquaticBedLift(sp));
    }
    return groundY(x, z) + 0.08 * scale;
  }

  /* THE ROLL AXIS OF A CORPSE, AND WHY IT IS NOT rotation.z.

     Every animal asset is authored nose toward +X (wildlife_rig's convention)
     and THREE.Euler's default order is 'XYZ', which composes R = Rx·Ry·Rz —
     Rz is applied FIRST, in model space. So `group.rotation.z` on one of these
     bodies is the model-local PITCH: positive is NOSE UP. This tumble has
     always eased `restRoll` (±1.4 rad, i.e. 80°) onto exactly that channel,
     which does not lay a dead animal on its flank — it SITS IT UP, nose at the
     sky. That is the owner complaint quadruped_ragdoll.js was written to
     answer, quoted verbatim in its header; the solver fixed the bodies it
     accepts and this fallback kept the bug for everything it declines — every
     shark and snake (refused outright), every kill past the camera range gate,
     every body over budget, and the whole of games/battle.html, which had no
     solver loaded at all.

     rotation.order = 'YXZ' composes R = Ry·Rx·Rz instead, which makes
     rotation.x a roll about the body's own long axis AFTER the yaw — the axis
     a four-legged corpse actually goes over. predator_anim.js states the same
     rule in its r128 note ("a true long-axis roll needs rotation.order='YXZ'").
     So the corpse switches order once, at death, and the tumble's roll/pitch
     move to the channels that mean roll and pitch. Yaw is unchanged either way.
     Angles are near zero at the moment of death, so re-interpreting the live
     Euler under the new order moves nothing visible on the frame it happens. */
  function corpseEuler(grp) {
    if (grp.rotation.order !== "YXZ") grp.rotation.order = "YXZ";
  }
  CBZ.wildlifeCorpseEuler = corpseEuler;

  function wildlifeDeathTumble(a, dir, impulse, point) {
    if (!a || !a.group) return null;
    const grp = a.group, sp = a.species || {};
    corpseEuler(grp);
    let dx = dir ? (+dir.x || 0) : 0;
    const dy = dir ? (+dir.y || 0) : 0;
    let dz = dir ? (+dir.z || 0) : 0;
    let dl = Math.hypot(dx, dz);
    if (dl < 0.01) { const ah = Math.random() * Math.PI * 2; dx = Math.cos(ah); dz = Math.sin(ah); dl = 1; }
    dx /= dl; dz /= dl;
    const scale = Math.max(0.35, SZ(a));
    const mass = Math.max(0.75, scale * scale * 1.7);
    const raw = (impulse != null && isFinite(impulse) && impulse > 0) ? impulse : 5.9;
    const imp = Math.min(8.5, raw / Math.sqrt(mass));
    const side = point
      ? (Math.sign((point.x - grp.position.x) * -dz + (point.z - grp.position.z) * dx) || (Math.random() < 0.5 ? -1 : 1))
      : (Math.random() < 0.5 ? -1 : 1);
    // wRoll/wPitch/wYaw are named for what they DO, not for the channel they
    // used to land on: under 'YXZ' the roll rate drives rotation.x and the
    // pitch rate drives rotation.z. The magnitudes are the ones this tumble
    // was tuned with — only the axes were wrong.
    a._deathPhys = {
      vx: dx * imp, vy: Math.max(1.2, 1.6 + Math.max(-0.2, dy) * imp * 0.7), vz: dz * imp,
      wPitch: (Math.random() - 0.5) * 2.1 + dy * 0.8,
      wYaw: (Math.random() - 0.5) * 1.8,
      wRoll: side * (2.7 + Math.random() * 1.9) + dx * 0.5,
      restRoll: side * (1.38 + Math.random() * 0.14),
      restPitch: (Math.random() - 0.5) * 0.32,
      restYaw: grp.rotation.y + (Math.random() - 0.5) * 0.25,
      t: 0, groundT: 0, bounces: 0,
    };
    a._dieT = null;
    DEATHS.tumbles++;
    grp.position.y = Math.max(carcassRestY(a, grp.position.x, grp.position.z, scale), grp.position.y);
    return a._deathPhys;
  }
  CBZ.wildlifeDeathTumble = wildlifeDeathTumble;

  // The tumble's INTEGRATOR, also lifted out of the tick's dead branch for the
  // same reason: dogs.js's actors are `external`, so wildlife's tick skips them
  // entirely (see the `a.external` continue) and a dog handed the shared tumble
  // would have had nothing stepping it. Returns true while the body is still
  // moving. Verbatim physics — do not retune it here and there.
  function wildlifeDeathStep(a, dt) {
    const ph = a && a._deathPhys;
    if (!ph) return false;
    const grp = a.group;
    if (!grp) { a._deathPhys = null; return false; }
    const step = Math.min(0.04, dt);
    const scale = Math.max(0.35, SZ(a));
    ph.t += step;
    ph.vy -= 20.5 * step;
    corpseEuler(grp);
    grp.position.x += ph.vx * step;
    grp.position.y += ph.vy * step;
    grp.position.z += ph.vz * step;
    grp.rotation.x += ph.wRoll * step;    // 'YXZ': x is the long-axis ROLL
    grp.rotation.y += ph.wYaw * step;
    grp.rotation.z += ph.wPitch * step;   // ...and z is the model-local pitch
    const restY = carcassRestY(a, grp.position.x, grp.position.z, scale);
    if (grp.position.y <= restY && ph.vy < 0) {
      grp.position.y = restY;
      ph.bounces++;
      if (ph.bounces <= 1 && Math.abs(ph.vy) > 2.2) ph.vy = -ph.vy * 0.18;
      else ph.vy = 0;
      ph.vx *= 0.48; ph.vz *= 0.48;
      ph.wPitch *= 0.28; ph.wYaw *= 0.38; ph.wRoll *= 0.3;
      ph.groundT += step;
    } else ph.groundT = 0;
    const drag = Math.pow(0.3, step);
    ph.vx *= drag; ph.vz *= drag;
    ph.wPitch *= Math.pow(0.24, step); ph.wYaw *= Math.pow(0.2, step); ph.wRoll *= Math.pow(0.24, step);
    if (ph.vy === 0 || ph.t > 1.55) {
      const settle = Math.min(1, step * (ph.t > 2.2 ? 10 : 4.2));
      grp.rotation.x += (ph.restRoll - grp.rotation.x) * settle;
      grp.rotation.y += (ph.restYaw - grp.rotation.y) * settle;
      grp.rotation.z += (ph.restPitch - grp.rotation.z) * settle;
    }
    if ((ph.t > 2.7) || (ph.t > 1.45 && ph.vy === 0 && Math.hypot(ph.vx, ph.vz, ph.wPitch, ph.wYaw, ph.wRoll) < 0.45)) {
      grp.position.y = restY;
      grp.rotation.x = ph.restRoll;
      grp.rotation.y = ph.restYaw;
      grp.rotation.z = ph.restPitch;
      a._deathPhys = null;
      return false;
    }
    return true;
  }
  CBZ.wildlifeDeathStep = wildlifeDeathStep;

  // THE ONE ENTRY EVERY DEATH USES. Ragdoll if the solver will take it (real
  // limbs), tumble if it will not. Exported because dogs.js and the arena pit
  // need exactly this decision and must never re-implement it — re-implementing
  // it is what produced two independent `rotation.z = ±1.3` snaps.
  function wildlifeDeathPhysics(a, dir, impulse, point) {
    if (!a || !a.group) return "none";
    // A TAMED ANIMAL MAY BE HOLDING A POSE. wildlife_tame.js's affection layer
    // owns leg/head/group offsets on a seated companion; hand every bone back
    // BEFORE the solver reads the body, or the corpse ragdolls out of a sit.
    if (a.tamed && CBZ.petRelease) { try { CBZ.petRelease(a); } catch (e) {} }
    let rag = false;
    if (CBZ.quadRagdoll) {
      try {
        rag = !!CBZ.quadRagdoll(a, {
          point: point || null, dir: dir || null,
          // the solver's impulse band is the human ragdoll's (1..34 — ~6 pistol,
          // ~14 shotgun, 20+ blast); ours is the tumble's raw 3-9, so scale it
          // once, here, rather than let two callers guess at the conversion.
          imp: Math.max(2, Math.min(30, (impulse || 5.9) * 2.2)),
        });
      } catch (e) { rag = false; }
    }
    if (rag) {
      a._deathPhys = null; a._dieT = null; a._toppleTo = null;
      DEATHS.ragdolls++;
      return "ragdoll";
    }
    wildlifeDeathTumble(a, dir, impulse, point);
    return "tumble";
  }
  CBZ.wildlifeDeathPhysics = wildlifeDeathPhysics;

  // how the world's deaths actually resolved — the ratchet's raw material.
  const DEATHS = { ragdolls: 0, tumbles: 0, legacyPose: 0 };

  // WHO KILLED IT. Every wildlife death used to be reported as YOURS, which was
  // fine while the player was the only killer in the game and is a lie the
  // moment a wolf takes a deer or a car clips an elk. `w.by` names the actor;
  // absent means the player, so every existing caller is byte-identical.
  const FEED_R = 70;                    // u — a kill you had no part in is only
                                        // worth a feed line if you could see it
  function killerIsPlayer(by) {
    if (!by) return true;
    if (by === CBZ.player || by.isPlayer) return true;
    return !!(CBZ.city && CBZ.city.playerActor && by === CBZ.city.playerActor);
  }
  function killerName(by) {
    if (!by) return "You";
    if (by.name) return by.name;
    if (by.species) return by.species.name || by.species.id || "an animal";
    return by.kind || "something";
  }
  function playerNear(a, r) {
    const P = CBZ.player && CBZ.player.pos;
    if (!P || !a.pos) return false;
    const dx = a.pos.x - P.x, dz = a.pos.z - P.z;
    return dx * dx + dz * dz < r * r;
  }

  function killAnimal(a, hit, w) {
    a.dead = true; a.ko = 0; a.state = "dead"; a.hp = 0;
    a.skinnable = true; a.skinT = CARCASS_LINGER;
    if (LIVE()) setAggroEyes(a, 0);          // the light goes out
    // a dead shark stops being ticked, so its surface proxy must be told to go
    // down with it — otherwise the fin hangs on the water forever.
    if (CBZ.sharkFinDrop) { try { CBZ.sharkFinDrop(a); } catch (e) {} }
    const grp = a.group;
    if (LIVE()) {
      const shotK = Math.max(0.55, (w && w.knock) || 1) * (w && w.pellets ? 1.22 : 1);
      wildlifeDeathPhysics(a, killDir(a, hit), 3.2 + shotK * 2.7, (hit && hit.point) || null);
    } else {
      // the flag-off build, untouched: one canned topple and freeze.
      grp.rotation.z = (Math.random() < 0.5 ? 1 : -1) * (1.15 + Math.random() * 0.25);
      grp.position.y = Math.max(0, grp.position.y) + 0.05;
      DEATHS.legacyPose++;
    }
    // A kill gets one full, direction-aware bleed event (pool + mist, no human
    // body-part logic); the connecting bullet already emitted its small entry
    // spray. This mirrors the one-impact/one-death split used for people.
    if (hit && hit.point && CBZ.gore) {
      try { CBZ.gore(hit.point.x, hit.point.y, hit.point.z, { dir: hit.dir || null, amount: hit.head ? 1.05 : 0.72, player: false }); } catch (e) {}
    }
    carcasses.push(a);
    // score/notify — a kill is a kill, but only YOUR kill is news.
    const by = (w && w.by) || null;
    /* THE UNIVERSAL MEAL HOOK, and it is here rather than in the food chain
       for one reason: EVERY animal death in this game funnels through this
       function, whoever landed it. The land food chain's own startFeed covers
       a wolf and a deer, but a shark's kill resolves inside wildlife_shark.js
       and a seize resolves inside systems/predator.js — files this change does
       not own — and both of them route their damage back through
       cityWildlifeHit, i.e. through here. So this one line is what makes a
       great white that has just eaten actually FULL, which is precisely the
       animal the owner named. mealFrom is receipted, so the wolf whose
       startFeed fires a frame later does not get the meal twice. */
    if (by && by.animal && !by.dead && by !== a && by.species && predSpecies(by.species)) mealFrom(by, a, 1);
    if (killerIsPlayer(by)) {
      if (CBZ.city) {
        if (a.legendary) { if (CBZ.city.note) CBZ.city.note("★ LEGENDARY " + a.species.name + " DOWN, skin it before it's gone!", 4, { urgent: true }); }
        else if (CBZ.city.note) CBZ.city.note(a.species.name + " down · walk up & hold to skin", 2.4);
      }
      if (CBZ.cityKillFeed) { try { CBZ.cityKillFeed("You", a.species.name, "hunted"); } catch (e) {} }
    } else if (playerNear(a, FEED_R) && CBZ.cityKillFeed) {
      // KILLFEED HYGIENE. The food chain runs across the whole map; a wolf
      // taking a deer two kilometres away is simulation, not news, and toasting
      // every one of them would turn the ONE sanctioned popup into spam.
      try { CBZ.cityKillFeed(killerName(by), a.species.name, (w && w.cause) || "killed"); } catch (e) {}
    }
    // let a following dog notice the kill too (dogs.js reads this list).
  }

  // Contact damage with a real source position. Heavy rammers additionally
  // launch the player through the shared player physics state, so gravity,
  // collisions and landing/knockdown are handled by systems/physics.js instead
  // of a canned camera shove.
  // A SOLID CONNECT PUTS YOU ON THE GROUND. Before, exactly ONE style launched
  // the player — `ram` — so a bison flattened you and a wild boar's tusk hit,
  // a moose's antler toss and a bighorn's charge were a number on the health
  // bar and nothing else. Three animals whose entire body plan is a battering
  // ram, landing like a slap. The launch is now graded by WHAT HIT YOU rather
  // than gated on one name: a shoulder charge throws you outright, a tusk hook
  // lifts and dumps you, a butt/kick shoves you off your feet. Everything below
  // is the ram's own arithmetic scaled by that one factor, so nothing is
  // re-authored and `ram` is byte-identical (KNOCK.ram === 1).
  const KNOCK = { ram: 1, gore: 0.84, stomp: 0.66 };
  function animalStrikePlayer(a, dmg, style) {
    const P = CBZ.player;
    if (!a || !P || !P.pos || P.dead) return;
    const sp = a.species || {};
    DEF.connects++;
    if (CBZ.cityHurtPlayer) {
      try {
        const label = (sp.name || sp.id || "animal").toLowerCase();
        CBZ.cityHurtPlayer(dmg, a.pos.x, a.pos.z,
          style === "ram" ? "rammed by a " + label
            : style === "gore" ? "gored by a " + label
            : style === "stomp" ? "trampled by a " + label
            : "attacked by a " + label,
          false, a, false);
      } catch (e) {}
    }
    const kf = ATK2() ? (KNOCK[style] || 0) : (style === "ram" ? 1 : 0);
    if (!kf || P.dead) return;
    let dx = P.pos.x - a.pos.x, dz = P.pos.z - a.pos.z;
    let dl = Math.hypot(dx, dz);
    if (dl < 0.01) { dx = Math.cos(a.heading || 0); dz = Math.sin(a.heading || 0); dl = 1; }
    dx /= dl; dz /= dl;
    const scale = Math.max(1, SZ(a));
    const charge = Math.max(1, a._spd0 || 2.2);
    const horiz = Math.min(14.5, 7.2 + scale * 2.5 + charge * 0.8) * kf;
    const ph = P._phys = P._phys || {};
    ph.air = true; ph.down = 0; ph.kx = ph.kz = 0;
    ph.vx = dx * horiz; ph.vz = dz * horiz;
    ph.vy = Math.min(10.5, 6.6 + scale * 2.0) * kf;
    ph.spin = (Math.random() < 0.5 ? -1 : 1) * (4.6 + scale * 1.2) * kf;
    ph.spin2 = (Math.random() - 0.5) * 4;
    P.grounded = false; P.vy = 0;
    if (CBZ.shake) CBZ.shake((0.85 + scale * 0.18) * kf);
    if (CBZ.doHitstop) CBZ.doHitstop(0.045 * kf);
    if (CBZ.sfx) CBZ.sfx("ko");
  }
  // Shared contact contract for authored animals/companions and diagnostics.
  CBZ.cityAnimalStrikePlayer = animalStrikePlayer;

  // ============================================================
  //  SKINNING — the payoff. Grants the pelt (quality-scaled) + a field bounty.
  // ============================================================
  function skin(a) {
    if (!a || !a.skinnable) return;
    a.skinnable = false;
    const sp = a.species, econ = CBZ.cityEcon;
    registerPelts();                     // idempotent; the catalog must exist to grant into
    let peltName = sp.fur, pristine = false;
    const edibleFur = furIsFood(sp);
    if (!edibleFur && sp.rarity !== "legendary" && a.cleanKill && Math.random() < 0.85) { peltName = "Pristine " + sp.fur; pristine = true; }
    let meatGot = 0;
    if (econ && econ.add) {
      econ.add(peltName, 1);
      // A BIG ANIMAL YIELDS A BIG CUT. The item catalog is per-species (a hide
      // is a hide), so the individual's size shows up where it can: in HOW
      // MANY portions the carcass gives up. Shooting the monster of the herd
      // is worth walking for, and that is the whole point of a size tail.
      if (sp.meat) {
        const bulk = Math.pow(SZ(a) / ((sp.scale || 1) || 1), 1.8);
        meatGot = Math.max(1, Math.round((1 + ((Math.random() * (sp.meatYield || 1)) | 0)) * bulk));
        econ.add(sp.meat, meatGot);
      }
    }
    // a small on-the-spot field bounty on top of the sellable pelt (a bigger
    // hide is worth more, by the same body-mass exponent the meal fill uses).
    const bounty = Math.round((sp.furValue || 20) * (pristine ? 0.35 : 0.2) *
      (sp.rarity === "legendary" ? 3 : 1) * Math.pow(SZ(a) / ((sp.scale || 1) || 1), 0.45));
    if (CBZ.city && CBZ.city.addCash && bounty > 0) CBZ.city.addCash(bounty);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(sp.rarity === "legendary" ? 8 : 1);
    // toast the haul — the HIDE is what it sells for, the MEAT is what it feeds
    // you, and the line says both because they are two different payoffs.
    const worth = (econ && econ.ITEMS[peltName] && econ.ITEMS[peltName].value) || sp.furValue || 20;
    const meatRow = meatGot && econ && econ.ITEMS[sp.meat];
    const meatLine = meatGot
      ? " · " + meatGot + "x " + sp.meat + (meatRow && meatRow.heal ? " (+" + meatRow.heal + " food each)" : "")
      : "";
    if (CBZ.city && CBZ.city.note) {
      CBZ.city.note("Skinned " + sp.name + " → " + peltName + " (~$" + worth + ")" + meatLine + (bounty ? " +$" + bounty : ""),
        3.2, sp.rarity === "legendary" ? { urgent: true } : undefined);
    }
    // the fresh pelt goes straight ON you — hood and mantle (city/pelts.js;
    // degrade-safe: no pelts module, no change).
    if (CBZ.peltOnSkin) { try { CBZ.peltOnSkin(sp, peltName); } catch (e) {} }
    // leave a "skinned" husk that fades shortly.
    a.skinT = Math.min(a.skinT, 14);
    a.skinned = true;
  }

  function removeCarcass(a) {
    const gi = animals.indexOf(a); if (gi >= 0) animals.splice(gi, 1);
    const ci = carcasses.indexOf(a); if (ci >= 0) carcasses.splice(ci, 1);
    leaveHerd(a);                                 // drop the stale member ref
    if (CBZ.sharkFinDrop) { try { CBZ.sharkFinDrop(a); } catch (e) {} }   // idempotent
    if (a.group && a.group.parent) a.group.parent.remove(a.group);
  }

  // ============================================================
  //  INTERACTION — "Skin" on a nearby carcass (the registry, no new keys).
  // ============================================================
  function registerInteractions() {
    const I = CBZ.interactions; if (!I) return;
    I.registerSource({
      id: "src-carcass", kind: "carcass", layers: ["carcass"], prio: 7, driving: false,
      find: function (px, pz, ctx, push) {
        let best = null, bd = SKIN_REACH * SKIN_REACH;
        for (let i = 0; i < carcasses.length; i++) {
          const a = carcasses[i]; if (!a.skinnable) continue;
          const dx = a.pos.x - px, dz = a.pos.z - pz, d2 = dx * dx + dz * dz;
          if (d2 < bd) { bd = d2; best = a; }
        }
        if (best) push(best, Math.sqrt(bd));
      },
    });
    I.describe && I.describe("carcass", function (a) {
      return { label: "" + (a.species ? a.species.name : "Carcass"), note: a.legendary ? "LEGENDARY pelt" : "field-dress the hide" };
    });
    I.register("carcass", {
      id: "carcass-skin", slot: "e", hold: true, prio: 20,
      label: "Skin",
      canShow: function (a) { return !!(a && a.skinnable); },
      onSelect: function (a) { skin(a); },
    });
  }

  // ============================================================
  //  THE UPDATE — wander / graze / flee / charge, aquatic bob, carcass fade.
  // ============================================================
  // VENOM — a bite from a venomous snake leaves poison that keeps draining your
  // health for a few seconds AFTER the snake is gone (ticked once/sec here).
  function applyVenom(sp) {
    const v = g._venom || (g._venom = { t: 0, acc: 0, dps: 0, name: "" });
    v.t = Math.max(v.t, sp.venom === true ? 6 : 4);   // refresh/extend
    v.dps = Math.max(v.dps, sp.venomDps || 5);
    v.name = sp.name;
    if (CBZ.city && CBZ.city.note) CBZ.city.note("VENOM · " + sp.name + " bit you! Find an antidote or ride it out.", 3.2, { urgent: true });
  }
  function venomTick(dt) {
    const v = g._venom; if (!v || v.t <= 0) return;
    v.t -= dt; v.acc += dt;
    if (v.acc >= 1) { v.acc -= 1; if (CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(v.dps, null, null, (v.name || "Venom") + " venom", false, null, false); } catch (e) {} } }
    if (v.t <= 0 && CBZ.city && CBZ.city.note) CBZ.city.note("The venom wears off.", 2);
  }

  // ============================================================
  //  THE SHARED PREDATOR SEAM (CBZ.CONFIG.WILDLIFE_PREDATOR_HUNT)
  //
  //  WHAT THIS REPLACES. This file used to carry a complete second hunting
  //  brain: a stalk/charge FSM in landLive() with its own approach, its own
  //  give-up radii and a HUNTER_CAP counter, plus a snakeTick() whose
  //  "constriction" was a damage tick and a toast describing a hold that did
  //  not exist. systems/predator.js already owned the ONE shared "something is
  //  hunting you and it commits" driver — menace gauge, fake-outs, the vanish,
  //  the dread bus, real grabs — and had proved it on the shark. Two parallel
  //  predator brains is exactly the disease CLAUDE.md's ratchet indicts ("18-25
  //  independent AI update loops, only 2 share code"), so the land brain now
  //  ticks CBZ.predatorHunt and the bespoke one survives only as the revert.
  //
  //  WHAT STAYS HERE: LOCOMOTION, and nothing else. predatorHunt decides WHERE
  //  a hunter wants to be; landWalk()/slither() decide HOW a body of that kind
  //  gets there — ground height, the biome home-fence, the clamped facing turn
  //  that makes every direction change an arc, the stalking crouch. That is the
  //  same seam wildlife_shark.js fills with swim(), and it is the whole reason
  //  the shared driver can be medium-agnostic.
  //
  //  WHAT IS DELIBERATELY NOT HERE: a species table. Every radius, speed, hold
  //  and seize style arrives from CBZ.predatorKit(a), derived from the species'
  //  own scale/spd/bite/danger numbers via ONE archetype row. A brown bear, a
  //  tiger and a gray wolf hunt completely differently because their NUMBERS
  //  differ — nothing below knows their names, and a species authored tomorrow
  //  hunts correctly with no edit to this file.
  //
  //  REVERT: CBZ.CONFIG.WILDLIFE_PREDATOR_HUNT = false restores the legacy
  //  stalk/charge FSM verbatim. The same happens automatically when
  //  systems/predator.js is not loaded at all — without predatorKit there is no
  //  bundle to pass, so huntsShared() refuses and nothing here ever runs. That
  //  is the degrade contract: adopting the block must never be able to break
  //  wildlife for a client that does not have the block.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_PREDATOR_HUNT == null) CBZ.CONFIG.WILDLIFE_PREDATOR_HUNT = true;
  function HUNT() { return !(CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_PREDATOR_HUNT === false); }

  // Does the shared grammar own this actor's aggression? Both halves matter.
  // predatorIs() is the ONE definition of "does this thing hunt you" — we do
  // NOT re-derive a danger threshold locally, because two files disagreeing
  // about who is a predator is how the duplication started. predatorKit is
  // what makes adoption two lines instead of the shark's twenty-five; without
  // it we would be hand-authoring an opts bundle, i.e. the thing we are here
  // to delete, so its absence means "stay on the legacy path".
  //
  // There is NO local widening here on purpose. This file briefly carried one
  // (a venom/constriction apparatus is a killing archetype whatever `danger`
  // the bestiary authored — the rattlesnake sits at 0.4, and without it that
  // one snake would have been stranded on a parallel bite path). predatorIs
  // now makes that test itself, ahead of its danger check, so the opinion
  // lives in exactly one place. The `danger >= 0.5` line below is only the
  // pre-predator.js fallback, never a second opinion in a loaded game.
  // ============================================================
  //  A WOUND IS A PROVOCATION (CBZ.CONFIG.WILDLIFE_FIGHT_BACK)
  //
  //  OWNER (2026-07-28): "Predators like wild boars SHOULD be attacking... I
  //  think animals aren't very good at attacking right now."
  //
  //  WHAT WAS ACTUALLY WRONG, and it was one line in cityWildlifeHit:
  //  `if (a.species.danger > 0.15) { if (!huntsShared(a)) a.state = "charge"; }`
  //  — so a wounded animal that was not already a full predator answered a
  //  bullet by poking the LEGACY charge FSM, a brain with no menace gauge, no
  //  pack, no commit ration and no wheel; and everything under 0.15 danger —
  //  which is every deer, elk, horse, zebra and cow in the game — simply ran,
  //  for ever, with a rifle round in it. The bruisers landed in the worst spot
  //  of all: a moose (danger 0.4) and a bighorn (0.2) fought back through the
  //  crude path, so they LOOKED angry and were trivially outmanoeuvred.
  //
  //  THE FIX IS A LICENCE, NOT A SECOND AGGRO SYSTEM. There is exactly one
  //  aggressive brain in this game and it is CBZ.predatorHunt. What a wound
  //  buys is TIME ON THAT BRAIN: `a._defendT` seconds during which huntsShared
  //  says yes and the animal runs the identical grammar a bear runs — provoke,
  //  square up, commit, wheel, withdraw. Nothing here decides where to walk,
  //  when to strike, how hard, or when to stop; it decides only WHO IS ALLOWED
  //  TO BE ANGRY AND FOR HOW LONG. When the clock runs out the body goes back
  //  to the ordinary prey life through CBZ.predatorBreakOff — the one primitive
  //  that hands an actor back — and the menace gauge it accumulated survives,
  //  because being shot twice in a minute should NOT reset the encounter.
  //
  //  WHO QUALIFIES is CBZ.predatorDefends, and it is arithmetic on the four
  //  numbers the bestiary already authored (style/scale/bite/danger), so a
  //  species added tomorrow defends itself with no edit here. Measured over the
  //  shipped bestiary it catches exactly the animals the owner named — wild
  //  boar, moose, bison, rhino, elephant, bighorn — plus the coyote, and
  //  refuses every deer, elk, horse, goat, rabbit and cow, which is correct:
  //  those get ONE desperate answer when they are cornered and nothing else.
  //
  //  IT BREAKS OFF HONESTLY. A defender that drops below ROUT_HP of its health
  //  ROUTS — the licence is torn up, the hunt is broken off and the animal
  //  bolts at full flee speed with a real head start, which is what makes the
  //  fight a decision instead of a fight to the death every time.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_FIGHT_BACK == null) CBZ.CONFIG.WILDLIFE_FIGHT_BACK = true;
  if (CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_ATTACK_V2 == null) CBZ.CONFIG.WILDLIFE_ATTACK_V2 = true;
  function FIGHT() { return !(CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_FIGHT_BACK === false); }
  function ATK2() { return !(CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_ATTACK_V2 === false); }

  const DEF_RAGE = 9, DEF_RAGE_RAND = 6;    // s of licence one wound buys
  // ..and ONE desperate kick, deliberately too short to buy a second. The
  // licence has to outlast a rush plus its strike animation (~0.6 s) and expire
  // inside the wheel that would otherwise re-commit (WHEEL_T 0.65-1.35 s), so a
  // cornered deer answers once and is running before the second pass exists.
  const CORNER_RAGE = 1.15, CORNER_RAGE_RAND = 0.45;
  const ROUT_HP = 0.32;                     // hp fraction under which a defender routs
  const ROUT_COOL = 22;                     // s a routed animal may not re-licence
  const CORNER_COOL = 26;                   // s between one animal's cornered kicks
  const CORNER_P = 0.30;                    // fraction of individuals with the nerve
  const CORNER_PIN = 0.4;                   // s of failing to flee that counts as trapped
  const CROWD_T = 1.1;                      // s inside personal space before a bruiser squares up
  const CROWD_COOL = 12;                    // ..and s before crowding can provoke the same one again
  const YOUNG_R2 = 26 * 26;                 // u² — a threatened calf licences its herd
  const DEFEND_CIRCLE_T = 1.15;             // s: a defender SQUARES UP, it never stalks
  const DEFEND_SALT = 0x0DEFE4;             // the nerve hash's salt

  // the raw material for CBZ.wildlifeDefenseAudit()
  const DEF = { provoked: 0, charges: 0, connects: 0, corner: 0, routs: 0, crowd: 0, young: 0 };

  // Cached per SPECIES (world-lifetime objects, and both answers re-derive a
  // style string), exactly the way classify() caches sp._bclass.
  function huntsSpecies(sp) {
    if (sp._isHunter == null) {
      sp._isHunter = CBZ.predatorIs
        ? !!CBZ.predatorIs({ species: sp })
        : ((sp.danger || 0) >= 0.5 || !!sp.venom || !!sp.constrictor);
    }
    return sp._isHunter;
  }
  function defendsSpecies(sp) {
    if (sp._isDefender == null) {
      sp._isDefender = CBZ.predatorDefends
        ? !!CBZ.predatorDefends({ species: sp })
        : ((sp.danger || 0) > 0.15);          // the pre-predator.js fallback, verbatim
    }
    return sp._isDefender;
  }
  // "may this INDIVIDUAL fight at all right now" — nothing to do with species.
  // A tamed pet never turns on its owner (that rule is absolute and is enforced
  // here as well as at the wound site), a ridden or externally-driven actor
  // belongs to another file, and an animal that has already ROUTED has made its
  // decision and does not get to change its mind for ROUT_COOL seconds.
  function defendEligible(a) {
    if (!FIGHT() || !a || a.dead || a.tamed || a.ridden || a.external) return false;
    if ((a._routT || 0) > 0) return false;
    return !!a.species;
  }
  // ..and "does this individual answer a WOUND", which additionally needs the
  // species to be capable of answering one at all.
  function canDefend(a) { return defendEligible(a) && defendsSpecies(a.species); }

  // TEMPER IS AN INDIVIDUAL FACT, NOT A DIE ROLLED EVERY SECOND. Whether a
  // particular boar squares up when you crowd it, and whether a particular deer
  // has the nerve to kick, is hashed off its own spawn anchor — so the same
  // animal is always the bold one, two players in a multiplayer world see the
  // same animal do the same thing, and a player who backs off and comes back
  // does not get a re-roll. One number per animal covers both, deliberately: a
  // bold animal is bold about everything.
  function nerve(a) {
    if (a._nerve == null) {
      a._nerve = (CBZ.hash01 && a.home) ? CBZ.hash01(a.home.x, a.home.z, DEFEND_SALT) : Math.random();
    }
    return a._nerve;
  }

  // GRANT THE LICENCE. Every trigger — a wound, a crowded personal space, a
  // threatened calf, a cornered flight — funnels through this one call, so
  // there is one place that decides an animal is fighting and one place that
  // hands it to the shared brain. `force` is the cornered animal's exemption:
  // it is the one trigger that does NOT ask whether the species can fight,
  // because "cornered prey" is precisely the case of something that cannot.
  function licenceDefend(a, kind, threat, secs, force) {
    if (!defendEligible(a)) return false;
    if (!force && !defendsSpecies(a.species)) return false;
    // A REAL PREDATOR NEEDS NO LICENCE — it owns the shared brain permanently,
    // and handing it a timer would mean that timer's expiry could break off an
    // ordinary bear's ordinary hunt. It gets the provocation and nothing else,
    // and it must not be left holding a `_defendOn` reference either (huntTick
    // picks a hunter's target for itself, and a stale pointer to a dead deer is
    // just something for the GC to trip over).
    if (!huntsSpecies(a.species)) {
      // WHO IT IS FIGHTING, sanitised to something the hunt can actually
      // target. A car, a blast or an unknown `by` resolves to the player;
      // another ANIMAL is kept, which is what lets a cornered deer kick the
      // wolf that has it instead of the man watching from the ridge (huntTick's
      // ordinary target rule prefers the player inside sense range, and for a
      // defender that rule is exactly backwards).
      a._defendOn = (threat && threat.animal && threat.pos && !threat.dead) ? threat : (CBZ.player || null);
      a._defendT = Math.max(a._defendT || 0, secs);
      a._defendKind = kind;
    }
    // A DEFENDER IS NOT A PREDATOR AND MUST NOT PICK LUNCH MID-FIGHT.
    a._feedT = 0; a._feedOn = null;
    if (CBZ.predatorProvoke) { try { CBZ.predatorProvoke(a, threat); } catch (e) {} }
    DEF.provoked++;
    return true;
  }

  // HAND THE BODY BACK. The licence has run out (or the animal has had enough)
  // — predatorBreakOff drops the hunt to cruise WITHOUT wiping menace/commits,
  // and everything below is the ordinary prey life resuming.
  function endDefence(a) {
    const kind = a._defendKind, on = a._defendOn;
    const ox = (on && on.pos) ? on.pos.x : null, oz = (on && on.pos) ? on.pos.z : null;
    a._defendT = 0; a._defendKind = null; a._defendOn = null;
    if (CBZ.predatorBreakOff) { try { CBZ.predatorBreakOff(a, 5 + Math.random() * 6); } catch (e) {} }
    a._huntSt = "cruise";
    if (a.state === "charge" || a.state === "stalk") { a.state = "wander"; a.stateT = 0; }
    a._burstT = null;
    // A CORNERED ANIMAL DOES NOT LINGER. The kick was never an attack, it was
    // the price of a gap — so the gap is spent immediately, at full flee speed,
    // straight away from whatever it just hit. Drifting back into the wander
    // here would make the whole beat read as bravado.
    if (kind === "corner") {
      const sp = a.species, cls = classify(sp);
      a.state = "flee";
      a.stateT = (cls.fleeT || 4) * 1.5;
      a.alarm = Math.max(a.alarm || 0, 7);
      a.spd = (a._spd0 || 1.4) * (cls.fleeM || 2.2) * 1.1;
      if (ox != null) a.heading = Math.atan2(a.pos.z - oz, a.pos.x - ox);
      a._pinT = 0;
    }
  }

  // THE ROUT — "flee is then a real escape, not a stroll." It is deliberately
  // NOT predatorDisengage: that walks away in character at cruise speed and
  // keeps the body, which is exactly wrong for an animal that has decided it is
  // going to die here. Break off, hand back, and hit the flee state with a real
  // head start (full class flee multiplier, a long committed timer, the alarm
  // that carries the whole herd with it).
  function routAnimal(a, fx, fz) {
    const sp = a.species, cls = classify(sp);
    endDefence(a);
    a._routT = ROUT_COOL;
    a.state = "flee";
    a.stateT = (cls.fleeT || 4) * 1.8;
    a.alarm = Math.max(a.alarm || 0, 9);
    a.spd = (a._spd0 || 1.4) * (cls.fleeM || 2.2) * 1.15;
    if (fx != null && fz != null) a.heading = Math.atan2(a.pos.z - fz, a.pos.x - fx);
    DEF.routs++;
  }

  // ---- TRIGGER 2: YOU CROWDED IT ----------------------------------------
  // A wild boar does not wait to be shot. Standing inside its personal space is
  // itself the provocation, and the animal that will not move is the one you
  // have to walk around — which is the entire difference between wildlife you
  // ignore and wildlife you respect. Only BOLD individuals do it (the top third
  // of the temper distribution) and only after a sustained second inside the
  // radius, so brushing past a herd at a run costs nothing.
  //
  // ..UNLESS THERE IS A CALF. A mother has no temper threshold and no patience:
  // if any juvenile of her own herd is inside YOUNG_R of the threat she squares
  // up immediately. `grow` is the field breed() already stamps on a newborn and
  // clears at full size, so "is this a calf" needed no new state anywhere.
  const CROWD_NERVE = 0.65;
  function youngThreatened(a, tx, tz) {
    const hr = a.herd;
    if (!hr || !hr.members) return false;
    for (let i = 0; i < hr.members.length; i++) {
      const m = hr.members[i];
      if (!m || m === a || m.dead || !m.pos) continue;
      if (m.grow == null || m.grow >= 1) continue;         // only the young
      const dx = m.pos.x - tx, dz = m.pos.z - tz;
      if (dx * dx + dz * dz < YOUNG_R2) return true;
    }
    return false;
  }
  function crowdCheck(a, dt, P, nearP) {
    if (!ATK2() || !P || !canDefend(a)) return false;
    // NEVER RE-PROVOKE SOMETHING THAT IS ALREADY COMING. Without this, standing
    // in a boar's face refreshed predatorProvoke's veto grace every second, so
    // the menace gauge could never collect its withdrawal and the encounter
    // became exactly the camping the gauge exists to forbid. A live hunt owns
    // the animal; the cooldown covers the beat after it breaks off.
    if (a._huntSt && a._huntSt !== "cruise") { a._crowdT = 0; return false; }
    if ((a._crowdCd || 0) > 0) { a._crowdCd -= dt; a._crowdT = 0; return false; }
    const sp = a.species;
    const personal = 4 + SZ(a) * 3.2;
    if (nearP > personal * personal) { a._crowdT = 0; return false; }
    // the calf sweep is O(herd) so it runs on the crowd clock, not per frame
    a._crowdT = (a._crowdT || 0) + dt;
    if (a._crowdT < CROWD_T) return false;
    a._crowdT = 0;
    if (youngThreatened(a, P.x, P.z)) {
      if (licenceDefend(a, "young", CBZ.player, DEF_RAGE + Math.random() * DEF_RAGE_RAND)) {
        a._crowdCd = CROWD_COOL; DEF.young++; return true;
      }
      return false;
    }
    if (nerve(a) < CROWD_NERVE) return false;
    if (licenceDefend(a, "crowd", CBZ.player, DEF_RAGE * 0.7 + Math.random() * DEF_RAGE_RAND)) {
      a._crowdCd = CROWD_COOL; DEF.crowd++; return true;
    }
    return false;
  }

  // ---- TRIGGER 3: IT HAS NOWHERE LEFT TO GO -----------------------------
  // PREY DIES FIGHTING WHEN CORNERED. A deer flees first, always — that is
  // honest and it stays. But a deer with a threat inside one body length and no
  // escape gets ONE answer: an antler toss or a hind-leg kick with real damage,
  // and then a hard bolt. It is rare by construction and cannot become a loop:
  //   * only the top CORNER_P of the temper distribution ever does it;
  //   * only when actually TRAPPED (landWalk kept refusing to move it — the
  //     one honest "no escape bearing" test available, and it costs nothing
  //     because landWalk already returned that boolean and nobody read it) or
  //     already badly wounded at point-blank range;
  //   * CORNER_COOL seconds before the same animal can do it again;
  //   * the licence is barely longer than one strike, so predatorHunt's own
  //     pass ration can never spend a second one.
  // It targets whatever actually has it — the wolf, not the man on the ridge.
  function corneredCheck(a, dt, P, nearP) {
    if (!ATK2() || !defendEligible(a)) return false;
    if ((a._cornerCd || 0) > 0) return false;
    const sp = a.species;
    const body = 1.6 + SZ(a) * 1.8;
    const b2 = body * body;
    let threat = null;
    const hb = a._huntedBy;
    if (hb && !hb.dead && hb.pos) {
      const hx = hb.pos.x - a.pos.x, hz = hb.pos.z - a.pos.z;
      if (hx * hx + hz * hz < b2) threat = hb;
    }
    if (!threat && P && nearP < b2) threat = CBZ.player;
    if (!threat) return false;
    const wounded = a.hp < (a.maxHp || sp.hp || 40) * 0.6;
    if (!wounded && (a._pinT || 0) < CORNER_PIN) return false;
    if (nerve(a) < 1 - CORNER_P) return false;
    a._cornerCd = CORNER_COOL;
    if (!licenceDefend(a, "corner", threat, CORNER_RAGE + Math.random() * CORNER_RAGE_RAND, true)) return false;
    // IT IS ALREADY ON TOP OF THE THING. predatorProvoke (inside licenceDefend)
    // woke the hunt; circling for a second and a half at contact range would be
    // the animal declining to defend itself, so the commit is taken now through
    // the block's own entry point rather than by hand.
    if (CBZ.predatorCommit) { try { CBZ.predatorCommit(a, threat); } catch (e) {} }
    a._pinT = 0;
    DEF.corner++;
    return true;
  }

  function huntsShared(a) {
    if (!HUNT() || !a || a.dead || a.tamed || a.ridden || a.external) return false;
    if (typeof CBZ.predatorHunt !== "function" || typeof CBZ.predatorKit !== "function") return false;
    const sp = a.species; if (!sp) return false;
    // THE LICENCE IS THE ONLY WIDENING, and it is a TIMER on a defender, never
    // a second definition of "predator": predatorIs stays the one answer to
    // "does this thing hunt you", and an animal on licence is simply borrowing
    // the same brain for as long as it is angry.
    if (FIGHT() && (a._defendT || 0) > 0) return true;
    if (CBZ.predatorIs) { try { return !!CBZ.predatorIs(a); } catch (e) { return false; } }
    return (sp.danger || 0) >= 0.5 || !!sp.venom || !!sp.constrictor;
  }

  // ---- THE LOCOMOTION SEAM (legs) ---------------------------------------
  // Shared by BOTH drivers: the wander FSM below hands it a.heading + its own
  // speed, predatorHunt hands it the heading the hunt wants. Keeping one
  // integrator is what stops a hunting bear from moving by different rules
  // than a grazing one (the bug that produces pivot-slides and moonwalking
  // only while charging, which is the hardest kind to notice in review).
  function landWalk(a, want, speed, dt) {
    const grp = a.group, sp = a.species || {};
    if (!grp || !(dt > 0)) return false;
    if (want != null) a.heading = want;
    // FACING: a.heading is only the DESIRE. The body turns toward it at a
    // clamped rate (slower for big animals, faster in a panic) and the animal
    // MOVES ALONG ITS FACING — so every direction change is an arc, never a
    // pivot-slide, a moonwalk, or a sideways glide.
    if (a.faceH == null) a.faceH = a.heading;
    let fd = a.heading - a.faceH;
    while (fd > Math.PI) fd -= 2 * Math.PI; while (fd < -Math.PI) fd += 2 * Math.PI;
    const panicTurn = a.state === "flee" || a.state === "charge";
    // A BIG ONE TURNS WORSE, and a runt turns on a sixpence. The clamp always
    // said so; it was reading the species row rather than the body it was
    // steering, so every deer in the meadow arced identically.
    const trMax = ((panicTurn ? 6.5 : 3.0) / (1 + SZ(a) * 0.3)) * dt;
    if (fd > trMax) fd = trMax; else if (fd < -trMax) fd = -trMax;
    a.faceH += fd;
    // integrate ALONG THE FACING + the home fence. A COMMITTED hunter (state
    // "charge", which predatorHunt sets for bump/rush/seize) ignores the fence
    // and follows you out of its biome; anything else arcs back inside rather
    // than emigrating. Unchanged from the pre-migration law on purpose — a
    // hunt that relaxed the fence in "stalk" too would slowly drain every
    // biome of its predators over a long session.
    let moved = false;
    if (speed > 0) {
      const nx = grp.position.x + Math.cos(a.faceH) * speed * dt;
      const nz = grp.position.z + Math.sin(a.faceH) * speed * dt;
      const reg = CBZ.cityNearestRegion && CBZ.cityNearestRegion(ARENA(), nx, nz, 40);
      const onHome = reg && (reg.biome === sp.biome) && CBZ.cityRegionHit(reg, nx, nz, 6);
      /* A STARVING PREDATOR HUNTS OUTSIDE ITS RANGE. The fence is what stops a
         biome slowly draining of its wolves over a long session, and it stays
         exactly as it was for every animal that is not both hungry AND
         committed. But an animal that is starving with something already in
         its sights follows it over the ridge — that is what starving means,
         and it is how you end up meeting a predator somewhere there is not
         supposed to be one.

         Scoped so it cannot cause the drain the fence was written to prevent:
         it needs a LIVE CLAIM (prey, or a carcass it is walking to), so the
         frame the hunt ends the fence closes again and the steer-home line
         below carries it back. No timer, nothing to leak. */
      const starvedOut = !onHome && (a._prey || a._feedOn) && DRIVE(a).hunt > 0.55;
      if (!onHome && a.state !== "charge" && !starvedOut) {
        a.heading = Math.atan2(a.home.z - grp.position.z, a.home.x - grp.position.x) + (Math.random() - 0.5) * 0.6;
      } else {
        grp.position.x = nx; grp.position.z = nz; moved = true;
      }
    }
    grp.position.y = groundY(grp.position.x, grp.position.z);
    if (a.state === "stalk") grp.position.y -= 0.09 * SZ(a);   // the crouch
    faceAnimalHeading(grp, a.faceH);
    return moved;
  }

  // ---- THE LOCOMOTION SEAM (no legs) ------------------------------------
  // A snake has no faceH and no gait: it turns instantly and the segment chain
  // sells the motion. A REARED snake is holding ground by definition, so it
  // refuses to translate — which is how the hunt's circle state reads as a
  // cobra flaring at you rather than orbiting you like a shark.
  function slither(a, want, speed, dt) {
    const grp = a.group, sp = a.species || {};
    if (!grp || !(dt > 0)) return false;
    if (want != null) a.heading = want;
    a.moving = false;
    if (speed > 0 && !a.reared) {
      const nx = grp.position.x + Math.cos(a.heading) * speed * dt;
      const nz = grp.position.z + Math.sin(a.heading) * speed * dt;
      const reg = CBZ.cityNearestRegion && CBZ.cityNearestRegion(ARENA(), nx, nz, 40);
      const onHome = reg && reg.biome === sp.biome && CBZ.cityRegionHit(reg, nx, nz, 4);
      if (onHome) { grp.position.x = nx; grp.position.z = nz; grp.position.y = groundY(nx, nz); a.moving = true; }
      else a.heading = Math.atan2(a.home.z - grp.position.z, a.home.x - grp.position.x) + (Math.random() - 0.5) * 0.6;
    }
    faceAnimalHeading(grp, a.heading);
    return a.moving;
  }

  // ---- THE OPTS BUNDLE ---------------------------------------------------
  // Built ONCE per actor and then frozen, exactly as wildlife_shark.js freezes
  // its s.opts: predatorHunt is a per-frame hot path and a fresh object here
  // would allocate once per predator per tick. predatorKit supplies the entire
  // bundle; the overrides below are the only three things it cannot know —
  // how a land body moves, where its damage belongs, and whether the pack has
  // given this animal permission to commit.
  function huntOpts(a) {
    if (a._landHunt) return a._landHunt;
    // The override object is cached SEPARATELY from the kit, because
    // predatorKit returns null while CBZ.CONFIG.PREDATOR_KIT is off (that is
    // predator.js's own one-line revert). Caching only the successful result
    // keeps us live to a runtime flip; caching the closures regardless keeps
    // the refused path from allocating three functions every single frame.
    let over = a._landHuntOver;
    if (!over) {
      const sp = a.species || {};
      const style = CBZ.creatureStyleFor ? CBZ.creatureStyleFor(sp) : "bite";
      const legless = !!a.snake;
      // A DEFENDER SQUARES UP; IT DOES NOT STALK. The circle state is the tease
      // that makes a predator frightening — four to nine seconds of a thing
      // deciding whether to take you — and it is completely wrong for an animal
      // whose entire intent is "get away from me". A boar or a bear keeps the
      // full patient orbit (they hunt, so predatorIs is true for them); a moose
      // or a bighorn on a wound licence gets ONE short square-up and then it
      // comes. That is the only number a defender disagrees with, and the
      // species' role is fixed at build so this is decided once per actor.
      const defender = !huntsSpecies(sp);
      over = a._landHuntOver = {
        move: legless
          ? function (h, wantH, speed, dt) { return slither(h, wantH, speed, dt); }
          : function (h, wantH, speed, dt) { return landWalk(h, wantH, speed, dt); },
        // DAMAGE STAYS ON THE WILDLIFE CONTACT BUS. animalStrikePlayer owns the
        // ram launch through systems/physics, the hitstop, the shake and the
        // cause string that the kill feed reads; a hunt that wrote player hp
        // itself would route around cityHurtPlayer and land nowhere the killfeed
        // can see. This fires only when the driver strikes WITHOUT a seize
        // (archetypes that do not grab, or a seize the block refused).
        onHit: function (d) {
          animalStrikePlayer(a, d, style);
          // THE VENOM SURVIVES THE MIGRATION. A viper's threat was never the
          // bite — predatorKit gives it no hold phase at all (one fast strike,
          // immediate withdrawal), so the DoT this arms is the whole payload.
          if (sp.venom) applyVenom(sp);
        },
        // PACK COORDINATION WITH ZERO NEW PLUMBING: predatorPack says who may
        // commit, and a hunter that may not simply cannot reach you —
        // predatorHunt already turns an unreachable target into rush->disengage
        // and circle->scent, which is precisely "back off and take your slot".
        canReach: function () { return a._packGate !== false; },
      };
      // set, never assigned-undefined: predatorKit shallow-copies every KEY it
      // finds, so writing `circleT: undefined` for a hunter would erase the
      // kit's own derived value and silently drop every predator in the game
      // back to the shared 4-9 s default.
      if (defender) over.circleT = DEFEND_CIRCLE_T;
    }
    // NOTE the units contract: predatorKit multiplies sp.spd by an archetype
    // constant, which is correct for AUTHORED wildlife species (spd 1.2-4.0,
    // a "how fast is this animal" hint, not a final u/s). Nothing in this file
    // stores a resolved speed on the species, so no cruiseSpeed/rushSpeed
    // override is needed — if one ever does, override rather than let the
    // multiply happen twice.
    a._landHunt = CBZ.predatorKit(a, over) || null;
    /* THE INDIVIDUAL, INTO THE SHARED BUNDLE. predatorKit derives the whole
       hunt from a.species.scale — a SPECIES constant — so without this the
       runt wolf and the monster wolf reach the same distance, bite for the
       same damage and hold you for the same seconds. Applied once, here,
       using predator.js's own published exponents, and idempotent by receipt.
       (The proper fix is two lines inside predator.js; see this file's report.
        This is the version that does not edit a file another change owns.) */
    if (TRAITS && a._landHunt) TRAITS.sizeKit(a._landHunt, a._sizeMul || 1);
    return a._landHunt;
  }

  // ============================================================
  //  THE FOOD CHAIN (CBZ.CONFIG.WILDLIFE_FOODCHAIN)
  //
  //  OWNER: "they don't eat each other or attack the human." The engine already
  //  had every piece of this and none of them were wired together: a CARNIVORE
  //  set that existed only to cap spawn budgets, a stalking FSM that reads its
  //  target STRUCTURALLY (predatorHunt asks a target for .pos and nothing else,
  //  so it never cared that the four live call sites all handed it the player),
  //  a pack coordinator, a herd panic ripple that only gunfire could trigger,
  //  and peds.js's cityScare, which takes any threat with a position. So the
  //  whole food chain is a TARGET CHOICE plus a damage sink — no second brain.
  //
  //  WHAT A PREDATOR WILL TAKE IS ARITHMETIC, NOT A TABLE. Three continuous
  //  facts already on every species decide it:
  //    * MEDIUM must match — a wolf cannot take a shark, a shark cannot take a
  //      deer, and neither needs to be told which it is.
  //    * MASS — prey up to ~1.35x the hunter's own scale. A gray wolf (0.95)
  //      reaches a whitetail and an elk and stops short of a brown bear (1.35),
  //      and nobody typed "bear" to make that true.
  //    * TROPHIC — anything at least as DANGEROUS as you is not lunch. One line,
  //      and predators stop hunting each other without a hostility matrix.
  //  Add the 46th species tomorrow and it slots into the pyramid untouched.
  //
  //  AND IT DOES NOT BECOME A SLAUGHTERHOUSE. predatorHunt's menace gauge
  //  already forces a withdrawal after every commit; on top of that a kill is
  //  followed by 20-40s of FEEDING at the carcass and then 3-5 minutes of
  //  satiation. A fed wolf is scenery, which is the point.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_FOODCHAIN == null) CBZ.CONFIG.WILDLIFE_FOODCHAIN = true;
  function CHAIN() { return !(CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_FOODCHAIN === false); }

  const PREY_RESCAN = 1.15;      // s between prey searches per hunter (they are O(n))
  const FEED_MIN = 20, FEED_RAND = 20;      // s spent at a fresh carcass
  const SAT_MIN = 180, SAT_RAND = 120;      // s of satiation after a meal
  const PREY_MASS_MAX = 1.35;    // prey may outweigh its hunter by this much
  const ALARM_EVERY = 0.6;       // s between herd-alarm sweeps from one hunter
  const NPC_HUNT_CAP = 2;        // concurrent predator-vs-person hunts, globally
  const NPC_HUNT_R = 46;         // u — how far a predator will look for a person
  // How far from the player the food chain is SIMULATED at all. Generous (it is
  // ~2.5x the widest LOD radius, so hunts are well under way before you can see
  // them and you never watch one begin), and hard, so a 10 km map cannot put a
  // hundred and seventy predators in the frame budget for a fight nobody will
  // ever witness. Beyond it the world is still a world; it is just not ticking.
  const HUNT_SIM_R2 = 900 * 900;
  let npcHunts = 0;              // recounted every tick from the live list

  // "COULD THIS SPECIES EVER HUNT?" — cached on the SPECIES the same way
  // classify() caches sp._bclass, because the LOD freeze in tick() asks it about
  // every animal in the world every frame and predatorIs() re-derives a style
  // string on each call. Species objects are world-lifetime, so this is computed
  // once per species per session, not once per animal.
  //
  //  AND IT ASKS THE RIGHT QUESTION NOW. This used to be predatorIs — "does
  //  this thing come after the player" — which is a completely different
  //  question from "would this thing hunt something down and EAT it", and
  //  answering the second with the first put HORNS ON THE MENU: a bison
  //  (danger 0.5, style `ram`) qualified, so it stalked whitetail deer across
  //  the meadow, killed one and stood over the carcass feeding for forty
  //  seconds. So did the rhino, the elephant and the wild boar. predatorEats
  //  keeps the identical continuous test and drops the three CHARGE archetypes
  //  from it; nothing about who charges the player changes.
  function predSpecies(sp) {
    if (sp._isPred == null) {
      sp._isPred = CBZ.predatorEats
        ? !!CBZ.predatorEats(sp)
        : ((sp.danger || 0) >= 0.5 || !!sp.venom || !!sp.constrictor);
    }
    return sp._isPred;
  }

  function preyOk(hunter, hsp, a) {
    if (!a || a === hunter || a.dead || a.tamed || a.ridden || a.external || a.bird) return false;
    const sp = a.species;
    if (!sp || sp === hsp) return false;                    // never its own kind
    if (!!sp.aquatic !== !!hsp.aquatic) return false;       // medium must match
    if (sp.rarity === "legendary") return false;            // unique animals are not lunch
    // MASS IS THE INDIVIDUAL'S. A runt wolf genuinely cannot take the biggest
    // elk in the herd, and the monster can — which is the food chain reading
    // the same sizes the player can see.
    if (SZ(a) > SZ(hunter) * PREY_MASS_MAX) return false;
    if ((sp.danger || 0) >= (hsp.danger || 0)) return false;
    return true;
  }

  // ---- CAN THIS ONE TAKE A PERSON? Rare, and gated on FACTS the species
  //      already carries plus the state of the world around the victim. A
  //      snake, a fox or a coyote never qualifies; a wolf, a big cat or a bear
  //      does, at night, when you are on your own.
  function manEater(a, hsp) {
    if (SZ(a) < 0.85 || (hsp.danger || 0) < 0.6) return false;
    const style = CBZ.creatureStyleFor ? CBZ.creatureStyleFor(hsp) : "bite";
    if (style !== "maul" && style !== "pounce") return false;   // teeth and mass, not venom
    const night = (CBZ.nightAmount == null ? 0 : CBZ.nightAmount);
    // night-weighted rather than night-only: a daylight attack is possible and
    // rare, which is what makes the night ones land.
    return Math.random() < 0.16 + night * 0.5;
  }
  function loneEnough(p) {
    if (!p || p.dead || p.inCar || p.ko > 0 || p.isPlayer) return false;
    if (p.kind === "cop" || p.kind === "security" || p.armed) return false;
    let near = 0;
    const list = CBZ.cityPeds;
    if (list) {
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (o === p || !o.pos || o.dead) continue;
        const dx = o.pos.x - p.pos.x, dz = o.pos.z - p.pos.z;
        if (dx * dx + dz * dz < 28 * 28 && ++near > 1) return false;   // a crowd is safety
      }
    }
    const cops = CBZ.cityCops;
    if (cops) {
      for (let i = 0; i < cops.length; i++) {
        const c = cops[i];
        if (!c || c.dead || !c.pos) continue;
        const dx = c.pos.x - p.pos.x, dz = c.pos.z - p.pos.z;
        if (dx * dx + dz * dz < 45 * 45) return false;
      }
    }
    return true;
  }

  // Runtime AI, so Math.random is sanctioned here (the determinism law binds
  // BUILD paths). Throttled per hunter: the sweep is O(animals) and there is no
  // reason a predator re-decides what it is stalking sixty times a second.
  function pickPrey(a, senseR, dt) {
    a._preyT = (a._preyT || 0) - dt;
    if (a._prey && !a._prey.dead) return a._prey;
    if (a._preyT > 0) return null;
    a._preyT = PREY_RESCAN * (0.7 + Math.random() * 0.6);
    if ((a._satT || 0) > 0) return null;
    /* A FED ANIMAL IGNORES PREY THAT SWIMS PAST. The satiation clock above is
       binary and expires; hunger is the continuous half of the same idea, and
       it is what makes "will not commit" readable — you watch a mackerel pass
       under a shark's nose and nothing happens. Below the floor it does not
       even run the O(animals) sweep, so a well-fed world is CHEAPER. */
    const hd = DRIVE(a);
    if (hd.hunt <= 0) return null;
    const hsp = a.species, hx = a.pos.x, hz = a.pos.z;
    // ..and a hungry one commits from further out.
    const R = Math.max(18, senseR * hd.sense);
    let best = null, bd = R * R;
    for (let i = 0; i < animals.length; i++) {
      const o = animals[i];
      if (!preyOk(a, hsp, o)) continue;
      const dx = o.pos.x - hx, dz = o.pos.z - hz, d2 = dx * dx + dz * dz;
      // never two hunters on one animal — that is what predatorPack is for when
      // they are a pack, and a free-for-all when they are not.
      if (d2 < bd && !(o._huntedBy && o._huntedBy !== a && !o._huntedBy.dead)) { bd = d2; best = o; }
    }
    // A PERSON IS THE RARE ONE. Only looked for when no animal prey was found
    // (a wolf with a deer in front of it does not walk past it to reach a
    // pedestrian), and only under the whole gate above.
    if (!best && !hsp.aquatic && npcHunts < NPC_HUNT_CAP && manEater(a, hsp)) {
      const list = CBZ.cityPeds;
      let bp = null, bpd = NPC_HUNT_R * NPC_HUNT_R;
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          if (!p || !p.pos || p._huntedBy) continue;
          const dx = p.pos.x - hx, dz = p.pos.z - hz, d2 = dx * dx + dz * dz;
          if (d2 < bpd && loneEnough(p)) { bpd = d2; bp = p; }
        }
      }
      best = bp;
    }
    if (best) { best._huntedBy = a; a._prey = best; }
    return best;
  }

  // ---- the PREY bundle. Same locomotion seam, different damage sink: this is
  //      the only real difference between hunting you and hunting a deer, and
  //      it is why the FSM needed no changes at all.
  function preyOpts(a) {
    if (a._preyHunt) return a._preyHunt;
    let over = a._preyHuntOver;
    if (!over) {
      const legless = !!a.snake;
      over = a._preyHuntOver = {
        move: legless
          ? function (h, wantH, speed, dt) { return slither(h, wantH, speed, dt); }
          : function (h, wantH, speed, dt) { return landWalk(h, wantH, speed, dt); },
        onHit: function (d) {
          // the DEFENCE target wins when one is live: this same bundle serves a
          // wolf hunting a deer and a deer kicking that wolf, and the two must
          // never write each other's damage.
          const v = (((a._defendT || 0) > 0 && a._defendOn && a._defendOn.animal) ? a._defendOn : null) || a._prey;
          if (!v || v.dead) return;
          if (v.animal) {
            // EVERY animal wound goes through the ONE bus, so a predator's bite
            // gets the flinch, the gore, the carcass and the pelt for free — and
            // so a lethal one produces a REAL corpse instead of a frozen prop.
            if (CBZ.cityWildlifeHit) {
              try { CBZ.cityWildlifeHit(v, { head: false, point: null, from: a.pos }, { damage: d, by: a, cause: preyCause(a) }); } catch (e) {}
            }
            return;
          }
          // A PERSON. There is no shared ped damage bus in this codebase (the
          // census counts 52 raw `.hp -=` sites and this makes 53); dogs.js's
          // dogBite is the established shape for an animal hurting somebody, so
          // this is that shape, in ONE place, with the KILL handed to
          // cityKillPed — which is what buys the human ragdoll and the killfeed.
          v.hp = (v.hp == null ? (v.maxHp || 100) : v.hp) - d;
          if (CBZ.body && CBZ.body.hit) { try { CBZ.body.hit(v, { fromX: a.pos.x, fromZ: a.pos.z, force: 6, knockdown: true }); } catch (e) {} }
          if (CBZ.cityPanicRaise) { try { CBZ.cityPanicRaise(v.pos.x, v.pos.z, 1.4); } catch (e) {} }
          if (v.hp <= 0 && CBZ.cityKillPed && !v.dead) {
            try { CBZ.cityKillPed(v, { fromX: a.pos.x, fromZ: a.pos.z, force: 7, attacker: a, byPlayer: false }, preyCause(a)); } catch (e) {}
            // A PERSON IS A MEAL TOO. The man-eater branch is already the
            // rarest thing this file does; without this the one wolf in the
            // county that took somebody stayed exactly as starving as before
            // and went straight back out looking, which is not an animal.
            mealFrom(a, v, 0.85);
          }
        },
        canReach: function (t) { return a._packGate !== false && !!t && !t.dead; },
      };
    }
    // WE MERGE THIS ONE OURSELVES, AND THE REASON IS A TRAP WORTH KNOWING:
    // predatorKit caches exactly ONE merged-overrides object per actor
    // (`actor._predOpts`) and returns that same object to every caller. Two
    // bundles on one animal — hunting YOU and hunting a deer — would therefore
    // be the SAME object, and whichever was built last would silently take over
    // the other's damage sink. That is a bear whose bite on an elk lands on the
    // player's health bar. So the kit is asked for its BASE (stable, cached,
    // never merged) and the three overrides go on top of a bundle we own.
    const base = CBZ.predatorKit ? CBZ.predatorKit(a) : null;
    if (!base) { a._preyHunt = null; return null; }
    const out = {};
    for (const k in base) out[k] = base[k];
    for (const k in over) out[k] = over[k];
    // the merge copies the kit's numbers into a FRESH object, so the size fold
    // has to happen again on this one (its own receipt keeps it to once).
    if (TRAITS) TRAITS.sizeKit(out, a._sizeMul || 1);
    a._preyHunt = out;
    return out;
  }
  function preyCause(a) {
    const n = (a.species && (a.species.name || a.species.id)) || "animal";
    return "mauled by a " + String(n).toLowerCase();
  }

  // ---- HERDS ALARM OFF PREDATORS, not just off gunfire. spookFromShot already
  //      owns "something frightening happened here" for this file; a stalking or
  //      charging hunter IS that, so prey gets the identical ripple (a.alarm is
  //      what updateHerds carries into hr.panic, and the whole herd bolts as one
  //      wall) with no second panic system anywhere.
  function alarmFromPredator(h, amt) {
    const hsp = h.species, hx = h.pos.x, hz = h.pos.z;
    /* PREY READS THE PREDATOR'S HUNGER, and this is the half of the feature
       that shows up on the animals you are ACTUALLY looking at. You rarely
       have a wolf in frame; you very often have the deer. A fed wolf drifting
       through the treeline barely lifts a head — the herd keeps grazing, and
       that is a herd that has decided it is safe. A starving one moving the
       same line empties the meadow from half again as far out and leaves the
       herd packed into a knot. Nobody is told which wolf it was. */
    const hd = DRIVE(h);
    // both coefficients are written so bold == 1 (hunger off, or an animal at
    // dead-centre hunger) reproduces the old numbers EXACTLY.
    const R = (34 + SZ(h) * 12) * (0.58 + hd.bold * 0.42);
    const R2 = R * R;
    const amtH = amt * (0.55 + hd.bold * 0.45);
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i], sp = a.species;
      if (a === h || a.dead || a.tamed || a.ridden || a.external || !sp) continue;
      if (!!sp.aquatic !== !!hsp.aquatic) continue;                  // a fish does not fear a wolf
      if ((sp.danger || 0) >= (hsp.danger || 0)) continue;          // peers do not flinch
      const dx = a.pos.x - hx, dz = a.pos.z - hz;
      if (dx * dx + dz * dz > R2) continue;
      a.alarm = Math.max(a.alarm || 0, amtH);
      /* BUNCHING. A frightened herd does not just run — it closes up, and a
         bait ball is the same instinct with more zeroes. `bunch` rides on the
         HERD (not the animal) so the whole group tightens as one, decays on
         its own in updateHerds, and is spent by the two cohesion blocks that
         already exist. A fed predator sets it to nearly nothing, so the
         difference between a fed and a starving hunter is visible in the SHAPE
         of the herd from a distance at which you cannot see either of them. */
      const hr0 = HGON() ? a.herd : null;
      if (hr0) { const b = hd.hunt; if (!(hr0.bunch > b)) hr0.bunch = b; }
      if (a.state === "wander" || a.state === "graze" || a.state === "idle") {
        a.state = "flee";
        // the QUARRY gets a shorter burst than the bystanders. It is the one
        // animal that must remain catchable, and the herd around it is the one
        // that should read as a wall going the other way.
        a.stateT = (a === h._prey ? 1.6 : ((classify(sp).fleeT || 4) + 1.5));
        a.heading = Math.atan2(dz, dx);                             // straight away from it
        a.spd = (a._spd0 || 1.4) * 2.0;
      }
    }
    // People scatter too, and they do it through peds.js's OWN decision —
    // cityScare already weighs distance, nerve and the contagious panic field
    // and answers bolt/freeze/hold. We never write a ped's state ourselves.
    if (CBZ.cityScare && CBZ.cityPeds) {
      const P = CBZ.cityPeds;
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        if (!p || p.dead || p.inCar || !p.pos) continue;
        const dx = p.pos.x - hx, dz = p.pos.z - hz;
        if (dx * dx + dz * dz > 20 * 20) continue;
        try { CBZ.cityScare(p, h); } catch (e) {}
      }
    }
  }

  // ---- FEEDING. The other half of the anti-slaughterhouse rule, and the beat
  //      that makes a kill READ as a kill: the hunter stops, works at the
  //      carcass with the maul/worry body layer predator_anim already owns (no
  //      new animation anywhere), and then it is simply not hungry for minutes.
  // hand a target back: nothing may hold a claim on prey it is not working, or
  // one abandoned stalk locks that deer out of the food chain for the session.
  function releasePrey(a) {
    const v = a._prey;
    if (v && v._huntedBy === a) v._huntedBy = null;
    a._prey = null;
  }

  /* ---- THE MEAL. ONE function, and it is the only place in the game hunger
     ever goes DOWN by eating -------------------------------------------------

     A MEAL IS AS BIG AS WHAT WAS EATEN, relative to the eater's own body: a
     wolf that takes an elk is done for the afternoon, a fox that takes a
     rabbit is hungry again within the hour, and that difference is the whole
     reason the fox is the one you keep seeing hunt.

     A CARCASS IS A FINITE THING. Each animal that eats from one takes a
     smaller share than the last (`_eaten`), so the third scavenger onto a
     kill leaves nearly as hungry as it arrived and goes back to hunting — the
     alternative is a single deer feeding the entire county.

     RECEIPTED ON THE EATER (`_ateFrom`), because there are now three separate
     paths that can report the same mouthful: killAnimal (which catches EVERY
     killer including the ones in files this change does not own — sharks,
     orcas, the seize in predator.js), the food chain's own startFeed, and
     scavenging. Without the receipt a wolf's kill would feed it twice and the
     visible half of the feature — a fed predator that will not commit — would
     switch on a second too early. */
  function mealFrom(eater, kill, share) {
    if (!TRAITS || !eater || !kill || eater === kill || eater._ateFrom === kill) return;
    eater._ateFrom = kill;
    const eaten = kill._eaten || 0;
    kill._eaten = eaten + 1;
    const bulk = SZ(kill) / Math.max(0.2, SZ(eater));
    const meal = Math.min(1.15, 0.42 + 0.75 * bulk) *
                 (share == null ? 1 : share) / (1 + eaten * 0.7);
    TRAITS.feed(eater, meal);
  }

  /* THE MEAL IS PAID ON ARRIVAL, NOT ON THE DECISION — feedTick calls
     mealFrom the frame the eater's mouth reaches the body. It matters because
     a scavenger can be sixty metres from the carcass when it sets off, and an
     animal that behaved FED for the whole walk over would be the feature
     lying to the person watching it. (A hunter's own kill is already paid by
     killAnimal, standing over the body; mealFrom's receipt keeps that to one.) */
  function startFeed(a, kill, share) {
    a._feedOn = kill;
    a._mealShare = share == null ? 1 : share;
    a._feedT = FEED_MIN + Math.random() * FEED_RAND;
    a._feedPh = 0; a._feedGore = 0.4;
    a._prey = null;
    if (kill && kill._huntedBy === a) kill._huntedBy = null;
  }

  /* ---- SCAVENGING — the free meal beats the chase --------------------------
     A starving predator that walks past a fresh carcass to go and chase a
     healthy deer is a predator nobody believes in. This is the cheapest
     believability in the whole food chain and it costs one timed scan of the
     `carcasses` list (which is a handful of entries, not the animal list).

     It is also the second visible read on hunger, and a better one than speed:
     you shoot a deer, walk away, and the thing that comes out of the treeline
     to stand over it is the animal that was hungry. A fed one never comes.

     LAND ONLY, and that is a hard constraint rather than a taste: feedTick
     walks the eater in with landWalk/slither, which put a body on the GROUND.
     A shark scavenging through this seam would beach itself. The sea's own
     scavenging belongs in wildlife_shark.js, which this change does not own. */
  const SCAV_R = 58;             // how far a starving land predator smells carrion
  const SCAV_RESCAN = 1.9;       // s between scans — carrion does not move
  const SCAV_MAX_EATERS = 3;     // a carcass this picked-over is not worth crossing to
  function pickCarcass(a, dt) {
    a._scavT = (a._scavT || 0) - dt;
    if (a._scavT > 0) return null;
    a._scavT = SCAV_RESCAN * (0.7 + Math.random() * 0.6);
    const d = DRIVE(a);
    if (d.hunt <= 0) return null;                  // a fed animal walks past carrion
    // Range is the hunger itself: a merely peckish wolf notices a kill it can
    // nearly touch, a starving one crosses the meadow for it.
    const R = SCAV_R * d.sense * (0.35 + 0.65 * d.hunt);
    const sp = a.species, ax = a.pos.x, az = a.pos.z;
    let best = null, bd = R * R;
    for (let i = 0; i < carcasses.length; i++) {
      const c = carcasses[i];
      if (!c || c === a || !c.skinnable || !c.pos || !c.species) continue;
      if (c.species === sp) continue;              // not its own kind
      if (!!c.species.aquatic !== !!sp.aquatic) continue;
      if (c._ateFrom === a || a._ateFrom === c) continue;      // already had this one
      if ((c._eaten || 0) >= SCAV_MAX_EATERS) continue;
      const dx = c.pos.x - ax, dz = c.pos.z - az, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = c; }
    }
    return best;
  }
  function endFeed(a) {
    a._feedT = 0; a._feedOn = null;
    // the binary clock stays (it is what freezes a fed predator into scenery),
    // but it is now as long as the meal was big — a small kill buys a short
    // rest, which is exactly what makes a hungry world feel busier.
    // ..centred on 0.5 so a world with the flag off gets the ORIGINAL clock and
    // not a quietly shortened one: 0.5 -> 1.0x, starving -> 0.45x, fed -> 1.55x.
    a._satT = (SAT_MIN + Math.random() * SAT_RAND) * (1 - (HUNGER(a) - 0.5) * 1.1);
    if (CBZ.predatorPose) { try { CBZ.predatorPose(a, "maul", 0, 0, 0); } catch (e) {} }
  }
  function feedTick(a, dt) {
    const kill = a._feedOn;
    const grp = a.group;
    if (!kill || !kill.group || !kill.group.parent) { endFeed(a); return false; }
    a._feedT -= dt;
    if (a._feedT <= 0) { endFeed(a); return false; }
    const dx = kill.pos.x - grp.position.x, dz = kill.pos.z - grp.position.z;
    const d = Math.hypot(dx, dz);
    const reach = 1.1 + SZ(a) * 0.9;
    a.state = "graze";                 // markers.js reads a.state: a feeding animal is not a threat
    // the SAME locomotion seam the hunt uses — a constrictor feeds too, and it
    // has no legs to walk there on.
    const walk = a.snake ? slither : landWalk;
    if (d > reach) {
      walk(a, Math.atan2(dz, dx), (a.species.spd || 1.4) * 0.85, dt);
      if (a.snake) snakeAnimate(a, dt); else gaitAnimate(a, dt);
      return true;
    }
    walk(a, Math.atan2(dz, dx), 0, dt);
    mealFrom(a, kill, a._mealShare);       // receipted: one meal, however many frames
    a._feedPh += dt * 0.55;
    if (CBZ.predatorPose) {
      // mass picks the beat exactly the way predatorKit picks a seize style —
      // the heavy ones tear with the whole body, the light ones worry at it.
      const style = (SZ(a) >= 1.15) ? "maul" : "worry";
      try { CBZ.predatorPose(a, style, a._feedPh, 0.5, dt); } catch (e) {}
    }
    if (a.snake) snakeAnimate(a, dt); else gaitAnimate(a, dt);
    a._feedGore -= dt;
    if (a._feedGore <= 0) {
      a._feedGore = 1.8 + Math.random() * 2.4;
      if (CBZ.gore) {
        try { CBZ.gore(kill.pos.x, kill.pos.y + 0.2 * SZ(kill), kill.pos.z, { amount: 0.26, player: false }); } catch (e) {}
      }
    }
    return true;
  }

  // ---- THE ONE ENTRY POINT ----------------------------------------------
  // Returns TRUE when the shared hunt owned this actor's transform this frame
  // (the same contract as CBZ.sharkBrain). "cruise" means it has not noticed
  // you, so the ordinary wander/graze FSM keeps the body and this costs one
  // cheap distance test.
  function huntTick(a, dt, P) {
    a._gaitEarly = 0;                 // cleared every frame — see the ORDER note below
    if (!huntsShared(a)) return false;
    const player = CBZ.player;
    const grp = a.group;

    // THE LICENCE CLOCK. Only a DEFENDER carries one (a predator's aggression
    // has no expiry), and when it runs out the body is handed back through the
    // one break-off primitive rather than being left in a hot hunt state that
    // the wander FSM would then fight over.
    if ((a._defendT || 0) > 0) {
      a._defendT -= dt;
      if (a._defendT <= 0) { endDefence(a); return false; }
    }

    // FEEDING OWNS THE BODY OUTRIGHT — it is not a hunt state, it is what
    // happens after one, and running the driver underneath it would have the
    // hunter walk away from the meal it just killed.
    if ((a._feedT || 0) > 0) { if (feedTick(a, dt)) return true; }

    // THE MEAL, AND IT IS DETECTED HERE FOR A REASON. The seize resolves through
    // predator.js's killVictim, which routes back through cityWildlifeHit, so by
    // the frame we see `dead` there is a real carcass on the ground. That has to
    // be noticed BEFORE anything below can drop the claim — the target-validity
    // check further down releases dead prey, and with the hand-off written after
    // it the hunter walked away from every animal it had just killed (measured:
    // 213 frames of seize, one dead deer, zero frames of feeding).
    if (a._prey && a._prey.dead) {
      // ..and only something that EATS meat feeds. A person is not carrion, and
      // neither is anything a charger happened to kill on its way past.
      if (CHAIN() && a._prey.animal && predSpecies(a.species) && (a._satT || 0) <= 0) {
        startFeed(a, a._prey);
        if (feedTick(a, dt)) return true;
      } else releasePrey(a);
    }

    /* ---- CARRION BEATS THE CHASE ------------------------------------------
       Before this hunter goes looking for something to run down, it checks
       whether somebody has already left it a meal. A hungry animal takes the
       free one every time; a fed one does not even look, so it never runs the
       scan. This is the reason the thing that walks out of the treeline to
       stand over the deer you shot and left is always a hungry one — and the
       player never gets told that, which is the entire point.

       Gated on there being no live claim, so it can never steal a hunter off
       an animal it is already in the middle of taking. */
    const hsp0 = a.species;
    if (CHAIN() && HGON() && hsp0 && !hsp0.aquatic && !a._prey && (a._feedT || 0) <= 0 &&
        (a._satT || 0) <= 0 && predSpecies(hsp0)) {
      const carrion = pickCarcass(a, dt);
      // a scavenged share is worth less than a fresh kill — somebody else's
      // work, already opened, and mealFrom divides it again per previous eater.
      if (carrion) {
        startFeed(a, carrion, 0.72);
        // the WALK is on top of the meal, not instead of it: a carcass across
        // the meadow would otherwise time out before the scavenger arrived and
        // the whole behaviour would read as an animal changing its mind.
        const cdx = carrion.pos.x - grp.position.x, cdz = carrion.pos.z - grp.position.z;
        a._feedT += Math.min(30, Math.hypot(cdx, cdz) / Math.max(0.6, (hsp0.spd || 1.4) * 0.85));
        if (feedTick(a, dt)) return true;
      }
    }

    // ---- WHOM IS THIS HUNT FOR? -------------------------------------------
    // ONE predatorHunt call per hunter per frame, ALWAYS. The FSM keeps a single
    // scratch per hunter (menace, commits, the circle clock), so calling it
    // twice in a frame with two targets would advance that clock twice and let
    // two states fight over one body. The target is therefore decided HERE, and
    // only ever while the machine is idle — once it has committed to something
    // it keeps it until the states unwind on their own.
    //   * The PLAYER always outranks lunch when he is inside sense range: this
    //     file's whole existing behaviour is the branch below, unchanged.
    //   * Otherwise a hungry predator looks for an animal it can take, and very
    //     rarely for a person on their own.
    const o0 = huntOpts(a);
    /* HUNGER INTO THE DRIVER'S WILLINGNESS. predatorHunt reads senseR / chumR
       / circleT / cruiseSpeed off this bundle every frame, so a hungry animal
       committing sooner and from further out is four number rewrites on an
       object that already exists — done only when hunger has moved a step,
       never per frame, and never an allocation. This is the seam that would
       be one line inside predator.js if this change owned that file. */
    if (TRAITS && o0) TRAITS.hungerKit(o0, a);
    let o = o0, target = player, preyMode = false;
    const senseR = (o0 && o0.senseR) || 40;
    const hdrv = DRIVE(a);
    let dpl = Infinity;
    if (P && player && !player.dead) dpl = Math.hypot(grp.position.x - P.x, grp.position.z - P.z);
    // A DEFENDER FIGHTS WHAT HURT IT. The player-outranks-everything rule below
    // is right for a hunter choosing a meal and exactly wrong for an animal
    // answering an injury: a deer being eaten by a wolf, with the player fifty
    // metres away on a ridge, would otherwise turn round and kick at the man.
    const dv = ((a._defendT || 0) > 0 && a._defendOn && !a._defendOn.dead &&
                a._defendOn !== player && a._defendOn.animal) ? a._defendOn : null;
    if (dv) {
      // NO `|| o0` FALLBACK HERE, and that is deliberate. o0's onHit is
      // animalStrikePlayer — hand it an animal target and a deer kicking a wolf
      // would land on the PLAYER's health bar from across the meadow. If the
      // prey bundle is unavailable the guard below refuses the whole hunt,
      // which is the only safe answer. (Both bundles come from the same
      // predatorKit call, so in practice they are null together.)
      target = dv; preyMode = true; o = preyOpts(a);
    } else if (!(dpl < senseR * 1.6)) {
      // a claim on prey is not forever. Drop it the moment the quarry is gone,
      // protected, or simply too far to be worth walking to — otherwise the
      // FIRST animal a predator ever noticed becomes the only one it will ever
      // hunt, and a wolf ignores the deer beside it to stare across the valley.
      const pv = a._prey;
      if (pv) {
        const pdx = pv.pos ? pv.pos.x - grp.position.x : 1e9;
        const pdz = pv.pos ? pv.pos.z - grp.position.z : 1e9;
        // ..AND IT ABANDONS A HUNT LESS READILY WHEN IT IS HUNGRY. The claim
        // radius is the one number that decides whether a stalk survives the
        // quarry getting a head start; a starving animal walks a long way for
        // a meal and a fed one shrugs at forty metres.
        const claimR = senseR * 2.2 * hdrv.bold;
        if (pv.dead || pv.inCar || pv.tamed || pv.ridden ||
            (pdx * pdx + pdz * pdz) > claimR * claimR) releasePrey(a);
      }
      const st0 = a._huntSt;
      // never re-pick mid-grab: the seize already owns this animal's mouth, and
      // never at all for something that does not EAT meat (a charging bison is
      // not shopping) or for a defender working off a wound licence.
      if (CHAIN() && !a._seizing && predSpecies(a.species) && !(a._defendT > 0) &&
          (!st0 || st0 === "cruise" || st0 === "disengage")) pickPrey(a, senseR, dt);
      if (a._prey && !a._prey.dead) { target = a._prey; preyMode = true; o = preyOpts(a); }
      else if (dpl === Infinity) { releasePrey(a); a._huntSt = "cruise"; return false; }
    } else if (a._prey && !a._seizing) releasePrey(a);   // you walked in: the deer can wait
    if (!o || !target || (target === player && (!player || player.dead))) { a._huntSt = "cruise"; return false; }

    // THE CAP, DELEGATED. This file used to own HUNTER_CAP = 3 and a `hunters`
    // counter recounted every tick — a second, independently invented answer
    // to "how many things may be after you at once", sitting next to a block
    // that already answers it with a menace gauge. predatorPack answers it
    // properly: at most one hunter near you may rush or seize, and the rest
    // are handed their own bearing slot, so a wolf pack SURROUNDS you and
    // takes turns instead of queueing behind a global integer. The counter is
    // gone and this is the whole of what replaced it.
    let gate = "commit";
    if (CBZ.predatorPack) {
      try { gate = CBZ.predatorPack(a, target, dt) || "commit"; } catch (e) { gate = "commit"; }
      a._packGate = (gate === "commit");
    } else a._packGate = true;

    const prev = a._huntSt;
    // A REARED snake HOLDS GROUND (slither refuses to translate while it is
    // up), so the flare must be decided BEFORE the driver moves the body, off
    // last frame's state. Deciding it afterwards — the obvious way round — is
    // a no-op: snakeTick clears a.reared at the top of every frame, so the
    // rear would flicker for one frame and never once stop the snake. a.rear
    // is a rig fact (how many segments lift), so which snakes can flare comes
    // from the model, never from a species name.
    if (a.snake) a.reared = !!a.rear && (prev === "circle" || prev === "bump");

    // ORDER MATTERS, AND ONLY MID-SWING. systems/predator_anim.js composes the
    // strike pose as an OFFSET on top of the gait's ABSOLUTE leg writes
    // (`m.position.x = pt.bx + s`), and the strike is driven from INSIDE
    // predatorHunt (creature_combat's animateAttack). So while a swing is in
    // flight the gait has to run FIRST or it stomps the pose for as long as
    // its weight takes to decay (~0.3s) — a bear that attacks the instant it
    // stops running shows its legs late.
    //
    // It is deliberately NOT an unconditional reorder, which is what the
    // straight swap would have been. Two things are entangled with it: the
    // gait's VERTICAL flourish (the body bob, and the pack bound) is added to
    // grp.position.y and landWalk clamps y to the ground on every move, so
    // gait-always-first silently kills the bound on a charging wolf; and the
    // hunt can return "cruise", after which landLive runs its own gait — two
    // gaitAnimate calls in one frame reads a zero position delta and collapses
    // the stride. Gating on a live swing avoids both: the animal is stationary
    // mid-strike so there is no flourish to lose, and this path never falls
    // through to the wander FSM. Cost is one frame of lag on the first strike
    // frame only.
    // a._gaitEarly is the receipt: if the driver then hands the actor back
    // (st === "cruise"), landLive must NOT gait it a second time in the same
    // frame — the second call reads a zero position delta and collapses the
    // stride. One gaitAnimate per actor per frame, always.
    const striking = (a._atkAnim != null && a._atkAnim >= 0);
    if (striking && !a.snake) { gaitAnimate(a, dt); a._gaitEarly = 1; }

    let st = "cruise";
    try { st = CBZ.predatorHunt(a, target, dt, o) || "cruise"; } catch (e) { st = "cruise"; }
    a._huntSt = st;
    // every entry into `rush` is one committed charge — the raw material for
    // wildlifeDefenseAudit's proof that provocation reaches an actual attack.
    if (st === "rush" && prev !== "rush") DEF.charges++;
    if (preyMode) {
      // THE HERD SEES IT COMING. Only while the hunter is actually working the
      // target — a cruising wolf is part of the scenery and must not stampede
      // the meadow it lives in. Throttled, because the sweep is O(animals).
      // ON THE TELL, NOT ON A TIMER. A repeating sweep looks obviously right and
      // is the one thing that makes the food chain impossible: `a.alarm` decays
      // at 1/s, so re-raising it to 4.5 twice a second PINS every deer in the
      // meadow into permanent flight — and prey in permanent flight at
      // spd x fleeM is faster than a hunter's cruise, so the stalk can never
      // close and nothing is ever caught (measured: 20,000 frames, zero kills).
      // Firing on the STATE CHANGE instead gives a pulse per beat of the hunt,
      // with the alarm decaying between them: the herd bolts, settles, watches,
      // and bolts again — which is both what real prey does and what leaves the
      // hunter a window to actually take one.
      if (st !== prev && (st === "circle" || st === "bump" || st === "rush" || st === "seize")) {
        alarmFromPredator(a, st === "rush" || st === "seize" ? 4.5 : 2.4);
      }
    }
    if (st === "cruise") {
      a.reared = false;
      // AN AMBUSHER IN COVER IS NOT IDLE. predatorKit turns `ambush` on for the
      // whole pounce archetype, and an ambusher spends its ENTIRE pre-commit
      // life in cruise — that IS the design: it holds absolutely still until
      // you walk inside half its sense radius. Handing it back to the wander
      // here would stroll a tiger across the clearing in full view, breaking
      // the one archetype whose whole identity is "you never saw it". So when
      // the driver says it is deliberately motionless we OWN the actor and
      // move nothing.
      let still = false;
      if (CBZ.predatorStill) { try { still = !!CBZ.predatorStill(a); } catch (e) { still = false; } }

      // A FLANKER IS NOT AN ANIMAL THAT LOST INTEREST. predatorPack gates a
      // non-committer by making its target unreachable, and predatorHunt does
      // not merely pause on that — it unwinds circle -> scent -> cruise. So
      // without this the pack fiction inverted itself: one wolf commits and the
      // other three WALK AWAY AND GRAZE while it eats you. They must keep
      // working the ring at their assigned bearing (predatorPack has already
      // written a.orbitDir toward their slot) until the token frees up.
      // (the ring is walked around whatever this hunt is ABOUT, which since the
      //  food chain is not always the player — a flanking wolf must circle the
      //  elk, not the man watching from the ridge.)
      const tp = preyMode ? target.pos : P;
      if (!still && gate !== "commit" && !a.snake && tp) {
        const dxp = tp.x - grp.position.x, dzp = tp.z - grp.position.z;
        const dp = Math.hypot(dxp, dzp);
        const oR = (o.orbitR || 14);
        if (dp < oR * 3.2) {
          const dir = (a._hunt && a._hunt.orbitDir) || 1;
          const err = Math.max(-1, Math.min(1, (dp - oR) / Math.max(1, oR)));
          const want = Math.atan2(dzp, dxp) + dir * (Math.PI * 0.5) * (1 - err * 0.8);
          landWalk(a, want, (o.cruiseSpeed || 2) * 1.05, dt);
          a.state = "stalk";               // markers.js keeps the threat lit
          gaitAnimate(a, dt);
          return true;
        }
      }
      if (!still) return false;                  // ordinary un-noticed animal: the caller wanders it
      // Owning it means everything the wander would have done for a STATIONARY
      // animal is now ours, or it floats off the terrain / freezes mid-stride.
      // gaitAnimate's own zero-movement case is exactly the idle pose we want
      // (it reads distance moved, so with none it eases the legs to rest).
      if (a.snake) { snakeAnimate(a, dt); return true; }
      grp.position.y = groundY(grp.position.x, grp.position.z);
      faceAnimalHeading(grp, a.faceH == null ? a.heading : a.faceH);
      gaitAnimate(a, dt);
      return true;
    }

    // MARKERS FOR FREE, AND THE ONE THING THEY MUST NOT DO: systems/markers.js
    // lights the HUD/minimap straight off a.state, which predatorHunt sets. It
    // must not keep the blip lit while the hunter has broken off — losing the
    // marker IS the scare (wildlife_shark.js does exactly this).
    if (st === "vanish" || st === "disengage") a.state = "wander";

    if (a.snake) {
      // The head lunge is the snake's entire tell, and it has to fire on the
      // frame the hunt COMMITS, not on contact — by contact there is nothing
      // left to read.
      if (st === "rush" && prev !== "rush") a.strikeAnim = 1;
      snakeAnimate(a, dt);
    } else {
      // the Minecraft read: hunting eyes glow red. predatorHunt has just
      // written a.state, so this is the same frame, not one behind — and a
      // STARVING predator's are lit before it has picked anything, which is
      // the one hunger cue that carries at night and across water.
      setAggroEyes(a, eyeMode(a));
      // settle any leftover strike pitch between swings, or a bear that
      // swung once keeps its nose in the dirt for the rest of the encounter.
      if (grp.rotation.x !== 0 && (a._atkAnim == null || a._atkAnim < 0)) grp.rotation.x *= Math.max(0, 1 - dt * 6);
      if (!striking) gaitAnimate(a, dt);      // else it already ran, before the pose
    }
    return true;
  }

  // ============================================================
  //  SNAKES — no legs, so they SLITHER: a travelling sine wave runs down the
  //  body-segment chain each frame. Cobras REAR + flare a hood as a warning,
  //  vipers/mambas STRIKE (a head lunge) to deliver a venom bite, and the
  //  anaconda CONSTRICTS on contact. All allocation-free, reading the cached
  //  segment refs (a.segs / a.hood / a.rattle) the build() registered.
  // ============================================================
  function snakeAnimate(a, dt) {
    const segs = a.segs; if (!segs || !segs.length) return;
    const striking = a.strikeAnim > 0;
    const waveSpd = a.state === "flee" ? 12 : (a.reared ? 2.5 : 5.5);
    a.phase += dt * waveSpd;
    const amp = a.reared ? 0.05 : 0.17 * (a.moving ? 1 : 0.35);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]; if (!s) continue;
      // base: laid out behind the head along local −X; head (i=0) lunges on a strike
      s.position.x = -i * a.spacing + (striking && i < 3 ? (3 - i) * a.spacing * 1.0 * a.strikeAnim : 0);
      s.position.z = Math.sin(a.phase - i * 0.7) * amp * Math.min(1, i / 2 + 0.35);
      s.position.y = (a.reared && i < a.rear) ? a.baseY + (a.rear - i) * a.spacing * 0.85 : a.baseY;
    }
    if (a.strikeAnim > 0) a.strikeAnim = Math.max(0, a.strikeAnim - dt * 4);
    if (a.hood) { const f = a.reared ? 1 : 0.12; for (let h = 0; h < a.hood.length; h++) if (a.hood[h]) a.hood[h].scale.setScalar(f); }
    if (a.rattle && (a.reared || a.alarm > 0.1)) a.rattle.rotation.y = Math.sin(a.phase * 3.5) * 0.6;
  }

  function snakeTick(a, dt, P) {
    const sp = a.species, grp = a.group;
    if (grp.visible === false) return;                 // far snakes idle — no sim
    if (a.alarm > 0) a.alarm -= dt;
    if (a.strikeT > 0) a.strikeT -= dt;
    if (a.grabT > 0) a.grabT -= dt;
    a.reared = false; a.moving = false;
    // THE SHARED PREDATOR BRAIN owns every venomous/constricting snake now.
    // What it buys: the anaconda's coil is a REAL CBZ.predatorSeize with the
    // "constrict" style (tightening pulses, damage in rising steps, a genuine
    // escape window) instead of what used to be here — one damage tick, a 0.9s
    // cooldown, and a toast that told the player to "thrash free" of a hold
    // the game never actually had. That toast is gone with the fiction it
    // described. The viper keeps its venom (huntOpts' onHit arms applyVenom)
    // and gains the approach it never had. See huntTick above.
    if (huntTick(a, dt, P)) return;
    let spd = 0, nearP = Infinity, towardP = a.heading;
    if (P) { const dx = P.x - grp.position.x, dz = P.z - grp.position.z; nearP = dx * dx + dz * dz; towardP = Math.atan2(dz, dx); }
    const senseR = Math.max(sp.spook || 0, 11);
    const strikeR = sp.constrictor ? 2.5 : 2.9;
    const shared = huntsShared(a);

    if (P && nearP < senseR * senseR) {
      if (shared) {
        // The hunt HAS this snake but is not engaged (it has not sensed you
        // yet, or it is inside predatorHunt's post-commit cooldown). It must
        // not run the legacy strike underneath the driver — that would be the
        // two brains fighting. It watches you instead: alert, coiled, still.
        a.reared = !!a.rear; a.heading = towardP; a.alarm = Math.max(a.alarm, 2);
      } else if (sp.constrictor) {
        // LEGACY (predator.js absent, or WILDLIFE_PREDATOR_HUNT off) — close
        // the gap, then a bare contact tick on the grabT cooldown.
        if (nearP < strikeR * strikeR) {
          if (a.grabT <= 0) { animalStrikePlayer(a, sp.bite || 20, "constrict"); a.grabT = 0.9; }
        } else { a.heading = towardP; spd = (a._spd0 || 1.4) * 1.6; a.moving = true; a.state = "hunt"; }
      } else if (sp.venom || sp.danger >= 0.4) {
        // VIPER / COBRA / MAMBA — warn, then STRIKE (venom on the bite).
        if (nearP < strikeR * strikeR) {
          a.reared = !!a.rear; a.heading = towardP;
          if (a.strikeT <= 0) {
            a.strikeAnim = 1; a.strikeT = 1.6;
            animalStrikePlayer(a, sp.bite || 12, "strike");
            if (sp.venom) applyVenom(sp);
          }
        } else if ((sp.spd || 0) >= 3 && nearP > (strikeR + 3) * (strikeR + 3)) {
          a.state = "flee"; a.heading = towardP + Math.PI; spd = (a._spd0 || 3) * 1.4; a.moving = true;   // mamba bolts
        } else { a.reared = !!a.rear; a.heading = towardP; a.alarm = Math.max(a.alarm, 2); }             // rear & hold ground
      } else {
        a.state = "flee"; a.heading = towardP + Math.PI + (Math.random() - 0.5) * 0.6; spd = (a._spd0 || 1.4) * 1.8; a.moving = true;  // garter flees
      }
    } else {
      // wander: a slow, near-constant slither with the odd pause + turn
      a.state = "wander";
      a.turnT -= dt;
      if (a.turnT <= 0) { a.heading += (Math.random() - 0.5) * 1.2; a.turnT = 3 + Math.random() * 4; }
      spd = (a._spd0 || 1.4) * 0.6 * DRIVE(a).spd; a.moving = true;
    }

    // ONE integrator, shared with the hunt (predatorHunt drives this exact
    // function through opts.move) — so a slithering snake and a hunting one
    // obey the same home fence and the same ground clamp.
    slither(a, a.heading, spd, dt);
    snakeAnimate(a, dt);
  }

  // ============================================================
  //  THE LIVING STATE MACHINE (CBZ.CONFIG.WILDLIFE_LIVE) — graze / wander /
  //  flee / stalk / charge, with flinch as an overlay and dying animated in
  //  the dead branch. The legacy block further down is untouched and runs
  //  verbatim when the flag is off.
  // ============================================================
  // NOTE: there used to be a HUNTER_CAP = 3 and a `hunters` counter here — a
  // global cap on simultaneous hunters, recounted every tick. It is gone:
  // CBZ.predatorPack (systems/predator.js) owns that question for every
  // predator in the game now, and holding a second answer to it in this file
  // is the exact duplication this migration deletes. See huntTick().
  const SHOT = { win: 0, n: 0 };   // repeated-gunshot tracker (0.9s window)
  // reusable player-as-target for creature_combat (allocation-free hot path;
  // hp is a decoy — damage lands through opts.onHit, never on this object).
  const PT = { pos: null, group: { position: null }, dead: false, hp: 1e9 };

  function landLive(a, dt, P) {
    const sp = a.species, grp = a.group, cls = classify(sp);
    // the Minecraft read: hunting eyes glow red (BEFORE the flinch return, so
    // a shot wolf lights up on the very frame it turns on you).
    setAggroEyes(a, eyeMode(a));
    // hit recoil owns the transform while it lasts; the state resumes after.
    if ((a._flinchT || 0) > 0) { if (CBZ.creatureAnimateFlinch) CBZ.creatureAnimateFlinch(a, dt); return; }
    if (a.alarm > 0) a.alarm -= dt;
    // THE SHARED PREDATOR BRAIN gets first refusal on every hunter. When it is
    // engaged it owns the transform for the frame (stalk / circle / bump /
    // vanish / rush / seize / disengage, plus the gait) and the FSM below is
    // simply not reached; when it returns false the animal has not noticed you
    // and the ordinary graze/wander life runs exactly as before.
    if (huntTick(a, dt, P)) return;
    const shared = huntsShared(a);
    // SAFETY NET: reaching here with the hunt un-engaged means the driver is
    // cruising, so nothing may leave a migrated hunter parked in a hot legacy
    // state. If some other system pokes one in (a wound, a blast, a herd
    // ripple), drop it back to wander and let the driver decide — the legacy
    // charge FSM running under a cruising driver is the one failure mode of
    // this migration that stays invisible until you watch the animal move.
    if (shared && (a.state === "charge" || a.state === "stalk")) { a.state = "wander"; a.stateT = 0; a._burstT = null; }
    // (the ambush hold lives in huntTick, which owns the actor outright while
    //  predatorStill is true — one answer, and it covers snakes too.)
    a.stateT = (a.stateT || 0) - dt;
    a.turnT -= dt;
    const hr = a.herd, danger = sp.danger || 0;
    let nearP = Infinity, dpx = 0, dpz = 0;
    if (P) { dpx = grp.position.x - P.x; dpz = grp.position.z - P.z; nearP = dpx * dpx + dpz * dpz; }
    const playerGone = !P || (CBZ.player && CBZ.player.dead);

    // HERD PANIC RIPPLE — one spooked member carries the whole herd.
    if (hr && hr.panic > 0.3 && (a.state === "wander" || a.state === "graze" || a.state === "idle") && a.alarm <= 0.1) {
      a.alarm = Math.max(a.alarm, hr.panic * 0.85);
      // A migrated hunter never has "charge" written from out here: predatorHunt
      // owns its stalk/charge markers and a state poked in behind its back
      // desyncs its FSM (the driver would keep cruising while markers.js lit
      // the HUD). The panic still reaches it as alarm, and its own sense radius
      // decides what to do about you. Herd PREY stampedes exactly as before.
      if (danger >= 0.5) { if (!shared) a.state = "charge"; }
      else { a.state = "flee"; a.stateT = cls.fleeT; a.heading = hr.heading; }   // flee WITH the herd
    }

    // SENSES — calm animals notice you: prey bolts. Hunters are NOT here any
    // more; predatorHunt's own sense/chum radii woke them at the top of this
    // function, and the "hunters < HUNTER_CAP" throttle that used to gate this
    // branch is predatorPack's job now. The predator branch below is the
    // degrade path only (no predator.js, or the flag off).
    // TRIGGER 2 (see crowdCheck): crowding a bruiser IS the provocation. Tested
    // before the flee sense below, because for these animals "you are too close"
    // resolves to squaring up, not to bolting — and it is skipped outright for
    // anything the shared brain already owns.
    if (!playerGone && !shared && crowdCheck(a, dt, P, nearP)) return;

    if (!playerGone && (a.state === "wander" || a.state === "graze" || a.state === "idle")) {
      /* HUNGER BUYS NERVE. A well-fed deer has nothing to gain by standing its
         ground and bolts at forty metres; a starving one lets you get close
         because the meadow it is eating is worth the risk. Same scalar, other
         direction, as the predator's willingness to commit — and it is why
         the animals you can actually walk up to are the hungry ones. */
      const spookR = (sp.spook || 26) * (2 - DRIVE(a).bold);
      // `!shared` is new and it matters: an animal on a wound licence sits in a
      // post-commit cooldown for several seconds at a time, during which
      // predatorHunt returns cruise and this branch would flip it to flee — a
      // moose that gores you and then trots off mid-fight, twice.
      if (danger < 0.5 && !shared && nearP < spookR * spookR) {
        a.state = "flee"; a.stateT = cls.fleeT; a.alarm = Math.max(a.alarm, 4);
        a.heading = Math.atan2(dpz, dpx);                       // away from you
      } else if (danger >= 0.5 && !shared) {
        const trig = (sp._stalk && sp._stalk.trig) || cls.stalk;
        if (nearP < sq(cls.aggro || 16)) { a.state = "charge"; a.alarm = 6; }
        else if (trig && nearP < sq(trig) && grp.visible !== false) { a.state = "stalk"; }
      }
    }

    // ---- per-state steering ---------------------------------------------
    let spd = 0;
    if (a.state === "graze") {
      if (a.stateT <= 0) { a.state = "wander"; a.stateT = 2 + Math.random() * 3; }
    } else if (a.state === "idle") {
      // A real pause: feet and gait settle while the body can make one small,
      // gradual look-turn. Threat sensing above still interrupts instantly.
      if (!a._idleTurned && a.stateT > 0) {
        a._idleTurned = true;
        a.heading += (Math.random() - 0.5) * 0.7;
      }
      if (a.stateT <= 0) { a._idleTurned = false; a.state = "wander"; a.stateT = 1.5 + Math.random() * 2.5; }
    } else if (a.state === "flee") {
      spd = (a._spd0 || 1.4) * cls.fleeM;
      // TRIGGER 3 (see corneredCheck): nowhere left to run. The one frame where
      // prey stops being prey.
      if (corneredCheck(a, dt, P, nearP)) return;
      if (!playerGone && nearP < sq((sp.spook || 26) * 1.2)) {   // still on your heels — keep running
        a.heading = Math.atan2(dpz, dpx);
        a.stateT = Math.max(a.stateT, 1.5);
      }
      if (a.stateT <= 0 && a.alarm <= 0 && (playerGone || nearP > sq((sp.spook || 26) * 1.6))) {
        a.state = "wander"; a.stateT = 2 + Math.random() * 3;
      }
    } else if (a.state === "stalk") {
      const st = sp._stalk || cls;
      if (playerGone || nearP > sq((st.trig || cls.stalk || 55) * 1.25)) { a.state = "wander"; a.stateT = 2; }
      else if (nearP < sq(st.burst || cls.burst || 18)) { a.state = "charge"; a.alarm = 6; a._burstT = st.burstT || 3.5; }
      else {
        spd = (a._spd0 || 1.4) * (cls.crouch || 0.35);
        a.heading = Math.atan2(-dpz, -dpx);   // the faceH turn clamp below arcs it in
      }
    } else if (a.state === "charge") {
      const giveUp = (sp._stalk && sp._stalk.giveUp) || cls.giveUp || 55;
      if (a._burstT != null) {
        a._burstT -= dt;
        if (a._burstT <= 0 && nearP > sq(cls.aggro || 12)) {     // the sprint died — short-winded cat rests
          a._burstT = null; a.state = "graze"; a.stateT = 3;
        }
      }
      if (a.state === "charge") {
        if (playerGone || nearP > sq(giveUp)) { a.state = "wander"; a.stateT = 2; a._burstT = null; }
        else {
          const reach = 1.6 + SZ(a) + 0.5;
          const engaged = a._atkAnim != null && a._atkAnim >= 0;  // mid-strike: let it finish
          if ((nearP <= sq(reach * 1.6) || engaged) && CBZ.creatureFight) {
            // hand the last stretch + the strike to creature_combat: it
            // closes, choreographs the pounce/maul/gore/stomp, and lands the
            // bite through onHit (the decoy target's hp is never real).
            PT.pos = P; PT.group.position = P; PT.dead = false; PT.hp = 1e9;
            let o = a._atkOpts;
            if (!o) {
              const style = CBZ.creatureStyleFor ? CBZ.creatureStyleFor(sp) : null;
              o = a._atkOpts = {
                // dmg/rate/speed are the INDIVIDUAL's: a monster hits hard and
                // slow, a runt hits fast and light, off the same exponents
                // predator.js publishes for the shared kit.
                reach: reach, rate: 1.1 * Math.sqrt(SZ(a) / ((sp.scale || 1) || 1)),
                dmg: Math.max(1, Math.round((sp.bite || 12) * Math.pow(SZ(a) / ((sp.scale || 1) || 1), 1.35))),
                speed: (a._spd0 || 1.4) * (cls.atkM || 2.0),
                style: style,
                onHit: function (d2) { animalStrikePlayer(a, d2, style); },
              };
              if (style === "ram") { o.rate = 1.45; o.speed *= 1.12; }
              else if (style === "gore" || style === "stomp") o.rate = 1.3;   // heavy hitters swing slower
              if (sp.id === "cheetah") o.rate = 0.9;
            }
            // SAME ORDERING LAW as the migrated path (see huntTick): the gait
            // runs BEFORE the strike, because systems/predator_anim.js's pose
            // composes as an offset on top of the gait's absolute leg writes.
            // This branch used to return without ticking the gait at all, so
            // the legs simply froze mid-stride for the whole attack; running
            // it here settles them AND leaves the pose layer last.
            gaitAnimate(a, dt);
            CBZ.creatureFight(a, PT, dt, o);
            a.faceH = a.heading;                       // it steers facing itself — stay in sync
            return;                                    // creatureFight owns the transform this frame
          }
          spd = (a._spd0 || 1.4) * (cls.atkM || 2.0) * (a._burstT != null ? 1.2 : 1);
          a.heading = Math.atan2(-dpz, -dpx);
          // fallback contact strike if creature_combat isn't around.
          if (!CBZ.creatureFight && nearP < 3.2 * 3.2 && CBZ.cityHurtPlayer && (a._biteT || 0) <= 0) {
            const style = CBZ.creatureStyleFor ? CBZ.creatureStyleFor(sp) : null;
            animalStrikePlayer(a, sp.bite || 10, style);
            a._biteT = 1.1;
          }
          if (a._biteT > 0) a._biteT -= dt;
        }
      }
    }
    if (a.state === "wander") {
      spd = a.spd;
      if (a.stateT <= 0) {
        /* HUNGER, IN THE PATHING. This is where "you can SEE it" is either
           true or it is a claim: a starving animal barely stops, re-aims often
           and covers ground; a fed one stands about, turns lazily and drifts.
           `hd` is the shared behaviour scratch (wildlife_traits.js) — one
           cached object per actor, re-derived only when hunger has moved ~2%.

           A HERBIVORE EATS BY GRAZING, so hunger PUSHES the head down and the
           idle away: a hungry deer grazes MORE and loiters LESS, and grazing
           is what feeds it back down again. A predator grazes at a carcass
           instead, so its graze roll simply falls with hunger like its idle. */
        const hd = DRIVE(a);
        const eats = predSpecies(sp);
        const grazeP = Math.min(0.9, cls.grazeP * (eats ? hd.loiter : (2 - hd.loiter)));
        const idleP = Math.min(0.98, grazeP + 0.18 * hd.loiter);
        const stopRoll = Math.random();
        if (stopRoll < grazeP && (!hr || hr.panic <= 0.3) && a.alarm <= 0) {
          a.state = "graze";                           // stop & put the head down
          a.stateT = (cls.grazeT[0] + Math.random() * (cls.grazeT[1] - cls.grazeT[0])) *
                     (eats ? hd.loiter : 1);
          spd = 0;
        } else if (stopRoll < idleP && (!hr || hr.panic <= 0.3) && a.alarm <= 0) {
          a.state = "idle";                            // stand, listen, turn, then continue
          a.stateT = (1.4 + Math.random() * 3.2) * hd.loiter;
          a._idleTurned = false;
          spd = 0;
        } else {
          // RESTLESS. A hungry animal re-aims twice as often and swings its
          // heading further, which is a bigger effective wander radius without
          // a second radius anywhere: the home fence in landWalk is unchanged.
          a.stateT = (2 + Math.random() * 4) / hd.restless;
          a.heading += (hr && hr.n > 1 ? 0.3 : 1.5) * (Math.random() - 0.5) * hd.restless;
          a.spd = (a._spd0 || 1.4) * cls.wanderM * (0.7 + Math.random() * 0.6) * hd.spd;
          spd = a.spd;
        }
      }
    }

    // HERD MOVEMENT (boids — same math as the legacy block): alignment +
    // cohesion + separation; a panicked herd aligns harder and moves as one.
    if ((a.state === "wander" || a.state === "flee") && hr && hr.n > 1 && spd > 0) {
      let dx = Math.cos(a.heading), dz = Math.sin(a.heading);
      const align = (a.state === "wander") ? 0.5 : 1.4;
      dx += Math.cos(hr.heading) * align; dz += Math.sin(hr.heading) * align;
      const toCx = hr.cx - grp.position.x, toCz = hr.cz - grp.position.z;
      const cd = Math.hypot(toCx, toCz) || 1;
      /* BUNCHING, SPENT. A hungry predator in range does two things to the
         shape of a herd and both are the same number: it pulls the cohesion up
         (they crowd the centre, and from further out — the -5 slack that lets
         a calm herd spread is what shrinks) and it pushes the personal-space
         radius down (they will tolerate standing shoulder to shoulder). A
         watcher on a hill sees a loose scatter of deer become a knot. */
      const bn = hr.bunch || 0;
      const coh = Math.min(1.1 + bn * 0.9, Math.max(0, cd - 5 * (1 - bn * 0.8)) / (14 - bn * 7)) *
                  (a.state === "wander" ? 1 : 1.6);
      dx += (toCx / cd) * coh; dz += (toCz / cd) * coh;
      const sepR = (2.2 + SZ(a) * 1.0) * (1 - bn * 0.45);
      let sx = 0, szz = 0;
      for (let m = 0; m < hr.members.length; m++) {
        const o2 = hr.members[m]; if (o2 === a || o2.dead) continue;
        const ox = grp.position.x - o2.pos.x, oz = grp.position.z - o2.pos.z;
        const od = Math.hypot(ox, oz);
        if (od > 0.001 && od < sepR) { sx += (ox / od) * (sepR - od); szz += (oz / od) * (sepR - od); }
      }
      dx += sx * 0.9; dz += szz * 0.9;
      const desired = Math.atan2(dz, dx);
      let dd = desired - a.heading;
      while (dd > Math.PI) dd -= 2 * Math.PI; while (dd < -Math.PI) dd += 2 * Math.PI;
      a.heading += dd * Math.min(1, dt * (a.state === "wander" ? 2.2 : 5.0));
    }

    // ---- FACING + INTEGRATION + the home fence + ground + the crouch: ONE
    //      shared integrator (landWalk, above), which predatorHunt also drives
    //      through opts.move. A grazing bear and a hunting bear must move by
    //      the same rules, or the pivot-slide bugs come back in exactly the
    //      state nobody reviews.
    const fled = landWalk(a, a.heading, spd, dt);
    // "NO ESCAPE BEARING", measured rather than guessed. landWalk has always
    // returned whether it actually MOVED the body (false = the home fence or a
    // refused step turned it back instead) and nothing has ever read that
    // boolean. An animal that is trying to flee at speed and is not getting
    // anywhere is, by the only definition available to this file, trapped —
    // and that is what arms corneredCheck. It bleeds off at twice the rate it
    // fills, so one blocked frame at a fence never counts as being cornered.
    if (a.state === "flee" && spd > 0.1 && !fled) a._pinT = (a._pinT || 0) + dt;
    else if (a._pinT > 0) a._pinT = Math.max(0, a._pinT - dt * 2);
    // settle any leftover attack pitch back to rest while roaming
    if (grp.rotation.x !== 0 && (a._atkAnim == null || a._atkAnim < 0)) grp.rotation.x *= Math.max(0, 1 - dt * 6);
    // ONE gait call per actor per frame: huntTick may already have run it
    // ahead of the strike pose (see its ORDER note) before handing the actor
    // back. A second call this frame reads a zero delta and collapses the stride.
    if (a._gaitEarly) a._gaitEarly = 0; else gaitAnimate(a, dt);
  }

  // ============================================================
  //  GUNSHOT PANIC + BLAST DAMAGE — wildlife hooks the combat side-effects
  //  from OUR side of the fence: every player shot already calls
  //  CBZ.cityAlarm at the muzzle (fpsmode.js) and every blast goes through
  //  CBZ.cityExplosion — both get the codebase's standard capture-and-wrap
  //  (foreign markers copied forward; blast handler idempotent per blast
  //  via opts._wlSeen, same pattern as demolition's _demoSeen).
  // ============================================================
  function spookFromShot(x, z) {
    if (!LIVE()) return;
    const extra = 0.8 * Math.min(SHOT.n, 5);           // sustained fire extends the panic
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i], sp = a.species;
      if (a.dead || a.tamed || a.ridden || a.external || sp.aquatic) continue;
      const cls = classify(sp), danger = sp.danger || 0;
      const hearR = cls.hearR || 45;
      const dx = a.pos.x - x, dz = a.pos.z - z, d2 = dx * dx + dz * dz;
      if (d2 > hearR * hearR) continue;
      if (a.snake) { a.alarm = Math.max(a.alarm, 3); continue; }   // snakes coil, they don't run
      // never interrupt/downgrade a committed animal — just keep it hot.
      if (a.state === "flee" || a.state === "charge" || a.state === "stalk" || (a._flinchT || 0) > 0) {
        a.alarm = Math.max(a.alarm, 4 + extra);
        if (a.state === "flee") a.stateT = Math.max(a.stateT || 0, cls.fleeT + extra);
        continue;
      }
      // huntsShared FIRST, danger second. The old order asked `danger >= 0.5`
      // before it asked who owns the animal's aggression, so an animal running
      // the shared brain on a wound licence (a moose at danger 0.4, a bighorn
      // at 0.2) fell into the prey branch and had `a.state = "flee"` written
      // behind the driver's back mid-fight. Ownership is the question; danger is
      // only the legacy path's own test.
      if (huntsShared(a)) {
        // A migrated hunter's aggression belongs to predatorHunt — writing
        // a.state = "charge" from out here would fight its FSM and skip
        // every beat that makes the encounter (the circle, the fake-out, the
        // menace gauge). The shot still lands: the alarm keeps it awake past
        // the LOD freeze and turns it toward the muzzle, its own sense radius
        // finds you from there, and any blood you spilled pulls it in through
        // predatorHunt's chum sense for free.
        a.alarm = Math.max(a.alarm, 5 + extra);
        a.heading = Math.atan2(z - a.pos.z, x - a.pos.x);
      } else if (danger >= 0.5) {
        // predators: a shot close by provokes; further out they orient/creep.
        if (d2 < sq((cls.aggro || 16) * 1.4)) { a.state = "charge"; a.alarm = 6; }
        else if (cls.stalk && a.group.visible !== false) { a.state = "stalk"; }
        else { a.alarm = Math.max(a.alarm, 4); a.heading = Math.atan2(z - a.pos.z, x - a.pos.x); }
      } else {
        a.state = "flee";
        a.stateT = cls.fleeT + extra;
        a.alarm = Math.max(a.alarm, 4 + extra);
        a.heading = Math.atan2(dz, dx);                // straight away from the shot
      }
    }
  }

  function blastWildlife(x, z, opts) {
    if (!LIVE()) return;
    if (opts && opts._wlSeen) return;                  // idempotent per blast
    if (opts) opts._wlSeen = true;
    const R = ((opts && opts.radius) || 6) * ((opts && opts.power) || 1);
    const kr = Math.max(4, R * 1.5);
    for (let i = animals.length - 1; i >= 0; i--) {
      const a = animals[i];
      if (a.dead || a.ridden) continue;
      const dx = a.pos.x - x, dz = a.pos.z - z;
      let d2 = dx * dx + dz * dz;
      // flying records (wildnature's live birds) count their ALTITUDE above
      // the ground blast — a grenade on the grass can't swat a flock 40u up.
      if (a.bird && a.pos.y != null) { const dy = a.pos.y - groundY(x, z); d2 += dy * dy; }
      if (d2 > kr * kr) continue;
      const dmg = Math.round(140 * Math.max(0.15, 1 - Math.sqrt(d2) / kr));
      CBZ.cityWildlifeHit(a, { head: false, point: null }, { damage: dmg });
    }
    SHOT.n = Math.max(SHOT.n, 3); SHOT.win = 0.9;      // a blast panics like a volley
    spookFromShot(x, z);
  }

  let wrapsOk = false;
  function installWraps() {
    if (!LIVE()) { wrapsOk = true; return; }
    const alarm = CBZ.cityAlarm;
    if (typeof alarm === "function" && !alarm._wildlifeWrapped) {
      const wrapA = function (x, z, radius, intensity, offender) {
        try {
          if (SHOT.win > 0) SHOT.n++; else SHOT.n = 1;
          SHOT.win = 0.9;
          spookFromShot(x, z);
        } catch (e) {}
        return alarm.apply(this, arguments);
      };
      for (const k in alarm) wrapA[k] = alarm[k];      // carry other wrappers' markers forward
      wrapA._wildlifeWrapped = true;
      CBZ.cityAlarm = wrapA;
    }
    const boom = CBZ.cityExplosion;
    if (typeof boom === "function" && !boom._wildlifeWrapped) {
      const wrapB = function (x, z, opts) {
        const r = boom.apply(this, arguments);
        try { blastWildlife(x, z, opts); } catch (e) {}
        return r;
      };
      for (const k in boom) wrapB[k] = boom[k];        // carry other wrappers' markers forward
      wrapB._wildlifeWrapped = true;
      CBZ.cityExplosion = wrapB;
    }
    wrapsOk = !!(CBZ.cityAlarm && CBZ.cityAlarm._wildlifeWrapped &&
                 CBZ.cityExplosion && CBZ.cityExplosion._wildlifeWrapped);
  }

  function tick(dt) {
    if (!dt || dt > 0.5) dt = 0.05;
    const P = CBZ.player && CBZ.player.pos;
    const waterTime = ((typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001) % 3600;
    venomTick(dt);                 // poison keeps draining after a venomous bite
    updateHerds(dt);               // live centroid + mean heading + herd alarm
    if (!wrapsOk) installWraps();  // retry until the combat hooks exist (idempotent)
    if (SHOT.win > 0) SHOT.win -= dt;   // repeated-gunshot window cools here
    // (the whole-list predator recount that used to run here is gone with
    //  HUNTER_CAP — predatorPack tracks its own hunters, so this is one fewer
    //  O(animals) sweep per frame as well as one fewer duplicated concept.)
    // LOD visibility rides the ONE quality knob (the pause-menu perf/quality
    // tier): animals beyond the tier's radius don't render or animate their
    // meshes — same pattern as the ped rig LOD. Big species read farther
    // (you SHOULD spot an elephant across the savanna before a rabbit).
    const q = CBZ.qualityLevel != null ? CBZ.qualityLevel : ANIMAL_VIS.length - 1;
    const visR = ANIMAL_VIS[Math.max(0, Math.min(ANIMAL_VIS.length - 1, q))];
    npcHunts = 0;
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i], sp = a.species, grp = a.group;
      if (a.external) continue;      // dogs: in the registry for the GUNS, driven by dogs.js
      // THE SATIATION CLOCK runs out here, not inside the hunt: a fed predator
      // is deliberately a calm animal, and a calm animal LOD-freezes below —
      // ticking its cooldown in the hunt would mean the world's only way to get
      // hungry again was for you to stand next to it.
      if (a._satT > 0) a._satT -= dt;
      // ..and so do the two defence cooldowns, for the same reason: an animal
      // that routed or spent its one cornered kick must be able to recover while
      // the player is nowhere near it. Both are pure decrements on a frozen
      // actor, which is the cheapest thing in this loop.
      if (a._routT > 0) a._routT -= dt;
      if (a._cornerCd > 0) a._cornerCd -= dt;
      /* HUNGER RUNS EVERYWHERE, and it runs HERE for the same reason the
         satiation clock does: an animal that can only get hungry inside your
         LOD radius would mean the sea is only ever hungry where you are
         standing. Two arithmetic ops on a frozen actor — the cheapest thing in
         this loop — and the behaviour scratch it feeds is only re-derived when
         the value has actually moved ~2%, i.e. every several seconds.
           mode 1 = head down grazing (a herbivore is EATING, not just idle)
           mode 2 = a fish picking at the water column
         Feeding at a carcass is not here: it is a real event and drops hunger
         outright through startFeed/endFeed. */
      if (TRAITS && !a.dead) {
        const grazing = (a.state === "graze" && (a._feedT || 0) <= 0 && !predSpecies(sp));
        TRAITS.tick(a, dt, grazing ? 1 : (sp.aquatic && !predSpecies(sp) ? 2 : 0));
      }
      if (a._prey && !a._prey.animal) npcHunts++;   // the global predator-vs-person cap
      let pd2 = 0;
      if (P) {
        const vdx = grp.position.x - P.x, vdz = grp.position.z - P.z;
        pd2 = vdx * vdx + vdz * vdz;
        const vr = visR * (SZ(a) >= 1.3 ? 1.6 : 1);
        grp.visible = a.ridden || a.tamed || pd2 < vr * vr;
      }
      // matrix LOD: hidden animals stop paying r128's per-frame matrix math
      // (the saving staticfreeze.js was after) and thaw the moment they show.
      if (LIVE()) setLiveMats(a, grp.visible !== false);
      /* THE BODY CUE — gaunt vs full-bellied, and the ONLY place hunger is
         ever shown. No HUD, no icon, no toast, no marker: you read it off the
         animal or you do not read it at all. A modest non-uniform scale on the
         discovered body/hull child (never the group — creature_combat forces
         the group's three components back to uniform between swings), and it
         composes with the size multiplier that lives on the group.
         Visible animals only, and only when the girth has moved a step. */
      if (TRAITS && grp.visible !== false && !a.dead) TRAITS.bodyCue(a);
      if (a.dead) {
        // Killing impulse drives a short, damped rigid-body tumble. It can slide,
        // bounce once and rotate on every axis before friction settles it onto a
        // side. This deliberately runs even when the mesh is LOD-hidden so the
        // carcass is in the right place/pose when the player approaches again.
        // (When systems/quadruped_ragdoll.js took the body there is no
        //  _deathPhys at all and IT owns the transform — one simulation per
        //  corpse, never two.)
        if (a._deathPhys) {
          wildlifeDeathStep(a, dt);
        } else if (a._dieT != null) {
          // legacy fallback for a carcass created before the new state existed.
          a._dieT -= dt;
          const k = Math.max(0, Math.min(1, 1 - a._dieT / 0.55));
          const e = 1 - (1 - k) * (1 - k);                       // ease-out
          grp.rotation.z = (a._dieZ0 || 0) + (a._toppleTo - (a._dieZ0 || 0)) * e;
          grp.rotation.x = (a._dieX0 || 0) * (1 - e);
          if (a._dieT <= 0) a._dieT = null;
        }
        a.skinT -= dt;
        if (a.skinT <= 0) { removeCarcass(a); i--; continue; }
        // gently sink a skinned husk before it's culled.
        if (a.skinned && a.skinT < 6) grp.position.y -= dt * 0.05;
        continue;
      }
      // ---- BABIES grow up: born tiny (a scaled-down copy of the adult — cute
      //      is the point), full-grown in GROW_TIME ------------------------
      if (a.grow != null && a.grow < 1) {
        a.grow = Math.min(1, a.grow + dt / GROW_TIME);
        applyScale(a, a.grow);
        if (a.grow >= 1) { a.grow = null; applyScale(a, null); }
      }
      // ---- TAMED / RIDDEN animals are driven by wildlife_tame.js ----------
      // (their position is set elsewhere; the gait layer keys off distance
      //  actually moved, so their legs animate for free.)
      if (a.ridden) { if (LIVE()) { if (a.swim) animateSwim(a, dt); else gaitAnimate(a, dt); } continue; }   // glued under the rider
      if (a.tamed && !sp.aquatic) {
        if (CBZ.cityTameFollow) CBZ.cityTameFollow(a, dt);
        if (a.snake) { a.moving = true; snakeAnimate(a, dt); }
        else if (LIVE()) gaitAnimate(a, dt);
        continue;
      }
      // ---- HELD IN SOMETHING'S JAWS ---------------------------------------
      // predator.js's seize re-anchors its victim's transform to the attacker's
      // mouth EVERY frame (anchorVictim). Steering the same body from here as
      // well is two writers on one transform, and the visible result is an
      // animal that calmly walks out of the jaws holding it. The body layer
      // still runs, so the prey keeps kicking while it is being shaken.
      if (a._seizedBy) {
        if (LIVE()) { if (a.swim) animateSwim(a, dt); else if (!a.snake) gaitAnimate(a, dt); }
        continue;
      }
      // ---- SNAKES slither (own locomotion + strike/rear/constrict logic) --
      if (a.snake) { snakeTick(a, dt, P); continue; }
      // ---- aquatic: water-mask navigation + synced wave/depth lanes -------
      if (sp.aquatic) {
        /* A HUNGRY FISH RIDES HIGH. This is the strongest hunger read the sea
           has, and it costs one multiply: swim depth leans SHALLOW with hunger
           and DEEP with fullness. A starving shark cruises just under the
           surface — where its fin proxy actually shows and where the seals and
           the swimmers are — and a fed one hangs down in blue water where you
           will never see it unless you go looking. Written off the spawn-time
           base every frame rather than accumulated, so it can never drift, and
           placed BEFORE the shark brain so it applies to the animal the owner
           named as much as to the mackerel.

           Behind the LOD gate on purpose? No — deliberately in front of it: a
           shark's fin proxy is drawn from beyond the visible radius, so the
           depth that decides whether you can see a fin at all has to be right
           on the frames where the body is not being ticked. */
        if (a._swimDepth0 > 0) a.swimDepth = a._swimDepth0 * (1.44 - DRIVE(a).bold * 0.44);
        // APEX PREDATORS think before the LOD gate: a stalking shark hunts from
        // BEYOND the visible radius (its fin proxy is what you see, not its
        // body — city/wildlife_shark.js), so it must keep running while hidden.
        // Everything else in the sea still idles when it is out of sight.
        if (CBZ.sharkBrain && (sp.danger || 0) >= 0.5 && !a.tamed && !a.dead) {
          /* THE SHARK'S OWN BUNDLE, SIZED AND STARVED — from out here, because
             wildlife_shark.js builds it and this file does not own that file.
             `s.opts` is a plain object it caches on the actor and predatorHunt
             reads every frame, so folding the individual's size into it once
             (predator.js's own exponents) and its live hunger into four of its
             numbers on each hunger step is all it takes for a big shark to
             genuinely hit harder and a starving one to circle less before it
             commits. No allocation per frame, no edit to either file.
             sizeKit is idempotent by its own receipt; hungerKit snapshots its
             base once so it can never compound. */
          if (TRAITS && a._shark && a._shark.opts) {
            TRAITS.sizeKit(a._shark.opts, a._sizeMul || 1);
            TRAITS.hungerKit(a._shark.opts, a);
          }
          if (CBZ.sharkBrain(a, dt, P)) {
            faceAnimalHeading(grp, a.heading);
            if (LIVE()) animateSwim(a, dt);
            continue;                                 // the hunt owns the transform
          }
        }
        if (grp.visible === false) continue;          // far sea life idles (no sim)
        /* HUNGER IN THE WATER. Same three reads as the land wander, and they
           are the whole difference a person watching the sea for thirty
           seconds is meant to see: a fed fish DRIFTS (0.7x, long straight
           glides), a starving one quarters the water restlessly at 1.3x and
           comes into shallows it would otherwise keep out of. The clearance
           lean is what puts a hungry shark in the surf beside you and keeps a
           fed one in blue water; it is rewritten off _baseClear so it can
           never compound frame to frame. */
        const hdA = DRIVE(a);
        if (a._baseClear > 0) a.waterClearance = a._baseClear * (1.5 - hdA.bold * 0.5);
        a.bob += dt * (1.2 + a.spd * 0.2);
        a.turnT -= dt;
        if (a.turnT <= 0) {
          a.heading += (Math.random() - 0.5) * 0.8 * hdA.restless;
          a.turnT = (3 + Math.random() * 4) / hdA.restless;
        }
        /* ---- A SCHOOL IS A SCHOOL. -------------------------------------
           This block existed twice in this file — once in landWalk and once
           in the legacy land branch — and NOT ONCE in the water, which is the
           one place the concept has a name. A sardine row declares a herd of
           26 to 60; seeding built the herd, updateHerds kept its centre and
           its shared heading up to date every frame, and then the aquatic
           mover ignored all of it and gave each fish an independent random
           walk. At a mackerel's cruise that is a shoal for about two seconds
           and a scatter of loners for the rest of the match — which is why
           the sea reads empty even when it is full: forty fish spread evenly
           over a ring is one fish every forty metres, and underwater sight
           lines here are shorter than that.

           Same three boids terms and the same constants as the land block,
           the same `bunch` scalar (a bait ball IS a school that has knotted
           because something hungry is under it), applied to the heading
           BEFORE the water navigator so shoreline clearance still owns the
           final step. Behind the LOD gate, so an off-screen school costs
           nothing. */
        const hrA = a.herd;
        if (hrA && hrA.n > 1 && !a.tamed) {
          let dx = Math.cos(a.heading), dz = Math.sin(a.heading);
          dx += Math.cos(hrA.heading) * 0.5; dz += Math.sin(hrA.heading) * 0.5;
          const toCx = hrA.cx - grp.position.x, toCz = hrA.cz - grp.position.z;
          const cd = Math.hypot(toCx, toCz) || 1;
          const bn = hrA.bunch || 0;
          const coh = Math.min(1.1 + bn * 0.9, Math.max(0, cd - 5 * (1 - bn * 0.8)) / (14 - bn * 7));
          dx += (toCx / cd) * coh; dz += (toCz / cd) * coh;
          const sepR = (2.2 + SZ(a) * 1.0) * (1 - bn * 0.45);
          let sx = 0, sz = 0;
          for (let m = 0; m < hrA.members.length; m++) {
            const o2 = hrA.members[m]; if (o2 === a || o2.dead) continue;
            const ox = grp.position.x - o2.pos.x, oz = grp.position.z - o2.pos.z;
            const od = Math.hypot(ox, oz);
            if (od > 0.001 && od < sepR) { sx += (ox / od) * (sepR - od); sz += (oz / od) * (sepR - od); }
          }
          dx += sx * 0.9; dz += sz * 0.9;
          let dh = Math.atan2(dz, dx) - a.heading;
          while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
          a.heading += dh * Math.min(1, dt * 2.2);
        }
        // TAMED sea life (ANIMALS_ALL_CONTROLLABLE): your dolphin swims WITH
        // you — heading steers toward wherever you are (the water nav below
        // still owns shoreline clearance, so it holds just offshore when you
        // walk the beach) instead of drifting away on the random wander.
        if (a.tamed && !a.stay && P &&
            !(CBZ.CONFIG && CBZ.CONFIG.ANIMALS_ALL_CONTROLLABLE === false)) {
          const tdx = P.x - grp.position.x, tdz = P.z - grp.position.z;
          const td2 = tdx * tdx + tdz * tdz;
          if (td2 > 64 && td2 < 220 * 220) {          // courteous 8u standoff
            const want = Math.atan2(tdz, tdx);
            let hd = want - a.heading;
            while (hd > Math.PI) hd -= 2 * Math.PI; while (hd < -Math.PI) hd += 2 * Math.PI;
            a.heading += hd * Math.min(1, dt * 2.5);
          }
        }
        const wf = CBZ.waterField;
        if (wf && wf.moveInWater) {
          // Recover any actor authored/saved on dry ground by projecting it to
          // the closest valid water cell. Afterwards, three forward feelers
          // follow bays and islands instead of crossing their terrain.
          if (!wf.isNavigableWater(grp.position.x, grp.position.z, (a.waterClearance || 12) * 0.45)) {
            const wet = wf.nearestWater(grp.position.x, grp.position.z, a.waterClearance || 12, 520);
            if (wet) { grp.position.x = wet.x; grp.position.z = wet.z; a.home.x = wet.x; a.home.z = wet.z; }
          }
          const nav = wf.moveInWater(
            grp.position.x, grp.position.z, a.heading, a.spd * hdA.spd * dt * 6,
            a.waterClearance || 12, waterTime, a._waterMove
          );
          a.heading = nav.heading;
          grp.position.x = nav.x; grp.position.z = nav.z;
          if (nav.blocked) { a.heading += 0.28; a.turnT = Math.min(a.turnT, 0.45); }
          // The bob rides INSIDE the solved water column (it is a change of
          // draft, not a change of Y after the fact), so nothing can bob its
          // way out of the sea, and the shared law keeps a body out of the bed
          // in the shallows without ever lifting it clear of the surface.
          grp.position.y = aquaticBodyY(grp.position.x, grp.position.z,
            (a.swimDepth || 1) - Math.sin(a.bob) * 0.055,
            aquaticBedLift(a), waterTime);
        } else {
          // Legacy radial-band fallback when this module is unit-loaded alone.
          const nx = grp.position.x + Math.cos(a.heading) * a.spd * hdA.spd * dt * 6;
          const nz = grp.position.z + Math.sin(a.heading) * a.spd * hdA.spd * dt * 6;
          const rr = Math.hypot(nx - FIELD.cx, nz - FIELD.cz);
          if (rr < FIELD.r0 || rr > FIELD.r1) a.heading += Math.PI * 0.6;
          else { grp.position.x = nx; grp.position.z = nz; }
          // THE FLOATING SHARK (owner: "sharks go out of water, they float
          // OVER water instead of being under it — the fins look real but then
          // the shark looks like it is FLYING ABOVE ITS FIN, it's dumb
          // physics"). This line was the whole bug.
          //
          // It bobs the body around y = 0 and never asks where the water is or
          // how deep this species swims. Mean sea level is -0.48, so y ~= 0 is
          // roughly half a metre ABOVE the waterline — the body rides on top of
          // the sea. Meanwhile wildlife_shark.js's fin proxy draws itself at the
          // REAL surface, correctly. Two different answers to "where is the
          // water", so the body hovers above its own fin.
          //
          // The branch above (the navigable-water path) always had it right:
          // surface minus swimDepth. This fallback simply never got the same
          // treatment. Both sides now run the ONE shared law (aquaticBodyY),
          // so a shark is UNDER the sea by its own body depth wherever the sea
          // happens to be this frame, surge included.
          grp.position.y = aquaticBodyY(grp.position.x, grp.position.z,
            (a.swimDepth || aquaticBodyDepth(sp)) - Math.sin(a.bob) * 0.12 * SZ(a),
            aquaticBedLift(a));
        }
        faceAnimalHeading(grp, a.heading);
        if (LIVE()) animateSwim(a, dt);               // the shared tail/fluke beat
        continue;
      }
      // ---- FAR + CALM land animals FREEZE (no per-frame steering) so a big
      //      world stays cheap — only the herds near you actually think & move.
      //      They resume instantly when you approach, or if their herd panics.
      //      Hot states (flee/charge/stalk) keep running off-screen so a shot
      //      herd genuinely LEAVES instead of pausing at the horizon.
      //      TWO EXEMPTIONS, and both are the food chain's:
      //      (a) A FEEDING animal — its meal clock only runs inside feedTick, so
      //          freezing it would leave a wolf standing over a carcass forever
      //          the moment you walked away.
      //      (b) A HUNGRY PREDATOR — this is the one that decides whether the
      //          food chain exists at all. Hot states (flee/charge/stalk) have
      //          always kept running off-screen, but ACQUISITION happened in the
      //          wander state, which freezes; so with the gate as it stood a wolf
      //          could only ever notice a deer inside the LOD radius, i.e. the
      //          world only ate itself where you were standing. A SATIATED
      //          predator still freezes (it is scenery for the next few minutes),
      //          and everything past HUNT_SIM_R freezes regardless, so the extra
      //          load is bounded by the predator ceiling, halved again by the
      //          far-distance AI throttle below.
      const hungryHunter = CHAIN() && (a._satT || 0) <= 0 && predSpecies(sp) && pd2 < HUNT_SIM_R2;
      //      (c) A DEFENDER ON A LICENCE — its rage clock only ticks inside
      //          huntTick, so freezing it would strand an animal permanently
      //          angry the moment you walked out of its LOD radius.
      if (grp.visible === false && (a.state === "wander" || a.state === "graze" || a.state === "idle") &&
          (a.alarm || 0) <= 0 && (a._feedT || 0) <= 0 && !hungryHunter && (a._defendT || 0) <= 0 &&
          (!a.herd || a.herd.panic <= 0.3)) { a.turnT -= dt; continue; }
      // ---- WILDLIFE_LIVE: the living state machine ------------------------
      if (LIVE()) {
        // AI throttle: calm animals beyond 90u think at half rate (with dt
        // doubled so speeds stay true); the gait only shows when visible.
        let edt = dt;
        if (P && (a.state === "wander" || a.state === "graze" || a.state === "idle") && (a.alarm || 0) <= 0 &&
            (!a.herd || a.herd.panic <= 0.3)) {
          const ddx = grp.position.x - P.x, ddz = grp.position.z - P.z;
          if (ddx * ddx + ddz * ddz > 8100) {
            a._lodF = !a._lodF;
            if (a._lodF) continue;
            edt = dt * 2;
          }
        }
        landLive(a, edt, P);
        continue;
      }
      // ---- land: alarm decays; react to the player -----------------------
      if (a.alarm > 0) a.alarm -= dt;
      let nearP = 0;
      if (P) { const dpx = grp.position.x - P.x, dpz = grp.position.z - P.z; nearP = dpx * dpx + dpz * dpz; }
      // HERD PANIC RIPPLE: if a herd-mate is alarmed, this animal reacts too,
      // even if it never saw the threat itself — the whole herd bolts (prey) or
      // stampedes (aggressive herd like bison) together, not one at a time.
      const hr = a.herd;
      if (hr && hr.panic > 0.3 && a.state === "wander" && a.alarm <= 0.1) {
        a.alarm = Math.max(a.alarm, hr.panic * 0.85);
        a.state = (sp.danger >= 0.5) ? "charge" : "flee";
        if (a.state === "flee") a.heading = hr.heading;        // flee WITH the herd
      }
      if (P && a.state !== "charge") {
        const spookR = (sp.spook || 26);
        if (nearP < spookR * spookR && sp.danger < 0.15) { a.state = "flee"; a.alarm = Math.max(a.alarm, 4); a.heading = Math.atan2(grp.position.z - P.z, grp.position.x - P.x); }
        else if (nearP < 18 * 18 && sp.danger >= 0.5) { a.state = "charge"; a.alarm = 6; }
        else if (a.alarm <= 0 && (a.state === "flee")) a.state = "wander";
      }
      // pick speed by state
      let spd = a.spd;
      if (a.state === "flee") spd = (a._spd0 || 1.4) * 2.4;
      else if (a.state === "charge") spd = (a._spd0 || 1.4) * 2.0;
      // heading logic
      a.turnT -= dt;
      if (a.state === "charge" && P) {
        a.heading = Math.atan2(P.z - grp.position.z, P.x - grp.position.x);
        // A charging animal that reaches you makes a species-appropriate strike.
        if (nearP < 3.2 * 3.2 && CBZ.cityHurtPlayer && (a._biteT || 0) <= 0) {
          const style = CBZ.creatureStyleFor ? CBZ.creatureStyleFor(sp) : null;
          animalStrikePlayer(a, sp.bite || 10, style);
          a._biteT = 1.1;
        }
        if (a._biteT > 0) a._biteT -= dt;
        if (nearP > 55 * 55) a.state = "wander";              // gave up
      } else {
        // ---- HERD MOVEMENT (boids): every frame, steer gently toward the
        //      herd's shared heading (alignment) + its centre (cohesion), while
        //      pushing off the nearest herd-mate (separation) so they move as a
        //      tight travelling body, not a scattering of loners. A stampeding
        //      (fleeing/charging) herd aligns HARDER so it reads as one wall. --
        if (hr && hr.n > 1) {
          let dx = Math.cos(a.heading), dz = Math.sin(a.heading);
          const align = (a.state === "wander") ? 0.5 : 1.4;   // panic = move as one
          dx += Math.cos(hr.heading) * align; dz += Math.sin(hr.heading) * align;
          // cohesion: pull toward the centre only once the herd spreads out
          const toCx = hr.cx - grp.position.x, toCz = hr.cz - grp.position.z;
          const cd = Math.hypot(toCx, toCz) || 1;
          // ..and the same knot in the water, which is the one place it has a
          // name: a BAIT BALL is a school that has bunched because something
          // hungry is underneath it. Same scalar, same source, no second system.
          const bn = hr.bunch || 0;
          const coh = Math.min(1.1 + bn * 0.9, Math.max(0, cd - 5 * (1 - bn * 0.8)) / (14 - bn * 7)) *
                      (a.state === "wander" ? 1 : 1.6);
          dx += (toCx / cd) * coh; dz += (toCz / cd) * coh;
          // separation: shove away from the closest herd-mate inside ~2.6u
          const sepR = (2.2 + SZ(a) * 1.0) * (1 - bn * 0.45);
          let sx = 0, sz = 0;
          for (let m = 0; m < hr.members.length; m++) {
            const o = hr.members[m]; if (o === a || o.dead) continue;
            const ox = grp.position.x - o.pos.x, oz = grp.position.z - o.pos.z;
            const od = Math.hypot(ox, oz);
            if (od > 0.001 && od < sepR) { sx += (ox / od) * (sepR - od); sz += (oz / od) * (sepR - od); }
          }
          dx += sx * 0.9; dz += sz * 0.9;
          // ease the heading toward the blended desire (turn rate, not a snap)
          const desired = Math.atan2(dz, dx);
          let d = desired - a.heading;
          while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
          a.heading += d * Math.min(1, dt * (a.state === "wander" ? 2.2 : 5.0));
        }
        // occasional idle jitter + a fresh grazing speed (loners & flavour)
        if (a.turnT <= 0) {
          a.turnT = 2 + Math.random() * 4;
          if (a.state === "wander") { a.heading += (hr && hr.n > 1 ? 0.3 : 1.5) * (Math.random() - 0.5); a.spd = (a._spd0 || 1.4) * (0.6 + Math.random() * 0.8); }
        }
      }
      // integrate + keep inside the home region (turn back at the fence)
      const nx = grp.position.x + Math.cos(a.heading) * spd * dt;
      const nz = grp.position.z + Math.sin(a.heading) * spd * dt;
      const reg = CBZ.cityNearestRegion && CBZ.cityNearestRegion(ARENA(), nx, nz, 40);
      const onHome = reg && (reg.biome === sp.biome) && CBZ.cityRegionHit(reg, nx, nz, 6);
      if (!onHome && a.state !== "charge") {
        // steer back toward home anchor instead of leaving the biome.
        a.heading = Math.atan2(a.home.z - grp.position.z, a.home.x - grp.position.x) + (Math.random() - 0.5) * 0.6;
      } else {
        grp.position.x = nx; grp.position.z = nz;
        grp.position.y = groundY(nx, nz);
      }
      faceAnimalHeading(grp, a.heading);
    }
  }

  /* TEAR THE OLD WORLD'S ANIMALS OUT before stocking a new one. Without this,
     switching modes would leave a Gang City elk herd standing in the middle of
     a disaster island's sea — the actors are ticked off a module-level list,
     not off the arena that spawned them. */
  function despawnAll() {
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i], g = a && a.group;
      if (g && g.parent) g.parent.remove(g);
      if (a) { a.dead = true; a.herd = null; }
    }
    animals.length = 0;
    carcasses.length = 0;
    herds.length = 0;
    for (const k in CAPS) delete CAPS[k];   // carrying capacity is per WORLD
  }

  /* ============================================================
      STOCK A WORLD WITH WILDLIFE — the ONE entry point, for any mode.

      OWNER: "gang city too and nat disaster should all have these sharks."
      Gang City had them because this file registered itself as a landmass and
      buildCity runs the landmass chain. NATURAL DISASTER HAD NOTHING — not
      because sea life was blocked there, but because nothing ever called this
      file, and the ocean band it would have used was Gang City's coordinates
      typed out as module constants. Both halves are fixed here: the band comes
      off the arena (deriveField), and this function is callable directly by a
      mode that builds its own world instead of going through buildCity.

        CBZ.cityWildlifeStock(arena, opts)
          arena — anything with `.root` (a THREE.Group to parent bodies into).
                  `.regions` marks it as a city (land species can spawn and the
                  tuned city band is used); `.center` + `.radius` marks it as an
                  island and derives a ring of open sea around it, which is
                  what modes/survival.js's CBZ.buildDisasterArena() returns.
          opts  — optional { ocean: { cx, cz, r0, r1 } } to state the band
                  outright when a mode knows its own water better than we do,
                  and { density } to scale the population (1 = Gang City's).
                  Unstated, density is derived from the band's own AREA.

      An island with no `.regions` spawns ONLY aquatic species, and that falls
      out for free: seedIndividuals returns early for a land species with no
      biome regions to place it in. So the disaster arena gets its sea life and
      no deer, without a single species row or a mode flag.
     ============================================================ */
  function stockWildlife(city, opts) {
    /* TWO WAYS TO SAY NO, because only one of them was reachable. CBZ.WILDLIFE
       has always been the master switch and there is no URL path to it — it is
       not a CONFIG key, so `?cfg_...` cannot set it and every headless tool
       had to boot the full menagerie whether it cared about animals or not.
       CBZ.CONFIG.WILDLIFE is the same switch through the door the rest of the
       engine uses (?cfg_WILDLIFE=0).

       AND A CORRECTION, for the record, because a wrong verdict left in a
       comment outlives the argument: an early beacon-based trace fingered
       this file's per-frame tick (onUpdate 47.1) as the thing that owns a
       built Gang City's frame. The precise instrument disagreed. Measured
       in-page (tools/boot-trace.mjs --prof, no beacons): 985 animals tick in
       ~1.4 ms, no hang, no non-finite state — the tick is one of the CHEAP
       systems. The frame was actually going to a hidden render-to-texture
       (cctv.js, see the gate there) and one-time UI warm-up builds. Keep the
       flag: a tool that does not need animals should not pay for them, and a
       controlled variable is worth having. But the tick is not the villain
       this comment's first draft said it was. */
    if (CBZ.WILDLIFE === false) return null;
    if (CBZ.CONFIG && CBZ.CONFIG.WILDLIFE === false) return null;
    city = city || (CBZ.city && CBZ.city.arena);
    if (!city || !city.root) return null;
    if (builtFor === city) return null;           // idempotent per world
    if (builtFor) despawnAll();                   // a different world: clear the old one
    builtFor = city;
    root = city.root;
    arena = city;                 // stash the arena for region lookups during build
    deriveField(city, opts);      // ..and take this world's ocean off it
    densityK = (opts && +opts.density > 0) ? +opts.density
      // Unstated: a city keeps the tuned budget; anything else is sized by how
      // much sea it actually has, against Gang City's band as the unit. An
      // island a tenth the area gets a tenth the fish and reads just as full.
      : (city.regions && city.regions.length) ? 1
      : Math.min(1.4, Math.max(0.12,
          (FIELD.r1 * FIELD.r1 - FIELD.r0 * FIELD.r0) /
          (CITY_BAND.r1 * CITY_BAND.r1 - CITY_BAND.r0 * CITY_BAND.r0)));

    if (!wired) {
      wired = true;
      registerPelts();
      registerInteractions();
      installWraps();             // gunshot panic + blast damage (capture-and-wrap)
      let breedAcc = 0;
      CBZ.onUpdate(47.1, function (dt) {
        tick(dt);
        breedAcc += (dt && dt < 0.5 ? dt : 0.016);
        if (breedAcc >= BREED_EVERY) { breedAcc = 0; breed(); }
      });
    }
    spawnAll();
    recordCaps();                 // each herd's seeded size = its carrying capacity
    return arena;
  }
  CBZ.cityWildlifeStock = stockWildlife;
  // ..and the ocean band this world ended up with, for anything that wants to
  // put a boat, a chum slick or a tsunami where the fish actually are.
  CBZ.cityWildlifeOcean = function () {
    return { cx: FIELD.cx, cz: FIELD.cz, r0: FIELD.r0, r1: FIELD.r1 };
  };
  /* ONE ANIMAL, WHERE A MODE SAYS. The shark sim's evolutions and pod
     top-ups need single spawns at stated points; a second spawner over
     there would be exactly the parallel-system drift this file exists to
     prevent, so this is a door to makeActor and nothing else. The animal
     comes out fully native — traits, rig, roster, dynamic tag — so combat,
     predation and the mount system cannot tell it from a seeded one. Bulk
     stocking stays cityWildlifeStock; this is one body at a time. */
  CBZ.cityWildlifeSpawnAt = function (id, x, z) {
    const sp = (CBZ.WILDLIFE_SPECIES || {})[id];
    if (!sp || !root) return null;
    return makeActor(sp, x, z);
  };
  /* ..AND A SCHOOL, which is a different thing and not n calls to the line
     above. A herd is the object that owns the shared heading and centre the
     boids blocks steer on; without one, sixteen mackerel dropped on the same
     point are sixteen independent random walks that have scattered before you
     get there. `newHerd`/`joinHerd` are module-private on purpose — this is
     the door, so a mode restocking its own sea (modes/shark_sim.js) gets a
     real shoal instead of standing up a second cohesion system beside this
     one.

     It takes the POINTS rather than a centre and a radius: the caller is the
     one that knows which water its world will let a body swim in, and a
     jitter applied in here could put half a school over the fence. Returns
     the actors placed. */
  CBZ.cityWildlifeSpawnHerd = function (id, points) {
    const sp = (CBZ.WILDLIFE_SPECIES || {})[id];
    const made = [];
    if (!sp || !root || !points || !points.length) return made;
    const hr = points.length > 1 ? newHerd(sp) : null;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
      const a = makeActor(sp, p.x, p.z);
      if (!a) continue;
      if (hr) joinHerd(a, hr);
      made.push(a);
    }
    return made;
  };

  // ============================================================
  //  BUILD — stock the world once, after every biome AND the order-97 signed
  //  continent shoreline exist. Aquatic spawn validation therefore reads the
  //  exact final coast, not an incomplete region list.
  // ============================================================
  CBZ.addLandmass(function (city) { stockWildlife(city, null); return null; }, 98);

  // ============================================================
  //  CARS HIT ANIMALS (CBZ.CONFIG.WILDLIFE_CAR_IMPACT)
  //
  //  OWNER: "they don't ... get hit by cars." They could not. vehicles.js's
  //  runOver() tests the player, CBZ.cityPeds, the instanced crowd and
  //  CBZ.cityCops; animals live in CBZ.cityWildlife, and the two lists were
  //  mutually invisible — you could drive a truck through a herd of elk and
  //  nothing happened to anybody. The LOOP belongs to vehicles.js (it owns the
  //  geometry and the per-frame budget); the damage MODEL belongs here, where
  //  the species is.
  //
  //  IT IS NOT ONE THRESHOLD FOR EVERY ANIMAL, which is the whole reason this
  //  is not four lines in runOver. CRASH.pedLethal is the speed that kills a
  //  PERSON, and a person is scale 1 — so the lethal speed for anything else
  //  scales with the square root of its own mass (a rabbit dies at a crawl, a
  //  bull moose walks away from a parking-lot clip) and the damage goes as the
  //  SQUARE of the closing speed, which is what kinetic energy actually does.
  //  Nothing here knows a species name; every number is scale and hp.
  //
  //  The body then flies with the CAR's direction of travel, because that is
  //  what the shared death physics was always reading — a struck deer launches
  //  down the road using code that already existed.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_CAR_IMPACT == null) CBZ.CONFIG.WILDLIFE_CAR_IMPACT = true;
  const _carHit = { head: false, point: null, dir: { x: 0, y: 0.3, z: 0 }, from: { x: 0, z: 0 } };
  const _carW = { damage: 0, knock: 1.9, by: null, cause: "hit by a car" };
  CBZ.cityWildlifeCarHit = function (a, opts) {
    if (CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_CAR_IMPACT === false) return 0;
    if (!a || a.dead || a.ridden || !a.pos || !opts) return 0;
    const sp = a.species || {};
    const v = Math.max(0, +opts.v || 0);
    if (v <= 0.5) return 0;
    const sz = SZ(a);
    const mass = Math.max(0.12, sz * sz);
    const lethalV = Math.max(2.5, (opts.lethal || 14) * Math.sqrt(mass));
    const maxHp = a.maxHp || sp.hp || 40;
    const k = v / lethalV;
    const dmg = Math.max(1, Math.round(maxHp * k * k * 1.15));
    // direction of travel + a little lift; killDir/wildlifeDeathTumble read it
    let dx = +opts.vx || 0, dz = +opts.vz || 0;
    const dl = Math.hypot(dx, dz);
    if (dl > 0.01) { dx /= dl; dz /= dl; } else { dx = 0; dz = 0; }
    _carHit.dir.x = dx; _carHit.dir.y = 0.3; _carHit.dir.z = dz;
    _carHit.from.x = opts.fromX != null ? opts.fromX : a.pos.x - dx;
    _carHit.from.z = opts.fromZ != null ? opts.fromZ : a.pos.z - dz;
    _carHit.point = a.pos;                 // the strike is at the body, not at a bone
    _carW.damage = dmg;
    _carW.knock = 1.4 + Math.min(2.6, v * 0.1);   // a faster car throws it further
    _carW.by = opts.by || null;
    const wasDead = a.dead;
    CBZ.cityWildlifeHit(a, _carHit, _carW);
    _carW.by = null;                       // never hold a reference between calls
    if (!wasDead && !a.dead) {
      // SURVIVED IT. cityWildlifeHit has already bolted it or provoked it (a
      // clipped bear turns on you — that is the shared grammar's job, not
      // ours); all we add is the BANG, which the herd hears exactly the way it
      // hears a gunshot. One panic system, not two.
      a.alarm = Math.max(a.alarm || 0, 6);
      spookFromShot(_carHit.from.x, _carHit.from.z);
    }
    return dmg;
  };

  // ============================================================
  //  THE RATCHET (BLOCK LAW #5) — HOW ANIMALS ACTUALLY DIED.
  //
  //  `legacyPoseDeaths` counts deaths that ended in the canned rotation snap
  //  (the owner's "head pointed to sky"). It is STRUCTURALLY zero while
  //  WILDLIFE_LIVE is on, which is the shipping default — it can only rise if
  //  somebody re-introduces a hand-written topple.
  //
  //  `frozenCorpses` counts dead bodies with no corpse timeline at all: no
  //  skin/fade countdown and not on the carcass list. That was a REAL live bug
  //  — predator.js's killVictim set `dead = true` on an animal directly, so a
  //  predator-killed deer got no death physics, never entered `carcasses`, had
  //  an undefined skinT (a NaN countdown that can never reach zero) and stood
  //  frozen mid-pose in the world FOREVER. It is pinned at 0.
  //
  //  ragdolls/tumbles are printed beside them so a "fix" that simply stops
  //  killing anything cannot pass.
  // ============================================================
  CBZ.wildlifeDeathAudit = function () {
    let frozen = 0, live = 0, dead = 0, hunting = 0, feeding = 0, satiated = 0, preyHunts = 0, npcTargets = 0;
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      if (!a.dead) {
        live++;
        if (a._huntSt && a._huntSt !== "cruise") hunting++;
        if ((a._feedT || 0) > 0) feeding++;
        if ((a._satT || 0) > 0) satiated++;
        if (a._prey) { preyHunts++; if (!a._prey.animal) npcTargets++; }
        continue;
      }
      dead++;
      const timed = isFinite(a.skinT) || isFinite(a.fadeT);
      if (!timed || (!a.external && carcasses.indexOf(a) < 0)) frozen++;
    }
    return {
      ragdolls: DEATHS.ragdolls, tumbles: DEATHS.tumbles,
      legacyPoseDeaths: DEATHS.legacyPose, frozenCorpses: frozen,
      live: live, corpses: dead, carcasses: carcasses.length,
      hunting: hunting, preyHunts: preyHunts, npcTargets: npcTargets,
      feeding: feeding, satiated: satiated,
      solver: CBZ.quadRagdollAudit ? CBZ.quadRagdollAudit() : null,
    };
  };

  // ============================================================
  //  THE RATCHET (BLOCK LAW #5) — DOES THE WORLD ACTUALLY FIGHT BACK?
  //
  //  `legacyAggroPaths` is the one that may only go DOWN and is structurally 0
  //  while WILDLIFE_FIGHT_BACK is on: it counts living animals sitting in the
  //  legacy `charge`/`stalk` states while the shared brain is NOT what put them
  //  there — i.e. every remaining place a wound or a fright pokes an animal's
  //  aggression by writing a string instead of licensing predatorHunt.
  //
  //  `defenders` / `defending` are printed beside it so a "fix" that simply
  //  stops anything from ever being angry cannot pass, and `charges`,
  //  `connects` and `corneredKicks` are cumulative counters that prove the
  //  behaviour is REAL rather than declared — a boar that provokes and never
  //  lands a tusk is the exact stat fiction this file's own doctrine bans.
  //
  //  `sharkKitAdopted` reports whether the last hand-written predator opts
  //  bundle in the game (wildlife_shark.js's) is on predatorKit. It is the one
  //  debt CLAUDE.md named by file.
  // ============================================================
  CBZ.wildlifeDefenseAudit = function () {
    let defenders = 0, defending = 0, legacy = 0, live = 0, eaters = 0, hunting = 0;
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      if (!a || a.dead || a.external) continue;
      live++;
      const sp = a.species; if (!sp) continue;
      if (defendsSpecies(sp)) defenders++;
      if (predSpecies(sp)) eaters++;
      if ((a._defendT || 0) > 0) defending++;
      if (a._huntSt && a._huntSt !== "cruise") hunting++;
      // the legacy count: hot without the shared brain owning it.
      if ((a.state === "charge" || a.state === "stalk") && !huntsShared(a)) legacy++;
    }
    return {
      defenders: defenders, defending: defending, eaters: eaters, hunting: hunting,
      provoked: DEF.provoked, charges: DEF.charges, connects: DEF.connects,
      corneredKicks: DEF.corner, routs: DEF.routs, crowded: DEF.crowd, calfGuards: DEF.young,
      sharkKitAdopted: !!CBZ.sharkKitAdopted,
      legacyAggroPaths: legacy, live: live,
      predator: CBZ.predatorAudit ? CBZ.predatorAudit() : null,
    };
  };

  /* ============================================================
      THE RATCHET (BLOCK LAW #5) — ARE THEY ACTUALLY INDIVIDUALS?

      `sizeStd` is the one that may only go UP and is structurally ZERO with
      WILDLIFE_SIZE_VARY off: it is the population standard deviation of the
      individual multiplier. A shoal where every fish is 1.00 scores 0, which
      is precisely the bug the owner reported, so a "fix" that quietly stops
      varying anything cannot pass. `sizeMin`/`sizeMax`/`bigOnes` say the tail
      is real rather than declared, and `hungerStd` does the same job for the
      other half — a world where everything is equally hungry is a world with
      no hunger in it.

      Optional `id` restricts the read to one species, which is how the
      before/after preset measures a line-up rather than the whole world.
     ============================================================ */
  CBZ.wildlifeTraitAudit = function (id) {
    let n = 0, sMin = Infinity, sMax = -Infinity, sSum = 0, sSq = 0, big = 0;
    let hN = 0, hMin = Infinity, hMax = -Infinity, hSum = 0, hSq = 0;
    let starving = 0, fed = 0, spdMin = Infinity, spdMax = -Infinity, hpMin = Infinity, hpMax = -Infinity;
    // the FOOD WEB half: how many are at a body right now, and how hard the
    // tightest herd in the world is packed. Both are structurally zero with
    // WILDLIFE_HUNGER off, which is the same ratchet law the size numbers obey.
    let feeding = 0, bunchMax = 0;
    for (let h = 0; h < herds.length; h++) {
      const b = herds[h] && herds[h].bunch;
      if (b > bunchMax && (!id || (herds[h].sp && herds[h].sp.id === id))) bunchMax = b;
    }
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      if (!a || a.dead || a.external) continue;
      if (id && (!a.species || a.species.id !== id)) continue;
      const k = a._sizeMul > 0 ? a._sizeMul : 1;
      n++; sSum += k; sSq += k * k;
      if (k < sMin) sMin = k; if (k > sMax) sMax = k;
      if (a._bigOne) big++;
      const sp0 = a._spd0 || 0;
      if (sp0 < spdMin) spdMin = sp0; if (sp0 > spdMax) spdMax = sp0;
      const mh = a.maxHp || 0;
      if (mh < hpMin) hpMin = mh; if (mh > hpMax) hpMax = mh;
      if ((a._feedT || 0) > 0) feeding++;
      if (Number.isFinite(a.hunger)) {
        hN++; hSum += a.hunger; hSq += a.hunger * a.hunger;
        if (a.hunger < hMin) hMin = a.hunger; if (a.hunger > hMax) hMax = a.hunger;
        if (a.hunger > 0.72) starving++; else if (a.hunger < 0.28) fed++;
      }
    }
    const r3 = function (v) { return Number.isFinite(v) ? Number(v.toFixed(3)) : 0; };
    const sMean = n ? sSum / n : 0, hMean = hN ? hSum / hN : 0;
    return {
      n: n,
      sizeMin: r3(n ? sMin : 0), sizeMax: r3(n ? sMax : 0), sizeMean: r3(sMean),
      sizeStd: r3(n ? Math.sqrt(Math.max(0, sSq / n - sMean * sMean)) : 0),
      sizeRange: r3(n ? sMax - sMin : 0), bigOnes: big,
      hpMin: Math.round(n ? hpMin : 0), hpMax: Math.round(n ? hpMax : 0),
      spdMin: r3(n ? spdMin : 0), spdMax: r3(n ? spdMax : 0),
      hungerN: hN, hungerMin: r3(hN ? hMin : 0), hungerMax: r3(hN ? hMax : 0),
      hungerMean: r3(hMean),
      hungerStd: r3(hN ? Math.sqrt(Math.max(0, hSq / hN - hMean * hMean)) : 0),
      starving: starving, fed: fed, feeding: feeding, bunchMax: r3(bunchMax),
      sizeOn: !!(TRAITS && TRAITS.SIZE_ON()), hungerOn: !!(TRAITS && TRAITS.HUNGER_ON()),
    };
  };

  // public: let other systems (dogs.js) read/kill wildlife.
  CBZ.cityWildlifeList = function () { return animals; };
  CBZ.cityWildlifeSkin = skin;
  CBZ.cityWildlifeMotionStats = function () {
    const out = { livingLand: 0, visibleLand: 0, moving: 0, idle: 0, sideways: 0, worstAlignment: 1 };
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i];
      if (!a || a.dead || a.external || (a.species && a.species.aquatic)) continue;
      out.livingLand++;
      if (!a.group || a.group.visible === false) continue;
      out.visibleLand++;
      if (a.state === "idle" || a.state === "graze") out.idle++;
      if ((a._motionMoved || 0) > 0) {
        out.moving++;
        const al = Number.isFinite(a._motionAlignment) ? a._motionAlignment : -1;
        if (al < out.worstAlignment) out.worstAlignment = al;
        if (al < 0.8) out.sideways++;
      }
    }
    return out;
  };

  // ============================================================
  //  THE RATCHET (BLOCK LAW #5) — four independent "a predator lands a hit on
  //  the player" paths lived in this file. All four now go through
  //  systems/predator.js's grammar, so all four declare it. Adoption is
  //  DECLARED, never sniffed: only the migrating file knows it migrated.
  //
  //  The `else` branch is the one that actually runs — predator.js loads AFTER
  //  wildlife.js, so the ids buffer on CBZ._predatorAdopted and predator.js
  //  drains them at load. Do not "fix" it to a plain call; the buffer is what
  //  makes the count independent of index.html's script order.
  //
  //  What each id means here:
  //   · predator-charge — landLive's stalk/charge FSM. Bears, big cats and
  //     wolves now hunt through predatorHunt with a predatorKit bundle.
  //   · herd-charge     — the dangerous-prey contact charge (bison, rhino,
  //     boar, elephant). Same driver; their archetype rows simply have no
  //     seize, so their commit is the impact and then they are past you.
  //   · snake-constrict — the anaconda's coil is a real predatorSeize now.
  //   · snake-strike    — the venom strike's approach and commit; the venom
  //     DoT itself still runs through applyVenom/venomTick, unchanged.
  //  (Each survives as the flag-off / no-predator.js degrade path only.)
  // ============================================================
  (function declareAdoption() {
    //   · defend-when-hurt  — A WOUND IS A PROVOCATION. Every damage class
    //     reaches an animal through cityWildlifeHit, and the bruiser band
    //     answers it by LICENSING predatorHunt (provoke, square up, commit,
    //     wheel, withdraw) instead of poking a legacy `state = "charge"`.
    //   · cornered-defense  — prey with nowhere to run takes ONE desperate
    //     kick, through the same licence and the same predatorCommit. Listed
    //     because it is a real "an animal hits you" path and an unlisted path
    //     is an unmeasured one.
    const ids = ["wildlife:predator-charge", "wildlife:herd-charge",
                 "wildlife:snake-constrict", "wildlife:snake-strike",
                 "wildlife:defend-when-hurt", "wildlife:cornered-defense"];
    for (let i = 0; i < ids.length; i++) {
      if (typeof CBZ.predatorAdopt === 'function') {
        try { CBZ.predatorAdopt(ids[i]); } catch (e) {}
      } else {
        try { (CBZ._predatorAdopted = CBZ._predatorAdopted || []).push(ids[i]); } catch (e) {}
      }
    }
  })();

  // read-only, for tuning probes: what is this land predator doing, and did
  // the pack let it commit? (The mirror of CBZ.sharkState.)
  CBZ.cityWildlifeHuntState = function (a) {
    if (!a) return null;
    return { state: a._huntSt || "cruise", commit: a._packGate !== false, kit: !!a._landHunt };
  };
})();
