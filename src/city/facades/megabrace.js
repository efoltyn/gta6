/* ============================================================
   city/facades/megabrace.js — "Braced Tube": the John Hancock Center,
   Chicago (SOM: Bruce Graham + Fazlur Khan, 1969).

   REFERENCES
     http://khan.princeton.edu/khanHancock.html
     https://www.architecture.org/online-resources/buildings-of-chicago/875-n-michigan-ave
     https://en.wikipedia.org/wiki/Tube_(structure)
     https://www.britannica.com/topic/John-Hancock-Center

   THE STRUCTURE IS THE ELEVATION
     Khan tied the perimeter columns together with diagonals in the plane of
     each wall: a TRUSSED TUBE. On the 100-storey original there are five
     X's per face, each about 18-20 storeys tall and the full width of the
     face; at every point where the diagonals meet the corner columns a
     horizontal TIE (a deep spandrel beam, clad the same as the diagonal)
     wraps the building. "The diagonals, spandrels and columns are clearly
     articulated to depict the primary elements of the tube." Everything is
     black anodised aluminium; the glass is bronze-tinted; the windows sit
     between closely spaced mullions (~1.5 m) and slim floor spandrels.

     The tower TAPERS (40,000 sq ft at the base to 18,000 at the top). The
     shell here is a fixed prism, so the taper is carried by the structure's
     projection off the wall: corner columns and diagonals stand 0.85 m proud
     at the base and 0.35 m at the roof, stepping in at every tie — a real
     taper of the outline, kept inside a 1 m reach of the lot.

   WHAT THE GRAMMAR LAYS (all metres)
     * corner megacolumns, 1.6 m each way, segment per X zone
     * X's: one per ~14 storeys per face (2-3 on a game tower), diagonals
       1.2 m wide as stepped blocks, a node block where they cross
     * ties: 1.1 m deep bands at every zone line, same projection as the X
     * floor spandrels: 1.07 m flush bands; mullion webs every 1.5 m — the
       host glazes each vision band as a "curtain" ribbon behind them
     * a two-storey lobby behind the columns on a black granite base
     * the crown: a stepped louvred mechanical block (the taper continuing)
       and the twin antenna masts

   PALETTES (ctx.hash): Hancock black + bronze glass; dark bronze; 1970s
   clear-anodised silver. ctx.color only tints.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const PALETTES = [
    { metal: 0x2a2c2f, metalL: 0x3d4044, spand: 0x313437, frame: 0x1e2124, stone: 0x3a3634 },
    { metal: 0x3b3128, metalL: 0x544638, spand: 0x3a3029, frame: 0x4a3a28, stone: 0x4a4440 },
    { metal: 0x7c8389, metalL: 0x9aa1a6, spand: 0x6a7076, frame: 0x9aa1a6, stone: 0x6d6a66 },
  ];

  CBZ.registerFacade("megabrace", {
    label: "Braced Tube",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a braced tube is diagonal steel megabracing.
    structure: "steel",
    crownsRoof: true,
    minStoreys: 20,
    window: "curtain",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const PAL = PALETTES[Math.min(PALETTES.length - 1, (ctx.hash(0x4b01) * PALETTES.length) | 0)];
      const tint = function (c) { return F.mix(c, ctx.color, 0.05); };
      const METAL = tint(PAL.metal), METAL_L = tint(PAL.metalL), SPAND = tint(PAL.spand), STONE = tint(PAL.stone);
      F.windowFrame(ctx, PAL.frame);
      const faces = F.faces(ctx);

      const CW = 1.6;                                  // corner megacolumn, per face
      const BW = 1.2;                                  // diagonal / tie stock
      const SP_DN = 0.45, SP_UP = 0.62;
      const MOD = 1.5;
      const pod = 2, yPod = pod * FH;
      // projection of the structure: the taper
      const env = function (y) { return 0.85 - 0.5 * Math.max(0, Math.min(1, y / Math.max(1, H))); };

      // the X zones: whole storeys, ~14 a zone
      const nz = Math.max(2, Math.round((ST - pod) / 14));
      const zk = [];
      for (let i = 0; i <= nz; i++) zk.push(pod + Math.round((ST - pod) * i / nz));

      // ================================================================
      //  1. LOBBY + BASE
      // ================================================================
      for (const f of faces) {
        for (let k = 0; k < pod; k++) F.windowStyle(ctx, f.s, k, "lobby");
        F.band(ctx, f, 0.3, 0.6, 0.08, STONE, 0.16);
        F.band(ctx, f, FH - 0.1, 0.5, 0.06, METAL, 0.12);          // the lobby's mezzanine rail
      }
      F.corners(ctx, yPod / 2, yPod, CW, env(0) + 0.05, METAL);

      // ================================================================
      //  2. FLOOR SPANDRELS + MULLIONS
      // ================================================================
      const tieK = new Set(zk);
      for (const f of faces) {
        for (let k = pod; k <= ST; k++) {
          if (tieK.has(k)) continue;                     // the tie is laid below
          const y0 = k * FH - SP_DN, y1 = Math.min(k * FH + SP_UP, H);
          if (y1 - y0 > 0.05) F.band(ctx, f, (y0 + y1) / 2, y1 - y0, 0.05, SPAND, 0.05);
        }
        const a = -f.span / 2 + CW, b = f.span / 2 - CW;
        const n = Math.max(2, Math.round((b - a) / MOD));
        for (let i = 1; i < n; i++) F.rib(ctx, f, a + (b - a) * i / n, yPod + SP_UP, H, 0.08, 0.13, METAL_L);
      }

      // ================================================================
      //  3. THE TUBE — corner columns, X's, ties, zone by zone
      // ================================================================
      for (let z = 0; z < nz; z++) {
        const y0 = zk[z] * FH, y1 = zk[z + 1] * FH;
        const P = env((y0 + y1) / 2);
        F.corners(ctx, (y0 + y1) / 2, y1 - y0, CW, P + 0.05, METAL);
        for (const f of faces) {
          const a = f.span / 2 - CW - BW * 0.3;
          const ya = y0 + 0.6, yb = y1 - 0.6;
          const n = Math.max(6, Math.round(Math.hypot(2 * a, yb - ya) / 1.4));
          for (const dir of [1, -1]) {
            for (let s = 0; s < n; s++) {
              const u = (s + 0.5) / n, t = dir * (-a + 2 * a * u), y = ya + (yb - ya) * u;
              F.box(ctx, f, t, y, (2 * a) / n + BW * 0.55, (yb - ya) / n + BW * 0.55, P, METAL);
            }
          }
          // the node where the diagonals cross
          F.box(ctx, f, 0, (ya + yb) / 2, BW * 1.9, BW * 1.9, P + 0.06, METAL_L);
        }
      }
      // ties at every zone line (and the roof), wrapping all four faces
      for (let i = 0; i <= nz; i++) {
        const y = zk[i] * FH;
        const y0 = y - SP_DN, y1 = Math.min(y + SP_UP, H + 0.3);
        F.ring(ctx, (y0 + y1) / 2, y1 - y0, env(y), METAL, env(y) + 0.1);
      }

      // ================================================================
      //  4. THE CROWN — the taper continued, the twin masts
      // ================================================================
      {
        const R = F.roof(ctx);
        let w = R.w * 0.86, d = R.d * 0.86, y = R.y;
        for (let s = 0; s < 2; s++) {
          const h = s === 0 ? FH * 2 : FH * 1.1;
          ctx.dbox(R.cx, y + h / 2, R.cz, w, h, d, F.shade(METAL, 0.8));
          for (let yy = y + 0.5; yy < y + h - 0.3; yy += 0.5) ctx.dbox(R.cx, yy, R.cz, w + 0.14, 0.18, d + 0.14, METAL);
          ctx.dbox(R.cx, y + h + 0.12, R.cz, w + 0.3, 0.24, d + 0.3, METAL_L);
          y += h + 0.24; w *= 0.72; d *= 0.72;
        }
        const mh = Math.max(12, Math.min(H * 0.13, 40));
        for (const sg of [-1, 1]) {
          const mx = R.cx + sg * w * 0.35, mz = R.cz;
          ctx.dbox(mx, y + 1.0, mz, 1.0, 2.0, 1.0, METAL_L);
          ctx.column(mx, y + 2.0, mz, 0.32, mh, 0xd6d8da, 8);
          ctx.lamp(mx, y + 2.0 + mh + 0.4, mz, 0.4, 0xff4a30);
        }
      }
    },
  });
})();
