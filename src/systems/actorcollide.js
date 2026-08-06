/* ============================================================
   systems/actorcollide.js — runs AFTER movement each frame: stops
   every standing actor (guards + inmates) from walking through walls
   or crates, and pushes overlapping actors (including you) apart so
   nobody phases through anybody. KO'd/dead bodies are skipped so you
   can step over them.

   Separation is an O(n) spatial-hash (CBZ.makeGrid) — the same grid the
   survival bots use — so it scales to hundreds of inmates instead of the
   old O(n²) double loop (~500k checks/frame at 1000 actors). It's not
   full pathfinding, so an NPC may bump a wall its target is behind.

   ---- VAULTING (2026-08-06) --------------------------------------------
   THIS IS ALSO WHERE THE PRISON CAST LEARNS TO GET OVER THINGS. The owner:
   "in Gang City the players and NPCs interact with walls and with assets in
   front of them like a chair or something to jump over — better than prison
   mode." The capability (systems/physics.js characterTraversal) was already
   shared and is now open to every mode (systems/modecaps.js); what the
   prison still lacked was a CALLER. city/peds.js calls it from inside its own
   move(), but the prison's movers are five separate `group.position.x += …`
   sites across entities/npc.js and entities/guards.js and there is no single
   one to hook.

   There is, though, exactly one place that already runs over the WHOLE prison
   cast every frame right after they move, with the express job of stopping
   them walking through things — this file. So the vault is wired here: one
   hook, and guards, inmates and any bot roster borrowing the prison get it at
   once, with no edit to a single mover. Heading is measured from the frame's
   real displacement (no mover has to publish one), and a body the traversal
   owns is dropped from the separation/clamp lists so the shared wall resolver
   cannot shove it back off the table it is crossing.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const R = 0.5;
  const CELL = 2.4;            // ~= the largest interaction diameter

  // A wanderer must not treat every stool as parkour. City pedestrians gate on
  // `spd >= max(1.7, base*1.42)`; prison base speeds run 1.4–2.8 and the hunt/
  // flee multipliers are ×1.28–×1.7, so this threshold selects a body that is
  // genuinely chasing, fleeing or investigating.
  const TRAV_SPEED = 2.6;
  const TRAV_PROBE_CD = 0.12;  // seconds between probes for one actor

  function standing(a) { return !a.dead && !(a.ko > 0) && !a.escaped; }
  function posOf(a) { return a._p ? a.pos : a.group.position; }
  function radOf(a) { return a._p ? a.r : R; }

  // reused every frame — no per-frame allocation
  let grid = null;
  const list = [];
  const playerEntry = { _p: true, pos: null, r: 0 };

  // THE MEASUREMENT THAT MATTERS IS THE ATTEMPTED STEP, NOT THE ACHIEVED ONE.
  // A body grinding a table face is exactly the body that should vault it, and
  // it is also the body whose achieved displacement is ZERO — the mover pushes
  // it into the box and the clamp at the bottom of this file pushes it straight
  // back out. So the reference sample is taken AFTER the clamp (stampRest, end
  // of the updater) and read BEFORE the next frame's clamp, which makes the
  // difference the full step the mover tried to take. Measuring it the obvious
  // way instead (pre-clamp to pre-clamp) reads ~0 for precisely the actors this
  // exists for, and the probe never fires. That cost one probe round to find.
  function stampRest(a) {
    const p = a._p ? a.pos : a.group.position;
    a._acX = p.x; a._acZ = p.z;
  }

  // Run/finish a vault for one prison actor. Returns true when the traversal
  // owns the body this frame, in which case the caller must leave it alone.
  function traverse(a, dt) {
    const T = CBZ.characterTraversal;
    if (!T || !a.char || !a.group) return false;
    const p = a.group.position;
    a._acProbeT = (a._acProbeT || 0) - dt;
    if (a._traversal) {
      // A knockdown, a death or a capture takes the body back mid-flight.
      if (a.dead || (a.ko || 0) > 0 || a.escaped) { T.cancel(a, a.char, false, "interrupted"); return false; }
      const owned = T.step(a, a.char, dt, true);
      // landing refreshes the sample AND buys a beat before the next probe, so
      // one obstacle is never crossed twice in a row.
      stampRest(a);
      if (!a._traversal) a._acProbeT = TRAV_PROBE_CD * 3;
      return owned;
    }
    const lx = a._acX, lz = a._acZ;
    if (lx == null || dt <= 0 || a._acProbeT > 0) return false;
    let dx = p.x - lx, dz = p.z - lz;
    const len = Math.hypot(dx, dz);
    const spd = len / dt;
    if (spd < TRAV_SPEED) return false;
    dx /= len; dz /= len;             // probeTraversal wants a UNIT heading
    a._acProbeT = TRAV_PROBE_CD;
    const started = T.start(a, a.char, dx, dz, {
      speed: spd,
      radius: R,
      height: (a.char.metric && a.char.metric.height) || 1.7,
      allowTop: false,     // prison navigation has no rooftop goal graph either
      cars: false,         // there are no road cars inside the wire
      npc: true,
      running: true,
      sprinting: spd > TRAV_SPEED * 1.35,
      // `.speed` on a prison record is the BASE walking speed the brain reads
      // back as `CBZ.aiThink(n, dt) || n.speed` — never a live per-frame value.
      speedField: false,
    });
    return !!(started && T.step(a, a.char, dt, true));
  }

  CBZ.onUpdate(25, function (dt) {
    if (CBZ.game.mode !== "escape") return; // survival uses its own grid separation
    if (!grid) grid = CBZ.makeGrid(CELL);

    const vaultOn = CBZ.modeHas ? CBZ.modeHas("traverse") : false;
    list.length = 0;
    for (let i = 0; i < CBZ.guards.length; i++) {
      const g = CBZ.guards[i];
      if (!standing(g)) continue;
      if (vaultOn && traverse(g, dt)) continue;   // the vault owns this body
      list.push(g);
    }
    for (let i = 0; i < CBZ.npcs.length; i++) {
      const n = CBZ.npcs[i];
      if (!standing(n) || n._crowd) continue;
      if (vaultOn && traverse(n, dt)) continue;
      list.push(n);
    }
    if (!CBZ.player.dead) { playerEntry.pos = CBZ.player.pos; playerEntry.r = CBZ.player.radius; list.push(playerEntry); }

    // Shared human-contact rules block ordinary movement. A prison knockdown
    // requires an explicit combat action, never merely sprinting into someone.
    if (CBZ.humanContact) {
      CBZ.humanContact.resolve(list, dt, {
        mode: "escape",
        clamp(a) { CBZ.collide(posOf(a), radOf(a)); },
      });
      for (let i = 0; i < list.length; i++) if (!list[i]._p) stampRest(list[i]);
      return;
    }

    grid.rebuild(list, posOf);

    // push overlapping actors apart, querying only the 3×3 neighbourhood
    for (let i = 0; i < list.length; i++) {
      const A = list[i], ap = posOf(A), ar = radOf(A);
      const gx = grid.cellIndex(ap.x), gz = grid.cellIndex(ap.z);
      for (let cx = gx - 1; cx <= gx + 1; cx++) for (let cz = gz - 1; cz <= gz + 1; cz++) {
        const a = grid.bucket(cx, cz); if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const B = a[k];
          if (B === A) continue;
          const bp = posOf(B);
          const dx = bp.x - ap.x, dz = bp.z - ap.z;
          const min = ar + radOf(B);
          const d2 = dx * dx + dz * dz;
          if (d2 < min * min && d2 > 1e-6) {
            const d = Math.sqrt(d2), push = ((min - d) / d) * 0.5;
            // never shove the player; only other actors yield
            if (!A._p) { ap.x -= dx * push; ap.z -= dz * push; }
            if (!B._p) { bp.x += dx * push; bp.z += dz * push; }
          }
        }
      }
    }

    // then clamp everyone back out of walls (including the player)
    for (let i = 0; i < list.length; i++) CBZ.collide(posOf(list[i]), radOf(list[i]));
    // AFTER the clamp: this settled position is next frame's reference, so the
    // difference the probe reads is the step the mover TRIED to take, not the
    // one the wall allowed. See the note on stampRest.
    for (let i = 0; i < list.length; i++) if (!list[i]._p) stampRest(list[i]);
  });
})();
