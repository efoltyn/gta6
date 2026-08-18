/* ============================================================
   city/wildlife_tame.js — TAME ANY ANIMAL · RIDE THE BIG ONES.

   Every living animal in the bestiary can be WON OVER by feeding it, exactly
   like the dogs: hold food out (predators demand MEAT you hunted; herbivores
   take any food item) enough times and the animal is YOURS — it gets a name,
   stops fearing you, follows at heel (never teleports — it runs), and can be
   told to stay. Babies are tameable too (the cutest pets in the game).

   And every moving animal is RIDEABLE. Land animals use the shared grounded
   player root; aquatic animals use the same ownership seam with a water-column
   controller (rise/dive, momentum, shoreline avoidance and real breaches):
   horses and zebras obviously, but also elephants, rhinos, giraffes, bison,
   moose, elk, caribou, cows, all three bears, lions, tigers, cheetahs — even
   the legendary White Stag, White Lion and Snow Leopard if you manage to tame
   one instead of shooting it. Mount a tamed adult ([I] in the panel) and YOUR
   movement becomes the mount's: the animal is glued under you with a gallop or
   swim gait, and speed is derived from the species (a cheetah is the fastest
   thing on land; a dolphin turns a surface run into a huge ballistic breach).

   AND A TAMED ANIMAL IS A COMPANION, NOT A FOLLOWER DOT. `CBZ.petFollow` (see
   THE AFFECTION LOOP, below) is the ONE heel/go-to/sit brain in the game —
   dogs.js drives its dogs through it too — and a separate pass at order 47.45
   POSES them: when you stand still they arc round in front of you, sit, and
   watch you, with the sit solved out of each species' own discovered leg rig
   and no species table anywhere in it.

   HOW RIDING PLUGS IN (no parallel ownership): physics.js owns land mounts and
   delegates an aquatic mount to cityAquaticMountStep before on-foot collision.
   The latter uses waterField's canonical shore oracle and swim.js takes the
   body back on dismount. A late visual pass places both animal and rider from
   that one shared root; camera, regions and input continue following player.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const g = CBZ.game;

  const REACH = 4.2;             // interaction reach for live animals
  const HEEL_R = 6.5;            // tamed follower stops this close
  const FOLLOW_MULT = 2.1;       // tamed follower hustle (× species wander spd)

  // ---- ANIMALS_ALL_CONTROLLABLE — the one-line revert for the "every animal
  // can be controlled" overhaul. ON (default): deer-class + farm stock join
  // the rideable roster, WILD rideable animals offer a bronco "try to mount",
  // tamed animals take a GO-TO command ("send ahead"), and aquatic life is
  // interactive (feed/tame/pet when you swim up to it; a tamed dolphin swims
  // with you — see wildlife.js). OFF: exactly the old tame/ride behavior.
  if (CBZ.CONFIG && CBZ.CONFIG.ANIMALS_ALL_CONTROLLABLE == null) CBZ.CONFIG.ANIMALS_ALL_CONTROLLABLE = true;
  function ALLCTL() { return !(CBZ.CONFIG && CBZ.CONFIG.ANIMALS_ALL_CONTROLLABLE === false); }

  function groundY(x, z) { return (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) || 0; }
  function animals() { return CBZ.cityWildlife || []; }
  function note(msg, sec, o) { if (CBZ.city && CBZ.city.note) CBZ.city.note(msg, sec, o); }
  function faceAnimal(a, heading) {
    a.heading = heading; a.faceH = heading;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(a, heading);
    else if (a.group) a.group.rotation.y = -heading;
  }

  const NAMES = ["Willow", "Atlas", "Clover", "Ember", "Biscuit", "Storm", "Maple", "Titan", "Pepper", "Juniper", "Boulder", "Honey", "Comet", "Sage", "Thunder", "Mochi"];

  // ============================================================
  //  RIDEABLE — every species big enough to carry a person, with its legacy
  //  feet-height fallback and gait multiplier. The real seated socket is
  //  discovered from the built animal geometry by animalSaddle() below.
  // ============================================================
  const RIDEABLE = {
    horse:            { y: 1.55, mult: 2.3 },
    zebra:            { y: 1.45, mult: 2.25 },
    cow:              { y: 1.45, mult: 1.4 },
    bison:            { y: 1.85, mult: 1.8 },
    moose:            { y: 1.95, mult: 2.0 },
    caribou:          { y: 1.55, mult: 2.0 },
    elk:              { y: 1.6,  mult: 2.05 },
    wild_boar:        { y: 1.0,  mult: 1.7 },
    giraffe:          { y: 2.7,  mult: 1.9 },
    african_elephant: { y: 3.3,  mult: 1.5 },
    white_rhino:      { y: 1.8,  mult: 1.9 },
    black_bear:       { y: 1.5,  mult: 1.75 },
    brown_bear:       { y: 1.65, mult: 1.8 },
    polar_bear:       { y: 1.75, mult: 1.85 },
    lion:             { y: 1.15, mult: 2.2 },
    bengal_tiger:     { y: 1.1,  mult: 2.25 },
    cheetah:          { y: 0.9,  mult: 2.7 },   // the fastest thing on land
    bighorn_sheep:    { y: 1.05, mult: 1.8 },
    mountain_goat:    { y: 1.0,  mult: 1.8 },
    // legendaries — tame one instead of shooting it and it's the best mount alive
    white_stag:       { y: 1.7,  mult: 2.45 },
    white_lion:       { y: 1.25, mult: 2.3 },
    snow_leopard:     { y: 0.95, mult: 2.5 },
  };
  // deer-class + the rest of the farm stock (ANIMALS_ALL_CONTROLLABLE): every
  // land animal big enough to take a rider is a mount — a whitetail is a
  // skittish fast ride, a pig/sheep a slow barnyard joke that still WORKS.
  // The y values remain compatibility fallbacks; live backs are measured.
  const RIDEABLE_EXTRA = {
    whitetail_deer: { y: 1.4,  mult: 2.15 },
    pig:            { y: 0.9,  mult: 1.35 },
    sheep:          { y: 1.2,  mult: 1.35 },
    goat:           { y: 0.95, mult: 1.55 },
  };
  // AQUATIC RIDE PROFILES ARE GENERATED FROM THE SPECIES ROW. There must never
  // be a second roster that lets a newly-authored fish move but makes it
  // untouchable on iPad: `aquatic:true` is the capability declaration. Speed is
  // the same authored `sp.spd` the wild swim mover reads, converted once into
  // metres/second; scale slows turning instead of silently banning huge bodies.
  const AQUATIC_RIDES = Object.create(null);
  function aquaticRideDef(sp) {
    if (!sp || !sp.aquatic || !ALLCTL()) return null;
    if (AQUATIC_RIDES[sp.id]) return AQUATIC_RIDES[sp.id];
    const id = String(sp.id || "aquatic");
    const scale = Math.max(0.25, sp.scale || 1);
    const cruise = Math.max(5.5, Math.min(16, (sp.spd || 1.5) * 4));
    const hunter = !!(sp.bite > 0) || /shark|megalodon|orca|barracuda/.test(id);
    return (AQUATIC_RIDES[sp.id] = {
      y: Math.max(0.45, 0.92 * scale),
      mult: cruise / (((CBZ.TUNE && CBZ.TUNE.walkSpeed) || 6.4)),
      aquatic: true,
      cruise: cruise,
      sprint: cruise * (id === "dolphin" ? 1.78 : 1.56),
      turn: Math.max(0.75, 3.8 / (0.65 + scale * 0.55)),
      rise: Math.max(3.1, Math.min(6.5, cruise * 0.38)),
      dive: Math.max(3.5, Math.min(7.2, cruise * 0.42)),
      breach: id === "dolphin",
      breachVel: id === "dolphin" ? 15.5 : 0,
      attack: hunter,
      shipBite: id === "megalodon",
    });
  }
  // THE one rideable lookup — every gate below goes through this, so the
  // extra roster and every current/future aquatic are a single-flag revert.
  function rideDef(sp) {
    if (!sp || !sp.id) return null;
    return RIDEABLE[sp.id] || (ALLCTL() ? RIDEABLE_EXTRA[sp.id] : null) || aquaticRideDef(sp) || null;
  }

  // Mount jump impulse is species-owned. Light, athletic animals clear more;
  // elephants/rhinos/bison produce a heavy hop instead of borrowing the exact
  // human jump. The shared physics integrator still owns gravity/collision.
  function rideJump(sp) {
    if (!sp) return 6.2;
    const water = aquaticRideDef(sp);
    if (water) return water.breachVel || water.rise;
    const id = sp.id || "", scale = Math.max(0.7, sp.scale || 1);
    if (/elephant/.test(id)) return 3.7;
    if (/giraffe|rhino|bison/.test(id)) return 4.8;
    if (/cow|pig|sheep|goat|boar/.test(id)) return 5.4;
    if (/lion|tiger|cheetah|leopard/.test(id)) return 7.4;
    return Math.max(5.5, Math.min(7.2, 7.0 - Math.max(0, scale - 1) * 0.7));
  }

  // Discover the main back-bearing body in the ANIMAL'S local frame. The old
  // RIDEABLE.y numbers were written for a WALKING avatar's feet; treating one
  // as a seated hip socket buried the rider inside tall animals (completely
  // under a giraffe's belly) and behind a bison's hump. A saddle is geometry:
  // choose the longest substantial horizontal mesh, then use the centre of
  // its actual top face for X/Y and its depth for leg spread. Long legs,
  // antlers, necks and decorative stripes lose naturally because none has the
  // body mesh's length-squared footprint.
  function animalSaddle(group, sp, fallbackY) {
    const fallbackScale = (sp && sp.scale) || 1;
    const fallback = {
      x: 0,
      y: (fallbackY || 1.2) * fallbackScale,
      width: 0.7 * fallbackScale,
      length: 1.5 * fallbackScale,
    };
    if (!group || !THREE.Box3 || !THREE.Matrix4 || !THREE.Vector3) return fallback;
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const rel = new THREE.Matrix4(), local = new THREE.Box3();
    let best = null;
    group.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (!o.geometry.boundingBox) return;
      rel.multiplyMatrices(inv, o.matrixWorld);
      local.copy(o.geometry.boundingBox).applyMatrix4(rel);
      const dx = local.max.x - local.min.x;
      const dy = local.max.y - local.min.y;
      const dz = local.max.z - local.min.z;
      if (dx < 0.3 || dy < 0.14 || dz < 0.22) return;
      const score = dx * dx * dz;
      if (best && score <= best.score) return;
      const top = o.geometry.boundingBox.getCenter(new THREE.Vector3());
      top.y = o.geometry.boundingBox.max.y;
      top.applyMatrix4(rel);
      best = { score: score, top: top, depth: dz, length: dx };
    });
    if (!best) return fallback;
    const sx = Math.abs(group.scale.x) || fallbackScale;
    const sy = Math.abs(group.scale.y) || fallbackScale;
    const sz = Math.abs(group.scale.z) || fallbackScale;
    return {
      x: best.top.x * sx,
      y: best.top.y * sy,
      width: Math.max(0.48, best.depth * sz),
      length: best.length * sx,
    };
  }

  function rideVisualSpec(sp, group) {
    const R = rideDef(sp);
    if (!R) return null;
    const socket = animalSaddle(group, sp, R.y);
    // Aquatic bodies carry a dorsal exactly where the centre of the longest
    // torso mesh lies. Move the socket toward the nose by a fraction of that
    // measured torso length so a rider sits on the back in FRONT of the fin,
    // rather than intersecting it. This remains geometry-derived for rays,
    // turtles, fish, cetaceans and sharks—there is no per-species seat table.
    const aquaticForward = R.aquatic ? Math.min(2.1, (socket.length || 0) * 0.19) : 0;
    return {
      x: socket.x + aquaticForward, y: socket.y, mult: R.mult, jump: rideJump(sp), width: socket.width,
      aquatic: !!R.aquatic, cruise: R.cruise || 0, sprint: R.sprint || 0,
      turn: R.turn || 0, rise: R.rise || 0, dive: R.dive || 0,
      breach: !!R.breach, attack: !!R.attack, shipBite: !!R.shipBite,
    };
  }
  CBZ.cityRideDefinition = function (sp) {
    const R = rideDef(sp); return R ? {
      y: R.y, mult: R.mult, jump: rideJump(sp), aquatic: !!R.aquatic,
      cruise: R.cruise || 0, sprint: R.sprint || 0, breach: !!R.breach,
      attack: !!R.attack, shipBite: !!R.shipBite,
    } : null;
  };
  CBZ.cityRideVisualSpec = function (actorOrSpecies, group) {
    const sp = actorOrSpecies && (actorOrSpecies.species || actorOrSpecies);
    return rideVisualSpec(sp, group || (actorOrSpecies && actorOrSpecies.group));
  };

  // ============================================================
  //  FEEDING / TAMING — predators take hunted MEAT, herbivores any food.
  // ============================================================
  function isPredator(sp) { return (sp.danger || 0) >= 0.3; }
  function feedItemFor(sp) {
    const econ = CBZ.cityEcon, inv = g.cityInv || {};
    if (!econ || !econ.ITEMS) return null;
    for (const k in inv) {
      if ((inv[k] | 0) <= 0) continue;
      const it = econ.ITEMS[k]; if (!it) continue;
      if (isPredator(sp) ? it.meat : (it.tag === "food" || it.meat)) return k;
    }
    return null;
  }
  function feedsNeeded(sp) {
    if (sp.rarity === "legendary") return 7;                        // earn it
    return 2 + Math.round((sp.danger || 0) * 3) + ((sp.scale || 1) >= 1.2 ? 1 : 0);
  }
  function tameFeed(a) {
    const sp = a.species, item = feedItemFor(sp);
    if (!item) { note(isPredator(sp) ? "It only wants MEAT, hunt some first." : "You need food to offer.", 2); return; }
    const econ = CBZ.cityEcon;
    if (econ && econ.take) econ.take(item, 1);
    a.feeds = (a.feeds || 0) + 1;
    a.state = "wander"; a.alarm = 0;                                // food calms it
    const need = feedsNeeded(sp);
    if (a.feeds >= need) {
      a.tamed = true; a.petName = NAMES[(Math.random() * NAMES.length) | 0];
      a.stay = false;
      note("The " + sp.name + " is yours! Meet " + a.petName +
        (rideDef(sp) ? (a.grow != null ? " · rideable once it grows up." : " · you can RIDE it.") : "."),
        3.6, sp.rarity === "legendary" ? { urgent: true } : undefined);
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(sp.rarity === "legendary" ? 10 : 2);
    } else {
      note("The " + sp.name + " takes the " + item + "… (" + a.feeds + "/" + need + ")", 2);
    }
  }

  // ============================================================
  //  TAMED FOLLOW — called from wildlife.js's tick for every tamed land
  //  animal. NEVER teleports: however far you get, it runs your way.
  // ============================================================
  // clamped-turn step along a HEADING: the body swings toward the desire at a
  // bounded rate and always MOVES ALONG ITS FACING — arcs, never pivot-snaps
  // or sideways glides (the same facing model the wild state machine uses).
  // This is also THE LOCOMOTION SEAM the shared companion brain steers through
  // (dogs.js hands it its own dogMove), so "how a body moves" stays with the
  // file that owns the body and "where it should be" is decided once.
  function stepHeading(a, heading, spd, dt, panic) {
    const grp = a.group, sp = a.species || EMPTY;
    if (a.faceH == null) a.faceH = (a.heading == null ? heading : a.heading);
    let fd = wrapPi(heading - a.faceH);
    const mx = ((panic ? 7 : 4.2) / (1 + (sp.scale || 1) * 0.25)) * dt;
    if (fd > mx) fd = mx; else if (fd < -mx) fd = -mx;
    a.faceH += fd; a.heading = a.faceH;
    if (spd > 0) {
      grp.position.x += Math.cos(a.faceH) * spd * dt;
      grp.position.z += Math.sin(a.faceH) * spd * dt;
    }
    grp.position.y = groundY(grp.position.x, grp.position.z);
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(a, a.faceH);
    else grp.rotation.y = -a.faceH;
  }
  function steppedMove(a, tx, tz, spd, dt, panic) {
    stepHeading(a, Math.atan2(tz - a.group.position.z, tx - a.group.position.x), spd, dt, panic);
  }

  // ============================================================
  //  THE AFFECTION LOOP — a tamed animal is a COMPANION, not a follower dot.
  //
  //  OWNER (voice, 2026-07-28): "I killed a wild boar, and also tamed a wild
  //  boar. When you tame an animal, they should stay around you. They should
  //  stick with you. They should, like, sit in front of you and look at you
  //  and follow you. It's already, I think, kinda built for dogs."
  //
  //  He is right that it was built for dogs — TWICE, and neither copy ever sat.
  //  dogs.js and this file each carried their own heel, their own go-to and
  //  their own "stand still and face you", with different arrival radii and
  //  different notes; and dogs.js's "Sit & stay" verb only STOPPED the animal
  //  — it never folded a haunch, so a dog that was told to sit stood there.
  //  So this is one brain, not a third one: CBZ.petFollow() is the ONE
  //  heel/go-to/sit decision and both files call it through their own move
  //  seam, and the POSE runs on its own pass (order 47.45) AFTER every driver
  //  has finished moving its animal — the only place in the frame where a leg
  //  write is the last word for a dog AND for wildlife.
  //
  //  NO SPECIES TABLE — the sit is solved out of the rig wildlife.js already
  //  discovered (a.gait.cols / a.gait.head; dogs' flat userData.legs is the
  //  same rig one level less nested). The body pitches nose-up, the group
  //  drops by exactly the arc the FRONT paws would have risen through, and the
  //  HIND columns fold by the arc they would have sunk through. The pitch is
  //  an INEQUALITY, not a taste: a hind leg cannot fold further than it is
  //  long, so pitch <= asin(legH * 0.85 / (reachF + reachR)). An animal whose
  //  rig cannot answer that — a snake, a fish, a bird with no hind column — is
  //  never bent into a fake sit; it holds a settled idle and looks at you.
  // ============================================================

  // ---- PET_AFFECTION — the one-line revert for the whole loop. OFF: exactly
  // the old heel/stay/go-to, dogs on their own copy of it, and no pose at all.
  if (CBZ.CONFIG && CBZ.CONFIG.PET_AFFECTION == null) CBZ.CONFIG.PET_AFFECTION = true;
  function PETS() { return !(CBZ.CONFIG && CBZ.CONFIG.PET_AFFECTION === false); }

  const EMPTY = {};
  const TAU = Math.PI * 2;
  const SIT_WAIT_MIN = 1.5;   // s of PLAYER stillness before the ritual begins
  const SIT_WAIT_VAR = 1.0;   // ..+ up to this, jittered per pet so they differ
  const FRONT_D      = 2.05;  // how far in front of you it settles (+ its bulk)
  const AVOID_R      = 1.55;  // it walks AROUND you — never through you
  const SIT_IN       = 0.55;  // s to fold into the sit
  const SIT_OUT      = 0.28;  // s to stand back up
  const SIT_ARRIVE   = 0.55;  // m from the spot that counts as arrived
  const SIT_REDO     = 1.7;   // m the spot may drift before it circles again
  const CATCHUP_R    = 70;    // past this it MAY relocate — only where unseen
  const BEAT_NEAR    = 60;    // beats + pose are skipped past this (free by distance)
  const SEP_R        = 1.45;  // two companions never try to stand in one place

  function wrapPi(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function ease(t) { return t <= 0 ? 0 : (t >= 1 ? 1 : t * t * (3 - 2 * t)); }
  function stepTo(cur, want, step) {
    if (cur < want) { cur += step; return cur > want ? want : cur; }
    if (cur > want) { cur -= step; return cur < want ? want : cur; }
    return cur;
  }

  // ---- WHAT THE PLAYER IS DOING, answered ONCE per frame -------------------
  // Every companion asks the same three questions (are you moving, how fast,
  // which way are you facing) and none of them should ask it separately. This
  // runs at 46.9, i.e. before wildlife.js's tick (47.1) reads it.
  const PL = { has: false, x: 0, z: 0, spd: 0, still: 0, yaw: 0, fx: 0, fz: -1, eyeY: 0 };
  function trackPlayer(dt) {
    if (!dt || dt > 0.5) dt = 0.05;
    const P = CBZ.player;
    if (!P || !P.pos) { PL.has = false; PL.still = 0; return; }
    const p = P.pos;
    if (PL.has) {
      const step = Math.hypot(p.x - PL.x, p.z - PL.z);
      PL.spd += (step / Math.max(1e-3, dt) - PL.spd) * Math.min(1, dt * 9);
      // INTENT counts as movement even when a wall eats the step: player.speed
      // is the DESIRED ground speed physics.js solved this frame.
      if (step > dt * 0.42 || (P.speed || 0) > 0.4) PL.still = 0;
      else PL.still += dt;
    }
    PL.x = p.x; PL.z = p.z; PL.has = true;
    PL.eyeY = p.y + (P.crouch ? 1.05 : 1.62);
    const yaw = (CBZ.cam && CBZ.cam.yaw) || 0;
    PL.yaw = yaw; PL.fx = -Math.sin(yaw); PL.fz = -Math.cos(yaw);   // physics.js's own basis
    if (P.dead || P.driving) PL.still = 0;
  }
  CBZ.onUpdate(46.9, trackPlayer);

  // ---- the companion registry (O(pets), never O(world)) --------------------
  const REG = [];
  let SLOT_N = 0, WARPS = 0, WARPS_REF = 0;
  const ADOPTED = {}, LEGACY = {};
  CBZ.petAdopt = function (id) { if (id) ADOPTED[id] = 1; };
  CBZ.petLegacy = function (id) { if (id) LEGACY[id] = 1; };

  function petRegister(pet) {
    if (pet._petReg) return;
    pet._petReg = true;
    pet._petSlot = (SLOT_N++) % 8;
    pet._sitWait = SIT_WAIT_MIN + Math.random() * SIT_WAIT_VAR;   // runtime only
    pet._sitK = 0; pet._petPhase = "none"; pet._petT = 0;
    pet._beatT = 1.5 + Math.random() * 4;
    pet._beatK = 0; pet._beatP = 0; pet._breathe = Math.random() * TAU;
    REG.push(pet);
  }
  function petNameOf(pet) {
    return pet.petName || pet.name || (pet.species && pet.species.name) || "your companion";
  }
  // Each companion holds its OWN bearing off your heading, so two of them fan
  // into an arc at your back instead of stacking into one animal.
  function slotAngle(pet) {
    const s = pet._petSlot | 0;
    if (s === 0) return 0;
    const tier = Math.ceil(s / 2);
    return ((s % 2) ? 1 : -1) * (0.42 + 0.40 * (tier - 1));
  }
  // Shared return — read it IMMEDIATELY (creature_combat's RES discipline).
  // The keep-apart distance is the SUM of both animals' bulk over the baseline,
  // so two terriers stand shoulder to shoulder and two elephants do not try to
  // occupy the same three metres of ground.
  const SEPV = { x: 0, z: 0 };
  function girth(p) { return Math.max(0, ((p.species && p.species.scale) || 1) - 0.8) * 1.2; }
  function separate(pet, tx, tz) {
    SEPV.x = tx; SEPV.z = tz;
    const mine = girth(pet);
    for (let i = 0; i < REG.length; i++) {
      const o = REG[i]; if (o === pet || !o.tamed || o.dead) continue;
      const op = o.pos || (o.group && o.group.position); if (!op) continue;
      const r = SEP_R + mine + girth(o);
      const ox = SEPV.x - op.x, oz = SEPV.z - op.z, q = ox * ox + oz * oz;
      if (q > 1e-6 && q < r * r) {
        const dd = Math.sqrt(q), push = (r - dd) * 0.85;
        SEPV.x += (ox / dd) * push; SEPV.z += (oz / dd) * push;
      }
    }
    return SEPV;
  }
  // A ROUTE THAT NEVER CROSSES YOU. If the straight line to the spot passes
  // inside AVOID_R of the player it is refused and a tangent on the ring is
  // walked instead — recomputed every frame, which is what makes it read as an
  // arc rather than a waypoint. This is also why a companion never clips you.
  function arcHeading(pos, P, tx, tz, avoid) {
    const R = avoid || AVOID_R;
    const dx = tx - pos.x, dz = tz - pos.z;
    const straight = Math.atan2(dz, dx);
    const ap = Math.atan2(pos.z - P.z, pos.x - P.x);      // where it stands, around you
    const at = Math.atan2(tz - P.z, tx - P.x);            // where it is going, around you
    const sweep = wrapPi(at - ap);
    // TERMINATION FIRST. Nearly the same bearing around you means the straight
    // line is RADIAL and cannot cross you, so take it. Without this rule an
    // animal whose no-go ring is nearly as wide as its own sit distance (an
    // elephant: 3.1 m ring, 4.0 m spot) finds every chord blocked and orbits
    // you forever — measured, and the reason this early-out exists at all.
    if (Math.abs(sweep) < 0.5) return straight;
    const L2 = dx * dx + dz * dz;
    let t = L2 > 1e-6 ? ((P.x - pos.x) * dx + (P.z - pos.z) * dz) / L2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const cx = pos.x + dx * t, cz = pos.z + dz * t;
    if (Math.hypot(P.x - cx, P.z - cz) >= R) return straight;
    const turn = sweep >= 0 ? 1 : -1;                     // the shorter way round
    const r = Math.max(R, Math.hypot(pos.x - P.x, pos.z - P.z));
    const na = ap + turn * Math.min(0.85, Math.abs(sweep));   // never overshoot the bearing
    return Math.atan2(P.z + Math.sin(na) * r - pos.z, P.x + Math.cos(na) * r - pos.x);
  }
  function faceTowards(pet, bearing, dt, move, band) {
    const cur = pet.faceH == null ? (pet.heading || 0) : pet.faceH;
    if (Math.abs(wrapPi(bearing - cur)) < (band || 0.15)) return false;
    move(pet, bearing, 0, dt, false);
    return true;
  }
  // WHERE A HELD COMPANION IS LOOKING: at YOU — unless you are aiming, and then
  // it looks WHERE YOU ARE POINTING. That beat needs the BODY, not just a neck:
  // a seated animal two metres in front of you, facing you, is looking down
  // your barrel from the wrong end and cannot see past its own shoulder. It is
  // also the same question aim_dossier.js already asks, so no new sense exists.
  function watchBearing(pos, P) {
    if (CBZ.isAimingWeapon && CBZ.isAimingWeapon()) {
      const ax = P.x + PL.fx * 18, az = P.z + PL.fz * 18;
      const dx = ax - pos.x, dz = az - pos.z;
      if (dx * dx + dz * dz > 9) return Math.atan2(dz, dx);
    }
    return Math.atan2(P.z - pos.z, P.x - pos.x);
  }

  // wildlife's own adoption bundle — the seam is `move`, everything else is the
  // field the world was ALREADY writing (`stay`, `goTo`, `petName`).
  const WILD_PET = { id: "wildlife:heel", move: stepHeading, stayKey: "stay" };
  // Declare the adoption at LOAD, not on first pet: a ratchet you can only read
  // after somebody happens to tame something is a ratchet nobody ever pins.
  if (PETS()) ADOPTED[WILD_PET.id] = 1;

  // ==========================================================================
  //  THE SIT RIG — discovery, not declaration (predator_anim.js's law).
  // ==========================================================================
  // A BONE whose authored base we KNOW needs no offset bookkeeping at all: we
  // write base+offset every frame, which also cancels whatever the gait put
  // there (exactly what a folded limb wants), and "release" is base+0.
  function nb(m, bx, by, bz) {
    return { m: m, bx: bx, by: by, bz: bz, rx: m.rotation.x, ry: m.rotation.y, rz: m.rotation.z };
  }
  // ..the GROUP transform has four other writers (ground snap, gait bob, gait
  // slope/sway), so it needs the "did somebody else touch this" test: still the
  // value we left => undo our offset first; changed => THAT is the new base.
  function putY(rig, want) {
    const p = rig.g.position;
    if (want === 0 && rig.gyO === 0) return;
    const base = (p.y === rig.gyL) ? p.y - rig.gyO : p.y;
    p.y = base + want; rig.gyO = want; rig.gyL = p.y;
  }
  function putRZ(rig, want) {
    const r = rig.g.rotation;
    if (want === 0 && rig.gzO === 0) return;
    const base = (r.z === rig.gzL) ? r.z - rig.gzO : r.z;
    r.z = base + want; rig.gzO = want; rig.gzL = r.z;
  }
  function meshH(m) {
    const p = m.geometry && m.geometry.parameters;
    if (p && p.height != null) return p.height;
    const bb = m.geometry && (m.geometry.boundingBox || (m.geometry.computeBoundingBox(), m.geometry.boundingBox));
    return bb ? (bb.max.y - bb.min.y) : 0.3;
  }

  function petRig(pet) {
    const grp = pet.group; if (!grp) return null;
    const ud = grp.userData || EMPTY;
    const src = pet.gait || ud.legs || null;
    if (pet._petRig && pet._petRig.src === src) return pet._petRig;
    const rig = {
      src: src, g: grp, front: [], rear: [], head: null,
      legH: 0, reachF: 0, reachR: 0, hx: 0, hy: 0, hz: 0, hspan: 0.3,
      pitch: 0, fold: 0, canSit: false, gyO: 0, gyL: NaN, gzO: 0, gzL: NaN, on: 0,
    };
    const gt = pet.gait;
    if (gt && gt.cols && gt.cols.length) {
      // (a) the leg columns wildlife.js already discovered. Nose is +X, so a
      //     column in front of the origin is a FRONT leg — its own rule.
      for (let c = 0; c < gt.cols.length; c++) {
        const col = gt.cols[c], rec = { x: col.x, h: col.h || 0.3, parts: [] };
        for (let p = 0; p < col.parts.length; p++) {
          const pt = col.parts[p];
          rec.parts.push(nb(pt.m, pt.bx, pt.by, pt.m.position.z));
        }
        (col.x > 0 ? rig.front : rig.rear).push(rec);
      }
    } else if (ud.legs && ud.legs.length) {
      // (b) dogs.js publishes the SAME rig one level less nested (a flat list
      //     of leg meshes carrying their own authored base). Nothing here has
      //     to know what a dog is.
      for (let i = 0; i < ud.legs.length; i++) {
        const L = ud.legs[i]; if (!L || !L.userData) continue;
        const bx = L.userData.baseX, by = L.userData.baseY;
        if (bx == null || by == null) continue;
        (bx > 0 ? rig.front : rig.rear).push({ x: bx, h: meshH(L), parts: [nb(L, bx, by, L.position.z)] });
      }
    }
    for (let i = 0; i < rig.front.length; i++) {
      if (rig.front[i].h > rig.legH) rig.legH = rig.front[i].h;
      const ax = Math.abs(rig.front[i].x); if (ax > rig.reachF) rig.reachF = ax;
    }
    for (let i = 0; i < rig.rear.length; i++) {
      if (rig.rear[i].h > rig.legH) rig.legH = rig.rear[i].h;
      const ax = Math.abs(rig.rear[i].x); if (ax > rig.reachR) rig.reachR = ax;
    }
    // ---- the head cluster (what LOOKS at you) ----------------------------
    let hd = null, pivot = false;
    if (gt && gt.head && gt.head.length) {
      hd = [];
      for (let i = 0; i < gt.head.length; i++) hd.push(nb(gt.head[i].m, gt.head[i].bx, gt.head[i].by, gt.head[i].m.position.z));
      // pivot = the discovered head BOX when wildlife.js found one (it is the
      // block the aggro eyes already ride), else the cluster centroid below.
      if (gt.headMesh) { rig.hx = gt.headMesh.position.x; rig.hy = gt.headMesh.position.y; rig.hz = gt.headMesh.position.z; pivot = true; }
    } else if (ud.legs && ud.legs.length) {
      // the same far-forward / off-the-ground test buildGaitRig uses, run once
      // over a rig that never went through it.
      const kids = grp.children; let maxX = 0;
      for (let i = 0; i < kids.length; i++) if (kids[i].isMesh && kids[i].position.x > maxX) maxX = kids[i].position.x;
      if (maxX > 0.4) {
        hd = [];
        for (let i = 0; i < kids.length; i++) {
          const m = kids[i]; if (!m.isMesh) continue;
          if (ud.legs.indexOf(m) >= 0) continue;
          if (m.position.x < maxX * 0.55) continue;
          if (m.position.y - meshH(m) / 2 < 0.3) continue;
          hd.push(nb(m, m.position.x, m.position.y, m.position.z));
        }
        if (!hd.length) hd = null;
      }
    }
    if (hd && hd.length) {
      let sx = 0, sy = 0, sz = 0, minY = 1e9, maxY = -1e9;
      for (let i = 0; i < hd.length; i++) {
        sx += hd[i].bx; sy += hd[i].by; sz += hd[i].bz;
        if (hd[i].by < minY) minY = hd[i].by;
        if (hd[i].by > maxY) maxY = hd[i].by;
      }
      if (!pivot) { rig.hx = sx / hd.length; rig.hy = sy / hd.length; rig.hz = sz / hd.length; }
      rig.hspan = Math.max(0.08, maxY - minY);
      rig.head = hd;
    }
    // ---- A HIND LEG CANNOT FOLD FURTHER THAN IT IS LONG -------------------
    // Work it once, exactly, because a guess here is a floating haunch. The
    // group pitches nose-up by t about the model origin, so a foot at local
    // (x, 0) lands at world y = x*sin(t); pinning the FRONT feet costs the
    // group -reachF*sin(t) and drops every hind foot to -(reachF+reachR)*sin(t).
    // Raising a hind column by a LOCAL dy only buys back dy*cos(t) of that (the
    // column is rotated too — this is the line where a sine would be wrong),
    // so the fold is dy = span*tan(t). A column can give up ~85% of its own
    // height before the foot is inside the belly, so:
    //        t <= atan( legH * 0.85 / (span * FOLD_PRESS) )
    // FOLD_PRESS 0.95 leaves the haunch a deliberate ~5% SHORT of the solve, so
    // the rump reads as pressed into the ground instead of hovering over it.
    const span = rig.reachF + rig.reachR;
    if (rig.front.length && rig.rear.length && rig.legH > 0.03 && span > 0.02) {
      rig.pitch = Math.min(0.42, Math.atan((rig.legH * 0.85) / (span * 0.95)));
      rig.fold = span * Math.tan(rig.pitch) * 0.95;
      rig.canSit = rig.pitch > 0.06;
    }
    pet._petRig = rig;
    return rig;
  }

  // ==========================================================================
  //  THE POSE — one write per bone per frame, every layer summed.
  // ==========================================================================
  function petPoseApply(pet, near) {
    const rig = petRig(pet); if (!rig) return;
    const g = rig.g;
    // predator_anim.js / creature_combat own this body while a seize or a
    // strike is up. Two writers on one bone is the exact bug the write
    // discipline above exists to prevent — so we simply let go.
    const busy = !!pet.dead || !!(pet._prig && pet._prig.act) || (pet._flinchT || 0) > 0 ||
                 (pet._atkAnim != null && pet._atkAnim >= 0) || !!pet._seizedBy;
    const k = busy ? 0 : ease(pet._sitK || 0);
    let tilt = 0, glance = 0, reach = 0, hop = 0, look = 0, breathe = 0;
    if (!busy && near) {
      const b = pet._beatK || 0;
      if (b > 0) {
        const e = Math.sin(Math.min(1, pet._beatP) * Math.PI);
        if (pet._beatKind === "tilt") tilt = e * 0.42;
        else if (pet._beatKind === "glance") glance = e * (pet._beatSide || 1) * 0.5;
        else if (pet._beatKind === "nuzzle") reach = e;
        else if (pet._beatKind === "hop") hop = Math.abs(Math.sin(Math.min(1, pet._beatP) * Math.PI)) * rig.legH * 0.55;
      }
      if (pet._aimYaw) glance = pet._aimYaw;          // a glance at your muzzle wins
      look = pet._lookK || 0;
      breathe = Math.sin(pet._breathe || 0) * rig.legH * 0.016 * k;
    }
    const live = (k > 0.001 || tilt || glance || reach || hop || look || breathe) ? 1 : 0;
    if (!live && !rig.on) return;                     // resting costs nothing
    rig.on = live;

    // ---- BODY: nose-up pitch; the group drops by exactly the arc the FRONT
    //      paws would otherwise have swung up through, so they stay planted.
    const pitch = rig.canSit ? rig.pitch * k : 0;
    const sy = (g.scale && g.scale.y) ? g.scale.y : 1;
    putRZ(rig, pitch);
    putY(rig, (-Math.sin(pitch) * rig.reachF + breathe + hop) * sy);

    // ---- LEGS: the haunches fold, the forelegs brace ---------------------
    if (rig.canSit) {
      // the body pitch drags a raised hind column BACKWARD by fold*sin(t); the
      // tuck is what puts the hock back under the hip where a sitting animal
      // actually carries it.
      const fold = rig.fold * k;
      for (let c = 0; c < rig.rear.length; c++) {
        const parts = rig.rear[c].parts;
        for (let p = 0; p < parts.length; p++) {
          const b = parts[p];
          b.m.position.x = b.bx + rig.reachR * 0.42 * k;
          b.m.position.y = b.by + fold;
          b.m.rotation.z = b.rz + 0.52 * k;
        }
      }
      for (let c = 0; c < rig.front.length; c++) {
        const parts = rig.front[c].parts;
        for (let p = 0; p < parts.length; p++) {
          const b = parts[p];
          b.m.position.x = b.bx + rig.legH * 0.05 * k;
          b.m.position.y = b.by;
          b.m.rotation.z = b.rz - pitch * 0.55;            // stay near vertical
        }
      }
    }

    // ---- HEAD: it LOOKS at you. The pitch is the real angle to your eyes, so
    //      a terrier looks steeply up and a giraffe looks down — one arctangent
    //      and no species named anywhere in it.
    const hd = rig.head;
    if (hd) {
      const yaw = -glance;                       // local bearing -> yaw (wildlife.js's sign)
      const pit = look + reach * 0.10;
      const fwd = reach * rig.hspan * 0.35;      // the nuzzle REACHES for you
      const yc = Math.cos(yaw), ys = Math.sin(yaw);
      const pc = Math.cos(pit), ps = Math.sin(pit);
      for (let i = 0; i < hd.length; i++) {
        const b = hd[i];
        let x = b.bx, y = b.by, z = b.bz;
        if (pit !== 0) {                         // pitch the cluster about the head pivot
          const ax2 = x - rig.hx, ay2 = y - rig.hy;
          x = rig.hx + ax2 * pc - ay2 * ps;
          y = rig.hy + ax2 * ps + ay2 * pc;
        }
        if (yaw !== 0) {                         // yaw it about the same pivot
          const ex = x - rig.hx, ez = z - rig.hz;
          x = rig.hx + ex * yc + ez * ys;
          z = rig.hz - ex * ys + ez * yc;
        }
        b.m.position.set(x + fwd, y, z);
        b.m.rotation.z = b.rz + pit;
        b.m.rotation.y = b.ry + yaw;
        b.m.rotation.x = b.rx + tilt;
      }
    }
  }
  function petRelease(pet) {
    if (!pet) return;
    pet._sitK = 0; pet._petPhase = "none"; pet._petT = 0;
    pet._beatK = 0; pet._beatKind = null; pet._aimYaw = 0; pet._lookK = 0;
    if (pet._petRig && pet.group) petPoseApply(pet, false);   // one last write: every bone home
  }
  // A DEATH, A MOUNT OR A HANDOVER MUST BE ABLE TO TAKE THE BODY BACK. Any
  // driver that is about to give this actor to another simulation calls this
  // first, so a corpse never ragdolls out of a held sit.
  CBZ.petRelease = petRelease;

  // ---- ATTENTION BEATS — small, rate-limited, distance-gated life ---------
  // A pet that only ever sits is a prop. These are cheap (one eased envelope on
  // bones the pose already owns) and deliberately IRREGULAR, so you never learn
  // the cadence: a head tilt, a glance away and back, a baby's hop, a nuzzle
  // when you stand close enough to touch, and — for a dog — the tail dogs.js
  // was already wagging, which we only ever BOOST.
  function petBeats(pet, dt, d, seated) {
    pet._breathe = (pet._breathe || 0) + dt * 1.35;
    if (pet._beatK > 0) {
      pet._beatP += dt / (pet._beatDur || 0.8);
      if (pet._beatP >= 1) { pet._beatK = 0; pet._beatP = 0; pet._beatKind = null; }
      return;
    }
    pet._beatT = (pet._beatT || 0) - dt;
    if (pet._beatT > 0) return;
    pet._beatT = 3.4 + Math.random() * 5.2;
    let kind;
    if (pet._petCheckIn) { pet._petCheckIn = 0; kind = "nuzzle"; }   // petted, or came back from a fight
    else if (seated && d < 1.9 && PL.still > 2.4 && Math.random() < 0.55) kind = "nuzzle";
    else if (pet.grow != null && Math.random() < 0.42) kind = "hop";  // babies are springs
    else if (seated && Math.random() < 0.5) kind = "tilt";
    else kind = "glance";
    pet._beatKind = kind; pet._beatK = 1; pet._beatP = 0;
    pet._beatSide = Math.random() < 0.5 ? -1 : 1;
    pet._beatDur = kind === "hop" ? 0.42 : (kind === "nuzzle" ? 0.95 : (kind === "tilt" ? 1.15 : 0.7));
    if (pet.kind === "dog") pet.wagBoost = Math.max(pet.wagBoost || 0, kind === "nuzzle" ? 2.4 : 1.3);
  }

  // ---- the pose pass: LAST word of the frame for every companion ----------
  function affectionTick(dt) {
    if (!dt || dt > 0.5) dt = 0.05;
    for (let i = REG.length - 1; i >= 0; i--) {
      const pet = REG[i];
      if (!pet || !pet.tamed || pet.dead || !pet.group || !pet.group.parent) {
        if (pet) { petRelease(pet); pet._petReg = false; }
        REG.splice(i, 1); continue;
      }
      const on = PETS() && !pet.ridden && !pet.companionBusy;
      // The sit weight ALWAYS integrates: a companion suddenly needed elsewhere
      // must stand up, not blink out of the pose.
      const want = (on && pet._petPhase === "sit") ? 1 : 0;
      const cur = pet._sitK || 0;
      pet._sitK = stepTo(cur, want, want > cur ? dt / SIT_IN : dt / SIT_OUT);
      const pos = pet.pos || pet.group.position;
      const rig = petRig(pet);
      let d = 1e9;
      if (PL.has) d = Math.hypot(pos.x - PL.x, pos.z - PL.z);
      const near = on && d < BEAT_NEAR && pet.group.visible !== false && PL.has;
      if (near) {
        petBeats(pet, dt, d, pet._sitK > 0.5);
        // LOOK AT ME. The head pitch is the REAL angle from this animal's own
        // head height to your eyes, so a terrier looks steeply up at you and a
        // giraffe looks down — one arctangent, no species table, and it keeps
        // working the day somebody tames something new. A following animal
        // keeps a fraction of it (a dog trotting beside you does glance up);
        // a seated one gives you all of it. Eased, never snapped.
        let want2 = 0;
        if (rig && rig.head) {
          const sy = (pet.group.scale && pet.group.scale.y) ? pet.group.scale.y : 1;
          const hy = pos.y + rig.hy * sy;
          want2 = Math.max(-0.42, Math.min(0.52, Math.atan2(PL.eyeY - hy, Math.max(0.6, d)) * 0.65)) *
                  Math.max(pet._sitK || 0, 0.22);
        }
        pet._lookK = (pet._lookK || 0) + (want2 - (pet._lookK || 0)) * Math.min(1, dt * 4.5);
        if (Math.abs(pet._lookK) < 0.004) pet._lookK = 0;
        // A GLANCE AT WHAT YOU AIM AT — the same question aim_dossier.js asks,
        // so a pet looks where your gun looks and nowhere else. Two rules keep
        // it from being a tell: it looks at the POINT down your line (not along
        // your vector — a companion off to your left has a different bearing to
        // the same target), and IT HAS A NECK. Past ~55 degrees off its own nose
        // the glance FADES OUT instead of clamping, because an animal that
        // cannot see where you are pointing simply keeps watching you — a head
        // pinned at its limit for as long as you hold aim is a glitch.
        let aw = 0;
        if (rig && rig.head && CBZ.isAimingWeapon && CBZ.isAimingWeapon()) {
          const face = pet.faceH == null ? (pet.heading || 0) : pet.faceH;
          const off = wrapPi(Math.atan2(PL.z + PL.fz * 18 - pos.z, PL.x + PL.fx * 18 - pos.x) - face);
          const mag = Math.abs(off);
          const neck = mag <= 0.5 ? 1 : (mag >= 0.95 ? 0 : 1 - (mag - 0.5) / 0.45);
          aw = off * neck * Math.max(pet._sitK || 0, 0.45);
        }
        pet._aimYaw = (pet._aimYaw || 0) + (aw - (pet._aimYaw || 0)) * Math.min(1, dt * 5);
        if (Math.abs(pet._aimYaw) < 0.004) pet._aimYaw = 0;
      } else { pet._beatK = 0; pet._aimYaw = 0; pet._lookK = 0; }
      petPoseApply(pet, near);
    }
  }
  CBZ.onUpdate(47.45, affectionTick);

  // ==========================================================================
  //  CBZ.petFollow(pet, dt, opts) — THE ONE companion decision.
  //    opts.move(pet, heading, speed, dt, panic)  the LOCOMOTION SEAM
  //    opts.stayKey  "stay" (wildlife) | "sit" (dogs) — the field already there
  //    opts.topSpeed / opts.heelR / opts.note / opts.id
  //  Returns a truthy state string when it handled the frame, false when the
  //  caller must run its own legacy path (flag off / no player yet).
  // ==========================================================================
  CBZ.petFollow = function (pet, dt, opts) {
    if (!PETS() || !pet || !pet.group) return false;
    opts = opts || EMPTY;
    if (!dt || dt > 0.5) dt = 0.05;
    petRegister(pet);
    if (opts.id) ADOPTED[opts.id] = 1;
    const P = CBZ.player && CBZ.player.pos;
    if (!P || !PL.has) return false;
    if (pet.dead) return "dead";
    if (pet.ridden || ride.mount === pet) { pet._petPhase = "none"; return "ridden"; }
    // companions.js (or dogs.js's own threat response) owns the body this frame.
    if (pet.companionBusy) { pet._petPhase = "none"; return "busy"; }

    const pos = pet.pos || pet.group.position;
    const sp = pet.species || EMPTY;
    const move = opts.move || stepHeading;
    const stayKey = opts.stayKey || "stay";
    const say = opts.note || note;
    const nm = petNameOf(pet);
    const bulk = sp.scale || 1;
    const top = (opts.topSpeed != null ? opts.topSpeed : (sp.spd || 1.6) * FOLLOW_MULT) * (pet.grow != null ? 0.8 : 1);
    const heelR = (opts.heelR != null ? opts.heelR : HEEL_R) * 0.62 + bulk * 0.5;
    // the no-go ring only widens for animals that are actually WIDE — a terrier
    // swinging an elephant's berth would look like it was avoiding you.
    const avoid = AVOID_R + Math.max(0, bulk - 0.8) * 0.9;
    const dx = P.x - pos.x, dz = P.z - pos.z;
    const d = Math.hypot(dx, dz) || 1e-4;
    const toYou = Math.atan2(dz, dx);

    // ---- SENT AHEAD: it RUNS there (never a teleport) and holds the spot ----
    if (pet.goTo) {
      const gd = Math.hypot(pet.goTo.x - pos.x, pet.goTo.z - pos.z);
      if (gd <= 1.5) {
        pet.goTo = null; pet[stayKey] = true;
        say(nm + " waits there.", 1.6);
      } else move(pet, Math.atan2(pet.goTo.z - pos.z, pet.goTo.x - pos.x), top, dt, true);
      return "sent";
    }

    // ---- TOLD TO STAY: and it finally SITS while it stays ------------------
    if (pet[stayKey]) {
      pet._petPhase = "sit";
      faceTowards(pet, watchBearing(pos, P), dt, move, 0.18);
      return "stay";
    }

    // ---- A WORLD BEHIND YOU: it may relocate, but ONLY where you cannot see
    //      it happen (CLAUDE.md: never let the player see a spawn). If you ARE
    //      looking, it keeps running — which is the honest answer anyway.
    if (d > CATCHUP_R) {
      pet._petPhase = "none";
      pet._warpT = (pet._warpT || 0) - dt;
      if (pet._warpT <= 0) {
        pet._warpT = 0.7;
        const bk = Math.atan2(PL.fz, PL.fx) + Math.PI + slotAngle(pet);
        const wr = 7 + bulk * 1.6;
        const wx = P.x + Math.cos(bk) * wr, wz = P.z + Math.sin(bk) * wr;
        if (!CBZ.npcTransitionSafe || CBZ.npcTransitionSafe(wx, wz, { minDistance: 5 })) {
          pos.x = wx; pos.z = wz; pos.y = groundY(wx, wz);
          pet._gpx = wx; pet._gpz = wz; pet.prevX = wx; pet.prevZ = wz;
          faceAnimal(pet, Math.atan2(P.z - wz, P.x - wx));
          WARPS++;
        } else WARPS_REF++;
      }
      move(pet, toYou, top, dt, true);
      return "run";
    }

    // ---- THE SIT-IN-FRONT RITUAL ------------------------------------------
    const calm = PL.still >= (pet._sitWait || SIT_WAIT_MIN) && !ride.mount &&
                 !(CBZ.player && (CBZ.player.driving || CBZ.player.dead));
    const ph = pet._petPhase;
    if (!calm && (ph === "arc" || ph === "sit")) pet._petPhase = "up";
    if (pet._petPhase === "up") {
      // it STANDS first and then walks. An animal that slides out of a sit
      // drags a false slope through gaitAnimate's own terrain estimator.
      if ((pet._sitK || 0) > 0.02) { faceTowards(pet, toYou, dt, move, 0.3); return "up"; }
      pet._petPhase = "none"; pet._petT = 0;
    }
    // No distance gate: YOU STOPPING is the whole cue. A companion two fields
    // away that sees you settle comes in and settles too — and the arc router
    // returns the straight heading whenever the line does not cross you, so
    // coming from far off costs nothing and looks like a beeline until it
    // reaches you, which is exactly what it should look like.
    if (calm && pet._petPhase === "none") { pet._petPhase = "arc"; pet._petT = 0; }

    if (pet._petPhase === "arc" || pet._petPhase === "sit") {
      const fa = Math.atan2(PL.fz, PL.fx) + slotAngle(pet) * 0.62;
      // strictly OUTSIDE its own no-go ring, or the spot it is walking to is a
      // place it is not allowed to stand.
      const fd = Math.max(FRONT_D + bulk * 0.62, avoid + 0.7);
      const s = separate(pet, P.x + Math.cos(fa) * fd, P.z + Math.sin(fa) * fd);
      const tx = s.x, tz = s.z;
      const td = Math.hypot(tx - pos.x, tz - pos.z);
      if (pet._petPhase === "sit") {
        pet._petT += dt;
        // you turned on the spot: the FRONT of you moved, so it goes round again.
        if (td > SIT_REDO && pet._petT > 1.2) { pet._petPhase = "arc"; pet._petT = 0; }
        else { faceTowards(pet, watchBearing(pos, P), dt, move, 0.16); return "sit"; }
      }
      if (td <= SIT_ARRIVE) {
        // square up to you BEFORE folding — the sit reads as a decision, not a
        // collapse, and it means the animal is always facing you when it lands.
        const face = pet.faceH == null ? (pet.heading || 0) : pet.faceH;
        faceTowards(pet, toYou, dt, move, 0.12);
        if (Math.abs(wrapPi(toYou - face)) < 0.35) { pet._petPhase = "sit"; pet._petT = 0; }
        return "arc";
      }
      move(pet, arcHeading(pos, P, tx, tz, avoid), Math.min(top, Math.max(top * 0.32, td * 1.5)), dt, td > 6);
      return "arc";
    }

    // ---- AT HEEL — at your SIDE, matching your pace ------------------------
    const bk2 = Math.atan2(PL.fz, PL.fx) + Math.PI + slotAngle(pet);
    const hs = separate(pet, P.x + Math.cos(bk2) * (heelR + 0.8), P.z + Math.sin(bk2) * (heelR + 0.8));
    const hx = hs.x, hz = hs.z;
    const sd = Math.hypot(hx - pos.x, hz - pos.z);
    // PACE MATCHING: your speed is the floor, the gap is the urgency, and the
    // species' own gait is the ceiling — so a pig lags and a cheetah never does.
    // The last factor is what keeps it CONTINUOUS. A hard "inside the slot =>
    // stop" band makes a follower stutter one frame on and one frame off (and
    // gaitAnimate reads its stride off distance moved, so the stutter is
    // visible in the legs). Easing the speed to zero over the last metre
    // instead gives a stable trailing equilibrium: the animal settles at
    // whatever gap makes its speed equal YOURS, and simply holds there.
    const spd = Math.min(top, Math.max(PL.spd * 1.14, top * 0.3) + Math.max(0, d - heelR) * 0.55) *
                Math.min(1, sd / 0.9);
    if (spd < 0.06 || sd < 0.12) {
      faceTowards(pet, watchBearing(pos, P), dt, move, 0.3);   // in its slot: hold, and watch
      return "heel";
    }
    move(pet, arcHeading(pos, P, hx, hz, avoid), spd, dt, d > 18);
    return sd > 1.2 ? "run" : "heel";
  };

  // ---- THE RATCHET (BLOCK LAW #5): follower paths that are still their own.
  CBZ.companionAudit = function () {
    const out = {
      tamed: 0, dogs: 0, seated: 0, arcing: 0, heeling: 0, staying: 0, sent: 0,
      mounted: ride.mount ? 1 : 0, canSit: 0, cannotSit: 0, farthest: 0,
      warps: WARPS, warpsRefused: WARPS_REF,
      adopted: 0, legacyFollowPaths: 0, adopters: [], legacy: [],
    };
    for (const a in ADOPTED) { out.adopted++; out.adopters.push(a); }
    for (const l in LEGACY) { out.legacyFollowPaths++; out.legacy.push(l); }
    const P = CBZ.player && CBZ.player.pos;
    for (let i = 0; i < REG.length; i++) {
      const pet = REG[i];
      if (!pet || !pet.tamed || pet.dead || !pet.group) continue;
      out.tamed++;
      if (pet.kind === "dog") out.dogs++;
      const rig = petRig(pet);
      if (rig && rig.canSit) out.canSit++; else out.cannotSit++;
      if ((pet._sitK || 0) > 0.5) out.seated++;
      else if (pet._petPhase === "arc") out.arcing++;
      else out.heeling++;
      if (pet.stay || pet.sit) out.staying++;
      if (pet.goTo) out.sent++;
      const p = pet.pos || pet.group.position;
      if (P) { const q = Math.hypot(p.x - P.x, p.z - P.z); if (q > out.farthest) out.farthest = q; }
    }
    out.farthest = Math.round(out.farthest * 10) / 10;
    return out;
  };

  CBZ.cityTameFollow = function (a, dt) {
    // ONE follower brain: heel slots, pace matching, the go-to, the sit-in-front
    // ritual and the catch-up all live in petFollow now (dogs.js calls the same
    // function through its own move seam).
    if (PETS() && CBZ.petFollow && CBZ.petFollow(a, dt, WILD_PET)) return;
    // companions.js takes over movement while the pet is actively fighting a
    // threat or fleeing one (trait-driven defense) — yield to it this frame.
    if (a.companionBusy) return;
    const P = CBZ.player && CBZ.player.pos, grp = a.group, sp = a.species;
    if (!P) return;
    CBZ.petLegacy("wildlife:tame-follow");   // the ratchet only counts a REAL run
    const dx = P.x - grp.position.x, dz = P.z - grp.position.z;
    const d = Math.hypot(dx, dz);
    // GO-TO (ANIMALS_ALL_CONTROLLABLE): sent to a spot, it RUNS there (real
    // locomotion, never a teleport), then waits — stay — until called back.
    if (a.goTo) {
      const gd = Math.hypot(a.goTo.x - grp.position.x, a.goTo.z - grp.position.z);
      if (gd <= 1.7) {
        a.goTo = null; a.stay = true;
        note((a.petName || sp.name) + " waits there.", 1.6);
        faceAnimal(a, Math.atan2(dz, dx));
      } else {
        steppedMove(a, a.goTo.x, a.goTo.z, (sp.spd || 1.6) * FOLLOW_MULT * (a.grow != null ? 0.8 : 1), dt, true);
      }
      return;
    }
    if (a.stay || d <= HEEL_R) {                    // parked / at heel: face you
      faceAnimal(a, Math.atan2(dz, dx));
      return;
    }
    const spd = (sp.spd || 1.6) * FOLLOW_MULT * (a.grow != null ? 0.8 : 1);
    if (ALLCTL()) { steppedMove(a, P.x, P.z, spd, dt, d > 20); return; }
    // legacy beeline (flag off): the exact old follow
    grp.position.x += (dx / d) * spd * dt;
    grp.position.z += (dz / d) * spd * dt;
    grp.position.y = groundY(grp.position.x, grp.position.z);
    faceAnimal(a, Math.atan2(dz, dx));
  };

  // ============================================================
  //  RIDING — mount/dismount + the per-frame glue.
  // ============================================================
  const ride = {
    mount: null, head: 0, phase: 0, lx: 0, lz: 0, visual: null, water: null,
    attackT: 0, attackDur: 0, attackCd: 0, attackHit: false, attackHitP: -1,
    target: null, targetKind: null, attackPitch: 0, attackRoll: 0,
  };
  const seatV = new THREE.Vector3();
  const riderHipV = new THREE.Vector3();
  const jawV = new THREE.Vector3();
  const biteV = new THREE.Vector3();
  const biteBox = new THREE.Box3();
  const biteNormal = new THREE.Vector3();
  const AQUATIC_AUDIT = {
    mounts: 0, breaches: 0, reentries: 0, attacks: 0, hits: 0, shipBites: 0,
    lastSpecies: null, lastTarget: null,
  };

  function aquaticMounted(a) { return !!(a && a.species && a.species.aquatic && ride.water); }
  function seaY(x, z) {
    if (CBZ.citySeaHeightAt) {
      const y = CBZ.citySeaHeightAt(x, z);
      if (Number.isFinite(y)) return y;
    }
    return CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48;
  }
  function waterDepth(x, z) {
    if (CBZ.cityWaterDepthAt) {
      const d = CBZ.cityWaterDepthAt(x, z);
      if (Number.isFinite(d)) return Math.max(1.2, d);
    }
    return 18;
  }
  function shortestAngle(d) {
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function aquaticSeatY(V, pitch) {
    const ch = CBZ.playerChar;
    const hs = (ch && ch.group && ch.group.userData && ch.group.userData.humanScale) || 1;
    const hip = ((ch && ch.hipY) || 0.95) * hs;
    return V.x * Math.sin(pitch || 0) + V.y * Math.cos(pitch || 0) - hip;
  }

  // Mouth position comes from creature_combat's geometry discovery; the matrix
  // turns that authored +X jaw point into world space. This is sampled only on
  // a trigger edge / strike frame, never in the ordinary swim hot path.
  function jawWorld(a) {
    const p = (CBZ.creatureJawPoint && CBZ.creatureJawPoint(a)) || { x: 1, y: 0.8, z: 0 };
    a.group.updateMatrixWorld(true);
    return jawV.set(p.x, p.y, p.z).applyMatrix4(a.group.matrixWorld);
  }
  function biteDistance(target, mouth) {
    if (!target || !target.group || !target.group.parent) return Infinity;
    target.group.updateMatrixWorld(true);
    biteBox.setFromObject(target.group);
    biteBox.clampPoint(mouth, biteV);
    return biteV.distanceTo(mouth);
  }
  function inBiteFront(mouth, point) {
    const dx = point.x - mouth.x, dz = point.z - mouth.z;
    const d = Math.hypot(dx, dz);
    return d < 0.25 || (dx * Math.cos(ride.head) + dz * Math.sin(ride.head)) / d > 0.08;
  }
  function marineCar(car) {
    return !!(car && !car.dead && car.group &&
      (car._yacht || (car.model && car.model.body === "boat") ||
       (car.group.userData && car.group.userData.carStyle === "boat") ||
       (car._playerCarFeel && car._playerCarFeel.marine)));
  }
  function considerBiteTarget(target, kind, mouth, maxD, best) {
    if (!target || target.dead || target === ride.mount || !target.group) return best;
    const d = biteDistance(target, mouth);
    if (d > maxD || d >= best.d || !inBiteFront(mouth, biteV)) return best;
    best.target = target; best.kind = kind; best.d = d;
    return best;
  }
  function biteReach(a) {
    return Math.max(3.0, Math.max(0.35, (a && a.species && a.species.scale) || 1) * 2.5);
  }
  function selectBiteTarget(a, R) {
    const mouth = jawWorld(a);
    const best = { target: null, kind: null, d: biteReach(a) };
    const list = animals();
    for (let i = 0; i < list.length; i++) considerBiteTarget(list[i], "animal", mouth, best.d, best);
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) considerBiteTarget(peds[i], "ped", mouth, best.d, best);
    const cops = CBZ.cityCops || [];
    for (let i = 0; i < cops.length; i++) considerBiteTarget(cops[i], "cop", mouth, best.d, best);
    if (R.shipBite) {
      const cars = CBZ.cityCars || [];
      for (let i = 0; i < cars.length; i++) if (marineCar(cars[i])) considerBiteTarget(cars[i], "ship", mouth, best.d, best);
    }
    return best;
  }

  function damageBiteTarget(a, target, kind) {
    if (!target || target.dead) return false;
    const sp = a.species, scale = Math.max(0.35, sp.scale || 1);
    const mouth = jawWorld(a);
    const dist = biteDistance(target, mouth);
    // Use the same envelope selection used. This especially matters for the
    // megalodon's jaw below a surface hull: accepting a target at 6.5 m and
    // then shrinking the strike to 5.1 m made the visible bite a fake miss.
    if (dist > biteReach(a) || !inBiteFront(mouth, biteV)) return false;
    const damage = Math.max(8, Math.round(sp.bite || 12));
    if (kind === "animal") {
      if (!CBZ.cityWildlifeHit) return false;
      CBZ.cityWildlifeHit(target,
        { head: false, point: biteV, dir: { x: Math.cos(ride.head), y: 0.12, z: Math.sin(ride.head) }, from: a.pos },
        { damage: damage, by: a, cause: "eaten by a " + String(sp.name || sp.id).toLowerCase() });
    } else if (kind === "cop") {
      if (!CBZ.cityHurtCop) return false;
      if (CBZ.creatureBiteWound) CBZ.creatureBiteWound(a, target, "lunge");
      CBZ.cityHurtCop(target, damage, {
        fromX: a.pos.x, fromZ: a.pos.z, force: 5 + scale * 2, fling: 2 + scale,
        byPlayer: true,
      });
    } else if (kind === "ped") {
      if (CBZ.creatureBiteWound) CBZ.creatureBiteWound(a, target, "lunge");
      target.hp = (target.hp == null ? 100 : target.hp) - damage;
      if (target.hp <= 0 && CBZ.cityKillPed) {
        CBZ.cityKillPed(target, {
          fromX: a.pos.x, fromZ: a.pos.z, force: 5 + scale * 2, fling: 2 + scale,
          byPlayer: true,
        }, "eaten by a " + String(sp.name || sp.id).toLowerCase());
      } else if (CBZ.body && CBZ.body.hit) {
        CBZ.body.hit(target, { fromX: a.pos.x, fromZ: a.pos.z, force: 4 + scale * 2, knockdown: 1.1 });
      }
    } else if (kind === "ship") {
      if (!CBZ.cityDamageCar) return false;
      const shipDamage = Math.max(145, Math.round(damage * 2.5));
      biteNormal.set(-Math.cos(ride.head), 0, -Math.sin(ride.head));
      CBZ.cityDamageCar(target, shipDamage, {
        byPlayer: true, bite: true, crumple: true, point: biteV, normal: biteNormal,
      });
      target._megalodonBites = (target._megalodonBites || 0) + 1;
      target.vx = (target.vx || 0) + Math.cos(ride.head) * (2.5 + scale);
      target.vz = (target.vz || 0) + Math.sin(ride.head) * (2.5 + scale);
      target.v = Math.max(0, (target.v || 0) * 0.35);
      AQUATIC_AUDIT.shipBites++;
    } else return false;
    if (CBZ.waterSplashAt) CBZ.waterSplashAt(biteV.x, seaY(biteV.x, biteV.z), biteV.z, Math.min(3.8, 0.7 + scale));
    if (CBZ.sfx) { try { CBZ.sfx("hit", { volume: Math.min(1.2, 0.55 + scale * 0.18) }); } catch (e) {} }
    if (CBZ.shake) CBZ.shake(Math.min(0.85, 0.18 + scale * 0.18));
    AQUATIC_AUDIT.hits++;
    AQUATIC_AUDIT.lastTarget = kind;
    return true;
  }

  function startAquaticAttack() {
    const a = ride.mount, R = a && rideDef(a.species);
    if (!a || !R || !R.aquatic || !R.attack || ride.attackCd > 0 || ride.attackT > 0) return false;
    const pick = selectBiteTarget(a, R);
    ride.target = pick.target; ride.targetKind = pick.kind;
    ride.attackT = 0.0001; ride.attackDur = R.shipBite ? 0.72 : 0.56;
    ride.attackHit = false; ride.attackHitP = -1; ride.attackCd = R.shipBite ? 0.85 : 0.62;
    a._atkAnim = 0;
    if (ride.water) ride.water.v = Math.max(ride.water.v || 0, (R.cruise || 8) * 0.82);
    AQUATIC_AUDIT.attacks++;
    return true;
  }
  CBZ.cityMountedAnimalAttack = function (down) {
    const a = ride.mount, R = a && rideDef(a.species);
    if (!a || !R || !R.aquatic) return false;
    if (down !== false && R.attack) startAquaticAttack();
    return true;                                      // mounted animal owns the trigger
  };

  function tickAquaticAttack(a, dt) {
    if (ride.attackCd > 0) ride.attackCd = Math.max(0, ride.attackCd - dt);
    ride.attackPitch = 0; ride.attackRoll = 0;
    if (!(ride.attackT > 0)) return;
    ride.attackT += dt;
    const p = Math.min(1, ride.attackT / ride.attackDur);
    a._atkAnim = p;
    if (p < 0.42) ride.attackPitch = -0.20 * Math.min(1, p / 0.42);
    else {
      const q = (p - 0.42) / 0.58;
      ride.attackPitch = Math.sin(Math.min(1, q * 1.4) * Math.PI) * 0.34;
      ride.attackRoll = Math.sin(q * 9) * 0.09 * (1 - q);
    }
    // Contact is a WINDOW, not one magic animation frame. A fast shark can
    // cross an entire target between two 60 Hz samples; retry while the jaw is
    // open and let the geometry distance/front test decide the first real hit.
    if (!ride.attackHit && p >= 0.38 && p <= 0.72) {
      ride.attackHit = damageBiteTarget(a, ride.target, ride.targetKind);
      if (ride.attackHit) ride.attackHitP = p;
    }
    // Open through the approach, then snap shut immediately AFTER real contact.
    // Previously damage could resolve at p=.18 while the jaw stayed wide until
    // p=.64, so the target was already hurt while the shark visibly held its
    // mouth open through it. A miss still performs a full gape and recovery;
    // a hit turns the geometry result into the clench trigger.
    let open = p < 0.30 ? ease(p / 0.30) : 1;
    if (ride.attackHit && ride.attackHitP >= 0) {
      open = Math.max(0.08, 1 - ease((p - ride.attackHitP) / 0.16) * 0.92);
    } else if (p > 0.70) {
      open = 1 - ease((p - 0.70) / 0.30);
    }
    if (CBZ.swimJaw) CBZ.swimJaw(a, open);
    if (p >= 1) {
      ride.attackT = 0; ride.target = null; ride.targetKind = null;
      ride.attackHitP = -1;
      ride.attackPitch = 0; ride.attackRoll = 0; a._atkAnim = -1;
      if (CBZ.swimJaw) CBZ.swimJaw(a, 0);
    }
  }

  // The aquatic mount owns the same player root that physics.js hands to cars
  // and snowboards, but integrates it in the water column. Horizontal travel
  // goes through waterfield.moveInWater (the canonical shore oracle); vertical
  // travel is momentum with a seabed floor. A dolphin breach is the one state
  // transition: sprint + rise near the surface launches a ballistic body, then
  // gravity returns that SAME root to the sea and the water takes it back.
  CBZ.cityAquaticMountStep = function (dt) {
    const a = ride.mount, P = CBZ.player;
    if (!a || !P || !aquaticMounted(a) || P.dead || P.driving || a.dead) return false;
    const R = rideDef(a.species), W = ride.water, V = ride.visual;
    if (!R || !R.aquatic || !W || !V) return false;
    let fdt = CBZ.feelDt != null ? CBZ.feelDt : dt;
    if (!(fdt > 0)) fdt = dt || 0.016;
    fdt = Math.max(0.001, Math.min(0.08, fdt));
    const keys = CBZ.keys || {}, cam = CBZ.cam || { yaw: 0 };
    const blockedInput = !!((CBZ.simView && CBZ.simView.active) || (CBZ.fullMap && CBZ.fullMap.active) ||
      (CBZ.cineActive && CBZ.cineActive()) || P.stun > 0 || P._cityArrested);
    const sy = Math.sin(cam.yaw || 0), cy = Math.cos(cam.yaw || 0);
    let mx = 0, mz = 0;
    if (!blockedInput) {
      if (keys.w) { mx -= sy; mz -= cy; }
      if (keys.s) { mx += sy; mz += cy; }
      if (keys.d) { mx += cy; mz -= sy; }
      if (keys.a) { mx -= cy; mz += sy; }
    }
    const len = Math.hypot(mx, mz);
    if (len > 0.001) {
      mx /= len; mz /= len;
      const wantH = Math.atan2(mz, mx);
      const maxTurn = (R.turn || 2.2) * fdt;
      let d = shortestAngle(wantH - ride.head);
      if (d > maxTurn) d = maxTurn; else if (d < -maxTurn) d = -maxTurn;
      ride.head += d;
    }
    const sprint = !blockedInput && !!keys.shift && len > 0.001 && (P.stamina == null || P.stamina > 0);
    const wantSpeed = len > 0.001 ? (sprint ? R.sprint : R.cruise) : 0;
    const accel = wantSpeed > W.v ? 8.5 + R.cruise * 0.7 : 5.5 + R.cruise * 0.35;
    const dv = Math.max(-accel * fdt, Math.min(accel * fdt, wantSpeed - W.v));
    W.v = Math.max(0, W.v + dv);
    P.sprint = sprint; P.speed = W.v;

    const time = ((typeof performance !== "undefined" ? performance.now() : Date.now()) * 0.001) % 3600;
    if (W.v > 0.001) {
      const wf = CBZ.waterField;
      if (wf && wf.moveInWater) {
        const nav = wf.moveInWater(P.pos.x, P.pos.z, ride.head, W.v * fdt,
          a.waterClearance || 8, time, W.nav);
        P.pos.x = nav.x; P.pos.z = nav.z;
        if (nav.blocked) W.v *= 0.35;
        ride.head = nav.heading;
      } else {
        P.pos.x += Math.cos(ride.head) * W.v * fdt;
        P.pos.z += Math.sin(ride.head) * W.v * fdt;
      }
    }

    const surf = seaY(P.pos.x, P.pos.z);
    const depth = waterDepth(P.pos.x, P.pos.z);
    const vin = blockedInput ? 0 : (keys[" "] ? 1 : ((keys.control || keys.c) ? -1 : 0));
    if (W.breachCd > 0) W.breachCd = Math.max(0, W.breachCd - dt);
    if (W.airborne) {
      W.vy -= 17.5 * fdt;
      W.y += W.vy * fdt;
      W.pitch = Math.max(-0.72, Math.min(1.18, Math.atan2(W.vy, Math.max(4, W.v))));
      if (W.vy < 0 && W.y <= surf - Math.max(0.18, (a.swimDepth || 1) * 0.12)) {
        W.airborne = false; W.y = surf - Math.max(0.22, (a.swimDepth || 1) * 0.18);
        W.vy = -Math.min(3.8, Math.max(1.8, Math.abs(W.vy) * 0.22));
        W.v *= 0.78; W.breachCd = 1.15;
        AQUATIC_AUDIT.reentries++;
        if (CBZ.waterSplashAt) CBZ.waterSplashAt(P.pos.x, surf, P.pos.z, 2.8);
        if (CBZ.sfx) { try { CBZ.sfx("water", { volume: 1.1, force: true }); } catch (e) {} }
        if (CBZ.shake) CBZ.shake(0.62);
      }
    } else {
      const wantVy = vin > 0 ? (R.rise || 4) : (vin < 0 ? -(R.dive || 4) : 0);
      const va = vin ? 12 : 5.5;
      W.vy += Math.max(-va * fdt, Math.min(va * fdt, wantVy - W.vy));
      if (!vin) W.vy *= Math.exp(-2.8 * fdt);
      W.y += W.vy * fdt;
      const bedY = surf - depth + Math.max(0.35, (a.species.scale || 1) * 0.32);
      const topY = surf - Math.max(0.28, (a.swimDepth || 1) * (R.breach ? 0.36 : 0.72));
      if (W.y < bedY) { W.y = bedY; if (W.vy < 0) W.vy = 0; }
      if (W.y > topY) { W.y = topY; if (W.vy > 0) W.vy *= 0.42; }
      W.pitch += (Math.max(-0.62, Math.min(0.72, W.vy * 0.115)) - W.pitch) * Math.min(1, fdt * 4.2);
      if (R.breach && sprint && vin > 0 && W.breachCd <= 0 && W.vy > 1.2 && W.y >= topY - 0.08) {
        W.airborne = true; W.vy = R.breachVel || 15.5;
        W.v = Math.max(W.v, R.sprint * 1.04); W.pitch = 0.78;
        AQUATIC_AUDIT.breaches++;
        if (CBZ.waterSplashAt) CBZ.waterSplashAt(P.pos.x, surf, P.pos.z, 2.2);
        if (CBZ.sfx) { try { CBZ.sfx("water", { volume: 1, force: true }); } catch (e) {} }
        if (CBZ.shake) CBZ.shake(0.42);
      }
    }
    W.roll += ((shortestAngle(ride.head - W.lastHead) / fdt) * -0.065 - W.roll) * Math.min(1, fdt * 4);
    W.roll = Math.max(-0.42, Math.min(0.42, W.roll)); W.lastHead = ride.head;
    P.pos.y = W.y + aquaticSeatY(V, W.pitch + ride.attackPitch);
    P.vy = W.vy; P.grounded = false; P._fallPeak = 0;
    P._swim = false; P._aquaticMount = a;
    return true;
  };

  function canRide(a) {
    return !!(a && !a.dead && rideDef(a.species) && a.grow == null &&
      (a.tamed || (ALLCTL() && a.species && a.species.aquatic)));
  }
  function mount(a) {
    if (!canRide(a) || ride.mount) return;
    const P = CBZ.player;
    // A mount cannot simultaneously be somebody else's seized victim/attacker.
    // predator.js owns the only legal release path (camera, jaw pose, pins and
    // Euler order all need refunding), so ask it before taking the body.
    if (CBZ.predatorRelease) CBZ.predatorRelease(a, "mounted");
    ride.mount = a; a.ridden = true; a.stay = false; a.goTo = null;
    petRelease(a);                                    // never ride a seated animal
    ride.lx = P.pos.x; ride.lz = P.pos.z; ride.phase = 0;
    ride.visual = rideVisualSpec(a.species, a.group);
    const aquatic = !!ride.visual.aquatic;
    ride.head = aquatic ? (a.heading || 0) : Math.atan2(P.pos.z - a.pos.z, P.pos.x - a.pos.x);
    // step onto the animal (you walk to IT, it doesn't snap to you)
    P.pos.x = a.pos.x; P.pos.z = a.pos.z;
    ride.water = aquatic ? {
      y: a.group.position.y,
      v: 0, vy: 0, pitch: a.group.rotation.z || 0, roll: a.group.rotation.x || 0,
      airborne: false, breachCd: 0, lastHead: ride.head,
      nav: { x: a.pos.x, z: a.pos.z, heading: ride.head, blocked: false, shore: -999 },
    } : null;
    if (aquatic) {
      P.pos.y = ride.water.y + aquaticSeatY(ride.visual, ride.water.pitch);
      P.vy = 0; P.grounded = false; P._swim = false; P._aquaticMount = a;
      AQUATIC_AUDIT.mounts++; AQUATIC_AUDIT.lastSpecies = a.species.id;
    } else {
      P.pos.y = groundY(P.pos.x, P.pos.z); P.vy = 0; P.grounded = true;
      P._aquaticMount = null;
    }
    P._mountedAnimal = a;
    P._rideScale = ride.visual.mult;
    P._rideJump = ride.visual.jump;
    if (CBZ.playerChar) CBZ.playerChar.riding = {
      width: ride.visual.width, moving: false, airborne: false, phase: 0
    };
    ride.attackT = ride.attackCd = 0; ride.attackHitP = -1; ride.target = null; ride.targetKind = null;
    const help = aquatic
      ? (ride.visual.breach ? " · hold sprint + rise near the surface to BREACH; E dismounts." :
        (ride.visual.attack ? " · Fire bites; E dismounts." : " · rise/dive with Jump/C; E dismounts."))
      : " · E to dismount.";
    note("Riding " + (a.petName || a.species.name) + help, 2.8);
  }
  // One public route for direct-touch/controller helpers. Tamed animals mount
  // immediately; a wild animal can be attempted, but strength/danger matters.
  // Failure does not show a fake lock: the animal reacts in-world and may turn
  // on the player. Success is deliberately uncommon for dangerous wildlife and
  // establishes the same persistent tame relationship as feeding.
  function attemptMount(a) {
    if (!a || a.dead || a.external || !rideDef(a.species) || a.grow != null) return false;
    if (ride.mount) { if (ride.mount === a) dismount(); return true; }
    // The world object is the iPad button. Aquatic actors are already difficult
    // to reach in a moving water column; tapping one mounts it immediately and
    // does not silently turn a megalodon into a 3.5%-chance menu gamble.
    if (a.species.aquatic && ALLCTL()) { mount(a); return ride.mount === a; }
    if (a.tamed) { mount(a); return ride.mount === a; }

    const level = Math.max(1, (g.level || g.cityLevel || 1) | 0);
    const danger = Math.max(0, Math.min(1, a.species.danger || 0));
    const size = Math.max(0.7, a.species.scale || 1);
    const chance = Math.max(0.035, Math.min(0.42, 0.13 + level * 0.004 - danger * 0.16 - Math.max(0, size - 1.3) * 0.055));
    if (Math.random() <= chance) {
      a.tamed = true;
      a.petName = a.petName || NAMES[(Math.random() * NAMES.length) | 0];
      a.stay = false;
      note("You hold on. " + a.petName + " accepts you, for now.", 2.5, { urgent: true });
      mount(a);
      return ride.mount === a;
    }

    a.alarm = Math.max(a.alarm || 0, 5);
    // real state-machine states only: "charge" turns on you and later gives up
    // on its own; the old "attack" label had no handler and froze the animal.
    a.state = danger >= 0.28 ? "charge" : "flee";
    a.stateT = 5;
    if (CBZ.faceAnimalHeading && CBZ.player && CBZ.player.pos) {
      const dx = CBZ.player.pos.x - a.pos.x, dz = CBZ.player.pos.z - a.pos.z;
      faceAnimal(a, Math.atan2(dz, dx));
    }
    note((danger >= 0.28 ? "It throws you off and wheels around!" : "It bucks free and bolts."), 2.1, { urgent: danger >= 0.28 });
    if (CBZ.player && danger >= 0.35) {
      const dx = CBZ.player.pos.x - a.pos.x, dz = CBZ.player.pos.z - a.pos.z;
      const d = Math.max(0.2, Math.hypot(dx, dz));
      CBZ.player.pos.x += dx / d * 0.7;
      CBZ.player.pos.z += dz / d * 0.7;
      CBZ.player.vy = Math.max(CBZ.player.vy || 0, 2.2 + danger * 2.5);
      CBZ.player.grounded = false;
    }
    return true;
  }
  function dismount() {
    const a = ride.mount; if (!a) return;
    const P = CBZ.player;
    const wasAquatic = aquaticMounted(a), W = ride.water;
    ride.mount = null; a.ridden = false;
    ride.visual = null; ride.water = null;
    ride.attackT = ride.attackCd = 0; ride.attackHitP = -1; ride.target = null; ride.targetKind = null;
    ride.attackPitch = ride.attackRoll = 0;
    a._atkAnim = -1;
    if (CBZ.swimJaw) CBZ.swimJaw(a, 0);
    P._mountedAnimal = null;
    P._aquaticMount = null;
    P._rideScale = 1; P._rideJump = 0;
    if (CBZ.playerChar) {
      CBZ.playerChar.riding = null;
      if (CBZ.playerChar.group) { CBZ.playerChar.group.rotation.x = 0; CBZ.playerChar.group.rotation.z = 0; }
    }
    // Slide off beside the mount. Land can use either flank; water chooses a
    // flank that remains navigable so a dolphin running parallel to a beach
    // cannot deposit its rider six inches across the shoreline mask.
    if (ALLCTL()) {
      const side = ride.head + Math.PI / 2;
      const off = 1.1 + (a.species.scale || 1) * 0.55;
      if (wasAquatic) {
        const wf = CBZ.waterField, x0 = P.pos.x, z0 = P.pos.z;
        const lx = x0 + Math.cos(side) * off, lz = z0 + Math.sin(side) * off;
        const rx = x0 - Math.cos(side) * off, rz = z0 - Math.sin(side) * off;
        if (wf && wf.isNavigableWater && wf.isNavigableWater(lx, lz, 0)) { P.pos.x = lx; P.pos.z = lz; }
        else if (wf && wf.isNavigableWater && wf.isNavigableWater(rx, rz, 0)) { P.pos.x = rx; P.pos.z = rz; }
        // Both sides can be a harbour wall: remain at the known-valid animal
        // root and let the swimmer move clear instead of guessing onto land.
      } else {
        P.pos.x += Math.cos(side) * off; P.pos.z += Math.sin(side) * off;
      }
    } else P.pos.x += 1.4;                            // legacy fixed step (flag off)
    if (wasAquatic) {
      // Hand the rider straight into the existing swimmer at the height they
      // actually left the saddle. citySwimBegin owns buoyancy/breath from here;
      // the tiny downward velocity lets its fallback entry seam catch this too.
      P.vy = -0.15; P.grounded = false;
      if (CBZ.citySwimBegin) CBZ.citySwimBegin({ y: P.pos.y, vx: Math.cos(ride.head) * ((W && W.v) || 0) * 0.35,
        vz: Math.sin(ride.head) * ((W && W.v) || 0) * 0.35 });
    } else {
      P.pos.y = groundY(P.pos.x, P.pos.z); P.vy = 0; P.grounded = true;
      a.group.position.set(a.pos.x, groundY(a.pos.x, a.pos.z), a.pos.z);
    }
  }
  CBZ.cityDismount = dismount;   // other systems (death, cars) can force it
  CBZ.cityCanRideAnimal = function (a) { return !!(a && !a.dead && !a.external && rideDef(a.species) && a.grow == null); };
  CBZ.cityMountAnimal = attemptMount;
  CBZ.cityMountedAnimal = function () { return ride.mount; };

  // FINAL PRESENTATION OWNER. wildlife.js registers its numbered updater from
  // inside the landmass build, after loop.js's one-time updater sort, so its
  // nominal 47.1 actually runs at the tail of the updater array. An onUpdate
  // saddle pass therefore got overwritten even at "47.6": the swim animator
  // pitched the dolphin after the rider was seated. `always` is a separate,
  // boot-sorted phase that runs after every updater; 49.8 seats the assembly
  // after that late animal tick and immediately before camera.js at 50.
  CBZ.onAlways(49.8, function (dt) {
    const playing = g.state === "playing";
    if (!playing) dt = 0;
    else if (!dt || dt > 0.5) dt = 0.05;
    const a = ride.mount; if (!a) return;
    const P = CBZ.player;
    // forced dismount: death, cars, the mount dying under you
    if (!P || P.dead || P.driving || a.dead) { dismount(); return; }
    const R = rideDef(a.species);
    if (!R) { dismount(); return; }                     // roster flag flipped mid-ride
    const V = ride.visual || (ride.visual = rideVisualSpec(a.species, a.group));
    P._mountedAnimal = a;
    P._rideScale = R.mult;                              // republish (wounds etc. can't stick)
    P._rideJump = V.jump;
    const gx = P.pos.x, gz = P.pos.z;
    const mdx = gx - ride.lx, mdz = gz - ride.lz;
    const W = R.aquatic ? ride.water : null;
    const moving = W ? W.v > 0.08 : (mdx * mdx + mdz * mdz) > 1e-6;
    if (moving && !W) {
      if (ALLCTL()) {
        // the mount TURNS toward the travel direction at a clamped rate (big
        // animals swing slower) instead of pivot-snapping under the rider.
        const want = Math.atan2(mdz, mdx);
        let hd = want - ride.head;
        while (hd > Math.PI) hd -= 2 * Math.PI; while (hd < -Math.PI) hd += 2 * Math.PI;
        const trMax = (7.5 / (1 + (a.species.scale || 1) * 0.35)) * dt;
        if (hd > trMax) hd = trMax; else if (hd < -trMax) hd = -trMax;
        ride.head += hd;
      } else ride.head = Math.atan2(mdz, mdx);        // legacy snap (flag off)
    }
    ride.lx = gx; ride.lz = gz;
    const airborne = W ? !!W.airborne : (!P.grounded || Math.abs(P.vy || 0) > 0.05);
    // Gallop bob only while grounded and moving. Airborne motion is the shared
    // ballistic root itself; adding a second sine there would make the animal
    // detach visually from its collision trajectory.
    ride.phase += dt * (moving ? 9 : 0.6);
    const bob = !W && moving && !airborne ? Math.abs(Math.sin(ride.phase)) * 0.09 * (a.species.scale || 1) : 0;
    const rootY = W ? W.y : P.pos.y;
    a.group.position.set(gx, rootY + bob, gz);
    faceAnimal(a, ride.head);
    if (W) {
      if (playing) tickAquaticAttack(a, dt);
      a.group.rotation.x = W.roll + ride.attackRoll;
      a.group.rotation.z = W.pitch + ride.attackPitch;
    }
    // Land keeps the physical player root at the animal's feet so ordinary
    // gravity/collision carry both. Water keeps its physical animal root in W.y
    // and publishes the rider-height root to P.pos.y for correct camera framing.
    // In both cases the authored socket is transformed by the animal rotation,
    // so the rider stays attached through a dive, bite and airborne breach.
    const ch = CBZ.playerChar;
    if (ch && ch.group) {
      const hs = (ch.group.userData && ch.group.userData.humanScale) || 1;
      const hip = (ch.hipY || 0.95) * hs;
      seatV.set(V.x, V.y, 0).applyEuler(a.group.rotation);
      // Rotate ABOUT THE HIPS, not the feet. Merely pitching a feet-rooted
      // human after placing it on the socket sweeps the pelvis off the animal
      // during a dive/breach (the focused contract caught a 20 cm separation).
      ch.group.rotation.x = W ? (W.roll + ride.attackRoll) * 0.42 : 0;
      ch.group.rotation.y = Math.PI / 2 - ride.head;
      ch.group.rotation.z = W ? (W.pitch + ride.attackPitch) * 0.58 : 0;
      riderHipV.set(0, hip, 0).applyEuler(ch.group.rotation);
      ch._mountSocketX = gx + seatV.x;
      ch._mountSocketY = rootY + bob + seatV.y;
      ch._mountSocketZ = gz + seatV.z;
      const charY = rootY + bob + seatV.y - riderHipV.y;
      ch.group.position.set(gx + seatV.x - riderHipV.x, charY, gz + seatV.z - riderHipV.z);
      if (W) P.pos.y = charY;                           // camera follows the rider, not a whale's belly
      ch.riding = {
        width: V.width,
        moving: moving,
        airborne: airborne,
        phase: ride.phase,
        speed: P.speed || 0,
        aquatic: !!W,
        attacking: ride.attackT > 0,
      };
      // physics.js normally animates the player before this late placement.
      // Its aquatic-controller early return is intentional, so this owner runs
      // the exact same canonical rig once here instead of leaving a frozen rider.
      if (W && CBZ.animChar) CBZ.animChar(ch, P.speed || 0, dt);
    }
  });

  CBZ.aquaticMountAudit = function () {
    const ids = [], S = CBZ.WILDLIFE_SPECIES || {};
    for (const id in S) if (S[id] && S[id].aquatic && rideDef(S[id])) ids.push(id);
    const a = ride.mount, W = ride.water;
    return {
      rideableSpecies: ids.length, species: ids,
      mounted: !!(a && W), mountedSpecies: a && W ? a.species.id : null,
      saddle: a && ride.visual ? { x: ride.visual.x, y: ride.visual.y, width: ride.visual.width } : null,
      placedSocket: CBZ.playerChar && Number.isFinite(CBZ.playerChar._mountSocketX)
        ? { x: CBZ.playerChar._mountSocketX, y: CBZ.playerChar._mountSocketY, z: CBZ.playerChar._mountSocketZ }
        : null,
      speed: W ? +(W.v || 0).toFixed(2) : 0,
      verticalSpeed: W ? +(W.vy || 0).toFixed(2) : 0,
      airborne: !!(W && W.airborne), attacking: ride.attackT > 0,
      attackTarget: ride.targetKind,
      attackTargetDistance: a && ride.target && ride.target.group
        ? +biteDistance(ride.target, jawWorld(a)).toFixed(2) : null,
      mounts: AQUATIC_AUDIT.mounts, breaches: AQUATIC_AUDIT.breaches,
      reentries: AQUATIC_AUDIT.reentries, attacks: AQUATIC_AUDIT.attacks,
      hits: AQUATIC_AUDIT.hits, shipBites: AQUATIC_AUDIT.shipBites,
      lastSpecies: AQUATIC_AUDIT.lastSpecies, lastTarget: AQUATIC_AUDIT.lastTarget,
    };
  };

  // ============================================================
  //  INTERACTIONS — walk up to any live animal; the panel shows the verbs.
  // ============================================================
  function nearestAnimal(px, pz) {
    let best = null, bd = REACH * REACH;
    const list = animals();
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      // carcasses/mount/dogs have their own flows. Aquatic life IS interactive
      // under ANIMALS_ALL_CONTROLLABLE — swim up to a dolphin and feed it.
      if (a.dead || a.ridden || a.external || (a.species.aquatic && !ALLCTL())) continue;
      const dx = a.pos.x - px, dz = a.pos.z - pz, q = dx * dx + dz * dz;
      if (q < bd) { bd = q; best = a; }
    }
    return best ? { a: best, d: Math.sqrt(bd) } : null;
  }

  function registerInteractions() {
    const I = CBZ.interactions; if (!I) return;
    I.registerSource({
      id: "src-animal", kind: "animal", layers: ["animal"], prio: 6, driving: false,
      find: function (px, pz, ctx, push) {
        if (ride.mount) { push(ride.mount, 0); return; }         // mounted: your mount is the target
        const h = nearestAnimal(px, pz); if (h) push(h.a, h.d);
      },
    });
    I.describe && I.describe("animal", function (a) {
      const sp = a.species;
      const baby = a.grow != null ? "baby " : "";
      if (a.ridden) return { label: "Riding " + (a.petName || sp.name), note: "hold on" };
      if (a.tamed) return { label: "" + a.petName + " the " + baby + sp.name, note: rideDef(sp) ? (a.grow != null ? "too young to ride" : "your loyal mount") : "your companion" };
      if (sp.aquatic && rideDef(sp)) return {
        label: (a.legendary ? "★ " : "") + "A " + baby + sp.name,
        note: a.grow != null ? "too young to ride" : "tap/press the animal to ride",
      };
      return {
        label: (a.legendary ? "★ " : "") + "A " + baby + sp.name,
        note: feedItemFor(sp) ? ("hold food out to tame (" + (a.feeds || 0) + "/" + feedsNeeded(sp) + ")") : (isPredator(sp) ? "tameable, bring MEAT" : "tameable, bring food"),
      };
    });
    // DISMOUNT (only while riding)
    I.register("animal", {
      id: "animal-dismount", slot: "e", prio: 40,
      canShow: function (a) { return !!a.ridden; },
      label: "Dismount",
      onSelect: function () { dismount(); },
    });
    // FEED & TAME (wild) / FEED (tamed heal) — hold E
    I.register("animal", {
      id: "animal-tame", slot: "e", hold: true, prio: 20,
      canShow: function (a) { return !a.ridden && !a.tamed && !!feedItemFor(a.species); },
      label: "Feed & tame",
      onSelect: function (a) { tameFeed(a); },
    });
    I.register("animal", {
      id: "animal-pet", slot: "e", prio: 18,
      canShow: function (a) { return a.tamed && !a.ridden; },
      label: "Pet",
      // the affection layer ANSWERS: it nuzzles back (and a dog's tail says it
      // out loud). No new FX — one flag the beat scheduler is already reading.
      onSelect: function (a) {
        a._petCheckIn = 1; a._beatT = 0;
        note("" + a.petName + " leans into you.", 1.6);
      },
    });
    // MOUNT
    I.register("animal", {
      id: "animal-mount", slot: "i", prio: 22,
      canShow: function (a) { return canRide(a) && !ride.mount; },
      label: "Ride",
      onSelect: function (a) { mount(a); },
    });
    // BRONCO-BREAK a WILD mount (ANIMALS_ALL_CONTROLLABLE): same gamble the
    // touch helpers already take — succeed and it's tamed under you, fail and
    // it bucks you off (a dangerous one turns on you).
    I.register("animal", {
      id: "animal-break", slot: "i", prio: 21,
      canShow: function (a) {
        return ALLCTL() && !ride.mount && a && !a.tamed && !a.dead && !a.species.aquatic &&
          !!rideDef(a.species) && a.grow == null;
      },
      label: "Mount",
      onSelect: function (a) { attemptMount(a); },
    });
    // SEND (go-to command): point where you're looking, the companion runs
    // there and waits. Works on every tamed land animal, snake or pet.
    I.register("animal", {
      id: "animal-send", slot: "l", prio: 15,
      canShow: function (a) { return ALLCTL() && a.tamed && !a.ridden && !a.species.aquatic; },
      label: function (a) { return a.goTo ? "Heel" : "Send ahead"; },
      onSelect: function (a) {
        if (a.goTo) { a.goTo = null; a.stay = false; note(a.petName + " falls back in.", 1.4); return; }
        const P = CBZ.player && CBZ.player.pos; if (!P) return;
        const yaw = CBZ.cam ? (CBZ.cam.yaw || 0) : 0;
        a.goTo = { x: P.x - Math.sin(yaw) * 16, z: P.z - Math.cos(yaw) * 16 };
        a.stay = false;
        note(a.petName + " runs ahead!", 1.6);
      },
    });
    // STAY / FOLLOW
    I.register("animal", {
      id: "animal-stay", slot: "j", prio: 16,
      canShow: function (a) { return a.tamed && !a.ridden; },
      label: function (a) { return a.stay ? "Follow" : "Sit & stay"; },
      // "Stay" used to mean "stop moving". It now means what it says: the sit
      // pose runs off the SAME phase the affection ritual uses.
      onSelect: function (a) { a.stay = !a.stay; note(a.petName + (a.stay ? " sits and stays." : " falls in beside you."), 1.6); },
    });
    // FEED a tamed animal (heals it)
    I.register("animal", {
      id: "animal-feed", slot: "k", prio: 14,
      canShow: function (a) { return a.tamed && !a.ridden && !!feedItemFor(a.species) && a.hp < a.maxHp; },
      label: "Feed",
      onSelect: function (a) {
        const item = feedItemFor(a.species); if (!item) return;
        if (CBZ.cityEcon && CBZ.cityEcon.take) CBZ.cityEcon.take(item, 1);
        a.hp = Math.min(a.maxHp, a.hp + Math.round(a.maxHp * 0.25));
        note("" + a.petName + " eats the " + item + " (+health).", 1.8);
      },
    });
  }

  // register once the world (and the interaction registry) exists.
  CBZ.addLandmass(function () { registerInteractions(); return null; }, 97);
})();
