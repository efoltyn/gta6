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
  const PACK_R = 30;          // shoot one stray → every stray this close turns with it
  const AGGRO_GIVEUP = 80;    // an angry dog chases you this far before losing you
  const ENGAGE_R = 4.5;       // hand-off distance to creature_combat's maul choreography

  // wildlife-facade species: dogs ride the CBZ.cityWildlife registry so the
  // SAME guns that hunt deer hit dogs (fpsmode scans that list), while dogs.js
  // keeps driving them (a.external makes wildlife.js skip them; a.onShot
  // routes cityWildlifeHit back here). respawn:false keeps them out of the
  // wildlife breeding pass.
  const DOG_SPECIES = { id: "stray_dog", name: "Dog", danger: 0.6, scale: 0.75, spd: 6.2, bite: 8, respawn: false, rarity: "common" };
  function LIVEDOGS() { return !(CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_LIVE === false); }

  // the Minecraft angry-wolf eyes: unlit red so they READ at gameplay range.
  let redMat = null;
  function redEyeMat() {
    if (!redMat) redMat = new THREE.MeshBasicMaterial({ color: 0xff2015 });
    return redMat;
  }
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
  //  DOG MESH — a blocky Minecraft-wolf good boy, drawn to HUMAN SCALE.
  //  Everything is an axis-aligned box (the same intentional-cuboid look as
  //  the human rig + MC mobs) so it reads as a deliberate low-poly animal,
  //  not a mush of primitives. Feet plant at y=0, nose faces +X.
  //
  //  SCALE (a human is ~2.5u tall, hip 0.95, knee 0.47): this is a LARGE dog
  //  — its back sits at ~0.68 (your knee) and the ear tips reach ~1.0 (mid-
  //  thigh), so when it looks up its head comes to about your hip. A big
  //  shepherd/husky next to a person, never a pony and never a rat.
  // ============================================================
  const LEG_H = 0.34, LEG_W = 0.17;          // straight blocky legs
  const BODY_L = 0.86, BODY_H = 0.34, BODY_W = 0.44;
  const BODY_Y = LEG_H + BODY_H / 2;         // 0.51 — torso rides on the legs
  const HEAD = 0.36, HEAD_X = BODY_L / 2 + 0.16, HEAD_Y = BODY_Y + 0.16;

  function buildDog(breed) {
    const gp = new THREE.Group();
    const coat = mat(breed.coat), belly = mat(breed.belly), dark = mat(0x141110), inner = mat(0x8a5b52);
    function box(w, h, d, m) { return new THREE.Mesh(CBZ.boxGeom(w, h, d), m); }

    // ---- torso: a chunky cuboid, with a slightly taller rear haunch and a
    //      lighter underbelly + chest bib for the two-tone MC-wolf read.
    const body = box(BODY_L, BODY_H, BODY_W, coat); body.position.set(0, BODY_Y, 0); gp.add(body);
    const rump = box(0.30, BODY_H + 0.06, BODY_W + 0.02, coat); rump.position.set(-BODY_L / 2 + 0.13, BODY_Y + 0.03, 0); gp.add(rump);
    const under = box(BODY_L - 0.06, 0.12, BODY_W - 0.06, belly); under.position.set(0, LEG_H + 0.06, 0); gp.add(under);
    const bib = box(0.13, BODY_H - 0.04, BODY_W - 0.06, belly); bib.position.set(BODY_L / 2 - 0.05, BODY_Y, 0); gp.add(bib);

    // ---- head: a cube up front on a short neck, with a boxy snout + nose.
    const neck = box(0.24, 0.30, 0.32, coat); neck.position.set(BODY_L / 2 - 0.02, BODY_Y + 0.08, 0); gp.add(neck);
    const head = box(HEAD, HEAD, HEAD, coat); head.position.set(HEAD_X, HEAD_Y, 0); gp.add(head);
    const snout = box(0.22, 0.16, 0.22, coat); snout.position.set(HEAD_X + 0.24, HEAD_Y - 0.05, 0); gp.add(snout);
    const nose = box(0.09, 0.08, 0.12, dark); nose.position.set(HEAD_X + 0.37, HEAD_Y - 0.02, 0); gp.add(nose);
    // eyes — tiny dark blocks give it a face (MC-skin detailing). Kept on
    // userData so aggro can swap them RED + swell them (Minecraft angry wolf).
    const eyes = [];
    [-1, 1].forEach(function (s) {
      const e = box(0.06, 0.08, 0.05, dark); e.position.set(HEAD_X + 0.15, HEAD_Y + 0.06, s * 0.11);
      e.userData.calmMat = e.material;
      gp.add(e); eyes.push(e);
    });
    gp.userData.eyes = eyes;
    // ears — perked ("up") or folded ("flop"), each with a pink inner block.
    [-1, 1].forEach(function (s) {
      let ear, ex, ey, rot = 0;
      if (breed.ear === "up") { ear = box(0.10, 0.18, 0.08, coat); ex = HEAD_X - 0.03; ey = HEAD_Y + HEAD / 2 + 0.06; }
      else { ear = box(0.10, 0.20, 0.07, coat); ex = HEAD_X + 0.00; ey = HEAD_Y + HEAD / 2 - 0.02; rot = -0.55; }
      ear.position.set(ex, ey, s * 0.12); ear.rotation.z = rot; gp.add(ear);
      const ie = box(0.05, 0.10, 0.04, inner); ie.position.set(ex + 0.03, ey - 0.02, s * 0.12); ie.rotation.z = rot; gp.add(ie);
    });

    // ---- legs: four straight blocky legs (diagonal-gait animated in tick).
    const legs = [];
    const lx = BODY_L / 2 - 0.15, lz = BODY_W / 2 - 0.09;
    [[lx, lz], [lx, -lz], [-lx + 0.02, lz], [-lx + 0.02, -lz]].forEach(function (o) {
      const l = box(LEG_W, LEG_H, LEG_W, coat); l.position.set(o[0], LEG_H / 2, o[1]);
      l.userData.baseX = o[0]; l.userData.baseY = LEG_H / 2; gp.add(l); legs.push(l);
    });

    // ---- tail: a blocky plume angled up & back; wags in the update loop.
    const tail = box(0.30, 0.14, 0.14, coat); tail.position.set(-BODY_L / 2 - 0.08, BODY_Y + 0.13, 0);
    tail.rotation.z = 0.7; tail.name = "tail"; gp.add(tail);

    gp.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    gp.userData.legs = legs;
    // dogs spawn DURING buildCity(), before city/mode.js sweeps the root with
    // batchStaticUnder + freezeStaticUnder — without this tag the dog's body
    // meshes get merged into static deco and its matrices frozen (the same
    // "statue" bug as wildlife). userData.dynamic is the sweep's own skip tag.
    if (!(CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_LIVE === false)) gp.userData.dynamic = true;
    return gp;
  }

  function addCollar(dog) {
    if (dog.collarMesh) return;
    const c = new THREE.Mesh(CBZ.boxGeom(0.30, 0.10, 0.36), mat(dog.collar));
    c.position.set(BODY_L / 2 - 0.06, BODY_Y + 0.06, 0); c.frustumCulled = false;
    dog.group.add(c); dog.collarMesh = c;
  }

  // ============================================================
  //  SPAWN — a few strays around the city + wild dogs near the woods.
  // ============================================================
  function makeDog(x, z, tamed) {
    const breed = BREEDS[(rng() * BREEDS.length) | 0];
    const grp = buildDog(breed);
    grp.position.set(x, groundY(x, z), z);
    const initialHeading = rng() * 6.283;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(grp, initialHeading); else grp.rotation.y = -initialHeading;
    root.add(grp);
    const d = {
      breed: breed, group: grp, pos: grp.position, kind: "dog",
      name: tamed ? NAMES[(rng() * NAMES.length) | 0] : "Stray " + breed.name,
      tamed: !!tamed, sit: false, hp: 40, maxHp: 40,
      collar: COLLARS[(rng() * COLLARS.length) | 0],
      heading: initialHeading, faceH: initialHeading, turnT: rng() * 3, idleT: rng() * 1.5, feeds: 0, wag: rng() * 6.283,
      target: null, biteT: 0, dead: false, blinkT: 0,
      // ---- wildlife-registry facade: makes the dog SHOOTABLE ----
      animal: true, external: true, state: "wander", aggro: false,
      species: DOG_SPECIES, ko: 0, escaped: false,
    };
    d.onShot = function (hit, w) { return dogShot(d, hit, w); };
    if (LIVEDOGS() && CBZ.cityWildlife) CBZ.cityWildlife.push(d);
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
    // Authored places request the SAME live dog actor instead of constructing
    // decorative lookalikes. Requests are anchors only; behavior/gait/combat
    // remain here in the shared system.
    const requested = CBZ.cityDogSpawnRequests || [];
    for (let i = 0; i < requested.length; i++) {
      const req = requested[i]; if (!req || req._spawned) continue;
      const d = makeDog(req.x, req.z, !!req.tamed); if (!d) continue;
      d.name = req.name || d.name;
      d.home = { x: req.x, z: req.z };
      d.homeRadius = Math.max(4, req.homeRadius || 14);
      req._spawned = true;
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
    // SEND (go-to command, ANIMALS_ALL_CONTROLLABLE): point where you're
    // looking; the dog runs there and sits until called back.
    I.register("dog", {
      id: "dog-send", slot: "l", prio: 15,
      canShow: function (d) { return d && d.tamed && !(CBZ.CONFIG && CBZ.CONFIG.ANIMALS_ALL_CONTROLLABLE === false); },
      label: function (d) { return d.goTo ? (d.name + ", forget it — heel") : ("Send " + d.name + " ahead"); },
      onSelect: function (d) {
        if (d.goTo) { d.goTo = null; d.sit = false; if (CBZ.city && CBZ.city.note) CBZ.city.note(d.name + " falls back in.", 1.4); return; }
        const P = CBZ.player && CBZ.player.pos; if (!P) return;
        const yaw = CBZ.cam ? (CBZ.cam.yaw || 0) : 0;
        d.goTo = { x: P.x - Math.sin(yaw) * 16, z: P.z - Math.cos(yaw) * 16 };
        d.sit = false;
        if (CBZ.city && CBZ.city.note) CBZ.city.note(d.name + " races ahead!", 1.5);
      },
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
  //  SHOT / AGGRO / DEATH — the Minecraft-wolf moment. Shoot a stray and its
  //  eyes flash RED (swollen, unlit — readable across the street), it turns
  //  and attacks relentlessly, and every stray in its pack radius turns with
  //  it. Your own tamed dog stays loyal (shooting it is on you). Damage
  //  arrives through the wildlife registry delegate (cityWildlifeHit →
  //  d.onShot), so guns, dog bites and explosion blasts all land here.
  // ============================================================
  function setDogEyes(d, on) {
    const eyes = d.group.userData && d.group.userData.eyes; if (!eyes) return;
    for (let i = 0; i < eyes.length; i++) {
      eyes[i].material = on ? redEyeMat() : eyes[i].userData.calmMat;
      eyes[i].scale.setScalar(on ? 1.8 : 1);
    }
  }
  function dogAggro(d) {
    if (d.aggro || d.dead || d.tamed) return;
    d.aggro = true; d.state = "charge";               // "charge" also flags it as a threat to pet defenders
    setDogEyes(d, true);
  }
  function dogCalm(d) {
    if (!d.aggro) return;
    d.aggro = false; d.state = "wander";
    setDogEyes(d, false);
  }
  function dogShot(d, hit, w) {
    if (d.dead) return { head: false, down: false, dmg: 0 };
    const fall = (CBZ.weaponFalloffMul && hit && hit.dist != null && w && w.damage != null)
      ? (CBZ.weaponFalloffMul(w, hit.dist) || 1) : 1;
    const dmg = Math.max(1, Math.round((w && w.damage || 20) * (hit && hit.head ? (w && w.headMult || 2) : 1) * fall));
    d.hp -= dmg;
    if (hit && hit.point && CBZ.gore && CBZ.gore.spray) { try { CBZ.gore.spray(hit.point, 1); } catch (e) {} }
    if (d.hp <= 0) { dogDie(d); return { head: !!(hit && hit.head), down: true, dmg: dmg }; }
    if (!d.tamed) {
      const first = !d.aggro;
      dogAggro(d);
      // PACK RIPPLE — the whole street pack turns on you together.
      for (let i = 0; i < dogs.length; i++) {
        const o = dogs[i];
        if (o === d || o.dead || o.tamed || o.aggro) continue;
        const ox = o.pos.x - d.pos.x, oz = o.pos.z - d.pos.z;
        if (ox * ox + oz * oz < PACK_R * PACK_R) dogAggro(o);
      }
      if (first && CBZ.city && CBZ.city.note) {
        CBZ.city.note("The " + d.breed.name + "'s eyes flash RED — it's coming for you!", 2.4, { urgent: true });
      }
    }
    return { head: !!(hit && hit.head), down: false, dmg: dmg };
  }
  function dogDie(d) {
    d.dead = true; d.hp = 0; d.state = "dead"; d.aggro = false;
    setDogEyes(d, false);
    d._dieT = 0.5;
    d._toppleTo = (Math.random() < 0.5 ? 1 : -1) * 1.25;
    d._dieZ0 = d.group.rotation.z;
    d.fadeT = 26;
    if (CBZ.city && CBZ.city.note) {
      CBZ.city.note(d.tamed ? ("💔 " + d.name + " is gone.") : (d.name + " goes down."), d.tamed ? 3.4 : 2, d.tamed ? { urgent: true } : undefined);
    }
  }
  function removeDog(d) {
    const i = dogs.indexOf(d); if (i >= 0) dogs.splice(i, 1);
    const wl = CBZ.cityWildlife;
    if (wl) { const wi = wl.indexOf(d); if (wi >= 0) wl.splice(wi, 1); }
    if (d.group && d.group.parent) d.group.parent.remove(d.group);
  }

  // ---- movement with a CLAMPED TURN: d.heading is the desire, the body
  //      turns toward it at a bounded rate and always moves along its FACING
  //      — arcs, never pivot-slides or sideways glides (same model as the
  //      wildlife engine).
  function dogMove(d, spd, dt, panic) {
    const grp = d.group;
    if (d.faceH == null) d.faceH = d.heading;
    let fd = d.heading - d.faceH;
    while (fd > Math.PI) fd -= 2 * Math.PI; while (fd < -Math.PI) fd += 2 * Math.PI;
    const mx = (panic ? 8 : 4) * dt;
    if (fd > mx) fd = mx; else if (fd < -mx) fd = -mx;
    d.faceH += fd;
    if (spd > 0) {
      grp.position.x += Math.cos(d.faceH) * spd * dt;
      grp.position.z += Math.sin(d.faceH) * spd * dt;
    }
    grp.position.y = groundY(grp.position.x, grp.position.z);
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(d, d.faceH); else grp.rotation.y = -d.faceH;
  }

  // reusable creature_combat target for the aggro maul (never per-frame allocated)
  const DTGT = { pos: null, group: { position: null }, dead: false, hp: 1e9 };

  // ============================================================
  //  UPDATE — follow / heel / sit / hunt-threats / wag / teleport.
  // ============================================================
  function tick(dt) {
    if (!dt || dt > 0.5) dt = 0.05;
    const P = CBZ.player && CBZ.player.pos;
    for (let i = 0; i < dogs.length; i++) {
      const d = dogs[i], grp = d.group;
      if (d.dead) {
        // animated topple, then the body fades out of the world.
        if (d._dieT != null) {
          d._dieT -= dt;
          const k = Math.max(0, Math.min(1, 1 - d._dieT / 0.5));
          const e = 1 - (1 - k) * (1 - k);
          grp.rotation.z = (d._dieZ0 || 0) + (d._toppleTo - (d._dieZ0 || 0)) * e;
          if (d._dieT <= 0) d._dieT = null;
        }
        d.fadeT -= dt;
        if (d.fadeT <= 0) { removeDog(d); i--; }
        continue;
      }
      if (d.biteT > 0) d.biteT -= dt;
      // wag the tail (a little life)
      d.wag += dt * (6 + (d.wagBoost || 0) * 4); if (d.wagBoost) d.wagBoost = Math.max(0, d.wagBoost - dt);
      const tail = grp.getObjectByName && grp.getObjectByName("tail");
      if (tail) tail.rotation.y = Math.sin(d.wag) * 0.5;

      // TROT: swing the legs (diagonal gait) by how far the dog actually moved
      // last frame — so it animates in every branch (wander/heel/chase) without
      // each one having to know. Legs settle to base when standing still.
      const legs = grp.userData && grp.userData.legs;
      if (legs) {
        const px0 = d.prevX == null ? grp.position.x : d.prevX;
        const pz0 = d.prevZ == null ? grp.position.z : d.prevZ;
        const moved = Math.hypot(grp.position.x - px0, grp.position.z - pz0);
        d.prevX = grp.position.x; d.prevZ = grp.position.z;
        const walking = moved > 0.004;
        // stride rides DISTANCE moved (rate-capped) so a saunter reads slow
        // and a sprint reads fast — never one fixed cadence for both.
        if (walking) d.step = (d.step || 0) + Math.min(moved * 3.2, dt * 16);
        const sw = walking ? Math.sin(d.step || 0) : 0, amp = 0.10;
        for (let li = 0; li < legs.length; li++) {
          const L = legs[li], diag = (li === 0 || li === 3) ? 1 : -1;   // FL+RR vs FR+RL
          L.position.x = L.userData.baseX + sw * amp * diag;
          L.position.y = L.userData.baseY + (walking ? Math.abs(Math.sin((d.step || 0) + (diag > 0 ? 0 : Math.PI))) * amp * 0.35 : 0);
        }
      }

      // ---- AGGRO (shot stray): relentless Minecraft-wolf attack ----------
      if (d.aggro && !d.tamed) {
        const PP = CBZ.player && CBZ.player.pos;
        if (!PP || (CBZ.player && CBZ.player.dead)) { dogCalm(d); continue; }
        const adx = PP.x - grp.position.x, adz = PP.z - grp.position.z;
        const adp = Math.hypot(adx, adz);
        if (adp > AGGRO_GIVEUP) { dogCalm(d); continue; }        // finally lost you
        if (adp <= ENGAGE_R && CBZ.creatureFight) {
          // the last stretch + the bite: creature_combat's maul choreography
          // (lunge, shake, recover), damage through onHit → cityHurtPlayer.
          DTGT.pos = PP; DTGT.group.position = PP; DTGT.dead = false; DTGT.hp = 1e9;
          CBZ.creatureFight(d, DTGT, dt, d._atkOpts || (d._atkOpts = {
            reach: 1.7, rate: 0.95, dmg: DOG_SPECIES.bite, speed: SPEED, style: "maul",
            onHit: function (dm) { if (CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(dm, d.pos.x, d.pos.z, "mauled by a dog", false, d, false); } catch (e) {} } },
          }));
          d.faceH = d.heading;                                   // it steers facing itself
        } else {
          d.heading = Math.atan2(adz, adx);
          dogMove(d, SPEED, dt, true);                           // sprint in, clamped arc
        }
        continue;
      }

      if (!d.tamed) {
        // Strays mill about with true pauses. Authored working dogs also keep
        // to their home anchor instead of tracing a canned circle.
        if (d.home) {
          const hdx = d.home.x - grp.position.x, hdz = d.home.z - grp.position.z;
          if (hdx * hdx + hdz * hdz > d.homeRadius * d.homeRadius) {
            d.heading = Math.atan2(hdz, hdx); d.idleT = 0;
            dogMove(d, 1.0, dt, false);
            continue;
          }
        }
        d.turnT -= dt;
        if (d.idleT > 0) { d.idleT -= dt; dogMove(d, 0, dt, false); continue; }
        if (d.turnT <= 0) {
          d.heading += (Math.random() - 0.5) * 1.4; d.turnT = 2 + Math.random() * 3;
          if (Math.random() < 0.34) { d.idleT = 1 + Math.random() * 2.8; dogMove(d, 0, dt, false); continue; }
        }
        dogMove(d, 0.8, dt, false);
        continue;
      }

      // ---- TAMED ----
      if (!P) continue;
      const toPx = P.x - grp.position.x, toPz = P.z - grp.position.z;
      const distP = Math.hypot(toPx, toPz);

      // GO-TO (ANIMALS_ALL_CONTROLLABLE): sent to a spot — sprint there on
      // real legs, then sit and hold it until called back to heel.
      if (d.goTo) {
        const gdx = d.goTo.x - grp.position.x, gdz = d.goTo.z - grp.position.z;
        const gd = Math.hypot(gdx, gdz);
        if (gd <= 1.4) {
          d.goTo = null; d.sit = true;
          if (CBZ.city && CBZ.city.note) CBZ.city.note(d.name + " waits there.", 1.5);
        } else {
          d.heading = Math.atan2(gdz, gdx);
          dogMove(d, SPEED, dt, true);
          continue;
        }
      }

      // NO TELEPORTING. However far you get, the dog just runs flat-out toward
      // you at full dog speed and closes the gap on foot — the chase IS the
      // point. (When you're far, threat-hunting is suppressed below so it makes
      // a beeline for you instead of stopping to fight.)
      const FAR = distP > TELEPORT_R;

      // threat response overrides sit/heel — defend the owner (but only when the
      // dog is actually near you; if you've bolted across the map it prioritises
      // catching up over picking fights).
      let threat = (d.sit || FAR) ? null : findThreat(d);
      if (threat) {
        const tx = threat.pos ? threat.pos.x : threat.group.position.x;
        const tz = threat.pos ? threat.pos.z : threat.group.position.z;
        const tdx = tx - grp.position.x, tdz = tz - grp.position.z, td = Math.hypot(tdx, tdz);
        if (td <= BITE_R) {
          d.heading = Math.atan2(tdz, tdx); dogMove(d, 0, dt, true);   // square up
          if (d.biteT <= 0) { dogBite(d, threat); d.biteT = 0.8; }
        } else {
          d.heading = Math.atan2(tdz, tdx);
          dogMove(d, SPEED, dt, true);
        }
        continue;
      }

      if (d.sit) { d.heading = Math.atan2(toPz, toPx); dogMove(d, 0, dt, false); continue; }  // stays put, turns to face you

      // heel: trot to the owner, stop within HEEL_R.
      if (distP > HEEL_R) {
        const spd = distP > 10 ? SPEED : SPEED * 0.7;
        d.heading = Math.atan2(toPz, toPx);
        dogMove(d, spd, dt, distP > 10);
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
