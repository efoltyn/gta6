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

  const SURF_Y = -0.38;      // chest-deep: head and shoulders above the water
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

  function arena() { return g.mode === "city" ? (CBZ.city && CBZ.city.arena) : null; }

  // is (x,z) over open water? (outside every walkable land mass)
  function waterAt(A, x, z) {
    if (x >= A.minX - QUAY && x <= A.maxX + QUAY && z >= A.minZ - QUAY && z <= A.maxZ + QUAY) return false;
    const B = A.bridge;
    if (B && x >= B.minX && x <= B.maxX && z >= B.minZ && z <= B.maxZ) return false;
    const I = A.annex;
    if (I && Math.hypot(x - I.cx, z - I.cz) <= I.radius + 1.5) return false;
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
    return best;
  }

  function enterWater(P) {
    swimming = true;
    P._swim = true;
    P.vy = 0;
    px = P.pos.x; pz = P.pos.z;   // anchor the drag HERE — never against the
    // last on-land spot (a bail-out/teleport into water would snap you back)
    if (CBZ.sfx) { try { CBZ.sfx("splash"); } catch (e) { try { CBZ.sfx("step"); } catch (e2) {} } }
    if (CBZ.shake) CBZ.shake(0.35);
    if (CBZ.city && CBZ.city.note) CBZ.city.note("🌊 In the drink — swim to the seawall before you tire out", 2.6);
  }

  function exitWater(P, spot) {
    swimming = false;
    P._swim = false;
    if (spot) {
      P.pos.x = spot.x; P.pos.z = spot.z;
      // the haul-up: pop above the seawall cap's height gate (y1=0.8) so the
      // wall collider can't shove you back off the lip mid-climb
      P.pos.y = 1.0; P.vy = 2.2; P.grounded = false;
      if (CBZ.sfx) { try { CBZ.sfx("step"); } catch (e) {} }
    }
  }

  // runs AFTER movement/collision (≈45.x net pass) and BEFORE the rigs copy
  // positions for render, so the water owns the player's altitude cleanly.
  CBZ.onUpdate(45.8, function (dt) {
    const A = arena();
    const P = CBZ.player;
    if (!A || !P || A.minX == null) { if (swimming) { swimming = false; if (P) P._swim = false; } return; }
    if (P.dead || P.driving) { if (swimming) { swimming = false; P._swim = false; } return; }

    const inWater = waterAt(A, P.pos.x, P.pos.z) && P.pos.y <= 0.6;
    if (inWater && !swimming) enterWater(P);

    if (!swimming) { px = P.pos.x; pz = P.pos.z; return; }

    if (!inWater) {            // drifted back over land (rocks/sand shoulder)
      exitWater(P, null);
      return;
    }

    // ---- the swim: half-submerged, heavy ----
    P.pos.x = px + (P.pos.x - px) * DRAG;
    P.pos.z = pz + (P.pos.z - pz) * DRAG;
    px = P.pos.x; pz = P.pos.z;
    P.pos.y = SURF_Y;
    P.vy = 0;
    P.grounded = true;          // no fall-damage bookkeeping while floating
    P.sprint = false;

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
      if (hintT <= 0 && CBZ.city && CBZ.city.note) { hintT = 1.6; CBZ.city.note("🧗 [Space] climb out", 1.4); }
      if (CBZ.keys && CBZ.keys[" "]) exitWater(P, spot);
    }
  });

  CBZ.citySwimming = function () { return swimming; };
  // is this point over open water? (humancontact's land clamp + anything else
  // that needs to leave a swimmer alone)
  CBZ.cityWaterAt = function (x, z) {
    const A = arena();
    return !!(A && A.minX != null && waterAt(A, x, z));
  };
})();
