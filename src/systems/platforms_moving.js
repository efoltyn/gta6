/* ============================================================
   systems/platforms_moving.js — THE MOVING PLATFORM PRIMITIVE

   WHY THIS EXISTS
   ---------------
   `CBZ.platforms` (config.js) is a flat array of WORLD-SPACE STATIC AABBs
   — {minX,maxX,minZ,maxZ,top,ramp?}. 90 registration sites across 20+
   files, and every single one of them is static. The moment the thing
   under your feet turns, that record is a lie: its AABB was computed for
   a heading the parent no longer has. So in a game with boats, lifts,
   trucks and an airliner, NOTHING in this engine can be walked on while
   it moves. `city/elevators.js` — the supposed gold standard — is a
   SEALED CAB that TELEPORTS you at the end of the ride rather than
   carrying you. That is the shape of the hole.

   WHAT THIS IS
   ------------
   ONE primitive: a rig that keeps its walk surfaces and its solid boxes
   in the PARENT'S LOCAL FRAME and transforms queries in, so the surface
   is correct at any pose. Adoption is one line:

     CBZ.movingPlatform(boat.group, { decks: [{x:0, z:0, w:4, d:9, top:1.1}] });

   and the deck is walkable, forever, wherever that group goes.

   THE FIVE THINGS THAT ARE EASY TO GET WRONG (and how we handle them)
   ------------------------------------------------------------------
   1. ORDER OF OPERATIONS. The platform must move BEFORE the character
      resolves or you get a one-frame lag that reads as sink/pop jitter.
      `updatePlayer` is CBZ.onUpdate(10). We tick at 9.5. Every rig reads
      its parent's pose and carries its riders BEFORE physics runs, and
      physics then queries the SAME pose we just latched. Note that
      `world/disaster_arena.js` used to drive its lift at onUpdate(29) —
      i.e. 19 priority steps AFTER the player had already resolved
      against last frame's platform top. That is the bug, in the repo,
      today; migrating it fixes it.

   2. DELTA-TRANSFORM, NOT SCENE-GRAPH PARENTING. Nothing in this engine
      parents the player into a moving Object3D; `player.pos` is written
      by explicit .set() every frame and a dozen systems read it as world
      space. Keep it that way. Per frame, for each rider:

        local   = inverse(platformPrev) * riderPos
        riderPos = platformNow * local

      That ONE composition handles translation AND revolution about the
      pivot correctly. Applying a yaw delta to the rider's FACING without
      revolving their POSITION about the pivot is the classic bug — a
      rider near the deck edge spins in place instead of being carried
      through the arc, which is glaring on a turning yacht.

   3. CAMERA YAW IS OFF BY DEFAULT. Rotating the rider's BODY facing with
      the deck looks physically right and nobody notices. Rotating their
      CAMERA reads as the game grabbing the mouse and it destroys aim
      muscle memory. `camYaw` exists as an opt-in for a heavily damped
      slow turntable (a big yacht making a lazy turn) and defaults FALSE.

   4. LEAVING. Riding is decided from the SUPPORT the ground query
      returned — the rider's feet are literally ON the deck plane
      (|feetY − deckTop| <= STICK_EPS) — never from a proximity test.
      Jumping off a moving deck must throw you: we inherit the platform
      velocity AT THE RIDER'S OWN POINT (which, because it is measured as
      the rider's own frame-to-frame displacement, already includes the
      ω × r term — a rider at the bow of a turning boat is flung
      differently from one at the pivot). `onLeave` mirrors Godot's
      CharacterBody3D `platform_on_leave`: "upward" (default — inherit,
      but DISCARD a downward vertical component, because naively summing
      a descending lift's velocity into a jump cancels the jump),
      "full", or "none". The carry itself is per-frame delta only and
      never accumulates, which is the conveyor bug's cure.

   5. TILT. A deck on a boat pitches and rolls. We apply the rig's FULL
      orientation to the DECK HEIGHT at the query point — exactly, via
      row 1 of the parent's rotation matrix, not a small-angle fudge —
      so standing at the bow of a pitching hull genuinely raises and
      lowers you. That is what the player feels. We deliberately DO NOT
      apply pitch/roll to the collision test or to the deck's XZ
      footprint: at a real vessel's angles (< 0.3 rad) the footprint
      error is under 5%, and full 3-DOF wall collision would cost far
      more than it buys. Documented, not hidden.

   SCOPE, HONESTLY: this is a delta-transform rig for bodies standing on
   a deck. It is NOT a local-space "rest frame" simulator. If you ever
   need a genuine walkable INTERIOR with its own static geometry moving
   through the world, that is a different, much larger thing — and the
   repo already has the right answer to the boundary problem
   (`city/aircraft_doors.js`'s phased walk→open→step→handover→close arc
   hands the character over at ONE scripted beat). Do not invent a
   continuous frame blend.

   ...AND THAT WALKABLE INTERIOR NOW EXISTS, BUILT ON TOP OF THIS FILE
   RATHER THAN BESIDE IT: `city/vehicle_hold.js` (`CBZ.vehicleHold`) is a
   ROOM inside a vehicle — a cargo plane's hold, later a semi's trailer.
   It owns the room's furniture, its ramp door arc, and the latching of
   VEHICLES and CARGO; it owns no surface maths of its own. Its floor,
   its ramp and its hull walls are ONE rig declared here, which is why
   the two additions this file grew for it are both generalisations and
   not special cases: LOCAL RAMPS on a deck (the same record shape
   physics.js already reads off a static platform) and LIVE DECK
   RECORDS via `handle.decks()` (a deck that animates is still a deck).

   THE TWO PHYSICS SEAMS (systems/physics.js, both feature-detected AND
   flag-gated, so absent or off the engine is byte-identical to before):
     • groundAt()  → `if (CBZ.mpGroundAt) { const t = CBZ.mpGroundAt(...) }`
     • collide()   → `if (CBZ.mpCollide) CBZ.mpCollide(...)`
   Nothing else in physics.js is touched. Its signature and its math are
   frozen by contract and by its own in-file comment.

   PUBLISHES
     CBZ.movingPlatform(parent, spec) -> handle
     CBZ.movingPlatformCount()        -> live rig count
     CBZ.movingPlatformRiding()       -> the rig the player is standing on, or null
     CBZ.movingPlatformAudit()        -> THE RATCHET (see the ledger below)
     CBZ.mpGroundAt / CBZ.mpCollide   -> the physics.js seams (internal)

   FLAG: CBZ.CONFIG.MOVING_PLATFORMS (default true) — one-line revert.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CF = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CF.MOVING_PLATFORMS == null) CF.MOVING_PLATFORMS = true;

  // MUST MATCH systems/physics.js's STEP_UP. A deck more than this above
  // your feet is not support — same law the static platform loop obeys, so
  // you cannot ride a lift up a sheer wall you were never standing on.
  const STEP_UP = 0.45;
  // How close the feet must be to the deck plane to count as RIDING it.
  // physics.js glues `player.pos.y = support` exactly, so at rest this is 0;
  // the epsilon only covers float error and the feel-substep loop.
  const STICK_EPS = 0.06;
  // A single-frame carry larger than this is a TELEPORT, not motion (a world
  // rebuild, a vehicle respawn, a mission warp). We resync and carry nobody —
  // this is the guard between "the boat moved" and "the player was flung
  // 900 metres because a generator re-seated its parent".
  const MAX_STEP = 6.0;          // m per tick
  const MAX_YAW_STEP = 1.0;      // rad per tick
  const MAX_CARRY_V = 25;        // m/s cap on inherited horizontal velocity
  // Cap on inherited VERTICAL velocity. Deliberately small: physics.js's
  // FALL_SAFE is 11.0 m/s and a jump leaves at T.jumpVel ≈ 8.2, so anything
  // above ~2.5 would let a jump off a fast rising lift land you into fall
  // damage you did nothing to earn.
  const MAX_CARRY_VY = 2.0;      // m/s
  const LAUNCH_TTL = 2.5;        // s the inherited velocity survives in the air
  const MAX_RIGS = 64;           // sanity bound; a 65th rig degrades to inert
  const TAU = Math.PI * 2;

  const rigs = [];
  let nDeck = 0, nWall = 0;      // active rigs carrying decks / walls (early-out counters)
  let nLate = 0;                 // ...of which run on the LATE pass (12.8)
  let riding = null;             // the rig the player is standing on right now
  let lastVx = 0, lastVz = 0, lastVy = 0;   // rider-point platform velocity, last ridden frame
  const launch = { vx: 0, vz: 0, t: 0 };
  let warnedCap = false;

  function angDelta(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }
  function clampAbs(v, m) { return v > m ? m : (v < -m ? -m : v); }

  // ---- POSE ---------------------------------------------------------------
  // A rig's pose is position + yaw/pitch/roll, PLUS the baked terms every
  // query needs: cos/sin of yaw (the XZ frame) and row 1 of the full rotation
  // matrix (the exact world-Y of a local point). Baking once per tick is what
  // makes the per-query cost a handful of multiplies.
  function newPose() {
    return { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, c: 1, s: 0, mx: 0, my: 1, mz: 0 };
  }
  function copyPose(src, dst) {
    dst.x = src.x; dst.y = src.y; dst.z = src.z;
    dst.yaw = src.yaw; dst.pitch = src.pitch; dst.roll = src.roll;
    dst.c = src.c; dst.s = src.s; dst.mx = src.mx; dst.my = src.my; dst.mz = src.mz;
  }
  // Row 1 (the world-Y row) of THREE's Euler-'XYZ' rotation matrix, which is
  // the order every Object3D in this repo uses by default:
  //   worldY(local) = mx*lx + my*ly + mz*lz
  // with a=cos(pitch) b=sin(pitch) c=cos(yaw) d=sin(yaw) e=cos(roll) f=sin(roll):
  //   mx = a*f + b*e*d,  my = a*e - b*f*d,  mz = -b*c
  // Sanity: pitch=roll=0 → (0,1,0) i.e. worldY = ly, flat, byte-identical to a
  // static platform record.
  function bakePose(p) {
    p.c = Math.cos(p.yaw); p.s = Math.sin(p.yaw);
    const a = Math.cos(p.pitch), b = Math.sin(p.pitch);
    const e = Math.cos(p.roll), f = Math.sin(p.roll);
    p.mx = a * f + b * e * p.s;
    p.my = a * e - b * f * p.s;
    p.mz = -b * p.c;
  }

  // Read the parent's live transform into `out`. Three accepted parent shapes,
  // in the order they are tested:
  //   • a function(out) -> {x,y,z,yaw[,pitch,roll]}  (callers with no object)
  //   • an Object3D (or anything with .position and .rotation)
  //   • any record with {position|pos} and {heading}  (a vehicles.js car:
  //     vehicles.js writes `car.group.rotation.y = car.heading`, so the two
  //     conventions agree and the LOCAL frame is the model's own frame)
  function readPose(rig, out) {
    const src = rig.src;
    if (rig.fn) {
      const r = src(rig.scratch) || rig.scratch;
      out.x = +r.x || 0; out.y = +r.y || 0; out.z = +r.z || 0;
      out.yaw = +r.yaw || 0;
      out.pitch = +r.pitch || 0; out.roll = +r.roll || 0;
    } else {
      const p = src.position || src.pos;
      if (!p) return false;
      out.x = p.x; out.y = p.y; out.z = p.z;
      const rot = src.rotation;
      if (rot) { out.yaw = rot.y; out.pitch = rot.x; out.roll = rot.z; }
      else {
        out.yaw = src.heading != null ? src.heading : 0;
        out.pitch = src._pitch || 0; out.roll = src._roll || 0;
      }
    }
    if (!rig.tilt) { out.pitch = 0; out.roll = 0; }
    // `yaw:false` = this rig ignores its parent's heading entirely: a purely
    // TRANSLATING platform (a lift, a piston). Riders are carried but never
    // revolved, and the local frame stays world-axis-aligned about the pivot.
    if (!rig.yaw) out.yaw = 0;
    if (!(out.x === out.x) || !(out.y === out.y) || !(out.z === out.z)) return false;   // NaN parent: refuse
    bakePose(out);
    return true;
  }

  // world XZ -> local XZ, yaw only (see the TILT note in the header)
  //   lx = dx*c - dz*s ; lz = dx*s + dz*c
  // local XZ -> world XZ
  //   wx = px + lx*c + lz*s ; wz = pz - lx*s + lz*c
  const _l = { x: 0, z: 0 };
  function toLocalXZ(p, x, z, out) {
    const dx = x - p.x, dz = z - p.z;
    out.x = dx * p.c - dz * p.s;
    out.z = dx * p.s + dz * p.c;
    return out;
  }

  // World Y of a deck at a point already expressed in the rig's local frame.
  //
  // A deck may declare a LOCAL `ramp` — the SAME data shape physics.js reads off
  // a static CBZ.platforms record ({axis?, x0,x1 | z0,z1, y0,y1}), only expressed
  // in the parent's frame instead of the world's. That is deliberate: a sloped
  // walk surface on a thing that MOVES (a cargo ramp, a boat's boarding brow, a
  // tailgate) is the same geometry the static loop already understands, and
  // re-typing it as a staircase of flat boxes is how you get a body that hops.
  // `usePrev` reads the shape SNAPSHOT taken at the end of the previous tick, so
  // a rider standing on a ramp that is itself lowering is carried DOWN by it.
  function deckTopLocal(p, d, lx, lz, usePrev) {
    let top = usePrev ? d.ptop : d.top;
    const r = usePrev ? d.pramp : d.ramp;
    if (r) {
      let t = (r.axis === "x") ? (lx - r.x0) / (r.x1 - r.x0) : (lz - r.z0) / (r.z1 - r.z0);
      if (!(t >= 0)) t = 0; else if (t > 1) t = 1;
      top = r.y0 + t * (r.y1 - r.y0);
    }
    return p.y + p.mx * lx + p.my * top + p.mz * lz;
  }
  // Freeze this frame's deck SHAPE so next frame can measure the difference.
  // Poses get the same treatment via copyPose; a deck whose top or ramp is
  // animated by its owner is no different in kind from a deck that moved.
  function snapDecks(rig) {
    const decks = rig.decks;
    if (!decks) return;
    for (let i = 0; i < decks.length; i++) {
      const d = decks[i];
      d.ptop = d.top;
      d.px = d.x; d.pz = d.z; d.phw = d.hw; d.phd = d.hd; d.poff = d.off;
      if (d.ramp) {
        const s = d.pramp || (d.pramp = { axis: d.ramp.axis, x0: 0, x1: 1, z0: 0, z1: 1, y0: 0, y1: 0 });
        s.axis = d.ramp.axis;
        s.x0 = d.ramp.x0; s.x1 = d.ramp.x1; s.z0 = d.ramp.z0; s.z1 = d.ramp.z1;
        s.y0 = d.ramp.y0; s.y1 = d.ramp.y1;
      } else d.pramp = null;
    }
  }

  // Highest deck of THIS rig under (x,z) at pose `p`, or -Infinity. `reach` is
  // the physics.js support gate; pass +Infinity to ignore it (the ride test,
  // which asks "where is the deck" not "can I climb onto it").
  function rigTopAt(rig, p, x, z, reach) {
    const decks = rig.decks;
    if (!decks) return -Infinity;
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz > rig.r2) return -Infinity;          // XZ broad reject
    toLocalXZ(p, x, z, _l);
    const lx = _l.x, lz = _l.z;
    let best = -Infinity;
    for (let i = 0; i < decks.length; i++) {
      const d = decks[i];
      if (d.off) continue;                                     // a stowed ramp is not a floor
      if (lx < d.x - d.hw || lx > d.x + d.hw || lz < d.z - d.hd || lz > d.z + d.hd) continue;
      const t = deckTopLocal(p, d, lx, lz, false);
      if (t <= reach && t > best) best = t;
    }
    return best;
  }

  function activeMode() { return CBZ.game && CBZ.game.mode !== "escape"; }

  // ============================================================
  //  SEAM 1 — systems/physics.js groundAt()
  // ============================================================
  // A walk surface on a parent that moves cannot live in the world-space
  // CBZ.platforms array; its AABB would be stale the moment the parent turns.
  // physics.js calls this straight after its static platform loop with the
  // best support it found so far, and takes ours only if it is higher.
  // Records the winning rig so the tick can confirm ridership from SUPPORT.
  CBZ.mpGroundAt = function (x, z, fromY, best) {
    if (!CF.MOVING_PLATFORMS || !nDeck || !activeMode()) return -Infinity;
    const reach = (fromY != null ? fromY : best) + STEP_UP;
    let top = -Infinity;
    for (let i = 0; i < rigs.length; i++) {
      const rig = rigs[i];
      if (!rig.active || rig.detached || !rig.decks) continue;
      const t = rigTopAt(rig, rig.pose, x, z, reach);
      if (t > top) top = t;
    }
    return top;
  };

  // ============================================================
  //  SEAM 2 — systems/physics.js collide()
  // ============================================================
  // Circle-vs-box shortest-exit against the rig's LOCAL walls. This is the
  // SAME resolver shape CBZ.collide uses (clamp to the box, push out along the
  // shortest axis, deepest-corner fallback) — deliberately not a new one — run
  // in the rig's local frame and rotated back out. `feetY/headY` gate exactly
  // as they do in physics.js: omit both and every wall is full height, which
  // is the prison/jail call form and stays byte-identical.
  CBZ.mpCollide = function (pos, radius, feetY, headY) {
    if (!CF.MOVING_PLATFORMS || !nWall || !activeMode()) return;
    for (let i = 0; i < rigs.length; i++) {
      const rig = rigs[i];
      if (!rig.active || rig.detached || !rig.walls) continue;
      const p = rig.pose;
      const dx = pos.x - p.x, dz = pos.z - p.z;
      const rr = rig.r + radius;
      if (dx * dx + dz * dz > rr * rr) continue;               // XZ broad reject
      let lx = dx * p.c - dz * p.s;
      let lz = dx * p.s + dz * p.c;
      const walls = rig.walls;
      let pushed = false;
      for (let k = 0; k < walls.length; k++) {
        const w = walls[k];
        if (w.y0 != null && (headY <= p.y + w.y0 || feetY >= p.y + w.y1)) continue;  // body clears this wall
        const cx = w.x - w.hw > lx ? w.x - w.hw : (w.x + w.hw < lx ? w.x + w.hw : lx);
        const cz = w.z - w.hd > lz ? w.z - w.hd : (w.z + w.hd < lz ? w.z + w.hd : lz);
        const ex = lx - cx, ez = lz - cz;
        const d2 = ex * ex + ez * ez;
        if (d2 < radius * radius) {
          const d = Math.sqrt(d2);
          if (d < 0.0001) {
            const penX = Math.min(lx - (w.x - w.hw), (w.x + w.hw) - lx);
            const penZ = Math.min(lz - (w.z - w.hd), (w.z + w.hd) - lz);
            if (penX < penZ) lx += (lx < w.x ? -1 : 1) * (penX + radius);
            else lz += (lz < w.z ? -1 : 1) * (penZ + radius);
          } else {
            const push = (radius - d) / d;
            lx += ex * push; lz += ez * push;
          }
          pushed = true;
        }
      }
      if (pushed) {                                            // only write back if we actually moved it
        pos.x = p.x + lx * p.c + lz * p.s;
        pos.z = p.z - lx * p.s + lz * p.c;
      }
    }
  };

  // ============================================================
  //  THE TICK — priority 9.5, immediately before updatePlayer (10)
  //
  //  ...AND A SECOND ONE AT 12.8, FOR RIGS WHOSE PARENT MOVES AFTER 9.5.
  //  Every rig this file was written for is moved by an owner that ticks
  //  BEFORE it — the yacht sim at 9.45, the water hulls at 9.4, the marina at
  //  9.3 — which is why one pass was always enough. A rig bolted to a VEHICLE
  //  breaks that assumption and it is not a near miss: the car sim runs at 11,
  //  the armour sim at 11.6 and the flight sim at 12, so a deck latched at 9.5
  //  is the pose the aeroplane had at the END OF LAST FRAME. Measured on a
  //  cargo lifter at 95 m/s, that is 1.58 m of floor slid out from under the
  //  rider EVERY FRAME — the same class of fault city/vehicle_hold.js already
  //  fixed for strapped freight by moving its re-assert to 12.7, and this is
  //  its other half.
  //
  //  `late: true` moves ONLY that rig's pose latch and its rider carry to
  //  12.8 — after the three vehicle sims and after the hold's freight pass, so
  //  the deck, the load and the body aboard all move on the same frame the
  //  aeroplane does. Ridership, the leave/launch beat and every existing rig
  //  are untouched: absent the flag the two passes are byte-identical to the
  //  single one that came before.
  // ============================================================
  let pendingLate = null;          // the ridden rig, when it is a late one

  // The rider carry, lifted verbatim out of the tick so BOTH passes can run
  // it. Returns the rig it carried, or null when the motion was a teleport.
  function carryRider(cur, dt) {
    const P = CBZ.player;
    if (!P || !P.pos) return null;
    const p0 = cur.prev, p1 = cur.pose;
    toLocalXZ(p0, P.pos.x, P.pos.z, _l);
    const lx = _l.x, lz = _l.z;
    const nx = p1.x + lx * p1.c + lz * p1.s;
    const nz = p1.z - lx * p1.s + lz * p1.c;
    // The vertical carry is the SUPPORT delta at the rider's own local point,
    // which folds translation, the pivot arc and pitch/roll into one term —
    // and it is exactly what the player feels underfoot.
    // A deck whose own SHAPE animated (a ramp lowering under your feet) is
    // measured with last frame's snapshot at p0 and this frame's live record
    // at p1, so the two sources of motion — the vehicle and the ramp — sum
    // into the one support delta the rider feels.
    let dTop = 0;
    const decks = cur.decks;
    let d0 = -Infinity, d1 = -Infinity;
    for (let i = 0; i < decks.length; i++) {
      const d = decks[i];
      if (d.poff || d.off) continue;                        // valid BOTH frames, or no carry
      const px = d.px != null ? d.px : d.x, pz = d.pz != null ? d.pz : d.z;
      const phw = d.phw != null ? d.phw : d.hw, phd = d.phd != null ? d.phd : d.hd;
      if (lx < px - phw || lx > px + phw || lz < pz - phd || lz > pz + phd) continue;
      const a = deckTopLocal(p0, d, lx, lz, true);
      if (a > d0) { d0 = a; d1 = d.off ? a : deckTopLocal(p1, d, lx, lz, false); }
    }
    if (d0 > -Infinity) dTop = d1 - d0;
    const dx = nx - P.pos.x, dz = nz - P.pos.z;
    const dyaw = angDelta(p0.yaw, p1.yaw);

    if (Math.abs(dx) > MAX_STEP || Math.abs(dz) > MAX_STEP ||
        Math.abs(dTop) > MAX_STEP || Math.abs(dyaw) > MAX_YAW_STEP) {
      // TELEPORT, not motion. Carry nobody; drop the ride so nothing
      // inherits a nonsense velocity next frame.
      lastVx = lastVz = lastVy = 0;
      return null;
    }
    P.pos.x += dx; P.pos.z += dz; P.pos.y += dTop;
    lastVx = dx / dt; lastVz = dz / dt; lastVy = dTop / dt;
    if (dyaw) {
      // BODY facing follows the deck (physically right, invisible to the
      // player). CAMERA yaw only on explicit opt-in — see header note 3.
      if (cur.bodyYaw && CBZ.playerChar && CBZ.playerChar.group) CBZ.playerChar.group.rotation.y += dyaw;
      if (cur.camYaw && CBZ.cam) CBZ.cam.yaw += dyaw;
    }
    return cur;
  }

  // prev <- pose, pose <- parent, for one half of the rig list.
  function latchPoses(wantLate) {
    for (let i = 0; i < rigs.length; i++) {
      const rig = rigs[i];
      if (!!rig.late !== wantLate) continue;
      copyPose(rig.pose, rig.prev);
      if (!rig.active) continue;
      // An Object3D lifted out of the scene graph (a demolished building, a
      // disposed prop) freezes rather than dies — re-adding it resumes it.
      rig.detached = rig.obj3d && !rig.src.parent;
      if (rig.detached) continue;
      if (!readPose(rig, rig.pose)) copyPose(rig.prev, rig.pose);                     // bad parent: hold still
    }
  }

  // THE LATE PASS — 12.8. After vehicles (11), armour (11.6), flight (12) and
  // city/vehicle_hold.js's strapped-freight re-assert (12.7); before npclife's
  // syncAttached (33.8) re-seats the bodies riding the same room.
  function lateTick(dt) {
    if (!CF.MOVING_PLATFORMS || !nLate) { pendingLate = null; return; }
    if (!(dt > 0)) dt = 1 / 60;
    latchPoses(true);
    if (pendingLate) {
      if (!carryRider(pendingLate, dt)) riding = null;
      pendingLate = null;
    }
    for (let i = 0; i < rigs.length; i++) if (rigs[i].late) snapDecks(rigs[i]);
  }
  CBZ.onUpdate(12.8, lateTick);

  function tick(dt) {
    pendingLate = null;
    if (!CF.MOVING_PLATFORMS || !rigs.length) { riding = null; return; }
    if (!(dt > 0)) dt = 1 / 60;
    const P = CBZ.player;
    const on = activeMode();

    // ---- 1) WHO ARE WE RIDING? Judged against the pose physics glued the
    // feet to LAST frame — i.e. from SUPPORT, never from proximity. Anything
    // that owns the player's transform (a car, a plane, a door arc, the swim
    // controller) disqualifies ridership outright.
    let cur = null;
    if (on && P && P.pos && P.grounded && !P.dead && !P.driving &&
        !P._swim && !P._aircraft && !P._doorArc && !P._death && !(P.ko > 0)) {
      let best = -Infinity, bestRig = null;
      for (let i = 0; i < rigs.length; i++) {
        const rig = rigs[i];
        if (!rig.active || rig.detached || !rig.decks || !rig.riders) continue;
        const t = rigTopAt(rig, rig.pose, P.pos.x, P.pos.z, Infinity);
        if (t > best) { best = t; bestRig = rig; }
      }
      if (bestRig && Math.abs(P.pos.y - best) <= STICK_EPS) cur = bestRig;
    }

    // ---- 2) LATCH EVERY RIG'S NEW POSE (prev <- pose, pose <- parent) ----
    latchPoses(false);

    // ---- 3) CARRY THE RIDER ------------------------------------------------
    // A LATE rig has not moved yet this frame (its owner ticks at 11 / 11.6 /
    // 12), so carrying it here would carry last frame's motion. It is handed
    // to lateTick instead, which runs once the aeroplane has actually flown.
    if (cur && cur.late) pendingLate = cur;
    else if (cur) cur = carryRider(cur, dt);

    // ---- 4) LEAVING: inherit the platform velocity ------------------------
    if (riding && riding !== cur) {
      const mode = riding.onLeave;
      if (mode !== "none" && P && !P.grounded && !P._swim && !P.driving) {
        launch.vx = clampAbs(lastVx, MAX_CARRY_V);
        launch.vz = clampAbs(lastVz, MAX_CARRY_V);
        launch.t = LAUNCH_TTL;
        // Godot's ADD_UPWARD_VELOCITY: a DESCENDING platform must not have its
        // downward velocity summed into your jump, or the jump is cancelled.
        let vy = lastVy;
        if (mode === "upward" && vy < 0) vy = 0;
        if (vy) P.vy = (P.vy || 0) + clampAbs(vy, MAX_CARRY_VY);
      }
      lastVx = lastVz = lastVy = 0;
    }
    riding = cur;

    // The inherited velocity is set ONCE at the moment of leaving and only
    // ever decays — it can never accumulate, which is the conveyor bug's cure.
    if (launch.t > 0) {
      if (!P || P.grounded || P._swim || P.driving || P.dead || cur) { launch.t = 0; launch.vx = launch.vz = 0; }
      else {
        P.pos.x += launch.vx * dt;
        P.pos.z += launch.vz * dt;
        launch.t -= dt;
        if (launch.t <= 0) { launch.vx = launch.vz = 0; }
      }
    }

    // ---- 5) FREEZE THIS FRAME'S DECK SHAPES -------------------------------
    // Poses are latched at the TOP of the tick (prev <- pose) because the
    // parent moves outside this file. Deck shapes are latched at the BOTTOM,
    // because their owner animates them BEFORE we run (a hold lowering its ramp
    // ticks at 9.4) — snapshotting at the top would already have lost the value
    // we need to difference against.
    for (let i = 0; i < rigs.length; i++) if (!rigs[i].late) snapDecks(rigs[i]);
  }
  CBZ.onUpdate(9.5, tick);

  function recount() {
    nDeck = 0; nWall = 0; nLate = 0;
    for (let i = 0; i < rigs.length; i++) {
      const r = rigs[i];
      if (!r.active) continue;
      if (r.decks) nDeck++;
      if (r.walls) nWall++;
      if (r.late) nLate++;
    }
  }

  // ============================================================
  //  CBZ.movingPlatform(parent, spec) -> handle          THE ENTRY
  // ============================================================
  //   parent : an Object3D, OR any record with {position|pos} and
  //            {heading | rotation.y}, OR a function(out) returning
  //            {x, y, z, yaw [, pitch, roll]} for callers with no object.
  //   spec   :
  //     decks  [{x, z, w, d, top, id?, off?, ramp?}]
  //                                       LOCAL-space walk surfaces.
  //         ramp {axis?"x"|"z", x0,x1|z0,z1, y0,y1}  a LOCAL slope, exactly the
  //              record shape physics.js already reads off a static platform.
  //         off  true = stowed (not a floor yet); flip it live via handle.deck()
  //     walls  [{x, z, w, d, y0, y1}]     LOCAL-space solid boxes (optional)
  //     riders  true    carry standing bodies                (default true)
  //     yaw     true    revolve riders about the pivot       (default true)
  //     camYaw  false   ALSO rotate the player's camera yaw  (default FALSE)
  //     bodyYaw true    rotate the rider's body facing       (default true)
  //     tilt    true    apply parent pitch/roll to deck height (default true)
  //     onLeave "upward"|"full"|"none"    velocity inheritance (default "upward")
  //     late    true    parent moves AFTER 9.5 (a vehicle: 11 / 11.6 / 12) —
  //             latch + carry on the 12.8 pass instead      (default false)
  //     id      "yacht-main-deck"         debug label
  //   returns { release(), setActive(bool), contains(x,y,z), localOf(x,y,z,out),
  //             worldOf(lx,ly,lz,out), pose(), decks(), deck(idOrIndex),
  //             id, active }
  //
  // DEGRADE-SAFE by construction — the consumer writes:
  //   CBZ.movingPlatform ? CBZ.movingPlatform(obj, spec) : CBZ.platforms.push({...})
  const INERT = {
    release() {}, setActive() {}, contains() { return false; },
    localOf(x, y, z, out) { out = out || {}; out.x = x; out.y = y; out.z = z; return out; },
    worldOf(x, y, z, out) { out = out || {}; out.x = x; out.y = y; out.z = z; return out; },
    pose() { return null; }, decks() { return []; }, deck() { return null; },
    id: "inert", active: false, inert: true,
  };

  CBZ.movingPlatform = function (parent, spec) {
    if (!parent || !spec) return INERT;
    if (rigs.length >= MAX_RIGS) {
      if (!warnedCap) { warnedCap = true; console.warn("[movingPlatform] rig cap " + MAX_RIGS + " reached; extra rigs are inert"); }
      return INERT;
    }
    const fn = typeof parent === "function";
    if (!fn && !parent.position && !parent.pos) return INERT;

    // Half-extents are precomputed once: every per-frame query is then a pair
    // of compares, never a divide.
    function prep(list, isWall) {
      if (!list || !list.length) return null;
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (!s) continue;
        const e = {
          id: s.id || null,
          x: +s.x || 0, z: +s.z || 0,
          hw: Math.abs(+s.w || 0) / 2, hd: Math.abs(+s.d || 0) / 2,
          top: +s.top || 0,
        };
        if (e.hw <= 0 || e.hd <= 0) continue;
        if (isWall) { e.y0 = s.y0 != null ? +s.y0 : null; e.y1 = s.y1 != null ? +s.y1 : 0; }
        else {
          // LOCAL slope, physics.js's own ramp record shape. `off` starts a deck
          // stowed (a raised tailgate is not a floor); the owner flips it live.
          e.off = s.off === true;
          const r = s.ramp;
          if (r) {
            e.ramp = {
              axis: r.axis === "x" ? "x" : "z",
              x0: +r.x0 || 0, x1: r.x1 != null ? +r.x1 : 1,
              z0: +r.z0 || 0, z1: r.z1 != null ? +r.z1 : 1,
              y0: +r.y0 || 0, y1: +r.y1 || 0,
            };
            // a zero-length ramp would divide by zero every query
            if (e.ramp.axis === "x" ? e.ramp.x0 === e.ramp.x1 : e.ramp.z0 === e.ramp.z1) e.ramp = null;
          }
          e.ptop = e.top; e.px = e.x; e.pz = e.z; e.phw = e.hw; e.phd = e.hd; e.poff = e.off;
          e.pramp = null;
        }
        out.push(e);
      }
      return out.length ? out : null;
    }
    const decks = prep(spec.decks, false);
    const walls = prep(spec.walls, true);
    if (!decks && !walls) return INERT;

    // Bounding radius in the LOCAL frame: yaw-invariant, so one compare
    // rejects a rig the query is nowhere near, at any heading.
    let r = 0;
    const all = [decks, walls];
    for (let a = 0; a < 2; a++) {
      const L = all[a]; if (!L) continue;
      for (let i = 0; i < L.length; i++) {
        const e = L[i];
        const d = Math.hypot(Math.abs(e.x) + e.hw, Math.abs(e.z) + e.hd);
        if (d > r) r = d;
      }
    }

    const rig = {
      id: spec.id || ("mp" + rigs.length),
      src: parent, fn: fn, obj3d: !fn && !!parent.isObject3D,
      scratch: fn ? { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 } : null,
      decks: decks, walls: walls,
      riders: spec.riders !== false,
      yaw: spec.yaw !== false,
      camYaw: spec.camYaw === true,
      bodyYaw: spec.bodyYaw !== false,
      tilt: spec.tilt !== false,
      onLeave: spec.onLeave === "full" || spec.onLeave === "none" ? spec.onLeave : "upward",
      // LATE: this rig's parent is moved by a sim that ticks AFTER 9.5 (a car
      // at 11, armour at 11.6, an aeroplane at 12). Its pose latch and rider
      // carry move to 12.8 so the floor and the body on it arrive on the same
      // frame the vehicle does. Every vehicle-mounted room wants this; nothing
      // that is moved before 9.5 should ever set it.
      late: spec.late === true,
      r: r + 0.001, r2: (r + 0.001) * (r + 0.001),
      active: true, detached: false,
      pose: newPose(), prev: newPose(),
    };
    if (!readPose(rig, rig.pose)) return INERT;
    copyPose(rig.pose, rig.prev);
    rigs.push(rig);
    recount();

    const scratch = { x: 0, y: 0, z: 0 };
    const handle = {
      id: rig.id,
      get active() { return rig.active; },
      release() {
        const i = rigs.indexOf(rig);
        if (i >= 0) rigs.splice(i, 1);
        if (riding === rig) { riding = null; lastVx = lastVz = lastVy = 0; }
        rig.active = false;
        recount();
      },
      setActive(v) {
        const on = v !== false;
        if (on === rig.active) return;
        rig.active = on;
        if (!on && riding === rig) { riding = null; lastVx = lastVz = lastVy = 0; }
        // Resuming is not MOTION: re-read the parent and collapse the delta to
        // zero, or the first tick back would carry riders across the whole
        // interval the rig was asleep.
        if (on) { rig.detached = false; readPose(rig, rig.pose); copyPose(rig.pose, rig.prev); }
        recount();
      },
      // "is this point aboard" — over a deck footprint and within standing
      // headroom of it. Cheap, and the answer callers actually want.
      contains(x, y, z) {
        if (!rig.active || !rig.decks) return false;
        const t = rigTopAt(rig, rig.pose, x, z, Infinity);
        return t > -Infinity && y >= t - 0.6 && y <= t + 2.6;
      },
      localOf(x, y, z, out) {
        out = out || scratch;
        const p = rig.pose;
        toLocalXZ(p, x, z, _l);
        out.x = _l.x; out.z = _l.z; out.y = y - p.y;
        return out;
      },
      worldOf(lx, ly, lz, out) {
        out = out || scratch;
        const p = rig.pose;
        out.x = p.x + lx * p.c + lz * p.s;
        out.z = p.z - lx * p.s + lz * p.c;
        out.y = p.y + p.mx * lx + p.my * ly + p.mz * lz;
        return out;
      },
      pose() { return rig.pose; },
      // THE LIVE DECK RECORDS. A deck that ANIMATES (a tailgate dropping, a
      // ramp lowering, a scissor table rising) is still one deck — mutate
      // `top` / `off` / `ramp.*` / `x,z,hw,hd` on the record you get back and
      // the next query sees it, with the carry differencing it correctly
      // against last frame's snapshot. Deliberately NOT a setter API: the
      // caller already owns the numbers, and a second bookkeeping layer over
      // six floats is exactly the parallel-state trap CLAUDE.md names.
      decks() { return rig.decks || []; },
      deck(id) {
        const L = rig.decks; if (!L) return null;
        if (typeof id === "number") return L[id] || null;
        for (let i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
        return null;
      },
    };
    rig.handle = handle;
    return handle;
  };

  CBZ.movingPlatformCount = function () { return rigs.length; };
  CBZ.movingPlatformRiding = function () { return riding ? riding.handle : null; };

  // ============================================================
  //  THE RATCHET — CBZ.movingPlatformAudit()
  // ============================================================
  // Counts the remaining "a walk surface on a thing that MOVES, implemented
  // as a static CBZ.platforms record (or as a teleport) instead of a rig"
  // sites. It may only ever go DOWN; if you add a site, you migrate it in the
  // same change. Baseline at introduction: 3. Currently 2.
  //
  // THE LEDGER (verified by census, 2026-07-26):
  //   MIGRATED
  //     world/disaster_arena.js  tower lift car  — was a hand-poked static
  //       record (`e.plat.top = ...`) driven at onUpdate(29), i.e. 19 priority
  //       steps AFTER the player had already resolved against it. Now a rig.
  //   REMAINING (2)
  //     1. city/island_airport.js — `cabinState.platform`: ONE world-space
  //        oriented-extent AABB computed at board time from the airliner's
  //        pose and never updated. The airliner taxis and flies.
  //     2. city/elevators.js — the ride cab has NO walk surface at all; the
  //        player is TELEPORTED at the end of the ride (`el.m.st === "ride"`
  //        → one-shot teleport()). The strongest evidence the primitive was
  //        missing, and the highest-value next adopter.
  //   NOT LEGACY (checked, and deliberately excluded — do not "fix" these):
  //     city/escalators.js  — the tread SURFACE is stationary; only the treads
  //       translate along it, so a static ramp record is correct.
  //     systems/pieces.js   — placed props; the walkTop record is rebuilt on
  //       place/remove, never while moving.
  //     world/towers.js, city/buildings.js, city/beach.js pier/boardwalk,
  //     biome_*, bunkers, arena_* — genuinely static geometry.
  const AUDIT_LEGACY = 2;
  CBZ.movingPlatformAudit = function () { return AUDIT_LEGACY; };
})();
