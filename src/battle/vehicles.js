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
function makeVehicle(teamId, i, id) {
  const def = vehDef(id);
  if (!def) return null;                               // unit file did not load
  const S = def.stats || {};
  const air = def.domain === "air";
  let b = null;
  // the build is told whose army it is and what ground it is on, so a unit
  // file can paint the nation's scheme (and flag) for that ground
  const bctx = { THREE: THREE, mat: CBZ.cmat, rng: lcg, seed: i, id: id, team: teamId,
    nation: (typeof SIDES !== "undefined" && SIDES[teamId] && SIDES[teamId].nation) || null, arena: MAP && MAP.id };
  try { b = def.build ? def.build(bctx) : null; } catch (e) { console.warn("[war] vehicle build failed:", id, e); }
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
    py = MAP.groundAt(px, pz) + (S.alt || 300);
  }
  group.position.set(px, py, pz);
  group.rotation.order = "YXZ";
  group.rotation.y = h;
  group.userData.dynamic = true;
  CBZ.scene.add(group);
  if (!air) noteBodyRadius(Math.min(4.5, L * 0.5));    // the fine grid must see a whole hull
  const weapons = (def.weapons || []).map(function (w) {
    return { w: w, cool: 0.5 + lcg() * 1.5, ammo: w.ammo == null ? 1e9 : w.ammo, burst: 0, salvo: 0, reloadT: 0, off: false };
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
    ds: { v: 0, w: 0, steer: 0, y: py, pitch: 0, roll: 0, trackL: 0, trackR: 0 },
    tur: { yaw: 0, elev: 0 },
    wpn: weapons, shots: [],
    alt: S.alt || 0, airPhase: "in", airPt: null, egress: false,
    home: { x: at.x, z: at.z },
    you: false,
  };
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
  if (u.dead) { stepWreck(u, sdt); return; }
  if (u.fled) return;
  stepVehShots(u, sdt);
  for (let k = 0; k < u.wpn.length; k++) {
    const W = u.wpn[k];
    W.cool -= sdt;
    if (W.reloadT > 0) { W.reloadT -= sdt; if (W.reloadT <= 0) W.salvo = 0; }
  }
  if (u.you) { stepYouVehicle(u, sdt); return; }
  if (simT >= u.thinkAt) thinkVehicle(u);
  if (u.air) { stepAir(u, sdt); vehFight(u, sdt); return; }
  const crew = vehCrewN(u);
  // one man drives OR fights: he stops when he has a shot
  const shoot = u.tgt && !u.tgt.dead && u.sees;
  const halt = crew <= 1 && shoot && u._wantShot;
  vehDriveTo(u, sdt, halt);
  vehCrush(u, sdt);
  vehFight(u, sdt);
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
  if (!u.dismounted && vehPassengers(u) > 0) {
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
  // a bomber releases kilometres short of the mark, so it has to see that far
  const range = main && main.range ? Math.min(main.range, u.air ? 6000 : 1600) : 600;
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
    wheelbase: S.wheelbase, maxSteer: S.maxSteer, grip: S.grip, mobilityKill: u.vs.mobility };
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
  const t = u.tgt;
  if (!t || t.dead || t.fled || over) return;
  if (vehCrewN(u) === 0 || u.vs.firepower) return;
  const D = CBZ.vehicleDrive, def = u.def;
  const dx = t.pos.x - u.pos.x, dz = t.pos.z - u.pos.z, dist = Math.hypot(dx, dz);
  const dy = (t.pos.y + (t.aimY || 1)) - (u.pos.y + u.eyeH * 0.85);
  // lay the turret (or the chin gun) on the mark
  const rel = D.wrap(Math.atan2(dx, dz) - u.h);
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
  if (u.air && CBZ.milAirAim && u.group.userData.chinGun) { try { CBZ.milAirAim(u.group, t.pos.x, t.pos.y + 1, t.pos.z, sdt); } catch (e) {} }
  if (def.launcher && u.rig && u.rig.aimLauncher) { try { u.rig.aimLauncher(rel, def.launcher.elevMax, sdt); } catch (e) {} }
  const aimErr = tr ? Math.abs(D.wrap(rel - u.tur.yaw)) : (u.air ? 0 : Math.abs(rel));
  u.sees = u.sees && simT - u.lastThink < 0.5 ? u.sees : eyeLos(u, t);
  if (!u.sees && !vehIndirect(u)) return;
  for (let k = 0; k < u.wpn.length; k++) {
    const W = u.wpn[k], w = W.w;
    if (W.off || W.ammo <= 0 || W.cool > 0 || W.reloadT > 0) continue;
    if (dist > (w.range || 600) || dist < (w.minRange || 0)) continue;
    if (w.vs === "air" && !t.air) continue;
    if (w.vs === "armour" && !t.vehicle) continue;
    if (w.vs === "soft" && t.vehicle && (t.def.stats.armour.side || 0) > 30) continue;
    if (t.air && !(w.vs === "air" || w.kind === "mg" || w.kind === "autocannon" || (u.air && w.kind === "missile"))) continue;
    if (w.kind === "bombs") { vehBombRun(u, W, t); continue; }
    // the big gun waits for the kill it was made for when the mark is soft
    // and a machine gun is in range; the machine gun leaves armour alone
    if (w.kind === "mg" && t.vehicle && (t.def.stats.armour.front || 0) > w.pen * 2) continue;
    if (w.kind === "cannon" && !t.vehicle && dist < 500 && vehHasMG(u, dist) && lcg() < 0.6) { W.cool = 1; continue; }
    if ((w.turret || tr) && aimErr > 0.05 && !w.indirect) { u._wantShot = true; continue; }
    if (u.air && w.kind !== "missile" && !w.indirect && Math.abs(D.wrap(Math.atan2(dx, dz) - u.h)) > 0.25 && !u.group.userData.chinGun) continue;
    u._wantShot = true;
    if (vehCrewN(u) <= 1 && u.speed > 1.2 && !u.air) continue;          // one man: stop, then shoot
    vehFire(u, W, t, dist);
    break;
  }
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
  const k = w.kind;
  if (k === "mg") return vehFireMG(u, w, t, dist);
  if (k === "missile" || k === "sam") return vehLaunch(u, w, t);
  if ((k === "cannon" || k === "autocannon") && t.vehicle) return vehFireKE(u, w, t, dist);
  return vehFireHE(u, w, t, dist);
}
function vehicleMuzzle(u, out) {
  if (u.rig && u.rig.muzzleWorld) { try { const p = u.rig.muzzleWorld(out); if (p) return p; } catch (e) {} }
  const mz = u.group.getObjectByName && u.group.getObjectByName("muzzle");
  if (mz && mz.getWorldPosition) { u.group.updateMatrixWorld(true); return mz.getWorldPosition(out); }
  const yaw = u.h + u.tur.yaw;
  return out.set(u.pos.x + Math.sin(yaw) * u.vlen * 0.8, u.pos.y + u.eyeH * 0.85, u.pos.z + Math.cos(yaw) * u.vlen * 0.8);
}
function vehFireMG(u, w, t, dist) {
  // the page's own round: fireShot draws it, lands it and keeps the ledger
  const keepWid = u.wid;
  u.wid = w.wid || "lmg"; u.mag = 999;
  u._shot = { pen: w.pen || 9, beh: w.dmg || 22, he: false, cls: "small" };
  let hit = Math.max(0.06, Math.min(0.62, 0.62 - dist / 1400));
  if (u.speed > 2) hit *= 0.7;
  if (t.air) hit *= 0.5;
  try { fireShot(u, t, { fire: true, hit: hit, dmg: (w.dmg || 22) / 1.45, cd: 0.1 }); } catch (e) {}
  u._shot = null; u.wid = keepWid;
}
// a kinetic round at armour: it either hits or it does not, now
function vehFireKE(u, w, t, dist) {
  const from = vehicleMuzzle(u, _muz);
  if (u.rig && u.rig.fired) { try { u.rig.fired(w.kind === "cannon" ? 1 : 0.3); } catch (e) {} }
  else if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash(from, { scale: w.kind === "cannon" ? 4 : 1.4 }); } catch (e) {} }
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
  if (u.rig && u.rig.fired && w.kind === "cannon") { try { u.rig.fired(1); } catch (e) {} }
  else if (u.rig && u.rig.spend && w.kind === "rockets") { try { u.rig.spend(u.rig.loaded - 1); } catch (e) {} }
  else if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash(from, { scale: 2 }); } catch (e) {} }
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
  if (u.rig && u.rig.spend && u.rig.loaded > 0) { try { u.rig.spend(u.rig.loaded - 1); } catch (e) {} }
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

/* ------------------------------------------------------------- the air */
function stepAir(u, sdt) {
  const D = CBZ.vehicleDrive, def = u.def, S = def.stats || {};
  const enemy = u.team === "red" ? "blue" : "red";
  const com = teamCOM[enemy];
  // out of ammunition (or a transport that has dropped): it goes home
  if (!u.egress) {
    let left = 0;
    for (let k = 0; k < u.wpn.length; k++) left += u.wpn[k].ammo;
    if ((u.wpn.length && left <= 0) || (S.airdrop && u.dismounted)) u.egress = true;
  }
  let gx, gz;
  const rotor = def.drive === "rotor";
  if (u.egress) {
    gx = MAP.cx + (u.team === "red" ? -4200 : 4200); gz = MAP.cz;
    if (Math.hypot(u.pos.x - MAP.cx, u.pos.z - MAP.cz) > 3200) {
      // off the map: out of the fight, not dead
      u.fled = true; if (u.group) u.group.visible = false;
      return;
    }
  } else if (rotor) {
    // hover on a firing station short of the mark, on its own side
    const ref = u.tgt && !u.tgt.dead ? u.tgt.pos : com;
    const sx = ref.x - u.pos.x, sz = ref.z - u.pos.z, sd = Math.hypot(sx, sz) || 1;
    const stand = Math.min(S.standoff || 600, 600);
    gx = ref.x - sx / sd * stand; gz = ref.z - sz / sd * stand;
    if (S.dismountAt && vehPassengers(u) > 0) { gx = teamCOM[u.team].x; gz = teamCOM[u.team].z; }
  } else {
    // fixed wing: run in on the mark (or the enemy's mass), through, turn, repeat
    /* a fast jet's turn circle is kilometres wide: chasing the mark's bearing
       inside it is an orbit that never arrives (air.js measured the same
       trap). So it flies a racetrack: in on the mark, out past it to twice
       its turn radius, round, and in again. */
    const ref = u.tgt && !u.tgt.dead && !S.airdrop ? u.tgt.pos : com;
    const R = (S.speed || 200) / Math.min(S.turn || 0.3, 9.81 * Math.tan(1.05) / Math.max(30, S.speed || 200));
    const dRef = Math.hypot(u.pos.x - ref.x, u.pos.z - ref.z);
    if (u.airPhase === "out") {
      gx = u.airPt.x; gz = u.airPt.z;
      if (dRef > Math.max(1600, R * 2.2)) u.airPhase = "in";
    } else {
      gx = ref.x; gz = ref.z;
      const offAxis = Math.abs(D.wrap(Math.atan2(ref.x - u.pos.x, ref.z - u.pos.z) - u.h));
      if (dRef < 140 || (offAxis > 0.9 && dRef < R * 2)) {
        u.airPhase = "out";
        u.airPt = { x: u.pos.x + Math.sin(u.h) * Math.max(1800, R * 2.5), z: u.pos.z + Math.cos(u.h) * Math.max(1800, R * 2.5) };
        if (S.airdrop && !u.dismounted) vehDismount(u);
      }
    }
  }
  const dx = gx - u.pos.x, dz = gz - u.pos.z, d = Math.hypot(dx, dz);
  const want = Math.atan2(dx, dz);
  const err = D.wrap(want - u.h);
  let v;
  if (rotor) {
    // a helicopter turns on the spot and creeps onto its station; facing the mark once there
    const face = u.tgt && !u.tgt.dead && d < 60 ? Math.atan2(u.tgt.pos.x - u.pos.x, u.tgt.pos.z - u.pos.z) : want;
    u.h = D.lay(u.h, face, S.turn || 0.8, sdt);
    v = Math.min(S.speed || 70, d * 0.4);
    u.ds.v += D.clamp(v - u.ds.v, -(S.accel || 6) * sdt, (S.accel || 6) * sdt);
    if (d > 1) { u.pos.x += dx / d * u.ds.v * sdt; u.pos.z += dz / d * u.ds.v * sdt; }
  } else {
    const turn = Math.min(S.turn || 0.3, 9.81 * Math.tan(1.05) / Math.max(30, S.speed || 200));
    u.h = D.lay(u.h, want, turn, sdt);
    u.ds.v = S.speed || 200;
    u.pos.x += Math.sin(u.h) * u.ds.v * sdt; u.pos.z += Math.cos(u.h) * u.ds.v * sdt;
    u.ds.roll += (D.clamp(err * 1.4, -1, 1) - u.ds.roll) * Math.min(1, sdt * 2);
  }
  const gy = MAP.groundAt(u.pos.x, u.pos.z) + (S.alt || 300);
  u.pos.y += (gy - u.pos.y) * Math.min(1, sdt * 1.2);
  u.speed = u.ds.v;
  u.group.rotation.set(rotor ? Math.min(0.25, u.ds.v / 300) : 0, u.h, rotor ? 0 : -u.ds.roll * 0.9);
  u.yaw = u.h; u.heading = u.h;
}
// a bomber lets go when the fall lands on the mark
function vehBombRun(u, W, t) {
  const w = W.w, he = w.he || { pen: 120, beh: 1500, blast: 18, power: 2.6 };
  const agl = u.pos.y - MAP.groundAt(u.pos.x, u.pos.z);
  const tf = Math.sqrt(2 * Math.max(10, agl) / 9.81);
  const lead = u.ds.v * tf;
  const fx = u.pos.x + Math.sin(u.h) * lead, fz = u.pos.z + Math.cos(u.h) * lead;
  if (Math.hypot(fx - t.pos.x, fz - t.pos.z) > Math.max(40, he.blast * 1.5)) return;
  vehRelease(u, W, he);
}
function vehRelease(u, W, he) {
  const w = W.w;
  stats[u.team].shots++; u.shotsF++; u.lastShotT = simT;
  W.ammo--;
  W.salvo++;
  if (w.salvo && W.salvo >= w.salvo) { W.salvo = 0; W.reloadT = w.reload || 20; }
  W.cool = 1 / Math.max(0.01, w.rof || 4);
  u._he = { pen: he.pen, beh: he.beh, he: true, cls: "bomb" };
  rockets.push({
    pos: V().set(u.pos.x, u.pos.y - 2, u.pos.z),
    vel: new THREE.Vector3(Math.sin(u.h) * u.ds.v, -2, Math.cos(u.h) * u.ds.v),
    grav: 9.81, t: 0, by: u, life: 40,             // a bomb from 650 m falls for 11 s
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
  if (res.firepower) for (let k = 0; k < u.wpn.length; k++) if (u.wpn[k].w.turret) u.wpn[k].off = true;
  if (u.vs.wreck || u.vs.hp <= 0) { killMan(u, imp); return; }
  // a hull that can neither move nor fight is abandoned
  if (u.vs.mobility && (u.vs.firepower || !u.wpn.length)) { u._abandoned = true; killMan(u, imp); return; }
  if (res.pen && vehPassengers(u)) vehDismount(u);
  if (u.air && u.vs.mobility) { u._abandoned = true; killMan(u, imp); }
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
  // the unit file draws its own wreck: fire where it was hit, the tyres burning off
  if (u.rig && u.rig.wrecked) { try { u.rig.wrecked(sdt, u); } catch (e) {} }
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
function animateVehicle(u, dt) {
  if (u.dead) return;
  if (u.air) {
    if (CBZ.milAirDrive) { try { CBZ.milAirDrive(u.group, { thr: u.def.drive === "rotor" ? 0.8 : 0.7, agl: u.pos.y - MAP.groundAt(u.pos.x, u.pos.z) }, dt); } catch (e) {} }
    return;
  }
  // the unit rides along as a 5th argument: crew aboard, damage, the gun's last round
  if (u.rig && u.rig.update) { try { u.rig.update(dt, u.ds.v, u.ds.w, u.ds.steer || 0, u); } catch (e) {} }
}

/* ------------------------------------------------------------- YOU drive */
/* The rifle button on a side with a vehicle puts you in it (player.js
   join). Move = drive (W/S throttle, A/D steer, the stick on a phone); the
   mouse lays the turret; attack fires the gun of your seat: the gunner's
   main gun, or the machine gun from a machine-gun seat. X changes seat. */
function vehYouSeatWeapon(u) {
  const want = u._youSeat || 0;
  const list = u.wpn.filter(function (W) { return W.w.kind !== "bombs" || u.air; });
  return list.length ? list[want % list.length] : null;
}
function stepYouVehicle(u, sdt) {
  const IN = CBZ.micro.input, T = CBZ.micro.touch;
  let thr = 0, st = 0;
  if (IN) { thr = IN.axis("KeyS", "KeyW"); st = IN.axis("KeyA", "KeyD"); }
  if (T && T.active && T.stick && T.stick.mag > 0.12) { thr = -T.stick.y; st = T.stick.x; }
  if (u.air) {
    // an aircraft you ride flies its own pattern; you work the guns
    stepAir(u, sdt);
  } else vehMove(u, sdt, { throttle: thr, steer: st, brake: 0 });
  // the turret follows your look
  const D = CBZ.vehicleDrive, tr = u.def.turret;
  const rel = D.wrap(YOU.yaw - u.h);
  if (tr) {
    const el = (YOU.pitch - 0.24) * -0.8;
    if (u.rig && u.rig.aimTurret) { u.rig.aimTurret(rel, el, sdt); if (u.rig.turret) u.tur.yaw = u.rig.turret.rotation.y; }
    else {
      u.tur.yaw = D.lay(u.tur.yaw, rel, tr.rate || 1, sdt);
      const tn = u.group.getObjectByName && u.group.getObjectByName("turret");
      if (tn) tn.rotation.y = u.tur.yaw;
    }
  }
  const fire = IN && (IN.isDown("KeyJ") || (!COARSE && IN.locked && IN.buttons[0]));
  const W = vehYouSeatWeapon(u);
  if (!fire || !W || W.cool > 0 || W.reloadT > 0 || W.ammo <= 0 || u.vs.firepower) return;
  // the mark: whoever sits nearest the gun line you can see
  const yaw = tr ? u.h + u.tur.yaw : u.h;
  const fxw = Math.sin(yaw), fzw = Math.cos(yaw);
  let best = null, bs = Infinity;
  for (let k = 0; k < men.length; k++) {
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
  // nothing on the line: the round goes where the gun points
  W.cool = 1 / Math.max(0.01, W.w.rof || 1); W.ammo--;
  const from = vehicleMuzzle(u, _muz);
  _v.set(from.x + fxw * 300, MAP.groundAt(from.x + fxw * 300, from.z + fzw * 300), from.z + fzw * 300);
  if (CBZ.tracer) { try { CBZ.tracer(from, _v, { shooter: u, muzzle: true, muzzleScale: 2 }); } catch (e) {} }
  if (u.rig && u.rig.fired && W.w.kind === "cannon") { try { u.rig.fired(1); } catch (e) {} }
  missImpact(from, _v, 0);
}
function frameYouVehicle(u, dt) {
  const IN = CBZ.micro.input;
  if (IN) {
    if (IN.pressed("KeyX")) u._youSeat = (u._youSeat || 0) + 1;
    YOU.yaw -= IN.mx * 0.0024;
    YOU.pitch = Math.max(0.05, Math.min(0.85, YOU.pitch + IN.mz * 0.002));
  }
  // the chase cam: over the hull, looking down the gun
  const ry = YOU.yaw;
  cam.wFocus.set(u.pos.x, u.pos.y + u.vheight + (u.air ? 2 : 1.2), u.pos.z);
  cam.focus.copy(cam.wFocus);
  cam.wYaw = cam.yaw = ry + Math.PI;
  cam.wPitch = cam.pitch = Math.max(0.12, YOU.pitch);
  cam.wDist = cam.dist = Math.max(9, u.vlen * 2.6);
  cam.followM = u;
}
