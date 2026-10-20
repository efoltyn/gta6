/* ============================================================
   city/facades/bundled.js — "Bundled Tube": the Sears / Willis Tower,
   Chicago (SOM: Bruce Graham + Fazlur Khan, 1973).

   REFERENCES
     https://www.architecturelab.net/willis-tower-sears-tower-skidmore-owings-merrill/
     https://www.britannica.com/topic/Willis-Tower
     https://www.designingbuildings.co.uk/wiki/Willis_Tower
     http://hiddenarchitecture.net/willis-tower-formerly-sears-tower/

   THE BUNDLE, AS BUILT
     Nine 75 ft (23 m) square framed tubes in a 3 x 3 matrix. All nine rise to
     the 50th floor; the NW and SE corner tubes stop there, the other two
     corners at the 66th, three edge tubes at the 90th, and the centre and
     west tubes go on to the 108th. The skin is BLACK ANODISED ALUMINIUM and
     BRONZE-TINTED GLASS; the tube walls show as heavier black lines down the
     elevation; three bands of black louvres (the belt-truss / mechanical
     floors, ~29-31, 64-65, 88-89) cross the whole shaft.

   HOW IT IS DRAWN HERE
     * The shell is one prism to ctx.rTop: that is "everything to the 50th".
       The tube walls are 0.6 m black fins at w/6 and d/6 on every face; each
       tube face between them is its own curtain wall: spandrel bands 1.07 m
       at every floor line, I-section mullions on a ~1.5 m module laid per
       tube face (so the host's frame mullions line up behind them).
     * Two mechanical belts, two storeys each, at 30% and 62% of the height:
       deep black louvre blades, no windows behind them.
     * A two-storey lobby on a black granite base.
     * ABOVE rTop the stagger is real volume, compressed to a quarter of the
       shell's height so the bundle stays a tower and not two stacked:
         level 0  two diagonal corner tubes stop at the roof
         level 1  the other two corners, +9% of the height
         level 2  three edge tubes, +17%
         level 3  the centre tube and one edge tube, +25%, with the twin masts
       Which diagonal drops first and which edge tube joins the centre are
       the only hash-chosen facts. Each roof tube wears the same floor bands
       and mullions as the shaft and ends in a parapet with plant.

   PALETTES (ctx.hash): black aluminium + bronze glass (Willis), dark bronze
   (the other SOM towers of the 70s), graphite. ctx.color only tints.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const PALETTES = [
    { metal: 0x26282b, metalL: 0x3a3d41, spand: 0x2e3033, body: 0x2c2721, frame: 0x1e2124, stone: 0x2e2c2b },
    { metal: 0x3a3027, metalL: 0x50443a, spand: 0x382e26, body: 0x30281f, frame: 0x4a3a28, stone: 0x3e3935 },
    { metal: 0x3f4448, metalL: 0x585e63, spand: 0x3b3f43, body: 0x2a2d30, frame: 0x2c3034, stone: 0x3a3a3a },
  ];

  CBZ.registerFacade("bundled", {
    label: "Bundled Tube",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a bundled tube is nine steel tubes sharing their walls.
    structure: "steel",
    crownsRoof: true,
    minStoreys: 16,
    window: "curtain",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const W = ctx.w, D = ctx.d;
      const PAL = PALETTES[Math.min(PALETTES.length - 1, (ctx.hash(0xb301) * PALETTES.length) | 0)];
      const tint = function (c) { return F.mix(c, ctx.color, 0.05); };
      const METAL = tint(PAL.metal), METAL_L = tint(PAL.metalL), SPAND = tint(PAL.spand), BODY = tint(PAL.body), STONE = tint(PAL.stone);
      F.windowFrame(ctx, PAL.frame);
      const faces = F.faces(ctx);

      const FIN = 0.6, CM = 0.6, MOD = 1.5;
      const SP_DN = 0.45, SP_UP = 0.62;
      const pod = 2, yPod = pod * FH;
      // the mechanical belts: storey indices covered by louvres
      const belts = [];
      for (const fr of [0.30, 0.62]) {
        const k0 = Math.max(pod + 2, Math.round(ST * fr));
        if (k0 + 1 < ST - 1) belts.push(k0, k0 + 1);
      }
      const isBelt = (k) => belts.indexOf(k) >= 0;

      // the three tube faces of a face, between the corner and the joints
      function segs(span) {
        const j = span / 6;
        return [[-span / 2 + CM, -j - FIN / 2], [-j + FIN / 2, j - FIN / 2], [j + FIN / 2, span / 2 - CM]];
      }
      function mullions(f, a, b, y0, y1, inset) {
        const n = Math.max(1, Math.round((b - a) / MOD));
        for (let i = 1; i < n; i++) {
          const t = a + (b - a) * i / n;
          F.rib(ctx, f, t, y0, y1, 0.07, 0.16, METAL, inset || 0);
          F.box(ctx, f, t, (y0 + y1) / 2, 0.18, y1 - y0, 0.04, METAL_L, 0.16 + (inset || 0));
        }
      }

      // ================================================================
      //  1. LOBBY + BASE
      // ================================================================
      for (const f of faces) {
        for (let k = 0; k < pod; k++) F.windowStyle(ctx, f.s, k, "lobby");
        F.band(ctx, f, 0.3, 0.6, 0.08, STONE, 0.16);
        F.band(ctx, f, FH - 0.1, 0.5, 0.06, METAL, 0.12);
        F.band(ctx, f, yPod + (SP_UP - SP_DN) / 2, SP_DN + SP_UP, 0.22, METAL, 0.3);   // the lobby head
      }

      // ================================================================
      //  2. THE SHAFT — tube joints, spandrels, mullions, belts
      // ================================================================
      for (const f of faces) {
        const j = f.span / 6;
        for (const t of [-j, j]) F.rib(ctx, f, t, yPod, H + 0.4, FIN, 0.30, METAL);
        for (let k = pod + 1; k <= ST; k++) {
          const y0 = k * FH - SP_DN, y1 = Math.min(k * FH + SP_UP, H);
          if (y1 - y0 > 0.05) F.band(ctx, f, (y0 + y1) / 2, y1 - y0, 0.05, SPAND, 0.05);
        }
        for (const sg of segs(f.span)) mullions(f, sg[0], sg[1], yPod + SP_UP, H);
        // the louvred belts: deep blades over the whole band, a dark back
        for (const k of belts) {
          const b0 = k * FH + SP_UP, b1 = (k + 1) * FH - SP_DN;
          F.band(ctx, f, (b0 + b1) / 2, b1 - b0, 0.04, F.shade(METAL, 0.6), 0.04);
          for (let y = b0 + 0.1; y < b1 - 0.05; y += 0.24) F.box(ctx, f, 0, y, f.span + 0.08, 0.2, 0.30, METAL_L, 0.07);
        }
      }
      F.corners(ctx, (yPod + H) / 2, H - yPod, CM + 0.05, 0.2, METAL);
      F.corners(ctx, yPod / 2, yPod, CM + 0.05, 0.16, STONE);
      void isBelt;

      // ================================================================
      //  3. THE STAGGER — real tubes standing on the roof
      // ================================================================
      {
        const tw = W / 3, td = D / 3;
        const diagA = ctx.hash(0xb302) < 0.5;
        const corners0 = diagA ? [[0, 0], [2, 2]] : [[0, 2], [2, 0]];
        const corners1 = diagA ? [[0, 2], [2, 0]] : [[0, 0], [2, 2]];
        const edges = [[1, 0], [0, 1], [2, 1], [1, 2]];
        const ei = Math.min(3, (ctx.hash(0xb303) * 4) | 0);
        const snap = (h) => Math.max(FH, Math.round(h / FH) * FH);
        const L1 = snap(H * 0.09), L2 = snap(H * 0.17), L3 = snap(H * 0.25);
        const tubes = [];
        for (const c of corners1) tubes.push({ i: c[0], j: c[1], h: L1 });
        edges.forEach((e, q) => tubes.push({ i: e[0], j: e[1], h: q === ei ? L3 : L2 }));
        tubes.push({ i: 1, j: 1, h: L3 });
        void corners0;
        const tallest = [];
        for (const tb of tubes) {
          const cx = (tb.i - 1) * tw, cz = (tb.j - 1) * td;
          const y0 = H, y1 = H + tb.h;
          ctx.dbox(cx, (y0 + y1) / 2, cz, tw, tb.h, td, BODY);
          // its own curtain wall on the four faces (hidden faces cost little)
          const fs = [
            { s: 0, horiz: true, out: -1, span: tw, halfN: td / 2 }, { s: 1, horiz: true, out: 1, span: tw, halfN: td / 2 },
            { s: 2, horiz: false, out: -1, span: td, halfN: tw / 2 }, { s: 3, horiz: false, out: 1, span: td, halfN: tw / 2 },
          ];
          for (const f of fs) {
            // shift the face into the tube's own frame
            const g = Object.assign({}, f);
            const off = f.horiz ? cz : cx, tOff = f.horiz ? cx : cz;
            g.halfN = f.halfN + f.out * off;
            const bx = function (t, cy, len, h, proj, col, inset) {
              const n = g.halfN + (inset || 0) + proj / 2;
              if (g.horiz) ctx.dbox(tOff + t, cy, g.out * n, len, h, proj, col);
              else ctx.dbox(g.out * n, cy, tOff + t, proj, h, len, col);
            };
            // is this face against a neighbour tube that stands at least as tall? skip
            const ni = tb.i + (f.horiz ? 0 : f.out), nj = tb.j + (f.horiz ? f.out : 0);
            const nb = tubes.find((u) => u.i === ni && u.j === nj);
            if (nb && nb.h >= tb.h) continue;
            for (let y = y0 + FH; y < y1 - 0.2; y += FH) bx(0, y + (SP_UP - SP_DN) / 2, f.span + 0.1, SP_DN + SP_UP, 0.05, SPAND);
            const n = Math.max(2, Math.round((f.span - 2 * CM) / MOD));
            for (let i = 1; i < n; i++) {
              const t = -f.span / 2 + CM + (f.span - 2 * CM) * i / n;
              bx(t, (y0 + y1) / 2, 0.07, tb.h, 0.16, METAL);
            }
            for (const sg of [-1, 1]) bx(sg * (f.span / 2 - CM / 2), (y0 + y1) / 2, CM + 0.05, tb.h, 0.2, METAL);
          }
          // the tube top: parapet + a plant box
          const pp = 1.2;
          ctx.dbox(cx, y1 + pp / 2, cz - td / 2 + 0.15, tw, pp, 0.3, METAL);
          ctx.dbox(cx, y1 + pp / 2, cz + td / 2 - 0.15, tw, pp, 0.3, METAL);
          ctx.dbox(cx - tw / 2 + 0.15, y1 + pp / 2, cz, 0.3, pp, td - 0.6, METAL);
          ctx.dbox(cx + tw / 2 - 0.15, y1 + pp / 2, cz, 0.3, pp, td - 0.6, METAL);
          ctx.dbox(cx, y1 + pp + 0.06, cz, tw + 0.2, 0.12, td + 0.2, METAL_L);
          if (tb.h === L3) tallest.push({ cx: cx, cz: cz, y: y1 });
        }
        // the twin antennas on the two tallest tubes, off their centres
        const mh = Math.max(14, Math.min(H * 0.14, 50));
        for (const t of tallest) {
          const mx = t.cx + tw * 0.25, mz = t.cz - td * 0.25;
          ctx.dbox(mx, t.y + 1.0, mz, 1.2, 2.0, 1.2, METAL_L);
          ctx.column(mx, t.y + 2.0, mz, 0.34, mh, 0xd2d5d8, 8);
          ctx.lamp(mx, t.y + 2.0 + mh + 0.4, mz, 0.4, 0xff4a30);
        }
      }
    },
  });
})();
