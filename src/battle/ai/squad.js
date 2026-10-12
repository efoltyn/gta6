"use strict";
/* src/battle/ai/squad.js — NPC War: SOLDIERS AND SQUADS, the page's half.
   The squad brain is src/battle/core/tactics.js (CBZ.battleTactics, page-
   free, the part Gang City's wars will run). This file is what NPC War
   hands it and what it does with the answer, man by man:

     the adapter      the page's world, sight, folds, odds and lens, as the
                      core's A (tacAdapter)
     the tick         every squad decides on its own staggered clock, every
                      man gets his LOD tier (tacticsStep, from frame())
     the man          squadThink(): his post, his slot, his mark, his
                      reflexes (an animal charging him, a grenade at his feet)
     the body         stanceStep(): stand / crouch / prone / the low rush,
                      the cover cycle (down behind it, up over it to shoot,
                      down to reload), pinned men stay down; soldierRig():
                      the same state as entities/soldier.js's ch.soldier
                      record (carry, stance, cover peek / lean / blind fire)
                      plus its verbs (reload, grenade throw, hit, dive)
     the wounded      a bad hit can put a man DOWN instead of dead: he
                      bleeds, crawls, and a mate drags him to cover; a
                      downed man nobody reaches can be taken prisoner
     the surrender    a broken man who is cornered may put his hands up
                      instead of fighting to the last (by training and odds)
     the grenades     thrown into cover, never onto a mate; the men where
                      one lands go flat or get clear
     the armour       paceVehicle: a tank does not run off from its infantry

   ?tac=old turns all of it off (the shape of every revert switch on this
   page): the march-column, combat_iq posture and the old stance rules.
   Every src/battle file shares ONE script scope. */

const TAC_OLD = Q.get("tac") === "old";
const TAC = { on: !TAC_OLD, at: -1, tierAt: -1, vehs: { red: [], blue: [] }, captives: [],
  A: null, home: null, lastTickT: -1 };
const SURRENDER_P = { civ: 0.85, thug: 0.6, pro: 0.42, elite: 0.26, swat: 0.18 };
function tacClock() {
  try { return typeof window.__tacClock === "function" ? window.__tacClock() : performance.now(); } catch (e) { return 0; }
}
function tacOut(o) { return !o || o.dead || o.fled || o.surrendered || o.downed; }

/* ============================================================ THE ADAPTER */
function tacAdapter() {
  if (TAC.A) return TAC.A;
  TAC.A = {
    now: function () { return simT; },
    rand: lcg, clock: tacClock,
    get host() { return HOST; },
    sees: eyeLos,
    fold: tacFold,
    near: function (x, z, r, out) { return fineNear(x, z, r, out); },
    enemyTeam: function (t) { return t === "red" ? "blue" : "red"; },
    // where a squad marches: its force's objective (Gang City), else the enemy's centre
    enemyCOM: function (t, S) { const m = S && S.men && S.men[0]; return m ? objectiveOf(m) : teamCOM[t === "red" ? "blue" : "red"]; },
    homeDir: tacHomeDir,
    order: squadOrderOf,
    hunting: function (t) { return !!HUNT[t]; },
    enemyBroken: function (t) { const F = ARMY[t === "red" ? "blue" : "red"]; return !!(F && F.broken); },
    odds: function (t) {
      const A = ARMY[t], F = ARMY[t === "red" ? "blue" : "red"];
      if (!A || !F || !(F.pNow > 0)) return 3;
      return Math.max(0.1, Math.min(6, (A.pNow || 0) / F.pNow));
    },
    camera: function () { return CBZ.camera ? CBZ.camera.position : null; },
    vehicles: function (t) { return TAC.vehs[t]; },
  };
  return TAC.A;
}
// rearward for a side: from the enemy's start to its own
function tacHomeDir(t) {
  if (!TAC.home) {
    const s = { red: { x: 0, z: 0, n: 0 }, blue: { x: 0, z: 0, n: 0 } };
    for (let i = 0; i < men.length; i++) {
      const m = men[i], h = m.home;
      if (!h || !s[m.team]) continue;
      s[m.team].x += h.x; s[m.team].z += h.z; s[m.team].n++;
    }
    if (!s.red.n || !s.blue.n) return { x: t === "red" ? -1 : 1, z: 0 };
    let dx = s.red.x / s.red.n - s.blue.x / s.blue.n, dz = s.red.z / s.red.n - s.blue.z / s.blue.n;
    const l = Math.hypot(dx, dz) || 1;
    TAC.home = { red: { x: dx / l, z: dz / l }, blue: { x: -dx / l, z: -dz / l } };
  }
  return TAC.home[t];
}
// the reverse-slope search (morale.js hullDown) under the same global budget
function tacFold(x, z, tx, tz) {
  if (!HOST.terrainLos) return null;
  if (simT > hullTokT) {
    hullTokens = Math.min(HULL_RATE * 0.5, hullTokens + (simT - hullTokT) * HULL_RATE);
    hullTokT = simT;
  }
  if (hullTokens < 1) return null;
  hullTokens--;
  return hullDown(x, z, tx, tz, 3);
}

/* ============================================================ THE TICK
   Once per sim sub-step from frame(): squads decide on their own staggered
   clocks (by the squad's tier), the vehicle lists refresh, grenades fly,
   the wounded bleed and the draggers pull. */
function tacticsStep(sdt) {
  if (!TAC.on || bench || over) return;
  const BT = CBZ.battleTactics;
  if (!BT) return;
  const A = tacAdapter();
  // the vehicle lists and the men's tiers, twice a second
  if (simT - TAC.at > 0.5) {
    TAC.at = simT;
    TAC.vehs.red.length = 0; TAC.vehs.blue.length = 0;
    for (let i = 0; i < men.length; i++) {
      const m = men[i];
      if (m.vehicle && !m.dead && !m.air && TAC.vehs[m.team]) TAC.vehs[m.team].push(m);
      else if (!m.vehicle && !m.beast && !m.dead) {
        m.aiTier = BT.tierOf(m, A);
        // the squad reads his grenades off the arms layer's own count (fire.js armOf)
        m.nades = m.launcher || m.fists || !m.armed ? 0 : (armOf(m).nades || 0);
      }
    }
  }
  // the squads
  ["red", "blue"].forEach(function (t) {
    const L = squads[t];
    for (let s = 0; s < L.length; s++) {
      const list = L[s];
      if (!list || !list.length) continue;
      const S = BT.make(t, s, list);
      if (simT < S.tickAt) continue;
      // the squad's tier is its best man's: a squad with anyone near the lens decides at full rate
      let tier = 2;
      for (let i = 0; i < list.length; i++) { const m = list[i]; if (!m.dead && m.aiTier != null && m.aiTier < tier) tier = m.aiTier; }
      S.tier = tier;
      S.tickAt = simT + BT.K.SQUAD_TICK[tier] * (0.85 + ((s * 7 + (t === "red" ? 0 : 3)) % 10) * 0.03);
      BT.tick(S, A);
    }
  });
  nadeWatch();
}

/* ============================================================ THE MAN
   Called from thinkMan once his mark is settled. Returns true when the
   squad brain has decided for him (slot + goal), false to fall back to the
   lone rifleman's logic (no squad, fists, a squad that is gone). */
function squadThink(m, thinkDt) {
  const S = m.sqd;
  if (!TAC.on || !S || S.task === "gone" || m.fists || S.men.indexOf(m) < 0) return false;
  const BT = CBZ.battleTactics;
  // a recommendation from the squad: its focus, if he can see it
  const f = m.focus;
  m.focus = null;
  if (f && !tacOut(f) && f !== m.tgt && (!BT.armoured(f) || m.launcher)) {
    if (eyeLos(m, f)) { m.tgt = f; m.losBadT = 0; }
  }
  // armour a rifle cannot hurt is not his mark while anything else is
  if (m.tgt && !m.launcher && BT.armoured(m.tgt)) {
    const o = pickTarget(m, SIGHT);
    m.tgt = o && !BT.armoured(o) ? o : null;
  }
  let tgt = m.tgt;
  if (tgt && tacOut(tgt)) { m.tgt = tgt = null; }
  m.sees = tgt ? seesStanding(m, tgt) : false;
  // combat_iq's per-man clocks (reaction, aim settle, its suppression) run on
  // the think that owns him: posture() used to tick them, the squad does now
  if (tgt && CBZ.combatIQ && CBZ.combatIQ.aimTick) CBZ.combatIQ.aimTick(m, tgt, thinkDt);
  if (tgt && !m.sees) {
    m.losBadT += thinkDt;
    /* THE NEAREST MAN IS OFTEN THE ONE IN DEAD GROUND. Looking down off a
       crest, the closest of them are under the brow and the ones further up
       the far slope are in plain view: a man with no line to his mark looks
       for one he can see (pickTarget asks the nearest few) before he keeps
       staring at a fold. */
    if (m.losBadT > 0.8) {
      const o = pickTarget(m, SIGHT);
      if (o && o !== tgt && !tacOut(o) && (!BT.armoured(o) || m.launcher) && eyeLos(m, o)) {
        m.tgt = tgt = o; m.sees = true; m.losBadT = 0;
      }
    }
    if (m.losBadT > 6) { m.tgt = tgt = null; m.losBadT = 0; }
  } else m.losBadT = 0;

  // ---- reflexes before orders
  if (m.panicT > simT) { panicGoal(m); return true; }
  if (m.nadeDiveT > simT) { m.slot = "dodge"; return true; }
  if (beastReflex(m, S)) return true;

  const task = m.task || S.task;
  // a grenade the squad asked him for: the arms layer throws it (fire.js
  // armsGrenade honours m.wantNade when it is his mark); the ask lapses
  if (m.wantNade) {
    const o = m.wantNade;
    if (!m.wantNadeT) m.wantNadeT = simT;
    if (tacOut(o) || Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z) > 34 || simT - m.wantNadeT > 6) { m.wantNade = null; m.wantNadeT = 0; }
    else if (m.tgt !== o) { m.tgt = o; tgt = o; }
  }
  if (task === "drag") return dragThink(m, S);
  // THE ROCKET MAN HUNTS ARMOUR: a launcher whose mark is a vehicle does not
  // sit on a post it cannot see the tank from. He works in toward a firing
  // spot inside his range, angling off the line (a side shot, out of the
  // turret's first arc), and stops and fires the moment he has it.
  if (m.launcher && tgt && tgt.vehicle && !tacOut(tgt) && task !== "pinned" && task !== "withdraw") {
    const dx = tgt.pos.x - m.pos.x, dz = tgt.pos.z - m.pos.z, d = Math.hypot(dx, dz) || 1;
    if (!m.sees || d > 125) {
      const side = (m.i & 1) ? 1 : -1, a = Math.atan2(dx, dz) + side * 0.45;
      const step = Math.max(6, Math.min(18, d - 70));
      m.target.set(m.pos.x + Math.sin(a) * step, 0, m.pos.z + Math.cos(a) * step);
      m.slot = "rush";
    } else { m.target.set(m.pos.x, 0, m.pos.z); m.slot = "fire"; }
    m.atPost = false; m.inCover = false;
    return true;
  }
  if (task === "march") { marchSlot(m, S); return true; }
  let p = m.post;
  if (!p) { marchSlot(m, S); return true; }
  /* A POST IN THE OPEN ON GROUND THAT HAS FOLDS: the man's own reverse-slope
     search (morale.js hullFor — per-man clock, global budget) finds the crest
     nearest his post, and he fights from behind it instead. This is what a
     held line on the dunes IS; the squad's own post search only has the
     budget for a couple of folds per assignment. */
  if (p.kind === "open" && HOST.terrainLos && tgt && !m.hunt &&
      (task === "hold" || task === "fight" || task === "overwatch")) {
    const hd = hullFor(m, tgt);
    if (hd && Math.hypot(hd.x - p.x, hd.z - p.z) < 12) {
      p = m.post = { x: hd.x, z: hd.z, px: hd.x, pz: hd.z, low: true, kind: "fold" };
    }
  }
  // the goal: his post (the peek spot is the cover cycle's, in stanceStep)
  let gx = p.x, gz = p.z;
  if (S.task === "fallback" && task === "overwatch") { gx = m.pos.x; gz = m.pos.z; }
  if (task === "pinned" && Math.hypot(gx - m.pos.x, gz - m.pos.z) > 7) { gx = m.pos.x; gz = m.pos.z; }
  m.target.set(gx, 0, gz);
  const d = Math.hypot(gx - m.pos.x, gz - m.pos.z);
  const atPost = d < 2.2;
  m.atPost = atPost;
  m.inCover = atPost && (p.kind === "cover" || p.kind === "fold" || p.kind === "hull");
  // in the open he fires from the LOWEST position that still has the line:
  // flat if the ground allows it, kneeling, else on his feet
  if (atPost && !m.inCover && (simT > (m._fsT || 0) || m._fsTgt !== tgt)) {
    m.fireStance = tgt ? fireStanceFor(m, tgt) : "crouch";
    m._fsT = simT + 1.2; m._fsTgt = tgt;           // two sight lines, not every think
  }
  switch (task) {
    case "rush":
      m.slot = atPost ? "fire" : "rush";
      if (atPost && !m._dived) { m._dived = true; if ((m.supp || 0) > 0.3 || S.supp > 0.3) tacDive(m); }
      if (!atPost) m._dived = false;
      break;
    case "withdraw":
      m.slot = atPost ? "fire" : "withdraw";
      break;
    case "assault":
      m.slot = "push";
      if (tgt && m.sees && Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z) < 5) m.target.set(m.pos.x, 0, m.pos.z);
      break;
    case "pinned":
      m.slot = "pinned";
      if (!atPost) m.slot = d < 7 ? "crawl" : "pinned";
      break;
    case "screen":
      m.slot = atPost ? (tgt && m.sees ? "fire" : "hold") : "march";
      break;
    case "drill":
      m.slot = atPost ? "fire" : "move";
      break;
    default:            // overwatch, fight, hold
      m.slot = atPost ? "fire" : ((m.supp || 0) > 0.35 || d < 9 ? "rush" : "move");
  }
  // a lone mark with no line to it from his post: he stays and watches, he
  // does not walk off his post into the open after it
  return true;
}
// a sight line from his eyes at a given height (the stance he is not in yet)
function losFrom(m, o, eye) {
  const ay = m.pos.y + eye, by = o.pos.y + (o.losY || 1.35);
  if (HOST.segmentBlocked(m.pos.x, ay, m.pos.z, o.pos.x, by, o.pos.z)) return false;
  return !(HOST.terrainLos && terrainBlocked(m.pos.x, ay, m.pos.z, o.pos.x, by, o.pos.z));
}
function fireStanceFor(m, o) {
  const e0 = m.eyeH0 || 1.52;
  if ((m.supp || 0) > 0.4 && losFrom(m, o, e0 * STANCE_K.prone)) return "prone";
  if (losFrom(m, o, e0 * STANCE_K.crouch)) return "crouch";
  return "stand";
}
// the march: the leader navigates, everyone else keeps his formation slot
function marchSlot(m, S) {
  if (m === S.leader) {
    marchGoal(m);
    // the squad's sector of the side's front: columns advance side by side
    const sl = S.latErr || 0, sd = S.depErr || 0;
    if (sl || sd) { m.target.x += (S.rx || 0) * sl + (S.fwdx || 0) * sd; m.target.z += (S.rz || 0) * sl + (S.fwdz || 0) * sd; }
    m.slot = "march";
    return;
  }
  const p = CBZ.battleTactics.postFor(m);
  if (p) m.target.set(p.x, 0, p.z); else marchGoal(m);
  m.slot = "march";
}

/* ---- REFLEXES: an animal ---- */
const _bx = [], _bxm = [];
function beastReflex(m, S) {
  // the nearest animal he knows about: his mark, or his squad's
  let b = m.tgt && m.tgt.beast ? m.tgt : (S.focus && S.focus.beast ? S.focus : (S.threatTop && S.threatTop.beast ? S.threatTop : null));
  if (!b || b.dead) return false;
  const dx = m.pos.x - b.pos.x, dz = m.pos.z - b.pos.z, d = Math.hypot(dx, dz) || 0.01;
  const sp = b.species || {};
  const danger = sp.danger != null ? sp.danger : 0.5;
  const fearR = 4 + danger * 8 + (b.rad || 0.6) * 4;
  // is it coming at HIM: charging, fast, and pointed his way
  let charging = false;
  if (b.state === "charge" && (b.speed || 0) > 2.2) {
    if (b.tgt === m) charging = true;
    else {
      const hx = Math.cos(b.heading || 0), hz = Math.sin(b.heading || 0);
      charging = (-dx * hx - dz * hz) / d > 0.9 && d < fearR * 1.6;
    }
  }
  const tier = m.tier || "pro";
  const steady = tier === "elite" || tier === "swat" ? 0.35 : tier === "pro" ? 0.6 : 1;
  /* THE FEAR OF IT, SHARED. Near a big animal a man is rattled; a man with
     a dozen others round the same animal much less, since it can only be on
     one of them at a time (sqrt past three mates within 6 m). Not when it
     is coming at HIM. Measured before: 50 civilians round one gorilla were
     every one at the 1.2 rattle cap from proximity alone. */
  if (d < fearR) {
    let mates = 0;
    const a = fineNear(m.pos.x, m.pos.z, 6, _bxm);
    for (let i = 0; i < a.length; i++) { const o = a[i]; if (o !== m && !o.dead && !o.routed && o.team === m.team && !o.beast) mates++; }
    const share = Math.sqrt(Math.min(1, 3 / Math.max(1, mates)));
    m.supp = Math.min(1.2, (m.supp || 0) + 0.3 * steady * (1 - d / fearR) * share + (charging ? 0.15 * steady : 0));
  }
  // PANIC: the real cue (a big animal on top of him, coming), not a dice roll
  if (charging && d < fearR * 0.75 && (m.supp || 0) > 0.9 && steady > 0.5) {
    m.panicT = simT + 2.2 + CBZ.battleTactics.hash01(m, 0x3A11) * 2;
    m.panicFrom = b;
    TAC.panics = (TAC.panics || 0) + 1;
    panicGoal(m);
    return true;
  }
  // GET OUT OF THE PATH: a charge is a line, so step off it, not back down it
  if (charging && d < fearR * 1.6) {
    const hx = Math.cos(b.heading || 0), hz = Math.sin(b.heading || 0);
    // which side of its line he is on
    const side = (dx * hz - dz * hx) >= 0 ? 1 : -1;
    m.target.set(m.pos.x + hz * side * 7, 0, m.pos.z - hx * side * 7);
    m.slot = "dodge";
    TAC.dodges = (TAC.dodges || 0) + 1;
    return true;
  }
  // KEEP THE RANGE: a stalking animal inside the line's keep distance is
  // backed away from (the man it is nearest), while the rest of the line shoots
  const keep = CBZ.battleTactics.K.BEAST_KEEP * (0.6 + danger * 0.6);
  if (d < keep && !charging && m.task === "drill" && b.tgt === m) {
    m.target.set(m.pos.x + dx / d * 5, 0, m.pos.z + dz / d * 5);
    m.slot = "backstep";
    return true;
  }
  return false;
}
function panicGoal(m) {
  const b = m.panicFrom;
  let ax = 0, az = 1;
  if (b && !b.dead) { ax = m.pos.x - b.pos.x; az = m.pos.z - b.pos.z; }
  else { const h = tacHomeDir(m.team); ax = h.x; az = h.z; }
  const l = Math.hypot(ax, az) || 1;
  m.target.set(m.pos.x + ax / l * 20, 0, m.pos.z + az / l * 20);
  m.slot = "panic";
}

/* ============================================================ THE WOUNDED */
// damage.js calls this for a hit that did not kill (hp still > 0)
function tacticsOnHurt(m, dmg, imp, res) {
  if (!m || m.beast || m.vehicle) return;
  m.lastHitT = simT;
  if (imp && imp.by && imp.by.team && imp.by.team !== m.team) {
    m.lastHitBy = imp.by;
    returnFire(m, imp.by);
  }
  // THE BODY TAKES IT: entities/soldier.js's hit reaction (flinch, stumble,
  // a fall; the limp / dead arm / gut hunch it leaves) on a rig near the lens
  const sev = Math.max(0, Math.min(1, dmg / ((m.maxHp || 100) * 0.45)));
  let zone = "torso";
  if (imp && imp.headshot) zone = "head";
  else {
    const r = lcg();
    zone = r < 0.42 ? "torso" : r < 0.56 ? "gut" : r < 0.66 ? "armL" : r < 0.76 ? "armR" : r < 0.88 ? "legL" : "legR";
  }
  m.lastZone = zone;
  if (res && res.wound) zone = res.wound;
  if (!res && m.char && CBZ.soldier && CBZ.soldier.hit && camDist2(m.pos) < 120 * 120) {
    let dx = 0, dz = 1;
    const src = imp && imp.by && imp.by.pos ? imp.by.pos : (imp && imp.fromX != null ? { x: imp.fromX, z: imp.fromZ } : null);
    if (src) { dx = m.pos.x - src.x; dz = m.pos.z - src.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
    try { CBZ.soldier.hit(m.char, { sev: sev, dirX: dx, dirZ: dz, zone: zone, running: (m.speed || 0) > 3 }); } catch (e) {}
  }
  // DOWN, NOT DEAD: a bad hit to the body or the legs can drop a man who is
  // not yet killed — he is out of the fight, bleeding, and his mates can
  // still save him. Never a head shot; never a man already down.
  if (TAC.on && !m.downed && !m.you && m.hp < (m.maxHp || 100) * 0.3 && zone !== "head" && lcg() < 0.5) {
    m.downed = true; m.downT = simT; m.cared = false;
    m.bleed = 0.7 + lcg() * 0.9;                   // hp a second until somebody gets to him
    m.tgt = null; m.sees = false; m.slot = "downed"; m.routed = false;
    m.dragTgt = null; m.dragging = false;
    setStance(m, "prone");
    // a man going down screaming shakes his army as a death does, and the men
    // beside him most (morale.js moraleOnDeath's two terms)
    const A = ARMY[m.team];
    if (A && m._mc) MO.deathShock(A, m._mw || 1);
    rattleMates(m);
    if (m.char && CBZ.soldier && CBZ.soldier.wound) { try { CBZ.soldier.wound(m.char, zone === "legL" || zone === "legR" ? "legs" : "gut", 0.9); } catch (e) {} }
    TAC.downed = (TAC.downed || 0) + 1;
  }
}
/* THE MUZZLE FLASH. A man shot from a crest he cannot see over still knows
   where it came from — and so does every mate beside him who heard it. They
   mark the spot (the arms layer's last-seen, fire.js armOf: seenX/Z/T) and
   the shooter as the mark of anyone without one, so the arms layer's
   suppressive fire answers into it instead of a squad dying in silence. */
function returnFire(m, by) {
  if (!TAC.on || !by.pos || by.vehicle || typeof armOf !== "function") return;
  const S = m.sqd, L = S && S.men && S.men.length ? S.men : [m];
  for (let i = 0; i < L.length; i++) {
    const o = L[i];
    if (o.dead || o.routed || o.fists || o.launcher || !o.armed) continue;
    if (o !== m && Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z) > 25) continue;
    let A = null;
    try { A = armOf(o); } catch (e) { A = null; }
    if (!A) continue;
    if (!o.tgt || tacOut(o.tgt) || !o.sees) { o.tgt = by; o.losBadT = 0; }
    if (o.tgt === by && simT - (A.seenT || -99) > 1) {
      A.seenX = by.pos.x; A.seenZ = by.pos.z; A.seenY = by.pos.y + (by.aimY || 1.1); A.seenT = simT;
    }
  }
}
/* A DOWNED MAN: bleeds (until a mate has him in cover), crawls a little
   toward his own side, and is taken if the enemy reaches him alone. */
const _dn = [];
function downedStep(m, sdt) {
  m.speed = 0;
  if (!m.cared) {
    m.hp -= m.bleed * sdt;
    if (m.hp <= 0) { killMan(m, { cause: "wounds" }); return; }
  }
  // dragged: the dragger moves him (dragFollow)
  if (m._dragBy && m._dragBy.dragging && m._dragBy.dragTgt === m && !m._dragBy.dead) return;
  // crawl a little toward home while nobody comes
  if (!m.cared && simT - m.downT > 2.5) {
    const h = tacHomeDir(m.team);
    m.pos.x += h.x * 0.35 * sdt; m.pos.z += h.z * 0.35 * sdt;
    m.speed = 0.35;
    HOST.resolveCircle(m.pos, m.rad || 0.45, m.pos.y, 1.8);
    m.pos.y = HOST.bodyY(m, m.pos.x, m.pos.z);
  }
  // overrun: an enemy on top of him and none of his own near
  m._dnT = (m._dnT || 0) - sdt;
  if (m._dnT <= 0) {
    m._dnT = 0.8;
    const a = fineNear(m.pos.x, m.pos.z, 12, _dn);
    let foe = false, mate = false;
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      if (o === m || o.dead || o.downed || o.routed || o.vehicle) continue;
      const d = Math.hypot(o.pos.x - m.pos.x, o.pos.z - m.pos.z);
      if (o.team === m.team) mate = true;
      else if (d < 4 && !o.beast) foe = true;
    }
    if (foe && !mate) surrender(m);
  }
}
function dragThink(m, S) {
  const w = m.dragTgt;
  if (!w || w.dead || !w.downed || w.cared) { m.dragTgt = null; m.dragging = false; return false; }
  if (!m.dragging) {
    m.target.set(w.pos.x, 0, w.pos.z);
    m.slot = "rush";
    if (Math.hypot(w.pos.x - m.pos.x, w.pos.z - m.pos.z) < 1.5) {
      m.dragging = true;
      const f = S.focus || S.threatTop;
      const c = foeCentre(m);
      const tx = f ? f.pos.x : c.x, tz = f ? f.pos.z : c.z;
      const p = CBZ.battleTactics.safeSpot(tacAdapter(), m.pos.x, m.pos.z, tx, tz, tacHomeDir(m.team));
      m.dragTo = { x: p.x, z: p.z };
    }
    return true;
  }
  m.target.set(m.dragTo.x, 0, m.dragTo.z);
  m.slot = "drag";
  if (Math.hypot(m.dragTo.x - m.pos.x, m.dragTo.z - m.pos.z) < 1.6) {
    // in cover: the bleeding is stopped, and he is left there
    w.cared = true; w.bleed = 0; w._dragBy = null;
    m.dragging = false; m.dragTgt = null;
    TAC.saved = (TAC.saved || 0) + 1;
  }
  return true;
}
// the dragged man follows his mate's hands (stepMan, after the move)
function dragFollow(m) {
  const w = m.dragTgt;
  if (!w || !m.dragging || w.dead) return;
  let dx = m.pos.x - m.target.x, dz = m.pos.z - m.target.z;
  const l = Math.hypot(dx, dz) || 1;
  w.pos.x = m.pos.x + dx / l * 1.05;
  w.pos.z = m.pos.z + dz / l * 1.05;
  w.pos.y = HOST.bodyY(w, w.pos.x, w.pos.z);
  if (w.group) w.group.rotation.y = Math.atan2(-dx, -dz);
}

/* ============================================================ SURRENDER */
function surrender(m) {
  if (m.surrendered || m.dead || m.you) return false;
  m.surrendered = true; m.fled = true; m.routed = false; m.downed = false;
  m.tgt = null; m.sees = false; m.speed = 0;
  CBZ.battleTactics.STATS.surrendered[m.team]++;
  // the rifle goes on the ground
  const prop = m._weaponProp;
  if (prop && CBZ.weaponPhysics && CBZ.weaponPhysics.drop) {
    try {
      CBZ.scene.attach(prop);
      m._weaponProp = null; m._weaponPropId = null;
      CBZ.weaponPhysics.drop(prop, { vx: (lcg() - 0.5) * 1.2, vy: 1.2, vz: (lcg() - 0.5) * 1.2, source: "npcwar-surrender" });
      dropGuns.push(prop);
    } catch (e) {}
  }
  m.armed = false;
  if (m.char) { m.char.surrender = true; m.char.soldier = null; m.char.kneelB = 1; m.char.crouch = false; m.char.pronePose = false; }
  TAC.captives.push(m);
  emitWar("surrender", { team: m.team, id: m.id });
  return true;
}
/* A FIST FIGHT HE HAS LOST (systems/melee.js judged it: "yield" = hands up,
   "flee" = he runs). The fighter layer only poses it; the page makes it
   real — a prisoner, or a man routing like any other. melee.js asks. */
function fistQuit(m) {
  const q = m._vfS && m._vfS.quit;
  if (q === "yield") return surrender(m);
  if (q === "flee" && !m.routed) {
    m.routed = true; m.routT = 0; m.routStall = 0; m.tgt = null; m.sees = false;
    const foe = foeCentre(m);
    m.routBest = Math.hypot(m.pos.x - foe.x, m.pos.z - foe.z);
    return true;
  }
  return false;
}
// a broken man, cornered: does he put his hands up? (routCheck asks)
function trySurrender(m) {
  if (!TAC.on || m.you) return false;
  // hands up to WHOM: an animal takes no prisoners. Measured: 2-9 men a
  // battle "surrendered" to a gorilla or a tiger and left the field
  let captor = false;
  for (let i = 0; i < men.length && !captor; i++) {
    const o = men[i];
    if (o.team !== m.team && !o.dead && !o.fled && !o.beast) captor = true;
  }
  if (!captor) return false;
  const p = SURRENDER_P[m.tier] != null ? SURRENDER_P[m.tier] : 0.4;
  const hurt = m.hp < (m.maxHp || 100) * 0.5 ? 0.2 : 0;
  const A = tacAdapter();
  const odds = A.odds(m.team);
  const hopeless = odds < 0.5 ? 0.2 : 0;
  // a stable draw per man, so the same man is the one who gives up
  return CBZ.battleTactics.hash01(m, 0x5022 + (m.routT | 0)) < Math.min(0.95, p + hurt + hopeless) && surrender(m);
}
// the prisoners kneel with their hands up (a short animation, near the lens)
function animCaptives(dt) {
  for (let i = TAC.captives.length - 1; i >= 0; i--) {
    const m = TAC.captives[i];
    if (!m.char || !CBZ.animChar) { TAC.captives.splice(i, 1); continue; }
    m._capT = (m._capT || 0) + dt;
    if (m._capT > 4) continue;                     // settled: the pose holds
    if (camDist2(m.pos) > 160 * 160) continue;
    try { CBZ.animChar(m.char, 0, dt); } catch (e) {}
  }
}

/* ============================================================ GRENADES
   The throw, the flight, the fuse and the blast are the arms layer's
   (src/battle/fire.js armsGrenade / stepGrenades / NADES). The squad only
   ASKS (m.wantNade: a man in cover inside a throw, none of ours near it —
   armsGrenade honours it), and the men where one comes down REACT: they see
   it land and go flat, or get clear (nadeWatch, from the tick). */
function nadeWatch() {
  if (typeof NADES === "undefined") return;
  for (let i = 0; i < NADES.length; i++) {
    const N = NADES[i];
    if (N.state === "held" || N._tacWarned) continue;
    N._tacWarned = true;
    nadeWarn({ tx: N.lx != null ? N.lx : N.x, tz: N.lz != null ? N.lz : N.z, team: N.team, t: simT });
  }
}
const _nw = [];
function nadeWarn(N) {
  const a = fineNear(N.tx, N.tz, 7, _nw);
  for (let k = 0; k < a.length; k++) {
    const o = a[k];
    if (o.dead || o.beast || o.vehicle || o.downed || o.you || o.surrendered) continue;
    // a trained man reacts more often (and his own side's grenade he knew about)
    const quick = o.team === N.team ? 0.95 : o.tier === "elite" || o.tier === "swat" ? 0.75 : o.tier === "pro" ? 0.6 : 0.4;
    if (CBZ.battleTactics.hash01(o, 0x6E1D + (N.t * 10 | 0)) > quick) continue;
    let dx = o.pos.x - N.tx, dz = o.pos.z - N.tz;
    const l = Math.hypot(dx, dz) || 1;
    if (l < 3.2 && o.team !== N.team) {
      // no time to get clear: flat on the ground
      tacDive(o);
      o.nadeDiveT = simT + 1.6;
      o.target.set(o.pos.x, 0, o.pos.z);
    } else {
      o.nadeDiveT = simT + 1.4;
      o.target.set(o.pos.x + dx / l * 6, 0, o.pos.z + dz / l * 6);
    }
    o.slot = "dodge";
  }
}
function tacDive(m) {
  setStance(m, "prone");
  m.pinT = simT + 1.2;
  if (m.char && CBZ.soldier && CBZ.soldier.dive && camDist2(m.pos) < 120 * 120) { try { CBZ.soldier.dive(m.char); } catch (e) {} }
}

/* ============================================================ THE BODY
   How fast a man moves on a squad's slot (stepMan asks first; -1 = the
   page's own table). Real paces: a march is a fast walk, a bound is a
   crouched sprint, a withdrawal a run, a crawl a crawl. */
function tacSpeed(m, hurtish) {
  if (!TAC.on || !m.sqd) return -1;
  const s = m.slot;
  let v = -1;
  if (s === "rush") v = hurtish ? 4.4 : 5.6;
  else if (s === "move") v = 3.4;
  else if (s === "withdraw") v = hurtish ? 4.2 : 5.0;
  else if (s === "crawl") v = 0.9;
  else if (s === "drag") v = 1.5;
  else if (s === "dodge") v = 6.2;
  else if (s === "panic") v = 6.4;
  else if (s === "backstep") v = 2.4;
  else if (s === "pinned") v = 0.9;
  else if (s === "fire" || s === "hold") v = 2.6;        // the last metres onto his post
  else if (s === "march") v = m.hunt ? 6.2 : (m.sqd.form === "column" ? 3.8 : 3.4);
  else if (s === "push") v = m.hunt ? 6.8 : 4.6;
  if (v < 0) return -1;
  if (m.stance === "prone" && s !== "dodge" && s !== "panic") v = Math.min(v, 0.9);
  // the march catches up: a man far off his slot closes it at a run
  if (s === "march" && m.sqd.leader && m.sqd.leader !== m) {
    const d = Math.hypot(m.target.x - m.pos.x, m.target.z - m.pos.z);
    if (d > 6) v = Math.min(5.6, v + d * 0.12);
  }
  return v;
}
const FIRE_SLOTS = { fire: 1, peek: 1, push: 1, sidestep: 1, hull: 1, pinned: 1, hold: 1, backstep: 1 };
// may he pull the trigger on this slot? (stepMan's gate; within 12 m always)
function tacMayFire(m, dist) {
  if (!TAC.on || !m.sqd) return null;
  if (dist <= 12) return true;
  // an animal coming in is shot at by every gun that bears, walking or not —
  // the line never goes silent (only a man flat-out sprinting does not fire)
  if (m.tgt && m.tgt.beast && dist < 70 && m.slot !== "panic" && m.slot !== "rush" && m.slot !== "dodge") return true;
  if (!FIRE_SLOTS[m.slot]) return false;
  // a pinned man fires little, and only when the fire on him slackens a hair
  if (m.slot === "pinned" && ((m.supp || 0) > 1.0 || lcg() < 0.35)) { m.cool = Math.max(m.cool, 0.6); return false; }
  return true;
}
/* STANCE: what he does with his body this sub-step. Returns true when the
   squad layer set it (the old rules are skipped). */
function stanceStep(m, spd, sdt) {
  if (!TAC.on || !m.sqd || m.routed || m.fists) return false;
  const s = m.slot;
  const supp = m.supp || 0;
  // pinned men stay pinned: a hard burst holds him flat for a while
  if (supp > 0.95) m.pinT = Math.max(m.pinT || 0, simT + CBZ.battleTactics.K.PIN_MIN_T);
  const pinned = (m.pinT || 0) > simT;
  m.up = true;
  if (s === "panic" || s === "dodge" && !(m.nadeDiveT > simT && m.stance === "prone")) { setStance(m, "stand"); m.coverK = 1; return true; }
  if (s === "rush" || s === "withdraw") {
    if (pinned && s === "rush") { setStance(m, "prone"); m.coverK = 0.3; return true; }
    setStance(m, spd > 0.1 ? "rush" : "crouch");
    m.coverK = spd > 0.1 ? 0.75 : CROUCH_HIT;
    return true;
  }
  if (s === "march" || s === "move" || s === "drag" || s === "push" || s === "backstep") {
    setStance(m, s === "drag" ? "rush" : (supp > 0.5 && s !== "march" ? "rush" : "stand"));
    m.coverK = m.stance === "rush" ? 0.75 : 1;
    if (s === "push" && spd <= 0.1) { setStance(m, "crouch"); m.coverK = CROUCH_HIT; }
    return true;
  }
  if (s === "crawl") { setStance(m, "prone"); m.coverK = 0.3; return true; }
  // a pinned SQUAD is not a squad of men with their faces in the sand: the
  // ones the fire is actually on stay flat, the rest return what fire they
  // can from the lowest stance that still has the line
  if (s === "pinned") {
    if (pinned || supp > 0.75 || spd > 0.1) { setStance(m, "prone"); m.coverK = 0.3; return true; }
    const fs = m.fireStance || "crouch";
    setStance(m, fs);
    m.coverK = fs === "prone" ? 0.3 : fs === "crouch" ? CROUCH_HIT : 1;
    return true;
  }
  // at a post: fire / hold
  const p = m.post;
  if (p && m.inCover) {
    m.up = workCover(m, p, sdt, pinned);
    m.coverK = m.up ? (p.low ? 0.45 : 0.55) : 0.2;
    return true;
  }
  // in the open: the lowest stance that still has the shot; flat when pinned
  if (pinned || (supp > 0.75 && m.fireStance !== "stand")) { setStance(m, "prone"); m.coverK = 0.3; }
  else if (spd > 0.1) { setStance(m, supp > 0.3 ? "rush" : "stand"); m.coverK = m.stance === "rush" ? 0.75 : 1; }
  else {
    const fs = m.fireStance || "crouch";
    setStance(m, fs);
    m.coverK = fs === "prone" ? 0.3 : fs === "crouch" ? CROUCH_HIT : 1;
  }
  // a tactical reload while he is down and the line is not all reloading
  // (a firing line facing an animal tops up at half a magazine, a third of
  // the line at a time, so it never goes dry all at once)
  const drill = m.task === "drill";
  if (m.mag < m.magSize * (drill ? 0.5 : 0.4) && !(m.reloadT > 0) && (drill || !m.tgt || !m.sees) && CBZ.battleTactics.reloadOK(m)) tacReload(m);
  return true;
}
/* THE COVER CYCLE: down behind it, up over it (a low wall) or out round its
   edge (a tall one) to shoot, down again to reload. A heavily suppressed man
   stays down — and may blind-fire over the top. */
function workCover(m, p, sdt, pinned) {
  const tall = !p.low;
  const supp = m.supp || 0;
  if (m.reloadT > 0 || pinned) { coverDown(m, p, tall); m.popT = Math.min(m.popT || 0, 0.4); m.blind = false; return false; }
  // a tactical reload while he is down
  if (m.mag < m.magSize * 0.45 && m.stance !== "stand" && CBZ.battleTactics.reloadOK(m)) { tacReload(m); coverDown(m, p, tall); return false; }
  m.popT = (m.popT || 0) - sdt;
  if (m.popT <= 0) {
    const wasUp = m._coverUp;
    if (wasUp) {
      m._coverUp = false;
      m.popT = 0.45 + (m.i % 5) * 0.1 + supp * 1.2;       // down: a breath, longer under fire
    } else if (supp < 0.85 && m.tgt) {
      m._coverUp = true;
      m.popT = 2.2 + (m.i % 7) * 0.22;                     // up: a few aimed bursts
    } else {
      m.popT = 0.6 + (m.i % 3) * 0.2;
    }
  }
  // BLIND FIRE: down, under heavy fire, with a mark he knows is there
  m.blind = !m._coverUp && supp > 0.85 && !!m.tgt && !tacOut(m.tgt) && !m.vehicle;
  if (m._coverUp) {
    if (tall) { m.target.set(p.px, 0, p.pz); setStance(m, "stand"); }
    else setStance(m, "stand");
    return true;
  }
  coverDown(m, p, tall);
  return false;
}
function coverDown(m, p, tall) {
  if (tall) { m.target.set(p.x, 0, p.z); setStance(m, "stand"); }
  else setStance(m, "crouch");
  m._coverUp = false;
}
// a tactical reload: the arms layer's own (the ammo in his pouches, the rig's
// mag change: src/battle/fire.js armsReload)
function tacReload(m) { if (!(m.reloadT > 0) && m.magSize) armsReload(m); }

/* BLIND FIRE: rounds over the top at where he knows the man is. Few of them
   land (0.15 of an aimed round), all of them rattle. stepMan calls this for
   a man down in cover with m.blind set. */
let _blindAt = null;
function blindFire(m, sdt) {
  if (m.cool > 0 || m.reloadT > 0 || !(m.mag > 0)) return;
  const t = m.tgt;
  if (!t || tacOut(t)) return;
  const dist = Math.hypot(t.pos.x - m.pos.x, t.pos.z - m.pos.z);
  if (dist > 70 || dist < 6) return;
  // the arms layer's area fire at where he knows the man is, a wild spray:
  // a round now and then lands, every one cracks over the enemy's heads
  if (!_blindAt) _blindAt = V();
  const sp = 2 + dist * 0.06;
  _blindAt.set(t.pos.x + (lcg() - 0.5) * sp, t.pos.y + 0.6 + lcg() * 1.4, t.pos.z + (lcg() - 0.5) * sp);
  TAC.blind = (TAC.blind || 0) + 1;
  m._blindShot = true;
  fireShot(m, t, { mode: "area", at: _blindAt });
  m._blindShot = false;
  m.cool = 0.35 + lcg() * 0.5;
  if (m.mag <= 0) armsReload(m);
}

/* THE RIG: the state above, as entities/soldier.js's record. loop.js calls
   this on the anim pass, before animChar. Without the soldier layer (an old
   studio) it sets the one flag the rig always had, ch.crouch. */
function soldierRig(m) {
  const ch = m.char;
  if (!ch) return;
  if (!CBZ.soldier || TAC_OLD) { ch.crouch = crouchPose(m); ch.pronePose = m.stance === "prone"; return; }
  const S = ch.soldier || (ch.soldier = { carry: "low", stance: "stand", cover: null });
  // the stance
  S.stance = m.downed ? "prone" : m.stance === "rush" ? "rush" : m.stance === "prone" ? "prone" :
    (m.stance === "crouch" || m.slot === "cover" || m.slot === "peek") ? "crouch" : "stand";
  // the carry: slung on a quiet march, low ready in contact, high in close
  const sq = m.sqd;
  const near = m.tgt && !m.tgt.dead ? Math.hypot(m.tgt.pos.x - m.pos.x, m.tgt.pos.z - m.pos.z) : 1e9;
  S.carry = m.flying ? "fpv" : m.downed || m.fists || !m.armed ? null :
    near < 18 ? "high" : (sq && sq.task === "march" && !m.tgt) ? "patrol" : "low";
  // cover: behind a wall, up over it / out round it, or blind
  const p = m.post;
  if (m.inCover && p && !m.downed) {
    const C = S.cover || (S.cover = { low: true, side: 1, peek: 0, blind: false });
    C.low = !!p.low;
    C.side = p.px != null ? (((p.px - p.x) * Math.cos(m.yaw) - (p.pz - p.z) * Math.sin(m.yaw)) >= 0 ? -1 : 1) : 1;
    C.peek = m.up ? 1 : 0;
    C.blind = !!m.blind;
  } else S.cover = null;
  if (m.downed && CBZ.soldier.wound && !m._woundSet) { m._woundSet = true; try { CBZ.soldier.wound(ch, "legs", 0.9); } catch (e) {} }
}

/* OVER, NOT ROUND: a man whose move is eaten by a LOW wall (a crate, a
   sandbag line, a kerb wall: 0.4-1.3 m over the ground, under 1.8 m deep)
   vaults it — hands on the top, legs over, down the far side — instead of
   sliding along it on the detour (stepMan asks when the wall stops him).
   The pose is entities/soldier.js's vault; the arc is its vaultArc. */
const _vq = [], _vq2 = [];
function tryVault(m, nx, nz) {
  if (!TAC.on || m.beast || m.vehicle || m.downed || m.dragging || m.stance === "prone" || m.vault) return false;
  const H = HOST;
  if (!H || !H.queryColliders) return false;
  const cols = H.queryColliders(m.pos.x + nx * 0.8, m.pos.z + nz * 0.8, 0.35, _vq) || [];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.minX == null) continue;
    const cx = (c.minX + c.maxX) * 0.5, cz = (c.minZ + c.maxZ) * 0.5;
    const gy = HOST.groundAt(cx, cz);
    const top = (c.y1 == null ? 9 : c.y1) - gy;
    if (top < 0.4 || top > 1.3) continue;
    const thick = Math.abs(nx) * (c.maxX - c.minX) + Math.abs(nz) * (c.maxZ - c.minZ);
    if (thick > 1.8) continue;
    const bx = m.pos.x + nx * (thick + 1.5), bz = m.pos.z + nz * (thick + 1.5);
    // the far side has to be ground he can stand on
    const land = H.queryColliders(bx, bz, 0.45, _vq2) || [];
    let blocked = false;
    for (let k = 0; k < land.length; k++) {
      const o = land[k];
      if (H.colliderContains && H.colliderContains(o, bx, bz, 0.4) && (o.y1 == null ? 9 : o.y1) - HOST.groundAt(bx, bz) > 0.35) { blocked = true; break; }
    }
    if (blocked) continue;
    const dur = 0.5 + top * 0.18;
    m.vault = { t: 0, dur, ax: m.pos.x, az: m.pos.z, bx, bz, h: top };
    m.yaw = Math.atan2(nx, nz);
    if (m.group) m.group.rotation.y = m.yaw;
    if (m.char && CBZ.soldier && CBZ.soldier.vault && camDist2(m.pos) < 120 * 120) {
      try { CBZ.soldier.vault(m.char, { ledgeX: m.pos.x + nx * 0.6, ledgeZ: m.pos.z + nz * 0.6, top: gy + top, dirX: nx, dirZ: nz, span: thick, dur }); } catch (e) {}
    }
    TAC.vaults = (TAC.vaults || 0) + 1;
    return true;
  }
  return false;
}
// one sub-step of a vault in progress (stepMan, before anything else moves him)
function stepVault(m, sdt) {
  const V0 = m.vault;
  V0.t += sdt;
  const u = Math.min(1, V0.t / V0.dur);
  m.pos.x = V0.ax + (V0.bx - V0.ax) * u;
  m.pos.z = V0.az + (V0.bz - V0.az) * u;
  const arc = CBZ.soldier && CBZ.soldier.vaultArc ? CBZ.soldier.vaultArc(u, V0.h) : (V0.h + 0.12) * Math.sin(Math.PI * u);
  m.pos.y = HOST.groundAt(m.pos.x, m.pos.z) + arc;
  m.speed = Math.hypot(V0.bx - V0.ax, V0.bz - V0.az) / V0.dur;
  if (u >= 1) {
    m.vault = null; m.stuckT = 0; m.detourT = 0;
    m.pos.y = HOST.bodyY(m, m.pos.x, m.pos.z);
  }
}

/* DANGER CLOSE: is one of this side's own (standing, on foot) within r of a
   point? Asked before anything that explodes is aimed there: a rocket, a
   tank's HE round. One fine-grid query. */
const _dc = [];
function dangerClose(team, x, z, r) {
  if (!TAC.on) return false;
  const a = fineNear(x, z, r, _dc);
  for (let i = 0; i < a.length; i++) {
    const o = a[i];
    if (o.team !== team || o.dead || o.vehicle) continue;
    if (Math.hypot(o.pos.x - x, o.pos.z - z) < r) { TAC.heldFire = (TAC.heldFire || 0) + 1; return true; }
  }
  return false;
}

/* ============================================================ ARMOUR
   thinkVehicle asks: a tank whose infantry screen has fallen behind stops
   and fights where it is until they close up (tanks lead an assault; they
   do not leave it). Returns true when it has set the vehicle's goal. */
function tacticsVehicle(u) {
  if (!TAC.on || u.air) return false;
  /* A HULL WITH NO GUN IS OUT OF THE FIGHT. Its gun knocked out, a crew
     does not sit in it on the line (and a war cannot end on a hulk nobody
     can hurt and nothing in it can shoot): it pulls back toward its own
     edge — off the field once it is clear, like a routed man. Immobilised
     too, it is simply out of the fight where it sits. */
  if (u.vs && u.vs.firepower) {
    if (!u.routed) { u.routed = true; u.tgt = null; TAC.withdrawn = (TAC.withdrawn || 0) + 1; }
    const h = tacHomeDir(u.team), foe = foeCentre(u);
    if (!u.vs.mobility) u.target.set(u.pos.x + h.x * 60, 0, u.pos.z + h.z * 60);
    else u.target.set(u.pos.x, 0, u.pos.z);
    u.slot = "fallback";
    if (Math.hypot(u.pos.x - foe.x, u.pos.z - foe.z) > FLEE_GAPS * (HOST.gap || 150)) u.fled = true;
    return true;
  }
  const S = u._escortBy;
  if (!S || S.task === "gone" || simT - (u._escortT || 0) > 3 || !S.alive) return false;
  const c = foeCentre(u);
  let ex = c.x - u.pos.x, ez = c.z - u.pos.z;
  const el = Math.hypot(ex, ez) || 1;
  ex /= el; ez /= el;
  const lead = (u.pos.x - S.cx) * ex + (u.pos.z - S.cz) * ez;
  const ahead = u.tactics && u.tactics.screen && u.tactics.screen.ahead ? Math.min(60, u.tactics.screen.ahead) : 38;
  if (lead > ahead) {
    u.target.set(u.pos.x, 0, u.pos.z);
    u.slot = u.tgt && u.sees ? "fire" : "hold";
    TAC.paced = (TAC.paced || 0) + 1;
    return true;
  }
  return false;
}

// a new war (morale.js resetArmies): the last one's squads, bombs and prisoners go
function tacReset() {
  TAC.home = null; TAC.at = -1;
  TAC.captives.length = 0;
  TAC.panics = TAC.dodges = TAC.downed = TAC.saved = TAC.booms = TAC.blind = TAC.paced = TAC.vaults = TAC.heldFire = 0;
  if (CBZ.battleTactics) CBZ.battleTactics.reset();
}

/* ============================================================ READOUT */
function tacticsReadout() {
  const BT = CBZ.battleTactics;
  const o = BT ? BT.stats() : {};
  o.panics = TAC.panics || 0; o.dodges = TAC.dodges || 0; o.downed = TAC.downed || 0; o.saved = TAC.saved || 0;
  o.booms = TAC.booms || 0; o.blind = TAC.blind || 0; o.paced = TAC.paced || 0;
  o.vaults = TAC.vaults || 0; o.heldFire = TAC.heldFire || 0;
  o.tiers = { full: 0, mid: 0, far: 0 };
  for (let i = 0; i < men.length; i++) {
    const t = men[i].aiTier;
    if (t === 0) o.tiers.full++; else if (t === 1) o.tiers.mid++; else if (t === 2) o.tiers.far++;
  }
  return o;
}
