/* ============================================================
   city/death.js — cinematic WASTED deaths + hospital respawn, and the
   BUSTED → jail fade.

   The city is third-person already, so a death plays out in full view:
   a spinning ragdoll fling (physics.js integrates player._death in any
   non-escape mode), a hard shake, slow-mo, a blood burst, and a big
   WASTED title. A few seconds later you respawn at the nearest hospital
   (lighter wallet, lower heat) — the run continues, GTA-style.

   The fling MATCHES the killing force (why: the body's flight should sell
   what hit it): cityHurtPlayer forwards the final damage of the killing
   blow, so a close shotgun blast hurls + spins you away from the shooter
   while bleeding out is a weak slump; headshots/run-overs carry their
   flags into CBZ.gore for the head-pop / road-smear treatments.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const g = CBZ.game;

  let overlay = null, titleEl = null, subEl = null;
  let respawnT = 0, dying = false, wastedT = 0, pendingWasted = null;
  let finalDeath = false, finalDeathLine = "";   // permadeath: this death ends the run
  // the orbit cam is HELD a beat while the first-person gun-drop tumble plays
  // (fpsmode.js) so the weapon visibly falls from YOUR eye before the WASTED
  // replay pulls out to third person.
  let pendingDeathCam = null, deathCamHoldT = 0;
  // ---- SPECTATE (Fortnite-style kill-cam): WASTED plays unchanged, THEN — if a
  //      real on-map actor killed you — the camera leaves your corpse and follows
  //      your KILLER, showing their live state, until you respawn. ----
  let spectating = false, specKiller = null, pendingSpecKiller = null;
  let specT = 0, specMax = 10, specKillerMax = 100;
  let specHUD = null, specName = null, specHpFill = null, specHpTxt = null, specStateEl = null, specFoot = null, specStats = null;

  // a killer can arrive as an ACTOR (NPC/cop — has .pos, spectatable) or a plain
  // NAME string (chopper, gang, "the police"). This always yields the display
  // string that the WASTED title + killfeed.js read.
  function killerName(a) {
    if (!a) return null;
    if (typeof a === "string") return a;
    if (a.swat) return "a SWAT officer";
    if (a.kind === "cop") return "the police";
    if (a.name) return a.name + (a.gang ? " of the " + a.gang : "");
    return "a stranger";
  }

  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "cityWasted";
    overlay.style.cssText = "position:fixed;inset:0;z-index:55;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;pointer-events:none;font-family:Fredoka,system-ui,sans-serif;text-align:center;background:radial-gradient(ellipse at 50% 50%,rgba(40,0,0,0) 30%,rgba(20,0,0,.75) 100%)";
    titleEl = document.createElement("div");
    titleEl.style.cssText = "font-size:clamp(54px,12vw,140px);font-weight:700;letter-spacing:4px;color:#c9202a;text-shadow:0 6px 0 #5e070b,0 10px 26px rgba(0,0,0,.6);opacity:0;transition:opacity 1s ease,transform 1s ease;transform:scale(1.25)";
    subEl = document.createElement("div");
    subEl.style.cssText = "font-size:clamp(22px,3.4vw,34px);font-weight:600;letter-spacing:1px;text-shadow:0 3px 0 rgba(0,0,0,.45),0 4px 14px rgba(0,0,0,.55);opacity:0;transition:opacity 1.1s ease .4s";
    overlay.appendChild(titleEl); overlay.appendChild(subEl);
    document.body.appendChild(overlay);
  }
  function showOverlay(big, sub, color) {
    buildOverlay();
    titleEl.textContent = big; titleEl.style.color = color || "#c9202a";
    subEl.textContent = sub || ""; subEl.style.color = color || "#c9202a";
    overlay.style.display = "flex";
    void overlay.offsetWidth;
    titleEl.style.opacity = "1"; titleEl.style.transform = "scale(1)";
    subEl.style.opacity = "1";
  }
  function hideOverlay() {
    if (!overlay) return;
    overlay.style.display = "none";
    titleEl.style.opacity = "0"; titleEl.style.transform = "scale(1.25)"; subEl.style.opacity = "0";
  }

  CBZ.cityDeathReset = function () { dying = false; respawnT = 0; wastedT = 0; pendingWasted = null; pendingDeathCam = null; deathCamHoldT = 0; spectating = false; specKiller = null; pendingSpecKiller = null; g._citySpecTarget = null; finalDeath = false; finalDeathLine = ""; g._cityGameOver = false; if (goCard) goCard.style.display = "none"; if (specHUD) specHUD.style.display = "none"; hideOverlay(); if (CBZ.cityCam) CBZ.cityCam.death = null; if (CBZ.fpsDeathDropReset) CBZ.fpsDeathDropReset(); if (CBZ.eyes && CBZ.eyes.reset) CBZ.eyes.reset(); };

  // A hit is a FLINCH (systems/eyes.js CBZ.hitFlash), never a red screen.

  // ---- central player damage: armoured, survivable, with out-of-combat
  //      regen so a gunfight is a back-and-forth, not an instant death.
  //      The CITY player is tougher than an NPC: incoming damage is scaled
  //      down, and a headshot is brutal but SURVIVABLE from full health
  //      (it one-shots NPCs, not you), so a firefight is winnable. ----
  const CITY_DR = 0.6;           // fraction of incoming damage the player actually takes
  const HEADSHOT_FRAC = 0.6;     // a headshot deals up to 60% of max HP (not an instakill)

  // corpse-hit scratch (zero per-call allocation) for the wake-on-hit route below
  const _crpP = { x: 0, y: 0, z: 0 }, _crpD = { x: 0, y: 0, z: 0 };
  CBZ.cityHurtPlayer = function (dmg, fromX, fromZ, reason, headshot, attacker, nonlethal, hit) {
    const P = CBZ.player;
    // YOU DON'T LOSE PHYSICS WHEN YOU DIE: while dead (the WASTED / spectate
    // window) a round from an NPC no longer just vanishes — your corpse stays a
    // reactive ragdoll. Route the hit to the wake-on-hit hook so the body JERKS,
    // takes the impulse and accumulates a wound where it lands, then re-sleeps.
    // (No HP/regen/wound-model side effects — you're already down.)
    if (P.dead) {
      if (CBZ.cityCorpseHit && g.mode === "city" && CBZ.city && CBZ.city.playerActor) {
        let dx = 0, dz = 0;
        if (fromX != null && P.pos) { dx = P.pos.x - fromX; dz = P.pos.z - fromZ; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
        _crpP.x = P.pos ? P.pos.x : 0; _crpP.y = (P.pos ? P.pos.y : 0) + (headshot ? 1.95 : 1.1); _crpP.z = P.pos ? P.pos.z : 0;
        _crpD.x = dx; _crpD.y = 0; _crpD.z = dz;
        // scale the jolt to the round: a pistol nudges, a shotgun/blast tosses it.
        const f = nonlethal ? 3 : Math.min(20, 4 + (dmg || 6) * 0.16);
        try { CBZ.cityCorpseHit(CBZ.city.playerActor, _crpP, _crpD, f); } catch (e) {}
      }
      return;
    }
    if ((g.invuln || 0) > 0) return;
    if (attacker) {
      // an ACTOR (has .pos) can be SPECTATED after WASTED; a bare string just names
      // the killer. g._cityKiller STAYS a display string either way (killfeed.js +
      // the WASTED title read it as text); the actor rides on g._cityKillerActor.
      if (typeof attacker === "object" && attacker.pos) { g._cityKillerActor = attacker; g._cityKiller = killerName(attacker); }
      else { g._cityKiller = attacker; g._cityKillerActor = null; }
      g._cityKillerT = CBZ.now || 0;
    }
    if (headshot) dmg = Math.max(dmg, (P.maxHp || 200) * HEADSHOT_FRAC);
    dmg *= CITY_DR;
    // Bumps and medium-speed traffic impacts can hurt badly, but should not
    // turn a scrape into a WASTED screen. Truly catastrophic hits opt out.
    if (nonlethal) dmg = Math.min(dmg, Math.max(0, P.hp - 1));
    // VISIBLE ARMOR (armor.js): the vest/plate/helmet you looted or bought eats
    // part of the hit before flesh. Read the kit's published fractions (lower
    // headFrac with a helmet); fall back to the legacy bare-scalar values when
    // armor.js is absent. When the pool drains the prop is spent → it visibly
    // comes off (cityArmorBroke flashes "ARMOR GONE").
    const aF = headshot ? (P._armorHeadFrac != null ? P._armorHeadFrac : 0.45)
                        : (P._armorAbsorb != null ? P._armorAbsorb : 0.7);
    if (P._armor > 0) {
      const a = Math.min(P._armor, dmg * aF);
      P._armor -= a; dmg -= a;
      if (P._armor <= 0 && CBZ.cityArmorBroke) CBZ.cityArmorBroke();
    }
    P.hp -= dmg;
    P._hurtT = 3.5;                     // pause regen briefly, then it ramps back
    if (CBZ.hitFlash) CBZ.hitFlash(Math.min(1, dmg / 60));
    if (CBZ.shake) CBZ.shake(Math.min(0.4, 0.12 + dmg * 0.01));
    // THE BODY (systems/vitals.js): a fist dazes and can knock you out, a
    // round or a blade opens a bleed where it went in. A hit that runs the
    // number out puts you on the floor bleeding instead of killing you, unless
    // you were already down there. bodyHit true = vitals owns the outcome.
    if (dmg > 0 && CBZ.vitals && bodyHit(hitKind(hit, reason, fromX, fromZ, attacker), dmg, hit, headshot, fromX, fromZ, attacker)) {
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      return;
    }
    // the FINAL damage of the killing blow rides the impact: cityKillPlayer
    // scales the ragdoll fling from it (a close shotgun blast hurls you, a
    // pistol tap just drops you) and the headshot flag drives the head-pop gore.
    if (P.hp <= 0) {
      // ENVIRONMENTAL killing blow (explosion / car-crash / fall) that carries NO
      // actor: it must not INHERIT a stale shooter. g._cityKillerActor/_cityKiller
      // linger ~6s from your last hit, so a SWAT who shot you seconds before a blast
      // (the blast passes attacker=null, reason "caught in an explosion") was being
      // credited the kill — the kill-cam read "a SWAT officer" for an explosion death.
      // Clear the stale killer here so the WASTED title + spectate read the real cause.
      const hadActorBlow = attacker && typeof attacker === "object" && attacker.pos;
      if (!hadActorBlow && (isExplosionCause(reason) || isImpactCause(reason))) { g._cityKiller = null; g._cityKillerActor = null; }
      CBZ.cityKillPlayer(reason || "killed", { fromX, fromZ, dmg, headshot });
    }
  };

  // ============================================================
  //  THE PLAYER'S BODY — systems/vitals.js, the same one every man in the
  //  street has. The old private model here (a random-roll leg/arm wound, a
  //  "bleed" that was just hp ticking down, a limp scale written for physics)
  //  is gone: the round goes in WHERE it went in, bleeds at the rate that
  //  place bleeds, and you wrap it with a real roll of gauze or a medkit, or
  //  you bleed out. Speed (a shot leg, blood loss, groggy) and the grey
  //  closing sight are vitals' own; nothing here writes them.
  // ============================================================
  // what hit you: the caller says (peds.js, net), else the words and the reach
  function hitKind(hit, reason, fromX, fromZ, attacker) {
    if (hit && hit.kind) {
      const k = hit.kind;
      return k === "fist" || k === "blunt" || k === "kick" ? "fist" : k === "blade" || k === "stab" || k === "slash" ? "blade" : k === "bite" ? "bite" : k === "bullet" ? "bullet" : "other";
    }
    if (isExplosionCause(reason) || isImpactCause(reason)) return "other";
    const r = ("" + (reason || "")).toLowerCase();
    if (/car|traffic|crash|run over|drown|starv|burn|fire|electr|shock|lava|tsunami|quake|tornado|debris|crush/.test(r)) return "other";
    if (/stab|knife|blade|slash|shiv|machete/.test(r)) return "blade";
    if (/maul|bitten|\bbit\b|dog|shark|animal|gored|savag/.test(r)) return "bite";
    if (/beat|punch|cage|brawl|fist|jumped|from behind|stomp|kick/.test(r)) return "fist";
    if (/shot|gun|drive-by|sniper|chopper|bullet|headshot|killed in the street|sprayed|ambush/.test(r)) return "bullet";
    if (attacker && typeof attacker === "object" && attacker.pos && fromX != null) {
      const P = CBZ.player;
      if (Math.hypot(fromX - P.pos.x, fromZ - P.pos.z) < 2.3) return "fist";
    }
    return "other";
  }
  const _bh = { zone: "", power: 0.6, weapon: "fist", heavy: false, by: null, dirX: 0, dirZ: 0, fromX: 0, fromZ: 0, point: null, kind: "", head: false, cal: 1, critical: false, noKill: true };
  function bodyHit(kind, dmg, hit, headshot, fromX, fromZ, attacker) {
    if (kind === "other") return false;
    const P = CBZ.player, V = CBZ.vitals;
    const wasDown = V.cuffable(P);
    const by = attacker && typeof attacker === "object" ? attacker : null;
    let dx = 0, dz = 0;
    if (fromX != null) { dx = P.pos.x - fromX; dz = P.pos.z - fromZ; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; }
    _bh.by = by; _bh.dirX = dx; _bh.dirZ = dz; _bh.fromX = fromX; _bh.fromZ = fromZ;
    _bh.point = hit && hit.point ? hit.point : null;
    if (kind === "fist") {
      // a fist never runs the number out: it knocks you out, and only a long
      // beating of you lying there kills (vitals counts those blows)
      if (P.hp < 1) P.hp = 1;
      _bh.zone = (hit && hit.zone) || (Math.random() < 0.55 ? "head" : "body");
      _bh.power = hit && hit.power != null ? hit.power : Math.min(1, 0.3 + dmg / 45);
      _bh.weapon = hit && hit.kind === "kick" ? "kick" : "fist";
      _bh.heavy = !!(hit && hit.heavy);
      const r = V.blunt(P, _bh);
      if (r === "knockdown" && !P.dead && CBZ.body && CBZ.body.knockdown && CBZ.city && CBZ.city.playerActor && !CBZ.body.busy(CBZ.city.playerActor)) {
        CBZ.body.knockdown(CBZ.city.playerActor, { dir: { x: dx, z: dz }, force: 6, t: 1.0 });
      } else if (r === "stagger") P.stun = Math.max(P.stun || 0, 0.18);
      return true;
    }
    // a round, a blade, teeth: a hole where it went in
    const runOut = P.hp <= 0;
    if (runOut && wasDown) return false;              // already on the floor: this one kills (the caller's WASTED)
    _bh.kind = kind === "blade" ? "stab" : kind;
    _bh.head = !!headshot;
    _bh.zone = (hit && hit.zone) || (headshot ? "head" : (() => { const u = Math.random(); return u < 0.3 ? "legs" : u < 0.5 ? "arms" : ""; })());
    _bh.cal = hit && hit.cal ? hit.cal : 1;
    _bh.critical = runOut;
    V.wound(P, _bh);
    playerHole(kind, _bh, headshot, fromX, fromZ, dx, dz);
    if (P.dead) return true;
    if (runOut) P.hp = 1;                              // down, awake, bleeding: vitals holds you on the floor
    else if (!headshot && !V.cuffable(P)) P.stun = Math.max(P.stun || 0, 0.08 + Math.min(0.12, dmg / 400));   // the round rocks you a beat
    const sev = Math.min(1, dmg / ((P.maxHp || 200) * 0.5));
    if (CBZ.gore && P.pos) CBZ.gore(P.pos.x, P.pos.y + 1.1, P.pos.z, { amount: 0.5 + sev * 0.6, player: true, dir: (fromX != null ? { x: dx, z: dz } : null) });
    return true;
  }
  // THE HOLE ON YOUR BODY, on the frame of the hit (systems/wounds.js): the
  // same entry hole, cloth hole and small blood ring every man in the street
  // gets, on your third-person rig, and mirrored onto your first-person arms
  // when it lands there. The city's hits mostly carry no ray, so the zone
  // picks the height and the shooter's bearing picks the side.
  const _phP = { x: 0, y: 0, z: 0 }, _phD = { x: 0, y: 0, z: 0 }, _phO = { head: false, cal: 1, melee: undefined, fromX: undefined, fromZ: undefined, dir: null };
  function playerHole(kind, bh, headshot, fromX, fromZ, dx, dz) {
    const P = CBZ.player;
    if (!CBZ.bodyWound || !CBZ.playerWoundActor || !P || !P.pos) return;
    let wp = bh.point && bh.point.x != null ? bh.point : null;
    if (!wp) {
      const z = bh.zone || "";
      const y = headshot || z === "head" ? 1.95 : /leg/.test(z) ? 0.55 + Math.random() * 0.35
        : /arm/.test(z) ? 1.2 + Math.random() * 0.25 : 1.05 + Math.random() * 0.4;
      const side = /arm/.test(z) ? (Math.random() < 0.5 ? -0.42 : 0.42) : (Math.random() - 0.5) * 0.3;
      // across the shot line (dx,dz points shooter -> you)
      _phP.x = P.pos.x + (-dz) * side; _phP.y = (P.pos.y || 0) + y; _phP.z = P.pos.z + dx * side;
      wp = _phP;
    }
    _phO.head = !!headshot || bh.zone === "head";
    _phO.cal = bh.cal || 1;
    _phO.melee = kind === "blade" ? "blade" : kind === "bite" ? "bite" : undefined;
    _phO.fromX = fromX != null ? fromX : undefined; _phO.fromZ = fromZ != null ? fromZ : undefined;
    if (dx || dz) { _phD.x = dx; _phD.y = 0; _phD.z = dz; _phO.dir = _phD; } else _phO.dir = null;
    try { CBZ.bodyWound(CBZ.playerWoundActor, wp, _phO); } catch (e) { /* wounds off */ }
  }
  // a full dressing (a medkit, a medic, a night's sleep): every open hole
  // wrapped, some blood made back, and up off the floor if the bleeding was
  // what held you there
  CBZ.cityHealWounds = function () {
    const V = CBZ.vitals, P = CBZ.player;
    if (V && P) V.dress(P, { blood: 0.25 });
  };
  const _injReset = CBZ.cityDeathReset;
  CBZ.cityDeathReset = function () {
    if (_injReset) _injReset();
    if (CBZ.vitals) CBZ.vitals.reset(CBZ.player);
    hospitalT = 0; deathStars = 0;
    if (CBZ.cityPoliceGrace) CBZ.cityPoliceGrace(20);   // a fresh life is not greeted by a gun-stop
    // mode swap / hard reset: never carry a missing head/limb into the next life
    if (CBZ.goreRestoreBody && CBZ.city && CBZ.city.playerActor) CBZ.goreRestoreBody(CBZ.city.playerActor);
    // a fresh life is a fresh body: the last one's holes stay with the last one
    if (CBZ.woundsForget && CBZ.playerWoundActor) CBZ.woundsForget(CBZ.playerWoundActor);
  };

  /* ---- THE CITY PLUGS ITS PLAYER INTO VITALS. Going down (knocked out,
     bled to collapse, or run out and bleeding) is the same knockdown the
     street already uses on you (physics.js lies you on your back while
     P._phys.down runs); the tick below holds you there for as long as vitals
     says you are down, and lets you up the moment it says you are not. */
  let vDown = false;
  if (CBZ.vitals && CBZ.vitals.on) {
    CBZ.vitals.on("city", {
      playerDown: function (on, o) {
        const P = CBZ.player;
        vDown = !!on;
        if (!on) { if (P._phys && P._phys.down > 0.4) P._phys.down = 0.4; return; }
        if (P.dead) return;
        const pa = CBZ.city && CBZ.city.playerActor;
        if (pa && CBZ.body && CBZ.body.knockdown) {
          let dir = null;
          const by = o && o.by;
          if (by && by.pos) { const dx = P.pos.x - by.pos.x, dz = P.pos.z - by.pos.z, l = Math.hypot(dx, dz) || 1; dir = { x: dx / l, z: dz / l }; }
          CBZ.body.knockdown(pa, { dir, force: 2, t: 2 });
        }
        if (CBZ.shake) CBZ.shake(0.35);
      },
      playerKill: function (cause, o) {
        o = o || {};
        CBZ.cityKillPlayer(cause || "bled out", { fromX: o.fromX, fromZ: o.fromZ, dmg: 8 });   // a weak slump, not a launch
      },
    });
  }
  CBZ.onUpdate(10.6, function () {
    if (g.mode !== "city" || !vDown) return;
    const P = CBZ.player; if (!P || P.dead) { vDown = false; return; }
    const V = CBZ.vitals;
    if (V && V.state(P) === "ok") { vDown = false; return; }
    if (P._phys) P._phys.down = Math.max(P._phys.down || 0, 0.5);   // held on the floor
    P.sprint = false;
  });

  // ---- did an EXPLOSION kill us? (car blast / airstrike / missile) ----
  // All player blast damage in crashfx.js routes through ONE path with the
  // reason "caught in an explosion"; airstrikes/missiles share it. Match that
  // plus any obvious blast wording so the cinematic fires on every boom.
  function isExplosionCause(reason) {
    if (!reason) return false;
    const r = ("" + reason).toLowerCase();
    return r.indexOf("explos") >= 0 || r.indexOf("blast") >= 0 ||
           r.indexOf("airstrike") >= 0 || r.indexOf("missile") >= 0 ||
           r.indexOf("blown up") >= 0;
  }

  // ---- did a HARD IMPACT kill us? (a lethal fall, or a worded splat/crash) ----
  // physics.js routes fatal fall damage through cityHurtPlayer with reason "fell".
  // We also catch any obvious splat/impact wording so the gory crumple fires on
  // every ground-impact death, not just falls.
  function isImpactCause(reason) {
    if (!reason) return false;
    const r = ("" + reason).toLowerCase();
    return r.indexOf("fell") >= 0 || r.indexOf("fall") >= 0 ||
           r.indexOf("splat") >= 0 || r.indexOf("impact") >= 0 ||
           r.indexOf("pavement") >= 0;
  }

  // ============================================================
  //  PERMADEATH — dying and getting hurt are now DIFFERENT events.
  //  Getting shot down / beaten / run over is "critically hurt": you wake up
  //  at the hospital (the classic flow below). But an unambiguously FATAL end
  //  — a bullet through the skull, an explosion, hitting the pavement from a
  //  rooftop, or a scripted execution (imp.fatal, used by campaign scenes) —
  //  is the end of the story: the saved run is erased and the only way
  //  forward is a fresh start.
  //
  //  OPT-IN ONLY NOW (CBZ.CONFIG.CITY_PERMADEATH = true). As a default it was
  //  the harshest rule in the game hung on the most random causes: any
  //  headshot, any explosion (your OWN rocket into a wall), any fall off a
  //  kerb-high roof ERASED THE SAVE. A beginner's first mistake ended the
  //  whole run. Every death is the hospital by default: a bill, the gun in
  //  your hand, a dent in respect, and you are back on the street.
  // ============================================================
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_PERMADEATH == null) CBZ.CONFIG.CITY_PERMADEATH = false;
  function isFinalCause(reason, imp) {
    if (!CBZ.CONFIG || CBZ.CONFIG.CITY_PERMADEATH !== true) return false;
    if (imp && imp.fatal) return true;                    // scripted executions opt in
    if (imp && imp.headshot) return true;                 // through the skull
    if (isExplosionCause(reason)) return true;
    if (isImpactCause(reason)) return true;               // the pavement always wins
    return ("" + (reason || "")).toLowerCase().indexOf("executed") >= 0;
  }

  // erase the run. g._cityGameOver gates worldstate's autosave so the wiped
  // slot can't be re-written by a 5s tick between here and the reload.
  function wipeSavedRun() {
    g._cityGameOver = true;
    try { localStorage.removeItem("CBZ_CITY_WORLD_V2"); } catch (e) {}
    try {
      if (CBZ.sqlitedb && CBZ.sqlitedb.saveWorld) CBZ.sqlitedb.saveWorld(null, "null");
    } catch (e) {}
    g.cityWorld = null; g.cityCampaign = null; g.cityCampaignPending = null;
  }

  let goCard = null;
  function showGameOverCard(line) {
    if (!goCard) {
      goCard = document.createElement("div");
      goCard.id = "cityGameOver";
      goCard.style.cssText = "position:fixed;inset:0;z-index:80;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:Fredoka,system-ui,sans-serif;text-align:center;background:rgba(6,2,2,.92)";
      goCard.innerHTML =
        "<div style='font-size:clamp(50px,10vw,120px);font-weight:700;letter-spacing:6px;color:#c9202a;text-shadow:0 6px 0 #5e070b,0 10px 26px rgba(0,0,0,.7)'>GAME OVER</div>" +
        "<div id='cityGameOverSub' style='font-size:clamp(18px,2.6vw,26px);color:#c9b9b9;max-width:640px;line-height:1.5'></div>" +
        "<button id='cityGameOverBtn' class='btn' style='margin-top:10px'>START A NEW LIFE</button>";
      document.body.appendChild(goCard);
      goCard.querySelector("#cityGameOverBtn").addEventListener("click", function () {
        wipeSavedRun();   // idempotent — belt and braces before the reload
        try { location.reload(); } catch (e) {}
      });
    }
    const sub = goCard.querySelector("#cityGameOverSub");
    if (sub) sub.textContent = line || "Your story ends here.";
    goCard.style.display = "flex";
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }

  // ---- does YOUR fatal headshot take the head OFF? ----
  // Same strict rule gore.js applies to NPCs: ordinary bullets keep the body
  // intact; only a shotgun blast inside muzzle distance can sever. The
  // killer's gun is read off the live attacker actor (cityHurtPlayer parks it
  // on g._cityKillerActor before the kill lands).
  function headPopsPlayer(imp) {
    const k = ("" + ((g._cityKillerActor && g._cityKillerActor.weapon) || (imp && imp.wkey) || "")).toLowerCase();
    if (k.indexOf("shotgun") >= 0) {
      if (!imp || imp.fromX == null) return false;
      const P = CBZ.player;
      return Math.hypot(P.pos.x - imp.fromX, P.pos.z - imp.fromZ) <= 5.5;
    }
    return false;
  }

  // ---- are we under a ROOF (inside a building)? ----
  // Building floor/roof slabs are registered as CBZ.platforms (with `top`) AND
  // as CBZ.losBlockers meshes. Cheap test first: any platform whose footprint
  // covers us and whose top sits above head height = a ceiling overhead. Then a
  // single short up-ray against the LOS meshes as a backstop (covers roofs that
  // only exist as meshes). No per-frame cost — only runs once, on death.
  const _upRay = new THREE.Raycaster();
  const _upOrigin = new THREE.Vector3(), _upDir = new THREE.Vector3(0, 1, 0);
  function isIndoors(px, py, pz) {
    // overhead platform (floor/roof slab above the player)
    const plats = CBZ.platforms;
    if (plats) {
      const headY = py + 1.6;
      for (let i = 0; i < plats.length; i++) {
        const p = plats[i];
        if (p.top == null) continue;
        if (p.top > headY && p.top < py + 28 &&
            px >= p.minX && px <= p.maxX && pz >= p.minZ && pz <= p.maxZ) return true;
      }
    }
    // backstop: short up-ray hits a roof/ceiling LOS mesh
    const blk = CBZ.losBlockers;
    if (blk && blk.length) {
      _upOrigin.set(px, py + 1.5, pz);
      _upRay.set(_upOrigin, _upDir); _upRay.far = 26;
      const hit = CBZ.losRaycast ? CBZ.losRaycast(_upRay, blk) : _upRay.intersectObjects(blk, false);
      if (hit.length) return true;
    }
    return false;
  }

  // ---- WASTED ----
  const _ragP = { x: 0, y: 0, z: 0 }, _ragD = { x: 0, y: 0, z: 0 };   // ragdoll scratch
  let deathStars = 0;                 // the heat you died carrying (the bill reads it)
  CBZ.cityKillPlayer = function (reason, imp) {
    const P = CBZ.player;
    if (P.dead) return;
    P.dead = true; P.hp = 0; dying = true;
    // THE COST OF DYING, bounded. The manhunt closes and street respect takes
    // a dent (wanted.js); kills, crew, gang colors and the rest of your
    // progress survive. The gun in your hand is lost: under Inventory V2 it
    // already hit the pavement as a real pickup with the rest of your carried
    // gear (inventory.js's death wrap ran before us); without V2 it is simply
    // gone. The bill is charged at the hospital (respawn).
    deathStars = g.wanted | 0;
    if (CBZ.cityDeathPenalty) { try { CBZ.cityDeathPenalty(); } catch (e) {} }
    if (CBZ.currentWeaponId && CBZ.lockWeapon && !(CBZ.CONFIG && CBZ.CONFIG.INVENTORY_V2 !== false && CBZ.cityDropItem)) {
      try { CBZ.lockWeapon(CBZ.currentWeaponId); } catch (e) {}
    }
    // cinematic third-person replay: orbit the body (camera.js reads cityCam)
    if (CBZ.cityCam) CBZ.cityCam.death = { t: 0, ang0: Math.random() * 6.28 };

    // CINEMATIC EXTERIOR DEATH CAM: killed by an explosion while INSIDE a
    // building → first cut to a street-level shot looking back at the building +
    // the blast, hold a beat, THEN the normal orbit + fade-to-WASTED. Outdoor or
    // non-explosion deaths skip this and keep the stock behaviour.
    let extBeat = 0;
    if (isExplosionCause(reason) && imp && imp.fromX != null &&
        CBZ.cityCam && CBZ.cityCam.death && CBZ.cityCam.beginExteriorDeathCam &&
        isIndoors(P.pos.x, P.pos.y, P.pos.z)) {
      extBeat = 1.5;
      CBZ.cityCam.beginExteriorDeathCam({
        bx: imp.fromX, bz: imp.fromZ, by: P.pos.y + 0.6,
        px: P.pos.x, pz: P.pos.z, dur: extBeat,
      });
    }
    if (CBZ.playerChar) CBZ.playerChar.group.visible = true;
    if (P.driving && CBZ.cityExitVehicle) { CBZ.cityExitVehicle(); }
    // THE GUN LEAVES YOUR HANDS (fpsmode.js): the first-person viewmodel
    // tumbles out of frame and a cosmetic world mesh of the weapon clatters
    // down beside the body (inventory untouched — it's back on respawn, and
    // it's not a cityDrop so nobody can walk off with it). When the FP tumble
    // plays, hold the orbit cam ~half a beat so the drop reads from YOUR eye
    // before the replay pulls out; the exterior blast cinematic keeps priority.
    const physicalDrop = !!(CBZ.CONFIG && CBZ.CONFIG.INVENTORY_V2 !== false && CBZ.cityDropItem);
    let fpDrop = false;
    if (CBZ.fpsDeathDrop) {
      fpDrop = CBZ.fpsDeathDrop();
      // Inventory V2 already placed the authoritative, lootable weapon model.
      // Retire fpsmode's second cosmetic copy immediately while preserving the
      // carried-gun release it performs on the corpse.
      if (physicalDrop && CBZ.fpsDeathDropReset) { CBZ.fpsDeathDropReset(); fpDrop = false; }
    }
    if (fpDrop && extBeat <= 0 && CBZ.cityCam && CBZ.cityCam.death) {
      pendingDeathCam = CBZ.cityCam.death;
      CBZ.cityCam.death = null;
      deathCamHoldT = 0.45;
    }
    // A LETHAL FALL / hard impact reads as a brutal SPLAT, not a high arcing
    // fling: you've already hit the ground at speed, so the body crumples at the
    // spot in a spreading blood pool instead of launching back into the air.
    const splatDeath = isImpactCause(reason);
    // THE FLING MATCHES THE KILLING FORCE: cityHurtPlayer forwards the final
    // damage of the killing blow on the impact (a close shotgun blast lands
    // ~3x a pistol tap; a car at speed more still), so a big hit HURLS the
    // body and spins it harder while bleeding out is just a weak slump.
    const fK = imp && imp.dmg != null ? Math.max(0.55, Math.min(2.2, imp.dmg / 55)) : 1;
    // and it flings AWAY from the shooter (jittered), not in a random direction —
    // the body's flight line tells you where the shot came from.
    const a = Math.random() * 6.28;
    let fx = Math.cos(a), fz = Math.sin(a);
    if (!splatDeath && imp && imp.fromX != null) {
      const ddx = P.pos.x - imp.fromX, ddz = P.pos.z - imp.fromZ, dl = Math.hypot(ddx, ddz);
      if (dl > 0.01) { fx = ddx / dl + (Math.random() - 0.5) * 0.5; fz = ddz / dl + (Math.random() - 0.5) * 0.5; }
    }
    // VERLET RAGDOLL (city/ragdoll.js): YOUR body flops for real too — the rig
    // takes the killing impulse point-blank, limbs drape down stairs/off ledges,
    // and the death cam orbits the PELVIS as it goes (ragdoll.js feeds player.pos
    // from the pelvis point each frame; camera.js already orbits player.pos).
    // When it engages, P._death collapses to a landed sentinel so physics.js's
    // spin-fling never fights the points. Falls back to the legacy fling cleanly.
    let ragged = false;
    if (CBZ.cityRagdoll && CBZ.playerChar && CBZ.city && CBZ.city.playerActor) {
      let mag = splatDeath ? 3.5 : Math.min(18, 5 + (imp && imp.dmg != null ? imp.dmg : 25) * 0.14);
      if (isExplosionCause(reason)) mag = 24;             // a blast LIFTS you
      _ragD.x = fx; _ragD.y = 0; _ragD.z = fz;
      _ragP.x = P.pos.x - fx * 0.25;
      _ragP.y = P.pos.y + (imp && imp.headshot ? 2.05 : 1.25);
      _ragP.z = P.pos.z - fz * 0.25;
      ragged = CBZ.cityRagdoll(CBZ.city.playerActor, _ragP, _ragD, mag);
    }
    // spinning ragdoll fling (physics.js handles player._death in non-escape modes)
    P._death = ragged ? {
      // verlet owns the body — physics.js just idles in its landed branch
      vx: 0, vz: 0, vy: 0, spin: 0, spin2: 0, t: 0, landed: true, seed: Math.random() * 6.28,
    } : splatDeath ? {
      // low, flat crumple — barely leaves the ground, lands almost immediately
      vx: Math.cos(a) * (1.2 + Math.random() * 1.5), vz: Math.sin(a) * (1.2 + Math.random() * 1.5),
      vy: 1.0 + Math.random() * 1.0, spin: (Math.random() * 2 - 1) * 9, spin2: (Math.random() * 2 - 1) * 7,
      t: 0, landed: false, seed: Math.random() * 6.28,
    } : {
      vx: fx * (3 + Math.random() * 3) * fK, vz: fz * (3 + Math.random() * 3) * fK,
      vy: Math.min(11.5, (6 + Math.random() * 3) * (0.7 + 0.4 * fK)),
      spin: (Math.random() * 2 - 1) * 7 * (0.7 + 0.5 * fK),
      spin2: (Math.random() * 2 - 1) * 5 * (0.7 + 0.5 * fK),
      t: 0, landed: false, seed: Math.random() * 6.28,
    };
    if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.kx = P._phys.kz = 0; }
    if (CBZ.shake) CBZ.shake(splatDeath ? 1.9 : Math.min(1.8, 0.85 + 0.35 * fK));
    if (CBZ.sfx) CBZ.sfx("ko");
    if (CBZ.doSlowmo) CBZ.doSlowmo(splatDeath ? 0.55 : 0.5);
    if (CBZ.doHitstop && splatDeath) CBZ.doHitstop(0.2);
    let gdir = imp && imp.dir ? { x: imp.dir.x || 0, z: imp.dir.z || 0 }
      : (imp && imp.fromX != null ? { x: P.pos.x - imp.fromX, z: P.pos.z - imp.fromZ } : null);
    // REAL DISMEMBERMENT: the corpse the death cam orbits is genuinely MISSING
    // what came off — but ONLY ordnance that actually removes heads pops YOURS
    // (headPopsPlayer: face-range shotgun only; every ordinary bullet keeps the
    // head attached and uses wounds + ragdoll force). A blast
    // tears 1-2 limbs. respawn() hands the rig back whole via goreRestoreBody.
    let popped = false;
    if (CBZ.goreSever && CBZ.city && CBZ.city.playerActor && !splatDeath) {
      const pa = CBZ.city.playerActor;
      if (imp && imp.headshot) {
        if (headPopsPlayer(imp)) { CBZ.goreSever(pa, "head", { dir: gdir }); popped = true; }
      } else if (isExplosionCause(reason)) {
        const LIMBS = ["ll", "rl", "la", "ra"];
        const n = 1 + (Math.random() < 0.45 ? 1 : 0);
        for (let i = 0; i < n; i++) CBZ.goreSever(pa, LIMBS[(Math.random() * 4) | 0], { dir: gdir, boom: true });
      }
    }
    if (splatDeath && CBZ.cityImpactSplat) {
      // the gory landing splat (blood pool + crimson sheet + gibs + bone-crunch),
      // seated right where the body hits. cityImpactSplat itself calls CBZ.gore.
      CBZ.cityImpactSplat(P.pos.x, P.pos.y + 0.6, P.pos.z, { player: true, speed: P._fellSpeed || 24, dir: gdir });
    } else if (CBZ.gore) {
      // the burst scales with the killing force too; a fatal headshot pops
      // (skull frags + instant wall paint), a fatal run-over drags a smear.
      const ranOver = ("" + (reason || "")).toLowerCase().indexOf("run over") >= 0;
      CBZ.gore(P.pos.x, P.pos.y + 1.0, P.pos.z, {
        dir: gdir, amount: Math.min(2, 1.05 + fK * 0.35), player: true,
        head: !!(imp && imp.headshot), pop: popped,
        smear: ranOver, smearLen: ranOver ? 3 + fK * 2.5 : 0,
      });
    }
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    const killer = (g._cityKiller && (CBZ.now || 0) - (g._cityKillerT || 0) < 6) ? g._cityKiller : null;
    // a live, on-map NPC actor we can SPECTATE after the WASTED beat (only set when
    // an actor — not a string — dealt the blow). Held for the post-WASTED kill-cam.
    pendingSpecKiller = (g._cityKillerActor && g._cityKillerActor.pos && !g._cityKillerActor.culled &&
                         (CBZ.now || 0) - (g._cityKillerT || 0) < 6) ? g._cityKillerActor : null;
    // YOU are a body on their ledger too — the kill-cam should never read
    // "0 bodies" about the one who just put you down.
    if (pendingSpecKiller && !pendingSpecKiller.isPlayer) {
      pendingSpecKiller.bodies = (pendingSpecKiller.bodies | 0) + 1;
    }
    // tell crowd.js to NOT park this killer off-map during the death beat (its
    // park-on-death sweep would otherwise banish a crowd-pool killer to (-4000),
    // leaving the kill-cam orbiting empty space). Lives until respawn.
    g._citySpecTarget = pendingSpecKiller;
    // Most death reasons are PASSIVE past-participles ("shot by police", "run
    // over", "executed", "stabbed") and read right as "You were ___". A handful
    // are ACTIVE-voice phrases where that template is just broken English —
    // "You were bled out" / "You were starved to death" — so those take a bare
    // "You ___" instead ("You bled out", "You starved to death").
    const activeVoice = reason === "bled out" || reason === "starved to death" || reason === "collapsed from exhaustion";
    const line = killer ? ("Killed by " + killer)
      : splatDeath ? "You hit the pavement"
      : (reason ? ((activeVoice ? "You " : "You were ") + reason) : "You died");
    // hold the WASTED title back ~1.8s so the ragdoll fling plays out first, THEN
    // it fades in — no jarring instant pop on the exact frame you die. When the
    // exterior cinematic plays, hold the title until the street shot has done its
    // job (the full beat + a touch of the orbit hand-off) so the reveal lands.
    // PERMADEATH split: a truly fatal end skips the hospital line (and the
    // kill-cam — there is nothing after this to spectate for) and routes the
    // post-title beat to the GAME OVER card instead of respawn().
    finalDeath = isFinalCause(reason, imp);
    if (finalDeath) {
      finalDeathLine = line;
      pendingSpecKiller = null; g._citySpecTarget = null;
      pendingWasted = line;
    } else {
      pendingWasted = line;
    }
    const titleDelay = extBeat > 0 ? (extBeat + 0.6) : 1.8;
    wastedT = titleDelay;
    g._cityKiller = null; g._cityKillerActor = null;
    respawnT = 4.6 + titleDelay;   // keep the title on screen its full duration after the delay
  };

  // ============================================================
  //  SPECTATE — Fortnite-style kill-cam. The WASTED screen plays UNCHANGED; only
  //  AFTER its full beat, if a real on-map actor killed you, the camera leaves your
  //  corpse and follows your KILLER (camera.js orbits cc.death.spectate) while a
  //  live card shows who they are, their health, and what they're doing. Auto-
  //  respawn after a beat, or SPACE / click to go now. String / explosion / fall
  //  deaths have no one to watch, so they keep the stock instant respawn.
  // ============================================================
  function buildSpecHUD() {
    if (specHUD) return;
    specHUD = document.createElement("div");
    specHUD.id = "citySpectate";
    specHUD.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:54;display:none;flex-direction:column;align-items:center;padding:0 0 30px;pointer-events:none;font-family:Fredoka,system-ui,sans-serif";
    const card = document.createElement("div");
    card.style.cssText = "min-width:300px;max-width:78vw;background:linear-gradient(180deg,rgba(10,13,20,.82),rgba(10,13,20,.93));border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px 20px 14px;box-shadow:0 8px 30px rgba(0,0,0,.55);text-align:center";
    specName = document.createElement("div");
    specName.style.cssText = "font-size:26px;font-weight:700;color:#fff;margin:3px 0 9px;text-shadow:0 2px 8px rgba(0,0,0,.6)";
    const hpWrap = document.createElement("div");
    hpWrap.style.cssText = "position:relative;height:16px;border-radius:8px;background:rgba(255,255,255,.12);overflow:hidden;margin:0 auto;width:260px";
    specHpFill = document.createElement("i");
    specHpFill.style.cssText = "position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(90deg,#37d67a,#7ed957);transition:width .18s ease,background .3s";
    specHpTxt = document.createElement("span");
    specHpTxt.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#06121a;text-shadow:0 1px 0 rgba(255,255,255,.25)";
    hpWrap.appendChild(specHpFill); hpWrap.appendChild(specHpTxt);
    // WHO beat you: what they're worth and how many they've dropped — the
    // street-read you'd have wanted BEFORE picking the fight.
    specStats = document.createElement("div");
    specStats.style.cssText = "display:flex;gap:18px;justify-content:center;font-size:14px;color:#ffd451;margin-top:9px;font-weight:700";
    specStateEl = document.createElement("div");
    specStateEl.style.cssText = "font-size:14px;color:#cdd6e2;margin-top:9px;font-weight:600";
    specFoot = document.createElement("div");
    specFoot.style.cssText = "font-size:12px;color:#8a93a3;margin-top:11px";
    // The camera already says that we are following the killer. Keep only the
    // person's real name and a visual health bar; no spectator/tutorial prose.
    card.appendChild(specName); card.appendChild(hpWrap);
    specHUD.appendChild(card);
    document.body.appendChild(specHUD);
  }
  // what the killer is WORTH: pocket cash + the street value of everything
  // they're carrying (same ITEMS catalog the fence pays out on)
  function killerWorth(k) {
    if (k.netKind === "player") return null;          // remote wallets aren't synced
    let w = k.cash | 0;
    const econ = CBZ.cityEcon;
    if (k.valuables && econ && econ.ITEMS) {
      for (const v of k.valuables) { const it = econ.ITEMS[v]; if (it && it.value) w += it.value; }
    }
    return w;
  }
  // how many they've dropped: the generic per-actor ledger (cityKillPed stamps
  // every NPC kill) merged with the gang book when they ride with a set
  function killerBodies(k) {
    if (k.netKind === "player") return null;          // remote players don't sync kill counts (yet)
    const gangBook = k.gstat && k.gstat.bodies != null ? (k.gstat.bodies | 0) : 0;
    return Math.max(gangBook, k.bodies | 0);
  }
  function killerStateText(k) {
    if (!k) return "";
    if (k.dead) return "Down, dropped right after they got you";
    if (k.rampage) return "On a rampage";
    if (k.state === "fight" || k.rage) return "In a firefight";
    if (k.state === "flee") return "On the run";
    if (k.kind === "cop") return "Back on patrol";
    if (k.armed) return "Armed & roaming";
    return "Walking it off";
  }
  // a killer is watchable while it still exists on the map: not culled, not parked
  // off-map in the crowd pool (crowd.js banishes promoted peds to (-4000,-4000) the
  // instant you die — g._citySpecTarget keeps YOUR killer exempt, but guard anyway),
  // and its rig still parented.
  function specValid(k) { return !!(k && k.pos && !k.culled && !k._parked && (!k.group || k.group.parent)); }
  function beginSpectate(k) {
    spectating = true; specKiller = k; specT = 0; specMax = 10;
    // cops carry only .hp (no .maxHp) — use their known full HP as the bar baseline
    // so a wounded cop's bar doesn't read 100% at, say, 85 HP.
    specKillerMax = k.maxHp || (k.kind === "cop" ? (k.swat ? 160 : 110) : (k.hp || 100));
    hideOverlay();                                   // retire the big WASTED title
    buildSpecHUD(); specHUD.style.display = "flex";
    // keep the death-cam alive and tell camera.js to orbit THEM, not your corpse.
    if (CBZ.cityCam) { CBZ.cityCam.death = CBZ.cityCam.death || { t: 0, ang0: Math.random() * 6.28 }; CBZ.cityCam.death.spectate = k; }
  }
  function endSpectate() {
    spectating = false; specKiller = null;
    if (specHUD) specHUD.style.display = "none";
    if (CBZ.cityCam && CBZ.cityCam.death) CBZ.cityCam.death.spectate = null;
    respawn();
  }
  function tickSpectate(dt) {
    specT += dt;
    const k = specKiller;
    if (!specValid(k)) { endSpectate(); return; }     // killer left the world → just respawn
    if (k.dead && specMax > specT + 3) specMax = specT + 3;   // they dropped → hold a beat, then go
    const hp = Math.max(0, k.hp || 0), ratio = Math.max(0, Math.min(1, hp / (specKillerMax || 1)));
    if (specName) specName.textContent = killerName(k) || "your killer";
    if (specHpFill) { specHpFill.style.width = (ratio * 100).toFixed(0) + "%"; specHpFill.style.background = ratio > 0.5 ? "linear-gradient(90deg,#37d67a,#7ed957)" : ratio > 0.22 ? "linear-gradient(90deg,#e7a93a,#ffd451)" : "linear-gradient(90deg,#c9202a,#ff5a4a)"; }
    if (specHpTxt) specHpTxt.textContent = "";
    if (specStats) specStats.innerHTML = "";
    if (specStateEl) specStateEl.textContent = "";
    if (specFoot) specFoot.textContent = "";
    if (specT >= specMax) { endSpectate(); return; }
  }
  // SPACE / Enter / click ends the kill-cam early (Fortnite "respawn now")
  function specSkip(e) {
    if (!spectating || g.mode !== "city") return;
    if (e.type === "keydown") {
      const k = (e.key || "").toLowerCase(), c = e.code || "";
      if (k !== " " && k !== "spacebar" && k !== "enter" && c !== "Space" && c !== "Enter") return;
      e.preventDefault();
    }
    endSpectate();
  }
  addEventListener("keydown", specSkip);
  addEventListener("mousedown", specSkip);

  // ---- where you wake up, and which way you face ----
  // The NEAREST hospital to where you fell (the old code took the first one in
  // the lot list, wherever it was), a couple of metres OUT of its door rather
  // than inside the door frame, facing the street.
  function nearestHospital(x, z) {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.lots) return null;
    let best = null, bd = Infinity;
    for (let i = 0; i < A.lots.length; i++) {
      const l = A.lots[i];
      if (!l || l.kind !== "hospital" || !l.building || !l.building.door) continue;
      const d = l.building.door, dd = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z);
      if (dd < bd) { bd = dd; best = l; }
    }
    return best;
  }
  // unit vector from the lot's centre out through its door (door normals in
  // this codebase point both ways depending on the builder, so derive it)
  function doorOut(lot) {
    const d = lot.building.door;
    let ox = d.x - (lot.cx != null ? lot.cx : d.x), oz = d.z - (lot.cz != null ? lot.cz : d.z);
    let l = Math.hypot(ox, oz);
    if (l < 0.01 && d.nx != null) { ox = d.nx; oz = d.nz; l = Math.hypot(ox, oz); }
    if (l < 0.01) return { x: 0, z: 1 };
    return { x: ox / l, z: oz / l };
  }
  // facing along/toward the nearest road centre-line (the fallback when
  // CBZ.cityFaceOpen is not there to pick an open view)
  function roadYaw(x, z) {
    const A = CBZ.city && CBZ.city.arena, roads = A && A.roads;
    if (!roads || !roads.length) return null;
    let best = null, bd = Infinity, bx = 0, bz = 0;
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i], h = (r.len || 0) / 2;
      const px = r.vertical ? r.x : Math.max(r.x - h, Math.min(r.x + h, x));
      const pz = r.vertical ? Math.max(r.z - h, Math.min(r.z + h, z)) : r.z;
      const dd = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (dd < bd) { bd = dd; best = r; bx = px; bz = pz; }
    }
    if (!best) return null;
    if (bd > 9) return Math.atan2(bx - x, bz - z);           // look at the street
    return best.vertical ? (z < best.z ? 0 : Math.PI) : (x < best.x ? Math.PI / 2 : -Math.PI / 2);   // standing on it: look down it
  }

  let hospitalT = 0;                  // the brief "HOSPITAL" card after waking
  function respawn() {
    const P = CBZ.player;
    dying = false; hideOverlay();
    pendingDeathCam = null; deathCamHoldT = 0;
    if (CBZ.fpsDeathDropReset) CBZ.fpsDeathDropReset();   // dropped prop gone, viewmodel whole
    spectating = false; specKiller = null; pendingSpecKiller = null; g._citySpecTarget = null;
    if (specHUD) specHUD.style.display = "none";
    if (CBZ.cityCam) CBZ.cityCam.death = null;          // end the cinematic
    // own a home? respawn there for free. Otherwise the nearest ER patches you
    // up for a bill.
    const A = CBZ.city.arena;
    let spot = A.spawn, atHome = false, out = null;
    const fx = P.pos.x, fz = P.pos.z;
    if (g.citySpawnPoint) { spot = g.citySpawnPoint; atHome = true; }
    else {
      const h = nearestHospital(fx, fz);
      if (h) {
        out = doorOut(h);
        const d = h.building.door, B = h.building;
        // on the step outside the FACADE, not 2.6 m past a door point that some
        // builders (town clinics) already put 1.6 m past the lot line: that
        // stood you in the road
        let sx = d.x + out.x * 2.6, sz = d.z + out.z * 2.6;
        const bcx = B.ox != null ? B.ox : h.cx, bcz = B.oz != null ? B.oz : h.cz;
        if (B.w > 0 && B.d > 0 && bcx != null && bcz != null) {
          const half = Math.abs(out.x) * B.w / 2 + Math.abs(out.z) * B.d / 2;
          sx = bcx + out.x * (half + 1.3) + (d.x - bcx) * Math.abs(out.z);
          sz = bcz + out.z * (half + 1.3) + (d.z - bcz) * Math.abs(out.x);
        }
        spot = { x: sx, z: sz };
      }
    }
    // THE BILL: 250 + 150 per star you died carrying, from your pocket first
    // and then the bank. Never debt: if you have nothing, the ER eats it.
    let bill = 0;
    if (!atHome) {
      const want = 250 + deathStars * 150;
      const fromCash = Math.min(Math.max(0, g.cash || 0), want);
      g.cash = (g.cash || 0) - fromCash;
      const fromBank = Math.min(Math.max(0, g.cityBank || 0), want - fromCash);
      if (fromBank > 0) g.cityBank -= fromBank;
      bill = fromCash + fromBank;
    }
    g._lastBill = bill; deathStars = 0;
    if (CBZ.cityWantedReset) CBZ.cityWantedReset();
    if (CBZ.clearCityCops) CBZ.clearCityCops();
    // hand the rig back WHOLE — any head/limb the death took comes back now,
    // same frame (the audit in gore.js is the backstop, this is the guarantee)
    if (CBZ.goreRestoreBody && CBZ.city && CBZ.city.playerActor) CBZ.goreRestoreBody(CBZ.city.playerActor);
    P.pos.set(spot.x, 0, spot.z);
    P.vy = 0; P.grounded = true; P.dead = false; P.maxHp = P.maxHp || 200; P.hp = P.maxHp; P.ko = 0; P.stun = 0; P._hurtT = 0;
    if (CBZ.vitals) CBZ.vitals.reset(P);         // the ER sent you out whole: no bleeds, full blood, no wraps
    if (CBZ.eyes && CBZ.eyes.open) CBZ.eyes.open(0.8);   // wake: the lids of the final fade come up
    vDown = false;
    // ARMOR drops with the body: respawn bare. cityArmorResetPlayer clears the
    // pool + kit + unmounts the vest/helmet prop (armor.js). Fallback zeroes the
    // pool if armor.js is absent so the legacy absorb path stays sane.
    P._death = null; P._fellSpeed = 0; P._fallPeak = 0;
    if (CBZ.cityArmorResetPlayer) CBZ.cityArmorResetPlayer();
    else { P._armor = 0; P._armorMax = 0; }
    g.hunger = Math.max(40, g.hunger || 0);
    if (P._phys) { P._phys.air = false; P._phys.down = 0; P._phys.kx = P._phys.kz = 0; }
    // THIRD PERSON, level lens, facing the street. The old respawn dropped you
    // into FIRST person at a random yaw with the lens pitched 0.4 (staring at
    // the pavement / a wall) and you had to find yourself before you could move.
    let yaw = out ? Math.atan2(out.x, out.z) : null;
    const ry = roadYaw(spot.x, spot.z);
    if (ry != null) yaw = ry;
    if (yaw == null) yaw = CBZ.playerChar.group.rotation.y || 0;
    CBZ.playerChar.group.visible = true;
    CBZ.playerChar.group.rotation.set(0, yaw, 0);
    CBZ.playerChar.group.scale.y = 1;
    CBZ.playerChar.group.position.copy(P.pos);
    if (CBZ.setFPS) CBZ.setFPS(false);
    if (typeof CBZ.cityFaceOpen === "function") {
      try { const fy = CBZ.cityFaceOpen(P); if (typeof fy === "number" && isFinite(fy)) CBZ.playerChar.group.rotation.y = fy; } catch (e) {}
    }
    if (CBZ.cam) {
      CBZ.cam.yaw = CBZ.playerChar.group.rotation.y + Math.PI;     // mode.js's spawn convention
      CBZ.cam.pitch = CBZ.CITY_TP ? CBZ.CITY_TP.PITCH : 0.06;
    }
    if (CBZ.resetZoom) CBZ.resetZoom();
    g.invuln = 2.5;       // brief grace after the ER
    if (CBZ.cityPoliceGrace) CBZ.cityPoliceGrace(25);   // no gun-stop on the hospital step
    if (CBZ.requestLock) CBZ.requestLock();
    // a short, readable wake-up beat on the existing WASTED overlay
    showOverlay(atHome ? "HOME" : "HOSPITAL", atHome ? "Patched up at home." : (bill > 0 ? "Patched up. Bill paid: $" + bill : "Patched up. You couldn't pay, so the ER ate it."), "#8fd3ff");
    hospitalT = 2.2;
    if (CBZ.city) CBZ.city.note(atHome ? "You wake up at home, patched up." : ("City Hospital. Bill: $" + bill), 2.4);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  CBZ.onUpdate(13, function (dt) {
    if (g.mode !== "city") return;
    if (g.invuln > 0) g.invuln = Math.max(0, g.invuln - dt);
    if (hospitalT > 0 && !dying) { hospitalT -= dt; if (hospitalT <= 0) hideOverlay(); }
    if (dying) {
      // gun-drop beat over → hand the camera to the stock WASTED orbit
      if (pendingDeathCam) {
        deathCamHoldT -= dt;
        if (deathCamHoldT <= 0) {
          if (CBZ.cityCam && !CBZ.cityCam.death) CBZ.cityCam.death = pendingDeathCam;
          pendingDeathCam = null;
        }
      }
      if (pendingWasted && wastedT > 0) { wastedT -= dt; if (wastedT <= 0) { showOverlay(finalDeath ? "DEAD" : "WASTED", pendingWasted, "#c9202a"); pendingWasted = null; } }
      if (spectating) { tickSpectate(dt); return; }
      respawnT -= dt;
      // THE FINAL FADE: the only place the eyes close (systems/eyes.js). The
      // last ~0.9 s of the beat, and only when nothing is left to watch (a
      // spectated killer keeps your eyes on him).
      if (respawnT < 0.9 && CBZ.eyes && CBZ.eyes.close &&
          !(pendingSpecKiller && specValid(pendingSpecKiller))) CBZ.eyes.close(0.9);
      if (respawnT <= 0) {
        // PERMADEATH: a final death never reaches respawn() — the run is wiped
        // and the GAME OVER card is the only exit (its button reloads fresh).
        if (finalDeath) {
          if (!g._cityGameOver) { wipeSavedRun(); showGameOverCard(finalDeathLine); }
          return;
        }
        // the WASTED beat is done — if a real person did this, SPECTATE them now
        // instead of snapping straight to the hospital. Nothing to watch → respawn.
        if (pendingSpecKiller && specValid(pendingSpecKiller)) { beginSpectate(pendingSpecKiller); pendingSpecKiller = null; return; }
        respawn();
      }
      return;
    }
    // out-of-combat health regen (GTA-style) so a flesh wound isn't a death
    const P = CBZ.player;
    if (!P.dead) {
      if (P._hurtT > 0) P._hurtT -= dt;
      // X2: systems/hunger.js sets _hungryNoRegen while hunger<30 — a hungry
      // body doesn't patch itself up for free.
      // an open bleed is what hurts now (systems/vitals.js): nothing knits
      // while it runs, or while you are lying on the floor
      else if (!P._hungryNoRegen && P.hp < (P.maxHp || 200) &&
               !(CBZ.vitals && (CBZ.vitals.bleeding(P) || CBZ.vitals.state(P) !== "ok"))) { P.hp = Math.min(P.maxHp || 200, P.hp + 16 * dt); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
    }
  });

  // ---- BUSTED fade (called by city/wanted.js before the jail handoff) ----
  // opts.note (city/origins.js EXEC fraud arrest): an optional custom sub-line
  // replacing the generic "Cuffed and processed..." text; omitted -> unchanged.
  // opts.title (games/jail.js, the prison transport): the arrest is no longer a
  // single moment — being CUFFED and being SHIPPED TO THE PEN are two different
  // beats and the card must not say "BUSTED" for both. Defaults to the original
  // word, so every existing caller is unchanged.
  CBZ.cityBustOverlay = function (lost, done, opts) {
    opts = opts || {};
    showOverlay(opts.title || "BUSTED", opts.note || ("Cuffed and processed." + (lost > 0 ? " Lost $" + lost + "." : "") + " Off to the cells."), "#5b8bff");
    let t = 0;
    const tick = function () {
      t += 0.05;
      if (t >= 2.6) { hideOverlay(); if (done) done(); return; }
      setTimeout(tick, 50);
    };
    setTimeout(tick, 50);
  };

  // The exterior death shot (explosion indoors) lives in city/camera.js only.
  // This file used to install a second, "fallback" copy that, loading first,
  // was the one that actually ran while camera.js's sat dormant.
})();
