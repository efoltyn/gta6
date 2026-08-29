/* ============================================================
   city/facades/brick.js — "Chicago Loft": the load-bearing brick
   commercial block, c. 1905.

   WHAT IS BEING MODELLED. Not a brick texture — a brick STRUCTURE. In a
   pre-steel commercial block the outer wall carries the floors, so the wall
   is organised as a row of masonry PIERS with the openings punched between
   them. Everything this file draws exists because that one fact is true:

     PIERS      full-height, slightly proud, one per bay line (count from
                F.bayCount, so a 10 m shop gets 3 and a 40 m block gets 9).
                They are the load path; they read as structure, not wrapper.
     SPANDRELS  the brick infill under each window, held BACK from the pier
                face and a shade darker, so the piers stay in front and the
                wall reads as frame-plus-panel instead of as one flat sheet.
     SILL and   a stone course on every floor line (where the window sills
     BELT       actually sit) and a heavier belt at the second floor, which
                is where the commercial ground storey ends and the loft
                floors begin. The belt is the horizontal that stops the
                piers from reading as an unbroken cage.
     SEGMENTAL  the cheap 1905 way to span an opening in brick: a shallow
     ARCHES     brick arch with a stone keystone. Upper floors only — the
                ground storey spans its openings with iron, not brick.
     CORBELLED  the signature. Brick has no cheap way to make a cornice, so
     CORNICE    the mason simply steps three courses further out, one on
                top of the next, over a row of projecting header teeth
                (dentils). It is the whole reason these blocks have a top.
     PARAPET    brick standing above the roof deck with stone coping — the
                fire wall every party-wall block is required to have, and
                the thing that gives the silhouette a clean edge.
     STOREFRONT cast iron on the door face: a continuous lintel beam on slim
                columns, plate glazing to the sidewalk and a transom band.
                Iron is why the ground floor can be nearly all glass while
                the brick above it is nearly all wall.
     FIRE       steel, bolted to one flank, deterministic side by hash:
     ESCAPE     landings on the floor lines, diagonal stair stringers with
                treads, and railings. The one element that reads as
                "loft building" from 200 m away.

   Every dimension comes from ctx.w / ctx.d / ctx.storeys / ctx.FH / ctx.rTop
   or a face span. Nothing but dbox is emitted, so the whole block folds into
   the host's merged trim buckets and costs zero extra draw calls.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("brick", {
    label: "Chicago Loft",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a Chicago loft is load-bearing brick on heavy timber.
    structure: "brick",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), rTop = ctx.rTop;
      const small = Math.min(ctx.w, ctx.d);

      // ---- palette: warm red-brown brick, pale limestone trim ----
      const base = (ctx.pal && ctx.pal.wall) || ctx.color;
      const brick = F.mix(base, 0x77301c, 0.88 + ctx.hash(0x8b01) * 0.08);
      const brickD = F.shade(brick, 0.80);      // spandrel / shadowed infill
      const brickL = F.shade(brick, 1.10);      // corbel courses catch the sun
      const stone = F.mix(0xd9d3bf, base, 0.14);
      const stoneD = F.shade(stone, 0.88);
      const iron = 0x2c3036;
      const glass = 0x1c2630;

      // ---- the structural grid -----------------------------------
      // one bay per ~3.6 m of face, so bay width stays near-constant while the
      // COUNT changes with the building. Piers are a third of a bay.
      const PIER_PER = 3.6;
      const pierProj = Math.max(0.16, Math.min(0.40, small * 0.018));
      const panelProj = pierProj * 0.34;        // spandrels sit behind the piers
      const margin = Math.max(0.5, small * 0.05);
      const courseH = Math.max(0.14, FH * 0.075);

      const faces = F.faces(ctx);
      const ent = F.entrance(ctx);
      const groundTop = FH;                     // top of the commercial storey

      // window opening inside a bay, floor k
      function winOf(bay, k) {
        const y0 = k * FH;
        return { sill: y0 + FH * (k === 0 ? 0.30 : 0.26),
          head: y0 + FH * 0.80,
          wid: bay.w * 0.66, t: bay.t };
      }

      // ============================================================
      //  1. WALL: piers, spandrels, arches, courses
      // ============================================================
      for (const f of faces) {
        const n = F.bayCount(f, PIER_PER, 2, 9);
        const bays = F.bays(f, n, margin);
        const lines = F.bayLines(f, n, margin);
        const step = bays.length ? bays[0].w : f.span;
        const pierW = Math.max(0.42, Math.min(step * 0.34, 1.5));
        const isDoorFace = (f.s === ctx.doorSide);

        // --- the piers. They run from the sidewalk to the corbel table, so
        // the eye can follow one line of brick all the way up.
        const pierTop = rTop - courseH * 3.2;
        for (const t of lines) {
          // on the door face the iron storefront replaces brick below the
          // belt, so those piers start at the belt instead of the ground.
          const y0 = (isDoorFace && ST > 1) ? groundTop : 0;
          F.rib(ctx, f, t, y0, pierTop, pierW, pierProj, brick);
        }

        // --- the corner returns. F.bays keeps the end bay off the corner, so
        // without these the brick would stop short and the pale structural
        // wall would show as a stripe down each arris.
        for (const sg of [-1, 1]) {
          const t = sg * (f.span / 2 - margin / 2);
          F.rib(ctx, f, t, (isDoorFace && ST > 1) ? groundTop : 0, pierTop,
            margin + pierW * 0.3, pierProj, brick);
        }

        // --- the brick lapping OVER each opening, floor line to window head.
        // Together with the piers and the spandrels this leaves only the
        // openings themselves as bare wall, so the block reads as brick.
        for (let k = 0; k < ST; k++) {
          if (k === 0 && isDoorFace && ST > 1) continue;
          const w0 = winOf(bays.length ? bays[0] : { t: 0, w: f.span }, k);
          const y1 = Math.min((k + 1) * FH - FH * 0.14, rTop);
          if (y1 - w0.head > 0.15)
            F.band(ctx, f, (w0.head + y1) / 2, y1 - w0.head, panelProj, brickD, 0.16);
        }

        // --- spandrel panels + window heads, bay by bay, floor by floor
        for (const bay of bays) {
          for (let k = 0; k < ST; k++) {
            const win = winOf(bay, k);
            const ground = (k === 0);
            if (ground && isDoorFace && ST > 1) continue;      // iron front below
            if (ground && !F.clearsDoor(ctx, f, bay.t, bay.w * 0.5)) continue;

            // the brick infill UNDER the window: from the floor line down a
            // little (it laps the beam) up to the sill.
            const sp0 = Math.max(0.15, k * FH - FH * 0.14);
            if (win.sill - sp0 > 0.2)
              F.box(ctx, f, bay.t, (sp0 + win.sill) / 2, bay.w * 0.90,
                win.sill - sp0, panelProj, brickD);

            // stone sill, sitting proud of the panel
            F.box(ctx, f, bay.t, win.sill + courseH * 0.3, win.wid + pierW * 0.35,
              courseH * 0.55, pierProj * 0.8, stone);

            // upper openings get a segmental brick arch and a keystone;
            // the ground storey is spanned in iron, not brick.
            if (!ground) {
              const rise = Math.min(FH * 0.16, win.wid * 0.30);
              F.arch(ctx, f, win.t, win.head, win.wid, rise,
                courseH * 0.6, pierProj * 0.78, brickL, "segmental");
              F.box(ctx, f, win.t, win.head + rise * 0.72, pierW * 0.42,
                rise * 1.15, pierProj * 0.95, stone);           // keystone
            } else if (!isDoorFace) {
              // a plain stone lintel over the ground openings of the flanks
              F.box(ctx, f, win.t, win.head + courseH * 0.5, win.wid + pierW * 0.6,
                courseH, pierProj * 0.9, stone);
            }
          }
        }
      }

      // --- the horizontal courses, drawn as rings so the four faces meet
      for (let k = 1; k < ST; k++) {
        F.ring(ctx, k * FH - FH * 0.10, courseH * 0.45, pierProj * 0.5, stoneD, 0.24);
      }
      if (ST > 1) {
        // THE BELT at the second floor: the heavy line under the loft floors.
        F.ring(ctx, groundTop + courseH * 0.2, courseH * 1.7, pierProj * 1.25, stone, 0.4);
        F.ring(ctx, groundTop - courseH * 1.1, courseH * 0.55, pierProj * 0.7, brickD, 0.3);
      }
      // a water-table plinth so the wall lands on something
      F.ring(ctx, courseH * 0.9, courseH * 1.8, pierProj * 1.1, stoneD, 0.3);

      // ============================================================
      //  2. THE CORBELLED CORNICE — three stepped courses over dentils
      // ============================================================
      {
        const dentH = courseH * 0.85;
        const dentY = rTop - courseH * 3.2 - dentH * 0.5;
        for (const f of faces) {
          // the tooth row: a projecting header brick every half-metre-ish,
          // count derived from the span so the teeth stay the same size.
          const teeth = Math.max(6, Math.round(f.span / Math.max(0.45, small * 0.045)));
          const tw = (f.span / teeth) * 0.55;
          F.merlons(ctx, f, dentY, teeth, tw, dentH, pierProj * 1.15, brickL);
        }
        // three courses, each stepping further out than the one below
        for (let i = 0; i < 3; i++) {
          const cy = rTop - courseH * (2.6 - i * 1.0);
          const pr = pierProj * (1.35 + i * 0.55);
          F.ring(ctx, cy, courseH * 0.95, pr, i === 2 ? stone : F.shade(brickL, 1 - i * 0.03), 0.5);
        }
      }

      // ============================================================
      //  3. THE PARAPET — brick fire wall with stone coping
      // ============================================================
      {
        const ph = Math.max(FH * 0.42, Math.min(FH * 0.62, 2.2));
        const pt = Math.max(0.3, pierProj * 1.1);
        F.parapet(ctx, ph, pt, brick, stone);
        // a shallow raised centre panel on the street face — the place the
        // block's date or name went. Kept below the coping.
        const fD = F.face(ctx, ctx.doorSide);
        F.box(ctx, fD, 0, rTop + ph * 0.55, Math.min(fD.span * 0.34, fD.span - margin * 2),
          ph * 0.6, pt * 0.5, brickD, -pt * 0.5 + pt);
      }

      // ============================================================
      //  4. THE CAST-IRON STOREFRONT (door face, ground storey)
      // ============================================================
      {
        const f = F.face(ctx, ctx.doorSide);
        const top = Math.min(groundTop - courseH * 1.6, FH * 0.88);
        const lintelY = top - courseH * 1.2;                 // beam under transom
        const cill = courseH * 1.9;                          // bulkhead height
        const n = F.bayCount(f, PIER_PER * 0.72, 3, 12);
        const bays = F.bays(f, n, margin);
        const colW = Math.max(0.22, Math.min(0.46, f.span * 0.02));
        const proj = pierProj * 0.7;

        // continuous lintel beam + transom band above it
        F.band(ctx, f, lintelY, courseH * 1.25, proj * 1.5, iron, 0.1);
        F.band(ctx, f, (lintelY + top) / 2 + courseH * 0.62, top - lintelY - courseH * 0.6,
          proj * 0.5, glass, -0.2);
        F.band(ctx, f, top + courseH * 0.4, courseH * 0.8, proj * 1.2, stone, 0.2);

        for (const bay of bays) {
          const door = !F.clearsDoor(ctx, f, bay.t, 0);
          if (!door) {
            // bulkhead + plate glazing
            F.box(ctx, f, bay.t, cill / 2, bay.w * 0.94, cill, proj * 1.1, iron);
            const gh = lintelY - courseH * 0.62 - cill;
            if (gh > 0.3)
              F.box(ctx, f, bay.t, cill + gh / 2, bay.w * 0.88, gh, proj * 0.45, glass, -0.16);
          }
          // slim iron column on the bay line (skip the pair inside the doorway)
          const lt = bay.t - bay.w / 2;
          if (F.clearsDoor(ctx, f, lt, colW))
            F.rib(ctx, f, lt, 0, lintelY, colW, proj * 1.35, iron);
        }
        const endT = bays.length ? bays[bays.length - 1].t + bays[bays.length - 1].w / 2 : 0;
        if (F.clearsDoor(ctx, f, endT, colW)) F.rib(ctx, f, endT, 0, lintelY, colW, proj * 1.35, iron);
      }

      // ============================================================
      //  5. THE FIRE ESCAPE — one flank, deterministic side
      // ============================================================
      if (ST > 1) {
        const flanks = F.flanks(ctx);
        const f = flanks[(ctx.hash(0x5f13) * flanks.length) | 0] || flanks[0];
        const landW = Math.min(f.span * 0.34, Math.max(2.0, small * 0.16));
        const dep = Math.max(0.9, Math.min(1.5, landW * 0.5));
        const off = f.span * 0.24;                     // off the centre bay
        const railH = Math.max(0.75, FH * 0.24);
        const barr = Math.max(0.06, courseH * 0.35);

        for (let k = 1; k < ST; k++) {
          const y = k * FH - FH * 0.10;
          const sgn = (k % 2) ? 1 : -1;                // the zigzag
          const t = sgn * off;
          // landing deck
          F.box(ctx, f, t, y, landW, barr * 1.3, dep, iron);
          // railing: two rails plus posts at the ends and the middle
          for (const rl of [0.55, 1.0]) F.box(ctx, f, t, y + railH * rl, landW, barr, barr, iron, dep - barr);
          for (const p of [-0.5, 0, 0.5])
            F.rib(ctx, f, t + p * (landW - barr), y, y + railH, barr, barr, iron, dep - barr);
          // hangers back to the wall so the deck is not floating
          for (const p of [-0.42, 0.42])
            F.rib(ctx, f, t + p * landW, y - FH * 0.30, y, barr, barr * 1.2, iron);

          // the flight DOWN from this landing to the one below (or to the
          // ground for the lowest run, which stops short as a drop ladder).
          const yb = (k - 1) * FH - FH * 0.10;
          const tb = -sgn * off;
          const runs = 7;
          const y1 = (k === 1) ? yb + FH * 0.42 : yb;    // drop ladder hangs high
          for (let i = 0; i < runs; i++) {
            const u = (i + 0.5) / runs;
            const tt = t + (tb - t) * u;
            const yy = y - (y - y1) * u;
            F.box(ctx, f, tt, yy, (Math.abs(tb - t) / runs) * 1.2, barr * 1.1,
              dep * 0.62, iron, dep * 0.18);
            F.box(ctx, f, tt, yy + railH * 0.9, (Math.abs(tb - t) / runs) * 1.2, barr, barr,
              iron, dep * 0.18 + dep * 0.62 - barr);
          }
        }
      }
    },
  });
})();
