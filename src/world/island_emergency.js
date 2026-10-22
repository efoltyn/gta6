/* ============================================================
   world/island_emergency.js — THE ISLANDS' FIRE STATION AND HOSPITAL.

   Every town island has its emergency services (world/island_plan.js
   lot.use "firestation" and "hospital"). Gang City's response runs on the
   islands as it is (city/traffic.js's fire truck and ambulance,
   city/morgue.js deciding which bodies, city/medics.js's crew walking out
   of the back of the van): this file is where those units come FROM, and
   the rooms behind the doors they roll out of.

     THE FIRE STATION  its ground floor is the engine bay's crew side: red
                       floor lines, the turnout gear on its hooks (coats,
                       trousers in their boots, helmets on the shelf), the
                       hose rack, the brass pole down from upstairs in its
                       railed well, the watch desk with the duty firefighter
                       at it (day and night), the station's name
     THE HOSPITAL      the emergency department's front: the triage desk and
                       the nurse at it (round the clock), rows of waiting
                       chairs, a trolley, curtained bays across the back with
                       a bed in each, the hospital's name
   A unit dispatched on an island (city/traffic.js spawnEmergency) asks
   station(kind) for the door it pulls out of, and drives the island's
   streets from there.

   THE UNIT AT ITS STATION: each stands its own vehicle (the fire truck, the
   ambulance: city/traffic.js CBZ.cityEmergencyPark, a real enterable car)
   in its bay: nose out on the forecourt when the lot has one, else at the
   kerb in front of the door. A call takes that one out
   (traffic.js spawnEmergency); a new one is stood in the bay, where nobody
   is looking, once it has gone.

   API: CBZ.islandEmergency = { station(kind "fire" | "ambulance") ->
        { x, z, b } (the door, on the island in force) | null, list() }
   ============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ = window.CBZ || {};
  if (!window.THREE) return;

  const RED = 0xa32121, STEEL = 0x8a9096, DARK = 0x22252a, WHITE = 0xeeeeea, TAN = 0x9a8452, YEL = 0xd8c040;
  const stations = [];          // { b, kind: "fire" | "ambulance" }

  function active() { const A = CBZ.surv && CBZ.surv.arena; return A && A.island ? A : null; }
  function under(o, root) { for (let p = o; p; p = p.parent) if (p === root) return true; return false; }

  /* ---- THE FIRE STATION ---------------------------------------------------- */
  function fitFire(b, lot, job) {
    const IV = CBZ.islandVenue, FIT = CBZ.islandFit;
    if (!IV || !FIT || !b.interior || !b.group) return null;
    IV.clear(b, 0);
    const R = FIT.room(b, 0);
    const W = R.x1 - R.x0, D = R.z1 - R.z0;
    if (W < 4 || D < 5.5) return null;
    const F = IV.floor(b, 0), y = F.yLocal + 0.012, ceil = FIT.ceil(b, 0);
    const K = FIT.kit(b, { name: "firestation" });
    // the sealed concrete, its painted lines
    K.lbox((R.x0 + R.x1) / 2, y - 0.006, (R.z0 + R.z1) / 2, W, 0.012, D, 0x8c8a84, { nb: true });
    for (const x of [R.x0 + 1.2, R.x1 - 1.2]) K.lbox(x, y + 0.001, (R.z0 + R.z1) / 2, 0.1, 0.002, D - 0.6, RED, { nb: true });
    K.lbox((R.x0 + R.x1) / 2, y + 0.001, R.z0 + 2.5, W - 2.4, 0.002, 0.1, YEL, { nb: true });
    // THE TURNOUT GEAR down the +x wall: a rack of hooks, coat over trousers
    // in boots, a helmet on the shelf above each
    const n = Math.max(2, Math.min(8, Math.floor((D - 4.2) / 0.62)));
    const gz0 = R.z0 + 3.0;
    K.lbox(R.x1 - 0.05, y + 1.75, gz0 + n * 0.31, 0.06, 0.06, n * 0.62, STEEL);
    K.lbox(R.x1 - 0.2, y + 2.05, gz0 + n * 0.31, 0.36, 0.03, n * 0.62, STEEL);
    for (let i = 0; i < n; i++) {
      const z = gz0 + 0.31 + i * 0.62;
      K.lbox(R.x1 - 0.22, y + 0.13, z, 0.3, 0.26, 0.34, 0x1a1a1a);            // boots
      K.lbox(R.x1 - 0.22, y + 0.6, z, 0.26, 0.7, 0.4, TAN);                    // trousers up in them
      K.lbox(R.x1 - 0.2, y + 1.3, z, 0.3, 0.8, 0.5, TAN);                      // the coat on its hook
      K.lbox(R.x1 - 0.355, y + 1.12, z, 0.005, 0.05, 0.48, 0xd8e070);           // its reflective band
      K.lbox(R.x1 - 0.355, y + 1.42, z, 0.005, 0.05, 0.48, 0xd8e070);
      K.lbox(R.x1 - 0.2, y + 2.16, z, 0.28, 0.16, 0.3, i % 3 === 0 ? WHITE : 0x1a1a1a);   // the helmet
    }
    K.lbox(R.x1 - 0.22, y + 1.1, gz0 + n * 0.31, 0.44, 2.2, n * 0.62, 0x000000, { solid: true, noVis: true });
    // THE HOSE RACK on the -x wall, by the door
    const hz = R.z0 + 3.2;
    K.lbox(R.x0 + 0.06, y + 1.3, hz + 0.7, 0.04, 1.8, 1.5, STEEL);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const zz = hz + 0.3 + j * 0.8, yy = y + 0.65 + i * 0.55;
      K.lbox(R.x0 + 0.2, yy, zz, 0.26, 0.44, 0.44, i === 2 ? 0xc8b88a : RED);
      K.lbox(R.x0 + 0.34, yy, zz, 0.01, 0.16, 0.16, 0x6a6a6a);
    }
    K.lbox(R.x0 + 0.25, y + 0.3, hz + 0.7, 0.4, 0.6, 1.5, 0x000000, { solid: true, noVis: true });
    // THE POLE in its railed well, back corner
    const px = R.x0 + 1.1, pz = R.z1 - 1.1;
    K.lbox(px, (y + ceil) / 2, pz, 0.07, ceil - y, 0.07, 0xc9a44a);
    K.lbox(px, y + 0.03, pz, 0.9, 0.06, 0.9, 0x2a2a2a);
    for (const s of [-1, 1]) K.lbox(px + s * 0.6, y + 0.5, pz, 0.04, 1.0, 1.2, STEEL);
    K.lbox(px, y + 1.0, pz - 0.6, 1.2, 0.04, 0.04, STEEL);
    K.lbox(px, y + 0.5, pz, 1.24, 1.0, 1.24, 0x000000, { solid: true, noVis: true });
    // THE WATCH DESK, the duty firefighter at it, the board behind him
    const dx = (R.x0 + R.x1) / 2 + 0.4, dz = R.z1 - 1.3;
    K.lbox(dx, y + 0.5, dz, 1.8, 1.0, 0.7, 0x5a5f66, { solid: true });
    K.lbox(dx, y + 1.02, dz, 1.9, 0.04, 0.8, 0xd8d4ca);
    K.lbox(dx - 0.5, y + 1.22, dz + 0.1, 0.4, 0.3, 0.04, 0x111214);
    K.lbox(dx - 0.5, y + 1.22, dz + 0.075, 0.36, 0.26, 0.005, 0x1c3a4e, { glow: true });
    K.lbox(dx, y + 1.7, R.z1 - 0.03, 2.0, 1.0, 0.03, 0xeeeeea);
    K.lbox(dx, y + 2.22, R.z1 - 0.045, 2.0, 0.08, 0.01, RED);
    if (b.name && FIT.text && FIT.panel) {
      const tex = FIT.text([b.name.toUpperCase()], { bg: "#7a1616", fg: "#f2eee6", w: 512, h: 96, border: false });
      if (tex) FIT.panel(b, null, dx, ceil - 0.3, R.z1 - 0.05, 2.0, 0.38, Math.PI, tex, false);
    }
    K.flush();
    if (IV.claim) IV.claim(b, 0, { x0: R.x0, x1: R.x1, z0: R.z0 + 2.4, z1: R.z1 });
    if (IV.staff) {
      IV.staff(b, dx, dz + 0.65, Math.PI, { job: "firefighter", hours: [7, 19], near: 120, dress: { archetype: "worker", job: "firefighter" } });
      IV.staff(b, dx, dz + 0.65, Math.PI, { job: "firefighter", hours: [19, 7], near: 120, dress: { archetype: "worker", job: "firefighter" } });
    }
    const st = { b: b, kind: "fire", unit: null, bay: null };
    stations.push(st);
    return function () { dropUnit(st); const i = stations.indexOf(st); if (i >= 0) stations.splice(i, 1); };
  }

  /* ---- THE HOSPITAL -------------------------------------------------------- */
  function fitHospital(b, lot, job) {
    const IV = CBZ.islandVenue, FIT = CBZ.islandFit;
    if (!IV || !FIT || !b.interior || !b.group) return null;
    IV.clear(b, 0);
    const R = FIT.room(b, 0);
    const W = R.x1 - R.x0, D = R.z1 - R.z0;
    if (W < 4 || D < 6) return null;
    const F = IV.floor(b, 0), y = F.yLocal + 0.012, ceil = FIT.ceil(b, 0);
    const K = FIT.kit(b, { name: "hospital" });
    // the vinyl floor, its wayfinding line to the triage desk
    K.lbox((R.x0 + R.x1) / 2, y - 0.006, (R.z0 + R.z1) / 2, W, 0.012, D, 0xc9cfc8, { nb: true });
    K.lbox(R.x1 - 1.5, y + 0.001, (R.z0 + R.z1) / 2, 0.12, 0.002, D - 1.0, 0x2a6a9a, { nb: true });
    // THE TRIAGE DESK on the +x side a third of the way in, the nurse behind it
    const tz = R.z0 + Math.min(4.2, D * 0.38), tx = R.x1 - 0.95;
    K.lbox(tx - 0.45, y + 0.55, tz, 0.6, 1.1, 2.0, 0xe8e6e0, { solid: true });
    K.lbox(tx - 0.47, y + 1.12, tz, 0.72, 0.04, 2.1, 0x9aa8b0);
    K.lbox(tx - 0.2, y + 1.3, tz - 0.5, 0.04, 0.3, 0.42, 0x111214);
    K.lbox(tx - 0.225, y + 1.3, tz - 0.5, 0.005, 0.26, 0.38, 0x1c3a4e, { glow: true });
    // WAITING: rows of linked chairs down the -x side, facing the desk
    const rows = Math.max(1, Math.min(3, Math.floor((W - 3.4) / 1.3)));
    for (let r = 0; r < rows; r++) {
      const lx = R.x0 + 0.5 + r * 1.3;
      for (let z = R.z0 + 2.7; z < R.z1 - 3.4; z += 0.62) {
        if (r === 0 || ((z * 7) | 0) % 5 !== 0) K.furnish("chair", lx, z, y, Math.PI / 2, { tone: { cloth: 0x2a5a8a, frame: 0x6a7078 } });
      }
    }
    // THE BAYS across the back: a curtain rail, curtains half drawn, a bed in each
    const bayD = 2.6, bz0 = R.z1 - bayD;
    const nB = Math.max(1, Math.floor(W / 2.4));
    const bw = W / nB;
    K.lbox((R.x0 + R.x1) / 2, ceil - 0.15, bz0, W, 0.03, 0.03, STEEL);
    for (let i = 0; i < nB; i++) {
      const x0 = R.x0 + i * bw, xc = x0 + bw / 2;
      if (i > 0) K.lbox(x0, (y + ceil - 0.15) / 2 + 0.1, bz0 + bayD / 2, 0.02, ceil - 0.35 - y, bayD - 0.1, 0x6a9ab0);
      K.lbox(x0 + bw * 0.22, (y + ceil - 0.15) / 2 + 0.1, bz0, bw * 0.4, ceil - 0.35 - y, 0.02, 0x6a9ab0);
      K.furnish("bed", xc, bz0 + bayD / 2 + 0.1, y, Math.PI, { len: 1.95, wide: 0.9, tone: { cloth: 0xe8ecef, wood: 0x9aa0a6, frame: 0x9aa0a6 } });
      K.lbox(x0 + 0.3, y + 1.4, R.z1 - 0.06, 0.3, 0.24, 0.06, 0x111214);       // the monitor on the wall
      K.lbox(x0 + 0.3, y + 1.4, R.z1 - 0.095, 0.26, 0.2, 0.005, 0x1a4a2a, { glow: true });
    }
    // a trolley by the bays
    const gx = (R.x0 + R.x1) / 2 + 0.6, gz = bz0 - 1.0;
    K.lbox(gx, y + 0.8, gz, 0.62, 0.08, 1.9, 0xeeeeea);
    K.lbox(gx, y + 0.86, gz, 0.56, 0.06, 1.8, 0x7ab0c8);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.lbox(gx + sx * 0.25, y + 0.4, gz + sz * 0.8, 0.04, 0.8, 0.04, STEEL);
    K.lbox(gx, y + 0.45, gz, 0.66, 0.9, 1.95, 0x000000, { solid: true, noVis: true });
    if (b.name && FIT.text && FIT.panel) {
      const tex = FIT.text(["EMERGENCY", b.name.toUpperCase()], { bg: "#1f4e8a", fg: "#ffffff", w: 512, h: 128, border: false });
      if (tex) FIT.panel(b, null, R.x1 - 0.05, ceil - 0.45, tz, 1.8, 0.45, -Math.PI / 2, tex, false);
    }
    K.flush();
    if (IV.claim) IV.claim(b, 0, { x0: R.x0, x1: R.x1, z0: R.z0 + 2.4, z1: R.z1 });
    if (IV.staff) {
      IV.staff(b, tx + 0.25, tz, -Math.PI / 2, { job: "nurse", hours: [7, 19], near: 120, dress: { archetype: "worker", job: "nurse" } });
      IV.staff(b, tx + 0.25, tz, -Math.PI / 2, { job: "nurse", hours: [19, 7], near: 120, dress: { archetype: "worker", job: "nurse" } });
    }
    const st = { b: b, kind: "ambulance", unit: null, bay: null };
    stations.push(st);
    return function () { dropUnit(st); const i = stations.indexOf(st); if (i >= 0) stations.splice(i, 1); };
  }

  // the door the unit of that kind rolls out of, on the island in force
  function station(kind) {
    const A = active(), IV = CBZ.islandVenue;
    if (!A || !IV) return null;
    for (const st of stations) {
      if (st.kind !== kind || st.b.fallen || !st.b.group || !under(st.b.group, A.root)) continue;
      const L = IV.lotFor(st.b), d = L && L.building && L.building.door;
      if (d) return { x: d.x - d.nx * 2, z: d.z - d.nz * 2, b: st.b };
    }
    return null;
  }

  /* ---- THE BAY ------------------------------------------------------------ */
  function bayOf(st) {
    const IV = CBZ.islandVenue, A = active();
    const T = A && CBZ.islandTown ? CBZ.islandTown.of(A) : null;
    const L = IV.lotFor(st.b), d = L && L.building && L.building.door;
    if (!T || !d) return null;
    // the street the door faces (the road out along its normal)
    let road = null, dist = 1e9;
    for (const r of T.roads) {
      const along = r.vertical ? d.z - r.z : d.x - r.x;
      if (Math.abs(along) > r.len / 2 - 4) continue;
      if (r.vertical ? Math.abs(d.nx) < 0.7 : Math.abs(d.nz) < 0.7) continue;
      const off = r.vertical ? (r.x - d.x) * -d.nx : (r.z - d.z) * -d.nz;          // out from the door, to the road
      if (off > 0 && off < dist) { dist = off; road = r; }
    }
    if (!road) return null;
    const out = { x: -d.nx, z: -d.nz };
    if (dist - 5.5 >= 6.5) {
      // a forecourt: nose out to the street, its tail by the door
      const k = 1.2 + 3.0;
      return { x: d.x + out.x * k, z: d.z + out.z * k, heading: Math.atan2(out.x, out.z) };
    }
    // at the kerb in front of the door, in the lane on the station's side,
    // facing the way that lane runs (config.js roadLaneCenter: keep right)
    const sgn = road.vertical ? Math.sign(d.x - road.x) || 1 : Math.sign(d.z - road.z) || 1;
    const lc = CBZ.roadLaneCenter ? CBZ.roadLaneCenter(road, 1, 0) : 1.75;
    const dir = Math.sign(lc) === sgn ? 1 : -1;
    const lat = sgn * (3.5 * 0.5 + 0.25);
    const x = road.vertical ? road.x + lat : d.x, z = road.vertical ? d.z : road.z + lat;
    const heading = road.vertical ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    return { x: x, z: z, heading: heading };
  }
  function unseen(x, z) { return CBZ.leave && CBZ.leave.unseen ? CBZ.leave.unseen({ x: x, y: 1, z: z }) : true; }
  let tickT = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(36.8, function (dt) {
    const g = CBZ.game;
    if (!g || g.mode !== "archipelago" || g.state !== "playing" || !CBZ.cityEmergencyPark) return;
    tickT -= dt;
    if (tickT > 0) return;
    tickT = 1.5;
    const A = active(), P = CBZ.player && CBZ.player.pos;
    if (!A || !P) return;
    const parkedNow = CBZ.cityEmergencyParked ? CBZ.cityEmergencyParked() : [];
    for (const st of stations) {
      if (st.b.fallen || !st.b.group || !under(st.b.group, A.root)) continue;
      const u = st.unit;
      // it rolled out, was taken or was wrecked: the bay is empty
      if (u && parkedNow.indexOf(u) < 0) st.unit = null;
      if (st.unit) continue;
      if (!st.bay) st.bay = bayOf(st);
      const B = st.bay;
      if (!B || Math.hypot(B.x - P.x, B.z - P.z) < 30 || !unseen(B.x, B.z)) continue;
      if (CBZ.queryCollidersNear) {
        const hit = (CBZ.queryCollidersNear(B.x, B.z, 2.6, []) || []).some(function (c) { return c && c.y1 > (st.b.gy || 0) + 0.5 && !c.noCam; });
        if (hit) continue;
      }
      for (const c of CBZ.cityCars || []) if (c && Math.hypot(c.pos.x - B.x, c.pos.z - B.z) < 4) { st.blocked = true; break; }
      if (st.blocked) { st.blocked = false; continue; }
      st.unit = CBZ.cityEmergencyPark(st.kind === "fire" ? "firetruck" : "ambulance", B.x, B.z, B.heading);
    }
  });
  function dropUnit(st) { if (st.unit && CBZ.cityEmergencyUnpark) CBZ.cityEmergencyUnpark(st.unit); st.unit = null; }

  CBZ.islandEmergency = {
    station: station,
    list: function () { return stations.map(function (s) { return { kind: s.kind, name: s.b.name || null, x: Math.round(s.b.x), z: Math.round(s.b.z), parked: !!s.unit, bay: s.bay }; }); },
  };
  if (CBZ.islandVenue && CBZ.islandVenue.on) {
    CBZ.islandVenue.on("firestation", fitFire);
    CBZ.islandVenue.on("hospital", fitHospital);
  }
})();
