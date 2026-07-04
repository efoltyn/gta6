/* ============================================================
   city/dogs.js — DOGS: the loyal companion (Minecraft's wolf-taming, in the city).

   Minecraft is the north star: wolves/strays roam the world; you TAME one by
   FEEDING it (bones in MC — here: a Bone, a Dog Treat, or any wild MEAT you
   hunted). Tame ones sprout a coloured COLLAR, take a name, and become YOUR
   dog: they HEEL at your side, TELEPORT to you if you get too far, SIT & STAY
   when told, defend you (biting anyone who turns hostile, and any predator that
   charges you), and can be HEALED by feeding them meat. Pet them for a ❤.

   THE LOOP ties into the hunt: hunting yields MEAT → meat tames & heals dogs →
   your dog helps you hunt & guards your back. No new keys — every verb is an
   OPTION RECORD in the interaction registry (interactions.js), same as peds.

   Cheap + deterministic seeding (owner rules #4/#5): strays are a handful of
   hand-built low-poly groups, one light update loop for follow/sit/fight, no
   physics or colliders. Gated behind CBZ.DOGS !== false (default ON).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const mat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };

  function makeRng(seed) {
    let s = seed >>> 0;
    return function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const rng = makeRng(0xD09D09);

  // ---- tuning -----------------------------------------------------------
  const HEEL_R = 3.2;         // sit-at-heel distance from the owner
  const TELEPORT_R = 46;      // too far → blink to the owner (MC behaviour)
  const FIGHT_R = 16;         // dog notices a threat within this
  const BITE_R = 2.2;         // close enough to bite
  const SPEED = 6.2;          // dog run speed (u/s)
  const TAME_FEEDS = 2;       // meat/bones needed to win a stray over

  const dogs = CBZ.cityDogs = [];
  let root = null, built = false, arena = null;
  // during buildCity() the global CBZ.city.arena isn't assigned yet — use the
  // arena handed to our builder for any region lookup (see wildlife.js).
  function ARENA() { return arena || (CBZ.city && CBZ.city.arena); }

  // ---- breeds (colour + ear style), chosen per stray ---------------------
  const BREEDS = [
    { name: "Shepherd", coat: 0x6b4a2c, belly: 0xcaa268, ear: "up" },
    { name: "Husky", coat: 0x9aa1a8, belly: 0xf0f0ee, ear: "up" },
    { name: "Labrador", coat: 0x2a2018, belly: 0x3a2c20, ear: "flop" },
    { name: "Golden", coat: 0xd6a35a, belly: 0xe7cd93, ear: "flop" },
    { name: "Rottie", coat: 0x241c16, belly: 0x8a5a2c, ear: "flop" },
    { name: "Terrier", coat: 0xcabfa6, belly: 0xe4dcc8, ear: "up" },
  ];
  const COLLARS = [0xe23b3b, 0x3b7de2, 0x37b24d, 0xe2a13b, 0x9b59b6, 0xff69b4, 0x1abc9c];
  const NAMES = ["Rex", "Bella", "Max", "Luna", "Duke", "Rocky", "Cooper", "Zeus", "Buddy", "Ghost", "Bandit", "Nala", "Scout", "Loki", "Sadie"];

  // ============================================================
  //  DOG MESH — a compact blocky good boy. Feet at y=0, nose +X.
  // ============================================================
  function buildDog(breed) {
    const gp = new THREE.Group();
    const coat = mat(breed.coat), belly = mat(breed.belly), dark = mat(0x1a1712);
    function box(w, h, d, m) { return new THREE.Mesh(CBZ.boxGeom(w, h, d), m); }
    const body = box(0.9, 0.42, 0.4, coat); body.position.set(0, 0.55, 0); gp.add(body);
    const chest = box(0.5, 0.36, 0.42, coat); chest.position.set(0.34, 0.56, 0); gp.add(chest);
    const under = box(0.85, 0.16, 0.36, belly); under.position.set(0, 0.4, 0); gp.add(under);
    const neck = box(0.3, 0.34, 0.3, coat); neck.position.set(0.52, 0.66, 0); gp.add(neck);
    const head = box(0.36, 0.34, 0.34, coat); head.position.set(0.72, 0.78, 0); gp.add(head);
    const snout = box(0.26, 0.18, 0.2, coat); snout.position.set(0.94, 0.72, 0); gp.add(snout);
    const nose = box(0.08, 0.08, 0.12, dark); nose.position.set(1.07, 0.74, 0); gp.add(nose);
    // ears
    [-1, 1].forEach(function (s) {
      let ear;
      if (breed.ear === "up") { ear = box(0.1, 0.2, 0.06, coat); ear.position.set(0.64, 1.02, s * 0.14); }
      else { ear = box(0.1, 0.24, 0.06, coat); ear.position.set(0.66, 0.82, s * 0.19); ear.rotation.z = -0.3; }
      gp.add(ear);
    });
    // legs
    [[0.34, 0.15], [0.34, -0.15], [-0.32, 0.15], [-0.32, -0.15]].forEach(function (o) {
      const l = box(0.13, 0.55, 0.13, coat); l.position.set(o[0], 0.28, o[1]); gp.add(l);
    });
    // tail (wags in update)
    const tail = box(0.34, 0.12, 0.12, coat); tail.position.set(-0.55, 0.66, 0); tail.rotation.z = 0.6;
    tail.name = "tail"; gp.add(tail);
    gp.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    return gp;
  }

  function addCollar(dog) {
    if (dog.collarMesh) return;
    const c = new THREE.Mesh(CBZ.boxGeom(0.34, 0.1, 0.34), mat(dog.collar));
    c.position.set(0.52, 0.7, 0); c.frustumCulled = false;
    dog.group.add(c); dog.collarMesh = c;
  }

  // ============================================================
  //  SPAWN — a few strays around the city + wild dogs near the woods.
  // ============================================================
  function makeDog(x, z, tamed) {
    const breed = BREEDS[(rng() * BREEDS.length) | 0];
    const grp = buildDog(breed);
    grp.position.set(x, groundY(x, z), z);
    grp.rotation.y = rng() * 6.283;
    root.add(grp);
    const d = {
      breed: breed, group: grp, pos: grp.position, kind: "dog",
      name: tamed ? NAMES[(rng() * NAMES.length) | 0] : "Stray " + breed.name,
      tamed: !!tamed, sit: false, hp: 40, maxHp: 40,
      collar: COLLARS[(rng() * COLLARS.length) | 0],
      heading: rng() * 6.283, turnT: rng() * 3, feeds: 0, wag: rng() * 6.283,
      target: null, biteT: 0, dead: false, blinkT: 0,
    };
    if (tamed) { addCollar(d); }
    dogs.push(d);
    return d;
  }

  function groundY(x, z) { return (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) || 0; }

  function spawnStrays() {
    // sprinkle strays on the mainland streets (deterministic spots).
    const spots = [
      [20, -640], [-60, -700], [90, -560], [-120, -600], [40, -760],
      [140, -680], [-40, -520], [-160, -740],
    ];
    for (let i = 0; i < spots.length; i++) makeDog(spots[i][0], spots[i][1], false);
    // a couple of wild dogs at the forest edge (if that biome exists).
    const A = ARENA(), regs = (A && A.regions) || [];
    for (let i = 0; i < regs.length; i++) {
      if (regs[i].biome === "forest") {
        makeDog(regs[i].minX + 30, regs[i].maxZ - 30, false);
        makeDog(regs[i].maxX - 40, regs[i].minZ + 40, false);
        break;
      }
    }
  }

  // ============================================================
  //  FEEDING / TAMING — meat, a Bone, or a Dog Treat wins a stray over.
  // ============================================================
  function feedItems() { return ["Bone", "Dog Treat", "Venison", "Beef", "Pork", "Mutton", "Chicken", "Bear Meat", "Game Meat", "Rabbit Meat", "Elk Meat", "Moose Meat"]; }
  function haveFeed() {
    const inv = g.cityInv || {}, list = feedItems();
    for (let i = 0; i < list.length; i++) if ((inv[list[i]] | 0) > 0) return list[i];
    return null;
  }
  function consumeFeed() {
    const f = haveFeed(); if (!f) return false;
    const econ = CBZ.cityEcon;
    if (econ && econ.take) econ.take(f, 1);
    else { g.cityInv[f]--; if (g.cityInv[f] <= 0) delete g.cityInv[f]; }
    return true;
  }

  function tameStray(d) {
    if (d.tamed || !consumeFeed()) return;
    d.feeds++;
    if (d.feeds >= TAME_FEEDS || rng() < 0.34) {
      d.tamed = true; d.name = NAMES[(rng() * NAMES.length) | 0];
      d.hp = d.maxHp; addCollar(d);
      if (CBZ.city && CBZ.city.note) CBZ.city.note("❤ " + d.name + " is now your dog! Heel · Sit · Feed via [E]", 3.4);
      if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(2);
    } else if (CBZ.city && CBZ.city.note) {
      CBZ.city.note("The " + d.breed.name + " takes the food… warming up to you.", 2.2);
    }
  }

  function feedOwn(d) {
    if (!consumeFeed()) { if (CBZ.city && CBZ.city.note) CBZ.city.note("No food to give — hunt some meat or buy a Bone.", 2); return; }
    d.hp = Math.min(d.maxHp, d.hp + 18);
    if (CBZ.city && CBZ.city.note) CBZ.city.note("❤ " + d.name + " wolfs it down (+health).", 1.8);
  }
  function pet(d) { if (CBZ.city && CBZ.city.note) CBZ.city.note("❤ " + d.name + " wags happily.", 1.4); d.wagBoost = 2.2; }
  function toggleSit(d) { d.sit = !d.sit; if (CBZ.city && CBZ.city.note) CBZ.city.note(d.name + (d.sit ? " sits and stays." : " is at your heel."), 1.6); }

  // register a Bone + Dog Treat into the economy so they're real, buyable items.
  function registerTreats() {
    const econ = CBZ.cityEcon; if (!econ || !econ.ITEMS) return;
    if (!econ.ITEMS["Bone"]) econ.ITEMS["Bone"] = { value: 4, tag: "tool", dogfeed: true };
    if (!econ.ITEMS["Dog Treat"]) econ.ITEMS["Dog Treat"] = { value: 6, tag: "food", heal: 4, dogfeed: true };
  }

  // ============================================================
  //  INTERACTIONS — walk up to a dog; the panel shows what [E]/[I]/[K] do.
  // ============================================================
  function nearestDog(px, pz, filter) {
    let best = null, bd = 4.2 * 4.2;
    for (let i = 0; i < dogs.length; i++) {
      const d = dogs[i]; if (d.dead || (filter && !filter(d))) continue;
      const dx = d.pos.x - px, dz = d.pos.z - pz, q = dx * dx + dz * dz;
      if (q < bd) { bd = q; best = d; }
    }
    return best ? { d: best, dist: Math.sqrt(bd) } : null;
  }

  function registerInteractions() {
    const I = CBZ.interactions; if (!I) return;
    I.registerSource({
      id: "src-dog", kind: "dog", layers: ["dog"], prio: 9, driving: false,
      find: function (px, pz, ctx, push) { const h = nearestDog(px, pz); if (h) push(h.d, h.dist); },
    });
    I.describe && I.describe("dog", function (d) {
      return { label: (d.tamed ? "🐕 " + d.name : "🐕 " + d.name), note: d.tamed ? (d.sit ? "sitting · yours" : "your loyal dog") : (haveFeed() ? "hold food out to tame" : "a wary stray — bring food") };
    });
    // TAME (stray, needs food)
    I.register("dog", {
      id: "dog-tame", slot: "e", hold: true, prio: 20,
      canShow: function (d) { return d && !d.tamed && !!haveFeed(); },
      label: function (d) { return "Feed & tame the " + d.breed.name; },
      onSelect: function (d) { tameStray(d); },
    });
    // PET (your dog)
    I.register("dog", {
      id: "dog-pet", slot: "e", prio: 18,
      canShow: function (d) { return d && d.tamed; },
      label: function (d) { return "Pet " + d.name; },
      onSelect: function (d) { pet(d); },
    });
    // SIT / HEEL toggle (your dog)
    I.register("dog", {
      id: "dog-sit", slot: "i", prio: 16,
      canShow: function (d) { return d && d.tamed; },
      label: function (d) { return d.sit ? "Tell " + d.name + " to heel" : "Tell " + d.name + " to sit & stay"; },
      onSelect: function (d) { toggleSit(d); },
    });
    // FEED (your dog, heals)
    I.register("dog", {
      id: "dog-feed", slot: "k", prio: 14,
      canShow: function (d) { return d && d.tamed && !!haveFeed(); },
      label: function (d) { return "Feed " + d.name; },
      onSelect: function (d) { feedOwn(d); },
    });
  }

  // ============================================================
  //  COMBAT — a tamed dog defends its owner: bites anyone hostile to you and
  //  any predator charging you. Damage routes through the same kill path guns
  //  use, so a dog can actually drop a mugger or a charging wolf.
  // ============================================================
  function hostileToPlayer(a) {
    if (!a || a.dead) return false;
    const PA = CBZ.city && CBZ.city.playerActor;
    return (a.rage && a.rage === PA) || a.state === "fight" || (a.kind === "cop" && (g.wanted | 0) > 0 && !a.dead);
  }
  function findThreat(d) {
    const px = d.pos.x, pz = d.pos.z; let best = null, bd = FIGHT_R * FIGHT_R;
    function scan(list, gate) {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const a = list[i]; if (!a || a.dead || !gate(a)) continue;
        const ax = a.pos ? a.pos.x : (a.group && a.group.position.x), az = a.pos ? a.pos.z : (a.group && a.group.position.z);
        if (ax == null) continue;
        const q = (ax - px) * (ax - px) + (az - pz) * (az - pz);
        if (q < bd) { bd = q; best = a; }
      }
    }
    scan(CBZ.cityPeds, hostileToPlayer);
    scan(CBZ.cityCops, hostileToPlayer);
    // a charging predator (danger animal in attack mode) is a threat too.
    scan(CBZ.cityWildlife, function (a) { return a.state === "charge" && a.species && a.species.danger >= 0.5; });
    return best;
  }
  function dogBite(d, a) {
    const dmg = 10 + (rng() * 6);
    if (a.animal) { if (CBZ.cityWildlifeHit) CBZ.cityWildlifeHit(a, { head: false, point: null }, { damage: dmg }); return; }
    if (a.kind === "cop") { if (CBZ.cityHurtCop) CBZ.cityHurtCop(a, dmg, { fromX: d.pos.x, fromZ: d.pos.z }); return; }
    a.hp = (a.hp == null ? (a.maxHp || 100) : a.hp) - dmg;
    if (CBZ.body && CBZ.body.hit) { try { CBZ.body.hit(a, { fromX: d.pos.x, fromZ: d.pos.z, force: 4 }); } catch (e) {} }
    if (a.hp <= 0 && CBZ.cityKillPed) { try { CBZ.cityKillPed(a, { fromX: d.pos.x, fromZ: d.pos.z, force: 5 }, "mauled"); } catch (e) {} }
    else { a.rage = a.rage || (CBZ.city && CBZ.city.playerActor); a.state = "fight"; }
  }

  // ============================================================
  //  UPDATE — follow / heel / sit / hunt-threats / wag / teleport.
  // ============================================================
  function tick(dt) {
    if (!dt || dt > 0.5) dt = 0.05;
    const P = CBZ.player && CBZ.player.pos;
    for (let i = 0; i < dogs.length; i++) {
      const d = dogs[i], grp = d.group;
      if (d.dead) continue;
      if (d.biteT > 0) d.biteT -= dt;
      // wag the tail (a little life)
      d.wag += dt * (6 + (d.wagBoost || 0) * 4); if (d.wagBoost) d.wagBoost = Math.max(0, d.wagBoost - dt);
      const tail = grp.getObjectByName && grp.getObjectByName("tail");
      if (tail) tail.rotation.y = Math.sin(d.wag) * 0.5;

      if (!d.tamed) {
        // strays mill about a little, deterministic-ish idle wander.
        d.turnT -= dt;
        if (d.turnT <= 0) { d.heading += (Math.random() - 0.5) * 1.4; d.turnT = 2 + Math.random() * 3; }
        const nx = grp.position.x + Math.cos(d.heading) * 0.8 * dt;
        const nz = grp.position.z + Math.sin(d.heading) * 0.8 * dt;
        grp.position.x = nx; grp.position.z = nz; grp.position.y = groundY(nx, nz);
        grp.rotation.y = -d.heading + Math.PI / 2;
        continue;
      }

      // ---- TAMED ----
      if (!P) continue;
      const toPx = P.x - grp.position.x, toPz = P.z - grp.position.z;
      const distP = Math.hypot(toPx, toPz);

      // teleport to owner if left far behind (MC).
      if (distP > TELEPORT_R) {
        const a = Math.random() * 6.283;
        grp.position.set(P.x + Math.cos(a) * 2.4, groundY(P.x, P.z), P.z + Math.sin(a) * 2.4);
        continue;
      }

      // threat response overrides sit/heel — defend the owner.
      let threat = d.sit ? null : findThreat(d);
      if (threat) {
        const tx = threat.pos ? threat.pos.x : threat.group.position.x;
        const tz = threat.pos ? threat.pos.z : threat.group.position.z;
        const tdx = tx - grp.position.x, tdz = tz - grp.position.z, td = Math.hypot(tdx, tdz);
        if (td <= BITE_R) { if (d.biteT <= 0) { dogBite(d, threat); d.biteT = 0.8; } }
        else {
          grp.position.x += (tdx / td) * SPEED * dt;
          grp.position.z += (tdz / td) * SPEED * dt;
          grp.position.y = groundY(grp.position.x, grp.position.z);
          grp.rotation.y = -Math.atan2(tdz, tdx) + Math.PI / 2;
        }
        continue;
      }

      if (d.sit) { grp.rotation.y = -Math.atan2(toPz, toPx) + Math.PI / 2; continue; }  // stays put, faces you

      // heel: trot to the owner, stop within HEEL_R.
      if (distP > HEEL_R) {
        const spd = distP > 10 ? SPEED : SPEED * 0.7;
        grp.position.x += (toPx / distP) * spd * dt;
        grp.position.z += (toPz / distP) * spd * dt;
        grp.position.y = groundY(grp.position.x, grp.position.z);
        grp.rotation.y = -Math.atan2(toPz, toPx) + Math.PI / 2;
      }
    }
  }

  // ============================================================
  //  BUILD
  // ============================================================
  CBZ.addLandmass(function (city) {
    if (CBZ.DOGS === false) return null;
    if (built) return null;
    city = city || (CBZ.city && CBZ.city.arena);
    if (!city || !city.root) return null;
    built = true;
    root = city.root;
    arena = city;
    registerTreats();
    registerInteractions();
    spawnStrays();
    CBZ.onUpdate(47.4, tick);
    return null;
  }, 96);

  CBZ.cityDogList = function () { return dogs; };
})();
