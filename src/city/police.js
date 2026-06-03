/* ============================================================
   city/police.js — the POLICE, now a real force that polices the whole
   city, not just you.

   • An ambient patrol roams even at 0 player-stars, so the streets are
     actually policed: they chase NPC offenders (muggers, brawlers,
     rampaging "infinite-power" peds, carjackers), conduct traffic STOPS
     on red-light runners, and arrest or shoot suspects.
   • Player wanted (city/wanted.js) layers MORE cops on top, who hunt you
     toward your last-known position and cuff you (→ jail) or open fire.
   • Cops can be DISARMED: a downed officer drops their gun, which the
     player — or a bold enough ped — can snatch.

   Targets are chosen by threat: each cop locks the nearest high-priority
   offender (you or an NPC). cop.npcTarget points at the ped it's hunting
   (city/peds.js reads it so the suspect flees or fights back).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const { makeCharacter, animChar, lerpAngle } = CBZ;
  const g = CBZ.game;
  const tmp = new THREE.Vector3();

  const COP_R = 0.5, ANIM_D2 = 70 * 70;
  let frame = 0, maintainT = 0;
  let _s = 314159;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  const carSuspects = [];     // fleeing cars the police are after

  function makeCop(x, z, swat, ambient) {
    const ch = makeCharacter({
      legs: swat ? 0x23262c : 0x1b2a44, torso: swat ? 0x2b2f36 : 0x24407a,
      collar: swat ? 0x14161a : 0x16264a, arms: swat ? 0x2b2f36 : 0x24407a,
      skin: 0xe8b58c, hair: 0x101820, shoes: 0x101216,
    });
    ch.group.position.set(x, 0, z);
    const tag = CBZ.makeLabelSprite ? CBZ.makeLabelSprite(swat ? "SWAT" : "POLICE", { color: "#7fd0ff" }) : null;
    if (tag) { tag.position.y = 3.0; tag.scale.set(2.6, 0.7, 1); ch.group.add(tag); }
    const cop = {
      char: ch, group: ch.group, pos: ch.group.position, name: swat ? "SWAT" : "Officer",
      kind: "cop", swat: !!swat, ambient: !!ambient, hp: swat ? 160 : 110, dead: false, deadT: 0,
      baseSpeed: swat ? 5.2 : 4.6, speed: 0, state: "patrol", sees: false,
      shootCD: 0.6 + rng() * 0.6, arrestT: 0, slice: (rng() * 6) | 0, tag, isPlayer: false,
      npcTarget: null, patrolGoal: null, retarget: 0, armed: true, weapon: swat ? "SMG" : "Pistol",
    };
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(cop);
    return cop;
  }

  function spawnCop(swat, ambient) {
    const A = CBZ.city.arena; if (!A) return;
    const P = CBZ.player;
    let x, z, tries = 0;
    do { const p = A.randomRoadPoint(); x = p.x; z = p.z; tries++; } while (tries < 8 && !ambient && Math.hypot(x - P.pos.x, z - P.pos.z) < 24);
    const c = makeCop(x, z, swat, ambient);
    A.root.add(c.group);
    CBZ.cityCops.push(c);
    return c;
  }

  // spawn a cop at a specific spot (used by the car-biz police RAID in empire.js)
  CBZ.citySpawnCop = function (x, z, swat) {
    const A = CBZ.city.arena; if (!A) return null;
    const c = makeCop(x + (rng() - 0.5) * 5, z + (rng() - 0.5) * 5, !!swat, false);
    A.root.add(c.group); CBZ.cityCops.push(c);
    return c;
  };

  CBZ.clearCityCops = function () {
    for (const c of CBZ.cityCops) {
      if (c.group && c.group.parent) c.group.parent.remove(c.group);
      if (c.group) c.group.traverse(function (o) {
        if (o.isSprite) return;     // sprites share an r128 geometry singleton — never dispose
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) try { o.geometry.dispose(); } catch (e) {}
        if (o.material) { const m = o.material; if (Array.isArray(m)) m.forEach((x) => x && !x._shared && x.dispose && x.dispose()); else if (!m._shared && m.dispose) m.dispose(); }
      });
    }
    CBZ.cityCops.length = 0;
    carSuspects.length = 0;
  };

  function liveCops() { let n = 0; for (const c of CBZ.cityCops) if (!c.dead) n++; return n; }
  function liveAmbient() { let n = 0; for (const c of CBZ.cityCops) if (!c.dead && c.ambient) n++; return n; }

  // ---- NPC offender registry (the city polices its own) -------------------
  CBZ.cityNpcOffense = function (ped, heat, type) {
    if (!ped || ped.dead || ped.isPlayer) return;
    ped.npcHeat = (ped.npcHeat || 0) + (heat || 10);
    ped.npcWanted = ped.npcHeat > 130 ? 3 : ped.npcHeat > 60 ? 2 : ped.npcHeat > 22 ? 1 : 0;
  };
  CBZ.cityRegisterCarSuspect = function (car) { if (car && carSuspects.indexOf(car) < 0) carSuspects.push(car); };
  CBZ.cityNpcArrest = function (ped) {
    if (!ped || ped.dead) return;
    ped.npcHeat = 0; ped.npcWanted = 0; ped.rage = null; ped.armed = false; ped.weapon = null;
    ped.ko = 4; ped.alarmed = 0;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    if (CBZ.body) CBZ.body.hit(ped, { dir: { x: 0, z: 1 }, force: 3, knockdown: 1.2 });
  };

  function offenderCount() { let n = 0; for (const p of CBZ.cityPeds) if (!p.dead && (p.npcWanted | 0) >= 1) n++; return n; }

  // damage a cop; killing one spikes player heat + drops the cop's gun
  CBZ.cityHurtCop = function (cop, dmg, imp) {
    if (!cop || cop.dead) return;
    cop.hp -= dmg;
    if (cop.hp <= 0) {
      cop.dead = true; cop.deadT = 0;
      if (CBZ.cityDropWeapon) CBZ.cityDropWeapon(cop.pos.x, cop.pos.z, cop.swat ? "SMG" : "Pistol", 30);   // disarmed
      cop.armed = false; cop.weapon = null;
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(cop);
      if (CBZ.gore) { let dir = imp && imp.fromX != null ? { x: cop.pos.x - imp.fromX, z: cop.pos.z - imp.fromZ } : null; CBZ.gore(cop.pos.x, cop.pos.y + 1.0, cop.pos.z, { dir, amount: 1.1, player: false }); }
      if (CBZ.body) { if (imp && imp.fromX != null) CBZ.body.hit(cop, { fromX: imp.fromX, fromZ: imp.fromZ, force: 8, fling: 5 }); else CBZ.body.hit(cop, { dir: { x: rng() - 0.5, z: rng() - 0.5 }, force: 4, fling: 5 }); }
      // who killed the officer? player → automatic 5 stars; another NPC → that
      // NPC's offense; a cop / driverless car → nobody is charged.
      const att = imp && imp.attacker && imp.attacker.pos ? imp.attacker : null;
      const byPlayer = imp ? imp.byPlayer !== false : true;
      if (att && att !== CBZ.city.playerActor) { if (att.kind !== "cop" && CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, 140, "cop-killer"); }
      else if (byPlayer) {
        CBZ.city && CBZ.city.addKill();
        CBZ.city && CBZ.city.addRespect(8);
        if (CBZ.cityCopKilled) CBZ.cityCopKilled();          // → 5 stars, instantly
        else if (CBZ.cityCrime) CBZ.cityCrime(120, { instant: true, x: cop.pos.x, z: cop.pos.z, type: "cop-kill" });
      }
      if (CBZ.pushKill) CBZ.pushKill("An officer was killed", "#ff6b6b");
    } else if (CBZ.body && imp && imp.fromX != null) CBZ.body.hit(cop, { fromX: imp.fromX, fromZ: imp.fromZ, force: 3 });
  };

  // ---- maintain the right number of cops --------------------------------
  function maintain(dt) {
    maintainT -= dt;
    if (maintainT > 0) return;
    maintainT = 1.1;
    const ambientWant = CBZ.CITY.ambientCops || 0;
    const playerWant = g.cityCopTarget || 0;
    const offenders = offenderCount() + carSuspects.length;
    const total = ambientWant + playerWant + Math.min(6, offenders);
    const have = liveCops();
    if (have < total) { const swat = (g.wanted | 0) >= 4; spawnCop(swat, liveAmbient() < ambientWant); if (have + 1 < total) spawnCop(swat, false); }
    else if (have > total) {
      // retire surplus non-ambient cops when the heat is gone
      for (const c of CBZ.cityCops) if (!c.dead && !c.ambient && !c.npcTarget && (g.wanted | 0) === 0) { c.giveUp = true; break; }
    }
  }

  // pick the best target for a cop: the player (if wanted) or an NPC offender
  function chooseTarget(cop) {
    let best = null, bestScore = -1, bestPed = null;
    const cp = cop.pos;
    if ((g.wanted | 0) >= 1 && !CBZ.player.dead) {
      const d = Math.hypot(cp.x - CBZ.player.pos.x, cp.z - CBZ.player.pos.z);
      const sc = (g.wanted | 0) * 30 - d * 0.5;
      if (sc > bestScore) { bestScore = sc; best = CBZ.city.playerActor; bestPed = null; }
    }
    for (const p of CBZ.cityPeds) {
      if (p.dead || (p.npcWanted | 0) < 1) continue;
      const d = Math.hypot(cp.x - p.pos.x, cp.z - p.pos.z);
      if (d > 60) continue;
      const sc = (p.npcWanted | 0) * 24 + (p.armed ? 12 : 0) - d * 0.6;
      if (sc > bestScore) { bestScore = sc; best = p; bestPed = p; }
    }
    cop.npcTarget = bestPed;
    return best;
  }

  // ---- per-frame update --------------------------------------------------
  CBZ.onUpdate(35, function (dt) {
    if (g.mode !== "city") return;
    if (g.state === "playing") maintain(dt);
    frame++;
    // prune dead/lost car suspects
    for (let i = carSuspects.length - 1; i >= 0; i--) { const c = carSuspects[i]; if (!c || c.dead || c.pullover !== 4) carSuspects.splice(i, 1); }

    const P = CBZ.player, camx = CBZ.camera.position.x, camz = CBZ.camera.position.z;
    const stars = g.wanted | 0;
    const A = CBZ.city.arena;
    const cops = CBZ.cityCops;
    for (let i = cops.length - 1; i >= 0; i--) {
      const c = cops[i];
      if (c.dead) {
        if (c.tag) c.tag.visible = false;
        c.deadT += dt;
        if (c.deadT > 8 && !c.culled) { c.culled = true; if (c.group.parent) c.group.parent.remove(c.group); cops.splice(i, 1); }
        continue;
      }
      if (CBZ.body && CBZ.body.busy && CBZ.body.busy(c)) { c.sees = false; continue; }
      if (c.retarget > 0) c.retarget -= dt;
      if (c.shootCD > 0) c.shootCD -= dt;

      // (re)choose a target periodically
      if (c.retarget <= 0) { c.retarget = 0.6; c.curTarget = chooseTarget(c); }
      let tgt = c.curTarget;
      // a car suspect overrides if one is near + this cop is free
      if (!c.npcTarget && (!tgt || tgt === CBZ.city.playerActor && stars === 0)) {
        const cs = nearestCarSuspect(c.pos);
        if (cs) c.chaseCar = cs; else c.chaseCar = null;
      } else c.chaseCar = null;

      const near = (c.pos.x - camx) * (c.pos.x - camx) + (c.pos.z - camz) * (c.pos.z - camz) < ANIM_D2;

      // ---- behaviour ----
      if (c.giveUp) {
        c.state = "leave";
        if (frame % 240 === 0 && rng() < 0.5) { if (c.group.parent) c.group.parent.remove(c.group); cops.splice(i, 1); continue; }
        const gx = A.minX - 18 - c.pos.x, gz = 0; stepTo(c, gx, gz, c.baseSpeed, dt, near); continue;
      }

      // chase a fleeing car
      if (c.chaseCar && !tgt) {
        const car = c.chaseCar;
        const gx = car.pos.x - c.pos.x, gz = car.pos.z - c.pos.z, gd = Math.hypot(gx, gz);
        if (gd < 3.2) { /* vehicles.js busts it on contact */ }
        stepTo(c, gx, gz, c.baseSpeed, dt, near);
        continue;
      }

      // hunting an offender (player or NPC)
      if (tgt && !tgt.dead) {
        const isPlayer = tgt === CBZ.city.playerActor;
        const tx = tgt.pos.x, tz = tgt.pos.z;
        const dx = tx - c.pos.x, dz = tz - c.pos.z, dist = Math.hypot(dx, dz);
        c.sees = dist < 48;
        if (c.sees && isPlayer) g.cityLastKnown = { x: tx, z: tz, t: CBZ.now };

        const npcThreat = !isPlayer && (tgt.armed || tgt.aggr >= 0.85 || (tgt.npcWanted | 0) >= 2);
        const wantArrest = isPlayer ? (stars <= 2 && !P.driving) : !npcThreat;
        const wantShoot = isPlayer ? stars >= 2 : npcThreat;

        // ARREST: close in and cuff
        if (wantArrest && c.sees && dist < 1.9) {
          if (isPlayer) {
            if (P.speed < 2.4 && !P._fighting) { c.arrestT += dt; c.speed = 0; if (c.arrestT > 1.0) { CBZ.cityBust && CBZ.cityBust(); return; } if (near) animChar(c.char, 0, dt); continue; }
            else c.arrestT = 0;
          } else { c.arrestT += dt; c.speed = 0; if (c.arrestT > 0.8) { CBZ.cityNpcArrest(tgt); c.npcTarget = null; c.curTarget = null; } if (near) animChar(c.char, 0, dt); continue; }
        } else c.arrestT = 0;

        // SHOOT
        if (wantShoot && c.sees && dist < 30) {
          if (c.shootCD <= 0) { c.shootCD = (c.swat ? 0.16 : 0.5) + rng() * 0.3; fireAt(c, tgt, dist); }
        }

        const stop = (wantShoot && dist < (isPlayer ? (stars >= 3 ? 9 : 4) : 8)) ? (isPlayer && stars >= 3 ? 8 : 5) : 1.5;
        if (dist > stop) stepTo(c, dx, dz, c.baseSpeed, dt, near);
        else { c.speed = 0; c.group.rotation.y = lerpAngle(c.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.002, dt)); if (near) animChar(c.char, 0, dt); finalizeMove(c); }
        continue;
      }

      // ---- patrol (ambient, no target) ----
      c.sees = false; c.npcTarget = null;
      if (!c.patrolGoal || Math.hypot(c.pos.x - c.patrolGoal.x, c.pos.z - c.patrolGoal.z) < 4) { const rp = A.randomRoadPoint(); c.patrolGoal = { x: rp.x, z: rp.z }; }
      stepTo(c, c.patrolGoal.x - c.pos.x, c.patrolGoal.z - c.pos.z, c.baseSpeed * 0.6, dt, near);
    }
  });

  function nearestCarSuspect(pos) {
    let best = null, bd = 70 * 70;
    for (const c of carSuspects) { const dd = (c.pos.x - pos.x) * (c.pos.x - pos.x) + (c.pos.z - pos.z) * (c.pos.z - pos.z); if (dd < bd) { bd = dd; best = c; } }
    return best;
  }

  function stepTo(c, dx, dz, spd, dt, near) {
    const gd = Math.hypot(dx, dz) || 1;
    c.pos.x += (dx / gd) * spd * dt;
    c.pos.z += (dz / gd) * spd * dt;
    c.group.rotation.y = lerpAngle(c.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0008, dt));
    c.speed = spd;
    finalizeMove(c);
    if (near) animChar(c.char, c.speed, dt);
  }
  function finalizeMove(c) {
    if (CBZ.collide) CBZ.collide(c.pos, COP_R, c.pos.y, c.pos.y + 1.7);
    if (CBZ.city.arena) CBZ.city.arena.clampToCity(c.pos, COP_R);
    c.pos.y = 0;
  }

  function fireAt(c, tgt, dist) {
    if (CBZ.actorAimAt) CBZ.actorAimAt(c, tgt);
    const from = CBZ.actorMuzzle ? CBZ.actorMuzzle(c, tmp) : { x: c.pos.x, y: 1.4, z: c.pos.z };
    if (CBZ.tracer) CBZ.tracer(from, { x: tgt.pos.x, y: (tgt.isPlayer ? 1.55 : 1.3), z: tgt.pos.z }, { muzzleScale: c.swat ? 1.15 : 0.95 });
    if (CBZ.sfx) CBZ.sfx("report");
    const hitP = Math.max(0.18, 0.85 - dist * 0.02 - (tgt.isPlayer && CBZ.player.sprint ? 0.18 : 0));
    if (Math.random() >= hitP) return;
    let dmg = (c.swat ? 10 : 7) + Math.random() * 5;
    if (tgt.isPlayer) {
      if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, c.pos.x, c.pos.z, "gunned down by police", Math.random() < 0.012, c.swat ? "a SWAT officer" : "the police");
    } else {
      tgt.hp -= dmg;
      if (tgt.hp <= 0) CBZ.cityKillPed && CBZ.cityKillPed(tgt, { fromX: c.pos.x, fromZ: c.pos.z, attacker: c, byPlayer: false, force: 5, fling: 4 }, "shot by police");
      else if (CBZ.body) CBZ.body.hit(tgt, { fromX: c.pos.x, fromZ: c.pos.z, force: 3 });
    }
  }

  CBZ.citySpawnCop = spawnCop;
})();
