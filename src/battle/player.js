"use strict";
/* src/battle/player.js — NPC War: YOU. TAKE OVER ANYTHING.
   Owned by the player-control agent (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in.

   TAP OR CLICK ANY UNIT AND YOU ARE IT. A soldier, a tiger, an elephant, a
   shark, a tank. Two controls, whatever you are:

     MOVE     WASD / the stick (Shift or the stick at its rim = sprint),
              relative to where the camera looks; the mouse or a drag on the
              right half of a phone looks.
     ATTACK   the left mouse button / J / the one attack button.

   What ATTACK does is the body's and the moment's:
     a man with fists   systems/melee.js's grammar (CBZ.melee.drive): tap
                        strikes, the movement you are doing picks which, hold
                        guards, release throws the power shot. Before that
                        layer is on the page: a swing at whoever is in front.
     a man with a gun   fires, aimed for you at the threat you face (auto-
                        target); on the move you shoot on the move (the hit
                        chance pays for it); right on top of somebody it is a
                        rifle butt (the melee layer's weapon strike, or ours).
     an animal          the species' real attack, chosen by context through
                        its unit file (src/units/kit/moves.js): a pounce from
                        a sprint, a swipe up close, the bite on a body on the
                        floor, an elephant's trunk grab, a rhino's ram.
     a vehicle          move drives, attack fires your seat's weapon, laid
                        on the target nearest your look (X changes weapon).

   THE THREAT YOU FACE is picked for you (youPick): nearest your look, nearer
   is better, whoever is after you or already in your reach counts double,
   and the one you had keeps it unless something clearly better turns up.

   Leaving is the rifle button (G). Dying is a slow beat on the body, then
   you are in the nearest ally's boots (or the director has the lens if
   nobody is left). Touch: the stick and one attack button, nothing else.

   The G button with nothing possessed still does what it always did: puts
   you in a man (or a crewed vehicle) of your side, in the middle of it. */

const YOU = {
  m: null, last: null, yaw: 0, pitch: 0.24, down: false,
  tgt: null, pickT: 0,          // the auto-target and when it was last asked
  strike: null, cd: 0, n: 0, nAt: -9,       // an animal's attack in flight
  atkPrev: false, fireAt: -9,   // attack edge, last time the gun was worked
  beat: null,                   // the death beat
  hp0: 0, kills0: 0, blendT: 0, gunK: 0, lookIdle: 0,
  drive: null,                  // a tool's input instead of the keys (probe)
};
let TB = null;
const _yn = [];
let _yFrom, _yTo, _yMark = null, _yDummy = null, _yv = null;

/* ------------------------------------------------------------ who you are */
function youKind(u) { return !u ? null : u.vehicle ? "vehicle" : u.beast ? "beast" : "man"; }
function youTeam() {
  if (FRONT) return "red";
  const menIn = function (u) {
    const ids = CBZ.battleRoster ? CBZ.battleRoster.ids(u) : String(u).split("|");
    for (let k = 0; k < ids.length; k++) {
      if (ids[k] === "men" || (CBZ.unitKit && CBZ.unitKit.kindOf(ids[k]) === "vehicle")) return true;
    }
    return false;
  };
  if (SET.call && menIn(SET.call === "red" ? SET.redU : SET.blueU)) return SET.call;
  return menIn(SET.redU) ? "red" : menIn(SET.blueU) ? "blue" : (SET.call || "red");
}
// can this body be taken over right now?
function canTake(u) {
  if (!u || u.dead || u.fled || u.inVeh || u._apeHeld || u._apeFlying || u._tossed || u.downed || u.surrendered) return false;   // a wounded man on the ground is not a body to drive
  if (u.group && !u.group.visible) return false;
  if (u.vehicle && vehCrewN(u) === 0) return false;
  if (FRONT && u.team !== "red") return false;
  return true;
}
/* THE RIFLE BUTTON: a crewed vehicle of your side first, else the man in the
   middle of your army (an armed one), else anything on your side. */
function join() {
  if (!started || over || bench || YOU.m) return false;
  const team = youTeam();
  const c = teamCOM[team];
  let m = null, bd = Infinity;
  for (let i = 0; i < men.length; i++) {
    const o = men[i];
    if (o.team !== team || !o.vehicle || !canTake(o)) continue;
    const d = Math.hypot(o.pos.x - c.x, o.pos.z - c.z) + (o.air ? 500 : 0);
    if (d < bd) { bd = d; m = o; }
  }
  if (!m) {
    for (let i = 0; i < men.length; i++) {
      const o = men[i];
      if (o.team !== team || !canTake(o) || o.routed) continue;
      const d = Math.hypot(o.pos.x - c.x, o.pos.z - c.z) + (o.beast ? 20 : o.armed ? 0 : 40) + (o.launcher ? 30 : 0);   // the RIFLE button: a rifleman before the launcher crew
      if (d < bd) { bd = d; m = o; }
    }
  }
  return m ? takeOver(m) : false;
}
/* TAKE OVER: any unit, either side. The body stops thinking and you drive
   it; everything it does goes through the page's own funnels (fireShot,
   hurtMan, creature_combat, vehFire), so YOU are that unit, not a god. */
function takeOver(u) {
  if (!started || over || bench || !canTake(u)) return false;
  if (YOU.m === u) return true;
  if (YOU.m) youRelease(YOU.m);
  if (YOU.beat) { YOU.beat = null; }
  YOU.m = u; YOU.last = u; YOU.down = false;
  YOU.tgt = null; YOU.pickT = 0; YOU.strike = null; YOU.cd = 0; YOU.n = 0;
  YOU.atkPrev = true;                       // the tap that chose him is not an attack
  YOU.hp0 = u.hp; YOU.kills0 = u.kills || 0; YOU.gunK = 0; YOU.lookIdle = 0;
  u.you = true; u.slot = "you";
  const k = youKind(u);
  if (k === "man") {
    u.tgt = null; u.hull = null; u.stepAsideT = 0;
    setStance(u, "stand");
    YOU.yaw = u.yaw; YOU.pitch = 0.24;
  } else if (k === "beast") {
    const h = u.heading || 0;
    YOU.yaw = Math.atan2(Math.cos(h), Math.sin(h));      // nose (cos h, sin h) -> camera yaw
    YOU.pitch = MAP.water ? 0.12 : 0.26;
    u.tgt = null;
  } else {
    YOU.yaw = u.h + (u.tur ? u.tur.yaw : 0); YOU.pitch = 0.3;
    u.tgt = null;
  }
  if (speed !== 1) setSpeed(1);              // a body lives at one second a second
  if (SLOW.t > 0) SLOW.t = 0;
  if (KILL.t > 0) { KILL.t = 0; KILL.m = null; }
  setCamMode("you");
  YOU.blendT = 0.55;                         // the lens swoops into the body, then rides it
  if (COARSE) touchOn(); else CBZ.micro.lock();
  el("xhair").classList.toggle("on", k === "man" ? !u.fists : k === "vehicle");
  el("cRifle").classList.add("on");
  return true;
}
// the body goes back to its own brain
function youRelease(u) {
  if (!u) return;
  u.you = false; u.thinkAt = simT; u.slot = "hold";
  if (u.beast && u._atkAnim != null && u._atkAnim >= 0 && CBZ.creatureEndAttack) { try { CBZ.creatureEndAttack(u); } catch (e) {} }
  YOU.strike = null;
}
function leaveYou(down) {
  const m = YOU.m;
  YOU.m = null; YOU.tgt = null;
  if (down) YOU.down = true;
  youRelease(m);
  touchOff();
  if (!COARSE) CBZ.micro.unlock();
  el("xhair").classList.remove("on");
  el("cRifle").classList.remove("on");
  if (_yMark) _yMark.style.display = "none";
  if (cam.mode === "you" || cam.mode === "youdead") {
    setCamMode("auto");
    // the director holds on the body you were before it cuts away
    if (m) { cam.shot = "hero"; cam.followM = m; cam.holdT = 0; cam.cutAt = simT + 3; frameDirector(0); }
  }
}
/* DEATH WHILE YOU ARE IT: the clock drops to a crawl for a beat on the body,
   then you are in the nearest ally of the same kind (any kind if there is
   none), or, with nobody left, the director has the lens. */
function youDown(m) {
  if (YOU.m !== m) return;
  YOU.m = null; YOU.tgt = null; YOU.down = true;
  youRelease(m);
  touchOff();
  el("xhair").classList.remove("on");
  if (_yMark) _yMark.style.display = "none";
  if (!started || bench) { leaveYou(true); return; }
  YOU.beat = { t: 1.5, m: m, team: m.team, kind: youKind(m), x: m.pos.x, z: m.pos.z };
  if (speed > 0) setSpeed(0.3);
  cam.mode = "youdead";
  cam.wFov = cam.fov0 - 6;
  if (CBZ.shake) CBZ.shake(0.8);
}
function youHopTarget(B) {
  let best = null, bs = Infinity;
  for (let i = 0; i < men.length; i++) {
    const o = men[i];
    if (o.team !== B.team || !canTake(o) || o.routed) continue;
    const d = Math.hypot(o.pos.x - B.x, o.pos.z - B.z) + (youKind(o) === B.kind ? 0 : 45);
    if (d < bs) { bs = d; best = o; }
  }
  return best;
}
function frameYouBeat(dt) {
  const B = YOU.beat;
  if (!B) { setCamMode("auto"); return; }
  B.t -= dt;
  const m = B.m;
  cam.wFocus.set(m.pos.x, bodyAimY(m), m.pos.z);
  cam.wYaw += dt * 0.45;
  cam.wPitch = 0.3;
  cam.wDist = bodySize(m) * 3 + 4.5;
  if (B.t > 0) return;
  YOU.beat = null;
  if (speed > 0) setSpeed(1);
  const ally = !over ? youHopTarget(B) : null;
  if (!ally || !takeOver(ally)) {
    YOU.m = null;
    if (!COARSE) CBZ.micro.unlock();
    el("cRifle").classList.remove("on");
    setCamMode("auto");
    cam.shot = "hero"; cam.followM = m; cam.holdT = 0.5; cam.cutAt = simT + 2;
  }
}
function toggleRifle() { if (YOU.m || YOU.beat) { YOU.beat = null; if (speed > 0 && speed < 1) setSpeed(1); leaveYou(false); } else join(); }

/* ------------------------------------------------------------ the thumbs */
function touchOn() {
  const T = CBZ.micro.touch;
  if (!T) return;
  if (!T.root) T.init({});
  if (!T.root) return;
  T.root.style.display = "";
  // ONE BUTTON. Reload is automatic, the stance is the fight's own.
  if (!TB) TB = {
    fire: T.addButton({ glyph: "◎", key: "KeyJ", right: 22, bottom: "calc(104px + env(safe-area-inset-bottom,0px))", size: 92, id: "tFire" }),
  };
}
function touchOff() { const T = CBZ.micro.touch; if (T && T.root) T.root.style.display = "none"; }

/* ------------------------------------------------------------ input */
const _yin = { ax: 0, az: 0, run: false, atk: false, edge: false, look: false };
function youInput() {
  const IN = CBZ.micro.input, T = CBZ.micro.touch, D = YOU.drive;
  let ax = 0, az = 0, run = false, atk = false;
  if (D) { ax = D.ax || 0; az = D.az || 0; run = !!D.run; atk = !!D.atk; }
  else {
    if (IN) {
      ax = IN.axis("KeyA", "KeyD"); az = IN.axis("KeyS", "KeyW");
      run = IN.isDown("ShiftLeft") || IN.isDown("ShiftRight");
      atk = IN.isDown("KeyJ") || IN.pressed("KeyJ") || (!COARSE && IN.locked && (IN.buttons[0] || IN.clicked[0]));
    }
    if (T && T.active && T.stick && T.stick.mag > 0.12) { ax = T.stick.x; az = -T.stick.y; run = !!T.stick.rim; }
  }
  _yin.ax = ax; _yin.az = az; _yin.run = run; _yin.atk = atk;
  _yin.edge = atk && !YOU.atkPrev;
  YOU.atkPrev = atk;
  return _yin;
}
// the stick in the world, off the camera's look: { x, z, len }
const _ymv = { x: 0, z: 0, len: 0 };
function youMoveDir(I) {
  const sy = Math.sin(YOU.yaw), cy = Math.cos(YOU.yaw);
  let mx = sy * I.az - cy * I.ax, mz = cy * I.az + sy * I.ax;
  const l = Math.hypot(mx, mz);
  if (l > 1e-4) { mx /= l; mz /= l; }
  _ymv.x = mx; _ymv.z = mz; _ymv.len = Math.min(1, l);
  return _ymv;
}

/* ------------------------------------------------------------ THE THREAT */
function youRange(u) {
  if (u.vehicle) { const W = vehYouSeatWeapon(u); return Math.min(700, (W && W.w.range) || 400); }
  if (u.beast) return Math.max(22, (u.reach || 2) * 7);
  if (u.fists) return 16;
  return u.launcher ? 95 : 175;
}
function youPick(u) {
  const range = youRange(u);
  const fx = Math.sin(YOU.yaw), fz = Math.cos(YOU.yaw);
  const reach = (u.reach || meleeReach(u, u)) + 0.6;
  const list = range <= 40 ? fineNear(u.pos.x, u.pos.z, range, _yn) : men;
  const melee = u.beast || u.fists;
  let best = null, bs = Infinity;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o === u || o.dead || o.fled || o.team === u.team || o.inVeh || o._apeHeld) continue;
    if (o.group && !o.group.visible) continue;
    const dx = o.pos.x - u.pos.x, dz = o.pos.z - u.pos.z, d = Math.hypot(dx, dz);
    if (d > range || d < 0.05) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
    const close = d < reach + (o.rad || 0.45);
    if (!close && ang > (melee ? 1.4 : 1.15)) continue;
    let s = ang * 1.7 + (d / range) * (melee ? 2.2 : 1.1);
    if (o.tgt === u) s -= 0.35;               // he is after you
    if (close) s -= 0.9;                      // he is already in your reach
    if (o === YOU.tgt) s -= 0.45;             // keep the one you have
    if (o.vehicle && melee && !u.vehicle) s += 1.2;    // teeth and fists do nothing to plate
    if (s >= bs) continue;
    if (d > 9 && !eyeLos(u, o)) continue;
    bs = s; best = o;
  }
  return best;
}
function youRetarget(u, sdt) {
  YOU.pickT -= sdt;
  const t = YOU.tgt;
  if (t && (t.dead || t.fled)) YOU.tgt = null;
  if (YOU.pickT > 0) return;
  YOU.pickT = 0.14;
  YOU.tgt = youPick(u);
}

/* ------------------------------------------------------------ the step */
function stepYou(m, sdt) {
  if (m.beast) stepYouBeast(m, sdt);
  else stepYouMan(m, sdt);
}

/* ---- A MAN ---- */
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
// whoever you can SEE inside a hair of the look (the fallback mark)
function youTarget(m, range) {
  const fx = Math.sin(YOU.yaw), fz = Math.cos(YOU.yaw);
  let best = null, bs = Infinity;
  for (let i = 0; i < men.length; i++) {
    const o = men[i];
    if (o.dead || o.fled || o.team === m.team || o.inVeh) continue;
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
  _yFrom = V(); _yTo = V(); _yv = V();
  // the mark over the threat you face: a ring, in your side's colour
  try {
    _yMark = document.createElement("div");
    _yMark.id = "youMark";
    document.body.appendChild(_yMark);
  } catch (e) { _yMark = null; }
  // the thing an animal bites when there is nothing to bite: a point in the air
  const g = new THREE.Object3D();
  _yDummy = { pos: g.position, group: g, dead: false, rad: 0.3, hp: 1e9, maxHp: 1e9, dummy: true };
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
// AIM IS AUTOMATIC: the locked threat if it is near the look, else whoever
// sits on the crosshair, else the round goes where you look
function youFire(m, t) {
  const w = CBZ.weaponById(m.wid);
  if (m.mag <= 0) { youReload(m, w); return; }
  let tgt = null;
  if (t && !t.dead) {
    const b = Math.atan2(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
    let da = b - YOU.yaw;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) < 0.5) tgt = t;
  }
  if (!tgt) tgt = youTarget(m, m.launcher ? 95 : 175);
  YOU.fireAt = simT;
  if (m.launcher) {
    if (!tgt) { m.cool = 0.2; return; }
    fireRocket(m, tgt);
    m.cool = ((w && (w.fireDelay || w.interval)) || 1.2) + 0.4;
    if (CBZ.shake) CBZ.shake(0.4);
    if (m.mag <= 0) youReload(m, w);
    return;
  }
  m.cool = youCadence(m, w);
  if (tgt) {
    const d = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
    let hit = Math.max(0.12, Math.min(0.88, 0.88 - d * 0.0045));
    if (m.speed > 5) hit *= 0.55; else if (m.speed > 1.1) hit *= 0.8;     // shooting on the move pays
    if (m.stance === "crouch") hit = Math.min(0.92, hit * 1.1);
    if (m.supp > 0.35) hit *= 0.75;
    fireShot(m, tgt, { fire: true, hit: hit, dmg: youRoundDmg(m, w), cd: m.cool });
  } else youMiss(m, w);
  if (CBZ.shake) CBZ.shake(0.06);
  if (m.mag <= 0) youReload(m, w);
}
// fists before the melee layer: a swing at whoever is in front, in reach
function youSwing(m, t) {
  let o = null;
  if (t && !t.dead && Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) < meleeReach(m, t) * 1.25) o = t;
  if (!o) {
    let bd = Infinity;
    for (let i = 0; i < men.length; i++) {
      const q = men[i];
      if (q.dead || q.fled || q.team === m.team || q.inVeh) continue;
      const dx = q.pos.x - m.pos.x, dz = q.pos.z - m.pos.z, d = Math.hypot(dx, dz);
      if (d > meleeReach(m, q) * 1.25 || (dx * Math.sin(m.yaw) + dz * Math.cos(m.yaw)) < d * 0.5) continue;
      if (d < bd) { bd = d; o = q; }
    }
  }
  m.cool = 0.5;
  if (o) {
    hurtMan(o, m.punch * (0.9 + lcg() * 0.4) * (CBZ.meleeScale ? CBZ.meleeScale(m, o) : 1), { by: m });
    stats[m.team].shots++; stats[m.team].hits++; m.shotsF++; m.hitsF++;
    if (CBZ.shake) CBZ.shake(0.22);
  }
}
/* THE RIFLE BUTT, before the melee layer has a weapon strike for us: a short
   drive of the stock into whoever is on top of you. Heavier than a punch,
   it shoves him a step back and it is slower than a trigger. */
function youButt(m, t) {
  m.cool = 0.75;
  const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1;
  m.yaw = Math.atan2(dx, dz); m.group.rotation.y = m.yaw;
  const mk = CBZ.meleeScale ? CBZ.meleeScale(m, t) : 1;
  hurtMan(t, Math.max(22, (m.punch || 12) * 1.8) * (0.9 + lcg() * 0.3) * mk, { by: m });
  stats[m.team].shots++; stats[m.team].hits++; m.shotsF++; m.hitsF++;
  if (!t.dead && !t.vehicle) {
    const push = t.beast ? 0.25 / Math.max(1, t.rad || 1) : 0.9;
    t.pos.x += dx / d * push; t.pos.z += dz / d * push;
    t.supp = Math.min(SUPP_CAP, (t.supp || 0) + 0.5);
  }
  if (CBZ.shake) CBZ.shake(0.3);
}
const _youIn = { attack: false, fwd: 0, side: 0, back: 0, sprint: false };
function youMelee(m, attack, ax, az, run, sdt, weapon) {
  let o = m._youMO;
  if (!o) {
    o = m._youMO = {
      dt: 0, weapon: null,
      candidates: function (out) {
        for (let i = 0; i < men.length; i++) {
          const q = men[i];
          if (q.dead || q.fled || q.team === m.team || q.vehicle || q.inVeh) continue;
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
        const base = o.weapon ? Math.max(22, (m.punch || 12) * 1.8) : m.punch;
        hurtMan(q, base * (0.9 + lcg() * 0.4) * mk * zm, { by: m });
        stats[m.team].shots++; stats[m.team].hits++;
        m.shotsF++; m.hitsF++;
      },
    };
  }
  o.dt = sdt; o.weapon = weapon || null;
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
function turnTo(cur, want, rate) {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-rate, Math.min(rate, d));
}
function stepYouMan(m, sdt) {
  if (m.supp > 0) m.supp = Math.max(0, m.supp - sdt * SUPP_DECAY);
  if (m.reloadT > 0) { m.reloadT -= sdt; if (m.reloadT <= 0) m.mag = m.magSize; }
  m.cool -= sdt;
  const I = youInput();
  youRetarget(m, sdt);
  let ax = I.ax, az = I.az;
  if (knockedDown(m)) { ax = 0; az = 0; }              // the knockdown owns the body until he is up
  const mv = youMoveDir({ ax: ax, az: az });
  let spd = 0;
  if (mv.len > 0.05) {
    if (I.run && m.stance === "crouch") setStance(m, "stand");
    spd = (m.stance === "crouch" ? 2.2 : I.run ? 6.6 : 4.4) * mv.len;
    if (m.hp < m.maxHp * 0.45) spd *= 0.78;            // the limp is the health bar
    m.pos.x += mv.x * spd * sdt; m.pos.z += mv.z * spd * sdt;
    CBZ.micro.resolveCircle(m.pos, m.rad || 0.5, m.pos.y, 1.8);
  }
  m.speed = spd;
  if (MAP.water) stepDepth(m, sdt);
  m.pos.y = MAP.bodyY(m, m.pos.x, m.pos.z);
  m.coverK = m.stance === "crouch" ? CROUCH_HIT : 1;
  m.up = true;
  // THE BODY FACES THE FIGHT, the camera keeps your look: a brawler squares
  // up to the man in reach, a rifleman turns onto his mark while firing
  const t = YOU.tgt;
  const td = t ? Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : 99;
  let face = YOU.yaw;
  if (t && (m.fists ? td < 3.6 : (I.atk && td < youRange(m)))) face = Math.atan2(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
  m.yaw = turnTo(m.yaw, face, sdt * 16);
  m.group.rotation.y = m.yaw;
  const melee = CBZ.melee && CBZ.melee.drive;
  if (m.fists) {
    if (melee) { youMelee(m, I.atk, ax, az, I.run, sdt, null); return; }
    if (I.atk && m.cool <= 0) youSwing(m, t);
    return;
  }
  // a gun, and somebody right on top of you: the butt, not the trigger
  const w = CBZ.weaponById(m.wid);
  const close = t && !t.vehicle && td < meleeReach(m, t) * 1.2;
  if (close && melee) { youMelee(m, I.atk, ax, az, I.run, sdt, w || { id: m.wid }); return; }
  if (close && I.atk && m.cool <= 0) { youButt(m, t); return; }
  if (close) return;
  const semi = w && !w.auto;
  // a held trigger on a semi-auto keeps firing, a shade slower than tapping
  const pull = semi ? (I.edge || (I.atk && m.cool <= -0.12)) : I.atk;
  if (pull && m.cool <= 0 && m.reloadT <= 0) youFire(m, t);
}

/* ---- AN ANIMAL ---- */
function youDowned(t) {
  if (!t || t.dead) return false;
  if (t.beast) return t._tossed ? true : t.hp < t.maxHp * 0.18;
  return knockedDown(t) || !!t._tossed;
}
function youTossable(t) {
  if (!t || t.dead || t.vehicle || t._tossed || t._apeHeld) return false;
  if (t.beast) return !t.swim && (t.noseR || t.rad || 1) < 1.3;
  return true;
}
function youMoveCtx(m, t) {
  const d = t ? Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : 99;
  let crowd = 0;
  const a = fineNear(m.pos.x, m.pos.z, (m.reach || 2) * 2, _yn);
  for (let i = 0; i < a.length; i++) if (a[i].team !== m.team && !a[i].dead) crowd++;
  return {
    dist: d, reach: m.reach || 2, sprint: !!_yin.run, speed: m.speed || 0, chase: m.tn ? m.tn.chase : 6,
    downed: youDowned(t), crowd: crowd, n: YOU.n, water: !!(MAP && MAP.water),
    heavy: !youTossable(t),
  };
}
function youStrikeOpts(m) {
  let o = m._youBO;
  if (!o) {
    o = m._youBO = { speed: 0, reach: 2, rate: 1, dmg: 10, move: beastMove, onHit: null, youMove: null };
    o.onHit = function (dmg) {
      const S = YOU.strike;
      const t = S && S.t;
      if (!t || t.dummy || t.dead) return;
      if (S.mv.grab === "toss" && youTossable(t)) { youToss(m, t, dmg); return; }
      hurtMan(t, dmg * (CBZ.meleeAbsorb ? CBZ.meleeAbsorb(t) : 1), { by: m });
      if (t.beast && !t.dead && CBZ.creatureFlinch) { try { CBZ.creatureFlinch(t); } catch (e) {} }
      S.hit = true;
      YOU.hits = (YOU.hits || 0) + 1;
      if (CBZ.shake) CBZ.shake(0.18 + Math.min(0.6, (S.mv.pow || 1) * 0.2 + bodySize(m) * 0.06));
      camSlowHit();
    };
  }
  const k = m._sizeMul || 1;
  o.reach = (m.reach || 2) * ((YOU.strike && YOU.strike.mv.rng) || 1);
  o.dmg = m.tn.dmg * (k === 1 ? 1 : Math.pow(k, 1.35));
  o.rate = m.tn.rate;
  o.youMove = YOU.strike ? YOU.strike.mv : null;
  return o;
}
function youStartStrike(m) {
  let t = YOU.tgt && !YOU.tgt.dead ? YOU.tgt : null;
  YOU.n = simT - YOU.nAt < 1.4 ? YOU.n + 1 : 1;
  YOU.nAt = simT;
  const ctx = youMoveCtx(m, t);
  let mv = CBZ.unitMoves ? CBZ.unitMoves.choose(m, t, ctx) : null;
  // the gorilla's own repertoire (systems/ape_combat.js) inside the arms
  if (!mv && t && CBZ.apeMove) {
    let st = null;
    try { st = CBZ.apeMove(m, t, youStrikeOpts(m), ctx.dist, ctx.reach); } catch (e) { st = null; }
    if (st) mv = { id: st, style: st, pow: m._atkPow || 1, dur: m._atkDur || 0, rng: 1.1, cd: 0.4, ape: true };
  }
  if (!mv) mv = { id: "bite", style: CBZ.creatureStyleFor ? CBZ.creatureStyleFor(m.species) : "bite", pow: 1, dur: 0, rng: 1, cd: 0.7 };
  // nothing to hit: the move is thrown at the air in front of you
  if (!t || ctx.dist > (m.reach || 2) * (1 + (mv.leap || 0) * 1.8) + 0.5) t = null;
  const S = YOU.strike = { mv: mv, t: t || _yDummy, real: !!t, age: 0, leap: 0, hit: false, dur: 0 };
  if (!t) YOU.whiffs = (YOU.whiffs || 0) + 1;
  YOU.moves = YOU.moves || {};
  YOU.moves[mv.id || mv.style] = (YOU.moves[mv.id || mv.style] || 0) + 1;
  if (t) {
    // a leap carries the body in; every other blow still steps into it (the
    // last half metre an animal closes as it strikes)
    const keep = Math.max((m.rad || 0.5) + (t.rad || 0.45), (m.noseR || 0) * 0.86);
    const cap = mv.leap ? (m.reach || 2) * mv.leap * 2.2 : (m.reach || 2) * 0.6;
    S.leap = Math.max(0, Math.min(ctx.dist - keep, cap));
  }
  // LATCH THE MOVE ON THE BODY: creature_combat plays the swing in hand
  // (_atkAnim >= 0) with the latched style, clock and weight
  m._atkAnim = 0;
  m._atkStyle = mv.style; m._apeStyle = mv.style;
  const apeRow = /^ape_/.test(mv.style) && CBZ.apeMoves ? CBZ.apeMoves[mv.style] : null;
  if (apeRow) { m._atkDur = apeRow.dur; m._atkPow = apeRow.pow; }
  else if (!mv.ape) { m._atkDur = mv.dur || 0; m._atkPow = mv.pow || 1; }
  m._lungeAmt = 0;
  m._atkT = 9;
  S.dur = (m._atkDur > 0 ? m._atkDur : 0.45) * (MAP.water ? 1.6 : 1);
  if (mv.leap && S.leap > 1 && CBZ.shake) CBZ.shake(0.15);
}
function youStepStrike(m, S, sdt) {
  S.age += sdt;
  const t = S.t;
  if (!S.real) {
    // the air in front of the mouth, out of reach: the jaws close on nothing
    const h = m.heading || 0, r = (m.reach || 2) * 1.45;
    t.pos.set(m.pos.x + Math.cos(h) * r, m.pos.y + (m.eyeH || 1) * 0.5, m.pos.z + Math.sin(h) * r);
  }
  // THE LEAP: a pounce / a charge carries the body into the strike
  if (S.leap > 0 && S.real && S.age < S.dur * 0.55) {
    const dx = t.pos.x - m.pos.x, dz = t.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1;
    const v = Math.max((m.tn ? m.tn.chase : 7) * 1.7, 9);
    const step = Math.min(S.leap, v * sdt);
    S.leap -= step;
    beastMove(m, dx / d, dz / d, step);
    m.speed = v;
  }
  const o = youStrikeOpts(m);
  if (!S.real) o.reach = (m.reach || 2);
  const a0 = m._atkAnim;
  let res = null;
  try { res = m.kit && m.kit.fight ? m.kit.fight(m, t, sdt, o) : CBZ.creatureFight(m, t, sdt, o); } catch (e) { res = null; }
  // a strike that stopped advancing (a fight that threw) is ended, not frozen
  const stuck = m._atkAnim === a0 && m._atkAnim >= 0 && S.age > 0.1;
  if (m._atkAnim == null || m._atkAnim < 0 || stuck || S.age > S.dur * 2.5 + 0.6) {
    if (m._atkAnim >= 0 && CBZ.creatureEndAttack) { try { CBZ.creatureEndAttack(m); } catch (e) {} }
    YOU.strike = null;
    YOU.cd = (S.mv.cd || 0.7) * (res && res.missed && !S.hit ? 0.55 : 1);
  }
}
function stepYouBeast(m, sdt) {
  const I = youInput();
  if (YOU.cd > 0) YOU.cd -= sdt;
  youRetarget(m, sdt);
  m.tgt = YOU.tgt;                       // the sea converges on it; beastMove keeps off it
  if (CBZ.apeOwns && CBZ.apeOwns(m)) {   // a gorilla mid-hold: the hold owns the body
    m.pos.y = MAP.bodyY(m, m.pos.x, m.pos.z);
    return;
  }
  const S = YOU.strike;
  if (S) {
    youStepStrike(m, S, sdt);
  } else {
    const mv = youMoveDir(I);
    const tn = m.tn || { march: 3, chase: 7 };
    let spd = 0;
    // the animal convention: heading h faces (cos h, sin h)
    const t = YOU.tgt;
    const td = t ? Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z) : 99;
    const turnRate = Math.max(2.2, 6.5 / Math.sqrt(Math.max(1, bodySize(m)))) * sdt;
    if (mv.len > 0.05) {
      const want = Math.atan2(mv.z, mv.x);
      m.heading = turnTo(m.heading || 0, want, turnRate);
      let dh = want - m.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      spd = (I.run ? tn.chase : Math.max(2.2, tn.march * 1.15)) * mv.len * Math.max(0.25, Math.min(1, Math.cos(dh) * 1.3));
      if (m.hp < m.maxHp * 0.35) spd *= 0.8;
      const ox = m.pos.x, oz = m.pos.z;
      m.pos.x += Math.cos(m.heading) * spd * sdt;
      m.pos.z += Math.sin(m.heading) * spd * sdt;
      CBZ.micro.resolveCircle(m.pos, m.rad || 0.6, m.pos.y, 1.8);
      // and it does not walk through the body it is facing
      if (t && !t.dead) {
        const keep = Math.max((m.rad || 0.5) + (t.rad || 0.45), (m.noseR || 0) * 0.86);
        const nd = Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
        if (nd < keep && nd < td) { m.pos.x = ox; m.pos.z = oz; spd = 0; }
      }
    } else if (t && td < (m.reach || 2) * 2.2) {
      // standing: square up to the threat in reach
      m.heading = turnTo(m.heading || 0, Math.atan2(t.pos.z - m.pos.z, t.pos.x - m.pos.x), turnRate);
    }
    m.speed = spd;
    m.faceH = m.heading;
    CBZ.faceAnimalHeading(m, m.heading);
    // a press always strikes (at the air if need be); a HELD attack chains
    // strikes only while something is in reach, so holding it on the run in
    // closes the distance instead of biting the wind every second
    if (I.atk && YOU.cd <= 0 && (I.edge || (t && !t.dead && td < (m.reach || 2) * 2.8))) youStartStrike(m);
  }
  if (MAP.water) stepDepth(m, sdt);
  m.pos.y = MAP.bodyY(m, m.pos.x, m.pos.z);
}

/* ---- THE TRUNK: lift, swing, throw ----
   An elephant's trunk takes what it can lift (a man, a wolf, a lion) up to
   the height of its head and throws it. The landing is the damage. The body
   in the air is nobody's to steer (step.js stands down on _tossed). */
function youToss(m, t, dmg) {
  const h = m.heading || 0;
  const side = lcg() < 0.5 ? -1 : 1;
  t._tossed = {
    by: m, age: 0, lift: 0.4, dmg: dmg * 2.4 + 18, down: 0,
    x0: t.pos.x, y0: t.pos.y, z0: t.pos.z,
    vx: Math.cos(h) * 6.5 - Math.sin(h) * side * 2.2, vz: Math.sin(h) * 6.5 + Math.cos(h) * side * 2.2, vy: 6.8,
    rx: t.group ? t.group.rotation.x : 0,
  };
  if (t.beast && t._atkAnim >= 0 && CBZ.creatureEndAttack) { try { CBZ.creatureEndAttack(t); } catch (e) {} }
  if (CBZ.shake) CBZ.shake(0.35);
}
function stepTossed(t, sdt) {
  const T = t._tossed;
  if (!T) return;
  if (t.dead) { if (t.group) t.group.rotation.x = T.rx; t._tossed = null; return; }
  T.age += sdt;
  const m = T.by;
  if (T.down > 0) {
    // on the floor, getting up
    T.down -= sdt;
    if (T.down <= 0) { if (t.group) t.group.rotation.x = T.rx; t._tossed = null; t.thinkAt = simT; }
    return;
  }
  if (T.age < T.lift && m && !m.dead) {
    // up into the trunk, in front of the head
    const h = m.heading || 0, k = T.age / T.lift;
    const tx = m.pos.x + Math.cos(h) * (m.noseR || 2) * 1.05, tz = m.pos.z + Math.sin(h) * (m.noseR || 2) * 1.05;
    const ty = m.pos.y + (m.eyeH || 2.5) * 1.05;
    t.pos.set(T.x0 + (tx - T.x0) * k, T.y0 + (ty - T.y0) * k, T.z0 + (tz - T.z0) * k);
    if (t.group) t.group.rotation.x = T.rx + k * 0.9;
    return;
  }
  T.vy -= 18 * sdt;
  t.pos.x += T.vx * sdt; t.pos.y += T.vy * sdt; t.pos.z += T.vz * sdt;
  if (t.group) t.group.rotation.x += sdt * 5;
  const g = MAP.bodyY(t, t.pos.x, t.pos.z);
  if (t.pos.y <= g && T.vy < 0) {
    t.pos.y = g;
    CBZ.micro.resolveCircle(t.pos, t.rad || 0.5, t.pos.y, 1.8);
    hurtMan(t, T.dmg, { by: m && !m.dead ? m : null, byTeam: m ? m.team : null });
    if (CBZ.shake && camDist2(t.pos) < 40 * 40) CBZ.shake(0.45);
    if (t.dead) { t._tossed = null; return; }
    T.down = 1.3;
    if (t.group) t.group.rotation.x = T.rx + Math.PI / 2 * (t.beast ? 0.8 : 1);
  }
}

/* ------------------------------------------------------------ feel */
// a kill you made: a hit-stop, the clock catching its breath
function camSlowHit() {
  if (!SLOWMO_ON || !YOU.m) return;
  camSlow(0.4, 0.07, 0.25);
}
function frameYouFeel(m) {
  if (m.hp < YOU.hp0 - 0.5) {
    const frac = (YOU.hp0 - m.hp) / Math.max(1, m.maxHp > 1e8 ? 100 : m.maxHp);
    if (CBZ.shake) CBZ.shake(Math.min(1.2, 0.18 + frac * 3));
  }
  YOU.hp0 = m.hp;
  const k = m.kills || 0;
  if (k > YOU.kills0) {
    YOU.kills0 = k;
    if (SLOWMO_ON) camSlow(0.3, 0.32, 0.4, true);
    if (CBZ.shake) CBZ.shake(0.4);
  }
}

/* ------------------------------------------------------------ the frame */
function frameYou(dt) {
  const m = YOU.m;
  if (!m || m.dead) { if (m && m.dead) youDown(m); else leaveYou(false); return; }
  if (m.fled || m.inVeh) { leaveYou(false); return; }
  const IN = CBZ.micro.input;
  let looked = false;
  if (IN) {
    // the edge keys, once a FRAME (the step above runs up to eight times one)
    if (!m.vehicle && !m.beast) {
      if (IN.pressed("KeyC")) setStance(m, m.stance === "crouch" ? "stand" : "crouch");
      if (IN.pressed("KeyR")) youReload(m, CBZ.weaponById(m.wid));
    }
    if (m.vehicle && IN.pressed("KeyX")) m._youSeat = (m._youSeat || 0) + 1;
    if (IN.mx || IN.mz) looked = true;
    YOU.yaw -= IN.mx * 0.0024;
    YOU.pitch = Math.max(0.02, Math.min(0.85, YOU.pitch + IN.mz * 0.002));
  }
  if (YOU.drive && YOU.drive.yaw != null) YOU.yaw = YOU.drive.yaw;
  /* ON A PHONE THE LENS HELPS: with the look thumb idle, the camera eases
     round to the threat you are fighting, so a stick and one button is a
     whole fight. A mouse is never second-guessed. */
  YOU.lookIdle = looked ? 0 : YOU.lookIdle + dt;
  if (COARSE && YOU.lookIdle > 0.6 && YOU.tgt && !YOU.tgt.dead) {
    const t = YOU.tgt;
    const d = Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
    if (d < youRange(m) * 0.6) YOU.yaw = turnTo(YOU.yaw, Math.atan2(t.pos.x - m.pos.x, t.pos.z - m.pos.z), dt * 1.8);
  }
  frameYouFeel(m);
  frameChase(m, dt);
  youMarkStep();
}
// the ring over the threat you face
function youMarkStep() {
  const M = _yMark;
  if (!M) return;
  const t = YOU.tgt;
  if (!t || t.dead || !YOU.m) { if (M.style.display !== "none") M.style.display = "none"; return; }
  const C = CBZ.camera;
  _yv.set(t.pos.x, bodyAimY(t) + 1.2, t.pos.z).project(C);
  if (_yv.z > 1 || _yv.z < -1 || Math.abs(_yv.x) > 1.05 || Math.abs(_yv.y) > 1.05) { M.style.display = "none"; return; }
  const W = window.innerWidth, H = window.innerHeight;
  const d = Math.sqrt(camDist2(t.pos)) || 1;
  const f = H / (2 * Math.tan((C.fov || 60) * Math.PI / 360));
  const r = Math.max(14, Math.min(120, bodySize(t) * 1.3 / d * f));
  M.style.display = "block";
  M.style.width = M.style.height = (r * 2) + "px";
  M.style.transform = "translate(" + ((_yv.x + 1) / 2 * W - r) + "px," + ((1 - _yv.y) / 2 * H - r) + "px)";
  M.classList.toggle("close", d < 6 + bodySize(t));
}

/* ------------------------------------------------------------ TAP TO TAKE
   The screen point, the unit under it: every living body projected, the
   nearest one inside its own on-screen size (never smaller than a thumb). */
function pickUnitAt(x, y) {
  const C = CBZ.camera;
  if (!C || !_yv) return null;
  C.updateMatrixWorld();
  const W = window.innerWidth, H = window.innerHeight;
  const f = H / (2 * Math.tan((C.fov || 60) * Math.PI / 360));
  let best = null, bs = Infinity;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (!canTake(m)) continue;
    _yv.set(m.pos.x, bodyAimY(m) + 1.2, m.pos.z).project(C);
    if (_yv.z > 1 || _yv.z < -1) continue;
    const sx = (_yv.x + 1) / 2 * W, sy = (1 - _yv.y) / 2 * H;
    const d = Math.sqrt(camDist2(m.pos)) || 1;
    const r = Math.max(COARSE ? 30 : 20, (bodySize(m) + (m.beast || m.vehicle ? 0 : 0.5)) * 1.2 / d * f);
    const dp = Math.hypot(sx - x, sy - y);
    if (dp > r) continue;
    const s = dp / r + d * 0.002;
    if (s < bs) { bs = s; best = m; }
  }
  return best;
}
function tapTake(x, y) {
  const u = pickUnitAt(x, y);
  return u ? takeOver(u) : false;
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
