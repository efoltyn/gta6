/* ============================================================
   city/facades/ziggurat.js — "Zoning Setback Tower", New York 1916-1931.

   THE READ. This shape was not designed, it was LEGISLATED. The 1916 zoning
   resolution said a tower had to step back from the street line as it rose so
   daylight still reached the pavement, and every architect in Manhattan spent
   the next fifteen years making that envelope look deliberate. The result is
   the wedding-cake skyline: a heavy masonry base at the pavement, a tall
   shaft, then a run of setbacks whose terraces get closer together the higher
   you go, and a small temple on the last one.

   HOW THE SETBACKS ARE BUILT (the load-bearing trick in this file)
   ---------------------------------------------------------------
   ctx.w / ctx.d are the host shell's fixed footprint and a facade cannot
   shrink the shell. So the mass below the roofline is built the other way up:
   the shell wall is the INNERMOST plane, and every stage is a CLADDING collar
   standing proud of it — the podium proudest, each stage above it less so.
   Stepping the collar in as it rises produces exactly the same silhouette as
   stepping a real mass back, and it makes the exposed top of each lower stage
   a real terrace with a deck, a parapet and a coping. Above ctx.rTop the shell
   is out of the way and the last two stages are true volumes.

   WHY EACH ELEMENT EXISTS
     MASSIVE BASE   Two or three storeys of darker, heavier stone standing
                    furthest proud, with big segmental-headed punched openings
                    and a bold cornice cutting it off from the shaft. The
                    bottom fifteen metres is the only part a player on foot
                    ever touches, so it has to work as a street wall on its
                    own terms — a different building from the tower above it.
     UNEVEN STAGES  A tall lower shaft, then setbacks that arrive faster and
                    shallower toward the top. Evenly spaced steps read as a
                    wedding cake; accelerating ones read as a building
                    obeying a rule. The stage tops are fractions of rTop, so
                    a 14-storey block and a 52-storey flagship both step.
     TERRACE JUNCTION  Every step is a designed joint, never a raw edge: an
                    oversailing cornice band under it, a lit deck on top of
                    the stage below, then a parapet wall with its own coping.
                    That stack is what makes a setback look inhabited.
     VERTICAL PIERS Continuous piers on ONE set of bay lines for the whole
                    tower, so the stacked stages line up where they overlap
                    and the eye reads one building rather than five boxes.
                    The recessed bays between them carry the glazing.
     SPANDRELS      One thin shadow band per floor line, four boxes a storey.
                    That is the entire per-storey budget: at 128 m a storey is
                    2.5 percent of the elevation, so anything more is invisible
                    and expensive. Everything else is spent at the bands.
     CROWN          The topmost setback carries a stepped attic, a small
                    temple-like cap and a modest mast. It is the silhouette
                    element: from a kilometre this tower is a tapering stack
                    of terraces with a needle on it, which is exactly what the
                    skyline plate is asked to prove.

   COLOUR. Warm limestone buff, darker at the podium, terraces and copings
   picked out lighter. The values are anchored to real mid tones rather than
   derived by lightening the host colour: this renderer clips above about
   0x99 and a wash-out kills every reveal in the file.

   BUDGET. Everything is ctx.dbox (merged) except the mast and its finial —
   three real meshes. On the 40-storey subject the file adds well under a
   thousand merged boxes, a couple of dozen per storey.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("ziggurat", {
    label: "Zoning Setback Tower",
    crownsRoof: true,
    minStoreys: 12,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = ctx.storeys;
      const smallest = Math.min(ctx.w, ctx.d);
      const e = F.entrance(ctx);
      const faces = F.faces(ctx);

      // ---------------- palette ----------------
      // Anchored buff limestone with a little of the host colour mixed in so
      // two of these on one street are not the same drawing.
      const STONE = F.mix(0x7e7159, ctx.color | 0, 0.14);
      const LIGHT = F.mix(STONE, 0x968b72, 0.66);      // terraces, copings, cornices
      const MIDT = F.shade(STONE, 0.86);               // pier flanks
      const DARKB = F.shade(F.mix(STONE, 0x5f5340, 0.62), 0.66);  // the podium stone
      const TERRA = F.mix(STONE, 0x8a5a3c, 0.34);      // spandrel terracotta
      const SHADOW = F.shade(STONE, 0.50);
      const GLASS = F.mix(0x161a1f, STONE, 0.10);      // darkest thing here

      // ---------------- the stages ----------------
      // Fractions of the roofline, not metres, so the whole stack
      // re-proportions on any tower. The heights ACCELERATE: the first stage
      // is nearly half the building, the last is a tenth.
      // The podium collar is DEEP on purpose. Measured off the first render:
      // at smallest*0.085 the whole stack tapered by two metres over 128 and
      // the skyline plate was indistinguishable from a bare box — the steps
      // have to be a real fraction of the plan or the silhouette is a lie.
      const P0 = Math.max(1.6, Math.min(smallest * 0.20, 6.0));    // podium projection
      const stages = [
        { y0: 0, y1: Math.min(H * 0.15, 4 * FH), p: P0, base: true },
        { y0: 0, y1: H * 0.47, p: P0 * 0.62 },
        { y0: 0, y1: H * 0.68, p: P0 * 0.38 },
        { y0: 0, y1: H * 0.83, p: P0 * 0.20 },
        { y0: 0, y1: H, p: P0 * 0.07 },
      ];
      for (let i = 1; i < stages.length; i++) stages[i].y0 = stages[i - 1].y1;
      const yBase = stages[0].y1;

      // ONE set of bay lines for the whole tower, per face orientation, so the
      // piers of stage 4 land on the piers of stage 1.
      function linesFor(f) { return F.bayLines(f, F.bayCount(f, FH * 1.15, 3, 12), Math.max(0.7, f.span * 0.045)); }
      function baysFor(f) { return F.bays(f, F.bayCount(f, FH * 1.15, 3, 12), Math.max(0.7, f.span * 0.045)); }

      // ================================================================
      //  1. THE SHAFT STAGES — clad collars, piers, bays, spandrels
      // ================================================================
      const PIERW = Math.max(0.55, Math.min(FH * 0.36, smallest * 0.05));
      for (let si = 1; si < stages.length; si++) {
        const s = stages[si];
        const h = s.y1 - s.y0;
        if (h < 0.6) continue;
        const proj = Math.max(0.18, s.p);
        for (const f of faces) {
          // the stage's own wall plane
          F.band(ctx, f, (s.y0 + s.y1) / 2, h, proj, STONE, 0.16, 0);
          // recessed glazed bays
          for (const b of baysFor(f)) {
            F.box(ctx, f, b.t, (s.y0 + s.y1) / 2, b.w * 0.74, h - 0.1, proj + 0.05, GLASS, 0);
          }
          // the continuous piers, standing proud of the bays
          const pp = proj + Math.max(0.30, PIERW * 0.55);
          const lines = linesFor(f);
          for (let i = 0; i < lines.length; i++) {
            F.rib(ctx, f, lines[i], s.y0, s.y1, PIERW, pp, i % 2 ? STONE : MIDT, 0);
          }
          // one spandrel shadow per floor line: the ENTIRE per-storey spend
          const k0 = Math.ceil(s.y0 / FH), k1 = Math.floor((s.y1 - 0.2) / FH);
          for (let k = k0; k <= k1; k++) {
            F.box(ctx, f, 0, k * FH, f.span + 0.1, FH * 0.15, proj + 0.09, SHADOW, 0);
            if (k % 4 === 0) F.box(ctx, f, 0, k * FH - FH * 0.11, f.span + 0.1, FH * 0.05, proj + 0.11, TERRA, 0);
          }
        }
      }

      // ================================================================
      //  2. THE SETBACK JUNCTIONS — cornice, deck, parapet, coping
      // ================================================================
      // Each junction reads from the LOWER stage's projection, which is the
      // width of terrace the step just exposed.
      for (let si = 0; si + 1 < stages.length; si++) {
        const lo = stages[si], hi = stages[si + 1];
        const y = lo.y1;
        const pl = Math.max(0.20, lo.p);
        const railH = Math.max(0.7, Math.min(FH * 0.42, H * 0.012 + 0.6));
        const railT = Math.max(0.30, pl * 0.34);
        // cornice: oversails the stage below so the step throws a hard shadow
        const ch = Math.max(0.30, Math.min(FH * 0.32, pl * 0.55));
        F.ring(ctx, y - ch * 0.55, ch, pl + ch * 0.55, LIGHT, 0.5, 0);
        F.ring(ctx, y - ch * 1.15, ch * 0.30, pl + ch * 0.25, SHADOW, 0.4, 0);
        // the terrace deck itself, lit, sitting on top of the lower collar
        F.ring(ctx, y + 0.10, 0.20, pl + 0.10, LIGHT, 0.36, 0);
        // parapet standing at the OUTER edge of that deck, plus its coping
        const pIn = pl + 0.10 - railT;
        F.ring(ctx, y + 0.20 + railH / 2, railH, railT, F.shade(LIGHT, 0.94), 0.3, pIn);
        F.ring(ctx, y + 0.24 + railH, 0.18, railT + 0.26, LIGHT, 0.36, pIn - 0.13);
        // a squat pier on each terrace corner: what stops a parapet reading as
        // a ribbon of tape wrapped round the tower.
        F.corners(ctx, y + 0.30 + railH * 0.6, railH * 1.2, railH * 1.5, pl + 0.06, LIGHT);
        // the reveal above the step: a shadow line at the foot of the new stage
        F.ring(ctx, y + 0.34, 0.16, Math.max(0.16, hi.p) + 0.06, SHADOW, 0.2, 0);
      }

      // ================================================================
      //  3. THE MASSIVE BASE — a street wall in its own right
      // ================================================================
      {
        const s = stages[0];
        const proj = s.p;
        for (const f of faces) {
          F.band(ctx, f, s.y1 / 2, s.y1, proj, DARKB, 0.2, 0);
          // heavy coursing: a few deep joints, not one per brick
          const nc = Math.max(3, Math.round(s.y1 / (FH * 0.55)));
          for (let i = 1; i < nc; i++) {
            F.band(ctx, f, (i * s.y1) / nc, 0.10, proj + 0.05, F.shade(DARKB, 0.72), 0.24, 0);
          }
          // big punched openings with segmental heads
          const nb = F.bayCount(f, 6.2, 2, 5);
          const bays = F.bays(f, nb, Math.max(1.1, f.span * 0.08));
          const oy0 = Math.max(0.9, s.y1 * 0.12);
          const head = s.y1 * 0.66;
          for (const b of bays) {
            const ow = Math.min(b.w * 0.56, head - oy0);
            if (ow < 1.0) continue;
            if (!F.clearsDoor(ctx, f, b.t, ow + 1.6)) continue;
            F.box(ctx, f, b.t, (oy0 + head) / 2, ow, head - oy0, proj + 0.06, GLASS, 0);
            const rise = Math.min((s.y1 - head) * 0.5, ow * 0.34);
            if (rise > 0.25) F.arch(ctx, f, b.t, head, ow, rise, 0.22, proj + 0.22, LIGHT, "segmental");
            // jambs and a sill so the opening is a hole in a thick wall
            for (const sg of [-1, 1]) F.rib(ctx, f, b.t + sg * (ow / 2 + 0.24), oy0, head, 0.46, proj + 0.20, F.shade(LIGHT, 0.88), 0);
            F.box(ctx, f, b.t, oy0 - 0.16, ow + 1.0, 0.26, proj + 0.30, LIGHT, 0);
          }
        }
        // the plinth the whole tower stands on
        F.ring(ctx, 0.22, 0.44, proj + 0.34, F.shade(DARKB, 0.86), 0.6, 0);
        // THE PORTAL: the base is allowed one loud gesture, on the door face.
        const df = e.f;
        const pTop = Math.min(s.y1 - 0.9, e.head + 1.1);
        if (pTop > 1.2) {
          F.box(ctx, df, 0, pTop / 2, e.gap + 1.8, pTop, proj + 0.05, F.shade(DARKB, 0.55), 0);
          const rise = Math.min(s.y1 - pTop - 0.5, (e.gap + 2.4) * 0.42);
          if (rise > 0.3) F.arch(ctx, df, 0, pTop, e.gap + 2.4, rise, 0.3, proj + 0.30, LIGHT, "round");
          for (const sg of [-1, 1]) F.rib(ctx, df, sg * (e.gap / 2 + 0.9 + 0.4), 0.2, pTop + 0.4, 0.9, proj + 0.28, LIGHT, 0);
          F.box(ctx, df, 0, pTop + Math.max(0.4, rise) + 0.5, e.gap + 4.2, 0.36, proj + 0.40, LIGHT, 0);
        }
      }

      // ================================================================
      //  4. THE CROWN — true volumes above the shell's roofline
      // ================================================================
      // Helpers: above rTop nothing is on a shell face any more, so these draw
      // free-standing boxes in building-local coordinates.
      function vol(hw, hd, y0, y1, col) { ctx.dbox(0, (y0 + y1) / 2, 0, hw * 2, y1 - y0, hd * 2, col); }
      function vcap(hw, hd, y, h, over, col) { ctx.dbox(0, y + h / 2, 0, hw * 2 + over, h, hd * 2 + over, col); }
      function vpiers(hw, hd, y0, y1, col) {
        const nX = Math.max(3, Math.round(hw * 2 / (FH * 1.2)));
        const nZ = Math.max(3, Math.round(hd * 2 / (FH * 1.2)));
        const pw = PIERW * 0.9, pr = Math.max(0.26, PIERW * 0.5);
        for (let i = 0; i <= nX; i++) {
          const x = -hw + (i * hw * 2) / nX;
          for (const sg of [-1, 1]) ctx.dbox(x, (y0 + y1) / 2, sg * (hd + pr / 2), pw, y1 - y0, pr, i % 2 ? STONE : MIDT);
        }
        for (let i = 0; i <= nZ; i++) {
          const z = -hd + (i * hd * 2) / nZ;
          for (const sg of [-1, 1]) ctx.dbox(sg * (hw + pr / 2), (y0 + y1) / 2, z, pr, y1 - y0, pw, i % 2 ? STONE : MIDT);
        }
        // glazed slot behind them, so the crown stage is not a solid billet
        ctx.dbox(0, (y0 + y1) / 2, 0, hw * 2 + 0.06, (y1 - y0) * 0.9, hd * 2 + 0.06, GLASS);
      }
      {
        const topP = Math.max(0.16, stages[stages.length - 1].p);
        const hw0 = ctx.w / 2 + topP, hd0 = ctx.d / 2 + topP;
        const cH = Math.max(FH * 3.0, H * 0.21);      // the whole crown's height
        // stages 6-8: pulled in fast, each one shorter than the last
        const a = { hw: hw0 * 0.70, hd: hd0 * 0.70, y0: H, y1: H + cH * 0.34 };
        const b = { hw: hw0 * 0.50, hd: hd0 * 0.50, y0: a.y1, y1: a.y1 + cH * 0.22 };
        const c = { hw: hw0 * 0.34, hd: hd0 * 0.34, y0: b.y1, y1: b.y1 + cH * 0.15 };

        // the roof terrace the crown stands on: parapet + coping round the
        // shell's own roofline, so the last setback lands on something.
        {
          const railH = Math.max(0.8, FH * 0.42), railT = Math.max(0.3, topP + 0.30);
          F.ring(ctx, H + 0.12, 0.24, topP + 0.24, LIGHT, 0.4, 0);
          F.ring(ctx, H + 0.24 + railH / 2, railH, railT, F.shade(LIGHT, 0.94), 0.3, topP + 0.24 - railT);
          F.ring(ctx, H + 0.28 + railH, 0.18, railT + 0.24, LIGHT, 0.36, topP + 0.10 - railT);
        }

        for (const v of [a, b, c]) {
          vol(v.hw, v.hd, v.y0, v.y1, STONE);
          vpiers(v.hw, v.hd, v.y0 + 0.3, v.y1 - 0.5, STONE);
          // its own cornice, deck and parapet — the same junction grammar
          vcap(v.hw, v.hd, v.y1 - 0.55, 0.55, 0.9, LIGHT);
          vcap(v.hw, v.hd, v.y1, 0.22, 0.5, F.shade(LIGHT, 0.9));
          vcap(v.hw, v.hd, v.y0 - 0.18, 0.20, 1.5, SHADOW);
        }

        // stepped attic + temple cap on the last stage
        const tW = c.hw * 1.6, tD = c.hd * 1.6;
        const topY = F.ziggurat(ctx, 0, 0, c.y1 + 0.22, tW, tD, cH * 0.22, 4, LIGHT, 0.74, 0.06);
        // a small colonnaded lantern under the mast, drawn as four corner piers
        const lw = tW * 0.30 * 0.5;
        const lh = cH * 0.10;
        ctx.dbox(0, topY + lh / 2, 0, lw * 2, lh, lw * 2, GLASS);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          ctx.dbox(sx * lw, topY + lh / 2, sz * lw, 0.5, lh, 0.5, LIGHT);
        }
        ctx.dbox(0, topY + lh + 0.14, 0, lw * 2.5, 0.28, lw * 2.5, LIGHT);

        // THE MAST. Three real meshes, the only ones this facade mints.
        const mastY = topY + lh + 0.28;
        const mr = Math.max(0.18, smallest * 0.014);
        const mh = Math.max(FH * 1.6, cH * 0.34);
        ctx.column(0, mastY, 0, mr, mh, LIGHT, 8);
        ctx.ball(0, mastY + mh * 0.42, 0, mr * 2.1, LIGHT);
        ctx.cone(0, mastY + mh, 0, mr * 1.3, mh * 0.34, F.shade(LIGHT, 0.9));
      }
    },
  });
})();
