/* ============================================================
   systems/combat.js — the prison player's fists and shank.

   CBZ.punch(actor, {blade}) / CBZ.prisonStab(actor) choose WHAT is thrown
   (the jab-cross-hook rhythm, the shank's deep fourth, stamina, damage) and
   what it COSTS (the law, the loot, the execution, the bleed). HOW it lands
   is systems/verbs_strike.js: the swing is a real rig strike, and the blow
   resolves on the frame your fist reaches his jaw, head, ribs or legs — a
   man who stepped back is a whiff, a raised guard takes it on the forearms,
   and the zone it found scales the damage and picks his reaction.

   Chain hits to build a COMBO. When a hit would drop someone, a combo/heavy
   finish is an EXECUTION: hitstop, slow motion, the last one bleeds.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const maxHpOf = (a) => (a.kind === "guard" || a.kind === "warden" ? 140 : 100);

  /* THE IMPACT GLOW: DELETED. (OWNER: "glow on punch impact is super dumb...
     just like the words on the screen saying Swing...")

     An additive white-to-orange radial sprite, depthTest:false, flashed at the
     midpoint between you and whoever you hit, every landed punch. He is right
     that it is the same object as the caption: a symbol drawn on top of an
     event to announce that the event happened. Knuckles do not emit light.

     What it was sitting on top of, and hiding, is a full physical impact on
     the same frame: both bodies freeze together (hitstop), the camera takes
     the hit, his head goes the way the fist went, a body shot folds him, a
     hard one puts him on a step back to keep his feet (systems/verbs_strike.js).
     Taking the flare off is what lets any of that be seen.
     (The floating health bar over people went the same way: a beaten man
     reads on his body — the reactions, the blood, the fall.) */

  /* ---------- THE HIT REACTION (what a punch does to YOUR body) ----------
     Three timers on CBZ.player, all read by systems/physics.js:
       hitT     — the reaction: movement at 45%, no sprint (0.12-0.45 s)
       hitLock  — the impact beat: you cannot start a swing (0.11 s)
       poiseT   — while > 0 a new hit lands (damage, flash, shake) but does
                  NOT re-arm the reaction. Set from the start of each
                  reaction to outlast it by POISE, so a crowd landing a fist
                  every third of a second gets one reaction per ~0.9 s and
                  you can always move and swing back between them.
     `player.stun` (the hard lock) is untouched and still means what it
     always meant: tased, tackled, grabbed. */
  const HIT_LOCK = 0.11, HIT_POISE = 0.55;
  CBZ.playerHitReact = function (secs, opts) {
    const P = CBZ.player; if (!P || P.dead) return false;
    if ((P.poiseT || 0) > 0) { P.hitT = Math.max(P.hitT || 0, 0.06); return false; }
    const s = Math.max(0.12, Math.min(0.45, +secs || 0.3));
    P.hitT = Math.max(P.hitT || 0, s);
    P.hitLock = Math.max(P.hitLock || 0, HIT_LOCK);
    P.poiseT = s + HIT_POISE;
    P.hitN = (P.hitN || 0) + 1;
    if (CBZ.fpsHitTaken) CBZ.fpsHitTaken(opts);   // the first-person guard flinches
    return true;
  };

  /* The uppercut "launch" integrator (no caller left), the comic POW pop-up
     and the showHP meter no-ops are gone: a landed blow reads through the
     body it lands on (systems/verbs_strike.js + entities/meleeposes.js). */

  let combo = 0, lastPunch = -1e9, stamina = 1;

  function punchable(actor) {
    return !!(actor && actor.group && !actor.dead && !(actor.ko > 0) && !actor.escaped);
  }
  // who a swing with no named target may land on — the FIST decides which
  function candidates(out) {
    const add = (list) => { if (list) for (let i = 0; i < list.length; i++) if (punchable(list[i])) out.push(list[i]); };
    add(CBZ.guards); add(CBZ.npcs);
    return out;
  }
  const PA = { isPlayer: true, get pos() { return CBZ.player.pos; } };
  function playerActor() { return CBZ.verbs && CBZ.verbs.playerActor ? CBZ.verbs.playerActor() : PA; }

  function cameraFacingYaw() {
    if (!CBZ.cam) return CBZ.playerChar.group.rotation.y;
    return Math.atan2(-Math.sin(CBZ.cam.yaw), -Math.cos(CBZ.cam.yaw));
  }

  function downConsequences(actor, guardish) {
    if (actor.dead) return;
    actor.ko = guardish ? 16 : 10;
    actor.hp = Math.max(actor.hp || 0, guardish ? 55 : 45);
    CBZ.game.kos = (CBZ.game.kos || 0) + 1;
    CBZ.game.koLog[actor.data.name] = true;
    if (!guardish && actor.gang >= 0 && CBZ.noteGangIncident) CBZ.noteGangIncident(actor, "ko", 8, { source: "melee down" });
    if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(actor, "melee");
    if (CBZ.econ && CBZ.econ.lootActor) CBZ.econ.lootActor(actor, {}); // frisk the downed body
  }


  /* ============================================================
     THE SHANK (CBZ.CONFIG.PRISON_SHANK — set 0 and every line below falls
     back to the exact body this file shipped with).

     WHAT WAS HERE. One line, `11 + (hasItem("Shiv") ? 9 : 0)`. A shiv was a
     PASSIVE +82% on a bare-knuckle punch that you got for having one in the
     bag. You could not draw it, could not see it, could not drop it, and the
     hole it left was `melee:"blunt"` — a bruise. Half this prison walks around
     carrying one and not one of them has ever held it.

     WHY IT IS A `punch()` PROFILE AND NOT A SECOND FUNCTION. Everything a stab
     needs already lives in this file and is already right: the combo counter,
     the stamina curve, the deferred hit on the animation's drive frame, the
     arc/reach test, the miss, the block, the KO, the execution, the loot on the
     floor. A `stab()` that duplicated that would be a second melee system to
     keep in sync — which is how the city ended up with `weaponFeel()` while
     the prison ended up with a magic number. So the blade is a set of numbers
     `punch()` reads, taken from the weapon row itself (weapons/weapon-data.js
     `id:"shank"`) rather than typed here, and the four places a blade genuinely
     differs from a fist are the four `attack.blade` branches below:

       · it goes in the RIGHT hand, because that is the socket the model hangs
         off, and the animation is `punchKind:"stab"` (entities/character.js) —
         a chambered piston, not a swing;
       · it OPENS people: `melee:"blade"` makes wounds.js draw the slit instead
         of the bruise, and a blade kill hands gore.js the "stabbed" cause that
         throws its arterial arcs. Both of those have been in this engine for
         months with nothing in the prison able to reach them;
       · you cannot forearm-block a point the way you can block a fist, so the
         block roll drops from 0.16 to 0.06;
       · a shank does not knock men down, it puts them down. Less knockback,
         more damage, and the "heavy" beat is the DEEP one (every fourth), not
         a wind-up hook.
     ============================================================ */
  function shankOn() { return !CBZ.CONFIG || CBZ.CONFIG.PRISON_SHANK !== false; }

  // The tuning lives in the weapon row so the stash, the icon, the floor drop
  // and the hit all read one number. Falls back to the authored values if
  // weapon-data has not registered yet (headless gates build in odd orders).
  const BLADE_DEF = { damage: 26, range: 2.12, bleed: 0.55, headMult: 1.9, knock: 0.55 };
  function bladeSpec() {
    const w = CBZ.weaponById && CBZ.weaponById("shank");
    return w || BLADE_DEF;
  }

  // Is the player holding the shank RIGHT NOW — drawn, in hand, on screen?
  // `playerArmed()` is fpsmode's canonical "a weapon is out" and is the same
  // test holsterprops uses to decide whether to build the hand prop, so the
  // thing you stab with is by construction the thing you can see.
  function shankInHand() {
    if (!shankOn()) return false;
    if (!(CBZ.playerArmed && CBZ.playerArmed())) return false;
    const w = CBZ.equippedWeapon && CBZ.equippedWeapon();
    return !!(w && w.melee);
  }
  CBZ.prisonShankInHand = shankInHand;

  // the [3] Fight action, LMB and fpsmode's unarmed click route here. The
  // swing is a real strike (CBZ.verbs.strike); the blow lands on the frame
  // the fist reaches him, or it does not.
  // `opts.blade` runs the shank profile — fpsmode's shoot() sets it when the
  // drawn weapon is a melee row, which is the one place LMB is owned while a
  // weapon is out (the mousedown listener at the bottom of this file
  // deliberately stands down whenever playerArmed() is true).
  const BLADE_W = { kind: "shank", blade: true, mass: 0.2 };
  function punch(actor, opts) {
    const V = CBZ.verbs;
    const hasTarget = punchable(actor);
    if (actor && !hasTarget) return { ok: false, msg: "" };
    if (!V || !V.strike) return { ok: false, msg: "" };
    if (CBZ.player.dead || (CBZ.player.stun || 0) > 0 || (CBZ.player.hitLock || 0) > 0) return { ok: false, msg: "" };
    // Fists never stop working. Tired means WEAKER, not blocked — the damage
    // scales off stamina below, and the guard visibly drops (ch.winded).
    if (hasTarget && actor.hp == null) actor.hp = maxHpOf(actor);

    /* CUFFED (CBZ.arrest.playerCuffed): the hands are behind your back, so
       what leaves you is a FOOT. One front kick, no combo, no hook, no blade,
       off-balance: it lands softer than a fresh cross, costs more wind, and
       you cannot throw them back to back. */
    const cuffs = !!(CBZ.cuffedPlayer && CBZ.cuffedPlayer.on());
    if (cuffs && CBZ.now - lastPunch < 900) return { ok: false, msg: "" };
    const blade = !cuffs && !!(opts && opts.blade) && shankOn();
    const spec = blade ? bladeSpec() : null;

    const next = cuffs ? 1 : CBZ.now - lastPunch < 980 ? combo + 1 : 1;
    // A fist winds up every third beat into a hook. A shank has no wind-up —
    // its "heavy" is the DEEP one you get for staying on him, every fourth.
    const heavy = !cuffs && (blade ? next % 4 === 0 : next % 3 === 0);
    const kind = cuffs ? "kick" : blade ? "stab" : (heavy ? "hook" : (next % 2 ? "jab" : "cross"));
    // no man named: square up to where you are looking; the swing finds
    // whoever is actually there
    if (!hasTarget && CBZ.playerChar && CBZ.lerpAngle) {
      CBZ.playerChar.group.rotation.y = CBZ.lerpAngle(CBZ.playerChar.group.rotation.y, cameraFacingYaw(), 0.85);
    }
    /* THE BAG BUFF, RETIRED. A shiv in your pocket does not make your KNUCKLES
       harder; a shiv in the bag lets you DRAW it (systems/inventory.js hands
       the weapon row over on pickup). Bare fists are an honest 11.
       Flag off → the exact old expression. */
    const baseDmg = blade ? (spec.damage || BLADE_DEF.damage)
      : (shankOn() ? 11 : 11 + (CBZ.econ.hasItem("Shiv") ? 9 : 0));
    const cost = cuffs ? 0.30 : blade ? (heavy ? 0.20 : 0.13) : (heavy ? 0.34 : 0.22);
    const stam = Math.max(0, stamina - cost);
    const attack = {
      heavy, kind, blade,
      bleed: blade ? (spec.bleed || BLADE_DEF.bleed) * (heavy ? 1.5 : 1) : 0,
      // gassed punches land soft: 100% fresh down to 35% empty. A blade loses
      // only a third of its bite to a tired arm — steel does the work.
      dmg: baseDmg * (blade ? (heavy ? 1.55 : 1) : (heavy ? 1.8 : (kind === "cross" ? 1.16 : 1)))
        * (blade ? (0.66 + 0.34 * stam) : (0.35 + 0.65 * stam)) * (cuffs ? 0.9 : 1),
    };
    // a held point reaches further than a fist: the step in covers the rest
    const maxLunge = blade ? Math.max(0.75, (spec.range || BLADE_DEF.range) + (heavy ? 0.16 : 0) - 0.95) : 0.75;
    const S = V.strike(playerActor(), hasTarget ? actor : null, {
      kind, heavy, arm: blade ? "r" : undefined, speed: cuffs ? 0.8 : undefined,
      weapon: blade ? BLADE_W : null,
      candidates: hasTarget ? null : candidates,
      maxLunge,
      onLand: function (res) { landPunch(res, attack); },
      onBlocked: function (res) { blockedPunch(res, attack); },
      onWhiff: whiffPunch,
    });
    if (!S) return { ok: false, msg: "" };           // the last swing still owns the fists
    combo = next; lastPunch = CBZ.now; stamina = stam;
    CBZ.meleeFocusT = Math.max(CBZ.meleeFocusT || 0, heavy ? 0.85 : 0.62);
    // HE SEES IT COMING. A man you are squaring up to gets his hands up in
    // time for some of them — what was a 16% dice roll on the damage (6% for
    // a point) is now his forearms actually in front of his face: a head shot
    // lands on them, and a hook to the body or a shank low goes under.
    const T = S.aimT;
    if (T && !heavy && CBZ.econ.rng() < (blade ? 0.06 : 0.16)) V.block(T, 0.42);
    // a swing is a swing: systems/capture.js reads it as resisting an order
    CBZ.game._lawSwingT = CBZ.game.elapsed || 0;
    return { ok: true, msg: "" };
  }

  // WHO YOU HIT, AND WHERE, DECIDES WHAT IT COSTS THEM. `attack.dmg` is the
  // swing; res.dmgMul is where it landed (jaw 1.3, head 1, liver 1.25, body
  // 0.8, legs 0.6); systems/bodymass.js turns the two bodies into a ratio
  // (two adult men = 1.0).
  function hurtOf(res, attack, actor) {
    return attack.dmg * res.dmgMul * (CBZ.meleeScale ? CBZ.meleeScale(CBZ.player, actor) : 1);
  }
  function landPunch(res, attack) {
    const actor = res.target;
    if (!punchable(actor)) { res.reaction = "none"; return; }
    if (actor.hp == null) actor.hp = maxHpOf(actor);
    const heavy = attack.heavy;
    const blade = !!attack.blade;
    const guardish = actor.kind === "guard" || actor.kind === "warden";
    const dmg = hurtOf(res, attack, actor);
    actor.hp -= dmg;
    // YOU BEAT HIM TO THE PUNCH: verbs_strike has already cut his swing
    actor.hitCD = Math.max(actor.hitCD || 0, heavy ? 0.85 : 0.45);
    /* A PUNCH LEAVES NO MARK (owner, 2026-08-15: no purple bruise decal over
       clothes). A BLADE STILL CUTS: verbs_strike opens the wound at the real
       point the point went in (wounds.js melee:"blade"). */
    if (blade) { bladeWounds++; stabHits++; }
    /* IT KEEPS BLEEDING. Same `_bleed` field and drain rate the city uses,
       drained by this file's own tick below. */
    if (attack.bleed > 0) {
      actor._bleed = (actor._bleed || 0) + dmg * attack.bleed;
      actor._bleedSrcX = CBZ.player.pos.x;
      actor._bleedSrcZ = CBZ.player.pos.z;
      markBleeding(actor);
    }
    stamina = Math.min(1, stamina + 0.05);
    /* BLOOD IS EARNED, AND IT IS NOT A DICE ROLL (owner: "blood flying if it's
       a hard enough punch but no fake shit blood on every punch"). A HEAVY
       blow on a man already worn past half splits him — at the point the fist
       actually landed, flying the way it went. Repeatable, never rolled. */
    if (!blade && heavy && actor.hp > 0 && actor.hp < maxHpOf(actor) * 0.5) res.blood = 0.45;
    CBZ.sfx(blade ? "hit" : "punch");
    theLaw(actor, blade, guardish);
    if (actor.hp <= 0) {
      // EXECUTION when it's a heavy/combo finish; otherwise a clean KO: he goes
      // down for real (entities/meleeposes.js falls him; the ko timer holds him
      // there and he gets up when it runs out)
      const exec = heavy || combo >= 3 || CBZ.econ.rng() < 0.35;
      if (exec) { execute(actor, guardish, blade, res); return; }
      CBZ.sfx("ko"); downConsequences(actor, guardish);
      res.reaction = "knockdown";
      combo = 0;
    }
  }
  // his forearms took it: a chip through the guard, and you eat the rebound
  function blockedPunch(res, attack) {
    const actor = res.target;
    if (punchable(actor)) {
      if (actor.hp == null) actor.hp = maxHpOf(actor);
      actor.hp = Math.max(1, actor.hp - hurtOf(res, attack, actor));
      theLaw(actor, !!attack.blade, actor.kind === "guard" || actor.kind === "warden");
    }
    CBZ.player.hitLock = Math.max(CBZ.player.hitLock || 0, 0.30);
    CBZ.player.hitT = Math.max(CBZ.player.hitT || 0, 0.30);
    stamina = Math.max(0, stamina - 0.12);
    combo = 0;
    CBZ.sfx("hit");
  }
  // he was not there: the fist went through air (or he slipped it)
  function whiffPunch() {
    combo = 0;
    CBZ.player.hitLock = Math.max(CBZ.player.hitLock || 0, 0.10);
    CBZ.sfx("step");
  }
  /* THE LAW (systems/prisonlaw.js). Who you hit and who started it decide what
     it is: a screw is ASSAULT, always on file. A man who came for you and gets
     hit back is self-defence. Throwing first where a screw can see it is a
     FIGHT on file; steel in front of a screw is a serious one. */
  function theLaw(actor, blade, guardish) {
    const inPen = CBZ.game.mode === "escape" && CBZ.game.role !== "cop";
    const nowT = CBZ.game.elapsed || 0;
    const selfDefense = !guardish && (((actor.huntPlayer || 0) > 0) || (nowT - (actor._lawHitPlayerT || -1e9)) < 10);
    CBZ.reportCrime(7, { type: "melee", actorRole: CBZ.game.role, selfDefense: selfDefense && !blade });
    if (inPen) {
      if (guardish) {
        if (CBZ.prisonOffense) CBZ.prisonOffense("assault", { seenBy: actor, severity: blade ? 4 : 3 });
      } else {
        if (CBZ.prisonLawNoteBlow) CBZ.prisonLawNoteBlow("player", actor);
        if (blade && CBZ.prisonOffense && CBZ.guardWatching) {
          let w = null;
          try { w = CBZ.guardWatching(CBZ.player.pos.x, CBZ.player.pos.y || 0, CBZ.player.pos.z); } catch (e) { w = null; }
          if (w) CBZ.prisonOffense("fight", { seenBy: w, severity: 3 });
        }
      }
    }
    if (guardish) actor.hunt = 3; else if (CBZ.provokeGang) CBZ.provokeGang(actor, 12);
  }

  // THE BLOW THAT ENDS IT. It is the blow that just landed — no second swing
  // re-played over it — held in a beat of slow motion. The punch that ends it
  // bleeds (a blade's death spray is the arterial one aiKill routes).
  function execute(actor, guardish, blade, res) {
    if (blade) stabKills++;
    CBZ.meleeFocusT = Math.max(CBZ.meleeFocusT || 0, 1.0);
    CBZ.doHitstop(blade ? 0.11 : 0.14);
    CBZ.doSlowmo(0.5);
    CBZ.shake(blade ? 0.55 : 0.85);
    CBZ.sfx("ko");
    if (!blade) res.blood = 1.1;
    res.reaction = "dead";                           // prisoncorpse / aiKill own the body now
    // `melee:"blade"` turns gore.js's death spray into the ARTERIAL one
    if (CBZ.aiKill) CBZ.aiKill(actor, { group: CBZ.playerChar.group }, { noKnock: true, melee: blade ? "blade" : null });
    else { actor.dead = true; actor.ko = 0; actor.hp = 0; }
    if (CBZ.game.koLog && actor.data) CBZ.game.koLog[actor.data.name] = true;
    if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(actor, "melee");
    combo = 0;
  }

  /* ---------- BLEEDING OUT ----------
     The drain for the `_bleed` landPunch stacks. Deliberately the same field
     and the same 6/s drain rate city/combat.js:1029 already uses, so "bleeding"
     means one thing in this game rather than two — the only difference is that
     the city time-slices across a crowd of hundreds and this walks a list of
     the handful of people you have actually stuck.

     A bled-out man dies of the wound, through the SAME aiKill choke point a
     stab-to-death uses, carrying the same "blade" cause — so he sprays
     arterially, drops his pockets on the floor, and reaches the killfeed. He
     just does it thirty seconds later, in a corridor, on his own. */
  const bleeders = [];
  function markBleeding(a) { if (a && bleeders.indexOf(a) < 0) bleeders.push(a); }
  function tickBleed(dt) {
    for (let i = bleeders.length - 1; i >= 0; i--) {
      const a = bleeders[i];
      if (!a || a.dead || a.escaped || !(a._bleed > 0)) {
        if (a) a._bleed = 0;
        bleeders.splice(i, 1);
        continue;
      }
      const tick = Math.min(a._bleed, 6 * dt);
      a._bleed -= tick;
      if (a.hp == null) a.hp = maxHpOf(a);
      a.hp -= tick;
      if (a.hp <= 0) {
        a._bleed = 0;
        bleeders.splice(i, 1);
        bledOut++;
        if (CBZ.aiKill) CBZ.aiKill(a, { group: CBZ.playerChar && CBZ.playerChar.group }, { noKnock: true, melee: "blade" });
        else { a.dead = true; a.hp = 0; a.ko = 0; }
      }
    }
  }

  CBZ.onUpdate(58, function (dt) {
    tickBleed(dt);
    stamina = Math.min(1, stamina + dt * 0.42);
    /* STAMINA GETS A BODY. This value gated every punch and lived and died
       inside this file — nothing read it, nothing drew it, and the bar in
       #survBars is display:none outside survival/gungame. Publishing it as
       `winded` (0 fresh → 1 gassed) lets entities/character.js's fight stance
       drop the guard, slow the weave and start the chest heaving, which is
       what the deleted "Catch your breath." was standing in for. The ramp
       starts at the same 0.45 the punch gate lives under, so the guard is
       already visibly sagging by the time the fists actually refuse. */
    const ch = CBZ.playerChar;
    if (ch) ch.winded = Math.min(1, Math.max(0, 1 - stamina));
  });

  CBZ.punch = punch;
  // THE one entry point for a shank thrust. fpsmode's shoot() calls this the
  // moment the drawn weapon's row says `melee`, instead of reaching for a
  // magazine. Nothing else in the tree needs to know a blade exists.
  CBZ.prisonStab = function (actor) { return punch(actor, { blade: true }); };

  /* ---------- THE COMPLAINT, AS NUMBERS ----------
     The owner's note was "shanks aren't actually a thing that you physically
     have and can stab people with", and every clause of that is countable.
     Read live, at the instant of capture, by tools/visual-presets/prison-shank.mjs.

       carried        — living actors whose rolled loadout holds a Shiv. This
                        does not move: the loot tables were always right, and
                        that is the point. ~half the wing walks around with one.
       heldPhysical   — of those, how many have the blade as a real MESH in a
                        real hand socket. Was structurally 0: no actor in this
                        mode has ever been given `weapon:"Shiv"`.
       drawable       — can the PLAYER draw it? `unlockWeapon("shank")` has to
                        resolve against a weapon row for this to be 1.
       modelIsPistol  — actorweapons' normalizeWeaponId() answers "sidearm" for
                        any name it does not know, so before the NAME_TO_ID rows
                        landed, asking the game for a shiv's model handed back a
                        9 mm. 1 = the blade is literally a gun.
       phantomBuff    — is the shiv still a passive +9 on a bare fist you never
                        draw? 1 = the old body (PRISON_SHANK=0).
       stabHits/stabKills/bledOut/bladeWounds — a stab actually happening. All
                        four are structurally 0 before this pass because there
                        was no stab to count. */
  let stabHits = 0, stabKills = 0, bledOut = 0, bladeWounds = 0;
  CBZ.prisonShankAudit = function () {
    let carried = 0, carriedRoster = 0, heldPhysical = 0;
    const scan = (list) => {
      for (let i = 0; i < (list || []).length; i++) {
        const a = list[i];
        if (!a) continue;
        const ld = a.loadout || (CBZ.econ && CBZ.econ.rollLoadout ? CBZ.econ.rollLoadout(a) : null);
        const items = (ld && ld.items) || [];
        if (items.indexOf("Shiv") < 0 && items.indexOf("Shank") < 0) continue;
        /* TWO counts, because they answer two different questions.
           `carriedRoster` is what the LOOT TABLES did — every man in the cast
           they put a blade on, alive or not. It is a fact about
           systems/economy.js's rollLoadout and it cannot wobble.
           `carried` is how many of them are still breathing, which drifts with
           whatever has happened in the yard — useful live, useless as the
           headline of an A/B, because two runs of a living prison do not kill
           the same men and the number that is not supposed to move appears to. */
        carriedRoster++;
        if (a.dead) continue;
        carried++;
        const prop = a._weaponProp;
        if (prop && prop.visible && prop.userData && prop.userData.weaponId === "shank") heldPhysical++;
      }
    };
    scan(CBZ.npcs); scan(CBZ.guards);
    const row = CBZ.weaponById && CBZ.weaponById("shank");
    const modelId = CBZ.weaponIdFromName ? CBZ.weaponIdFromName("Shiv") : "sidearm";
    return {
      carried, carriedRoster, heldPhysical,
      // "Can the player draw it" — which needs the weapon row to EXIST and the
      // feature to be on. Reported as `row ? 1 : 0` this read 1 on both sides
      // of the A/B, because reverting the flag cannot un-register a table
      // entry; a metric that cannot move is not evidence of anything.
      drawable: (row && shankOn()) ? 1 : 0,
      modelIsPistol: modelId === "sidearm" ? 1 : 0,
      phantomBuff: shankOn() ? 0 : 1,
      inHandNow: shankInHand() ? 1 : 0,
      stabHits, stabKills, bledOut, bladeWounds,
    };
  };

  // LEFT-CLICK to throw a punch (prison mode). Melee is a direct action now,
  // not a numbered row in the social menu — click to swing, chain for combos.
  // Gated so it never steps on the things that already own the left button:
  //   • survival mode  → grapple.js owns LMB (punch/throw there)
  //   • first-person   → fpsmode owns LMB (shoot / FPS-punch)
  //   • armed          → LMB fires the gun (over-the-shoulder)
  // Requires pointer-lock so the click that re-grabs the cursor doesn't swing.
  addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (CBZ.islandModeOn(CBZ.game.mode)) return;
    if (CBZ.game.state !== "playing" || !document.pointerLockElement) return;
    if (CBZ.fps && CBZ.fps.active) return;
    if (CBZ.playerArmed && CBZ.playerArmed()) return;
    // cuffed: the click is a kick (punch() above); held: the click is a
    // wrench against his grip (verbs.js)
    if (CBZ.verbs && CBZ.verbs.playerHeld && CBZ.verbs.playerHeld()) return;
    punch();   // the swing is the feedback; there is no line left to print
  });
})();
