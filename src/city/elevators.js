/* ============================================================
   city/elevators.js — VERTICAL ACCESS: elevators in the tallest
   towers + exterior fire-escape stairs on a few mid-rises.

   WHY: height is STATUS. The property ladder ends in a penthouse
   with a helipad, so getting UP has to feel like ARRIVING — you
   walk in through the building's DOOR, cross the lobby to the lift
   alcove on an interior wall, press Call on the call button, the
   doors slide open onto a REAL CAB — a small lit room you
   physically WALK INTO — you press the floor you want on the car's
   panel, the doors close behind you, the car hums, and the doors
   open at that landing (the roof, with the whole city under you).
   You walk in; you walk out. The alcove lives INSIDE on purpose: a lift you
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
  // the roof end's ELEVATOR PENTHOUSE: rendered masonry, metal coping, a
  // painted steel door frame, dark louvre plenum, galvanised ladder
  const PH_RENDER = 0xa29c91, PH_COPING = 0x7c8084, PH_FRAME = 0x2f3337, PH_LOUVRE = 0x2a2d30, PH_LADDER = 0x8a8f93;
  let _phMat = null;
  function phMat() {
    if (!_phMat) { _phMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }); _phMat._shared = true; }
    return _phMat;
  }

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

  // slab extents (mirror makeBuilding's roof math)
  function slabInfo(b) {
    const wt = b.wt != null ? b.wt : 0.4;
    const ixMax = b.w / 2 - wt, izMin = -b.d / 2 + wt, izMax = b.d / 2 - wt;
    const slabMinX = -b.w / 2 + wt;
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
      // the SOLID back counter, off its vendor spot (worldgen slides the
      // counter along the back wall clear of the reserved stair core, and the
      // clerk stands 1.2 m in front of it)
      const n = INWARD[doorSideOf(b)];
      const cw = n.x ? 0.8 : Math.min(w - 2, 4.5), cd = n.z ? 0.8 : Math.min(d - 2, 4.5);
      if (b.vendorSpot) a.push({ x: b.vendorSpot.x - n.x * 1.2, z: b.vendorSpot.z - n.z * 1.2, r: Math.max(cw, cd) / 2 + 1.0 });
      else a.push({ x: b.ox + n.x * (w / 2 - 2.8), z: b.oz + n.z * (d / 2 - 2.8), r: Math.max(cw, cd) / 2 + 1.0 });
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
  // door face (the entrance aisle owns it), and the back face — where shop
  // counters / kitchen runs live — only as a last resort. Each slot is
  // sampled through b.clearFloorPoint (door aisle + reserved stair core and
  // its landing + bounds)
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
    if (ds !== 2 && OPP[ds] !== 2) faces.push(2);
    faces.push(OPP[ds]);                                      // back wall: last resort
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
        const xLo = -w / 2 + S.wt;
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
    // ---- ONE CAB ROOM PER LANDING. The ground lobby, the roof headhouse and
    //      any served floor between (the Spire's penthouse loft here; the
    //      Executive suite's storey is served by its own walnut core, see
    //      exec_office.js) are the SAME room in the SAME lobby-local frame
    //      (P/tn), one directly above the other, so the column reads as one
    //      lift and the mid-ride swap between two of them is invisible. Each:
    //      back skin, two solid side walls, a lit ceiling, its own floor slab
    //      (top = the exact arrival height), a door frame (cheeks + header), two
    //      sliding leafs over one y-gated collider, a call panel whose button
    //      lights when pressed, a hall lantern, and the car's floor panel.
    function cabAt(RBASE, roof) {
      { // back skin against the building wall
        const p = P(0, 0.08), sz = tn(IW, 0.12);
        box(grp, p.x, RBASE + 1.25, p.z, sz.w, CAB_H, sz.d, CABWALL);
      }
      for (const s of [-1, 1]) {  // side walls (solid: the cab is a sealed room)
        const p = P(s * SIDE, CD + 0.02), sz = tn(0.16, CABDEP);
        const m = box(grp, p.x, RBASE + CAB_H / 2, p.z, sz.w, CAB_H, sz.d, STEEL, { cast: true });
        solidAt(p, sz, RBASE, RBASE + CAB_H, m);
      }
      { // ceiling (the roof end wears a cap) + the small lit light panel
        const p = P(0, CD + 0.02), sz = tn(IW + 0.18, CABDEP + 0.2);
        const ls = tn(Math.min(0.95, IW * 0.46), Math.min(0.95, CABDEP * 0.43));
        if (roof) box(grp, p.x, RBASE + CAB_H + 0.13, p.z, sz.w + 0.4, 0.14, sz.d + 0.4, 0x474f59);
        else box(grp, p.x, RBASE + CAB_H + 0.11, p.z, sz.w, 0.12, sz.d, STEEL);
        box(grp, p.x, RBASE + CAB_H - 0.04, p.z, ls.w, 0.07, ls.d, 0xe8ddc2, { emissive: 0xfff1cd, ei: 0.95 });
      }
      { // cab floor slab (its top is the EXACT arrival height = RBASE + 0.16)
        const p = P(0, CD + 0.07), sz = tn(IW, CABDEP + 0.2);
        box(grp, p.x, RBASE + 0.08, p.z, sz.w, 0.16, sz.d, CABFLOOR);
        plat(ox + p.x - sz.w / 2, ox + p.x + sz.w / 2, oz + p.z - sz.d / 2, oz + p.z + sz.d / 2, RBASE + 0.16);
      }
      for (const s of [-1, 1]) {  // door frame cheeks (the roof end: the penthouse front wall)
        const p = P(s * FRAMELAT, GDOOR + 0.04), sz = tn(0.6, 0.55);
        const m = box(grp, p.x, RBASE + 1.6, p.z, sz.w, 3.2, sz.d, roof ? PH_RENDER : STEEL, { cast: true });
        solidAt(p, sz, RBASE, RBASE + 3.2, m);
      }
      { // header (solid: a jump can put a head in it)
        const p = P(0, GDOOR + 0.04), sz = tn(IW + 0.58, 0.55);
        const m = box(grp, p.x, RBASE + 2.82, p.z, sz.w, 0.84, sz.d, roof ? PH_RENDER : STEEL, { cast: true });
        solidAt(p, sz, RBASE + 2.4, RBASE + 3.24, m);
      }
      // NO dark reveal strip: the leafs ARE the closed door, and behind them
      // sits the real lit cab room, so the opened doors frame the cab itself.
      const rig = { leaves: [], open: 0, target: 0, autoClose: null, autoCloseAudible: false, trav: LEAFTRAV };
      for (const s of [-1, 1]) {
        const p = P(s * LEAFOFF, GDOOR), sz = tn(LEAFHW, 0.1);
        const m = box(grp, p.x, RBASE + 1.27, p.z, sz.w, 2.45, sz.d, LEAF);
        rig.leaves.push({ m, baseX: p.x, baseZ: p.z, sx: f.tx * s, sz: f.tz * s });
      }
      {
        const pA = P(-DHW, GDOOR - 0.07), pB = P(DHW, GDOOR + 0.07);
        rig.col = solid(RBASE, RBASE + 2.4,
          ox + Math.min(pA.x, pB.x), ox + Math.max(pA.x, pB.x),
          oz + Math.min(pA.z, pB.z), oz + Math.max(pA.z, pB.z));
        rig.cy0 = RBASE; rig.cy1 = RBASE + 2.4; rig.solid = true;
      }
      // call panel + the button (lit while the lift answers) + hall lantern
      { const p = P(FRAMELAT, GDOOR + 0.36), sz = tn(0.3, 0.08); box(grp, p.x, RBASE + 1.32, p.z, sz.w, 0.55, sz.d, 0x232830); }
      const pb = P(FRAMELAT, GDOOR + 0.42), pbs = tn(0.12, 0.05);
      const btn = box(grp, pb.x, RBASE + 1.42, pb.z, pbs.w, 0.12, pbs.d, 0x35d07a, { emissive: 0x16a04a, ei: 0.7 });
      const pl = P(0, GDOOR + 0.34), pls = tn(0.7, 0.07);
      const lamp = box(grp, pl.x, RBASE + 3.05, pl.z, pls.w, 0.2, pls.d, 0x3a3f46, { emissive: 0x10131a, ei: 0.3 });
      // the car's own floor panel, inside by the door: the floor buttons sit here
      const ip = P(SIDE - 0.1, GDOOR - 0.42), ips = tn(0.04, 0.3);
      box(grp, ip.x, RBASE + 1.25, ip.z, ips.w, 0.5, ips.d, 0x232830);
      const pad = P(0, V.dep + 0.5);
      return {
        base: RBASE, floor: RBASE + 0.16, rig, btn, lamp,
        pad: { x: ox + pad.x, z: oz + pad.z },
        btnAt: { x: ox + pb.x, y: RBASE + 1.42, z: oz + pb.z },
        panelAt: { x: ox + ip.x, y: RBASE + 1.45, z: oz + ip.z },
        // where a finger meets them (CBZ.verbs.touch "press"): the call
        // button's lobby face (it stands 0.05 proud, facing out of the cab),
        // and the floor panel's face toward the middle of the car (0.04 thick)
        btnN: { x: -f.nx, y: 0, z: -f.nz },
        btnFace: { x: ox + pb.x - f.nx * 0.025, y: RBASE + 1.42, z: oz + pb.z - f.nz * 0.025 },
        panelN: { x: -Math.sign(SIDE - 0.1) * f.tx, y: 0, z: -Math.sign(SIDE - 0.1) * f.tz },
        panelFace: { x: ox + ip.x - Math.sign(SIDE - 0.1) * f.tx * 0.02, y: RBASE + 1.45, z: oz + ip.z - Math.sign(SIDE - 0.1) * f.tz * 0.02 },
      };
    }
    // the served levels, bottom to top: the lobby, the Spire's penthouse loft
    // (its owner rides home to the top interior floor), the roof
    const levels = [{ base: 0, roof: false, name: "Ground" }];
    const loftY = b.home && b.home.loftY != null ? b.home.loftY : null;
    if (loftY != null && loftY > 3.5 && loftY < h - 2.8) levels.push({ base: loftY, roof: false, name: "Penthouse" });
    levels.push({ base: h, roof: true, name: "Roof" });
    const cabs = levels.map(function (L) {
      const c = cabAt(L.base, L.roof);
      c.name = L.name; c.roof = L.roof;
      return c;
    });
    const RDOOR = GDOOR, RBASE = h;                    // the roof end (the penthouse dressing below builds off it)

    // ---- THE ELEVATOR PENTHOUSE. From the roof (and from every window above
    //      it) the roof end used to read as a bare steel booth: two steel side
    //      panels, a flat cap and a steel frame. A real lift arrives on a roof
    //      inside a rendered masonry penthouse, so it is wrapped in one: side
    //      and back walls in render, a roof slab with a metal coping on top,
    //      the front wall (the existing cheeks + header, recoloured) with a
    //      painted steel door frame round the lift doors and a small drip
    //      canopy, a louvred vent on one flank and a galvanised
    //      access ladder up the other. ONE merged vertex-coloured mesh; the
    //      cab interior, leafs, call panel, doorway and every existing
    //      collider are untouched. The new side walls get y-gated colliders
    //      so you cannot walk into the render.
    {
      const parts = [];
      const _c = new THREE.Color();
      // a box from lateral [l0,l1] x depth [d0,d1] x height [y0,y1] (roof-relative)
      const pb = (l0, l1, d0, d1, y0, y1, col) => {
        const c = P((l0 + l1) / 2, (d0 + d1) / 2), sz = tn(Math.abs(l1 - l0), Math.abs(d1 - d0));
        const gg = new THREE.BoxGeometry(sz.w, y1 - y0, sz.d);
        gg.translate(c.x, RBASE + (y0 + y1) / 2, c.z);
        _c.setHex(col);
        const n = gg.attributes.position.count, arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
        gg.setAttribute("color", new THREE.BufferAttribute(arr, 3));
        parts.push(gg);
        return { c: c, sz: sz };
      };
      const LO = FRAMELAT + 0.3;                          // outer lateral face (flush with the cheeks)
      const LI = SIDE + 0.08;                             // outer face of the cab side walls
      const DB = -S.wt + 0.03;                            // back face, just inside the facade plane
      const DF = RDOOR + 0.04 - 0.275;                    // back face of the front wall (cheeks)
      const DFF = RDOOR + 0.04 + 0.275;                   // street face of the front wall
      const TOP = 3.45;
      for (const s of [-1, 1]) {                          // side walls
        const l0 = s > 0 ? LI : -LO, l1 = s > 0 ? LO : -LI;
        const r = pb(l0, l1, DB, DF, 0, TOP, PH_RENDER);
        solid(RBASE, RBASE + TOP, ox + r.c.x - r.sz.w / 2, ox + r.c.x + r.sz.w / 2, oz + r.c.z - r.sz.d / 2, oz + r.c.z + r.sz.d / 2);
      }
      pb(-LO, LO, DB, 0.02, 0, TOP, PH_RENDER);          // back wall
      pb(-LO, LO, DF, DFF, 3.24, TOP, PH_RENDER);        // front wall above the header
      pb(-LO - 0.05, LO + 0.05, DB - 0.02, DFF + 0.05, TOP, TOP + 0.16, PH_RENDER);        // roof slab
      pb(-LO - 0.1, LO + 0.1, DB - 0.05, DFF + 0.1, TOP + 0.16, TOP + 0.22, PH_COPING);   // coping
      pb(-LO - 0.1, LO + 0.1, DFF + 0.04, DFF + 0.1, TOP + 0.02, TOP + 0.22, PH_COPING);  // coping drip, door face
      // painted steel door frame round the lift opening + a drip canopy
      for (const s of [-1, 1]) pb(s * (DHW + 0.0), s * (DHW + 0.11), DFF, DFF + 0.05, 0, 2.5, PH_FRAME);
      pb(-DHW - 0.11, DHW + 0.11, DFF, DFF + 0.05, 2.4, 2.5, PH_FRAME);
      pb(-DHW - 0.35, DHW + 0.35, DFF, DFF + 0.55, 2.62, 2.68, PH_COPING);                // canopy
      // louvred vent on the +lateral flank: dark plenum, five blades
      {
        const dv0 = Math.max(DB + 0.3, 0.35), dv1 = Math.min(DF - 0.3, dv0 + 0.8);
        if (dv1 - dv0 > 0.3) {
          pb(LO, LO + 0.02, dv0, dv1, 2.05, 2.75, PH_LOUVRE);
          for (let k = 0; k < 5; k++) pb(LO, LO + 0.06, dv0, dv1, 2.1 + k * 0.14, 2.13 + k * 0.14, PH_COPING);
          pb(LO, LO + 0.07, dv0 - 0.04, dv1 + 0.04, 2.75, 2.8, PH_COPING);                // head flashing
        }
      }
      // access ladder to the penthouse roof on the -lateral flank, with a
      // stiles carried 1 m past the coping and stand-off brackets into the render
      {
        const dl = Math.max(DB + 0.35, Math.min(DF - 0.5, (DB + DF) / 2)), lw = 0.2;
        const lo = -LO - 0.16;
        for (const s of [-1, 1]) {
          pb(lo - 0.02, lo + 0.02, dl + s * lw - 0.02, dl + s * lw + 0.02, 0, TOP + 1.0, PH_LADDER);
          for (const y of [1.2, 2.6]) pb(lo, -LO, dl + s * lw - 0.02, dl + s * lw + 0.02, y, y + 0.04, PH_LADDER);
        }
        for (let y = 0.6; y < TOP; y += 0.3) pb(lo - 0.015, lo + 0.015, dl - lw, dl + lw, y, y + 0.03, PH_LADDER);
      }
      const BGU = THREE.BufferGeometryUtils;
      if (BGU && BGU.mergeBufferGeometries) {
        const merged = BGU.mergeBufferGeometries(parts, false);
        for (const gg of parts) gg.dispose();
        if (merged) {
          const ph = new THREE.Mesh(merged, phMat());
          ph.castShadow = true; ph.receiveShadow = true;
          ph.name = "lift-penthouse";
          grp.add(ph);
        }
      }
    }

    // ---- THE ENCLOSED SHAFT: opaque thin steel panels on the NON-door sides
    //      (back + both sides) rising the full column from the ground cab to the
    //      roof headhouse, PLUS a front (door-side) spandrel between the landing
    //      openings, so from anywhere in the building the lift reads as a sealed
    //      column with a door at each landing. The swap between two cab rooms
    //      happens INSIDE it, invisible from every angle.
    //      AND IT IS SOLID. The carve below drops a hole through every slab the
    //      column crosses, and these skins used to be paint: on any floor a
    //      body could reach (the Executive suite, the Spire's penthouse) the
    //      shaft was an open pit behind a picture of a wall, 160 m deep. The
    //      side skins and the spandrel runs now carry y-gated colliders from
    //      the top of the lobby cab up (the back is the building's own wall).
    const SHAFT_TOP = h;                               // shaft rises to the roof-cab floor line
    { // back skin (against the building's own interior wall, full height)
      const p = P(0, 0.04), sz = tn(IW + 0.14, 0.08);
      box(grp, p.x, SHAFT_TOP / 2 + 0.1, p.z, sz.w, SHAFT_TOP + 0.2, sz.d, SHAFT);
    }
    for (const s of [-1, 1]) { // side skins (full height, just outside the cab side walls)
      const p = P(s * (SIDE + 0.09), CD + 0.09), sz = tn(0.1, CABDEP + 0.32);
      box(grp, p.x, SHAFT_TOP / 2 + 0.1, p.z, sz.w, SHAFT_TOP + 0.2, sz.d, SHAFT);
      if (SHAFT_TOP > CAB_H + 0.5) solidAt(p, tn(0.2, CABDEP + 0.32), CAB_H, SHAFT_TOP);
    }
    { // FRONT spandrel runs (door side): solid between one landing's door head
      // (base + 3.24) and the next landing's sill, so every landing opening
      // stays clear and nothing else on the column is open.
      const p = P(0, RDOOR + 0.12), sz = tn(IW + 0.58, 0.08), csz = tn(IW + 0.58, 0.3);
      for (let i = 0; i + 1 < cabs.length; i++) {
        const segBot = cabs[i].base + 3.24, segTop = cabs[i + 1].base;
        if (segTop - segBot <= 0.1) continue;
        box(grp, p.x, (segBot + segTop) / 2, p.z, sz.w, segTop - segBot, sz.d, SHAFT);
        solidAt(p, csz, segBot, segTop);
      }
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
    // ---- the cab-local frame: lat (across the door) / dep (from the back
    //      wall toward the door plane). Every column cab shares it, so walk-in
    //      detection, the doorway hold and the mid-ride relocation are one
    //      transform ("the same cab, one floor up").
    const gBase = P(0, 0);
    const gbx = ox + gBase.x, gbz = oz + gBase.z;
    const gLoc = (x, z) => ({ lat: (x - gbx) * f.tx + (z - gbz) * f.tz, dep: -((x - gbx) * f.nx + (z - gbz) * f.nz) });
    const gPt = (lat, dep) => ({ x: gbx - f.nx * dep + f.tx * lat, z: gbz - f.nz * dep + f.tz * lat });

    // THE STOPS, bottom to top. The column cabs, plus any landing a floor
    // built for itself: the Executive suite's walnut core (exec_office.js
    // stamps b.execOffice.liftLanding with its own frame, doors, button and
    // collider), which rides in the same machine as a stop of this tower.
    // Floor numbers come off b.floorTops (one arrival Y per storey).
    const ftops = Array.isArray(b.floorTops) && b.floorTops.length >= 2 ? b.floorTops : null;
    const floorOf = (y) => {
      if (!ftops) return Math.round(y / FH);
      let best = 0;
      for (let k = 0; k < ftops.length; k++) if (Math.abs(ftops[k] - y) < Math.abs(ftops[best] - y)) best = k;
      return best;
    };
    const stops = cabs.map(function (c) {
      return { name: c.name, base: c.base, floor: c.floor, rig: c.rig, btn: c.btn, lamp: c.lamp, pad: c.pad,
        btnAt: c.btnAt, panelAt: c.panelAt, btnN: c.btnN, btnFace: c.btnFace, panelN: c.panelN, panelFace: c.panelFace, loc: gLoc, pt: gPt, door: GDOOR, half: 0.9, fwd: { x: -f.nx, z: -f.nz },
        roof: c.roof, no: floorOf(c.base) };
    });
    const xl = b.execOffice && b.execOffice.liftLanding;
    if (xl && xl.rig && xl.base > 3.5 && xl.base < h - 2.8) {
      stops.push({ name: xl.name || ("Floor " + floorOf(xl.base)), base: xl.base, floor: xl.floor != null ? xl.floor : xl.base + 0.02,
        rig: xl.rig, btn: xl.btn || null, lamp: xl.lamp || null, btnIdle: xl.btnIdle || null, btnLit: xl.btnLit || null,
        pad: xl.pad, btnAt: xl.btnAt, panelAt: xl.panelAt, loc: xl.loc, pt: xl.pt, door: xl.door, half: xl.half || 0.9, fwd: xl.fwd || null,
        roof: false, no: floorOf(xl.base), own: true });
      stops.sort((a, c) => a.base - c.base);
    }
    const top = stops[stops.length - 1];

    const rec = {
      lot, b, stops,
      topFloor: top.no,                               // roof floor number (ticker top)
      m: LiftCore.create(stops.length, 0),
      tr: null,                                       // the live trip (see travel)
    };
    lot.building.lift = {
      ground: stops[0].pad, roof: { x: top.pad.x, y: h, z: top.pad.z }, floors: top.no,
      stops: stops.map((s) => ({ name: s.name, y: s.base, x: s.pad.x, z: s.pad.z })),
    };
    elevators.push(rec);
  }

  // ============================ FIRE ESCAPE ===============================
  // Exterior switchback stairs hanging off a ±x facade, street to roof.
  //
  // IT WAS NEVER BUILT, AND IT COULD NOT BE WALKED. buildings.js picked the
  // escape lots out of a list filtered on the dead `hasStairs` gate, so the
  // list was always empty. Had it run: every flight sat in ONE 1.2 m lane,
  // flight k+1 doubling back directly over flight k. Near each landing the
  // two were centimetres apart, so a climber's head was in the next flight,
  // and a descender stepping off a landing was always within STEP_UP of the
  // flight ABOVE (groundAt keeps the higher surface): you could only ever go
  // up. The roof bridge sat 0.75 m over the top landing when STEP_UP is
  // 0.45: the roof was unreachable too.
  //
  // NOW: two lanes side by side (inner = even flights climbing +z, outer =
  // odd flights climbing -z), a full-width grated landing at each end, one
  // storey per flight, CBZ.stairs flights (ramp + landing overlap + AI link)
  // for the walk surface, a y-banded rail between the lanes, and the last
  // flight rising to a bridge deck over the parapet coping, with a short
  // flight down onto the roof. Same-lane flights are two storeys apart.
  const FE_LW = 1.0, FE_GAP = 0.04, FE_LD = 1.2, FE_OFF = 0.15;
  function feGeom(b) {
    const X0 = b.w / 2 + FE_OFF, X1 = X0 + 2 * FE_LW + FE_GAP;
    const hr = Math.min((b.d - 1.2 - 2 * FE_LD) / 2, 3.2);  // half the flight run (27 degrees at 3.2)
    return { X0, X1, hr, xi: X0 + FE_LW / 2, xo: X1 - FE_LW / 2, zMin: -hr - FE_LD, zMax: hr + FE_LD };
  }

  // DOOR-FACE GUARD: the rig must never hang on the facade that holds the
  // entrance, or drop its ground flight across the walk-up to the door.
  function flightCrossesDoor(b, m) {
    const w = b.w, d = b.d, ox = b.ox, oz = b.oz, ds = doorSideOf(b);
    if ((m > 0 ? 3 : 2) === ds) return true;                  // facade IS the door face
    const n = INWARD[ds];
    const dwx = b.door && b.door.x != null ? b.door.x - n.x * 1.6 : (ds === 2 ? ox - w / 2 : ds === 3 ? ox + w / 2 : ox);
    const dwz = b.door && b.door.z != null ? b.door.z - n.z * 1.6 : (ds === 0 ? oz - d / 2 : ds === 1 ? oz + d / 2 : oz);
    const hw = 2.45, L = 4.2;
    const cx0 = Math.min(dwx, dwx - n.x * L) - (n.x ? 0 : hw), cx1 = Math.max(dwx, dwx - n.x * L) + (n.x ? 0 : hw);
    const cz0 = Math.min(dwz, dwz - n.z * L) - (n.z ? 0 : hw), cz1 = Math.max(dwz, dwz - n.z * L) + (n.z ? 0 : hw);
    const G = feGeom(b);
    const fx0 = ox + (m > 0 ? w / 2 - 0.05 : -(G.X1 + 0.4)), fx1 = ox + (m > 0 ? G.X1 + 0.4 : -(w / 2 - 0.05));
    const fz0 = oz + G.zMin - 0.3, fz1 = oz + G.zMax + 0.3;
    return fx0 < cx1 && fx1 > cx0 && fz0 < cz1 && fz1 > cz0;
  }
  // nothing else may stand where the rig hangs (a neighbour's wall, a fence,
  // a kiosk): any collider in the footprint that is not this building's own
  function feFootprintBlocked(b, m) {
    const G = feGeom(b), ox = b.ox, oz = b.oz;
    const x0 = ox + Math.min(m * (b.w / 2 + 0.05), m * (G.X1 + 0.25)), x1 = ox + Math.max(m * (b.w / 2 + 0.05), m * (G.X1 + 0.25));
    const z0 = oz + G.zMin - 0.2, z1 = oz + G.zMax + 0.2;
    const own = new Set(b.colliders || []);
    for (const c of CBZ.colliders) {
      if (own.has(c) || c.maxX <= x0 || c.minX >= x1 || c.maxZ <= z0 || c.minZ >= z1) continue;
      if (c.y1 != null && c.y1 < 0.3) continue;                // kerbs and flat stuff
      if (c.y0 != null && c.y0 > b.h + 1.5) continue;
      return true;
    }
    return false;
  }
  // the top landing's z span and the roof strip its bridge flight lands on
  function feTop(b, m) {
    const G = feGeom(b), S = b.storeys;
    const endDir = ((S - 1) % 2 === 0) ? 1 : -1;               // the last flight's climb direction
    const lz0 = endDir > 0 ? G.hr : -G.hr - FE_LD, lz1 = lz0 + FE_LD;
    const wt = b.wt != null ? b.wt : 0.4;
    const rx0 = b.w / 2 - wt - 2.2, rx1 = b.w / 2;             // bridge + the flight down (building-local)
    return { endDir, lz0, lz1, rect: { x0: Math.min(m * rx0, m * rx1), x1: Math.max(m * rx0, m * rx1), z0: lz0 - 0.2, z1: lz1 + 0.2 } };
  }
  function feRoofClear(b, m) {
    const r = feTop(b, m).rect;
    for (const q of (b.shaftRects || []).concat(b.keepRects || []))
      if (r.x0 < q.x1 + 0.3 && r.x1 > q.x0 - 0.3 && r.z0 < q.z1 + 0.3 && r.z1 > q.z0 - 0.3) return false;
    return true;
  }

  // FACADE PICK (±1 = the +x / -x face, 0 = none). buildings.js stamps a
  // preferred face; the other ±x face is tried too. Never the door face,
  // never across the door walk-up, never into something standing there, and
  // the roof bridge never lands on the stair bulkhead or a lift headhouse.
  function escapeFaceSign(stamp) {
    if (stamp === 2 || stamp === -1) return -1;
    if (stamp === 3 || stamp === 1) return 1;
    return 0;
  }
  function pickEscapeFace(b) {
    const ds = doorSideOf(b);
    let order = ds === 3 ? [-1, 1] : [1, -1];
    const stamped = escapeFaceSign(b.feSide != null ? b.feSide : (b.fireEscapeSide != null ? b.fireEscapeSide : null));
    if (stamped) order = [stamped].concat(order.filter((m) => m !== stamped));
    if (feGeom(b).hr < 1.6) return 0;                        // too shallow a facade for a storey flight
    for (const m of order) {
      if ((m > 0 ? 3 : 2) === ds) continue;
      if (flightCrossesDoor(b, m)) continue;
      if (!feRoofClear(b, m)) continue;
      if (feFootprintBlocked(b, m)) continue;
      return m;
    }
    return 0;
  }

  function buildFireEscape(lot) {
    const b = lot.building, w = b.w, grp = b.group, ox = b.ox, oz = b.oz, h = b.h;
    const m = pickEscapeFace(b);
    if (!m) return;
    const G = feGeom(b), S = b.storeys, T = feTop(b, m);
    const bH = Math.min(1.25, (b.parapetH != null ? b.parapetH : 0.7) + 0.12);   // bridge deck just over the coping
    const W = (x, y, z) => ({ x: ox + m * x, y: y, z: oz + z });
    const xLo = (a, c) => ox + Math.min(m * a, m * c), xHi = (a, c) => ox + Math.max(m * a, m * c);
    const bp = b.platforms || null, bc = b.colliders || null;
    function landPlat(x0, x1, z0, z1, top) {
      const p = plat(xLo(x0, x1), xHi(x0, x1), oz + Math.min(z0, z1), oz + Math.max(z0, z1), top);
      if (bp) bp.push(p);
      return p;
    }
    function feSolid(y0, y1, x0, x1, z0, z1) {
      const c = solid(y0, y1, xLo(x0, x1), xHi(x0, x1), oz + Math.min(z0, z1), oz + Math.max(z0, z1));
      if (bc) bc.push(c);
      return c;
    }
    // ---- THE WALK SURFACE ------------------------------------------------
    const ys = [];
    for (let j = 0; j <= S; j++) ys.push(j === S ? h + bH : j * FH);
    const rWall = w / 2 - (b.wt != null ? b.wt : 0.4);
    for (let k = 0; k < S; k++) {
      const dir = (k % 2 === 0) ? 1 : -1, lx = (k % 2 === 0) ? G.xi : G.xo;
      if (CBZ.stairs) CBZ.stairs.flight({
        bottom: W(lx, ys[k], -dir * G.hr), top: W(lx, ys[k + 1], dir * G.hr),
        width: FE_LW, overlap: 0.35, owner: b, plats: bp || undefined, kind: "fire-escape",
      });
      // the landing it arrives on: full width, both lanes, at its far end
      // (the top one reaches back over the wall as the bridge deck)
      const z0 = dir > 0 ? G.hr - 0.02 : -G.hr - FE_LD, z1 = dir > 0 ? G.hr + FE_LD : -G.hr + 0.02;
      landPlat(k === S - 1 ? rWall - 0.6 : G.X0, G.X1, z0, z1, ys[k + 1]);
      // THE RAIL BETWEEN THE LANES, banded to this flight: it holds a body on
      // its own flight where the other lane's flight passes at a similar height
      const n = Math.max(2, Math.ceil(2 * G.hr / 0.8));
      for (let i = 0; i < n; i++) {
        const s0 = i / n, s1 = (i + 1) / n;
        const za = -dir * G.hr + dir * 2 * G.hr * s0, zb = -dir * G.hr + dir * 2 * G.hr * s1;
        const ya = ys[k] + (ys[k + 1] - ys[k]) * s0, yb = ys[k] + (ys[k + 1] - ys[k]) * s1;
        feSolid(Math.max(ys[k] + 0.1, ya - 0.6), yb + 1.05, G.X0 + FE_LW - 0.01, G.X0 + FE_LW + FE_GAP + 0.01, za, zb);
      }
    }
    // the flight down from the bridge deck onto the roof membrane
    if (CBZ.stairs) CBZ.stairs.flight({
      bottom: W(rWall - 0.6 - 1.5, h, (T.lz0 + T.lz1) / 2), top: W(rWall - 0.6, h + bH, (T.lz0 + T.lz1) / 2),
      width: FE_LD, overlap: 0.3, owner: b, plats: bp || undefined, kind: "fire-escape",
    });
    // outer guard (y-gated above street head height, so peds walk under it)
    feSolid(2.0, h + bH + 1.0, G.X1 - 0.02, G.X1 + 0.1, G.zMin - 0.05, G.zMax + 0.05);
    // end guards past each landing
    feSolid(2.0, h + bH + 1.0, G.X0 - 0.02, G.X1 + 0.1, G.zMin - 0.15, G.zMin - 0.03);
    feSolid(2.0, h + bH + 1.0, G.X0 - 0.02, G.X1 + 0.1, G.zMax + 0.03, G.zMax + 0.15);
    // the bridge's side rails over the roof edge
    for (const zz of [T.lz0 - 0.08, T.lz1 + 0.02]) feSolid(h + bH - 0.05, h + bH + 1.0, rWall - 0.6, G.X0, zz, zz + 0.06);

    // ---- THE STEEL (one merged mesh) ------------------------------------
    const parts = [];
    const pbox = (x, y, z, bw, bh, bd, rx, rz) => {
      const gg = new THREE.BoxGeometry(bw, bh, bd);
      if (rx) gg.rotateX(rx);
      if (rz) gg.rotateZ(rz);
      gg.translate(m * x, y, z);
      parts.push(gg);
    };
    for (let k = 0; k < S; k++) {
      const dir = (k % 2 === 0) ? 1 : -1, lx = (k % 2 === 0) ? G.xi : G.xo;
      const y0 = ys[k], y1 = ys[k + 1], run = 2 * G.hr, rise = y1 - y0;
      const hyp = Math.hypot(run, rise), tilt = -dir * Math.atan2(rise, run), ym = (y0 + y1) / 2;
      for (const sx of [-1, 1]) pbox(lx + sx * (FE_LW / 2 - 0.03), ym - 0.1, 0, 0.06, 0.22, hyp, tilt);    // channel stringers
      const nT = Math.max(8, Math.round(rise / 0.19)), tr = run / nT;
      for (let i = 0; i < nT; i++) {
        const tz = -dir * G.hr + dir * (i + 0.5) * tr, ty = y0 + (i + 1) * rise / nT - 0.02;
        pbox(lx, ty, tz, FE_LW - 0.1, 0.03, tr + 0.02);                                                 // grated tread
      }
      // handrail on the open side (inner flights: the lane rail; outer: the guard)
      const rx = k % 2 === 0 ? G.X0 + FE_LW + FE_GAP / 2 : G.X1 + 0.02;
      pbox(rx, ym + 0.92, 0, 0.045, 0.045, hyp, tilt);
      pbox(rx, ym + 0.46, 0, 0.03, 0.03, hyp, tilt);
      const nB = Math.max(2, Math.round(run / 1.1));
      for (let i = 0; i <= nB; i++) {
        const f = i / nB;
        pbox(rx, y0 + rise * f + 0.46, -dir * G.hr + dir * run * f, 0.035, 0.92, 0.035);
      }
      // the landing it arrives on: angle frame + grating bars
      const lz = dir * (G.hr + FE_LD / 2), ly = y1, LW2 = G.X1 - G.X0, XC = (G.X0 + G.X1) / 2;
      pbox(XC, ly - 0.05, dir * G.hr, LW2, 0.1, 0.05);
      pbox(XC, ly - 0.05, dir * (G.hr + FE_LD), LW2, 0.1, 0.05);
      pbox(G.X0 + 0.02, ly - 0.05, lz, 0.05, 0.1, FE_LD);
      pbox(G.X1 - 0.02, ly - 0.05, lz, 0.05, 0.1, FE_LD);
      for (let i = 0; i < 12; i++) pbox(G.X0 + 0.08 + i * (LW2 - 0.16) / 11, ly - 0.02, lz, 0.035, 0.035, FE_LD);
      pbox(G.X1 + 0.02, ly + 0.95, lz, 0.045, 0.045, FE_LD);                    // landing guard, outer side
      pbox(XC, ly + 0.95, dir * (G.hr + FE_LD + 0.06), LW2, 0.045, 0.045);      // …and the far end
      pbox(G.X1 + 0.02, ly + 0.48, dir * (G.hr + FE_LD + 0.06), 0.045, 0.96, 0.045);
      const br = Math.hypot(LW2 + 0.1, 0.8), ba = Math.atan2(0.8, LW2 + 0.1);
      for (const zz of [dir * (G.hr + 0.1), dir * (G.hr + FE_LD - 0.05)]) {
        pbox(w / 2 + (LW2 + 0.25) / 2, ly - 0.5, zz, br, 0.06, 0.06, 0, m * ba);   // knee brace
        pbox(w / 2 + 0.02, ly - 0.82, zz, 0.04, 0.22, 0.16);                      // anchor plate
      }
    }
    {
      // bridge deck over the parapet + its rails, and the steps down to the roof
      const bx0 = rWall - 0.6, bLen = G.X0 - bx0, bxc = (bx0 + G.X0) / 2, by = h + bH, bz = (T.lz0 + T.lz1) / 2;
      for (let i = 0; i < 10; i++) pbox(bxc, by - 0.02, T.lz0 + 0.06 + i * (FE_LD - 0.12) / 9, bLen, 0.035, 0.035);
      for (const zz of [T.lz0 - 0.05, T.lz1 + 0.05]) {
        pbox(bxc, by + 0.95, zz, bLen, 0.045, 0.045);
        pbox(bx0 + 0.05, by + 0.48, zz, 0.045, 0.96, 0.045);
      }
      const nS = Math.max(3, Math.round(bH / 0.19));
      for (let i = 0; i < nS; i++) {
        const f = (i + 0.5) / nS;
        pbox(bx0 - 1.5 * (1 - f), h + bH * (i + 1) / nS - 0.02, bz, 1.5 / nS + 0.02, 0.04, FE_LD - 0.1);
      }
    }
    const BGU = THREE.BufferGeometryUtils;
    const steelM = cmat(0x2a2d31);
    if (BGU && BGU.mergeBufferGeometries) {
      const merged = BGU.mergeBufferGeometries(parts, false);
      for (const gg of parts) gg.dispose();
      if (merged) {
        const esc = new THREE.Mesh(merged, steelM);
        esc.castShadow = true; esc.receiveShadow = true;
        esc.name = "fire-escape";
        grp.add(esc);
      }
    } else {
      for (const gg of parts) { const e = new THREE.Mesh(gg, steelM); e.receiveShadow = true; grp.add(e); }
    }
    addParapets(lot, { z0: oz + T.lz0 - 0.05, z1: oz + T.lz1 + 0.05, side: m });    // rim colliders, gap at the bridge
    lot.building.fireEscape = { x: ox + m * G.X1, z: oz + (T.lz0 + T.lz1) / 2, topY: h, side: m };
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
  // The machine is systems/liftcore.js (shared with the island tower lifts);
  // this file is the lift's BODY: sealed cab rooms, sliding leafs, the swap.
  // You walk the whole thing, the game never grabs your legs:
  //   [E] / tap "Call" over the call button → the button lights, the car
  //   comes (a beat, if it was parked at another landing) and the doors OPEN.
  //   Walk in. The car's floor panel shows a button per other landing
  //   ("Roof", "Ground", "Penthouse", "Floor 50"): press one → the doors
  //   close (step back out before they shut and the trip cancels) → the car
  //   hums and shakes, and halfway through the player is relocated to the
  //   IDENTICAL sealed cab at the destination in ONE frame, keeping their
  //   spot in the room (the cab has no windows, so the swap can't be seen)
  //   → the doors open where you now stand → you walk out → they close.
  // The doors WAIT while anyone stands in the doorway or in the car: no crush,
  // and a rider is never sealed in. The closed leafs are a real collider, so
  // nothing follows you in and nothing sees the swap.
  //
  // WHY THE CALL IS A PINNED PROMPT (owner, "fix the elevator button opening
  // the elevator"). The call used to be a registry card (zone-lift) and it
  // failed three ways at once:
  //   1. city/interactions.js routes EVERY [E] through cityTryNearestRide()
  //      BEFORE any card, and that router boards any car within 4.8 m in
  //      plain x/z (walls, floors and all) or any aircraft on the camera ray
  //      out to 24 m. The mega-tower lobby IS a parking deck (deckCars): [E]
  //      at its lift got you into a parked car instead.
  //   2. css/campaign.css hides #interact with !important during a campaign
  //      (the Gang Life opening), so on a keyboard the lift had no visible
  //      prompt at all.
  //   3. the card competed on score with every ped, door and counter nearby.
  // Now the verb is pinned over the button itself (systems/interactions.js
  // prisonPrompt, bound to its key in the capture phase, so no other [E]
  // listener fires on the same press) and on touch the same pill is the tap.
  // One control per verb: the registry zone is deleted.
  const LiftCore = CBZ.liftCore;
  const ROW_KEYS = ["e", "q", "r", "t"];     // the car's floor buttons, in panel order
  function rideTime(el, from, to) {
    const d = Math.abs(el.stops[to].no - el.stops[from].no);
    return Math.max(3.0, Math.min(6.0, 2.0 + d * 0.18));
  }
  function comeTime(el, from, to) {
    const d = Math.abs(el.stops[to].no - el.stops[from].no);
    return Math.max(0.8, Math.min(1.8, 0.6 + d * 0.03));
  }
  // ACCEL/DECEL weight envelope: 0 at the ends, ~1 at cruise, with a quick
  // ease-in and a longer ease-out so the cab feels like it leans into the climb
  // then settles. Drives the shake magnitude so the camera bobs with momentum.
  function rideEnvelope(p) {
    const aIn = 0.22, aOut = 0.30;          // ramp-up / ramp-down fractions of the ride
    if (p < aIn) { const x = p / aIn; return x * x * (3 - 2 * x); }            // smoothstep in
    if (p > 1 - aOut) { const x = (1 - p) / aOut; return x * x * (3 - 2 * x); } // smoothstep out
    return 1;
  }

  // the call buttons + hall lanterns: lit from the press until the doors shut
  function setLit(el, on) {
    for (const s of el.stops) {
      if (s.btn) s.btn.material = on ? (s.btnLit || BTN_LIT()) : (s.btnIdle || BTN_IDLE());
      if (s.lamp) s.lamp.material = on ? LAMP_LIT() : LAMP_IDLE();
    }
  }

  // The sound follows the same target transition that moves the two visible
  // leafs. No panel state, teleport or elevator UI is allowed to impersonate a
  // door; callers opt into audio only while the player is at/in this cab.
  function setDoorTarget(r, open, audible) {
    const target = open ? 1 : 0;
    if (r.target === target) return false;
    r.target = target;
    if (audible && CBZ.sfx) CBZ.sfx(open ? "door_open" : "door_close");
    return true;
  }
  // is the player on this landing's floor (feet from just under the sill to
  // head height over it)?
  function onLevel(s, P) { const dy = P.pos.y - s.base; return dy > -0.6 && dy < 2.2; }
  // is the player INSIDE the cab room at stop i?
  function insideCab(el, i, P) {
    const s = el.stops[i];
    if (!P || !s || !onLevel(s, P)) return false;
    const L = s.loc(P.pos.x, P.pos.z);
    return L.dep > 0.18 && L.dep < s.door - 0.15 && Math.abs(L.lat) < s.half;
  }
  // is the player standing IN the doorway (the leaf line) at stop i? Doors
  // wait. EXCLUDES the cab interior: a rider near the front of the cab is a
  // RIDER, not an obstruction (otherwise the doors could never close on them).
  function inDoorway(el, i, P) {
    const s = el.stops[i];
    if (!P || !s || !onLevel(s, P)) return false;
    if (insideCab(el, i, P)) return false;
    const L = s.loc(P.pos.x, P.pos.z);
    return Math.abs(L.lat) < 0.95 && L.dep > s.door - 0.45 && L.dep < s.door + 0.55;
  }
  function nearStop(s, P) {
    return !!(P && Math.abs(P.pos.y - s.base) < 4 && Math.hypot(P.pos.x - s.pad.x, P.pos.z - s.pad.z) < 10);
  }

  // hard snap a rig shut (mode exit / mid-ride abort): leaves home, collider solid
  function closeNow(r) {
    r.open = 0; r.target = 0; r.autoClose = null; r.autoCloseAudible = false;
    for (const L of r.leaves) { L.m.position.x = L.baseX; L.m.position.z = L.baseZ; }
    gateDoor(r);
  }

  // ---- the tiny floor-ticker chip (one DOM node, hidden when idle) ----------
  // STATUS ONLY: the floor ticker while a car runs, nothing else. It is in
  // css/city.css's live-world declutter list (a keyboard player reads the
  // ride off the shake and the ding); mobile.css shows it on a touchscreen.
  // It once carried a call pill as well, and for a day the lift had TWO touch
  // buttons (a chip pill beside a registry card). The call lives on the
  // button in the world now; this chip is never a control again.
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
  // PERF: callers run at frame rate (the ride ticker): skip the DOM writes
  // unless the text actually changed.
  let _chipLast;
  function chipText(t) {
    if (t === _chipLast) return;
    dom(); if (!chip) return;
    _chipLast = t;
    if (!t) { chip.style.display = "none"; return; }
    if (CBZ.touchPromptChip) { CBZ.touchPromptChip(chip, t); return; }
    chip.style.display = "block"; chip.innerHTML = t;
  }

  // the nearest call pad the player stands at (on that landing's floor, out
  // of the cab), or null
  function padNear(P) {
    if (!P) return null;
    let best = null;
    for (const el of elevators) {
      for (let i = 0; i < el.stops.length; i++) {
        const s = el.stops[i];
        if (Math.abs(P.pos.y - s.base) > 1.6) continue;
        const d = Math.hypot(P.pos.x - s.pad.x, P.pos.z - s.pad.z);
        if (d > REACH || insideCab(el, i, P)) continue;
        if (!best || d < best.d) best = { el, i, d };
      }
    }
    return best;
  }
  // would pressing Call at stop i do anything the player can see? Hidden
  // while the doors there are already open, while a rider is leaving from
  // there, or for the beat after they shut (a mashed key cannot flap them).
  function callOffered(m, i) {
    if (m.st === "ride") return false;
    if (m.at === i && m.st === "open") return false;
    if (m.at === i && m.st === "close" && m.dest >= 0) return false;
    if (m.at === i && m.st === "idle" && m.cool > 0) return false;
    return true;
  }

  function animRig(r, dt) {
    if (r.autoClose != null) {
      r.autoClose -= dt;
      if (r.autoClose <= 0) {
        r.autoClose = null;
        setDoorTarget(r, false, !!r.autoCloseAudible);
        r.autoCloseAudible = false;
      }
    }
    // PERF: doors at rest = leaves already sit at the pose: skip the per-leaf
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
  // passable): the broadphase only indexes xz, so this never rebuilds.
  // NOTE: collide() callers that omit feetY/headY treat every y-gated box as
  // full-height, i.e. the leaf line stays solid for them even when open.
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
    if (P._phys) { P._phys.air = false; P._phys.vx = P._phys.vz = P._phys.vy = 0; }
    if (CBZ.playerChar) CBZ.playerChar.group.position.copy(P.pos);
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const yawOf = (v) => Math.atan2(-v.x, -v.z);

  // THE SWAP: one frame, inside the sealed cab. Carry the player's spot in
  // the room over to the cab at the destination (clamped well inside its
  // walls), feet on that cab's OWN floor slab (the height we built, never a
  // floorAt guess, so the ride cannot resolve back to the origin floor), and
  // turn the view with the room when the two cabs face different ways.
  function swap(el, from, to, P) {
    const a = el.stops[from], b2 = el.stops[to];
    const L = a.loc(P.pos.x, P.pos.z);
    const pt = b2.pt(clamp(L.lat, -0.7, 0.7), clamp(L.dep, 0.35, b2.door - 0.5));
    teleport(pt.x, b2.floor + 0.04, pt.z);
    if (a.fwd && b2.fwd && CBZ.cam && typeof CBZ.cam.yaw === "number") {
      const dy = yawOf(b2.fwd) - yawOf(a.fwd);
      if (Math.abs(dy) > 1e-4) CBZ.cam.yaw += dy;
    }
  }

  // one trip leg for the machine: an empty car coming to a call (a beat,
  // scaled by distance) or the rider's ride (hum, shake, the swap halfway)
  let shakeT = 0, humT = 0, ticker = null;
  function travel(el, m, dt, P) {
    const riding = m.st === "ride", from = m.at, to = m.dest;
    const dur = riding ? rideTime(el, from, to) : comeTime(el, from, to);
    if (!riding) return m.t >= dur;
    const p = Math.min(1, m.t / dur), env = rideEnvelope(p);
    if (m.t <= dt + 1e-6) { shakeT = 0; humT = 0; if (CBZ.shake) CBZ.shake(0.2); }
    shakeT += dt;
    if (shakeT > 0.32) { shakeT = 0; if (CBZ.shake) CBZ.shake(0.025 + 0.075 * env); }
    humT += dt;
    if (humT > (1.4 - 0.5 * env) && CBZ.sfx) { humT = 0; CBZ.sfx("rumble"); }
    if (!m.moved && m.t >= dur * 0.5 && P) { swap(el, from, to, P); m.moved = true; }
    // floor ticker: count THROUGH toward the destination
    const f0 = el.stops[from].no, f1 = el.stops[to].no, up = f1 > f0;
    const fl = Math.round(f0 + (f1 - f0) * p);
    const fn = (n) => (n <= 0 ? "G" : n + "F");
    ticker = (up ? "▲ " : "▼ ") + fn(fl) + "  →  " + fn(f1);
    return m.t >= dur;
  }

  function ioFor(el, P) {
    return {
      inside: (i) => insideCab(el, i, P),
      doorway: (i) => inDoorway(el, i, P),
      doorOpen: (i) => el.stops[i].rig.open,
      door: (i, open) => setDoorTarget(el.stops[i].rig, open, nearStop(el.stops[i], P)),
      seal: (i) => gateDoor(el.stops[i].rig),
      travel: (m, dt) => travel(el, m, dt, P),
      arrive: (i, rode) => {
        if (!rode) return;
        if (CBZ.shake) CBZ.shake(0.25);
        const s = el.stops[i];
        if (CBZ.city && CBZ.city.note) {
          CBZ.city.note(i === el.stops.length - 1 && s.roof ? ("" + s.no + " floors up, the roof is yours.")
            : i === 0 ? "Ground floor." : s.name + ".", 2);
        }
      },
      lit: (on) => setLit(el, on),
      sfx: (s) => { if (CBZ.sfx && nearStop(el.stops[el.m.at], P)) CBZ.sfx(s); },
    };
  }

  // ---- the controls: the verb pinned over the thing, one control per verb --
  // Armed every frame from the update below; the pill (tap) and the bound key
  // both land in these named functions (a pill must name a CBZ function).
  let callArm = null;
  const goArm = [];
  /* A BUTTON IS PRESSED BY A FINGER (systems/verbs_pickup.js CBZ.verbs.touch
     "press"): the index pad goes onto the button's own face, pressing along
     its normal. A landing that published no normal (an older record) is
     pressed facing the player. */
  function liftPress(face, at, n, P, key) {
    const V = CBZ.verbs;
    const pt = face || at;
    if (!V || !V.touch || !pt || !P || !P.pos) return;
    let nx = n ? n.x : P.pos.x - pt.x, nz = n ? n.z : P.pos.z - pt.z;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    try { V.touch(P, { point: pt, normal: { x: nx, y: 0, z: nz }, kind: "press", key: key, again: true }); } catch (e) {}
  }
  CBZ.cityLiftCall = function () {
    const a = callArm, P = CBZ.player;
    if (!a || !P || P.dead || P.driving) return false;
    const st = a.el.stops[a.i];
    if (st) liftPress(st.btnFace, st.btnAt, st.btnN || st.fwd, P, "lift-call");
    return LiftCore.call(a.el.m, a.i, ioFor(a.el, P));
  };
  for (let r = 0; r < ROW_KEYS.length; r++) {
    CBZ["cityLiftGo" + r] = function () {
      const a = goArm[r], P = CBZ.player;
      if (!a || !P || P.dead || P.driving) return false;
      const here = a.el.stops[a.el.m.at];
      if (here) liftPress(here.panelFace, here.panelAt, here.panelN, P, "lift-go");
      return LiftCore.go(a.el.m, a.j, ioFor(a.el, P));
    };
  }
  // the car's floor buttons from stop `at`: the natural trip first (down to
  // the ground from anywhere above it, up to the top from the ground), then
  // the rest top-down, the way a lift panel reads
  function destOrder(el, at) {
    const n = el.stops.length, first = at === 0 ? n - 1 : 0, out = [first];
    for (let j = n - 1; j >= 0; j--) if (j !== at && j !== first) out.push(j);
    return out.slice(0, ROW_KEYS.length);
  }
  function armControls(P) {
    callArm = null; goArm.length = 0;
    if (!P || P.dead || P.driving || !CBZ.prisonPrompt || CBZ.cityMenuOpen) return;
    for (const el of elevators) {
      const m = el.m;
      if ((m.st === "open" || m.st === "idle") && insideCab(el, m.at, P)) {
        const here = el.stops[m.at], order = destOrder(el, m.at);
        for (let row = 0; row < order.length; row++) {
          goArm[row] = { el: el, j: order[row] };
          CBZ.prisonPrompt("lift-go-" + row, "@cityLiftGo" + row, el.stops[order[row]].name,
            { at: here.panelAt, key: ROW_KEYS[row], bind: true, group: "lift-car", row: row, d2: 0.01, city: true });
        }
        return;
      }
    }
    const near = padNear(P);
    if (near && callOffered(near.el.m, near.i)) {
      callArm = near;
      CBZ.prisonPrompt("lift-call", "@cityLiftCall", "Call",
        { at: near.el.stops[near.i].btnAt, key: "e", bind: true, d2: Math.min(near.d * near.d, 0.3), city: true });
    }
  }
  (CBZ._prisonPromptSites || (CBZ._prisonPromptSites = [])).push(
    { id: "lift-call", act: "@cityLiftCall", was: "CALL THE LIFT card (zone-lift), hidden in campaigns and beaten to [E] by the ride router", now: "Call, over the call button" },
    { id: "lift-go-0", act: "@cityLiftGo0", was: "walking in rode you to the only other end", now: "the landing's name, on the car's floor panel" }
  );

  CBZ.onUpdate(36.6, function (dt) {
    if (g.mode !== "city") {
      // mode exit mid-cycle: if the player was sealed in a ride, put them
      // back on the ground apron (a known-safe spot) before the city sleeps.
      // Guarded so other modes pay one compare per lift, not a door reset.
      for (const el of elevators) {
        const m = el.m;
        let busy = m.st !== "idle";
        for (const s of el.stops) if (s.rig.open || s.rig.target) busy = true;
        if (!busy) continue;
        if (m.st === "ride" && CBZ.player) teleport(el.stops[0].pad.x, el.stops[0].floor - 0.02, el.stops[0].pad.z);
        m.st = "idle"; m.dest = -1; m.queued = -1; m.t = 0; m.at = 0; m.cool = 0;
        setLit(el, false);
        for (const s of el.stops) closeNow(s.rig);
      }
      chipText(null);
      return;
    }
    if (!built) { const A = CBZ.city && CBZ.city.arena; if (A && A.lots) buildAll(A); if (!built) return; }

    const P = CBZ.player;
    // door animation + collider gate (cheap: only moves while a target differs)
    for (const el of elevators) {
      for (const s of el.stops) { animRig(s.rig, dt); gateDoor(s.rig); }
    }

    ticker = null;
    for (const el of elevators) {
      const m = el.m;
      if (m.st === "idle") {
        if (m.cool > 0) m.cool = Math.max(0, m.cool - dt);
        // RESCUE: a player standing inside a sealed idle cab gets its doors
        // opened: no path may ever leave someone entombed.
        if (P && !P.dead) {
          for (let i = 0; i < el.stops.length; i++) {
            if (el.stops[i].rig.open < 0.1 && insideCab(el, i, P)) { LiftCore.rescue(m, i, ioFor(el, P)); break; }
          }
        }
        continue;
      }
      // player gone (died / got in a car): the doors open where they are,
      // close themselves shortly after, and the car goes back to idle, so
      // nobody's corpse is sealed in a box.
      if (!P || P.dead || P.driving) {
        const where = m.st === "ride" && m.moved ? m.dest : m.at;
        const r = el.stops[where].rig;
        setDoorTarget(r, true, false); r.autoClose = 2.0; r.autoCloseAudible = false;
        m.at = where; m.queued = -1;
        LiftCore.settleIdle(m, ioFor(el, P), LiftCore.CALL_COOL);
        continue;
      }
      LiftCore.step(m, dt, ioFor(el, P));
    }
    chipText(ticker);
    armControls(P);
  });

  // ======================================================================
  //  THE INTERIOR STAIR CORE — CBZ.cityStairCore(lot, opts)
  //
  //  The one way up a city building on foot. Every multi-storey shell
  //  reserves a core at birth (buildings.js CBZ.cityStairPlan: a back corner,
  //  flush to the far wall and one side wall, its door facing the room); this
  //  builds it — the first time somebody walks up to the building (the scan
  //  at the bottom of this section), or when occupy/gang/govcomplex ask.
  //
  //  THE RIG, per storey k (tops[k] -> tops[k+1]):
  //    the arrival strip inside the door (flat, both lanes)
  //    flight A up lane A, away from the door, to the half landing
  //    the half landing across the far end (flat, both lanes)
  //    flight B up lane B, back toward the door, onto the next strip.
  //  The walk surface of each flight is CBZ.stairs.flight (one ramp record,
  //  flat overlap into both landings, owner = the building so demolition /
  //  removeOwner take it). Landings are flat platforms that meet the flights'
  //  overlap. Between the lanes a stepped rail collider, banded to the
  //  flights, keeps a body on its own flight (the other lane runs up to a
  //  storey above or below it). The highest level the stair reaches gets a
  //  guard across the open well.
  //
  //  HEADROOM (FH 3.2, slab 0.2): every walk surface in the core has the one
  //  above it a full storey higher (lane A over lane A, strip over strip,
  //  half landing over half landing), i.e. 3.0 m clear. The two places that
  //  break that rule are handled: the ground floor under flight B (nothing
  //  below lane B there — a closet collider stops a body walking under the
  //  low end), and the top: the stair either stops a storey short under the
  //  intact roof, or the roof is carved over the core and a stair BULKHEAD
  //  (walls + a lid 2.7 m over the roof) stands over it with a door out.
  //
  //  AI: one CBZ.stairs link per storey, from just outside the stair door on
  //  floor k to just outside it on floor k+1, through the door, up both
  //  flights and out again. CBZ.stairs.route chains them; rec.route(k0, k1)
  //  is exactly those paths concatenated (the same objects), so the two agree.
  // ======================================================================
  const CORE_RISE = 0.185;     // target riser
  const CORE_LD = 1.3;         // landing depth at each end of a flight
  const CORE_SEAM = 0.02;      // the rail's slot between the lanes
  const CORE_DOORHALF = 0.9, CORE_DOORH = 2.15;
  const CORE_BULK_H = 2.7;     // stair bulkhead: clear height over the roof
  const COREC = { tread: 0x8b929b, riser: 0x5d646d, soffit: 0x7a818a, land: 0xb9bec6, rail: RAILC, lamp: 0xeef2ff };

  function coreOf(b) {
    if (!b) return null;
    const g = b.group && b.group.userData;
    return b._stairCore || (g && g.stairCore) || (g && g.bld && g.bld._stairCore) || null;
  }

  // remove every collider / raised walk top of building b lying within the
  // core rect (building-local `hole`, 0.3 m slack); returns how many went
  function clearCore(b, hole, groundTop) {
    const x0 = b.ox + hole.x0 - 0.3, x1 = b.ox + hole.x1 + 0.3, z0 = b.oz + hole.z0 - 0.3, z1 = b.oz + hole.z1 + 0.3;
    const inside = (r) => r.minX >= x0 && r.maxX <= x1 && r.minZ >= z0 && r.maxZ <= z1;
    let n = 0;
    const hide = (m) => {
      if (!m || !m.isMesh) return;
      if (!(CBZ.batchWallHide && CBZ.batchWallHide(m))) m.visible = false;
      for (const L of [CBZ.losBlockers, b.losMeshes]) { const i = L ? L.indexOf(m) : -1; if (i >= 0) L.splice(i, 1); }
    };
    for (const c of (b.colliders || []).slice()) {
      if (!inside(c)) continue;
      for (const L of [CBZ.colliders, b.colliders]) { const i = L.indexOf(c); if (i >= 0) L.splice(i, 1); }
      hide(c.ref); n++;
    }
    for (const p of (b.platforms || []).slice()) {
      if (!inside(p) || p.ramp || p.stair || !(p.top > groundTop + 0.05)) continue;
      for (const L of [CBZ.platforms, b.platforms]) { const i = L.indexOf(p); if (i >= 0) L.splice(i, 1); }
      hide(p.ref); n++;
    }
    if (n) { if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty(); }
    return n;
  }

  CBZ.cityStairCore = function (lot, opts) {
    opts = opts || {};
    const b = lot && lot.building;
    if (!b || !b.group || b.w == null || b.d == null) return null;
    const had = coreOf(b);
    if (had) { b._stairCore = had; return had; }
    if (b._stairCoreFailed) return null;
    const FHl = b.FH != null ? b.FH : FH;
    const tops = (Array.isArray(b.floorTops) && b.floorTops.length >= 2)
      ? b.floorTops
      : (function () { const o = [0.14]; for (let L = 1; L <= (b.storeys || 1); L++) o.push(L * FHl); return o; })();
    const nFloors = tops.length - 1;                       // interior floors (tops[nFloors] is the roof)
    if (nFloors < 2) return null;
    const roofAccess = opts.roof !== false && !b.roofCrowned && !!b.roofSlab;
    const kTop = roofAccess ? nFloors : nFloors - 1;       // the highest level the stair reaches
    let P = b.stairPlan || null;
    if (!P && CBZ.cityStairPlan) {
      P = CBZ.cityStairPlan(b, opts.side);
      if (P) {                                             // a shell made before plans existed: reserve now
        b.stairPlan = P;
        if (b.shaftRects) b.shaftRects.push(P.rect);
        if (b.keepRects) b.keepRects.push(P.mouth);
      }
    }
    if (!P) { b._stairCoreFailed = true; return null; }
    // a lift chase (or anything else reserved) inside the core would be walked
    // through: never build over one — the plan avoids them, this is the proof
    for (const r of (b.shaftRects || [])) {
      if (r === P.rect) continue;
      if (r.x0 < P.hole.x1 - 0.01 && r.x1 > P.hole.x0 + 0.01 && r.z0 < P.hole.z1 - 0.01 && r.z1 > P.hole.z0 + 0.01) {
        b._stairCoreFailed = true; return null;
      }
    }

    const side = P.side, D0 = P.D0, D1 = P.D1, L0 = P.L0, L1 = P.L1, latMid = P.latMid;
    const laneA0 = L0, laneA1 = latMid - side * CORE_SEAM / 2, laneB0 = latMid + side * CORE_SEAM / 2, laneB1 = L1;
    const aC = (laneA0 + laneA1) / 2, bC = (laneB0 + laneB1) / 2, laneW = Math.abs(laneA1 - laneA0);
    const dA0 = D0 + CORE_LD, dA1 = D1 - CORE_LD, runLen = dA1 - dA0;
    const ox = b.ox, oz = b.oz;
    const Wp = function (dep, lat, y) { const p = P.pt(dep, lat); return { x: ox + p.x, y: y, z: oz + p.z }; };
    function wrect(d0, d1, l0, l1) {
      const r = P.rect2(d0, d1, l0, l1);
      return { minX: ox + r.x0, maxX: ox + r.x1, minZ: oz + r.z0, maxZ: oz + r.z1 };
    }
    const cols = [], plats = [];
    function addPlat(d0, d1, l0, l1, top) {
      const p = wrect(d0, d1, l0, l1); p.top = top;
      CBZ.platforms.push(p); plats.push(p);
      if (b.platforms) b.platforms.push(p);
      return p;
    }
    function addSolid(d0, d1, l0, l1, y0, y1, ref) {
      const p = wrect(d0, d1, l0, l1);
      const c = { minX: p.minX, maxX: p.maxX, minZ: p.minZ, maxZ: p.maxZ, y0: y0, y1: y1, ref: ref || null };
      CBZ.colliders.push(c); cols.push(c);
      if (b.colliders) b.colliders.push(c);
      return c;
    }

    // ---- DECO, merged: one mesh per colour for the whole core -------------
    const parts = new Map();
    function part(hex, g) { let a = parts.get(hex); if (!a) parts.set(hex, a = []); a.push(g); }
    // an axis box in (dep, lat) terms: centre, extents along depth / across
    function dbox(hex, dep, lat, y, dd, ll, hh) {
      const p = P.pt(dep, lat);
      const g = new THREE.BoxGeometry(P.along ? dd : ll, hh, P.along ? ll : dd);
      g.translate(p.x, y, p.z);
      part(hex, g);
    }
    // a slab tilted along the depth axis from (d0,y0) to (d1,y1), centred on lat
    function slope(hex, d0, y0, d1, y1, lat, ll, th) {
      const run = d1 - d0, rise = y1 - y0, len = Math.hypot(run, rise);
      const g = new THREE.BoxGeometry(ll, th, len);          // local: x across, z along
      g.rotateX(-Math.atan2(rise, Math.abs(run)));            // +z climbs
      const ux = P.nx * Math.sign(run), uz = P.nz * Math.sign(run);
      g.rotateY(Math.atan2(ux, uz));                          // +z -> the climb direction
      const m = P.pt((d0 + d1) / 2, lat);
      g.translate(m.x, (y0 + y1) / 2, m.z);
      part(hex, g);
    }

    // ---- CARVE the core out of every slab it rises through (and the roof
    // when it surfaces). buildings.js owns the slabs and the carve; the core's
    // footprint is already reserved, so the carve does not reserve again.
    if (CBZ.cityCarveShaft) {
      const h = P.hole;
      CBZ.cityCarveShaft(b, ox + (h.x0 + h.x1) / 2, oz + (h.z0 + h.z1) / 2, (h.x1 - h.x0) / 2, (h.z1 - h.z0) / 2,
        { roof: roofAccess, reserve: false });
    }

    // ---- THE CORE IS EMPTY. Anything a furnisher stood inside the core's
    // footprint (a piece that ignored the reservation) is taken out — its
    // collider, its walk top, its mesh — before a flight is laid through it.
    const cleared = clearCore(b, P.hole, tops[0]);

    // ---- THE SHAFT: one wall on the open lateral side, two door stubs across
    // the mouth, a header over each floor's doorway. The far and side walls
    // are the building's own. With roof access all of it rises into the
    // bulkhead, which adds its own far/side walls over the parapet and a lid.
    const roofY = tops[nFloors];
    const wallTop = roofAccess ? roofY + CORE_BULK_H : roofY;
    function wall(d0, d1, l0, l1, y0, y1, los) {
      const r = P.rect2(d0, d1, l0, l1);
      const m = box(b.group, (r.x0 + r.x1) / 2, (y0 + y1) / 2, (r.z0 + r.z1) / 2,
        Math.max(0.05, r.x1 - r.x0), y1 - y0, Math.max(0.05, r.z1 - r.z0), SHAFT);
      addSolid(d0, d1, l0, l1, y0, y1, m);
      if (los !== false) { if (CBZ.losBlockers) CBZ.losBlockers.push(m); if (b.losMeshes) b.losMeshes.push(m); }
      return m;
    }
    wall(D0 - 0.09, D1, L0 - side * 0.09, L0 + side * 0.09, 0, wallTop);                  // the shaft wall (lane A's outer side)
    const dL0 = latMid - side * CORE_DOORHALF, dL1 = latMid + side * CORE_DOORHALF;
    if (Math.abs(dL0 - L0) > 0.12) wall(D0 - 0.09, D0 + 0.09, L0, dL0, 0, wallTop);       // door stubs
    if (Math.abs(L1 - dL1) > 0.12) wall(D0 - 0.09, D0 + 0.09, dL1, L1, 0, wallTop);
    for (let k = 0; k <= kTop; k++) {                                                      // header over each doorway
      const hy0 = tops[k] + CORE_DOORH, hy1 = k < nFloors ? tops[k + 1] : wallTop;
      if (hy1 - hy0 > 0.1) wall(D0 - 0.09, D0 + 0.09, dL0, dL1, hy0, hy1);
    }
    if (roofAccess) {
      // THE BULKHEAD: far + side walls standing on the building's own walls
      // (outside the core, so they never crowd a landing), and a lid
      const wt = b.wt != null ? b.wt : 0.4;
      wall(D1, D1 + Math.min(0.2, wt), L0 - side * 0.09, L1 + side * Math.min(0.2, wt), roofY, wallTop);
      wall(D0 - 0.09, D1 + Math.min(0.2, wt), L1, L1 + side * Math.min(0.2, wt), roofY, wallTop);
      const lr = P.rect2(D0 - 0.2, D1 + Math.min(0.2, wt), L0 - side * 0.2, L1 + side * Math.min(0.2, wt));
      const lid = box(b.group, (lr.x0 + lr.x1) / 2, wallTop + 0.1, (lr.z0 + lr.z1) / 2, lr.x1 - lr.x0, 0.2, lr.z1 - lr.z0, PH_COPING, { cast: true });
      if (CBZ.losBlockers) CBZ.losBlockers.push(lid);
      if (b.losMeshes) b.losMeshes.push(lid);
    }

    // ---- THE WALK SURFACE --------------------------------------------------
    const flights = [];
    for (let k = 0; k <= kTop; k++) {
      // arrival strip at every level the stair serves (the ground one sits on
      // the foundation, every other one in the carved hole)
      addPlat(D0 - 0.05, dA0 + 0.02, L0, L1, tops[k]);
      if (k > 0) dbox(COREC.land, (D0 + dA0) / 2, latMid, tops[k] - 0.1, dA0 - D0, Math.abs(L1 - L0), 0.2);
    }
    for (let k = 0; k < kTop; k++) {
      const y0 = tops[k], y2 = tops[k + 1], y1 = (y0 + y2) / 2;
      addPlat(dA1 - 0.02, D1, L0, L1, y1);                                                  // half landing
      dbox(COREC.land, (dA1 + D1) / 2, latMid, y1 - 0.1, D1 - dA1, Math.abs(L1 - L0), 0.2);
      const fA = CBZ.stairs && CBZ.stairs.flight({
        bottom: Wp(dA0, aC, y0), top: Wp(dA1, aC, y1), width: laneW, overlap: 0.35,
        owner: b, plats: b.platforms || undefined, link: false, kind: "stair",
      });
      const fB = CBZ.stairs && CBZ.stairs.flight({
        bottom: Wp(dA1, bC, y1), top: Wp(dA0, bC, y2), width: laneW, overlap: 0.35,
        owner: b, plats: b.platforms || undefined, link: false, kind: "stair",
      });
      if (fA) plats.push(fA.plat);
      if (fB) plats.push(fB.plat);
      flights.push(fA, fB);
      // THE RAIL BETWEEN THE LANES: stepped, each step banded from lane A's
      // tread under it to a handrail over lane B's (lane B is the higher one
      // everywhere in a storey: yB - yA = FH (1 - f)), so a body on either
      // flight is held off the seam and nobody is walled off along it
      const nSeg = Math.max(3, Math.ceil(runLen / 0.5));
      for (let i = 0; i < nSeg; i++) {
        const f0 = i / nSeg, f1 = (i + 1) / nSeg;
        const s0 = dA0 + 0.05 + (runLen - 0.1) * f0, s1 = dA0 + 0.05 + (runLen - 0.1) * f1;
        const yA0 = y0 + (y1 - y0) * ((s0 - dA0) / runLen), yB0 = y2 - (y2 - y1) * ((s0 - dA0) / runLen);
        addSolid(s0, s1, latMid - side * CORE_SEAM / 2, latMid + side * CORE_SEAM / 2, yA0 + 0.1, yB0 + 1.0);
      }
      // ---- the stair you see: treads + risers, a sloped soffit under each
      // flight, a handrail + balusters on the open (centre) edge ------------
      const nSteps = Math.max(2, Math.round((y1 - y0) / CORE_RISE));
      const rise = (y1 - y0) / nSteps, go = runLen / nSteps;
      for (let lane = 0; lane < 2; lane++) {
        const lc = lane === 0 ? aC : bC, base = lane === 0 ? y0 : y1;
        for (let i = 1; i <= nSteps; i++) {
          const vt = base + i * rise;
          const dC = lane === 0 ? dA0 + (i - 0.5) * go : dA1 - (i - 0.5) * go;
          const dR = lane === 0 ? dA0 + (i - 1) * go : dA1 - (i - 1) * go;
          dbox(COREC.tread, dC, lc, vt - 0.025, go + 0.03, laneW - 0.04, 0.05);
          dbox(COREC.riser, dR, lc, vt - rise / 2, 0.03, laneW - 0.06, rise);
        }
        const dF = lane === 0 ? dA0 : dA1, dT = lane === 0 ? dA1 : dA0;
        slope(COREC.soffit, dF, base - 0.16, dT, base + (y1 - y0) - 0.16, lc, laneW - 0.02, 0.14);
        const railLat = latMid + (lane === 0 ? -side : side) * 0.06;
        slope(COREC.rail, dF, base + 0.92, dT, base + (y1 - y0) + 0.92, railLat, 0.05, 0.06);
        for (let i = 0; i <= nSteps; i += 2) {
          const dAt = lane === 0 ? dA0 + i * go : dA1 - i * go;
          dbox(COREC.rail, dAt, railLat, base + i * rise + 0.46, 0.035, 0.035, 0.92);
        }
      }
      // a strip light over each half landing so the shaft is never a black hole
      const lampY = k + 1 < kTop ? y1 + FHl - 0.3 : (roofAccess ? wallTop - 0.08 : roofY - 0.28);
      dbox(COREC.lamp, dA1 + CORE_LD / 2, latMid, lampY, 0.4, 1.5, 0.06);
    }
    // THE GROUND FLOOR UNDER FLIGHT B: nothing below lane B there, and the
    // flight and its half landing are 1.4-1.6 m over the ground floor at the
    // far end. A closet collider under them (banded below lane B's lowest
    // walk height, 0.25 under the half landing) stops a body walking in under.
    if (kTop >= 1) {
      const y1g = (tops[0] + tops[1]) / 2;
      addSolid(dA0 + 0.3, D1, laneB0, laneB1, tops[0] - 0.3, y1g - 0.25);
      const panTop = tops[1] - (tops[1] - y1g) * (0.31 / runLen) - 0.2;                         // flight B's underside there
      dbox(COREC.soffit, dA0 + 0.31, bC, (tops[0] + panTop) / 2, 0.06, laneW, panTop - tops[0]);  // its front panel
    }
    // THE GUARD across the open well at the top level (lane A: the flight that
    // would have climbed on is not there)
    {
      const yT = tops[kTop];
      addSolid(dA0 - 0.03, dA0 + 0.03, L0, latMid, yT, yT + 1.05);
      dbox(COREC.rail, dA0, (L0 + latMid) / 2, yT + 1.0, 0.06, laneW, 0.06);
      dbox(COREC.rail, dA0, (L0 + latMid) / 2, yT + 0.5, 0.04, laneW, 0.04);
    }
    // merge the deco: one mesh per colour
    {
      const BGU = THREE.BufferGeometryUtils;
      parts.forEach(function (list, hex) {
        const mat = hex === COREC.lamp ? cmat(hex, { emissive: hex, ei: 0.3 }) : cmat(hex);
        if (BGU && BGU.mergeBufferGeometries) {
          const g = BGU.mergeBufferGeometries(list, false);
          for (const q of list) q.dispose();
          if (g) { const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.name = "stair-core"; b.group.add(m); }
        } else for (const q of list) { const m = new THREE.Mesh(q, mat); m.receiveShadow = true; b.group.add(m); }
      });
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();

    // ---- THE AI LINKS: one per storey, stair door to stair door ------------
    const OUT = 0.9, IN = 0.45;
    const storeyPaths = [];
    for (let k = 0; k < kTop; k++) {
      const y0 = tops[k], y2 = tops[k + 1], y1 = (y0 + y2) / 2;
      const path = [
        Wp(D0 - OUT, latMid, y0), Wp(D0 + IN, latMid, y0),
        Wp(dA0 - 0.3, aC, y0), Wp(dA1 + CORE_LD / 2, aC, y1),
        Wp(dA1 + CORE_LD / 2, bC, y1), Wp(dA0 - 0.3, bC, y2),
        Wp(D0 + IN, latMid, y2), Wp(D0 - OUT, latMid, y2),
      ];
      storeyPaths.push(path);
      if (CBZ.stairs) {
        const L = CBZ.stairs.link({ path: path, width: laneW, kind: "stair", owner: b });
        if (L) {                     // removeOwner(b) takes the whole storey's walk surface with it
          const fa = flights[2 * k], fb = flights[2 * k + 1];
          L.plats = [fa && fa.plat, fb && fb.plat].filter(Boolean);
          if (k === 0) { L.plats = L.plats.concat(plats.filter((p) => L.plats.indexOf(p) < 0)); L.cols = cols; }
        }
      }
    }

    const hp = P.pt(D0, latMid);
    const head = { x: hp.x, z: hp.z, nx: -P.nx, nz: -P.nz };
    const rec = {
      lot: lot, b: b, head: head, stops: tops.slice(0, kTop + 1), floors: kTop, roof: roofAccess, cleared: cleared,
      // what the core EATS out of each floorplate (interior programs inset by it)
      depth: P.CD, width: P.CW,
      rect: P.hole, colliders: cols, platforms: plats,
      // world-space centre of the opening on floor k (the chokepoint)
      headAt: function (k) {
        const y = tops[Math.max(0, Math.min(kTop, k | 0))];
        return { x: ox + hp.x, y: y, z: oz + hp.z, nx: -P.nx, nz: -P.nz };
      },
      // THE WALK THROUGH THE CORE: world {x,y,z} waypoints from just outside
      // floor k0's stair door to just outside floor k1's — the registered
      // CBZ.stairs link paths, concatenated (descending: reversed). [] when
      // k0 === k1 after clamping to the levels the stair serves.
      route: function (k0, k1) {
        k0 = Math.max(0, Math.min(kTop, k0 | 0));
        k1 = Math.max(0, Math.min(kTop, k1 | 0));
        if (k0 === k1) return [];
        const lo = Math.min(k0, k1), hi = Math.max(k0, k1);
        const out = [];
        for (let k = lo; k < hi; k++) {
          const pth = storeyPaths[k];
          for (let i = (k === lo ? 0 : 1); i < pth.length; i++) out.push({ x: pth[i].x, y: pth[i].y, z: pth[i].z, stair: true });
        }
        return k1 > k0 ? out : out.reverse();
      },
    };
    b._stairCore = rec;
    if (b.group.userData) {
      b.group.userData.stairCore = rec;
      if (b.group.userData.bld && b.group.userData.bld !== b) b.group.userData.bld._stairCore = rec;
    }
    return rec;
  };
  // has this building got walkable vertical traversal at all?
  CBZ.cityHasStairs = function (lot) {
    const b = lot && lot.building;
    return !!(b && (coreOf(b) || (b.stairPlan && !b._stairCoreFailed)));
  };

  // THE AUDIT (tools / the lead's live probes): every built core, walked on
  // paper — a slab platform or a foreign collider over the core rect is a
  // stair you cannot use. Returns {cores, blockedPlats, blockedCols, samples}.
  CBZ.cityStairAudit = function () {
    const A = CBZ.city && CBZ.city.arena;
    const shells = (A && A.root && A.root.userData && A.root.userData.shells) || [];
    const out = { shells: shells.length, planned: 0, cores: 0, failed: 0, blockedPlats: 0, blockedCols: 0, samples: [] };
    for (const b of shells) {
      if (!b) continue;
      if (b.stairPlan) out.planned++;
      if (b._stairCoreFailed) out.failed++;
      const core = coreOf(b);
      if (!core) continue;
      out.cores++;
      const h = core.rect, x0 = b.ox + h.x0 + 0.05, x1 = b.ox + h.x1 - 0.05, z0 = b.oz + h.z0 + 0.05, z1 = b.oz + h.z1 - 0.05;
      const own = new Set(core.platforms.concat(core.colliders));
      for (const p of CBZ.platforms) {
        if (own.has(p) || p.stair || p.maxX <= x0 || p.minX >= x1 || p.maxZ <= z0 || p.minZ >= z1) continue;
        if (!(p.top > core.stops[0] + 0.05) || p.top > b.h + 0.5) continue;
        out.blockedPlats++;
        if (out.samples.length < 8) out.samples.push({ kind: "plat", x: +b.ox.toFixed(1), z: +b.oz.toFixed(1), top: +p.top.toFixed(2) });
      }
      for (const c of CBZ.colliders) {
        if (own.has(c) || c.maxX <= x0 || c.minX >= x1 || c.maxZ <= z0 || c.minZ >= z1) continue;
        if (c.y0 != null && c.y0 > b.h + 3) continue;
        out.blockedCols++;
        if (out.samples.length < 8) out.samples.push({ kind: "col", x: +b.ox.toFixed(1), z: +b.oz.toFixed(1), y0: c.y0, y1: c.y1 });
      }
    }
    return out;
  };

  // ---- THE LAZY BUILD: the core goes up when somebody walks up to it -------
  // Thousands of shells reserve a core; only the ones you approach pay for
  // one (a few platforms, ~20 colliders a storey, ~6 merged meshes). One per
  // scan, nearest first, within CORE_R of the footprint. Built cores stay.
  const CORE_R = 14, CORE_TICK = 0.25, CORE_CELL = 48;
  let coreScanT = 0, coreGrid = null, coreGridOf = null, coreGridN = -1;
  function coreGridBuild(shells) {
    coreGrid = new Map(); coreGridOf = shells; coreGridN = shells.length;
    for (const b of shells) {
      if (!b || !b.stairPlan) continue;
      const key = Math.floor(b.ox / CORE_CELL) + "," + Math.floor(b.oz / CORE_CELL);
      let a = coreGrid.get(key); if (!a) coreGrid.set(key, a = []); a.push(b);
    }
  }
  CBZ.onUpdate(36.65, function (dt) {
    const G = CBZ.game;
    if (!G || G.mode !== "city") return;
    coreScanT -= dt;
    if (coreScanT > 0) return;
    coreScanT = CORE_TICK;
    const A = CBZ.city && CBZ.city.arena, P = CBZ.player;
    const shells = A && A.root && A.root.userData && A.root.userData.shells;
    if (!shells || !P || !P.pos) return;
    if (coreGridOf !== shells || coreGridN !== shells.length) coreGridBuild(shells);
    const px = P.pos.x, pz = P.pos.z;
    const gx = Math.floor(px / CORE_CELL), gz = Math.floor(pz / CORE_CELL);
    let best = null, bd = CORE_R;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = coreGrid.get((gx + i) + "," + (gz + j));
      if (!a) continue;
      for (const b of a) {
        if (b._stairCore || b._stairCoreFailed || !b.group || !b.group.parent) continue;
        const dx = Math.max(0, Math.abs(px - b.ox) - b.w / 2), dz = Math.max(0, Math.abs(pz - b.oz) - b.d / 2);
        const d = Math.hypot(dx, dz);
        if (d < bd) { bd = d; best = b; }
      }
    }
    if (!best) return;
    try { CBZ.cityStairCore({ building: best }); } catch (e) { best._stairCoreFailed = true; console.warn("[stair core]", e); }
  });

  // PUBLIC: the built lifts (minimap markers / missions can target a roof)
  CBZ.cityElevators = function () { return elevators; };
  // does this building's walk-in lift stop at (walk surface) y? realestate.js
  // asks before offering its menu shortcut to a penthouse the lift reaches.
  CBZ.cityLiftServes = function (b, y) {
    const L = b && b.lift;
    return !!(L && L.stops && L.stops.some((s) => Math.abs(s.y - y) < 1.0));
  };

  // FIRST-PRINCIPLES CONTRACT: a lift is not merely a teleport marker. Its
  // building must publish an ordered ground→roof stop list, reserve and carve
  // one continuous shaft, build a sealed two-leaf cab room at every column
  // landing on the SAME x/z column (a floor's own landing, the exec core, has
  // its own frame but the same rig contract), and publish the resulting
  // machine back on the canonical building record. Math-gate reads this after
  // world build so a future style/era recipe cannot silently strand a
  // decorative elevator in an uncarved floor plate.
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
      const b = el.b, tops = b.floorTops, st = el.stops || [];
      let stopsOk = Array.isArray(tops) && tops.length >= 2 && st.length >= 2;
      if (stopsOk) {
        for (let i = 0; i < tops.length; i++) {
          if (!Number.isFinite(tops[i]) || (i && tops[i] <= tops[i - 1])) { stopsOk = false; break; }
        }
        for (let i = 1; i < st.length; i++) if (!(st[i].base > st[i - 1].base)) stopsOk = false;
        stopsOk = stopsOk
          && Math.abs(tops[0] - 0.14) <= 0.001
          && Math.abs(tops[tops.length - 1] - b.h) <= 0.001
          && st[0].base === 0 && Math.abs(st[st.length - 1].base - b.h) <= 0.001
          && el.topFloor === tops.length - 1;
      }
      if (!stopsOk) fail("badStops", el, "unordered or shell-height mismatch");
      if (!b.shaftRects || !b.shaftRects.length)
        fail("missingShafts", el, "no reserved shaft footprint");
      if (b.floorSlabs) {
        for (const slab of b.floorSlabs) if (!slab.carved)
          fail("uncarvedSlabs", el, "intermediate floor crosses the lift column");
      }
      if (!b.lift || b.lift.floors !== el.topFloor
        || !b.lift.ground || !b.lift.roof || !b.lift.stops || b.lift.stops.length !== st.length
        || Math.abs(b.lift.roof.y - b.h) > 0.001)
        fail("missingLift", el, "building registry does not match the machine");
      const col = st.filter((s) => !s.own);
      for (let i = 1; i < col.length; i++) {
        if (Math.hypot(col[i].pad.x - col[0].pad.x, col[i].pad.z - col[0].pad.z) > 0.001)
          { fail("misalignedEnds", el, "the column's cabs are not one vertical column"); break; }
      }
      for (const s of st) {
        const r = s.rig;
        if (!r || !r.leaves || r.leaves.length !== 2 || !r.col
          || (!s.own && Math.abs(s.floor - (s.base + 0.16)) > 0.001))
          { fail("badCabs", el, "a landing is not a sealed, floor-aligned cab room"); break; }
      }
    }
    out.failures = out.badStops + out.missingShafts + out.uncarvedSlabs
      + out.missingLift + out.misalignedEnds + out.badCabs;
    return out;
  };
})();
