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
    if (!p || p.dead || p.isPlayer || p.vendor || p.gang || p.kind !== "civilian") return false;
    if (p.controlled || p.companion || p.recruited || p.vagrant || p._crowd || p._parked || p.inCar || p.enterT > 0) return false;
    if (p.vip || p._vipGuard || p._vipStash || p._milli || p._milliGuard) return false;
    if ((p.npcWanted | 0) || p.bounty || p.rage || p.surrender || p.reportState || p.approach || p.ko > 0) return false;
    if (p.isFamily || p.protectGang || p._clubLine || p.hostage || p.kidnapped) return false;
    if (p.rampage || p._scene) return false;                 // not already in a spree / our scene
    return true;
  }
  // draft a body OFFSCREEN and (optionally) near a staging point. Returns the
  // ped or null. We pull from a bounded random sample so it's cheap on a big
  // roster; prefer one closest to the staging point so the cast clusters.
  function draftNear(sx, sz, maxR) {
    const peds = CBZ.cityPeds || [];
    const n = peds.length; if (!n) return null;
    let best = null, bestD = Infinity;
    const start = (rng() * n) | 0;
    let scanned = 0;
    for (let i = 0; i < n && scanned < 60; i++) {
      const p = peds[(start + i) % n];
      if (!draftableCiv(p)) continue;
      if (camD2(p.pos.x, p.pos.z) <= OFFSCREEN2) continue;   // never morph in view
      scanned++;
      const d = hyp(p.pos.x - sx, p.pos.z - sz);
      if (maxR && d > maxR) continue;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }
  // a capped fresh-body fallback (only when the pool is short), like vips/milli.
  let _fresh = 0;
  const MAX_FRESH = 4;
  function makeAt(x, z, opts) {
    const A = arena(); if (!A || !A.root || !CBZ.cityMakePed) return null;
    if (_fresh >= MAX_FRESH) return null;
    try {
      const p = CBZ.cityMakePed(x, z, rng, opts || {});
      if (!p) return null;
      A.root.add(p.group); CBZ.cityPeds.push(p); _fresh++;
      return p;
    } catch (e) { return null; }
  }

  // ---- RESTORE a drafted body to a plain civilian (millionaires releaseTycoon
  //      pattern): strip every role flag we set so no rig is leaked.
  function restore(p) {
    if (!p) return;
    p._scene = null; p._sceneRole = null;
    if (p.dead) return;
    p.rampage = false; p._rampArmed = 0;
    p.rage = null; p.approach = null; p.vagrant = false; p._beg = null;
    p.armed = !!p._sceneArmed0; p.weapon = p._sceneWeapon0 || null;
    p._sceneArmed0 = undefined; p._sceneWeapon0 = undefined;
    p.npcWanted = 0; p.npcHeat = 0;
    p.kind = "civilian"; p.archetype = "resident";
    p.aggr = (p._sceneAggr0 != null) ? p._sceneAggr0 : 0.24; p._sceneAggr0 = undefined;
    p.state = "walk"; p.path = null; p.pause = 0.3 + rng();
    p.fear = 0; p.alarmed = 0; p.surrender = false; p.target && p.target.set && p.target.set(p.pos.x, 0, p.pos.z);
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p);
  }
  function armBody(p, weapon, ammo) {
    if (!p) return;
    p._sceneArmed0 = !!p.armed; p._sceneWeapon0 = p.weapon || null;
    p.armed = true; p.weapon = weapon || "Pistol"; p.ammo = ammo || 24;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(p);
  }
  function tagScene(p, role) {
    p._scene = SCENE; p._sceneRole = role;
    if (p._sceneAggr0 == null) p._sceneAggr0 = (p.aggr != null ? p.aggr : 0.24);
  }

  // ============================================================
  //  ONE LIVE SCENE — the director's state. Only one set-piece runs at a time.
  // ============================================================
  const SCENE = {
    kind: null,        // 'robbery' | 'shooter' | 'mugging' | 'hobo' | null
    actors: [],        // drafted bodies (restored on disband)
    anchor: null,      // {x,z} staging/target point
    t: 0,              // seconds the scene has been live
    ttl: 0,            // hard cap so a stuck scene always disbands
    beatCD: 0,         // sub-beat timer (gunshot ticks, etc.)
  };
  let _cooldown = 8;   // seconds until the FIRST scene may fire (after load)

  function liveScene() { return SCENE.kind != null; }

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
    const robber = draftNear(vs.x, vs.z, 60) || makeAt(vs.x + (rng() - 0.5) * 4, vs.z + 6, { armed: true, aggr: 0.85, archetype: "thug" });
    if (!robber) return false;
    tagScene(robber, "robber");
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
    // hand it to aigoals — it sets rampage, self-wanted, the spree pathing.
    if (CBZ.cityStartRampage) {
      const ok = CBZ.cityStartRampage(shooter);
      if (!ok) return false;
    } else {
      // aigoals absent → drive a minimal rampage ourselves so the scene still reads
      armBody(shooter, "AK-47", 90);
      shooter.rampage = true; shooter.rage = playerActor() || null;
      shooter.kind = "civilian"; shooter.aggr = 0.95;
      if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(shooter, 90, "active-shooter");
      if ((shooter.npcWanted | 0) < 3) shooter.npcWanted = 3;
    }
    tagScene(shooter, "shooter");
    SCENE.kind = "shooter"; SCENE.actors = [shooter];
    SCENE.anchor = { x: sp.x, z: sp.z };
    SCENE.t = 0; SCENE.ttl = 28; SCENE.beatCD = 0.4;
    feed("🔫 Gunfire reported — get clear!", "#ff7a5a");
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
    tagScene(mark, "mark"); tagScene(mugger, "mugger");
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
    // a staging point CLOSE (the jumpscare needs to be near) but still offscreen.
    const A = arena(); if (!A) return false;
    let sp = null;
    for (let t = 0; t < 12; t++) {
      const p = A.weightedSidewalkPoint ? A.weightedSidewalkPoint(rng) : (A.randomSidewalkPoint ? A.randomSidewalkPoint() : null);
      if (!p) break;
      const d = hyp(p.x - P.pos.x, p.z - P.pos.z);
      if (d < 28 && camD2(p.x, p.z) > OFFSCREEN2) { sp = { x: p.x, z: p.z }; break; }
    }
    if (!sp) return false;
    const hobo = draftNear(sp.x, sp.z, 30); if (!hobo) return false;
    tagScene(hobo, "hobo");
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

  // weighted scene draw. Night unlocks mugging + hobo; day is robbery/shooter.
  function tryStage() {
    const night = isNight();
    // bias: robberies are the bread-and-butter; shooters rarer; night adds the
    // two intimate scares. Build a small weighted menu, then attempt in order.
    const menu = [];
    menu.push("robbery", "robbery");
    menu.push("shooter");
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
          feed("🚨 Store robbery in progress!", "#ff9a5a");
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
    const A = arena(); if (!A || !CBZ.cityPeds || !CBZ.cityPeds.length) return;

    if (liveScene()) { runScene(dt); return; }

    // RELAX: count the cooldown down; only attempt a stage when it expires and
    // all gates are open. A failed attempt re-arms a SHORT retry (so a transient
    // "no offscreen stage" doesn't waste the whole long cooldown).
    if (_cooldown > 0) { _cooldown -= dt; return; }
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
    SCENE.actors.length = 0;
    SCENE.kind = null; SCENE.anchor = null; SCENE.t = 0; SCENE.ttl = 0;
    SCENE._popped = false; SCENE._fled = false; SCENE._broke = false;
    _fresh = 0; _cooldown = 12 + rng() * 18;
  };
})();
