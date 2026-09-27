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

  // ---- the placement ledger: a floor's free space, door lane and taken rects
  function ctx(b, r, k) {
    return { b: b, r: r, k: k, X0: r.x0 - 0.4, X1: r.x1 + 0.4, Z0: r.z0 - 0.4, Z1: r.z1 + 0.4,
             door: doorOf(b), taken: [] };
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
    const side = onZ ? (hsh(b, 0, 1, 2, 0x51) < 0.5 ? -1 : 1) : (d.x < 0 ? 1 : -1);
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
      for (let i = 0; i < segs.length; i++) {
        if (Math.abs(segs[i][0] - (C.X0 + 0.06)) < 1e-3) segs[i][0] = C.X0;
        if (Math.abs(segs[i][1] - (C.X1 - 0.06)) < 0.2) segs[i][1] = C.X1;
        covered += segs[i][1] - segs[i][0];
      }
      if (covered < 0.6 * (C.X1 - C.X0)) { wall = false; segs.length = 0; D = Math.min(Dw, 2.8); }
    }
    const zpF = zw - cs * D;
    if (wall) {
      take(C, C.X0, zpF - 0.1, C.X1, zpF + 0.1);
      take(C, gx - 0.65, zpF - 1.0, gx + 0.65, zpF + 1.0);        // both sides of the doorway stay clear
    }
    // the eager duffel (buildings.js makeStash): nothing is drawn over it
    const dz = b.d / 2 - 2.6;
    take(C, -0.58, dz - 0.3, 0.58, dz + 0.3);

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
    // our own bag when the eager duffel is out by the door
    let duffel = null;
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
      eagerDuffel: { x: 0, z: dz },
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
    const cook = alongX ? { x: t.x - 0.35, z: t.z - (W / 2 + 0.42), face: 0 }
                        : { x: t.x - (W / 2 + 0.42), z: t.z - 0.35, face: HP };
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
        bags = { x: c.x, z: c.z, alongX: c.ax };
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
    // a sofa against a side wall and the gun rack on the other
    const sc = [];
    const zc = (C.Z0 + C.Z1) / 2;
    for (let i = 0; i < 3; i++) {
      const z = zc + (i === 0 ? 0 : i === 1 ? 1.3 : -1.3);
      sc.push({ x: C.X0 + 0.47, z: z, x0: C.X0 + 0.02, x1: C.X0 + 1.4, z0: z - 1.05, z1: z + 1.05, yaw: HP });
      sc.push({ x: C.X1 - 0.47, z: z, x0: C.X1 - 1.4, x1: C.X1 - 0.02, z0: z - 1.05, z1: z + 1.05, yaw: -HP });
    }
    const sofa = first(C, spin(sc, hsh(b, k, 3, 3, 0x91)));
    const rc = [];
    for (let i = 0; i < 3; i++) {
      const z = zc + (i === 0 ? 0 : i === 1 ? -1.5 : 1.5);
      rc.push({ x: C.X1 - 0.2, z: z, x0: C.X1 - 0.95, x1: C.X1 - 0.02, z0: z - 0.75, z1: z + 0.75, yaw: -HP });
      rc.push({ x: C.X0 + 0.2, z: z, x0: C.X0 + 0.02, x1: C.X0 + 0.95, z0: z - 0.75, z1: z + 0.75, yaw: HP });
    }
    const rack = first(C, rc);
    return { C: C, cs: cs, zw: zw, desk: desk, safe: safe, sofa: sofa, rack: rack };
  }

  /* ========================================================================
     2. DRAWING — pieces in building-local metres, standing on B.fy.
     ======================================================================== */
  const COL = {
    metal: 0x3c4046, steel: 0xaeb3b7, steelD: 0x7d8387, black: 0x17181a,
    ply: 0xb08d5e, crate: 0x8a6a45, crateD: 0x6b5236, cash: 0x6f8f5f, cashD: 0x5a7650, band: 0xd8cfa6,
    rubber: 0xb8864f, glass: 0xcfe3e0, jug: 0xe8ece6, tarp: 0x9fb0b8, sheet: 0xdfe6e8,
  };
  const CAN = [0xc0392b, 0x2e6fbf, 0xd8d8d0, 0x2f7d3a, 0xd9a520, 0x1f1f22];
  const SHEETS = [0xc9b8a0, 0x8fa3b8, 0xb89a9a, 0xd8d2c0, 0x7f8f78, 0x9d8ab0];

  // a piece frame: (lat, up, fwd) in the piece's own axes, forward = (sin yaw, cos yaw)
  function piece(B, x, z, yaw) {
    const s = Math.sin(yaw), c = Math.cos(yaw), swap = (Math.round(yaw / HP) & 1) === 1;
    return function (lat, up, fwd, across, h, deep, col, o) {
      return B.box(x + lat * c + fwd * s, B.fy + up + h / 2, z - lat * s + fwd * c,
        swap ? deep : across, h, swap ? across : deep, col, o);
    };
  }
  function seatAt(wx, y, wz, face, kind, cushion, lot) {
    if (!CBZ.propRegisterSeat) return null;
    const near = CBZ.propNearestSeat ? CBZ.propNearestSeat(wx, wz, 0.2, y) : null;
    if (near) return near;
    return CBZ.propRegisterSeat(wx, y, wz, face, kind, lot || null, { cushion: cushion, floorBelow: 0 });
  }

  function foldChair(B, x, z, yaw, seat) {
    const p = piece(B, x, z, yaw), m = COL.metal, s = 0x5d6166;
    for (let a = -1; a <= 1; a += 2) {
      p(a * 0.19, 0, 0.17, 0.025, 0.42, 0.025, m);             // front legs
      p(a * 0.19, 0, -0.19, 0.025, 0.86, 0.025, m);            // rear legs, up into the back
    }
    p(0, 0.18, 0.17, 0.36, 0.02, 0.02, m);                     // stretcher
    p(0, 0.42, 0, 0.42, 0.03, 0.42, s);                        // seat -> 0.45
    p(0, 0.6, -0.19, 0.4, 0.22, 0.025, s);                     // back panel
    if (seat) seatAt(B.ox + x, B.fy, B.oz + z, yaw, "chair", 0.45, B.lot);
  }
  function crateBox(B, x, y0, z, w, h, d, col, o) {
    const cy = y0 + h / 2;
    B.box(x, cy, z, w, h, d, col, o);
    // two proud slats round the long faces and a lid rim: reads as a crate
    const sw = w >= d;
    B.box(x, y0 + h * 0.25, z, sw ? w + 0.02 : w + 0.02, 0.07, sw ? d + 0.02 : d + 0.02, COL.crateD);
    B.box(x, y0 + h * 0.75, z, w + 0.02, 0.07, d + 0.02, COL.crateD);
    B.box(x, y0 + h + 0.01, z, w * 0.96, 0.02, d * 0.96, COL.crate);
    return y0 + h + 0.02;
  }
  function milkCrate(B, x, y0, z, col) {
    const s = 0.33;
    B.box(x, y0 + 0.01, z, s, 0.02, s, col);
    B.box(x, y0 + s / 2, z - s / 2 + 0.01, s, s, 0.02, col); B.box(x, y0 + s / 2, z + s / 2 - 0.01, s, s, 0.02, col);
    B.box(x - s / 2 + 0.01, y0 + s / 2, z, 0.02, s, s - 0.04, col); B.box(x + s / 2 - 0.01, y0 + s / 2, z, 0.02, s, s - 0.04, col);
    return y0 + s;
  }
  function can(B, x, y, z, col, lying, alongX) {
    if (lying) B.box(x, y + 0.033, z, alongX ? 0.123 : 0.066, 0.066, alongX ? 0.066 : 0.123, col);
    else { B.box(x, y + 0.06, z, 0.064, 0.12, 0.064, col); B.box(x, y + 0.122, z, 0.05, 0.005, 0.05, 0xc8c8c8); }
  }
  function ashtray(B, x, y, z) {
    B.box(x, y + 0.015, z, 0.12, 0.03, 0.12, 0x55595e);
    B.box(x + 0.02, y + 0.034, z, 0.05, 0.008, 0.012, 0xe8e2d0);
    B.box(x - 0.02, y + 0.034, z + 0.02, 0.012, 0.008, 0.045, 0xe8e2d0);
  }
  function pizzaBox(B, x, y, z, n) {
    for (let i = 0; i < n; i++) B.box(x + i * 0.03, y + 0.023 + i * 0.046, z - i * 0.02, 0.4, 0.045, 0.4, i & 1 ? 0xc9a46b : 0xd3b27a);
    return y + n * 0.046;
  }
  // a TV on a crate: the screen faces `yaw`
  function tvOnCrate(B, x, z, yaw, on) {
    const alongX = (Math.round(yaw / HP) & 1) === 0;
    const w = alongX ? 0.86 : 0.46, d = alongX ? 0.46 : 0.86;
    const ct = crateBox(B, x, B.fy, z, w, 0.46, d, COL.crate, { solid: true });
    const p = piece(B, x, z, yaw);
    const up = ct - B.fy;
    p(0, up, 0, 0.3, 0.02, 0.18, COL.black);                   // foot
    p(0, up + 0.02, -0.02, 0.06, 0.08, 0.04, COL.black);       // neck
    p(0, up + 0.08, -0.02, 0.98, 0.58, 0.06, COL.black);       // body
    p(0, up + 0.12, 0.012, 0.9, 0.5, 0.012, on ? 0x3d5f82 : 0x0f1317, on ? { glow: true } : null);
    if (on) B.lamp(x + Math.sin(yaw) * 0.4, B.fy + up + 0.35, z + Math.cos(yaw) * 0.4, { color: 0x8fb4ff, r: 2.4, i: 0.22 });
  }
  // a folding table (top at 0.74); returns the top y
  function foldTable(B, x, z, alongX, L, W, topCol) {
    const lx = alongX ? L : W, lz = alongX ? W : L;
    B.box(x, B.fy + 0.72, z, lx, 0.04, lz, topCol || 0xcfc8b6);
    B.box(x, B.fy + 0.685, z, lx - 0.08, 0.03, lz - 0.08, COL.metal);
    for (let a = -1; a <= 1; a += 2) for (let c = -1; c <= 1; c += 2)
      B.box(x + a * (lx / 2 - 0.06), B.fy + 0.35, z + c * (lz / 2 - 0.06), 0.03, 0.7, 0.03, COL.metal);
    B.solid(x - lx / 2, x + lx / 2, z - lz / 2, z + lz / 2, B.fy, B.fy + 0.76);
    return B.fy + 0.74;
  }
  function cashStack(B, x, y, z, h, alongX) {
    B.box(x, y + h / 2, z, alongX ? 0.156 : 0.066, h, alongX ? 0.066 : 0.156, COL.cash);
    B.box(x, y + h / 2, z, alongX ? 0.035 : 0.07, h + 0.004, alongX ? 0.07 : 0.035, COL.band);
  }
  function pistol(B, x, y, z, alongX) {
    B.box(x, y + 0.017, z, alongX ? 0.19 : 0.032, 0.034, alongX ? 0.032 : 0.19, COL.black);
    B.box(x - (alongX ? 0.06 : 0), y + 0.015, z + (alongX ? 0.055 : -0.06), alongX ? 0.032 : 0.1, 0.03, alongX ? 0.1 : 0.032, 0x222326);
  }
  // THE COUNT TABLE: machine, banded stacks, a scale, rubber bands, a pistol.
  // `full` false = the count is gone (rubber bands and an empty table).
  // `sgn` is the side (+1/-1 across the table) the counter sits on.
  function countTable(B, x, z, alongX, full, h, sgn) {
    const T = foldTable(B, x, z, alongX, 1.8, 0.9, 0xd2cbb8);
    const sg = sgn < 0 ? -1 : 1;
    const ax = function (a, c) { return alongX ? [x + a, z + c * sg] : [x + c * sg, z + a]; };  // a along the table, c across (toward the chair)
    // the counting machine, facing the chair side (+c)
    const m = ax(-0.45, 0.05);
    B.box(m[0], T + 0.1, m[1], alongX ? 0.3 : 0.26, 0.2, alongX ? 0.26 : 0.3, 0x3b3f44);
    B.box(m[0], T + 0.205, m[1], alongX ? 0.2 : 0.07, 0.012, alongX ? 0.07 : 0.2, 0x151618);   // hopper
    const md = ax(-0.45, 0.185);
    B.box(md[0], T + 0.16, md[1], alongX ? 0.09 : 0.006, 0.03, alongX ? 0.006 : 0.09, 0x7cff9a, { glow: true });
    const mt = ax(-0.45, 0.24);
    B.box(mt[0], T + 0.03, mt[1], alongX ? 0.18 : 0.08, 0.04, alongX ? 0.08 : 0.18, 0x2a2d31); // bill tray
    if (full) {
      // banded stacks in rows, some tall, some short (hash, not a roll)
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        const q = ax(-0.05 + i * 0.19, -0.26 + j * 0.1);
        const hs = 0.03 + Math.floor(h(i, j) * 4) * 0.025;
        cashStack(B, q[0], T, q[1], hs, alongX);
      }
      const s2 = ax(0.72, -0.2);
      cashStack(B, s2[0], T, s2[1], 0.06, alongX);
    }
    // rubber bands
    for (let i = 0; i < 6; i++) {
      const q = ax(0.25 + h(i, 7) * 0.5, 0.05 + h(i, 8) * 0.3);
      B.box(q[0], T + 0.003, q[1], 0.05, 0.006, 0.012 + h(i, 9) * 0.02, COL.rubber);
    }
    // the digital scale
    const sc = ax(0.62, 0.18);
    B.box(sc[0], T + 0.015, sc[1], 0.2, 0.03, 0.2, 0xb9bec2);
    const sd = ax(0.62, 0.285);
    B.box(sd[0], T + 0.02, sd[1], alongX ? 0.08 : 0.006, 0.02, alongX ? 0.006 : 0.08, 0x9fe8ff, { glow: true });
    // the pistol, grip toward the chair
    const pg = ax(0.3, 0.3);
    pistol(B, pg[0], T, pg[1], alongX);
    return T;
  }
  function duffelBag(B, x, z, alongX, full) {
    const w = alongX ? 0.9 : 0.4, d = alongX ? 0.4 : 0.9;
    B.box(x, B.fy + 0.19, z, w, 0.38, d, 0x23261f);
    B.box(x, B.fy + 0.385, z, alongX ? 0.8 : 0.04, 0.012, alongX ? 0.04 : 0.8, 0x6a6d68);        // zip
    if (full) for (let i = 0; i < 3; i++)
      B.box(x + (alongX ? -0.2 + i * 0.2 : 0), B.fy + 0.4, z + (alongX ? 0 : -0.2 + i * 0.2), alongX ? 0.156 : 0.066, 0.04, alongX ? 0.066 : 0.156, COL.cash);
  }
  function steelShelf(B, x, z, yaw, stuff) {
    const p = piece(B, x, z, yaw);
    for (let a = -1; a <= 1; a += 2) for (let c = -1; c <= 1; c += 2) p(a * 0.48, 0, c * 0.17, 0.03, 1.8, 0.03, COL.steelD);
    const lv = [0.12, 0.6, 1.08, 1.56];
    for (let i = 0; i < lv.length; i++) p(0, lv[i], 0, 1.0, 0.025, 0.38, COL.steel);
    B.solid(x - 0.5, x + 0.5, z - 0.2, z + 0.2, B.fy, B.fy + 1.8);
    return function (lvl, lat, w, h, d, col, o) { p(lat, lv[lvl] + 0.025, 0, w, h, d, col, o); };
  }
  // A TIPPED TABLE: the top stands on edge toward the door; legs point away.
  function tippedTable(B, c) {
    const up = B.fy;
    if (c.longX) {
      const zt = c.z - c.lz * 0.36;
      B.box(c.x, up + 0.375, zt, 1.4, 0.75, 0.04, 0x6b513a, { solid: true });
      for (let a = -1; a <= 1; a += 2) for (let v = 0; v < 2; v++)
        B.box(c.x + a * 0.62, up + 0.06 + v * 0.63, zt + c.lz * 0.37, 0.04, 0.04, 0.7, 0x3a2c20);
    } else {
      const xt = c.x - c.lx * 0.36;
      B.box(xt, up + 0.375, c.z, 0.04, 0.75, 1.4, 0x6b513a, { solid: true });
      for (let a = -1; a <= 1; a += 2) for (let v = 0; v < 2; v++)
        B.box(xt + c.lx * 0.37, up + 0.06 + v * 0.63, c.z + a * 0.62, 0.7, 0.04, 0.04, 0x3a2c20);
    }
  }
  function mattress(B, s, i) {
    const len = 1.9, wid = 0.9;
    const ax = s.hdx !== 0;                               // long axis x
    const w = ax ? len : wid, d = ax ? wid : len;
    const col = [0xd9d4c4, 0xc8c2b0, 0xb9b3a0][i % 3];
    B.box(s.x, B.fy + 0.1, s.z, w, 0.2, d, col);
    B.box(s.x + (ax ? s.hdx * 0.3 : 0), B.fy + 0.205, s.z + (ax ? 0 : s.hdz * 0.3), ax ? 0.9 : wid - 0.02, 0.012, ax ? wid - 0.02 : 0.9, SHEETS[i % SHEETS.length]);
    // pillow at the wall end
    B.box(s.x + s.hdx * (len / 2 - 0.2), B.fy + 0.25, s.z + s.hdz * (len / 2 - 0.2), ax ? 0.3 : 0.55, 0.1, ax ? 0.55 : 0.3, 0xe6e2d8);
    // a balled-up blanket at the foot
    B.box(s.x - s.hdx * 0.55, B.fy + 0.27, s.z - s.hdz * 0.55, ax ? 0.5 : 0.6, 0.14, ax ? 0.6 : 0.5, SHEETS[(i + 2) % SHEETS.length]);
    return { top: B.fy + 0.2 };
  }
  function clothesRail(B, s, h) {
    const len = 1.5, p = piece(B, s.x, s.z, Math.atan2(s.fx, s.fz));
    for (let a = -1; a <= 1; a += 2) { p(a * len / 2, 0, 0, 0.03, 1.6, 0.03, COL.steelD); p(a * len / 2, 0, 0, 0.05, 0.03, 0.45, COL.steelD); }
    p(0, 1.58, 0, len, 0.025, 0.025, COL.steel);
    const cols = [0x2b2d33, 0x6d2c2c, 0x2f4a6d, 0xc9c4b8, 0x3d5a3a, 0x8a6d3b, 0x1c1c1c];
    for (let i = 0; i < 7; i++) {
      const hl = 0.55 + h(i, 1) * 0.35;
      p(-len / 2 + 0.15 + i * 0.2, 1.55 - hl, 0, 0.04, hl, 0.42, cols[(i + Math.floor(h(i, 2) * 7)) % cols.length]);
    }
    for (let i = 0; i < 3; i++) p(-0.4 + i * 0.35, 0, 0.1, 0.12, 0.1, 0.28, i === 1 ? 0xe8e8e8 : 0x222222);   // sneakers
  }
  function floorSafe(B, x, z, yaw) {
    const p = piece(B, x, z, yaw);
    p(0, 0, 0, 0.62, 0.72, 0.58, 0x2e3236);
    p(0, 0.05, 0.295, 0.54, 0.62, 0.02, 0x3a3f44);
    p(0.08, 0.42, 0.31, 0.1, 0.1, 0.02, 0xb8b8b0);             // dial
    p(-0.12, 0.33, 0.31, 0.03, 0.14, 0.03, 0xb8b8b0);           // handle
    B.solid(x - 0.31, x + 0.31, z - 0.31, z + 0.31, B.fy, B.fy + 0.72);
  }
  function gunRack(B, x, z, yaw) {
    const p = piece(B, x, z, yaw);
    p(0, 0, -0.12, 1.4, 1.5, 0.04, 0x5a4030);                   // back board on the wall
    p(0, 0, 0.02, 1.4, 0.12, 0.3, 0x4a3426);                    // butt rest
    p(0, 1.2, -0.02, 1.4, 0.06, 0.16, 0x4a3426);                // barrel rail
    for (let i = 0; i < 4; i++) {
      const lat = -0.5 + i * 0.33;
      p(lat, 0.12, 0.02, 0.05, 0.28, 0.12, 0x3a2a1c);            // stock
      p(lat, 0.4, 0.0, 0.045, 0.28, 0.07, COL.black);            // receiver
      p(lat, 0.68, -0.02, 0.025, 0.62, 0.025, 0x2a2b2e);         // barrel
    }
    B.solid(x - (Math.abs(Math.sin(yaw)) > 0.5 ? 0.18 : 0.7), x + (Math.abs(Math.sin(yaw)) > 0.5 ? 0.18 : 0.7),
            z - (Math.abs(Math.sin(yaw)) > 0.5 ? 0.7 : 0.18), z + (Math.abs(Math.sin(yaw)) > 0.5 ? 0.7 : 0.18), B.fy, B.fy + 1.5);
  }

  // ---- walls & windows ------------------------------------------------------
  // a finish skin over the four facade faces, cut round windows and the street
  // door (a skin over a pane is a painting of a wall where a window was)
  function skinWalls(B, mat, tint, withDoor) {
    const b = B.b, wt = wtOf(b), hw = b.w / 2 - wt, hd = b.d / 2 - wt, d = doorOf(b);
    const wins = B.windows();
    const walls = [
      { axis: "x", at: -hd, side: 1, lo: -hw, hi: hw }, { axis: "x", at: hd, side: -1, lo: -hw, hi: hw },
      { axis: "z", at: -hw, side: 1, lo: -hd, hi: hd }, { axis: "z", at: hw, side: -1, lo: -hd, hi: hd },
    ];
    const top = B.ceil, bot = B.fy;
    for (let wi = 0; wi < walls.length; wi++) {
      const W = walls[wi], ops = [];
      for (let i = 0; i < wins.length; i++) {
        const w = wins[i];
        if (w.axis !== W.axis || w.side !== -W.side) continue;
        const c = W.axis === "x" ? w.x : w.z;
        ops.push({ a0: c - w.hw - 0.02, a1: c + w.hw + 0.02, v0: Math.max(bot, w.y - w.hh - 0.02), v1: Math.min(top, w.y + w.hh + 0.02) });
      }
      if (withDoor) {
        const on = W.axis === "x" ? Math.abs(d.nz - W.side) < 0.01 : Math.abs(d.nx - W.side) < 0.01;
        if (on) { const c = W.axis === "x" ? d.x : d.z; ops.push({ a0: c - DOORW / 2 - 0.08, a1: c + DOORW / 2 + 0.08, v0: bot, v1: Math.min(top, B.y0 + 2.6) }); }
      }
      ops.sort(function (p, q) { return p.a0 - q.a0; });
      const face = W.axis === "x" ? (W.side > 0 ? 16 : 32) : (W.side > 0 ? 1 : 2);
      const off = W.at + W.side * 0.012;
      const put = function (a, c, ya, yb) {
        if (c - a < 0.02 || yb - ya < 0.02) return;
        if (W.axis === "x") B.box((a + c) / 2, (ya + yb) / 2, off, c - a, yb - ya, 0.01, tint, { mat: mat, faces: face });
        else B.box(off, (ya + yb) / 2, (a + c) / 2, 0.01, yb - ya, c - a, tint, { mat: mat, faces: face });
      };
      let cur = W.lo;
      for (let i = 0; i < ops.length; i++) {
        const o = ops[i];
        const a0 = Math.max(cur, o.a0), a1 = Math.min(W.hi, o.a1);
        put(cur, a0, bot, top);
        if (a1 > a0) { put(a0, a1, bot, o.v0); put(a0, a1, o.v1, top); }
        cur = Math.max(cur, a1);
      }
      put(cur, W.hi, bot, top);
      // a dark scuffed skirting so the skin meets the floor
      if (W.axis === "x") B.box(0, bot + 0.05, W.at + W.side * 0.02, W.hi - W.lo, 0.1, 0.02, 0x3a3632, { faces: face });
      else B.box(W.at + W.side * 0.02, bot + 0.05, 0, 0.02, 0.1, W.hi - W.lo, 0x3a3632, { faces: face });
    }
  }
  // what covers each pane on the inside: fn(w, i) -> "curtain"|"board"|"foil"|"fan"|null
  function dressWindows(B, pick) {
    const b = B.b, wt = wtOf(b);
    const wins = B.windows();
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      if (w.y < B.fy + 0.3 || w.y > B.ceil) continue;
      const kind = pick(w, i);
      if (!kind) continue;
      const alongX = w.axis === "x";
      const face = alongX ? w.side * (b.d / 2 - wt) : w.side * (b.w / 2 - wt);
      const c = alongX ? w.x : w.z;
      const at = function (off) { return face - w.side * off; };
      const bx = function (along, y, off, len, h, th, col, o) {
        if (alongX) B.box(along, y, at(off), len, h, th, col, o);
        else B.box(at(off), y, along, th, h, len, col, o);
      };
      const W2 = w.hw * 2, H2 = w.hh * 2;
      if (kind === "curtain") {
        const ytop = Math.min(B.ceil - 0.05, w.y + w.hh + 0.14), ybot = w.y - w.hh - 0.12;
        bx(c, ytop + 0.015, 0.06, W2 + 0.34, 0.02, 0.02, 0x3a3a3a);                  // rod
        const col = SHEETS[Math.floor(B.h(c, w.y, 0xa1 + i) * SHEETS.length) % SHEETS.length];
        const pulled = B.h(c, w.y, 0xa2 + i) < 0.4;
        const len = pulled ? (W2 + 0.24) * 0.55 : W2 + 0.24;
        const cc = pulled ? c - (W2 + 0.24) / 2 + len / 2 : c;
        bx(cc, (ytop + ybot) / 2, 0.08, len, ytop - ybot, 0.02, col);
      } else if (kind === "board") {
        bx(c, w.y, 0.03, W2 + 0.12, H2 + 0.12, 0.025, COL.ply);
        bx(c, w.y + w.hh * 0.5, 0.055, W2 + 0.2, 0.09, 0.03, 0x8e7048);
        bx(c, w.y - w.hh * 0.5, 0.055, W2 + 0.2, 0.09, 0.03, 0x8e7048);
      } else if (kind === "foil") {
        bx(c, w.y, 0.02, W2 + 0.06, H2 + 0.06, 0.006, 0xc9ced2);
        bx(c, w.y + w.hh + 0.02, 0.024, W2 + 0.1, 0.04, 0.006, 0xb49a62);            // tape
      } else if (kind === "fan") {
        const fb = w.y - w.hh, fs = Math.min(0.55, W2, H2);
        bx(c, fb + fs / 2, 0.09, fs, fs, 0.16, 0xd6d6d0);
        bx(c, fb + fs / 2, 0.175, fs - 0.06, fs - 0.06, 0.01, 0x262626);
        const rest = H2 - fs;
        if (rest > 0.05) bx(c, fb + fs + rest / 2, 0.03, W2 + 0.1, rest + 0.05, 0.025, COL.ply);
      }
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
    // slab: stained concrete, darker in the count room
    B.plane(C.X0, C.Z0, C.X1, C.Z1, fy, "concrete", 0xa39b90);
    skinWalls(B, "brick", 0xb8aaa0, true);
    dressWindows(B, function (w) {
      const wz = w.axis === "x" ? w.side * (B.b.d / 2) : w.z;
      const inBand = cs > 0 ? wz >= g.zp - 0.05 : wz <= g.zp + 0.05;
      return inBand ? "board" : "curtain";
    });
    // THE PARTITION: solid, plaster over studs, one doorway at the far end
    if (g.wall) {
      for (let i = 0; i < g.segs.length; i++) {
        const s = g.segs[i];
        const gaps = (g.gx > s[0] + 0.5 && g.gx < s[1] - 0.5) ? [{ c: g.gx, w: g.gapW, h: 2.05 }] : [];
        B.wall("x", g.zp, s[0], s[1], { gaps: gaps, mat: "plaster", tint: 0xb3ab9c, casing: 0x6b5a48, skirt: 0x3a3632 });
      }
    }
    // ---- COUNT ROOM
    const alongX = true;
    countTable(B, g.table.x, g.table.z, alongX, !looted, h, cs);
    foldChair(B, g.chair.x, g.chair.z, g.chair.face, true);
    if (!looted && !ours) B.loot(g.table.x, g.table.z, "countroom", { lot: lot });
    if (g.duffel) duffelBag(B, g.duffel.x, g.duffel.z, true, !looted);
    if (g.shelf) {
      const put = steelShelf(B, g.shelf.x, g.shelf.z, cs > 0 ? PI : 0);
      put(1, -0.2, 0.35, 0.15, 0.25, 0x5a6a5a);                  // the lockbox
      put(1, 0.25, 0.3, 0.12, 0.2, 0x2a2a2a);                    // a vacuum sealer
      put(2, -0.25, 0.36, 0.2, 0.28, 0xb9a57a);                  // a box of bands
      put(2, 0.2, 0.18, 0.12, 0.3, 0x3a3a3a);                    // a shoebox of receipts
      put(0, 0.0, 0.7, 0.3, 0.3, 0x8a6a45);                      // a banker's box on the bottom
      put(3, 0.0, 0.3, 0.3, 0.3, 0xd8d8d8);                      // a roll of plastic
    }
    // bare bulb over the table, the light confined to the room it lights
    B.light(g.table.x, g.table.z, { kind: "bulb", r: 3.6, i: 0.95, color: 0xffdca0, rect: g.wall ? g.band : null });
    // ---- LOUNGE
    if (g.sofa) {
      const s = g.sofa, t = g.tv;
      const mx = (s.x + t.x) / 2, mz = (s.z + t.z) / 2;
      const ax = Math.abs(t.x - s.x) > Math.abs(t.z - s.z);     // sofa-to-TV runs along x
      // the rug, and a stain on it
      B.box(mx, fy + 0.006, mz, ax ? 2.3 : 2.0, 0.012, ax ? 2.0 : 2.3, 0x6b4a3a);
      B.box(mx + 0.3, fy + 0.0125, mz - 0.2, 0.45, 0.002, 0.35, 0x4a3226);
      B.furn("sofa", s.x, s.z, s.yaw, { len: s.len, tone: 0x5b4d3e });
      tvOnCrate(B, t.x, t.z, t.yaw, h(1, 1) < 0.7);
      // the "coffee table": two milk crates and a board
      const cx = s.x + (t.x - s.x) * 0.42, cz = s.z + (t.z - s.z) * 0.42;
      const px = ax ? 0 : 0.35, pz = ax ? 0.35 : 0;
      milkCrate(B, cx - px, fy, cz - pz, 0x2c4a8a);
      milkCrate(B, cx + px, fy, cz + pz, 0x8a2c2c);
      const bt = fy + 0.33;
      B.box(cx, bt + 0.01, cz, ax ? 0.45 : 1.05, 0.02, ax ? 1.05 : 0.45, 0x8e7048);
      const T = bt + 0.02;
      pizzaBox(B, cx - px * 0.8, T, cz - pz * 0.8, 2);
      ashtray(B, cx + px * 0.5, T, cz + pz * 0.5);
      for (let i = 0; i < 4; i++) can(B, cx + px * (0.2 + i * 0.12) - pz * 0.12, T, cz + pz * (0.2 + i * 0.12) - px * 0.12, CAN[i % CAN.length], false, false);
      // cans on the floor round the sofa, some kicked over
      for (let i = 0; i < 7; i++) {
        const ox = (h(i, 3) - 0.5) * 2.2, oz = (h(i, 4) - 0.5) * 2.2;
        const x = mx + ox, z = mz + oz;
        if (Math.abs(x - cx) < 0.6 && Math.abs(z - cz) < 0.6) continue;
        if (!B.clear(x, z, 0.1)) continue;
        can(B, x, fy, z, CAN[i % CAN.length], h(i, 5) < 0.6, h(i, 6) < 0.5);
      }
      B.light(mx, mz, { kind: "bulb", r: 4.6, i: 0.55, color: 0xffe0b0, rect: g.wall ? g.lounge : null });
    }
    // the lookout by the door
    if (g.lookout) {
      foldChair(B, g.lookout.x, g.lookout.z, g.lookout.face, true);
      if (g.lookout.crate) {
        const c = g.lookout.crate, T = milkCrate(B, c.x, fy, c.z, 0x2d6b3a);
        B.box(c.x, T + 0.005, c.z, 0.36, 0.01, 0.36, 0x7a6048);
        ashtray(B, c.x - 0.06, T + 0.01, c.z - 0.06);
        can(B, c.x + 0.09, T + 0.01, c.z + 0.08, CAN[Math.floor(h(9, 9) * CAN.length) % CAN.length], false, false);
        B.box(c.x + 0.06, T + 0.02, c.z - 0.1, 0.07, 0.01, 0.14, 0x111111);   // a phone
      }
      const d = C.door;
      B.light(d.x + d.nx * 2.2, d.z + d.nz * 2.2, { kind: "bulb", r: 4.2, i: 0.5, color: 0xffe6c0, rect: g.wall ? g.lounge : null });
    }
    // cover
    if (g.cover) tippedTable(B, g.cover);
    for (let i = 0; i < g.crates.length; i++) {
      const c = g.crates[i], ax = Math.abs(c.x1 - c.x0) >= Math.abs(c.z1 - c.z0);
      const t1 = crateBox(B, c.x, fy, c.z, ax ? 0.8 : 0.6, 0.6, ax ? 0.6 : 0.8, COL.crate, { solid: true });
      if (h(i, 11) < 0.7) crateBox(B, c.x + (h(i, 12) - 0.5) * 0.12, t1, c.z + (h(i, 13) - 0.5) * 0.08, ax ? 0.6 : 0.46, 0.45, ax ? 0.46 : 0.6, COL.crate, { solid: true });
    }
    // pizza boxes and a trash bag by the partition
    const tz = g.zp - cs * 0.3;
    const tx = clamp(g.gx + (g.side > 0 ? -1.2 : 1.2), C.X0 + 0.4, C.X1 - 0.4);
    if (B.clear(tx, tz, 0.2)) { B.box(tx, fy + 0.28, tz, 0.55, 0.56, 0.5, 0x1b1c1e); pizzaBox(B, tx + (g.side > 0 ? -0.55 : 0.55), fy, tz, 3); }
  }

  function drawKitchen(B, k) {
    const C = k.C, fy = B.fy, t = k.table;
    const h = function (a, c) { return B.h(a, c, 0xc1); };
    B.plane(C.X0, C.Z0, C.X1, C.Z1, fy, "concrete", 0x9a958c);
    skinWalls(B, "plaster", 0xa8a08e, false);
    const foil = h(2, 2) < 0.5;
    let fanDone = false;
    dressWindows(B, function () { if (!fanDone) { fanDone = true; return "fan"; } return foil ? "foil" : "board"; });
    // PLASTIC SHEETING hung off the ceiling along the two long walls
    const alongX = (C.X1 - C.X0) >= (C.Z1 - C.Z0);
    const sh = B.ceil - fy - 0.02;
    if (alongX) {
      B.box((C.X0 + C.X1) / 2, fy + sh / 2, C.Z0 + 0.1, C.X1 - C.X0 - 0.1, sh, 0.006, COL.sheet, { glass: true });
      B.box((C.X0 + C.X1) / 2, fy + sh / 2, C.Z1 - 0.1, C.X1 - C.X0 - 0.1, sh, 0.006, COL.sheet, { glass: true });
    } else {
      B.box(C.X0 + 0.1, fy + sh / 2, (C.Z0 + C.Z1) / 2, 0.006, sh, C.Z1 - C.Z0 - 0.1, COL.sheet, { glass: true });
      B.box(C.X1 - 0.1, fy + sh / 2, (C.Z0 + C.Z1) / 2, 0.006, sh, C.Z1 - C.Z0 - 0.1, COL.sheet, { glass: true });
    }
    // a tarp under the cook table
    B.box(t.x, fy + 0.003, t.z, t.alongX ? 3.2 : 1.9, 0.006, t.alongX ? 1.9 : 3.2, COL.tarp);
    // THE STEEL TABLE (top 0.9)
    const lx = t.alongX ? t.L : t.W, lz = t.alongX ? t.W : t.L;
    B.box(t.x, fy + 0.885, t.z, lx, 0.03, lz, COL.steel);
    B.box(t.x, fy + 0.2, t.z, lx - 0.1, 0.02, lz - 0.1, COL.steelD);              // under-shelf
    for (let a = -1; a <= 1; a += 2) for (let c = -1; c <= 1; c += 2)
      B.box(t.x + a * (lx / 2 - 0.04), fy + 0.435, t.z + c * (lz / 2 - 0.04), 0.035, 0.87, 0.035, COL.steelD);
    B.solid(t.x - lx / 2, t.x + lx / 2, t.z - lz / 2, t.z + lz / 2, fy, fy + 0.9);
    const T = fy + 0.9;
    const at = function (a, c) { return t.alongX ? [t.x + a, t.z + c] : [t.x + c, t.z + a]; };
    // two hotplates with pots, glowing coils
    for (let i = 0; i < 2; i++) {
      const p = at(-0.8 + i * 0.6, 0.05);
      B.box(p[0], T + 0.03, p[1], 0.32, 0.06, 0.32, 0x2a2b2d);
      B.box(p[0], T + 0.062, p[1], 0.2, 0.004, 0.2, 0xff5a2a, { glow: true });
      B.box(p[0], T + 0.16, p[1], 0.26, 0.2, 0.26, i ? 0x9aa0a4 : 0x7f8589);
    }
    // glassware: flasks, a beaker rack, jugs
    for (let i = 0; i < 5; i++) {
      const p = at(0.1 + i * 0.16, -0.18 + (i & 1) * 0.1);
      const fh = 0.14 + h(i, 1) * 0.1;
      B.box(p[0], T + fh / 2, p[1], 0.09, fh, 0.09, COL.glass, { glass: true });
      B.box(p[0], T + fh + 0.03, p[1], 0.03, 0.06, 0.03, COL.glass, { glass: true });
    }
    for (let i = 0; i < 3; i++) {
      const p = at(0.4 + i * 0.22, 0.22);
      B.box(p[0], T + 0.15, p[1], 0.16, 0.3, 0.12, i === 1 ? 0x3d6fa8 : COL.jug);
      B.box(p[0], T + 0.32, p[1], 0.05, 0.04, 0.05, 0xd0452f);
    }
    // the gas bottle at the end, a hose up to the table
    B.box(k.tank.x, fy + 0.5, k.tank.z, 0.3, 1.0, 0.3, 0xd8d8d0);
    B.box(k.tank.x, fy + 1.05, k.tank.z, 0.1, 0.1, 0.1, 0x9a8a3a);
    B.solid(k.tank.x - 0.15, k.tank.x + 0.15, k.tank.z - 0.15, k.tank.z + 0.15, fy, fy + 1.0);
    // buckets on the floor under the table
    for (let i = 0; i < 2; i++) { const p = at(-0.6 + i * 0.9, 0); B.box(p[0], fy + 0.2, p[1], 0.3, 0.4, 0.3, i ? 0xe0e0da : 0x2f6fbf); }
    // the work lamp on a stand, beside the cook
    const lp = at(-t.L / 2 - 0.05, -0.75);
    B.box(lp[0], fy + 0.02, lp[1], 0.4, 0.04, 0.4, COL.black);
    B.box(lp[0], fy + 0.8, lp[1], 0.03, 1.6, 0.03, 0xd8b43a);
    B.box(lp[0], fy + 1.66, lp[1], 0.24, 0.18, 0.18, 0xd8b43a);
    B.box(lp[0], fy + 1.58, lp[1], 0.2, 0.01, 0.14, 0xfff4e0, { glow: true });
    B.lamp(t.x, fy + 1.6, t.z, { color: 0xfff4e0, r: 3.4, i: 0.6 });
    // the bagging table + product; the lab loot
    if (k.bags) {
      const g = k.bags, ax = g.alongX;
      const T2 = foldTable(B, g.x, g.z, ax, 1.5, 0.7, 0xcfc8b6);
      for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) {
        const a = -0.5 + i * 0.2, c = -0.12 + j * 0.2;
        B.box(g.x + (ax ? a : c), T2 + 0.02, g.z + (ax ? c : a), ax ? 0.12 : 0.17, 0.04, ax ? 0.17 : 0.12, 0xf2f2ee);
      }
      B.box(g.x + (ax ? 0.55 : 0), T2 + 0.015, g.z + (ax ? 0 : 0.55), 0.18, 0.03, 0.18, 0xb9bec2);   // scale
      B.box(g.x + (ax ? 0.55 : -0.2), T2 + 0.06, g.z + (ax ? -0.2 : 0.55), 0.12, 0.12, 0.08, 0x3a3a3a); // box of baggies
      B.loot(g.x, g.z, "lab", { lot: B.lot || null });
    }
    // respirators on a hook on the wall
    const wallHook = alongX ? { x: t.x + 1.6, z: C.Z0 + 0.12 } : { x: C.X0 + 0.12, z: t.z + 1.6 };
    if (B.clear(wallHook.x, wallHook.z + (alongX ? 0.3 : 0), 0.05)) {
      const ax = alongX;
      B.box(wallHook.x, fy + 1.62, wallHook.z, ax ? 0.8 : 0.03, 0.04, ax ? 0.03 : 0.8, 0x4a3a2a);
      for (let i = 0; i < 3; i++) {
        const a = -0.25 + i * 0.25;
        const x = wallHook.x + (ax ? a : 0.07), z = wallHook.z + (ax ? 0.07 : a);
        B.box(x, fy + 1.5, z, ax ? 0.14 : 0.1, 0.12, ax ? 0.1 : 0.14, 0x3a3d40);
        B.box(x + (ax ? -0.06 : 0.04), fy + 1.45, z + (ax ? 0.04 : -0.06), 0.06, 0.06, 0.06, 0xc86f8a);
        B.box(x + (ax ? 0.06 : 0.04), fy + 1.45, z + (ax ? 0.04 : 0.06), 0.06, 0.06, 0.06, 0xc86f8a);
      }
    }
    B.light(t.x, t.z, { kind: "bulb", r: 4.2, i: 0.5, color: 0xfff0d0 });
    if (k.bags) B.light(k.bags.x, k.bags.z, { kind: "bulb", r: 3.2, i: 0.45, color: 0xffe8c0 });
  }

  function drawCrash(B, c) {
    const C = c.C, fy = B.fy;
    const h = function (a, q) { return B.h(a, q, 0xd1); };
    B.plane(C.X0, C.Z0, C.X1, C.Z1, fy, "wood", 0x9a8a78);
    skinWalls(B, "plaster", 0xb2a893, false);
    dressWindows(B, function () { return "curtain"; });
    for (let i = 0; i < c.mats.length; i++) {
      const m = c.mats[i];
      mattress(B, m, i);
      if (i < 2) B.loot(m.x, m.z, "mattress", { lot: B.lot || null });
      // what lives beside a mattress on the floor
      const sx = m.x + (m.hdx ? m.hdx * 0.7 : 0.62), sz = m.z + (m.hdx ? 0.58 : m.hdz * 0.7);
      if (B.clear(sx, sz, 0.05) && h(i, 1) < 0.7) {
        can(B, sx, fy, sz, CAN[i % CAN.length], h(i, 2) < 0.4, true);
        ashtray(B, sx + 0.12, fy, sz + 0.1);
      }
    }
    if (c.foot) {
      const f = c.foot, ax = f.alongX;
      B.box(f.x, fy + 0.2, f.z, ax ? 0.8 : 0.4, 0.4, ax ? 0.4 : 0.8, 0x4d5a3a, { solid: true });
      B.box(f.x, fy + 0.41, f.z, ax ? 0.82 : 0.42, 0.03, ax ? 0.42 : 0.82, 0x3d4a2e);
      B.loot(f.x, f.z, "footlocker", { lot: B.lot || null });
    }
    if (c.rail) clothesRail(B, c.rail, h);
    if (c.tv) tvOnCrate(B, c.tv.x, c.tv.z, Math.atan2(c.tv.fx, c.tv.fz), h(5, 5) < 0.5);
    if (c.guns) {
      const g = c.guns, ax = g.ax;
      const top = crateBox(B, g.x, fy, g.z, ax ? 1.2 : 0.48, 0.44, ax ? 0.48 : 1.2, 0x55603f, { solid: true });
      B.box(g.x + (ax ? 0 : g.fx * 0.05), top + 0.01, g.z + (ax ? g.fz * 0.05 : 0), ax ? 0.5 : 0.1, 0.02, ax ? 0.1 : 0.5, 0xd8d0b0);   // stencil strip
      B.loot(g.x, g.z, "weapons", { lot: B.lot || null });
    }
    // clothes on the floor
    for (let i = 0; i < 5; i++) {
      const x = C.X0 + 0.8 + h(i, 7) * (C.X1 - C.X0 - 1.6), z = C.Z0 + 0.8 + h(i, 8) * (C.Z1 - C.Z0 - 1.6);
      if (!B.clear(x, z, 0.2)) continue;
      B.box(x, fy + 0.02, z, 0.4 + h(i, 9) * 0.2, 0.04, 0.3 + h(i, 10) * 0.2, SHEETS[(i + 3) % SHEETS.length]);
    }
    const cx = (C.X0 + C.X1) / 2, cz = (C.Z0 + C.Z1) / 2;
    B.light(cx - (C.X1 - C.X0) * 0.22, cz, { kind: "bulb", r: 4.6, i: 0.5, color: 0xffe0b0 });
    B.light(cx + (C.X1 - C.X0) * 0.22, cz, { kind: "bulb", r: 4.6, i: 0.42, color: 0xffe0b0 });
  }

  function drawBoss(B, p) {
    const C = p.C, fy = B.fy;
    B.plane(C.X0, C.Z0, C.X1, C.Z1, fy, "wood", 0x8a6e56);
    skinWalls(B, "plaster", 0x8c7f6c, false);
    dressWindows(B, function () { return "curtain"; });
    if (p.desk) {
      const d = p.desk;
      B.box(d.x, fy + 0.006, d.z, 3.2, 0.012, 2.6, 0x5a2e2a);                  // his rug
      B.furn("bossDesk", d.x, d.z, d.yaw, { tone: 0x3a2c22 });
      // on the desk: a stack, a phone, a bottle
      const f = Math.cos(d.yaw);
      cashStack(B, d.x - 0.7, fy + 0.74, d.z + f * 0.05, 0.08, true);
      B.box(d.x - 0.35, fy + 0.745, d.z - f * 0.1, 0.07, 0.01, 0.14, 0x111111);
      B.box(d.x + 1.05, fy + 0.86, d.z + f * 0.2, 0.08, 0.24, 0.08, 0x6b3a1a, { glass: true });
      B.light(d.x, d.z, { kind: "pendant", r: 4.2, i: 0.6, color: 0xffd9a0, drop: 0.6 });
    }
    if (p.safe) {
      floorSafe(B, p.safe.x, p.safe.z, p.safe.yaw);
      B.loot(p.safe.x, p.safe.z, "safe", { lot: B.lot || null, wealth: 1 });
    }
    if (p.sofa) B.furn("sofa", p.sofa.x, p.sofa.z, p.sofa.yaw, { len: 2.0, tone: 0x2b2b30 });
    if (p.rack) gunRack(B, p.rack.x, p.rack.z, p.rack.yaw);
    const cx = (C.X0 + C.X1) / 2, cz = (C.Z0 + C.Z1) / 2;
    B.light(cx, cz + (p.cs > 0 ? -1.5 : 1.5), { kind: "bulb", r: 4.8, i: 0.45, color: 0xffe0b0 });
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
      B.plane(P.g.C.X0, P.g.C.Z0, P.g.C.X1, P.g.C.Z1, B.fy, P.kind === "ground" || P.kind === "kitchen" ? "concrete" : "wood", 0xa39b90);
      B.light((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, { kind: "bulb", r: 5.5, i: 0.6 });
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
      if (!b || b.w == null || b.d == null || b.park) continue;
      const r0 = roomOf(b, 0);
      if (!r0) continue;
      const n = floorsOf(b);
      let g = null;
      try { g = planGround(b, r0); } catch (e) { g = null; }
      if (!g) continue;
      // the gang's stash point moves onto the count table the fit-out stands
      if (b.stash) { b.stash.x = (b.ox || 0) + g.table.x; b.stash.z = (b.oz || 0) + g.table.z; }
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
      const p = CBZ.cityStaffPost({
        venue: "hideouts", id: "hide:" + rec.i + ":" + gid + ":" + J.role,
        x: J.x, z: J.z, face: J.face,
        job: "gang " + J.rank, archetype: "gangster", opts: opts,
        seat: seatArgs ? function () { return seatAt(seatArgs[0], seatArgs[1], seatArgs[2], seatArgs[3], seatArgs[4], seatArgs[5], rec.lot); } : null,
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

    // ---- the house wakes together (2 Hz, only hideouts you are close to)
    HIDE.wacc += dt || 0;
    if (HIDE.wacc >= 0.5) {
      HIDE.wacc = 0;
      for (let i = 0; i < HIDE.list.length; i++) {
        const rec = HIDE.list[i], lot = rec.lot;
        const dx = lot.cx - px, dz = lot.cz - pz, d2 = dx * dx + dz * dz;
        const st = lot.building && lot.building.stash;
        if (d2 > 60 * 60) { if (st) rec.looted = !!st.looted; if (rec.awake) { rec.awake = false; rec.threat = null; } continue; }
        const bodies = bodiesOf(rec);
        let trig = null;
        if (st && st.looted && !rec.looted) {
          rec.looted = true;
          // the stacks leave the table the moment the count is gone
          if (CBZ.fitoutRebuild) CBZ.fitoutRebuild(lot.building, 0);
          if (d2 < 30 * 30) trig = threat0;
        } else if (st && !st.looted) rec.looted = false;
        for (let j = 0; j < bodies.length && !trig; j++) {
          const p = bodies[j];
          if (p.rage || p.state === "fight" || (p.alarmed > 0 && p.mem)) trig = p.rage || p.mem || threat0;
        }
        if (!trig) continue;
        rec.awake = true; rec.threat = trig;
        for (let j = 0; j < bodies.length; j++) {
          const p = bodies[j];
          if (p.rage && p.state === "fight") continue;
          wake(p, trig);
        }
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
