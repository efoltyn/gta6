/* ============================================================
   city/facades/spanish.js — "Spanish Colonial Mansion": the Santa Barbara /
   Beverly Hills hacienda of 1915-1935.

   WHAT IS BEING MODELLED. Not a stucco box with a warm paint job — the
   Spanish Colonial REVIVAL house, which is an argument made out of exactly
   four materials: smooth white lime stucco, saturated red barrel tile, black
   wrought iron, and one carved cast-stone surround spent where it counts. The
   style is asymmetric on purpose: a tower over the front door, a loggia wing
   beside it, and a long low roof holding the whole thing down.

   THE ROOF IS THE IDENTITY, so it is solved first and gets the most geometry.
     LOW PITCH      about 4.5:12, run measured from the RIDGE to the EAVE TIP,
                    so the pitch stays constant while the roof gets taller on
                    a deeper house instead of steeper.
     BARREL TILE    each course is a stepped box that keeps its BOTTOM extent
                    for its whole height, so every course laps OVER the one
                    below — the direction real tile laps. Its lower edge gets
                    a convex lip in the sunlit tone, which is what makes the
                    stagger read as ROUNDED courses rather than as a
                    staircase. Then the cover ROLLS run down the slope, one
                    every half metre, on every course, and the eave line
                    finishes in the row of tile snouts you can count from the
                    pavement.
     DEEP EAVES     the tile flies EO past the wall on both slope faces, over
                    exposed rafter tails and a fascia. A shy eave turns this
                    style into a motel.
     GABLE ENDS     the two ends perpendicular to the ridge are stucco
                    triangles standing PROUD of the tile, each capped by a
                    stepped raking VERGE of tile — the reason the white
                    triangle is visible at all instead of being buried inside
                    the red wedge — with a pierced tile vent high in the peak.
     STEPPED RIDGE  a run of alternating ridge tiles, not one clean bar.
   The host's parapet (ctx.pp) stands on rTop whatever a facade does, and a
   low roof laid at rTop leaves it poking through the tiles, so the parapet is
   treated here as the last lift of WALL: clad in stucco, roofed over.

   THE TOWER is the second silhouette move and the one thing no other house
   facade in the kit has. It stands ON the entrance, is always solved to clear
   the ridge, and its base is PIERCED: two side walls, a round-arched portal
   with a proud archivolt, and the real front door recessed a full tower-depth
   behind it. It carries a belfry of round-arched openings with an iron rail,
   a tile vent, and its own hipped tile roof on a deep eave.

   THE ARCADE fills whatever face is left either side of the tower with round
   arches on square piers, standing clear of the wall on its own paved
   terrace, under a shed of tile. Its depth is forced past the main eave
   overhang so the two roofs read as two roofs. The terrace top is 0.30 m —
   under physics STEP_UP — and is a real ctx.plat, so the player walks up it
   and in; the flight in front of the portal has blue-and-white Talavera
   risers, which is the one place saturated colour is allowed.

   IRONWORK. Ground windows get a REJA: vertical bars crossing the opening,
   two thin rails, standing proud of the reveal. First-floor windows get a
   JULIET BALCONY — a tile-edged slab on two consoles with a wrought railing
   held half a metre clear of the wall.

   THE WINDOW RULE. The host glazes one continuous band per storey (glass from
   k*FH+0.55 to (k+1)*FH-0.45) and this facade never lays a solid horizontal
   over it. All stucco skin lives in the sill and header zones; everything
   that crosses the band is either VERTICAL (the wall piers between the
   windows, the reveal jambs, the grille bars, the balcony balusters) or is
   held clear of the wall as an overhang (the balcony rails, the porch roof).
   The window trim exists to FRAME the host's own glass: the reveals sit
   exactly on the glass edges, so the opening you see is the building's.

   NOT THE ADOBE. adobe.js is battered earthen mass, vigas and a flat parapet;
   this is a crisp thin-skinned plaster wall with a pitched tile roof, a
   tower, and black iron. Nothing here is hand-laid or irregular: the only
   hash-driven variation is which side the chimney takes, which way the tower
   leans when it cannot be centred, and the course tint jitter on the tile.

   COST. Everything is ctx.dbox and merges into the host's deco buckets. The
   real meshes are the tower finial, the two entry lanterns and up to four
   garden-pier balls — seven, against a ~40 whole-building ceiling.

   SPEC (optional, all defaulted — the facade is complete with {style}):
     spec.courtyard : true/false, force or suppress the garden wall.
     spec.towerSide : -1 | 1, which way the tower leans if the doorway is too
                      wide to pierce it (a showroom front).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // A horizontal run on one face, interrupted by [t0,t1] tangent holes —
  // stone.js's runBand. You do not cut a hole in a merged axis-aligned box,
  // you decline to draw over it. Used for the plinth and the ground sill band,
  // neither of which may lay a 0.5 m kerb across the doorway.
  function runBand(ctx, F, f, cy, hh, proj, col, holes, over, inset) {
    const L = -f.span / 2 - (over == null ? 0.12 : over), R = -L;
    let x = L;
    const hs = (holes || []).slice().sort(function (a, b) { return a[0] - b[0]; });
    for (let i = 0; i < hs.length; i++) {
      const a = Math.max(L, hs[i][0]), b = Math.min(R, hs[i][1]);
      if (b <= x) continue;
      if (a - x > 0.05) F.box(ctx, f, (x + a) / 2, cy, a - x, hh, proj, col, inset);
      x = b;
    }
    if (R - x > 0.05) F.box(ctx, f, (x + R) / 2, cy, R - x, hh, proj, col, inset);
  }

  CBZ.registerFacade("spanish", {
    label: "Spanish Colonial Mansion",
    crownsRoof: true,
    maxStoreys: 4,
    build: function (ctx, F, spec) {
      spec = spec || {};
      const w = ctx.w, d = ctx.d, FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0);
      const small = Math.min(w, d);
      const h = function (s) { return ctx.hash(s); };
      const e = F.entrance(ctx), df = e.f, faces = F.faces(ctx);
      // THE EAVE LINE — see the header: the parapet counts as wall here.
      const yE = ctx.rTop + ctx.pp;

      // ============================================================
      //  1. PALETTE AND MODULE
      // ============================================================
      // Crisp lime-white stucco, pulled a long way off the host tone but NOT
      // to pure white: stone.js's header records what mixing hard to 0xffffff
      // did to a facade whose subject is shadow. The contrast that carries
      // this one is stucco against TILE, so the tile is the saturated value
      // and the reveals are genuinely dark.
      const base = (ctx.pal && ctx.pal.wall) || ctx.color;
      const stuc = F.mix(base, 0xf1e9d8, 0.74);
      const stucL = F.mix(stuc, 0xfffbf2, 0.34);          // trim, archivolts, sills
      const stucD = F.shade(stuc, 0.80);                  // plinth, shaded returns
      const REV = F.shade(F.mix(stuc, 0x1d1712, 0.80), 0.88);   // inside an opening
      const tile = F.mix(0xad4020, base, 0.06);           // terracotta barrel tile
      const tileL = F.shade(tile, 1.20);                  // the crown of a roll
      const tileD = F.shade(tile, 0.66);                  // groove / soffit shade
      const iron = F.mix(0x14151a, base, 0.05);           // rejas, balconies, rails
      const timber = F.mix(0x54402a, base, 0.10);         // rafter tails, beams
      const timberD = F.shade(timber, 0.70);
      const TALAV = F.mix(0x1d5f8c, base, 0.06);          // Talavera blue: risers only
      const floorT = F.mix(tile, 0xd9b58c, 0.34);         // saltillo paving

      const SK = clamp(small * 0.026, 0.18, 0.34);   // stucco skin proj = reveal depth
      const JW = clamp(small * 0.030, 0.20, 0.40);   // reveal jamb width
      const CH = clamp(FH * 0.100, 0.26, 0.40);      // one tile course
      const EO = clamp(small * 0.150, 0.60, 1.60);   // eave overhang
      const GS = 0.55, GH = 0.45;                    // the host's glazing margins

      // ============================================================
      //  2. THE ROOF GEOMETRY, SOLVED BEFORE ANYTHING IS DRAWN
      // ============================================================
      // The tower must clear the ridge and the porch must duck under the eave,
      // so the roof's numbers have to exist before either of them is placed —
      // the same ordering rule stone.js states for its entablature.
      const alongX = (w >= d);
      const halfL = (alongX ? w : d) / 2;            // half length, along the ridge
      const halfS = (alongX ? d : w) / 2;            // half width, across it
      const RUN = halfS + EO;                        // ridge-to-eave-tip run
      const RIDGE = clamp(CH * 1.15, 0.30, 0.75);    // half-thickness of the ridge
      const RH = clamp(RUN * 0.36, 1.10, small * 0.44);   // low pitch, ~4.5:12
      const nC = clamp(Math.round(RH / CH), 4, 9);   // tile courses per slope
      const ridgeY = yE + RH;
      const towTop = ridgeY + clamp(FH * 0.50, 1.00, 2.20);
      function halfAt(u) { return RIDGE + (RUN - RIDGE) * (1 - u); }   // u = 0..1 up

      // (a = along the ridge, c = across it) → building-local x/z. The roof is
      // not tied to a face, so it gets its own mapping instead of F.box's.
      function rbox(a, cy, c, la, hh, lc, col) {
        if (alongX) ctx.dbox(a, cy, c, la, hh, lc, col);
        else ctx.dbox(c, cy, a, lc, hh, la, col);
      }
      // (t = along the entrance face, n = out from the building centre along
      // its normal) → building-local x/z. The tower, the arcade and the garden
      // wall all live in this frame.
      function ebox(t, cy, n, lt, hh, ln, col) {
        if (df.horiz) ctx.dbox(t, cy, df.out * n, lt, hh, ln, col);
        else ctx.dbox(df.out * n, cy, t, ln, hh, lt, col);
      }

      // ============================================================
      //  3. THE TOWER, SOLVED
      // ============================================================
      // Wide enough that its base can be pierced by a portal that still
      // leaves the kit's doorway keep-out clear, and deep enough that it
      // stands PAST the main eave overhang — a tower the eaves fly over is a
      // bump, not a tower.
      const tS = clamp(Math.max(small * 0.26, e.gap + 1.15), 3.00,
        Math.min(4.60, df.span * 0.42));
      const tW = clamp(tS * 0.19, 0.42, 0.80);       // its wall thickness
      const tP = EO + clamp(tS * 0.16, 0.25, 0.55);  // proud of the eave
      const tIn = clamp(tS * 0.22, 0.40, 0.90);      // rooted into the host wall
      const nOut = df.halfN + tP, nIn = df.halfN - tIn;
      const nRC = nOut - tS / 2;                     // centre of its square plan
      // PIERCED, or standing beside the door? A drive-in front (a showroom or
      // a garage ground floor) has a 6.4 m opening no sane tower can span, so
      // there the tower steps aside instead and the door keeps the open wall.
      const pierce = !e.driveIn && tS >= e.gap + 1.10 && df.span >= tS + 2.2;
      const tSide = (spec.towerSide === -1 || spec.towerSide === 1) ? spec.towerSide
        : (h(0x5b01) < 0.5 ? -1 : 1);
      const tCen = pierce ? 0
        : tSide * clamp(e.gap / 2 + tS / 2 + 0.45, 0, Math.max(0, df.span / 2 - tS / 2 - 0.25));
      const pClear = tS - tW * 2;                    // clear span of the portal
      const pRise = Math.min(pClear / 2, FH * 0.66); // a true semicircle if it fits
      // Springing: stone.js's discipline — put the whole ring above e.head so
      // nothing hangs into the doorway — clamped so the head still leaves the
      // belfry its own storey inside the shaft.
      const pSpring = clamp(e.head + 0.25, 2.40,
        Math.max(2.45, towTop - pRise - clamp(FH * 1.10, 2.20, 3.40)));
      const pHead = pSpring + pRise;

      function towFouls(f, t, wid) {
        return f.s === df.s && Math.abs(t - tCen) < (tS + wid) / 2 + 0.30;
      }

      // ============================================================
      //  4. THE STUCCO WALL
      // ============================================================
      // The whole elevation is white plaster with punched holes, and it is
      // built as: skin bands in the host's SOLID zones only, plus full-height
      // piers of the same stucco filling everything between the windows.
      // Those piers are VERTICAL, which is exactly why they are allowed to
      // cross the glazing band — see brick.js. Between them the host's own
      // glass survives, framed, as the window.
      const layout = [];
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const nb = F.bayCount(f, clamp(small * 0.36, 3.0, 4.8), 2, 5);
        const marg = clamp(f.span * 0.08, 0.60, 1.40);
        const bays = F.bays(f, nb, marg);
        const step = bays.length ? bays[0].w : f.span;
        const win = clamp(step * 0.44, 0.85, 2.00);
        const pier = Math.max(0.45, step - win - JW * 2 - 0.10);
        layout.push({ f: f, nb: nb, marg: marg, bays: bays, win: win, pier: pier });

        const doorHole = (f.s === df.s) ? [[-(e.gap / 2 + 0.60), e.gap / 2 + 0.60]] : [];
        // the plinth the plaster stands on, stepped aside at the doorway
        runBand(ctx, F, f, 0.17, 0.34, SK + 0.12, stucD, doorHole, 0.26, 0);
        // the skin: sill zone and header zone of every storey, and nothing in
        // between. The parapet above the top storey is clad as wall.
        for (let k = 0; k < ST; k++) {
          runBand(ctx, F, f, k * FH + GS / 2, GS, SK, stuc, k === 0 ? doorHole : [], 0.26, 0);
          F.band(ctx, f, (k + 1) * FH - GH / 2, GH, SK, stuc, 0.26);
        }
        if (yE - ST * FH > 0.10) F.band(ctx, f, (yE + ST * FH) / 2, yE - ST * FH, SK, stuc, 0.26);
        // the piers between the openings
        for (const t of F.bayLines(f, nb, marg)) {
          if (towFouls(f, t, pier)) continue;
          const y0 = F.clearsDoor(ctx, f, t, pier) ? 0.30 : e.head;
          if (yE - y0 > 0.45) F.rib(ctx, f, t, y0, yE, pier, SK, stuc);
        }
      }
      // the corners, which cover the host's own 0.55 m end jambs and tie the
      // four plaster faces into one block
      F.corners(ctx, (0.30 + yE) / 2, yE - 0.30, clamp(small * 0.07, 0.80, 1.60), SK, stuc);

      // ============================================================
      //  5. WINDOWS — deep reveals, rejas, juliet balconies
      // ============================================================
      for (let li = 0; li < layout.length; li++) {
        const L = layout[li], f = L.f;
        for (let k = 0; k < ST; k++) {
          // exactly the host's own glass, so the reveal frames it rather than
          // covering it
          const y0 = k * FH + GS, y1 = (k + 1) * FH - GH;
          if (y1 - y0 < 0.6) continue;
          for (let bi = 0; bi < L.bays.length; bi++) {
            const b = L.bays[bi];
            if (towFouls(f, b.t, L.win)) continue;
            if (y0 < e.head && !F.clearsDoor(ctx, f, b.t, L.win + JW * 2 + 0.8)) continue;
            // JAMBS: verticals, so they may cross the band. They are what turn
            // a ribbon into a pair of punched windows.
            for (const sg of [-1, 1]) {
              F.rib(ctx, f, b.t + sg * (L.win / 2 + JW / 2), y0 - 0.12, y1 + 0.12, JW, SK, stuc);
              F.rib(ctx, f, b.t + sg * (L.win / 2 + JW / 2), y0 - 0.10, y1 + 0.10, JW * 0.5, SK + 0.07, stucL);
            }
            // SILL and HEAD, both inside the solid zones by construction:
            // y0-0.16 sits 0.29-0.49 above the floor line (sill zone is 0.55
            // deep) and y1+0.16 sits 0.38-0.20 under the ceiling (header zone
            // is 0.45 deep). Neither can touch glass on any host.
            F.box(ctx, f, b.t, y0 - 0.16, L.win + JW * 3.2, 0.20, SK + 0.20, stucL);
            F.box(ctx, f, b.t, y0 - 0.28, L.win + JW * 2.4, 0.10, SK + 0.13, stucD);
            F.box(ctx, f, b.t, y1 + 0.16, L.win + JW * 3.2, 0.18, SK + 0.14, stucL);
            F.box(ctx, f, b.t, y1 + 0.30, L.win + JW * 2.2, 0.12, SK + 0.24, stucL);

            if (k === 0) {
              // THE REJA. Vertical bars over the opening, two thin rails, the
              // whole grille standing proud of the reveal so it reads as iron
              // in front of the glass instead of paint on it.
              const nB = clamp(Math.round(L.win / 0.30), 3, 7);
              const gp = SK + clamp(small * 0.012, 0.10, 0.20);
              for (let i = 0; i <= nB; i++) {
                F.rib(ctx, f, b.t - L.win / 2 + (L.win / nB) * i, y0 + 0.02, y1 - 0.02, 0.055, gp, iron);
              }
              F.box(ctx, f, b.t, y0 + 0.10, L.win + 0.16, 0.06, gp + 0.03, iron);
              F.box(ctx, f, b.t, y1 - 0.12, L.win + 0.16, 0.06, gp + 0.03, iron);
            } else if (k === 1) {
              // THE JULIET BALCONY, on the first floor only — a balcony on
              // every window is a motel; one storey of them is a hacienda.
              const BP = clamp(small * 0.050, 0.34, 0.62);
              const railH = clamp(FH * 0.30, 0.75, 1.05);
              const bw = L.win + JW * 4.0;
              F.box(ctx, f, b.t, y0 - 0.22, bw, 0.14, SK + BP, stucL);          // slab
              F.box(ctx, f, b.t, y0 - 0.32, bw - 0.16, 0.08, SK + BP - 0.05, tile);  // tile edge
              for (const sg of [-1, 1]) {                                       // consoles
                F.box(ctx, f, b.t + sg * (L.win / 2 + JW * 0.5), y0 - 0.44, JW * 0.9, 0.30, SK + BP * 0.62, stucL);
              }
              // the railing rides the SLAB EDGE, half a metre off the wall, so
              // it is an overhang and not a bar painted across the glass.
              const rin = SK + BP - 0.11;
              const ry0 = y0 - 0.14, ry1 = ry0 + railH;
              const rn = clamp(Math.round(bw / 0.26), 4, 8);
              for (let i = 0; i <= rn; i++) {
                F.rib(ctx, f, b.t - bw / 2 + (bw / rn) * i, ry0, ry1, 0.05, 0.06, iron, rin);
              }
              F.box(ctx, f, b.t, ry1, bw + 0.10, 0.08, 0.11, iron, rin - 0.02);
              F.box(ctx, f, b.t, ry0 + railH * 0.36, bw, 0.05, 0.08, iron, rin - 0.01);
              for (const sg of [-1, 1]) {                                       // corner buds
                F.box(ctx, f, b.t + sg * bw / 2, ry1 + 0.10, 0.11, 0.16, 0.11, iron, rin - 0.02);
              }
            }
          }
        }
      }

      // ============================================================
      //  6. THE TOWER
      // ============================================================
      {
        const nMid = (nIn + nOut) / 2, nLen = nOut - nIn;
        // the two side walls, full height
        for (const sg of [-1, 1]) {
          ebox(tCen + sg * (tS / 2 - tW / 2), towTop / 2, nMid, tW, towTop, nLen, stuc);
        }
        // the shaft above the portal head: front wall plus the mass behind it
        if (towTop - pHead > 0.4) {
          ebox(tCen, (pHead + towTop) / 2, nOut - tW / 2, tS, towTop - pHead, tW, stuc);
          ebox(tCen, (pHead + towTop) / 2, nMid, tS - tW * 2, towTop - pHead, nLen, stucD);
        }
        if (pierce) {
          // THE PORTAL. The arch is drawn as the SPANDRELS either side of the
          // opening, level by level, which is the only way a merged box can
          // describe a void: the pieces stop where the curve is.
          const stepsA = 6;
          for (let i = 0; i < stepsA; i++) {
            const u = (i + 0.5) / stepsA;
            const half = (pClear / 2) * Math.sqrt(Math.max(0, 1 - u * u));
            const len = tS / 2 - half;
            if (len < 0.06) continue;
            for (const sg of [-1, 1]) {
              ebox(tCen + sg * (tS / 2 + half) / 2, pSpring + u * pRise, nOut - tW / 2,
                len, pRise / stepsA + 0.04, tW, stuc);
            }
          }
          // THE ARCHIVOLT: a moulded ring following the curve, one step proud
          // of the front plane. Without it the portal is a hole; with it, it
          // is an arch.
          const stepsR = 8;
          for (let i = 0; i < stepsR; i++) {
            const u = (i + 0.5) / stepsR;
            const half = (pClear / 2) * Math.sqrt(Math.max(0, 1 - u * u));
            for (const sg of [-1, 1]) {
              ebox(tCen + sg * (half + 0.16), pSpring + u * pRise, nOut + 0.09,
                0.34, pRise / stepsR + 0.05, 0.20, stucL);
            }
          }
          ebox(tCen, pHead + 0.06, nOut + 0.09, 0.40, 0.34, 0.24, stucL);        // keystone
          for (const sg of [-1, 1]) {                                            // imposts
            ebox(tCen + sg * (pClear / 2 + 0.10), pSpring - 0.12, nOut + 0.07, 0.52, 0.20, 0.18, stucL);
          }
        } else {
          // not pierced: a solid base with a blind niche, and the door keeps
          // the open wall beside it
          ebox(tCen, pHead / 2, nOut - tW / 2, tS, pHead, tW, stuc);
          ebox(tCen, pHead / 2, nMid, tS - tW * 2, pHead, nLen, stucD);
          ebox(tCen, (pSpring + 0.3) / 2 + 0.3, nOut + 0.03, pClear * 0.5, pSpring - 0.3, 0.10, REV);
        }
        // a moulded string course where the shaft becomes the belfry
        const yBelt = towTop - clamp(FH * 1.05, 2.20, 3.30);
        for (const q of [0, 1]) {
          const yy = yBelt + q * 0.16, ww = tS + 0.26 + q * 0.10;
          ebox(tCen, yy, nRC, ww, 0.16, ww, q ? stucD : stucL);
        }
        // a mid-shaft window, if the shaft has a storey to spare for one
        if (yBelt - pHead > FH * 0.95) {
          const wy = pHead + (yBelt - pHead) * 0.42, wh = clamp(FH * 0.42, 0.9, 1.6);
          const ww = clamp(tS * 0.26, 0.5, 1.0);
          ebox(tCen, wy, nOut + 0.03, ww, wh, 0.08, REV);
          for (const sg of [-1, 1]) ebox(tCen + sg * (ww / 2 + 0.13), wy, nOut + 0.07, 0.26, wh + 0.30, 0.16, stucL);
          ebox(tCen, wy + wh / 2 + 0.15, nOut + 0.07, ww + 0.52, 0.18, 0.18, stucL);
          ebox(tCen, wy - wh / 2 - 0.13, nOut + 0.09, ww + 0.60, 0.16, 0.22, stucL);
          const gn = clamp(Math.round(ww / 0.26), 2, 4);
          for (let i = 0; i <= gn; i++) ebox(tCen - ww / 2 + (ww / gn) * i, wy, nOut + 0.12, 0.05, wh - 0.06, 0.06, iron);
        }
        // THE BELFRY. Round-arched openings on the front (two if the tower is
        // wide enough) and one on each flank, each a dark void with a stepped
        // round head, an iron rail across the sill.
        const bY0 = yBelt + 0.34, bY1 = towTop - clamp(tS * 0.14, 0.32, 0.62);
        const bH = Math.max(0.7, (bY1 - bY0) * 0.92);
        const bn = tS > 3.65 ? 2 : 1;
        const bStep = (tS - tW * 1.6) / bn;
        const bw = bStep * 0.62;
        function belfryVoid(put, off, wid) {
          const rise = Math.min(wid / 2, bH * 0.42);
          put(off, bY0 + (bH - rise) / 2, wid, bH - rise, REV);
          for (let i = 0; i < 4; i++) {
            const u = (i + 0.5) / 4;
            put(off, bY0 + bH - rise + u * rise, wid * Math.sqrt(Math.max(0, 1 - u * u)), rise / 4 + 0.03, REV);
          }
        }
        for (let j = 0; j < bn; j++) {
          const off = tCen + (-(bn - 1) / 2 + j) * bStep;
          belfryVoid(function (o, cy, wid, hh, col) {
            ebox(o, cy, nOut + 0.02, wid, hh, 0.06, col);
          }, off, bw);
          for (const sg of [-1, 1]) ebox(off + sg * (bw / 2 + 0.12), bY0 + bH / 2, nOut + 0.06, 0.24, bH + 0.24, 0.14, stucL);
          // the iron rail across the opening's foot
          const rn = clamp(Math.round(bw / 0.24), 3, 6);
          for (let i = 0; i <= rn; i++) ebox(off - bw / 2 + (bw / rn) * i, bY0 + bH * 0.20, nOut + 0.09, 0.05, bH * 0.40, 0.07, iron);
          ebox(off, bY0 + bH * 0.40, nOut + 0.10, bw + 0.10, 0.07, 0.09, iron);
        }
        for (const sg of [-1, 1]) {
          belfryVoid(function (o, cy, wid, hh, col) {
            ebox(tCen + sg * (tS / 2 + 0.02), cy, nRC + o, 0.06, hh, wid, col);
          }, 0, tS * 0.42);
        }
        // A PIERCED TILE VENT under the belfry — the little clay grille that
        // ventilates the loft. Dark ground, a proud plaster ring, a tile cross.
        {
          const vs = clamp(tS * 0.24, 0.45, 0.85), vy = yBelt - vs * 0.90;
          ebox(tCen, vy, nOut + 0.02, vs, vs, 0.06, REV);
          for (const q of [-1, 1]) {
            ebox(tCen + q * (vs / 2 + 0.08), vy, nOut + 0.05, 0.16, vs + 0.32, 0.12, stucL);
            ebox(tCen, vy + q * (vs / 2 + 0.08), nOut + 0.05, vs + 0.32, 0.16, 0.12, stucL);
          }
          ebox(tCen, vy, nOut + 0.07, vs * 0.90, 0.10, 0.08, tile);
          ebox(tCen, vy, nOut + 0.07, 0.10, vs * 0.90, 0.08, tile);
          ebox(tCen, vy, nOut + 0.08, 0.16, 0.16, 0.09, TALAV);
        }
        // ITS OWN HIPPED TILE ROOF, on a deep eave, courses shrinking on both
        // axes. One lip box per course does the whole four-sided bulge.
        const tRH = clamp(tS * 0.46, 1.00, 2.40);
        const tEO = clamp(tS * 0.19, 0.35, 0.75);
        const tnC = clamp(Math.round(tRH / CH), 3, 7);
        let tTop = towTop;
        for (let i = 0; i < tnC; i++) {
          const u = i / tnC, hh = tRH / tnC;
          const half = (tS / 2 + tEO) * (1 - u) + (tS * 0.10) * u;
          ebox(tCen, tTop + hh / 2, nRC, half * 2, hh + 0.02, half * 2,
            i % 2 ? tile : F.shade(tile, 0.93));
          ebox(tCen, tTop + CH * 0.26, nRC, half * 2 + 0.30, CH * 0.48, half * 2 + 0.30, tileL);
          tTop += hh;
        }
        ebox(tCen, tTop + 0.14, nRC, tS * 0.30, 0.28, tS * 0.30, tileL);
        // the weathervane spike: one real mesh, and the tallest point in the
        // whole composition
        ebox(tCen, tTop + 0.28 + clamp(tS * 0.14, 0.3, 0.6) / 2, nRC, 0.10,
          clamp(tS * 0.14, 0.3, 0.6), 0.10, iron);
        const fx = df.horiz ? tCen : df.out * nRC, fz = df.horiz ? df.out * nRC : tCen;
        ctx.ball(fx, tTop + 0.34 + clamp(tS * 0.14, 0.3, 0.6), fz, clamp(tS * 0.045, 0.12, 0.22), iron);
      }

      // ============================================================
      //  7. THE CARVED DOOR SURROUND
      // ============================================================
      // The one piece of cast-stone ornament the house spends anything on, and
      // it sits a full tower-depth back inside the portal where it is read
      // through the arch. Spiral pilasters (alternating block lengths are how a
      // twisted shaft reads in merged axis-aligned boxes), a moulded
      // architrave, a scalloped shell hood and a cartouche. Everything that
      // crosses the doorway is above e.head; the pilasters stand outside it.
      {
        const sw = Math.min(e.gap / 2 + 0.50, tS / 2 - tW - 0.28);
        const top = Math.min(e.head + 0.45, yE - 0.35);
        if (sw > e.gap / 2 * 0.7 && top > 2.2) {
          F.box(ctx, df, 0, top / 2, sw * 2 + 0.60, top, 0.06, F.shade(stuc, 0.60));
          const nSp = 7, spH = (top - 0.55) / nSp;
          for (const sg of [-1, 1]) {
            const t = sg * (sw + 0.24);
            for (let i = 0; i < nSp; i++) {
              const twist = (i % 2) ? 0.62 : 1.0;
              F.box(ctx, df, t, 0.42 + (i + 0.5) * spH, 0.34 * twist + 0.16, spH + 0.03,
                0.20 + (i % 2 ? 0 : 0.09), i % 2 ? stucD : stucL);
            }
            F.box(ctx, df, t, 0.24, 0.66, 0.34, 0.28, stucL);            // base
            F.box(ctx, df, t, top - 0.16, 0.70, 0.24, 0.32, stucL);      // capital
          }
          // architrave and the shell over it
          F.box(ctx, df, 0, top + 0.10, sw * 2 + 1.30, 0.22, 0.34, stucL);
          F.box(ctx, df, 0, top + 0.28, sw * 2 + 1.00, 0.16, 0.26, stucD);
          const shN = 4, shH = clamp(top * 0.22, 0.4, 0.9);
          for (let i = 0; i < shN; i++) {
            const u = (i + 0.5) / shN;
            F.box(ctx, df, 0, top + 0.38 + u * shH, (sw * 2 + 0.70) * Math.sqrt(Math.max(0, 1 - u * u)),
              shH / shN + 0.04, 0.30 - i * 0.04, i % 2 ? stucD : stucL);
          }
          // the cartouche: a small carved panel over the shell
          F.box(ctx, df, 0, top + 0.44 + shH, 0.60, 0.44, 0.34, stucL);
          F.box(ctx, df, 0, top + 0.44 + shH, 0.32, 0.26, 0.40, TALAV);
        }
      }

      // ============================================================
      //  8. THE ARCADE / COVERED PORCH, ITS TERRACE AND STEPS
      // ============================================================
      // Round arches on square piers, standing on their own paved terrace,
      // under a shed of tile. The depth is forced past the main eave overhang
      // so the porch roof and the house roof read as two roofs.
      const PD = clamp(Math.max(small * 0.17, EO + 0.55), 1.40, 3.00);
      const arcW = clamp(small * 0.30, 2.30, 3.50);
      const pS = clamp(arcW * 0.22, 0.48, 0.85);
      const TOP = 0.30;                              // under physics STEP_UP
      const pOut = df.halfN + PD;
      {
        const lim = df.span / 2 - 0.35;
        const runs = [];
        if (tCen - tS / 2 - (-lim) > arcW * 0.7) runs.push([-lim, tCen - tS / 2]);
        if (lim - (tCen + tS / 2) > arcW * 0.7) runs.push([tCen + tS / 2, lim]);
        // the beam sits as high as it can without crowding the eave; on a
        // one-storey cottage that is a low single-storey loggia, which is what
        // a cottage should have.
        let maxRise = 0;
        const plan = [];
        for (const r of runs) {
          const len = r[1] - r[0];
          const nA = Math.max(1, Math.round(len / arcW + 0.15));
          const step = len / nA;
          const rise = Math.min((step - pS) / 2, clamp(arcW * 0.55, 0.60, 1.70));
          if (rise > maxRise) maxRise = rise;
          plan.push({ r: r, nA: nA, step: step, rise: rise });
        }
        const beamY = Math.min(e.head + 0.35 + maxRise, yE - CH * 3.2);
        for (let pi = 0; pi < plan.length; pi++) {
          const P = plan[pi], r = P.r;
          // THE PIERS: square, from the terrace to the beam. None of them can
          // land in the doorway — the tower owns that stretch of face.
          for (let i = 0; i <= P.nA; i++) {
            const t = r[0] + P.step * i;
            ebox(t, TOP + (beamY - TOP) / 2, pOut - pS / 2, pS, beamY - TOP, pS, stuc);
            ebox(t, beamY - 0.14, pOut - pS / 2, pS + 0.22, 0.20, pS + 0.22, stucL);   // capital
            ebox(t, TOP + 0.14, pOut - pS / 2, pS + 0.20, 0.28, pS + 0.20, stucL);     // base
          }
          // THE ARCHES: spandrel pieces stopping where the curve is, plus a
          // proud archivolt ring, exactly as the tower portal is built.
          for (let i = 0; i < P.nA; i++) {
            const c = r[0] + P.step * (i + 0.5);
            const half = (P.step - pS) / 2;
            const crown = beamY - 0.24;
            const spring = crown - P.rise;
            for (let j = 0; j < 5; j++) {
              const u = (j + 0.5) / 5;
              const hw = half * Math.sqrt(Math.max(0, 1 - u * u));
              const len = P.step / 2 - hw;
              if (len < 0.06) continue;
              for (const sg of [-1, 1]) {
                ebox(c + sg * (P.step / 2 + hw) / 2, spring + u * P.rise, pOut - pS / 2,
                  len, P.rise / 5 + 0.05, pS, stuc);
              }
            }
            for (let j = 0; j < 6; j++) {
              const u = (j + 0.5) / 6;
              const hw = half * Math.sqrt(Math.max(0, 1 - u * u));
              for (const sg of [-1, 1]) {
                ebox(c + sg * (hw + 0.13), spring + u * P.rise, pOut + 0.05,
                  0.28, P.rise / 6 + 0.05, 0.18, stucL);
              }
            }
            // a small pierced vent in each spandrel, over the pier line
            if (P.nA > 1 && i < P.nA - 1) {
              const vt = r[0] + P.step * (i + 1), vy = crown - P.rise * 0.10;
              ebox(vt, vy, pOut + 0.04, 0.30, 0.30, 0.10, REV);
              ebox(vt, vy, pOut + 0.07, 0.34, 0.09, 0.10, tile);
              ebox(vt, vy, pOut + 0.07, 0.09, 0.34, 0.10, tile);
            }
          }
          // THE SHED ROOF: three tile courses stepping out and down, the last
          // with the same rounded lip and tile snouts the main eave gets. Its
          // inner edge stops 0.30 m short of the wall — a solid slab abutting
          // the wall there would lay a band across the first floor's glass —
          // and the gap is bridged by the porch beam ends, which is what
          // actually carries a porch roof anyway.
          const aLen = P.step * P.nA + pS * 0.8, aCen = (r[0] + r[1]) / 2;
          ebox(aCen, beamY + 0.04, pOut - pS / 2, aLen, 0.26, pS + 0.16, timber);   // the beam
          const nS = 3, seg = (PD - 0.30) / nS + 0.18;
          for (let j = 0; j < nS; j++) {
            const n0 = df.halfN + 0.30 + (PD - 0.30) * j / nS;
            const y = beamY + 0.40 - j * CH * 0.62;
            ebox(aCen, y, n0 + seg / 2, aLen + 0.24, CH * 0.90, seg, j % 2 ? tile : F.shade(tile, 0.93));
            ebox(aCen, y - CH * 0.30, n0 + seg - 0.10, aLen + 0.30, CH * 0.46, CH * 0.60, tileL);
          }
          // tile snouts along the porch lip, and the rafter ends at the wall
          const nSn = clamp(Math.round(aLen / clamp(small * 0.05, 0.42, 0.62)), 4, 24);
          for (let i = 0; i < nSn; i++) {
            const t = aCen - aLen / 2 + (aLen / nSn) * (i + 0.5);
            ebox(t, beamY + 0.40 - (nS - 1) * CH * 0.62 - CH * 0.18, pOut - 0.06,
              (aLen / nSn) * 0.42, CH * 0.60, 0.30, tileL);
            ebox(t, beamY + 0.28, df.halfN + 0.26, 0.14, 0.18, 0.60, timberD);
          }
        }
        // THE TERRACE: one paved slab, one platform record, top 0.30 so it is
        // walk-on from any side and the doorway can never be sealed.
        const terrW = df.span - 0.20;
        ebox(0, TOP / 2, (df.halfN + pOut) / 2, terrW, TOP, PD, floorT);
        ebox(0, TOP - 0.03, pOut - 0.09, terrW + 0.10, 0.12, 0.22, tile);
        if (df.horiz) {
          const z0 = df.out > 0 ? df.halfN : -pOut, z1 = df.out > 0 ? pOut : -df.halfN;
          ctx.plat(-terrW / 2, terrW / 2, z0, z1, TOP, null);
        } else {
          const x0 = df.out > 0 ? df.halfN : -pOut, x1 = df.out > 0 ? pOut : -df.halfN;
          ctx.plat(x0, x1, -terrW / 2, terrW / 2, TOP, null);
        }
        // THE FLIGHT in front of the portal: two cosmetic treads with Talavera
        // risers, over one continuous ramp platform so a sprinting player can
        // never sample a seam between tread boxes.
        if (!e.driveIn) {
          const stW = pClear + 1.40, stD = clamp(PD * 0.55, 0.70, 1.30);
          for (let i = 0; i < 2; i++) {
            const th = TOP * (2 - i) / 2, off = pOut + (i + 0.5) * (stD / 2);
            ebox(tCen, th / 2, off, stW - i * 0.30, th, stD / 2 + 0.03, floorT);
            ebox(tCen, th - 0.05, off + stD / 4, stW - i * 0.30 - 0.10, 0.10, 0.10, TALAV);
          }
          const o0 = pOut, o1 = pOut + stD;
          if (df.horiz) {
            const z0 = df.out * o0, z1 = df.out * o1;
            ctx.plat(tCen - stW / 2, tCen + stW / 2, Math.min(z0, z1), Math.max(z0, z1), TOP,
              { z0: ctx.oz + z1, z1: ctx.oz + z0, y0: 0, y1: TOP });
          } else {
            const x0 = df.out * o0, x1 = df.out * o1;
            ctx.plat(Math.min(x0, x1), Math.max(x0, x1), tCen - stW / 2, tCen + stW / 2, TOP,
              { axis: "x", x0: ctx.ox + x1, x1: ctx.ox + x0, y0: 0, y1: TOP });
          }
        }
        // a pair of iron lanterns flanking the portal — the only lit thing on
        // the house, and the two real meshes the entrance spends
        for (const sg of [-1, 1]) {
          const t = tCen + sg * (pClear / 2 + 0.34);
          const ly = Math.min(pSpring - 0.30, TOP + 2.30);
          ebox(t, ly + 0.30, nOut + 0.14, 0.10, 0.10, 0.30, iron);
          ebox(t, ly + 0.14, nOut + 0.26, 0.20, 0.24, 0.20, iron);
          const lx = df.horiz ? t : df.out * (nOut + 0.26), lz = df.horiz ? df.out * (nOut + 0.26) : t;
          ctx.lamp(lx, ly, lz, clamp(small * 0.016, 0.12, 0.22), 0xffd8a2);
        }
      }

      // ============================================================
      //  9. THE TILED ROOF
      // ============================================================
      const rakeF = alongX ? [0, 1] : [2, 3];        // the two SLOPE faces
      for (let i = 0; i < nC; i++) {
        const u0 = i / nC, u1 = (i + 1) / nC;
        const hs0 = halfAt(u0), hs1 = halfAt(u1);
        const y0 = yE + RH * u0, hh = RH / nC;
        const dep = Math.max(0.10, hs0 - hs1);       // this course's tread depth
        const col = F.shade(tile, 0.92 + ((i % 3) * 0.055) + h(0x5b10 + i) * 0.05);
        rbox(0, y0 + hh / 2, 0, halfL * 2, hh + 0.02, hs0 * 2, col);
        for (const sg of [-1, 1]) {
          // THE ROUNDED LIP: the convex lower edge of a barrel course. This is
          // the single detail that makes the stagger read as tile.
          rbox(0, y0 + CH * 0.30, sg * hs0, halfL * 2, CH * 0.56, CH * 0.62, tileL);
          rbox(0, y0 + CH * 0.05, sg * (hs0 - 0.04), halfL * 2, CH * 0.22, CH * 0.50, tileD);
        }
        // THE COVER ROLLS running down the slope, one per barrel pitch, on
        // every course — the reason this roof is tile and not a red wedge.
        const nR = clamp(Math.round((halfL * 2) / clamp(small * 0.045, 0.40, 0.62)), 6, 26);
        const rw = (halfL * 2) / nR;
        for (let j = 0; j < nR; j++) {
          const a = -halfL + rw * (j + 0.5);
          for (const sg of [-1, 1]) {
            rbox(a, y0 + hh - CH * 0.20, sg * (hs0 - dep / 2), rw * 0.44, CH * 0.52, dep + CH * 0.36, tileL);
            // the tile SNOUTS at the eave: the row of half-round ends you can
            // count from the pavement
            if (i === 0) rbox(a, yE + CH * 0.34, sg * (hs0 + 0.06), rw * 0.50, CH * 0.66, CH * 0.70, tileL);
          }
        }
        // THE GABLE ENDS. A stucco triangle standing PROUD of the tile in the
        // along direction (so it is visible from the end at all), capped by a
        // stepped raking verge of tile. Clamped to the building's own width at
        // the foot, where the eave overhang runs on past the wall.
        const gh = Math.min(hs0 + 0.05, halfS + 0.15);
        const vh = Math.min(hs0 + 0.34, halfS + 0.44);
        for (const sg of [-1, 1]) {
          rbox(sg * (halfL + SK / 2 - 0.03), y0 + hh / 2, 0, SK + 0.06, hh + 0.02, gh * 2, stuc);
          rbox(sg * (halfL + SK + 0.09), y0 + hh - CH * 0.24, 0, 0.22, CH * 0.60, vh * 2,
            i % 2 ? tileL : tile);
        }
      }
      // THE RIDGE: a bedding course, then a run of alternating ridge tiles, so
      // the top line is stepped rather than machined.
      rbox(0, ridgeY - CH * 0.28, 0, halfL * 2, CH * 0.66, RIDGE * 2 + 0.34, tile);
      {
        const nRid = clamp(Math.round((halfL * 2) / clamp(CH * 2.0, 0.52, 0.82)), 5, 26);
        const rs = (halfL * 2) / nRid;
        for (let j = 0; j < nRid; j++) {
          const a = -halfL + rs * (j + 0.5);
          const hh = CH * ((j % 2) ? 0.92 : 0.64);
          rbox(a, ridgeY + hh / 2 - 0.06, 0, rs * 0.80, hh, RIDGE * 2 + 0.38, (j % 2) ? tileL : tile);
        }
      }
      // EXPOSED RAFTER TAILS and the fascia, on the slope faces only — the
      // gable ends have a verge instead, which is what the real thing does.
      for (let q = 0; q < rakeF.length; q++) {
        const f = F.face(ctx, rakeF[q]);
        const n = clamp(Math.round(f.span / clamp(small * 0.09, 0.60, 1.10)), 4, 24);
        const tw = clamp(f.span / n * 0.34, 0.12, 0.30);
        for (let i = 0; i < n; i++) {
          F.box(ctx, f, -f.span / 2 + (f.span / n) * (i + 0.5), yE - 0.22, tw, 0.24, EO * 0.88, timber);
        }
        F.box(ctx, f, 0, yE - 0.13, f.span + 0.30, 0.30, 0.16, timberD, EO * 0.86);
      }
      // A PIERCED TILE VENT high in each gable peak.
      for (let q = 0; q < faces.length; q++) {
        const f = faces[q];
        if (rakeF.indexOf(f.s) >= 0) continue;
        const vs = clamp(small * 0.10, 0.50, 1.00), vy = yE + RH * 0.56;
        if (halfAt(0.56) < vs * 0.9) continue;
        F.box(ctx, f, 0, vy, vs, vs, 0.07, REV, SK);
        for (const sg of [-1, 1]) {
          F.box(ctx, f, sg * (vs / 2 + 0.09), vy, 0.18, vs + 0.36, 0.13, stucL, SK);
          F.box(ctx, f, 0, vy + sg * (vs / 2 + 0.09), vs + 0.36, 0.18, 0.13, stucL, SK);
        }
        F.box(ctx, f, 0, vy, vs * 0.92, 0.10, 0.10, tile, SK + 0.02);
        F.box(ctx, f, 0, vy, 0.10, vs * 0.92, 0.10, tile, SK + 0.02);
        F.box(ctx, f, 0, vy, 0.18, 0.18, 0.12, TALAV, SK + 0.02);
      }

      // ============================================================
      //  10. THE CHIMNEY
      // ============================================================
      // Stucco, chunky, with a little tiled hood over pierced draught slots —
      // the Spanish chimney is a piece of sculpture and nothing else on the
      // roof looks like it. Stood on the flank AWAY from the entrance so it
      // never competes with the tower, at a hash-picked position along the
      // ridge.
      {
        const cs = clamp(small * 0.105, 0.70, 1.35);
        const cAlong = (h(0x5b02) < 0.5 ? -1 : 1) * halfL * (0.30 + h(0x5b03) * 0.22);
        const across = halfS * 0.34;
        // away from the door face: if the door is on a slope face push to the
        // other slope, if it is on a gable end pick by hash.
        const cAcross = (rakeF.indexOf(df.s) >= 0)
          ? -(df.horiz === alongX ? 1 : 1) * (df.out * across) * (alongX === df.horiz ? 1 : 1)
          : (h(0x5b04) < 0.5 ? -across : across);
        const c2 = (rakeF.indexOf(df.s) >= 0) ? -df.out * across : cAcross;
        const surf = yE + RH * (RUN - Math.abs(c2)) / Math.max(0.4, RUN - RIDGE);
        const cTop = Math.min(ridgeY + clamp(FH * 0.55, 1.30, 2.30), surf + clamp(FH * 0.75, 1.60, 2.80));
        rbox(cAlong, (yE - 0.4 + cTop) / 2, c2, cs, cTop - yE + 0.4, cs, stuc);
        rbox(cAlong, cTop + 0.10, c2, cs + 0.26, 0.20, cs + 0.26, stucL);
        // the draught slots, one on each of the four sides
        for (const sg of [-1, 1]) {
          rbox(cAlong + sg * (cs / 2 + 0.02), cTop - 0.40, c2, 0.06, 0.34, cs * 0.44, REV);
          rbox(cAlong, cTop - 0.40, c2 + sg * (cs / 2 + 0.02), cs * 0.44, 0.34, 0.06, REV);
        }
        // the hood: two tile courses on four little corner posts
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          rbox(cAlong + sx * cs * 0.44, cTop + 0.34, c2 + sz * cs * 0.44, 0.16, 0.30, 0.16, stucL);
        }
        rbox(cAlong, cTop + 0.56, c2, cs + 0.50, CH * 0.70, cs + 0.50, tile);
        rbox(cAlong, cTop + 0.56 + CH * 0.62, c2, cs + 0.10, CH * 0.60, cs + 0.10, tileL);
      }

      // ============================================================
      //  11. THE GARDEN WALL
      // ============================================================
      // A low forecourt wall with a tile coping running out from both ends of
      // the entrance face and turning a short return, leaving the path to the
      // portal open. Only when the lot is big enough to read as a garden — on
      // a narrow cottage front it would just be a fence across the pavement.
      const wantWall = (spec.courtyard != null) ? !!spec.courtyard : (small >= 11.5 || ST >= 2);
      if (wantWall) {
        const gL = clamp(small * 0.20, 1.20, 3.00);
        const gH = clamp(FH * 0.27, 0.75, 1.05);
        const gT = clamp(small * 0.035, 0.28, 0.50);
        const gEnd = pOut + gL;
        for (const sg of [-1, 1]) {
          const t = sg * (df.span / 2 - gT / 2);
          // the run out from the house
          ebox(t, gH / 2, (df.halfN + gEnd) / 2, gT, gH, gEnd - df.halfN, stuc);
          ebox(t, gH + 0.07, (df.halfN + gEnd) / 2, gT + 0.20, 0.14, gEnd - df.halfN + 0.10, tile);
          // the short return along the front, stopping well clear of the path
          const retL = Math.max(0.4, df.span / 2 - tS / 2 - 0.9);
          const rc = sg * (df.span / 2 - retL / 2 - gT / 2);
          ebox(rc, gH / 2, gEnd - gT / 2, retL, gH, gT, stuc);
          ebox(rc, gH + 0.07, gEnd - gT / 2, retL + 0.10, 0.14, gT + 0.20, tile);
          // the gate pier at the path end of the return, with a stone ball
          const gp = sg * (df.span / 2 - retL - gT);
          ebox(gp, gH * 0.62, gEnd - gT / 2, gT + 0.34, gH * 1.24, gT + 0.34, stuc);
          ebox(gp, gH * 1.24 + 0.10, gEnd - gT / 2, gT + 0.52, 0.16, gT + 0.52, stucL);
          const bx = df.horiz ? gp : df.out * (gEnd - gT / 2);
          const bz = df.horiz ? df.out * (gEnd - gT / 2) : gp;
          ctx.ball(bx, gH * 1.24 + 0.20 + (gT + 0.30) * 0.5, bz, (gT + 0.30) * 0.5, stucL);
        }
      }
    },
  });
})();
