/* ============================================================
   city/facades/mastaba.js — "Mastaba & Pylon": Old Kingdom Egypt.

   THE FAILURE MODE IS A PLAIN BATTERED BOX. Every part of Egyptian mass
   architecture is a battered box; what makes one READ as Egyptian is the
   EDGE. So this file spends its budget on the three mouldings that dress the
   edge, and it makes them big enough to show in silhouette, because if you
   cannot see them at 200 m they might as well not exist:

     1. THE BATTER, on all four faces. F.batter lays the wall as courses that
        thin as they rise, so the profile leans in. That is the mass, and it
        is one line; everything below measures its projection off it, which is
        what lets this re-proportion at 11 m and at 34 m instead of stretching.

     2. THE TORUS ROLL, up every corner and along the top. The vertical rolls
        are a bundle-of-reeds ancestor turned into stone: a half-round shaft
        at each arris, laid in lifts so it follows the batter in and out.
        F.boxShaft gives it an octagonal section that reads round at any
        distance a player stands and costs no mesh. The horizontal roll is the
        same section as a ring, and it is what the cavetto sits on.

     3. THE CAVETTO (gorge) CORNICE. A concave quarter-hollow that flares
        BOLDLY out over the roll — projection grows as the square of the
        height, which is the whole difference between a cavetto and a chamfer.
        It is painted in vertical stripes, the way the real ones are: the
        stripes are emitted per course so they follow the flare out instead of
        being buried in it, and they are the cheapest thing in the file that
        says which culture this is.

   THE PYLON GATE is the door face's own event: two battering towers flanking
   the entrance, each with its own corner rolls and its own roll-and-cavetto
   cap, each carrying two TAPERED FLAGSTAFF NICHES with masts that overtop the
   building and fly a pennant. Between them a lintel, and over the door the
   WINGED DISC — a sun disc with stepped feathered wings and two uraeus
   pendants, sized so the wings die before they reach the towers.

   PALACE-FACADE NICHING on the plain faces: the shallow recessed panelling a
   real mastaba carries, laid per batter course so each panel's jambs stand
   proud of the course they are cut into rather than being swallowed by it.

   WALL MODE "own": a mastaba is a tomb. It has no windows and this file draws
   none; the niching is the articulation. The host's real door survives because
   nothing here is laid across it — the towers stand off the door gap and the
   lintel and disc are above the door head.

   SOLIDITY: batter courses, corner rolls at ground level, the pylon towers
   and the niche jambs are mass and go through F.sBox / F.boxShaft(solid).
   The cavetto, the top roll, the stripes, the masts and the disc are moulding
   or are up in the air and stay free.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("mastaba", {
    label: "Mastaba & Pylon",
    era: "bronze",
    // city/collapse.js MATERIALS — coursed limestone over a rubble core.
    structure: "stone",
    wall: "own",
    crownsRoof: true,
    maxStoreys: 10,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, unit = Math.min(ctx.w, ctx.d);
      const P = F.palette(ctx, "sandstone", { pull: 0.86 });
      const RED = F.mix(P.accent, 0xb4432a, 0.62), BLU = F.mix(P.trim, 0x2b5f86, 0.58);

      // ---- A. THE BATTER ------------------------------------------
      const bat = F.batter(ctx, { pal: P, buttress: false,
        n: clamp(ctx.storeys + 2, 4, 6), total: clamp(unit * 0.10, 0.6, 1.8) });
      const rr = clamp(unit * 0.028, 0.22, 0.50);          // the roll's radius

      // ---- B. THE CORNER ROLLS, lift by lift, following the batter -
      for (let k = 0; k < bat.n; k++) {
        const pr = bat.proj[k];
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          F.boxShaft(ctx, sx * (ctx.w / 2 + pr), k * bat.cH, sz * (ctx.d / 2 + pr),
            bat.cH + 0.02, rr, P.light, F.mix(P.light, 0xffffff, 0.16), k < 2);
        }
      }

      // ---- C. PALACE-FACADE NICHING -------------------------------
      // Per COURSE, so each panel's jambs stand proud of the batter they are
      // cut into. Drawn flush-plus-a-hair for the recess and proud for the
      // jambs: you cannot cut a hole in merged geometry, you draw the reveal.
      for (let k = 0; k < bat.n - 1; k++) {
        const pr = bat.proj[k], y = k * bat.cH;
        for (const f of F.faces(ctx)) {
          const lines = F.bayLines(f, F.bayCount(f, 2.7, 3, 10), clamp(f.span * 0.07, 0.5, 1.4));
          for (const t of lines) {
            if (!F.clearsDoor(ctx, f, t, 1.6)) continue;
            F.box(ctx, f, t, y + bat.cH / 2, 0.62, bat.cH - 0.10, pr + 0.02, P.shadow);
            for (const sg of [-1, 1]) F.sRib(ctx, f, t + sg * 0.50, y, y + bat.cH, 0.38, pr + 0.20, P.course(k + 3));
          }
        }
      }

      // ---- D. THE ROLL AND CAVETTO CORNICE ------------------------
      const cvH = clamp(FH * 0.62, 1.2, 2.6), cvR = clamp(unit * 0.11, 0.8, 2.4);
      const tp = bat.proj[bat.n - 1], rollY = H - cvH - rr * 1.4;
      F.ring(ctx, rollY, rr * 1.98, tp + rr * 1.10, P.light, 0.3, 0);      // the torus, in section
      F.ring(ctx, rollY, rr * 1.10, tp + rr * 1.98, P.light, 0.3, 0);
      F.ring(ctx, rollY - rr * 1.15, 0.12, tp + rr * 1.30, P.shadow, 0.3, 0);
      for (let k = 0; k < 7; k++) {
        const u = (k + 0.5) / 7, pr = tp + rr * 0.60 + cvR * u * u;        // concave: u SQUARED
        const y = rollY + rr * 1.1 + u * cvH;
        F.ring(ctx, y, cvH / 7 + 0.04, pr, k % 2 ? P.light : P.base, 0.3, 0);
        for (const f of F.faces(ctx)) {                                    // the painted stripes
          const ns = Math.max(5, Math.round(f.span / 1.05)), st = f.span / ns;
          for (let i = 0; i < ns; i += 2) F.box(ctx, f, -f.span / 2 + (i + 0.5) * st, y, st * 0.46, cvH / 7 + 0.02, pr + 0.06, i % 4 ? RED : BLU);
        }
      }
      F.ring(ctx, H + 0.16, 0.30, tp + rr * 0.60 + cvR + 0.20, P.light, 0.45, 0);   // the abacus slab
      const R = F.roof(ctx);
      ctx.dbox(R.cx, H + ctx.pp * 0.5, R.cz, R.w, Math.max(0.06, ctx.pp), R.d, F.shade(P.base, 0.92));
      ctx.plat(R.cx - R.w / 2, R.cx + R.w / 2, R.cz - R.d / 2, R.cz + R.d / 2, H + ctx.pp);

      // ---- E. THE PYLON GATE --------------------------------------
      const e = F.entrance(ctx), f0 = e.f;
      const pyH = Math.min(rollY - 0.4, Math.max(FH * 1.7, H * 0.74));
      const tw = clamp(f0.span * 0.26, 2.4, 6.0), tOff = e.gap / 2 + 0.7 + tw / 2;
      const pp0 = clamp(unit * 0.09, 0.7, 1.8);          // proud of the batter
      const mastH = pyH + clamp(FH * 1.2, 2.2, 4.4);
      for (const sg of [-1, 1]) {
        for (let k = 0; k < 5; k++) {                    // the tower, battering as it rises
          const y = pyH * k / 5, pr = bat.projAt(y + 0.1) + pp0 * (1 - (k / 5) * 0.34);
          F.sBox(ctx, f0, sg * tOff, y + pyH / 10, tw * (1 - (k / 5) * 0.10), pyH / 5 + 0.02, pr, P.course(70 + k));
        }
        const pr0 = bat.projAt(pyH - 0.3) + pp0 * 0.70;
        for (const q of [-1, 1]) {                       // its own corner rolls
          F.rib(ctx, f0, sg * tOff + q * tw * 0.48, 0, pyH + rr, rr * 1.9, pr0 + rr * 1.05, P.light);
          F.rib(ctx, f0, sg * tOff + q * tw * 0.48, 0, pyH + rr, rr * 1.0, pr0 + rr * 1.90, P.light);
        }
        for (const j of [-1, 1]) {                       // tapered flagstaff niche + mast + pennant
          const t = sg * tOff + j * tw * 0.23;
          F.rib(ctx, f0, t, pyH * 0.14, pyH * 0.94, tw * 0.17, pr0 + 0.05, F.shade(P.shadow, 0.85));
          F.rib(ctx, f0, t, pyH * 0.16, mastH, tw * 0.085, pr0 + 0.24, P.trim);
          F.box(ctx, f0, t, mastH + 0.34, tw * 0.26, 0.55, pr0 + 0.30, j < 0 ? RED : BLU);
        }
        F.box(ctx, f0, sg * tOff, pyH + rr * 0.9, tw + rr * 2, rr * 1.9, pr0 + rr * 1.0, P.light);
        for (let k = 0; k < 4; k++) {                    // the tower's own little cavetto
          const u = (k + 0.5) / 4;
          F.box(ctx, f0, sg * tOff, pyH + rr * 2 + u * cvH * 0.55, tw + 0.34, cvH * 0.14 + 0.03,
            pr0 + rr * 0.5 + cvR * 0.55 * u * u, k % 2 ? P.light : P.base);
        }
      }
      // ---- F. THE LINTEL AND THE WINGED DISC ----------------------
      const dy = e.head + 1.05, dpr = bat.projAt(dy) + pp0 * 0.55;
      const wr = Math.max(0.9, tOff - tw / 2 - 0.45);    // the wings die before the towers
      F.box(ctx, f0, 0, e.head + 0.40, (tOff - tw / 2) * 2, 0.80, dpr, P.light);
      F.box(ctx, f0, 0, dy, 0.95, 0.66, dpr + 0.10, P.trim);
      F.box(ctx, f0, 0, dy, 0.66, 0.95, dpr + 0.10, P.trim);
      F.box(ctx, f0, 0, dy, 0.80, 0.80, dpr + 0.17, RED);          // the sun disc
      for (const sg of [-1, 1]) {
        for (let k = 0; k < 5; k++) {
          const u = (k + 1) / 5;
          F.box(ctx, f0, sg * (0.55 + u * wr * 0.82), dy - 0.07 * k, wr * 0.20, 0.50 * (1 - u * 0.58), dpr + 0.07, k % 2 ? BLU : P.light);
        }
        F.box(ctx, f0, sg * 0.44, dy - 0.74, 0.24, 0.72, dpr + 0.09, RED);   // the uraeus pendants
      }
    },
  });
})();
