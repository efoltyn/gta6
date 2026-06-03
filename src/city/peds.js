/* ============================================================
   city/peds.js — the city's people, driven by ONE personality
   spectrum: `aggr` ∈ [0,1], from meek (flees everything) to violent
   (full agency — mugs, brawls, carjacks, fights cops, snatches a downed
   cop's gun, and racks up its OWN wanted level so police hunt it too).

   The same brain runs civilians, shop vendors AND gang members (gangs.js
   spawns them as peds with a high aggr + a turf guard point). Behaviour
   switches at the CITY.aggro band edges:

     aggr < flee   → flees crime, never throws a punch, calls the cops
     < bold        → stands its ground / films, fights only if attacked
     < crook       → starts petty crime (mug, shove), grabs dropped guns
     < violent     → brawler: attacks the weak, joins fights, carjacks
     ≥ violent     → rampage: attacks cops, steals cop guns, self-wanted

   Routines: peds pick destinations (shop doors, benches, corners, home),
   route through intersections to cross, idle/chat in pairs, and duck into
   buildings. LOD + AI time-slicing keep the crowd cheap.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const { makeCharacter, animChar, lerpAngle } = CBZ;
  const g = CBZ.game;
  const A0 = () => (CBZ.CITY && CBZ.CITY.aggro) || {};
  const tmp = new THREE.Vector3();

  const PED_R = 0.5, ANIM_D2 = 58 * 58, TAG_D2 = 26 * 26, VIS_D2 = 150 * 150, FAR_D2 = 110 * 110;
  let frame = 0;

  // weapon pickups dropped in the world (cops/gangsters that get downed).
  CBZ.cityDrops = CBZ.cityDrops || [];

  const SKIN = [0xf0c39a, 0xe8b58c, 0xc08a5a, 0x8a5a3a, 0x6b4a32, 0xd8a177, 0xfae0c8, 0x5a3c28];
  const HAIR = [0x2a2018, 0x4a3526, 0x101820, 0xb9b1a6, 0x7a4a2e, 0xdedede];
  const OUTFIT = [0x4f9dff, 0x44d07a, 0xffd166, 0xc792ea, 0xff9e6b, 0x66d9c0, 0xf06b9b, 0x7ed957, 0xe85d8a, 0x5b8bff, 0x8a939c, 0xb98a5a];
  const FIRST = ["Marcus", "Tanya", "Vince", "Lola", "Dee", "Rosa", "Cam", "Jax", "Trey", "Mona", "Otis", "Bree", "Sal", "Kira", "Boon", "Nia", "Rex", "Gita", "Hank", "Suze", "Marlo", "Pim", "Dro", "Esi", "Ray", "Val", "Cyd", "Nyla"];
  const LAST = "ABCDEFGHJKLMNPRSTVW";
  function pick(a, r) { return a[(r * a.length) | 0]; }

  let _s = 555;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  function name(r) { return pick(FIRST, r()) + " " + LAST[(r() * LAST.length) | 0] + "."; }

  // a normal-ish draw on the spectrum around a mean, clamped
  function rollAggr(mean, spread) {
    const r = (rng() + rng() + rng()) / 3;     // ~bell
    return Math.max(0, Math.min(1, mean + (r - 0.5) * 2 * (spread || 0.2)));
  }

  // wealth distribution skewed so plenty of WELL-OFF people walk the streets
  // (visible chains/watches, fat wallets) with the odd WHALE — richer marks to
  // rob, and a more alive, varied city. econ.rollCash maps wealth → cash.
  function richWealth(r) {
    const x = r();
    if (x > 0.984) return 0.99;                 // ~1.6% whale ($1.5k–10k on them)
    if (x > 0.88) return 0.82 + r() * 0.14;     // ~10% wealthy (jewellery, big wallet)
    if (x > 0.66) return 0.6 + r() * 0.2;       // ~22% comfortable
    return r() * 0.6;                            // the rest: ordinary
  }

  function makePed(x, z, r, opts) {
    opts = opts || {};
    const ag = A0();
    const outfit = opts.outfit || pick(OUTFIT, r());
    const skin = pick(SKIN, r());
    const wealth = opts.wealth != null ? opts.wealth : richWealth(r);
    const econ = CBZ.cityEcon;
    const ch = makeCharacter({ legs: pick(OUTFIT, r()), torso: outfit, collar: outfit, arms: outfit, skin, hair: pick(HAIR, r()), shoes: 0x2b2b2b });
    ch.group.position.set(x, 0, z);
    ch.group.rotation.y = r() * 6.28;
    const nm = opts.name || name(r);
    const tag = CBZ.makeLabelSprite ? CBZ.makeLabelSprite(nm) : null;
    if (tag) { tag.position.y = 3.0; tag.scale.set(3, 0.75, 1); tag.visible = false; ch.group.add(tag); }
    const aggr = opts.aggr != null ? opts.aggr : rollAggr(ag.meanCivilian != null ? ag.meanCivilian : 0.24, ag.spreadCivilian);
    const cash = opts.cash != null ? opts.cash : (econ ? econ.rollCash(wealth) : (5 + ((r() * 45) | 0)));
    let loot = opts.loot || null;
    if (!loot && econ && r() < (wealth > 0.7 ? 0.6 : 0.22)) loot = econ.randomLoot(wealth > 0.7);
    // Concealed carry is a possession roll, not a temperament roll. A meek
    // civilian can own a gun and a violent civilian can still be empty-handed.
    const armed = opts.armed != null ? opts.armed : r() < (0.035 + wealth * 0.025);
    const traits = CBZ.castTraits ? CBZ.castTraits.rollCity(r, {
      aggr, archetype: opts.archetype, job: opts.job, behavior: opts.behavior,
      reactivity: opts.reactivity, drugUser: opts.drugUser,
    }) : {};
    const ped = {
      char: ch, group: ch.group, pos: ch.group.position, name: nm,
      tag, outfit, skin, kind: opts.kind || "civilian",
      aggr, wealth,
      archetype: traits.archetype || opts.archetype || "resident",
      job: traits.job || opts.job || "between jobs",
      behavior: traits.behavior || opts.behavior || null,
      reactivity: traits.reactivity != null ? traits.reactivity : aggr,
      drugUser: !!traits.drugUser, erratic: traits.erratic || 0, tweakT: 1 + r() * 4,
      hp: opts.hp || 100, maxHp: opts.hp || 100, dead: false, deadT: 0, ko: 0,
      cash, loot, looted: false, robbed: false,
      armed, weapon: opts.weapon || (armed ? "Pistol" : null), ammo: armed ? 30 : 0, shootCD: 0,
      npcHeat: 0, npcWanted: 0, offenseT: 0, witnessSev: 0, deadLoot: null,
      gang: opts.gang || null, guard: opts.guard || null, faction: opts.faction || null,
      partner: null, family: null,
      baseSpeed: 1.5 + r() * 1.0, speed: 0,
      target: new THREE.Vector3(x, 0, z), finalGoal: null, path: null,
      pause: 0, state: "walk", fear: 0, callT: 0, alarmed: 0,
      rage: null, mem: null, attackCD: 0, enterT: 0, chatT: 0,
      vendor: opts.vendor || null, slice: (r() * 8) | 0, isPlayer: false,
    };
    if (ped.vendor) ped.kind = "vendor";
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    return ped;
  }
  CBZ.cityMakePed = makePed;        // used by gangs.js / social.js

  CBZ.spawnCityPeds = function (n) {
    CBZ.clearCityPeds();
    const A = CBZ.buildCity();
    _s = 555 + n;
    if (CBZ.cityEcon && CBZ.cityEcon.initMarket) CBZ.cityEcon.initMarket();
    CBZ.cityDrops.length = 0;
    for (let i = 0; i < n; i++) {
      const p = A.randomSidewalkPoint();
      const ped = makePed(p.x, p.z, rng, {});
      A.root.add(ped.group);
      CBZ.cityPeds.push(ped);
    }
    if (A.shopLots) for (const lot of A.shopLots) {
      const vs = lot.building.vendorSpot;
      // the Ammu-Nation gunsmith (and the security firm) keep a gun behind the
      // counter — of course. Robbing/downing them drops it for the taking. A
      // higher nerve makes them stand their ground rather than flee.
      const packsHeat = lot.kind === "guns" || lot.kind === "security";
      const ped = makePed(vs.x, vs.z, rng, {
        vendor: lot, kind: "vendor", wealth: 0.7, cash: 80 + ((rng() * 200) | 0),
        name: vendorName(lot), aggr: packsHeat ? 0.55 : 0.3,
        archetype: "merchant", job: vendorName(lot).toLowerCase(),
        armed: packsHeat, weapon: packsHeat ? (lot.kind === "guns" ? "Carbine" : "Pistol") : null,
      });
      if (packsHeat) { ped.nerve = 0.85; ped.ammo = 40; }
      ped.group.rotation.y = vs.face;
      A.root.add(ped.group);
      CBZ.cityPeds.push(ped);
      lot.building.vendor = ped;
    }
    if (CBZ.spawnCityGangs) CBZ.spawnCityGangs();
    if (CBZ.spawnCitySecurity) CBZ.spawnCitySecurity();
    if (CBZ.citySocialInit) CBZ.citySocialInit();
  };

  function vendorName(lot) {
    const t = {
      guns: "Gunsmith", jewelry: "Jeweler", pawn: "Pawnbroker", gas: "Clerk", clothing: "Stylist", drugs: "Dealer",
      food: "Cook", bar: "Bartender", bank: "Teller", hardware: "Clerk", gym: "Trainer", security: "Recruiter",
      hospital: "Medic", barber: "Barber", electronics: "Clerk", carlot: "Salesman", realtor: "Realtor", chop: "Mechanic",
      casino: "Pit Boss", raceway: "Race Marshal", arena: "Promoter", paintball: "Referee", transit: "Dispatcher",
      cityhall: "Clerk", airfield: "Handler", racepark: "Bookie",
    };
    return t[lot.kind] || "Owner";
  }

  CBZ.clearCityPeds = function () {
    for (const p of CBZ.cityPeds) {
      if (p.group && p.group.parent) p.group.parent.remove(p.group);
      if (p.group) p.group.traverse(function (o) {
        if (o.isSprite) return;     // sprites share an r128 geometry singleton — never dispose
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) try { o.geometry.dispose(); } catch (e) {}
        if (o.material) { const m = o.material; if (Array.isArray(m)) m.forEach((x) => x && !x._shared && x.dispose && x.dispose()); else if (!m._shared && m.dispose) m.dispose(); }
      });
    }
    CBZ.cityPeds.length = 0;
    CBZ.cityDrops.length = 0;
    if (CBZ.citySecurity) CBZ.citySecurity.length = 0;
  };

  // ---- alarm everyone near (x,z); offender lets witnesses remember who ----
  CBZ.cityAlarm = function (x, z, radius, intensity, offender) {
    radius = radius || 18; intensity = intensity || 1;
    const r2 = radius * radius;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z;
      if (dx * dx + dz * dz < r2) {
        p.alarmed = Math.max(p.alarmed, 4 + intensity * 3);
        p.fear = Math.min(10, p.fear + intensity);
        if (offender && offender !== p && offender.pos) p.mem = offender;     // witness memory
      }
    }
  };

  // tag everyone in sight of a crime as a witness who can phone it in (the
  // ONLY way the player gets stars — RDR2 style). `sev` = crime weight.
  CBZ.cityTagWitnesses = function (x, z, sev, type) {
    const r2 = 30 * 30;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z;
      if (dx * dx + dz * dz < r2) {
        p.mem = CBZ.city.playerActor;
        if ((sev || 0) >= (p.witnessSev || 0)) p.witnessType = type;   // remember the WORST thing they saw, by name
        p.witnessSev = Math.max(p.witnessSev || 0, sev);
        p.alarmed = Math.max(p.alarmed, 5);
        p.fear = Math.min(10, p.fear + 1.5);
      }
    }
  };

  // ---- rob / KO / kill (player-facing verbs reused by interact + combat) ----
  CBZ.cityRobPed = function (ped) {
    if (!ped || ped.dead || ped.robbed) return null;
    const econ = CBZ.cityEcon;
    let got = ped.cash; ped.cash = 0;
    if (got > 0 && CBZ.city) CBZ.city.addCash(got);
    let item = "";
    if (ped.loot && econ) { econ.add(ped.loot, 1); item = ped.loot; ped.loot = null; }
    ped.robbed = true; ped.alarmed = 8; ped.fear = 10;
    CBZ.cityAlarm(ped.pos.x, ped.pos.z, 16, 1, CBZ.city.playerActor);
    CBZ.cityCrime && CBZ.cityCrime(60, { x: ped.pos.x, z: ped.pos.z, type: "robbery" });
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city && CBZ.city.addRespect(1);
    if (CBZ.cityCountMayhem) CBZ.cityCountMayhem();
    return { cash: got, item };
  };

  CBZ.cityKOPed = function (ped, fromX, fromZ) {
    if (!ped || ped.dead) return;
    ped.ko = 8; ped.alarmed = 6;
    if (CBZ.body) CBZ.body.hit(ped, { fromX, fromZ, force: 7, knockdown: true });
    if (ped.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.5);
    CBZ.cityAlarm(ped.pos.x, ped.pos.z, 14, 0.8, CBZ.city.playerActor);
    CBZ.cityCrime && CBZ.cityCrime(45, { x: ped.pos.x, z: ped.pos.z, type: "assault" });
  };

  CBZ.cityKillPed = function (ped, imp, cause) {
    if (!ped || ped.dead) return;
    ped.dead = true; ped.deadT = 0; ped.hp = 0;
    // an armed ped drops their gun where they fall (anyone can grab it)
    if (ped.armed && ped.weapon) dropWeapon(ped.pos.x, ped.pos.z, ped.weapon, ped.ammo);
    ped.armed = false; ped.weapon = null; ped.ammo = 0;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    // bodies carry WAY more than you'd lift off the living — loot the corpse
    rollDeadLoot(ped);
    if (CBZ.gore && ped.pos) {
      let dir = null;
      if (imp && imp.fromX != null) dir = { x: ped.pos.x - imp.fromX, z: ped.pos.z - imp.fromZ };
      CBZ.gore(ped.pos.x, ped.pos.y + 1.0, ped.pos.z, { dir, amount: 1.0, cloth: ped.outfit, skin: ped.skin });
    }
    if (CBZ.body) {
      if (imp && imp.fromX != null) CBZ.body.hit(ped, { fromX: imp.fromX, fromZ: imp.fromZ, force: imp.force || 7, fling: imp.fling || 4 });
      else { const a = rng() * 6.28; CBZ.body.hit(ped, { dir: { x: Math.cos(a), z: Math.sin(a) }, force: 3, fling: 5 }); }
    }
    // attribute the kill: a real actor (player or NPC) is the offender; a
    // driverless run-over has none (just a death, nobody to blame/witness).
    const att = (imp && imp.attacker && imp.attacker.pos) ? imp.attacker : null;
    const byPlayer = imp ? imp.byPlayer !== false : true;
    const offender = att && att !== CBZ.city.playerActor ? att : (byPlayer ? CBZ.city.playerActor : null);
    CBZ.cityAlarm(ped.pos.x, ped.pos.z, 22, 1.4, offender);
    if (ped.gang && byPlayer && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.5);
    if (att && att !== CBZ.city.playerActor) {
      if (att.kind !== "cop" && !lawfulSecurityAct(att, ped) && CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, 90, "murder");   // lawful responders are not criminals
    } else if (byPlayer) {
      CBZ.cityCrime && CBZ.cityCrime(250, { x: ped.pos.x, z: ped.pos.z, type: "murder" });
      CBZ.city && CBZ.city.addKill();
      if (CBZ.cityCountMayhem) CBZ.cityCountMayhem();
    }
    if (ped.gang && CBZ.cityGangMemberDown) CBZ.cityGangMemberDown(ped, imp);
    if (ped.partner && CBZ.citySocialDeath) CBZ.citySocialDeath(ped);
    if (CBZ.pushKill) CBZ.pushKill((ped.name || "A civilian") + " was killed", "#ff6b6b");
  };

  // bodies carry a real haul — cash plus whatever they were holding
  function rollDeadLoot(ped) {
    const econ = CBZ.cityEcon;
    let cash = (ped.cash || 0) + (econ ? econ.rollCash(ped.wealth) : 20) + (ped.gang ? 60 + ((rng() * 240) | 0) : 0);
    const items = [];
    if (ped.loot) items.push(ped.loot);
    if (econ) {
      if (rng() < 0.6) items.push(econ.randomLoot(ped.wealth > 0.6 || ped.gang));
      if (ped.gang) { items.push(rng() < 0.5 ? "Coke" : "Weed"); if (rng() < 0.4) items.push("Ammo Box"); }
      if (rng() < 0.3) items.push(["Phone", "Wallet", "Cash Stack", "Sunglasses"][(rng() * 4) | 0]);
    }
    ped.deadLoot = { cash: Math.round(cash), items, looted: false };
  }

  // loot a corpse (interact.js [I] near a body): take the whole haul
  CBZ.cityLootCorpse = function (ped) {
    if (!ped || !ped.dead || !ped.deadLoot || ped.deadLoot.looted) return null;
    const dl = ped.deadLoot; dl.looted = true;
    const econ = CBZ.cityEcon;
    if (dl.cash > 0 && CBZ.city) CBZ.city.addCash(dl.cash);
    const got = [];
    for (const it of dl.items) { if (it && econ) { econ.add(it, 1); got.push(it); } }
    if (CBZ.sfx) CBZ.sfx("loot");
    CBZ.city && CBZ.city.note("Looted body: $" + dl.cash + (got.length ? " + " + got.join(", ") : ""), 2);
    return dl;
  };
  CBZ.cityNearestCorpse = function (x, z, maxd) {
    let best = null, bd = (maxd || 3) * (maxd || 3);
    for (const p of CBZ.cityPeds) { if (!p.dead || !p.deadLoot || p.deadLoot.looted || p.culled) continue; const dd = (p.pos.x - x) * (p.pos.x - x) + (p.pos.z - z) * (p.pos.z - z); if (dd < bd) { bd = dd; best = p; } }
    return best;
  };

  // ---- dropped weapons ----
  function dropWeapon(x, z, weapon, ammo) {
    let mesh = null;
    if (CBZ.city && CBZ.city.arena) {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.22), CBZ.mat(0x1c1f24, { emissive: 0x39ff66, ei: 0.25 }));
      mesh.position.set(x, 0.25, z); mesh.userData.transient = true;
      CBZ.city.arena.root.add(mesh);
    }
    CBZ.cityDrops.push({ x, z, weapon: weapon || "Pistol", ammo: ammo || 24, t: 0, mesh });
  }
  CBZ.cityDropWeapon = dropWeapon;

  function removeDrop(i) {
    const d = CBZ.cityDrops[i];
    if (d && d.mesh && d.mesh.parent) { d.mesh.parent.remove(d.mesh); if (d.mesh.geometry) d.mesh.geometry.dispose(); if (d.mesh.material) d.mesh.material.dispose(); }
    CBZ.cityDrops.splice(i, 1);
  }

  // ---- damage helpers used by the NPC brain (NPC vs NPC / NPC vs cop / NPC vs player) ----
  function lawfulSecurityAct(att, tgt) {
    if (!att || att.kind !== "security" || !tgt) return false;
    if (att.mem === tgt && att.alarmed > 0) return true;
    return tgt.isPlayer ? (g.wanted | 0) >= 1 : (tgt.npcWanted | 0) >= 1;
  }

  function hurtActor(att, tgt, dmg, melee) {
    if (!tgt || tgt.dead) return;
    const fx = att.pos.x, fz = att.pos.z;
    if (tgt.isPlayer) {
      const who = att.name ? (att.name + (att.gang ? " of the " + att.gang : "")) : (att.kind === "cop" ? "the police" : "a stranger");
      if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, fx, fz, att.kind === "cop" ? "gunned down" : "killed in the street", false, who);
      // a melee beatdown can knock you off your feet (physics.js owns the get-up)
      if (melee && CBZ.body && CBZ.body.knockdown && CBZ.city && CBZ.city.playerActor &&
          !((CBZ.game.invuln || 0) > 0) && !CBZ.body.busy(CBZ.city.playerActor) && Math.random() < 0.33) {
        CBZ.body.knockdown(CBZ.city.playerActor, { fromX: fx, fromZ: fz, force: 7, t: 1.0 });
      }
      if (!lawfulSecurityAct(att, tgt) && CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, melee ? 22 : 40, melee ? "assault" : "shots-fired");
      return;
    }
    if (tgt.kind === "cop") {
      if (CBZ.cityHurtCop) CBZ.cityHurtCop(tgt, dmg, { fromX: fx, fromZ: fz });
      if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, melee ? 60 : 110, "attacked-officer");
      return;
    }
    // ped vs ped
    tgt.hp -= dmg;
    tgt.alarmed = Math.max(tgt.alarmed, 6); tgt.fear = Math.min(10, tgt.fear + 2);
    if (!tgt.rage && tgt.aggr >= (A0().bold || 0.5)) { tgt.rage = att; tgt.state = "fight"; }   // fight back
    if (tgt.hp <= 0) CBZ.cityKillPed(tgt, { fromX: fx, fromZ: fz, attacker: att, byPlayer: false, force: melee ? 6 : 5, fling: melee ? 3 : 4 });
    else if (CBZ.body) CBZ.body.hit(tgt, { fromX: fx, fromZ: fz, force: melee ? 5 : 3, knockdown: melee && rng() < 0.3 ? 1 : 0 });
    if (!lawfulSecurityAct(att, tgt) && CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, melee ? 18 : 36, "assault");
  }

  function npcAttack(att, tgt) {
    if (att.attackCD > 0 || !tgt || tgt.dead) return;
    const d = Math.hypot(att.pos.x - tgt.pos.x, att.pos.z - tgt.pos.z);
    if (att.armed && att.ammo > 0 && d < 26) {
      // shoot
      att.attackCD = 0.55 + rng() * 0.5; att.ammo--;
      if (CBZ.actorAimAt) CBZ.actorAimAt(att, tgt);
      const from = CBZ.actorMuzzle ? CBZ.actorMuzzle(att, tmp) : { x: att.pos.x, y: 1.4, z: att.pos.z };
      const to = { x: tgt.pos.x, y: (tgt.isPlayer ? 1.55 : 1.3), z: tgt.pos.z };
      if (CBZ.tracer) CBZ.tracer(from, to, { muzzleScale: 1.0 });
      else if (CBZ.muzzleFlash) CBZ.muzzleFlash(from, {});
      if (CBZ.sfx) CBZ.sfx("report");
      const hit = rng() < Math.max(0.2, 0.8 - d * 0.025);
      if (hit) hurtActor(att, tgt, 14 + rng() * 10, false);
      if (att.ammo <= 0) { att.armed = false; att.weapon = null; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(att); }
    } else if (d < 2.4) {
      // melee
      att.attackCD = 0.5 + rng() * 0.4;
      if (CBZ.sfx) CBZ.sfx("punch");
      hurtActor(att, tgt, 16 + rng() * 8, true);
    }
  }

  // grab the nearest dropped gun (for an unarmed aggressive ped)
  function nearestDrop(x, z, maxd) {
    let best = -1, bd = maxd * maxd;
    for (let i = 0; i < CBZ.cityDrops.length; i++) { const d = CBZ.cityDrops[i]; const dd = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z); if (dd < bd) { bd = dd; best = i; } }
    return best;
  }

  // nearest other actor matching a test (peds + cops)
  function nearestActor(self, maxd, test) {
    let best = null, bd = maxd * maxd;
    const scan = (p) => { if (p === self || p.dead) return; if (!test(p)) return; const dd = (p.pos.x - self.pos.x) * (p.pos.x - self.pos.x) + (p.pos.z - self.pos.z) * (p.pos.z - self.pos.z); if (dd < bd) { bd = dd; best = p; } };
    for (const p of CBZ.cityPeds) scan(p);
    for (const c of CBZ.cityCops) scan(c);
    return best;
  }

  function band(a) { const B = A0(); return a < (B.flee || 0.3) ? "meek" : a < (B.bold || 0.5) ? "wary" : a < (B.crook || 0.72) ? "bold" : a < (B.violent || 0.88) ? "crook" : "violent"; }

  // ---- routine waypoint picking (route through an intersection to cross) ----
  function pickRoutineGoal(ped) {
    const A = CBZ.city.arena;
    const r = rng();
    let goal;
    if (r < 0.25 && A.shopLots && A.shopLots.length) { const l = A.shopLots[(rng() * A.shopLots.length) | 0]; goal = { x: l.building.door.x, z: l.building.door.z, enter: true }; }
    else if (r < 0.4 && A.lots) { const l = A.lots[(rng() * A.lots.length) | 0]; goal = { x: l.cx + (rng() - 0.5) * l.w, z: l.cz + (rng() - 0.5) * l.d }; }
    else { const p = A.randomSidewalkPoint(); goal = { x: p.x, z: p.z }; }
    ped.finalGoal = goal;
    // 2-hop route: cross at the nearest intersection first if the goal is far
    const dGoal = Math.hypot(goal.x - ped.pos.x, goal.z - ped.pos.z);
    if (dGoal > A.step * 0.9) {
      const it = A.nearestIntersection(goal.x, goal.z);
      ped.path = [{ x: it.x + (rng() - 0.5) * 3, z: it.z + (rng() - 0.5) * 3 }, goal];
    } else ped.path = [goal];
    ped.target.set(ped.path[0].x, 0, ped.path[0].z);
    ped.pause = 0.5 + rng() * 2;
  }

  // ---- COMPANION brain: recruited crew that travels with you (Minecraft-dog
  //      style — close by, not glued), and shoots threats to defend you. ----
  function companionFollowPoint(ped, P) {
    const dx = ped.pos.x - P.pos.x, dz = ped.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
    return { x: P.pos.x + (dx / d) * 3.4, z: P.pos.z + (dz / d) * 3.4 };   // hold ~3.4m off you
  }
  function companionThreat(ped) {
    const P = CBZ.player, PA = CBZ.city.playerActor;
    let best = null, bd = 26 * 26;
    if ((g.wanted | 0) >= 1 && CBZ.cityCops) {                 // cops, while you're wanted
      for (const c of CBZ.cityCops) { if (c.dead) continue; const dx = c.pos.x - ped.pos.x, dz = c.pos.z - ped.pos.z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = c; } }
    }
    for (const p of CBZ.cityPeds) {                            // anyone attacking YOU
      if (p.dead || p === ped || p.recruited) continue;
      if (p.rage === PA || p.rage === P) { const dx = p.pos.x - ped.pos.x, dz = p.pos.z - ped.pos.z, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = p; } }
    }
    return best;
  }
  function companionThink(ped, dt, active) {
    const P = CBZ.player;
    ped.fear = 0; ped.alarmed = 0; ped.surrender = false; ped.rage = null;   // never panic/flee
    if (!ped.armed) { ped.armed = true; ped.weapon = ped.weapon || "Pistol"; ped.ammo = ped.ammo || 999; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped); }
    if (ped.ammo < 6) ped.ammo = 999;                          // crew never runs dry (they're on payroll)
    if (!P || P.dead) { ped.state = "walk"; ped.target.set(ped.pos.x, 0, ped.pos.z); ped.path = null; return; }
    const threat = companionThreat(ped);
    if (threat && !threat.dead) {
      ped.state = "walk";
      ped.group.rotation.y = Math.atan2(threat.pos.x - ped.pos.x, threat.pos.z - ped.pos.z);
      const d = Math.hypot(threat.pos.x - ped.pos.x, threat.pos.z - ped.pos.z);
      ped.target.set(d > 13 ? threat.pos.x : ped.pos.x, 0, d > 13 ? threat.pos.z : ped.pos.z);   // close to ~13m, then hold + fire
      npcAttack(ped, threat);
    } else {
      ped.state = "walk";
      const d = Math.hypot(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z);
      if (d > 60) ped.pos.set(P.pos.x + 3, 0, P.pos.z);        // teleport if hopelessly lost
      if (d > 4.5) { const fp = companionFollowPoint(ped, P); ped.target.set(fp.x, 0, fp.z); }
      else { ped.target.set(ped.pos.x, 0, ped.pos.z); ped.group.rotation.y = Math.atan2(P.pos.x - ped.pos.x, P.pos.z - ped.pos.z); }
    }
    ped.path = null;
  }
  CBZ.cityCompanionThink = companionThink;

  // ---- the brain (time-sliced) ----
  function think(ped, dt, active) {
    if (ped.companion) { companionThink(ped, dt, active); return; }
    if (ped.dead || ped.vendor || ped.ko > 0) return;
    if (ped.controlled) return;     // city/social.js drives companions/hostages/kidnap victims
    const B = A0();
    const P = CBZ.player, px = P.pos.x, pz = P.pos.z;
    const ddx = ped.pos.x - px, ddz = ped.pos.z - pz, dpl = Math.hypot(ddx, ddz);
    const playerArmed = !!g.cityWeapon && CBZ.cityEcon && CBZ.cityEcon.ITEMS[g.cityWeapon] && CBZ.cityEcon.ITEMS[g.cityWeapon].gun;
    const playerThreat = !P.dead && (((g.wanted | 0) >= 1 && playerArmed) || P._fighting > 0);
    const bnd = band(ped.aggr);

    // ---- if currently raging at someone, keep engaging until they're gone ----
    if (ped.rage) {
      if (ped.rage.dead || (ped.rage.isPlayer && P.dead)) { ped.rage = null; }
      else {
        ped.state = "fight";
        ped.target.set(ped.rage.pos.x, 0, ped.rage.pos.z);
        // disengage if badly hurt and not truly violent
        if (ped.hp < ped.maxHp * 0.3 && ped.aggr < (B.violent || 0.88)) { ped.rage = null; ped.state = "flee"; fleeFrom(ped, ped.pos.x + ddx, ped.pos.z + ddz); }
        return;
      }
    }

    // ---- GUNPOINT (reuses the jail's intimidate logic): if the player is
    //      pointing a gun at this person, the meek SURRENDER (hands up, frozen,
    //      robbable) and the bold/armed DRAW and fight back — a stand-off. ----
    ped.surrender = false;
    if (playerArmed && dpl < 9) {
      const cy = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(cy), fz = -Math.cos(cy);
      const m = dpl || 1, dot = ((px - ped.pos.x) / m) * -fx + ((pz - ped.pos.z) / m) * -fz; // player→ped vs facing
      const aimedAtMe = (((ped.pos.x - px) / m) * fx + ((ped.pos.z - pz) / m) * fz) > 0.62;
      if (aimedAtMe) {
        if (ped.aggr < (B.crook || 0.72) || (!ped.armed && ped.aggr < (B.violent || 0.88))) {
          ped.surrender = true; ped.state = "surrender"; ped.speed = 0; ped.fear = 10; ped.robbable = true;
          return;
        }
        // bold + (usually armed): draw and fight back — a Mexican stand-off
        ped.rage = CBZ.city.playerActor; ped.state = "fight";
        if (ped.gang && CBZ.cityGangProvoke) CBZ.cityGangProvoke(ped.gang, 0.4);
        return;
      }
    }

    // ---- being threatened (player aiming / hot / a witnessed crime nearby) ----
    const threatened = ped.alarmed > 0 || (playerThreat && dpl < 14);
    if (threatened) {
      if (bnd === "meek" || bnd === "wary") {
        ped.state = bnd === "wary" && rng() < 0.4 ? "film" : "flee";
        if (ped.state === "flee") fleeFrom(ped, px, pz);
        else { ped.speed = 0; }
        // report the offender to the cops after a beat of panic
        if (ped.callT <= 0 && ped.alarmed > 2 && rng() < 0.5) {
          ped.callT = 6;
          const off = ped.mem;
          if (off === CBZ.city.playerActor) { if (CBZ.cityReport) CBZ.cityReport(ped.witnessSev || 20, { x: px, z: pz, type: ped.witnessType }); ped.witnessSev = 0; ped.witnessType = null; CBZ.city && CBZ.city.note("🗣️ " + ped.name + " called the cops!", 1.4); }
          else if (off && CBZ.cityNpcOffense) CBZ.cityNpcOffense(off, 14, "reported");
          // unknown offender → a 911 call, but the player's wanted level is unaffected
        }
        return;
      }
      // bold+ : confront / fight the threat (the player, or a remembered offender)
      const foe = (ped.mem && !ped.mem.dead && ped.mem.pos) ? ped.mem : (dpl < 14 ? CBZ.city.playerActor : null);
      if (foe && ped.aggr >= (B.bold || 0.5)) {
        if (ped.kind === "security") { ped.rage = foe; ped.state = "fight"; return; }
        if (ped.aggr >= (B.crook || 0.72)) { ped.rage = foe; ped.state = "fight"; return; }
        ped.state = "confront"; ped.target.set(foe.pos.x, 0, foe.pos.z); return;   // close in, threaten
      }
    }

    // ---- posted guards: gangs hold turf; private security protects businesses ----
    if (active && ped.guard) {
      const intruder = ped.gang ? turfIntruder(ped, px, pz, playerArmed)
        : ped.kind === "security" && CBZ.citySecurityIntruder ? CBZ.citySecurityIntruder(ped) : null;
      if (intruder) { ped.rage = intruder; ped.state = "fight"; return; }
      // Hold the turf/post: loiter near the guard point.
      const dg = Math.hypot(ped.pos.x - ped.guard.x, ped.pos.z - ped.guard.z);
      if (dg > 9 || ped.pause <= 0) {
        ped.target.set(ped.guard.x + (rng() - 0.5) * 7, 0, ped.guard.z + (rng() - 0.5) * 7);
        ped.pause = 1.5 + rng() * 3; ped.state = "walk"; ped.path = null;
      }
      // A violent gangster can still freelance crime when no intruder.
    }

    // ---- tweakers: cheap but visible behavioral variety ----
    // They keep the same combat and inventory rules as everyone else; this only
    // changes routine choices and movement rhythm.
    if (active && ped.drugUser && ped.erratic > 0 && ped.tweakT <= 0 && !ped.rage) {
      ped.tweakT = 3 + rng() * 7;
      const A = CBZ.city.arena;
      const trap = A && A.shopLots && A.shopLots.find((l) => l.kind === "drugs");
      if (trap && rng() < 0.42) {
        ped.path = null; ped.finalGoal = { x: trap.building.door.x, z: trap.building.door.z, enter: true };
        ped.target.set(ped.finalGoal.x, 0, ped.finalGoal.z); ped.state = "walk"; ped.pause = 0;
        return;
      }
      if (rng() < 0.72) {
        ped.path = null; ped.target.set(ped.pos.x + (rng() - 0.5) * 16, 0, ped.pos.z + (rng() - 0.5) * 16);
        ped.state = "walk"; ped.pause = 0; return;
      }
    }

    // ---- autonomy: aggressive peds start their own trouble ("infinite power") ----
    // (only the active/near crowd does the expensive target scans — LOD)
    if (active && ped.aggr >= (B.crook || 0.72) && ped.attackCD <= 0 && ped.pause <= 0) {
      // 1) grab a dropped gun if unarmed
      if (!ped.armed) {
        const di = nearestDrop(ped.pos.x, ped.pos.z, 18);
        if (di >= 0) { ped.state = "loot"; const d = CBZ.cityDrops[di]; ped.target.set(d.x, 0, d.z); return; }
      }
      const roll = rng();
      // 2) the truly violent take on cops / carjack / rampage
      if (ped.aggr >= (B.violent || 0.88)) {
        if (roll < 0.10) { const cop = nearestActor(ped, 22, (p) => p.kind === "cop"); if (cop) { ped.rage = cop; ped.state = "fight"; return; } }
        if (roll < 0.16 && CBZ.cityNpcCarjack && !ped.inCar) { if (CBZ.cityNpcCarjack(ped)) return; }
      }
      // 3) crooks mug / brawl a nearby weaker civilian
      if (roll < 0.14) {
        const victim = nearestActor(ped, 12, (p) => !p.vendor && p.kind === "civilian" && p.aggr < ped.aggr - 0.15);
        if (victim) { ped.rage = victim; ped.state = "fight"; if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 12, "mugging"); return; }
      }
    }

    // ---- being hunted by cops for your OWN crimes: flee or fight ----
    if (active && (ped.npcWanted | 0) >= 1) {
      const cop = nearestActor(ped, 30, (p) => p.kind === "cop" && p.npcTarget === ped);
      if (cop) {
        if (ped.aggr >= (B.violent || 0.88)) { ped.rage = cop; ped.state = "fight"; return; }
        ped.state = "flee"; fleeFrom(ped, cop.pos.x, cop.pos.z); return;
      }
    }

    // ---- default: routine ----
    if (ped.state === "confront" || ped.state === "fight" || ped.state === "flee" || ped.state === "loot") ped.state = "walk";
    // social: idle peds near each other pause to chat
    if (ped.chatT <= 0 && rng() < 0.04) {
      const mate = nearestActor(ped, 3.2, (p) => p.kind === "civilian" && !p.vendor && (p.state === "walk" || p.state === "idle"));
      if (mate) { ped.state = "chat"; ped.chatT = 2 + rng() * 3; ped.speed = 0; ped.group.rotation.y = Math.atan2(mate.pos.x - ped.pos.x, mate.pos.z - ped.pos.z); return; }
    }
    if (ped.pause <= 0 && (!ped.path || !ped.path.length)) pickRoutineGoal(ped);
  }

  function fleeFrom(ped, x, z) {
    ped.state = "flee"; ped.path = null;
    const m = Math.hypot(ped.pos.x - x, ped.pos.z - z) || 1;
    ped.target.set(ped.pos.x + ((ped.pos.x - x) / m) * 22, 0, ped.pos.z + ((ped.pos.z - z) / m) * 22);
  }

  // is there an intruder in this gangster's turf they should attack?
  function turfIntruder(ped, px, pz, playerArmed) {
    const G = ped.guard, R2 = 13 * 13;
    // the player, if hot/armed/provoked the gang, standing in turf
    const dP = (px - G.x) * (px - G.x) + (pz - G.z) * (pz - G.z);
    const prov = CBZ.cityGangProvoked ? CBZ.cityGangProvoked(ped.gang) : 0;
    if (!CBZ.player.dead && dP < R2 && (prov > 0.4 || (playerArmed && (CBZ.game.wanted | 0) >= 1))) return CBZ.city.playerActor;
    // a rival gangster in turf
    const rival = nearestActor(ped, 12, (p) => p.gang && p.gang !== ped.gang);
    if (rival) { const dr = (rival.pos.x - G.x) * (rival.pos.x - G.x) + (rival.pos.z - G.z) * (rival.pos.z - G.z); if (dr < R2 * 1.6) return rival; }
    return null;
  }

  // ---- movement / engagement ----
  function move(ped, dt, animate) {
    // walked up to interact? they at least turn and LOOK at you (flag refreshed
    // by city/interact.js each frame the panel targets them). Calm people stop
    // and face you; someone fleeing / fighting / surrendering is too busy.
    if (ped._faceT > 0) {
      ped._faceT -= dt;
      const busy = ped.controlled || ped.state === "flee" || ped.state === "fight" || ped.state === "confront" || ped.state === "surrender";
      if (!busy) {
        const dx = CBZ.player.pos.x - ped.pos.x, dz = CBZ.player.pos.z - ped.pos.z;
        if (dx * dx + dz * dz > 0.05) ped.group.rotation.y = lerpAngle(ped.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0004, dt));
        ped.speed = 0; ped.pause = Math.max(ped.pause, 0.3);
        if (animate) animChar(ped.char, 0, dt);
        if (!ped.vendor) { if (CBZ.collide) CBZ.collide(ped.pos, PED_R, ped.pos.y, ped.pos.y + 1.7); ped.pos.y = 0; }
        return;
      }
    }
    if (ped.vendor) { if (animate) animChar(ped.char, 0, dt); return; }
    if (ped.inCar) { ped.speed = 0; return; }   // out on the road; vehicles.js drives it
    if (ped.callT > 0) ped.callT -= dt;
    if (ped.chatT > 0) { ped.chatT -= dt; ped.speed = 0; if (animate) animChar(ped.char, 0, dt); if (ped.chatT <= 0) ped.state = "walk"; return; }
    if (ped.attackCD > 0) ped.attackCD -= dt;
    if (ped.shootCD > 0) ped.shootCD -= dt;

    const st = ped.state;
    let spd = ped.baseSpeed;
    if (st === "flee") spd = ped.baseSpeed * 2.2;
    else if (st === "fight" || st === "confront") spd = ped.baseSpeed * 1.7;
    else if (st === "chat" || st === "idle") spd = 0;
    if (ped.drugUser && ped.erratic > 0 && spd > 0) spd *= 1 + ped.erratic * 0.16;

    // engagement: attack when in range
    if (st === "fight" && ped.rage && !ped.rage.dead) {
      const d = Math.hypot(ped.rage.pos.x - ped.pos.x, ped.rage.pos.z - ped.pos.z);
      const want = ped.armed ? 9 : 1.7;
      if (d <= want + 0.4) { spd = 0; npcAttack(ped, ped.rage); }
    }

    // loot pickup
    if (st === "loot") {
      const di = nearestDrop(ped.pos.x, ped.pos.z, 1.6);
      if (di >= 0) { const d = CBZ.cityDrops[di]; ped.armed = true; ped.weapon = d.weapon; ped.ammo = d.ammo; if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped); removeDrop(di); ped.state = "walk"; }
    }

    const dx = ped.target.x - ped.pos.x, dz = ped.target.z - ped.pos.z, dist = Math.hypot(dx, dz);
    if (ped.pause > 0) ped.pause -= dt;
    const _px0 = ped.pos.x, _pz0 = ped.pos.z, _trying = spd > 0 && dist > 0.5;
    if (spd > 0 && dist > 0.5) {
      ped.pos.x += (dx / dist) * spd * dt;
      ped.pos.z += (dz / dist) * spd * dt;
      ped.group.rotation.y = lerpAngle(ped.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0009, dt));
      ped.speed = spd;
    } else {
      ped.speed = 0;
      // advance along a routine path / arrive
      if (dist <= 0.6 && ped.path && ped.path.length) {
        ped.path.shift();
        if (ped.path.length) ped.target.set(ped.path[0].x, 0, ped.path[0].z);
        else {
          ped.path = null;
          if (ped.finalGoal && ped.finalGoal.enter && rng() < 0.5) { ped.enterT = 3 + rng() * 5; }
          ped.pause = Math.max(ped.pause, 0.4 + rng() * 1.5);
        }
      } else if (st === "wander" || st === "walk") ped.pause = Math.max(ped.pause, 0.4);
    }

    // "entered" a building: hide briefly then re-emerge (cheap life)
    if (ped.enterT > 0) { ped.enterT -= dt; ped.group.visible = false; ped.speed = 0; if (ped.enterT <= 0) ped.group.visible = true; return; }

    if (CBZ.collide) CBZ.collide(ped.pos, PED_R, ped.pos.y, ped.pos.y + 1.7);
    if (CBZ.city && CBZ.city.arena) CBZ.city.arena.clampToCity(ped.pos, PED_R);
    ped.pos.y = 0;
    // STUCK DETECTION: a ped that tried to move but got shoved back by a wall is
    // grinding into it — reroute instead of standing there forever (smarter AI).
    if (_trying) {
      const moved = Math.hypot(ped.pos.x - _px0, ped.pos.z - _pz0);
      if (moved < spd * dt * 0.4) {
        ped._stuck = (ped._stuck || 0) + dt;
        if (ped._stuck > 0.45) {
          ped._stuck = 0;
          if (ped.state === "fight" || ped.state === "flee") {
            // wall in the way of a chase/flee — sidestep to slip around it
            const a = ped.group.rotation.y + (rng() < 0.5 ? 1.5 : -1.5);
            ped.target.set(ped.pos.x + Math.sin(a) * 6, 0, ped.pos.z + Math.cos(a) * 6);
          } else { ped.path = null; pickRoutineGoal(ped); }   // abandon the blocked goal, pick a reachable one
        }
      } else if (ped._stuck) ped._stuck = 0;
    }
    if (animate) animChar(ped.char, ped.speed, dt);
  }

  // ---- per-frame update ----
  CBZ.onUpdate(34, function (dt) {
    if (g.mode !== "city") return;
    frame++;
    const camx = CBZ.camera.position.x, camz = CBZ.camera.position.z;
    const peds = CBZ.cityPeds;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (p._parked) continue;     // pooled crowd-promotion ped waiting off-map; not in play
      if (p.alarmed > 0) p.alarmed -= dt;
      if (p.tweakT > 0) p.tweakT -= dt;
      if (p.npcHeat > 0) { p.npcHeat = Math.max(0, p.npcHeat - dt * 4); }
      if (p.offenseT > 0) p.offenseT -= dt;
      if (p.ko > 0 && !p.dead) p.ko -= dt;
      if (p.dead) {
        if (p.tag) p.tag.visible = false;
        p.deadT += dt;
        // bodies STAY on the ground (loot them as long as they're there). After a
        // short response delay they flag for pickup; city/medics.js dispatches a
        // paramedic who walks over and carries them off (sets p.collected). A long
        // fallback prevents a leak if no medic ever reaches it.
        if (p.deadT > 4) p.needsPickup = true;
        if ((p.collected || p.deadT > 75) && !p.culled) { p.culled = true; if (p.group.parent) p.group.parent.remove(p.group); }
        continue;
      }
      if (p.inCar) continue;     // vehicles.js owns it while it drives
      const dx = p.pos.x - camx, dz = p.pos.z - camz, d2 = dx * dx + dz * dz;
      if (p.tag) p.tag.visible = d2 < TAG_D2;
      if (CBZ.body && CBZ.body.busy && CBZ.body.busy(p)) continue;
      if (p.ko > 0) { p.speed = 0; if (d2 < ANIM_D2) animChar(p.char, 0, dt); continue; }
      const near = d2 < ANIM_D2;
      const important = p.rage || p.guard || p.controlled || (p.npcWanted | 0) >= 1 || p.armed;
      const active = near || important;
      // render LOD: peds far from the camera stop drawing entirely (the single
      // biggest GPU saving with ~90 rigs). enterT owns visibility while inside.
      if (p.enterT <= 0) p.group.visible = active || d2 < VIS_D2;
      const far = d2 > FAR_D2;
      const stride = active ? 4 : (far ? 20 : 10);
      if ((frame + p.slice) % stride === 0) think(p, dt * stride, active);
      move(p, dt, near || important);
    }

    // age out / pick up dropped weapons (player auto-grabs by walking over)
    for (let i = CBZ.cityDrops.length - 1; i >= 0; i--) {
      const d = CBZ.cityDrops[i]; d.t += dt;
      const P = CBZ.player;
      if (!P.dead && !P.driving && Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < 1.5) {
        if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(d.weapon);
        if (CBZ.cityAddAmmo) CBZ.cityAddAmmo(d.ammo);
        CBZ.city && CBZ.city.note("Picked up " + d.weapon, 1.4);
        removeDrop(i); continue;
      }
      if (d.t > 30) removeDrop(i);
    }
  });
})();
