"use strict";
/* src/battle/convoyhost.js — NPC War: THE CONVOY ORDER. NPC War is one host
   of systems/convoy.js (CBZ.convoy, the one column driver both games use);
   this file is that host: the hulls, the men, the ground, the senses.

   THE ORDER. A side told to move as a convoy (?ac=1 for side A, ?bc=1 for
   side B; or CBZ.convoy.order from any system)
   does not stand on its start line. Its vehicles form up in column on their
   route (lead security vehicle, armour, carriers, tail; FM 4-01.45), the
   riders the roster put on the benches walk to their carriers' doors and get
   in, and the column drives a route from its start, past the enemy, to an
   objective beyond it: the road graph where the ground has roads (the
   downtown), the terrain planner where it does not (the dunes, the snow,
   the fields). The objective is read off the field, never a coordinate:
   the enemy's centre, `past` metres (?acp=, 350) beyond it along the line
   of march, `off` metres (?aco=, 0) to the right of it.

   On contact the column runs the doctrine in systems/convoy.js: through a
   near ambush, halt-face-dismount in a far one, cordon and re-route round an
   IED. At the objective (or released by its order) every hull goes back to
   the battle's own vehicle brain (vehicles.js thinkVehicle) and its men to
   the squads.

   SEAMS IN THE SIM (each behind `u.cv` / `m.cvTask`, so a battle without a
   convoy runs exactly as it did):
     men.js makeMan          a rider of a convoy side stays on the field (cvRide)
     ai/think.js think       a man on a convoy task (wait / board / cover) walks it
     step.js stepMan         ... at the task's pace
     vehicles.js thinkVehicle a convoy hull picks its marks; the convoy drives it
     vehicles.js stepVehicle  the convoy's control through vehMove (its own drive model)
     vehicles.js hurtVehicle  every hit is reported (contact, IED); no automatic bail-out
     vehicles.js vehDismount  out on the side away from the fire (lee)
     tick.js battleTick      convoyStep(sdt) before the men are stepped */

const CONVOY = { on: false, want: { red: null, blue: null }, cv: { red: null, blue: null }, made: { red: false, blue: false },
  camAt: null, events: [] };
const _cvq = [];

function convoyOrderFor(team) {
  const o = team === "red" ? SET.convoyA : SET.convoyB;
  return o && o !== "0" ? o : null;
}
function convoyWalks(team) { return !!convoyOrderFor(team); }
// a convoy side's rider, before the column exists: he stands where he formed
function convoyRiderSpawned(man, vi) {
  man.cvRide = vi;
  man.cvTask = { kind: "wait", x: man.pos.x, z: man.pos.z, pace: 0 };
}

/* ---------------------------------------------------------------- the host */
const CONVOY_HOST = {
  def: function (u) { return u.def; },
  dims: function (u) { return { len: u.vlen * 2, wid: u.vwid * 2 }; },
  pose: function (u) { return { x: u.pos.x, z: u.pos.z, h: u.h, v: u.ds.v }; },
  alive: function (u) { return !u.dead && !u.fled; },
  mobile: function (u) { return !u.dead && !u.fled && !u.vs.mobility && vehCrewN(u) > 0; },
  // LOD and the opening line-up: the hull is set on the route at this speed
  place: function (u, x, z, h, v) {
    u.pos.x = x; u.pos.z = z; u.h = h;
    u.ds.v = v || 0; u.ds.w = 0; u.ds.steer = 0;
    CBZ.vehicleDrive.pose(u.ds, HOST.groundAt, x, z, h, u.vlen * 2, u.vwid * 2, 0);
    u.pos.y = u.ds.y;
    u.group.rotation.set(-u.ds.pitch, h, -u.ds.roll);
    u.yaw = h + u.tur.yaw; u.heading = h; u.speed = Math.abs(v || 0);
    if (!v) { u.target.set(x, 0, z); }
  },
  marker: function (u, on) { u._cvMarker = !!on; },
  groundAt: function (x, z) { return HOST.groundAt(x, z); },
  // water: open water is all water; a map that knows its own (HOST.waterAt) says where
  waterAt: function (x, z) { return !!(HOST.water || (HOST.waterAt && HOST.waterAt(x, z))); },
  // a wall, a hesco line, a container: anything a hull cannot drive over
  blockedAt: function (x, z, r) {
    const a = HOST.queryColliders(x, z, r + 0.5, _cvq);
    if (!a.length) return false;
    const g = HOST.groundAt(x, z);
    for (let i = 0; i < a.length; i++) {
      const c = a[i];
      if (c.y1 != null && c.y1 < g + 0.6) continue;           // a kerb, a log: driven over
      if (HOST.colliderContains(c, x, z, r)) return true;
    }
    return false;
  },
  roads: function () { return HOST.roads || null; },
  entryAt: function (x, z) { return HOST.entryAt ? HOST.entryAt(x, z) : null; },
  town: function () { return !!HOST.roads; },                  // the downtown is all town
  camPos: function () { return CONVOY.camAt || (CBZ.camera && CBZ.camera.position) || null; },
  // WHAT THE COLUMN'S CREWS SEE: each hull's mark (vehicles.js vehPickTarget,
  // asked along real sight lines), and anybody inside 80 m of a hull
  threats: function (cv) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < cv.members.length; i++) {
      const u = cv.members[i].u;
      if (u.dead) continue;
      const t = u.tgt;
      if (t && !t.dead && !t.fled && t.team !== u.team && u.sees && !seen.has(t)) { seen.add(t); out.push({ x: t.pos.x, z: t.pos.z, unit: t, launcher: !!t.launcher }); }
    }
    const team = cv.members[0].u.team;                // the slot key ("red"/"blue"), whatever the side is called
    for (let k = 0; k < men.length; k++) {
      const o = men[k];
      if (o.team === team || o.dead || o.fled || o.air || seen.has(o)) continue;
      for (let i = 0; i < cv.members.length; i++) {
        const u = cv.members[i].u;
        if (Math.abs(o.pos.x - u.pos.x) < 80 && Math.abs(o.pos.z - u.pos.z) < 80 && Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z) < 80) {
          seen.add(o); out.push({ x: o.pos.x, z: o.pos.z, unit: o, launcher: !!o.launcher }); break;
        }
      }
    }
    return out;
  },
  passengers: function (u) { return vehPassengers(u); },
  freeSeats: function (u) { let n = 0; for (let k = 0; k < u.seats.length; k++) if (!u.seats[k].crew && !u.seats[k].man) n++; return u.dead ? 0 : n; },
  dismount: function (u, lee, why) { return vehDismount(u, lee); },
  manPos: function (m) { return m.pos; },
  manAlive: function (m) { return !m.dead && !m.fled; },
  // fit to walk back to his seat: not broken, not down, not carried
  manFit: function (m) { return !m.routed && !m.downed && !m._tossed && !m.vault; },
  walk: function (m, x, z, pace) {
    if (m.inVeh) return;
    const T = m.cvTask;
    if (T && T.kind === "board") { T.x = x; T.z = z; T.pace = pace; return; }
    m.cvTask = { kind: "board", x: x, z: z, pace: pace };
  },
  seat: function (m, u) { return convoySeat(m, u); },
  cover: function (m, x, z, secs) { if (!m.inVeh) m.cvTask = { kind: "cover", x: x, z: z, pace: 4.6, until: simT + secs }; },
  releaseMan: function (m) { m.cvTask = null; m.cvRide = null; },
  release: function (u) { u.cv = null; u.target.set(u.pos.x, 0, u.pos.z); },
  report: function (cv, kind, e) {
    if (kind === "phase" || kind === "lod") return;
    CONVOY.events.push(Object.assign({ side: cv.side }, e));
    if (CONVOY.events.length > 200) CONVOY.events.shift();
  },
  now: function () { return simT; },
};

/* A RIDER GETS IN: the seat book's own seat, then off the field exactly as
   a man seated at spawn is (vehicles.js vehStow) */
function convoySeat(man, u) {
  if (!u || u.dead || man.dead) return false;
  const s = CBZ.vehicleDrive.seat(u.seats, man, "passenger");
  if (!s) return false;
  man.cvTask = null; man.cvRide = null;
  vehStow(man);
  man.inVeh = u;
  man.pos.set(u.pos.x, u.pos.y, u.pos.z);
  const i = men.indexOf(man);
  if (i >= 0) men.splice(i, 1);
  u.dismounted = false;
  return true;
}

/* A MAN ON A CONVOY TASK (ai/think.js asks first): he walks it, and only it */
function convoyManThink(m) {
  const T = m.cvTask;
  if (!T) return false;
  if (T.until && simT > T.until) { m.cvTask = null; return false; }
  if (T.kind === "wait") { m.target.set(m.pos.x, 0, m.pos.z); m.slot = "hold"; return true; }
  m.target.set(T.x, 0, T.z);
  m.slot = T.kind === "cover" ? "cover" : "march";
  return true;
}
function convoyManPace(m) { const T = m.cvTask; return T ? T.pace : -1; }

/* ---------------------------------------------------------------- the order */
function convoyBegin() {
  CONVOY.want.red = convoyOrderFor("red"); CONVOY.want.blue = convoyOrderFor("blue");
  CONVOY.made.red = CONVOY.made.blue = false;
  CONVOY.cv.red = CONVOY.cv.blue = null;
  CONVOY.events.length = 0;
  CONVOY.on = !!(CBZ.convoy && (CONVOY.want.red || CONVOY.want.blue));
}
function convoyMake(team) {
  CONVOY.made[team] = true;
  const vs = men.filter(function (m) { return m.vehicle && m.team === team && !m.air && !m.dead; });
  if (!vs.length) return null;
  const enemy = team === "red" ? "blue" : "red";
  let cx = 0, cz = 0, ex = 0, ez = 0, en = 0;
  vs.forEach(function (u) { cx += u.pos.x; cz += u.pos.z; });
  cx /= vs.length; cz /= vs.length;
  for (let i = 0; i < men.length; i++) { const o = men[i]; if (o.team === enemy && !o.dead && !o.air) { ex += o.pos.x; ez += o.pos.z; en++; } }
  if (en) { ex /= en; ez /= en; } else { ex = HOST.cx; ez = HOST.cz; }
  let dx = ex - cx, dz = ez - cz;
  const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
  // the driver's right of the line of march is (-dz, dx)
  const past = SET.convoyPast != null ? SET.convoyPast : 350, off = SET.convoyOff || 0;
  const to = { x: ex + dx * past - dz * off, z: ez + dz * past + dx * off };
  /* WHERE IT FORMS UP. A column does not assemble inside the enemy's rifle
     range: on open ground it stands `start` metres short of him (?acs=,
     700: beyond the 600 m at which fire becomes its fight), on a map with
     roads it forms where its side spawned (the streets decide the rest). */
  const start = SET.convoyStart != null ? SET.convoyStart : (HOST.roads ? 0 : 700);
  let from = { x: cx, z: cz };
  if (start > d) from = { x: ex - dx * start, z: ez - dz * start };
  const riders = [];
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.team !== team || m.cvRide == null || m.dead) continue;
    const u = VEH.byIndex[team + ":" + m.cvRide];
    if (u && !u.dead) riders.push({ man: m, u: u }); else CONVOY_HOST.releaseMan(m);
  }
  const cv = CBZ.convoy.create({ side: team, units: vs, host: CONVOY_HOST, from: from, to: to, stage: true, riders: riders });
  if (!cv) { riders.forEach(function (r) { CONVOY_HOST.releaseMan(r.man); }); return null; }
  cv.members.forEach(function (m) { m.u.cv = cv.id; });
  CONVOY.cv[team] = cv;
  /* THE ASSEMBLY AREA. A column forms with its sections standing beside
     their own trucks, not in a block a quarter of a kilometre away: riders
     who have only just been dealt their start spots (the field is seconds
     old) form up in two files off their carrier's right side, eight to
     twelve metres out, and walk to its door from there. Later orders (a
     remount) walk from wherever the men are. */
  if (simT < 5) {
    const per = new Map();
    riders.forEach(function (r) {
      const u = r.u, j = per.get(u) || 0; per.set(u, j + 1);
      const fx = Math.sin(u.h), fz = Math.cos(u.h), rx = -Math.cos(u.h), rz = Math.sin(u.h);   // nose, the driver's right
      const out = u.vwid + 6 + (j % 2) * 1.6, along = u.vlen - 1 - ((j >> 1) % 8) * 1.4;
      const x = u.pos.x + rx * out + fx * along, z = u.pos.z + rz * out + fz * along;
      r.man.pos.set(x, HOST.groundAt(x, z), z);
      r.man.target.set(x, 0, z);
      if (r.man.cvTask) { r.man.cvTask.x = x; r.man.cvTask.z = z; }
      r.man.yaw = Math.atan2(-rx, -rz);
      if (r.man.group) r.man.group.rotation.y = r.man.yaw;
    });
  }
  return cv;
}
// every sim sub-step, before the men are stepped (loop.js)
function convoyStep(sdt) {
  if (!CONVOY.on) return;
  // the column forms once every body of its side is on the field
  if (spawnQueue.length === 0) {
    if (CONVOY.want.red && !CONVOY.made.red) convoyMake("red");
    if (CONVOY.want.blue && !CONVOY.made.blue) convoyMake("blue");
  }
  CBZ.convoy.tick(sdt);
}
function convoyReadout() {
  return {
    red: CONVOY.cv.red ? CBZ.convoy.audit(CONVOY.cv.red) : null,
    blue: CONVOY.cv.blue ? CBZ.convoy.audit(CONVOY.cv.blue) : null,
    events: CONVOY.events.slice(-60),
  };
}

/* ---------------------------------------------------------------- Gang City's army
   This file runs in the war realm Gang City compiles (battle/core/realm.js)
   as well as on battle.html. There CBZ.army's "route" order (a road
   movement) is handed to the convoy: the force's vehicles become a column on
   the city's roads (this host, the realm's own hulls and HOST), its men on
   foot follow the order to the route's end, and the column reports back
   through api.done() when it is there. A force with no vehicles walks the
   points the army's own way (the driver declines it). */
function convoyRouteDriver(F, o, api) {
  const vs = api.vehicles().filter(function (u) { return !u.air; });
  const pts = (o.route || []).filter(function (p) { return p && isFinite(p.x) && isFinite(p.z); });
  if (!vs.length || !pts.length) return null;
  const end = pts[pts.length - 1];
  const cv = CBZ.convoy.create({ side: F.side, units: vs, host: CONVOY_HOST, route: pts, to: end, dismountAtEnd: o.dismount !== false });
  if (!cv) return null;
  cv.members.forEach(function (m) { m.u.cv = cv.id; });
  api.move(end, { type: "move" });                         // the men on foot
  return {
    convoy: cv,
    step: function (dt) { if (!cv.done) CBZ.convoy.step(cv, dt); else api.done(); },
    stop: function () { CBZ.convoy.order(cv, { kind: "release" }); },
  };
}
if (CBZ.army && typeof CBZ.army.routeDriver === "function" && CBZ.convoy) CBZ.army.routeDriver(convoyRouteDriver);

