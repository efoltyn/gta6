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
  // ============================================================
  function registerPelts() {
    const econ = CBZ.cityEcon; if (!econ || !econ.ITEMS) return;
    const S = CBZ.WILDLIFE_SPECIES || {};
    for (const id in S) {
      const sp = S[id];
      if (!sp.fur) continue;
      if (!econ.ITEMS[sp.fur]) {
        econ.ITEMS[sp.fur] = {
          value: sp.furValue || 20, tag: "valuable",
          luxe: sp.rarity === "legendary" || undefined,
          pelt: true, species: id,
        };
      }
      const pri = "Pristine " + sp.fur;
      if (sp.rarity !== "legendary" && !econ.ITEMS[pri]) {
        econ.ITEMS[pri] = {
          value: Math.round((sp.furValue || 20) * 2.1), tag: "valuable",
          pelt: true, pristine: true, species: id,
        };
      }
      // wild meat — a light valuable that also FEEDS your dog (see dogs.js).
      if (sp.meat && !econ.ITEMS[sp.meat]) {
        econ.ITEMS[sp.meat] = { value: sp.meatValue || 8, tag: "valuable", meat: true, species: id };
      }
    }
  }

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

  function oceanPoint(r) {
    // a point in the open-sea band, clear of every land region.
    for (let tries = 0; tries < 24; tries++) {
      const a = r() * Math.PI * 2;
      const rad = AQUATIC_R0 + r() * (AQUATIC_R1 - AQUATIC_R0);
      const x = FIELD_CX + Math.cos(a) * rad, z = FIELD_CZ + Math.sin(a) * rad;
      if (!CBZ.cityAnyRegion || !CBZ.cityAnyRegion(ARENA(), x, z, 30)) return { x, z };
    }
    return { x: FIELD_CX + 900, z: FIELD_CZ };
  }

  function makeActor(sp, x, z) {
    let grp;
    try { grp = sp.build({ THREE: THREE, mat: mat, rng: rng }); }
    catch (e) { grp = fallbackMesh(sp); }
    if (!grp) grp = fallbackMesh(sp);
    const s = sp.scale || 1;
    grp.scale.setScalar(s);
    grp.position.set(x, sp.aquatic ? 0 : groundY(x, z), z);
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
    if (LIVE()) buildGaitRig(a);          // discover legs/head for the gait & graze reads
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
      const anchor = sp.aquatic ? oceanPoint(rng) : regionPoint(regs[(rng() * regs.length) | 0], rng);
      let herd = sp.herd ? (sp.herd[0] + ((rng() * (sp.herd[1] - sp.herd[0] + 1)) | 0)) : 1;
      herd = Math.min(herd, count - placed);
      const hr = newHerd(sp);            // this cluster moves & panics as ONE unit
      for (let h = 0; h < herd; h++) {
        const jx = anchor.x + (rng() - 0.5) * (sp.aquatic ? 60 : 22);
        const jz = anchor.z + (rng() - 0.5) * (sp.aquatic ? 60 : 22);
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
      if (sp.aquatic) pt = oceanPoint(rng);
      else { const regs = biomeRegions(sp.biome); if (!regs.length) continue; pt = regionPoint(regs[(rng() * regs.length) | 0], rng); }
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
        const nx = parent.pos.x + (Math.random() - 0.5) * jit;
        const nz = parent.pos.z + (Math.random() - 0.5) * jit;
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
      try { CBZ.gore.spray(hit.point, 1); } catch (e) {}
    }
    if (a.hp <= 0) {
      // a PRISTINE pelt needs a clean kill: down in one or two hits, ideally a
      // headshot. Sloppy magazine-dumps ruin the hide (RDR2 rewards precision).
      a.cleanKill = (a.hitCount <= 1) || (a.hitCount <= 2 && !!(hit && hit.head));
      killAnimal(a, hit);
      return { head: !!(hit && hit.head), down: true, dmg: dmg };
    }
    // WOUNDED — predators charge, prey bolts. (A TAMED animal never turns on
    // its owner: it just takes the hit — shooting your own pet is on you.)
    if (a.tamed) return { head: !!(hit && hit.head), down: false, dmg: dmg };
    a.alarm = 8;
    const P = CBZ.player && CBZ.player.pos;
    if (LIVE()) {
      // a visible recoil so every hit READS (creature_combat's shudder), then
      // the wound decides: anything with teeth turns on you, prey bolts hard.
      if (!a.snake && CBZ.creatureFlinch) { try { CBZ.creatureFlinch(a); } catch (e) {} }
      const cls = classify(a.species);
      if (a.species.danger > 0.15 && P) { a.state = "charge"; a._burstT = null; }
      else {
        a.state = "flee"; a.stateT = (cls.fleeT || 4) + 2;
        if (P) a.heading = Math.atan2(a.pos.z - P.z, a.pos.x - P.x);
        a.spd = (a.species.spd || 1.4) * 2.2;
      }
    } else if (a.species.danger > 0.15 && P) { a.state = "charge"; }
    else { a.state = "flee"; if (P) { a.heading = Math.atan2(a.pos.z - P.z, a.pos.x - P.x); } a.spd = (a.species.spd || 1.4) * 2.2; }
    return { head: !!(hit && hit.head), down: false, dmg: dmg };
  };

  function killAnimal(a, hit) {
    a.dead = true; a.ko = 0; a.state = "dead"; a.hp = 0;
    a.skinnable = true; a.skinT = CARCASS_LINGER;
    if (LIVE()) setAggroEyes(a, 0);          // the light goes out
    // topple onto its side (feet were at y=0; drop + roll the group).
    const grp = a.group;
    if (LIVE()) {
      // ANIMATED fall (~0.55s ease-out) instead of an instant snap — the
      // dead branch of tick() drives it. Skinnable immediately, as before.
      a._dieT = 0.55;
      a._toppleTo = (Math.random() < 0.5 ? 1 : -1) * (1.15 + Math.random() * 0.25);
      a._dieZ0 = grp.rotation.z; a._dieX0 = grp.rotation.x;
      grp.position.y = Math.max(0, grp.position.y) + 0.05;
    } else {
      grp.rotation.z = (Math.random() < 0.5 ? 1 : -1) * (1.15 + Math.random() * 0.25);
      grp.position.y = Math.max(0, grp.position.y) + 0.05;
    }
    carcasses.push(a);
    // score/notify — a kill is a kill.
    if (CBZ.city) {
      if (a.legendary) { if (CBZ.city.note) CBZ.city.note("★ LEGENDARY " + a.species.name + " DOWN — skin it before it's gone!", 4, { urgent: true }); }
      else if (CBZ.city.note) CBZ.city.note(a.species.name + " down · walk up & hold to skin", 2.4);
    }
    if (CBZ.cityKillFeed) { try { CBZ.cityKillFeed("You", a.species.name, "hunted"); } catch (e) {} }
    // let a following dog notice the kill too (dogs.js reads this list).
  }

  // ============================================================
  //  SKINNING — the payoff. Grants the pelt (quality-scaled) + a field bounty.
  // ============================================================
  function skin(a) {
    if (!a || !a.skinnable) return;
    a.skinnable = false;
    const sp = a.species, econ = CBZ.cityEcon;
    let peltName = sp.fur, pristine = false;
    if (sp.rarity !== "legendary" && a.cleanKill && Math.random() < 0.85) { peltName = "Pristine " + sp.fur; pristine = true; }
    if (econ && econ.add) {
      econ.add(peltName, 1);
      if (sp.meat) econ.add(sp.meat, 1 + ((Math.random() * (sp.meatYield || 1)) | 0));
    }
    // a small on-the-spot field bounty on top of the sellable pelt.
    const bounty = Math.round((sp.furValue || 20) * (pristine ? 0.35 : 0.2) * (sp.rarity === "legendary" ? 3 : 1));
    if (CBZ.city && CBZ.city.addCash && bounty > 0) CBZ.city.addCash(bounty);
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(sp.rarity === "legendary" ? 8 : 1);
    // toast the haul.
    const worth = (econ && econ.ITEMS[peltName] && econ.ITEMS[peltName].value) || sp.furValue || 20;
    if (CBZ.city && CBZ.city.note) {
      CBZ.city.note("Skinned " + sp.name + " → " + peltName + " (~$" + worth + ")" + (bounty ? " +$" + bounty : ""),
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
      return { label: "🦌 " + (a.species ? a.species.name : "Carcass"), note: a.legendary ? "LEGENDARY pelt" : "field-dress the hide" };
    });
    I.register("carcass", {
      id: "carcass-skin", slot: "e", hold: true, prio: 20,
      label: function (a) { return "Skin the " + (a.species ? a.species.name : "animal"); },
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
    if (CBZ.city && CBZ.city.note) CBZ.city.note("☠ VENOM — " + sp.name + " bit you! Find an antidote or ride it out.", 3.2, { urgent: true });
  }
  function venomTick(dt) {
    const v = g._venom; if (!v || v.t <= 0) return;
    v.t -= dt; v.acc += dt;
    if (v.acc >= 1) { v.acc -= 1; if (CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(v.dps, (v.name || "Venom") + " venom"); } catch (e) {} } }
    if (v.t <= 0 && CBZ.city && CBZ.city.note) CBZ.city.note("The venom wears off.", 2);
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
    let spd = 0, nearP = Infinity, towardP = a.heading;
    if (P) { const dx = P.x - grp.position.x, dz = P.z - grp.position.z; nearP = dx * dx + dz * dz; towardP = Math.atan2(dz, dx); }
    const senseR = Math.max(sp.spook || 0, 11);
    const strikeR = sp.constrictor ? 2.5 : 2.9;

    if (P && nearP < senseR * senseR) {
      if (sp.constrictor) {
        // ANACONDA — ambush hunter: close the gap, then CONSTRICT on contact.
        if (nearP < strikeR * strikeR) {
          if (a.grabT <= 0) {
            if (CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(sp.bite || 20, a); } catch (e) {} }
            a.grabT = 0.9;
            if (CBZ.city && CBZ.city.note) CBZ.city.note("The " + sp.name + " coils around you — thrash free!", 1.6, { urgent: true });
          }
        } else { a.heading = towardP; spd = (sp.spd || 1.4) * 1.6; a.moving = true; a.state = "hunt"; }
      } else if (sp.venom || sp.danger >= 0.4) {
        // VIPER / COBRA / MAMBA — warn, then STRIKE (venom on the bite).
        if (nearP < strikeR * strikeR) {
          a.reared = !!a.rear; a.heading = towardP;
          if (a.strikeT <= 0) {
            a.strikeAnim = 1; a.strikeT = 1.6;
            if (CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(sp.bite || 12, a); } catch (e) {} }
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

    if (spd > 0 && !a.reared) {
      const nx = grp.position.x + Math.cos(a.heading) * spd * dt;
      const nz = grp.position.z + Math.sin(a.heading) * spd * dt;
      const reg = CBZ.cityNearestRegion && CBZ.cityNearestRegion(ARENA(), nx, nz, 40);
      const onHome = reg && reg.biome === sp.biome && CBZ.cityRegionHit(reg, nx, nz, 4);
      if (onHome) { grp.position.x = nx; grp.position.z = nz; grp.position.y = groundY(nx, nz); }
      else { a.heading = Math.atan2(a.home.z - grp.position.z, a.home.x - grp.position.x) + (Math.random() - 0.5) * 0.6; a.moving = false; }
    }
    faceAnimalHeading(grp, a.heading);
    snakeAnimate(a, dt);
  }

  // ============================================================
  //  THE LIVING STATE MACHINE (CBZ.CONFIG.WILDLIFE_LIVE) — graze / wander /
  //  flee / stalk / charge, with flinch as an overlay and dying animated in
  //  the dead branch. The legacy block further down is untouched and runs
  //  verbatim when the flag is off.
  // ============================================================
  const HUNTER_CAP = 3;            // at most this many predators hunt YOU at once
  let hunters = 0;                 // recounted at the top of every tick
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
    a.stateT = (a.stateT || 0) - dt;
    a.turnT -= dt;
    const hr = a.herd, danger = sp.danger || 0;
    let nearP = Infinity, dpx = 0, dpz = 0;
    if (P) { dpx = grp.position.x - P.x; dpz = grp.position.z - P.z; nearP = dpx * dpx + dpz * dpz; }
    const playerGone = !P || (CBZ.player && CBZ.player.dead);

    // HERD PANIC RIPPLE — one spooked member carries the whole herd.
    if (hr && hr.panic > 0.3 && (a.state === "wander" || a.state === "graze" || a.state === "idle") && a.alarm <= 0.1) {
      a.alarm = Math.max(a.alarm, hr.panic * 0.85);
      if (danger >= 0.5) { a.state = "charge"; }
      else { a.state = "flee"; a.stateT = cls.fleeT; a.heading = hr.heading; }   // flee WITH the herd
    }

    // SENSES — calm animals notice you: prey bolts, hunters commit (capped).
    if (!playerGone && (a.state === "wander" || a.state === "graze" || a.state === "idle")) {
      const spookR = sp.spook || 26;
      if (danger < 0.5 && nearP < spookR * spookR) {
        a.state = "flee"; a.stateT = cls.fleeT; a.alarm = Math.max(a.alarm, 4);
        a.heading = Math.atan2(dpz, dpx);                       // away from you
      } else if (danger >= 0.5) {
        const trig = (sp._stalk && sp._stalk.trig) || cls.stalk;
        if (nearP < sq(cls.aggro || 16) && hunters < HUNTER_CAP) { a.state = "charge"; a.alarm = 6; hunters++; }
        else if (trig && nearP < sq(trig) && hunters < HUNTER_CAP && grp.visible !== false) { a.state = "stalk"; hunters++; }
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
              o = a._atkOpts = {
                reach: reach, rate: 1.1, dmg: sp.bite || 12,
                speed: (sp.spd || 1.4) * (cls.atkM || 2.0),
                onHit: function (d2) { if (CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(d2, a); } catch (e) {} } },
              };
              const style = CBZ.creatureStyleFor ? CBZ.creatureStyleFor(sp) : null;
              if (style === "gore" || style === "stomp") o.rate = 1.3;   // heavy hitters swing slower
              if (sp.id === "cheetah") o.rate = 0.9;
            }
            CBZ.creatureFight(a, PT, dt, o);
            a.faceH = a.heading;                       // it steers facing itself — stay in sync
            return;                                    // creatureFight owns the transform this frame
          }
          spd = (sp.spd || 1.4) * (cls.atkM || 2.0) * (a._burstT != null ? 1.2 : 1);
          a.heading = Math.atan2(-dpz, -dpx);
          // fallback contact bite if creature_combat isn't around (legacy rule)
          if (!CBZ.creatureFight && nearP < 3.2 * 3.2 && CBZ.cityHurtPlayer && (a._biteT || 0) <= 0) {
            try { CBZ.cityHurtPlayer(sp.bite || 10, a); } catch (e) {}
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

    // ---- FACING: a.heading is only the DESIRE. The body turns toward it at
    //      a clamped rate (slower for big animals, faster in a panic) and the
    //      animal MOVES ALONG ITS FACING — so every direction change is an
    //      arc, never a pivot-slide, a moonwalk, or a sideways glide.
    if (a.faceH == null) a.faceH = a.heading;
    let fd = a.heading - a.faceH;
    while (fd > Math.PI) fd -= 2 * Math.PI; while (fd < -Math.PI) fd += 2 * Math.PI;
    const panicTurn = a.state === "flee" || a.state === "charge";
    const trMax = ((panicTurn ? 6.5 : 3.0) / (1 + (sp.scale || 1) * 0.3)) * dt;
    if (fd > trMax) fd = trMax; else if (fd < -trMax) fd = -trMax;
    a.faceH += fd;

    // integrate ALONG THE FACING + home fence + ground + the gait layer
    if (spd > 0) {
      const nx = grp.position.x + Math.cos(a.faceH) * spd * dt;
      const nz = grp.position.z + Math.sin(a.faceH) * spd * dt;
      const reg = CBZ.cityNearestRegion && CBZ.cityNearestRegion(ARENA(), nx, nz, 40);
      const onHome = reg && (reg.biome === sp.biome) && CBZ.cityRegionHit(reg, nx, nz, 6);
      if (!onHome && a.state !== "charge") {
        // steer back toward home anchor instead of leaving the biome (the
        // clamped facing turns the step into an arc back inside).
        a.heading = Math.atan2(a.home.z - grp.position.z, a.home.x - grp.position.x) + (Math.random() - 0.5) * 0.6;
      } else {
        grp.position.x = nx; grp.position.z = nz;
      }
    }
    grp.position.y = groundY(grp.position.x, grp.position.z);
    if (a.state === "stalk") grp.position.y -= 0.09 * (sp.scale || 1);   // the crouch
    faceAnimalHeading(grp, a.faceH);
    // settle any leftover attack pitch back to rest while roaming
    if (grp.rotation.x !== 0 && (a._atkAnim == null || a._atkAnim < 0)) grp.rotation.x *= Math.max(0, 1 - dt * 6);
    gaitAnimate(a, dt);
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
        // predators: a shot close by provokes; further out they orient/creep.
        if (d2 < sq((cls.aggro || 16) * 1.4) && hunters < HUNTER_CAP) { a.state = "charge"; a.alarm = 6; hunters++; }
        else if (cls.stalk && hunters < HUNTER_CAP && a.group.visible !== false) { a.state = "stalk"; hunters++; }
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
      const dx = a.pos.x - x, dz = a.pos.z - z, d2 = dx * dx + dz * dz;
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
    venomTick(dt);                 // poison keeps draining after a venomous bite
    updateHerds(dt);               // live centroid + mean heading + herd alarm
    if (!wrapsOk) installWraps();  // retry until the combat hooks exist (idempotent)
    if (SHOT.win > 0) SHOT.win -= dt;   // repeated-gunshot window cools here
    // recount the predators currently committed to the player (stalk/charge)
    // so the HUNTER_CAP can bound both the dogpile and the per-frame cost.
    hunters = 0;
    if (LIVE()) {
      for (let i = 0; i < animals.length; i++) {
        const st = animals[i].state;
        if (!animals[i].dead && !animals[i].external && (st === "charge" || st === "stalk")) hunters++;
      }
    }
    // LOD visibility rides the ONE quality knob (the pause-menu perf/quality
    // tier): animals beyond the tier's radius don't render or animate their
    // meshes — same pattern as the ped rig LOD. Big species read farther
    // (you SHOULD spot an elephant across the savanna before a rabbit).
    const q = CBZ.qualityLevel != null ? CBZ.qualityLevel : ANIMAL_VIS.length - 1;
    const visR = ANIMAL_VIS[Math.max(0, Math.min(ANIMAL_VIS.length - 1, q))];
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i], sp = a.species, grp = a.group;
      if (a.external) continue;      // dogs: in the registry for the GUNS, driven by dogs.js
      if (P) {
        const vdx = grp.position.x - P.x, vdz = grp.position.z - P.z;
        const vr = visR * ((sp.scale || 1) >= 1.3 ? 1.6 : 1);
        grp.visible = a.ridden || a.tamed || (vdx * vdx + vdz * vdz) < vr * vr;
      }
      // matrix LOD: hidden animals stop paying r128's per-frame matrix math
      // (the saving staticfreeze.js was after) and thaw the moment they show.
      if (LIVE()) setLiveMats(a, grp.visible !== false);
      if (a.dead) {
        // animated death topple (WILDLIFE_LIVE): ease onto the side.
        if (a._dieT != null) {
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
      if (a.ridden) { if (LIVE()) gaitAnimate(a, dt); continue; }   // glued under the rider
      if (a.tamed && !sp.aquatic) {
        if (CBZ.cityTameFollow) CBZ.cityTameFollow(a, dt);
        if (a.snake) { a.moving = true; snakeAnimate(a, dt); }
        else if (LIVE()) gaitAnimate(a, dt);
        continue;
      }
      // ---- SNAKES slither (own locomotion + strike/rear/constrict logic) --
      if (a.snake) { snakeTick(a, dt, P); continue; }
      // ---- aquatic: cruise the sea band, dorsal bob, loop back inward -----
      if (sp.aquatic) {
        if (grp.visible === false) continue;          // far sea life idles (no sim)
        a.bob += dt * (1.2 + a.spd * 0.2);
        a.turnT -= dt;
        if (a.turnT <= 0) { a.heading += (Math.random() - 0.5) * 0.8; a.turnT = 3 + Math.random() * 4; }
        const nx = grp.position.x + Math.cos(a.heading) * a.spd * dt * 6;
        const nz = grp.position.z + Math.sin(a.heading) * a.spd * dt * 6;
        const rr = Math.hypot(nx - FIELD_CX, nz - FIELD_CZ);
        if (rr < AQUATIC_R0 || rr > AQUATIC_R1) a.heading += Math.PI * 0.6;      // turn back into the band
        else { grp.position.x = nx; grp.position.z = nz; }
        grp.position.y = Math.sin(a.bob) * 0.12 * (sp.scale || 1);
        faceAnimalHeading(grp, a.heading);
        continue;
      }
      // ---- FAR + CALM land animals FREEZE (no per-frame steering) so a big
      //      world stays cheap — only the herds near you actually think & move.
      //      They resume instantly when you approach, or if their herd panics.
      //      Hot states (flee/charge/stalk) keep running off-screen so a shot
      //      herd genuinely LEAVES instead of pausing at the horizon.
      if (grp.visible === false && (a.state === "wander" || a.state === "graze" || a.state === "idle") &&
          (a.alarm || 0) <= 0 &&
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
        // a charging predator that reaches you bites (light contact damage).
        if (nearP < 3.2 * 3.2 && CBZ.cityHurtPlayer && (a._biteT || 0) <= 0) {
          try { CBZ.cityHurtPlayer((sp.bite || 10), a); } catch (e) {}
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
  //  BUILD — stock the world once, after every biome region exists.
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
  }, 95);

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
})();
