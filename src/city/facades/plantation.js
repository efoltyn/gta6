/* ============================================================
   city/facades/plantation.js — "Antebellum Plantation House": the
   deep-south raised gallery house.

   WHAT IS BEING MODELLED. Not a mansion with columns applied to it — a house
   wrapped in an OUTDOOR ROOM. In the Lower Mississippi the sun and the damp
   are the design brief, so the house is lifted onto a brick plinth and then
   ringed on EVERY face by a two-level veranda: a colonnade standing a good
   two metres clear of the wall, carrying a gallery at the first-floor line
   and, above that, the broad low hipped roof itself. The wall behind is
   almost incidental. What you recognise from the street is the rhythm of the
   columns, the two horizontal lines of gallery deck and balustrade running
   between them, and the deep shade the whole apparatus lays on the wall.

   That is deliberately different from greekrev.js, which is a TEMPLE FRONT:
   one portico, one pediment, entrance face only, ridge to the street. This
   one WRAPS all four faces, has a gallery on every floor line above the
   ground, and its roof is HIPPED with dormers rather than gabled.

   WHY EACH ELEMENT IS HERE.

     PLINTH AND     A low brick apron with crawl vents, 0.34 m high — under
     DECK           physics STEP_UP, and registered as four ctx.plat rects so
                    the veranda is a walkable ring, not scenery. Broad steps
                    on one continuous ramp platform at the door, as stone.js.

     THE COLOSSAL   Boxed pillars at the DECK EDGE on all four faces, one
     COLONNADE      shared pillar per corner so the colonnade genuinely turns,
                    running in ONE storey-crossing order from deck to
                    architrave so the gallery threads between them rather than
                    stacking two short orders. The count comes from the
                    perimeter at a target spacing, and the CENTRE gap of the
                    entrance face is widened until it clears F.entrance — a
                    widened centre intercolumniation is period licence, a
                    shifted column is a mistake. Six to eight per face: they
                    must be countable from the street, because the count IS
                    the style. Boxed (dbox) rather than turned: square
                    plastered pillars are the honest vernacular and it is what
                    lets twenty of them cost nothing, and a lighter sliver
                    down the middle of each of a pillar's four faces gives it
                    the lit-centre/dark-arris shading of a round shaft.

     THE GALLERIES  A projecting deck and a full balustrade at EVERY floor
                    line above the ground: the 2-storey house gets the
                    canonical double-height veranda, the 4-storey one the
                    three-tier New Orleans version instead of a stretched
                    order. Each deck lives ENTIRELY inside the host's solid
                    sill zone (floor line … +0.55) — the only reason a 2 m
                    projection may touch the wall at all.

     ENTABLATURE    Architrave, plain frieze, cornice, carried on the pillars
                    out at the deck edge, so the deepest horizontal on the
                    building never touches the wall.

     HIPPED ROOF    Stepped courses walking in on BOTH axes (victorian.js's
                    mansard with the second axis unfrozen), springing from the
                    veranda's outer rectangle so the eaves fly out over the
                    whole gallery. Hip ribs on the four corners, a ridge cap,
                    and a low 0.46 rise/run: broad and low, or it is a barn.
                    DORMERS sit on the slope, their front plane read off the
                    slope at their own height so they can never sink into it
                    and their count solved from how much roof plane is left up
                    there — on a hip, far less than a mansard leaves. A pair
                    of CHIMNEYS rises out of the slope near the end walls.

     CENTRAL        A low pedimented bay breaking the eave over the door, with
     GABLED BAY     a raked cornice, a recessed tympanum and a lunette — what
                    a hipped-roof plantation house has instead of a temple
                    front. Dormers stand aside for it.

     SHUTTERS       Tall louvred pairs FLANKING the host's glass on every
                    window, with sill, flat head and a sash grid. They and the
                    piers between bays are VERTICAL, which is what turns the
                    host's glass ribbon into punched openings. A shutter
                    beside the glass is the point; over it is a bug.

     THE DOORWAY    Pilasters outside F.entrance's gap, sidelights either side
                    of the leaf, a stepped fanlight, a cornice, two lit
                    carriage lamps. Everything crossing the door axis is held
                    above the host's 2.25 m door head.

   COLOUR. Limewashed cream body, brighter cream trim, one hash-picked dark
   shutter colour, a clearly darker roof. Merged deco cannot cast shadows in
   this renderer, so the veranda's shade is PAINTED: every square metre of
   wall this facade clads is laid in a shaded tone, with dark lines under each
   gallery deck and under the eave, so the white colonnade reads against a
   wall that is genuinely in shadow. Nothing goes near 0xffffff — mixing hard
   to white is what flattened stone.js's first render.

   SPEC OPTIONS (all optional; the facade is complete with {style:"plantation"}):
     spec.shutter   hex, overrides the hash-picked shutter colour.
     spec.gable     false → no central gabled bay (plain hip, dormers all round).

   MESHES: two carriage lamps. Everything else is dbox and folds into the
   host's merged deco buckets, so twenty pillars cost nothing.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // THE SHUTTER COLOURWAYS. Authored outright, not derived: the host colour
  // arrives near-white in a pale district and a shutter that only tints it
  // stops being the one saturated thing on the building.
  const SHUTTERS = [
    0x2b3f31,   // bottle green — the default of the whole region
    0x24303a,   // near-black blue
    0x3b2f26,   // dark brown
    0x33402f,   // olive
  ];

  // ---- a horizontal band on one face, interrupted by "holes" -------------
  // Lifted from stone.js: holes is a list of [t0,t1] tangent intervals the
  // band must not cross. You do not cut a hole in merged axis-aligned boxes,
  // you decline to draw over it.
  function runBand(ctx, F, f, cy, h, proj, col, holes, over) {
    const L = -f.span / 2 - (over == null ? 0.12 : over);
    const R = -L;
    let x = L;
    const hs = (holes || []).slice().sort(function (a, b) { return a[0] - b[0]; });
    for (let i = 0; i < hs.length; i++) {
      const a = Math.max(L, hs[i][0]), b = Math.min(R, hs[i][1]);
      if (b <= x) continue;
      if (a - x > 0.05) F.box(ctx, f, (x + a) / 2, cy, a - x, h, proj, col);
      x = b;
    }
    if (R - x > 0.05) F.box(ctx, f, (x + R) / 2, cy, R - x, h, proj, col);
  }

  CBZ.registerFacade("plantation", {
    label: "Antebellum Plantation House",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — an antebellum house is heavy timber frame on brick piers.
    structure: "timber",
    crownsRoof: true,
    // This grammar builds its own entrance — pilasters, sidelights, a stepped fanlight and a cornice with carriage lamps — so the kit
    // must not stack its generic reveal on top of it. The doorway is still
    // CARVED either way; ownDoor only declines the extra surround.
    ownDoor: true,
    // A gallery house is 2 storeys, 3 at a stretch and 4 as a New Orleans
    // three-tier block. Past that the colossal order is nonsense, so the
    // city-wide auto-picker is not allowed to put this grammar on a tower.
    maxStoreys: 4,
    build: function (ctx, F, spec) {
      const W = ctx.w, D = ctx.d, FH = ctx.FH;
      const ST = Math.max(1, ctx.storeys | 0);
      const H = ctx.rTop;                       // top of the walls = roof spring
      const unit = Math.min(W, D);              // the building's own ruler
      const e = F.entrance(ctx);
      const faces = F.faces(ctx);
      const df = e.f;                           // the entrance face
      const doorAxisX = (ctx.doorSide === 0 || ctx.doorSide === 1);
      const wantGable = !(spec && spec.gable === false);

      // ============================================================
      //  1. PALETTE
      // ============================================================
      const WALL = F.mix(ctx.color, 0xf3ead6, 0.66);      // limewashed body
      const WALLS = F.shade(WALL, 0.80);                  // …the same body, in the veranda's shade
      const TRIM = F.mix(WALL, 0xfff8ec, 0.44);           // pillars, rails, entablature, sash trim
      const TRIMD = F.shade(TRIM, 0.87);                  // shaft body, so the highlight can read
      const DARK = F.shade(WALL, 0.50);                   // under-deck lines, eave shade, reveals
      const sPick = SHUTTERS[Math.min(SHUTTERS.length - 1, (ctx.hash(0x91a7) * SHUTTERS.length) | 0)];
      const SHUT = (spec && spec.shutter) ? spec.shutter : F.mix(sPick, ctx.color, 0.10);
      const SHUTD = F.shade(SHUT, 0.66);                  // the louvre slats
      const ROOF = F.shade(F.mix(0x4a4f4a, ctx.color, 0.14), 0.60);
      const ROOFL = F.mix(ROOF, 0xfdfdf6, 0.10);
      const BRICK = F.shade(F.mix(0x8d5238, ctx.color, 0.16), 0.88);
      const GLASS = F.mix(0x18202a, WALL, 0.10);

      // ============================================================
      //  2. THE SOLVE — top-down from the roofline, per the kit's rule
      // ============================================================
      const deckTop = 0.34;                               // < physics STEP_UP (0.45)
      const P = clamp(unit * 0.20, 1.7, 3.2);             // veranda depth: it must throw shade
      const EO = clamp(unit * 0.055, 0.40, 0.85);         // eave flying past the colonnade
      const entH = clamp(FH * 0.26, 0.55, 0.95);          // the plain entablature
      const colTop = H - entH;                            // capitals meet the architrave
      const colH = colTop - deckTop;
      // A pillar's thickness comes from its own height, not from a constant:
      // about 13 widths tall on the 2-storey subject, which is slim, and it
      // stops the 4-storey mansion growing 13 m of matchstick.
      const hw = clamp(colH * 0.036, 0.15, 0.42);         // half width of a shaft
      const cxC = W / 2 + P - hw * 1.25;                  // pillar centre lines, x
      const czC = D / 2 + P - hw * 1.25;                  // …and z
      const tStep = clamp(unit * 0.28, 2.6, 4.0);         // target intercolumniation

      // WHERE THE PILLARS STAND on one axis. Symmetric about the centre with
      // no pillar ON the centre, so the number of gaps is odd and the entrance
      // always lands in a gap. On the door axis the centre gap is widened
      // until it clears F.entrance.
      function colLine(half, wide) {
        const out = [];
        const G = wide ? Math.max(e.gap + hw * 2.8, tStep * 1.05) : tStep;
        if (half <= G * 0.62) { out.push(-half); out.push(half); return out; }
        const R = half - G / 2;
        const n = Math.max(1, Math.round(R / tStep));
        const st = R / n;
        for (let i = n; i >= 0; i--) out.push(-(G / 2 + i * st));
        for (let i = 0; i <= n; i++) out.push(G / 2 + i * st);
        return out;
      }
      const PX = colLine(cxC, doorAxisX);                 // tangent positions, faces 0/1
      const PZ = colLine(czC, !doorAxisX);                // tangent positions, faces 2/3

      // ---- perimeter emitters. The veranda is a rectangular RING, so most of
      // this file works in plan rather than on the wall plane: `outer` is the
      // distance from the building centre to a box's OUTER face.
      function obox(f, t, cy, len, h, dep, outer, col) {
        const nc = outer - dep / 2;
        if (f.horiz) ctx.dbox(t, cy, f.out * nc, len, h, dep, col);
        else ctx.dbox(f.out * nc, cy, t, dep, h, len, col);
      }
      function ringLen(f) { return f.span + 2 * P + 0.08; }   // meets exactly at the corners
      function deckEdge(f) { return f.halfN + P; }

      // ---- the entrance, solved before anything else needs to dodge it ----
      // Solved DOWNWARD from the porch ceiling — the first gallery deck's
      // soffit on a house, the eave soffit on a cottage — because that ceiling
      // is fixed by the host's storey height and the doorcase is not. The door
      // head is then clamped to stay above the host's own 2.25 m door leaf.
      const ceilTop = (ST > 1) ? (FH + 0.05) : (H - 0.30);
      const dHead = ceilTop - 0.22;                       // underside of the doorcase cornice
      const dTop = clamp(dHead - 0.55, 2.30, 2.60);       // head of the door opening
      const fanR = clamp(dHead - dTop - 0.10, 0.12, 0.60); // fanlight rise
      const dcHalf = e.gap / 2 + 0.53;                    // doorcase pilasters' outer edge

      // ============================================================
      //  3. THE PLINTH, THE VERANDA DECK AND THE STEPS
      // ============================================================
      for (const f of faces) {
        const len = ringLen(f), outer = deckEdge(f);
        // A DRIVE-IN host (showroom / garage deck) has a bay where the front
        // door would be, so the raised deck runs in two lengths either side of
        // it rather than laying a 0.34 m lip across a vehicle opening.
        const bay = (f.s === ctx.doorSide && e.driveIn) ? e.gap + 1.0 : 0;
        const lay = function (cy, h, dep, out2, col, grow) {
          const L = len + (grow || 0);
          if (bay <= 0) { obox(f, 0, cy, L, h, dep, out2, col); return; }
          const seg = (L - bay) / 2;
          if (seg > 0.25) for (const sg of [-1, 1]) obox(f, sg * (bay + seg) / 2, cy, seg, h, dep, out2, col);
        };
        lay(0.12, 0.24, 0.26, outer, BRICK);                        // the brick apron
        lay(0.25, 0.07, 0.30, outer + 0.02, F.shade(BRICK, 1.12), 0.04);
        // crawl-space vents, which are what stop the apron reading as a stripe
        const nv = Math.max(2, Math.round(len / 1.25));
        for (let i = 0; i < nv; i++) {
          const t = -len / 2 + (i + 0.5) * (len / nv);
          if (Math.abs(t) < bay / 2) continue;
          obox(f, t, 0.13, 0.11, 0.15, 0.30, outer + 0.01, DARK);
        }
        lay(0.29, 0.10, P, outer, TRIM);                            // the deck boards
        lay(0.28, 0.13, 0.12, outer + 0.05, TRIMD, 0.06);           // edge fascia
        lay(0.20, 0.08, P * 0.94, outer - 0.06, DARK, -0.10);       // joist shadow
      }
      // the walkable ring: four platforms, no collider, so a monumental porch
      // can never seal the building's own front door
      {
        const hx = W / 2, hz = D / 2;
        ctx.plat(-(hx + P), hx + P, -(hz + P), -hz, deckTop, null);
        ctx.plat(-(hx + P), hx + P, hz, hz + P, deckTop, null);
        ctx.plat(-(hx + P), -hx, -(hz + P), hz + P, deckTop, null);
        ctx.plat(hx, hx + P, -(hz + P), hz + P, deckTop, null);
      }
      // BROAD FRONT STEPS. Two cosmetic treads (0.17 rise each) over ONE
      // continuous ramp platform, so a sprinting player cannot sample a seam.
      const stepW = Math.min(df.span - 0.6, e.gap + clamp(df.span * 0.32, 2.0, 4.2));
      const stepD = clamp(P * 0.42, 0.7, 1.3);
      if (!e.driveIn) {
        const nStep = 2;
        for (let i = 0; i < nStep; i++) {
          const th = deckTop * (nStep - i) / nStep;
          const off = P + (i + 0.5) * (stepD / nStep);
          obox(df, 0, th / 2, stepW - i * 0.26, th, stepD / nStep + 0.02,
            df.halfN + off + stepD / (nStep * 2), F.shade(TRIM, 0.95));
        }
        const o0 = df.halfN + P, o1 = o0 + stepD;
        if (df.horiz) {
          const z0 = df.out * o0, z1 = df.out * o1;
          ctx.plat(-stepW / 2, stepW / 2, Math.min(z0, z1), Math.max(z0, z1), deckTop,
            { z0: ctx.oz + z1, z1: ctx.oz + z0, y0: 0, y1: deckTop });
        } else {
          const x0 = df.out * o0, x1 = df.out * o1;
          ctx.plat(Math.min(x0, x1), Math.max(x0, x1), -stepW / 2, stepW / 2, deckTop,
            { axis: "x", x0: ctx.ox + x1, x1: ctx.ox + x0, y0: 0, y1: deckTop });
        }
        // low brick cheeks, kept outside the walking lane
        for (const sg of [-1, 1]) {
          obox(df, sg * (stepW / 2 + 0.30), deckTop * 0.62, 0.52, deckTop * 1.24,
            stepD + 0.28, df.halfN + P + stepD, BRICK);
        }
      }

      // ============================================================
      //  4. THE COLOSSAL COLONNADE
      // ============================================================
      // One pillar per grid position round the perimeter, corner pillars shared
      // by the two faces that meet there — which is what makes the colonnade
      // TURN instead of stopping at each corner.
      function pillar(x, z) {
        const y0 = deckTop, capB = colTop - 0.36;
        ctx.dbox(x, y0 + 0.13, z, hw * 2.9, 0.26, hw * 2.9, TRIM);          // plinth block
        ctx.dbox(x, y0 + 0.32, z, hw * 2.5, 0.14, hw * 2.5, TRIMD);         // base mould
        // the shaft in two courses with a little entasis, laid in the slightly
        // darker trim so the highlight slivers have something to read against
        const sy = y0 + 0.39, sh = (capB - sy) / 2;
        for (let i = 0; i < 2 && sh > 0.12; i++) {
          const r = hw * (1 - i * 0.05), cy = sy + (i + 0.5) * sh;
          ctx.dbox(x, cy, z, r * 2, sh + 0.02, r * 2, TRIMD);
          // a lighter sliver down the middle of all four faces: the lit centre
          // and dark arrises of a turned shaft, for four boxes and no meshes
          for (const sg of [-1, 1]) {
            ctx.dbox(x + sg * r, cy, z, 0.05, sh - 0.06, r * 0.9, TRIM);
            ctx.dbox(x, cy, z + sg * r, r * 0.9, sh - 0.06, 0.05, TRIM);
          }
        }
        ctx.dbox(x, capB + 0.06, z, hw * 1.86, 0.12, hw * 1.86, TRIMD);     // necking
        ctx.dbox(x, capB + 0.19, z, hw * 2.3, 0.14, hw * 2.3, TRIM);        // echinus
        ctx.dbox(x, capB + 0.30, z, hw * 2.75, 0.12, hw * 2.75, TRIM);      // abacus
      }
      for (const sg of [-1, 1]) {
        for (let i = 0; i < PX.length; i++) pillar(PX[i], sg * czC);
        for (let i = 0; i < PZ.length; i++) {
          if (Math.abs(Math.abs(PZ[i]) - czC) < 0.01) continue;             // corner already stood
          pillar(sg * cxC, PZ[i]);
        }
      }

      // ============================================================
      //  5. THE GALLERIES — deck + balustrade at every floor line
      // ============================================================
      // A BALUSTRADE RUN between two adjacent pillars: bottom rail, turned
      // balusters, top rail and a cap. The pillars are the newels.
      const railH = clamp(FH * 0.29, 0.85, 1.15);
      function railRun(f, t0, t1, yDeck, outer) {
        const inner = (t1 - t0) - hw * 2.2;
        if (inner < 0.4) return;
        const tc = (t0 + t1) / 2;
        obox(f, tc, yDeck + 0.13, inner, 0.13, 0.17, outer, TRIM);          // bottom rail
        const pitch = 0.34;
        const cnt = Math.max(2, Math.round(inner / pitch));
        const sp = inner / cnt;
        for (let i = 0; i < cnt; i++) {
          const t = t0 + hw * 1.1 + (i + 0.5) * sp;
          obox(f, t, yDeck + (railH + 0.22) / 2, sp * 0.30, railH - 0.24, 0.12, outer - 0.02, TRIM);
          obox(f, t, yDeck + 0.22 + (railH - 0.24) * 0.34, sp * 0.50, (railH - 0.24) * 0.26,
            0.14, outer - 0.01, TRIMD);                                     // the turned belly
        }
        obox(f, tc, yDeck + railH, inner, 0.14, 0.22, outer + 0.02, TRIM);  // top rail
        obox(f, tc, yDeck + railH + 0.11, inner, 0.08, 0.28, outer + 0.05, TRIMD);
      }
      // THE DECKS live entirely inside the host's solid sill zone (k*FH …
      // k*FH+0.55) — the only reason a 2 m projection may touch the wall at
      // all. Over the doorway the soffit lands at k*FH+0.09, a metre clear of
      // the host's 2.25 m door head, deco-only with no collider, and
      // unavoidable: a two-level veranda IS a ceiling over its own front door.
      for (let k = 1; k < ST; k++) {
        const y = k * FH;
        for (const f of faces) {
          const len = ringLen(f), outer = deckEdge(f);
          obox(f, 0, y + 0.34, len, 0.36, P, outer, TRIM);                  // the gallery floor
          obox(f, 0, y + 0.14, len - 0.10, 0.10, P * 0.96, outer - 0.06, DARK);   // joist shade
          obox(f, 0, y + 0.44, len + 0.06, 0.16, 0.13, outer + 0.05, TRIMD);      // edge fascia
          // the shadow line the deck lays on the wall behind it
          F.band(ctx, f, y + 0.07, 0.12, 0.05, DARK, 0.14);
          const L = f.horiz ? PX : PZ;
          for (let i = 0; i + 1 < L.length; i++) railRun(f, L[i], L[i + 1], y + 0.52, outer - 0.14);
        }
      }
      // A ONE-STOREY COTTAGE has no gallery above, so its ground veranda takes
      // the balustrade instead — otherwise the porch is a row of bare posts.
      if (ST === 1) {
        for (const f of faces) {
          const L = f.horiz ? PX : PZ;
          for (let i = 0; i + 1 < L.length; i++) {
            const mid = (L[i] + L[i + 1]) / 2;
            if (f.s === ctx.doorSide && Math.abs(mid) < stepW / 2 + 0.3) continue;   // the steps
            railRun(f, L[i], L[i + 1], deckTop, deckEdge(f) - 0.14);
          }
        }
      }

      // ============================================================
      //  6. THE WALL — clad only where the host is solid
      // ============================================================
      // Per storey the host leaves solid: the sill zone (k*FH … +0.55), the
      // header zone ((k+1)*FH-0.45 … ), and a 0.55 m jamb at each end of the
      // face. Clad exactly those, cross the glass with VERTICALS only, and the
      // elevation reads as painted board with punched windows in it while
      // every one of the host's own windows stays open.
      // Only a band that would cross the OPENING steps aside: the ground sill
      // course would otherwise lay a kerb across the bottom of the door. The
      // header course is above the door head and runs straight through.
      const doorHole = [[-dcHalf, dcHalf]];
      function wallBand(f, cy, h, proj, col, hole) {
        if (hole) runBand(ctx, F, f, cy, h, proj, col, doorHole, 0.15);
        else F.band(ctx, f, cy, h, proj, col, 0.30);
      }
      function shutter(f, t, y0, y1, sw) {
        const h = y1 - y0, cy = (y0 + y1) / 2;
        F.box(ctx, f, t, cy, sw, h, 0.13, SHUT);                            // the leaf
        for (const sg of [-1, 1]) F.rib(ctx, f, t + sg * sw * 0.40, y0, y1, sw * 0.22, 0.17, SHUT);
        F.box(ctx, f, t, y0 + 0.09, sw, 0.14, 0.16, SHUT);                  // bottom rail
        F.box(ctx, f, t, y1 - 0.09, sw, 0.14, 0.16, SHUT);                  // top rail
        F.box(ctx, f, t, cy, sw, 0.13, 0.16, SHUT);                         // mid rail
        const ns = clamp(Math.round(h / 0.50), 3, 7);                       // the louvres
        for (let i = 0; i < ns; i++) {
          F.box(ctx, f, t, y0 + (i + 0.5) * (h / ns), sw * 0.80, (h / ns) * 0.46, 0.15, SHUTD);
        }
      }
      for (const f of faces) {
        const isDoor = (f.s === ctx.doorSide);
        // one wall bay per intercolumniation, so the wall answers the
        // colonnade instead of running a second, unrelated rhythm
        let nb = Math.max(2, Math.min(7, (f.horiz ? PX.length : PZ.length) - 1));
        if (isDoor && nb % 2 === 0) nb += 1;                                // a bay ON the door axis
        const marg = Math.max(0.78, f.span * 0.06);
        const bays = F.bays(f, nb, marg);
        const lines = F.bayLines(f, nb, marg);
        const step = bays.length ? bays[0].w : f.span;
        const winW = Math.min(step * 0.44, FH * 0.42, 1.5);
        const shW = clamp(winW * 0.44, 0.26, 0.68);
        const pierW = Math.max(0.26, step - winW - shW * 2 - 0.12);
        // CORNER BOARDS close a timber wall at the arris, and they land on the
        // host's own solid end jambs. Vertical, so they may cross the glass.
        for (const sg of [-1, 1]) F.rib(ctx, f, sg * (f.span / 2 - 0.30), deckTop, H - 0.12, 0.60, 0.11, TRIMD);
        for (let k = 0; k < ST; k++) {
          const y0 = k * FH, gy0 = y0 + 0.55, gy1 = y0 + FH - 0.45;
          // sill zone (from the porch floor up on the ground storey) …
          const s0 = (k === 0) ? deckTop + 0.02 : y0 + 0.02;
          if (gy0 - s0 > 0.08) wallBand(f, (s0 + gy0) / 2, gy0 - s0, 0.07, WALLS, isDoor && k === 0);
          // … and header zone. Both are inside the host's solid bands.
          wallBand(f, gy1 + 0.215, 0.42, 0.07, WALLS, false);
          // the piers between the bays: verticals, and the reason the glass
          // ribbon reads as separate openings
          for (let i = 0; i < lines.length; i++) {
            if (k === 0 && isDoor && !F.clearsDoor(ctx, f, lines[i], pierW + 0.4)) continue;
            F.rib(ctx, f, lines[i], y0 + 0.06, y0 + FH - 0.06, pierW, 0.09, WALLS);
          }
          for (let i = 0; i < bays.length; i++) {
            const t = bays[i].t;
            // on the ground storey of the entrance face the doorcase owns the
            // middle: any bay it would collide with is DROPPED, not nudged
            if (k === 0 && isDoor && !F.clearsDoor(ctx, f, t, winW + shW * 2 + 0.4)) continue;
            for (const sg of [-1, 1]) shutter(f, t + sg * (winW / 2 + shW / 2), gy0 - 0.02, gy1 + 0.02, shW);
            // a sash grid on the host's own glass: thin framing, never a panel
            F.rib(ctx, f, t, gy0 + 0.05, gy1 - 0.05, 0.055, 0.06, TRIM);
            for (const u of [0.34, 0.52, 0.70]) F.box(ctx, f, t, gy0 + (gy1 - gy0) * u, winW, 0.05, 0.06, TRIM);
            F.box(ctx, f, t, y0 + 0.46, winW + shW * 2 + 0.34, 0.15, 0.22, TRIM);        // sill
            F.box(ctx, f, t, y0 + 0.42, winW + shW * 2 + 0.18, 0.08, 0.14, TRIMD);
            F.box(ctx, f, t, y0 + FH - 0.34, winW + shW * 2 + 0.42, 0.18, 0.24, TRIM);   // flat head
            F.box(ctx, f, t, y0 + FH - 0.20, winW + shW * 2 + 0.26, 0.10, 0.30, TRIMD);
          }
        }
        // the eave's shadow on the wall, inside the top header zone
        F.band(ctx, f, H - 0.36, 0.12, 0.05, DARK, 0.14);
      }

      // ============================================================
      //  7. THE DOORWAY — sidelights, fanlight, pilasters, lamps
      // ============================================================
      {
        const f = df;
        // the leaf is the host's; this is the CASE around it. Pilasters sit
        // outside F.entrance's gap so nothing crowds the opening.
        for (const sg of [-1, 1]) {
          F.rib(ctx, f, sg * (e.gap / 2 + 0.30), deckTop, dHead, 0.46, 0.22, TRIM);
          F.box(ctx, f, sg * (e.gap / 2 + 0.30), dHead - 0.12, 0.58, 0.16, 0.28, TRIM);
        }
        // SIDELIGHTS: narrow glazing each side of the leaf, clear of it by
        // 5 cm and drawn as glass on glass, never as a panel over it
        for (const sg of [-1, 1]) {
          const t = sg * (e.gap * 0.36);
          F.box(ctx, f, t, (deckTop + 0.20 + dTop - 0.10) / 2, 0.30,
            (dTop - 0.10) - (deckTop + 0.20), 0.05, GLASS);
          F.rib(ctx, f, t, deckTop + 0.20, dTop - 0.10, 0.05, 0.08, TRIM);
          for (const sg2 of [-1, 1]) F.rib(ctx, f, t + sg2 * 0.17, deckTop + 0.20, dTop - 0.10, 0.07, 0.10, TRIM);
        }
        // THE FANLIGHT: a stepped semicircle of glazing over the door head,
        // with a ring and radiating bars. Everything here is above dTop, which
        // is above the host's 2.25 m door.
        const fw = e.gap - 0.5;
        for (let i = 0; i < 3; i++) {
          const u = (i + 0.5) / 3;
          F.box(ctx, f, 0, dTop + u * fanR, fw * Math.sqrt(Math.max(0, 1 - u * u)), fanR / 3 + 0.02, 0.05, GLASS);
        }
        F.arch(ctx, f, 0, dTop, fw, fanR, 0.11, 0.13, TRIM, "round");
        for (const u of [-0.42, 0, 0.42]) {
          F.rib(ctx, f, u * fw * 0.5, dTop, dTop + fanR * (1 - Math.abs(u) * 0.8), 0.06, 0.09, TRIM);
        }
        F.box(ctx, f, 0, dTop - 0.05, fw + 0.5, 0.14, 0.18, TRIM);            // the transom bar
        // the doorcase cornice
        F.box(ctx, f, 0, dHead + 0.02, e.gap + 1.9, 0.16, 0.30, TRIM);
        F.box(ctx, f, 0, dHead + 0.15, e.gap + 1.5, 0.10, 0.36, TRIMD);
        // CARRIAGE LAMPS — the only real meshes this facade mints, and the
        // only lit thing on the porch. Kept well clear of the door tangent.
        if (ctx.lamp) {
          const lr = clamp(unit * 0.019, 0.12, 0.20);
          const ly = Math.min(dTop - 0.35, 2.05);
          for (const sg of [-1, 1]) {
            const t = sg * (e.gap / 2 + 0.90);
            const nrm = f.halfN + 0.34;
            F.rib(ctx, f, t, ly, ly + 0.42, 0.10, 0.30, TRIMD);
            ctx.lamp(f.horiz ? t : f.out * nrm, ly, f.horiz ? f.out * nrm : t, lr, 0xffe0a8);
          }
        }
      }

      // ============================================================
      //  8. THE ENTABLATURE, THE PORCH CEILING AND THE EAVE
      // ============================================================
      // Carried on the pillars out at the deck edge, so the strongest
      // horizontal on the building never touches the wall at all.
      const aH = entH * 0.30, frH = entH * 0.44, coH = entH * 0.26;
      for (const f of faces) {
        const len = ringLen(f) + 0.06, outer = deckEdge(f) + 0.06;
        obox(f, 0, colTop + aH / 2, len, aH, hw * 2.5, outer, TRIM);                       // architrave
        obox(f, 0, colTop + aH + frH / 2, len, frH, hw * 2.2, outer - 0.04, F.shade(TRIM, 0.96));  // plain frieze
        obox(f, 0, colTop + aH + frH + coH / 2, len + 0.16, coH, hw * 3.0 + 0.22, outer + 0.12, TRIM);  // cornice
        obox(f, 0, H - 0.06, len + 0.24, 0.12, hw * 3.2 + 0.30, outer + 0.20, TRIMD);      // crown mould
        // the PORCH CEILING, from the wall out to the entablature. It touches
        // the wall inside the top header zone, so it clears the glass.
        obox(f, 0, H - 0.17, ringLen(f), 0.15, P - 0.04, deckEdge(f) - 0.02, TRIM);
        // the eave soffit and the fascia board at the roof's leading edge
        obox(f, 0, H - 0.04, len + 0.22, 0.12, EO + 0.18, deckEdge(f) + EO, TRIM);
        obox(f, 0, H + 0.13, len + 0.30, 0.26, 0.16, deckEdge(f) + EO + 0.04, TRIM);
        obox(f, 0, H + 0.28, len + 0.24, 0.09, 0.13, deckEdge(f) + EO + 0.01, TRIMD);
      }

      // ============================================================
      //  9. THE BROAD LOW HIPPED ROOF
      // ============================================================
      // Stepped courses walking in on BOTH axes — a hip is victorian.js's
      // mansard with the second axis unfrozen. It springs from the VERANDA's
      // outer rectangle, so the eaves fly out over the whole gallery, and the
      // host's own parapet is simply swallowed inside the first courses.
      const RW = W + 2 * (P + EO), RD = D + 2 * (P + EO);
      const run = Math.min(RW, RD) / 2 - 0.5;
      const roofH = clamp(unit * 0.30, FH * 0.62, FH * 1.5);
      // 0.46 rise over run is about 25 degrees. Any steeper and the thing
      // stops being a plantation roof and becomes a barn; the pitch is also
      // what decides whether the top closes to a ridge or leaves a small deck,
      // and on every subject size this lands on a ridge.
      const inSet = Math.min(run, roofH / 0.46);
      const PITCH = roofH / Math.max(0.1, inSet);
      const nC = 12, ch = roofH / nC;
      for (let i = 0; i < nC; i++) {
        const ins = inSet * ((i + 1) / nC);
        const cy = H + roofH * (i + 0.5) / nC;
        const col = (i % 3 === 1) ? ROOFL : (i % 3 === 2 ? F.shade(ROOF, 0.90) : ROOF);
        ctx.dbox(0, cy, 0, RW - ins * 2, ch + 0.02, RD - ins * 2, col);
        // a shingle lap line every third course
        if (i % 3 === 0) {
          ctx.dbox(0, H + roofH * (i / nC) + 0.04, 0, RW - ins * 2 + 0.10, 0.07,
            RD - ins * 2 + 0.10, F.shade(ROOF, 0.72));
        }
        // HIP RIBS down the four corners — without them the stack of boxes
        // reads as a ziggurat instead of a hipped roof
        const hwid = (RW - ins * 2) / 2, hdep = (RD - ins * 2) / 2;
        const rb = clamp(unit * 0.030, 0.16, 0.40);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          ctx.dbox(sx * hwid, cy, sz * hdep, rb * 1.7, ch + 0.02, rb * 1.7, ROOFL);
        }
      }
      const ridgeW = Math.max(0.4, RW - inSet * 2), ridgeD = Math.max(0.4, RD - inSet * 2);
      ctx.dbox(0, H + roofH + 0.07, 0, ridgeW + 0.22, 0.16, ridgeD + 0.22, ROOFL);
      ctx.dbox(0, H + roofH + 0.19, 0, ridgeW * 0.88, 0.12, ridgeD * 0.88, F.shade(ROOFL, 0.90));

      // ============================================================
      //  10. THE CENTRAL GABLED BAY over the entrance
      // ============================================================
      // Solved from the colonnade: it spans the wide centre intercolumniation
      // plus half a bay each side, so it is always centred on the door and
      // always narrower than the roof it breaks out of.
      let pedHalf = 0;
      {
        const dl = (doorAxisX ? PX : PZ);
        const pos = [];
        for (let i = 0; i < dl.length; i++) if (dl[i] > 0.01) pos.push(dl[i]);
        if (pos.length >= 2) pedHalf = pos[0] + (pos[1] - pos[0]) * 0.55;
        else if (pos.length) pedHalf = pos[0] * 0.55;
      }
      const pedH = clamp(pedHalf * 0.32, 0.7, roofH * 0.92);
      if (wantGable && pedHalf > 1.2) {
        const f = df, nEave = f.halfN + P + EO;
        const cs = 6, sh = pedH / cs, base = H + 0.26;
        // the horizontal cornice the pediment stands on
        obox(f, 0, H + 0.14, pedHalf * 2 + 0.6, 0.26, 0.36, nEave + 0.10, TRIM);
        for (let i = 0; i < cs; i++) {
          const u = i / cs;
          const wid = pedHalf * 2 * (1 - u);
          const cy = base + (i + 0.5) * sh;
          // the raking cornice reads as the staircase edge of the courses …
          obox(f, 0, cy, wid, sh + 0.02, 0.22, nEave + 0.06, TRIM);
          // … with the tympanum field recessed behind it
          if (wid > 1.0) obox(f, 0, cy, wid - 0.46, sh + 0.02, 0.18, nEave - 0.12, WALLS);
          // and a wedge of roof behind, reaching back to wherever the main
          // slope has got to at this height, so the gable is a BAY and not a
          // cutout stuck on the eave
          const dep = inSet * ((cy - H) / roofH) + 0.6;
          ctx.dbox(f.horiz ? 0 : f.out * (nEave - 0.20 - dep / 2), cy,
            f.horiz ? f.out * (nEave - 0.20 - dep / 2) : 0,
            f.horiz ? Math.max(0.3, wid - 0.5) : dep, sh + 0.02,
            f.horiz ? dep : Math.max(0.3, wid - 0.5), ROOF);
        }
        // THE LUNETTE in the tympanum: three stepped courses of glass and a
        // stepped ring, which is all a semicircle can be in merged boxes.
        const lw = Math.min(pedHalf * 0.62, pedH * 1.5);
        if (lw > 0.7) {
          for (let i = 0; i < 3; i++) {
            const u = (i + 0.5) / 3;
            const w2 = lw * Math.sqrt(Math.max(0, 1 - u * u));
            obox(f, 0, base + 0.12 + u * pedH * 0.44, w2, pedH * 0.44 / 3 + 0.02, 0.10, nEave - 0.08, GLASS);
            obox(f, 0, base + 0.12 + u * pedH * 0.44, w2 + 0.20, pedH * 0.44 / 3 + 0.02, 0.06, nEave + 0.02, TRIM);
          }
          obox(f, 0, base + 0.06, lw + 0.34, 0.12, 0.16, nEave + 0.04, TRIM);
        }
      }

      // ============================================================
      //  11. DORMERS
      // ============================================================
      // A dormer's front plane is set just outside the wall line and its base
      // is read off the SLOPE at that plane, so it can never sink into the
      // roof. Its depth back into the slope is dorH/PITCH — on a low hip that
      // is a long way, but all of it is buried and costs one box.
      const dorH = clamp(roofH * 0.34, 0.80, 1.5);
      for (const f of faces) {
        const nrm = (f.horiz ? RD : RW) / 2;              // roof half, this face's normal
        const tanH = (f.horiz ? RW : RD) / 2;             // roof half, along the face
        // want the front plane just outside the wall line — then take the
        // height off the SLOPE there, and put the plane back on the slope, so
        // a clamp can never leave a dormer floating in front of the roof.
        const uf = clamp((nrm - (f.halfN + P * 0.30)) / Math.max(0.1, inSet), 0.10, 0.55);
        const nf = nrm - inSet * uf;
        const y0 = H + roofH * uf;
        const uTop = uf + dorH / roofH;
        const availHalf = tanH - inSet * uTop - 0.55;     // what is LEFT of the roof up there
        const dw = clamp(unit * 0.14, 0.85, 1.7);
        if (availHalf < dw) continue;
        const nd = clamp(Math.round((availHalf * 2) / (unit * 0.34)), 1, 4);
        const dep = dorH / Math.max(0.2, PITCH) + 0.5;
        for (let i = 0; i < nd; i++) {
          const t = -availHalf + (i + 0.5) * (availHalf * 2 / nd);
          // the central gabled bay wins any argument over position
          if (wantGable && f.s === ctx.doorSide && Math.abs(t) < pedHalf + dw / 2 + 0.3) continue;
          const put = function (tt, cy, len, h, depth, front, col) {
            const nc = nf + (front || 0) - depth / 2;
            if (f.horiz) ctx.dbox(tt, cy, f.out * nc, len, h, depth, col);
            else ctx.dbox(f.out * nc, cy, tt, depth, h, len, col);
          };
          const jw = clamp(dw * 0.16, 0.12, 0.30);
          put(t, y0 + dorH / 2, dw + jw * 2, dorH, dep, 0, TRIMD);                  // body, in the slope
          put(t, y0 + dorH / 2, dw + jw * 2 + 0.08, dorH * 0.94, 0.16, 0.06, TRIM); // painted face
          put(t, y0 + dorH * 0.54, dw * 0.82, dorH * 0.58, 0.10, 0.12, GLASS);      // the sash
          put(t, y0 + dorH * 0.54, 0.055, dorH * 0.58, 0.10, 0.16, TRIM);           // muntin
          put(t, y0 + dorH * 0.54, dw * 0.82, 0.05, 0.10, 0.16, TRIM);
          for (const sg of [-1, 1]) put(t + sg * (dw / 2 + jw * 0.4), y0 + dorH * 0.54, jw, dorH * 0.66, 0.14, 0.16, TRIM);
          put(t, y0 + dorH * 0.20, dw + jw * 3.0, 0.14, 0.22, 0.20, TRIM);          // sill
          // a small stepped pediment hood, and a wedge of roof behind it
          const hy = y0 + dorH * 0.90;
          put(t, hy, dw + jw * 3.4, 0.18, 0.30, 0.22, TRIM);
          for (let s = 0; s < 3; s++) {
            const u = (s + 1) / 3;
            put(t, hy + 0.14 + s * 0.17, (dw + jw * 2.6) * (1 - u * 0.58), 0.18,
              0.26 - s * 0.05, 0.18 - s * 0.03, s === 1 ? TRIMD : TRIM);
          }
          put(t, hy + 0.20, dw + jw * 1.4, 0.5, dep * 0.7, -0.10, ROOF);
        }
      }

      // ============================================================
      //  12. THE CHIMNEYS
      // ============================================================
      // A pair on the long axis, in from the end walls where the fireplaces
      // would be, rising out of the slope and past the ridge. They are what
      // says somebody lives here rather than works here.
      {
        const alongX = (RW >= RD);
        const chW = clamp(unit * 0.09, 0.65, 1.35);
        const off = (alongX ? W / 2 : D / 2) - Math.max(0.85, unit * 0.13);
        const top = H + roofH + clamp(roofH * 0.30, 0.85, 1.7);
        for (const sg of [-1, 1]) {
          const cx = alongX ? sg * off : 0, cz = alongX ? 0 : sg * off;
          const y0 = H - 0.4;
          ctx.dbox(cx, (y0 + top) / 2, cz, chW, top - y0, chW * 0.78, BRICK);
          // two darker courses so it reads as brick, not a painted post
          for (const u of [0.42, 0.66]) {
            ctx.dbox(cx, H + roofH * u, cz, chW + 0.05, 0.09, chW * 0.78 + 0.05, F.shade(BRICK, 0.78));
          }
          ctx.dbox(cx, top + 0.11, cz, chW + 0.24, 0.22, chW * 0.78 + 0.24, F.shade(BRICK, 1.10));  // corbel
          ctx.dbox(cx, top + 0.29, cz, chW + 0.10, 0.14, chW * 0.78 + 0.10, F.shade(BRICK, 0.86));
          for (const sg2 of [-1, 1]) {                                                // pots
            ctx.dbox(cx + (alongX ? 0 : sg2 * chW * 0.26), top + 0.52,
              cz + (alongX ? sg2 * chW * 0.26 : 0), chW * 0.30, 0.36, chW * 0.30, F.shade(BRICK, 0.74));
          }
        }
      }
    },
  });
})();
