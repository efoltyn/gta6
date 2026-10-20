/* ============================================================
   city/facades/postmodern.js — "Broken Pediment", 1982-1985.

   REFERENCES
     AT&T Building / 550 Madison (Johnson & Burgee, 1984): pink-grey granite
       wall with PUNCHED windows, a tall round-headed entrance arch, and the
       "Chippendale" top — a gable pediment broken open by a round notch.
       https://www.ebsco.com/research-starters/architecture/att-building-exemplifies-postmodernism
     Portland Building (Michael Graves, 1982): base / shaft / top, a teal
       base, a cream shaft with small square windows, giant maroon pilasters
       on the middle of each face carrying an oversized KEYSTONE.
       https://en.wikipedia.org/wiki/Portland_Building
       https://www.archdaily.com/407522/ad-classics-the-portland-building-michael-graves

   THE PROPORTIONS USED (metres)
     base           2 storeys (3 from 20 storeys up), clad in the accent
                    stone 0.14 m proud, a plinth course 0.7 m, capped by a
                    0.9 m cornice 0.55 m proud
     loggia         on the entrance face: square piers 0.9 m standing 1.2 m
                    out on a 3.2 m pitch, a 0.8 m beam over them, and a
                    round-headed arch 4.6 m wide framing the door
     shaft windows  square, 1.3 x 1.3 m, one per 2.6 m bay (50% glass, which
                    is what keeps the host from stamping its own), a bronze
                    casing 0.08 m and a stone sill 0.1 m
     giant order    on faces with 5+ bays: two pilaster bays, 0.32 m proud,
                    from the base cornice to the attic, with the keystone
                    between them — four stepped courses, widest at the top
     attic          the top 2 storeys, smaller square windows (1.0 m), a
                    1.2 m modillion cornice 0.8 m proud
     crown          a gable pediment the width of the entrance face, rise
                    0.32 x span (<= 14 m), in 14 stepped courses, a round
                    notch of radius 0.11 x span bitten out of the apex

   PALETTES (by seed, faintly tinted by the host colour):
     550 Madison  pink granite, paler pink trim, bronze reveals
     Portland     cream shaft, teal base, maroon pilasters and keystone
     Sage         warm grey shaft, sage base, terracotta order

   COST: dbox only; the skin is one F.cladAround per zone per face.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  /* THE SKIN OF A REGULAR WINDOW GRID, cheaply: full-height strips between
     the window columns and full-width bands between the window rows (the
     same solid F.cladAround lays, in (cols + rows) boxes instead of
     storeys x bays). cols [[t0,t1]], rows [[y0,y1]], both sorted. */
  function gridClad(ctx, F, f, cols, rows, yA, yB, proj, col) {
    if (ctx.grid || !(yB - yA > 0.02)) return;
    const ed = [-f.span / 2 - proj];
    for (const c of cols) ed.push(c[0], c[1]);
    ed.push(f.span / 2 + proj);
    for (let i = 0; i < ed.length; i += 2) if (ed[i + 1] - ed[i] > 0.02) F.box(ctx, f, (ed[i] + ed[i + 1]) / 2, (yA + yB) / 2, ed[i + 1] - ed[i], yB - yA, proj, col);
    const ys = [yA];
    for (const r of rows) ys.push(r[0], r[1]);
    ys.push(yB);
    for (let i = 0; i < ys.length; i += 2) if (ys[i + 1] - ys[i] > 0.02) F.box(ctx, f, 0, (ys[i] + ys[i + 1]) / 2, f.span + proj * 2, ys[i + 1] - ys[i], proj, col);
  }

  const PALS = [
    { wall: 0xb79c90, base: 0x9a7f74, order: 0xc9b3a6, trim: 0xd4c2b6, frame: 0x4a3a2c },
    { wall: 0xd6cbb2, base: 0x4f7470, order: 0x8a3b31, trim: 0xe3dac6, frame: 0x2f3d3b },
    { wall: 0xbdb6a2, base: 0x7e9483, order: 0xa4573f, trim: 0xd5cdb8, frame: 0x3c3a30 },
  ];

  CBZ.registerFacade("postmodern", {
    label: "Broken Pediment",
    structure: "concrete",
    crownsRoof: true,
    minStoreys: 14,
    window: "deco",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const P0 = PALS[(ctx.hash(0x9a01) * PALS.length) | 0];
      const tint = (c) => F.mix(c, ctx.color, 0.12);
      const WALL = tint(P0.wall), BASE = tint(P0.base), ORDER = tint(P0.order), TRIM = tint(P0.trim);
      const BASE_D = F.shade(BASE, 0.78), ORDER_D = F.shade(ORDER, 0.8);
      F.windowFrame(ctx, P0.frame);

      const nBase = ST >= 20 ? 3 : 2;
      const nAttic = 2;
      const yBase = nBase * FH, yAttic = (ST - nAttic) * FH;
      const PITCH = 2.6 + (ctx.hash(0x9a02) - 0.5) * 0.2;
      const MARG = 1.0;
      const ent = F.entrance(ctx);

      // the keystone between the two order bays of face f (or null)
      const keystone = function (f, bays, i0, i1) {
        if (i0 < 0) return null;
        const pw = bays[i0].w * 0.92;
        const span = Math.abs(bays[i1].t - bays[i0].t) - pw;
        if (span <= 2) return null;
        const h = Math.min(FH * 2.4, span * 0.55);
        return { span: span, h: h, y0: yAttic - 0.3 - h, half: span * 0.46 };
      };
      for (const f of F.faces(ctx)) {
        const n = F.bayCount(f, PITCH, 3, 24);
        const bays = F.bays(f, n, MARG);
        const door = f.s === ctx.doorSide;
        // the giant-order bays: two, flanking the middle third
        const i0 = n >= 5 ? Math.floor(n * 0.3) : -1, i1 = n >= 5 ? n - 1 - i0 : -1;
        const orderBay = (i) => i === i0 || i === i1;

        // ---- 1. BASE: accent stone, tall openings, plinth --------------
        {
          const holes = [];
          for (let k = 0; k < nBase; k++) {
            const S = F.storey(ctx, k, 0.7);
            const head = Math.min(S.head, yBase - 1.05);     // clear of the base cornice
            if (head - S.sill < 0.9) continue;
            for (const r of F.openRow(ctx, f, n, Math.min(1.7, bays[0].w - 1.1), MARG, k)) {
              if (door && Math.abs(r.t) < 3.4) continue;     // the arch owns the middle
              holes.push({ t0: r.t0, t1: r.t1, y0: S.sill, y1: head });
            }
          }
          F.cladAround(ctx, f, 0, yBase, holes, 0.14, BASE);
          for (const h of holes) F.surround(ctx, f, h.t0, h.t1, h.y0, h.y1, { w: 0.1, proj: 0.2, col: BASE_D, head: "flat", headH: 0.16, sill: { h: 0.12, proj: 0.24, col: TRIM } });
          F.band(ctx, f, 0.35, 0.7, 0.22, BASE_D, 0.22);
        }

        // ---- 2. SHAFT: square punched windows ----------------------------
        let shaftHoles = [];
        {
          const holes = [];
          for (let k = nBase; k < ST - nAttic; k++) {
            const S = F.storey(ctx, k);
            const head = S.head - 0.1, sill = head - 1.3;
            const row = F.openRow(ctx, f, n, 1.3, MARG, k);
            for (let i = 0; i < row.length; i++) {
              if (orderBay(bays.findIndex((b) => Math.abs(b.t - row[i].t) < 0.01))) continue;
              holes.push({ t0: row[i].t0, t1: row[i].t1, y0: sill, y1: head });
            }
          }
          const cols = [], rows = [];
          for (const h of holes) {
            if (!cols.some((c) => Math.abs(c[0] - h.t0) < 0.01)) cols.push([h.t0, h.t1]);
            if (!rows.some((r) => Math.abs(r[0] - h.y0) < 0.01)) rows.push([h.y0, h.y1]);
          }
          cols.sort((a, b) => a[0] - b[0]); rows.sort((a, b) => a[0] - b[0]);
          gridClad(ctx, F, f, cols, rows, yBase, yAttic, 0.1, WALL);
          shaftHoles = holes;
          // a sill course under every row of windows, the full face
          for (const r of rows) F.band(ctx, f, r[0] - 0.05, 0.1, 0.2, TRIM, 0.2);
        }

        // ---- 3. GIANT ORDER + KEYSTONE ------------------------------------
        if (i0 >= 0) {
          const pw = bays[i0].w * 0.92;
          for (const i of [i0, i1]) {
            const t = bays[i].t;
            F.rib(ctx, f, t, yBase + 0.9, yAttic - 0.9, pw, 0.32, ORDER);
            F.rib(ctx, f, t, yBase + 0.9, yAttic - 0.9, pw * 0.3, 0.36, ORDER_D);    // the flute down its middle
            F.box(ctx, f, t, yAttic - 0.6, pw + 0.4, 0.6, 0.42, TRIM);              // capital
            F.box(ctx, f, t, yBase + 1.05, pw + 0.3, 0.3, 0.4, TRIM);               // base block
          }
          // the KEYSTONE: four courses, widest at the top, between the capitals
          const ks = keystone(f, bays, i0, i1);
          if (ks) {
            // each course is laid AROUND the shaft windows it crosses: the
            // keystone is a panel with the windows punched through it, as
            // Graves drew it, not a lid over them
            const FOs = CBZ.facadeOpenings;
            const hs = shaftHoles.map((h) => ({ a0: h.t0, a1: h.t1, y0: h.y0, y1: h.y1 }));
            for (let c = 0; c < 4; c++) {
              const u = (c + 0.5) / 4, cw = ks.span * (0.42 + u * 0.5), cy = ks.y0 + u * ks.h, chh = ks.h / 4 + 0.02;
              const pr = 0.4 - c * 0.03, col = c % 2 ? ORDER : ORDER_D;
              const rects = FOs && FOs.solidRects ? FOs.solidRects(-cw / 2, cw / 2, cy - chh / 2, cy + chh / 2, hs) : [[-cw / 2, cw / 2, cy - chh / 2, cy + chh / 2]];
              for (const r of rects) F.box(ctx, f, (r[0] + r[1]) / 2, (r[2] + r[3]) / 2, r[1] - r[0], r[3] - r[2], pr, col);
            }
          }
        }

        // ---- 4. ATTIC: smaller square windows ----------------------------
        {
          const holes = [];
          for (let k = ST - nAttic; k < ST; k++) {
            const S = F.storey(ctx, k);
            // the top storey's windows stand under the 1.2 m cornice
            const head = k === ST - 1 ? Math.min(S.head - 0.2, H - 1.3) : S.head - 0.2, sill = head - 1.0;
            if (sill < S.y + 0.56) continue;
            for (const r of F.openRow(ctx, f, n, 1.0, MARG, k)) holes.push({ t0: r.t0, t1: r.t1, y0: sill, y1: head });
          }
          const cols = [], rows = [];
          for (const h of holes) {
            if (!cols.some((c) => Math.abs(c[0] - h.t0) < 0.01)) cols.push([h.t0, h.t1]);
            if (!rows.some((r) => Math.abs(r[0] - h.y0) < 0.01)) rows.push([h.y0, h.y1]);
          }
          cols.sort((a, b) => a[0] - b[0]); rows.sort((a, b) => a[0] - b[0]);
          gridClad(ctx, F, f, cols, rows, yAttic, H, 0.1, WALL);
        }

        // ---- 5. THE LOGGIA + ARCH (entrance face) ------------------------
        if (door && !ent.driveIn) {
          const archW = 4.6, archTop = Math.min(yBase - 1.2, FH * 1.9);
          const rise = archW / 2;
          const spring = archTop - rise;
          if (spring > ent.head) {
            for (const sg of [-1, 1]) F.rib(ctx, f, sg * (archW / 2 + 0.35), 0, spring, 0.7, 0.5, TRIM);
            F.arch(ctx, f, 0, spring, archW, rise, 0.45, 0.5, TRIM, "round");
            // the tympanum: glazed fan above the door head (left clear for the host)
          }
          // the loggia: square piers on the bay lines, standing out under
          // the base cornice, the openings between them
          for (const t of F.bayLines(f, n, MARG)) {
            if (Math.abs(t) < archW / 2 + 0.9) continue;
            F.rib(ctx, f, t, 0, yBase - 0.9, 0.9, 1.2, BASE);
            F.box(ctx, f, t, 0.3, 1.1, 0.6, 1.3, BASE_D);
          }
        }
      }

      // ---- 6. CORNICES -------------------------------------------------------
      F.cornice(ctx, yBase - 0.9, { h: 0.9, proj: 0.55, col: TRIM, dark: BASE_D, frieze: 0.2 });
      F.cornice(ctx, H - 1.2, { h: 1.2, proj: 0.8, col: TRIM, dark: F.shade(WALL, 0.7), teeth: "modillion", frieze: 0.25 });

      // ---- 7. THE BROKEN PEDIMENT --------------------------------------------
      {
        const ef = F.face(ctx, ctx.doorSide);
        const along = ef.horiz;                       // gable across x when the door faces z
        const span = along ? ctx.w : ctx.d, deep = along ? ctx.d : ctx.w;
        const rise = Math.min(14, span * 0.32);
        const NC = 14, ch = rise / NC;
        const nr = span * 0.11, ny = H + 0.3 + rise - nr * 0.9;   // the notch centre
        const y0 = H + 0.3;
        // a plinth course for it to stand on
        ctx.dbox(0, H + 0.15, 0, ctx.w - 0.1, 0.3, ctx.d - 0.1, F.shade(WALL, 0.92));
        for (let c = 0; c < NC; c++) {
          const yb = y0 + c * ch, yc = yb + ch / 2;
          const half = (span / 2) * (1 - (c + 0.5) / NC) + 0.15;
          let gap = 0;
          if (yc > ny - nr) gap = yc < ny ? Math.sqrt(Math.max(0, nr * nr - (ny - yc) * (ny - yc))) : nr;
          const col = c % 3 === 0 ? TRIM : WALL;
          const put = (a, b) => {
            if (b - a < 0.1) return;
            if (along) ctx.dbox((a + b) / 2, yc, 0, b - a, ch + 0.01, deep - 0.2, col);
            else ctx.dbox(0, yc, (a + b) / 2, deep - 0.2, ch + 0.01, b - a, col);
          };
          if (gap > 0.05) { put(-half, -gap); put(gap, half); } else put(-half, half);
        }
      }
    },
  });
})();
