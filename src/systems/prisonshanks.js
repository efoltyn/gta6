/* ============================================================
   systems/prisonshanks.js — the blades the wing was already carrying.

   THE COMPLAINT. Roughly half the men in this prison have a Shiv in their
   rolled loadout (systems/economy.js's rollLoadout: 0.6 for a fighter above
   72, 0.3 above 50, 0.55 for a predator/bully, 0.4 for anyone in a gang —
   ~20 of the 40-man cast at any moment). Not one of them had ever held it.
   The item existed only as a string in a pocket you could frisk, so the yard
   looked like forty men with nothing on them, and the one mechanical trace of
   all that steel was +9 on the PLAYER's bare-knuckle punch.

   WHAT THIS FILE OWNS, and nothing else:
     · WHO is carrying — read from the loadout, never re-rolled here. The
       tables were always right; they were just never believed;
     · WHEN it comes out. A shank is a CONCEALED weapon and that is its whole
       nature — a wing where twenty men walk to breakfast with blades on show
       is not a prison, it is a costume party. It appears when a man commits
       to violence and goes away when he doesn't, which also makes the draw
       itself the tell you get to read across a yard;
     · HOW it is held, every frame. systems/actorweapons.js's self-heal pass
       is `mode === "city"` only (poseList, actorweapons.js:842) — in escape
       NOTHING re-poses a carried weapon, which is the trap commit d82675d
       had to dig the taser out of. So the carry is re-asserted here on
       onAlways(53), after the guard/NPC updates have run animChar.

   WHAT IT DELIBERATELY DOES NOT DO. It never sets `hasGun`. A man with a
   shank is not a man with a gun, and systems/intimidate.js reads that flag to
   decide whether someone at gunpoint surrenders or draws — telling it a blade
   is a firearm would have every shank-carrier in the wing answering a pistol
   like he could win. `armed` IS set, because that is the pair
   syncActorWeapon reads to show a model at all, and because
   systems/reactions.js keys `gunArm` off it to stop a flinch stealing the arm
   that is holding the weapon.

   CBZ.CONFIG.PRISON_SHANK = 0 disables the file wholesale: no draws, no
   poses, no props, and the arm falls back to animChar on the next frame for
   free (this only ever WRITES a pose, it never owns one).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  function enabled() { return !CBZ.CONFIG || CBZ.CONFIG.PRISON_SHANK !== false; }

  // How far a carrier will pull it out for. Sticky in the same shape the guard
  // torch uses (IN < OUT): a blade that flickers in and out of a fist as a man
  // drifts across one threshold is worse than one that is simply late.
  const DRAW_R = 9.0;
  const STOW_R = 13.0;
  const DRAW_DELAY = 0.22;   // s — the reach into the waistband is not instant
  const BLEND_S = 0.20;      // s — how long the carry takes to own the arm

  let drawn = 0, carriers = 0, draws = 0;

  /* READ ONLY. Deliberately does NOT fall back to CBZ.econ.rollLoadout(): that
     call MINTS a loadout, and minting draws from the shared seeded rng. A
     per-frame scan that mints is a scan that shifts every later roll in the
     run — which showed up as the flag A/B disagreeing by one carrier, because
     the off-side never ran this loop and therefore never forced the mint. The
     loadouts are minted for the whole cast on the first tick (economy.js's
     mintLoadouts), long before anyone is close enough to draw, so reading the
     field is not a loss of coverage — only of a side effect. */
  function carriesShank(n) {
    const items = (n.loadout && n.loadout.items) || null;
    if (!items) return false;
    return items.indexOf("Shiv") >= 0 || items.indexOf("Shank") >= 0;
  }

  /* Is this man in a fight RIGHT NOW? Every one of these is an existing AI
     state written by entities/ai.js — no new brain, no new flag to keep in
     sync. `huntPlayer` is coming for you, `foe` is an inmate-on-inmate beef,
     "fight"/"attack" are the states the brawl director parks them in. */
  function committed(n) {
    if (n.dead || n.ko > 0 || n.escaped || n.cuffed) return false;
    if (n.huntPlayer > 0) return true;
    if (n.foe && !n.foe.dead) return true;
    return n.aiState === "fight" || n.aiState === "attack";
  }

  function nearPlayer(n, r) {
    if (!CBZ.player || !n.group) return false;
    const dx = n.group.position.x - CBZ.player.pos.x;
    const dz = n.group.position.z - CBZ.player.pos.z;
    return dx * dx + dz * dz <= r * r;
  }

  /* THE CARRY. One arm, one shoulder and one elbow, eased in and then held.

     The pose is a LOW READY, not a presentation. `CBZ.actorReadyPose` is
     deliberately not used: setReadyPose puts BOTH hands on the object because
     every weapon it has ever posed was a firearm, and a two-handed shank is a
     man praying with a screwdriver. This is one hand, at the belt, blade
     forward along the forearm and canted across the body — where you hold a
     thing you can put into someone without winding up. */
  function carry(n, dt) {
    const ch = n.char;
    if (!ch || !ch.parts || !ch.parts.ra) return;
    // Tell the rig a blade is out BEFORE bailing on a live thrust: the flag is
    // what keeps entities/character.js's boxing fightStance off this body, and
    // that has to hold through the swing too or the guard pops back between hits.
    ch.bladeCarry = true;
    /* HANDS UP MEANS BOTH HANDS. A man with a gun on him who is complying
       raises TWO arms, and entities/character.js's surrender layer owns them
       both while `ch.handsUp` is set. This pass runs from `always`, after
       every updater, so a blind write here beat that layer on the weapon arm
       only — one hand overhead, one hand down at the belt still holding the
       shiv. That is the exact two-writers-one-arm bug this file's own carry
       comment warns about, committed by this file.

       The resolution below (`gunpoint`) normally means there is no blade in
       the hand to pose by the time a surrender starts. This guard is the
       belt-and-braces for every path that does not go through it — cuffed,
       seized, or a surrender raised by some future system. */
    if (ch.handsUp || ch.surrender || ch.cuffed) return;
    // The stab owns the arm outright while it is running (character.js's punch
    // block hard-assigns it). Writing over a live thrust would flatten it into
    // a twitch — this is the two-writers-one-arm bug that d82675d unpicked.
    if (ch.punchT > 0 || ch.koT > 0 || ch.koPose || ch.staggerT > 0) return;
    /* THIS POSE OWNS THE ARM, and it has to. The first authoring damped
       toward the target at ~20%/frame, which is what the guard-torch carry
       does — but that one runs INSIDE the guard's own update, immediately
       after animChar, with nothing writing the arm behind it. This pass runs
       from `always`, after every updater, and something upstream hard-assigns
       this shoulder every frame; a 20% pull toward a target simply reaches an
       EQUILIBRIUM a fifth of the way there and sits at somebody else's pose.
       (Measured: target -0.30, actual -0.554 — the arm was still at chest
       height with the blade beside his ear.)

       So `blend` ramps 0 -> 1 over BLEND_S and is then used as the lerp factor
       itself: the draw eases in over a fifth of a second and from then on this
       is a hard assignment, which is exactly how character.js's own punch and
       actorweapons' setReadyPose write arms. Reset on stow, so the next draw
       eases in again. */
    n._shankBlend = Math.min(1, (n._shankBlend || 0) + (dt || 1 / 60) / BLEND_S);
    const r = ch.parts.ra.rotation;
    const k = n._shankBlend;
    /* MEASURED, not guessed. On this rig `parts.ra.rotation.x` is NEGATIVE
       toward the front — character.js's jab drives to about -1.42 and calls
       that "chin height of a same-size opponent". So the first authoring here
       (-0.74 with the elbow folded to -0.98) was not the low carry its comment
       claimed: it put the fist at chest height with the forearm stacked
       upright, and the storyboard came back with a man holding a shiv beside
       his own ear. Half the shoulder travel and a much softer elbow puts the
       hand at the belt with the point angled forward — where a man who means
       to use it actually holds one, and where he can drive it without
       telegraphing across a yard. */
    r.x += (-0.30 - r.x) * k;
    r.y += (0.16 - r.y) * k;
    r.z += (0.32 - r.z) * k;
    const low = ch.parts.ra.userData && ch.parts.ra.userData.low;
    if (low) low.rotation.x += (-0.70 - low.rotation.x) * k;
  }

  function stow(n) {
    if (n.char) n.char.bladeCarry = false;
    if (!n._shankOut) return;
    n._shankOut = false;
    n._shankT = 0;
    n._shankBlend = 0;
    n.armed = false;
    if (n._weaponProp) n._weaponProp.visible = false;
    // Hand the name back so nothing downstream thinks he is still holding it.
    if (n._shankWeaponMine) { n.weapon = null; n._shankWeaponMine = false; }
  }

  function draw(n) {
    // NEVER take a fist off a man who already has something in it. If he is
    // holding a real gun (prisondrops' floor pickup can arm an inmate), that
    // outranks a blade and this file stays out of his hand entirely.
    if (n.hasGun) return false;
    n.weapon = "Shiv";
    n._shankWeaponMine = true;
    n.armed = true;
    n._holstered = false;
    n._gunLowered = false;
    n._gunHidden = false;
    if (CBZ.syncActorWeapon) { try { CBZ.syncActorWeapon(n); } catch (e) { return false; } }
    if (!n._shankOut) {
      draws++;
      if (CBZ.worldSfx && n.group) {
        try { CBZ.worldSfx("switch", n.group.position.x, n.group.position.z, { ref: 8 }); } catch (e) {}
      }
    }
    n._shankOut = true;
    return true;
  }

  function step(dt) {
    drawn = 0; carriers = 0;
    if (!enabled() || !CBZ.game || CBZ.game.mode !== "escape") return;
    const list = CBZ.npcs || [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!n || !n.group || !n.char) continue;
      if (n.dead) { if (n._shankOut) stow(n); continue; }
      if (!carriesShank(n)) continue;
      carriers++;
      // A gun in the hand always wins; if something armed him for real while
      // his blade was out, give the arm back rather than fighting over it.
      if (n.hasGun) { if (n._shankOut) stow(n); continue; }
      const want = committed(n) && nearPlayer(n, n._shankOut ? STOW_R : DRAW_R);
      if (!want) { stow(n); continue; }
      n._shankT = (n._shankT || 0) + dt;
      if (n._shankT < DRAW_DELAY) continue;
      if (!draw(n)) continue;
      carry(n, dt);
      drawn++;
    }
  }

  /* ============================================================
     A KNIFE AT A GUNFIGHT (CBZ.CONFIG.PRISON_SHANK_GUNPOINT, =0 and a man
     with a blade answers a gun exactly as an empty-handed one does).

     THE BUG THAT STARTED IT. Point a gun at a man holding a shank and he put
     ONE hand up. The other stayed at his belt, still holding it, because this
     file kept writing the weapon arm straight through
     entities/character.js's surrender layer. The pose guard in carry() above
     stops that — but a guard alone would only have produced a man with both
     hands up and a blade still in his fist, which is not a surrender either.
     What was missing is the DECISION: a man with a weapon in his hand and a
     muzzle in his face has to do something with it.

     THREE ANSWERS, AND THEY ARE NOT A COIN FLIP. systems/intimidate.js already
     decides draw-vs-surrender from stats, and its header carries the owner's
     own note: "i hold a gun at you far away you raise your hands or charge at
     me or run away USUALLY RAISE HANDS." Charge was never built — `decideGun`
     returns false, so in the prison every single man surrendered and the
     defiance branch was dead code. The shank is the weapon that makes charging
     mean something, so it is the weapon that brings it back:

       DROP   he lets go of it. It hits the concrete as a real prop you can
              walk over and take — so pointing a gun at armed men is how you
              disarm a wing, and a frightened man is visibly different from a
              merely compliant one.
       STOW   into the waistband, hands up clean. He complies and KEEPS it,
              which matters the moment you lower the gun.
       CHARGE he doesn't comply at all. He closes with it out.

     WHY DISTANCE IS A GATE AND NOT A TERM. This is the whole "knife to a
     gunfight" question and it deserves a hard edge rather than a soft one. A
     blade inside a few metres is a genuine bet — the gun has to be on target
     and the trigger has to break before he arrives. At ten metres it is
     suicide and every man in this yard knows it. Written as one more weighted
     term it would smear into noise and the player would read it as randomness;
     written as a gate it is a LEVER he can learn: back up and the wing
     complies, crowd them and the hard ones come. A taser widens the gate,
     because against a taser a shank is a genuinely good trade.

     NO rng() IN ANY OF THIS. Same man, same stats, same range, same answer —
     every time, so the yard is something you can learn to read rather than
     something you gamble against.
     ============================================================ */
  /* MEASURED AGAINST THE REAL CAST, not guessed. The first authoring set
     these at 0.58 / 0.30 on intuition, and CBZ.prisonShankSteel's histogram
     immediately showed what that bought: this roster's steel runs ~0.38-0.75
     against a levelled gun, so 0.58 sat below the middle (most of the wing
     charged) and 0.30 sat below the FLOOR — the drop branch was unreachable
     and no man ever let go of anything. A stats rule whose thresholds live
     outside the stats' actual range is a distance rule wearing a costume.
     Placed now at roughly the top sixth and the bottom quarter of the real
     distribution, which is what the owner's "USUALLY RAISE HANDS" asks for:
     most comply, a hard minority comes, a frightened minority disarms. */
  const CHARGE_STEEL = 0.68;   // above this he comes, if he is close enough
  const DROP_STEEL = 0.45;     // below this he lets go of it
  const CHARGE_R_LETHAL = 4.2; // m — inside this a blade beats a levelled gun
  const CHARGE_R_TASER = 6.5;  // m — and a taser is a much worse thing to hold

  let gpCharge = 0, gpStow = 0, gpDrop = 0;

  function gunpointEnabled() {
    return enabled() && (!CBZ.CONFIG || CBZ.CONFIG.PRISON_SHANK_GUNPOINT !== false);
  }

  /* HOW MUCH FIGHT HE HAS IN HIM, right now, 0..1. Stats carry ~70% of the
     weight (the owner's call: "based not on random but on stats and
     relationship... mostly stats"); the relationship terms move it at the
     margin, and what you have already done to him moves it hardest of all —
     a man you have shot once does not try you twice. */
  function steelOf(n, lethal) {
    const p = n.personality || {}, r = n.ratings || {};
    const nerve = p.nerve != null ? p.nerve : 0.5;
    const fight = Math.max(0, Math.min(1, (r.fighting || 40) / 100));
    const beh = CBZ.BEHAVIORS && CBZ.BEHAVIORS[n.behavior];
    const guts = beh && beh.guts != null ? beh.guts : 0.4;
    const maxHp = n.maxHp || 100;
    const hurt = Math.max(0, Math.min(1, 1 - (n.hp == null ? maxHp : n.hp) / maxHp));

    let s = 0.10
      + nerve * 0.30              // the single biggest stat: is he a nervy man
      + fight * 0.22              // and can he actually do anything about it
      + guts * 0.18;              // temperament — a pacifist never comes
    s += Math.min(14, n.playerGrudge || 0) * 0.030;   // he wants YOU specifically
    s -= Math.min(14, n.playerFear || 0) * 0.045;     // you have hurt him before
    if (nearbyCrew(n)) s += 0.10;                     // folding in front of the crew
    if (n.isLeader) s += 0.06;                        // costs a leader the most
    s -= hurt * 0.30;                                 // a wounded man complies
    if (n._bleed > 0) s -= 0.12;                      // and a leaking one folds
    // A taser is a much better thing to face with a blade — but this used to
    // add 0.22, which lifted the ENTIRE cast over the charge line and made
    // "you're only holding a taser" mean "everyone charges you". The honest
    // lever for a taser is REACH (CHARGE_R_TASER, well over half again the
    // lethal gate), not turning every man in the yard into a hard case.
    if (!lethal) s += 0.12;
    return Math.max(0, Math.min(1, s));
  }

  // Any living crewmate close enough to be watching him fold.
  function nearbyCrew(n) {
    if (n.gang == null || n.gang < 0) return false;
    const list = CBZ.npcs || [];
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || m === n || m.dead || m.ko > 0 || m.gang !== n.gang || !m.group) continue;
      const dx = m.group.position.x - n.group.position.x;
      const dz = m.group.position.z - n.group.position.z;
      if (dx * dx + dz * dz < 64) return true;   // 8 m
    }
    return false;
  }

  /* Called by systems/intimidate.js the once, at first contact, before it
     decides anything of its own. Returns the mode it chose, or null if this
     man has no blade to have an opinion about. Does the stow/drop itself —
     intimidate owns the man's REACTION, this file owns his WEAPON. */
  CBZ.prisonShankGunpoint = function (n, opts) {
    opts = opts || {};
    if (!gunpointEnabled() || !n || !n.group) return null;
    if (n.hasGun) return null;                 // a real gun outranks the blade
    if (!carriesShank(n) && !n._shankOut) return null;
    const lethal = opts.lethal !== false;
    const dist = opts.dist != null ? opts.dist : (CBZ.player
      ? Math.hypot(n.group.position.x - CBZ.player.pos.x, n.group.position.z - CBZ.player.pos.z)
      : 99);
    const steel = steelOf(n, lethal);
    n._shankSteel = steel;                     // published for the audit/storyboard

    if (steel >= CHARGE_STEEL && dist <= (lethal ? CHARGE_R_LETHAL : CHARGE_R_TASER)) {
      // He is not putting it away and he is not putting his hands up. The
      // brain already knows how to close on you and swing — entities/ai.js
      // reads huntPlayer — and `committed()` above reads the same field, so
      // the blade comes out and STAYS out for free. No new movement code.
      n.huntPlayer = Math.max(n.huntPlayer || 0, 9);
      n._shankT = DRAW_DELAY;                  // he is already reaching
      if (n.char) { n.char.handsUp = false; n.char.surrender = false; }
      gpCharge++;
      n._shankGunpoint = "charge";
      return "charge";
    }

    if (steel <= DROP_STEEL) {
      // It goes on the floor, as a real object. Tossed a little away from his
      // feet so it does not land inside his shoes, and toward the man holding
      // the gun, which is where you throw a thing you want seen being dropped.
      const wasOut = !!n._shankOut;
      stow(n);
      if (CBZ.prisonDropOne && (wasOut || carriesShank(n))) {
        const g = n.group.position;
        const toPlayer = CBZ.player
          ? Math.atan2(CBZ.player.pos.x - g.x, CBZ.player.pos.z - g.z) : 0;
        try {
          CBZ.prisonDropOne("Shiv", g.x, 0.95, g.z, { dir: toPlayer, speed: 0.85, up: 0.6 });
        } catch (e) {}
        // the object left him, so his pockets must agree
        const ld = n.loadout;
        if (ld && ld.items) {
          const i = ld.items.indexOf("Shiv");
          if (i >= 0) ld.items.splice(i, 1);
        }
        if (CBZ.worldSfx) {
          try { CBZ.worldSfx("switch", g.x, g.z, { ref: 7 }); } catch (e) {}
        }
      }
      gpDrop++;
      n._shankGunpoint = "drop";
      return "drop";
    }

    stow(n);
    gpStow++;
    n._shankGunpoint = "stow";
    return "stow";
  };

  // intimidate.js hands the encounter back when you look away.
  CBZ.prisonShankGunpointEnd = function (n) {
    if (n) n._shankGunpoint = null;
  };

  /* Read-only: what WOULD this man do, without making him do it. Exists so the
     thresholds can be surveyed against the real cast rather than guessed at —
     a spread that comes back all-drop or all-charge is a tuning failure you
     want to see as a histogram, not discover in the yard. */
  CBZ.prisonShankSteel = function (n, lethal, dist) {
    if (!n) return null;
    const s = steelOf(n, lethal !== false);
    const gate = (lethal !== false) ? CHARGE_R_LETHAL : CHARGE_R_TASER;
    const d = dist == null ? 0 : dist;
    return {
      steel: s,
      would: (s >= CHARGE_STEEL && d <= gate) ? "charge" : (s <= DROP_STEEL ? "drop" : "stow"),
      inRange: d <= gate,
    };
  };

  if (CBZ.onAlways) CBZ.onAlways(53, step);

  /* The complaint as a number, for tools/visual-presets/prison-shank.mjs.
     `carrying` is what the loot tables always said; `holding` is how many of
     those blades are geometry in a hand this frame. Before this file the second
     number was structurally zero — there was no code path that could raise it. */
  /* THE COMPLAINT, COUNTED: men whose hands are going up while a blade is
     still posed in one of them. Reads the RIG, not a flag — `handsUp` is what
     character.js's surrender layer keys off, and a visible weapon prop on the
     same body is the contradiction the owner watched happen. */
  function oneHandUpNow() {
    let bad = 0;
    const list = CBZ.npcs || [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!n || n.dead || !n.char) continue;
      if (!(n.char.handsUp || n.char.surrender)) continue;
      const p = n._weaponProp;
      if (p && p.visible && p.userData && p.userData.weaponId === "shank") bad++;
    }
    return bad;
  }

  CBZ.prisonShankCarryAudit = function () {
    let carrying = 0, holding = 0, posed = 0;
    const list = CBZ.npcs || [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!n || n.dead || !carriesShank(n)) continue;
      carrying++;
      if (!n._shankOut) continue;
      holding++;
      const prop = n._weaponProp;
      if (prop && prop.visible && prop.userData && prop.userData.weaponId === "shank") posed++;
    }
    return {
      carrying, holding, posed, drawnThisFrame: drawn, scanned: carriers, draws,
      // What men with blades did about the gun in their face. `oneHandUp` is
      // the original complaint reduced to a number: a man mid-surrender with
      // the shank still posed in his weapon hand. It is structurally 0 now —
      // the pose yields to handsUp, and the decision empties the hand first.
      gunpointCharge: gpCharge, gunpointStow: gpStow, gunpointDrop: gpDrop,
      oneHandUp: oneHandUpNow(),
    };
  };
})();
