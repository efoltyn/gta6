/* ============================================================
   city/facades/urziggurat.js — "Mudbrick Ziggurat": Ur, c. 2100 BC.

   THE ONE FACADE IT MUST NOT BE MISTAKEN FOR. ziggurat.js is already in this
   kit and it is the 1916 New York ZONING SETBACK TOWER — a concrete-framed
   skyscraper that steps back because a law told it to, glazed, forty storeys,
   a needle on top. It shares a word with this file and nothing else. This is
   the Mesopotamian temple-mountain: MASS not tower, MUD not stone, and a
   STAIR you see from the street. If the two ever read as relatives, this file
   has failed, so it spends its whole budget on the four things the tower has
   none of.

     1. THREE RECEDING BATTERED TERRACES. ctx.w/ctx.d are the shell's fixed
        footprint, so the mass is built the other way up (the same trick
        ziggurat.js uses and the only one available): each terrace is a
        CLADDING COLLAR standing proud of the shell, the lowest proudest, and
        every collar is laid as courses that thin as they rise. Stepping the
        collar in as it climbs gives the silhouette of a mass stepping back,
        and it makes the top of each collar a real ledge — registered with
        ctx.plat, so the player can walk the terraces.

     2. THE TRIPLE STAIR. Ur's front is one central flight straight out from
        the face and two flanking flights that converge on it at the first
        terrace. It is the single feature that says "ziggurat" from 200 m, so
        it is built at full monumental size — and it is a RAMP under the
        treads (one continuous ctx.plat), because a stair a player cannot
        climb is a wall with grooves in it.
        THE DOOR: the host's real hinged door is at ground level in the middle
        of this face, i.e. underneath the flight. The kit's carve would cut a
        1.9 m slot, which is too mean to find, so the flight is emitted in
        SEGMENTS around a doorway-wide tunnel of its own and vaulted over
        above head height. You walk into the mountain to reach the door.

     3. THE REEDED PILASTER-AND-BUTTRESS RHYTHM. Every face of every terrace
        carries engaged buttresses on close bay lines, each one dressed with
        half-round mud reeds. It is what stops a battered collar from reading
        as a tapered box, and it is on all four faces because the real thing
        is (this is a temple, not a stage set with a decorated front).

     4. BITUMEN BANDING. The damp course: a black band of pitch under each
        terrace step, which is also the horizontal that makes the three
        terraces count as three from a distance.

   THE SHRINE on the summit is why crownsRoof is set: a small battered cella
   with its own corner buttresses, bitumen band and stepped merlon crown,
   standing on the (walkable) top terrace.

   WALL MODE "own": mudbrick Sumer has no glazing and this building has no
   windows at all — the buttress bays ARE the articulation. The shell hands
   over solid wall and this file draws no openings, which is the honest
   answer for a solid temple platform.

   SOLIDITY: the terrace collars, the buttress bodies, the stair treads, the
   cheeks and the shrine walls are load-bearing mass and go through
   F.sBox/F.sRib. Copings, bitumen bands, reeds and merlons are moulding or
   are up in the air and stay free — sbox would refuse their colliders anyway.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("urziggurat", {
    label: "Mudbrick Ziggurat",
    era: "bronze",
    // city/collapse.js MATERIALS — a mud-brick core in a burnt-brick skin has
    // no frame: it slumps and crumbles, it does not pancake.
    structure: "adobe",
    wall: "own",
    crownsRoof: true,
    maxStoreys: 10,           // a temple-mountain is a mass; it is never a tower
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, unit = Math.min(ctx.w, ctx.d), S = F.solid(ctx);
      const P = F.palette(ctx, "mud", { pull: 0.95 });
      const bit = F.mix(P.shadow, 0x17120e, 0.66);            // bitumen, the damp course

      // ---- A. THE THREE RECEDING BATTERED TERRACES ----------------
      const p0 = clamp(unit * 0.15, 1.0, 3.4);
      const T = [{ y1: H * 0.40, p: p0 }, { y1: H * 0.72, p: p0 * 0.60 }, { y1: H, p: p0 * 0.26 }];
      for (let i = 0; i < 3; i++) {
        const t = T[i], y0 = i ? T[i - 1].y1 : 0, hh = t.y1 - y0;
        const nc = Math.max(3, Math.round(hh / clamp(FH * 0.5, 0.75, 1.5))), ch = hh / nc;
        for (let k = 0; k < nc; k++) {
          const y = y0 + k * ch, pr = t.p * (1 - (k / nc) * 0.28) + 0.06, col = P.course(i * 9 + k);
          for (const f of F.faces(ctx)) {
            F.sBox(ctx, f, 0, y + ch / 2, f.span + pr * 2.05, ch + 0.02, pr, col);
            F.box(ctx, f, 0, y + 0.07, f.span + pr * 2.05, 0.13, pr + 0.06, F.shade(col, 0.58));
          }
        }
        // THE REEDED PILASTER-AND-BUTTRESS RHYTHM. The buttresses stand PLUMB
        // while the wall behind them batters, so they grow more proud as they
        // rise — which is what a real one does, and what stops a battered
        // collar from reading as a tapered box.
        const bp = t.p + clamp(unit * 0.026, 0.20, 0.55);
        for (const f of F.faces(ctx)) {
          const n = Math.max(3, Math.round(f.span / clamp(FH * 0.85, 1.9, 3.1)));
          const lines = F.bayLines(f, n, clamp(f.span * 0.05, 0.30, 1.0));
          const bw = clamp((f.span / n) * 0.42, 0.5, 1.5);
          for (let j = 0; j < lines.length; j++) {
            F.sRib(ctx, f, lines[j], y0 + 0.04, t.y1 - 0.04, bw, bp, P.course(i * 9 + j + 4));
            for (const sg of [-1, 1]) {                       // half-round mud reeds
              F.rib(ctx, f, lines[j] + sg * bw * 0.30, y0 + 0.10, t.y1 - 0.10, bw * 0.26,
                bp + 0.14, sg < 0 ? P.light : P.dark);
            }
          }
        }
        F.ring(ctx, t.y1 - 0.45, 0.36, bp + 0.10, bit, 0.5, 0);        // bitumen under the step
        // the top of each collar is a real LEDGE: coping, then four walkable
        // strips round the shell, so the terraces can actually be walked
        if (i > 1) continue;
        const a = T[i + 1].p + 0.05, b = t.p + 0.05, W = ctx.w / 2, D = ctx.d / 2, y = t.y1 + 0.18;
        F.ring(ctx, t.y1 + 0.09, 0.18, b + 0.07, P.light, 0.4, 0);
        for (const sg of [-1, 1]) {
          ctx.plat(-(W + b), W + b, sg > 0 ? D + a : -(D + b), sg > 0 ? D + b : -(D + a), y);
          ctx.plat(sg > 0 ? W + a : -(W + b), sg > 0 ? W + b : -(W + a), -(D + a), D + a, y);
        }
      }

      // ---- B. THE TRIPLE STAIR ------------------------------------
      // The flight is emitted in SEGMENTS around a doorway-wide tunnel and
      // vaulted over above head height: the kit's own carve would leave a
      // 1.9 m slot, which is too mean to find under six metres of mudbrick.
      const e = F.entrance(ctx), ff = e.f, ty = T[0].y1;
      const run = clamp(ty * 1.15, 2.8, 8.0), cw = clamp(ff.span * 0.34, 4.6, 7.6);
      const slot = e.gap / 2 + 0.35, room = Math.max(0.9, ff.span / 2 - cw / 2 - 0.75);
      const fw = clamp(Math.min(cw * 0.40, room * 0.55), 0.7, 3.0);
      const nT = Math.max(5, Math.round(ty / 0.55));
      for (let i = 0; i < nT; i++) {
        const th = ty * (nT - i) / nT, dep = run / nT + 0.03, u = i / nT;
        const outN = ff.halfN + i * (run / nT) + dep, hd = Math.min(th, e.head + 0.30);
        for (const sg of [-1, 1]) {
          F.obox(ctx, ff, sg * (slot + (cw / 2 - slot) / 2), hd / 2, cw / 2 - slot, hd, dep, outN, P.course(i + 21), true);
          F.obox(ctx, ff, sg * (cw / 2 + 0.28), th / 2 + 0.16, 0.50, th + 0.32, dep, outN, P.dark, true);
          // the two flanking flights, leaning in as they climb so all three meet
          F.obox(ctx, ff, sg * (cw / 2 + 0.66 + fw / 2 + u * (room - fw) * 0.55), th / 2, fw, th, dep, outN, P.course(i + 41), true);
        }
        if (th > hd) F.obox(ctx, ff, 0, (hd + th) / 2, cw, th - hd, dep, outN, P.course(i + 21), true);
      }
      // ONE continuous ramp under the whole flight, no collider — a monumental
      // stair must never be able to seal the door it stands over
      const n0 = ff.out * ff.halfN, n1 = ff.out * (ff.halfN + run);
      const lo = Math.min(n0, n1), hi = Math.max(n0, n1);
      if (ff.horiz) ctx.plat(-cw / 2, cw / 2, lo, hi, ty, { z0: ctx.oz + n1, z1: ctx.oz + n0, y0: 0, y1: ty });
      else ctx.plat(lo, hi, -cw / 2, cw / 2, ty, { axis: "x", x0: ctx.ox + n1, x1: ctx.ox + n0, y0: 0, y1: ty });

      // ---- C. THE SUMMIT SHRINE -----------------------------------
      const R = F.roof(ctx), deck = H + ctx.pp;
      ctx.dbox(R.cx, H + ctx.pp * 0.5, R.cz, R.w, Math.max(0.06, ctx.pp), R.d, F.shade(P.base, 0.90));
      ctx.plat(R.cx - R.w / 2, R.cx + R.w / 2, R.cz - R.d / 2, R.cz + R.d / 2, deck);
      const sw = Math.min(R.w * 0.66, ctx.w * 0.52), sd = Math.min(R.d * 0.66, ctx.d * 0.52);
      const sh = clamp(FH * 1.25, 2.6, 4.4);
      for (let k = 0; k < 4; k++) {                     // the cella, battered like its mountain
        const u = k / 4;
        S(R.cx, deck + (k + 0.5) * sh / 4, R.cz, sw * (1 - u * 0.10), sh / 4, sd * (1 - u * 0.10), P.course(60 + k));
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        S(R.cx + sx * sw * 0.44, deck + sh * 0.5, R.cz + sz * sd * 0.44, sw * 0.17, sh * 1.03, sd * 0.17, P.light);
      }
      ctx.dbox(R.cx, deck + sh + 0.17, R.cz, sw + 0.50, 0.32, sd + 0.50, bit);
      ctx.dbox(R.cx, deck + sh + 0.50, R.cz, sw + 0.22, 0.30, sd + 0.22, P.light);
      for (const ax of [0, 1]) {                        // the stepped merlon crown
        const L = ax ? sd : sw, W = ax ? sw : sd, mn = Math.max(3, Math.round(L / 1.15)), st = L / mn;
        for (let i = 0; i < mn; i++) for (const sg of [-1, 1]) {
          const q = -L / 2 + (i + 0.5) * st;
          ctx.dbox(R.cx + (ax ? sg * W / 2 : q), deck + sh + 0.95, R.cz + (ax ? q : sg * W / 2),
            ax ? 0.30 : st * 0.56, 0.56, ax ? st * 0.56 : 0.30, P.light);
        }
      }
    },
  });
})();
