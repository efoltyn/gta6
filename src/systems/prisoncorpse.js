/* ============================================================
   systems/prisoncorpse.js — a dead man in the prison goes down like a body.

   OWNER (2026-08-19, standing over the warden he had just killed, half of
   the body inside the office wall): "bodies in jail game have no colliders
   so go thru ground and walls. fix. make realer dead."
   OWNER (2026-09-28): "when someone gets shot they do this weird pivot,
   almost like one part of their foot is stuck to the ground and they're
   spinning around it."

   The second report was THIS file. It laid a corpse down by rolling the
   group's rotation.z to 90 degrees about the rig's origin, which is the
   FEET, while damping rotation.y toward a wall-clear lie direction that
   could be half a turn away from where the man was facing: a sideways plank
   pirouetting on its planted feet.

   Now the prison's dead fall in the ONE fall every human uses
   (systems/bodyfall.js): the knees give, the hips drop, he goes over
   backward or onto his face along the blow, turning at most ~29 degrees,
   carrying the killer's shove as real root momentum that slides against
   the colliders (not the 1.1 m position write ai.js's kill() used to
   teleport him with), then lies ON the lino, tilted to any step under
   him, with every extremity (head, hands, elbows, knees, feet) resolved
   out of the walls, and freezes. This file keeps only what is the prison's
   own: a man killed in a chair or a bunk leaves the prop first.

     place(a, killer, opts)  at the moment of death
     tick(a, dt)             every frame while dead; true while it owns him
     clear(a)                a revived rig (run reset) stands up whole
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  function place(a, killer, opts) {
    if (!a || !a.group || !CBZ.bodyFall) return;
    opts = opts || {};
    /* A MAN KILLED IN HIS CHAIR DIES OUT OF IT. The warden dies seated at
       his desk (adminwing's PRISON_WARDEN_SEATED) and a bunk sleeper dies
       lying in propuse's hold — and in both cases propuse keeps WRITING the
       body's transform every frame for as long as the prop flags stand, so
       the corpse would float at seat height with the fall fighting the hold.
       Release the prop, and put the body on the FLOOR: a prop anchor's y is
       furniture height, never ground. */
    const held = !!(a._propSeat || a._propBed || a._propLie || (a.char && (a.char.sitting || a.char.lying)));
    if (held) {
      if (CBZ.propStand) { try { CBZ.propStand(a, { instant: true }); } catch (e) { /* prop system off */ } }
      if (a.char) { a.char.sitting = false; a.char.lying = false; }
      a._propLie = false;
      a.asleep = false;
      a.group.position.y = 0;
    }
    const kg = killer && killer.group ? killer.group.position : (killer && killer.pos) || null;
    CBZ.bodyFall.start(a, {
      fromX: kg ? kg.x : null, fromZ: kg ? kg.z : null,
      dirX: opts.dirX, dirZ: opts.dirZ,
      // a killing blow or round shoves him; an unwitnessed death just folds
      force: opts.force != null ? opts.force : (kg ? 7 : 0),
      dead: true, hold: true,
    });
    if (!kg && !(opts.dirX || opts.dirZ) && a._bf) { a._bf.vx = 0; a._bf.vz = 0; }
  }

  function tick(a, dt) {
    if (!a || !a.group || !CBZ.bodyFall) return false;
    // a death that never crossed place() (a mover finding `dead` already set)
    if (!CBZ.bodyFall.active(a)) place(a, null);
    return CBZ.bodyFall.tick(a, dt) || CBZ.bodyFall.active(a);
  }

  function clear(a) {
    if (!a) return;
    if (CBZ.bodyFall) CBZ.bodyFall.clear(a);
    if (a.group) { a.group.rotation.x = 0; a.group.rotation.z = 0; }
  }

  CBZ.prisonCorpsePlace = place;
  CBZ.prisonCorpseTick = tick;
  CBZ.prisonCorpseClear = clear;
  // diagnostics: how many corpses currently have their hips inside a wall.
  CBZ.prisonCorpseAudit = function () {
    let bodies = 0, inWall = 0;
    const q = { x: 0, y: 0, z: 0 };
    const scan = (list) => {
      for (const a of list || []) {
        if (!a || !a.dead || !a.group) continue;
        bodies++;
        if (!CBZ.collide) continue;
        const p = a.group.position;
        q.x = p.x; q.y = p.y; q.z = p.z;
        CBZ.collide(q, 0.2, p.y + 0.04, p.y + 0.4);
        if (Math.abs(q.x - p.x) + Math.abs(q.z - p.z) > 0.02) inWall++;
      }
    };
    scan(CBZ.npcs); scan(CBZ.guards);
    return { bodies: bodies, inWall: inWall };
  };
})();
