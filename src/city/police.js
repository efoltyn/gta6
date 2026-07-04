/* ============================================================
   city/police.js — the POLICE, now a real force that polices the whole
   city, not just you.

   • An ambient patrol roams even at 0 player-stars, so the streets are
     actually policed: they chase NPC offenders (muggers, brawlers,
     rampaging "infinite-power" peds, carjackers), conduct traffic STOPS
     on red-light runners, and arrest or shoot suspects.
   • Player wanted (city/wanted.js) layers MORE cops on top, who hunt you
     toward your last-known position and cuff you (→ jail) or open fire.
   • Cops can be DISARMED: a downed officer drops their gun, which the
     player — or a bold enough ped — can snatch.
   • 0★ PROCEDURE LAYER: beats walk in PAIRS with the sidearm ON THE BELT,
     escalations get CALLED IN on the shoulder mic before the response rolls,
     and street nuisances (a corpse, a brawl, a rough sleeper) draw a
     move-along that waves the block off. WHY: the wanted ramp only lands if
     the baseline cop reads as a working officer — then 5★ feels like the
     SAME force turning on you, not drones spawning.
   • 3★+ ROADBLOCKS: the city starts closing roads AHEAD of a fast-moving
     suspect — two cruisers nose-to-nose across the lane, officers posted
     behind the engine blocks. WHY: stars used to just mean MORE cops chasing
     the same way; real escalation changes the SHAPE of the pressure (and
     makes rooftops/lifts matter as escape routes when the streets shut).

   Targets are chosen by threat: each cop locks the nearest high-priority
   offender (you or an NPC). cop.npcTarget points at the ped it's hunting
   (city/peds.js reads it so the suspect flees or fights back).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const { makeCharacter, animChar, lerpAngle } = CBZ;
  const g = CBZ.game;
  const tmp = new THREE.Vector3();

  const COP_R = 0.5, ANIM_D2 = 70 * 70;
  // how close a blind cop must be before it'll SHOOT OUT a glass wall between it
  // and the target (matches combat.js BREACH_REACH; a cop only breaches glass it
  // could plausibly reach, so it never plinks distant storefronts).
  const BREACH_REACH = 16;
  let frame = 0, maintainT = 0;
  let _s = 314159;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  // SHARED TACTICAL PRIMITIVES (systems/aitactics.js): LOS-memory/search-sweep,
  // flank-lane assignment, cover-peek cycling, glass-breach/door-routing-when-
  // blind. Extracted out of this file's hunting branch so other armed-NPC
  // systems (squadai.js) get the same depth. Feature-detected — if the module
  // didn't load (stripped/old build), AT is null and every call site below
  // falls back to skipping that tactic (cop still functions, just dumber).
  const AT = CBZ.aiTactics || null;

  // ---- IN-MODULE TUNING (owner rule: never edit config.js — a parallel agent
  //      owns it; self-default flags here + nudge CBZ.CITY at load) ------------
  // Self-defaults so a partial/older config never throws.
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_PATROL_CARS == null) CBZ.CONFIG.CITY_PATROL_CARS = true;
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_PATROL_DISTRICT_WEIGHT == null) CBZ.CONFIG.CITY_PATROL_DISTRICT_WEIGHT = true;
  // MORE BOOTS ON THE BEAT: a city this big read EMPTY of police with only 3
  // ambient cops. Raise the standing foot patrol to ~7 (the streets are policed
  // everywhere, not just where you stand) — comfortably under POLICE_FORCE_MAX
  // (40) so the finite-force massacre mechanic still bites. WHY: the wanted ramp
  // only lands when the 0★ baseline already reads as a working force.
  if (CBZ.CITY) CBZ.CITY.ambientCops = Math.max(CBZ.CITY.ambientCops || 0, 7);
  // how many PATROL CRUISERS cruise the streets (a separate, capped pool — these
  // are DRIVING cop cars, not the foot beat). Mutable so config can override.
  if (CBZ.CITY && CBZ.CITY.patrolCars == null) CBZ.CITY.patrolCars = 4;

  const carSuspects = [];     // fleeing cars the police are after
  const pursuers = [];        // traffic cars drafted into PIT pursuit of the player car

  // ============================================================
  //  FINITE POLICE FORCE (mirrors the peds.js finite-headcount model).
  //  The city EMPLOYS a bounded roster of officers. Dispatch/spawn can only
  //  field officers it still has; every cop the player KILLS permanently
  //  depletes the force for the run. The academy replenishes it SLOWLY (one
  //  graduate every REPLENISH_INT seconds, only when the heat is low), at a
  //  rate a determined player can OUTPACE — so a sustained massacre genuinely
  //  THINS or temporarily WIPES the police (the streets go quiet, even at 5★,
  //  with no one left to answer) rather than facing infinite waves. Killing a
  //  cop does NOT touch the civilian headcount — police are a separate pool.
  //  CITY-only state; reset on every fresh city run via cityPoliceForceReset().
  // ============================================================
  // total officers the city can field this run (its full roster, killable to 0).
  function POLICE_FORCE_MAX() {
    const v = CBZ.CITY && CBZ.CITY.policeForce;
    return (typeof v === "number" && v > 0) ? v : 40;
  }
  let forcePool = POLICE_FORCE_MAX();   // officers still available to deploy
  let replenishT = 0;                   // academy trickle timer
  const REPLENISH_INT = 26;             // seconds between academy graduates (slow; player out-kills this)
  // how many of cityCops are STILL the force's officers (alive + on duty). Posted
  // roadblock cops count — they came from the same roster — and so do dead ones
  // that haven't culled yet are EXCLUDED (their slot is already returned/depleted).
  function deployedCops() { let n = 0; for (const c of CBZ.cityCops) if (!c.dead && c.kind === "cop") n++; return n; }
  // reset the roster for a fresh city run (called from clearCityCops + spawn).
  function cityPoliceForceReset() { forcePool = POLICE_FORCE_MAX(); replenishT = 0; }
  CBZ.cityPoliceForceReset = cityPoliceForceReset;
  // {alive,deployed,max} for the HUD / map: alive = officers still on the books
  // (the pool you can still field + the ones currently deployed). Falls only as
  // cops are killed; crawls back via the academy trickle.
  CBZ.cityPoliceForce = function () {
    const deployed = deployedCops();
    return { reserve: forcePool, deployed, alive: forcePool + deployed, max: POLICE_FORCE_MAX() };
  };
  // expose for empire.js RAID / debug: did the player wipe the force?
  CBZ.cityPoliceWiped = function () { return forcePool <= 0 && deployedCops() <= 0; };

  // ---- line-of-sight: do buildings block this cop's view? (GTA cops lose you
  //      behind cover and switch to SEARCH). One shared ray, throttled per-cop. --
  const _ray = new THREE.Raycaster();
  _ray.far = 60;
  const _o = new THREE.Vector3(), _d = new THREE.Vector3();
  function losClear(ax, az, bx, bz) {
    const blk = CBZ.losBlockers;
    if (!blk || !blk.length) return true;
    _o.set(ax, 1.4, az);
    _d.set(bx - ax, 0, bz - az);
    const len = _d.length(); if (len < 0.5) return true;
    _d.multiplyScalar(1 / len);
    _ray.set(_o, _d); _ray.far = len;
    const hits = _ray.intersectObjects(blk, false);
    return hits.length === 0;
  }

  function playerArmed() {
    return !!(CBZ.cityHasGun && CBZ.cityHasGun());
  }
  // OPENLY carrying = the shared engine loadout is currently drawn.
  // COMPLY snapshots and empties that loadout, so every city system sees fists.
  function openCarry() { return playerArmed() && !g.cityStowedWeapon; }

  // ============================================================
  //  0★ PROCEDURE LAYER — paired beats, holstered sidearms, radio discipline,
  //  move-alongs. All cheap + bounded: one global bark cooldown, one citywide
  //  move-along at a time, one dispatch caller per escalation step.
  // ============================================================
  let copClock = 0;            // module clock for cheap cooldown stamps (vagrant shoo timers)
  let barkCD = 0;              // ONE global small-talk cooldown → barks stay rare, never spam
  let dutyScanT = 0, dutyIdx = 0, dutyCop = null;          // single move-along assignment
  let dispatchHoldT = 0, lastStars = 0, lastWant = 0;   // radio-beat state
  let convictHailed = false;   // one-shot "escaped convict" all-points bulletin per run

  // beat small-talk — strictly diegetic procedure/street flavor, only worth
  // SAYING when the player is close enough to overhear it.
  const BEAT_LINES = [
    "Quiet block tonight. Stay on it.",
    "Dispatch wants us visible on this strip.",
    "Watch that corner — it's been hot all week.",
    "We loop the block, then check the storefronts.",
    "Payday weekend. Keep your eyes open.",
  ];
  function copBark(c, lines) {
    if (barkCD > 0 || !lines || !lines.length) return;
    const P = CBZ.player; if (!P || P.dead) return;
    if (Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z) > 13) return;   // overheard, not broadcast
    barkCD = 26 + rng() * 20;
    if (CBZ.city && CBZ.city.note) CBZ.city.note("💬 " + (c.name || "Officer") + ": " + lines[(rng() * lines.length) | 0], 1.8);
  }

  // ---- HOLSTER / DRAW -------------------------------------------------------
  // WHY: a beat cop with the pistol perpetually out reads as a drone — the belt
  // is the 0★ baseline, so the DRAW itself becomes the escalation cue. actor
  // .armed is THE flag the shared rig reads: with it false, actorweapons.js
  // syncActorWeapon hides the prop AND poseList @36 skips the gun-ready arm
  // pose, so the whole body relaxes. The prop object is KEPT on the socket so a
  // re-draw is a visibility flip, not a geometry rebuild (we're draw-call bound).
  function holsterGun(c) {
    if (c.dead || !c.armed) return;
    c._beltGun = c.weapon || (c.swat ? "SMG" : "Pistol");   // remember what rides the belt
    c.armed = false;
    if (c._weaponProp) c._weaponProp.visible = false;
    c._weaponPropId = null;
  }
  function drawGun(c) {
    if (c.dead || c.armed) return;
    c.armed = true; c.weapon = c.weapon || c._beltGun || (c.swat ? "SMG" : "Pistol");
    if (c._weaponProp && c._weaponProp.userData && c._weaponProp.userData.weaponId) {
      c._weaponProp.visible = true;
      c._weaponPropId = c._weaponProp.userData.weaponId;    // same gun → no rebuild
    } else if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(c);
    c._calmT = 0;
  }

  // left hand up to the shoulder mic — set AFTER animChar so the idle damp
  // doesn't fight it; when the call ends animChar eases the arm back down.
  function radioPose(ch) {
    if (!ch || !ch.parts || !ch.parts.la) return;
    // real mic-key gesture: upper arm raises partway, the ELBOW folds the
    // hand up to the shoulder mic (a straight arm to the ear read as a salute)
    ch.parts.la.rotation.set(-0.85, 0.35, -0.30);
    ch.parts.la.position.z = 0.12;
    const low = ch.low && ch.low.la || ch.parts.la.userData.low;
    if (low) low.rotation.set(-1.9, 0, 0);
  }

  function standIdle(c, faceY, dt, near) {
    c.speed = 0;
    c.group.rotation.y = lerpAngle(c.group.rotation.y, faceY, 1 - Math.pow(0.01, dt));
    finalizeMove(c);
    if (near) animChar(c.char, 0, dt);
  }

  // beats walk in TWOS: a mate-less ambient cop claims the nearest free single.
  // Pure refs over existing patrollers — never a new spawn. The lead picks the
  // route; the partner holds the right-shoulder slot.
  function pairUp(c) {
    let best = null, bd = 80 * 80;            // don't cross the whole map to meet up
    for (const o of CBZ.cityCops) {
      if (o === c || o.dead || !o.ambient || o._mate || o.giveUp || o.gunstop || o.swat) continue;
      const dd = (o.pos.x - c.pos.x) * (o.pos.x - c.pos.x) + (o.pos.z - c.pos.z) * (o.pos.z - c.pos.z);
      if (dd < bd) { bd = dd; best = o; }
    }
    if (!best) return;
    c._mate = best; best._mate = c;
    c._lead = true; best._lead = false;
  }

  // ---- MOVE-ALONG (0★ only): a beat cop spots a corpse, a street brawl, or a
  // vagrant camped on the block, walks the scene, and waves the block off.
  // Vagrants get SHOOED (peds.js:482 flags them for exactly this) — never shot;
  // an offender with real heat is chooseTarget's hunt, never a shoo.
  function findIssueNear(c) {
    let best = null, bd = 26;
    for (const p of CBZ.cityPeds) {
      const d = Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z);
      if (d >= bd) continue;
      if (p.dead) { if (!p._copSecured) { best = { kind: "corpse", ped: p }; bd = d; } continue; }
      if ((p.npcWanted | 0) >= 1 || p.rampage || p.ko > 0) continue;   // a hunt / already down — not a shoo
      if (p.state === "fight" || p.rage) { best = { kind: "brawl", ped: p }; bd = d; continue; }
      if (p.vagrant && !(p._shooUntil > copClock) && p.state !== "flee") { best = { kind: "vagrant", ped: p }; bd = d; }
    }
    return best;
  }
  function scanDuty(dt) {
    if (dutyCop && (dutyCop.dead || dutyCop.giveUp || !dutyCop._duty)) dutyCop = null;
    dutyScanT -= dt;
    if (dutyScanT > 0 || dutyCop || (g.wanted | 0) !== 0 || g.state !== "playing") return;
    dutyScanT = 1.7;
    const cops = CBZ.cityCops; if (!cops.length) return;
    const c = cops[dutyIdx++ % cops.length];   // ONE candidate per tick — bounded
    if (!c || c.dead || !c.ambient || c.gunstop || c.giveUp || c.curTarget || c.npcTarget || c.chaseCar || c.searchT > 0 || c._radioT > 0 || c._duty) return;
    if (CBZ.body && CBZ.body.busy && CBZ.body.busy(c)) return;
    const issue = findIssueNear(c);
    if (issue) { c._duty = issue; dutyCop = c; }
  }
  // wave the block off: bystanders near the scene get the documented flee/fear
  // fields (peds.js owns the actual movement via cityFleeFrom's vetted heading).
  // fear is capped LOW — shooed, not terrorized (screams only fire at fear≥8).
  function disperse(cop, atX, atZ, kind) {
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.vendor || p.companion || p.controlled) continue;
      const dx = p.pos.x - atX, dz = p.pos.z - atZ;
      if (dx * dx + dz * dz > 56) continue;                      // ~7.5m scene radius
      if ((p.npcWanted | 0) >= 1 || p.rampage) continue;         // real offenders are a HUNT
      if (kind === "brawl" && p.rage) p.rage = null;             // the uniform cools a street scrap
      if (p.vagrant) p._shooUntil = copClock + 55;               // rousted — not again this shift
      p.alarmed = Math.max(p.alarmed || 0, 3);
      p.fear = Math.min(6, (p.fear || 0) + 2);
      if (CBZ.cityFleeFrom) CBZ.cityFleeFrom(p, cop.pos.x, cop.pos.z);
    }
  }

  // ============================================================
  //  GUN STOP — a cop spots an openly-carried firearm on a CLEAN record and
  //  walks up to CHALLENGE you (GTA: drawing on the law spikes heat; brandishing
  //  draws a stop). Reuses the #interact HUD panel + I/J/K/L plumbing (the same
  //  rows interact.js uses) without breaking pointer-lock, so the stand-off is
  //  LIVE and tense: you can talk your way out, COMPLY (put it away), or EXECUTE
  //  (draw and drop the officer → instant heat).
  // ============================================================
  const STOP = { cop: null, t: 0, susp: 0, asked: 0, panel: null, name: null, note: null, opts: null, optList: null, key: "" };

  function stopDom() {
    if (STOP.panel !== null) return STOP.panel;
    STOP.panel = document.getElementById("interact");
    STOP.name = document.getElementById("interactName");
    STOP.note = document.getElementById("interactNote");
    STOP.opts = document.getElementById("interactOpts");
    return STOP.panel;
  }
  function stopShow() { const p = stopDom(); if (p) { p.style.display = "block"; p.classList.add("show"); } }
  function stopHide() { const p = stopDom(); if (p) { p.style.display = "none"; p.classList.remove("show"); } STOP.key = ""; }

  function stopActive() { return !!(STOP.cop && !STOP.cop.dead); }

  // how believable an excuse is: a low-suspicion stop + your street respect help;
  // every time you've been re-asked makes the officer less patient.
  function stopTalkChance(base) {
    const respect = Math.min(0.25, (g.respect || 0) * 0.01);
    return Math.max(0.05, base - STOP.susp * 0.18 - STOP.asked * 0.12 + respect);
  }

  function stopOpts() {
    return [
      { key: "i", label: "“It's licensed — I've got a permit.”", fn: stopExcuseLicense },
      { key: "j", label: "“Just heading to the range, officer.”", fn: stopExcuseRange },
      { key: "k", label: "Put the weapon away (comply)", fn: stopComply },
      { key: "l", label: "Draw and shoot the officer", bad: true, fn: stopExecute },
    ];
  }
  function stopNote() {
    const s = STOP.susp;
    if (s >= 2.2) return "👮 Last warning — drop it NOW";
    if (s >= 1.2) return "👮 Getting suspicious · talk fast";
    return "👮 \"Is that a weapon? Let me see your hands.\"";
  }
  function stopRefreshPanel() {
    const c = STOP.cop; if (!c) return;
    STOP.optList = stopOpts();
    const note = stopNote();
    if (STOP.name) STOP.name.textContent = "👮 " + (c.name || "Officer");
    if (STOP.note) STOP.note.textContent = note;
    if (STOP.opts) STOP.opts.innerHTML = STOP.optList.map((o, i) =>
      `<div class="iopt" data-i="${i}"><span class="ikey">${o.key.toUpperCase()}</span>` +
      `<span class="ilab"${o.bad ? " style=\"color:#ff9a9a\"" : ""}>${o.label}</span></div>`
    ).join("");
    STOP.key = "gunstop:" + (STOP.susp >= 2.2 ? 2 : STOP.susp >= 1.2 ? 1 : 0);
  }

  function beginStop(cop) {
    STOP.cop = cop; STOP.t = 0; STOP.susp = 0; STOP.asked = 1; STOP.key = "";
    cop.state = "gunstop"; cop.gunstop = true; cop.npcTarget = null; cop.curTarget = null;
    cop.searchT = 0; cop.giveUp = false; cop.arrestT = 0;
    cop._duty = null;            // the open carry outranks a move-along
    drawGun(cop);                // challenge stance: gun OUT but lowered (_gunLowered)
    if (CBZ.city && CBZ.city.note) CBZ.city.note("👮 \"Hey! Hold up — is that a firearm?\"", 1.8);
    if (CBZ.sfx) CBZ.sfx("whoosh");
    stopRefreshPanel();
    stopShow();
  }
  function endStop(calm) {
    const c = STOP.cop;
    if (c) {
      c.gunstop = false; c._gunLowered = false;   // free the gun rig for normal hunt/patrol logic
      if (c.state === "gunstop") c.state = "patrol";
      c.arrestT = 0; c.retarget = calm ? 2.5 : 0;
    }
    STOP.cop = null; STOP.t = 0; STOP.susp = 0; STOP.asked = 0;
    stopHide();
  }

  // talk-out: success backs the cop off; failure ratchets suspicion (and a third
  // strike turns the stop into a real stand-off — he draws and calls it in).
  function stopAttempt(chance, sellLine) {
    const c = STOP.cop; if (!c) return;
    if (CBZ.city && CBZ.city.note) CBZ.city.note(sellLine, 1.6);
    STOP.asked++;
    if (rng() < chance) {
      if (CBZ.city) { CBZ.city.note("“…alright. Keep it holstered. Move along.”", 2.2); CBZ.city.addRespect(1); }
      if (c.armed && CBZ.syncActorWeapon) { c._gunLowered = true; }
      endStop(true);
    } else {
      STOP.susp += 1;
      if (STOP.susp >= 3) {
        // brandishing call goes out → a 1-star stop becomes real; he squares up
        if (CBZ.city) CBZ.city.note("“That's it — hands! HANDS!”", 1.8);
        if (CBZ.cityCrime) CBZ.cityCrime(45, { instant: true, x: c.pos.x, z: c.pos.z, type: "shots-fired" });
        c.curTarget = CBZ.city.playerActor; c.sees = true; c.retarget = 1.5;
        endStop(false);
      } else {
        if (CBZ.city) CBZ.city.note("“Don't lie to me. Put it AWAY.”", 1.8);
        stopRefreshPanel();
      }
    }
  }
  function stopExcuseLicense() { stopAttempt(stopTalkChance(0.6), "“It's licensed — I carry legal.”"); }
  function stopExcuseRange()   { stopAttempt(stopTalkChance(0.5), "“On my way to the range, that's all.”"); }

  // COMPLY — actually put the shared engine loadout away. You still own the
  // guns: the inventory/current selection are snapshotted and restored on draw.
  function stowGuns() {
    if (g.cityStowedWeapon || (g._copStow && g._copStow.inv)) return false;   // already away
    const snap = { inv: (CBZ.weaponInventory || []).slice(), cur: CBZ.currentWeaponId || null };
    g.cityStowedWeapon = (CBZ.cityCurrentWeaponName && CBZ.cityCurrentWeaponName()) || "Gun";
    g._copStow = snap;
    if (CBZ.weaponInventory) CBZ.weaponInventory.length = 0;
    CBZ.currentWeaponId = null;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function stopComply() {
    const c = STOP.cop;
    stowGuns();
    if (CBZ.city) CBZ.city.note("You put the piece away. “Good. Stay out of trouble.” · Q re-draw", 2.6);
    if (CBZ.sfx) CBZ.sfx("door");
    if (c) { c._gunLowered = true; }
    endStop(true);
  }
  CBZ.cityStowedWeapon = function () { return g.cityStowedWeapon || null; };
  // re-draw the stowed loadout (the player still owns it; bring it back out).
  CBZ.cityRedrawWeapon = function () {
    const snap = g._copStow;
    if (!snap && !g.cityStowedWeapon) return false;
    if (snap) {
      if (CBZ.weaponInventory && snap.inv) { CBZ.weaponInventory.length = 0; for (const id of snap.inv) CBZ.weaponInventory.push(id); }
      CBZ.currentWeaponId = snap.cur || CBZ.currentWeaponId;
      if (CBZ.onWeaponInventoryChanged && CBZ.currentWeaponId) CBZ.onWeaponInventoryChanged(CBZ.currentWeaponId, false);
    }
    g.cityStowedWeapon = null; g._copStow = null;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    // (no "Weapon out." note — the gun filling your hands says it)
    return true;
  };

  // EXECUTE — draw on the cop. fpsmode still owns the actual shot if you fire, but
  // pulling on the law during a stop is itself the crime: instant cop-kill heat if
  // it drops him, else assault-on-an-officer.
  function stopExecute() {
    const c = STOP.cop; if (!c) { endStop(false); return; }
    const fx = CBZ.player.pos.x, fz = CBZ.player.pos.z;
    const from = CBZ.playerMuzzleWorld ? CBZ.playerMuzzleWorld() : { x: fx, y: 1.45, z: fz };
    if (CBZ.muzzleFlash) CBZ.muzzleFlash(from, {});
    if (CBZ.sfx) CBZ.sfx(CBZ.gunVoiceName ? CBZ.gunVoiceName((CBZ.cityCurrentWeapon && CBZ.cityCurrentWeapon() || {}).key) : "report");
    if (CBZ.shake) CBZ.shake(0.4);
    const it = CBZ.cityCurrentWeapon && CBZ.cityCurrentWeapon();
    const dmg = it && it.dmg ? it.dmg * 1.5 + 30 : 80;
    STOP.cop = null; stopHide();    // the stop is over the instant you pull
    // LOS GATE (audit): the stop only dies past 16u, not when a corner slides
    // between you — without this, EXECUTE was the one police-stand-off shot that
    // could land THROUGH a wall. A blocked shot still FIRED: the officer hears
    // it and the assault-on-an-officer branch below still hunts you.
    const clear = !CBZ.clearLineOfFire ||
      CBZ.clearLineOfFire(from.x, from.y != null ? from.y : 1.45, from.z, c.pos.x, (c.pos.y || 0) + 1.4, c.pos.z);
    if (clear && CBZ.cityHurtCop) CBZ.cityHurtCop(c, dmg, { fromX: fx, fromZ: fz });
    if (!c.dead) {
      // didn't kill him — he's now hunting you for assaulting an officer
      if (CBZ.cityCrime) CBZ.cityCrime(70, { instant: true, x: c.pos.x, z: c.pos.z, type: "assault-officer" });
      c.gunstop = false; c._gunLowered = false; c.state = "patrol"; c.curTarget = CBZ.city.playerActor; c.sees = true; c.retarget = 1.2;
    } else {
      // cityHurtCop already routed a cop-kill → 5 stars; just clear his stop flags
      c.gunstop = false; c._gunLowered = false;
    }
  }

  // RE-DRAW the stowed loadout with [Q] — the same key fpsmode uses to swap guns.
  // fpsmode's Q is gated on armed(), so while your guns are STOWED (inventory empty)
  // it does nothing; we step in there to bring the piece back out. No new key: it's
  // the natural "draw/swap weapon" control, just covering the empty-handed case.
  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing" || e.repeat) return;
    if ((e.key || "").toLowerCase() !== "q") return;
    if (CBZ.player.driving || CBZ.player.dead || CBZ.cityMenuOpen || stopActive()) return;
    // [Q] = holster/draw toggle. Your gun STAYS OUT by default — this just lets you
    // put it away if you want, and bring it back. Stowed → re-draw. Armed with a
    // SINGLE gun → voluntarily holster (there's nothing to swap to anyway, so fpsmode's
    // Q is a no-op there). With 2+ guns, [Q] stays the weapon-swap key (fpsmode owns it).
    if (g._copStow || g.cityStowedWeapon) { e.preventDefault(); CBZ.cityRedrawWeapon(); return; }
    if (g.cityMeleeWeapon && CBZ.cityDrawGun && CBZ.cityDrawGun()) {
      e.preventDefault();
      // (no "Weapon out." note — you can see the swap in your own hands)
      return;
    }
    if ((CBZ.weaponInventory || []).length === 1 && stowGuns()) {
      e.preventDefault();
      if (CBZ.city) CBZ.city.note("Holstered. · Q draw", 1.6);
      if (CBZ.sfx) CBZ.sfx("door");
    }
  });

  // capture-phase key handler: while a stop is live, I/J/K/L drive the stop FIRST
  // (and we swallow the event so interact.js doesn't also act on it). Cheap; only
  // does anything when a stop is actually on screen.
  addEventListener("keydown", function (e) {
    if (!stopActive() || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.player.driving || CBZ.cityMenuOpen) return;
    const k = (e.key || "").toLowerCase();
    if (k !== "i" && k !== "j" && k !== "k" && k !== "l") return;
    const o = STOP.optList && STOP.optList.find((x) => x.key === k);
    if (o) { e.preventDefault(); e.stopImmediatePropagation(); o.fn(); }
  }, true);
  // tap/click the rows too (mobile + mouse), same as the jail/interact panel
  (function bindStopClicks() {
    const el = document.getElementById("interactOpts");
    if (!el) { setTimeout(bindStopClicks, 60); return; }
    el.addEventListener("click", function (e) {
      if (!stopActive() || g.mode !== "city" || CBZ.player.driving) return;
      const row = e.target.closest && e.target.closest(".iopt");
      if (!row || row.dataset.i == null) return;
      const o = STOP.optList && STOP.optList[+row.dataset.i];
      if (o && o.fn) { e.stopImmediatePropagation(); o.fn(); }
    }, true);
  })();

  // pick a cop to run the stop, drive the approach, and bail on the right cues.
  // Only ONE stop runs at a time; an ambient beat cop nearest you is chosen.
  function updateGunStop(dt) {
    // the stow is only "live" while the gun is actually away. If anything re-arms
    // you (buy/loot a gun → unlockWeapon refills weaponInventory), drop the stale stow snapshot so it reads
    // as open carry again — otherwise a fresh draw would never get stopped.
    if ((g.cityStowedWeapon || g._copStow) && CBZ.weaponInventory && CBZ.weaponInventory.length) { g.cityStowedWeapon = null; g._copStow = null; }
    // SAFETY: never carry a stow across a death/bust (the next life would start
    // unarmed with a stale snapshot). Hand the loadout back so the run resets clean.
    if (g._copStow && (CBZ.player.dead || g.busted)) CBZ.cityRedrawWeapon();

    if (stopActive()) {
      const c = STOP.cop, P = CBZ.player;
      // the stop dies if you get wanted some OTHER way, holster, drive off, die, or
      // simply walk away far enough that he gives up the contact.
      const dx = c.pos.x - P.pos.x, dz = c.pos.z - P.pos.z, d = Math.hypot(dx, dz);
      if ((g.wanted | 0) >= 1 || !openCarry() || P.driving || P.dead || c.dead || d > 16) { endStop((g.wanted | 0) >= 1 ? false : true); return; }
      // approach to challenge distance and square up on you (gun lowered, not aimed)
      STOP.t += dt;
      c._gunLowered = true;                     // muzzle DOWN — he's challenging, not firing
      if (d > 3.0) stepTo(c, -dx, -dz, c.baseSpeed * 0.85, dt, true);
      else { c.speed = 0; c.group.rotation.y = lerpAngle(c.group.rotation.y, Math.atan2(-dx, -dz), 1 - Math.pow(0.002, dt)); finalizeMove(c); if (CBZ.animChar) CBZ.animChar(c.char, 0, dt); }
      // suspicion creeps up the longer you stand there openly armed and ignore him
      STOP.susp = Math.min(2.6, STOP.susp + dt * 0.10);
      const wantKey = "gunstop:" + (STOP.susp >= 2.2 ? 2 : STOP.susp >= 1.2 ? 1 : 0);
      if (wantKey !== STOP.key) stopRefreshPanel();
      // ignore him too long and he forces it (draws + calls a brandishing stop)
      if (STOP.t > 16) { if (CBZ.city) CBZ.city.note("“You've been warned!”", 1.6); if (CBZ.cityCrime) CBZ.cityCrime(40, { instant: true, x: c.pos.x, z: c.pos.z, type: "shots-fired" }); c.curTarget = CBZ.city.playerActor; c.sees = true; endStop(false); }
      return;
    }

    // ---- look for a stop to start ----
    if (g.state !== "playing") return;
    const P = CBZ.player;
    if (!openCarry() || (g.wanted | 0) >= 1 || P.driving || P.dead || g.busted) return;
    if (g.cityMenuOpen) return;
    gunStopScanT -= dt;
    if (gunStopScanT > 0) return;
    gunStopScanT = 0.5;
    // THE UNIFORM READS (outfits.js): a "cop" carrying iron is just a cop —
    // beat officers don't gun-stop their own. But one who gets CLOSE clocks
    // the face under the cap and the costume stops working for a while.
    const trusted = !!(CBZ.cityOutfitCopTrust && CBZ.cityOutfitCopTrust());
    // nearest free ambient beat cop who can SEE the gun and isn't busy/hunting
    let best = null, bd = 13;
    for (const c of CBZ.cityCops) {
      if (c.dead || c.gunstop || c.swat || c.giveUp || c.npcTarget) continue;
      if (c._radioT > 0 || c._duty) continue;   // mid-call / working a scene — not free for a stop
      if (c.curTarget && c.curTarget !== CBZ.city.playerActor) continue;
      if (CBZ.body && CBZ.body.busy && CBZ.body.busy(c)) continue;
      const d = Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z);
      if (d > bd) continue;
      if (!losClear(c.pos.x, c.pos.z, P.pos.x, P.pos.z)) continue;   // can't see the gun through a wall
      if (trusted) {
        // inside arm's reach the costume fails the face check — otherwise waved past
        if (d < 3.2 && CBZ.cityOutfitBlow) CBZ.cityOutfitBlow(c);
        continue;
      }
      bd = d; best = c;
    }
    if (best) beginStop(best);
  }
  let gunStopScanT = 0;

  // interact.js (order 39) writes the SAME #interact panel when you stand next to
  // the cop — it would clobber the gun-stop rows. We re-assert ours at order 40
  // (after it) so the stand-off menu always wins while a stop is live; the moment
  // the stop ends we let interact.js own the panel again.
  let _stopReassertT = 0;
  CBZ.onUpdate(40, function (dt) {
    if (g.mode !== "city") return;
    if (!(stopActive() && g.state === "playing" && !CBZ.player.driving && !CBZ.player.dead)) return;
    _stopReassertT -= dt; if (_stopReassertT > 0) { stopShow(); return; }
    _stopReassertT = 0.1;
    // re-stamp the rows + force-show (interact.js @39 may have overwritten them)
    if (STOP.name) STOP.name.textContent = "👮 " + (STOP.cop.name || "Officer");
    if (STOP.note) STOP.note.textContent = stopNote();
    if (STOP.opts && STOP.optList) STOP.opts.innerHTML = STOP.optList.map((o, i) =>
      `<div class="iopt" data-i="${i}"><span class="ikey">${o.key.toUpperCase()}</span>` +
      `<span class="ilab"${o.bad ? " style=\"color:#ff9a9a\"" : ""}>${o.label}</span></div>`
    ).join("");
    stopShow();
  });

  // PIT chasers are real traffic cars borrowed from vehicles.js (only flagged
  // here). The chopper is a cheap mesh w/ a sweeping spotlight. ROADBLOCK
  // cruisers are the force's OWN pooled units — see the ROADBLOCK section.
  let chopper = null, pitCD = 0;

  function makeCop(x, z, swat, ambient) {
    const ch = makeCharacter({
      legs: swat ? 0x23262c : 0x1b2a44, torso: swat ? 0x2b2f36 : 0x24407a,
      collar: swat ? 0x14161a : 0x16264a, arms: swat ? 0x2b2f36 : 0x24407a,
      skin: 0xe8b58c, hair: 0x101820, shoes: 0x101216,
    });
    ch.group.position.set(x, 0, z);
    // HEAD TAG: seeded as "POLICE"/"SWAT" but the street-read system (level.js
    // retag) repaints it to the ALLOWED Lv.N head tag — "Lv.20 Officer" /
    // "Lv.35 SWAT". This sprite IS that level tag (level.js retag early-returns
    // when .tag is null), so it must exist — nulling it removed the level tag
    // entirely (regression). LOD toggles its visibility below.
    const tag = CBZ.makeLabelSprite ? CBZ.makeLabelSprite(swat ? "SWAT" : "POLICE", { color: "#7fd0ff" }) : null;
    if (tag) { tag.position.y = 3.0; tag.scale.set(2.6, 0.7, 1); ch.group.add(tag); }
    const cop = {
      char: ch, group: ch.group, pos: ch.group.position, name: swat ? "SWAT" : "Officer",
      // hp TRIMMED (swat 160→120, cop 110→90): durability now has a VISIBLE
      // cause — the body armor mounted below (armor.js) soaks the first hits —
      // instead of mystery hp. The armor pool + raw hp together restore the old
      // effective toughness, but the WHY is on the ped's chest, lootable on death.
      kind: "cop", swat: !!swat, ambient: !!ambient, hp: swat ? 120 : 90, dead: false, deadT: 0,
      baseSpeed: swat ? 5.2 : 4.6, speed: 0, state: "patrol", sees: false,
      shootCD: 0.6 + rng() * 0.6, arrestT: 0, slice: (rng() * 6) | 0, tag, isPlayer: false,
      npcTarget: null, patrolGoal: null, retarget: 0, armed: true, weapon: swat ? "SMG" : "Pistol",
    };
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(cop);
    // BODY ARMOR (armor.js, feature-detected): SWAT wear a full plate carrier +
    // helmet; a regular beat cop sometimes wears a concealable soft vest. The API
    // mounts the visible 3D meshes on the ped, sets cop._armor (a damage pool) and
    // cop._armorKit (the piece ids) — which become the lootable drop on death.
    // The clothes.js PAINT.swat painted plate-vest stays underneath; this is the
    // real 3D armor layer on top.
    if (CBZ.cityArmorDressPed) {
      if (swat) CBZ.cityArmorDressPed(cop, ["swatVest", "helmet"]);
      else if (rng() < 0.5) CBZ.cityArmorDressPed(cop, ["softVest"]);
    }
    // cops ride blob shadows (city/blobshadows.js) — swept AFTER the weapon
    // sync so the holstered gun mesh leaves the sun shadow pass too.
    ch.group.traverse(function (o) { if (o.isMesh) o.castShadow = false; });
    return cop;
  }

  function spawnCop(swat, ambient) {
    const A = CBZ.city.arena; if (!A) return;
    // FINITE FORCE: dispatch can only field an officer the city still has on its
    // books. When the reserve is exhausted (player wiped the force), no patrol or
    // response unit rolls — the streets stay quiet even at 5★ until the academy
    // slowly graduates replacements (see the replenish tick in maintain()).
    if (forcePool <= 0) return null;
    const P = CBZ.player;
    let x, z, tries = 0;
    do { const p = A.randomRoadPoint(); x = p.x; z = p.z; tries++; } while (tries < 8 && !ambient && Math.hypot(x - P.pos.x, z - P.pos.z) < 24);
    const c = makeCop(x, z, swat, ambient);
    c._force = true;            // drawn from the finite roster (vs scripted guards)
    forcePool--;               // one officer moves from reserve → deployed
    // 0★ baseline: a fresh beat cop hits the street with the sidearm ON THE BELT
    // (response units at 1★+ arrive already drawn — the city is hunting someone)
    if (ambient && !swat && (g.wanted | 0) === 0) holsterGun(c);
    A.root.add(c.group);
    CBZ.cityCops.push(c);
    return c;
  }

  // spawn a cop at a specific spot (used by the car-biz police RAID in empire.js)
  CBZ.citySpawnCop = function (x, z, swat) {
    const A = CBZ.city.arena; if (!A) return null;
    const c = makeCop(x + (rng() - 0.5) * 5, z + (rng() - 0.5) * 5, !!swat, false);
    A.root.add(c.group); CBZ.cityCops.push(c);
    return c;
  };

  CBZ.clearCityCops = function () {
    if (STOP.cop) { STOP.cop = null; stopHide(); }   // tear down any live gun stop first
    for (const c of CBZ.cityCops) {
      if (c.group && c.group.parent) c.group.parent.remove(c.group);
      if (c.group) c.group.traverse(function (o) {
        if (o.isSprite) return;     // sprites share an r128 geometry singleton — never dispose
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) try { o.geometry.dispose(); } catch (e) {}
        if (o.material) { const m = o.material; if (Array.isArray(m)) m.forEach((x) => x && !x._shared && x.dispose && x.dispose()); else if (!m._shared && m.dispose) m.dispose(); }
      });
    }
    CBZ.cityCops.length = 0;
    carSuspects.length = 0;
    for (const c of pursuers) if (c && !c.dead && !c.player) { c._pursuit = false; c.ai = true; c.reckless = false; }
    pursuers.length = 0;
    rbReset();    // drop wall colliders + dispose pooled cruiser/officer rigs (posted cops were in cityCops → already disposed above)
    patrolCarsReset();   // clear patrol-cruiser handles (the cars are disposed by vehicles.js clearCars)
    if (typeof despawnChopper === "function") despawnChopper();
    pitCD = 0;
    dutyCop = null; dutyScanT = 0; dispatchHoldT = 0; lastStars = 0; lastWant = 0; barkCD = 0;
    convictHailed = false;   // re-arm the escaped-convict APB for the next run
  };

  // posted roadblock officers don't count toward the response total: the wall is
  // pressure AHEAD of you, layered ON TOP of the chase — it must never starve it.
  function liveCops() { let n = 0; for (const c of CBZ.cityCops) if (!c.dead && !c._post) n++; return n; }
  function liveAmbient() { let n = 0; for (const c of CBZ.cityCops) if (!c.dead && c.ambient) n++; return n; }
  function liveSwat() { let n = 0; for (const c of CBZ.cityCops) if (!c.dead && c.swat) n++; return n; }

  // ---- POLICE HELICOPTER (3+ stars): a maverick that orbits your last-known and
  //      paints you with a searchlight, keeping cops fed your position. ----------
  function makeChopper() {
    const A = CBZ.city.arena; if (!A) return null;
    const grp = new THREE.Group();
    const matBody = CBZ.mat ? CBZ.mat(0x1a1d24, { ei: 0.02 }) : new THREE.MeshStandardMaterial({ color: 0x1a1d24 });
    const skidMat = CBZ.mat ? CBZ.mat(0x2a2e36) : matBody;
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.2, 4.0), matBody);
    body.castShadow = false; grp.add(body);
    // forward glass cabin overlapping the fuselage front
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.7, 1.7), skidMat);
    canopy.position.set(0, 0.5, 1.25); grp.add(canopy);
    // tapered tail boom — front sunk into the rear of the cabin (no gap)
    const boom = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 2.7), matBody);
    boom.position.set(0, 0.26, -2.95); grp.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.95, 0.6), matBody);
    fin.position.set(0, 0.7, -4.0); grp.add(fin);
    // skids on struts that meet the belly
    const skidL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 3.2), skidMat); skidL.position.set(-0.75, -0.82, 0.1); grp.add(skidL);
    const skidR = skidL.clone(); skidR.position.x = 0.75; grp.add(skidR);
    for (const sx of [-0.75, 0.75]) {
      for (const sz of [0.85, -0.85]) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), skidMat);
        st.position.set(sx, -0.52, sz + 0.1); grp.add(st);
      }
    }
    // main rotor — crossed thin blades on a mast hub (group spun by updateChopper)
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), skidMat); hub.position.y = 0.82; grp.add(hub);
    const rotorMat = new THREE.MeshBasicMaterial({ color: 0x101216, transparent: true, opacity: 0.55, depthWrite: false });
    const bladeGeo = new THREE.BoxGeometry(7.5, 0.05, 0.46);
    const rotor = new THREE.Group(); rotor.position.y = 0.92;
    const rb1 = new THREE.Mesh(bladeGeo, rotorMat); rotor.add(rb1);
    const rb2 = new THREE.Mesh(bladeGeo, rotorMat); rb2.rotation.y = Math.PI / 2; rotor.add(rb2);
    grp.add(rotor);
    // belly searchlight: a visible cone + a ground pool (like searchlight.js)
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 5.5, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    grp.add(cone);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(5, 22),
      new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.24, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.07;
    A.root.add(pool);
    A.root.add(grp);
    // NO floating "AIR-1" billboard over the police chopper — a role label on an
    // aircraft breaks the fourth wall (same rule as the cop/vehicle labels). The
    // searchlight + rotor already read it as a police helicopter.
    const tag = null;
    const sp = A.randomRoadPoint();
    grp.position.set(sp.x, CHOP_Y, sp.z);
    return {
      group: grp, body, rotor, cone, pool, tag,
      pos: grp.position, target: new THREE.Vector3(sp.x, 0, sp.z),
      heading: 0, orbit: rng() * 6.28, shootCD: 1.2, leaveT: 0, spotR: 5,
    };
  }
  // Cruise altitude of the searchlight chopper. The tallest tower (The Spire,
  // 9 storeys @4m) tops out near y≈36 and a player on its roof sits ~y38, so the
  // chopper flies WELL above that — it is never below a rooftop target it hunts.
  const CHOP_Y = 49;   // floors grew to FH=4.6 — tallest walk-up roof ≈37.9; keep a real down-angle
  // a target this far BELOW the chopper is a plausible down/level shot; a player
  // higher than the chopper can't be hit (a door gunner can't fire straight up).
  const CHOP_FIRE_MARGIN = 3;
  // Does the chopper have a realistic shot / true sighting of the player? Requires
  // the player to be meaningfully BELOW the aircraft AND a clear line of fire from
  // the belly to the player. If false, the chopper can't paint or hit them — it
  // must climb/orbit back overhead first (the cruise altitude does the climbing).
  function chopperEngage(P) {
    if (!chopper || !P || P.dead) return false;
    const ay = chopper.pos.y - 0.5;                    // door-gun height (just below belly)
    const py = (P.pos.y || 0) + 1.4;                   // ~chest height
    if (py > ay - CHOP_FIRE_MARGIN) return false;      // player at/above us → no down-angle
    if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(chopper.pos.x, ay, chopper.pos.z, P.pos.x, py, P.pos.z)) return false;
    return true;
  }
  // is the player currently painted by the chopper spotlight? cops + wanted.js
  // (and aircraft.js) treat that as a live sighting. A paint only counts when the
  // beam pool is on you AND the chopper actually has eyes/arc on you: the player
  // must be BELOW the chopper with a clear line of sight. A player up on a roof
  // HIGHER than the chopper — or behind a wall — is NOT painted, so nothing can
  // magically tag or shoot them until the chopper climbs back overhead.
  CBZ.cityChopperPaints = function () {
    if (!chopper) return false;
    const P = CBZ.player; if (!P || P.dead) return false;
    const dx = P.pos.x - chopper.pool.position.x, dz = P.pos.z - chopper.pool.position.z;
    const r = chopper.spotR * (P.crouch ? 0.7 : 1);
    if (dx * dx + dz * dz >= r * r) return false;       // beam pool isn't on you
    return chopperEngage(P);                            // ...and we have altitude + LOS
  };
  // expose the police chopper's ground position so the minimap / full map can
  // show the air threat with a bearing (answers "why a helipad" on the map).
  CBZ.cityChopperPos = function () {
    if (!chopper || !chopper.pos) return null;
    return { x: chopper.pos.x, z: chopper.pos.z, y: chopper.pos.y };
  };
  function despawnChopper() {
    if (!chopper) return;
    if (chopper.group && chopper.group.parent) chopper.group.parent.remove(chopper.group);
    if (chopper.pool && chopper.pool.parent) chopper.pool.parent.remove(chopper.pool);
    // free the chopper's own (non-shared) geometry + materials — sprites share an
    // r128 geometry singleton, so leave those alone (same rule as clearCityCops).
    const disp = function (o) {
      if (!o || o.isSprite) return;
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      const m = o.material; if (m && !m._shared && m.dispose) { try { m.dispose(); } catch (e) {} }
    };
    if (chopper.group) chopper.group.traverse(disp);
    disp(chopper.pool);
    chopper = null;
  }
  function updateChopper(dt) {
    const stars = g.wanted | 0;
    if (stars < 3 || g.state !== "playing") { if (chopper) { chopper.leaveT += dt; if (chopper.leaveT > 4) despawnChopper(); } return; }
    if (!chopper) { chopper = makeChopper(); if (!chopper) return; }
    chopper.leaveT = 0;
    const P = CBZ.player;
    const lk = g.cityLastKnown;
    // orbit the suspect's last-known position; tighter + faster the more stars
    const cx = lk ? lk.x : P.pos.x, cz = lk ? lk.z : P.pos.z;
    chopper.orbit += dt * (0.45 + stars * 0.07);
    const R = 18 - stars * 1.5;
    const tx = cx + Math.cos(chopper.orbit) * R, tz = cz + Math.sin(chopper.orbit) * R;
    // cruise high (above the tallest tower). If the player has climbed ABOVE us
    // (up on a roof), CLIMB to get back over them — a gunner can't fire straight
    // up, so we reposition to regain altitude + line of fire before engaging.
    const needY = (P.pos.y || 0) + 1.4 + CHOP_FIRE_MARGIN + 6;
    const ty = Math.max(CHOP_Y - stars, needY);
    chopper.pos.x += (tx - chopper.pos.x) * Math.min(1, dt * 1.4);
    chopper.pos.z += (tz - chopper.pos.z) * Math.min(1, dt * 1.4);
    chopper.pos.y += (ty - chopper.pos.y) * Math.min(1, dt * 1.2);
    chopper.heading = Math.atan2(tx - chopper.pos.x, tz - chopper.pos.z);
    chopper.group.rotation.y += (chopper.heading - chopper.group.rotation.y) * Math.min(1, dt * 3) * 0.3 + 0;
    chopper.group.rotation.z = Math.sin(chopper.orbit) * 0.12;
    chopper.rotor.rotation.y += dt * 40;
    // spotlight tracks toward the player but lags (so you can outrun the beam)
    const beam = chopper.pool.position;
    beam.x += (P.pos.x - beam.x) * Math.min(1, dt * (0.7 + stars * 0.18));
    beam.z += (P.pos.z - beam.z) * Math.min(1, dt * (0.7 + stars * 0.18));
    chopper.spotR = 6 + stars * 0.5;
    chopper.pool.scale.setScalar(chopper.spotR / 5);
    // the beam lands on whatever is actually UNDER it: when the spot drifts
    // over a building, the pool climbs to that ROOF and the cone stops there —
    // light doesn't pass through six storeys to paint the street (user-filmed).
    // Cheap: an AABB top scan only of colliders under the beam, throttled.
    chopper._roofT = (chopper._roofT || 0) - dt;
    if (chopper._roofT <= 0) {
      chopper._roofT = 0.18;
      let topY = 0;
      const cols = CBZ.colliders || [];
      for (let ci = 0; ci < cols.length; ci++) {
        const c = cols[ci];
        if (c.y1 == null || c.y1 <= topY || c.y1 > chopper.pos.y) continue;
        if (beam.x < c.minX - 1 || beam.x > c.maxX + 1 || beam.z < c.minZ - 1 || beam.z > c.maxZ + 1) continue;
        topY = c.y1;
      }
      chopper._beamY = topY;
    }
    beam.y = (chopper._beamY || 0) + 0.07;
    // visible light cone hangs from the belly down to the lit surface (cheap: a
    // local downward cylinder; the wide bottom radius reads as a spreading beam).
    const len = Math.max(2, chopper.pos.y - beam.y);
    chopper.cone.position.set(0, -len / 2 - 0.4, 0);
    chopper.cone.rotation.set(0, 0, 0);
    chopper.cone.scale.set(1, len, 1);
    // PAINTED: the chopper relays your position → feeds last-known + lets cops see
    if (CBZ.cityChopperPaints && CBZ.cityChopperPaints() && !P.dead) {
      g.cityLastKnown = { x: P.pos.x, z: P.pos.z, t: CBZ.now };
      // at 4+ stars the door gunner takes potshots from above
      if (stars >= 4) { chopper.shootCD -= dt; if (chopper.shootCD <= 0) { chopper.shootCD = 0.9 + rng() * 0.6; chopperFire(); } }
    } else if (chopper.shootCD > 0) chopper.shootCD -= dt;
  }
  function chopperFire() {
    const P = CBZ.player; if (!P || P.dead || !chopper) return;
    // never fire up at / through cover: the player must be below us with a clear
    // line of fire (the paint gate already checks this, but guard it here too).
    if (!chopperEngage(P)) return;
    const from = { x: chopper.pos.x, y: chopper.pos.y - 0.5, z: chopper.pos.z };
    if (CBZ.tracer) CBZ.tracer(from, { x: P.pos.x + (rng() - 0.5) * 2, y: 1.5, z: P.pos.z + (rng() - 0.5) * 2 }, { muzzleScale: 1.2 });
    if (CBZ.gunVoice) CBZ.gunVoice("carbine", Math.hypot(chopper.pos.x - P.pos.x, chopper.pos.z - P.pos.z));
    else if (CBZ.sfx) CBZ.sfx("report");
    if (rng() < 0.45 && CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(8 + rng() * 6, chopper.pos.x, chopper.pos.z, "shot from a police chopper", rng() < 0.02, "a police helicopter");
  }
  CBZ.cityClearChopper = despawnChopper;

  // ---- NPC offender registry (the city polices its own) -------------------
  CBZ.cityNpcOffense = function (ped, heat, type) {
    if (!ped || ped.dead || ped.isPlayer) return;
    ped.npcHeat = (ped.npcHeat || 0) + (heat || 10);
    ped.npcWanted = ped.npcHeat > 130 ? 3 : ped.npcHeat > 60 ? 2 : ped.npcHeat > 22 ? 1 : 0;
  };
  CBZ.cityRegisterCarSuspect = function (car) { if (car && carSuspects.indexOf(car) < 0) carSuspects.push(car); };
  CBZ.cityNpcArrest = function (ped) {
    if (!ped || ped.dead) return;
    ped.npcHeat = 0; ped.npcWanted = 0; ped.rage = null; ped.armed = false; ped.weapon = null;
    ped.ko = 4; ped.alarmed = 0;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    if (CBZ.body) CBZ.body.hit(ped, { dir: { x: 0, z: 1 }, force: 3, knockdown: 1.2 });
  };

  // ---- the PRECINCT DESK (city/restrain.js's citizen-collar pipeline) -------
  // There is no dedicated station building yet — the law's intake desk fronts
  // City Hall (falls back to the bank, then any shop door). Revalidated against
  // the LIVE arena so a rebuilt world can't leave a stale point behind.
  let _station = null;
  CBZ.cityPoliceStation = function () {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.shopLots || !A.shopLots.length) return null;
    if (_station && A.shopLots.indexOf(_station.lot) >= 0) return _station;
    const lot = A.shopLots.find((l) => l.kind === "cityhall")
      || A.shopLots.find((l) => l.kind === "bank")
      || A.shopLots.find((l) => l.building && l.building.door);
    const d = lot && lot.building && lot.building.door;
    if (!d) return null;
    _station = { x: d.x, z: d.z, lot };
    return _station;
  };
  // a turned-in suspect gets WALKED INSIDE: charges cleared off the street
  // ledger (same wipe as cityNpcArrest), then the body leaves play through the
  // door — the crowd pool's _parked off-board state, not a death (the city's
  // headcount only falls for corpses).
  CBZ.cityStationIntake = function (ped) {
    if (!ped || ped.dead) return false;
    ped.npcHeat = 0; ped.npcWanted = 0; ped.rage = null; ped.rampage = null;
    ped.armed = false; ped.weapon = null;
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(ped);
    ped.controlled = false; ped.companion = false; ped.hostage = false;
    ped.surrender = false; ped.surrenderT = 0;
    ped._parked = true; ped.group.visible = false;
    ped.pos.set(-9999, 0, -9999); ped.target.set(-9999, 0, -9999);
    ped.speed = 0; ped.state = "walk"; ped.path = null; ped.finalGoal = null; ped.mem = null;
    return true;
  };

  function offenderCount() { let n = 0; for (const p of CBZ.cityPeds) if (!p.dead && (p.npcWanted | 0) >= 1) n++; return n; }

  // damage a cop; killing one spikes player heat + drops the cop's gun
  CBZ.cityHurtCop = function (cop, dmg, imp) {
    if (!cop || cop.dead) return;
    // ARMOR SOAK: a vest/plate carrier eats the first hits before flesh — this is
    // WHY a plated SWAT survives the opening burst. Drain the pool, then bleed any
    // overflow into hp. (No-op when the cop has no armor pool / armor.js absent.)
    if ((cop._armor | 0) > 0 && dmg > 0) {
      const soak = Math.min(cop._armor, dmg);
      cop._armor -= soak; dmg -= soak;
      if (dmg <= 0) {
        // shot stopped by armor — still react to the impact, but no flesh damage
        if (CBZ.body && imp && imp.fromX != null) CBZ.body.hit(cop, { fromX: imp.fromX, fromZ: imp.fromZ, force: 2 });
        return;
      }
    }
    cop.hp -= dmg;
    if (cop.hp <= 0) {
      cop.dead = true; cop.deadT = 0;
      // CORPSE ARMOR LOOT: stamp the kit pieces this cop wore so the body offers
      // "Take their armor" (read by interact.js). Only when they actually had a kit.
      if (cop._armorKit && cop._armorKit.length) cop._armorLoot = cop._armorKit.slice();
      if (CBZ.cityDropWeapon) CBZ.cityDropWeapon(cop.pos.x, cop.pos.z, cop.swat ? "SMG" : "Pistol", 30);   // disarmed
      cop.armed = false; cop.weapon = null;
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(cop);
      if (CBZ.gore) { let dir = imp && imp.fromX != null ? { x: cop.pos.x - imp.fromX, z: cop.pos.z - imp.fromZ } : null; CBZ.gore(cop.pos.x, cop.pos.y + 1.0, cop.pos.z, { dir, amount: 1.1, player: false }); }
      let copRagged = false;
      if (CBZ.cityRagdoll && imp && imp.fromX != null) {
        const rl = Math.hypot(cop.pos.x - imp.fromX, cop.pos.z - imp.fromZ) || 1;
        copRagged = CBZ.cityRagdoll(cop, null, { x: (cop.pos.x - imp.fromX) / rl, y: 0, z: (cop.pos.z - imp.fromZ) / rl }, 8);
      }
      if (CBZ.body && !copRagged) { if (imp && imp.fromX != null) CBZ.body.hit(cop, { fromX: imp.fromX, fromZ: imp.fromZ, force: 8, fling: 5 }); else CBZ.body.hit(cop, { dir: { x: rng() - 0.5, z: rng() - 0.5 }, force: 4, fling: 5 }); }
      // who killed the officer? player → automatic 5 stars; another NPC → that
      // NPC's offense; a cop / driverless car → nobody is charged.
      const att = imp && imp.attacker && imp.attacker.pos ? imp.attacker : null;
      const byPlayer = imp ? imp.byPlayer !== false : true;
      if (att && att !== CBZ.city.playerActor) { if (att.kind !== "cop" && CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, 140, "cop-killer"); }
      else if (byPlayer) {
        g._cityKillDetail = { cop: true, armed: true, victim: cop.name || "officer" };
        CBZ.city && CBZ.city.addKill();
        CBZ.city && CBZ.city.addRespect(8);
        if (CBZ.cityCopKilled) CBZ.cityCopKilled();          // big heat spike (caps at 4★ for a lone act; 5★ only via a long spree — see wanted.js)
        else if (CBZ.cityCrime) CBZ.cityCrime(120, { instant: true, x: cop.pos.x, z: cop.pos.z, type: "cop-kill" });
      }
      if (CBZ.pushKill) CBZ.pushKill("An officer was killed", "#ff6b6b");
    } else if (CBZ.body && imp && imp.fromX != null) CBZ.body.hit(cop, { fromX: imp.fromX, fromZ: imp.fromZ, force: 3 });
  };

  // GTA wanted-tier ramp: how many of the responders to you should be SWAT/NOOSE.
  // 0-1★ none, 2★ a token, 3★ a chunk, 4★ most, 5★ nearly the whole heavy column —
  // the rare top star drowns you in armoured units (a brutal crescendo).
  const SWAT_FRAC = [0, 0, 0.12, 0.45, 0.7, 0.95];

  // ============================================================
  //  PATROL CRUISERS (police-patrol-cars) — a small, capped pool of black-and-
  //  white units that CRUISE the streets on the normal lane AI, marked
  //  _patrolCar so they ride vehicles.js order-37 like any car (no bespoke
  //  driving). They are CARS in CBZ.cityCars, never cop peds in CBZ.cityCops, so
  //  they NEVER touch liveCops()/the finite-force pool — they're pure visible
  //  presence on top of the foot beat. They reuse the EXACT cruiser look the
  //  roadblock uses (CRUISER_MODEL + rbDecorate over cityMakeCar). Seeded toward
  //  UNDER-COVERED districts so the police presence spreads across the whole map
  //  (cops-weighted via the arena's copBeatPoint), not just downtown.
  //  WHY: you should SEE the police rolling the city, lights cresting a block,
  //  not just teleporting in when you offend. A patrolling cruiser is the
  //  baseline that makes a chase read as the same force turning on you.
  // ============================================================
  const _patrolCars = [];
  function patrolCap() {
    if (!(CBZ.CONFIG && CBZ.CONFIG.CITY_PATROL_CARS)) return 0;
    let cap = (CBZ.CITY && CBZ.CITY.patrolCars != null) ? (CBZ.CITY.patrolCars | 0) : 4;
    // weak-GPU governor: fewer driving cruisers (same discipline as traffic.js)
    const q = CBZ.qualityLevel != null ? CBZ.qualityLevel : 2;
    if (q <= 1) cap = Math.min(cap, 1);
    else if (q === 2) cap = Math.min(cap, 3);
    return Math.max(0, cap);
  }
  // a cruiser is still a presentable patrol unit (drop wrecks/burners from the
  // pool so a smoking hulk never counts as "on patrol").
  function patrolUsable(c) {
    return !!(c && !c.dead && !c.player && !c._exploded && !c._onFire && !c._smoking &&
      !c.abandoned && (c.crumple || 0) < 0.4);
  }
  // how MANY of our live patrol cars are currently near a point — used so we seed
  // the NEXT cruiser into an UNDER-covered spot, not on top of one already there.
  function patrolNear(x, z, rad2) {
    let n = 0;
    for (const c of _patrolCars) { if (!patrolUsable(c)) continue; const dx = c.pos.x - x, dz = c.pos.z - z; if (dx * dx + dz * dz < rad2) n++; }
    return n;
  }
  // choose a seed road point biased to cops-heavy districts (copBeatPoint follows
  // the money) AND away from where a cruiser already patrols (under-covered). Min
  // FLOOR: every district can still be picked even if its cops weight is low, so
  // the outskirts aren't left wholly unpatrolled. Falls back to randomRoadPoint.
  function patrolSeedPoint(A) {
    let best = null, bestCover = 1e9;
    for (let t = 0; t < 6; t++) {
      const p = (A.copBeatPoint ? A.copBeatPoint() : (A.randomRoadPoint ? A.randomRoadPoint() : null));
      if (!p) continue;
      const cover = patrolNear(p.x, p.z, 90 * 90);          // how covered this spot already is
      if (cover < bestCover) { bestCover = cover; best = p; }
      if (cover === 0) break;                                // an empty district — take it
    }
    return best || (A.randomRoadPoint ? A.randomRoadPoint() : null);
  }
  // snap a seed point onto the nearest drivable road segment so the cruiser binds
  // to lane AI immediately (vehicles.js order-37 needs c.road/lane/dirSign set).
  function nearestRoadSeg(A, x, z) {
    if (!A.roads || !A.roads.length) return null;
    let best = null, bd = 1e9;
    for (const r of A.roads) {
      // full 2D distance to the nearest point ON the segment: clamp the ALONG
      // coordinate to ±len/2 so a parallel road across town isn't picked just
      // because it shares the cross-coordinate.
      const half = (r.len || 0) / 2;
      let dx, dz;
      if (r.vertical) { dx = x - r.x; dz = z - Math.max(r.z - half, Math.min(r.z + half, z)); }
      else { dz = z - r.z; dx = x - Math.max(r.x - half, Math.min(r.x + half, x)); }
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = r; }
    }
    return best;
  }
  function spawnPatrolCar(A) {
    if (!CBZ.cityMakeCar) return null;
    const p = patrolSeedPoint(A); if (!p) return null;
    const r = nearestRoadSeg(A, p.x, p.z); if (!r) return null;
    const dir = (p.vertical != null ? p.vertical : r.vertical) ? (rng() < 0.5 ? 1 : -1)
                                                               : (rng() < 0.5 ? 1 : -1);
    const laneIdx = (rng() * lanesPerDirP()) | 0;
    const lane = dir * laneWidthP() * (laneIdx + 0.5);
    const along = (rng() - 0.5) * Math.min(r.len * 0.8, 120);
    const x = r.vertical ? r.x + lane : r.x + along;
    const z = r.vertical ? r.z + along : r.z + lane;
    const heading = r.vertical ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const c = CBZ.cityMakeCar(x, z, heading, r.vertical, CRUISER_MODEL, 0.28);
    if (!c) return null;
    // dress it as a black-and-white (guarded — rbDecorate no-ops on a box rig)
    try { rbDecorate(c); } catch (e) { /* box rig / headless — skip livery, still drives */ }
    // routine patrol = lightbar DARK (not responding). The flash is reserved for
    // an active roadblock/response, so a cruising unit reads as on-the-beat, not
    // mid-call. (rbUpdate only flashes RB.cars, never our patrol pool, so these
    // stay dark unless we ever wire a response.)
    if (c._rbBar) { if (c._rbBar.red) c._rbBar.red.visible = false; if (c._rbBar.blue) c._rbBar.blue.visible = false; }
    // bind to lane AI exactly like an ambient car
    c.road = r; c.lane = lane; c.dirSign = dir; c.laneIdx = laneIdx;
    c.baseV = (TRP().cruise ? TRP().cruise[0] : 7) + 2.5;   // a steady patrol pace
    c.v = c.baseV * 0.6; c.reckless = false; c.ai = true;
    c._patrolCar = true;                                    // tag (excluded from any cop accounting)
    _patrolCars.push(c);
    return c;
  }
  // top the patrol pool up to its cap and prune wrecked/dead units from the
  // registry (the CAR itself is reaped by vehicles.js; we only drop our handle).
  function maintainPatrolCars(A) {
    if (!A) return;
    // prune
    for (let i = _patrolCars.length - 1; i >= 0; i--) {
      const c = _patrolCars[i];
      if (!c || c.dead || c._reap || c._exploded || CBZ.cityCars.indexOf(c) < 0) { _patrolCars.splice(i, 1); continue; }
      // a badly crumpled/burning cruiser stops being "on patrol" — release the
      // handle so a fresh one tops the pool back up (the wreck lives on as traffic
      // debris until vehicles.js reaps it).
      if (!patrolUsable(c)) { c._patrolCar = false; _patrolCars.splice(i, 1); }
    }
    const cap = patrolCap();
    if (_patrolCars.length < cap) spawnPatrolCar(A);        // one per maintain beat (1.1s) — eases them in
  }
  // local lane geometry mirrors (vehicles.js/traffic.js use the same CBZ.CITY.traf)
  function TRP() { return (CBZ.CITY && CBZ.CITY.traf) || {}; }
  function lanesPerDirP() { return Math.max(1, (TRP().lanesPerDir != null ? TRP().lanesPerDir : 2) | 0); }
  function laneWidthP() { return TRP().laneW != null ? TRP().laneW : 3.6; }
  // reset hook: clear the registry on a fresh run (the cars themselves are
  // disposed by vehicles.js clearCars). Called from clearCityCops.
  function patrolCarsReset() { for (const c of _patrolCars) if (c) c._patrolCar = false; _patrolCars.length = 0; }

  // ---- maintain the right number of cops --------------------------------
  function maintain(dt) {
    maintainT -= dt;
    if (maintainT > 0) return;
    maintainT = 1.1;
    const stars = g.wanted | 0;
    // ESCAPED CONVICT all-points bulletin: the first maintain tick after you hit
    // the street as a jailbreaker, dispatch puts your description out — sells WHY
    // the streets are already crawling with cops hunting you. One-shot per run
    // (convictHailed reset in cityPoliceForceReset). chooseTarget() does the rest.
    if (g.escapedConvict && !convictHailed && g.state === "playing") {
      convictHailed = true;
      if (CBZ.city && CBZ.city.big) CBZ.city.big("⚠ ALL UNITS — ESCAPED CONVICT AT LARGE");
    }
    const ambientWant = CBZ.CITY.ambientCops || 0;
    const playerWant = g.cityCopTarget || 0;

    // ---- RADIO BEAT: escalation gets CALLED IN before the response rolls.
    // Each time the heat steps up a tier, the nearest free street cop stops,
    // keys the shoulder mic (~1.5s), and only THEN do new RESPONSE units arrive
    // — one breath of procedure that sells dispatch as a system, not a spawner.
    // Bounded: one caller per step, the hold spans ≤2 maintain ticks, and with
    // no cop nearby there's no hold at all (dispatch heard the shots itself).
    if (dispatchHoldT > 0) dispatchHoldT -= 1.1;
    const escalated = stars > lastStars || (playerWant | 0) > (lastWant | 0);
    lastStars = stars; lastWant = playerWant;
    if (escalated && stars >= 1 && g.state === "playing" && dispatchHoldT <= 0) {
      const Pp = CBZ.player;
      let caller = null, cd = 55;
      for (const c of CBZ.cityCops) {
        if (c.dead || c.gunstop || c.giveUp || c.swat || c._radioT > 0 || c._post) continue;
        if (CBZ.body && CBZ.body.busy && CBZ.body.busy(c)) continue;
        const d = Math.hypot(c.pos.x - Pp.pos.x, c.pos.z - Pp.pos.z);
        if (d < cd) { cd = d; caller = c; }
      }
      if (caller) {
        caller._radioT = 1.5; caller._duty = null;
        dispatchHoldT = 1.5;
        // (CUT: the 📻 "requesting backup" subtitle — you're not on the police
        // net. The call-in still HAPPENS: the cop visibly stops and keys his
        // shoulder mic (_radioT drives the pose), and the response that rolls
        // in after the hold IS the message.)
      }
    }

    const offenders = offenderCount() + carSuspects.length;
    const total = ambientWant + playerWant + Math.min(6, offenders);
    const have = liveCops();
    if (have < total) {
      // escalation ramp: at higher stars, fill the new slot with a SWAT unit so
      // the force gets tougher AND bigger as your stars climb.
      const wantSwat = liveSwat();
      const swatTarget = Math.round(playerWant * (SWAT_FRAC[Math.min(5, stars)] || 0));
      const fillAmbient = liveAmbient() < ambientWant;          // patrol slot open?
      // patrol fills are always regular beat cops; only player-response slots are
      // SWAT — and RESPONSE units wait out the call-in beat (patrol fills never do).
      if (dispatchHoldT <= 0 || fillAmbient) {
        const newIsSwat = !fillAmbient && stars >= 2 && wantSwat < swatTarget;
        spawnCop(newIsSwat, fillAmbient);
        if (have + 1 < total && dispatchHoldT <= 0) spawnCop(stars >= 2 && (wantSwat + (newIsSwat ? 1 : 0)) < swatTarget, false);
      }
    } else if (have > total) {
      // retire surplus non-ambient cops when the heat is gone (never a cop who's
      // mid gun-stop or posted at a wall — let those resolve/tear down first)
      for (const c of CBZ.cityCops) if (!c.dead && !c.ambient && !c.npcTarget && !c.gunstop && !c._post && stars === 0) { c.giveUp = true; break; }
    }

    // ---- vehicle responses to a DRIVING suspect (3★ PIT + 3★ roadblocks) ----
    const P = CBZ.player;
    if (pitCD > 0) pitCD -= 1.1;
    if (P && P.driving && P._vehicle && stars >= 3 && g.state === "playing") {
      if (pitCD <= 0) { pitCD = 4 + rng() * 3; tryPIT(P._vehicle, stars); }
    }
    rbMaintain(stars, P);
    // patrol cruisers cruise the city on lane AI — top the pool up here (1.1s
    // beat). Skipped while you're driving with heat up so we never pop a fresh
    // cruiser into a tense chase (the chase units are spawned by the ramp above).
    if (!(P && P.driving && stars >= 2)) { const A = CBZ.city && CBZ.city.arena; if (A) maintainPatrolCars(A); }
  }

  // PIT: draft a real traffic car into a pursuit cruiser that rams a fleeing
  // player car off the road. We take the car off vehicles.js's lane AI (ai=false)
  // and steer it ourselves toward the player's rear quarter; the car-car
  // collision pass (vehicles.js order 37.6) does the crumple — a faster rammer
  // wrecks the slower car, exactly a PIT.
  function tryPIT(targetCar, stars) {
    if (!CBZ.cityNearestCar || !targetCar) return;
    if (pursuers.length >= (stars >= 5 ? 4 : 3)) return;     // cap the chaos
    const sp = CBZ.cityNearestCar(targetCar.pos.x, targetCar.pos.z, 55);
    if (!sp || sp.player || sp.dead || sp._pursuit || sp._roadblock) return;
    sp._pursuit = true; sp.reckless = true; sp.ai = false; sp.npcDriver = null; sp.abandoned = false;
    sp.baseV = (targetCar.baseV || 12) * 1.18 + stars * 0.8;   // a touch faster so it can catch up
    pursuers.push(sp);
    // (CUT: "🚓 Pursuit unit moving to intercept!" — radio chatter you can't
    // hear, about a cruiser you're about to SEE in your mirror.)
  }
  function updatePursuers(dt) {
    const P = CBZ.player;
    const tgt = (P && P.driving && P._vehicle && !P._vehicle.dead && (g.wanted | 0) >= 3) ? P._vehicle : null;
    for (let i = pursuers.length - 1; i >= 0; i--) {
      const c = pursuers[i];
      if (!c || c.dead || c.player || c._roadblock || c.wreckT > 0 || !tgt) {
        if (c && !c.dead && !c.player) { c._pursuit = false; c.ai = true; c.reckless = false; c.abandoned = false; }
        pursuers.splice(i, 1); continue;
      }
      // steer toward the suspect's rear quarter (the PIT contact point): aim a bit
      // behind + to one side of the target so contact is on the back corner.
      const side = (i % 2) ? 1 : -1;
      const px = -Math.cos(tgt.heading || 0), pz = Math.sin(tgt.heading || 0);   // perpendicular to target heading
      const behX = -Math.sin(tgt.heading || 0), behZ = -Math.cos(tgt.heading || 0);
      const aimX = tgt.pos.x + behX * 1.2 + px * side * 1.1;
      const aimZ = tgt.pos.z + behZ * 1.2 + pz * side * 1.1;
      const dx = aimX - c.pos.x, dz = aimZ - c.pos.z, d = Math.hypot(dx, dz) || 1;
      const want = Math.atan2(dx / d, dz / d);
      c.heading = lerpAngle(c.heading || 0, want, 1 - Math.pow(0.0006, dt));
      // accelerate up to pursuit speed; ease near contact so it nudges, not teleports
      const cruise = c.baseV;
      c.v = c.v + Math.max(-22 * dt, Math.min(16 * dt, cruise - (c.v || 0)));
      c.v = Math.max(2, c.v);
      c.pos.x += Math.sin(c.heading) * c.v * dt;
      c.pos.z += Math.cos(c.heading) * c.v * dt;
      // full oriented hull (body circle + front probe) — these are real cars
      // steered off vehicles.js's lane AI, so they keep its exact wall contract
      // (the bare 1.0 circle let a long cruiser nose clip through corners)
      if (CBZ.cityCollideVehicle) CBZ.cityCollideVehicle(c);
      else if (CBZ.collide) CBZ.collide(c.pos, 1.0);
      if (CBZ.city.arena) CBZ.city.arena.clampToCity(c.pos, 1.0);
      c.group.position.set(c.pos.x, 0, c.pos.z);
      c.group.rotation.y = c.heading;
    }
  }

  // ============================================================
  //  ROADBLOCK (3★+) — the city closes the road AHEAD of you.
  //  WHY: more stars used to just mean MORE cops chasing the same way. Real
  //  escalation changes the SHAPE of the pressure: at 3★ the force starts
  //  staging walls down your travel line — the iconic moment of cresting a
  //  hill into two cruisers nosed together with officers behind the hoods.
  //  It also makes rooftops/lifts matter: when the streets close, going UP
  //  becomes the smart escape.
  //
  //  Mechanics, all pooled (we're draw-call bound):
  //  • While you're DRIVING fast at 3★+, every 45-80s ONE wall is staged
  //    120-200u ahead on the road you're running: 2 police cruisers (the
  //    force's OWN cars, built once and reused) angled nose-to-nose across
  //    the lane, light bars flashing, + 3-4 officers posted standing-aim
  //    behind the engine blocks (no crouch pose exists in the rig).
  //  • Each parked cruiser registers a TEMPORARY collider (markCollidersDirty)
  //    so nobody ghosts the wall on foot. The collider dies with the parking
  //    spot: rammed aside / stolen / wrecked → dropped immediately — and when
  //    the suspect comes in HOT we drop them up front and let the car-car
  //    crash pass own the contact (cruisers are real cars: ramming through at
  //    speed works, but those are engine blocks — your front end pays).
  //  • Officers at the wall fire only inside ~40u with a true sightline —
  //    it's a WALL, not a turret nest.
  //  • Stars <3, suspect on foot/far/past the wall → cruisers light out and
  //    drive off, cops mount up, and every record returns to the pool.
  const RB = {
    state: 0,                 // 0 idle · 1 staged · 2 leaving
    armed: false, cd: 0,      // cadence (ticks down in maintain's 1.1s beat)
    x: 0, z: 0, ux: 0, uz: 1, // wall centre + road direction (unit, pointing DOWNSTREAM of the suspect's travel)
    cars: [], cops: [], cols: [],
    carPool: [], copPool: [], // detached, reusable records — never rebuilt per staging
    flashT: 0, leaveT: 0, age: 0,
  };
  const CRUISER_MODEL = { name: "Police Cruiser", value: 3200, color: 0x16181d, body: "sedan", designStyle: "malibu" };
  let rbM = null;             // shared light-bar/livery mats + ONE unit cube (built once, never disposed)
  function rbMats() {
    if (rbM) return rbM;
    function bm(color) { const m = new THREE.MeshBasicMaterial({ color }); m._shared = true; return m; }
    const white = new THREE.MeshLambertMaterial({ color: 0xe9edf2 }); white._shared = true;
    rbM = { red: bm(0xff2d3e), blue: bm(0x2d6bff), dark: bm(0x101216), white, geo: new THREE.BoxGeometry(1, 1, 1) };
    rbM.geo._shared = true;
    return rbM;
  }
  // turn a plain black sedan into a black-and-white: white door panels + a roof
  // bar whose red/blue halves FLASH by visibility flip (zero material churn).
  function rbDecorate(c) {
    if (c._rbBar) return;
    const M = rbMats();
    const h = (c.dims && c.dims.height) || 1.55, w = (c.dims && c.dims.width) || 1.9;
    const bar = new THREE.Group();
    const base = new THREE.Mesh(M.geo, M.dark); base.scale.set(1.2, 0.09, 0.32); bar.add(base);
    const red = new THREE.Mesh(M.geo, M.red); red.scale.set(0.52, 0.14, 0.28); red.position.set(-0.31, 0.1, 0); bar.add(red);
    const blue = new THREE.Mesh(M.geo, M.blue); blue.scale.set(0.52, 0.14, 0.28); blue.position.set(0.31, 0.1, 0); bar.add(blue);
    bar.position.set(0, h + 0.05, 0.12);
    c.group.add(bar);
    [1, -1].forEach((s) => {
      const door = new THREE.Mesh(M.geo, M.white);
      door.scale.set(0.05, 0.6, 1.2);
      door.position.set(s * (w / 2 + 0.015), 0.98, 0.25);
      c.group.add(door);
    });
    c._rbBar = { red, blue, phase: (rng() * 2) | 0 };
  }
  function rbDispose(grp) {   // same dispose discipline as clearCityCops/clearCars
    if (!grp) return;
    if (grp.parent) grp.parent.remove(grp);
    grp.traverse(function (o) {
      if (o.isSprite) return;   // sprites share an r128 geometry singleton — never dispose
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) { try { o.geometry.dispose(); } catch (e) {} }
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => { if (x && !x._shared && x.dispose) x.dispose(); });
      else if (m && !m._shared && m.dispose) m.dispose();
    });
  }
  // a cruiser is only worth re-pooling if it's still a presentable police unit
  function rbCarUsable(c) {
    return !!(c && !c.dead && !c.player && !c._exploded && !c._onFire &&
      (c.crumple || 0) < 0.55 && (c.engineHp == null || c.engineHp > 35));
  }
  // fresh unit next staging: back out the crumple/engine state a survivable
  // block picked up (same fields crumpleCar/damageEngine wrote).
  function rbRestoreCar(c) {
    c.crumple = 0; c._cside = null; c.group.scale.set(1, 1, 1);
    if (CBZ.cityCarImpactReset) CBZ.cityCarImpactReset(c);   // back out vertex craters / hung panels / dead lamps
    const ud = c.group.userData, base = ud && ud.crashBase;
    if (base) {
      if (ud.body) { ud.body.rotation.set(0, 0, 0); ud.body.position.y = base.bodyY; ud.body.position.z = base.bodyZ; ud.body.scale.set(1, 1, 1); }
      if (ud.cabin) { ud.cabin.rotation.set(0, 0, 0); ud.cabin.position.y = base.cabinY; ud.cabin.position.z = base.cabinZ; ud.cabin.scale.set(1, 1, 1); }
    }
    c.engineHp = null; c._smoking = false; c.wreckT = 0; c.spin = 0;
    c.v = 0; c.vx = 0; c.vz = 0; c.group.rotation.set(0, c.heading || 0, 0);
  }
  // pull an officer for the wall: pooled rig first (reposition + reset), else a
  // fresh makeCop. Always a real record in CBZ.cityCops so damage/death/disarm
  // and the corpse flow all just work.
  function rbCop(x, z, swat) {
    const A = CBZ.city.arena; if (!A) return null;
    let c = null;
    while (RB.copPool.length && !c) { const r = RB.copPool.pop(); if (r && !r.dead && !r.culled) c = r; }
    if (c) {
      c.pos.set(x, 0, z);
      c.hp = c.swat ? 120 : 90; c.dead = false; c.deadT = 0; c.culled = false;   // trimmed: armor (below) carries the rest of the toughness
      c.state = "patrol"; c.giveUp = false; c.searchT = 0; c.curTarget = null; c.npcTarget = null;
      c.arrestT = 0; c._radioT = 0; c._duty = null; c.sees = false; c.retarget = 0; c.lostT = 0;
      c._gunLowered = false; c._gunHidden = false; c.chaseCar = null; c._coverT = 0;
      // re-issue armor on a recycled officer (refills the soak pool, re-mounts the
      // vest/helmet if the kill stripped them, clears the prior corpse loot stamp)
      c._armorLoot = null;
      if (CBZ.cityArmorDressPed) {
        if (c.swat) CBZ.cityArmorDressPed(c, ["swatVest", "helmet"]);
        else if (!c._armorKit && rng() < 0.5) CBZ.cityArmorDressPed(c, ["softVest"]);
        else if (c._armorKit) CBZ.cityArmorDressPed(c, c._armorKit.slice());
      }
      if (c.tag) c.tag.visible = true;
    } else c = makeCop(x, z, swat, false);
    A.root.add(c.group);
    if (CBZ.cityCops.indexOf(c) < 0) CBZ.cityCops.push(c);
    return c;
  }
  // release a posted officer: alive + settled → detach into the pool; dead or
  // mid-ragdoll → leave him to the world (corpse flow / normal response logic).
  function rbDetachCop(c) {
    c._post = null; c.sees = false; c.curTarget = null;
    if (c.dead || (CBZ.body && CBZ.body.busy && CBZ.body.busy(c))) { c.retarget = 0.5; return; }
    const i = CBZ.cityCops.indexOf(c); if (i >= 0) CBZ.cityCops.splice(i, 1);
    if (c.group.parent) c.group.parent.remove(c.group);
    if (RB.copPool.length < 4) RB.copPool.push(c);
    else rbDispose(c.group);
  }
  function rbDropCol(i) {
    const col = RB.cols[i];
    const k = CBZ.colliders.indexOf(col); if (k >= 0) CBZ.colliders.splice(k, 1);
    RB.cols.splice(i, 1);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  function rbDropCols() { for (let i = RB.cols.length - 1; i >= 0; i--) rbDropCol(i); }

  // stage the wall 120-200u DOWN THE ROAD the suspect is actually running —
  // snapped to the street's centre-line and kept out of the intersection box so
  // it reads as a deliberate wall, not parked cross-traffic.
  function rbStage(stars) {
    const A = CBZ.city.arena, P = CBZ.player;
    if (!A || !P || !P.driving || !P._vehicle || P._vehicle.dead || !A.xLines) return false;
    const car = P._vehicle;
    const dx = car.vx || 0, dz = car.vz || 0;
    if (Math.hypot(dx, dz) < 9) return false;          // only a suspect RUNNING gets a wall
    const ROAD = A.ROAD || 9, D = 120 + rng() * 80;
    let bx, bz, ux, uz;
    if (Math.abs(dx) >= Math.abs(dz)) {
      // running a cross-street (along x): same street, projected ahead
      let zl = A.zLines[0]; for (const v of A.zLines) if (Math.abs(v - P.pos.z) < Math.abs(zl - P.pos.z)) zl = v;
      if (Math.abs(zl - P.pos.z) > ROAD) return false; // off-grid (bridge/island/lot) — no street to close
      const s = dx > 0 ? 1 : -1;
      bx = Math.max(A.minX + 14, Math.min(A.maxX - 14, P.pos.x + s * D));
      let xl = A.xLines[0]; for (const v of A.xLines) if (Math.abs(v - bx) < Math.abs(xl - bx)) xl = v;
      if (Math.abs(bx - xl) < ROAD / 2 + 6) bx = xl + s * (ROAD / 2 + 6);
      if (bx < A.minX + 10 || bx > A.maxX - 10) bx = xl - s * (ROAD / 2 + 6);   // last intersection: set up on the NEAR side, not in the perimeter wall
      if ((bx - P.pos.x) * s < 80) return false;       // map edge clamped it too close — no crest, no drama
      bz = zl; ux = s; uz = 0;
    } else {
      // running an avenue (along z)
      let xl = A.xLines[0]; for (const v of A.xLines) if (Math.abs(v - P.pos.x) < Math.abs(xl - P.pos.x)) xl = v;
      if (Math.abs(xl - P.pos.x) > ROAD) return false;
      const s = dz > 0 ? 1 : -1;
      bz = Math.max(A.minZ + 14, Math.min(A.maxZ - 14, P.pos.z + s * D));
      let zl = A.zLines[0]; for (const v of A.zLines) if (Math.abs(v - bz) < Math.abs(zl - bz)) zl = v;
      if (Math.abs(bz - zl) < ROAD / 2 + 6) bz = zl + s * (ROAD / 2 + 6);
      if (bz < A.minZ + 10 || bz > A.maxZ - 10) bz = zl - s * (ROAD / 2 + 6);   // last intersection: near side, never in the perimeter wall
      if ((bz - P.pos.z) * s < 80) return false;
      bx = xl; ux = 0; uz = s;
    }
    const lx = -uz, lz = ux;                            // lateral, across the lane
    // ---- 2 cruisers, noses kissing mid-lane, the V pointed back at you ----
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? -1 : 1;
      const cx = bx + lx * side * 2.5 + ux * 0.8, cz = bz + lz * side * 2.5 + uz * 0.8;
      const heading = Math.atan2(-ux * 0.8 - lx * side, -uz * 0.8 - lz * side);
      let c = null;
      while (RB.carPool.length && !c) { const r = RB.carPool.pop(); if (rbCarUsable(r)) c = r; else rbDispose(r.group); }
      if (c) { CBZ.cityCars.push(c); A.root.add(c.group); }
      else { c = CBZ.cityMakeCar ? CBZ.cityMakeCar(cx, cz, heading, uz !== 0, CRUISER_MODEL, 0) : null; if (c) rbDecorate(c); }
      if (!c) { rbAbort(); return false; }
      c.pos.set(cx, 0, cz); c.heading = heading;
      c.group.position.set(cx, 0, cz); c.group.rotation.set(0, heading, 0);
      c.ai = false; c.player = false; c.stolen = false; c.npcDriver = null; c.road = null;
      c.v = 0; c.vx = 0; c.vz = 0; c.baseV = 0; c.reckless = false; c._pursuit = false;
      c._roadblock = CBZ.now; c._rbLeave = 0;
      RB.cars.push(c);
      // TEMPORARY collider over the parked hull — on-foot actors can't ghost the
      // wall. It dies with the parking spot (see rbUpdate), never outlives it.
      const col = { minX: cx - 2.0, maxX: cx + 2.0, minZ: cz - 2.0, maxZ: cz + 2.0, ref: c.group, noCam: true, _rb: c, _px: cx, _pz: cz };
      CBZ.colliders.push(col); RB.cols.push(col);
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    // ---- 3-4 officers posted behind the engine blocks (5★ posts NOOSE bodies
    //      behind the same cruisers — heavier line, same pooled cars) ----
    const lanes = stars >= 4 ? [-3.2, -1.1, 1.1, 3.2] : [-2.6, 0, 2.6];
    for (let k = 0; k < lanes.length; k++) {
      const c = rbCop(bx + ux * 3.6 + lx * lanes[k], bz + uz * 3.6 + lz * lanes[k], stars >= 5);
      if (!c) continue;
      c._post = { x: c.pos.x, z: c.pos.z, fx: -ux, fz: -uz, mount: null, mountT: 0 };
      drawGun(c);
      RB.cops.push(c);
    }
    RB.x = bx; RB.z = bz; RB.ux = ux; RB.uz = uz;
    RB.state = 1; RB.age = 0; RB.flashT = 0;
    // (CUT: the 📻 "wall it off" subtitle — police-net traffic the suspect
    // can't hear. The wall sells itself: the siren below, then a row of
    // light-bars strobing across the lane ahead of you.)
    if (CBZ.sfx) CBZ.sfx("siren");
    return true;
  }
  function rbAbort() {        // a half-staged wall is torn straight back down
    rbDropCols();
    for (const c of RB.cops.splice(0)) if (c) rbDetachCop(c);
    for (const c of RB.cars.splice(0)) rbParkCar(c);
    RB.state = 0;
  }
  function rbParkCar(c) {     // pull a cruiser record out of the live world, into the pool
    if (!c) return;
    c._roadblock = 0;
    if (!rbCarUsable(c)) return;                        // stolen/wrecked unit stays in the world as-is
    const i = CBZ.cityCars.indexOf(c); if (i >= 0) CBZ.cityCars.splice(i, 1);
    if (c.group.parent) c.group.parent.remove(c.group);
    rbRestoreCar(c);
    if (RB.carPool.length < 2) RB.carPool.push(c);
    else rbDispose(c.group);
  }
  // wall comes down: colliders die first (the cars are about to MOVE), cruisers
  // light out down the closed road, officers jog to mount up.
  function rbTeardown() {
    if (RB.state !== 1) return;
    rbDropCols();
    RB.state = 2; RB.leaveT = 5;
    for (const c of RB.cops) if (c && !c.dead && c._post) { c._post.mount = RB.cars.find(rbCarUsable) || null; c._post.mountT = 0; }
    for (const c of RB.cars) if (rbCarUsable(c)) c._rbLeave = 0.9 + rng() * 0.8;   // a beat to load up, then roll
  }
  function rbLeaveTick(dt) {
    RB.leaveT -= dt;
    let rolling = false;
    for (const c of RB.cars) {
      if (!rbCarUsable(c)) continue;
      if (c._rbLeave > 0) { c._rbLeave -= dt; rolling = true; continue; }
      const want = Math.atan2(RB.ux, RB.uz);            // off DOWN the road they closed, lights still going
      c.heading = lerpAngle(c.heading || 0, want, 1 - Math.pow(0.02, dt));
      c.v = Math.min(13, (c.v || 0) + 9 * dt);
      c.pos.x += Math.sin(c.heading) * c.v * dt;
      c.pos.z += Math.cos(c.heading) * c.v * dt;
      // same wall contract as every driven car (oriented hull + front probe)
      if (CBZ.cityCollideVehicle) CBZ.cityCollideVehicle(c);
      else if (CBZ.collide) CBZ.collide(c.pos, 1.2);
      if (CBZ.city.arena) CBZ.city.arena.clampToCity(c.pos, 1.2);
      c.group.position.set(c.pos.x, 0, c.pos.z);
      c.group.rotation.y = c.heading;
      // keep rolling until clear of the PLAYER's eyes — never despawn on camera
      if (RB.leaveT > 0 || Math.hypot(c.pos.x - CBZ.player.pos.x, c.pos.z - CBZ.player.pos.z) < 80) rolling = true;
    }
    if (!rolling || RB.leaveT <= -8) rbPark();
  }
  function rbPark() {
    for (const c of RB.cops.splice(0)) if (c && c._post) rbDetachCop(c);   // stragglers mount up instantly
    for (const c of RB.cars.splice(0)) rbParkCar(c);
    RB.state = 0;
    RB.cd = 38 + rng() * 30;    // next wall lands ~45-80s after this one went up
  }
  // cadence — runs on maintain's 1.1s beat. ONE wall citywide, ever.
  function rbMaintain(stars, P) {
    if (RB.state) return;
    if (stars < 3) { RB.armed = false; return; }
    if (!RB.armed) { RB.armed = true; RB.cd = 26 + rng() * 14; }   // first wall ~30s into a sustained chase
    if (!P || !P.driving || !P._vehicle || g.state !== "playing") return;
    RB.cd -= 1.1;
    if (RB.cd <= 0 && !rbStage(stars)) RB.cd = 7;       // bad geometry (off-grid/edge) — retry shortly
  }
  // per-frame while a wall exists: flash the bars, keep colliders honest,
  // hand a hot ram to the crash pass, and pull the trigger on teardown.
  function rbUpdate(dt) {
    if (!RB.state) return;
    const P = CBZ.player, stars = g.wanted | 0;
    RB.flashT += dt;
    const ph = (RB.flashT * 6) | 0;
    for (const c of RB.cars) if (c && c._rbBar && !c.player) {
      const on = ((ph + c._rbBar.phase) & 1) === 0;
      c._rbBar.red.visible = on; c._rbBar.blue.visible = !on;
    }
    if (RB.state === 2) { rbLeaveTick(dt); return; }
    RB.age += dt;
    // a cruiser knocked off its spot (rammed aside / stolen / wrecked) stops
    // blocking — the collider dies with the parking spot, it NEVER goes stale.
    for (let i = RB.cols.length - 1; i >= 0; i--) {
      const c = RB.cols[i]._rb;
      if (!c || c.dead || c.player || c.wreckT > 0 ||
          Math.hypot(c.pos.x - RB.cols[i]._px, c.pos.z - RB.cols[i]._pz) > 1.2) rbDropCol(i);
    }
    // shoved cruisers still need to MOVE (ai=false cars skip the traffic loop):
    // integrate the crash impulse the car-car pass gave them so they skid aside.
    for (const c of RB.cars) {
      if (!c || c.dead || c.player || !(c.wreckT > 0)) continue;
      c.wreckT -= dt;
      c.v = (c.v || 0) * Math.pow(0.04, dt);
      c.spin = (c.spin || 0) * Math.pow(0.25, dt);
      c.heading += c.spin * dt;
      c.pos.x += Math.sin(c.heading) * c.v * dt;
      c.pos.z += Math.cos(c.heading) * c.v * dt;
      c.group.position.set(c.pos.x, 0, c.pos.z);
      c.group.rotation.y = c.heading;
    }
    // suspect coming in HOT: drop the static boxes and let the car-car crash
    // pass own the contact — the cruisers can be shoved, your front end pays.
    if (P.driving && P._vehicle && RB.cols.length) {
      const v = P._vehicle;
      if (Math.hypot(v.vx || 0, v.vz || 0) > 9 && Math.hypot(v.pos.x - RB.x, v.pos.z - RB.z) < 18) rbDropCols();
    }
    // teardown: heat broke, suspect bailed on foot / got far / blew past the
    // wall, or the wall went stale — pack up and roll out
    const pdx = P.pos.x - RB.x, pdz = P.pos.z - RB.z, pd = Math.hypot(pdx, pdz);
    const past = (pdx * RB.ux + pdz * RB.uz) > 26;
    if (stars < 3 || P.dead || pd > 230 || past || (!P.driving && pd > 60) || RB.age > 60 || g.state !== "playing") rbTeardown();
  }
  // full reset (mode teardown): colliders out, pooled rigs disposed. Posted
  // officers live in CBZ.cityCops, so clearCityCops' own loop disposes them.
  function rbReset() {
    rbDropCols();
    for (const c of RB.cops) if (c) c._post = null;
    RB.cops.length = 0;
    for (const c of RB.cars) {
      if (!c) continue;
      c._roadblock = 0;
      const i = CBZ.cityCars.indexOf(c);
      if (i >= 0 && !c.player) { CBZ.cityCars.splice(i, 1); rbDispose(c.group); }
      else if (i < 0) rbDispose(c.group);
      // a player-driven cruiser stays: it's just a stolen car now
    }
    RB.cars.length = 0;
    for (const c of RB.copPool) if (c) rbDispose(c.group);
    RB.copPool.length = 0;
    for (const c of RB.carPool) if (c) rbDispose(c.group);
    RB.carPool.length = 0;
    RB.state = 0; RB.armed = false; RB.cd = 0;
  }
  // the minimap/full map can flag the closed street ahead (a 🚧 with a bearing)
  CBZ.cityRoadblockPos = function () { return RB.state === 1 ? { x: RB.x, z: RB.z } : null; };

  // pick the best target for a cop: the player (if wanted) or an NPC offender
  function chooseTarget(cop) {
    let best = null, bestScore = -1, bestPed = null;
    const cp = cop.pos;
    if ((g.wanted | 0) >= 1 && !CBZ.player.dead) {
      const d = Math.hypot(cp.x - CBZ.player.pos.x, cp.z - CBZ.player.pos.z);
      // ESCAPED CONVICT: the manhunt is personal — a fleeing felon outranks a
      // random armed NPC offender, so cops lock onto YOU over an equal-stars ped.
      const convictBias = g.escapedConvict ? 40 + d * 0.4 : 0;   // also blunts the distance falloff
      const sc = (g.wanted | 0) * 30 - d * 0.5 + convictBias;
      if (sc > bestScore) { bestScore = sc; best = CBZ.city.playerActor; bestPed = null; }
    }
    for (const p of CBZ.cityPeds) {
      // already in restraints (the player's collar) = already in custody — a cop
      // hunting a zip-tied suspect would shoot the body you're delivering.
      if (p.dead || p.restraint || (p.npcWanted | 0) < 1) continue;
      const d = Math.hypot(cp.x - p.pos.x, cp.z - p.pos.z);
      if (d > 60) continue;
      const sc = (p.npcWanted | 0) * 24 + (p.armed ? 12 : 0) - d * 0.6;
      if (sc > bestScore) { bestScore = sc; best = p; bestPed = p; }
    }
    // multiplayer (sim host): remote players are chaseable/shootable too —
    // scored exactly like the local player on the SHARED wanted level.
    if ((g.wanted | 0) >= 1 && CBZ.net && CBZ.net.aiTargets) {
      for (const r of CBZ.net.aiTargets()) {
        if (r.dead) continue;
        const d = Math.hypot(cp.x - r.pos.x, cp.z - r.pos.z);
        const sc = (g.wanted | 0) * 30 - d * 0.5;
        if (sc > bestScore) { bestScore = sc; best = r; bestPed = null; }
      }
    }
    cop.npcTarget = bestPed;
    return best;
  }

  // ---- per-frame update --------------------------------------------------
  CBZ.onUpdate(35, function (dt) {
    if (g.mode !== "city") return;
    if (CBZ.net && CBZ.net.noSim()) return;   // multiplayer guest: cops are host-synced puppets
    if (g.state === "playing") maintain(dt);
    frame++;
    // prune dead/lost car suspects
    for (let i = carSuspects.length - 1; i >= 0; i--) { const c = carSuspects[i]; if (!c || c.dead || c.pullover !== 4) carSuspects.splice(i, 1); }

    const P = CBZ.player, camx = CBZ.camera.position.x, camz = CBZ.camera.position.z;
    const stars = g.wanted | 0;
    const A = CBZ.city.arena;
    const cops = CBZ.cityCops;
    for (let i = cops.length - 1; i >= 0; i--) {
      const c = cops[i];
      if (c.dead) {
        if (c.tag) c.tag.visible = false;
        c.deadT += dt;
        if (c.deadT > 8 && !c.culled) { c.culled = true; if (c.group.parent) c.group.parent.remove(c.group); cops.splice(i, 1); }
        continue;
      }
      if (CBZ.body && CBZ.body.busy && CBZ.body.busy(c)) { c.sees = false; continue; }
      // a cop running a GUN STOP is driven by updateGunStop() — keep him out of the
      // normal hunt/arrest logic so he just stands you down over the weapon.
      if (c.gunstop) { c.sees = false; continue; }
      // ---- RADIO BEAT: stopped, eyes toward the trouble, hand on the shoulder
      // mic. He is briefly NOT advancing — visible (exploitable) procedure; the
      // reinforcement hold in maintain() releases as this call ends.
      if (c._radioT > 0) {
        c._radioT -= dt;
        c.sees = false;
        const lk = g.cityLastKnown;
        const nearR = (c.pos.x - camx) * (c.pos.x - camx) + (c.pos.z - camz) * (c.pos.z - camz) < ANIM_D2;
        standIdle(c, lk ? Math.atan2(lk.x - c.pos.x, lk.z - c.pos.z) : c.group.rotation.y, dt, nearR);
        if (nearR) radioPose(c.char);
        continue;
      }
      // ---- POSTED AT A ROADBLOCK: hold the slot behind the engine block, gun
      //      up the street. A WALL, not a turret nest — fire only on a suspect
      //      inside ~40u with a true sightline. On teardown each officer jogs
      //      to the cruiser before the unit rolls (then returns to the pool).
      if (c._post) {
        const post = c._post;
        const nearB = (c.pos.x - camx) * (c.pos.x - camx) + (c.pos.z - camz) * (c.pos.z - camz) < ANIM_D2;
        if (!c.armed) drawGun(c);
        if (c.shootCD > 0) c.shootCD -= dt;
        if (RB.state === 2) {                                  // mounting up — the wall is leaving
          post.mountT += dt;
          const m = post.mount;
          const mx = m && m.pos ? m.pos.x : RB.x, mz = m && m.pos ? m.pos.z : RB.z;
          const mdx = mx - c.pos.x, mdz = mz - c.pos.z;
          if (post.mountT > 2.2 || Math.hypot(mdx, mdz) < 2.0) { rbDetachCop(c); continue; }
          stepTo(c, mdx, mdz, c.baseSpeed * 1.15, dt, nearB);
          continue;
        }
        const hdx = post.x - c.pos.x, hdz = post.z - c.pos.z;
        if (Math.hypot(hdx, hdz) > 0.8) { stepTo(c, hdx, hdz, c.baseSpeed, dt, nearB); continue; }
        const pdx = P.pos.x - c.pos.x, pdz = P.pos.z - c.pos.z, pd = Math.hypot(pdx, pdz);
        if (c._losCD == null) c._losCD = rng() * 0.25;
        c._losCD -= dt;
        if (c._losCD <= 0) { c._losCD = 0.22 + rng() * 0.12; c._losClear = pd < 40 && !P.dead && losClear(c.pos.x, c.pos.z, P.pos.x, P.pos.z); }
        c.sees = pd < 40 && !P.dead && stars >= 1 && !!c._losClear;
        c.curTarget = c.sees ? CBZ.city.playerActor : null;    // feeds the aim pose + gun visibility
        if (c.sees && c.shootCD <= 0) {
          c.shootCD = (c.swat ? 0.2 : 0.55) + rng() * 0.3;
          fireAt(c, CBZ.city.playerActor, pd);
        }
        standIdle(c, c.sees ? Math.atan2(pdx, pdz) : Math.atan2(post.fx, post.fz), dt, nearB);
        continue;
      }
      // stars out = guns out: the call is in, leather clears. (The 0★ holstering
      // lives in the patrol branch below, behind a calm-hysteresis, so the belt
      // can never flap mid-fight.)
      if ((stars >= 1 || c.swat) && !c.armed) drawGun(c);
      if (c.retarget > 0) c.retarget -= dt;
      if (c.shootCD > 0) c.shootCD -= dt;

      // (re)choose a target periodically — but DON'T re-lock onto the player while
      // we're mid-SEARCH (we lost sight; go investigate the last-known spot, not
      // beeline to their live position). We only re-acquire when we can see again.
      if (c.retarget <= 0 && !(c.searchT > 0)) { c.retarget = 0.6; c.curTarget = chooseTarget(c); }
      let tgt = c.searchT > 0 ? null : c.curTarget;
      // a car suspect overrides if one is near + this cop is free
      if (!c.npcTarget && (!tgt || tgt === CBZ.city.playerActor && stars === 0)) {
        const cs = nearestCarSuspect(c.pos);
        if (cs) c.chaseCar = cs; else c.chaseCar = null;
      } else c.chaseCar = null;

      const near = (c.pos.x - camx) * (c.pos.x - camx) + (c.pos.z - camz) * (c.pos.z - camz) < ANIM_D2;

      // ---- behaviour ----
      if (c.giveUp) {
        c.state = "leave";
        // de-escalation, NOT a casualty: an officer who stands down walks off
        // duty and returns to the reserve (the force is unchanged — only a KILL
        // depletes it). Guard with _returned so the same body can't bank twice.
        if (frame % 240 === 0 && rng() < 0.5) { if (c.group.parent) c.group.parent.remove(c.group); if (!c._returned && c.kind === "cop") { c._returned = true; forcePool = Math.min(POLICE_FORCE_MAX(), forcePool + 1); } cops.splice(i, 1); continue; }
        const gx = A.minX - 18 - c.pos.x, gz = 0; stepTo(c, gx, gz, c.baseSpeed, dt, near); continue;
      }

      // chase a fleeing car
      if (c.chaseCar && !tgt) {
        const car = c.chaseCar;
        const gx = car.pos.x - c.pos.x, gz = car.pos.z - c.pos.z, gd = Math.hypot(gx, gz);
        if (gd < 3.2) { /* vehicles.js busts it on contact */ }
        stepTo(c, gx, gz, c.baseSpeed, dt, near);
        continue;
      }

      // hunting an offender (player or NPC)
      if (tgt && !tgt.dead) {
        const isPlayer = tgt === CBZ.city.playerActor;
        const tx = tgt.pos.x, tz = tgt.pos.z;
        const dx = tx - c.pos.x, dz = tz - c.pos.z, dist = Math.hypot(dx, dz);

        // real LINE OF SIGHT + lost-sight memory, via the shared tactics module
        // (systems/aitactics.js): within range AND not blocked by a building,
        // re-tested on a throttled per-cop cadence, with a glass-breach re-confirm
        // (sees through a hole it just shot) and the chopper spotlight counting as
        // an extra "painted" sighting. No AT loaded (stripped build) → fall back
        // to the bare losClear probe so a cop still functions, just without memory.
        const painted = isPlayer && CBZ.cityChopperPaints && CBZ.cityChopperPaints();
        if (AT) {
          const ty2 = isPlayer ? 1.55 : 1.3;
          const losRes = AT.updateLOS(c, tx, tz, dt, {
            range: 48, breachReach: BREACH_REACH, painted, targetY: (tgt.pos.y || 0) + ty2, rng,
          });
          if (isPlayer && losRes.sees) g.cityLastKnown = { x: tx, z: tz, t: CBZ.now };
          if (losRes.justLost) {
            c.curTarget = null; c.retarget = 0.4;
            goSearch(c, isPlayer ? (g.cityLastKnown || { x: c.lkx, z: c.lkz }) : { x: c.lkx, z: c.lkz });
            continue;
          }
        } else {
          if (c._losCD == null) c._losCD = rng() * 0.25;
          c._losCD -= dt;
          if (c._losCD <= 0) {
            c._losCD = 0.22 + rng() * 0.12;
            c._losClear = dist < 48 && losClear(c.pos.x, c.pos.z, tx, tz);
            if (!c._losClear && (c._breachedT || 0) > 0 && dist < BREACH_REACH && CBZ.clearLineOfFire) {
              const ty2 = isPlayer ? 1.55 : 1.3;
              c._losClear = CBZ.clearLineOfFire(c.pos.x, (c.pos.y || 0) + 1.4, c.pos.z, tx, (tgt.pos.y || 0) + ty2, tz);
            }
          }
          c.sees = dist < 48 && (c._losClear || painted || dist < 4);
          if (c.sees) {
            c.lostT = 0; c.lkx = tx; c.lkz = tz;
            if (isPlayer) g.cityLastKnown = { x: tx, z: tz, t: CBZ.now };
          } else {
            c.lostT = (c.lostT || 0) + dt;
            if (c.lostT > (stars >= 4 ? 6 : 4)) { c.curTarget = null; c.retarget = 0.4; goSearch(c, isPlayer ? (g.cityLastKnown || { x: c.lkx, z: c.lkz }) : { x: c.lkx, z: c.lkz }); continue; }
          }
        }

        const npcThreat = !isPlayer && (tgt.armed || tgt.aggr >= 0.85 || (tgt.npcWanted | 0) >= 2);
        const wantArrest = isPlayer ? (stars <= 2 && !P.driving) : !npcThreat;
        const wantShoot = isPlayer ? stars >= 2 : npcThreat;
        // PROCEDURE: the gun leaves the belt only when the stop calls for it —
        // an armed suspect (or gunfire-grade heat nearby) gets drawn on; a plain
        // 0★ collar of an unarmed brawler stays hands-on, holster snapped.
        if (wantShoot || tgt.armed) drawGun(c);
        c._calmT = 0;

        // assign each cop a FLANK lane so they don't bunch up — left/right/center
        // by index so a squad surrounds you instead of conga-lining single file.
        if (AT) AT.flankLane(c, i, 3); else if (c._flank == null) c._flank = ((i % 3) - 1);   // -1 left, 0 center, +1 right

        // ---- ARREST: only when we actually see them + are right on top ----
        if (wantArrest && c.sees && dist < 1.9) {
          if (isPlayer) {
            if (P.speed < 2.4 && !P._fighting) {
              if (c.arrestT === 0 && CBZ.city && CBZ.city.note) CBZ.city.note("🚔 \"FREEZE! Hands where I can see them!\"", 1.0);
              c.arrestT += dt; c.speed = 0; if (c.arrestT > 1.0) { CBZ.cityBust && CBZ.cityBust(); return; } if (near) animChar(c.char, 0, dt); continue;
            } else c.arrestT = 0;
          } else { c.arrestT += dt; c.speed = 0; if (c.arrestT > 0.8) { CBZ.cityNpcArrest(tgt); c.npcTarget = null; c.curTarget = null; } if (near) animChar(c.char, 0, dt); continue; }
        } else c.arrestT = 0;

        // ---- SHOOT (only with a REAL line of fire) — and DUCK FOR COVER between
        //      bursts. The c.sees flag already proves a torso-height sightline; here
        //      we re-check from the actual MUZZLE so a barrel poking past a corner
        //      can't squeeze a shot through a wall the body can't see through.
        if (wantShoot && c.sees && dist < 30) {
          if (c.shootCD <= 0) {
            c.shootCD = (c.swat ? 0.16 : 0.5) + rng() * 0.3;
            fireAt(c, tgt, dist);   // fireAt does the final muzzle→target clearLineOfFire gate
            // after a burst, an armed target may make a cop break to cover briefly
            if (isPlayer && stars >= 2 && playerArmed() && rng() < (c.swat ? 0.12 : 0.28)) {
              if (AT) AT.coverArm(c, { dur: 1.0 + rng(), rng });
              else { c._coverT = 1.0 + rng(); c._coverDir = rng() < 0.5 ? -1 : 1; }
            }
          }
        }

        // taking cover: sidestep perpendicular to the target, then peek back out
        // (shared cover-peek cycle — systems/aitactics.js)
        if (c._coverT > 0) {
          const step = AT ? AT.coverPeek(c, dx, dz, dist, dt, { sideAmt: 4, peek: 0.15 }) : null;
          if (step) { stepTo(c, step.x, step.z, c.baseSpeed * 1.1, dt, near); continue; }
          if (!AT) {
            c._coverT -= dt;
            const px = -dz / (dist || 1), pz = dx / (dist || 1);   // perpendicular
            stepTo(c, px * c._coverDir * 4 + dx * 0.15, pz * c._coverDir * 4 + dz * 0.15, c.baseSpeed * 1.1, dt, near);
            continue;
          }
        }

        // ---- NO LINE OF FIRE → BREACH THE GLASS, else ROUTE TO THE DOOR, else
        //      FLANK. A wanted shooter who can't see the target because a
        //      STOREFRONT WINDOW (and its wall) sits between them now SHOOTS THE
        //      GLASS OUT instead of milling — the broken pane reads as open air
        //      (cityShotHole), so next frame c.sees flips clear and the chase
        //      below closes straight through the hole. cityNpcBreachGlass only
        //      fires when there's genuinely breakable glass on the firing lane
        //      within reach, so cops never plink random windows. No glass + the
        //      target is INSIDE a building we're walled out of → make for that
        //      building's DOOR instead of grinding on the facade. Both routed
        //      through the shared breachOrRoute (systems/aitactics.js); cops opt
        //      into BOTH capabilities (canBreach + canRouteDoors) — other armed
        //      NPCs via squadai.js currently opt into neither (street fighters,
        //      not building-clearing officers).
        if (wantShoot && AT) {
          const detour = AT.breachOrRoute(c, tgt, tx, tz, dist, dt, {
            canBreach: true, canRouteDoors: true, breachReach: BREACH_REACH, doorRange: 34, rng,
          });
          if (detour) {
            if (detour.kind === "breach") c.shootCD = Math.max(c.shootCD, 0.18);   // the breach round IS this beat's shot
            const spd = detour.kind === "breach" ? c.baseSpeed : c.baseSpeed * 1.05;
            stepTo(c, detour.x, detour.z, spd, dt, near);
            continue;
          }
        } else if (wantShoot && !AT) {
          if (!c.sees && dist < BREACH_REACH && c._losClear === false) {
            if (CBZ.cityNpcBreachGlass && CBZ.cityNpcBreachGlass(c, tgt, BREACH_REACH)) {
              c.shootCD = Math.max(c.shootCD, 0.18);
              c._losCD = 0;
              stepTo(c, dx, dz, c.baseSpeed, dt, near);
              continue;
            }
          }
          if (c._losClear === false && !c.sees && dist < 34 && CBZ.cityNav && CBZ.cityNav.indoorLotAt) {
            c._doorCD = (c._doorCD || 0) - dt;
            if (c._doorCD <= 0) {
              c._doorCD = 0.5 + rng() * 0.3;
              const lot = CBZ.cityNav.indoorLotAt(tx, tz);
              const door = lot && lot.building && lot.building.door;
              c._doorGoal = (door && Math.hypot(door.x - c.pos.x, door.z - c.pos.z) > 2.4) ? { x: door.x, z: door.z } : null;
            }
            if (c._doorGoal) {
              const ddx = c._doorGoal.x - c.pos.x, ddz = c._doorGoal.z - c.pos.z;
              if (Math.hypot(ddx, ddz) < 2.2 || c.sees) { c._doorGoal = null; }
              else { stepTo(c, ddx, ddz, c.baseSpeed * 1.05, dt, near); continue; }
            }
          } else { c._doorGoal = null; }
        }

        // BLIND FLANK: "can't see them, work the corner" perpendicular dodge
        // (shared — systems/aitactics.js), flipping side every ~1.2-2.0s.
        if (wantShoot && !c.sees && dist < 42) {
          const step = AT ? AT.blindFlank(c, dx, dz, dist, dt, { period: 1.2, periodJitter: 0.8, sideAmt: 5, closeBias: 0.35, rng })
            : (function () {
              c._flankT = (c._flankT || 0) - dt;
              if (c._flankT <= 0 || c._flankSide == null) { c._flankT = 1.2 + rng() * 0.8; c._flankSide = (c._flankSide === 1) ? -1 : 1; }
              const px = -dz / (dist || 1), pz = dx / (dist || 1);
              return { x: px * c._flankSide * 5 + dx * 0.35, z: pz * c._flankSide * 5 + dz * 0.35 };
            })();
          stepTo(c, step.x, step.z, c.baseSpeed * 1.05, dt, near);
          continue;
        }

        // approach with a FLANK offset so the squad encircles, and hold a
        // firing-line distance once we're a threat-range shooter.
        const flankAmt = isPlayer && stars >= 3 ? 7 : 4;
        const appr = AT ? AT.flankApproach(c, dx, dz, dist, flankAmt) : (function () {
          const px = -dz / (dist || 1), pz = dx / (dist || 1);
          return { x: dx + px * c._flank * flankAmt, z: dz + pz * c._flank * flankAmt };
        })();
        const stop = (wantShoot && dist < (isPlayer ? (stars >= 3 ? 9 : 4) : 8)) ? (isPlayer && stars >= 3 ? 8 : 5) : 1.5;
        const spd = c.baseSpeed * (c.sees ? 1 : 1.12);     // sprint a touch when chasing blind
        if (dist > stop) stepTo(c, appr.x, appr.z, spd, dt, near);
        else { c.speed = 0; c.group.rotation.y = lerpAngle(c.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.002, dt)); if (near) animChar(c.char, 0, dt); finalizeMove(c); }
        continue;
      }

      // ---- SEARCH: go to last-known, then sweep nearby before giving up ----
      // (shared sweep state machine — systems/aitactics.js searchTick; the
      // player RE-ACQUIRE shout stays cop-specific procedure, inline below)
      if (c.searchT > 0 && (stars >= 1 || c.npcSearch)) {
        // RE-ACQUIRE: if we catch sight of the wanted player again mid-sweep, drop
        // the search and resume the hunt (GTA: spotted you again → back to chase).
        if (stars >= 1 && !CBZ.player.dead) {
          const pdx = CBZ.player.pos.x - c.pos.x, pdz = CBZ.player.pos.z - c.pos.z, pd = Math.hypot(pdx, pdz);
          const painted = CBZ.cityChopperPaints && CBZ.cityChopperPaints();
          if (pd < 30 && (painted || losClear(c.pos.x, c.pos.z, CBZ.player.pos.x, CBZ.player.pos.z))) {
            c.searchT = 0; c.searchGoal = null; c._sweepGoal = null; c.curTarget = CBZ.city.playerActor; c.retarget = 0.5; c.sees = true; c.lostT = 0;
            // a SHOUT, not radio-speak — he's within 30u, you'd genuinely hear it
            if (CBZ.city && CBZ.city.note && rng() < 0.4) CBZ.city.note("👮 \"There he is!\"", 0.9);
            continue;
          }
        }
        c.sees = false;
        if (AT) {
          if (!c.searchGoal && g.cityLastKnown) c.searchGoal = { x: g.cityLastKnown.x, z: g.cityLastKnown.z };
          const step = AT.searchTick(c, dt, { sweepRadMin: 6, sweepRadMax: 16, reachR: 3, rng });
          if (step) stepTo(c, step.x, step.z, c.baseSpeed * (step.sweeping ? 0.7 : 1), dt, near);
        } else {
          c.searchT -= dt;
          const sg = c.searchGoal || g.cityLastKnown;
          if (sg) {
            const sdx = sg.x - c.pos.x, sdz = sg.z - c.pos.z, sd = Math.hypot(sdx, sdz);
            if (sd < 3) {
              if (!c._sweepGoal || Math.hypot(c.pos.x - c._sweepGoal.x, c.pos.z - c._sweepGoal.z) < 2.5) {
                const ang = rng() * 6.28, rad = 6 + rng() * 10;
                c._sweepGoal = { x: sg.x + Math.cos(ang) * rad, z: sg.z + Math.sin(ang) * rad };
              }
              stepTo(c, c._sweepGoal.x - c.pos.x, c._sweepGoal.z - c.pos.z, c.baseSpeed * 0.7, dt, near);
            } else stepTo(c, sdx, sdz, c.baseSpeed, dt, near);
          }
        }
        if (c.searchT <= 0) { c.searchGoal = null; c._sweepGoal = null; c.npcSearch = false; if (stars === 0 && !c.ambient) c.giveUp = true; }
        continue;
      }

      // ---- patrol (ambient, no target) — BEAT PROCEDURE, not wandering drones --
      c.sees = false; c.npcTarget = null;
      // calm streets: after a few quiet seconds the sidearm goes back on the belt
      if (stars === 0 && !c.swat && c.armed) { c._calmT = (c._calmT || 0) + dt; if (c._calmT > 2.5) holsterGun(c); }

      // MOVE-ALONG duty: walk the scene (corpse / brawl / rough sleeper), say the
      // line, wave the block off, hold it a beat. Assigned by scanDuty — one
      // citywide at a time, 0★ only. Vagrants are shooed, never targeted.
      if (c._duty) {
        const D = c._duty, p = D.ped;
        const stale = stars !== 0 || !p || (D.kind === "corpse" ? p._copSecured : (p.dead || (p.npcWanted | 0) >= 1));
        if (stale) { c._duty = null; if (dutyCop === c) dutyCop = null; }
        else {
          const ddx = p.pos.x - c.pos.x, ddz = p.pos.z - c.pos.z, dd = Math.hypot(ddx, ddz);
          if (dd > 2.4 && D.hold == null) { stepTo(c, ddx, ddz, c.baseSpeed * 0.85, dt, near); continue; }
          if (D.hold == null) {
            D.hold = 2.6;
            copBark(c, D.kind === "corpse" ? ["Step back — this is a scene now.", "Nothing to see here. Keep it moving."]
              : D.kind === "brawl" ? ["HEY! Break it up — NOW.", "Hands off each other. Walk away."]
                : ["You can't camp here. Move along.", "Off the block. There's a shelter east side."]);
            disperse(c, p.pos.x, p.pos.z, D.kind);
          }
          D.hold -= dt;
          standIdle(c, Math.atan2(ddx, ddz), dt, near);
          if (D.hold <= 0) {
            if (D.kind === "corpse") p._copSecured = true;   // scene secured — one visit per body
            c._duty = null; if (dutyCop === c) dutyCop = null;
          }
          continue;
        }
      }

      // PAIR UP: foot beats walk in twos (real procedure). Lead strolls the
      // route; the partner holds the right-shoulder slot and stops when he stops.
      if (c.ambient && !c.swat) {
        if (c._mate && (c._mate.dead || c._mate.giveUp || c._mate.culled)) { c._mate = null; c._lead = false; }
        c._pairT = (c._pairT || 0) - dt;
        if (!c._mate && c._pairT <= 0) { c._pairT = 3; pairUp(c); }
      }
      const M = c._mate;
      const mateBusy = M && (M.curTarget || M.npcTarget || M.chaseCar || M.searchT > 0 || M.gunstop || M._radioT > 0 || M._duty || (CBZ.body && CBZ.body.busy && CBZ.body.busy(M)));
      if (M && !c._lead && !mateBusy) {
        // FOLLOWER: formation just off the lead's right shoulder
        c._pauseT = 0;                                   // the lead owns the pauses
        if (M._pauseT > 0) { standIdle(c, M.group.rotation.y, dt, near); continue; }
        const h = M.group.rotation.y;
        const gx = M.pos.x + Math.cos(h) * 1.2 - Math.sin(h) * 0.5 - c.pos.x;
        const gz = M.pos.z - Math.sin(h) * 1.2 - Math.cos(h) * 0.5 - c.pos.z;
        const gd = Math.hypot(gx, gz);
        if (gd > 0.8) stepTo(c, gx, gz, gd > 6 ? c.baseSpeed : Math.min(c.baseSpeed, Math.max(1.6, (M.speed || 0) * 1.25)), dt, near);
        else standIdle(c, h, dt, near);
        continue;
      }

      // LEAD (or solo): stroll the beat with an occasional stop-and-look pause —
      // which is where the (rare, overheard-only) small talk happens.
      if (c._pauseT > 0) { c._pauseT -= dt; standIdle(c, c.group.rotation.y, dt, near); continue; }
      if (c.ambient) {
        c._beatT = (c._beatT == null ? 8 + rng() * 14 : c._beatT - dt);
        if (c._beatT <= 0) { c._beatT = 16 + rng() * 20; c._pauseT = 2.2 + rng() * 2.4; if (M && !mateBusy) copBark(c, BEAT_LINES); continue; }
      }
      // DISTRICT-WEIGHTED BEAT (police-district-weight): an idle patrol cop picks
      // its next goal via copBeatPoint — a road point bordering a cops-WEIGHTED
      // lot, so police presence follows the district's cops value (busy cores
      // draw more beats than the quiet docks/outskirts). lotCum gives EVERY lot a
      // min weight of 1, so even a zero-cops district can still be picked (the
      // min floor — nowhere is left wholly unpatrolled). Falls back to a plain
      // road point if the arena lacks the weighted picker (stripped/headless).
      if (!c.patrolGoal || Math.hypot(c.pos.x - c.patrolGoal.x, c.pos.z - c.patrolGoal.z) < 4) {
        const weighted = (CBZ.CONFIG && CBZ.CONFIG.CITY_PATROL_DISTRICT_WEIGHT !== false) && A.copBeatPoint;
        const rp = weighted ? A.copBeatPoint() : A.randomRoadPoint();
        c.patrolGoal = { x: rp.x, z: rp.z };
      }
      stepTo(c, c.patrolGoal.x - c.pos.x, c.patrolGoal.z - c.pos.z, c.baseSpeed * 0.6, dt, near);
    }

    updateChopper(dt);
    updatePursuers(dt);
    rbUpdate(dt);
    updateGunStop(dt);
    hideOccludedGuns(dt);
    copClock += dt;
    if (barkCD > 0) barkCD -= dt;
    scanDuty(dt);
  });

  // enter SEARCH mode aimed at the last-known position (GTA "?" investigate).
  // (shared arm — systems/aitactics.js searchStart; falls back inline if the
  // module didn't load so a cop can still search, just without sharing it.)
  function goSearch(c, last) {
    if (!last || last.x == null) { c.giveUp = (g.wanted | 0) === 0 && !c.ambient; return; }
    if (AT) AT.searchStart(c, last, { dur: 6 + rng() * 4, rng });
    else { c.searchT = 6 + rng() * 4; c.searchGoal = { x: last.x, z: last.z }; c._sweepGoal = null; }
    c.npcSearch = !((g.wanted | 0) >= 1);   // searching for an NPC offender, not you
  }

  function nearestCarSuspect(pos) {
    let best = null, bd = 70 * 70;
    for (const c of carSuspects) { const dd = (c.pos.x - pos.x) * (c.pos.x - pos.x) + (c.pos.z - pos.z) * (c.pos.z - pos.z); if (dd < bd) { bd = dd; best = c; } }
    return best;
  }

  function stepTo(c, dx, dz, spd, dt, near) {
    const gd = Math.hypot(dx, dz) || 1;
    c.pos.x += (dx / gd) * spd * dt;
    c.pos.z += (dz / gd) * spd * dt;
    c.group.rotation.y = lerpAngle(c.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0008, dt));
    c.speed = spd;
    finalizeMove(c);
    if (near) animChar(c.char, c.speed, dt);
  }
  function finalizeMove(c) {
    if (CBZ.collide) CBZ.collide(c.pos, COP_R, c.pos.y, c.pos.y + 1.7);
    if (CBZ.city.arena) CBZ.city.arena.clampToCity(c.pos, COP_R);
    c.pos.y = 0;
  }

  // ---- GUN-PROP VISIBILITY (no muzzle poking through walls) ----------------
  // Runs at order 35, BEFORE actorweapons.js poseList @36 (which only re-poses
  // props that are still .visible). We HIDE a cop's gun whenever he has no live
  // line of sight to a shoot target (lost you behind cover, or just patrolling)
  // or is lowering it during a GUN STOP; we re-show it the moment he can see and
  // wants to fire. Cheap: just toggles the existing prop, no raycasts here (the
  // per-cop LOS was already computed in the behaviour pass via c.sees/_losClear).
  let gunVisT = 0;
  function hideOccludedGuns(dt) {
    gunVisT -= dt; if (gunVisT > 0) return; gunVisT = 0.12;
    const cops = CBZ.cityCops;
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (c.dead || !c.armed) continue;
      if (CBZ.body && CBZ.body.busy && CBZ.body.busy(c)) continue;   // ragdoll owns the rig
      // posted at a roadblock: standing-aim up an OPEN street (no wall to clip
      // through) — the drawn gun always shows, even before the 40u fire gate
      if (c._post) {
        c._gunHidden = false;
        if (CBZ.syncActorWeapon && (!c._weaponProp || !c._weaponProp.visible)) CBZ.syncActorWeapon(c);
        continue;
      }
      // SHOW the gun only when he's actively a threat with a clear sightline; a
      // lowered (challenge) gun or a blind/patrolling cop carries it stowed so it
      // never clips through a building.
      const wantShow = !c._gunLowered && !c.gunstop && c.sees && !!c.curTarget && c.state !== "leave";
      // flag-backed: actorweapons' poseList self-heal honors _gunHidden, so the
      // stow actually STICKS for a drawn-but-blind cop instead of popping back.
      c._gunHidden = !wantShow;
      if (wantShow) {
        if (CBZ.syncActorWeapon && (!c._weaponProp || !c._weaponProp.visible)) CBZ.syncActorWeapon(c);
      } else if (c._weaponProp && c._weaponProp.visible) {
        c._weaponProp.visible = false;
      }
    }
  }

  function fireAt(c, tgt, dist) {
    // the gun is OUT and aimed now (clear any challenge/occlusion lowering;
    // a still-holstered cop forced into a fire path ALWAYS clears leather first)
    c._gunLowered = false; c._gunHidden = false;
    drawGun(c);
    if (c.armed && CBZ.syncActorWeapon) CBZ.syncActorWeapon(c);
    if (CBZ.actorAimAt) CBZ.actorAimAt(c, tgt);
    const from = CBZ.actorMuzzle ? CBZ.actorMuzzle(c, tmp) : { x: c.pos.x, y: 1.4, z: c.pos.z };
    // FINAL line-of-fire gate from the CHEST, not the muzzle tip: a cop pressed
    // against a facade can poke the barrel INSIDE/THROUGH the 0.4 wall box, and a
    // ray born inside a FrontSide box sees no faces (the filmed shot-through-wall
    // bug). The chest centre is collider-guaranteed outside walls; the muzzle
    // stays the tracer/flash origin only.
    const ty = tgt.isPlayer ? 1.55 : 1.3;
    if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(c.pos.x, (c.pos.y || 0) + 1.4, c.pos.z, tgt.pos.x, ty, tgt.pos.z)) {
      c.sees = false; c.lostT = (c.lostT || 0) + 0.25;   // treat as a momentary loss → flank/reposition
      return;
    }
    if (CBZ.tracer) CBZ.tracer(from, { x: tgt.pos.x, y: ty, z: tgt.pos.z }, { muzzleScale: c.swat ? 1.15 : 0.95 });
    // distance to the LISTENER (the player), not to the cop's target
    if (CBZ.gunVoice) CBZ.gunVoice(c.weapon || (c.swat ? "smg" : "sidearm"), CBZ.player ? Math.hypot(c.pos.x - CBZ.player.pos.x, c.pos.z - CBZ.player.pos.z) : 0);
    else if (CBZ.sfx) CBZ.sfx("report");
    const hitP = Math.max(0.18, 0.85 - dist * 0.02 - (tgt.isPlayer && CBZ.player.sprint ? 0.18 : 0));
    if (rng() >= hitP) return;
    let dmg = (c.swat ? 10 : 7) + rng() * 5;
    if (tgt.isPlayer) {
      // a REMOTE player (multiplayer): the wound travels over the wire and is
      // applied by the victim's own client
      if (tgt.netHurt) { tgt.netHurt(dmg, c.pos.x, c.pos.z, "gunned down by police"); return; }
      // pass the cop ACTOR so death.js can spectate them; cityHurtPlayer derives
      // the "a SWAT officer" / "the police" display name from it (killfeed + title).
      if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, c.pos.x, c.pos.z, "gunned down by police", rng() < 0.012, c);
    } else {
      tgt.hp -= dmg;
      if (CBZ.bodyWound) CBZ.bodyWound(tgt, { x: tgt.pos.x, y: (tgt.pos.y || 0) + 1.0 + rng() * 0.6, z: tgt.pos.z }, { cal: c.swat ? 1.1 : 0.85, fromX: c.pos.x, fromZ: c.pos.z });
      if (tgt.hp <= 0) CBZ.cityKillPed && CBZ.cityKillPed(tgt, { fromX: c.pos.x, fromZ: c.pos.z, attacker: c, byPlayer: false, force: 5, fling: 4 }, "shot by police");
      else if (CBZ.body) CBZ.body.hit(tgt, { fromX: c.pos.x, fromZ: c.pos.z, force: 3 });
    }
  }

  // NOTE: CBZ.citySpawnCop intentionally stays the POSITIONAL (x, z, swat) spawner
  // defined above — empire.js raids + the roadblock both need a cop AT a spot.
  // (The old trailing `= spawnCop` clobbered it with a (swat, ambient) signature,
  // which silently spawned raid/roadblock cops at random road points.) Internal
  // ambient/wanted spawns call the local spawnCop() directly, so nothing relies
  // on the public name carrying the (swat, ambient) form.
})();
