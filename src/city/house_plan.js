/* ============================================================
   city/house_plan.js — A HOUSE IS A FLOOR PLAN (CBZ.cityHouse).

   OWNER: "first making all assets look great, and you can reuse great ones
   from Natural Disaster, like great stop signs and roads and fences and
   houses."

   A Gang City house was an apartment block's storey behind a house's front
   door: one hallway with five bedsit doors off it (interior_programs.js's
   `residential` program, which is right for a tenement and wrong for a
   home). This file is what a house is inside:

     ONE STOREY, a house's size   a centre hall from the front door; the
        living room through a wide cased opening on one side, the kitchen
        (a fitted run on the hall wall, a table by the window) on the other;
        a cross passage; behind it a bedroom either side of the bathroom,
        each with a closet nook.
     ONE STOREY, a cottage's size one room for living and cooking, a bedroom
        behind it and its own bathroom off the bedroom.
     TWO STOREYS OR MORE   the same plan on every floor (the walls stack),
        with a straight stair in the hall facing the front door: living,
        kitchen, a dining room, a study and a cloakroom downstairs; the
        bedrooms and the bathroom upstairs off a gallery round the stairwell.

   It is sized to the shell it is given and it reads the shell's own windows
   (b.openings): no partition ends in the middle of a window.

   TWO PASSES, ONE PLAN (the split city/fitout.js is built on):
     furnish(b, lot)   EAGER, with the shell: the partitions (solid, merged
        into the building's own batch like any wall), a real door in every
        doorway (interior_programs.js's free door: the one panelled leaf
        every hinged door in the city wears; it opens when you walk into it
        or press E), the stair (systems/stairs.js flights, the slab opened
        over it, the treads) and its guards. Then every floor is declared to
        the fit-out as "house".
     the "house" fit-out (city/fitout_house.js)   LAZY, only while you are at
        the house: floors, ceilings, paint, the kitchen, the bathroom, every
        room's furniture, the stair's joinery, lights, curtains.

   WHO LIVES HERE. wealth(lot) is the neighbourhood's own number (the
   district's `wealth` in config.js CITY.districts, a town's by its district
   and what it rents for), and tier() is poor / mid / rich: the fit-out
   furnishes by it and city/house_yard.js fences and plants by it.

   THE OWNED HOME'S FIXTURES (city/realestate.js) ask spot(lot, what) for
   their places: the safe in the bedroom closet (a study in a two-storey
   house), the gun rack on a wall kept clear for it, the wardrobe in the main
   bedroom. A flat in a tower has no plan: aptSpots() finds clear wall on the
   flat's own floor, by its bed.

   Pure geometry and position hashes: no rng draw anywhere.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const PW = 0.14;                 // partition thickness
  const DOOR_W = 0.86, BATH_W = 0.78, OPEN_W = 1.5, KIT_W = 0.95, DOOR_H = 2.08;
  const LANE_W = 0.95;             // the stair's clear width
  const WALLC = 0xe9e4da;          // a partition before the fit-out paints it
  const LEAFC = 0xf1eee7;          // a painted room door

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function h01(x, z, s) {
    if (CBZ.hash01) return CBZ.hash01(x, z, s);
    const v = Math.sin(x * 12.9898 + z * 78.233 + s * 0.123) * 43758.5453;
    return v - Math.floor(v);
  }

  /* ---- WHO LIVES HERE ------------------------------------------------------
     0..1. The main grid's lots take their district's `wealth`; a town is one
     neighbourhood, at the level of the land it stands on (its district key),
     nudged by what its homes rent for. A lot or a home may state its own. */
  const DISTRICT_WEALTH = { snow: 0.74, goldspire: 0.86, capeharbor: 0.5, neonreef: 0.4, farmland: 0.36,
    forest: 0.44, foundry: 0.24, desert: 0.26, island: 0.8 };
  function wealthOf(lot, b) {
    b = b || (lot && lot.building) || {};
    const home = b.home || (lot && lot.building && lot.building.home) || null;
    if (lot && lot.wealth != null) return clamp(+lot.wealth, 0, 1);
    if (home && home.wealth != null) return clamp(+home.wealth, 0, 1);
    const x = lot ? lot.cx : (b.ox || 0), z = lot ? lot.cz : (b.oz || 0);
    let w = 0.5;
    if (lot && lot.town) {
      const dk = String(lot.district || "");
      if (DISTRICT_WEALTH[dk] != null) w = DISTRICT_WEALTH[dk];
      else { let hs = 0; const nm = String(lot.town); for (let i = 0; i < nm.length; i++) hs = (hs * 31 + nm.charCodeAt(i)) >>> 0; w = 0.22 + 0.56 * ((hs % 997) / 996); }
      if (home && home.rent > 0) w += clamp((home.rent - 85) / 220, -0.12, 0.12);
    } else {
      const A = CBZ.city && CBZ.city.arena;
      let d = null;
      try { d = A && A.districtAt ? A.districtAt(x, z) : null; } catch (e) { d = null; }
      if (d && d.wealth != null) w = +d.wealth;
    }
    w += (h01(x, z, 0x51a) - 0.5) * 0.08;
    return clamp(w, 0.02, 0.98);
  }
  function tierOf(w) { return w < 0.36 ? "poor" : (w < 0.64 ? "mid" : "rich"); }
  /* THE GRAMMAR A HOUSE WEARS (city/facades/, the ones the Natural Disaster
     island's houses wear): by who lives there. A neighbourhood is one or two
     of its kind's grammars (its own pick, with a minority of a second), so a
     street reads as one street. null = the facade kit's own choice. */
  const STYLES = {
    poor: ["ranch", "adobe", "brickhouse", "machiya"],
    mid: ["queenanne", "ranch", "brickhouse", "desertmod", "machiya"],
    rich: ["manor", "greekrev", "romanvilla", "techhouse", "queenanne"],
  };
  // a town on its own land builds what that land builds (its district key)
  const DISTRICT_STYLES = { desert: ["adobe", "ranch", "desertmod"], snow: ["manor", "queenanne", "greekrev"], capeharbor: ["queenanne", "brickhouse", "ranch"],
    goldspire: ["techhouse", "greekrev", "romanvilla"], neonreef: ["desertmod", "ranch", "adobe"], foundry: ["brickhouse", "ranch"], farmland: ["ranch", "queenanne"], forest: ["manor", "ranch"],
    // the nations build their own way (city/countries.js): Kesh's capital in
    // mud brick and flat-roofed render, Mbeya's in bungalows and mud brick
    // (both were Greek Revival porticoes and Queen Anne turrets by wealth)
    keshtown: ["adobe", "desertmod"], mbeyacity: ["ranch", "adobe"] };
  function styleFor(lot, storeys, wealth) {
    if (!CBZ.facadeDef) return null;
    const st = Math.max(1, storeys | 0);
    const land = lot && lot.town && DISTRICT_STYLES[String(lot.district || "")];
    const list = (land || STYLES[tierOf(wealth)]).filter(function (id) {
      const d = CBZ.facadeDef(id);
      return !!d && st >= (d.minStoreys || 0) && st <= (d.maxStoreys || 99);
    });
    if (!list.length) return null;
    let key = "";
    if (lot && lot.town) key = String(lot.town);
    else {
      const A = CBZ.city && CBZ.city.arena;
      let d = null;
      try { d = A && A.districtAt && lot ? A.districtAt(lot.cx, lot.cz) : null; } catch (e) { d = null; }
      key = d && d.name ? String(d.name) : "";
    }
    let hs = 7; for (let i = 0; i < key.length; i++) hs = (hs * 31 + key.charCodeAt(i)) >>> 0;
    const a = hs % list.length;
    const second = lot && h01(lot.cx, lot.cz, 0x58c) < 0.26;
    return list[(a + (second ? 1 + ((hs >>> 5) % Math.max(1, list.length - 1)) : 0)) % list.length];
  }

  /* ---- THE FRAME ------------------------------------------------------------
     (d, t): d metres in from the room face of the door wall, t metres along
     that wall from the door's centre, toward building-local +x (a door on a
     z face) or +z (a door on an x face). The same frame city/fitout_plans.js
     draws a flat in, so its kitchen and bathroom parts drop straight in. */
  // (U: a flat on a storey of flats, interior_programs.js's unit record: its
  // own rect, and its front door on the corridor in place of the street door)
  function frameOf(b, U) {
    const wt = b.wt != null ? b.wt : 0.4;
    const ld = U ? { x: U.door.x, z: U.door.z, nx: U.inX, nz: U.inZ } : (b.localDoor || { x: 0, z: -b.d / 2, nx: 0, nz: 1 });
    const nx = Math.round(ld.nx), nz = Math.round(ld.nz);
    const alongX = Math.abs(nz) > 0.5;
    const ix0 = U ? U.x0 : -b.w / 2 + wt, ix1 = U ? U.x1 : b.w / 2 - wt, iz0 = U ? U.z0 : -b.d / 2 + wt, iz1 = U ? U.z1 : b.d / 2 - wt;
    const dx = U ? ld.x : ld.x + nx * wt, dz = U ? ld.z : ld.z + nz * wt;
    const F = { nx: nx, nz: nz, alongX: alongX, dx: dx, dz: dz, wt: wt,
      D: alongX ? iz1 - iz0 : ix1 - ix0,
      tLo: alongX ? ix0 - dx : iz0 - dz, tHi: alongX ? ix1 - dx : iz1 - dz,
      ix0: ix0, ix1: ix1, iz0: iz0, iz1: iz1 };
    F.W = F.tHi - F.tLo;
    F.P = function (d, t) { return { x: dx + nx * d + (alongX ? t : 0), z: dz + nz * d + (alongX ? 0 : t) }; };
    F.R = function (d0, d1, t0, t1) {
      const a = F.P(d0, t0), c = F.P(d1, t1);
      return { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) };
    };
    // the yaw (forward = sin, cos) of a direction given in the frame
    F.yaw = function (dd, dt) { return Math.atan2(nx * dd + (alongX ? dt : 0), nz * dd + (alongX ? 0 : dt)); };
    F.dOf = function (x, z) { return (x - dx) * nx + (z - dz) * nz; };
    F.tOf = function (x, z) { return alongX ? x - dx : z - dz; };
    // the unit record city/fitout_plans.js's frame(U) takes for this same frame
    F.U = { x0: ix0, x1: ix1, z0: iz0, z1: iz1, door: { x: dx, z: dz }, inX: nx, inZ: nz, alongX: alongX, floor: 0, n: 0, id: "house" };
    return F;
  }
  /* the shell's windows in the frame: wall "front" (the door wall) | "back" |
     "lo" (the t = tLo side) | "hi", a0..a1 along it (t on front and back, d
     on the sides), y0..y1 building-local, k the storey */
  function windowsOf(b, F) {
    const out = [];
    const ops = b.openings || [];
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!op || op.door || !(op.t1 > op.t0)) continue;
      const horiz = op.s === 0 || op.s === 1;           // the face runs along x
      const sgn = (op.s === 0 || op.s === 2) ? -1 : 1;
      let wall, a0, a1;
      if (horiz === F.alongX) {
        wall = sgn === (F.alongX ? -F.nz : -F.nx) ? "front" : "back";
        const o = F.alongX ? F.dx : F.dz;
        a0 = op.t0 - o; a1 = op.t1 - o;
      } else {
        wall = sgn < 0 ? "lo" : "hi";
        const o = F.alongX ? F.dz : F.dx, n = F.alongX ? F.nz : F.nx;
        const p = (op.t0 - o) * n, q = (op.t1 - o) * n;
        a0 = Math.min(p, q); a1 = Math.max(p, q);
      }
      out.push({ wall: wall, a0: a0, a1: a1, y0: op.y0, y1: op.y1, k: op.k | 0 });
    }
    return out;
  }
  function clearAt(wins, wall, a, half, ks) {
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      if (w.wall !== wall || (ks && ks.indexOf(w.k) < 0)) continue;
      if (a + half > w.a0 - 0.05 && a - half < w.a1 + 0.05) return false;
    }
    return true;
  }
  // the nearest place to `a` in [lo, hi] where a partition end misses every
  // window of `walls` (on the storeys `ks`); `a` itself when there is none
  function snap(wins, walls, a, lo, hi, ks) {
    const half = PW / 2 + 0.02;
    for (let off = 0; off <= 3.0; off += 0.05) {
      const tries = off ? [a - off, a + off] : [a];
      for (let q = 0; q < tries.length; q++) {
        const v = tries[q];
        if (v < lo - 1e-6 || v > hi + 1e-6) continue;
        let ok = true;
        for (let i = 0; i < walls.length && ok; i++) ok = clearAt(wins, walls[i], v, half, ks);
        if (ok) return v;
      }
    }
    return clamp(a, lo, hi);
  }

  /* ---- THE PLAN ---------------------------------------------------------------
     plan = { F, wins, st, FH, tops, wealth, tier, s (the living side, -1/+1),
       kind "hall" | "cottage", floors: [{ k, y, ceil, rooms: [room], walls:
       [wall] }], stair | null, spots: { safe, rack, wardrobe } }
     room = { id, type, k, d0, d1, t0, t1 (frame), alc (a closet nook, same
       shape) | null, doors: [{ wall, a, w, leaf }] (its own doorways, for
       the furnisher's keep-clear), master, ext: { front, back, lo, hi }
       (which of its walls are the shell's) }
     wall = { across (constant d, runs along t) | along (constant t), at,
       from, to, gaps: [{ c, w, h, door: bool, hinge, side, label }] } */
  function room(plan, k, type, d0, d1, t0, t1, extra) {
    const F = plan.F;
    const r = { id: "k" + k + ":" + type + ":" + Math.round((t0 + t1) * 5), type: type, k: k, d0: d0, d1: d1, t0: t0, t1: t1,
      alc: null, doors: [], master: false,
      ext: { front: d0 < 0.01, back: d1 > F.D - 0.01, lo: t0 < F.tLo + 0.01, hi: t1 > F.tHi - 0.01 } };
    if (extra) for (const q in extra) r[q] = extra[q];
    plan.floors[k].rooms.push(r);
    return r;
  }
  function make(b, lot, U) {
    const F = frameOf(b, U), FH = b.FH || 3.2;
    let wins = windowsOf(b, F);
    if (U) {
      // a flat sees the windows of its own storey in the walls that are the
      // shell's: the facade behind it, and a side wall at the end of the rank
      const wt = b.wt != null ? b.wt : 0.4, K = U.floor | 0;
      const tOff = F.alongX ? F.dx : F.dz, half = (F.alongX ? b.w : b.d) / 2 - wt;
      const extLo = F.tLo + tOff <= -half + 0.5, extHi = F.tHi + tOff >= half - 0.5;
      wins = wins.filter(function (q) {
        if (q.k !== K) return false;
        if (q.wall === "back") return q.a1 > F.tLo + 0.1 && q.a0 < F.tHi - 0.1;
        if (q.wall === "lo") return extLo && q.a1 > 0.1 && q.a0 < F.D - 0.1;
        if (q.wall === "hi") return extHi && q.a1 > 0.1 && q.a0 < F.D - 0.1;
        return false;
      }).map(function (q) { return { wall: q.wall, a0: q.a0, a1: q.a1, y0: q.y0, y1: q.y1, k: 0 }; });
    }
    const st = U ? 1 : Math.max(1, b.storeys | 0);
    const tops = U ? [U.y, U.y + FH]
      : (Array.isArray(b.floorTops) && b.floorTops.length > st) ? b.floorTops
      : (function () { const o = [0.14]; for (let L = 1; L <= st; L++) o.push(L * FH); return o; })();
    const wealth = wealthOf(lot, b);
    const plan = { F: F, wins: wins, st: st, FH: FH, tops: tops, wealth: wealth, tier: tierOf(wealth),
      s: h01(b.ox || 0, b.oz || 0, 0x4b1) < 0.5 ? -1 : 1, kind: "hall", floors: [], stair: null, spots: {},
      ox: b.ox || 0, oz: b.oz || 0 };
    /* A HOUSE'S CEILING IS 2.62 m, hung under the slab. A room that high is a
       house's room, and the 25 cm of wall head it hides is where the sun's
       shadow map lets go (a surface that close under the slab that shades it
       reads as lit, in a saw-tooth of shadow texels along every wall). */
    const CEIL_H = 2.62;
    for (let k = 0; k < st; k++) {
      const ch = Math.min(CEIL_H, tops[k + 1] - 0.2 - tops[k] - 0.06);
      plan.floors.push({ k: k, y: tops[k], ceil: tops[k] + ch, ceilH: ch, rooms: [], walls: [] });
    }
    if (U) { plan.flat = true; plan.unit = U; plan.s = (F.tHi + F.tLo) >= 0 ? 1 : -1; }
    if (st === 1 && (F.W < 9.4 || F.D < 7.6)) { plan.kind = "cottage"; cottage(plan); }
    else { if (st >= 2 && F.W < 8.6) plan.kind = "narrow"; hall(plan); }
    spots(plan);
    return plan;
  }

  // the bathroom's two side walls on the back wall: off its windows, a bath's
  // width apart, as near the hall's line as the windows allow
  function bathWalls(plan, hc, want, lo, hi, ks) {
    const wins = plan.wins;
    let best = null;
    const half = PW / 2 + 0.02;
    for (let a = hc - 3.4; a <= hc + 0.6; a += 0.05) {
      if (a < lo || !clearAt(wins, "back", a, half, ks)) continue;
      for (let c = a + 1.7 + PW; c <= a + 3.3 + PW; c += 0.05) {
        if (c > hi || !clearAt(wins, "back", c, half, ks)) continue;
        const cost = Math.abs((a + c) / 2 - hc) + 0.6 * Math.abs((c - a - PW) - want);
        if (!best || cost < best.cost) best = { a: a, c: c, cost: cost };
      }
    }
    if (best) return [best.a, best.c];
    return [hc - want / 2 - PW / 2, hc + want / 2 + PW / 2];
  }

  /* THE CENTRE-HALL HOUSE (and, with a stair in the hall, every storey of a
     taller one).
     plan.kind "narrow": a town house too narrow for a room either side of a
     hall (a metro's 7 to 9 m fronts). The front door opens into the living
     room; the stair hall runs down one side wall, the stair against the wall;
     the kitchen is the room across the back with a cloakroom in the corner
     behind the stair. Upstairs the same walls make a front bedroom, a back
     bedroom and the bathroom. */
  function hall(plan) {
    const F = plan.F, wins = plan.wins, st = plan.st, s = plan.s;
    const D = F.D, tLo = F.tLo, tHi = F.tHi;
    const stair = st >= 2;
    const narrow = plan.kind === "narrow";
    const allK = []; for (let k = 0; k < st; k++) allK.push(k);
    // the hall strip: the walk on the living side, the stair's lane on the other
    let hLo = stair ? (s > 0 ? -0.75 - LANE_W : -0.9) : -0.9;
    let hHi = stair ? (s > 0 ? 0.9 : 0.75 + LANE_W) : 0.9;
    if (narrow) {
      if (s > 0) { hLo = tLo; hHi = tLo + LANE_W + 0.9; } else { hHi = tHi; hLo = tHi - LANE_W - 0.9; }
    } else if (stair) {
      // the lane-side wall, off the front wall's windows on every storey
      if (s > 0) hLo = snap(wins, ["front"], hLo - PW / 2, hLo - PW / 2 - 0.3, hLo - PW / 2 + 0.05, allK) + PW / 2;
      else hHi = snap(wins, ["front"], hHi + PW / 2, hHi + PW / 2 - 0.05, hHi + PW / 2 + 0.3, allK) - PW / 2;
    }
    const lane = stair ? (s > 0 ? [hLo, hLo + LANE_W] : [hHi - LANE_W, hHi]) : null;
    const CW = stair ? 1.15 : 1.1;
    let fD, dS = 0, g = 0, n = 0;
    if (stair) {
      n = Math.max(12, Math.round((plan.tops[1] - plan.tops[0]) / 0.185));
      g = clamp((D - 1.1 - CW - 2 * PW - 2.5) / (n - 1), 0.225, 0.26);
      dS = 1.1; fD = dS + (n - 1) * g;
      const c = snap(wins, ["lo", "hi"], fD + PW / 2, fD + PW / 2 - 0.25, fD + PW / 2 + 0.7, allK);
      dS += c - PW / 2 - fD; fD = c - PW / 2;
    } else {
      fD = clamp(D * 0.5, 3.6, 5.0);
      const cap = D - 2.9 - CW - 2 * PW;
      if (fD > cap) fD = cap;
      fD = snap(wins, ["lo", "hi"], fD + PW / 2, 3.2 + PW / 2, Math.max(3.2, cap) + PW / 2, allK) - PW / 2;
    }
    const dB = fD + PW / 2, c0 = fD + PW, c1 = c0 + CW, dC = c1 + PW / 2, b0 = c1 + PW;
    const BD = D - b0;
    const hc = (hLo + hHi) / 2;
    const bw = clamp(F.W * 0.2, 1.9, 2.5);
    let tA, tB;
    if (narrow) {
      // the bathroom in the back corner behind the stair, one wall of its own
      if (s > 0) { tA = tLo - PW / 2; tB = snap(wins, ["back"], tLo + bw + PW / 2, tLo + 1.75 + PW / 2, tLo + 2.7 + PW / 2, allK); }
      else { tB = tHi + PW / 2; tA = snap(wins, ["back"], tHi - bw - PW / 2, tHi - 2.7 - PW / 2, tHi - 1.75 - PW / 2, allK); }
    } else {
      const bwalls = bathWalls(plan, hc, bw, tLo + 1.85, tHi - 1.85, allK);
      tA = bwalls[0]; tB = bwalls[1];
    }
    // a side too narrow to be a room: the bathroom takes it
    const noLo = tA - PW / 2 - tLo < 1.7, noHi = tHi - tB - PW / 2 < 1.7;
    const bathLo = noLo ? tLo : tA + PW / 2, bathHi = noHi ? tHi : tB - PW / 2;
    const doorL = tA - PW / 2 - 0.1 - DOOR_W / 2, doorR = tB + PW / 2 + 0.1 + DOOR_W / 2;
    // the bathroom's door by one of its side walls, so the open leaf lies on it
    const bHinge = noLo ? 1 : -1;
    const doorB = noLo ? bathHi - 0.12 - BATH_W / 2 : bathLo + 0.12 + BATH_W / 2;
    // the door in the back wall of the front room on the stair's side (the
    // kitchen downstairs, a bedroom upstairs: the stair shuts its hall wall)
    const kd = s > 0 ? hLo - PW - 0.12 - DOOR_W / 2 : hHi + PW + 0.12 + DOOR_W / 2;
    let cLo = Math.min(hLo - PW, doorB - BATH_W / 2 - 0.3, noLo ? 1e9 : doorL - DOOR_W / 2 - 0.3, s > 0 && !narrow ? kd - DOOR_W / 2 - 0.3 : 1e9);
    let cHi = Math.max(hHi + PW, doorB + BATH_W / 2 + 0.3, noHi ? -1e9 : doorR + DOOR_W / 2 + 0.3, s < 0 && !narrow ? kd + DOOR_W / 2 + 0.3 : -1e9);
    if (narrow) { cLo = Math.max(cLo, tLo); cHi = Math.min(cHi, tHi); }
    if (cLo - tLo < 1.0) cLo = tLo;
    if (tHi - cHi < 1.0) cHi = tHi;
    plan.g = { hLo: hLo, hHi: hHi, fD: fD, c0: c0, c1: c1, b0: b0, BD: BD, tA: tA, tB: tB, cLo: cLo, cHi: cHi, kd: kd,
      doorL: doorL, doorR: doorR, doorB: doorB, noLo: noLo, noHi: noHi, lane: lane, dS: dS };

    /* A FLAT (plan.flat) has one wall of windows, the facade behind it, and
       that is the back band here: so the living room is one of the two back
       rooms (the wider) and the bedroom the other, and the windowless rooms
       by the corridor are the dining room (open to the hall) and the kitchen. */
    const flatLiving = !!plan.flat && !noLo && !noHi;
    const wideSide = (tHi - tB) >= (tA - tLo) ? 1 : -1;
    for (let k = 0; k < st; k++) {
      const fl = plan.floors[k];
      const ground = k === 0, top = k === st - 1;
      // ---- the rooms ----
      const hallR = room(plan, k, ground ? "hall" : "landing", 0, c1, hLo, hHi, { cor: { d0: c0, d1: c1, t0: cLo, t1: cHi } });
      const liv = s > 0 ? [hHi + PW, tHi] : [tLo, hLo - PW], kit = s > 0 ? [tLo, hLo - PW] : [hHi + PW, tHi];
      const frontA = room(plan, k, ground ? (flatLiving ? "dining" : "living") : "bed", 0, fD, liv[0], liv[1]);
      const frontB = narrow ? null : room(plan, k, ground ? "kitchen" : "bed", 0, fD, kit[0], kit[1]);
      if (!ground && top) frontA.master = true;
      // the back band: a room either side of the bathroom, each with the
      // passage's end as its closet nook
      const sideType = function (sd, wide) {
        if (flatLiving) return sd === wideSide ? "living" : "bed";
        if (st === 1) return "bed";
        if (narrow) return ground ? "kitchen" : "bed";
        if (ground) return sd === s ? "study" : "dining";
        return (BD >= 2.7 && wide >= 2.5) ? "bed" : (sd === s ? "dress" : "store");
      };
      let backLo = null, backHi = null;
      if (!noLo) {
        backLo = room(plan, k, sideType(-1, tA - PW / 2 - tLo), b0, D, tLo, tA - PW / 2);
        if (cLo > tLo) backLo.alc = { d0: c0, d1: b0, t0: tLo, t1: cLo - PW };
      }
      if (!noHi) {
        backHi = room(plan, k, sideType(1, tHi - tB - PW / 2), b0, D, tB + PW / 2, tHi);
        if (cHi < tHi) backHi.alc = { d0: c0, d1: b0, t0: cHi + PW, t1: tHi };
      }
      const bath = room(plan, k, (stair && ground) ? "wc" : "bath", b0, D, bathLo, bathHi);
      if (st === 1) {
        // the bigger bedroom is the main one
        const beds = [backLo, backHi].filter(function (q) { return q && q.type === "bed"; });
        const m = beds.length < 2 ? beds[0] : ((backLo.t1 - backLo.t0) >= (backHi.t1 - backHi.t0) ? backLo : backHi);
        if (m) m.master = true;
      }
      // ---- the walls and their doorways ----
      const hallLiv = s > 0 ? hHi + PW / 2 : hLo - PW / 2, hallKit = s > 0 ? hLo - PW / 2 : hHi + PW / 2;
      const gapsLiv = [];
      if (ground) {
        // (by the front door, so the wall past it is long enough for what stands on it)
        const dO = clamp(1.3, 0.3 + OPEN_W / 2, Math.max(1.05, fD - 1.0 - OPEN_W / 2));
        gapsLiv.push({ c: dO, w: Math.min(OPEN_W, fD - 0.8), h: 2.2, door: false });
        frontA.doors.push({ wall: s > 0 ? "lo" : "hi", a: dO, w: OPEN_W });
        hallR.doors.push({ wall: s > 0 ? "hi" : "lo", a: dO, w: OPEN_W });
      } else {
        const dd = fD - 0.14 - DOOR_W / 2;
        gapsLiv.push({ c: dd, w: DOOR_W, h: DOOR_H, door: true, hinge: 1, side: s, label: top ? "the bedroom" : "the room" });
        frontA.doors.push({ wall: s > 0 ? "lo" : "hi", a: dd, w: DOOR_W, leaf: true });
        hallR.doors.push({ wall: s > 0 ? "hi" : "lo", a: dd, w: DOOR_W });
      }
      fl.walls.push({ across: false, at: hallLiv, from: 0, to: fD + PW, gaps: gapsLiv });
      if (!narrow) fl.walls.push({ across: false, at: hallKit, from: 0, to: fD + PW, gaps: [] });
      // the front rooms' back wall, either side of the hall's mouth
      const kGap = ground ? { c: kd, w: KIT_W, h: 2.2, door: false }
        : { c: kd, w: DOOR_W, h: DOOR_H, door: true, hinge: s > 0 ? 1 : -1, side: -1, label: "the bedroom" };
      const segLo = { across: true, at: dB, from: tLo, to: hLo - PW, gaps: s > 0 && frontB ? [kGap] : [] };
      const segHi = { across: true, at: dB, from: hHi + PW, to: tHi, gaps: s < 0 && frontB ? [kGap] : [] };
      if (!narrow || s < 0) fl.walls.push(segLo);
      if (!narrow || s > 0) fl.walls.push(segHi);
      if (frontB) {
        frontB.doors.push({ wall: "back", a: kd, w: kGap.w, leaf: !!kGap.door });
        hallR.doors.push({ wall: "corFront", a: kd, w: kGap.w });
      }
      // the passage's back wall: a door to each room behind it
      const gC = [];
      const kitBack = function (r) { return r.type === "kitchen" || r.type === "living"; };
      if (backLo && kitBack(backLo)) { gC.push({ c: doorL, w: KIT_W, h: 2.2, door: false }); backLo.doors.push({ wall: "front", a: doorL, w: KIT_W }); }
      else if (backLo) { gC.push({ c: doorL, w: DOOR_W, h: DOOR_H, door: true, hinge: 1, side: 1, label: doorLabel(backLo.type) }); backLo.doors.push({ wall: "front", a: doorL, w: DOOR_W, leaf: true }); }
      gC.push({ c: doorB, w: BATH_W, h: DOOR_H, door: true, hinge: bHinge, side: 1, label: "the bathroom" });
      bath.doors.push({ wall: "front", a: doorB, w: BATH_W, leaf: true });
      if (backHi && kitBack(backHi)) { gC.push({ c: doorR, w: KIT_W, h: 2.2, door: false }); backHi.doors.push({ wall: "front", a: doorR, w: KIT_W }); }
      else if (backHi) { gC.push({ c: doorR, w: DOOR_W, h: DOOR_H, door: true, hinge: -1, side: 1, label: doorLabel(backHi.type) }); backHi.doors.push({ wall: "front", a: doorR, w: DOOR_W, leaf: true }); }
      fl.walls.push({ across: true, at: dC, from: cLo > tLo ? cLo - PW : tLo, to: cHi < tHi ? cHi + PW : tHi, gaps: gC });
      if (cLo > tLo) fl.walls.push({ across: false, at: cLo - PW / 2, from: fD, to: b0, gaps: [] });
      if (cHi < tHi) fl.walls.push({ across: false, at: cHi + PW / 2, from: fD, to: b0, gaps: [] });
      if (!noLo) fl.walls.push({ across: false, at: tA, from: c1, to: D, gaps: [] });
      if (!noHi) fl.walls.push({ across: false, at: tB, from: c1, to: D, gaps: [] });
    }
    if (stair) {
      const flights = [];
      for (let k = 0; k < st - 1; k++) flights.push({ k: k, y0: plan.tops[k], y1: plan.tops[k + 1], rise: (plan.tops[k + 1] - plan.tops[k]) / n });
      plan.stair = { lane: lane, inner: s > 0 ? lane[1] : lane[0], wall: s > 0 ? lane[0] : lane[1], open: s,   // the walk is on the +s side of the lane
        dS: dS, dT: fD, g: g, n: n, flights: flights };
    }
  }
  function doorLabel(type) {
    return type === "bed" ? "the bedroom" : type === "study" ? "the study" : type === "dining" ? "the dining room"
      : type === "dress" ? "the dressing room" : type === "store" ? "the box room" : "the room";
  }

  /* THE COTTAGE: one room to live and cook in, a bedroom behind it and the
     bedroom's own bathroom */
  function cottage(plan) {
    const F = plan.F, wins = plan.wins, s = plan.s;
    const D = F.D, tLo = F.tLo, tHi = F.tHi;
    const fl = plan.floors[0];
    let fD = D - 3.3 - PW;
    if (fD < 3.0) fD = D - 2.8 - PW;
    if (fD < 2.6) {
      // too shallow for a bedroom behind: one room, the bed in it
      room(plan, 0, "studio", 0, D, tLo, tHi, { master: true });
      plan.g = { fD: D, studio: true };
      return;
    }
    fD = snap(wins, ["lo", "hi"], fD + PW / 2, Math.max(2.6, fD - 0.6) + PW / 2, Math.min(D - 2.6, fD + 0.5) + PW / 2, [0]) - PW / 2;
    const dB = fD + PW / 2, b0 = fD + PW;
    // the bathroom in the back corner on the far side from the living end
    const bw = clamp(F.W * 0.3, 1.9, 2.4);
    let tD = s > 0 ? tLo + bw + PW / 2 : tHi - bw - PW / 2;
    tD = snap(wins, ["back"], tD, tD - 0.5, tD + 0.5, [0]);
    const bathT = s > 0 ? [tLo, tD - PW / 2] : [tD + PW / 2, tHi], bedT = s > 0 ? [tD + PW / 2, tHi] : [tLo, tD - PW / 2];
    const great = room(plan, 0, "great", 0, fD, tLo, tHi);
    const bed = room(plan, 0, "bed", b0, D, bedT[0], bedT[1], { master: true });
    const bath = room(plan, 0, "bath", b0, D, bathT[0], bathT[1]);
    const bd = tD + s * (PW / 2 + 0.12 + DOOR_W / 2);          // the bedroom door, by the bathroom's wall
    fl.walls.push({ across: true, at: dB, from: tLo, to: tHi, gaps: [{ c: bd, w: DOOR_W, h: DOOR_H, door: true, hinge: -s, side: 1, label: "the bedroom" }] });
    great.doors.push({ wall: "back", a: bd, w: DOOR_W });
    bed.doors.push({ wall: "front", a: bd, w: DOOR_W, leaf: true });
    const ed = b0 + 0.12 + BATH_W / 2;                            // the bathroom's door, off the bedroom
    fl.walls.push({ across: false, at: tD, from: fD, to: D, gaps: [{ c: ed, w: BATH_W, h: DOOR_H, door: true, hinge: -1, side: -s, label: "the bathroom" }] });
    bed.doors.push({ wall: s > 0 ? "lo" : "hi", a: ed, w: BATH_W });
    bath.doors.push({ wall: s > 0 ? "hi" : "lo", a: ed, w: BATH_W, leaf: true });
    plan.g = { fD: fD, b0: b0, tD: tD, bd: bd };
  }

  /* ---- THE OWNER'S FIXTURES: where the safe, the gun rack and the wardrobe
     go in THIS house. Each is { k, d, t (frame), fd, ft (unit, from the room
     into the wall its back is on), room }. The fit-out keeps each place
     clear (and stands the wardrobe there itself: it is the house's own). */
  function spots(plan) {
    const F = plan.F, s = plan.s, G = plan.g || {};
    const rooms = []; for (const fl of plan.floors) for (const r of fl.rooms) rooms.push(r);
    const find = function (type, k) { for (const r of rooms) if (r.type === type && (k == null || r.k === k)) return r; return null; };
    const master = rooms.filter(function (r) { return r.master; }).pop() || find("bed") || rooms[0];
    const S = plan.spots;
    if (plan.kind === "cottage") {
      if (G.studio) {
        const r = rooms[0], c = (r.t0 + r.t1) / 2;
        S.wardrobe = { k: 0, room: r, d: r.d1 - 0.33, t: c - s * 1.6, fd: 1, ft: 0 };
        S.safe = { k: 0, room: r, d: r.d1 - 0.33, t: c - s * 2.9, fd: 1, ft: 0 };
        S.rack = { k: 0, room: r, d: r.d1 * 0.5, t: s > 0 ? r.t0 + 0.31 : r.t1 - 0.31, fd: 0, ft: -s };
        return;
      }
      // the bedroom: the wardrobe on its front wall (the great room's back),
      // the safe in the corner beside it; the rack in the great room
      const out = s > 0 ? master.t1 : master.t0;          // the bedroom's outer side
      S.wardrobe = { k: 0, room: master, d: master.d0 + 0.33, t: out - s * 1.0, fd: -1, ft: 0 };
      S.safe = { k: 0, room: master, d: master.d0 + 0.33, t: out - s * 2.15, fd: -1, ft: 0 };
      // the rack on the great room's outside wall where no window is, else its back wall
      const gr = find("great");
      const sideW = s > 0 ? "hi" : "lo";
      let rd = null;
      for (let d = gr.d1 - 1.0; d >= 1.0; d -= 0.1) if (clearAt(plan.wins, sideW, d, 0.85, [0])) { rd = d; break; }
      if (rd != null) S.rack = { k: 0, room: gr, d: rd, t: out - s * 0.31, fd: 0, ft: s };
      else S.rack = { k: 0, room: gr, d: gr.d1 - 0.31, t: out - s * 1.0, fd: 1, ft: 0 };
      return;
    }
    // the main bedroom's closet nook (the passage's end), or its own front wall
    const sd = (master.t0 + master.t1) / 2 > (G.hLo + G.hHi) / 2 ? 1 : -1;      // which side of the house it is on
    const edge = sd > 0 ? master.t1 : master.t0;                                 // its outer wall
    if (master.alc && master.alc.t1 - master.alc.t0 >= 1.7) {
      const a = master.alc, len = a.t1 - a.t0;
      // the wardrobe against the nook's front wall, the safe in its outer corner
      S.wardrobe = { k: master.k, room: master, d: a.d0 + 0.33, t: sd > 0 ? a.t0 + 0.75 : a.t1 - 0.75, fd: -1, ft: 0 };
      if (len >= 2.6) S.safe = { k: master.k, room: master, d: a.d0 + 0.34, t: edge - sd * 0.5, fd: -1, ft: 0 };
    } else if (master.d0 < 0.01) {
      // an upstairs front bedroom: its back wall, by the outer corner
      S.wardrobe = { k: master.k, room: master, d: master.d1 - 0.33, t: edge - sd * 1.0, fd: 1, ft: 0 };
    } else {
      S.wardrobe = { k: master.k, room: master, d: master.d0 + 0.33, t: edge - sd * 1.0, fd: -1, ft: 0 };
    }
    const study = find("study", 0);
    if (study) {
      // the study: the safe in the back corner by the bathroom's wall, the
      // rack on that wall
      const inner = (study.t0 + study.t1) / 2 > (G.hLo + G.hHi) / 2 ? study.t0 : study.t1, sg = inner === study.t0 ? 1 : -1;
      S.safe = { k: 0, room: study, d: study.d1 - 0.34, t: inner + sg * 0.5, fd: 1, ft: 0 };
      if (study.d1 - study.d0 >= 2.4) S.rack = { k: 0, room: study, d: study.d0 + (study.d1 - study.d0) * 0.42, t: inner + sg * 0.31, fd: 0, ft: -sg };
    }
    if (!S.safe) S.safe = { k: master.k, room: master, d: master.d1 - 0.34, t: edge - sd * 0.5, fd: 1, ft: 0 };
    if (!S.rack) {
      // the hall: the wall on the kitchen's side, past the way in
      const hallR = find("hall", 0);
      if (hallR && !plan.stair) {
        const wallT = s > 0 ? G.hLo : G.hHi;
        S.rack = { k: 0, room: hallR, d: clamp(G.fD - 1.05, 2.0, G.fD - 0.9), t: wallT + s * 0.31, fd: 0, ft: -s };
      } else {
        const liv = find("living", 0) || rooms[0];
        S.rack = { k: 0, room: liv, d: liv.d1 - 0.31, t: (liv.t0 + liv.t1) / 2 + s * Math.min(1.6, (liv.t1 - liv.t0) / 2 - 1.0), fd: 1, ft: 0 };
      }
    }
  }
  // a spot in the world: { x, y, z, fx, fz, k, drawn }
  function spotWorld(b, plan, what) {
    const sp = plan.spots[what]; if (!sp) return null;
    const p = plan.F.P(sp.d, sp.t);
    const F = plan.F;
    let fx = F.nx * sp.fd + (F.alongX ? sp.ft : 0), fz = F.nz * sp.fd + (F.alongX ? 0 : sp.ft);
    let px = p.x, pz = p.z;
    // a house built square and turned onto a skewed street (city/house_metro.js)
    if (b.frameYaw) {
      const c = Math.cos(b.frameYaw), s = Math.sin(b.frameYaw);
      const qx = px * c + pz * s, qz = -px * s + pz * c, gx = fx * c + fz * s, gz = -fx * s + fz * c;
      px = qx; pz = qz; fx = gx; fz = gz;
    }
    return { x: (b.ox || 0) + px, y: plan.tops[sp.k], z: (b.oz || 0) + pz, fx: fx, fz: fz, k: sp.k,
      house: true, drawn: what === "wardrobe", yaw: b.frameYaw || 0 };
  }

  /* ---- A FLAT IN A TOWER: clear wall on the flat's own floor, by its bed ----
     No plan to ask, so the building's own records answer: its colliders at
     that storey, its windows, its lift chase and stair core. */
  function aptSpots(lot) {
    const b = lot && lot.building; if (!b || !b.home || b.w == null) return null;
    if (b._aptSpots && b._aptSpots.n === (b.colliders ? b.colliders.length : 0)) return b._aptSpots.s;
    const F = frameOf(b), wins = windowsOf(b, F);
    const FH = b.FH || 3.2;
    const y = b.home.floorY != null ? +b.home.floorY : 0;
    const k = Math.max(0, Math.round(y / FH));
    const fy = (Array.isArray(b.floorTops) && b.floorTops[k] != null) ? b.floorTops[k] : (k ? k * FH : 0.14);
    const ox = b.ox || 0, oz = b.oz || 0;
    const cols = b.colliders || [];
    let bed = null;
    try { bed = CBZ.propNearestBed ? CBZ.propNearestBed(ox, oz, Math.max(b.w, b.d), fy + 0.3) : null; } catch (e) { bed = null; }
    let anchor = bed && bed.x != null ? { d: F.dOf(bed.x - ox, bed.z - oz), t: F.tOf(bed.x - ox, bed.z - oz) } : null;
    if (!anchor) {
      // no bed on record: where the flat's furniture stands (small things on this floor)
      let ax = 0, az = 0, an = 0;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (c.y0 == null || c.y0 < fy - 0.05 || c.y0 > fy + 1.2 || c.y1 > fy + 2.4 || c.maxX - c.minX > 3.2 || c.maxZ - c.minZ > 3.2) continue;
        ax += (c.minX + c.maxX) / 2 - ox; az += (c.minZ + c.maxZ) / 2 - oz; an++;
      }
      anchor = an ? { d: F.dOf(ax / an, az / an), t: F.tOf(ax / an, az / an) } : { d: F.D * 0.5, t: (F.tLo + F.tHi) / 2 };
    }
    const taken = [];
    const blocked = function (R) {
      const x0 = ox + R.x0, x1 = ox + R.x1, z0 = oz + R.z0, z1 = oz + R.z1;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (c.maxX <= x0 || c.minX >= x1 || c.maxZ <= z0 || c.minZ >= z1) continue;
        if (c.y1 != null && c.y1 < fy + 0.2) continue;
        if (c.y0 != null && c.y0 > fy + 1.9) continue;
        return true;
      }
      for (const r of (b.shaftRects || []).concat(b.keepRects || [])) if (R.x1 > r.x0 - 0.5 && R.x0 < r.x1 + 0.5 && R.z1 > r.z0 - 0.5 && R.z0 < r.z1 + 0.5) return true;
      for (const r of taken) if (R.x1 > r.x0 && R.x0 < r.x1 && R.z1 > r.z0 && R.z0 < r.z1) return true;
      return false;
    };
    // a piece `len` along a wall, `deep` off it, with standing room in front
    const place = function (len, deep, noWindow) {
      let best = null;
      const tryAt = function (wall, a) {
        let R, d, t, fd, ft;
        if (wall === "back") { d = F.D - 0.02 - deep / 2; t = a; fd = 1; ft = 0; R = F.R(F.D - 0.03 - deep - 0.7, F.D - 0.03, a - len / 2, a + len / 2); }
        else if (wall === "front") { d = 0.02 + deep / 2; t = a; fd = -1; ft = 0; R = F.R(0.03, 0.03 + deep + 0.7, a - len / 2, a + len / 2); }
        else if (wall === "lo") { t = F.tLo + 0.02 + deep / 2; d = a; fd = 0; ft = -1; R = F.R(a - len / 2, a + len / 2, F.tLo + 0.03, F.tLo + 0.03 + deep + 0.7); }
        else { t = F.tHi - 0.02 - deep / 2; d = a; fd = 0; ft = 1; R = F.R(a - len / 2, a + len / 2, F.tHi - 0.03 - deep - 0.7, F.tHi - 0.03); }
        if (noWindow && !clearAt(wins, wall, a, len / 2, [k])) return;
        if (blocked(R)) return;
        const cost = Math.hypot(d - anchor.d, t - anchor.t);
        if (!best || cost < best.cost) best = { d: d, t: t, fd: fd, ft: ft, cost: cost, R: R };
      };
      for (let a = F.tLo + len / 2 + 0.2; a <= F.tHi - len / 2 - 0.2; a += 0.25) { tryAt("back", a); if (k > 0) tryAt("front", a); }
      for (let a = len / 2 + 0.2; a <= F.D - len / 2 - 0.2; a += 0.25) { tryAt("lo", a); tryAt("hi", a); }
      if (!best) return null;
      taken.push(best.R);
      anchor = { d: best.d, t: best.t };            // the next thing stands by this one
      const p = F.P(best.d, best.t);
      return { x: ox + p.x, y: fy, z: oz + p.z, fx: F.nx * best.fd + (F.alongX ? best.ft : 0), fz: F.nz * best.fd + (F.alongX ? 0 : best.ft), k: k };
    };
    // (each place is the thing's centre 0.32 m off its wall, as city/realestate.js stands it)
    const s = { wardrobe: place(1.2, 0.6, true), safe: place(0.75, 0.6, false), rack: place(1.6, 0.6, true) };
    b._aptSpots = { n: cols.length, s: s };
    return s;
  }

  /* ---- frame → building-local, for both passes -------------------------------- */
  function wallLocal(F, wl) {
    const out = { axis: "x", at: 0, from: 0, to: 0, gaps: [], src: wl };
    if (wl.across) {
      const p0 = F.P(wl.at, wl.from), p1 = F.P(wl.at, wl.to);
      if (F.alongX) { out.axis = "x"; out.at = p0.z; out.from = p0.x; out.to = p1.x; }
      else { out.axis = "z"; out.at = p0.x; out.from = p0.z; out.to = p1.z; }
      const o = F.alongX ? F.dx : F.dz, nn = F.alongX ? F.nz : F.nx;
      for (const g of wl.gaps) out.gaps.push({ c: o + g.c, w: g.w, h: g.h, door: !!g.door, hinge: g.hinge || -1, side: (g.side || 1) * nn, label: g.label, src: g });
    } else {
      const p0 = F.P(wl.from, wl.at), p1 = F.P(wl.to, wl.at);
      if (F.alongX) { out.axis = "z"; out.at = p0.x; out.from = p0.z; out.to = p1.z; }
      else { out.axis = "x"; out.at = p0.z; out.from = p0.x; out.to = p1.x; }
      const o = F.alongX ? F.dz : F.dx, nn = F.alongX ? F.nz : F.nx;
      for (const g of wl.gaps) out.gaps.push({ c: o + nn * g.c, w: g.w, h: g.h, door: !!g.door, hinge: (g.hinge || -1) * nn, side: g.side || 1, label: g.label, src: g });
    }
    if (out.from > out.to) { const q = out.from; out.from = out.to; out.to = q; }
    out.gaps.sort(function (a, c) { return a.c - c.c; });
    return out;
  }

  /* ---- THE EAGER PASS --------------------------------------------------------- */
  const HOUSES = [];
  let SEQ = 0;
  function drawWall(b, y0, h, L) {
    const seg = function (a, c, ya, yb, solid) {
      if (c - a < 0.03 || yb - ya < 0.03) return;
      const mid = (a + c) / 2, cy = (ya + yb) / 2;
      if (L.axis === "x") b.lbox(mid, cy, L.at, c - a, yb - ya, PW, WALLC, { cast: false, solid: solid, shrink: [0, 0, 0, 0, 0.02, 0.02] });
      else b.lbox(L.at, cy, mid, PW, yb - ya, c - a, WALLC, { cast: false, solid: solid, shrink: [0.02, 0.02, 0, 0, 0, 0] });
    };
    let cur = L.from;
    for (const g of L.gaps) {
      const g0 = Math.max(L.from, g.c - g.w / 2), g1 = Math.min(L.to, g.c + g.w / 2);
      seg(cur, g0, y0, y0 + h, true);
      seg(g0, g1, y0 + g.h, y0 + h, false);
      cur = g1;
    }
    seg(cur, L.to, y0, y0 + h, true);
  }
  function guard(b, R, y0, y1) {
    const c = { minX: (b.ox || 0) + R.x0, maxX: (b.ox || 0) + R.x1, minZ: (b.oz || 0) + R.z0, maxZ: (b.oz || 0) + R.z1,
      y0: y0, y1: y1, ref: null, noBreach: true, houseGuard: true };
    if (CBZ.colliders) CBZ.colliders.push(c);
    if (b.colliders) b.colliders.push(c);
    return c;
  }
  function buildStair(b, plan) {
    const S = plan.stair, F = plan.F;
    if (!S || !CBZ.stairs || !CBZ.stairs.flight) return false;
    const ox = b.ox || 0, oz = b.oz || 0;
    const tc = (S.lane[0] + S.lane[1]) / 2, lw = S.lane[1] - S.lane[0];
    const run = S.n * S.g;
    // the slab over the run comes out on every upper floor, in one cut
    if (CBZ.cityCarveShaft) {
      const H = F.R(S.dS + 0.04, S.dT, S.lane[0], S.lane[1]);
      const levels = []; for (let L = 1; L < plan.st; L++) levels.push(L);
      S.hole = H;
      try { CBZ.cityCarveShaft(b, ox + (H.x0 + H.x1) / 2, oz + (H.z0 + H.z1) / 2, (H.x1 - H.x0) / 2, (H.z1 - H.z0) / 2, { levels: levels }); } catch (e) {}
    }
    const TREAD = 0x6b4a2e, BODY = 0xe6e1d6;
    const sized = function (sd, stt) { return F.alongX ? [stt, sd] : [sd, stt]; };
    for (const fl of S.flights) {
      const B = F.P(S.dS, tc), T = F.P(S.dS + run, tc);
      CBZ.stairs.flight({
        bottom: { x: ox + B.x, y: fl.y0, z: oz + B.z }, top: { x: ox + T.x, y: fl.y1, z: oz + T.z },
        width: lw - 0.06, overlap: 0.3, steps: S.n, underside: fl.k === 0, owner: b,
        plats: b.platforms || undefined, cols: b.colliders || undefined, kind: "stair",
      });
      // the treads you see (the walk surface is exactly these: going j, 1..n-1,
      // stands j risers up; the n-th going is the floor it arrives on)
      for (let j = 1; j < S.n; j++) {
        const dc = S.dS + (j - 0.5) * S.g, top = fl.y0 + j * fl.rise;
        const p = F.P(dc - 0.012, tc), sz = sized(S.g + 0.024, lw - 0.05), sb = sized(S.g, lw - 0.07);
        b.lbox(p.x, top - 0.02, p.z, sz[0], 0.04, sz[1], TREAD, { cast: false, stair: true });
        const q = F.P(dc, tc);
        b.lbox(q.x, top - 0.04 - 0.11, q.z, sb[0], 0.22, sb[1], BODY, { cast: false, stair: true });
      }
      // the rail on the flight's open side (the walk beside it): stepped with
      // the pitch, so nobody steps off the stair into the hall from a height
      const nSeg = Math.max(4, Math.ceil(run / 0.5));
      for (let i = 1; i < nSeg; i++) {
        const a = S.dS + run * i / nSeg, c = S.dS + run * (i + 1) / nSeg;
        if (c > S.dT + 0.01) break;
        const ya = fl.y0 + (fl.y1 - fl.y0) * i / nSeg, yc = fl.y0 + (fl.y1 - fl.y0) * (i + 1) / nSeg;
        guard(b, F.R(a, c, S.inner - 0.04, S.inner + 0.04), ya + 0.12, yc + 0.95);
      }
      // the floor above: a guard along the well's open side, and across its
      // end where no flight carries on up
      const yU = fl.y1;
      guard(b, F.R(S.dS, S.dT, S.inner - 0.05, S.inner + 0.05), yU, yU + 1.0);
      if (fl.k === plan.st - 2) guard(b, F.R(S.dS - 0.05, S.dS + 0.05, S.lane[0], S.lane[1]), yU, yU + 1.0);
    }
    b._stairCoreFailed = true;             // this shell has its stair: no service core is ever built in it
    b.hasHouseStair = true;
    return true;
  }
  function furnish(b, lot) {
    if (!b || typeof b.lbox !== "function" || b.w == null || !b.localDoor) return null;
    // (a streamed shell that came back is a new group: its plan is built again)
    if (b._house && b._house.group === b.group) return b._house;
    let plan = null;
    try { plan = make(b, lot); } catch (e) { if (window.console) console.warn("[house] plan failed", e); plan = null; }
    if (!plan) return null;
    Object.defineProperty(b, "_house", { value: plan, enumerable: true, writable: true, configurable: true });
    if (lot && lot.building && lot.building !== b) lot.building._house = plan;
    plan.lot = lot || null;
    plan.group = b.group || null;
    const F = plan.F;
    // a shell that reserved a service stair core (a caller that did not ask
    // for `stairs: false`): a house's stair is its own, the core is let go
    if (plan.stair && b.stairPlan) {
      const sp = b.stairPlan;
      if (b.shaftRects) { const i = b.shaftRects.indexOf(sp.rect); if (i >= 0) b.shaftRects.splice(i, 1); }
      if (b.keepRects) { const i = b.keepRects.indexOf(sp.mouth); if (i >= 0) b.keepRects.splice(i, 1); }
      b.stairPlan = null;
    }
    try { if (plan.stair) buildStair(b, plan); } catch (e) { if (window.console) console.warn("[house] stair failed", e); }
    raise(b, plan, true);
    // a streamed shell that comes back is a NEW record on an old site
    const site = CBZ.fitoutSiteOf ? CBZ.fitoutSiteOf(b) : null;
    if (site) { site.b = b; site.wx = null; if (lot) site.lot = lot; }
    HOUSES.push({ b: b, _seq: ++SEQ });
    // the listing says what the house has (city/realestate.js's agent reads it)
    const home = (lot && lot.building && lot.building.home) || b.home || null;
    if (home) {
      let nb = 0; for (const fl of plan.floors) for (const r of fl.rooms) if (r.type === "bed" || r.type === "studio") nb++;
      home.beds = Math.max(1, nb);
      home.floorY = 0;
    }
    return plan;
  }
  /* A FLAT IN A TOWER: the unit a storey of flats left for the listed home
     (interior_programs.js `home`), planned as a one-storey house in the
     unit's own frame. Its partitions and room doors are raised here; the
     storey's fit-out (fitout_plans.js "residential") hands the unit to the
     house planner when you walk in. */
  function furnishUnit(b, lot, U) {
    if (!b || typeof b.lbox !== "function" || !U || !U.door) return null;
    if (b._flat && b._flat.group === b.group) return b._flat;
    let plan = null;
    try { plan = make(b, lot, U); } catch (e) { if (window.console) console.warn("[flat] plan failed", e); plan = null; }
    if (!plan) return null;
    b._flat = plan;
    if (lot && lot.building && lot.building !== b) lot.building._flat = plan;
    plan.lot = lot || null;
    plan.group = b.group || null;
    U.house = plan;
    raise(b, plan, false);
    const home = (lot && lot.building && lot.building.home) || b.home || null;
    if (home) {
      let nb = 0; for (const r of plan.floors[0].rooms) if (r.type === "bed" || r.type === "studio") nb++;
      home.beds = Math.max(1, nb);
    }
    return plan;
  }
  // the plan's partitions and room doors, on every floor; `declare`: each
  // floor is declared to the fit-out as a house's (a flat's storey is not:
  // it is the corridor's)
  function raise(b, plan, declare) {
    const F = plan.F;
    const D = CBZ.cityUnitDoors;
    plan.doors = [];
    for (const fl of plan.floors) {
      const h = fl.ceil - fl.y;
      fl.local = [];
      for (const wl of fl.walls) {
        const L = wallLocal(F, wl);
        fl.local.push(L);
        try { drawWall(b, fl.y, h, L); } catch (e) {}
        for (const g of L.gaps) {
          if (!g.door || !D || !D.freeDoor) continue;
          const runX = L.axis === "x";
          let d = null;
          try {
            d = D.freeDoor(b, fl.y, runX ? g.c : L.at, runX ? L.at : g.c, runX, g.w - 0.04, g.h, LEAFC, g.hinge, g.side,
              g.label || "the door", "h" + fl.k, { style: "state", house: true });
          } catch (e) { d = null; }
          if (d) plan.doors.push(d);
        }
      }
      // every floor is the fit-out's to finish (city/fitout_house.js)
      if (declare && CBZ.fitoutDeclare) CBZ.fitoutDeclare(b, fl.y, "house", { x0: F.ix0, x1: F.ix1, z0: F.iz0, z1: F.iz1, y: fl.y }, { house: plan, floor: fl.k, ceilH: fl.ceilH });
    }
  }
  /* A STREAMED HOUSE'S STAIR GOES WITH IT (core/citystream.js cannot see the
     stair system's link list; the colliders and platforms it can) */
  if (CBZ.streamBusHook) CBZ.streamBusHook({
    mark: function () { return SEQ; },
    since: function (m) { const out = []; for (let i = 0; i < HOUSES.length; i++) if (HOUSES[i]._seq > m) out.push(HOUSES[i]); return out; },
    drop: function (items) {
      for (const it of items) {
        const i = HOUSES.indexOf(it); if (i >= 0) HOUSES.splice(i, 1);
        if (it.b && it.b.hasHouseStair && CBZ.stairs && CBZ.stairs.removeOwner) { try { CBZ.stairs.removeOwner(it.b); } catch (e) {} }
      }
    },
  });

  /* ---- THE STREET DOOR, BY HAND. A house's door is left as it is left
     (city/buildings.js's opener: walking into it shoves it open and it stays).
     E at it shuts it, or opens it without walking through. A door locked to
     you is city/realestate.js's (the key, or the boot). */
  let homeDoors = [], homeDoorsN = -1, doorWired = false;
  function doorsNow() {
    const all = CBZ.cityDoorsGet ? CBZ.cityDoorsGet() : null;
    if (!all) return homeDoors;
    if (all.length !== homeDoorsN) { homeDoorsN = all.length; homeDoors = all.filter(function (d) { return d && d.home; }); }
    return homeDoors;
  }
  function wireDoor() {
    const I = CBZ.interactions;
    if (doorWired || !I || !I.registerZone) return;
    doorWired = true;
    const across = function (dr, px, pz) { return (px - dr.wx) * dr.inx + (pz - dr.wz) * dr.inz; };
    I.registerZone({
      id: "house-door", kind: "housedoor", radius: 2.0, prio: 6, driving: false,
      find: function (px, pz) {
        let best = null, bd = 2.0 * 2.0;
        const L = doorsNow();
        for (let i = 0; i < L.length; i++) {
          const dr = L[i];
          if (dr.demolished || (dr._playerLock && dr._playerLock(dr))) continue;
          const dx = dr.wx - px, dz = dr.wz - pz, q = dx * dx + dz * dz;
          if (q < bd) { bd = q; best = dr; }
        }
        if (!best) return null;
        // (ay: where a finger finds it, the middle of the leaf; systems/touch.js taps there)
        const t = best._useTgt || (best._useTgt = { pos: { x: 0, y: 0, z: 0 }, ay: 1.15, ar: 0.5 });
        t.x = t.pos.x = best.wx; t.z = t.pos.z = best.wz; t.door = best;
        return t;
      },
      options: [
        { id: "house-door-shut", slot: "e", prio: 4, campaignSafe: true, label: "Shut the door",
          canShow: function (t) { const P = CBZ.player; return !!(t && t.door && t.door.open && P && P.pos && Math.abs(across(t.door, P.pos.x, P.pos.z)) > 0.55); },
          onSelect: function (t) { const dr = t.door; dr.stay = false; dr.open = false; dr.hold = 0; dr.noAuto = true; } },
        { id: "house-door-open", slot: "e", prio: 4, campaignSafe: true, label: "Open the door",
          canShow: function (t) { return !!(t && t.door && !t.door.open); },
          onSelect: function (t) { const dr = t.door; dr.noAuto = false; dr.open = true; dr.stay = true; dr.hold = 1.8; } },
      ],
    });
    if (I.describe) I.describe("housedoor", function (t) { return { label: "Front door", note: t && t.door && t.door.open ? "open" : "shut" }; });
  }
  if (CBZ.onUpdate) CBZ.onUpdate(40.85, function () { if (!doorWired && CBZ.game && CBZ.game.mode === "city") wireDoor(); });

  function planOf(lot) { const b = lot && lot.building; return (b && b._house) || null; }
  CBZ.cityHouse = {
    PW: PW, wealth: wealthOf, tier: function (lot, b) { return tierOf(wealthOf(lot, b)); }, tierOf: tierOf, styleFor: styleFor,
    frame: frameOf, windows: windowsOf, plan: make, planOf: planOf, furnish: furnish,
    // where an owned home's fixture goes: the house's own plan, or (a flat in
    // a tower) clear wall on the flat's floor. null = the caller's own guess.
    spot: function (lot, what) {
      const b = lot && lot.building; if (!b) return null;
      if (b._house) return spotWorld(b, b._house, what);
      if (b._flat) return spotWorld(b, b._flat, what);
      if (b.home && b.group && b.colliders && b.colliders.length) { const s = aptSpots(lot); return s ? s[what] || null : null; }
      return null;
    },
    furnishUnit: furnishUnit,
    houses: function () { return HOUSES.map(function (h) { return h.b; }); },
    _wallLocal: wallLocal,
  };
})();
