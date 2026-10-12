"use strict";
/* src/battle/drones.js — NPC War: THE DRONES. How an FPV strike drone, a
   Switchblade and a Shahed-136 get into the air, find something worth
   killing, fly to it and put their warhead on the right place; how the men
   who fly them behave; how everybody else shoots them down.

   A drone is a VEHICLE UNIT (src/units/vehicles/<id>.js, `drive: "drone"`,
   numbers in `def.drone`, warheads by id in units/kit/drone.js) and one body
   in the same `men` array as everyone else once it is in the air, so the
   targeting, the rounds (fire.js traces its little box), the grid and the
   win check see it with no new list. src/battle/vehicles.js hands it here:
   makeVehicle -> droneInit, stepVehicle -> stepDrone, vehicleWrecked ->
   droneKilled. Every other battle file is untouched by a war with no drones
   (DRONES.list is empty: loop.js's droneTick is one length test).

   STOWED. Before it flies a drone is kit, not a body: out of `men`, in a
   pack, in a tube or in a rack cell (droneTick places what shows: a
   Switchblade canister on a vehicle's cradle, a Shahed in its truck's cell).
   Who flies it is decided once (droneBind):
     a carrier   a vehicle of the side with a free cell for it (the Shahed's
                 rack truck: def.launches; a Humvee / JLTV / Stryker with
                 Switchblade cradles: the kit's CARRIERS) — its crew fly it
     a man       of the side, nearest the drone's own place in the roster;
                 he takes up to `perOp` of them, puts on the FPV goggles and
                 the radio (or the Switchblade's handheld ground station),
                 leaves his squad and goes back into cover behind his own
                 line (tactics.operator.back), kneels, and flies them ONE AT
                 A TIME (`prep` s to ready the next); when they are gone he
                 is a rifleman again (droneOpStep, from stepMan)
     nobody     it comes from beyond the edge: a team or a rack off the map
   A Shahed has no operator at all: it flies to coordinates on satellite
   navigation and there is no link to lose.

   THE FLIGHT (stepDrone, on the battle clock):
     launch     FPV: props spin up on the ground at the pilot's feet, it lifts
                Switchblade: the gas generator throws it out of the tube, the
                wings swing open in the first ~0.4 s, the prop unfolds, the
                motor climbs it away
                Shahed: the booster drives it up the rail and burns ~2 s, then
                drops; the engine is already turning
     transit    to the target: an FPV low (~15 m) and fast, nose first, banking
                hard; a Switchblade at ~120 m; a Shahed at cruise
     loiter     a Switchblade orbits over the fight on its sensor until the
                gunner picks the mark (tactics.priorities); a wave-off sends it
                round again when the mark is gone
     attack     an FPV goes round to where the hull is weak: behind it for the
                rear, over and behind it for the engine deck, over it for the
                roof (units/kit/drone.js WEAK, per vehicle)
     terminal   the run in: a pursuit with lead onto the aim point, at its
                dash speed; a Switchblade dives at ~60 deg onto the roof, a
                Shahed at ~45 deg onto the point it was sent to
   THE HIT (droneDetonate): the airframe's box meets the hull's box (or the
   aim point, or a man, the ground, a wall). On a hull the charge is the
   round on the trigger (u._shot: pen, beh, cls, top) at the struck point
   (imp.at): the hull's own armour by place and face answers
   (vehicles.js hurtVehicle -> units/kit/vehicle.js resolve, armourCE for a
   shaped charge), its crew are hit along the jet, an engine deck that is
   penetrated loses the engine. Then the warhead's blast (studio.boom) for
   everybody round it.

   COUNTER-DRONE. Up in the air a drone is a target like any aircraft:
   riflemen and machine guns shoot at it (vehicles.js vehicleCanTarget: low
   enough; fire.js flies every round at its small box, so most miss), a hull's
   MGs and autocannon engage it (an incoming drone is the threat of the
   moment, vehPickTarget), a SAM does not waste a missile on anything under
   its radar's floor (vehWeaponFits: stats.rcs), a rocket man does not fire
   his RPG at one. A drone that is hit hard enough falls (droneFall): it
   keeps its momentum, tumbles, and crashes in a spray of its own pieces; its
   warhead sometimes goes off where it lands. A Shahed is LOUD: men within
   `heard` m look up for it.
   JAMMING is not modelled (no electronic-warfare unit exists yet): the one
   place it would answer is droneLink().

   THE LEDGER (DRONES.audit): launched, hits by zone and penetration, shot
   down by what, lost links, misses. */

const DRONES = {
  list: [],                                   // every drone unit of this war, any phase
  tubes: [],                                  // launch tubes riding a carrier's cradle
  claims: { red: new Map(), blue: new Map() },// mark -> drones committed to it
  audit: { launched: 0, hits: 0, pens: 0, zones: {}, spent: 0, shotDown: 0, downBy: {}, lostLink: 0, missed: 0, waveOffs: 0,
    crashBooms: 0, byClass: {} },
};
let _dq = null, _dq2 = null, _de = null, _dv = null, _dv2 = null, _dm = null, _dax = null, _day = null, _daz = null;
CBZ.npcwar.onBoot(function () {
  _dq = new THREE.Quaternion(); _dq2 = new THREE.Quaternion(); _de = new THREE.Euler(0, 0, 0, "YXZ");
  _dv = new THREE.Vector3(); _dv2 = new THREE.Vector3(); _dm = new THREE.Matrix4();
  _dax = new THREE.Vector3(); _day = new THREE.Vector3(); _daz = new THREE.Vector3();
});
function droneWrapA(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
function droneClampN(v, a, b) { return v < a ? a : (v > b ? b : v); }

/* ------------------------------------------------------------- spawn */
function droneInit(u) {
  const D = u.def.drone || {}, K = CBZ.droneKit;
  const whs = D.warheads || [];
  const wid = whs.length ? whs[u.i % whs.length] : null;
  u.drone = true;
  u.dr = {
    ph: "stowed", cls: D.cls || "fpv", frame: D.frame || "quad", wid: wid, wh: (K && K.warhead(wid)) || { pen: 300, beh: 400, cls: "heat", blast: 5, power: 1, blastPen: 10, anti: "armour", dud: 0.2 },
    op: null, carrier: null, cell: null, slot: -1, remote: false, bound: false, off: false, readyT: 0,
    t: 0, tgt: null, zone: null, aim: null, face: "top", commitT: 0,
    vel: V(), spd: 0, bat: D.endurance || 600, prop: 0, wings: 0, boost: 0, dropped: false,
    link: true, loiterC: null, scanT: 0, orbitDir: (u.i & 1) ? 1 : -1, waveOffs: 0, launchedAt: -1, lastY: 0, tube: null,
  };
  if (u.rig && u.rig.setWarhead) { try { u.rig.setWarhead(wid); } catch (e) {} }
  // the sights and the rounds see the airframe's own box, not a man-sized one
  const h = u.vheight || 0.2;
  u.aimY = u.aimY0 = h * 0.5; u.losY = u.losY0 = h * 0.5; u.eyeH = u.eyeH0 = h; u.headY = u.headY0 = h;
  u.rad = Math.max(0.25, Math.min(1.5, u.vwid));
  // nobody's rifleman, and not a bomb's mark
  const sq = squads[u.team][u.sq];
  if (sq) { const k = sq.indexOf(u); if (k >= 0) sq.splice(k, 1); }
  if (u.ordTgt) { u.ordTgt.alive = false; if (CBZ.ordnance && CBZ.ordnance.removeTarget) { try { CBZ.ordnance.removeTarget(u.ordTgt); } catch (e) {} } u.ordTgt = null; }
  u.group.visible = false;
  u.speed = 0;
  u.thinkAt = 0;
  const C = DRONES.audit.byClass[u.unitId] || (DRONES.audit.byClass[u.unitId] = { n: 0, launched: 0, hits: 0, shotDown: 0, spent: 0 });
  C.n++;
  DRONES.list.push(u);
}

/* ------------------------------------------------------------- stowed: who flies it, when it goes */
function droneTick(sdt) {
  for (let i = 0; i < DRONES.list.length; i++) {
    const u = DRONES.list[i];
    if (u.dr.ph !== "stowed") continue;
    if (!u.dr.off) {                            // kit in a pack is not a body on the field
      const k = men.indexOf(u);
      if (k >= 0) men.splice(k, 1);
      u.dr.off = true;
    }
    droneStowed(u, sdt);
  }
  // the empty tubes ride their carrier's cradle
  for (let i = 0; i < DRONES.tubes.length; i++) { const T = DRONES.tubes[i]; if (!T.v.dead) dronePlaceOn(T.obj, T.v, T.C, T.k); }
}
function droneStowed(u, sdt) {
  const dr = u.dr, D = u.def.drone || {};
  if (!dr.bound) { droneBind(u); if (!dr.bound) return; }
  if (dr.carrier) dronePlaceStowed(u);
  if (over) return;
  // its operator killed before it flew: a mate picks up the kit, or it stays in the pack
  if (dr.op && (dr.op.dead || dr.op.fled || dr.op.downed)) {
    const was = dr.op;
    if (was.droneOp) { const L = was.droneOp.drones, k = L.indexOf(u); if (k >= 0) L.splice(k, 1); }
    dr.op = null; dr.bound = false;
    droneBind(u, was);
    if (!dr.bound || dr.remote) { droneScrub(u); return; }
  }
  if (dr.carrier && (dr.carrier.dead || dr.carrier.fled)) { droneScrub(u); return; }
  if (simT < dr.readyT || !droneMayLaunch(u)) return;
  // it goes when there is something for it: a target in reach, or (a loiterer)
  // an enemy on the field to go and look for (asked once a second: the pick
  // walks the roster)
  if (simT < (dr.lookT || 0)) return;
  dr.lookT = simT + 0.8 + lcg() * 0.4;
  const from = dr.op ? dr.op.pos : dr.carrier ? dr.carrier.pos : u.pos;
  const tgt = droneChoose(u, from);
  if (!tgt && dr.cls !== "loiter") return;
  if (!tgt && aliveCount(u.team === "red" ? "blue" : "red") <= 0) return;
  droneLaunch(u, tgt);
}
// the kit of a team that is gone: it never flies (and is not a casualty)
function droneScrub(u) {
  u.dr.ph = "scrubbed";
  u.group.visible = false;
  const k = DRONES.list.indexOf(u);
  if (k >= 0) DRONES.list.splice(k, 1);
}
function droneBind(u, was) {
  const dr = u.dr, D = u.def.drone || {}, K = CBZ.droneKit;
  // 1. a carrier with a free cell for it
  if (K && !was) {
    for (let i = 0; i < men.length; i++) {
      const v = men[i];
      if (!v.vehicle || v.air || v.dead || v.team !== u.team) continue;
      const C = K.carrierOf(v, u.unitId);
      if (!C) continue;
      const cells = v._droneCells || (v._droneCells = []);
      let k = -1;
      for (let j = 0; j < C.slots.length; j++) if (!cells[j]) { k = j; break; }
      if (k < 0) continue;
      cells[k] = u;
      dr.carrier = v; dr.cell = C; dr.slot = k; dr.bound = true;
      droneSiteEarly(v);
      dr.readyT = simT + 3 + k * 2;
      // a Switchblade's canister rides the cradle, a Shahed sits in its cell
      if (dr.frame === "wing" && u.rig && u.rig.tube) {
        dr.tube = u.rig.tube;
        if (!dr.tube.parent) CBZ.scene.add(dr.tube);
        DRONES.tubes.push({ obj: dr.tube, v: v, C: C, k: k });
      }
      if (D.launch === "rail") u.group.visible = true;
      dronePlaceStowed(u);
      return;
    }
  }
  // the carriers (and the enemy a team hides from) may still be in the spawn queue
  if (!was && spawnQueue.length && simT < 12) return;
  // 2. a man of the side to fly it (a Shahed needs nobody)
  if (D.launch !== "rail") {
    const want = dr.frame === "quad" ? "fpv" : "gcs";
    let best = null, bs = Infinity;
    const ref = was ? was.pos : (u.home || u.pos);
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.team !== u.team || m.vehicle || m.beast || m.dead || m.fled || m.downed || m.inVeh || m.you || m.routed || m.surrendered) continue;
      const O = m.droneOp;
      if (O && (O.done || O.kind !== want || O.drones.length >= (D.perOp || 3))) continue;
      // a team already flying this kind first, then the nearest man
      const d = Math.hypot(m.pos.x - ref.x, m.pos.z - ref.z) - (O ? 400 : 0);
      if (d < bs) { bs = d; best = m; }
    }
    if (best) {
      if (!best.droneOp) {
        droneOpTake(best, want, u.def);
        // a team picked as the war opens set up back there before it began
        // (the war room has one start line; a drone team's is behind it)
        if (simT < 14 && !was) {
          const P = best.droneOp.post = droneOpPost(best);
          best.pos.set(P.x, HOST.groundAt(P.x, P.z), P.z);
          best.home = { x: P.x, z: P.z };
          best.droneOp.atPost = true;
        }
      }
      best.droneOp.drones.push(u);
      dr.op = best; dr.bound = true;
      dr.readyT = Math.max(simT + (was ? 8 : 4), best.droneOp.readyT || 0);
      return;
    }
    if (!was && spawnQueue.length) return;
  }
  // 3. nobody: it comes from beyond the edge (a team, or a rack, off the map)
  if (was) { dr.bound = false; return; }
  dr.remote = true; dr.bound = true;
  dr.readyT = simT + 2 + (u.i % 6) * 6;
}
/* A RACK TRUCK THAT IS PART OF THE OPENING was at its launch site before the
   war began (the war room has one start line; a launcher's is well behind
   it): set it there, its tail (and the rack over it) to the enemy. */
function droneSiteEarly(v) {
  const tac = v.def.tactics || {};
  if (!tac.holdUntilEmpty || v._droneSite || simT > 14) return;
  const S = v._droneSite = droneHidePoint(v, tac.launchBack || 450, 3);
  const enemy = v.team === "red" ? "blue" : "red", C = teamCOM[enemy];
  v.pos.set(S.x, HOST.groundAt(S.x, S.z), S.z);
  v.h = Math.atan2(S.x - C.x, S.z - C.z);
  v.yaw = v.heading = v.h;
  v.group.rotation.set(0, v.h, 0);
  v.ds.y = v.pos.y;
  v.home = { x: S.x, z: S.z };
  v.target.set(S.x, 0, S.z);
  if (v.rig && v.rig.settle) { try { v.rig.settle(); } catch (e) {} }
}
/* a cell's world transform onto an object: the carrier's own pose times the
   cell's place and its yaw / pitch up the rails */
function dronePlaceOn(obj, v, C, k) {
  const s = C.slots[k];
  v.group.updateMatrixWorld(true);
  obj.position.set(s[0], s[1], s[2]).applyMatrix4(v.group.matrixWorld);
  _de.set(-(C.pitch || 0), C.yaw || 0, 0, "YXZ");
  _dq.setFromEuler(_de);
  v.group.getWorldQuaternion(_dq2);
  obj.quaternion.copy(_dq2).multiply(_dq);
}
function dronePlaceStowed(u) {
  const dr = u.dr;
  if (!dr.carrier) return;
  if (dr.tube) { dronePlaceOn(dr.tube, dr.carrier, dr.cell, dr.slot); return; }
  dronePlaceOn(u.group, dr.carrier, dr.cell, dr.slot);
}
// may this one go now? one in the air per operator; a carrier lets its
// rounds go a few seconds apart and not at a gallop
function droneMayLaunch(u) {
  const dr = u.dr;
  if (dr.op) {
    const O = dr.op.droneOp;
    // one at a time: the first of the team's kit that has work goes (a frag
    // round waits in the pack while there are only hulls to hit)
    if (!O || O.flying || simT < (O.readyT || 0)) return false;
    return !!O.atPost || simT - (O.takenT || 0) > 15;
  }
  if (dr.carrier) {
    const v = dr.carrier;
    if (v.speed > (u.def.drone.launch === "rail" ? 0.8 : 8)) return false;
    if (v.def.tactics && v.def.tactics.holdUntilEmpty && !v._droneAtSite) return false;
    if (simT < (v._droneNextT || 0)) return false;
    // a carrier's crew fly two at a time at most
    let up = 0;
    for (let i = 0; i < DRONES.list.length; i++) { const o = DRONES.list[i]; if (o.dr.carrier === v && o.dr.ph !== "stowed" && !o.dead) up++; }
    return up < (u.def.drone.launch === "rail" ? 5 : 2);
  }
  return true;
}

/* ------------------------------------------------------------- the men who fly them */
function droneOpTake(m, kind, def) {
  const O = m.droneOp = { kind: kind, drones: [], flying: null, post: null, atPost: false, readyT: simT + 4, takenT: simT, done: false, def: def };
  // out of his squad: the team works on its own, behind the line
  const sq = squads[m.team][m.sq];
  if (sq) { const k = sq.indexOf(m); if (k >= 0) sq.splice(k, 1); }
  m.post = null; m.tgt = null;
  if (CBZ.droneKit && CBZ.droneKit.dress) { try { CBZ.droneKit.dress(m, kind); } catch (e) {} }
  return O;
}
/* BACK INTO COVER BEHIND HIS OWN LINE. The team goes `tactics.operator.back`
   metres behind where it formed up, and then to the spot round there that
   the enemy cannot see: a reverse slope or a wall between it and the
   enemy's middle and both its flanks, at a hull's sight height (the ground
   is asked, then the colliders; HOST.coverFrom's point when there is one).
   Two teams do not share a hole. */
function droneOpPost(m) {
  const tac = (m.droneOp && m.droneOp.def && m.droneOp.def.tactics) || {};
  return droneHidePoint(m, (tac.operator && tac.operator.back) || 50, 1.1);
}
// the hidden spot `back` metres behind where m formed up (a man's head at
// 1.1 m, a launcher truck's rack at ~3 m)
function droneHidePoint(m, back, hgt) {
  const enemy = m.team === "red" ? "blue" : "red";
  const C = teamCOM[enemy];
  const home = m.home || { x: m.pos.x, z: m.pos.z };
  let hx = home.x - C.x, hz = home.z - C.z;
  const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
  const px = home.x + hx * back, pz = home.z + hz * back;
  // the eyes it hides from: the enemy's middle and flanks, and every hull
  // it can see (a gunner's sight is high), at their own sight heights
  const eyes = [[C.x, C.z, 2], [C.x - hz * 90, C.z + hx * 90, 2], [C.x + hz * 90, C.z - hx * 90, 2]];
  for (let i = 0; i < men.length && eyes.length < 10; i++) {
    const o = men[i];
    if (o.team === enemy && o.vehicle && !o.air && !o.dead) eyes.push([o.pos.x, o.pos.z, o.eyeH || 2.6]);
  }
  // ...and where the enemy will be: up its axis of advance toward the hole
  // (a reverse slope deep behind a crest, not a fold the first bound overlooks)
  for (let k = 1; k <= 3; k++) {
    const f = Math.min(0.8, k * 110 / Math.max(1, hl + back));
    eyes.push([C.x + (px - C.x) * f, C.z + (pz - C.z) * f, 2.6]);
  }
  const H = HOST;
  let best = null, bs = Infinity;
  const RING = [0, 30, 60, 100, 150];
  for (let r = 0; r < RING.length; r++) {
    for (let k = 0; k < (r ? 12 : 1); k++) {
      const a = k * Math.PI * 2 / 12 + r * 0.3;
      const x = px + Math.sin(a) * RING[r], z = pz + Math.cos(a) * RING[r];
      const gy = HOST.groundAt(x, z);
      let seen = 0;
      for (let e = 0; e < eyes.length; e++) {
        const ex = eyes[e][0], ez = eyes[e][1], ey = HOST.groundAt(ex, ez) + eyes[e][2];
        const hid = terrainBlocked(ex, ey, ez, x, gy + hgt, z) ||
          (HOST.segmentBlocked && HOST.segmentBlocked(ex, ey, ez, x, gy + hgt, z));
        if (!hid) seen++;
      }
      // a hull in sight of the hole is worse than a man in sight of it
      let sc = seen * 400 + RING[r] * 0.8;
      for (let i = 0; i < men.length; i++) {
        const o = men[i];
        if (o !== m && o.droneOp && o.droneOp.post && Math.hypot(o.droneOp.post.x - x, o.droneOp.post.z - z) < 14) sc += 150;
        if (o !== m && o._droneSite && Math.hypot(o._droneSite.x - x, o._droneSite.z - z) < 25) sc += 150;
      }
      if (sc < bs) { bs = sc; best = { x: x, z: z, cover: seen === 0 }; }
    }
  }
  if (best && !best.cover && hgt < 2 && H && typeof H.coverFrom === "function") {
    let p = null;
    try { p = H.coverFrom(best.x, best.z, C.x, C.z, 45); } catch (e) { p = null; }
    if (p && isFinite(p.x)) return { x: p.x, z: p.z, cover: true };
  }
  return best || { x: px, z: pz, cover: false };
}
/* HIS STEP (stepMan asks first): to his post, down on one knee, the goggles
   down and the radio up while a drone of his is in the air. Returns false
   once his drones are all gone: he is a rifleman again. */
function droneOpStep(m, sdt) {
  const O = m.droneOp;
  if (!O || O.done) return false;
  if (O.flying && (O.flying.dead || O.flying.dr.ph === "spent")) droneOpLanded(m, O.flying);
  let left = 0;
  for (let i = 0; i < O.drones.length; i++) if (O.drones[i].dr.ph === "stowed") left++;
  if (!left && !O.flying) { droneOpRelease(m); return false; }
  if (!O.post) O.post = droneOpPost(m);
  // SEEN IN HIS HOLE: between flights, a hull with a line to him sends the
  // team to another one (asked every few seconds, a sight line per hull)
  if (!O.flying && simT > (O.lookT || 0)) {
    O.lookT = simT + 4 + lcg() * 2;
    for (let i = 0; i < men.length; i++) {
      const v = men[i];
      if (v.team === m.team || !v.vehicle || v.air || v.dead || v.drone) continue;
      if (Math.hypot(v.pos.x - m.pos.x, v.pos.z - m.pos.z) > 1600) continue;
      if (eyeLos(v, m)) { O.post = droneOpPost(m); O.atPost = false; break; }
    }
  }
  const dx = O.post.x - m.pos.x, dz = O.post.z - m.pos.z, d = Math.hypot(dx, dz);
  let spd = 0;
  if (d > 1.2 && !O.flying) {
    spd = 4.6 * (m.kitSpeed || 1);
    const ox = m.pos.x, oz = m.pos.z;
    m.pos.x += dx / d * spd * sdt; m.pos.z += dz / d * spd * sdt;
    HOST.resolveCircle(m.pos, m.rad || 0.5, m.pos.y, 1.8);
    if (Math.hypot(m.pos.x - ox, m.pos.z - oz) < spd * sdt * 0.2) { O.stuckT = (O.stuckT || 0) + sdt; if (O.stuckT > 2) O.post = { x: m.pos.x, z: m.pos.z, cover: false }; }
  } else O.atPost = true;
  m.speed = spd;
  m.pos.y = HOST.bodyY(m, m.pos.x, m.pos.z);
  m.target.set(m.pos.x, 0, m.pos.z);
  m.slot = "hold"; m.tgt = null;
  // he faces where he walks, the fight, or the drone he is flying
  let fx, fz;
  if (spd > 0.1) { fx = dx; fz = dz; }
  else if (O.flying) { fx = O.flying.pos.x - m.pos.x; fz = O.flying.pos.z - m.pos.z; }
  else { const C = teamCOM[m.team === "red" ? "blue" : "red"]; fx = C.x - m.pos.x; fz = C.z - m.pos.z; }
  if (fx * fx + fz * fz > 1e-4) {
    const dy = droneWrapA(Math.atan2(fx, fz) - m.yaw);
    m.yaw += dy * Math.min(1, sdt * 5);
    m.group.rotation.y = m.yaw;
  }
  // a team in its dugout far behind the line does not run with the line: it
  // flies its drones until they are gone (then it is the army's again)
  if (m.routed) { m.routed = false; m.routT = 0; }
  const st = spd > 0.1 ? "stand" : "crouch";
  if (m.stance !== st) setStance(m, st);
  m.coverK = st === "crouch" ? CROUCH_HIT : 1;
  if (m.supp > 0) m.supp = Math.max(0, m.supp - sdt * SUPP_DECAY);
  m.flying = O.flying || null;
  return true;
}
// a drone of his is down, spent or lost: the next one after `prep`
function droneOpLanded(m, u) {
  const O = m && m.droneOp;
  if (!O || O.flying !== u) return;
  O.flying = null; m.flying = null;
  O.readyT = simT + ((u.def.drone && u.def.drone.prep) || 20) * (0.8 + lcg() * 0.4);
  if (CBZ.droneKit) CBZ.droneKit.show(m, false);
}
function droneOpRelease(m) {
  const O = m.droneOp;
  O.done = true; O.flying = null; m.flying = null;
  if (CBZ.droneKit) CBZ.droneKit.show(m, false);
  const sq = (squads[m.team][m.sq] = squads[m.team][m.sq] || []);
  if (sq.indexOf(m) < 0) sq.push(m);
  m.thinkAt = simT; m.slot = "hold";
}

/* SEEN OR HEARD: a drone is a mark only inside the range its own size and
   noise give it away at (stats.detect, slant metres): an FPV's four props
   scream, a Switchblade's electric motor is near silent, a Shahed's engine
   is heard kilometres off. */
function droneSpotted(m, o) {
  // a crew under armour, its own engine running, sees and hears half as far
  const R = ((o.def && o.def.stats && o.def.stats.detect) || 400) * (m.vehicle ? 0.5 : 1);
  const dx = o.pos.x - m.pos.x, dy = o.pos.y - m.pos.y, dz = o.pos.z - m.pos.z;
  return dx * dx + dy * dy + dz * dz < R * R;
}

/* TRACKING IT: what a shooter's aim error is multiplied by on a drone (fire.js
   fireShot). Iron sights or an optic on a 0.4 m quad crossing at 30 m/s is
   not a man standing still: the error grows with its speed across the line
   (radial speed is free: a drone diving straight at you is the easiest shot
   it gives); a stabilised remote weapon station tracks far better than a man. */
function droneTrackK(m, t) {
  const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1;
  const vx = t.dr ? t.dr.vel.x : 0, vz = t.dr ? t.dr.vel.z : 0, vy = t.dr ? t.dr.vel.y : 0;
  const across = Math.abs(vx * dz - vz * dx) / d + Math.abs(vy) * 0.5;
  // a man aiming up at a small fast shape he has seconds to find: the sight
  // picture alone costs him (x1.8); a gunner on a stabilised mount less (x1.2)
  return m.vehicle ? 1.2 + across * 0.03 : 1.8 + across * 0.08;
}

/* ------------------------------------------------------------- what is worth it */
// what a unit IS, to a drone's target list (map-free: read off its own numbers)
function droneIsA(o, cls) {
  if (o.vehicle) {
    if (o.air) return false;
    const st = o.def && o.def.stats || {}, ar = st.armour || {};
    switch (cls) {
      case "vehicle": return true;
      case "tank": return (ar.front || 0) >= 300;
      case "ifv": return (ar.front || 0) >= 50 && (ar.front || 0) < 300;
      case "apc": return (ar.side || 0) >= 12 && (ar.front || 0) < 50;
      case "soft": return (ar.side || 0) < 12;
      case "parked": return (o.speed || 0) < 0.6;
      case "sam": return droneHasKind(o, "sam");
      case "artillery": return droneHasIndirect(o);
      case "group": return false;
      default: return false;
    }
  }
  switch (cls) {
    case "men": return true;
    case "launcher": return !!o.launcher;
    case "mg": return o.wid === "lmg";
    case "dugin": return o.stance === "crouch" || o.stance === "prone" || !!o.inCover || o.slot === "cover" || o.slot === "hull";
    case "group": return droneMenAround(o, 8) >= 3;
    default: return false;
  }
}
function droneHasKind(o, k) { const W = o.wpn || []; for (let i = 0; i < W.length; i++) if (W[i].w.kind === k) return true; return false; }
function droneHasIndirect(o) { const W = o.wpn || []; for (let i = 0; i < W.length; i++) if (W[i].w.indirect) return true; return false; }
const _dnear = [];
function droneMenAround(o, r) {
  const a = fineNear(o.pos.x, o.pos.z, r, _dnear);
  let n = 0;
  for (let i = 0; i < a.length; i++) { const b = a[i]; if (b !== o && b.team === o.team && !b.dead && !b.vehicle && Math.hypot(b.pos.x - o.pos.x, b.pos.z - o.pos.z) < r) n++; }
  return n;
}
function droneClaim(u, t, d) {
  const M = DRONES.claims[u.team];
  if (!M || !t) return;
  const n = (M.get(t) || 0) + d;
  if (n <= 0) M.delete(t); else M.set(t, n);
}
/* THE PICK: the best mark on its own warhead's list (tactics.priorities,
   earlier = more), nearer and unclaimed first; an armour drone needs no
   second on a hull already doomed, a man needs one. */
function droneChoose(u, from) {
  const D = u.def.drone || {}, tac = u.def.tactics || {}, dr = u.dr;
  let pri = tac.priorities || ["vehicle", "men"];
  if (!Array.isArray(pri)) pri = pri[dr.wid] || ["vehicle", "men"];
  const reach = Math.min(D.range || 10000, 12000);
  const M = DRONES.claims[u.team];
  let best = null, bs = -1e9;
  for (let i = 0; i < men.length; i++) {
    const o = men[i];
    if (o.team === u.team || o.dead || o.fled || o.downed || o.air || o.ghost) continue;
    if (o.surrendered) continue;
    const d = Math.hypot(o.pos.x - from.x, o.pos.z - from.z);
    if (d > reach) continue;
    let s = -1;
    for (let j = 0; j < pri.length; j++) if (droneIsA(o, pri[j])) { s = (pri.length - j) * 10; break; }
    if (s < 0) continue;
    // a shaped charge is not spent on a man when a hull is on the list; a
    // frag round not on armour it cannot hurt
    if (dr.wh.anti === "men" && o.vehicle && droneIsA(o, "tank")) continue;
    s -= d / 300;
    const c = M ? (M.get(o) || 0) : 0;
    s -= c * (o.vehicle ? 9 : 25);
    if (o.vehicle && (o.speed || 0) < 0.6) s += 2;
    if (o.vehicle && o.vs && (o.vs.mobility || o.vs.firepower)) s -= 6;       // already crippled: somebody else's
    if (!o.vehicle && dr.wh.anti !== "armour") s += Math.min(4, droneMenAround(o, 6)) * 2;
    if (s > bs) { bs = s; best = o; }
  }
  return best;
}
/* WHERE ON IT. On a hull: one of the weak spots its tactics list (deck,
   rear, top), the spot set by the drone's place in the team (so a team's
   drones work the whole hull); a top-attack loiterer always the roof or deck.
   On a man: him. Returns the hull-space point and how it must come in. */
function droneZoneFor(u, t) {
  const dr = u.dr, tac = u.def.tactics || {};
  if (!t.vehicle) { dr.zone = "man"; dr.aim = null; dr.face = "top"; return; }
  const W = CBZ.droneKit ? CBZ.droneKit.weakOf(t) : null;
  if (!W) { dr.zone = "top"; dr.aim = [0, (t.vheight || 2) * 0.95, 0]; dr.face = "top"; return; }
  let zones = tac.weakZones || ["top"];
  if (tac.attack === "top") zones = ["top", "deck"];
  else if (tac.attack === "dive") zones = ["top"];
  const z = zones[(u.i + (dr.waveOffs || 0)) % zones.length];
  const p = W[z] || W.top;
  dr.zone = z; dr.aim = [p[0], p[1], p[2]]; dr.face = p[3] || "top";
}
// a hull-space point onto the world (x port, y up, z forward)
function droneHullWorld(t, p, out) {
  const c = Math.cos(t.h || 0), s = Math.sin(t.h || 0);
  out.x = t.pos.x + p[0] * c + p[2] * s;
  out.z = t.pos.z - p[0] * s + p[2] * c;
  out.y = t.pos.y + p[1];
  return out;
}

/* ------------------------------------------------------------- launch */
function droneLaunch(u, tgt) {
  const dr = u.dr, D = u.def.drone || {};
  dr.ph = "launch"; dr.t = 0; dr.launchedAt = simT;
  // a loiterer goes up to LOOK over where the enemy is; the gunner picks the
  // mark off its sensor once it is over them (droneThink)
  if (dr.cls === "loiter" && tgt) { dr.loiterC = { x: tgt.pos.x, z: tgt.pos.z }; tgt = null; }
  dr.tgt = tgt || null;
  if (tgt) { droneClaim(u, tgt, 1); droneZoneFor(u, tgt); }
  if (men.indexOf(u) < 0) men.push(u);
  dr.off = false;
  u.dead = false; u.fled = false;
  u.group.visible = true;
  u.thinkAt = simT + 0.3;
  const A = DRONES.audit;
  A.launched++; A.byClass[u.unitId].launched++;
  const enemy = u.team === "red" ? "blue" : "red";
  const C = tgt ? tgt.pos : teamCOM[enemy];
  // where it leaves from
  if (dr.op) {
    const m = dr.op, O = m.droneOp;
    O.flying = u; m.flying = u;
    if (CBZ.droneKit) CBZ.droneKit.show(m, true);
    let fx = C.x - m.pos.x, fz = C.z - m.pos.z;
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    if (dr.frame === "quad") {
      // set down on the ground a stride in front of him
      const x = m.pos.x + fx * 1.6, z = m.pos.z + fz * 1.6;
      u.pos.set(x, HOST.groundAt(x, z) + 0.02, z);
      u.h = Math.atan2(fx, fz);
      dr.vel.set(0, 0, 0); dr.spd = 0;
    } else {
      // the tube on its legs beside him, 35 deg up toward the fight
      const x = m.pos.x + fx * 1.4 - fz * 0.8, z = m.pos.z + fz * 1.4 + fx * 0.8, gy = HOST.groundAt(x, z);
      const yaw = Math.atan2(fx, fz), pit = 0.62;
      if (u.rig && u.rig.tube) {
        const T = u.rig.tube;
        if (!T.parent) CBZ.scene.add(T);
        T.position.set(x, gy + 0.22, z);
        T.rotation.order = "YXZ"; T.rotation.set(-pit, yaw, 0);
        dr.tube = T;
      }
      const L = (u.rig && u.rig.tubeL) || 1.5;
      u.pos.set(x + Math.sin(yaw) * Math.cos(pit) * L, gy + 0.22 + Math.sin(pit) * L, z + Math.cos(yaw) * Math.cos(pit) * L);
      u.h = yaw; dr.gam = pit;
      dr.spd = 22; droneVelFrom(u);
      if (u.rig && u.rig.launched) { try { u.rig.launched(); } catch (e) {} }
      droneLaunchFx(u, 0.7);
    }
  } else if (dr.carrier) {
    const v = dr.carrier;
    v._droneNextT = simT + (D.launch === "rail" ? 3 + lcg() * 2 : 5);      // a rack is emptied in seconds
    v._droneHoldT = simT + 4;
    // up the rails (or out of the canister) along the cell's axis
    const obj = dr.tube || u.group;
    dronePlaceOn(obj, v, dr.cell, dr.slot);
    _dv.set(0, 0, 1).applyQuaternion(obj.quaternion);
    u.h = Math.atan2(_dv.x, _dv.z); dr.gam = Math.asin(droneClampN(_dv.y, -1, 1));
    if (dr.tube) {
      const L = (u.rig && u.rig.tubeL) || 1.5;
      u.pos.set(obj.position.x + _dv.x * L, obj.position.y + _dv.y * L, obj.position.z + _dv.z * L);
      dr.spd = 22;
      if (u.rig && u.rig.launched) { try { u.rig.launched(); } catch (e) {} }
      droneLaunchFx(u, 0.7);
    } else {
      u.pos.copy(obj.position);
      dr.spd = 0; dr.boost = 2.0; dr.prop = 0.8;
      if (v._droneCells) v._droneCells[dr.slot] = null;
    }
    droneVelFrom(u);
  } else {
    // from beyond the edge, already flying
    const at = u.home || { x: u.pos.x, z: u.pos.z };
    let hx = at.x - C.x, hz = at.z - C.z;
    const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    const back = dr.frame === "quad" ? 250 : 1500 + (u.i % 5) * 120;
    const x = at.x + hx * back + (lcg() - 0.5) * 60, z = at.z + hz * back + (lcg() - 0.5) * 60;
    u.pos.set(x, HOST.groundAt(x, z) + (D.agl || 30), z);
    u.h = Math.atan2(-hx, -hz); dr.gam = 0;
    dr.spd = D.cruise || 30; dr.prop = 1; dr.wings = 1;
    droneVelFrom(u);
    dr.ph = "transit";
  }
  dr.lastY = u.pos.y;
  droneOrient(u, 0);
  const dCam = camDist2(u.pos);
  if (dCam < 400 * 400 && dr.frame === "wing") { try { CBZ.sfx("whoosh", { dist: Math.sqrt(dCam), ghost: true, volume: 0.8, pitch: D.launch === "rail" ? 0.5 : 1.1 }); } catch (e) {} }
}
function droneLaunchFx(u, k) {
  if (camDist2(u.pos) > 300 * 300) return;
  if (CBZ.cityCrashSmoke) { try { CBZ.cityCrashSmoke(u.pos.x, u.pos.y, u.pos.z, { count: 2, scale: k, shade: 0.85 }); } catch (e) {} }
}
function droneVelFrom(u) {
  const dr = u.dr, cg = Math.cos(dr.gam);
  dr.vel.set(Math.sin(u.h) * cg * dr.spd, Math.sin(dr.gam) * dr.spd, Math.cos(u.h) * cg * dr.spd);
}

/* ------------------------------------------------------------- the step */
function stepDrone(u, sdt) {
  const dr = u.dr;
  if (!dr || dr.ph === "stowed" || dr.ph === "scrubbed" || dr.ph === "spent") return;
  if (u.dead) { droneFall(u, sdt); vehAnimate(u, sdt); return; }
  if (u.fled) return;
  dr.t += sdt;
  dr.bat -= sdt;
  if (simT >= u.thinkAt) droneThink(u);
  if (dr.ph === "lost") droneLostStep(u, sdt);
  else if (dr.frame === "quad") droneQuad(u, sdt);
  else droneWing(u, sdt);
  if (!u.dead && dr.ph !== "spent") droneContact(u, sdt);
  if (dr.ph !== "spent") vehAnimate(u, sdt);
}
/* THE BRAIN, a few times a second: the link, the battery, the mark */
function droneThink(u) {
  const dr = u.dr, D = u.def.drone || {};
  u.lastThink = simT;
  u.thinkAt = simT + 0.22 + lcg() * 0.08;
  if (dr.ph === "lost" || dr.ph === "launch") return;
  if (dr.link && !droneLink(u)) {
    dr.link = false;
    DRONES.audit.lostLink++;
    // an FPV on its final run flies on into the mark on its last command; a
    // Switchblade locked on in its dive homes on its own seeker; anything
    // else falls (a quad's failsafe cuts the motors) or glides down
    const committed = dr.ph === "terminal" && (dr.frame === "wing" || droneTimeToGo(u) < 1.5);
    if (!committed) { droneLose(u); return; }
  }
  if (dr.bat <= 0) { droneLose(u); return; }
  // the mark: still there, still worth it?
  const t = dr.tgt;
  if (t && (t.dead || t.fled || (t.vehicle && t.vs && t.vs.wreck))) {
    const late = dr.ph === "terminal" && droneTimeToGo(u) < 1.2;
    if (late) { const p = droneAimPoint(u, _dv2); dr.blindP = new THREE.Vector3(p.x, p.y, p.z); }
    droneClaim(u, t, -1);
    dr.tgt = null;
    if (late) return;                                // too late to turn: on into the point
    if (dr.ph === "terminal" || dr.ph === "attack") {
      // the wave-off: pull up and go round (a Switchblade back to its orbit)
      dr.ph = dr.cls === "loiter" ? "loiter" : "transit"; dr.waveOffs++; DRONES.audit.waveOffs++;
      dr.scanT = simT + 2;
    }
  }
  if (!dr.tgt && dr.ph !== "terminal") {
    // a loiterer's gunner picks off the screen after a look round; the others
    // take the next mark at once
    if ((dr.cls !== "loiter" || (dr.ph === "loiter" && simT >= dr.scanT)) && simT >= (dr.lookT || 0)) {
      dr.lookT = simT + 0.8 + lcg() * 0.4;
      const n = droneChoose(u, dr.op ? dr.op.pos : u.pos);
      if (n) { dr.tgt = n; droneClaim(u, n, 1); droneZoneFor(u, n); if (dr.ph === "loiter") dr.ph = "attack"; }
    }
  }
  if (D.heard) droneHeard(u, D.heard);
}
// the datalink to whoever flies it (THE place jamming would answer)
function droneLink(u) {
  const dr = u.dr, D = u.def.drone || {};
  if (D.link === "gnss" || dr.remote) return true;
  const o = dr.op || dr.carrier;
  if (!o || o.dead || o.fled || (o.downed && !o.vehicle)) return false;
  return Math.hypot(u.pos.x - o.pos.x, u.pos.z - o.pos.z) <= (D.range || 10000);
}
function droneLose(u) {
  const dr = u.dr;
  dr.ph = "lost"; dr.t = 0;
  if (dr.tgt) { droneClaim(u, dr.tgt, -1); dr.tgt = null; }
  if (dr.op) droneOpLanded(dr.op, u);
}
function droneTimeToGo(u) {
  const dr = u.dr, t = dr.tgt;
  const p = droneAimPoint(u, _dv2);
  if (!p) return 99;
  return Math.hypot(p.x - u.pos.x, p.y - u.pos.y, p.z - u.pos.z) / Math.max(5, dr.spd || 1);
}
// THE MOPED IN THE SKY: men within earshot look up, and the guns that can reach it turn on it
function droneHeard(u, R) {
  const dr = u.dr;
  if (simT < (dr.heardT || 0)) return;
  dr.heardT = simT + 1;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.team === u.team || m.dead || m.fled || m.downed || m.air || m.flying || m.beast || m.fists || m.launcher) continue;
    if (m.tgt && !m.tgt.dead) continue;
    const d = Math.hypot(m.pos.x - u.pos.x, m.pos.z - u.pos.z);
    if (d > R) continue;
    if (m.vehicle ? !vehCanHitAir(m) : !vehicleCanTarget(m, u)) continue;
    if (lcg() < 0.3) m.tgt = u;
  }
}

/* ------------------------------------------------------------- where it aims */
function droneAimPoint(u, out) {
  const dr = u.dr, t = dr.tgt;
  if (dr.blindP && (!t || u.def.drone.link === "gnss")) return out.copy(dr.blindP);
  if (!t) return null;
  if (t.vehicle && dr.aim) return droneHullWorld(t, dr.aim, out);
  out.set(t.pos.x, t.pos.y + (t.stance === "prone" ? 0.25 : t.stance === "crouch" ? 0.6 : 0.95), t.pos.z);
  return out;
}
// the set-up point an FPV flies to before its run: behind the hull for the
// rear, above and behind for the engine deck, above for the roof
function droneSetup(u, out) {
  const dr = u.dr, t = dr.tgt;
  const L = t.vlen || 3, H = t.vheight || 2.4;
  if (!t.vehicle) return out.set(t.pos.x, t.pos.y + 18, t.pos.z);
  // which end the spot is at: the rear (and a rear engine), or the front
  // engine of a Bradley, a Stryker, a wheeled hull
  const fwd = dr.aim && dr.aim[2] > 0 ? 1 : -1;
  // round the flank first when it is still on the wrong end of the hull: a
  // pilot does not fly down the gun's line to get behind it
  if (dr.zone === "rear" || (dr.zone === "deck" && fwd < 0)) {
    const lx = u.pos.x - t.pos.x, lz = u.pos.z - t.pos.z, c = Math.cos(t.h || 0), s = Math.sin(t.h || 0);
    const hx = lx * c - lz * s, hz = lx * s + lz * c;         // the drone in the hull's frame
    // low (terrain and the hull's own bulk between it and the crew), wide of the gun
    if (hz > -L) return droneHullWorld(t, [(hx >= 0 ? 1 : -1) * (L + 34), 6, -L], out);
  }
  if (dr.zone === "rear") return droneHullWorld(t, [0, H * 0.7 + 3, -L - 26], out);
  if (dr.zone === "deck") return droneHullWorld(t, [0, H + 14, fwd * (L + 14)], out);
  return droneHullWorld(t, [0, H + 22, -L * 0.6], out);
}

/* ------------------------------------------------------------- THE QUAD */
const _dP = { x: 0, y: 0, z: 0 };
function droneQuad(u, sdt) {
  const dr = u.dr, D = u.def.drone || {};
  const enemy = u.team === "red" ? "blue" : "red";
  const gy = HOST.groundAt(u.pos.x, u.pos.z);
  const cruise = D.cruise || 30, dash = D.dash || cruise * 1.25, acc = D.accel || 14, agl = D.agl || 15;
  let tx, ty, tz, vmax = cruise, arrive = true;
  if (dr.ph === "launch") {
    // the spin-up on the ground, then up
    dr.prop = Math.min(1, dr.t / 0.6) * 0.75;
    if (dr.t < 0.7) { droneOrient(u, sdt); return; }
    dr.ph = "climb";
  }
  dr.prop = dr.ph === "terminal" ? 1 : 0.85;
  const t = dr.tgt;
  if (dr.ph === "climb") {
    tx = u.pos.x + Math.sin(u.h) * 6; tz = u.pos.z + Math.cos(u.h) * 6; ty = gy + agl;
    if (u.pos.y - gy > agl * 0.7) dr.ph = t ? "attack" : "transit";
    vmax = 10;
  } else if (!t && !dr.blindP) {
    // nothing to hit yet: fly toward the enemy and hold a search orbit over them
    const C = teamCOM[enemy];
    const a = Math.atan2(u.pos.x - C.x, u.pos.z - C.z) + 0.6 * dr.orbitDir;
    tx = C.x + Math.sin(a) * 180; tz = C.z + Math.cos(a) * 180; ty = HOST.groundAt(tx, tz) + agl + 15;
    if (dr.ph !== "transit") dr.ph = "transit";
    vmax = cruise * 0.7;
  } else if (dr.ph === "terminal" || !t) {
    // THE RUN: at the point, leading a mover; fast, but at the end no faster
    // than it can still turn onto the spot (a quad pulls ~2.5 g)
    const p = droneAimPoint(u, _dv2);
    const d3 = Math.hypot(p.x - u.pos.x, p.y - u.pos.y, p.z - u.pos.z);
    const tgo = d3 / Math.max(10, dr.spd);
    tx = p.x + (t ? (t._vx || 0) * tgo : 0); ty = p.y; tz = p.z + (t ? (t._vz || 0) * tgo : 0);
    vmax = Math.min(dash, Math.max(26, d3 * 0.8)); arrive = false;
    // gone past it: pull round and set up again (the pilot's second pass)
    if (t && !dr.blindP) {
      if (dr.tdMin == null || d3 < dr.tdMin) dr.tdMin = d3;
      else if (d3 > dr.tdMin + 6) { dr.ph = "attack"; dr.tdMin = null; dr.attackT = simT; dr.waveOffs++; DRONES.audit.waveOffs++; }
    }
  } else {
    // transit and the set-up: low and fast to the set-up point, then the run
    const S = droneSetup(u, _dv2);
    tx = S.x; tz = S.z;
    const dS = Math.hypot(S.x - u.pos.x, S.z - u.pos.z);
    // low on the way in (terrain-following), up to the set-up height near it
    ty = dS > 120 ? Math.max(HOST.groundAt(tx, tz), gy) + agl : S.y;
    vmax = cruise;
    dr.ph = "attack";
    const p = droneAimPoint(u, _dv);
    const dA = Math.hypot(p.x - u.pos.x, p.z - u.pos.z);
    // in position (or close and already in the right sector): commit
    const rel0 = Math.abs(droneWrapA(Math.atan2(u.pos.x - t.pos.x, u.pos.z - t.pos.z) - (t.h || 0)));
    let commit = Math.hypot(S.x - u.pos.x, S.y - u.pos.y, S.z - u.pos.z) < 18 && (!t.vehicle || dr.zone === "top" || (dr.zone === "deck" && dr.aim[2] > 0 ? rel0 < 1.0 : rel0 > 2.2));
    if (!commit && t.vehicle && dA < (D.terminal || 140)) {
      const rel = Math.abs(droneWrapA(Math.atan2(u.pos.x - t.pos.x, u.pos.z - t.pos.z) - (t.h || 0)));
      if (dr.zone === "rear") commit = rel > 2.5 && dA < 60;
      else commit = u.pos.y - p.y > dA * 0.55 && (dr.zone !== "deck" || (dr.aim[2] > 0 ? rel < 1.2 : rel > 1.9));
    }
    if (!t.vehicle && dA < (D.terminal || 140) * 0.8) commit = true;
    // a long wait behind a moving hull is a dead drone: commit anyway after a while
    if (!commit && t.vehicle && dA < 90 && simT - (dr.attackT || (dr.attackT = simT)) > 25) commit = true;
    // ...and only flying at it: a run begun going the wrong way is a miss
    if (commit && t.vehicle) {
      const v = dr.vel, vl = Math.hypot(v.x, v.y, v.z) || 1;
      const ax = p.x - u.pos.x, ay = p.y - u.pos.y, az = p.z - u.pos.z, al = Math.hypot(ax, ay, az) || 1;
      if ((v.x * ax + v.y * ay + v.z * az) / (vl * al) < 0.55 && al < 45) commit = false;
    }
    if (commit) { dr.ph = "terminal"; dr.commitT = simT; dr.tdMin = null; }
  }
  // the set-up is flown THROUGH at speed (a hovering quad is a dead one); only
  // a search orbit slows down
  if (dr.ph === "attack") arrive = false;
  droneQuadFly(u, sdt, tx, ty, tz, vmax, acc, arrive);
  // never into the ground on the way: the run goes down to the mark only in
  // its last few metres
  const g2 = HOST.groundAt(u.pos.x, u.pos.z);
  let floor = 2;
  if (dr.ph === "terminal") {
    const p = droneAimPoint(u, _dv);
    floor = p && Math.hypot(p.x - u.pos.x, p.z - u.pos.z) > 10 ? 1.0 : -1;
  }
  if (floor > 0 && u.pos.y < g2 + floor) { u.pos.y = g2 + floor; if (dr.vel.y < 0) dr.vel.y = 0; }
  droneOrient(u, sdt);
}
function droneQuadFly(u, sdt, tx, ty, tz, vmax, acc, arrive) {
  const dr = u.dr, v = dr.vel;
  const dx = tx - u.pos.x, dy = ty - u.pos.y, dz = tz - u.pos.z, d = Math.hypot(dx, dy, dz) || 1e-3;
  const s = arrive ? Math.min(vmax, Math.sqrt(2 * acc * 0.5 * d) + 0.5) : vmax;
  const wx = dx / d * s, wy = dy / d * s, wz = dz / d * s;
  let ax = wx - v.x, ay = wy - v.y, az = wz - v.z;
  const al = Math.hypot(ax, ay, az), lim = acc * sdt;
  if (al > lim) { ax *= lim / al; ay *= lim / al; az *= lim / al; }
  v.x += ax; v.y += ay; v.z += az;
  dr.ax = ax / Math.max(1e-4, sdt); dr.ay = ay / Math.max(1e-4, sdt); dr.az = az / Math.max(1e-4, sdt);
  u.pos.x += v.x * sdt; u.pos.y += v.y * sdt; u.pos.z += v.z * sdt;
  dr.spd = Math.hypot(v.x, v.y, v.z);
  u.speed = Math.hypot(v.x, v.z);
  u.ds.v = dr.spd; u.ds.vy = v.y;
  // the nose goes where it flies (an FPV pilot flies nose-first)
  if (u.speed > 1.5) {
    const h0 = u.h;
    u.h = CBZ.vehicleDrive.lay(u.h, Math.atan2(v.x, v.z), 3.2, sdt);
    u.ds.w = sdt > 0 ? droneWrapA(u.h - h0) / sdt : 0;
  }
  u.yaw = u.h; u.heading = u.h;
}
/* A QUAD TILTS ITS THRUST WHERE IT IS GOING: the disc's normal is the sum of
   gravity held, the acceleration wanted and the drag of the air (k v^2: ~55
   deg nose-down flat out at 33 m/s); the nose along the heading. */
function droneOrient(u, sdt) {
  const dr = u.dr, v = dr.vel;
  if (dr.frame !== "quad") {
    const roll = droneClampN(-(dr.spd || 0) * (u.ds.w || 0) / 9.81, -1.2, 1.2);
    dr.roll = (dr.roll || 0) + (roll - (dr.roll || 0)) * Math.min(1, (sdt || 0) * 4);
    u.group.rotation.order = "YXZ";
    u.group.rotation.set(-dr.gam, u.h, -dr.roll);
    return;
  }
  const k = 0.0128, sp = Math.hypot(v.x, v.y, v.z);
  let tx = (dr.ax || 0) + k * v.x * sp, ty = 9.81 + (dr.ay || 0) + k * v.y * sp, tz = (dr.az || 0) + k * v.z * sp;
  if (dr.ph === "launch" || dr.ph === "lost") { tx = 0; ty = 1; tz = 0; }
  if (ty < 0.5) ty = 0.5;
  const tl = Math.hypot(tx, ty, tz);
  _day.set(tx / tl, ty / tl, tz / tl);
  _daz.set(Math.sin(u.h), 0, Math.cos(u.h));
  // z off the disc's normal, x = y cross z
  const dz = _daz.dot(_day);
  _daz.addScaledVector(_day, -dz).normalize();
  _dax.crossVectors(_day, _daz);
  _dm.makeBasis(_dax, _day, _daz);
  _dq.setFromRotationMatrix(_dm);
  if (sdt > 0) u.group.quaternion.slerp(_dq, Math.min(1, sdt * 10)); else u.group.quaternion.copy(_dq);
}

/* ------------------------------------------------------------- THE WING */
function droneWing(u, sdt) {
  const dr = u.dr, D = u.def.drone || {};
  const enemy = u.team === "red" ? "blue" : "red";
  const gy = HOST.groundAt(u.pos.x, u.pos.z);
  const cruise = D.cruise || 30, dash = D.dash || cruise * 1.4, agl = D.agl || 100;
  let tx, ty, tz, spdW = cruise, rate = D.turn || 0.5, free = false;
  if (dr.ph === "launch") {
    if (dr.boost > 0) {
      // up the rail on the booster: ~2 s to flying speed, then it drops
      dr.boost -= sdt;
      dr.spd = Math.min(cruise, dr.spd + 26 * sdt);
      dr.prop = 0.9;
      if (dr.boost <= 0) { dr.dropped = true; dr.ph = "climb"; droneBoosterDrop(u); }
    } else {
      // out of the tube: the wings snap open, the prop unfolds, the motor takes it
      dr.wings = Math.min(1, dr.t / 0.45);
      dr.prop = dr.t > 0.3 ? 1 : 0;
      dr.spd = Math.max(dr.spd - 4 * sdt, dr.t > 0.3 ? Math.min(cruise, dr.spd + 10 * sdt) : dr.spd);
      if (dr.t > 0.8) dr.ph = "climb";
    }
    // ballistic on the way out: gravity bends the path down until the wings fly
    const lift = dr.wings * Math.min(1, dr.spd / 18);
    dr.gam -= (1 - lift) * 9.81 * Math.cos(dr.gam) / Math.max(8, dr.spd) * sdt;
    droneVelFrom(u);
    u.pos.addScaledVector(dr.vel, sdt);
    const g2 = HOST.groundAt(u.pos.x, u.pos.z);
    if (u.pos.y < g2 + 0.3) { u.pos.y = g2 + 0.3; dr.gam = Math.max(dr.gam, 0.2); }
    u.speed = dr.spd * Math.cos(dr.gam); u.ds.v = dr.spd;
    droneOrient(u, sdt);
    return;
  }
  dr.wings = 1; dr.prop = 1;
  const t = dr.tgt;
  if (dr.ph === "climb") {
    tx = u.pos.x + Math.sin(u.h) * 300; tz = u.pos.z + Math.cos(u.h) * 300; ty = gy + agl;
    // turn toward the work while climbing
    const C = t ? t.pos : teamCOM[enemy];
    tx = u.pos.x + (C.x - u.pos.x) * 0.3; tz = u.pos.z + (C.z - u.pos.z) * 0.3;
    if (u.pos.y - gy > agl * 0.6) dr.ph = t ? "attack" : (dr.cls === "loiter" ? "loiter" : "transit");
    rate *= 0.7;
  } else if (dr.ph === "terminal" || dr.blindP) {
    // THE DIVE: pursuit with lead onto the aim point, at dash speed
    const p = droneAimPoint(u, _dv2);
    if (!p) { dr.ph = dr.cls === "loiter" ? "loiter" : "transit"; return; }
    const tgo = Math.hypot(p.x - u.pos.x, p.y - u.pos.y, p.z - u.pos.z) / Math.max(15, dr.spd);
    // a satellite-guided Shahed flies to where the mark WAS (coordinates); a seeker leads a mover
    const lead = D.link === "gnss" ? 0 : 1;
    tx = p.x + (t ? (t._vx || 0) * tgo * lead : 0); ty = p.y; tz = p.z + (t ? (t._vz || 0) * tgo * lead : 0);
    spdW = dash; rate = (D.turn || 0.5) * 2.2; free = true;
  } else if (dr.ph === "loiter" || (!t && dr.cls === "loiter")) {
    // THE ORBIT over the fight, the sensor looking for the mark
    if (dr.ph !== "loiter") { dr.ph = "loiter"; dr.scanT = simT + (D.scan || 8); }
    const C = dr.loiterC || (dr.loiterC = { x: teamCOM[enemy].x, z: teamCOM[enemy].z });
    // the orbit drifts with the enemy
    C.x += (teamCOM[enemy].x - C.x) * Math.min(1, sdt * 0.05); C.z += (teamCOM[enemy].z - C.z) * Math.min(1, sdt * 0.05);
    const R = D.loiterR || 300;
    const a = Math.atan2(u.pos.x - C.x, u.pos.z - C.z) + dr.orbitDir * 0.45;
    tx = C.x + Math.sin(a) * R; tz = C.z + Math.cos(a) * R; ty = HOST.groundAt(C.x, C.z) + (D.loiterAGL || agl);
    spdW = cruise * 0.85;
  } else if (!t) {
    // a one-way drone with nothing left to go to: on to the enemy's middle
    const C = teamCOM[enemy];
    tx = C.x; tz = C.z; ty = HOST.groundAt(C.x, C.z) + agl;
    dr.ph = "transit";
    if (D.link === "gnss" && Math.hypot(C.x - u.pos.x, C.z - u.pos.z) < (D.terminal || 1000)) { dr.blindP = new THREE.Vector3(C.x, HOST.groundAt(C.x, C.z) + 0.5, C.z); dr.ph = "terminal"; }
  } else {
    // ATTACK: to the mark at its height, then the dive from `terminal` out
    const p = droneAimPoint(u, _dv2);
    tx = p.x; tz = p.z;
    const dH = Math.hypot(p.x - u.pos.x, p.z - u.pos.z), h = u.pos.y - p.y;
    ty = HOST.groundAt(u.pos.x, u.pos.z) + agl;
    dr.ph = "attack";
    // into the dive once the dive line to the mark is steep enough (top attack)
    const steep = D.dive || 0.8;
    if (dH < (D.terminal || 700) && Math.atan2(h, Math.max(1, dH)) > steep * 0.85) { dr.ph = "terminal"; dr.commitT = simT; }
    // too close and too low for the dive: go out and come round
    else if (dH < Math.max(60, h / Math.tan(steep) * 0.5)) {
      tx = u.pos.x + Math.sin(u.h) * 400; tz = u.pos.z + Math.cos(u.h) * 400;
      ty = HOST.groundAt(u.pos.x, u.pos.z) + agl * 1.2;
    }
    if (D.link === "gnss" && dr.ph === "terminal") dr.blindP = new THREE.Vector3(p.x, p.y, p.z);
  }
  droneWingFly(u, sdt, tx, ty, tz, spdW, rate, free);
  droneOrient(u, sdt);
}
function droneWingFly(u, sdt, tx, ty, tz, spdW, rate, free) {
  const dr = u.dr;
  // the direction it wants, and the most it can turn toward it this step
  const dx = tx - u.pos.x, dy = ty - u.pos.y, dz = tz - u.pos.z, d = Math.hypot(dx, dy, dz) || 1e-3;
  const wantH = Math.atan2(dx, dz);
  let wantG = Math.atan2(dy, Math.max(1e-3, Math.hypot(dx, dz)));
  if (!free) wantG = droneClampN(wantG, -0.32, 0.28);        // cruise: no dives, a sane climb
  const h0 = u.h;
  u.h = droneWrapA(u.h + droneClampN(droneWrapA(wantH - u.h), -rate * sdt, rate * sdt));
  u.ds.w = sdt > 0 ? droneWrapA(u.h - h0) / sdt : 0;
  dr.gam += droneClampN(wantG - dr.gam, -rate * 1.2 * sdt, rate * 1.2 * sdt);
  // speed: the motor holds its speed, a dive adds to it, a climb takes from it
  dr.spd += droneClampN(spdW - dr.spd, -5 * sdt, 3.5 * sdt) - Math.sin(dr.gam) * 9.81 * 0.25 * sdt;
  dr.spd = droneClampN(dr.spd, 12, spdW * 1.35 + 5);
  droneVelFrom(u);
  u.pos.addScaledVector(dr.vel, sdt);
  const g = HOST.groundAt(u.pos.x, u.pos.z);
  if (dr.ph !== "terminal" && u.pos.y < g + 8) { u.pos.y = g + 8; if (dr.gam < 0) dr.gam = 0.05; }
  u.speed = dr.spd * Math.cos(dr.gam);
  u.ds.v = dr.spd; u.ds.vy = dr.vel.y; u.ds.gamma = dr.gam;
  u.yaw = u.h; u.heading = u.h;
}
function droneBoosterDrop(u) {
  if (camDist2(u.pos) > 400 * 400 || !CBZ.debris || !CBZ.debris.wreckage) return;
  try { CBZ.debris.wreckage(u.pos.x, u.pos.y - 0.3, u.pos.z, { color: 0x3c3f37, plates: 1, plateSize: 0.35, dir: { x: 0, y: -1, z: 0 }, power: 0.4, radius: 0.3 }); } catch (e) {}
}

/* ------------------------------------------------------------- lost: no link, no power */
function droneLostStep(u, sdt) {
  const dr = u.dr;
  dr.prop = 0;
  if (dr.frame === "quad") {
    // the failsafe has cut the motors: it falls
    dr.vel.y -= 9.81 * sdt;
    dr.vel.x *= 1 - 0.3 * sdt; dr.vel.z *= 1 - 0.3 * sdt;
  } else {
    // a glider with its motor stopped: a shallow descent
    dr.gam += droneClampN(-0.25 - dr.gam, -0.3 * sdt, 0.3 * sdt);
    dr.spd = Math.max(15, dr.spd - 1.5 * sdt);
    u.h = droneWrapA(u.h + dr.orbitDir * 0.15 * sdt);
    droneVelFrom(u);
  }
  u.pos.addScaledVector(dr.vel, sdt);
  dr.spd = dr.vel.length();
  u.speed = Math.hypot(dr.vel.x, dr.vel.z);
  if (dr.frame === "quad") { u.group.rotation.x += sdt * 2.2; u.group.rotation.z += sdt * 1.3; }
  else droneOrient(u, sdt);
}

/* ------------------------------------------------------------- THE HIT */
const _dbox = [];
// whatever it flies into this step: the mark's hull or the man, another hull,
// a wall, the ground; the aim point itself
function droneContact(u, sdt) {
  const dr = u.dr;
  if (dr.ph === "launch" && dr.frame === "quad") return;
  const g = HOST.groundAt(u.pos.x, u.pos.z);
  const t = dr.tgt;
  const live = dr.ph === "terminal" || dr.ph === "lost" || !!dr.blindP;
  // the mark's hull: the airframe inside its box
  if (t && t.vehicle && !t.dead && droneInHull(u, t, 0.25)) { droneDetonate(u, t, "hull"); return; }
  if (live) {
    const p = droneAimPoint(u, _dv2);
    if (p && Math.hypot(p.x - u.pos.x, p.y - u.pos.y, p.z - u.pos.z) < (t && !t.vehicle ? 1.1 : 0.7)) { droneDetonate(u, t && !t.dead ? t : null, t && t.vehicle ? "hull" : "point"); return; }
    // any other hull or man it runs into on the way down
    const a = fineNear(u.pos.x, u.pos.z, 4, _dbox);
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      if (o === u || o.dead || o.air) continue;
      if (o.vehicle) { if (droneInHull(u, o, 0.1)) { droneDetonate(u, o, "hull"); return; } }
      else if (o.team !== u.team && Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z) < 0.6 && u.pos.y - o.pos.y < 1.8) { droneDetonate(u, o, "point"); return; }
    }
  }
  // the ground, a wall (a drone with no link or no power crashes: its
  // warhead goes off only when the fuze takes the blow)
  if (u.pos.y <= g + 0.12 && dr.ph === "lost") { droneCrash(u); return; }
  if (u.pos.y <= g + 0.12 && (live || dr.ph !== "launch")) { droneDetonate(u, null, "ground"); return; }
  if (HOST && HOST.queryColliders) {
    const cols = HOST.queryColliders(u.pos.x, u.pos.z, 0.4, _dbox);
    for (let c = 0; c < cols.length; c++) {
      const b = cols[c];
      if (!HOST.colliderContains(b, u.pos.x, u.pos.z)) continue;
      if (b.y0 != null && (u.pos.y < b.y0 || u.pos.y > b.y1)) continue;
      droneDetonate(u, null, "wall"); return;
    }
  }
}
// is the airframe inside the hull's box (x port, y up, z forward)?
function droneInHull(u, v, pad) {
  const c = Math.cos(v.h || 0), s = Math.sin(v.h || 0);
  const wx = u.pos.x - v.pos.x, wz = u.pos.z - v.pos.z;
  const lx = wx * c - wz * s, lz = wx * s + wz * c, ly = u.pos.y - v.pos.y;
  return Math.abs(lx) < (v.vwid || 1.5) + pad && Math.abs(lz) < (v.vlen || 3) + pad && ly > -0.2 && ly < (v.vheight || 2.4) + pad;
}
/* THE WARHEAD GOES OFF. On a hull: the charge on the plate it struck (the
   kit's resolve, armourCE for a shaped charge), the crew along its jet, the
   engine when it was the engine deck; then the blast for everyone round it. */
function droneDetonate(u, hit, how) {
  const dr = u.dr, wh = dr.wh, A = DRONES.audit;
  const p = { x: u.pos.x, y: u.pos.y, z: u.pos.z };
  const g = HOST.groundAt(p.x, p.z);
  if (p.y < g + 0.15) p.y = g + 0.15;
  // spent: no longer a body (and not a casualty: it did what it was for)
  dr.ph = "spent";
  u.dead = true; u.hp = 0; u.vs.hp = 0;
  u.group.visible = false;
  if (dr.tgt) { droneClaim(u, dr.tgt, -1); }
  if (dr.op) droneOpLanded(dr.op, u);
  A.spent++; A.byClass[u.unitId].spent++;
  const sp = dr.spd || 1;
  const steep = dr.vel.y < -0.5 * sp;
  if (hit && hit.vehicle && !hit.dead) {
    // the struck point on the hull (the airframe is at it): a roof or a deck
    // is struck from above when it came down onto it
    const onTopFace = hit === dr.tgt && dr.face === "top" && dr.aim && p.y >= hit.pos.y + dr.aim[1] - 0.35 && dr.vel.y < 0;
    const top = steep || onTopFace || (p.y - hit.pos.y) > (hit.vheight || 2.4) * 0.85;
    u._shot = { pen: wh.pen, beh: wh.beh, he: true, cls: wh.cls, top: top };
    hurtMan(hit, wh.beh, { by: u, at: p });
    u._shot = null;
    const res = hit.lastHit;
    A.hits++; A.byClass[u.unitId].hits++;
    if (res) {
      const z = (dr.zone === "deck" && res.zone === "top" ? "deck" : res.zone) || "?";
      const Z = A.zones[z] || (A.zones[z] = { n: 0, pen: 0 });
      Z.n++;
      if (res.pen) { Z.pen++; A.pens++; }
      // THE ENGINE DECK: a jet through the grilles finds the engine and its fuel
      if (z === "deck" && res.pen && !hit.dead && hit.vs) {
        hit.vs.mobility = true;
        if (lcg() < 0.45) hit.vs.burning = true;
        if (hit.rig && typeof hit.rig.damage === "function") { try { hit.rig.damage(hit.vs, { zone: "top", pen: true, mobility: true, burning: hit.vs.burning, dmg: 0 }); } catch (e) {} }
      }
    }
  } else if (hit && !hit.vehicle) {
    A.hits++; A.byClass[u.unitId].hits++;
    const Z = A.zones.man || (A.zones.man = { n: 0, pen: 0 }); Z.n++;
  } else A.missed++;
  // THE BLAST: the warhead's own, for everyone round it (a hull inside it
  // takes the blast's figure, not the jet's: that was answered above)
  u._he = { pen: wh.blastPen || 10, beh: Math.round(wh.beh * 0.3), he: true, cls: "blast", top: true };
  if (STUDIO && STUDIO.boom) {
    try { STUDIO.boom(p, { radius: wh.blast || 5, power: wh.power || 1, structural: false, by: u }); } catch (e) {}
  }
  droneBurstFx(u, p, how);
}
function droneBurstFx(u, p, how) {
  const d2 = camDist2(p);
  if (d2 > 700 * 700) return;
  if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash(p, { scale: Math.min(9, 2 + (u.dr.wh.blast || 5) * 0.25), life: 0.25, color: 0xffc070 }); } catch (e) {} }
  if (d2 < 600 * 600) { try { CBZ.sfx("explosion", { dist: Math.sqrt(d2), ghost: true, volume: 0.9, pitch: u.dr.wh.blast > 20 ? 0.5 : 1.0, delay: Math.sqrt(d2) / 343 }); } catch (e) {} }
  droneShards(u, p, 1.4);
}
// the airframe's own pieces (systems/debris.js: torn plate, never boxes)
function droneShards(u, p, power) {
  if (!CBZ.debris || !CBZ.debris.wreckage || camDist2(p) > 260 * 260) return;
  const big = Math.min(1, (u.vlen || 0.3) * 0.6);
  try {
    CBZ.debris.wreckage(p.x, p.y, p.z, { color: u.unitId === "shahed_136" ? 0x2a2b2c : u.unitId === "fpv_drone" ? 0x1c1d1f : 0x8a8d8c,
      plates: 3 + (lcg() * 3 | 0), plateSize: 0.06 + 0.2 * big, dir: { x: 0, y: 1, z: 0 }, power: power, spread: 0.6, radius: 0.3 + big, dustColor: 0x5a544a });
  } catch (e) {}
}

// lost and down on the ground: a wreck, perhaps a bang (a loss, not a kill)
function droneCrash(u) {
  const dr = u.dr, wh = dr.wh;
  if (lcg() > (wh.dud || 0.2) * 2.5) { droneDetonate(u, null, "ground"); return; }
  dr.ph = "wreck";
  u.dead = true; u.hp = 0; u.vs.hp = 0;
  DRONES.audit.missed++;
  const g = HOST.groundAt(u.pos.x, u.pos.z);
  u.pos.y = g + 0.02;
  u.group.rotation.set(0.1, u.h, 0.3);
  droneShards(u, u.pos, 0.9);
}

/* ------------------------------------------------------------- SHOT DOWN */
// vehicles.js vehicleWrecked hands a drone here (killMan has counted it)
function droneKilled(u, imp) {
  const dr = u.dr, A = DRONES.audit;
  u.dieT = 0;
  if (dr.ph === "stowed" || dr.ph === "spent") return;
  const was = dr.ph;
  dr.ph = "down"; dr.prop = 0; dr.fallT = 0;
  if (dr.tgt) { droneClaim(u, dr.tgt, -1); dr.tgt = null; }
  if (dr.op) droneOpLanded(dr.op, u);
  if (was === "launch" && dr.frame === "quad") dr.vel.set(0, 0, 0);
  A.shotDown++; A.byClass[u.unitId].shotDown++;
  const by = imp && imp.by;
  const who = !by ? "blast" : by.vehicle ? by.unitId + (by._gunId ? ":" + by._gunId : "") : "rifle:" + (by.wid || "?");
  A.downBy[who] = (A.downBy[who] || 0) + 1;
  dr.spinX = (lcg() - 0.5) * 6; dr.spinZ = (lcg() - 0.5) * 8;
  if (camDist2(u.pos) < 200 * 200 && CBZ.bulletImpact) { try { CBZ.bulletImpact(u.pos, { x: 0, y: 1, z: 0 }, { kind: "spark", power: 1.2 }); } catch (e) {} }
  if (dr.frame === "wing" && u.rig && u.rig.state) u.rig.state.hit = true;
}
/* IT FALLS: its own momentum, gravity, the air; tumbling. Where it lands it
   breaks up; its warhead sometimes goes off (a piezo nose that hits first). */
function droneFall(u, sdt) {
  const dr = u.dr;
  if (dr.ph !== "down") return;
  dr.fallT += sdt;
  const v = dr.vel, drag = dr.frame === "quad" ? 0.35 : 0.12;
  v.y -= 9.81 * sdt;
  v.x *= 1 - drag * sdt; v.z *= 1 - drag * sdt; v.y *= 1 - drag * 0.5 * sdt;
  u.pos.addScaledVector(v, sdt);
  u.group.rotation.x += (dr.spinX || 0) * sdt;
  u.group.rotation.z += (dr.spinZ || 0) * sdt;
  const g = HOST.groundAt(u.pos.x, u.pos.z);
  if (u.pos.y > g + 0.05 && dr.fallT < 60) return;
  // the crash
  u.pos.y = g + 0.02;
  dr.ph = "wreck";
  u.group.rotation.set(dr.frame === "quad" ? 0.15 : 0.05, u.h, (lcg() - 0.5) * 0.6);
  droneShards(u, u.pos, 1.1);
  if (camDist2(u.pos) < 200 * 200 && CBZ.bulletImpact) { try { CBZ.bulletImpact({ x: u.pos.x, y: g + 0.05, z: u.pos.z }, { x: 0, y: 1, z: 0 }, { kind: "dust", power: 1.3 }); } catch (e) {} }
  const wh = dr.wh;
  if (lcg() > (wh.dud || 0.2) * 2.5) {
    DRONES.audit.crashBooms++;
    u._he = { pen: wh.blastPen || 10, beh: Math.round(wh.beh * 0.3), he: true, cls: "blast", top: true };
    if (STUDIO && STUDIO.boom) { try { STUDIO.boom({ x: u.pos.x, y: g + 0.3, z: u.pos.z }, { radius: (wh.blast || 5) * 0.8, power: (wh.power || 1) * 0.8, structural: false, by: u }); } catch (e) {} }
    u.group.visible = false;
    if (CBZ.muzzleFlash) { try { CBZ.muzzleFlash({ x: u.pos.x, y: g + 0.5, z: u.pos.z }, { scale: 3, life: 0.2, color: 0xffb060 }); } catch (e) {} }
  }
}

/* ------------------------------------------------------------- the carriers */
// thinkVehicle asks: a rack truck holds its start line while its cells are
// loaded and then withdraws; a Switchblade carrier stops for each launch
function droneCarrierThink(u) {
  if (!u._droneCells) return false;
  let loaded = 0;
  for (let k = 0; k < u._droneCells.length; k++) { const d = u._droneCells[k]; if (d && d.dr.ph === "stowed") loaded++; }
  const tac = u.def.tactics || {}, hold = tac.holdUntilEmpty;
  if (hold && loaded) {
    // to its launch site first: well back, where the rack cannot be seen
    if (!u._droneSite) u._droneSite = droneHidePoint(u, tac.launchBack || 450, 3);
    const S = u._droneSite, d = Math.hypot(S.x - u.pos.x, S.z - u.pos.z);
    u._droneAtSite = d < 12;
    if (u._droneAtSite) u.target.set(u.pos.x, 0, u.pos.z); else u.target.set(S.x, 0, S.z);
    u.slot = u._droneAtSite ? "hold" : "march";
    return true;
  }
  if (hold && !loaded) {
    // empty: off to its own edge before anybody answers
    const h = typeof tacHomeDir === "function" ? tacHomeDir(u.team) : { x: u.team === "red" ? -1 : 1, z: 0 };
    u.target.set(u.pos.x + h.x * 80, 0, u.pos.z + h.z * 80);
    u.slot = "fallback";
    if (Math.hypot(u.pos.x - u.home.x, u.pos.z - u.home.z) > 600) { u.fled = true; if (u.group) u.group.visible = false; }
    return true;
  }
  if (simT < (u._droneHoldT || 0)) { u.target.set(u.pos.x, 0, u.pos.z); u.slot = "hold"; return true; }
  return false;
}
