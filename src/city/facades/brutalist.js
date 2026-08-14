/* ============================================================
   city/facades/brutalist.js — "Beton Brut", 1968.

   THE READ. A brutalist block is not a grey box; a grey box is what you get
   when you draw brutalism as a colour. The style is made of DEPTH: every
   opening is a hole punched through a thick wall, so the wall shows its
   thickness at the reveal, and a hood over the head throws a hard band of
   shadow across the glass all day. Shadow is the ornament. So the very first
   thing this file builds, and the thing every other element is sized against,
   is the window box: jambs each side, a sill under, a hood over, all standing
   0.4-0.7 m proud of the wall plane.

   WHY EACH ELEMENT EXISTS
     PILOTIS      The mass is lifted on heavy tapered piers and the ground
                  floor is pushed back into darkness behind them. That is the
                  Corbusian move the whole style descends from, and it is what
                  makes the block read as hovering instead of as sitting.
                  The piers step in tangent so they never foul the doorway.
     SERVICE TOWER  Brutalism is honest about services: the stair and the
                  risers are pulled OUT of the plan into a blind shaft that
                  stands proud of one flank and runs past the roofline. It is
                  the silhouette element - the thing you identify at 200 m as
                  a black shape, which is the only test a facade really has.
     ROOF SLAB    A deep concrete lid overhanging the top storey, with that
                  storey set back under it. It terminates the building with a
                  line of shadow instead of letting the walls just stop.
     PROUD BAY    One bay of one flank steps forward for its full height, so
                  the block is two planes fighting, not one plane painted.
     FINS         A run of deep vertical blades (brise-soleil) on a flank -
                  the same shadow logic as the hoods, applied to a whole wall.
     BOARD MARKS  Beton brut means the concrete is left exactly as the timber
                  formwork cast it: fine horizontal plank reveals at a regular
                  pitch, with a vertical joint where panels meet. Relief and
                  shade only, never colour.
     STREAKS      Real concrete weathers. Dark vertical stains hang below the
                  roof slab and the hood ends, sparse and hash-chosen. Honest
                  to the material, and it kills the "new toy" plastic look.

   Every dimension below comes from ctx.w / ctx.d / ctx.storeys / ctx.FH /
   ctx.rTop or a face's own span, so a 10 m one-storey shop and a 40 m eight
   storey block both re-proportion instead of breaking. Variation is ctx.hash
   only. Everything lands in ctx.dbox (merged, free); no real meshes are minted
   at all, so a dressed block costs the same draw calls as a bare one.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("brutalist", {
    label: "Beton Brut",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, rTop = ctx.rTop, ST = ctx.storeys;
      const smallest = Math.min(ctx.w, ctx.d);

      // ---- the palette: raw concrete. Desaturate the host colour hard, then
      // work purely in shades of it, so relief reads as light and not as paint.
      const c = ctx.color | 0;
      const lum = (((c >> 16) & 255) * 0.30 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11) | 0;
      const grey = (lum << 16) | (lum << 8) | lum;
      // Beton brut is a MID-grey, not a white stone: pull the host colour down
      // as well as desaturating it, or the whole block blows out to paper white
      // under the city's own sun and every reveal disappears.
      // MEASURED, not guessed: at the city's own exposure anything above about
      // 0x99 clips to paper white and every reveal in this file disappears with
      // it. Beton brut is a mid-to-dark grey, so land the wall near 0x6e and
      // spend the whole remaining range on relief.
      const CONC = F.shade(F.mix(F.mix(c, grey, 0.88), 0x74746f, 0.75), 0.78);
      const LIT = F.shade(CONC, 1.22);   // a face catching light (hood tops, caps)
      const MID = F.shade(CONC, 0.78);   // reveals
      const DARK = F.shade(CONC, 0.48);  // undersides, recesses
      const VOID = F.shade(CONC, 0.14);  // glazing behind the reveals
      const STAIN = F.shade(CONC, 0.40); // weathering

      // ---- the governing depth. Everything relief-like is a multiple of it.
      // Tied to the floor height so a tall-storey block gets deeper reveals.
      const RP = Math.max(0.46, Math.min(0.70, FH * 0.21));

      // ---- floor bookkeeping ------------------------------------------
      // Pilotis eat the ground floor; the set-back top storey lives under the
      // roof slab. Both are only possible if the building has floors to spare.
      const PIL = ST >= 2;                       // lift the mass on piers
      const SETBACK = ST >= 3;                   // recessed top storey
      const f0 = PIL ? 1 : 0;                    // first storey that gets windows
      const f1 = SETBACK ? ST - 2 : ST - 1;      // last storey that gets windows
      const ent = F.entrance(ctx);

      // face-local outward shift: the proud bay pushes part of one face out.
      let proudSide = -1, proudT = 0, proudLen = 0;
      const PD = Math.max(0.35, Math.min(0.9, smallest * 0.035));   // proud depth
      function insetAt(f, t, len) {
        if (f.s !== proudSide) return 0;
        return (Math.abs(t - proudT) + (len || 0) / 2 <= proudLen / 2) ? PD : 0;
      }

      // ================================================================
      //  0. PICK THE SIDES (deterministic, position-hashed)
      // ================================================================
      const flanks = F.flanks(ctx);
      const towerFace = flanks[Math.min(flanks.length - 1, (ctx.hash(0x8f01) * flanks.length) | 0)];
      // the shaft's width and where it sits along that flank: near one end, so
      // the silhouette is asymmetric the way a real service core is.
      const towerLen = Math.max(FH * 1.0, Math.min(towerFace.span * 0.34, smallest * 0.50));
      const towerT = (ctx.hash(0x8f05) > 0.5 ? 1 : -1) * Math.max(0, towerFace.span / 2 - towerLen / 2 - towerFace.span * 0.07);
      const others = flanks.filter((f) => f.s !== towerFace.s);
      const proudFace = others.length ? others[Math.min(others.length - 1, (ctx.hash(0x8f02) * others.length) | 0)] : null;
      const finFace = others.length > 1
        ? others.filter((f) => !proudFace || f.s !== proudFace.s)[0]
        : null;
      if (proudFace && proudFace.span > 7) {
        proudLen = proudFace.span * 0.34;
        const side = ctx.hash(0x8f03) > 0.5 ? 1 : -1;
        proudT = side * (proudFace.span / 2 - proudLen / 2 - proudFace.span * 0.06);
        proudSide = proudFace.s;
      }

      // ================================================================
      //  1. BOARD-FORMED CONCRETE — the surface itself
      // ================================================================
      // Horizontal plank reveals at a fixed pitch derived from the storey, plus
      // one vertical panel joint every couple of bays. Shade only, 4-6 cm proud.
      const PLANK = FH / 6;                                  // formwork plank pitch
      function boardwork(f, y0, y1, ins) {
        if (y1 - y0 < PLANK) return;
        const n = Math.max(1, Math.round((y1 - y0) / PLANK));
        const step = (y1 - y0) / n;
        const len = (ins > 0 ? proudLen : f.span) + (ins > 0 ? 0 : 0.16);
        const t0 = ins > 0 ? proudT : 0;
        for (let i = 1; i < n; i++) {
          F.box(ctx, f, t0, y0 + i * step, len, step * 0.16, 0.05, i % 2 ? MID : DARK, ins);
        }
        // vertical panel joints: one per ~2 bays, the shutter-panel edge
        const pj = Math.max(1, Math.round(len / (FH * 1.9)));
        for (let i = 1; i < pj; i++) {
          const t = t0 - len / 2 + (i * len) / pj;
          F.box(ctx, f, t, (y0 + y1) / 2, 0.09, y1 - y0, 0.06, DARK, ins);
        }
      }

      // ================================================================
      //  2. THE WINDOW BOX — the whole look lives here
      // ================================================================
      // A hole in a thick wall: dark glass on the wall plane, a jamb each side,
      // a sill under it and a hood over it, all standing RP proud so the hood
      // lays a hard shadow across the glass and the jambs shade the sides.
      function windowBox(f, k, t, cell, ins) {
        const fy0 = k * FH;
        const y0 = fy0 + FH * 0.26, y1 = fy0 + FH * 0.82;    // opening head/foot
        const openW = Math.min(cell * 0.66, FH * 1.45);
        const jw = Math.max(0.22, cell * 0.17);
        const outer = openW + jw * 2;
        if (openW < 0.5) return;
        // the glass, deep at the back of the reveal
        F.box(ctx, f, t, (y0 + y1) / 2, openW, y1 - y0, 0.07, VOID, ins);
        // jambs (reveals) each side
        for (const sg of [-1, 1])
          F.box(ctx, f, t + sg * (openW + jw) / 2, (y0 + y1) / 2, jw, y1 - y0, RP, sg < 0 ? MID : DARK, ins);
        // sill, slightly shy of the hood so the box is not a plain frame
        F.box(ctx, f, t, y0 - FH * 0.045, outer, FH * 0.09, RP * 0.92, MID, ins);
        F.box(ctx, f, t, y0 - FH * 0.10, outer + jw * 0.5, FH * 0.035, RP * 1.02, DARK, ins);
        // the HOOD: heavier than the sill, projects furthest, lit top edge
        F.box(ctx, f, t, y1 + FH * 0.085, outer + jw * 0.6, FH * 0.17, RP * 1.28, MID, ins);
        F.box(ctx, f, t, y1 + FH * 0.175, outer + jw * 0.9, FH * 0.045, RP * 1.34, LIT, ins);
        F.box(ctx, f, t, y1 + FH * 0.012, outer + jw * 0.3, FH * 0.03, RP * 1.30, DARK, ins);  // soffit shadow
        // weathering: a stain hanging off one hood end, sparse and hashed
        if (ctx.hash(0x2200 + f.s * 37 + k * 7 + ((t * 4) | 0)) > 0.62) {
          const sg = ctx.hash(0x3300 + f.s * 13 + k) > 0.5 ? 1 : -1;
          F.box(ctx, f, t + sg * (outer * 0.5 + jw * 0.35), y1 - FH * 0.28, 0.13, FH * 0.62, 0.05, STAIN, ins);
        }
      }

      // ================================================================
      //  3. THE WALLS — bays, boardwork, windows
      // ================================================================
      const bodyY0 = PIL ? FH : 0;
      const bodyY1 = f1 >= 0 ? (f1 + 1) * FH : rTop;
      for (const f of F.faces(ctx)) {
        const n = F.bayCount(f, FH * 1.45, 2, 8);
        const bays = F.bays(f, n, Math.max(0.6, f.span * 0.05));
        boardwork(f, bodyY0, bodyY1, 0);
        if (f.s === proudSide) boardwork(f, 0, rTop, PD);
        for (let k = f0; k <= f1; k++) {
          for (const b of bays) {
            // the tower's own footprint is blind wall - no windows behind it
            if (f.s === towerFace.s && Math.abs(b.t - towerT) < towerLen * 0.62) continue;
            if (k === 0 && !F.clearsDoor(ctx, f, b.t, b.w * 0.9)) continue;
            windowBox(f, k, b.t, b.w, insetAt(f, b.t, b.w));
          }
        }
        // the vertical joint between the two planes of the stepped bay
        if (f.s === proudSide) {
          for (const sg of [-1, 1])
            F.box(ctx, f, proudT + sg * (proudLen / 2 + 0.06), rTop / 2, 0.12, rTop, PD, DARK, 0);
        }
      }

      // the PROUD BAY's own return walls: without these the stepped plane is a
      // floating slab rather than a piece of the block that has moved forward.
      if (proudSide >= 0) {
        F.box(ctx, proudFace, proudT, rTop / 2, proudLen, rTop, PD, CONC, 0);
        F.box(ctx, proudFace, proudT, rTop + 0.12, proudLen + 0.3, 0.24, PD * 1.15, LIT, 0);
      }

      // ================================================================
      //  4. PILOTIS — the mass lifted, the ground floor pushed into shadow
      // ================================================================
      if (PIL) {
        const pierProj = RP * 1.5;
        const gh = FH;                                  // the lifted storey
        for (const f of F.faces(ctx)) {
          const n = F.bayCount(f, FH * 1.6, 2, 6);
          const lines = F.bayLines(f, n, Math.max(0.5, f.span * 0.06));
          // the recessed, darker glazed ground floor, set back behind the piers
          F.box(ctx, f, 0, gh * 0.52, f.span + 0.1, gh * 0.80, 0.06, VOID, 0);
          F.box(ctx, f, 0, gh * 0.06, f.span + 0.1, gh * 0.12, 0.10, DARK, 0);
          for (const t of lines) {
            if (!F.clearsDoor(ctx, f, t, FH * 0.42)) continue;
            // a heavy pier that TAPERS: three stacked segments, widest at the
            // head where it meets the mass it is carrying.
            for (let s = 0; s < 3; s++) {
              const u = s / 3, u1 = (s + 1) / 3;
              const wid = FH * (0.30 + 0.09 * u1);
              const pr = pierProj * (0.80 + 0.20 * u1);
              F.box(ctx, f, t, gh * (u + u1) / 2, wid, gh / 3, pr, s === 1 ? MID : CONC, 0);
            }
          }
          // the underside of the raised mass, reading as a deep dark soffit
          F.box(ctx, f, 0, gh + 0.14, f.span + 0.24, 0.28, pierProj * 1.1, DARK, 0);
          F.box(ctx, f, 0, gh + 0.36, f.span + 0.34, 0.16, pierProj * 1.18, LIT, 0);
        }
      }

      // ================================================================
      //  5. BRISE-SOLEIL — deep vertical blades on one flank
      // ================================================================
      if (finFace && finFace.span > 6 && f1 >= f0) {
        const n = F.bayCount(finFace, FH * 0.52, 3, 22);
        const lines = F.bayLines(finFace, n, Math.max(0.4, finFace.span * 0.04));
        const y0 = bodyY0 + FH * 0.18, y1 = bodyY1 - FH * 0.10;
        for (let i = 0; i < lines.length; i++) {
          F.rib(ctx, finFace, lines[i], y0, y1, 0.16, RP * 1.45, i % 2 ? MID : CONC, 0);
        }
        // top and bottom rails, so the blades read as a fitted screen
        F.box(ctx, finFace, 0, y1 + 0.14, finFace.span * 0.96, 0.28, RP * 1.5, CONC, 0);
        F.box(ctx, finFace, 0, y0 - 0.14, finFace.span * 0.96, 0.28, RP * 1.5, DARK, 0);
      }

      // ================================================================
      //  6. THE ROOF SLAB — a deep lid over a set-back top storey
      // ================================================================
      const OV = Math.max(0.7, Math.min(1.6, smallest * 0.075));   // overhang
      const SLABH = Math.max(0.40, FH * 0.17);
      if (SETBACK) {
        // top storey pulled back into shadow under the lid
        const ty0 = (ST - 1) * FH, ty1 = rTop;
        for (const f of F.faces(ctx)) {
          // glazed, but with a spandrel under it and a header over it, so the
          // set-back storey is a recessed band and not a greenhouse
          F.box(ctx, f, 0, ty0 + (ty1 - ty0) * 0.55, f.span + 0.06, (ty1 - ty0) * 0.58, 0.07, VOID, 0);
          F.box(ctx, f, 0, ty0 + (ty1 - ty0) * 0.13, f.span + 0.06, (ty1 - ty0) * 0.26, 0.16, MID, 0);
          F.box(ctx, f, 0, ty0 + 0.12, f.span + 0.2, 0.24, OV * 0.45, DARK, 0);
          // the set-back storey's own slim piers, one per structural bay
          const lines = F.bayLines(f, F.bayCount(f, FH * 1.6, 2, 6), Math.max(0.5, f.span * 0.06));
          for (const t of lines) F.rib(ctx, f, t, ty0 + 0.2, ty1, FH * 0.20, 0.22, MID, 0);
        }
      }
      // the lid itself, with a lit top lip and a dark drip edge underneath
      F.ring(ctx, rTop + SLABH * 0.5, SLABH, OV, CONC, 0.3, 0);
      F.ring(ctx, rTop + SLABH * 1.03, SLABH * 0.24, OV * 1.06, LIT, 0.4, 0);
      F.ring(ctx, rTop + SLABH * 0.06, SLABH * 0.20, OV * 1.02, DARK, 0.35, 0);
      // weathering hanging off the slab: sparse dark runs down the wall below it
      for (const f of F.faces(ctx)) {
        const n = F.bayCount(f, FH * 0.9, 2, 10);
        for (const b of F.bays(f, n, 0.8)) {
          if (ctx.hash(0x4400 + f.s * 29 + b.i * 11) > 0.66) {
            const h = FH * (0.7 + ctx.hash(0x4500 + f.s * 5 + b.i) * 1.5);
            F.box(ctx, f, b.t, rTop - h / 2, 0.15, h, 0.05, STAIN, insetAt(f, b.t, 0.2));
          }
        }
      }

      // ================================================================
      //  7. THE SERVICE TOWER — the silhouette
      // ================================================================
      // A blind shaft standing proud of one flank and running past the roof.
      {
        const f = towerFace;
        // HOW FAR IT STANDS OUT. Judgement call, corrected off the render: at
        // smallest*0.22 the shaft read as a separate chimney parked beside the
        // block. A service core is BONDED to the wall - about a metre proud is
        // all it takes to break the silhouette while staying part of the mass.
        const tp = Math.max(0.75, Math.min(smallest * 0.10, 1.9, f.span * 0.22));
        // how far past the roof it runs: a fixed floor-and-a-bit on a tall
        // block, but never more than half the block again on a low one - on a
        // one-storey shop an unclamped shaft reads as a factory chimney.
        const over = Math.min(FH * (0.9 + ctx.hash(0x8f04) * 0.7), rTop * 0.55);
        const rise = rTop + over + SLABH;
        // shaft
        F.box(ctx, f, towerT, rise / 2, towerLen, rise, tp, CONC, 0);
        // the corner returns, shaded, so the shaft reads as a solid prism
        for (const sg of [-1, 1])
          F.box(ctx, f, towerT + sg * (towerLen / 2 - 0.13), rise / 2, 0.26, rise, tp * 1.02, sg < 0 ? MID : DARK, 0);
        // board-formed lifts up the shaft: one reveal per concrete pour
        const lifts = Math.max(2, Math.round(rise / (FH * 0.8)));
        for (let i = 1; i < lifts; i++)
          F.box(ctx, f, towerT, (i * rise) / lifts, towerLen + 0.04, 0.10, tp * 1.03, DARK, 0);
        // flat cap, slightly oversailing - never a spire, never a pitched roof
        F.box(ctx, f, towerT, rise + SLABH * 0.45, towerLen + 0.36, SLABH * 0.9, tp * 1.10, CONC, 0);
        F.box(ctx, f, towerT, rise + SLABH * 0.95, towerLen + 0.5, SLABH * 0.22, tp * 1.14, LIT, 0);
        // a single slot vent near the top - the only opening it gets
        F.box(ctx, f, towerT, rise - FH * 0.55, towerLen * 0.42, FH * 0.30, tp * 0.96, VOID, 0);
        // a stain down the shaft, always: it is the wettest face on the block
        F.box(ctx, f, towerT + towerLen * 0.28, rise * 0.62, 0.16, rise * 0.55, tp * 1.05, STAIN, 0);
        // splayed base so the shaft lands on the ground instead of hovering
        F.box(ctx, f, towerT, FH * 0.16, towerLen + 0.4, FH * 0.32, tp * 1.08, MID, 0);
      }
    },
  });
})();
