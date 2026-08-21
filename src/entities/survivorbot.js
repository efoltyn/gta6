/* ============================================================
   entities/survivorbot.js — the ~99 AI survivors (SURVIVAL mode).

   Reuses the FPS engine's character rig (makeCharacter) and procedural
   locomotion (animChar) — proving the thesis that the movement/animation
   foundation makes a crowd game cheap. The 4800-line prison brain is NOT
   loaded; bots run a lean 3-state FSM: WANDER → FLEE (disaster) →
   DEAD. They take damage from the same disasters as the player,
   so eliminations happen naturally with no bot-vs-bot combat.

   Perf for 100 actors on r128/browser:
     • LOD     — bots far from camera skip animChar (freeze pose).
     • slicing — the brain re-decides every few frames (round-robin by
                 index); locomotion still integrates every frame.
     • grid    — O(n) spatial-hash separation instead of O(n²).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const { makeCharacter, animChar, lerpAngle, damp } = CBZ;

  const BOT_RADIUS = 0.5;
  const ANIM_DIST2 = 62 * 62;     // beyond this, freeze animation
  let frame = 0;

  // bright Roblox-lobby palette so the crowd reads as 100 distinct players
  const SKIN = [0xf0c39a, 0xe8b58c, 0xc08a5a, 0x8a5a3a, 0x6b4a32, 0xd8a177, 0xf2cbb0];
  const HAIR = [0x2a2018, 0x4a3526, 0x101820, 0xb9b1a6, 0x7a4a2e, 0x222222, 0xdedede];
  const OUTFIT = [0xff5b5b, 0x4f9dff, 0x44d07a, 0xffd166, 0xc792ea, 0xff9e6b, 0x66d9c0,
                  0xf06b9b, 0x5b8bff, 0xff7a1a, 0x39d0c0, 0xe85d8a, 0x7ed957, 0xb07aff];
  function pick(a, r) { return a[(r * a.length) | 0]; }

  // ---- survivor NAMES (so the lobby reads like 100 real players, not props) ----
  const FIRST = [
    "Liam", "Mia", "Noah", "Ava", "Kai", "Zoe", "Leo", "Ivy", "Max", "Ada",
    "Finn", "Cleo", "Ravi", "Yuki", "Omar", "Nina", "Jude", "Wren", "Theo", "Iris",
    "Hugo", "Vera", "Eli", "Luna", "Cy", "Remy", "Sol", "Ona", "Reed", "Lux",
    "Beau", "Esme", "Tariq", "Faye", "Nico", "Indira", "Dane", "Pia", "Arlo", "Suki",
    "Cole", "Mara", "Kofi", "Tess", "Bodhi", "Anya", "Dex", "Lena", "Roman", "Quinn",
    "Soren", "Dahlia", "Ezra", "Noor", "Gus", "Vivi", "Mateo", "Saoirse", "Knox", "Wynn",
  ];
  const LAST_I = "ABCDEFGHJKLMNPRSTVW";
  function pickName(r) { return pick(FIRST, r()) + " " + LAST_I[(r() * LAST_I.length) | 0] + "."; }

  function makeBot(x, z, r) {
    const outfit = pick(OUTFIT, r());
    const skin = pick(SKIN, r());
    const ch = makeCharacter({
      legs: pick(OUTFIT, r()), torso: outfit, collar: outfit, arms: outfit,
      skin: skin, hair: pick(HAIR, r()), shoes: 0x2b2b2b,
    });
    const gy = CBZ.surv ? CBZ.surv.floorAt(x, z) : 0;
    ch.group.position.set(x, gy, z);
    ch.group.rotation.y = r() * 6.28;
    const name = pickName(r);
    const b = {
      char: ch, group: ch.group, pos: ch.group.position,
      name: name, tag: null, outfit: outfit, skin: skin,
      hp: 100, dead: false, deadT: 0, culled: false,
      baseSpeed: 2.0 + r() * 1.0, speed: 0,
      target: new THREE.Vector3(x, 0, z),
      pause: 0, state: "wander", isPlayer: false,
      slice: (r() * 6) | 0,   // think phase offset
      // Temperament and possessions are deliberately independent. Survival
      // only uses the reaction memory today; richer shared verbs can read the
      // same inventory later without changing the contact model.
      reactivity: r(),
      inventory: { medkit: r() < 0.12, lighter: r() < 0.18 },
    };
    return b;
  }

  /* THE CROWD'S OWN STREAM. Every draw a bot makes after it exists — where it
     wanders, how long it stands still — comes from here, reseeded once per
     match so two clients on one seed watch the same hundred people. The bots
     are ticked in array order every tick, so the sequence is the same on both
     ends. (Their APPEARANCE still comes from the spawn LCG below, which was
     already deterministic.) */
  let botRng = null;
  function brnd() { return botRng ? botRng() : Math.random(); }
  let matchNo = 0;

  CBZ.spawnSurvivorBots = function (n) {
    CBZ.clearSurvivorBots();
    const arena = CBZ.buildDisasterArena();
    botRng = CBZ.seedStream ? CBZ.seedStream("surv-crowd-" + (++matchNo)) : null;
    /* THE THINK SCHEDULE STARTS AT THE MATCH, NOT AT THE PAGE.

       `frame` is what decides which bots think on which tick
       ((frame + b.slice) % stride), and it counted every update since the page
       loaded — so which bots thought on tick 1 of a match depended on how many
       frames the TITLE SCREEN had rendered first. Two clients that took
       different times to boot ran different crowds from the first tick, which
       is what tools/determinism-check.mjs kept catching and why the answer
       moved between runs. Zeroed with the crowd it schedules. */
    frame = 0;
    if (CBZ.fixedStep) CBZ.fixedStep.tick = 0;
    let s = 7 + n;
    const rr = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < n; i++) {
      const p = arena.randomPoint(10, arena.radius * 0.8);
      const b = makeBot(p.x, p.z, rr);
      arena.root.add(b.group);
      CBZ.bots.push(b);
    }
  };

  /* WHAT THE CROWD'S SCHEDULE IS DOING. Both numbers are match state that no
     one outside this file could see, and both have already been a divergence:
     `frame` decides which bots think on which tick, and `matchNo` names the
     seeded stream they wander on. tools/determinism-check.mjs reads them, so a
     drift between two clients names itself instead of showing up as ninety-nine
     bodies in the wrong places. */
  CBZ.survBotAudit = function () {
    return { frame: frame, matchNo: matchNo, bots: CBZ.bots.length, seeded: !!botRng };
  };

  CBZ.clearSurvivorBots = function () {
    for (const b of CBZ.bots) {
      if (b.group) {
        if (b.group.parent) b.group.parent.remove(b.group);
        b.group.traverse(function (o) {
          // characters now share cached geometry + materials (world/materials.js)
          // across the whole crowd — NEVER dispose anything tagged `_shared`, or
          // every other actor loses it. Only the per-actor head material is fresh.
          if (o.geometry && !o.geometry._shared && o.geometry.dispose) try { o.geometry.dispose(); } catch (e) {}
          if (o.material) { const m = o.material; if (Array.isArray(m)) m.forEach((x) => x && !x._shared && x.dispose && x.dispose()); else if (!m._shared && m.dispose) m.dispose(); }
        });
      }
    }
    CBZ.bots.length = 0;
  };

  // ---- the lean brain: decide target + state ----
  function think(b) {
    if (b.dead) return;
    let fx = 0, fz = 0, urgent = 0;

    // run from the active disaster (there are no zones — the hazard itself
    // is the only pressure a survivor reacts to)
    if (CBZ.disasters) {
      const fv = CBZ.disasters.fleeVector(b.pos.x, b.pos.z);
      if (fv) { fx += fv.x * (0.6 + fv.w); fz += fv.z * (0.6 + fv.w); urgent = Math.max(urgent, fv.w); }
    }

    if (fx || fz) {
      const m = Math.hypot(fx, fz);
      b.state = urgent > 0.35 ? "flee" : "move";
      b.urg = urgent;                 // move() turns this into a visible sprint
      // aim at a point well ahead in the safe direction
      const reach = 14 + urgent * 16;
      b.target.set(b.pos.x + (fx / m) * reach, 0, b.pos.z + (fz / m) * reach);
      b.pause = 0;
    } else {
      // wander the island
      b.state = "wander";
      b.urg = 0;
      if (b.pause <= 0) {
        const arena = CBZ.surv.arena;
        /* SEEDED, because where ninety-nine people wander is match state, not
           decoration: on Math.random two clients on the same seed had a
           different crowd within one second of the drop. brnd() is the match's
           own stream, reseeded in spawnSurvivorBots. */
        const a = brnd() * 6.28, d = brnd() * arena.radius * 0.6;
        b.target.set(arena.center.x + Math.cos(a) * d, 0, arena.center.z + Math.sin(a) * d);
        b.pause = 0.6 + brnd() * 2.2;
      }
    }
  }

  // ---- VAULT (systems/physics.js characterTraversal) ------------------------
  // The comment on line 151 below has always said bots "don't climb". They do
  // now, over the one band a person can cross without climbing gear: the
  // island's abandoned cars, low walls and rubble. The capability is the SAME
  // one the city gives a fleeing pedestrian — it was refused outside city mode
  // until systems/modecaps.js made it a capability instead of a scenario — and
  // a bot SPRINTING from a tsunami is exactly the body it was written for.
  // Returns true when the vault owns the frame (skip normal locomotion).
  function botTraverse(b, dt, spd) {
    const T = CBZ.characterTraversal;
    if (!T || !b.char || !(CBZ.modeHas && CBZ.modeHas("traverse"))) return false;
    if (b._traversal) {
      if (b.dead) { T.cancel(b, b.char, false, "dead"); return false; }
      const owned = T.step(b, b.char, dt, true);
      if (!b._traversal) b._travCD = 0.4;
      return owned;
    }
    // Only a body with somewhere urgent to be. A wandering islander walks round.
    if (b.state !== "flee" && b.state !== "move") return false;
    b._travCD = (b._travCD || 0) - dt;
    if (b._travCD > 0 || !b.target) return false;
    const tx = b.target.x - b.pos.x, tz = b.target.z - b.pos.z;
    if (tx * tx + tz * tz < 0.81) return false;
    b._travCD = 0.14;
    const started = T.start(b, b.char, tx, tz, {
      speed: spd, radius: BOT_RADIUS,
      height: (b.char.metric && b.char.metric.height) || 1.7,
      allowTop: false, cars: false, npc: true, running: true,
      sprinting: b.state === "flee",
    });
    return !!(started && T.step(b, b.char, dt, true));
  }

  // ---- locomotion (every frame; only for living, non-busy bots) ----
  function move(b, dt, animate) {
    // fleeing reads urgency: a bot brushing a threat jogs (~1.55×), one caught
    // outside the closing zone or under a strike marker SPRINTS (~2.15×)
    const spd = b.state === "flee" ? b.baseSpeed * (1.55 + 0.6 * (b.urg || 0)) : (b.state === "move" ? b.baseSpeed * 1.25 : b.baseSpeed);
    if (botTraverse(b, dt, spd)) return;
    const dx = b.target.x - b.pos.x, dz = b.target.z - b.pos.z;
    const dist = Math.hypot(dx, dz);
    if (b.pause > 0) b.pause -= dt;
    if (dist > 0.5) {
      b.pos.x += (dx / dist) * spd * dt;
      b.pos.z += (dz / dist) * spd * dt;
      b.group.rotation.y = lerpAngle(b.group.rotation.y, Math.atan2(dx, dz), 1 - Math.pow(0.0008, dt));
      b.speed = spd;
    } else { b.speed = 0; if (b.state === "wander") b.pause = Math.max(b.pause, 0.4); }
    // bots walk the terrain only (they don't climb); pass their body span so the
    // height-gated upper-floor walls of buildings don't block them at ground level
    if (CBZ.collide) CBZ.collide(b.pos, BOT_RADIUS, b.pos.y, b.pos.y + 1.7);
    b.pos.y = CBZ.surv ? CBZ.surv.floorAt(b.pos.x, b.pos.z) : 0;
    if (animate) animChar(b.char, b.speed, dt);
  }

  // ---- corpse persistence (see the block in the update loop) ----
  // Read live so a quality slider or a console tweak lands mid-round.
  const CORPSE_NEAR2 = 46 * 46;    // "near enough to walk over and look at"
  const CORPSE_FAR_T = 6;          // out of sight: the original flat lifetime, unchanged
  const CORPSE_NEAR_T = 22;        // in sight: long enough to read the body and its pool
  const CORPSE_CAP = 12;           // how many may linger at once
  let lingering = 0;

  // ---- per-frame update (order 23: after player @10, prison npc @22 is gated off) ----
  CBZ.onUpdate(23, function (dt) {
    if (CBZ.game.mode !== "survival") return;
    frame++;
    const camx = CBZ.camera.position.x, camz = CBZ.camera.position.z;   // VIEW: animation + corpse LOD
    const px = CBZ.player.pos.x, pz = CBZ.player.pos.z;                 // SIM: think cadence (see below)
    const bots = CBZ.bots;
    lingering = 0;                                   // recounted in the pass below
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (b.dead) {                                    // corpse: body.js poses the ragdoll; just count + cull
        if (b.tag) b.tag.visible = false;
        b.deadT = (b.deadT || 0) + dt;
        /* THE BODY DOESN'T VANISH WHILE YOU'RE LOOKING AT IT (SURV_CORPSE_LINGER).
           Every corpse used to be deleted at a flat 6 seconds, wherever it was
           — which is long enough to see someone die and nowhere near long
           enough to walk over and look. Half the evidence this mode now puts
           on a body arrives in that window and then blinks out at arm's length:
           the frost on a man who froze, the char on one the lava took, the pool
           he soaked into. Worse, it POPPED — the rig was simply removed from the
           scene mid-view.

           So distance decides, the way it does everywhere else in this engine:
           a corpse you cannot see still goes at 6 s (the budget is unchanged
           where it matters, which is a field of 99), a corpse near you lies
           there long enough to be read, and only a bounded number of them do
           — past the cap the newest death takes the oldest one's place, so a
           mass-casualty disaster can never stack the whole lobby in front of
           the lens. */
        if (!b.culled) {
          const cdx = b.pos.x - camx, cdz = b.pos.z - camz;
          const seen = (cdx * cdx + cdz * cdz) < CORPSE_NEAR2;
          if (b._linger) lingering++;
          if (b.deadT > CORPSE_FAR_T && !b._linger && seen && lingering <= CORPSE_CAP) { b._linger = true; lingering++; }
          const life = b._linger ? CORPSE_NEAR_T : CORPSE_FAR_T;
          if (b.deadT > life || (b._linger && !seen && b.deadT > CORPSE_FAR_T * 2)) {
            b.culled = true;
            if (b._linger) { b._linger = false; lingering--; }
            if (b.group.parent) b.group.parent.remove(b.group);
          }
        }
        continue;
      }
      const dx = b.pos.x - camx, dz = b.pos.z - camz;
      const dist2 = dx * dx + dz * dz;
      if (b.tag) b.tag.visible = false;                  // identity stays in interaction UI, not over the head
      if (CBZ.body && CBZ.body.busy(b)) continue;       // thrown / knocked down / held → body owns it
      const near = dist2 < ANIM_DIST2;
      /* HOW OFTEN A BOT THINKS IS A SIM DECISION. HOW OFTEN IT ANIMATES IS NOT.

         Both used to be `near`, measured from the CAMERA — so a bot's decision
         cadence depended on where the local player happened to be looking. On
         one machine that is invisible. On two it is fatal: tools/determinism-
         check.mjs found exactly this, three bots out of eight drifting apart
         within four seconds of an identical seed, because two cameras put the
         same bot on opposite sides of the LOD boundary and it thought every
         3rd frame on one client and every 7th on the other.

         The stride is measured from the PLAYER now — a body in the world, at
         the same place on every client. `near` (the camera) still decides
         animation, which is a view decision and is allowed to differ. */
      const sdx = b.pos.x - px, sdz = b.pos.z - pz;
      const stride = (sdx * sdx + sdz * sdz) < ANIM_DIST2 ? 3 : 7;
      if ((frame + b.slice) % stride === 0) think(b);
      move(b, dt, near);
    }
  });

  // ---- O(n) spatial-grid separation (order 26: prison actorcollide @25 gated off) ----
  // Uses the shared alloc-free grid (CBZ.makeGrid) — no per-frame Map/strings.
  const CELL = 2.4;
  const minD = BOT_RADIUS * 2;
  let sepGrid = null;
  const sepList = [];
  const playerEntry = { pos: null, _p: true, isPlayer: true, r: 0.55 };
  function botPos(b) { return b.pos; }
  CBZ.onUpdate(26, function (dt) {
    if (CBZ.game.mode !== "survival") return;
    if (!sepGrid) sepGrid = CBZ.makeGrid(CELL);
    sepList.length = 0;
    for (let i = 0; i < CBZ.bots.length; i++) {
      const b = CBZ.bots[i];
      // a body mid-vault is owned by the traversal spline: the clamp below
      // would shove it back off the car it is crossing.
      if (!b.dead && !b._traversal && !(CBZ.body && CBZ.body.busy(b))) sepList.push(b);
    }
    if (!CBZ.player.dead) { playerEntry.pos = CBZ.player.pos; playerEntry.r = CBZ.player.radius || 0.55; sepList.push(playerEntry); }
    if (CBZ.humanContact) {
      CBZ.humanContact.resolve(sepList, dt, {
        mode: "survival",
        clamp(a) {
          if (CBZ.collide) CBZ.collide(a.pos, a.r || BOT_RADIUS, a.pos.y, a.pos.y + 1.7);
          if (!a._p) a.pos.y = CBZ.surv ? CBZ.surv.floorAt(a.pos.x, a.pos.z) : 0;
        },
      });
      return;
    }
    sepGrid.rebuild(sepList, botPos);
    for (let i = 0; i < sepList.length; i++) {
      const b = sepList[i];
      const gx = sepGrid.cellIndex(b.pos.x), gz = sepGrid.cellIndex(b.pos.z);
      for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
        const a = sepGrid.bucket(cx, cz); if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const o = a[k];
          if (o === b) continue;
          const dx = b.pos.x - o.pos.x, dz = b.pos.z - o.pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < minD * minD && d2 > 1e-6) {
            const d = Math.sqrt(d2), push = (minD - d) / d * 0.5;
            if (!b._p) { b.pos.x += dx * push; b.pos.z += dz * push; }
            if (!o._p) { o.pos.x -= dx * push; o.pos.z -= dz * push; }
          }
        }
      }
    }
  });
})();
