/* ============================================================
   systems/prisoncorpse.js — a dead man lies ON the floor, IN the room.

   OWNER (2026-08-19, standing over the warden he had just killed, half of
   the body inside the office wall): "bodies in jail game have no colliders
   so go thru ground and walls. fix. make realer dead."

   WHAT SHIPPED BEFORE THIS FILE, measured in the movers themselves:
     entities/npc.js:211     if (n.dead) { rotation.z -> π/2; return; }
     entities/guards.js:982  same damp, plus an idle animChar
   That is the whole death: a standing rig tips sideways around its FEET
   with no question asked about what is beside it. Three faults follow:
     1. THE WALL. The topple sweeps the torso through whatever the yaw
        happens to point at — kill a man facing a wall and he lies IN it.
        systems/actorcollide.js skips dead bodies on purpose (you step
        over a corpse, it does not shove you), so nothing ever pushes the
        body back out.
     2. THE SHOVE. ai.js's kill() knocks the victim 1.1 u away from the
        killer with a bare position write (knockback has no collision),
        so a kill against a wall STARTS the corpse inside it.
     3. THE PLANK. rotation.z is the only channel that moves — a corpse
        is the standing idle pose laid on its side, arms at its ribs,
        half its limb thickness under the slab.

   THIS FILE is the one owner of a prison corpse's transform:
     place(a, killer)  at the moment of death: pick the one direction the
                       body can actually lie — candidate directions fanned
                       off "away from the killer", each tested along the
                       body's length against CBZ.colliders — and remember
                       it, with a per-man side/sprawl rolled off his own
                       name (same man, same death, every run).
     tick(a, dt)       every frame while dead (called from both movers'
                       dead branches): flop toward the chosen lie, damp
                       the feet up to REST_Y so the limbs rest on the lino
                       instead of half inside it, sprawl the four limb
                       pivots, and for the first SETTLE seconds keep
                       resolving both ENDS of the body out of walls with
                       CBZ.collide — which is what catches the knockback,
                       late shoves from a brawl on top of the body, and
                       any candidate error.
   Returns true while it owns the body; a mover whose call returns false
   runs its legacy flop, and PRISON_CORPSE_V1=false turns the whole file
   into that false.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.CONFIG && CBZ.CONFIG.PRISON_CORPSE_V1 == null) CBZ.CONFIG.PRISON_CORPSE_V1 = true;
  function on() { return !CBZ.CONFIG || CBZ.CONFIG.PRISON_CORPSE_V1 !== false; }

  const BODY_LEN = 1.7;      // feet -> crown of the 1.82 m rig, lying down
  const REST_Y = 0.13;       // half a limb's thickness: ON the floor, not in it
  const SETTLE = 1.8;        // seconds the ends keep being resolved out of walls

  // deterministic per-man variety — a name, not Math.random (doctrine.md)
  function h01(s, salt) {
    s = String(s || "") + (salt || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 1000) / 1000;
  }
  function nameOf(a) { return (a && a.data && a.data.name) || "somebody"; }

  /* A point-in-wall test for a LYING body: the corpse occupies y 0..~0.4, so
     anything whose band starts above hip height (a tabletop, a bunk deck) is
     legitimately above it — a body sliding half under a mess table is a body
     doing what bodies do. City-stamped colliders are ignored outside the city
     exactly as physics.js's collide() ignores them. */
  function pointBlocked(x, z, pad) {
    const cols = CBZ.colliders || [];
    const cityOn = !CBZ.game || CBZ.game.mode === "city";
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c._city && !cityOn) continue;
      if (c.y0 != null && c.y0 > 0.45) continue;      // starts above the corpse
      if (c.y1 != null && c.y1 < 0.06) continue;      // floor trim under it
      if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
    }
    return false;
  }
  // the whole length of a lie is clear when feet, hip, chest and crown are
  function dirClear(px, pz, ux, uz) {
    if (pointBlocked(px, pz, 0.30)) return false;
    for (let t = 0.55; t <= BODY_LEN + 0.01; t += 0.55) {
      if (pointBlocked(px + ux * t, pz + uz * t, 0.24)) return false;
    }
    return true;
  }

  /* THE GEOMETRY OF THE FLOP, written down so nobody re-derives it wrong:
     the rig's up axis is +Y and the group's euler is XYZ, so with roll
     rotation.z = s·π/2 the crown ends up at
         feet + BODY_LEN · (-s·cos(yaw), 0, s·sin(yaw)).
     Given a WORLD direction (ux,uz) the body should lie along, either side
     can express it — side +1 wants yaw = atan2(uz, -ux), side -1 wants
     yaw = atan2(-uz, ux) — and which side is used decides which way his
     chest faces, which is the free variety. */
  function lieDir(c) { return { x: -c.side * Math.cos(c.yaw), z: c.side * Math.sin(c.yaw) }; }

  function place(a, killer) {
    if (!on() || !a || !a.group) return;
    /* A MAN KILLED IN HIS CHAIR DIES OUT OF IT. The warden dies seated at
       his desk (adminwing's PRISON_WARDEN_SEATED) and a bunk sleeper dies
       lying in propuse's hold — and in both cases propuse keeps WRITING the
       body's transform every frame for as long as the prop flags stand, so
       the corpse would float at seat height with the flop fighting the hold.
       Release the prop, and put the body on the FLOOR: a prop anchor's y is
       furniture height, never ground. A y earned by standing on something
       real (a crate top) is not prop-held and is kept. */
    const held = !!(a._propSeat || a._propBed || a._propLie || (a.char && (a.char.sitting || a.char.lying)));
    if (held) {
      if (CBZ.propStand) { try { CBZ.propStand(a, { instant: true }); } catch (e) {} }
      if (a.char) { a.char.sitting = false; a.char.lying = false; }
      a._propLie = false;
      a.asleep = false;
      a.group.position.y = 0;
    }
    const p = a.group.position;
    // he falls AWAY from what killed him; an unwitnessed death falls forward
    let ax, az;
    const kg = killer && killer.group ? killer.group.position : (killer && killer.pos) || null;
    if (kg) { ax = p.x - kg.x; az = p.z - kg.z; }
    else { ax = Math.sin(a.group.rotation.y); az = Math.cos(a.group.rotation.y); }
    const al = Math.hypot(ax, az) || 1;
    ax /= al; az /= al;
    const base = Math.atan2(az, ax);
    // fan out from the natural direction until the body fits somewhere
    const FAN = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.5, -2.5, Math.PI];
    let ux = ax, uz = az;
    for (let i = 0; i < FAN.length; i++) {
      const cx = Math.cos(base + FAN[i]), cz = Math.sin(base + FAN[i]);
      if (dirClear(p.x, p.z, cx, cz)) { ux = cx; uz = cz; break; }
    }
    const side = h01(nameOf(a), "side") < 0.5 ? 1 : -1;
    a._corpse = {
      side: side,
      yaw: side > 0 ? Math.atan2(uz, -ux) : Math.atan2(-uz, ux),
      t: SETTLE,
      y0: p.y || 0,
      sw: h01(nameOf(a), "sprawl"),
    };
  }

  // limb sprawl — four pivots, targets rolled once off the man's own name.
  // Damped rather than snapped so the arms fly out WITH the fall.
  function sprawl(a, c, dt) {
    const parts = a.char && a.char.parts;
    if (!parts) return;
    const s = c.sw;
    const d = (o, k, v) => { if (o) o.rotation[k] = CBZ.damp(o.rotation[k], v, 7, dt); };
    d(parts.la, "x", -(0.5 + s * 1.1)); d(parts.la, "z", 0.35 + s * 0.5);
    d(parts.ra, "x", -(1.3 - s * 0.9)); d(parts.ra, "z", -(0.25 + (1 - s) * 0.6));
    d(parts.ll, "x", 0.10 + s * 0.28);  d(parts.ll, "z", 0.16 + s * 0.1);
    d(parts.rl, "x", -(0.05 + (1 - s) * 0.3)); d(parts.rl, "z", -(0.12 + s * 0.14));
  }

  const _end = { x: 0, z: 0 };
  function tick(a, dt) {
    if (!on() || !a || !a.group) return false;
    // a death that never crossed place() — a mover finding `dead` already
    // set — places itself on the first tick, same math, no killer bias.
    const c = a._corpse || (place(a, null), a._corpse);
    if (!c) return false;
    const g = a.group, p = g.position;
    g.rotation.z = CBZ.damp(g.rotation.z, c.side * Math.PI / 2, 9, dt);
    g.rotation.y = CBZ.damp(g.rotation.y, c.yaw, 8, dt);
    p.y = CBZ.damp(p.y, c.y0 + REST_Y, 10, dt);
    sprawl(a, c, dt);
    if (c.t > 0 && CBZ.collide) {
      c.t -= dt;
      // the FEET end — catches the killer's knockback and brawl shoves
      CBZ.collide(p, 0.38, c.y0 + 0.04, c.y0 + 0.42);
      // the HEAD end: resolve the crown's point and carry the push back to
      // the feet, so a body whose head is in a wall slides out along itself
      const u = lieDir(c);
      const prog = Math.min(1, Math.abs(g.rotation.z) / (Math.PI / 2));
      _end.x = p.x + u.x * BODY_LEN * prog;
      _end.z = p.z + u.z * BODY_LEN * prog;
      const hx = _end.x, hz = _end.z;
      CBZ.collide(_end, 0.30, c.y0 + 0.04, c.y0 + 0.42);
      p.x += _end.x - hx;
      p.z += _end.z - hz;
    }
    return true;
  }

  // a revived rig (run reset) must not keep the sprawl in its shoulders
  function clear(a) {
    if (!a) return;
    a._corpse = null;
    const parts = a.char && a.char.parts;
    if (parts) for (const k of ["la", "ra", "ll", "rl"]) {
      if (parts[k]) { parts[k].rotation.z = 0; }
    }
  }

  CBZ.prisonCorpsePlace = place;
  CBZ.prisonCorpseTick = tick;
  CBZ.prisonCorpseClear = clear;
  // diagnostics: how many corpses currently lie with an end inside a wall.
  // The number a probe pins at 0.
  CBZ.prisonCorpseAudit = function () {
    let bodies = 0, inWall = 0;
    const scan = (list) => {
      for (const a of list || []) {
        if (!a || !a.dead || !a.group || !a._corpse) continue;
        bodies++;
        const p = a.group.position, u = lieDir(a._corpse);
        if (pointBlocked(p.x, p.z, 0.18) ||
            pointBlocked(p.x + u.x * BODY_LEN, p.z + u.z * BODY_LEN, 0.14)) inWall++;
      }
    };
    scan(CBZ.npcs); scan(CBZ.guards);
    return { bodies: bodies, inWall: inWall };
  };
})();
