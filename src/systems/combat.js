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

  /* ---------- enemy health bar (billboard) ---------- */
  const hc = document.createElement("canvas"); hc.width = 100; hc.height = 16;
  const hx = hc.getContext("2d");
  const hpTex = new THREE.CanvasTexture(hc);
  const hpBar = new THREE.Sprite(new THREE.SpriteMaterial({ map: hpTex, depthTest: false, transparent: true }));
  hpBar.scale.set(2.0, 0.32, 1); hpBar.visible = false; scene.add(hpBar);
  let hpTarget = null, hpShownT = 0;
  function drawHP(ratio) {
    hx.clearRect(0, 0, 100, 16);
    hx.fillStyle = "rgba(0,0,0,.6)"; hx.fillRect(0, 0, 100, 16);
    const col = ratio > 0.5 ? "#3ad17a" : ratio > 0.25 ? "#ffb020" : "#ff3b3b";
    hx.fillStyle = col; hx.fillRect(2, 2, Math.max(0, 96 * ratio), 12);
    hx.strokeStyle = "rgba(255,255,255,.5)"; hx.lineWidth = 2; hx.strokeRect(1, 1, 98, 14);
    hpTex.needsUpdate = true;
  }
  function showHP(actor) {
    hpTarget = actor; hpShownT = 3;
    drawHP(Math.max(0, actor.hp) / maxHpOf(actor));
  }
  CBZ.onAlways(59, function (dt) {
    if (sparkLife > 0) { sparkLife -= dt; spark.material.opacity = Math.max(0, sparkLife / 0.16); spark.scale.multiplyScalar(1 + dt * 6); if (sparkLife <= 0) spark.visible = false; }
    if (hpShownT > 0 && hpTarget && !hpTarget.dead) {
      hpShownT -= dt;
      hpBar.visible = true;
      hpBar.position.set(hpTarget.group.position.x, (hpTarget.group.position.y || 0) + 2.1, hpTarget.group.position.z);
      hpBar.material.opacity = Math.min(1, hpShownT);
    } else hpBar.visible = false;
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
    if (pendingPunch) return { ok: false, msg: "Finish the swing." };
    if (CBZ.player.dead || (CBZ.player.stun || 0) > 0) return { ok: false, msg: "" };
    if (stamina < 0.18) return { ok: false, msg: "Catch your breath." };
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
      dmg: baseDmg * (heavy ? 1.8 : (kind === "cross" ? 1.16 : 1)),
      t: heavy ? 0.19 : 0.15,
      max: heavy ? 0.42 : 0.34,
    };
    return { ok: true, msg: heavy ? "Heavy swing..." : "Swing..." };
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
    // punches BRUISE (wounds.js) — the face you beat carries it
    if (CBZ.bodyWound) CBZ.bodyWound(actor, { x: actor.pos.x, y: (actor.pos.y || 0) + 1.55, z: actor.pos.z }, { melee: "blunt", fromX: CBZ.player.pos.x, fromZ: CBZ.player.pos.z });
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
      const c = combo; combo = 0;
      return { ok: true, msg: `${nm(actor)} drops!${c >= 3 ? "  (" + c + "-hit combo!)" : ""}` };
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
    const c = combo; combo = 0;
    return { ok: true, msg: `You drop ${nm(actor)} cold.${c >= 3 ? "  (" + c + "-hit combo)" : ""}` };
  }

  CBZ.onUpdate(58, function (dt) {
    stamina = Math.min(1, stamina + dt * 0.42);
    if (!pendingPunch) return;
    pendingPunch.t -= dt;
    if (pendingPunch.t > 0) return;
    const res = landPunch(pendingPunch);
    pendingPunch = null;
    if (res && res.msg) CBZ.flashHint(res.msg, 2.4);
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
    const r = punch();
    if (r && r.msg) CBZ.flashHint(r.msg, 1.4);
  });
})();
