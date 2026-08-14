/* ============================================================
   city/facades/victorian.js — "Second Empire": the 1880s commercial block.

   WHAT IS BEING MODELLED. The American main-street block of 1865-1890, the
   moment when a cast-iron ground floor, a painted masonry shaft and a French
   mansard roof were all sold out of the same catalogue. This style has one
   governing conviction, and it is the exact opposite of the Deco tower's:
   HORIZONTAL LAYERING, PROFUSELY MOULDED. Every floor line is announced by a
   string course, every window is framed and hatted, the eaves are carried on
   ranks of scroll brackets, and the whole thing is capped by a steep slate
   mansard with dormers pushing out of it. Nothing is allowed to be plain, and
   nothing may run past a floor line uninterrupted.

   WHY EACH ELEMENT IS HERE.
     WATER TABLE   a dark plinth course, so the storefront stands on something.
     CAST-IRON     the ground storey is columns, not wall: slim colonnettes on
     STOREFRONT    plinths, big display glass between them, a transom light band
                   and a continuous signboard fascia. The door is left alone.
     STRING        a moulded three-part band at every floor line. This is what
     COURSES       makes the block read as stacked storeys rather than as a
                   painted box, and it is the cheapest such element there is.
     QUOINS        stepped corner blocks in trim colour, alternating course by
                   course, so the corner has a hard painted edge.
     SURROUNDS     every middle-storey window gets an architrave, a sill on two
                   console brackets, and a head that alternates by floor between
                   a segmental arch and a flat cornice. Alternation by floor is
                   the period habit that stops a grid of holes reading as a
                   spreadsheet.
     ORIEL         one or two projecting three-facet bay windows running up the
                   middle storeys, each on a bracketed base with its own little
                   roof cap. The second silhouette move: it breaks the wall
                   plane, which is the only thing a flat elevation cannot do.
     BRACKETED     a DEEP overhanging eaves band on closely spaced paired
     CORNICE       brackets, over a dentil row, under a moulded fascia. Victorian
                   cornices project absurdly; a shy one reads as a parapet and
                   the whole style collapses.
     MANSARD       the roof IS the top storey: stepped courses walking inward as
                   they rise, in slate, so steep they are nearly vertical, capped
                   by a flat deck with an iron cresting rail and corner finials.
                   This owns the silhouette from 200 m.
     DORMERS       windows punching clearly proud of that slope, each with
                   cheeks, a sill and a stepped pedimented hood. Without them the
                   mansard is a hat; with them it is a floor people live on.

   COLOUR. Painted masonry earns polychromy, so this facade takes three tones
   from one curated set chosen by position hash: a body pulled off ctx.color, a
   pale trim for every moulding, and a dark slate for the roof. A street of them
   varies without any one of them going circus.

   Every dimension derives from ctx.w / ctx.d / ctx.storeys / ctx.FH / ctx.rTop
   or a face span: an 11 m one-storey shop gets a storefront, a cornice and a
   three-dormer mansard, and a 40 m eight-storey block gets the full stack.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // THE CURATED POLYCHROMY. Each entry is [body, trim, slate] as three REAL
  // values, not three shades of one: a mid-tone body, a much lighter trim, and
  // a much darker roof. They are authored outright rather than derived from the
  // host colour, because the host colour arrives near-white on a pale district
  // and any facade that only tints it ends up as one flat cream blur — which is
  // exactly the failure this table exists to prevent. The host colour is still
  // blended in, but only enough to keep the building in its street.
  const SETS = [
    [0x7f7442, 0xf1ead2, 0x2c362f],   // olive / buff-cream / dark grey-green
    [0x7a4133, 0xefe4cd, 0x30303a],   // deep red-brown / cream / blue-black
    [0x9a7a3e, 0xf6f0dd, 0x393127],   // ochre / ivory / brown-black
    [0x5f6c7d, 0xe6ebf1, 0x262b33],   // slate blue / pale grey / graphite
    [0x6f5460, 0xf0e5e3, 0x2e2730],   // plum / blush white / aubergine
  ];

  CBZ.registerFacade("victorian", {
    label: "Second Empire",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      const W = ctx.w, D = ctx.d, FH = ctx.FH, ST = Math.max(1, ctx.storeys);
      const H = ctx.rTop;                       // top of the walls
      const unit = Math.min(W, D);              // the building's own ruler

      // ---- palette ------------------------------------------------
      const set = SETS[Math.min(SETS.length - 1, (ctx.hash(0x5e2e) * SETS.length) | 0)];
      // The host colour is mixed in at a quarter, so a district still tints the
      // street; the three values stay separated by a lot more than that.
      // The city renders under a very bright ambient, which lifts dark values
      // hard: a nominal charcoal comes back as a mid grey. So the body takes
      // only a little of the host colour and the slate is driven down well
      // past where it "should" sit, which is what buys the three-tone read at
      // 40 m instead of on a swatch.
      const body = F.shade(F.mix(set[0], ctx.color, 0.14), 0.92);
      const bodyD = F.shade(body, 0.82);
      const trim = F.mix(set[1], ctx.color, 0.10);
      const trimD = F.shade(trim, 0.90);
      const slate = F.shade(set[2], 0.55);
      const slateL = F.mix(slate, 0xffffff, 0.07);
      const glass = F.mix(F.shade(ctx.color, 0.28), 0x1b2430, 0.62);
      const iron = F.mix(slate, trim, 0.22);

      // ---- the ruling grid ----------------------------------------
      const PJ = clamp(unit * 0.030, 0.18, 0.60);   // the standard relief depth
      const plinthH = clamp(FH * 0.16, 0.28, 0.9);
      const groundH = FH;                            // the storefront storey
      const e = F.entrance(ctx);
      const faces = F.faces(ctx);
      // The cornice is measured up front because everything below it — the
      // oriel above all — has to stop clear of the eaves rather than run into
      // them. Its depth is the deepest projection on the building, by intent.
      const corD = clamp(unit * 0.105, 0.55, 1.7);           // how far the eaves fly
      const corH = clamp(FH * 0.34, 0.55, 1.5);
      const braH = corH * 0.92;                              // bracket height
      const cornBase = H - corH - braH;                      // where the brackets land

      // ============================================================
      //  1. WATER TABLE — a dark plinth the whole block stands on
      // ============================================================
      F.ring(ctx, plinthH / 2, plinthH, PJ * 1.25, F.shade(bodyD, 0.62), 0.30);
      F.ring(ctx, plinthH + 0.07, 0.14, PJ * 1.45, trimD, 0.36);

      // ============================================================
      //  2. THE CAST-IRON STOREFRONT (ground storey, all four faces)
      // ============================================================
      const signH = clamp(groundH * 0.17, 0.34, 0.9);       // signboard fascia
      const transH = clamp(groundH * 0.13, 0.26, 0.7);      // transom lights
      const winTop = groundH - signH - transH;              // display glass head
      const colH = winTop - plinthH;
      let colBudget = 8;                                    // real cylinders only
      for (const f of faces) {
        const n = F.bayCount(f, clamp(unit * 0.26, 3.0, 5.0), 2, 7);
        const marg = clamp(f.span * 0.06, 0.30, 1.1);
        const lines = F.bayLines(f, n, marg);
        const step = lines.length > 1 ? (lines[1] - lines[0]) : f.span;
        const cw = clamp(step * 0.13, 0.20, 0.55);          // colonnette width

        // display glass + its bulkhead, one per bay
        for (const b of F.bays(f, n, marg)) {
          const bw = Math.max(0.3, b.w - cw * 1.6);
          if (!F.clearsDoor(ctx, f, b.t, bw)) continue;
          F.box(ctx, f, b.t, plinthH + 0.16, bw, 0.32, PJ * 0.55, trimD);      // bulkhead
          F.box(ctx, f, b.t, (plinthH + 0.32 + winTop) / 2, bw,
            Math.max(0.3, winTop - plinthH - 0.32), PJ * 0.30, glass);         // plate glass
          // transom light band, divided into small panes by thin mullions
          const ty = winTop + transH / 2;
          F.box(ctx, f, b.t, ty, bw, transH * 0.86, PJ * 0.34, glass);
          const panes = Math.max(2, Math.round(bw / clamp(unit * 0.10, 0.7, 1.3)));
          for (let k = 0; k <= panes; k++)
            F.box(ctx, f, b.t - bw / 2 + (bw / panes) * k, ty, cw * 0.32, transH * 0.9, PJ * 0.44, trim);
        }
        // the colonnettes: a plinth block, a shaft, a moulded cap
        for (const t of lines) {
          if (!F.clearsDoor(ctx, f, t, cw * 2.2)) continue;
          F.box(ctx, f, t, plinthH + 0.22, cw * 1.9, 0.44, PJ * 0.95, trimD);          // plinth
          F.rib(ctx, f, t, plinthH + 0.44, winTop - 0.22, cw, PJ * 0.85, trim);        // shaft
          F.box(ctx, f, t, winTop - 0.10, cw * 1.8, 0.24, PJ * 1.05, trim);            // cap
          F.box(ctx, f, t, winTop + 0.06, cw * 1.35, 0.12, PJ * 0.95, trimD);
          // ONE face gets real turned iron: the entrance face, budget permitting
          if (f.s === ctx.doorSide && colBudget > 0 && colH > 0.9) {
            colBudget--;
            const nrm = f.halfN + PJ * 0.85;
            const cx = f.horiz ? t : f.out * nrm, cz = f.horiz ? f.out * nrm : t;
            ctx.column(cx, plinthH + 0.44, cz, cw * 0.46, colH - 0.66, trim, 8);
          }
        }
        // the continuous SIGNBOARD, edged top and bottom — the one flat
        // surface on the whole elevation, which is why it reads as lettering.
        const sy = groundH - signH / 2;
        F.band(ctx, f, sy, signH, PJ * 1.15, F.shade(bodyD, 0.74), 0.16);
        F.band(ctx, f, groundH - signH + 0.04, 0.14, PJ * 1.35, trim, 0.26);
        F.band(ctx, f, groundH - 0.07, 0.16, PJ * 1.45, trim, 0.30);
      }
      // a pair of gas lamps flanking the door — the shopfront's only lit thing
      if (e.f && groundH > 2.2) {
        const f = e.f, nrm = f.halfN + PJ * 1.6;
        for (const sg of [-1, 1]) {
          const t = sg * (e.gap / 2 + clamp(unit * 0.04, 0.35, 0.8));
          const lx = f.horiz ? t : f.out * nrm, lz = f.horiz ? f.out * nrm : t;
          F.box(ctx, f, t, groundH - signH - 0.5, 0.16, 0.5, PJ * 1.5, iron);
          ctx.lamp(lx, groundH - signH - 0.78, lz, clamp(unit * 0.018, 0.13, 0.24), 0xffd9a0);
        }
      }

      // ============================================================
      //  3. STRING COURSES + QUOINED CORNER PILASTERS
      // ============================================================
      // A moulded course is never one box: a fillet, a deep bed, a drip.
      function course(y, pj) {
        F.ring(ctx, y - 0.09, 0.14, pj * 0.80, trimD, 0.22);
        F.ring(ctx, y + 0.06, 0.16, pj, trim, 0.30);
        F.ring(ctx, y + 0.20, 0.10, pj * 0.66, trimD, 0.20);
      }
      // THE PAINTED FIELD. The host's wall colour is a neutral; a Second Empire
      // block is PAINTED, so each storey between the string courses gets a thin
      // skin of the body colour. Without this the polychromy is only in the
      // mouldings and the building reads as trim floating on a grey box.
      for (const f of faces) {
        for (let s = 1; s <= ST; s++) {
          const y0 = s * FH, y1 = Math.min(cornBase, (s + 1) * FH);
          if (y1 - y0 < 0.4) continue;
          F.rib(ctx, f, 0, y0 + 0.10, y1 - 0.10, f.span + 0.18, PJ * 0.16, s % 2 ? body : F.shade(body, 1.04));
        }
      }
      for (let s = 1; s < ST; s++) course(s * FH, PJ * 1.10);

      const qw = clamp(unit * 0.075, 0.55, 1.6);            // quoin length
      const qh = clamp(FH * 0.26, 0.4, 0.95);               // quoin course height
      {
        // the pilaster body, then alternating long/short blocks up its face
        F.corners(ctx, (plinthH + H) / 2, H - plinthH, qw * 0.82, PJ * 0.55, bodyD);
        let y = plinthH;
        let k = 0;
        while (y + qh < H) {
          const len = (k % 2) ? qw : qw * 0.62;
          F.corners(ctx, y + qh / 2, qh * 0.86, len, PJ * 0.95, k % 2 ? trim : trimD);
          y += qh; k++;
        }
      }

      // ============================================================
      //  4. WINDOW SURROUNDS on the middle storeys
      // ============================================================
      // Where the oriel will stand, so the flat windows step out of its way.
      const orielFaces = {};
      const oriels = [];
      if (ST >= 2) {
        const ef = e.f;
        const owFull = clamp(ef.span * 0.30, 2.2, ef.span * 0.42);
        // one centred oriel if the face is narrow, two flanking the door if wide
        if (ef.span >= owFull * 2 + e.gap + 1.2) {
          const off = e.gap / 2 + owFull / 2 + clamp(ef.span * 0.03, 0.3, 1.0);
          oriels.push({ f: ef, t: -off, w: owFull });
          oriels.push({ f: ef, t: off, w: owFull });
        } else {
          oriels.push({ f: ef, t: 0, w: Math.min(owFull, Math.max(1.6, ef.span - 1.6)) });
        }
        // a big block earns one on a flank too
        if (ST >= 4 && unit > 13) {
          const fl = F.flanks(ctx)[ctx.hash(0x0b17) < 0.5 ? 0 : 1];
          if (fl) oriels.push({ f: fl, t: 0, w: clamp(fl.span * 0.30, 2.0, fl.span * 0.4) });
        }
        for (const o of oriels) (orielFaces[o.f.s] = orielFaces[o.f.s] || []).push(o);
      }
      function orielFouls(f, t, wid) {
        const list = orielFaces[f.s];
        if (!list) return false;
        for (const o of list) if (Math.abs(t - o.t) < (o.w + wid) / 2 + 0.25) return true;
        return false;
      }

      for (const f of faces) {
        const n = F.bayCount(f, clamp(unit * 0.20, 2.8, 4.2), 2, 8);
        const marg = clamp(f.span * 0.085, 0.5, 1.4);
        for (let s = 1; s < ST; s++) {
          const y0 = s * FH;
          const ow = clamp(f.span / (n * 2.0), 0.8, 2.1);   // opening width
          const oh = clamp(FH * 0.52, 0.9, 2.6);            // opening height
          const sillY = y0 + clamp(FH * 0.24, 0.4, 1.1);
          const segArch = (s % 2) === 1;                    // alternate by floor
          for (const b of F.bays(f, n, marg)) {
            const wid = Math.min(ow, b.w * 0.62);
            if (orielFouls(f, b.t, wid)) continue;
            window1(ctx, F, f, b.t, sillY, wid, oh, segArch);
          }
        }
      }
      function window1(ctx, F, f, t, sillY, wid, oh, segArch) {
        const jw = clamp(wid * 0.17, 0.14, 0.40);           // architrave thickness
        const pj = PJ * 0.85;
        // the glass, then the moulded frame standing proud of it
        F.box(ctx, f, t, sillY + oh / 2, wid, oh, PJ * 0.28, glass);
        for (const sg of [-1, 1]) F.rib(ctx, f, t + sg * (wid / 2 + jw / 2), sillY, sillY + oh, jw, pj, trim);
        // SILL on two console brackets — the detail that gives a window weight
        F.box(ctx, f, t, sillY - 0.10, wid + jw * 3.0, 0.18, pj * 1.55, trim);
        F.box(ctx, f, t, sillY - 0.24, wid + jw * 2.2, 0.12, pj * 1.15, trimD);
        for (const sg of [-1, 1]) {
          F.box(ctx, f, t + sg * (wid / 2 - jw * 0.2), sillY - 0.44, jw * 0.9, 0.32, pj * 1.25, trim);
          F.box(ctx, f, t + sg * (wid / 2 - jw * 0.2), sillY - 0.62, jw * 0.7, 0.14, pj * 0.85, trimD);
        }
        // HEAD: a segmental arch on odd floors, a flat cornice on even ones
        if (segArch) {
          F.arch(ctx, f, t, sillY + oh, wid + jw * 1.4, clamp(oh * 0.30, 0.25, 0.9), jw * 0.8, pj * 1.1, trim, "segmental");
          F.box(ctx, f, t, sillY + oh + clamp(oh * 0.30, 0.25, 0.9) * 0.5, jw * 0.7, jw * 0.7, pj * 1.5, trimD); // keystone
        } else {
          F.box(ctx, f, t, sillY + oh + 0.10, wid + jw * 2.4, 0.20, pj * 1.25, trim);
          F.box(ctx, f, t, sillY + oh + 0.28, wid + jw * 3.4, 0.16, pj * 1.75, trim);
          F.box(ctx, f, t, sillY + oh + 0.42, wid + jw * 2.6, 0.12, pj * 1.35, trimD);
        }
      }

      // ============================================================
      //  5. THE ORIELS — three-facet projecting bays
      // ============================================================
      // The polygon is faked honestly: a wide centre facet at full projection
      // and two narrow returns at stepped-back projections, which from any
      // street angle reads as a canted bay and costs nothing to merge.
      const orielY0 = FH;                                    // springs off the storefront
      const orielY1 = Math.min(cornBase - clamp(FH * 0.10, 0.15, 0.5), orielY0 + FH * Math.max(1, ST - 1));
      for (const o of oriels) {
        const f = o.f;
        if (orielY1 - orielY0 < FH * 0.6) break;
        const OP = clamp(unit * 0.130, 0.9, 2.2);            // full projection
        const cwid = o.w * 0.52, rwid = o.w * 0.24;          // centre + return widths
        const facets = [
          { t: 0, w: cwid, p: OP },
          { t: -(cwid + rwid) / 2, w: rwid, p: OP * 0.62 },
          { t: (cwid + rwid) / 2, w: rwid, p: OP * 0.62 },
          { t: -(cwid / 2 + rwid * 0.95), w: rwid * 0.5, p: OP * 0.28 },
          { t: (cwid / 2 + rwid * 0.95), w: rwid * 0.5, p: OP * 0.28 },
        ];
        // BRACKETED BASE: a corbel that gathers the bay back into the wall
        for (const fc of facets) {
          const steps = 4;
          for (let i = 0; i < steps; i++) {
            const u = (i + 1) / steps;
            F.box(ctx, f, fc.t, orielY0 - clamp(FH * 0.42, 0.5, 1.5) * (1 - u) - 0.10,
              fc.w * (0.55 + u * 0.45), clamp(FH * 0.42, 0.5, 1.5) / steps + 0.03, fc.p * u, trim);
          }
        }
        // the bay wall, its glass, and a floor line across it per storey
        for (const fc of facets) {
          F.rib(ctx, f, fc.t, orielY0, orielY1, fc.w, fc.p, fc.p > OP * 0.8 ? body : F.shade(body, 0.92));
          for (let s = 1; s * FH < orielY1 - 0.2; s++) {
            const gy = (s - 1) * FH + FH + clamp(FH * 0.22, 0.35, 1.0);
            const gh = clamp(FH * 0.50, 0.8, 2.4);
            if (gy + gh > orielY1 - 0.2) break;
            F.box(ctx, f, fc.t, gy + gh / 2, fc.w * 0.76, gh, fc.p * 1.06, glass);
            for (const sg of [-1, 1])
              F.rib(ctx, f, fc.t + sg * fc.w * 0.42, gy, gy + gh, fc.w * 0.10, fc.p * 1.10, trim);
            F.box(ctx, f, fc.t, gy - 0.12, fc.w * 1.02, 0.16, fc.p * 1.14, trim);       // sill
            F.box(ctx, f, fc.t, gy + gh + 0.12, fc.w * 1.02, 0.16, fc.p * 1.14, trim);  // head
          }
        }
        // the bay's own ROOF CAP: two courses stepping in, plus a slate crown
        for (const fc of facets) {
          F.box(ctx, f, fc.t, orielY1 + 0.12, fc.w + 0.22, 0.22, fc.p * 1.16, trim);
          F.box(ctx, f, fc.t, orielY1 + 0.32, fc.w + 0.10, 0.18, fc.p * 1.00, trimD);
          F.box(ctx, f, fc.t, orielY1 + 0.50, fc.w * 0.86, 0.20, fc.p * 0.74, slate);
          F.box(ctx, f, fc.t, orielY1 + 0.68, fc.w * 0.62, 0.18, fc.p * 0.48, slate);
        }
      }

      // ============================================================
      //  6. THE BRACKETED CORNICE — deep, and unapologetic about it
      // ============================================================
      for (const f of faces) {
        // the frieze the brackets are applied to
        F.band(ctx, f, cornBase + braH / 2, braH, corD * 0.24, F.shade(body, 0.92), 0.14);
        // PAIRED SCROLL BRACKETS, closely spaced. Each is three stepped blocks
        // that grow as they rise, which is the shadow-profile of a scroll.
        const pitch = clamp(unit * 0.085, 0.62, 1.5);
        const nb = Math.max(3, Math.round((f.span - 0.4) / pitch));
        const bw = clamp((f.span / nb) * 0.26, 0.12, 0.42);
        for (let i = 0; i <= nb; i++) {
          const t = -f.span / 2 + (f.span / nb) * i;
          for (const sg of [-1, 1]) {
            const tt = t + sg * bw * 0.85;
            for (let k = 0; k < 3; k++) {
              const u = (k + 1) / 3;
              F.box(ctx, f, tt, cornBase + braH * (k + 0.5) / 3, bw, braH / 3 + 0.02, corD * (0.30 + u * 0.62), trim);
            }
          }
          F.box(ctx, f, t, cornBase + braH * 0.20, bw * 0.9, braH * 0.30, corD * 0.34, trimD); // drop between the pair
        }
        // DENTILS: a tight run of little blocks on the bracket heads
        const dn = Math.max(6, Math.round(f.span / clamp(unit * 0.035, 0.26, 0.55)));
        const dw = (f.span / dn) * 0.52;
        for (let i = 0; i <= dn; i++)
          F.box(ctx, f, -f.span / 2 + (f.span / dn) * i, cornBase + braH + 0.14, dw, 0.24, corD * 0.80, trimD);
        // THE MOULDED FASCIA + its crown mould: the deepest thing on the block
        F.band(ctx, f, cornBase + braH + 0.42, 0.34, corD * 0.92, trim, 0.34);
        F.band(ctx, f, cornBase + braH + 0.68, 0.22, corD * 1.00, trimD, 0.42);
        F.band(ctx, f, cornBase + braH + 0.88, 0.26, corD * 0.86, trim, 0.36);
        F.band(ctx, f, H - 0.10, 0.22, corD * 0.62, trimD, 0.28);
      }

      // ============================================================
      //  7. THE MANSARD — the top storey as a near-vertical slate slope
      // ============================================================
      // Built as stepped courses that walk INWARD as they rise. Nothing is
      // rotated: the step size is what makes the pitch, and 12 courses is
      // enough that at street distance the stagger reads as slate.
      const manH = clamp(FH * 1.18, 2.4, FH * 1.35);
      const manY0 = H;
      const inSet = clamp(manH * 0.32, 0.6, unit * 0.17);    // total inward run per side
      const courses = 12;
      const cW0 = W + PJ * 0.6, cD0 = D + PJ * 0.6;          // springs just proud of the wall
      function manInset(u) { return inSet * u; }             // u = 0..1 up the slope
      for (let i = 0; i < courses; i++) {
        const u0 = i / courses, u1 = (i + 1) / courses;
        const ins = manInset(u1);                            // the course sits at its TOP inset
        const cy = manY0 + manH * (u0 + u1) / 2;
        const col = (i % 3 === 1) ? slateL : (i % 3 === 2 ? F.shade(slate, 0.88) : slate);
        ctx.dbox(0, cy, 0, cW0 - ins * 2, manH / courses + 0.02, cD0 - ins * 2, col);
        // a thin lip on every third course: the slate lap line
        if (i % 3 === 0)
          ctx.dbox(0, manY0 + manH * u0 + 0.03, 0, cW0 - ins * 2 + 0.10, 0.07, cD0 - ins * 2 + 0.10, F.shade(slate, 0.72));
      }
      // hip ribs down the four mansard corners, so it reads as a hipped roof
      {
        const ribW = clamp(unit * 0.035, 0.16, 0.42);
        for (let i = 0; i < courses; i++) {
          const u1 = (i + 1) / courses, ins = manInset(u1);
          const cy = manY0 + manH * (i + 0.5) / courses;
          const hw = (cW0 - ins * 2) / 2, hd = (cD0 - ins * 2) / 2;
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            ctx.dbox(sx * hw, cy, sz * hd, ribW * 1.6, manH / courses + 0.02, ribW * 1.6, trimD);
          }
        }
      }
      // THE DECK, and the iron cresting rail that finishes the whole building
      const deckY = manY0 + manH;
      const dW = cW0 - inSet * 2, dD = cD0 - inSet * 2;
      ctx.dbox(0, deckY + 0.10, 0, dW + 0.26, 0.20, dD + 0.26, trim);      // deck cornice
      ctx.dbox(0, deckY + 0.26, 0, dW - 0.10, 0.14, dD - 0.10, F.shade(slate, 0.94));
      {
        const railY = deckY + 0.34;
        const railH = clamp(manH * 0.20, 0.32, 0.85);
        const postPitch = clamp(unit * 0.11, 0.55, 1.4);
        for (const ax of [0, 1]) {
          const len = ax ? dD : dW, other = (ax ? dW : dD) / 2 - 0.02;
          const np = Math.max(2, Math.round(len / postPitch));
          for (const sg of [-1, 1]) {
            for (let i = 0; i <= np; i++) {
              const t = -len / 2 + (len / np) * i;
              const px = ax ? sg * other : t, pz = ax ? t : sg * other;
              ctx.dbox(px, railY + railH / 2, pz, 0.09, railH, 0.09, iron);
              ctx.dbox(px, railY + railH * 0.62, pz, 0.16, 0.09, 0.16, iron);   // finial bud
            }
            // top and bottom rails
            const rx = ax ? sg * other : 0, rz = ax ? 0 : sg * other;
            ctx.dbox(rx, railY + railH, rz, ax ? 0.07 : len, 0.08, ax ? len : 0.07, iron);
            ctx.dbox(rx, railY + railH * 0.34, rz, ax ? 0.06 : len, 0.06, ax ? len : 0.06, iron);
          }
        }
        // four corner finials: the only real meshes the roof spends
        const fr = clamp(unit * 0.022, 0.12, 0.26);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          ctx.dbox(sx * (dW / 2 - 0.02), railY + railH * 0.6, sz * (dD / 2 - 0.02), 0.16, railH * 1.2, 0.16, iron);
          ctx.ball(sx * (dW / 2 - 0.02), railY + railH * 1.24 + fr, sz * (dD / 2 - 0.02), fr, iron);
        }
      }

      // ============================================================
      //  8. DORMERS — pushed clearly PROUD of the mansard slope
      // ============================================================
      // Each dormer's front plane is computed from the slope inset at its own
      // TOP, then pushed out past the slope's foot, so it can never sink in.
      const dorH = manH * 0.66;
      const dorY0 = manY0 + manH * 0.10;
      const uTop = (dorY0 + dorH - manY0) / manH;
      for (const f of faces) {
        const per = clamp(unit * 0.30, 3.0, 5.4);
        const nd = clamp(Math.round(f.span / per), 2, 5);
        const nDorm = (f.s === ctx.doorSide) ? clamp(nd, 3, 5) : clamp(nd - 1, 2, 4);
        const half = (f.horiz ? cD0 : cW0) / 2;
        const spanUse = (f.horiz ? cW0 : cD0) - inSet * 2 - 0.6;
        const dw = clamp(spanUse / (nDorm * 2.25), 0.8, 2.1);
        // the front plane: outside the slope at every height it touches
        const frontN = half - manInset(uTop) + clamp(unit * 0.075, 0.5, 1.2);
        for (let i = 0; i < nDorm; i++) {
          const t = -spanUse / 2 + (spanUse / nDorm) * (i + 0.5);
          dormer(ctx, F, f, t, dorY0, dw, dorH, frontN, half);
        }
      }
      function dormer(ctx, F, f, t, y0, dw, dh, frontN, half) {
        // depth measured back from the front plane into the slope foot
        const dep = Math.max(0.3, frontN - (half - inSet) + 0.25);
        const put = function (tt, cy, len, h, depth, frontOff, col) {
          const n = frontN + (frontOff || 0) - depth / 2;
          if (f.horiz) ctx.dbox(tt, cy, f.out * n, len, h, depth, col);
          else ctx.dbox(f.out * n, cy, tt, depth, h, len, col);
        };
        const jw = clamp(dw * 0.16, 0.12, 0.34);
        put(t, y0 + dh / 2, dw + jw * 2, dh, dep, 0, slateL);                     // the cheeks/body
        put(t, y0 + dh / 2, dw + jw * 2 + 0.10, dh * 0.94, dep * 0.32, 0, trim);  // painted front frame
        put(t, y0 + dh * 0.52, dw * 0.86, dh * 0.66, dep * 0.20, 0.06, glass);    // the sash
        for (const sg of [-1, 1])                                                 // jambs
          put(t + sg * (dw / 2 + jw * 0.3), y0 + dh * 0.52, jw * 0.9, dh * 0.72, dep * 0.30, 0.10, trim);
        put(t, y0 + dh * 0.16, dw + jw * 3.0, 0.18, dep * 0.42, 0.16, trim);      // projecting sill
        put(t, y0 + dh * 0.06, dw + jw * 2.0, 0.12, dep * 0.34, 0.10, trimD);
        // the HOOD: a stepped pediment, three diminishing courses to a peak
        const hy = y0 + dh * 0.90;
        put(t, hy, dw + jw * 3.6, 0.22, dep * 0.50, 0.20, trim);
        for (let k = 0; k < 3; k++) {
          const u = (k + 1) / 3;
          put(t, hy + 0.16 + k * 0.20, (dw + jw * 3.0) * (1 - u * 0.55), 0.20, dep * (0.46 - k * 0.09), 0.16 - k * 0.03,
            k === 1 ? trimD : trim);
        }
        put(t, hy + 0.80, jw * 1.1, 0.26, dep * 0.26, 0.10, iron);                // little crest spike
      }
    },
  });
})();
