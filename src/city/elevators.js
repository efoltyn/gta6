/* ============================================================
   city/elevators.js — VERTICAL ACCESS: elevators in the tallest
   towers + exterior fire-escape stairs on a few mid-rises.

   WHY: height is STATUS. The property ladder ends in a penthouse
   with a helipad, so getting UP has to feel like ARRIVING — you
   walk in through the building's DOOR, cross the lobby to the lift
   alcove on an interior wall ([E] at the call panel), the doors
   close, the car hums and the floor ticker climbs, and the doors
   open onto a walkable roof with the whole city under you. The
   alcove lives INSIDE on purpose: a lift you board off the sidewalk
   reads like a prop, one you walk a lobby to reads like a building.
   Cops and peds have no shaft — the lift is a clean ESCAPE — while
   the fire escapes are the LOUD way up: open stairs anyone can
   chase you on, ending on roofs that give vantage and a bail-out.
   Both rigs read the lot's door-face data first: the lobby alcove
   picks an interior wall clear of the door aisle / stair strip /
   counter stamps, and a fire escape never hangs on (or across the
   approach to) the facade that holds the entrance.

   The ride is a teleport DRESSED IN BEATS (door close → hum/shake/
   ticker → door open), not a simulated shaft — zero per-frame cost
   when idle. Geometry is draw-call-cheap: ONE shared unit box geo
   scaled per mesh + the city's cached shared materials (CBZ.cmat),
   colliders/platforms registered once at build with a single
   markCollidersDirty. Which lots rate a lift / an escape is decided
   by buildings.js (city.elevatorLots / city.fireEscapeLots) so the
   lot policy stays with the lots; this file owns the rigs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const FH = 4.6;                 // floor-to-floor (mirrors buildings.js — storeys sized to the ~2.5-tall character)
  const PAR_H = 0.7;              // parapet height (mirrors the visual rim)
  const REACH = 2.5;              // [E] call-panel reach

  // ---- shared building blocks (mesh-count bound: ONE geometry, cached mats) --
  const UNIT = new THREE.BoxGeometry(1, 1, 1);
  const cmat = CBZ.cmat || CBZ.mat;
  function box(parent, x, y, z, w, h, d, hex, o) {
    o = o || {};
    const m = new THREE.Mesh(UNIT, cmat(hex, o.emissive ? { emissive: o.emissive, ei: o.ei || 0.5 } : null));
    m.scale.set(w, h, d); m.position.set(x, y, z);
    m.castShadow = !!o.cast; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function solid(y0, y1, minX, maxX, minZ, maxZ, ref) {
    const c = { minX, maxX, minZ, maxZ, y0, y1, ref: ref || null };
    CBZ.colliders.push(c); return c;
  }
  function plat(minX, maxX, minZ, maxZ, top, ramp) {
    const p = { minX, maxX, minZ, maxZ, top };
    if (ramp) p.ramp = ramp;
    CBZ.platforms.push(p); return p;
  }

  // shared swap-materials for the call button + hall lantern (never mutated —
  // we swap mesh.material between two cached mats, so sharing stays safe)
  const BTN_IDLE = () => cmat(0x35d07a, { emissive: 0x16a04a, ei: 0.7 });
  const BTN_LIT = () => cmat(0xffc14a, { emissive: 0xff9d1f, ei: 1.0 });
  const LAMP_IDLE = () => cmat(0x3a3f46, { emissive: 0x10131a, ei: 0.3 });
  const LAMP_LIT = () => cmat(0xffd9a0, { emissive: 0xffb347, ei: 0.9 });
  const STEEL = 0x39414c, LEAF = 0x8a93a0, SHAFT = 0x161b22, RAILC = 0x2c333d, LAND = 0x434b56;

  // outward face info for a wall side (0:-z 1:+z 2:-x 3:+x), in building-local coords
  function faceInfo(side, w, d) {
    if (side === 0) return { nx: 0, nz: -1, px: 0, pz: -d / 2, span: w, tx: 1, tz: 0 };
    if (side === 1) return { nx: 0, nz: 1, px: 0, pz: d / 2, span: w, tx: 1, tz: 0 };
    if (side === 2) return { nx: -1, nz: 0, px: -w / 2, pz: 0, span: d, tx: 0, tz: 1 };
    return { nx: 1, nz: 0, px: w / 2, pz: 0, span: d, tx: 0, tz: 1 };
  }
  const OPP = [1, 0, 3, 2];
  // inward door normal per side index (mirrors buildings.js doorInfo)
  const INWARD = [{ x: 0, z: 1 }, { x: 0, z: -1 }, { x: 1, z: 0 }, { x: -1, z: 0 }];

  // which face holds the building's DOOR. b.side is stamped by worldgen on
  // every served lot; the door normal is the fallback so a future producer
  // that only stamps door {x,z,nx,nz} still resolves correctly.
  function doorSideOf(b) {
    if (b.side != null) return b.side;
    const dr = b.door;
    if (dr) {
      if (dr.nx > 0) return 2; if (dr.nx < 0) return 3;
      if (dr.nz > 0) return 0; if (dr.nz < 0) return 1;
    }
    return 0;
  }

  // slab extents (mirror makeBuilding's roof math) so everything we add lands
  // on the SOLID roof, never over the open -x stairwell shaft.
  function slabInfo(b) {
    const wt = b.wt != null ? b.wt : 0.4;
    const ixMax = b.w / 2 - wt, izMin = -b.d / 2 + wt, izMax = b.d / 2 - wt;
    const slabMinX = b.hasStairs ? (-b.w / 2 + wt + b.stairW) : (-b.w / 2 + wt);
    return { wt, ixMax, izMin, izMax, slabMinX, slabW: ixMax - slabMinX, slabD: izMax - izMin };
  }

  const elevators = [];          // built lift records
  let built = false;

  // ---- interior keep-clear anchors (the lot.building stamps + the worldgen
  // furnishing conventions) so the lobby alcove never boxes in a clerk, a
  // counter, the jewelry cases, or a tower flat's big ground-floor pieces.
  // Solid hazards (shop back counter) are re-derived with the EXACT math
  // worldgen used to place them; the rest come straight off the stamps.
  function interiorAvoids(b) {
    const a = [], w = b.w, d = b.d, wt = b.wt != null ? b.wt : 0.4;
    if (b.vendorSpot) a.push({ x: b.vendorSpot.x, z: b.vendorSpot.z, r: 1.8 });
    if (b.gunstore && b.gunstore.counter) {
      const c = b.gunstore.counter;
      a.push({ x: c.x, z: c.z, r: Math.max(c.w || 1, c.d || 1) / 2 + 1.0 });
    }
    if (b.jewelry && b.jewelry.cases) for (const c of b.jewelry.cases) a.push({ x: c.x, z: c.z, r: 1.6 });
    if (b.club && b.club.insideSpot) a.push({ x: b.club.insideSpot.x, z: b.club.insideSpot.z, r: 1.8 });
    if (b.shop) {
      // the SOLID back counter: same placement math as worldgen (door-relative
      // back wall, shifted onto the solid half on climbable buildings)
      const n = INWARD[doorSideOf(b)];
      let ccx = n.x * (w / 2 - 2.8), ccz = n.z * (d / 2 - 2.8);
      let cw = n.x ? 0.8 : Math.min(w - 2, 4.5);
      const cd = n.z ? 0.8 : Math.min(d - 2, 4.5);
      if (b.hasStairs) {
        const stairRight = -w / 2 + wt + b.stairW;
        if (cw > 1) {
          const roomRight = w / 2 - wt;
          cw = Math.min(cw, Math.max(1.8, roomRight - stairRight - 1.0));
          ccx = (stairRight + roomRight) / 2;
        } else if (ccx - cw / 2 < stairRight + 0.5) ccx = stairRight + 0.5 + cw / 2;
        ccx = Math.max(ccx, stairRight + 0.4 - n.x * 1.2);
      }
      a.push({ x: b.ox + ccx, z: b.oz + ccz, r: Math.max(cw, cd) / 2 + 1.0 });
    } else if (b.home && !b.hangar) {
      // tower ground floors are dressed flats (furnishApartmentFloor at k=0):
      // bed in the (+x,-z) corner, kitchen run on the +z wall, lamp + living set
      a.push({ x: b.ox + w / 2 - 2.0, z: b.oz - d / 2 + 2.2, r: 2.2 });   // bed
      a.push({ x: b.ox + w / 2 - 2.6, z: b.oz + d / 2 - 1.6, r: 2.4 });   // kitchen run
      a.push({ x: b.ox + w / 2 - 1.2, z: b.oz - 0.6, r: 1.0 });           // floor lamp
      a.push({ x: b.ox + 1.2, z: b.oz + 0.6, r: 2.2 });                   // living set
    }
    return a;
  }

  // pick the INTERIOR wall + lateral slot for the lobby alcove. Never the
  // door face (the entrance aisle owns it), never the -x face on climbable
  // buildings (that's the open stair strip), and the back face — where shop
  // counters / kitchen runs live — only as a last resort. Each slot is
  // sampled through b.clearFloorPoint (door aisle + stair strip + bounds)
  // plus the keep-clear anchors above; a second pass relaxes the anchors so
  // a cramped room still gets its lift rather than none.
  function pickLobby(b) {
    const w = b.w, d = b.d, S = slabInfo(b), ds = doorSideOf(b);
    const avoid = interiorAvoids(b);
    const faces = [];
    for (const c of [3, 0, 1]) if (c !== ds && c !== OPP[ds]) faces.push(c);
    if (!b.hasStairs && ds !== 2 && OPP[ds] !== 2) faces.push(2);
    if (OPP[ds] !== 2 || !b.hasStairs) faces.push(OPP[ds]);   // back wall: last resort
    function tryFace(side, strict) {
      const f = faceInfo(side, w, d);
      const maxLat = Math.max(0, f.span / 2 - 4.4);           // stay off both corners (beds/kitchens hug them)
      // the mega-tower deck: hold the alcove well beside the central drive-in
      // bay so the hangar roll-out lane stays open; otherwise centre-out, and
      // on ±z walls of climbable buildings bias AWAY from the -x stair strip.
      const slots = b.hangar ? [f.span * 0.30, -f.span * 0.30, f.span * 0.38, -f.span * 0.38]
        : (b.hasStairs && (side === 0 || side === 1)) ? [2.4, 3.4, 1.2, 0, -1.2, -2.4, -3.4]
        : [2.4, -2.4, 1.2, -1.2, 0, 3.4, -3.4];
      for (let lat of slots) {
        lat = Math.max(-maxLat, Math.min(maxLat, lat));
        // alcove footprint + the boarding apron in front of the leafs
        const pts = [[-1.35, 0.45], [1.35, 0.45], [0, 0.7], [-1.35, 1.5], [1.35, 1.5], [0, 2.0], [0, 2.7]];
        let ok = true;
        for (const q of pts) {
          const lx = f.px - f.nx * (S.wt + q[1]) + f.tx * (lat + q[0]);
          const lz = f.pz - f.nz * (S.wt + q[1]) + f.tz * (lat + q[0]);
          if (b.clearFloorPoint && !b.clearFloorPoint(lx, lz, 0.3)) { ok = false; break; }
          if (strict) {
            for (const av of avoid) if (Math.hypot(b.ox + lx - av.x, b.oz + lz - av.z) < av.r) { ok = false; break; }
            if (!ok) break;
          }
        }
        if (ok) return { f, lat };
      }
      return null;
    }
    for (const side of faces) { const r = tryFace(side, true); if (r) return r; }
    for (const side of faces) { const r = tryFace(side, false); if (r) return r; }
    return null;
  }

  // ============================ ELEVATOR =================================
  // Ground lobby alcove on an INTERIOR wall — you come in through the
  // building's door and cross the floor to it (the old rig faced the street,
  // which read like boarding a lift off the sidewalk): two solid cheeks +
  // header, a dark shaft recess against the wall, two sliding steel leafs, a
  // call panel with a glowing button, and a hall lantern that lights while
  // the car runs. On the roof a matching headhouse (solid, so the roof reads
  // built, not painted). The ride beats are untouched — only WHERE you board.
  function buildElevator(lot) {
    const b = lot.building, w = b.w, d = b.d, grp = b.group, ox = b.ox, oz = b.oz, h = b.h;
    const S = slabInfo(b);
    const spot = pickLobby(b);
    if (!spot) { console.warn("[elevator] no clear interior wall on", b.name || "lot"); return; }
    const f = spot.f, off = spot.lat;
    // dep now measures INWARD from the interior wall face (f.px/f.pz sit on
    // the outer plane; S.wt steps through the wall), so the whole alcove —
    // cheeks, leafs, panel, boarding pad — builds into the room.
    const P = (lat, dep) => ({ x: f.px - f.nx * (S.wt + dep) + f.tx * (off + lat), z: f.pz - f.nz * (S.wt + dep) + f.tz * (off + lat) });
    const tn = (t, n) => (f.tx ? { w: t, d: n } : { w: n, d: t });

    // cheeks (solid) — the leaf pocket sits in the gap behind them
    for (const s of [-1, 1]) {
      const p = P(s * 1.02, 0.625), sz = tn(0.6, 0.55);
      const m = box(grp, p.x, 1.6, p.z, sz.w, 3.2, sz.d, STEEL, { cast: true });
      solid(0, 3.2, ox + p.x - sz.w / 2, ox + p.x + sz.w / 2, oz + p.z - sz.d / 2, oz + p.z + sz.d / 2, m);
    }
    { // header over the opening (solid — a jump can put a head in it)
      const p = P(0, 0.625), sz = tn(2.64, 0.55);
      const m = box(grp, p.x, 2.82, p.z, sz.w, 0.84, sz.d, STEEL, { cast: true });
      solid(2.4, 3.24, ox + p.x - sz.w / 2, ox + p.x + sz.w / 2, oz + p.z - sz.d / 2, oz + p.z + sz.d / 2, m);
    }
    { // dark shaft recess so an OPEN door reads as a real car bay
      const p = P(0, 0.06), sz = tn(1.5, 0.08);
      box(grp, p.x, 1.35, p.z, sz.w, 2.5, sz.d, SHAFT);
    }
    // the two sliding leafs (visual only — the ride is beats, so no collider
    // churn / markCollidersDirty per ride)
    const ground = { leaves: [], open: 0, target: 0, autoClose: null };
    for (const s of [-1, 1]) {
      const p = P(s * 0.37, 0.16), sz = tn(0.76, 0.1);
      const m = box(grp, p.x, 1.27, p.z, sz.w, 2.45, sz.d, LEAF);
      ground.leaves.push({ m, baseX: p.x, baseZ: p.z, sx: f.tx * s, sz: f.tz * s });
    }
    // call panel + button + hall lantern
    { const p = P(1.02, 0.93), sz = tn(0.3, 0.08); box(grp, p.x, 1.32, p.z, sz.w, 0.55, sz.d, 0x232830); }
    const pb = P(1.02, 0.99), pbs = tn(0.12, 0.05);
    const btnG = box(grp, pb.x, 1.42, pb.z, pbs.w, 0.12, pbs.d, 0x35d07a, { emissive: 0x16a04a, ei: 0.7 });
    const pl = P(0, 0.95), pls = tn(0.7, 0.07);
    const lampG = box(grp, pl.x, 3.05, pl.z, pls.w, 0.2, pls.d, 0x3a3f46, { emissive: 0x10131a, ei: 0.3 });
    const padP = P(0, 1.5);
    const groundPad = { x: ox + padP.x, z: oz + padP.z };

    // ---- roof HEADHOUSE at the slab's (+x,-z) corner: clear of the open -x
    //      stair shaft AND of the helipad mast (which holds the (+,+) corner).
    const hx = S.ixMax - 1.7, hz = S.izMin + 1.7;
    const hh = box(grp, hx, h + 1.32, hz, 2.4, 2.64, 2.4, 0x6c737c, { cast: true });
    solid(h, h + 2.64, ox + hx - 1.2, ox + hx + 1.2, oz + hz - 1.2, oz + hz + 1.2, hh);
    box(grp, hx, h + 2.7, hz, 2.6, 0.14, 2.6, 0x474f59);                     // cap
    box(grp, hx - 1.21, h + 1.3, hz, 0.05, 2.35, 1.5, SHAFT);               // recess (door faces -x, into the roof)
    const roof = { leaves: [], open: 0, target: 0, autoClose: null };
    for (const s of [-1, 1]) {
      const m = box(grp, hx - 1.26, h + 1.25, hz + s * 0.37, 0.1, 2.3, 0.74, LEAF);
      roof.leaves.push({ m, baseX: hx - 1.26, baseZ: hz + s * 0.37, sx: 0, sz: s });
    }
    box(grp, hx - 1.26, h + 1.35, hz + 1.0, 0.08, 0.5, 0.26, 0x232830);     // roof call panel
    const btnR = box(grp, hx - 1.31, h + 1.45, hz + 1.0, 0.05, 0.12, 0.12, 0x35d07a, { emissive: 0x16a04a, ei: 0.7 });
    const lampR = box(grp, hx - 1.26, h + 2.45, hz, 0.07, 0.2, 0.7, 0x3a3f46, { emissive: 0x10131a, ei: 0.3 });
    const roofPad = { x: ox + hx - 1.9, z: oz + hz };

    addParapets(lot, null);
    addRoofProps(lot, [
      { x: ox + hx, z: oz + hz, r: 2.2 },
      { x: roofPad.x, z: roofPad.z, r: 1.4 },
    ]);

    const rec = { lot, b, ground, roof, groundPad, roofPad, btnG, btnR, lampG, lampR };
    lot.building.lift = { ground: groundPad, roof: { x: roofPad.x, y: h, z: roofPad.z } };
    elevators.push(rec);
  }

  // ============================ FIRE ESCAPE ===============================
  // Exterior switchback stairs hugging a ±x facade. The CLIMB is the same
  // proven z-axis RAMP platforms the interior stairs use (groundAt only
  // interpolates ramps along z — that's WHY these live on a ±x face), so
  // every flight glides under STEP_UP at a dead run. The top landing bridges
  // OVER the parapet onto the roof (step up 0.75 / step down 0.75, both
  // inside STEP_UP/STEP_DOWN). A y-gated outer-rail collider keeps you on
  // the stairs above ~2m — but never snags street-level peds below it.

  // DOOR-FACE GUARD: the rig must never hang on the facade that holds the
  // entrance, or drop its ground flight across the walk-up to the door. The
  // flight footprint (stringers + posts, with a step of margin) is tested
  // against the door's approach corridor read off the lot's OWN door stamp.
  function flightCrossesDoor(b, m) {
    const w = b.w, d = b.d, ox = b.ox, oz = b.oz, ds = doorSideOf(b);
    if ((m > 0 ? 3 : 2) === ds) return true;                  // facade IS the door face
    const n = INWARD[ds];
    // door wall point from the stamped door (doorPt sits 1.6 inside the wall)
    const dwx = b.door && b.door.x != null ? b.door.x - n.x * 1.6 : (ds === 2 ? ox - w / 2 : ds === 3 ? ox + w / 2 : ox);
    const dwz = b.door && b.door.z != null ? b.door.z - n.z * 1.6 : (ds === 0 ? oz - d / 2 : ds === 1 ? oz + d / 2 : oz);
    // approach corridor: 4.2 out from the threshold, doorway + shoulder wide
    const hw = 2.45, L = 4.2;
    const cx0 = Math.min(dwx, dwx - n.x * L) - (n.x ? 0 : hw), cx1 = Math.max(dwx, dwx - n.x * L) + (n.x ? 0 : hw);
    const cz0 = Math.min(dwz, dwz - n.z * L) - (n.z ? 0 : hw), cz1 = Math.max(dwz, dwz - n.z * L) + (n.z ? 0 : hw);
    // the rig's ground footprint on facade m (stringer strip + posts + margin)
    const fx0 = ox + (m > 0 ? w / 2 - 0.05 : -(w / 2 + 1.75)), fx1 = ox + (m > 0 ? w / 2 + 1.75 : -(w / 2 - 0.05));
    const fz0 = oz - (d / 2 - 0.3), fz1 = oz + (d / 2 - 0.3);
    return fx0 < cx1 && fx1 > cx0 && fz0 < cz1 && fz1 > cz0;
  }

  function buildFireEscape(lot) {
    const b = lot.building, w = b.w, d = b.d, grp = b.group, ox = b.ox, oz = b.oz, h = b.h;
    // facade pick: +x first; -x only on buildings WITHOUT the interior stair
    // shaft (its slab gap sits on -x — a bridge there would drop you down it).
    // If every valid facade hosts the door / crosses its walk-up, the lot
    // simply goes unserved — a clear doorway beats a fourth escape route.
    let m = 0;
    for (const cand of (b.hasStairs ? [1] : [1, -1])) {
      if (!flightCrossesDoor(b, cand)) { m = cand; break; }
    }
    if (!m) return;
    const X0 = w / 2 + 0.15, X1 = w / 2 + 1.35, XC = w / 2 + 0.75;
    const xLo = (a, c) => ox + Math.min(m * a, m * c), xHi = (a, c) => ox + Math.max(m * a, m * c);
    const zA = -d / 2 + 1.1, zB = d / 2 - 1.1, LD = 1.2;
    const S = b.storeys;
    let bz = 0;
    for (let k = 0; k < S; k++) {
      const dir = (k % 2 === 0) ? 1 : -1;
      const zStart = dir > 0 ? zA : zB, zEnd = dir > 0 ? zB : zA;
      const rampEnd = zEnd - dir * LD;
      const run = Math.abs(rampEnd - zStart);
      // the walkable ramp + the flat landing at the floor line
      plat(xLo(X0, X1), xHi(X0, X1), oz + Math.min(zStart, rampEnd), oz + Math.max(zStart, rampEnd), (k + 1) * FH,
        { z0: oz + zStart, z1: oz + rampEnd, y0: k * FH, y1: (k + 1) * FH });
      plat(xLo(X0, X1), xHi(X0, X1), oz + Math.min(rampEnd, zEnd), oz + Math.max(rampEnd, zEnd), (k + 1) * FH);
      // visuals: one tilted stringer slab + one tilted outer rail per flight
      // (no per-tread boxes — the game is mesh-count bound, the slab reads)
      const hyp = Math.hypot(run, FH), tilt = -dir * Math.atan2(FH, run);
      const slab = box(grp, m * XC, k * FH + FH / 2 - 0.05, (zStart + rampEnd) / 2, 1.2, 0.1, hyp, 0x39414c);
      slab.rotation.x = tilt;
      const rail = box(grp, m * (X1 + 0.04), k * FH + FH / 2 + 0.45, (zStart + rampEnd) / 2, 0.07, 1.0, hyp, RAILC);
      rail.rotation.x = tilt;
      box(grp, m * XC, (k + 1) * FH - 0.06, (rampEnd + zEnd) / 2, 1.2, 0.12, LD + 0.15, LAND);
      box(grp, m * (X1 + 0.04), (k + 1) * FH + 0.45, (rampEnd + zEnd) / 2, 0.07, 1.0, LD + 0.15, RAILC);
      if (k === S - 1) bz = (rampEnd + zEnd) / 2;
    }
    // two full-height support posts so the rig reads structural
    box(grp, m * X1, h / 2, zA - 0.35, 0.1, h, 0.1, RAILC, { cast: true });
    box(grp, m * X1, h / 2, zB + 0.35, 0.1, h, 0.1, RAILC, { cast: true });
    // outer rail + end caps as colliders, y-gated ABOVE 2m: a fall guard on
    // the climb that street peds walk straight under
    solid(2.0, h + 1.0, xLo(X1 - 0.02, X1 + 0.12), xHi(X1 - 0.02, X1 + 0.12), oz + zA - 0.1, oz + zB + 0.1);
    solid(2.0, h + 1.0, xLo(X0 - 0.05, X1 + 0.12), xHi(X0 - 0.05, X1 + 0.12), oz + zA - 0.35, oz + zA - 0.15);
    solid(2.0, h + 1.0, xLo(X0 - 0.05, X1 + 0.12), xHi(X0 - 0.05, X1 + 0.12), oz + zB + 0.15, oz + zB + 0.35);
    // the BRIDGE over the parapet onto the roof (sits just above the rim)
    plat(xLo(w / 2 - 1.35, X1), xHi(w / 2 - 1.35, X1), oz + bz - 0.8, oz + bz + 0.8, h + 0.75);
    box(grp, m * w / 2, h + 0.69, bz, X1 - (w / 2 - 1.35), 0.12, 1.6, LAND);
    box(grp, m * (w / 2 - 1.6), h + 0.3, bz, 0.7, 0.3, 1.3, 0x59616c);      // step block on the roof side
    addParapets(lot, { z0: oz + bz - 0.9, z1: oz + bz + 0.9, side: m });    // rim colliders, gap at the bridge
    addRoofProps(lot, [{ x: ox + m * w / 2, z: oz + bz, r: 2.0 }]);
    lot.building.fireEscape = { x: ox + m * X1, z: oz + bz, topY: h, side: m };
  }

  // ---- ROOF BOOKKEEPING (shared by both routes) ---------------------------
  // Parapet COLLIDERS along the existing visual rim: a reached roof should
  // hold you at a dead sprint — you leave it by JUMPING the rim (a hop clears
  // 0.7m), never by tripping off it. y-gated to the rim so nothing at street
  // level ever touches them. `gap` ({z0,z1,side:±1}) leaves the fire-escape
  // bridge passable on whichever ±x rim carries it.
  function addParapets(lot, gap) {
    const b = lot.building, ox = b.ox, oz = b.oz, w = b.w, d = b.d, h = b.h;
    const S = slabInfo(b), y0 = h, y1 = h + PAR_H;
    solid(y0, y1, ox + S.slabMinX, ox + S.ixMax, oz + d / 2 - S.wt, oz + d / 2);     // +z rim
    solid(y0, y1, ox + S.slabMinX, ox + S.ixMax, oz - d / 2, oz - d / 2 + S.wt);     // -z rim
    for (const sx of [1, -1]) {                                                      // ±x rims
      const x0 = sx > 0 ? ox + w / 2 - S.wt : ox - w / 2, x1 = sx > 0 ? ox + w / 2 : ox - w / 2 + S.wt;
      if (gap && (gap.side || 1) === sx) {                                           // split at the bridge
        if (gap.z0 > oz + S.izMin) solid(y0, y1, x0, x1, oz + S.izMin, gap.z0);
        if (gap.z1 < oz + S.izMax) solid(y0, y1, x0, x1, gap.z1, oz + S.izMax);
      } else {
        solid(y0, y1, x0, x1, oz + S.izMin, oz + S.izMax);
      }
    }
  }

  // 1-2 cheap shared-geometry props so a reached roof reads as a PLACE you
  // arrived at, not a bare slab: an AC unit + a ducted vent. Skipped where
  // they'd crowd the helipad / headhouse / arrival spot.
  function addRoofProps(lot, avoid) {
    const b = lot.building, ox = b.ox, oz = b.oz, h = b.h;
    const S = slabInfo(b);
    const cx = b.roofCx != null ? b.roofCx : ox, cz = b.roofCz != null ? b.roofCz : oz;
    const hp = lot.building.helipad;
    const blocked = (x, z) => {
      if (hp && Math.hypot(x - hp.x, z - hp.z) < (hp.r || 6) + 1.4) return true;
      for (const a of avoid || []) if (Math.hypot(x - a.x, z - a.z) < a.r) return true;
      return false;
    };
    const spots = [
      { x: cx - S.slabW * 0.27, z: cz + S.slabD * 0.27 },
      { x: cx + S.slabW * 0.27, z: cz + S.slabD * 0.27 },
    ];
    let placedN = 0;
    for (const sp of spots) {
      if (blocked(sp.x, sp.z)) continue;
      const lx = sp.x - ox, lz = sp.z - oz;
      if (placedN === 0) {   // AC unit: grey body + dark grill stripe
        box(b.group, lx, h + 0.45, lz, 1.3, 0.9, 1.0, 0x9aa3ad, { cast: true });
        box(b.group, lx, h + 0.78, lz, 1.34, 0.18, 1.04, 0x3a3f46);
        solid(h, h + 0.9, sp.x - 0.65, sp.x + 0.65, sp.z - 0.5, sp.z + 0.5);
      } else {               // ducted vent: stack + hood
        box(b.group, lx, h + 0.55, lz, 0.7, 1.1, 0.7, 0x7c858f, { cast: true });
        box(b.group, lx, h + 1.2, lz, 1.0, 0.25, 1.0, 0x5a626c);
        solid(h, h + 1.3, sp.x - 0.35, sp.x + 0.35, sp.z - 0.35, sp.z + 0.35);
      }
      placedN++;
      if (placedN >= 2) break;
    }
  }

  function buildAll(A) {
    built = true;
    try {
      for (const lot of A.elevatorLots || []) { try { buildElevator(lot); } catch (e) { console.error("[elevator]", e); } }
      for (const lot of A.fireEscapeLots || []) { try { buildFireEscape(lot); } catch (e) { console.error("[fire escape]", e); } }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    } catch (e) { console.error("[elevators]", e); }
  }

  // ============================ THE RIDE ==================================
  // beats: open (you called it) → board → close → ride (hum/shake/ticker) →
  // doors open at the other end. The player is pinned + input-dead from the
  // close beat, so nothing on the street can ride along — the lift is the
  // clean getaway the penthouse price PAYS for.
  const T_OPEN = 0.55, T_BOARD = 0.5, T_CLOSE = 0.55;
  let ride = null;        // { el, up, phase, t }
  function rideTime(el) { return Math.min(2.6, 0.8 + el.b.storeys * 0.055); }

  function setLit(el, on) {
    el.btnG.material = on ? BTN_LIT() : BTN_IDLE();
    el.btnR.material = on ? BTN_LIT() : BTN_IDLE();
    el.lampG.material = on ? LAMP_LIT() : LAMP_IDLE();
    el.lampR.material = on ? LAMP_LIT() : LAMP_IDLE();
  }

  function startRide(el, up) {
    ride = { el, up, phase: "open", t: 0 };
    (up ? el.ground : el.roof).target = 1;
    setLit(el, true);
    if (CBZ.sfx) { CBZ.sfx("switch"); CBZ.sfx("door"); }
  }

  function endRide(arrived) {
    if (!ride) return;
    const el = ride.el;
    if (!arrived) { el.ground.target = 0; el.roof.target = 0; }
    setLit(el, false);
    ride = null;
  }

  // ---- the tiny prompt / floor-ticker chip (one DOM node, hidden when idle) --
  let chip = null;
  function dom() {
    if (chip || typeof document === "undefined" || !document.body) return;
    try {
      chip = document.createElement("div");
      chip.id = "elevChip";
      chip.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:248px;z-index:24;display:none;" +
        "padding:6px 12px;border-radius:9px;background:rgba(8,14,22,.78);border:1px solid rgba(130,180,255,.28);" +
        "color:#cfe6ff;font:600 13px/1.2 'Fredoka',system-ui,sans-serif;pointer-events:none;text-shadow:0 1px 2px #000";
      document.body.appendChild(chip);
    } catch (e) { chip = null; }
  }
  // PERF: callers run at frame rate (the ride ticker, the idle prompt) — skip
  // the DOM writes unless the text actually changed; setting the same
  // textContent/display every frame still dirties the DOM.
  let _chipLast;
  function chipText(t) {
    if (t === _chipLast) return;
    dom(); if (!chip) return;
    _chipLast = t;
    if (!t) { chip.style.display = "none"; return; }
    chip.style.display = "block"; chip.textContent = t;
  }

  function padNear() {
    const P = CBZ.player; if (!P) return null;
    for (const el of elevators) {
      const h = el.b.h;
      if (P.pos.y < 2.0 && Math.hypot(P.pos.x - el.groundPad.x, P.pos.z - el.groundPad.z) <= REACH) return { el, up: true };
      if (Math.abs(P.pos.y - h) < 1.6 && Math.hypot(P.pos.x - el.roofPad.x, P.pos.z - el.roofPad.z) <= REACH) return { el, up: false };
    }
    return null;
  }

  function animRig(r, dt) {
    if (r.autoClose != null) { r.autoClose -= dt; if (r.autoClose <= 0) { r.autoClose = null; r.target = 0; } }
    // PERF: doors at rest = leaves already sit at the pose — skip the per-leaf
    // position writes (this runs per rig per frame, almost always idle).
    if (r.open === r.target) return;
    const sp = 2.4 * dt;
    if (r.open < r.target) r.open = Math.min(r.target, r.open + sp);
    else r.open = Math.max(r.target, r.open - sp);
    for (const L of r.leaves) {
      L.m.position.x = L.baseX + L.sx * 0.62 * r.open;
      L.m.position.z = L.baseZ + L.sz * 0.62 * r.open;
    }
  }

  function teleport(x, y, z) {
    const P = CBZ.player;
    P.pos.set(x, y, z);
    P.vy = 0; P.grounded = true; P._fallPeak = 0;
    if (CBZ.playerChar) CBZ.playerChar.group.position.copy(P.pos);
  }

  let shakeT = 0, _promptT = 0;
  CBZ.onUpdate(36.6, function (dt) {
    if (g.mode !== "city") { if (ride) { endRide(false); chipText(null); } return; }
    if (!built) { const A = CBZ.city && CBZ.city.arena; if (A && A.lots) buildAll(A); if (!built) return; }

    // door animation (cheap: only moves while a target differs)
    for (const el of elevators) { animRig(el.ground, dt); animRig(el.roof, dt); }

    const P = CBZ.player;
    if (!ride) {
      // proximity prompt at ~12 Hz, not frame rate — padNear hypots every lift
      // pad, and the [E] handler re-checks reach on the actual press anyway.
      _promptT += dt;
      if (g.state === "playing" && P && !P.dead && !P.driving && !CBZ.cityMenuOpen) {
        if (_promptT >= 1 / 12) {
          _promptT = 0;
          const near = padNear();
          chipText(near ? (near.up ? "[E] Elevator — ride to the roof" : "[E] Elevator — ride down") : null);
        }
      } else chipText(null);
      return;
    }

    // ---- ride state machine ----
    const el = ride.el, b = el.b, h = b.h, ST = b.storeys;
    if (!P || P.dead || P.driving) { endRide(false); chipText(null); return; }
    ride.t += dt;
    const pad = ride.up ? el.groundPad : el.roofPad;
    const here = ride.up ? el.ground : el.roof;

    if (ride.phase === "open") {
      chipText("Elevator…");
      if (Math.hypot(P.pos.x - pad.x, P.pos.z - pad.z) > 3.4) { endRide(false); chipText(null); return; }   // walked away — doors give up
      if (ride.t >= T_OPEN) { ride.phase = "board"; ride.t = 0; }
    } else if (ride.phase === "board") {
      // ease the player into the car bay
      P.pos.x += (pad.x - P.pos.x) * Math.min(1, dt * 6);
      P.pos.z += (pad.z - P.pos.z) * Math.min(1, dt * 6);
      if (ride.t >= T_BOARD) { ride.phase = "close"; ride.t = 0; here.target = 0; if (CBZ.sfx) CBZ.sfx("door"); }
    } else if (ride.phase === "close") {
      P.stun = Math.max(P.stun || 0, 0.15);   // input-dead: you're IN the car
      P.pos.x = pad.x; P.pos.z = pad.z;
      if (CBZ.playerChar) CBZ.playerChar.group.position.copy(P.pos);   // we run after physics — keep the rig pinned too
      if (ride.t >= T_CLOSE) {
        ride.phase = "ride"; ride.t = 0;
        if (CBZ.sfx) CBZ.sfx("rumble");
        if (CBZ.shake) CBZ.shake(0.2);
      }
    } else if (ride.phase === "ride") {
      P.stun = Math.max(P.stun || 0, 0.15);
      P.pos.x = pad.x; P.pos.z = pad.z;
      if (CBZ.playerChar) CBZ.playerChar.group.position.copy(P.pos);
      const dur = rideTime(el), p = Math.min(1, ride.t / dur);
      const fl = ride.up ? Math.max(1, Math.round(1 + (ST - 1) * p)) : Math.max(1, Math.round(ST - (ST - 1) * p));
      chipText((ride.up ? "▲ " : "▼ ") + fl + "F");
      shakeT += dt;
      if (shakeT > 0.35) { shakeT = 0; if (CBZ.shake) CBZ.shake(0.05); }    // the car hums through your boots
      if (ride.t >= dur) {
        // ARRIVE: doors open at the other end and you step out on top (or back
        // in the lobby). Whoever was chasing you is still down there. The down
        // ride lands on the interior foundation slab (top ≈0.14), not street 0.
        const dest = ride.up ? el.roofPad : el.groundPad;
        const dy = ride.up ? h + 0.05 : ((CBZ.floorAt ? CBZ.floorAt(dest.x, dest.z) : 0.14) + 0.05);
        teleport(dest.x, dy, dest.z);
        const there = ride.up ? el.roof : el.ground;
        there.open = 0; there.target = 1; there.autoClose = 1.6;
        if (CBZ.sfx) CBZ.sfx("door");
        if (CBZ.shake) CBZ.shake(0.25);
        if (CBZ.city && CBZ.city.note) {
          CBZ.city.note(ride.up ? ("🛗 " + ST + " floors up — the roof is yours.") : "🛗 Ground floor.", 2);
        }
        chipText(null);
        endRide(true);
      }
    }
  });

  // [E] calls the lift. Registered on DOCUMENT (keydown bubbles body→document→
  // window) so stopPropagation keeps interact.js's window-level "[E] = eat"
  // fallback from firing on the same press — the lift wins when you're at it.
  function onKey(e) {
    if (!built || g.mode !== "city" || g.state !== "playing" || ride) return;
    if (CBZ.cityMenuOpen) return;
    const P = CBZ.player;
    if (!P || P.dead || P.driving) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    const near = padNear();
    if (!near) return;
    e.preventDefault();
    e.stopPropagation();
    startRide(near.el, near.up);
  }
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("keydown", onKey);

  // PUBLIC: the built lifts (minimap markers / missions can target a roof)
  CBZ.cityElevators = function () { return elevators; };
})();
