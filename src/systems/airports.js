/* ============================================================
   systems/airports.js — AN AIRPORT IS A RECORD, NOT A PLACE.

   OWNER, verbatim (2026-08-09): "package the airport so you can just
   duplicate and put it somewhere else easily without rewriting that code
   and put another airport in another city and then have planes actually go
   up to the runway, take off, land at the other airport … make it so you
   can buy a ticket and get on the plane."

   WHAT WAS ACTUALLY WRONG. `city/island_airport.js` is 3,977 lines and every
   one of them is authored in WORLD COORDINATES: `RWY_X0 = -850 + ADX`,
   `gateZ = APRON_Z - 14`, a terminal at `tz = 24`. It is a magnificent
   airfield and it is welded to one rectangle of the map. "Put another
   airport in another city" against that file means copying 4,000 lines and
   editing several hundred numbers — which is exactly the thing this repo's
   Block Law exists to forbid.

   Nothing about an airport actually needs world coordinates. A runway is a
   LENGTH and a WIDTH; a gate is "185 m along the field, 76 m off the
   centreline, nose out"; a hold-short bar is "at the threshold, 22 m from
   the edge". Those numbers are the same in Halloran Field and in a regional
   strip on the far side of the map. What differs is one origin and one
   bearing.

   SO THIS FILE OWNS THE FRAME AND ONLY THE FRAME:

     • THE LOCAL AIRFIELD FRAME. Origin = the runway MIDPOINT. Local +X runs
       down the runway (the low-numbered threshold is at -len/2). Local +Z is
       the apron side — taxiway, stands, terminal, kerb, in that order, at
       rising +Z. Every airfield in the game is authored in those numbers.
     • THE TRANSFORM. `ap.toWorld(lx,lz)` / `ap.toLocal(x,z)` rotate by the
       field's bearing and translate by its origin, using the SAME convention
       the shipped aircraft use for heading — a hull's forward vector is
       (cos h, 0, -sin h), which is three.js `rotation.y = h` applied to a
       model that noses down local +X. That is not a new convention: it is
       read off island_airport.js's own parked fleet (`heading = PI/2` puts
       the nose toward the runway, i.e. -Z). Because it matches, a LOCAL
       heading becomes a world heading by adding the field bearing, with no
       second mapping to get wrong.
     • THE DERIVED FACTS every consumer kept re-deriving: both thresholds,
       both touchdown zones, the hold-short points, the runway rectangle, the
       apron centre, the field's own AABB.

   WHAT THIS FILE DOES NOT OWN: geometry (city/airport_kit.js builds a field
   from a spec), flights (systems/airline.js flies between the records here),
   tickets (city/ticketing.js sells a seat on one). This is the table those
   three agree on, and it is the only place a coordinate is turned into a
   place.

   HALLORAN REGISTERS ITSELF. island_airport.js hands its OWN constants to
   `CBZ.registerAirport` at the bottom of its build — no copy of its layout
   lives here, and if the worldOff dial moves the island the record moves
   with it, because the record is built from the same variables the runway
   was drawn from.

   Flag: `AIRPORT_REGISTRY_V1=false` → `CBZ.airports` stays empty, every
   consumer's `if (!ap) return` fires, and the world is exactly the shipped
   one-airport world.
   Ratchet: `CBZ.airportAudit().malformed` pinned at 0.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.AIRPORT_REGISTRY_V1 == null) CFG.AIRPORT_REGISTRY_V1 = true;

  const airports = (CBZ.airports = CBZ.airports || []);
  const byId = Object.create(null);

  function num(v, d) { return Number.isFinite(+v) ? +v : d; }

  /* --------------------------------------------------------------
     THE FRAME. Rotation by the field bearing `yaw`, matching
     three.js rotation.y so a local heading is a world heading plus
     the bearing — see the header for why that identity matters.
     -------------------------------------------------------------- */
  function frame(ap) {
    const c = Math.cos(ap.yaw), s = Math.sin(ap.yaw);
    ap._c = c; ap._s = s;
    ap.toWorld = function (lx, lz) {
      return { x: ap.x + lx * c + lz * s, z: ap.z - lx * s + lz * c };
    };
    ap.toLocal = function (wx, wz) {
      const dx = wx - ap.x, dz = wz - ap.z;
      return { lx: dx * c - dz * s, lz: dx * s + dz * c };
    };
    // a direction, not a point: no translation.
    ap.dirWorld = function (lh) { return lh + ap.yaw; };
    return ap;
  }

  /* --------------------------------------------------------------
     REGISTER. Everything optional has a default that describes a
     small, honest regional field, so a caller that knows only
     "where and which way" still gets a complete record.
     -------------------------------------------------------------- */
  CBZ.registerAirport = function (spec) {
    if (!spec || CFG.AIRPORT_REGISTRY_V1 === false) return null;
    const id = String(spec.id || "").trim();
    if (!id) return null;
    if (byId[id]) {                       // a world rebuild re-registers: replace, never double
      const i = airports.indexOf(byId[id]);
      if (i >= 0) airports.splice(i, 1);
      delete byId[id];
    }
    const rw = spec.runway || {};
    const ap = {
      id: id,
      name: spec.name || id,
      code: (spec.code || id.slice(0, 3)).toUpperCase(),
      city: spec.city || null,             // which town this field serves (label only)
      x: num(spec.x, 0), z: num(spec.z, 0), y: num(spec.y, 0),
      yaw: num(spec.yaw, 0),
      // the runway, in metres. `len` is threshold to threshold.
      runway: {
        len: Math.max(200, num(rw.len, 900)),
        w: Math.max(12, num(rw.w, 30)),
        // displaced threshold / touchdown zone: where a landing aeroplane
        // actually puts its wheels down, measured in from each end.
        tdz: Math.max(30, num(rw.tdz, 180)),
      },
      // LOCAL layout numbers every kit and every flight agrees on.
      // WHERE THE RUNWAY IS REACHABLE FROM. Local x positions at which
      // pavement actually crosses between the taxiway and the runway. A
      // taxiing aeroplane may only change surfaces here, which is what stops
      // it cutting a corner over 50 m of grass — and it is per-field, because
      // Halloran's two connectors are where its builder drew them and the kit
      // draws three of its own.
      connectors: Array.isArray(spec.connectors) && spec.connectors.length
        ? spec.connectors.slice() : null,
      taxiZ: num(spec.taxiZ, 50),          // parallel taxiway centreline
      apronZ: num(spec.apronZ, 90),        // ramp centreline
      standZ: num(spec.standZ, 76),        // where a parked hull's origin sits
      termZ: num(spec.termZ, 114),         // terminal centre
      kerbZ: num(spec.kerbZ, 128),         // landside kerb
      gates: [],
      desk: null,
      bounds: null,
      builtBy: spec.builtBy || null,
      hub: !!spec.hub,
    };
    frame(ap);

    // ---- gates (local) -> a record that also carries its world pose ------
    const gs = Array.isArray(spec.gates) ? spec.gates : [];
    for (let i = 0; i < gs.length; i++) {
      const g = gs[i] || {};
      const lx = num(g.lx, 0), lz = num(g.lz, ap.standZ);
      const lh = num(g.heading, -Math.PI / 2);   // default: nose out toward the runway (-Z local)
      const w = ap.toWorld(lx, lz);
      ap.gates.push({
        id: g.id || (ap.code + "-" + (i + 1)),
        lx: lx, lz: lz, heading: lh,
        x: w.x, z: w.z, worldHeading: ap.dirWorld(lh),
        size: g.size || "airliner",
        occupant: null,                    // an airline flight parks here
      });
    }

    // ---- the ticket desk (local) ----------------------------------------
    if (spec.desk) {
      const d = spec.desk;
      const w = ap.toWorld(num(d.lx, 0), num(d.lz, ap.termZ));
      ap.desk = {
        lx: num(d.lx, 0), lz: num(d.lz, ap.termZ),
        x: w.x, z: w.z,
        heading: ap.dirWorld(num(d.heading, Math.PI)),
        label: d.label || "Check-in",
      };
    }

    // ---- derived world facts --------------------------------------------
    const H = ap.runway.len / 2;
    /* THRESHOLDS. Runway designators are the bearing over ten, so they have to
       come out of the world's own compass rather than out of the yaw directly.
       This world's north is +Z (island_airport.js: the terminal doors face +z
       and it says NORTH), and a heading's forward vector is (cos h, 0, -sin h)
       — so h=0 is +X, which is EAST, 090. Hence the +90.

       This is checkable rather than assumed: Halloran registers at yaw 0 and
       its own runway PAINT, drawn years before this file existed, reads 09/27.
       The first version omitted the +90 and called it 36/18, which is a HUD
       that contradicts the tarmac under your wheels. Any field may still
       override with `designators` if its paint says something else. */
    const degLow = ((90 + ap.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const numLow = Math.max(1, Math.round(degLow / 10) || 36);
    const numHigh = ((numLow + 18 - 1) % 36) + 1;
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    const dz = Array.isArray(spec.designators) && spec.designators.length === 2 ? spec.designators : null;
    const e0 = ap.toWorld(-H, 0), e1 = ap.toWorld(H, 0);
    const t0 = ap.toWorld(-H + ap.runway.tdz, 0), t1 = ap.toWorld(H - ap.runway.tdz, 0);
    // hold-short: abeam each threshold, out on the parallel taxiway.
    const h0 = ap.toWorld(-H + 40, ap.taxiZ), h1 = ap.toWorld(H - 40, ap.taxiZ);
    /* `dir` is the world heading you fly when departing from THIS end.
       `sign` IS THE SIGN OF THE THRESHOLD'S OWN LOCAL X, and nothing else —
       so a caller writes `sign * (H - 25)` for "just inside this threshold"
       and `-sign * (H - 20)` for "the far end", and both read as what they
       are. The first draft made it the sign of the departure DIRECTION, which
       is the opposite for both ends and lines an aeroplane up at the wrong
       threshold facing off the end of the runway. */
    ap.ends = [
      { name: dz ? dz[0] : pad(numLow), x: e0.x, z: e0.z, dir: ap.yaw, tdz: t0, hold: h0, sign: -1 },
      { name: dz ? dz[1] : pad(numHigh), x: e1.x, z: e1.z, dir: ap.yaw + Math.PI, tdz: t1, hold: h1, sign: 1 },
    ];
    ap.runwayName = ap.ends[0].name + "/" + ap.ends[1].name;
    if (!ap.connectors) ap.connectors = [-H + 45, 0, H - 45];
    const apr = ap.toWorld(0, ap.apronZ);
    ap.apron = { x: apr.x, z: apr.z };
    // field AABB: the union of the runway strip and everything landside of it,
    // padded. Consumers use it for "am I at an airport" and for the map.
    const corners = [
      ap.toWorld(-H - 60, -60), ap.toWorld(H + 60, -60),
      ap.toWorld(-H - 60, ap.kerbZ + 40), ap.toWorld(H + 60, ap.kerbZ + 40),
    ];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of corners) {
      if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x;
      if (c.z < minZ) minZ = c.z; if (c.z > maxZ) maxZ = c.z;
    }
    ap.bounds = spec.bounds || { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ };

    airports.push(ap);
    byId[id] = ap;
    return ap;
  };

  CBZ.airportById = function (id) { return byId[id] || null; };

  CBZ.airportNearest = function (x, z, maxD) {
    let best = null, bd = maxD != null ? maxD * maxD : Infinity;
    for (let i = 0; i < airports.length; i++) {
      const a = airports[i];
      const dx = a.x - x, dz = a.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = a; }
    }
    return best;
  };

  // Every OTHER field — the destination list a ticket desk offers.
  CBZ.airportOthers = function (ap) {
    const out = [];
    for (let i = 0; i < airports.length; i++) if (airports[i] !== ap) out.push(airports[i]);
    return out;
  };

  // WHICH END do you use? The one whose departure direction points most
  // nearly at where you are going — a real one-runway field's whole
  // decision, minus the wind we do not simulate.
  CBZ.airportEndToward = function (ap, tx, tz) {
    if (!ap) return null;
    const dx = tx - ap.x, dz = tz - ap.z;
    const want = Math.atan2(-dz, dx);
    let best = ap.ends[0], bd = -2;
    for (let i = 0; i < ap.ends.length; i++) {
      const d = Math.cos(ap.ends[i].dir - want);
      if (d > bd) { bd = d; best = ap.ends[i]; }
    }
    return best;
  };

  // The free stand at a field, or null when the ramp is full.
  CBZ.airportFreeGate = function (ap, holder) {
    if (!ap) return null;
    for (let i = 0; i < ap.gates.length; i++) {
      const g = ap.gates[i];
      if (!g.occupant || g.occupant === holder) return g;
    }
    return null;
  };

  CBZ.airportDistance = function (a, b) {
    if (!a || !b) return 0;
    const dx = b.x - a.x, dz = b.z - a.z;
    return Math.sqrt(dx * dx + dz * dz);
  };

  // A world rebuild re-runs every landmass builder; the fields re-register
  // themselves, so the table has to start empty or the second build doubles it.
  CBZ.airportRegistryReset = function () {
    airports.length = 0;
    for (const k in byId) delete byId[k];
  };

  /* --------------------------------------------------------------
     THE RATCHET. `malformed` counts records that cannot be flown:
     no runway, a frame that does not round-trip, or a gate that
     does not sit on the field it claims. Pinned at 0.
     -------------------------------------------------------------- */
  CBZ.airportAudit = function () {
    let malformed = 0, gates = 0, desks = 0;
    const rows = [];
    for (let i = 0; i < airports.length; i++) {
      const a = airports[i];
      let bad = 0;
      if (!(a.runway.len > 200) || !(a.runway.w > 10)) bad++;
      // frame round-trip: a point 100 m down the field must come back as 100.
      const w = a.toWorld(100, 40), l = a.toLocal(w.x, w.z);
      if (Math.abs(l.lx - 100) > 1e-6 || Math.abs(l.lz - 40) > 1e-6) bad++;
      if (a.ends.length !== 2) bad++;
      for (let k = 0; k < a.gates.length; k++) {
        const g = a.gates[k];
        gates++;
        if (g.x < a.bounds.minX - 1 || g.x > a.bounds.maxX + 1 ||
            g.z < a.bounds.minZ - 1 || g.z > a.bounds.maxZ + 1) bad++;
      }
      if (a.desk) desks++;
      if (bad) malformed++;
      rows.push({ id: a.id, code: a.code, runway: a.runwayName, len: a.runway.len, gates: a.gates.length, bad: bad });
    }
    return { count: airports.length, gates: gates, desks: desks, malformed: malformed, rows: rows };
  };
})();
