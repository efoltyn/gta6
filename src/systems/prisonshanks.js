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

  if (CBZ.onAlways) CBZ.onAlways(53, step);

  /* The complaint as a number, for tools/visual-presets/prison-shank.mjs.
     `carrying` is what the loot tables always said; `holding` is how many of
     those blades are geometry in a hand this frame. Before this file the second
     number was structurally zero — there was no code path that could raise it. */
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
    return { carrying, holding, posed, drawnThisFrame: drawn, scanned: carriers, draws };
  };
})();
