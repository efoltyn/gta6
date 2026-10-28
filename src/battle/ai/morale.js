"use strict";
/* src/battle/ai/morale.js — NPC War: MORALE + STANCE + HULL DOWN.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* set in onBoot below (they need THREE / the raised world) */
let MO, MK, SUPP_CAP, SUPP_HIT, SUPP_SNAP, SUPP_MATE, SUPP_DECAY, RALLY_BAND, FLEE_GAPS, BREAK_GRACE, ARMY;

CBZ.npcwar.onBoot(function () {
  /* ============================================================ MORALE
     OWNER: "the idea is smart but the logic is dumb, it isn't fun." MEASURED:
     30 v 30 riflemen on the dunes was two blobs standing in the open trading
     fire until one side was dead to the last man, ~25 s, no arc. An army that
     fights to the last man makes head count the only variable, and a fight
     with no one who can lose their nerve has no moment where it TURNS.

     Ported from src/warlord/battle.js's morale (moraleFrom / updateMorale /
     nerve per training), adapted to this page's single-man layer:

     ARMY MORALE (updateMorale, on updateCOM's 0.6 s tick) is
       1 - lost*1.5 + theirLost*0.5 - routingFrac*0.35 - shock
     where `lost` is a POWER fraction — each man weighs his training x his
     gun, and a wounded man counts part-standing — so losing veterans or the
     launcher crew hurts more than losing recruits; `shock` is the recent
     casualties (each death adds ~1.8x his share of the army, decaying over
     ~7 s), which is what makes a sudden volley land harder than the same
     losses spread over a minute. Men watching men run is the cascade term.

     A MAN breaks when (army morale - his own rattle - his own wounds) falls
     under his NERVE, which is combat_iq's ROLE[].nerve column for his
     training (civ 0.62 .. swat 0.16) plus a seeded +-0.06: a civilian goes
     early, a soldier holds until the army is genuinely losing.

     A broken man stops firing and runs — away from the enemy's fighting
     centre and toward his own start edge. He is still a target. He rallies
     when the army steadies (with hysteresis), or turns to fight when he is
     CORNERED (no ground gained for 4.5 s, or an enemy on top of him). If he
     gets 2.2x the start gap from the enemy he has FLED: out of the fight,
     not dead, spliced out of the roster and counted on ARMY.fled.

     An army with half its standing men routing has BROKEN ("rout" event);
     an army with no man left fighting for BREAK_GRACE seconds has LOST
     (inFight(), read by frame()'s win check). Beasts have their own logic
     (thinkBeast's own flight rule) and are never moved by any of this. */
  /* ONE MORALE. The formula, the constants, the nerve column and the latched
     break/rally live in systems/brain.js (CBZ.brain.morale — the same module
     src/warlord/battle.js now calls); this page keeps only what is its own:
     who counts (the roster walk, the fled splice), the run, the cornered last
     stand and the war events. The constants are the brain's, aliased: */
  MO = CBZ.brain.morale,
    MK = MO.K;
  // what a man is worth to his army's nerve: training (a veteran's death is
  // felt more than a recruit's) and the gun he carries — MK.TIER_W
  SUPP_CAP = MK.SUPP_CAP;       // the rattle meter's ceiling (1.2)
  SUPP_HIT = MK.SUPP_HIT;       // a round that lands (0.4)
  SUPP_SNAP = MK.SUPP_SNAP;     // a round that snaps within ~2 m (0.26, scaled by how close)
  SUPP_MATE = MK.SUPP_MATE;     // a mate dropping within 7 m of you (0.22)
  SUPP_DECAY = MK.SUPP_DECAY;   // per second: ~4 s from pinned to composed (0.28)
  RALLY_BAND = MK.RALLY_BAND;   // back over nerve by this much to rally (0.16)
  FLEE_GAPS = MK.FLEE_GAPS;     // routed this many start gaps from the enemy = fled (2.2)
  BREAK_GRACE = MK.BREAK_GRACE; // s with nobody fighting before a broken army LOSES (5)
});
// combat_iq's ROLE[].nerve for his training, plus a seeded +-0.06
function nerveFor(tier, i) { return MO.nerveFor(tier, i); }
function manWeight(m) {
  if (m.vehicle) return m._w;              // a tank lost is felt like a squad lost
  if (m.beast) return Math.max(0.5, (m.maxHp || 100) / 100);
  let w = MK.TIER_W[m.tier] || 1;
  if (m.launcher) w *= 1.4;
  else if (m.wid === "sniper" || m.wid === "lmg") w *= 1.15;
  return w;
}
function armyRec() {
  return { p0: 0, pNow: 0, men0: 0, morale: 1, shock: 0, alive: 0, routing: 0,
    fled: 0, broken: false, noFightT: 0, lastman: false, beasts: 0, down: 0 };
}
CBZ.npcwar.onBoot(function () {
  ARMY = { red: armyRec(), blue: armyRec() };
});
const fledMen = [];
let moraleT = -1;
/* can the battle camera see this runner? (this page has no player body and
   no systems/leave.js, whose contract measures from a player: it is the
   camera's own frustum and distance). Past FLED_SIGHT_R he is a few pixels. */
const FLED_SIGHT_R = 260, FLED_IN_SIGHT_MAX = 40;
let _fledFr = null, _fledPm = null, _fledSp = null;
function runnerInSight(m) {
  const cam = CBZ.camera;
  if (!cam || !cam.projectionMatrix || !m.pos || typeof THREE === "undefined") return false;
  const c = cam.position, dx = m.pos.x - c.x, dz = m.pos.z - c.z;
  if (dx * dx + dz * dz > FLED_SIGHT_R * FLED_SIGHT_R) return false;
  if (!_fledFr) { _fledFr = new THREE.Frustum(); _fledPm = new THREE.Matrix4(); _fledSp = new THREE.Sphere(); }
  cam.updateMatrixWorld();
  _fledPm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  _fledFr.setFromProjectionMatrix(_fledPm);
  _fledSp.center.set(m.pos.x, (m.pos.y || 0) + 0.9, m.pos.z); _fledSp.radius = 1.2;
  return _fledFr.intersectsSphere(_fledSp);
}
function emitWar(kind, data) {
  try { if (typeof warEvent === "function") warEvent(kind, data); } catch (e) {}
}
function resetArmies() {
  ARMY.red = armyRec(); ARMY.blue = armyRec();
  for (let i = 0; i < fledMen.length; i++) {
    const g = fledMen[i].group;
    if (g) { try { STUDIO.drop(g); } catch (e) {} }
  }
  fledMen.length = 0;
  moraleT = -1;
  if (typeof tacReset === "function") tacReset();      // the squads of the last war (ai/squad.js)
}
const _ao = { fearless: false };
function _armyOpts(fearless) { _ao.fearless = !!fearless; return _ao; }
function updateMorale() {
  /* A NEW ROSTER IS A NEW WAR. restage() and begin() rebuild `men`
     without telling this section; a roster with no man this tick has
     ever counted, while the ledger says it has, is a fresh one. */
  let counted = 0;
  for (let i = 0; i < men.length; i++) if (men[i]._mc) { counted = 1; break; }
  if (!counted && men.length && !(MASS.on && MASS.rows) && (ARMY.red.p0 > 0 || ARMY.blue.p0 > 0)) resetArmies();
  const dt = moraleT < 0 ? 0 : Math.max(0, Math.min(2, simT - moraleT));
  moraleT = simT;
  const R = ARMY.red, B = ARMY.blue;
  R.alive = B.alive = R.routing = B.routing = R.beasts = B.beasts = R.down = B.down = 0;
  R.hulls = B.hulls = R.tubes = B.tubes = 0;
  R.pNow = B.pNow = 0;
  for (let i = men.length - 1; i >= 0; i--) {
    const m = men[i];
    const A = ARMY[m.team];
    if (!A) continue;
    if (!m._mc) { m._mc = 1; m._mw = manWeight(m); A.p0 += m._mw; A.men0++; }
    if (m.dead) continue;
    if (m.fled) {
      // HE RUNS OUT OF SIGHT FIRST. Counted fled at once (the war's sums),
      // but a runner the camera can still see keeps running (routCheck goes
      // on steering him away) and leaves the field only once he is off the
      // screen or far; before this he blinked out mid-stride in view.
      if (!m._fledCounted) { m._fledCounted = true; A.fled++; m._fledAt = performance.now() / 1000; }
      if (m.group && !m.surrendered && runnerInSight(m) && performance.now() / 1000 - m._fledAt < FLED_IN_SIGHT_MAX) continue;
      // OFF THE FIELD: out of every loop that walks `men`, so the grid, the
      // camera and the HUD forget him without each learning a new flag
      men.splice(i, 1);
      fledMen.push(m);
      if (m.group && !m.surrendered) m.group.visible = false;   // a prisoner stays where he knelt
      if (m.ordTgt) {
        m.ordTgt.alive = false;
        if (CBZ.ordnance && CBZ.ordnance.removeTarget) { try { CBZ.ordnance.removeTarget(m.ordTgt); } catch (e) {} }
        m.ordTgt = null;
      }
      continue;
    }
    /* A MAN ON THE GROUND (ai/squad.js: wounded, down) is out of the fight:
       no power, and not one of the standing the break arithmetic counts —
       but not a runner either (counting him as one too was the wounded
       counted twice, and armies broke on their casualty lists) */
    if (m.downed) { A.down++; continue; }
    A.alive++;
    if (m.vehicle) A.hulls++;
    else if (m.launcher) A.tubes++;
    if (m.beast || m.vehicle) A.beasts++;   // machines and animals do not do the arithmetic
    if (m.routed) A.routing++;
    const hf = Math.max(0, Math.min(1, m.hp / (m.maxHp || 1)));
    A.pNow += m._mw * (0.45 + 0.55 * hf);
  }
  if (MASS.on) MASS.armies();             // a tiered battle: the army is every row
  ["red", "blue"].forEach(function (t) {
    const A = ARMY[t], F = ARMY[t === "red" ? "blue" : "red"];
    /* brain.morale.armyStep: shock decays over ~7 s, then
       1 - lost*1.5 + theirLost*0.5 - routingFrac*0.35 - shock, and THE
       BREAK (half routing), latched, and the rally if it genuinely comes
       back (under a quarter). An army of animals does not do arithmetic
       about its chances (fearless). */
    /* NO ANSWER TO IT: riflemen facing armour with no launcher among them
       take no heart from their numbers (brain.morale's odds term), because
       their numbers cannot hurt it. */
    A.noAnswer = F.hulls > 0 && A.hulls === 0 && A.tubes === 0;
    const ev = MO.armyStep(A, F, dt, _armyOpts(bench || (A.alive && A.beasts === A.alive)));
    if (ev) emitWar(ev, { team: t });
    // nobody left fighting: the clock the win check reads
    if (A.alive + (A.down || 0) > 0 && A.alive - A.routing <= 0 && spawnQueue.length === 0) A.noFightT += dt;
    else A.noFightT = 0;
  });
}
/* HOW MANY MEN THIS ARMY STILL HAS IN THE FIGHT, for frame()'s win check:
   the living, unless every one of them has been running for BREAK_GRACE
   seconds — a broken army with nobody left fighting has lost. */
function inFight(team) {
  if (MASS.on) return MASS.inFight(team);
  let alive = 0, fighting = 0;
  for (let i = 0; i < men.length; i++) {
    const m = men[i];
    if (m.team !== team || m.dead || m.fled) continue;
    alive++;
    if (!m.routed && !m.downed) fighting++;
  }
  // asked live, so a stale clock from a restaged war can never end this one
  const A = ARMY[team];
  if (!fighting && alive && A && A.noFightT >= BREAK_GRACE) return 0;
  return alive;
}
// the death's weight on the living: a jolt to the whole army, a harder one
// to whoever was standing next to him, and the last man is announced
const _mates = [];
function moraleOnDeath(m, aliveMine) {
  const A = ARMY[m.team];
  if (!A) return;
  if (m._mc && !m.beast) MO.deathShock(A, m._mw || 1);      // ~1.8x his share of the army
  if (!m.beast) rattleMates(m);
  if (!A.lastman && aliveMine === 1 && spawnCount[m.team] >= 5 && spawnQueue.length === 0) {
    for (let i = 0; i < men.length; i++) {
      const o = men[i];
      if (o.team === m.team && !o.dead && !o.fled) {
        A.lastman = true;
        emitWar("lastman", { team: m.team, id: o.id });
        break;
      }
    }
  }
}
/* A MAN DROPPING BESIDE YOU (dead, or down screaming: ai/squad.js) rattles
   everyone within 7 m. SAFETY IN NUMBERS: in a crowd of thirty each knows the
   next blow is one in thirty his, so past four mates the rattle is shared
   out (sqrt). Measured before: 50 civilians round one gorilla, every drop
   0.22 to everyone within 7 m, the crowd at the 1.2 cap after five, and 40
   of 49 broke in one second. A section of eight is barely touched. */
function rattleMates(m) {
  const a = fineNear(m.pos.x, m.pos.z, 7, _mates);
  let n = 0;
  for (let i = 0; i < a.length; i++) { const o = a[i]; if (o !== m && !o.dead && o.team === m.team && !o.beast) n++; }
  const k = SUPP_MATE * Math.sqrt(Math.min(1, 4 / Math.max(1, n)));
  for (let i = 0; i < a.length; i++) {
    const o = a[i];
    if (o === m || o.dead || o.team !== m.team || o.beast) continue;
    o.supp = Math.min(SUPP_CAP, (o.supp || 0) + k);
  }
}
// his own morale: the army's, less how rattled and how hurt he is
function manMorale(m) {
  const A = ARMY[m.team];
  const hf = Math.max(0, Math.min(1, m.hp / (m.maxHp || 1)));
  // ...and his squad's: a leader dropped beside him shakes him more than the army's sums do
  return MO.manMorale(A ? A.morale : 1, m.supp, hf) - (m.sqd ? m.sqd.shock * 0.5 : 0);
}
function foeCentre(m) { return teamCOM[m.team === "red" ? "blue" : "red"]; }
/* THE BREAK, THE RUN, THE RALLY — one man, on his think tick. Returns true
   while he is running (think() then owns nothing else about him). */
const _near = [];
function routCheck(m, dt) {
  if (m.beast || bench || over) return false;
  if (m.rallyT > 0) m.rallyT -= dt;
  const eff = manMorale(m);
  const foe = foeCentre(m);
  const fd = Math.hypot(m.pos.x - foe.x, m.pos.z - foe.z);
  if (!m.routed) {
    if (m.rallyT > 0 || !(eff < m.nerve)) return false;
    m.routed = true; m.routT = 0; m.routBest = fd; m.routStall = 0;
    m.tgt = null; m.sees = false; m.hull = null; m.stepAsideT = 0;
    setStance(m, "stand");
  } else {
    m.routT += dt;
    if (fd > m.routBest + 0.6) { m.routBest = fd; m.routStall = 0; }
    else m.routStall += dt;
    // CORNERED: no ground gained, or an enemy close enough to touch — he
    // turns and fights, and will not break again for a while (the last stand)
    let cornered = m.routStall > 4.5;
    if (!cornered && m.routT > 1.5) {
      const a = fineNear(m.pos.x, m.pos.z, 4.5, _near);
      for (let i = 0; i < a.length; i++) {
        if (a[i].team !== m.team && !a[i].dead && !a[i].routed) { cornered = true; m.tgt = a[i]; break; }
      }
    }
    if (cornered) {
      // ...or he puts his hands up: by his training, his wounds and the odds (ai/squad.js)
      if (typeof trySurrender === "function" && trySurrender(m)) return true;
      m.routed = false; m.rallyT = 12; m.routStall = 0;
      return false;
    }
    // RALLY with hysteresis, once the rattle has worn off
    if (m.routT > 4 && eff > m.nerve + RALLY_BAND && m.supp < 0.3) {
      m.routed = false; m.rallyT = 6;
      return false;
    }
    // FLED: far enough that this war is no longer his (or he has outrun
    // it for most of a minute)
    // (he keeps running below: updateMorale lets him off the field once the
    // camera cannot see him)
    if (fd > FLEE_GAPS * (HOST.gap || 150) || m.routT > 45) m.fled = true;
  }
  // THE RUN: away from their fighting centre, leaning toward his own start
  // edge, with a man-stable lateral so a broken line fans out instead of
  // funnelling. No steerAroundWalls: its field descends TOWARD the enemy.
  // stepMan's wall-slide detour is what gets a runner round a corner.
  let ax = m.pos.x - foe.x, az = m.pos.z - foe.z;
  const al = Math.hypot(ax, az) || 1;
  ax /= al; az /= al;
  ax += (m.team === "red" ? -1 : 1) * 0.55;
  const bl = Math.hypot(ax, az) || 1;
  ax /= bl; az /= bl;
  const lat = (((m.i * 13) % 9) - 4) * 0.09;
  m.target.set(m.pos.x + (ax - az * lat) * 30, 0, m.pos.z + (az + ax * lat) * 30);
  m.slot = "rout";
  m.tgt = null; m.sees = false;
  return true;
}

/* ============================================================ STANCE
   A MAN IS A DIFFERENT SHAPE WHEN HE IS DOWN (ported from the warlord
   fork). eyeH is where he sees from, losY is what an enemy has to see to
   shoot him, aimY / headY are where a round arrives: dropping all four by
   a crouched man's real ratio (about 1.0 m of eye against 1.52) is what
   makes going down actually hide him behind a dune lip. And a crouched body
   is a smaller one — coverK is the hit-chance multiplier fireShot applies
   to rounds aimed at him (set each step in stepMan). */
// prone: flat on the ground, a head and a rifle (eye 0.38 m); rush: the low,
// fast run of a bound (ai/squad.js)
const STANCE_K = { stand: 1, crouch: 0.645, prone: 0.25, rush: 0.82 };
const CROUCH_HIT = 0.5;        // a kneeling man presents about half the target
const HULL_UP_HIT = 0.7;       // up over a crest, the sand still covers his legs
function setStance(m, st) {
  if (m.beast || m.stance === st || m.eyeH0 == null) return;
  m.stance = st;
  const k = STANCE_K[st] || 1;
  m.eyeH = m.eyeH0 * k;
  m.losY = m.losY0 * k;
  m.aimY = m.aimY0 * k;
  m.headY = m.headY0 * k;
}
// what the rig should show: the stance, plus combat_iq's box-cover slots
// (read by frame()'s animChar pass)
function crouchPose(m) {
  return m.stance === "crouch" || m.slot === "cover" || m.slot === "peek";
}
// "could he see him if he stood up" — a man crouched behind his fold is
// not blind, he is ducking; think() asks this so the duck does not read as
// lost contact and send him charging out of his own cover
function seesStanding(m, o) {
  if (m.stance === "stand" || !m.stance) return eyeLos(m, o);
  const e = m.eyeH;
  m.eyeH = m.eyeH0;
  const s = eyeLos(m, o);
  m.eyeH = e;
  return s;
}

/* ============================================================ HULL DOWN
   THE GROUND IS COVER (ported from the warlord fork's hullDown). On a map
   whose sand takes part in the sight lines (HOST.terrainLos), a man under
   fire looks for a reverse-slope position: somewhere a CROUCHED man is
   hidden from the threat by the crest but a STANDING one can see over it.
   Per bearing (fanned away from the threat) march out until the crouched
   ray first goes blocked, bisect onto the lip, step just behind it, and
   accept it only if standing there still has the shot. A hole with no shot
   out of it is not a position.

   COST: a search is <= 7 bearings x ~9 marched probes x one terrain ray.
   It runs only for a man who is RATTLED (or already in a fold), on a
   per-man clock of 2.5-4 s phased off his index, and under a global
   budget of HULL_RATE searches per sim-second — a 500 v 500 line cannot
   all probe on the same frame. */
const HULL_BEARINGS = [0, 0.6, -0.6, 1.25, -1.25, 1.9, -1.9];
const HULL_R0 = 2.5, HULL_R1 = 20, HULL_STEP = 2.2;
const HULL_CROUCH_EYE = 1.0, HULL_STAND_EYE = 1.55, HULL_BEHIND = 0.7;
const HULL_RATE = 60;          // searches per sim-second, whole field
let hullTokens = 20, hullTokT = 0, hullQ = 0, hullHit = 0;
// nb: how many of the bearings to try (a squad's post search asks the three
// nearest straight back; a rattled man's own search asks all seven)
function hullDown(x, z, tx, tz, nb) {
  const gA = HOST.groundAt;
  const ty = gA(tx, tz) + HULL_STAND_EYE;
  const away = Math.atan2(x - tx, z - tz);
  const dThreat = Math.hypot(x - tx, z - tz);
  hullQ++;
  let best = null, bs = 1e9;
  for (let ai = 0, an = Math.min(HULL_BEARINGS.length, nb || 99); ai < an; ai++) {
    const ang = away + HULL_BEARINGS[ai];
    const sa = Math.sin(ang), ca = Math.cos(ang);
    let lo = -1, hi = -1;
    for (let rad = HULL_R0; rad <= HULL_R1; rad += HULL_STEP) {
      const px = x + sa * rad, pz = z + ca * rad;
      if (terrainBlocked(tx, ty, tz, px, gA(px, pz) + HULL_CROUCH_EYE, pz, gA)) { hi = rad; break; }
      lo = rad;
    }
    if (hi < 0) continue;
    if (lo < 0) lo = Math.max(0.5, hi - HULL_STEP);
    for (let kk = 0; kk < 4; kk++) {
      const mid = (lo + hi) * 0.5;
      const px = x + sa * mid, pz = z + ca * mid;
      if (terrainBlocked(tx, ty, tz, px, gA(px, pz) + HULL_CROUCH_EYE, pz, gA)) hi = mid; else lo = mid;
    }
    for (let back = 0; back < 3; back++) {
      const rad = hi + HULL_BEHIND * (back ? back * 0.5 : 1);
      const px = x + sa * rad, pz = z + ca * rad;
      if (blockedAt(px, pz)) continue;
      const gy = gA(px, pz);
      if (!terrainBlocked(tx, ty, tz, px, gy + HULL_CROUCH_EYE, pz, gA)) continue;
      if (terrainBlocked(tx, ty, tz, px, gy + HULL_STAND_EYE, pz, gA)) continue;
      const walk = Math.hypot(px - x, pz - z);
      const closing = Math.max(0, dThreat - Math.hypot(px - tx, pz - tz));
      const score = walk + closing * 1.4 + Math.abs(HULL_BEARINGS[ai]) * 1.1;
      if (score < bs) { bs = score; best = { x: px, z: pz, d: walk }; }
      break;
    }
  }
  if (best) hullHit++;
  return best;
}
function hullFor(m, tgt) {
  if (m.hullT > simT) return m.hull;
  // the global budget, refilled on the sim clock
  if (simT > hullTokT) {
    hullTokens = Math.min(HULL_RATE * 0.5, hullTokens + (simT - hullTokT) * HULL_RATE);
    hullTokT = simT;
  }
  if (hullTokens < 1) { m.hullT = simT + 0.4 + (m.i % 7) * 0.05; return m.hull; }
  hullTokens--;
  m.hullT = simT + (m.hull ? 3.4 : 2.5) + (m.i % 9) * 0.07;
  const found = hullDown(m.pos.x, m.pos.z, tgt.pos.x, tgt.pos.z);
  if (!found) { m.hull = null; return null; }
  // STICKY: the fold he is in outbids a marginally nearer one
  if (m.hull) {
    const keep = Math.hypot(m.hull.x - m.pos.x, m.hull.z - m.pos.z);
    if (keep < found.d + 3) return m.hull;
  }
  m.hull = found;
  return found;
}
/* IN THE FOLD AND WORKING IT: down behind the lip (invisible to the
   enemy's eyeLos — not harder to hit, NOT THERE), up over it to shoot,
   down again to reload. Returns true while he is up. 3.2 m, because the
   anti-clump nudges his goal and stepMan stops him a metre short of it:
   a fold is a stretch of ground, not a coordinate. */
function workHull(m, sdt) {
  const d = Math.hypot(m.hull.x - m.pos.x, m.hull.z - m.pos.z);
  if (d > 3.2) { setStance(m, "stand"); return false; }
  if (m.reloadT > 0) { setStance(m, "crouch"); m.popT = Math.min(m.popT, 0.3); return false; }
  m.popT -= sdt;
  if (m.popT <= 0) {
    const up = m.stance === "crouch";
    m.popT = up ? (1.2 + (m.i % 7) * 0.14) : (1.1 + (m.i % 5) * 0.2);
    setStance(m, up ? "stand" : "crouch");
  }
  return m.stance === "stand";
}
