/* ============================================================
   city/facades/masstimber.js — "Mass Timber Tower": CLT and glulam.

   THE READ, AND THE FACADE IT MUST NOT BE MISTAKEN FOR. hightech.js already
   puts the structure outside the glass, so "an exposed frame" is not a new
   grammar. The difference has to be legible at a kilometre and it is a
   difference of MATERIAL AND TEMPERAMENT:

     hightech  metal, services on the outside, round tubes, signal colours,
               ducts and masts and a gantry. Industrial. Cool.
     this      warm timber, orthogonal, nothing on the frame but the frame:
               square glulam posts, a beam on every floor line, chevron
               braces, and PLANTS on the setbacks. Domestic at 130 m.

   WARM AGAINST COOL IS THE WHOLE STYLE. The shell glazes as always (wall
   "keep") and its glass is a cool dark grey-blue; the frame in front of it is
   a light warm brown, and every spandrel panel behind the frame is pushed
   further COOL so the two fields never converge. A timber frame the same
   value as its glazing is a grey box with a grid drawn on it — that is the
   failure mode this file is written against, and it is why `wood` is mixed
   toward 0xc79a5e rather than taken straight off the timber palette, which
   comes out of a grey district too dark to read as wood.

     THE GRID     posts on every bay line and a beam on every floor line,
                  standing a real gap in front of the glass. The standoff
                  STEPS IN one notch per tier (standAt), so the tower visibly
                  narrows as it rises instead of wearing a uniform cage.
     CHEVRONS     one braced bay per tier per face, a pair of diagonals
                  converging upward. dbox cannot rotate, so a diagonal is a
                  stepped run of blocks. Deliberately NOT an X: the X belongs
                  to hightech and megabrace and a third one would be noise.
     TERRACES     at every tier the floor plate runs out past the frame as a
                  planted deck with a timber balustrade, walkable (ctx.plat).
                  This is where the structure steps back, so the terrace and
                  the setback are the same event rather than two.
     CROWN        a timber lantern: corner posts, tie beams, and a stepped
                  glulam cap. crownsRoof, so the host does not grow a water
                  tank through it.

   SOLIDITY: the frame lands on a plinth and the ground lift of every post is
   emitted SOLID (F.obox's solid flag), because a post you can walk through is
   the one thing an exposed-structure building must never have. Posts in the
   doorway keep their geometry and lose their collider — buildings.js does
   that itself, but F.clearsDoor keeps them out of the reveal anyway.

   COST: no meshes. Everything is merged boxes in the host's deco buckets.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("masstimber", {
    label: "Mass Timber Tower",
    era: "future",
    // city/collapse.js MATERIALS — CLT panels on a glulam frame. It folds and
    // splinters; it does not pancake like concrete or shear like steel.
    structure: "timber",
    wall: "keep",
    crownsRoof: true,
    minStoreys: 14,
    build: function (ctx, F) {
      const FH = ctx.FH, H = ctx.rTop, ST = Math.max(1, ctx.storeys | 0), unit = Math.min(ctx.w, ctx.d);
      const h = function (s) { return ctx.hash(s); };
      const P = F.palette(ctx, "timber", { pull: 0.92, grain: 0.16 });
      const wood = F.mix(P.light, 0xc79a5e, 0.45), woodD = F.shade(wood, 0.76), woodL = F.shade(wood, 1.12);
      const cool = F.mix(P.shadow, 0x8f9aa0, 0.72);       // the cool grey field the frame stands against
      const leaf = F.mix(0x3a7a3a, P.base, 0.14), leafL = F.mix(0x7cb355, P.base, 0.16);

      // ---- A. THE FRAME LINE. One tier every M storeys; the standoff steps
      // IN a notch at each one, which is what makes a terrace a setback and
      // not a shelf. Everything below measures off standAt/deckAt.
      const M = clamp(Math.round(ST / 5), 3, 6), nT = Math.max(1, Math.floor(ST / M));
      const s0 = clamp(unit * 0.075, 0.55, 1.5), pw = clamp(unit * 0.030, 0.34, 0.72);
      const standAt = function (i) { return s0 * (1 - 0.45 * i / nT); };
      const D0 = clamp(unit * 0.10, 1.2, 2.6);
      F.podium(ctx, { pal: P, col: P.dark, over: clamp(unit * 0.05, 0.7, 1.6) });

      // ---- B. THE TIMBER GRID, tier by tier: posts, floor beams, a cool
      // spandrel panel at every floor, and one chevron-braced bay per face.
      for (const f of F.faces(ctx)) {
        const lines = F.bayLines(f, F.bayCount(f, FH * 1.5, 3, 9), Math.max(0.7, f.span * 0.04));
        for (let i = 0; i < nT; i++) {
          const y0 = i * M * FH, y1 = Math.min(H, (i + 1) * M * FH), outN = f.halfN + standAt(i) + pw;
          if (y1 - y0 < 0.5) continue;
          for (const t of lines) {
            F.obox(ctx, f, t, (y0 + y1) / 2, pw, y1 - y0, pw, outN,
              i % 2 ? wood : woodL, i === 0 && F.clearsDoor(ctx, f, t, pw + 1.0));
          }
          for (let k = Math.max(1, Math.ceil(y0 / FH)); k * FH <= y1 + 0.01; k++) {
            F.obox(ctx, f, 0, k * FH, f.span + 0.3, pw * 0.80, pw * 0.85, outN, woodD);
            F.box(ctx, f, 0, k * FH, f.span + 0.1, FH * 0.20, 0.14, cool, 0);     // the cool spandrel behind it
          }
          // THE CHEVRON. One bay per tier per face, picked by hash so the
          // braced bays wander up the building instead of stacking.
          const b = (h(0x3b00 + f.s * 7 + i) * Math.max(1, lines.length - 1)) | 0;
          const ta = lines[b], tb = lines[Math.min(lines.length - 1, b + 1)], mid = (ta + tb) / 2;
          for (let q = 0; q < 7; q++) {
            const u = (q + 0.5) / 7, yy = y0 + (y1 - y0) * u, lw = Math.abs(tb - ta) / 7 + pw;
            for (const sg of [-1, 1]) {
              F.obox(ctx, f, mid + sg * (tb - ta) * 0.5 * (1 - u), yy, lw, (y1 - y0) / 7 + 0.12,
                pw * 0.66, outN - 0.03, woodD);
            }
          }
        }
      }

      // ---- C. THE PLANTED TERRACES, at the tier lines where the frame steps
      // back. Timber balustrade, not a soil parapet: this is a deck people
      // stand on, and ctx.plat says so.
      for (let i = 1; i <= nT; i++) {
        const y = i * M * FH; if (y > H - FH * 0.8) break;
        const p = D0 * (1 - 0.5 * y / H) + standAt(i - 1) + pw, rt = clamp(p * 0.20, 0.16, 0.34);
        for (const f of F.faces(ctx)) {
          F.band(ctx, f, y + 0.16, 0.32, p, woodL, 0.3, 0);                       // the floor plate, run out
          F.band(ctx, f, y + 0.34 + FH * 0.24, 0.16, rt, wood, 0.3, p - rt);      // the rail
          const n = Math.max(3, Math.round(f.span / clamp(unit * 0.16, 1.5, 2.8)));
          for (let k = 0; k < n; k++) {
            const t = -f.span / 2 + (k + 0.5) * (f.span / n), s = 0x3b40 + f.s * 11 + i * 5 + k;
            F.box(ctx, f, t, y + 0.32 + FH * 0.13, pw * 0.8, FH * 0.26, rt, wood, p - rt);   // baluster post
            const bh = FH * (0.18 + h(s) * 0.30);
            F.box(ctx, f, t, y + 0.32 + bh / 2, (f.span / n) * 0.74, bh, p * 0.44, h(s + 1) < 0.4 ? leafL : leaf, p * 0.5);
          }
          const a = Math.min(f.out * f.halfN, f.out * (f.halfN + p)), b = a + p, dy = y + 0.32;
          if (f.horiz) ctx.plat(-ctx.w / 2, ctx.w / 2, a, b, dy); else ctx.plat(a, b, -ctx.d / 2, ctx.d / 2, dy);
        }
      }

      // ---- D. THE TIMBER LANTERN. Corner posts and tie beams standing on
      // the roof deck, closed with a stepped glulam cap — the crown is the
      // same frame carried one storey past the building, which is what a
      // timber tower does and what a mechanical penthouse never looks like.
      const R = F.roof(ctx);
      ctx.dbox(R.cx, H + ctx.pp * 0.5, R.cz, R.w, Math.max(0.06, ctx.pp), R.d, F.shade(P.base, 0.90));
      ctx.plat(R.cx - R.w / 2, R.cx + R.w / 2, R.cz - R.d / 2, R.cz + R.d / 2, H + ctx.pp);
      const Hc = clamp(H * 0.15, FH * 1.1, FH * 6), cw = R.w * 0.84, cd = R.d * 0.84, cp = pw * 1.7;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        ctx.dbox(R.cx + sx * cw / 2, H + Hc * 0.45, R.cz + sz * cd / 2, cp, Hc * 0.9, cp, wood);
      }
      for (const e of [0.18, 0.62, 0.90]) {
        ctx.dbox(R.cx, H + Hc * e, R.cz, cw + cp, cp * 0.7, cd * 0.10, woodD);
        ctx.dbox(R.cx, H + Hc * e, R.cz, cw * 0.10, cp * 0.7, cd + cp, woodD);
      }
      ctx.dbox(R.cx, H + Hc * 0.45, R.cz, cw * 0.88, Hc * 0.86, cd * 0.88, cool);   // the lantern's glazing
      F.ziggurat(ctx, R.cx, R.cz, H + Hc * 0.9, cw + cp, cd + cp, Hc * 0.55, 3, woodL, 0.64, 0.07);
    },
  });
})();
