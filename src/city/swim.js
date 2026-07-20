/* ============================================================
   city/swim.js — THE WATER IS REAL. The city is ringed by ocean
   (waterfront pass), but until now falling past the seawall left
   you STANDING on an invisible floor under a blue plane — exactly
   the fake-world read this game bans. Now: leave land and you're
   IN the water — half-submerged, slow, stamina bleeding away —
   and you get out the way a person does: paddle to the seawall,
   the island beach or a bridge footing and haul yourself up.
   Tread too long and the harbor keeps you.

   Land is what world.js's clampToCity already knows: the city slab
   (quay included), the bridge deck, the island disc. Everything
   else at sea level is water. Cheap: one updater, rect/circle
   tests, zero allocation.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const BODY_SUBMERGE = 1.28; // feet below mean sea level: water crosses the chest
  const QUAY = 28;           // land extends this far past the road grid (world.js ground)
  const DRAG = 0.45;         // swimming keeps this fraction of your walk step
  // mode.js REGENS stamina 14/s whenever you're not sprinting, so the swim
  // drain must beat it: 16.5 - 14 = ~2.5/s net — a full tank buys ~40s in the
  // water, enough to cross the harbor if you swim straight, fatal if you don't.
  const DRAIN = 16.5;
  const DROWN = 5;           // hp/s once the tank is empty

  let swimming = false;
  let px = 0, pz = 0;        // last on-foot position (pre-drag reference)
  let hintT = 0, hurtT = 0;
  const swimCurrent = { x: 0, z: 0 };

  function arena() { return g.mode === "city" ? (CBZ.city && CBZ.city.arena) : null; }

  // is (x,z) over open water? (outside every walkable land mass)
  function waterAt(A, x, z) {
    // waterfield.js owns the rendered continent's exact signed coast.  Keep
    // the rect/circle branch only as a boot/legacy fallback.
    if (CBZ.waterField && CBZ.waterField.isSurfaceWater) {
      return CBZ.waterField.isSurfaceWater(x, z, 0);
    }
    if (x >= A.minX - QUAY && x <= A.maxX + QUAY && z >= A.minZ - QUAY && z <= A.maxZ + QUAY) return false;
    const B = A.bridge;
    if (B && x >= B.minX && x <= B.maxX && z >= B.minZ && z <= B.maxZ) return false;
    const I = A.annex;
    if (I && Math.hypot(x - I.cx, z - I.cz) <= I.radius + 1.5) return false;
    // worldmap.js islands & biomes are dry land too
    const regs = A.regions;
    if (regs && CBZ.cityRegionHit) {
      for (let i = 0; i < regs.length; i++) if (CBZ.cityRegionHit(regs[i], x, z, 0)) return false;
    }
    return true;
  }

  // nearest dry land in reach: REACH is measured to the water's EDGE (the
  // swimmer presses against the seawall collider and can never get closer
  // than that), but the LANDING point steps well past the wall's own collider
  // box so the haul-up can't be shoved straight back off the lip.
  function climbSpot(A, x, z, reach) {
    let best = null, bd = reach;
    function consider(ex, ez2, lx, lz) {
      const d = Math.hypot(ex - x, ez2 - z);
      if (d < bd) { bd = d; best = { x: lx, z: lz }; }
    }
    // city slab: edge = the quay line, landing = 5.5 inside it
    const cxq = Math.max(A.minX - QUAY, Math.min(A.maxX + QUAY, x));
    const czq = Math.max(A.minZ - QUAY, Math.min(A.maxZ + QUAY, z));
    consider(cxq, czq,
      cxq + (cxq <= A.minX - QUAY + 0.01 ? 5.5 : cxq >= A.maxX + QUAY - 0.01 ? -5.5 : 0),
      czq + (czq <= A.minZ - QUAY + 0.01 ? 5.5 : czq >= A.maxZ + QUAY - 0.01 ? -5.5 : 0));
    const B = A.bridge;
    if (B) {
      const bx = Math.max(B.minX, Math.min(B.maxX, x)), bz = Math.max(B.minZ, Math.min(B.maxZ, z));
      consider(bx, bz, Math.max(B.minX + 1.5, Math.min(B.maxX - 1.5, x)), Math.max(B.minZ + 1.5, Math.min(B.maxZ - 1.5, z)));
    }
    const I = A.annex;
    if (I) {
      const d = Math.hypot(x - I.cx, z - I.cz) || 1;
      consider(I.cx + ((x - I.cx) / d) * I.radius, I.cz + ((z - I.cz) / d) * I.radius,
               I.cx + ((x - I.cx) / d) * (I.radius - 2.5), I.cz + ((z - I.cz) / d) * (I.radius - 2.5));
    }
    // worldmap.js islands/biomes: haul out onto the nearest registered shore
    const regs = A.regions;
    if (regs && CBZ.cityRegionClamp) {
      for (let i = 0; i < regs.length; i++) {
        const edge = CBZ.cityRegionClamp(regs[i], x, z, 0);
        const land = CBZ.cityRegionClamp(regs[i], x, z, 3.0);
        consider(edge.x, edge.z, land.x, land.z);
      }
    }
    return best;
  }

  function enterWater(P) {
    swimming = true;
    P._swim = true;
    if (CBZ.playerChar) CBZ.playerChar.swimming = true;
    P.vy = 0;
    px = P.pos.x; pz = P.pos.z;   // anchor the drag HERE — never against the
    // last on-land spot (a bail-out/teleport into water would snap you back)
    if (CBZ.sfx) { try { CBZ.sfx("splash"); } catch (e) { try { CBZ.sfx("step"); } catch (e2) {} } }
    if (CBZ.shake) CBZ.shake(0.35);
    if (CBZ.city && CBZ.city.note) CBZ.city.note("In the drink — swim to the seawall before you tire out", 2.6);
  }

  function exitWater(P, spot) {
    swimming = false;
    P._swim = false;
    if (CBZ.playerChar) CBZ.playerChar.swimming = false;
    if (spot) {
      P.pos.x = spot.x; P.pos.z = spot.z;
      // the haul-up: pop above the seawall cap's height gate (y1=0.8) so the
      // wall collider can't shove you back off the lip mid-climb
      const gy = CBZ.floorAt ? (CBZ.floorAt(spot.x, spot.z) || 0) : 0;
      P.pos.y = gy + 1.0; P.vy = 2.2; P.grounded = false;
      if (CBZ.sfx) { try { CBZ.sfx("step"); } catch (e) {} }
    }
  }

  // runs AFTER movement/collision (≈45.x net pass) and BEFORE the rigs copy
  // positions for render, so the water owns the player's altitude cleanly.
  CBZ.onUpdate(45.8, function (dt) {
    const A = arena();
    const P = CBZ.player;
    if (!A || !P || A.minX == null) {
      if (swimming) { swimming = false; if (P) P._swim = false; if (CBZ.playerChar) CBZ.playerChar.swimming = false; }
      return;
    }
    if (P.dead || P.driving) {
      if (swimming) { swimming = false; P._swim = false; if (CBZ.playerChar) CBZ.playerChar.swimming = false; }
      return;
    }

    const inWater = waterAt(A, P.pos.x, P.pos.z) && P.pos.y <= 0.6;
    if (inWater && !swimming) enterWater(P);

    if (!swimming) { px = P.pos.x; pz = P.pos.z; return; }

    if (!inWater) {            // drifted back over land (rocks/sand shoulder)
      exitWater(P, null);
      return;
    }

    // ---- the swim: genuinely chest-deep, heavy, and visibly animated ----
    P.pos.x = px + (P.pos.x - px) * DRAG;
    P.pos.z = pz + (P.pos.z - pz) * DRAG;
    // A weak coastline-aware current makes the sea feel like a moving body of
    // water. waterfield removes any shoreward component near land, so it can
    // drift a swimmer along a beach but never conveyor-belt them through it.
    if (CBZ.waterField && CBZ.waterField.currentAt) {
      const cur = CBZ.waterField.currentAt(P.pos.x, P.pos.z, undefined, swimCurrent);
      const nx = P.pos.x + cur.x * dt * 0.34, nz = P.pos.z + cur.z * dt * 0.34;
      if (CBZ.waterField.isSurfaceWater(nx, nz, 0.5)) { P.pos.x = nx; P.pos.z = nz; }
    }
    px = P.pos.x; pz = P.pos.z;
    P._swimPhase = (P._swimPhase || 0) + dt * (2.6 + Math.min(3, P.speed || 0) * 0.22);
    const seaY = CBZ.citySeaHeightAt
      ? CBZ.citySeaHeightAt(P.pos.x, P.pos.z)
      : (CBZ.SEA_Y != null ? CBZ.SEA_Y : -0.48);
    P.pos.y = seaY - BODY_SUBMERGE + Math.sin(P._swimPhase * 2) * 0.045;
    P.vy = 0;
    P.grounded = true;          // no fall-damage bookkeeping while floating
    P.sprint = false;

    // Physics synced the rig before the water pass, so the old implementation
    // left the visible character standing on its pre-swim floor. Water owns the
    // final pose and transform for this frame.
    const ch = CBZ.playerChar;
    if (ch && ch.group) {
      ch.swimming = true;
      ch.group.position.copy(P.pos);
      const sw = Math.sin(P._swimPhase);
      if (ch.body) { ch.body.rotation.x = 0.22; ch.body.position.y = Math.sin(P._swimPhase * 2) * 0.025; }
      if (ch.parts) {
        if (ch.parts.la) { ch.parts.la.rotation.x = -1.20 + sw * 0.62; ch.parts.la.rotation.z = -0.28; }
        if (ch.parts.ra) { ch.parts.ra.rotation.x = -1.20 - sw * 0.62; ch.parts.ra.rotation.z = 0.28; }
        if (ch.parts.ll) ch.parts.ll.rotation.x = sw * 0.30;
        if (ch.parts.rl) ch.parts.rl.rotation.x = -sw * 0.30;
      }
      if (ch.low) {
        if (ch.low.la) ch.low.la.rotation.x = -0.45;
        if (ch.low.ra) ch.low.ra.rotation.x = -0.45;
        if (ch.low.ll) ch.low.ll.rotation.x = 0.35 + Math.max(0, -sw) * 0.25;
        if (ch.low.rl) ch.low.rl.rotation.x = 0.35 + Math.max(0, sw) * 0.25;
      }
    }

    // ---- tiring out ----
    if (P.stamina != null) {
      P.stamina = Math.max(0, P.stamina - DRAIN * dt);
      if (P.stamina <= 0) {
        hurtT += dt;
        if (hurtT >= 1) {
          hurtT = 0;
          if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(DROWN, P.pos.x, P.pos.z, "drowned", false, null, false);
        }
      }
    }

    // ---- the way out: close enough to a land edge = haul up ----
    const spot = climbSpot(A, P.pos.x, P.pos.z, 4.6);
    if (spot) {
      hintT -= dt;
      if (hintT <= 0 && CBZ.city && CBZ.city.note) { hintT = 1.6; CBZ.city.note("[Space] climb out", 1.4); }
      if (CBZ.keys && CBZ.keys[" "]) exitWater(P, spot);
    }
  });

  CBZ.citySwimming = function () { return swimming; };
  // is this point over open water? (humancontact's land clamp + anything else
  // that needs to leave a swimmer alone)
  // waterfield.js normally publishes this before swim.js loads. Preserve a
  // standalone fallback for old pages/tests that load only this module.
  if (!CBZ.waterField) CBZ.cityWaterAt = function (x, z) {
    const A = arena();
    return !!(A && A.minX != null && waterAt(A, x, z));
  };
})();
