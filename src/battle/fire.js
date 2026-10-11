"use strict";
/* src/battle/fire.js — NPC War: FIRE: rounds, rockets.
   Split out of games/battle.html (docs/npcwar/ARCHITECTURE.md). Every
   src/battle file shares ONE script scope: top-level names here are visible
   to the other battle files. Anything that needs the loaded engine runs in
   CBZ.npcwar.onBoot(), in file order, once the armoury is in. */

/* ============================================================ FIRE
   The trigger pull is combat_iq's: reaction beat, settle, burst rhythm,
   token discipline, derived damage. This page only draws the round,
   plays the report and applies the number it was handed. */
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
/* AND THE MAN GETS OUT OF THE WAY. Measured before this rule: 167 of 776
   rounds — one in five — fired down a lane one of the shooter's own men was
   standing in, and because a friendly round in this game passes through a
   friendly body, the result was not fratricide, it was GHOST BULLETS. Worse
   to watch than a friendly-fire kill and impossible to read.

   Holding fire alone would produce a rank of men who never shoot, so the
   answer is the one a rifleman actually uses: step off the line. He moves
   to the side the mate is NOT on — moving a shoulder-width perpendicular
   grows the mate's offset from the new line by (1 - along/d) of the step,
   so away-from-him is the direction that clears fastest — and he keeps his
   mark the whole time. */
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
let fxBudget = 0;              // tracers drawn this frame — a salvo cannot flood it
function fireShot(m, tgt, r) {
  const w = CBZ.weaponById(m.wid);
  m.mag--; m.lastShotT = simT;
  stats[m.team].shots++;
  m.shotsF++; gunLedger(m.wid).shots++;
  /* WHEN DOES THE WAR ACTUALLY START? The one number that says whether a
     person is watching a battle or watching a commute, and it is free. It
     read 10.9 s on `city` with 26 a side, because the two armies formed up
     304 m apart — see streetSpawner. Held by battle-check. */
  if (QUAL.firstShotT < 0) QUAL.firstShotT = Math.round(simT * 10) / 10;
  if (PROBE) {
    // both counters are asked AT THE TRIGGER and with a fresh test, because
    // a cached answer from the last think is exactly the thing being checked
    if (!eyeLos(m, tgt)) QUAL.blindFire++;
    if (mateInLane(m, tgt)) QUAL.throughMate++;
    // asked with the TERRAIN test regardless of whether terrainLos is armed,
    // which is what lets ?tlos=0 prove the sand goes transparent without it
    if (MAP.terrainTrue && terrainBlocked(m.pos.x, m.pos.y + (m.eyeH || 1.52), m.pos.z,
      tgt.pos.x, tgt.pos.y + (tgt.losY || 1.35), tgt.pos.z)) QUAL.throughSand++;
  }
  if (shotsRing.length > 90) shotsRing.shift();
  shotsRing.push({ x: m.pos.x, z: m.pos.z, t: simT, m: m });

  const cd2 = camDist2(m.pos);
  const seen = cd2 < 240 * 240;
  // a crouched man, or one up over a crest with the sand to his waist, is
  // less body to hit (coverK, stepMan's per-step read of his stance)
  const hit = lcg() < r.hit * (tgt.coverK || 1);
  const head = hit && lcg() < 0.12;

  // the round, resolved: chest point on a hit, a spread-true near miss on a
  // miss — at the TARGET BODY's own heights (a dog's chest is not at 1.28)
  _v.set(tgt.pos.x, tgt.pos.y + (head ? (tgt.headY || 1.62) : (tgt.aimY || 1.28)), tgt.pos.z);
  if (!hit) {
    const slot = (w && w.slot) || "_def";
    const spread = (CBZ.NPC_SPREAD && (CBZ.NPC_SPREAD[slot] || CBZ.NPC_SPREAD._def)) || 0.055;
    const mul = CBZ.suppressionAccuracyMul ? CBZ.suppressionAccuracyMul(m) : 1;
    const dist = Math.hypot(tgt.pos.x - m.pos.x, tgt.pos.z - m.pos.z);
    const miss = spread * mul * dist * (0.5 + lcg() * 1.6);
    const ang = lcg() * Math.PI * 2;
    _v.x += Math.cos(ang) * miss;
    _v.y += (lcg() - 0.35) * miss * 0.8;
    _v.z += Math.sin(ang) * miss;
    /* A ROUND THAT SNAPS PAST IS NOT NOTHING. Before this only a HIT
       rattled anybody (hurtMan's suppress), so a man could stand in a
       storm of near misses perfectly composed. Within ~2 m it now counts:
       combat_iq's own suppress (his aim worsens, he wants cover) and this
       page's rattle meter (his nerve, and whether he looks for a fold). */
    if (miss < 2.2 && !tgt.beast) {
      tgt.supp = Math.min(SUPP_CAP, (tgt.supp || 0) + SUPP_SNAP * (1.15 - miss / 2.2 * 0.7));
      if (CBZ.combatIQ && CBZ.combatIQ.suppress) CBZ.combatIQ.suppress(tgt, 0.7);
    }
  }

  if (seen && fxBudget < 26) {
    fxBudget++;
    let from = null;
    if (m.vehicle) from = vehicleMuzzle(m, _muz);
    else if (cd2 < 130 * 130 && CBZ.actorMuzzle) from = CBZ.actorMuzzle(m, _muz);
    if (!from) from = _muz.set(m.pos.x + Math.sin(m.yaw) * 0.5, m.pos.y + 1.42, m.pos.z + Math.cos(m.yaw) * 0.5);
    // pellets read as a cone; everything else is one line
    const lines = (w && w.pellets) ? 3 : 1;
    for (let i = 0; i < lines; i++) {
      _v2.copy(_v);
      if (i) { _v2.x += (lcg() - 0.5) * 1.6; _v2.y += (lcg() - 0.5) * 0.9; _v2.z += (lcg() - 0.5) * 1.6; }
      CBZ.tracer(from, _v2, { shooter: m, targetActor: tgt, muzzle: i === 0,
        muzzleScale: (w && w.flash ? 0.5 + w.flash : 0.9) });
    }
    const dCam = Math.sqrt(cd2);
    if (w && w.sfx && dCam < 230) {
      try {
        CBZ.sfx(w.sfx, { dist: dCam, ghost: true, volume: (w.sfxVol || 1) * 0.82,
          pitch: w.sfxPitch || 1, delay: dCam > 40 ? dCam / 343 : 0 });
      } catch (e) {}
    }
    if (!hit) missImpact(from, _v, cd2);
  }

  if (hit) {
    stats[m.team].hits++;
    m.hitsF++; gunLedger(m.wid).hits++;
    if (CBZ.bodyWound && cd2 < 90 * 90 && !tgt.vehicle) { try { CBZ.bodyWound(tgt, _v, {}); } catch (e) {} }
    // combat_iq's ladder is authored for fights against the PLAYER, whose
    // fairness cap this page has no player to need. Army-on-army trades at
    // band edge under mutual suppression, so battles read livelier a step
    // hotter — a page rule, applied where damage lands, never inside the IQ.
    hurtMan(tgt, r.dmg * 1.45 * (head ? 2.2 : 1), { by: m, headshot: head });
  }
}
// where did the miss land: walk the line for the first collider, else the
// ground, and let gunfx stamp the world so the fight leaves evidence
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
      CBZ.bulletImpact(_v2, { x: 0, y: 1, z: 0 }, { kind: "dust", power: 0.8 });
      return;
    }
    const cols = CBZ.micro.queryColliders(x, z, 0.4, _mq);
    for (let c = 0; c < cols.length; c++) {
      const b = cols[c];
      if (!CBZ.micro.colliderContains(b, x, z)) continue;
      if (b.y0 != null && (y < b.y0 || y > b.y1)) continue;
      _v2.set(x, y, z);
      const nx = Math.abs(x - b.minX) < Math.abs(x - b.maxX) ? -1 : 1;
      CBZ.bulletImpact(_v2, { x: nx, y: 0.2, z: 0 }, { kind: "spark", power: 1 });
      if (CBZ.bulletHole) CBZ.bulletHole(_v2, { x: nx, y: 0, z: 0 }, { mm: 8, noProp: true });
      return;
    }
  }
}

/* ---- rockets: the launcher classes fly a real round and detonate
   through studio.boom, which damages BOTH rosters through the caps bus
   and takes the building face with it outside the kill box. ---- */
function fireRocket(m, tgt) {
  const w = CBZ.weaponById(m.wid);
  m.mag--; m.lastShotT = simT;
  stats[m.team].shots++;
  m.shotsF++; gunLedger(m.wid).shots++;
  shotsRing.push({ x: m.pos.x, z: m.pos.z, t: simT, m: m });
  let from = null;
  if (camDist2(m.pos) < 150 * 150 && CBZ.actorMuzzle) from = CBZ.actorMuzzle(m, _muz);
  if (!from) from = _muz.set(m.pos.x + Math.sin(m.yaw) * 0.6, m.pos.y + 1.45, m.pos.z + Math.cos(m.yaw) * 0.6);
  const dx = tgt.pos.x - from.x, dy = (tgt.pos.y + 1.1) - from.y, dz = tgt.pos.z - from.z;
  const dist = Math.hypot(dx, dz);
  const spd = (w.projSpeed || 60) * 0.95;
  const grav = w.projGravity || 6;
  const tFly = dist / spd;
  const r = {
    pos: V().copy(from),
    vel: new THREE.Vector3(dx / tFly, dy / tFly + 0.5 * grav * tFly, dz / tFly),
    grav: grav, t: 0, w: w, by: m,
    trail: CBZ.studio.trail({ length: 26, color: 0xd8c39a, opacity: 0.5, minStep: 1.6 }),
  };
  rockets.push(r);
  const dCam = Math.sqrt(camDist2(m.pos));
  if (dCam < 240) {
    try { CBZ.sfx(w.sfx || "shoot_shotgun", { dist: dCam, ghost: true, pitch: w.sfxPitch || 1, volume: (w.sfxVol || 1) * 0.85 }); } catch (e) {}
    CBZ.muzzleFlash(from, { scale: 1.6 });
  }
}
function stepRockets(sdt) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.t += sdt;
    r.vel.y -= r.grav * sdt;
    r.pos.addScaledVector(r.vel, sdt);
    r.trail.push(r.pos);
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
    if (boom) {
      r.trail.dispose();
      rockets.splice(i, 1);
      CBZ.studio.boom({ x: r.pos.x, y: Math.max(r.pos.y, MAP.groundAt(r.pos.x, r.pos.z) + 0.6), z: r.pos.z }, {
        radius: r.w.blastRadius || 13, power: (r.w.blastPower || 1.9) * 0.55,
        structural: MAP.id !== "arena" && spawnTotal < 700,
        // THE MAN WHO FIRED IT. blastWorldActors has forwarded `opts.by` to
        // every hurt call since it was written; this page simply never told
        // it whose rocket that was, so a launcher crew's kills credited
        // nobody — measured on an EVERYTHING roster where the bazooka ended
        // the battle and finished the ledger with 0 kills against its name.
        by: r.by,
      });
    }
  }
}
