/* ============================================================
   city/facades/faceted.js — "Faceted Prism": the Bank of China Tower,
   Hong Kong (I. M. Pei, 1990), and the triangulated towers after it.

   REFERENCES
     https://en.wikipedia.org/wiki/Bank_of_China_Tower_(Hong_Kong)
     https://www.archdaily.com/785840/ad-classics-bank-of-china-tower-i-m-pei
     https://en.wikipedia.org/wiki/Tube_(structure)

   WHAT IT IS
     A square plan cut into four triangular quadrants that stop at four
     heights, each ending in a SLOPED glass top; the structure is a
     triangulated space frame whose members are expressed on every face as
     bright aluminium bands: corner columns, ONE column up the middle of each
     face, and diagonals that make each face a stack of big diamonds, each
     module about 12-13 storeys tall, with a horizontal band at every module
     line. The infill is blue-silver reflective glass; the base is a heavy
     grey granite podium with large openings.

   HOW IT IS DRAWN (metres)
     * podium: 2 storeys of granite cladding laid round large lobby openings
       (F.cladAround, 4 m bays, "lobby" glazing), a base course
     * shaft: 1.07 m blue-silver spandrel at every floor line, mullion webs
       every 1.5 m (the host glazes each vision band as a curtain ribbon);
       structure 0.9 m wide standing 0.3 m proud: corner columns, the mid-
       face column, an X per module, a 1.07 m band at each module line
     * crown: the shell is a box to ctx.rTop, so two of the four quadrants
       rise above it as real volumes (+10% and +18% of the height), each with
       a stepped SLOPED top running down to the outside, the module band and
       floor bands carried round them; twin masts on the taller one. The
       other two quadrants end at the roof behind a parapet, the deck clear.

   PALETTES (ctx.hash): blue-silver (Bank of China), green-silver, smoke grey.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const PALETTES = [
    { rib: 0xc4c9ce, spand: 0x4f6273, body: 0x3a4b5a, frame: 0x9aa1a6, stone: 0x77736d },
    { rib: 0xbfc6c3, spand: 0x4a6660, body: 0x34504b, frame: 0x9aa1a6, stone: 0x6f6c66 },
    { rib: 0x9aa0a6, spand: 0x4a4f55, body: 0x363b41, frame: 0x2c3034, stone: 0x5d5a57 },
  ];

  CBZ.registerFacade("faceted", {
    label: "Faceted Prism",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a faceted prism is a unitised curtain wall on a steel core.
    structure: "glassbox",
    crownsRoof: true,
    minStoreys: 18,
    window: "curtain",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const PAL = PALETTES[Math.min(PALETTES.length - 1, (ctx.hash(0xfa01) * PALETTES.length) | 0)];
      const tint = function (c) { return F.mix(c, ctx.color, 0.06); };
      const RIB = tint(PAL.rib), RIB_D = F.shade(RIB, 0.78), SPAND = tint(PAL.spand), BODY = tint(PAL.body);
      const STONE = tint(PAL.stone), STONE_D = F.shade(STONE, 0.7);
      F.windowFrame(ctx, PAL.frame);
      const faces = F.faces(ctx);

      const RW = 0.9, RP = 0.3;                 // structural member width / projection
      const SP_DN = 0.45, SP_UP = 0.62, MOD = 1.5;
      const pod = 2, yPod = pod * FH;
      const nm = Math.max(2, Math.round((ST - pod) / 12));
      const mk = [];
      for (let i = 0; i <= nm; i++) mk.push(pod + Math.round((ST - pod) * i / nm));
      const modLine = new Set(mk);

      // a stepped diagonal on face f from (t0, y0) to (t1, y1)
      function diag(f, t0, y0, t1, y1, wid, proj, col) {
        const n = Math.max(5, Math.round(Math.hypot(t1 - t0, y1 - y0) / 1.3));
        for (let s = 0; s < n; s++) {
          const u = (s + 0.5) / n;
          F.box(ctx, f, t0 + (t1 - t0) * u, y0 + (y1 - y0) * u, Math.abs(t1 - t0) / n + wid * 0.55, Math.abs(y1 - y0) / n + wid * 0.55, proj, col);
        }
      }

      // ================================================================
      //  1. THE GRANITE PODIUM
      // ================================================================
      for (const f of faces) {
        const n = Math.max(2, Math.round((f.span - 2) / 4.2));
        for (let k = 0; k < pod; k++) {
          F.windowStyle(ctx, f.s, k, "lobby");
          const S = F.storey(ctx, k, 0.6);
          const row = F.openRow(ctx, f, n, 3.0, 1.2, k);
          const y0 = k * FH, y1 = (k + 1) * FH + (k === pod - 1 ? SP_UP : 0);
          F.cladAround(ctx, f, y0, y1, row.map((r) => ({ t0: r.t0, t1: r.t1, y0: S.sill, y1: S.head })), 0.14, STONE);
          for (const r of row) F.box(ctx, f, r.t, S.sill - 0.06, r.w + 0.3, 0.12, 0.22, STONE_D);
        }
        F.band(ctx, f, 0.3, 0.6, 0.2, STONE_D, 0.2);                       // base course
        F.band(ctx, f, yPod + SP_UP + 0.1, 0.2, 0.26, F.shade(STONE, 1.1), 0.26);   // podium coping
      }

      // ================================================================
      //  2. THE SHAFT — floor bands, mullions, the triangulated frame
      // ================================================================
      for (const f of faces) {
        for (let k = pod + 1; k <= ST; k++) {
          if (modLine.has(k)) continue;
          const y0 = k * FH - SP_DN, y1 = Math.min(k * FH + SP_UP, H);
          if (y1 - y0 > 0.05) F.band(ctx, f, (y0 + y1) / 2, y1 - y0, 0.05, SPAND, 0.05);
        }
        const a = -f.span / 2 + RW, b = f.span / 2 - RW;
        const n = Math.max(2, Math.round((b - a) / MOD));
        for (let i = 1; i < n; i++) F.rib(ctx, f, a + (b - a) * i / n, yPod + SP_UP, H, 0.07, 0.12, RIB_D);
        // the mid-face column
        F.rib(ctx, f, 0, yPod + SP_UP, H, RW, RP, RIB);
        // one diamond per module: corner -> mid -> corner
        for (let m = 0; m < nm; m++) {
          const y0 = mk[m] * FH + SP_UP, y1 = mk[m + 1] * FH - SP_DN, ym = (y0 + y1) / 2;
          const e = f.span / 2 - RW / 2;
          diag(f, -e, y0, 0, ym, RW, RP, RIB);
          diag(f, 0, ym, e, y1, RW, RP, RIB);
          diag(f, e, y0, 0, ym, RW, RP, RIB);
          diag(f, 0, ym, -e, y1, RW, RP, RIB);
          F.box(ctx, f, 0, ym, RW * 1.8, RW * 1.8, RP + 0.05, RIB);        // the node
        }
      }
      for (const k of mk) {
        if (k === pod) continue;
        const y = k * FH;
        F.ring(ctx, y + (SP_UP - SP_DN) / 2, SP_UP + SP_DN, RP, RIB, RP + 0.1);
      }
      F.corners(ctx, (yPod + H) / 2, H - yPod, RW, RP, RIB);

      // ================================================================
      //  3. THE CUT CROWN — two quadrants rise with sloped tops
      // ================================================================
      {
        const R = F.roof(ctx);
        const qw = ctx.w / 2, qd = ctx.d / 2;
        const rot = Math.min(3, (ctx.hash(0xfa02) * 4) | 0);
        const Q = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        const qa = Q[rot], qb = Q[(rot + 2) % 4];                 // diagonally opposite
        const snap = (h) => Math.max(FH, Math.round(h / FH) * FH);
        const rise = [snap(H * 0.10), snap(H * 0.18)];
        // a stepped wedge: full at its inner edge, sloping down to the
        // outside along `axis`
        function wedge(cx, cz, w, d, y, h, axis, dir, col, cap) {
          const steps = 6;
          for (let i = 0; i < steps; i++) {
            const fr = 1 - i / steps;
            const L = (axis === 0 ? w : d) * fr;
            const ox = axis === 0 ? cx - dir * ((w - L) / 2) : cx;
            const oz = axis === 2 ? cz - dir * ((d - L) / 2) : cz;
            ctx.dbox(ox, y + (i + 0.5) * h / steps, oz, axis === 0 ? L : w, h / steps + 0.02, axis === 2 ? L : d, col);
            // the bright edge rib along the slope
            const ex = axis === 0 ? ox + dir * L / 2 : cx, ez = axis === 2 ? oz + dir * L / 2 : cz;
            ctx.dbox(ex, y + (i + 1) * h / steps - 0.1, ez, axis === 0 ? 0.5 : w + 0.1, 0.24, axis === 2 ? 0.5 : d + 0.1, cap);
          }
        }
        [qa, qb].forEach(function (q, i) {
          const cx = q[0] * qw / 2, cz = q[1] * qd / 2, h = rise[i];
          const top = H + h;
          ctx.dbox(cx, (H + top) / 2, cz, qw, h, qd, BODY);
          for (let y = H + FH; y < top - 0.3; y += FH) ctx.dbox(cx, y + (SP_UP - SP_DN) / 2, cz, qw + 0.1, SP_UP + SP_DN, qd + 0.1, SPAND);
          // corner + mid ribs on the outer faces
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) ctx.dbox(cx + sx * qw / 2, (H + top) / 2, cz + sz * qd / 2, RW * 0.8, h, RW * 0.8, RIB);
          const axis = i === 0 ? 0 : 2, dir = i === 0 ? q[0] : q[1];
          wedge(cx, cz, qw, qd, top, Math.min(qw, qd) * 0.55, axis, dir, BODY, RIB);
          if (i === 1) {
            const mh = Math.max(10, Math.min(H * 0.1, 36));
            for (const sg of [-1, 1]) {
              const mx = cx + (axis === 0 ? 0 : sg * qw * 0.2), mz = cz + (axis === 2 ? 0 : sg * qd * 0.2);
              ctx.column(mx, top, mz, 0.3, Math.min(qw, qd) * 0.55 + mh, 0xd6d8da, 8);
              ctx.lamp(mx, top + Math.min(qw, qd) * 0.55 + mh + 0.4, mz, 0.36, 0xff4a30);
            }
          }
        });
        // the low quadrants end at the roof in a sloped parapet wedge
        for (let i = 0; i < 4; i++) {
          if (i === rot || i === (rot + 2) % 4) continue;
          const q = Q[i];
          // a parapet along its two outer edges (the deck inside stays clear)
          const cx = q[0] * qw / 2, cz = q[1] * qd / 2, ph = 1.3;
          ctx.dbox(cx, H + ph / 2, q[1] * (qd - 0.2), qw, ph, 0.4, BODY);
          ctx.dbox(q[0] * (qw - 0.2), H + ph / 2, cz, 0.4, ph, qd, BODY);
          ctx.dbox(cx, H + ph + 0.08, q[1] * (qd - 0.2), qw + 0.1, 0.16, 0.5, RIB);
          ctx.dbox(q[0] * (qw - 0.2), H + ph + 0.08, cz, 0.5, 0.16, qd + 0.1, RIB);
        }
        void R;
      }
    },
  });
})();
