/* ============================================================
   systems/pushprops.js — FURNITURE MOVES WHEN YOU WALK INTO IT.

   OWNER, 2026-08-11: "All assets should be movable... I'm talking physics,
   not another f***ing button."

   Nothing in this prison could be pushed. `systems/physics.js` keeps the
   world as static AABBs in a rebuilt broadphase grid, and the only solids
   that had ever MOVED were doors — world/door.js:32-47 splices its collider
   in and out of `CBZ.colliders` and calls `CBZ.markCollidersDirty()`, and
   world/cellblock.js's thirteen sliding leaves do the same. That is the whole
   precedent, and it is enough: a collider is a plain record, the grid is
   rebuilt on a dirty flag, and nothing anywhere caches a box's coordinates.
   So a pushable prop is not a new physics engine. It is the door trick, run
   every frame, driven by CONTACT instead of by a lock.

   THE RULES, and every one of them is a number a body can feel:

     CONTACT ONLY. There is no prompt, no key, no [E], no HUD. A prop moves
     when a moving body is touching it and moving INTO it, and by exactly the
     component of that body's velocity that points at the prop. Stand still
     against a stool and it stays where it is, because you are not pushing it.

     MASS IS THE WHOLE DESIGN. `PUSH_REF` (18 kg) is the mass a walk shoves at
     full speed. Everything else is that ratio: a 4 kg chalk bucket skitters, a
     9 kg stool slides, a 45 kg mess bench grudges along at a third of your
     pace, a 110 kg loaded plate tree scrapes. Below MIN_V the shove does not
     overcome the prop at all and NOTHING HAPPENS — which is why a bunk, a
     locker, a cage and every bolted table in the compound stay planted. The
     realism is the DIFFERENCE; a world where everything slides equally is as
     fake as one where nothing does.

     THE COLLIDER GOES WITH IT. The record in `CBZ.colliders` is translated by
     the same delta as the mesh and the grid is dirtied once per frame, so the
     moved prop is instantly real to everything that reads the world through
     collision: the player's own depenetration, every guard and inmate steering
     around it, `CBZ.characterTraversal`'s vault/mantle probe, the vent and
     wall probes, `CBZ.queryCollidersNear`. Nothing had to be told.

     ITS PURPOSE GOES WITH IT TOO. A stool that carries a propuse sit anchor
     drags the anchor along, so where you leave the furniture is where a body
     sits down. Furniture that keeps its meaning after it moves is the whole
     difference between a physics toy and a prison.

     IT CANNOT LEAVE ITS ROOM. Walls stop it because walls are colliders and
     the prop is resolved against them exactly like a body is; `leash` and the
     optional `room` rect are the belt-and-braces so a stool cannot be herded
     down a corridor and out of the world by a determined player.

   COST. Distance-gated to `ACTIVE_R` of the player, plus whatever is still
   sliding. A quiet frame is one squared-distance test per registered prop
   (a few dozen) and nothing else. Zero allocation on the hot path, no rng —
   the motion is a pure function of contact, so two clients on one seed that
   see the same shove get the same slide.

   Flag PUSH_PROPS_V1. Ratchet CBZ.pushPropAudit().escaped — props that ended
   up outside their own leash/room, i.e. furniture that got away — pinned at 0.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.PUSH_PROPS_V1 == null) CFG.PUSH_PROPS_V1 = true;

  const props = [];
  CBZ.pushProps = props;

  /* ---- the physical constants, each answering for itself -----------------
     A shove is `drive · efficiency · (PUSH_REF / mass)`, capped at the pusher's
     own speed. Walk speed in the prison is 2.0 m/s and a sprint is 3.4, which
     makes the table concrete:

       cone     2.5 kg   1.60 m/s walked   — skitters off your shin
       bucket   4   kg   1.60             — same, it is under the cap
       stool    9   kg   1.60             — slides a clear half metre a step
       bench   45   kg   0.50             — a scrape you lean into
       tree   110   kg   0.20             — grudging; RUN at it for 0.35
       >150 kg          under MIN_V       — planted. A bunk is not furniture
                                            you rearrange, it is part of the room.

     That last row is the point of the whole table: the realism is the
     DIFFERENCE. Everything sliding equally is exactly as fake as nothing
     sliding at all, and the mass column is the only thing anyone has to tune. */
  const PUSH_REF = 14;        // kg: the mass a body on foot moves at full drive
  const PUSH_EFF = 0.80;      // what survives the awkwardness of shoving with a shin
  const MIN_V = 0.18;         // m/s: below this the shove never breaks stiction
  const MIN_DRIVE = 0.35;     // m/s: a body barely moving is not shoving anything
  const DAMP = 7.0;           // s^-1: steel/plastic on a concrete floor stops fast
  const STOP_V = 0.06;        // m/s: park it
  const SKIN = 0.12;          // m: contact band outside the body's own radius
  const ACTIVE_R = 8.0;       // m from the player: outside this nothing is tested
  const ACTIVE_R2 = ACTIVE_R * ACTIVE_R;
  const MAX_STEP = 0.22;      // m per frame: a shove can never tunnel a prop through a wall
  const BODY_LOW = 0.10, BODY_HIGH = 1.75;   // the band a standing body pushes with

  const qnear = [];
  let dirty = false, movingCount = 0, escaped = 0;

  function meshCollider(m) {
    return (m && m.userData && m.userData.collider) || null;
  }

  /* ---- REGISTER ---------------------------------------------------------
     spec.parts   meshes that move as one body (required)
     spec.x/z     authored centre (defaults to parts[0])
     spec.hx/hz   half-extents of the pushed footprint
     spec.y0/y1   the collider's vertical band (a low prop you brush past keeps
                  its top under physics.js's feet sample and is never a wall)
     spec.mass    kg — the only tuning knob that matters
     spec.solid   create a collider when the art was drawn non-solid
     spec.col     adopt this collider instead of looking one up on the parts
     spec.leash   metres it may stray from where it was built (default 4)
     spec.room    hard rect it may never leave
     spec.seat    {x,z} of a propuse sit anchor that rides along
     Returns the record, or null when the flag is off / the spec is empty. */
  CBZ.pushProp = function (spec) {
    if (!CFG.PUSH_PROPS_V1 || !spec) return null;
    const parts = spec.parts && spec.parts.length ? spec.parts.filter(Boolean) : null;
    if (!parts || !parts.length) return null;
    const p0 = parts[0];
    const x = spec.x != null ? spec.x : p0.position.x;
    const z = spec.z != null ? spec.z : p0.position.z;
    const hx = spec.hx != null ? spec.hx : 0.25, hz = spec.hz != null ? spec.hz : 0.25;
    const y0 = spec.y0 != null ? spec.y0 : 0, y1 = spec.y1 != null ? spec.y1 : 0.5;

    // the collider: adopt one the art already registered, else mint one here.
    // A minted box carries y0/y1 so it is an OBSTACLE at shin height and not a
    // full-height pillar — the same height-gating world/cafeteria.js's stools
    // and mess tables already use.
    let col = spec.col || meshCollider(p0) || null;
    for (let i = 1; !col && i < parts.length; i++) col = meshCollider(parts[i]);
    if (!col && spec.solid !== false) {
      col = { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, y0: y0, y1: y1, ref: p0 };
      (CBZ.colliders || (CBZ.colliders = [])).push(col);
      p0.userData.collider = col;
      dirty = true;
    }
    // a collider drawn without a band would be a full-height wall the moment it
    // moved into a doorway; give it the band its own art implies.
    if (col && col.y0 == null) { col.y0 = y0; col.y1 = Math.max(y1, col.y1 || y1); }

    // THE BATCHER AND THE FREEZER BOTH HAVE TO BE TOLD. core/batch.js:448 bakes
    // any untagged mesh into a merged static buffer and core/staticfreeze.js
    // clears matrixAutoUpdate on it — either one silently welds a "pushable"
    // to the floor. `mover` is losgrid.js's own tag for a solid whose AABB is
    // re-derived per cast. This is the same declaration world/cellblock.js's
    // sliding leaves make, for the same reason.
    for (let i = 0; i < parts.length; i++) {
      const m = parts[i];
      m.userData.dynamic = true;
      m.userData.mover = true;
      m.matrixAutoUpdate = true;
    }

    const rec = {
      parts: parts, col: col, kind: spec.kind || "prop",
      mass: Math.max(1, spec.mass || 12),
      x: x, z: z, hx: hx, hz: hz, y0: y0, y1: y1,
      vx: 0, vz: 0,
      homeX: x, homeZ: z, leash: spec.leash != null ? spec.leash : 4.0,
      room: spec.room || null,
      seatAt: spec.seat || null, seat: null, seatSolved: false,
      moved: 0,                       // total metres this prop has been shoved
    };
    props.push(rec);
    return rec;
  };

  /* ---- the pushers ------------------------------------------------------
     THE ONE THING THIS FILE HAD TO GET RIGHT. A body's realized frame delta
     is USELESS here: the prop is solid, so `CBZ.collide` depenetrates the
     pusher back out on the same frame and a man leaning on a stool at full
     walking pace measures a delta of ~0 mm. Nothing would ever move, and the
     failure would look exactly like "the feature does not work".

     So a push reads DRIVE — what the body is trying to do before a wall has an
     opinion. physics.js has always published `player.speed` (the DESIRED speed)
     and now publishes `player.moveX/moveZ` beside it, one line, same breath.
     An NPC's drive is its own steering: the vector to `target`, which
     entities/npc.js writes and world/cellblock.js's leash clamps, at whatever
     speed the brain last returned. A paused body drives nothing.

     This is also why nothing else has to know about this file: anything that
     aims a body at a stool pushes the stool. */
  const pushers = [];
  function drive(q, a) {
    if (a === CBZ.player) {
      q.dx = a.moveX || 0; q.dz = a.moveZ || 0;
      return;
    }
    if ((a.pause || 0) > 0 || (a.ko || 0) > 0 || !a.target) { q.dx = 0; q.dz = 0; return; }
    const tx = a.target.x - q.x, tz = a.target.z - q.z;
    const l = Math.hypot(tx, tz);
    if (l < 0.25) { q.dx = 0; q.dz = 0; return; }
    const s = a._spd != null ? a._spd : (a.speed || 0);
    q.dx = (tx / l) * s; q.dz = (tz / l) * s;
  }
  function collectPushers(px, pz) {
    pushers.length = 0;
    const P = CBZ.player;
    if (P && P.pos) {
      const q = { a: P, x: P.pos.x, y: P.pos.y, z: P.pos.z, r: P.radius || 0.55, dx: 0, dz: 0 };
      drive(q, P); pushers.push(q);
    }
    const lists = [CBZ.npcs, CBZ.guards];
    for (let L = 0; L < lists.length; L++) {
      const list = lists[L];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a || a.dead || !a.group) continue;
        const g = a.group.position;
        const dx = g.x - px, dz = g.z - pz;
        if (dx * dx + dz * dz > ACTIVE_R2) continue;
        const q = { a: a, x: g.x, y: g.y, z: g.z, r: 0.5, dx: 0, dz: 0 };
        drive(q, a); pushers.push(q);
      }
    }
    return pushers;
  }

  // resolve a candidate footprint against the static world; returns 1 if it hit
  function blocked(rec, nx, nz) {
    if (!CBZ.queryCollidersNear) return 0;
    const reach = Math.max(rec.hx, rec.hz) + 0.6;
    const list = CBZ.queryCollidersNear(nx, nz, reach, qnear);
    const cityOn = !CBZ.game || CBZ.game.mode === "city";
    let hit = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c === rec.col || (c._city && !cityOn)) continue;
      // bands that cannot touch this prop's own band are not in its way
      if (c.y0 != null && (c.y1 <= rec.y0 + 0.02 || c.y0 >= rec.y1 - 0.02)) continue;
      const ox = Math.min(nx + rec.hx, c.maxX) - Math.max(nx - rec.hx, c.minX);
      if (ox <= 0) continue;
      const oz = Math.min(nz + rec.hz, c.maxZ) - Math.max(nz - rec.hz, c.minZ);
      if (oz <= 0) continue;
      hit = 1;
      break;
    }
    return hit;
  }

  // commit a delta: meshes, collider, sit anchor, broadphase
  function translate(rec, dx, dz) {
    rec.x += dx; rec.z += dz;
    for (let i = 0; i < rec.parts.length; i++) {
      const m = rec.parts[i];
      m.position.x += dx; m.position.z += dz;
    }
    const c = rec.col;
    if (c) { c.minX += dx; c.maxX += dx; c.minZ += dz; c.maxZ += dz; dirty = true; }
    // THE ANCHOR MOVES WITH THE FURNITURE. `_ex/_ez` is propuse's cached
    // standing spot, solved against the colliders — clearing it makes the next
    // body that sits re-solve which side of the stool is now walkable.
    const s = rec.seat;
    if (s) { s.x += dx; s.z += dz; s._ex = null; s._ez = null; s._eok = 0; }
    rec.moved += Math.abs(dx) + Math.abs(dz);
  }

  /* ---- THE DRIVER -------------------------------------------------------
     onUpdate(23): after physics.js integrates the player (10) and after
     entities/npc.js moves the crowd (22) — so the deltas above are this
     frame's real motion — and before world/cellblock.js's leash (22.6) reads
     anything back. The grid is dirtied at most once per frame no matter how
     many props moved. */
  let lastElapsed = 0;
  CBZ.onUpdate(23, function (dt) {
    const g = CBZ.game;
    if (!CFG.PUSH_PROPS_V1 || !g || g.mode !== "escape" || !props.length) return;
    if (dt <= 0 || dt > 0.2) dt = Math.min(Math.max(dt, 0.0001), 0.2);

    // a fresh run puts every stick of furniture back where it was built: the
    // world is parse-time geometry and state.js rebuilds none of it, so
    // without this a restart inherits the last player's barricades.
    const el = +g.elapsed || 0;
    if (el < lastElapsed - 0.5) resetProps();
    lastElapsed = el;

    const P = CBZ.player;
    if (!P || !P.pos) return;
    const px = P.pos.x, pz = P.pos.z;
    let near = 0;
    for (let i = 0; i < props.length; i++) {
      const r = props[i];
      const dx = r.x - px, dz = r.z - pz;
      if (dx * dx + dz * dz < ACTIVE_R2) { r._near = 1; near++; }
      else r._near = 0;
    }
    if (!near && !movingCount) return;

    const list = collectPushers(px, pz);
    movingCount = 0;

    for (let i = 0; i < props.length; i++) {
      const r = props[i];
      const idle = r.vx === 0 && r.vz === 0;
      if (!r._near && idle) continue;

      // ---- 1. contact ---------------------------------------------------
      if (r._near) {
        const gain = Math.min(1, PUSH_REF / r.mass) * PUSH_EFF;
        for (let k = 0; k < list.length; k++) {
          const q = list[k];
          if (q.dx === 0 && q.dz === 0) continue;
          // the body has to actually overlap the prop's own height band
          if (q.y + BODY_HIGH <= r.y0 || q.y + BODY_LOW >= r.y1) continue;
          const cx = Math.max(r.x - r.hx, Math.min(q.x, r.x + r.hx));
          const cz = Math.max(r.z - r.hz, Math.min(q.z, r.z + r.hz));
          let nx = q.x - cx, nz = q.z - cz;
          const d2 = nx * nx + nz * nz, reach = q.r + SKIN;
          if (d2 >= reach * reach) continue;
          const d = Math.sqrt(d2);
          if (d < 1e-4) {                       // dead centre: shove along travel
            const vl = Math.hypot(q.dx, q.dz);
            nx = -q.dx / vl; nz = -q.dz / vl;
          } else { nx /= d; nz /= d; }
          // the component of this body's DRIVE that points INTO the prop —
          // walk past a stool and this is ~0, so brushing furniture never
          // bulldozes it; only walking AT it moves it.
          const into = -(q.dx * nx + q.dz * nz);
          if (into < MIN_DRIVE) continue;
          const want = into * gain;
          if (want < MIN_V) continue;           // too heavy for a body on foot
          const wx = -nx * want, wz = -nz * want;
          if (wx * wx + wz * wz > r.vx * r.vx + r.vz * r.vz) { r.vx = wx; r.vz = wz; }
        }
      }

      if (r.vx === 0 && r.vz === 0) continue;

      // ---- 2. integrate, clamped so nothing tunnels ----------------------
      let sx = r.vx * dt, sz = r.vz * dt;
      const sl = Math.hypot(sx, sz);
      if (sl > MAX_STEP) { sx *= MAX_STEP / sl; sz *= MAX_STEP / sl; }
      // axis-separated so a prop sliding along a wall keeps sliding instead of
      // stopping dead on the first corner it clips
      let mx = 0, mz = 0;
      if (sx && !blocked(r, r.x + sx, r.z)) mx = sx; else r.vx = 0;
      if (sz && !blocked(r, r.x + mx, r.z + sz)) mz = sz; else r.vz = 0;

      // ---- 3. the leash and the room -------------------------------------
      if (mx || mz) {
        let nx2 = r.x + mx, nz2 = r.z + mz;
        const rm = r.room;
        if (rm) {
          if (nx2 < rm.x0) { nx2 = rm.x0; r.vx = 0; } else if (nx2 > rm.x1) { nx2 = rm.x1; r.vx = 0; }
          if (nz2 < rm.z0) { nz2 = rm.z0; r.vz = 0; } else if (nz2 > rm.z1) { nz2 = rm.z1; r.vz = 0; }
        }
        const lx = nx2 - r.homeX, lz = nz2 - r.homeZ, ll = Math.hypot(lx, lz);
        if (ll > r.leash) {
          const k = r.leash / ll;
          nx2 = r.homeX + lx * k; nz2 = r.homeZ + lz * k;
          r.vx = 0; r.vz = 0;
        }
        mx = nx2 - r.x; mz = nz2 - r.z;
        if (mx || mz) translate(r, mx, mz);
      }

      // ---- 4. friction ----------------------------------------------------
      const k = Math.exp(-DAMP * dt);
      r.vx *= k; r.vz *= k;
      if (r.vx * r.vx + r.vz * r.vz < STOP_V * STOP_V) { r.vx = 0; r.vz = 0; }
      else movingCount++;
    }

    if (dirty) { dirty = false; if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
  });

  /* ---- the sit anchors, resolved once ------------------------------------
     The propuse registries are filled on the first escape tick (world/
     cellblock.js drains its own queue there), so a prop registered at PARSE
     time cannot hold its anchor yet. One lazy lookup by coordinate, once. */
  CBZ.onUpdate(23.05, function () {
    const g = CBZ.game;
    if (!g || g.mode !== "escape" || !CBZ.propNearestSeat) return;
    for (let i = 0; i < props.length; i++) {
      const r = props[i];
      if (r.seatSolved || !r.seatAt) continue;
      r.seatSolved = true;
      try { r.seat = CBZ.propNearestSeat(r.seatAt.x, r.seatAt.z, 0.35, 0) || null; } catch (e) { r.seat = null; }
    }
  });

  function resetProps() {
    for (let i = 0; i < props.length; i++) {
      const r = props[i];
      r.vx = 0; r.vz = 0;
      const dx = r.homeX - r.x, dz = r.homeZ - r.z;
      if (dx || dz) translate(r, dx, dz);
      r.moved = 0;
    }
    if (dirty) { dirty = false; if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
  }
  CBZ.pushPropsReset = resetProps;

  /* ---- THE RATCHET -------------------------------------------------------
     `escaped` is the invariant that makes a pushable safe to ship: furniture
     may be moved anywhere its room allows and NOWHERE ELSE. A prop outside
     its own leash or room rect is a stool somebody walked out of the prison,
     and there is no legitimate way for that number to be anything but zero.
     `unbatched` is the OTHER silent failure — a part core/batch.js would have
     welded into a static buffer — checked here rather than trusted. */
  CBZ.pushPropAudit = function () {
    escaped = 0;
    let unbatched = 0, movedNow = 0, totalMoved = 0, minted = 0;
    const byKind = {};
    for (let i = 0; i < props.length; i++) {
      const r = props[i];
      const d = Math.hypot(r.x - r.homeX, r.z - r.homeZ);
      if (d > r.leash + 0.05) escaped++;
      if (r.room && (r.x < r.room.x0 - 0.05 || r.x > r.room.x1 + 0.05
        || r.z < r.room.z0 - 0.05 || r.z > r.room.z1 + 0.05)) escaped++;
      for (let k = 0; k < r.parts.length; k++)
        if (!(r.parts[k].userData && r.parts[k].userData.dynamic)) unbatched++;
      if (r.vx || r.vz) movedNow++;
      if (r.moved > 0.02) totalMoved++;
      if (r.col) minted++;
      byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    }
    return {
      on: !!CFG.PUSH_PROPS_V1, props: props.length, kinds: byKind,
      withCollider: minted, seats: props.filter(function (r) { return !!r.seat; }).length,
      escaped: escaped, unbatched: unbatched,
      sliding: movedNow, shoved: totalMoved,
      refMass: PUSH_REF, damp: DAMP, minSpeed: MIN_V, activeR: ACTIVE_R,
    };
  };
})();
