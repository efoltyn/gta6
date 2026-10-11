"use strict";
/* src/battle/vehicles.js — NPC War: THE VEHICLES. Tanks, IFVs, APCs, trucks,
   technicals, launchers and aircraft as units on a side.

   A vehicle is ONE UNIT in the same `men` array as everybody else
   (`vehicle: true`), so every system that walks the roster — targets, the
   grid, the win check, morale, the cameras — sees it without learning a new
   list. What it IS (body, numbers, crew seats, weapons) is its unit file,
   src/units/vehicles/<id>.js through CBZ.unitKit; the maths it drives with
   (tracks, wheels, turret laying, ballistics, armour zones, damage states)
   is units/kit/vehicle.js (CBZ.vehicleDrive). This file is the battle half:
   spawn, crew, the AI, the guns, the hits, the wreck, and YOU at the wheel.

   CREW. A side's men fill its vehicles' seats first, in roster order:
   every vehicle's first seat (the driver), then every second seat, and so
   on, then the passenger benches of the carriers. A man in a seat is OFF the
   field (not in `men`, not a target) until he gets out. A vehicle that no
   man of its side was assigned to comes with its full crew implicitly —
   "3 M1 Abrams v 20 gorillas" is three crewed tanks. One man in a tank can
   drive OR fight, not both at once: he stops to shoot. A cannon whose
   loader seat is empty loads slower.
   DISMOUNT: carried infantry gets out at the vehicle's `dismountAt` range
   from the enemy, when the hull is penetrated, or when it cannot move.
   BAIL OUT: a knocked-out vehicle's surviving crew climbs out as men and
   fights on foot (implicit crew too: they are men like any other).

   Every branch elsewhere in the sim that knows about vehicles is behind an
   `m.vehicle` test, so a battle without one runs exactly as it always did. */

const VEH = {
  plans: {},              // team -> the crew plan for this roster
  pending: {},            // "team:vi" -> men spawned before their vehicle
  byIndex: {},            // "team:i" -> the vehicle unit
};

/* ------------------------------------------------------------- the plan */
function vehRosterOf(team) { return team === "red" ? SET.redU : SET.blueU; }
function vehSizeOf(team) { return team === "red" ? SET.redN : SET.blueN; }
function vehDef(id) { return CBZ.unitKit ? CBZ.unitKit.get(id) : null; }
function crewPlanFor(team) {
  const u = vehRosterOf(team), N = vehSizeOf(team);
  const key = u + "#" + N;
  const old = VEH.plans[team];
  if (old && old.key === key) return old;
  const plan = { key: key, seatOf: {}, vehicles: [], implicit: {} };
  VEH.plans[team] = plan;
  if (!CBZ.battleRoster || !CBZ.unitKit) return plan;
  const R = CBZ.battleRoster, K = CBZ.unitKit;
  const ids = R.ids(u);
  let anyVeh = false;
  for (let k = 0; k < ids.length; k++) if (K.kindOf(ids[k]) === "vehicle") { anyVeh = true; break; }
  if (!anyVeh) return plan;                        // the common case: costs one roster read
  const menIdx = [];
  for (let i = 0; i < N; i++) {
    const id = R.kindAt(u, i);
    if (id === "men") menIdx.push(i);
    else if (K.kindOf(id) === "vehicle") plan.vehicles.push({ i: i, id: id, def: vehDef(id) });
  }
  let next = 0;
  const vs = plan.vehicles;
  // crew seats, rank by rank across the vehicles: every driver first, then
  // every gunner, then the commanders and loaders
  for (let rank = 0; rank < 8 && next < menIdx.length; rank++) {
    for (let v = 0; v < vs.length && next < menIdx.length; v++) {
      const order = vehSeatOrder(vs[v].def);
      if (rank >= order.length) continue;
      plan.seatOf[menIdx[next++]] = { vi: vs[v].i, seat: order[rank], crew: true };
    }
  }
  // then the benches
  for (let v = 0; v < vs.length && next < menIdx.length; v++) {
    const d = vs[v].def, n = d ? (d.passengers || 0) : 0;
    for (let k = 0; k < n && next < menIdx.length; k++) plan.seatOf[menIdx[next++]] = { vi: vs[v].i, seat: -1, crew: false };
  }
  // a vehicle nobody was assigned to is crewed implicitly
  for (let v = 0; v < vs.length; v++) {
    let has = false;
    for (const mi in plan.seatOf) if (plan.seatOf[mi].vi === vs[v].i && plan.seatOf[mi].crew) { has = true; break; }
    if (!has) plan.implicit[vs[v].i] = true;
  }
  return plan;
}
const SEAT_RANK = { driver: 0, pilot: 0, gunner: 1, copilot: 2, commander: 3, loader: 4 };
function vehSeatOrder(def) {
  return ((def && def.crew) || []).map(function (c) { return c.seat; })
    .sort(function (a, b) { return (SEAT_RANK[a] == null ? 9 : SEAT_RANK[a]) - (SEAT_RANK[b] == null ? 9 : SEAT_RANK[b]); });
}
/* called by makeMan once the man exists: is he crew? If so he goes into his
   seat now (or waits for his vehicle) and is not put on the field. */
function vehicleSeatFor(team, i) {
  const plan = crewPlanFor(team);
  const s = plan.seatOf[i];
  if (!s) return false;
  return s;
}
function vehBoardAtSpawn(man, s) {
  // off the field: hidden, out of the squads and out of the bomb list
  if (man.group) man.group.visible = false;
  const sq = squads[man.team][man.sq];
  if (sq) { const k = sq.indexOf(man); if (k >= 0) sq.splice(k, 1); }
  if (man.ordTgt) {
    man.ordTgt.alive = false;
    if (CBZ.ordnance && CBZ.ordnance.removeTarget) { try { CBZ.ordnance.removeTarget(man.ordTgt); } catch (e) {} }
    man.ordTgt = null;
  }
  let v = VEH.byIndex[man.team + ":" + s.vi];
  if (v && (v.dead || men.indexOf(v) < 0)) v = null;   // a hull from a restaged war is not this one
  if (v) vehSeatMan(v, man, s);
  else (VEH.pending[man.team + ":" + s.vi] = VEH.pending[man.team + ":" + s.vi] || []).push({ man: man, s: s });
}
function vehSeatMan(v, man, s) {
  const book = v.seats;
  let seat = null;
  if (s.crew) {
    for (let k = 0; k < book.length; k++) {
      const b = book[k];
      if (b.crew && b.seat === s.seat && !b.man) { b.man = man; b.implicit = false; seat = b; break; }
    }
  }
  if (!seat) seat = CBZ.vehicleDrive.seat(book, man, s.crew ? null : "passenger");
  if (!seat) { vehPutOnField(v, man, 0); return; }        // no room after all: he walks
  man.inVeh = v;
  man.pos.set(v.pos.x, v.pos.y, v.pos.z);
}

/* ------------------------------------------------------------- spawn */
// a hull to stand in when a unit's builder is not loaded (node, or a
// failed engine file): a box of the right size, honest about being one
function vehStandIn(def) {
  const S = def.stats || {};
  const g = new THREE.Group();
  const L = S.length || 6, Wd = S.width || 2.6, H = S.height || 2.4;
  const hull = new THREE.Mesh(new THREE.BoxGeometry(Wd, H * 0.55, L), CBZ.cmat ? CBZ.cmat(0x5b6148) : new THREE.MeshLambertMaterial({ color: 0x5b6148 }));
  hull.position.y = H * 0.35; g.add(hull);
  if (def.turret) {
    const t = new THREE.Group(); t.name = "turret"; t.position.y = H * 0.7; g.add(t);
    const gun = new THREE.Group(); gun.name = "gun"; gun.position.set(0, 0.2, 0.4); t.add(gun);
    const tube = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, L * 0.6), hull.material); tube.position.z = L * 0.3; gun.add(tube);
    const mz = new THREE.Object3D(); mz.name = "muzzle"; mz.position.z = L * 0.6; gun.add(mz);
  }
  g.userData.standIn = true;
  return { group: g, rig: null, footW: Wd, footL: L, height: H };
}
/* WHO A HULL FIGHTS FOR, handed to build(ctx) so markings, roundels and fin
   flags are the side's own (docs/npcwar/ARCHITECTURE.md, the vehicle
   contract). `flag` is a city/flags.js design (paint it with
   CBZ.flags.paint), or the front spec's own when the war is at THE FRONT. */
/* THE GROUND A HULL IS PAINTED FOR: the erg's skin (sand / snow / grass) on
   the open maps, else the map id (city, island, field, arena, water...).
   rig.mark reads it with a regexp, so a new map needs no table here. */
function vehGround() {
  const M = (typeof MAPS !== "undefined" && MAP && MAPS[MAP.id]) || null;
  return String((M && M.erg) || (MAP && MAP.id) || "");
}
function vehSideCtx(teamId) {
  const S = (typeof SIDES !== "undefined" && SIDES[teamId]) || null;
  const nation = S && S.nation || null;
  let flag = null;
  if (FRONT && FRONT[teamId] && FRONT[teamId].flag) flag = FRONT[teamId].flag;
  else if (nation && CBZ.flags && CBZ.flags.designFor) { try { flag = CBZ.flags.designFor(nation); } catch (e) { flag = null; } }
  return { side: teamId, nation: nation, flagId: nation, flag: flag, ground: vehGround(),
    color: S && S.color != null ? S.color : TEAMS[teamId].color, sideInfo: S };
}
/* WHERE EACH WEAPON POINTS. A weapon's `mount` says what has to be on the
   line before it can fire:
     turret  the vehicle's turret (def.turret) slews onto the mark
     slew    its own mount (a chin gun, a remote weapon station): fires when
             the mark is inside `yawMax` of the nose and the rig reports its
             mount on the line (rig.aimError)
     fixed   bolted to the airframe or hull: the NOSE goes on the mark, within
             `arc` (rockets, a fixed gun, a missile's seeker before lock)
     free    a pintle or door gun, an indirect launcher, a bomb: no facing
   Unset, it is read off the old flags (turret / chin), then the domain: an
   aircraft's machine gun is a door gun, its other weapons are fixed. */
function vehMountOf(def, w) {
  if (w.mount) return w.mount;
  if (w.turret) return "turret";
  if (w.chin || w.slew) return "slew";
  if (w.indirect || w.kind === "bombs") return "free";
  if (def.domain === "air") return w.kind === "mg" ? "free" : "fixed";
  return "free";
}
function vehArcOf(w, mount) {
  if (w.arc != null) return w.arc;
  if (mount === "fixed") return w.kind === "missile" || w.kind === "sam" ? 0.35 : w.kind === "rockets" ? 0.05 : 0.06;
  if (mount === "slew") return w.yawMax != null ? w.yawMax : 1.9;
  return Math.PI;
}
function makeVehicle(teamId, i, id) {
  const def = vehDef(id);
  if (!def) return null;                               // unit file did not load
  const S = def.stats || {};
  const air = def.domain === "air";
  const sc = vehSideCtx(teamId);
  let b = null;
  try {
    b = def.build ? def.build({ THREE: THREE, mat: CBZ.cmat, rng: lcg, seed: i, id: id, ground: sc.ground,
      side: sc.side, team: sc.side, nation: sc.nation, flagId: sc.flagId, flag: sc.flag, color: sc.color, sideInfo: sc.sideInfo }) : null;
  } catch (e) { console.warn("[war] vehicle build failed:", id, e); }
  // THE SIDE'S MARKINGS: paint for the ground, the nation's flag (rig.mark)
  if (b && b.rig && typeof b.rig.mark === "function") {
    try { b.rig.mark(sc.nation, sc.ground, sc); } catch (e) { console.warn("[war] " + id + " rig.mark threw:", e); }
  }
  if (!b || !b.group) b = vehStandIn(def);
  const group = b.group;
  const L = b.footL || S.length || 6, Wd = b.footW || S.width || 2.6, H = b.height || S.height || 2.4;
  const rad = air ? Math.min(6, Wd * 0.3) : Wd * 0.5 + 0.15;
  const at = MAP.spawnAt(teamId, i, Math.max(rad, 2.5));
  const h = teamId === "red" ? Math.PI / 2 : -Math.PI / 2;
  const gy = MAP.groundAt(at.x, at.z);
  // aircraft come in from their own side's edge, already flying
  let px = at.x, pz = at.z, py = gy;
  if (air) {
    const back = 700 + (i % 4) * 90;
    px = at.x - Math.sin(h) * back; pz = at.z - Math.cos(h) * back;
    // a helicopter comes in low (nap of the earth), a jet at its cruise
    py = MAP.groundAt(px, pz) + (def.drive === "rotor" ? Math.max(S.nap || 10, Math.min(S.alt || 40, 30)) : (S.alt || 300));
  }
  group.position.set(px, py, pz);
  group.rotation.order = "YXZ";
  group.rotation.y = h;
  group.userData.dynamic = true;
  CBZ.scene.add(group);
  if (!air) noteBodyRadius(Math.min(4.5, L * 0.5));    // the fine grid must see a whole hull
  let reach = 0;
  const weapons = (def.weapons || []).map(function (w, k) {
    const mount = vehMountOf(def, w);
    if (!w.indirect) reach = Math.max(reach, w.range || 600);
    return { w: w, i: k, n: 0, mount: mount, arc: vehArcOf(w, mount),
      cool: 0.5 + lcg() * 1.5, ammo: w.ammo == null ? 1e9 : w.ammo, burst: 0, salvo: 0, reloadT: 0, off: false,
      // THE ROUND IN HAND, as every rig hook receives it (one object per weapon, reused)
      shot: { wid: w.id, wi: k, n: 0, w: w, kind: w.kind, mount: mount, target: null } };
  });
  const u = {
    id: teamId + i, team: teamId, i: i, vehicle: true, unitId: id, def: def, air: air,
    group: group, rig: b.rig || (group.userData && group.userData.rig) || null,
    pos: group.position, target: V(), h: h, yaw: h, heading: h, speed: 0,
    hp: S.hp || 300, maxHp: S.hp || 300,
    vs: { hp: S.hp || 300, maxHp: S.hp || 300, mobility: false, firepower: false, burning: false, wreck: false },
    rad: rad, noseR: L * 0.5, vlen: L * 0.5, vwid: Wd * 0.5, vheight: H,
    eyeH: Math.max(1.6, H * 0.95), losY: Math.max(1, H * 0.55), aimY: Math.max(0.9, H * 0.5), headY: Math.max(1.4, H * 0.85),
    eyeH0: 0, losY0: 0, aimY0: 0, headY0: 0,
    armed: weapons.length > 0, weapon: null, wid: id, launcher: false, fists: false,
    mag: 0, magSize: 0, cool: 0, reloadT: 0, punch: 0,
    tgt: null, sees: false, losBadT: 0, slot: "hold", thinkAt: simT + lcg() * 0.3, lastThink: simT,
    dead: false, dieT: 0, dieDir: 1, animF: (i % 4),
    lastShotT: -9, sq: Math.floor(i / 10), sqSlot: i % 10,
    kills: 0, shotsF: 0, hitsF: 0, reloads: 0,
    tier: "elite", nerve: 0, supp: 0, routed: false, fled: false, routT: 0, coverK: 1, up: true, stance: "stand",
    _mass: S.mass || 10000, _w: Math.max(2, (S.hp || 300) / 120),
    seats: CBZ.vehicleDrive.seats(def),
    ds: { v: 0, w: 0, steer: 0, throttle: 0, y: py, vy: 0, gamma: 0, pitch: 0, roll: 0, trackL: 0, trackR: 0 },
    tur: { yaw: 0, elev: 0 },
    wpn: weapons, shots: [], reach: reach || 600, _firing: null, _hitT: -9, _wantNose: false,
    alt: S.alt || 0, airPhase: "in", airPt: null, egress: false, heli: null,
    side: sc,
    // what the AI layer reads about how to fight this hull (src/battle/ai/*):
    // hull-down, face the threat, reverse out, infantry screen, priorities
    tactics: def.tactics || null,
    home: { x: at.x, z: at.z },
    you: false,
  };
  // what animate(veh, dt, ctx) is handed every sim step (one object, reused)
  u.actx = { t: 0, dt: 0, dead: false, wreck: false, burning: false, air: air, agl: 0, speed: 0, vy: 0,
    yawRate: 0, steer: 0, throttle: 0, gamma: 0, turret: u.tur, target: null, phase: "", firing: null,
    side: sc.side, nation: sc.nation, groundAt: MAP.groundAt,
    shared: function (dt) { vehAnimShared(u, dt); } };
  u.target.set(at.x, 0, at.z);
  if (u.rig && u.rig.settle) { try { u.rig.settle(); } catch (e) {} }
  // implicit crew, or the men who spawned before their vehicle
  const plan = crewPlanFor(teamId);
  if (plan.implicit[i] || !plan.vehicles.length) {
    for (let k = 0; k < u.seats.length; k++) if (u.seats[k].crew) u.seats[k].implicit = true;
  }
  VEH.byIndex[teamId + ":" + i] = u;
  const pend = VEH.pending[teamId + ":" + i];
  if (pend) { for (let k = 0; k < pend.length; k++) vehSeatMan(u, pend[k].man, pend[k].s); delete VEH.pending[teamId + ":" + i]; }
  (squads[teamId][u.sq] = squads[teamId][u.sq] || []).push(u);
  if (AIR.on && CBZ.ordnance && CBZ.ordnance.addTarget) {
    u.ordTgt = CBZ.ordnance.addTarget({
      pos: u.pos, team: teamId, unit: u,
      onDamage: function (dmg, info) { hurtMan(u, dmg, { byTeam: info && info.team, cause: "bomb" }); },
    });
  }
  return u;
}
function vehCrewN(u) {
  if (u.def.stats && u.def.stats.remote) return 1;   // flown from the ground (the Reaper)
  let n = 0;
  for (let k = 0; k < u.seats.length; k++) { const s = u.seats[k]; if (s.crew && (s.man || s.implicit)) n++; }
  return n;
}
function vehHasSeat(u, name) {
  for (let k = 0; k < u.seats.length; k++) { const s = u.seats[k]; if (s.crew && s.seat === name && (s.man || s.implicit)) return true; }
  return false;
}
function vehPassengers(u) {
  let n = 0;
  for (let k = 0; k < u.seats.length; k++) if (!u.seats[k].crew && u.seats[k].man) n++;
  return n;
}

/* ------------------------------------------------------------- getting out */
function vehPutOnField(u, man, k) {
  man.inVeh = null;
  // behind the hull, spread across its width
  const back = u.vlen + 1.2 + (k % 3) * 0.9, side = ((k % 5) - 2) * 1.1;
  const x = u.pos.x - Math.sin(u.h) * back + Math.cos(u.h) * side;
  const z = u.pos.z - Math.cos(u.h) * back - Math.sin(u.h) * side;
  man.pos.set(x, MAP.groundAt(x, z), z);
  if (man.group) { man.group.visible = true; man.group.rotation.y = u.h; }
  man.yaw = u.h;
  man.target.set(x, 0, z);
  man.home = { x: x, z: z };
  man.thinkAt = simT; man.lastThink = simT; man.slot = "hold"; man.tgt = null;
  const sqd = (squads[man.team][man.sq] = squads[man.team][man.sq] || []);
  if (sqd.indexOf(man) < 0) sqd.push(man);
  if (AIR.on && CBZ.ordnance && CBZ.ordnance.addTarget && !man.ordTgt) {
    man.ordTgt = CBZ.ordnance.addTarget({
      pos: man.pos, team: man.team, unit: man,
      onDamage: function (dmg, info) { hurtMan(man, dmg, { byTeam: info && info.team, cause: "bomb" }); },
    });
  }
  men.push(man);
}
function vehDismount(u) {
  let k = 0;
  for (let s = 0; s < u.seats.length; s++) {
    const seat = u.seats[s];
    if (seat.crew || !seat.man) continue;
    const man = CBZ.vehicleDrive.unseat(u.seats, seat);
    if (u.air) {                                  // an airdrop: they come down under the aircraft
      const x = u.pos.x + (lcg() - 0.5) * 30, z = u.pos.z + (lcg() - 0.5) * 30;
      vehPutOnField({ pos: { x: x, y: 0, z: z }, h: u.h, vlen: 0 }, man, k++);
    } else vehPutOnField(u, man, k++);
  }
  u.dismounted = true;
}
/* ONE MAN DOWN A FAST ROPE: the next passenger, at the foot of rope k & 1
   (port / starboard: 2 m out from the cabin doors), stepping off it. */
function vehRopeOne(u, k) {
  for (let s = 0; s < u.seats.length; s++) {
    const seat = u.seats[s];
    if (seat.crew || !seat.man) continue;
    const man = CBZ.vehicleDrive.unseat(u.seats, seat);
    const side = (k & 1) ? -1 : 1, lx = side * (3.0 + (k >> 1) % 3 * 0.8), lz = 0.1 - ((k >> 1) % 2) * 0.9;
    const c = Math.cos(u.h), sn = Math.sin(u.h);
    const x = u.pos.x + lx * c + lz * sn, z = u.pos.z - lx * sn + lz * c;
    // vehPutOnField puts him (vlen + 1.2 + (k % 3) * 0.9) behind: k = 2, vlen -3 = right here
    vehPutOnField({ pos: { x: x, y: 0, z: z }, h: u.h, vlen: -3.0 }, man, 2);
    return man;
  }
  return null;
}
// the hull is lost: whoever lives climbs out and fights on foot
function vehBailOut(u, catastrophic) {
  let k = 0;
  for (let s = 0; s < u.seats.length; s++) {
    const seat = u.seats[s];
    if (!seat.man && !seat.implicit) continue;
    const lives = lcg() < (catastrophic ? 0.3 : 0.85);
    let man = seat.man;
    if (seat.implicit) {
      seat.implicit = false;
      if (!lives || u.air) continue;
      const idx = spawnCount[u.team]++;
      man = makeMan(u.team, idx);
      if (!man) continue;
    } else {
      CBZ.vehicleDrive.unseat(u.seats, seat);
      if (!lives || u.air) {                       // dead in the hull (or in the fall)
        man.dead = true; man.hp = 0;
        DEADN[man.team] = (DEADN[man.team] || 0) + 1;
        if (man.group) CBZ.studio.drop(man.group);
        continue;
      }
    }
    seat.man = null;
    man.hp = Math.max(8, man.hp * (0.35 + lcg() * 0.5));
    man.supp = Math.min(SUPP_CAP, (man.supp || 0) + 0.8);
    vehPutOnField(u, man, k++);
  }
}

/* ------------------------------------------------------------- the step */
function stepVehicle(u, sdt) {
  if (u.dead) { stepWreck(u, sdt); vehAnimate(u, sdt); return; }
  if (u.fled) return;
  stepVehShots(u, sdt);
  for (let k = 0; k < u.wpn.length; k++) {
    const W = u.wpn[k];
    W.cool -= sdt;
    if (W.reloadT > 0) {
      W.reloadT -= sdt;
      if (W.reloadT <= 0) {
        W.salvo = 0;
        // the rack is full again: the rig puts the rounds back on its rails
        if (u.rig && u.rig.reload) { try { u.rig.reload(W.shot); } catch (e) {} }
      }
    }
  }
  if (u.you) stepYouVehicle(u, sdt);
  else {
    if (simT >= u.thinkAt) thinkVehicle(u);
    if (u.air) { stepAir(u, sdt); vehFight(u, sdt); }
    else {
      const crew = vehCrewN(u);
      // one man drives OR fights: he stops when he has a shot
      const shoot = u.tgt && !u.tgt.dead && u.sees;
      const halt = crew <= 1 && shoot && u._wantShot;
      vehDriveTo(u, sdt, halt);
      vehCrush(u, sdt);
      vehFight(u, sdt);
    }
  }
  vehAnimate(u, sdt);
}
function thinkVehicle(u) {
  u.lastThink = simT;
  u.thinkAt = simT + 0.3 + lcg() * 0.15;
  // the commander looks all round: perception is asked along the turret
  u.yaw = u.h + u.tur.yaw;
  const t = vehPickTarget(u);
  if (t) { u.tgt = t; u.losBadT = 0; }
  else if (u.tgt && (u.tgt.dead || u.tgt.fled)) u.tgt = null;
  u.sees = !!(u.tgt && eyeLos(u, u.tgt));
  const enemy = u.team === "red" ? "blue" : "red";
  const com = teamCOM[enemy];
  const S = u.def.stats || {};
  // carried infantry gets out at the vehicle's dismount range
  if (!u.dismounted && vehPassengers(u) > 0 && !(u.air && u.def.drive === "rotor" && !u.vs.mobility)) {
    const ref = u.tgt && !u.tgt.dead ? u.tgt.pos : com;
    const d = Math.hypot(ref.x - u.pos.x, ref.z - u.pos.z);
    if (d < (S.dismountAt || 150) || u.vs.mobility) vehDismount(u);
  }
  if (u.air) return;
  // where to be: the weapon's standoff from the mark, else at the enemy
  const stand = S.standoff || 200;
  if (u.vs.mobility) { u.target.set(u.pos.x, 0, u.pos.z); u.slot = "hold"; return; }
  if (holding(u) && u.home) {
    u.target.set(u.home.x, 0, u.home.z); u.slot = "hold";
    return;
  }
  if (u.tgt && !u.tgt.dead) {
    const dx = u.tgt.pos.x - u.pos.x, dz = u.tgt.pos.z - u.pos.z, d = Math.hypot(dx, dz) || 1;
    // close threats (beasts, men with fists) get run at or run over; a
    // rocket team at arm's length is backed off from
    let want = stand;
    if (u.tgt.beast || u.tgt.fists) want = Math.min(stand, 18);
    if (u.tgt.launcher && d < 60) want = 90;
    if (!u.sees) want = Math.min(want, d * 0.6);
    if (d > want * 1.15 || d < want * 0.6) {
      const go = d - want;
      u.target.set(u.pos.x + dx / d * go, 0, u.pos.z + dz / d * go);
      u.slot = "push";
    } else { u.target.set(u.pos.x, 0, u.pos.z); u.slot = "fire"; }
  } else {
    if (!navStep(u, u.target)) u.target.set(com.x, 0, com.z);
    u.slot = "march";
  }
}
// armour first for the big gun, people for the machine gun; asked of what
// the crew can see, nearest first, a handful of sight lines per think
const _vc = [];
function vehPickTarget(u) {
  const main = u.wpn.length ? u.wpn[0].w : null;
  const antiArmour = main && (main.kind === "cannon" || main.kind === "missile" || main.vs === "armour");
  // an aircraft looks as far as its longest weapon reaches (a bomber
  // releases kilometres short of the mark, a Hellfire flies 8 km)
  // (a jet looks out to 16 km: a B-52 at 9 km lets go 10 km short)
  const range = u.air ? (u.def.drive === "rotor" ? Math.min(Math.max(u.reach, 1500), 8000) : 16000)
    : main && main.range ? Math.min(main.range, 1600) : 600;
  _vc.length = 0;
  for (let k = 0; k < men.length; k++) {
    const o = men[k];
    if (o.team === u.team || o.dead || o.fled) continue;
    if (o.air && !vehCanHitAir(u)) continue;
    const d = Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z);
    if (d > range) continue;
    let score = d;
    if (o.vehicle && antiArmour) score -= 600;
    if (o.launcher) score -= 120;
    if (o.air && vehCanHitAir(u)) score -= 400;
    _vc.push(score, o);
  }
  if (!_vc.length) return null;
  let tries = 0, best = null;
  while (tries < 6) {
    let bi = -1, bs = Infinity;
    for (let k = 0; k < _vc.length; k += 2) if (_vc[k + 1] && _vc[k] < bs) { bs = _vc[k]; bi = k; }
    if (bi < 0) break;
    const o = _vc[bi + 1]; _vc[bi + 1] = null; tries++;
    if (!best) best = o;
    if (eyeLos(u, o)) return o;
  }
  return u.tgt && !u.tgt.dead ? u.tgt : best;
}
function vehCanHitAir(u) {
  for (let k = 0; k < u.wpn.length; k++) {
    const w = u.wpn[k].w;
    if (w.vs === "air" || w.kind === "mg" || w.kind === "autocannon" || (u.air && w.kind === "missile")) return true;
  }
  return false;
}
/* can THIS body engage an aircraft at all? Animals and fists cannot; a
   rifle can reach a helicopter low over the field, not a jet. */
function vehicleCanTarget(m, o) {
  if (!o.air) return true;
  if (m.vehicle) return vehCanHitAir(m);
  if (m.beast || m.fists) return false;
  return (o.pos.y - MAP.groundAt(o.pos.x, o.pos.z)) < 140;
}

/* ------------------------------------------------------------- driving */
function vehDriveTo(u, sdt, halt) {
  const D = CBZ.vehicleDrive, def = u.def, S = def.stats || {};
  const dx = u.target.x - u.pos.x, dz = u.target.z - u.pos.z, d = Math.hypot(dx, dz);
  let thr = 0, st = 0;
  if (!halt && d > 2.5) {
    const want = Math.atan2(dx, dz);
    const err = D.wrap(want - u.h);
    st = D.clamp(-err * 1.8, -1, 1);
    if (def.drive === "tracked") thr = Math.abs(err) > 1.1 ? 0 : D.clamp(d / 20, 0.15, 1) * (1 - Math.abs(err) * 0.5);
    else thr = D.clamp(d / 25, 0.2, 1) * (Math.abs(err) > 1.4 ? 0.35 : 1);
  }
  vehMove(u, sdt, { throttle: thr, steer: st, brake: halt ? 1 : 0 });
}
function vehMove(u, sdt, ctrl) {
  const D = CBZ.vehicleDrive, def = u.def, S = def.stats || {};
  const spec = { speed: S.speed, reverse: S.reverse, accel: S.accel, turn: S.turn, width: S.width,
    wheelbase: S.wheelbase, maxSteer: S.maxSteer, mobilityKill: u.vs.mobility };
  if (vehCrewN(u) === 0) { ctrl.throttle = 0; ctrl.steer = 0; }
  if (def.drive === "tracked") D.tracked(u.ds, spec, ctrl, sdt); else D.wheeled(u.ds, spec, ctrl, sdt);
  u.h = D.wrap(u.h + u.ds.w * sdt);
  const ox = u.pos.x, oz = u.pos.z;
  u.pos.x += Math.sin(u.h) * u.ds.v * sdt;
  u.pos.z += Math.cos(u.h) * u.ds.v * sdt;
  CBZ.micro.resolveCircle(u.pos, u.rad, u.pos.y, 2.4);
  const got = Math.hypot(u.pos.x - ox, u.pos.z - oz);
  u.speed = Math.abs(u.ds.v);
  // a wall that eats the move takes the speed with it
  if (u.speed > 1 && got < u.speed * sdt * 0.3) u.ds.v *= 0.5;
  D.pose(u.ds, MAP.groundAt, u.pos.x, u.pos.z, u.h, u.vlen * 2, u.vwid * 2, sdt);
  u.pos.y = u.ds.y;
  u.group.rotation.set(-u.ds.pitch, u.h, -u.ds.roll);
  u.yaw = u.h + u.tur.yaw;
  u.heading = u.h;
}
// a hull at speed does not stop for a man in the way
const _vn = [];
function vehCrush(u, sdt) {
  if (u.speed < 2.5) return;
  const a = fineNear(u.pos.x, u.pos.z, u.vlen + 1, _vn);
  const fx = Math.sin(u.h), fz = Math.cos(u.h);
  for (let k = 0; k < a.length; k++) {
    const o = a[k];
    if (o === u || o.dead || o.vehicle || o.air) continue;
    const rx = o.pos.x - u.pos.x, rz = o.pos.z - u.pos.z;
    const along = rx * fx + rz * fz, across = rx * fz - rz * fx;
    if (along < u.vlen * 0.2 || along > u.vlen + (o.rad || 0.45) || Math.abs(across) > u.vwid) continue;
    if ((o._crushT || 0) > simT) continue;
    o._crushT = simT + 0.6;
    const mk = Math.min(4, u._mass / 15000);
    hurtMan(o, u.speed * 9 * mk, { by: u, cause: "crush" });
  }
}

/* ------------------------------------------------------------- the guns */
function vehFight(u, sdt) {
  u._wantShot = false;
  u._wantNose = false;
  const t = u.tgt;
  if (!t || t.dead || t.fled || over) return;
  if (vehCrewN(u) === 0 || u.vs.firepower) return;
  const D = CBZ.vehicleDrive, def = u.def;
  const dx = t.pos.x - u.pos.x, dz = t.pos.z - u.pos.z, dist = Math.hypot(dx, dz);
  const dy = (t.pos.y + (t.aimY || 1)) - (u.pos.y + u.eyeH * 0.85);
  // lay the turret (or the chin gun) on the mark
  const rel = D.wrap(Math.atan2(dx, dz) - u.h);      // the mark's bearing off the nose
  const tr = def.turret;
  if (tr) {
    const el = Math.atan2(dy, dist);
    if (u.rig && u.rig.aimTurret) {
      u.rig.aimTurret(rel, el, sdt);
      if (u.rig.turret) u.tur.yaw = u.rig.turret.rotation.y;
      u.tur.elev = el;
    } else {
      u.tur.yaw = D.lay(u.tur.yaw, rel, tr.rate || 1, sdt);
      u.tur.elev = D.layClamp(u.tur.elev, el, tr.elevMin || -0.2, tr.elevMax || 0.6, tr.elevRate || 0.6, sdt);
      const tn = u.group.getObjectByName && u.group.getObjectByName("turret");
      if (tn) tn.rotation.y = u.tur.yaw;
      const gn = u.group.getObjectByName && u.group.getObjectByName("gun");
      if (gn) gn.rotation.x = -u.tur.elev;
    }
  } else u.tur.yaw = u.air ? 0 : rel;               // fixed guns point where the hull does
  // a slewing mount the model drew (userData.chinGun: two aim nodes) is laid
  // by the shared helper; the rig follows those nodes at its own rate
  if (u.group.userData.chinGun && CBZ.milAirAim) { try { CBZ.milAirAim(u.group, t.pos.x, t.pos.y + (t.aimY || 1), t.pos.z, sdt); } catch (e) {} }
  if (def.launcher && u.rig && u.rig.aimLauncher) { try { u.rig.aimLauncher(rel, def.launcher.elevMax, sdt); } catch (e) {} }
  const turErr = tr ? Math.abs(D.wrap(rel - u.tur.yaw)) : 0;
  u.sees = u.sees && simT - u.lastThink < 0.5 ? u.sees : eyeLos(u, t);
  if (!u.sees && !vehIndirect(u)) return;
  const jet = u.air && def.drive !== "rotor";
  for (let k = 0; k < u.wpn.length; k++) {
    const W = u.wpn[k], w = W.w;
    if (W.off || W.ammo <= 0 || W.cool > 0 || W.reloadT > 0) continue;
    // a bomb's reach is its fall (vehBombRun), not a range number
    if (w.kind !== "bombs" && (dist > (w.range || 600) || dist < (w.minRange || 0))) continue;
    if (!vehWeaponFits(u, w, t)) continue;
    const manned = vehSeatManned(u, w);
    if (!manned) continue;                                   // nobody at this gun
    if (manned === "halt") { u._wantShot = true; continue; } // the driver stops and climbs over
    if (u.rig && u.rig.canFire) { let ok = true; try { ok = u.rig.canFire(W.shot) !== false; } catch (e) {} if (!ok) continue; }
    if (w.kind === "bombs") { vehBombRun(u, W, t); continue; }
    // the big gun waits for the kill it was made for when the mark is soft
    // and a machine gun is in range; the machine gun leaves armour alone
    if (w.kind === "mg" && t.vehicle && (t.def.stats.armour.front || 0) > (w.pen || 9) * 2) continue;
    if (w.kind === "cannon" && !t.vehicle && dist < 500 && vehHasMG(u, dist) && lcg() < 0.6) { W.cool = 1; continue; }
    // ---- is THIS weapon on the line? (its mount, not the vehicle's) ----
    if (!w.indirect) {
      const m = W.mount;
      if (m === "turret" && tr) {
        if (turErr > (w.tol || 0.05)) { u._wantShot = true; continue; }
      } else if (m === "slew") {
        if (Math.abs(rel) > W.arc) { u._wantNose = true; continue; }
        if (u.rig && u.rig.aimError) {
          let e = 0; try { e = +u.rig.aimError(W.shot) || 0; } catch (er) { e = 0; }
          if (e > (w.tol || 0.06)) { u._wantShot = true; continue; }
        }
      } else if (m === "fixed") {
        if (Math.abs(rel) > W.arc) { u._wantNose = true; continue; }
        // a jet's gun and rockets point where the flight path does: in the
        // dive, not just on the bearing
        if (jet && (w.kind !== "missile" && w.kind !== "sam")) {
          const el = Math.atan2(dy, Math.max(1, dist));
          if (Math.abs(el - u.ds.gamma) > W.arc + 0.05) { u._wantNose = true; continue; }
        }
      }
    }
    u._wantShot = true;
    if (vehCrewN(u) <= 1 && u.speed > 1.2 && !u.air) continue;          // one man: stop, then shoot
    vehFire(u, W, t, dist);
    break;
  }
}
// what a weapon may be pointed at at all (the same rules the AI and the flight planner ask)
function vehWeaponFits(u, w, t) {
  if (w.vs === "air" && !t.air) return false;
  if (w.vs === "armour" && !t.vehicle) return false;
  if (w.vs === "soft" && t.vehicle && ((t.def.stats.armour || {}).side || 0) > 30) return false;
  if (t.air && !(w.vs === "air" || w.kind === "mg" || w.kind === "autocannon" || (u.air && w.kind === "missile"))) return false;
  return true;
}
/* WHO WORKS THIS GUN. A weapon fires only when its `seat` is crewed (a man
   in it, or the implicit crew of a hull nobody was assigned to). A seat-less
   weapon needs any crew; a remote airframe is always manned. One exception,
   the old "one man drives OR fights" rule: a crewman whose own seat works no
   weapon (the driver) can slide over to the MAIN gun's seat (weapon 0's)
   while the hull is stopped. He never reaches the loader's or the
   commander's machine gun. */
function vehSeatManned(u, w) {
  if (u.you) return true;                            // you are the crew
  const S = u.def.stats || {};
  if (S.remote) return true;
  const seat = w.seat;
  if (!seat) return vehCrewN(u) > 0;
  if (vehHasSeat(u, seat)) return true;
  const main = u.wpn.length ? u.wpn[0].w.seat : null;
  if (seat !== main) return false;
  for (let k = 0; k < u.seats.length; k++) {
    const s = u.seats[k];
    if (!s.crew || !(s.man || s.implicit)) continue;
    let armed = false;
    for (let j = 0; j < u.wpn.length; j++) if (u.wpn[j].w.seat === s.seat) { armed = true; break; }
    if (!armed) return u.speed > 1.2 ? "halt" : true;
  }
  return false;
}
function vehIndirect(u) { for (let k = 0; k < u.wpn.length; k++) if (u.wpn[k].w.indirect) return true; return false; }
function vehHasMG(u, dist) {
  for (let k = 1; k < u.wpn.length; k++) { const w = u.wpn[k].w; if (w.kind === "mg" && dist <= (w.range || 600) && u.wpn[k].ammo > 0) return true; }
  return false;
}
function vehFire(u, W, t, dist) {
  const w = W.w;
  if (w.kind !== "mg") {                       // fireShot keeps the machine gun's ledger itself
    stats[u.team].shots++; u.shotsF++; u.lastShotT = simT;
    shotsRing.push({ x: u.pos.x, z: u.pos.z, t: simT, m: u });
    if (shotsRing.length > 90) shotsRing.shift();
  }
  // the cadence: rounds per second, bursts with a pause, salvos with a reload
  let cd = 1 / Math.max(0.01, w.rof || 1);
  if (w.needs && !vehHasSeat(u, w.needs)) cd *= 1.6;          // no loader: the gunner loads
  if (vehCrewN(u) <= 1) cd *= 1.4;
  W.ammo--;
  if (w.burst) { W.burst++; if (W.burst >= w.burst) { W.burst = 0; cd += w.pause || 1; } }
  if (w.salvo) { W.salvo++; if (W.salvo >= w.salvo) { W.salvo = 0; W.reloadT = w.reload || 30; } }
  W.cool = cd * (0.9 + lcg() * 0.2);
  // THE ROUND IN HAND: every rig hook this round reaches (muzzleWorld, fire,
  // or the legacy fired/spend) is told which weapon it is and which round
  const shot = vehShotOf(u, W, t);
  const k = w.kind;
  if (k === "mg") vehFireMG(u, w, t, dist);
  else if (k === "missile" || k === "sam") vehLaunch(u, w, t);
  else if ((k === "cannon" || k === "autocannon") && t.vehicle) vehFireKE(u, w, t, dist);
  else vehFireHE(u, w, t, dist);
  u.actx.firing = shot;
  u._firing = null;
}
function vehShotOf(u, W, t) {
  const s = W.shot;
  s.n = W.n++; s.target = t || null;
  u._firing = s;
  return s;
}
/* where the round leaves: the rig answers for the weapon in hand (`shot`,
   or the one vehFire is firing), else the model's "muzzle" node, else the
   front of the turret line */
function vehicleMuzzle(u, out, shot) {
  shot = shot || u._firing || null;
  if (u.rig && u.rig.muzzleWorld) { try { const p = u.rig.muzzleWorld(out, shot); if (p) return p; } catch (e) {} }
  const mz = u.group.getObjectByName && u.group.getObjectByName("muzzle");
  if (mz && mz.getWorldPosition) { u.group.updateMatrixWorld(true); return mz.getWorldPosition(out); }
  const yaw = u.h + u.tur.yaw;
  return out.set(u.pos.x + Math.sin(yaw) * u.vlen * 0.8, u.pos.y + u.eyeH * 0.85, u.pos.z + Math.cos(yaw) * u.vlen * 0.8);
}
/* THE RIG'S PART IN A SHOT: recoil, flash, the store leaving its rail.
   A rig with fire(shot, from) owns all of it, for every weapon. A legacy rig
   (city/mil_armor.js) gets fired(scale, shot) for its guns and spend(i, shot)
   for a launch, i = the tube (its own `loaded` count when it keeps one, else
   the weapon's round number). Nobody: a muzzle flash. A machine gun's
   muzzle is drawn by fireShot's tracer. */
function vehFx(u, from) {
  const shot = u._firing, R = u.rig;
  if (!shot) return;
  if (R && typeof R.fire === "function") { try { R.fire(shot, from); } catch (e) {} return; }
  const k = shot.kind;
  if (k === "mg") return;
  if (k === "rockets" || k === "missile" || k === "sam") {
    if (R && R.spend && !(typeof R.loaded === "number" && R.loaded <= 0)) {
      try { R.spend(typeof R.loaded === "number" ? R.loaded - 1 : shot.n, shot); } catch (e) {}
      return;
    }
  } else if (R && R.fired && (k === "cannon" || k === "autocannon")) {
    try { R.fired(k === "cannon" ? 1 : 0.3, shot); } catch (e) {}
    return;
  }
  if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash(from, { scale: k === "cannon" ? 4 : k === "autocannon" ? 1.4 : 2 }); } catch (e) {} }
}
function vehFireMG(u, w, t, dist) {
  // the page's own round: fireShot flies it, lands it and keeps the ledger.
  // _gunId names the mount, so the round is ITS cartridge (weapons/ballistics.js:
  // a coax is 7.62 NATO, the commander's gun .50 BMG, with their own belts of
  // tracer) and a mount's steadiness, not a rifleman's
  const keepWid = u.wid;
  u.wid = w.wid || "lmg"; u.mag = 999;
  vehFx(u, null);                                   // the rig's part (a rig with fire(shot) flashes its own mount)
  u._gunId = w.id;
  try { fireShot(u, t, { mode: "aimed" }); } catch (e) { console.warn("[war] mount fire", e); }
  u._gunId = null; u.wid = keepWid;
}
// a kinetic round at armour: it either hits or it does not, now
function vehFireKE(u, w, t, dist) {
  const from = vehicleMuzzle(u, _muz);
  vehFx(u, from);
  let p = Math.max(0.25, Math.min(0.95, 0.96 - dist / 3200));
  if (u.speed > 1.5) p *= u.def.drive === "tracked" ? 0.85 : 0.6;
  if (w.kind === "autocannon") p *= 0.75;
  const hit = lcg() < p;
  _v.set(t.pos.x, t.pos.y + (t.aimY || 1), t.pos.z);
  if (!hit) { _v.x += (lcg() - 0.5) * 6; _v.z += (lcg() - 0.5) * 6; _v.y += (lcg() - 0.3) * 2; }
  if (CBZ.tracer) { try { CBZ.tracer(from, _v, { shooter: u, targetActor: t, muzzle: true, muzzleScale: 2.5 }); } catch (e) {} }
  const dCam = Math.sqrt(camDist2(u.pos));
  if (dCam < 600) { try { CBZ.sfx(w.kind === "cannon" ? "explosion" : "shoot_shotgun", { dist: dCam, ghost: true, volume: 0.9, pitch: w.kind === "cannon" ? 0.55 : 1.2 }); } catch (e) {} }
  if (!hit) { missImpact(from, _v, camDist2(_v)); return; }
  stats[u.team].hits++; u.hitsF++;
  u._shot = { pen: w.pen || 300, beh: w.beh || 400, he: false, cls: w.kind === "cannon" ? "apfsds" : "ap" };
  hurtMan(t, w.beh || 400, { by: u });
  u._shot = null;
}
// a high-explosive round (or rocket, or shell) at people: the page's own
// rocket path flies it and studio.boom lands it on BOTH sides
function vehFireHE(u, w, t, dist) {
  const he = w.he || { pen: 30, beh: 200, blast: 6, power: 1.4 };
  const from = V().copy(vehicleMuzzle(u, _muz));
  vehFx(u, from);
  const spread = (w.indirect ? 0.025 : 0.012) * dist;
  const tx = t.pos.x + (lcg() - 0.5) * spread, tz = t.pos.z + (lcg() - 0.5) * spread;
  const ty = MAP.groundAt(tx, tz) + 0.15;
  const v0 = w.heSpeed || w.speed || 300, g = w.grav == null ? 9.8 : w.grav;
  const dd = Math.hypot(tx - from.x, tz - from.z) || 1;
  let sol = CBZ.vehicleDrive.ballistic(ty - from.y, dd, v0, g);
  if (w.indirect && g > 0) {
    // high angle for the rockets: up and down onto the mark
    const v2 = v0 * v0, disc = v2 * v2 - g * (g * dd * dd + 2 * (ty - from.y) * v2);
    if (disc >= 0) { const el = Math.atan((v2 + Math.sqrt(disc)) / (g * dd)); sol = { elev: el, t: dd / (v0 * Math.cos(el)) }; }
  }
  const ch = Math.cos(sol.elev), sh = Math.sin(sol.elev);
  const vel = new THREE.Vector3((tx - from.x) / dd * v0 * ch, v0 * sh, (tz - from.z) / dd * v0 * ch);
  u._he = { pen: he.pen, beh: he.beh, he: true, cls: "he" };
  rockets.push({
    pos: V().copy(from), vel: vel, grav: g, t: 0, by: u, life: Math.max(7, sol.t * 1.5 + 2),
    w: { blastRadius: he.blast || 6, blastPower: (he.power || 1.4) / 0.55, sfx: null },
    trail: CBZ.studio.trail({ length: 12, color: 0xffd9a0, opacity: 0.45, minStep: 2 }),
  });
  const dCam = Math.sqrt(camDist2(u.pos));
  if (dCam < 600) { try { CBZ.sfx("explosion", { dist: dCam, ghost: true, volume: 0.7, pitch: 0.6 }); } catch (e) {} }
}
// a guided round: flies to the mark (or a point near it) and lands its warhead
function vehLaunch(u, w, t) {
  const from = V().copy(vehicleMuzzle(u, _muz));
  vehFx(u, from);
  u.shots.push({ pos: from, tgt: t, w: w, t: 0, by: u,
    trail: CBZ.studio.trail({ length: 30, color: 0xe8e2d4, opacity: 0.5, minStep: 3 }) });
}
function stepVehShots(u, sdt) {
  for (let k = u.shots.length - 1; k >= 0; k--) {
    const s = u.shots[k], w = s.w, t = s.tgt;
    s.t += sdt;
    const tx = t.pos.x, ty = t.pos.y + (t.aimY || 1), tz = t.pos.z;
    const dx = tx - s.pos.x, dy = ty - s.pos.y, dz = tz - s.pos.z, d = Math.hypot(dx, dy, dz) || 1;
    const step = (w.speed || 300) * sdt;
    if (step >= d || s.t > 30 || t.dead) {
      s.trail.dispose();
      u.shots.splice(k, 1);
      if (t.dead) continue;
      const hit = lcg() < (t.air ? 0.85 : 0.92);
      if (CBZ.studio.boom && w.he) CBZ.studio.boom({ x: tx, y: ty, z: tz }, { radius: w.he.blast || 5, power: (w.he.power || 1.4), structural: false, by: u });
      else if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash({ x: tx, y: ty, z: tz }, { scale: 3 }); } catch (e) {} }
      if (hit) {
        stats[u.team].hits++; u.hitsF++;
        u._shot = { pen: w.pen || 600, beh: w.beh || 800, he: false, cls: "atgm", top: !!t.air };
        hurtMan(t, w.beh || 800, { by: u });
        u._shot = null;
      }
      continue;
    }
    s.pos.x += dx / d * step; s.pos.y += dy / d * step; s.pos.z += dz / d * step;
    s.trail.push(s.pos);
  }
}

/* ------------------------------------------------------------- the air
   HOW AIRCRAFT FIGHT. Two airframes, two doctrines, numbers from the unit
   file's stats (all optional):

   HELICOPTERS (drive "rotor") fight from BATTLE POSITIONS. The pilot picks
   a spot at the stand-off of the weapon the mark calls for (its range x
   0.75, capped by stats.standoff), on his own side of it, where the ground
   or a building hides him from the mark at `nap` metres (default 10) but a
   climb of no more than `popAlt` (default max(alt, 45)) clears the line.
     transit  nap of the earth to the position, following the ground
     mask     hover low behind the crest; wait for the guns to be ready
     pop      climb (`climb` m/s, default 8) until the mark is in sight, nose
              on it, fire; a window of `popWindow` s (default 7), cut short
              when a salvo is out or he is hit
     drop     back down behind the mask, then SIDESTEP to a new position:
              never pop up twice from the same place
   No mask to be had (open sand, flat water): the position is just the
   stand-off at nap height, and he still shoots and scoots.

   JETS (everything else) fly ATTACK RUNS at real heights. The weapon for the
   pass decides the profile:
     bombs    level at the weapon's `alt` (else stats.alt), released where the
              fall lands on the mark; a guided bomb (w.guided) steers out a
              cross-track error up to `basket` x its fall distance (0.15)
     missile  at cruise, launched inside 0.85 x range with the nose on it
     gun / rockets  a DIVE: from `alt` (default min(cruise, 1500)) down a line
              of `dive` rad (0.3) at the mark, firing inside range, pulling
              out at `pullOut` m above it (250)
   then out past the mark on a racetrack wide enough for the turn circle, and
   in again. A jet never flies below 60 m over the ground. */
function stepAir(u, sdt) {
  const S = u.def.stats || {};
  // out of ammunition (or a transport that has dropped): it goes home
  if (!u.egress) {
    let left = 0;
    for (let k = 0; k < u.wpn.length; k++) left += u.wpn[k].ammo;
    if ((u.wpn.length && left <= 0) || (S.airdrop && u.dismounted)) u.egress = true;
  }
  if (u.egress) {
    if (Math.hypot(u.pos.x - MAP.cx, u.pos.z - MAP.cz) > 3200) {
      // off the map: out of the fight, not dead
      u.fled = true; if (u.group) u.group.visible = false;
      return;
    }
  }
  if (u.def.drive === "rotor") stepRotor(u, sdt); else stepJet(u, sdt);
}
// the weapon a pass (or a battle position) is planned round: the first one,
// in the unit's own order, that can hurt this mark and has rounds left
function vehAirWeapon(u, t) {
  let best = null;
  for (let k = 0; k < u.wpn.length; k++) {
    const W = u.wpn[k];
    if (W.off || W.ammo <= 0) continue;
    if (t && t.pos && t.team && !vehWeaponFits(u, W.w, t)) continue;
    if (W.reloadT > 0) { if (!best) best = W; continue; }
    return W;
  }
  return best;
}
/* A SIGHT LINE FOR PLANNING: the buildings exactly (the colliders), the
   ground sampled every ~12 m (a hill is not a fence; 160 samples at most). */
function airSightClear(ax, ay, az, bx, by, bz) {
  if (CBZ.micro.segmentBlocked && CBZ.micro.segmentBlocked(ax, ay, az, bx, by, bz)) return false;
  const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
  if (d < 8) return true;
  const n = Math.min(160, Math.max(4, Math.ceil(d / 12)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (MAP.groundAt(ax + dx * t, az + dz * t) > ay + (by - ay) * t + 0.5) return false;
  }
  return true;
}
function heliStand(u, t) {
  const S = u.def.stats || {};
  const W = vehAirWeapon(u, t);
  const w = W ? W.w : null;
  let r = w ? (w.range || 600) * 0.75 : 600;
  if (S.standoff) r = Math.min(r, S.standoff);
  if (w && w.minRange) r = Math.max(r, w.minRange * 1.3 + 40);
  return Math.max(150, r);
}
/* the battle position: masked low, clear when popped up. Asked once per
   position (a dozen candidates, nearest the current bearing first). */
function heliPlan(u, ref, stand) {
  const S = u.def.stats || {}, H = u.heli;
  const nap = S.nap || 10, popMax = Math.max(S.popAlt || Math.max(S.alt || 40, 60), nap + 6);
  const ty = MAP.groundAt(ref.x, ref.z) + 1.6;          // the mark's eye
  const b0 = Math.atan2(u.pos.x - ref.x, u.pos.z - ref.z) + H.shift;
  let fallback = null;
  const OFF = [0, -1, 1, -2, 2, -3, 3], RING = [1, 0.85, 0.65, 0.45];
  // the stand-off first; closer in only when nothing on that ring sees the mark
  for (let q = 0; q < RING.length && !fallback; q++) {
    for (let j = 0; j < OFF.length; j++) {
      const b = b0 + OFF[j] * 0.17, r = Math.max(150, stand * RING[q]);
      const px = ref.x + Math.sin(b) * r, pz = ref.z + Math.cos(b) * r;
      const g = MAP.groundAt(px, pz);
      if (!airSightClear(px, g + nap, pz, ref.x, ty, ref.z)) {
        // masked down low: how high to climb before the mark is in sight?
        for (let h = nap + 6; h <= popMax; h += 7) {
          if (airSightClear(px, g + h, pz, ref.x, ty, ref.z)) {
            return { x: px, z: pz, lo: nap, hi: Math.min(popMax, h + 3), masked: true };
          }
        }
      } else if (!fallback) fallback = { x: px, z: pz, lo: nap, hi: nap, masked: false };
    }
  }
  if (fallback) return fallback;
  // nothing sees the mark from anywhere: close in, high
  const r = Math.max(150, stand * 0.45), px = ref.x + Math.sin(b0) * r, pz = ref.z + Math.cos(b0) * r;
  return { x: px, z: pz, lo: popMax, hi: popMax, masked: false };
}
function heliReady(u) {
  for (let k = 0; k < u.wpn.length; k++) { const W = u.wpn[k]; if (!W.off && W.ammo > 0 && W.reloadT <= 0 && W.cool < 1) return true; }
  return false;
}
function stepRotor(u, sdt) {
  const D = CBZ.vehicleDrive, S = u.def.stats || {};
  const H = u.heli || (u.heli = { ph: "transit", bp: null, t: 0, win: 0, shift: 0, refX: 0, refZ: 0, fired0: 0 });
  const enemy = u.team === "red" ? "blue" : "red";
  const nap = S.nap || 10, climb = S.climb || 8;
  const t = u.tgt && !u.tgt.dead && !u.tgt.fled ? u.tgt : null;
  const ref = t ? t.pos : teamCOM[enemy];
  let gx, gz, wantAGL, face = null;
  const carrying = S.dismountAt && vehPassengers(u) > 0;
  if (u.egress) {
    gx = MAP.cx + (u.team === "red" ? -4200 : 4200); gz = MAP.cz; wantAGL = nap * 2;
    H.ph = "transit";
  } else if (carrying) {
    /* A LIFT: low and fast to a landing zone short of the enemy (0.8 x
       dismountAt), flare, then either set down (1.5 m) and unload at once,
       or, with stats.fastRope, hover at that height and put the men down
       two ropes, one man per rope every ropeEvery s after ropeDelay plus
       the slide (the unit's rig draws the same schedule). The zone is fixed
       once the aircraft is close, so it does not chase a moving enemy. */
    const sx = ref.x - u.pos.x, sz = ref.z - u.pos.z, sd = Math.hypot(sx, sz) || 1;
    if (!H.lz || (H.ph !== "insert" && Math.hypot(H.lz.x - u.pos.x, H.lz.z - u.pos.z) > 150)) {
      const lz = Math.max(0, sd - S.dismountAt * 0.8);
      H.lz = { x: u.pos.x + sx / sd * lz, z: u.pos.z + sz / sd * lz };
    }
    gx = H.lz.x; gz = H.lz.z;
    const dl = Math.hypot(gx - u.pos.x, gz - u.pos.z), rope = S.fastRope || 0;
    const agl = u.pos.y - MAP.groundAt(u.pos.x, u.pos.z);
    wantAGL = dl < 90 ? (rope || 1.5) : nap;
    if (H.ph === "insert" || (dl < 10 && u.ds.v < 3 && Math.abs(agl - (rope || 1.5)) < 2.5)) {
      if (H.ph !== "insert") { H.ph = "insert"; H.insT = 0; H.insK = 0; }
      else H.insT += sdt;
      gx = u.pos.x; gz = u.pos.z;                    // hold the hover
      if (!rope) { if (H.insT > 1.2) vehDismount(u); }
      else {
        const first = (S.ropeDelay || 1.6) + rope / (S.ropeSpeed || 6), gap = (S.ropeEvery || 0.9) / 2;
        while (vehPassengers(u) > 0 && H.insT >= first + H.insK * gap) { vehRopeOne(u, H.insK); H.insK++; }
        if (!vehPassengers(u)) u.dismounted = true;
      }
      if (u.dismounted) { H.ph = "transit"; H.lz = null; H.bp = null; }
    } else H.ph = "transit";
  } else {
    const stand = heliStand(u, t);
    // the mark has moved off this position's geometry: plan again
    if (H.bp && Math.hypot(ref.x - H.refX, ref.z - H.refZ) > Math.max(80, stand * 0.25) && H.ph !== "pop") H.bp = null;
    if (!H.bp) {
      H.bp = heliPlan(u, ref, stand);
      H.refX = ref.x; H.refZ = ref.z;
      if (H.ph !== "pop" && H.ph !== "drop") H.ph = "transit";
    }
    const bp = H.bp;
    gx = bp.x; gz = bp.z;
    const dBp = Math.hypot(gx - u.pos.x, gz - u.pos.z);
    const agl = u.pos.y - MAP.groundAt(u.pos.x, u.pos.z);
    if (H.ph === "transit") {
      wantAGL = bp.lo;
      if (dBp < 25) { H.ph = "mask"; H.t = simT + (bp.masked ? 1.5 + lcg() * 3 : 0.3); }
    } else if (H.ph === "mask") {
      wantAGL = bp.lo;
      if (simT >= H.t && heliReady(u)) { H.ph = "pop"; H.win = 0; H.t = simT; H.fired0 = u.shotsF; }
    } else if (H.ph === "pop") {
      wantAGL = bp.hi;
      if (u.sees) H.win += sdt;
      const salvoOut = u.shotsF - H.fired0 >= (S.popShots || 6);
      const hit = simT - u._hitT < 0.8 && simT - H.t > 1.5;
      const blind = !u.sees && simT - H.t > 6 && Math.abs(agl - bp.hi) < 3;
      if (H.win > (S.popWindow || 7) || salvoOut || hit || blind || (!heliReady(u) && H.win > 2)) {
        H.ph = "drop";
        if (blind) H.bp.masked = false;            // this hide cannot see: the next one must
      }
    } else {                                         // drop: back behind the mask, then sidestep
      wantAGL = bp.lo;
      if (Math.abs(agl - bp.lo) < 2.5 || !bp.masked) {
        H.shift = D.clamp(H.shift * 0.5 + (lcg() < 0.5 ? -1 : 1) * (0.18 + lcg() * 0.22), -1.2, 1.2);
        H.bp = null; H.ph = "transit";
      }
    }
    // the nose: on the mark at the position (the rockets and the Hellfire
    // need it there), along the track on the way
    if (H.ph !== "transit" || dBp < 400 || u._wantNose) face = Math.atan2(ref.x - u.pos.x, ref.z - u.pos.z);
    // a door-gun aircraft turns a side to the mark (stats.broadside rad), alternating with the sidestep
    if (face != null && S.broadside && !u._wantNose) face -= (H.shift >= 0 ? 1 : -1) * S.broadside;
  }
  const dx = gx - u.pos.x, dz = gz - u.pos.z, d = Math.hypot(dx, dz);
  const travel = Math.atan2(dx, dz);
  if (face == null) face = d > 30 ? travel : u.h;
  const turn = S.turn || 0.8, h0 = u.h;
  u.h = D.lay(u.h, face, turn, sdt);
  u.ds.w = sdt > 0 ? D.wrap(u.h - h0) / sdt : 0;
  // speed: brisk in transit, a crawl onto the spot
  const vmax = Math.min(S.speed || 70, H.ph === "transit" ? (S.speed || 70) * 0.75 : 12);
  const v = Math.min(vmax, d * 0.4);
  u.ds.v += D.clamp(v - u.ds.v, -(S.accel || 6) * sdt, (S.accel || 6) * sdt);
  if (d > 1) { u.pos.x += dx / d * u.ds.v * sdt; u.pos.z += dz / d * u.ds.v * sdt; }
  // height: terrain-following (ground under him and 80 m ahead along the track)
  const g0 = MAP.groundAt(u.pos.x, u.pos.z);
  let gRef = g0;
  if (u.ds.v > 5 && d > 40) gRef = Math.max(g0, MAP.groundAt(u.pos.x + dx / d * 80, u.pos.z + dz / d * 80));
  const wantY = gRef + wantAGL;
  const vyW = D.clamp((wantY - u.pos.y) * 1.2, -climb, climb);
  u.ds.vy += D.clamp(vyW - u.ds.vy, -6 * sdt, 6 * sdt);
  u.pos.y += u.ds.vy * sdt;
  if (u.pos.y < g0 + 1) { u.pos.y = g0 + 1; u.ds.vy = Math.max(0, u.ds.vy); }
  u.speed = u.ds.v;
  u.airPhase = H.ph;
  // forward flight is nose-down (the disc tilts the airframe with it)
  const fwd = d > 1 ? (dx * Math.sin(u.h) + dz * Math.cos(u.h)) / d * u.ds.v : 0;
  u.ds.pitch += (D.clamp(fwd / 300, -0.12, 0.25) - u.ds.pitch) * Math.min(1, sdt * 2);
  u.group.rotation.set(u.ds.pitch, u.h, 0);
  u.yaw = u.h; u.heading = u.h;
}
function stepJet(u, sdt) {
  const D = CBZ.vehicleDrive, S = u.def.stats || {};
  const enemy = u.team === "red" ? "blue" : "red";
  const com = teamCOM[enemy];
  const spd = S.speed || 200;
  const turn = Math.min(S.turn || 0.3, 9.81 * Math.tan(1.05) / Math.max(30, spd));
  const R = spd / turn;                                   // the turn circle
  const cruise = S.alt || 300;
  const t = u.tgt && !u.tgt.dead && !u.tgt.fled && !S.airdrop ? u.tgt : null;
  const ref = t ? t.pos : com;
  const W = S.airdrop ? null : vehAirWeapon(u, t);
  const w = W ? W.w : null;
  const kind = w ? w.kind : "none";
  const dive = kind === "autocannon" || kind === "mg" || kind === "rockets" || kind === "cannon";
  const runAlt = w && w.alt ? w.alt : (dive ? Math.min(cruise, 1500) : cruise);
  const dRef = Math.hypot(u.pos.x - ref.x, u.pos.z - ref.z);
  const gRef = MAP.groundAt(ref.x, ref.z);
  // where the weapon is let go, horizontally from the mark
  let release = 300;
  if (kind === "bombs") release = spd * Math.sqrt(2 * runAlt / 9.81);
  else if (w && (kind === "missile" || kind === "sam")) release = (w.range || 6000) * 0.85;
  else if (dive) release = (w.range || 1500);
  let gx, gz, wantAGL = runAlt;
  if (u.egress) { gx = MAP.cx + (u.team === "red" ? -4200 : 4200); gz = MAP.cz; wantAGL = cruise; }
  else if (u.airPhase === "out") {
    gx = u.airPt.x; gz = u.airPt.z;
    wantAGL = Math.max(runAlt, cruise * 0.6);
    // far enough out to turn and line up a run that reaches its release point
    if (dRef > Math.max(1600, R * 2.2, release + R * 1.2)) u.airPhase = "in";
  } else {
    u.airPhase = "in";
    gx = ref.x; gz = ref.z;
    if (dive) {
      // the dive line: height over the mark = distance x tan(dive)
      const dv = w.dive || 0.3, floor = w.pullOut || 250;
      wantAGL = D.clamp(dRef * Math.tan(dv), floor, runAlt);
      if (dRef < floor / Math.tan(dv) * 1.1) vehJetBreak(u, R);
    }
    const offAxis = Math.abs(D.wrap(Math.atan2(ref.x - u.pos.x, ref.z - u.pos.z) - u.h));
    if (dRef < 140 || (offAxis > 0.9 && dRef < R * 2)) vehJetBreak(u, R);
    // a missile shooter breaks off once it is inside its own stand-off
    else if ((kind === "missile" || kind === "sam") && dRef < Math.max((w.minRange || 300) * 2, release * 0.35)) vehJetBreak(u, R);
    if (S.airdrop && !u.dismounted && dRef < 140) vehDismount(u);
  }
  const dx = gx - u.pos.x, dz = gz - u.pos.z;
  const want = Math.atan2(dx, dz);
  const err = D.wrap(want - u.h);
  const h0 = u.h;
  u.h = D.lay(u.h, want, turn, sdt);
  u.ds.w = sdt > 0 ? D.wrap(u.h - h0) / sdt : 0;
  u.ds.roll += (D.clamp(err * 1.4, -1, 1) - u.ds.roll) * Math.min(1, sdt * 2);
  // the flight path angle: climb or dive toward the height this leg wants
  const g0 = MAP.groundAt(u.pos.x, u.pos.z);
  const base = u.airPhase === "in" && dRef < 20000 ? gRef : g0;
  const wantY = Math.max(base + wantAGL, g0 + 60);
  const gmax = dive ? 0.6 : 0.3;
  // on the dive line the path angle IS the line's slope (fed forward), plus
  // a correction back onto it; anywhere else, climb or descend to the height
  let ff = 0;
  if (dive && u.airPhase === "in" && !u.egress) { const dv = w.dive || 0.3; if (wantAGL < runAlt - 1 && wantAGL > (w.pullOut || 250) + 1) ff = -dv; }
  const gWant = D.clamp(ff + Math.atan2(wantY - u.pos.y, Math.max(200, spd * 3)), -gmax, gmax * 0.8);
  u.ds.gamma += D.clamp(gWant - u.ds.gamma, -0.5 * sdt, 0.5 * sdt);
  u.ds.v = spd;
  const vh = spd * Math.cos(u.ds.gamma);
  u.pos.x += Math.sin(u.h) * vh * sdt; u.pos.z += Math.cos(u.h) * vh * sdt;
  u.pos.y += spd * Math.sin(u.ds.gamma) * sdt;
  if (u.pos.y < g0 + 60) { u.pos.y = g0 + 60; if (u.ds.gamma < 0) u.ds.gamma *= 0.5; }
  u.ds.vy = spd * Math.sin(u.ds.gamma);
  u.speed = spd;
  u.group.rotation.set(-u.ds.gamma, u.h, -u.ds.roll * 0.9);
  u.yaw = u.h; u.heading = u.h;
}
// off the mark: straight on past it, far enough to come round again
function vehJetBreak(u, R) {
  u.airPhase = "out";
  const L = Math.max(1800, R * 2.5);
  u.airPt = { x: u.pos.x + Math.sin(u.h) * L, z: u.pos.z + Math.cos(u.h) * L };
}
// a bomber lets go when the fall lands on the mark (a guided bomb: near enough to steer)
function vehBombRun(u, W, t) {
  if (u.airPhase === "out") return;
  const w = W.w, he = w.he || { pen: 120, beh: 1500, blast: 18, power: 2.6 };
  const agl = u.pos.y - MAP.groundAt(t.pos.x, t.pos.z);
  const tf = Math.sqrt(2 * Math.max(10, agl) / 9.81);
  const vh = u.ds.v * Math.cos(u.ds.gamma || 0);
  const lead = vh * tf;
  const fx = u.pos.x + Math.sin(u.h) * lead, fz = u.pos.z + Math.cos(u.h) * lead;
  const miss = Math.hypot(fx - t.pos.x, fz - t.pos.z);
  const basket = w.guided ? Math.max(he.blast * 1.5, lead * (w.basket || 0.15)) : Math.max(40, he.blast * 1.5);
  if (miss > basket) return;
  vehRelease(u, W, he, w.guided ? t : null, tf);
}
function vehRelease(u, W, he, guideTo, tf) {
  const w = W.w;
  stats[u.team].shots++; u.shotsF++; u.lastShotT = simT;
  W.ammo--;
  W.salvo++;
  if (w.salvo && W.salvo >= w.salvo) { W.salvo = 0; W.reloadT = w.reload || 20; }
  W.cool = 1 / Math.max(0.01, w.rof || 4);
  const shot = vehShotOf(u, W, guideTo);
  if (u.rig && typeof u.rig.fire === "function") { try { u.rig.fire(shot, u.pos); } catch (e) {} }
  u._firing = null;
  u.actx.firing = shot;
  u._he = { pen: he.pen, beh: he.beh, he: true, cls: "bomb" };
  const vh = u.ds.v * Math.cos(u.ds.gamma || 0);
  const vel = new THREE.Vector3(Math.sin(u.h) * vh, -2, Math.cos(u.h) * vh);
  if (guideTo && tf > 0) {
    // the seeker flies out the cross-track error: the bomb is on the mark's line
    vel.x = (guideTo.pos.x - u.pos.x) / tf; vel.z = (guideTo.pos.z - u.pos.z) / tf;
  }
  // a guided bomb keeps steering onto the mark all the way down (fire.js stepRockets: `homing`)
  const fall = tf || Math.sqrt(2 * Math.max(10, u.pos.y - MAP.groundAt(u.pos.x, u.pos.z)) / 9.81);
  rockets.push({
    pos: V().set(u.pos.x, u.pos.y - 2, u.pos.z),
    vel: vel,
    grav: 9.81, t: 0, by: u, life: Math.max(40, fall * 1.4 + 5), homing: guideTo || null,
    w: { blastRadius: he.blast, blastPower: he.power / 0.55 },
    trail: CBZ.studio.trail({ length: 8, color: 0x404040, opacity: 0.25, minStep: 6 }),
  });
}

/* ------------------------------------------------------------- the hits */
// hurtMan hands every hit on a vehicle here: armour first, then damage
function hurtVehicle(u, dmg, imp) {
  if (!u || u.dead || u.fled || !(dmg > 0) || over) return;
  imp = imp || {};
  const D = CBZ.vehicleDrive;
  const by = imp.by || null;
  const th = D.threatOf(imp, by);
  let fx = u.pos.x, fz = u.pos.z;
  if (imp.fromX != null) { fx = imp.fromX; fz = imp.fromZ; }
  else if (by && by.pos) { fx = by.pos.x; fz = by.pos.z; }
  const above = th.top || (by && by.pos && by.pos.y - u.pos.y > 30 && Math.hypot(fx - u.pos.x, fz - u.pos.z) < (by.pos.y - u.pos.y) * 2);
  const zn = D.zone(u.h, fx, fz, u.pos.x, u.pos.z, above);
  const res = D.resolve(u.vs, u.def.stats || {}, zn, th, dmg, lcg);
  u.hp = Math.max(0, u.vs.hp);
  u.lastHit = res;
  if (PROBE) { VEH.hits = VEH.hits || { pen: 0, bounced: 0 }; if (res.pen) VEH.hits.pen++; else VEH.hits.bounced++; }
  // getting hit is information: turn the gun on whoever did it
  if (by && by.team && by.team !== u.team && (!u.tgt || u.tgt.dead || u.tgt.fled)) u.tgt = by;
  u._hitT = simT;                                   // a helicopter under fire ducks (stepRotor)
  if (res.firepower) for (let k = 0; k < u.wpn.length; k++) if (u.wpn[k].w.turret) u.wpn[k].off = true;
  // the rig shows what this hit did (a drooped gun, a thrown track, a fire)
  if (u.rig && typeof u.rig.damage === "function") { try { u.rig.damage(u.vs, res); } catch (e) {} }
  // what got through the plate kills the men it passes
  if (res.pen && !u.vs.wreck) vehCrewHits(u, res, th, zn, fx, fz, by);
  if (u.vs.wreck || u.vs.hp <= 0) { killMan(u, imp); return; }
  // a hull with nobody left alive in it is out of the fight
  if (vehCrewN(u) === 0) { u._abandoned = true; killMan(u, imp); return; }
  // a hull that can neither move nor fight is abandoned
  if (u.vs.mobility && (u.vs.firepower || !u.wpn.length)) { u._abandoned = true; killMan(u, imp); return; }
  if (res.pen && vehPassengers(u) && !(u.air && u.pos.y - MAP.groundAt(u.pos.x, u.pos.z) > 3)) vehDismount(u);
  if (u.air && u.vs.mobility) { u._abandoned = true; killMan(u, imp); }
}
/* CREW CASUALTIES BY SEAT. A penetration enters through the face it hit
   (`zn`), on the line from whoever fired it, and its spall runs on through
   the hull. Each crewman (and passenger) is at his seat's `pos` in hull
   space; the nearer his seat to that line, the likelier he is hit:
   p = min(0.9, beh / 600) x exp(-distance / 1.1 m). A big round through
   the turret kills the turret crew, a rifle round through a Humvee door
   kills the man behind it, the driver up front lives. */
function vehCrewHits(u, res, th, zn, fx, fz, by) {
  const L = u.vlen, Wd = u.vwid, H = u.vheight;
  // the threat's direction in hull space (x port, z forward)
  const wx = fx - u.pos.x, wz = fz - u.pos.z;
  const c = Math.cos(u.h), s = Math.sin(u.h);
  let dx = wx * c - wz * s, dz = wx * s + wz * c;
  const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
  // where it came in, and its path inward
  let ix, iy, iz, px, py, pz;
  if (zn === "top") { ix = (lcg() - 0.5) * Wd; iz = (lcg() - 0.5) * L; iy = H; px = 0; py = -1; pz = 0; }
  else {
    const tt = Math.min(Wd / Math.max(1e-3, Math.abs(dx)), L / Math.max(1e-3, Math.abs(dz)));
    ix = dx * tt; iz = dz * tt; iy = H * (0.35 + lcg() * 0.45); px = -dx; py = 0; pz = -dz;
  }
  const reach = zn === "top" ? H : (Math.abs(px) > Math.abs(pz) ? Wd * 2 : L * 2) * 0.8;
  const beh = Math.max(th.beh || 0, res.dmg || 0);
  const pk = Math.min(0.9, beh / 600);
  let lost = 0;
  for (let k = 0; k < u.seats.length; k++) {
    const seat = u.seats[k];
    if (!seat.man && !seat.implicit) continue;
    const p = seat.pos || [0, 1.5, 0];
    // distance from the seat to the spall segment
    const ax = p[0] - ix, ay = p[1] - iy, az = p[2] - iz;
    const along = Math.max(0, Math.min(reach, ax * px + ay * py + az * pz));
    const d = Math.hypot(ax - px * along, ay - py * along, az - pz * along);
    if (lcg() >= pk * Math.exp(-d / 1.1)) continue;
    lost++;
    if (seat.implicit) { seat.implicit = false; continue; }
    const man = CBZ.vehicleDrive.unseat(u.seats, seat);
    if (!man) continue;
    man.dead = true; man.hp = 0; man.inVeh = null;
    DEADN[man.team] = (DEADN[man.team] || 0) + 1;
    if (man.group) CBZ.studio.drop(man.group);
    if (by && by.team && by.team !== u.team) by.kills = (by.kills || 0) + 1;
  }
  if (lost) { u.crewLost = (u.crewLost || 0) + lost; if (PROBE) { VEH.crewLost = (VEH.crewLost || 0) + lost; } }
  return lost;
}
// killMan's vehicle half: the crew gets out (or does not), the hull burns
function vehicleWrecked(u, imp) {
  u.dieT = 0;
  const catastrophic = !!(u.vs.wreck && u.vs.burning) || (u.vs.hp < -u.maxHp * 0.3);
  vehBailOut(u, catastrophic && !u._abandoned);
  u.burnT = u.vs.burning || catastrophic ? 40 + lcg() * 40 : 0;
  if (u.you) { u.you = false; }
  if (u.air) { u.fallV = 0; u.crashed = false; }
  // blacken it
  if (u.group && !u._black) {
    u._black = true;
    u.group.traverse(function (o) {
      if (!o.isMesh || !o.material || !o.material.color) return;
      if (Array.isArray(o.material)) return;
      o.material = o.material.clone();
      o.material.color.multiplyScalar(catastrophic ? 0.28 : 0.55);
    });
  }
  if (catastrophic && CBZ.muzzleFlash) { try { CBZ.muzzleFlash(u.pos, { scale: 9, life: 0.4, color: 0xffb060 }); } catch (e) {} }
}
function stepWreck(u, sdt) {
  if (u.air && !u.crashed) {
    // an aircraft that dies falls
    u.fallV = (u.fallV || 0) + 9.81 * sdt;
    u.pos.y -= u.fallV * sdt;
    u.pos.x += Math.sin(u.h) * (u.ds.v || 0) * 0.6 * sdt; u.pos.z += Math.cos(u.h) * (u.ds.v || 0) * 0.6 * sdt;
    u.group.rotation.z += sdt * 0.8; u.group.rotation.x += sdt * 0.3;
    const g = MAP.groundAt(u.pos.x, u.pos.z);
    if (u.pos.y <= g + 0.5) {
      u.pos.y = g + 0.5; u.crashed = true;
      if (CBZ.studio.boom) CBZ.studio.boom({ x: u.pos.x, y: g + 1, z: u.pos.z }, { radius: Math.min(20, 6 + u.vlen * 0.5), power: 1.6, structural: false, by: null });
    }
  }
  if (u.burnT > 0) {
    u.burnT -= sdt;
    u._smokeT = (u._smokeT || 0) - sdt;
    if (u._smokeT <= 0 && CBZ.cityCrashSmoke) { u._smokeT = 0.7; try { CBZ.cityCrashSmoke(u.pos.x, u.pos.y + u.vheight, u.pos.z, { count: 2, scale: 1.2 }); } catch (e) {} }
  }
}

/* ------------------------------------------------------------- bodies */
/* a man against a hull: the hull is a box, it is not shoved, and the man
   is put outside it. Two vehicles share the push by mass. Aircraft above
   the field are nobody's neighbour. */
function pushVehicle(m, o, k) {
  if (m.air || o.air) return;
  if (Math.abs(m.pos.y - o.pos.y) > 3.5) return;
  if (m.vehicle && o.vehicle) {
    const clr = m.rad + o.rad + Math.min(m.vlen, o.vlen) * 0.5;
    const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z, d = Math.hypot(dx, dz);
    if (d >= clr || d < 1e-4) return;
    const tot = m._mass + o._mass, push = clr - d;
    m.pos.x -= dx / d * push * (o._mass / tot); m.pos.z -= dz / d * push * (o._mass / tot);
    o.pos.x += dx / d * push * (m._mass / tot); o.pos.z += dz / d * push * (m._mass / tot);
    sepFixed++;
    return;
  }
  const v = m.vehicle ? m : o, b = m.vehicle ? o : m;
  if (b._apeHeld || b._apeFlying) return;
  const fx = Math.sin(v.h), fz = Math.cos(v.h);
  const rx = b.pos.x - v.pos.x, rz = b.pos.z - v.pos.z;
  const along = rx * fx + rz * fz, across = rx * fz - rz * fx;
  const r = b.rad || 0.45, hl = v.vlen + r, hw = v.vwid + r;
  if (Math.abs(along) >= hl || Math.abs(across) >= hw) return;
  // out through the nearest face
  const pa = hl - Math.abs(along), pc = hw - Math.abs(across);
  let nx, nz, amt;
  if (pa < pc) { const s = along >= 0 ? 1 : -1; nx = fx * s; nz = fz * s; amt = pa; }
  else { const s = across >= 0 ? 1 : -1; nx = fz * s; nz = -fx * s; amt = pc; }
  b.pos.x += nx * amt; b.pos.z += nz * amt;
  b.resT = 0;
  sepFixed++;
}

/* ------------------------------------------------------------- the look */
/* THE UNIT ANIMATES ITSELF, ON THE BATTLE CLOCK. Every sim step (so it
   stops when the battle is paused and follows the speed dial), for every
   vehicle kind, alive or wrecked, the unit file's animate(veh, dt, ctx) is
   called with what the sim knows about the hull this step (ctx, see the
   contract in docs/npcwar/ARCHITECTURE.md). Distance LOD as for every other
   body (battle/core/lod.js): a far hull is animated every 2nd or 4th step
   with the steps' summed dt. A unit with no animate gets the shared one:
   its rig's update(dt, v, w, steer), and for an aircraft the milAir surface
   and rotor helper. ctx.shared(dt) runs that from inside a unit's own. */
function vehAnimate(u, sdt) {
  u._animAcc = (u._animAcc || 0) + sdt;
  u._animN = ((u._animN || 0) + 1) & 1023;
  const every = CBZ.battleLod ? CBZ.battleLod.animEvery(camDist2(u.pos)) : 1;
  if (u._animN % every) return;
  const dt = Math.min(0.25, u._animAcc);
  u._animAcc = 0;
  const c = u.actx, gy = MAP.groundAt(u.pos.x, u.pos.z);
  c.t = simT; c.dt = dt;
  c.dead = !!u.dead; c.wreck = !!u.vs.wreck; c.burning = !!(u.vs.burning || u.burnT > 0);
  c.agl = u.pos.y - gy; c.speed = u.ds.v; c.vy = u.ds.vy || 0; c.yawRate = u.ds.w || 0;
  c.steer = u.ds.steer || 0; c.throttle = u.ds.throttle || 0; c.gamma = u.ds.gamma || 0;
  c.target = u.tgt && !u.tgt.dead ? u.tgt : null; c.phase = u.airPhase || "";
  const A = u.def.animate;
  if (typeof A === "function") {
    try { A(u, dt, c); }
    catch (e) { if (!u._animErr) { u._animErr = true; console.warn("[war] " + u.unitId + ".animate threw:", e); } }
  } else vehAnimShared(u, dt);
  c.firing = null;                                 // a shot is news for one animate only
}
function vehAnimShared(u, dt) {
  if (u.dead) return;
  if (u.rig && u.rig.update) { try { u.rig.update(dt, u.ds.v, u.ds.w, u.ds.steer || 0); } catch (e) {} }
  if (u.air && CBZ.milAirDrive) {
    try { CBZ.milAirDrive(u.group, { thr: u.def.drive === "rotor" ? 0.8 : 0.7, agl: u.pos.y - MAP.groundAt(u.pos.x, u.pos.z) }, dt); } catch (e) {}
  }
}

/* ------------------------------------------------------------- YOU drive */
/* Tap a vehicle (or the rifle button on a side with one) and you are its
   crew (player.js takeOver). Move = drive (W/S throttle, A/D steer, the
   stick on a phone); the look lays the turret, pulled onto the auto-target;
   attack fires the gun for the mark the way the crew would choose it: the
   main gun at armour, the machine gun at men in its range, the main gun
   when it is the only thing that reaches. X takes a seat by hand (and keeps
   it). The chase cam rides the turret while you work the gun (camera.js
   frameChase). */
function vehYouSeatWeapon(u, t) {
  const list = u.wpn.filter(function (W) { return (W.w.kind !== "bombs" || u.air) && !W.off; });
  if (!list.length) return null;
  if (u._youSeat != null || !t) return list[(u._youSeat || 0) % list.length];
  // the unit file's moves(veh, tgt, ctx) may name the weapon for this mark (a door gun on its side)
  if (typeof u.def.moves === "function") {
    let id = null;
    try { id = u.def.moves(u, t, { dist: Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z) }); } catch (e) { id = null; }
    for (let k = 0; id && k < list.length; k++) if (list[k].w.id === id && list[k].ammo > 0) return list[k];
  }
  const dist = Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z);
  let best = null, bs = -1e9;
  for (let k = 0; k < list.length; k++) {
    const W = list[k], w = W.w;
    if (W.ammo <= 0 || (w.kind !== "bombs" && (dist > (w.range || 600) || dist < (w.minRange || 0)))) continue;
    if (!vehWeaponFits(u, w, t)) continue;
    let s = 0;
    // a weapon whose mount cannot bear on the mark from here comes second
    // (the nose is off for a fixed gun, the mark is behind a chin gun's arc)
    if (W.mount === "fixed" || W.mount === "slew") {
      if (Math.abs(CBZ.vehicleDrive.wrap(Math.atan2(t.pos.x - u.pos.x, t.pos.z - u.pos.z) - u.h)) > W.arc) s -= 2;
    }
    if (t.vehicle) s = (w.kind === "cannon" || w.kind === "missile" || w.kind === "autocannon") ? 3 : (w.pen || 0) * 2 > ((t.def.stats.armour || {}).front || 0) ? 1 : -5;
    else s = w.kind === "mg" ? 3 : w.kind === "autocannon" ? 2 : 1;
    if (W.cool <= 0 && W.reloadT <= 0) s += 0.5;
    if (s > bs) { bs = s; best = W; }
  }
  return best || list[0];
}
function stepYouVehicle(u, sdt) {
  // move and attack (player.js): the stick is throttle and steering
  const I = youInput();
  if (u.air) {
    // an aircraft you ride flies its own pattern; you work the guns
    stepAir(u, sdt);
  } else vehMove(u, sdt, { throttle: I.az, steer: I.ax, brake: 0 });
  youRetarget(u, sdt);
  /* THE TURRET FOLLOWS YOUR LOOK, and the look is pulled onto the threat
     nearest it (the auto-target), so a gunner on a phone with no mouse still
     lays the gun on the man he is facing. */
  const D = CBZ.vehicleDrive, tr = u.def.turret;
  const lock = YOU.tgt && !YOU.tgt.dead ? YOU.tgt : null;
  let aimYaw = YOU.yaw;
  if (lock) {
    const b = Math.atan2(lock.pos.x - u.pos.x, lock.pos.z - u.pos.z);
    if (Math.abs(D.wrap(b - YOU.yaw)) < 0.5) aimYaw = b;
  }
  const rel = D.wrap(aimYaw - u.h);
  if (tr) {
    const el = (YOU.pitch - 0.24) * -0.8;
    if (u.rig && u.rig.aimTurret) { u.rig.aimTurret(rel, el, sdt); if (u.rig.turret) u.tur.yaw = u.rig.turret.rotation.y; }
    else {
      u.tur.yaw = D.lay(u.tur.yaw, rel, tr.rate || 1, sdt);
      const tn = u.group.getObjectByName && u.group.getObjectByName("turret");
      if (tn) tn.rotation.y = u.tur.yaw;
    }
  }
  const fire = I.atk;
  if (fire) YOU.fireAt = simT;
  const W = vehYouSeatWeapon(u, lock);
  if (!fire || !W || W.cool > 0 || W.reloadT > 0 || W.ammo <= 0 || u.vs.firepower) return;
  if (u.rig && u.rig.canFire) { let ok = true; try { ok = u.rig.canFire(W.shot) !== false; } catch (e) {} if (!ok) return; }
  /* THE GUN LINE IS THE WEAPON'S MOUNT (vehMountOf): a turret's line is the
     turret's, a slewing mount (a chin gun) follows the look inside its arc,
     a free one (a door gun, a pintle) is the look, a fixed one is the nose. */
  const yaw = W.mount === "turret" && tr ? u.h + u.tur.yaw
    : W.mount === "slew" ? u.h + D.clamp(D.wrap(aimYaw - u.h), -W.arc, W.arc)
    : W.mount === "free" ? aimYaw : u.h;
  const fxw = Math.sin(yaw), fzw = Math.cos(yaw);
  if (W.mount === "slew" && lock && u.group.userData.chinGun && CBZ.milAirAim) {
    try { CBZ.milAirAim(u.group, lock.pos.x, lock.pos.y + (lock.aimY || 1), lock.pos.z, sdt); } catch (e) {}
  }
  // the gun is still traversing onto the mark you are facing: the round waits
  // for it (a 6 s reload is not spent on the sand beside him)
  if (lock && W.mount === "turret" && tr && aimYaw !== YOU.yaw && Math.abs(D.wrap(aimYaw - yaw)) > 0.04) return;
  if (lock && W.mount === "slew" && u.rig && u.rig.aimError) {
    let e = 0; try { e = +u.rig.aimError(W.shot) || 0; } catch (er) { e = 0; }
    if (e > (W.w.tol || 0.06)) return;
  }
  if (W.w.kind === "cannon" && CBZ.shake) CBZ.shake(0.5);
  // the mark: the locked threat once the gun is on it, else whoever sits
  // nearest the gun line you can see
  let best = null, bs = Infinity;
  if (lock) {
    const dx = lock.pos.x - u.pos.x, dz = lock.pos.z - u.pos.z, d = Math.hypot(dx, dz);
    if (d > 2 && d <= (W.w.range || 900) && (dx * fxw + dz * fzw) / d > 0.985 && eyeLos(u, lock)) { best = lock; bs = -1; }
  }
  for (let k = 0; k < men.length && bs >= 0; k++) {
    const o = men[k];
    if (o.dead || o.fled || o.team === u.team) continue;
    const dx = o.pos.x - u.pos.x, dz = o.pos.z - u.pos.z, d = Math.hypot(dx, dz);
    if (d > (W.w.range || 900) || d < 2) continue;
    const along = (dx * fxw + dz * fzw) / d;
    if (along < 0.96) continue;
    const sc = (1 - along) * 400 + d * 0.01;
    if (sc < bs && eyeLos(u, o)) { bs = sc; best = o; }
  }
  if (W.w.kind === "bombs") { if (best) vehRelease(u, W, W.w.he); return; }
  if (best) { vehFire(u, W, best, Math.hypot(best.pos.x - u.pos.x, best.pos.z - u.pos.z)); return; }
  // nothing on the line: the round goes where the gun points (and counts)
  W.cool = 1 / Math.max(0.01, W.w.rof || 1); W.ammo--;
  stats[u.team].shots++; u.shotsF++; u.lastShotT = simT;
  if (shotsRing.length > 90) shotsRing.shift();
  shotsRing.push({ x: u.pos.x, z: u.pos.z, t: simT, m: u });
  const shot = vehShotOf(u, W, null);
  const from = vehicleMuzzle(u, _muz);
  _v.set(from.x + fxw * 300, MAP.groundAt(from.x + fxw * 300, from.z + fzw * 300), from.z + fzw * 300);
  if (CBZ.tracer) { try { CBZ.tracer(from, _v, { shooter: u, muzzle: true, muzzleScale: 2 }); } catch (e) {} }
  vehFx(u, from);
  u.actx.firing = shot; u._firing = null;
  missImpact(from, _v, 0);
}
