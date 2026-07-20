/* ============================================================
   city/wildlife_tame.js — TAME ANY ANIMAL · RIDE THE BIG ONES.

   Every living animal in the bestiary can be WON OVER by feeding it, exactly
   like the dogs: hold food out (predators demand MEAT you hunted; herbivores
   take any food item) enough times and the animal is YOURS — it gets a name,
   stops fearing you, follows at heel (never teleports — it runs), and can be
   told to stay. Babies are tameable too (the cutest pets in the game).

   And any animal LARGE ENOUGH TO CARRY A PERSON is RIDEABLE like a horse:
   horses and zebras obviously, but also elephants, rhinos, giraffes, bison,
   moose, elk, caribou, cows, all three bears, lions, tigers, cheetahs — even
   the legendary White Stag, White Lion and Snow Leopard if you manage to tame
   one instead of shooting it. Mount a tamed adult ([I] in the panel) and YOUR
   movement becomes the mount's: the animal is glued under you with a gallop
   bob, and your ground speed is multiplied by the species' gait (a cheetah is
   the fastest thing on land; an elephant is a slow unstoppable platform).

   HOW RIDING PLUGS IN (no parallel movement system): physics.js computes the
   player step from walkSpeed × player._rideScale (a new one-line hook, same
   pattern as the wound limp's _moveScale). While mounted we publish the
   species' speed multiplier there and, AFTER physics has moved you (our
   updater runs later in the frame), we place the animal under your feet and
   seat you at saddle height. Dismount restores everything. Collision, swim,
   regions, camera — all untouched; the mount IS the player, just faster/taller.
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
  //  RIDEABLE — every species big enough to carry a person, with its saddle
  //  height (where the rider sits) and gait (ground-speed multiplier).
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
  // Saddle heights read off each build's actual back line (× species scale).
  const RIDEABLE_EXTRA = {
    whitetail_deer: { y: 1.4,  mult: 2.15 },
    pig:            { y: 0.9,  mult: 1.35 },
    sheep:          { y: 1.2,  mult: 1.35 },
    goat:           { y: 0.95, mult: 1.55 },
  };
  // THE one rideable lookup — every gate below goes through this, so the
  // extra roster is a single-flag revert.
  function rideDef(sp) {
    if (!sp || !sp.id) return null;
    return RIDEABLE[sp.id] || (ALLCTL() ? RIDEABLE_EXTRA[sp.id] : null) || null;
  }

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
    if (!item) { note(isPredator(sp) ? "It only wants MEAT — hunt some first." : "You need food to offer.", 2); return; }
    const econ = CBZ.cityEcon;
    if (econ && econ.take) econ.take(item, 1);
    a.feeds = (a.feeds || 0) + 1;
    a.state = "wander"; a.alarm = 0;                                // food calms it
    const need = feedsNeeded(sp);
    if (a.feeds >= need) {
      a.tamed = true; a.petName = NAMES[(Math.random() * NAMES.length) | 0];
      a.stay = false;
      note("The " + sp.name + " is yours! Meet " + a.petName +
        (rideDef(sp) ? (a.grow != null ? " — rideable once it grows up." : " — you can RIDE it.") : "."),
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
  // clamped-turn step toward a point: the body swings toward the target at a
  // bounded rate and always MOVES ALONG ITS FACING — arcs, never pivot-snaps
  // or sideways glides (the same facing model the wild state machine uses).
  function steppedMove(a, tx, tz, spd, dt, panic) {
    const grp = a.group, sp = a.species;
    const dx = tx - grp.position.x, dz = tz - grp.position.z;
    const want = Math.atan2(dz, dx);
    if (a.faceH == null) a.faceH = want;
    let fd = want - a.faceH;
    while (fd > Math.PI) fd -= 2 * Math.PI; while (fd < -Math.PI) fd += 2 * Math.PI;
    const mx = ((panic ? 7 : 4.2) / (1 + (sp.scale || 1) * 0.25)) * dt;
    if (fd > mx) fd = mx; else if (fd < -mx) fd = -mx;
    a.faceH += fd; a.heading = a.faceH;
    grp.position.x += Math.cos(a.faceH) * spd * dt;
    grp.position.z += Math.sin(a.faceH) * spd * dt;
    grp.position.y = groundY(grp.position.x, grp.position.z);
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(a, a.faceH);
    else grp.rotation.y = -a.faceH;
  }

  CBZ.cityTameFollow = function (a, dt) {
    // companions.js takes over movement while the pet is actively fighting a
    // threat or fleeing one (trait-driven defense) — yield to it this frame.
    if (a.companionBusy) return;
    const P = CBZ.player && CBZ.player.pos, grp = a.group, sp = a.species;
    if (!P) return;
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
  const ride = { mount: null, head: 0, phase: 0, lx: 0, lz: 0 };

  function canRide(a) {
    return !!(a && a.tamed && !a.dead && rideDef(a.species) && a.grow == null);
  }
  function mount(a) {
    if (!canRide(a) || ride.mount) return;
    const P = CBZ.player;
    ride.mount = a; a.ridden = true; a.stay = false; a.goTo = null;
    ride.lx = P.pos.x; ride.lz = P.pos.z; ride.phase = 0;
    ride.head = Math.atan2(P.pos.z - a.pos.z, P.pos.x - a.pos.x);
    // step onto the animal (you walk to IT, it doesn't snap to you)
    P.pos.x = a.pos.x; P.pos.z = a.pos.z;
    P._rideScale = rideDef(a.species).mult;
    note("Riding " + (a.petName || a.species.name) + " — E to dismount.", 2.4);
  }
  // One public route for direct-touch/controller helpers. Tamed animals mount
  // immediately; a wild animal can be attempted, but strength/danger matters.
  // Failure does not show a fake lock: the animal reacts in-world and may turn
  // on the player. Success is deliberately uncommon for dangerous wildlife and
  // establishes the same persistent tame relationship as feeding.
  function attemptMount(a) {
    if (!a || a.dead || a.external || a.species.aquatic || !rideDef(a.species) || a.grow != null) return false;
    if (ride.mount) { if (ride.mount === a) dismount(); return true; }
    if (a.tamed) { mount(a); return ride.mount === a; }

    const level = Math.max(1, (g.level || g.cityLevel || 1) | 0);
    const danger = Math.max(0, Math.min(1, a.species.danger || 0));
    const size = Math.max(0.7, a.species.scale || 1);
    const chance = Math.max(0.035, Math.min(0.42, 0.13 + level * 0.004 - danger * 0.16 - Math.max(0, size - 1.3) * 0.055));
    if (Math.random() <= chance) {
      a.tamed = true;
      a.petName = a.petName || NAMES[(Math.random() * NAMES.length) | 0];
      a.stay = false;
      note("You hold on. " + a.petName + " accepts you — for now.", 2.5, { urgent: true });
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
    ride.mount = null; a.ridden = false;
    P._rideScale = 1;
    // slide off beside the mount — a SIDE-step perpendicular to its facing,
    // scaled by the species' bulk so you land next to an elephant's flank
    // instead of inside it. Feet on the ground, no fall.
    if (ALLCTL()) {
      const side = ride.head + Math.PI / 2;
      const off = 1.1 + (a.species.scale || 1) * 0.55;
      P.pos.x += Math.cos(side) * off; P.pos.z += Math.sin(side) * off;
    } else P.pos.x += 1.4;                            // legacy fixed step (flag off)
    P.pos.y = groundY(P.pos.x, P.pos.z); P.vy = 0; P.grounded = true;
    a.group.position.set(a.pos.x, groundY(a.pos.x, a.pos.z), a.pos.z);
  }
  CBZ.cityDismount = dismount;   // other systems (death, cars) can force it
  CBZ.cityCanRideAnimal = function (a) { return !!(a && !a.dead && !a.external && !a.species.aquatic && rideDef(a.species) && a.grow == null); };
  CBZ.cityMountAnimal = attemptMount;

  // runs AFTER physics (order 10) each frame: seat the rider, glue the mount.
  CBZ.onUpdate(47.2, function (dt) {
    if (!dt || dt > 0.5) dt = 0.05;
    const a = ride.mount; if (!a) return;
    const P = CBZ.player;
    // forced dismount: death, cars, the mount dying under you
    if (!P || P.dead || P.driving || a.dead) { dismount(); return; }
    const R = rideDef(a.species);
    if (!R) { dismount(); return; }                     // roster flag flipped mid-ride
    P._rideScale = R.mult;                              // republish (wounds etc. can't stick)
    const gx = P.pos.x, gz = P.pos.z;
    const mdx = gx - ride.lx, mdz = gz - ride.lz;
    const moving = (mdx * mdx + mdz * mdz) > 1e-6;
    if (moving) {
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
    // gallop bob only while moving
    ride.phase += dt * (moving ? 9 : 0.6);
    const bob = moving ? Math.abs(Math.sin(ride.phase)) * 0.09 * (a.species.scale || 1) : 0;
    const gy = groundY(gx, gz);
    a.group.position.set(gx, gy + bob, gz);
    faceAnimal(a, ride.head);
    // seat the rider on the back (after physics grounded them at floor level)
    P.pos.y = gy + R.y * 0.82 + bob;
    P.vy = 0; P.grounded = true;
  });

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
      return {
        label: (a.legendary ? "★ " : "") + "A " + baby + sp.name,
        note: feedItemFor(sp) ? ("hold food out to tame (" + (a.feeds || 0) + "/" + feedsNeeded(sp) + ")") : (isPredator(sp) ? "tameable — bring MEAT" : "tameable — bring food"),
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
      onSelect: function (a) { note("" + a.petName + " leans into you.", 1.6); },
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
      label: function (a) { return a.stay ? "Follow" : "Stay"; },
      onSelect: function (a) { a.stay = !a.stay; note(a.petName + (a.stay ? " stays put." : " falls in behind you."), 1.6); },
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
