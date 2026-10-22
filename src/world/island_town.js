/* ============================================================
   world/island_town.js — THE ISLAND AS A GANG-CITY STREET.

   Gang City's traffic (city/vehicles.js, city/traffic.js), its police
   (city/police.js) and its wanted law (city/wanted.js) all read one
   thing: the city's arena, a record with a road list, a root to hang
   bodies on and a handful of street questions. The islands of the
   archipelago (world/archipelago.js) have streets too (world/island_roads.js
   lays them; the island publishes them as CBZ.island.roads), but in their
   own shape. This file is the adapter between the two, so those systems
   run on the island in force instead of growing island copies of
   themselves:

     CBZ.econArena()       the arena the economy's street systems run on:
                           Gang City's in "city", the active island's
                           TOWN (below) in "archipelago", else null.
     CBZ.islandTown.of(A)  the town of island arena A, built once and kept
                           on A (data only: it goes with the island).
       roads               the island's streets in the city's road record
                           shape { vertical, x, z, len, w, lanesPerDir,
                           laneW, district, speedLimit }: one record per
                           straight run of a street line (pieces joined
                           across their junction squares, so a crossing is
                           a crossing to city/roadrules.js's junction
                           finder); keep right on one 3.5 m lane each way,
                           exactly where the island paints them
       ROAD                7 (the carriageway's width)
       noGrid              true: no Gang-City signal grid, every junction
                           is a derived one (stop signs, no lights)
       minX..maxZ          the island's bounds
       root, island        the island's root group, CBZ.island's record
       randomRoadPoint() / copBeatPoint() / clampToCity(p, r) /
       nearestIntersection() (always null) / intersections ([]) /
       lots ([]) / shopLots ([]) / noSpawn ([])
     CBZ.islandTownDrop(A) an island is going away (archipelago.js drops
                           it, or the mode is left): every traffic car,
                           cruiser and officer standing on it leaves with it
                           (the island machines world/island_vehicles.js
                           owns are its own business).
     CBZ.islandTownForeign(o) a body or car that belongs to an island that
                           is not the one in force (city/traffic.js and
                           city/police.js send those home where nobody
                           sees them go).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const HW = 3.5;            // the island carriageway's half width (island_roads.js HW)
  const JOIN = 9;            // pieces on one line closer than this meet across a junction square
  const REACH_J = 6.5;       // a run end this close to a junction on its line ends AT the junction

  function lineKey(v, f) { return (v ? "v" : "h") + Math.round(f * 10); }

  function buildRoads(I) {
    const R = I && I.roads;
    if (!R || !R.pieces || !R.pieces.length) return [];
    const byLine = new Map();
    for (const p of R.pieces) {
      if (!(p.b > p.a)) continue;
      const k = lineKey(p.vertical, p.fixed);
      let L = byLine.get(k);
      if (!L) byLine.set(k, L = { vertical: !!p.vertical, fixed: p.fixed, runs: [] });
      L.runs.push([p.a, p.b]);
    }
    const J = R.junctions || [];
    const out = [];
    byLine.forEach(function (L) {
      L.runs.sort(function (u, v) { return u[0] - v[0]; });
      const merged = [];
      for (const r of L.runs) {
        const last = merged[merged.length - 1];
        if (last && r[0] - last[1] <= JOIN) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
      }
      for (const m of merged) {
        let a = m[0], b = m[1];
        // a run that stops at a junction square (a T, a bend) reaches its centre,
        // so the crossing record overlaps it and the junction is found
        for (const j of J) {
          const across = L.vertical ? j.x : j.z, along = L.vertical ? j.z : j.x;
          if (Math.abs(across - L.fixed) > 1.5) continue;
          if (Math.abs(along - a) < REACH_J) a = Math.min(a, along);
          if (Math.abs(along - b) < REACH_J) b = Math.max(b, along);
        }
        if (b - a < 12) continue;
        const c = (a + b) / 2;
        out.push({
          vertical: L.vertical,
          x: L.vertical ? L.fixed : c, z: L.vertical ? c : L.fixed,
          len: b - a, w: 2 * HW, lanesPerDir: 1, laneW: HW, median: false,
          district: "island", speedLimit: 25, _isle: true,
        });
      }
    });
    return out;
  }

  function makeTown(A) {
    const I = A.island || null;
    const roads = buildRoads(I);
    const B = I && I.bounds;
    const cx = A.center ? A.center.x : (I ? I.cx : 0), cz = A.center ? A.center.z : (I ? I.cz : 0);
    const Rr = A.radius || (I ? I.R : 240);
    let s = 0x51ab1e ^ ((cx * 7 + cz * 13) | 0);
    function rnd() { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; }
    function roadPoint(onWalk) {
      if (!roads.length) {
        const p = A.randomPoint ? A.randomPoint(10, Rr * 0.7) : { x: cx, z: cz };
        return { x: p.x, z: p.z, vertical: false };
      }
      // weighted by length: a long avenue is walked more than a stub
      let tot = 0; for (const r of roads) tot += r.len;
      let t = rnd() * tot, r = roads[0];
      for (const q of roads) { t -= q.len; if (t <= 0) { r = q; break; } }
      const along = (rnd() - 0.5) * r.len * 0.9;
      const side = rnd() < 0.5 ? -1 : 1;
      const lat = side * (onWalk ? HW + 1.0 : HW * 0.44);
      return r.vertical ? { x: r.x + lat, z: r.z + along, vertical: true } : { x: r.x + along, z: r.z + lat, vertical: false };
    }
    const T = {
      island: I, arena: A, root: A.root,
      roads: roads, ROAD: 2 * HW, noGrid: true,
      minX: B ? B.x0 : cx - Rr, maxX: B ? B.x1 : cx + Rr, minZ: B ? B.z0 : cz - Rr, maxZ: B ? B.z1 : cz + Rr,
      center: { x: cx, z: cz }, radius: Rr,
      intersections: [], lots: [], shopLots: [], noSpawn: [],
      nearestIntersection: function () { return null; },
      randomRoadPoint: function () { return roadPoint(false); },
      copBeatPoint: function () { return roadPoint(true); },
      randomSidewalkPoint: function () { return roadPoint(true); },
      // containment for autonomous bodies: the island and its beach, never the
      // player or the car he drives (the sea is his to cross)
      clampToCity: function (p, r) {
        const P = CBZ.player;
        if (!p || (P && (p === P.pos || (P._vehicle && p === P._vehicle.pos)))) return;
        const lim = Rr + 18 - (r || 0.6);
        const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
        if (d > lim && d > 0) { p.x = cx + dx / d * lim; p.z = cz + dz / d * lim; }
      },
      groundAt: function (x, z) { return A.groundHeightAt ? A.groundHeightAt(x, z) : 0; },
    };
    return T;
  }

  function of(A) {
    if (!A || !A.root) return null;
    if (A._town && A._town.arena === A) return A._town;
    A._town = makeTown(A);
    return A._town;
  }

  CBZ.islandTown = { of: of, buildRoads: buildRoads };

  CBZ.econArena = function () {
    const m = g && g.mode;
    if (m === "city") return (CBZ.city && CBZ.city.arena) || null;
    if (m === "archipelago") {
      const A = CBZ.surv && CBZ.surv.arena;
      return A && A.island ? of(A) : null;
    }
    return null;
  };

  // ---- WHO STANDS ON WHICH ISLAND --------------------------------------
  function under(o, root) {
    const grp = o && o.group;
    if (!grp || !root) return false;
    for (let p = grp.parent; p; p = p.parent) if (p === root) return true;
    return false;
  }
  CBZ.islandTownUnder = under;
  // on an island root that is not the island in force (or on none at all
  // while we are on the islands): somebody else's
  CBZ.islandTownForeign = function (o) {
    if (!o || g.mode !== "archipelago") return false;
    const A = CBZ.surv && CBZ.surv.arena;
    if (!A || !A.root) return false;
    return !under(o, A.root);
  };

  function scrapCarsUnder(root) {
    const cars = CBZ.cityCars || [];
    const P = CBZ.player;
    // world/island_vehicles.js's machines (the parked fleet, the boat) are its own business
    const IV = CBZ.islandVehicles, own = new Set();
    if (IV) { try { for (const c of IV.cars ? IV.cars() : []) own.add(c); for (const c of IV.boats ? IV.boats() : []) own.add(c); } catch (e) {} }
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i];
      if (!c || c._islandCar || c._persist || own.has(c)) continue;
      if (P && P._vehicle === c) continue;                        // the car he is in leaves with him
      if (root ? !under(c, root) : (c._world !== "archipelago")) continue;
      if (CBZ.cityScrapCar) { try { CBZ.cityScrapCar(c); } catch (e) {} }
    }
  }
  function dismissCopsUnder(root) {
    const cops = CBZ.cityCops || [];
    for (let i = cops.length - 1; i >= 0; i--) {
      const c = cops[i];
      if (!c || (root && !under(c, root))) continue;
      if (CBZ.cityDismissCop) { try { CBZ.cityDismissCop(c); } catch (e) {} }
    }
  }
  CBZ.islandTownDrop = function (A) {
    if (!A || !A.root) return;
    scrapCarsUnder(A.root);
    dismissCopsUnder(A.root);
    if (CBZ.islandPolice && CBZ.islandPolice.drop) { try { CBZ.islandPolice.drop(A); } catch (e) {} }
  };
  // leaving the islands: the whole island force and every island car goes
  CBZ.islandTownLeave = function () {
    scrapCarsUnder(null);
    if (CBZ.clearCityCops) { try { CBZ.clearCityCops(); } catch (e) {} }
    if (CBZ.cityWantedReset) { try { CBZ.cityWantedReset(); } catch (e) {} }
    if (CBZ.islandPolice && CBZ.islandPolice.drop) { try { CBZ.islandPolice.drop(null); } catch (e) {} }
  };
})();
