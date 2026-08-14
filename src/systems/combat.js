/* ============================================================
   systems/combat.js — dramatic melee.

   A punch is anticipation→thrust→recovery (character.js animates the
   arm; we alternate left/right jabs). On contact we stack the juice
   the research calls for: HIT-STOP, screen SHAKE, KNOCKBACK, an impact
   SPARK, a comic POW pop-up, and a punchy sound — all on one frame.

   Chain hits to build a COMBO. When a hit would drop someone, a
   combo/heavy turns it into a cinematic EXECUTION: slow-motion, a
   rising UPPERCUT that launches them off their feet, a huge "K.O."
   and a hard camera shake. Enemies show a floating health bar while
   you're working them over.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const scene = CBZ.scene;
  const nm = (a) => a.data.name.replace(/^the |^a |^an /, "");
  const maxHpOf = (a) => (a.kind === "guard" || a.kind === "warden" ? 140 : 100);

  /* ---------- impact spark ---------- */
  const sc = document.createElement("canvas"); sc.width = sc.height = 64;
  const sx = sc.getContext("2d");
  const grd = sx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.4, "rgba(255,225,120,.9)");
  grd.addColorStop(1, "rgba(255,150,40,0)");
  sx.fillStyle = grd; sx.fillRect(0, 0, 64, 64);
  const sparkTex = new THREE.CanvasTexture(sc);
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
  spark.visible = false; scene.add(spark);
  let sparkLife = 0;
  function flashSpark(actor, big) {
    spark.position.set((CBZ.player.pos.x + actor.group.position.x) / 2, 1.6, (CBZ.player.pos.z + actor.group.position.z) / 2);
    spark.scale.setScalar(big ? 2.6 : 1.6);
    spark.material.opacity = 1; spark.visible = true; sparkLife = 0.16;
  }

  /* FLOATING HEALTH BAR OVER PEOPLE: DELETED.

     A green-to-red meter pinned above whoever you were punching, drawn with
     depthTest:false so it hung through walls, for three seconds after every
     hit. It is the same object as the emoji this wave just removed and the
     "love 47%" chip interact.js already deleted with the note "NO METERS ON A
     PERSON" — a number about somebody printed beside their face.

     A beaten man already reads without it: systems/reactions.js flinches and
     staggers him, gore.js bleeds him, wound decals accumulate on the body
     (guard._woundN), the knockback moves him and he goes down when he is
     done. That IS the health bar, drawn on the person instead of above him.

     showHP() stays as a no-op so the four call sites keep working. */
  function showHP() {}

  // The impact spark shared the deleted bar's tick — it still needs one, or it
  // flashes on at the first punch and hangs there for the rest of the run.
  CBZ.onAlways(59, function (dt) {
    if (sparkLife <= 0) return;
    sparkLife -= dt;
    spark.material.opacity = Math.max(0, sparkLife / 0.16);
    spark.scale.multiplyScalar(1 + dt * 6);
    if (sparkLife <= 0) spark.visible = false;
  });

  /* ---------- launched bodies (uppercut pop-up) ---------- */
  const flying = [];
  function launch(actor, vy) { actor._lvy = vy; if (flying.indexOf(actor) < 0) flying.push(actor); }
  CBZ.onUpdate(33, function (dt) {
    for (let i = flying.length - 1; i >= 0; i--) {
      const a = flying[i];
      a._lvy -= 22 * dt;
      a.group.position.y += a._lvy * dt;
      if (a.group.position.y <= 0) { a.group.position.y = 0; a._lvy = 0; flying.splice(i, 1); }
    }
  });

  /* ---------- comic pop-up ---------- */
  const hitEl = document.getElementById("hitfx");
  const WORDS = ["POW!", "BAM!", "SMACK!", "CRUNCH!", "THWACK!"];
  // comic "POW!/BAM!" pop-ups removed — melee now reads as real impact
  // (knockback + flinch + blood + hitstop), not a cartoon. Kept as a no-op
  // so existing call sites stay valid.
  function popup() {}

  let combo = 0, lastPunch = -1e9, pendingPunch = null, stamina = 1;

  function punchable(actor) {
    return !!(actor && actor.group && !actor.dead && !(actor.ko > 0) && !actor.escaped);
  }

  function facingYawTo(actor) {
    const dx = actor.group.position.x - CBZ.player.pos.x;
    const dz = actor.group.position.z - CBZ.player.pos.z;
    return Math.atan2(dx, dz);
  }

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

  function inPunchArc(actor, attack) {
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;
    const dx = actor.group.position.x - px, dz = actor.group.position.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > (attack.reach || (attack.heavy ? 3.15 : 2.85)) || d < 0.2) return false;
    const dot = (Math.sin(attack.yaw) * dx + Math.cos(attack.yaw) * dz) / d;
    return dot > (attack.arcDot == null ? 0.34 : attack.arcDot);
  }

  function findPunchTarget(attack) {
    let best = null;
    let bestScore = 999;
    const scan = function (list) {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!punchable(a) || !inPunchArc(a, attack)) continue;
        const dx = a.group.position.x - CBZ.player.pos.x;
        const dz = a.group.position.z - CBZ.player.pos.z;
        const score = Math.hypot(dx, dz) + (a.kind === "warden" ? -0.1 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = a;
        }
      }
    };
    scan(CBZ.guards || []);
    scan(CBZ.npcs || []);
    return best;
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

  // the [3] Fight action routes here; the hit lands on the animation's
  // drive frame so it feels like a committed swing, not an instant stat tap.
  // `opts.blade` runs the shank profile — fpsmode's shoot() sets it when the
  // drawn weapon is a melee row, which is the one place LMB is owned while a
  // weapon is out (the mousedown listener at the bottom of this file
  // deliberately stands down whenever playerArmed() is true).
  function punch(actor, opts) {
    const hasTarget = punchable(actor);
    if (actor && !hasTarget) return { ok: false, msg: "" };
    // NO "Finish the swing." — the arm is mid-arc on screen. A caption telling
    // you that the punch you are watching has not landed yet is the clearest
    // case in the game of narrating an animation.
    if (pendingPunch) return { ok: false, msg: "" };
    if (CBZ.player.dead || (CBZ.player.stun || 0) > 0) return { ok: false, msg: "" };
    // Fists never stop working. Tired means WEAKER, not blocked — the damage
    // scales off stamina below, and the guard visibly drops (ch.winded). There
    // is nothing left to explain, so there is no line to print.
    if (hasTarget && actor.hp == null) actor.hp = maxHpOf(actor);

    const blade = !!(opts && opts.blade) && shankOn();
    const spec = blade ? bladeSpec() : null;

    if (CBZ.now - lastPunch < 980) combo++; else combo = 1;
    lastPunch = CBZ.now;
    // A fist winds up every third beat into a hook. A shank has no wind-up —
    // its "heavy" is the DEEP one you get for staying on him, every fourth.
    const heavy = blade ? combo % 4 === 0 : combo % 3 === 0;
    const kind = blade ? "stab" : (heavy ? "hook" : (combo % 2 ? "jab" : "cross"));
    const yaw = hasTarget ? facingYawTo(actor) : cameraFacingYaw();
    // A held point reaches further than a fist and needs a much tighter cone —
    // you can miss with a shank by being a hand's width off, and you should.
    const reach = blade ? (spec.range || BLADE_DEF.range) + (heavy ? 0.16 : 0)
      : (heavy ? 2.25 : (kind === "cross" ? 2.08 : 1.98));
    const arcDot = blade ? (heavy ? 0.40 : 0.46) : (heavy ? 0.14 : (kind === "cross" ? 0.26 : 0.34));
    /* THE BAG BUFF, RETIRED. A shiv in your pocket does not make your KNUCKLES
       harder — that was the whole of the old model, and it is why the object
       never needed to exist. Now a shiv in the bag does the one thing a shiv
       in a bag can do: it lets you DRAW it (systems/inventory.js hands the
       weapon row over on pickup). Bare fists go back to their honest 11.
       Flag off → the exact old expression, so nothing about the pre-shank
       balance moves for anyone who reverts. */
    const baseDmg = blade ? (spec.damage || BLADE_DEF.damage)
      : (shankOn() ? 11 : 11 + (CBZ.econ.hasItem("Shiv") ? 9 : 0));
    // Stabbing is cheaper than swinging — it is a short movement, and the
    // exhaustion curve is what makes a cornered man with a blade frightening.
    stamina = Math.max(0, stamina - (blade ? (heavy ? 0.20 : 0.13) : (heavy ? 0.34 : 0.22)));

    // throw the punch (alternate fists) — but the BLADE hand is the right one,
    // because that is the socket the shank model actually hangs off. Stabbing
    // with the empty left fist would animate a man's bare hand into someone
    // while the weapon hung at his side, which is the bug this whole pass is about.
    CBZ.playerChar.punchArm = blade ? "r" : (combo % 2 ? "r" : "l");
    CBZ.playerChar.punchKind = kind;
    CBZ.playerChar.punchDur = blade ? (heavy ? 0.38 : 0.28) : (heavy ? 0.42 : 0.34);
    CBZ.playerChar.punchT = CBZ.playerChar.punchDur;
    CBZ.playerChar.group.rotation.y = CBZ.lerpAngle(CBZ.playerChar.group.rotation.y, yaw, 0.85);
    CBZ.meleeFocusT = Math.max(CBZ.meleeFocusT || 0, heavy ? 0.85 : 0.62);

    pendingPunch = {
      actor: hasTarget ? actor : null, heavy, yaw, kind, reach, arcDot, blade,
      bleed: blade ? (spec.bleed || BLADE_DEF.bleed) * (heavy ? 1.5 : 1) : 0,
      // gassed punches land soft: 100% fresh down to 35% empty. A blade is
      // less forgiving of a tired arm than a fist is — steel does the work,
      // so it only loses a third of its bite instead of two thirds.
      dmg: baseDmg * (blade ? (heavy ? 1.55 : 1) : (heavy ? 1.8 : (kind === "cross" ? 1.16 : 1)))
        * (blade ? (0.66 + 0.34 * stamina) : (0.35 + 0.65 * stamina)),
      t: blade ? (heavy ? 0.17 : 0.12) : (heavy ? 0.19 : 0.15),
      max: blade ? (heavy ? 0.38 : 0.28) : (heavy ? 0.42 : 0.34),
    };
    // NO "Swing..." / "Heavy swing...". Eight lines above, this function set
    // punchArm, punchKind, punchDur and punchT — entities/character.js:2509
    // drives a real jab / cross / hook / uppercut off those, with its own
    // wind-up and follow-through. The popup captioned the animation it had
    // just triggered. A punch IS a motion; that was the whole point.
    return { ok: true, msg: "" };
  }

  function landPunch(attack) {
    let actor = attack.actor;
    if (!punchable(actor) || !inPunchArc(actor, attack)) actor = findPunchTarget(attack);
    if (!punchable(actor)) {
      popup("MISS!", 0);
      combo = 0;
      CBZ.player.stun = Math.max(CBZ.player.stun || 0, 0.10);
      CBZ.sfx("step");
      CBZ.doHitstop(0.025);
      return { ok: false, msg: "" };
    }
    if (actor.hp == null) actor.hp = maxHpOf(actor);
    const heavy = attack.heavy;
    const blade = !!attack.blade;
    const guardish = actor.kind === "guard" || actor.kind === "warden";

    if (!inPunchArc(actor, attack)) {
      popup("MISS!", 0);
      combo = 0;
      CBZ.player.stun = Math.max(CBZ.player.stun || 0, 0.10);
      CBZ.sfx("step");
      CBZ.doHitstop(0.025);
      return { ok: false, msg: "" };
    }

    const dmg = attack.dmg;
    actor.hp -= dmg;
    /* punches BRUISE (wounds.js) — the face you beat carries it.

       THIS THREW ON EVERY LANDED PUNCH. `actor.pos` does not exist on a prison
       actor — they keep their position on `.group.position` (the same trap
       city/social.js's citySay hit, documented in entities/ai.js). Reading
       `.pos.x` off undefined raised mid-landPunch, so NOTHING below this line
       ever ran: no hit-stop, no shake, no knockback, no spark, no KO, no
       downConsequences. Melee had no impact at all, and the "Swing..." popup
       was the only evidence a punch had happened — which is exactly why the
       caption felt load-bearing. Fix the body and the caption is redundant;
       delete the caption first and you have neither. */
    const wp = actor.pos || (actor.group && actor.group.position) || null;
    if (CBZ.bodyWound && wp) {
      /* A BLADE DOES NOT BRUISE. `melee:"blade"` is a kind systems/wounds.js
         has drawn since it was written (wounds.js:849 picks it, :926 draws the
         narrow slit instead of the broad bruise patch, and :867 gives it its
         own gentler limp because a puncture hobbles less than a slug) — and
         until this pass nothing in the prison could ask for it. A stab lands
         low, in the body, not at 1.55 m head-height where a hook lands. */
      CBZ.bodyWound(actor, { x: wp.x, y: (wp.y || 0) + (blade ? 1.18 : 1.55), z: wp.z },
        { melee: blade ? "blade" : "blunt", cal: blade ? 0.7 : 1,
          fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z });
      if (blade) bladeWounds++;
    }
    if (blade) stabHits++;
    /* IT KEEPS BLEEDING. The prison had no notion of a wound that goes on
       working after the hit; the city did (`a._bleed`, drained in
       city/combat.js's posture maintenance) and it existed precisely for the
       knife. Same field, same meaning, drained by this file's own tick below,
       so a man you stick and then break away from can still go down in the
       yard behind you — which is the entire tactical difference between a
       blade and a fist, and the reason a shank is worth carrying. */
    if (attack.bleed > 0) {
      actor._bleed = (actor._bleed || 0) + dmg * attack.bleed;
      actor._bleedSrcX = CBZ.player.pos.x;
      actor._bleedSrcZ = CBZ.player.pos.z;
      markBleeding(actor);
    }
    stamina = Math.min(1, stamina + 0.05);
    showHP(actor);

    // base juice + a real, velocity-based knockback so the hit reads physical
    CBZ.doHitstop(blade ? (heavy ? 0.09 : 0.05) : (heavy ? 0.11 : 0.06));
    CBZ.shake(blade ? (heavy ? 0.38 : 0.22) : (heavy ? 0.55 : 0.3));
    // No bright orange impact spark off a body: that is a KNUCKLE hitting a
    // jaw. A blade going in is quiet, and the wound decal is the flash.
    if (!blade) flashSpark(actor, heavy);
    // A shank does not throw men. Almost all of a stab's energy goes IN — the
    // shove is what your other hand is doing, not what the weapon did.
    if (CBZ.body) CBZ.body.hit(actor, { fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z, force: blade ? (heavy ? 3.4 : 2.2) : (heavy ? 8 : 4.5) });
    if (CBZ.reactPunch) CBZ.reactPunch(actor, { kind: attack.kind, heavy, fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z });
    CBZ.sfx(blade ? "hit" : "punch");
    CBZ.reportCrime(7, { type: "melee", actorRole: CBZ.game.role });
    if (guardish) actor.hunt = 3; else if (CBZ.provokeGang) CBZ.provokeGang(actor, 12);

    // Light jabs can be blocked. A point is a different problem: you can put
    // a forearm in front of a fist, and men do, but doing it to a shank just
    // means the forearm is where it goes in. The roll survives so a stab is
    // not strictly better than a fist in every case — it is much rarer.
    if (actor.hp > 0 && !heavy && CBZ.econ.rng() < (blade ? 0.06 : 0.16)) {
      CBZ.player.stun = Math.max(CBZ.player.stun || 0, 0.55);
      stamina = Math.max(0, stamina - 0.12);
      combo = 0;
      CBZ.shake(0.4); popup("BLOCKED!", 0); CBZ.sfx("step");
      return { ok: false, msg: "" };
    }

    if (actor.hp <= 0) {
      // EXECUTION when it's a heavy/combo finish; otherwise a clean KO
      const exec = heavy || combo >= 3 || CBZ.econ.rng() < 0.35;
      if (exec) return execute(actor, guardish, blade);
      popup(heavy ? "WHAM!" : "DOWN!", combo);
      if (CBZ.knockback) CBZ.knockback(actor, CBZ.player.pos.x, CBZ.player.pos.z, 1.5);
      CBZ.sfx("ko"); downConsequences(actor, guardish);
      combo = 0;
      // NO LINE. He is on the floor, the ko sound played, the knockback threw
      // him and showHP drew the hit. The combo count was the only part not on
      // screen, and you counted it by throwing the punches.
      return { ok: true, msg: "" };
    }

    popup(heavy ? "WHAM!" : WORDS[Math.floor(CBZ.econ.rng() * WORDS.length)], combo);
    return { ok: true, msg: "" };
  }

  // a hard finishing blow — a heavy hook that drops them, not a cartoon
  // launch. Real impact: hitstop, a brief slow-mo, a strong knockback that
  // staggers them off their feet, blood, then they go down.
  function execute(actor, guardish, blade) {
    // A shank finish is not a launching hook — it is the last one going in,
    // held there. Same beat, same slow-mo, one hand's worth of travel.
    CBZ.playerChar.punchKind = blade ? "stab" : "hook";
    if (blade) { CBZ.playerChar.punchArm = "r"; stabKills++; }
    CBZ.playerChar.punchDur = blade ? 0.46 : 0.4;
    CBZ.playerChar.punchT = CBZ.playerChar.punchDur;
    CBZ.meleeFocusT = Math.max(CBZ.meleeFocusT || 0, 1.0);
    CBZ.doHitstop(blade ? 0.11 : 0.14);
    CBZ.doSlowmo(0.5);
    CBZ.shake(blade ? 0.55 : 0.85);
    if (!blade) flashSpark(actor, true);
    CBZ.sfx("ko");
    // a real, heavy knockback (velocity-based via the body layer) instead of
    // flinging them into the air with a spin.
    if (CBZ.body) CBZ.body.hit(actor, { fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z, force: blade ? 4.5 : 11 });
    else if (CBZ.knockback) CBZ.knockback(actor, CBZ.player.pos.x, CBZ.player.pos.z, blade ? 0.7 : 1.6);
    // `melee:"blade"` is what turns systems/gore.js's generic death spray into
    // the ARTERIAL one — 2-3 timed arcs off the body (gore.js:32/2028), which
    // it has been able to draw for months and which no prison kill has ever
    // asked it for, because no prison kill was ever made with an edge.
    if (CBZ.aiKill) CBZ.aiKill(actor, { group: CBZ.playerChar.group }, { noKnock: true, melee: blade ? "blade" : null });
    else { actor.dead = true; actor.ko = 0; actor.hp = 0; }
    if (CBZ.game.koLog && actor.data) CBZ.game.koLog[actor.data.name] = true;
    if (CBZ.killstreakOnDown) CBZ.killstreakOnDown(actor, "melee");
    showHP(actor);
    combo = 0;
    // A DEATH ALREADY HAS ITS SURFACE and it is not a hint line: aiKill above
    // routes to city/killfeed.js and drops the body's real loadout on the floor
    // (systems/prisondrops.js). This said the same thing, worse, over the top
    // of a man falling down.
    return { ok: true, msg: "" };
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
    if (!pendingPunch) return;
    pendingPunch.t -= dt;
    if (pendingPunch.t > 0) return;
    landPunch(pendingPunch);
    pendingPunch = null;
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
    if (CBZ.game.mode === "survival") return;
    if (CBZ.game.state !== "playing" || !document.pointerLockElement) return;
    if (CBZ.fps && CBZ.fps.active) return;
    if (CBZ.playerArmed && CBZ.playerArmed()) return;
    punch();   // the swing is the feedback; there is no line left to print
  });
})();
