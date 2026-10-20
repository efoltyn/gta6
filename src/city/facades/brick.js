/* ============================================================
   city/facades/brick.js — "Chicago Loft": the brick commercial block,
   c. 1885-1915.

   REFERENCES (proportions taken from these, not invented):
     Washington DAHP, "Anatomy of a Main Street Building"
       https://dahp.wa.gov/sites/default/files/Anatomy_of_MainStreet.pdf
     Roanoke VA storefront guideline
       https://www.roanokeva.gov/DocumentCenter/View/1105/Storefronts-PDF
     Salt Lake City commercial design guide, ch.2 Storefronts
       http://www.slcdocs.com/historicpreservation/guidecom/ch2.pdf
     NYC LPC storefront guide (via Cambridge MA)
       https://cambridgema.gov/~/media/Files/historicalcommission/pdf/hscdstudy/nyclpcapp_guide_storefronts_hds.pdf
     The Chicago window (Reliance, Marquette): a fixed centre light flanked by
       two narrow double-hung sashes in a 2.4-3.0 m opening between piers.

   THE NUMBERS.
     storefront   bulkhead 0.3-0.6 m, display glass to ~2.7 m, transom,
                  signband 0.6-0.9 m on the beam, a storefront cornice
                  projecting 0.3-0.45 m (F.storefront), masonry end piers.
     bays         4.0-4.6 m on a loft (one Chicago window 2.4-2.9 m wide
                  between 0.6-0.8 m piers); 2.6-3.0 m on a walk-up block
                  (one 1.1-1.3 m double-hung sash per bay).
     piers        0.2 m proud of the spandrels, running unbroken from the
                  belt course to the frieze: the load path, the whole read.
     spandrels    the brick between one storey's window head and the next
                  storey's sill, held BACK behind the piers (0.05 m skin).
     sills        a limestone sill course 0.12 m tall, 0.09 m proud.
     lintels      loft: a stone lintel course over each storey's heads;
                  walk-up: a segmental brick arch with a stone keystone.
     cornice      a corbelled brick frieze and a pressed-metal or brick
                  cornice 1.0 m tall, 0.6-0.75 m projection, dentils or
                  modillions; brick parapet 0.9 m with stone coping.
     colour       the street's brick (ctx.color / ctx.pal.wall), limestone
                  0xcfc6b0 trim, iron 0x2c3036 / painted timber fronts.

   VARIATION BY SEED: loft (Chicago windows, lintel course, metal cornice)
   or walk-up (paired-rhythm sash windows, segmental arches, corbel cornice);
   the storefront's frame colour and whether it has an awning; the cornice's
   teeth; which flank carries the fire escape.

   COST. The wall is laid as full-height piers plus ONE spandrel band per
   storey per face (the openings are what is left between them), so a
   12-storey block is a few boxes per storey per face, all merged.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("brick", {
    label: "Chicago Loft",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — load-bearing brick on heavy timber.
    structure: "brick",
    crownsRoof: true,
    window: "loft",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), rTop = ctx.rTop;
      const grid = !!ctx.grid;

      // ---- palette ----------------------------------------------------
      const base = (ctx.pal && ctx.pal.wall) || ctx.color;
      const brick = base;
      const brickD = F.shade(brick, 0.86);       // spandrel skin, a shade back
      const brickL = F.shade(brick, 1.08);       // corbels catching the sun
      const stone = ctx.pal && ctx.pal.stone ? F.mix(ctx.pal.stone, 0xcfc6b0, 0.5) : 0xcfc6b0;
      const stoneD = F.shade(stone, 0.86);
      const iron = 0x2c3036;
      const loft = ctx.hash(0x8b02) < 0.55;      // Chicago loft vs walk-up block
      const FRONTS = [0x2c3036, 0x3b2a22, 0x2d3b33, 0x5b3324];
      const front = FRONTS[(ctx.hash(0x8b03) * FRONTS.length) | 0];
      const AWN = [null, 0x6a2a22, 0x2f4a3a, 0x3a3f5a, null];
      const awning = AWN[(ctx.hash(0x8b04) * AWN.length) | 0];
      const metalCornice = loft && ctx.hash(0x8b05) < 0.6;
      const corniceCol = metalCornice ? [0x4f4b44, 0x3a463e, 0x6b6357][(ctx.hash(0x8b06) * 3) | 0] : brickL;
      F.windowFrame(ctx, loft ? [0x2a2724, 0x3b2a22, 0xd9d4c6][(ctx.hash(0x8b07) * 3) | 0]
                              : [0xe6e1d4, 0x2f3a33, 0x5a2a22][(ctx.hash(0x8b07) * 3) | 0]);
      for (let s = 0; s < 4; s++) F.windowStyle(ctx, s, "*", loft ? "loft" : "sash");

      const PIER_P = 0.22, SKIN = 0.05;
      const BAY = loft ? 4.3 : 2.8;
      const WIN = loft ? 2.6 : 1.2;              // opening width in a bay
      const faces = F.faces(ctx);
      const df = F.face(ctx, ctx.doorSide);
      const shop = ST >= 2;
      const sf = shop ? F.storefront(ctx, df, { frame: front, pierCol: brick, cornCol: stone, awning: awning,
        sign: F.shade(front, 1.15), bayW: 2.3 }) : null;
      const belt = shop ? sf.top : 0;            // top of the storefront assembly

      // the frieze + cornice zone at the top of the wall
      const CORN_H = Math.min(1.1, Math.max(0.7, FH * 0.3));
      const friezeY = rTop - CORN_H * 0.62;      // bottom of the corbel table
      const topHead = (ST - 1) * FH + FH - 0.46; // highest window head

      // ============================================================
      //  1. EACH FACE: piers, spandrels, sills, heads
      // ============================================================
      for (const f of faces) {
        const n = F.bayCount(f, BAY, 2, loft ? 10 : 16);
        const margin = Math.max(0.55, Math.min(1.0, f.span * 0.05));
        const bays = F.bays(f, n, margin);
        const lines = F.bayLines(f, n, margin);
        const step = bays.length ? bays[0].w : f.span;
        const pierW = Math.max(0.42, Math.min(0.8, step * 0.2));
        const ww = Math.min(WIN, step - pierW - 0.3);
        const isDoor = f.s === ctx.doorSide;
        const k0 = (isDoor && shop) ? 1 : 0;     // the storefront owns storey 0
        const y0 = (isDoor && shop) ? belt : 0;

        // the openings of one storey on this face (the same every storey)
        const cols = bays.map((b) => [b.t - ww / 2, b.t + ww / 2]);

        // ---- the skin: full-height brick between the openings ---------
        if (!grid && ww > 0.5) {
          let a = -f.span / 2 - SKIN;
          for (const c of cols) {
            if (c[0] - a > 0.02) F.box(ctx, f, (a + c[0]) / 2, (y0 + friezeY) / 2, c[0] - a, friezeY - y0, SKIN, brickD);
            a = c[1];
          }
          const b1 = f.span / 2 + SKIN;
          if (b1 - a > 0.02) F.box(ctx, f, (a + b1) / 2, (y0 + friezeY) / 2, b1 - a, friezeY - y0, SKIN, brickD);
          // spandrel bands: under the first sill, between head and sill,
          // over the last head (one box per storey across the face)
          let prev = y0;
          for (let k = k0; k < ST; k++) {
            const S = F.storey(ctx, k);
            if (S.sill - prev > 0.02) F.band(ctx, f, (prev + S.sill) / 2, S.sill - prev, SKIN, brickD, SKIN * 2);
            prev = S.head;
          }
          if (friezeY - prev > 0.02) F.band(ctx, f, (prev + friezeY) / 2, friezeY - prev, SKIN, brickD, SKIN * 2);
        }

        // ---- piers: on every bay line, belt to frieze -----------------
        for (const t of lines) {
          const pw = (t === lines[0] || t === lines[lines.length - 1]) ? pierW + margin * 0.5 : pierW;
          const tt = t === lines[0] ? t - margin * 0.25 : t === lines[lines.length - 1] ? t + margin * 0.25 : t;
          F.rib(ctx, f, tt, y0, friezeY, pw, PIER_P, brick);
          // a stone cap where the pier meets the corbel table
          F.box(ctx, f, tt, friezeY - 0.12, pw + 0.08, 0.24, PIER_P + 0.04, stone);
        }

        // ---- per storey: the sill course and the head ----------------
        for (let k = k0; k < ST; k++) {
          const S = F.storey(ctx, k);
          // a continuous limestone sill course, piers standing in front of it
          F.band(ctx, f, S.sill - 0.06, 0.12, 0.09, stone, 0.1);
          if (loft || ST > 7) {
            // a stone lintel course across the heads
            F.band(ctx, f, S.head + 0.11, 0.22, 0.07, stoneD, 0.1);
          } else {
            for (const b of bays) {
              if (k === 0 && !F.clearsDoor(ctx, f, b.t, ww + 0.6)) continue;
              // a segmental brick arch of three stepped courses (the rowlock
              // rings of a jack arch) and a stone keystone: four boxes
              const rise = Math.min(0.26, ww * 0.2);
              for (let i = 0; i < 3; i++) {
                F.box(ctx, f, b.t, S.head + 0.06 + i * rise / 3, ww * (1.14 - i * 0.2) + 0.2, rise / 3 + 0.08, 0.07, brickL);
              }
              F.box(ctx, f, b.t, S.head + rise * 0.6, 0.2, rise * 1.2 + 0.08, 0.1, stone);
            }
          }
        }
      }

      // ---- the water table: a stone plinth at grade --------------------
      F.ring(ctx, 0.24, 0.48, 0.1, stoneD, 0.2);
      // a belt course over the ground storey of a block with no storefront
      if (!shop && ST > 1) F.ring(ctx, FH - 0.08, 0.2, 0.12, stone, 0.24);

      // ============================================================
      //  2. THE CORNICE + PARAPET
      // ============================================================
      // a corbelled brick frieze under the cornice: three stepped courses
      for (let i = 0; i < 2; i++) F.ring(ctx, friezeY + 0.08 + i * 0.16, 0.16, PIER_P + 0.05 + i * 0.07, brickL, 0.3);
      F.cornice(ctx, friezeY + 0.32, { h: CORN_H * 0.85, proj: metalCornice ? 0.72 : 0.55, col: corniceCol,
        dark: F.shade(corniceCol, 0.62), frieze: 0, teeth: metalCornice ? "modillion" : "dentil" });
      {
        const ph = Math.min(1.1, Math.max(0.8, FH * 0.28));
        F.parapet(ctx, ph, 0.3, brick, stone);
        // the name/date panel on the street face, inside the parapet
        if (df.span > 9) F.box(ctx, df, 0, rTop + ph * 0.5, Math.min(df.span * 0.3, 6), ph * 0.55, 0.06, stone, 0);
      }

      // ============================================================
      //  3. THE FIRE ESCAPE — one flank, deterministic side
      // ============================================================
      if (ST > 2) {
        const flanks = F.flanks(ctx);
        const f = flanks[(ctx.hash(0x5f13) * flanks.length) | 0] || flanks[0];
        const landW = Math.min(f.span * 0.34, 3.0);
        const dep = 0.95;
        const off = f.span * 0.24;
        const railH = 0.95;
        const barr = 0.06;
        for (let k = 1; k < ST; k++) {
          const y = k * FH - 0.1;
          const sgn = (k % 2) ? 1 : -1;
          const t = sgn * off;
          F.box(ctx, f, t, y, landW, barr * 1.3, dep, iron);
          for (const rl of [0.55, 1.0]) F.box(ctx, f, t, y + railH * rl, landW, barr, barr, iron, dep - barr);
          for (const p of [-0.5, 0, 0.5]) F.rib(ctx, f, t + p * (landW - barr), y, y + railH, barr, barr, iron, dep - barr);
          for (const p of [-0.42, 0.42]) F.rib(ctx, f, t + p * landW, y - 0.9, y, barr, barr * 1.2, iron);
          const yb = (k - 1) * FH - 0.1;
          const tb = -sgn * off;
          const runs = 7;
          const y1 = (k === 1) ? yb + FH * 0.42 : yb;    // the drop ladder hangs high
          for (let i = 0; i < runs; i++) {
            const u = (i + 0.5) / runs;
            const tt = t + (tb - t) * u;
            const yy = y - (y - y1) * u;
            const len = (Math.abs(tb - t) / runs) * 1.2;
            F.box(ctx, f, tt, yy, len, barr * 1.1, dep * 0.62, iron, dep * 0.18);
            F.box(ctx, f, tt, yy + railH * 0.9, len, barr, barr, iron, dep * 0.18 + dep * 0.62 - barr);
            // THE DROP LADDER IS SOLID WHERE IT HANGS INTO YOU: one banded
            // body per low tread, on its own drawn footprint (head-height
            // treads you duck round; the high end stays open to walk under).
            const under = yy - barr * 0.55;
            if (k === 1 && under < 2.1) {
              const top = yy + railH * 0.9 + barr / 2;
              F.solidBox(ctx, f, tt, (under + top) / 2, len, top - under, dep * 0.62, dep * 0.18, { noCam: true });
            }
          }
        }
      }
    },
  });
})();
