"use strict";
/* src/battle/player.js — NPC War: YOU: the player takeover.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* set in onBoot below (they need THREE / the raised world) */
let _yFrom, _yTo;

/* ============================================================ YOU
   TAKE A RIFLE. The page was a thing you only watched; now you can be one
   of the men. The rifle button (or G) puts you in the boots of a soldier of
   your side — your call's side on the war room, your own nation's at the
   front — standing in the middle of his army. He stops thinking and you
   drive him: WASD (the stick on a phone), the mouse looks, the button
   fires, R reloads, C kneels, Shift runs. The enemy shoots at you the way
   it shoots at anybody. The same button gives the rifle back and the man
   goes back to fighting on his own.

   Everything a round does is the page's own: fireShot draws it, lands it
   (hurtMan, wounds, the kill ledger) and plays it. The man is the same man:
   his gun, his magazine, his reload, his training's damage per round
   (combat_iq's derived number, so YOU are a soldier, not a god), at a
   cadence capped to twice his own rhythm. Aim is your yaw: the nearest
   enemy you can SEE inside a hair of the crosshair takes the round. */
const YOU = { m: null, yaw: 0, pitch: 0.24, down: false };
let TB = null;
function youTeam() {
  if (FRONT) return "red";
  // a side you can join: it has men on it, or a vehicle you can drive
  const menIn = function (u) {
    const ids = CBZ.battleRoster ? CBZ.battleRoster.ids(u) : String(u).split("|");
    for (let k = 0; k < ids.length; k++) {
      if (ids[k] === "men" || (CBZ.unitKit && CBZ.unitKit.kindOf(ids[k]) === "vehicle")) return true;
    }
    return false;
  };
  if (SET.call && menIn(SET.call === "red" ? SET.redU : SET.blueU)) return SET.call;
  return menIn(SET.redU) ? "red" : menIn(SET.blueU) ? "blue" : null;
}
function join() {
  if (!started || over || bench || YOU.m) return false;
  const team = youTeam();
  if (!team) return false;
  const c = teamCOM[team];
  let m = null, bd = Infinity;
  /* A SIDE WITH A VEHICLE PUTS YOU IN IT: the man you become is its crew
     (src/battle/vehicles.js drives it from your keys). */
  for (let i = 0; i < men.length; i++) {
    const o = men[i];
    if (o.team !== team || !o.vehicle || o.dead || o.fled || vehCrewN(o) === 0) continue;
    const d = Math.hypot(o.pos.x - c.x, o.pos.z - c.z) + (o.air ? 500 : 0);
    if (d < bd) { bd = d; m = o; }
  }
  if (m) {
    YOU.m = m; YOU.last = m; YOU.down = false;
    m.you = true; m.slot = "you";
    YOU.yaw = m.h; YOU.pitch = 0.3;
    if (speed !== 1) setSpeed(1);
    if (KILL.t > 0) { KILL.t = 0; KILL.m = null; }
    setCamMode("you");
    if (COARSE) touchOn(); else CBZ.micro.lock();
    el("xhair").classList.add("on");
    el("cRifle").classList.add("on");
    return true;
  }
  for (let i = 0; i < men.length; i++) {
    const o = men[i];
    if (o.team !== team || o.dead || o.fled || o.beast || o.routed || o.downed || o._apeHeld || o._apeFlying) continue;
    // the RIFLE button: a rifleman first, the launcher crew only if nobody else is near
    const d = Math.hypot(o.pos.x - c.x, o.pos.z - c.z) + (o.armed ? 0 : 40) + (o.launcher ? 30 : 0);
    if (d < bd) { bd = d; m = o; }
  }
  if (!m) return false;
  YOU.m = m; YOU.last = m; YOU.down = false;
  m.you = true; m.tgt = null; m.hull = null; m.slot = "you"; m.stepAsideT = 0;
  YOU.yaw = m.yaw; YOU.pitch = 0.24;
  setStance(m, "stand");
  if (speed !== 1) setSpeed(1);              // a soldier lives at one second a second
  if (KILL.t > 0) { KILL.t = 0; KILL.m = null; }
  setCamMode("you");
  if (COARSE) touchOn(); else CBZ.micro.lock();
  el("xhair").classList.add("on");
  el("cRifle").classList.add("on");
  return true;
}
function leaveYou(down) {
  const m = YOU.m;
  YOU.m = null;
  if (down) YOU.down = true;
  if (m) { m.you = false; m.thinkAt = simT; m.slot = "hold"; }
  touchOff();
  if (!COARSE) CBZ.micro.unlock();
  el("xhair").classList.remove("on");
  el("cRifle").classList.remove("on");
  if (cam.mode === "you") {
    setCamMode("auto");
    // the director holds on where you fell before it cuts away
    if (m && down) { cam.shot = "point"; cam.followM = m; cam.holdT = 0; cam.cutAt = simT + 3; }
  }
}
function youDown(m) { if (YOU.m === m) leaveYou(true); }
function toggleRifle() { if (YOU.m) leaveYou(false); else join(); }
function touchOn() {
  const T = CBZ.micro.touch;
  if (!T) return;
  if (!T.root) T.init({});
  if (!T.root) return;
  T.root.style.display = "";
  if (!TB) TB = {
    fire: T.addButton({ glyph: "◎", key: "KeyJ", right: 22, bottom: "calc(104px + env(safe-area-inset-bottom,0px))", size: 86, id: "tFire" }),
    reload: T.addButton({ glyph: "↻", key: "KeyR", right: 122, bottom: "calc(92px + env(safe-area-inset-bottom,0px))", size: 54, id: "tReload" }),
    crouch: T.addButton({ glyph: "▼", key: "KeyC", right: 30, bottom: "calc(206px + env(safe-area-inset-bottom,0px))", size: 54, id: "tCrouch" }),
  };
}
function touchOff() { const T = CBZ.micro.touch; if (T && T.root) T.root.style.display = "none"; }

// the round's damage: his training's derived number for this gun (the same
// arithmetic IQ.shot runs for every man on the field)
function youRoundDmg(m, w) {
  const base = (w && w.damage) || 14;
  const p = CBZ.combatIQ && CBZ.combatIQ.profile ? CBZ.combatIQ.profile(m) : null;
  if (!p || !p.secPerRound || !p.dps) return base * 0.4;
  const mul = Math.max(0.35, Math.min(1.6, (p.dps * p.secPerRound) / ((p.hit10 || 0.6) * base)));
  return base * mul;
}
function youCadence(m, w) {
  const p = CBZ.combatIQ && CBZ.combatIQ.profile ? CBZ.combatIQ.profile(m) : null;
  return Math.max((w && (w.fireDelay || w.interval)) || 0.12, p && p.secPerRound ? p.secPerRound * 0.5 : 0.15);
}
function youTarget(m, range) {
  const fx = Math.sin(YOU.yaw), fz = Math.cos(YOU.yaw);
  let best = null, bs = Infinity;
  for (let i = 0; i < men.length; i++) {
    const o = men[i];
    if (o.dead || o.fled || o.team === m.team) continue;
    const dx = o.pos.x - m.pos.x, dz = o.pos.z - m.pos.z, d = Math.hypot(dx, dz);
    if (d > range || d < 0.3) continue;
    const along = (dx * fx + dz * fz) / d;
    if (along < 0.85) continue;
    const ang = Math.acos(Math.min(1, along));
    const cone = 0.03 + 0.9 / d + (o.rad || 0.45) / d;
    if (ang > cone) continue;
    const score = ang / cone + d * 0.003;
    if (score < bs && eyeLos(m, o)) { bs = score; best = o; }
  }
  return best;
}
CBZ.npcwar.onBoot(function () {
  _yFrom = V(),
    _yTo = V();
});
function youMiss(m, w) {
  m.mag--; m.lastShotT = simT; stats[m.team].shots++; m.shotsF++;
  let from = CBZ.actorMuzzle ? CBZ.actorMuzzle(m, _yFrom) : null;
  if (!from) from = _yFrom.set(m.pos.x + Math.sin(m.yaw) * 0.5, m.pos.y + 1.42, m.pos.z + Math.cos(m.yaw) * 0.5);
  const reach = 140, drop = (YOU.pitch - 0.24) * 0.6;
  _yTo.set(from.x + Math.sin(YOU.yaw) * reach, from.y - drop * reach * 0.4, from.z + Math.cos(YOU.yaw) * reach);
  CBZ.tracer(from, _yTo, { shooter: m, muzzle: true, muzzleScale: (w && w.flash ? 0.5 + w.flash : 0.9) });
  if (w && w.sfx) { try { CBZ.sfx(w.sfx, { dist: 2, ghost: true, volume: (w.sfxVol || 1) * 0.9, pitch: w.sfxPitch || 1 }); } catch (e) {} }
  missImpact(from, _yTo, 0);
}
function youFire(m) {
  const w = CBZ.weaponById(m.wid);
  if (m.fists) {
    // a swing at whoever is in front of you, within your arms
    let o = null, bd = Infinity;
    for (let i = 0; i < men.length; i++) {
      const q = men[i];
      if (q.dead || q.fled || q.team === m.team) continue;
      const dx = q.pos.x - m.pos.x, dz = q.pos.z - m.pos.z, d = Math.hypot(dx, dz);
      if (d > meleeReach(m, q) * 1.25 || (dx * Math.sin(YOU.yaw) + dz * Math.cos(YOU.yaw)) < d * 0.5) continue;
      if (d < bd) { bd = d; o = q; }
    }
    m.cool = 0.5;
    if (o) hurtMan(o, m.punch * (0.9 + lcg() * 0.4) * (CBZ.meleeScale ? CBZ.meleeScale(m, o) : 1), { by: m });
    return;
  }
  if (m.mag <= 0) { youReload(m, w); return; }
  const tgt = youTarget(m, m.launcher ? 95 : 175);
  if (m.launcher) {
    if (!tgt) { m.cool = 0.2; return; }
    fireRocket(m, tgt);
    m.cool = ((w && (w.fireDelay || w.interval)) || 1.2) + 0.4;
    if (m.mag <= 0) youReload(m, w);
    return;
  }
  m.cool = youCadence(m, w);
  if (tgt) {
    const d = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
    let hit = Math.max(0.12, Math.min(0.88, 0.88 - d * 0.0045));
    if (m.speed > 3.4) hit *= 0.55; else if (m.speed > 1.1) hit *= 0.8;
    if (m.stance === "crouch") hit = Math.min(0.92, hit * 1.1);
    if (m.supp > 0.35) hit *= 0.75;
    fireShot(m, tgt, { fire: true, hit: hit, dmg: youRoundDmg(m, w), cd: m.cool });
  } else youMiss(m, w);
  if (m.mag <= 0) youReload(m, w);
}
const _youIn = { attack: false, fwd: 0, side: 0, back: 0, sprint: false };
function youMelee(m, attack, ax, az, run, sdt) {
  let o = m._youMO;
  if (!o) {
    o = m._youMO = {
      dt: 0,
      // everyone on the other side within arm's reach of a lunge
      candidates: function (out) {
        for (let i = 0; i < men.length; i++) {
          const q = men[i];
          if (q.dead || q.fled || q.team === m.team || q.vehicle) continue;
          if (Math.abs(q.pos.x - m.pos.x) > 4 || Math.abs(q.pos.z - m.pos.z) > 4) continue;
          out.push(q);
        }
      },
      // the blow landed on his rig: the page's own damage, scaled by who he
      // hit (bodymass) and where it landed (the layer's zone multiplier)
      onLand: function (res) {
        const q = res && res.target;
        if (!q || q.dead || !q.team || q.team === m.team) return;
        const mk = CBZ.meleeScale ? CBZ.meleeScale(m, q) : 1;
        const zm = res.dmgMul != null && isFinite(res.dmgMul) ? res.dmgMul : 1;
        hurtMan(q, m.punch * (0.9 + lcg() * 0.4) * mk * zm, { by: m });
        stats[m.team].shots++; stats[m.team].hits++;
        m.shotsF++; m.hitsF++;
      },
    };
  }
  o.dt = sdt;
  _youIn.attack = attack;
  _youIn.fwd = az > 0 ? az : 0; _youIn.back = az < 0 ? -az : 0;
  _youIn.side = ax; _youIn.sprint = !!run;
  try { CBZ.melee.drive(m, _youIn, o); } catch (e) {}
}
function youReload(m, w) {
  if (!m.magSize || m.reloadT > 0 || m.mag >= m.magSize) return;
  m.reloadT = (w && (w.reloadTime || w.reload)) || 1.6;
  m.reloads++;
  try { CBZ.sfx("reload", { dist: 2, ghost: true }); } catch (e) {}
}
function stepYou(m, sdt) {
  const IN = CBZ.micro.input, T = CBZ.micro.touch;
  if (m.supp > 0) m.supp = Math.max(0, m.supp - sdt * SUPP_DECAY);
  if (m.reloadT > 0) { m.reloadT -= sdt; if (m.reloadT <= 0) m.mag = m.magSize; }
  m.cool -= sdt;
  let ax = 0, az = 0, run = false;
  if (IN) {
    ax = IN.axis("KeyA", "KeyD"); az = IN.axis("KeyS", "KeyW");
    run = IN.isDown("ShiftLeft") || IN.isDown("ShiftRight");
  }
  if (T && T.active && T.stick && T.stick.mag > 0.12) { ax = T.stick.x; az = -T.stick.y; run = !!T.stick.rim; }
  // knocked down: the knockdown owns the body until he is up (melee.js)
  if (knockedDown(m)) { ax = 0; az = 0; }
  const sy = Math.sin(YOU.yaw), cy = Math.cos(YOU.yaw);
  let mx = sy * az - cy * ax, mz = cy * az + sy * ax;
  const ml = Math.hypot(mx, mz);
  let spd = 0;
  if (ml > 0.05) {
    if (run && m.stance === "crouch") setStance(m, "stand");
    spd = (m.stance === "crouch" ? 2.2 : run ? 6.6 : 4.4) * Math.min(1, ml);
    if (m.hp < m.maxHp * 0.45) spd *= 0.78;          // the limp is the health bar
    mx /= ml; mz /= ml;
    m.pos.x += mx * spd * sdt; m.pos.z += mz * spd * sdt;
    CBZ.micro.resolveCircle(m.pos, m.rad || 0.5, m.pos.y, 1.8);
  }
  m.speed = spd;
  if (MAP.water) stepDepth(m, sdt);
  m.pos.y = MAP.bodyY(m, m.pos.x, m.pos.z);
  m.yaw = YOU.yaw; m.group.rotation.y = m.yaw;
  m.coverK = m.stance === "crouch" ? CROUCH_HIT : 1;
  m.up = true;
  const fire = IN && (IN.isDown("KeyJ") || (!COARSE && IN.locked && IN.buttons[0]));
  /* BARE HANDS: the one control grammar every game shares (systems/melee.js).
     Called EVERY step with the button's held state: a tap is a strike, the
     movement you are already doing picks which one, a hold is the guard and
     its release the power shot. Feature-detected: before the melee layer
     loads, the old swing below still answers. */
  if (m.fists && CBZ.melee && CBZ.melee.drive) {
    youMelee(m, !!fire, ax, az, run, sdt);
    return;
  }
  const w = CBZ.weaponById(m.wid);
  const semi = w && !w.auto;
  const pull = semi ? (IN && (IN.pressed("KeyJ") || (!COARSE && IN.locked && IN.clicked[0]))) : fire;
  if (pull && m.cool <= 0 && m.reloadT <= 0) youFire(m);
}
function frameYou(dt) {
  const m = YOU.m;
  if (!m || m.dead) { leaveYou(!!(m && m.dead)); return; }
  if (m.vehicle) { frameYouVehicle(m, dt); return; }
  const IN = CBZ.micro.input;
  if (IN) {
    // the edge keys, once a FRAME (the step above runs up to eight times one)
    if (IN.pressed("KeyC")) setStance(m, m.stance === "crouch" ? "stand" : "crouch");
    if (IN.pressed("KeyR")) youReload(m, CBZ.weaponById(m.wid));
    YOU.yaw -= IN.mx * 0.0024;
    YOU.pitch = Math.max(0.05, Math.min(0.85, YOU.pitch + IN.mz * 0.002));
  }
  const ry = YOU.yaw, low = m.stance === "crouch";
  cam.wFocus.set(m.pos.x - Math.cos(ry) * 0.55, m.pos.y + (low ? 0.02 : 0.4), m.pos.z + Math.sin(ry) * 0.55);
  cam.focus.copy(cam.wFocus);
  cam.wYaw = cam.yaw = ry + Math.PI;
  cam.wPitch = cam.pitch = YOU.pitch;
  cam.wDist = cam.dist = 3.3;
  cam.followM = m;
}

/* A NATION'S FLAG ON ITS OWN LINE (the front only): a pole behind where its
   army formed up, the flag painted off its row. */
function plantFlag(team, x, z) {
  if (!FRONT || !FRONT[team] || !MAP) return;
  const bx = x + (team === "red" ? -8 : 8), bz = z;
  const gy = MAP.groundAt(bx, bz);
  const grp = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.065, 8.5, 8), new THREE.MeshLambertMaterial({ color: 0x8c8f93 }));
  pole.position.y = 4.25; pole.castShadow = true;
  grp.add(pole);
  const cv = document.createElement("canvas"); cv.width = 192; cv.height = 128;
  drawFlag(cv.getContext("2d"), FRONT[team].flag, 192, 128);
  const tex = new THREE.CanvasTexture(cv);
  if (FRONT[team].flagUrl) {           // the nation's real flag (city/flags.js), drawn over the fallback once it decodes
    const im = new Image();
    im.onload = function () { cv.getContext("2d").drawImage(im, 0, 0, 192, 128); tex.needsUpdate = true; };
    im.src = FRONT[team].flagUrl;
  }
  tex.encoding = THREE.sRGBEncoding;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6, 8, 1),
    new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
  // a little set in the cloth, so it hangs and does not read as a sign
  const p = flag.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = (p.getX(i) + 1.2) / 2.4;
    p.setZ(i, Math.sin(u * 5.2) * 0.14 * u);
    p.setY(i, p.getY(i) - u * u * 0.18);
  }
  p.needsUpdate = true; flag.geometry.computeVertexNormals();
  flag.position.set(1.22, 7.6, 0);
  flag.castShadow = true;
  grp.add(flag);
  grp.position.set(bx, gy, bz);
  grp.rotation.y = team === "red" ? Math.PI / 2 : -Math.PI / 2;
  grp.userData.dynamic = true;
  grp.name = "frontFlag";
  CBZ.scene.add(grp);
}
