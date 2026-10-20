/* ============================================================
   world/island_building.js — CBZ.islandBuilding: THE ISLAND BUILDING, AS DATA.

   OWNER (Natural Disaster Survival):
     "The stairs start all the way at the wall, so there needs to be an area
      to get onto the stairs at the bottom, but they go all the way to the
      wall."
     "There are one-floor buildings that have stairs that go to the roof, but
      then the roof has no colliders."

   Both were true, and both were the same mistake: the stair was laid by
   hand inside world/disaster_arena.js with no plan anyone could check.
     • the first riser stood 0.3 m off the front wall (the foot of the flight
       was against the wall: nowhere to stand and turn onto it), every
       flight climbed 3.4 m in NINE risers (0.38 m each: a ladder) over
       0.86 m goings, and the top landing was 1.4 m deep for a 1.8 m flight;
     • every building had a flight to the roof, whatever the facade grammar
       stood on that roof. Every one of the 31 grammars declares crownsRoof
       and most of them mean it (a hipped roof, a gable, an attic storey, a
       dome, a mansard), as deco boxes with no collider, so on 54 of the
       island's 74 stair buildings the stair came up into a crown you
       walked through and off.

   Measured with tools/island-stairs-check.mjs (--legacy is the old stair
   under the same rules): 2062 violations before, 0 after.

   THIS FILE IS THE PLAN. Pure numbers, no THREE, no scene: disaster_arena.js
   builds exactly what it says, and tools/island-stairs-check.mjs runs the
   same functions over every lot of the island in plain node and checks the
   plan (a landing at both ends of every flight, no flight that ends at a
   wall, real risers and goings, headroom, every roof a stair reaches solid
   and walled).

     CBZ.islandBuilding.facadeCtx(o)    the facade kit's ctx for an island
                                        building (minus the emitters), so the
                                        crown can be probed before the shell
                                        is laid and dressed with the same ctx
     CBZ.islandBuilding.plan(o)         a house/shop/villa/civic/works shell:
                                        stairs, landings, slabs, guards, roof
     CBZ.islandBuilding.towerRoof(o)    a lift tower's roof: walk ring, edge
                                        parapets, crown solids

   All coordinates building-local, the door on -z, the stair strip down the
   -x wall, y from the building's ground reference (gy).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};

  const FH = 3.4;      // floor-to-floor height
  const WT = 0.3;      // wall thickness
  const SW = 3.6;      // the stair strip along the -x interior wall: two lanes
  const LANE = SW / 2; // one flight's lane
  const DOORW = 1.8;   // the street door
  const FLOOR0 = 0.08; // the ground floor's walk surface (the foundation's top)
  const PPH = 0.7;     // parapet height over the roof
  const BH = 2.6;      // the roof bulkhead's height over the roof
  const BXT = 0.12;    // the bulkhead's front wall (stairwell side) thickness
  const DOOR_H = 2.2;  // the bulkhead's doorway onto the roof
  const APRON = 1.2;   // clear roof outside that doorway

  /* THE NUMBERS OF A REAL STAIR (a building code's, rounded):
       rise 0.17-0.19 m, going 0.25-0.28 m, a landing at each end at least as
       deep as the flight is wide, 2.05 m clear over every nosing, a guard
       0.95 m high wherever a floor or landing has a drop beside it. */
  const RULE = { riseMin: 0.17, riseMax: 0.19, goMin: 0.25, goMax: 0.28, landMin: LANE, head: 2.05, guard: 0.95, rise: 0.18 };

  function shadeHex(hex, f) {
    const r = Math.max(0, Math.min(255, (((hex >> 16) & 255) * f) | 0));
    const g2 = Math.max(0, Math.min(255, (((hex >> 8) & 255) * f) | 0));
    const b = Math.max(0, Math.min(255, ((hex & 255) * f) | 0));
    return (r << 16) | (g2 << 8) | b;
  }

  /* THE FACADE KIT'S CTX for an island building: the host's real numbers,
     no emitters (the caller adds dbox/lbox/plat/... or hands it to
     CBZ.facadeCrownProbe as is). o: {ox, oz, w, d, storeys, fh, wt, rTop, pp,
     doorSide, color, style}. */
  function facadeCtx(o) {
    const ox = o.ox, oz = o.oz;
    return {
      ox: ox, oz: oz, w: o.w, d: o.d, storeys: o.storeys,
      FH: o.fh != null ? o.fh : FH, WT: o.wt != null ? o.wt : WT, rTop: o.rTop, pp: o.pp, doorSide: o.doorSide || 0,
      slabCx: 0, slabCz: 0, slabW: o.w - 2 * (o.wt != null ? o.wt : WT), slabD: o.d - 2 * (o.wt != null ? o.wt : WT),
      garageGround: false, showroom: false, civic: null,
      dress: { style: o.style },
      pal: { wall: o.color, stone: shadeHex(o.color, 1.14), dirt: 0x2a2420, kind: "brick", id: null },
      color: o.color,
      TRIM: shadeHex(o.color, 1.16),
      BASE: shadeHex(o.color, 0.60),
      PIL: shadeHex(o.color, 1.06),
      MULL: 0x39404a,
      hash: function (salt) { return CBZ.hash01 ? CBZ.hash01(ox, oz, salt) : 0.42; },
    };
  }

  // ---- small geometry -------------------------------------------------
  function overlap(a0, a1, b0, b1) { return Math.min(a1, b1) - Math.max(a0, b0); }
  // crown boxes [x0,x1,y0,y1,z0,z1] that stand in the head space over a
  // surface at y (anything from ankle to head height)
  function inHeadSpace(crown, y) {
    const out = [];
    if (crown) for (const c of crown) if (c[2] < y + RULE.head + 0.05 && c[3] > y + 0.15) out.push(c);
    return out;
  }
  function hitRect(pieces, x0, x1, z0, z1) {
    for (const c of pieces) if (overlap(c[0], c[1], x0, x1) > 0.01 && overlap(c[4], c[5], z0, z1) > 0.01) return c;
    return null;
  }
  // the fraction of a rect a set of crown pieces stands over (0.25 m grid)
  function coverage(pieces, x0, x1, z0, z1) {
    let n = 0, hit = 0;
    for (let x = x0 + 0.125; x < x1; x += 0.25) for (let z = z0 + 0.125; z < z1; z += 0.25) {
      n++;
      for (const c of pieces) if (x > c[0] && x < c[1] && z > c[4] && z < c[5]) { hit++; break; }
    }
    return n ? hit / n : 0;
  }

  /* ---- THE STAIR ------------------------------------------------------
     Two lanes in the strip down the -x wall. levels: how many storeys the
     stair climbs (to the top floor, or to the roof). Returns null when the
     room is too short for any stair (never on this island: the shallowest
     lot is 10 m deep, a straight flight needs 8.1 m).

     STRAIGHT (a room deep enough for one flight a storey): flight k climbs
     storey k in lane k%2, alternating direction, so consecutive flights
     share a landing at the end they meet and the flights stacked over any
     point are two storeys apart (groundAt is never ambiguous going down).
     The flight is CENTRED in the strip's depth: an equal landing at each
     end, at least a lane deep — the ground floor's is the approach from the
     door, every upper one is the floor's own landing.

     DOG-LEG (a shorter room): each storey is two half-flights, lane 0 up to
     a half landing at the back, lane 1 back to the floor landing at the
     front; both landings span both lanes. */
  function stairPlan(w, d, storeys, levels) {
    const ixMin = -w / 2 + WT, izMin = -d / 2 + WT, izMax = d / 2 - WT;
    const D = izMax - izMin;
    const out = { mode: "none", flights: [], landings: [], approach: null, levels: 0, rule: RULE };
    if (levels < 1) return out;
    const yOf = function (L) { return L === 0 ? FLOOR0 : L * FH; };
    const lane = function (i) { return { x0: ixMin + i * LANE, x1: ixMin + (i + 1) * LANE }; };
    const risersFor = function (dy) {
      let n = Math.round(dy / RULE.rise);
      while (dy / n > RULE.riseMax) n++;
      while (n > 2 && dy / (n - 1) <= RULE.riseMax && dy / n < RULE.riseMin) n--;
      return n;
    };
    const both = { x0: ixMin, x1: ixMin + SW };
    const flight = function (k, ln, dir, zb, yb, yt, n, g, L0, L1) {
      const l = lane(ln);
      return { k: k, lane: ln, x0: l.x0, x1: l.x1, dir: dir, zb: zb, zt: zb + dir * (n - 1) * g,
        yb: yb, yt: yt, risers: n, rise: (yt - yb) / n, going: g, L0: L0, L1: L1 };
    };
    const landing = function (L, y, z0, z1) { out.landings.push({ L: L, y: y, x0: both.x0, x1: both.x1, z0: z0, z1: z1 }); };

    // STRAIGHT: the worst storey (the ground floor's is 8 cm shorter) sets the run
    const n1 = risersFor(FH);
    const gS = Math.min(RULE.goMax, (D - 2 * RULE.landMin) / (n1 - 1));
    if (gS >= RULE.goMin - 1e-9) {
      out.mode = "straight";
      const run = (n1 - 1) * gS, LA = (D - run) / 2;
      for (let k = 0; k < levels; k++) {
        const dir = k % 2 === 0 ? 1 : -1;
        const zb = dir > 0 ? izMin + LA : izMax - LA;
        const yb = yOf(k), yt = yOf(k + 1);
        const n = (yt - yb) / n1 >= RULE.riseMin - 1e-9 ? n1 : risersFor(yt - yb);
        // every flight has the same run: a shorter ground storey gets the
        // same number of risers a hair shallower, so all nosings line up
        const F = flight(k, k % 2, dir, zb, yb, yt, n, run / (n - 1), k, k + 1);
        out.flights.push(F);
        if (dir > 0) landing(k + 1, yt, F.zt, izMax); else landing(k + 1, yt, izMin, F.zt);
      }
      out.approach = { x0: lane(0).x0, x1: lane(0).x1, z0: izMin, z1: izMin + LA, y: FLOOR0 };
    } else {
      // DOG-LEG: an even riser count, so both halves are the same flight
      // (same risers, same going) and their nosings line up across the lanes
      const evenFor = function (dy) {
        for (let n = 2 * Math.round(dy / RULE.rise / 2); n >= 2; n -= 2) if (dy / n >= RULE.riseMin - 1e-9 && dy / n <= RULE.riseMax + 1e-9) return n;
        return 2 * Math.ceil(dy / RULE.riseMax / 2);
      };
      const nh = evenFor(FH) / 2;
      const gD = Math.min(RULE.goMax, (D - 2 * RULE.landMin) / (nh - 1));
      if (gD < RULE.goMin - 1e-9) return out;            // no stair fits
      out.mode = "dogleg";
      const run = (nh - 1) * gD, LA = (D - run) / 2;
      const zFront = izMin + LA, zBack = izMax - LA;
      for (let s = 0; s < levels; s++) {
        const yb = yOf(s), yt = yOf(s + 1);
        const ym = (yb + yt) / 2;
        const A = flight(2 * s, 0, 1, zFront, yb, ym, nh, gD, s, s + 0.5);
        const B = flight(2 * s + 1, 1, -1, zBack, ym, yt, nh, gD, s + 0.5, s + 1);
        out.flights.push(A, B);
        landing(s + 0.5, ym, zBack, izMax);
        landing(s + 1, yt, izMin, zFront);
      }
      out.approach = { x0: lane(0).x0, x1: lane(0).x1, z0: izMin, z1: zFront, y: FLOOR0 };
    }
    out.levels = levels;
    return out;
  }

  /* ---- THE WHOLE SHELL ------------------------------------------------
     o: {w, d, storeys, crown}. crown: CBZ.facadeCrownProbe's pieces (or the
     dressed crown) — whatever the grammar stands above the roof.

     THE ROOF IS A PLACE ONLY IF IT IS ONE. A stair goes to the roof when:
       • the stair strip at roof level is clear for the bulkhead (the stair's
         own little house on the roof, with a doorway), and
       • at most 15 % of the roof's walkable slab has crown standing in head
         height over it (a hipped roof, a gable, an attic storey, a dome
         covers it all; a parapet coping, a finial, a sign do not), and
       • the 1.2 m of roof outside the bulkhead doorway is clear.
     Then every crown piece in head height over the roof becomes a collider
     (plan.roof.solids): you walk round a cupola, not through it. Otherwise
     the stair stops at the top floor, the roof slab closes over the strip
     (it is the top floor's ceiling) and there is no way up. */
  function plan(o) {
    const w = o.w, d = o.d, storeys = Math.max(1, o.storeys | 0);
    const ixMin = -w / 2 + WT, ixMax = w / 2 - WT, izMin = -d / 2 + WT, izMax = d / 2 - WT;
    const sEdge = ixMin + SW, bx1 = sEdge + BXT, rTop = storeys * FH;
    const crown = o.crown || [];
    const head = inHeadSpace(crown, rTop);

    // can the roof be reached at all?
    let why = null;
    // inside the bulkhead (the stairwell carried up a storey): a cornice or
    // a parapet on the wall line round it is fine, anything in the well is not
    const stripHit = crown.some(function (c) {
      return overlap(c[0], c[1], ixMin, bx1) > 0.01 && overlap(c[4], c[5], izMin, izMax) > 0.01 &&
        c[3] > rTop + 0.15 && c[2] < rTop + BH + 0.3;
    });
    if (stripHit) why = "crown over the stair strip";
    const cov = coverage(head, sEdge, ixMax, izMin, izMax);
    if (!why && cov > 0.15) why = "crown covers " + Math.round(cov * 100) + "% of the roof";
    let st = why ? null : stairPlan(w, d, storeys, storeys);
    let top = st && st.landings.length ? st.landings[st.landings.length - 1] : null;
    let door = null;
    if (st && top) {
      door = { z0: Math.max(izMin, top.z0 + 0.05), z1: Math.min(izMax, top.z1 - 0.05) };
      if (hitRect(head, bx1, bx1 + APRON, door.z0, door.z1)) { why = "crown outside the roof door"; st = null; door = null; }
    } else if (st) { why = "no stair fits"; st = null; }
    const access = !!st;
    if (!st) st = stairPlan(w, d, storeys, storeys - 1);

    const P = {
      w: w, d: d, storeys: storeys, FH: FH, WT: WT, SW: SW, LANE: LANE, FLOOR0: FLOOR0,
      ix: [ixMin, ixMax], iz: [izMin, izMax], sEdge: sEdge, rTop: rTop,
      mode: st.mode, flights: st.flights, landings: st.landings, approach: st.approach, levels: st.levels,
      slabs: [], guards: [], rule: RULE,
      roof: { access: access, why: access ? null : why, y: rTop, coverage: +cov.toFixed(3),
        walk: null, bulkhead: null, door: null, parapets: [], solids: [] },
    };
    const landingAt = function (L) { for (const l of P.landings) if (Math.abs(l.L - L) < 1e-6) return l; return null; };
    P.landingAt = landingAt;

    // THE SLABS: every upper floor and the roof, the room minus the strip;
    // a roof nobody climbs to closes over the strip too
    for (let L = 1; L <= storeys; L++) {
      P.slabs.push({ L: L, y: L * FH, x0: sEdge, x1: ixMax, z0: izMin, z1: izMax, part: "room" });
      if (L === storeys && !access) P.slabs.push({ L: L, y: L * FH, x0: ixMin, x1: sEdge, z0: izMin, z1: izMax, part: "strip" });
    }

    // THE GUARDS (height-gated colliders):
    //  • the stairwell knee wall along every upper floor's edge, open only
    //    where that floor's landing meets it;
    //  • a guard along a half landing's room side (dog-leg: it stands in
    //    mid-air over the storey below);
    //  • the rail on each flight's open side, stepped with the pitch, so
    //    nobody steps off one flight onto the one beside it.
    const knee = function (L, z0, z1, kind, yAt) {
      if (z1 - z0 < 0.1) return;
      const y = yAt != null ? yAt : L * FH;
      P.guards.push({ kind: kind || "knee", L: L, x0: sEdge, x1: sEdge + 0.1, z0: z0, z1: z1, y0: y, y1: y + RULE.guard + 0.04 });
    };
    const kneeTop = access ? storeys : storeys - 1;
    for (let L = 1; L <= kneeTop; L++) {
      if (L === storeys) continue;                      // the roof: the bulkhead's front wall is the guard
      const lg = landingAt(L);
      if (!lg) knee(L, izMin, izMax);
      else if (lg.z0 <= izMin + 0.01) knee(L, lg.z1 + 0.05, izMax); else knee(L, izMin, lg.z0 - 0.05);
    }
    // THE TOP LANDING'S OPEN SIDE. Every other landing has a flight leaving
    // from each lane at its inner edge; the stair's last landing (the top
    // floor's, or the roof's inside the bulkhead) only the one that arrived,
    // so over the other lane its edge is the well, down to the flight below
    if (P.flights.length) {
      const F = P.flights[P.flights.length - 1], lg = landingAt(F.L1);
      if (lg) {
        const lx0 = ixMin + (F.lane === 0 ? 1 : 0) * LANE;
        const ze = F.dir > 0 ? lg.z0 : lg.z1;
        P.guards.push({ kind: "well", L: lg.L, x0: lx0, x1: lx0 + LANE, z0: ze - 0.05, z1: ze + 0.05, y0: lg.y, y1: lg.y + RULE.guard + 0.04 });
      }
    }
    for (const lg of P.landings) if (lg.L % 1 !== 0) knee(lg.L, lg.z0, lg.z1, "half", lg.y);
    for (const F of P.flights) {
      // the open sides: lane 0 has the building's wall on its -x side and the
      // other lane on its +x side; lane 1 has lane 0 on one side and the
      // room (the slab edge, a storey of air over the floor below) on the other
      F.open = F.lane === 0 ? [F.x1] : [F.x0, F.x1];
      const n = Math.max(2, Math.ceil(Math.abs(F.zt - F.zb) / 0.5));
      for (const xr of F.open) for (let i = 0; i < n; i++) {
        const za = F.zb + (F.zt - F.zb) * i / n, zc = F.zb + (F.zt - F.zb) * (i + 1) / n;
        const ya = F.yb + (F.yt - F.yb) * i / n, yc = F.yb + (F.yt - F.yb) * (i + 1) / n;
        P.guards.push({ kind: "rail", L: F.L0, flight: F.k, x0: xr - 0.04, x1: xr + 0.04, z0: Math.min(za, zc), z1: Math.max(za, zc),
          y0: ya + F.rise * 0.5, y1: yc + RULE.guard });
      }
    }

    // THE ROOF
    const R = P.roof;
    if (access) {
      R.walk = { x0: sEdge, x1: ixMax, z0: izMin, z1: izMax, y: rTop };
      R.door = door;
      R.bulkhead = {
        x0: -w / 2, x1: bx1, z0: -d / 2, z1: d / 2, y0: rTop, y1: rTop + BH, doorH: DOOR_H,
        walls: [
          { x0: -w / 2, x1: -w / 2 + WT, z0: -d / 2, z1: d / 2, y0: rTop, y1: rTop + BH, solid: true },
          { x0: -w / 2 + WT, x1: bx1, z0: -d / 2, z1: -d / 2 + WT, y0: rTop, y1: rTop + BH, solid: true },
          { x0: -w / 2 + WT, x1: bx1, z0: d / 2 - WT, z1: d / 2, y0: rTop, y1: rTop + BH, solid: true },
          { x0: sEdge, x1: bx1, z0: izMin, z1: door.z0, y0: rTop, y1: rTop + BH, solid: true },
          { x0: sEdge, x1: bx1, z0: door.z1, z1: izMax, y0: rTop, y1: rTop + BH, solid: true },
          { x0: sEdge, x1: bx1, z0: door.z0, z1: door.z1, y0: rTop + DOOR_H, y1: rTop + BH, solid: false },
        ],
      };
      // the parapet over the slab; the bulkhead closes the strip's edges
      R.parapets.push({ x0: sEdge, x1: w / 2, z0: d / 2 - WT, z1: d / 2 });
      R.parapets.push({ x0: w / 2 - WT, x1: w / 2, z0: -d / 2 + WT, z1: d / 2 - WT });
      R.parapets.push({ x0: sEdge, x1: w / 2, z0: -d / 2, z1: -d / 2 + WT });
      // every crown piece in head height over the walkable roof is solid
      for (const c of head) {
        const x0 = Math.max(c[0], sEdge), x1 = Math.min(c[1], ixMax), z0 = Math.max(c[4], izMin), z1 = Math.min(c[5], izMax);
        if (x1 - x0 > 0.02 && z1 - z0 > 0.02) R.solids.push({ x0: x0, x1: x1, z0: z0, z1: z1, y0: Math.max(rTop, c[2]), y1: c[3] });
      }
    } else {
      // nobody walks this roof, but it is still closed and edged (debris and
      // a body thrown up there land on something)
      R.parapets.push({ x0: -w / 2 + WT, x1: w / 2, z0: d / 2 - WT, z1: d / 2 });
      R.parapets.push({ x0: w / 2 - WT, x1: w / 2, z0: -d / 2 + WT, z1: d / 2 - WT });
      R.parapets.push({ x0: -w / 2 + WT, x1: w / 2, z0: -d / 2, z1: -d / 2 + WT });
      R.parapets.push({ x0: -w / 2, x1: -w / 2 + WT, z0: -d / 2, z1: d / 2 });
    }
    for (const p of R.parapets) { p.y0 = rTop; p.y1 = rTop + PPH + 0.06; }
    return P;
  }

  /* ---- A LIFT TOWER'S ROOF --------------------------------------------
     o: {w, d, tw, realH, s (shaft half-size), crown, roofStop (the lift
     stops at the shell roof)}. The ring slab round the shaft is the walk;
     the roof edge had NO collider at all (the walls stop at the roof and
     the grammar's parapet is deco), so a 51 m tower's roof was a step off
     into the street. Now a parapet stands on the wall line round the whole
     roof, and every crown piece in head height over the ring is solid. */
  function towerRoof(o) {
    const w = o.w, d = o.d, TW = o.tw, H = o.realH, s = o.s;
    const iw = w / 2 - TW, id = d / 2 - TW;
    const R = { access: !!o.roofStop, y: H, walk: null, parapets: [], solids: [] };
    if (!R.access) return R;
    R.walk = [
      { x0: -iw, x1: iw, z0: -id, z1: -s }, { x0: -iw, x1: iw, z0: s, z1: id },
      { x0: -iw, x1: -s, z0: -s, z1: s }, { x0: s, x1: iw, z0: -s, z1: s },
    ];
    const y1 = H + 0.1 + 1.05;
    R.parapets.push({ x0: -w / 2, x1: w / 2, z0: d / 2 - TW, z1: d / 2, y0: H, y1: y1 });
    R.parapets.push({ x0: -w / 2, x1: w / 2, z0: -d / 2, z1: -d / 2 + TW, y0: H, y1: y1 });
    R.parapets.push({ x0: -w / 2, x1: -w / 2 + TW, z0: -d / 2 + TW, z1: d / 2 - TW, y0: H, y1: y1 });
    R.parapets.push({ x0: w / 2 - TW, x1: w / 2, z0: -d / 2 + TW, z1: d / 2 - TW, y0: H, y1: y1 });
    for (const c of inHeadSpace(o.crown || [], H + 0.1)) {
      for (const r of R.walk) {
        const x0 = Math.max(c[0], r.x0), x1 = Math.min(c[1], r.x1), z0 = Math.max(c[4], r.z0), z1 = Math.min(c[5], r.z1);
        if (x1 - x0 > 0.02 && z1 - z0 > 0.02) R.solids.push({ x0: x0, x1: x1, z0: z0, z1: z1, y0: Math.max(H + 0.1, c[2]), y1: c[3] });
      }
    }
    return R;
  }

  CBZ.islandBuilding = {
    FH: FH, WT: WT, SW: SW, LANE: LANE, DOORW: DOORW, FLOOR0: FLOOR0, PPH: PPH, BH: BH, BXT: BXT, DOOR_H: DOOR_H, APRON: APRON,
    RULE: RULE, shadeHex: shadeHex, facadeCtx: facadeCtx, stairPlan: stairPlan, plan: plan, towerRoof: towerRoof,
  };
})();
