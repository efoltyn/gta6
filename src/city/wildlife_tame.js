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

  /* ============================================================
     THE WATER COLUMN IS A PLACE, NOT A CEILING (owner, 2026-08-25):
       "in nat disaster world on touch when in the water you get rise and dive
        and there's real underwater; in shark sim game there's just water
        surface and you can't really dive and jumps are fake."

     Three separate faults sat behind that one sentence, and each gets its own
     flag so the before/after is one build and a query string.

     SHARK_RIDE_DIVE — the ride could descend (the body genuinely went to 7 m,
       measured) but the CAMERA could not follow: systems/camera.js frames an
       island player from a 2.08 m pivot on a ~7 m boom, so diving seven metres
       put the lens 0.69 m under the surface and left it there. Every underwater
       treatment in the game (world/water_underwater.js — fog, caustics, god
       rays, the muffle) is a read-only observer of the CAMERA, so from the
       saddle the whole system was unreachable and the sea read as a lid. This
       flag adds the dive rig: a late camera pass (order 50.4, i.e. after
       camera.js's one writer at 50 and BEFORE water_underwater.js's observer at
       50.5) that eases the lens onto the body's own line as the body goes down,
       plus honest dive/rise authority and body pitch. It builds NO second
       underwater system — it just puts the eye where the existing one can see.
     SHARK_RIDE_TOUCH_VERT — the vertical axis on a thumb. The survival swimmer
       has had DIVE/RISE pills since SURV_SHARED_SWIM (systems/touch_vehicle.js
       "swim" context); the aquatic MOUNT had a DISMOUNT pill and nothing else,
       so on iPad the shark could not be told to go down at all. This publishes
       the same hold seam city/swim.js publishes (CBZ.citySwimVertical) so the
       touch layer drives the mount through one named API instead of poking keys.
     SHARK_BREACH — `breach: id === "dolphin"` was the whole reason a shark's
       jump was fake: only a dolphin was ever allowed to leave the water, so a
       great white "jumping" was the surface clamp letting go for a moment.
       Every strong swimmer now gets a REAL ballistic arc, sized to its own
       body (see aquaticRideDef), with a re-entry splash and shake to match.
     MARINE_SIT_DEEPER — "orcas and sharks are just slightly too high up in the
       water … this out-of-water bit should go under water". A resting-depth
       trim on the ridden body's surface clamp; the wild bodies' own trim lives
       with their locomotion (city/wildlife_shark.js, city/wildlife_orca.js).
  ============================================================ */
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.SHARK_RIDE_DIVE == null) CFG.SHARK_RIDE_DIVE = true;
  if (CFG.SHARK_RIDE_TOUCH_VERT == null) CFG.SHARK_RIDE_TOUCH_VERT = true;
  if (CFG.SHARK_BREACH == null) CFG.SHARK_BREACH = true;
  if (CFG.MARINE_SIT_DEEPER == null) CFG.MARINE_SIT_DEEPER = true;
  const DIVE_ON = () => CFG.SHARK_RIDE_DIVE !== false;
  const BREACH_ON = () => CFG.SHARK_BREACH !== false;
  const DEEPER_ON = () => CFG.MARINE_SIT_DEEPER !== false;
  // The one gravity the airborne mount integrates under, shared with the launch
  // solve so "how much air" and "how fast do I leave" can never disagree.
  const BREACH_G = 17.5;
  // How far a breaching body comes over onto its flank at the top of the arc.
  // 0.42 rad is 24 degrees — enough that the whole side of the animal turns to
  // the camera, short of the barrel roll that would read as a dolphin trick.
  const BREACH_ROLL = 0.42;
  // Caller-owned scratch for CBZ.marineBreachShed (see the waterline section):
  // the trail runs every frame of an arc and must not allocate.
  const _rideShed = {};
  const _rideWL = {};

  /* ---- HOW BIG IS THE BODY UNDER THE RIDER, RIGHT NOW --------------------
     Every `a.species.scale` in this file meant "how big is this animal" and
     answered with "how big is this SPECIES", which was already wrong for the
     individual (a runt and a monster great white rode identically) and became
     wrong every second once animals grow by eating: a shark that doubles
     mid-match would keep a saddle socket, a camera boom, a shore threshold and
     a turn rate solved for the body it had when the player climbed on.

     One reader, consumed defensively (city/wildlife_traits.js is another block
     and may load either side of this one), falling back to the group's own
     live scale before the species constant. */
  function liveScale(a) {
    if (!a) return 1;
    if (typeof CBZ.wildlifeScale === "function" && a.species) {
      try { const s = +CBZ.wildlifeScale(a); if (s > 0 && isFinite(s)) return s; } catch (e) {}
    }
    const g = a.group;
    if (g && g.scale && g.scale.x > 0) return g.scale.x;
    return (a.species && a.species.scale) || 1;
  }

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
    // ---- THE BALLISTIC ARC IS SIZED TO THE BODY, NOT TYPED PER SPECIES ----
    // `breach: id === "dolphin"` was the fake jump. Give every strong swimmer
    // the real transition and the launch speed falls straight out of school
    // physics: to clear `apex` metres of air against the same BREACH_G the
    // airborne integrator below uses, you leave the water at sqrt(2·g·apex).
    // So the number authored here is the one a person can actually picture —
    // HOW MUCH AIR THIS ANIMAL GETS — and the arc, the hang time and the
    // re-entry speed are all consequences of it.
    //
    // A dolphin keeps its measured 6.9 m (sqrt(2·17.5·6.9) = 15.53 ≈ the 15.5
    // this file shipped), because that leap is the one the owner approved.
    // Everything else scales with the hull: a bull shark clears about its own
    // depth, a great white clears a body length, and a megalodon throws 5.8 m
    // of air and stays up for 1.6 SECONDS — enormous and heavy, which is what
    // makes it read as mass rather than as a bigger dolphin.
    // (the non-dolphin solve is breachApexFor() below — ONE law, so a wild
    //  shark in city/wildlife_shark.js and the player's mount jump identically)
    const apex = id === "dolphin" ? 6.9 : breachApexFor(scale);
    const canBreach = BREACH_ON() ? (hunter || id === "dolphin" || /whale|ray|tuna|marlin|sailfish/.test(id))
                                  : id === "dolphin";
    return (AQUATIC_RIDES[sp.id] = {
      y: Math.max(0.45, 0.92 * scale),
      mult: cruise / (((CBZ.TUNE && CBZ.TUNE.walkSpeed) || 6.4)),
      aquatic: true,
      cruise: cruise,
      sprint: cruise * (id === "dolphin" ? 1.78 : 1.56),
      turn: Math.max(0.75, 3.8 / (0.65 + scale * 0.55)),
      // Vertical authority under SHARK_RIDE_DIVE. The old numbers topped a bull
      // shark out at 4.5 m/s down, which is a lift, not a dive — and a body the
      // size of a megalodon moving 4.5 m/s down looks becalmed. Sounding is
      // faster than surfacing for every real fish (gravity is not the only
      // thing helping, but buoyancy is the thing fighting the climb), so dive
      // keeps the bigger of the two coefficients.
      rise: DIVE_ON() ? Math.max(3.6, Math.min(9.5, cruise * 0.48))
                      : Math.max(3.1, Math.min(6.5, cruise * 0.38)),
      dive: DIVE_ON() ? Math.max(4.4, Math.min(11.5, cruise * 0.62))
                      : Math.max(3.5, Math.min(7.2, cruise * 0.42)),
      breach: canBreach,
      breachVel: canBreach ? Math.sqrt(2 * BREACH_G * apex) : 0,
      breachApex: canBreach ? apex : 0,
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
      // The vertical half of the profile was never published, so nothing could
      // check the one claim the dive/breach work makes: how fast this body
      // leaves the water and how much air that buys it.
      rise: R.rise || 0, dive: R.dive || 0,
      breachVel: R.breachVel || 0, breachApex: R.breachApex || 0,
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
  function girth(p) { return Math.max(0, liveScale(p) - 0.8) * 1.2; }
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
    lensT: 0,                 // refractory on the bite's camera jolt (see damageBiteTarget)
    hurtT: 0, hurtAmp: 0, hurtAcc: 0,   // THE ONLY THING THAT SHAKES THE LENS — see rideDamageFelt
    // the above-weight-kill ceremony (see THE CLAMP below)
    clampT: 0, clampDur: 0, clampVictim: null, clampChum: null, clampBeat: -1, clampOrder: "",
  };
  const seatV = new THREE.Vector3();
  const riderHipV = new THREE.Vector3();
  // the same seat, solved WITHOUT the bite animation — see "THE LENS DOES NOT
  // RIDE THE BITE" at the 49.8 presentation pass
  const camSeatV = new THREE.Vector3();
  const camEul = new THREE.Euler();
  const jawV = new THREE.Vector3();
  const biteV = new THREE.Vector3();
  const biteBox = new THREE.Box3();
  const biteNormal = new THREE.Vector3();
  const AQUATIC_AUDIT = {
    mounts: 0, breaches: 0, reentries: 0, attacks: 0, hits: 0, shipBites: 0,
    clamps: 0,
    lastSpecies: null, lastTarget: null,
    // THE ARC, as numbers. Everything below is written by the breach itself and
    // read by tools/visual-presets/shark-breach.mjs, so the pictures and the
    // table describe the same jump.
    lastApex: 0, lastAirT: 0, lastPitchUp: 0, lastPitchDown: 0, lastRoll: 0,
    lastAlignErr: 0, lastEntryKg: 0, lastEntrySpd: 0,
    lastEntryKind: "", trailDrops: 0, crossDrops: 0,
  };

  function aquaticMounted(a) { return !!(a && a.species && a.species.aquatic && ride.water); }
  function seaY(x, z) {
    if (CBZ.citySeaHeightAt) {
      const y = CBZ.citySeaHeightAt(x, z);
      if (Number.isFinite(y)) return y;
    }
    return CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48;
  }
  /* THE WATER COLUMN, HONESTLY. This used to answer `Math.max(1.2, d)` — a
     floor that meant a ridden body NEVER saw shallow water, so the posture
     solver below always had a metre and a bit of column to sink the animal
     into and a shark in a foot of swash was drawn buried in the sand with a
     metre of imaginary sea over its back. The shallows are the whole point of
     the shark sim; the ride gets the real number. */
  function waterDepth(x, z) {
    if (CBZ.cityWaterDepthAt) {
      const d = CBZ.cityWaterDepthAt(x, z);
      if (Number.isFinite(d)) return Math.max(0, d);
    }
    return 18;
  }
  // World Y of the ground under the body — sand or seabed, the same surface a
  // camera boom and the swimmer clamp to. On dry beach it is ABOVE the sea,
  // which is exactly what a beached animal needs to rest on.
  function bedYAt(x, z) {
    if (CBZ.citySeaBedYAt) {
      const y = +CBZ.citySeaBedYAt(x, z);
      if (Number.isFinite(y)) return y;
    }
    return seaY(x, z) - waterDepth(x, z);
  }

  /* ---- THE SHORE LAW FOR A RIDDEN BODY -----------------------------------
     A wild fish is kept off the rocks by its species clearance because nobody
     is steering it. A MOUNT has a driver, and the owner's note is exactly
     about this: "sharks get blocked like 5 feet from shore when really they
     should be blocked like a couple feet IN the shore; beaching is possible,
     orcas do it really well."

     So the ridden body has one number — the DEPTH of water it grounds in —
     and everything else is derived from it. Roughly a hand's depth for a bull
     shark, a foot for a megalodon: big enough that the animal is visibly
     bottoming out, small enough that every wader on this beach is inside the
     jaws. Deliberately NOT the species spawn clearance (bull 12 ⇒ it used to
     stop in 0.46 m; megalodon ⇒ 1.25 m, fifteen metres off the sand, which
     killed the shark sim's own "megalodon in the surf" promise). */
  function rideGroundDepth(scale) {
    return Math.min(0.45, 0.14 + Math.max(0.35, scale || 1) * 0.075);
  }
  // Is there swimmable water here for a body that grounds at `groundD`? The
  // DEPTH oracle is the shore law; the nav field is kept only as the fence
  // that stops a mount leaving the world or grinding a quay wall.
  function rideCanSwim(x, z, groundD, scale) {
    if (waterDepth(x, z) < groundD) return false;
    const wf = CBZ.waterField;
    if (wf && wf.isNavigableWater &&
        !wf.isNavigableWater(x, z, Math.max(1.2, Math.max(0.35, scale || 1) * 0.9))) return false;
    return true;
  }
  /* Blocked head-on: slide ALONG the shore instead of dead-stopping into it.
     The old step handed the whole heading to the navigator, so hitting the
     shallows spun the animal; a wall slide keeps the player's aim and just
     stops the component that cannot happen. Shallowest deviation that works
     wins, and ties break toward the deeper water. */
  function rideShoreSlide(x, z, heading, dist, groundD, scale) {
    for (let i = 0; i < 3; i++) {
      const off = 0.45 + i * 0.45;
      let best = null, bestD = groundD;
      for (let s = -1; s <= 1; s += 2) {
        const h = heading + off * s;
        const nx = x + Math.cos(h) * dist, nz = z + Math.sin(h) * dist;
        if (!rideCanSwim(nx, nz, groundD, scale)) continue;
        const d = waterDepth(nx, nz);
        if (d > bestD) { bestD = d; best = { x: nx, z: nz, heading: h }; }
      }
      if (best) return best;
    }
    return null;
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
    return Math.max(3.0, Math.max(0.35, liveScale(a)) * 2.5);
  }
  function selectBiteTarget(a, R) {
    const mouth = jawWorld(a);
    /* THE MOUTH HUNTS WIDER THAN IT CLOSES. Acquisition runs at 1.6x the
       closing reach: startAquaticAttack's lunge is solved from pick.d so it
       covers the difference, the homing in cityAquaticMountStep bends the
       body onto the meal while the jaw is opening, and the contact WINDOW in
       tickAquaticAttack still tests the honest biteReach geometry — a pick
       that stays out of reach is a whiffed lunge, never a phantom kill.
       This is what makes the shark sim's buttonless auto-bite start the
       strike while the food is still a body-length away instead of waiting
       until the mouth is already on it. */
    const best = { target: null, kind: null, d: biteReach(a) * 1.6 };
    const list = animals();
    for (let i = 0; i < list.length; i++) considerBiteTarget(list[i], "animal", mouth, best.d, best);
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) considerBiteTarget(peds[i], "ped", mouth, best.d, best);
    const cops = CBZ.cityCops || [];
    for (let i = 0; i < cops.length; i++) considerBiteTarget(cops[i], "cop", mouth, best.d, best);
    // SURVIVAL: the island's crowd rides its own bus (CBZ.bots, not
    // cityPeds), so a mounted shark's mouth has to be told it exists —
    // this is what makes the shark sim's beach a buffet.
    if (CBZ.islandModeOn(g.mode) && CBZ.bots) {
      const bots = CBZ.bots;
      for (let i = 0; i < bots.length; i++) considerBiteTarget(bots[i], "survivor", mouth, best.d, best);
    }
    if (R.shipBite) {
      const cars = CBZ.cityCars || [];
      for (let i = 0; i < cars.length; i++) if (marineCar(cars[i])) considerBiteTarget(cars[i], "ship", mouth, best.d, best);
    }
    return best;
  }

  /* ============================================================
     A PERSON BITTEN IN THE WATER BLEEDS INTO IT.

     The animal-vs-animal path below has been rich for a while: a chunk off the
     part the teeth closed on, a bloom at the contact point, one arbitrated
     chum trail per wounded body, gore.js's kill cloud when it dies. The three
     HUMAN branches called creatureBiteWound and the damage bus and then simply
     STOPPED — no bloom, no trail, no cloud. A shark could take a swimmer's arm
     off and the sea behind them stayed blue, which is this game's best effect
     missing from the one bite the whole mode exists for.

     Three calls, and every one of them asks the medium instead of assuming it:
       • THE IMPACT, at the real contact point. gore.js's goreImpact is already
         medium-aware — a bloom plus a surface slick under water, a spray plus
         a ground pool in air — so ONE call is right for a shark in twelve
         metres and right for a shark in the swash, and nothing here has to
         re-implement a water test.
       • THE TRAIL, through city/marine_predation.js's arbiter (CBZ.marineBleed)
         and never a raw handle. gore.js caps the WHOLE GAME at twelve chum
         sources and the arbiter owns the "which six of everything bleeding"
         question; opening one per bite here would starve every other bleeder
         on the map. A swimmer that got away now trails blood exactly the way a
         wounded animal does — which is also what makes something else come.
       • THE KILL CLOUD, and only for a death in water deep enough to be IN.
         A wader killed in ankle-deep swash is a beach death, not an underwater
         one, and must not get a plume — so the depth is asked, not assumed
         (1.2 m is gore.js's own SWIMMABLE bar). Nothing else is added on a
         kill: the death has already been through the mode's gore table
         (systems/trauma.js, which finally has a maul row), and that path fires
         its own blooms, slick and chum handle. trail:false so one corpse never
         spends two of the twelve slots.

     IT COSTS THE SNACK NOTHING. Only the three human kinds reach any of this,
     so eating forty mackerel is the same flat, fast meal it has always been. */
  const SWIMMABLE = 1.2;            // gore.js's own bar for "in it", not "standing in it"
  const _biteDir = { x: 1, y: 0.12, z: 0 };
  const _clampDir = { x: 0, y: 0, z: 0 };
  const _biteAt = { x: 0, y: 0, z: 0 };
  const _biteWo = { dir: _biteDir, kill: false };
  const _biteImp = { dir: _biteDir, amount: 1, mist: false, pool: true, sfx: false };
  function biteMedium(x, y, z) {
    if (typeof CBZ.goreMedium === "function") {
      try { return CBZ.goreMedium(x, y, z); } catch (e) {}
    }
    if (typeof CBZ.predatorMedium === "function") {
      try { return CBZ.predatorMedium(x, y, z); } catch (e) {}
    }
    return (y < seaY(x, z) && waterDepth(x, z) > 0.05) ? "water" : "air";
  }
  /* THE MOUTH CLOSES WHERE IT ACTUALLY CLOSED. creature_combat's biteWound
     used to stamp every bite at the victim's centre at a fixed height, and
     systems/wounds.js reads that height as an UPPER LEG — so a shark that
     closed its jaws on a swimmer's shoulder marked their thigh, every time,
     for every animal in the game. The clamped contact point on the victim's
     own surface has been sitting in biteV one frame earlier the whole time and
     was simply never passed. `kill` is what lets the mouth take a limb with
     it; the caller knows whether this blow is the one that ends them. */
  function biteHumanWound(a, target, kill) {
    if (typeof CBZ.creatureBiteWound !== "function") return;
    _biteWo.kill = !!kill;
    try { CBZ.creatureBiteWound(a, target, "lunge", _biteAt, _biteWo); } catch (e) {}
  }
  function humanBiteBlood(target, killed, sev) {
    const x = _biteAt.x, y = _biteAt.y, z = _biteAt.z;
    const wet = biteMedium(x, y, z) === "water";
    if (killed) {
      if (wet && waterDepth(x, z) >= SWIMMABLE && typeof CBZ.goreKillCloud === "function") {
        try { CBZ.goreKillCloud(x, y, z, { size: Math.min(2.2, 0.8 + sev), trail: false }); } catch (e) {}
      }
      return;                       // the death bus drew the rest of it
    }
    if (typeof CBZ.goreImpact === "function") {
      _biteImp.amount = Math.max(0.5, Math.min(1.9, 0.8 + sev * 0.9));
      // AEROSOL IS AN AIR EVENT. Asking for mist underwater is asking for the
      // floating pink haze the owner reported; the medium answers it here.
      _biteImp.mist = !wet && sev > 0.85;
      try { CBZ.goreImpact(x, y, z, _biteImp); } catch (e) {}
    }
    // IT SWAM ON MAIMED, AND TRAILING.
    if (wet && typeof CBZ.marineBleed === "function") {
      try { CBZ.marineBleed(target, Math.max(0.35, Math.min(1, sev))); } catch (e) {}
    }
  }

  function damageBiteTarget(a, target, kind) {
    if (!target || target.dead) return false;
    // LIVE SIZE, not the species constant — the same correction liveScale()
    // exists for. Everything below (the knockback, the splash, the shake, the
    // jaw width) is about the body that is actually in the water right now,
    // and in the shark sim that body doubles as it eats.
    const sp = a.species, scale = Math.max(0.35, liveScale(a));
    const mouth = jawWorld(a);
    const dist = biteDistance(target, mouth);
    // Use the same envelope selection used. This especially matters for the
    // megalodon's jaw below a surface hull: accepting a target at 6.5 m and
    // then shrinking the strike to 5.1 m made the visible bite a fake miss.
    if (dist > biteReach(a) || !inBiteFront(mouth, biteV)) return false;
    /* ============================================================
       AND NOW THE GEOMETRY DECIDES WHAT IT WAS WORTH.

       Owner, 2026-08-25: "like agario over and over again for each bite —
       angles of collision decide kills — so a shark at the right angle can
       kill a bigger shark."

       THE TRIGGER IS UNTOUCHED, and that is the whole contract: Shark Sim
       still fires this the instant something is in front of the mouth, move
       is still the only control, and nothing above this line changed. What
       the angle decides is what the bite COSTS and what it DOES — a rear-half
       ambush is worth half again as much and cannot be answered, a bite taken
       in something's face is weakened and gets counter-bitten while you are
       still opening, and swimming nose-first into a bigger mouth is how you
       die. The contest point is biteV, the real clamped contact on the
       target's own surface, so the zone is where the teeth ARE and not where
       your body happens to be.

       IT COSTS THE SNACK NOTHING. systems/bite_angles.js refuses to invent a
       heading, and survivors, peds, cops and boats do not publish one — so
       eating the beach is exactly the flat, fast meal it has always been and
       only an animal-on-animal fight is contested.

       ?cfg_BITE_ANGLES=0 puts the flat bite back. */
    const contest = (typeof CBZ.biteContest === "function")
      ? CBZ.biteContest(a, target, { point: biteV, style: "lunge" }) : null;
    // THE ANSWER WON. Something turned into your charge, bit first, and the
    // thing it bit was you: the swing plays out and bills nothing.
    if (contest && contest.denied) return false;
    const damage = Math.max(1, Math.round(
      Math.max(8, sp.bite || 12) * (contest ? contest.mult : 1)));
    /* THE BITE LINE AND THE CONTACT POINT, RESOLVED ONCE for everything that
       needs them. `biteV` is the clamped contact on the target's own surface
       (biteDistance wrote it above), and the line is the way the mouth is
       actually pointing — the wound, any limb it takes off and the blood all
       leave along it. Copied into a stable scratch because it rides into the
       damage bus and out the far side into systems/trauma.js. */
    _biteDir.x = Math.cos(ride.head); _biteDir.y = 0.12; _biteDir.z = Math.sin(ride.head);
    _biteAt.x = biteV.x; _biteAt.y = biteV.y; _biteAt.z = biteV.z;
    // HOW WIDE IS THIS MOUTH — creature_combat owns the question; threaded onto
    // the kill so gore.js stamps a great white's jaw print, not a dog default.
    const jawR = (typeof CBZ.creatureJawRadius === "function")
      ? CBZ.creatureJawRadius(a, "lunge") : Math.max(0.12, Math.min(1.2, 0.10 + scale * 0.16));
    const biteSev = Math.min(1, 0.5 + scale * 0.3);
    if (kind === "animal") {
      if (!CBZ.cityWildlifeHit) return false;
      CBZ.cityWildlifeHit(target,
        { head: false, point: biteV, dir: _biteDir, from: a.pos },
        { damage: damage, by: a, cause: "eaten by a " + String(sp.name || sp.id).toLowerCase() });
      // A KILL BIGGER THAN YOU IS NOT A CHOMP. See THE CLAMP above; a snack
      // is unaffected because aboveWeight() measures both bodies.
      if (target.dead || target.hp <= 0) beginClamp(a, target);
      else if (CBZ.creatureBiteChunk && aboveWeight(a, target)) {
        // IT SURVIVED THE BITE: IT STILL LEAVES WITH LESS OF ITSELF — and how
        // much less is the angle, same as the damage was. A rear-half ambush
        // takes a real piece of the tail; a bite taken in something's face,
        // while it is biting back at you, barely gets purchase. biteV is the
        // clamped contact on the target's own surface, so the material comes
        // off the part the teeth actually closed on and not off its middle.
        const sev = Math.max(0.25, Math.min(1, 0.7 * (contest ? contest.mult : 1)));
        // _biteDir is the line this mouth came in on — the cuts run along it,
        // and `by` is what puts a severed fin in THIS animal's jaw.
        try {
          CBZ.creatureBiteChunk(target, biteV,
            { jaw: biteReach(a) * 0.32, sev: sev, dir: _biteDir, by: a, bleedS: 12 });
        } catch (e) {}
      }
    } else if (kind === "cop") {
      if (!CBZ.cityHurtCop) return false;
      biteHumanWound(a, target, false);
      CBZ.cityHurtCop(target, damage, {
        fromX: a.pos.x, fromZ: a.pos.z, force: 5 + scale * 2, fling: 2 + scale,
        byPlayer: true,
      });
      humanBiteBlood(target, false, biteSev);
    } else if (kind === "ped") {
      target.hp = (target.hp == null ? 100 : target.hp) - damage;
      const pedDown = target.hp <= 0 && !!CBZ.cityKillPed;
      // the wound is stamped BEFORE the kill, on a body that still has all of
      // itself — and it is told whether this is the blow that ends them, which
      // is what decides whether the mouth takes a piece with it.
      biteHumanWound(a, target, pedDown);
      if (pedDown) {
        CBZ.cityKillPed(target, {
          fromX: a.pos.x, fromZ: a.pos.z, force: 5 + scale * 2, fling: 2 + scale,
          byPlayer: true, point: _biteAt, dir: _biteDir, jaw: jawR,
        }, "eaten by a " + String(sp.name || sp.id).toLowerCase());
      } else if (CBZ.body && CBZ.body.hit) {
        CBZ.body.hit(target, { fromX: a.pos.x, fromZ: a.pos.z, force: 4 + scale * 2, knockdown: 1.1 });
      }
      humanBiteBlood(target, pedDown, biteSev);
    } else if (kind === "survivor") {
      // through the island's own damage bus, so the kill hits the killfeed
      // ("Mia R. was eaten by a bull shark"), the ragdoll fling, the gore
      // table — everything a disaster death already gets. x5 because a
      // shark bite on a person is a resolution, not a health tax.
      if (!CBZ.surv || !CBZ.surv.hurt) return false;
      const lethal = (target.hp == null ? 100 : target.hp) - damage * 5 <= 0;
      biteHumanWound(a, target, lethal);
      CBZ.surv.hurt(target, damage * 5, {
        fromX: a.pos.x, fromZ: a.pos.z, force: 5 + scale * 2, fling: 2 + scale,
        cause: "eaten by a " + String(sp.name || sp.id).toLowerCase(),
        /* WHAT THE DEATH IS ALLOWED TO KNOW. systems/trauma.js hands these
           straight through to gore.js: the real contact point (so the death
           wound lands on the part the teeth closed on, not at the body's
           centre), the mouth's own width, the line it closed along, and the
           medium — a swimmer's chest sits a metre above the swell, which is
           exactly how a wet kill used to test "air" and rain droplets. */
        point: _biteAt, dir: _biteDir, jaw: jawR,
        medium: biteMedium(_biteAt.x, _biteAt.y, _biteAt.z),
        // THE MOUTH OWNS THE LENS FOR THIS MOUTHFUL. Without this the same
        // bite shook the camera twice — once below, once again out of
        // gore.js's death beat — and Shark Sim lands a mouthful every couple
        // of seconds.
        lens: false,
      });
      humanBiteBlood(target, !!target.dead, biteSev);
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
    /* ---- ONE MOUTHFUL, ONE SMALL JOLT ----------------------------------
       This was `min(0.85, 0.18 + scale * 0.18)`: the lens shake GREW with the
       body, so a megalodon threw a car-crash-grade 0.83 at the camera on
       EVERY bite. Shark Sim's only verb is biting, a fed shark bites every
       two or three seconds, and camera.js's shake envelope runs about 0.4 s —
       so the top of the ladder was a permanently shaking screen. Measured on
       a stocked beach: 88 shake calls in 90 s, the lens jittering 21 % of all
       ticks (tools/shark-shake-check.mjs --feast). That is the earthquake.

       Size is now felt as WEIGHT instead of as camera noise: a bigger mouth
       already makes a bigger splash and a deeper sound, and a KILL stops time
       for a beat, which reads as mass. The lens gets a flat tap it can always
       recover from before the next mouthful.

       The kill also tells gore.js to keep its hands off the lens (lens:false
       in the hurt opts above) — one event must not fire two shakes. */
    const killed = !!(target && target.dead);
    /* NO HITSTOP PER MOUTHFUL, and this was tried and measured out. A short
       freeze is the classic way to sell a big bite, but hitstop collapses
       loop.js's feel-dt to about a millimetre of a frame, systems/camera.js
       smooth-damps the boom on that same feel-dt, and the frame the freeze
       lifts the lens catches up all at once. Measured: a repeatable ~0.95 m
       camera lurch on the release tick, once per kill, i.e. every second or
       two forever. A punch you throw occasionally can afford that; a verb you
       perform continuously cannot. The bite's weight is the splash, the jaw,
       the sound and (below) an occasional jolt. */
    /* PUNCTUATION, NOT A METRONOME. A nibble gets no lens at all, and a kill
       gets one only if the last one is more than a second behind it. A fed
       shark lands a mouthful every second or two forever — measured on a
       stocked beach, 59 of them in 90 s — and camera.js's shake envelope runs
       about 0.4 s, so a jolt per meal simply never lets the lens settle. That
       is the difference between "this bite had weight" and "the screen is
       vibrating", and it is what the owner was calling an earthquake. */
    /* AND YOUR OWN MOUTH GETS NOTHING. This was the game's loudest shake and
       it fired on the one event the player performs constantly. The bite is
       already the splash, the jaws, the sound, the body growing and the thing
       in front of you dying; it does not also need the lens. The lens is
       reserved for what is being done TO you — see rideDamageFelt. */
    AQUATIC_AUDIT.hits++;
    AQUATIC_AUDIT.lastTarget = kind;
    // the shark sim's meal ledger: told about every LANDED mounted bite,
    // after the damage has fully resolved (so target.dead is honest here)
    if (CBZ.sharkSimBite) { try { CBZ.sharkSimBite(kind, target, a); } catch (e) {} }
    return true;
  }

  /* ============================================================
     THE CLAMP — what a kill BIGGER THAN YOU is supposed to look like.

     Owner, 2026-08-25: "Biting is too fast and doesn't look cool enough —
     especially when a shark kills an orca bigger than it. It's pretty cool
     the engine makes that possible-but-challenging, but it doesn't LOOK cool."

     He is describing a real hole. The aquatic bite is ONE clock for every
     meal: a mackerel and a nine-tonne orca both got the same ~0.9 s open-hold-
     shut and then the corpse simply stopped existing as a problem. The fight
     that got you there could take a minute of circling and bleeding, and its
     payoff was the same chomp as a sardine.

     So the SNACK KEEPS ITS TEMPO — eating forty mackerel must not become
     forty ceremonies, and creature_combat's shared bite clock is untouched
     for them — and an ABOVE-WEIGHT KILL earns a finish:

       CLAMP   (0 → 18%)   the jaws shut, the body stops dead in the water,
                           white water, a shake, and time drops for a beat
       ROLL    (18 → 76%)  the death roll: the whole animal spins about its
                           long axis at ~1.1 Hz with the carcass locked in its
                           teeth, tearing material off it on every half turn
                           and putting blood in the water each time
       RELEASE (76 → 100%) the roll decays out, the jaws part, and the carcass
                           is let go limp to drift and sink

     REUSED, NOT REBUILT. The roll rides ride.attackRoll/attackPitch — the
     ride's own pose channels, already composed into the animal transform and
     already carried by the rider at 0.42/0.58 weight — so no new transform
     owner exists and nothing here can fight the mount's physics. The tearing
     is systems/wounds.js's creatureBiteChunk (the same call an orca's bite
     makes on YOU). The blood is gore.js's chum and blooms. The time drop is
     loop.js's doSlowmo.

     THE EULER ORDER, and it is the whole difference between a roll and a
     tilt. The default 'XYZ' composes R = Rx·Ry·Rz, so rotation.z is a LOCAL
     pitch (this model is nose-toward +X) but rotation.x is applied after the
     yaw and is therefore a WORLD tilt whose meaning changes with heading —
     which is why the existing ±0.09 attackRoll never read as a roll and could
     not be turned up. 'YXZ' puts the yaw outermost, making rotation.x a true
     roll about the body's long axis. predator.js takes exactly this trade for
     exactly this reason during a seize. We hold it for the ceremony and put
     the original order back at the end, by every exit.

     ?cfg_BITE_CINEMATIC=0 restores the old instant end-of-bite. */
  const CLAMP_A = 0.18, CLAMP_B = 0.76;   // phase boundaries, as fractions
  const CLAMP_HZ = 1.15;                  // rolls per second
  function cinematicOn() { return CBZ.CONFIG.BITE_CINEMATIC !== false; }
  /* IS THIS MEAL BIGGER THAN ME. Measured, never a species list: the two
     bodies' own lengths through marine_predation's one measurer, with a raw
     scale fallback so this still answers on a build without it. 0.85 rather
     than 1.0 because a shark taking something nearly its own size is the same
     event — and because the megalodon-vs-orca matchup the owner is talking
     about sits right on that line. */
  function aboveWeight(a, t) {
    const L = CBZ.marineBodyLen;
    const la = L ? L(a) : liveScale(a) * 6;
    const lt = L ? L(t) : liveScale(t) * 6;
    return la > 0 && lt >= la * 0.85;
  }
  function clampJawWorld(a) {
    const p = (CBZ.creatureJawPoint && CBZ.creatureJawPoint(a)) || { x: 1, y: 0.8, z: 0 };
    a.group.updateMatrixWorld(true);
    return jawV.set(p.x, p.y, p.z).applyMatrix4(a.group.matrixWorld);
  }
  function beginClamp(a, victim) {
    if (!cinematicOn() || ride.clampT > 0 || !victim) return false;
    if (!aboveWeight(a, victim)) return false;
    const dur = 2.15 + Math.min(0.9, (CBZ.marineBodyLen ? CBZ.marineBodyLen(victim) : 8) * 0.05);
    ride.clampDur = dur; ride.clampT = dur;
    ride.clampVictim = victim; ride.clampBeat = -1;
    victim._jawHeld = a;                     // "somebody else owns this corpse"
    // a true long-axis roll needs the yaw outermost (see the block comment)
    if (a.group.rotation) {
      ride.clampOrder = a.group.rotation.order || "XYZ";
      try { a.group.rotation.order = "YXZ"; } catch (e) { ride.clampOrder = ""; }
    }
    const j = clampJawWorld(a);
    if (CBZ.goreChum) {
      const at = { x: j.x, y: j.y, z: j.z };
      ride._clampAt = at;
      try {
        /* 1.3, not 2.6. Twice this rate on top of the per-beat blooms put so
           much chum in front of a chase camera that the roll photographed as a
           red screen (caught in the preset's own captures, both columns). The
           water still clouds; you can still see what is doing it. */
        ride.clampChum = CBZ.goreChum(function () { return at.x; }, function () { return at.y; },
          function () { return at.z; }, 1.3, dur + 2);
      } catch (e) { ride.clampChum = null; }
    }
    if (CBZ.goreBloom) { try { CBZ.goreBloom(j.x, j.y, j.z, { amount: 0.8 }); } catch (e) {} }
    if (CBZ.waterSplashAt) { try { CBZ.waterSplashAt(j.x, seaY(j.x, j.z), j.z, 4.2); } catch (e) {} }
    if (CBZ.shake) CBZ.shake(0.30);   // the grab lands; the roll below no longer kicks
    if (CBZ.doSlowmo) CBZ.doSlowmo(0.5);
    if (CBZ.sfx) { try { CBZ.sfx("hit", { volume: 1 }); } catch (e) {} }
    AQUATIC_AUDIT.clamps = (AQUATIC_AUDIT.clamps || 0) + 1;
    return true;
  }
  function endClamp(a) {
    const v = ride.clampVictim;
    if (v) { v._jawHeld = null; }
    if (ride.clampChum && CBZ.goreChumStop) { try { CBZ.goreChumStop(ride.clampChum); } catch (e) {} }
    if (a && a.group && a.group.rotation && ride.clampOrder) {
      try { a.group.rotation.order = ride.clampOrder; } catch (e) {}
    }
    ride.clampOrder = ""; ride.clampChum = null; ride.clampVictim = null;
    ride.clampT = 0; ride.clampDur = 0; ride.clampBeat = -1;
    ride.attackRoll = 0; ride.attackPitch = 0;
    if (CBZ.swimJaw && a) { try { CBZ.swimJaw(a, 0); } catch (e) {} }
    if (a) a._atkAnim = -1;
  }
  function tickClamp(a, dt) {
    if (!(ride.clampT > 0)) return false;
    const v = ride.clampVictim;
    if (!v || !v.group || !v.group.parent || v.culled) { endClamp(a); return false; }
    ride.clampT -= dt;
    const e = Math.max(0, Math.min(1, 1 - ride.clampT / ride.clampDur));
    a._atkAnim = 0.5;                       // animateSwim yields the transform
    const j = clampJawWorld(a);
    if (ride._clampAt) { ride._clampAt.x = j.x; ride._clampAt.y = j.y; ride._clampAt.z = j.z; }

    // THE BODY STOPS. A shark that has just clamped nine tonnes does not keep
    // cruising; the whole point of the beat is the sudden loss of way.
    if (ride.water) ride.water.v *= Math.max(0, 1 - dt * (e < CLAMP_B ? 4.2 : 1.4));

    let roll = 0, pitch = 0, gape = 0;
    if (e < CLAMP_A) {
      const q = e / CLAMP_A;
      gape = 0.5 * (1 - q);                 // the mouth closing onto the body
      pitch = 0.18 * Math.sin(q * Math.PI);
    } else if (e < CLAMP_B) {
      const q = (e - CLAMP_A) / (CLAMP_B - CLAMP_A);
      // ease in and out so the spin has weight at both ends instead of popping
      const env = Math.sin(Math.min(1, q * 1.35) * Math.PI * 0.5) * (1 - Math.pow(q, 4) * 0.35);
      const ph = q * (CLAMP_B - CLAMP_A) * ride.clampDur * CLAMP_HZ * 6.283185307;
      roll = Math.sin(ph) * 1.15 * env;
      pitch = Math.sin(ph * 0.5) * 0.26 * env;
      // ONE BEAT PER HALF TURN: a piece comes away, blood goes in the water,
      // the surface breaks and the screen kicks. This is the violence.
      const beat = Math.floor(ph / Math.PI);
      if (beat !== ride.clampBeat) {
        ride.clampBeat = beat;
        if (CBZ.creatureBiteChunk) {
          /* THE ROLL IS THE RAKE. A death roll drags the teeth across the
             body as the head turns, so the cuts follow the animal's own
             heading and the lobe that comes off is thrown by the shake. */
          _clampDir.x = Math.cos(a.heading || 0); _clampDir.y = 0; _clampDir.z = Math.sin(a.heading || 0);
          try {
            CBZ.creatureBiteChunk(v, j,
              { jaw: biteReach(a) * 0.38, sev: 0.85, dir: _clampDir, by: a, bleedS: 12 });
          } catch (er) {}
        }
        /* EVERY OTHER HALF TURN, and measured before it was tuned: a bloom on
           every beat put six overlapping clouds inside a chase camera that is
           ten metres behind the jaw, and the capture came back as a red lens
           rather than blood in water. The chum trail (opened at the clamp)
           carries the continuity between them. */
        if ((beat & 1) === 0 && CBZ.goreBloom) {
          try { CBZ.goreBloom(j.x, j.y, j.z, { amount: 0.5 }); } catch (er) {}
        }
        if (CBZ.marineSurfaceHit) { try { CBZ.marineSurfaceHit(j.x, j.z, 2.4); } catch (er) {} }
        /* NO KICK PER HALF TURN. CLAMP_HZ is 1.15, so this fired ~2.3 times a
           second for the whole roll — the most literal earthquake in the game,
           and it was YOU doing the shaking. The half-turn beat is the piece
           coming away, the blood and the surface breaking; that is plenty. */
        if (CBZ.sfx) { try { CBZ.sfx("hit", { volume: 0.7 }); } catch (er) {} }
      }
    } else {
      const q = (e - CLAMP_B) / (1 - CLAMP_B);
      gape = 0.42 * Math.sin(q * Math.PI);  // the jaws part and let it go
      roll = 0; pitch = -0.12 * (1 - q);
    }
    ride.attackRoll = roll; ride.attackPitch = pitch;
    if (CBZ.swimJaw) { try { CBZ.swimJaw(a, gape); } catch (er) {} }

    // THE CARCASS IS IN THE TEETH. Held at the jaw and rolled with the body
    // until the release, then dropped limp. This write lands in the onAlways
    // 49.8 pass, i.e. AFTER wildlife.js's own animal tick, so it is the last
    // word on where the corpse is for the frame.
    if (e < CLAMP_B) {
      const vg = v.group;
      const back = (CBZ.marineBodyLen ? CBZ.marineBodyLen(v) : 8) * 0.22;
      const hd = ride.head;
      const px = j.x + Math.cos(hd) * back, pz = j.z + Math.sin(hd) * back;
      vg.position.set(px, j.y, pz);
      if (v.pos) { v.pos.x = px; v.pos.y = j.y; v.pos.z = pz; }
      if (vg.rotation) {
        vg.rotation.order = "YXZ";
        vg.rotation.y = -(hd + Math.PI * 0.42);      // held across the mouth
        vg.rotation.x = roll * 0.9;
        vg.rotation.z = pitch * 0.5;
      }
      if (v._waterMove) { v._waterMove.x = px; v._waterMove.z = pz; }
    }
    if (ride.clampT <= 0) { endClamp(a); return false; }
    return true;
  }
  // Read by modes/shark_sim.js: the win card must not cut the finish off.
  CBZ.cityAquaticClampT = function () { return ride.clampT > 0 ? ride.clampT : 0; };
  CBZ.cityAquaticClampVictim = function () { return ride.clampT > 0 ? ride.clampVictim : null; };

  function startAquaticAttack() {
    const a = ride.mount, R = a && rideDef(a.species);
    if (!a || !R || !R.aquatic || !R.attack || ride.attackCd > 0 || ride.attackT > 0) return false;
    if (ride.clampT > 0) return false;                  // the finish is not interruptible
    const pick = selectBiteTarget(a, R);
    ride.target = pick.target; ride.targetKind = pick.kind;
    // The mounted animal and the wild predator now use creature_combat's one
    // aquatic bite clock. The old 0.56 s chomp (0.72 for every megalodon
    // target) could open and clamp between two readable frames; cooldown also
    // expired during the swing, leaving only ~60 ms before the next chomp.
    // Preserve target-sensitive mass — an actual hull takes longer — then
    // leave a visible recovery beat after the mouth has returned to rest.
    ride.attackT = 0.0001;
    // the third argument is the TARGET, and it only ever lengthens the swing
    // when that target is the size of the animal biting it (creature_combat)
    ride.attackDur = CBZ.aquaticBiteDuration
      ? CBZ.aquaticBiteDuration(a, pick.kind, pick.kind === "animal" ? pick.target : null)
      : (R.shipBite ? 0.72 : 0.56);
    ride.attackHit = false; ride.attackHitP = -1;
    ride.attackCd = ride.attackDur + (pick.kind === "ship" ? 0.55 : 0.42);
    a._atkAnim = 0;
    if (ride.water) {
      // Lunge TO the meal, not through it. The fixed cruise-fraction burst
      // overshot anything closer than ~2.5 m: the mouth was already past the
      // body before the contact window opened, so a point-blank bite whiffed.
      // pick.d is the real gap — arrive around the shut of the jaws and let
      // the window land it; with no target, keep the old full-send gape.
      const boost = ride.target
        ? Math.max((R.cruise || 8) * 0.35, Math.min((R.cruise || 8) * 0.82, pick.d / (R.shipBite ? 0.4 : 0.3)))
        : (R.cruise || 8) * 0.82;
      ride.water.v = Math.max(ride.water.v || 0, boost);
    }
    AQUATIC_AUDIT.attacks++;
    return true;
  }
  CBZ.cityMountedAnimalAttack = function (down) {
    const a = ride.mount, R = a && rideDef(a.species);
    if (!a || !R || !R.aquatic) return false;
    if (down !== false && R.attack) startAquaticAttack();
    return true;                                      // mounted animal owns the trigger
  };
  // Is there anything to bite RIGHT NOW? The shark sim's auto-bite asks this
  // before pulling the trigger, so the mount only chomps when the chomp can
  // land — it is the exact selection the attack itself will run, exported
  // read-only, and null while an attack or its cooldown is still in flight.
  CBZ.cityAquaticBiteProbe = function () {
    const a = ride.mount, R = a && rideDef(a.species);
    if (!a || !R || !R.aquatic || !R.attack || ride.attackCd > 0 || ride.attackT > 0) return null;
    if (ride.clampT > 0) return null;
    const pick = selectBiteTarget(a, R);
    return pick.target ? pick : null;
  };

  function tickAquaticAttack(a, dt) {
    // THE CEREMONY OWNS THE FRAME. While a clamp is running it writes both
    // pose channels itself and no new bite may start — otherwise the auto-fire
    // in shark_sim would chomp straight through the finish.
    if (ride.clampT > 0) {
      if (ride.attackCd > 0) ride.attackCd = Math.max(0, ride.attackCd - dt);
      if (tickClamp(a, dt)) return;
    }
    if (ride.attackCd > 0) ride.attackCd = Math.max(0, ride.attackCd - dt);
    ride.attackPitch = 0; ride.attackRoll = 0;
    if (!(ride.attackT > 0)) return;
    const pPrev = Math.min(1, ride.attackT / ride.attackDur);
    ride.attackT += dt;
    const p = Math.min(1, ride.attackT / ride.attackDur);
    a._atkAnim = p;
    /* ---- THE LUNGE POSE, AND THE STEP THAT USED TO BE IN IT --------------
       The wind-up drops the nose to -0.20 rad by p = 0.42; the strike branch
       then started from `sin(0) * 0.34` = ZERO. So on the single tick that
       crossed p = 0.42 the body's pitch jumped 0.20 rad — 11 degrees — in one
       frame, on EVERY bite. aquaticSeatY multiplies that pitch by the seat's
       forward arm (V.x, several metres on a great white or a megalodon)
       before the camera ever sees it, so one bite threw the lens most of a
       metre sideways with no shake call involved at all. Measured with
       CBZ.shake stubbed out entirely, the camera still jittered on 14 % of
       ticks: tools/shark-shake-check.mjs --feast --noshake.

       `s` blends the wind-up out as the strike comes in, so the curve is
       continuous at the hand-over (q = 0 gives -0.20, the wind-up's own last
       value) and still reaches the full +0.34 at the top of the strike. The
       animation is unchanged in shape; it just no longer teleports. */
    if (p < 0.42) ride.attackPitch = -0.20 * Math.min(1, p / 0.42);
    else {
      const q = (p - 0.42) / 0.58;
      const s = Math.min(1, q * 3);
      ride.attackPitch = -0.20 * (1 - s) + Math.sin(Math.min(1, q * 1.4) * Math.PI) * 0.34 * s;
      ride.attackRoll = Math.sin(q * 9) * 0.09 * (1 - q);
    }
    // Contact is a WINDOW, not one magic animation frame. A fast shark can
    // cross an entire target between two 60 Hz samples; retry while the jaw is
    // open and let the geometry distance/front test decide the first real hit.
    // The window itself is tested as a CROSSING (pPrev), because on a stalled
    // frame — a 2 fps thermal dip, a headless tool — p can jump straight from
    // wind-up to recovery and a sampled-only test never lands a single bite.
    if (!ride.attackHit && p >= 0.38 && pPrev <= 0.72) {
      ride.attackHit = damageBiteTarget(a, ride.target, ride.targetKind);
      if (ride.attackHit) ride.attackHitP = p;
    }
    // The same normalized production curve now drives mounted and wild jaws.
    // Contact is still geometry-owned above, but no longer collapses the next
    // 9% of a second into an unreadable instant clamp: full gape carries the
    // target into compression, then the body closes and visibly recovers.
    let open = CBZ.biteCurve ? CBZ.biteCurve(p)
      : (p < 0.30 ? ease(p / 0.30) : (p > 0.70 ? 1 - ease((p - 0.70) / 0.30) : 1));
    if (CBZ.swimJaw) CBZ.swimJaw(a, open);
    if (p >= 1) {
      /* A WHIFF IS NOT A MEAL. The recovery beat after a bite that landed
         reads as swallowing; after one that missed it reads as a jammed jaw —
         worst in the shark sim, where there is no trigger to pull early and
         the wider acquisition above means more strikes start at range. Keep a
         short beat so the jaw visibly resets, drop the rest of the cooldown. */
      if (!ride.attackHit) ride.attackCd = Math.min(ride.attackCd, 0.18);
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
  /* ---- THE VERTICAL AXIS, ON EVERY DEVICE (SHARK_RIDE_TOUCH_VERT) --------
     Desktop already had it: Space rises, Ctrl/C dives — the SAME grammar
     city/swim.js's verticalInput() uses, which is why they read as one game.
     A thumb had nothing. city/swim.js solved that for the human swimmer by
     publishing a hold seam (CBZ.citySwimVertical) that systems/touch_vehicle.js
     drives from two pills; this is that seam for the saddle, byte-for-byte the
     same contract — call it every frame with -1/0/+1 and it EXPIRES after
     0.25 s without a refresh, so a swallowed touchend (routine on iPad) can
     never pin a shark at the bottom of the sea. */
  let mountVert = 0, mountVertT = -9;
  CBZ.cityAquaticMountVertical = function (v) {
    if (CFG.SHARK_RIDE_TOUCH_VERT === false) return;
    mountVert = v > 0 ? 1 : (v < 0 ? -1 : 0);
    mountVertT = CBZ.now != null ? CBZ.now : (typeof performance !== "undefined" ? performance.now() : 0);
  };
  function touchVertical() {
    if (!mountVert) return 0;
    const now = CBZ.now != null ? CBZ.now : (typeof performance !== "undefined" ? performance.now() : 0);
    if (now - mountVertT > 250) { mountVert = 0; return 0; }
    return mountVert;
  }
  function verticalRideInput(keys) {
    let v = touchVertical();
    if (keys[" "]) v = 1;
    if (keys.control || keys.c) v = -1;
    return v;
  }
  // "Am I piloting a body in the water right now?" — the one question the touch
  // layer and any HUD needs, so neither has to reach into `ride`.
  CBZ.cityAquaticMountRiding = function () {
    return !!(ride.mount && ride.water && aquaticMounted(ride.mount) && !ride.mount.dead);
  };

  /* ============================================================
     A BIG BODY CROSSING THE WATERLINE — the shared physical event.

     A breach happens twice: the animal comes OUT and then it comes back IN,
     and both are the same event with the sign flipped — a few tonnes of fish
     trading places with a few tonnes of water. Two files need it (the ridden
     mount below, and the wild sharks in city/wildlife_shark.js), so it is
     published here rather than typed twice; this file loads first, and the
     consumer degrades to nothing if it is ever loaded alone.

     WHY THIS EXISTS AT ALL — the megalodon splashed like a swimmer. Every
     breach in this game went through the legacy CBZ.waterSplashAt, and that
     function's contract CLAMPS its strength dial to 2.5 and then hands the
     impact bus `{ kind: "body", mass: 78 }`. Seventy-eight kilograms. So a
     bull shark, a great white and a sixteen-metre megalodon all re-entered the
     sea as the same 78 kg diver at the same clamped speed, and the "make the
     splash bigger" dial the callers were turning had been saturated for years.
     world/water_impact.js sizes everything off sqrt(mass) * speed and has a
     `vehicle` vocabulary sitting right there for a mass a body cannot reach.
     The fix is not a bigger number — it is telling the truth about the animal.
  ============================================================ */

  /* HOW LONG IS THIS BODY, RIGHT NOW. city/marine_predation.js publishes the
     MEASURED length (a world box off the rig, cached per actor) and that is the
     one measurement anybody should be making — but its cache predates the mass
     economy, so a shark that has eaten its way up a tier still reports the
     length it was measured at. Rather than re-measure (a setFromObject over the
     whole rig) this remembers the scale the measurement was taken at and
     carries the ratio, which is exact for a body that only ever grows by
     uniform scale — which is precisely how wildlife_traits.js grows one. */
  /* THE RATIO IS AGAINST THE *DRAWN* SCALE, NOT THE LOGICAL ONE, and that is a
     correctness fix rather than a preference. marine_predation.js's bodyLen()
     measures the world BOX of the rig — so its number already carries
     group.scale — and it caches that measurement forever. liveScale() prefers
     CBZ.wildlifeScale(), which is the LOGICAL size and jumps the instant the
     shark evolves, while the ceremony animates group.scale up to it over the
     next second. Measure during that second (which is exactly what the
     waterline tracker made happen: it asks for a length on every frame, and one
     of those frames is mid-ceremony) and the pair is permanently mismatched —
     a small box divided by a big scale. MEASURED: a fully grown megalodon
     reported 10.47 m instead of 22.67, which through bodyKg's L^2.8 is 10 t
     instead of 87 t. The drawn scale is what the box was measured at, so it is
     the only honest denominator. */
  function drawnScale(a) {
    const g = a && a.group;
    if (g && g.scale && g.scale.x > 0) return g.scale.x;
    return Math.max(0.05, liveScale(a));
  }
  function bodyLenLive(a) {
    if (!a) return 4;
    let m = a._breachLen;
    if (!m) {
      let L = 0;
      if (typeof CBZ.marineBodyLen === "function") {
        try { L = +CBZ.marineBodyLen(a); } catch (e) { L = 0; }
      }
      if (!(L > 0) || !isFinite(L)) L = 4 * ((a.species && a.species.scale) || 1);
      m = a._breachLen = { L: L, s: Math.max(0.05, drawnScale(a)) };
    }
    return m.L * (Math.max(0.05, drawnScale(a)) / m.s);
  }
  /* HOW MANY KILOGRAMS OF ANIMAL. city/marine_predation.js:308 already owns the
     game's one marine mass law — `tonnesOf(a) = 0.014 * L^2.8` off that same
     measured length, which is what decides whether a shark can move a hull —
     and it is private to that file. This is that law in kilograms rather than a
     second opinion: if the two ever disagree, marine_predation.js is the owner
     and this is the copy to fix. MEASURED on the live rigs at seed 90210: a
     ridden bull shark at 4.95 m comes out at 1.24 t, a great white at 5.34 m at
     1.52 t, and a megalodon that has eaten its way to 22.7 m at 87.6 t. The
     first two land in world/water_impact.js's `body` and `vehicle` vocabularies
     respectively; the third saturates the vehicle one, which is correct — there
     is no louder answer the sea has. */
  function bodyKg(a) {
    const L = bodyLenLive(a);
    return Math.max(8, 14 * Math.pow(L, 2.8));
  }
  CBZ.marineBodyLenLive = bodyLenLive;
  CBZ.marineBodyKg = bodyKg;

  /* WHERE THE ENDS ACTUALLY ARE. `len/2` either side of the origin is a guess,
     and on these rigs it is a wrong one: the group origin sits wherever the
     modeller put it, so half a length forward can overshoot the snout by most
     of a metre. That error is invisible in a length and load-bearing in a
     WATERLINE — it decides which frame the nose crosses. Measured the way
     marine_predation.js's bodyLen() measures a length (rotation zeroed so the
     local axes are the world's, box, rotation restored) and cached against the
     DRAWN scale for the same reason bodyLenLive is.

     LOCAL +X IS FORWARD, and that is derived rather than assumed: every animal
     in this game is yawed by `root.rotation.y = -a.heading`
     (city/wildlife_shark.js:888), and a Y-rotation of -h maps local (1,0,0) to
     world (cos h, 0, sin h) — which is exactly the heading vector. */
  function bodyEnds(a) {
    if (!a) return { fwd: 2, aft: 2 };
    let m = a._breachEnds;
    const sc = Math.max(0.05, drawnScale(a));
    if (!m) {
      let fwd = 0, aft = 0;
      const g = a.group;
      if (g && window.THREE) {
        const rx = g.rotation.x, ry = g.rotation.y, rz = g.rotation.z;
        try {
          g.rotation.set(0, 0, 0);
          g.updateMatrixWorld(true);
          const b = new THREE.Box3().setFromObject(g);
          // the WORLD x of the origin (matrixWorld's translation), never
          // g.position.x — that is a local coordinate, and setFromObject
          // returns world bounds. They only agree while the parent is the
          // scene sitting at zero, which is a fact about today's scene graph
          // rather than a fact about this measurement.
          const ox = g.matrixWorld.elements[12];
          if (isFinite(b.max.x) && isFinite(b.min.x)) {
            fwd = b.max.x - ox;
            aft = ox - b.min.x;
          }
        } catch (e) { fwd = aft = 0; }
        g.rotation.set(rx, ry, rz);
        try { g.updateMatrixWorld(true); } catch (e) {}
      }
      if (!(fwd > 0) || !(aft > 0)) { const L = bodyLenLive(a); fwd = aft = L * 0.5; }
      m = a._breachEnds = { fwd: fwd, aft: aft, s: sc };
    }
    const k = sc / m.s;
    return { fwd: m.fwd * k, aft: m.aft * k };
  }
  CBZ.marineBodyEnds = bodyEnds;

  /* HOW MUCH AIR A BODY OF THIS SIZE GETS, and therefore how fast it has to
     leave the water. This is the solve aquaticRideDef already did for the
     ridden mount, lifted out and published so the WILD bodies in
     city/wildlife_shark.js leap by the same physics the player's does instead
     of by a second set of numbers that would immediately drift. The number
     authored is the one a person can picture — a bull shark clears about its
     own depth, a great white a body length, a megalodon 5.8 m — and the launch
     speed, the hang time and the entry speed are all consequences of it under
     the one BREACH_G everybody integrates with. */
  function breachApexFor(scale) { return 0.9 + Math.max(0.25, +scale || 1) * 1.9; }
  CBZ.marineBreachApex = breachApexFor;
  CBZ.marineBreachVel = function (scale) { return Math.sqrt(2 * BREACH_G * breachApexFor(scale)); };
  CBZ.marineBreachG = function () { return BREACH_G; };
  CBZ.marineBreachRoll = function () { return BREACH_ROLL; };

  /* THE CURTAIN A BODY DRAGS THROUGH THE SURFACE. world/water_impact.js's
     vocabulary is calibrated for things going IN (crown, rebound jet, settling
     ring); nothing in it describes a body coming OUT, which throws a torn
     sheet of water UP and outward off its own flanks. That is raw droplets, so
     it is CBZ.waterEmit — the public pool primitive — and the count is sized
     off the mass and clipped to whatever the pool has spare, so a breach can
     never starve the wakes and the rain it shares a budget with. */
  function breachSheet(x, surf, z, kg, len, up, fx, fz) {
    if (typeof CBZ.waterEmit !== "function") return 0;
    const free = typeof CBZ.waterEmitFree === "function" ? CBZ.waterEmitFree() : 90;
    if (!(free > 4)) return 0;
    const n = Math.max(6, Math.min(Math.round(free * 0.4),
      Math.round(12 + Math.cbrt(Math.max(1, kg)) * 3.2)));
    const r0 = Math.max(0.5, len * 0.22);
    let made = 0;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * 6.283185307 + fxRand() * 0.7;
      const rr = r0 * (0.35 + fxRand() * 0.95);
      const ox = Math.cos(ang) * rr, oz = Math.sin(ang) * rr;
      // biased along the body's own line: the sheet peels off the flanks and
      // trails the animal rather than standing up as a symmetric fountain
      const bx = fx * len * 0.16 * (fxRand() - 0.7);
      const bz = fz * len * 0.16 * (fxRand() - 0.7);
      if (CBZ.waterEmit({
        x: x + ox + bx, y: surf + 0.05 + fxRand() * 0.4, z: z + oz + bz,
        vx: ox * (1.5 + fxRand() * 1.4) - fx * 1.2,
        vy: up * (0.32 + fxRand() * 0.62),
        vz: oz * (1.5 + fxRand() * 1.4) - fz * 1.2,
        size: 0.12 + Math.min(0.5, len * 0.028) * (0.6 + fxRand()),
        grow: -0.06, ttl: 0.55 + fxRand() * 0.85, alpha: 0.9,
      })) made++;
    }
    return made;
  }

  /* ONE END OF THE ARC. Fired at the launch and again at the re-entry, with the
     animal's honest mass and the vertical speed it is actually carrying, so the
     sea answers a megalodon the way it answers a bus and a bull shark the way
     it answers a bull shark. Returns the kilograms it reported (0 if the point
     was not over water at all — a leap that lands on sand is a beaching, and
     the caller still owes it a thud). */
  function breachCross(a, x, surf, z, speed, exit, len, hx, hz) {
    const kg = bodyKg(a);
    const spd = Math.max(1.5, Math.abs(speed));
    // Past ~1.4 t the sea stops answering like a diver went in. `vehicle` is
    // the vocabulary water_impact.js already calibrated at exactly that mass —
    // a flatter, wider crown with a damped rebound jet, which is what a long
    // heavy body landing on its side actually makes.
    const kind = kg >= 1400 ? "vehicle" : "body";
    let fired = false;
    if (typeof CBZ.waterHit === "function") {
      try {
        /* AND WHICH WAY IT WAS GOING. A shark does not fall into the sea, it
           ARRIVES in it — world/water_impact.js leans the whole event
           downrange off this, so the crown ploughs, the crest ahead of it is
           an arc rather than a circle, and the scar drifts with the body
           instead of being stamped where it first touched. */
        fired = !!CBZ.waterHit(x, surf, z, {
          kind: kind, mass: kg, speed: spd, vx: +hx || 0, vz: +hz || 0,
        });
      } catch (e) { fired = false; }
    }
    if (!fired) {
      // Not over water (a beaching), or the bus is not in this build. The
      // legacy call is the fallback and ONLY the fallback.
      if (typeof CBZ.waterSplashAt === "function") {
        try { CBZ.waterSplashAt(x, surf, z, Math.min(2.5, 1.1 + Math.cbrt(kg) * 0.09)); } catch (e) {}
      }
      return 0;
    }
    const L = len > 0 ? len : bodyLenLive(a);
    const heading = a && a.heading != null ? a.heading : 0;
    const drops = breachSheet(x, surf, z, kg, L,
      exit ? spd * 0.55 : spd * 0.34, Math.cos(heading), Math.sin(heading));
    AQUATIC_AUDIT.crossDrops += drops;
    AQUATIC_AUDIT.lastEntryKind = kind;
    if (!exit) { AQUATIC_AUDIT.lastEntryKg = Math.round(kg); AQUATIC_AUDIT.lastEntrySpd = +spd.toFixed(2); }
    return kg;
  }
  CBZ.marineBreachCross = breachCross;

  /* ============================================================
     THE WATERLINE IS A LINE ALONG THE BODY, NOT A POINT AT THE ORIGIN.

     Owner, 2026-08-29: "when i jump out of the water, sometimes the splash
     animation is delayed which is really funny and fucking dumb."

     He is right and it is not an animation. Every splash in a breach used to be
     fired from a SCALAR TEST ON THE BODY ORIGIN: the ride launches when
     `W.y >= effTop - 0.12` and lands when `W.y <= surf - max(0.18, draft*0.12)`,
     and both handed breachCross the ORIGIN's x/z. The origin is the middle of
     the animal. The thing a player watches cross the waterline is the NOSE, and
     a long body coming down at fifty degrees puts its nose through the surface
     half a body-length early — in space AND in time.

     MEASURED on the live page (tools/splash-timing-check.mjs, seed 90210, the
     ridden breach, deepest point of the drawn rig as the ruler):

         hammerhead   4.8 m   entry splash  2 frames (0.07 s) late, 0.6 m away
         great white  5.1 m   entry splash  5 frames (0.17 s) late, 1.2 m away
         megalodon   22.7 m   entry splash 21 frames (0.70 s) LATE, 9.9 m away

     That is the whole "sometimes": the error is proportional to the animal, so
     it is invisible on the shark you start as and comedy on the one you become.

     And a body crossing the surface is not an EVENT at all — it is a process
     with a duration. A megalodon takes about six tenths of a second to pass
     through the waterline, and for every one of those frames it is displacing
     water. One pop at one instant can only ever be a firework; what a real
     entry looks like is a curtain that TRAVELS down the body, nose to tail.

     So this is the tracker: called every frame with the live body axis, it owns
     four events and one continuous one.

       nose down   the entry — breachCross AT THE NOSE, with the nose's own
                   vertical speed (which is faster than the origin's whenever
                   the body is pitched, and it is always pitched here)
       nose up     the exit — the curtain dragged up out of the hole
       crossing    THE ZIPPER: while the surface lies between nose and tail,
                   spray is thrown from the moving intersection point, at a rate
                   set by how fast that point is travelling and how thick the
                   body is there
       tail        the flick — the last of the animal through the hole, which is
                   the beat that ends a real entry and the one thing that used
                   to be missing entirely

     State lives on the actor (`a._wl`) and the FIRST frame is only ever used to
     latch the signs, never to fire: an animal that spawns at the surface, or a
     tracker that starts mid-arc, must not splash for standing still.
  ============================================================ */
  /* PRESENTATION RANDOMNESS, OFF ITS OWN STREAM. Every splash primitive in
     world/water_wake.js and world/water_impact.js draws its jitter from a
     file-local mulberry32 rather than Math.random, so a particle can never
     perturb the simulation's shared stream. This file was still reaching for
     Math.random in its breach FX — one draw per breach, which nobody noticed —
     and the curtain below asks for a dozen a frame, which would have been a
     determinism bug with a stopwatch on it. Same fix as the neighbours. */
  let _fxSeed = 0x9e3779b9;
  function fxRand() {
    _fxSeed = (_fxSeed + 0x6d2b79f5) | 0;
    let t = _fxSeed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const WL_MIN_SPD = 0.9;         // m/s of crossing speed below which a body is
                                  // just bobbing and the sea says nothing
  function wlAxis(o, t, out) {
    // t: -1 tail tip .. 0 origin .. +1 snout, along the body's own line through
    // its live pitch, using the MEASURED distance to each end rather than half
    // a length either side of an origin that is not in the middle.
    const cp = Math.cos(o.pitch || 0), sp = Math.sin(o.pitch || 0);
    const h = t >= 0 ? t * (o.fwd || 2) : t * (o.aft || 2);
    out.x = o.x + Math.cos(o.heading || 0) * cp * h;
    out.y = o.y + sp * h;
    out.z = o.z + Math.sin(o.heading || 0) * cp * h;
    return out;
  }
  const _wlNose = { x: 0, y: 0, z: 0 }, _wlTail = { x: 0, y: 0, z: 0 }, _wlCut = { x: 0, y: 0, z: 0 };

  /* THE ZIPPER. Spray thrown from the point where the surface actually cuts the
     body, perpendicular to the body's own line, for as long as the cut exists.
     `girth` tapers to nothing at both ends (a nose and a tail displace almost
     nothing; the shoulders displace everything), which is what makes the
     curtain SWELL as the thick part of the animal goes through and die away as
     the tail follows it. Sized against the pool's spare slots exactly like
     breachSheet, so a breach can never starve the wakes and the rain. */
  function wlCurtain(st, o, cut, s, speed, girth, dt) {
    if (typeof CBZ.waterEmit !== "function") return 0;
    const free = typeof CBZ.waterEmitFree === "function" ? CBZ.waterEmitFree() : 90;
    if (!(free > 6)) return 0;
    /* rate: metres of body going through the surface per second, times how fat
       it is there. ABS, and that is not tidiness — `speed` is signed (negative
       coming down) and the first cut fed the signed value straight into the
       accumulator, so it ran BACKWARDS on every entry and floor() never reached
       one. The curtain worked on the way out and was silent on the way in,
       which is the half anybody was going to look at. */
    const rate = Math.min(140, Math.abs(speed) * girth * 5.5);
    st.cAcc = (st.cAcc || 0) + rate * dt;
    let n = Math.floor(st.cAcc);
    if (n <= 0) return 0;
    st.cAcc -= n;
    n = Math.min(n, Math.max(1, Math.round(free * 0.35)), 14);
    // the body's own line, and the two directions square to it
    const cp = Math.cos(o.pitch || 0);
    const fx = Math.cos(o.heading || 0) * cp, fz = Math.sin(o.heading || 0) * cp;
    const sxx = -Math.sin(o.heading || 0), szz = Math.cos(o.heading || 0);
    const up = speed > 0 ? 1 : -1;                 // coming OUT throws up harder
    let made = 0;
    for (let i = 0; i < n; i++) {
      const side = (fxRand() < 0.5 ? -1 : 1);
      const off = girth * (0.35 + fxRand() * 0.9) * side;
      const along = (fxRand() - 0.5) * girth * 0.8;
      if (CBZ.waterEmit({
        x: cut.x + sxx * off + fx * along,
        y: cut.y + 0.04 + fxRand() * 0.22,
        z: cut.z + szz * off + fz * along,
        // out and up off the flank, and CARRIED by the body — the sheet trails
        // the animal instead of standing still in the water it came from
        vx: sxx * side * (1.1 + fxRand() * 2.1) + (o.vx || 0) * 0.22,
        vy: (0.9 + fxRand() * 2.6) * (up > 0 ? 1.35 : 0.8) + Math.abs(speed) * 0.16,
        vz: szz * side * (1.1 + fxRand() * 2.1) + (o.vz || 0) * 0.22,
        size: 0.10 + Math.min(0.42, girth * 0.16) * (0.55 + fxRand()),
        grow: -0.05, ttl: 0.45 + fxRand() * 0.8, alpha: 0.92,
      })) made++;
    }
    // and the water it leaves lying on the surface, at the cut, riding the swell
    if (st.cRing == null) st.cRing = 0;
    st.cRing -= dt;
    if (st.cRing <= 0) {
      st.cRing = 0.07;
      CBZ.waterEmit({
        x: cut.x, y: 0, z: cut.z, ride: true,
        size: Math.max(0.35, girth * 1.5), grow: girth * 0.9,
        ttl: 0.7 + girth * 0.22, alpha: 0.42,
      });
    }
    AQUATIC_AUDIT.crossDrops += made;
    return made;
  }

  /* THE TAIL FLICK. Not a second breachCross — the sea has already been told
     the animal's mass once per crossing and telling it twice would double every
     splash. This is the visual coda: a compact burst where the tail goes
     through, thrown the way the tail is moving. */
  function wlFlick(o, p, speed, len) {
    if (typeof CBZ.waterEmit !== "function") return;
    const free = typeof CBZ.waterEmitFree === "function" ? CBZ.waterEmitFree() : 60;
    const n = Math.max(3, Math.min(Math.round(free * 0.2), Math.round(4 + len * 0.9)));
    for (let i = 0; i < n; i++) {
      const a = fxRand() * 6.283185307;
      const r = 0.2 + fxRand() * len * 0.09;
      CBZ.waterEmit({
        x: p.x + Math.cos(a) * r, y: p.y + 0.05, z: p.z + Math.sin(a) * r,
        vx: Math.cos(a) * (1.2 + fxRand() * 2.2),
        vy: 1.6 + fxRand() * 3.4 + Math.abs(speed) * 0.22,
        vz: Math.sin(a) * (1.2 + fxRand() * 2.2),
        size: 0.10 + fxRand() * (0.08 + len * 0.012), grow: -0.03,
        ttl: 0.5 + fxRand() * 0.6, alpha: 0.9,
      });
    }
    CBZ.waterEmit({
      x: p.x, y: 0, z: p.z, ride: true, ring: true,
      size: Math.max(0.4, len * 0.10), grow: Math.max(1.2, len * 0.16),
      ttl: 0.9 + len * 0.02, alpha: 0.6,
    });
  }

  /* THE TRACKER. `o` is a caller-owned scratch object — nothing here allocates
     per frame — carrying { x, y, z, heading, pitch, len, vx, vy, vz, dt }.
     Returns the state record so a caller can read what the sea was just told
     (lastEntryKg / lastEntryT) instead of keeping a second copy of it. */
  function waterlineTick(a, o) {
    if (!a || !o) return null;
    const dt = +o.dt || 0;
    if (!(dt > 0)) return a._wl || null;
    const len = Math.max(0.6, +o.len || 4);
    o.len = len;
    const ends = bodyEnds(a);
    o.fwd = ends.fwd; o.aft = ends.aft;
    let st = a._wl;
    const nose = wlAxis(o, 1, _wlNose), tail = wlAxis(o, -1, _wlTail);
    const sNose = seaY(nose.x, nose.z), sTail = seaY(tail.x, tail.z);
    const nAbove = nose.y - sNose, tAbove = tail.y - sTail;
    if (!st) {
      // FIRST SIGHT LATCHES, IT DOES NOT FIRE. Otherwise every shark in the
      // world splashes on the frame this tracker first sees it.
      st = a._wl = {
        n: nAbove > 0, t: tAbove > 0, ny: nose.y, ty: tail.y,
        cAcc: 0, cRing: 0, lastEntryKg: 0, lastEntryT: -99, lastExitT: -99,
      };
      return st;
    }
    const now = (CBZ.now != null ? CBZ.now : 0) / 1000;
    /* THE NOSE'S OWN VERTICAL SPEED, not the origin's — but CLAMPED to what the
       animal is actually doing. The nose's height is `origin + sin(pitch)*L/2`,
       so a POSE change moves it without the body moving at all: the launch
       snaps the pitch from level to fifty degrees in one frame, which on a long
       body teleports the analytic nose several metres and, differentiated,
       reads as 144 m/s. MEASURED before this clamp: the megalodon told the sea
       it had arrived at a hundred and forty-four metres a second. Nothing can
       displace water faster than it is travelling, so the body's own velocity
       is the ceiling (plus a little, because the ends of a pitching body
       genuinely do move faster than its middle). */
    const vBody = Math.hypot(+o.vy || 0, Math.hypot(+o.vx || 0, +o.vz || 0));
    const vCap = vBody * 1.6 + 2.5;
    const clampV = (v) => (v > vCap ? vCap : (v < -vCap ? -vCap : v));
    const nSpd = clampV((nose.y - st.ny) / dt);
    const tSpd = clampV((tail.y - st.ty) / dt);
    st.ny = nose.y; st.ty = tail.y;

    const nUp = nAbove > 0, tUp = tAbove > 0;

    /* WHERE THE SURFACE CUTS THE BODY. Interpolated along the axis between the
       two ends' heights, so it is the point at which water is actually being
       displaced — and it is what BOTH the burst and the curtain are placed at,
       because they are the same event at two time scales.

       It is used in preference to the nose tip on purpose. The launch snaps the
       pitch from level to fifty degrees in a single frame (the pose is derived
       from the velocity vector, and the velocity vector is discontinuous at the
       launch by definition), which TELEPORTS the nose of a twenty-five metre
       megalodon nine metres forward and up. Following that with the splash puts
       the sea's answer most of a body-length downrange of the animal. The cut
       moves a fraction as far for the same snap, and it is the honest place
       anyway: a rod through a plane displaces water where it meets the plane,
       not at its tip. */
    let cutS = 1;
    {
      // Solved in METRES along the body and then converted back, because the
      // origin is not the middle: the height runs linearly with DISTANCE from
      // the origin, not with the [-1,1] parameter, and on a rig whose snout is
      // 3 m forward and whose tail is 2 m aft those are not the same line.
      const den = tAbove - nAbove;
      const f = Math.abs(den) > 1e-4 ? Math.max(0, Math.min(1, tAbove / den)) : (nUp ? 1 : 0);
      const d = -ends.aft + (ends.fwd + ends.aft) * f;
      cutS = d >= 0 ? (ends.fwd > 0 ? d / ends.fwd : 1) : (ends.aft > 0 ? d / ends.aft : -1);
      cutS = Math.max(-1, Math.min(1, cutS));
    }
    const straddling = nUp !== tUp;
    const cut = straddling ? wlAxis(o, cutS, _wlCut) : nose;
    const cutSurf = straddling ? seaY(cut.x, cut.z) : sNose;
    if (straddling) cut.y = cutSurf;

    // ---- the nose crosses: this IS the splash, and this is WHERE it is ----
    if (nUp !== st.n) {
      st.n = nUp;
      if (Math.abs(nSpd) >= WL_MIN_SPD) {
        const kg = breachCross(a, cut.x, cutSurf, cut.z, nSpd, nUp, len,
                               o.vx || 0, o.vz || 0);
        if (nUp) st.lastExitT = now;
        else { st.lastEntryKg = kg; st.lastEntryT = now; }
      }
    }
    // ---- the tail follows it through: the flick ---------------------------
    if (tUp !== st.t) {
      st.t = tUp;
      if (Math.abs(tSpd) >= WL_MIN_SPD * 1.4) wlFlick(o, tail, tSpd, len);
    }

    // ---- and for every frame in between, the zipper -----------------------
    if (straddling) {
      // girth where the cut is: a fish is fattest a third back from the nose
      const girth = len * 0.115 * (1 - cutS * cutS * 0.62) * (cutS > 0 ? 0.92 : 1);
      // how fast the CUT is travelling through the water — the honest rate at
      // which water is being displaced, and it is the interpolation of the two
      // ends' speeds, not the origin's
      const spd = nSpd * ((cutS + 1) * 0.5) + tSpd * ((1 - cutS) * 0.5);
      if (Math.abs(spd) >= WL_MIN_SPD * 0.5) {
        wlCurtain(st, o, cut, cutS, spd, Math.max(0.18, girth), dt);
      }
    } else {
      st.cAcc = 0;
    }
    return st;
  }
  CBZ.marineWaterline = waterlineTick;
  // A body that teleports (a spawner, a bail-out, a mode change) must not be
  // read as having crossed the surface at ten metres a second.
  CBZ.marineWaterlineReset = function (a) { if (a) a._wl = null; };

  /* WATER COMES OFF A BODY THAT IS IN THE AIR, ALL THE WAY DOWN. A shark that
     leaves the sea dry is a model on a wire; the trail is the single cheapest
     thing that says "this was under the water a moment ago". Droplets are shed
     from points along the BODY AXIS (nose to tail, through the live pitch), they
     inherit the body's velocity, and the rate decays through the arc — heaviest
     in the first fraction of a second after the exit, a thin drizzle by the top.
     `o` is a caller-owned scratch object, so this allocates nothing. */
  function breachShed(o) {
    if (typeof CBZ.waterEmit !== "function") return 0;
    const dt = +o.dt || 0;
    if (!(dt > 0)) return 0;
    const len = Math.max(0.6, +o.len || 3);
    /* RATE: bigger animals carry more water, and the sheet thins as it drains.
       MEASURED and then raised: the first cut shed 18 droplets over a 1.2 s arc
       off a five-metre body, which at any real viewing distance is nothing at
       all — a shark that leaves the sea has a skin's worth of water on it and
       it comes off in the first half second. ~45 over the same arc reads as a
       body that was underwater a moment ago. The per-frame cap and the pool
       share below still keep it from eating the wakes' budget. */
    const wet = Math.max(0, Math.min(1, 1 - (+o.airT || 0) / Math.max(0.35, (+o.airTotal || 1) * 0.85)));
    const rate = (16 + len * 8.5) * (0.22 + wet * 1.05);
    o.acc = (+o.acc || 0) + rate * dt;
    let n = Math.floor(o.acc);
    if (n <= 0) return 0;
    o.acc -= n;
    const free = typeof CBZ.waterEmitFree === "function" ? CBZ.waterEmitFree() : 90;
    if (free < 3) { o.acc = 0; return 0; }
    n = Math.min(n, 8, Math.max(1, Math.round(free * 0.25)));
    const h = +o.heading || 0, p = +o.pitch || 0;
    const ch = Math.cos(p), sh = Math.sin(p);
    const ax = Math.cos(h) * ch, ay = sh, az = Math.sin(h) * ch;   // the body's own axis
    const nx = -Math.sin(h), nz = Math.cos(h);                     // and its beam
    let made = 0;
    for (let i = 0; i < n; i++) {
      // -0.5 at the nose .. +0.5 at the tail, biased aft (that is where the
      // water actually leaves a fish)
      const u = (fxRand() * 0.55 + fxRand() * 0.55) - 0.42;
      const s = u * len;
      const side = (fxRand() - 0.5) * len * 0.16;
      if (CBZ.waterEmit({
        x: (+o.x || 0) + ax * s + nx * side,
        y: (+o.y || 0) + ay * s + (fxRand() - 0.45) * len * 0.07,
        z: (+o.z || 0) + az * s + nz * side,
        vx: (+o.vx || 0) * 0.55 + nx * side * 2.2 + (fxRand() - 0.5) * 1.1,
        vy: (+o.vy || 0) * 0.42 - 0.6 - fxRand() * 1.1,
        vz: (+o.vz || 0) * 0.55 + nz * side * 2.2 + (fxRand() - 0.5) * 1.1,
        size: 0.085 + Math.min(0.34, len * 0.019) * (0.5 + fxRand()),
        grow: -0.07, ttl: 0.42 + fxRand() * 0.7, alpha: 0.82,
      })) made++;
    }
    AQUATIC_AUDIT.trailDrops += made;
    return made;
  }
  CBZ.marineBreachShed = breachShed;

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
    /* BITE HOMING. While a bite is in flight at a live target, the body
       borrows steering authority toward it — clamped and brief (a bite lasts
       well under a second), stronger than the player's own turn but never a
       snap. With acquisition wider than the closing reach the lunge has a gap
       to cross, and "move is the only control" (shark sim) means nobody can
       line the mouth up by hand mid-strike; this is the difference between an
       auto-bite that lands and one that flaps at the water next to a fish.
       The player's steering above still writes first — this only bends it. */
    const biteTgt = (ride.attackT > 0 && ride.target && !ride.target.dead && ride.target.pos)
      ? ride.target : null;
    if (biteTgt) {
      const wantB = Math.atan2(biteTgt.pos.z - P.pos.z, biteTgt.pos.x - P.pos.x);
      const seek = Math.max(R.turn || 2.2, 2.2) * 1.7 * fdt;
      let db = shortestAngle(wantB - ride.head);
      if (db > seek) db = seek; else if (db < -seek) db = -seek;
      ride.head += db;
    }
    const sprint = !blockedInput && !!keys.shift && len > 0.001 && (P.stamina == null || P.stamina > 0);
    const wantSpeed = len > 0.001 ? (sprint ? R.sprint : R.cruise) : 0;
    if (W.airborne) {
      /* THERE IS NOTHING TO PUSH AGAINST. This accelerator is a tail beating
         WATER, and it ran unconditionally — so the launch's conversion of the
         charge into climb was undone in half a second while the animal was
         metres above the sea. MEASURED (bull shark, seed 90210): the launch cut
         the forward speed to 8.8 m/s and by the entry frame it was back at
         16.85, which took the flight path from 50 degrees down to 28 and turned
         the leap back into a skip. In the air the body keeps exactly what it
         left with, less a whisper of drag. */
      W.v *= Math.exp(-0.25 * fdt);
    } else {
      const accel = wantSpeed > W.v ? 8.5 + R.cruise * 0.7 : 5.5 + R.cruise * 0.35;
      const dv = Math.max(-accel * fdt, Math.min(accel * fdt, wantSpeed - W.v));
      W.v = Math.max(0, W.v + dv);
    }
    P.sprint = sprint; P.speed = W.v;

    const bodyScale = Math.max(0.35, liveScale(a));
    const groundD = rideGroundDepth(bodyScale);
    /* AGROUND IS A STATE, NOT A FAILURE. Orcas beach on purpose; so may you.
       The belly is on sand, the body can still bite, and the only thing that
       changes is that the cruise becomes a thrash. */
    const aground = !W.airborne && waterDepth(P.pos.x, P.pos.z) < groundD;
    W.aground = aground;
    W.groundT = aground ? (W.groundT || 0) + fdt : 0;
    if (aground) W.v = Math.min(W.v, 1.15 + bodyScale * 0.45);

    if (W.v > 0.001) {
      /* THE PLAYER OWNS THE WHEEL. This used to be one line —
       `ride.head = nav.heading` — which handed the animal's entire heading to
       the shore-following navigator, so the closer you steered to the beach
       the harder something else steered you off it. That is the "blocked five
       feet from shore" feel, and no clearance number could have fixed it.
       The navigator is demoted to a FENCE: it answers where the body may be,
       never where it is pointing. */
      const stepLen = W.v * fdt;
      let nx = P.pos.x + Math.cos(ride.head) * stepLen;
      let nz = P.pos.z + Math.sin(ride.head) * stepLen;
      // An airborne body lands where physics puts it (a breach that cannot
      // cross the block line is not a breach), and a beached one must be free
      // to work itself back out over ground it is already lying on.
      if (!W.airborne && !aground && !rideCanSwim(nx, nz, groundD, bodyScale)) {
        // A COMMITTED SPRINT BEACHES. Cruising into the sand does not: that is
        // the difference between an accident and an orca.
        if (!(sprint && W.v > (R.cruise || 6) * 0.85)) {
          const slid = rideShoreSlide(P.pos.x, P.pos.z, ride.head, stepLen, groundD, bodyScale);
          if (slid) {
            nx = slid.x; nz = slid.z;
            ride.head += shortestAngle(slid.heading - ride.head) * 0.35;
          } else { nx = P.pos.x; nz = P.pos.z; W.v *= 0.35; }
        }
      }
      P.pos.x = nx; P.pos.z = nz;
    }

    const surf = seaY(P.pos.x, P.pos.z);
    const vin = blockedInput ? 0 : verticalRideInput(keys);
    if (W.breachCd > 0) W.breachCd = Math.max(0, W.breachCd - dt);
    if (W.airborne) {
      W.vy -= BREACH_G * fdt;
      W.y += W.vy * fdt;
      W.airT = (W.airT || 0) + fdt;
      if (W.y - surf > (W.airPeak || 0)) W.airPeak = W.y - surf;
      /* THE BODY IS ITS OWN FLIGHT PATH. This used to read
         `atan2(W.vy, Math.max(4, W.v))` and the max() is not the problem — the
         problem was upstream, at the launch, which SHOVED the horizontal speed
         up to 1.04x sprint at the exact moment the animal is supposed to be
         spending it on climb. A great white left the water at 10.6 m/s up and
         16.2 m/s along: a 33-degree flight path, i.e. a skip across the surface
         with 19 m of range, and the one frame of authored 0.78 rad at the
         launch was the only moment the body ever looked like it was leaping.
         The launch below now converts the run-up instead of adding to it, so
         the path itself is 55 degrees (MEASURED, great white, seed 90210:
         nose-up 55.1 at the steepest and nose-down 56.8 into the water, against
         44.7 and 26.6 before) and this line is free to be the honest
         answer: the nose points exactly where the animal is going, all the way
         from a steep climb, through level at the top, to a nose-down entry. */
      W.pitch = Math.max(-1.25, Math.min(1.32, Math.atan2(W.vy, Math.max(0.8, W.v))));
      /* AND IT ROLLS THROUGH THE ARC. A breaching shark is not a dart — it
         comes over onto a flank at the top and shows you its whole side, which
         is the read every breach photograph is. Peaks just past the apex and is
         still carrying some of it into the water, which is what puts the flank
         into the entry splash. */
      const u = Math.max(0, Math.min(1, W.airT / Math.max(0.25, W.airTotal || 1)));
      W.roll = (W.airSpin || 1) * BREACH_ROLL * Math.sin(u * 2.67);
      if (W.pitch > (W.pitchUp || 0)) W.pitchUp = W.pitch;
      if (W.pitch < (W.pitchDown || 0)) W.pitchDown = W.pitch;
      if (Math.abs(W.roll) > (W.rollPeak || 0)) W.rollPeak = Math.abs(W.roll);
      // THE ALIGNMENT, measured rather than asserted: how far the body's
      // attitude sits from its true velocity vector. It has to stay at zero —
      // an arc whose pose is animated instead of derived is a lie the pictures
      // cannot show you.
      const trueA = Math.atan2(W.vy, Math.max(0.001, W.v));
      const err = Math.abs(W.pitch - trueA);
      if (err > (W.alignErr || 0)) W.alignErr = err;
      /* SHEDDING. Water comes off a body in the air all the way down. Emitted
         from points along the live body AXIS (through the live pitch), so the
         trail hangs off the animal rather than off a point in space. */
      _rideShed.x = P.pos.x; _rideShed.y = W.y; _rideShed.z = P.pos.z;
      _rideShed.heading = ride.head; _rideShed.pitch = W.pitch;
      _rideShed.len = bodyLenLive(a);
      _rideShed.vx = Math.cos(ride.head) * W.v; _rideShed.vz = Math.sin(ride.head) * W.v;
      _rideShed.vy = W.vy; _rideShed.dt = fdt;
      _rideShed.airT = W.airT; _rideShed.airTotal = W.airTotal || 1;
      breachShed(_rideShed);
      // A LEAP CAN LAND ON SAND. The old test only ever asked about the
      // waterline, so a breach that cleared the swash kept "falling" to a sea
      // floor that was not under it and popped up a frame later. The ground is
      // a landing surface too — that is what makes an intentional beaching a
      // move rather than a glitch.
      const landBed = bedYAt(P.pos.x, P.pos.z) + Math.max(0.35, bodyScale * 0.32);
      if (W.vy < 0 && (W.y <= surf - Math.max(0.18, (a.swimDepth || 1) * 0.12) || W.y <= landBed)) {
        W.airborne = false;
        W.y = Math.max(landBed, surf - Math.max(0.22, (a.swimDepth || 1) * 0.18));
        // Re-entry keeps a real fraction of the fall as plunge momentum: a
        // megalodon coming down off six metres should CARRY, not stop dead on
        // the waterline the way the old flat 22% bleed made it.
        const fall = Math.abs(W.vy);
        W.vy = -Math.min(3.8 + bodyScale * 2.4, Math.max(1.8, fall * 0.34));
        W.v *= 0.78; W.breachCd = 1.15;
        AQUATIC_AUDIT.reentries++;
        AQUATIC_AUDIT.lastApex = +(W.airPeak || 0).toFixed(2);
        AQUATIC_AUDIT.lastAirT = +(W.airT || 0).toFixed(2);
        AQUATIC_AUDIT.lastPitchUp = +(W.pitchUp || 0).toFixed(3);
        AQUATIC_AUDIT.lastPitchDown = +(W.pitchDown || 0).toFixed(3);
        AQUATIC_AUDIT.lastRoll = +(W.rollPeak || 0).toFixed(3);
        AQUATIC_AUDIT.lastAlignErr = +(W.alignErr || 0).toFixed(4);
        /* THE SPLASH IS NOT FIRED HERE ANY MORE, AND THAT IS THE FIX.

           This test is about the ORIGIN — the middle of the animal — dropping
           below the waterline, which for a twenty-two metre megalodon coming
           down at fifty degrees happens 0.70 SECONDS and 9.9 METRES after the
           nose actually went in (MEASURED, tools/splash-timing-check.mjs).
           Firing the sea's answer from here is what the owner was watching:
           "the splash animation is delayed which is really funny and fucking
           dumb". It was not an animation and it was not delayed — it was fired
           off the wrong point on the body.

           waterlineTick() below owns every crossing now, at the NOSE, on the
           frame it happens. All this block still needs from it is HOW BIG the
           entry was, for the shake — and a leap that came down on sand never
           had a crossing at all, which is what keeps the beach thud a thud. */
        const wl = a._wl;
        const nowS = (CBZ.now != null ? CBZ.now : 0) / 1000;
        const entryKg = (wl && nowS - wl.lastEntryT < 0.6) ? wl.lastEntryKg : 0;
        // ...and a leap that comes down on the beach still lands: no water to
        // displace, so it is a thud, and the shake is the whole report.
        if (CBZ.shake) {
          CBZ.shake(Math.min(2.4, 0.35 + bodyScale * 0.30 + fall * 0.020 +
            (entryKg > 0 ? Math.min(0.7, entryKg * 0.00006) : 0)));
        }
        W.airT = 0; W.airPeak = 0; W.airTotal = 0;
        W.pitchUp = 0; W.pitchDown = 0; W.rollPeak = 0; W.alignErr = 0;
      }
    } else {
      let wantVy = vin > 0 ? (R.rise || 4) : (vin < 0 ? -(R.dive || 4) : 0);
      let vAct = !!vin;
      /* ..AND THE DEPTH CLOSES TOO. An explicit rise/dive always wins, but
         with no thumb on the axis a bite in flight pulls the body's column
         toward the meal's — the missing metre of depth was most auto-bite
         whiffs (a shark cruising at its own draft over a wader's ankles).
         The bed floor and surface top clamps below still own where the body
         may actually be, so this can never bury or beach anything. */
      if (!vAct && biteTgt && biteTgt.pos.y != null) {
        const dy = biteTgt.pos.y - W.y;
        if (Math.abs(dy) > 0.25) {
          wantVy = Math.max(-(R.dive || 4), Math.min(R.rise || 4, dy * 2.4));
          vAct = true;
        }
      }
      const va = vAct ? 12 : 5.5;
      W.vy += Math.max(-va * fdt, Math.min(va * fdt, wantVy - W.vy));
      if (!vAct) W.vy *= Math.exp(-2.8 * fdt);
      W.y += W.vy * fdt;
      // THE BED IS THE GROUND, asked of the bathymetry oracle — not "the
      // surface minus a column we made up". In a foot of swash that puts the
      // origin ABOVE the waterline with the belly on wet sand, which is what a
      // shark in the shallows actually looks like; on dry beach the ground is
      // above the sea and the body rests on the beach instead of sinking to a
      // sea floor that isn't under it.
      const bedY = bedYAt(P.pos.x, P.pos.z) + Math.max(0.35, liveScale(a) * 0.32);
      // HOW HIGH THE BODY MAY RIDE. `0.36 × swimDepth` for a breacher is what
      // lets the dorsal cut the surface before a leap; MARINE_SIT_DEEPER trims
      // that by a fifth so a shark at full rise sits IN the water rather than
      // half out of it (the owner's "slightly too high up in the water" — the
      // ridden half of it; the wild half is in wildlife_shark/orca's depth()).
      const topK = (R.breach ? 0.36 : 0.72) * (DEEPER_ON() ? 1.2 : 1);
      const topY = surf - Math.max(0.28, (a.swimDepth || 1) * topK);
      // Water shallower than the body's cruise depth crosses the clamps —
      // a megalodon (swimDepth ~8) in 3 m of surf had topY UNDER the seabed
      // and got wedged into the ground. The honest posture is riding the
      // bed, dorsal out of the water.
      const effTop = Math.max(topY, bedY);
      if (W.y < bedY) { W.y = bedY; if (W.vy < 0) W.vy = 0; }
      if (W.y > effTop) { W.y = effTop; if (W.vy > 0) W.vy *= 0.42; }
      W.pitch += (Math.max(-0.62, Math.min(0.72, W.vy * 0.115)) - W.pitch) * Math.min(1, fdt * 4.2);
      /* THE LAUNCH. Sprint + rise, held until the body is at the top of its
         column — you cannot breach from twenty metres down, and you cannot
         breach standing still.

         THE `W.vy > 1.2` TERM WAS A COIN FLIP, NOT A CONDITION, and it is gone.
         The surface clamp three lines up multiplies a rising W.vy by 0.42 on
         EVERY frame the body is pinned at the top of its column, against a
         vertical accelerator that adds 0.4 m/s per frame — a steady state of
         about 0.29 m/s. So the moment the animal ARRIVED where it is supposed
         to launch from, the gate it had to pass could no longer open, and the
         only breaches that ever fired were the ones that caught the single
         approach frame in which the body first crossed into the 8 cm window
         while still travelling at 0.15 m per frame. Roughly a coin flip, and
         after that the player could hold sprint+rise forever and get nothing.
         MEASURED: a megalodon held both keys at the top of its column for six
         seconds and never left the water, in a build that launched a great
         white in a third of a second.

         Being at the top and asking to go up IS the condition: `vin > 0` is the
         intent, `sprint` is the run-up, and `effTop` (not topY) is where the
         body actually is — in shallow water the bed is the ceiling, and a shark
         launching off the bottom with its dorsal already out is a real breach
         and used to be an impossible one. */
      if (R.breach && sprint && vin > 0 && W.breachCd <= 0 && W.y >= effTop - 0.12) {
        W.airborne = true;
        /* THE APEX IS ABOVE THE WATER, NOT ABOVE THE LAUNCH. R.breachVel is
           solved to clear `apex` metres against BREACH_G — but the launch does
           not happen at the waterline, it happens at the top of the body's
           column, which for a big animal is metres DOWN: a megalodon's own
           surface clamp sits it 3.37 m under, so it spent well over half of its
           authored 5.8 m of air just getting to the surface and cleared the sea
           by 2.4 m. The bigger the animal, the more of its jump it lost, which
           is precisely backwards. Adding the launch depth back under the root
           gives every body the air it was authored to have, measured from the
           only line anybody watching cares about. */
        W.vy = Math.sqrt(Math.pow(R.breachVel || 15.5, 2) +
                         2 * BREACH_G * Math.max(0, surf - W.y));
        W.airT = 0; W.airPeak = 0;
        /* THE RUN-UP IS SPENT, NOT ADDED TO. `W.v = Math.max(W.v, R.sprint *
           1.04)` was the single line that made this a hop: at 16 m/s along and
           10.5 m/s up a great white left the water on a 33-degree path and
           travelled nineteen metres, which from a chase camera is a body
           skipping across the sea. A breaching animal converts the charge into
           climb — it arrives at the surface going UP — so the forward speed is
           cut here and the same launch velocity buys a ~50-degree spear arc
           with about half the range and all of the height. Everything else
           (apex, hang time, entry speed) is unchanged: they were always solved
           from R.breachVel and R.breachVel has not moved. */
        W.v = Math.max((R.cruise || 6) * 0.42, W.v * 0.52);
        W.pitch = Math.max(-1.25, Math.min(1.32, Math.atan2(W.vy, Math.max(0.8, W.v))));
        // total hang time, solved once so the roll can be phased against the
        // whole arc instead of against a clock that does not know when it ends
        W.airTotal = (2 * W.vy) / BREACH_G;
        // WHICH WAY IT COMES OVER. Deterministic (the same body at the same
        // heading always rolls the same way) and effectively arbitrary, so a
        // sequence of breaches does not read as a machine.
        W.airSpin = ((Math.floor(Math.abs(ride.head) * 997) & 1) ? 1 : -1);
        W.pitchUp = W.pitch; W.pitchDown = 0; W.rollPeak = 0; W.alignErr = 0;
        AQUATIC_AUDIT.breaches++;
        /* THE EXIT IS NOT FIRED HERE EITHER. The launch happens at the top of
           the body's COLUMN, which for a megalodon is 3.4 m under the surface —
           so a splash fired on this line went off in open water above an animal
           that had not arrived yet, and by the time the nose broke through, the
           sea had already finished answering. waterlineTick() fires it when the
           nose is actually through, and then keeps throwing water for every
           frame the body is still coming out. */
        if (CBZ.shake) CBZ.shake(0.42 + bodyScale * 0.12);
      }
    }
    /* THRASHING READS AS EFFORT. A beached body shoving itself over wet sand
       throws spray every time it flexes; without it the animal just slides
       and the whole beat looks like a physics bug. Rolls harder than a
       swimming body too — that side-to-side working is the escape. */
    if (aground) {
      W.thrashT = (W.thrashT || 0) + fdt;
      if (W.thrashT > 0.34 && W.v > 0.12) {
        W.thrashT = 0;
        if (CBZ.marineSurfaceHit) { try { CBZ.marineSurfaceHit(P.pos.x, P.pos.z, 1.1 + bodyScale * 0.5); } catch (e) {} }
        else if (CBZ.waterSplashAt) CBZ.waterSplashAt(P.pos.x, surf, P.pos.z, 1.0 + bodyScale * 0.6);
      }
      W.roll = Math.max(-0.5, Math.min(0.5,
        Math.sin((W.groundT || 0) * 6.4) * 0.34 * Math.min(1, 0.25 + W.v)));
      W.lastHead = ride.head;
    } else if (W.airborne) {
      /* HANDS OFF THE ROLL IN THE AIR. The turn-roll below is a bank into a
         steering input and it ran unconditionally, so it overwrote the arc's
         own roll every frame — which is why a breach used to come out of the
         water perfectly upright no matter what. In the air the arc owns it. */
      W.thrashT = 0; W.lastHead = ride.head;
    } else {
      W.thrashT = 0;
      W.roll += ((shortestAngle(ride.head - W.lastHead) / fdt) * -0.065 - W.roll) * Math.min(1, fdt * 4);
      W.roll = Math.max(-0.42, Math.min(0.42, W.roll)); W.lastHead = ride.head;
    }
    /* THE SEA ANSWERS THE BODY, EVERY FRAME. Last thing in the update, so the
       position and the pose it reads are the ones that will be DRAWN this
       frame — a tracker fed a half-updated body would report a crossing that
       never appears on screen. It owns the entry, the exit, the curtain that
       travels down the body while it is passing through, and the tail flick;
       nothing else in this file fires a splash any more. */
    _rideWL.x = P.pos.x; _rideWL.y = W.y; _rideWL.z = P.pos.z;
    _rideWL.heading = ride.head; _rideWL.pitch = W.pitch;
    _rideWL.len = bodyLenLive(a);
    _rideWL.vx = Math.cos(ride.head) * W.v; _rideWL.vz = Math.sin(ride.head) * W.v;
    _rideWL.vy = W.vy; _rideWL.dt = fdt;
    waterlineTick(a, _rideWL);

    // the camera root, not the drawn rider: the strike animation stays off it
    // (see "THE LENS DOES NOT RIDE THE BITE" at the 49.8 presentation pass)
    P.pos.y = W.y + aquaticSeatY(V, W.pitch);
    P.vy = W.vy; P.grounded = false; P._fallPeak = 0;
    P._swim = false; P._aquaticMount = a;
    return true;
  };

  /* ============================================================
     THE DIVE CAMERA (SHARK_RIDE_DIVE) — why the sea had a lid.

     MEASURED on the live page (mode=sharksim, seed 90210, bull shark): hold
     Ctrl for four seconds and the BODY goes from 1.43 m under the surface to
     7.13 m under — the ride's vertical controller was never the problem. The
     CAMERA went from above the water to 0.69 m under it and stopped, because
     systems/camera.js frames an island player from a 2.08 m pivot on a ~7 m
     boom: the lens lives five and a half metres over the body no matter where
     the body goes, and over open sea five and a half metres is the sky.

     Everything the owner means by "real underwater" — world/water_underwater.js's
     fog ramp, the caustic ceiling, the god rays, the waterline band, the 820 Hz
     muffle — is a READ-ONLY OBSERVER OF THE CAMERA (it asks CBZ.cityWaterAt /
     CBZ.citySeaHeightAt where the eye is, nothing more). So there was never a
     missing underwater system to build for the shark. There was an eye in the
     wrong place. This pass moves the eye; the existing system does the rest.

     HOW IT COMPOSES INSTEAD OF COMPETING. Order 50.4 is deliberate and sits in
     a two-sided gap: AFTER systems/camera.js's one and only writer (onAlways 50)
     so nothing can clobber us mid-frame, and BEFORE water_underwater.js's
     observer (onAlways 50.5) so the depth it grades is the depth we just moved
     to. camera.js is not edited, is not flagged off, and keeps owning yaw,
     pitch, collision, shake and FOV.

     THE MOVE ITSELF is one lerp and NO rotation write, which is the whole
     trick. The target is `body − viewDirection × distance`: the point from
     which the camera's CURRENT aim already looks straight down the barrel at
     the animal. So at k=0 nothing happens at all, at k=1 the body is dead
     centre, and in between it eases toward centre while the player's own yaw
     and pitch keep orbiting — because the target is defined FROM the live view
     direction, steering still steers. Rotation is never touched, so there is
     no fight with camera.lookAt and nothing to unwind when we stand down.
  ============================================================ */
  const _diveWant = new THREE.Vector3(), _diveDir = new THREE.Vector3();
  function aquaticDiveCamera(dt) {
    if (!DIVE_ON()) return;
    const a = ride.mount, W = ride.water, P = CBZ.player, cam = CBZ.camera;
    if (!cam || !a || !W || !P || a.dead || P.dead || !aquaticMounted(a)) return;
    if (!CBZ.game || CBZ.game.state !== "playing") return;
    // Never wrestle an owner with a stronger claim on the lens.
    if (CBZ.cineCam && CBZ.cineCam.active) return;
    if (CBZ.simView && CBZ.simView.active) return;
    if (CBZ.cityCam && CBZ.cityCam.death) return;
    if (CBZ.fps && CBZ.fps.active) return;      // first person already rides the body
    const surf = seaY(P.pos.x, P.pos.z);
    const sub = surf - W.y;                     // the BODY's submergence, not the rider's seat
    /* ---- THE LENS CROSSES THE SURFACE WITH THE BODY -----------------------
       Everything world/water_underwater.js draws — the fog ramp, the caustic
       ceiling, the god rays, the waterline band, the 820 Hz muffle — is decided
       from the CAMERA's own depth (its eyeDepth() asks citySeaHeightAt where
       the EYE is, not where the animal is). A breach is the one move in this
       game that takes the body from under the water to five metres over it in
       half a second, and NOTHING owned that crossing: the lerp below stands
       down the instant the body leaves the water (sub goes negative, so k <= 0
       and it returns), and camera.js's boom smooth-damps toward the rider on a
       time constant tuned for walking. So the world stayed green through the
       best part of the jump, which is exactly the frame this whole pass is for.

       This is a FLOOR under the eye, never a target: while the body is out of
       the water the lens is dragged out with it, at least as fast as the body
       is leaving, and the moment camera.js has the lens above the line this
       does nothing at all. It cannot fight the boom because it can only ever
       push the same way gravity is not. */
    if (W.airborne) {
      const camSurf = seaY(cam.position.x, cam.position.z);
      const out = Math.max(0, W.y - surf);
      const wantY = camSurf + Math.min(1.9, 0.30 + out * 0.55);
      if (cam.position.y < wantY) {
        const step = Math.max(7, Math.abs(W.vy) + 5) *
          Math.max(0.001, Math.min(0.08, dt || 0.016));
        cam.position.y = Math.min(wantY, cam.position.y + step);
      }
      return;
    }
    // Dead band at the surface so a swell can never make the frame breathe, and
    // full authority by ~2.6 m down — the depth at which the old rig had the
    // lens still in the air and the whole treatment still switched off.
    const k = Math.min(1, (sub - 0.45) / 2.2);
    if (!(k > 0)) return;
    cam.getWorldDirection(_diveDir);
    const scale = Math.max(0.35, liveScale(a));
    // A CONSTANT distance, not the measured one: measuring our own previous
    // frame's result and feeding it back in is how a camera starts creeping.
    // Sized to the hull so a megalodon is framed like a megalodon.
    const dist = Math.max(4.5, Math.min(26, 4.2 + scale * 3.2));
    _diveWant.set(
      P.pos.x - _diveDir.x * dist,
      W.y - _diveDir.y * dist,
      P.pos.z - _diveDir.z * dist);
    // ...but never inside the bottom. Same 0.4 m stand-off camera.js's own
    // water floor uses, off the same bathymetry oracle.
    if (CBZ.citySeaBedYAt) {
      const bed = +CBZ.citySeaBedYAt(_diveWant.x, _diveWant.z);
      if (Number.isFinite(bed) && _diveWant.y < bed + 0.4) _diveWant.y = bed + 0.4;
    }
    cam.position.lerp(_diveWant, k);
  }
  if (CBZ.onAlways) CBZ.onAlways(50.4, aquaticDiveCamera);
  /* THE SHORE LAW, PUBLISHED. modes/shark_sim.js owns the anti-softlock slide
     off a beach and needs to know when the body is genuinely aground and when
     it can swim again. Those are the ride's numbers, so it asks the ride —
     a second copy of the thresholds in the mode file is how the old 0.30/0.50
     conveyor ring came to wall the entire shore. `release` sits above `ground`
     so the two do not chatter across one threshold. */
  /* ---- THE MOUNT GREW UNDER ITS RIDER -----------------------------------
     city/wildlife.js calls this from applyScale() whenever a RIDDEN animal
     changes size, which since the mass economy is every few seconds of a good
     match. `ride.visual` is the saddle socket measured off the body's bounding
     boxes at mount time (animalSaddle multiplies by group.scale, so it is a
     snapshot of the old body), and everything the rider's position, seat
     height, jump and camera boom read comes out of it.

     The fix is to DROP the snapshot, not to patch it: the next tick rebuilds
     it from the live group in exactly the same way the mount did, so there is
     no second derivation to drift. The seat is then re-solved immediately so
     the rider does not spend a frame inside the animal that just doubled.

     Without this a shark that grows mid-match slowly swallows its own camera
     (the boom is sized off the hull) and floats its rider off the back. */
  CBZ.wildlifeRideResize = function (a) {
    if (!a || a !== ride.mount) return false;
    ride.visual = null;
    const V = ride.visual = rideVisualSpec(a.species, a.group);
    if (!V) return false;
    const P = CBZ.player;
    if (P && ride.water && V.aquatic) {
      P.pos.y = ride.water.y + aquaticSeatY(V, ride.water.pitch);
    }
    if (P) P._rideJump = V.jump;
    return true;
  };

  CBZ.cityAquaticShoreLaw = function () {
    const a = ride.mount, W = ride.water;
    if (!a || !W || !aquaticMounted(a)) return null;
    const scale = Math.max(0.35, liveScale(a));
    const ground = rideGroundDepth(scale);
    return {
      species: a.species ? a.species.id : null, scale: scale,
      ground: +ground.toFixed(3),
      release: +(ground * 1.45 + 0.06).toFixed(3),
      aground: !!W.aground, groundT: +(W.groundT || 0).toFixed(2),
      airborne: !!W.airborne,
      // Somebody is working the body: a thrashing player is not softlocked,
      // so the mode's rescue timer gets to run at half rate against them.
      moving: (W.v || 0) > 0.12,
      depth: +waterDepth(CBZ.player ? CBZ.player.pos.x : 0, CBZ.player ? CBZ.player.pos.z : 0).toFixed(3),
    };
  };

  // Tooling seam: the one number the before/after is actually about.
  CBZ.cityAquaticRideDepths = function () {
    const a = ride.mount, W = ride.water, P = CBZ.player, cam = CBZ.camera;
    if (!a || !W || !P) return null;
    const surf = seaY(P.pos.x, P.pos.z);
    const v = new THREE.Vector3();
    if (cam) cam.getWorldPosition(v);
    // THE EYE'S OWN WATERLINE, not the body's. water_underwater.js's eyeDepth()
    // asks citySeaHeightAt at the CAMERA's x/z; measuring the camera against
    // the surface under the animal is a different number and quietly disagrees
    // with the thing that actually decides whether the world is tinted.
    const camSurf = cam ? seaY(v.x, v.z) : surf;
    return {
      species: a.species ? a.species.id : null,
      bodyDepth: +(surf - W.y).toFixed(2),
      camDepth: cam ? +(camSurf - v.y).toFixed(2) : null,
      submerged: CBZ.cityCameraSubmerged ? !!CBZ.cityCameraSubmerged() : null,
      airborne: !!W.airborne, vy: +(W.vy || 0).toFixed(2),
      apex: +(W.airPeak || 0).toFixed(2),
      surf: +surf.toFixed(2),
      pitch: +(W.pitch || 0).toFixed(3),
      roll: +(W.roll || 0).toFixed(3),
      speed: +(W.v || 0).toFixed(2),
    };
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
    const size = Math.max(0.7, liveScale(a));
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
    // BEFORE the mount reference goes: endClamp puts the Euler order back on
    // THIS body and unpins whatever it was holding.
    if (ride.clampT > 0) endClamp(a);
    ride.mount = null; a.ridden = false;
    ride.visual = null; ride.water = null;
    ride.attackT = ride.attackCd = 0; ride.attackHitP = -1; ride.target = null; ride.targetKind = null;
    ride.attackPitch = ride.attackRoll = 0;
    ride.lensT = 0; ride.hurtT = 0; ride.hurtAmp = 0; ride.hurtAcc = 0;
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
      const off = 1.1 + liveScale(a) * 0.55;
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
  /* WHERE THE MOUNT IS POINTING — the one number that is the aim.

     `ride.head` is not a pose, it is the aim: the bite probe's forward cone
     (inBiteFront), the damage direction, the animal's own heading and the
     rider's yaw are all read off it. Everything OUTSIDE this file that needs
     to know or set where the mount is looking — the angle-contest tooling
     that stages an approach bearing, most obviously — was reaching for a
     closure it cannot see, so it is published here as a getter/setter pair in
     one function rather than as a raw handle to the ride object. Passing a
     number turns the mount; passing nothing just asks. */
  /* ============================================================
     BEING EATEN IS THE ONLY THING THAT SHAKES THE LENS.

     Owner, 2026-08-29: "if im getting eaten the shaking is awesome like if im
     getting bit actively and shaken idk just a thought but otherwise it should
     be almost entirely taken out."

     That is a design, not a tuning note, and it inverts what this game was
     doing. Measured with tools/shark-shake-check.mjs: eating a stocked beach
     fired 57 shakes in 90 s, while three orcas landing 566 damage ON the
     player fired ZERO — every jolt in the game came from the player's own
     mouth. So every self-inflicted jolt below is gone or cut to a beat, and
     the whole shake budget moved here.

     TWO CHANNELS, because "bit" and "shaken" are two different feelings:
       · THE BITE  — one jolt per hit, scaled by how much of you it took. A
                     nip off a small orca is a knock; a megalodon closing on
                     you is a slam.
       · THE MOB   — a sustained rumble at ~6 Hz for as long as they keep
                     landing hits, topped up by each one and decaying the
                     moment they let go. A pod working you over shakes the
                     screen continuously; one nip does not. The 6 Hz re-drive
                     is systems/impactbus.js's rumble trick: a per-frame
                     CBZ.shake re-triggers camera.js's envelope every frame and
                     reads as a buzz rather than as weight.
     ============================================================ */
  CBZ.rideDamageFelt = function (a, dmg) {
    if (!a || a !== ride.mount || !(dmg > 0)) return;
    const P = CBZ.player;
    if (!P || P.dead || g.state !== "playing") return;
    // how much of YOU that bite took: a fraction, so it reads the same on a
    // bull shark and on a megalodon rather than tracking raw hit points
    const maxHp = a.maxHp || (a.species && a.species.hp) || 100;
    const bit = Math.max(0, Math.min(1, dmg / Math.max(1, maxHp)));
    if (CBZ.shake) { try { CBZ.shake(Math.min(1.3, 0.28 + bit * 3.2)); } catch (e) {} }
    // the mob: each hit tops the rumble up and extends it. Stacking amplitude
    // (not just time) is what makes three orcas feel different from one.
    ride.hurtAmp = Math.min(0.55, ride.hurtAmp + 0.10 + bit * 1.1);
    ride.hurtT = Math.min(2.2, ride.hurtT + 0.55 + bit * 2.0);
    if (CBZ.sfx) { try { CBZ.sfx("hit", { volume: Math.min(1, 0.45 + bit * 1.2) }); } catch (e) {} }
  };

  CBZ.cityMountedHeading = function (h) {
    if (typeof h === "number" && isFinite(h)) {
      ride.head = h;
      if (ride.mount) faceAnimal(ride.mount, h);
      if (ride.water) ride.water.lastHead = h;
    }
    return ride.head;
  };

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
        const trMax = (7.5 / (1 + liveScale(a) * 0.35)) * dt;
        if (hd > trMax) hd = trMax; else if (hd < -trMax) hd = -trMax;
        ride.head += hd;
      } else ride.head = Math.atan2(mdz, mdx);        // legacy snap (flag off)
    }
    ride.lx = gx; ride.lz = gz;
    const airborne = W ? !!W.airborne : (!P.grounded || Math.abs(P.vy || 0) > 0.05);
    // Gallop bob only while grounded and moving. Airborne motion is the shared
    // ballistic root itself; adding a second sine there would make the animal
    // detach visually from its collision trajectory.
    if (ride.lensT > 0) ride.lensT = Math.max(0, ride.lensT - dt);
    /* THE MOB RUMBLE (see rideDamageFelt). Driven at ~6 Hz, never per frame,
       and it falls off with its own remaining time so letting go of you reads
       as relief rather than as a cut. */
    if (ride.hurtT > 0) {
      ride.hurtT = Math.max(0, ride.hurtT - dt);
      ride.hurtAmp = Math.max(0, ride.hurtAmp - dt * 0.30);
      ride.hurtAcc += dt;
      if (ride.hurtAcc >= 0.16) {
        ride.hurtAcc = 0;
        const k = ride.hurtT / 2.2;
        if (CBZ.shake && ride.hurtAmp > 0.02) { try { CBZ.shake(ride.hurtAmp * (0.35 + k)); } catch (e) {} }
      }
    } else ride.hurtAmp = 0;
    ride.phase += dt * (moving ? 9 : 0.6);
    const bob = !W && moving && !airborne ? Math.abs(Math.sin(ride.phase)) * 0.09 * liveScale(a) : 0;
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
      /* ---- THE LENS DOES NOT RIDE THE BITE ------------------------------
         P.pos.y is not where the rider is drawn — the rider is drawn above,
         glued to the animal with the full pose, and it should be. P.pos.y is
         the point systems/camera.js FRAMES, and it was solved off the same
         euler, which means it inherited the strike animation: a ±0.34 rad
         nose swing plus a 0.09 rad thrash at about five hertz, every couple
         of seconds, for as long as the shark kept eating. That is the game's
         core loop vibrating the screen.

         So the camera root is solved from the SWIM pose only (roll/pitch out
         of the water integrator, the same yaw). The shark still lunges, the
         rider still rides it, and the lens holds still while it happens. */
      if (W) {
        camEul.set(W.roll, a.group.rotation.y, W.pitch, a.group.rotation.order);
        camSeatV.set(V.x, V.y, 0).applyEuler(camEul);
        P.pos.y = rootY + bob + camSeatV.y - riderHipV.y;
      }
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
      attackProgress: ride.attackT > 0 && ride.attackDur > 0
        ? +Math.min(1, ride.attackT / ride.attackDur).toFixed(3) : 0,
      attackDuration: +(ride.attackDur || 0).toFixed(3),
      attackCooldown: +(ride.attackCd || 0).toFixed(3),
      jawOpen: a && a.swim ? +Math.max(0, a.swim.jawK || 0).toFixed(3) : 0,
      attackTarget: ride.targetKind,
      attackTargetDistance: a && ride.target && ride.target.group
        ? +biteDistance(ride.target, jawWorld(a)).toFixed(2) : null,
      // the breach, as numbers: how much air the last one got and for how long
      breachApex: AQUATIC_AUDIT.lastApex || 0, breachAirT: AQUATIC_AUDIT.lastAirT || 0,
      breachVel: a && rideDef(a.species) ? +(rideDef(a.species).breachVel || 0).toFixed(2) : 0,
      canBreach: !!(a && rideDef(a.species) && rideDef(a.species).breach),
      /* THE ARC. Everything a picture of a jump can be argued about, as
         numbers: how far the nose came up and how far it went down, how far
         the body came over onto its flank, how far its attitude ever sat from
         its own velocity vector (which must stay at zero — a pose that is
         animated instead of derived is the thing this pass replaced), and what
         the sea was told the landing weighed. */
      breachPitchUp: AQUATIC_AUDIT.lastPitchUp || 0,
      breachPitchDown: AQUATIC_AUDIT.lastPitchDown || 0,
      breachRoll: AQUATIC_AUDIT.lastRoll || 0,
      breachAlignErr: AQUATIC_AUDIT.lastAlignErr || 0,
      breachEntryKg: AQUATIC_AUDIT.lastEntryKg || 0,
      breachEntrySpd: AQUATIC_AUDIT.lastEntrySpd || 0,
      breachEntryKind: AQUATIC_AUDIT.lastEntryKind || "",
      breachTrailDrops: AQUATIC_AUDIT.trailDrops || 0,
      breachCrossDrops: AQUATIC_AUDIT.crossDrops || 0,
      bodyKg: a ? Math.round(bodyKg(a)) : 0,
      bodyLenM: a ? +bodyLenLive(a).toFixed(2) : 0,
      mounts: AQUATIC_AUDIT.mounts, breaches: AQUATIC_AUDIT.breaches,
      reentries: AQUATIC_AUDIT.reentries, attacks: AQUATIC_AUDIT.attacks,
      hits: AQUATIC_AUDIT.hits, shipBites: AQUATIC_AUDIT.shipBites,
      clamps: AQUATIC_AUDIT.clamps, clampT: ride.clampT > 0 ? +ride.clampT.toFixed(2) : 0,
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
