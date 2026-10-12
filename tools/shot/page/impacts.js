/* tools/shot/page/impacts.js — the IN-PAGE half of the impact catalogue
   (tools/catalogue.mjs --kind impacts). Evaluated into a warm, frozen NPC War
   page after tools/shot/page/npcwar.js; defines window.__imp:

     __imp.setup(P)     -> promise {ok, aim, shooter}: restage the field with the
                           shooter (red) and, for a unit target, the target
                           (blue); place both, aim the turret, silence every gun
     __imp.fire()       the shooter's REAL weapon path: vehFire / vehFireHE /
                           vehRelease (bombs) / fireRocket (the RPG)
     __imp.toImpact()   step the sim until the round is one step out (or hit)
     __imp.stepHit()    step until the impact lands (boom, hull hit, bullet)
     __imp.after(s)     step to s seconds after the impact
     __imp.result()     what happened, read off the target and CBZ.debris
     __imp.facts()      the weapon's own numbers (pen, blast) and the armour

   Nothing here is a second damage model. The round is the page's own: its
   flight (rockets / u.shots / fire.js rounds), its hit resolution (hurtMan ->
   hurtVehicle -> vehicleDrive.resolve), its blast (CBZ.studio.boom), its fx
   and debris (vehHitFx / vehKillFx / CBZ.debris). The page's calls are only
   OBSERVED to timestamp the impact. Two things are staged: positions are
   pinned until the impact (no AI drives the shooter or target out of frame),
   and with P.force the to-hit roll alone (vehFireKE / stepVehShots, matched
   by caller) comes up a hit; the armour roll stays the game's own. */
(function () {
  "use strict";
  var B = window.__battle, THREE = window.THREE, CBZ = window.CBZ;
  if (!B || !THREE || !CBZ) return false;
  var I = window.__imp = {};
  var V3 = function (x, y, z) { return new THREE.Vector3(x || 0, y || 0, z || 0); };
  var lcg0 = window.lcg;
  /* the to-hit roll forced by caller: the armour roll (resolve) is untouched */
  function lcgForced() {
    var s = (new Error().stack || "").split("\n")[2] || "";
    return /vehFireKE|stepVehShots/.test(s) ? 0.02 : lcg0();
  }
  if (!window.__impWrapped) {
    window.__impWrapped = true;
    var boom0 = CBZ.studio.boom;
    CBZ.studio.boom = function (pos) { var J = window.__imp; if (J && J.armed && J.hitT == null) J.hit("blast", pos); return boom0.apply(this, arguments); };
    var bi0 = CBZ.bulletImpact;
    if (bi0) CBZ.bulletImpact = function (pos) { var J = window.__imp; if (J && J.armed && J.hitT == null) J.hit("strike", pos); return bi0.apply(this, arguments); };
    var hm0 = window.hurtMan;
    window.hurtMan = function (t) { var J = window.__imp; if (J && J.armed && J.hitT == null && t === J.tgtU) J.hit("hull", t.pos); return hm0.apply(this, arguments); };
  }
  I.hit = function (how, p) {
    I.hitT = I.t; I.how = how; I.hitAt = p ? { x: +p.x, y: +p.y, z: +p.z } : null;
    if (I.forcing) { window.lcg = lcg0; I.forcing = false; }
  };

  function gy(x, z) { return MAP.groundAt(x, z); }
  function unitOf(team, id) {
    return B.roster().filter(function (m) { return m.team === team && (id === "men" ? (!m.vehicle && !m.beast) : m.unitId === id); })[0];
  }
  function place(m, x, z, h, y) {
    m.pos.set(x, y != null ? y : gy(x, z), z);
    if (m.vehicle) { m.h = h; m.speed = 0; if (m.group) { m.group.position.copy(m.pos); m.group.rotation.y = h; } }
    else { m.yaw = h; m.faceH = h; if (m.target) m.target.set(x, 0, z); m.home = { x: x, z: z }; }
    m.tgt = null;
  }
  function silence(m) { if (m.wpn) m.wpn.forEach(function (W) { W.off = true; }); m.cool = 1e9; }
  var pins = [];
  function pin(m, y, untilHit) { pins.push({ m: m, x: m.pos.x, y: y, z: m.pos.z, h: m.vehicle ? m.h : m.yaw, untilHit: !!untilHit }); }
  /* the game's own camera parked on the mark: hit fx, wreckage and grit are
     only made near the lens (the camDist2 gates), so the lens must be here */
  function camPark() {
    if (!I.aim) return;
    try {
      setCamMode("free");
      cam.focus.set(I.aim.x, I.aim.y, I.aim.z); cam.wFocus.copy(cam.focus);
      cam.yaw = cam.wYaw = 0.6; cam.pitch = cam.wPitch = 0.35; cam.dist = cam.wDist = 30;
      CBZ.camera.position.set(I.aim.x + 20, I.aim.y + 12, I.aim.z + 20);
      CBZ.camera.lookAt(I.aim.x, I.aim.y, I.aim.z); CBZ.camera.updateMatrixWorld(true);
    } catch (e) {}
  }
  function hold() {
    camPark();
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i], m = p.m;
      if (m.dead || (p.untilHit && I.hitT != null)) continue;
      m.pos.x = p.x; m.pos.z = p.z; if (p.y != null) m.pos.y = p.y;
      if (m.vehicle) { m.h = p.h; m.speed = 0; if (m.ds && !m.air && m.ds.v != null) m.ds.v = 0; }
    }
  }
  function step(d) { hold(); B.advance(d, Math.min(d, 1 / 60)); I.t += d; }

  /* P = { site:[x,z], shooter, wid | rw, how: fire|he|bomb|rpg, from (deg, the
     bearing from the mark to the shooter), range, alt, speed, force, burst, burstDt,
     target: { unit, h, alt } | { cover, h } | { ground: true, aimY } } */
  I.setup = function (P) {
    var K = CBZ.unitKit, ids = ["men"];
    if (P.shooter !== "men") ids.push(P.shooter);
    if (P.target.unit) ids.push(P.target.unit);
    if (!K || !K.need) return Promise.resolve(setupNow(P));
    return K.need(ids).then(function () { return setupNow(P); });
  };
  var _cq = [];
  /* is the straight path (px,py,pz) -> (tx,ty,tz) clear of the ground and of
     colliders? Points within skipR of (kx,kz) (the mark itself) are not asked.
     footprint: a collider with no height band (y0 null) stops the path at ANY
     height, which is how fire.js stepRockets treats one (a falling bomb that
     passes over a boulder's footprint goes off in the air) */
  function lineClear(px, pz, py, tx, tz, ty, kx, kz, skipR, footprint, endSkip) {
    var L = Math.hypot(tx - px, tz - pz), n = Math.max(20, Math.ceil(L / 3));
    for (var i = 1; i < n; i++) {
      var f = i / n, x = px + (tx - px) * f, z = pz + (tz - pz) * f, y = py + (ty - py) * f;
      if (L * f < 8 || Math.hypot(x - kx, z - kz) < skipR) continue;
      // a round laid ON the ground meets it at the end of its path: that is not a crest
      if (!footprint && !(endSkip && L * (1 - f) < endSkip) && gy(x, z) > y - 0.5) return false;
      var cols = CBZ.micro.queryColliders(x, z, 0.5, _cq);
      for (var c = 0; c < cols.length; c++) {
        var b = cols[c];
        if (!CBZ.micro.colliderContains(b, x, z)) continue;
        if (footprint ? b.y0 != null : (b.y0 != null && (y < b.y0 || y > b.y1))) continue;
        return false;
      }
    }
    return true;
  }
  /* a lens with a clear view of the point: pitch up, then swing round, until
     neither a dune nor a wall stands between the camera and the mark */
  I.cam = function (x, y, z, yaw, pitch, dist, keep) {
    var tries = [];
    [0, 8, 16, 26, 38].forEach(function (dp) { tries.push([0, dp]); });
    [40, -40, 80, -80, 130, -130, 180].forEach(function (dy) { [0, 12, 26].forEach(function (dp) { tries.push([dy, dp]); }); });
    for (var i = 0; i < tries.length; i++) {
      var yw = yaw + tries[i][0], pt = Math.min(80, pitch + tries[i][1]);
      var a = yw * Math.PI / 180, e = pt * Math.PI / 180;
      var cx = x + Math.sin(a) * Math.cos(e) * dist, cz = z + Math.cos(a) * Math.cos(e) * dist, cy = Math.max(y + Math.sin(e) * dist, gy(cx, cz) + 0.4);
      if (lineClear(cx, cz, cy, x, z, y, x, z, keep || 4, false)) return { yaw: yw, pitch: pt, moved: i > 0 };
    }
    return { yaw: yaw, pitch: pitch, moved: false, blocked: true };
  };
  /* where the lens looks after the impact: a unit target where it is NOW (a
     shot-down helicopter falls, a wreck is shoved), else the mark */
  I.focus = function () {
    var u = I.tgtU;
    if (u && u.pos) {
      var y = u.pos.y + (u.vheight || 2) * 0.5;
      if (u.group) { try { var bb = new THREE.Box3().setFromObject(u.group); if (!bb.isEmpty() && bb.getSize(V3()).length() < 60) y = (bb.min.y + bb.max.y) / 2; } catch (e) {} }
      return [u.pos.x, Math.max(y, gy(u.pos.x, u.pos.z) + 0.6), u.pos.z];
    }
    return [I.aim.x, I.aim.y, I.aim.z];
  };
  function setupNow(P) {
    window.lcg = lcg0;
    I.P = P; I.blocked = false; I.warn = null; I.t = 0; I.hitT = null; I.how = null; I.hitAt = null; I.armed = false; I.fired = 0; I.forcing = false; pins = [];
    try { if (CBZ.debris && CBZ.debris.clear) CBZ.debris.clear(); } catch (e) {}
    var T = P.target, tu = T.unit || null;
    var r = B.restage({ ru: P.shooter === "men" ? "men" : P.shooter + "*1", rn: 1, bu: tu ? tu + "*1,men*1" : "men", bn: tu ? 2 : 1,
      rw: P.rw || undefined, now: true });
    var sx = P.site[0], sz = P.site[1], g0 = gy(sx, sz);
    /* the round's path must be clear to the mark: a dune crest or a wall in
       between takes a low round first, and a full-height collider under a
       falling bomb's path sets it off in the air. On open ground the mark
       moves (rings of 30 m round the asked site: the face struck and the
       bearing stay as asked); at a building (P.skipR, the building's own
       reach) the bearing turns about it instead. A gun's HE round is laid on
       the ground under its mark (+ T.past beyond it), so that is the path tested. */
    var R = P.range || 300, turn = 0;
    var high = !!P.alt || P.how === "bomb" || (P.how === "he" && /mlrs|m270/.test(P.shooter));
    if (!P.noLine) {
      var ay0 = P.how === "he" && !high ? 0.15 : T.unit ? (T.alt || 0) + 1.2 : T.cover ? 0.6 : (T.aimY != null ? T.aimY : 0.15);
      var skip = P.skipR || (T.unit ? 6 : 3), mz = P.shooter === "men" ? 1.4 : 2.4;
      var cands = [];
      if (P.skipR) [0, 20, -20, 40, -40, 60, -60, 90, -90, 120, -120, 150, -150, 180].forEach(function (t) { cands.push([sx, sz, t]); });
      else { cands.push([sx, sz, 0]); for (var rg = 1; rg <= 10; rg++) for (var k2 = 0; k2 < 8; k2++) { var an = k2 * Math.PI / 4 + rg * 0.4; cands.push([sx + Math.sin(an) * 30 * rg, sz + Math.cos(an) * 30 * rg, 0]); } }
      var found = null;
      for (var q = 0; q < cands.length && !found; q++) {
        var cx = cands[q][0], cz = cands[q][1], b0 = ((P.from || 0) + cands[q][2]) * Math.PI / 180;
        var qx = cx + Math.sin(b0) * R, qz = cz + Math.cos(b0) * R;
        var ex = cx - Math.sin(b0) * (T.past || 0), ez = cz - Math.cos(b0) * (T.past || 0);
        var ok = high
          ? lineClear(qx, qz, gy(qx, qz) + (P.alt || 300), cx, cz, gy(cx, cz) + ay0, cx, cz, skip, true)
          : lineClear(qx, qz, gy(qx, qz) + mz, ex, ez, gy(ex, ez) + ay0, cx, cz, skip, false, P.how === "he" ? 25 + (T.past || 0) : 0);
        if (ok) found = cands[q];
      }
      if (found) { sx = found[0]; sz = found[1]; turn = found[2]; g0 = gy(sx, sz); } else I.blocked = true;
    }
    var shooter = unitOf("red", P.shooter);
    if (!shooter) throw new Error("no shooter " + P.shooter + " on the field " + JSON.stringify(r));
    var dummy = unitOf("blue", "men");
    var aim = V3(sx, g0 + (T.aimY != null ? T.aimY : 0.15), sz), tgt;
    var th = (T.h || 0) * Math.PI / 180;
    if (tu) {
      tgt = unitOf("blue", tu);
      if (!tgt) throw new Error("no target " + tu + " on the field " + JSON.stringify(r));
      var ty = T.alt ? g0 + T.alt : null;
      place(tgt, sx, sz, th, ty);
      silence(tgt); pin(tgt, ty, false);          // pinned while it lives: no AI drives it out of the lens
      aim.y = (ty != null ? ty : g0) + (tgt.vheight || 2) * 0.5;
    } else if (T.cover) {
      var rec = CBZ.battleDress.place(T.cover, sx, sz, th);
      try { CBZ.battleDress.flush(); } catch (e) {}
      if (!rec) throw new Error("cover " + T.cover + " could not be placed (no dressing on this map?)");
      aim.y = g0 + (rec.h || 1) * 0.55;
      rec.hp0 = rec.hp;
      tgt = { pos: V3(sx, g0, sz), aimY: (rec.h || 1) * 0.55, dead: false, vehicle: false, fake: true, rec: rec };
    } else {
      tgt = { pos: V3(sx, g0, sz), aimY: aim.y - g0, dead: false, vehicle: false, fake: true };
    }
    I.tgtU = tu ? tgt : null; I.tgt = tgt; I.aim = aim; I.ground = g0;
    I.from = (P.from || 0) + turn;
    var bd = I.from * Math.PI / 180;
    /* T.past: the round is laid on a point that far BEYOND the mark (a gun's
       HE path aims at the ground under its target; at a building that is the
       ground inside it, so the round would dig in short of the wall) */
    if (T.past && tgt.fake) { tgt.pos.x -= Math.sin(bd) * T.past; tgt.pos.z -= Math.cos(bd) * T.past; tgt.pos.y = gy(tgt.pos.x, tgt.pos.z); }
    var px = sx + Math.sin(bd) * R, pz = sz + Math.cos(bd) * R;
    var py = P.alt ? gy(px, pz) + P.alt : null;
    place(shooter, px, pz, Math.atan2(sx - px, sz - pz), py);
    silence(shooter); pin(shooter, py, false);
    if (shooter.air && shooter.ds) { shooter.ds.v = P.speed || shooter.ds.v || 200; shooter.ds.gamma = 0; }
    if (dummy) { place(dummy, sx + 900, sz + 900, 0); silence(dummy); pin(dummy, null, false); }
    I.shooter = shooter;
    var W = shooter.wpn ? shooter.wpn.filter(function (W) { return W.w.id === P.wid; })[0] : null;
    if (P.shooter !== "men" && !W) throw new Error("no weapon " + P.wid + " on " + P.shooter + " (has " + (shooter.wpn || []).map(function (W) { return W.w.id; }).join(", ") + ")");
    I.W = W;
    if (W) { W.ammo = 99; W.reloadT = 0; W.cool = 0; W.salvo = 0; W.burst = 0; }
    if (P.shooter === "men") { shooter.wid = P.rw; shooter.mag = 9; }
    if (shooter.rig && shooter.rig.aimTurret && !shooter.air) { shooter.tgt = tgt.fake ? null : tgt; for (var i = 0; i < 80; i++) { try { shooter.rig.aimTurret(0, 0.01, 0.1); } catch (e) { break; } } }
    for (var k = 0; k < 20; k++) step(1 / 60);
    I.t = 0;
    hold();
    return { ok: true, aim: [aim.x, aim.y, aim.z], ground: g0, from: I.from, turned: turn, blocked: !!I.blocked, warn: I.warn,
      shooter: [shooter.pos.x, shooter.pos.y, shooter.pos.z] };
  }

  function inFlight() {
    var best = null, u = I.shooter;
    function cons(p, v) { var d = p.distanceTo(I.aim), eta = d / Math.max(30, v); if (!best || eta < best.eta) best = { eta: eta, d: d }; }
    for (var i = 0; i < rockets.length; i++) if (rockets[i].by === u) cons(rockets[i].pos, rockets[i].vel.length());
    if (u.shots) for (var k = 0; k < u.shots.length; k++) cons(u.shots[k].pos, u.shots[k].w.speed || 300);
    return best;
  }
  function fireOnce() {
    var P = I.P, u = I.shooter, t = I.tgt, W = I.W;
    var dist = Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z);
    u.tgt = t.fake ? null : t; u.sees = true;
    if (P.force && I.hitT == null) { window.lcg = lcgForced; I.forcing = true; }
    var how = P.how || "fire";
    if (how === "rpg") { u.cool = 0; u.mag = 9; u.wid = P.rw; fireRocket(u, t); }
    else if (how === "bomb") {
      var agl = u.pos.y - gy(t.pos.x, t.pos.z), tf = Math.sqrt(2 * Math.max(10, agl) / 9.81);
      vehRelease(u, W, W.w.he || { pen: W.w.pen, beh: W.w.beh, blast: 18, power: 2.6 }, t, tf);
    } else if (how === "he") vehFireHE(u, W.w, t, dist);
    else vehFire(u, W, t, dist);
    if (I.forcing && !/missile|sam/.test(W ? W.w.kind : "") ) { /* KE: the roll is spent */ window.lcg = lcg0; I.forcing = false; }
    I.fired++;
    return dist;
  }
  function burstTick() {
    var P = I.P;
    if (P.burst && I.fired < P.burst && I.t >= I.fired * (P.burstDt || 0.12)) fireOnce();
  }
  I.fire = function () {
    I.armed = true; I.t = 0;
    var dist = fireOnce();
    return { dist: Math.round(dist), hit: I.hitT != null, inFlight: inFlight() };
  };
  I.toImpact = function (maxT) {
    var dt = 1 / 60;
    while (I.hitT == null && I.t < (maxT || 90)) {
      var f = inFlight();
      if (f && f.eta < dt * 2.5) return { near: true, t: I.t, eta: f.eta };
      burstTick();
      step(!f || f.eta > 3 ? 1 / 30 : dt);
    }
    return { near: false, t: I.t, hit: I.hitT != null };
  };
  I.stepHit = function (maxT) {
    var end = I.t + (maxT || 12);
    while (I.hitT == null && I.t < end) { burstTick(); step(1 / 60); }
    if (I.forcing) { window.lcg = lcg0; I.forcing = false; }
    return { hit: I.hitT != null, how: I.how, at: I.hitAt, t: I.t };
  };
  I.after = function (sec) {
    var end = (I.hitT != null ? I.hitT : I.t) + sec;
    while (I.t < end - 1e-6) { burstTick(); step(Math.min(1 / 60, end - I.t)); }
    return { t: I.t };
  };
  I.result = function () {
    var t = I.tgt, o = { how: I.how, at: I.hitAt, fired: I.fired };
    if (I.tgtU) {
      var lh = t.lastHit || {};
      o.dead = !!t.dead; o.hp = Math.round(t.hp || 0); o.maxHp = t.maxHp || null;
      o.pen = !!lh.pen; o.zone = lh.zone || null; o.armour = lh.armour != null ? Math.round(lh.armour) : null;
      o.mobility = !!lh.mobility; o.firepower = !!lh.firepower;
      o.burning = !!(t.vs && t.vs.burning); o.wreck = !!(t.vs && t.vs.wreck); o.crewLost = t.crewLost || 0;
    }
    if (t && t.rec) o.cover = { kind: t.rec.kind, alive: t.rec.alive !== false, hp: Math.round(t.rec.hp), hp0: t.rec.hp0 || null };
    try { var s = CBZ.debris.stats(); o.debris = { pieces: (s.live || 0) + (s.asleep || 0) + (s.static || 0), grit: s.grit || 0, dust: s.dust || 0 }; } catch (e) {}
    return o;
  };
  I.facts = function () {
    var o = {};
    var w = I.W ? I.W.w : null;
    if (w) {
      o.weapon = { id: w.id, kind: w.kind, pen: w.pen || null, beh: w.beh || null, speed: w.speed || null, heSpeed: w.heSpeed || null,
        range: w.range || null, he: w.he ? { pen: w.he.pen || null, blast: w.he.blast || null, power: w.he.power || null } : null };
    } else if (I.P.how === "rpg") {
      try {
        var R = CBZ.ballistics.ROCKET.pg7v || {};
        var F = CBZ.munitionTable ? CBZ.munitionTable.fx("pg7v") : {};
        o.weapon = { id: "pg7v", kind: "rocket", v0: R.v0, vMax: R.vMax, pen: F.pen || null, he: { blast: F.R || null, power: F.power || null } };
      } catch (e) {}
    }
    if (I.tgtU && I.tgtU.def) {
      var S = I.tgtU.def.stats || {};
      o.armour = S.armour || null; o.armourCE = S.armourCE || null; o.hp = S.hp || null;
    }
    if (I.tgt && I.tgt.rec) o.cover = { kind: I.tgt.rec.kind, hp: I.tgt.rec.hp0 || null };
    return o;
  };
  return true;
})();
