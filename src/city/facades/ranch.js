/* ============================================================
   city/facades/ranch.js — "Plain House": the house everybody actually lives in.

   WHAT IS BEING MODELLED. Not a mansion, not a landmark — the ordinary
   detached timber house on an ordinary street. One body colour, white trim,
   grey shingles, a slightly different front door. It is the hardest thing in
   this set precisely because it has no ornament to hide behind: there is no
   cornice, no order, no polychromy to carry the read. Everything has to come
   from CONSTRUCTION, and if one piece of the construction is missing the whole
   thing collapses back into a painted box with a triangle on top.

   So the test this file is written against is not "is it impressive". It is
   "would a player walking past believe someone lives here". That question is
   answered by a specific, boring, non-negotiable list of parts, and every one
   of them is here because a real house cannot be built without it:

     GABLE ROOF     the silhouette, and the only thing that says "house" from
                    200 m. Stepped courses narrowing on ONE axis, ridge running
                    PARALLEL to the street — so the front gets the eave line and
                    the flanks get the gable triangles, which is how a tract
                    house is actually oriented. The courses ARE the asphalt
                    shingle courses; each one gets a proud butt lip, because the
                    lap shadow is the whole texture of a shingle roof.
     EAVE + SOFFIT  a MODEST overhang (cheap houses overhang 500 mm, not 1.5 m),
     FASCIA GUTTER  closed with a fascia board, floored with a white soffit, and
                    hung with a gutter. Four white lines wrapping the top of the
                    wall. Nothing reads more strongly as "domestic".
     GABLE END      a rake board stepping up the slope, the triangle of siding
     VENT + RAKE    under it, a louvered attic vent near the apex, and the little
                    cornice RETURNS where the eave dies into the rake.
     LAP SIDING     horizontal clapboard courses over the WHOLE wall, alternating
                    projection course by course so every second joint throws a
                    real shadow. This is the file's main event and its main risk
                    (see THE WINDOW RULE below).
     CORNER BOARDS  the vertical trim boards the siding dies into at each arris.
                    Without them the siding stops in mid-air at the corner.
     WINDOWS        plain flat casing, a projecting drip cap over the head, a
                    sill with an apron under it, a muntin cross on the glass, and
                    a pair of louvered SHUTTERS flanking the opening.
     PORCH          a small covered stoop on TWO square posts with a shed roof
                    over the door, a walk-on deck two 0.17 m rises up from the
                    path, side railings, a doormat, a porch light, a mailbox.
                    Second-strongest identity move after the roof.
     CHIMNEY        brick, out ONE gable end, off-centre, topping out above the
                    ridge with a corbelled cap. Asymmetry starts here.
     FOUNDATION     a concrete skirt with a water-table cap, so the house lands
                    on something instead of growing out of the pavement.
     SERVICES       a downspout at one front corner with a splash block, a
                    garage door on the driveway flank when there is room for one,
                    an electric and a gas meter when there is not, and a plumbing
                    vent stack through the back slope.

   THE WINDOW RULE (the one that governs this whole file). The host shell glazes
   one CONTINUOUS band per storey, so a horizontal siding course drawn straight
   across a face would brick the building up — the exact failure the owner
   warned about. The fix is the fix a real house already uses: the siding is
   drawn as the COMPLEMENT of the openings. Per face we lay out window bays
   first; each window plus its casing plus its shutter pair becomes a HOLE, and
   every lap course is emitted in segments around those holes (runBand's trick,
   from stone.js). In the host's own solid zones — floor line to sill, and head
   to ceiling — the courses run the full width, so the clapboard lines still
   read continuously ACROSS the wall between the windows, which is what makes it
   siding instead of stripes. The result is that the ONLY host glass left
   uncovered is the window rectangle itself: punched windows, not a ribbon.

   ASYMMETRY IS THE STYLE. A Georgian brick house is symmetrical on purpose;
   this one is cheap on purpose. The chimney takes one gable end, the garage the
   other, the porch is nudged off the door axis, the downspout picks a corner,
   the vent stack sits on the back slope. All position-hashed, so one house is
   the same on every boot and two houses on one street are not the same drawing.

   COLOUR. A restrained tract palette: one mid-value body from a curated set,
   warm off-white trim (never pure white — see stone.js's header on why), a grey
   roof driven well down because the city's ambient lifts darks hard, and a door
   colour used on the door surround and, muted, on the shutters.

   maxStoreys 4: this is a house grammar. It has no business on a tower, and the
   city-wide auto-picker honours the cap. Every dimension comes from ctx.w /
   ctx.d / ctx.storeys / ctx.FH / ctx.rTop / ctx.pp or a face span, so 11x9x1
   reads as a cottage, 14x11x2 as the house, and 22x16x4 as a big foursquare.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Cut a list of tangent HOLES out of one interval and hand back the segments
  // that survive. Same principle as stone.js's runBand: you do not carve an
  // opening out of merged axis-aligned boxes, you decline to draw over it.
  function subtract(a0, a1, holes) {
    let out = [[a0, a1]];
    for (let i = 0; i < holes.length; i++) {
      const h = holes[i];
      const nx = [];
      for (let j = 0; j < out.length; j++) {
        const r = out[j];
        if (h[1] <= r[0] || h[0] >= r[1]) { nx.push(r); continue; }
        if (h[0] > r[0]) nx.push([r[0], h[0]]);
        if (h[1] < r[1]) nx.push([h[1], r[1]]);
      }
      out = nx;
    }
    return out;
  }

  // THE TRACT PALETTE: [body, door]. Authored outright rather than derived,
  // because the host colour arrives near-white on a pale district and a house
  // that only tints it comes back as one cream blur. The host colour is still
  // blended in, but only enough to keep the house in its street. Every body is
  // a MID value: a house reads as siding because the trim is lighter and the
  // roof is darker than the wall, and neither is possible off a pale body.
  const SETS = [
    [0x93a189, 0x5e2b26],   // sage green      / oxblood door
    [0xc9bb98, 0x2c3f52],   // wheat           / navy door
    [0xa4b1bb, 0x77362a],   // pale slate blue / brick red door
    [0xbaac9c, 0x33503d],   // warm taupe      / hunter green door
    [0x9d6b5c, 0x33383c],   // faded barn red  / charcoal door
    [0xb4b7ab, 0x6b4a2b],   // stone grey      / stained oak door
  ];

  CBZ.registerFacade("ranch", {
    label: "Plain House",
    crownsRoof: true,
    maxStoreys: 4,
    build: function (ctx, F, spec) {
      const W = ctx.w, D = ctx.d, FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0);
      const rTop = ctx.rTop;
      const unit = Math.min(W, D);            // the house's own ruler
      const PP = ctx.pp || 0.8;               // the host's parapet height
      const e = F.entrance(ctx);
      const faces = F.faces(ctx);

      // ============================================================
      //  1. PALETTE
      // ============================================================
      const base = (ctx.pal && ctx.pal.wall) || ctx.color;
      const set = SETS[Math.min(SETS.length - 1, (ctx.hash(0x7a11) * SETS.length) | 0)];
      const body = F.mix(set[0], base, 0.16);
      const bodyD = F.shade(body, 0.93);           // the recessed lap course
      const trim = F.mix(0xe8e3d5, base, 0.08);    // warm off-white, never 0xffffff
      const trimD = F.shade(trim, 0.86);
      const door = F.mix(set[1], base, 0.06);
      const shut = F.shade(F.mix(set[1], 0x22261f, 0.30), 0.92);
      const shutL = F.shade(shut, 1.24);           // the shutter's mid rail catches light
      // Asphalt shingles. Driven hard down: the city's ambient lifts a nominal
      // charcoal to a mid grey, and a roof that is not CLEARLY darker than the
      // wall turns the whole silhouette into one flat mass.
      const roofA = F.shade(F.mix(0x5a5e63, base, 0.08), 0.58);
      const roofB = F.shade(roofA, 1.18);
      const roofD = F.shade(roofA, 0.78);
      const brick = F.mix(0x8f5a46, base, 0.12);
      const brickD = F.shade(brick, 0.80);
      const conc = F.mix(0x9c998f, base, 0.14);    // foundation / apron / deck
      const concD = F.shade(conc, 0.82);
      const dark = F.mix(0x14181c, body, 0.10);    // vents, recesses: the darkest thing here

      // ============================================================
      //  2. THE ROOF, SOLVED FIRST AND BACKWARDS FROM rTop
      // ============================================================
      // TOP PLATE. The host builds its own parapet ring (0.55..1.05 m) on the
      // roof edge unconditionally, and a gable springing at rTop would leave it
      // poking out of the slope. So the facade buries it in a full-footprint
      // plate — which is not a workaround, it is the frieze zone every house
      // has between the top of the windows and the underside of the soffit.
      const plateTop = rTop + PP + 0.16;
      // RIDGE ORIENTATION: parallel to the street. The door face is one of the
      // two EAVE faces (it gets the fascia, the gutter and the porch); the two
      // faces at right angles to it are the GABLE ENDS.
      const ridgeX = (ctx.doorSide === 0 || ctx.doorSide === 1);
      const rLen = ridgeX ? W : D;                 // along the ridge
      const cW = ridgeX ? D : W;                   // across the slope
      const eaveOV = clamp(cW * 0.062, 0.34, 0.85);   // modest: a cheap house
      const rakeOV = eaveOV * 0.62;                   // rakes overhang less than eaves
      const halfC = cW / 2 + eaveOV;                  // eave line, from centre
      const halfA = rLen / 2 + rakeOV;                // gable-end roof edge
      // 5.5:12 to 7:12 — the ordinary asphalt range. Hashed, so a street of
      // these does not have one repeated roof angle.
      const pitch = 0.46 + ctx.hash(0x7231) * 0.15;
      const roofH = clamp(halfC * pitch, 1.45, FH * 1.55);
      const ridgeHalf = clamp(cW * 0.022, 0.16, 0.30);
      const nSh = clamp(Math.round(roofH / 0.27), 8, 16);   // shingle courses
      const S = halfC - ridgeHalf;                          // total inward run per side
      const shStep = S / nSh;
      // The slope's horizontal thickness MUST exceed the step or you can see
      // straight into the attic over the top edge of every course.
      const shThk = Math.max(0.34, shStep * 1.65);
      const shH = roofH / nSh;
      const ridgeY = plateTop + roofH;

      // Emit a box in ridge-space: `a` runs along the ridge, `c` across it.
      // The whole roof is written once and the two orientations fall out of this.
      function rbox(a, y, c, la, h, lc, col) {
        if (la <= 0.01 || h <= 0.01 || lc <= 0.01) return;
        if (ridgeX) ctx.dbox(a, y, c, la, h, lc, col);
        else ctx.dbox(c, y, a, lc, h, la, col);
      }

      // ============================================================
      //  3. THE PORCH, THE CHIMNEY AND THE GARAGE — SOLVED, NOT BUILT
      // ============================================================
      // Their footprints have to exist before the wall is laid out, because the
      // siding and the window bays are the COMPLEMENT of them. Laying windows on
      // one rhythm and then hanging a porch over three of them is how an
      // elevation ends up as two unrelated drawings on one wall.
      const df = e.f;
      const porchW = clamp(Math.max(e.gap + 2.4, df.span * 0.38),
        e.gap + 2.4, Math.min(df.span - 0.9, 7.2));
      const hasPorch = !e.driveIn && df.span >= e.gap + 3.6;
      // Nudge the porch off the door axis — a stoop roof that is not quite
      // centred is one of the cheapest and truest tells of a real tract house.
      const porchOff = hasPorch
        ? (ctx.hash(0x7412) < 0.5 ? -1 : 1) * Math.min(0.55, Math.max(0, porchW / 2 - e.gap / 2 - 0.75))
        : 0;
      const porchD = clamp(unit * 0.17, 1.15, 2.15);
      const deckY = 0.34;                        // two 0.17 rises, under STEP_UP
      // The porch roof is a STOREY element, never a crown. On a 2-storey house
      // it lands in the solid band around the first floor line and its underside
      // clears F.entrance's 3.6 m head; on a 1-storey cottage that head is
      // taller than the wall, so the roofline wins — exactly adobe.js's rule.
      const porchTop = Math.min(FH + 0.50, rTop - 0.35);
      const shedDrop = porchD * 0.34;            // ~4:12 on the shed

      const gableSides = ridgeX ? [2, 3] : [0, 1];
      const ci = ctx.hash(0x7501) < 0.5 ? 0 : 1;
      const chF = F.face(ctx, gableSides[ci]);           // chimney gable end
      const gaF = F.face(ctx, gableSides[1 - ci]);       // driveway gable end
      const chW = clamp(unit * 0.10, 0.85, 1.5);
      const chProj = clamp(chW * 0.52, 0.42, 0.75);
      const chT = (ctx.hash(0x7502) < 0.5 ? -1 : 1)
        * Math.min(chF.span * 0.21, Math.max(0, chF.span / 2 - chW / 2 - 0.6));
      const chTop = ridgeY + clamp(roofH * 0.20, 0.45, 0.9);

      const wantGar = !e.driveIn && gaF.span >= 10;
      const garW = clamp(gaF.span * 0.24, 2.4, 3.1);
      const garH = 2.15;
      const garT = (ctx.hash(0x7601) < 0.5 ? -1 : 1)
        * Math.max(0, Math.min(gaF.span * 0.24, gaF.span / 2 - garW / 2 - 0.85));

      // ============================================================
      //  4. WINDOW BAYS — the wall's rhythm
      // ============================================================
      // One bay per ~3.7 m of face, so bay WIDTH stays near-constant and the
      // COUNT moves with the building. Inside a bay the window, its casing and
      // its shutter pair are sized so at least 0.48 m of siding always survives
      // between neighbours — without that floor the shutters of adjacent windows
      // touch on a narrow flank and the wall stops reading as wall.
      const layout = [];
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const nb = F.bayCount(f, 3.7, 1, 5);
        const bays = F.bays(f, nb, Math.max(0.85, f.span * 0.075));
        const bw = bays.length ? bays[0].w : f.span;
        // 2.2 m of host glass tall by ~1.2 m wide is, to the metre, the
        // proportion of a real double-hung sash. No re-proportioning needed.
        const wW = clamp(Math.min(bw * 0.33, 1.34), 0.66, 1.34);
        const cw = clamp(wW * 0.15, 0.12, 0.18);
        let sw = Math.min((bw - 0.48 - wW - cw * 2) / 2, wW * 0.44, 0.50);
        if (sw < 0.17) sw = 0;
        layout.push({ f: f, bays: bays, wW: wW, cw: cw, sw: sw, occ: wW / 2 + cw + sw });
      }

      // Does this bay get a window on storey k? A bay is DROPPED, never nudged:
      // a shifted window reads as a mistake, a missing one reads as a blank
      // panel behind the chimney breast or over the garage, which is correct.
      // The PORCH is deliberately NOT a reason to drop a window — a front room
      // window opening onto the porch is normal, and killing those bays left an
      // 11 m cottage with a bricked-up ground floor and a door in it, which is
      // the exact failure the window rule exists to prevent.
      function bayLive(L, k, b) {
        const f = L.f, hi = L.occ + 0.12;
        if (f.s === chF.s && Math.abs(b.t - chT) < chW / 2 + hi) return false;
        if (wantGar && f.s === gaF.s && k === 0 && Math.abs(b.t - garT) < garW / 2 + hi) return false;
        if (f.s === ctx.doorSide && k === 0) return F.clearsDoor(ctx, f, b.t, L.occ * 2 + 0.4);
        return true;
      }

      // ============================================================
      //  5. THE FOUNDATION SKIRT
      // ============================================================
      // Concrete to just under the host's 0.55 m sill line, capped by a water
      // table board with a drip nose. The DOORWAY is a gap in it, not a kerb
      // across it — a 0.5 m lip in a doorway is precisely the trip the repo's
      // own door-collider notes were written about.
      const skirtH = clamp(unit * 0.042, 0.42, 0.52);
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const runs = subtract(-f.span / 2 - 0.08, f.span / 2 + 0.08,
          f.s === ctx.doorSide ? [[-1.15, 1.15]] : []);
        for (let i = 0; i < runs.length; i++) {
          const a = runs[i][0], b = runs[i][1];
          if (b - a < 0.12) continue;
          F.box(ctx, f, (a + b) / 2, skirtH * 0.5, b - a, skirtH, 0.155, conc);
          F.box(ctx, f, (a + b) / 2, skirtH + 0.06, b - a + 0.03, 0.12, 0.205, concD);
        }
      }

      // ============================================================
      //  6. THE LAP SIDING — the wall itself
      // ============================================================
      // One horizontal course per lap level, emitted in SEGMENTS around the
      // openings. Adjacent courses alternate projection (0.105 / 0.055), so
      // every joint is a real 0.05 m geometric step that throws a real shadow —
      // the same reason stone.js alternates its rustication rather than painting
      // stripes on a flat plane. Course pitch rides FH (FH/16 ≈ 0.20 m) and the
      // level count is capped so a 4-storey house does not mint 1600 boxes.
      const sidY0 = skirtH + 0.14;
      const nLap = Math.min(40, Math.max(6, Math.round((plateTop - sidY0) / (FH / 16))));
      const lh = (plateTop - sidY0) / nLap;

      // Where is face `f` SOLID at height cy? The host's contract: per storey
      // the wall is solid from the floor line to +0.55 and from the ceiling down
      // 0.45, and there is a 0.55 jamb at each end of every face. Read
      // conservatively (0.50 / 0.43) so a band can never clip the glass edge.
      function solidRuns(L, cy) {
        const f = L.f;
        const holes = [];
        // the doorway is never sided over
        if (f.s === ctx.doorSide && cy < 2.52) holes.push([-1.05, 1.05]);
        // nor is the chimney breast, at any height
        if (f.s === chF.s) holes.push([chT - chW / 2 - 0.05, chT + chW / 2 + 0.05]);
        if (wantGar && f.s === gaF.s && cy < garH + 0.34)
          holes.push([garT - garW / 2 - 0.24, garT + garW / 2 + 0.24]);
        const k = Math.min(ST - 1, Math.max(0, Math.floor(cy / FH)));
        const lo = cy - k * FH;
        const solidBand = (cy >= rTop) || (lo <= 0.50) || (lo >= FH - 0.43);
        if (!solidBand) {
          let live = 0;
          for (let i = 0; i < L.bays.length; i++) {
            const b = L.bays[i];
            if (!bayLive(L, k, b)) continue;
            holes.push([b.t - L.occ, b.t + L.occ]);
            live++;
          }
          // THE BACKSTOP. If a face+storey ends up with no window at all — a
          // frontage too narrow to fit a bay clear of the door, a chimney that
          // ate the only bay — siding the whole band would brick the wall up.
          // So side ONLY the host's own end jambs (which are solid wall anyway)
          // and leave the glass alone. A blank glazed strip is a bad elevation;
          // a bricked-up one is a broken building.
          if (!live) return [[-f.span / 2 - 0.05, -f.span / 2 + 0.50],
            [f.span / 2 - 0.50, f.span / 2 + 0.05]];
        }
        return subtract(-f.span / 2 - 0.05, f.span / 2 + 0.05, holes);
      }

      for (let fi = 0; fi < faces.length; fi++) {
        const L = layout[fi], f = L.f;
        for (let i = 0; i < nLap; i++) {
          const cy = sidY0 + (i + 0.5) * lh;
          const proud = (i % 2) === 0;
          const runs = solidRuns(L, cy);
          for (let r = 0; r < runs.length; r++) {
            const a = runs[r][0], b = runs[r][1];
            if (b - a < 0.14) continue;
            F.box(ctx, f, (a + b) / 2, cy, b - a, lh + 0.012,
              proud ? 0.105 : 0.055, proud ? body : bodyD);
          }
        }
      }

      // CORNER BOARDS. The siding has to die into something at each arris or it
      // simply stops in mid-air. Vertical, so crossing the host's window band is
      // not just allowed but the point: it is what breaks the ribbon.
      F.corners(ctx, (skirtH + plateTop) / 2, plateTop - skirtH, 0.22, 0.145, trim);

      // ============================================================
      //  7. THE WINDOWS — casing, drip cap, sill, muntins, shutters
      // ============================================================
      // The opening IS the host glass band: y = k*FH+0.55 .. (k+1)*FH-0.45.
      // Every piece of trim therefore lands in a zone the host already built
      // solid — the head casing and drip cap in the header, the sill and apron
      // in the sill — and nothing but hairline muntins ever crosses the glass.
      // LOD: the apron and the two minor muntins are dropped above the second
      // storey, where nobody can resolve a 0.14 m board anyway.
      function sash(L, k, b) {
        const f = L.f, t = b.t, wW = L.wW, cw = L.cw, sw = L.sw;
        const y0 = k * FH + 0.55, y1 = (k + 1) * FH - 0.45;
        if (y1 - y0 < 0.9) return;
        const gh = y1 - y0, gy = (y0 + y1) / 2;
        const CP = 0.145;                        // casing stands proud of the siding
        for (const sg of [-1, 1])
          F.box(ctx, f, t + sg * (wW / 2 + cw / 2), gy, cw, gh + cw * 2, CP, trim);
        F.box(ctx, f, t, y1 + cw * 0.55, wW + cw * 2, cw * 1.1, CP, trim);        // head casing
        F.box(ctx, f, t, y1 + cw * 1.25, wW + cw * 2 + 0.26, 0.10, CP + 0.10, trimD);  // DRIP CAP
        F.box(ctx, f, t, y0 - 0.10, wW + cw * 2 + 0.20, 0.13, CP + 0.09, trim);  // sill, with a nose
        // muntins: a centre stile and a meeting rail, thin enough that the glass
        // still reads as glass. A shutter over the opening would be a bug; a
        // muntin cross on it is what makes it a sash.
        F.box(ctx, f, t, gy, 0.07, gh - 0.03, 0.05, trim);
        F.box(ctx, f, t, y0 + gh * 0.50, wW - 0.02, 0.09, 0.055, trim);
        if (k <= 1) {
          // the apron under the sill — but not on the ground storey, where it
          // would land inside the foundation's water-table cap.
          if (y0 - 0.32 > skirtH + 0.16)
            F.box(ctx, f, t, y0 - 0.25, wW + cw * 0.6, 0.14, CP * 0.55, trimD);
          F.box(ctx, f, t, y0 + gh * 0.25, wW - 0.02, 0.05, 0.045, trim);
          F.box(ctx, f, t, y0 + gh * 0.75, wW - 0.02, 0.05, 0.045, trim);
        }
        if (sw > 0.17) {
          for (const sg of [-1, 1]) {
            const st = t + sg * (wW / 2 + cw + sw / 2);
            F.box(ctx, f, st, gy, sw, gh + cw * 1.1, 0.10, shut);
            F.box(ctx, f, st, gy, sw, 0.11, 0.135, shutL);                       // mid rail
          }
        }
      }
      for (let fi = 0; fi < faces.length; fi++) {
        const L = layout[fi];
        for (let k = 0; k < ST; k++) {
          for (let i = 0; i < L.bays.length; i++) {
            if (bayLive(L, k, L.bays[i])) sash(L, k, L.bays[i]);
          }
        }
      }

      // ============================================================
      //  8. THE TOP PLATE + THE GABLE ROOF
      // ============================================================
      const plateH = plateTop - 0.21 - rTop;
      if (plateH > 0.05) ctx.dbox(0, rTop + plateH / 2, 0, W + 0.22, plateH, D + 0.22, body);
      ctx.dbox(0, plateTop - 0.105, 0, W + 0.30, 0.21, D + 0.30, trim);     // FRIEZE BOARD

      // SHINGLE COURSES. Two runs per course, one down each slope, stepping
      // inward as they rise. The step IS the pitch — nothing is rotated. Each
      // course gets a proud BUTT lip at its lower outer edge, which is the
      // single detail that makes a grey roof read as asphalt shingle rather than
      // as a grey ramp.
      for (let i = 0; i < nSh; i++) {
        const u0 = i / nSh;
        const ins = S * u0;
        const cy = plateTop + roofH * u0 + shH / 2;
        const col = (i % 3 === 1) ? roofB : ((i % 3 === 2) ? roofD : roofA);
        for (const sg of [-1, 1]) {
          rbox(0, cy, sg * (halfC - ins - shThk / 2), rLen + rakeOV * 2, shH + 0.03, shThk, col);
          rbox(0, plateTop + roofH * u0 + 0.045, sg * (halfC - ins - 0.05),
            rLen + rakeOV * 2 + 0.04, 0.09, 0.16, F.shade(roofA, 0.70));
        }
      }
      // RIDGE CAP: the capping course over the seam where the two slopes meet.
      rbox(0, ridgeY - 0.02, 0, rLen + rakeOV * 1.4, 0.17, ridgeHalf * 2 + shThk * 0.9, roofD);
      rbox(0, ridgeY + 0.11, 0, rLen + rakeOV * 1.2, 0.13, ridgeHalf * 2 + 0.30, roofB);

      // EAVES on the two cross-axis faces: soffit under the overhang, fascia
      // closing the rafter tails, gutter hung off the fascia. Four white lines
      // wrapping the top of the wall, all of them held CLEAR of the glass by
      // being above rTop.
      for (const sg of [-1, 1]) {
        rbox(0, plateTop - 0.15, sg * (cW / 2 + eaveOV / 2), rLen + rakeOV * 2, 0.13, eaveOV, trim);
        rbox(0, plateTop + 0.02, sg * (halfC + 0.07), rLen + rakeOV * 2 + 0.03, 0.32, 0.13, trim);
        rbox(0, plateTop - 0.15, sg * (halfC + 0.22), rLen + rakeOV * 1.9, 0.16, 0.20, trimD);
        rbox(0, plateTop - 0.05, sg * (halfC + 0.31), rLen + rakeOV * 1.9, 0.07, 0.06, F.shade(trimD, 0.80));
      }

      // GABLE ENDS: the rake board stepping up the slope, the siding triangle
      // under it, the attic vent, and the cornice returns at the base.
      for (const sa of [-1, 1]) {
        for (let i = 0; i < nSh; i++) {
          const u0 = i / nSh, ins = S * u0;
          const cy = plateTop + roofH * u0 + shH / 2;
          for (const sg of [-1, 1]) {
            rbox(sa * (halfA + 0.08), cy, sg * (halfC - ins - shThk / 2),
              0.16, shH + 0.03, shThk + 0.06, trim);
          }
          // the triangle of siding, stepped to the underside of the slope. Its
          // steps land on the same alternation as the wall's lap courses, so the
          // gable reads as the same material and not as a plywood infill.
          const gHalf = Math.min(cW / 2, halfC - ins - shThk * 0.75);
          if (gHalf > 0.10) {
            rbox(sa * (rLen / 2 - 0.13), cy, 0, 0.32, shH + 0.02, gHalf * 2,
              (i % 2) ? body : bodyD);
          }
        }
        // LOUVERED ATTIC VENT near the apex — the one thing on a gable end that
        // proves there is a roof space behind it.
        const vW = clamp(cW * 0.10, 0.52, 1.00);
        const vH = Math.min(vW * 0.85, roofH * 0.26);
        const vY = plateTop + roofH * 0.58;
        rbox(sa * (rLen / 2 + 0.07), vY, 0, 0.14, vH + 0.22, vW + 0.22, trim);
        rbox(sa * (rLen / 2 + 0.12), vY, 0, 0.10, vH, vW, dark);
        for (let s2 = 0; s2 < 3; s2++)
          rbox(sa * (rLen / 2 + 0.16), vY - vH * 0.30 + s2 * vH * 0.30, 0,
            0.06, vH * 0.11, vW * 0.86, trimD);
        // CORNICE RETURNS: the stub of eave that turns the corner and dies into
        // the rake. Tiny, and its absence is why cheap gables look unfinished.
        for (const sg of [-1, 1]) {
          rbox(sa * (rLen / 2 + rakeOV * 0.45), plateTop - 0.02, sg * (cW / 2 + eaveOV * 0.5),
            rakeOV * 1.7, 0.30, eaveOV * 1.05, trim);
        }
      }

      // PLUMBING VENT STACK through the BACK slope — never the street slope,
      // because that is where a real plumber puts it and because the front of a
      // house is the one elevation nobody is allowed to clutter.
      {
        const bs = -df.out;                       // the slope away from the door
        const u = 0.42;
        const sy = plateTop + roofH * u;
        const sc = bs * (halfC - S * u - shThk * 0.5);
        rbox(rLen * 0.22, sy + 0.05, sc, 0.36, 0.12, 0.36, roofD);            // flashing collar
        rbox(rLen * 0.22, sy + 0.52, sc, 0.15, 0.92, 0.15, F.shade(dark, 1.6));
      }

      // ============================================================
      //  9. THE CHIMNEY — brick, out one gable end, off-centre
      // ============================================================
      {
        F.rib(ctx, chF, chT, 0.0, chTop - 0.34, chW, chProj, brick);
        // a mortar line every ~0.9 m: enough to read as brick at street
        // distance without minting a course box for every real brick.
        const nCC = Math.min(12, Math.max(3, Math.round(chTop / 0.9)));
        for (let i = 1; i < nCC; i++)
          F.box(ctx, chF, chT, (chTop * i) / nCC, chW * 0.98, 0.07, chProj + 0.025, brickD);
        F.box(ctx, chF, chT, chTop - 0.30, chW + 0.20, 0.22, chProj + 0.12, brick);      // corbel
        F.box(ctx, chF, chT, chTop - 0.13, chW + 0.32, 0.14, chProj + 0.19, F.shade(brick, 1.10));
        F.box(ctx, chF, chT, chTop, chW + 0.10, 0.11, chProj + 0.07, conc);              // crown wash
        F.box(ctx, chF, chT, chTop + 0.22, chW * 0.40, 0.42, chProj * 0.55, dark);       // flue
      }

      // ============================================================
      //  10. THE FRONT PORCH
      // ============================================================
      if (hasPorch) {
        const pHalf = porchW / 2, halfN = df.halfN;
        // THE DECK, as a real walk platform. Two 0.17 m rises from the path to
        // the threshold, both well under physics STEP_UP (0.45), and no
        // collider — a stoop must never be able to seal the front door.
        F.box(ctx, df, porchOff, deckY / 2, porchW, deckY, porchD, concD);
        F.box(ctx, df, porchOff, deckY - 0.035, porchW + 0.10, 0.09, porchD + 0.08, conc);
        const nbd = Math.max(3, Math.round(porchD / 0.32));
        for (let i = 1; i < nbd; i++)
          F.box(ctx, df, porchOff, deckY - 0.005, porchW - 0.06, 0.045, 0.05,
            F.shade(concD, 0.80), (i / nbd) * porchD);
        const stH = deckY / 2, stD = 0.44;
        F.box(ctx, df, porchOff, stH / 2, porchW * 0.60, stH, stD, concD, porchD);
        F.box(ctx, df, porchOff, stH - 0.03, porchW * 0.60 + 0.08, 0.07, stD + 0.06, conc, porchD);
        if (df.horiz) {
          const z0 = df.out > 0 ? halfN : -(halfN + porchD);
          const z1 = df.out > 0 ? halfN + porchD : -halfN;
          ctx.plat(porchOff - pHalf, porchOff + pHalf, z0, z1, deckY, null);
          const s0 = df.out > 0 ? halfN + porchD : -(halfN + porchD + stD);
          const s1 = df.out > 0 ? halfN + porchD + stD : -(halfN + porchD);
          ctx.plat(porchOff - porchW * 0.30, porchOff + porchW * 0.30, s0, s1, stH, null);
        } else {
          const x0 = df.out > 0 ? halfN : -(halfN + porchD);
          const x1 = df.out > 0 ? halfN + porchD : -halfN;
          ctx.plat(x0, x1, porchOff - pHalf, porchOff + pHalf, deckY, null);
          const s0 = df.out > 0 ? halfN + porchD : -(halfN + porchD + stD);
          const s1 = df.out > 0 ? halfN + porchD + stD : -(halfN + porchD);
          ctx.plat(s0, s1, porchOff - porchW * 0.30, porchOff + porchW * 0.30, stH, null);
        }
        // THE SHED ROOF: four courses walking DOWN and OUT. The course AT THE
        // WALL is deliberately thin so its underside clears e.head over the
        // threshold; the drop happens outboard of the wall, where a 4:12 shed
        // belongs and where nothing can foul the doorway.
        const nps = 4, psD = porchD / nps;
        for (let j = 0; j < nps; j++) {
          // 0.10 at the wall: porchTop (FH+0.50) minus that is exactly e.head.
          const th = 0.10 + j * 0.04;
          const ty = porchTop - (shedDrop * j) / nps;
          F.box(ctx, df, porchOff, ty - th / 2, porchW + 0.34 - j * 0.02, th, psD + 0.10,
            (j % 2) ? roofB : roofA, j * psD);
        }
        const outTop = porchTop - (shedDrop * (nps - 1)) / nps;
        F.box(ctx, df, porchOff, outTop - 0.30, porchW + 0.38, 0.22, 0.13, trim, porchD + 0.02);
        const beamB = outTop - 0.54;
        F.box(ctx, df, porchOff, beamB + 0.13, porchW + 0.06, 0.26, 0.20, trim, porchD - 0.24);
        // TWO POSTS. Square 4x4s in dbox, not turned columns: this house cannot
        // afford a lathe, and the mesh budget is better spent elsewhere.
        const postW = clamp(porchD * 0.11, 0.17, 0.24);
        for (const sg of [-1, 1]) {
          const ptt = porchOff + sg * (pHalf - postW * 0.8);
          const pIn = porchD - postW - 0.16;
          F.box(ctx, df, ptt, (deckY + beamB) / 2, postW, beamB - deckY, postW, trim, pIn);
          F.box(ctx, df, ptt, beamB - 0.10, postW + 0.14, 0.14, postW + 0.14, trim, pIn - 0.07);
          F.box(ctx, df, ptt, deckY + 0.09, postW + 0.12, 0.16, postW + 0.12, trim, pIn - 0.06);
          // SIDE RAILINGS only — the front stays open so the walk-in is clear.
          const rl = porchD - postW - 0.32;
          if (rl > 0.5) {
            for (const ry of [deckY + 0.30, deckY + 0.92])
              F.box(ctx, df, ptt, ry, postW * 0.72, 0.09, rl, trim, 0.13);
            for (let i = 0; i < 4; i++)
              F.box(ctx, df, ptt, deckY + 0.61, postW * 0.45, 0.62, 0.07, trim,
                0.13 + (i + 0.5) * (rl / 4));
          }
        }
        // A DOORMAT. One box, and it does more for "someone lives here" than
        // any amount of moulding.
        F.box(ctx, df, 0, deckY + 0.02, 1.10, 0.04, 0.62, F.shade(dark, 1.35), 0.12);
      } else {
        // NO ROOM FOR A PORCH on a narrow frontage: a plain stoop and a
        // bracketed door hood, which is what the cheap version really has.
        const hy = Math.min(FH + 0.48, rTop - 0.30);
        const hd = clamp(unit * 0.09, 0.65, 1.05);
        F.box(ctx, df, 0, hy, e.gap + 1.5, 0.14, hd, roofA);
        F.box(ctx, df, 0, hy - 0.14, e.gap + 1.1, 0.12, hd * 0.75, trim);
        for (const sg of [-1, 1]) {
          F.rib(ctx, df, sg * (e.gap / 2 + 0.38), hy - 0.80, hy - 0.14, 0.16, hd * 0.55, trim);
          F.box(ctx, df, sg * (e.gap / 2 + 0.38), hy - 0.86, 0.16, 0.14, hd * 0.30, trim);
        }
        F.box(ctx, df, 0, deckY / 2, e.gap + 1.2, deckY, 0.95, concD);
        F.box(ctx, df, 0, deckY - 0.035, e.gap + 1.3, 0.09, 1.03, conc);
        const halfN = df.halfN;
        if (df.horiz) {
          const z0 = df.out > 0 ? halfN : -(halfN + 0.95), z1 = df.out > 0 ? halfN + 0.95 : -halfN;
          ctx.plat(-(e.gap + 1.2) / 2, (e.gap + 1.2) / 2, z0, z1, deckY, null);
        } else {
          const x0 = df.out > 0 ? halfN : -(halfN + 0.95), x1 = df.out > 0 ? halfN + 0.95 : -halfN;
          ctx.plat(x0, x1, -(e.gap + 1.2) / 2, (e.gap + 1.2) / 2, deckY, null);
        }
      }

      // THE DOOR SURROUND, in the door colour. Vertical boards outside e.gap, so
      // nothing crosses the opening: the host owns the leaf and its casing, and
      // the accent colour is applied to what frames it. This is also the only
      // place the door colour appears at full strength — the shutters carry a
      // muted version of it, which is how a tract house ties itself together.
      for (const sg of [-1, 1])
        F.rib(ctx, df, sg * 1.58, deckY - 0.05, 2.66, 0.26, 0.14, door);
      F.box(ctx, df, 0, deckY + 0.02, 2.9, 0.05, 0.05, F.shade(door, 0.8), 0.02);   // threshold

      // ============================================================
      //  11. THE FITTINGS — the things that say it is occupied
      // ============================================================
      // PORCH LIGHT: the facade's only real mesh. One lamp, beside the door.
      {
        const lt = (ctx.hash(0x7801) < 0.5 ? -1 : 1) * 1.95;
        const ly = 2.18;
        F.box(ctx, df, lt, ly - 0.22, 0.11, 0.36, 0.12, trimD);          // back plate
        F.box(ctx, df, lt, ly + 0.21, 0.22, 0.10, 0.22, trimD);          // little hood
        if (ctx.lamp) {
          const n = df.halfN + 0.22;
          ctx.lamp(df.horiz ? lt : df.out * n, ly, df.horiz ? df.out * n : lt, 0.13, 0xffe3ac);
        }
        // MAILBOX on the other side of the door.
        F.box(ctx, df, -lt, 1.42, 0.34, 0.24, 0.17, door);
        F.box(ctx, df, -lt, 1.56, 0.36, 0.06, 0.20, F.shade(door, 0.78));
      }

      // GARAGE DOOR on the driveway flank when the flank is long enough to have
      // a driveway at all; otherwise the meters below carry that elevation.
      if (wantGar) {
        F.box(ctx, gaF, garT, garH / 2 + 0.03, garW, garH - 0.06, 0.11, F.shade(trim, 0.96));
        const rows = 4, cols = garW > 2.7 ? 3 : 2;
        const pw = (garW - 0.30) / cols, ph = (garH - 0.36) / rows;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          F.box(ctx, gaF, garT - garW / 2 + 0.15 + (c + 0.5) * pw, 0.18 + (r + 0.5) * ph,
            pw - 0.11, ph - 0.11, 0.15, trim);
        }
        F.box(ctx, gaF, garT, garH + 0.14, garW + 0.42, 0.20, 0.18, trim);            // head trim
        for (const sg of [-1, 1])
          F.rib(ctx, gaF, garT + sg * (garW / 2 + 0.12), 0.03, garH + 0.24, 0.22, 0.17, trim);
        F.box(ctx, gaF, garT, 0.05, garW + 0.7, 0.10, clamp(gaF.span * 0.22, 2.2, 3.4), conc);
      }
      // METERS AND A HOSE BIB on the chimney flank, at the far end from the
      // chimney. Nobody notices them; a house without them looks like a model.
      {
        const ut = (chT < 0 ? 1 : -1) * Math.min(chF.span * 0.30, chF.span / 2 - 1.1);
        F.box(ctx, chF, ut, 1.45, 0.40, 0.52, 0.22, F.shade(conc, 1.08));
        F.box(ctx, chF, ut, 1.62, 0.26, 0.26, 0.30, F.shade(dark, 1.9));       // the dial
        F.box(ctx, chF, ut + 0.66, 1.15, 0.30, 0.36, 0.20, F.shade(conc, 0.90));
        F.box(ctx, chF, ut + 0.66, 0.82, 0.10, 0.34, 0.14, concD);             // riser
        F.box(ctx, chF, ut - 0.60, 0.72, 0.10, 0.10, 0.20, F.shade(trimD, 0.78));
      }

      // DOWNSPOUT: off one front corner, an elbow at the bottom and a splash
      // block on the ground. Vertical, so it crosses the window band freely —
      // and it is the last piece of the four white lines wrapping the eave.
      {
        const dsA = (ctx.hash(0x7702) < 0.5 ? -1 : 1) * (rLen / 2 - 0.30);
        const dsC = df.out * (cW / 2 + 0.12);
        const dsTop = plateTop - 0.22, dsBot = 0.26;
        rbox(dsA, (dsTop + dsBot) / 2, dsC, 0.13, dsTop - dsBot, 0.13, trimD);
        rbox(dsA, dsBot - 0.05, dsC + df.out * 0.20, 0.13, 0.12, 0.44, trimD);
        rbox(dsA, 0.05, dsC + df.out * 0.56, 0.52, 0.10, 0.72, concD);
      }
    },
  });
})();
