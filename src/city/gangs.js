/* ============================================================
   city/gangs.js — the factions that own the ABANDONED blocks.

   Each gang claims a set of derelict buildings (city/buildings.js marks
   lots `abandoned`), tags them in its colour, and posts members to hold
   the turf. Members are full peds (city/peds.js) spawned with a high
   aggression so the universal brain makes them territorial: they guard
   the block, attack intruders + rival gangs, and freelance street crime.

   Provocation: rob a gang's STASH or drop one of its members and the
   whole crew turns hostile inside their turf until the heat cools. A low
   ambient war director sends bounded raid squads into a rival's block.

   Exposes: CBZ.cityGangs, spawnCityGangs, cityGangOf(x,z),
   cityGangProvoke/Provoked, cityGangMemberDown, cityRobStash, reset.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  let _s = 99173;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  CBZ.cityGangs = CBZ.cityGangs || [];
  let warT = 0;

  function gangColor(id) { const def = (CBZ.CITY.gangs || []).find((x) => x.id === id); return def ? def.color : 0xb079ea; }

  // ---- gang BOSS names (every gang has a named boss) ----
  const BOSS_FIRST = ["Sal", "Vince", "Marcus", "Dmitri", "Tyrone", "Eddie", "Ray", "Omar", "Carlos", "Nico"];
  const BOSS_NICK = ["Snake", "Ghost", "Scars", "Iron", "Big", "Mad", "Slick", "Cold", "Reaper", "King"];
  const BOSS_LAST = ["Romano", "Cruz", "Vega", "Petrov", "Banks", "Mensah", "Hollis", "Okoro", "Diaz", "Stone"];
  function pick(a) { return a[(rng() * a.length) | 0]; }
  function makeBossName() { return pick(BOSS_FIRST) + " '" + pick(BOSS_NICK) + "' " + pick(BOSS_LAST); }

  CBZ.spawnCityGangs = function () {
    const A = CBZ.city && CBZ.city.arena; if (!A) return;
    _s = 99173;
    CBZ.cityGangs.length = 0;
    const defs = CBZ.CITY.gangs || [];
    if (!defs.length) return;
    const aband = (A.abandonedLots || []).slice();
    if (!aband.length) return;

    // build the gang records
    const gangs = defs.map((d) => ({ ...d, turf: [], center: { x: 0, z: 0 }, provoke: 0, members: [], warWith: null, warRemain: 0 }));
    // hand each derelict to a gang, clustering by nearest existing turf so a
    // faction tends to hold a contiguous block
    aband.forEach((lot, i) => {
      const gang = gangs[i % gangs.length];
      gang.turf.push(lot);
      lot.building.gang = gang.id;
      lot.building.gangColor = gang.color;
      if (lot.building.stash) lot.building.stash.gang = gang.id;
    });
    // turf centre + member spawn
    const [lo, hi] = CBZ.CITY.gangPerTurf || [3, 6];
    const armedFrac = CBZ.CITY.gangArmedFrac != null ? CBZ.CITY.gangArmedFrac : 0.55;
    const ag = CBZ.CITY.aggro || {};
    for (const gang of gangs) {
      if (!gang.turf.length) continue;
      let sx = 0, sz = 0;
      for (const l of gang.turf) { sx += l.cx; sz += l.cz; }
      gang.center.x = sx / gang.turf.length; gang.center.z = sz / gang.turf.length;
      // ---- the gang BOSS: a named, tougher, always-armed lieutenant anchoring
      //      the crew's main turf. Defeating one is a real prize + heavy heat. ----
      {
        const blot = gang.turf[0];
        const boss = CBZ.cityMakePed(blot.cx + 1.5, blot.cz, rng, {
          kind: "gang", gang: gang.id, faction: gang.id, guard: { x: blot.cx, z: blot.cz },
          outfit: gang.color, wealth: 0.96,        // top of the ladder — rich, robbing him is a real score
          aggr: clamp(rollGang(ag) + 0.08, 0.8, 1),
          archetype: "gangster", job: "gang boss",
          armed: true, weapon: "SMG", hp: 240,     // the boss is always the most heavily strapped
          name: makeBossName(),
        });
        boss.homeGuard = { x: blot.cx, z: blot.cz };
        boss.isBoss = true; boss.rank = "boss"; boss.maxHp = 240; boss.ammo = 50;
        gang.boss = boss; gang.bossName = boss.name;
        A.root.add(boss.group);
        CBZ.cityPeds.push(boss);
        gang.members.push(boss);
      }
      // recolour this turf's graffiti hint (stash glow) toward the gang colour
      for (const lot of gang.turf) {
        if (lot.building.stash && lot.building.stash.mesh && lot.building.stash.mesh.material && lot.building.stash.mesh.material.emissive) {
          try { lot.building.stash.mesh.material.emissive.setHex(gang.color); } catch (e) {}
        }
        const n = lo + ((rng() * (hi - lo + 1)) | 0);
        for (let k = 0; k < n; k++) {
          const ang = rng() * 6.28, rad = 2.5 + rng() * 5;
          const x = lot.cx + Math.cos(ang) * rad, z = lot.cz + Math.sin(ang) * rad;
          // clear rank ladder under the boss: the first holder of each lot is a
          // LIEUTENANT (richer, SMG-capable), the rest are SOLDIERS. EVERY member
          // is strapped — guns are a city thing now, and a gang without them is nothing.
          const lt = (k === 0);
          const ped = CBZ.cityMakePed(x, z, rng, {
            kind: "gang", gang: gang.id, faction: gang.id,
            guard: { x: lot.cx, z: lot.cz },
            outfit: gang.color, wealth: lt ? 0.74 : 0.42,
            aggr: clamp(rollGang(ag), 0.6, 1),
            archetype: "gangster", job: lt ? "gang lieutenant" : "gang soldier",
            armed: true, weapon: lt ? (rng() < 0.5 ? "SMG" : "Pistol") : "Pistol",
            hp: lt ? 160 : 120,
            name: gang.name.split(" ")[0] + " " + (lt ? "Lt." : (rng() < 0.5 ? "OG" : "Soldier")),
          });
          ped.rank = lt ? "lt" : "soldier";
          ped.ammo = lt ? 40 : 30;
          ped.homeGuard = { x: lot.cx, z: lot.cz };
          if (ped.tag && ped.tag.material) { /* tag colour is baked; leave default */ }
          A.root.add(ped.group);
          CBZ.cityPeds.push(ped);
          gang.members.push(ped);
        }
      }
      CBZ.cityGangs.push(gang);
    }
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rollGang(ag) { const r = (rng() + rng()) / 2; return (ag.meanGang != null ? ag.meanGang : 0.8) + (r - 0.5) * 2 * (ag.spreadGang || 0.14); }

  function gangById(id) { return CBZ.cityGangs.find((x) => x.id === id); }

  function launchWar(a, b) {
    if (!a || !b || a === b || !b.turf.length) return 0;
    if (a.isPlayer) return 0;   // your gang only raids on YOUR orders, never on its own
    const targetLot = b.turf[(rng() * b.turf.length) | 0];
    const count = 2 + ((rng() * 3) | 0);
    let sent = 0;
    for (const m of a.members) {
      if (sent >= count) break;
      if (m.dead || m.rage || m.inCar || m.raidT > 0) continue;
      m.homeGuard = m.homeGuard || m.guard;
      m.guard = { x: targetLot.cx, z: targetLot.cz };
      m.target.set(targetLot.cx + (rng() - 0.5) * 5, 0, targetLot.cz + (rng() - 0.5) * 5);
      m.pause = 0; m.path = null; m.raidT = 22 + rng() * 12; m.raidGang = b.id;
      sent++;
    }
    if (sent) {
      a.warWith = b.id; b.warWith = a.id;
      a.warRemain = b.warRemain = 26 + rng() * 14;
      CBZ.city && CBZ.city.note("Gang war: " + a.name + " raid " + b.name + " turf.", 2.4);
      // raiding YOUR block? rally your gang to defend it
      if (b.isPlayer && CBZ.cityPlayerGangDefendTurf) {
        CBZ.cityPlayerGangDefendTurf(targetLot.cx, targetLot.cz);
        CBZ.city && CBZ.city.big("⚠ " + a.name + " RAIDING YOUR TURF");
      }
    }
    return sent;
  }
  CBZ.cityStartGangWar = launchWar;

  // which gang's turf is (x,z) inside? returns the gang record or null
  CBZ.cityGangOf = function (x, z) {
    let best = null, bd = 14 * 14;
    for (const gang of CBZ.cityGangs) for (const lot of gang.turf) {
      const dd = (lot.cx - x) * (lot.cx - x) + (lot.cz - z) * (lot.cz - z);
      if (dd < bd) { bd = dd; best = gang; }
    }
    return best;
  };

  CBZ.cityGangProvoke = function (id, amount) { const gang = gangById(id); if (gang) gang.provoke = Math.min(1, gang.provoke + (amount || 0.3)); };
  CBZ.cityGangProvoked = function (id) { const gang = gangById(id); return gang ? gang.provoke : 0; };

  // a member went down — the crew takes it personally
  CBZ.cityGangMemberDown = function (ped, imp) {
    const gang = gangById(ped.gang); if (!gang) return;
    const byPlayer = !imp || imp.byPlayer !== false;
    gang.provoke = Math.min(1, gang.provoke + (byPlayer ? 0.5 : 0.25));
    if (byPlayer) { CBZ.city && CBZ.city.addRespect(3); }
    // the BOSS going down to the player is a takeover opportunity — the player
    // can CLAIM the crew (city/playergang.js). Only the kingpin's death counts.
    if ((ped.isBoss || ped.rank === "boss" || ped === gang.boss) && byPlayer && !gang.isPlayer) {
      gang.bossDead = true;
      if (CBZ.cityPlayerGangBossKilled) CBZ.cityPlayerGangBossKilled(gang);
      CBZ.city && CBZ.city.addRespect(20);
    }
  };

  // expose a lookup so the player-gang hub can find a rival by id/record
  CBZ.cityGangById = gangById;

  // ---- rob a gang's stash (interact.js [I] near the stash duffel) ----
  CBZ.cityRobStash = function (lot) {
    const st = lot && lot.building && lot.building.stash;
    if (!st || st.looted) { CBZ.city && CBZ.city.note("Nothing left here.", 1.4); return; }
    st.looted = true;
    const econ = CBZ.cityEcon;
    if (st.cash > 0) CBZ.city.addCash(st.cash);
    if (econ && st.drugs > 0) econ.add(rng() < 0.5 ? "Coke" : "Meth", st.drugs);
    if (st.weapon && econ) econ.add(st.weapon, 1);
    if (st.mesh && st.mesh.material && st.mesh.material.color) try { st.mesh.material.color.setHex(0x202020); } catch (e) {}
    CBZ.city.addRespect(8);
    CBZ.city.big("STASH ROBBED + $" + st.cash);
    if (CBZ.sfx) CBZ.sfx("coin");
    // the whole gang knows + the cops get a tip
    if (st.gang) CBZ.cityGangProvoke(st.gang, 1);
    CBZ.cityAlarm && CBZ.cityAlarm(lot.cx, lot.cz, 28, 1.6);
    CBZ.cityCrime && CBZ.cityCrime(70, { x: lot.cx, z: lot.cz, type: "burglary" });
  };

  CBZ.cityNearestStash = function (x, z, maxd) {
    let best = null, bd = (maxd || 4) * (maxd || 4);
    for (const gang of CBZ.cityGangs) for (const lot of gang.turf) {
      const st = lot.building.stash; if (!st || st.looted) continue;
      const dd = (st.x - x) * (st.x - x) + (st.z - z) * (st.z - z);
      if (dd < bd) { bd = dd; best = lot; }
    }
    return best;
  };

  CBZ.cityGangsReset = function () {
    CBZ.cityGangs.length = 0; warT = 0;
    // stashes persist on the building metadata — un-loot them for a fresh run
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.abandonedLots) for (const lot of A.abandonedLots) {
      const st = lot.building && lot.building.stash;
      if (st) { st.looted = false; if (st.mesh && st.mesh.material && st.mesh.material.color) try { st.mesh.material.color.setHex(0x2a2f26); } catch (e) {} }
    }
  };

  // ---- provoke decay + a light gang-war director ----
  CBZ.onUpdate(34.5, function (dt) {
    if (g.mode !== "city") return;
    for (const gang of CBZ.cityGangs) {
      if (gang.provoke > 0) gang.provoke = Math.max(0, gang.provoke - dt * 0.03);
      if (gang.warRemain > 0) {
        gang.warRemain -= dt;
        if (gang.warRemain <= 0) gang.warWith = null;
      }
      for (const m of gang.members) {
        if (!(m.raidT > 0)) continue;
        m.raidT -= dt;
        if (m.raidT <= 0 && m.homeGuard && !m.dead) {
          m.guard = { x: m.homeGuard.x, z: m.homeGuard.z };
          m.target.set(m.guard.x, 0, m.guard.z); m.pause = 0; m.path = null; m.raidGang = null;
        }
      }
    }
    warT -= dt;
    if (warT <= 0) {
      warT = 24 + rng() * 18;
      const live = CBZ.cityGangs.filter((x) => x.members.some((m) => !m.dead));
      if (live.length >= 2) {
        const a = live[(rng() * live.length) | 0];
        const rivals = live.filter((x) => x !== a);
        const b = rivals[(rng() * rivals.length) | 0];
        launchWar(a, b);
      }
    }
  });
})();
