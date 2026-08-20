/* ============================================================
   city/facades/postmodern.js — "Broken Pediment", 1984.

   THE READ. Philip Johnson's AT&T Building answered the glass box with an
   argument, not a gesture: a granite-clad tower with PUNCHED windows in a
   solid masonry wall, a monumental round-headed portal at the street, and a
   Chippendale-cabinet top with a circular notch bitten out of its apex. The
   joke only lands if the building is dignified, so nothing here is played for
   laughs — every element is drawn the way a 1910 stone tower would draw it,
   at 1984 scale.

   BANDING (rule one: a storey is 2.5 percent of a 128 m elevation, so the
   detail is organised into four zones and repeated cheaply only inside one):

     PODIUM      The bottom sixth: a giant arcade. One round-headed portal
                 5-7 storeys tall on the entrance face, flanked by tall
                 square-headed openings, the whole thing standing on a plinth
                 and finished with a real cornice. This is the only part a
                 player on foot ever touches, so it is detailed as a street
                 wall in its own right (rule three).
     SHAFT       Plain granite with punched windows: one opening per bay per
                 storey, each with a bronze reveal, jambs, a sill and a
                 lintel, separated by solid pier strips. Four merged boxes per
                 window is the entire per-storey spend; the piers and the
                 corner pilasters are emitted ONCE full height.
     ATTIC       Two blank storeys under a heavy cornice, where the corner
                 pilasters take their capitals. The quiet band that lets the
                 crown read as a separate object.
     CROWN       The signature. A giant pediment standing on the roofline,
                 built as stepped courses whose half-width shrinks to an apex,
                 with a SEMICIRCULAR NOTCH voided out of the centre: a round
                 head below, vertical sides above, so the pediment is broken
                 open at the top. It is deliberately enormous — most of the
                 face width and five-ish storeys tall — because at this scale
                 a timid version reads as a construction error. The courses
                 also taper in depth, so the flanks read as a stepped gable
                 and the silhouette is a triangle with a bite out of it from
                 every direction (rule two).

   COLOUR is anchored to real mid values, never derived by lightening the
   host: this renderer clips above about 0x99 and a pink granite that washes
   out is a white blob. Warm pink-grey wall, a lighter dry tone for cornices
   and the pediment courses, dark bronze reveals as the darkest thing here.

   BUDGET. Everything is ctx.dbox (merged, free). No real meshes are minted at
   all, so a dressed tower is the same draw-call count as a bare one.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("postmodern", {
    label: "Broken Pediment",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a 1980s pomo block is a concrete frame in applied stone.
    structure: "concrete",
    crownsRoof: true,
    minStoreys: 14,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = ctx.storeys;
      const W = ctx.w, D = ctx.d;
      const smallest = Math.min(W, D);
      const faces = F.faces(ctx);
      const e = F.entrance(ctx);
      const ef = e.f;

      // ---------------- palette ----------------
      // Warm pink-grey granite. The host colour is mixed in only lightly so
      // two of these on one street differ without either leaving the family.
      // MEASURED off the first render: at 0x8a7168 with a PALE mixed up to
      // 0x92 the whole tower came back paper white and every reveal with it.
      // The wall lands near 0x6b and the crown gets the only light values.
      const GRAN = F.mix(0x6e574f, ctx.color | 0, 0.12);
      const PALE = F.mix(GRAN, 0x8b7d72, 0.66);       // cornices, pediment courses
      const LITE = F.mix(PALE, 0x998c80, 0.60);       // the lit top lip of a cornice
      const MIDT = F.shade(GRAN, 0.80);               // pier flanks, coursing
      const DEEP = F.shade(GRAN, 0.45);               // recesses, soffits
      const BRNZ = F.mix(0x2c241d, GRAN, 0.10);       // window reveals: darkest thing
      const GLAS = F.mix(0x1a1a1e, GRAN, 0.14);

      // ---------------- the four bands ----------------
      // Solved top-down off the roofline so nothing is a metre constant.
      const yBase = Math.max(FH * 3.2, Math.min(H * 0.17, FH * 7));   // arcade head
      const atticH = Math.min(FH * 2.2, H * 0.08);
      const yAttic = H - atticH;                                      // shaft head
      const CORN = Math.max(0.5, Math.min(FH * 0.5, smallest * 0.06)); // cornice projection
      const WP = Math.max(0.16, Math.min(0.34, smallest * 0.012));    // wall plane proud

      // ONE bay rhythm for the whole tower, per face: a masonry bay is wide,
      // about one per 4.2 m, so the piers between them stay solid.
      function bayN(f) { return F.bayCount(f, 4.6, 3, 9); }
      function margin(f) { return Math.max(1.0, f.span * 0.06); }

      // ================================================================
      //  1. THE GRANITE WALL — one plane, so the tower is one material
      // ================================================================
      for (const f of faces) {
        F.band(ctx, f, (yBase + yAttic) / 2, yAttic - yBase, WP, GRAN, 0.14, 0);
        F.band(ctx, f, yAttic + atticH / 2, atticH, WP, GRAN, 0.14, 0);
      }

      // ================================================================
      //  2. THE SHAFT — punched windows in solid wall, piers between
      // ================================================================
      // A punched window is a HOLE: dark glass set back, a bronze reveal ring
      // around it, a stone sill under it and a lintel over it. FOUR boxes, and
      // the count is the whole budget story: the measured sheet came back at
      // 242 boxes per storey with a fifth head-shadow box and a 4.2 m bay, so
      // the shadow went and the bay widened, which is also the more correct
      // masonry rhythm.
      function punched(f, t, y0, wid, hgt) {
        const cy = y0 + hgt / 2;
        F.box(ctx, f, t, cy, wid, hgt, WP * 0.35, GLAS, 0);                       // glass, set back
        F.box(ctx, f, t, cy, wid + 0.30, hgt + 0.30, WP * 0.62, BRNZ, 0);          // the reveal
        F.box(ctx, f, t, y0 - 0.20, wid + 0.85, 0.30, WP + 0.20, PALE, 0);         // sill
        F.box(ctx, f, t, y0 + hgt + 0.20, wid + 0.85, 0.28, WP + 0.14, PALE, 0);   // lintel
      }

      const rows0 = Math.ceil(yBase / FH);
      const rows1 = Math.floor((yAttic - FH * 0.2) / FH) - 1;
      for (const f of faces) {
        const n = bayN(f);
        const bays = F.bays(f, n, margin(f));
        const lines = F.bayLines(f, n, margin(f));
        // the solid pier strips: emitted ONCE, full shaft height
        const pw = Math.max(0.7, Math.min(FH * 0.42, f.span / (n * 2.6)));
        for (let i = 0; i < lines.length; i++) {
          F.rib(ctx, f, lines[i], yBase + 0.2, yAttic + atticH - 0.1, pw, WP + 0.22,
            i % 2 ? MIDT : GRAN, 0);
        }
        for (let k = rows0; k <= rows1; k++) {
          for (const b of bays) {
            const wid = Math.min(b.w * 0.62, FH * 1.35);
            const hgt = FH * 0.60;
            const y0 = k * FH + FH * 0.28;
            if (wid < 0.6) continue;
            punched(f, b.t, y0, wid, hgt);
          }
        }
      }

      // CORNER PILASTER STRIPS. Slightly proud, full shaft height, ending in a
      // plain capital at the attic cornice: the vertical that ties the four
      // elevations into one block.
      {
        const pl = Math.max(1.1, Math.min(smallest * 0.10, FH * 1.1));
        const pp = WP + 0.30;
        F.corners(ctx, (yBase + yAttic + atticH) / 2 + 0.1, yAttic + atticH - yBase - 0.4, pl, pp, MIDT);
        F.corners(ctx, yAttic - 0.42, 0.84, pl + 0.5, pp + 0.22, PALE);              // capital
        F.corners(ctx, yBase + 0.30, 0.60, pl + 0.4, pp + 0.16, PALE);               // base of the strip
      }

      // ================================================================
      //  3. THE PODIUM — a giant arcade, and the portal
      // ================================================================
      // The bottom band gets its own wall plane, one step proud of the shaft,
      // so the base is visibly a different building.
      const BP = WP + Math.max(0.35, smallest * 0.02);
      for (const f of faces) {
        F.band(ctx, f, yBase / 2, yBase, BP, GRAN, 0.18, 0);
        // ashlar coursing, coarse: three or four joints over the whole base,
        // enough to say "cut stone" at eye level and invisible from far off.
        const nj = Math.max(3, Math.round(yBase / (FH * 1.15)));
        for (let i = 1; i < nj; i++)
          F.box(ctx, f, 0, (i * yBase) / nj, f.span + 0.2, 0.10, BP + 0.05, DEEP, 0);
      }
      // plinth
      F.ring(ctx, 0.35, 0.70, BP + 0.34, PALE, 0.6, 0);
      F.ring(ctx, 0.74, 0.14, BP + 0.24, MIDT, 0.5, 0);

      // THE ARCADE. Every face gets tall square-headed openings on the bay
      // rhythm; the entrance face's centre becomes the round-headed portal.
      const arcY0 = yBase * 0.16;
      const arcY1 = yBase * 0.80;
      for (const f of faces) {
        const n = bayN(f);
        const bays = F.bays(f, n, margin(f));
        for (const b of bays) {
          const wid = Math.min(b.w * 0.56, (arcY1 - arcY0) * 0.55);
          if (wid < 0.7) continue;
          if (!F.clearsDoor(ctx, f, b.t, wid + 2.0)) continue;
          // a recessed dark void with a bronze head band: the arcade opening
          F.box(ctx, f, b.t, (arcY0 + arcY1) / 2, wid, arcY1 - arcY0, BP * 0.30, GLAS, 0);
          F.box(ctx, f, b.t, (arcY0 + arcY1) / 2, wid + 0.36, arcY1 - arcY0 + 0.36, BP * 0.62, BRNZ, 0);
          F.box(ctx, f, b.t, arcY1 + 0.34, wid + 1.0, 0.44, BP + 0.16, PALE, 0);
          F.box(ctx, f, b.t, arcY0 - 0.26, wid + 1.0, 0.36, BP + 0.22, PALE, 0);
        }
      }

      // THE PORTAL. A single round-headed arch, several storeys tall, deeply
      // recessed on the entrance face. The second-most recognisable thing on
      // the building, so it is sized to eat most of the base.
      {
        const pw = Math.min(ef.span * 0.42, yBase * 0.62, e.gap + FH * 2.6);
        const spring = Math.min(yBase * 0.52, yBase - pw * 0.55 - 0.8);
        const rise = Math.min(pw * 0.52, yBase - spring - 0.6);
        if (pw > 2.4 && spring > e.head && rise > 0.5) {
          // the deep recess itself: a dark void the full height of the portal
          F.box(ctx, ef, 0, spring / 2, pw, spring, BP * 0.18, DEEP, 0);
          F.box(ctx, ef, 0, spring + rise * 0.45, pw * 0.86, rise * 0.9, BP * 0.18, DEEP, 0);
          // a shadow gasket around the void so it reads as depth, not paint
          F.box(ctx, ef, 0, spring / 2, pw + 0.5, spring, BP * 0.40, F.shade(DEEP, 0.7), 0);
          // the arch head, in stone, with an oversized keystone
          F.arch(ctx, ef, 0, spring, pw, rise, 0.30, BP + 0.26, PALE, "round");
          F.box(ctx, ef, 0, spring + rise * 0.92, pw * 0.16, rise * 0.78, BP + 0.44, PALE, 0);
          // the jambs: two heavy piers that make the opening a hole in a wall
          for (const sg of [-1, 1]) {
            F.rib(ctx, ef, sg * (pw / 2 + 0.55), 0.6, spring + 0.25, 1.1, BP + 0.26, PALE, 0);
            F.box(ctx, ef, sg * (pw / 2 + 0.55), spring + 0.20, 1.5, 0.34, BP + 0.36, PALE, 0);
          }
          // the doorway inside the portal, held clear of the door itself
          F.box(ctx, ef, 0, e.head * 0.5, e.gap + 1.6, e.head, BP * 0.12, GLAS, 0);
          F.box(ctx, ef, 0, e.head + 0.28, e.gap + 2.4, 0.36, BP * 0.55, PALE, 0);
        }
      }

      // THE PODIUM CORNICE: the real horizontal that ends the base.
      F.ring(ctx, yBase + 0.30, 0.60, CORN * 0.95, PALE, 0.6, 0);
      F.ring(ctx, yBase + 0.66, 0.18, CORN * 0.78, LITE, 0.5, 0);
      F.ring(ctx, yBase + 0.02, 0.16, CORN * 0.62, DEEP, 0.5, 0);

      // ================================================================
      //  4. THE ATTIC CORNICE — the line the crown stands on
      // ================================================================
      F.ring(ctx, yAttic + 0.16, 0.32, CORN * 0.55, PALE, 0.5, 0);
      F.ring(ctx, H - CORN * 0.55, CORN * 0.80, CORN, PALE, 0.7, 0);
      F.ring(ctx, H - 0.10, 0.22, CORN * 0.82, LITE, 0.6, 0);
      F.ring(ctx, H - CORN * 1.02, 0.16, CORN * 0.60, DEEP, 0.6, 0);
      // the attic's own blind panels, one per bay: quiet, but not blank
      for (const f of faces) {
        for (const b of F.bays(f, bayN(f), margin(f))) {
          F.box(ctx, f, b.t, yAttic + atticH * 0.52, b.w * 0.5, atticH * 0.42, WP + 0.10, MIDT, 0);
          F.box(ctx, f, b.t, yAttic + atticH * 0.52, b.w * 0.5 - 0.3, atticH * 0.42 - 0.3, WP + 0.16, DEEP, 0);
        }
      }

      // ================================================================
      //  5. THE BROKEN PEDIMENT — the crown
      // ================================================================
      // Stepped courses standing on the roofline. Half-width shrinks toward an
      // apex; depth shrinks more slowly so the flanks read as a stepped gable.
      // A semicircular notch is voided out of the centre — round head below,
      // vertical sides above — so the pediment is broken open at the top.
      {
        // The first render's crown was a polite little stepped cap: too short,
        // tapered as hard in depth as in width (so it read as a pyramid, not a
        // pediment) and with a notch too small to see. All three are corrected
        // here — a fifth of the tower's height, almost no depth taper, and a
        // notch a quarter of the width across.
        // PITCH IS TIED TO THE FACE WIDTH, not only to the height: the third
        // render made a 26 m tower wear a 14 m pediment and it read as a
        // pagoda. A pediment is a BROAD triangle — capping the rise near half
        // the width keeps the classical slope on any plan.
        const pedH = Math.max(FH * 3.6, Math.min(H * 0.17, W * 0.46, FH * 7));
        const ov = Math.max(0.4, Math.min(smallest * 0.05, 1.4));   // oversail past the wall
        const steps = Math.max(10, Math.min(18, Math.round(pedH / (FH * 0.55))));
        const sh = pedH / steps;
        const y0 = H + 0.25;
        const halfW0 = W / 2 + ov, halfD0 = D / 2 + ov;
        const R = Math.min(W * 0.32, pedH * 0.62);
        const yN = y0 + pedH * 0.40;                 // centre of the notch's round head

        // the pediment's own plinth: a heavy course the whole thing sits on
        ctx.dbox(0, y0 - 0.28, 0, W + ov * 2.4, 0.56, D + ov * 2.4, PALE);
        ctx.dbox(0, y0 - 0.60, 0, W + ov * 2.0, 0.20, D + ov * 2.0, DEEP);

        for (let i = 0; i < steps; i++) {
          const u = (i + 0.5) / steps;
          const y = y0 + (i + 0.5) * sh;
          // the raking profile: nearly to a point, but the last course keeps a
          // little width so the apex is a cut stone and not a needle.
          const hw = halfW0 * (1 - u * 0.92);
          const hd = halfD0 * (1 - u * 0.16);   // the flanks are a stepped gable, not a hip
          const dy = y - yN;
          let gap = 0;
          if (dy >= 0) gap = R;                                  // vertical sides above
          else if (dy > -R) gap = Math.sqrt(R * R - dy * dy);    // the round head below
          if (hw - gap > 0.35) {
            for (const sg of [-1, 1]) {
              const c = sg * (gap + hw) / 2, len = hw - gap;
              ctx.dbox(c, y, 0, len, sh + 0.02, hd * 2, i % 2 ? PALE : F.mix(PALE, GRAN, 0.35));
              // the raking edge: a lit lip on the outer end of every course,
              // which is what makes the steps read as a slope and not stripes
              ctx.dbox(sg * (hw - 0.16), y + sh * 0.40, 0, 0.34, sh * 0.22, hd * 2 + 0.3, LITE);
              // and the notch's own jamb, so the void has a cut edge
              if (gap > 0.2) ctx.dbox(sg * (gap + 0.20), y, 0, 0.40, sh * 0.94, hd * 2 + 0.24, MIDT);
            }
            // the notch's back wall, set well in, so the bite is a recess
            // The second render proved the notch invisible: its back wall ran
            // the full depth in a stone tone, so the bite read as solid. It is
            // now a genuinely SET-BACK plate in the darkest colour on the
            // building, which is the only way a void reads in merged boxes.
            if (gap > 0.2) ctx.dbox(0, y, 0, gap * 2 - 0.2, sh + 0.02, hd * 0.55, BRNZ);
          } else if (gap > 0.2) {
            // above the break the pediment is gone; nothing is drawn. That
            // void IS the joke, played straight.
          }
          // horizontal course joint, so the crown reads as masonry
          ctx.dbox(0, y - sh / 2, 0, Math.max(0.2, hw * 2), 0.10, hd * 2 + 0.34, MIDT);
        }

        // the tympanum wall behind the pediment on the front and back: without
        // it the courses look like a fin standing on an empty roof.
        const tH = pedH * 0.34;
        ctx.dbox(0, y0 + tH / 2, 0, W * 0.92, tH, D * 0.92, F.mix(GRAN, PALE, 0.35));
        // a lunette in the tympanum, centred under the notch — a round-headed
        // opening that rhymes with the portal five hundred feet below.
        for (const f of faces) {
          const lw = Math.min(f.span * 0.30, tH * 0.9);
          F.box(ctx, f, 0, y0 + tH * 0.34, lw, tH * 0.5, 0.30, BRNZ, 0);
          F.arch(ctx, f, 0, y0 + tH * 0.59, lw, tH * 0.34, 0.22, 0.34, PALE, "round");
        }
      }
    },
  });
})();
