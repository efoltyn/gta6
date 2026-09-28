/* ============================================================
   city/fitout_gang.js — THE GANG HIDEOUT, FITTED OUT.

   OWNER: "the LOGIC of Gang Life: interiors are places you DO things ... a
   back room where the gang counts money ... a drug kitchen ... NPCs live and
   work inside ... gang members in their spot ... layouts serve gameplay
   (entrances, cover, sightlines, escape routes)."

   A hideout (buildings.js "GANG-RUN HIDEOUT") is a 1-4 storey walk-up whose
   every floor is declared prog "hideout". This file is that planner, and the
   crew that works in it.

   ONE PLAN, TWO READERS. planGround / planKitchen / planCrash / planBoss are
   PURE functions of the building record (its size, door, clearFloorPoint and
   position hash). The lazy fit-out planner calls them to DRAW the floor when
   you walk up; the crew declaration calls the very same functions at world
   build to know where the lookout's chair and the count table ARE, so a body
   is seated in a chair that will be drawn exactly there, and the gang's stash
   point (lot.building.stash.x/z) is the count table the fit-out will stand.

   THE GROUND FLOOR is two rooms:
     the LOUNGE by the door (a beat-up sofa facing a TV on a crate, a stained
     rug, a milk-crate table of cans and pizza boxes, a lookout on a folding
     chair beside the entrance, a tipped-over table and stacked crates to
     fight from), and
     the COUNT ROOM at the back, behind a real solid partition whose doorway is
     pushed to the far end so the street door cannot see the table: you have
     to walk the length of the lounge and commit to go in. A folding table
     under a bare bulb, a counting machine, banded stacks, a scale, a pistol,
     the gang's duffel on the floor beside it and a steel shelf with the
     lockbox. The table IS the stash (interior_programs.js "countroom").
   UPPER FLOORS alternate a DRUG KITCHEN (steel table, burners, glassware,
   jugs, gas bottle, a box fan in the window, respirators on a hook, plastic
   sheeting, product bagged on a second table) and a CRASH FLOOR (mattresses
   on the floor, a clothes rail, a TV, a weapons crate, a footlocker). The top
   floor of a 3-4 storey hideout is the shot-caller's room: his desk, his
   chair, his floor safe.

   THE CREW. While a gang holds the lot (lot.building.stash.gang), 2-4 of its
   own members are DECLARED through citystaff.js (bodies minted only when you
   are near, never re-minted once shot). They are real gangs.js members: same
   kind/gang/faction/rank fields, pushed onto gang.members as garrison (the war
   director skips _occupyGarrison), so turf defence counts them, killfeed and
   provocation treat them as the set's own. They are armed; when one of them
   is woken (lootConsequence's witness, a shot, the count vanishing) the whole
   house gets up. When the lot changes hands their `alive` check fails, the
   old crew is given back, and the new holder's crew is declared.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const PI = Math.PI, HP = Math.PI / 2;
  const DOORW = 1.6;                      // buildings.js DOORW (the street door)

  /* ========================================================================
     0. PURE HELPERS — nothing here touches the scene.
     ======================================================================== */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  // identical to fitout.js's B.h, so the planner and the declaration agree
  function hsh(b, k, a, c, s) {
    return CBZ.hash01 ? CBZ.hash01((b.ox || 0) + a * 1.37 + k * 3.1, (b.oz || 0) + c * 2.11, s | 0) : 0.5;
  }
  function floorsOf(b) {
    return Array.isArray(b.floorTops) && b.floorTops.length >= 2 ? b.floorTops.length - 1 : Math.max(1, b.storeys | 0);
  }
  function topOf(b, k) {
    const t = b.floorTops;
    if (Array.isArray(t) && t[k] != null) return t[k];
    return k <= 0 ? 0.14 : k * (b.FH || 3.2);
  }
  function fyOf(b, k) { return topOf(b, k) + (k === 0 ? 0.06 : 0.05); }   // fitout.js's finished floor
  function roomOf(b, k) { return CBZ.interiorFloorRoom ? CBZ.interiorFloorRoom(b, k) : null; }
  function doorOf(b) {
    const d = b.localDoor;
    return (d && d.nx != null) ? d : { x: 0, z: -b.d / 2, nx: 0, nz: 1 };
  }
  function wtOf(b) { return b.wt != null ? b.wt : 0.4; }

  // what each storey of an n-storey hideout is
  function floorKind(b, k, n) {
    if (k <= 0) return "ground";
    if (n >= 3 && k === n - 1) return "boss";
    const ph = hsh(b, 0, 0.5, 0.5, 0x61) < 0.5 ? 0 : 1;
    return ((k + ph) & 1) ? "kitchen" : "crash";
  }

  // THE STAIR CORE (elevators.js CBZ.cityStairCore): stamped on the building
  // record AND its group, because the lot carries a shallow copy of the record
  // buildings.js made and the fit-out planner is handed the original. Both
  // share the group, so both readers find the same core.
  function coreOf(b) {
    if (!b) return null;
    return b._stairCore || (b.group && b.group.userData && b.group.userData.stairCore) || null;
  }

  // ---- the placement ledger: a floor's free space, door lane and taken rects
  function ctx(b, r, k) {
    const C = { b: b, r: r, k: k, X0: r.x0 - 0.4, X1: r.x1 + 0.4, Z0: r.z0 - 0.4, Z1: r.z1 + 0.4,
                door: doorOf(b), taken: [] };
    // the stairwell and the walk out of its door stay empty on every floor:
    // the shaft itself is already off limits through clearFloorPoint (the
    // carve reserves it), this keeps a sofa from being parked across the
    // landing you step out onto.
    const core = coreOf(b);
    if (core && core.rect && core.head) {
      const R = core.rect, h = core.head;
      take(C, R.x0 - 0.12, R.z0 - 0.12, R.x1 + 0.12, R.z1 + 0.12);
      const ax = h.x + h.nx * 2.4, az = h.z + h.nz * 2.4, lx = Math.abs(h.nz) * 1.1, lz = Math.abs(h.nx) * 1.1;
      take(C, Math.min(h.x, ax) - lx, Math.min(h.z, az) - lz, Math.max(h.x, ax) + lx, Math.max(h.z, az) + lz);
    }
    return C;
  }
  // the street door's walk-in lane (wider than buildings.js's, which only
  // keeps furniture out of the doorway itself: nobody parks a sofa 3 m in)
  function laneHit(C, x, z, m) {
    const d = C.door, dx = x - d.x, dz = z - d.z;
    const inw = dx * d.nx + dz * d.nz, cr = Math.abs(dx * d.nz - dz * d.nx);
    return inw > -0.8 && inw < 5.3 && cr < DOORW / 2 + m;
  }
  function spotOK(C, x, z) {
    if (laneHit(C, x, z, 0.3)) return false;
    return !C.b.clearFloorPoint || C.b.clearFloorPoint(x, z, 0.02);
  }
  function freeRect(C, x0, z0, x1, z1) {
    if (x0 < C.X0 + 0.01 || x1 > C.X1 - 0.01 || z0 < C.Z0 + 0.01 || z1 > C.Z1 - 0.01) return false;
    const ix0 = x0 + 0.05, ix1 = x1 - 0.05, iz0 = z0 + 0.05, iz1 = z1 - 0.05;
    const nx = Math.max(2, Math.ceil((ix1 - ix0) / 0.9) + 1), nz = Math.max(2, Math.ceil((iz1 - iz0) / 0.9) + 1);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++)
      if (!spotOK(C, ix0 + (ix1 - ix0) * i / (nx - 1), iz0 + (iz1 - iz0) * j / (nz - 1))) return false;
    for (let i = 0; i < C.taken.length; i++) {
      const t = C.taken[i];
      if (x1 > t[0] + 0.02 && x0 < t[2] - 0.02 && z1 > t[1] + 0.02 && z0 < t[3] - 0.02) return false;
    }
    return true;
  }
  function take(C, x0, z0, x1, z1) { C.taken.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]); }
  // first candidate whose rect {x0,z0,x1,z1} is free; it is taken and returned
  function first(C, cands) {
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (freeRect(C, c.x0, c.z0, c.x1, c.z1)) { take(C, c.x0, c.z0, c.x1, c.z1); return c; }
    }
    return null;
  }
  // rotate a candidate list by a hash so two hideouts do not furnish identically
  function spin(list, v) {
    if (!list.length) return list;
    const s = Math.floor(v * list.length) % list.length;
    return list.slice(s).concat(list.slice(0, s));
  }
  function uz(cs, ua, ub) { return cs > 0 ? [ua, ub] : [-ub, -ua]; }   // band-frame u range -> z range

  /* ========================================================================
     1. THE PLANS (pure).
     ======================================================================== */

  // ---- GROUND: lounge at the front, count room at the back ----------------
  function planGround(b, r) {
    const C = ctx(b, r, 0), d = C.door;
    const onZ = Math.abs(d.nz) > 0.5;
    // the count band sits on a ±z wall: the one opposite a ±z door, else the
    // +z wall (where buildings.js's makeStash already dropped the duffel).
    const cs = onZ ? (d.nz > 0 ? 1 : -1) : 1;
    const zw = cs > 0 ? C.Z1 : C.Z0;                 // back wall inner face
    const U = cs * zw;
    const uMin = onZ ? cs * d.z + 5.6 : DOORW / 2 + 0.75;
    const Dw = clamp((C.Z1 - C.Z0) * 0.3, 3.4, 4.4);
    let D = Math.min(Dw, U - uMin);
    let wall = D >= 2.7;
    if (!wall) D = Math.min(Dw, 2.8);
    const zp = zw - cs * D;                          // partition line
    // THE DOORWAY is pushed to the far end: from the street door the
    // partition is all you see; the table is round the corner.
    // With a stair core in a back corner, the doorway goes to the OTHER end:
    // the core's own wall closes that end of the partition.
    const core = coreOf(b);
    const side = (onZ && core && core.rect) ? ((core.rect.x0 + core.rect.x1) / 2 > 0 ? -1 : 1)
      : onZ ? (hsh(b, 0, 1, 2, 0x51) < 0.5 ? -1 : 1) : (d.x < 0 ? 1 : -1);
    const gapW = 1.0;
    const gx = side > 0 ? C.X1 - 0.85 : C.X0 + 0.85;
    // the partition's clear runs (a lift shaft or stair core may bite a corner)
    const segs = [];
    if (wall) {
      const step = 0.25;
      let a = null, covered = 0;
      for (let x = C.X0 + 0.06; x <= C.X1 - 0.06 + 1e-6; x += step) {
        const ok = !laneHit(C, x, zp, 0.2) && (!b.clearFloorPoint || b.clearFloorPoint(x, zp, 0.02));
        if (ok && a == null) a = x;
        if (!ok && a != null) { segs.push([a, x - step]); a = null; }
      }
      if (a != null) segs.push([a, C.X1 - 0.06]);
      // a run that stops at the stair core's side wall is carried onto it (the
      // 0.25 m sampling would otherwise leave a slot beside the shaft)
      const cr = core && core.rect;
      const onCore = !!(cr && zp > cr.z0 - 0.3 && zp < cr.z1 + 0.3);
      for (let i = 0; i < segs.length; i++) {
        if (Math.abs(segs[i][0] - (C.X0 + 0.06)) < 1e-3) segs[i][0] = C.X0;
        if (Math.abs(segs[i][1] - (C.X1 - 0.06)) < 0.2) segs[i][1] = C.X1;
        if (onCore && Math.abs(segs[i][0] - cr.x1) < 0.5) segs[i][0] = cr.x1;
        if (onCore && Math.abs(segs[i][1] - cr.x0) < 0.5) segs[i][1] = cr.x0;
        covered += segs[i][1] - segs[i][0];
      }
      if (covered < 0.6 * (C.X1 - C.X0)) { wall = false; segs.length = 0; D = Math.min(Dw, 2.8); }
    }
    const zpF = zw - cs * D;
    if (wall) {
      take(C, C.X0, zpF - 0.1, C.X1, zpF + 0.1);
      take(C, gx - 0.65, zpF - 1.0, gx + 0.65, zpF + 1.0);        // both sides of the doorway stay clear
    }
    // THE BAG'S SPOT on the floor at the back-centre (where buildings.js
    // makeStash files the stash): with the count band on +z it lies beside
    // the table; nothing else is drawn over it
    const dz = b.d / 2 - 2.6;
    if (cs > 0) take(C, -0.58, dz - 0.3, 0.58, dz + 0.3);

    // ---- the COUNT TABLE, beside the duffel, the counter's chair behind it
    // so he sits facing the doorway.
    const tside = side > 0 ? -1 : 1;
    const bandLo = cs * zpF + (wall ? 0.06 : 0);
    const uT = clamp(b.d / 2 - 2.6, bandLo + 1.05, U - 1.2);
    const tcands = [];
    const txs = [tside * 1.55, tside * 2.2, tside * 1.0, -tside * 1.55, 0];
    for (let i = 0; i < txs.length; i++) {
      const tx = clamp(txs[i], C.X0 + 0.95, C.X1 - 0.95);
      const zr = uz(cs, uT - 0.47, uT + 1.15);
      tcands.push({ x: tx, z: cs * uT, x0: tx - 0.93, x1: tx + 0.93, z0: zr[0], z1: zr[1] });
    }
    let table = first(C, tcands);
    if (!table) {                                    // a cramped plate: the table goes where it fits
      const tx = clamp(tside * 1.55, C.X0 + 0.95, C.X1 - 0.95);
      table = { x: tx, z: cs * uT };
    }
    const chair = { x: table.x, z: table.z + cs * 0.83, face: cs > 0 ? PI : 0 };
    // the gang's duffel on the floor beside the table
    let duffel = cs > 0 ? { x: 0, z: dz } : null;
    if (cs < 0) {
      const dx = table.x + (table.x > 0 ? -1.45 : 1.45);
      duffel = first(C, [{ x: dx, z: table.z, x0: dx - 0.5, x1: dx + 0.5, z0: table.z - 0.28, z1: table.z + 0.28 }]);
    }
    // steel shelf with the lockbox against the back wall, doorway end
    const shx = clamp(gx, C.X0 + 0.55, C.X1 - 0.55), shx2 = clamp(-gx, C.X0 + 0.55, C.X1 - 0.55);
    const shz = zw - cs * 0.22;
    const shelf = first(C, [
      { x: shx, z: shz, x0: shx - 0.52, x1: shx + 0.52, z0: shz - 0.22, z1: shz + 0.22 },
      { x: shx2, z: shz, x0: shx2 - 0.52, x1: shx2 + 0.52, z0: shz - 0.22, z1: shz + 0.22 },
    ]);

    // ---- the LOUNGE
    const zf = cs > 0 ? C.Z0 : C.Z1;
    const uF = cs * zf, uB = cs * zpF - (wall ? 0.08 : 0.4);
    const uC = (uF + uB) / 2;
    const scands = [];
    if (wall) {                                      // back to the partition, away from its doorway
      const lo = side > 0 ? C.X0 : gx + 0.75, hi = side > 0 ? gx - 0.75 : C.X1;
      const sx = clamp((lo + hi) / 2, C.X0 + 1.2, C.X1 - 1.2);
      const us = uB - 0.47, ut = us - 2.7;
      const zr = uz(cs, ut - 0.32, us + 0.45);
      scands.push({ x0: sx - 1.18, x1: sx + 1.18, z0: zr[0], z1: zr[1],
        sofa: { x: sx, z: cs * us, yaw: cs > 0 ? PI : 0 }, tv: { x: sx, z: cs * ut, yaw: cs > 0 ? 0 : PI } });
    }
    const zoffs = [0, 1.2, -1.2, 2.4, -2.4];
    for (let q = 0; q < 2; q++) {
      const wx = q === 0 ? C.X0 : C.X1, dir = q === 0 ? 1 : -1;
      for (let i = 0; i < zoffs.length; i++) {
        const zc = cs * uC + zoffs[i];
        const sx = wx + dir * 0.47, tx = sx + dir * 2.7;
        scands.push({ x0: Math.min(wx + dir * 0.02, tx + dir * 0.32), x1: Math.max(wx + dir * 0.02, tx + dir * 0.32),
          z0: zc - 1.18, z1: zc + 1.18,
          sofa: { x: sx, z: zc, yaw: dir > 0 ? HP : -HP }, tv: { x: tx, z: zc, yaw: dir > 0 ? -HP : HP } });
      }
    }
    const lounge = first(C, scands);
    let sofa = null, tv = null;
    if (lounge) {
      sofa = { x: lounge.sofa.x, z: lounge.sofa.z, yaw: lounge.sofa.yaw, len: 2.2 };
      tv = lounge.tv;
    }
    // ---- the LOOKOUT: a folding chair beside the street door, watching it
    const tX = -d.nz, tZ = d.nx;
    let lookout = null;
    const s0 = hsh(b, 0, 3, 1, 0x52) < 0.5 ? 1 : -1;
    for (let q = 0; q < 2 && !lookout; q++) {
      const s = q === 0 ? s0 : -s0;
      const x = d.x + d.nx * 1.35 + tX * s * 1.6, z = d.z + d.nz * 1.35 + tZ * s * 1.6;
      const cx = x + d.nx * 0.62, cz = z + d.nz * 0.62;                    // his milk crate, further in
      if (freeRect(C, x - 0.3, z - 0.3, x + 0.3, z + 0.3)) {
        take(C, x - 0.3, z - 0.3, x + 0.3, z + 0.3);
        lookout = { x: x, z: z, face: Math.atan2(-s * tX, -s * tZ), crate: null };
        if (freeRect(C, cx - 0.2, cz - 0.2, cx + 0.2, cz + 0.2)) { take(C, cx - 0.2, cz - 0.2, cx + 0.2, cz + 0.2); lookout.crate = { x: cx, z: cz }; }
      }
    }
    // ---- COVER between the street door and the count-room doorway: a
    // tipped table (its top toward the door) and crate stacks by the walls.
    const p1x = d.x + d.nx * 6.0, p1z = d.z + d.nz * 6.0;
    const p2x = wall ? gx : table.x, p2z = wall ? zpF - cs * 1.4 : table.z - cs * 1.6;
    const mx = (p1x + p2x) / 2, mz = (p1z + p2z) / 2;
    const longX = onZ;
    const hw = longX ? 0.73 : 0.43, hd = longX ? 0.43 : 0.73;
    const ccands = [];
    const cpts = [[mx, mz], [mx + tX * 1.0, mz + tZ * 1.0], [mx - tX * 1.0, mz - tZ * 1.0],
                  [mx + d.nx * 0.8, mz + d.nz * 0.8], [mx - d.nx * 0.8, mz - d.nz * 0.8],
                  [p1x + tX * 1.5, p1z + tZ * 1.5], [p1x - tX * 1.5, p1z - tZ * 1.5]];
    for (let i = 0; i < cpts.length; i++) ccands.push({ x: cpts[i][0], z: cpts[i][1], x0: cpts[i][0] - hw, x1: cpts[i][0] + hw, z0: cpts[i][1] - hd, z1: cpts[i][1] + hd });
    const cover = first(C, ccands);
    if (cover) { cover.longX = longX; cover.lx = d.nx; cover.lz = d.nz; }
    const crates = [];
    const kc = [];
    for (let u = uF + 0.8; u <= uB - 0.5; u += 1.0) {
      kc.push({ x: C.X0 + 0.45, z: cs * u }); kc.push({ x: C.X1 - 0.45, z: cs * u });
    }
    const kcs = spin(kc, hsh(b, 0, 2, 5, 0x53));
    for (let i = 0; i < kcs.length && crates.length < 2; i++) {
      const c = kcs[i];
      const got = first(C, [{ x: c.x, z: c.z, x0: c.x - 0.43, x1: c.x + 0.43, z0: c.z - 0.34, z1: c.z + 0.34 }]);
      if (got) crates.push(got);
    }
    const bandZ = uz(cs, cs * zpF + 0.06, U);
    const loungeZ = uz(cs, uF, cs * zpF - 0.06);
    return {
      C: C, cs: cs, zw: zw, zp: zpF, D: D, wall: wall, segs: segs, gx: gx, gapW: gapW, side: side,
      table: { x: table.x, z: table.z }, chair: chair, duffel: duffel, shelf: shelf,
      sofa: sofa, tv: tv, lookout: lookout, cover: cover, crates: crates,
      band: { x0: C.X0, x1: C.X1, z0: bandZ[0], z1: bandZ[1] },
      lounge: { x0: C.X0, x1: C.X1, z0: loungeZ[0], z1: loungeZ[1] },
    };
  }

  // ---- KITCHEN: the long steel table, the cook standing at it -------------
  function planKitchen(b, r, k) {
    const C = ctx(b, r, k);
    const alongX = (C.X1 - C.X0) >= (C.Z1 - C.Z0);
    const cx = (C.X0 + C.X1) / 2, cz = (C.Z0 + C.Z1) / 2;
    const L = 2.4, W = 0.8;
    const offs = [0, 1.2, -1.2, 2.4, -2.4, 3.4, -3.4];
    const cands = [];
    for (let i = 0; i < offs.length; i++) {
      const tx = alongX ? cx : cx + offs[i], tz = alongX ? cz + offs[i] : cz;
      // long: table + the gas bottle at the + end; short: the cook's side (-)
      const l0 = -(L / 2 + 0.2), l1 = L / 2 + 0.55, s0 = -(W / 2 + 0.95), s1 = W / 2 + 0.35;
      cands.push(alongX
        ? { x: tx, z: tz, x0: tx + l0, x1: tx + l1, z0: tz + s0, z1: tz + s1 }
        : { x: tx, z: tz, x0: tx + s0, x1: tx + s1, z0: tz + l0, z1: tz + l1 });
    }
    const t = first(C, cands) || { x: cx, z: cz };
    const table = { x: t.x, z: t.z, alongX: alongX, L: L, W: W };
    // the cook stands at the burners, which are at the gas bottle's (+) end
    const cook = alongX ? { x: t.x + 0.55, z: t.z - (W / 2 + 0.42), face: 0 }
                        : { x: t.x - (W / 2 + 0.42), z: t.z + 0.55, face: HP };
    const tank = alongX ? { x: t.x + L / 2 + 0.3, z: t.z } : { x: t.x, z: t.z + L / 2 + 0.3 };
    // the bagging table against a wall, clear space in front of it
    const bc = [
      { x: cx, z: C.Z0 + 0.4, ax: true, fx: 0, fz: 1 }, { x: cx, z: C.Z1 - 0.4, ax: true, fx: 0, fz: -1 },
      { x: C.X0 + 0.4, z: cz, ax: false, fx: 1, fz: 0 }, { x: C.X1 - 0.4, z: cz, ax: false, fx: -1, fz: 0 },
      { x: cx + 2.2, z: C.Z0 + 0.4, ax: true, fx: 0, fz: 1 }, { x: cx - 2.2, z: C.Z1 - 0.4, ax: true, fx: 0, fz: -1 },
    ];
    let bags = null;
    const bcs = spin(bc, hsh(b, k, 1, 1, 0x71));
    for (let i = 0; i < bcs.length && !bags; i++) {
      const c = bcs[i];
      const hx = c.ax ? 0.77 : 0.37, hz = c.ax ? 0.37 : 0.77;
      const ex0 = Math.min(0, c.fx) * 0.7, ex1 = Math.max(0, c.fx) * 0.7, ez0 = Math.min(0, c.fz) * 0.7, ez1 = Math.max(0, c.fz) * 0.7;
      if (freeRect(C, c.x - hx + ex0, c.z - hz + ez0, c.x + hx + ex1, c.z + hz + ez1)) {
        take(C, c.x - hx + ex0, c.z - hz + ez0, c.x + hx + ex1, c.z + hz + ez1);
        bags = { x: c.x, z: c.z, alongX: c.ax, fx: c.fx, fz: c.fz };
      }
    }
    return { C: C, table: table, cook: cook, tank: tank, bags: bags };
  }

  // ---- CRASH FLOOR: mattresses head-to-wall, a rail, a TV, the guns --------
  function planCrash(b, r, k) {
    const C = ctx(b, r, k);
    const slots = [];
    for (let x = C.X0 + 0.72; x <= C.X1 - 0.72; x += 1.25) {
      slots.push({ x: x, z: C.Z0 + 1.03, hx: 0.5, hz: 1.0, hdx: 0, hdz: -1 });
      slots.push({ x: x, z: C.Z1 - 1.03, hx: 0.5, hz: 1.0, hdx: 0, hdz: 1 });
    }
    for (let z = C.Z0 + 0.72; z <= C.Z1 - 0.72; z += 1.25) {
      slots.push({ x: C.X0 + 1.03, z: z, hx: 1.0, hz: 0.5, hdx: -1, hdz: 0 });
      slots.push({ x: C.X1 - 1.03, z: z, hx: 1.0, hz: 0.5, hdx: 1, hdz: 0 });
    }
    const mats = [];
    const ss = spin(slots, hsh(b, k, 2, 2, 0x81));
    const want = 3 + (hsh(b, k, 4, 1, 0x82) < 0.5 ? 1 : 0);
    for (let i = 0; i < ss.length && mats.length < want; i++) {
      const s = ss[i];
      const g = first(C, [{ x: s.x, z: s.z, x0: s.x - s.hx, x1: s.x + s.hx, z0: s.z - s.hz, z1: s.z + s.hz }]);
      if (g) mats.push(s);
    }
    // foot of the first mattress: the footlocker
    let foot = null;
    if (mats.length) {
      const m = mats[0], fx = m.x - m.hdx * 1.25, fz = m.z - m.hdz * 1.25;
      const hx = m.hdx ? 0.22 : 0.42, hz = m.hdx ? 0.42 : 0.22;
      foot = first(C, [{ x: fx, z: fz, x0: fx - hx, x1: fx + hx, z0: fz - hz, z1: fz + hz, alongX: !m.hdx }]);
    }
    // wall pieces: rail, TV crate, weapons crate
    function wallSpot(len, deep, salt) {
      const c = [];
      for (let x = C.X0 + len / 2 + 0.1; x <= C.X1 - len / 2 - 0.1; x += 0.8) {
        c.push({ x: x, z: C.Z0 + deep / 2 + 0.03, ax: true, fx: 0, fz: 1 }); c.push({ x: x, z: C.Z1 - deep / 2 - 0.03, ax: true, fx: 0, fz: -1 });
      }
      for (let z = C.Z0 + len / 2 + 0.1; z <= C.Z1 - len / 2 - 0.1; z += 0.8) {
        c.push({ x: C.X0 + deep / 2 + 0.03, z: z, ax: false, fx: 1, fz: 0 }); c.push({ x: C.X1 - deep / 2 - 0.03, z: z, ax: false, fx: -1, fz: 0 });
      }
      const cs = spin(c, hsh(b, k, salt, 3, 0x83 + salt));
      for (let i = 0; i < cs.length; i++) {
        const s = cs[i], hx = s.ax ? len / 2 : deep / 2, hz = s.ax ? deep / 2 : len / 2;
        const ex0 = Math.min(0, s.fx) * 0.6, ex1 = Math.max(0, s.fx) * 0.6, ez0 = Math.min(0, s.fz) * 0.6, ez1 = Math.max(0, s.fz) * 0.6;
        if (freeRect(C, s.x - hx + ex0, s.z - hz + ez0, s.x + hx + ex1, s.z + hz + ez1)) {
          take(C, s.x - hx, s.z - hz, s.x + hx, s.z + hz);
          return s;
        }
      }
      return null;
    }
    const rail = wallSpot(1.5, 0.5, 1);
    const tv = wallSpot(0.9, 0.5, 2);
    const guns = wallSpot(1.25, 0.52, 3);
    return { C: C, mats: mats, foot: foot, rail: rail, tv: tv, guns: guns };
  }

  // ---- THE SHOT-CALLER'S ROOM ----------------------------------------------
  function planBoss(b, r, k) {
    const C = ctx(b, r, k), d = C.door;
    const onZ = Math.abs(d.nz) > 0.5;
    const cs = onZ ? (d.nz > 0 ? 1 : -1) : 1;
    const zw = cs > 0 ? C.Z1 : C.Z0;
    const cx = (C.X0 + C.X1) / 2;
    // his desk at the back, his chair between it and the back wall, looking
    // at whoever comes up the stairs. bossDesk footprint: 2.6 x (1.1 + 1.6).
    const dcands = [];
    const offs = [0, 1.4, -1.4, 2.6, -2.6];
    for (let i = 0; i < offs.length; i++) {
      const x = clamp(cx + offs[i], C.X0 + 1.35, C.X1 - 1.35), z = zw - cs * 1.55;
      dcands.push({ x: x, z: z, x0: x - 1.33, x1: x + 1.33, z0: z - 1.45, z1: z + 1.45 });
    }
    const desk = first(C, dcands);
    if (desk) desk.yaw = cs > 0 ? PI : 0;
    let safe = null;
    if (desk) {
      for (let q = 0; q < 2 && !safe; q++) {
        const sx = desk.x + (q === 0 ? 1 : -1) * 1.75, sz = zw - cs * 0.36;
        safe = first(C, [{ x: sx, z: sz, x0: sx - 0.34, x1: sx + 0.34, z0: sz - 0.34, z1: sz + 0.34 }]);
        if (safe) safe.yaw = cs > 0 ? PI : 0;
      }
    }
    // a sofa against a side wall (its coffee table and a floor lamp with it),
    // the TV on the wall across from it, the gun rack wherever is left
    const sc = [];
    const zc = (C.Z0 + C.Z1) / 2;
    for (let i = 0; i < 3; i++) {
      const z = zc + (i === 0 ? 0 : i === 1 ? 1.3 : -1.3);
      sc.push({ x: C.X0 + 0.47, z: z, x0: C.X0 + 0.02, x1: C.X0 + 1.75, z0: z - 1.5, z1: z + 1.5, yaw: HP });
      sc.push({ x: C.X1 - 0.47, z: z, x0: C.X1 - 1.75, x1: C.X1 - 0.02, z0: z - 1.5, z1: z + 1.5, yaw: -HP });
    }
    const sofa = first(C, spin(sc, hsh(b, k, 3, 3, 0x91)));
    let tv = null;
    if (sofa) {
      const dir = sofa.yaw > 0 ? -1 : 1, wx = dir < 0 ? C.X1 : C.X0, tx = wx + dir * 0.22;
      const tc = [];
      const zo = [0, 0.8, -0.8, 1.6, -1.6];
      for (let i = 0; i < zo.length; i++) {
        const z = sofa.z + zo[i];
        tc.push({ x: tx, z: z, x0: Math.min(wx, tx + dir * 0.25), x1: Math.max(wx, tx + dir * 0.25), z0: z - 0.78, z1: z + 0.78, yaw: dir > 0 ? HP : -HP });
      }
      tv = first(C, tc);
    }
    const rc = [];
    for (let i = 0; i < 3; i++) {
      const z = zc + (i === 0 ? 0 : i === 1 ? -1.5 : 1.5);
      rc.push({ x: C.X1 - 0.2, z: z, x0: C.X1 - 0.95, x1: C.X1 - 0.02, z0: z - 0.75, z1: z + 0.75, yaw: -HP });
      rc.push({ x: C.X0 + 0.2, z: z, x0: C.X0 + 0.02, x1: C.X0 + 0.95, z0: z - 0.75, z1: z + 0.75, yaw: HP });
    }
    const rack = first(C, rc);
    return { C: C, cs: cs, zw: zw, desk: desk, safe: safe, sofa: sofa, tv: tv, rack: rack };
  }

  /* ========================================================================
     2. DRAWING — pieces in building-local metres, standing on B.fy.
     Everything is several parts at its real size, merged into the fit-out's
     buckets (one draw per material per floor); no real lights, the fixtures
     are baked (B.light kind "none" behind a fitting drawn here).
     ======================================================================== */
  const COL = {
    metal: 0x3c4046, steel: 0xaeb3b7, steelD: 0x7d8387, black: 0x17181a,
    crate: 0x8a6a45, crateD: 0x6b5236,
    // a US note, seen as a strapped bundle: the face note is a dark green-grey,
    // the cut edges of a hundred notes read a shade lighter
    billFace: 0x5d6b56, billEdge: 0x86907a,
    rubber: 0xb8864f, glass: 0xcfe3e0, jug: 0xe8ece6, tarp: 0x3f6784, sheet: 0xdfe6e8,
    card: 0xa9875a, cardD: 0x8c6d45, web: 0x151613,
  };
  // currency straps: mustard ($100s), violet ($20s), brown ($50s)
  const STRAPS = [0xc9a13b, 0x8a5aa0, 0x9a6b45];
  const CAN = [0xc0392b, 0x2e6fbf, 0xd8d8d0, 0x2f7d3a, 0xd9a520, 0x1f1f22];
  const SHEETS = [0xc9b8a0, 0x8fa3b8, 0xb89a9a, 0xd8d2c0, 0x7f8f78, 0x9d8ab0];
  const BLANKETS = [0x3f4d6b, 0x6e3434, 0x55613f, 0x5c5c63, 0x7a6248];
  const GARMENTS = [0x2b2d33, 0x6d2c2c, 0x2f4a6d, 0xc9c4b8, 0x3d5a3a, 0x8a6d3b, 0x1c1c1c];

  function mulHex(hex, f) {
    const r = Math.min(255, ((hex >> 16) & 255) * f) | 0, g = Math.min(255, ((hex >> 8) & 255) * f) | 0, b = Math.min(255, (hex & 255) * f) | 0;
    return (r << 16) | (g << 8) | b;
  }
  // A PIECE FRAME. forward = (fx, fz) (axis-aligned), lateral = (fz, -fx);
  // p(lat, up, fwd, across, h, deep, col, o) draws a box whose BOTTOM is at
  // y0 + up; `across` runs along lateral, `deep` along forward.
  function frame(B, x, z, fx, fz, y0) {
    fx = Math.round(fx); fz = Math.round(fz);
    const lx = fz, lz = -fx, fwdX = fx !== 0;
    return function (lat, up, fwd, across, h, deep, col, o) {
      return B.box(x + lat * lx + fwd * fx, y0 + up + h / 2, z + lat * lz + fwd * fz,
        fwdX ? deep : across, h, fwdX ? across : deep, col, o);
    };
  }
  function piece(B, x, z, yaw) { return frame(B, x, z, Math.sin(yaw), Math.cos(yaw), B.fy); }
  // ROUND THINGS from two crossed boxes: an octagon at room scale. Upright
  // (y0 = bottom) and lying (yc = axis height). The twin is a hair shorter so
  // the two caps never share a plane.
  function cyl(B, x, y0, z, r, h, col, o) {
    const a = 2 * r, b2 = a * 0.72;
    B.box(x, y0 + h / 2, z, a, h, b2, col, o);
    B.box(x, y0 + h / 2 - 0.0005, z, b2, h - 0.001, a, col, o);
  }
  function cylH(B, x, yc, z, r, len, ax, col, o) {
    const a = 2 * r, b2 = a * 0.72;
    B.box(x, yc, z, ax ? len : b2, a, ax ? b2 : len, col, o);
    B.box(x, yc, z, ax ? len - 0.001 : a, b2, ax ? a : len - 0.001, col, o);
  }
  // a thin square ring (lamp cages, pot rims, tank collars)
  function ring(B, x, y, z, r, t, col) {
    B.box(x, y, z - r, 2 * r, t, t, col); B.box(x, y, z + r, 2 * r, t, t, col);
    B.box(x - r, y, z, t, t, 2 * r - t, col); B.box(x + r, y, z, t, t, 2 * r - t, col);
  }
  function seatAt(wx, y, wz, face, kind, cushion, lot) {
    if (!CBZ.propRegisterSeat) return null;
    const near = CBZ.propNearestSeat ? CBZ.propNearestSeat(wx, wz, 0.2, y) : null;
    if (near) return near;
    return CBZ.propRegisterSeat(wx, y, wz, face, kind, lot || null, { cushion: cushion, floorBelow: 0 });
  }

  // ---- FIXTURES (the fitting is drawn here; the light is baked) -------------
  // a bare bulb in a wire cage on a cord: the count table, the crash floor
  function cageLight(B, x, z, o) {
    o = o || {};
    const drop = o.drop || 0.55, yb = B.ceil - drop, wire = 0x2a2a2a;
    B.box(x, B.ceil - 0.012, z, 0.1, 0.024, 0.1, 0xd6d2c8);                       // ceiling rose
    B.box(x, B.ceil - drop / 2, z, 0.009, drop, 0.009, 0x151515);                 // cord
    B.box(x, yb - 0.035, z, 0.042, 0.07, 0.042, 0x1c1c1e);                         // lampholder
    B.box(x, yb - 0.105, z, 0.058, 0.075, 0.058, 0xfff2cc, { glow: true });        // the bulb
    if (o.cage !== false) {
      const r = 0.05;
      B.box(x - r, yb - 0.105, z, 0.005, 0.13, 0.005, wire); B.box(x + r, yb - 0.105, z, 0.005, 0.13, 0.005, wire);
      B.box(x, yb - 0.105, z - r, 0.005, 0.13, 0.005, wire); B.box(x, yb - 0.105, z + r, 0.005, 0.13, 0.005, wire);
      ring(B, x, yb - 0.04, z, r, 0.005, wire);
      ring(B, x, yb - 0.17, z, r * 0.6, 0.005, wire);
    }
    return B.light(x, z, { kind: "none", y: yb - 0.005, r: o.r || 4.2, i: o.i == null ? 0.7 : o.i,
      color: o.color == null ? 0xffdca0 : o.color, rect: o.rect || null });
  }
  // a twin-tube shop light on two chains: the cook's bench
  function shopLight(B, x, z, ax, o) {
    o = o || {};
    const L = 1.22, drop = o.drop || 0.5, yb = B.ceil - drop;
    for (let s = -1; s <= 1; s += 2) {
      const px = x + (ax ? s * 0.45 : 0), pz = z + (ax ? 0 : s * 0.45);
      B.box(px, B.ceil - drop / 2, pz, 0.012, drop, 0.012, 0x4a4a4a);             // chain
      B.box(px, B.ceil - 0.006, pz, 0.05, 0.012, 0.05, 0x4a4a4a);                  // hook plate
    }
    B.box(x, yb - 0.03, z, ax ? L : 0.21, 0.05, ax ? 0.21 : L, 0xe6e6e0);          // reflector
    B.box(x, yb - 0.005, z, ax ? L - 0.1 : 0.08, 0.02, ax ? 0.08 : L - 0.1, 0xb8bab8);   // ballast box
    for (let s = -1; s <= 1; s += 2)
      B.box(x + (ax ? 0 : s * 0.05), yb - 0.07, z + (ax ? s * 0.05 : 0), ax ? L - 0.06 : 0.028, 0.028, ax ? 0.028 : L - 0.06, 0xfdfcf4, { glow: true });
    return B.light(x, z, { kind: "none", y: yb - 0.07 + 0.1, r: o.r || 4.8, i: o.i == null ? 0.7 : o.i,
      color: o.color == null ? 0xf4f6ff : o.color, rect: o.rect || null });
  }

  // ---- CEILINGS --------------------------------------------------------------
  // a drywall ceiling on the slab's underside, grubby, a leak's tide mark or two
  function drywallCeiling(B, x0, z0, x1, z1, tint, salt) {
    const y = B.ceil - 0.01;
    B.plane(x0, z0, x1, z1, y, "plaster", tint, { down: true, cell: 0.9 });
    const stain = mulHex(tint, 0.86);
    for (let i = 0; i < 2; i++) {
      if (B.h(i, 3, salt) < 0.35) continue;
      const cx = x0 + 1 + B.h(i, 1, salt) * Math.max(0.1, x1 - x0 - 2), cz = z0 + 1 + B.h(i, 2, salt) * Math.max(0.1, z1 - z0 - 2);
      if (!B.clear(cx, cz, 0.6)) continue;
      // three offset blotches, each a millimetre lower than the last: a
      // ragged tide mark, not concentric squares
      const w = 0.5 + B.h(i, 4, salt) * 0.5;
      B.box(cx, y - 0.002, cz, w, 0.002, w * 0.7, stain, { mat: "plaster", faces: 8 });
      B.box(cx + w * 0.3, y - 0.003, cz + w * 0.15, w * 0.6, 0.002, w * 0.55, stain, { mat: "plaster", faces: 8 });
      B.box(cx - w * 0.2, y - 0.004, cz - w * 0.25, w * 0.45, 0.002, w * 0.4, mulHex(stain, 0.9), { mat: "plaster", faces: 8 });
    }
  }
  // a gutted ceiling: the floorboards of the storey above on exposed joists
  // (16" centres, spanning the short way), clipped round the stair well
  function joistCeiling(B, x0, z0, x1, z1) {
    const top = B.ceil - 0.01, jh = 0.2;
    B.plane(x0, z0, x1, z1, top, "wood", 0xa8977e, { down: true, cell: 0.9 });
    const alongX = (x1 - x0) <= (z1 - z0);          // joists span the short way
    const holes = B.holes ? B.holes() : [];
    const span0 = alongX ? x0 : z0, span1 = alongX ? x1 : z1;
    const run0 = alongX ? z0 : x0, run1 = alongX ? z1 : x1;
    for (let u = run0 + 0.2; u <= run1 - 0.1; u += 0.406) {
      // the clear runs of this joist
      let segs = [[span0, span1]];
      for (let h = 0; h < holes.length; h++) {
        const R = holes[h];
        const hu0 = alongX ? R.z0 : R.x0, hu1 = alongX ? R.z1 : R.x1;
        if (u + 0.03 < hu0 || u - 0.03 > hu1) continue;
        const hs0 = alongX ? R.x0 : R.z0, hs1 = alongX ? R.x1 : R.z1;
        const nx = [];
        for (let s = 0; s < segs.length; s++) {
          const a = segs[s][0], c = segs[s][1];
          if (hs1 <= a || hs0 >= c) { nx.push(segs[s]); continue; }
          if (hs0 > a) nx.push([a, hs0]);
          if (hs1 < c) nx.push([hs1, c]);
        }
        segs = nx;
      }
      for (let s = 0; s < segs.length; s++) {
        const a = segs[s][0], c = segs[s][1];
        if (c - a < 0.3) continue;
        if (alongX) B.box((a + c) / 2, top - jh / 2, u, c - a, jh, 0.045, 0x9a8466, { mat: "wood", uv: 1.2 });
        else B.box(u, top - jh / 2, (a + c) / 2, 0.045, jh, c - a, 0x9a8466, { mat: "wood", uv: 1.2 });
      }
    }
  }

  // ---- WALLS -------------------------------------------------------------------
  // the four facade faces, cut round the windows and the street door into the
  // rects of wall actually there: [{W, a0, a1, y0, y1}]
  function facadeWalls(B) {
    const b = B.b, wt = wtOf(b), hw = b.w / 2 - wt, hd = b.d / 2 - wt;
    return [
      { axis: "x", at: -hd, side: 1, lo: -hw, hi: hw }, { axis: "x", at: hd, side: -1, lo: -hw, hi: hw },
      { axis: "z", at: -hw, side: 1, lo: -hd, hi: hd }, { axis: "z", at: hw, side: -1, lo: -hd, hi: hd },
    ];
  }
  function wallRects(B, withDoor) {
    const d = doorOf(B.b), wins = B.windows(), walls = facadeWalls(B);
    const top = B.ceil, bot = B.fy, out = [];
    for (let wi = 0; wi < walls.length; wi++) {
      const W = walls[wi], ops = [];
      W.face = W.axis === "x" ? (W.side > 0 ? 16 : 32) : (W.side > 0 ? 1 : 2);
      W.door = null;
      for (let i = 0; i < wins.length; i++) {
        const w = wins[i];
        if (w.axis !== W.axis || w.side !== -W.side) continue;
        const c = W.axis === "x" ? w.x : w.z;
        ops.push({ a0: c - w.hw - 0.02, a1: c + w.hw + 0.02, v0: Math.max(bot, w.y - w.hh - 0.02), v1: Math.min(top, w.y + w.hh + 0.02) });
      }
      if (withDoor) {
        const on = W.axis === "x" ? Math.abs(d.nz - W.side) < 0.01 : Math.abs(d.nx - W.side) < 0.01;
        if (on) {
          const c = W.axis === "x" ? d.x : d.z;
          W.door = [c - DOORW / 2 - 0.08, c + DOORW / 2 + 0.08];
          ops.push({ a0: W.door[0], a1: W.door[1], v0: bot, v1: Math.min(top, B.y0 + 2.6) });
        }
      }
      ops.sort(function (p, q) { return p.a0 - q.a0; });
      const put = function (a, c, ya, yb) { if (c - a >= 0.02 && yb - ya >= 0.02) out.push({ W: W, a0: a, a1: c, y0: ya, y1: yb }); };
      let cur = W.lo;
      for (let i = 0; i < ops.length; i++) {
        const o = ops[i];
        const a0 = Math.max(cur, o.a0), a1 = Math.min(W.hi, o.a1);
        put(cur, a0, bot, top);
        if (a1 > a0) { put(a0, a1, bot, o.v0); put(a0, a1, o.v1, top); }
        cur = Math.max(cur, a1);
      }
      put(cur, W.hi, bot, top);
    }
    return out;
  }
  function wallBox(B, W, a0, a1, y0, y1, off, th, col, o) {
    const at = W.at + W.side * (off + th / 2);
    if (W.axis === "x") return B.box((a0 + a1) / 2, (y0 + y1) / 2, at, a1 - a0, y1 - y0, th, col, o);
    return B.box(at, (y0 + y1) / 2, (a0 + a1) / 2, th, y1 - y0, a1 - a0, col, o);
  }
  // THE FINISH over the facade's inside: real brick at real coursing (fitout.js
  // draws it 20 x 7.6 cm) or painted plaster, full height, a painted skirting broken at
  // the street door, and a leak's streak down a stretch of blank wall.
  function skinWalls(B, mat, tint, withDoor, o) {
    o = o || {};
    const rects = wallRects(B, withDoor);
    const stain = mulHex(tint, mat === "brick" ? 0.72 : 0.84);
    const salt = o.salt || 0x5e;
    let streaks = 0;
    for (let i = 0; i < rects.length; i++) {
      const R = rects[i];
      wallBox(B, R.W, R.a0, R.a1, R.y0, R.y1, 0.007, 0.01, tint, { mat: mat, faces: R.W.face });
      // a tapered leak streak from the ceiling on a full-height blank stretch
      if (streaks < 3 && R.y0 <= B.fy + 0.01 && R.y1 >= B.ceil - 0.01 && R.a1 - R.a0 > 1.3 && B.h(i, 1, salt) < 0.45) {
        const c = R.a0 + 0.5 + B.h(i, 2, salt) * (R.a1 - R.a0 - 1.0), top = B.ceil;
        const tiers = [[0.46, 0.0, 0.42], [0.3, 0.42, 0.95], [0.16, 0.95, 1.5]];
        for (let t = 0; t < tiers.length; t++)
          wallBox(B, R.W, c - tiers[t][0] / 2, c + tiers[t][0] / 2, top - tiers[t][2], top - tiers[t][1], 0.0175, 0.002, stain, { mat: mat, faces: R.W.face });
        streaks++;
      }
    }
    // skirting: painted timber, 12 cm, a proud top edge; broken at the door
    const walls = [];
    for (let i = 0; i < rects.length; i++) if (walls.indexOf(rects[i].W) < 0) walls.push(rects[i].W);
    const sk = o.skirt == null ? 0x4a443e : o.skirt;
    for (let wi = 0; wi < walls.length; wi++) {
      const W = walls[wi];
      const runs = W.door ? [[W.lo, W.door[0]], [W.door[1], W.hi]] : [[W.lo, W.hi]];
      for (let r = 0; r < runs.length; r++) {
        if (runs[r][1] - runs[r][0] < 0.05) continue;
        wallBox(B, W, runs[r][0], runs[r][1], B.fy, B.fy + 0.11, 0.012, 0.018, sk, { faces: W.face | 4 });
        wallBox(B, W, runs[r][0], runs[r][1], B.fy + 0.11, B.fy + 0.125, 0.012, 0.01, mulHex(sk, 1.15), { faces: W.face | 4 });
      }
    }
    return rects;
  }
  // POLY SHEETING taped over the walls of a cook room: the same wall rects,
  // clear film a few centimetres off the finish (never over a window)
  function sheetWalls(B, rects, onlyAxis) {
    for (let i = 0; i < rects.length; i++) {
      const R = rects[i];
      if (onlyAxis && R.W.axis !== onlyAxis) continue;
      if (R.y1 - R.y0 < 0.5) continue;
      wallBox(B, R.W, R.a0 + 0.02, R.a1 - 0.02, Math.max(R.y0, B.fy + 0.02), R.y1 - 0.03, 0.05, 0.004, COL.sheet, { glass: true });
    }
  }

  // ---- WINDOWS: panes merged into the openings they are, then covered --------
  function winRuns(B, cut) {
    const all = B.windows(), W = [];
    for (let i = 0; i < all.length; i++) {
      const w = all[i];
      if (w.y < B.fy + 0.3 || w.y > B.ceil) continue;
      W.push({ axis: w.axis, side: w.side, y: w.y, hh: w.hh, c: w.axis === "x" ? w.x : w.z, hw: w.hw });
    }
    W.sort(function (p, q) {
      return (p.axis < q.axis ? -1 : p.axis > q.axis ? 1 : 0) || (p.side - q.side) || (Math.round(p.y * 10) - Math.round(q.y * 10)) || (p.c - q.c);
    });
    const runs = [];
    for (let i = 0; i < W.length; i++) {
      const w = W[i], r = runs[runs.length - 1];
      if (r && r.axis === w.axis && r.side === w.side && Math.abs(r.y - w.y) < 0.1 && Math.abs(r.hh - w.hh) < 0.1 && w.c - w.hw <= r.a1 + 0.35) {
        r.a1 = Math.max(r.a1, w.c + w.hw); r.n++;
      } else runs.push({ axis: w.axis, side: w.side, y: w.y, hh: w.hh, a0: w.c - w.hw, a1: w.c + w.hw, n: 1, first: w });
    }
    // an opening that runs past a partition is dressed as two, one per room
    if (cut) for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i];
      if (r.axis !== cut.axis || !(cut.at > r.a0 + 0.1 && cut.at < r.a1 - 0.1)) continue;
      const r2 = Object.assign({}, r, { a0: cut.at + 0.09, first: null });
      r.a1 = cut.at - 0.09;
      runs.splice(i + 1, 0, r2);
    }
    return runs;
  }
  // is there an opening on the facade wall at x = wx (axis "z" runs) or
  // z = wz (axis "x" runs) between a0..a1 and heights y0..y1? (wall-hung things
  // never hang in front of glass)
  function windowAt(B, onX, wallAt, a0, a1, y0, y1) {
    const runs = winRuns(B);
    for (let i = 0; i < runs.length; i++) {
      const r = runs[i];
      if ((r.axis === "z") !== onX) continue;                 // "z" runs sit on the ±x walls
      if (Math.sign(wallAt) !== r.side) continue;
      if (r.a1 + 0.05 < a0 || r.a0 - 0.05 > a1) continue;
      if (r.y + r.hh < y0 || r.y - r.hh > y1) continue;
      return true;
    }
    return false;
  }
  // what covers each opening on the inside: pick(run, i) -> "curtain"|"board"|"foil"|"fan"|null
  function dressWindows(B, pick, cut) {
    const b = B.b, wt = wtOf(b), runs = winRuns(B, cut);
    for (let i = 0; i < runs.length; i++) {
      const w = runs[i];
      const kind = pick(w, i);
      if (!kind) continue;
      const alongX = w.axis === "x";
      const face = alongX ? w.side * (b.d / 2 - wt) : w.side * (b.w / 2 - wt);
      const at = function (off) { return face - w.side * off; };
      const bx = function (a, y, off, len, h, th, col, o) {
        if (alongX) B.box(a, y, at(off), len, h, th, col, o);
        else B.box(at(off), y, a, th, h, len, col, o);
      };
      const c = (w.a0 + w.a1) / 2, W2 = w.a1 - w.a0, yb = w.y - w.hh, yt = Math.min(B.ceil - 0.04, w.y + w.hh);
      const board = function (a0, a1, y0, y1) {
        if (a1 - a0 < 0.05 || y1 - y0 < 0.05) return;
        // PLYWOOD, the way a window is actually boarded: 1.22 m sheets screwed
        // over the opening, a dark 4 mm gap at every joint, weathered tone
        // varying sheet to sheet, a line of screw heads round each edge. (It
        // was the oak FLOOR texture stood on end: 20 cm "planks" across the
        // whole wall, reading as panelling.)
        const L = a1 - a0, n = Math.max(1, Math.ceil(L / 1.22)), sw = L / n, H = y1 - y0;
        bx((a0 + a1) / 2, (y0 + y1) / 2, 0.022, L, H, 0.006, 0x2a2622);                    // shadow behind the joints
        for (let q = 0; q < n; q++) {
          const s0 = a0 + q * sw, sc = s0 + sw / 2;
          const tone = mulHex(0xb89c74, 0.84 + 0.18 * B.h(sc, y0, 0x91 + q));
          bx(sc, (y0 + y1) / 2, 0.036, sw - 0.004, H - 0.004, 0.018, tone, { mat: "plaster", uv: 0.9 });
          const nS = Math.max(2, Math.round(H / 0.35));
          for (let r = 0; r <= nS; r++) for (const e of [-1, 1]) bx(sc + e * (sw / 2 - 0.03), y0 + 0.03 + r * (H - 0.06) / nS, 0.046, 0.012, 0.012, 0.004, 0x3a3632);
          for (const yy of [y0 + 0.03, y1 - 0.03]) for (let r = 1; r < 3; r++) bx(s0 + r * sw / 3, yy, 0.046, 0.012, 0.012, 0.004, 0x3a3632);
        }
      };
      if (kind === "curtain") {
        const ytop = Math.min(B.ceil - 0.05, yt + 0.14), ybot = Math.max(B.fy + 0.02, yb - 0.12);
        bx(c, ytop + 0.02, 0.07, W2 + 0.34, 0.022, 0.022, 0x3a3a3a);                    // rod
        for (let s = -1; s <= 1; s += 2) bx(c + s * (W2 / 2 + 0.14), ytop + 0.02, 0.035, 0.03, 0.05, 0.05, 0x3a3a3a);   // brackets
        const col = SHEETS[Math.floor(B.h(c, w.y, 0xa1 + i) * SHEETS.length) % SHEETS.length];
        const pulled = B.h(c, w.y, 0xa2 + i) < 0.5;
        // two panels, each pleated: strips alternating depth and shade
        const full = W2 + 0.26, panel = pulled ? Math.min(full * 0.28, 0.9) : full / 2;
        for (let s = -1; s <= 1; s += 2) {
          const pa0 = s < 0 ? c - full / 2 : c + full / 2 - panel;
          const n = Math.max(2, Math.round(panel / 0.12));
          const pw = panel / n;
          for (let q = 0; q < n; q++)
            bx(pa0 + (q + 0.5) * pw, (ytop + ybot) / 2, (q & 1) ? 0.1 : 0.085, pw + 0.004, ytop - ybot, 0.012, (q & 1) ? col : mulHex(col, 0.86));
        }
      } else if (kind === "board") {
        board(w.a0 - 0.06, w.a1 + 0.06, yb - 0.06, yt + 0.06);
      } else if (kind === "brick") {
        // BRICKED UP: the opening filled with the wall's own brick, a touch
        // cleaner than the old wall around it, a concrete lintel and sill
        // marking where the window was. A count room has no windows.
        const t = B.brickTint || 0xc9bdb2;
        bx(c, (yb + yt) / 2, 0.012, W2 + 0.02, yt - yb + 0.02, 0.012, mulHex(t, 1.05), { mat: "brick" });
        bx(c, yt + 0.05, 0.02, W2 + 0.2, 0.1, 0.02, 0xa8a49c, { mat: "concrete" });
        bx(c, yb - 0.03, 0.03, W2 + 0.2, 0.06, 0.04, 0xa8a49c, { mat: "concrete" });
      } else if (kind === "foil") {
        bx(c, (yb + yt) / 2, 0.02, W2 + 0.06, yt - yb + 0.06, 0.004, 0xc9ced2);
        bx(c, yt + 0.02, 0.024, W2 + 0.1, 0.045, 0.004, 0xb49a62);                     // tape
        bx(c, yb - 0.02, 0.024, W2 + 0.1, 0.045, 0.004, 0xb49a62);
      } else if (kind === "fan") {
        // a box fan standing on the sill of the first pane, blowing out;
        // the rest of the opening boarded round it
        const f = w.first, fs = Math.min(0.52, f.hw * 2 - 0.04, w.hh * 2 - 0.04);
        const fc = f.c, fy0 = yb + 0.01;
        // (it stands IN the reveal, on the sill, its grille flush with the room face)
        bx(fc, fy0 + fs / 2, -0.06, fs, fs, 0.11, 0xd9d9d3);                             // housing
        bx(fc, fy0 + fs / 2, 0.0, fs - 0.05, fs - 0.05, 0.004, 0x2b2b2b);               // grille
        for (let q = -2; q <= 2; q++) bx(fc + q * (fs - 0.05) / 5, fy0 + fs / 2, 0.004, 0.006, fs - 0.06, 0.004, 0xbdbdb6);   // grille bars
        bx(fc, fy0 + fs / 2, 0.008, 0.07, 0.07, 0.006, 0x9a9a94);                        // hub
        bx(fc + fs * 0.34, fy0 + fs + 0.012, -0.06, 0.05, 0.024, 0.04, 0x4a4a4a);        // speed knob
        bx(fc, fy0 + fs + 0.01, -0.06, 0.12, 0.02, 0.03, 0xbdbdb6);                       // carry handle
        board(w.a0 - 0.06, fc - fs / 2 - 0.01, yb - 0.06, yt + 0.06);
        board(fc + fs / 2 + 0.01, w.a1 + 0.06, yb - 0.06, yt + 0.06);
        board(fc - fs / 2 - 0.01, fc + fs / 2 + 0.01, fy0 + fs + 0.05, yt + 0.06);
      }
    }
  }

  // ---- LOOSE FURNITURE ---------------------------------------------------------
  function foldChair(B, x, z, yaw, seat) {
    const p = piece(B, x, z, yaw), m = COL.metal, s = 0x5d6166;
    for (let a = -1; a <= 1; a += 2) {
      p(a * 0.19, 0, 0.17, 0.025, 0.42, 0.025, m);             // front legs
      p(a * 0.19, 0, -0.19, 0.025, 0.86, 0.025, m);            // rear legs, up into the back
      p(a * 0.19, 0.4, -0.01, 0.022, 0.022, 0.36, m);           // seat rails
    }
    p(0, 0.18, 0.17, 0.36, 0.02, 0.02, m);                     // stretchers
    p(0, 0.18, -0.19, 0.36, 0.02, 0.02, m);
    p(0, 0.42, 0, 0.42, 0.03, 0.42, s);                        // seat -> 0.45
    p(0, 0.6, -0.195, 0.4, 0.22, 0.022, s);                    // back panel
    if (seat) seatAt(B.ox + x, B.fy, B.oz + z, yaw, "chair", 0.45, B.lot);
  }
  function crateBox(B, x, y0, z, w, h, d, col, o) {
    B.box(x, y0 + h / 2, z, w, h, d, col, o);
    // proud slats round it and a lid rim: reads as a crate
    B.box(x, y0 + h * 0.25, z, w + 0.02, 0.07, d + 0.02, COL.crateD);
    B.box(x, y0 + h * 0.75, z, w + 0.02, 0.07, d + 0.02, COL.crateD);
    for (let a = -1; a <= 1; a += 2) for (let c = -1; c <= 1; c += 2)
      B.box(x + a * (w / 2 - 0.02), y0 + h / 2, z + c * (d / 2 - 0.02), 0.05, h - 0.004, 0.05, COL.crateD);   // corner posts
    B.box(x, y0 + h + 0.01, z, w * 0.96, 0.02, d * 0.96, col);
    return y0 + h + 0.02;
  }
  function milkCrate(B, x, y0, z, col) {
    const s = 0.33, t = 0.02, dk = mulHex(col, 0.75);
    B.box(x, y0 + 0.01, z, s, 0.02, s, col);
    for (let q = 0; q < 2; q++) {                             // walls: a top rail, a base rail, a grid of bars
      const yy = q ? y0 + s - 0.02 : y0 + 0.04;
      B.box(x, yy, z - s / 2 + 0.01, s, 0.04, t, col); B.box(x, yy, z + s / 2 - 0.01, s, 0.04, t, col);
      B.box(x - s / 2 + 0.01, yy, z, t, 0.04, s - 0.04, col); B.box(x + s / 2 - 0.01, yy, z, t, 0.04, s - 0.04, col);
    }
    for (let i = -1; i <= 1; i++) {
      B.box(x + i * 0.1, y0 + s / 2, z - s / 2 + 0.01, 0.02, s - 0.08, t, dk); B.box(x + i * 0.1, y0 + s / 2, z + s / 2 - 0.01, 0.02, s - 0.08, t, dk);
      B.box(x - s / 2 + 0.01, y0 + s / 2, z + i * 0.1, t, s - 0.08, 0.02, dk); B.box(x + s / 2 - 0.01, y0 + s / 2, z + i * 0.1, t, s - 0.08, 0.02, dk);
    }
    return y0 + s;
  }
  function can(B, x, y, z, col, lying, alongX) {
    if (lying) cylH(B, x, y + 0.033, z, 0.033, 0.123, alongX, col);
    else { cyl(B, x, y, z, 0.033, 0.118, col); cyl(B, x, y + 0.118, z, 0.027, 0.004, 0xc8c8c8); }
  }
  function ashtray(B, x, y, z) {
    cyl(B, x, y, z, 0.06, 0.028, 0x55595e);
    B.box(x, y + 0.029, z, 0.09, 0.002, 0.09, 0x2a2b2c);                            // ash
    B.box(x + 0.02, y + 0.034, z, 0.05, 0.008, 0.009, 0xe8e2d0);                     // butts
    B.box(x - 0.02, y + 0.034, z + 0.02, 0.009, 0.008, 0.045, 0xe8e2d0);
    B.box(x + 0.035, y + 0.034, z + 0.035, 0.012, 0.008, 0.009, 0xc98a4a);           // filter tips
  }
  function pizzaBox(B, x, y, z, n) {
    for (let i = 0; i < n; i++) {
      const yy = y + i * 0.046, xx = x + i * 0.03, zz = z - i * 0.02, c = i & 1 ? 0xc9a46b : 0xd3b27a;
      B.box(xx, yy + 0.021, zz, 0.4, 0.042, 0.4, c);
      B.box(xx, yy + 0.043, zz, 0.36, 0.002, 0.36, mulHex(c, 0.93));               // the lid's printed panel
      if (i === 0) B.box(xx + 0.12, yy + 0.044, zz - 0.1, 0.1, 0.002, 0.08, 0x8a5a38);   // grease spot
    }
    return y + n * 0.046;
  }
  // a full black bin bag, knotted: a sagging lump, not a cube
  function trashBag(B, x, z, s) {
    const y = B.fy, k = 0x141518;
    B.box(x, y + 0.14 * s, z, 0.46 * s, 0.28 * s, 0.42 * s, k);
    B.box(x + 0.01, y + 0.2 * s, z - 0.01, 0.52 * s, 0.2 * s, 0.38 * s, k);
    B.box(x, y + 0.36 * s, z + 0.01, 0.34 * s, 0.14 * s, 0.3 * s, k);
    B.box(x, y + 0.46 * s, z, 0.12 * s, 0.07 * s, 0.1 * s, k);
    B.box(x + 0.05 * s, y + 0.5 * s, z, 0.1 * s, 0.03 * s, 0.03 * s, k);          // knot ears
    B.box(x - 0.05 * s, y + 0.5 * s, z, 0.1 * s, 0.03 * s, 0.03 * s, k);
  }
  // a TV on a crate: the screen faces `yaw`
  function tvOnCrate(B, x, z, yaw, on) {
    const alongX = (Math.round(yaw / HP) & 1) === 0;
    const w = alongX ? 0.86 : 0.46, d = alongX ? 0.46 : 0.86;
    const ct = crateBox(B, x, B.fy, z, w, 0.46, d, COL.crate, { solid: true });
    flatTV(B, x, z, yaw, ct - B.fy, on, 0.98);
  }
  // a flat screen on its foot, `up` above the floor; `W` the body width
  function flatTV(B, x, z, yaw, up, on, W) {
    const p = piece(B, x, z, yaw), H = W * 0.59;
    p(0, up, 0, W * 0.32, 0.02, 0.2, COL.black);                  // foot
    p(0, up + 0.02, -0.02, 0.06, 0.08, 0.04, COL.black);          // neck
    p(0, up + 0.08, -0.02, W, H, 0.06, COL.black);                // body
    p(0, up + 0.1, 0.012, W - 0.04, H - 0.04, 0.008, on ? 0x3d5f82 : 0x0f1317, on ? { glow: true } : null);
    if (on) B.lamp(x + Math.sin(yaw) * 0.5, z + Math.cos(yaw) * 0.5, B.fy + up + 0.35, { color: 0x8fb4ff, r: 2.4, i: 0.22 });
  }
  // a folding table (top at 0.74); returns the top y
  function foldTable(B, x, z, alongX, L, W, topCol) {
    const lx = alongX ? L : W, lz = alongX ? W : L;
    B.box(x, B.fy + 0.722, z, lx, 0.036, lz, topCol || 0xcfc8b6);
    B.box(x, B.fy + 0.742, z, lx - 0.004, 0.004, lz - 0.004, mulHex(topCol || 0xcfc8b6, 0.94));   // the worn top sheet
    B.box(x, B.fy + 0.69, z, lx - 0.06, 0.028, lz - 0.06, COL.metal);                   // apron
    for (let a = -1; a <= 1; a += 2) for (let c = -1; c <= 1; c += 2)
      B.box(x + a * (lx / 2 - 0.06), B.fy + 0.345, z + c * (lz / 2 - 0.06), 0.03, 0.69, 0.03, COL.metal);
    for (let a = -1; a <= 1; a += 2)                                                  // leg braces
      if (alongX) B.box(x + a * (lx / 2 - 0.06), B.fy + 0.12, z, 0.02, 0.02, lz - 0.12, COL.metal);
      else B.box(x, B.fy + 0.12, z + a * (lz / 2 - 0.06), lx - 0.12, 0.02, 0.02, COL.metal);
    B.solid(x - lx / 2, x + lx / 2, z - lz / 2, z + lz / 2, B.fy, B.fy + 0.76);
    return B.fy + 0.744;
  }

  // ---- MONEY -----------------------------------------------------------------
  // ONE STRAPPED BUNDLE: 100 notes, 15.6 x 6.6 x 1.5 cm, a paper strap round
  // the middle. p is a frame; rot turns the long side onto the fwd axis.
  function bundle(p, a, up, c, strap, rot) {
    const L = rot ? 0.066 : 0.156, D = rot ? 0.156 : 0.066;
    p(a, up, c, L, 0.0128, D, COL.billEdge);
    p(a, up + 0.0128, c, L - 0.003, 0.0018, D - 0.003, COL.billFace);
    p(a, up, c, rot ? L + 0.003 : 0.034, 0.0154, rot ? 0.034 : D + 0.003, strap);
  }
  // a brick of bundles: nx along lat, nz along fwd, n high
  function brick(p, a, up, c, nx, nz, n, strap) {
    for (let k = 0; k < n; k++) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++)
      bundle(p, a + (i - (nx - 1) / 2) * 0.158, up + k * 0.0152, c + (j - (nz - 1) / 2) * 0.068, strap, false);
    return up + n * 0.0152;
  }
  // loose counted notes, rubber-banded, in an untidy pile
  function loosePile(p, a, up, c, n, h) {
    for (let k = 0; k < n; k++) {
      const rot = h(k, 21) < 0.3;
      const da = (h(k, 22) - 0.5) * 0.05, dc = (h(k, 23) - 0.5) * 0.04;
      const L = rot ? 0.066 : 0.156, D = rot ? 0.156 : 0.066, yy = up + k * 0.011;
      p(a + da, yy, c + dc, L, 0.009, D, COL.billEdge);
      p(a + da, yy + 0.009, c + dc, L - 0.003, 0.0016, D - 0.003, COL.billFace);
      p(a + da + (rot ? 0 : 0.03), yy, c + dc + (rot ? 0.03 : 0), rot ? L + 0.002 : 0.004, 0.0112, rot ? 0.004 : D + 0.002, COL.rubber);   // the band
    }
  }
  function pistol(p, a, up, c) {
    // a compact pistol lying on its side, muzzle along -lat, grip toward +fwd
    p(a, up, c, 0.186, 0.028, 0.03, 0x1b1c1e);                  // slide
    p(a - 0.075, up + 0.028, c, 0.03, 0.002, 0.028, 0x2a2b2e);  // rear serrations
    p(a + 0.01, up, c + 0.026, 0.15, 0.024, 0.024, 0x222326);   // frame
    p(a - 0.015, up, c + 0.052, 0.046, 0.006, 0.03, 0x222326);  // trigger guard
    p(a - 0.02, up, c + 0.046, 0.006, 0.02, 0.012, 0x0f0f10);   // trigger
    p(a - 0.062, up, c + 0.082, 0.052, 0.026, 0.07, 0x202124);  // grip
    p(a - 0.066, up, c + 0.12, 0.056, 0.022, 0.008, 0x151516);  // magazine base
  }
  function digitalScale(p, a, up, c) {
    p(a, up, c, 0.2, 0.024, 0.2, 0x2b2e32);                     // body
    p(a, up + 0.024, c - 0.015, 0.17, 0.006, 0.15, 0xb9bec2);   // platter
    p(a, up + 0.006, c + 0.1, 0.075, 0.014, 0.003, 0x9fe8a8, { glow: true });   // LCD
    p(a + 0.06, up + 0.01, c + 0.1, 0.02, 0.008, 0.003, 0x8a8e92);
  }

  // THE COUNT TABLE: a bill counter, strapped bricks, a banded pile in front
  // of the counter, a ledger, a scale, a pistol. `full` false = the count is
  // gone (torn straps and rubber bands). `sgn` is the side the counter sits on.
  function countTable(B, x, z, alongX, full, h, sgn) {
    const T = foldTable(B, x, z, alongX, 1.8, 0.9, 0xd2cbb8);
    const sg = sgn < 0 ? -1 : 1;
    // lat = along the table, fwd = across it toward the counter's chair
    const p = alongX ? frame(B, x, z, 0, sg, T) : frame(B, x, z, sg, 0, T);
    // THE BILL COUNTER (~28 x 26 x 22 cm): notes go in the sloped hopper at
    // the back, drop counted into the stacker pocket at the front, the count
    // shows on the LCD facing him.
    // Two-tone like the real machines: a light grey body, a dark top deck.
    // The hopper is an open V of bright guide wings rising at the BACK with a
    // fan of notes leaning in it; the stacker pocket is a dark mouth at the
    // FRONT with the counted stack in it; the display and keys sit on the top
    // deck, angled to the man counting. (It read as a grey box with a slot.)
    const mA = -0.48, mk = 0xc4c7c9, mkD = 0x1d1f22, TOPC = 0x2e3236, WING = 0xb9bec4;
    p(mA, 0, 0.06, 0.28, 0.13, 0.26, mk);                          // body
    p(mA, 0, 0.06, 0.29, 0.012, 0.27, 0x2a2d31);                   // rubber feet line
    p(mA, 0.13, 0.1, 0.28, 0.025, 0.18, TOPC);                     // top deck
    p(mA - 0.05, 0.155, 0.13, 0.12, 0.006, 0.07, 0x1a1c1e);        // display bezel
    p(mA - 0.05, 0.161, 0.13, 0.1, 0.002, 0.05, 0x9fe8a0, { glow: true });   // display
    for (let q = 0; q < 4; q++) p(mA + 0.04 + q * 0.024, 0.157, 0.14, 0.018, 0.008, 0.018, q ? 0x8a8e92 : 0xb8453a);   // keys
    p(mA, 0.13, -0.04, 0.24, 0.012, 0.1, mkD);                     // hopper bed
    for (let s = -1; s <= 1; s += 2) {
      p(mA + s * 0.118, 0.13, -0.03, 0.01, 0.1, 0.12, WING);        // hopper guide wings
      p(mA + s * 0.118, 0.23, -0.075, 0.01, 0.05, 0.05, WING);      //   ...their raised backs
    }
    p(mA, 0.13, -0.095, 0.25, 0.16, 0.012, 0x2a2d31);              // hopper back plate
    p(mA, 0.0, 0.2, 0.2, 0.012, 0.08, mkD);                        // stacker pocket floor
    p(mA, 0.012, 0.2, 0.2, 0.07, 0.004, mkD);                      // pocket mouth (dark)
    for (let s = -1; s <= 1; s += 2) p(mA + s * 0.1, 0.0, 0.2, 0.012, 0.08, 0.08, 0x3a3e42);   // pocket cheeks
    if (full) {
      // a fan of notes leaning back in the hopper: offset slabs, each a note
      for (let q = 0; q < 6; q++) {
        p(mA, 0.145 + q * 0.012, -0.04 - q * 0.006, 0.156, 0.004, 0.066, q & 1 ? COL.billEdge : COL.billFace);
      }
      p(mA, 0.012, 0.2, 0.156, 0.03, 0.066, COL.billEdge);         // counted notes in the pocket
      p(mA, 0.042, 0.2, 0.153, 0.0016, 0.063, COL.billFace);
      // strapped bricks along the far side, the day's count
      brick(p, -0.12, 0, -0.27, 2, 3, 3 + Math.floor(h(1, 1) * 3), STRAPS[0]);
      brick(p, 0.2, 0, -0.27, 2, 3, 3 + Math.floor(h(2, 1) * 2), STRAPS[1]);
      if (h(3, 1) < 0.7) brick(p, 0.53, 0, -0.3, 2, 2, 2 + Math.floor(h(3, 2) * 3), STRAPS[2]);
      // the banded pile in front of him, waiting for straps
      loosePile(p, -0.08, 0, 0.19, 4 + Math.floor(h(4, 1) * 3), h);
      loosePile(p, 0.14, 0, 0.23, 2 + Math.floor(h(5, 1) * 3), function (a, c) { return h(a + 9, c); });
      // a box of fresh straps
      p(-0.8, 0, 0.26, 0.1, 0.07, 0.13, COL.card);
      p(-0.8, 0.07, 0.26, 0.09, 0.004, 0.12, STRAPS[0]);
    } else {
      // torn straps where the bricks were
      for (let i = 0; i < 5; i++) p(-0.15 + h(i, 31) * 0.7, 0, -0.3 + h(i, 32) * 0.2, 0.034, 0.002, 0.07, STRAPS[i % 3]);
    }
    // rubber bands
    for (let i = 0; i < 7; i++) p(-0.25 + h(i, 7) * 0.6, 0, 0.0 + h(i, 8) * 0.09, 0.045, 0.004, 0.006 + h(i, 9) * 0.012, COL.rubber);
    // the ledger and a pen
    p(0.42, 0, 0.2, 0.21, 0.012, 0.15, 0x2a3a5a);
    p(0.42, 0.012, 0.2, 0.2, 0.001, 0.14, 0xe8e4d8);
    p(0.545, 0.012, 0.2, 0.01, 0.009, 0.14, 0x1a1a1a);
    digitalScale(p, -0.78, 0, -0.26);
    pistol(p, 0.74, 0, 0.19);
    return T;
  }
  // A DUFFEL: a soft 85 cm holdall, webbing bands, two carry handles, a zip;
  // `open` shows the bricks inside
  function duffelBag(B, x, z, alongX, open) {
    const p = alongX ? frame(B, x, z, 0, 1, B.fy) : frame(B, x, z, 1, 0, B.fy);
    const L = 0.84, body = 0x2d3128, end = 0x22251f, web = COL.web;
    p(0, 0, 0, L, 0.28, 0.3, body);                               // core
    p(0, 0.02, 0, L - 0.002, 0.2, 0.345, body);                   // belly, slumped wide
    p(0, 0.28, 0, L - 0.05, 0.03, 0.2, body);                     // crown
    for (let s = -1; s <= 1; s += 2) {
      p(s * (L / 2 + 0.005), 0.02, 0, 0.01, 0.25, 0.26, end);     // end panels
      p(s * (L / 2 + 0.012), 0.08, 0, 0.012, 0.12, 0.15, 0x191b17);   // end pockets
      // webbing bands round the bag, the handles sewn to them
      p(s * 0.2, 0, 0, 0.04, 0.285, 0.305, web);
      p(s * 0.2, 0.02, 0, 0.04, 0.205, 0.35, web);
      p(s * 0.2, 0.28, 0, 0.04, 0.034, 0.205, web);
      for (let q = -1; q <= 1; q += 2) p(s * 0.2, 0.31, q * 0.07, 0.03, 0.08, 0.018, web);   // handle roots
    }
    for (let q = -1; q <= 1; q += 2) p(0, 0.37, q * 0.07, 0.43, 0.018, 0.028, web);        // the handles
    p(0, 0.385, 0, 0.12, 0.025, 0.17, 0x2a2a28);                   // the grip wrap holding them together
    if (open) {
      p(0, 0.3095, 0, 0.62, 0.002, 0.075, 0x0b0b0b);               // the zip gaping
      for (let i = -1; i <= 1; i++) bundle(p, i * 0.17, 0.3, 0, STRAPS[(i + 3) % 3], false);
    } else {
      p(0, 0.31, 0, 0.72, 0.004, 0.012, 0x6a6d68);                 // zip
      p(0.34, 0.31, 0.014, 0.02, 0.005, 0.032, 0x9a9d98);          // pull
    }
  }
  // a steel wire shelving unit; put(level, lat, fwd, w, h, d, col, o)
  function steelShelf(B, x, z, yaw) {
    const p = piece(B, x, z, yaw);
    for (let a = -1; a <= 1; a += 2) for (let c = -1; c <= 1; c += 2) p(a * 0.48, 0, c * 0.17, 0.025, 1.8, 0.025, COL.steelD);
    const lv = [0.12, 0.6, 1.08, 1.56];
    for (let i = 0; i < lv.length; i++) {
      p(0, lv[i], 0, 0.98, 0.012, 0.36, COL.steel);                              // the deck
      p(0, lv[i] - 0.03, 0.18, 0.98, 0.03, 0.012, COL.steelD);                   // front rail
      p(0, lv[i] - 0.03, -0.18, 0.98, 0.03, 0.012, COL.steelD);                  // back rail
    }
    B.solid(x - 0.5, x + 0.5, z - 0.2, z + 0.2, B.fy, B.fy + 1.8);
    return function (lvl, lat, fwd, w, h, d, col, up) { p(lat, lv[lvl] + 0.012 + (up || 0), fwd, w, h, d, col); };
  }
  function dressCountShelf(B, g, cs) {
    const yaw = cs > 0 ? PI : 0;
    const put = steelShelf(B, g.shelf.x, g.shelf.z, yaw);
    const cb = COL.card, cbD = COL.cardD;
    // the cash box: a grey steel box, lid seam, fold-down handle
    put(1, -0.22, 0, 0.33, 0.09, 0.25, 0x55615a);
    put(1, -0.22, 0, 0.335, 0.012, 0.255, 0x46504a, 0.07);
    put(1, -0.22, 0.02, 0.1, 0.012, 0.02, 0x2a2a2a, 0.09);
    // the vacuum sealer and a roll of bags beside it
    put(1, 0.22, 0, 0.38, 0.08, 0.16, 0x2a2b2d);
    put(1, 0.22, 0.02, 0.3, 0.004, 0.06, 0x6c7074, 0.08);
    // a banker's box of receipts: lid overhang, hand hole
    put(0, -0.2, 0, 0.4, 0.26, 0.3, cb);
    put(0, -0.2, 0, 0.41, 0.05, 0.31, cbD, 0.21);
    put(0, -0.2, 0.156, 0.1, 0.03, 0.004, 0x2a2016, 0.15);
    // a slab of bottled water under it
    put(0, 0.25, 0, 0.4, 0.21, 0.27, 0xd9e3e8);
    put(0, 0.25, 0, 0.405, 0.06, 0.275, 0x2a6fb5, 0.07);
    // a shoebox and a carton on the next shelf up
    put(2, -0.25, 0, 0.28, 0.12, 0.2, 0x7a2f2f);
    put(2, -0.25, 0, 0.29, 0.03, 0.21, 0x5c2323, 0.09);
    put(2, 0.2, 0, 0.3, 0.1, 0.3, cb);
    put(2, 0.2, 0, 0.31, 0.02, 0.31, cbD, 0.08);
    // the roll: lying across the top shelf
    cylH(B, g.shelf.x, B.fy + 1.56 + 0.012 + 0.07, g.shelf.z, 0.07, 0.34, true, 0xdadfda);
  }
  // A TIPPED TABLE: the top stands on edge toward the door; legs point away.
  function tippedTable(B, c) {
    const up = B.fy;
    if (c.longX) {
      const zt = c.z - c.lz * 0.36;
      B.box(c.x, up + 0.375, zt, 1.4, 0.75, 0.04, 0x6b513a, { solid: true });
      B.box(c.x, up + 0.375, zt + c.lz * 0.05, 1.3, 0.65, 0.06, 0x4a3828);      // apron
      for (let a = -1; a <= 1; a += 2) for (let v = 0; v < 2; v++)
        B.box(c.x + a * 0.62, up + 0.06 + v * 0.63, zt + c.lz * 0.37, 0.04, 0.04, 0.7, 0x3a2c20);
    } else {
      const xt = c.x - c.lx * 0.36;
      B.box(xt, up + 0.375, c.z, 0.04, 0.75, 1.4, 0x6b513a, { solid: true });
      B.box(xt + c.lx * 0.05, up + 0.375, c.z, 0.06, 0.65, 1.3, 0x4a3828);
      for (let a = -1; a <= 1; a += 2) for (let v = 0; v < 2; v++)
        B.box(xt + c.lx * 0.37, up + 0.06 + v * 0.63, c.z + a * 0.62, 0.7, 0.04, 0.04, 0x3a2c20);
    }
  }
  // a dorm fridge against the wall, a microwave on it: (fx,fz) = the way it faces
  function miniFridge(B, x, z, fx, fz) {
    const p = frame(B, x, z, fx, fz, B.fy);
    p(0, 0, 0, 0.48, 0.84, 0.5, 0xd6d5cf);                         // cabinet
    p(0, 0.03, 0.252, 0.46, 0.78, 0.012, 0xe2e1db);                // door
    p(0.19, 0.46, 0.264, 0.024, 0.24, 0.022, 0x9a9a96);            // handle
    p(0, 0, 0.245, 0.46, 0.03, 0.01, 0x2a2a2a);                    // kick grille
    p(0, 0.84, -0.03, 0.46, 0.27, 0.36, 0x2c2e31);                 // microwave
    p(-0.05, 0.87, 0.151, 0.3, 0.2, 0.004, 0x111316);              //   door glass, dark
    p(0.15, 0.87, 0.151, 0.08, 0.2, 0.004, 0x3a3d41);              //   keypad
    B.solid(x - (fx ? 0.25 : 0.24), x + (fx ? 0.25 : 0.24), z - (fx ? 0.24 : 0.25), z + (fx ? 0.24 : 0.25), B.fy, B.fy + 1.11);
  }
  // cases of bottled water, shrink-wrapped, stacked by the wall
  function waterCases(B, x, z, fx, fz, h) {
    const p = frame(B, x, z, fx, fz, B.fy);
    const n = [3, 3, 2, 2];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const hi = n[(i * 2 + j + Math.floor(h(i, j) * 4)) % 4];
      for (let k = 0; k < hi; k++) {
        const da = (h(i + k, 41) - 0.5) * 0.03, dc = (h(j + k, 42) - 0.5) * 0.03;
        p((i - 0.5) * 0.28 + da, k * 0.21, (j - 0.5) * 0.41 + dc, 0.27, 0.205, 0.4, 0xd9e3e8);
        p((i - 0.5) * 0.28 + da, k * 0.21 + 0.07, (j - 0.5) * 0.41 + dc, 0.274, 0.06, 0.404, 0x2a6fb5);   // the label band
      }
    }
    B.solid(x - (fx ? 0.42 : 0.29), x + (fx ? 0.42 : 0.29), z - (fx ? 0.29 : 0.42), z + (fx ? 0.29 : 0.42), B.fy, B.fy + 0.63);
  }
  // A FLOOR MATTRESS: the tick, a fitted sheet wrapped over its top edge, a
  // pillow at the wall end, a blanket thrown over the foot two thirds and
  // hanging down its sides. On the floor: nothing floats.
  function mattress(B, s, i) {
    const len = 1.9, wid = 0.9, H = 0.2;
    // forward = toward the head (the wall)
    const p = frame(B, s.x, s.z, s.hdx, s.hdz, B.fy);
    const tick = [0xd9d4c4, 0xc8c2b0, 0xb9b3a0][i % 3];
    p(0, 0, 0, wid, H, len, tick);
    p(0, 0.002, 0, wid + 0.006, 0.02, len + 0.006, mulHex(tick, 0.78));          // the boxed seam at the floor
    const sheet = SHEETS[i % SHEETS.length];
    if (i % 3 !== 2) p(0, H - 0.05, 0, wid + 0.008, 0.052, len + 0.008, sheet);  // fitted sheet
    // pillow: two nested boxes so it is soft at the edges
    p(0, H, len / 2 - 0.24, 0.56, 0.09, 0.34, 0xe6e2d8);
    p(0, H, len / 2 - 0.24, 0.6, 0.06, 0.37, 0xe6e2d8);
    // the blanket
    const bl = BLANKETS[(i + (s.x > 0 ? 1 : 0)) % BLANKETS.length];
    const bLen = len * (0.55 + 0.12 * ((i * 7) % 3) / 2), f0 = -len / 2 - 0.02, f1 = f0 + bLen;
    p(0, H + 0.004, (f0 + f1) / 2, wid + 0.04, 0.028, bLen, bl);                 // over the top
    for (let q = -1; q <= 1; q += 2) p(q * (wid / 2 + 0.022), 0.03, (f0 + f1) / 2, 0.014, H - 0.02, bLen - 0.04, mulHex(bl, 0.88));   // hanging down the sides
    p(0, 0.02, f0 - 0.007, wid + 0.04, H - 0.01, 0.014, mulHex(bl, 0.88));       // over the foot
    p(0, H + 0.03, f1 - 0.07, wid + 0.03, 0.05, 0.16, mulHex(bl, 1.08));         // turned back at the top edge
    return { top: B.fy + H };
  }
  function clothesRail(B, s, h) {
    const len = 1.5, p = piece(B, s.x, s.z, Math.atan2(s.fx, s.fz));
    for (let a = -1; a <= 1; a += 2) { p(a * len / 2, 0, 0, 0.03, 1.6, 0.03, COL.steelD); p(a * len / 2, 0, 0, 0.05, 0.03, 0.45, COL.steelD); }
    p(0, 1.58, 0, len, 0.025, 0.025, COL.steel);
    for (let i = 0; i < 7; i++) {
      const hl = 0.6 + h(i, 1) * 0.35, lat = -len / 2 + 0.15 + i * 0.2, col = GARMENTS[(i + Math.floor(h(i, 2) * 7)) % GARMENTS.length];
      p(lat, 1.53, 0, 0.012, 0.05, 0.02, 0x9a9a9a);                  // hanger hook
      p(lat, 1.51, 0, 0.014, 0.025, 0.42, 0x3a3a3a);                 // hanger
      p(lat, 1.51 - hl, 0, 0.045, hl, 0.4, col);                      // the garment
      p(lat, 1.51 - hl * 0.45, 0, 0.05, 0.06, 0.44, mulHex(col, 0.9));   // its fold/pocket line
    }
    // sneakers under it, in pairs
    for (let i = 0; i < 3; i++) {
      const col = [0x1c1c1c, 0xd8d8d0, 0x8a2c2c][(i + Math.floor(h(i, 3) * 3)) % 3];
      for (let q = -1; q <= 1; q += 2) sneaker(p, -0.45 + i * 0.42 + q * 0.065, 0.1, col);
    }
  }
  function sneaker(p, lat, fwd, col) {
    p(lat, 0, fwd, 0.1, 0.03, 0.28, 0xe8e6e0);                      // sole
    p(lat, 0.03, fwd - 0.03, 0.094, 0.06, 0.2, col);                // upper
    p(lat, 0.03, fwd + 0.09, 0.09, 0.04, 0.08, col);                // toe box
    p(lat, 0.09, fwd - 0.07, 0.07, 0.02, 0.1, 0x2a2a2a);            // collar opening
  }
  function footlocker(B, f) {
    const ax = f.alongX, p = ax ? frame(B, f.x, f.z, 0, 1, B.fy) : frame(B, f.x, f.z, 1, 0, B.fy);
    const g = 0x4d5a3a, gD = 0x3d4a2e, m = 0x8a8a80;
    p(0, 0, 0, 0.8, 0.36, 0.4, g, { solid: true });
    p(0, 0.36, 0, 0.82, 0.05, 0.42, gD);                            // lid
    for (let a = -1; a <= 1; a += 2) {
      for (let c = -1; c <= 1; c += 2) p(a * 0.39, 0, c * 0.19, 0.04, 0.41, 0.04, m);   // corner guards
      p(a * 0.415, 0.2, 0, 0.012, 0.03, 0.14, 0x222222);            // end handles
      p(a * 0.2, 0.3, 0.205, 0.05, 0.08, 0.012, m);                 // latches
    }
    p(0, 0.28, 0.205, 0.06, 0.06, 0.012, m);                        // hasp
  }
  function floorSafe(B, x, z, yaw) {
    const p = piece(B, x, z, yaw), bd = 0x2e3236, dr = 0x3a3f44, br = 0xb8b8b0;
    for (let a = -1; a <= 1; a += 2) for (let c = -1; c <= 1; c += 2) p(a * 0.26, 0, c * 0.24, 0.06, 0.03, 0.06, 0x1a1a1a);   // feet
    p(0, 0.03, 0, 0.62, 0.72, 0.58, bd);
    p(0, 0.09, 0.292, 0.52, 0.6, 0.02, dr);                         // the door, inset in its frame
    p(-0.27, 0.15, 0.3, 0.03, 0.08, 0.03, 0x1a1a1a); p(-0.27, 0.55, 0.3, 0.03, 0.08, 0.03, 0x1a1a1a);   // hinges
    p(0.06, 0.46, 0.306, 0.11, 0.11, 0.014, 0x1f2124);              // dial ring
    p(0.06, 0.475, 0.314, 0.08, 0.08, 0.012, br);                   // dial
    p(0.06, 0.52, 0.322, 0.008, 0.012, 0.006, 0xd23c2c);            // index mark
    p(0.12, 0.28, 0.312, 0.018, 0.018, 0.02, br);                   // handle hub
    p(0.12, 0.27, 0.33, 0.13, 0.016, 0.016, br);                    // spoke
    p(0.12, 0.215, 0.33, 0.016, 0.13, 0.016, br);                   // spoke
    B.solid(x - 0.31, x + 0.31, z - 0.31, z + 0.31, B.fy, B.fy + 0.75);
  }
  function gunRack(B, x, z, yaw) {
    const p = piece(B, x, z, yaw);
    p(0, 0, -0.12, 1.4, 1.5, 0.04, 0x5a4030);                   // back board on the wall
    p(0, 0, 0.02, 1.4, 0.12, 0.3, 0x4a3426);                    // butt rest
    p(0, 1.2, -0.02, 1.4, 0.06, 0.16, 0x4a3426);                // barrel rail
    for (let i = 0; i < 4; i++) {
      const lat = -0.5 + i * 0.33;
      p(lat, 0.12, 0.02, 0.05, 0.3, 0.12, 0x3a2a1c);             // stock
      p(lat, 0.42, 0.0, 0.045, 0.3, 0.07, COL.black);            // receiver
      p(lat, 0.52, 0.04, 0.03, 0.12, 0.06, 0x202124);            // magazine
      p(lat, 0.72, -0.02, 0.025, 0.56, 0.025, 0x2a2b2e);         // barrel
      p(lat, 0.72, 0.0, 0.035, 0.22, 0.04, 0x3a2a1c);            // handguard
    }
    const sx = Math.abs(Math.sin(yaw)) > 0.5;
    B.solid(x - (sx ? 0.18 : 0.7), x + (sx ? 0.18 : 0.7), z - (sx ? 0.7 : 0.18), z + (sx ? 0.7 : 0.18), B.fy, B.fy + 1.5);
  }
  // flat clothes on the floor: a hoodie with its arms out, a pair of jeans
  function floorClothes(B, x, z, kind, col, rot) {
    const p = rot ? frame(B, x, z, 1, 0, B.fy) : frame(B, x, z, 0, 1, B.fy);
    if (kind === 0) {
      p(0, 0, 0, 0.5, 0.03, 0.58, col);                                   // body
      for (let q = -1; q <= 1; q += 2) p(q * 0.4, 0, 0.06, 0.32, 0.022, 0.14, mulHex(col, 0.92));   // sleeves
      p(0, 0.012, 0.33, 0.28, 0.025, 0.14, mulHex(col, 0.85));            // hood
      p(0, 0.03, -0.12, 0.26, 0.004, 0.14, mulHex(col, 0.8));             // pocket
    } else {
      for (let q = -1; q <= 1; q += 2) p(q * 0.1, 0, -0.05, 0.19, 0.022, 0.8, col);   // legs
      p(0, 0, 0.4, 0.4, 0.026, 0.12, mulHex(col, 0.9));                   // waist
    }
  }

  /* ========================================================================
     3. THE FLOORS.
     ======================================================================== */
  function drawGround(B, g) {
    const C = g.C, cs = g.cs, fy = B.fy;
    const lot = B.lot || null;
    const st = lot && lot.building && lot.building.stash;
    const looted = !!(st && st.looted);
    const ours = !!(lot && lot.building && lot.building.playerTurf);
    const h = function (a, c) { return B.h(a, c, 0xb1); };
    // the gang's stash IS the count table
    if (st) { st.x = B.ox + g.table.x; st.z = B.oz + g.table.z; }
    // FLOORS: worn timber in the lounge, sealed slab in the count room, cut
    // at the partition so neither room's light smears across the wall line
    if (g.wall) {
      B.plane(g.lounge.x0, g.lounge.z0, g.lounge.x1, g.lounge.z1, fy, "wood", 0xa89a88, { cell: 0.6 });
      B.plane(g.band.x0, g.band.z0, g.band.x1, g.band.z1, fy, "concrete", 0xb8b2a6, { cell: 0.6 });
    } else B.plane(C.X0, C.Z0, C.X1, C.Z1, fy, "concrete", 0xb8b2a6, { cell: 0.6 });
    drywallCeiling(B, C.X0, C.Z0, C.X1, C.Z1, 0xd4cec2, 0xb3);
    skinWalls(B, "brick", 0xc9bdb2, true, { salt: 0xb4 });
    dressWindows(B, function (w) {
      const wz = w.axis === "x" ? w.side * (B.b.d / 2) : (w.a0 + w.a1) / 2;
      const inBand = w.axis === "x" ? (cs > 0 ? wz >= g.zp - 0.05 : wz <= g.zp + 0.05)
                                    : (cs > 0 ? w.a1 > g.zp : w.a0 < g.zp);
      return inBand ? "brick" : "curtain";
    }, g.wall ? { axis: "z", at: g.zp } : null);
    // THE PARTITION: solid, plaster over studs, one doorway at the far end
    // with its steel door standing open against the jamb
    if (g.wall) {
      for (let i = 0; i < g.segs.length; i++) {
        const s = g.segs[i];
        const inGap = g.gx > s[0] + 0.5 && g.gx < s[1] - 0.5;
        const gaps = inGap ? [{ c: g.gx, w: g.gapW, h: 2.05 }] : [];
        B.wall("x", g.zp, s[0], s[1], { gaps: gaps, mat: "plaster", tint: 0xbdb5a5, casing: 0x6b5a48, skirt: 0x4a443e });
        if (inGap) {
          const hx = g.gx - g.side * (g.gapW / 2 - 0.03);                    // the hinge jamb, room side
          const lz = g.zp + cs * (0.06 + 0.45);
          B.box(hx, fy + 1.0, lz, 0.045, 2.0, 0.88, 0x59606a, { solid: true });   // the leaf, open 90 degrees
          B.box(hx - g.side * 0.03, fy + 1.0, lz + cs * 0.3, 0.02, 0.05, 0.12, 0xb8b8b0);   // lever
          B.box(hx - g.side * 0.03, fy + 1.15, lz + cs * 0.33, 0.02, 0.07, 0.07, 0xb8b8b0); // deadbolt
          B.box(hx, fy + 0.12, lz, 0.05, 0.2, 0.86, 0x4a5058);                          // kick plate
        }
      }
    }
    // ---- COUNT ROOM
    countTable(B, g.table.x, g.table.z, true, !looted, h, cs);
    foldChair(B, g.chair.x, g.chair.z, g.chair.face, true);
    if (!looted && !ours) B.loot(g.table.x, g.table.z, "countroom", { lot: lot });
    if (g.duffel) duffelBag(B, g.duffel.x, g.duffel.z, true, !looted);
    if (g.shelf) dressCountShelf(B, g, cs);
    // a caged bulb over the table, the light confined to the room it lights
    cageLight(B, g.table.x, g.table.z, { drop: 0.7, r: 3.8, i: 0.95, rect: g.wall ? g.band : null });
    // ---- LOUNGE
    if (g.sofa) {
      const s = g.sofa, t = g.tv;
      const mx = (s.x + t.x) / 2, mz = (s.z + t.z) / 2;
      const ax = Math.abs(t.x - s.x) > Math.abs(t.z - s.z);     // sofa-to-TV runs along x
      // the rug: a bound border, a field, a stain on it
      B.box(mx, fy + 0.005, mz, ax ? 2.3 : 2.0, 0.01, ax ? 2.0 : 2.3, 0x4f3a2e);
      B.box(mx, fy + 0.0105, mz, ax ? 2.1 : 1.8, 0.001, ax ? 1.8 : 2.1, 0x6b4a3a);
      B.box(mx + 0.3, fy + 0.0118, mz - 0.2, 0.42, 0.001, 0.3, 0x523a2c);
      B.furn("sofa", s.x, s.z, s.yaw, { len: s.len, tone: 0x5b4d3e });
      tvOnCrate(B, t.x, t.z, t.yaw, h(1, 1) < 0.7);
      // the "coffee table": two milk crates and a board
      const cx = s.x + (t.x - s.x) * 0.42, cz = s.z + (t.z - s.z) * 0.42;
      const px = ax ? 0 : 0.35, pz = ax ? 0.35 : 0;
      milkCrate(B, cx - px, fy, cz - pz, 0x2c4a8a);
      milkCrate(B, cx + px, fy, cz + pz, 0x8a2c2c);
      const bt = fy + 0.33;
      B.box(cx, bt + 0.009, cz, ax ? 0.45 : 1.05, 0.018, ax ? 1.05 : 0.45, 0x8e7048, { mat: "wood", uv: 1.2 });
      const T = bt + 0.018;
      pizzaBox(B, cx - px * 0.8, T, cz - pz * 0.8, 2);
      ashtray(B, cx + px * 0.5, T, cz + pz * 0.5);
      for (let i = 0; i < 3; i++) can(B, cx + px * (0.12 + i * 0.1) + pz * 0.12, T, cz + pz * (0.12 + i * 0.1) + px * 0.12, CAN[i % CAN.length], false, false);
      // cans on the floor in the gap between the sofa and the TV, never under
      // either: u runs sofa -> TV, v across
      const ux = (t.x - s.x) / 2.7, uz = (t.z - s.z) / 2.7, vx = -uz, vz = ux;
      for (let i = 0; i < 6; i++) {
        const u = 0.62 + h(i, 3) * 1.6, v = (h(i, 4) - 0.5) * 2.0;
        if (Math.abs(u - 1.13) < 0.42 && Math.abs(v) < 0.72) continue;   // the crate table
        const x = s.x + ux * u + vx * v, z = s.z + uz * u + vz * v;
        if (!B.clear(x, z, 0.1)) continue;
        can(B, x, fy, z, CAN[i % CAN.length], h(i, 5) < 0.6, h(i, 6) < 0.5);
      }
      cageLight(B, mx, mz, { cage: false, drop: 0.5, r: 4.6, i: 0.55, color: 0xffe0b0, rect: g.wall ? g.lounge : null });
    }
    // the lookout by the door
    if (g.lookout) {
      foldChair(B, g.lookout.x, g.lookout.z, g.lookout.face, true);
      if (g.lookout.crate) {
        const c = g.lookout.crate, T = milkCrate(B, c.x, fy, c.z, 0x2d6b3a);
        B.box(c.x, T + 0.005, c.z, 0.36, 0.01, 0.36, 0x7a6048, { mat: "wood", uv: 1.2 });
        ashtray(B, c.x - 0.07, T + 0.01, c.z - 0.07);
        can(B, c.x + 0.09, T + 0.01, c.z + 0.08, CAN[Math.floor(h(9, 9) * CAN.length) % CAN.length], false, false);
        B.box(c.x + 0.06, T + 0.015, c.z - 0.1, 0.072, 0.009, 0.15, 0x111111);           // a phone
        B.box(c.x + 0.06, T + 0.0195, c.z - 0.1, 0.064, 0.001, 0.138, 0x1c2430);
      }
      const d = C.door;
      // a fluorescent batten over the entrance
      B.light(d.x + d.nx * 2.2, d.z + d.nz * 2.2, { kind: "strip", len: 1.2, axis: Math.abs(d.nz) > 0.5 ? "x" : "z",
        r: 4.4, i: 0.55, color: 0xf2f4ff, rect: g.wall ? g.lounge : null });
    }
    // cover
    if (g.cover) tippedTable(B, g.cover);
    for (let i = 0; i < g.crates.length; i++) {
      // the stack by the wall has a reason to be there: a fridge, the water
      const c = g.crates[i], fx = Math.abs(c.x - C.X0) < Math.abs(c.x - C.X1) ? 1 : -1;
      const wx = fx > 0 ? C.X0 : C.X1;
      if (i === 0) miniFridge(B, wx + fx * 0.27, c.z, fx, 0);
      else waterCases(B, wx + fx * 0.44, c.z, fx, 0, h);
    }
    // pizza boxes and a bin bag by the partition
    const tz = g.zp - cs * 0.32;
    const tx = clamp(g.gx + (g.side > 0 ? -1.2 : 1.2), C.X0 + 0.4, C.X1 - 0.4);
    if (B.clear(tx, tz, 0.2)) { trashBag(B, tx, tz, 1); pizzaBox(B, tx + (g.side > 0 ? -0.55 : 0.55), fy, tz, 3); }
  }

  function drawKitchen(B, k) {
    const C = k.C, fy = B.fy, t = k.table;
    const h = function (a, c) { return B.h(a, c, 0xc1); };
    B.plane(C.X0, C.Z0, C.X1, C.Z1, fy, "vinyl", 0xc2bcaa, { cell: 0.6 });
    joistCeiling(B, C.X0, C.Z0, C.X1, C.Z1);
    const rects = skinWalls(B, "plaster", 0xb0a894, false, { salt: 0xc4 });
    const foil = h(2, 2) < 0.5;
    let fanDone = false;
    dressWindows(B, function () { if (!fanDone) { fanDone = true; return "fan"; } return foil ? "foil" : "board"; });
    // POLY SHEETING taped over the two long walls
    const alongX = (C.X1 - C.X0) >= (C.Z1 - C.Z0);
    sheetWalls(B, rects, alongX ? "x" : "z");
    // a blue tarp under the cook table, grommets at the corners
    const tw = t.alongX ? 3.2 : 1.9, td = t.alongX ? 1.9 : 3.2;
    B.box(t.x, fy + 0.002, t.z, tw, 0.004, td, COL.tarp);
    for (let a = -1; a <= 1; a += 2) for (let c = -1; c <= 1; c += 2) B.box(t.x + a * (tw / 2 - 0.05), fy + 0.0045, t.z + c * (td / 2 - 0.05), 0.03, 0.001, 0.03, 0xb8b8b0);
    // THE STEEL TABLE (top 0.9), an undershelf with the stock on it
    const lx = t.alongX ? t.L : t.W, lz = t.alongX ? t.W : t.L;
    B.box(t.x, fy + 0.885, t.z, lx, 0.03, lz, COL.steel);
    B.box(t.x, fy + 0.855, t.z, lx - 0.04, 0.03, lz - 0.04, COL.steelD);           // the top's turned-down edge
    B.box(t.x, fy + 0.2, t.z, lx - 0.1, 0.02, lz - 0.1, COL.steelD);               // under-shelf
    for (let a = -1; a <= 1; a += 2) for (let c = -1; c <= 1; c += 2) {
      B.box(t.x + a * (lx / 2 - 0.04), fy + 0.435, t.z + c * (lz / 2 - 0.04), 0.035, 0.87, 0.035, COL.steelD);
      B.box(t.x + a * (lx / 2 - 0.04), fy + 0.015, t.z + c * (lz / 2 - 0.04), 0.045, 0.03, 0.045, 0x2a2a2a);   // feet
    }
    B.solid(t.x - lx / 2, t.x + lx / 2, t.z - lz / 2, t.z + lz / 2, fy, fy + 0.9);
    const T = fy + 0.9;
    // a runs along the table toward the gas bottle's end, c across it toward
    // the cook; p(a, up, c, sizeA, h, sizeC, col, o) stands on the top
    const at = function (a, c) { return t.alongX ? [t.x + a, t.z - c] : [t.x - c, t.z + a]; };
    const p = function (a, up, c, sa, hh, sc, col, o) {
      const q = at(a, c);
      return B.box(q[0], T + up + hh / 2, q[1], t.alongX ? sa : sc, hh, t.alongX ? sc : sa, col, o);
    };
    // two single hotplates (one a propane ring off the bottle), pots on them
    for (let i = 0; i < 2; i++) {
      const a = 0.85 - i * 0.5;
      p(a, 0, 0.05, 0.3, 0.07, 0.3, 0x2a2b2d);                                  // hotplate body
      p(a, 0.03, 0.2, 0.05, 0.03, 0.012, 0xb8b8b0);                              // knob
      const q = at(a, 0.03);
      cyl(B, q[0], T + 0.07, q[1], 0.1, 0.008, 0x151515);                        // the cast-iron plate
      const pr = i ? 0.14 : 0.12, ph = i ? 0.24 : 0.14, pc = i ? 0x9aa0a4 : 0x7f8589;
      cyl(B, q[0], T + 0.078, q[1], pr, ph, pc);                                 // the pot
      ring(B, q[0], T + 0.078 + ph, q[1], pr * 0.93, 0.012, mulHex(pc, 1.1));   // its rim
      if (i) {                                                                    // a stockpot's side handles
        B.box(q[0] + pr + 0.03, T + 0.078 + ph - 0.03, q[1], 0.05, 0.02, 0.07, 0x55595e);
        B.box(q[0] - pr - 0.03, T + 0.078 + ph - 0.03, q[1], 0.05, 0.02, 0.07, 0x55595e);
      } else {                                                                    // a saucepan's handle and lid
        const hq = at(a, 0.03 + pr + 0.1);
        B.box(hq[0], T + 0.078 + ph - 0.03, hq[1], t.alongX ? 0.03 : 0.18, 0.02, t.alongX ? 0.18 : 0.03, 0x1c1c1c);
        cyl(B, q[0], T + 0.078 + ph, q[1], pr * 0.95, 0.008, mulHex(pc, 1.05));
        cyl(B, q[0], T + 0.086 + ph, q[1], 0.02, 0.02, 0x1c1c1c);
      }
    }
    // glassware: two conical flasks, three beakers, a measuring cylinder;
    // the liquid is a body of its own inside the glass
    const LIQ = [0xc9a45a, 0xe8e2c8, 0xa8c8b0];
    for (let i = 0; i < 2; i++) {
      const q = at(-0.1 - i * 0.16, -0.2);
      cyl(B, q[0], T, q[1], 0.06, 0.07, COL.glass, { glass: true });
      cyl(B, q[0], T + 0.07, q[1], 0.042, 0.04, COL.glass, { glass: true });
      cyl(B, q[0], T + 0.11, q[1], 0.018, 0.06, COL.glass, { glass: true });
      cyl(B, q[0], T + 0.002, q[1], 0.05, 0.05, LIQ[i]);
    }
    for (let i = 0; i < 3; i++) {
      const q = at(-0.12 - i * 0.13, 0.05), bh = 0.1 + h(i, 1) * 0.04;
      cyl(B, q[0], T, q[1], 0.045, bh, COL.glass, { glass: true });
      cyl(B, q[0], T + 0.002, q[1], 0.038, bh * (0.3 + h(i, 2) * 0.4), LIQ[(i + 1) % 3]);
    }
    { const q = at(-0.52, -0.22); cyl(B, q[0], T, q[1], 0.035, 0.012, 0x2a2a2a); cyl(B, q[0], T + 0.012, q[1], 0.02, 0.26, COL.glass, { glass: true }); }
    // solvent jugs with handles and caps
    for (let i = 0; i < 3; i++) {
      const a = -0.66 - i * 0.2, col = i === 1 ? 0x3d6fa8 : COL.jug;
      p(a, 0, 0.22, 0.16, 0.27, 0.12, col);
      p(a, 0.27, 0.22, 0.12, 0.03, 0.09, col);
      p(a + 0.04, 0.3, 0.22, 0.04, 0.035, 0.04, 0xd0452f);                       // cap
      p(a - 0.05, 0.22, 0.22, 0.03, 0.08, 0.03, col);                             // the handle
    }
    digitalScale(p, 0.35, 0, -0.26);
    // the cook's respirator, put down on the bench by the burners
    respirator(B, at(0.6, 0.3), T, t.alongX);
    // on the under-shelf: a case of jugs, a carton of foil pans
    p(-0.5, -0.69, 0, 0.4, 0.26, 0.3, COL.card);
    p(-0.5, -0.43, 0, 0.41, 0.01, 0.31, COL.cardD);
    p(0.3, -0.69, 0, 0.36, 0.12, 0.26, 0xb9bec2);
    // the gas bottle at the end: a 20 lb cylinder, its collar and valve, the
    // hose up to the burner
    const tk = k.tank;
    cyl(B, tk.x, fy + 0.03, tk.z, 0.155, 0.4, 0xd8d8d0);
    cyl(B, tk.x, fy, tk.z, 0.13, 0.03, 0x8a8a84);                               // foot ring
    cyl(B, tk.x, fy + 0.43, tk.z, 0.11, 0.03, 0xd8d8d0);                         // shoulder
    ring(B, tk.x, fy + 0.52, tk.z, 0.08, 0.012, 0xc8c8c0);                      // collar
    B.box(tk.x, fy + 0.49, tk.z, 0.04, 0.06, 0.04, 0xb89a3a);                    // valve
    B.box(tk.x, fy + 0.53, tk.z, 0.06, 0.012, 0.012, 0x2a2a2a);                  // handwheel
    // the hose: across to the table's end leg, up it, along the top to the ring
    const e0 = t.L / 2 + 0.3, e1 = t.L / 2 - 0.03;
    const hose = function (a0, a1, y0, y1, c) {
      const q = at((a0 + a1) / 2, c), la = Math.abs(a1 - a0) + 0.014;
      B.box(q[0], (y0 + y1) / 2, q[1], t.alongX ? la : 0.014, Math.abs(y1 - y0) + 0.014, t.alongX ? 0.014 : la, 0x151515);
    };
    hose(e0 - 0.02, e1, fy + 0.52, fy + 0.52, 0.0);
    hose(e1, e1, fy + 0.52, T - 0.04, 0.0);
    hose(e1, 1.0, T + 0.007, T + 0.007, 0.0);
    B.solid(tk.x - 0.16, tk.x + 0.16, tk.z - 0.16, tk.z + 0.16, fy, fy + 0.55);
    // buckets on the floor along the table's back side
    for (let i = 0; i < 2; i++) {
      const q = at(-0.3 + i * 0.38, -(t.W / 2 + 0.2)), col = i ? 0xe0e0da : 0x2f6fbf;
      cyl(B, q[0], fy, q[1], 0.14, 0.36, col);
      ring(B, q[0], fy + 0.355, q[1], 0.14, 0.02, mulHex(col, 0.85));
    }
    // the work lamp on a stand, beside the cook
    const lp = at(-t.L / 2 + 0.02, 0.75);
    B.box(lp[0], fy + 0.02, lp[1], 0.4, 0.04, 0.4, COL.black);
    B.box(lp[0], fy + 0.8, lp[1], 0.03, 1.56, 0.03, 0xd8b43a);
    B.box(lp[0], fy + 1.63, lp[1], 0.24, 0.16, 0.14, 0xd8b43a);
    B.box(lp[0], fy + 1.63, lp[1] + (t.alongX ? 0.072 : 0), t.alongX ? 0.2 : 0.004, 0.12, t.alongX ? 0.004 : 0.12, 0xfff4e0, { glow: true });
    B.lamp(t.x, t.z, fy + 1.6, { color: 0xfff4e0, r: 3.4, i: 0.5 });
    // the bagging table against a wall, a chair at it; the lab loot
    if (k.bags) {
      const g = k.bags, ax = g.alongX;
      const T2 = foldTable(B, g.x, g.z, ax, 1.5, 0.7, 0xcfc8b6);
      // into the room from the wall: where the bagger sits, facing the wall
      const inx = g.fx, inz = g.fz;
      const q = frame(B, g.x, g.z, inx, inz, T2);
      // a tray with the product on it, a spoon
      q(-0.45, 0, 0, 0.36, 0.02, 0.26, 0x9aa0a4);
      q(-0.45, 0.02, 0, 0.2, 0.02, 0.14, 0xefefe8); q(-0.45, 0.04, 0, 0.12, 0.018, 0.08, 0xefefe8);
      q(-0.3, 0.02, 0.07, 0.1, 0.006, 0.02, 0xb8b8b0);
      // rows of filled baggies: clear film, the white inside it
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        const a = -0.08 + i * 0.1, c = -0.12 + j * 0.1;
        q(a, 0, c, 0.07, 0.008, 0.085, 0xf4f4ee);
        q(a, 0, c, 0.08, 0.012, 0.1, 0xe6eef0, { glass: true });
        q(a, 0.012, c + 0.04, 0.078, 0.002, 0.006, 0x3a78c8);                   // the zip strip
      }
      digitalScale(q, 0.45, 0, -0.1);
      // the box of empty baggies and a spill of them
      q(0.5, 0, 0.18, 0.14, 0.07, 0.1, 0xe8e2d4);
      q(0.5, 0.07, 0.18, 0.12, 0.002, 0.08, 0x3a78c8);
      q(0.34, 0, 0.2, 0.08, 0.004, 0.1, 0xe6eef0, { glass: true });
      foldChair(B, g.x + inx * 0.62, g.z + inz * 0.62, Math.atan2(-inx, -inz), true);
      B.loot(g.x, g.z, "lab", { lot: B.lot || null });
    }
    // respirators on a hook rail on the wall
    // (the rail is screwed through the film, 7.5 cm off the wall)
    const wallHook = alongX ? { x: t.x + 1.6, z: C.Z0 + 0.075 } : { x: C.X0 + 0.075, z: t.z + 1.6 };
    const hookGlass = alongX ? windowAt(B, false, C.Z0, wallHook.x - 0.45, wallHook.x + 0.45, fy + 1.3, fy + 1.75)
                             : windowAt(B, true, C.X0, wallHook.z - 0.45, wallHook.z + 0.45, fy + 1.3, fy + 1.75);
    if (!hookGlass && B.clear(wallHook.x + (alongX ? 0 : 0.3), wallHook.z + (alongX ? 0.3 : 0), 0.05)) {
      const ax = alongX;
      B.box(wallHook.x, fy + 1.66, wallHook.z, ax ? 0.8 : 0.025, 0.07, ax ? 0.025 : 0.8, 0x4a3a2a, { mat: "wood", uv: 1.2 });
      for (let i = 0; i < 2; i++) {
        const a = -0.18 + i * 0.36;
        const hx = wallHook.x + (ax ? a : 0.02), hz = wallHook.z + (ax ? 0.02 : a);
        const x = wallHook.x + (ax ? a : 0.055), z = wallHook.z + (ax ? 0.055 : a);
        B.box(hx, fy + 1.66, hz, 0.015, 0.015, 0.015, 0x9a9a9a);                  // the hook
        B.box(hx, fy + 1.57, hz, 0.012, 0.17, 0.012, 0x1c1c1c);                    // strap
        respirator(B, [x, z], fy + 1.4, ax, true);
      }
    }
    shopLight(B, t.x, t.z, t.alongX, { r: 4.6, i: 0.72 });
    if (k.bags) cageLight(B, k.bags.x, k.bags.z, { cage: false, drop: 0.45, r: 3.2, i: 0.45, color: 0xffe8c0 });
  }
  // a half-face respirator: rubber body, nose, two pink filter cartridges
  function respirator(B, q, y, ax, hanging) {
    const x = q[0], z = q[1];
    B.box(x, y + 0.045, z, 0.1, 0.09, 0.08, 0x3a3d40);
    B.box(x, y + 0.075, z, ax ? 0.05 : 0.06, 0.06, ax ? 0.06 : 0.05, 0x2e3033);
    for (let s = -1; s <= 1; s += 2) {
      const cx = x + (ax ? s * 0.075 : 0), cz = z + (ax ? 0 : s * 0.075);
      if (hanging) B.box(cx, y + 0.04, cz + (ax ? 0.01 : 0), ax ? 0.04 : 0.07, 0.07, ax ? 0.07 : 0.04, 0xc86f8a);
      else cyl(B, cx, y, cz, 0.035, 0.04, 0xc86f8a);
    }
  }

  function drawCrash(B, c) {
    const C = c.C, fy = B.fy;
    const h = function (a, q) { return B.h(a, q, 0xd1); };
    B.plane(C.X0, C.Z0, C.X1, C.Z1, fy, "wood", 0x9a8a78, { cell: 0.6 });
    drywallCeiling(B, C.X0, C.Z0, C.X1, C.Z1, 0xd8d2c6, 0xd3);
    skinWalls(B, "plaster", 0xb8ae98, false, { salt: 0xd4 });
    dressWindows(B, function () { return "curtain"; });
    for (let i = 0; i < c.mats.length; i++) {
      const m = c.mats[i];
      mattress(B, m, i);
      if (i < 2) B.loot(m.x, m.z, "mattress", { lot: B.lot || null });
      // what lives beside a mattress on the floor
      const sx = m.x + (m.hdx ? m.hdx * 0.7 : 0.6), sz = m.z + (m.hdx ? 0.56 : m.hdz * 0.7);
      if (B.clear(sx, sz, 0.05) && freeRect(c.C, sx - 0.12, sz - 0.12, sx + 0.22, sz + 0.2) && h(i, 1) < 0.7) {
        can(B, sx, fy, sz, CAN[i % CAN.length], h(i, 2) < 0.4, true);
        ashtray(B, sx + 0.12, fy, sz + 0.1);
      }
    }
    if (c.foot) { footlocker(B, c.foot); B.loot(c.foot.x, c.foot.z, "footlocker", { lot: B.lot || null }); }
    if (c.rail) clothesRail(B, c.rail, h);
    if (c.tv) tvOnCrate(B, c.tv.x, c.tv.z, Math.atan2(c.tv.fx, c.tv.fz), h(5, 5) < 0.5);
    if (c.guns) {
      const g = c.guns, ax = g.ax;
      const top = crateBox(B, g.x, fy, g.z, ax ? 1.2 : 0.48, 0.44, ax ? 0.48 : 1.2, 0x55603f, { solid: true });
      B.box(g.x + (ax ? 0 : g.fx * 0.05), top + 0.001, g.z + (ax ? g.fz * 0.05 : 0), ax ? 0.5 : 0.1, 0.002, ax ? 0.1 : 0.5, 0xd8d0b0);   // stencil strip
      for (let q = -1; q <= 1; q += 2)                                                          // rope handles at the ends
        B.box(g.x + (ax ? q * 0.615 : 0), fy + 0.3, g.z + (ax ? 0 : q * 0.615), ax ? 0.02 : 0.16, 0.03, ax ? 0.16 : 0.02, 0x8a7a5a);
      B.loot(g.x, g.z, "weapons", { lot: B.lot || null });
    }
    // clothes dropped on the floor, never on the furniture
    for (let i = 0, n = 0; i < 6 && n < 3; i++) {
      const x = C.X0 + 0.9 + h(i, 7) * (C.X1 - C.X0 - 1.8), z = C.Z0 + 0.9 + h(i, 8) * (C.Z1 - C.Z0 - 1.8);
      if (!B.clear(x, z, 0.3) || !freeRect(c.C, x - 0.5, z - 0.5, x + 0.5, z + 0.5)) continue;
      floorClothes(B, x, z, i & 1, GARMENTS[(i + 2) % GARMENTS.length], h(i, 9) < 0.5);
      n++;
    }
    const cx = (C.X0 + C.X1) / 2, cz = (C.Z0 + C.Z1) / 2, alongX = (C.X1 - C.X0) >= (C.Z1 - C.Z0);
    const off = (alongX ? C.X1 - C.X0 : C.Z1 - C.Z0) * 0.22;
    cageLight(B, cx - (alongX ? off : 0), cz - (alongX ? 0 : off), { cage: false, drop: 0.4, r: 4.6, i: 0.5, color: 0xffe0b0 });
    cageLight(B, cx + (alongX ? off : 0), cz + (alongX ? 0 : off), { cage: false, drop: 0.4, r: 4.6, i: 0.42, color: 0xffe0b0 });
  }

  function drawBoss(B, p) {
    const C = p.C, fy = B.fy;
    B.plane(C.X0, C.Z0, C.X1, C.Z1, fy, "wood", 0x7e6450, { cell: 0.6 });
    drywallCeiling(B, C.X0, C.Z0, C.X1, C.Z1, 0xdcd6ca, 0xe3);
    skinWalls(B, "plaster", 0x8f8672, false, { salt: 0xe4, skirt: 0x3a2c22 });
    dressWindows(B, function () { return "curtain"; });
    if (p.desk) {
      const d = p.desk;
      B.box(d.x, fy + 0.005, d.z, 3.2, 0.01, 2.6, 0x4a2622);                   // his rug: border
      B.box(d.x, fy + 0.0105, d.z, 2.9, 0.001, 2.3, 0x6e3a33);                 //   field
      B.box(d.x, fy + 0.0112, d.z, 1.2, 0.001, 0.9, 0x8a5a3a);                 //   medallion
      B.furn("bossDesk", d.x, d.z, d.yaw, { tone: 0x3a2c22 });
      // on the desk (the kit's monitor stands at lat +0.55): a brick of cash,
      // the phone, a bottle and a glass, an ashtray
      const q = frame(B, d.x, d.z, Math.sin(d.yaw), Math.cos(d.yaw), fy + 0.74);
      brick(q, -0.72, 0, 0.12, 2, 2, 3, STRAPS[0]);
      q(-0.3, 0, 0.25, 0.075, 0.009, 0.15, 0x111111);                          // phone
      q(-0.3, 0.009, 0.25, 0.067, 0.001, 0.138, 0x1c2430);
      const fx = Math.round(Math.sin(d.yaw)), fz = Math.round(Math.cos(d.yaw));
      const wp = function (lat, fwd) { return [d.x + lat * fz + fwd * fx, d.z - lat * fx + fwd * fz]; };
      const bt = wp(1.05, 0.25), gl = wp(0.9, 0.32), as = wp(0.2, 0.3);
      cyl(B, bt[0], fy + 0.74, bt[1], 0.04, 0.2, 0x6b3a1a, { glass: true });              // the bottle
      cyl(B, bt[0], fy + 0.94, bt[1], 0.015, 0.08, 0x6b3a1a, { glass: true });            //   its neck
      cyl(B, bt[0], fy + 1.02, bt[1], 0.017, 0.02, 0x1a1a1a);                             //   cap
      cyl(B, bt[0], fy + 0.742, bt[1], 0.034, 0.12, 0xb07030);                            // the whiskey in it
      cyl(B, gl[0], fy + 0.74, gl[1], 0.035, 0.09, COL.glass, { glass: true });           // a glass
      cyl(B, gl[0], fy + 0.742, gl[1], 0.03, 0.025, 0xb07030);
      ashtray(B, as[0], fy + 0.74, as[1]);
      B.light(d.x, d.z, { kind: "pendant", r: 4.2, i: 0.6, color: 0xffd9a0, drop: 0.6 });
    }
    if (p.safe) {
      floorSafe(B, p.safe.x, p.safe.z, p.safe.yaw);
      B.loot(p.safe.x, p.safe.z, "safe", { lot: B.lot || null, wealth: 1 });
    }
    if (p.sofa) {
      const s = p.sofa, fx = Math.sin(s.yaw);
      B.furn("sofa", s.x, s.z, s.yaw, { len: 2.0, tone: 0x2b2b30 });
      // a low coffee table in front of it
      const tx = s.x + fx * 0.95;
      B.box(tx, fy + 0.4, s.z, 0.55, 0.04, 1.1, 0x3a2c22, { mat: "wood", uv: 1.2 });
      for (let a = -1; a <= 1; a += 2) for (let c2 = -1; c2 <= 1; c2 += 2)
        B.box(tx + a * 0.23, fy + 0.19, s.z + c2 * 0.5, 0.04, 0.38, 0.04, 0x2a2018);
      B.solid(tx - 0.28, tx + 0.28, s.z - 0.55, s.z + 0.55, fy, fy + 0.42);
      ashtray(B, tx, fy + 0.42, s.z + 0.3);
      B.box(tx - 0.05, fy + 0.425, s.z - 0.25, 0.05, 0.01, 0.16, 0x111111);     // a remote
      B.furn("lamp", s.x, s.z + (s.z > (C.Z0 + C.Z1) / 2 ? -1.25 : 1.25));
      B.lamp(s.x, s.z + (s.z > (C.Z0 + C.Z1) / 2 ? -1.25 : 1.25), fy + 1.4, { r: 3.0, i: 0.4 });
    }
    if (p.tv) {
      // a wall-hung screen over a low media unit, across from the sofa
      const t = p.tv, q = piece(B, t.x, t.z, t.yaw);
      q(0, 0, 0, 1.5, 0.44, 0.4, 0x2a2420, { solid: true });
      for (let a = -1; a <= 1; a += 2) q(a * 0.37, 0.05, 0.201, 0.7, 0.34, 0.004, 0x352d27);   // doors
      q(0, 0.44, 0, 1.52, 0.02, 0.42, 0x3a312a);                                // top
      const on = B.h(3, 3, 0xe5) < 0.6;
      const wallX = Math.abs(Math.sin(t.yaw)) > 0.5;                             // hung on a ±x wall
      const glass = windowAt(B, wallX, wallX ? t.x : t.z, (wallX ? t.z : t.x) - 0.7, (wallX ? t.z : t.x) + 0.7, fy + 0.9, fy + 1.9);
      if (!glass) {
        q(0, 1.0, -0.17, 1.3, 0.76, 0.05, COL.black);                           // the screen, on the wall
        q(0, 1.02, -0.143, 1.26, 0.72, 0.004, on ? 0x3d5f82 : 0x0f1317, on ? { glow: true } : null);
        if (on) B.lamp(t.x + Math.sin(t.yaw) * 0.6, t.z + Math.cos(t.yaw) * 0.6, fy + 1.3, { color: 0x8fb4ff, r: 2.6, i: 0.2 });
      } else flatTV(B, t.x, t.z, t.yaw, 0.46, on, 1.1);                        // a window behind: it stands on the unit
      q(0.52, 0.46, 0.06, 0.34, 0.07, 0.24, 0x151515);                          // a games console
    }
    if (p.rack) gunRack(B, p.rack.x, p.rack.z, p.rack.yaw);
    const cx = (C.X0 + C.X1) / 2, cz = (C.Z0 + C.Z1) / 2;
    B.light(cx, cz + (p.cs > 0 ? -1.5 : 1.5), { kind: "dome", r: 4.8, i: 0.45, color: 0xffe0b0 });
  }

  function planOf(b, r, k, n) {
    const kind = floorKind(b, k, n);
    if (kind === "ground") return { kind: kind, g: planGround(b, r) };
    if (kind === "kitchen") return { kind: kind, g: planKitchen(b, r, k) };
    if (kind === "boss") return { kind: kind, g: planBoss(b, r, k) };
    return { kind: kind, g: planCrash(b, r, k) };
  }

  if (CBZ.fitoutPlan) CBZ.fitoutPlan("hideout", function (B) {
    const b = B.b, k = B.k, r = B.rect;
    if (!r) return;
    const n = (B.info && B.info.floors) || floorsOf(b);
    const P = planOf(b, r, k, n);
    // an owner who cleared this floor keeps the shell, the light and the finish
    if (CBZ.fitoutRoomCleared && CBZ.fitoutRoomCleared(B, "f:" + k)) {
      const G = P.g.C;
      B.plane(G.X0, G.Z0, G.X1, G.Z1, B.fy, P.kind === "crash" || P.kind === "boss" ? "wood" : "vinyl", 0xb3ae9f, { cell: 0.6 });
      drywallCeiling(B, G.X0, G.Z0, G.X1, G.Z1, 0xd8d2c6, 0xf1);
      skinWalls(B, P.kind === "ground" ? "brick" : "plaster", P.kind === "ground" ? 0xc9bdb2 : 0xc2b9a6, P.kind === "ground", { salt: 0xf2 });
      cageLight(B, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, { cage: false, drop: 0.45, r: 5.5, i: 0.6 });
      return;
    }
    if (P.kind === "ground") drawGround(B, P.g);
    else if (P.kind === "kitchen") drawKitchen(B, P.g);
    else if (P.kind === "boss") drawBoss(B, P.g);
    else drawCrash(B, P.g);
  });

  /* ========================================================================
     4. CATALOGUE VERBS — pieces an OWNER places (fitout.js interiorFurnish).
     The owned safe is a safe you look at, not a loot container: a container
     that pays cash nobody put in would turn the 2500 price tag into a faucet
     (buy, crack, move it a metre, crack it again).
     ======================================================================== */
  if (CBZ.fitoutDraw) {
    CBZ.fitoutDraw("safe", function (B, x, z, yaw) { floorSafe(B, x, z, yaw || 0); });
    CBZ.fitoutDraw("gunrack", function (B, x, z, yaw) { gunRack(B, x, z, yaw || 0); });
    CBZ.fitoutDraw("counttable", function (B, x, z, yaw) {
      const alongX = (Math.round((yaw || 0) / HP) & 1) === 0;
      const fx = Math.sin(yaw || 0), fz = Math.cos(yaw || 0);
      countTable(B, x, z, alongX, true, function (a, c) { return B.h(x + a, z + c, 0xe1); }, alongX ? fz : fx);
      // his chair on the forward side, facing back over the table
      foldChair(B, x + fx * 0.83, z + fz * 0.83, (yaw || 0) + PI, true);
    });
  }

  /* ========================================================================
     5. THE CREW — declared per held hideout, real members of the holder.
     ======================================================================== */
  const HIDE = { list: [], lots: null, declared: 0, open: false, acc: 0, wacc: 0 };
  const RANK_HP = { lookout: 110, runner: 120, soldier: 140 };

  function gangOf(id) { return (id != null && CBZ.cityGangById) ? CBZ.cityGangById(id) : null; }
  function held(rec, gid) {
    const lot = rec.lot, bd = lot && lot.building, st = bd && bd.stash;
    if (!st || gid == null || st.gang !== gid || lot.demolished) return false;
    if (lot._occupancy) return false;                 // the HQ: occupy.js garrisons it already
    if (bd.playerTurf) return false;                  // your crew's block: no rival sits in it
    const G = gangOf(gid);
    return !!(G && !G.isPlayer && !G.absorbed && G.id !== "player");
  }

  function index(A) {
    const lots = (A && A.abandonedLots) || (CBZ.city && CBZ.city.arena && CBZ.city.arena.abandonedLots) || null;
    HIDE.list = []; HIDE.lots = lots; HIDE.declared = 0;
    if (CBZ.cityStaffVenue) { CBZ.cityStaffVenue("hideouts", { stations: 0, note: "gang hideouts" }); HIDE.open = true; }
    if (!lots) return;
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i], b = lot && lot.building;
      if (!b || b.w == null || b.d == null || b.park || lot.demolished) continue;
      const n = floorsOf(b);
      // THE STAIRS, before anything is planned: the core is carved out of
      // every floor it rises through, and every plan below (and the fit-out
      // that draws the same plans later) furnishes round it.
      stairsFor(lot, b, n);
      const r0 = roomOf(b, 0);
      if (!r0) continue;
      let g = null;
      try { g = planGround(b, r0); } catch (e) { g = null; }
      if (!g) continue;
      // the gang's stash point moves onto the count table the fit-out stands,
      // and the table's own take (interior_programs.js "countroom") is the one
      // verb for it: interact.js's bare stash grab stands down for this lot
      if (b.stash) { b.stash.x = (b.ox || 0) + g.table.x; b.stash.z = (b.oz || 0) + g.table.z; b.stash.countRoom = true; }
      let cook = null, cookK = -1;
      for (let k = 1; k < n; k++) {
        if (floorKind(b, k, n) !== "kitchen") continue;
        const rk = roomOf(b, k);
        if (!rk) continue;
        try { cook = planKitchen(b, rk, k).cook; cookK = k; } catch (e) { cook = null; }
        break;
      }
      HIDE.list.push({ lot: lot, i: i, b: b, g: g, cook: cook, cookK: cookK, decl: Object.create(null),
                       looted: !!(b.stash && b.stash.looted), awake: false });
    }
  }
  if (CBZ.addLandmass) CBZ.addLandmass(function (city) { index(city || (CBZ.city && CBZ.city.arena)); }, 90.6);

  // A walk-up of two or more floors gets a real stair core (the switchback
  // rig elevators.js builds for occupied buildings: treads, handrails, a
  // landing per half-storey, ramp platforms you and the AI walk on, the slabs
  // carved where it rises). It stands in a back corner; with the street door
  // on a side wall it takes the corner away from the count room's wall.
  function stairsFor(lot, b, n) {
    if (n < 2 || !CBZ.cityStairCore) return null;
    let core = coreOf(b);
    if (!core) {
      const d = doorOf(b);
      const side = Math.abs(d.nx) > 0.5 ? (d.nx > 0 ? -1 : 1) : (hsh(b, 0, 4, 9, 0x5c) < 0.5 ? -1 : 1);
      try { core = CBZ.cityStairCore(lot, { side: side }); } catch (e) { core = null; }
    }
    if (core) {
      b._stairCore = core;
      if (b.group) b.group.userData.stairCore = core;
    }
    return core;
  }

  function jobsFor(rec, gid) {
    const b = rec.b, g = rec.g, ox = b.ox || 0, oz = b.oz || 0, fy0 = fyOf(b, 0);
    const out = [];
    if (g.lookout) out.push({ role: "lookout", rank: "lookout", weapon: "Pistol",
      x: ox + g.lookout.x, z: oz + g.lookout.z, face: g.lookout.face, seat: [ox + g.lookout.x, fy0, oz + g.lookout.z, g.lookout.face, "chair", 0.45] });
    out.push({ role: "counter", rank: "soldier", weapon: "Pistol",
      x: ox + g.chair.x, z: oz + g.chair.z, face: g.chair.face, seat: [ox + g.chair.x, fy0, oz + g.chair.z, g.chair.face, "chair", 0.45] });
    if (g.sofa && hsh(b, 0, 7, 7, 0x5a) > 0.3) {
      // the kit sofa's first seat, exactly where furniture.js files it
      const s = g.sofa, lat = -s.len / 3, fwd = 0.03, c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      const sx = s.x + lat * c + fwd * sn, sz = s.z - lat * sn + fwd * c;
      out.push({ role: "sofa", rank: "runner", weapon: hsh(b, 0, 8, 8, 0x5b) < 0.35 ? "SMG" : "Pistol",
        x: ox + sx, z: oz + sz, face: s.yaw, seat: [ox + sx, fy0, oz + sz, s.yaw, "sofa", 0.40] });
    }
    if (rec.cook) out.push({ role: "cook", rank: "soldier", weapon: "Pistol",
      x: ox + rec.cook.x, z: oz + rec.cook.z, face: rec.cook.face, floorY: topOf(b, rec.cookK) + 0.05 });
    return out;
  }

  function declare(rec, gid) {
    if (!CBZ.cityStaffPost) return 0;
    const G = gangOf(gid);
    if (!G) return 0;
    const jobs = jobsFor(rec, gid);
    const posts = [];
    for (let j = 0; j < jobs.length; j++) {
      const J = jobs[j];
      const hp = RANK_HP[J.rank] || 120;
      const opts = { kind: "gang", gang: gid, faction: gid, outfit: G.color, armed: true, weapon: J.weapon,
                     hp: hp, aggr: 0.82, wealth: 0.4 };
      if (J.floorY != null) opts.floorY = J.floorY;
      const seatArgs = J.seat;
      const seatFn = seatArgs ? function () { return seatAt(seatArgs[0], seatArgs[1], seatArgs[2], seatArgs[3], seatArgs[4], seatArgs[5], rec.lot); } : null;
      const p = CBZ.cityStaffPost({
        venue: "hideouts", id: "hide:" + rec.i + ":" + gid + ":" + J.role,
        x: J.x, z: J.z, face: J.face,
        job: "gang " + J.rank, archetype: "gangster", opts: opts,
        seat: seatFn,
        alive: function () { return held(rec, gid); },
        after: function (ped) {
          ped.kind = "gang"; ped.gang = gid; ped.faction = gid;
          ped.rank = J.rank; ped.ammo = J.weapon === "SMG" ? 40 : 30;
          ped.hp = hp; ped.maxHp = hp;
          // garrison: the war director and the roster review leave a posted
          // body at its post (gangs.js skips _occupyGarrison)
          ped._occupyGarrison = true;
          ped._hideout = rec;
          ped._occupyPost = { x: J.x, z: J.z, face: J.face };
          ped._hideJob = J; ped._hideSeat = seatFn;     // where he goes back to (see THE WAY BACK)
          const GG = gangOf(gid);
          if (GG && GG.members && GG.members.indexOf(ped) < 0) GG.members.push(ped);
          if (CBZ.cityMemberStats) { try { CBZ.cityMemberStats(ped); } catch (e) {} }
          // a house that is already up does not sit back down for a new body
          if (rec.awake && rec.threat) wake(ped, rec.threat);
        },
        release: function (ped) {
          const GG = gangOf(gid);
          if (GG && GG.members) { const i = GG.members.indexOf(ped); if (i >= 0) GG.members.splice(i, 1); }
          return false;
        },
        near: 95, far: 140,
      });
      if (p) posts.push(p);
    }
    rec.decl[gid] = posts;
    HIDE.declared += posts.length;
    if (CBZ.cityStaffStations) CBZ.cityStaffStations("hideouts", HIDE.declared);
    return posts.length;
  }

  // the same field trio occupy.js's wake() and lootConsequence write
  function wake(p, threat) {
    if (!p || p.dead) return;
    notePost(p);                                       // before the chair is left
    stopHoming(p);
    if ((p._propSeat || p.state === "sit") && CBZ.propStand) { try { CBZ.propStand(p, { instant: true }); } catch (e) {} }
    p._deskAnchor = null;
    p.mem = threat; p.alarmed = Math.max(p.alarmed || 0, 4);
    if (p.staffPost) { p._occupyPost = p._occupyPost || { x: p.staffPost.x, z: p.staffPost.z, face: p.staffPost.face }; p.staffPost = null; }
    if (p._occupyPost) { p.guard = { x: p._occupyPost.x, z: p._occupyPost.z }; p.homeGuard = p.guard; }
    if (threat) { p.rage = threat; p.state = "fight"; }
  }

  function bodiesOf(rec) {
    const out = [];
    for (const gid in rec.decl) {
      const L = rec.decl[gid];
      for (let i = 0; i < L.length; i++) { const p = L[i].ped; if (p && !p.dead) out.push(p); }
    }
    return out;
  }

  /* ---- THE WAY BACK ------------------------------------------------------
     A house that got up for a robbery sits back down once it is over. Each
     body's post (the chair, the sofa seat, the cook's spot at the burners,
     its facing and its floor) is noted the moment it is woken. When the threat
     is gone (the robber dead, or out of the building and nobody on him for a
     while, longer while he is still wanted) every body walks home through the
     shared move-order seam (peds.js move() -> CBZ.moves): round the count-room
     partition by its doorway, up or down the stair core by its flights, then
     back into the chair (propSit walks the last step in) or back onto the
     post. If the house wakes again on the way, the walk is dropped and the
     fight brain has him. */
  const HOMING = [];
  function floorAt(b, y) {
    const n = floorsOf(b);
    let k = 0;
    for (let i = 1; i < n; i++) if (y >= topOf(b, i) - 0.6) k = i;
    return k;
  }
  function notePost(p) {
    if (!p || p._hideHome || !p._hideJob || !p._hideout) return;
    const J = p._hideJob, b = p._hideout.b;
    const up = J.floorY != null && J.floorY > 0.2;
    p._hideHome = {
      x: J.x, z: J.z, face: J.face,
      y: up ? J.floorY : 0, k: up ? floorAt(b, J.floorY) : 0,
      seat: p._hideSeat || null,
      pose: (p.char && p.char.pose) || null,
    };
  }
  function homeOrder(p, x, z, stop, leg) {
    let o = p.moveOrder;
    if (!o || !o._hide) o = p.moveOrder = { _hide: true, x: 0, z: 0, speed: 0, stop: 0.3, face: null, strafe: false, vffX: 0, vffZ: 0, leg: false, t: 0 };
    o.x = x; o.z = z; o.speed = p.baseSpeed || 1.5; o.stop = stop; o.leg = !!leg; o.t = CBZ.now || 0;
    if (p.state !== "walk") p.state = "walk";
    p.pause = 0;
  }
  function stopHoming(p) {
    if (!p) return;
    if (p.moveOrder && p.moveOrder._hide) p.moveOrder = null;
    for (let i = HOMING.length - 1; i >= 0; i--) if (HOMING[i].p === p) HOMING.splice(i, 1);
  }
  // the walk home, as world waypoints: the stair core's flights when he is on
  // another floor, the count-room doorway when the partition is between him
  // and his post, then the post itself
  function routeHome(rec, p) {
    const b = rec.b, H = p._hideHome, ox = b.ox || 0, oz = b.oz || 0;
    const pts = [];
    const kNow = floorAt(b, p.pos.y || 0), core = coreOf(b);
    if (kNow !== H.k && core && core.route) {
      const r = core.route(kNow, H.k);
      for (let i = 0; i < r.length; i++) pts.push({ x: r[i].x, z: r[i].z, stair: true });
    }
    const g = rec.g;
    if (H.k === 0 && g && g.wall) {
      const cs = g.cs, from = pts.length ? pts[pts.length - 1] : p.pos;
      const inA = cs * (from.z - oz) > cs * g.zp, inB = cs * (H.z - oz) > cs * g.zp;
      if (inA !== inB) {
        const lounge = { x: ox + g.gx, z: oz + g.zp - cs * 0.9 }, band = { x: ox + g.gx, z: oz + g.zp + cs * 0.9 };
        if (inA) pts.push(band, lounge); else pts.push(lounge, band);
      }
    }
    pts.push({ x: H.x, z: H.z });
    return pts;
  }
  function sendHome(rec, p) {
    if (!p || p.dead || !p.pos || p.controlled || p.companion || p.recruited || p.restraint || p.driving || p.inCar) return;
    notePost(p);
    const H = p._hideHome;
    if (!H) return;
    p.rage = null; p.mem = null; p.alarmed = 0; p._combatFace = null;
    if (p.state === "fight" || p.state === "confront") p.state = "walk";
    // the loiter anchor is the post (should the order lapse, he idles THERE)
    p.guard = { x: H.x, z: H.z }; p.homeGuard = p.guard;
    stopHoming(p);
    const pts = routeHome(rec, p);
    // a body held at storey height by occupy.js's floor lift is let go for a
    // climb, so the flights' ramps carry his feet
    if (pts.length && pts[0].stair && p._occupyY > 0.2 && CBZ.cityFloorPed) CBZ.cityFloorPed(p, 0);
    HOMING.push({ p: p, rec: rec, pts: pts, i: 0, t: 0 });
  }
  function settleHome(h, snap) {
    const p = h.p, H = p._hideHome;
    stopHoming(p);
    if (!H || p.dead) return;
    if (snap) {
      p.pos.x = H.x; p.pos.z = H.z;
      if (p.target && p.target.set) p.target.set(H.x, 0, H.z);
      if (!(H.y > 0.2)) p.pos.y = fyOf(h.rec.b, 0) - 0.06;
      if (CBZ.moves && CBZ.moves.reset && CBZ.moves.motor) CBZ.moves.reset(CBZ.moves.motor(p), p.pos);
    }
    if (H.y > 0.2 && CBZ.cityFloorPed) CBZ.cityFloorPed(p, H.y);
    p.guard = null; p.homeGuard = null; p.path = null; p.finalGoal = null;
    let seated = false;
    if (H.seat && CBZ.propSit) {
      let s = null;
      try { s = H.seat(); } catch (e) { s = null; }
      if (s) { try { seated = !!CBZ.propSit(p, s, snap ? { instant: true } : null); } catch (e) { seated = false; } }
    }
    if (!seated) {
      // back on the post: peds.js's posted brain roots him, facing his way
      p.staffPost = { x: H.x, z: H.z, face: H.face };
      p.state = "idle"; p.speed = 0;
      if (H.pose && CBZ.setCharPose && p.char) { try { CBZ.setCharPose(p.char, H.pose); } catch (e) {} }
    }
  }
  function driveHoming(dt, P) {
    for (let i = HOMING.length - 1; i >= 0; i--) {
      const h = HOMING[i], p = h.p;
      if (!p || p.dead || !p.pos || (CBZ.cityPeds && CBZ.cityPeds.indexOf(p) < 0)) { HOMING.splice(i, 1); continue; }
      // woken again, cuffed, held up, knocked down, taken over: not ours
      if (p.rage || p.state === "fight" || p.surrender || p.surrenderT > 0 || (p.ko | 0) > 0
          || p.controlled || p.restraint || p.driving || p.inCar) {
        if (p.moveOrder && p.moveOrder._hide) p.moveOrder = null;
        HOMING.splice(i, 1);
        continue;
      }
      h.t += dt;
      const q = h.pts[h.i], last = h.i === h.pts.length - 1;
      const dx = q.x - p.pos.x, dz = q.z - p.pos.z;
      // a chair is walked up to, not into: propSit takes the last step
      const rad = last ? (p._hideHome && p._hideHome.seat ? 1.0 : 0.5) : 0.65;
      if (dx * dx + dz * dz < rad * rad) {
        h.i++;
        if (h.i >= h.pts.length) settleHome(h, false);
        continue;
      }
      // nobody walks forever: out of your sight a stuck or overlong walk is
      // finished for him, in view he keeps trying a good while longer
      const pdx = p.pos.x - P.pos.x, pdz = p.pos.z - P.pos.z, far = pdx * pdx + pdz * pdz > 35 * 35;
      const stuck = !!(p._mv && p._mv.stuckN > 5);
      if ((far && (h.t > 30 || stuck)) || h.t > 120) { settleHome(h, true); continue; }
      homeOrder(p, q.x, q.z, last ? (rad > 0.6 ? 0.8 : 0.3) : 0.2, !last);
    }
  }
  // is whatever woke the house still a threat to it
  function isPlayerish(T, P) { return !!T && (T === P || T === (CBZ.city && CBZ.city.playerActor) || T.isPlayer); }
  function threatNear(rec, T, P) {
    if (!T) return false;
    const isP = isPlayerish(T, P);
    if (isP ? P.dead : T.dead) return false;
    const tp = isP ? P.pos : T.pos;
    if (!tp) return false;
    const lot = rec.lot, b = rec.b;
    const hw = (b.w || 20) / 2 + 12, hd = (b.d || 20) / 2 + 12;
    if (Math.abs(tp.x - lot.cx) < hw && Math.abs(tp.z - lot.cz) < hd) return true;
    // outside, but somebody is still on him close up
    const bodies = bodiesOf(rec);
    for (let j = 0; j < bodies.length; j++) {
      const q = bodies[j];
      if (!q.rage || !q.pos) continue;
      const dx = q.pos.x - tp.x, dz = q.pos.z - tp.z;
      if (dx * dx + dz * dz < 22 * 22) return true;
    }
    return false;
  }
  function standDown(rec) {
    rec.awake = false; rec.threat = null; rec.calmT = 0;
    const bodies = bodiesOf(rec);
    for (let j = 0; j < bodies.length; j++) sendHome(rec, bodies[j]);
  }

  CBZ.onUpdate && CBZ.onUpdate(41.9, function (dt) {
    const game = CBZ.game;
    if (!game || game.mode !== "city") return;
    const A = CBZ.city && CBZ.city.arena;
    if (A && A.abandonedLots && A.abandonedLots !== HIDE.lots) index(A);
    if (!HIDE.list.length) return;
    const P = CBZ.player;
    if (!P || !P.pos) return;
    const px = P.pos.x, pz = P.pos.z;
    const threat0 = (CBZ.city && CBZ.city.playerActor) || P;
    if (HOMING.length) driveHoming(dt || 0, P);

    // ---- the house wakes together (2 Hz, only hideouts you are close to)
    HIDE.wacc += dt || 0;
    if (HIDE.wacc >= 0.5) {
      HIDE.wacc = 0;
      for (let i = 0; i < HIDE.list.length; i++) {
        const rec = HIDE.list[i], lot = rec.lot;
        const dx = lot.cx - px, dz = lot.cz - pz, d2 = dx * dx + dz * dz;
        const st = lot.building && lot.building.stash;
        // walked well away: whatever was up is over, they go back to work
        if (d2 > 60 * 60) { if (st) rec.looted = !!st.looted; if (rec.awake) standDown(rec); continue; }
        const bodies = bodiesOf(rec);
        let trig = null;
        if (st && st.looted && !rec.looted) {
          rec.looted = true;
          // the stacks leave the table the moment the count is gone
          if (CBZ.fitoutRebuild) CBZ.fitoutRebuild(lot.building, 0);
          if (d2 < 30 * 30) trig = threat0;
        } else if (st && !st.looted && rec.looted) {
          // restocked: the count is back on the table (and takeable again)
          rec.looted = false;
          if (CBZ.fitoutRebuild) CBZ.fitoutRebuild(lot.building, 0);
        }
        if (!rec.awake) {
          for (let j = 0; j < bodies.length && !trig; j++) {
            const p = bodies[j];
            if (p.rage || p.state === "fight" || (p.alarmed > 0 && p.mem)) trig = p.rage || p.mem || threat0;
          }
        } else if (!trig) {
          // up already: one that is newly on somebody else re-aims the house
          for (let j = 0; j < bodies.length && !trig; j++) {
            const p = bodies[j];
            if (p.rage && p.rage !== rec.threat && !(isPlayerish(p.rage, P) && isPlayerish(rec.threat, P))
                && threatNear(rec, p.rage, P)) trig = p.rage;
          }
        }
        if (trig) {
          rec.awake = true; rec.threat = trig; rec.calmT = 0;
          for (let j = 0; j < bodies.length; j++) {
            const p = bodies[j];
            if (p.rage && p.state === "fight") { notePost(p); stopHoming(p); continue; }
            wake(p, trig);
          }
          continue;
        }
        if (!rec.awake) continue;
        // ---- the threat passing: out of the building and nobody on him for a
        // while (twice as long while the robber is still wanted), or dead
        const T = rec.threat, TP = isPlayerish(T, P);
        const tDead = !T || (TP ? !!P.dead : !!T.dead);
        if (tDead || !threatNear(rec, T, P)) rec.calmT = (rec.calmT || 0) + 0.5; else rec.calmT = 0;
        const hot = !tDead && TP && ((game.wanted | 0) > 0);
        if (rec.calmT >= (tDead ? 4 : hot ? 24 : 12)) standDown(rec);
      }
    }

    // ---- declare the holder's crew in hideouts you are approaching (1 Hz)
    HIDE.acc += dt || 0;
    if (HIDE.acc < 1.0) return;
    HIDE.acc = 0;
    // a citystaff reset wiped every post: forget what we declared
    if (HIDE.declared && CBZ.cityStaffPosts) {
      const all = CBZ.cityStaffPosts();
      let any = false;
      for (let i = 0; i < all.length && !any; i++) if (all[i].venue === "hideouts") any = true;
      if (!any) {
        HIDE.declared = 0;
        for (let i = 0; i < HIDE.list.length; i++) HIDE.list[i].decl = Object.create(null);
      }
    }
    for (let i = 0; i < HIDE.list.length; i++) {
      const rec = HIDE.list[i], lot = rec.lot;
      const dx = lot.cx - px, dz = lot.cz - pz;
      if (dx * dx + dz * dz > 160 * 160) continue;
      const st = lot.building && lot.building.stash;
      const gid = st && st.gang;
      if (gid == null || rec.decl[gid] || !held(rec, gid)) continue;
      declare(rec, gid);
    }
  });

  CBZ.fitoutGangAudit = function () {
    let live = 0, posts = 0, lost = 0;
    for (let i = 0; i < HIDE.list.length; i++) for (const gid in HIDE.list[i].decl) {
      const L = HIDE.list[i].decl[gid];
      for (let j = 0; j < L.length; j++) { posts++; if (L[j].ped && !L[j].ped.dead) live++; if (L[j].lost) lost++; }
    }
    return { hideouts: HIDE.list.length, posts: posts, live: live, lost: lost };
  };
  // pure plans, for tools and presets
  CBZ.fitoutGangPlan = function (b, k) {
    const r = roomOf(b, k | 0);
    return r ? planOf(b, r, k | 0, floorsOf(b)) : null;
  };
})();
