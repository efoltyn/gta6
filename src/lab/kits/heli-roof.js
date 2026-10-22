/* lab kit "heli-roof": from the street to the rooftop helipad and into the
   air, on the island's real tower and its real lift.

   The walk is the player's own physics (the "player" ingredient holds W and
   points the camera, nothing teleports): the street in front of the tower ->
   through the lobby door -> the lift landing. Then the island's own lift
   verbs, the calls [E] / a tap make: Call (CBZ.islandLiftCall), in the car
   (CBZ.islandLiftGoTo, the roof on the car's panel), the ride to the roof stop. Out onto the roof, up the
   helipad stair (CBZ.stairs walk surface, world/island_vehicles.js), across
   the deck to the helicopter, Board (CBZ.islandHeliBoard: the door arc, then
   the seat), then the flight on city/playeraircraft.js's controls held as
   keys: Space (collective up) to climb, hands off to hover, Ctrl (collective
   down) to land back on the deck.

   lab.html?kit=heli-roof&climb=3&hover=4
   probe(): every leg's arrival time, the heights it was reached at (roof walk
   surface, deck), boarded, metres climbed, the hover's vertical and
   horizontal wander, the landing (on the deck? how far off the H?), the
   airframe's hp. ok = street -> roof -> deck -> air -> back on the deck. */
(function () {
"use strict";

CBZ.lab.kit("heli-roof", {
  about: "street -> lobby -> lift (Call, Up) -> roof -> helipad stair -> Board -> collective up, hover, land on the deck",
  uses: ["island", "player"],
  mode: "survival",
  params: { climb: 3, hover: 4 },
  duration: 120,
  setup: function (W, P) {
    const I = W.add("island", { name: "island" });
    const pl = W.add("player", { name: "player", at: [I.arena.center.x, I.arena.center.z] });
    const A = I.arena, Pl = pl.actor, keys = CBZ.keys || (CBZ.keys = {});
    const CLIMB = +P.climb || 3, HOVER = +P.hover || 4;
    const M = W.marks = { phase: "boot", phaseT: 0, legs: {}, stalled: null, route: [], wp: 0,
      roofY: null, deckY: null, boarded: false, climb: 0, hoverDy: 0, hoverDxz: 0, land: null, hpCraft: null };
    let pad = null, e = null, b = null, c = null, y0 = 0, hov = null;
    function go(ph) { M.legs[ph] = +W.t().toFixed(2); M.phase = ph; M.phaseT = 0; W.event("kit", ph); }
    function fail(why) { M.stalled = why + " (in " + M.phase + ")"; pl.stop(); keys[" "] = keys.control = false; go("done"); }
    function route(list) { M.route = list; M.wp = 0; if (list.length) pl.walkTo(list[0].x, list[0].z, { stop: 0.3 }); }
    // the walk: step through the waypoints, true when the last is reached
    function walking() {
      const p = M.route[M.wp];
      if (!p) return true;
      if (Math.hypot(Pl.pos.x - p.x, Pl.pos.z - p.z) < 0.35) {
        M.wp++;
        if (M.wp >= M.route.length) { pl.stop(); return true; }
        const q = M.route[M.wp]; pl.walkTo(q.x, q.z, { stop: 0.3 });
      }
      return false;
    }
    const inCar = function () { return Math.abs(Pl.pos.x - b.ox) < e.s - 0.35 && Math.abs(Pl.pos.z - b.oz) < e.s - 0.35; };
    W.every(function (dt) {
      M.phaseT += dt;
      const V = CBZ.islandVehicles;
      if (M.phase === "boot") {
        pad = V && V.pad();
        if (!pad) { if (M.phaseT > 2) fail("no helipad on the island"); return; }
        e = pad.e; b = pad.b; c = V.heli();
        const d = b.d;
        // the street in front of the lobby door
        Pl.pos.set(b.ox, A.groundHeightAt(b.ox, b.oz - d / 2 - 5), b.oz - d / 2 - 5); Pl.vy = 0; Pl.grounded = true;
        route([{ x: b.ox, z: b.oz - d / 2 + 1.2 }, { x: b.ox, z: b.oz - e.s - 0.9 }]);
        go("walk-in");
        return;
      }
      if (M.phase === "walk-in") {
        if (walking()) go("call");
        else if (M.phaseT > 25) fail("never reached the lift");
        return;
      }
      if (M.phase === "call") {
        // [E] on the pinned Call: true once the lift answers
        if (e.m.at === 0 && (e.m.st === "open") && e.doors.open[0] > 0.95) { route([{ x: b.ox, z: b.oz }]); go("board-lift"); return; }
        if (CBZ.islandLiftCall) CBZ.islandLiftCall();
        if (M.phaseT > 40) fail("the lift never opened at the lobby");
        return;
      }
      if (M.phase === "board-lift") {
        walking();
        if (inCar() && M.phaseT > 0.6) {
          if (CBZ.islandLiftGoTo && CBZ.islandLiftGoTo(pad.roofStop)) { pl.stop(); go("ride"); }
        }
        if (M.phaseT > 15) fail("never sent the lift up");
        return;
      }
      if (M.phase === "ride") {
        const k = pad.roofStop;
        if (e.m.at === k && Math.abs(e.y - e.stops[k]) < 0.01 && (e.m.st === "open" || e.m.st === "idle")) {
          M.roofY = +Pl.pos.y.toFixed(2);
          const sb = pad.stairBottom, st = pad.stairTop;
          route([{ x: b.ox, z: sb.z }, { x: sb.x + 0.35, z: sb.z }, { x: st.x, z: st.z }, { x: st.x, z: pad.centre.z + 3.2 }, { x: pad.centre.x + 2.6, z: pad.centre.z + 1.2 }]);
          go("roof");
        } else if (M.phaseT > 60) fail("the lift never reached the roof");
        return;
      }
      if (M.phase === "roof") {
        if (M.wp >= 3 && M.deckY == null && Math.abs(Pl.pos.y - pad.deckY) < 0.15) { M.deckY = +Pl.pos.y.toFixed(2); M.legs.deck = +W.t().toFixed(2); }
        if (walking() || V.state().armed.heli) {
          pl.stop();
          if (CBZ.islandHeliBoard()) go("boarding");
          else if (M.phaseT > 30) fail("Board refused on the deck");
        } else if (M.phaseT > 40) fail("never reached the helicopter");
        return;
      }
      if (M.phase === "boarding") {
        if (Pl._aircraft === c) { M.boarded = true; y0 = c.pos.y; keys[" "] = true; go("climb"); }
        else if (M.phaseT > 8) fail("never got into the seat");
        return;
      }
      if (M.phase === "climb") {
        if (M.phaseT >= CLIMB) { keys[" "] = false; M.climb = +(c.pos.y - y0).toFixed(1); go("hover"); }
        return;
      }
      if (M.phase === "hover") {
        // the first second is the collective easing off; measure the rest
        if (M.phaseT > 1 && !hov) hov = { y: c.pos.y, x: c.pos.x, z: c.pos.z, lo: c.pos.y, hi: c.pos.y, dxz: 0 };
        if (hov) { hov.lo = Math.min(hov.lo, c.pos.y); hov.hi = Math.max(hov.hi, c.pos.y); hov.dxz = Math.max(hov.dxz, Math.hypot(c.pos.x - hov.x, c.pos.z - hov.z)); }
        if (M.phaseT >= HOVER + 1) { M.hoverDy = +(hov.hi - hov.lo).toFixed(2); M.hoverDxz = +hov.dxz.toFixed(2); keys.control = true; go("descend"); }
        return;
      }
      if (M.phase === "descend") {
        if (c.onGround) {
          keys.control = false;
          M.land = { onDeck: Math.abs((c.pos.y - c.groundOffset) - pad.deckY) < 0.3,
            surfaceY: +(c.pos.y - c.groundOffset).toFixed(2), offH: +Math.hypot(c.pos.x - pad.centre.x, c.pos.z - pad.centre.z).toFixed(2),
            sinkHit: c.lastTouchdown || null };
          M.hpCraft = Math.round(c.hp);
          go("done");
        } else if (M.phaseT > 20) fail("never touched down");
      }
    });
  },
  probe: function (W) {
    const M = W.marks, V = CBZ.islandVehicles, pad = V && V.pad();
    const out = {
      tower: pad ? { storeys: pad.b.storeys, roofY: +pad.roofY.toFixed(2), deckY: +pad.deckY.toFixed(2) } : null,
      legs: M.legs, reachedRoofAtY: M.roofY, reachedDeckAtY: M.deckY, boarded: M.boarded,
      climbed: M.climb, hoverVerticalWander: M.hoverDy, hoverDrift: M.hoverDxz, landing: M.land, craftHp: M.hpCraft,
      phase: M.phase, stalled: M.stalled,
    };
    out.ok = !!(pad && M.roofY != null && Math.abs(M.roofY - pad.roofY) < 0.3 && M.deckY != null && M.boarded &&
      M.climb > 10 && M.hoverDy < 3 && M.land && M.land.onDeck && M.land.offH < 4 && !M.stalled);
    out.summary = (out.ok ? "PASS " : "FAIL ") + (M.roofY != null ? "roof at " + M.roofY + " m" : "no roof") +
      (M.deckY != null ? ", deck at " + M.deckY : "") + (M.boarded ? ", boarded, climbed " + M.climb + " m, hovered (wander " + M.hoverDy + " m)" : "") +
      (M.land ? ", landed " + (M.land.onDeck ? "on the deck " : "OFF the deck ") + M.land.offH + " m off the H" : "") + (M.stalled ? " - " + M.stalled : "");
    return out;
  },
});
})();
