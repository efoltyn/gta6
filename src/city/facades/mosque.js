/* ============================================================
   city/facades/mosque.js — "Grand Mosque", the congregational mosque.

   The building underneath is the ordinary office box every lot gets. What
   makes a congregational mosque legible from 200 m is not surface pattern —
   it is a SILHOUETTE with three parts, and this facade builds exactly those
   three parts out of the host's own dimensions:

     1. THE DOME ON A DRUM, buttressed. Ottoman practice (Sinan, and the
        Uskudar and Sultanahmet line after him) never leaves a hemisphere
        sitting on a cube: the thrust has to go somewhere, so the drum is
        ringed by SEMI-DOMES on the axes and by weight turrets on the
        diagonals. A bare ball on a box is the failure mode; the buttressing
        is what turns it into architecture. Radius derives from the roof
        slab, so a shop gets a modest cupola and a block gets a real dome.

     2. THE MINARET, from one corner. Square base for the lower third (it is
        a masonry pier and must read as one), a polygonal shaft above it, a
        corbelled serefe balcony carried on stacked muqarnas tiers, a short
        upper shaft, a conical lead cap and a finial. Height is solved from
        ctx.rTop (1.6-2.2x) and then clamped, so it stays a landmark on a
        one-storey shop and does not become a radio mast on an eight-storey
        block. It stands at a corner of the entrance face, clear of the dome.

     3. THE PISHTAQ AND ITS PORTICO. The portal frame is the single most
        recognisable element after the dome: a tall rectangular frame proud
        of the wall, enclosing a recessed pointed arch whose head is filled
        with stepped muqarnas corbelling. Either side of it runs the riwaq —
        a pointed arcade on slim colonnettes, 1 to 3 arches per flank
        depending on how much face is left after the portal takes the centre.
        The portal is dimensioned FROM F.entrance so the doorway stays clear.

   Everything else is the Mamluk/Ottoman surface grammar that ties those
   three together: a tilework course (turquoise and cobalt alternating on
   pale stone) under the cornice and up the portal reveal, pointed windows
   with a pierced jali grid in the upper storeys, and stepped merlons on the
   parapet. All of that is dbox, which is free; the mesh budget is spent
   deliberately on the dome group and the minaret, which are the silhouette.

   Determinism: every variation comes from ctx.hash(salt) only.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("mosque", {
    label: "Grand Mosque",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — cut stone piers carrying masonry domes.
    structure: "stone",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      spec = spec || {};
      const w = ctx.w, d = ctx.d, FH = ctx.FH, rTop = ctx.rTop;
      const small = Math.min(w, d);
      const h = function (s) { return ctx.hash(s); };

      // ---- palette ------------------------------------------------
      // Warm pale limestone off the host colour; the two tile hues are the
      // saturated pair every tiled mosque uses against it.
      const stone = F.mix(ctx.color, 0xe6dcc4, 0.42);
      const stoneD = F.shade(stone, 0.82);
      const stoneL = F.mix(stone, 0xffffff, 0.22);
      const TILE_A = F.mix(0x11868f, ctx.color, 0.10);      // deep turquoise
      const TILE_B = F.mix(0x1d3a92, ctx.color, 0.10);      // cobalt
      const leadDome = h(0x4d01) < 0.45
        ? F.mix(TILE_A, 0xffffff, 0.10)                     // turquoise-glazed
        : F.mix(0x8e949a, ctx.color, 0.15);                 // lead grey
      const TRIM = ctx.TRIM;

      const ent = F.entrance(ctx);
      const df = ent.f;                                     // the entrance face
      const PLINTH = clamp(FH * 0.20, 0.34, 0.8);

      // ============================================================
      //  A. THE WALL — plinth, string courses, tilework, cornice
      // ============================================================
      // A stone plinth all round: the mosque sits on a platform, not on dirt.
      F.ring(ctx, PLINTH / 2, PLINTH, 0.30, stoneD, 0.5, 0);

      // Corner piers, full height, so the box reads as masonry with mass at
      // the corners rather than as a slab with a pattern on it.
      const pierW = clamp(small * 0.075, 0.6, 1.5);
      F.corners(ctx, rTop / 2, rTop, pierW, 0.24, stoneL);

      // A string course at each floor line (never the ground one, the portico
      // owns that), so the wall is coursed the way ashlar actually is.
      for (let k = 1; k < ctx.storeys; k++) {
        F.ring(ctx, k * FH, 0.14, 0.16, stoneD, 0.3, 0);
      }

      // THE TILEWORK BAND under the cornice: alternating turquoise/cobalt
      // squares on a recessed stone ground. Block size comes from the face.
      const tileH = clamp(FH * 0.26, 0.42, 0.95);
      const tileY = rTop - tileH * 0.9;
      for (const f of F.faces(ctx)) {
        F.band(ctx, f, tileY, tileH, 0.16, stoneD, 0.24, 0);        // the ground
        const n = Math.max(4, Math.round(f.span / (tileH * 1.35)));
        const step = f.span / n;
        for (let i = 0; i < n; i++) {
          const t = -f.span / 2 + (i + 0.5) * step;
          F.box(ctx, f, t, tileY, step * 0.72, tileH * 0.66, 0.10,
            (i % 2) ? TILE_B : TILE_A, 0.16);
        }
      }
      // The cornice over it, with its own shadow course.
      F.ring(ctx, rTop - 0.08, 0.30, 0.42, stoneL, 0.5, 0);
      F.ring(ctx, rTop - 0.36, 0.12, 0.26, stoneD, 0.4, 0);

      // ============================================================
      //  B. WINDOWS — pointed lights with a pierced jali screen
      // ============================================================
      // Ground floor is arcaded on the entrance face and blind elsewhere (a
      // prayer hall has no shopfront); the lights start at storey 1.
      for (const f of F.faces(ctx)) {
        const n = F.bayCount(f, 4.0, 2, 6);
        const bays = F.bays(f, n, clamp(f.span * 0.10, 0.9, 2.4));
        for (let k = 1; k < ctx.storeys; k++) {
          const sill = k * FH + FH * 0.28;
          const wh = FH * 0.42;                              // the straight jamb
          for (const b of bays) {
            const ww = clamp(b.w * 0.44, 0.5, 1.7);
            if (!F.clearsDoor(ctx, f, b.t, ww + 1.0)) continue;
            // reveal: a recessed dark ground the tracery sits in
            F.box(ctx, f, b.t, sill + wh / 2, ww + 0.34, wh + 0.2, 0.10, stoneD, 0.02);
            F.arch(ctx, f, b.t, sill + wh, ww, wh * 0.62, 0.14, 0.16, stoneL, "pointed");
            // JALI: a small grid of mullions across the light. Two verticals
            // and two transoms is enough to read as pierced stone at range.
            for (const sg of [-1, 1]) {
              F.rib(ctx, f, b.t + sg * ww * 0.17, sill, sill + wh, 0.09, 0.19, stoneL, 0.02);
            }
            for (let q = 1; q <= 2; q++) {
              F.box(ctx, f, b.t, sill + wh * (q / 3), ww * 0.86, 0.08, 0.19, stoneL, 0.02);
            }
            // sill
            F.box(ctx, f, b.t, sill - 0.12, ww + 0.52, 0.16, 0.26, stoneL, 0.02);
          }
        }
      }

      // ============================================================
      //  C. THE RIWAQ — a pointed arcade across the entrance face
      // ============================================================
      // The portico stands proud of the wall on colonnettes. Its depth is a
      // fraction of the building's own depth so it never swamps a small shop.
      const porch = clamp(Math.min(FH * 0.72, small * 0.13), 0.9, 2.6);
      const capH = clamp(FH * 0.62, 1.9, 3.4);               // springing height
      const archRise = clamp(FH * 0.46, 0.8, 1.9);
      const porchTop = capH + archRise + 0.5;

      // The portal takes the centre; the arcade fills what is left each side.
      const portalW = clamp(Math.max(ent.gap + 2.6, df.span * 0.30), 3.0, df.span * 0.52);
      const sideRun = (df.span - portalW) / 2 - 0.5;         // per flank
      const perArch = clamp(FH * 0.95, 2.2, 3.6);
      const nSide = sideRun > perArch * 0.8
        ? clamp(Math.round(sideRun / perArch), 1, 3) : 0;

      const colR = clamp(porch * 0.20, 0.11, 0.30);
      let meshCols = 0;
      if (nSide > 0) {
        const aw = sideRun / nSide;
        for (const sg of [-1, 1]) {
          const t0 = sg * (portalW / 2 + 0.5);
          for (let i = 0; i < nSide; i++) {
            const tc = t0 + sg * (i + 0.5) * aw;
            // the arch itself, on the outer plane of the portico
            F.arch(ctx, df, tc, capH, aw * 0.72, archRise, 0.13, 0.22, stoneL, "pointed");
            // spandrel wall over the arch, closing the arcade to its cornice
            F.box(ctx, df, tc, capH + archRise + 0.32, aw, 0.5, 0.26, stone, porch - 0.26);
          }
          // COLONNETTES on the bay lines, including the pair against the
          // portal and the pair at the corner. These are real meshes.
          for (let i = 0; i <= nSide; i++) {
            const tc = t0 + sg * i * aw;
            const px = df.halfN + porch - colR * 1.2;
            const lx = df.horiz ? tc : df.out * px;
            const lz = df.horiz ? df.out * px : tc;
            ctx.column(lx, PLINTH, lz, colR, capH - PLINTH, stoneL, 10);
            meshCols++;
            // capital and base, both cheap boxes
            ctx.dbox(lx, capH - 0.10, lz, colR * 3.0, 0.22, colR * 3.0, stoneD);
            ctx.dbox(lx, PLINTH + 0.09, lz, colR * 2.8, 0.18, colR * 2.8, stoneD);
          }
        }
        // the portico roof slab and its coping, spanning the whole face
        F.band(ctx, df, porchTop, 0.34, porch + 0.30, stoneL, 0.6, -0.02);
        F.band(ctx, df, porchTop + 0.30, 0.16, porch + 0.52, stoneD, 0.8, -0.02);
        // a low parapet on the portico with small merlons
        F.merlons(ctx, df, porchTop + 0.62, Math.max(5, Math.round(df.span / 1.5)),
          0.30, 0.42, porch * 0.5, stoneL);
      }

      // ============================================================
      //  D. THE PISHTAQ — the monumental portal frame
      // ============================================================
      // A tall rectangular frame standing proud of everything else, enclosing
      // a recessed pointed arch. Height is solved so it overtops the portico
      // and stops short of the cornice; it never exceeds the wall.
      const pDepth = porch + clamp(small * 0.05, 0.35, 0.9);
      const pTop = clamp(Math.max(porchTop + FH * 0.55, rTop * 0.78), porchTop + 1.0, rTop - 0.55);
      const jamb = clamp(portalW * 0.16, 0.45, 1.3);
      const frameW = portalW + jamb * 2;

      // the two jambs of the frame, full height, from the plinth up
      for (const sg of [-1, 1]) {
        F.rib(ctx, df, sg * (portalW + jamb) / 2, 0, pTop, jamb, pDepth, stoneL, 0);
        // a tile fillet running up the reveal of each jamb
        F.rib(ctx, df, sg * (portalW / 2 + jamb * 0.24), 0.4, pTop - 0.5,
          jamb * 0.30, pDepth + 0.06, (sg < 0) ? TILE_A : TILE_A, 0);
      }
      // the lintel band across the head of the frame
      F.box(ctx, df, 0, pTop - jamb * 0.55, frameW, jamb * 1.1, pDepth, stoneL, 0);
      // a tile course inside the frame head, the way a foundation inscription
      // band sits on a real pishtaq
      const bn = Math.max(6, Math.round(frameW / 0.7));
      for (let i = 0; i < bn; i++) {
        const t = -frameW / 2 + (i + 0.5) * (frameW / bn);
        F.box(ctx, df, t, pTop - jamb * 0.55, (frameW / bn) * 0.7, jamb * 0.5, 0.10,
          (i % 2) ? TILE_B : TILE_A, pDepth);
      }
      // the frame's own cornice cap
      F.box(ctx, df, 0, pTop + 0.16, frameW + 0.44, 0.32, pDepth + 0.20, stoneD, 0);
      // stepped merlon crest on the pishtaq — the Mamluk signature, here on
      // the element that carries the eye.
      {
        const mn = Math.max(3, Math.round(frameW / 1.1));
        const step = frameW / mn;
        for (let i = 0; i < mn; i++) {
          const t = -frameW / 2 + (i + 0.5) * step;
          F.box(ctx, df, t, pTop + 0.52, step * 0.62, 0.42, pDepth * 0.6, stoneL, 0);
          F.box(ctx, df, t, pTop + 0.86, step * 0.38, 0.30, pDepth * 0.6, stoneL, 0);
        }
      }

      // THE RECESSED ARCH inside the frame. Its springing is above the door
      // head, so nothing hangs into the doorway.
      const iSpring = Math.max(ent.head + 0.2, capH + 0.3);
      const iRise = Math.max(0.9, (pTop - 0.9) - iSpring);
      // dark recess ground, set BEHIND the frame face
      F.box(ctx, df, 0, (iSpring + iRise * 0.5) / 1, portalW, iSpring + iRise + 0.4,
        0.14, F.shade(stone, 0.55), pDepth - 0.34);
      F.arch(ctx, df, 0, iSpring, portalW * 0.86, iRise, 0.16, 0.26, stoneL, "pointed");

      // MUQARNAS in the portal head: stepped, corbelled tiers of small blocks
      // in receding rows, each row narrower and further out than the one
      // below. Four tiers reads correctly at gameplay distance.
      {
        const tiers = 4;
        const th = Math.min(0.42, iRise / (tiers + 1));
        for (let r = 0; r < tiers; r++) {
          const frac = 1 - r * 0.19;
          const cells = Math.max(2, Math.round((portalW * frac) / 0.55));
          const cw = (portalW * frac * 0.9) / cells;
          const y = iSpring + iRise - 0.25 - r * th;
          for (let i = 0; i < cells; i++) {
            const t = -portalW * frac * 0.45 + (i + 0.5) * cw;
            F.box(ctx, df, t, y, cw * 0.82, th * 0.86,
              0.16 + r * 0.055, (r % 2) ? stoneD : stoneL, pDepth - 0.34);
          }
        }
      }
      // the threshold: two shallow steps up to the door, clear of it in height
      for (let i = 0; i < 2; i++) {
        F.box(ctx, df, 0, PLINTH * (0.3 + i * 0.42), portalW + 1.2, PLINTH * 0.5,
          pDepth + 1.0 - i * 0.45, stoneD, 0);
      }

      // ============================================================
      //  E. THE PARAPET AND ITS STEPPED MERLONS
      // ============================================================
      const parH = clamp(FH * 0.30, 0.5, 1.1);
      F.parapet(ctx, parH, clamp(small * 0.026, 0.22, 0.42), stoneL, stoneD);
      for (const f of F.faces(ctx)) {
        const mn = Math.max(4, Math.round(f.span / clamp(FH * 0.55, 1.1, 2.1)));
        const mw = (f.span / mn) * 0.52;
        F.merlons(ctx, f, rTop + parH + 0.30, mn, mw, 0.46, 0.34, stoneL);
        F.merlons(ctx, f, rTop + parH + 0.66, mn, mw * 0.60, 0.34, 0.32, stoneL);
      }

      // ============================================================
      //  F. THE DOME GROUP — dome, drum, semi-domes, weight turrets
      // ============================================================
      const roof = F.roof(ctx);
      const R = clamp(roof.base * 0.30, 1.3, 9.0);           // dome radius
      const drumR = R * 0.94;
      const drumH = clamp(FH * 0.75, 1.2, 3.4);
      const drumY = roof.y;

      // The square substructure the drum stands on — a real mosque never
      // lands a circular drum straight on a flat roof; there is a stepped
      // masonry base spreading the load out to the piers.
      F.ziggurat(ctx, roof.cx, roof.cz, drumY, drumR * 2.5, drumR * 2.5,
        drumH * 0.55, 2, stoneL, 0.84, 0.05);
      const baseTop = drumY + drumH * 0.55;

      ctx.column(roof.cx, baseTop, roof.cz, drumR, drumH, stoneL, 16);
      // a ring of small pointed lights round the drum, as dbox teeth
      {
        const n = 12;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const px = roof.cx + Math.cos(a) * drumR * 0.99;
          const pz = roof.cz + Math.sin(a) * drumR * 0.99;
          ctx.dbox(px, baseTop + drumH * 0.55, pz, drumR * 0.16, drumH * 0.5, drumR * 0.16, stoneD);
        }
      }
      // the tile course round the drum head
      ctx.dbox(roof.cx, baseTop + drumH - 0.12, roof.cz, drumR * 2.06, 0.24, drumR * 2.06, TILE_A);

      const domeY = baseTop + drumH;
      ctx.dome(roof.cx, domeY, roof.cz, R, leadDome);
      // finial: a short mast with an alem sphere
      ctx.dbox(roof.cx, domeY + R + 0.35, roof.cz, R * 0.10, R * 0.7, R * 0.10, TRIM);
      ctx.ball(roof.cx, domeY + R + 0.72 + R * 0.10, roof.cz, clamp(R * 0.14, 0.16, 0.6), TRIM);

      // SEMI-DOMES on the four axes, abutting the drum. These are the
      // buttresses: they take the dome's thrust down into the roof, and they
      // are the reason the crown reads as Ottoman rather than as a ball.
      const sR = R * 0.58;
      const sOff = drumR + sR * 0.18;
      for (const v of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const px = roof.cx + v[0] * sOff, pz = roof.cz + v[1] * sOff;
        // each semi-dome stands on its own low block, so it never floats
        ctx.dbox(px, baseTop + drumH * 0.22, pz, sR * 1.9, drumH * 0.44 + drumH * 0.55, sR * 1.9, stoneL);
        ctx.dome(px, baseTop + drumH * 0.44, pz, sR, leadDome);
      }
      // WEIGHT TURRETS on the diagonals of the drum base — the little capped
      // pinnacles that pin the corners of the substructure down.
      const tR = clamp(R * 0.16, 0.18, 0.7);
      const tOff = drumR * 1.02;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = roof.cx + sx * tOff, pz = roof.cz + sz * tOff;
        const tH = drumH * 1.05;
        ctx.column(px, baseTop, pz, tR, tH, stoneL, 8);
        ctx.cone(px, baseTop + tH, pz, tR * 1.25, tH * 0.62, leadDome);
      }

      // ============================================================
      //  G. THE MINARET
      // ============================================================
      // Height from the host: 1.6-2.2x the roofline, then clamped so a shop
      // still gets a landmark and a tall block does not get a mast.
      const mH = clamp(rTop * (1.72 + h(0x4d02) * 0.48), 12.0, rTop + 30);
      const shaftR = clamp(small * 0.064, 0.42, 1.05);
      const baseW = shaftR * 2.9;

      // Which corner: a corner OF THE ENTRANCE FACE, so the minaret and the
      // portal are seen together, and on the side away from nothing in
      // particular — the hash picks left or right.
      const sSide = h(0x4d03) < 0.5 ? -1 : 1;
      let mx, mz;
      // ENGAGED, not embedded: two thirds of the pier stands outside the wall
      // plane on both faces, so the shaft is a free vertical from every angle
      // instead of a bump hiding inside the box.
      const eng = baseW * 0.30;
      if (df.horiz) { mx = sSide * (w / 2 + eng); mz = df.out * (d / 2 + eng); }
      else { mz = sSide * (d / 2 + eng); mx = df.out * (w / 2 + eng); }

      const baseH = mH * 0.34;                                // square pier
      ctx.dbox(mx, baseH / 2, mz, baseW, baseH, baseW, stoneL);
      // coursed banding on the pier, so it is masonry and not an extrusion
      for (let i = 1; i <= 3; i++) {
        ctx.dbox(mx, baseH * (i / 4), mz, baseW + 0.16, 0.13, baseW + 0.16, stoneD);
      }
      // a banded tile course round the pier — two thin ribbons rather than one
      // slab, which is how a real minaret pier is inlaid and which keeps it
      // from reading as a painted rectangle at distance.
      ctx.dbox(mx, baseH * 0.60, mz, baseW + 0.05, baseH * 0.055, baseW + 0.05, TILE_B);
      ctx.dbox(mx, baseH * 0.68, mz, baseW + 0.05, baseH * 0.055, baseW + 0.05, TILE_A);

      // TRANSITION: two chamfer courses squaring down to the polygonal shaft.
      const trH = mH * 0.05;
      F.ziggurat(ctx, mx, mz, baseH, baseW, baseW, trH, 2, stoneL, 0.80, 0.06);
      const shaftY = baseH + trH;

      // the SHAFT — polygonal, one real mesh
      const balconyY = baseH + (mH - baseH) * 0.60;
      ctx.column(mx, shaftY, mz, shaftR, balconyY - shaftY, stoneL, 10);

      // MUQARNAS CORBEL under the serefe: three receding tiers of blocks,
      // each wider than the one below, which is how the balcony is carried.
      for (let r = 0; r < 3; r++) {
        const rr = shaftR * (1.18 + r * 0.36);
        const cells = 8 + r * 2;
        const th = 0.24;
        for (let i = 0; i < cells; i++) {
          const a = (i / cells) * Math.PI * 2 + r * 0.19;
          ctx.dbox(mx + Math.cos(a) * rr * 0.86, balconyY - 0.85 + r * th, mz + Math.sin(a) * rr * 0.86,
            rr * 0.42, th * 0.9, rr * 0.42, (r % 2) ? stoneD : stoneL);
        }
      }
      // the balcony floor and its railing
      const balR = shaftR * 2.15;
      ctx.dbox(mx, balconyY - 0.06, mz, balR * 2, 0.20, balR * 2, stoneL);
      {
        const n = 14;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          ctx.dbox(mx + Math.cos(a) * balR * 0.94, balconyY + 0.36, mz + Math.sin(a) * balR * 0.94,
            balR * 0.30, 0.72, balR * 0.30, stoneL);
        }
        // the rail cap, as a thin plate over the balusters
        ctx.dbox(mx, balconyY + 0.76, mz, balR * 2.0, 0.14, balR * 2.0, stoneD);
      }

      // the UPPER SHAFT, shorter and slimmer, above the balcony
      const upR = shaftR * 0.82;
      const capY = baseH + (mH - baseH) * 0.86;
      ctx.column(mx, balconyY + 0.1, mz, upR, capY - balconyY - 0.1, stoneL, 10);
      ctx.dbox(mx, capY - 0.08, mz, upR * 2.5, 0.22, upR * 2.5, TILE_A);   // tile collar

      // the CONICAL CAP and the finial
      const coneH = mH - capY;
      ctx.cone(mx, capY, mz, upR * 1.5, coneH, leadDome);
      ctx.dbox(mx, mH + coneH * 0.16, mz, upR * 0.22, coneH * 0.34, upR * 0.22, TRIM);
      ctx.ball(mx, mH + coneH * 0.36, mz, clamp(upR * 0.42, 0.15, 0.42), TRIM);
    },
  });
})();
