/* ============================================================
   city/morgue.js — WHAT A DEATH LEAVES BEHIND, and who comes for it.

   OWNER, verbatim: "really make sure characters — even those flying
   helicopters, even those cops — they drop whatever guns and armour they had,
   and the body STAYS THERE so you can try and steal their clothes. body stays
   there until an AMBULANCE drives up and one of the stripe-shirt guys removes
   the body."

   Three separate faults, one file, because they are one arc:

   (1) THE DROP WAS PER-FILE, SO MOST DEATHS DROPPED NOTHING. peds.js's
       cityKillPed dropped a gun; police.js's cityHurtCop dropped a gun and
       stamped the armour; and TEN other death sites — combat.js, fpsmode.js,
       capture.js, killstreaks.js, reinforcements.js, predator.js (x2),
       entities/ai.js, heists.js, modes/survival.js — set `.dead = true`
       directly and left the man's rifle in his hands as the rig went stiff.
       Worse, the two that DID drop stamped ARMOUR in only ONE of them: a
       power.js close-protection guard in a plate carrier, a militia soldier,
       a SWAT operator killed by anything other than cityHurtCop — all wore a
       vest that could never be stripped, because `_armorLoot` was written in
       exactly one function. `CBZ.cityDeathDrop` is now the ONE routine, and
       it is reachable two ways: a wrap on the kill choke points (instant, the
       same frame) and a low-rate SWEEP that catches every direct `.dead =
       true` site without editing a single one of those files.

       IT KNOWS WHAT "WHERE HE FELL" MEANS. A crewman shot in a helicopter
       seat is at his seat's WORLD position — 150 m over the city. Dropping
       there puts an SMG in the sky. A drop from a body with no final rest
       (attached to a moving parent, in a car, or simply airborne) is DEFERRED
       and paid out by the sweep the moment the body is down — so the gun and
       the vest land at the wreck, with him.

   (2) BODIES VANISHED ON A TIMER. peds.js culled a corpse at deadT > 75 and
       police.js at deadT > 8 — EIGHT SECONDS for an officer, which is the
       owner's "even those cops" in one number: you could not cross the street
       to take his uniform. `CBZ.corpseMayReap` replaces both timers with a
       persistence law. The nearest CORPSE_KEEP bodies stay for as long as you
       are near them, full stop. Everything beyond the cap may be reaped only
       when it is OUT OF THE PADDED SCREEN (CBZ.npcTransitionSafe — the shared
       contract, never a private cone) and older than a floor age. A body you
       are looking at can never blink out, which is the witness law applied to
       the thing the witness is looking AT.

   (3) THE AMBULANCE NEVER CAME FOR THE BODY — IT CAME FOR THE STATISTIC.
       traffic.js already had a real ambulance (routed, curb-parking, siren,
       registered + stealable) and medics.js already had a real paramedic who
       walks, collides and lifts. They had never been introduced: peds.js
       flagged `needsPickup` on a 4-second timer, medics.js spawned a medic
       out of thin air 24 m away, and the ambulance's arrival flagged bodies
       for a stretcher team that had already come and gone on foot. This file
       is the dispatcher between them — it clusters deaths into SCENES, holds
       the unit back while the scene is still hot (real EMS stages; they do
       not walk into gunfire), sends ONE ambulance to a cluster, and hands the
       van to medics.js so the paramedic steps out of a vehicle that is
       actually there.

   ADOPTION (the block law): every seam is `CBZ.X ? CBZ.X(...) : <the line the
   caller already wrote>`, so this file failing to load restores the old
   behaviour exactly. Flags: DEATH_DROPS_V2 · CORPSE_PERSIST · EMS_RESPONSE.
   Ratchet: CBZ.morgueAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  CBZ.CONFIG = CBZ.CONFIG || {};
  const C = CBZ.CONFIG;
  if (C.DEATH_DROPS_V2 == null) C.DEATH_DROPS_V2 = true;
  if (C.CORPSE_PERSIST == null) C.CORPSE_PERSIST = true;
  if (C.EMS_RESPONSE == null) C.EMS_RESPONSE = true;

  // ---- THE CORPSE CAP, and why this number ---------------------------------
  // A corpse costs three things and only three: one record in CBZ.cityPeds /
  // CBZ.cityCops (which it ALREADY cost before this file — nothing has ever
  // spliced a dead ped out of those arrays, culled or not, so persistence adds
  // exactly zero to the ~41 files that iterate them), ~18 retained meshes in
  // the scene graph, and one matrix/frustum step per frame for as long as it
  // is IN that graph. Only the last is new, and peds.js's own render LOD
  // (VIS_D2 = 95 m) now runs on the dead branch too, so a held corpse past
  // 95 m draws nothing at all.
  //
  // 24 is sized against the live population, not taste: config.js fields ~100
  // named rigs, so the ceiling is +24% scene-graph bodies in the pathological
  // case, and reaching it means 24 dead inside one block — which is precisely
  // the scene where every one of them should still be lying there. Ordinary
  // play leaves 5-12 at a bad firefight.
  if (C.CORPSE_KEEP == null) C.CORPSE_KEEP = 24;
  const MIN_AGE = 12;          // s — a body may never be reaped younger than this
  const LEGACY_AGE = 75;       // the peds.js timer this replaces (fallback when flagged off)
  const LEGACY_COP_AGE = 8;    // the police.js timer this replaces

  // ---- EMS numbers ---------------------------------------------------------
  const CLUSTER_R = 20;        // m — deaths this close share ONE ambulance
  const CLUSTER_R2 = CLUSTER_R * CLUSTER_R;
  const EMS_MAX = 2;           // concurrent ambulances the morgue will field
  const CALM_S = 7;            // s of no fresh death at the scene before EMS rolls
  const HOT_R = 34;            // m — a live shooter inside this keeps the scene hot
  const HOT_R2 = HOT_R * HOT_R;
  const NEAR_R2 = 90 * 90;     // m² — a death this close to you is "witnessed"
  const FAR_DELAY = 25;        // s — an unwitnessed death across town waits this long
  const SCENE_TTL = 150;       // s — a scene nobody could serve is abandoned
  const UNIT_TTL = 95;         // s — one ambulance's maximum time on one scene

  // ---- audit counters ------------------------------------------------------
  let dropsSpawned = 0, collectedTotal = 0, deferredDrops = 0, sweepDrops = 0;

  function actorLists() {
    // The whole cast lives in exactly two arrays (config.js:25-26). Every
    // spawner in the game — gangs, militia, power.js details, venue staff,
    // aircraft crew, heist guards — pushes into one of them.
    return [CBZ.cityPeds, CBZ.cityCops];
  }

  // ============================================================
  //  (1) THE ONE DEATH DROP
  // ============================================================

  // A body with no FINAL RESTING PLACE yet. Dropping now would put the gun
  // wherever the transform happens to be this frame — in a seat, in a car, or
  // in the air over the city. Deferred drops are paid by the sweep.
  function unsettled(a) {
    if (a._npcAttached || a.inCar || a._airPilot || a._milPilot || a._swatPassenger) return true;
    if (!a.pos) return true;
    // airborne: more than a body-height above the floor under it
    const fy = CBZ.floorAt ? CBZ.floorAt(a.pos.x, a.pos.z) : 0;
    if (Number.isFinite(fy) && (a.pos.y - fy) > 2.2) return true;
    return false;
  }

  // What was this person carrying? Every armed actor in this codebase uses the
  // same three fields — `armed` / `weapon` / `ammo` (peds.js makePed,
  // police.js makeCop, power.js's detail off protection.js GEAR, militia,
  // venue security). A cop spawned before ammo existed falls back to the
  // number police.js used to hardcode at its own drop site.
  function carriedGun(a) {
    if (!a) return null;
    if (a.weapon) {
      const ammo = (a.ammo != null && a.ammo > 0) ? (a.ammo | 0)
        : (a.kind === "cop" ? 30 : 24);
      return { name: a.weapon, ammo: ammo };
    }
    // armed with no named weapon: the police roster is the only such shape.
    if (a.armed && a.kind === "cop") return { name: a.swat ? "SMG" : "Pistol", ammo: 30 };
    return null;
  }

  /* ------------------------------------------------------------------
     CBZ.cityDeathDrop(actor, opts) -> true if the drop was PAID this call.

     ONE-LINE ADOPTION. It REPLACES the three-to-five lines a kill site
     already writes (drop the gun, clear armed/weapon/ammo, resync the held
     prop, stamp the armour loot) — that is why it can be adopted at all.
     Idempotent per body: `_deathDropped` latches, so the wrap, the sweep and
     a file's own migrated call can all fire without duplicating the pickup.

     opts.x / opts.z  — override the drop point (a wreck, a spill point).
     opts.force       — pay even from an unsettled body (a caller that knows
                        better, e.g. it just placed the corpse itself).
     ------------------------------------------------------------------ */
  CBZ.cityDeathDrop = function (a, opts) {
    opts = opts || {};
    if (!a || a._deathDropped) return false;
    if (C.DEATH_DROPS_V2 === false) return false;
    if (!opts.force && unsettled(a)) {
      if (!a._dropPending) { a._dropPending = true; deferredDrops++; }
      return false;                       // the sweep pays this once the body lands
    }
    a._deathDropped = true;
    if (a._dropPending) { a._dropPending = false; deferredDrops = Math.max(0, deferredDrops - 1); }

    const x = opts.x != null ? opts.x : (a.pos ? a.pos.x : 0);
    const z = opts.z != null ? opts.z : (a.pos ? a.pos.z : 0);

    // --- the gun becomes a REAL ground pickup ------------------------------
    // CBZ.cityDropWeapon is peds.js's existing record + mesh (and inventory.js
    // V2 swaps the placeholder for the authored weapon model). Nothing new is
    // invented: this is the same pickup the player already walks over, and the
    // same one a live ped runs to grab (peds.js's "loot" state).
    const gun = carriedGun(a);
    if (gun && CBZ.cityDropWeapon) {
      CBZ.cityDropWeapon(x, z, gun.name, gun.ammo);
      dropsSpawned++;
      // a DEATH drop belongs to the body, so it lives as long as the body does
      // (peds.js ages ordinary drops out at 30 s — a corpse held for minutes
      // must not be lying next to a gun that evaporated).
      const arr = CBZ.cityDrops;
      const d = arr && arr[arr.length - 1];
      if (d && d.x === x && d.z === z) { d.fromDeath = true; d.body = a; }
    }
    a.armed = false; a.weapon = null; a.ammo = 0;
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(a); } catch (e) {} }

    // --- the ARMOUR becomes strippable ------------------------------------
    // interact.js's "Take armor" verb reads `_armorLoot`; armor.js's
    // cityArmorDressPed writes `_armorKit` on ANY ped it dresses. Only
    // police.js had ever connected the two, so a power.js bodyguard's plate
    // carrier and a militia vest were unlootable by construction.
    if (!a._armorLoot && a._armorKit && a._armorKit.length) a._armorLoot = a._armorKit.slice();

    return true;
  };

  // Is this drop record a death drop whose body is still on the ground?
  // peds.js's drop reaper asks; degrade-safe there (no morgue -> the old 30 s).
  CBZ.cityDropHeld = function (d) {
    if (!d || !d.fromDeath) return false;
    const b = d.body;
    return !!(b && b.dead && !b.culled && !b.collected);
  };

  // ---- WRAP THE CHOKE POINTS ----------------------------------------------
  // killfeed.js established the pattern and the reason: wrapping the public
  // kill entries reaches every caller without editing any of them, and a
  // missed hook re-tries instead of dying silently. We wrap OUTSIDE killfeed
  // (this file loads after it), so the feed line is filed first and the drop
  // lands on a body that is already confirmed dead.
  function wrapKillPed() {
    if (typeof CBZ.cityKillPed !== "function") return false;
    if (CBZ.cityKillPed._morgueWrapped) return true;
    const orig = CBZ.cityKillPed;
    const w = function (ped, imp, cause) {
      const wasDead = !ped || ped.dead;
      const r = orig.apply(this, arguments);
      if (!wasDead && ped && ped.dead) onDeath(ped);
      return r;
    };
    for (const k in orig) if (Object.prototype.hasOwnProperty.call(orig, k)) w[k] = orig[k];
    w._morgueWrapped = true;
    CBZ.cityKillPed = w;
    return true;
  }
  function wrapHurtCop() {
    if (typeof CBZ.cityHurtCop !== "function") return false;
    if (CBZ.cityHurtCop._morgueWrapped) return true;
    const orig = CBZ.cityHurtCop;
    const w = function (cop, dmg, imp) {
      const wasDead = !cop || cop.dead;
      const r = orig.apply(this, arguments);
      if (!wasDead && cop && cop.dead) onDeath(cop);
      return r;
    };
    for (const k in orig) if (Object.prototype.hasOwnProperty.call(orig, k)) w[k] = orig[k];
    w._morgueWrapped = true;
    CBZ.cityHurtCop = w;
    return true;
  }
  function hookAll() { const a = wrapKillPed(), b = wrapHurtCop(); return a && b; }
  if (!hookAll()) {
    let tries = 0;
    const iv = setInterval(function () { if (hookAll() || ++tries > 40) clearInterval(iv); }, 250);
  }

  // ============================================================
  //  (2) THE PERSISTENCE LAW
  // ============================================================

  function legacyAge(a) { return (a && a.kind === "cop") ? LEGACY_COP_AGE : LEGACY_AGE; }

  /* CBZ.corpseMayReap(actor) -> may the OWNING file cull this body now?
     Adoption at every cull site is one expression:
        (CBZ.corpseMayReap ? CBZ.corpseMayReap(p) : p.deadT > 75)
     so a build without this file culls on exactly the timer it always did. */
  CBZ.corpseMayReap = function (a) {
    if (!a || !a.dead) return false;
    if (a.collected) return true;                    // EMS took it — always reap
    const age = a.deadT || 0;
    if (C.CORPSE_PERSIST === false) return age > legacyAge(a);
    if (age < MIN_AGE) return false;
    if (a._morgueClaimed) return false;              // a paramedic is holding it RIGHT NOW
    if (a._morgueKeep) return false;                 // inside the nearest-N keep set, or being served
    // THE WITNESS LAW. npcTransitionSafe is the shared padded-screen
    // projection every population system uses; `true` means the player cannot
    // be looking at this point. minDistance 22 refuses anything at arm's
    // length even if the camera faces away — you would hear it go.
    if (CBZ.npcTransitionSafe && !CBZ.npcTransitionSafe(a.pos.x, a.pos.z, { minDistance: 22, maxDistance: 240 })) return false;
    return true;
  };

  // ============================================================
  //  (3) THE EMS ARC — scenes, staging, dispatch
  // ============================================================
  const scenes = [];
  CBZ.morgueScenes = scenes;

  function newScene(a) {
    const s = {
      x: a.pos.x, z: a.pos.z, bodies: [a],
      t0: g.elapsed || 0,          // when the scene opened
      hotAt: g.elapsed || 0,       // last fresh death here
      unit: null, unitT: 0, deployed: false, done: false,
      // WITNESSED: you were near it or it was on your screen. This is what
      // separates "the player just did this" from a sim death across the map,
      // and it is the whole of the dispatch priority.
      seen: witnessed(a),
    };
    scenes.push(s);
    return s;
  }
  function witnessed(a) {
    const P = CBZ.player;
    if (!P || !P.pos || !a.pos) return false;
    const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z;
    if (dx * dx + dz * dz < NEAR_R2) return true;
    // on screen but further out still counts — npcTransitionSafe answers
    // "can the player see this point"; false there means yes, they can.
    return !!(CBZ.npcTransitionSafe && !CBZ.npcTransitionSafe(a.pos.x, a.pos.z, { minDistance: 0, maxDistance: 300 }));
  }
  function sceneFor(a) {
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      if (s.done) continue;
      const dx = s.x - a.pos.x, dz = s.z - a.pos.z;
      if (dx * dx + dz * dz < CLUSTER_R2) return s;
    }
    return null;
  }

  // Put a body on a scene. IDEMPOTENT and re-callable, which is the point: a
  // scene that timed out unserved (the street never went quiet, the body was
  // unreachable) closes and its bodies go back in the pool, so the NEXT time
  // an ambulance could get there, one does. A closed scene must never mean a
  // body nobody will ever come for.
  function joinScene(a, fresh) {
    if (C.EMS_RESPONSE === false || !a || !a.pos) return;
    a._morgueInScene = true;
    const s = sceneFor(a);
    if (!s) { newScene(a); return; }
    if (s.bodies.indexOf(a) < 0) s.bodies.push(a);
    if (fresh) s.hotAt = g.elapsed || 0;     // a NEW body means it is NOT over
    if (!s.seen && witnessed(a)) s.seen = true;
  }

  // ONE entry point for "somebody just died here" — the wrap calls it, the
  // sweep calls it for the death sites that never route through a wrap.
  function onDeath(a) {
    if (!a || !a.pos || a._morgueSeen) return;
    a._morgueSeen = true;
    a._morgueDeathAt = g.elapsed || 0;
    CBZ.cityDeathDrop(a);                    // instant when the body is settled
    joinScene(a, true);
  }
  CBZ.morgueReportDeath = onDeath;           // any system that knows better may call it

  // A SCENE IS HOT while it is still being made. Real EMS stages: the crew
  // waits at a distance until the scene is declared safe, and that is not a
  // stat — it is why an ambulance does not roll into a live firefight here.
  // Two tests, both off state the world already keeps: a fresh death, and an
  // armed actor actually engaged nearby.
  function sceneHot(s) {
    if ((g.elapsed || 0) - s.hotAt < CALM_S) return true;
    const P = CBZ.player;
    // your own manhunt, if you are at the scene, is a live scene by definition
    if ((g.wanted | 0) >= 1 && P && P.pos) {
      const dx = P.pos.x - s.x, dz = P.pos.z - s.z;
      if (dx * dx + dz * dz < HOT_R2) return true;
    }
    const cops = CBZ.cityCops;
    if (cops) for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (!c || c.dead || !c.armed) continue;
      if (!c.sees && !c.curTarget && !c.npcTarget) continue;
      const dx = c.pos.x - s.x, dz = c.pos.z - s.z;
      if (dx * dx + dz * dz < HOT_R2) return true;
    }
    const peds = CBZ.cityPeds;
    if (peds) for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || !p.armed || !p.rage) continue;
      const dx = p.pos.x - s.x, dz = p.pos.z - s.z;
      if (dx * dx + dz * dz < HOT_R2) return true;
    }
    return false;
  }
  CBZ.morgueSceneHot = function (s) { return !!(s && sceneHot(s)); };

  // bodies at this scene still worth collecting (not already loaded/culled)
  function pending(s) {
    let n = 0;
    for (let i = 0; i < s.bodies.length; i++) {
      const b = s.bodies[i];
      if (b && b.dead && !b.collected && !b.culled) n++;
    }
    return n;
  }
  // The next body the paramedic should take: nearest to the van, so the crew
  // works outward instead of criss-crossing the street.
  CBZ.morgueNextBody = function (s, fromX, fromZ) {
    if (!s) return null;
    let best = null, bd = Infinity;
    for (let i = 0; i < s.bodies.length; i++) {
      const b = s.bodies[i];
      if (!b || !b.dead || b.collected || b.culled || b._morgueClaimed) continue;
      const dx = b.pos.x - fromX, dz = b.pos.z - fromZ, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  };
  CBZ.morgueOnCollected = function (b) {
    if (!b) return;
    collectedTotal++;
    b.collected = true;                       // peds.js / police.js cull it from here
  };
  // which scene is this ambulance working? (medics.js asks)
  CBZ.morgueUnitScene = function (e) {
    if (!e) return null;
    for (let i = 0; i < scenes.length; i++) if (scenes[i].unit === e) return scenes[i];
    return null;
  };
  // may this ambulance keep sitting at the kerb? (traffic.js asks — its own
  // "work" beat is 3.5 s, which is nowhere near long enough to load bodies.)
  CBZ.morgueUnitBusy = function (e) {
    const s = CBZ.morgueUnitScene(e);
    if (!s || s.done) return false;
    if (s.unitT > UNIT_TTL) return false;
    // a crew still out on the street holds the truck no matter what else is
    // true — loading the last body ends the SCENE, not the CALL.
    if (CBZ.cityMedicsOn && CBZ.cityMedicsOn(e) > 0) return true;
    return pending(s) > 0 || sceneHot(s);     // staging counts as busy: it WAITS
  };
  // the van has arrived and the scene is safe → medics.js may step a crew out
  CBZ.morgueUnitReady = function (e) {
    const s = CBZ.morgueUnitScene(e);
    return !!(s && !s.done && !sceneHot(s) && pending(s) > 0);
  };
  CBZ.morgueEmsLive = function () { let n = 0; for (let i = 0; i < scenes.length; i++) if (scenes[i].unit) n++; return n; };

  function releaseUnit(s) {
    if (!s.unit) return;
    const e = s.unit;
    s.unit = null; s.unitT = 0; s.deployed = false;
    if (e.target) { try { e.target._emgClaimed = false; } catch (err) {} }
    e._morgueScene = null;
    // hand the truck straight back to traffic.js's own leave state
    if (e.state === "work" || e.state === "drive") { e.state = "leave"; e.t = 0; }
  }
  // traffic.js's own dispatcher (a major aircraft impact) may commandeer a unit
  // we hold when every truck in the city is on a scene. Give up the claim
  // cleanly rather than leaving a scene pointing at a van that drove away.
  CBZ.morgueReleaseUnit = function (e) {
    for (let i = 0; i < scenes.length; i++) if (scenes[i].unit === e) { scenes[i].unit = null; scenes[i].unitT = 0; scenes[i].deployed = false; }
  };

  // ---- the tick ------------------------------------------------------------
  let scanT = 0, lastElapsed = 0;
  function reset() {
    scenes.length = 0;
    dropsSpawned = 0; collectedTotal = 0; deferredDrops = 0; sweepDrops = 0;
  }
  CBZ.morgueReset = reset;

  CBZ.onUpdate(34.5, function (dt) {
    if (!g || g.mode !== "city") return;
    if (g.elapsed + 0.001 < lastElapsed) reset();     // new life / replay
    lastElapsed = g.elapsed;
    if (g.state !== "playing") return;

    for (let i = 0; i < scenes.length; i++) if (scenes[i].unit) scenes[i].unitT += dt;
    scanT -= dt;
    if (scanT > 0) return;
    scanT = 0.5;
    const now = g.elapsed || 0;
    const P = CBZ.player;

    // ---- SWEEP: the ten death sites that never route through a wrap -------
    // combat.js, fpsmode.js, capture.js, killstreaks.js, reinforcements.js,
    // predator.js, entities/ai.js, heists.js and modes/survival.js all set
    // `.dead = true` on an actor directly. None of them is edited, and none of
    // them has to be: a dead body with no drop paid is a repair job, exactly
    // like level.js's retag pass. It ALSO pays the deferred drops — the
    // helicopter crewman whose gun could not fall until the wreck landed.
    const lists = actorLists();
    let keepPool = null;
    for (let q = 0; q < lists.length; q++) {
      const arr = lists[q]; if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        if (!a || !a.dead || a.culled || a._parked) continue;
        // never seen by a wrap → this death came from a direct `.dead = true`
        // site. onDeath pays the drop AND opens/joins the scene.
        if (!a._morgueSeen) { sweepDrops++; onDeath(a); }
        else {
          // a drop that was DEFERRED (the body was in a seat / in the air when
          // it died) is paid the moment the body is settled — at the wreck.
          if (!a._deathDropped) CBZ.cityDeathDrop(a);
          // orphaned by a scene that timed out unserved — put it back in the
          // pool so a later, calmer moment still gets it an ambulance.
          if (!a._morgueInScene && !a.collected) joinScene(a, false);
        }
        a._morgueKeep = false;
        if (a.collected) continue;              // already loaded — reaps regardless
        // keep-set candidacy: cheap squared distance, partially selected below
        if (P && P.pos) {
          const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z;
          a._morgueD2 = dx * dx + dz * dz;
        } else a._morgueD2 = 0;
        (keepPool || (keepPool = [])).push(a);
      }
    }

    // ---- THE KEEP SET: the nearest CORPSE_KEEP corpses never reap ---------
    // Partial selection, not a full sort: we only need the K smallest and K is
    // 24, so this is O(n) with a bounded insertion instead of O(n log n) over
    // a list that also contains every corpse the player will never see again.
    if (keepPool) {
      const K = Math.max(0, C.CORPSE_KEEP | 0);
      if (keepPool.length <= K) { for (let i = 0; i < keepPool.length; i++) keepPool[i]._morgueKeep = true; }
      else {
        const heap = [];
        for (let i = 0; i < keepPool.length; i++) {
          const a = keepPool[i];
          if (heap.length < K) { heap.push(a); if (heap.length === K) heap.sort(function (u, v) { return v._morgueD2 - u._morgueD2; }); }
          else if (a._morgueD2 < heap[0]._morgueD2) {
            heap[0] = a;
            // one bubble-down over 24 slots
            let j = 0;
            for (;;) {
              let m = j; const l = j * 2 + 1, r2 = l + 1;
              if (l < K && heap[l]._morgueD2 > heap[m]._morgueD2) m = l;
              if (r2 < K && heap[r2]._morgueD2 > heap[m]._morgueD2) m = r2;
              if (m === j) break;
              const t = heap[j]; heap[j] = heap[m]; heap[m] = t; j = m;
            }
          }
        }
        for (let i = 0; i < heap.length; i++) heap[i]._morgueKeep = true;
      }
    }

    if (C.EMS_RESPONSE === false) { for (let i = scenes.length - 1; i >= 0; i--) releaseUnit(scenes[i]); scenes.length = 0; return; }

    // ---- scene bookkeeping ------------------------------------------------
    for (let i = scenes.length - 1; i >= 0; i--) {
      const s = scenes[i];
      // recentre on the bodies that are actually left (a collected cluster
      // must not keep the van parked at a corner nobody is lying on)
      let n = 0, sx = 0, sz = 0;
      for (let b = s.bodies.length - 1; b >= 0; b--) {
        const body = s.bodies[b];
        if (!body || !body.dead || body.collected || body.culled) { s.bodies.splice(b, 1); continue; }
        // A BODY AN AMBULANCE IS ON ITS WAY TO NEVER REAPS, whatever the keep
        // set says. Otherwise the truck arrives at an empty kerb because the
        // 25th-nearest corpse in the city happened to be the one it was sent
        // for — and the arc the owner asked for would never complete.
        if (s.unit) body._morgueKeep = true;
        sx += body.pos.x; sz += body.pos.z; n++;
      }
      if (n) { s.x = sx / n; s.z = sz / n; }
      if (s.unit) {
        const e = s.unit;                        // unitT is accumulated every frame above
        const gone = !e || e.dead || e._reap || e.player || e.stolen || !e.grp || !e.grp.parent;
        // stolen / wrecked / despawned out from under us. Drop the claim AND
        // the back-pointer, or a truck the player boosted and abandoned stays
        // permanently invisible to traffic.js's own dispatcher.
        if (gone) { if (e) e._morgueScene = null; s.unit = null; s.deployed = false; s.unitT = 0; }
        // The scene is over when the last body is loaded AND the last crewman is
        // back in the truck — in that order. Releasing on the body alone put the
        // ambulance into its leave state while a paramedic was still walking to
        // the tailgate, and he would then trail off to the kerb on his own.
        else if ((n === 0 && !(CBZ.cityMedicsOn && CBZ.cityMedicsOn(e) > 0)) || s.unitT > UNIT_TTL) releaseUnit(s);
        else {
          // keep traffic.js aiming at a body that still exists
          const t = CBZ.morgueNextBody(s, e.pos.x, e.pos.z);
          if (t && e.target !== t) { if (e.target) e.target._emgClaimed = false; e.target = t; t._emgClaimed = true; }
          if (e.state === "drive") { e.tx = s.x; e.tz = s.z; }
        }
      }
      if (n === 0 && !s.unit) { s.done = true; scenes.splice(i, 1); continue; }
      if (now - s.t0 > SCENE_TTL && !s.unit) {
        // NOTHING COULD SERVE IT — the bodies are unreachable, or the street
        // never went quiet. The scene closes, the bodies do NOT: they keep
        // lying there under the persistence law until distance and the keep
        // cap reap them, and they are released back into the pool so a later,
        // calmer moment can still open a fresh scene over them. A closed scene
        // means no ambulance is coming YET — never that a body was deleted for
        // being inconvenient.
        for (let b = 0; b < s.bodies.length; b++) if (s.bodies[b]) s.bodies[b]._morgueInScene = false;
        s.done = true; scenes.splice(i, 1); continue;
      }
    }

    // ---- DISPATCH ---------------------------------------------------------
    // Priority is the owner's rule made arithmetic: a death you witnessed is
    // player-relevant and gets a unit now; a death across town is a statistic
    // until FAR_DELAY has passed, and then it is somebody's mother.
    if (CBZ.morgueEmsLive() < EMS_MAX && CBZ.cityDispatchEmergencyAt) {
      let best = null, bestScore = -Infinity;
      for (let i = 0; i < scenes.length; i++) {
        const s = scenes[i];
        if (s.unit || s.done) continue;
        if (sceneHot(s)) continue;                       // STAGING: do not roll into it
        const age = now - s.t0;
        if (!s.seen && age < FAR_DELAY) continue;        // off-screen deaths resolve slower
        let score = (s.seen ? 1000 : 0) + s.bodies.length * 40 + Math.min(60, age);
        if (P && P.pos) {
          const dx = s.x - P.pos.x, dz = s.z - P.pos.z;
          score -= Math.sqrt(dx * dx + dz * dz) * 0.35;  // nearer first
        }
        if (score > bestScore) { bestScore = score; best = s; }
      }
      if (best) {
        const e = CBZ.cityDispatchEmergencyAt("ambulance", best.x, best.z);
        if (e) {
          best.unit = e; best.unitT = 0; best.deployed = false;
          e._morgueScene = best;
          const t = CBZ.morgueNextBody(best, e.pos.x, e.pos.z);
          if (t) { if (e.target) e.target._emgClaimed = false; e.target = t; t._emgClaimed = true; }
        }
      }
    }
  });

  // ============================================================
  //  RATCHET — CBZ.morgueAudit()
  //    corpses        live bodies on the ground right now
  //    persisted      bodies held PAST the timer that used to delete them
  //                   (this is the owner's ask, counted: it must be > 0 the
  //                   moment anything has been dead longer than 8/75 s)
  //    collected      bodies an ambulance crew has actually removed
  //    dropsSpawned   ground weapons created by a death
  //    ambulancesLive EMS units currently assigned to a scene
  //    deferred       bodies with a drop owed but no resting place yet
  //                   (a crewman still falling) — must return to 0
  //    sweepDrops     deaths the SWEEP caught that no wrap ever saw. This is
  //                   the census of un-migrated death sites and may only go
  //                   DOWN as they are migrated.
  // ============================================================
  CBZ.morgueAudit = function () {
    let corpses = 0, persisted = 0, stripped = 0, armed = 0;
    const lists = actorLists();
    for (let q = 0; q < lists.length; q++) {
      const arr = lists[q]; if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        if (!a || !a.dead || a.culled) continue;
        corpses++;
        if ((a.deadT || 0) > legacyAge(a) && !a.collected) persisted++;
        if (a._armorLoot && !a._armorTaken) stripped++;
        if (a.armed && a.weapon) armed++;      // a corpse still holding a gun = a miss
      }
    }
    return {
      corpses: corpses,
      persisted: persisted,
      collected: collectedTotal,
      dropsSpawned: dropsSpawned,
      ambulancesLive: CBZ.morgueEmsLive(),
      scenes: scenes.length,
      lootableArmor: stripped,
      stillArmed: armed,                       // PIN AT 0 — a dead man holding a rifle
      deferred: deferredDrops,
      sweepDrops: sweepDrops,
      keep: C.CORPSE_KEEP | 0,
    };
  };
})();
