/* ============================================================
   city/casino.js — REAL CASINOS (owner: "Casino should be a real
   building, there should be many. No bullshit fake shit.").

   Every casino LOT in the world becomes a gaming house:
     • EXTERIOR: a framed marquee over the door ringed with bulbs, and a
       mast sign beside the entrance (a lit sign glows; its frame and pole
       do not). One mast collider.
     • INTERIOR (2026-09-27 de-slop, the room was felt-coloured boxes on
       brown boxes, 0.4 m cube "stools" and slot "cabinets" that were a dark
       box with a gold slab): blackjack tables (kidney felt top, padded
       leather rail, dealer's chip tray and shoe, betting spots, cards) and
       roulette tables (wheel bowl with pockets and turret, layout grid,
       padded rail), each ringed by real casino stools; slot machines with
       a cabinet, a lit screen in a bezel, a raked button deck, a topper and
       a stool; a bar (back bar with bottles from club.js's venue fixtures);
       the cashier cage dressed on the room's counter: brass bars, glass,
       windows. Lamps over each table hang from the fit-out ceiling.
     • INTERACTION: walking up to any table surfaces "[E] Sit at the table",
       which opens the live casino floor (blackjack/roulette/slots).
     • STAFF: a croupier per table at its dealer side, a bartender, a pit
       boss, a count clerk; cityStaffPost keeps them data until you're near.

   HOW IT RUNS
   An order-90 landmass pass lays every casino out ONCE (tables, seats,
   colliders, staff posts, the count room). The furniture itself is drawn
   lazily: only a casino within ~70 m of you builds its merged fixture
   meshes (a handful of draw calls), and they are freed past ~120 m, so a
   world full of casinos costs nothing until you walk up to one.
   Determinism: layout is CBZ.hash01 (folds WORLD_SEED) off the lot.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  CBZ.CONFIG = CBZ.CONFIG || {};

  const GOLD = 0xc9a227;
  const FELT = 0x1d5e3a;
  const REACH = 3.2;
  const BUILD_R = 70, FREE_R = 120;

  CBZ._casinoTables = CBZ._casinoTables || [];
  let _casinoStations = 0;
  const LOTS = [];                 // every laid-out casino (lazy dressing reads these)

  function h01(x, z, s) { return CBZ.hash01 ? CBZ.hash01(x, z, s) : 0.5; }
  function kit() { return CBZ.storeFixtureKit ? CBZ.storeFixtureKit.create() : null; }

  // ---- THE FRAME: which way is IN. Buildings disagree on what door.nx means
  // (Gang City's doorPt carries the INWARD normal, other builders the outward
  // one), so the answer is measured: from the door point toward the centre.
  function frameOf(lot) {
    const b = lot.building;
    const ox = b.ox != null ? b.ox : lot.cx, oz = b.oz != null ? b.oz : lot.cz;
    const door = b.door || { nx: 0, nz: 1 };
    const axisX = Math.abs(door.nx || 0) > Math.abs(door.nz || 0);
    let sgn;
    if (door.x != null && door.z != null) {
      const d = axisX ? (ox - door.x) : (oz - door.z);
      sgn = Math.abs(d) > 0.05 ? Math.sign(d) : -Math.sign(axisX ? door.nx : (door.nz || 1));
    } else sgn = -Math.sign(axisX ? door.nx : (door.nz || 1));
    const inx = axisX ? sgn : 0, inz = axisX ? 0 : sgn;
    const wt = b.wt != null ? b.wt : 0.3;
    const slab = (b.floorTops && b.floorTops[0] != null) ? b.floorTops[0] : 0.14;
    const next = (b.floorTops && b.floorTops[1] != null) ? b.floorTops[1] : slab + (b.FH || 4.6);
    return {
      ox, oz, inx, inz, tx: -inz, tz: inx, wt, slab,
      ff: slab + 0.06,                         // the fit-out's carpet
      ceil: next - 0.212,                      // the fit-out's ceiling plane
      hDeep: (axisX ? b.w : b.d) / 2 - wt, hTan: (axisX ? b.d : b.w) / 2 - wt,
    };
  }
  // (lat, dep) → world; dep is measured from the centre toward the back wall
  function W(F, lat, dep) { return { x: F.ox + F.tx * lat + F.inx * dep, z: F.oz + F.tz * lat + F.inz * dep }; }
  function yawOf(F, dLat, dDep) { return Math.atan2(F.tx * dLat + F.inx * dDep, F.tz * dLat + F.inz * dDep); }
  function toLD(F, x, z) { const dx = x - F.ox, dz = z - F.oz; return { lat: dx * F.tx + dz * F.tz, dep: dx * F.inx + dz * F.inz }; }

  // ---- EXTERIOR: framed marquee with a bulb border + the mast sign ----------
  function dressExterior(root, lot) {
    const b = lot.building || {};
    const F = frameOf(lot);
    const k = kit();
    if (!k) return;
    const halfOut = F.hDeep + F.wt;                          // centre → outer door face
    const faceW = 2 * (F.hTan + F.wt);
    const boardW = Math.min(faceW - 1.2, 9);
    const p = W(F, 0, -halfOut - 0.2);
    k.frame(p.x, 0, p.z, yawOf(F, 0, -1));                   // local +Z = the street
    // the marquee: a steel box frame, a lit face inset in it, a bulb border
    k.box(0, 4.6, 0, boardW + 0.2, 1.5, 0.36, 0x1c1a17, "metal");
    k.box(0, 4.6, 0.185, boardW - 0.1, 1.2, 0.02, GOLD, "glow");
    k.box(0, 3.82, 0.05, boardW + 0.2, 0.08, 0.46, 0x1c1a17, "metal");  // soffit lip
    const nb = Math.max(8, Math.round(boardW / 0.34));
    for (let i = 0; i <= nb; i++) {
      const x = -boardW / 2 - 0.05 + i * ((boardW + 0.1) / nb);
      for (const y of [3.9, 5.3]) k.cyl(x, y, 0.2, 0.05, 0.05, 0.05, 0xfff0c0, "glow", Math.PI / 2, 0, 0, 6);
    }
    for (let j = 1; j < 4; j++) for (const e of [-1, 1]) k.cyl(e * (boardW / 2 + 0.05), 3.9 + j * 0.35, 0.2, 0.05, 0.05, 0.05, 0xfff0c0, "glow", Math.PI / 2, 0, 0, 6);
    // bulbs under the soffit, over the door
    for (let i = 0; i < 9; i++) k.cyl(-2 + i * 0.5, 3.76, 0.15, 0.04, 0.04, 0.03, 0xfff6dc, "glow", 0, 0, 0, 8);
    // the mast beside the entrance: steel pole, framed lit cabinet, cap
    const mp = W(F, F.hTan + F.wt - 1.0, -halfOut - 1.6);
    const poleH = 12;
    k.frame(mp.x, 0, mp.z, yawOf(F, 0, -1));
    k.box(0, 0.15, 0, 1.0, 0.3, 1.0, 0x6a6660);                                   // footing
    k.cyl(0, poleH / 2, 0, 0.22, 0.28, poleH, 0x3a3630, "metal", 0, 0, 0, 12);
    k.box(0, poleH - 2.2, 0, 2.6, 4.4, 0.6, 0x1c1a17, "metal");                  // cabinet
    for (const e of [-1, 1]) k.box(0, poleH - 2.2, e * 0.305, 2.3, 4.1, 0.01, GOLD, "glow");
    k.box(0, poleH + 0.08, 0, 2.8, 0.16, 0.7, 0x1c1a17, "metal");
    k.build(root);
    if (CBZ.colliders) CBZ.colliders.push({ minX: mp.x - 0.5, maxX: mp.x + 0.5, minZ: mp.z - 0.5, maxZ: mp.z + 0.5, y0: 0, y1: poleH });
    void b;
  }

  // ============================================================
  //  LAYOUT (eager, once per casino): where every table, machine, stool and
  //  counter stands, plus the colliders/seats/staff that must exist while
  //  you are elsewhere. Nothing is drawn here.
  // ============================================================
  function layoutInterior(lot) {
    const b = lot.building;
    if (!b || !b.w || !b.d) return 0;
    const F = frameOf(lot);
    if (F.hDeep < 4 || F.hTan < 3.5) return 0;
    const L = { F: F, tables: [], slots: [], stools: [], bar: null, cage: null, lamps: [] };
    const occ = [];
    const take = function (l0, l1, d0, d1) { occ.push([Math.min(l0, l1), Math.max(l0, l1), Math.min(d0, d1), Math.max(d0, d1)]); };
    const free = function (l0, l1, d0, d1) {
      const a0 = Math.min(l0, l1), a1 = Math.max(l0, l1), c0 = Math.min(d0, d1), c1 = Math.max(d0, d1);
      if (a0 < -F.hTan || a1 > F.hTan || c0 < -F.hDeep || c1 > F.hDeep) return false;
      for (let i = 0; i < occ.length; i++) { const o = occ[i]; if (a1 > o[0] && a0 < o[1] && c1 > o[2] && c0 < o[3]) return false; }
      if (typeof b.clearFloorPoint === "function") {
        const pts = [[(a0 + a1) / 2, (c0 + c1) / 2], [a0, c0], [a1, c0], [a0, c1], [a1, c1]];
        for (let i = 0; i < pts.length; i++) { const p = W(F, pts[i][0], pts[i][1]); if (!b.clearFloorPoint(p.x - F.ox, p.z - F.oz, 0.05)) return false; }
      }
      return true;
    };
    const collide = function (l0, l1, d0, d1, y1) {
      const a = W(F, l0, d0), q = W(F, l1, d1);
      if (CBZ.colliders) CBZ.colliders.push({ minX: Math.min(a.x, q.x), maxX: Math.max(a.x, q.x), minZ: Math.min(a.z, q.z), maxZ: Math.max(a.z, q.z), y0: 0, y1: F.ff + y1 });
    };
    const seat = function (lat, dep, dLat, dDep, h) {
      const p = W(F, lat, dep);
      L.stools.push({ x: p.x, z: p.z, yaw: yawOf(F, dLat, dDep), h: h });
      if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(p.x, F.ff, p.z, yawOf(F, dLat, dDep), "stool", lot, { cushion: h, floorBelow: 0 });
    };
    const staff = [];
    // the entry lane
    take(-1.4, 1.4, -F.hDeep, -F.hDeep + 3.0);

    // ---- THE COUNT ROOM first: everything else lays out around it ----------
    if (CBZ.cityVaultRoom && CBZ.CONFIG.CASINO_VAULT_V1 !== false) {
      try {
        CBZ.cityVaultRoom(lot, { tier: "count", kind: "casino", name: (b.name || "the house") + " count room",
          till: { src: lot, point: "vault" }, lat: (h01(lot.cx, lot.cz, "cntlat") < 0.5 ? -1 : 1) * 2.0 });
      } catch (e) { /* no room for one in this shell */ }
      const V = lot._vaultRoom;
      if (V) {
        // its rect, and the floor in front of its door, in this frame
        const c0 = W(F, 0, 0);
        const lx = V.plx + (V.inx || 0) * V.rd / 2, lz = V.plz + (V.inz || 0) * V.rd / 2;
        const cen = toLD(F, F.ox + lx, F.oz + lz);
        const alongLat = Math.abs((V.inx || 0) * F.tx + (V.inz || 0) * F.tz) > 0.5;   // does the room run along our lateral?
        const hl = alongLat ? V.rd / 2 : V.rw / 2, hd = alongLat ? V.rw / 2 : V.rd / 2;
        take(cen.lat - hl - 0.4, cen.lat + hl + 0.4, cen.dep - hd - 0.4, cen.dep + hd + 0.4);
        const dr = toLD(F, V.x - (V.inx || 0) * 1.2, V.z - (V.inz || 0) * 1.2);
        take(dr.lat - 1.3, dr.lat + 1.3, dr.dep - 1.3, dr.dep + 1.3);
        staff.push({ x: V.rx, z: V.rz, face: Math.atan2(-V.inx, -V.inz), job: "count clerk", pose: "table",
                     id: "count", wealth: 0.44, outfit: 0x2a2620, vault: V.id });
        void c0;
      }
    }

    // ---- THE CAGE: the room's own counter (the clerk behind it is the cashier)
    const KIT = CBZ.storeFixtureKit;
    const C = KIT ? KIT.counterOf(lot) : null;
    if (C) {
      const cc = toLD(F, C.x, C.z);
      const along = Math.abs(C.tx * F.tx + C.tz * F.tz) > 0.5;
      const hl = (along ? Math.max(C.w, C.d) : Math.min(C.w, C.d)) / 2, hd = (along ? Math.min(C.w, C.d) : Math.max(C.w, C.d)) / 2;
      take(cc.lat - hl - 0.4, cc.lat + hl + 0.4, cc.dep - hd - 1.2, F.hDeep);      // counter, queue, clerk side
      L.cage = { x: C.x, z: C.z, C: C };
      lot._cageSpot = { x: C.x, z: C.z, y: F.slab };
    }

    // ---- SLOT BANKS: a wall row, then a back-to-back island if the room is wide
    const s = h01(lot.cx, lot.cz, "slotside") < 0.5 ? -1 : 1;
    const slotAt = function (lat, dep, dLat) {
      if (!free(lat - 0.36, lat + 0.36, dep - 0.34, dep + 0.34)) return false;
      const sl = lat + dLat * 0.75;                              // the stool in front of it
      if (!free(sl - 0.3, sl + 0.3, dep - 0.3, dep + 0.3)) return false;
      take(lat - 0.36, lat + 0.36, dep - 0.34, dep + 0.34); take(sl - 0.3, sl + 0.3, dep - 0.3, dep + 0.3);
      const p = W(F, lat, dep);
      L.slots.push({ x: p.x, z: p.z, yaw: yawOf(F, dLat, 0), hue: L.slots.length });
      collide(lat - 0.3, lat + 0.3, dep - 0.3, dep + 0.3, 1.9);
      seat(sl, dep, -dLat, 0, 0.68);
      return true;
    };
    const wallLat = s * (F.hTan - 0.38);
    for (let d = -F.hDeep + 3.2; d <= F.hDeep - 0.5 && L.slots.length < 10; d += 0.74) slotAt(wallLat, d, -s);
    if (F.hTan >= 6.2) {
      const iLat = s * (F.hTan - 3.1);
      const nIsland = Math.min(6, Math.floor((F.hDeep * 2 - 6) / 0.74));
      for (let i = 0; i < nIsland; i++) {
        const d = -F.hDeep + 3.6 + i * 0.74;
        if (!free(iLat - 0.7, iLat + 0.7, d - 0.35, d + 0.35)) continue;
        slotAt(iLat + s * 0.37, d, s);                          // faces the wall row across its aisle
        slotAt(iLat - s * 0.37, d, -s);                         // faces the pit
      }
    }

    // ---- THE BAR: the other side wall, toward the back ----------------------
    const bs = -s, BL = Math.min(4.2, F.hDeep * 0.9);
    for (let d = F.hDeep - 0.8 - BL / 2; d > -F.hDeep + 3.5 + BL / 2 && !L.bar; d -= 0.5) {
      const wallL = bs * F.hTan, cLat = bs * (F.hTan - 1.35);
      if (!free(wallL, bs * (F.hTan - 2.4), d - BL / 2 - 0.3, d + BL / 2 + 0.3)) continue;
      take(wallL, bs * (F.hTan - 2.4), d - BL / 2 - 0.3, d + BL / 2 + 0.3);
      const bb = W(F, bs * F.hTan, d), ct = W(F, cLat, d);
      L.bar = { bb: bb, ct: ct, len: BL, yaw: yawOf(F, -bs, 0), cLat: cLat, dep: d, bs: bs };
      collide(bs * (F.hTan - 0.5), wallL, d - BL / 2, d + BL / 2, 2.4);                  // back bar
      collide(cLat - 0.3, cLat + 0.3, d - BL / 2, d + BL / 2, 1.1);                        // counter
      const n = Math.floor((BL - 0.4) / 0.65);
      for (let i = 0; i < n; i++) seat(cLat - bs * 0.72, d - BL / 2 + 0.4 + (i + 0.5) * ((BL - 0.8) / n), bs, 0, 0.78);
      const bt = W(F, bs * (F.hTan - 0.75), d);
      staff.push({ x: bt.x, z: bt.z, face: yawOf(F, -bs, 0), job: "bartender", pose: "table", id: "bar", wealth: 0.36, outfit: 0x5a3a22 });
    }

    // ---- THE PIT: blackjack + roulette on a grid, dealers toward the back ---
    const roll = h01(lot.cx, lot.cz, 7734);
    const want = Math.min(6, 2 + Math.floor(roll * 3) + (F.hTan * F.hDeep > 60 ? 2 : 0));
    const cands = [];
    for (let d = -F.hDeep + 4.4; d <= F.hDeep - 1.8; d += 3.5)
      for (let lat = -(F.hTan - 2.2); lat <= F.hTan - 2.2 + 1e-6; lat += 3.4) cands.push([lat, d]);
    cands.sort(function (a, b2) { return (Math.abs(a[0]) + Math.abs(a[1]) * 0.6) - (Math.abs(b2[0]) + Math.abs(b2[1]) * 0.6); });
    for (let i = 0; i < cands.length && L.tables.length < want; i++) {
      const lat = cands[i][0], d = cands[i][1];
      const roulette = (L.tables.length % 3) === 2;
      const hw = roulette ? 1.55 : 1.25;
      if (!free(lat - hw, lat + hw, d - 1.45, d + 1.45)) continue;
      take(lat - hw, lat + hw, d - 1.45, d + 1.45);
      const p = W(F, lat, d);
      const T = { x: p.x, z: p.z, yaw: yawOf(F, 0, -1), kind: roulette ? "roulette" : "blackjack" };   // players face the back
      L.tables.push(T);
      CBZ._casinoTables.push({ x: p.x, y: F.slab, z: p.z, lot: lot });
      collide(lat - (roulette ? 1.3 : 1.0), lat + (roulette ? 1.3 : 1.0), d - (roulette ? 0.62 : 0.47), d + (roulette ? 0.62 : 0.45), 0.95);
      // stools: an arc on the players' side (blackjack), both long sides (roulette)
      if (!roulette) {
        for (let j = 0; j < 5; j++) {
          const a = Math.PI * (0.15 + 0.7 * j / 4);
          const sl = lat - Math.cos(a) * 1.42, sd = d + 0.45 - Math.sin(a) * 1.34;
          seat(sl, sd, lat - sl, d - sd, 0.68);
        }
      } else {
        for (let j = 0; j < 4; j++) seat(lat - 0.9 + j * 0.6, d - 1.05, 0, 1, 0.68);
      }
      const dl = W(F, lat, d + (roulette ? 0.95 : 0.85));
      staff.push({ x: dl.x, z: dl.z, face: yawOf(F, 0, -1), job: "croupier", pose: "deal", id: "deal:" + (L.tables.length - 1), wealth: 0.42, outfit: 0x2a2620 });
      L.lamps.push({ x: p.x, z: p.z, yaw: T.yaw, len: roulette ? 2.2 : 1.8 });
    }
    if (L.tables.length) {
      const t0 = toLD(F, L.tables[0].x, L.tables[0].z);
      const pb = W(F, t0.lat + (t0.lat > 0 ? -1 : 1) * 1.9, t0.dep + 1.9);
      staff.push({ x: pb.x, z: pb.z, face: yawOf(F, t0.lat > 0 ? 1 : -1, -1), job: "pit boss", pose: "foldarms", id: "pit", wealth: 0.55, outfit: 0x1c1e24 });
    }

    if (CBZ.cityStaffPost) {
      const key = Math.round(lot.cx) + "_" + Math.round(lot.cz);
      for (let i = 0; i < staff.length; i++) {
        const p = staff[i];
        CBZ.cityStaffPost({
          venue: "casino", id: "casino:" + key + ":" + p.id, job: p.job,
          archetype: p.job === "pit boss" ? "professional" : "merchant",
          x: p.x, z: p.z, face: p.face, pose: p.pose,
          opts: { wealth: p.wealth, outfit: p.outfit, aggr: p.job === "pit boss" ? 0.3 : 0.1 },
          after: p.vault ? (function (id) { return function (ped) { ped._vaultStaff = id; }; })(p.vault) : null,
        });
      }
      _casinoStations += staff.length;
      if (CBZ.cityStaffStations) CBZ.cityStaffStations("casino", _casinoStations);
    }
    lot._casinoTables = L.tables.map(function (t) { return { x: t.x, y: F.slab, z: t.z, lot: lot }; });
    lot._casinoLay = L;
    LOTS.push(lot);
    return L.tables.length;
  }

  // ============================================================
  //  THE FURNITURE (lazy, merged per casino)
  // ============================================================
  function stool(k, x, z, h, yaw, ff) {
    const VF = CBZ.cityVenueFixtures;
    k.frame(x, ff, z, yaw);
    if (VF && VF.barStool) { VF.barStool(k, 0, 0, h, { pad: 0x5a1a1e, metal: 0x2a2620 }); return; }
    k.cyl(0, h / 2, 0, 0.03, 0.03, h, 0xb08a4a, "metal", 0, 0, 0, 8);
    k.cyl(0, h - 0.03, 0, 0.19, 0.19, 0.06, 0x5a1a1e, "solid", 0, 0, 0, 16);
  }
  // kidney top as a flat shape extruded up (local: flat dealer edge at -Z)
  let KID = null;
  function kidneyGeo(scale, h) {
    const s = new THREE.Shape(), N = 18;
    s.moveTo(-1.0 * scale, 0.45 * scale);
    for (let i = 1; i <= N; i++) {
      const a = Math.PI * (i / N);
      s.lineTo(-Math.cos(a) * 1.0 * scale, -(-0.45 + Math.sin(a) * 0.95) * scale + 0.0);
    }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: h, steps: 1, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);          // shape y → -z, extrude → +y
    g.computeVertexNormals();
    return g;
  }
  function blackjack(k, T, ff) {
    k.frame(T.x, ff, T.z, T.yaw);                       // local +Z = players' side (toward the door)
    // shape coords: y=+0.45*s is the flat edge → after rotateX it sits at z=-0.45 (dealer)
    k.push(kidneyGeo(0.86, 0.62), 0x2a1c14, "gloss", 0, 0.08, 0);             // cabinet
    k.push(kidneyGeo(0.8, 0.08), 0x0e0c0a, "solid", 0, 0, 0);                  // plinth
    k.push(kidneyGeo(1.0, 0.05), 0x3a2618, "gloss", 0, 0.7, 0);                // top frame
    k.push(kidneyGeo(0.93, 0.02), FELT, "solid", 0, 0.75, 0);                  // felt
    // the padded rail along the arc
    const pts = [];
    for (let i = 0; i <= 20; i++) { const a = Math.PI * (i / 20); pts.push(new THREE.Vector3(-Math.cos(a) * 0.97, 0.79, -0.45 + Math.sin(a) * 0.92)); }
    k.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.055, 6, false), 0x2a1410, "gloss", 0, 0, 0);
    // betting spots, cards, the dealer's chip tray + shoe
    for (let j = 0; j < 5; j++) {
      const a = Math.PI * (0.15 + 0.7 * j / 4), x = -Math.cos(a) * 0.62, z = -0.45 + Math.sin(a) * 0.55;
      k.torus(x, 0.772, z, 0.075, 0.004, 0xe8e2c8, "solid", Math.PI / 2, 0, 0, null, 16);
      if (j % 2 === 0) for (let c = 0; c < 2; c++) k.box(x + c * 0.03, 0.773 + c * 0.001, z - 0.02, 0.063, 0.002, 0.088, 0xf4f2ec, "solid", 0, 0.2 * (c - 0.5) + a, 0);
      for (let c = 0; c < 3; c++) k.cyl(x + 0.1, 0.776 + c * 0.0034, z + 0.03, 0.019, 0.019, 0.0033, [0xc0392b, 0x1f4a8a, 0x1c1c1e][j % 3], "solid", 0, 0, 0, 8);
    }
    k.box(0, 0.785, -0.36, 0.62, 0.03, 0.16, 0x2a1c14, "gloss");              // chip tray
    for (let i = 0; i < 8; i++) for (let c = 0; c < 7; c++)
      k.cyl(-0.26 + i * 0.075, 0.8 + c * 0.0034, -0.36, 0.019, 0.019, 0.0033, [0xc0392b, 0x2a7a3a, 0x1f4a8a, 0x1c1c1e, 0xe8e2c8, 0x7a2a8a, 0xc9a24a, 0xc0392b][i], "solid", 0, 0, 0, 8);
    k.box(0.45, 0.83, -0.3, 0.16, 0.1, 0.24, 0x14161a, "gloss", 0, 0.3, 0);    // shoe
    k.box(-0.38, 0.775, -0.2, 0.063, 0.003, 0.088, 0xf4f2ec);                  // the dealer's up card
  }
  function roulette(k, T, ff) {
    k.frame(T.x, ff, T.z, T.yaw);
    const Lh = 1.25, Dh = 0.6;
    k.box(0, 0.36, 0, 2 * Lh - 0.2, 0.64, 2 * Dh - 0.2, 0x2a1c14, "gloss");    // cabinet
    k.box(0, 0.04, 0, 2 * Lh - 0.3, 0.08, 2 * Dh - 0.3, 0x0e0c0a);
    k.box(0, 0.715, 0, 2 * Lh, 0.07, 2 * Dh, 0x3a2618, "gloss");               // top frame
    k.box(0.35, 0.752, 0, 2 * Lh - 0.9, 0.01, 2 * Dh - 0.16, FELT);            // layout felt
    // the betting grid: 3 x 12 red/black with the zero at the wheel end
    const gx0 = -0.2, cw = (2 * Lh - 1.1) / 12, ch = 0.22;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 12; c++) {
      const n = c * 3 + (3 - r);
      const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].indexOf(n) >= 0;
      k.box(gx0 + (c + 0.5) * cw, 0.759, (r - 1) * ch, cw - 0.012, 0.002, ch - 0.012, red ? 0x9a1c1c : 0x121214);
    }
    k.box(gx0 - 0.07, 0.759, 0, 0.1, 0.002, 3 * ch - 0.012, 0x1d7a3a);
    // padded rail round the edge
    for (const e of [-1, 1]) {
      k.cyl(0, 0.79, e * Dh, 0.05, 0.05, 2 * Lh, 0x2a1410, "gloss", 0, 0, Math.PI / 2, 8);
      k.cyl(e * Lh, 0.79, 0, 0.05, 0.05, 2 * Dh, 0x2a1410, "gloss", Math.PI / 2, 0, 0, 8);
    }
    // the wheel: wood bowl, pocket ring, cone and turret
    const wx = -Lh + 0.48;
    k.cyl(wx, 0.8, 0, 0.42, 0.4, 0.1, 0x4a2a16, "gloss", 0, 0, 0, 28);
    k.cyl(wx, 0.852, 0, 0.36, 0.36, 0.006, 0x2a1c14, "gloss", 0, 0, 0, 28);
    for (let i = 0; i < 37; i++) {
      const a = (i / 37) * Math.PI * 2;
      k.box(wx + Math.cos(a) * 0.29, 0.858, Math.sin(a) * 0.29, 0.045, 0.006, 0.07, i === 0 ? 0x1d7a3a : (i % 2 ? 0x9a1c1c : 0x121214), "solid", 0, -a, 0);
    }
    k.cyl(wx, 0.87, 0, 0.1, 0.24, 0.04, 0xc9a24a, "metal", 0, 0, 0, 20);
    k.cyl(wx, 0.92, 0, 0.012, 0.03, 0.08, 0xc9a24a, "metal", 0, 0, 0, 8);
    for (let i = 0; i < 4; i++) k.box(wx, 0.955, 0, 0.12, 0.01, 0.01, 0xc9a24a, "metal", 0, i * Math.PI / 4, 0);
    k.sphere(wx + 0.25, 0.866, 0.1, 0.008, 0xf4f2ec, "gloss");
    // chip stacks and the dolly
    for (let i = 0; i < 5; i++) for (let c = 0; c < 6; c++) k.cyl(0.9 - i * 0.07, 0.765 + c * 0.0034, -0.45, 0.019, 0.019, 0.0033, [0xc0392b, 0x2a7a3a, 0x1f4a8a, 0xe8e2c8, 0x7a2a8a][i], "solid", 0, 0, 0, 8);
  }
  const SCREEN = [0x2a5a9a, 0x7a2a6a, 0x2a7a5a, 0x8a5a1a, 0x5a2a8a];
  function slot(k, S2, ff) {
    k.frame(S2.x, ff, S2.z, S2.yaw);                                // local +Z = the player's side
    const cab = 0x1c1c22, trim = 0xc9a24a;
    k.box(0, 0.06, 0, 0.62, 0.12, 0.58, 0x0e0e10);                  // plinth
    k.box(0, 0.5, -0.04, 0.6, 0.76, 0.5, cab, "gloss");             // base cabinet
    k.box(0, 0.93, 0.08, 0.6, 0.08, 0.3, 0x24242a, "gloss", 0.28);  // raked button deck
    for (let i = 0; i < 5; i++) k.box(-0.2 + i * 0.1, 0.975, 0.1, 0.06, 0.012, 0.04, [0xe8e2c8, 0xe8e2c8, 0x9fe0ff, 0xffd46a, 0xff5a5a][i], "glow", 0.28);
    k.box(0.2, 0.84, 0.23, 0.08, 0.05, 0.02, 0x0e0e10, "gloss");    // bill acceptor
    k.box(0, 1.34, -0.1, 0.6, 0.78, 0.4, cab, "gloss");             // head cabinet
    k.box(0, 1.34, 0.105, 0.56, 0.62, 0.02, 0x0e0e10, "gloss");     // bezel
    k.box(0, 1.34, 0.117, 0.5, 0.54, 0.004, SCREEN[S2.hue % SCREEN.length], "glow");
    for (const e of [-1, 1]) k.box(e * 0.3, 1.2, 0.08, 0.012, 1.3, 0.012, trim, "glow");   // LED edge strips
    k.box(0, 1.86, -0.05, 0.58, 0.26, 0.3, cab, "gloss");           // topper
    k.box(0, 1.86, 0.102, 0.52, 0.2, 0.004, SCREEN[(S2.hue + 2) % SCREEN.length], "glow");
    k.cyl(0.24, 2.06, -0.05, 0.03, 0.03, 0.12, 0xff6a3a, "glow", 0, 0, 0, 8);           // candle
    k.box(-0.2, 1.73, 0.1, 0.1, 0.012, 0.02, trim, "metal");
  }
  function lampOver(k, Lp, ff, ceil) {
    const drop = Math.min(1.9, ceil - ff - 0.2);
    if (drop < 0.2) return;
    k.frame(Lp.x, ff, Lp.z, Lp.yaw);
    const y = ceil - ff - drop;
    for (const e of [-1, 1]) k.cyl(e * (Lp.len / 2 - 0.1), y + drop / 2, 0, 0.004, 0.004, drop, 0x6a6e74, "metal", 0, 0, 0, 4);
    k.box(0, y + 0.07, 0, Lp.len, 0.14, 0.36, 0x1a120c, "gloss");                        // hood
    k.box(0, y + 0.14, 0, Lp.len + 0.04, 0.02, 0.4, 0xc9a24a, "metal");
    k.box(0, y + 0.004, 0, Lp.len - 0.1, 0.006, 0.3, 0xfff0d0, "glow");                  // diffuser
  }
  function cage(k, Cg, ff) {
    const K = CBZ.storeFixtureKit, C = Cg.C;
    const Lc = Math.max(C.w, C.d), D = Math.min(C.w, C.d);
    k.frame(C.x, 0, C.z, K.yawOf(C.tx, C.tz));                     // counter frame (+Z = the customer)
    const top = K.dressCounter(k, Lc, D, C.top, ff, { clad: 0x2a1c14, trim: 0xc9a24a, work: 0x1a1612, kick: 0x0e0c0a });
    K.till(k, -Lc / 2 + 0.55, top, D);
    // the cage: glass over the counter, brass bars, a window per station
    const H = 1.05, y0 = top, zf = D / 2 - 0.05;
    k.box(0, y0 + H + 0.03, zf, Lc + 0.04, 0.06, 0.06, 0xc9a24a, "metal");
    k.box(0, y0 + H / 2 + 0.2, zf - 0.01, Lc, H - 0.4, 0.01, 0, "glass");
    const nb = Math.round(Lc / 0.12);
    for (let i = 0; i <= nb; i++) k.cyl(-Lc / 2 + i * (Lc / nb), y0 + H / 2, zf, 0.008, 0.008, H, 0xc9a24a, "metal", 0, 0, 0, 6);
    k.box(0, y0 + 0.22, zf, Lc, 0.03, 0.04, 0xc9a24a, "metal");     // window sill rail
    for (let i = 0; i < 3; i++) for (let c = 0; c < 8; c++) k.cyl(-0.4 + i * 0.4, top + 0.005 + c * 0.0034, 0.05, 0.019, 0.019, 0.0033, [0xc0392b, 0x2a7a3a, 0x1c1c1e][i], "solid", 0, 0, 0, 8);
  }

  function build(lot) {
    const L = lot._casinoLay; if (!L || L.group) return;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    const k = kit(); if (!k || !root) return;
    const F = L.F, ff = F.ff;
    L.tables.forEach(function (T) { if (T.kind === "roulette") roulette(k, T, ff); else blackjack(k, T, ff); });
    L.slots.forEach(function (S2) { slot(k, S2, ff); });
    L.stools.forEach(function (s) { stool(k, s.x, s.z, s.h, s.yaw, ff); });
    L.lamps.forEach(function (Lp) { lampOver(k, Lp, ff, F.ceil); });
    if (L.cage) cage(k, L.cage, ff);
    if (L.bar) {
      const VF = CBZ.cityVenueFixtures, B2 = L.bar;
      k.frame(B2.bb.x, ff, B2.bb.z, B2.yaw);
      if (VF && VF.backBar) VF.backBar(k, B2.len, { seed: Math.round(lot.cx * 7 + lot.cz), h: Math.min(2.5, F.ceil - ff - 0.3) });
      // the front counter: panelled face, brass foot rail, stone top
      k.frame(B2.ct.x, ff, B2.ct.z, B2.yaw);
      k.box(0, 0.52, 0, B2.len, 1.04, 0.56, 0x2a1c14, "gloss");
      k.box(0, 1.07, 0.05, B2.len + 0.1, 0.05, 0.7, 0x16181b, "gloss");
      k.cyl(0, 0.2, 0.36, 0.025, 0.025, B2.len, 0xc9a24a, "metal", 0, 0, Math.PI / 2, 10);
      for (let i = 0; i < 5; i++) k.box(-B2.len / 2 + (i + 0.5) * B2.len / 5, 0.14, 0.33, 0.02, 0.12, 0.08, 0xc9a24a, "metal");
    }
    const group = new THREE.Group();
    k.build(group);
    root.add(group);
    L.group = group;
    if (CBZ.interiorTrackFixture) { try { CBZ.interiorTrackFixture("casino-floor", lot.building, group); } catch (e) {} }
  }
  function free(lot) {
    const L = lot._casinoLay; if (!L || !L.group) return;
    const grp = L.group;
    if (grp.parent) grp.parent.remove(grp);
    grp.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    L.group = null;
  }
  if (CBZ.onUpdate) CBZ.onUpdate(38.7, function () {
    const P = CBZ.player, g = CBZ.game;
    if (!P || !P.pos || !g || g.mode !== "city") return;
    for (let i = 0; i < LOTS.length; i++) {
      const lot = LOTS[i], L = lot._casinoLay; if (!L) continue;
      const dx = P.pos.x - lot.cx, dz = P.pos.z - lot.cz, d2 = dx * dx + dz * dz;
      if (!L.group && !L.failed && d2 < BUILD_R * BUILD_R) { try { build(lot); } catch (e) { L.failed = true; } }
      else if (L.group && d2 > FREE_R * FREE_R) free(lot);
    }
  });

  function dressCasino(root, lot) {
    if (!lot || !lot.building || lot._casinoDressed) return;
    lot._casinoDressed = true;
    try { dressExterior(root, lot); } catch (e) {}
    // a game package (core/packages.js, order-88 claim) owns this interior
    if (lot._gamePkg) return;
    try {
      if (CBZ.interiorBounded) CBZ.interiorBounded(lot.building, function () { return layoutInterior(lot); }, "casino-floor");
      else layoutInterior(lot);
    } catch (e) {}
  }

  // ---- the single global casino-table interaction zone ----------------------
  function openTable() {
    if (CBZ.cityOpenCasino) CBZ.cityOpenCasino();
  }
  if (CBZ.interactions && CBZ.interactions.registerZone && !CBZ._casinoZoneReg) {
    CBZ._casinoZoneReg = true;
    CBZ.interactions.registerZone({
      id: "casino-table", kind: "casino-table", prio: 7, driving: false,
      find: function (px, pz, ctx) {
        const py = ctx && ctx.pos ? ctx.pos.y : 0;
        let best = null, bd = REACH * REACH;
        const list = CBZ._casinoTables;
        for (let i = 0; i < list.length; i++) {
          const t = list[i];
          if (Math.abs((t.y || 0) - py) > 2.2) continue;
          const dx = t.x - px, dz = t.z - pz, dsq = dx * dx + dz * dz;
          if (dsq < bd) { bd = dsq; best = t; }
        }
        return best;
      },
      options: [{ id: "sit-table", slot: "e", label: "Sit at the table", onSelect: function () { openTable(); } }],
    });
  }

  // ---- ORDER-90 DRESS PASS --------------------------------------------------
  CBZ.addLandmass(function (city) {
    const A = city || CBZ._settlementArena || (CBZ.city && CBZ.city.arena) || null;
    const root = (city && city.root) || (A && A.root) || null;
    if (!A || !root) return;
    CBZ._casinoTables.length = 0;
    for (let i = 0; i < LOTS.length; i++) free(LOTS[i]);
    LOTS.length = 0;
    _casinoStations = 0;
    if (CBZ.cityStaffVenue) CBZ.cityStaffVenue("casino", { stations: 0, note: "one croupier per felt, cage, bar, pit" });
    const seen = new Set();
    const scan = function (arr) {
      if (!arr) return;
      for (const lot of arr) {
        if (!lot || lot.kind !== "casino" || !lot.building) continue;
        const key = Math.round(lot.cx) + "," + Math.round(lot.cz);
        if (seen.has(key)) continue; seen.add(key);
        dressCasino(root, lot);
      }
    };
    scan(A.shopLots); scan(A.lots);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }, 90);

  CBZ.dressCasino = dressCasino;
  CBZ.cityCasinoCage = function (lot) {
    if (!lot || lot.kind !== "casino" || !lot._cageSpot) return null;
    const TL = CBZ.cityTill;
    const held = (TL && TL.holds) ? TL.holds(lot, { point: "vault" }) : null;
    return { spot: lot._cageSpot, holds: held ? held.amount : 0, of: held ? held.of : 0 };
  };
  // EXPORT ONLY (probe/preset): what a casino floor stands
  CBZ.cityCasinoAudit = function () {
    return LOTS.map(function (lot) {
      const L = lot._casinoLay;
      let meshes = 0, verts = 0;
      if (L.group) L.group.traverse(function (o) { if (o.isMesh) { meshes++; verts += o.geometry.attributes.position.count; } });
      return { name: lot.building && lot.building.name, tables: L.tables.length, slots: L.slots.length, stools: L.stools.length,
               bar: !!L.bar, cage: !!L.cage, built: !!L.group, meshes: meshes, verts: verts };
    });
  };
})();
