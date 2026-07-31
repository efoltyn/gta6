/* ============================================================
   city/elevators.js — VERTICAL ACCESS: elevators in the tallest
   towers + exterior fire-escape stairs on a few mid-rises.

   WHY: height is STATUS. The property ladder ends in a penthouse
   with a helipad, so getting UP has to feel like ARRIVING — you
   walk in through the building's DOOR, cross the lobby to the lift
   alcove on an interior wall, press [E] at the call panel, the
   doors slide open onto a REAL CAB — a small lit room you
   physically WALK INTO — the doors close behind you, the car hums
   and the floor ticker climbs, and the doors open at the other end
   onto a walkable roof with the whole city under you. You walk in;
   you walk out. The alcove lives INSIDE on purpose: a lift you
   board off the sidewalk reads like a prop, one you walk a lobby
   to reads like a building. Cops and peds have no shaft — the lift
   is a clean ESCAPE (the closed doors are a real collider, so
   nothing follows you in) — while the fire escapes are the LOUD
   way up: open stairs anyone can chase you on.
   Both rigs read the lot's door-face data first: the lobby alcove
   picks an interior wall clear of the door aisle / stair strip /
   counter stamps, and a fire escape never hangs on (or across the
   approach to) the facade that holds the entrance.

   The ride itself is still a ONE-FRAME relocation — but it happens
   mid-ride inside the SEALED cab (two identical rooms, one at each
   end; you can't see out, so the swap is invisible) instead of the
   old "stand outside, watch the doors beat, get teleported" — zero
   per-frame cost when idle. Geometry is draw-call-cheap: ONE shared
   unit box geo scaled per mesh + the city's cached shared materials
   (CBZ.cmat), colliders/platforms registered once at build with a
   single markCollidersDirty (the door leaf collider is toggled by
   mutating its y-gate, which the xz broadphase never re-indexes —
   no rebuild churn per ride). Which lots rate a lift / an escape is
   decided by buildings.js (city.elevatorLots / city.fireEscapeLots)
   so the lot policy stays with the lots; this file owns the rigs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  const FH = 3.2;                 // floor-to-floor (mirrors buildings.js metre contract)
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
  const CABWALL = 0x4a525c, CABFLOOR = 0x59616c;

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
    // the mega-tower EXECUTIVE FLOOR (city/exec_office.js) stamps world-space
    // keep-clear anchors (desk / meeting table / reception / express core) —
    // the carved shaft column runs the full tower height through every floor,
    // so the strict pass steers it into the suite's furniture-free wall slots.
    if (b.execOffice && b.execOffice.keepClear) for (const c of b.execOffice.keepClear) a.push({ x: c.x, z: c.z, r: c.r || 2.0 });
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
  // a cramped room still gets its lift rather than none. The sampled
  // footprint covers the FULL cab room (~2.2 deep into the lobby) plus the
  // boarding apron in front of the leafs.
  // ---- cab SIZE variants. The standard cab is the AAA walk-in room; the
  // COMPACT cab is a tighter shaft (~1.4m interior) so narrow / small towers
  // that can't seat the wide room still get a real lift instead of none.
  // `half` is the lateral half-width used by both the wall search (pickLobby)
  // and the geometry (buildElevator), so the two never disagree.
  const CAB_STD = { half: 1.45, iw: 2.06, dep: 2.2, gdoor: 2.0, dhw: 0.78, leafHW: 0.76, side: 1.04, frameLat: 1.02, hw: 1.3, hd: 1.25 };
  const CAB_CMP = { half: 0.92, iw: 1.42, dep: 1.85, gdoor: 1.7, dhw: 0.56, leafHW: 0.54, side: 0.74, frameLat: 0.72, hw: 0.92, hd: 0.9 };

  function pickLobby(b) {
    const w = b.w, d = b.d, S = slabInfo(b), ds = doorSideOf(b);
    const avoid = interiorAvoids(b);
    const faces = [];
    for (const c of [3, 0, 1]) if (c !== ds && c !== OPP[ds]) faces.push(c);
    if (!b.hasStairs && ds !== 2 && OPP[ds] !== 2) faces.push(2);
    if (OPP[ds] !== 2 || !b.hasStairs) faces.push(OPP[ds]);   // back wall: last resort
    function tryFace(side, strict, V) {
      const f = faceInfo(side, w, d);
      const CABHALF = V.half;                                 // cab room half-width + a touch of margin (variant-driven)
      // The walkable LATERAL band on this face, in face-tangent coords centred
      // on the building origin. On ±z faces `lat` is an X offset, so on a stair
      // building it MUST stay on the SOLID slab (x ≥ slabMinX) — the old
      // symmetric `±(span/2-4.4)` clamp could never reach the solid half on a
      // narrow tower, which is why only the wide mega-tower ever seated a lift.
      // On ±x faces `lat` is a Z offset bounded by the slab depth. We derive the
      // real [latLo, latHi] from the slab so an arbitrary qualifying building
      // gets a valid slot, then bias the search toward the slab centre.
      let latLo, latHi;
      if (side === 0 || side === 1) {                         // lat == X
        const xLo = (b.hasStairs ? S.slabMinX : -w / 2 + S.wt);
        const xHi = S.ixMax;
        latLo = xLo + CABHALF; latHi = xHi - CABHALF;
      } else {                                                // lat == Z
        latLo = S.izMin + CABHALF; latHi = S.izMax - CABHALF;
      }
      if (latHi < latLo) { const mid = (latLo + latHi) / 2; latLo = latHi = mid; }
      const latMid = (latLo + latHi) / 2;
      // candidate offsets: the slab-centre first (always valid), then a spread
      // toward both edges. The mega-tower deck holds the alcove beside the
      // central drive-in bay so the hangar roll-out lane stays open.
      let slots;
      if (b.hangar) {
        slots = [f.span * 0.30, -f.span * 0.30, f.span * 0.38, -f.span * 0.38];
      } else {
        slots = [latMid, latMid + 1.2, latMid - 1.2, latMid + 2.4, latMid - 2.4, latMid + 3.4, latMid - 3.4];
      }
      const hl = V.half - 0.1;                                // footprint lateral half (cab + a hair)
      const apron = V.dep + 0.5;                              // boarding apron just past the leafs
      for (let lat of slots) {
        lat = Math.max(latLo, Math.min(latHi, lat));
        // cab-room footprint (side walls reach dep ~V.dep) + the boarding apron
        const pts = [[-hl, 0.45], [hl, 0.45], [0, 0.7], [-hl, V.dep - 0.7], [hl, V.dep - 0.7], [-hl + 0.15, V.dep], [hl - 0.15, V.dep], [0, V.dep - 0.2], [0, apron]];
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
        if (ok) return { f, lat, V };
      }
      return null;
    }
    // try the STANDARD walk-in cab first (strict avoids, then relaxed), then
    // fall back to the COMPACT cab — a tight tower still gets a working lift.
    for (const V of [CAB_STD, CAB_CMP]) {
      for (const side of faces) { const r = tryFace(side, true, V); if (r) return r; }
      for (const side of faces) { const r = tryFace(side, false, V); if (r) return r; }
    }
    return null;
  }

  // ============================ ELEVATOR =================================
  // Ground lobby CAB on an INTERIOR wall — a real walk-in room (~2.2 wide ×
  // 2.45 tall × ~2.0 deep inside): back panel against the building wall, two
  // solid side walls, ceiling with a lit panel, its own floor slab, and the
  // two sliding steel leafs as the fourth side. Plus the door frame (cheeks +
  // header), a call panel with a glowing button on the frame, and a hall
  // lantern that lights while the car runs. On the roof a matching HOLLOW
  // headhouse cab runs the same machine downward. The closed leafs are a real
  // (y-gated) collider — the cab seals, so the mid-ride relocation is
  // invisible and nothing on the street can ride along.
  const CAB_H = 2.45;          // cab interior height
  const DOOR_HW = 0.78;        // door opening half-width (collider span)
  function buildElevator(lot) {
    const b = lot.building, w = b.w, d = b.d, grp = b.group, ox = b.ox, oz = b.oz, h = b.h;
    const S = slabInfo(b);
    const spot = pickLobby(b);
    if (!spot) { console.warn("[elevator] no clear interior wall on", b.name || "lot"); return; }
    const f = spot.f, off = spot.lat;
    const V = spot.V || CAB_STD;                        // cab size variant chosen by pickLobby
    const IW = V.iw, SIDE = V.side, FRAMELAT = V.frameLat, DHW = V.dhw, LEAFHW = V.leafHW;
    const LEAFOFF = LEAFHW / 2 + 0.01;                  // each leaf's parked centre offset
    const LEAFTRAV = LEAFHW * 0.82;                     // open travel per leaf
    // dep measures INWARD from the interior wall face (f.px/f.pz sit on the
    // outer plane; S.wt steps through the wall), so the whole cab room —
    // walls, leafs, frame, boarding apron — builds into the lobby.
    const P = (lat, dep) => ({ x: f.px - f.nx * (S.wt + dep) + f.tx * (off + lat), z: f.pz - f.nz * (S.wt + dep) + f.tz * (off + lat) });
    const tn = (t, n) => (f.tx ? { w: t, d: n } : { w: n, d: t });
    const GDOOR = V.gdoor;                              // ground-cab door plane (dep from the wall, variant-scaled)
    const CABDEP = V.dep;                               // cab interior depth (side-wall length)

    function solidAt(p, sz, y0, y1, ref) {
      return solid(y0, y1, ox + p.x - sz.w / 2, ox + p.x + sz.w / 2, oz + p.z - sz.d / 2, oz + p.z + sz.d / 2, ref);
    }

    const CD = CABDEP / 2;                              // cab depth half (centre of side walls / floor / ceiling)
    // ---- the CAB ROOM (ground end) ----------------------------------------
    { // back panel (the building wall is the structure; this is the cab skin)
      const p = P(0, 0.08), sz = tn(IW, 0.12);
      box(grp, p.x, 1.25, p.z, sz.w, CAB_H, sz.d, CABWALL);
    }
    for (const s of [-1, 1]) {  // side walls (solid: the cab is a sealed room)
      const p = P(s * SIDE, CD + 0.02), sz = tn(0.16, CABDEP);
      const m = box(grp, p.x, CAB_H / 2, p.z, sz.w, CAB_H, sz.d, STEEL, { cast: true });
      solidAt(p, sz, 0, CAB_H, m);
    }
    { // ceiling + the small lit light panel
      const p = P(0, CD + 0.02), sz = tn(IW + 0.18, CABDEP + 0.2);
      box(grp, p.x, CAB_H + 0.11, p.z, sz.w, 0.12, sz.d, STEEL);
      const lp = P(0, CD + 0.02), ls = tn(Math.min(0.95, IW * 0.46), Math.min(0.95, CABDEP * 0.43));
      box(grp, lp.x, CAB_H - 0.03, lp.z, ls.w, 0.07, ls.d, 0xe8ddc2, { emissive: 0xfff1cd, ei: 0.95 });
    }
    { // cab floor slab (its top is the EXACT ground-end arrival height)
      const p = P(0, CD + 0.07), sz = tn(IW, CABDEP + 0.2);
      box(grp, p.x, 0.08, p.z, sz.w, 0.16, sz.d, CABFLOOR);
      plat(ox + p.x - sz.w / 2, ox + p.x + sz.w / 2, oz + p.z - sz.d / 2, oz + p.z + sz.d / 2, 0.16);
    }
    // door frame: cheeks (solid) + header over the opening
    for (const s of [-1, 1]) {
      const p = P(s * FRAMELAT, GDOOR + 0.04), sz = tn(0.6, 0.55);
      const m = box(grp, p.x, 1.6, p.z, sz.w, 3.2, sz.d, STEEL, { cast: true });
      solidAt(p, sz, 0, 3.2, m);
    }
    { // header (solid — a jump can put a head in it)
      const p = P(0, GDOOR + 0.04), sz = tn(IW + 0.58, 0.55);
      const m = box(grp, p.x, 2.82, p.z, sz.w, 0.84, sz.d, STEEL, { cast: true });
      solidAt(p, sz, 2.4, 3.24, m);
    }
    // NO dark reveal strip here: the leafs ARE the closed door, and behind
    // them sits the REAL lit cab room (back panel, side walls, lit ceiling,
    // floor slab). When the leafs slide open the lobby frames the actual cab
    // interior — exactly like an opened building door reveals the real room —
    // instead of a black void backing that occluded it (the filmed bug).
    // the two sliding leafs + the door COLLIDER (one persistent y-gated box —
    // toggled by mutating y0/y1, which the xz broadphase never re-indexes)
    const ground = { leaves: [], open: 0, target: 0, autoClose: null, trav: LEAFTRAV };
    for (const s of [-1, 1]) {
      const p = P(s * LEAFOFF, GDOOR), sz = tn(LEAFHW, 0.1);
      const m = box(grp, p.x, 1.27, p.z, sz.w, 2.45, sz.d, LEAF);
      ground.leaves.push({ m, baseX: p.x, baseZ: p.z, sx: f.tx * s, sz: f.tz * s });
    }
    {
      const pA = P(-DHW, GDOOR - 0.07), pB = P(DHW, GDOOR + 0.07);
      ground.col = solid(0, 2.4,
        ox + Math.min(pA.x, pB.x), ox + Math.max(pA.x, pB.x),
        oz + Math.min(pA.z, pB.z), oz + Math.max(pA.z, pB.z));
      ground.cy0 = 0; ground.cy1 = 2.4; ground.solid = true;
    }
    // call panel + button on the door frame + hall lantern over the opening
    { const p = P(FRAMELAT, GDOOR + 0.36), sz = tn(0.3, 0.08); box(grp, p.x, 1.32, p.z, sz.w, 0.55, sz.d, 0x232830); }
    const pb = P(FRAMELAT, GDOOR + 0.42), pbs = tn(0.12, 0.05);
    const btnG = box(grp, pb.x, 1.42, pb.z, pbs.w, 0.12, pbs.d, 0x35d07a, { emissive: 0x16a04a, ei: 0.7 });
    const pl = P(0, GDOOR + 0.34), pls = tn(0.7, 0.07);
    const lampG = box(grp, pl.x, 3.05, pl.z, pls.w, 0.2, pls.d, 0x3a3f46, { emissive: 0x10131a, ei: 0.3 });
    const padP = P(0, V.dep + 0.5);
    const groundPad = { x: ox + padP.x, z: oz + padP.z };

    // ---- roof HEADHOUSE CAB — built in the SAME lobby-local frame (P/tn) as
    //      the ground cab, just raised to the roof line (h). That makes the two
    //      ends a TRUE VERTICAL COLUMN (one directly above the other) instead of
    //      the old free-floating corner box, so a real ENCLOSED SHAFT can rise
    //      straight up between them and the whole thing reads as a lift that
    //      actually travels somewhere. Door faces the same outward way (into the
    //      open roof). HOLLOW: walls + cap + lit ceiling + floor slab + leafs.
    const RDOOR = GDOOR;                               // roof door plane == ground (identical cab)
    const RBASE = h;                                   // roof cab Y offset
    { // back skin against the building wall
      const p = P(0, 0.08), sz = tn(IW, 0.12);
      box(grp, p.x, RBASE + 1.25, p.z, sz.w, CAB_H, sz.d, CABWALL);
    }
    for (const s of [-1, 1]) {  // side walls (solid)
      const p = P(s * SIDE, CD + 0.02), sz = tn(0.16, CABDEP);
      const m = box(grp, p.x, RBASE + CAB_H / 2, p.z, sz.w, CAB_H, sz.d, STEEL, { cast: true });
      solid(RBASE, RBASE + CAB_H, ox + p.x - sz.w / 2, ox + p.x + sz.w / 2, oz + p.z - sz.d / 2, oz + p.z + sz.d / 2, m);
    }
    { // cap + lit ceiling panel
      const p = P(0, CD + 0.02), sz = tn(IW + 0.18, CABDEP + 0.2);
      box(grp, p.x, RBASE + CAB_H + 0.13, p.z, sz.w + 0.4, 0.14, sz.d + 0.4, 0x474f59);
      const ls = tn(Math.min(0.95, IW * 0.46), Math.min(0.95, CABDEP * 0.43));
      box(grp, p.x, RBASE + CAB_H - 0.05, p.z, ls.w, 0.07, ls.d, 0xe8ddc2, { emissive: 0xfff1cd, ei: 0.95 });
    }
    { // cab floor slab on the roof (its top is the EXACT roof arrival height = RBASE+0.16)
      const p = P(0, CD + 0.07), sz = tn(IW, CABDEP + 0.2);
      box(grp, p.x, RBASE + 0.08, p.z, sz.w, 0.16, sz.d, CABFLOOR);
      plat(ox + p.x - sz.w / 2, ox + p.x + sz.w / 2, oz + p.z - sz.d / 2, oz + p.z + sz.d / 2, RBASE + 0.16);
    }
    // door frame: cheeks (solid) + header
    for (const s of [-1, 1]) {
      const p = P(s * FRAMELAT, RDOOR + 0.04), sz = tn(0.6, 0.55);
      const m = box(grp, p.x, RBASE + 1.6, p.z, sz.w, 3.2, sz.d, STEEL, { cast: true });
      solid(RBASE, RBASE + 3.2, ox + p.x - sz.w / 2, ox + p.x + sz.w / 2, oz + p.z - sz.d / 2, oz + p.z + sz.d / 2, m);
    }
    { const p = P(0, RDOOR + 0.04), sz = tn(IW + 0.58, 0.55);
      const m = box(grp, p.x, RBASE + 2.82, p.z, sz.w, 0.84, sz.d, STEEL, { cast: true });
      solid(RBASE + 2.4, RBASE + 3.24, ox + p.x - sz.w / 2, ox + p.x + sz.w / 2, oz + p.z - sz.d / 2, oz + p.z + sz.d / 2, m);
    }
    const roof = { leaves: [], open: 0, target: 0, autoClose: null, trav: LEAFTRAV };
    for (const s of [-1, 1]) {
      const p = P(s * LEAFOFF, RDOOR), sz = tn(LEAFHW, 0.1);
      const m = box(grp, p.x, RBASE + 1.27, p.z, sz.w, 2.45, sz.d, LEAF);
      roof.leaves.push({ m, baseX: p.x, baseZ: p.z, sx: f.tx * s, sz: f.tz * s });
    }
    {
      const pA = P(-DHW, RDOOR - 0.07), pB = P(DHW, RDOOR + 0.07);
      roof.col = solid(RBASE, RBASE + 2.4,
        ox + Math.min(pA.x, pB.x), ox + Math.max(pA.x, pB.x),
        oz + Math.min(pA.z, pB.z), oz + Math.max(pA.z, pB.z));
      roof.cy0 = RBASE; roof.cy1 = RBASE + 2.4; roof.solid = true;
    }
    { const p = P(FRAMELAT, RDOOR + 0.36), sz = tn(0.3, 0.08); box(grp, p.x, RBASE + 1.32, p.z, sz.w, 0.55, sz.d, 0x232830); }
    const pbR = P(FRAMELAT, RDOOR + 0.42), pbRs = tn(0.12, 0.05);
    const btnR = box(grp, pbR.x, RBASE + 1.42, pbR.z, pbRs.w, 0.12, pbRs.d, 0x35d07a, { emissive: 0x16a04a, ei: 0.7 });
    const plR = P(0, RDOOR + 0.34), plRs = tn(0.7, 0.07);
    const lampR = box(grp, plR.x, RBASE + 3.05, plR.z, plRs.w, 0.2, plRs.d, 0x3a3f46, { emissive: 0x10131a, ei: 0.3 });
    const padPR = P(0, V.dep + 0.5);
    const roofPad = { x: ox + padPR.x, z: oz + padPR.z };

    // ---- THE ENCLOSED SHAFT: opaque thin steel panels on the NON-door sides
    //      (back + both sides) rising the full column from the ground cab to the
    //      roof headhouse, PLUS a solid front (door-side) spandrel between the
    //      two landing openings — so from anywhere in the building the lift reads
    //      as a sealed vertical column with a door at the bottom and the top, not
    //      a box with a ceiling. Mid-ride the sealed cab relocates between the two
    //      identical ends INSIDE this opaque column, so the swap is invisible from
    //      every angle. Cheap: ~5 thin boxes on shared cached mats, no colliders
    //      beyond the cab/door ones already registered (the building wall + the
    //      cab side walls already stop you; the shaft skin is a visual enclosure).
    const SHAFT_TOP = h;                               // shaft rises to the roof-cab floor line
    { // back skin (against the building's own interior wall — full height)
      const p = P(0, 0.04), sz = tn(IW + 0.14, 0.08);
      box(grp, p.x, SHAFT_TOP / 2 + 0.1, p.z, sz.w, SHAFT_TOP + 0.2, sz.d, SHAFT);
    }
    for (const s of [-1, 1]) { // side skins (full height, just outside the cab side walls)
      const p = P(s * (SIDE + 0.09), CD + 0.09), sz = tn(0.1, CABDEP + 0.32);
      box(grp, p.x, SHAFT_TOP / 2 + 0.1, p.z, sz.w, SHAFT_TOP + 0.2, sz.d, SHAFT);
    }
    { // FRONT spandrel (door side): solid from above the ground door header up to
      // the roof door sill — leaves the ground opening (0..3.24) and the roof
      // opening (h..) clear so you can walk in/out at both ends.
      const p = P(0, RDOOR + 0.12), sz = tn(IW + 0.58, 0.08);
      const segBot = 3.24, segTop = SHAFT_TOP;          // between the two door frames
      if (segTop - segBot > 0.1)
        box(grp, p.x, (segBot + segTop) / 2, p.z, sz.w, segTop - segBot, sz.d, SHAFT);
    }
    { // a thin ceiling cap over the whole column, just under the roof cab floor,
      // so looking up the shaft from the lobby ends on the cab, not open sky.
      const p = P(0, CD + 0.07), sz = tn(IW + 0.44, CABDEP + 0.5);
      box(grp, p.x, SHAFT_TOP - 0.12, p.z, sz.w, 0.1, sz.d, 0x20262e);
    }
    // CARVE the chase: drop a clean hole through every intermediate floor slab
    // the column crosses so the cab travels a continuous shaft (building owns the
    // slabs → buildings.js does the carve; also reserves the footprint so no
    // later furniture/prop lands in the chase).
    if (CBZ.cityCarveShaft) {
      const cCol = P(0, CD + 0.07);                      // column centre (cab footprint)
      const hwT = f.tx ? V.hw : V.hd, hdT = f.tx ? V.hd : V.hw;
      CBZ.cityCarveShaft(b, ox + cCol.x, oz + cCol.z, hwT, hdT);
    }

    addParapets(lot, null);
    // ---- per-end local frames: lat (across the door) / dep (from the back
    //      wall toward the door plane). The two cabs are now built in the SAME
    //      lobby frame (f/P), so the roof end reuses the ground frame verbatim —
    //      walk-in detection, doorway hold and the mid-ride relocation all share
    //      one transform, the cleanest possible expression of "the same cab, one
    //      floor up".
    const gBase = P(0, 0);
    const gbx = ox + gBase.x, gbz = oz + gBase.z;
    const gLoc = (x, z) => ({ lat: (x - gbx) * f.tx + (z - gbz) * f.tz, dep: -((x - gbx) * f.nx + (z - gbz) * f.nz) });
    const gPt = (lat, dep) => ({ x: gbx - f.nx * dep + f.tx * lat, z: gbz - f.nz * dep + f.tz * lat });
    const rLoc = gLoc;                                 // identical frame, one column up
    const rPt = gPt;

    // STOP LIST — the floor numbers the ticker counts THROUGH. If buildings.js
    // has stamped b.floorTops (one arrival Y per storey, ground→roof), we read
    // its LENGTH so the ride ticker shows the true storey count even on lifts
    // whose b.storeys differs. The PHYSICAL relocation is always ground↔roof:
    // those are the only two ends with a real sealed cab room (floor slab +
    // walls + leafs). Stamping intermediate arrival heights without a cab room
    // there would drop a rider into the open carved shaft — unsafe to ship
    // untested — so the machine stays binary while the readout reflects reality.
    const ftops = Array.isArray(b.floorTops) && b.floorTops.length >= 2 ? b.floorTops : null;
    const topFloor = ftops ? ftops.length : Math.max(2, b.storeys || 2);

    const rec = {
      lot, b, ground, roof, groundPad, roofPad, btnG, btnR, lampG, lampR,
      gLoc, gPt, rLoc, rPt,
      gDoor: GDOOR, rDoor: RDOOR,                     // door-plane dep per end (identical)
      gFloor: 0.16, rFloor: h + 0.16,                 // EXACT cab-floor tops (the slab we built at each end; never re-derived via floorAt)
      topFloor,                                       // roof floor number (ticker top)
      m: { st: "idle", end: null, t: 0, will: false, moved: false, cool: 0 },
    };
    lot.building.lift = { ground: groundPad, roof: { x: roofPad.x, y: h, z: roofPad.z }, floors: topFloor };
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

  // FACADE PICK for the escape (returns ±1 = the +x / -x face, or 0 if none).
  // HARD ENGINE CONSTRAINT: the climb is z-axis RAMP platforms and physics.js
  // interpolates ramp height ONLY along z (t = (z-z0)/(z1-z0)). An escape on a
  // ±z face would run its slope along x where ramps DON'T interpolate — you'd
  // hit a vertical wall, not a stair. So a real fire escape can only hang on a
  // ±x face here; "rear/side, away from the door" therefore means the ±x face
  // FARTHEST from the door/display face (b.side), never the door face itself.
  // buildings.js (AGENT BUILD) stamps the chosen face on the lot; we HONOR a
  // valid stamp and otherwise DERIVE the correct rear face, so a missing/stale
  // stamp never strands the rig on the glass front. The -x face is off-limits
  // on stair buildings (its slab gap is the open interior stairwell — a bridge
  // there drops you down it).
  function escapeFaceSign(stamp) {
    // accept either a face index (2:-x, 3:+x) or a raw sign (±1)
    if (stamp === 2 || stamp === -1) return -1;
    if (stamp === 3 || stamp === 1) return 1;
    return 0;
  }
  function pickEscapeFace(b) {
    const ds = doorSideOf(b);
    // candidate ±x faces, ordered so the REAR (away from the door) wins:
    //   door on +x(3) → prefer -x ; door on -x(2) → prefer +x ;
    //   door on ±z     → +x first (the alley side on most lots), then -x.
    let order;
    if (ds === 3) order = [-1, 1];
    else if (ds === 2) order = [1, -1];
    else order = [1, -1];
    // honor a valid stamp first by floating it to the front of the order
    const stamped = escapeFaceSign(b.feSide != null ? b.feSide
      : (b.fireEscapeSide != null ? b.fireEscapeSide : null));
    if (stamped) order = [stamped].concat(order.filter((m) => m !== stamped));
    for (const m of order) {
      if (m < 0 && b.hasStairs) continue;            // -x is the open stairwell on stair buildings
      if ((m > 0 ? 3 : 2) === ds) continue;          // never the door/display face
      if (flightCrossesDoor(b, m)) continue;         // never across the door walk-up
      return m;
    }
    return 0;
  }

  function buildFireEscape(lot) {
    const b = lot.building, w = b.w, d = b.d, grp = b.group, ox = b.ox, oz = b.oz, h = b.h;
    // facade pick: the REAR ±x face away from the door (see pickEscapeFace).
    // If every valid facade hosts the door / crosses its walk-up, the lot
    // simply goes unserved — a clear doorway beats a fourth escape route.
    const m = pickEscapeFace(b);
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

  function buildAll(A) {
    built = true;
    try {
      for (const lot of A.elevatorLots || []) { try { buildElevator(lot); } catch (e) { console.error("[elevator]", e); } }
      for (const lot of A.fireEscapeLots || []) { try { buildFireEscape(lot); } catch (e) { console.error("[fire escape]", e); } }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    } catch (e) { console.error("[elevators]", e); }
  }

  // ============================ THE RIDE ==================================
  // Per-lift state machine — you WALK the whole thing, the game never grabs
  // your legs:
  //   IDLE  → [E] at a call panel → OPEN (doors slide; held ~4s, and they
  //   WAIT while anyone stands in the doorway — no crush)
  //   OPEN  → you WALK INTO the cab (detected inside the cab volume) → CLOSE
  //           ([E] inside also closes early; step back out before they shut
  //           and the call cancels — no ride)
  //   CLOSE → leafs fully shut (the door collider seals: cops/peds locked
  //           out, you locked in) → RIDE
  //   RIDE  → free-standing in the sealed cab; hum + shake pulses + the
  //           floor ticker, 2.5–4s scaled by storeys. Halfway through, the
  //           player is relocated to the IDENTICAL cab at the other end in
  //           ONE frame, keeping their relative spot inside the room — the
  //           cab has no windows, so the swap can't be seen
  //   ARRIVE→ doors open at the destination → you WALK OUT → doors close,
  //           short cooldown (so a mashed [E] can't instantly ride you back
  //           — the OLD bug: arrival spot == the return call pad with zero
  //           cooldown, so buffered presses re-rode you to where you started)
  const WAIT_OPEN = 4.0;        // doors hold open for a boarder
  const EXIT_WAIT = 8.0;        // arrival doors hold while you step out
  const CALL_COOL = 0.8;        // post-ride cooldown before the panel re-arms
  function rideTime(el) { return Math.max(3.0, Math.min(6.0, 2.0 + el.topFloor * 0.18)); }
  // ACCEL/DECEL weight envelope: 0 at the ends, ~1 at cruise, with a quick
  // ease-in and a longer ease-out so the cab feels like it leans into the climb
  // then settles. Drives the shake magnitude so the camera bobs with momentum.
  function rideEnvelope(p) {
    const aIn = 0.22, aOut = 0.30;          // ramp-up / ramp-down fractions of the ride
    if (p < aIn) { const x = p / aIn; return x * x * (3 - 2 * x); }            // smoothstep in
    if (p > 1 - aOut) { const x = (1 - p) / aOut; return x * x * (3 - 2 * x); } // smoothstep out
    return 1;
  }

  function setLit(el, on) {
    el.btnG.material = on ? BTN_LIT() : BTN_IDLE();
    el.btnR.material = on ? BTN_LIT() : BTN_IDLE();
    el.lampG.material = on ? LAMP_LIT() : LAMP_IDLE();
    el.lampR.material = on ? LAMP_LIT() : LAMP_IDLE();
  }

  function rigOf(el, end) { return end === "g" ? el.ground : el.roof; }
  // is the player INSIDE the cab room at this end (xz volume + the floor's y band)?
  function insideCab(el, end, P) {
    if (!P) return false;
    if (end === "g") { if (P.pos.y > 2.2) return false; }
    else if (Math.abs(P.pos.y - el.b.h) > 2.2) return false;
    const L = (end === "g" ? el.gLoc : el.rLoc)(P.pos.x, P.pos.z);
    const door = end === "g" ? el.gDoor : el.rDoor;
    return L.dep > 0.18 && L.dep < door - 0.15 && Math.abs(L.lat) < 0.9;
  }
  // is the player standing IN the doorway (the leaf line) — doors must wait.
  // EXCLUDES the cab interior: a boarded rider near the front of the cab is a
  // RIDER, not an obstruction (otherwise the doors could never close on them).
  function inDoorway(el, end, P) {
    if (!P) return false;
    if (end === "g") { if (P.pos.y > 2.2) return false; }
    else if (Math.abs(P.pos.y - el.b.h) > 2.2) return false;
    if (insideCab(el, end, P)) return false;
    const L = (end === "g" ? el.gLoc : el.rLoc)(P.pos.x, P.pos.z);
    const door = end === "g" ? el.gDoor : el.rDoor;
    return Math.abs(L.lat) < 0.95 && L.dep > door - 0.45 && L.dep < door + 0.55;
  }

  function callLift(el, end) {
    const m = el.m;
    m.st = "open"; m.end = end; m.t = 0; m.will = false; m.moved = false;
    rigOf(el, end).target = 1;
    setLit(el, true);
    if (CBZ.sfx) { CBZ.sfx("switch"); CBZ.sfx("door"); }
  }

  function beginClose(el) {
    const m = el.m;
    m.st = "close"; m.t = 0; m.will = true;
    rigOf(el, m.end).target = 0;
    if (CBZ.sfx) CBZ.sfx("door");
  }

  function resetMachine(el, cool) {
    const m = el.m;
    m.st = "idle"; m.end = null; m.t = 0; m.will = false; m.moved = false;
    if (cool) m.cool = cool;
    setLit(el, false);
  }

  // hard snap a rig shut (mode exit / mid-ride abort): leaves home, collider solid
  function closeNow(r) {
    r.open = 0; r.target = 0; r.autoClose = null;
    for (const L of r.leaves) { L.m.position.x = L.baseX; L.m.position.z = L.baseZ; }
    gateDoor(r);
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
      if (el.m.st !== "idle" || el.m.cool > 0) continue;   // busy / just arrived: panel re-arms after the cooldown
      const h = el.b.h;
      if (P.pos.y < 2.0 && Math.hypot(P.pos.x - el.groundPad.x, P.pos.z - el.groundPad.z) <= REACH) return { el, end: "g" };
      if (Math.abs(P.pos.y - h) < 1.6 && Math.hypot(P.pos.x - el.roofPad.x, P.pos.z - el.roofPad.z) <= REACH) return { el, end: "r" };
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
    const tv = r.trav || 0.62;
    for (const L of r.leaves) {
      L.m.position.x = L.baseX + L.sx * tv * r.open;
      L.m.position.z = L.baseZ + L.sz * tv * r.open;
    }
  }

  // door leaf collider tracks the leaves: SOLID until they're ~quarter open.
  // Toggled by mutating the y-gate (parked at +1e9 = "above everyone" when
  // passable) — the broadphase only indexes xz, so this never rebuilds.
  // NOTE: collide() callers that omit feetY/headY treat every y-gated box as
  // full-height — i.e. the leaf line stays solid for them even when open.
  // That's the ped gate for free: simple crowd/ped pushers never wander in.
  function gateDoor(r) {
    const c = r.col; if (!c) return;
    const want = r.open < 0.25;
    if (want === r.solid) return;
    r.solid = want;
    if (want) { c.y0 = r.cy0; c.y1 = r.cy1; }
    else { c.y0 = 1e9; c.y1 = 1e9 + 1; }
  }

  function teleport(x, y, z) {
    const P = CBZ.player;
    P.pos.set(x, y, z);
    P.vy = 0; P.grounded = true; P._fallPeak = 0;
    if (CBZ.playerChar) CBZ.playerChar.group.position.copy(P.pos);
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // step one lift's machine; returns the chip text it wants (or undefined)
  let shakeT = 0, humT = 0;
  function stepMachine(el, dt, P) {
    const m = el.m;
    if (m.cool > 0) m.cool -= dt;
    if (m.st === "idle") return undefined;
    // player gone (died / got in a car): let the cab go back to idle —
    // doors open with an auto-close so nobody's corpse is sealed in a box.
    if (!P || P.dead || P.driving) {
      const r = rigOf(el, m.end);
      r.target = 1; r.autoClose = 2.0;
      resetMachine(el, CALL_COOL);
      return null;
    }
    m.t += dt;
    const r = rigOf(el, m.end);

    if (m.st === "open") {
      // boarded? (only once the doors are wide enough that they really walked in)
      if (r.open > 0.7 && insideCab(el, m.end, P)) { beginClose(el); return "Doors closing…"; }
      if (m.t >= WAIT_OPEN) {
        if (inDoorway(el, m.end, P)) { m.t = WAIT_OPEN - 0.6; return "Elevator — step in"; }  // doors WAIT, no crush
        r.target = 0; m.st = "close"; m.will = false;        // nobody came: close back to idle
        setLit(el, false);
      }
      return insideCab(el, m.end, P) ? "Doors closing…" : "Elevator — step in ([E] closes the doors)";
    }

    if (m.st === "close") {
      if (inDoorway(el, m.end, P)) {                          // someone in the leaf line: reopen
        r.target = 1; m.st = "open"; m.t = WAIT_OPEN - 1.4;
        if (m.will) m.will = false;
        setLit(el, true);
        return "Elevator — step in";
      }
      if (m.will && !insideCab(el, m.end, P)) {               // stepped back out: cancel the ride
        m.will = false; setLit(el, false);
      }
      if (r.open <= 0) {
        gateDoor(r);                                          // sealed
        if (m.will) {
          m.st = "ride"; m.t = 0; m.moved = false;
          humT = 0; shakeT = 0;
          if (CBZ.sfx) CBZ.sfx("rumble");
          if (CBZ.shake) CBZ.shake(0.2);
        } else {
          resetMachine(el, 0);
        }
      }
      return m.will ? "Doors closing…" : null;
    }

    if (m.st === "ride") {
      const up = m.moved ? m.end === "r" : m.end === "g";     // direction reads the same before/after the swap
      const dur = rideTime(el), p = Math.min(1, m.t / dur), ST = el.topFloor;
      // ACCEL/DECEL: a weight envelope drives the camera bob — the cab leans
      // into the climb, holds at cruise, then settles. The hum pulse follows
      // the same envelope so the car sounds like it's working then easing off.
      const env = rideEnvelope(p);
      shakeT += dt;
      if (shakeT > 0.32) { shakeT = 0; if (CBZ.shake) CBZ.shake(0.025 + 0.075 * env); }
      humT += dt;
      if (humT > (1.4 - 0.5 * env) && CBZ.sfx) { humT = 0; CBZ.sfx("rumble"); }
      if (!m.moved && m.t >= dur * 0.5) {
        // THE SWAP — one frame, inside the sealed cab: carry the player's
        // relative spot in the room over to the identical cab at the other
        // end (clamped well inside its walls), feet on that cab's OWN floor
        // slab top. No floorAt guesswork: the destination height is the slab
        // we built, so the ride can never resolve back to the origin floor.
        const from = m.end, to = from === "g" ? "r" : "g";
        const L = (from === "g" ? el.gLoc : el.rLoc)(P.pos.x, P.pos.z);
        const door = to === "g" ? el.gDoor : el.rDoor;
        const pt = (to === "g" ? el.gPt : el.rPt)(clamp(L.lat, -0.7, 0.7), clamp(L.dep, 0.35, door - 0.5));
        teleport(pt.x, (to === "g" ? el.gFloor : el.rFloor) + 0.04, pt.z);
        m.end = to;                                           // the machine now lives at the destination cab
        m.moved = true;
      }
      if (m.t >= dur) {
        // ARRIVE: doors open where the player already physically stands —
        // they WALK out. Whoever was chasing is still at the other end.
        m.st = "out"; m.t = 0;
        const r2 = rigOf(el, m.end);
        r2.target = 1; gateDoor(r2);
        // arrival DING then the doors (guarded — "blip" stands in for a chime)
        if (CBZ.sfx) { CBZ.sfx("blip"); CBZ.sfx("door"); }
        if (CBZ.shake) CBZ.shake(0.25);
        if (CBZ.city && CBZ.city.note) {
          CBZ.city.note(m.end === "r" ? ("" + ST + " floors up — the roof is yours.") : "Ground floor.", 2);
        }
        return null;
      }
      // floor ticker: count THROUGH from current floor toward the destination
      // (1 ↔ topFloor), showing the destination beside the live number.
      const dest = up ? ST : 1;
      const fl = up ? Math.max(1, Math.round(1 + (ST - 1) * p)) : Math.max(1, Math.round(ST - (ST - 1) * p));
      return (up ? "▲ " : "▼ ") + fl + "F  →  " + dest + "F";
    }

    if (m.st === "out") {
      // FORCE the arrival doors open and HOLD them — nothing (a stale
      // autoClose, a flaky inside-test, anything) may close a cab on an
      // arriving rider. The leave-check only arms once the doors are
      // genuinely open, so a one-frame proximity glitch can never slam
      // them shut before they've visibly moved (the filmed sealed-in bug).
      r.target = 1; r.autoClose = null;
      const armed = m.t > 1.2 && r.open > 0.5;
      if ((armed && !insideCab(el, m.end, P) && !inDoorway(el, m.end, P)) || m.t >= EXIT_WAIT) {
        r.target = 0;
        resetMachine(el, CALL_COOL);
        return null;
      }
      return m.end === "r" ? "Roof — step out" : "Ground floor — step out";
    }
    return undefined;
  }

  let _promptT = 0;
  CBZ.onUpdate(36.6, function (dt) {
    if (g.mode !== "city") {
      // mode exit mid-cycle: if the player was sealed in a ride, put them
      // back on the ground apron (a known-safe spot) before the city sleeps.
      // Guarded so other modes pay one compare per lift, not a door reset.
      for (const el of elevators) {
        if (el.m.st === "idle" && !el.ground.open && !el.roof.open &&
            el.ground.target === 0 && el.roof.target === 0) continue;
        if (el.m.st === "ride" && CBZ.player) teleport(el.groundPad.x, el.gFloor - 0.02, el.groundPad.z);
        if (el.m.st !== "idle") resetMachine(el, 0);
        closeNow(el.ground); closeNow(el.roof);
      }
      chipText(null);
      return;
    }
    if (!built) { const A = CBZ.city && CBZ.city.arena; if (A && A.lots) buildAll(A); if (!built) return; }

    const P = CBZ.player;
    // door animation + collider gate (cheap: only moves while a target differs)
    for (const el of elevators) {
      animRig(el.ground, dt); animRig(el.roof, dt);
      gateDoor(el.ground); gateDoor(el.roof);
    }

    // machines (normally all idle — stepMachine early-outs in one compare)
    let text;
    for (const el of elevators) {
      const t = stepMachine(el, dt, P);
      if (t !== undefined) text = t;
    }
    if (text !== undefined) { chipText(text); return; }

    // RESCUE: a player standing inside ANY sealed idle cab gets the doors
    // opened automatically — no state-machine path may ever leave someone
    // entombed (belt-and-suspenders for the filmed stuck-at-arrival bug).
    if (P && !P.dead) {
      for (const el of elevators) {
        if (el.m.st !== "idle") continue;
        for (const end of ["g", "r"]) {
          const rr = rigOf(el, end);
          if (rr.open < 0.1 && insideCab(el, end, P)) { rr.target = 1; rr.autoClose = 4.0; }
        }
      }
    }

    // all idle: proximity prompt at ~12 Hz, not frame rate — padNear hypots
    // every lift pad, and the [E] handler re-checks reach on the press anyway.
    _promptT += dt;
    if (g.state === "playing" && P && !P.dead && !P.driving && !CBZ.cityMenuOpen) {
      if (_promptT >= 1 / 12) {
        _promptT = 0;
        const near = padNear();
        chipText(near ? (near.end === "g" ? "[E] Elevator — call (ride to the roof)" : "[E] Elevator — call (ride down)") : null);
      }
    } else chipText(null);
  });

  // [E] calls the lift / closes the doors early. Registered on DOCUMENT in the
  // CAPTURE phase so stopPropagation keeps every later handler — interact.js's
  // window-level "[E] = eat" fallback, shop/zillow panels — from firing on the
  // same press: the lift wins arbitration when you're at it.
  function onKey(e) {
    if (!built || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen) return;
    const P = CBZ.player;
    if (!P || P.dead || P.driving) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    // inside an OPEN cab: [E] = close the doors now (early depart)
    for (const el of elevators) {
      if (el.m.st === "open" && insideCab(el, el.m.end, P) && !inDoorway(el, el.m.end, P)) {
        e.preventDefault(); e.stopPropagation();
        beginClose(el);
        return;
      }
    }
    const near = padNear();
    if (near) {
      e.preventDefault(); e.stopPropagation();
      callLift(near.el, near.end);
      return;
    }
    // sealed inside an idle cab (doors timed out on you): [E] reopens this end
    for (const el of elevators) {
      if (el.m.st !== "idle") continue;
      for (const end of ["g", "r"]) {
        if (insideCab(el, end, P)) {
          e.preventDefault(); e.stopPropagation();
          callLift(el, end);
          return;
        }
      }
    }
  }
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("keydown", onKey, true);

  // ======================================================================
  //  THE INTERIOR STAIR CORE — CBZ.cityStairCore(lot, opts)
  //
  //  WHY THIS EXISTS: buildings.js has a complete switchback stair rig
  //  (buildings.js:3338-3420) that has NEVER RUN. Its gate is
  //      stairW = min(SW=4.2, ...);  hasStairs = ... && stairW >= 4.4
  //  and 4.2 can never be >= 4.4, so `hasStairs` is false for every building
  //  ever built in this game. The consequence: there is no walkable vertical
  //  traversal ANYWHERE — the lift is a sealed ground<->roof two-stop, every
  //  floor between them is reachable by nobody. You cannot fight your way UP
  //  a building that has no up.
  //
  //  This is the fix, and it lives HERE because this file is already "VERTICAL
  //  ACCESS" — lifts and fire escapes. It is the third rig in the same family,
  //  not a fourth parallel system, and it reuses this file's own box/solid/plat
  //  helpers and buildings.js's own carve (CBZ.cityCarveShaft) rather than
  //  re-deriving any of it. It also does NOT touch buildings.js's dead gate:
  //  the core is opt-in per building, so nothing changes for the other ~thousand
  //  shells until somebody asks for stairs.
  //
  //  THE RIG (per storey, exactly the proportions buildings.js authored):
  //    arrival strip (flat, full core width)  ->  flight A up the -lateral lane
  //    ->  half-landing at the far end (flat, full width)  ->  flight B back
  //    down the +lateral lane, arriving on the next floor's strip.
  //  Equal risers ~0.185m. Ramp platforms carry the frozen {z0,z1,y0,y1} shape
  //  (or the additive {axis:"x",x0,x1,y0,y1} twin) so systems/physics.js walks
  //  them with no changes. Lanes ABUT in the lateral axis and never overlap —
  //  overlapping lanes at different heights make the resolver snap a climber up
  //  a whole storey at the seam (buildings.js learned this the hard way).
  //
  //  It sits in the interior corner FURTHEST from the front door, flush to two
  //  building walls, so only ONE new wall is needed to enclose the shaft — and
  //  that leaves exactly ONE opening per floor. That opening is the chokepoint
  //  the whole floor is defended around.
  // ======================================================================
  const CORE_RISE = 0.185;     // target riser (buildings.js's own number)
  const CORE_LD = 1.3;         // landing depth at each end of a flight
  const CORE_OVL = 0.9;        // ramp AABB overlap into its landings
  const CORE_LIP = 0.22;       // lateral overhang, OUTWARD only (never between lanes)

  function coreFrame(b) {
    const wt = b.wt != null ? b.wt : 0.4;
    const ixMin = -b.w / 2 + wt, ixMax = b.w / 2 - wt;
    const izMin = -b.d / 2 + wt, izMax = b.d / 2 - wt;
    const dn = b.localDoor || { x: 0, z: izMin, nx: 0, nz: 1 };
    const nx = dn.nx, nz = dn.nz;
    const along = Math.abs(nx) > 0.5;                   // door on a ±x wall
    const tx = -nz, tz = nx;
    const base = along
      ? { x: nx > 0 ? ixMin : ixMax, z: (izMin + izMax) / 2 }
      : { x: (ixMin + ixMax) / 2, z: nz > 0 ? izMin : izMax };
    return {
      nx, nz, tx, tz, along, base,
      depthSpan: along ? (ixMax - ixMin) : (izMax - izMin),
      latSpan: along ? (izMax - izMin) : (ixMax - ixMin),
      // (depth-from-the-door, lateral-from-the-centreline) -> building-local
      pt: function (dep, lat) { return { x: base.x + nx * dep + tx * lat, z: base.z + nz * dep + tz * lat }; },
    };
  }

  CBZ.cityStairCore = function (lot, opts) {
    opts = opts || {};
    const b = lot && lot.building;
    if (!b || !b.group || b.w == null || b.d == null) return null;
    if (b._stairCore) return b._stairCore;                 // idempotent
    const FHl = b.FH != null ? b.FH : FH;
    const tops = (Array.isArray(b.floorTops) && b.floorTops.length >= 2)
      ? b.floorTops
      : (function () { const o = [0.14]; for (let L = 1; L <= (b.storeys || 1); L++) o.push(L * FHl); return o; })();
    const nFloors = tops.length - 1;                       // interior floors (last top is the roof)
    if (nFloors < 2) return null;                          // nothing to climb

    const F = coreFrame(b);
    // size the core to the plate; bail rather than build something unwalkable
    const CW = Math.min(4.8, F.latSpan - 2.2);             // lateral width (two lanes)
    const CD = Math.min(6.8, F.depthSpan - 2.6);           // depth (the flight run)
    if (CW < 3.0 || CD < 4.4) return null;
    const side = opts.side === -1 ? -1 : 1;                // which corner (lateral sign)
    const D1 = F.depthSpan, D0 = D1 - CD;                  // flush to the far wall
    const L1 = side * (F.latSpan / 2), L0 = L1 - side * CW; // flush to one side wall
    const latMid = (L0 + L1) / 2;
    // HAIRLINE SEAM: the two lanes sit at DIFFERENT heights over the same
    // depth band, and groundAt's AABB test is inclusive on both bounds — a
    // climber standing exactly on a shared edge is a candidate for both, and
    // near the half-landing the height gap drops under STEP_UP (0.45), so the
    // resolver could snap them across. 1cm of daylight (the handrail already
    // lives in it) makes that impossible. buildings.js:3341 warns about
    // precisely this failure mode.
    const SEAM = 0.01;
    const laneA0 = L0, laneA1 = latMid - side * SEAM, laneB0 = latMid + side * SEAM, laneB1 = L1;

    // building-local axis-aligned rect from a (depth, lateral) rect
    function rect(d0, d1, l0, l1) {
      const a = F.pt(d0, l0), c = F.pt(d1, l1);
      return { x0: Math.min(a.x, c.x), x1: Math.max(a.x, c.x), z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z) };
    }
    function wrect(d0, d1, l0, l1) {
      const r = rect(d0, d1, l0, l1);
      return { minX: b.ox + r.x0, maxX: b.ox + r.x1, minZ: b.oz + r.z0, maxZ: b.oz + r.z1 };
    }
    const cols = [], plats = [];
    function addPlat(d0, d1, l0, l1, top, ramp) {
      const p = wrect(d0, d1, l0, l1); p.top = top;
      if (ramp) p.ramp = ramp;
      CBZ.platforms.push(p); plats.push(p);
      if (b.platforms) b.platforms.push(p);     // so demolition splices it back out
      return p;
    }
    function addSolid(d0, d1, l0, l1, y0, y1, ref) {
      const p = wrect(d0, d1, l0, l1);
      const c = { minX: p.minX, maxX: p.maxX, minZ: p.minZ, maxZ: p.maxZ, y0: y0, y1: y1, ref: ref || null };
      CBZ.colliders.push(c); cols.push(c);
      if (b.colliders) b.colliders.push(c);
      return c;
    }
    // a ramp record in the FROZEN shape physics.js expects, oriented on
    // whichever world axis this building's depth runs along.
    function rampRec(dFrom, dTo, y0, y1) {
      const a = F.pt(dFrom, latMid), c = F.pt(dTo, latMid);
      return F.along
        ? { axis: "x", x0: b.ox + a.x, x1: b.ox + c.x, y0: y0, y1: y1 }
        : { z0: b.oz + a.z, z1: b.oz + c.z, y0: y0, y1: y1 };
    }

    // ---- CARVE the chase through every intermediate slab. buildings.js owns
    // the slabs, so buildings.js does the carve (the elevator's exact idiom).
    // A slab a lift already carved is skipped by that function — harmless: the
    // slabs are platforms + LOS, never colliders, so a flight passing through
    // one clips visually for ~0.2m and never blocks anybody.
    if (CBZ.cityCarveShaft) {
      const cc = F.pt((D0 + D1) / 2, latMid);
      const rr = rect(D0, D1, L0, L1);
      try {
        CBZ.cityCarveShaft(b, b.ox + cc.x, b.oz + cc.z,
          (rr.x1 - rr.x0) / 2 - 0.05, (rr.z1 - rr.z0) / 2 - 0.05);
      } catch (e) {}
    }

    // ---- THE SHAFT WALL: one new wall, on the open lateral side. The far
    // wall and the side wall are the building's own — flush by construction —
    // so this single box turns the corner into a sealed stairwell with exactly
    // ONE opening per floor (at D0, facing back into the room).
    // stop the shaft EXACTLY at the roof slab top: any overshoot leaves a
    // collider ridge on the walkable roof that you trip over.
    const wallTop = tops[nFloors];
    {
      const wl = L0 - side * 0.09, wl2 = L0 + side * 0.09;
      const r = rect(D0 - 0.1, D1, Math.min(wl, wl2), Math.max(wl, wl2));
      const m = box(b.group, (r.x0 + r.x1) / 2, wallTop / 2, (r.z0 + r.z1) / 2,
        Math.max(0.18, r.x1 - r.x0), wallTop, Math.max(0.18, r.z1 - r.z0), SHAFT);
      addSolid(D0 - 0.1, D1, Math.min(wl, wl2), Math.max(wl, wl2), 0, wallTop, m);
      if (CBZ.losBlockers) CBZ.losBlockers.push(m);
      if (b.losMeshes) b.losMeshes.push(m);
    }

    // ---- THE STAIRWELL DOOR: two stubs across the open face narrow the
    // 4.8m mouth to a 1.8m doorway, and a header above each floor's opening
    // closes the shaft between storeys. Result: ONE ~1.8m opening per floor.
    // That opening is the chokepoint the floor's guards are posted around —
    // the published rule is 3-4 chokepoints a level and never two coverable
    // from a single post, and one stair door per floor is exactly that.
    const DOORHALF = 0.9, DOORH = 2.15;
    {
      const stub = function (l0, l1) {
        if (Math.abs(l1 - l0) < 0.12) return;
        const r = rect(D0 - 0.09, D0 + 0.09, Math.min(l0, l1), Math.max(l0, l1));
        const m = box(b.group, (r.x0 + r.x1) / 2, wallTop / 2, (r.z0 + r.z1) / 2,
          Math.max(0.18, r.x1 - r.x0), wallTop, Math.max(0.18, r.z1 - r.z0), SHAFT);
        addSolid(D0 - 0.09, D0 + 0.09, Math.min(l0, l1), Math.max(l0, l1), 0, wallTop, m);
        if (CBZ.losBlockers) CBZ.losBlockers.push(m);
        if (b.losMeshes) b.losMeshes.push(m);
      };
      stub(L0, latMid - side * DOORHALF);
      stub(latMid + side * DOORHALF, L1);
      // the header over each floor's doorway (the shaft is sealed between
      // storeys; only the doorway band is open)
      for (let k = 0; k < nFloors; k++) {
        const hy0 = tops[k] + DOORH, hy1 = tops[k + 1];
        if (hy1 - hy0 < 0.1) continue;
        const r = rect(D0 - 0.09, D0 + 0.09, latMid - side * DOORHALF, latMid + side * DOORHALF);
        const m = box(b.group, (r.x0 + r.x1) / 2, (hy0 + hy1) / 2, (r.z0 + r.z1) / 2,
          Math.max(0.18, r.x1 - r.x0), hy1 - hy0, Math.max(0.18, r.z1 - r.z0), SHAFT);
        addSolid(D0 - 0.09, D0 + 0.09, latMid - side * DOORHALF, latMid + side * DOORHALF, hy0, hy1, m);
      }
    }

    // ---- THE FLIGHTS -----------------------------------------------------
    const dA0 = D0 + CORE_LD, dA1 = D1 - CORE_LD;          // the sloped run
    const runLen = dA1 - dA0;
    for (let k = 0; k < nFloors; k++) {
      const y0 = tops[k], y2 = tops[k + 1], y1 = (y0 + y2) / 2;
      // arrival strip at this floor (flat, full width, at the OPEN end)
      addPlat(D0 - 0.05, dA0 + 0.35, L0, L1, y0);
      // flight A: -lateral lane, climbing away from the opening
      addPlat(dA0 - CORE_OVL, dA1 + CORE_OVL, laneA0 - side * CORE_LIP, laneA1,
        y1, rampRec(dA0, dA1, y0, y1));
      // half landing at the far end (flat, full width)
      addPlat(dA1 - 0.35, D1, L0, L1, y1);
      // flight B: +lateral lane, climbing back toward the opening
      addPlat(dA0 - CORE_OVL, dA1 + CORE_OVL, laneB0, laneB1 + side * CORE_LIP,
        y2, rampRec(dA1, dA0, y1, y2));
      // ---- DECORATIVE treads/risers/rail (no collision — the ramps are the
      // collision, exactly as buildings.js does it) ------------------------
      const nSteps = Math.max(2, Math.round((y1 - y0) / CORE_RISE));
      const rise = (y1 - y0) / nSteps, run = runLen / nSteps;
      for (let lane = 0; lane < 2; lane++) {
        const lo = lane === 0 ? laneA0 : laneB0, hi = lane === 0 ? laneA1 : laneB1;
        const lc = (lo + hi) / 2, lw = Math.abs(hi - lo);
        const base = lane === 0 ? y0 : y1;
        for (let i = 1; i <= nSteps; i++) {
          const vt = base + i * rise;
          const dCentre = lane === 0 ? (dA0 + (i - 0.5) * run) : (dA1 - (i - 0.5) * run);
          const p = F.pt(dCentre, lc);
          box(b.group, p.x, vt - 0.03, p.z,
            F.along ? run + 0.03 : lw - 0.12, 0.06, F.along ? lw - 0.12 : run + 0.03, LAND);
        }
        // handrail along the OPEN (centre) edge of the lane
        const railLat = lane === 0 ? laneA1 - side * 0.07 : laneB0 + side * 0.07;
        for (let i = 0; i <= nSteps; i += 2) {
          const vt = base + i * rise;
          const dAt = lane === 0 ? (dA0 + i * run) : (dA1 - i * run);
          const p = F.pt(dAt, railLat);
          box(b.group, p.x, vt + 0.48, p.z, 0.05, 0.95, 0.05, RAILC);
        }
      }
      // one strip light over each landing so the shaft is never a black hole
      { const p = F.pt(dA1 - 0.5, latMid);
        box(b.group, p.x, y1 + FHl * 0.42, p.z, F.along ? 0.4 : 1.5, 0.07, F.along ? 1.5 : 0.4,
          0xeef2ff, { emissive: 0xeef2ff, ei: 0.3 }); }
    }
    // (no roof landing needed: the ROOF slab is never carved — buildings.js
    // excludes it from floorSlabs — so it already covers this footprint.)

    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();

    // the STAIRHEAD, building-local, in the same {x,z,nx,nz} shape as
    // b.localDoor — so every per-floor interior program can be oriented off
    // "the way you arrive on this floor" with no special case.
    const hp = F.pt(D0, latMid);
    const head = { x: hp.x, z: hp.z, nx: -F.nx, nz: -F.nz };
    const rec = {
      lot: lot, b: b, head: head, stops: tops.slice(), floors: nFloors,
      // `depth`/`width` are what the core EATS out of each floorplate — an
      // interior program hands this to the kit as `opts.inset` so it furnishes
      // the room, not the stairwell.
      depth: CD, width: CW,
      rect: rect(D0, D1, L0, L1), colliders: cols, platforms: plats,
      // world-space centre of the opening on floor k (the chokepoint)
      headAt: function (k) {
        const y = tops[Math.max(0, Math.min(nFloors, k | 0))];
        return { x: b.ox + hp.x, y: y, z: b.oz + hp.z, nx: -F.nx, nz: -F.nz };
      },
    };
    b._stairCore = rec;
    return rec;
  };
  // has this building got walkable vertical traversal at all?
  CBZ.cityHasStairs = function (lot) {
    const b = lot && lot.building;
    return !!(b && (b._stairCore || b.hasStairs));
  };

  // PUBLIC: the built lifts (minimap markers / missions can target a roof)
  CBZ.cityElevators = function () { return elevators; };

  // FIRST-PRINCIPLES CONTRACT: a lift is not merely a teleport marker. Its
  // building must publish an ordered ground→roof stop list, reserve and carve
  // one continuous shaft, build two sealed two-leaf cab rooms on the SAME x/z
  // column, and publish the resulting machine back on the canonical building
  // record. Math-gate reads this after world build so a future style/era recipe
  // cannot silently strand a decorative elevator in an uncarved floor plate.
  CBZ.cityElevatorAudit = function () {
    const out = {
      elevators: elevators.length, badStops: 0, missingShafts: 0,
      uncarvedSlabs: 0, missingLift: 0, misalignedEnds: 0, badCabs: 0,
      samples: []
    };
    function fail(kind, el, detail) {
      out[kind]++;
      if (out.samples.length < 10) out.samples.push({
        kind, x: +el.b.ox.toFixed(2), z: +el.b.oz.toFixed(2), detail
      });
    }
    for (const el of elevators) {
      const b = el.b, tops = b.floorTops;
      let stopsOk = Array.isArray(tops) && tops.length >= 2;
      if (stopsOk) {
        for (let i = 0; i < tops.length; i++) {
          if (!Number.isFinite(tops[i]) || (i && tops[i] <= tops[i - 1])) { stopsOk = false; break; }
        }
        stopsOk = stopsOk
          && Math.abs(tops[0] - 0.14) <= 0.001
          && Math.abs(tops[tops.length - 1] - b.h) <= 0.001
          && el.topFloor === tops.length;
      }
      if (!stopsOk) fail("badStops", el, "unordered or shell-height mismatch");
      if (!b.shaftRects || !b.shaftRects.length)
        fail("missingShafts", el, "no reserved shaft footprint");
      if (b.floorSlabs) {
        for (const slab of b.floorSlabs) if (!slab.carved)
          fail("uncarvedSlabs", el, "intermediate floor crosses the lift column");
      }
      if (!b.lift || b.lift.floors !== el.topFloor
        || !b.lift.ground || !b.lift.roof
        || Math.abs(b.lift.roof.y - b.h) > 0.001)
        fail("missingLift", el, "building registry does not match the machine");
      if (!el.groundPad || !el.roofPad
        || Math.hypot(el.groundPad.x - el.roofPad.x, el.groundPad.z - el.roofPad.z) > 0.001)
        fail("misalignedEnds", el, "ground and roof cabs are not one vertical column");
      if (!el.ground || !el.roof
        || !el.ground.leaves || el.ground.leaves.length !== 2 || !el.ground.col
        || !el.roof.leaves || el.roof.leaves.length !== 2 || !el.roof.col
        || Math.abs(el.gFloor - 0.16) > 0.001
        || Math.abs(el.rFloor - (b.h + 0.16)) > 0.001)
        fail("badCabs", el, "an end is not a sealed, floor-aligned cab room");
    }
    out.failures = out.badStops + out.missingShafts + out.uncarvedSlabs
      + out.missingLift + out.misalignedEnds + out.badCabs;
    return out;
  };
})();
