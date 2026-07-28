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

  // Every species asset is authored nose-forward on local +X. Three.js yaw
  // rotates that axis toward (cos(yaw), -sin(yaw)), so a world heading
  // (cos(h), sin(h)) maps to yaw=-h — there is no quarter-turn offset. Keep
  // this convention public so tame/companion/biome drivers cannot reintroduce
  // the old sideways-slide independently.
  function faceAnimalHeading(actorOrGroup, heading) {
    const group = actorOrGroup && (actorOrGroup.group || actorOrGroup);
    if (group && group.rotation) group.rotation.y = -heading;
  }
  CBZ.faceAnimalHeading = faceAnimalHeading;

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
  const AQUATIC_R0 = 560;        // ocean band (from field centre) inner radius
  const AQUATIC_R1 = 1500;       // ..outer radius (still inside the terrain ring)
  const FIELD_CX = 0, FIELD_CZ = -700;   // matches terrain.js CX/CZ field centre
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
  let root = null, built = false;
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
    if (sp.id === "megalodon") return 88;
    if (sp.id === "humpback_whale") return 58;
    if (sp.id === "great_white_shark") return 34;
    return 16 + Math.min(22, (sp.scale || 1) * 8);
  }

  // How far the authored model origin sits below the animated surface. Big
  // animals retain a dorsal/back read; little fish remain genuinely submerged.
  function aquaticBodyDepth(sp) {
    if (!sp) return 1;
    if (sp.id === "megalodon") return 7.8;
    if (sp.id === "humpback_whale") return 2.8;
    if (sp.id === "great_white_shark") return 2.45;
    if (sp.id === "dolphin") return 1.55;
    return 0.72;
  }

  function oceanPoint(r, sp) {
    // Spawn from the same signed coast the visible sea uses. This is the
    // water equivalent of navmesh random-point sampling: a radius candidate
    // is accepted only when its whole body has shoreline clearance.
    if (CBZ.waterField && CBZ.waterField.randomWaterPoint) {
      return CBZ.waterField.randomWaterPoint(r, {
        cx: FIELD_CX, cz: FIELD_CZ, r0: AQUATIC_R0, r1: AQUATIC_R1,
        clearance: aquaticClearance(sp),
      });
    }
    // Legacy fallback for isolated tests that omit waterfield.js.
    for (let tries = 0; tries < 24; tries++) {
      const a = r() * Math.PI * 2;
      const rad = AQUATIC_R0 + r() * (AQUATIC_R1 - AQUATIC_R0);
      const x = FIELD_CX + Math.cos(a) * rad, z = FIELD_CZ + Math.sin(a) * rad;
      if (!CBZ.cityAnyRegion || !CBZ.cityAnyRegion(ARENA(), x, z, 30)) return { x, z };
    }
    return { x: FIELD_CX + 900, z: FIELD_CZ };
  }

  function wetPointNear(x, z, sp, radius) {
    const wf = CBZ.waterField;
    if (!wf || !wf.nearestWater) return { x: x, z: z };
    return wf.nearestWater(x, z, aquaticClearance(sp), radius || 240);
  }

  function makeActor(sp, x, z) {
    let grp;
    try { grp = sp.build({ THREE: THREE, mat: mat, rng: rng }); }
    catch (e) { grp = fallbackMesh(sp); }
    if (!grp) grp = fallbackMesh(sp);
    const s = sp.scale || 1;
    grp.scale.setScalar(s);
    const swimDepth = sp.aquatic ? aquaticBodyDepth(sp) : 0;
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
    const a = {
      species: sp, kind: "animal", animal: true,
      group: grp, pos: grp.position,      // fpsmode/interactions read .group.position and .pos
      hp: sp.hp || 40, maxHp: sp.hp || 40, dead: false, ko: 0, escaped: false,
      heading: initialHeading, faceH: initialHeading, turnT: rng() * 3, spd: sp.spd || 1.4,
      state: "wander", alarm: 0, home: { x: x, z: z },
      bob: rng() * 6.283, hitCount: 0, cleanKill: false,
      stateT: 0,                          // seconds left in the current timed behavior
    };
    if (sp.aquatic) {
      a.waterClearance = aquaticClearance(sp);
      a.swimDepth = swimDepth;
      a._waterMove = { x: x, z: z, heading: initialHeading, blocked: false, shore: -999 };
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

  // ============================================================
  //  BEHAVIOR CLASSES — every species maps to ONE class that fixes its gait
  //  read and its temperament numbers. Derived (not hand-listed) so new
  //  species auto-classify: trophic role + size + the creature_combat style.
  //    stepFreq  rad of leg-swing per unit walked (before leg-height scaling)
  //    bob       body bounce amplitude while moving (× scale)
  //    hop       flee-bound hop height (× scale) — cervids/rabbits BOUND
  //    sway      slow roll while walking (bears LUMBER)
  //    grazeP    chance to stop & graze when a wander leg ends
  //    stalker   big cats: long crouched approach, then a burst charge
  // ============================================================
  //  grazeT [lo,hi]s   how long a graze stop lasts
  //  wanderM/fleeM     speed multipliers on sp.spd
  //  fleeT             s of committed flight after the threat is gone
  //  hearR             u — how far away a GUNSHOT spooks/alerts this class
  //  aggro             u — a dangerous animal this close attacks (danger>=0.5)
  //  giveUp            u — a charging animal further than this quits
  //  atkM              charge speed multiplier
  //  stalk/burst/crouch  big cats: creep-in trigger, pounce-charge trigger,
  //                      crouch speed multiplier
  const CLASSES = {
    herd_prey:  { stepFreq: 2.6, stepCap: 15, bob: 0.05, hop: 0.16, sway: 0,    grazeP: 0.60, grazeT: [3, 7],   wanderM: 0.6, fleeM: 2.6, fleeT: 5,   hearR: 45 },
    small_game: { stepFreq: 4.2, stepCap: 22, bob: 0.04, hop: 0.24, sway: 0,    grazeP: 0.50, grazeT: [1.5, 4], wanderM: 0.7, fleeM: 3.0, fleeT: 3.5, hearR: 55 },
    farm:       { stepFreq: 2.4, stepCap: 13, bob: 0.04, hop: 0,    sway: 0.03, grazeP: 0.70, grazeT: [4, 9],   wanderM: 0.4, fleeM: 1.8, fleeT: 3,   hearR: 30 },
    big_neutral:{ stepFreq: 2.0, stepCap: 10, bob: 0.05, hop: 0,    sway: 0.05, grazeP: 0.60, grazeT: [4, 8],   wanderM: 0.5, fleeM: 1.6, fleeT: 2,   hearR: 38, aggro: 16, giveUp: 45, atkM: 2.2 },
    lumberer:   { stepFreq: 2.1, stepCap: 11, bob: 0.07, hop: 0,    sway: 0.10, grazeP: 0.40, grazeT: [4, 8],   wanderM: 0.5, fleeM: 1.8, fleeT: 2,   hearR: 35, aggro: 20, giveUp: 40, atkM: 2.0 },
    stalker:    { stepFreq: 2.8, stepCap: 16, bob: 0.05, hop: 0,    sway: 0,    grazeP: 0.30, grazeT: [3, 6],   wanderM: 0.5, fleeM: 2.0, fleeT: 3,   hearR: 60, aggro: 12, giveUp: 60, atkM: 2.2, stalk: 55, burst: 18, crouch: 0.35 },
    pack:       { stepFreq: 3.2, stepCap: 18, bob: 0.05, hop: 0.08, sway: 0,    grazeP: 0.35, grazeT: [3, 6],   wanderM: 0.6, fleeM: 2.0, fleeT: 3,   hearR: 55, aggro: 30, giveUp: 50, atkM: 2.2 },
  };
  function classify(sp) {
    if (sp._bclass) return sp._bclass;
    let c;
    const style = CBZ.creatureStyleFor ? CBZ.creatureStyleFor(sp) : "bite";
    const danger = sp.danger || 0;
    if (style === "pounce" && danger >= 0.4) c = CLASSES.stalker;
    else if (style === "maul" && danger >= 0.4) c = /bear/.test(sp.id) ? CLASSES.lumberer : CLASSES.pack;
    else if (danger >= 0.5) c = CLASSES.big_neutral;          // boar/bison/rhino/elephant — dangerous PREY
    else if (sp.biome === "farmland") c = CLASSES.farm;       // barnyard ambler (incl. chicken/sheep)
    else if ((sp.scale || 1) <= 0.85) c = CLASSES.small_game; // rabbits, foxes, raccoons, coyotes
    else if ((sp.scale || 1) >= 1.6) c = CLASSES.big_neutral;
    else c = CLASSES.herd_prey;
    sp._bclass = c;
    if (/rabbit|hare/.test(sp.id)) sp._hopAlways = true;     // rabbits bounce even at a stroll
    if (sp.id === "cheetah") sp._stalk = { trig: 70, burst: 26, giveUp: 80, burstT: 6 };  // the sprinter
    return c;
  }
  function sq(v) { return v * v; }

  // ============================================================
  //  GAIT RIG — the species builds are flat groups of unnamed boxes (feet at
  //  y=0, nose +X), so the rig is DISCOVERED, not declared: any tall, thin,
  //  ground-touching child is a leg; anything stacked on the same (x,z)
  //  column (feet, paw pads, the tiger's leg stripes) rides along with it.
  //  Head parts (far-forward, off the ground) are collected for the graze
  //  dip. Everything is cached per ACTOR (groups are per-animal; geometries
  //  are shared and never mutated — only mesh .position moves, exactly the
  //  dogs.js trot pattern).
  // ============================================================
  function meshDims(m) {
    const p = m.geometry && m.geometry.parameters;
    if (p && p.width != null) return { w: Math.max(p.width, p.depth || p.width), h: p.height };
    const bb = m.geometry && (m.geometry.boundingBox || (m.geometry.computeBoundingBox(), m.geometry.boundingBox));
    if (!bb) return null;
    return { w: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), h: bb.max.y - bb.min.y };
  }
  function buildGaitRig(a) {
    const sp = a.species, grp = a.group;
    if (sp.snake || sp.aquatic) return;
    const kids = grp.children, cols = [], rest = [];
    let maxX = 0;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i]; if (!m.isMesh) continue;
      const d = meshDims(m); if (!d) continue;
      if (m.position.x > maxX) maxX = m.position.x;
      const bottom = m.position.y - d.h / 2;
      // a LEG: taller than wide, planted at the ground
      if (d.h >= 0.14 && d.h >= d.w * 1.1 && bottom <= 0.16 && bottom >= -0.05) {
        let col = null;
        for (let c = 0; c < cols.length; c++) {
          if (Math.abs(cols[c].x - m.position.x) <= 0.14 && Math.abs(cols[c].z - m.position.z) <= 0.14) { col = cols[c]; break; }
        }
        if (!col) { col = { x: m.position.x, z: m.position.z, top: 0, h: d.h, parts: [] }; cols.push(col); }
        col.top = Math.max(col.top, m.position.y + d.h / 2);
        col.h = Math.max(col.h, d.h);
        col.parts.push({ m: m, bx: m.position.x, by: m.position.y });
      } else {
        rest.push({ m: m, d: d, bottom: bottom });
      }
    }
    if (cols.length < 2 || cols.length > 8) return;      // no readable legs — glide
    // sweep 2: feet / pads / leg stripes stacked on a column ride with it
    const head = [];
    let headMesh = null, headVol = 0;
    for (let i = 0; i < rest.length; i++) {
      const r = rest[i], m = r.m;
      let joined = false;
      for (let c = 0; c < cols.length; c++) {
        const col = cols[c];
        if (Math.abs(col.x - m.position.x) <= 0.13 && Math.abs(col.z - m.position.z) <= 0.13 &&
            m.position.y - r.d.h / 2 < col.top && r.d.h <= col.h * 1.2) {
          col.parts.push({ m: m, bx: m.position.x, by: m.position.y });
          joined = true; break;
        }
      }
      // head cluster (for the graze dip): far forward, up off the ground
      if (!joined && maxX > 0.4 && m.position.x >= maxX * 0.55 && r.bottom >= 0.3) {
        head.push({ m: m, bx: m.position.x, by: m.position.y, bottom: r.bottom });
        // THE head box (for the aggro eyes): the biggest far-forward block.
        const vol = r.d.w * r.d.w * r.d.h;
        if (m.position.x >= maxX * 0.62 && vol > headVol) { headVol = vol; headMesh = m; }
      }
    }
    // diagonal-gait phase: FL+RR swing together, FR+RL oppose (a trot). Two
    // legs (birds) degrade to left/right alternation via the same XOR.
    let legH = 0;
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      col.diag = (((col.x >= 0) ? 1 : 0) ^ ((col.z >= 0) ? 1 : 0)) ? -1 : 1;
      legH = Math.max(legH, col.h);
    }
    let dip = 0;
    if (head.length) {
      dip = Infinity;
      for (let i = 0; i < head.length; i++) dip = Math.min(dip, head[i].bottom);
      dip = Math.max(0, Math.min(1.1, dip * 0.7));
    }
    const cls = classify(sp);
    a.gait = {
      cols: cols, head: head.length ? head : null, dip: dip, headMesh: headMesh,
      amp: Math.max(0.04, Math.min(0.3, legH * 0.32)),
      freq: Math.max(1.4, Math.min(9, (cls.stepFreq * 2.2) / Math.max(0.22, legH * (sp.scale || 1)))),
      step: 0, k: 0, grazeK: 0,
    };
  }

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

  // ---- the per-frame gait: legs swing by DISTANCE ACTUALLY MOVED (so every
  //      state — wander, flee, stalk, tame-follow, ridden — animates for free),
  //      plus the class flourishes: bound hop, lumber sway, run bob, graze dip.
  function gaitAnimate(a, dt) {
    const gt = a.gait; if (!gt) return;
    const grp = a.group, sp = a.species, cls = classify(sp);
    const mx = grp.position.x, mz = grp.position.z;
    const mdx = a._gpx == null ? 0 : mx - a._gpx;
    const mdz = a._gpz == null ? 0 : mz - a._gpz;
    const moved = Math.hypot(mdx, mdz);
    a._gpx = mx; a._gpz = mz;
    const walking = moved > 0.0025;
    // Keep a cheap observable invariant for audits: any visible land animal
    // that moved should travel along the direction its nose faces. 1.0 means
    // exact alignment, 0 means the old sideways slide, -1 means moonwalking.
    a._motionMoved = walking ? moved : 0;
    if (walking) {
      const h = a.faceH == null ? a.heading : a.faceH;
      a._motionAlignment = (mdx / moved) * Math.cos(h) + (mdz / moved) * Math.sin(h);
    } else a._motionAlignment = 1;
    // stride rate rides distance moved, but is CAPPED per class (a sprinting
    // animal lengthens its stride, it doesn't blur its legs): elephants top
    // out ~1.6 strides/s, rabbits ~3.5.
    if (walking) gt.step += Math.min(Math.min(moved, 1.5) * gt.freq, dt * (cls.stepCap || 15));
    // TERRAIN SLOPE: pitch the body to the ground it actually walks over —
    // read from the rise along the path (zero extra floorAt calls). At this
    // point grp.position.y is still the CLEAN ground height (flourishes are
    // added below), so d(y)/d(travel) IS the slope under the feet.
    const gy = grp.position.y;
    if (!a.ridden && a._gpy != null && moved > 0.01) {
      const rawS = Math.max(-0.45, Math.min(0.45, Math.atan2(gy - a._gpy, moved)));
      a._slope = (a._slope || 0) + (rawS - (a._slope || 0)) * Math.min(1, dt * 5);
    }                                                  // parked: HOLD the slope it stopped on
    a._gpy = gy;
    // ease the swing weight in/out so legs settle instead of snapping
    gt.k += ((walking ? 1 : 0) - gt.k) * Math.min(1, dt * 8);
    if (gt.k > 0.02) {
      const sw = Math.sin(gt.step) * gt.amp * gt.k;
      const lift = gt.amp * 0.35 * gt.k;
      for (let c = 0; c < gt.cols.length; c++) {
        const col = gt.cols[c], s = sw * col.diag;
        const up = Math.max(0, Math.sin(gt.step + (col.diag > 0 ? 0 : Math.PI))) * lift;
        for (let p = 0; p < col.parts.length; p++) {
          const pt = col.parts[p];
          pt.m.position.x = pt.bx + s;
          pt.m.position.y = pt.by + up;
        }
      }
    } else if (gt.k <= 0.02 && gt._setl !== 1) {
      gt._setl = 1;
      for (let c = 0; c < gt.cols.length; c++) {
        const col = gt.cols[c];
        for (let p = 0; p < col.parts.length; p++) { const pt = col.parts[p]; pt.m.position.x = pt.bx; pt.m.position.y = pt.by; }
      }
    }
    if (walking) gt._setl = 0;
    // class flourishes on the GROUP (after tick set y to ground level):
    const fleeing = a.state === "flee" || a.state === "charge";
    if (walking) {
      if (cls.hop && (fleeing || sp._hopAlways)) {
        grp.position.y += Math.abs(Math.sin(gt.step * 0.5)) * cls.hop * (sp.scale || 1) * 2.2;   // the BOUND
      } else if (cls.bob) {
        grp.position.y += Math.abs(Math.sin(gt.step)) * cls.bob * (sp.scale || 1) * gt.k;
      }
    }
    // body pitch = terrain slope + the lumbering rock (bears) — one composed
    // write, and only while no flinch/attack owns the transform.
    if ((a._flinchT || 0) <= 0 && (a._atkAnim == null || a._atkAnim < 0)) {
      const swayV = (walking && cls.sway) ? Math.sin(gt.step * 0.5) * cls.sway * gt.k : 0;
      grp.rotation.z = (a._slope || 0) + swayV;
    }
    // graze dip: the head cluster eases down to the grass and back up
    if (gt.head) {
      const want = (a.state === "graze") ? 1 : 0;
      gt.grazeK += (want - gt.grazeK) * Math.min(1, dt * 3);
      if (gt.grazeK > 0.01 || gt._setg === 1) {
        gt._setg = gt.grazeK > 0.01 ? 1 : 0;
        const dy = gt.dip * gt.grazeK, dx = gt.dip * 0.3 * gt.grazeK;
        for (let i = 0; i < gt.head.length; i++) {
          const h = gt.head[i];
          h.m.position.y = h.by - dy;
          h.m.position.x = h.bx + dx;
        }
      }
    }
  }

  // ============================================================
  //  SWIM RIG — the aquatic half of the SAME discovery system. buildGaitRig
  //  bailed on sp.aquatic, so every water species in the game (mackerel,
  //  dolphin, humpback, great white, megalodon) was a rigid mesh SLIDING
  //  through the sea: five species, zero animation. This is one rig, not a
  //  shark animator — fixing it here fixes all five and every future one.
  //
  //  DISCOVERY (no declarations, same law as the leg columns): the models are
  //  authored nose-toward +X, so children behind the origin are the tail. The
  //  ones in the rear half BEHIND the body mass become the tail cluster, with a
  //  weight t that grows to 1 at the tip; the tip's own proportions decide the
  //  swim PLANE — a fin taller than it is wide (shark, mackerel) undulates
  //  LATERALLY, a horizontal fluke (dolphin, humpback) undulates VERTICALLY,
  //  which is the actual difference between a fish and a cetacean.
  //
  //  The travelling-wave-down-the-tail trick is ported from games/ocean.js
  //  (proven there for years) and applied in place — no reparenting, exactly
  //  like snakeAnimate's segment chain, so nothing that indexes group.children
  //  can be surprised.
  //
  //  Phase rides DISTANCE ACTUALLY MOVED (gaitAnimate's law), so a wander, a
  //  tamed follow, a stalk and a shark's rush all animate for free.
  // ============================================================
  function tipHorizontal(m) {
    // horizontal fluke (cetacean) vs vertical caudal fin (fish/shark)
    const p = m && m.geometry && m.geometry.parameters;
    if (p && p.depth != null && p.height != null) return p.depth > p.height * 1.25;
    const d = m ? meshDims(m) : null;
    return !!(d && d.w > d.h * 1.6);
  }
  function buildSwimRig(a) {
    const sp = a.species, grp = a.group;
    if (!sp.aquatic || sp.snake) return;
    const kids = grp.children;
    let minX = 0, maxX = 0;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i]; if (!m || !m.isMesh) continue;
      if (m.position.x < minX) minX = m.position.x;
      if (m.position.x > maxX) maxX = m.position.x;
    }
    if (minX > -0.3) return;                       // nothing behind the origin: no tail to swing
    const cut = minX * 0.5;                        // the rear half behind the body mass
    const span = minX - cut;
    const parts = [];
    let tip = null, tipX = 1e9;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i]; if (!m || !m.isMesh) continue;
      if (m.position.x > cut) continue;
      parts.push({
        m: m, bx: m.position.x, by: m.position.y, bz: m.position.z,
        ry: m.rotation.y, rz: m.rotation.z,
        t: Math.max(0, Math.min(1, (m.position.x - cut) / (span || -1))),
      });
      if (m.position.x < tipX) { tipX = m.position.x; tip = m; }
    }
    if (!parts.length) return;
    parts.sort(function (p, q) { return p.t - q.t; });   // base -> tip, so the wave travels
    // JAW: the far-forward children that hang BELOW the mean of the head
    // cluster — i.e. the lower jaw and its tooth row, never the skull.
    const jawCut = maxX * 0.6;
    let sumY = 0, nY = 0;
    for (let i = 0; i < kids.length; i++) {
      const m = kids[i]; if (!m || !m.isMesh || m.position.x < jawCut) continue;
      sumY += m.position.y; nY++;
    }
    const jaw = [];
    if (nY >= 3) {
      const meanY = sumY / nY;
      for (let i = 0; i < kids.length && jaw.length < 14; i++) {
        const m = kids[i]; if (!m || !m.isMesh || m.position.x < jawCut) continue;
        if (m.position.y < meanY - 0.05) jaw.push({ m: m, bx: m.position.x, by: m.position.y, rz: m.rotation.z });
      }
    }
    const len = Math.max(0.5, maxX - minX);
    a.swim = {
      parts: parts, vert: tipHorizontal(tip),
      amp: len * 0.065,                            // sweep at the tip, in local u
      yaw: 0.42,                                   // fin angle-of-attack at the tip
      freq: Math.max(0.8, Math.min(8, 6 / len)),   // radians of beat per unit travelled
      // DETERMINISM: the seeded rng() is a shared, order-fragile stream — a new
      // draw here would shift every later spawn and break the byte-identical
      // world build. Position-hash instead (no stream state at all).
      ph: (CBZ.hash01 ? CBZ.hash01(grp.position.x, grp.position.z, 71) : 0) * 6.283,
      k: 0,
      jaw: jaw.length ? jaw : null, jawX: maxX * 0.62, jawY: 0, jawK: -1,
      px: null, pz: null, py: null, ph0: a.heading,
      roll: 0, pitch: 0,
    };
    // hinge height for the gape = the mean y of the jaw parts
    if (jaw.length) {
      let s = 0;
      for (let i = 0; i < jaw.length; i++) s += jaw[i].by;
      a.swim.jawY = s / jaw.length;
    }
  }

  // openness 0..1 — the gape. Called by creature_combat's "lunge" strike and by
  // the seize, so a shark's mouth actually opens on the thing it is biting.
  function swimJaw(actor, openness) {
    const rig = actor && actor.swim;
    if (!rig || !rig.jaw) return;
    let o = openness > 0 ? (openness > 1 ? 1 : openness) : 0;
    if (rig.jawK >= 0 && Math.abs(o - rig.jawK) < 0.01) return;   // nothing changed
    rig.jawK = o;
    const th = -o * 0.62;                       // drop the lower jaw about the hinge
    const c = Math.cos(th), s = Math.sin(th);
    for (let i = 0; i < rig.jaw.length; i++) {
      const p = rig.jaw[i];
      const dx = p.bx - rig.jawX, dy = p.by - rig.jawY;
      p.m.position.x = rig.jawX + dx * c - dy * s;
      p.m.position.y = rig.jawY + dx * s + dy * c;
      p.m.rotation.z = p.rz + th;
    }
  }

  function animateSwim(a, dt) {
    const rig = a.swim; if (!rig) return;
    const grp = a.group;
    if (grp.visible === false) return;            // out of the LOD radius: no mesh work
    const mx = grp.position.x, mz = grp.position.z, my = grp.position.y;
    const mdx = rig.px == null ? 0 : mx - rig.px;
    const mdz = rig.pz == null ? 0 : mz - rig.pz;
    const moved = Math.sqrt(mdx * mdx + mdz * mdz);
    const vy = (rig.py == null || dt <= 0) ? 0 : (my - rig.py) / dt;
    rig.px = mx; rig.pz = mz; rig.py = my;
    // beat rides distance moved (same law as the gait) + a small idle flick, so
    // a hovering fish still lives and a sprinting shark thrashes. Capped so a
    // teleport/recovery jump can never spin the tail into a blur.
    rig.ph += Math.min(Math.min(moved, 1.5) * rig.freq, dt * 24) + dt * 0.9;
    if (rig.ph > 1e6) rig.ph -= 1e6;
    const swing = moved > 0.002 ? 1 : 0.4;
    rig.k += (swing - rig.k) * Math.min(1, dt * 4);
    const amp = rig.amp * rig.k, yaw = rig.yaw * rig.k;
    const parts = rig.parts;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const ang = rig.ph - p.t * 1.55;            // lag down the body = a travelling wave
      const sw = Math.sin(ang) * p.t, lead = Math.cos(ang) * p.t;
      if (rig.vert) {                             // cetacean: up/down flukes
        p.m.position.y = p.by + sw * amp;
        p.m.rotation.z = p.rz + lead * yaw;
      } else {                                    // fish/shark: side to side
        p.m.position.z = p.bz + sw * amp;
        p.m.rotation.y = p.ry + lead * yaw;
      }
    }
    // BODY: bank into the turn (rotation.x rolls a +X-forward body) and pitch
    // with vertical speed (rotation.z) — a diving shark noses down. Yielded
    // whenever a flinch or a creature_combat strike owns the transform.
    if ((a._flinchT || 0) <= 0 && (a._atkAnim == null || a._atkAnim < 0)) {
      let dh = a.heading - rig.ph0;
      while (dh > Math.PI) dh -= 6.283185307; while (dh < -Math.PI) dh += 6.283185307;
      const turn = dt > 0 ? dh / dt : 0;
      const wantRoll = Math.max(-0.45, Math.min(0.45, turn * 0.25));
      const wantPitch = Math.max(-0.5, Math.min(0.5, vy * 0.11));
      const e = Math.min(1, dt * 3.2);
      rig.roll += (wantRoll - rig.roll) * e;
      rig.pitch += (wantPitch - rig.pitch) * e;
      grp.rotation.x = rig.roll;
      grp.rotation.z = rig.pitch;
    }
    rig.ph0 = a.heading;
  }
  CBZ.buildSwimRig = buildSwimRig;
  CBZ.animateSwim = animateSwim;
  CBZ.swimJaw = swimJaw;

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
  function newHerd(sp) { const hr = { sp: sp, members: [], cx: 0, cz: 0, heading: rng() * 6.283, n: 0, panic: 0, fleeHx: 0, fleeHz: 0 }; herds.push(hr); return hr; }
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
    }
  }

  function seedIndividuals(sp, count) {
    // place `count` individuals of a species, clustered into herds of the
    // species' NATURAL size. Herd size is a per-species TRAIT (how they group);
    // `count` is set by the ratio system (how many exist). The two are
    // decoupled — that's what makes the mix scalable.
    let placed = 0, guard = 0;
    while (placed < count && guard++ < 400) {
      const regs = sp.aquatic ? null : biomeRegions(sp.biome);
      if (!sp.aquatic && (!regs || !regs.length)) return placed;
      const anchor = sp.aquatic ? oceanPoint(rng, sp) : regionPoint(regs[(rng() * regs.length) | 0], rng);
      if (!anchor) return placed;          // no validated water means no aquatic spawn
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
          a.group.scale.setScalar((sp.scale || 1) * (0.4 + 0.6 * a.grow));
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
  const BIOME_SHARE = { forest: 0.25, farmland: 0.16, desert: 0.23, snow: 0.16, water: 0.20 };
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

  function spawnAll() {
    const S = CBZ.WILDLIFE_SPECIES || {};
    // bucket non-legendary species by biome
    const buckets = {};
    for (const id in S) { const sp = S[id]; if (sp.rarity === "legendary") continue; (buckets[sp.biome] || (buckets[sp.biome] = [])).push(sp); }
    for (const biome in buckets) {
      const target = Math.round(DENSITY * (BIOME_SHARE[biome] || 0.15));
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
        kid.group.scale.setScalar((sp.scale || 1) * 0.4);   // small from frame one
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
      if (a.species.danger > 0.15 && P) {
        if (!huntsShared(a)) { a.state = "charge"; a._burstT = null; }
        else if (CBZ.predatorProvoke) {
          // IT FIGHTS BACK AT WHAT ACTUALLY BIT IT. `by` is null for a player
          // shot, which is the old behaviour byte for byte; when another ANIMAL
          // drew the blood, the wound re-targets the hunt onto it instead of
          // onto whoever happens to be standing across the meadow. Satiation and
          // any half-finished meal are cleared: being eaten outranks being full.
          const foe = (by && by.animal && by.pos && !by.dead) ? by : (CBZ.player || null);
          a._feedT = 0; a._feedOn = null; a._satT = 0;
          a._prey = (foe && foe.animal) ? foe : null;
          try { CBZ.predatorProvoke(a, foe); } catch (e) {}
        }
      }
      else {
        a.state = "flee"; a.stateT = (cls.fleeT || 4) + 2;
        if (P) a.heading = Math.atan2(a.pos.z - P.z, a.pos.x - P.x);
        a.spd = (a.species.spd || 1.4) * 2.2;
      }
    } else if (a.species.danger > 0.15 && P) { a.state = "charge"; }
    else { a.state = "flee"; if (P) { a.heading = Math.atan2(a.pos.z - P.z, a.pos.x - P.x); } a.spd = (a.species.spd || 1.4) * 2.2; }
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

  function wildlifeDeathTumble(a, dir, impulse, point) {
    if (!a || !a.group) return null;
    const grp = a.group, sp = a.species || {};
    let dx = dir ? (+dir.x || 0) : 0;
    const dy = dir ? (+dir.y || 0) : 0;
    let dz = dir ? (+dir.z || 0) : 0;
    let dl = Math.hypot(dx, dz);
    if (dl < 0.01) { const ah = Math.random() * Math.PI * 2; dx = Math.cos(ah); dz = Math.sin(ah); dl = 1; }
    dx /= dl; dz /= dl;
    const scale = Math.max(0.35, sp.scale || 1);
    const mass = Math.max(0.75, scale * scale * 1.7);
    const raw = (impulse != null && isFinite(impulse) && impulse > 0) ? impulse : 5.9;
    const imp = Math.min(8.5, raw / Math.sqrt(mass));
    const side = point
      ? (Math.sign((point.x - grp.position.x) * -dz + (point.z - grp.position.z) * dx) || (Math.random() < 0.5 ? -1 : 1))
      : (Math.random() < 0.5 ? -1 : 1);
    a._deathPhys = {
      vx: dx * imp, vy: Math.max(1.2, 1.6 + Math.max(-0.2, dy) * imp * 0.7), vz: dz * imp,
      wx: (Math.random() - 0.5) * 2.1 + dy * 0.8,
      wy: (Math.random() - 0.5) * 1.8,
      wz: side * (2.7 + Math.random() * 1.9) + dx * 0.5,
      restRoll: side * (1.38 + Math.random() * 0.14),
      restPitch: (Math.random() - 0.5) * 0.32,
      restYaw: grp.rotation.y + (Math.random() - 0.5) * 0.25,
      t: 0, groundT: 0, bounces: 0,
    };
    a._dieT = null;
    DEATHS.tumbles++;
    grp.position.y = Math.max(groundY(grp.position.x, grp.position.z) + 0.08 * scale, grp.position.y);
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
    const scale = Math.max(0.35, (a.species && a.species.scale) || 1);
    ph.t += step;
    ph.vy -= 20.5 * step;
    grp.position.x += ph.vx * step;
    grp.position.y += ph.vy * step;
    grp.position.z += ph.vz * step;
    grp.rotation.x += ph.wx * step;
    grp.rotation.y += ph.wy * step;
    grp.rotation.z += ph.wz * step;
    const restY = groundY(grp.position.x, grp.position.z) + 0.08 * scale;
    if (grp.position.y <= restY && ph.vy < 0) {
      grp.position.y = restY;
      ph.bounces++;
      if (ph.bounces <= 1 && Math.abs(ph.vy) > 2.2) ph.vy = -ph.vy * 0.18;
      else ph.vy = 0;
      ph.vx *= 0.48; ph.vz *= 0.48;
      ph.wx *= 0.28; ph.wy *= 0.38; ph.wz *= 0.3;
      ph.groundT += step;
    } else ph.groundT = 0;
    const drag = Math.pow(0.3, step);
    ph.vx *= drag; ph.vz *= drag;
    ph.wx *= Math.pow(0.24, step); ph.wy *= Math.pow(0.2, step); ph.wz *= Math.pow(0.24, step);
    if (ph.vy === 0 || ph.t > 1.55) {
      const settle = Math.min(1, step * (ph.t > 2.2 ? 10 : 4.2));
      grp.rotation.x += (ph.restPitch - grp.rotation.x) * settle;
      grp.rotation.y += (ph.restYaw - grp.rotation.y) * settle;
      grp.rotation.z += (ph.restRoll - grp.rotation.z) * settle;
    }
    if ((ph.t > 2.7) || (ph.t > 1.45 && ph.vy === 0 && Math.hypot(ph.vx, ph.vz, ph.wx, ph.wy, ph.wz) < 0.45)) {
      grp.position.y = restY;
      grp.rotation.x = ph.restPitch;
      grp.rotation.y = ph.restYaw;
      grp.rotation.z = ph.restRoll;
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
    if (killerIsPlayer(by)) {
      if (CBZ.city) {
        if (a.legendary) { if (CBZ.city.note) CBZ.city.note("★ LEGENDARY " + a.species.name + " DOWN — skin it before it's gone!", 4, { urgent: true }); }
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
  function animalStrikePlayer(a, dmg, style) {
    const P = CBZ.player;
    if (!a || !P || !P.pos || P.dead) return;
    const sp = a.species || {};
    if (CBZ.cityHurtPlayer) {
      try {
        const label = (sp.name || sp.id || "animal").toLowerCase();
        CBZ.cityHurtPlayer(dmg, a.pos.x, a.pos.z,
          style === "ram" ? "rammed by a " + label : "attacked by a " + label,
          false, a, false);
      } catch (e) {}
    }
    if (style !== "ram" || P.dead) return;
    let dx = P.pos.x - a.pos.x, dz = P.pos.z - a.pos.z;
    let dl = Math.hypot(dx, dz);
    if (dl < 0.01) { dx = Math.cos(a.heading || 0); dz = Math.sin(a.heading || 0); dl = 1; }
    dx /= dl; dz /= dl;
    const scale = Math.max(1, sp.scale || 1);
    const charge = Math.max(1, sp.spd || 2.2);
    const horiz = Math.min(14.5, 7.2 + scale * 2.5 + charge * 0.8);
    const ph = P._phys = P._phys || {};
    ph.air = true; ph.down = 0; ph.kx = ph.kz = 0;
    ph.vx = dx * horiz; ph.vz = dz * horiz;
    ph.vy = Math.min(10.5, 6.6 + scale * 2.0);
    ph.spin = (Math.random() < 0.5 ? -1 : 1) * (4.6 + scale * 1.2);
    ph.spin2 = (Math.random() - 0.5) * 4;
    P.grounded = false; P.vy = 0;
    if (CBZ.shake) CBZ.shake(0.85 + scale * 0.18);
    if (CBZ.doHitstop) CBZ.doHitstop(0.045);
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
      if (sp.meat) { meatGot = 1 + ((Math.random() * (sp.meatYield || 1)) | 0); econ.add(sp.meat, meatGot); }
    }
    // a small on-the-spot field bounty on top of the sellable pelt.
    const bounty = Math.round((sp.furValue || 20) * (pristine ? 0.35 : 0.2) * (sp.rarity === "legendary" ? 3 : 1));
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
    if (CBZ.city && CBZ.city.note) CBZ.city.note("VENOM — " + sp.name + " bit you! Find an antidote or ride it out.", 3.2, { urgent: true });
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
  function huntsShared(a) {
    if (!HUNT() || !a || a.dead || a.tamed || a.ridden || a.external) return false;
    if (typeof CBZ.predatorHunt !== "function" || typeof CBZ.predatorKit !== "function") return false;
    const sp = a.species; if (!sp) return false;
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
    const trMax = ((panicTurn ? 6.5 : 3.0) / (1 + (sp.scale || 1) * 0.3)) * dt;
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
      if (!onHome && a.state !== "charge") {
        a.heading = Math.atan2(a.home.z - grp.position.z, a.home.x - grp.position.x) + (Math.random() - 0.5) * 0.6;
      } else {
        grp.position.x = nx; grp.position.z = nz; moved = true;
      }
    }
    grp.position.y = groundY(grp.position.x, grp.position.z);
    if (a.state === "stalk") grp.position.y -= 0.09 * (sp.scale || 1);   // the crouch
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
    }
    // NOTE the units contract: predatorKit multiplies sp.spd by an archetype
    // constant, which is correct for AUTHORED wildlife species (spd 1.2-4.0,
    // a "how fast is this animal" hint, not a final u/s). Nothing in this file
    // stores a resolved speed on the species, so no cruiseSpeed/rushSpeed
    // override is needed — if one ever does, override rather than let the
    // multiply happen twice.
    a._landHunt = CBZ.predatorKit(a, over) || null;
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
  function predSpecies(sp) {
    if (sp._isPred == null) {
      sp._isPred = CBZ.predatorIs
        ? !!CBZ.predatorIs({ species: sp })
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
    if ((sp.scale || 1) > (hsp.scale || 1) * PREY_MASS_MAX) return false;
    if ((sp.danger || 0) >= (hsp.danger || 0)) return false;
    return true;
  }

  // ---- CAN THIS ONE TAKE A PERSON? Rare, and gated on FACTS the species
  //      already carries plus the state of the world around the victim. A
  //      snake, a fox or a coyote never qualifies; a wolf, a big cat or a bear
  //      does, at night, when you are on your own.
  function manEater(a, hsp) {
    if ((hsp.scale || 1) < 0.85 || (hsp.danger || 0) < 0.6) return false;
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
    const hsp = a.species, hx = a.pos.x, hz = a.pos.z;
    const R = Math.max(18, senseR);
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
          const v = a._prey;
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
    const R = 34 + (hsp.scale || 1) * 12;
    const R2 = R * R;
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i], sp = a.species;
      if (a === h || a.dead || a.tamed || a.ridden || a.external || !sp) continue;
      if (!!sp.aquatic !== !!hsp.aquatic) continue;                  // a fish does not fear a wolf
      if ((sp.danger || 0) >= (hsp.danger || 0)) continue;          // peers do not flinch
      const dx = a.pos.x - hx, dz = a.pos.z - hz;
      if (dx * dx + dz * dz > R2) continue;
      a.alarm = Math.max(a.alarm || 0, amt);
      if (a.state === "wander" || a.state === "graze" || a.state === "idle") {
        a.state = "flee";
        // the QUARRY gets a shorter burst than the bystanders. It is the one
        // animal that must remain catchable, and the herd around it is the one
        // that should read as a wall going the other way.
        a.stateT = (a === h._prey ? 1.6 : ((classify(sp).fleeT || 4) + 1.5));
        a.heading = Math.atan2(dz, dx);                             // straight away from it
        a.spd = (sp.spd || 1.4) * 2.0;
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

  function startFeed(a, kill) {
    a._feedOn = kill;
    a._feedT = FEED_MIN + Math.random() * FEED_RAND;
    a._feedPh = 0; a._feedGore = 0.4;
    a._prey = null;
    if (kill && kill._huntedBy === a) kill._huntedBy = null;
  }
  function endFeed(a) {
    a._feedT = 0; a._feedOn = null;
    a._satT = SAT_MIN + Math.random() * SAT_RAND;
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
    const reach = 1.1 + (a.species.scale || 1) * 0.9;
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
    a._feedPh += dt * 0.55;
    if (CBZ.predatorPose) {
      // mass picks the beat exactly the way predatorKit picks a seize style —
      // the heavy ones tear with the whole body, the light ones worry at it.
      const style = ((a.species.scale || 1) >= 1.15) ? "maul" : "worry";
      try { CBZ.predatorPose(a, style, a._feedPh, 0.5, dt); } catch (e) {}
    }
    if (a.snake) snakeAnimate(a, dt); else gaitAnimate(a, dt);
    a._feedGore -= dt;
    if (a._feedGore <= 0) {
      a._feedGore = 1.8 + Math.random() * 2.4;
      if (CBZ.gore) {
        try { CBZ.gore(kill.pos.x, kill.pos.y + 0.2 * (kill.species.scale || 1), kill.pos.z, { amount: 0.26, player: false }); } catch (e) {}
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
      if (CHAIN() && a._prey.animal && (a._satT || 0) <= 0) {
        startFeed(a, a._prey);
        if (feedTick(a, dt)) return true;
      } else releasePrey(a);                       // a person is not carrion
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
    let o = o0, target = player, preyMode = false;
    const senseR = (o0 && o0.senseR) || 40;
    let dpl = Infinity;
    if (P && player && !player.dead) dpl = Math.hypot(grp.position.x - P.x, grp.position.z - P.z);
    if (!(dpl < senseR * 1.6)) {
      // a claim on prey is not forever. Drop it the moment the quarry is gone,
      // protected, or simply too far to be worth walking to — otherwise the
      // FIRST animal a predator ever noticed becomes the only one it will ever
      // hunt, and a wolf ignores the deer beside it to stare across the valley.
      const pv = a._prey;
      if (pv) {
        const pdx = pv.pos ? pv.pos.x - grp.position.x : 1e9;
        const pdz = pv.pos ? pv.pos.z - grp.position.z : 1e9;
        if (pv.dead || pv.inCar || pv.tamed || pv.ridden ||
            (pdx * pdx + pdz * pdz) > (senseR * 2.2) * (senseR * 2.2)) releasePrey(a);
      }
      const st0 = a._huntSt;
      // never re-pick mid-grab: the seize already owns this animal's mouth.
      if (CHAIN() && !a._seizing && (!st0 || st0 === "cruise" || st0 === "disengage")) pickPrey(a, senseR, dt);
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
      // written a.state, so this is the same frame, not one behind.
      setAggroEyes(a, a.state === "charge" ? 2 : (a.state === "stalk" ? 1 : 0));
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
        } else { a.heading = towardP; spd = (sp.spd || 1.4) * 1.6; a.moving = true; a.state = "hunt"; }
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
          a.state = "flee"; a.heading = towardP + Math.PI; spd = (sp.spd || 3) * 1.4; a.moving = true;   // mamba bolts
        } else { a.reared = !!a.rear; a.heading = towardP; a.alarm = Math.max(a.alarm, 2); }             // rear & hold ground
      } else {
        a.state = "flee"; a.heading = towardP + Math.PI + (Math.random() - 0.5) * 0.6; spd = (sp.spd || 1.4) * 1.8; a.moving = true;  // garter flees
      }
    } else {
      // wander: a slow, near-constant slither with the odd pause + turn
      a.state = "wander";
      a.turnT -= dt;
      if (a.turnT <= 0) { a.heading += (Math.random() - 0.5) * 1.2; a.turnT = 3 + Math.random() * 4; }
      spd = (sp.spd || 1.4) * 0.6; a.moving = true;
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
    setAggroEyes(a, a.state === "charge" ? 2 : (a.state === "stalk" ? 1 : 0));
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
    if (!playerGone && (a.state === "wander" || a.state === "graze" || a.state === "idle")) {
      const spookR = sp.spook || 26;
      if (danger < 0.5 && nearP < spookR * spookR) {
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
      spd = (sp.spd || 1.4) * cls.fleeM;
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
        spd = (sp.spd || 1.4) * (cls.crouch || 0.35);
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
          const reach = 1.6 + (sp.scale || 1) + 0.5;
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
                reach: reach, rate: 1.1, dmg: sp.bite || 12,
                speed: (sp.spd || 1.4) * (cls.atkM || 2.0),
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
          spd = (sp.spd || 1.4) * (cls.atkM || 2.0) * (a._burstT != null ? 1.2 : 1);
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
        const stopRoll = Math.random();
        if (stopRoll < cls.grazeP && (!hr || hr.panic <= 0.3) && a.alarm <= 0) {
          a.state = "graze";                           // stop & put the head down
          a.stateT = cls.grazeT[0] + Math.random() * (cls.grazeT[1] - cls.grazeT[0]);
          spd = 0;
        } else if (stopRoll < Math.min(0.92, cls.grazeP + 0.18) && (!hr || hr.panic <= 0.3) && a.alarm <= 0) {
          a.state = "idle";                            // stand, listen, turn, then continue
          a.stateT = 1.4 + Math.random() * 3.2;
          a._idleTurned = false;
          spd = 0;
        } else {
          a.stateT = 2 + Math.random() * 4;
          a.heading += (hr && hr.n > 1 ? 0.3 : 1.5) * (Math.random() - 0.5);
          a.spd = (sp.spd || 1.4) * cls.wanderM * (0.7 + Math.random() * 0.6);
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
      const coh = Math.min(1.1, Math.max(0, cd - 5) / 14) * (a.state === "wander" ? 1 : 1.6);
      dx += (toCx / cd) * coh; dz += (toCz / cd) * coh;
      const sepR = 2.2 + (sp.scale || 1) * 1.0;
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
    landWalk(a, a.heading, spd, dt);
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
      if (danger >= 0.5) {
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
        }
        // predators: a shot close by provokes; further out they orient/creep.
        else if (d2 < sq((cls.aggro || 16) * 1.4)) { a.state = "charge"; a.alarm = 6; }
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
      if (a._prey && !a._prey.animal) npcHunts++;   // the global predator-vs-person cap
      let pd2 = 0;
      if (P) {
        const vdx = grp.position.x - P.x, vdz = grp.position.z - P.z;
        pd2 = vdx * vdx + vdz * vdz;
        const vr = visR * ((sp.scale || 1) >= 1.3 ? 1.6 : 1);
        grp.visible = a.ridden || a.tamed || pd2 < vr * vr;
      }
      // matrix LOD: hidden animals stop paying r128's per-frame matrix math
      // (the saving staticfreeze.js was after) and thaw the moment they show.
      if (LIVE()) setLiveMats(a, grp.visible !== false);
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
        grp.scale.setScalar((sp.scale || 1) * (0.4 + 0.6 * a.grow));
        if (a.grow >= 1) a.grow = null;
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
        // APEX PREDATORS think before the LOD gate: a stalking shark hunts from
        // BEYOND the visible radius (its fin proxy is what you see, not its
        // body — city/wildlife_shark.js), so it must keep running while hidden.
        // Everything else in the sea still idles when it is out of sight.
        if (CBZ.sharkBrain && (sp.danger || 0) >= 0.5 && !a.tamed && !a.dead) {
          if (CBZ.sharkBrain(a, dt, P)) {
            faceAnimalHeading(grp, a.heading);
            if (LIVE()) animateSwim(a, dt);
            continue;                                 // the hunt owns the transform
          }
        }
        if (grp.visible === false) continue;          // far sea life idles (no sim)
        a.bob += dt * (1.2 + a.spd * 0.2);
        a.turnT -= dt;
        if (a.turnT <= 0) { a.heading += (Math.random() - 0.5) * 0.8; a.turnT = 3 + Math.random() * 4; }
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
            grp.position.x, grp.position.z, a.heading, a.spd * dt * 6,
            a.waterClearance || 12, waterTime, a._waterMove
          );
          a.heading = nav.heading;
          grp.position.x = nav.x; grp.position.z = nav.z;
          if (nav.blocked) { a.heading += 0.28; a.turnT = Math.min(a.turnT, 0.45); }
          grp.position.y = wf.surfaceY(grp.position.x, grp.position.z, waterTime)
            - (a.swimDepth || 1) + Math.sin(a.bob) * 0.055;
        } else {
          // Legacy radial-band fallback when this module is unit-loaded alone.
          const nx = grp.position.x + Math.cos(a.heading) * a.spd * dt * 6;
          const nz = grp.position.z + Math.sin(a.heading) * a.spd * dt * 6;
          const rr = Math.hypot(nx - FIELD_CX, nz - FIELD_CZ);
          if (rr < AQUATIC_R0 || rr > AQUATIC_R1) a.heading += Math.PI * 0.6;
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
          // treatment. Same law both sides now — a shark is UNDER the sea by
          // its own body depth, wherever the sea happens to be this frame,
          // surge included (CBZ.waterSeaY is live).
          const fbSurf = CBZ.citySeaHeightAt
            ? CBZ.citySeaHeightAt(grp.position.x, grp.position.z)
            : (CBZ.waterSeaY ? CBZ.waterSeaY() : -0.48);
          grp.position.y = fbSurf - (a.swimDepth || aquaticBodyDepth(sp))
            + Math.sin(a.bob) * 0.12 * (sp.scale || 1);
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
      if (grp.visible === false && (a.state === "wander" || a.state === "graze" || a.state === "idle") &&
          (a.alarm || 0) <= 0 && (a._feedT || 0) <= 0 && !hungryHunter &&
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
      if (a.state === "flee") spd = (sp.spd || 1.4) * 2.4;
      else if (a.state === "charge") spd = (sp.spd || 1.4) * 2.0;
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
          const coh = Math.min(1.1, Math.max(0, cd - 5) / 14) * (a.state === "wander" ? 1 : 1.6);
          dx += (toCx / cd) * coh; dz += (toCz / cd) * coh;
          // separation: shove away from the closest herd-mate inside ~2.6u
          const sepR = 2.2 + (sp.scale || 1) * 1.0;
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
          if (a.state === "wander") { a.heading += (hr && hr.n > 1 ? 0.3 : 1.5) * (Math.random() - 0.5); a.spd = (sp.spd || 1.4) * (0.6 + Math.random() * 0.8); }
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

  // ============================================================
  //  BUILD — stock the world once, after every biome AND the order-97 signed
  //  continent shoreline exist. Aquatic spawn validation therefore reads the
  //  exact final coast, not an incomplete region list.
  // ============================================================
  CBZ.addLandmass(function (city) {
    if (CBZ.WILDLIFE === false) return null;
    if (built) return null;
    city = city || (CBZ.city && CBZ.city.arena);
    if (!city || !city.root) return null;
    built = true;
    root = city.root;
    arena = city;                 // stash the arena for region lookups during build

    registerPelts();
    registerInteractions();
    installWraps();               // gunshot panic + blast damage (capture-and-wrap)
    spawnAll();
    recordCaps();                 // each herd's seeded size = its carrying capacity

    let breedAcc = 0;
    CBZ.onUpdate(47.1, function (dt) {
      tick(dt);
      breedAcc += (dt && dt < 0.5 ? dt : 0.016);
      if (breedAcc >= BREED_EVERY) { breedAcc = 0; breed(); }
    });
    return null;
  }, 98);

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
    const mass = Math.max(0.12, (sp.scale || 1) * (sp.scale || 1));
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
    const ids = ["wildlife:predator-charge", "wildlife:herd-charge",
                 "wildlife:snake-constrict", "wildlife:snake-strike"];
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
