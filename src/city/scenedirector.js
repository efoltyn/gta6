/* ============================================================
   city/scenedirector.js — THE SCENE DIRECTOR (SCENE-1)

   OWNER WANT / WHY
   ----------------
   A city should AMBUSH you with life: round a corner and a stick-up is going
   down, a shooter sends a crowd stampeding, a mugger has someone cornered in a
   dark alley, a vagrant lunges out of a doorway at 2am. Left 4 Dead's AI
   Director does exactly this — a RELAX→BUILDUP cadence stages a coherent
   set-piece JUST out of view, then walks/runs it into frame, then DISBANDS it.
   Every scene here has a felt, in-world WHY (a robbery = a robber + a clerk +
   fleeing customers; a mugging = a predator + a lone mark; etc.).

   POOL DISCIPLINE (the load-bearing rule)
   ---------------------------------------
   We do NOT spawn fresh rigs for scenes. We DRAFT 1-4 existing FAR civilians
   from CBZ.cityPeds (the millionaires.js draftableCiv predicate), RE-CAST them
   into roles, and — exactly like millionaires.js releaseTycoon — RESTORE every
   drafted body to a plain civilian when the scene resolves or drifts far. So
   the headcount and draw-calls stay flat; no rig is ever leaked as a permanent
   robber/mugger. A capped fresh-body fallback only fires if the pool is short.

   STAGING (owner hates pop-in)
   ----------------------------
   A scene only assembles when an OFFSCREEN staging point exists near the player
   (camD2 > ~55² — the L4D "Active Area Set excludes the view" rule): it pops
   just out of sight, then the actors path/run INTO frame. We never morph a body
   that's currently on-screen.

   COORDINATION (no double-fire)
   -----------------------------
   aigoals.js already runs the BIG directors: bank/cash-truck robberies and the
   mass-shooter RAMPAGE. We stay in our lane — small near-player set-pieces — and
   for the MASS SHOOTER variant we DELEGATE to CBZ.cityStartRampage (aigoals owns
   the spree brain + the active cap), so the two never collide. ONE scene live at
   a time; long cooldowns after one fires.

   FLAG: CBZ.CONFIG.CITY_SCENE_DIRECTOR (self-defaulted true). Flip it false and
   the whole director goes silent — the city falls back to ambient behaviour.
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (C.CITY_SCENE_DIRECTOR == null) C.CITY_SCENE_DIRECTOR = true;
  const hyp = Math.hypot;

  // own deterministic rng stream (distinct seed from millionaires/aigoals)
  let _s = 911223;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  const ri = (a, b) => a + ((rng() * (b - a + 1)) | 0);
  const pick = (arr) => arr[(rng() * arr.length) | 0];

  function arena() { return CBZ.city && CBZ.city.arena; }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }
  function feed(m, c) { if (CBZ.cityFeed) CBZ.cityFeed(m, c || "#ff9a5a"); }
  function camD2(x, z) {
    const c = CBZ.camera; if (!c || !c.position) return 1e9;
    const dx = x - c.position.x, dz = z - c.position.z;
    return dx * dx + dz * dz;
  }
  // Close scenes cannot use the director's normal 55m offscreen ring: a
  // jumpscare that starts 55m away is not a jumpscare.  Use the actual camera
  // forward cone for nearby casting instead.  A negative dot is behind the
  // player, so a body may be claimed/spawned there without popping into view.
  function behindCamera(x, z, minD, maxD) {
    const c = CBZ.camera && CBZ.camera.position;
    const P = playerActor();
    const ox = c ? c.x : (P && P.pos ? P.pos.x : 0);
    const oz = c ? c.z : (P && P.pos ? P.pos.z : 0);
    const dx = x - ox, dz = z - oz, d2 = dx * dx + dz * dz;
    if (d2 < minD * minD || d2 > maxD * maxD) return false;
    const d = Math.sqrt(d2) || 1;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    return (dx / d) * fx + (dz / d) * fz < -0.16;
  }
  function playerActor() { return CBZ.city && CBZ.city.playerActor; }

  // staging budgets. OFFSCREEN2 = pop just out of view (then walk/run in);
  // NEAR2 = the scene must be within this of the player to be worth staging
  // (a set-piece off in an empty quarter is invisible work). FAR2 = drifted too
  // far → disband. View band a touch tighter than millionaires' 80² so scenes
  // can creep closer before triggering (they walk the last few metres in).
  const OFFSCREEN2 = 55 * 55;
  const NEAR2 = 95 * 95;
  const FAR2 = 150 * 150;

  // is it night? (mugging + hobo are night-only). Reuse the world clock if any.
  function isNight() {
    if (CBZ.cityIsNight) { try { return !!CBZ.cityIsNight(); } catch (e) {} }
    const h = (g.cityHour != null) ? g.cityHour : (CBZ.cityClock && CBZ.cityClock.hour);
    if (h == null) return false;
    return h >= 20 || h < 6;
  }

  // ---- DRAFT predicate: a free, far, plain civilian we can recast. Mirrors
  //      millionaires.js draftableCiv (kept in lock-step so we never grab a body
  //      another director already owns).
  function draftableCiv(p) {
    if (CBZ.npcLife && !CBZ.npcLife.draftableCity(p)) return false;
    if (!p || p.dead || p.isPlayer || p.vendor || p.gang || p.kind !== "civilian") return false;
    if (p.controlled || p.companion || p.recruited || p.vagrant || p._crowd || p._parked || p.inCar || p.enterT > 0) return false;
    if (p.vip || p._vipGuard || p._vipStash || p._milli || p._milliGuard) return false;
    if ((p.npcWanted | 0) || p.bounty || p.rage || p.surrender || p.reportState || p.approach || p.ko > 0) return false;
    if (p.isFamily || p.protectGang || p._clubLine || p.hostage || p.kidnapped) return false;
    if (p.rampage || p._scene) return false;                 // not already in a spree / our scene
    return true;
  }
  // draft a body OFFSCREEN and (optionally) near a staging point. Returns the
  // ped or null. Incident staging is infrequent, so inspect the complete roster:
  // a short random window made valid nearby actors easy to miss in a large city
  // and caused otherwise-ready incidents to silently fail. Prefer the closest
  // eligible body so the cast clusters without teleporting or creating a proxy.
  function draftNear(sx, sz, maxR) {
    const peds = CBZ.cityPeds || [];
    const n = peds.length; if (!n) return null;
    let best = null, bestD = Infinity;
    const start = (rng() * n) | 0;
    for (let i = 0; i < n; i++) {
      const p = peds[(start + i) % n];
      if (!draftableCiv(p)) continue;
      if (camD2(p.pos.x, p.pos.z) <= OFFSCREEN2) continue;   // never morph in view
      const d = hyp(p.pos.x - sx, p.pos.z - sz);
      if (maxR && d > maxR) continue;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
  // Existing vagrants are the first choice for the close scare: their ongoing
  // street identity is preserved by npcLife.apply/releaseProfile.  A regular
  // free civilian is an acceptable recast, but only when already behind the
  // camera and inside the playable close band.  Nobody is teleported.
  function draftHoboClose() {
    const P = playerActor(), peds = CBZ.cityPeds || [];
    if (!P || !P.pos) return null;
    let best = null, bestScore = Infinity;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      const plain = draftableCiv(p);
      const vagrant = !!(p && p.vagrant && p.group && !p.dead && !p._scene && !p.controlled &&
        !p.companion && !p.recruited && !p.inCar && !(p.ko > 0) && !p.rage && !p.reportState);
      if (!plain && !vagrant) continue;
      if (!behindCamera(p.pos.x, p.pos.z, 10, 36)) continue;
      const d = hyp(p.pos.x - P.pos.x, p.pos.z - P.pos.z);
      const score = d - (vagrant ? 20 : 0);
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }
  // a capped fresh-body fallback (only when the pool is short), like vips/milli.
  let _fresh = 0;
  const MAX_FRESH = 4;
  function makeAt(x, z, opts, profile) {
    const A = arena(); if (!A || !A.root || !CBZ.cityMakePed) return null;
    if (_fresh >= MAX_FRESH) return null;
    try {
      const p = CBZ.npcLife
        ? CBZ.npcLife.spawnCity(profile || "cityResident", { x: x, z: z, parent: A.root, rng: rng }, opts || {})
        : CBZ.cityMakePed(x, z, rng, opts || {});
      if (!p) return null;
      if (!CBZ.npcLife) { A.root.add(p.group); CBZ.cityPeds.push(p); }
      p._sceneFresh = true;
      _fresh++;
      return p;
    } catch (e) { return null; }
  }

  // ---- RESTORE a drafted body to a plain civilian (millionaires releaseTycoon
  //      pattern): strip every role flag we set so no rig is leaked.
  function restore(p) {
    if (!p) return;
    p._scene = null; p._sceneRole = null;
    // Fresh fallbacks are owned by this director, unlike claimed citizens.
    // Remove a surviving fallback when its scene ends so repeated incidents
    // never grow the roster. A dead fallback stays for the normal corpse/loot
    // pipeline—the player must not watch a body or its gun vanish.
    if (p._sceneFresh && !p.dead) {
      p._sceneFresh = false;
      _fresh = Math.max(0, _fresh - 1);
      if (CBZ.npcLife && CBZ.npcLife.destroyCity) CBZ.npcLife.destroyCity(p);
      else {
        if (p.group && p.group.parent) p.group.parent.remove(p.group);
        const i = CBZ.cityPeds ? CBZ.cityPeds.indexOf(p) : -1;
        if (i >= 0) CBZ.cityPeds.splice(i, 1);
      }
      return;
    }
    const old = p._sceneRestore || {};
    const had = function (k) { return Object.prototype.hasOwnProperty.call(old, k); };
    const managedProfile = !!(CBZ.npcLife && p._npcLifeRestore);
    if (managedProfile) CBZ.npcLife.releaseProfile(p);
    if (p.dead) return;
    p.rampage = had("rampage") ? old.rampage : false;
    p._rampArmed = had("_rampArmed") ? old._rampArmed : 0;
    p.rage = had("rage") ? old.rage : null;
    p.approach = had("approach") ? old.approach : null;
    p.vagrant = had("vagrant") ? old.vagrant : false;
    p._beg = had("_beg") ? old._beg : null;
    p._role = had("_role") ? old._role : p._role;
    if (!managedProfile) { p.armed = !!p._sceneArmed0; p.weapon = p._sceneWeapon0 || null; }
    p._sceneArmed0 = undefined; p._sceneWeapon0 = undefined; p._sceneWeaponSaved = undefined;
    p.npcWanted = had("npcWanted") ? old.npcWanted : 0;
    p.npcHeat = had("npcHeat") ? old.npcHeat : 0;
    if (!managedProfile) {
      p.kind = "civilian"; p.archetype = "resident";
      p.aggr = (p._sceneAggr0 != null) ? p._sceneAggr0 : 0.24;
      p.state = "walk";
    }
    p._sceneAggr0 = undefined;
    p.path = null; p.pause = 0.3 + rng();
    p.fear = had("fear") ? old.fear : 0;
    p.alarmed = had("alarmed") ? old.alarmed : 0;
    p.surrender = had("surrender") ? old.surrender : false;
    p._sceneRestore = null;
    p.target && p.target.set && p.target.set(p.pos.x, 0, p.pos.z);
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p);
  }
  function armBody(p, weapon, ammo) {
    if (!p) return;
    if (p._sceneArmed0 == null) p._sceneArmed0 = !!p.armed;
    if (!p._sceneWeaponSaved) { p._sceneWeapon0 = p.weapon || null; p._sceneWeaponSaved = true; }
    p.armed = true; p.weapon = weapon || "Pistol"; p.ammo = ammo || 24;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p);
  }
  function tagScene(p, role, profile, overrides) {
    if (!p._sceneRestore) {
      p._sceneRestore = {};
      const keys = ["rampage", "_rampArmed", "rage", "approach", "vagrant", "_beg", "_role",
        "npcWanted", "npcHeat", "fear", "alarmed", "surrender"];
      for (let i = 0; i < keys.length; i++) p._sceneRestore[keys[i]] = p[keys[i]];
    }
    p._scene = SCENE; p._sceneRole = role;
    if (p._sceneAggr0 == null) p._sceneAggr0 = (p.aggr != null ? p.aggr : 0.24);
    if (p._sceneArmed0 == null) p._sceneArmed0 = !!p.armed;
    if (!p._sceneWeaponSaved) { p._sceneWeapon0 = p.weapon || null; p._sceneWeaponSaved = true; }
    if (profile && CBZ.npcLife) CBZ.npcLife.apply(p, profile, overrides, true);
  }

  // ============================================================
  //  ONE LIVE SCENE — the director's state. Only one set-piece runs at a time.
  // ============================================================
  const SCENE = {
    kind: null,        // 'robbery' | 'shooter' | 'mugging' | 'hobo' | 'hitman' | null
    actors: [],        // drafted bodies (restored on disband)
    anchor: null,      // {x,z} staging/target point
    t: 0,              // seconds the scene has been live
    ttl: 0,            // hard cap so a stuck scene always disbands
    beatCD: 0,         // sub-beat timer (gunshot ticks, etc.)
  };
  let _cooldown = 8;   // seconds until the FIRST scene may fire (after load)
  // ---- L4D ADAPTIVE PACING (PROCGEN.md #5): a decaying TENSION accumulator
  // gates staging on top of the cooldown. Combat, heat, and a just-fired
  // scene push tension up; calm decays it. Scenes only stage once the street
  // has genuinely settled — quiet stretches BUILD toward a set-piece instead
  // of a timer firing into the middle of a gunfight's afterglow.
  let _tension = 0;
  function tickTension(dt) {
    const P = playerActor();
    let target = 0;
    if (P && P._fighting > 0) target = Math.max(target, 1);
    target = Math.max(target, Math.min(1, (g.wanted | 0) / 3));
    if (liveScene()) target = Math.max(target, 0.8);
    // fast rise toward danger, slow decay toward calm (~20s to settle)
    if (target > _tension) _tension += (target - _tension) * Math.min(1, dt * 2.5);
    else _tension = Math.max(0, _tension - dt * 0.05);
  }

  function liveScene() { return SCENE.kind != null; }

  // ---- CAMPAIGN COMPOSITION (campaign.js) ----------------------------------
  // The hitman campaign allows ambient set-pieces only during its ENDLESS
  // free-time (scripted beats own their own cadence). It also publishes the
  // active contract point; we never stage a robbery/mugging on top of the
  // player's live assignment — the two directors would fight over the street.
  function campaignBlocked() {
    return !!(CBZ.cityCampaignScenesBlocked && CBZ.cityCampaignScenesBlocked());
  }
  function nearCampaignContract(x, z) {
    if (!CBZ.cityCampaignContractPoint) return false;
    let p = null;
    try { p = CBZ.cityCampaignContractPoint(); } catch (e) { p = null; }
    if (!p) return false;
    return hyp(x - p.x, z - p.z) < 45;
  }

  function disband() {
    for (let i = 0; i < SCENE.actors.length; i++) restore(SCENE.actors[i]);
    SCENE.actors.length = 0;
    SCENE.kind = null; SCENE.anchor = null; SCENE.t = 0; SCENE.ttl = 0; SCENE.beatCD = 0;
    // a LONGER calm right after a scene fires (L4D relax) — staggered so back-to-
    // back set-pieces never feel scripted. 35-70s base, +bias if player's hot.
    _cooldown = 35 + rng() * 35;
  }

  // a posted gunshot drives the existing crowd-flee bus (cityevents.js) — this
  // is the plumbing that makes nearby clerks + customers actually scatter.
  function gunshotAt(x, z, r, intensity) {
    if (CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "gunshot", pos: { x: x, z: z }, radius: r || 30, intensity: intensity != null ? intensity : 1 });
    if (CBZ.cityPanic) CBZ.cityPanic(x, z, intensity != null ? intensity * 1.4 : 1.6, SCENE.actors[0] || null);
  }

  // find a believable OFFSCREEN staging point near the player. Prefer a sidewalk
  // point in the offscreen ring; returns null if none found (skip this tick).
  function stagePoint() {
    const A = arena(); const P = playerActor();
    if (!A || !P) return null;
    for (let t = 0; t < 14; t++) {
      const p = A.weightedSidewalkPoint ? A.weightedSidewalkPoint(rng) : (A.randomSidewalkPoint ? A.randomSidewalkPoint() : null);
      if (!p) break;
      if (nearCampaignContract(p.x, p.z)) continue;   // never stage on the live contract
      const d2 = hyp(p.x - P.pos.x, p.z - P.pos.z); const dd = d2 * d2;
      if (dd <= NEAR2 && camD2(p.x, p.z) > OFFSCREEN2) return { x: p.x, z: p.z };
    }
    return null;
  }
  // a shop lot with a vendor, a believable distance from the player, OFFSCREEN.
  function nearRobbableShop() {
    const A = arena(); const P = playerActor();
    if (!A || !A.shopLots || !P) return null;
    let best = null, bestD = -1;
    for (let i = 0; i < A.shopLots.length; i++) {
      const l = A.shopLots[i];
      const b = l && l.building;
      const vs = b && b.vendorSpot;
      if (!vs || vs.x == null) continue;
      if (l.kind === "bank") continue;                 // banks are aigoals' big-job remit
      const d = hyp(vs.x - P.pos.x, vs.z - P.pos.z);
      if (d < 25 || d > 90) continue;                  // close enough to find, not in your lap
      if (camD2(vs.x, vs.z) <= OFFSCREEN2) continue;   // stage out of view
      if (nearCampaignContract(vs.x, vs.z)) continue;  // the contract lot is off-limits
      if (d > bestD) { bestD = d; best = l; }
    }
    return best;
  }

  // ============================================================
  //  SCENE ASSEMBLERS — each drafts its cast, casts roles, kicks the WHY off.
  //  Return true on a successful stage (the director commits to it).
  // ============================================================

  // (a) STORE ROBBERY — a lone armed robber paths to a shop counter; the gunshot
  //     beat makes the clerk + nearby shoppers flee. NPC self-wanteds (cops hunt
  //     the robber, not the player). Distinct from aigoals' multi-man bank crews.
  function stageRobbery() {
    const lot = nearRobbableShop(); if (!lot) return false;
    const vs = lot.building.vendorSpot;
    const robber = draftNear(vs.x, vs.z, 60) || makeAt(vs.x + (rng() - 0.5) * 4, vs.z + 6, {}, "cityResident");
    if (!robber) return false;
    tagScene(robber, "robber", "hostileAttacker", { weapon: "Pistol", ammo: 18 });
    armBody(robber, "Pistol", 18);
    robber.aggr = 0.9; robber.kind = "civilian"; robber.archetype = "thug";
    robber.fear = 0; robber.alarmed = 0; robber.surrender = false;
    // route to the counter: peds.js walks them there; we hold the target.
    robber.state = "walk"; robber.path = null;
    if (robber.target && robber.target.set) robber.target.set(vs.x, 0, vs.z);
    robber._goalKind = "scene-rob";
    SCENE.kind = "robbery"; SCENE.actors = [robber];
    SCENE.anchor = { x: vs.x, z: vs.z, lot: lot };
    SCENE.t = 0; SCENE.ttl = 40; SCENE.beatCD = 0;
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(robber, 70, "armed-robbery");
    if ((robber.npcWanted | 0) < 2) robber.npcWanted = 2;
    return true;
  }

  // (b) MASS SHOOTER — DELEGATE the spree to aigoals (it owns the brain + cap),
  //     then SUSTAIN the gunshot beats so the crowd-flee bus keeps the street
  //     stampeding. We only "own" the staging + the sustained panic ticks.
  function stageShooter() {
    const sp = stagePoint(); if (!sp) return false;
    const shooter = draftNear(sp.x, sp.z, 70);
    if (!shooter) return false;             // no fresh fallback: a rampage needs a real body
    tagScene(shooter, "shooter", "terrorAttacker");
    // hand it to aigoals — it sets rampage, self-wanted, the spree pathing.
    if (CBZ.cityStartRampage) {
      const ok = CBZ.cityStartRampage(shooter);
      if (!ok) { restore(shooter); return false; }
    } else {
      // aigoals absent → drive a minimal rampage ourselves so the scene still reads
      armBody(shooter, "AK-47", 90);
      shooter.rampage = true; shooter.rage = playerActor() || null;
      shooter.kind = "civilian"; shooter.aggr = 0.95;
      if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(shooter, 90, "active-shooter");
      if ((shooter.npcWanted | 0) < 3) shooter.npcWanted = 3;
    }
    SCENE.kind = "shooter"; SCENE.actors = [shooter];
    SCENE.anchor = { x: sp.x, z: sp.z };
    SCENE.t = 0; SCENE.ttl = 28; SCENE.beatCD = 0.4;
    feed("Gunfire reported — get clear!", "#ff7a5a");
    return true;
  }

  // (c) MUGGING — night only. A predator corners a lone commuter on a dark side
  //     street (no crowd). We draft two: aggressor + mark. The aggressor uses the
  //     ped brain's approach/threaten path; the mark cowers, then flees.
  function stageMugging() {
    if (!isNight()) return false;
    const sp = stagePoint(); if (!sp) return false;
    // a lone mark first (closest free body to the staging point)
    const mark = draftNear(sp.x, sp.z, 55); if (!mark) return false;
    const mx = mark.pos.x, mz = mark.pos.z;
    if (camD2(mx, mz) <= OFFSCREEN2) return false;
    const mugger = draftNear(mx, mz, 40);
    if (!mugger || mugger === mark) return false;
    tagScene(mark, "mark"); tagScene(mugger, "mugger", "hostileAttacker", { weapon: "Knife", ammo: 0 });
    // the mugger advances on the mark with a knife-out menace (uses ped approach)
    armBody(mugger, "Knife", 0);
    mugger.aggr = 0.85; mugger.kind = "civilian"; mugger.archetype = "thug";
    mugger.rage = mark; mugger.state = "fight";
    if (mugger.target && mugger.target.set) mugger.target.set(mx, 0, mz);
    mugger.approach = "rob";
    // the mark freezes (hands-up), then breaks for it once the beat plays
    mark.fear = 3; mark.surrender = true; mark.state = "idle";
    if (mark.target && mark.target.set) mark.target.set(mx, 0, mz);
    SCENE.kind = "mugging"; SCENE.actors = [mugger, mark];
    SCENE.anchor = { x: mx, z: mz };
    SCENE.t = 0; SCENE.ttl = 24; SCENE.beatCD = 0;
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(mugger, 45, "mugging");
    return true;
  }

  // (d) HOBO JUMPSCARE — night only, CLOSE to the player. A vagrant lunges out of
  //     a doorway with a bark. We reuse the peds.js vagrant-scare brain (vagrant
  //     + _beg + approach), which already does the lunge + camera flinch.
  function stageHobo() {
    if (!isNight()) return false;
    const P = playerActor(); if (!P) return false;
    // Prefer a real homeless resident already close behind the player. If the
    // local cast has none, pick a behind-camera sidewalk and build one through
    // the same standard actor factory used everywhere else. The former test
    // required a point to be both <28m from the player and >55m from the camera,
    // making this entire scene mathematically unreachable in normal play.
    const A = arena(); if (!A) return false;
    let hobo = draftHoboClose();
    let sp = hobo ? { x: hobo.pos.x, z: hobo.pos.z } : null;
    if (!sp) {
      for (let t = 0; t < 24; t++) {
        const p = A.weightedSidewalkPoint ? A.weightedSidewalkPoint(rng) : (A.randomSidewalkPoint ? A.randomSidewalkPoint() : null);
        if (!p) break;
        if (nearCampaignContract(p.x, p.z) || !behindCamera(p.x, p.z, 12, 32)) continue;
        sp = { x: p.x, z: p.z }; break;
      }
      if (!sp) return false;
      hobo = makeAt(sp.x, sp.z, {}, "homelessScare");
    }
    if (!hobo) return false;
    tagScene(hobo, "hobo", "homelessScare");
    hobo.vagrant = true; hobo._role = "panhandler";
    hobo._beg = { x: sp.x, z: sp.z };
    hobo.archetype = "vagrant"; hobo.job = "panhandling";
    hobo.aggr = Math.max(hobo.aggr || 0, 0.78);    // volatile band → peds.js makes it LUNGE
    hobo.approach = "beg";                          // peds.js scare brain takes the wheel
    hobo.state = "walk"; hobo.path = null;
    if (hobo.target && hobo.target.set) hobo.target.set(P.pos.x, 0, P.pos.z);
    SCENE.kind = "hobo"; SCENE.actors = [hobo];
    SCENE.anchor = { x: sp.x, z: sp.z };
    SCENE.t = 0; SCENE.ttl = 14; SCENE.beatCD = 0;
    return true;
  }

  // (e) CONTRACT HIT — a rare, contained hit between two ordinary residents.
  // It uses the same reusable profile/cast pipeline as every other incident;
  // no dedicated hitman body exists and only one scene can ever run at once.
  function stageHitman() {
    const sp = stagePoint(); if (!sp) return false;
    const mark = draftNear(sp.x, sp.z, 55); if (!mark) return false;
    tagScene(mark, "contract-mark");       // reserve it before drafting the killer
    const killer = draftNear(mark.pos.x, mark.pos.z, 45);
    if (!killer || killer === mark) { restore(mark); return false; }
    tagScene(killer, "hitman", "hitman");
    killer.rage = mark; killer.state = "fight"; killer.path = null;
    killer.fear = 0; killer.alarmed = 0; killer.surrender = false;
    if (killer.target && killer.target.set) killer.target.set(mark.pos.x, 0, mark.pos.z);
    mark.state = "walk"; mark.pause = 0;
    SCENE.kind = "hitman"; SCENE.actors = [killer, mark];
    SCENE.anchor = { x: mark.pos.x, z: mark.pos.z };
    SCENE.t = 0; SCENE.ttl = 22; SCENE.beatCD = 0;
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(killer, 65, "contract-hit");
    if ((killer.npcWanted | 0) < 2) killer.npcWanted = 2;
    return true;
  }

  // weighted scene draw. Night unlocks mugging + hobo; day is robbery/shooter.
  function tryStage() {
    const night = isNight();
    // bias: robberies are the bread-and-butter; shooters rarer; night adds the
    // two intimate scares. Build a small weighted menu, then attempt in order.
    const menu = [];
    menu.push("robbery", "robbery");
    menu.push("shooter", "hitman");
    if (night) { menu.push("mugging", "mugging", "hobo"); }
    // try up to 3 distinct picks so one failed stage (no shop/no body) still
    // gives another scene a shot this tick.
    let tried = {};
    for (let k = 0; k < 4; k++) {
      const kind = pick(menu);
      if (tried[kind]) continue; tried[kind] = 1;
      let ok = false;
      if (kind === "robbery") ok = stageRobbery();
      else if (kind === "shooter") ok = stageShooter();
      else if (kind === "mugging") ok = stageMugging();
      else if (kind === "hobo") ok = stageHobo();
      else if (kind === "hitman") ok = stageHitman();
      if (ok) return true;
    }
    return false;
  }

  // ============================================================
  //  RUNNING the live scene — sustain beats, detect resolve/drift, disband.
  // ============================================================
  function runScene(dt) {
    SCENE.t += dt; SCENE.ttl -= dt;
    const a0 = SCENE.actors[0];
    // hard timeout, or the lead actor died / got culled / left the roster →
    // disband (and restore the survivors).
    if (SCENE.ttl <= 0 || !a0 || a0.dead || (CBZ.cityPeds && CBZ.cityPeds.indexOf(a0) < 0)) { disband(); return; }
    // drifted far from the player AND offscreen → the moment's over, let it go.
    const an = SCENE.anchor;
    if (an) {
      const P = playerActor();
      if (P && hyp(an.x - P.pos.x, an.z - P.pos.z) > Math.sqrt(FAR2) && camD2(an.x, an.z) > OFFSCREEN2) { disband(); return; }
    }

    if (SCENE.kind === "robbery") {
      // the robber reaches the counter → fire the stick-up beat ONCE (gunshot
      // event scatters the clerk + shoppers), then they bolt with the heat.
      const vs = SCENE.anchor;
      const d = hyp(a0.pos.x - vs.x, a0.pos.z - vs.z);
      if (!SCENE._popped) {
        if (d < 3.2) {
          SCENE._popped = true;
          gunshotAt(vs.x, vs.z, 26, 1.0);
          if (CBZ.cityCrime) { try { CBZ.cityCrime(0, { x: vs.x, z: vs.z, type: "robbery", silent: true }); } catch (e) {} }
          feed("Store robbery in progress!", "#ff9a5a");
          a0._goalKind = null;
        } else if (a0.state === "idle" || (a0.target && hyp(a0.target.x - vs.x, a0.target.z - vs.z) > 1)) {
          a0.state = "walk"; if (a0.target && a0.target.set) a0.target.set(vs.x, 0, vs.z); a0.path = null;
        }
      } else {
        // after the score: the robber flees; disband when they're clear/offscreen.
        if (!SCENE._fled) { SCENE._fled = true; if (CBZ.cityFleeFrom) CBZ.cityFleeFrom(a0, vs.x, vs.z); a0.state = "flee"; }
        if (SCENE.t > 8 && camD2(a0.pos.x, a0.pos.z) > OFFSCREEN2) disband();
      }
      return;
    }

    if (SCENE.kind === "shooter") {
      // SUSTAIN the panic: aigoals' rampage brain does the shooting; we keep the
      // crowd-flee bus fed with periodic gunshot events around the shooter so the
      // whole street keeps scattering (the brain's own shots only scare a radius).
      SCENE.beatCD -= dt;
      if (SCENE.beatCD <= 0) {
        SCENE.beatCD = 0.6 + rng() * 0.7;
        if (camD2(a0.pos.x, a0.pos.z) < 160 * 160) gunshotAt(a0.pos.x, a0.pos.z, 34, 1.0);
      }
      // aigoals owns the spree's life; if the brain cleared the flag (down/arrested)
      // the lead-actor check above disbands us next tick. Also cap our involvement
      // by ttl so we don't babysit a cross-town spree forever.
      return;
    }

    if (SCENE.kind === "mugging") {
      const mugger = SCENE.actors[0], mark = SCENE.actors[1];
      if (!mark || mark.dead) { disband(); return; }
      // the menace plays for a beat, then the mark breaks and runs (and the mugger
      // either chases briefly or we wrap it). A short, contained scare.
      if (!SCENE._broke && SCENE.t > 2.5) {
        SCENE._broke = true;
        mark.surrender = false; mark.fear = 4; mark.state = "flee";
        if (CBZ.cityFleeFrom) CBZ.cityFleeFrom(mark, mugger.pos.x, mugger.pos.z);
        if (CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "scream", pos: { x: mark.pos.x, z: mark.pos.z }, radius: 18, intensity: 0.6 });
      }
      if (SCENE.t > 9) disband();
      return;
    }

    if (SCENE.kind === "hobo") {
      // the peds.js vagrant-scare brain drives the lunge/bark; we just keep the
      // target on the player for a beat, then disband (the moment is brief).
      const P = playerActor();
      if (P && a0.approach && hyp(a0.pos.x - P.pos.x, a0.pos.z - P.pos.z) < 24) {
        if (a0.target && a0.target.set) a0.target.set(P.pos.x, 0, P.pos.z);
      }
      if (SCENE.t > 10) disband();
      return;
    }

    if (SCENE.kind === "hitman") {
      const killer = SCENE.actors[0], mark = SCENE.actors[1];
      if (!mark || mark.dead || (CBZ.cityPeds && CBZ.cityPeds.indexOf(mark) < 0)) { disband(); return; }
      const d = hyp(killer.pos.x - mark.pos.x, killer.pos.z - mark.pos.z);
      killer.rage = mark; killer.state = "fight";
      if (killer.target && killer.target.set) killer.target.set(mark.pos.x, 0, mark.pos.z);
      if (!SCENE._popped && d < 15) {
        SCENE._popped = true;
        gunshotAt(killer.pos.x, killer.pos.z, 28, 0.9);
        mark.fear = Math.max(mark.fear || 0, 4); mark.state = "flee";
        if (CBZ.cityFleeFrom) CBZ.cityFleeFrom(mark, killer.pos.x, killer.pos.z);
      }
      if (SCENE.t > 16 && camD2(killer.pos.x, killer.pos.z) > OFFSCREEN2) disband();
      return;
    }
  }

  // ============================================================
  //  THE TICK — CBZ.citySceneTick + the registered onUpdate(36.2).
  //  RELAX→BUILDUP: a cooldown gates the next scene; we only fire when the
  //  player is in city mode, not draining, not already wanted/in-combat, and an
  //  offscreen stage exists. One scene at a time.
  // ============================================================
  function gatesOpen() {
    if (g.mode !== "city") return false;
    if (CBZ.CONFIG.CITY_SCENE_DIRECTOR === false) return false;
    if (campaignBlocked()) return false;                // scripted campaign beat owns the street
    if (CBZ.citySpawnDraining) return false;            // wait until the roster's whole
    const P = playerActor(); if (!P || P.dead) return false;
    if ((g.wanted | 0) >= 2) return false;              // you've got your own heat — no piling on
    if (P._fighting > 0) return false;                  // mid-brawl: don't stack a set-piece
    if (g.state && g.state !== "playing") return false;
    return true;
  }

  CBZ.citySceneTick = function () {
    // a hand-callable entry (debug / external pacing). Mirrors the onUpdate body
    // but with a fixed small dt so a manual call still advances a live scene.
    sceneTick(1 / 30);
  };

  function sceneTick(dt) {
    if (g.mode !== "city") { if (liveScene()) disband(); return; }
    // A scripted campaign beat taking over mid-scene reclaims the street: the
    // drafted cast is restored to plain civilians, exactly like a far drift.
    if (campaignBlocked()) { if (liveScene()) disband(); return; }
    const A = arena(); if (!A || !CBZ.cityPeds || !CBZ.cityPeds.length) return;

    if (liveScene()) { runScene(dt); return; }

    // RELAX: count the cooldown down; only attempt a stage when it expires and
    // all gates are open. A failed attempt re-arms a SHORT retry (so a transient
    // "no offscreen stage" doesn't waste the whole long cooldown).
    tickTension(dt);
    if (_cooldown > 0) { _cooldown -= dt; return; }
    if (_tension > 0.25) { _cooldown = 4 + rng() * 4; return; }   // street hasn't settled — keep building
    if (!gatesOpen()) { _cooldown = 3 + rng() * 4; return; }
    const staged = tryStage();
    if (staged) {
      // committed — clear the per-scene one-shot latches.
      SCENE._popped = false; SCENE._fled = false; SCENE._broke = false;
    } else {
      _cooldown = 6 + rng() * 8;     // nothing assembled this beat — try again soon
    }
  }

  // order 36.2 — a free slot just after millionaires (35.8). City-gated inside.
  CBZ.onUpdate(36.2, function (dt) {
    sceneTick(dt);
  });

  // a fresh city must not inherit a stale scene (drafted bodies are recycled
  // when the roster rebuilds; drop our refs + reset the cadence). Best-effort
  // hook into the spawn reset chain if a sibling exposes one.
  CBZ.citySceneReset = function () {
    for (let i = 0; i < SCENE.actors.length; i++) restore(SCENE.actors[i]);
    SCENE.actors.length = 0;
    SCENE.kind = null; SCENE.anchor = null; SCENE.t = 0; SCENE.ttl = 0;
    SCENE._popped = false; SCENE._fled = false; SCENE._broke = false;
    _fresh = 0; _cooldown = 12 + rng() * 18;
  };

  // Focused, read-mostly instrumentation for browser regressions.  `stage` is
  // intentionally explicit (never called by gameplay) so tests can prove each
  // authored incident assembles real actors instead of waiting through a
  // random 35-70 second pacing window.
  CBZ.citySceneDirector = {
    status: function () {
      return {
        kind: SCENE.kind,
        actorCount: SCENE.actors.length,
        actorProfiles: SCENE.actors.map(function (a) { return a && a._npcProfile || null; }),
        actorRoles: SCENE.actors.map(function (a) { return a && a._sceneRole || null; }),
        cooldown: _cooldown,
        tension: _tension,
      };
    },
    stage: function (kind) {
      if (liveScene()) disband();
      const fn = kind === "robbery" ? stageRobbery
        : kind === "shooter" ? stageShooter
          : kind === "mugging" ? stageMugging
            : kind === "hobo" ? stageHobo
              : kind === "hitman" ? stageHitman : null;
      const ok = !!(fn && fn());
      if (ok) { SCENE._popped = false; SCENE._fled = false; SCENE._broke = false; }
      return ok;
    },
    clear: function () { if (liveScene()) disband(); },
  };
})();
