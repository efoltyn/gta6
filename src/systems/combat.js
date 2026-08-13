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

  // the [3] Fight action routes here; the hit lands on the animation's
  // drive frame so it feels like a committed swing, not an instant stat tap.
  function punch(actor) {
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

    if (CBZ.now - lastPunch < 980) combo++; else combo = 1;
    lastPunch = CBZ.now;
    const heavy = combo % 3 === 0;
    const kind = heavy ? "hook" : (combo % 2 ? "jab" : "cross");
    const yaw = hasTarget ? facingYawTo(actor) : cameraFacingYaw();
    const reach = heavy ? 2.25 : (kind === "cross" ? 2.08 : 1.98);
    const arcDot = heavy ? 0.14 : (kind === "cross" ? 0.26 : 0.34);
    const baseDmg = 11 + (CBZ.econ.hasItem("Shiv") ? 9 : 0);
    stamina = Math.max(0, stamina - (heavy ? 0.34 : 0.22));

    // throw the punch (alternate fists)
    CBZ.playerChar.punchArm = combo % 2 ? "r" : "l";
    CBZ.playerChar.punchKind = kind;
    CBZ.playerChar.punchDur = heavy ? 0.42 : 0.34;
    CBZ.playerChar.punchT = CBZ.playerChar.punchDur;
    CBZ.playerChar.group.rotation.y = CBZ.lerpAngle(CBZ.playerChar.group.rotation.y, yaw, 0.85);
    CBZ.meleeFocusT = Math.max(CBZ.meleeFocusT || 0, heavy ? 0.85 : 0.62);

    pendingPunch = {
      actor: hasTarget ? actor : null, heavy, yaw, kind, reach, arcDot,
      // gassed punches land soft: 100% fresh down to 35% empty
      dmg: baseDmg * (heavy ? 1.8 : (kind === "cross" ? 1.16 : 1)) * (0.35 + 0.65 * stamina),
      t: heavy ? 0.19 : 0.15,
      max: heavy ? 0.42 : 0.34,
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
      CBZ.bodyWound(actor, { x: wp.x, y: (wp.y || 0) + 1.55, z: wp.z },
        { melee: "blunt", fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z });
    }
    stamina = Math.min(1, stamina + 0.05);
    showHP(actor);

    // base juice + a real, velocity-based knockback so the hit reads physical
    CBZ.doHitstop(heavy ? 0.11 : 0.06);
    CBZ.shake(heavy ? 0.55 : 0.3);
    flashSpark(actor, heavy);
    if (CBZ.body) CBZ.body.hit(actor, { fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z, force: heavy ? 8 : 4.5 });
    if (CBZ.reactPunch) CBZ.reactPunch(actor, { kind: attack.kind, heavy, fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z });
    CBZ.sfx("punch");
    CBZ.reportCrime(7, { type: "melee", actorRole: CBZ.game.role });
    if (guardish) actor.hunt = 3; else if (CBZ.provokeGang) CBZ.provokeGang(actor, 12);

    // light jabs can be blocked
    if (actor.hp > 0 && !heavy && CBZ.econ.rng() < 0.16) {
      CBZ.player.stun = Math.max(CBZ.player.stun || 0, 0.55);
      stamina = Math.max(0, stamina - 0.12);
      combo = 0;
      CBZ.shake(0.4); popup("BLOCKED!", 0); CBZ.sfx("step");
      return { ok: false, msg: "" };
    }

    if (actor.hp <= 0) {
      // EXECUTION when it's a heavy/combo finish; otherwise a clean KO
      const exec = heavy || combo >= 3 || CBZ.econ.rng() < 0.35;
      if (exec) return execute(actor, guardish);
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
  function execute(actor, guardish) {
    CBZ.playerChar.punchKind = "hook";
    CBZ.playerChar.punchDur = 0.4;
    CBZ.playerChar.punchT = 0.4;
    CBZ.meleeFocusT = Math.max(CBZ.meleeFocusT || 0, 1.0);
    CBZ.doHitstop(0.14);
    CBZ.doSlowmo(0.5);
    CBZ.shake(0.85);
    flashSpark(actor, true);
    CBZ.sfx("ko");
    // a real, heavy knockback (velocity-based via the body layer) instead of
    // flinging them into the air with a spin.
    if (CBZ.body) CBZ.body.hit(actor, { fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z, force: 11 });
    else if (CBZ.knockback) CBZ.knockback(actor, CBZ.player.pos.x, CBZ.player.pos.z, 1.6);
    if (CBZ.aiKill) CBZ.aiKill(actor, { group: CBZ.playerChar.group }, { noKnock: true });
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

  CBZ.onUpdate(58, function (dt) {
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
