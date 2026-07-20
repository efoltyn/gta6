/* ============================================================
   city/exec_office.js — THE EXECUTIVE FLOOR of the flagship mega-tower.

   WHY (owner, verbatim intent): "the building the executive spawns in should
   be an absurdly high office — the TALLEST, top floor, massively tall… the
   office should be more intentional: I like the computers, but there's a lot
   of props that are not needed, and separate rooms — if there's a separate
   room it should be an office with ONE desk with SPACE. You don't understand
   space. Not everything is crammed in."

   So this floor is designed around EMPTINESS. Storey 50 of the 52-storey
   Spire (~160m up, directly under the penthouse), one whole floor for one
   man's firm, three rooms and acres of polished floor between them:

     • THE CORNER OFFICE — the full +x end of the plate behind a glass
       partition. ONE desk, ONE chair, the triple-monitor terminal cluster
       (the read the owner likes), two guest chairs, a credenza, a lamp.
       Nothing else. The desk faces the room; his back is to the corner
       glass and the whole city.
     • THE MEETING ROOM — the -x/-z corner. ONE long table, eight chairs,
       one wall screen. Space around the table to walk a full lap.
     • RECEPTION — one desk facing the express-lift core, one bench, two
       planters. The rest of the arrival floor is open.

   The perimeter is the building's own floor-to-ceiling CLEAR curtain wall
   (makeMegaTower passes glassKind:"clear" — the same pooled instanced panes
   office towers use), so from anywhere on the floor you SEE the city far
   below. This file adds no perimeter walls on purpose.

   THE EXPRESS LIFT: interior floors have no stair run in the current shells
   and the walk-in cab (city/elevators.js) physically serves ground↔roof
   only, so the suite gets the same diegetic ride the Spire loft uses
   (realestate.js's elevatorUp): a solid lift core on the floor + an [E]
   call panel that fades to black and relocates you to the street outside
   the tower door — and a matching panel at the door to ride back up. The
   Executive origin's "get down to level 1" beat completes through it.

   CONTRACTS:
     CBZ.cityFurnishExecOffice(b, baseY, lot) — called by makeMegaTower
       (buildings.js) BEFORE it spreads b into lot.building. Dresses the
       floor via b.lbox (shared cached mats; opaque cast:false boxes batch-
       fold to ≈0 extra draw calls) and stamps b.execOffice = { floorY,
       spawn, face, desk, lift, name, keepClear } (world coords):
         spawn/face — where the Executive origin stands + looks (origins.js)
         lift       — the express-lift boarding point on the suite floor
         keepClear  — keep-clear anchors; elevators.js's interiorAvoids
                      folds them in so the carved full-height shaft column
                      steers into the suite's furniture-free wall slots
     Geometry is fully deterministic (pure functions of b.w/b.d — no rng,
     no Math.random) so world builds stay byte-identical per seed.

   Flag: CBZ.CONFIG.EXEC_TOP_OFFICE (src/config.js) — makeMegaTower only
   calls this when it's on; flag off restores the old natatorium layout.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  const FH = 3.2;                    // floor-to-floor (buildings.js metre contract)
  const PWT = 0.16;                  // thin partition thickness (roomKit idiom)
  // palette — mostly EXISTING city colour buckets so batch.js folds the suite
  // into merged meshes that already exist; the few new tones are one bucket each.
  const FLOORC = 0x24272e;           // dark polished plate
  const RUGC = 0x2f2a36;
  const WALLC = 0x39404d;            // smoked partition tone
  const WALNUT = 0x3a2b1e;           // penthouse DARKWOOD bucket
  const STONE = 0xd9dce2;
  const LEATHER = 0x171a20;
  const GOLD = 0xcaa64a;             // penthouse GOLD bucket
  const BEZEL = 0x14181e;            // office monitor bezel bucket
  const PALE = 0xc9ccd2;             // office worktop bucket
  const SCREEN = 0x39516a;           // screen-glow bucket
  const WARM = 0xffe6c0;             // warm cove-light bucket
  const STEEL = 0x8a93a0;            // elevator leaf bucket
  const PLANTER = 0x2e2620, LEAF = 0x3f7a4a;

  const FIRM = "Sterling Capital";   // Marcus Sterling's shop (origins.js fiction)

  // ------------------------------------------------------------------------
  //  THE FURNISHER
  // ------------------------------------------------------------------------
  CBZ.cityFurnishExecOffice = function (b, baseY, lot) {
    const W = b.w, D = b.d, Y = baseY || 0;
    const wt = b.wt != null ? b.wt : 0.4;
    const ox = b.ox != null ? b.ox : (lot ? lot.cx : 0);
    const oz = b.oz != null ? b.oz : (lot ? lot.cz : 0);
    const lb = (x, y, z, w, h, d, c, o) => b.lbox(x, Y + y, z, w, h, d, c, o || { cast: false });
    const glow = (x, y, z, w, h, d, c, ei) => b.lbox(x, Y + y, z, w, h, d, c, { emissive: c, ei: ei || 0.5, cast: false });
    const seatAt = (x, z, face, kind) => { if (CBZ.propRegisterSeat) CBZ.propRegisterSeat(ox + x, Y, oz + z, face, kind, null); };
    const cfp = (x, z, pad) => !b.clearFloorPoint || b.clearFloorPoint(x, z, pad == null ? 0.7 : pad);
    // nudge a cluster anchor off the (2D, all-floors) door-aisle stamp: try the
    // ideal spot, then small deterministic shifts; worst case keep the ideal.
    function anchor(x, z, pad) {
      if (cfp(x, z, pad)) return { x, z };
      const tries = [[x, z + 3.0], [x, z - 3.0], [x - 2.8, z], [x, z + 5.0], [x, z - 5.0]];
      for (const t of tries) if (cfp(t[0], t[1], pad)) return { x: t[0], z: t[1] };
      return { x, z };
    }

    // usable band, clear of the facade glass (and a stair strip if one exists)
    const xLo = (b.hasStairs ? (-W / 2 + wt + b.stairW + 0.4) : (-W / 2 + wt + 0.35));
    const xHi = W / 2 - wt - 0.35;
    const zLo = -D / 2 + wt + 0.35;
    const zHi = D / 2 - wt - 0.35;
    const CX = (xLo + xHi) / 2, CZ = (zLo + zHi) / 2;
    const ceilY = FH - 0.3;                       // just under the slab above

    // ---- ONE polished floor plate over the whole storey --------------------
    lb(CX, 0.025, CZ, xHi - xLo, 0.05, zHi - zLo, FLOORC);
    // ---- three long, sparse ceiling light lines (the only overhead fixtures)
    for (const fz of [-1, 0, 1]) glow(CX, ceilY, CZ + fz * (D * 0.22), (xHi - xLo) * 0.55, 0.07, 0.42, 0xf2ead8, 0.32);

    // ---- partition helpers (roomKit's wall idiom: batch-safe, non-collider) --
    const WALLH = FH - 0.12;
    function wallX(z, x0, x1, gapX, gapW) {
      gapW = gapW || 1.7;
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      const gg = gapX != null && gapX > lo && gapX < hi;
      const segs = gg ? [[lo, gapX - gapW / 2], [gapX + gapW / 2, hi]] : [[lo, hi]];
      for (const s of segs) { if (s[1] - s[0] < 0.2) continue; lb((s[0] + s[1]) / 2, WALLH / 2, z, s[1] - s[0], WALLH, PWT, WALLC); }
      if (gg) lb(gapX, WALLH - 0.16, z, gapW, 0.32, PWT, WALLC);
    }
    // a floor-to-ceiling GLASS partition run along Z at fixed x, with slim
    // mullion posts. Each pane registers as CITY GLASS (cityRegisterGlass — the
    // same shared registry the facade panes and jewelry cases use) so a bullet or
    // blast SHATTERS it exactly like an exterior window (owner: "the windows in
    // offices should shatter like the exterior windows do — they don't at all").
    // cityRegisterGlass builds an individual transparent mesh, which core/batch.js
    // SPARES (transparent → never merged), so burstPane's visible-flip still hides
    // it. ox/oz convert b-local → world so the shatter ray hits the pane where it
    // renders; no collider (o.solid) — the partition stays walk-through as before,
    // it just breaks now. Fallback keeps the plain pane if the API is absent.
    const gmat = CBZ.cityGlassMat ? CBZ.cityGlassMat() : new THREE.MeshLambertMaterial({ color: 0xbfe9f7, transparent: true, opacity: 0.6 });
    function glassPane(x, py, pz, pd) {
      if (CBZ.cityRegisterGlass) { CBZ.cityRegisterGlass(b.group, x, py, pz, 0.06, WALLH - 0.1, pd, ox, oz); return; }
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.06, WALLH - 0.1, pd), gmat);
      pane.position.set(x, py, pz);
      pane.castShadow = false; pane.receiveShadow = false;
      b.group.add(pane);
    }
    function glassZ(x, z0, z1, gapZ, gapW) {
      gapW = gapW || 1.7;
      const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
      const gg = gapZ != null && gapZ > lo && gapZ < hi;
      const segs = gg ? [[lo, gapZ - gapW / 2], [gapZ + gapW / 2, hi]] : [[lo, hi]];
      for (const s of segs) {
        const len = s[1] - s[0]; if (len < 0.25) continue;
        glassPane(x, Y + (WALLH - 0.1) / 2 + 0.05, (s[0] + s[1]) / 2, len);
      }
      // mullion posts at the ends + doorway jambs; header over the doorway
      const posts = gg ? [lo, gapZ - gapW / 2, gapZ + gapW / 2, hi] : [lo, hi];
      for (const pz of posts) lb(x, WALLH / 2, pz, 0.14, WALLH, 0.14, WALLC);
      if (gg) lb(x, WALLH - 0.16, gapZ, PWT, 0.32, gapW, WALLC);
    }

    // ========================================================================
    //  THE EXPRESS-LIFT CORE — a solid column just off centre, doors facing -z
    // ========================================================================
    const core = anchor(CX - W * 0.085, CZ + 0.8, 1.6);
    const CORE = 2.5;
    lb(core.x, FH / 2, core.z, CORE, FH, CORE, 0x2c3340, { solid: true, cast: false });
    // brushed-steel leafs proud of the -z face + threshold + call panel
    const doorFaceZ = core.z - CORE / 2 - 0.045;
    for (const s of [-1, 1]) lb(core.x + s * 0.42, 1.12, doorFaceZ, 0.8, 2.24, 0.07, STEEL);
    lb(core.x, 2.42, doorFaceZ, 1.9, 0.36, 0.09, WALLC);              // lintel
    glow(core.x + 1.06, 1.25, doorFaceZ, 0.12, 0.24, 0.06, 0x35d07a, 0.7);   // call panel
    // the firm's signage: one long gold band over the lift + two accent squares
    glow(core.x, 2.78, doorFaceZ, 2.1, 0.16, 0.06, GOLD, 0.4);
    for (const s of [-1, 1]) glow(core.x + s * 1.35, 2.78, doorFaceZ, 0.14, 0.14, 0.06, GOLD, 0.4);
    const liftPt = { x: core.x, z: core.z - CORE / 2 - 1.35 };        // boarding point

    // ========================================================================
    //  RECEPTION — one desk facing the lift, one bench, two planters. Space.
    // ========================================================================
    const rec = { x: core.x, z: core.z - 5.6 };
    lb(rec.x, 0.5, rec.z, 2.6, 0.92, 0.85, WALNUT);                   // desk body
    lb(rec.x, 0.99, rec.z, 2.8, 0.07, 1.0, STONE);                    // stone top
    lb(rec.x, 0.42, rec.z + 1.05, 0.56, 0.14, 0.56, LEATHER);         // receptionist chair (faces the lift)
    lb(rec.x, 0.82, rec.z + 1.28, 0.56, 0.62, 0.12, LEATHER);
    seatAt(rec.x, rec.z + 1.05, 0, "chair");
    // one visitor bench off to the -x side, facing the desk
    if (cfp(rec.x - 3.8, rec.z + 0.4, 0.8)) {
      lb(rec.x - 3.8, 0.36, rec.z + 0.4, 0.7, 0.16, 2.2, LEATHER);
      lb(rec.x - 4.06, 0.72, rec.z + 0.4, 0.14, 0.6, 2.2, LEATHER);
      seatAt(rec.x - 3.8, rec.z + 0.4, Math.PI / 2, "bench");
    }
    // two planters flanking the arrival walk
    for (const s of [-1, 1]) {
      const px = core.x + s * 2.6, pz = core.z - 2.6;
      if (!cfp(px, pz, 0.7)) continue;
      lb(px, 0.42, pz, 0.8, 0.84, 0.8, PLANTER);
      lb(px, 1.18, pz, 0.62, 0.7, 0.62, LEAF);
    }

    // ========================================================================
    //  THE CORNER OFFICE — the whole +x end. ONE desk. SPACE.
    // ========================================================================
    const offX0 = xHi - Math.max(6.8, Math.min(9.2, W * 0.38));       // partition line
    const offDoorZ = core.z;                                          // door lines up with the core walk
    glassZ(offX0, zLo + 0.15, zHi - 0.15, offDoorZ, 1.8);             // full-height glass front
    const offCz = 0;                                                  // desk band centred on the plate
    lb(xHi - 4.1, 0.03, offCz, 5.6, 0.05, 3.8, RUGC);                 // one rug under the desk zone
    // THE DESK — one long executive slab, long axis along z, his back to +x glass
    const dsk = { x: xHi - 3.5, z: offCz };
    lb(dsk.x, 0.37, dsk.z, 1.05, 0.7, 2.7, WALNUT);                   // pedestal body
    lb(dsk.x, 0.75, dsk.z, 1.22, 0.08, 3.0, STONE);                   // stone top
    // THE TERMINAL CLUSTER (the read the owner likes): three monitors along the
    // desk's -x working edge facing the chair, a keyboard slab, a desk lamp.
    for (const mz of [-0.66, 0, 0.66]) {
      lb(dsk.x - 0.42, 1.03, dsk.z + mz, 0.06, 0.42, 0.6, BEZEL);     // bezel
      glow(dsk.x - 0.39, 1.03, dsk.z + mz, 0.02, 0.34, 0.5, SCREEN, 0.4); // lit pane
      lb(dsk.x - 0.42, 0.8, dsk.z + mz, 0.1, 0.1, 0.12, BEZEL);       // stand
    }
    // CCTV: the terminal cluster carries a live camera feed (the lit panes face
    // +x toward the chair). World coords + outward normal (1,0). Runtime-visual.
    if (CBZ.cctvAddScreen) for (const mz of [-0.66, 0, 0.66]) CBZ.cctvAddScreen(ox + dsk.x - 0.39, Y + 1.03, oz + dsk.z + mz, 1, 0);
    lb(dsk.x - 0.02, 0.81, dsk.z, 0.34, 0.03, 0.9, PALE);             // keyboard slab
    lb(dsk.x + 0.34, 0.86, dsk.z - 1.2, 0.16, 0.22, 0.16, BEZEL);     // phone dock
    glow(dsk.x + 0.3, 1.06, dsk.z + 1.22, 0.2, 0.34, 0.2, WARM, 0.45);// desk lamp
    // HIS chair — behind the desk, facing the monitors (-x → toward the room)
    const chr = { x: dsk.x + 1.15, z: dsk.z };
    lb(chr.x, 0.44, chr.z, 0.62, 0.14, 0.62, LEATHER);
    lb(chr.x + 0.26, 0.95, chr.z, 0.14, 0.95, 0.62, LEATHER);         // high back
    lb(chr.x, 0.2, chr.z, 0.1, 0.4, 0.1, BEZEL);
    seatAt(chr.x, chr.z, -Math.PI / 2, "chair");
    // TWO guest chairs across the desk — and that is all the seating there is
    for (const s of [-1, 1]) {
      const gz = dsk.z + s * 1.0, gx = dsk.x - 2.0;
      lb(gx, 0.42, gz, 0.56, 0.14, 0.56, 0x23272e);
      lb(gx - 0.26, 0.82, gz, 0.12, 0.66, 0.56, 0x23272e);
      seatAt(gx, gz, Math.PI / 2, "chair");
    }
    // one low credenza against the partition + a decanter accent
    if (cfp(offX0 + 0.75, offCz - 3.6, 0.7)) {
      lb(offX0 + 0.75, 0.32, offCz - 3.6, 0.55, 0.62, 2.4, WALNUT);
      lb(offX0 + 0.75, 0.68, offCz - 3.6, 0.6, 0.06, 2.5, STONE);
      lb(offX0 + 0.75, 0.82, offCz - 4.3, 0.16, 0.24, 0.16, GOLD);
    }
    // one floor lamp in the +z glass corner — the only other object in ~190m²
    if (cfp(xHi - 1.4, zHi - 1.4, 0.6)) {
      lb(xHi - 1.4, 0.75, zHi - 1.4, 0.14, 1.5, 0.14, 0x2a2f37);
      glow(xHi - 1.4, 1.62, zHi - 1.4, 0.4, 0.28, 0.4, WARM, 0.55);
    }

    // ========================================================================
    //  THE MEETING ROOM — the -x/-z corner. ONE long table. Eight chairs.
    // ========================================================================
    const mr = { x0: xLo + 0.15, x1: Math.min(xLo + 8.6, offX0 - 2.6), z0: zLo + 0.15, z1: zLo + 5.9 };
    const mrOk = (mr.x1 - mr.x0) >= 6.0 && (mr.z1 - mr.z0) >= 4.6;
    let mrC = null;
    if (mrOk) {
      const mcx = (mr.x0 + mr.x1) / 2, mcz = (mr.z0 + mr.z1) / 2;
      mrC = { x: mcx, z: mcz };
      wallX(mr.z1, mr.x0, mr.x1, mr.x1 - 1.7);                        // solid back wall, door near +x end
      glassZ(mr.x1, mr.z0, mr.z1 - 0.1, null);                        // glass side facing the gallery
      // ONE long table
      const TL = Math.min(4.6, (mr.x1 - mr.x0) - 2.8);
      lb(mcx, 0.48, mcz, TL, 0.1, 1.3, WALNUT);                       // top
      lb(mcx, 0.24, mcz, TL - 1.4, 0.42, 0.5, WALNUT);                // spine base
      // eight chairs: three a side + one at each end, all facing the table
      for (let i = -1; i <= 1; i++) for (const s of [-1, 1]) {
        const cx2 = mcx + i * (TL / 2 - 0.7), cz2 = mcz + s * 1.05;
        lb(cx2, 0.42, cz2, 0.5, 0.14, 0.5, LEATHER);
        lb(cx2, 0.8, cz2 + s * 0.24, 0.5, 0.6, 0.12, LEATHER);
        seatAt(cx2, cz2, s > 0 ? Math.PI : 0, "chair");
      }
      for (const e of [-1, 1]) {
        const cx2 = mcx + e * (TL / 2 + 0.75);
        lb(cx2, 0.42, mcz, 0.5, 0.14, 0.5, LEATHER);
        lb(cx2 + e * 0.24, 0.8, mcz, 0.12, 0.6, 0.5, LEATHER);
        seatAt(cx2, mcz, e > 0 ? -Math.PI / 2 : Math.PI / 2, "chair");
      }
      // one wall screen on the back partition + one light line over the table
      lb(mcx, 1.62, mr.z1 - 0.16, 2.3, 1.15, 0.08, BEZEL);
      glow(mcx, 1.62, mr.z1 - 0.2, 2.0, 0.9, 0.04, SCREEN, 0.4);
      glow(mcx, ceilY, mcz, TL * 0.8, 0.06, 0.34, 0xf2ead8, 0.3);
    }

    // ========================================================================
    //  THE NORTH GLASS LOUNGE — two chairs and a table looking over the city
    // ========================================================================
    const lng = { x: CX - W * 0.13, z: zHi - 2.5 };
    if (cfp(lng.x, lng.z, 1.0)) {
      for (const s of [-1, 1]) {
        lb(lng.x + s * 1.15, 0.42, lng.z, 0.85, 0.5, 0.85, 0x23272e); // armchair
        lb(lng.x + s * 1.15, 0.88, lng.z - 0.36, 0.85, 0.55, 0.14, 0x23272e);
        seatAt(lng.x + s * 1.15, lng.z, 0, "sofa");                   // both face +z: the view
      }
      lb(lng.x, 0.3, lng.z, 0.8, 0.3, 0.8, GOLD);                     // low brass table
    }

    // ========================================================================
    //  STAMP THE CONTRACT (world coords) — origins.js + the express lift +
    //  the rent-unit skips + elevators.js's shaft steering all read this.
    // ========================================================================
    const keep = [
      { x: ox + core.x, z: oz + core.z, r: 2.8 },
      { x: ox + rec.x, z: oz + rec.z, r: 2.4 },
      { x: ox + dsk.x, z: oz + dsk.z, r: 3.2 },
      { x: ox + dsk.x - 2.0, z: oz + dsk.z, r: 2.0 },
      { x: ox + lng.x, z: oz + lng.z, r: 2.4 },
      // shaft steering: block the carved lift chase out of the corner office's
      // glass walls (+x face slots) and the -z face slot that lands inside it,
      // leaving the NW gallery slots free — the column arrives there and reads
      // as the building core beside the service side.
      { x: ox + xHi - 1.5, z: oz + D * 0.30, r: 3.4 },
      { x: ox + xHi - 1.5, z: oz - D * 0.30, r: 3.4 },
      { x: ox + W * 0.30, z: oz + zLo + 1.5, r: 3.4 },
      { x: ox + W * 0.30, z: oz + zHi - 1.5, r: 3.4 },
    ];
    if (mrC) {
      keep.push({ x: ox + mrC.x, z: oz + mrC.z, r: 3.4 });
      keep.push({ x: ox + mr.x0 + 1.6, z: oz + mrC.z, r: 3.0 });      // table's -x end vs the -x wall slot
    }
    b.execOffice = {
      floorY: Y,
      name: FIRM,
      // he starts behind his own desk, looking across the empty floor at the door
      spawn: { x: ox + chr.x - 0.75, z: oz + chr.z + 0.55 },
      face: { x: ox + offX0, z: oz + offDoorZ },
      desk: { x: ox + dsk.x, z: oz + dsk.z },
      lift: { x: ox + liftPt.x, z: oz + liftPt.z },
      keepClear: keep,
    };
    registerLiftZones();
    return b.execOffice;
  };

  // ------------------------------------------------------------------------
  //  THE EXPRESS RIDE — the Spire-loft teleport convention (realestate.js's
  //  elevatorUp), dressed with a fade + a ding. Suite panel rides you DOWN to
  //  the street outside the tower door; the street panel rides you back UP.
  // ------------------------------------------------------------------------
  let fadeEl = null, rideBusyUntil = 0;
  function fade(cb) {
    if (!fadeEl) {
      fadeEl = document.createElement("div");
      fadeEl.style.cssText = "position:fixed;inset:0;z-index:65;background:#000;opacity:0;pointer-events:none;transition:opacity .28s ease;";
      document.body.appendChild(fadeEl);
    }
    fadeEl.style.opacity = "1";
    setTimeout(function () {
      try { cb(); } catch (e) {}
      setTimeout(function () { fadeEl.style.opacity = "0"; }, 240);
    }, 320);
  }
  function nowMs() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }
  function eo() {
    const mt = CBZ.cityMegaTower && CBZ.cityMegaTower();
    const bb = mt && mt.lot && mt.lot.building;
    return (bb && bb.execOffice && bb.execOffice.lift) ? { b: bb, e: bb.execOffice } : null;
  }
  function towerDoor(bb) {
    const door = bb.door || null;
    if (door && door.x != null) return { x: door.x + (door.nx || 0) * 2.4, z: door.z + (door.nz || 0) * 2.4 };
    return { x: bb.ox != null ? bb.ox : 0, z: (bb.oz != null ? bb.oz : 0) + (bb.d || 20) / 2 + 2.0 };
  }
  function relocate(x, y, z, note) {
    const P = CBZ.player; if (!P || !P.pos) return;
    fade(function () {
      P.pos.set(x, y, z); P.vy = 0; P.grounded = true;
      if (P._phys) { P._phys.air = false; P._phys.vx = P._phys.vz = P._phys.vy = 0; }
      if (CBZ.playerChar) CBZ.playerChar.group.position.copy(P.pos);
      if (CBZ.sfx) try { CBZ.sfx("door"); } catch (e) {}
      if (CBZ.city && note) CBZ.city.note(note, 2.2);
    });
  }

  let zonesDone = false;
  function registerLiftZones() {
    if (zonesDone || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    zonesDone = true;
    // SUITE panel → street. Y-gated: the registry scores in 2D, and 160m of
    // tower stand between the two panels at the same x/z.
    CBZ.interactions.registerZone({
      id: "exec-lift-down", kind: "exec-lift", radius: 2.7,
      find: function (px, pz) {
        const r = eo(); if (!r) return null;
        const P = CBZ.player; if (!P || Math.abs(P.pos.y - r.e.floorY) > 2.2) return null;
        if (nowMs() < rideBusyUntil) return null;
        const dx = r.e.lift.x - px, dz = r.e.lift.z - pz;
        return (dx * dx + dz * dz) < 2.7 * 2.7 ? { x: r.e.lift.x, z: r.e.lift.z } : null;
      },
      options: [{
        id: "exec-lift-ride-down", slot: "e",
        label: "Lift — ground",
        onSelect: function () {
          const r = eo(); if (!r) return;
          rideBusyUntil = nowMs() + 1800;
          const d = towerDoor(r.b);
          const gy = CBZ.floorAt ? CBZ.floorAt(d.x, d.z) : 0.14;
          relocate(d.x, gy, d.z, "Fifty floors in nine seconds. Street level.");
        },
      }],
    });
    // STREET panel (at the tower door) → the suite.
    CBZ.interactions.registerZone({
      id: "exec-lift-up", kind: "exec-lift", radius: 3.2,
      find: function (px, pz) {
        const r = eo(); if (!r) return null;
        const P = CBZ.player; if (!P || P.pos.y > 4.0) return null;
        if (nowMs() < rideBusyUntil) return null;
        const d = towerDoor(r.b);
        const dx = d.x - px, dz = d.z - pz;
        return (dx * dx + dz * dz) < 3.2 * 3.2 ? { x: d.x, z: d.z } : null;
      },
      options: [{
        id: "exec-lift-ride-up", slot: "e",
        label: "Lift — floor 50",
        onSelect: function () {
          const r = eo(); if (!r) return;
          rideBusyUntil = nowMs() + 1800;
          relocate(r.e.lift.x, r.e.floorY, r.e.lift.z, "" + FIRM + " — the 50th floor.");
        },
      }],
    });
  }
})();
