/* ============================================================
   systems/physics.js — player movement, gravity, and circle-vs-box
   collision resolution against the world colliders.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const { player, playerChar, keys, lerpAngle, animChar } = CBZ;
  const T = CBZ.TUNE;

  // vertical-physics constants (survival's multi-storey buildings)
  // STEP_UP lowered 0.9→0.45 (Source sv_stepsize≈18u/0.45m; Unity stepOffset
  // 0.1-0.4m): the old 0.9 over-climbed and let the player snap up nearly a
  // whole flight in one frame, which jittered and let groundAt grab a far higher
  // ramp top across a seam. 0.45 still clears every real riser (~0.18m) and curbs
  // but no longer over-reaches. The stairs are now a CONTINUOUS ramp collider
  // (buildings.js), so the player follows a smooth slope, not tread-by-tread.
  const STEP_UP = 0.45;     // auto-climb a riser/curb/sill, not a whole flight
  const STEP_DOWN = 0.9;    // small drops you step down; bigger ones you fall off
  const SNAP_DOWN = 0.35;   // ~one riser + margin: max distance we GLUE feet to a
                            // floor a hair below them (kills descend-bounce / the
                            // "airborne off each nosing → fall through" bug). A
                            // real ledge (drop > SNAP_DOWN) still falls normally.
  const BODY_H = 1.7;       // collision body height for height-gated walls

  // ---- static-world collision broad phase ---------------------------
  // Most colliders are inert walls and props. Index their expanded bounds
  // once, then resolve an actor against only the bucket under its feet.
  // This changes actor-vs-world collision from O(all walls) to O(local walls).
  const COL_CELL = 8;
  const COL_PAD = 1.0;      // larger than any actor radius in this game
  const COL_OFF = 32768;
  const COL_SPAN = 65536;
  const EMPTY_COLS = [];
  const colBuckets = new Map();
  let colCount = -1, colDirty = true;

  function colKey(gx, gz) { return (gx + COL_OFF) * COL_SPAN + (gz + COL_OFF); }

  function rebuildColliderGrid() {
    colBuckets.clear();
    const cols = CBZ.colliders;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      const x0 = Math.floor((c.minX - COL_PAD) / COL_CELL);
      const x1 = Math.floor((c.maxX + COL_PAD) / COL_CELL);
      const z0 = Math.floor((c.minZ - COL_PAD) / COL_CELL);
      const z1 = Math.floor((c.maxZ + COL_PAD) / COL_CELL);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const key = colKey(gx, gz);
        let bucket = colBuckets.get(key);
        if (!bucket) { bucket = []; colBuckets.set(key, bucket); }
        bucket.push(c);
      }
    }
    colCount = cols.length;
    colDirty = false;
    CBZ.colliderBroadphaseStats = { colliders: colCount, buckets: colBuckets.size };
  }

  CBZ.markCollidersDirty = function () { colDirty = true; };

  function nearbyColliders(pos) {
    if (colDirty || colCount !== CBZ.colliders.length) rebuildColliderGrid();
    return colBuckets.get(colKey(Math.floor(pos.x / COL_CELL), Math.floor(pos.z / COL_CELL))) || EMPTY_COLS;
  }

  // Broadphase query for systems that need to inspect nearby world geometry
  // without resolving a collision. Callers own/reuse `out`; results are the
  // same collider objects from CBZ.colliders, deduplicated across grid cells.
  // Dedup across grid cells by stamping the collider with the query id — a
  // property compare instead of a Set hash per candidate. Same results; this
  // query runs for every steering ped and crowd agent every frame and the Set
  // overhead alone profiled at several % of the sim tick.
  let colQueryId = 0;
  CBZ.queryCollidersNear = function (x, z, radius, out) {
    if (colDirty || colCount !== CBZ.colliders.length) rebuildColliderGrid();
    out = out || [];
    out.length = 0;
    const qid = ++colQueryId;
    // same mode gate as collide(): stamped city colliders are phantom walls
    // in the prison/survival coordinate space, so queries skip them there.
    const cityOn = !CBZ.game || CBZ.game.mode === "city";
    const gx0 = Math.floor((x - radius) / COL_CELL), gx1 = Math.floor((x + radius) / COL_CELL);
    const gz0 = Math.floor((z - radius) / COL_CELL), gz1 = Math.floor((z + radius) / COL_CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const bucket = colBuckets.get(colKey(gx, gz));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const c = bucket[i];
        if (c._city && !cityOn) continue;
        if (c._qSeen === qid) continue;
        c._qSeen = qid;
        out.push(c);
      }
    }
    return out;
  };

  /* SEGMENT QUERY WITH AN EARLY OUT. combat_iq's position picker asked
     queryCollidersNear for a DISC around each candidate lane (radius half the
     lane + slack — up to ~17 m, twenty-five 8 m cells), had every collider in
     it stamped and pushed into an array, and only THEN walked the array to
     find the first box the lane crosses. With 142k colliders in the city and
     ~40 lanes per pick per shooter, the gather alone profiled at 15% of the
     whole frame during a street fight. This walks the same buckets but tests
     each collider as it is met (cheap slab reject, then the caller's
     predicate) and returns on the first hit — no output array, no stamps,
     and most lanes in a built-up block are blocked within the first cell.
     Duplicates across cells cost a repeated reject, never a wrong answer.

     hit(c) → true if this collider blocks the segment. `pad` widens the cell
     band and the slab reject (a body radius). Same mode gate as collide(). */
  CBZ.segmentHitsCollider = function (ax, az, bx, bz, pad, hit) {
    if (colDirty || colCount !== CBZ.colliders.length) rebuildColliderGrid();
    pad = pad || 0;
    const cityOn = !CBZ.game || CBZ.game.mode === "city";
    const minX = Math.min(ax, bx) - pad, maxX = Math.max(ax, bx) + pad;
    const minZ = Math.min(az, bz) - pad, maxZ = Math.max(az, bz) + pad;
    const gx0 = Math.floor(minX / COL_CELL), gx1 = Math.floor(maxX / COL_CELL);
    const gz0 = Math.floor(minZ / COL_CELL), gz1 = Math.floor(maxZ / COL_CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const bucket = colBuckets.get(colKey(gx, gz));
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const c = bucket[i];
        if (c._city && !cityOn) continue;
        if (c.minX == null) continue;
        // slab reject against the segment's own bounding box first
        if (c.maxX < minX || c.minX > maxX || c.maxZ < minZ || c.minZ > maxZ) continue;
        if (hit(c)) return true;
      }
    }
    return false;
  };
  // ============================================================
  //  SHARED WALL RESOLVER — CBZ.collide  (THE entry every moving
  //  body, player AND NPC, calls each frame to slide out of walls)
  // ============================================================
  // Generic circle-vs-box depenetration against the world colliders.
  // MUTATES pos.{x,z} in place; pos.y is untouched. Grid-accelerated
  // (nearbyColliders → one 8m bucket), so the cost is O(local walls),
  // not O(all ~5000 colliders): cheap enough to call for EVERY NPC every
  // frame. Zero per-call allocation.
  //
  //   CBZ.collide(pos, radius, feetY, headY)
  //     pos    — {x,z(,y)} mutated in place (the moving body's centre).
  //     radius — the body's collision radius. THE PLAYER IS 0.38, NOT 0.55:
  //              TUNE.playerRadius (config.js) has shipped 0.38 the whole time
  //              and three comments in this file said 0.55, including one the
  //              substep sizing below reasons from. Peds/crowd are 0.5.
  //     feetY  — optional bottom of the body's vertical span.
  //     headY  — optional top of the body's vertical span.
  //
  // feetY/headY gate HEIGHT-LIMITED colliders (windows, upper floors,
  // shot-open sill remnants): a box with c.y0!=null is skipped when the
  // body is entirely below it (headY<=y0) or entirely above it
  // (feetY>=y1). Omit both args and EVERY collider acts full-height
  // (prison / jail behaviour — byte-identical to before).
  //
  // SINGLE-PASS: one shortest-exit push per collider per call. A body
  // wedged into an inside corner can need 2–3 passes to fully clear; for
  // that, prefer CBZ.collideSlide (below) which loops to convergence in
  // one call. Per the cross-agent contract this function is shared with
  // the PLAYER — do NOT change its math/signature; add new helpers
  // instead.
  //
  // ---- ORIENTED COLLIDERS (c.yaw) -----------------------------------
  // An AABB CANNOT DESCRIBE A DIAGONAL WALL, and pretending otherwise is
  // where this game's invisible walls came from. A 5 m chord 0.24 m thick
  // laid at 45 deg has an axis-aligned bounding box 3.7 m square: the
  // player is stopped 2.5 m from a handrail they can see through. Measured
  // on the shipped world the worst case was the speedway perimeter fence —
  // a 0.32 m chain-link with a 12.7 m collider box, a NINE METRE invisible
  // wall. Every curved ring in the game (arena bowl rails, the facade,
  // the beast pit, venue fences, grandstands) walks its arc as short
  // rotated chords and then re-typed each one as its own AABB.
  //
  // A collider may now carry an ORIENTED body: {cx, cz, hw, hd, yaw} where
  // hw/hd are half-extents along the box's own local +x/+z. minX..maxZ
  // stay on the record and stay the CONSERVATIVE outer AABB, so the
  // broadphase, the camera sweep and the traversal probe are untouched and
  // keep bucketing exactly as before — only the final resolve is exact.
  // A record with no `yaw` takes the identical path it always did.
  const oriHit = { x: 0, z: 0 };
  function oriPush(pos, radius, c) {
    // clamp the body centre inside the box, IN THE BOX'S OWN FRAME
    // THREE's rotation.y sends local +x -> world (cos,-sin) and local +z ->
    // world (sin,cos), so the inverse (this one) is its transpose. Getting
    // these two the wrong way round is silently wrong at every angle except
    // multiples of 45 deg, which is exactly the range a corner arc lives in.
    const co = Math.cos(c.yaw), si = Math.sin(c.yaw);
    const rx = pos.x - c.cx, rz = pos.z - c.cz;
    const lx = rx * co - rz * si;            // world -> local
    const lz = rx * si + rz * co;
    const qx = lx < -c.hw ? -c.hw : (lx > c.hw ? c.hw : lx);
    const qz = lz < -c.hd ? -c.hd : (lz > c.hd ? c.hd : lz);
    let dx = lx - qx, dz = lz - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) return false;
    let px, pz;
    if (d2 < 1e-8) {
      // centre is INSIDE the box: shortest exit through the nearest face,
      // solved on the local axes (the AABB branch below, one frame over)
      const penX = c.hw - (lx < 0 ? -lx : lx), penZ = c.hd - (lz < 0 ? -lz : lz);
      if (penX < penZ) { px = (lx < 0 ? -1 : 1) * (penX + radius); pz = 0; }
      else { px = 0; pz = (lz < 0 ? -1 : 1) * (penZ + radius); }
    } else {
      const d = Math.sqrt(d2), push = (radius - d) / d;
      px = dx * push; pz = dz * push;
    }
    oriHit.x = px * co + pz * si;             // local -> world
    oriHit.z = -px * si + pz * co;
    return true;
  }
  function collide(pos, radius, feetY, headY) {
    const cols = nearbyColliders(pos);
    // city-owned colliders (stamped by city/mode.js's build) are only solid in
    // city mode: the airport/military rects overlap the prison's coordinate
    // space, and their hidden geometry must not wall off jail rooms.
    const cityOn = !CBZ.game || CBZ.game.mode === "city";
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c._city && !cityOn) continue;
      if (c.y0 != null && (headY <= c.y0 || feetY >= c.y1)) continue; // body clears this wall
      if (c.yaw) {                        // oriented body — resolve in its own frame
        if (oriPush(pos, radius, c)) { pos.x += oriHit.x; pos.z += oriHit.z; }
        continue;
      }
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      let dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        const d = Math.sqrt(d2);
        if (d < 0.0001) {
          const penX = Math.min(pos.x - c.minX, c.maxX - pos.x);
          const penZ = Math.min(pos.z - c.minZ, c.maxZ - pos.z);
          if (penX < penZ) pos.x += (pos.x < (c.minX + c.maxX) / 2 ? -1 : 1) * (penX + radius);
          else pos.z += (pos.z < (c.minZ + c.maxZ) / 2 ? -1 : 1) * (penZ + radius);
        } else {
          const push = (radius - d) / d;
          pos.x += dx * push; pos.z += dz * push;
        }
      }
    }
    // MOVING WALLS (systems/platforms_moving.js): same shortest-exit resolver,
    // run in a moving parent's LOCAL frame (a boat's gunwales, a gangway's
    // handrails). Feature-detected + flagged; the signature and the math above
    // are untouched, exactly as this function's contract requires.
    if (CBZ.mpCollide) CBZ.mpCollide(pos, radius, feetY, headY);
  }
  CBZ.collide = collide;

  // ---- THE ONE PLACE A ROTATED WALL BECOMES A COLLIDER ----------------
  // Builds the record `collide()` reads above: the oriented body PLUS the
  // conservative AABB the broadphase needs. Every ring-walking builder in
  // the game used to derive that AABB itself and then register it as the
  // whole collider — same three lines of yaw-extent trig copied into
  // arena_venue, arena_fights, speedway_structures and continent, each of
  // them correct about the bounding box and wrong about the wall. Two
  // numbers describing one object must never be typed independently.
  //
  //   cx,cz   centre of the box in world space
  //   hw,hd   half-extents along the box's OWN local +x / +z
  //   yaw     rotation about Y, matching THREE's mesh.rotation.y
  //   y0,y1   optional vertical band (omit for a full-height wall)
  //
  // An axis-aligned box (yaw within a hair of a right angle) is returned as
  // a PLAIN AABB with no `yaw`, because the exact path is already exact for
  // those and a straight wall should not pay for the rotation.
  const ORI_EPS = 1e-4;
  CBZ.orientedCollider = function (cx, cz, hw, hd, yaw, y0, y1) {
    yaw = +yaw || 0;
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const ac = co < 0 ? -co : co, as = si < 0 ? -si : si;
    const ex = hw * ac + hd * as, ez = hw * as + hd * ac;   // conservative AABB
    const c = { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez };
    if (as > ORI_EPS && ac > ORI_EPS) {          // genuinely diagonal
      c.cx = cx; c.cz = cz; c.hw = hw; c.hd = hd; c.yaw = yaw;
    }
    if (y0 != null) { c.y0 = y0; c.y1 = y1; }
    return c;
  };

  // How much solid nothing would this box have added if it had been
  // registered as its own AABB? Builders report it; the gate reads it.
  // (worst-case outward reach past the wall face, on the box's normal)
  CBZ.orientedSlack = function (hw, hd, yaw) {
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const ac = co < 0 ? -co : co, as = si < 0 ? -si : si;
    const ex = hw * ac + hd * as, ez = hw * as + hd * ac;
    return (ex * as + ez * ac) - hd;   // AABB support along the wall normal, minus the wall
  };

  // ---- CBZ.collideSlide — robust multi-pass form for NPC movers --------
  // The convenience entry the peds / crowd / gang movement should call to
  // slide a moving body fully out of building walls each frame. It loops
  // CBZ.collide a few times so a body wedged into an inside corner (two
  // walls at once) is depenetrated in ONE call instead of every caller
  // re-implementing the 2–3-pass loop. Early-outs the instant a pass moves
  // the body less than CONVERGE_EPS (the common case: 0 or 1 wall touched →
  // one pass), so a body in open street pays a single grid lookup + a
  // handful of box tests. Returns true iff the body was pushed at all this
  // frame (callers use that to re-pick a waypoint so they don't grind back
  // into the wall — mirrors the existing crowd/ped think-tick logic).
  //
  //   CBZ.collideSlide(pos, radius, feetY, headY, passes?) -> moved:boolean
  //     passes defaults to 3 (matches peds.js's gold-standard loop); pass 1
  //     for the cheap off-tick form (a tiny dead-reckoned step needs only
  //     one push). pos.{x,z} mutated in place; pos.y untouched.
  const CONVERGE_EPS = 0.002;     // a pass that moves <2mm has converged
  function collideSlide(pos, radius, feetY, headY, passes) {
    const n = passes > 0 ? passes : 3;
    let moved = false;
    for (let p = 0; p < n; p++) {
      const bx = pos.x, bz = pos.z;
      collide(pos, radius, feetY, headY);
      const dx = pos.x - bx, dz = pos.z - bz;
      if (dx * dx + dz * dz < CONVERGE_EPS * CONVERGE_EPS) break; // nothing more to push out of
      moved = true;
    }
    return moved;
  }
  CBZ.collideSlide = collideSlide;

  // ---- CBZ.npcStepLedge — bounded auto-step over a LOW obstacle --------
  // SECONDARY (owner: optional). CITY-ONLY. When a moving body is walking
  // INTO a collider whose TOP is only a low ledge above its feet — a window
  // sill, a shot-open window's remnant, a low planter — let it climb ON TOP
  // instead of grinding the face, so running at a shot-out window steps in
  // like going up a stair. Strictly bounded: only ledges whose top sits
  // between just-above-feet and STEP_UP_NPC (~1.0m) qualify, and only when
  // the body is actually moving toward that ledge — never a flying boost up
  // a sheer wall, never a tall wall, never the ground floor of a closed box.
  //
  //   CBZ.npcStepLedge(pos, radius, feetY, headY, moveX, moveZ) -> newFeetY
  //     pos               — body centre (NOT mutated — XZ resolution stays
  //                         with CBZ.collide/collideSlide; this only reports
  //                         a Y to step up to).
  //     feetY/headY       — current vertical span.
  //     moveX/moveZ       — this frame's intended horizontal move (heading);
  //                         only a ledge the body is heading toward lifts it.
  //     returns the feetY the caller should adopt (== feetY if no step), so
  //     the caller stays in control of its own Y. Off CITY mode it always
  //     returns feetY unchanged (jail/survival byte-identical).
  const STEP_UP_NPC = 0.9;        // max ledge an NPC auto-climbs (curb/window sill ~0.5–0.9m)
  const STEP_MIN_NPC = 0.08;      // ignore ~flat/terrain-level boxes
  function npcStepLedge(pos, radius, feetY, headY, moveX, moveZ) {
    // CAPABILITY, not scenario (systems/modecaps.js). NOTE FOR THE NEXT
    // READER: as of 2026-08-06 this block has ZERO callers anywhere in the
    // repo — it was written city-only, nobody adopted it, and the header
    // above still describes it as SECONDARY. That is the Block Law's own
    // failure mode ("a block with zero consumers is prose"), and un-gating it
    // does not fix that; only a mover calling it would. It is migrated here so
    // that when a mover does adopt it, it is not born city-only for a third
    // time. Off-capability it returns feetY unchanged, exactly as before.
    if (!(CBZ.modeHas ? CBZ.modeHas("stepLedge") : CBZ.game.mode === "city")) return feetY;
    const ml = moveX * moveX + moveZ * moveZ;
    if (ml < 1e-6) return feetY;                        // not moving → nothing to climb
    const cols = nearbyColliders(pos);
    let bestTop = feetY;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.y0 == null) continue;                       // full-height wall: never step over it
      const top = c.y1;
      // ledge must be a real lift (above feet) but no taller than STEP_UP_NPC,
      // and the body's head must clear standing on top of it (cheap sanity).
      if (top <= feetY + STEP_MIN_NPC || top > feetY + STEP_UP_NPC) continue;
      // only step a box we're heading INTO: the body's centre must be within
      // grabbing range of the box face AND the move vector must point at it.
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const dx = pos.x - cx, dz = pos.z - cz;
      const near = radius + 0.25;
      if (dx * dx + dz * dz > near * near) continue;     // not up against this ledge
      if (dx * moveX + dz * moveZ > 0) continue;         // moving AWAY from it (face normal aligns with move → skip)
      if (top > bestTop) bestTop = top;                  // climb onto the highest qualifying ledge
    }
    return bestTop;
  }
  CBZ.npcStepLedge = npcStepLedge;

  // ============================================================
  //  SHARED CHARACTER TRAVERSAL — jump, vault, mantle
  //
  //  Space used to be a vertical impulse even when a solid waist-high box was
  //  directly in the run line. The body rose, CBZ.collide pushed its XZ back to
  //  the near face, and it landed exactly where it started. NPCs had it worse:
  //  peds.js has no jump state at all, so its steering either went around or
  //  ground against the same face forever.
  //
  //  This is the geometry/trajectory owner for BOTH the player and full-rig
  //  NPCs. It only considers things that are already physically registered:
  //    • a CBZ.collider with y0/y1 or a registered solid-mesh ref, or
  //    • a real, nearly-stationary CBZ.cityCars record.
  //  A decorative prop with no collider is deliberately invisible here; prop
  //  solidity remains the prop-physics owner's job.
  //
  //  Public capability:
  //    CBZ.characterTraversal.probe(actor, rig, dx, dz, opts)
  //    CBZ.characterTraversal.start(actor, rig, dx, dz, opts)
  //    CBZ.characterTraversal.step(actor, rig, dt, animate)
  //    CBZ.characterTraversal.cancel(actor, rig)
  //
  //  Callers keep ownership of WHEN to try it. updatePlayer uses a Space edge;
  //  city/peds.js uses it only for a genuinely running chase/flee body. Once
  //  started, this state owns that actor's transform for less than ~1.2 s.
  // ============================================================
  const TRAV_MIN_RISE = 0.36;       // curbs/normal stair risers stay ordinary step-up
  const TRAV_VAULT_RISE = 1.34;     // waist/chest-high: clear in one flowing vault
  const TRAV_VAULT_SPAN = 3.25;     // enough to cross a car SIDE, not its full length
  const TRAV_MANTLE_SPAN = 2.45;    // a thin wall/van side can be hauled over
  const TRAV_REACH_BASE = 1.15;     // probe from the body's collision shell
  const TRAV_REACH_SPEED = 0.105;   // faster run sees the face a little earlier
  const TRAV_CAR_SPEED = 1.15;      // moving traffic is danger, never a parkour prop
  const TRAV_LAND_PAD = 0.20;       // actor centre clears the far face before collision resumes
  const TRAV_TOP_INSET = 0.34;      // chest/hips arrive just inside a climbable top
  const TRAV_EPS = 0.015;
  /* ---- ONE-LINE REVERT (doctrine.md's DEGRADE-SAFE point) -----------------
     `CBZ.CONFIG.PARKOUR_V2 = false`, or `?cfg_PARKOUR_V2=0`, restores this
     file's shipped traversal EXACTLY: no aperture move, smooth01 root motion
     on its old fixed duration windows, no edge catch, no airborne pose and no
     landing beat. Every addition below is behind one read of this flag, which
     is also what makes tools/visual-presets/parkour-moves.mjs a real
     before/after — the "before" side is this same checkout with the flag off,
     so the two frames differ by the change and by nothing else. */
  if (!CBZ.CONFIG) CBZ.CONFIG = {};
  if (CBZ.CONFIG.PARKOUR_V2 == null) CBZ.CONFIG.PARKOUR_V2 = true;
  function parkourV2() { return CBZ.CONFIG.PARKOUR_V2 !== false; }

  /* ---- THE APERTURE: the "go THROUGH it" half of traversal ----------------
     OWNER (2026-08-17): "if I go up to a building like the airport where
     there's one floor and I break a window, I can't jump through after —
     because I can jump OVER but I can't go THROUGH a space."

     He is describing a real hole that the game already draws and already
     opens. city/buildings.js's carveHole leaves an opening as THREE surviving
     remnant boxes: a SILL course under it, a HEADER course above it, and full-
     height FLANKS either side (addRemnant, ~line 1823). The passage between
     sill and header is genuinely empty — the collider was spliced out.

     Every one of those apertures was refused, and it was this file that
     refused them. Measured against the shipped build, a running body at a
     shot-out window:

         sill 0.90 m, aperture 1.40 m  ->  REFUSED
         sill 1.20 m, aperture 1.40 m  ->  REFUSED
         C4 mousehole, aperture 1.00 m ->  REFUSED

     The sill probes fine — waist-high, thin, a textbook speed vault. Then
     buildTraversal validates the arc, the arc goes UP (that is what a vault
     is), the head enters the HEADER's band, and the "low ceiling / second
     wall" veto throws the whole traversal away. The move was never wrong; the
     TRAJECTORY was, because the only trajectory this file knew was "over the
     top". A window has a top you cannot go over — that is what makes it a
     window.

     So a third kind joins vault and mantle. `through` keeps the body LOW and
     threads it between the sill and the header instead of arcing over the
     sill into the header. Two silhouettes fall out of the measurement, not
     out of taste:

       "step"  headroom clears the standing body — stride through, tall.
       "dive"  it does not — commit, go horizontal, arms first, land and roll.

     A dive is not a smaller step. It is the move that exists precisely
     because the hole is smaller than the person, which is the whole reason
     mouse-holing (systems/breach.js) is a tactic and not a doorway. -------- */
  const TRAV_GAP_MIN = 0.62;        // smallest hole a committed dive threads
  const TRAV_GAP_DIVE_H = 0.58;     // a diving body is this tall, not BODY_H
  /* A BODY GOING OVER SOMETHING IS FOLDED, NOT STANDING. This fraction is the
     whole reason the aperture test can be strict without breaking ordinary
     indoor vaults, and getting it wrong is measurable: the first draft asked
     for full standing clearance above every obstacle, and four prison props
     under the cell block's 2.4 m ceiling — stools and a bench that had always
     been vaultable — became unvaultable in one line, because a 1.82 m standing
     body plus a 0.24 m arc does not fit under 2.4 m while a folded one does
     easily. Landing ON a top is the deliberate exception: you finish upright
     up there, so that case still asks for the whole body. */
  const TRAV_FOLD = 0.74;           // vaulting profile as a fraction of standing height
  const TRAV_TOP_CLEAR = 0.26;      // arc clearance the trajectory takes over the top
  const TRAV_GAP_STEP_SILL = 0.55;  // a lip this low is STRIDDEN over, not dived across
  const TRAV_GAP_STEP_H = 0.78;     // …and needs this fraction of standing height to duck through
  /* HOW DEEP AN OPENING STILL COUNTS AS ONE. A wall is thin — city facades run
     0.4 m, the prison's heavy sections about 1 m, and breach.js's mousehole
     rows go through the thickest of them. 1.6 m covers every real wall in the
     game with margin and stops the move being offered for things that merely
     have a gap in them lengthways: a 2.6 m-deep bunk approached along its
     length, a stack of crates, a mess bench. Those are not doorways, and
     threading one is a crawl, not a dive. */
  const TRAV_GAP_DEPTH = 1.6;       // wall thickness one move can thread
  const TRAV_GAP_SILL = 1.60;       // a "sill" taller than this is a wall with a hole ABOVE reach
  const TRAV_GAP_TUCK = 0.72;       // a threading body's shell, as a fraction of its standing radius
  /* ---- CATCHING THE EDGE --------------------------------------------------
     The other half of the owner's list: "real parkour jumping, catching self,
     landing, catching edge". A body in the air that comes up short at a roof
     lip currently does exactly one thing — it keeps falling, because nothing
     in the engine ever looks UP from a falling body. catchLedge does, and it
     hands what it finds to the mantle that already exists. -------------- */
  const TRAV_CATCH_LOW = 0.30;      // ledge must be at least this far above the feet to be a catch
  const TRAV_CATCH_REACH = 1.05;    // how far in FRONT of the body the hands find a lip
  const TRAV_CATCH_RISE = 0.9;      // and no faster than this UPWARD (a rising body has not fallen yet)
  const travQuery = [], travClearQuery = [];
  const travPoint = { x: 0, y: 0, z: 0 };
  const travBounds = window.THREE && window.THREE.Box3 ? new window.THREE.Box3() : null;
  const travDerivedBand = { y0: 0, y1: 0, authored: false, ref: null };
  const travAudit = {
    probes: 0, starts: 0, vaults: 0, mantles: 0, cars: 0, throughs: 0, catches: 0,
    dives: 0, rolls: 0, gapRefused: 0,
    completed: 0, cancelled: 0, lastCancel: "",
  };
  /* WHY A PROBE SAID NO. Same reason city/buildings.js publishes carveDbg: the
     honest answer to "I walked up to it and nothing happened" was previously
     another instrumented probe round, because every refusal in this file is a
     bare `return null` inside a loop over a collider bucket. A counter per
     reason turns that into one call. Costs one string-keyed increment on a
     path that only runs on an explicit jump/probe event, never in a walking
     frame. `travWhy` carries the nearest candidate's reason out to the audit. */
  const travWhy = Object.create(null);
  let travWhyLast = "";
  function travNo(reason) {
    travWhy[reason] = (travWhy[reason] || 0) + 1;
    travWhyLast = reason;
    return null;
  }

  function smooth01(t) {
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return t * t * (3 - 2 * t);
  }

  /* ---- WHY THE VAULT LOOKED GLITCHY, AND WHAT REPLACES smooth01 ------------
     OWNER: "improving the current vault that looks glitchy".

     smooth01 has ZERO DERIVATIVE AT BOTH ENDS. That is exactly what you want
     for a pose blend and exactly what you must not use for the ROOT MOTION of
     a body that is already moving: a man sprinting at 7 m/s reaches the wall,
     his horizontal speed drops to zero for one frame, he floats over on a
     bell curve, arrives at zero speed again, and the gait resumes at 7 m/s on
     the next frame. Two velocity discontinuities per vault, one at each end,
     and the eye reads both as dropped frames — the body visibly hitches at
     the obstacle and again on the far side. Nothing was ever "glitching"; the
     curve was authored as a fade, not as a move.

     A cubic Hermite fixes it by construction, because it takes the END
     TANGENTS as inputs: feed it the speed the body actually arrived with and
     the motion is continuous through both seams. The pleasant part is that
     when the duration is chosen as pathLength / speed (which buildTraversal
     now does), the matched tangent is exactly 1 and the Hermite degenerates
     to a straight constant-speed line — so a well-matched vault carries the
     run straight through the obstacle with no easing artefact at all, and
     only a MISmatched one (a slow body over a long span) eases, which is the
     case where easing is the honest answer.

     `m` is clamped to [0,3] because that is the monotonicity bound for this
     basis with equal end tangents (p'(0.5) = 1.5 - 0.5m). Past it the curve
     overshoots and walks BACKWARDS mid-vault, which would be a real glitch
     rather than the imaginary one we are fixing. */
  function hermite01(u, m) {
    // p0=0, p1=1, both tangents = m. Expanded from the standard basis.
    const u2 = u * u, u3 = u2 * u;
    return m * (2 * u3 - 3 * u2 + u) + (3 * u2 - 2 * u3);
  }

  /* "AT WHAT FRACTION OF THE MOVE AM I THIS FAR ALONG THE PATH?" — the inverse
     of the curve above, which the aperture needs because it must pin the root
     height to the wall's real faces and those are known as DISTANCES, not as
     time. Bisection rather than Newton: the clamp on `m` guarantees the curve
     is monotonic, so bisection cannot diverge, and 18 halvings resolve to
     ~4e-6 of the move — far finer than a frame. Runs once per traversal
     START, never per frame. */
  function hermiteInvert(target, m) {
    if (!(target > 0)) return 0;
    if (target >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) * 0.5;
      if (hermite01(mid, m) < target) lo = mid; else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  /* THE LOWEST THING OVERHEAD along the crossing, or Infinity for open sky.
     Scans the same collider bucket the probe already pulled and asks one
     question per box: does it hang over the path between `t0` and `t1`, above
     `floorY`? A header remnant answers yes and its y0 IS the aperture's
     ceiling. Deliberately ignores the obstacle being crossed (`skip`), which
     is the thing we are standing on, not a roof. */
  function ceilingOver(ap, dirX, dirZ, t0, t1, floorY, radius, skip) {
    const midT = (t0 + t1) * 0.5;
    const mx = ap.x + dirX * midT, mz = ap.z + dirZ * midT;
    const reach = Math.max(0.6, (t1 - t0) * 0.5 + radius + 0.3);
    CBZ.queryCollidersNear(mx, mz, reach, travClearQuery);
    let ceil = Infinity, ref = null;
    for (let i = 0; i < travClearQuery.length; i++) {
      const c = travClearQuery[i];
      if (c === skip) continue;
      const band = colliderVerticalBand(c);
      // A heightless legacy collider is full-height by contract, so it is a
      // solid wall rather than a header and cannot frame an aperture. Treat
      // it as no ceiling here; the ordinary clearance sweep still vetoes it.
      if (!band) continue;
      if (band.y1 <= floorY + 0.02) continue;            // entirely below the sill: not overhead
      if (band.y0 >= ceil) continue;                     // already have a lower ceiling
      const hitRect = rayRect(ap.x, ap.z, dirX, dirZ,
        c.minX - radius, c.maxX + radius, c.minZ - radius, c.maxZ + radius, 64);
      if (!hitRect) continue;
      if (hitRect.exit <= t0 + 0.02 || hitRect.enter >= t1 - 0.02) continue;   // not over this stretch
      if (band.y0 <= floorY + 0.02) {
        // It starts at or below the sill top AND continues above it: this is
        // not a header over a hole, it is a solid wall in the way. Report a
        // zero-height aperture so the caller refuses rather than diving into
        // masonry.
        ceil = floorY; ref = c;
        break;
      }
      ceil = band.y0; ref = c;
    }
    ceilingOver.ref = ref;
    return ceil;
  }

  // Ray vs XZ AABB. Direction is normalized, so returned t values are metres.
  function rayRect(ox, oz, dx, dz, minX, maxX, minZ, maxZ, maxT) {
    let lo = 0, hi = maxT;
    if (Math.abs(dx) < 1e-7) {
      if (ox < minX || ox > maxX) return null;
    } else {
      let a = (minX - ox) / dx, b = (maxX - ox) / dx;
      if (a > b) { const q = a; a = b; b = q; }
      if (a > lo) lo = a; if (b < hi) hi = b;
      if (hi < lo) return null;
    }
    if (Math.abs(dz) < 1e-7) {
      if (oz < minZ || oz > maxZ) return null;
    } else {
      let a = (minZ - oz) / dz, b = (maxZ - oz) / dz;
      if (a > b) { const q = a; a = b; b = q; }
      if (a > lo) lo = a; if (b < hi) hi = b;
      if (hi < lo) return null;
    }
    if (hi < 0 || lo > maxT) return null;
    return { enter: Math.max(0, lo), exit: hi };
  }

  function circleTouchesRect(x, z, radius, minX, maxX, minZ, maxZ) {
    const cx = Math.max(minX, Math.min(x, maxX));
    const cz = Math.max(minZ, Math.min(z, maxZ));
    const dx = x - cx, dz = z - cz;
    return dx * dx + dz * dz < radius * radius - 1e-7;
  }

  function rigHeight(rig, opts) {
    if (opts && opts.height > 0) return opts.height;
    if (rig && rig.metric && rig.metric.height > 0) return rig.metric.height;
    return BODY_H;
  }

  function carLocal(car, x, z, out) {
    const h = car.heading || (car.group && car.group.rotation.y) || 0;
    const s = Math.sin(h), c = Math.cos(h);
    const wx = x - car.pos.x, wz = z - car.pos.z;
    out.x = wx * c - wz * s;
    out.z = wx * s + wz * c;
    out.s = s; out.c = c;
    return out;
  }

  const carFrame = { x: 0, z: 0, s: 0, c: 1 };
  const carDir = { x: 0, z: 0 };

  // WHERE A BODY IS, whoever owns it. City pedestrians and survival/gun-game
  // bots carry their own `.pos` vector; the PRISON's guards and inmates ARE
  // their THREE.Group — `n.group.position` is the authoritative position and
  // there is no `.pos` field at all (entities/npc.js, entities/guards.js).
  // That single missing field is the second reason the prison never vaulted:
  // even with the mode gate open, probeTraversal's `!actor.pos` guard would
  // have refused every guard and every inmate in the block. Reading through
  // this accessor is the same idiom systems/humancontact.js:25 already uses,
  // and it means NO prison record has to grow a field (an aliased `.pos` would
  // have silently switched those records onto city-shaped code paths in
  // weather.js, tornado.js and combat_iq.js, all of which use `!a.pos` as
  // their "this is not a positioned actor" test).
  function travPos(a) { return (a && (a.pos || (a.group && a.group.position))) || null; }

  // CBZ.cityCars is a CITY record list living in a coordinate space that
  // overlaps the prison arena (the same overlap city/mode.js stamps `_city` on
  // its colliders to fix). Outside city mode those cars are not in this world,
  // so neither the vault probe nor the landing check may see them.
  function traversalCars() {
    return (!CBZ.game || CBZ.game.mode === "city") ? CBZ.cityCars : null;
  }

  function colliderVerticalBand(c) {
    if (c.y0 != null && c.y1 != null && isFinite(c.y0) && isFinite(c.y1)) {
      return c;                         // zero-allocation hot path
    }
    // Legacy solid props often predate the y0/y1 collider contract but still
    // carry the actual Mesh/Group they block with. Reading that registered
    // solid's visual height is character physics, not prop-physics invention:
    // no ref (a decorative/anonymous blocker) remains non-traversable.
    const ref = c.ref;
    if (!ref || ref.visible === false || !travBounds || typeof travBounds.setFromObject !== "function") return null;
    try {
      travBounds.setFromObject(ref);
      if ((travBounds.isEmpty && travBounds.isEmpty()) ||
          !isFinite(travBounds.min.y) || !isFinite(travBounds.max.y) ||
          travBounds.max.y - travBounds.min.y < 0.05) return null;
      // Deliberately recompute instead of caching world Y: the prop-physics
      // owner may later move/tilt this same registered mesh. The probe is an
      // explicit jump/run event over a tiny local collider bucket, so this
      // shared Box3 costs nothing in the normal walking frame.
      travDerivedBand.y0 = travBounds.min.y;
      travDerivedBand.y1 = travBounds.max.y;
      travDerivedBand.ref = ref;
      return travDerivedBand;
    } catch (e) {
      return null;
    }
  }

  function isTraversalRoadCar(car) {
    if (!car) return false;
    const model = car.model || {};
    const ud = car.group && car.group.userData;
    const body = String(car._bk || model.body || (ud && ud.bodyKind) || "").toLowerCase();
    const name = String(model.name || car.displayName || car.kind || "").toLowerCase();
    // cityCars is the general drivable-vehicle bus: boats and some specialist
    // aircraft share the same record shape. They are not the parked road-car
    // silhouette this move is authored for (and a boat belongs to water/deck
    // traversal, not a roof spin from the quay).
    if (car._boatKey || car._boatRec || body === "boat" ||
        /\b(boat|yacht|dinghy|skiff|trawler|catamaran)\b/.test(name)) return false;
    if (car.airClass || car.flightKind || car._aircraft ||
        /\b(plane|aircraft|helicopter|chopper)\b/.test(body)) return false;
    return true;
  }

  function colliderCandidate(actor, rig, dirX, dirZ, opts, c, radius, height, reach) {
    if (!c) return null;
    if (c.noVault || c.noClimb || c._noTraversal) return travNo("opted-out");
    const band = colliderVerticalBand(c);
    if (!band) return null;
    const ap = travPos(actor);
    if (!ap) return null;
    const feet = ap.y || 0;
    // A suspended rail/awning is not a ledge. The solid face has to begin at
    // (or just below) this body's feet so there is something to plant against.
    if (band.y0 > feet + 0.38 || band.y1 <= feet + TRAV_MIN_RISE) return travNo("not-a-face");
    // READ THE BAND OUT NOW. colliderVerticalBand hands back the SHARED
    // travDerivedBand for any legacy heightless collider, and ceilingOver
    // below calls it again for every box overhead — so a `band.y1` read after
    // that point is whichever wall was scanned last, not this obstacle.
    // (Found the honest way: the first draft kept the reference and a window
    // header silently became the sill's own top.)
    const bandY0 = band.y0, bandY1 = band.y1, bandAuthored = band.authored;
    const rise = bandY1 - feet;
    const maxRise = height + Math.max(0.48, Math.min(0.72, height * 0.34));
    if (rise > maxRise) return travNo("above-reach");        // hands cannot reach the top

    const expanded = rayRect(
      ap.x, ap.z, dirX, dirZ,
      c.minX - radius, c.maxX + radius, c.minZ - radius, c.maxZ + radius, 64);
    if (!expanded || expanded.enter > reach) return travNo("out-of-reach");
    const raw = rayRect(ap.x, ap.z, dirX, dirZ,
      c.minX, c.maxX, c.minZ, c.maxZ, 64);
    if (!raw || raw.exit <= TRAV_EPS) return travNo("not-in-line");
    const span = Math.max(0.04, raw.exit - raw.enter);
    // NPC base speeds are deliberately human-scale and much lower than the
    // player tune, so callers may declare that this mover is already in its run
    // gait. Without that bit, a fleeing pedestrian would turn every waist-high
    // box into a slow two-handed climb instead of the flowing vault it deserves.
    const fast = opts.running === true ||
      (opts.speed || 0) > (((CBZ.TUNE && CBZ.TUNE.walkSpeed) || 2) * 0.82);

    // ---- PLAN A: OVER THE TOP (the move this file has always made) --------
    let kind = rise <= TRAV_VAULT_RISE && span <= TRAV_VAULT_SPAN && fast ? "vault" : "mantle";
    let landOnTop = false;
    let overOK = true;
    const overLimit = kind === "vault" ? TRAV_VAULT_SPAN : TRAV_MANTLE_SPAN;
    if (span > overLimit) {
      // Landing on top needs the ordinary collider resolver to understand that
      // vertical band on the next frame. A legacy heightless collider does not,
      // so it may be crossed when thin but never used as a sticky top surface.
      if (!opts.allowTop || bandAuthored === false) overOK = false;
      else { landOnTop = true; kind = "mantle"; }
    }

    /* ---- IS THERE A ROOF ON THIS THING? ----------------------------------
       Everything above this line asked only "how high is the top and how wide
       is the box" — the two questions you need in order to go OVER something.
       Neither of them can tell a garden wall from a window sill, because the
       difference is not in the sill at all: it is whether there is sky above
       it. So ask, and let the answer choose between the two plans. */
    const top = bandY1;
    const v2 = parkourV2();
    // FLAG OFF: never look up at all, and refuse a too-wide obstacle exactly
    // where the shipped file refused it. That is the whole old behaviour.
    if (!v2 && !overOK) return travNo("span-too-wide");
    const ceilY = v2 ? ceilingOver(ap, dirX, dirZ, raw.enter, raw.exit, top, radius, c) : Infinity;
    const headroom = ceilY - top;
    const needOver = landOnTop ? height + 0.10 : TRAV_TOP_CLEAR + height * TRAV_FOLD;
    if (v2 && (!overOK || headroom < needOver)) {
      /* ---- PLAN B: THROUGH IT ------------------------------------------
         Either there is no way over the top at all, or the ceiling will not
         let a body be carried over one. If what is left between the top and
         that ceiling is man-sized, thread it. */
      if (opts.through === false) { travAudit.gapRefused++; return travNo("gap-not-allowed"); }
      if (rise > TRAV_GAP_SILL) { travAudit.gapRefused++; return travNo("gap-sill-too-high"); }
      if (span > TRAV_GAP_DEPTH) { travAudit.gapRefused++; return travNo("gap-too-deep"); }
      if (headroom < TRAV_GAP_MIN) { travAudit.gapRefused++; return travNo("gap-too-short"); }
      /* STRIDE vs COMMIT, and the deciding fact is the SILL, not the ceiling.
         A blown doorway with an ankle-high lip is stepped through with a
         ducked head no matter how tight the header is, because your legs can
         still do the work. A waist-high window sill takes your legs out of it
         — there is nothing to stride with — so the only way through is to go
         horizontal and let your arms lead. That is why a dive is a different
         move and not a smaller step. */
      const gapStyle = (rise <= TRAV_GAP_STEP_SILL && headroom >= height * TRAV_GAP_STEP_H)
        ? "step" : "dive";
      const passH = gapStyle === "dive" ? TRAV_GAP_DIVE_H : height * TRAV_GAP_STEP_H;
      const passY = top + 0.05;
      if (passY + passH > ceilY + 0.02) { travAudit.gapRefused++; return travNo("gap-body-wont-fit"); }
      /* A dive lands LONG and rolls out; a step puts a foot down just clear.
         The extra metre is not decoration: the root is pinned at the sill line
         until the whole body is past the far face (sampleTraversal's faceOutU),
         so all of the descent has to happen in the stretch after it. Pad it too
         tightly and a 0.95 m drop gets squeezed into ~0.09 s, which reads as
         the body being yanked to the floor. Landing long spends that height
         over roughly twice the time, and the roll then absorbs it. */
      const gapEndT = expanded.exit + (gapStyle === "dive" ? 1.05 : TRAV_LAND_PAD);
      const gx = ap.x + dirX * gapEndT, gz = ap.z + dirZ * gapEndT;
      return {
        kind: "through", gapStyle, car: null, collider: c, ceilRef: ceilingOver.ref,
        // passH travels WITH the move: entities/character.js lays the body out
        // inside this exact envelope, so the pose and the fit check can never
        // disagree about how tall a threading body is.
        rise, top, span, landOnTop: false, passY, passH, headroom,
        enter: expanded.enter, exit: expanded.exit, faceT: raw.enter,
        contactT: Math.max(0, raw.enter - Math.min(0.42, height * 0.22)),
        endT: gapEndT, endY: groundAt(gx, gz, feet),
        minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ,
      };
    }

    let contactT = Math.max(0, expanded.enter + 0.03);
    if (kind === "mantle") {
      // A collision radius is a hip/torso clearance, not an arm length. Stop a
      // climbing body's centre far enough outside the face for its bent arms to
      // carry the hang; using radius alone put the shoulders almost over the
      // lip and forced the elbows into an implausible 150° fold.
      contactT = Math.max(0, raw.enter - Math.min(0.58, height * 0.30));
    }
    let endT, endY;
    if (landOnTop) {
      // Expanded entry is one radius before the face. Move one radius plus a
      // small inset so the hips finish over the top rather than hanging outside.
      endT = Math.min(raw.exit - 0.10, expanded.enter + radius + TRAV_TOP_INSET);
      if (endT <= raw.enter + 0.05) return travNo("top-too-narrow");   // cannot receive a body
      endY = bandY1;
    } else {
      endT = expanded.exit + TRAV_LAND_PAD;
      const ex = ap.x + dirX * endT, ez = ap.z + dirZ * endT;
      endY = groundAt(ex, ez, feet);
    }
    return {
      kind, car: null, collider: c, rise, top: bandY1, span, landOnTop,
      enter: expanded.enter, exit: expanded.exit, faceT: raw.enter,
      contactT, endT, endY,
      minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ,
    };
  }

  function carCandidate(actor, rig, dirX, dirZ, opts, car, radius, height, reach) {
    if (!isTraversalRoadCar(car) || !car.pos || car.player || (car.dead && !car._husk)) return null;
    const speed = Math.max(Math.abs(car.v || 0), Math.hypot(car.vx || 0, car.vz || 0));
    if (speed > TRAV_CAR_SPEED) return null;
    const dims = car.dims || (car.group && car.group.userData && car.group.userData.vehicleDims);
    if (!dims || !(dims.width > 0) || !(dims.length > 0) || !(dims.height > 0)) return null;
    const ap = travPos(actor);
    if (!ap) return null;
    const feet = ap.y || 0;
    const top = (car.group ? car.group.position.y : car.pos.y || 0) + dims.height;
    const rise = top - feet;
    const maxRise = height + Math.max(0.48, Math.min(0.72, height * 0.34));
    if (rise <= TRAV_MIN_RISE || rise > maxRise) return null;

    carLocal(car, ap.x, ap.z, carFrame);
    // Transform the world heading into the car's local frame.
    carDir.x = dirX * carFrame.c - dirZ * carFrame.s;
    carDir.z = dirX * carFrame.s + dirZ * carFrame.c;
    const hw = dims.width * 0.5, hl = dims.length * 0.5;
    const expanded = rayRect(carFrame.x, carFrame.z, carDir.x, carDir.z,
      -hw - radius, hw + radius, -hl - radius, hl + radius, 64);
    if (!expanded || expanded.enter > reach) return null;
    const raw = rayRect(carFrame.x, carFrame.z, carDir.x, carDir.z,
      -hw, hw, -hl, hl, 64);
    if (!raw || raw.exit <= TRAV_EPS) return null;
    const span = Math.max(0.04, raw.exit - raw.enter);
    // A car is vaultable across its width. Approaching the long axis means go
    // around it: a five-metre superhero glide is not a character jump.
    if (span > TRAV_VAULT_SPAN + 0.35) return null;
    const kind = rise <= height + 0.16 ? "vault" : "mantle";
    const contactT = kind === "mantle"
      ? Math.max(0, raw.enter - Math.min(0.58, height * 0.30))
      : Math.max(0, expanded.enter + 0.03);
    const endT = expanded.exit + TRAV_LAND_PAD;
    const ex = ap.x + dirX * endT, ez = ap.z + dirZ * endT;
    return {
      kind, car, collider: null, rise, top, span, landOnTop: false,
      enter: expanded.enter, exit: expanded.exit, faceT: raw.enter,
      contactT, endT,
      endY: groundAt(ex, ez, feet),
    };
  }

  function landingClear(cand, x, z, feet, height, radius) {
    // "Do not vault into water." cityWaterAt answers for the CITY's water
    // field (and, through world/water_survival.js's wrapper, the disaster
    // island's) — it knows nothing about the prison, whose slab sits in the
    // same coordinate space the city calls ocean. Asking it there would refuse
    // every vault in the block once the campaign has built the city. Ask only
    // where the answer is about this world.
    const wetMode = !CBZ.game || CBZ.game.mode === "city" || CBZ.islandModeOn(CBZ.game.mode);
    if (wetMode && CBZ.cityWaterAt) {
      try { if (CBZ.cityWaterAt(x, z)) return false; } catch (e) {}
    }
    CBZ.queryCollidersNear(x, z, radius + 0.2, travClearQuery);
    const head = feet + height;
    for (let i = 0; i < travClearQuery.length; i++) {
      const c = travClearQuery[i];
      if (c === cand.collider) continue;
      if (c.y0 != null && (head <= c.y0 || feet >= c.y1)) continue;
      if (circleTouchesRect(x, z, radius, c.minX, c.maxX, c.minZ, c.maxZ)) return false;
    }
    const cars = traversalCars();
    if (cars && cars.length) {
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        if (!car || car === cand.car || !car.pos || (car.dead && !car._husk)) continue;
        const dims = car.dims || (car.group && car.group.userData && car.group.userData.vehicleDims);
        if (!dims) continue;
        carLocal(car, x, z, carFrame);
        if (circleTouchesRect(carFrame.x, carFrame.z, radius,
          -dims.width * 0.5, dims.width * 0.5, -dims.length * 0.5, dims.length * 0.5)) return false;
      }
    }
    return true;
  }

  function sampleTraversal(s, u, out) {
    if (s.kind === "vault") {
      // Velocity-matched root motion (see hermite01). `s.tangent` is the
      // approach speed expressed in path lengths per duration, so a vault
      // timed at pathLength/speed rides straight through at run pace.
      // tangent === null is the flag-off path: the shipped smooth01 fade.
      const ease = s.tangent == null ? smooth01(u) : hermite01(u, s.tangent);
      out.x = s.startX + (s.endX - s.startX) * ease;
      out.z = s.startZ + (s.endZ - s.startZ) * ease;
      const base = s.startY + (s.endY - s.startY) * ease;
      const middle = (s.startY + s.endY) * 0.5;
      const lift = Math.max(0.52, s.top + 0.24 - middle);
      out.y = base + Math.sin(Math.PI * u) * lift;
      return out;
    }
    if (s.kind === "through") {
      /* THREADING A HOLE, in three beats and one constraint: between the
         near face and the far face the root Y is PINNED to passY, because
         that is the only band the body fits in. Outside the wall it is free
         to rise off the ground and settle onto the landing. Ballistic-looking
         curves are wrong here — an arc is exactly what the header rejects. */
      const ease = hermite01(u, s.tangent != null ? s.tangent : 1);
      out.x = s.startX + (s.endX - s.startX) * ease;
      out.z = s.startZ + (s.endZ - s.startZ) * ease;
      /* Defaulted rather than trusted. buildTraversal always sets both of these
         for a `through` state, but the failure mode if it ever did not is
         `u - undefined` = NaN written straight into the actor's position — a
         body that vanishes to nowhere and takes the camera with it. A wrong
         pin height is a cosmetic bug; a NaN root is not recoverable. */
      const inU = s.faceInU != null ? s.faceInU : 0.30;
      const outU = s.faceOutU != null ? s.faceOutU : 0.70;
      if (u <= inU) {
        // approach: lift the feet from the floor to the sill line
        const q = smooth01(inU > 1e-4 ? u / inU : 1);
        out.y = s.startY + (s.passY - s.startY) * q;
      } else if (u < outU) {
        out.y = s.passY;                       // inside the aperture: held flat
      } else {
        const q = smooth01((u - outU) / Math.max(1e-4, 1 - outU));
        // A dive keeps its height a beat longer and drops late (it is still
        // horizontal); a step puts a foot down straight away.
        const drop = s.gapStyle === "dive" ? q * q : q;
        out.y = s.passY + (s.endY - s.passY) * drop;
      }
      return out;
    }
    if (u < 0.28) {
      const q = smooth01(u / 0.28);
      out.x = s.startX + (s.contactX - s.startX) * q;
      out.z = s.startZ + (s.contactZ - s.startZ) * q;
      out.y = s.startY + (s.hangY - s.startY) * q;
    } else if (u < 0.68) {
      const phase = (u - 0.28) / 0.40;
      const q = smooth01(phase);
      // Rise against the face first, then bring the hips across. Advancing XZ
      // at the same rate as Y cramped the shoulder directly over the ledge and
      // forced even a correct IK chain into a folded chicken-wing silhouette.
      const cross = smooth01((phase - 0.12) / 0.88);
      out.x = s.contactX + (s.crestX - s.contactX) * cross;
      out.z = s.contactZ + (s.crestZ - s.contactZ) * cross;
      out.y = s.hangY + (s.crestY - s.hangY) * q;
    } else {
      const q = smooth01((u - 0.68) / 0.32);
      out.x = s.crestX + (s.endX - s.crestX) * q;
      out.z = s.crestZ + (s.endZ - s.crestZ) * q;
      out.y = s.crestY + (s.endY - s.crestY) * q;
    }
    return out;
  }

  function buildTraversal(actor, rig, dirX, dirZ, opts, hit) {
    const p = travPos(actor), height = rigHeight(rig, opts), radius = opts.radius || actor.radius || 0.5;
    const endX = p.x + dirX * hit.endT, endZ = p.z + dirZ * hit.endT;
    const contactX = p.x + dirX * hit.contactT, contactZ = p.z + dirZ * hit.contactT;
    // The animator targets this actual near/top edge with both wrists. Keeping
    // the ledge point in world space lets a short/young rig solve its own arm
    // chain instead of inheriting one adult "arms up" angle.
    const faceT = hit.faceT != null ? hit.faceT : hit.enter + radius;
    const ledgeX = p.x + dirX * faceT, ledgeZ = p.z + dirZ * faceT;
    const crestT = hit.landOnTop
      ? hit.endT
      : Math.max(hit.contactT, Math.min(hit.endT, (hit.enter + hit.exit) * 0.5));
    let style = "climb";
    let styleIndex = -1;
    if (hit.kind === "through") {
      style = hit.gapStyle || "dive";
    } else if (hit.kind === "vault") {
      // Jump is always the traversal input. Sprint is an expressive modifier:
      // without it the actor still gets across using a controlled speed/kong
      // vault; with committed momentum the flashier spy spin enters the pool,
      // and a sprinting side-on car vault deliberately chooses it.
      const sprinting = opts.sprinting === true;
      // A REVOLUTION NEEDS SOMETHING TO REVOLVE OVER. The spin keeps its full
      // readable window below (that window is not negotiable — a 360 in a
      // third of a second is the dropped-frame read it was slowed down to
      // cure), which means it is the one move that deliberately SPENDS
      // momentum. Over a car or a wall that trade reads as a flourish; over a
      // 30 cm kerb it reads as the body stopping dead to pirouette. So
      // momentum unlocks it and geometry still has to afford it.
      const roomToSpin = sprinting && hit.span >= 0.80;
      const styles = roomToSpin ? ["speed", "kong", "spin"] : ["speed", "kong"];
      const previous = actor._traverseStyle == null ? -1 : actor._traverseStyle;
      const n = (previous + 1) % styles.length;
      style = hit.car && roomToSpin ? "spin" : styles[n];
      styleIndex = style === "speed" ? 0 : (style === "kong" ? 1 : 2);
    }
    /* ---- HOW LONG THE MOVE TAKES, AND WHY IT IS NOT A CONSTANT ------------
       The shipped durations were fixed windows (0.68-0.92 s for a vault) and
       that is the other half of the "glitchy vault". A body arrives at the
       obstacle at anywhere from 2 to 9 m/s; giving all of them the same 0.8 s
       to cross the same 2.5 m means the fast ones are held back to a float
       and the slow ones are flung. Combined with smooth01's zero end
       tangents, the fast case — which is the case you actually play — stalled
       at the wall and then teleported off it.

       So the vault and the aperture are timed at pathLength / approach speed,
       which is what "keep running, the wall is just terrain" means, and the
       tangent is then whatever ratio survives the clamps. A mantle keeps a
       rise-scaled duration because hauling your own weight up IS slow and its
       tempo has nothing to do with how fast you were walking. */
    const pathLen = Math.max(0.35, Math.hypot(endX - p.x, endZ - p.z));
    const approach = Math.max(1.6, hit.kind === "through" || hit.kind === "vault"
      ? (opts.speed || 0) : 0);
    let duration;
    if (!parkourV2()) {
      // The shipped windows, byte for byte, and sampleTraversal falls back to
      // smooth01 because `tangent` is left null on the state.
      duration = hit.kind === "vault"
        ? (style === "spin"
            ? Math.min(1.30, 1.10 + hit.span * 0.08)
            : Math.min(0.92, 0.68 + hit.span * 0.07))
        : Math.min(1.36, 0.96 + hit.rise * 0.15);
    } else if (hit.kind === "mantle") {
      duration = Math.min(1.36, 0.96 + hit.rise * 0.15);
    } else if (style === "spin") {
      // THE ONE MOVE THAT IS ALLOWED TO COST SPEED, and the reason the tangent
      // clamp below matters. A spy vault genuinely decelerates through the
      // rotation and re-accelerates out of it — that is what it looks like
      // when a person does one. Keeping the readable window and letting the
      // Hermite carry a tangent near its ceiling gives exactly that shape:
      // enters at run pace, slows across the roll, leaves at run pace. What
      // it no longer does is start and finish at a dead stop.
      duration = Math.min(1.30, 1.10 + hit.span * 0.08);
    } else {
      duration = Math.max(0.26, Math.min(0.95, pathLen / approach));
    }
    // Tangent in path-lengths-per-duration; 1 is a perfectly matched, perfectly
    // straight carry-through. 3 is the monotonicity ceiling for this basis.
    const tangent = parkourV2()
      ? Math.max(0, Math.min(3, (approach * duration) / pathLen))
      : null;
    const s = {
      kind: hit.kind, style, car: hit.car, collider: hit.collider,
      styleIndex, tangent, pathLen,
      gapStyle: hit.gapStyle || null, ceilRef: hit.ceilRef || null,
      passY: hit.passY, passH: hit.passH, headroom: hit.headroom,
      landOnTop: hit.landOnTop, top: hit.top, rise: hit.rise, span: hit.span,
      minX: hit.minX, maxX: hit.maxX, minZ: hit.minZ, maxZ: hit.maxZ,
      startX: p.x, startY: p.y || 0, startZ: p.z,
      endX, endY: hit.endY, endZ,
      contactX, contactZ, ledgeX, ledgeZ,
      crestX: p.x + dirX * crestT, crestZ: p.z + dirZ * crestT,
      hangY: Math.max(p.y + 0.12, hit.top - height * 0.70),
      crestY: hit.top + (hit.landOnTop ? 0.04 : 0.20),
      dirX, dirZ, yaw: Math.atan2(dirX, dirZ),
      radius, height, speed: opts.speed || 0, sprinting: opts.sprinting === true,
      // WHOSE FIELD IS `.speed`? For a city pedestrian and a survival bot it is
      // the CURRENT speed, recomputed every frame, and stepTraversal writing the
      // vault speed into it is what keeps the animator in sync. For a PRISON
      // inmate it is the record's BASE walking speed, read as
      // `CBZ.aiThink(n, dt) || n.speed` (entities/npc.js) — writing to it would
      // permanently re-tune that inmate to whatever pace they last vaulted at.
      // Callers who own a base-speed field opt out with speedField:false.
      speedField: opts.speedField !== false,
      duration, elapsed: 0, t: 0,
      wallStart: (CBZ.now != null ? CBZ.now : (typeof performance !== "undefined" ? performance.now() : 0)),
      sounded: false,
    };
    if (hit.kind === "through") {
      // WHERE THE WALL IS, AS A FRACTION OF THE MOVE. sampleTraversal pins the
      // root height between these two, so they have to be the real faces
      // solved back through the SAME Hermite the XZ uses — solving them off a
      // linear u would pin the wrong stretch on any mismatched crossing and
      // clip the body's feet through the sill.
      s.faceInU = hermiteInvert(Math.max(0, hit.faceT - radius * 0.5) / hit.endT, tangent);
      s.faceOutU = hermiteInvert(Math.min(1, (hit.exit + 0.05) / hit.endT), tangent);
      if (s.faceOutU <= s.faceInU) s.faceOutU = Math.min(1, s.faceInU + 0.08);
    }
    // Validate the destination and two body-sized samples over the obstacle.
    if (!landingClear(hit, endX, endZ, hit.endY, height, radius)) return travNo("landing-blocked");
    /* A THREADING BODY IS NARROWER AND SHORTER THAN A STANDING ONE, and the
       aperture's own frame is not an obstacle to it. Both facts have to reach
       this sweep or it refuses every hole it was just written to find: the
       header is by definition inside the head band (that is what made it a
       header), and the standing radius is a hip clearance for someone walking
       upright, which a diver is not. Everything ELSE — a flank, a pier, a
       second wall a metre behind — still vetoes at full strictness, so the
       exemption is exactly two boxes wide and cannot open a path through
       masonry. */
    const thru = hit.kind === "through";
    // The profile here MUST be the same one colliderCandidate measured the
    // ceiling against, or the two disagree and a move the candidate approved
    // gets thrown away by its own validator — which is precisely how a window
    // used to be refused. Folded for anything crossing an obstacle, full
    // height only when the body is going to stand up on top of it.
    const sweepH = !parkourV2() ? height
      : (thru
        ? (hit.gapStyle === "dive" ? TRAV_GAP_DIVE_H : height * TRAV_GAP_STEP_H)
        : (hit.landOnTop ? height : height * TRAV_FOLD));
    const sweepR = radius * (thru ? TRAV_GAP_TUCK : 0.82);
    const samples = thru ? [0.30, 0.50, 0.70] : [0.42, 0.66];
    for (let i = 0; i < samples.length; i++) {
      sampleTraversal(s, samples[i], travPoint);
      CBZ.queryCollidersNear(travPoint.x, travPoint.z, radius + 0.05, travClearQuery);
      for (let j = 0; j < travClearQuery.length; j++) {
        const c = travClearQuery[j];
        if (c === hit.collider) continue;
        if (thru && c === hit.ceilRef) continue;           // the aperture's own header
        const head = travPoint.y + sweepH;
        if (c.y0 != null && (head <= c.y0 || travPoint.y >= c.y1)) continue;
        if (circleTouchesRect(travPoint.x, travPoint.z, sweepR,
          c.minX, c.maxX, c.minZ, c.maxZ)) {
          return travNo(thru ? "gap-path-blocked" : "path-blocked");   // second wall / low ceiling
        }
      }
    }
    return s;
  }

  function probeTraversal(actor, rig, dirX, dirZ, opts) {
    opts = opts || {};
    travAudit.probes++;
    // THE CAPABILITY, NOT THE SCENARIO (systems/modecaps.js). This line used to
    // read `CBZ.game.mode !== "city"`, which is why the prison's own mess
    // tables and stools — which already register exactly the y0/y1 + ref
    // colliders this probe wants (world/cafeteria.js:320,342) — could not be
    // vaulted by anybody. Nothing below reads a city record: colliders,
    // platforms and the character rig are engine, not city.
    const traverseOn = CBZ.modeHas ? CBZ.modeHas("traverse") : CBZ.game.mode === "city";
    if (!actor || !rig || !traverseOn) return null;
    const apos = travPos(actor);
    if (!apos) return null;
    if (actor._traversal || actor.dead || actor.driving || actor.inCar) return null;
    let dl = Math.hypot(dirX, dirZ);
    if (dl < 0.5) return null;
    dirX /= dl; dirZ /= dl;
    const radius = opts.radius || actor.radius || 0.5;
    const height = rigHeight(rig, opts);
    const reach = opts.reach || Math.min(2.25, TRAV_REACH_BASE + Math.max(0, opts.speed || 0) * TRAV_REACH_SPEED);
    let best = null;
    CBZ.queryCollidersNear(apos.x + dirX * reach * 0.5,
      apos.z + dirZ * reach * 0.5, reach + 1.2, travQuery);
    for (let i = 0; i < travQuery.length; i++) {
      const hit = colliderCandidate(actor, rig, dirX, dirZ, opts, travQuery[i], radius, height, reach);
      if (hit && (!best || hit.enter < best.enter)) best = hit;
    }
    const roadCars = traversalCars();
    if (opts.cars !== false && roadCars && roadCars.length) {
      // Every running pedestrian probed EVERY car in the city (500+) through
      // carCandidate's frame transform and rectangle sweep — 2% of the whole
      // frame in the profiler, for cars streets away. A car whose centre is
      // farther than reach + its own half-length + the body radius cannot be
      // entered within reach; skip it on one squared distance.
      const ax = apos.x, az = apos.z;
      for (let i = 0; i < roadCars.length; i++) {
        const car = roadCars[i];
        if (!car || !car.pos) continue;
        const cd = car.dims || (car.group && car.group.userData && car.group.userData.vehicleDims);
        const span = reach + radius + 0.5 + (cd ? Math.max(cd.length || 0, cd.width || 0) * 0.5 : 6);
        const cdx = car.pos.x - ax, cdz = car.pos.z - az;
        if (cdx * cdx + cdz * cdz > span * span) continue;
        const hit = carCandidate(actor, rig, dirX, dirZ, opts, car, radius, height, reach);
        if (hit && (!best || hit.enter < best.enter)) best = hit;
      }
    }
    return best ? buildTraversal(actor, rig, dirX, dirZ, opts, best) : null;
  }

  function startTraversal(actor, rig, dirX, dirZ, opts) {
    opts = opts || {};
    const s = probeTraversal(actor, rig, dirX, dirZ, opts);
    if (!s) return null;
    actor._traversal = s;
    if (s.styleIndex >= 0) actor._traverseStyle = s.styleIndex;
    actor._traverseSurface = null;
    actor.vy = 0;
    if (actor.grounded != null) actor.grounded = false;
    if (rig) {
      rig.slidePose = false; rig.pronePose = false; rig.crouch = false;
      rig.traversePose = s;
    }
    travAudit.starts++;
    if (s.kind === "vault") travAudit.vaults++;
    else if (s.kind === "through") { travAudit.throughs++; if (s.gapStyle === "dive") travAudit.dives++; }
    else travAudit.mantles++;
    if (s.car) travAudit.cars++;
    if (actor === player && CBZ.sfx) CBZ.sfx("jump");
    return s;
  }

  /* ---- CATCHING THE EDGE --------------------------------------------------
     A body in the air, falling, with a lip in front of it at hand height.
     Everything needed to finish that sentence already exists — the mantle
     hauls a body from a hang onto a top, and `landOnTop` makes the collider
     resolver understand the surface it arrives on. What was missing is
     nobody ever LOOKED, because probeTraversal reads the obstacle band
     against the FEET and a falling body's feet are below the ledge it is
     about to miss.

     So this is a second entry point, not a second mechanic: it finds the lip,
     and hands the ordinary mantle a hit record describing it. Deliberately
     narrow — it may only ever produce a landOnTop mantle onto a real authored
     band, so the worst case of a false positive is a body standing on a
     surface it could have vaulted onto anyway. */
  function catchLedge(actor, rig, dirX, dirZ, opts) {
    opts = opts || {};
    if (!parkourV2()) return null;
    const traverseOn = CBZ.modeHas ? CBZ.modeHas("traverse") : CBZ.game.mode === "city";
    if (!actor || !rig || !traverseOn) return null;
    if (actor._traversal || actor.dead || actor.driving || actor.inCar || actor.grounded) return null;
    if (actor.noVault || actor._noTraversal) return null;
    if ((actor.vy || 0) > TRAV_CATCH_RISE) return null;      // still going up: nothing has gone wrong yet
    const ap = travPos(actor);
    if (!ap) return null;
    let dl = Math.hypot(dirX, dirZ);
    if (dl < 0.35) return null;                              // no committed direction = no reach
    dirX /= dl; dirZ /= dl;
    const radius = opts.radius || actor.radius || 0.5;
    const height = rigHeight(rig, opts);
    const feet = ap.y || 0;
    const reach = TRAV_CATCH_REACH + radius;
    CBZ.queryCollidersNear(ap.x + dirX * reach * 0.5, ap.z + dirZ * reach * 0.5, reach + 1.0, travQuery);
    let best = null, bestD = 1e9;
    for (let i = 0; i < travQuery.length; i++) {
      const c = travQuery[i];
      if (!c || c.noVault || c.noClimb || c._noTraversal) continue;
      // Authored band only: the hands are about to put the whole body's weight
      // on this top, and a derived band is a picture's bounding box, not a
      // surface groundAt will still be holding us up on next frame.
      if (c.y0 == null || c.y1 == null || !isFinite(c.y1)) continue;
      const lip = c.y1 - feet;
      // The hands work between chest and a little over the head. Below that
      // the body would have landed on it; above it, there is nothing to grab.
      if (lip < TRAV_CATCH_LOW || lip > height * 0.95) continue;
      const hitRect = rayRect(ap.x, ap.z, dirX, dirZ,
        c.minX - radius, c.maxX + radius, c.minZ - radius, c.maxZ + radius, 64);
      if (!hitRect || hitRect.enter > reach) continue;
      const raw = rayRect(ap.x, ap.z, dirX, dirZ, c.minX, c.maxX, c.minZ, c.maxZ, 64);
      if (!raw || raw.exit <= TRAV_EPS) continue;
      // The top has to be able to RECEIVE a body — a 20 cm parapet cap is a
      // handhold with nowhere to go, and pulling onto it would leave the
      // actor standing on air the moment traversalSurfaceY stops matching.
      const endT = Math.min(raw.exit - 0.10, hitRect.enter + radius + TRAV_TOP_INSET);
      if (endT <= raw.enter + 0.05) continue;
      if (hitRect.enter >= bestD) continue;
      bestD = hitRect.enter;
      best = {
        kind: "mantle", car: null, collider: c, rise: lip, top: c.y1, span: raw.exit - raw.enter,
        landOnTop: true, enter: hitRect.enter, exit: hitRect.exit, faceT: raw.enter,
        contactT: Math.max(0, raw.enter - Math.min(0.58, height * 0.30)),
        endT, endY: c.y1,
        minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ,
      };
    }
    if (!best) return null;
    const s = buildTraversal(actor, rig, dirX, dirZ, opts, best);
    if (!s) return null;
    s.caught = true;
    actor._traversal = s;
    actor._traverseSurface = null;
    actor.vy = 0;
    actor._fallPeak = 0;         // the catch IS the save: no fall damage on arrival
    if (actor.grounded != null) actor.grounded = false;
    rig.slidePose = false; rig.pronePose = false; rig.crouch = false;
    rig.traversePose = s;
    travAudit.starts++; travAudit.mantles++; travAudit.catches++;
    if (actor === player && CBZ.sfx) CBZ.sfx("hit");     // palms slapping the lip
    return s;
  }

  /* ---- THE LANDING ---------------------------------------------------------
     OWNER: "real parkour jumping, catching self, LANDING, catching edge".

     Landing was the one beat the engine never had. A traversal ended by
     nulling the pose on the frame the root reached its destination, and the
     walk cycle resumed on the very next frame from a full tuck — so the body
     went from horizontal to strolling with nothing in between. Same for an
     ordinary fall: vy zeroed and you were simply walking again.

     A landing is not a pose, it is a BUDGET: how much vertical energy has to
     go somewhere. Under a step-down it is absorbed by the ankles and nobody
     notices. Over it the knees fold. Past what the knees can take, a body
     that is still MOVING FORWARD converts the drop into a roll — which is
     the whole reason a roll exists in parkour and not a stylistic choice —
     and a body that is not, takes the hit standing and stumbles.

     This owns the ARMING only. entities/character.js owns the pose and runs
     the clock, exactly the way `_traverseRecover` already works, so nothing
     here needs a per-frame updater and an NPC with no landing animator pays
     one property write. */
  /* CALIBRATED AGAINST THIS GAME'S OWN NUMBERS, not against 9.8 m/s². TUNE
     gravity is 22 and jumpVel is 8.2, so an ordinary jump lands at 8.2 m/s and
     a step off the 0.45 m STEP_UP kerb arrives at 4.4. Those two facts set both
     thresholds: 5.5 leaves every curb and stair silent while giving a plain
     jump a small honest settle (hard ≈ 0.3), and the roll line is pinned to
     FALL_SAFE — the exact speed at which cityFallLand starts charging for the
     landing — so the move appears at the moment it becomes worth doing. */
  const LAND_SOFT = 5.5;        // m/s — below this the ankles eat it, no pose at all
  const LAND_ROLL = 11.0;       // m/s — == FALL_SAFE: you roll out of the fall that would hurt
  const ROLL_CREDIT = 2.6;      // m/s of impact a completed roll dissipates
  function armLanding(rig, impact, forwardSpeed, opts) {
    if (!rig || !parkourV2()) return null;
    const v = Math.max(0, impact || 0);
    if (v < LAND_SOFT && !(opts && opts.force)) return null;
    // Rolling out needs somewhere to roll TO. A body that lands stationary
    // (dropped straight down, or ran into something) has no line for it and
    // absorbs standing instead — trying to roll from a standstill is the
    // "canned animation fires at the wrong moment" that reads as a bug.
    const roll = v >= LAND_ROLL && (forwardSpeed || 0) > 2.4 && !(opts && opts.noRoll);
    rig.landPose = {
      t: 0,
      // 0 = a knee-bend you barely see, 1 = everything the body has.
      hard: Math.max(0, Math.min(1, (v - LAND_SOFT) / 9)),
      roll,
      dur: roll ? 0.62 : 0.34,
    };
    if (roll) travAudit.rolls++;
    return rig.landPose;
  }
  CBZ.charArmLanding = armLanding;

  function clearTraversalPose(rig) {
    if (!rig) return;
    rig.traversePose = null;
    rig._traverseRecover = 1;
    // A full spin ends at ±2π, which is visually zero. Store zero so the next
    // animator frame does not numerically unwind a completed barrel roll.
    if (rig.model) rig.model.rotation.set(0, 0, 0);
  }

  function cancelTraversal(actor, rig, keepSurface, reason) {
    if (!actor) return false;
    const had = !!actor._traversal;
    actor._traversal = null;
    if (!keepSurface) actor._traverseSurface = null;
    clearTraversalPose(rig);
    if (had) {
      travAudit.cancelled++;
      travAudit.lastCancel = reason || "external";
    }
    return had;
  }

  function stepTraversal(actor, rig, dt, animate) {
    const s = actor && actor._traversal;
    if (!s || !rig) return false;
    const ap = travPos(actor);
    if (!ap) { cancelTraversal(actor, rig, false, "no-position"); return false; }
    const now = (CBZ.now != null ? CBZ.now : (typeof performance !== "undefined" ? performance.now() : 0));
    let cancelReason = "";
    if (actor.dead) cancelReason = "dead";
    else if (actor.driving || actor.inCar) cancelReason = "vehicle-owner";
    else if ((actor.ko || 0) > 0) cancelReason = "knockdown";
    else if ((now - s.wallStart) > (s.duration + 0.9) * 1000) cancelReason = "stalled";
    else if (s.car && Math.max(Math.abs(s.car.v || 0),
      Math.hypot(s.car.vx || 0, s.car.vz || 0)) > TRAV_CAR_SPEED * 2.2) cancelReason = "car-moved";
    if (cancelReason) {
      cancelTraversal(actor, rig, false, cancelReason);
      return false;
    }
    s.elapsed += Math.max(0, dt || 0);
    s.t = Math.min(1, s.elapsed / s.duration);
    sampleTraversal(s, s.t, travPoint);
    ap.x = travPoint.x; ap.y = travPoint.y; ap.z = travPoint.z;
    // Animation uses the current root and the fixed ledge point to keep the
    // palms planted while the shoulder rises through the pull.
    s.rootX = travPoint.x; s.rootY = travPoint.y; s.rootZ = travPoint.z;
    if (s.speedField) actor.speed = s.speed;
    if (actor.grounded != null) actor.grounded = false;
    if (rig.group.position !== ap) rig.group.position.copy(ap);
    rig.group.rotation.y = s.yaw;
    rig.traversePose = s;
    if (!s.sounded && s.t >= 0.30) {
      s.sounded = true;
      if (actor === player && CBZ.sfx) CBZ.sfx("whoosh");
    }
    if (animate !== false) animChar(rig, s.speed, dt);
    if (s.t < 1) return true;

    ap.x = s.endX; ap.y = s.endY; ap.z = s.endZ;
    if (rig.group.position !== ap) rig.group.position.copy(ap);
    actor.vy = 0;
    if (actor.grounded != null) actor.grounded = true;
    /* THE MOVE PAYS FOR ITS OWN LANDING. A vault that drops the body a metre
       onto the far side, and every dive through a window, arrive with real
       downward energy that the old instant pose-clear simply deleted. Score
       it off the geometry the trajectory already knows — the height given up
       plus the pace carried — rather than off vy, which a scripted
       trajectory never accumulates. A committed dive always earns the roll:
       going horizontal through a hole is the half of the move that MAKES it a
       dive, and coming out of one on your feet is not a thing bodies do. */
    // A ledge you have just finished pulling onto must not be caught again on
    // the next frame's fall — that loop is what makes an auto-grab feel sticky
    // instead of generous. One beat of immunity is enough; the body is standing
    // by then.
    actor._noGrabT = 0.35;
    const dropped = Math.max(0, (s.kind === "through" ? s.passY : s.top) - s.endY);
    const landV = Math.sqrt(2 * 9.8 * dropped) + (s.style === "spin" ? 2.0 : 0);
    armLanding(rig, s.gapStyle === "dive" ? Math.max(landV, LAND_ROLL) : landV,
      s.speed, { noRoll: s.landOnTop });
    if (s.landOnTop && s.collider) {
      actor._traverseSurface = {
        collider: s.collider, top: s.top,
        minX: s.minX, maxX: s.maxX, minZ: s.minZ, maxZ: s.maxZ,
        radius: s.radius,
      };
    }
    actor._traversal = null;
    clearTraversalPose(rig);
    travAudit.completed++;
    return true;                                            // traversal owned this whole frame
  }

  function traversalSurfaceY(actor, x, z, baseY) {
    const s = actor && actor._traverseSurface;
    if (!s) return baseY;
    const inset = Math.min(0.12, (s.radius || 0.5) * 0.2);
    if (x < s.minX - inset || x > s.maxX + inset || z < s.minZ - inset || z > s.maxZ + inset ||
        (s.collider && s.collider.ref && s.collider.ref.visible === false)) {
      actor._traverseSurface = null;
      return baseY;
    }
    return Math.max(baseY, s.top);
  }

  CBZ.characterTraversal = {
    probe: probeTraversal,
    start: startTraversal,
    step: stepTraversal,
    cancel: cancelTraversal,
    catchLedge: catchLedge,
    land: armLanding,
    surfaceY: traversalSurfaceY,
    active: function (actor) { return !!(actor && actor._traversal); },
    stats: function () {
      return {
        probes: travAudit.probes, starts: travAudit.starts,
        vaults: travAudit.vaults, mantles: travAudit.mantles,
        throughs: travAudit.throughs, dives: travAudit.dives,
        catches: travAudit.catches, rolls: travAudit.rolls,
        gapRefused: travAudit.gapRefused,
        cars: travAudit.cars, completed: travAudit.completed, cancelled: travAudit.cancelled,
        lastCancel: travAudit.lastCancel,
        // WHY the refusals happened, by reason. See travNo.
        why: Object.assign({}, travWhy), lastRefuse: travWhyLast,
      };
    },
    // Reset the refusal ledger so a tool can attribute one specific probe.
    clearWhy: function () {
      for (const k in travWhy) delete travWhy[k];
      travWhyLast = "";
    },
  };

  // Highest walkable surface under (x,z): the terrain height field, raised by
  // any building floor/stair/roof platform whose top is within reach. `fromY`
  // is the feet height we're testing from — a platform only counts as support
  // if it's no more than STEP_UP above us (so you can't walk up a sheer wall,
  // only stairs).
  /* ---- WHY THE PRISON USED TO BE EXEMPT, AND WHY IT IS NOT ANY MORE -------
     This test read `&& CBZ.game.mode !== "escape"` for its whole life, on the
     stated grounds that "in the prison there are no platforms, so this is just
     terrain". That was true the day it was written and has been false for a
     long time, silently:

       • world/towers.js registers a rung ladder + cabin deck per tower as
         CBZ.platforms ramp/landing records — and its own header has admitted
         since it shipped that they are INERT because of this one line.
       • world/props.js's picnic table is a systems/pieces.js `walkTop:true`
         piece, which is the engine's ONE standable-top contract; pieces.js
         pushes the platform record and this line threw it away.

     MEASURED, not assumed. In escape mode CBZ.platforms holds 17 records and
     every one of them is the prison's own (16 tower + 1 table). The adversarial
     case — play the CITY first, whose lazy build takes the array to 3,278, then
     come back — still leaves exactly those 17 inside the compound's AABB: the
     city is built nowhere near the yard, and nothing wider than PLAT_GIANT
     spans in. So the gate protected nothing that could be stood on by accident.
     The performance argument died earlier still: the bucket grid twenty lines
     up turned this from a linear scan into one Map lookup.

     What it cost: every "stand on the furniture" verb in the prison. A prop
     that moves keeps its support because systems/pushprops.js translates its
     platform record with its collider and calls markPlatformsDirty(). */
  /* ---- THE PLATFORM GRID -------------------------------------------------
     groundAt LINEARLY SCANNED every platform record — and it is called per
     vehicle per frame, plus by the player, plus by every ground query in the
     game. That was tolerable at a few hundred records; the 20-tier stadium
     pushes one platform PER DECK ROW and took the world to ~3,000.

     This is deliberately NOT a new data structure. Twenty lines up this same
     file already solves the identical problem for ~5,000 colliders with a
     SPARSE uniform bucket grid, and that pattern is the right one here: at a
     few thousand axis-aligned rects queried BY POINT, a grid is O(1) with a
     tiny constant, while an R-tree's O(log n) only starts winning somewhere
     above ~10k or under real density skew. A third-party index would also owe
     this repo's determinism law an audit of its bulk-load order, for nothing.
     So: same shape, same key scheme, own cell size.

     TWO THINGS THE COLLIDER GRID ALREADY GETS RIGHT AND WE INHERIT:
     • MULTI-CELL INSERTION into a SPARSE Map. A doorstep touches one cell, a
       stadium deck touches many, and memory grows only with OCCUPIED cells —
       a dense array at this cell size over a ~7000-unit world would be ~750k
       cells that are mostly nothing.
     • Rebuild keyed on array length, so a world rebuild re-buckets and nothing
       else has to remember to.
     PLUS ONE THIS PROBLEM NEEDS AND THAT ONE DOES NOT: a genuinely enormous
     platform would smear across hundreds of cells and bloat every bucket near
     it, so anything wider than GIANT goes in a short unconditional list
     instead. There are very few, and it keeps the common bucket short. */
  const PLAT_CELL = 24;         // platforms skew far bigger than wall colliders
  const PLAT_GIANT = 240;       // wider than this and it goes in the small list
  const platBuckets = new Map();
  const platGiant = [];
  const EMPTY_PLATS = [];
  let platCount = -1, platDirty = true;

  function rebuildPlatformGrid() {
    platBuckets.clear(); platGiant.length = 0;
    const plats = CBZ.platforms;
    for (let i = 0; i < plats.length; i++) {
      const p = plats[i];
      if (!p) continue;
      if ((p.maxX - p.minX) > PLAT_GIANT || (p.maxZ - p.minZ) > PLAT_GIANT) { platGiant.push(p); continue; }
      const x0 = Math.floor(p.minX / PLAT_CELL), x1 = Math.floor(p.maxX / PLAT_CELL);
      const z0 = Math.floor(p.minZ / PLAT_CELL), z1 = Math.floor(p.maxZ / PLAT_CELL);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = colKey(gx, gz);
        let b = platBuckets.get(k);
        if (!b) { b = []; platBuckets.set(k, b); }
        b.push(p);
      }
    }
    platCount = plats.length;
    platDirty = false;
  }
  /* A PLATFORM THAT MOVES NEEDS THE SAME DOORBELL A COLLIDER HAS. The grid
     above re-buckets when the ARRAY LENGTH changes, which catches every build
     and despawn — and misses the one case a pushable prop is: a record mutated
     in place. Its AABB is right and its bucket is stale, so a query at the
     prop's NEW position looks in a cell the record was never filed under and
     finds nothing. Same fix, same name, same one-liner as markCollidersDirty. */
  CBZ.markPlatformsDirty = function () { platDirty = true; };
  // The candidate list under a point: one Map lookup plus the giants.
  function platsAt(x, z) {
    const plats = CBZ.platforms;
    if (platDirty || platCount !== plats.length) rebuildPlatformGrid();
    const b = platBuckets.get(colKey(Math.floor(x / PLAT_CELL), Math.floor(z / PLAT_CELL)));
    if (!b) return platGiant.length ? platGiant : EMPTY_PLATS;
    if (!platGiant.length) return b;
    return b.concat(platGiant);
  }
  CBZ.platformGridAudit = function () {
    const plats = CBZ.platforms || [];
    if (platDirty || platCount !== plats.length) rebuildPlatformGrid();
    let maxBucket = 0, total = 0;
    platBuckets.forEach(function (b) { total += b.length; if (b.length > maxBucket) maxBucket = b.length; });
    return {
      platforms: plats.length, cells: platBuckets.size, giants: platGiant.length,
      meanBucket: platBuckets.size ? +(total / platBuckets.size).toFixed(1) : 0,
      maxBucket: maxBucket, cell: PLAT_CELL,
    };
  };

  /* THE CEILING. Nothing in this engine has ever clamped ASCENT: collide()
     resolves x/z only, and its y-band test (see the c.y0/c.y1 check above)
     SKIPS a wall the body clears rather than stopping it. That was harmless
     while the only thing overhead was sky. It stops being harmless the moment
     the ground has a lid on it — a room under an intact street — because a jump
     would put your head through the road. systems/solidground.js answers with
     the underside of the nearest solid span above you, and Infinity when there
     is none, which is every column in a world with no lids: this is a compare
     and a branch that never fires until something is actually overhead. */
  // stance-aware in spirit; the crouch cases pass their own headroom
  function bodyHeight() { return 1.7; }
  function clampCeiling(p, headroom) {
    if (!CBZ.ceilAt) return false;
    const c = CBZ.ceilAt(p.pos.x, p.pos.z, p.pos.y);
    if (!(c < Infinity)) return false;
    const head = p.pos.y + (headroom || bodyHeight());
    if (head <= c) return false;
    p.pos.y = c - (headroom || bodyHeight());
    if (p.vy > 0) p.vy = 0;
    return true;
  }

  function groundAt(x, z, fromY) {
    /* fromY is passed through so the ground can answer with the surface you are
       actually near, not just the topmost one: over an intact lid the street,
       inside the room below it the room floor. With no carvings in the world
       this is byte-identical — solidground.js's fast path ignores it. */
    let best = CBZ.floorAt ? CBZ.floorAt(x, z, fromY) : 0;
    const plats = CBZ.platforms;
    if (plats.length) {
      const reach = (fromY != null ? fromY : best) + STEP_UP;
      const cand = platsAt(x, z);
      for (let i = 0; i < cand.length; i++) {
        const p = cand[i];
        if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
        // stairs are stored as a sloped ramp so you glide up smoothly instead
        // of hopping tread to tread; flat floors/roofs just use their top.
        let top = p.top;
        // B3: ramp gained an optional x-axis sibling (core/interfaces.js #4 —
        // additive to the DATA SHAPE only, not CBZ.collide's frozen signature).
        // r.axis === "x" interpolates along x0/x1 instead of z0/z1; every
        // existing ramp record (no axis field, city/buildings.js's stairs
        // included) takes the untouched z-branch below, byte-identical math.
        if (p.ramp) {
          const r = p.ramp;
          let t = (r.axis === "x") ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0);
          if (t < 0) t = 0; else if (t > 1) t = 1;
          top = r.y0 + t * (r.y1 - r.y0);
        }
        if (top <= reach && top > best) best = top;
      }
    }
    // MOVING DECKS (systems/platforms_moving.js): a walk surface on a parent
    // that moves cannot live in the world-space CBZ.platforms array — its AABB
    // would be stale the moment the parent turns. The rig keeps its decks in the
    // parent's LOCAL frame and transforms the query point in. Feature-detected +
    // flagged: absent or off, this is byte-identical to before.
    if (CBZ.mpGroundAt) { const t = CBZ.mpGroundAt(x, z, fromY, best); if (t > best) best = t; }
    return best;
  }
  CBZ.groundAt = groundAt;

  // Stance-aware collision height: prone squeezes under height-gated walls
  // (window sills, half-walls), slide/stance-crouch duck the head band. Escape
  // and flags-off recompute to exactly BODY_H every frame — nothing to restore,
  // the height IS a pure function of the current stance.
  function playerBodyH() {
    if (player.prone) return PRONE_BODY_H;
    if (player.crouch && CBZ.game.mode !== "escape") return CROUCH_BODY_H;
    return BODY_H;
  }
  function resolveCollisions() { collide(player.pos, player.radius, player.pos.y + 0.25, player.pos.y + playerBodyH()); }

  // ---- FEEL: local wall-clock player motion (slow-mo-under-load fix) --------
  // loop.js clamps the WORLD dt to ~0.05s so the 27ms sim can't spiral on the
  // weak Mac. But at 200ms/frame that clamp also throttles the LOCAL PLAYER to
  // ~25% wall-clock speed — the "wading through molasses" feel. Per the cross-
  // agent contract, loop.js exposes CBZ.feelDt = the REAL frame delta clamped to
  // FEEL_MAX (~0.1s), gated by CBZ.feelMotion. We read it ONLY for the player's
  // own integration so the avatar covers correct ground per frame; the heavy
  // world stays on the small clamped dt. MP-safe: every client runs this for its
  // OWN avatar identically; we sync POSITIONS not timesteps.
  //
  // ADVERSARIAL: a bigger feel-dt = a bigger position step. Max on-foot speed is
  // walkSpeed*sprintMul (~7*1.7=11.9 m/s); at fdt=0.1 that's a 1.19m step, but the
  // player radius (0.38) only resolves overlaps up to radius+half-wall (~0.58m) —
  // a single big step could TUNNEL a 0.4m-thick wall or overshoot a thin floor's
  // landing test. Fix (the canonical character-controller answer): SUB-STEP the
  // player's OWN movement+collision when the step is large. We split fdt into N
  // equal slices sized so no slice can move farther than a safe fraction of the
  // radius, capped at FEEL_SUBSTEP_MAX so a pathological frame can't multiply the
  // tiny player integrator into a spiral. Collision is resolved EVERY slice, so a
  // wall is caught mid-traverse exactly as it is at full FPS.
  // m — max horizontal move per collision slice. THE MARGIN IS THINNER THAN
  // THIS LINE USED TO CLAIM: it read "< player radius 0.55", but the shipped
  // radius is 0.38 (config.js TUNE.playerRadius), so the cushion is 0.35 vs
  // 0.38 — about 8%, not the ~36% the old number implied. Still sound (a step
  // shorter than the radius cannot clear the body's own footprint, so an
  // overlap always registers) but there is no room to raise this without
  // raising the radius with it.
  const FEEL_SAFE_STEP = 0.35;
  const FEEL_SUBSTEP_MAX = 5;       // hard cap on player slices/frame (player integ is ~µs; 5× is free vs the 27ms world sim).
                                    // Sized so even the raised loop FEEL_MAX (0.12s)
                                    // at max on-foot speed (11.9 m/s) slices to
                                    // ≤0.12*11.9/5 ≈ 0.29m per slice — still under
                                    // FEEL_SAFE_STEP, so the collider never tunnels.

  // Returns how many equal slices to split a feel-frame into so the player can't
  // out-run its own collision. Based on the worst-case horizontal step this frame
  // (desired move speed) AND the vertical fall step (fast tower falls), whichever
  // would travel farther, divided by the safe slice distance. Falls back to 1
  // (today's single integration) whenever feel-dt is absent or already small.
  function feelSubsteps(fdt, horizSpeed, vy) {
    const reach = Math.max(horizSpeed, Math.abs(vy)) * fdt;   // farthest this body could move this frame
    if (reach <= FEEL_SAFE_STEP) return 1;
    let n = Math.ceil(reach / FEEL_SAFE_STEP);
    if (n > FEEL_SUBSTEP_MAX) n = FEEL_SUBSTEP_MAX;
    return n;
  }

  // ---- STAIRS: seam-bridging ground support (anti-fall-through) -------------
  // OWNER ("stairs suck — you can fall through them down many floors"). The walk
  // surface on a building climb is CBZ.platforms ramp/landing records; groundAt()
  // returns the highest one whose XZ-AABB contains the EXACT query point. Even
  // with AGENT BUILD closing the geometry gaps, a fast player can land a substep
  // EXACTLY on a hairline seam between two ramp AABBs (or just outside one by a
  // sub-millimetre) — groundAt then reads only the terrain floor far below and the
  // grounded path mistakes that one-sample dropout for "walked off a roof rim",
  // handing you to gravity → you plummet through the whole stairwell.
  //
  // The canonical character-controller cure is a STEP-DOWN / anti-bump probe:
  // before believing a sudden large drop, re-sample support at the MIDPOINT of the
  // move you just swept and, if it still has valid in-reach support, snap there —
  // a geometry seam between two ramp AABBs is a hairline crack, so half a substep
  // back (≤ ~0.15m) is reliably still on solid ramp/landing, while the bad END
  // sample fell into the crack. We deliberately probe ONLY the midpoint, never the
  // pre-move start: a real ledge (roof rim / balcony) ALWAYS has solid support at
  // the start point you just left, so bridging from there would glue you to every
  // edge and you could never walk off — the midpoint (a fraction of a step back)
  // is narrow enough to bridge a seam yet far short of any real walkable ledge, so
  // stepping off a roof still drops you. Cost: this whole probe runs ONLY when the
  // direct sample shows a sudden below-step-down drop while grounded in CITY mode
  // with platforms present — flat ground / smooth ramps / every other mode pay
  // nothing and stay byte-identical. Returns the bridged support, else `direct`
  // (the real-ledge case → caller hands off to gravity exactly as before).
  function stairSupport(direct, px0, pz0, x1, z1, fromY) {
    // only the city building-stair climb has these ramp/landing platforms; this
    // never fires in escape/survival (no city platforms under the player there).
    if (CBZ.game.mode !== "city" || !CBZ.platforms || !CBZ.platforms.length) return direct;
    const sMid = groundAt((px0 + x1) * 0.5, (pz0 + z1) * 0.5, fromY);
    if (sMid > direct && sMid <= fromY + STEP_UP && sMid >= fromY - STEP_DOWN) return sMid;
    // tight snap-down probe at the END point too: if a floor sits within one
    // riser+margin below the feet (a nosing/seam), prefer it over the far drop.
    if (direct < fromY - SNAP_DOWN) {
      const sEnd = groundAt(x1, z1, fromY);
      if (sEnd > direct && sEnd >= fromY - SNAP_DOWN && sEnd <= fromY + STEP_UP) return sEnd;
    }
    return direct;
  }

  // ---- CITY fall damage -------------------------------------------------
  // Falling used to be free: you'd land and vy just zeroed. In CITY mode a hard
  // landing now HURTS, scaled to the speed you hit the ground at. A normal jump
  // (vy≈T.jumpVel on landing) and any short step-down are well under the safe
  // threshold and do nothing; ~2 storeys takes a real chunk; a rooftop or tower
  // fall is LETHAL — and a lethal fall reads as a gory splat (death.js dials the
  // gore up for reason "fell"). Gated to g.mode==="city" so escape/survival fall
  // behaviour stays byte-identical.
  //
  // We track the player's PEAK downward speed in the air (impact speed at the
  // floor underestimates it if a collision clipped vy on the way down) and arm
  // the landing once we're moving down fast enough to matter.
  const FALL_SAFE = 11.0;     // m/s — clears a full jump (lands ≈ jumpVel 8.2) + small drops
  const FALL_K = 0.95;        // quadratic scale on the excess speed → damage (a ~6-storey rooftop is lethal; a tower is gibbing-certain)
  function cityFallLand(impactSpeed) {
    // impactSpeed is a positive m/s. Use the worst of (this) and the tracked peak.
    let v = impactSpeed;
    if (player._fallPeak && player._fallPeak > v) v = player._fallPeak;
    player._fallPeak = 0;
    /* ---- THE LANDING IS ENGINE; THE DAMAGE IS THE CITY'S -------------------
       Everything below this block is gated to a mode (city charges for the
       fall, survival routes it to the trauma ledger, escape does neither).
       The BODY, though, lands the same way in all three — that is what makes
       it a body — so the pose is armed here, before the first gate, off the
       one number this function already holds. This is also the only place in
       the file that knows the impact speed of an ordinary fall.

       AND A ROLL IS WORTH SOMETHING. Converting a drop into a forward roll is
       not decoration: it is the technique's entire purpose, and a game that
       plays the animation and then charges full price for the landing has
       taught the player that parkour is cosmetic. The credit is deliberately
       a small FLAT subtraction off the impact rather than a fraction: at the
       height where landing starts to hurt it wipes out most of the sting,
       and at a tower fall 2.6 m/s is noise against 40 — so "a rooftop is
       lethal, a tower is gibbing-certain" survives intact and you cannot roll
       your way off a skyscraper. */
    const landed = armLanding(playerChar, v, player.speed, null);
    if (landed && landed.roll) {
      if (CBZ.sfx) CBZ.sfx("whoosh");
      v = Math.max(0, v - ROLL_CREDIT);
    }
    // SURVIVAL: no fall DAMAGE (the disasters fling you constantly — charging
    // for every landing would decide rounds by physics noise), but a long drop
    // is one of the three things the owner named as having to draw blood, and
    // the island's refuge mountain is a 26 m cone you can be shoved off. The
    // impact speed is already in hand, so hand it to the trauma ledger and let
    // systems/trauma.js decide whether that landing opened you up. It is the
    // same call grapple.js makes for a bot's landing, so player and bot bleed
    // off one rule. Everything below stays city-only, byte for byte.
    if (CBZ.islandModeOn(CBZ.game.mode)) {
      if (CBZ.trauma && CBZ.surv && !player.dead) CBZ.trauma.slam(CBZ.surv.playerActor, v, { dir: { x: 0, y: 1, z: 0 } });
      return;
    }
    if (CBZ.game.mode !== "city") return;        // escape: no fall damage
    if (player.dead || (CBZ.game.invuln || 0) > 0) return;
    if (v <= FALL_SAFE) return;                  // a hop / step-down / normal jump
    const excess = v - FALL_SAFE;
    // quadratic-ish in the excess speed: gentle near the threshold, brutal high up.
    // pre-DR (death.js halves it via CITY_DR), so a tower fall blows past max HP.
    let dmg = FALL_K * excess * excess + excess * 2.0;
    const hard = v > FALL_SAFE + 4;              // ~1.5 storeys+: a real crunch, not a stumble
    // juicy feedback: a speed-scaled shake + a bone-crunch on a hard landing
    if (CBZ.shake) CBZ.shake(Math.min(1.4, 0.25 + excess * 0.05));
    if (hard && CBZ.sfx) { CBZ.sfx("ko"); CBZ.sfx("hit"); }
    if (CBZ.doHitstop && excess > 8) CBZ.doHitstop(Math.min(0.14, 0.04 + excess * 0.006));
    if (CBZ.cityHurtPlayer) {
      // hand the impact speed to death.js so the splat FX scales to the fall.
      player._fellSpeed = v;
      // "fell" reason so death.js's WASTED path can render the gory splat.
      CBZ.cityHurtPlayer(dmg, player.pos.x, player.pos.z, "fell", false, null, false);
    }
  }

  // Cheap NPC fall damage: a ped that lands hard from height splats too. We only
  // reach here if the existing ped physics already handed us a clean impact speed
  // (peds.js calls this), so it's just the damage routing — no extra per-frame work.
  CBZ.cityPedFallImpact = function (ped, impactSpeed) {
    if (CBZ.game.mode !== "city" || !ped || ped.dead) return;
    if (impactSpeed <= FALL_SAFE + 3) return;    // peds shrug off small drops
    const excess = impactSpeed - FALL_SAFE;
    if (impactSpeed > 22 && CBZ.cityKillPed) { CBZ.cityKillPed(ped, { fromX: ped.pos.x, fromZ: ped.pos.z }, "fell"); return; }
    if (ped.hp != null) { ped.hp -= FALL_K * excess * excess; if (ped.hp <= 0 && CBZ.cityKillPed) CBZ.cityKillPed(ped, { fromX: ped.pos.x, fromZ: ped.pos.z }, "fell"); }
  };

  // ============================================================
  //  STANCE MACHINE — COD-style SLIDE + double-crouch PRONE
  //  (PLAYER_SLIDE / PLAYER_PRONE, config.js — both default ON)
  // ============================================================
  // City + survival grow a real console stance vocabulary; jail (escape)
  // keeps its hold-Ctrl/C sneak untouched. Crouch here is a PRESS-toggled
  // latch (not a hold): tap = crouch, tap again = stand, double-tap = PRONE,
  // tap while sprinting = SLIDE. Presses arrive two ways into one queue:
  // desktop keydown edges of Ctrl/C (detected below from CBZ.keys), and the
  // touch layer's L3 stick-press via CBZ.playerCrouchPress() — touch can't
  // hold a key across a double-tap (its latch would collapse two taps into
  // one edge), so the machine consumes press EVENTS, not key levels.
  //
  // The machine only ever runs on-foot in city/survival (driving, door arcs,
  // aircraft, swimming, knockdowns and death all reset it), and with both
  // flags off it is never stepped — desktop behaviour is byte-identical.
  const SLIDE_DUR = 0.8;         // s the slide carries
  const SLIDE_BOOST = 1.12;      // entry speed = carried sprint speed × this
  const SLIDE_END = 1.4;         // m/s remaining when it runs out (≈ crouch walk)
  const SLIDE_CD = 1.0;          // s after a slide before the next can start
  const SLIDE_STEER = 1.5;       // rad/s max heading change mid-slide (heavy damp)
  const SLIDE_GRACE = 0.45;      // s of "was just sprinting" that still slides —
                                 // the touch thumb must LIFT the stick to tap L3,
                                 // which drops sprint a beat before the press lands
  const PRONE_WINDOW = 0.4;      // s after entering crouch in which a 2nd press = prone
  const PRONE_SPEED = 0.35;      // × walkSpeed crawl (0.7 m/s)
  const CROUCH_BODY_H = 1.2;     // stance-crouch/slide collision height (standing BODY_H 1.7)
  const PRONE_BODY_H = 0.5;      // prone collision height — crawl under height-gated walls
  const PRONE_SINK = 0.62;       // rig group drop so the hip-hinged plank lies ON the ground
  const PRONE_LMG_STEADY = 0.45; // recoil × while prone with the LMG (the bipod-class bonus)
  const st = {
    mode: "stand",               // "stand" | "crouch" | "prone"
    slideT: -1,                  // ≥0 = sliding (seconds elapsed)
    slideV0: 0, dirX: 0, dirZ: -1,
    cd: 0,                       // slide cooldown remaining
    clock: 0,                    // machine's own accumulated time
    crouchT: -9,                 // when crouch was ENTERED (opens the prone window)
    pressT: -9,                  // last unconsumed crouch-press (0.3s shelf life)
    prevSneak: false,            // desktop keydown edge detector
    lastSprintT: -9, lastSprintV: 0,   // sprint memory for the slide grace
    lastMoveX: 0, lastMoveZ: 0,  // last normalized move dir (slide heading fallback)
    spaceLatch: false,           // swallows the jump that stood us up from prone
  };
  function stanceReset() {
    st.mode = "stand"; st.slideT = -1; st.pressT = -9; st.crouchT = -9; st.spaceLatch = false;
    player.prone = false;
    if (playerChar) { playerChar.slidePose = false; playerChar.pronePose = false; }
  }
  // Crouch INPUT edge from the touch layer (the L3 stick-press). Queued, not
  // acted on: the machine consumes it inside updatePlayer with full frame
  // context (sprint state, ground, mode) so touch and keyboard share one brain.
  CBZ.playerCrouchPress = function () { st.pressT = st.clock; };
  // PRONE LMG STEADY — feature-detected by fpsmode.js at its recoil kick site.
  // Scoped to the LMG class (weapon-data key "lmg"): prone braces the belt-fed
  // gun bipod-style; other weapons keep their normal kick (fpsmode's crouch
  // bipod already rewards the deliberate ADS-and-still setup, and it still
  // outranks this while engaged). Returns a multiplier on the whole kick.
  CBZ.playerProneSteady = function (w) {
    if (!player.prone) return 1;
    return (w && w.key === "lmg") ? PRONE_LMG_STEADY : 1;
  };
  // One stance step per frame. Returns true while a slide owns the run vector.
  function updateStance(dt, c) {
    st.clock += dt;
    if (st.cd > 0) st.cd = Math.max(0, st.cd - dt);
    if (player._swim || player._aircraft) { stanceReset(); return false; }
    if (c.overlay || c.stunned) {           // map/overview/stun: drop presses, kill a live slide
      st.pressT = -9;
      if (st.slideT >= 0) { st.slideT = -1; st.cd = SLIDE_CD; }
      return false;
    }
    // desktop crouch-key rising edge → the same press queue touch feeds
    if (c.sneakHeld && !st.prevSneak) st.pressT = st.clock;
    st.prevSneak = c.sneakHeld;

    // sprint input breaks a crouch back to standing (console grammar: ram the
    // stick / hold shift+direction and you pop up and go). Prone is deliberate
    // ground game — it needs an explicit crouch press or jump to leave.
    if (st.mode === "crouch" && st.slideT < 0 && keys["shift"] && c.len > 0 && c.staminaReady) st.mode = "stand";

    const press = st.pressT >= 0 && (st.clock - st.pressT) < 0.3;
    if (press) {
      st.pressT = -9;                        // consumed (airborne presses just drop)
      if (player.grounded && st.slideT < 0) {
        const slideOK = CBZ.CONFIG.PLAYER_SLIDE !== false && st.cd <= 0 && st.mode !== "prone" &&
          (player.sprint || (st.clock - st.lastSprintT) < SLIDE_GRACE);
        if (slideOK) {
          // SLIDE: carry the sprint you brought in, slightly hotter, along the
          // direction you're pushing (else the one you were moving on, else facing).
          const sMul = (CBZ.SURV && CBZ.SURV.sprintMul) || 1.7;
          st.slideT = 0;
          // floor = the wound-scaled sprint speed, for the same-frame desktop
          // press where the memory hasn't sampled yet — a limping player must
          // slide at a limping burst, not the healthy 6.4.
          st.slideV0 = Math.max(st.lastSprintV, T.walkSpeed * sMul * (c.wound || 1)) * SLIDE_BOOST;
          if (c.len > 0) { st.dirX = c.mx / c.len; st.dirZ = c.mz / c.len; }
          else if (st.lastMoveX || st.lastMoveZ) { st.dirX = st.lastMoveX; st.dirZ = st.lastMoveZ; }
          else { st.dirX = -Math.sin(CBZ.cam.yaw); st.dirZ = -Math.cos(CBZ.cam.yaw); }
          st.mode = "stand";                 // exit stance resolves at slide end
          if (CBZ.sfx) CBZ.sfx("whoosh");
        } else if (st.mode === "prone") { st.mode = "crouch"; st.crouchT = -9; }  // window closed: next press stands
        else if (st.mode === "crouch") {
          if (CBZ.CONFIG.PLAYER_PRONE !== false && (st.clock - st.crouchT) < PRONE_WINDOW) st.mode = "prone";
          else st.mode = "stand";
        } else if (CBZ.CONFIG.PLAYER_PRONE !== false || CBZ.CONFIG.PLAYER_SLIDE !== false) {
          st.mode = "crouch"; st.crouchT = st.clock;   // crouch is the shared substrate stance
        }
      }
    }

    if (st.slideT >= 0) {
      st.slideT += dt;
      if (st.slideT >= SLIDE_DUR || !player.grounded || player._swim) {
        st.cd = SLIDE_CD; st.slideT = -1;
        // hold sprint+direction through the end → pop straight back up running;
        // otherwise settle into crouch (whose fresh window lets slide→tap = prone).
        if (player.grounded && keys["shift"] && c.len > 0 && c.staminaReady) st.mode = "stand";
        else if (player.grounded) { st.mode = "crouch"; st.crouchT = st.clock; }
        else st.mode = "stand";              // slid off a ledge — fall standing
      } else if (c.len > 0) {
        // steering is heavily damped: ease the locked heading toward the stick,
        // capped at SLIDE_STEER rad/s — a drift, never a pivot.
        const cur = Math.atan2(st.dirX, st.dirZ);
        const want = Math.atan2(c.mx / c.len, c.mz / c.len);
        let d = want - cur;
        if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
        const m = SLIDE_STEER * dt;
        if (d > m) d = m; else if (d < -m) d = -m;
        const a = cur + d;
        st.dirX = Math.sin(a); st.dirZ = Math.cos(a);
      }
    }
    return st.slideT >= 0;
  }

  function updatePlayer(dt) {
    // ---- driving: a city vehicle owns the player's transform this frame.
    //      The city vehicle controller (city/vehicles.js) moves player.pos and
    //      the (hidden) character rig, so we bail out of on-foot physics. ----
    if (player.driving) {
      if (player._traversal || player._traverseSurface) cancelTraversal(player, playerChar, false);
      if (st.mode !== "stand" || st.slideT >= 0 || player.prone) stanceReset();
      return;
    }

    // A live aircraft boarding-door arc (city/aircraft_doors.js) guides the
    // player through the opening exactly like a vehicle controller — on-foot
    // input must not fight the guided walk for the ~1-2s beat. A live slide is
    // surrendered to the guided walk (a held crouch/prone stance survives it).
    if (player._doorArc) {
      if (player._traversal || player._traverseSurface) cancelTraversal(player, playerChar, false);
      if (st.slideT >= 0) { st.slideT = -1; st.cd = SLIDE_CD; }
      return;
    }

    // A strapped-in snowboard owns the player transform just like a vehicle.
    // The controller is installed by city/snowboard.js after this module.
    if (CBZ.citySnowboardStep && CBZ.citySnowboardStep(dt)) return;

    // An aquatic animal is another physical vehicle, except its hull is a live
    // creature and its road is the water column. wildlife_tame.js integrates
    // the shared player/animal root through waterField; on-foot gravity and the
    // ocean's phantom y=0 floor must not move that root a second time.
    if (CBZ.cityAquaticMountStep && CBZ.cityAquaticMountStep(dt)) {
      if (st.mode !== "stand" || st.slideT >= 0 || player.prone) stanceReset();
      return;
    }

    // ---- physical reactions: thrown / knocked down by a disaster, throw,
    //      push or blast. Reads the shared body state (grapple.js / body). ----
    const ph = player._phys;
    if (ph && !player.dead) {
      if (ph.fl > 0) ph.fl = Math.max(0, ph.fl - dt);
      if (ph.air) {
        if (player._traversal || player._traverseSurface) cancelTraversal(player, playerChar, false);
        ph.vy -= T.gravity * dt;
        player.pos.x += ph.vx * dt; player.pos.z += ph.vz * dt; player.pos.y += ph.vy * dt;
        const fl = groundAt(player.pos.x, player.pos.z, player.pos.y);
        if (player.pos.y <= fl && ph.vy <= 0) { player.pos.y = fl; ph.air = false; ph.vx = ph.vz = 0; ph.vy = 0; ph.down = Math.max(ph.down, 1.3); if (CBZ.shake) CBZ.shake(0.5); }
        resolveCollisions();
        playerChar.group.position.copy(player.pos);
        playerChar.group.rotation.x += ph.spin * dt;
        player.speed = 0; player.crouch = false; stanceReset();
        animChar(playerChar, 0, dt);
        return;
      }
      if (ph.down > 0) {
        if (player._traversal || player._traverseSurface) cancelTraversal(player, playerChar, false);
        ph.down -= dt;
        player.speed = 0; player.crouch = false; stanceReset();
        player.vy -= T.gravity * dt; player.pos.y += player.vy * dt; clampCeiling(player);
        const fl = groundAt(player.pos.x, player.pos.z, player.pos.y);
        if (player.pos.y <= fl) { player.pos.y = fl; player.vy = 0; }
        if (Math.abs(ph.kx) > 0.02 || Math.abs(ph.kz) > 0.02) { player.pos.x += ph.kx * dt; player.pos.z += ph.kz * dt; const d = Math.pow(0.0009, dt); ph.kx *= d; ph.kz *= d; }
        resolveCollisions();
        playerChar.group.position.copy(player.pos);
        playerChar.group.rotation.x = CBZ.damp(playerChar.group.rotation.x, -Math.PI / 2, 10, dt); // on your back
        animChar(playerChar, 0, dt);
        return;
      }
    }

    // ---- SURVIVAL death: a dramatic spinning ragdoll launch, then sprawl ----
    const D = player._death;
    if (D && CBZ.game.mode !== "escape") {
      if (player._traversal || player._traverseSurface) cancelTraversal(player, playerChar, false);
      player.speed = 0; player.crouch = false; stanceReset();
      const floorY = groundAt(player.pos.x, player.pos.z, player.pos.y);
      if (!D.landed) {
        D.vy -= T.gravity * dt;
        player.pos.x += D.vx * dt; player.pos.z += D.vz * dt; player.pos.y += D.vy * dt;
        const dec = Math.pow(0.05, dt); D.vx *= dec; D.vz *= dec;
        resolveCollisions();
        const fy = groundAt(player.pos.x, player.pos.z, player.pos.y);
        if (player.pos.y <= fy && D.vy <= 0) { player.pos.y = fy; D.landed = true; if (CBZ.shake) CBZ.shake(0.45); }
        playerChar.group.position.copy(player.pos);
        playerChar.group.rotation.x += D.spin * dt;
        playerChar.group.rotation.z += D.spin2 * dt;
      } else {
        player.pos.y = floorY + 0.3;   // a body lying FLAT must rest ON the ground, not be centered IN it (was sinking through)
        playerChar.group.position.copy(player.pos);
        playerChar.group.rotation.x = CBZ.damp(playerChar.group.rotation.x, -Math.PI / 2, 7, dt);
        playerChar.group.rotation.z = CBZ.damp(playerChar.group.rotation.z, 0.22 * Math.sin(D.seed * 1.7), 9, dt);
      }
      playerChar.group.scale.y += (1 - playerChar.group.scale.y) * (1 - Math.pow(0.001, dt));
      if (CBZ.deathPose) CBZ.deathPose(playerChar, D.seed);
      return;
    }

    if (player.dead || player.ko > 0) {
      if (player._traversal || player._traverseSurface) cancelTraversal(player, playerChar, false);
      // This branch owns the rig and returns, so the air/landing flags would
      // otherwise stay set at whatever value the frame before the knockdown
      // left them and fight the KO pose for the whole ragdoll.
      playerChar.airPose = null; playerChar.landPose = null; player._airT = 0;
      if (!player.dead) player.ko = Math.max(0, (player.ko || 0) - dt);
      player.speed = 0;
      player.crouch = false; stanceReset();
      player.vy -= T.gravity * dt;
      player.pos.y += player.vy * dt; clampCeiling(player, 0.6);
      const floorD = groundAt(player.pos.x, player.pos.z, player.pos.y) + 0.3;   // lying body rests ON the floor, not through it
      if (player.pos.y <= floorD) { player.pos.y = floorD; player.vy = 0; player.grounded = true; }
      playerChar.group.position.set(player.pos.x, player.pos.y, player.pos.z);
      playerChar.group.rotation.z = CBZ.damp(playerChar.group.rotation.z, Math.PI / 2, 11, dt);
      playerChar.group.scale.y += (1 - playerChar.group.scale.y) * (1 - Math.pow(0.001, dt));
      animChar(playerChar, 0, dt);
      return;
    }

    // A vault/mantle is a short authored trajectory, not another velocity added
    // to ordinary walking. While active it is the sole player-transform writer;
    // camera/animation still consume the same wall-clock feel dt as normal play.
    if (player._traversal) {
      const tdt = (CBZ.feelDt != null ? CBZ.feelDt : dt);
      player.crouch = false; player.prone = false;
      if (stepTraversal(player, playerChar, tdt, true)) return;
    }

    const cam = CBZ.cam;
    const sinY = Math.sin(cam.yaw), cosY = Math.cos(cam.yaw);
    const fx = -sinY, fz = -cosY;   // forward (W)
    const rx = cosY, rz = -sinY;    // right (D)
    let mx = 0, mz = 0;
    if (keys["w"]) { mx += fx; mz += fz; }
    if (keys["s"]) { mx -= fx; mz -= fz; }
    if (keys["d"]) { mx += rx; mz += rz; }
    if (keys["a"]) { mx -= rx; mz -= rz; }
    const overview = !!(CBZ.simView && CBZ.simView.active);
    const mapOpen = !!(CBZ.fullMap && CBZ.fullMap.active);
    const cine = !!(CBZ.cineActive && CBZ.cineActive());  // scripted scene owns the body
    if (overview || mapOpen || cine) { mx = 0; mz = 0; } // WASD belongs to the active overlay instead

    // stunned (baton / taser): no input this frame, gravity still applies
    if (player.stun > 0) { player.stun -= dt; mx = mz = 0; }
    if (player._cityArrested) mx = mz = 0;
    const stunned = player.stun > 0 || !!player._cityArrested;
    // the melee hit reaction (systems/combat.js playerHitReact): a beat of
    // slow, not a lock — you keep the controls while a fist rocks you
    if (player.hitLock > 0) player.hitLock -= dt;
    if (player.poiseT > 0) player.poiseT -= dt;
    let hitSlow = 1;
    if (player.hitT > 0) { player.hitT -= dt; hitSlow = 0.45; }

    const len = Math.hypot(mx, mz);
    // One movement language in every mode: Shift runs. Jail used to steal
    // Shift for crouch, so the 2m/s human-scale walk was the fastest possible
    // movement there while city/survival could reach 6.4m/s. Keep jail stealth
    // on Ctrl (or C) instead, which also matches standard PC controls.
    const escape = CBZ.game.mode === "escape";
    const sneakHeld = !!(keys["control"] || keys["c"]);
    player.crouch = !overview && !mapOpen && escape && !stunned && sneakHeld;
    // Jail has no stamina drain/regeneration loop, so a zero carried over from
    // city/survival (or written by the hunger system) must never turn Shift
    // back into a 2m/s walk. Stamina remains authoritative in modes that own it.
    const staminaReady = escape || player.stamina === undefined || player.stamina > 0;
    // ---- stance machine (PLAYER_SLIDE / PLAYER_PRONE, city+survival only):
    // crouch becomes a press-toggled stance, a press mid-sprint slides, a
    // double press prones. It OWNS player.crouch/prone in these modes; escape
    // above keeps its hold-to-sneak, and with both flags off nothing here runs.
    const mountedAnimal = player._mountedAnimal || null;
    const stanceOn = !escape && !mountedAnimal &&
      (CBZ.CONFIG.PLAYER_SLIDE !== false || CBZ.CONFIG.PLAYER_PRONE !== false);
    let sliding = false;
    if (stanceOn) {
      sliding = updateStance(dt, {
        len, mx, mz, sneakHeld, stunned, staminaReady,
        overlay: overview || mapOpen || cine,   // scripted scenes freeze stance input too
        wound: (player._moveScale != null ? player._moveScale : 1) * (player._rideScale || 1),
      });
      player.crouch = sliding || st.mode !== "stand";
      player.prone = st.mode === "prone" && !sliding;
    } else if (st.mode !== "stand" || st.slideT >= 0 || player.prone) stanceReset();
    player.sprint = !overview && !mapOpen && !stunned && !player.crouch && hitSlow === 1 &&
      !!keys["shift"] && len > 0 && staminaReady;
    const sprintMul = (CBZ.SURV && CBZ.SURV.sprintMul) || 1.7;
    // a leg wound (city/death.js injury model) publishes player._moveScale (&lt;1)
    // so a shot-up player can't run away — the limp you SEE is also the limp you FEEL.
    // _rideScale (>1) = mounted on an animal (city/wildlife_tame.js publishes
    // the mount's gait). It COMPOSES with the limp — a wounded rider still rides.
    const woundScale = (player._moveScale != null ? player._moveScale : 1) * (player._rideScale || 1);
    const moveSpeed = (player.prone ? T.walkSpeed * PRONE_SPEED
      : player.crouch ? T.crouchSpeed
      : (player.sprint ? T.walkSpeed * sprintMul : T.walkSpeed)) * woundScale * hitSlow;
    let desX = 0, desZ = 0;
    if (len > 0) { mx /= len; mz /= len; }
    if (sliding) {
      // slide velocity: hold the burst early, bleed late — quadratic ease from
      // the boosted entry speed down to a crouch-walk remainder over SLIDE_DUR.
      // (slideV0 already carries the wound/limp scale via the captured speed.)
      const u = Math.min(1, st.slideT / SLIDE_DUR);
      const v = SLIDE_END + (st.slideV0 - SLIDE_END) * (1 - u * u);
      desX = st.dirX * v; desZ = st.dirZ * v;
    } else if (len > 0) { desX = mx * moveSpeed; desZ = mz * moveSpeed; }
    player.speed = Math.hypot(desX, desZ);
    // ...and the DIRECTION that speed is aimed in. `player.speed` has always
    // been the DESIRED speed — what the body is trying to do, before a wall
    // has an opinion — and that is exactly the right quantity for anything
    // asking "is this body pressing into something": the realized frame delta
    // of a blocked body is zero, so it can never answer. Published in the same
    // shape and the same breath (systems/pushprops.js is the first reader:
    // furniture moves by the component of your drive that points at it).
    player.moveX = desX; player.moveZ = desZ;
    if (stanceOn) {
      // sprint memory: the slide's entry speed + the grace window that lets the
      // touch thumb lift off the stick to tap L3 without losing the sprint.
      if (len > 0) { st.lastMoveX = mx; st.lastMoveZ = mz; }
      if (player.sprint && player.speed > T.walkSpeed * 1.5) { st.lastSprintT = st.clock; st.lastSprintV = player.speed; }
    }

    // jump is an EDGE event (impulse), not integrated — fire it once per frame
    // before the substep loop so a held key can't double-jump across slices.
    // Stance: jump from PRONE only stands you up (no hop off your belly; the
    // held key is latched so standing doesn't chain into a jump); jump from a
    // crouch or mid-slide clears the stance and jumps normally.
    if (!overview && !mapOpen && !stunned && keys[" "] && player.grounded) {
      if (stanceOn && player.prone) {
        if (!st.spaceLatch) { st.spaceLatch = true; st.mode = "stand"; player.prone = false; player.crouch = false; }
      } else if (!stanceOn || !st.spaceLatch) {
        const jumpWasSliding = sliding;
        const jumpDirX = sliding ? st.dirX : mx;
        const jumpDirZ = sliding ? st.dirZ : mz;
        if (stanceOn) {
          if (st.slideT >= 0) { st.slideT = -1; st.cd = SLIDE_CD; sliding = false; }
          st.mode = "stand"; player.crouch = false;
        }
        // Running into registered solid geometry turns the SAME jump press into
        // traversal. A clear run line keeps the original ballistic jump exactly.
        // The capability replaces the mode enum here too, so the mess-hall
        // table, the disaster island's abandoned cars and the Gun Game map's
        // cover are all vaultable with the SAME press that already worked in
        // the city (systems/modecaps.js).
        const traverse = !mountedAnimal && (jumpWasSliding || len > 0.15) &&
          (CBZ.modeHas ? CBZ.modeHas("traverse") : CBZ.game.mode === "city")
          ? startTraversal(player, playerChar, jumpDirX, jumpDirZ, {
              speed: Math.max(player.speed, moveSpeed),
              radius: player.radius,
              height: (playerChar.metric && playerChar.metric.height) || BODY_H,
              allowTop: true,
              cars: true,
              // Shift never gates traversal itself. It only authorizes the
              // acrobatic style; ordinary forward+Jump still clears the prop.
              sprinting: !!(player.sprint || jumpWasSliding),
            })
          : null;
        if (traverse) {
          st.spaceLatch = true;
          player.crouch = false; player.prone = false;
          stepTraversal(player, playerChar, (CBZ.feelDt != null ? CBZ.feelDt : dt), true);
          return;
        }
        // A mounted jump is still integrated by the canonical collision/
        // gravity path, but its impulse belongs to the animal. tame.js
        // publishes a species-scaled value and carries animal+rider on this
        // same physical root; the avatar never performs a human vault.
        player.vy = mountedAnimal && player._rideJump > 0 ? player._rideJump : T.jumpVel;
        player.grounded = false; CBZ.sfx("jump");
      }
    }
    if (stanceOn && !keys[" "]) st.spaceLatch = false;

    // FEEL: integrate the LOCAL player on the real wall-clock delta so it moves
    // at correct speed under load (kills the slow-mo wade). fdt falls back to dt
    // exactly when loop.js hasn't provided feelDt OR the flag is off — identical
    // to today in that case. We split fdt into collision-safe slices (see above)
    // so a bigger step can never tunnel a wall or overshoot a landing.
    const fdt = (CBZ.feelDt != null ? CBZ.feelDt : dt);
    const nSub = (fdt !== dt) ? feelSubsteps(fdt, player.speed, player.vy) : 1;
    const subDt = fdt / nSub;
    for (let s = 0; s < nSub; s++) {
      const px0 = player.pos.x, pz0 = player.pos.z;   // pre-move XZ for the stair seam probe
      player.pos.x += desX * subDt;
      player.pos.z += desZ * subDt;

      // gravity + ground following (terrain, stairs, floors, roofs)
      let support = traversalSurfaceY(
        player, player.pos.x, player.pos.z,
        groundAt(player.pos.x, player.pos.z, player.pos.y));
      // ANTI-FALL-THROUGH (belt-and-braces): with the CONTINUOUS ramp collider
      // (buildings.js) groundAt can no longer hit a seam, so the seam-bridge is
      // now redundant — but we keep a GUARDED version so nothing regresses if a
      // future building rig reintroduces a gap. It only fires on the city
      // building-climb when support drops past step-down reach while grounded.
      if (player.grounded && support < player.pos.y - STEP_DOWN) {
        support = stairSupport(support, px0, pz0, player.pos.x, player.pos.z, player.pos.y);
      }
      if (player.grounded) {
        // GROUND-SNAP: glue the feet to the surface under us when it's within
        // climb (STEP_UP) above OR snap-down (SNAP_DOWN ≈ one riser + margin)
        // below — this kills the "briefly airborne off each nosing → fall" bug
        // and the descend-bounce: walking DOWN a ramp/stair you stay glued. A
        // larger but still in-reach step-down (SNAP_DOWN..STEP_DOWN) also sticks
        // so short curbs don't launch you. A real ledge (drop > STEP_DOWN) falls.
        if (support <= player.pos.y + STEP_UP && support >= player.pos.y - STEP_DOWN) {
          // close enough to the surface under us — stick to it. This follows
          // slopes DOWN, climbs a stair tread UP, and steps down a short ledge,
          // all without a hover or a bounce. (SNAP_DOWN is the tight band that
          // makes the continuous ramp un-fall-through-able; STEP_DOWN extends it
          // for forgiving curb/landing step-downs.)
          player.pos.y = support; player.vy = 0; player._fallPeak = 0;
        } else {
          // walked off an edge taller than a stair (a roof rim, a balcony) —
          // hand off to gravity so you actually fall instead of snapping down.
          player.grounded = false;
          player.vy -= T.gravity * subDt;
          player.pos.y += player.vy * subDt; clampCeiling(player);
          if (player.vy < 0 && -player.vy > (player._fallPeak || 0)) player._fallPeak = -player.vy;
          if (player.pos.y <= support) { player.pos.y = support; const ims = -player.vy; player.vy = 0; player.grounded = true; cityFallLand(ims); }
        }
      } else {
        player.vy -= T.gravity * subDt;
        player.pos.y += player.vy * subDt; clampCeiling(player);
        if (player.vy < 0 && -player.vy > (player._fallPeak || 0)) player._fallPeak = -player.vy;   // track peak downward speed this fall
        if (player.pos.y <= support && player.vy <= 0) { player.pos.y = support; const ims = -player.vy; player.vy = 0; player.grounded = true; cityFallLand(ims); } // landed
      }

      resolveCollisions();
    }

    /* ---- CATCHING YOURSELF --------------------------------------------------
       OWNER: "real parkour jumping, CATCHING SELF, landing, CATCHING EDGE".

       One frame per airborne frame, after the fall has already been integrated
       — so the body has genuinely missed before anything tries to save it, and
       a jump that clears the gap outright never enters this path at all.

       Three gates keep it honest rather than sticky:
       • it must be FALLING (catchLedge itself refuses a rising body), so the
         lip you are jumping UP past is not grabbed on the way through;
       • you must be HOLDING a direction into the wall, which is what makes it
         an intent to catch and not a magnet;
       • a short cooldown after any traversal or deliberate drop, so releasing
         a ledge does not immediately re-grab the same ledge.
       The move it produces is the ordinary landOnTop mantle, so the surface
       you arrive on is one the collider resolver already understands. */
    if (!player.grounded && !player._traversal && !player.prone && !mountedAnimal &&
        !player._swim && !overview && !mapOpen && !cine &&
        (player._noGrabT || 0) <= 0 && len > 0.15) {
      catchLedge(player, playerChar, mx, mz, {
        speed: Math.max(player.speed, moveSpeed),
        radius: player.radius,
        height: (playerChar.metric && playerChar.metric.height) || BODY_H,
      });
      if (player._traversal) {
        // The catch owns the transform from here; step it this same frame so
        // the hands are already on the lip in the frame the player sees.
        stepTraversal(player, playerChar, fdt, true);
        return;
      }
    }
    if (player._noGrabT > 0) player._noGrabT -= fdt;

    /* ---- WHAT YOU LOOK LIKE IN THE AIR -------------------------------------
       OWNER: "…what I look like in air, etc etc."

       And the answer, for the whole life of the game, was "exactly like
       walking". animChar had no airborne branch at all: leave the ground and
       the leg cycle keeps striding on nothing, arms swinging, until you land.
       Every other full-body state in entities/character.js is driven by a
       flag on the rig (slidePose, pronePose, traversePose), so this is the
       fourth of the same kind and reads through the same door.

       Physics publishes the FACTS — how fast up or down, how long since the
       feet left, whether this was a jump or a step off an edge — and the
       animator decides what a body does with them. `rise`/`fall` are
       normalized against the jump this game actually has (jumpVel 8.2) so the
       pose does not depend on the tune staying put. */
    if (player.grounded || player._traversal || !parkourV2()) {
      if (playerChar.airPose) playerChar.airPose = null;
      player._airT = 0;
    } else {
      player._airT = (player._airT || 0) + fdt;
      const jv = T.jumpVel || 8.2;
      const ap = playerChar.airPose || (playerChar.airPose = { t: 0, rise: 0, fall: 0, vy: 0 });
      ap.t = player._airT;
      ap.vy = player.vy;
      ap.rise = Math.max(0, Math.min(1, player.vy / jv));
      ap.fall = Math.max(0, Math.min(1, -player.vy / (jv * 1.35)));
      ap.moving = player.speed > 1.2;
    }

    // sync model. The PRESENTATION that should track the (now wall-clock) motion
    // runs on fdt so the body doesn't turn / animate in slow-mo while it slides
    // fast — body-yaw turn and the leg-cycle phase advance with the real move.
    // These are exponential damps / a phase clock, so a larger fdt just reaches
    // the target a touch sooner; with the flag off fdt===dt = today exactly.
    // prone sinks the whole rig group so the hip-hinged plank (character.js
    // pronePose) lies ON the ground instead of planking at hip height; the
    // blend `_proneB` is the pose's own ease, so sink and pose move together.
    // Zero for every non-prone frame (and every NPC) — position is written
    // absolutely each frame, so there is nothing to restore.
    const proneB = playerChar._proneB || 0;
    // SOLVED, NOT TYPED: PRONE_SINK was a single number tuned against the adult
    // male's hip line, and the plank's lowest surface is half a torso DEPTH
    // below that — measured 0.115 m of chest under the floor (owner: "the
    // player [goes] a tiny bit [under ground], bad physics"). character.js owns
    // the pose angles AND the body's box sizes, so it answers with the drop
    // that puts the lowest surface exactly ON the floor, per body. The literal
    // stays as the degrade path for a rig that cannot be measured.
    const sink = (CBZ.charProneSink && CBZ.charProneSink(playerChar)) || PRONE_SINK;
    playerChar.group.position.set(player.pos.x, player.pos.y - sink * proneB, player.pos.z);
    if (len > 0 || sliding) {
      // mid-slide the body faces the LOCKED slide heading, not the stick — the
      // feet-first pose must travel feet-first even while you pre-steer the exit.
      const tYaw = sliding ? Math.atan2(st.dirX, st.dirZ) : Math.atan2(mx, mz);
      // CAM_FACING_BLEND: after a draw/holster the body-yaw owner changes; the
      // turn RATE ramps in over ~0.25s (camera.js camFacingEase) so the body
      // sweeps to its new target instead of whipping.
      const faceEase = CBZ.camFacingEase ? CBZ.camFacingEase() : 1;
      playerChar.group.rotation.y = lerpAngle(playerChar.group.rotation.y, tYaw, 1 - Math.pow(0.0006, fdt * faceEase));
    }
    // crouch: a real pose (knees/hips fold — entities/character.js) instead of
    // the old scale.y accordion squash; ease any legacy squash back out.
    // slide/prone hand the rig to their own animChar branches (lean-back
    // feet-first power slide / flat weapon-forward crawl) the same way.
    playerChar.crouch = !!player.crouch;
    playerChar.slidePose = sliding;
    playerChar.pronePose = !!player.prone;
    playerChar.group.scale.y += (1 - playerChar.group.scale.y) * (1 - Math.pow(0.001, fdt));
    // get back up after a knockdown (ease the fall-over rotation out)
    if (playerChar.group.rotation.x) playerChar.group.rotation.x = CBZ.damp(playerChar.group.rotation.x, 0, 9, fdt);
    animChar(playerChar, player.speed, fdt);
  }

  CBZ.updatePlayer = updatePlayer;
  CBZ.onUpdate(10, updatePlayer);
})();
