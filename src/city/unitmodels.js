/* ============================================================
   city/unitmodels.js — ONE UNIT, BUILT FOR THE CITY, ON ANY PAGE.

   Every military machine the city parks, drives or flies is the unit file
   NPC War fights with (src/units/vehicles/<id>.js). This file is the one
   place that builds such a unit outside the battle: the def's build(ctx)
   with the side's identity, rig.mark for the ground and the flag, and a
   hull record (`unitVeh`) shaped like the battle's so the unit's own
   animate(veh, dt, ctx) runs unchanged (wheels on the real ground, rotors,
   gear, bay doors, the crew who are aboard).

   It used to live inside island_military.js (Fort Brandt), which made the
   models a side effect of the base: a page without the base (disaster.html
   runs The Isles without Gang City's military island) had no F-35 to park
   on an island runway. Now Fort Brandt, the player's own jet
   (playeraircraft.js), world/airbase.js and The Isles' army
   (island_civic.js) all build through here.

   PUBLIC
     CBZ.milModels.<kind>(o) -> made | null    kind: jet bomber cargo heli
         attackHeli drone tank truck patriot ifv apc luv mlrs. null until
         the unit file is on the page.
     CBZ.milModels.build(unitId, o) -> made | null   any unit id
         made = { group, rig, def, unitId, veh, name, footW, footL, height,
                  colliderW, colliderL, aircraftDims }
         group.userData.unitDrive(s, dt)   whoever flies/drives it calls
             this (CBZ.milAirDrive) with { thr, agl, speed, vy, pilot }
     CBZ.milModels.load(kindsOrIds) -> Promise<ids loaded>   (army.js loader)
     CBZ.milModels.unitOf(kind) -> unitId
     CBZ.milModels.has(kindOrId) -> bool      the unit file is on the page
     CBZ.cityAnimateUnit(veh, dt, agl)   one look step
     CBZ.cityUnitCrew(veh, on)           the crew at their posts or not

   Loads after city/army.js (the loader) and before island_military.js.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const NATION = "republic";            // the city's own forces are the republic's (city/flags.js)

  // ---- ONE UNIT, BUILT FOR THE CITY -------------------------------------
  // The battle's makeVehicle (src/battle/vehicles.js) in miniature: build(ctx)
  // with the side's identity, rig.mark for the ground and the flag, and a
  // hull record (`unitVeh`) shaped like the battle's so the unit's own
  // animate(veh, dt, ctx) runs here unchanged: wheels on the real ground,
  // rotors, gear, the crew who are aboard.
  function lcgOf(seed) {
    let s = ((seed | 0) * 2654435761 + 0x5eed) >>> 0 || 1;
    return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  }
  function groundAt(x, z) {
    if (!CBZ.floorAt) return 0;
    try { const y = +CBZ.floorAt(x, z); return isFinite(y) ? y : 0; } catch (e) { return 0; }
  }
  function unitVeh(id, def, g, rig, sc) {
    const S = def.stats || {}, hp = S.hp || 300, D = CBZ.vehicleDrive;
    const veh = {
      id: "city:" + id, unitId: id, def: def, rig: rig, group: g, pos: g.position, team: sc.side, side: sc,
      vehicle: true, air: def.domain === "air",
      h: g.rotation.y, yaw: g.rotation.y, heading: g.rotation.y, speed: 0,
      hp: hp, maxHp: hp, vs: { hp: hp, maxHp: hp, mobility: false, firepower: false, burning: false, wreck: false },
      ds: { v: 0, w: 0, steer: 0, throttle: 0, y: 0, vy: 0, gamma: 0, pitch: 0, roll: 0, trackL: 0, trackR: 0 },
      tur: { yaw: 0, elev: 0 },
      // the crew seat book; nobody aboard a parked machine
      seats: D && D.seats ? D.seats(def) : [],
      // the weapons as the battle keeps them, so the rig hooks get its shot shape
      wpn: (def.weapons || []).map(function (w, k) {
        const mount = w.mount || (w.turret ? "turret" : (w.chin || w.slew) ? "slew" : "free");
        return { w: w, i: k, n: 0, mount: mount, cool: 0, ammo: w.ammo == null ? 1e9 : w.ammo, burst: 0, salvo: 0, reloadT: 0, off: false,
          shot: { wid: w.id, wi: k, n: 0, w: w, kind: w.kind, mount: mount, target: null } };
      }),
      shots: [], target: new THREE.Vector3(), tgt: null, sees: false,
      dead: false, fled: false, egress: false, dismounted: false, burnT: 0, slot: "hold", airPhase: "",
      you: false, tactics: def.tactics || null,
    };
    veh.actx = { t: 0, dt: 0, dead: false, wreck: false, burning: false, air: veh.air, agl: 0, speed: 0, vy: 0,
      yawRate: 0, steer: 0, throttle: 0, gamma: 0, turret: veh.tur, target: null, phase: "", firing: null,
      side: sc.side, nation: sc.nation, groundAt: groundAt,
      shared: function (dt) { sharedAnim(veh, dt); } };
    return veh;
  }
  function sharedAnim(veh, dt) {
    if (veh.dead || !veh.rig || !veh.rig.update) return;
    try { veh.rig.update(dt, veh.ds.v, veh.ds.w, veh.ds.steer || 0); } catch (e) {}
  }
  /* THE UNIT'S LOOK, one step (the battle's vehAnimate). `agl` is the flight's
     own height when somebody flies it, else measured. */
  function animateUnit(veh, dt, agl) {
    if (!veh || !(dt > 0)) return;
    const c = veh.actx;
    c.t += dt; c.dt = dt;
    c.dead = !!veh.dead; c.wreck = !!veh.vs.wreck; c.burning = !!(veh.vs.burning || veh.burnT > 0);
    c.agl = agl != null ? agl : veh.pos.y - groundAt(veh.pos.x, veh.pos.z);
    c.speed = veh.ds.v; c.vy = veh.ds.vy || 0; c.yawRate = veh.ds.w || 0;
    c.steer = veh.ds.steer || 0; c.throttle = veh.ds.throttle || 0; c.gamma = veh.ds.gamma || 0;
    c.target = veh.tgt && !veh.tgt.dead ? veh.tgt : null; c.phase = veh.airPhase || "";
    const A = veh.def.animate;
    if (typeof A === "function") {
      try { A(veh, dt, c); }
      catch (e) { if (!veh._animErr) { veh._animErr = true; console.warn("[units] " + veh.unitId + ".animate threw:", e); } }
    } else sharedAnim(veh, dt);
    c.firing = null;
  }
  CBZ.cityAnimateUnit = animateUnit;
  // the crew who are aboard: a hull you drive shows its crew at their posts
  // ("you, at the controls, are the crew"); parked, nobody
  function crewAboard(veh, on) {
    const S = veh && veh.seats;
    if (!S) return;
    for (let i = 0; i < S.length; i++) if (S[i].crew) S[i].implicit = !!on;
    veh.you = !!on;
  }
  CBZ.cityUnitCrew = crewAboard;

  function unitBuild(id, o) {
    o = o || {};
    const K = CBZ.unitKit, def = K && K.get ? K.get(id) : null;
    if (!def || typeof def.build !== "function") return null;
    const nation = o.nation || NATION, ground = o.ground || "city";
    let flag = null;
    try { flag = CBZ.flags && CBZ.flags.designFor ? CBZ.flags.designFor(nation) : null; } catch (e) { flag = null; }
    const sc = { side: o.side || "blue", nation: nation, flagId: nation, flag: flag, ground: ground,
      color: o.color != null ? o.color : 0x4a5238, sideInfo: null };
    let b = null;
    try {
      b = def.build({ THREE: THREE, mat: CBZ.cmat, rng: lcgOf(o.seed), seed: o.seed | 0, id: id, ground: ground,
        side: sc.side, team: sc.side, nation: nation, flagId: nation, flag: flag, color: sc.color, sideInfo: null });
    } catch (e) { console.warn("[units] " + id + " build failed:", e); b = null; }
    if (!b || !b.group) return null;
    const g = b.group, rig = b.rig || g.userData.rig || null;
    if (rig && typeof rig.mark === "function") { try { rig.mark(nation, ground, sc); } catch (e) {} }
    if (rig && rig.settle) { try { rig.settle(); } catch (e) {} }
    g.rotation.order = "YXZ";
    g.userData.unitId = id;
    if (rig) g.userData.rig = rig;
    const veh = unitVeh(id, def, g, rig, sc);
    g.userData.unitVeh = veh;
    // whoever FLIES it (playeraircraft.js, aircraft.js) drives its look
    // through CBZ.milAirDrive(group, { thr, agl, speed, vy }, dt)
    g.userData.unitDrive = function (s, dt) {
      const h = g.rotation.y;
      let dh = h - veh.h; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      veh.ds.w = dt > 0 ? dh / dt : 0;
      veh.h = veh.yaw = veh.heading = h;
      const top = (def.stats && def.stats.speed) || 60;
      veh.ds.throttle = s.thr != null ? s.thr : 0;
      veh.ds.v = veh.speed = s.speed != null ? s.speed : veh.ds.throttle * top;
      veh.ds.vy = s.vy || 0;
      veh.ds.gamma = -g.rotation.x;
      // the player at the stick: the unit's rig reads the throttle and the
      // trigger off the flight instead of off a battle mission
      veh.flownBy = s.pilot || null;
      animateUnit(veh, dt, s.agl);
    };
    if (def.drive === "rotor") g.userData.rotorcraft = true;
    // first look: parked, the crew out, wheels down on the stand. An airframe
    // that models its own pilot (the F-35's suit and HMDS helmet) hangs him
    // on userData.pilot tagged crewFigure: nobody sits in a parked jet, and
    // whoever boards it (playeraircraft.js enterAircraft) shows him.
    const crewFig = g.userData.pilot;
    if (crewFig && crewFig.userData && crewFig.userData.crewFigure) crewFig.visible = false;
    animateUnit(veh, 1 / 30, 0);
    const air = def.domain === "air";
    const dims = g.userData.aircraftDims || null;
    const meta = K.meta ? K.meta(id) : null;
    return {
      group: g, rig: rig, def: def, unitId: id, veh: veh,
      name: (meta && meta.name) || id,
      // an airframe boards by its span; its SOLID is the body it has
      footW: air && dims ? dims.span : (b.footW || 3), footL: air && dims ? dims.length : (b.footL || 5),
      height: b.height || (dims && dims.height) || 3,
      colliderW: air && dims ? (dims.bodyW || b.footW) : null, colliderL: air && dims ? (dims.bodyL || b.footL) : null,
      aircraftDims: dims,
    };
  }

  // ---- THE PUBLISHED MODELS ---------------------------------------------
  // CBZ.milModels.<kind>() hands any page the unit's model as a record
  // {group, footW, footL, height, aircraftDims, colliderW, colliderL, rig}:
  // world/airbase.js parks it on its slab, the war room parks a nation's
  // bombers, warlord/props.js chars it into a wreck. It is null until the
  // unit file is on the page: milModels.load(kinds) brings them (the page
  // falls back to its own primitives in the meantime, and says so).
  const MODEL_UNIT = {
    jet: "f35", bomber: "b52", cargo: "a400m", heli: "uh60_black_hawk", attackHeli: "ah64_apache",
    drone: "mq9_reaper", tank: "m1_abrams", truck: "fmtv", patriot: "patriot_launcher",
    ifv: "bradley_ifv", apc: "stryker_apc", luv: "hmmwv", mlrs: "m270_mlrs",
  };
  function loadUnits(ids) {
    if (CBZ.army && CBZ.army.loadUnits) return CBZ.army.loadUnits(ids);
    const K = CBZ.unitKit;
    if (K && K.need) return K.need(ids).then(function () { return ids.filter(function (id) { return K.has(id); }); });
    return Promise.resolve([]);
  }
  let _milSeed = 0;
  CBZ.milModels = {};
  Object.keys(MODEL_UNIT).forEach(function (k) {
    CBZ.milModels[k] = function (o) { return unitBuild(MODEL_UNIT[k], Object.assign({ seed: ++_milSeed }, o || {})); };
  });
  Object.defineProperty(CBZ.milModels, "load", { enumerable: false, value: function (kinds) {
    const ids = (kinds && kinds.length ? kinds : Object.keys(MODEL_UNIT)).map(function (k) { return MODEL_UNIT[k] || k; });
    return loadUnits(ids);
  } });
  Object.defineProperty(CBZ.milModels, "unitOf", { enumerable: false, value: function (k) { return MODEL_UNIT[k] || null; } });
  Object.defineProperty(CBZ.milModels, "build", { enumerable: false, value: unitBuild });
  // is this kind's (or unit id's) file on the page yet? (a build would answer)
  Object.defineProperty(CBZ.milModels, "has", { enumerable: false, value: function (k) {
    const K = CBZ.unitKit, id = MODEL_UNIT[k] || k;
    return !!(K && K.has && K.has(id));
  } });
})();
