/* ============================================================
   city/facades/palazzo.js — "Florentine Palazzo": Medici-Riccardi, Strozzi.

   THE READ. A merchant bank pretending to be a fortress. One cube, one
   colour, no columns, no portico — and unmistakable anyway, because of three
   things this file spends its whole budget on:

     1. THE WALL GETS SMOOTHER AS IT RISES, AND YOU SEE IT IN THE SHADOW.
        Rock-faced bugnato at the ground (every block a separate lump with its
        own hashed projection, so the base is a cliff), CHANNELLED courses in
        the middle (flat beds, but every horizontal AND vertical joint cut as
        a dark groove), near-ashlar at the top (a hairline joint and nothing
        else). One material, three finishes, and the eye reads it as the
        building calming down as it rises. Doing it in COLOUR is the failure
        mode: at noon a painted stripe is invisible and the whole argument
        vanishes, so each zone differs in PROJECTION first — 3x at the foot,
        1x at the head — and only incidentally in tone.
     2. BIFORA. Round-arched twin lights under one enclosing arch, colonnette
        between them, roundel in the tympanum. This is THE Quattrocento window
        and nothing else in the kit draws it. The ground storey deliberately
        does not get one: on a palazzo the street floor is the counting house
        and is the plainest thing on the wall, so it gets a flat voussoired
        head instead and the contrast is what makes the piano nobile read.
     3. THE CORNICE, WHICH IS ENORMOUS. Strozzi's oversails about 2 m. It is
        sized off the host's own plan (unit * 0.11) and its job is to throw a
        hard band of shade, so the frieze under it is painted as SHADOW rather
        than stone — without that the deepest cornice in the kit reads from
        the air only, and from the pavement it is a flat white lip.

   WALL MODE "frame": the shell punches real openings with a lit room behind
   them, and this facade sets its tracery, sills and arches around those exact
   holes. The opening geometry below is recomputed from buildings.js's own
   punched rule (margin 0.7, ~2.6 m bay, 68% of the cell, sill 1.05, header
   0.70) because there is no way to ask the shell for it; get it wrong and the
   elevation is two unrelated drawings on one wall.

   CHAINED QUOINS at every corner — the cantonale a catena, long and short
   courses alternating to the cornice — are what tie four faces into one block.

   SOLIDITY: the base courses, their bosses and the portal jambs are the mass
   a player walks into and go out through F.sBox/F.sRib. Everything above head
   height is free deco; sbox would refuse those colliders anyway.

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
      const P = F.palette(ctx, "sandstone", { pull: 0.88, grain: 0.17 });
      const LT = F.mix(P.light, 0xfff4dc, 0.34);       // dressed trim: quoins, arches, sills
      const e = F.entrance(ctx), yTop = H - 0.10;      // wall head: the cornice starts here

      /* THE SHELL'S OWN PUNCHED OPENINGS, recomputed (buildings.js:4144), and
         the row test that tells a course to step around them. */
      const wins = function (f) { const us = f.span - 1.4, n = Math.max(1, Math.round(us / 2.6)), c = us / n;
        return Array.from({ length: n }, (_, i) => ({ t: -us / 2 + (i + 0.5) * c, w: Math.min(2.0, c * 0.68) })); };
      const rows = []; for (let k = 0; k < ctx.storeys; k++) rows.push([k * FH + 0.96, (k + 1) * FH - 0.06]);
      const openRow = function (cy, hh) { return rows.some((r) => cy + hh > r[0] && cy - hh < r[1]); };

      // THE THREE FINISHES, by height.
      const PB = clamp(unit * 0.030, 0.26, 0.52), PM = PB * 0.55, PT = PB * 0.28;
      const nB = ctx.storeys >= 6 ? 2 : 1;
      const zY = [Math.min(nB * FH, yTop * 0.52), Math.min((nB + Math.max(1, Math.round((ctx.storeys - nB) * 0.55))) * FH, yTop * 0.84)];
      const zone = function (y) { return y < zY[0] ? 0 : (y < zY[1] ? 1 : 2); };

      // ---- A. THE WALL, COURSE BY COURSE --------------------------
      const cH = clamp(FH / 4.6, 0.50, 0.90);
      const nC = Math.max(3, Math.round(yTop / cH)), ch = yTop / nC;
      for (const f of F.faces(ctx)) {
        const ws = wins(f);
        for (let c = 0; c < nC; c++) {
          const y0 = c * ch, cy = y0 + ch / 2, z = zone(cy), pr = z === 0 ? PB : (z === 1 ? PM : PT);
          const holes = cy - ch / 2 < e.head + 0.4 ? F.doorHoles(ctx, f, 0.9) : [];
          if (openRow(cy, ch / 2)) for (const wd of ws) holes.push([wd.t - wd.w / 2 - 0.30, wd.t + wd.w / 2 + 0.30]);
          const free = function (t, w) { return !holes.some((q) => t + w / 2 > q[0] && t - w / 2 < q[1]); };
          F.segBand(ctx, f, cy, ch - 0.05, pr, P.course(c), holes, 0.12, 0, cy < 2.6);
          F.segBand(ctx, f, y0 + 0.04, z === 1 ? 0.15 : 0.09, pr * (z === 1 ? 0.30 : 0.58),
            F.shade(P.shadow, z === 2 ? 1.10 : 0.78), holes, 0.08, 0);
          // THE INDIVIDUAL STONES. Rock-faced blocks bulge by their own hashed
          // amount; a channelled course is flat and only its vertical joint is
          // cut; ashlar gets neither, which is why the top storey goes quiet.
          if (z === 2) continue;
          const bn = Math.max(2, Math.round(f.span / clamp(ch * (z === 0 ? 2.6 : 3.6), 1.4, 2.6))), bw = f.span / bn;
          for (let i = 0; i < bn; i++) {
            const t = -f.span / 2 + (i + 0.5) * bw;
            if (z === 1) { if (free(t - bw / 2, 0.3)) F.box(ctx, f, t - bw / 2, cy, 0.20, ch - 0.02, pr * 0.22, F.shade(P.shadow, 0.62)); continue; }
            if (!free(t, bw)) continue;
            const bp = pr + 0.10 + ctx.hash(0x7a10 + f.s * 41 + c * 7 + i) * 0.34;
            (cy < 2.6 ? F.sBox : F.box)(ctx, f, t, cy, bw - 0.14, ch - 0.16, bp, P.course(c * 5 + i));
            F.box(ctx, f, t, cy - ch * 0.32, bw - 0.14, 0.10, bp + 0.03, F.shade(P.shadow, 0.62));
          }
        }
        // marcapiano: the string course that ends each finish
        for (const y of zY) F.band(ctx, f, y + 0.10, 0.26, (y < zY[1] ? PB : PM) + 0.18, LT, 0.4);
      }

      // ---- B. THE BIFORA ------------------------------------------
      for (const f of F.faces(ctx)) for (const wd of wins(f)) {
        for (let k = 0; k < ctx.storeys; k++) {
          const y1 = (k + 1) * FH - 0.70, y0 = k * FH + 1.05;
          if (y1 > H - 0.55 || (y0 < e.head && !F.clearsDoor(ctx, f, wd.t, wd.w + 1.2))) continue;
          const pr = (zone(y1) === 0 ? PB : zone(y1) === 1 ? PM : PT) + 0.12;
          const aw = wd.w - 0.60, sp = y1 - 0.20, rise = Math.min(aw * 0.5, (k + 1) * FH - 0.16 - sp);
          F.box(ctx, f, wd.t, y0 - 0.16, wd.w + 0.62, 0.22, pr + 0.16, LT);                  // sill
          if (k === 0 || aw < 0.9 || rise < 0.30) {                        // the counting house
            for (let v = -2; v <= 2; v++) F.box(ctx, f, wd.t + v * (wd.w + 0.3) * 0.19, y1 + 0.24 + Math.abs(v) * 0.02,
              (wd.w + 0.3) * 0.18, 0.48 - Math.abs(v) * 0.03, pr, v ? LT : F.mix(LT, 0xffffff, 0.22));
            continue;
          }
          /* A punched opening is WIDE and SHORT and a bifora is the opposite,
             so the jambs eat 0.3 m off each side FIRST. That is what buys the
             enclosing arch a semicircular rise inside the header zone — leave
             the hole its full width and the arch comes out a flat blister. */
          for (const sg of [-1, 1]) F.rib(ctx, f, wd.t + sg * (wd.w / 2 - 0.15), y0, y1, 0.32, pr + 0.06, LT);
          F.arch(ctx, f, wd.t, sp, aw + 0.10, rise, 0.19, pr + 0.02, LT, "round");           // enclosing
          F.rib(ctx, f, wd.t, y0, y1 - 0.68, 0.17, pr + 0.12, LT);                           // colonnette
          F.box(ctx, f, wd.t, y1 - 0.74, 0.40, 0.16, pr + 0.18, LT);                         // its capital
          for (const sg of [-1, 1]) F.arch(ctx, f, wd.t + sg * (aw * 0.25 + 0.03), y1 - 0.58, aw * 0.42, aw * 0.21, 0.08, pr + 0.10, LT, "round");
          F.box(ctx, f, wd.t, y1 + 0.06, 0.26, 0.26, pr + 0.14, F.shade(P.shadow, 0.7));     // roundel
        }
      }

      // ---- C. CHAINED QUOINS --------------------------------------
      const qH = Math.max(0.44, cH * 1.15), qN = Math.max(3, Math.floor(yTop / qH));
      for (let i = 0; i < qN; i++) F.corners(ctx, (i + 0.5) * qH, qH * 0.90, (i % 2) ? qH * 1.2 : qH * 2.2, PB + 0.12, (i % 2) ? P.course(i + 3) : LT);

      // ---- D. THE PORTAL ------------------------------------------
      // One big round-arched hole. The kit carves the real doorway out of
      // anything laid across it, so the shadow panel may run full width; the
      // jambs are the only solid mass on the entrance axis.
      const pw = clamp(e.gap + 1.2, 3.0, e.f.span * 0.34), psp = Math.min(e.head + 0.4, FH * 0.60);
      const prs = Math.min(pw * 0.5, zY[0] + 0.15 - psp);
      F.box(ctx, e.f, 0, psp / 2, pw, psp, 0.06, F.shade(P.shadow, 0.62));
      for (const sg of [-1, 1]) F.sRib(ctx, e.f, sg * (pw / 2 + 0.36), 0.05, psp + prs * 0.5, 0.80, PB + 0.62, LT);
      if (prs > 0.3) {
        F.box(ctx, e.f, 0, psp + prs * 0.45, pw * 0.92, prs * 0.9, 0.06, F.shade(P.shadow, 0.55));
        F.arch(ctx, e.f, 0, psp, pw, prs, 0.28, PB + 0.56, LT, "round");
        F.box(ctx, e.f, 0, psp + prs * 0.92, pw * 0.17, prs * 0.80, PB + 0.70, F.mix(LT, 0xffffff, 0.22));
      }

      // ---- E. THE CORNICE -----------------------------------------
      const CP = clamp(unit * 0.125, 0.95, 2.40);
      F.cornice(ctx, { pal: P, y: H + 0.95, kind: "modillion", h: 0.50, depth: CP, col: LT });
      F.ring(ctx, H + 0.60, 0.34, CP * 0.96, F.shade(P.shadow, 0.60), 0.7);   // the shade it throws
    },
  });
})();
