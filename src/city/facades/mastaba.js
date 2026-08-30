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
      for (let k = 0; k < bat.n; k++) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        F.boxShaft(ctx, sx * (ctx.w / 2 + bat.proj[k]), k * bat.cH, sz * (ctx.d / 2 + bat.proj[k]),
          bat.cH + 0.02, rr, P.light, F.mix(P.light, 0xffffff, 0.16), k < 2);
      }

      // ---- C. PALACE-FACADE NICHING -------------------------------
      // Per COURSE, so each panel's jambs stand proud of the batter they are
      // cut into. Drawn flush-plus-a-hair for the recess and proud for the
      // jambs: you cannot cut a hole in merged geometry, you draw the reveal.
      for (let k = 0; k < bat.n - 1; k++) for (const f of F.faces(ctx)) {
        const pr = bat.proj[k], y = k * bat.cH;
        for (const t of F.bayLines(f, F.bayCount(f, 2.7, 3, 10), clamp(f.span * 0.07, 0.5, 1.4))) {
          if (!F.clearsDoor(ctx, f, t, 1.6)) continue;
          F.box(ctx, f, t, y + bat.cH / 2, 0.62, bat.cH - 0.10, pr + 0.02, P.shadow);
          for (const sg of [-1, 1]) F.sRib(ctx, f, t + sg * 0.50, y, y + bat.cH, 0.38, pr + 0.20, P.course(k + 3));
        }
      }

      // ---- D. THE ROLL AND CAVETTO CORNICE ------------------------
      // Drawn in SEGMENTS around the pylon towers on the door face: a real
      // cornice RETURNS around a pylon, it does not run through it, and a ring
      // that did would leave the towers looking glued on.
      const e = F.entrance(ctx), f0 = e.f;
      const tw = clamp(f0.span * 0.26, 2.4, 6.0), tOff = e.gap / 2 + 0.7 + tw / 2;
      const gaps = [[-tOff - tw * 0.62, -tOff + tw * 0.62], [tOff - tw * 0.62, tOff + tw * 0.62]];
      const cvH = clamp(FH * 0.62, 1.2, 2.6), cvR = clamp(unit * 0.11, 0.8, 2.4);
      const tp = bat.proj[bat.n - 1], rollY = H - cvH - rr * 1.4;
      const cornice = function (cy, h, pr, col) {
        for (const f of F.faces(ctx)) F.segBand(ctx, f, cy, h, pr, col, f.s === f0.s ? gaps : [], 0.3, 0);
      };
      cornice(rollY, rr * 1.98, tp + rr * 1.10, P.light);              // the torus, in section
      cornice(rollY, rr * 1.10, tp + rr * 1.98, P.light);
      cornice(rollY - rr * 1.15, 0.12, tp + rr * 1.30, P.shadow);
      for (let k = 0; k < 7; k++) {
        const u = (k + 0.5) / 7, pr = tp + rr * 0.60 + cvR * u * u;    // concave: u SQUARED
        const y = rollY + rr * 1.1 + u * cvH;
        cornice(y, cvH / 7 + 0.04, pr, k % 2 ? P.light : P.base);
        for (const f of F.faces(ctx)) {                                // the painted stripes
          const ns = Math.max(5, Math.round(f.span / 1.05)), st = f.span / ns;
          for (let i = 0; i < ns; i += 2) {
            const t = -f.span / 2 + (i + 0.5) * st;
            if (f.s === f0.s && Math.abs(Math.abs(t) - tOff) < tw * 0.7) continue;
            F.box(ctx, f, t, y, st * 0.46, cvH / 7 + 0.02, pr + 0.06, i % 4 ? RED : BLU);
          }
        }
      }
      cornice(H + 0.16, 0.30, tp + rr * 0.60 + cvR + 0.20, P.light);   // the abacus slab
      const lid = H + 0.62;
      ctx.dbox(0, H + 0.34, 0, ctx.w + tp * 1.4, 0.56, ctx.d + tp * 1.4, P.course(9));
      ctx.plat(-(ctx.w / 2 + tp * 0.7), ctx.w / 2 + tp * 0.7, -(ctx.d / 2 + tp * 0.7), ctx.d / 2 + tp * 0.7, lid);

      // ---- E. THE PYLON GATE --------------------------------------
      // The towers OVERTOP the wall and carry their own roll-and-cavetto cap
      // above the main cornice: a pylon that stopped under it would read as a
      // pilaster, and the double flare is the whole silhouette of the front.
      const pyH = H + clamp(FH * 0.55, 1.1, 2.6);
      const pp0 = clamp(unit * 0.11, 0.9, 2.2);          // proud of the batter
      const mastH = pyH + clamp(FH * 1.9, 3.6, 7.0);
      for (const sg of [-1, 1]) {
        for (let k = 0; k < 6; k++) {                    // the tower, battering as it rises
          const y = pyH * k / 6, pr = bat.projAt(Math.min(y + 0.1, H - 0.2)) + pp0 * (1 - (k / 6) * 0.38);
          F.sBox(ctx, f0, sg * tOff, y + pyH / 12, tw * (1 - (k / 6) * 0.10), pyH / 6 + 0.02, pr, P.course(70 + k));
        }
        const pr0 = bat.projAt(H - 0.3) + pp0 * 0.62;
        for (const q of [-1, 1]) for (const z of [[1.9, 1.05], [1.0, 1.90]]) {   // its own corner rolls
          F.rib(ctx, f0, sg * tOff + q * tw * 0.48, 0, pyH + rr, rr * z[0], pr0 + rr * z[1], P.light);
        }
        for (const j of [-1, 1]) {                       // tapered flagstaff niche, mast, pennant
          const t = sg * tOff + j * tw * 0.23;
          F.rib(ctx, f0, t, pyH * 0.14, pyH * 0.94, tw * 0.17, pr0 + 0.05, F.shade(P.shadow, 0.85));
          F.rib(ctx, f0, t, pyH * 0.16, mastH, tw * 0.075, pr0 + 0.26, F.shade(P.shadow, 0.9));
          F.box(ctx, f0, t + j * tw * 0.15, mastH - 0.95, tw * 0.24, 1.55, pr0 + 0.30, j < 0 ? RED : BLU);
        }
        F.box(ctx, f0, sg * tOff, pyH + rr * 0.9, tw + rr * 2, rr * 1.9, pr0 + rr * 1.0, P.light);
        for (let k = 0; k < 4; k++) {                    // the tower's own cavetto cap
          const u = (k + 0.5) / 4;
          F.box(ctx, f0, sg * tOff, pyH + rr * 2 + u * cvH * 0.62, tw + 0.34, cvH * 0.17 + 0.03,
            pr0 + rr * 0.5 + cvR * 0.62 * u * u, k % 2 ? P.light : P.base);
        }
      }
      // ---- F. THE LINTEL AND THE WINGED DISC ----------------------
      const dy = e.head + 1.35, dpr = bat.projAt(dy) + pp0 * 0.62;
      const wr = Math.max(0.9, tOff - tw / 2 - 0.45);    // the wings die before the towers
      F.box(ctx, f0, 0, e.head + 0.45, (tOff - tw / 2) * 2, 0.90, dpr, P.light);
      F.box(ctx, f0, 0, dy, 1.55, 1.05, dpr + 0.12, P.trim);
      F.box(ctx, f0, 0, dy, 1.05, 1.55, dpr + 0.12, P.trim);
      F.box(ctx, f0, 0, dy, 1.30, 1.30, dpr + 0.20, RED);          // the sun disc
      for (const sg of [-1, 1]) for (let k = 0; k < 5; k++) {               // the feathered wings
        const u = (k + 1) / 5;
        F.box(ctx, f0, sg * (0.75 + u * wr * 0.80), dy - 0.10 * k, wr * 0.22, 0.80 * (1 - u * 0.55), dpr + 0.09, k % 2 ? BLU : P.light);
      }
      for (const sg of [-1, 1]) F.box(ctx, f0, sg * 0.52, dy - 1.05, 0.28, 0.85, dpr + 0.11, RED);   // uraeus pendants
    },
  });
})();
