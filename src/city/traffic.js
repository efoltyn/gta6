/* ============================================================
   city/traffic.js — traffic-light cycle + traffic-law enforcement.

   All intersections share one phase clock (readable: every light goes
   green/red together by axis). Driving through a red light, or
   recklessly mowing the sidewalk, earns a little heat if it's seen —
   the gateway crime that can start a chase from nothing.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  const CYCLE = 14;          // seconds for a full N–S / E–W cycle
  // segment boundaries within the cycle
  function phase() {
    const t = CBZ.now % CYCLE;
    if (t < 5) return { ns: "green", ew: "red" };
    if (t < 6.5) return { ns: "yellow", ew: "red" };
    if (t < 7) return { ns: "red", ew: "red" };
    if (t < 12) return { ns: "red", ew: "green" };
    if (t < 13.5) return { ns: "red", ew: "yellow" };
    return { ns: "red", ew: "red" };
  }
  CBZ.cityPhase = phase;
  // is travel along this axis facing a red? (vertical road = N–S travel)
  CBZ.cityIsRed = function (vertical) { const p = phase(); return (vertical ? p.ns : p.ew) !== "green"; };

  function lampSet(lamp, on, color) {
    if (!lamp || !lamp.material) return;
    lamp.material.emissiveIntensity = on ? 1.0 : 0.04;
    lamp.material.color.setHex(on ? color : 0x20242a);
    if (lamp.material.emissive) lamp.material.emissive.setHex(color);
  }

  let lightT = 0, ticketCD = 0, prevInside = false;

  CBZ.onUpdate(36, function (dt) {
    if (g.mode !== "city") return;
    const A = CBZ.city.arena; if (!A) return;

    // drive the lamp colours (throttled — the colour only changes a few times
    // per cycle, but cheap enough to refresh a couple of times a second)
    lightT -= dt;
    if (lightT <= 0) {
      lightT = 0.25;
      const p = phase();
      for (const it of A.intersections) {
        const L = it.light; if (!L) continue;
        // each axis head shows its own state — cross street is red while the
        // main runs green, exactly like a real 4-way signal.
        const ns = L.ns || L, ew = L.ew;
        lampSet(ns.red, p.ns === "red", 0xff3b3b);
        lampSet(ns.yel, p.ns === "yellow", 0xffcf3b);
        lampSet(ns.grn, p.ns === "green", 0x39ff66);
        if (ew) {
          lampSet(ew.red, p.ew === "red", 0xff3b3b);
          lampSet(ew.yel, p.ew === "yellow", 0xffcf3b);
          lampSet(ew.grn, p.ew === "green", 0x39ff66);
        }
      }
    }

    // ---- red-light / reckless-driving enforcement ----
    if (ticketCD > 0) ticketCD -= dt;
    const P = CBZ.player;
    if (!P.driving || !P._vehicle) { prevInside = false; return; }
    const v = P._vehicle;
    const it = A.nearestIntersection(P.pos.x, P.pos.z);
    const inside = Math.abs(P.pos.x - it.x) < A.ROAD / 2 + 1.5 && Math.abs(P.pos.z - it.z) < A.ROAD / 2 + 1.5;
    // count it once, on entry, while moving with a red against your heading
    if (inside && !prevInside && Math.hypot(v.vx || 0, v.vz || 0) > 6) {
      const vertical = Math.abs(v.vz || 0) > Math.abs(v.vx || 0);
      if (CBZ.cityIsRed(vertical) && ticketCD <= 0) {
        ticketCD = 4;
        // only a problem if a cop is around to see it; otherwise just a warning
        const seen = anyCopNear(P.pos.x, P.pos.z, 34);
        if (seen) { CBZ.cityCrime && CBZ.cityCrime(22, { type: "red-light" }); CBZ.city && CBZ.city.note("🚦 Ran a red light — wanted!", 2); }
        else CBZ.city && CBZ.city.note("🚦 You ran a red light", 1.4);
      }
    }
    prevInside = inside;
  });

  function anyCopNear(x, z, r) {
    const r2 = r * r;
    for (const c of CBZ.cityCops) { if (c.dead) continue; const dx = c.pos.x - x, dz = c.pos.z - z; if (dx * dx + dz * dz < r2) return true; }
    return false;
  }
})();
