/* ============================================================
   city/facades/palazzo.js — "Florentine Palazzo": Medici-Riccardi, Strozzi.

   THE READ. A merchant bank pretending to be a fortress. One cube, one
   colour, no columns, no portico — and it is unmistakable anyway, because of
   three things this file spends its entire budget on:

     1. THE WALL GETS SMOOTHER AS IT RISES, AND YOU SEE IT IN THE SHADOW.
        Rock-faced bugnato at the ground (each block a separate lump with its
        own projection, hashed, so the base is a cliff), CHANNELLED courses in
        the middle (flat beds, but every horizontal AND vertical joint cut as
        a deep dark groove), near-ashlar at the top (a hairline joint and
        nothing else). It is one material and three finishes, and the eye
        reads it as the building calming down. Doing it in COLOUR alone is the
        failure mode: at noon a painted stripe is invisible and the whole
        argument disappears, so every zone differs in PROJECTION first.
     2. BIFORA. Round-arched twin lights under one enclosing arch, with a
        colonnette between them and a roundel in the tympanum. This is the
        Quattrocento window and nothing else in the kit draws it.
     3. THE CORNICE, WHICH IS ENORMOUS. Strozzi's oversails about 2 m on a
        30 m wall. It is sized off the host's own plan (unit * 0.11) and its
        job is to throw a hard band of shade — so the frieze under it is
        painted as a deep shadow course, which is what makes the oversail read
        from the pavement instead of only from the air.

   WALL MODE "frame": the shell punches real openings with a lit room behind
   them, and this facade sets the bifora tracery, sills and arches around
   those exact holes — the opening geometry below is recomputed from
   buildings.js's own punched-window rule (margin 0.7, ~2.6 m bay, 68% of the
   cell, sill 1.05, header 0.70), so the ornament lands on the glass and not
   next to it. Get that wrong and you get two unrelated drawings on one wall.

   CHAINED QUOINS at every corner tie the four faces into one block — the
   cantonale a catena, long and short courses alternating to the cornice.

   SOLIDITY: the base courses, their bosses and the portal jambs are the mass
   a player walks into and go out SOLID. Everything above head height —
   tracery, arches, string courses, the whole cornice — is free deco; sbox
   would refuse those colliders anyway.

   COST: zero minted meshes. Every line here is a merged box.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("palazzo", {
    label: "Florentine Palazzo",
    era: "renaissance",
    structure: "stone",
    wall: "frame",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, unit = Math.min(ctx.w, ctx.d);
      const P = F.palette(ctx, "sandstone", { pull: 0.70, grain: 0.15 });
      const e = F.entrance(ctx);
      const yTop = H - 0.62;                       // wall head, clear of the top window

      /* THE SHELL'S OWN PUNCHED OPENINGS, recomputed (buildings.js:4144). The
         tracery has to land on the real hole or the wall reads as two
         drawings; there is no way to ask the shell, so we derive it the same
         way it did, from the face's own span. */
      const wins = function (f) {
        const us = f.span - 1.4, n = Math.max(1, Math.round(us / 2.6)), cell = us / n, out = [];
        for (let i = 0; i < n; i++) out.push({ t: -us / 2 + (i + 0.5) * cell, w: Math.min(2.0, cell * 0.68) });
        return out;
      };

      // THE THREE FINISHES. Zone by height, and the projections are the whole
      // point: 3x at the foot, 1x at the head.
      const PB = clamp(unit * 0.030, 0.26, 0.52), PM = PB * 0.55, PT = PB * 0.28;
      const nB = ctx.storeys >= 6 ? 2 : 1;
      const zY = [Math.min(nB * FH, yTop * 0.52),
        Math.min((nB + Math.max(1, Math.round((ctx.storeys - nB) * 0.55))) * FH, yTop * 0.84)];
      const zone = function (y) { return y < zY[0] ? 0 : (y < zY[1] ? 1 : 2); };

      // ---- A. THE WALL, COURSE BY COURSE --------------------------
      const cH = clamp(FH / 4.6, 0.50, 0.90);
      const nC = Math.max(3, Math.round(yTop / cH)), ch = yTop / nC;
      for (const f of F.faces(ctx)) {
        const ws = wins(f);
        for (let c = 0; c < nC; c++) {
          const y0 = c * ch, cy = y0 + ch / 2, z = zone(cy), pr = z === 0 ? PB : (z === 1 ? PM : PT);
          const holes = F.doorHoles(ctx, f, 0.9);
          for (const wd of ws) {
            for (let k = 0; k < ctx.storeys; k++) {
              if (cy + ch / 2 > k * FH + 0.96 && cy - ch / 2 < (k + 1) * FH - 0.06) {
                holes.push([wd.t - wd.w / 2 - 0.30, wd.t + wd.w / 2 + 0.30]); break;
              }
            }
          }
          const free = function (t, w) {
            for (const q of holes) if (t + w / 2 > q[0] && t - w / 2 < q[1]) return false;
            return true;
          };
          F.segBand(ctx, f, cy, ch - 0.05, pr, P.course(c), holes, 0.12, 0, cy < 2.6);
          // the bed joint under every course — the deep one is what says stone
          F.segBand(ctx, f, y0 + 0.04, z === 1 ? 0.15 : 0.09, pr * (z === 1 ? 0.30 : 0.58),
            F.shade(P.shadow, z === 2 ? 1.10 : 0.78), holes, 0.08, 0);
          // the individual STONES. Rock-faced blocks bulge by their own hashed
          // amount; channelled ones are flat and only their vertical joint is
          // cut; ashlar gets neither, which is why the top storey goes quiet.
          if (z === 2) continue;
          const bn = Math.max(3, Math.round(f.span / (ch * (z === 0 ? 1.7 : 2.5))));
          const bw = f.span / bn;
          for (let i = 0; i < bn; i++) {
            const t = -f.span / 2 + (i + 0.5) * bw, s = 0x7a10 + f.s * 41 + c * 7 + i;
            if (z === 0) {
              if (!free(t, bw)) continue;
              const bp = pr + 0.06 + ctx.hash(s) * 0.26;
              (cy < 2.6 ? F.sBox : F.box)(ctx, f, t, cy, bw - 0.11, ch - 0.15, bp, P.course(c * 5 + i));
              F.box(ctx, f, t, cy - ch * 0.30, bw - 0.11, 0.08, bp + 0.02, F.shade(P.shadow, 0.8));
            } else if (free(t - bw / 2, 0.2)) {
              F.box(ctx, f, t - bw / 2, cy, 0.13, ch - 0.05, pr * 0.34, F.shade(P.shadow, 0.8));
            }
          }
        }
        // marcapiano: the string course that ends each finish
        for (const y of zY) F.band(ctx, f, y + 0.10, 0.24, (y < zY[1] ? PB : PM) + 0.16, P.light, 0.4);
      }

      // ---- B. THE BIFORA ------------------------------------------
      // Enclosing arch, two lights, a colonnette, a roundel. Ground floor gets
      // a voussoired flat head instead: on a palazzo the street storey is the
      // counting house, and it is deliberately the plainest thing on the wall.
      for (const f of F.faces(ctx)) {
        for (const wd of wins(f)) {
          for (let k = 0; k < ctx.storeys; k++) {
            const y1 = (k + 1) * FH - 0.70, y0 = k * FH + 1.05;
            if (y1 > yTop - 0.1 || !F.clearsDoor(ctx, f, wd.t, wd.w + 1.2)) continue;
            const pr = (zone(y1) === 0 ? PB : zone(y1) === 1 ? PM : PT) + 0.12;
            F.box(ctx, f, wd.t, y0 - 0.16, wd.w + 0.62, 0.20, pr + 0.16, P.light);       // sill
            if (k === 0) {
              for (let v = -2; v <= 2; v++) {                                            // voussoirs
                F.box(ctx, f, wd.t + v * (wd.w + 0.3) * 0.19, y1 + 0.22 + Math.abs(v) * 0.02,
                  (wd.w + 0.3) * 0.18, 0.44 - Math.abs(v) * 0.03, pr + 0.06, v ? P.light : F.mix(P.light, 0xffffff, 0.2));
              }
              continue;
            }
            const sp = y1 - 0.26, rise = Math.min(wd.w * 0.54, (k + 1) * FH - 0.14 - sp);
            if (rise < 0.28) continue;
            F.arch(ctx, f, wd.t, sp, wd.w + 0.18, rise, 0.17, pr + 0.04, P.light, "round");
            F.rib(ctx, f, wd.t, y0, y1 - 0.38, 0.19, pr + 0.10, P.light);                // colonnette
            F.box(ctx, f, wd.t, y1 - 0.44, 0.42, 0.17, pr + 0.16, P.light);              // its capital
            for (const sg of [-1, 1]) {
              F.arch(ctx, f, wd.t + sg * wd.w * 0.25, y1 - 0.36, wd.w * 0.40, wd.w * 0.19,
                0.08, pr + 0.08, P.light, "round");
            }
            F.box(ctx, f, wd.t, y1 + rise * 0.30, 0.30, 0.30, pr + 0.10, P.shadow);      // roundel
          }
        }
      }

      // ---- C. CHAINED QUOINS --------------------------------------
      const qH = Math.max(0.44, cH * 1.15), qN = Math.max(3, Math.floor(yTop / qH));
      for (let i = 0; i < qN; i++) {
        const long = (i % 2) === 0;
        F.corners(ctx, (i + 0.5) * qH, qH * 0.90, long ? qH * 2.2 : qH * 1.2,
          PB + 0.10, long ? P.light : P.course(i + 3));
      }

      // ---- D. THE PORTAL ------------------------------------------
      // One big round-arched hole with a voussoired head. The kit carves the
      // real doorway out of everything laid across it, so the jambs may run
      // full width; they are the only solid mass on the entrance axis.
      {
        const pw = e.gap + 1.5, sp = Math.min(e.head + 0.5, FH - 1.0), rs = Math.min(pw * 0.5, FH - sp - 0.2);
        F.box(ctx, e.f, 0, sp / 2, pw, sp, 0.06, F.shade(P.shadow, 0.72));
        for (const sg of [-1, 1]) F.sRib(ctx, e.f, sg * (pw / 2 + 0.34), 0.05, sp + 0.1, 0.72, PB + 0.16, P.light);
        if (rs > 0.3) {
          F.arch(ctx, e.f, 0, sp, pw, rs, 0.24, PB + 0.20, P.light, "round");
          F.box(ctx, e.f, 0, sp + rs * 0.92, pw * 0.17, rs * 0.80, PB + 0.32, F.mix(P.light, 0xffffff, 0.22));
        }
      }

      // ---- E. THE CORNICE -----------------------------------------
      // The frieze under it is painted as SHADOW, not stone: that dark band is
      // what an oversailing cornice actually does to the wall below it, and
      // without it the deepest cornice in the kit reads as a flat white lip.
      const CP = clamp(unit * 0.11, 0.85, 2.20);
      F.ring(ctx, H - 0.37, 0.50, PT + 0.05, F.shade(P.shadow, 0.66), 0.2);
      F.ring(ctx, yTop + 0.10, 0.22, PM + 0.18, P.light, 0.4);
      for (const f of F.faces(ctx)) {
        const n = Math.max(4, Math.round(f.span / clamp(unit * 0.055, 0.80, 1.45))), st = f.span / n;
        for (let i = 0; i <= n; i++) {                       // modillions carrying the corona
          const t = -f.span / 2 + st * i;
          F.box(ctx, f, t, yTop + 0.46, st * 0.34, 0.46, CP * 0.70, P.light);
          F.box(ctx, f, t, yTop + 0.46, st * 0.17, 0.52, CP * 0.88, F.shade(P.light, 0.86));
        }
        F.band(ctx, f, yTop + 0.26, 0.22, CP * 0.94, F.shade(P.shadow, 0.62), 0.6);   // the soffit
      }
      F.ring(ctx, yTop + 0.86, 0.42, CP, P.light, 0.7);                               // corona
      F.ring(ctx, yTop + 1.14, 0.20, CP * 0.86, F.shade(P.light, 0.90), 0.7);         // cyma
    },
  });
})();
