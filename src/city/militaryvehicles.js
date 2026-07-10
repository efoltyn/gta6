/* ============================================================
   city/militaryvehicles.js — STEAL THE HARDWARE: every tank, chopper, jet and
   truck on the bases is a LIVE, DRIVABLE machine, not a dead prop.

   WHY (owner's #1 law — no prop without a felt, in-world reason): the air-force
   base (Fort Brandt) and the airport (Halloran Field) are wall-to-wall military
   and civil aircraft + a motor pool of tanks. If you can SEE an M1 idling in the
   motor pool and a Raptor on the strip, the only honest thing the game can do is
   let you climb in and TAKE it. A parked tank you can only walk around is a lie —
   it tells you the base is a diorama. So every placed machine registers here as a
   boardable; walk up, the ONE context-interaction panel offers "Commandeer the
   tank / Steal the helicopter / Steal the aircraft", and pressing it does the
   real thing: the crime fires, the manhunt lights up, and you are FLYING or
   DRIVING it. The risk (a 3–4★ base full of soldiers) is the felt earn.

   This module is the bridge between the static island props (island_military.js,
   island_airport.js place the groups + tag them) and the two existing player-
   control systems:
     • AIR  (heli / plane) → playeraircraft.js makeCraft + enterAircraft, via the
       NEW CBZ.citySpawnFlyableFromProp — we hide the static prop and fly a real
       flyable stand-in (so it gets rotors, missiles, the chase cam, the keep
       loop). It's HOT: bail and it's impounded, exactly like the stolen Raptor.
     • GROUND (tank / armored truck) → an order-11.6 ground-locked drive sim in
       THIS file that mirrors the car controller but moves the actual island prop
       group. P.driving=true makes physics.js yield + the GTA chase-cam frame it
       for free; the tank additionally gets an independent turret that tracks the
       mouse and fires real shells through CBZ.cityFireMissile.

   ENGINE CONTRACT: headless-guarded; every cross-module global is feature-
   detected so a missing sibling degrades gracefully and nothing throws at load.
   ADDITIVE — it never touches the car or aircraft control paths except through
   their public entry points, and it GUARDS hard against two systems co-owning the
   player (you cannot board armor while driving/flying, or fly while in armor).
   Draw-call frugal: armor reuses the island prop's existing geometry (we just
   move/rotate it); no per-frame allocation in the sim. Plain IIFE, window.CBZ,
   THREE r128, no build step. Loads AFTER vehicles.js / playeraircraft.js /
   interactions.js (index.html), so their globals exist when we wire in.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // ---- the boardable registry. Each record:
  //   { group, pos(=group.position), heading, kind, model:{name}, footW, footL,
  //     taken, hot }
  // island_military.js / island_airport.js push these (deferred, after we load).
  const props = [];
  CBZ.cityMilitaryVehicles = props;

  function registerVehicle(rec) {
    if (!rec || !rec.group) return rec || null;
    if (rec.pos == null) rec.pos = rec.group.position;        // pos IS the group's live position
    if (rec.heading == null) rec.heading = rec.group.rotation.y || 0;
    if (rec.taken == null) rec.taken = false;
    if (rec.hot == null) rec.hot = true;                      // every base machine is hot the moment you take it
    if (rec.footW == null) rec.footW = 3;
    if (rec.footL == null) rec.footL = 5;
    if (!rec.model) rec.model = { name: rec.kind === "tank" ? "Tank" : rec.kind === "heli" ? "Helicopter" : rec.kind === "plane" ? "Aircraft" : "Vehicle" };
    props.push(rec);
    return rec;
  }
  CBZ.cityRegisterMilitaryVehicle = registerVehicle;

  // Distance to the outside of a vehicle's oriented footprint. Centre-distance
  // made the airport fleet impossible to board: an airliner is ~30m across and
  // its solid collider keeps the player far more than the old 5.5m centre radius
  // away. Measuring from the hull edge keeps small vehicles unchanged while an
  // airliner becomes interactable where a real door/fuselage would be.
  function footprintDistance(v, x, z) {
    const dx = x - v.pos.x, dz = z - v.pos.z;
    const a = -(v.heading || 0), ca = Math.cos(a), sa = Math.sin(a);
    const lx = dx * ca - dz * sa, lz = dx * sa + dz * ca;
    const ox = Math.max(0, Math.abs(lx) - Math.max(0.5, v.footW || 3) * 0.5);
    const oz = Math.max(0, Math.abs(lz) - Math.max(0.5, v.footL || 5) * 0.5);
    return Math.hypot(ox, oz);
  }

  // nearest NON-taken boardable within maxd (mirrors CBZ.cityNearestCar)
  function nearestVehicle(x, z, maxd) {
    let best = null, bd = (maxd == null ? 5.5 : maxd);
    for (let i = 0; i < props.length; i++) {
      const v = props[i];
      if (!v || v.taken || !v.group || !v.group.parent) continue;
      const d = footprintDistance(v, x, z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
  CBZ.cityNearestMilitaryVehicle = nearestVehicle;

  function nearestCivilAircraft(x, z, maxd) {
    let best = null, bd = maxd == null ? 10 : maxd;
    for (let i = 0; i < props.length; i++) {
      const v = props[i];
      if (!v || !v.civilian || v.kind !== "plane" || v.taken || !v.group || !v.group.parent) continue;
      const d = footprintDistance(v, x, z);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  // ---- small feature-detected helpers (match the storage.js voice) ----------
  function campaignActive() {
    try { return !!(CBZ.cityCampaignActive && CBZ.cityCampaignActive()); } catch (e) { return false; }
  }
  function campaignNotify(from, body) {
    if (!CBZ.campaignUI || typeof CBZ.campaignUI.notify !== "function") return;
    try { CBZ.campaignUI.notify("personal", from || "Vehicle", body); } catch (e) {}
  }
  function note(m, s) {
    if (campaignActive()) { campaignNotify("Vehicle", m); return; }
    if (CBZ.city && CBZ.city.note) { try { CBZ.city.note(m, s); } catch (e) {} }
  }
  function big(m) {
    if (campaignActive()) { campaignNotify("Dispatch", m); return; }
    if (CBZ.city && CBZ.city.big) { try { CBZ.city.big(m); } catch (e) {} }
  }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  function floorY(x, z) { if (CBZ.floorAt) { try { return CBZ.floorAt(x, z) || 0; } catch (e) {} } return 0; }
  function clampToCity(pos, r) {
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.clampToCity) { try { A.clampToCity(pos, r); } catch (e) {} }
  }
  function vehName(rec) { return (rec && rec.model && rec.model.name) || (rec && rec.name) || "Vehicle"; }
  function activeCtx() { return g.mode === "city" && g.state === "playing"; }
  function aircraftFlying() { const P = CBZ.player; return !!(P && P._aircraft); }

  // ============================================================
  //  BOARD VERB — self-registered into the ONE interaction registry (no
  //  interact.js edit). A source feeds the nearest non-taken machine when you're
  //  on foot (driving:false), a describe() names it, and the option commandeers
  //  it. WHY here, not interact.js: the registry is global + additive — new
  //  verbs register instead of bolting a keydown on, so they never collide.
  // ============================================================
  function wireInteraction() {
    if (!CBZ.interactions || !CBZ.interactions.registerSource) return false;
    if (wireInteraction._done) return true;
    const I = CBZ.interactions;
    I.registerSource({
      id: "src-milveh", kind: "milvehicle", layers: ["milvehicle"], prio: 3, driving: false,
      find: function (px, pz, ctx, push) {
        const v = CBZ.cityNearestMilitaryVehicle && CBZ.cityNearestMilitaryVehicle(px, pz, 5.5);
        if (v) push(v, footprintDistance(v, px, pz));
      },
    });
    if (I.describe) {
      I.describe("milvehicle", function (v) {
        const civil = !!v.civilian;
        const airliner = v.flightKind === "airliner";
        return {
          label: civil
            ? "✈ " + (airliner ? "AIRLINER" : "PRIVATE JET") + " — HIJACKABLE"
            : "🪖 " + (v.model ? v.model.name : (v.name || "Vehicle")),
          note: (civil ? (airliner ? "Hijack this commercial flight" : "Steal this aircraft")
            : v.kind === "tank" ? "Commandeer the tank"
            : v.kind === "heli" ? "Steal the helicopter"
            : v.kind === "plane" ? "Steal the aircraft"
            : "Steal the vehicle") + " · expect heat",
        };
      });
    }
    if (I.register) {
      I.register("milvehicle", {
        id: "milveh-take", slot: "e", bad: true, campaignSafe: true,
        label: function (v) {
          return v.civilian ? (v.flightKind === "airliner" ? "Hijack the airliner" : "Steal the private jet")
            : v.kind === "tank" ? "Commandeer the tank"
            : v.kind === "heli" ? "Steal the helicopter"
            : v.kind === "plane" ? "Steal the aircraft"
            : "Steal the vehicle";
        },
        onSelect: function (v) { boardVehicle(v); },
      });
    }
    wireInteraction._done = true;
    return true;
  }

  // Campaign CSS deliberately keeps the legacy interaction card hidden. Give
  // the first nearby passenger aircraft a one-time diegetic phone tip instead:
  // no prose floats over the apron, while the unchanged [E] registry action is
  // still discoverable before the player reaches the hull interaction radius.
  let campaignAircraftTipShown = false;
  if (CBZ.onUpdate) CBZ.onUpdate(14.65, function () {
    if (campaignAircraftTipShown || !campaignActive() || !activeCtx()) return;
    const P = CBZ.player;
    if (!P || !P.pos || P.dead || P.driving || P._aircraft) return;
    const rec = nearestCivilAircraft(P.pos.x, P.pos.z, 10);
    if (!rec) return;
    campaignAircraftTipShown = true;
    const airliner = rec.flightKind === "airliner";
    campaignNotify("GHOSTLINE", (airliner ? "The gate airliner" : "The private jet") + " is live. Walk to the hull and use [E] to board.");
  });

  // ============================================================
  //  COMMANDEER — the shared theft entry. Guards the two-owner rule HARD, fires
  //  the crime + manhunt exactly like storage.js stealBaseJet, then dispatches
  //  to AIR (flyable stand-in) or GROUND (armor drive sim).
  // ============================================================
  function boardVehicle(rec) {
    if (!rec || rec.taken) return;
    if (!activeCtx()) return;
    const P = CBZ.player; if (!P || P.dead) return;
    if (P.driving || P._vehicle) { note("Get out of your vehicle first.", 1.4); return; }
    if (aircraftFlying()) { note("Already airborne.", 1.4); return; }
    if (armor) { return; }                          // already commanding a ground machine

    const name = vehName(rec);
    const air = rec.kind === "heli" || rec.kind === "plane";

    // dispatch FIRST — only commit the theft/heat if a controller actually took it
    let took = false;
    if (air) {
      if (CBZ.citySpawnFlyableFromProp) { try { took = !!CBZ.citySpawnFlyableFromProp(rec); } catch (e) { took = false; } }
    } else {
      took = driveArmor(rec);
    }
    if (!took) { note("It won't start — try again.", 1.6); return; }

    rec.taken = true;
    // THEFT + HEAT (mirror storage.js stealBaseJet): grand theft of military
    // hardware is instant, loud, and pins a hard manhunt. Ground = 3★, air = 4★.
    if (CBZ.cityCrime) { try { CBZ.cityCrime(120, { type: rec.civilian ? "aircraft-hijacking" : "grand-theft-military", x: rec.pos.x, z: rec.pos.z, instant: true }); } catch (e) {} }
    if (CBZ.cityForceStars) { try { CBZ.cityForceStars(rec.kind === "ground" || rec.kind === "tank" ? 3 : 4); } catch (e) {} }
    big(rec.civilian ? "✈ " + name + " HIJACKED" : "🪖 " + name + " COMMANDEERED");
    sfx("alarm");
  }
  CBZ.cityBoardMilitaryVehicle = boardVehicle;

  // ============================================================
  //  GROUND DRIVE SIM (order 11.6) — a ground-locked controller that mirrors the
  //  car sim (vehicles.js order-11) but moves the ACTUAL island prop group. We do
  //  NOT use P._vehicle (vehicles.js owns that singleton + its order-11 loop);
  //  instead a module `armor` flag owns this craft, and P.driving=true makes
  //  physics.js yield + the GTA chase-cam frame it. WHY drive the real prop and
  //  not a copy: the motor-pool tank IS the model you want to roll out — reusing
  //  its geometry is draw-call free and it visibly LEAVES its spot.
  // ============================================================
  let armor = null;          // the ground craft currently under player control, or null
  let _restoreChar = false;  // did we hide the player rig on board?

  // per-kind ground feel (top speeds owner-specified: tank ~14, truck ~20)
  function armorTuning(rec) {
    const tank = rec.kind === "tank";
    return {
      accel: 10,                                   // m/s^2 toward top
      top: tank ? 14 : 20,                          // forward top speed
      rev: tank ? 6 : 9,                            // reverse top speed
      brake: 18,
      turn: tank ? 0.9 : 1.05,                      // rad/s hull rotation from A/D
      drag: 1.4,                                    // coast-down bleed
    };
  }

  function driveArmor(rec) {
    if (!rec || !rec.group) return false;
    const P = CBZ.player; if (!P) return false;
    armor = rec;
    rec.v = 0;
    rec.fireCD = 0;
    rec.heading = rec.group.rotation.y || rec.heading || 0;
    rec._tune = armorTuning(rec);
    // hand cityCollideVehicle the real hull footprint (it falls back to a small
    // 2×4.4 default otherwise) so the heavy machine shoulders walls/props at its
    // true size — a tank shouldn't slide through a fence post.
    if (!rec.dims) rec.dims = { width: rec.footW || 3, length: rec.footL || 5, wheelbase: (rec.footL || 5) * 0.5 };
    P.driving = true;                               // physics.js yields; chase-cam engages
    P._aircraft = null;                             // belt-and-braces: never both
    P.vy = 0; P.grounded = false;
    // snap the player marker onto the hull so the chase-cam frames it
    const gy = floorY(rec.pos.x, rec.pos.z);
    P.pos.set(rec.pos.x, gy, rec.pos.z);
    _restoreChar = false;
    if (CBZ.playerChar && CBZ.playerChar.group && CBZ.playerChar.group.visible) {
      CBZ.playerChar.group.visible = false; _restoreChar = true;
    }
    // point the chase-cam down the hull's nose (cam frames behind cam.yaw)
    if (CBZ.cam) CBZ.cam.yaw = rec.heading + Math.PI;
    sfx("door");
    if (CBZ.city && CBZ.city.note) {
      const ctrl = rec.kind === "tank"
        ? "W/S drive · A/D turn hull · mouse aims turret · L-click FIRE · [E] out"
        : "W/S drive · A/D turn · mouse look · [E] out";
      note("🪖 Driving the " + vehName(rec) + " — " + ctrl, 3.2);
    }
    return true;
  }
  CBZ.cityDriveArmor = driveArmor;

  // step out of the ground machine: settle it flat where it sits, drop the player
  // beside it on the surface, hand control back. The prop STAYS where you left it
  // (taken=true so it can't be re-boarded as a free prop), reading as abandoned.
  function exitArmor() {
    const rec = armor; armor = null;
    const P = CBZ.player;
    if (P) { P.driving = false; P._aircraft = null; }
    if (rec) {
      rec.v = 0;
      rec.group.rotation.set(0, rec.heading, 0);
      const gy = floorY(rec.pos.x, rec.pos.z);
      rec.pos.y = gy;
      rec.group.position.set(rec.pos.x, gy, rec.pos.z);
    }
    if (P && rec) {
      const ox = Math.sin(rec.heading) * (rec.footW * 0.5 + 1.6);
      const oz = Math.cos(rec.heading) * (rec.footW * 0.5 + 1.6);
      const gy = floorY(rec.pos.x + ox, rec.pos.z + oz);
      P.pos.set(rec.pos.x + ox, gy, rec.pos.z + oz);
      P.vy = 0; P.grounded = true;
    }
    if (_restoreChar && CBZ.playerChar && CBZ.playerChar.group && P) {
      CBZ.playerChar.group.visible = !P.dead;
      if (P) CBZ.playerChar.group.position.copy(P.pos);
    }
    _restoreChar = false;
    sfx("door");
  }
  CBZ.cityExitArmor = exitArmor;

  // [E] steps OUT of armor (the interaction registry owns boarding; this is the
  // single dedicated exit key, mirroring the aircraft [F] eject). Only acts while
  // armor is set, so it never shadows the on-foot E-verb panel.
  addEventListener("keydown", function (e) {
    if (!armor || e.repeat) return;
    const k = (e.key || "").toLowerCase();
    if (k === "e") { e.preventDefault(); exitArmor(); }
  });

  // L-click fires the tank's main gun while in a tank (pointer-locked, in city).
  addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    if (!armor || armor.kind !== "tank") return;
    if (!activeCtx() || !document.pointerLockElement) return;
    e.preventDefault();
    fireTank(armor);
  });

  // fire one main-gun shell from the turret muzzle, forward along the turret. A
  // real missile through CBZ.cityFireMissile (reuses the military missile pool +
  // blast); if the pool is saturated, a forward explosion so the gun still bites.
  function fireTank(rec) {
    if (!rec || rec.fireCD > 0) return;
    const ud = rec.group.userData;
    const turret = ud && ud.turret;
    const mLocal = (ud && ud.muzzleLocal) || new THREE.Vector3(0, 1.62, 5.7);
    // world muzzle position via the turret's live transform (so it points where
    // the barrel points), then forward = the turret's world heading.
    let wp;
    if (turret && turret.localToWorld) { wp = turret.localToWorld(mLocal.clone()); }
    else { wp = new THREE.Vector3(rec.pos.x, (rec.pos.y || 0) + 1.6, rec.pos.z); }
    const turWorldY = rec.heading + (turret ? turret.rotation.y : 0);
    const dx = Math.sin(turWorldY), dz = Math.cos(turWorldY), dy = 0;
    let fired = false;
    if (CBZ.cityFireMissile) {
      try { fired = !!CBZ.cityFireMissile(wp.x, wp.y, wp.z, dx, dy, dz, { byPlayer: true }); } catch (e) { fired = false; }
    }
    if (!fired) {
      const reach = 30;
      const tx = wp.x + dx * reach, tz = wp.z + dz * reach;
      if (CBZ.cityExplosion) { try { CBZ.cityExplosion(tx, tz, { power: 2.2, radius: 10, byPlayer: true, y: 0 }); } catch (e) {} }
    }
    rec.fireCD = 0.85;
    if (CBZ.shake) { try { CBZ.shake(0.6); } catch (e) {} }
    sfx("whoosh");
    // a tank shell in the city is a crime → heat (guarded)
    if (CBZ.cityCrime) { try { CBZ.cityCrime(140, { x: rec.pos.x, z: rec.pos.z, type: "shots-fired" }); } catch (e) {} }
  }

  // ---- the ground-drive integration. Order 11.6 = just past the car sim (11)
  //      and before the aircraft sim (12). Owns rec.group + the player transform
  //      while armor is set. Zero per-frame allocation (scratch is hoisted).
  CBZ.onUpdate(11.6, function (dt) {
    if (!armor) return;
    const P = CBZ.player;
    const rec = armor;
    // SAFETY: if the world left "playing"/city, or the player died, force out so
    // a second system never inherits a half-owned player. (death.js takes over on
    // the ground.) Same fail-safe the aircraft sim uses for P.dead.
    if (!P || g.mode !== "city" || g.state !== "playing" || P.dead) { exitArmor(); return; }
    // also bail if a sibling somehow grabbed the player for a car/plane
    if (P._vehicle || P._aircraft) { armor = null; P.driving = false; return; }

    const k = CBZ.keys || {};
    const T = rec._tune || armorTuning(rec);

    // throttle / brake — mirror the car: W accel, S brakes then reverses
    let throttle = 0;
    if (k["w"]) throttle += 1;
    if (k["s"]) throttle -= 1;
    if (throttle > 0) {
      if (rec.v < 0) rec.v += T.brake * dt;
      else rec.v += T.accel * dt * (1 - Math.min(0.7, rec.v / T.top));
    } else if (throttle < 0) {
      if (rec.v > 0.4) rec.v -= T.brake * dt;
      else rec.v -= T.accel * 0.6 * dt;
    } else {
      // coast-down
      if (rec.v > 0) rec.v = Math.max(0, rec.v - T.drag * dt * Math.max(1, rec.v));
      else if (rec.v < 0) rec.v = Math.min(0, rec.v + T.drag * dt * Math.max(1, -rec.v));
    }
    rec.v = Math.max(-T.rev, Math.min(T.top, rec.v));

    // steering — A/D rotate the HULL heading (tracked vehicle: turns in place at
    // low speed, a touch tighter the faster the tracks spin)
    let steer = 0;
    if (k["a"]) steer += 1;
    if (k["d"]) steer -= 1;
    if (steer) {
      const spd = Math.abs(rec.v);
      const rate = T.turn * (0.55 + 0.45 * Math.min(1, spd / 6));    // some turn even when crawling
      rec.heading += steer * rate * dt * (rec.v < 0 ? -1 : 1);
    }

    // integrate position along the hull heading, then collide + clamp to the world
    const fx = Math.sin(rec.heading), fz = Math.cos(rec.heading);
    rec.pos.x += fx * rec.v * dt;
    rec.pos.z += fz * rec.v * dt;
    if (CBZ.cityCollideVehicle) { try { CBZ.cityCollideVehicle(rec); } catch (e) {} }
    clampToCity(rec.pos, rec.footW * 0.5);
    const gy = floorY(rec.pos.x, rec.pos.z);
    rec.pos.y = gy;
    rec.group.position.set(rec.pos.x, gy, rec.pos.z);
    rec.group.rotation.set(0, rec.heading, 0);

    // TURRET (tank only) — the mouse aims it independently of the hull. The chase
    // cam frames behind cam.yaw, so the turret eases toward the camera's look
    // heading: turret world-heading target = cam.yaw + PI; subtract the hull
    // heading to get the LOCAL turret angle. Slew-limited so it swings, not snaps.
    const ud = rec.group.userData;
    if (rec.kind === "tank" && ud && ud.turret && CBZ.cam) {
      const targetWorld = CBZ.cam.yaw + Math.PI;          // where the camera looks
      let want = targetWorld - rec.heading;               // local turret angle
      let cur = ud.turret.rotation.y;
      let d = want - cur;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const maxStep = 1.4 * dt;                            // ~1.4 rad/s slew
      if (d > maxStep) d = maxStep; else if (d < -maxStep) d = -maxStep;
      ud.turret.rotation.y = cur + d;
    } else if (rec.kind !== "tank" && CBZ.cam && CBZ.lerpAngle && Math.abs(rec.v) > 0.3) {
      // NON-TURRET ground (the armored truck): no independent gun, so frame it
      // like a car — gently ease the chase cam back BEHIND the hull as it rolls,
      // so you read the road ahead. Only while moving, and lazily, so the mouse
      // can still glance around when stopped.
      CBZ.cam.yaw = CBZ.lerpAngle(CBZ.cam.yaw, rec.heading + Math.PI, 1 - Math.pow(0.2, dt));
    }

    if (rec.fireCD > 0) rec.fireCD = Math.max(0, rec.fireCD - dt);

    // own the player transform so physics (bails on P.driving) + the chase-cam
    // (follows player.pos + cam.yaw) both track the hull. The chase cam steers
    // its OWN framing off cam.yaw which the mouse drives, so we leave cam.yaw to
    // the player (it doubles as the turret aim) — a GTA tank: hull by A/D, aim by
    // mouse, camera behind the hull's general facing via the lazy cam follow.
    P.pos.set(rec.pos.x, gy, rec.pos.z);
    P.speed = Math.abs(rec.v);
    P.vy = 0; P.grounded = true;
    if (CBZ.playerChar && CBZ.playerChar.group) {
      CBZ.playerChar.group.position.copy(P.pos);
      CBZ.playerChar.group.visible = false;
    }
  });

  // ============================================================
  //  RESET — chain onto CBZ.cityVehiclesReset (mode.js fires it on every fresh
  //  run) so a new run drops us out of any armor. The island itself is persistent
  //  across city/prison hand-offs, so its boardable records must remain registered;
  //  otherwise the one-shot island registrars have nothing to hand back and the
  //  airport fleet becomes scenery after the first reset. Prune only records whose
  //  world group was actually removed by a landmass rebuild.
  // ============================================================
  function teardown() {
    if (armor) {
      const P = CBZ.player;
      if (P) { P.driving = false; P._aircraft = null; }
      if (_restoreChar && CBZ.playerChar && CBZ.playerChar.group && P) CBZ.playerChar.group.visible = !P.dead;
      armor = null; _restoreChar = false;
    }
    for (let i = props.length - 1; i >= 0; i--) {
      const rec = props[i];
      if (!rec || !rec.group || !rec.group.parent) props.splice(i, 1);
    }
  }
  CBZ.cityMilitaryVehiclesReset = teardown;

  function bindResetChain() {
    if (CBZ.cityVehiclesReset && !CBZ.cityVehiclesReset._milVehWrapped) {
      const orig = CBZ.cityVehiclesReset;
      CBZ.cityVehiclesReset = function () { try { teardown(); } catch (e) {} return orig.apply(this, arguments); };
      CBZ.cityVehiclesReset._milVehWrapped = true;
      return true;
    }
    return false;
  }
  // vehicles.js may load before or after us; try now, else on the first ticks,
  // and also retry the interaction wire-in (the registry exists by load order,
  // but guard anyway so a different load order still wires cleanly).
  wireInteraction();
  if (!bindResetChain() || !wireInteraction._done) {
    CBZ.onUpdate(14.6, function () {
      if (!CBZ.cityVehiclesReset || !CBZ.cityVehiclesReset._milVehWrapped) bindResetChain();
      if (!wireInteraction._done) wireInteraction();
    });
  }
})();
