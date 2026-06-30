/* ============================================================
   city/squadai.js — SMART, TEAM-BASED NPC COMBAT (layered, never owns a ped).

   The complaint: armed NPCs "fight dumb". The moment a fight starts, every
   shooter sprints to ~9m and trades rounds at whoever's nearest — a face-to-face
   scrum with no spacing, no cover, no focus-fire, no flanking. Two crews shooting
   each other look like one milling blob.

   The fix is NOT a new combat engine. The per-ped brain in peds.js (move() +
   npcAttack ~L3253) already fires the actual shots and already HONORS a handful of
   transient fields — ped.target (where to walk), ped.rage (who to shoot),
   ped.guard (a leash point), ped.state. So this module is a COORDINATOR that runs
   AFTER the brain each frame and writes ONLY those fields to steer bodies into
   smarter positions:

     • cityCombatSmarts(ped, foe, dt) — per shooter: hold a 7–11m STANDOFF band off
       the foe (back out if too close, close the gap if too far), STRAFE side to
       side (so you're not a parked target), and slide toward nearby COVER when a
       wall is handy. Cosmetic-cheap, scratch-vector only.
     • cityShapeSquad(leader, members[], foe) — generalize gangs.js shapeSquad to an
       ARBITRARY member array: fan the shooters onto a perpendicular FIRING ARC with
       laned side offsets (opposing lines, not a pile-up), press melee in PAIRS on a
       shared mark, hold the leader centre-back, fall the hurt/dry back — and set a
       single FOCUS-FIRE target so the whole team drops one enemy at a time.

   HARD RULE — this module must never break vanilla combat. It is additive and
   fully gated on CBZ.CONFIG.CITY_SMART_COMBAT. It NEVER drives a ped that gangs.js
   is already shaping (ped._wRole set): those keep gangs.js's proven war-shape. Our
   own assignments are tagged ped._sqRole / ped._sqOwn / ped._squadHold so we can
   tell them apart and clean up after ourselves. Reuses peds.js's own leash/aim
   infra — we only point bodies at better spots, the brain still pulls the trigger.

   Exposes: CBZ.cityCombatSmarts, CBZ.cityShapeSquad.

   Consumers / who we layer over: the player's crew (faction 'player' / recruited /
   companion), VIP protection details (vips.js _vipGuard + principal.vipLvl), and
   ambient gang-vs-gang fights (gangs.js gang._eng) — focus-fire + smarts on top.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;           // headless / no-engine guard
  const g = CBZ.game;
  const rng = Math.random;

  function on() { return !CBZ.CONFIG || CBZ.CONFIG.CITY_SMART_COMBAT !== false; }
  function inCity() { return g && g.mode === "city" && g.state === "playing"; }

  // --- scratch (NO per-frame allocation in the passes) ---------------------
  const _S = { x: 0, z: 0 };   // squad centroid
  const _E = { x: 0, z: 0 };   // enemy locus
  const _crew = [];            // reused member gather buffer
  const _guards = [];          // reused detail-guard buffer

  // ---- helpers -------------------------------------------------------------
  function alive(p) { return p && !p.dead && !(p.ko > 0); }
  // the live actor a unit is fighting: ped.rage is a ped/player reference.
  function foeOf(p) { const R = p && p.rage; return (R && !R.dead) ? R : null; }
  function pos(a) { return a && (a.pos || a); }       // actor or {x,z}
  // a ped that gangs.js owns this fight — NEVER touch its steering.
  function gangOwned(p) { return !!(p && p._wRole); }
  // a ped WE may steer: alive, on its feet, not in a car, not gang-owned.
  function steerable(p) { return alive(p) && !p.inCar && !p.controlled && !gangOwned(p); }
  function hasGun(p) { return !!(p && p.armed && (p.ammo == null || p.ammo > 0)); }

  // is anything solid between (ax,az) and (bx,bz)? reuse the shared LOS helper the
  // ground units already self-gate on; degrade to "clear" if it isn't loaded.
  function losClear(ax, az, bx, bz) {
    if (!CBZ.clearLineOfFire) return true;
    try { return CBZ.clearLineOfFire(ax, 1.4, az, bx, 1.4, bz); } catch (e) { return true; }
  }

  // write a destination the brain will walk to. ped.target is a THREE.Vector3
  // (move() reads target.x/target.z); keep y at the ped's own height.
  function steerTo(p, x, z) {
    if (!p.target) return;
    p.target.set(x, p.target.y || 0, z);
  }

  // a COMPANION (the player's roll-with bodyguard) is driven by peds.js
  // companionThink, which OWNS its state machine: every tick it forces
  // state='walk', clears rage, and picks its OWN nearest-attacker threat to shoot.
  // For those we must NOT write rage/state (it'd be clobbered next frame and could
  // confuse other readers) — we only ever steer their TARGET into a smart slot, and
  // their own npcAttack still fires. Non-companion player-side fighters (e.g. a
  // founded-gang Soldier whose state genuinely is 'fight') take the full treatment.
  function companionDriven(p) { return !!(p && p.companion); }
  function setEngage(m, focus) {
    if (companionDriven(m)) return;          // positioning-only; companionThink shoots
    m.rage = focus; if (m.state !== "fight") m.state = "fight";
  }

  // ---- COVER: cheap, throttled probe of the building colliders near a ped for a
  //      wall edge that BREAKS the line from the foe. We don't pathfind to it; we
  //      just bias the standoff slot toward the nearest blocking corner so the
  //      brain drifts the body into defilade. WHY: a shooter who NEVER uses the
  //      wall he's standing next to reads as brain-dead; one that sidles behind it
  //      reads as a person. Bounded scan, cached per ped for ~0.5s. ----
  function coverBias(p, fx, fz, out) {
    out.has = false;
    const cols = CBZ.colliders;
    if (!cols || !cols.length) return out;
    // throttle: reuse last result most frames
    p._sqCovT = (p._sqCovT || 0) - 1;
    if (p._sqCovT > 0 && p._sqCov) { out.has = p._sqCov.has; out.x = p._sqCov.x; out.z = p._sqCov.z; return out; }
    p._sqCovT = 18 + ((rng() * 12) | 0);
    let bx = 0, bz = 0, bd = 9 * 9, found = false;   // only nearby cover (within ~9m)
    const px = p.pos.x, pz = p.pos.z;
    // find the nearest building edge whose corner BREAKS the foe's line to the ped;
    // standing tucked against it puts the wall between you and the gun. Bounded scan
    // for phone frames — we bias the standoff slot toward this point, no pathfinding.
    const N = Math.min(cols.length, 64);
    for (let i = 0; i < N; i++) {
      const c = cols[i];
      if (c.minX == null) continue;
      // nearest point on this box to the ped (the spot to hug)
      const cxN = Math.max(c.minX, Math.min(px, c.maxX));
      const czN = Math.max(c.minZ, Math.min(pz, c.maxZ));
      const ddx = cxN - px, ddz = czN - pz, dd = ddx * ddx + ddz * ddz;
      if (dd >= bd) continue;
      // only counts if standing there actually breaks the foe's line of fire
      if (!losClear(cxN, czN, fx, fz)) { bd = dd; bx = cxN; bz = czN; found = true; }
    }
    if (found) { out.has = true; out.x = bx; out.z = bz; }
    p._sqCov = { has: out.has, x: out.x, z: out.z };
    return out;
  }
  const _cov = { has: false, x: 0, z: 0 };

  // =========================================================================
  // (1) cityCombatSmarts(ped, foe, dt): per-shooter standoff + strafe + cover.
  //     COMPOSES with the squad shaper. If the ped already holds a lane slot from
  //     cityShapeSquad this cadence (_sqRole set), we keep that lane and only ADD a
  //     per-frame STRAFE offset + COVER bias to it — so the formation survives while
  //     the body still slides + tucks. If it's an UNSHAPED lone fighter, we compute
  //     the full standoff-band slot from scratch. Only nudges ped.target, never
  //     touches a gangs.js-owned ped. Foe may be an actor or a {x,z}. Frame-safe.
  // =========================================================================
  CBZ.cityCombatSmarts = function (ped, foe, dt) {
    if (!on() || !steerable(ped) || !ped.target) return;
    if (!hasGun(ped)) return;                          // melee charges; press/brain own it
    const F = pos(foe); if (!F) return;
    const px = ped.pos.x, pz = ped.pos.z;
    let ax = px - F.x, az = pz - F.z;                  // foe→ped axis (we face the foe)
    let d = Math.hypot(ax, az); if (d < 0.0001) { ax = 1; az = 0; d = 1; }
    ax /= d; az /= d;
    const tx = -az, tz = ax;                           // perpendicular (strafe axis)

    // STRAFE: flip the side every 1.0–1.8s so the body slides across the foe's aim
    // rather than standing still. Hurt units don't strafe (they want cover/retreat).
    ped._strafeT = (ped._strafeT || 0) - (dt || 0.016);
    if (ped._strafeT <= 0) { ped._strafeSide = (rng() < 0.5 ? -1 : 1); ped._strafeT = 1.0 + rng() * 0.8; }
    const hurt = ped.hp != null && ped.maxHp && ped.hp < ped.maxHp * 0.35;
    const strafe = hurt ? 0 : (ped._strafeSide || 1) * (2.6 + rng() * 0.8);

    let dx, dz;
    if (ped._sqRole) {
      // SHAPED this cadence → keep the lane target the shaper wrote, just slide it
      // sideways for strafe (the formation holds; the body isn't a parked target).
      dx = ped.target.x + tx * strafe * 0.5;
      dz = ped.target.z + tz * strafe * 0.5;
    } else {
      // UNSHAPED lone fighter → full standoff band: 7–11m off the foe, perpendicular
      // strafe offset. Closer → back out; farther → step in; in-band → hold + strafe.
      let want = d;
      const LO = 7, HI = 11;
      if (d < LO) want = LO + 0.6;
      else if (d > HI) want = HI - 0.6;
      dx = F.x + ax * want + tx * strafe;
      dz = F.z + az * want + tz * strafe;
    }

    // COVER: when hurt OR a cover-favoring slot, bias toward a nearby wall edge that
    // breaks the foe's line. Cheap throttled probe; only when it actually helps.
    if (hurt || ped._sqWantCover) {
      const cb = coverBias(ped, F.x, F.z, _cov);
      if (cb.has) { dx = (dx + cb.x * 1.4) / 2.4; dz = (dz + cb.z * 1.4) / 2.4; }
    }
    steerTo(ped, dx, dz);
  };

  // =========================================================================
  // (2) cityShapeSquad(leader, members[], foe): generalized squad shaper.
  //     PORT of gangs.js shapeSquad math to an arbitrary member array. Assigns the
  //     SAME transient roles the brain honors (via _sqRole, our tag), sets a single
  //     FOCUS-FIRE target, and lays shooters on a perpendicular firing arc with
  //     laned side offsets. Members already owned by gangs.js (_wRole) are skipped.
  //     Bounded to ~12 members. Returns the focus target (or null).
  // =========================================================================
  // lowest-HP live enemy within R of (x,z) on the FOE side — the kill we all pile
  // on. Falls back to the leader's own foe. Bounded scan of cityPeds.
  function pickFocus(leaderFoe, x, z, friendlySet) {
    let best = leaderFoe && !leaderFoe.dead ? leaderFoe : null;
    let bestHp = best ? (best.hp != null ? best.hp : 1e9) : 1e9;
    const R2 = 14 * 14;
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const e = peds[i];
      if (!alive(e) || friendlySet.has(e)) continue;
      if (e.surrender || e.state === "flee") continue;
      const dx = e.pos.x - x, dz = e.pos.z - z;
      if (dx * dx + dz * dz > R2) continue;
      // must be HOSTILE to the side: it's the leader's foe, or it's actively raging
      // at one of us. (We don't invent enemies — only pile on real threats.)
      const isFoe = e === leaderFoe || (e.rage && friendlySet.has(e.rage));
      if (!isFoe) continue;
      const hp = e.hp != null ? e.hp : 1e9;
      if (hp < bestHp) { bestHp = hp; best = e; }
    }
    return best;
  }

  const _fset = new Set();   // reused friendly membership set (cleared each call)

  CBZ.cityShapeSquad = function (leader, members, foe) {
    if (!on() || !members || !members.length) return null;
    // bound the roster we drive (phones + sanity)
    const cap = Math.min(members.length, 12);
    // membership set for focus-fire (who counts as "us")
    _fset.clear();
    if (leader) _fset.add(leader);
    for (let i = 0; i < cap; i++) { const m = members[i]; if (m) _fset.add(m); }

    // squad centroid + enemy locus
    let sx = 0, sz = 0, sn = 0;
    for (let i = 0; i < cap; i++) { const m = members[i]; if (!steerable(m)) continue; sx += m.pos.x; sz += m.pos.z; sn++; }
    if (leader && steerable(leader)) { sx += leader.pos.x; sz += leader.pos.z; sn++; }
    if (!sn) return null;
    _S.x = sx / sn; _S.z = sz / sn;

    // the shared enemy: explicit foe arg → else the leader's rage → else the
    // crew's nearest live hostile (focus pick around the centroid).
    let theFoe = (foe && !foe.dead) ? foe : foeOf(leader);
    const focus = pickFocus(theFoe, _S.x, _S.z, _fset) || theFoe;
    if (!focus || focus.dead) return null;
    const F = pos(focus); _E.x = F.x; _E.z = F.z;

    // axis squad→enemy and its perpendicular (firing-arc lane direction)
    let axx = _E.x - _S.x, axz = _E.z - _S.z; const al = Math.hypot(axx, axz) || 1; axx /= al; axz /= al;
    const tx = -axz, tz = axx;

    // the leader CALLS it from centre-back ONLY for a real squad (5+) — benching
    // your best gun in a 2–3 man crew is wrong (you want every barrel up), so for a
    // small crew the leader is just another arc shooter (handled in the loop). For a
    // big squad the caller holds ~16m back, centred, out of the worst of it.
    let lane = 0;
    const bigSquad = sn >= 5;
    if (bigSquad && leader && steerable(leader) && hasGun(leader)) {
      leader._sqRole = "call"; leader._sqOwn = 1;
      steerTo(leader, _E.x - axx * 16, _E.z - axz * 16);
    } else {
      leader = null;   // small crew (or unarmed leader): no bench — fan everyone
    }

    // FOCUS-FIRE: point every FREE shooter's rage at the single kill. We only set
    // rage when the unit isn't already locked onto a closer threat that's hitting
    // it — but for a coordinated team, dropping one enemy fast is the whole point.
    for (let i = 0; i < cap; i++) {
      const m = members[i];
      if (!steerable(m) || m === leader) continue;
      const fresh = m.hp != null && m.maxHp && m.hp < m.maxHp * 0.35;   // hurt → fall back
      const dry = !hasGun(m);

      if (fresh) {
        // WOUNDED: peel back to a rear lane, still facing the fight (the brain keeps
        // them oriented). axx is squad→enemy, so the rear is along -axx from the
        // enemy; a laned offset keeps two wounded from stacking on one spot.
        m._sqRole = "back"; m._sqOwn = 1; m._sqWantCover = 1;
        steerTo(m, _E.x - axx * 16 + tx * ((i % 3) - 1) * 2.5, _E.z - axz * 16 + tz * ((i % 3) - 1) * 2.5);
        continue;
      }

      if (dry) {
        // MELEE / EMPTY: press in PAIRS onto the shared mark (straight in). The
        // brain melees them once they close; we just give them the mark + a lane.
        m._sqRole = "press"; m._sqOwn = 1;
        setEngage(m, focus);
        steerTo(m, _E.x + tx * (((i % 2) ? 1 : -1) * 1.6), _E.z + tz * (((i % 2) ? 1 : -1) * 1.6));
        continue;
      }

      // ARC SHOOTER: a loose firing arc 8–14m off the enemy, laned along the front
      // so the squad forms a LINE (opposing the enemy), not a clump. Side offset is
      // a deterministic lane (±) widened per shooter; we FOCUS-FIRE the kill.
      m._sqRole = "arc"; m._sqOwn = 1; m._squadHold = 1;
      setEngage(m, focus);
      const back = 9 + (i % 3) * 1.8;                       // 9 / 10.8 / 12.6m bands
      const side = (((lane % 5) - 2) * 3.1);                // lanes: -6.2 -3.1 0 +3.1 +6.2
      lane++;
      m._sqWantCover = (i & 1) ? 1 : 0;                     // every other shooter favors cover
      steerTo(m, _E.x - axx * back + tx * side, _E.z - axz * back + tz * side);
    }
    return focus;
  };

  // clear our tags off a ped that's no longer in a shaped fight (so the brain and
  // gangs.js are never confused by stale steering ownership).
  function clearSquad(p) {
    if (!p) return;
    p._sqRole = null; p._sqOwn = 0; p._squadHold = 0; p._sqWantCover = 0;
  }

  // ORDERING. All of our passes run AFTER the order-34 ped brain pass (peds.js),
  // which is where companionThink already ran this frame (it forces a companion's
  // state='walk', clears its rage, and fired its own npcAttack). So whatever we
  // write to ped.target here is the LAST word for the frame — the body walks where
  // we put it, and next frame npcAttack fires from there.
  //
  //   34.55  SHAPE   — assign roles + lanes + focus-fire (cadenced ~5 Hz, heavy).
  //   34.59  SMARTS  — per-frame strafe + cover, COMPOSED on top of the lane slot.
  //
  // Shape lays the formation; smarts jitters it every frame. Running smarts AFTER
  // shape (higher order number) is what lets the two layers compose instead of one
  // overwriting the other.

  // =========================================================================
  // (3) SHAPE PASS — player crew squad + VIP protection details + gang-vs-gang.
  //     Cadenced (each sub-system on its own throttle) — these are the heavy scans.
  // =========================================================================
  let crewT = 0, vipT = 0, gangT = 0;

  CBZ.onUpdate(34.55, function (dt) {
    if (!on() || !inCity()) return;
    crewT -= dt; vipT -= dt; gangT -= dt;
    if (crewT <= 0) { crewT = 0.18; shapePlayerCrew(); }           // PLAYER CREW
    if (vipT <= 0)  { vipT  = 0.22; shapeProtectionDetails(); }    // VIP DETAILS
    if (gangT <= 0) { gangT = 0.20; layerGangFights(); }           // GANG vs GANG
  });

  // =========================================================================
  // (4) SMARTS PASS — per-frame standoff/strafe/cover over the active near crowd.
  //     Covers everyone WE own a slot for (_sqOwn, incl. companions) PLUS unshaped
  //     lone fighters (state==='fight'). Skips gangs.js-owned bodies. Budgeted.
  // =========================================================================
  CBZ.onUpdate(34.59, function (dt) {
    if (!on() || !inCity()) return;
    const peds = CBZ.cityPeds; if (!peds || !peds.length) return;
    const P = CBZ.player;
    const camx = P ? P.pos.x : 0, camz = P ? P.pos.z : 0;
    const NEAR2 = 60 * 60;                               // only the near, on-screen crowd
    let budget = 90;                                     // cap work per frame
    for (let i = 0; i < peds.length && budget > 0; i++) {
      const p = peds[i];
      if (!p) continue;
      if (gangOwned(p)) continue;                        // gangs.js drives this body
      // a shooter we shaped this cadence → refine its lane with strafe/cover even if
      // its state isn't 'fight' (a companion is held at 'walk' by companionThink).
      const shaped = p._sqOwn && (p._sqRole === "arc" || p._sqRole === "shield" || p._sqRole === "back");
      const lone = p.state === "fight" && p.rage && !p.rage.dead;
      if (!shaped && !lone) { if (p._sqOwn && !alive(p)) clearSquad(p); continue; }
      if (!alive(p)) { if (p._sqOwn) clearSquad(p); continue; }
      const dx = p.pos.x - camx, dz = p.pos.z - camz;
      if (dx * dx + dz * dz > NEAR2) continue;
      budget--;
      // foe: the shaped focus we pointed them at, else their own rage.
      const foe = (p.rage && !p.rage.dead) ? p.rage : (shaped ? sqFocusFor(p) : null);
      if (foe) CBZ.cityCombatSmarts(p, foe, dt);
    }
  });

  // a shaped companion has rage cleared by companionThink, so recover its foe for
  // the smarts pass: the nearest threat to it (same set companionThink shoots).
  function sqFocusFor(p) {
    // reuse the crew-threat finder for player-side bodies; else any nearby hostile.
    if (p.companion || p.recruited || p.faction === "player") return crewThreatNear(p);
    return null;
  }

  // who is a CREW member fighting / threatened by? Mirror peds.js companionThreat:
  // cops (while wanted) + anyone raging at the PLAYER, within 26m. This is "what the
  // player is fighting" from the crew's point of view — companions never set
  // state='fight' or hold a rage we can read (companionThink clears it each tick),
  // so threat-proximity is the only reliable engagement signal for them.
  function crewThreatNear(crewPed) {
    const P = CBZ.player, PA = CBZ.city && CBZ.city.playerActor;
    let best = null, bd = 26 * 26;
    const cx = crewPed.pos.x, cz = crewPed.pos.z;
    if ((g.wanted | 0) >= 1 && CBZ.cityCops) {
      const cops = CBZ.cityCops;
      for (let i = 0; i < cops.length; i++) { const c = cops[i]; if (!c || c.dead) continue; const dx = c.pos.x - cx, dz = c.pos.z - cz, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = c; } }
    }
    const peds = CBZ.cityPeds;
    for (let i = 0; i < peds.length; i++) {
      const e = peds[i];
      if (!alive(e) || e.recruited || e.companion || e.faction === "player") continue;
      if (e.rage === PA || e.rage === P || e.rage === crewPed) {     // after the player (or this crewmate)
        const dx = e.pos.x - cx, dz = e.pos.z - cz, dd = dx * dx + dz * dz;
        if (dd < bd) { bd = dd; best = e; }
      }
    }
    return best;
  }

  // gather the player's live, ENGAGED crew (a hostile is near them); when 2+ are in
  // it, shape them as ONE squad on the shared foe and focus-fire it. Runs after the
  // order-34 ped brain (companionThink included), so the smart TARGET slots we write
  // here win the frame — companions keep firing via their own npcAttack, just from a
  // spaced/cover position instead of a face-to-face bunch.
  function shapePlayerCrew() {
    _crew.length = 0;
    const peds = CBZ.cityPeds; if (!peds) return;
    let sharedFoe = null;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!alive(p)) { if (p && p._sqOwn) clearSquad(p); continue; }
      const mine = p.faction === "player" || p.recruited || p.companion;
      if (!mine) { continue; }
      if (gangOwned(p)) continue;                       // (rare) gangs.js owns it
      // ENGAGED? a non-companion is engaged when state==='fight' w/ a live rage; a
      // companion (state forced to 'walk') is engaged when a real threat is near it.
      let foe = null;
      if (p.companion) foe = crewThreatNear(p);
      else if (p.state === "fight" && p.rage && !p.rage.dead) foe = p.rage;
      if (!foe || foe.dead) { if (p._sqOwn) clearSquad(p); continue; }
      if (_crew.length < 12) _crew.push(p);
      if (!sharedFoe && !(foe.faction === "player") && !foe.recruited && !foe.companion) sharedFoe = foe;
    }
    if (_crew.length < 2) {            // a lone bodyguard fights raw (no squad to shape)
      if (_crew.length === 1) clearSquad(_crew[0]);
      return;
    }
    // field leader = the highest-HP shooter (an on-field anchor); the player is the
    // real caller but isn't a ped we steer. Everyone else fans the firing arc.
    let leader = _crew[0];
    for (let i = 1; i < _crew.length; i++) if ((_crew[i].hp || 0) > (leader.hp || 0)) leader = _crew[i];
    CBZ.cityShapeSquad(leader, _crew, sharedFoe);
  }

  // VIP protection details: every guard (_vipGuard) defends its principal. When a
  // detail has a live threat, shape ALL its guards as a squad on that threat
  // (focus-fire + arcs) AND post one guard as a SHIELD on the principal→threat line.
  // Reads vips.js fields only; never writes its slot state.
  function shapeProtectionDetails() {
    const slots = CBZ.cityVips && CBZ.cityVips.slots;
    if (!slots || !slots.length) return;
    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s];
      if (!slot) continue;
      const principal = slot.principal;
      const threat = slot.threat;
      if (!alive(principal) || !threat || threat.dead) {
        // detail at peace → release any shield tag we set
        if (slot.guards) for (let i = 0; i < slot.guards.length; i++) { const gd = slot.guards[i]; if (gd && gd._sqRole === "shield") clearSquad(gd); }
        continue;
      }
      _guards.length = 0;
      const gs = slot.guards || [];
      for (let i = 0; i < gs.length && _guards.length < 12; i++) { const gd = gs[i]; if (steerable(gd)) _guards.push(gd); }
      if (!_guards.length) continue;

      // shape the detail onto the threat. The principal is vips.js-controlled, so we
      // NEVER pass it as the squad leader (that would steer it) — instead the
      // highest-HP GUARD anchors the squad and the rest fan an arc on the threat,
      // focus-firing it. We then override one guard's role to SHIELD (below).
      let lead = _guards[0];
      for (let i = 1; i < _guards.length; i++) if ((_guards[i].hp || 0) > (lead.hp || 0)) lead = _guards[i];
      CBZ.cityShapeSquad(lead, _guards, threat);

      // SHIELD: the guard nearest the principal interposes ON the principal→threat
      // segment (a body between the VIP and the gun). WHY: a detail that lets the
      // shooter have a clean lane on the VIP isn't protecting anyone.
      let shield = null, sbd = 1e9;
      for (let i = 0; i < _guards.length; i++) {
        const gd = _guards[i];
        const dx = gd.pos.x - principal.pos.x, dz = gd.pos.z - principal.pos.z, dd = dx * dx + dz * dz;
        if (dd < sbd) { sbd = dd; shield = gd; }
      }
      if (shield) {
        shield._sqRole = "shield"; shield._sqOwn = 1; shield._squadHold = 1;
        setEngage(shield, threat);
        // stand ~2.4m off the principal toward the threat
        let vx = threat.pos.x - principal.pos.x, vz = threat.pos.z - principal.pos.z;
        const vl = Math.hypot(vx, vz) || 1; vx /= vl; vz /= vl;
        steerTo(shield, principal.pos.x + vx * 2.4, principal.pos.z + vz * 2.4);
      }
    }
  }

  // ambient gang-vs-gang: when a non-player gang is engaged, ADD focus-fire +
  // per-shooter smarts ON TOP of whatever it's doing — but if gangs.js is already
  // shaping this gang this frame (gang._eng set), DEFER: only layer focus-fire on
  // its FREE shooters and never touch a member it has war-roled (_wRole).
  function layerGangFights() {
    const gangs = CBZ.cityGangs; if (!gangs || !gangs.length) return;
    for (let gi = 0; gi < gangs.length; gi++) {
      const gang = gangs[gi];
      if (!gang || gang.isPlayer || gang.absorbed || !gang.members) continue;
      const eng = gang._eng;
      if (!eng || !eng.foe) continue;                    // not fighting → skip
      // gangs.js owns the shape (gang._eng present) → we ONLY add focus-fire to its
      // free (non-war-roled) shooters; never re-assign a role it set.
      // find the focus: lowest-HP live enemy near the engagement point.
      _fset.clear();
      let count = 0;
      for (let i = 0; i < gang.members.length && count < 14; i++) { const m = gang.members[i]; if (m && !m.dead) { _fset.add(m); count++; } }
      const ex = eng.E ? eng.E.x : 0, ez = eng.E ? eng.E.z : 0;
      const focus = pickFocus(null, ex, ez, _fset);
      if (!focus || focus.dead) continue;
      let touched = 0;
      for (let i = 0; i < gang.members.length && touched < 14; i++) {
        const m = gang.members[i];
        if (!steerable(m)) continue;
        if (gangOwned(m)) continue;                      // DEFER to gangs.js war-shape
        if (m.state !== "fight" || !m.rage || m.rage.dead) continue;
        touched++;
        // FOCUS-FIRE the shared kill (only re-point a free shooter already in it)
        if (hasGun(m) && focus !== m && _fset.has(m.rage) === false) m.rage = focus;
        // per-shooter strafe/standoff/cover on top
        CBZ.cityCombatSmarts(m, m.rage || focus, 0.2);
      }
    }
  }

  // a tiny diagnostic hook (no UI) so the owner can confirm the layer is live.
  CBZ.citySmartCombatInfo = function () {
    let owned = 0; const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) if (peds[i] && peds[i]._sqOwn) owned++;
    return { on: on(), inCity: inCity(), squadDriven: owned };
  };
})();
