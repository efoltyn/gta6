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
      note("❤ The " + sp.name + " is yours! Meet " + a.petName +
        (RIDEABLE[sp.id] ? (a.grow != null ? " — rideable once it grows up." : " — you can RIDE it.") : "."),
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
  CBZ.cityTameFollow = function (a, dt) {
    // companions.js takes over movement while the pet is actively fighting a
    // threat or fleeing one (trait-driven defense) — yield to it this frame.
    if (a.companionBusy) return;
    const P = CBZ.player && CBZ.player.pos, grp = a.group, sp = a.species;
    if (!P) return;
    const dx = P.x - grp.position.x, dz = P.z - grp.position.z;
    const d = Math.hypot(dx, dz);
    if (a.stay || d <= HEEL_R) {                    // parked / at heel: face you
      faceAnimal(a, Math.atan2(dz, dx));
      return;
    }
    const spd = (sp.spd || 1.6) * FOLLOW_MULT * (a.grow != null ? 0.8 : 1);
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
    return !!(a && a.tamed && !a.dead && RIDEABLE[a.species.id] && a.grow == null);
  }
  function mount(a) {
    if (!canRide(a) || ride.mount) return;
    const P = CBZ.player;
    ride.mount = a; a.ridden = true; a.stay = false;
    ride.lx = P.pos.x; ride.lz = P.pos.z; ride.phase = 0;
    ride.head = Math.atan2(P.pos.z - a.pos.z, P.pos.x - a.pos.x);
    // step onto the animal (you walk to IT, it doesn't snap to you)
    P.pos.x = a.pos.x; P.pos.z = a.pos.z;
    P._rideScale = RIDEABLE[a.species.id].mult;
    note("Riding " + (a.petName || a.species.name) + " — E to dismount.", 2.4);
  }
  function dismount() {
    const a = ride.mount; if (!a) return;
    const P = CBZ.player;
    ride.mount = null; a.ridden = false;
    P._rideScale = 1;
    // slide off beside the mount, feet on the ground, no fall.
    P.pos.x += 1.4; P.pos.y = groundY(P.pos.x, P.pos.z); P.vy = 0; P.grounded = true;
    a.group.position.set(a.pos.x, groundY(a.pos.x, a.pos.z), a.pos.z);
  }
  CBZ.cityDismount = dismount;   // other systems (death, cars) can force it

  // runs AFTER physics (order 10) each frame: seat the rider, glue the mount.
  CBZ.onUpdate(47.2, function (dt) {
    if (!dt || dt > 0.5) dt = 0.05;
    const a = ride.mount; if (!a) return;
    const P = CBZ.player;
    // forced dismount: death, cars, the mount dying under you
    if (!P || P.dead || P.driving || a.dead) { dismount(); return; }
    const R = RIDEABLE[a.species.id];
    P._rideScale = R.mult;                              // republish (wounds etc. can't stick)
    const gx = P.pos.x, gz = P.pos.z;
    const mdx = gx - ride.lx, mdz = gz - ride.lz;
    const moving = (mdx * mdx + mdz * mdz) > 1e-6;
    if (moving) ride.head = Math.atan2(mdz, mdx);
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
      if (a.dead || a.ridden || a.external || a.species.aquatic) continue;   // carcasses/mount/sea/dogs have their own flows
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
      if (a.ridden) return { label: "🐎 Riding " + (a.petName || sp.name), note: "hold on" };
      if (a.tamed) return { label: "❤ " + a.petName + " the " + baby + sp.name, note: RIDEABLE[sp.id] ? (a.grow != null ? "too young to ride" : "your loyal mount") : "your companion" };
      return {
        label: (a.legendary ? "★ " : "") + "A " + baby + sp.name,
        note: feedItemFor(sp) ? ("hold food out to tame (" + (a.feeds || 0) + "/" + feedsNeeded(sp) + ")") : (isPredator(sp) ? "tameable — bring MEAT" : "tameable — bring food"),
      };
    });
    // DISMOUNT (only while riding)
    I.register("animal", {
      id: "animal-dismount", slot: "e", prio: 40,
      canShow: function (a) { return !!a.ridden; },
      label: function (a) { return "Dismount " + (a.petName || a.species.name); },
      onSelect: function () { dismount(); },
    });
    // FEED & TAME (wild) / FEED (tamed heal) — hold E
    I.register("animal", {
      id: "animal-tame", slot: "e", hold: true, prio: 20,
      canShow: function (a) { return !a.ridden && !a.tamed && !!feedItemFor(a.species); },
      label: function (a) { return "Feed & tame the " + a.species.name; },
      onSelect: function (a) { tameFeed(a); },
    });
    I.register("animal", {
      id: "animal-pet", slot: "e", prio: 18,
      canShow: function (a) { return a.tamed && !a.ridden; },
      label: function (a) { return "Pet " + a.petName; },
      onSelect: function (a) { note("❤ " + a.petName + " leans into you.", 1.6); },
    });
    // MOUNT
    I.register("animal", {
      id: "animal-mount", slot: "i", prio: 22,
      canShow: function (a) { return canRide(a) && !ride.mount; },
      label: function (a) { return "Ride " + a.petName; },
      onSelect: function (a) { mount(a); },
    });
    // STAY / FOLLOW
    I.register("animal", {
      id: "animal-stay", slot: "j", prio: 16,
      canShow: function (a) { return a.tamed && !a.ridden; },
      label: function (a) { return a.stay ? (a.petName + ", follow me") : (a.petName + ", stay here"); },
      onSelect: function (a) { a.stay = !a.stay; note(a.petName + (a.stay ? " stays put." : " falls in behind you."), 1.6); },
    });
    // FEED a tamed animal (heals it)
    I.register("animal", {
      id: "animal-feed", slot: "k", prio: 14,
      canShow: function (a) { return a.tamed && !a.ridden && !!feedItemFor(a.species) && a.hp < a.maxHp; },
      label: function (a) { return "Feed " + a.petName; },
      onSelect: function (a) {
        const item = feedItemFor(a.species); if (!item) return;
        if (CBZ.cityEcon && CBZ.cityEcon.take) CBZ.cityEcon.take(item, 1);
        a.hp = Math.min(a.maxHp, a.hp + Math.round(a.maxHp * 0.25));
        note("❤ " + a.petName + " eats the " + item + " (+health).", 1.8);
      },
    });
  }

  // register once the world (and the interaction registry) exists.
  CBZ.addLandmass(function () { registerInteractions(); return null; }, 97);
})();
