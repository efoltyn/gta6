/* ============================================================
   systems/bodymove.js — ONE MOVER FOR A HUMAN BODY, AND THE NET UNDER IT.

   OWNER (2026-10-22): "bodies go through walls and doors ... it should have
   been a DEEP collider fix, not a cheap doors-and-walls fix."

   THE DISEASE. About seventy places moved a person by writing his position
   directly: the verb holds (escort, drag, carry), knockback slides, thrown
   flights, the collapse skid, car flings, custody marches, crowd shoves,
   AI fallback steering. Each one either called CBZ.collide afterwards (a
   PUSH-OUT: it only sees where the body ended up, and a body whose centre
   crossed a thin door leaf's middle leaves by the far face) or nothing at
   all. Patching them one at a time is why it kept coming back.

   THE CURE IS TWO THINGS.

   1. CBZ.bodyMove(actor, dx, dy, dz, opts) -> res
      THE mover. Every system that moves a human body other than by walking
      it on CBZ.moves (which collides every substep) goes through this. It
      sweeps the body's circle along the step against EVERYTHING the walker
      collides with (CBZ.sweepCircle: the collider grid, so closed door
      leaves, mesh colliders from meshcollider.js, oriented walls, height
      bands; plus the road cars for an upright body), stops on the first
      face, spends the rest of the step sliding along it (up to three faces:
      a corner), clears any residual overlap with CBZ.collide, then moves y
      and (opts.floor) stands it on the walker's own floor (walkGroundAt:
      terrain + platforms + solid step tops, so a curb or a stair riser up to
      the walker's step height is stepped onto, never walked through).
      Allocation-free.

        actor   an actor record ({pos} / {group}) or a bare position {x,y,z}
        opts    {
          posture   "stand" | "down"    default from the actor (dead / KO /
                                        in a collapse / thrown = "down")
          radius    sweep radius        stand 0.3, down 0.25
          baseY     the floor level the band is measured from (default the
                    root's y; a lying root lifted off the floor passes it)
          feet      band bottom above baseY  (stand 0.42 = the walker's step
                    line, down 0.2)
          height    band top above baseY     (stand 1.7, down 0.7)
          cars      false = the road cars are not solid to it (default: solid
                    to an upright body)
          reachX/Z  a lying body's far end (its head) relative to the root:
                    swept root -> far end, the root pulled back by what the
                    wall took, so a head is never left through a wall
          clear     false = skip the overlap clear (CBZ.collide)
          clearRadius   radius for that clear (default radius)
          floor     true = land on CBZ.walkGroundAt; a function(x,z,fromY)
                    = land on that floor instead
          stepUp    how far above the higher of the old and new root the
                    floor may be found (walker ground: 0.45 standing, 0.05
                    down; a caller's floor function: 0)
          out       result record to fill (default a module scratch)
        }
        res = { hit, nx, nz, c, pushed, landed, y, floor }
          hit     a face stopped the sweep; nx,nz its outward normal, c the
                  collider (a car's solid has c._car)
          pushed  the overlap clear moved it (nx,nz = that push when !hit)
          landed  opts.floor and the body is on it
          y       the root's y after the move; floor the floor found

   2. THE NET (onUpdate 99.97 — after every mover, before anything is drawn).
      Whoever wrote the position, nobody ends a frame past a wall. For every
      NPC body (CBZ.cityPeds, CBZ.cityCops, CBZ.guards, CBZ.npcs, CBZ.bots,
      and anything CBZ.bodyNet.track()ed), if the root moved since the net
      last settled it, the segment last -> now is swept with a thin CORE
      circle (0.12 m). A body that only touched a wall with its shoulder
      never trips it; a body whose middle crossed a face is put back at the
      contact and the rest of its move slides along the face, then cleared
      of overlap. Bodies the net leaves alone, and why:
        - THE PLAYER. His walking is physics.js's own resolver (sub-stepped
          collide every frame), and every OTHER way he is moved (knockback,
          verbs, the capture march, a shoulder's give) now goes through
          bodyMove above. What is left writing P.pos is ~60 scripted
          relocations (vehicle in/out, interiors, vents, elevators, origins,
          campaign beats, respawns), every one a deliberate cut through
          geometry: netting him would pin him at the first door he is meant
          to be placed past.
        - explicit relocations: CBZ.bodyTeleported(actor) that frame (spawn,
          enter/exit a vehicle, elevator cab swap, cinematic cut, respawn,
          an authored furniture anchor) — and any jump over NET_TELE (6 m)
          in one frame, which no body covers (dt is capped at 0.1 s; the
          hardest car fling is ~30 m/s = 3 m) and so is a relocation nobody
          marked: sweeping it would pull a respawned man back to the first
          wall between his corpse and his bed
        - a body in a vehicle, on a ladder, in a vault/mantle (the traversal
          lifts it OVER the obstacle it crosses), held by furniture (a seat,
          a bunk: authored anchors overlap the furniture's own collider), or
          owned by the ragdoll solver (its 13 points are each swept against
          the same colliders, debris.js looseContact)
        - FAR PLAIN WALKERS: upright, in no verb, moved under WALK_SAFE this
          frame and more than FAR_SKIP from the camera. Their mover
          (CBZ.moves / collideSlide) left them clear of every wall by their
          own 0.38-0.5 m radius last frame, so a core that moved less than
          that cannot reach a face; the near ones are checked regardless.
      Cost: one bucket walk per MOVING body (the sweep's AABB reject first),
      none for a still one.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const STEP_SOLID = 0.42;          // physics.js: a walker's feet band is raised this much
  const STAND_R = 0.3, DOWN_R = 0.25;
  const STAND_H = 1.7, DOWN_FEET = 0.2, DOWN_H = 0.7;
  const STEP_UP_STAND = 0.45, STEP_UP_DOWN = 0.05;
  const NET_CORE = 0.12;            // the net's circle: a crossing, not a touch
  const NET_EPS = 0.02;             // moved less than 2 cm: nothing to check
  const NET_TELE = 6;               // further than this in one frame = a relocation
  const WALK_SAFE = 0.3, FAR_SKIP = 40;

  const RES = { hit: false, nx: 0, nz: 0, c: null, pushed: false, landed: false, y: 0, floor: -Infinity };
  const NO = {};
  const _a = { x: 0, z: 0 }, _b = { x: 0, z: 0 };
  const _s = { hit: false, t: 1, x: 0, z: 0, nx: 0, nz: 0, c: null };
  const _so = { cars: false, self: null };
  const _hA = { x: 0, z: 0 }, _hB = { x: 0, z: 0 };

  // ---- whose position is it -------------------------------------------
  // The player's authority is CBZ.player.pos (the rig follows it). Every
  // other actor's root is its group (a city ped's pos IS group.position).
  function posOf(a) {
    if (!a) return null;
    if (a === CBZ.player) return a.pos || null;
    if (a.isVector3 || (typeof a.x === "number" && typeof a.z === "number" && a.group === undefined && a.pos === undefined)) return a;
    const g = a.group;
    if (g && g.position) return g.position;
    const p = a.pos;
    return p && typeof p.x === "number" ? p : null;
  }
  function phys(a) { return a && (a._phys || null); }
  function isDown(a) {
    if (!a || a.isVector3) return false;
    if (a.dead || a.ko > 0 || a.downed || a._verbDown) return true;
    if (a._bf && a._bf.on) return true;
    const p = phys(a);
    return !!(p && (p.down > 0 || p.air));
  }

  /* THE SLIDE. Move (pos.x, pos.z) by (dx, dz) as a swept circle: stop on
     the first face, spend the rest of the step along it, at most three faces.
     Fills res.hit/nx/nz/c with the LAST face met. */
  function slide(p, dx, dz, r, feet, head, cars, res) {
    if (!CBZ.sweepCircle) { p.x += dx; p.z += dz; return; }
    _so.cars = cars; _so.self = p;
    _a.x = p.x; _a.z = p.z; _b.x = p.x + dx; _b.z = p.z + dz;
    for (let k = 0; k < 3; k++) {
      if (!CBZ.sweepCircle(_a, _b, r, feet, head, _s, _so)) { p.x = _b.x; p.z = _b.z; _so.self = null; return; }
      res.hit = true; res.nx = _s.nx; res.nz = _s.nz; res.c = _s.c;
      const rx = _b.x - _s.x, rz = _b.z - _s.z;
      const into = rx * _s.nx + rz * _s.nz;
      _a.x = _s.x; _a.z = _s.z;
      _b.x = _s.x + rx - (into < 0 ? into * _s.nx : 0);
      _b.z = _s.z + rz - (into < 0 ? into * _s.nz : 0);
    }
    p.x = _a.x; p.z = _a.z;
    _so.self = null;
  }

  function bodyMove(actor, dx, dy, dz, opts) {
    opts = opts || NO;
    const res = opts.out || RES;
    res.hit = false; res.nx = 0; res.nz = 0; res.c = null; res.pushed = false; res.landed = false; res.floor = -Infinity;
    const p = posOf(actor);
    if (!p) { res.y = 0; return res; }
    const down = opts.posture ? opts.posture !== "stand" : isDown(actor);
    const r = opts.radius != null ? opts.radius : (down ? DOWN_R : STAND_R);
    const y0 = p.y || 0;
    const base = opts.baseY != null ? opts.baseY : y0;
    const feet = base + (opts.feet != null ? opts.feet : (down ? DOWN_FEET : STEP_SOLID));
    const head = base + (opts.height != null ? opts.height : (down ? DOWN_H : STAND_H));
    dx = +dx || 0; dz = +dz || 0;
    if (dx || dz) slide(p, dx, dz, r, feet, head, !down && opts.cars !== false, res);
    // a lying body's far end: what the wall takes off the head comes off the root
    const hx = +opts.reachX || 0, hz = +opts.reachZ || 0;
    if ((hx || hz) && CBZ.sweepCircle) {
      _hA.x = p.x; _hA.z = p.z; _hB.x = p.x + hx; _hB.z = p.z + hz;
      if (CBZ.sweepCircle(_hA, _hB, r * 0.8, feet, head, _s)) {
        p.x += _s.x - _hB.x; p.z += _s.z - _hB.z;
        if (!res.hit) { res.hit = true; res.nx = _s.nx; res.nz = _s.nz; res.c = _s.c; }
      }
      // and the far end clear of overlap too: the whole body shifts by its push
      if (opts.clear !== false && CBZ.collide) {
        _hB.x = p.x + hx; _hB.z = p.z + hz;
        const bx = _hB.x, bz = _hB.z;
        CBZ.collide(_hB, opts.clearRadius || r, feet, head);
        p.x += _hB.x - bx; p.z += _hB.z - bz;
      }
    }
    if (opts.clear !== false && CBZ.collide) {
      const bx = p.x, bz = p.z;
      CBZ.collide(p, opts.clearRadius || r, feet, head);
      const px = p.x - bx, pz = p.z - bz, pd = Math.sqrt(px * px + pz * pz);
      if (pd > 1e-3) { res.pushed = true; if (!res.hit) { res.nx = px / pd; res.nz = pz / pd; } }
    }
    dy = +dy || 0;
    if (dy) p.y = y0 + dy;
    if (opts.floor) {
      const own = typeof opts.floor === "function";
      const G = own ? opts.floor : (CBZ.walkGroundAt || CBZ.groundAt || null);
      if (G) {
        // the floor is asked from the higher of the old and new root. The
        // walker's ground already reaches a step (0.45) above what it is
        // given, so it is handed that much less; a caller's own floor gets
        // the height plus stepUp (default 0) as it is.
        const top = y0 > p.y ? y0 : p.y;
        const up = opts.stepUp != null ? opts.stepUp : (own ? 0 : (down ? STEP_UP_DOWN : STEP_UP_STAND));
        const f = G(p.x, p.z, own ? top + up : top + up - STEP_UP_STAND);
        if (isFinite(f)) {
          res.floor = f;
          if (p.y <= f) { p.y = f; res.landed = dy <= 0; }
        }
      }
    }
    res.y = p.y;
    return res;
  }
  CBZ.bodyMove = bodyMove;

  // ============================================================
  //  THE NET
  // ============================================================
  let frame = 1;
  const tracked = [];
  const stats = { frame: 0, bodies: 0, swept: 0, caught: 0, skipped: 0, teleports: 0 };
  // one line at every site that RELOCATES a body on purpose
  CBZ.bodyTeleported = function (actor) {
    if (!actor) return;
    try { actor._bnTp = frame; } catch (e) { /* frozen record */ }
  };

  /* A BODY THE FURNITURE OWNS (a seat, a bunk, a bed, a sit/lie arc). Its
     anchor legitimately overlaps the piece's own collider; neither the net
     nor actorcollide's clamp may shove it off. */
  function furnitureHeld(a) {
    if (CBZ.CONFIG && CBZ.CONFIG.SIT_PHYS_V1 === false) return false;
    return !!(a._propSeat || a._propBed || a._propLie
      || (a.char && (a.char.sitting || a.char.lying))
      || (CBZ.propArcActive && CBZ.propArcActive(a)));
  }
  CBZ.bodyFurnitureHeld = furnitureHeld;

  function exempt(a) {
    // riding (a car seat, a chopper, a van's bench), climbing, or the verlet's
    if (a.inCar || a.driving || a._vehicle || a._npcAttached || a._airPilot || a._swatPassenger ||
      a._climb || a._ladder || a._ragSlot != null || a._parked || a.culled || a.removed || a.despawned) return true;
    if (a._traversal) return true;
    if (a.enterT > 0) return true;                     // "inside" a building, hidden
    return furnitureHeld(a);
  }

  const _from = { x: 0, z: 0 };
  const _ns = { hit: false, t: 1, x: 0, z: 0, nx: 0, nz: 0, c: null };
  const _nres = { hit: false, nx: 0, nz: 0, c: null, pushed: false, landed: false, y: 0, floor: -Infinity };
  function stamp(a, p, f) { a._bnX = p.x; a._bnZ = p.z; a._bnF = f; }

  // early: a mid-frame settle (CBZ.bodyNet.settle) — checks and moves the
  // reference up to the corrected spot, but leaves the frame to the net
  function netOne(a, f, cx, cz, VB, early) {
    if (!a || a._bnF === f) return;                    // listed twice (a cop in cityPeds)
    const p = posOf(a);
    if (!p) return;
    if (!early) stats.bodies++;
    if (a._bnTp === f || a._bnF !== f - 1 || exempt(a)) {
      if (early) return;
      if (a._bnTp === f) stats.teleports++;
      stamp(a, p, f); return;
    }
    const dx = p.x - a._bnX, dz = p.z - a._bnZ, d2 = dx * dx + dz * dz;
    if (d2 < NET_EPS * NET_EPS) { if (!early) a._bnF = f; return; }     // (ref kept: a slow creep still adds up)
    if (d2 > NET_TELE * NET_TELE || !(d2 === d2)) {
      if (early) return;
      stats.teleports++; stamp(a, p, f); return;
    }
    const down = isDown(a);
    if (!early && !down && d2 < WALK_SAFE * WALK_SAFE && !(VB && VB.sessionOf && VB.sessionOf(a))) {
      const ox = p.x - cx, oz = p.z - cz;
      if (ox * ox + oz * oz > FAR_SKIP * FAR_SKIP) { stats.skipped++; stamp(a, p, f); return; }
    }
    stats.swept++;
    const y = p.y || 0;
    const feet = y + (down ? DOWN_FEET : STEP_SOLID), head = y + (down ? DOWN_H : STAND_H);
    _from.x = a._bnX; _from.z = a._bnZ;
    _so.cars = false; _so.self = p;
    const hit = CBZ.sweepCircle(_from, p, NET_CORE, feet, head, _ns, _so);
    _so.self = null;
    if (hit) {
      stats.caught++;
      // back to where it was, then the move again as a sweep: stopped on the
      // face it crossed, the rest slid along it, the overlap cleared
      p.x = _from.x; p.z = _from.z;
      _nres.hit = false;
      slide(p, dx, dz, NET_CORE, feet, head, false, _nres);
      if (CBZ.collide) CBZ.collide(p, down ? DOWN_R : STAND_R, feet, head);
      a._bnHitF = f; a._bnNx = _ns.nx; a._bnNz = _ns.nz;
      // whatever velocity drove it there is spent against the face
      const ph = phys(a);
      if (ph) {
        let vn = (ph.vx || 0) * _ns.nx + (ph.vz || 0) * _ns.nz;
        if (vn < 0) { ph.vx -= vn * _ns.nx; ph.vz -= vn * _ns.nz; }
        vn = (ph.kx || 0) * _ns.nx + (ph.kz || 0) * _ns.nz;
        if (vn < 0) { ph.kx -= vn * _ns.nx; ph.kz -= vn * _ns.nz; }
      }
    }
    if (early) { a._bnX = p.x; a._bnZ = p.z; }
    else stamp(a, p, f);
  }

  function netList(list, f, cx, cz, VB) {
    if (!list) return;
    for (let i = 0; i < list.length; i++) netOne(list[i], f, cx, cz, VB);
  }

  function net() {
    if (!CBZ.sweepCircle) return;
    const f = frame;
    stats.frame = f; stats.bodies = 0; stats.swept = 0; stats.caught = 0; stats.skipped = 0; stats.teleports = 0;
    const cam = CBZ.camera && CBZ.camera.position, P = CBZ.player;
    const cx = cam ? cam.x : (P && P.pos ? P.pos.x : 0), cz = cam ? cam.z : (P && P.pos ? P.pos.z : 0);
    const VB = CBZ.verbs;
    netList(CBZ.cityPeds, f, cx, cz, VB);
    netList(CBZ.cityCops, f, cx, cz, VB);
    netList(CBZ.guards, f, cx, cz, VB);
    netList(CBZ.npcs, f, cx, cz, VB);
    netList(CBZ.bots, f, cx, cz, VB);
    for (let i = tracked.length - 1; i >= 0; i--) {
      const a = tracked[i];
      if (!a || a.removed || a.despawned || (a.group && !a.group.parent && a.group.isObject3D)) { tracked.splice(i, 1); continue; }
      netOne(a, f, cx, cz, VB);
    }
    frame++;
  }

  CBZ.bodyNet = {
    // a human body no standard roster holds (a prison corpse record, a
    // scripted extra): the net watches it until it leaves the scene
    track: function (a) { if (a && tracked.indexOf(a) < 0) tracked.push(a); },
    untrack: function (a) { const i = tracked.indexOf(a); if (i >= 0) tracked.splice(i, 1); },
    run: net,
    /* settle(actor) -> nothing. The net for ONE body, NOW, mid-frame: a
       resolver about to push-out a body (actorcollide's clamp) first takes
       back whatever crossed a face since the last frame, so the push-out
       cannot finish the tunnel by leaving through the far face. The frame's
       own net still runs over the body later, from the corrected spot. */
    settle: function (a) {
      if (!CBZ.sweepCircle || !a) return;
      if (a === CBZ.player) return;            // (the player is not netted: see THE NET above)
      netOne(a, frame, 0, 0, CBZ.verbs, true);
    },
    stats: stats,
    frame: function () { return frame; },
    CORE: NET_CORE, TELE: NET_TELE,
  };
  if (CBZ.onUpdate) CBZ.onUpdate(99.97, net);
})();
