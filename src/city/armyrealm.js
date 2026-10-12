"use strict";
/* city/armyrealm.js — GANG CITY'S WAR: THE HOST GLUE.

   Not a page script: city/army.js compiles it into the battle realm
   (src/battle/core/realm.js) LAST, after city/armypage.js and the sim files,
   the way games/battle.html's begin.js and loop.js sit after the sim. It is
   what NPC War's war room, begin() and frame() are on that page:

     the field     the city itself: HOST = battleHost.fromCity (the real
                   floor, walls, rays); the nav map round the fighting
     the forces    a FORCE is a booked segment of one side (spawn.js
                   SPAWN_BOOK): its own roster, training, guns, crew plan,
                   formation and ORDER (ai/orders.js m.order). Its men are
                   rows in the tier sim (FAR until the lens comes, then FULL
                   rigs through mass.js's promotion), its vehicles and their
                   crews FULL at once (vehicles.js)
     the clock     cwFrame(dt): the sim's own sub-step (tick.js simSubStep)
                   and pose pass (animFrame) on the city's frame
     the player    a host actor (HOST.targets): the sides hostile to him
                   shoot at him with the sim's own flown rounds, which land
                   through CBZ.cityHurtPlayer; his rounds and blasts land on
                   the soldiers through the sim's hurtMan / blastBodies
                   (CBZ.army.shot / .blast, from fpsmode and crashfx)

   Exports REALM_EXPORT (city/army.js wraps it as CBZ.army). */

const CITYWAR = {
  open: false, sides: { red: null, blue: null }, forces: [], byId: new Map(), next: { red: 0, blue: 0 },
  list: [], listT: 0, bookT: 0, navAt: null, navT: 0, seq: 0, youOn: true,
};
const CW_NAV_R = 320;        // the nav map's half-size (m): 160 x 160 cells of 4 m

/* ---------------------------------------------------------------- the field */
function cwOpen(cx, cz) {
  if (CITYWAR.open) return;
  HOST = CBZ.battleHost.fromCity({ id: "city", cx: cx, cz: cz, gap: 150, spawnAt: cwSpawnAt, scene: CBZ.scene });
  HOST.spawnHeading = cwHeading;
  HOST.targets = cwTargets;
  MAP = HOST;
  STORE = CBZ.battleStore.create(1024);
  cwNav(cx, cz);
  MASS.open({ capHint: (REALM_PAGE && REALM_PAGE.capHint) || 2048, groundAt: HOST.groundAt });
  AIR.on = false;
  ORDER.red = ORDER.blue = "hold";
  started = true; over = false;
  CITYWAR.open = true;
}
// the walkable map round where the fighting is (rebuilt when the fighting moves)
function cwNav(cx, cz) {
  navBuild(cx, cz, CW_NAV_R);
  CITYWAR.navAt = { x: cx, z: cz };
  CITYWAR.navT = simT;
  if (MASS.nav) {
    MASS.nav.x0 = NAV.x0; MASS.nav.z0 = NAV.z0; MASS.nav.cell = NAV.cell; MASS.nav.w = NAV.w; MASS.nav.h = NAV.w;
    MASS.nav.block = NAV.block; MASS.nav.on = NAV.on;
  }
}
// the centre of the fighting: the FULL units' mean, else the lens
function cwNavFollow() {
  if (simT - CITYWAR.navT < 6) return;
  let x = 0, z = 0, n = 0;
  for (let i = 0; i < men.length; i++) { const m = men[i]; if (m.dead || m.air) continue; x += m.pos.x; z += m.pos.z; n++; }
  if (!n) return;
  x /= n; z /= n;
  if (Math.hypot(x - CITYWAR.navAt.x, z - CITYWAR.navAt.z) > CW_NAV_R * 0.55) cwNav(x, z);
  else CITYWAR.navT = simT;
}

/* ---------------------------------------------------------------- the sides
   Two slots ("red", "blue"), each one belligerent: a nation (city/flags.js id)
   and how it treats the player. A third belligerent while two hold the
   field is refused (one war at a time in one theatre). */
function cwSide(key, o) {
  o = o || {};
  for (const t of ["red", "blue"]) if (CITYWAR.sides[t] && CITYWAR.sides[t].key === key) return t;
  for (const t of ["red", "blue"]) {
    if (CITYWAR.sides[t] && cwSideAlive(t)) continue;
    CITYWAR.sides[t] = { key: key, slot: t, nation: o.nation || key, hostile: o.hostile || "never", stars: o.stars || 3, provokedUntil: -1 };
    if (t === "red") SET.nationA = CITYWAR.sides[t].nation; else SET.nationB = CITYWAR.sides[t].nation;
    refreshSides();
    return t;
  }
  return null;
}
function cwSideAlive(t) {
  for (let i = 0; i < CITYWAR.forces.length; i++) { const F = CITYWAR.forces[i]; if (F.slot === t && !F.gone && F.alive > 0) return true; }
  return false;
}
function cwHostile(sd) {
  if (!sd) return false;
  if (simT < sd.provokedUntil) return true;
  if (sd.hostile === "always") return true;
  if (sd.hostile === "wanted") return !!(CBZ.cityStars && CBZ.cityStars() >= sd.stars);
  return false;
}

/* ---------------------------------------------------------------- formation
   A force's place for each body: hulls on the leading line 14 m apart, men
   behind in ranks of ten (3.4 m across, 3.1 m deep). Offsets are laid out
   once (right, back) and turned onto any point and heading. */
function cwLayout(F) {
  const R = CBZ.battleRoster, K = CBZ.unitKit;
  const slots = new Array(F.n);
  let nv = 0, nm = 0;
  for (let j = 0; j < F.n; j++) {
    const id = R.kindAt(F.roster, j);
    const veh = id !== "men" && K && K.kindOf(id) === "vehicle";
    slots[j] = { veh: veh, k: veh ? nv++ : nm++ };
  }
  const vcols = Math.min(6, Math.max(1, nv)), mcols = Math.min(10, Math.max(1, nm));
  const vDepth = nv ? Math.ceil(nv / vcols) * 16 : 0;
  for (let j = 0; j < F.n; j++) {
    const s = slots[j];
    if (s.veh) { const row = (s.k / vcols) | 0, col = s.k % vcols; s.r = (col - (vcols - 1) / 2) * 14; s.b = row * 16; }
    else { const row = (s.k / mcols) | 0, col = s.k % mcols; s.r = (col - (mcols - 1) / 2) * 3.4; s.b = vDepth + row * 3.1; }
  }
  F.slots = slots;
}
function cwPlace(F, j, at, h) {
  const s = F.slots[j] || { r: 0, b: 0 };
  const fx = Math.sin(h), fz = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h);
  return { x: at.x + rx * s.r - fx * s.b, z: at.z + rz * s.r - fz * s.b };
}
// the nearest point out of the walls (a golden-angle spiral, the way the
// war room's spawnAt finds one): a hull needs its whole footprint clear
function cwFree(x, z, r) {
  r = r || 0.5;
  const ok = function (px, pz) {
    if (blockedAt(px, pz)) return false;
    if (r > 1.2) {
      const q = r * 0.7;
      if (blockedAt(px + q, pz + q) || blockedAt(px - q, pz + q) || blockedAt(px + q, pz - q) || blockedAt(px - q, pz - q)) return false;
    }
    return true;
  };
  if (ok(x, z)) return { x: x, z: z };
  for (let k = 1; k < 90; k++) {
    const a = k * 2.39996, d = 1.6 * Math.sqrt(k) * Math.max(1, r * 0.6);
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (ok(px, pz)) return { x: px, z: pz };
  }
  return { x: x, z: z };
}
function cwSpawnAt(side, i, r) {
  const seg = segOf(side, i), F = seg && seg.force;
  if (!F) return { x: HOST.cx, z: HOST.cz };
  const p = cwPlace(F, i - seg.from, F.spawnAt, F.heading);
  return cwFree(p.x, p.z, r);
}
function cwHeading(side, i) {
  const seg = segOf(side, i);
  return seg && seg.force ? seg.force.heading : null;
}
// where body i of force F stands for its current order (hold / move / withdraw)
function cwHome(F, i) {
  const o = F.order;
  if (!o || !o.at) return null;
  const h = o.heading != null ? o.heading : F.heading;
  const p = cwPlace(F, i - F.from, o.at, h);
  return cwFree(p.x, p.z, F.slots[i - F.from] && F.slots[i - F.from].veh ? 3 : 0.5);
}

/* ---------------------------------------------------------------- forces */
// spec = { id, side, nation, hostile, stars, roster, n, tier, gun, at, heading, order, name }
function cwSpawn(spec) {
  const slot = cwSide(spec.side, spec);
  if (!slot) return null;
  if (!CITYWAR.open) cwOpen(spec.at.x, spec.at.z);
  const R = CBZ.battleRoster;
  const n = R.size(spec.roster, spec.n || 1);
  // a force begins on a squad boundary: its squads are its own
  const from = Math.ceil(CITYWAR.next[slot] / 10) * 10;
  CITYWAR.next[slot] = from + n;
  const F = {
    id: spec.id || ("force" + (++CITYWAR.seq)), name: spec.name || null, slot: slot, side: CITYWAR.sides[slot],
    roster: spec.roster, from: from, n: n, tier: spec.tier || "elite", gun: spec.gun || "carbine",
    spawnAt: { x: spec.at.x, z: spec.at.z }, heading: spec.heading != null ? spec.heading : 0,
    order: null, rows: [], gone: false, alive: n, vehicles: 0, dead: 0, fled: 0, routed: 0,
    contact: false, arrived: false, cx: spec.at.x, cz: spec.at.z, born: simT,
  };
  F.homeOf = function (i) { return cwHome(F, i); };
  cwLayout(F);
  F.order = cwOrderRec(F, spec.order || { type: "hold", at: spec.at, heading: F.heading });
  /* FRESH TROOPS ARE A FRESH ARMY. The sim keeps one morale per side (the
     war room fights one battle); in the city a side fights many, minutes and
     kilometres apart. A force that arrives rebases its side's books on what
     is still standing: the losses of a fight that is over do not break men
     who were not in it. */
  const AR = ARMY[slot];
  if (AR) { AR.p0 = AR.pNow; AR.men0 = AR.alive; AR.broken = false; AR.shock = 0; AR.morale = 1; AR.noFightT = 0; AR.lastman = false; }
  SPAWN_BOOK[slot].push({ from: from, n: n, roster: spec.roster, tier: F.tier, gun: F.gun, force: F });
  SET[slot === "red" ? "redN" : "blueN"] = CITYWAR.next[slot];
  CITYWAR.forces.push(F);
  CITYWAR.byId.set(F.id, F);
  const m0 = men.length;
  if (MASS.on) F.rows = MASS.addRows(slot, from, n);
  else for (let j = 0; j < n; j++) spawnOne(slot, from + j);   // no tier sim: every body FULL
  MASS.orderRows(F.rows, F.order, function (r, i) { return F.homeOf(i); });
  // the FULL units it brought (hulls, the men on foot beside them): on the
  // army's books now, so morale.js never mistakes the field for a new war
  for (let k = m0; k < men.length; k++) {
    const m = men[k];
    if (!m._mc && ARMY[m.team]) { m._mc = 1; m._mw = manWeight(m); ARMY[m.team].p0 += m._mw; ARMY[m.team].men0++; }
  }
  cwBook(true);
  return F;
}
function cwOrderRec(F, o) {
  const at = o.at ? { x: o.at.x, z: o.at.z } : { x: F.cx, z: F.cz };
  let h = o.heading;
  if (h == null) {
    const dx = at.x - F.cx, dz = at.z - F.cz;
    h = Math.hypot(dx, dz) > 4 ? Math.atan2(dx, dz) : F.heading;
  }
  return { type: o.type || "hold", at: at, heading: h, face: o.face || null, t: simT };
}
function cwOrder(F, o) {
  if (!F || F.gone) return false;
  F.order = cwOrderRec(F, o || {});
  F.arrived = false;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.force !== F) continue;
    m.order = F.order;
    if (F.order.type !== "attack") { const h = F.homeOf(m.i); if (h) m.home = h; }
    m.thinkAt = simT;
  }
  MASS.orderRows(F.rows, F.order, function (r, i) { return F.homeOf(i); });
  // the squad brain forgets where it held (core/tactics.js caches the anchor)
  const BT = CBZ.battleTactics;
  if (BT && BT.squads) {
    for (let q = (F.from / 10) | 0; q <= ((F.from + F.n - 1) / 10 | 0); q++) {
      const S = BT.squads.get(F.slot + ":" + q);
      if (S) { S.holdAnchor = null; S.anchor = null; S.fellBack = false; S.postsDirty = true; S.tickAt = simT; }
    }
  }
  return true;
}
// a force off the map: rows freed, rigs and hulls dropped, its seats emptied
function cwDisband(F) {
  if (!F || F.gone) return false;
  F.gone = true;
  MASS.removeRows(F.rows);
  F.rows = [];
  for (let i = men.length - 1; i >= 0; i--) {
    const m = men[i];
    if (m.force !== F) continue;
    men.splice(i, 1);
    cwDrop(m);
  }
  const L = SPAWN_BOOK[F.slot];
  const k = L.findIndex(function (s) { return s.force === F; });
  if (k >= 0) L.splice(k, 1);
  CITYWAR.byId.delete(F.id);
  const j = CITYWAR.forces.indexOf(F);
  if (j >= 0) CITYWAR.forces.splice(j, 1);
  cwBook(true);
  return true;
}
function cwDrop(m) {
  const sq = squads[m.team] && squads[m.team][m.sq];
  if (sq) { const k = sq.indexOf(m); if (k >= 0) sq.splice(k, 1); }
  if (m.seats) for (let s = 0; s < m.seats.length; s++) { const c = m.seats[s].man; if (c && c.group) STUDIO.drop(c.group); }
  if (m.row != null && m.row >= 0) { STORE.free(m.row); m.row = null; }
  if (m.group) STUDIO.drop(m.group);
  m.dead = true; m.armyUnit = false;
}

/* ---------------------------------------------------------------- the player */
const CW_YOU = {
  hostActor: true, team: "city", id: "you", i: -1, pos: new THREE.Vector3(), yaw: 0, heading: 0, h: 0, speed: 0,
  stance: "stand", hp: 100, maxHp: 200, dead: false, fled: false, downed: false, routed: false, beast: false, vehicle: false,
  air: false, armed: true, fists: false, launcher: false, rad: 0.45, eyeH: 1.62, losY: 1.35, aimY: 1.28, headY: 1.62,
  coverK: 1, supp: 0, kills: 0, name: "you",
  hurt: function (dmg, imp) {
    if (!CBZ.cityHurtPlayer || CW_YOU.dead) return;
    const by = imp && imp.by;
    try {
      CBZ.cityHurtPlayer(dmg, by && by.pos ? by.pos.x : CW_YOU.pos.x, by && by.pos ? by.pos.z : CW_YOU.pos.z,
        imp && imp.cause === "bomb" ? "explosion" : "shot", !!(imp && imp.headshot), by && by.pos ? by : "soldier", false, null);
    } catch (e) {}
  },
};
function cwYouSync() {
  const P = CBZ.player;
  if (!P || !P.pos) { CW_YOU.dead = true; return; }
  CW_YOU.pos.set(P.pos.x, P.pos.y, P.pos.z);
  CW_YOU.dead = !!P.dead;
  CW_YOU.hp = P.hp; CW_YOU.maxHp = P.maxHp || 200;
  CW_YOU.speed = P.speed || 0;
  const g = CBZ.playerChar && CBZ.playerChar.group;
  if (g) { CW_YOU.yaw = CW_YOU.heading = CW_YOU.h = g.rotation.y; }
  CW_YOU.stance = P.crouch ? "crouch" : "stand";
  CW_YOU.losY = P.crouch ? 0.87 : 1.35; CW_YOU.aimY = P.crouch ? 0.83 : 1.28; CW_YOU.eyeH = P.crouch ? 0.98 : 1.62;
}
// HOST.targets: the player, for a side that is hostile to him
function cwTargets(m, range, out, spot) {
  const Y = CW_YOU;
  if (Y.dead || !CITYWAR.youOn || !cwHostile(CITYWAR.sides[m.team])) return;
  const dx = Y.pos.x - m.pos.x, dz = Y.pos.z - m.pos.z, d2 = dx * dx + dz * dz;
  if (d2 > range * range) return;
  if (spot && CBZ.brain && CBZ.brain.perception && !CBZ.brain.perception.sees(m, Y, spot)) return;
  out.push(Y, d2);
}
/* the player's round on a soldier (systems/fpsmode.js cityGunHit): the sim's
   own funnel, his kit answering (raw: the gun already priced head and limb),
   and the side he shot at is his enemy for the next two minutes */
function cwShot(a, dmg, hit, w) {
  if (!a || a.dead) return { head: false, down: false, dmg: 0 };
  const head = !!(hit && hit.head);
  hurtMan(a, dmg, { kind: "bullet", wid: w && w.key, zone: head ? "head" : "torso", headshot: head, raw: true,
    by: CW_YOU, cause: "gun", fromX: CW_YOU.pos.x, fromZ: CW_YOU.pos.z });
  const sd = CITYWAR.sides[a.team];
  if (sd) sd.provokedUntil = simT + 120;
  if (CBZ.cityAlarm && CBZ.city) { try { CBZ.cityAlarm(a.pos.x, a.pos.z, 16, 1, CBZ.city.playerActor); } catch (e) {} }
  return { head: head, down: !!a.dead, dmg: dmg };
}
/* a detonation in the city (crashfx applyBlastDamage): the sim's own blast on
   the FULL bodies and hulls, the tier sim's on the rows */
function cwBlast(x, z, R, power, o) {
  if (!CITYWAR.open) return 0;
  o = o || {};
  const y = HOST.groundAt(x, z) + 1;
  const n = blastBodies(x, y, z, R, power, { by: o.byPlayer ? CW_YOU : null, cause: o.cause || "explosion" });
  if (o.byPlayer) for (const t of ["red", "blue"]) {
    const sd = CITYWAR.sides[t];
    if (sd && cwNearSide(t, x, z, R * 2)) sd.provokedUntil = simT + 120;
  }
  MASS.blast(x, z, R, null);
  return n;
}
function cwNearSide(t, x, z, r) {
  for (let i = 0; i < men.length; i++) { const m = men[i]; if (m.team === t && !m.dead && Math.hypot(m.pos.x - x, m.pos.z - z) < r) return true; }
  return false;
}

/* ---------------------------------------------------------------- the books
   What each force has left, where it is, and what happened to it (the bus);
   the soldiers the city's guns can hit (CBZ.cityArmy). */
const CW_EVENTS = [];
function cwEmit(type, F, data) { CW_EVENTS.push({ type: type, force: F ? F.id : null, data: data || null, t: simT }); }
function cwBook(now) {
  if (!now && simT - CITYWAR.bookT < 0.5) return;
  CITYWAR.bookT = simT;
  const C = STORE.cols;
  for (let k = 0; k < CITYWAR.forces.length; k++) {
    const F = CITYWAR.forces[k];
    let alive = 0, dead = 0, fled = 0, routed = 0, x = 0, z = 0, nx = 0, veh = 0, contact = false;
    for (let j = 0; j < F.rows.length; j++) {
      const r = F.rows[j], l = C.life[r];
      if (l === 1 || l === 2) { alive++; x += C.x[r]; z += C.z[r]; nx++; if (l === 2) routed++; if (C.tier[r] !== 0 && C.tgt && C.tgt[r] >= 0) contact = true; }
      else if (l === 4) dead++;
      else if (l === 3) fled++;
    }
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.force !== F) continue;
      if (m.tgt && !m.tgt.dead) contact = true;
      if (m.row != null && m.row >= 0 && !m.vehicle) continue;      // counted as a row
      if (m.dead) { if (m.vehicle) dead++; continue; }
      if (m.vehicle) veh++;
      else { alive++; if (m.routed) routed++; }
      x += m.pos.x; z += m.pos.z; nx++;
    }
    if (nx) { F.cx = x / nx; F.cz = z / nx; }
    const was = F.alive;
    F.alive = alive + veh; F.vehicles = veh; F.dead = dead; F.fled = fled; F.routed = routed;
    if (contact && !F.contact) cwEmit("contact", F);
    F.contact = contact;
    if (was > 0 && F.alive === 0) cwEmit("destroyed", F);
    if (F.alive > 0 && routed > F.alive * 0.5 && !F._routedSaid) { F._routedSaid = true; cwEmit("routed", F); }
    if (F.order && F.order.type !== "attack" && !F.arrived && nx && Math.hypot(F.cx - F.order.at.x, F.cz - F.order.at.z) < 22) {
      F.arrived = true; cwEmit("arrived", F);
    }
  }
}
function cwListSync() {
  if (simT - CITYWAR.listT < 0.2) return;
  CITYWAR.listT = simT;
  const L = CITYWAR.list;
  L.length = 0;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.dead || m.vehicle || m.inVeh || !m.group || m.group.visible === false) continue;
    m.armyUnit = true;
    L.push(m);
  }
}

/* ---------------------------------------------------------------- the clock */
function cwFrame(dt) {
  if (!CITYWAR.open || !(dt > 0)) return;
  dt = Math.min(dt, 0.25);
  cwYouSync();
  const sub = Math.min(6, Math.max(1, Math.ceil(dt / 0.055)));
  const sdt = dt / sub;
  for (let s = 0; s < sub; s++) {
    simT += sdt;
    simSubStep(sdt);
  }
  if (sinking.length) stepSinking(dt);
  animFrame(dt, dt);
  cwNavFollow();
  cwBook(false);
  cwListSync();
}

function cwAudit() {
  return {
    open: CITYWAR.open, simT: Math.round(simT * 10) / 10, men: men.length, rows: STORE ? STORE.rows : 0,
    sides: { red: CITYWAR.sides.red && CITYWAR.sides.red.key, blue: CITYWAR.sides.blue && CITYWAR.sides.blue.key },
    forces: CITYWAR.forces.map(function (F) {
      return { id: F.id, side: F.side.key, n: F.n, alive: F.alive, dead: F.dead, fled: F.fled, vehicles: F.vehicles,
        order: F.order && F.order.type, x: Math.round(F.cx), z: Math.round(F.cz), contact: F.contact };
    }),
    nav: NAV.on ? { at: CITYWAR.navAt, blocked: NAV.blocked } : null,
    mass: MASS.audit(), arms: CBZ.battleArms && CBZ.battleArms.audit ? CBZ.battleArms.audit() : null,
  };
}

const REALM_EXPORT = {
  open: cwOpen, frame: cwFrame, spawn: cwSpawn, order: cwOrder, disband: cwDisband,
  shot: cwShot, blast: cwBlast, audit: cwAudit,
  force: function (id) { return CITYWAR.byId.get(id) || null; },
  forces: function () { return CITYWAR.forces; },
  events: function () { const e = CW_EVENTS.slice(); CW_EVENTS.length = 0; return e; },
  list: function () { return CITYWAR.list; },
  you: function (on) { if (on != null) CITYWAR.youOn = !!on; return CITYWAR.youOn; },
  units: function (F) { const out = []; for (let i = 0; i < men.length; i++) if (men[i].force === F) out.push(men[i]); return out; },
  sides: CITYWAR.sides,
  get simT() { return simT; },
  get men() { return men; },
};
