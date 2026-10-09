/* ============================================================
   city/dogs.js — EVERY DOG IN THE CITY. One actor, four lives.

   OWNER (2026-10-09): "They look very blocky and fake right now. They don't
   need to be too real, but make them act more real. If they like you, they
   act like security does in the game, except they just defend you and help
   you when you start attacking someone."

   THE BODY is city/dogmodel.js (one skinned shell per breed, planted-foot
   gait, body language). THE DECISIONS for a loyal dog are city/dogbrain.js
   (the protector rulebook: order, defend, join in, guard, warn). This file
   is the actor: who a dog belongs to, how it moves, how it bites, what it
   costs to hurt one, and the verbs on it.

   ROLES (one actor shape, d.role):
     pet    YOUR dog. Heels (CBZ.petFollow, the shared companion brain), stays,
            guards a spot. It is a protector body in the crew order system:
            city/orders.js routes Attack / Guard / Hold / Follow / Stand down
            to it (CBZ.cityDogOrder), and its threat rules are the detail's:
            whoever fights you gets bitten, whoever you start on gets bitten
            too, cops while you are wanted get barked at.
     stray  Wary and skittish. Bolts from a man who runs at it or crowds it.
            Food, over time, earns trust (dogbrain.feed); a stray that trusts
            you can be adopted. Shoot one and the street pack turns on you
            (the shared predator hunt, systems/predator.js).
     guard  A yard dog (the farm, gang HQs). Patrols its yard, warns you off
            at the fence, and goes for you if you walk in or start trouble
            with its people.
     k9     A police dog, out with a handler while you are wanted at two
            stars or more. It tracks you and takes you down (the predator
            hunt's worry seize drags you off your feet). Lose the handler and
            it is just a dog again.

   BITING IS COMBAT. A bite is a real wound (CBZ.bodyBite), real damage, and
   the bitten man answers it through peds.js struck(): he fights the dog or
   runs. Dogs can be hurt and killed by anyone (peds.js hurtActor routes a
   blow on an animal into CBZ.cityWildlifeHit -> d.onShot). A badly hurt dog
   runs. Hurting a dog that was not attacking you is a crime with witnesses
   (cityCrime "animal-cruelty", cityAlarm, their grudge); a police dog is an
   officer (assault-officer) and its death makes the news.

   NO TEXT. The dog's state is its body: tail, ears, hackles, crouch, bark.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate || !CBZ.dogModel) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const DM = CBZ.dogModel;
  const TAU = Math.PI * 2;

  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.DOG_PREDATOR == null) CBZ.CONFIG.DOG_PREDATOR = true;
  function HUNT_ON() { return CBZ.CONFIG.DOG_PREDATOR !== false && typeof CBZ.predatorHunt === "function"; }
  function PETS_ON() { return CBZ.CONFIG.PET_AFFECTION !== false && typeof CBZ.petFollow === "function"; }
  function LIVEDOGS() { return !(CBZ.CONFIG && CBZ.CONFIG.WILDLIFE_LIVE === false); }

  if (typeof CBZ.petAdopt === "function" && PETS_ON()) CBZ.petAdopt("dogs:heel");
  if (typeof CBZ.predatorAdopt === "function") { try { CBZ.predatorAdopt("dogs:aggro-maul"); } catch (e) {} }
  else { try { (CBZ._predatorAdopted = CBZ._predatorAdopted || []).push("dogs:aggro-maul"); } catch (e) {} }

  function makeRng(seed) {
    let s = seed >>> 0;
    return function () { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const rng = makeRng(0xD09D09);

  // ---- tuning -----------------------------------------------------------
  const HEEL_R = 3.2;
  const RUN = 6.2, TROT = 3.2, WALK = 1.15;
  const PACK_R = 30;
  const AGGRO_GIVEUP = 80;
  const THINK = 0.22;            // s between protector decisions
  const ANIM_R = 75;             // m: past this the pose is left as it was
  const COLLIDE_R = 140;         // m: walls stop dogs inside this
  const NAMES = ["Rex", "Bella", "Max", "Luna", "Duke", "Rocky", "Cooper", "Zeus", "Buddy", "Ghost", "Bandit", "Nala", "Scout", "Loki", "Sadie"];
  const COLLARS = [0xb8322f, 0x2f62b8, 0x2e8a43, 0xc0862c, 0x6e3f8a, 0x1f1f1f];

  const dogs = CBZ.cityDogs = [];
  let root = null, built = false, arena = null, clock = 0;
  function ARENA() { return arena || (CBZ.city && CBZ.city.arena); }
  function PA() { return CBZ.city && CBZ.city.playerActor; }
  function nowMs() { return CBZ.now || (performance.now ? performance.now() : Date.now()); }
  function groundY(x, z) { return (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) || 0; }
  function hyp(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
  function posOf(a) { return a ? (a.pos || (a.group && a.group.position) || null) : null; }
  function wrapPi(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function sfxDog(kind, d) { if (CBZ.dogVoice) { try { CBZ.dogVoice(kind, d.pos.x, d.pos.z, d.dims.K); } catch (e) {} } }

  // the player, sampled once a frame (speed for the skittish read)
  const PL = { x: 0, z: 0, spd: 0, has: false };
  function samplePlayer(dt) {
    const P = CBZ.player && CBZ.player.pos;
    if (!P) { PL.has = false; return; }
    if (PL.has && dt > 0) PL.spd += (hyp(P.x, P.z, PL.x, PL.z) / dt - PL.spd) * Math.min(1, dt * 6);
    PL.x = P.x; PL.z = P.z; PL.has = true;
  }

  // ============================================================
  //  THE ACTOR
  // ============================================================
  // the wildlife-registry facade: dogs ride CBZ.cityWildlife so every gun,
  // blast and blow that hits an animal hits a dog (a.onShot routes it here).
  function speciesFor(D, role) {
    return { id: "stray_dog", name: "Dog", danger: 0.6, scale: 0.75 * D.K, spd: RUN, bite: role === "k9" ? Math.round(D.bite * 0.6) : D.bite,
      respawn: false, rarity: "common" };
  }
  function pickBreed(role) {
    if (role === "k9") return "shepherd";
    if (role === "guard") return rng() < 0.6 ? "pit" : "mastiff";
    if (role === "pet") return "lab";
    const r = rng();
    return r < 0.62 ? "mutt" : (r < 0.8 ? "lab" : (r < 0.92 ? "pit" : "shepherd"));
  }
  function makeDog(o) {
    if (!root) return null;
    const role = o.role || (o.tamed ? "pet" : "stray");
    const breed = o.breed || pickBreed(role);
    const rig = DM.build(breed, o.seed != null ? o.seed : (rng() * 1e9) | 0, o.coat);
    const D = rig.dims, grp = rig.group;
    grp.position.set(o.x, groundY(o.x, o.z), o.z);
    const h0 = o.heading != null ? o.heading : rng() * TAU;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(grp, h0); else grp.rotation.y = -h0;
    root.add(grp);
    const sp = speciesFor(D, role);
    const hp = Math.round(D.hp * (role === "k9" ? 1.2 : 1));
    const d = {
      kind: "dog", role: role, breed: breed, rig: rig, group: grp, pos: grp.position, dims: D,
      name: o.name || (o.tamed ? NAMES[(rng() * NAMES.length) | 0] : ""),
      tamed: !!o.tamed, owner: o.tamed ? "player" : (o.owner || null), handler: o.handler || null,
      home: o.home || null, homeRadius: o.homeRadius || 10, gang: o.gang || null,
      hp: hp, maxHp: hp, trust: o.tamed ? 1 : 0, loyalty: o.tamed ? 1 : 0,
      heading: h0, faceH: h0, speed: 0, sit: false, goTo: null, _order: null,
      mood: { alert: 0, aggr: 0, fear: 0, happy: 0, sniff: 0 }, look: null, bark: false, bite: false, shakeT: 0,
      biteCD: 0, barkCD: 0, thinkT: rng() * THINK, dec: null, fleeT: 0, fleeFrom: null,
      turnT: rng() * 3, idleT: rng() * 1.5, lieT: 0, intrudeT: 0,
      animal: true, external: true, state: "wander", aggro: false, species: sp, ko: 0, escaped: false, dead: false,
    };
    const M = DM.mouth(rig);
    d._jawL = M; d._jawGripL = { x: M.x - 0.03 * D.K, y: M.y - 0.02 * D.K, z: 0 };
    d.onShot = function (hit, w) { return dogShot(d, hit, w); };
    if (LIVEDOGS() && CBZ.cityWildlife) CBZ.cityWildlife.push(d);
    if (d.tamed) DM.collar(rig, COLLARS[(rng() * COLLARS.length) | 0]);
    else if (role === "k9" || role === "guard") DM.collar(rig, 0x1b1a19);
    dogs.push(d);
    return d;
  }
  CBZ.citySpawnDog = function (o) { return o && isFinite(o.x) && isFinite(o.z) ? makeDog(o) : null; };

  function removeDog(d) {
    const i = dogs.indexOf(d); if (i >= 0) dogs.splice(i, 1);
    const wl = CBZ.cityWildlife;
    if (wl) { const wi = wl.indexOf(d); if (wi >= 0) wl.splice(wi, 1); }
    if (d.group && d.group.parent) d.group.parent.remove(d.group);
    if (d.handler) d.handler._k9 = false;
    d.dead = true; d._gone = true;
  }

  // ============================================================
  //  SPAWNS
  // ============================================================
  function spawnStrays() {
    const spots = [[20, -640], [-60, -700], [90, -560], [-120, -600], [40, -760], [140, -680], [-40, -520], [-160, -740]];
    for (let i = 0; i < spots.length; i++) makeDog({ x: spots[i][0], z: spots[i][1], role: "stray" });
    const A = ARENA(), regs = (A && A.regions) || [];
    for (let i = 0; i < regs.length; i++) {
      if (regs[i].biome === "forest") {
        makeDog({ x: regs[i].minX + 30, z: regs[i].maxZ - 30, role: "stray", breed: "mutt" });
        makeDog({ x: regs[i].maxX - 40, z: regs[i].minZ + 40, role: "stray", breed: "mutt" });
        break;
      }
    }
    // Authored places request the SAME live actor (biome_farmland.js's farm dog)
    const req = CBZ.cityDogSpawnRequests || [];
    for (let i = 0; i < req.length; i++) {
      const q = req[i]; if (!q || q._spawned) continue;
      const d = makeDog({ x: q.x, z: q.z, role: q.role || (q.tamed ? "pet" : "guard"), breed: q.breed || (q.tamed ? null : "shepherd"),
        tamed: !!q.tamed, name: q.name, home: { x: q.x, z: q.z }, homeRadius: Math.max(4, q.homeRadius || 12) });
      if (d) { q._spawned = true; d.soft = q.soft !== false; }
    }
  }
  // GANG YARD DOGS: one at each crew's HQ door, once the gangs exist.
  let gangDogsDone = false;
  function spawnGangDogs() {
    gangDogsDone = true;
    const gangs = CBZ.cityGangs || [];
    let n = 0;
    for (let i = 0; i < gangs.length && n < 6; i++) {
      const G = gangs[i];
      if (!G || G.isPlayer || G.absorbed || !G.hq || !G.hq.lot) continue;
      const lot = G.hq.lot, door = lot.building && lot.building.door;
      if (!door) continue;
      const vx = door.x - lot.cx, vz = door.z - lot.cz, m = Math.hypot(vx, vz) || 1;
      const x = door.x + vx / m * 3.5, z = door.z + vz / m * 3.5;
      makeDog({ x: x, z: z, role: "guard", breed: i % 3 === 2 ? "mastiff" : "pit", gang: G.id, home: { x: x, z: z }, homeRadius: 7, heading: Math.atan2(vz, vx) });
      n++;
    }
  }
  // POLICE K9: out with a handler while you are wanted at two stars and up
  let k9T = 0;
  function k9Manager(dt) {
    k9T -= dt; if (k9T > 0) return;
    k9T = 1.5;
    const P = CBZ.player && CBZ.player.pos; if (!P) return;
    const wanted = g.wanted | 0;
    let live = 0;
    for (let i = 0; i < dogs.length; i++) {
      const d = dogs[i]; if (d.role !== "k9" || d.dead) continue;
      live++;
      if (wanted === 0) {
        d._calmT = (d._calmT || 0) + 1.5;
        if (d._calmT > 30 && hyp(d.pos.x, d.pos.z, P.x, P.z) > 60 && (!CBZ.npcTransitionSafe || CBZ.npcTransitionSafe(d.pos.x, d.pos.z, { minDistance: 30 }))) removeDog(d);
      } else d._calmT = 0;
    }
    const want = wanted >= 4 ? 2 : (wanted >= 2 ? 1 : 0);
    if (live >= want) return;
    const cops = CBZ.cityCops || [];
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (!c || c.dead || !c.pos || c.inCar || c.driving || c._airPilot || c._k9) continue;
      const dd = hyp(c.pos.x, c.pos.z, P.x, P.z);
      if (dd < 25 || dd > 120) continue;
      const x = c.pos.x + (rng() - 0.5) * 2.4, z = c.pos.z + (rng() - 0.5) * 2.4;
      if (CBZ.npcTransitionSafe && !CBZ.npcTransitionSafe(x, z, { minDistance: 20 })) continue;
      c._k9 = true;
      makeDog({ x: x, z: z, role: "k9", breed: "shepherd", handler: c, name: "", heading: Math.atan2(P.z - z, P.x - x) });
      return;
    }
  }

  // ============================================================
  //  FOOD, TRUST, ADOPTION
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
  function feed(d) {
    if (!haveFeed()) return;
    if (d.tamed) {
      if (!consumeFeed()) return;
      d.hp = Math.min(d.maxHp, d.hp + 18); d.loyalty = Math.min(1, d.loyalty + 0.1);
      d.eatT = 2.2; d.wagBoost = 2; return;
    }
    // a dog that has just eaten turns its nose up: trust is earned over time
    if (!CBZ.dogBrain.feed(d, nowMs())) { d.mood.sniff = 1; d.sniffT = 1.2; return; }
    consumeFeed();
    d.eatT = 2.4; d.fleeT = 0; d.wagBoost = 1.2 + d.trust * 2;
  }
  function adopt(d) {
    if (!CBZ.dogBrain.canAdopt(d)) return;
    d.tamed = true; d.role = "pet"; d.owner = "player"; d.loyalty = 0.8; d.trust = 1;
    d.name = d.name || NAMES[(rng() * NAMES.length) | 0];
    d.hp = d.maxHp; d.aggro = false; d.state = "wander"; d.home = null;
    DM.collar(d.rig, COLLARS[(rng() * COLLARS.length) | 0]);
    d.wagBoost = 3; d._petCheckIn = 1; d._beatT = 0;
    if (CBZ.city && CBZ.city.addRespect) CBZ.city.addRespect(1);
  }
  function pet(d) {
    d.wagBoost = 2.6; d.petT = 1.8; d.loyalty = Math.min(1, d.loyalty + 0.05);
    d._petCheckIn = 1; d._beatT = 0;
  }
  function registerTreats() {
    const econ = CBZ.cityEcon; if (!econ || !econ.ITEMS) return;
    if (!econ.ITEMS["Bone"]) econ.ITEMS["Bone"] = { value: 4, tag: "tool", dogfeed: true };
    if (!econ.ITEMS["Dog Treat"]) econ.ITEMS["Dog Treat"] = { value: 6, tag: "food", heal: 4, dogfeed: true };
  }

  // ============================================================
  //  ORDERS — the crew's order system, with a dog for a body.
  //  city/orders.js routes give()/clear() on a dog here.
  // ============================================================
  function order(d, kind, t) {
    if (!d || d.dead || !d.tamed) return false;
    const P = CBZ.player && CBZ.player.pos;
    switch (kind) {
      case "attack": case "sic": case "go after":
        if (!t || t.dead || t === d || t === PA() || t === CBZ.player) return false;
        d._order = { kind: "attack", target: t, t: 0 }; d.sit = false; d.goTo = null;
        d.bark = true; return true;
      case "guard":
        if (t && t !== PA() && t !== CBZ.player && t.pos && !t.dead) d._order = { kind: "guard", target: t, spot: null, t: 0 };
        else d._order = { kind: "guard", target: null, spot: { x: d.pos.x, z: d.pos.z }, t: 0 };
        d.sit = false; d.goTo = null; return true;
      case "hold": case "stay":
        d._order = { kind: "hold", spot: { pos: { x: d.pos.x, y: d.pos.y, z: d.pos.z }, x: d.pos.x, z: d.pos.z }, t: 0 };
        d.sit = true; d.goTo = null; return true;
      case "follow":
        d._order = null; d.sit = false; d.goTo = null; void P; return true;
      case "standdown": case "stand down":
        if (d._order && d._order.kind === "attack") d._order = null;
        d._fight = null; d.dec = null; d.thinkT = 1.2; d.companionBusy = false; return true;
    }
    return false;
  }
  CBZ.cityDogOrder = order;

  // ============================================================
  //  VERBS — short and real. Hostile dogs offer nothing friendly.
  // ============================================================
  function hostile(d) { return !!(d.aggro || d.dead || d.role === "k9" || (d.role === "guard" && d.intrudeT > 0.3)); }
  function fighting(d) { return !!(d._fight || (d._order && d._order.kind === "attack")); }
  function nearestDog(px, pz) {
    let best = null, bd = 4.2 * 4.2;
    for (let i = 0; i < dogs.length; i++) {
      const d = dogs[i]; if (d.dead) continue;
      const q = (d.pos.x - px) * (d.pos.x - px) + (d.pos.z - pz) * (d.pos.z - pz);
      if (q < bd) { bd = q; best = d; }
    }
    return best ? { d: best, dist: Math.sqrt(bd) } : null;
  }
  function give(d, kind, t) {
    const O = CBZ.cityOrders2;
    if (O && O.give) return O.give(d, kind, t);
    return order(d, kind, t);
  }
  function registerInteractions() {
    const I = CBZ.interactions; if (!I) return false;
    I.registerSource({
      id: "src-dog", kind: "dog", layers: ["dog"], prio: 9, driving: false,
      find: function (px, pz, ctx, push) { const h = nearestDog(px, pz); if (h) push(h.d, h.dist); },
    });
    I.describe && I.describe("dog", function (d) { return { label: d.tamed ? d.name : "" }; });
    const mine = function (d) { return !!(d && d.tamed && !d.dead); };
    I.register("dog", { id: "dog-pet", slot: "e", prio: 20, canShow: function (d) { return mine(d) && !fighting(d); }, label: "Pet", onSelect: pet });
    I.register("dog", { id: "dog-follow", prio: 19, canShow: function (d) { return mine(d) && !!(d.sit || d._order); }, label: "Follow",
      onSelect: function (d) { give(d, "follow"); } });
    I.register("dog", { id: "dog-stay", prio: 18, canShow: function (d) { return mine(d) && !d.sit && !(d._order && d._order.kind === "hold"); }, label: "Stay",
      onSelect: function (d) { give(d, "hold"); } });
    I.register("dog", { id: "dog-guard", prio: 17, canShow: function (d) { return mine(d) && !(d._order && d._order.kind === "guard"); }, label: "Guard",
      onSelect: function (d) { give(d, "guard"); } });
    I.register("dog", { id: "dog-attack", prio: 16, bad: true, pick: "person", campaignSafe: true, canShow: mine, label: "Attack",
      onSelect: function (d, ctx, t) { if (t) give(d, "attack", t); } });
    I.register("dog", { id: "dog-standdown", prio: 70, canShow: function (d) { return mine(d) && fighting(d); }, label: "Stand down",
      onSelect: function (d) { order(d, "standdown"); } });
    I.register("dog", { id: "dog-feed-own", prio: 12, canShow: function (d) { return mine(d) && d.hp < d.maxHp && !!haveFeed(); }, label: "Feed", onSelect: feed });
    I.register("dog", { id: "dog-feed", slot: "e", prio: 22, canShow: function (d) { return !!(d && !d.tamed && !hostile(d) && !CBZ.dogBrain.canAdopt(d) && haveFeed()); }, label: "Feed", onSelect: feed });
    I.register("dog", { id: "dog-adopt", slot: "e", prio: 24, canShow: function (d) { return CBZ.dogBrain.canAdopt(d); }, label: "Adopt", onSelect: adopt });
    return true;
  }

  // ============================================================
  //  BITES — real damage, a real wound, and an answer
  // ============================================================
  function isDown(p) {
    if (!p || p.dead) return true;
    if (p.surrender && !p.rage) return true;
    try { if (CBZ.vitals && CBZ.vitals.cuffable && !p.animal && CBZ.vitals.cuffable(p)) return true; } catch (e) {}
    return false;
  }
  function dogBite(d, a, why) {
    const dmg = d.species.bite * (0.8 + rng() * 0.45);
    d.bite = true; d.shakeT = 0.5;
    sfxDog("growl", d);
    if (CBZ.bodyBite && a.char && a.pos) {
      try { CBZ.bodyBite(a, { x: a.pos.x, y: a.pos.y + (rng() < 0.6 ? 0.55 : 0.95), z: a.pos.z }, { jaw: 0.1 * d.dims.K + 0.06, sev: 0.5, fromX: d.pos.x, fromZ: d.pos.z }); } catch (e) {}
    }
    // the player is responsible for what his dog does unprovoked
    const yours = d.owner === "player";
    if (yours && why !== "defend" && !a._dogBilled) {
      a._dogBilled = true;
      if (CBZ.cityCrime) { try { CBZ.cityCrime(a.kind === "cop" ? 70 : 40, { x: a.pos.x, z: a.pos.z, type: a.kind === "cop" ? "assault-officer" : "assault" }); } catch (e) {} }
    } else if (yours && a.kind === "cop" && !a._dogBilled) {
      a._dogBilled = true;
      if (CBZ.cityCrime) { try { CBZ.cityCrime(70, { x: a.pos.x, z: a.pos.z, type: "assault-officer" }); } catch (e) {} }
    }
    if (a.animal) { if (CBZ.cityWildlifeHit) { try { CBZ.cityWildlifeHit(a, { head: false, point: null }, { damage: dmg, by: d }); } catch (e) {} } return; }
    if (a.kind === "cop") { if (CBZ.cityHurtCop) { try { CBZ.cityHurtCop(a, dmg, { fromX: d.pos.x, fromZ: d.pos.z, attacker: d, byPlayer: false }); } catch (e) {} } }
    else {
      a.hp = (a.hp == null ? (a.maxHp || 100) : a.hp) - dmg;
      if (a.hp <= 0 && CBZ.cityKillPed) { try { CBZ.cityKillPed(a, { fromX: d.pos.x, fromZ: d.pos.z, force: 4, attacker: d, byPlayer: false }, "mauled"); } catch (e) {} return; }
      if (CBZ.body && CBZ.body.hit) { try { CBZ.body.hit(a, { fromX: d.pos.x, fromZ: d.pos.z, force: 3 }); } catch (e) {} }
    }
    // HE ANSWERS IT: fight the dog or run (peds.js struck, sizeup.js)
    if (!a.dead && CBZ.cityStruck) { try { CBZ.cityStruck(d, a, false); } catch (e) {} }
  }

  // ============================================================
  //  HURT / DEATH — and what it costs the one who did it
  // ============================================================
  function playerDid(w) { const by = w && w.by; return !by || by === CBZ.player || by === PA() || by.isPlayer; }
  function witnesses(x, z, r) {
    const out = [], L = CBZ.cityPeds || [];
    for (let i = 0; i < L.length && out.length < 8; i++) {
      const p = L[i];
      if (!p || p.dead || !p.pos || p.recruited || p.companion) continue;
      if (hyp(p.pos.x, p.pos.z, x, z) < r) out.push(p);
    }
    return out;
  }
  function cruelty(d, killed) {
    // a dog that was going for you, or a K9 on you, is self-defence
    if (d.aggro || (d._fight && (d._fight.t === PA() || d._fight.t === CBZ.player))) return;
    const x = d.pos.x, z = d.pos.z;
    if (d.role === "k9") {
      if (CBZ.cityCrime) { try { CBZ.cityCrime(killed ? 110 : 70, { x: x, z: z, type: "assault-officer", instant: !!(d.handler && !d.handler.dead) }); } catch (e) {} }
      return;
    }
    const seen = witnesses(x, z, 22);
    if (seen.length) {
      if (CBZ.cityAlarm) { try { CBZ.cityAlarm(x, z, 18, 0.8, PA()); } catch (e) {} }
      if (CBZ.cityRelShift) for (let i = 0; i < seen.length; i++) { try { CBZ.cityRelShift(seen[i], "threatened", killed ? 0.8 : 0.5); } catch (e) {} }
      if (CBZ.cityCrime) { try { CBZ.cityCrime(killed ? 45 : 25, { x: x, z: z, type: "animal-cruelty" }); } catch (e) {} }
    }
    if (d.gang && CBZ.cityGangProvoke) { try { CBZ.cityGangProvoke(d.gang, killed ? 0.6 : 0.35); } catch (e) {} }
  }
  function dogShot(d, hit, w) {
    if (d.dead) return { head: false, down: false, dmg: 0 };
    const fall = (CBZ.weaponFalloffMul && hit && hit.dist != null && w && w.damage != null) ? (CBZ.weaponFalloffMul(w, hit.dist) || 1) : 1;
    const dmg = Math.max(1, Math.round((w && w.damage || 20) * (hit && hit.head ? (w && w.headMult || 2) : 1) * fall));
    d.hp -= dmg;
    if (hit && hit.point && CBZ.gore && CBZ.gore.spray) { try { CBZ.gore.spray(hit.point, 0.8, hit.dir || null); } catch (e) {} }
    const byPlayer = playerDid(w);
    const by = byPlayer ? (PA() || CBZ.player) : w.by;
    if (byPlayer) d.hurtByYou = true;
    if (d.hp <= 0) { if (byPlayer) cruelty(d, true); dogDie(d, hit, w, by); return { head: !!(hit && hit.head), down: true, dmg: dmg }; }
    sfxDog("yelp", d);
    d.mood.fear = 1; d.flinchT = 0.4;
    if (byPlayer) {
      cruelty(d, false);
      if (d.tamed) {
        // YOUR dog: it does not turn on you. It cowers, and trust breaks.
        d.loyalty -= 0.45; d.fleeT = 2.5; d.fleeFrom = by;
        if (d.loyalty <= 0) runOff(d);
      } else if (d.role === "stray" && d.hp < d.maxHp * 0.35) { d.fleeT = 6; d.fleeFrom = by; }
      else {
        const first = !d.aggro;
        dogAggro(d);
        // THE PACK LEARNS: every stray close by turns with it
        if (first && d.role === "stray") for (let i = 0; i < dogs.length; i++) {
          const o = dogs[i];
          if (o === d || o.dead || o.tamed || o.aggro || o.role !== "stray") continue;
          if (hyp(o.pos.x, o.pos.z, d.pos.x, d.pos.z) < PACK_R) dogAggro(o);
        }
      }
    } else if (by && !by.dead) {
      // somebody else hurt it: it fights him, or runs if it is badly hurt
      if (d.hp < d.maxHp * 0.35) { d.fleeT = 5; d.fleeFrom = by; }
      else { d._hurtBy = by; d._hurtT = 6; }
    }
    return { head: !!(hit && hit.head), down: false, dmg: dmg };
  }
  function dogAggro(d) {
    if (d.aggro || d.dead || d.tamed) return;
    d.aggro = true; d.state = "charge"; d._kit = null;
  }
  function dogCalm(d) {
    if (!d.aggro) return;
    d.aggro = false; d.state = "wander"; d.intrudeT = 0;
  }
  function runOff(d) {
    d.tamed = false; d.role = "stray"; d.owner = null; d.trust = 0; d.loyalty = 0; d._order = null; d.sit = false;
    DM.collar(d.rig, null);
    d.fleeT = 8;
  }
  function dogDie(d, hit, w, by) {
    d.dead = true; d.hp = 0; d.state = "dead"; d.aggro = false; d._fight = null; d.companionBusy = false;
    if (CBZ.petRelease) { try { CBZ.petRelease(d); } catch (e) {} }
    d._dieT = null; d._toppleTo = null;
    let mode = "none";
    if (CBZ.wildlifeDeathPhysics) {
      const shotK = Math.max(0.55, (w && w.knock) || 1) * (w && w.pellets ? 1.22 : 1);
      try { mode = CBZ.wildlifeDeathPhysics(d, (hit && hit.dir) || null, 3.2 + shotK * 2.7, (hit && hit.point) || null) || "none"; } catch (e) { mode = "none"; }
    }
    if (mode === "none") {
      // DEGRADE (no wildlife.js): roll onto its side about its own long axis
      d.group.rotation.order = "YXZ";
      d._dieT = 0.5; d._toppleTo = (Math.random() < 0.5 ? 1 : -1) * 1.35; d._dieX0 = d.group.rotation.x;
    }
    d.fadeT = 40;
    if (d.role === "k9" && by && (by === PA() || by === CBZ.player) && CBZ.news && CBZ.news.push) {
      try { CBZ.news.push("Police dog shot dead during chase", { cat: "CRIME", phone: true, key: "k9dead" }); } catch (e) {}
    }
    if (d.handler) d.handler._k9 = false;
  }

  // ============================================================
  //  MOVEMENT — a clamped turn, along the facing, walls stop it
  // ============================================================
  function dogMove(d, spd, dt, panic) {
    const grp = d.group;
    if (d.faceH == null) d.faceH = d.heading;
    let fd = wrapPi(d.heading - d.faceH);
    const mx = (panic ? 7.5 : 4) * dt;
    if (fd > mx) fd = mx; else if (fd < -mx) fd = -mx;
    d.faceH += fd;
    // a dog slows into a tight turn instead of skating round it
    const turnK = 1 - Math.min(0.55, Math.abs(wrapPi(d.heading - d.faceH)) * 0.5);
    const s = spd * turnK;
    if (s > 0) { grp.position.x += Math.cos(d.faceH) * s * dt; grp.position.z += Math.sin(d.faceH) * s * dt; }
    grp.position.y = groundY(grp.position.x, grp.position.z);
    if (s > 0 && CBZ.collideSlide && PL.has && hyp(grp.position.x, grp.position.z, PL.x, PL.z) < COLLIDE_R) {
      try { CBZ.collideSlide(grp.position, 0.24 * d.dims.K + 0.06, grp.position.y, grp.position.y + d.dims.withers); } catch (e) {}
    }
    d.speed = s;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(d, d.faceH); else grp.rotation.y = -d.faceH;
  }
  function faceTo(d, x, z, dt) { d.heading = Math.atan2(z - d.pos.z, x - d.pos.x); dogMove(d, 0, dt, true); }
  function goTo(d, x, z, dt, near, fast) {
    const dist = hyp(x, z, d.pos.x, d.pos.z);
    if (dist <= near) { dogMove(d, 0, dt, false); return true; }
    d.heading = Math.atan2(z - d.pos.z, x - d.pos.x);
    const spd = fast ? (dist > 6 ? RUN : TROT) : (dist > 8 ? TROT : WALK);
    dogMove(d, Math.min(spd, dist * 3 + 0.4), dt, fast);
    return false;
  }
  function flee(d, from, dt) {
    const fp = posOf(from) || { x: PL.x, z: PL.z };
    d.heading = Math.atan2(d.pos.z - fp.z, d.pos.x - fp.x) + Math.sin(clock * 1.3 + d.dims.K * 9) * 0.3;
    dogMove(d, RUN * 0.92, dt, true);
    d.mood.fear = 1; d.mood.alert = 0.4;
  }

  // ============================================================
  //  FIGHTING A BODY (not the player: the player gets the predator hunt)
  // ============================================================
  function fightStep(d, t, why, dt) {
    const tp = posOf(t);
    if (!tp || t.dead || isDown(t)) { d._fight = null; return false; }
    d._fight = { t: t, why: why };
    d.companionBusy = true;
    d.mood.aggr = 1; d.mood.alert = 1;
    d.look = tp;
    const dist = hyp(tp.x, tp.z, d.pos.x, d.pos.z);
    const reach = 0.85 + 0.35 * d.dims.K + (t.kind === "dog" ? 0.25 : 0.3);
    if (dist > reach) {
      d.heading = Math.atan2(tp.z - d.pos.z, tp.x - d.pos.x);
      dogMove(d, dist > 5 ? RUN : TROT + 0.8, dt, true);
      if (d.barkCD <= 0 && dist > 8) { d.bark = true; d.barkCD = 1.4 + rng(); sfxDog("bark", d); }
    } else {
      faceTo(d, tp.x, tp.z, dt);
      if (d.biteCD <= 0) { dogBite(d, t, why); d.biteCD = 0.8 + rng() * 0.5; }
    }
    return true;
  }

  // ============================================================
  //  HUNTING THE PLAYER — systems/predator.js's shared driver
  // ============================================================
  const DTGT = { pos: null, group: { position: null }, dead: false, hp: 1e9 };
  function dogHuntMove(d, want, speed, dt) {
    if (!(dt > 0)) return false;
    if (want != null) d.heading = want;
    dogMove(d, Math.max(0, speed || 0), dt, true);
    return true;
  }
  const ORBIT_R = 7.5;
  function harry(d, PP, dist, dt) {
    const h = d._hunt;
    const dir = (h && h.orbitDir < 0) ? -1 : 1;
    const to = Math.atan2(PP.z - d.pos.z, PP.x - d.pos.x);
    const err = Math.max(-1, Math.min(1, (dist - ORBIT_R) / ORBIT_R));
    d.heading = to + dir * (Math.PI * 0.5) * (1 - err * 0.8);
    dogMove(d, RUN * 0.72, dt, true);
  }
  function dogKit(d) {
    if (d._kit) return d._kit;
    const sp = d.species;
    const cause = d.role === "k9" ? "taken down by a police dog" : "mauled by a dog";
    const over = {
      medium: "air", style: "maul", move: dogHuntMove,
      canReach: function () { return d._packRole !== "flank" && d._packRole !== "hold"; },
      onHit: function (dm) {
        d.bite = true; d.shakeT = 0.6;
        if (CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(dm, d.pos.x, d.pos.z, cause, false, d, false); } catch (e) {} }
      },
      cruiseSpeed: RUN * 0.55, rushSpeed: RUN,
    };
    let k = null;
    if (CBZ.predatorKit) { try { k = CBZ.predatorKit(d, over); } catch (e) { k = null; } }
    if (!k) k = Object.assign({ reach: 1.7, rate: 0.95, dmg: sp.bite, seize: { dps: 10 + sp.bite * 0.4, thrash: 1, style: "worry" } }, over);
    k.seize = k.seize || {};
    if (!k.seize.jaw && CBZ.creatureJawPoint) { try { k.seize.jaw = CBZ.creatureJawPoint(d); } catch (e) {} }
    k.seize.cause = cause;
    d._kit = k;
    return k;
  }
  function huntPlayer(d, dt) {
    const PP = CBZ.player && CBZ.player.pos;
    if (!PP) return false;
    d.companionBusy = true;
    d.mood.aggr = 1; d.mood.alert = 1; d.look = PP;
    const adp = hyp(PP.x, PP.z, d.pos.x, d.pos.z);
    if (adp < 1.9 && d.biteCD <= 0) { d.bite = true; d.biteCD = 0.7 + rng() * 0.4; if (rng() < 0.5) d.shakeT = 0.5; }
    if (d.barkCD <= 0 && adp > 6) { d.bark = true; d.barkCD = 1.2 + rng() * 1.2; sfxDog("bark", d); }
    if (HUNT_ON()) {
      DTGT.pos = PP; DTGT.group.position = PP; DTGT.dead = false; DTGT.hp = 1e9;
      d._packRole = CBZ.predatorPack ? (CBZ.predatorPack(d, DTGT, dt) || "commit") : "commit";
      let st = null;
      try { st = CBZ.predatorHunt(d, DTGT, dt, dogKit(d)); } catch (e) { st = null; }
      if (st === "cruise" || st == null) harry(d, PP, adp, dt);
      return true;
    }
    if (adp <= 4.5 && CBZ.creatureFight) {
      DTGT.pos = PP; DTGT.group.position = PP; DTGT.dead = false; DTGT.hp = 1e9;
      CBZ.creatureFight(d, DTGT, dt, d._atkOpts || (d._atkOpts = {
        reach: 1.7, rate: 0.95, dmg: d.species.bite, speed: RUN, style: "maul",
        onHit: function (dm) { if (CBZ.cityHurtPlayer) { try { CBZ.cityHurtPlayer(dm, d.pos.x, d.pos.z, "mauled by a dog", false, d, false); } catch (e) {} } },
      }));
      d.faceH = d.heading;
    } else { d.heading = Math.atan2(PP.z - d.pos.z, PP.x - d.pos.x); dogMove(d, RUN, dt, true); }
    return true;
  }

  // ============================================================
  //  THE BRAINS, by role
  // ============================================================
  const WORLD = { principal: null, principalIds: [null, null], pos: null, lists: [null, null, null], now: 0, wanted: 0, playerIsPrincipal: true, down: isDown };
  function world(principal, ppos, playerIsPrincipal) {
    WORLD.principal = principal; WORLD.pos = ppos; WORLD.playerIsPrincipal = playerIsPrincipal;
    WORLD.principalIds[0] = playerIsPrincipal ? PA() : principal;
    WORLD.principalIds[1] = playerIsPrincipal ? CBZ.player : null;
    WORLD.lists[0] = CBZ.cityPeds; WORLD.lists[1] = CBZ.cityCops; WORLD.lists[2] = CBZ.cityWildlife;
    WORLD.now = nowMs(); WORLD.wanted = g.wanted | 0;
    return WORLD;
  }
  function think(d, dt, principal, ppos, mineIsPlayer) {
    d.thinkT -= dt;
    const dec = d.dec;
    if (dec && dec.target && (dec.target.dead || isDown(dec.target)) && dec.act === "attack") d.dec = null;
    if (d.thinkT > 0 && d.dec) return d.dec;
    d.thinkT = THINK;
    d.dec = CBZ.dogBrain.decide(d, world(principal, ppos, mineIsPlayer));
    return d.dec;
  }
  function endFight(d) {
    if (!d.companionBusy && !d._fight) return;
    const was = d._fight;
    d._fight = null; d.companionBusy = false;
    if (was && d.owner === "player") { d._petCheckIn = 1; d._beatT = 0; }
  }
  function barkAt(d, t, dt) {
    const tp = posOf(t); if (!tp) return;
    d.look = tp; d.mood.alert = 1;
    if (d.barkCD <= 0) {
      d.bark = true; sfxDog("bark", d);
      d._barkRun = (d._barkRun || 0) + 1;
      d.barkCD = d._barkRun % 3 === 0 ? 4.5 + rng() * 2 : 0.45 + rng() * 0.25;
    }
  }

  // ---- YOUR DOG ---------------------------------------------------------
  function petBrain(d, dt) {
    const P = CBZ.player && CBZ.player.pos;
    if (!P) return;
    const ord = d._order;
    if (ord) ord.t += dt;
    if (ord && ord.kind === "attack" && (!ord.target || ord.target.dead || isDown(ord.target))) { d._order = null; d.dec = null; }
    // a guard order on a PERSON makes that person the principal
    const guardT = ord && ord.kind === "guard" && ord.target && !ord.target.dead ? ord.target : null;
    const principal = guardT || PA();
    const ppos = guardT ? guardT.pos : P;
    const dec = think(d, dt, principal, ppos, !guardT);
    d.mood.happy = 0.5;
    if (dec.act === "attack" && dec.target) {
      if (fightStep(d, dec.target, dec.why, dt)) return;
    }
    endFight(d);
    if (dec.act === "growl" && dec.target) {
      const tp = posOf(dec.target);
      d.companionBusy = true; d.mood.aggr = 0.7; d.mood.alert = 1; d.mood.happy = 0; d.look = tp;
      if (tp) faceTo(d, tp.x, tp.z, dt);
      if (d.barkCD <= 0) { sfxDog("growl", d); d.barkCD = 2.2 + rng(); }
      return;
    }
    if (dec.act === "warn" && dec.target) { barkAt(d, dec.target, dt); d.mood.happy = 0; }
    else d._barkRun = 0;
    d.companionBusy = false;

    // ---- the standing order's body
    if (ord && ord.kind === "guard") {
      d.sit = false;
      if (guardT) { goTo(d, guardT.pos.x, guardT.pos.z, dt, 2.2, true); return; }
      const sp = ord.spot;
      if (!goTo(d, sp.x, sp.z, dt, 0.9, true)) return;
      // posted: it lies down watching, and stands when anything moves near
      d.lieT += dt;
      if (dec.act === "none" && d.lieT > 6) d.posture = "lie";
      if (d.barkCD <= 0) { d.heading = d.faceH + (rng() - 0.5) * 1.6; d.barkCD = 3 + rng() * 4; }
      dogMove(d, 0, dt, false);
      return;
    }
    d.lieT = 0;
    if (PETS_ON() && CBZ.petFollow(d, dt, petOpts())) return;
    // without the shared follower: a plain heel
    if (d.sit) { faceTo(d, P.x, P.z, dt); return; }
    const dist = hyp(P.x, P.z, d.pos.x, d.pos.z);
    if (dist > HEEL_R) goTo(d, P.x, P.z, dt, HEEL_R, dist > 10);
    else dogMove(d, 0, dt, false);
  }
  let PET_OPTS = null;
  function petOpts() {
    return PET_OPTS || (PET_OPTS = {
      id: "dogs:heel", stayKey: "sit", topSpeed: RUN, heelR: HEEL_R,
      move: function (d, heading, spd, dt, panic) { d.heading = heading; dogMove(d, spd, dt, panic); },
      note: function () {},
    });
  }

  // ---- A STRAY ----------------------------------------------------------
  function strayBrain(d, dt) {
    const P = CBZ.player && CBZ.player.pos;
    if (d.aggro) {
      if (!P || (CBZ.player && CBZ.player.dead) || hyp(P.x, P.z, d.pos.x, d.pos.z) > AGGRO_GIVEUP) { dogCalm(d); return; }
      huntPlayer(d, dt); return;
    }
    d.companionBusy = false;
    if (d._hurtBy && d._hurtT > 0 && !d._hurtBy.dead) { if (fightStep(d, d._hurtBy, "self", dt)) return; }
    endFight(d);
    const t = d.trust || 0;
    d.mood.fear = Math.max(0.15, 0.55 - t * 0.6); d.mood.happy = t * 0.7;
    if (P) {
      const dist = hyp(P.x, P.z, d.pos.x, d.pos.z);
      const food = !!haveFeed();
      if (CBZ.dogBrain.shouldFlee(d, { pos: P, speed: PL.spd, hasFood: food })) { d.fleeT = 2 + rng() * 2; d.fleeFrom = CBZ.player; }
      if (dist < 14) d.look = P;
      // food in your pocket: it comes in, a step at a time, to the length of
      // its nerve (close enough to take it from you, never closer)
      if (food && dist < 14) {
        const keep = 1.6 + (1 - t) * 1.6;
        if (dist > keep + 0.3 && !goTo(d, P.x, P.z, dt, keep, false)) { d.mood.sniff = 0.3; return; }
        faceTo(d, P.x, P.z, dt); d.mood.happy = Math.max(d.mood.happy, 0.25 + t * 0.6); d.mood.alert = 0.5;
        return;
      }
      if (dist < 7 && t < 0.3) {
        // keeps its distance and watches you
        d.mood.alert = 0.6;
        if (dist < 4.5) { d.heading = Math.atan2(d.pos.z - P.z, d.pos.x - P.x); dogMove(d, WALK * 1.3, dt, false); return; }
        faceTo(d, P.x, P.z, dt); return;
      }
    }
    wander(d, dt, d.home, d.homeRadius);
  }
  function wander(d, dt, home, R) {
    if (home) {
      if (hyp(home.x, home.z, d.pos.x, d.pos.z) > R) { d.idleT = 0; d.heading = Math.atan2(home.z - d.pos.z, home.x - d.pos.x); dogMove(d, WALK, dt, false); return; }
    }
    d.turnT -= dt;
    if (d.idleT > 0) {
      d.idleT -= dt;
      d.mood.sniff = d._idleSniff ? 1 : 0;
      if (d._idleLie) d.posture = "lie";
      else if (d._idleSit) d.posture = "sit";
      dogMove(d, 0, dt, false); return;
    }
    if (d.turnT <= 0) {
      d.heading += (Math.random() - 0.5) * 1.4; d.turnT = 2 + Math.random() * 3;
      if (Math.random() < 0.4) {
        d.idleT = 1.5 + Math.random() * 4;
        const r = Math.random();
        d._idleSniff = r < 0.45; d._idleSit = r >= 0.45 && r < 0.7; d._idleLie = r >= 0.7 && r < 0.85;
        if (d._idleLie) d.idleT += 6;
        dogMove(d, 0, dt, false); return;
      }
    }
    d.mood.sniff = 0.35;
    dogMove(d, WALK * (0.75 + 0.3 * Math.sin(clock * 0.7 + d.dims.K * 13)), dt, false);
  }

  // ---- A YARD DOG -------------------------------------------------------
  function guardBrain(d, dt) {
    const P = CBZ.player && CBZ.player.pos;
    const home = d.home || (d.home = { x: d.pos.x, z: d.pos.z });
    const R = d.homeRadius || 8;
    const friend = (d.trust || 0) >= 0.66;
    if (d.aggro) {
      const away = P ? hyp(P.x, P.z, home.x, home.z) : 1e9;
      if (!P || (CBZ.player && CBZ.player.dead) || away > R + 30 || friend) { dogCalm(d); return; }
      huntPlayer(d, dt); return;
    }
    d.companionBusy = false;
    if (d._hurtBy && d._hurtT > 0 && !d._hurtBy.dead) { if (fightStep(d, d._hurtBy, "self", dt)) return; }
    // its people's fight is its fight
    d._gfT = (d._gfT || 0) - dt;
    if (d._gfT <= 0) { d._gfT = 0.4; d._gf = d.gang ? gangFight(d, home, R + 18) : null; }
    const gm = d._gf && (d._gf === "player" || !d._gf.dead) ? d._gf : null;
    if (gm === "player") { dogAggro(d); return; }
    if (gm && gm.pos) { if (fightStep(d, gm, "defend", dt)) return; }
    endFight(d);
    d.mood.alert = 0.35;
    if (P && !friend) {
      const inYard = hyp(P.x, P.z, home.x, home.z) < R && !(CBZ.player && CBZ.player.driving);
      const near = hyp(P.x, P.z, d.pos.x, d.pos.z);
      if (inYard || near < 3) {
        d.intrudeT += dt; d.look = P;
        d.mood.aggr = 0.85; d.mood.alert = 1;
        faceTo(d, P.x, P.z, dt);
        if (d.barkCD <= 0) { sfxDog("growl", d); d.barkCD = 1.6; }
        // a working farm dog sees you off with noise; a yard dog means it
        if (!d.soft && (d.intrudeT > 2.4 || near < 2.2)) dogAggro(d);
        return;
      }
      d.intrudeT = Math.max(0, d.intrudeT - dt * 0.5);
      if (hyp(P.x, P.z, home.x, home.z) < R + 9) {
        // at the fence: between you and its yard, barking
        const ax = P.x - home.x, az = P.z - home.z, m = Math.hypot(ax, az) || 1;
        if (!goTo(d, home.x + ax / m * (R * 0.75), home.z + az / m * (R * 0.75), dt, 0.8, true)) { barkAt(d, CBZ.player, dt); return; }
        faceTo(d, P.x, P.z, dt); barkAt(d, CBZ.player, dt); return;
      }
    }
    if (friend) d.mood.happy = 0.5;
    wander(d, dt, home, R);
  }
  // is somebody fighting this dog's gang near its yard? "player" when it's you
  function gangFight(d, home, R) {
    const L = CBZ.cityPeds; if (!L) return null;
    const pa = PA(), now = nowMs();
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (!p || p.dead || p.gang !== d.gang || !p.pos) continue;
      if (hyp(p.pos.x, p.pos.z, home.x, home.z) > R) continue;
      if (p._pHitT != null && now - p._pHitT < 6000) return "player";
      if (p.rage && p.rage === pa) return "player";
      if (p.rage && p.rage.pos && !p.rage.dead && p.rage.gang !== d.gang) return p.rage;
    }
    return null;
  }

  // ---- A POLICE DOG -----------------------------------------------------
  function k9Brain(d, dt) {
    const c = d.handler, P = CBZ.player && CBZ.player.pos;
    if (!c || c.dead) {
      // the handler is down: it is a lost dog now
      d.role = "stray"; d.handler = null; d.aggro = false; d.state = "wander"; d.trust = 0.15; d._kit = null;
      return;
    }
    const wanted = g.wanted | 0;
    if (wanted > 0 && P && !(CBZ.player && CBZ.player.dead) && hyp(P.x, P.z, d.pos.x, d.pos.z) < 140) {
      d.aggro = true; d.state = "charge";
      huntPlayer(d, dt); return;
    }
    if (d.aggro) { d.aggro = false; d.state = "wander"; }
    d.companionBusy = false;
    // at heel on the handler's left
    const hx = c.pos.x - 1.2, hz = c.pos.z + 0.6;
    d.mood.alert = 0.6;
    if (!goTo(d, hx, hz, dt, 1.0, hyp(hx, hz, d.pos.x, d.pos.z) > 6)) return;
    d.mood.sniff = 0.4;
    dogMove(d, 0, dt, false);
  }

  // ============================================================
  //  TICK
  // ============================================================
  function tick(dt) {
    if (!dt || dt > 0.5) dt = 0.05;
    clock += dt;
    samplePlayer(dt);
    if (!gangDogsDone && clock > 3) { try { spawnGangDogs(); } catch (e) { gangDogsDone = true; } }
    if (g.mode === "city") k9Manager(dt);
    const P = CBZ.player && CBZ.player.pos;
    const fe = ((CBZ.scene && CBZ.scene.fog && CBZ.scene.fog.far) || CBZ.cityFogFar || 760) + 30;
    for (let i = 0; i < dogs.length; i++) {
      const d = dogs[i], grp = d.group;
      if (d.dead) {
        if (d._deathPhys && CBZ.wildlifeDeathStep) CBZ.wildlifeDeathStep(d, dt);
        else if (d._dieT != null) {
          d._dieT -= dt;
          const k = Math.max(0, Math.min(1, 1 - d._dieT / 0.5)), e = 1 - (1 - k) * (1 - k);
          grp.rotation.x = (d._dieX0 || 0) + (d._toppleTo - (d._dieX0 || 0)) * e;
          if (d._dieT <= 0) d._dieT = null;
        }
        animateDog(d, dt, P, "dead");
        d.fadeT -= dt;
        if (d.fadeT <= 0) { removeDog(d); i--; }
        continue;
      }
      if (P) { const vdx = grp.position.x - P.x, vdz = grp.position.z - P.z; grp.visible = vdx * vdx + vdz * vdz < fe * fe; }
      // timers + per-frame intents reset
      d.biteCD -= dt; d.barkCD -= dt; if (d._hurtT > 0) d._hurtT -= dt;
      if (d.shakeT > 0) d.shakeT -= dt;
      if (d.petT > 0) d.petT -= dt;
      if (d.eatT > 0) d.eatT -= dt;
      if (d.sniffT > 0) d.sniffT -= dt;
      if (d.wagBoost) d.wagBoost = Math.max(0, d.wagBoost - dt);
      d.mood.alert = 0; d.mood.aggr = 0; d.mood.fear = Math.max(0, d.mood.fear - dt * 0.8); d.mood.happy = 0; d.mood.sniff = 0;
      d.look = null; d.posture = null;
      // eating: head down at the food, tail going
      if (d.eatT > 0) { d.mood.sniff = 1; d.mood.happy = 0.8; dogMove(d, 0, dt, false); animateDog(d, dt, P); continue; }
      if (d.fleeT > 0) {
        d.fleeT -= dt; flee(d, d.fleeFrom, dt);
        if (d.barkCD <= 0 && d.hp < d.maxHp * 0.5) { sfxDog("whine", d); d.barkCD = 1.5 + rng(); }
        animateDog(d, dt, P); continue;
      }
      if (d.role === "pet") petBrain(d, dt);
      else if (d.role === "k9") k9Brain(d, dt);
      else if (d.role === "guard") guardBrain(d, dt);
      else strayBrain(d, dt);
      if (d.petT > 0) { d.mood.happy = 1; d.look = P; }
      if (d.wagBoost > 0) d.mood.happy = Math.max(d.mood.happy, Math.min(1, d.wagBoost));
      if (d.sniffT > 0) d.mood.sniff = 1;
      animateDog(d, dt, P);
    }
  }

  // body language -> the model
  const CTRL = { x: 0, z: 0, y: 0, heading: 0, posture: "stand", alert: 0, aggr: 0, fear: 0, happy: 0, sniff: 0, lookYaw: 0, lookPitch: 0, bark: false, bite: false, shake: false, pant: null, tilt: 0, ground: null };
  function animateDog(d, dt, P, forcePost) {
    const grp = d.group;
    if (!grp.visible) { d.bark = false; d.bite = false; return; }
    const near = P ? hyp(grp.position.x, grp.position.z, P.x, P.z) : 0;
    if (near > ANIM_R && !forcePost) { d.bark = false; d.bite = false; return; }
    const C = CTRL;
    C.x = grp.position.x; C.z = grp.position.z; C.y = grp.position.y; C.heading = d.faceH == null ? d.heading : d.faceH;
    let post = forcePost || d.posture || "stand";
    if (!forcePost && d.tamed && (d._sitK || 0) > 0.5) post = "sit";
    if (!forcePost && d.sit && d.role === "pet" && !d.companionBusy) post = "sit";
    if (d.speed > 0.3 && post !== "dead") post = "stand";
    C.posture = post;
    const m = d.mood;
    C.alert = m.alert; C.aggr = m.aggr; C.fear = m.fear; C.happy = m.happy; C.sniff = m.sniff;
    C.lookYaw = 0; C.lookPitch = 0;
    const lk = d.look;
    if (lk && post !== "dead") {
      const off = wrapPi(Math.atan2(lk.z - grp.position.z, lk.x - grp.position.x) - C.heading);
      C.lookYaw = Math.abs(off) < 1.6 ? -off : 0;
      const ty = (lk.y || grp.position.y) + (lk === P ? 1.5 : 0.8);
      C.lookPitch = Math.atan2(ty - (grp.position.y + d.dims.headP.y), Math.max(0.6, hyp(lk.x, lk.z, grp.position.x, grp.position.z))) * 0.8;
    }
    C.bark = d.bark; C.bite = d.bite; C.shake = d.shakeT > 0; C.pant = null; C.tilt = d._beatKind === "tilt" ? 0.8 : 0;
    C.ground = near < 30 ? groundY : null;
    d.bark = false; d.bite = false;
    DM.animate(d.rig, dt, C);
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
    if (!registerInteractions()) { const t = setInterval(function () { if (registerInteractions()) clearInterval(t); }, 300); }
    spawnStrays();
    CBZ.onUpdate(47.4, tick);
    return null;
  }, 96);

  CBZ.cityDogList = function () { return dogs; };
  CBZ.cityDogAudit = function () {
    const out = { total: 0, pet: 0, stray: 0, guard: 0, k9: 0, dead: 0, fighting: 0, hunting: 0 };
    for (let i = 0; i < dogs.length; i++) {
      const d = dogs[i]; out.total++;
      if (d.dead) { out.dead++; continue; }
      out[d.role] = (out[d.role] || 0) + 1;
      if (d._fight) out.fighting++;
      if (d.aggro) out.hunting++;
    }
    return out;
  };
})();
