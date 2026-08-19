/* ============================================================
   city/boatwalk.js — OUT OF THE SEAT, ONTO YOUR OWN DECK.

   OWNER ASK: "I should be able to not drive and get up and walk around —
   just jump button when seated is get up, that easy."

   Two verbs, both wired into things that already exist:

   1. GET UP — CBZ.boatStandUp(car). world/water_helm.js calls it on a fresh
      Space press at the wheel (the touch GET UP pill calls it directly).
      It routes through CBZ.cityExitVehicle — the ONE exit path, which owns
      the audio key-off, the rig release and the demotion — and then moves
      your feet from "beside the hull at y=0" (the road-car step-out, i.e.
      the sea) onto the hull's own walkable deck, found by asking
      CBZ.mpGroundAt: the SAME ground query physics.js will support you with
      next frame, so the deck you are stood on is a deck that will actually
      hold you. An open hull (RIB, runabout, skiff — no deck rig) keeps the
      honest answer: getting up off a jockey seat IS hopping over the side,
      and swim.js takes the body from there.

   2. TAKE THE HELM — an interaction zone at every live hull's helm station
      (water_hulls.js spec.helm — the same point the first-person eye uses),
      so "you have the helm back the moment you step to the wheel" is true
      on EVERY boat, including the ones whose wheelhouse sits five metres and
      two decks away from the hull's centre point, where the generic
      "vehicle" card (cityNearestCar, 3.8 m of the CENTRE) can never reach.
      Entering stays CBZ.cityEnterVehicle — the crime check, the occupant
      jack and the promotion are its, untouched.

   FLAG: CBZ.CONFIG.BOAT_WALK (default true). false -> Space at the wheel
   degrades to the old astern thrust (water_helm checks the flag itself) and
   the helm zone never surfaces.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.BOAT_WALK == null) CFG.BOAT_WALK = true;

  function on() { return CFG.BOAT_WALK !== false; }
  function specOf(car) {
    if (!car) return null;
    if (car._hullSpec) return car._hullSpec;
    if (CBZ.marineHulls && CBZ.marineHulls.specFor) {
      try { return CBZ.marineHulls.specFor(car); } catch (e) { return null; }
    }
    return null;
  }

  // scratch — the zone find and the stand-up probe run per frame; no allocs
  let _v = null;
  function vec() {
    if (_v) return _v;
    if (!window.THREE) return null;
    _v = new window.THREE.Vector3();
    return _v;
  }

  // hull-local -> world through the group's LIVE matrix (position, heading,
  // trim, heel, buoyancy seat — all of it), never a hand-rolled sin/cos: on a
  // 156 m hull one degree of trim moves the bridge more than a metre.
  function toWorld(car, x, y, z) {
    const v = vec();
    if (!v || !car.group) return null;
    car.group.updateWorldMatrix(true, false);
    return v.set(x, y, z).applyMatrix4(car.group.matrixWorld);
  }

  /* ---- where you can actually STAND on this hull ------------------------
     Candidate spots around the helm first (beside the wheel, a step aft),
     then the fixtures every registered hull shares (side decks amidships,
     the working deck astern). Each is probed through CBZ.mpGroundAt so the
     answer comes from the deck rig physics will support you with — never a
     guess from deckY that leaves you inside a superstructure or over the
     side. Two passes: first only decks CLOSE below the helm ("get up" means
     beside the wheel), then any deck of the hull at all (on a superyacht
     whose bridge sole isn't rigged, appearing on the deck below beats going
     over the rail). */
  function deckSpot(car, S) {
    if (!CBZ.mpGroundAt || !car.group) return null;
    const H = S.helm || { x: 0, y: (S.deckY || 1) + 1.5, z: 0 };
    const beam = S.beam || 3;
    const cands = [
      [H.x + 1.0, H.z - 0.5], [H.x - 1.0, H.z - 0.5],
      [H.x, H.z - 1.6],
      [beam * 0.40, 0], [-beam * 0.40, 0],
      [0, -(S.sternOffset || (S.loa || 8) * 0.5) * 0.45],
    ];
    const gy = car.group.position.y;
    // Probe from just UNDER the helm eye, never from above it: reach runs
    // upward from here, and a probe with headroom to spare happily returns
    // the SUN DECK over the wheelhouse — get up, appear on the roof.
    const probeY = Math.max(H.y - 0.55, (S.deckY || 0) + 0.6);
    let loose = null;
    for (let i = 0; i < cands.length; i++) {
      const w = toWorld(car, cands[i][0], probeY, cands[i][1]);
      if (!w) return null;
      const fromY = w.y;
      const wx = w.x, wz = w.z;                       // _v is reused by the next probe
      const top = CBZ.mpGroundAt(wx, wz, fromY, -Infinity);
      if (!(top > gy - 1.0)) continue;                // no deck here / in the sea
      // a sole within a body's height of the wheel is "beside the wheel";
      // anything further below is the loose fallback (the deck under a
      // raised bridge beats going over the rail, but only if nothing closer
      // answered)
      if (fromY - top < 3.2) return { x: wx, y: top, z: wz };
      if (!loose) loose = { x: wx, y: top, z: wz };
    }
    return loose;
  }

  /* ---- 1. GET UP --------------------------------------------------------
     Returns true when the exit ran (water_helm then owns nothing further this
     frame). The deck placement is best-effort on top of the one exit path:
     with no deck found, the step-out beside the hull stands — over water
     that is a splash, and swim.js's entry claim is already the owner of a
     body that arrives in the sea. */
  CBZ.boatStandUp = function (car) {
    if (!on()) return false;
    const P = CBZ.player;
    if (!P || !P.driving || P._vehicle !== car || !car || car.dead) return false;
    if (!CBZ.cityExitVehicle) return false;
    const S = specOf(car);
    const spot = S ? deckSpot(car, S) : null;
    CBZ.cityExitVehicle();
    if (spot) {
      P.pos.set(spot.x, spot.y + 0.05, spot.z);
      P.vy = 0; P.grounded = true;
      if (CBZ.playerChar && CBZ.playerChar.group) {
        CBZ.playerChar.group.position.copy(P.pos);
        CBZ.playerChar.group.visible = true;
      }
    }
    return true;
  };

  /* ---- 2. TAKE THE HELM -------------------------------------------------
     The wheel is a PLACE (doors beat markers): stand at it, the card offers
     the verb. Works aboard your own hull, a hull you jacked, or one you
     boarded under way — the enter path's own rules decide what that makes
     you. The vertical gate keeps the card off the deck BELOW a raised
     bridge: standing under the wheelhouse is not standing at the wheel. */
  const REACH = 3.2;
  function nearestHelm(px, pz) {
    const cars = CBZ.cityCars;
    if (!cars) return null;
    const P = CBZ.player;
    let best = null, bd = REACH * REACH, bx = 0, by = 0, bz = 0;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || c.player || !c.pos || !c.group) continue;
      const rx = c.pos.x - px, rz = c.pos.z - pz;
      const reject = Math.pow((c._hullSpec ? c._hullSpec.loa : 40) * 0.75 + REACH, 2);
      if (rx * rx + rz * rz > reject) continue;
      if (!CBZ.isMarineHull || !CBZ.isMarineHull(c)) continue;
      const S = specOf(c);
      if (!S || !S.helm) continue;
      const w = toWorld(c, S.helm.x, S.helm.y, S.helm.z);
      if (!w) continue;
      const dx = w.x - px, dz = w.z - pz, d2 = dx * dx + dz * dz;
      if (d2 >= bd) continue;
      // helm.y is the EYE; your pos is your FEET — the ~1.2-1.7 m between
      // them is the same floor, anything past 2.4 is a different deck.
      if (P && P.pos && Math.abs((w.y - 1.45) - P.pos.y) > 2.4) continue;
      bd = d2; best = c; bx = w.x; by = w.y; bz = w.z;
    }
    return best ? { car: best, x: bx, y: by, z: bz, name: "The helm" } : null;
  }

  let wired = false;
  function wire() {
    if (wired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    wired = true;
    const I = CBZ.interactions;
    I.registerZone({
      id: "boat-helm", kind: "boatHelm", radius: REACH,
      find: function (px, pz) {
        if (!on()) return null;
        if (!CBZ.game || CBZ.game.mode !== "city") return null;
        const P = CBZ.player;
        if (!P || P.driving || P._swim || P.dead) return null;
        return nearestHelm(px, pz);
      },
      options: [{
        id: "helm-take", slot: "e",
        canShow: function (t) { return !!(t && t.car && !t.car.dead && CBZ.cityEnterVehicle); },
        label: function (t) {
          return (t.car.owned || t.car.stolen) ? "Take the helm" : "Take her helm";
        },
        onSelect: function (t) {
          if (t && t.car && !t.car.dead && CBZ.cityEnterVehicle) CBZ.cityEnterVehicle(t.car);
        },
      }],
    });
    if (I.describe) I.describe("boatHelm", function (t) {
      const c = t && t.car;
      const name = (c && c.model && c.model.name) || "the boat";
      return { label: "The wheel", note: c && c.owned ? "Your boat, your water" : name };
    });
  }
  if (CBZ.onUpdate) CBZ.onUpdate(37.36, function () { wire(); });
  wire();
})();
