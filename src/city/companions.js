/* ============================================================================
   companions.js — tamed-animal companion defense (trait-derived dispositions)
   ----------------------------------------------------------------------------
   PHILOSOPHY: no per-species switch statements. A companion's combat
   disposition is COMPUTED from the traits every species already carries
   (danger, bite, scale) — so a tamed dog or polar bear fights for you, a
   tamed horse or deer bolts, and a tamed bison plants itself between you and
   trouble... and any NEW species added to CBZ.WILDLIFE_SPECIES later slots
   into the right behavior automatically, with zero edits here.

     GUARDIAN  — real predator (dangerous + strong bite + not tiny), or a dog
                 (dogs are pack-bonded guardians regardless of stats). Seeks
                 out threats to its owner and fights them, but breaks off and
                 retreats when badly wounded or hopelessly out-scaled.
     SKITTISH  — prey animal (low danger). Never fights. Bolts to the owner's
                 side and past it, directly away from the threat.
     BRUISER   — dangerous herbivore (mid danger, no hunter's bite). Holds
                 defensively near the owner and only charges/gores a threat
                 that gets too close, then falls back. Doesn't hunt.

   Movement handoff: while this file is actively driving an animal it sets
   a.companionBusy=true (wildlife_tame.js yields to that flag) and clears it
   the moment normal calm-follow should resume.
   ============================================================================ */
(function () {
  "use strict";
  var CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;

  /* ------------------------- tunable trait thresholds ---------------------- */
  var GUARDIAN_DANGER = 0.45; // at/above: dangerous enough to be a hunter
  var GUARDIAN_BITE   = 12;   // at/above: a real predator's bite
  var GUARDIAN_MIN_SCALE = 0.5; // below this the "predator" is too tiny to guard
  var SKITTISH_DANGER = 0.2;  // below: pure prey — flees, never fights
  // BRUISER band: SKITTISH_DANGER <= danger < GUARDIAN_DANGER (tough herbivore)

  var SENSE_RADIUS   = 28;    // threat detection radius around owner/companion
  var GUARD_LEASH    = 40;    // guardian won't chase further than this from owner
  var BRUISER_TRIGGER = 6;    // bruiser interposes when threat within this of owner/self
  var BRUISER_LEASH  = 11;    // bruiser breaks its charge beyond this from owner
  var RETREAT_HP_FRAC = 0.3;  // guardian breaks off below this hp fraction
  var OUTSCALE_RATIO = 1.7;   // predator threat this much bigger => don't suicide
  var FLEE_SPEED_MUL = 1.6;   // skittish bolt multiplier
  var SAFE_RESUME    = 34;    // skittish considers itself safe past this distance
  var RETURN_DMG_PERIOD = 0.9; // how often a melee-range threat hurts the companion

  var noteCooldown = 0;

  /* --------------------------- disposition (the heart) --------------------- */
  function disposition(a) {
    var s = a && a.species;
    if (!s) return "skittish";
    if (s.id === "dog") return "guardian"; // dogs are always guardians
    var danger = +s.danger || 0, bite = +s.bite || 0, scale = +s.scale || 1;
    if (danger >= GUARDIAN_DANGER && bite >= GUARDIAN_BITE && scale >= GUARDIAN_MIN_SCALE)
      return "guardian"; // bears, big cats, wolves...
    if (danger < SKITTISH_DANGER)
      return "skittish"; // horse, deer, rabbit, sheep, zebra, giraffe...
    if (danger < GUARDIAN_DANGER)
      return "bruiser"; // bison, rhino, elephant, boar, moose, bighorn...
    // dangerous but weak-jawed or tiny: big => defensive bruiser, small => flees
    return scale >= 1 ? "bruiser" : "skittish";
  }

  /* ------------------------------- helpers --------------------------------- */
  function dist2(ax, az, bx, bz) { var dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

  function actorPos(p) {
    return p.pos || (p.group && p.group.position) || null;
  }

  function alive(p) {
    if (!p || p.dead) return false;
    if (p.hp != null && p.hp <= 0) return false;
    return true;
  }

  function wantedLevel() {
    var g = CBZ.g || CBZ.city || CBZ;
    return (g && g.wanted) | 0;
  }

  function isHostilePerson(p) {
    if (!alive(p)) return false;
    var owner = CBZ.city && CBZ.city.playerActor;
    if (p.rage && owner && p.rage === owner) return true;
    if (p.state === "fight") return true;
    if (p.kind === "cop" && wantedLevel() > 0) return true;
    return false;
  }

  function isChargingPredator(w) {
    return alive(w) && !w.tamed && w.state === "charge" &&
      w.species && w.species.danger >= 0.5;
  }

  // Nearest active threat within SENSE_RADIUS of the owner OR the companion.
  function findThreat(a, ownerPos) {
    var best = null, bestD = SENSE_RADIUS * SENSE_RADIUS;
    var ax = a.pos.x, az = a.pos.z, ox = ownerPos.x, oz = ownerPos.z;
    function consider(p) {
      var pp = actorPos(p);
      if (!pp) return;
      var d = Math.min(dist2(pp.x, pp.z, ox, oz), dist2(pp.x, pp.z, ax, az));
      if (d < bestD) { bestD = d; best = p; }
    }
    var i, arr;
    arr = CBZ.cityPeds;
    if (arr && arr.length) for (i = 0; i < arr.length; i++) if (isHostilePerson(arr[i])) consider(arr[i]);
    arr = CBZ.cityCops;
    if (arr && arr.length) for (i = 0; i < arr.length; i++) if (isHostilePerson(arr[i])) consider(arr[i]);
    arr = CBZ.cityWildlife;
    if (arr && arr.length) for (i = 0; i < arr.length; i++) {
      if (arr[i] !== a && isChargingPredator(arr[i])) consider(arr[i]);
    }
    return best;
  }

  function threatStillValid(a, t, ownerPos) {
    if (!t || !alive(t)) return false;
    var pp = actorPos(t);
    if (!pp) return false;
    var lim = (SENSE_RADIUS + 8); lim *= lim;
    if (dist2(pp.x, pp.z, ownerPos.x, ownerPos.z) > lim &&
        dist2(pp.x, pp.z, a.pos.x, a.pos.z) > lim) return false;
    if (t.species) return isChargingPredator(t) || t.state === "fight";
    return isHostilePerson(t);
  }

  // Manually steer an animal (used for flee/retreat/reposition).
  function drive(a, dirX, dirZ, speed, dt) {
    var len = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (len < 1e-4) return;
    dirX /= len; dirZ /= len;
    a.heading = Math.atan2(dirZ, dirX);
    a.pos.x += dirX * speed * dt;
    a.pos.z += dirZ * speed * dt;
    if (CBZ.floorAt) {
      var y = CBZ.floorAt(a.pos.x, a.pos.z);
      if (y != null && isFinite(y)) a.pos.y = y;
    }
    faceHeading(a);
  }

  function faceHeading(a) {
    a.faceH = a.heading;
    if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(a, a.heading);
    else if (a.group) a.group.rotation.y = -a.heading;
  }

  function baseSpeed(a) {
    return (a.species && +a.species.spd) || 4;
  }

  /* ----------------------- damage plumbing (via combat opts) --------------- */
  function hurtThreat(a, t, dmg) {
    if (!t || t.dead) return;
    var fx = a.pos.x, fz = a.pos.z;
    if (t.species) { // an animal threat
      if (CBZ.cityWildlifeHit) CBZ.cityWildlifeHit(t, { head: false, point: null }, { damage: dmg });
      else t.hp = (t.hp == null ? (t.maxHp || 50) : t.hp) - dmg;
      return;
    }
    if (t.kind === "cop") {
      if (CBZ.cityHurtCop) CBZ.cityHurtCop(t, dmg, { fromX: fx, fromZ: fz });
    } else {
      t.hp = (t.hp == null ? (t.maxHp || 100) : t.hp) - dmg;
      if (t.hp <= 0 && CBZ.cityKillPed) {
        CBZ.cityKillPed(t, { fromX: fx, fromZ: fz, force: 5 }, "mauled");
      } else {
        t.rage = t.rage || (CBZ.city && CBZ.city.playerActor);
        t.state = "fight";
      }
    }
    if (CBZ.body && CBZ.body.hit) CBZ.body.hit(t, { fromX: fx, fromZ: fz, force: 4 });
  }

  // Realistic return damage: a threat in melee range chews on the companion.
  function takeReturnDamage(a, t, dt) {
    var pp = actorPos(t);
    if (!pp) return;
    var reach = 2.4 + ((t.species && t.species.scale) || 1) * 0.8;
    if (dist2(pp.x, pp.z, a.pos.x, a.pos.z) > reach * reach) { a.companionHurtT = 0; return; }
    a.companionHurtT = (a.companionHurtT || 0) + dt;
    if (a.companionHurtT < RETURN_DMG_PERIOD) return;
    a.companionHurtT = 0;
    var dmg = t.species ? Math.max(3, ((+t.species.bite) || 10) * 0.6) : 4;
    if (CBZ.cityWildlifeHit) {
      CBZ.cityWildlifeHit(a, { head: false, point: null }, { damage: dmg });
    } else {
      a.hp = (a.hp == null ? (a.maxHp || 50) : a.hp) - dmg;
      if (a.hp <= 0) a.dead = true;
    }
    if (CBZ.creatureFlinch) CBZ.creatureFlinch(a);
  }

  /* ------------------------------- behaviors ------------------------------- */
  function fightOpts(a, t) {
    var sp = a.species || {};
    return {
      dmg: Math.max(4, (+sp.bite) || 8),
      onHit: function (dmg) { hurtThreat(a, t, dmg == null ? Math.max(4, (+sp.bite) || 8) : dmg); },
      onDown: function () {
        a.companionTarget = null;
        if (noteCooldown <= 0 && CBZ.city && CBZ.city.note) {
          CBZ.city.note((a.petName || (a.species && a.species.name) || "Your companion") + " took down the threat.", 2);
          noteCooldown = 12;
        }
      }
    };
  }

  function shouldBreakOff(a, t) {
    var frac = (a.maxHp > 0) ? (a.hp / a.maxHp) : 1;
    if (frac < RETREAT_HP_FRAC) return true;
    if (t && t.species && t.species.danger >= GUARDIAN_DANGER) {
      var mine = (a.species && +a.species.scale) || 1;
      if ((+t.species.scale || 1) > mine * OUTSCALE_RATIO) return true; // dog vs bear
    }
    return false;
  }

  function retreatToOwner(a, ownerPos, dt) {
    var dx = ownerPos.x - a.pos.x, dz = ownerPos.z - a.pos.z;
    if (dx * dx + dz * dz < 9) { faceHeading(a); return true; } // reached owner's side
    drive(a, dx, dz, baseSpeed(a) * 1.15, dt);
    return false;
  }

  function guardianTick(a, t, ownerPos, dt) {
    var op = actorPos(t);
    if (a.companionState !== "retreat" && shouldBreakOff(a, t)) {
      a.companionState = "retreat";
      if (noteCooldown <= 0 && CBZ.city && CBZ.city.note) {
        CBZ.city.note((a.petName || (a.species && a.species.name) || "Your companion") + " backs off, wounded!", 2);
        noteCooldown = 12;
      }
    }
    if (a.companionState === "retreat") {
      a.companionBusy = true;
      if (retreatToOwner(a, ownerPos, dt)) a.companionState = "guard";
      return;
    }
    // leash: don't chase across the map
    if (op && dist2(op.x, op.z, ownerPos.x, ownerPos.z) > GUARD_LEASH * GUARD_LEASH) {
      a.companionBusy = true;
      retreatToOwner(a, ownerPos, dt);
      return;
    }
    a.companionState = "fight";
    a.companionBusy = true;
    if (CBZ.creatureFight) CBZ.creatureFight(a, t, dt, fightOpts(a, t));
    faceHeading(a);
    takeReturnDamage(a, t, dt);
  }

  function skittishTick(a, t, ownerPos, dt) {
    var op = actorPos(t);
    if (!op) return;
    // Flee vector: away from the threat, biased through the owner's position
    // so the bolting horse runs to your side and PAST you, not off alone.
    var awayX = a.pos.x - op.x, awayZ = a.pos.z - op.z;
    var toOwnerX = ownerPos.x - a.pos.x, toOwnerZ = ownerPos.z - a.pos.z;
    var dOwn = Math.sqrt(toOwnerX * toOwnerX + toOwnerZ * toOwnerZ);
    var la = Math.sqrt(awayX * awayX + awayZ * awayZ) || 1;
    awayX /= la; awayZ /= la;
    var fx = awayX, fz = awayZ;
    if (dOwn > 5) { // still far from the owner: cut toward them while escaping
      toOwnerX /= dOwn; toOwnerZ /= dOwn;
      fx = awayX * 0.6 + toOwnerX * 0.4;
      fz = awayZ * 0.6 + toOwnerZ * 0.4;
    }
    a.companionState = "flee";
    a.companionBusy = true;
    drive(a, fx, fz, baseSpeed(a) * FLEE_SPEED_MUL, dt);
    // Safe again? resume normal follow next frame.
    var dSelf = dist2(op.x, op.z, a.pos.x, a.pos.z);
    var dOwner = dist2(op.x, op.z, ownerPos.x, ownerPos.z);
    if (Math.min(dSelf, dOwner) > SAFE_RESUME * SAFE_RESUME) {
      a.companionState = "idle";
      a.companionBusy = false;
    }
  }

  function bruiserTick(a, t, ownerPos, dt) {
    var op = actorPos(t);
    if (!op) return;
    var trig = BRUISER_TRIGGER * BRUISER_TRIGGER;
    var close = dist2(op.x, op.z, ownerPos.x, ownerPos.z) < trig ||
                dist2(op.x, op.z, a.pos.x, a.pos.z) < trig;
    var farFromOwner = dist2(a.pos.x, a.pos.z, ownerPos.x, ownerPos.z) > BRUISER_LEASH * BRUISER_LEASH;

    if (a.companionState === "interpose" && (farFromOwner || !close)) {
      a.companionState = "fallback"; // charge burst over — return to the owner
    }
    if (a.companionState === "fallback") {
      a.companionBusy = true;
      if (retreatToOwner(a, ownerPos, dt)) { a.companionState = "idle"; a.companionBusy = false; }
      return;
    }
    if (close) {
      a.companionState = "interpose";
      a.companionBusy = true;
      var opts = fightOpts(a, t);
      opts.reach = 1.8 + (((a.species && a.species.scale) || 1) * 0.9); // body-check/gore reach
      opts.rate = 0.8;
      if (CBZ.creatureFight) CBZ.creatureFight(a, t, dt, opts);
      faceHeading(a);
      takeReturnDamage(a, t, dt);
      return;
    }
    // Defensive: wheel to face the threat from the owner's side, don't chase.
    a.companionState = "guard";
    var dOwn2 = dist2(a.pos.x, a.pos.z, ownerPos.x, ownerPos.z);
    if (dOwn2 > 16) { // drift back beside the owner
      a.companionBusy = true;
      drive(a, ownerPos.x - a.pos.x, ownerPos.z - a.pos.z, baseSpeed(a), dt);
    } else {
      a.companionBusy = true;
      a.heading = Math.atan2(op.z - a.pos.z, op.x - a.pos.x);
      faceHeading(a);
    }
  }

  /* ------------------------------- main loop ------------------------------- */
  function release(a) {
    if (a.companionBusy) a.companionBusy = false;
    a.companionState = "idle";
    a.companionTarget = null;
  }

  CBZ.onUpdate && CBZ.onUpdate(55, function (dt) {
    if (!dt || dt <= 0) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    if (noteCooldown > 0) noteCooldown -= dt;

    var list = CBZ.cityWildlife;
    var player = CBZ.player;
    if (!list || !list.length || !player || !player.pos || player.dead) {
      if (list) for (var k = 0; k < list.length; k++) {
        if (list[k] && list[k].tamed && list[k].companionBusy) release(list[k]);
      }
      return;
    }
    var ownerPos = player.pos;

    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || !a.tamed || !a.species || !a.group || !a.pos) continue;
      if (a.dead || a.hp <= 0) { if (a.companionBusy) a.companionBusy = false; continue; }
      if (a.stay || a.ridden || a.mounted || a.beingRidden) { if (a.companionBusy) release(a); continue; }
      var sp = a.species;
      if (a.aquatic || (sp.biome && /water|ocean|sea|river|lake/i.test(String(sp.biome)))) continue;

      var engaged = a.companionState && a.companionState !== "idle";
      if (a.group.visible === false && !engaged) { if (a.companionBusy) release(a); continue; }

      // Re-validate / re-scan the threat (staggered scan keeps it cheap).
      var t = a.companionTarget;
      if (t && !threatStillValid(a, t, ownerPos)) t = a.companionTarget = null;
      a.companionScanT = (a.companionScanT || 0) - dt;
      if (!t && a.companionScanT <= 0) {
        a.companionScanT = 0.25 + Math.random() * 0.15;
        t = a.companionTarget = findThreat(a, ownerPos);
      }

      if (!t) {
        // finish an in-progress retreat/fallback gracefully, else yield control
        if (a.companionState === "retreat" || a.companionState === "fallback") {
          a.companionBusy = true;
          if (retreatToOwner(a, ownerPos, dt)) release(a);
        } else if (a.companionState === "flee") {
          release(a);
        } else if (a.companionBusy || engaged) {
          release(a);
        }
        continue;
      }

      var disp = disposition(a);
      if (disp === "guardian") guardianTick(a, t, ownerPos, dt);
      else if (disp === "skittish") skittishTick(a, t, ownerPos, dt);
      else bruiserTick(a, t, ownerPos, dt);
    }
  });

  // Expose for debugging / other systems (e.g. UI badges: "Guardian").
  CBZ.companionDisposition = disposition;
})();
