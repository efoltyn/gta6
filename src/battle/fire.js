"use strict";
/* src/battle/fire.js — NPC War: FIRE. How a gun is fired and what the round does.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in.

   THE ROUND IS FLOWN, NOT ROLLED. Every round used to be a dice roll against
   a hit chance (combat_iq's ladder), drawn as a line from the muzzle to the
   chest in one frame. Now the shooter AIMS (a point, a lead on a mover, a
   holdover for range), the gun and the man DISPERSE that aim by real angular
   errors (weapons/ballistics.js: MOA, stance, training, movement, the last
   shots' recoil, being shot at), and the round FLIES: it takes the time a
   real one takes, it drops, it goes through what it can go through and stops
   in what it cannot, and only where it actually arrives decides what it hits.
   A hit is a path through a body: what it crossed (brain, heart and lungs,
   spine, gut, a limb) and the energy it left there decide the wound.

     the trigger      armsTrigger (from stepMan): aimed fire, controlled pairs,
                      bursts by weapon, suppressive fire on the last place the
                      enemy was seen, reloads taken behind cover, stoppages
                      cleared by hand, grenades into cover
     the round        fireShot -> launchRound -> resolveRound (at the time of
                      flight): colliders (with their materials) and the ground
                      along the real line, bodies near it, penetration through
                      walls and bodies, ricochets, near-miss suppression
     what you see     muzzle flash + smoke, ejected brass, tracers (every Nth
                      round, flying), impacts by material, wounds and blood
     what you hear    the report, delayed by distance; the supersonic crack of
                      a round passing the lens BEFORE it (crack, then thump)
     rockets          the RPG flies a real PG-7: kicked out, the motor lights,
                      gravity; backblast behind the tube (a friend in it holds
                      the shot). 40 mm arms at 18 m.
     grenades         a real arc, a 4-5 s fuse, the blast core and the
                      fragments, which a crest or a wall stops

   For the AI (src/battle/ai/*): read, don't duplicate.
     CBZ.battleArms.band(m)          {eff, area, max, cls} of his weapon
     CBZ.battleArms.liveGrenades()   [{x, z, t}] grenades on the ground
     m.supp                          near misses rattle it (suppressR by calibre)
     m._arms[wid].ammo / m.mag       what he has left
   ============================================================ */
const SIGHT = 175;
/* A DUNE IS NOT MADE OF COLLIDERS. segmentBlocked answers for every box in
   the world and nothing else, which was the whole truth while every venue
   fought on a flat plate — and a lie the moment the war moved onto real
   dunes, where a man would sight and fire straight through twenty metres
   of sand. So on a map that declares terrainLos, the ground itself is
   sampled along the eye line: 3 m steps against a 420 m dune wavelength
   cannot step over a crest, and the first and last couple of metres are
   the two bodies' own footing and never count. The colliders are asked
   first because they are cheaper and usually the answer. ?tlos=0 turns the
   sand transparent again, so the difference is measurable. */
function terrainBlocked(ax, ay, az, bx, by, bz, ground) {
  const g = ground || MAP.groundAt;   // buildMap scans before MAP exists
  const dx = bx - ax, dz = bz - az;
  const d = Math.hypot(dx, dz);
  if (d < 8) return false;
  const dy = by - ay, n = Math.ceil(d / 3);
  for (let i = 1; i < n; i++) {
    const t = i / n, at = t * d;
    if (at < 2 || d - at < 2) continue;
    if (g(ax + dx * t, az + dz * t) > ay + dy * t + 0.35) return true;
  }
  return false;
}
// eye and torso heights are PER BODY now: a man looks from 1.52 and is hit
// at 1.35; a wolf looks from half a metre and a giraffe from four — the
// measured box each beast carries says so, and the default is the man.
function eyeLos(m, o) {
  const ay = m.pos.y + (m.eyeH || 1.52), by = o.pos.y + (o.losY || 1.35);
  if (CBZ.micro.segmentBlocked(m.pos.x, ay, m.pos.z, o.pos.x, by, o.pos.z)) return false;
  return !(MAP.terrainLos && terrainBlocked(m.pos.x, ay, m.pos.z, o.pos.x, by, o.pos.z));
}
/* IS ONE OF MINE STANDING IN THIS LANE? Only the near end is asked: past
   about twelve metres the round has cleared the firing line and anybody it
   meets is the enemy's problem. Cheap enough to ask on every trigger pull,
   which is what makes it a rule and not a report. */
function mateInLane(m, tgt) {
  const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.5) return 0;
  const nx = dx / d, nz = dz / d, reach = Math.min(d - 0.6, 12);
  if (reach <= 1) return 0;
  const a = fineNear(m.pos.x + nx * reach * 0.5, m.pos.z + nz * reach * 0.5, reach * 0.5 + 1.2);
  let worst = 0, worstOff = 9;
  for (let i = 0; i < a.length; i++) {
    const o = a[i];
    if (o === m || o.dead || o.team !== m.team) continue;
    const ox = o.pos.x - m.pos.x, oz = o.pos.z - m.pos.z;
    const along = ox * nx + oz * nz;
    if (along < 0.8 || along > reach) continue;
    const off = ox * nz - oz * nx;                 // SIGNED: which side he is on
    if (Math.abs(off) < 0.62 && Math.abs(off) < worstOff) {
      worstOff = Math.abs(off);
      worst = off >= 0 ? 1 : -1;                   // 0 means clear, ±1 the side
    }
  }
  return worst;
}
/* AND THE MAN GETS OUT OF THE WAY. Holding fire alone would produce a rank
   of men who never shoot, so the answer is the one a rifleman actually uses:
   step off the line, to the side the mate is NOT on, keeping his mark. */
function stepOffLine(m, tgt, side) {
  const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const nx = dx / d, nz = dz / d;
  const s = -side;                                  // away from the man in the way
  m.target.set(m.pos.x + nz * s * 2.4, 0, m.pos.z - nx * s * 2.4);
  m.slot = "sidestep";
  m.stepAsideT = 0.55;
  m.cool = Math.max(m.cool, 0.18);                  // and he does NOT fire through him
}
function camDist2(p) {
  const c = CBZ.camera.position;
  return (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y) + (p.z - c.z) * (p.z - c.z);
}
let fxBudget = 0;              // muzzle effects drawn this frame — a salvo cannot flood it

/* PRONE. setStance (ai/morale.js) scales a body's heights by STANCE_K; a man
   flat behind his bipod presents his head and shoulders, about a quarter of
   his standing height. Added here, where the stance is chosen for the gun. */
STANCE_K.prone = 0.27;

/* ============================================================ THE ARMS STATE
   One record per gun a body carries (a vehicle's MGs each keep their own
   heat and round count): the ballistics row, the cartridge, the barrel's own
   muzzle velocity, the shooter's training, the recoil not yet recovered, the
   aim clock, the stoppage clock, the basic load and the grenades. */
const ARMS = CBZ.battleArms = {
  rounds: 0, hits: 0, pens: 0, rics: 0, jams: 0, nades: 0, frags: 0, bleedKills: 0, snaps: 0, tracers: 0,
  organs: { brain: 0, spine: 0, vital: 0, gut: 0, none: 0 }, plates: 0,
  // where the war is fought: trigger pulls and hits by range (0-25-50-100-200-400-inf m)
  shotsAt: [0, 0, 0, 0, 0, 0, 0], hitsAt: [0, 0, 0, 0, 0, 0, 0], area: 0,
  // why a man whose gun was ready did not fire (the AI's tuning question)
  why: { dry: 0, topup: 0, nade: 0, range: 0, slot: 0, ducked: 0, react: 0, unseen: 0, suppress: 0, blind: 0, lane: 0, jam: 0, fired: 0 },
  stoppedBy: {},
};
function armsTier(m) {
  if (m.vehicle) return "elite";
  return m.tier || (CBZ.combatIQ && CBZ.combatIQ.tierOf ? CBZ.combatIQ.tierOf(m) : "pro");
}
function armOf(m) {
  const id = m._gunId || m.wid || "carbine";
  const S = m._arms || (m._arms = {});
  let A = S[id];
  if (A) return A;
  const B = CBZ.ballistics;
  const g = (B && B.gun(id)) || (B && B.gun(m.vehicle ? "m240_coax" : "carbine"));
  const w = CBZ.weaponById ? CBZ.weaponById(m.wid) : null;
  const tier = armsTier(m);
  const c = g && g.cart ? B.CART[g.cart] : null;
  A = S[id] = {
    id: id, g: g, c: c, w: w, tier: tier, T: B.TRAIN[tier] || B.TRAIN.pro,
    v0: B.muzzleV(id, w), k: B.dragOf(id, w),
    heat: 0, lastT: -9, n: 0, jamT: 0,
    aimOn: null, aimT: 0, react: 0, burst: 0,
    ammo: m.vehicle ? 1e9 : (g.carry || 0),
    nades: m.vehicle || m.you || MAP.water ? 0 : (tier === "civ" ? 0 : tier === "thug" ? 1 : 2), nadeT: 0,
    seenX: 0, seenY: 0, seenZ: 0, seenT: -99, supT: 0, resT: 0,
  };
  return A;
}

/* ---- the magazine: reload, the basic load, resupply ---- */
const RELOAD_K = { civ: 1.7, thug: 1.35, pro: 1.12, elite: 1, swat: 0.92 };
function armsReload(m) {
  if (!m.magSize || m.reloadT > 0 || m.mag >= m.magSize) return false;
  const A = armOf(m);
  if (A.ammo <= 0) return false;
  const g = A.g;
  // a tube magazine is loaded one shell at a time; everything else is a swap
  const per = g.cls === "shotgun";
  const need = Math.min(m.magSize - m.mag, A.ammo);
  m.reloadT = (per ? g.reload * need : (g.reload || 2.4)) * (RELOAD_K[A.tier] || 1);
  m.reloads++; gunLedger(m.wid).reloads++;
  A.burst = 0;
  const d2 = camDist2(m.pos);
  if (d2 < 60 * 60 && CBZ.audioManifest && CBZ.audioManifest.effects && CBZ.audioManifest.effects.reload) {
    try { CBZ.sfx("reload", { dist: Math.sqrt(d2), ghost: true }); } catch (e) {}
  }
  if (m.char && CBZ.soldier && d2 < 140 * 140) { try { CBZ.soldier.reload(m.char, { dur: Math.min(3, m.reloadT) }); } catch (e) {} }
  return true;
}
function armsReloaded(m) {
  const A = armOf(m);
  const take = Math.min(m.magSize - m.mag, A.ammo);
  m.mag += take; A.ammo -= take;
}
// one tick of the gun's own clocks (from stepMan, every living armed man)
function armsTick(m, sdt) {
  if (m.reloadT > 0) {
    m.reloadT -= sdt;
    if (m.reloadT <= 0) { m.reloadT = 0; armsReloaded(m); }
  }
  const S = m._arms;
  if (S) { const A = S[m.wid]; if (A && A.jamT > 0) A.jamT -= sdt; }
}
/* A STOPPAGE. The round does not go; the man finds out (click), and clears
   it: tap the magazine, rack the charging handle, back on the gun. A
   trained man does it in a second and a half; a civilian stares at it. */
function armsJam(m, A) {
  A.jamT = A.T.clear * (0.8 + lcg() * 0.6);
  m.cool = Math.max(m.cool, A.jamT);
  A.burst = 0;
  ARMS.jams++;
  const L = gunLedger(m.wid); L.jams = (L.jams || 0) + 1;
  const d2 = camDist2(m.pos);
  if (d2 < 40 * 40) { try { CBZ.sfx("empty", { dist: Math.sqrt(d2), ghost: true }); } catch (e) {} }
  if (m.char && CBZ.soldier && d2 < 140 * 140) { try { CBZ.soldier.reload(m.char, { dur: Math.min(2.4, A.jamT) }); } catch (e) {} }
}
/* RESUPPLY. A man running low takes what the dead next to him carried (the
   same cartridge, either side's: a rifleman picks up rifle ammunition), and
   draws from a friendly vehicle parked within a few strides (every truck
   and carrier rides with its crates). Asked every couple of seconds, only
   while he is low. */
function armsResupply(m, A) {
  if (simT < A.resT) return;
  A.resT = simT + 2;
  const want = (A.g.carry || 0) - A.ammo;
  if (want <= 0) return;
  for (let i = corpses.length - 1; i >= 0 && A.ammo < A.g.carry; i--) {
    const o = corpses[i];
    if (!o || o.beast || o.vehicle || !o._arms) continue;
    if (Math.abs(o.pos.x - m.pos.x) > 6 || Math.abs(o.pos.z - m.pos.z) > 6) continue;
    for (const k in o._arms) {
      const B2 = o._arms[k];
      if (!B2 || !B2.g || B2.g.cart !== A.g.cart) continue;
      const have = B2.ammo + (k === o.wid ? Math.max(0, o.mag) : 0);
      if (have <= 0) continue;
      const take = Math.min(have, A.g.carry - A.ammo);
      A.ammo += take; B2.ammo = Math.max(0, B2.ammo - take);
      if (k === o.wid) o.mag = 0;
    }
  }
  for (let i = 0; i < men.length; i++) {
    const v = men[i];
    if (!v.vehicle || v.dead || v.team !== m.team || v.air) continue;
    if (Math.abs(v.pos.x - m.pos.x) > 12 || Math.abs(v.pos.z - m.pos.z) > 12) continue;
    A.ammo = A.g.carry; A.nades = Math.max(A.nades, armsTier(m) === "civ" ? 0 : 2);
    break;
  }
}

/* ============================================================ THE GUN'S STANCE
   A belt-fed gun and a sniper rifle are fired lying down off a bipod; a
   rifleman shooting past a hundred metres takes a knee. Asked by stepMan when
   he has stopped to fight a mark he can see; the AI's own stances (its cover,
   its fold in the dunes, the crouch of a pinned man) win wherever it has one. */
function weaponStance(m, tgt, spd) {
  if (m.vehicle || m.beast || m.fists || m.routed || m.you || m.launcher || MAP.water) return null;
  if (spd > 0.1 || !tgt || tgt.dead || tgt.fled) return null;
  if (m.slot === "cover" || m.slot === "peek" || m.slot === "hull" || m.slot === "sidestep") return null;
  const dist = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
  if (!m.sees && !(m.stance === "prone" && simT - (armOf(m).seenT || -99) < 4)) return null;
  const cls = armOf(m).g.cls;
  if ((cls === "lmg" || cls === "sniper") && dist > 25) return "prone";
  if ((cls === "rifle" || cls === "lmg" || cls === "sniper") && dist > 60) return "crouch";
  return null;
}

/* ============================================================ THE TRIGGER
   stepMan has already decided he is fighting this mark (not routed, not
   reloading, armed with a gun that is not a launcher). This is how he uses
   the gun on it. */
function armsGroup(A, n, iv, pause) {
  if (A.burst <= 0) A.burst = Math.max(1, n);
  A.burst--;
  return A.burst > 0 ? iv : pause;
}
/* THE RHYTHM, BY WEAPON AND RANGE.
     pistol    controlled pairs
     smg       short bursts of 3-4
     rifle     bursts only inside 25 m; controlled pairs to 70 m; past that
               single aimed shots, each one longer to set up with range
     lmg       bursts of 4-7 (longer in close); the pause is the gunner
               walking the next burst onto the mark
     sniper    one round, the bolt, the next aim
     shotgun   the pump
   Discipline (the training row) lengthens nothing and shortens the pause. */
function armsCadence(m, A, dist) {
  const g = A.g, w = A.w;
  const iv = Math.max(0.05, (w && (w.fireDelay || w.interval)) || 0.1);
  const disc = A.tier === "civ" ? 0.1 : A.tier === "thug" ? 0.32 : A.tier === "pro" ? 0.55 : A.tier === "elite" ? 0.78 : 0.9;
  const pause = (1.25 - disc * 0.45) * (0.85 + lcg() * 0.3);
  switch (g.cls) {
    case "pistol": return armsGroup(A, 2, Math.max(iv, 0.22), 0.4 * pause + dist / 90);
    case "smg": return armsGroup(A, 3 + (lcg() < 0.5 ? 1 : 0), iv, 0.32 * pause + dist / 120);
    case "shotgun": return Math.max(iv, 0.78) + 0.12 * pause;
    case "sniper": return Math.max(iv, 1.25) + (0.6 + dist / 220) * pause;
    case "stun": return Math.max(iv, 0.92);
    case "lmg": return armsGroup(A, 4 + Math.floor(lcg() * 4) + (dist < 60 ? 2 : 0), iv, (0.55 + dist / 600) * pause);
    default:
      if (dist < 25) return armsGroup(A, 3, iv, 0.32 * pause);
      if (dist < 70) return armsGroup(A, 2, Math.max(iv, 0.22), 0.42 * pause + dist / 220);
      A.burst = 0;
      return (0.45 + dist / 260) * pause;
  }
}
function armsTrigger(m, tgt, dist, sdt) {
  const A = armOf(m), g = A.g;
  // THE AIM CLOCK: a new mark is a new reaction and a new settle
  if (A.aimOn !== tgt) {
    A.aimOn = tgt; A.aimT = 0; A.burst = 0;
    A.react = A.T.react * (0.8 + lcg() * 0.4);
  }
  A.aimT += sdt;
  if (A.react > 0) A.react -= sdt;
  if (m.sees) {
    A.seenX = tgt.pos.x; A.seenZ = tgt.pos.z; A.seenT = simT;
    A.seenY = tgt.pos.y + (tgt.aimY || 1.28);
  }
  if (A.jamT > 0 || m.cool > 0) return;
  // dry: the magazine, the pouches, then what lies around him
  if (A.ammo < (m.magSize || 1)) armsResupply(m, A);
  if (m.mag <= 0) {
    ARMS.why.dry++;
    if (!armsReload(m) && A.ammo <= 0) {
      // NOTHING LEFT. He fights with what he has: his hands.
      m.fists = true; m.armed = false;
    }
    return;
  }
  // A TOP-UP IS TAKEN WHERE NOBODY CAN SEE YOU. A man down to a third of his
  // magazine with nothing in his sights (or tucked in his fold) changes it now,
  // rather than running dry in the middle of the next exchange.
  if (m.mag < m.magSize * 0.34 && A.ammo > 0 && (!m.sees || !m.up || m.slot === "cover" || tgt.dead)) { ARMS.why.topup++; armsReload(m); return; }
  if (armsGrenade(m, tgt, dist)) { ARMS.why.nade++; return; }
  if (dist > Math.min(g.area, SIGHT * 1.2)) { ARMS.why.range++; return; }
  // (the squad's own gate, ai/squad.js tacMayFire, already said yes or no when it has a word)
  if (m._tacMay == null && m.slot !== "fire" && m.slot !== "peek" && m.slot !== "push" && m.slot !== "sidestep" &&
      m.slot !== "hull" && dist > 12) { ARMS.why.slot++; return; }
  if (!m.up) { ARMS.why.ducked++; return; }   // ducked behind his crest (workHull)
  if (A.react > 0) { ARMS.why.react++; m.cool = A.react; return; }
  if (!m.sees) {
    /* SUPPRESSIVE FIRE. The enemy went to ground; he was THERE a moment ago.
       A machine gunner keeps short bursts going into that spot and a
       rifleman a slow round every second or two: the rounds crack over the
       fold and the men behind it keep their heads down (resolveRound rattles
       everyone the round passes near). Not past six seconds of no sight, not
       on a nearly empty magazine, not beyond the gun's area range. */
    const age = simT - A.seenT;
    ARMS.why.unseen++;
    if (age > 6 || (g.cls !== "lmg" && g.cls !== "rifle")) return;
    if (g.cls === "rifle" && m.mag < m.magSize * 0.45) return;
    const sd = Math.hypot(A.seenX - m.pos.x, A.seenZ - m.pos.z);
    if (sd > g.area || sd < 8) return;
    _aimAt.set(A.seenX, A.seenY, A.seenZ);
    ARMS.why.suppress++;
    fireShot(m, tgt, { mode: "area", at: _aimAt });
    m.cool = g.cls === "lmg" ? armsGroup(A, 3 + Math.floor(lcg() * 3), 0.09, 1.4 + lcg() * 1.1) : 1.1 + lcg() * 1.1;
    if (m.mag <= 0) armsReload(m);
    return;
  }
  /* THE LINE IS CHECKED WHEN THE TRIGGER IS PULLED, NOT WHEN HE LAST THOUGHT.
     `m.sees` is up to half a second old, and stale LOS is how rounds get fired
     into a wall that closed in between. This only runs once the cooldown is
     up, so it costs about one segment trace per shot. */
  if (!FIRE_OLD) {
    m.sees = eyeLos(m, tgt);
    if (!m.sees) { ARMS.why.blind++; m.cool = 0.12; return; }
    const side = mateInLane(m, tgt);
    if (side) { ARMS.why.lane++; stepOffLine(m, tgt, side); return; }
  }
  if (fireShot(m, tgt, { mode: "aimed" }) === false) { ARMS.why.jam++; return; }
  ARMS.why.fired++;
  m.cool = Math.max(m.cool, armsCadence(m, A, dist));
  if (m.mag <= 0) armsReload(m);
}
// the launcher's trigger: stand off, check the tube's back, fire
function armsLauncher(m, tgt, dist) {
  if (m.cool > 0 || !m.sees) return;
  const A = armOf(m);
  if (A.jamT > 0) return;
  if (m.mag <= 0) { if (!armsReload(m) && A.ammo <= 0) { m.launcher = false; m.fists = true; m.armed = false; } return; }
  const g = A.g;
  if (dist < (g.cls === "grenade" ? 22 : 16) || dist > Math.min(g.area, 260)) return;
  // DANGER CLOSE (ai/squad.js): never onto his own men, nor over their heads
  if (dangerClose(m.team, tgt.pos.x, tgt.pos.z, 11) ||
      dangerClose(m.team, (m.pos.x + tgt.pos.x) / 2, (m.pos.z + tgt.pos.z) / 2, Math.min(11, dist * 0.3))) { m.cool = 0.5; return; }
  if (fireRocket(m, tgt) === false) return;
  const w = CBZ.weaponById(m.wid);
  if (m.mag <= 0) armsReload(m);
  m.cool = Math.max(m.cool, (w.fireDelay || w.interval || 1.2) + 0.6 + lcg() * 0.8);
}

/* ============================================================ THE SHOT
   fireShot(m, tgt, r) is the one entry every gun on this page goes through:
   the AI's trigger above, YOU (player.js), and a vehicle's machine guns
   (vehicles.js, with u._gunId naming the mount). r.mode: "aimed" (default,
   at tgt), "area" (suppressive fire into r.at, sprayed) or "point" (r.at
   exactly: YOUR rifle with nobody in the sights). Returns false on a
   stoppage. */
let _aimAt = null, _rq = null, _rq2 = null;
CBZ.npcwar.onBoot(function () {
  _aimAt = V(); _rq = V(); _rq2 = V();
});
// where a trained eye puts the aim on this body: centre of the chest on a
// man, the heart behind the shoulder on an animal (a hunter's aim), the
// middle of the hull on a vehicle; a civilian aims at the middle of whatever
function aimPoint(m, tgt, A, out) {
  out.set(tgt.pos.x, tgt.pos.y + (tgt.aimY || 1.28), tgt.pos.z);
  if (tgt.beast && tgt.bodyL && A.tier !== "civ") {
    const h = tgt.heading || 0;
    const off = tgt.bodyX0 + tgt.bodyL * 0.62;          // the heart, along the body
    out.x += Math.cos(h) * off; out.z += Math.sin(h) * off;
    out.y = tgt.pos.y + (tgt.bodyY0 || 0) + tgt.bodyH * 0.6;
  } else if (tgt.vehicle) {
    out.y = tgt.pos.y + (tgt.vheight || 2) * 0.5;
  }
  return out;
}
function fireShot(m, tgt, r) {
  const B = CBZ.ballistics;
  const w = CBZ.weaponById(m.wid);
  const A = armOf(m), g = A.g, c = A.c;
  const mode = (r && r.mode) || "aimed";
  if (!m.vehicle && !m.you && lcg() < g.malf * A.T.malfK) { armsJam(m, A); return false; }
  m.mag--; m.lastShotT = simT;
  stats[m.team].shots++;
  m.shotsF++; gunLedger(m.wid).shots++;
  /* WHEN DOES THE WAR ACTUALLY START? The one number that says whether a
     person is watching a battle or watching a commute, and it is free. */
  if (QUAL.firstShotT < 0) QUAL.firstShotT = Math.round(simT * 10) / 10;
  if (PROBE && mode === "aimed" && tgt) {
    if (!eyeLos(m, tgt)) QUAL.blindFire++;
    if (mateInLane(m, tgt)) QUAL.throughMate++;
    if (MAP.terrainTrue && terrainBlocked(m.pos.x, m.pos.y + (m.eyeH || 1.52), m.pos.z,
      tgt.pos.x, tgt.pos.y + (tgt.losY || 1.35), tgt.pos.z)) QUAL.throughSand++;
  }
  if (shotsRing.length > 90) shotsRing.shift();
  shotsRing.push({ x: m.pos.x, z: m.pos.z, t: simT, m: m });

  const cd2 = camDist2(m.pos);
  // the muzzle
  let from = null;
  if (m.vehicle) from = vehicleMuzzle(m, _muz);
  else if (cd2 < 130 * 130 && CBZ.actorMuzzle) from = CBZ.actorMuzzle(m, _muz);
  if (!from) from = _muz.set(m.pos.x + Math.sin(m.yaw) * 0.5, m.pos.y + (m.eyeH || 1.52) * 0.93, m.pos.z + Math.cos(m.yaw) * 0.5);
  const ox = from.x, oy = from.y, oz = from.z;

  // THE AIM: the point, the lead on a mover, the holdover for range
  const P = _rq;
  if (mode !== "aimed" && r && r.at) P.copy(r.at);
  else aimPoint(m, tgt, A, P);
  let hd = Math.hypot(P.x - ox, P.z - oz) || 0.01;
  if (mode === "aimed" && tgt) {
    const tf = B.tof(A.v0, A.k, hd);
    const lf = B.leadFactor(A.tier, lcg);
    P.x += (tgt._vx || 0) * tf * lf; P.z += (tgt._vz || 0) * tf * lf;
    hd = Math.hypot(P.x - ox, P.z - oz) || 0.01;
  }
  const poiTrue = B.poi(A.v0, A.k, hd, g.zero, g.sightH);
  const band = hd < 25 ? 0 : hd < 50 ? 1 : hd < 100 ? 2 : hd < 200 ? 3 : hd < 400 ? 4 : 5;
  ARMS.shotsAt[band]++;
  if (mode === "area") ARMS.area++;
  let hold = 0;
  // a trained man holds over past his zero (and a sniper dials every shot);
  // inside it he holds centre and lives with the few centimetres
  if (A.T.holdOver && (g.dial || hd > g.zero * 0.85)) {
    const est = Math.max(1, hd * (1 + B.gauss(lcg) * A.T.rangeErr * (g.dial ? 0.35 : 1)));
    hold = -B.poi(A.v0, A.k, est, g.zero, g.sightH);
  }
  // THE DISPERSION: the gun, the man, his stance, his feet, his nerve and
  // what the last rounds left on the muzzle
  A.heat *= Math.exp(-(simT - A.lastT) / A.T.recover);
  const settle = A.aimT / Math.max(0.2, A.T.react * 1.6);
  let sig = B.sigma({ gun: g, tier: A.tier, stance: m.stance || "stand", bipod: !!g.bipod, mount: !!m.vehicle,
    speed: m.vehicle ? (m.speed || 0) * 0.3 : (m.speed || 0), settle: m.vehicle ? 1 : settle,
    supp: Math.min(1.2, m.supp || 0), heat: A.heat });
  if (mode === "area") sig += 5;
  const climb = A.heat;
  A.heat += (g.recoil || 2) * (m.vehicle ? 0.5 : m.stance === "prone" ? (g.bipod ? 0.45 : 0.6) : m.stance === "crouch" ? 0.8 : 1);
  A.lastT = simT;
  A.n++;
  const tracer = !!((g.tracer && A.n % g.tracer === 0) || (g.tracerLast && m.mag < g.tracerLast));
  // THE ROUNDS: one, or nine pellets in a pattern
  const hx = (P.x - ox) / hd, hz = (P.z - oz) / hd;
  const pellets = c.pellets || 1, pat = g.pattern ? g.pattern / 2.4 : 0;
  for (let i = 0; i < pellets; i++) {
    const ex = B.gauss(lcg) * sig + (pat ? B.gauss(lcg) * pat : 0) + (lcg() - 0.5) * climb * 0.5;
    const ey = B.gauss(lcg) * sig + climb * 0.7 + (pat ? B.gauss(lcg) * pat : 0);
    const k = hd / 1000;
    launchRound(m, mode === "aimed" ? tgt : null, A, ox, oy, oz,
      P.x - hz * ex * k, P.y + hold + poiTrue + ey * k, P.z + hx * ex * k, tracer && i === 0, i === 0);
  }
  // AND WHAT THE GUN DOES WHILE IT DOES IT
  armsMuzzle(m, A, w, from, hx, hz, cd2);
  return true;
}
/* ---- the muzzle: flash, smoke, brass, the report, and the man's shoulder ---- */
// per-frame caps on the cosmetic half (wall clock: a frame may hold eight sub-steps)
let fxSmoke = 0, fxBrass = 0, fxImpact = 0, fxSnap = 0, fxAt = 0;
function fxTick() {
  const t = performance.now();
  if (t - fxAt > 15) { fxAt = t; fxSmoke = 0; fxBrass = 0; fxImpact = 0; fxSnap = 0; }
}
function armsMuzzle(m, A, w, from, hx, hz, cd2) {
  if (cd2 > 900 * 900) return;
  const c = A.c, E = CBZ.ballistics.energy(c, A.v0) * (c.pellets || 1);
  const dCam = Math.sqrt(cd2);
  // THE REPORT, and it arrives when sound would: distance / 343 m/s. Past the
  // far-field distance the audio bus swaps in the muffled far voice itself.
  if (w && w.sfx) {
    try {
      CBZ.sfx(w.sfx, { dist: dCam, ghost: true, volume: (w.sfxVol || 1) * (m.vehicle ? 1 : 0.82),
        pitch: (w.sfxPitch || 1) * (A.c.mm > 12 ? 0.82 : 1), delay: dCam / CBZ.ballistics.SOUND });
    } catch (e) {}
  }
  if (cd2 > 320 * 320 || fxBudget >= 34) return;
  fxBudget++;
  CBZ.muzzleFlash(from, { scale: 0.45 + Math.sqrt(E) / 55 });
  // the smoke a burst leaves hanging at the muzzle
  if (CBZ.munitions && cd2 < 140 * 140 && fxSmoke < 16) {
    fxSmoke++;
    const s = 0.55 + Math.sqrt(E) / 70;
    try {
      CBZ.munitions.smoke(from.x + hx * 0.2, from.y, from.z + hz * 0.2, hx * 1.6, 0.3, hz * 1.6,
        0.06, s, 1.3 + lcg() * 0.8, 0.13, 0.82, 0.8, 0.77, { drag: 2.6, rise: 0.25, wind: 1 });
    } catch (e) {}
  }
  // the case leaves the port to the right of the gun and lands at his feet
  if (CBZ.ejectBrass && !m.vehicle && cd2 < 55 * 55 && fxBrass < 14 && A.id !== "revolver" && A.c !== CBZ.ballistics.CART.taser) {
    fxBrass++;
    _rq2.set(-hz, 0, hx);                          // the gun's right, in the world
    try {
      CBZ.ejectBrass({ x: from.x - hx * 0.35, y: from.y + 0.02, z: from.z - hz * 0.35 }, _rq2,
        { mm: A.c.mm, shell: !!A.c.pellets, groundY: MAP.groundAt(m.pos.x, m.pos.z), fwd: { x: hx, z: hz } });
    } catch (e) {}
  }
}

/* ============================================================ THE ROUND
   A flown round is a straight line from the muzzle through the point where
   it crosses the target's plane (that point already carries the gun's drop
   at that range, the shooter's hold and his errors), continuing past it and
   falling further. It is traced against the WORLD the moment it leaves the
   barrel (walls do not move), and against the BODIES when it gets there,
   which is the time of flight later: a man who stepped out of the line in
   that time is missed, a charging lion that was not led is hit behind the
   shoulder or not at all. */
const ROUNDS = [];
const RPOOL = [];
const _rh = { hit: false, c: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
const _rh2 = { hit: false, c: null, t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
let _onlyC = null;
const RAY_ONLY = { filter: function (c) { return c === _onlyC; } };
function groundMatAt() {
  if (MAP.water) return "water";
  const mp = (typeof MAPS !== "undefined" && MAPS[MAP.id]) || null;
  const erg = mp && mp.erg;
  return erg === "snow" ? "snow" : erg === "grass" ? "dirt" : erg === "sand" ? "sand" : MAP.terrainTrue ? "sand" : "concrete";
}
function groundColor(mat) {
  return mat === "snow" ? 0xeef1f5 : mat === "dirt" ? 0x6a5a40 : mat === "sand" ? 0xcdb48a : mat === "water" ? 0xe8f2f6 : 0x8f8b84;
}
// a collider's material: what the arena said it was built of, else masonry
function colMat(c) { return (c && c.mat) || "concrete"; }
function launchRound(m, tgt, A, ox, oy, oz, px, py, pz, tracer, first) {
  const B = CBZ.ballistics;
  const r = RPOOL.pop() || {};
  r.by = m; r.team = m.team; r.tgt = tgt; r.A = A; r.c = A.c; r.v0 = A.v0; r.k = A.k;
  r.ox = ox; r.oy = oy; r.oz = oz;
  let dx = px - ox, dy = py - oy, dz = pz - oz;
  const L = Math.hypot(dx, dy, dz) || 0.01;
  dx /= L; dy /= L; dz /= L;
  r.dx = dx; r.dy = dy; r.dz = dz;
  r.hk = Math.hypot(dx, dz) || 1;                 // horizontal metres per metre of line
  r.sT = L;                                        // the target plane, along the line
  r.sEnd = Math.min((A.g.max || 600) / r.hk, L + 140);
  if (A.k > 1e-4) r.sEnd = Math.min(r.sEnd, (r.v0 / r.k) * 0.97 / r.hk);
  r.tracer = tracer; r.t0 = simT; r.resolved = false; r.dead = false;
  r.l1 = Infinity; r.l1k = 1; r.l2 = Infinity; r.l2k = 1;
  r.sStop = r.sEnd; r.stopMat = null; r.stopNx = 0; r.stopNy = 1; r.stopNz = 0; r.ric = 0; r.pierceX = null;
  armsTraceWorld(r);
  // resolve when it reaches the target plane, or where the world stopped it
  const sRes = Math.min(r.sStop, r.sT + 0.5);
  r.tRes = simT + B.tof(r.v0, r.k, sRes * r.hk);
  r.sVis = r.sStop; r.tEnd = Infinity;
  ROUNDS.push(r);
  ARMS.rounds++;
  if (tracer) ARMS.tracers++;
  // THE CRACK. A supersonic round passing the lens is heard as it passes, and
  // that is BEFORE the report whenever the shooter is any distance off.
  if (first && fxSnap < 4 && CBZ.camera && !m.you) {
    const cam = CBZ.camera.position;
    let t = (cam.x - ox) * dx + (cam.y - oy) * dy + (cam.z - oz) * dz;
    if (t > 8 && t < r.sStop) {
      const qx = ox + dx * t - cam.x, qy = oy + dy * t - cam.y, qz = oz + dz * t - cam.z;
      const miss = Math.hypot(qx, qy, qz);
      const v = B.vAt(r.v0, r.k, t * r.hk);
      if (miss < 20 && v > B.SOUND * 1.08) {
        fxSnap++; ARMS.snaps++;
        try { CBZ.sfx("bullet_snap", { dist: miss, ghost: true, volume: Math.min(1, 1.2 - miss / 20) * Math.min(1.3, 0.6 + A.c.mm / 12), delay: B.tof(r.v0, r.k, t * r.hk) }); } catch (e) {}
      }
    }
  }
  return r;
}
// a layer the round went through at s, leaving it k of its speed (two slots;
// a third folds into the second, which is a few m/s off and nobody can see it)
function addLayer(r, s, k) {
  if (s < r.l1) { r.l2 = r.l1; r.l2k = r.l1k; r.l1 = s; r.l1k = k; }
  else if (s < r.l2) { if (r.l2 !== Infinity) k *= r.l2k; r.l2 = s; r.l2k = k; }
  else r.l2k *= k;
}
// velocity at s metres along the line, through whatever layers it has crossed
function roundV(r, s) {
  let v = CBZ.ballistics.vAt(r.v0, r.k, s * r.hk);
  if (s > r.l1) v *= r.l1k;
  if (s > r.l2) v *= r.l2k;
  return v;
}
// the round's height at s: its straight line, and past the target plane the
// extra fall the line does not carry
function roundY(r, s) {
  let y = r.oy + r.dy * s;
  if (s > r.sT) {
    const B = CBZ.ballistics;
    y -= Math.max(0, B.drop(r.v0, r.k, s * r.hk) - B.drop(r.v0, r.k, r.sT * r.hk));
  }
  return y;
}
/* THE WORLD ALONG THE LINE: colliders (with their real thickness along the
   line and their material) and the ground, in order. A layer the round can
   go through costs it velocity (weapons/ballistics.js pierce); one it cannot
   stops it, or, at a grazing angle on something hard, skips it off. */
function armsTraceWorld(r) {
  const B = CBZ.ballistics, M = CBZ.micro;
  let s = 0.25, layers = 0;
  const ray = M && M.rayColliders;
  let sGround = groundHit(r, 1.5, r.sEnd);
  while (layers < 3) {
    const lim = Math.min(r.sEnd, sGround) - s;
    if (lim <= 0.05 || !ray) break;
    const c = ray(r.ox + r.dx * s, r.oy + r.dy * s, r.oz + r.dz * s, r.dx, r.dy, r.dz, lim, _rh, null);
    if (!c) break;
    const sIn = s + _rh.t;
    const mat = colMat(c);
    // its thickness along the line: from the far side, back to the exit face
    let thick = 50;                                // not found from behind: it is massive
    _onlyC = c;
    const back = 40;
    const fx = r.ox + r.dx * (sIn + back), fy = r.oy + r.dy * (sIn + back), fz = r.oz + r.dz * (sIn + back);
    if (ray(fx, fy, fz, -r.dx, -r.dy, -r.dz, back, _rh2, RAY_ONLY)) thick = Math.max(0.01, back - _rh2.t);
    _onlyC = null;
    let eff = thick;
    if (c.hollow) eff = Math.min(thick, c.hollow * 2);   // a container: two steel walls and air
    else if (c.fill != null) eff = thick * c.fill;      // a crate: part wood, part what is in it
    const v = roundV(r, sIn);
    const sinG = Math.abs(r.dx * _rh.nx + r.dy * _rh.ny + r.dz * _rh.nz);
    const ric = B.ricochet(mat, sinG, lcg);
    const vOut = ric > 0 ? 0 : B.pierce(r.c, mat, eff, v, r.c.v0);
    if (vOut < 60) {
      r.sStop = sIn; r.stopMat = mat; r.stopNx = _rh.nx; r.stopNy = _rh.ny; r.stopNz = _rh.nz; r.ric = ric;
      ARMS.stoppedBy[mat] = (ARMS.stoppedBy[mat] || 0) + 1;
      return;
    }
    ARMS.pens++;
    const k = vOut / Math.max(1, v);
    addLayer(r, sIn + thick, k);
    if (layers === 0) { r.pierceX = sIn; r.pierceOut = sIn + thick; r.pierceMat = mat; }
    s = sIn + thick + 0.02;
    layers++;
  }
  if (sGround < r.sEnd) {
    r.sStop = sGround; r.stopMat = groundMatAt();
    r.stopNx = 0; r.stopNy = 1; r.stopNz = 0;
    // the ground's grazing angle is the round's descent
    const sinG = Math.min(1, Math.abs(r.dy) + 0.004 * (sGround - r.sT > 0 ? (sGround - r.sT) / 50 : 0));
    r.ric = CBZ.ballistics.ricochet(r.stopMat, sinG, lcg);
  }
}
// first point along the line under the ground (3 m steps, refined)
function groundHit(r, s0, s1) {
  const g = MAP.groundAt;
  const step = Math.max(2.5, (s1 - s0) / 120);
  let prev = s0;
  for (let s = s0; s <= s1; s += step) {
    const x = r.ox + r.dx * s, z = r.oz + r.dz * s;
    if (roundY(r, s) <= g(x, z) + 0.02) {
      // bisect once between the last clear sample and this one
      let a = prev, b = s;
      for (let k = 0; k < 4; k++) {
        const mid = (a + b) * 0.5;
        if (roundY(r, mid) <= g(r.ox + r.dx * mid, r.oz + r.dz * mid) + 0.02) b = mid; else a = mid;
      }
      return b;
    }
    prev = s;
  }
  return Infinity;
}

/* ---- the bodies the line passes ---- */
const _rCand = [], _fineQ = [];
let _stamp = 1;
const _bTr = { z: [], n: 0 }, _wr = {};
const PLAN_HULL = [{ name: "torso", f0: -1, f1: 1, r0: -1, r1: 1, y0: 0, y1: 1, kind: "outer" }];
function armsAnatomy(u) {
  if (u._anat) return u._anat;
  const id = u.beast ? (u.species && (u.species.id || u.spId)) || u.spId || "lion" : "men";
  u._anat = CBZ.ballistics.anatomyOf(id, u);
  return u._anat;
}
/* the line through one body: fills _bTr with the zones it crosses (entry and
   exit in metres from the muzzle). false = it passes clear. */
function traceBody(u, r, s0) {
  const B = CBZ.ballistics;
  // the line from s0, in the body's own frame
  const qx = r.ox + r.dx * s0 - u.pos.x, qy = r.oy + r.dy * s0 - u.pos.y, qz = r.oz + r.dz * s0 - u.pos.z;
  let fx, fz, plan, sf = 1, sr = 1, sy = 1, f0 = 0, y0 = 0;
  if (u.vehicle) {
    fx = Math.sin(u.h || 0); fz = Math.cos(u.h || 0);
    plan = PLAN_HULL; sf = u.vlen || 3; sr = u.vwid || 1.5; sy = u.vheight || 2.4;
  } else if (u.beast) {
    if (!u.bodyL) return false;
    fx = Math.cos(u.heading || 0); fz = Math.sin(u.heading || 0);
    plan = armsAnatomy(u).plan === "fish" ? B.FISH : B.QUAD;
    sf = u.bodyL; sr = u.bodyW; sy = u.bodyH; f0 = u.bodyX0 || 0; y0 = u.bodyY0 || 0;
  } else {
    fx = Math.sin(u.yaw || 0); fz = Math.cos(u.yaw || 0);
    plan = B.MAN[u.stance === "prone" ? "prone" : u.stance === "crouch" ? "crouch" : "stand"];
  }
  const rx = -fz, rz = fx;                         // its right
  const of = qx * fx + qz * fz - f0, orr = qx * rx + qz * rz, oy = qy - y0;
  const df = r.dx * fx + r.dz * fz, dr = r.dx * rx + r.dz * rz, dy = r.dy;
  if (!B.traceZones(plan, of, orr, oy, df, dr, dy, sf, sr, sy, _bTr)) return false;
  let outer = false;
  for (let i = 0; i < _bTr.n; i++) { _bTr.z[i].a += s0; _bTr.z[i].b += s0; if (_bTr.z[i].kind === "outer") outer = true; }
  return outer;
}
// everyone near the line between two distances along it, once each
function gatherBodies(r, s0, s1, out) {
  out.length = 0;
  _stamp++;
  const step = 4.5;
  for (let s = Math.max(0.5, s0); s <= s1 + 0.01; s += step) {
    const x = r.ox + r.dx * s, z = r.oz + r.dz * s;
    const a = fineNear(x, z, 3.2, _fineQ);
    for (let i = 0; i < a.length; i++) {
      const u = a[i];
      if (u._rs === _stamp) continue;
      u._rs = _stamp;
      if (u.dead || u.fled || u === r.by) continue;
      out.push(u);
    }
  }
  if (r.tgt && r.tgt._rs !== _stamp && !r.tgt.dead && !r.tgt.fled) { r.tgt._rs = _stamp; out.push(r.tgt); }
  return out;
}
const _hits = [];
function resolveRound(r) {
  r.resolved = true;
  const B = CBZ.ballistics;
  // the window of the line where bodies are asked: from well short of the
  // target plane to where the world stopped the round (or 40 m past it)
  const s0 = Math.max(1, r.sT - 30);
  const s1 = Math.min(r.sStop, r.sT + 40);
  let stopAt = r.sStop, stoppedInBody = false;
  if (s1 > s0) {
    const cand = gatherBodies(r, s0, s1, _rCand);
    _hits.length = 0;
    for (let i = 0; i < cand.length; i++) {
      const u = cand[i];
      // cheap reject: too far off the line in the ground plane
      const ux = u.pos.x - r.ox, uz = u.pos.z - r.oz;
      const along = (ux * r.dx + uz * r.dz) / (r.hk * r.hk);
      const off = Math.abs(ux * r.dz - uz * r.dx) / r.hk;
      const reach = u.vehicle ? Math.hypot(u.vlen || 3, u.vwid || 1.5) : u.beast ? Math.max(u.bodyL || 2, u.bodyW || 1) * 0.6 + 0.4 : 1.25;
      if (off > reach) { armsNearMiss(r, u, along, off); continue; }
      if (!traceBody(u, r, Math.max(0, along - 12))) { armsNearMiss(r, u, along, off); continue; }
      // the first outer zone's entry
      let a = Infinity;
      for (let k = 0; k < _bTr.n; k++) if (_bTr.z[k].kind === "outer" && _bTr.z[k].a < a) a = _bTr.z[k].a;
      if (a >= stopAt) continue;
      _hits.push({ u: u, a: a });
    }
    _hits.sort(function (p, q) { return p.a - q.a; });
    for (let i = 0; i < _hits.length; i++) {
      const u = _hits[i].u;
      if (u.dead) continue;
      const a = _hits[i].a;
      const v = roundV(r, a);
      if (v < 60) { stopAt = a; stoppedInBody = true; break; }
      if (!traceBody(u, r, Math.max(0, a - 4))) continue;
      const vOut = armsHit(r, u, v);
      if (vOut < 60) { stopAt = a + 0.2; stoppedInBody = true; break; }
      // through and through: on into whoever is behind, slower
      addLayer(r, a + 0.3, vOut / v);
    }
  }
  r.sVis = stopAt;
  r.tEnd = r.t0 + B.tof(r.v0, r.k, stopAt * r.hk);
  if (!stoppedInBody && r.stopMat && stopAt < r.sEnd) armsImpact(r, stopAt);
  if (r.pierceX != null && r.pierceX < stopAt) armsPierceFx(r);
}
/* A ROUND THAT SNAPS PAST IS NOT NOTHING. Anybody of the other side the line
   passes inside the cartridge's suppression radius flinches: combat_iq's own
   suppress (his aim worsens, he wants cover) and this page's rattle meter
   (his nerve, his fold). A .50 rattles men eight metres off its line; a
   subsonic pistol round only the man it nearly hit. */
function armsNearMiss(r, u, along, off) {
  if (u.beast || u.vehicle || u.team === r.team) return;
  const s = along;                                 // metres along the line
  if (s < 3 || s > r.sStop + 1) return;
  const v = roundV(r, s);
  const R = CBZ.ballistics.suppressR(r.c, v);
  // the miss distance to his head and shoulders, not his feet
  const y = roundY(r, s) - (u.pos.y + (u.losY || 1.35));
  const miss = Math.hypot(off, y);
  if (miss > R) return;
  const k = 1 - miss / R;
  u.supp = Math.min(SUPP_CAP, (u.supp || 0) + SUPP_SNAP * (0.45 + 0.8 * k));
  if (CBZ.combatIQ && CBZ.combatIQ.suppress) CBZ.combatIQ.suppress(u, 0.4 + 0.4 * k);
}
/* THE HIT. _bTr holds the zones this line crosses in u. Returns the velocity
   the round leaves with (0 = it stayed in him). */
function armsHit(r, u, v) {
  const B = CBZ.ballistics;
  const by = r.by;
  // the first zone, so the armour layer (if a vest or a helmet covers it) is known
  let first = null;
  for (let k = 0; k < _bTr.n; k++) if (_bTr.z[k].kind === "outer" && (!first || _bTr.z[k].a < first.a)) first = _bTr.z[k];
  if (!first) return v;
  const isFrag = r.c === B.CART.frag;
  if (stats[r.team]) stats[r.team].hits++;
  if (by && !by.dead && !isFrag) by.hitsF++;
  if (by && !isFrag && by.wid) gunLedger(by.wid).hits++;
  ARMS.hits++;
  if (!isFrag) { const d = first.a * r.hk; ARMS.hitsAt[d < 25 ? 0 : d < 50 ? 1 : d < 100 ? 2 : d < 200 ? 3 : d < 400 ? 4 : 5]++; }
  const ex = r.ox + r.dx * first.a, ey = r.oy + r.dy * first.a, ez = r.oz + r.dz * first.a;
  if (u.vehicle) {
    // a hull: what the round defeats here is the armour's question
    const E = B.energy(r.c, v);
    hurtMan(u, Math.max(1, E / 80), { by: by, pen: B.penRHA(r.c, v, r.c.v0) });
    armsImpactAt(ex, ey, ez, -r.dx, -r.dy, -r.dz, "steel", r.c, v, true);
    return 0;
  }
  const an = armsAnatomy(u);
  const zone0 = B.HIT_ZONE[first.name] || "torso";
  const layer = CBZ.battleArmour && CBZ.battleArmour.layer ? CBZ.battleArmour.layer(u, zone0) : null;
  const res = B.wound(_bTr, an, r.c, v, r.c.v0, layer, _wr);
  if (!res.hit) return v;
  const H = B.harm(res, an, !u.beast);
  ARMS.organs[res.organ || "none"]++;
  if (res.plate) ARMS.plates++;
  const hpNow = u.hp;
  const dmg = H.kill ? hpNow + 1 : H.now * u.maxHp;
  const head = res.organ === "brain" || res.zone === "head";
  const cd2 = camDist2(u.pos);
  // what the body shows: the hole, the blood, the flinch
  if (cd2 < 90 * 90) {
    _rq2.set(ex, ey, ez);
    if (CBZ.bodyWound && u.char && !u.beast) { try { CBZ.bodyWound(u, _rq2, { head: head, cal: r.c.mm / 7, mm: r.c.mm, dir: { x: r.dx, y: r.dy, z: r.dz }, fromX: r.ox, fromZ: r.oz }); } catch (e) {} }
    const amt = Math.min(1.8, 0.35 + res.dep / 900);
    if (CBZ.goreImpact) {
      try { CBZ.goreImpact(ex, ey, ez, { dir: { x: r.dx, y: r.dy, z: r.dz }, amount: amt }); } catch (e) {}
      if (res.vOut > 60) {
        const s = res.exit;
        try { CBZ.goreImpact(r.ox + r.dx * s, r.oy + r.dy * s, r.oz + r.dz * s, { dir: { x: r.dx, y: r.dy, z: r.dz }, amount: amt * 1.3 }); } catch (e) {}
      }
    } else if (CBZ.bulletImpact && fxImpact < 12) {
      fxImpact++;
      // the spray off the far side of a through-and-through, else a puff at the hole
      const s = res.vOut > 60 ? res.exit : first.a;
      _rq2.set(r.ox + r.dx * s, r.oy + r.dy * s, r.oz + r.dz * s);
      CBZ.bulletImpact(_rq2, { x: r.dx, y: 0.3, z: r.dz }, { kind: "dust", color: 0x6e0a0a, power: Math.min(1.6, 0.5 + res.dep / 1200) });
    }
  }
  if (!u.beast && u.char && CBZ.soldier && !H.kill && H.now < 0.95 && cd2 < 150 * 150) {
    try { CBZ.soldier.hit(u.char, { sev: Math.min(1, H.now * 1.6 + 0.15), dirX: r.dx, dirZ: r.dz, zone: res.zone }); } catch (e) {}
  }
  if (dmg > 0) hurtMan(u, dmg, { by: by, headshot: head, zone: res.zone, organ: res.organ, bullet: true });
  // AND HE BLEEDS. Heart and lungs in minutes for a man, seconds for the
  // round's worth of damage; the bigger the animal the longer it runs on.
  if (!u.dead && H.bleed > 0) {
    u._bleed = (u._bleed || 0) + H.bleed * u.maxHp;
    u._bledBy = by;
    if (!u._bleeding) { u._bleeding = true; BLEEDERS.push(u); }
  }
  return res.vOut;
}
/* ---- the world, struck ---- */
function armsImpact(r, s) {
  const x = r.ox + r.dx * s, y = roundY(r, s), z = r.oz + r.dz * s;
  const v = roundV(r, s);
  armsImpactAt(x, y, z, r.stopNx, r.stopNy, r.stopNz, r.stopMat, r.c, v, false);
  // suppression where it lands: a burst into the lip of a fold keeps the heads behind it down
  const a = fineNear(x, z, 2.5, _fineQ);
  for (let i = 0; i < a.length; i++) {
    const u = a[i];
    if (u.dead || u.beast || u.vehicle || u.team === r.team) continue;
    const d = Math.hypot(u.pos.x - x, u.pos.z - z);
    if (d < 2.5) {
      u.supp = Math.min(SUPP_CAP, (u.supp || 0) + SUPP_SNAP * 0.6 * (1 - d / 2.5));
      if (CBZ.combatIQ && CBZ.combatIQ.suppress) CBZ.combatIQ.suppress(u, 0.4);
    }
  }
  if (r.ric > 0) armsRicochet(r, x, y, z, v * r.ric);
}
function armsImpactAt(x, y, z, nx, ny, nz, mat, c, v, onHull) {
  if (!CBZ.camera || fxImpact >= 14) return;
  const cam = CBZ.camera.position;
  const d2 = (x - cam.x) * (x - cam.x) + (y - cam.y) * (y - cam.y) + (z - cam.z) * (z - cam.z);
  if (d2 > 170 * 170) return;
  fxImpact++;
  const B = CBZ.ballistics;
  const E = B.energy(c, v);
  const power = Math.max(0.4, Math.min(2.6, Math.sqrt(E) / 30));
  const M = B.MAT[mat] || B.MAT.concrete;
  _rq2.set(x, y, z);
  const n = { x: nx, y: ny, z: nz };
  if (mat === "sand" || mat === "dirt" || mat === "snow" || mat === "water") {
    CBZ.bulletImpact(_rq2, n, { kind: "dust", color: groundColor(mat), power: power });
    // the puff that hangs where it went in
    if (CBZ.munitions && d2 < 120 * 120) {
      const col = groundColor(mat);
      const cr = ((col >> 16) & 255) / 255, cg = ((col >> 8) & 255) / 255, cb = (col & 255) / 255;
      try { CBZ.munitions.smoke(x, y + 0.1, z, 0, mat === "water" ? 2.2 : 0.9, 0, 0.08, 0.35 + power * 0.35, 0.9 + power * 0.4, mat === "water" ? 0.5 : 0.32, cr, cg, cb, { drag: 3, rise: 0.05, wind: 0.6 }); } catch (e) {}
    }
    return;
  }
  if (M.fx === "spark") CBZ.bulletImpact(_rq2, n, { kind: "spark", power: power });
  else if (M.fx === "wood") CBZ.bulletImpact(_rq2, n, { kind: "wood", power: power });
  else CBZ.bulletImpact(_rq2, n, { kind: "dust", surface: M.surf || "concrete", power: power });
  if (CBZ.bulletHole && !onHull && d2 < 90 * 90) { try { CBZ.bulletHole(_rq2, n, { mm: c.mm, noProp: true, surface: M.surf }); } catch (e) {} }
}
// the far side of something it went through: the exit spall
function armsPierceFx(r) {
  const s = r.pierceOut;
  const x = r.ox + r.dx * s, y = r.oy + r.dy * s, z = r.oz + r.dz * s;
  armsImpactAt(x, y, z, r.dx, 0.2, r.dz, r.pierceMat, r.c, roundV(r, s + 0.1), false);
}
/* A RICOCHET. Off the surface at the reflected angle, slower, tumbling,
   scattered a few degrees, and it can still hit somebody within its next
   fifty metres. Heard close (the whine) and seen when it is a tracer. */
function armsRicochet(r, x, y, z, v) {
  ARMS.rics++;
  const n = { x: r.stopNx, y: r.stopNy, z: r.stopNz };
  const dot = r.dx * n.x + r.dy * n.y + r.dz * n.z;
  let dx = r.dx - 2 * dot * n.x + (lcg() - 0.5) * 0.25;
  let dy = Math.abs(r.dy - 2 * dot * n.y) * 0.6 + lcg() * 0.08;
  let dz = r.dz - 2 * dot * n.z + (lcg() - 0.5) * 0.25;
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l; dy /= l; dz /= l;
  const q = RPOOL.pop() || {};
  q.by = r.by; q.team = r.team; q.tgt = null; q.A = r.A; q.c = r.c; q.v0 = v; q.k = r.k * 3; // a tumbling bullet sheds speed fast
  q.ox = x + dx * 0.05; q.oy = y + dy * 0.05; q.oz = z + dz * 0.05;
  q.dx = dx; q.dy = dy; q.dz = dz; q.hk = Math.hypot(dx, dz) || 1;
  q.sT = 50; q.sEnd = 50; q.sStop = 50; q.stopMat = null; q.ric = 0; q.pierceX = null;
  q.l1 = Infinity; q.l1k = 1; q.l2 = Infinity; q.l2k = 1;
  q.tracer = r.tracer; q.t0 = simT; q.resolved = false; q.dead = false;
  const sg = groundHit(q, 0.5, 50);
  if (sg < q.sStop) { q.sStop = sg; q.stopMat = groundMatAt(); }
  q.tRes = simT; q.sVis = q.sStop; q.tEnd = Infinity;
  resolveRound(q);
  ROUNDS.push(q);
  const cam = CBZ.camera && CBZ.camera.position;
  if (cam && fxSnap < 4) {
    const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    if (d < 45 && lcg() < 0.6) { fxSnap++; try { CBZ.sfx("ricochet", { dist: d, ghost: true, delay: d / 343 }); } catch (e) {} }
  }
  if (cam && (x - cam.x) * (x - cam.x) + (z - cam.z) * (z - cam.z) < 120 * 120) {
    CBZ.bulletImpact({ x: x, y: y, z: z }, n, { kind: "spark", power: 0.8 });
  }
}

/* ---- the rounds in the air, every sub-step ---- */
const BLEEDERS = [];
let velT = 0;
function stepRounds(sdt) {
  // THE MOVERS, measured: a shooter leads what he can see moving, and the
  // only honest velocity is the one the body actually had
  velT += sdt;
  if (velT >= 0.1) {
    for (let i = 0; i < men.length; i++) {
      const u = men[i];
      if (u._px != null) {
        const vx = (u.pos.x - u._px) / velT, vz = (u.pos.z - u._pz) / velT;
        u._vx = (u._vx || 0) * 0.4 + vx * 0.6; u._vz = (u._vz || 0) * 0.4 + vz * 0.6;
      }
      u._px = u.pos.x; u._pz = u.pos.z;
    }
    velT = 0;
  }
  if (!ROUNDS.length) return;
  const B = CBZ.ballistics;
  const cam = CBZ.camera && CBZ.camera.position;
  for (let i = ROUNDS.length - 1; i >= 0; i--) {
    const r = ROUNDS[i];
    if (!r.resolved && simT >= r.tRes) resolveRound(r);
    // a tracer burns along its real path at its real speed
    if (r.tracer && cam && CBZ.tracerStreak) {
      const t = simT - r.t0;
      let s = (r.k > 1e-4 ? (r.v0 / r.k) * (1 - Math.exp(-r.k * t)) : r.v0 * t) / r.hk;
      if (s > r.sVis) s = r.sVis;
      const v = roundV(r, s);
      const tail = Math.max(0, s - Math.min(14, v * 0.016));
      if (s > tail + 0.2) {
        const hx = r.ox + r.dx * s, hz = r.oz + r.dz * s;
        if ((hx - cam.x) * (hx - cam.x) + (hz - cam.z) * (hz - cam.z) < 900 * 900) {
          CBZ.tracerStreak(r.ox + r.dx * tail, roundY(r, tail), r.oz + r.dz * tail, hx, roundY(r, s), hz,
            { color: r.c.tracer || 0xff6a30, life: Math.max(0.03, sdt * 1.2), width: 0.016 });
        }
      }
    }
    if (r.resolved && simT >= r.tEnd) {
      ROUNDS[i] = ROUNDS[ROUNDS.length - 1]; ROUNDS.pop();
      r.by = null; r.tgt = null; r.A = null;
      if (RPOOL.length < 600) RPOOL.push(r);
    }
  }
}
/* BLEEDING OUT. Heart and lungs empty a man in seconds and a big animal in
   tens of them; a gut wound takes minutes. The blood loss is the damage the
   wound did not do on the spot, run off on the sim clock. Not through
   hurtMan: bleeding does not make a man flinch or turn on anybody. */
function stepBleed(sdt) {
  for (let i = BLEEDERS.length - 1; i >= 0; i--) {
    const u = BLEEDERS[i];
    if (u.dead || u.fled || over) { u._bleeding = false; BLEEDERS.splice(i, 1); continue; }
    u.hp -= u._bleed * sdt;
    if (u.hp <= 0) {
      u._bleeding = false; BLEEDERS.splice(i, 1);
      ARMS.bleedKills++;
      killMan(u, { by: u._bledBy || null, cause: "bleed" });
    }
  }
}

/* ============================================================ GRENADES
   A man with a mark behind cover (or a knot of them) inside throwing range
   pulls the pin and throws: the wind-up is the soldier rig's, the round
   leaves his hand at release on a real arc, bounces, rolls and goes off when
   its fuse says (4-5 s from the spoon). The blast core is studio.boom's
   (every body inside the lethal radius); past it the fragments fly, and a
   crest, a wall or lying flat is what saves you. */
const NADES = [];
let nadeGeo = null, nadeMat = null;
function nadeMesh() {
  if (!nadeGeo) {
    nadeGeo = new THREE.SphereGeometry(0.034, 8, 6);
    nadeGeo.scale(1, 1.25, 1);
    nadeMat = new THREE.MeshLambertMaterial({ color: 0x4b5536 });
  }
  const m = new THREE.Mesh(nadeGeo, nadeMat);
  m.castShadow = false;
  CBZ.scene.add(m);
  return m;
}
/* WHEN. A grenade is for the enemy a rifle cannot reach: he was seen a
   moment ago and is now behind the crest, the crates, the wall; or a knot of
   them bunched where one burst of fragments takes several. Not into a fight
   the rifle is already winning, not near one of your own, and one at a time
   per squad: the squad leader's "frag out", not a hailstorm. */
const NADE_SQ = {};
function armsGrenade(m, tgt, dist) {
  const A = armOf(m);
  if (A.nades <= 0 || simT < A.nadeT || m.vehicle || m.you || m.stance === "prone" || MAP.water) return false;
  if (dist < 9 || dist > 30 || tgt.vehicle || tgt.air || tgt.dead) return false;
  A.nadeT = simT + 1.5 + lcg() * 1.5;              // asked at most this often
  const sqKey = m.team + (m.sq || 0);
  if (simT < (NADE_SQ[sqKey] || 0)) return false;
  const behind = !m.sees && simT - A.seenT < 5;
  let crowd = 0, friends = 0;
  const a = fineNear(tgt.pos.x, tgt.pos.z, 9, _fineQ);
  for (let i = 0; i < a.length; i++) {
    const o = a[i];
    if (o.dead) continue;
    const d = Math.hypot(o.pos.x - tgt.pos.x, o.pos.z - tgt.pos.z);
    if (o.team === m.team && d < 11) friends++;
    else if (o.team !== m.team && d < 5) crowd++;
  }
  if (friends) return false;
  // ...or his squad asked for one into that cover (ai/squad.js pickNade)
  if (!behind && crowd < 4 && m.wantNade !== tgt) return false;
  if (lcg() > 0.4) return false;                   // not every man the instant it is possible
  // nothing over his head and in front of his face: a throw needs its arc
  if (CBZ.micro.segmentBlocked(m.pos.x, m.pos.y + 1.7, m.pos.z,
    m.pos.x + (tgt.pos.x - m.pos.x) * 0.25, m.pos.y + 4.5, m.pos.z + (tgt.pos.z - m.pos.z) * 0.25)) return false;
  A.nades--; A.nadeT = simT + 7 + lcg() * 4;
  NADE_SQ[sqKey] = simT + 9 + lcg() * 5;
  m.cool = Math.max(m.cool, 1.6);
  const B = CBZ.ballistics, G = B.GRENADE.m67;
  // where it is meant to land, and how good the arm is
  const err = B.gauss(lcg) * A.T.throwErr * dist, err2 = B.gauss(lcg) * A.T.throwErr * dist * 0.6;
  const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  const lx = tgt.pos.x + (tgt._vx || 0) * 1.6 + ux * err - uz * err2;
  const lz = tgt.pos.z + (tgt._vz || 0) * 1.6 + uz * err + ux * err2;
  const n = { by: m, team: m.team, state: "held", releaseAt: simT + 0.52, fuse: G.fuse + (lcg() - 0.5) * 2 * G.fuseJit,
    x: m.pos.x, y: m.pos.y + 1.6, z: m.pos.z, vx: 0, vy: 0, vz: 0, lx: lx, lz: lz, mesh: null, rest: false };
  NADES.push(n);
  ARMS.nades++;
  if (m.char && CBZ.soldier && camDist2(m.pos) < 160 * 160) { try { CBZ.soldier.throwGrenade(m.char, { dur: 1.25 }); } catch (e) {} }
  return true;
}
function stepGrenades(sdt) {
  const B = CBZ.ballistics;
  for (let i = NADES.length - 1; i >= 0; i--) {
    const n = NADES[i];
    n.fuse -= sdt;
    if (n.state === "held") {
      const m = n.by;
      if (m.dead || m.fled) {
        // he was hit with it in his hand: it falls where he fell
        n.state = "free"; n.x = m.pos.x; n.z = m.pos.z; n.y = m.pos.y + 0.6;
        n.vx = (lcg() - 0.5) * 1.5; n.vz = (lcg() - 0.5) * 1.5; n.vy = 0;
      } else if (simT >= n.releaseAt) {
        // released over the shoulder, on the solved arc
        const hx = m.pos.x + Math.sin(m.yaw) * 0.25, hz = m.pos.z + Math.cos(m.yaw) * 0.25, hy = m.pos.y + (m.eyeH || 1.52) + 0.25;
        const dx = n.lx - hx, dz = n.lz - hz, d = Math.hypot(dx, dz) || 1;
        const dy = MAP.groundAt(n.lx, n.lz) + 0.05 - hy;
        // a soldier lobs at about 40 degrees: the speed that lands it there,
        // capped at what an arm can do (then the low arc)
        const th = 0.7, c2 = Math.cos(th) * Math.cos(th), den = 2 * c2 * (d * Math.tan(th) - dy);
        let v = den > 0 ? Math.sqrt(9.81 * d * d / den) : B.GRENADE.m67.throwV;
        let el = th;
        if (!(v <= B.GRENADE.m67.throwV)) { v = B.GRENADE.m67.throwV; const sol = B.lob(v, d, dy, false); el = sol ? sol.elev : 0.78; }
        n.state = "free"; n.x = hx; n.y = hy; n.z = hz;
        n.vx = dx / d * v * Math.cos(el); n.vz = dz / d * v * Math.cos(el); n.vy = v * Math.sin(el);
        n.mesh = camDist2(m.pos) < 200 * 200 ? nadeMesh() : null;
      }
    }
    if (n.state === "free" && !n.rest) {
      n.vy -= 9.81 * sdt;
      const px = n.x, pz = n.z;
      n.x += n.vx * sdt; n.y += n.vy * sdt; n.z += n.vz * sdt;
      const gy = MAP.groundAt(n.x, n.z);
      // a wall: it bounces back off it
      if (CBZ.micro.segmentBlocked(px, n.y, pz, n.x, n.y, n.z)) { n.x = px; n.z = pz; n.vx *= -0.3; n.vz *= -0.3; }
      if (n.y <= gy + 0.04) {
        n.y = gy + 0.04;
        if (Math.abs(n.vy) > 1.2) { n.vy = -n.vy * 0.28; n.vx *= 0.45; n.vz *= 0.45; }
        else {
          n.vy = 0;
          const f = Math.exp(-4 * sdt);            // rolling to a stop in the sand
          n.vx *= f; n.vz *= f;
          if (Math.hypot(n.vx, n.vz) < 0.15) n.rest = true;
        }
      }
      if (n.mesh) { n.mesh.position.set(n.x, n.y, n.z); n.mesh.rotation.x += sdt * 9; }
    }
    if (n.fuse <= 0) {
      NADES.splice(i, 1);
      if (n.mesh) { CBZ.scene.remove(n.mesh); n.mesh = null; }
      if (n.state === "held") { n.x = n.by.pos.x; n.z = n.by.pos.z; n.y = n.by.pos.y + 1.2; }
      detonateGrenade(n);
    }
  }
}
function detonateGrenade(n) {
  const B = CBZ.ballistics, G = B.GRENADE.m67;
  const y = Math.max(n.y, MAP.groundAt(n.x, n.z) + 0.1);
  if (CBZ.studio && CBZ.studio.boom) {
    try { CBZ.studio.boom({ x: n.x, y: y + 0.2, z: n.z }, { radius: G.blast, power: G.power, structural: false, by: n.by }); } catch (e) {}
  }
  // THE FRAGMENTS. ~1,500 notched-wire splinters thrown out in a sphere; the
  // number that meets a body falls with the square of the distance and the
  // area it shows (lying flat is the drill for a reason). Each one is a tiny
  // fast round, traced from the burst through that body's real zones.
  const list = fineNear(n.x, n.z, G.wound + 1, []);
  const FR = B.CART.frag;
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    if (u.dead || u.fled || u.vehicle) continue;
    const cy = u.pos.y + (u.losY || 1) * 0.7;
    const d = Math.hypot(u.pos.x - n.x, cy - y, u.pos.z - n.z);
    if (d > G.wound || d < 0.3) continue;
    if (CBZ.micro.segmentBlocked(n.x, y + 0.25, n.z, u.pos.x, cy, u.pos.z)) continue;
    if (MAP.terrainLos && terrainBlocked(n.x, y + 0.25, n.z, u.pos.x, cy, u.pos.z)) continue;
    const area = u.beast ? (u.bodyL || 1.5) * (u.bodyH || 1) * 0.55 : u.stance === "prone" ? 0.12 : u.stance === "crouch" ? 0.45 : 0.7;
    const lambda = 1500 * area / (4 * Math.PI * d * d) * 0.5;
    // Poisson draw (Knuth), capped: nobody needs to count the eleventh splinter
    let k = 0, p = 1;
    const L = Math.exp(-Math.min(lambda, 12));
    do { k++; p *= lcg(); } while (p > L && k < 8);
    k--;
    for (let j = 0; j < k && !u.dead; j++) {
      // a splinter aimed at a random point of the body
      const tx = u.pos.x + (lcg() - 0.5) * (u.beast ? (u.bodyL || 1) * 0.8 : 0.4);
      const tz = u.pos.z + (lcg() - 0.5) * (u.beast ? (u.bodyW || 1) * 0.8 : 0.4);
      const ty = u.pos.y + lcg() * (u.beast ? (u.bodyH || 1) : (u.losY || 1.35) * 1.3);
      const fr = RPOOL.pop() || {};
      let dx = tx - n.x, dy = ty - (y + 0.25), dz = tz - n.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      fr.ox = n.x; fr.oy = y + 0.25; fr.oz = n.z; fr.dx = dx / l; fr.dy = dy / l; fr.dz = dz / l;
      fr.hk = Math.hypot(fr.dx, fr.dz) || 1; fr.c = FR; fr.v0 = FR.v0; fr.k = FR.dragK; fr.by = n.by; fr.team = n.team;
      fr.l1 = Infinity; fr.l1k = 1; fr.l2 = Infinity; fr.l2k = 1;
      const v = B.vAt(FR.v0, FR.dragK, l);
      if (v > 80 && traceBody(u, fr, 0)) { ARMS.frags++; armsHit(fr, u, v); }
      fr.by = null;
      if (RPOOL.length < 600) RPOOL.push(fr);
    }
  }
}
function liveGrenades() {
  const out = [];
  for (let i = 0; i < NADES.length; i++) if (NADES[i].state === "free") out.push({ x: NADES[i].x, z: NADES[i].z, t: NADES[i].fuse });
  return out;
}
ARMS.liveGrenades = liveGrenades;
ARMS.band = function (m) {
  const g = armOf(m).g;
  return { eff: g.eff, area: g.area, max: g.max, cls: g.cls };
};
ARMS.audit = function () {
  let bleeding = 0;
  for (let i = 0; i < BLEEDERS.length; i++) if (!BLEEDERS[i].dead) bleeding++;
  return { rounds: ARMS.rounds, inAir: ROUNDS.length, hits: ARMS.hits, pens: ARMS.pens, rics: ARMS.rics, jams: ARMS.jams,
    nades: ARMS.nades, frags: ARMS.frags, bleeding: bleeding, bleedKills: ARMS.bleedKills, snaps: ARMS.snaps, tracers: ARMS.tracers,
    organs: Object.assign({}, ARMS.organs), plates: ARMS.plates, stoppedBy: Object.assign({}, ARMS.stoppedBy),
    shotsAt: ARMS.shotsAt.slice(0, 6), hitsAt: ARMS.hitsAt.slice(0, 6), area: ARMS.area, why: Object.assign({}, ARMS.why) };
};

// where did the miss land: walk the line for the first collider, else the
// ground, and stamp the world (a vehicle's cannon round and YOUR misses)
const _mq = [];
function missImpact(from, to, cd2) {
  if (cd2 > 150 * 150) return;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1) return;
  const steps = Math.min(14, Math.ceil(len / 2.4));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t, y = from.y + dy * t, z = from.z + dz * t;
    const g = MAP.groundAt(x, z);
    if (y <= g + 0.05) {
      _v2.set(x, g + 0.03, z);
      CBZ.bulletImpact(_v2, { x: 0, y: 1, z: 0 }, { kind: "dust", color: groundColor(groundMatAt()), power: 0.8 });
      return;
    }
    const cols = CBZ.micro.queryColliders(x, z, 0.4, _mq);
    for (let c = 0; c < cols.length; c++) {
      const b = cols[c];
      if (!CBZ.micro.colliderContains(b, x, z)) continue;
      if (b.y0 != null && (y < b.y0 || y > b.y1)) continue;
      _v2.set(x, y, z);
      const nx = Math.abs(x - b.minX) < Math.abs(x - b.maxX) ? -1 : 1;
      const M = CBZ.ballistics && CBZ.ballistics.MAT[colMat(b)];
      CBZ.bulletImpact(_v2, { x: nx, y: 0.2, z: 0 }, M && M.fx === "wood" ? { kind: "wood", power: 1 } : M && M.fx === "spark" ? { kind: "spark", power: 1 } : { kind: "dust", surface: (M && M.surf) || "concrete", power: 1 });
      if (CBZ.bulletHole) CBZ.bulletHole(_v2, { x: nx, y: 0, z: 0 }, { mm: 8, noProp: true });
      return;
    }
  }
}

/* ============================================================ ROCKETS
   THE PG-7V (the RPG). The booster kicks it out of the tube at 115 m/s; the
   sustainer lights ~11 m out and burns to 295 m/s; gravity has it the whole
   way, so the gunner holds over at range (the sight's range marks), and past
   ~920 m it destroys itself. The tube's back is open: the backblast is a
   cone of fire and gas out to 30 m, lethal close up, and a gunner with a
   friend in it does not fire. THE 40 mm (the M32): a lob at 76 m/s that does
   not arm inside 18 m. Both detonate through studio.boom, which damages
   BOTH rosters and takes the building face with it outside the kill box.
   Vehicles' high-explosive rounds ride the same list on their old ballistic
   law (no motor). */
let PG7 = null;
function pg7Table() {
  if (PG7) return PG7;
  const R = CBZ.ballistics.ROCKET.pg7v;
  // fly one level, once, and remember distance -> time and drop
  const out = { d: [], t: [], drop: [] };
  let x = 0, y = 0, vx = R.v0, vy = 0, t = 0;
  const h = 0.005;
  while (t < R.life && x < 1000) {
    const acc = t > R.ignite && t < R.ignite + R.burn ? (R.vMax - R.v0) / R.burn : 0;
    const sp = Math.hypot(vx, vy) || 1;
    vx += vx / sp * acc * h; vy += vy / sp * acc * h - 9.81 * h;
    x += vx * h; y += vy * h; t += h;
    out.d.push(x); out.t.push(t); out.drop.push(-y);
  }
  PG7 = out;
  return out;
}
function pg7At(d) {
  const T = pg7Table();
  let lo = 0, hi = T.d.length - 1;
  if (d >= T.d[hi]) return { t: T.t[hi], drop: T.drop[hi] };
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T.d[mid] < d) lo = mid; else hi = mid; }
  return { t: T.t[hi], drop: T.drop[hi] };
}
// a friend in the cone behind the tube: hold the shot
function backblastBlocked(m, ux, uz) {
  const a = fineNear(m.pos.x - ux * 6, m.pos.z - uz * 6, 7, _fineQ);
  for (let i = 0; i < a.length; i++) {
    const o = a[i];
    if (o === m || o.dead || o.team !== m.team || o.vehicle) continue;
    const rx = o.pos.x - m.pos.x, rz = o.pos.z - m.pos.z;
    const back = -(rx * ux + rz * uz);
    if (back < 0.3 || back > 12) continue;
    if (Math.abs(rx * uz - rz * ux) < back * 0.6 + 0.6) return true;
  }
  return false;
}
function backblast(m, from, ux, uz) {
  const R = CBZ.ballistics.ROCKET.pg7v;
  // whoever stands in it anyway (an enemy at his back, a man who ran into it)
  const a = fineNear(m.pos.x - ux * 4, m.pos.z - uz * 4, 6, _fineQ);
  for (let i = 0; i < a.length; i++) {
    const o = a[i];
    if (o === m || o.dead || o.vehicle) continue;
    const rx = o.pos.x - m.pos.x, rz = o.pos.z - m.pos.z;
    const back = -(rx * ux + rz * uz);
    if (back < 0.3 || back > 10) continue;
    if (Math.abs(rx * uz - rz * ux) > back * 0.6 + 0.5) continue;
    const dmg = back < R.backKill ? o.maxHp * (1.1 - back / R.backKill * 0.6) : o.maxHp * 0.25 * (1 - (back - R.backKill) / 5);
    if (dmg > 0) hurtMan(o, dmg, { by: m, cause: "backblast", fromX: from.x, fromZ: from.z });
  }
  // and what everybody sees: the cloud thrown out of the back of the tube
  if (CBZ.munitions && camDist2(m.pos) < 220 * 220) {
    const bx = from.x - ux * 1.1, bz = from.z - uz * 1.1;
    try {
      for (let i = 0; i < 9; i++) {
        const sp = 6 + lcg() * 14, sx = (lcg() - 0.5) * 0.7;
        CBZ.munitions.smoke(bx, from.y - 0.05, bz, (-ux + sx * uz) * sp, 0.4 + lcg() * 1.2, (-uz - sx * ux) * sp,
          0.3, 1.8 + lcg() * 1.6, 2.2 + lcg() * 1.6, 0.42, 0.86, 0.84, 0.8, { drag: 2.2, rise: 0.3, wind: 1 });
      }
      CBZ.munitions.fire(bx, from.y, bz, -ux * 6, 0.4, -uz * 6, 0.25, 1.1, 0.16, 0.9, 1, 0.75, 0.4, { drag: 4 });
    } catch (e) {}
    CBZ.muzzleFlash({ x: bx, y: from.y, z: bz }, { scale: 2.2 });
  }
}
function fireRocket(m, tgt) {
  const B = CBZ.ballistics;
  const w = CBZ.weaponById(m.wid);
  const A = B ? armOf(m) : null;
  let from = null;
  if (camDist2(m.pos) < 150 * 150 && CBZ.actorMuzzle) from = CBZ.actorMuzzle(m, _muz);
  if (!from) from = _muz.set(m.pos.x + Math.sin(m.yaw) * 0.6, m.pos.y + (m.eyeH || 1.52) * 0.95, m.pos.z + Math.cos(m.yaw) * 0.6);
  // the aim point: the middle of a hull, the chest of a man, led
  const tx0 = tgt.pos.x, tz0 = tgt.pos.z;
  const ty0 = tgt.pos.y + (tgt.vehicle ? (tgt.vheight || 2) * 0.45 : (tgt.aimY || 1.1));
  const d0 = Math.hypot(tx0 - from.x, tz0 - from.z) || 1;
  const ux = (tx0 - from.x) / d0, uz = (tz0 - from.z) / d0;
  const isRpg = !!(A && A.g.cls === "rocket");
  if (isRpg && !m.you && backblastBlocked(m, ux, uz)) { m.cool = 0.4; return false; }
  if (A && !m.you && lcg() < A.g.malf * A.T.malfK) { armsJam(m, A); return false; }
  m.mag--; m.lastShotT = simT;
  stats[m.team].shots++;
  m.shotsF++; gunLedger(m.wid).shots++;
  shotsRing.push({ x: m.pos.x, z: m.pos.z, t: simT, m: m });
  if (shotsRing.length > 90) shotsRing.shift();
  let r;
  if (isRpg) {
    const R = B.ROCKET.pg7v;
    const fl = pg7At(d0);
    const tx = tx0 + (tgt._vx || 0) * fl.t * B.leadFactor(A.tier, lcg), tz = tz0 + (tgt._vz || 0) * fl.t * B.leadFactor(A.tier, lcg);
    const d = Math.hypot(tx - from.x, tz - from.z) || 1;
    const est = Math.max(5, d * (1 + B.gauss(lcg) * A.T.rangeErr));
    const holdUp = pg7At(est).drop + (ty0 - from.y);
    const sig = R.sigmaMil * A.T.hold * (m.stance === "crouch" ? 0.8 : 1) + ((m.speed || 0) > 0.5 ? 6 : 0);
    const ex = B.gauss(lcg) * sig / 1000, ey = B.gauss(lcg) * sig / 1000;
    let dx = (tx - from.x) / d, dz = (tz - from.z) / d;
    const el = Math.atan2(holdUp, d) + ey;
    const c = Math.cos(ex), s = Math.sin(ex);
    const rdx = dx * c - dz * s, rdz = dx * s + dz * c;
    const ce = Math.cos(el);
    r = { pos: V().copy(from), vel: new THREE.Vector3(rdx * ce * R.v0, Math.sin(el) * R.v0, rdz * ce * R.v0),
      grav: 9.81, t: 0, w: w, by: m, motor: R, life: R.life, travelled: 0, arm: 2.5,
      trail: CBZ.studio.trail({ length: 26, color: 0xd8c39a, opacity: 0.5, minStep: 1.6 }) };
    if (CBZ.munitions && CBZ.munitions.acquire) { try { r.mesh = CBZ.munitions.acquire("pg7"); } catch (e) { r.mesh = null; } }
    backblast(m, from, ux, uz);
  } else {
    // the 40 mm lob (and anything else that leaves on a plain arc)
    const v0 = (A && A.g.v0) || (w.projSpeed || 60);
    const tx = tx0, tz = tz0;
    const dd = Math.hypot(tx - from.x, tz - from.z) || 1;
    const groundY = MAP.groundAt(tx, tz) + 0.1;
    const sol = (B && B.lob(v0, dd, groundY - from.y, false)) || { elev: 0.6, t: dd / v0 };
    const err = A ? B.gauss(lcg) * A.T.hold * 4 / 1000 : 0;
    const el = sol.elev + (A ? B.gauss(lcg) * A.T.hold * 3 / 1000 : 0);
    const dx = (tx - from.x) / dd, dz = (tz - from.z) / dd;
    const c = Math.cos(err), s = Math.sin(err);
    r = { pos: V().copy(from), vel: new THREE.Vector3((dx * c - dz * s) * v0 * Math.cos(el), Math.sin(el) * v0, (dx * s + dz * c) * v0 * Math.cos(el)),
      grav: 9.81, t: 0, w: w, by: m, travelled: 0, arm: (A && A.g.arm) || 0, life: Math.max(7, sol.t * 1.6 + 2),
      trail: CBZ.studio.trail({ length: 14, color: 0xcfc8b8, opacity: 0.3, minStep: 1.6 }) };
  }
  rockets.push(r);
  const dCam = Math.sqrt(camDist2(m.pos));
  if (dCam < 600) {
    try { CBZ.sfx(w.sfx || "shoot_shotgun", { dist: dCam, ghost: true, pitch: w.sfxPitch || 1, volume: (w.sfxVol || 1) * 0.85, delay: dCam / 343 }); } catch (e) {}
    if (dCam < 300) CBZ.muzzleFlash(from, { scale: 1.6 });
  }
  return true;
}
function stepRockets(sdt) {
  fxTick();
  stepRounds(sdt);
  if (BLEEDERS.length) stepBleed(sdt);
  if (NADES.length) stepGrenades(sdt);
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.t += sdt;
    const M = r.motor;
    if (M && r.t > M.ignite && r.t < M.ignite + M.burn) {
      // the sustainer: thrust along the round's own axis
      const sp = r.vel.length() || 1, acc = (M.vMax - M.v0) / M.burn;
      r.vel.addScaledVector(r.vel, acc * sdt / sp);
      if (CBZ.munitions && camDist2(r.pos) < 260 * 260 && (r.t * 40 | 0) % 2 === 0) {
        try { CBZ.munitions.smoke(r.pos.x, r.pos.y, r.pos.z, 0, 0.3, 0, 0.12, 0.9, 1.6, 0.35, 0.86, 0.85, 0.82, { drag: 2, rise: 0.2 }); } catch (e) {}
      }
    }
    r.vel.y -= r.grav * sdt;
    /* A GUIDED ROUND (a laser-guided bomb: src/battle/vehicles.js vehRelease
       sets `homing`) steers its horizontal velocity so the rest of its fall
       ends on the mark, wherever the mark has walked to since release. */
    const hm = r.homing;
    if (hm && !hm.dead && hm.pos) {
      const g = MAP.groundAt(r.pos.x, r.pos.z), h = r.pos.y - g, vy = r.vel.y;
      const tl = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * r.grav * Math.max(0, h)))) / Math.max(1e-3, r.grav);
      if (tl > 0.3) {
        const k = Math.min(1, sdt * 1.5);
        r.vel.x += ((hm.pos.x - r.pos.x) / tl - r.vel.x) * k;
        r.vel.z += ((hm.pos.z - r.pos.z) / tl - r.vel.z) * k;
      }
    }
    const step = r.vel.length() * sdt;
    r.travelled = (r.travelled || 0) + step;
    r.pos.addScaledVector(r.vel, sdt);
    r.trail.push(r.pos);
    if (r.mesh) {
      r.mesh.position.copy(r.pos);
      _v2.copy(r.pos).add(r.vel);
      r.mesh.lookAt(_v2);
    }
    let boom = r.t > (r.life || 7) || r.pos.y <= MAP.groundAt(r.pos.x, r.pos.z) + 0.25;
    if (!boom) {
      const cols = CBZ.micro.queryColliders(r.pos.x, r.pos.z, 0.5, _mq);
      for (let c = 0; c < cols.length; c++) {
        const b = cols[c];
        if (!CBZ.micro.colliderContains(b, r.pos.x, r.pos.z)) continue;
        if (b.y0 != null && (r.pos.y < b.y0 || r.pos.y > b.y1)) continue;
        boom = true; break;
      }
    }
    // a direct hit on a body: the round's own point inside its box
    if (!boom && r.motor) {
      const a = fineNear(r.pos.x, r.pos.z, 2.5, _fineQ);
      for (let k = 0; k < a.length && !boom; k++) {
        const u = a[k];
        if (u === r.by || u.dead || u.fled) continue;
        const dx = r.pos.x - u.pos.x, dz = r.pos.z - u.pos.z, dy = r.pos.y - u.pos.y;
        if (u.vehicle) {
          const h = u.h || 0, f = dx * Math.sin(h) + dz * Math.cos(h), s = dx * Math.cos(h) - dz * Math.sin(h);
          if (Math.abs(f) < (u.vlen || 3) && Math.abs(s) < (u.vwid || 1.5) && dy > -0.2 && dy < (u.vheight || 2.4)) boom = true;
        } else if (Math.hypot(dx, dz) < (u.beast ? Math.max(0.4, (u.bodyW || 1) * 0.5) : 0.35) && dy > 0 && dy < (u.beast ? (u.bodyH || 1.2) : (u.eyeH || 1.52) + 0.25)) boom = true;
      }
    }
    if (boom) {
      r.trail.dispose();
      rockets.splice(i, 1);
      if (r.mesh && CBZ.munitions && CBZ.munitions.release) { try { CBZ.munitions.release(r.mesh); } catch (e) {} r.mesh = null; }
      // the 40 mm has not armed inside its arming distance: it thuds, it does not go off
      if (r.arm && r.travelled < r.arm) {
        if (camDist2(r.pos) < 150 * 150) CBZ.bulletImpact({ x: r.pos.x, y: MAP.groundAt(r.pos.x, r.pos.z) + 0.05, z: r.pos.z }, { x: 0, y: 1, z: 0 }, { kind: "dust", color: groundColor(groundMatAt()), power: 1.6 });
        continue;
      }
      CBZ.studio.boom({ x: r.pos.x, y: Math.max(r.pos.y, MAP.groundAt(r.pos.x, r.pos.z) + 0.6), z: r.pos.z }, {
        radius: r.w.blastRadius || 13, power: (r.w.blastPower || 1.9) * 0.55,
        structural: MAP.id !== "arena" && spawnTotal < 700,
        // THE MAN WHO FIRED IT: a launcher crew's kills are credited to it
        by: r.by,
      });
    }
  }
}
