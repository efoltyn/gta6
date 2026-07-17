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
  const colQuerySeen = new Set();
  CBZ.queryCollidersNear = function (x, z, radius, out) {
    if (colDirty || colCount !== CBZ.colliders.length) rebuildColliderGrid();
    out = out || [];
    out.length = 0;
    colQuerySeen.clear();
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
        if (colQuerySeen.has(c)) continue;
        colQuerySeen.add(c);
        out.push(c);
      }
    }
    return out;
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
  //     radius — the body's collision radius (player 0.55, ped/crowd 0.5).
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
  }
  CBZ.collide = collide;

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
    if (CBZ.game.mode !== "city") return feetY;        // jail/survival untouched
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

  // Highest walkable surface under (x,z): the terrain height field, raised by
  // any building floor/stair/roof platform whose top is within reach. `fromY`
  // is the feet height we're testing from — a platform only counts as support
  // if it's no more than STEP_UP above us (so you can't walk up a sheer wall,
  // only stairs). In the prison there are no platforms, so this is just terrain.
  function groundAt(x, z, fromY) {
    let best = CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
    const plats = CBZ.platforms;
    if (plats.length && CBZ.game.mode !== "escape") {
      const reach = (fromY != null ? fromY : best) + STEP_UP;
      for (let i = 0; i < plats.length; i++) {
        const p = plats[i];
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
    return best;
  }
  CBZ.groundAt = groundAt;

  function resolveCollisions() { collide(player.pos, player.radius, player.pos.y + 0.25, player.pos.y + BODY_H); }

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
  // player radius (0.55) only resolves overlaps up to radius+half-wall (~0.75m) —
  // a single big step could TUNNEL a 0.4m-thick wall or overshoot a thin floor's
  // landing test. Fix (the canonical character-controller answer): SUB-STEP the
  // player's OWN movement+collision when the step is large. We split fdt into N
  // equal slices sized so no slice can move farther than a safe fraction of the
  // radius, capped at FEEL_SUBSTEP_MAX so a pathological frame can't multiply the
  // tiny player integrator into a spiral. Collision is resolved EVERY slice, so a
  // wall is caught mid-traverse exactly as it is at full FPS.
  const FEEL_SAFE_STEP = 0.35;      // m — max horizontal move per collision slice (< player radius 0.55, so overlap always registers)
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
    if (CBZ.game.mode !== "city") return;        // escape/survival: no fall damage
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

  function updatePlayer(dt) {
    // ---- driving: a city vehicle owns the player's transform this frame.
    //      The city vehicle controller (city/vehicles.js) moves player.pos and
    //      the (hidden) character rig, so we bail out of on-foot physics. ----
    if (player.driving) return;

    // A strapped-in snowboard owns the player transform just like a vehicle.
    // The controller is installed by city/snowboard.js after this module.
    if (CBZ.citySnowboardStep && CBZ.citySnowboardStep(dt)) return;

    // ---- physical reactions: thrown / knocked down by a disaster, throw,
    //      push or blast. Reads the shared body state (grapple.js / body). ----
    const ph = player._phys;
    if (ph && !player.dead) {
      if (ph.fl > 0) ph.fl = Math.max(0, ph.fl - dt);
      if (ph.air) {
        ph.vy -= T.gravity * dt;
        player.pos.x += ph.vx * dt; player.pos.z += ph.vz * dt; player.pos.y += ph.vy * dt;
        const fl = groundAt(player.pos.x, player.pos.z, player.pos.y);
        if (player.pos.y <= fl && ph.vy <= 0) { player.pos.y = fl; ph.air = false; ph.vx = ph.vz = 0; ph.vy = 0; ph.down = Math.max(ph.down, 1.3); if (CBZ.shake) CBZ.shake(0.5); }
        resolveCollisions();
        playerChar.group.position.copy(player.pos);
        playerChar.group.rotation.x += ph.spin * dt;
        player.speed = 0; player.crouch = false;
        animChar(playerChar, 0, dt);
        return;
      }
      if (ph.down > 0) {
        ph.down -= dt;
        player.speed = 0; player.crouch = false;
        player.vy -= T.gravity * dt; player.pos.y += player.vy * dt;
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
      player.speed = 0; player.crouch = false;
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
      if (!player.dead) player.ko = Math.max(0, (player.ko || 0) - dt);
      player.speed = 0;
      player.crouch = false;
      player.vy -= T.gravity * dt;
      player.pos.y += player.vy * dt;
      const floorD = groundAt(player.pos.x, player.pos.z, player.pos.y) + 0.3;   // lying body rests ON the floor, not through it
      if (player.pos.y <= floorD) { player.pos.y = floorD; player.vy = 0; player.grounded = true; }
      playerChar.group.position.set(player.pos.x, player.pos.y, player.pos.z);
      playerChar.group.rotation.z = CBZ.damp(playerChar.group.rotation.z, Math.PI / 2, 11, dt);
      playerChar.group.scale.y += (1 - playerChar.group.scale.y) * (1 - Math.pow(0.001, dt));
      animChar(playerChar, 0, dt);
      return;
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
    player.sprint = !overview && !mapOpen && !stunned && !player.crouch &&
      !!keys["shift"] && len > 0 && staminaReady;
    const sprintMul = (CBZ.SURV && CBZ.SURV.sprintMul) || 1.7;
    // a leg wound (city/death.js injury model) publishes player._moveScale (&lt;1)
    // so a shot-up player can't run away — the limp you SEE is also the limp you FEEL.
    // _rideScale (>1) = mounted on an animal (city/wildlife_tame.js publishes
    // the mount's gait). It COMPOSES with the limp — a wounded rider still rides.
    const woundScale = (player._moveScale != null ? player._moveScale : 1) * (player._rideScale || 1);
    const moveSpeed = (player.crouch ? T.crouchSpeed : (player.sprint ? T.walkSpeed * sprintMul : T.walkSpeed)) * woundScale;
    let desX = 0, desZ = 0;
    if (len > 0) { mx /= len; mz /= len; desX = mx * moveSpeed; desZ = mz * moveSpeed; }
    player.speed = Math.hypot(desX, desZ);

    // jump is an EDGE event (impulse), not integrated — fire it once per frame
    // before the substep loop so a held key can't double-jump across slices.
    if (!overview && !mapOpen && !stunned && keys[" "] && player.grounded) { player.vy = T.jumpVel; player.grounded = false; CBZ.sfx("jump"); }

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
      let support = groundAt(player.pos.x, player.pos.z, player.pos.y);
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
          player.pos.y += player.vy * subDt;
          if (player.vy < 0 && -player.vy > (player._fallPeak || 0)) player._fallPeak = -player.vy;
          if (player.pos.y <= support) { player.pos.y = support; const ims = -player.vy; player.vy = 0; player.grounded = true; cityFallLand(ims); }
        }
      } else {
        player.vy -= T.gravity * subDt;
        player.pos.y += player.vy * subDt;
        if (player.vy < 0 && -player.vy > (player._fallPeak || 0)) player._fallPeak = -player.vy;   // track peak downward speed this fall
        if (player.pos.y <= support && player.vy <= 0) { player.pos.y = support; const ims = -player.vy; player.vy = 0; player.grounded = true; cityFallLand(ims); } // landed
      }

      resolveCollisions();
    }

    // sync model. The PRESENTATION that should track the (now wall-clock) motion
    // runs on fdt so the body doesn't turn / animate in slow-mo while it slides
    // fast — body-yaw turn and the leg-cycle phase advance with the real move.
    // These are exponential damps / a phase clock, so a larger fdt just reaches
    // the target a touch sooner; with the flag off fdt===dt = today exactly.
    playerChar.group.position.set(player.pos.x, player.pos.y, player.pos.z);
    if (len > 0) {
      const tYaw = Math.atan2(mx, mz);
      playerChar.group.rotation.y = lerpAngle(playerChar.group.rotation.y, tYaw, 1 - Math.pow(0.0006, fdt));
    }
    // crouch: a real pose (knees/hips fold — entities/character.js) instead of
    // the old scale.y accordion squash; ease any legacy squash back out.
    playerChar.crouch = !!player.crouch;
    playerChar.group.scale.y += (1 - playerChar.group.scale.y) * (1 - Math.pow(0.001, fdt));
    // get back up after a knockdown (ease the fall-over rotation out)
    if (playerChar.group.rotation.x) playerChar.group.rotation.x = CBZ.damp(playerChar.group.rotation.x, 0, 9, fdt);
    animChar(playerChar, player.speed, fdt);
  }

  CBZ.updatePlayer = updatePlayer;
  CBZ.onUpdate(10, updatePlayer);
})();
