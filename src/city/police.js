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
  let frame = 0, maintainT = 0;
  let _s = 314159;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  const carSuspects = [];     // fleeing cars the police are after
  const pursuers = [];        // traffic cars drafted into PIT pursuit of the player car

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
    const w = g.cityWeapon;
    return !!(w && CBZ.cityEcon && CBZ.cityEcon.ITEMS[w] && CBZ.cityEcon.ITEMS[w].gun);
  }
  // OPENLY carrying = a firearm is your equipped city weapon AND it isn't stowed.
  // COMPLY (below) stows the loadout (g.cityStowedWeapon / g._copStow) so the streets
  // calm down — peds.js and this file both read g.cityWeapon, so clearing it puts the
  // piece away city-wide; the engine viewmodel goes to fists too (empty inventory).
  function openCarry() { return playerArmed() && !g.cityStowedWeapon; }

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
    if (Math.random() < chance) {
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

  // COMPLY — actually PUT THE GUN AWAY. We stow both the city-layer weapon label
  // (g.cityWeapon, which peds/HUD/crime read) AND the engine loadout
  // (CBZ.weaponInventory / currentWeaponId, which the first-person viewmodel reads:
  // fpsmode shows fists when the inventory is empty). You still OWN the guns — they're
  // snapshotted on g._copStow and re-drawn via CBZ.cityRedrawWeapon(). Calms the cop,
  // calms the street, costs no heat.
  function stowGuns() {
    if (g.cityStowedWeapon || (g._copStow && g._copStow.inv)) return false;   // already away
    const snap = { name: g.cityWeapon || null, inv: (CBZ.weaponInventory || []).slice(), cur: CBZ.currentWeaponId || null };
    g.cityStowedWeapon = g.cityWeapon || "Gun";
    g._copStow = snap;
    g.cityWeapon = null;
    if (CBZ.weaponInventory) CBZ.weaponInventory.length = 0;
    CBZ.currentWeaponId = null;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function stopComply() {
    const c = STOP.cop;
    stowGuns();
    if (CBZ.city) CBZ.city.note("You put the piece away. “Good. Stay out of trouble.” · [Q] to re-draw", 2.6);
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
      g.cityWeapon = snap.name || g.cityStowedWeapon;
      if (CBZ.onWeaponInventoryChanged && CBZ.currentWeaponId) CBZ.onWeaponInventoryChanged(CBZ.currentWeaponId, false);
    } else {
      g.cityWeapon = g.cityStowedWeapon;
    }
    g.cityStowedWeapon = null; g._copStow = null;
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.city) CBZ.city.note("Weapon out.", 1.0);
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
    if (CBZ.sfx) CBZ.sfx("report");
    if (CBZ.shake) CBZ.shake(0.4);
    const it = g.cityWeapon && CBZ.cityEcon.ITEMS[g.cityWeapon];
    const dmg = it && it.dmg ? it.dmg * 1.5 + 30 : 80;
    STOP.cop = null; stopHide();    // the stop is over the instant you pull
    if (CBZ.cityHurtCop) CBZ.cityHurtCop(c, dmg, { fromX: fx, fromZ: fz });
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
    if ((CBZ.weaponInventory || []).length === 1 && stowGuns()) {
      e.preventDefault();
      if (CBZ.city) CBZ.city.note("Holstered. · [Q] to draw", 1.6);
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
    // you (buy/loot a gun → combat.js cityGiveWeapon sets g.cityWeapon AND
    // unlockWeapon refills weaponInventory), drop the stale stow snapshot so it reads
    // as open carry again — otherwise a fresh draw would never get stopped.
    if ((g.cityStowedWeapon || g._copStow) && (g.cityWeapon || (CBZ.weaponInventory && CBZ.weaponInventory.length))) { g.cityStowedWeapon = null; g._copStow = null; }
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
    // nearest free ambient beat cop who can SEE the gun and isn't busy/hunting
    let best = null, bd = 13;
    for (const c of CBZ.cityCops) {
      if (c.dead || c.gunstop || c.swat || c.giveUp || c.npcTarget) continue;
      if (c.curTarget && c.curTarget !== CBZ.city.playerActor) continue;
      if (CBZ.body && CBZ.body.busy && CBZ.body.busy(c)) continue;
      const d = Math.hypot(c.pos.x - P.pos.x, c.pos.z - P.pos.z);
      if (d > bd) continue;
      if (!losClear(c.pos.x, c.pos.z, P.pos.x, P.pos.z)) continue;   // can't see the gun through a wall
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

  // a roadblock cruiser + PIT chaser are real cars borrowed from vehicles.js; we
  // only flag them here. The chopper is a cheap mesh w/ a sweeping spotlight.
  let chopper = null, roadblockCD = 0, pitCD = 0;
  const roadblocks = [];   // parked cruisers forming a wall; released when heat drops

  function makeCop(x, z, swat, ambient) {
    const ch = makeCharacter({
      legs: swat ? 0x23262c : 0x1b2a44, torso: swat ? 0x2b2f36 : 0x24407a,
      collar: swat ? 0x14161a : 0x16264a, arms: swat ? 0x2b2f36 : 0x24407a,
      skin: 0xe8b58c, hair: 0x101820, shoes: 0x101216,
    });
    ch.group.position.set(x, 0, z);
    const tag = CBZ.makeLabelSprite ? CBZ.makeLabelSprite(swat ? "SWAT" : "POLICE", { color: "#7fd0ff" }) : null;
    if (tag) { tag.position.y = 3.0; tag.scale.set(2.6, 0.7, 1); ch.group.add(tag); }
    const cop = {
      char: ch, group: ch.group, pos: ch.group.position, name: swat ? "SWAT" : "Officer",
      kind: "cop", swat: !!swat, ambient: !!ambient, hp: swat ? 160 : 110, dead: false, deadT: 0,
      baseSpeed: swat ? 5.2 : 4.6, speed: 0, state: "patrol", sees: false,
      shootCD: 0.6 + rng() * 0.6, arrestT: 0, slice: (rng() * 6) | 0, tag, isPlayer: false,
      npcTarget: null, patrolGoal: null, retarget: 0, armed: true, weapon: swat ? "SMG" : "Pistol",
    };
    if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(cop);
    return cop;
  }

  function spawnCop(swat, ambient) {
    const A = CBZ.city.arena; if (!A) return;
    const P = CBZ.player;
    let x, z, tries = 0;
    do { const p = A.randomRoadPoint(); x = p.x; z = p.z; tries++; } while (tries < 8 && !ambient && Math.hypot(x - P.pos.x, z - P.pos.z) < 24);
    const c = makeCop(x, z, swat, ambient);
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
    for (const c of roadblocks) if (c && !c.dead) { c._roadblock = 0; c.ai = true; c.abandoned = false; }
    roadblocks.length = 0;
    if (typeof despawnChopper === "function") despawnChopper();
    roadblockCD = 0; pitCD = 0;
  };

  function liveCops() { let n = 0; for (const c of CBZ.cityCops) if (!c.dead) n++; return n; }
  function liveAmbient() { let n = 0; for (const c of CBZ.cityCops) if (!c.dead && c.ambient) n++; return n; }
  function liveSwat() { let n = 0; for (const c of CBZ.cityCops) if (!c.dead && c.swat) n++; return n; }

  // ---- POLICE HELICOPTER (3+ stars): a maverick that orbits your last-known and
  //      paints you with a searchlight, keeping cops fed your position. ----------
  function makeChopper() {
    const A = CBZ.city.arena; if (!A) return null;
    const grp = new THREE.Group();
    const matBody = CBZ.mat ? CBZ.mat(0x1a1d24, { ei: 0.02 }) : new THREE.MeshStandardMaterial({ color: 0x1a1d24 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 4.4), matBody);
    body.castShadow = false; grp.add(body);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 3.0), matBody);
    tail.position.set(0, 0.2, -3.4); grp.add(tail);
    const skidMat = CBZ.mat ? CBZ.mat(0x2a2e36) : matBody;
    const skidL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 3.4), skidMat); skidL.position.set(-0.8, -0.7, 0); grp.add(skidL);
    const skidR = skidL.clone(); skidR.position.x = 0.8; grp.add(skidR);
    // main rotor — a thin spinning blade plane (cheap)
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.05, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x101216, transparent: true, opacity: 0.55, depthWrite: false }));
    rotor.position.y = 0.85; grp.add(rotor);
    // belly searchlight: a visible cone + a ground pool (like searchlight.js)
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 5.5, 1, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    grp.add(cone);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(5, 22),
      new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.24, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.y = 0.07;
    A.root.add(pool);
    A.root.add(grp);
    const tag = CBZ.makeLabelSprite ? CBZ.makeLabelSprite("AIR-1", { color: "#7fd0ff" }) : null;
    if (tag) { tag.position.y = 2.2; tag.scale.set(3, 0.8, 1); grp.add(tag); }
    const sp = A.randomRoadPoint();
    grp.position.set(sp.x, 34, sp.z);
    return {
      group: grp, body, rotor, cone, pool, tag,
      pos: grp.position, target: new THREE.Vector3(sp.x, 0, sp.z),
      heading: 0, orbit: rng() * 6.28, shootCD: 1.2, leaveT: 0, spotR: 5,
    };
  }
  // is the player currently painted by the chopper spotlight? cops + wanted.js
  // can treat that as a live sighting.
  CBZ.cityChopperPaints = function () {
    if (!chopper) return false;
    const P = CBZ.player; if (!P || P.dead) return false;
    const dx = P.pos.x - chopper.pool.position.x, dz = P.pos.z - chopper.pool.position.z;
    const r = chopper.spotR * (P.crouch ? 0.7 : 1);
    return dx * dx + dz * dz < r * r;
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
    const ty = 30 - stars;
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
    // visible light cone hangs from the belly down to the ground (cheap: a local
    // downward cylinder; the wide bottom radius reads as a spreading beam).
    const len = Math.max(2, chopper.pos.y - 0.07);
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
    const from = { x: chopper.pos.x, y: chopper.pos.y - 0.5, z: chopper.pos.z };
    if (CBZ.tracer) CBZ.tracer(from, { x: P.pos.x + (rng() - 0.5) * 2, y: 1.5, z: P.pos.z + (rng() - 0.5) * 2 }, { muzzleScale: 1.2 });
    if (CBZ.sfx) CBZ.sfx("report");
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

  function offenderCount() { let n = 0; for (const p of CBZ.cityPeds) if (!p.dead && (p.npcWanted | 0) >= 1) n++; return n; }

  // damage a cop; killing one spikes player heat + drops the cop's gun
  CBZ.cityHurtCop = function (cop, dmg, imp) {
    if (!cop || cop.dead) return;
    cop.hp -= dmg;
    if (cop.hp <= 0) {
      cop.dead = true; cop.deadT = 0;
      if (CBZ.cityDropWeapon) CBZ.cityDropWeapon(cop.pos.x, cop.pos.z, cop.swat ? "SMG" : "Pistol", 30);   // disarmed
      cop.armed = false; cop.weapon = null;
      if (CBZ.syncActorWeapon) CBZ.syncActorWeapon(cop);
      if (CBZ.gore) { let dir = imp && imp.fromX != null ? { x: cop.pos.x - imp.fromX, z: cop.pos.z - imp.fromZ } : null; CBZ.gore(cop.pos.x, cop.pos.y + 1.0, cop.pos.z, { dir, amount: 1.1, player: false }); }
      if (CBZ.body) { if (imp && imp.fromX != null) CBZ.body.hit(cop, { fromX: imp.fromX, fromZ: imp.fromZ, force: 8, fling: 5 }); else CBZ.body.hit(cop, { dir: { x: rng() - 0.5, z: rng() - 0.5 }, force: 4, fling: 5 }); }
      // who killed the officer? player → automatic 5 stars; another NPC → that
      // NPC's offense; a cop / driverless car → nobody is charged.
      const att = imp && imp.attacker && imp.attacker.pos ? imp.attacker : null;
      const byPlayer = imp ? imp.byPlayer !== false : true;
      if (att && att !== CBZ.city.playerActor) { if (att.kind !== "cop" && CBZ.cityNpcOffense) CBZ.cityNpcOffense(att, 140, "cop-killer"); }
      else if (byPlayer) {
        CBZ.city && CBZ.city.addKill();
        CBZ.city && CBZ.city.addRespect(8);
        if (CBZ.cityCopKilled) CBZ.cityCopKilled();          // → 5 stars, instantly
        else if (CBZ.cityCrime) CBZ.cityCrime(120, { instant: true, x: cop.pos.x, z: cop.pos.z, type: "cop-kill" });
      }
      if (CBZ.pushKill) CBZ.pushKill("An officer was killed", "#ff6b6b");
    } else if (CBZ.body && imp && imp.fromX != null) CBZ.body.hit(cop, { fromX: imp.fromX, fromZ: imp.fromZ, force: 3 });
  };

  // GTA wanted-tier ramp: how many of the responders to you should be SWAT/NOOSE.
  // 0-1★ none, 2★ a token, 3★ a couple, 4★ half, 5★ mostly heavy units.
  const SWAT_FRAC = [0, 0, 0.12, 0.3, 0.55, 0.75];

  // ---- maintain the right number of cops --------------------------------
  function maintain(dt) {
    maintainT -= dt;
    if (maintainT > 0) return;
    maintainT = 1.1;
    const stars = g.wanted | 0;
    const ambientWant = CBZ.CITY.ambientCops || 0;
    const playerWant = g.cityCopTarget || 0;
    const offenders = offenderCount() + carSuspects.length;
    const total = ambientWant + playerWant + Math.min(6, offenders);
    const have = liveCops();
    if (have < total) {
      // escalation ramp: at higher stars, fill the new slot with a SWAT unit so
      // the force gets tougher AND bigger as your stars climb.
      const wantSwat = liveSwat();
      const swatTarget = Math.round(playerWant * (SWAT_FRAC[Math.min(5, stars)] || 0));
      const fillAmbient = liveAmbient() < ambientWant;          // patrol slot open?
      // patrol fills are always regular beat cops; only player-response slots are SWAT
      const newIsSwat = !fillAmbient && stars >= 2 && wantSwat < swatTarget;
      spawnCop(newIsSwat, fillAmbient);
      if (have + 1 < total) spawnCop(stars >= 2 && (wantSwat + (newIsSwat ? 1 : 0)) < swatTarget, false);
    } else if (have > total) {
      // retire surplus non-ambient cops when the heat is gone (never a cop who's
      // mid gun-stop — let the stand-off resolve first)
      for (const c of CBZ.cityCops) if (!c.dead && !c.ambient && !c.npcTarget && !c.gunstop && stars === 0) { c.giveUp = true; break; }
    }

    // ---- vehicle responses to a DRIVING suspect (3★ PIT, 4★ roadblock) -------
    const P = CBZ.player;
    if (roadblockCD > 0) roadblockCD -= 1.1;
    if (pitCD > 0) pitCD -= 1.1;
    if (P && P.driving && P._vehicle && stars >= 3 && g.state === "playing") {
      if (pitCD <= 0) { pitCD = 4 + rng() * 3; tryPIT(P._vehicle, stars); }
      if (stars >= 4 && roadblockCD <= 0) { roadblockCD = 12 + rng() * 6; tryRoadblock(P._vehicle, stars); }
    }
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
    if (CBZ.city && CBZ.city.note && rng() < 0.5) CBZ.city.note("🚓 Pursuit unit moving to intercept!", 1.0);
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
      if (CBZ.collide) CBZ.collide(c.pos, 1.0);
      if (CBZ.city.arena) CBZ.city.arena.clampToCity(c.pos, 1.0);
      c.group.position.set(c.pos.x, 0, c.pos.z);
      c.group.rotation.y = c.heading;
    }
  }

  // ROADBLOCK: park a couple of cruisers across the road ahead of the suspect's
  // travel so they have to brake/swerve. Cheap: reuse parked traffic cars.
  function tryRoadblock(targetCar, stars) {
    if (!CBZ.cityNearestCar || !targetCar) return;
    const A = CBZ.city.arena; if (!A) return;
    // project ahead along the car's velocity to a point down the road
    const vx = targetCar.v != null ? Math.sin(targetCar.heading || 0) : 0;
    const vz = targetCar.v != null ? Math.cos(targetCar.heading || 0) : 1;
    const ahead = 38;
    const it = A.nearestIntersection(targetCar.pos.x + vx * ahead, targetCar.pos.z + vz * ahead);
    if (!it) return;
    const n = stars >= 5 ? 3 : 2;
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const car = CBZ.cityNearestCar(it.x, it.z, 70);
      if (!car || car.player || car.dead || car._roadblock || car._pursuit) continue;
      // perpendicular spread across the lane to form a wall
      const off = (i - (n - 1) / 2) * 3.2;
      const px = it.x + (-vz) * off, pz = it.z + (vx) * off;
      car.pos.x = px; car.pos.z = pz; car.v = 0; car.baseV = 0;
      car.heading = Math.atan2(-vz, vx); // park sideways across the road
      car.group.position.set(px, 0, pz);
      car.group.rotation.y = car.heading;
      car._roadblock = CBZ.now; car.npcDriver = null; car.ai = false; car.abandoned = true; car.v = 0;
      roadblocks.push(car);
      // a cop crouches at each car for cover-fire
      CBZ.citySpawnCop && CBZ.citySpawnCop(px + (rng() - 0.5) * 2, pz + (rng() - 0.5) * 2, stars >= 4 && rng() < 0.5);
      placed++;
    }
    if (placed && CBZ.city && CBZ.city.note) CBZ.city.note("🚧 ROADBLOCK ahead!", 1.4);
  }
  // when the heat clears, hand roadblock cars back to ambient traffic
  function releaseRoadblocks() {
    for (let i = roadblocks.length - 1; i >= 0; i--) {
      const c = roadblocks[i];
      if (!c || c.dead) { roadblocks.splice(i, 1); continue; }
      c._roadblock = 0; c.ai = true; c.abandoned = false; c.baseV = Math.max(4, (TR_cruise() * 0.7));
      roadblocks.splice(i, 1);
    }
  }
  function TR_cruise() { try { const t = CBZ.CITY.traf; return (t && t.cruise && t.cruise[1]) || 10; } catch (e) { return 10; } }

  // pick the best target for a cop: the player (if wanted) or an NPC offender
  function chooseTarget(cop) {
    let best = null, bestScore = -1, bestPed = null;
    const cp = cop.pos;
    if ((g.wanted | 0) >= 1 && !CBZ.player.dead) {
      const d = Math.hypot(cp.x - CBZ.player.pos.x, cp.z - CBZ.player.pos.z);
      const sc = (g.wanted | 0) * 30 - d * 0.5;
      if (sc > bestScore) { bestScore = sc; best = CBZ.city.playerActor; bestPed = null; }
    }
    for (const p of CBZ.cityPeds) {
      if (p.dead || (p.npcWanted | 0) < 1) continue;
      const d = Math.hypot(cp.x - p.pos.x, cp.z - p.pos.z);
      if (d > 60) continue;
      const sc = (p.npcWanted | 0) * 24 + (p.armed ? 12 : 0) - d * 0.6;
      if (sc > bestScore) { bestScore = sc; best = p; bestPed = p; }
    }
    cop.npcTarget = bestPed;
    return best;
  }

  // ---- per-frame update --------------------------------------------------
  CBZ.onUpdate(35, function (dt) {
    if (g.mode !== "city") return;
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
        if (frame % 240 === 0 && rng() < 0.5) { if (c.group.parent) c.group.parent.remove(c.group); cops.splice(i, 1); continue; }
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

        // real LINE OF SIGHT: within range AND not blocked by a building. The
        // chopper painting you also counts as a sighting that feeds every cop.
        // (losClear is throttled per-cop so the raycast cost stays cheap.)
        if (c._losCD == null) c._losCD = rng() * 0.25;
        c._losCD -= dt;
        if (c._losCD <= 0) { c._losCD = 0.22 + rng() * 0.12; c._losClear = dist < 48 && losClear(c.pos.x, c.pos.z, tx, tz); }
        const painted = isPlayer && CBZ.cityChopperPaints && CBZ.cityChopperPaints();
        c.sees = dist < 48 && (c._losClear || painted || dist < 4);
        if (c.sees) {
          c.lostT = 0;
          c.lkx = tx; c.lkz = tz;                    // remember where we last saw them
          if (isPlayer) g.cityLastKnown = { x: tx, z: tz, t: CBZ.now };
        } else {
          // lost sight — count down toward a SEARCH at the last-known spot
          c.lostT = (c.lostT || 0) + dt;
          if (c.lostT > (stars >= 4 ? 6 : 4)) { c.curTarget = null; c.retarget = 0.4; goSearch(c, isPlayer ? (g.cityLastKnown || { x: c.lkx, z: c.lkz }) : { x: c.lkx, z: c.lkz }); continue; }
        }

        const npcThreat = !isPlayer && (tgt.armed || tgt.aggr >= 0.85 || (tgt.npcWanted | 0) >= 2);
        const wantArrest = isPlayer ? (stars <= 2 && !P.driving) : !npcThreat;
        const wantShoot = isPlayer ? stars >= 2 : npcThreat;

        // assign each cop a FLANK lane so they don't bunch up — left/right/center
        // by index so a squad surrounds you instead of conga-lining single file.
        if (c._flank == null) c._flank = ((i % 3) - 1);   // -1 left, 0 center, +1 right

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
            if (isPlayer && stars >= 2 && playerArmed() && rng() < (c.swat ? 0.12 : 0.28)) { c._coverT = 1.0 + rng(); c._coverDir = rng() < 0.5 ? -1 : 1; }
          }
        }

        // taking cover: sidestep perpendicular to the target, then peek back out
        if (c._coverT > 0) {
          c._coverT -= dt;
          const px = -dz / (dist || 1), pz = dx / (dist || 1);   // perpendicular
          stepTo(c, px * c._coverDir * 4 + dx * 0.15, pz * c._coverDir * 4 + dz * 0.15, c.baseSpeed * 1.1, dt, near);
          continue;
        }

        // ---- NO LINE OF FIRE → FLANK to a real angle instead of pressing into the
        //      wall. A wanted shooter who can't see the target picks a side and
        //      slides perpendicular to peek around cover (alternating sides if one
        //      side stays blocked), so cops round corners instead of wallhacking.
        if (wantShoot && !c.sees && dist < 42) {
          c._flankT = (c._flankT || 0) - dt;
          if (c._flankT <= 0 || c._flankSide == null) { c._flankT = 1.2 + rng() * 0.8; c._flankSide = (c._flankSide === 1) ? -1 : 1; }
          const px = -dz / (dist || 1), pz = dx / (dist || 1);
          // move mostly sideways (to clear the corner) with a little closing bias
          const fx = px * c._flankSide * 5 + dx * 0.35, fz = pz * c._flankSide * 5 + dz * 0.35;
          stepTo(c, fx, fz, c.baseSpeed * 1.05, dt, near);
          continue;
        }

        // approach with a FLANK offset so the squad encircles, and hold a
        // firing-line distance once we're a threat-range shooter.
        const flankAmt = c._flank * (isPlayer && stars >= 3 ? 7 : 4);
        const px = -dz / (dist || 1), pz = dx / (dist || 1);
        const gx = dx + px * flankAmt, gz = dz + pz * flankAmt;
        const stop = (wantShoot && dist < (isPlayer ? (stars >= 3 ? 9 : 4) : 8)) ? (isPlayer && stars >= 3 ? 8 : 5) : 1.5;
        const spd = c.baseSpeed * (c.sees ? 1 : 1.12);     // sprint a touch when chasing blind
        if (dist > stop) stepTo(c, gx, gz, spd, dt, near);
        else { c.speed = 0; c.group.rotation.y = lerpAngle(c.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.002, dt)); if (near) animChar(c.char, 0, dt); finalizeMove(c); }
        continue;
      }

      // ---- SEARCH: go to last-known, then sweep nearby before giving up ----
      if (c.searchT > 0 && (stars >= 1 || c.npcSearch)) {
        c.searchT -= dt;
        // RE-ACQUIRE: if we catch sight of the wanted player again mid-sweep, drop
        // the search and resume the hunt (GTA: spotted you again → back to chase).
        if (stars >= 1 && !CBZ.player.dead) {
          const pdx = CBZ.player.pos.x - c.pos.x, pdz = CBZ.player.pos.z - c.pos.z, pd = Math.hypot(pdx, pdz);
          const painted = CBZ.cityChopperPaints && CBZ.cityChopperPaints();
          if (pd < 30 && (painted || losClear(c.pos.x, c.pos.z, CBZ.player.pos.x, CBZ.player.pos.z))) {
            c.searchT = 0; c.searchGoal = null; c._sweepGoal = null; c.curTarget = CBZ.city.playerActor; c.retarget = 0.5; c.sees = true; c.lostT = 0;
            if (CBZ.city && CBZ.city.note && rng() < 0.4) CBZ.city.note("🚨 \"I've got eyes on the suspect!\"", 0.9);
            continue;
          }
        }
        c.sees = false;
        const sg = c.searchGoal || g.cityLastKnown;
        if (sg) {
          const sdx = sg.x - c.pos.x, sdz = sg.z - c.pos.z, sd = Math.hypot(sdx, sdz);
          if (sd < 3) {
            // reached it — pick a new nearby sweep point (wander, hoping to re-spot)
            if (!c._sweepGoal || Math.hypot(c.pos.x - c._sweepGoal.x, c.pos.z - c._sweepGoal.z) < 2.5) {
              const ang = rng() * 6.28, rad = 6 + rng() * 10;
              c._sweepGoal = { x: sg.x + Math.cos(ang) * rad, z: sg.z + Math.sin(ang) * rad };
            }
            stepTo(c, c._sweepGoal.x - c.pos.x, c._sweepGoal.z - c.pos.z, c.baseSpeed * 0.7, dt, near);
          } else stepTo(c, sdx, sdz, c.baseSpeed, dt, near);
        }
        if (c.searchT <= 0) { c.searchGoal = null; c._sweepGoal = null; c.npcSearch = false; if (stars === 0 && !c.ambient) c.giveUp = true; }
        continue;
      }

      // ---- patrol (ambient, no target) ----
      c.sees = false; c.npcTarget = null;
      if (!c.patrolGoal || Math.hypot(c.pos.x - c.patrolGoal.x, c.pos.z - c.patrolGoal.z) < 4) { const rp = A.randomRoadPoint(); c.patrolGoal = { x: rp.x, z: rp.z }; }
      stepTo(c, c.patrolGoal.x - c.pos.x, c.patrolGoal.z - c.pos.z, c.baseSpeed * 0.6, dt, near);
    }

    updateChopper(dt);
    updatePursuers(dt);
    updateGunStop(dt);
    hideOccludedGuns(dt);
    if (stars === 0 && roadblocks.length) releaseRoadblocks();
  });

  // enter SEARCH mode aimed at the last-known position (GTA "?" investigate).
  function goSearch(c, last) {
    if (!last || last.x == null) { c.giveUp = (g.wanted | 0) === 0 && !c.ambient; return; }
    c.searchT = 6 + rng() * 4;
    c.searchGoal = { x: last.x, z: last.z };
    c._sweepGoal = null;
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
      // SHOW the gun only when he's actively a threat with a clear sightline; a
      // lowered (challenge) gun or a blind/patrolling cop carries it stowed so it
      // never clips through a building.
      const wantShow = !c._gunLowered && !c.gunstop && c.sees && !!c.curTarget && c.state !== "leave";
      if (wantShow) {
        if (CBZ.syncActorWeapon && (!c._weaponProp || !c._weaponProp.visible)) CBZ.syncActorWeapon(c);
      } else if (c._weaponProp && c._weaponProp.visible) {
        c._weaponProp.visible = false;
      }
    }
  }

  function fireAt(c, tgt, dist) {
    // the gun is OUT and aimed now (clear any challenge/occlusion lowering)
    c._gunLowered = false;
    if (c.armed && CBZ.syncActorWeapon) CBZ.syncActorWeapon(c);
    if (CBZ.actorAimAt) CBZ.actorAimAt(c, tgt);
    const from = CBZ.actorMuzzle ? CBZ.actorMuzzle(c, tmp) : { x: c.pos.x, y: 1.4, z: c.pos.z };
    // FINAL line-of-fire gate from the real muzzle: never put a round through a
    // wall even if the torso-height sightline cleared (barrel past a corner, etc.).
    const ty = tgt.isPlayer ? 1.55 : 1.3;
    if (CBZ.clearLineOfFire && !CBZ.clearLineOfFire(from.x, from.y != null ? from.y : 1.4, from.z, tgt.pos.x, ty, tgt.pos.z)) {
      c.sees = false; c.lostT = (c.lostT || 0) + 0.25;   // treat as a momentary loss → flank/reposition
      return;
    }
    if (CBZ.tracer) CBZ.tracer(from, { x: tgt.pos.x, y: ty, z: tgt.pos.z }, { muzzleScale: c.swat ? 1.15 : 0.95 });
    if (CBZ.sfx) CBZ.sfx("report");
    const hitP = Math.max(0.18, 0.85 - dist * 0.02 - (tgt.isPlayer && CBZ.player.sprint ? 0.18 : 0));
    if (Math.random() >= hitP) return;
    let dmg = (c.swat ? 10 : 7) + Math.random() * 5;
    if (tgt.isPlayer) {
      if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(dmg, c.pos.x, c.pos.z, "gunned down by police", Math.random() < 0.012, c.swat ? "a SWAT officer" : "the police");
    } else {
      tgt.hp -= dmg;
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
