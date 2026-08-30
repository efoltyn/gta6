/* ============================================================
   city/facades/talud.js — "Talud-Tablero Platform": Teotihuacan.

   THE READ, AND THE ONE MEASUREMENT THAT DECIDES IT. Teotihuacan's whole
   grammar is a two-part unit repeated up the elevation:

     TALUD    a battered apron, laid as courses that step back as they rise.
     TABLERO  a vertical panel held in a heavy rectangular frame whose face
              stands PROUD OF THE TALUD FOOT BELOW IT — it oversails.

   That oversail is the entire building. The frame's underside is a lip
   hanging out over a sloping surface, so every unit throws a hard horizontal
   shadow onto the talud below it, and the elevation reads as a stack of dark
   bands. Get the overhang wrong — make the frame flush with the slope's foot,
   which is the easy mistake, since the frame is drawn off the talud's TOP —
   and the shadow goes away and the whole thing flattens into a plain stepped
   bank, which is a shape three other grammars in this kit already make. So
   the overhang is computed as the step between units PLUS a fixed lip and is
   never allowed to be a fraction of anything that can go to zero.

   HOW THE MASS IS BUILT. The shell's w/d are fixed and a facade cannot shrink
   them, so — the ziggurat.js trick — the shell wall is the innermost plane
   and every unit is a collar standing proud of it, the bottom unit proudest.
   Stepping the collars in as they rise gives the silhouette of a mass
   stepping back, and the top of each unit's frame becomes a real ledge with
   its own ctx.plat.

   THE PANELS are recessed inside their frames and painted: Teotihuacan was
   not grey stone, it was stuccoed and painted cinnabar red almost everywhere,
   and the recess is what keeps the paint reading as an inset panel instead of
   as a stripe.

   THE STAIR takes the face OPPOSITE the door. buildings.js hangs the real
   door at the centre of ctx.doorSide at plaza level, and a broad frontal
   stair on that face would climb straight over it — a platform that seals its
   own doorway is the bug this grammar is most likely to have. On the door
   face the bottom unit is opened instead: a wide recessed entrance with solid
   jambs, which is what those platforms have anyway. The flight itself is ONE
   ctx.plat ramp (no collider, so it can never wall anything off) with heavy
   alfarda balustrades either side, which is the other Teotihuacan signature.

   WALL MODE "own": no glass, and no windows either — this is a platform, not
   a house. The only opening in the whole grammar is the entrance.

   SOLIDITY: talud courses, entrance jambs and the alfarda feet are F.solid.
   Frames, panels and everything above head height are ctx.dbox and free.

   BUDGET: zero meshes.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("talud", {
    label: "Talud-Tablero Platform",
    era: "meso",
    structure: "stone",
    wall: "own",
    maxStoreys: 9,
    build: function (ctx, F, spec) {
      const rTop = ctx.rTop, FH = ctx.FH, unit = Math.min(ctx.w, ctx.d);
      const P = F.palette(ctx, "basalt", { pull: 0.62, grain: 0.16 });
      const red = F.mix(P.dark, 0x8e2f1e, 0.62);           // the oxide stucco the whole city wore
      const pl = function (a, b, c, q, y, rmp) { ctx.plat(Math.min(a, b), Math.max(a, b), Math.min(c, q), Math.max(c, q), y, rmp); };

      // THE STAIR IS ON THE ENTRANCE FACE — the face the player arrives at, and
      // the only one where a broad frontal stair means anything. Its face, its
      // width and the portal gap are settled HERE because every frame band has
      // to be cut for it: a tablero running on THROUGH a stairway is the
      // giveaway that the ornament was drawn without knowing where the stair
      // was, and the flight has to be cut for the doorway at its foot.
      const e = F.entrance(ctx), sf = e.f, hw = e.gap / 2 + 1.0;
      const sw = clamp(sf.span * 0.62, 4.0, 13.0);

      // ---- A. THE REPEATING UNIT ----------------------------------
      const n = clamp(Math.round(rTop / clamp(FH * 1.15, 2.8, 4.2)), 3, 7);
      const uh = rTop / n, tH = uh * 0.38;                 // the talud is the SMALLER half — the tablero rules
      const p0 = clamp(unit * 0.24, 1.3, 3.6), pEnd = clamp(p0 * 0.22, 0.28, 0.9);
      const step = (p0 - pEnd) / n;
      const over = step * 0.50 + clamp(unit * 0.012, 0.14, 0.30);  // THE OVERSAIL (see the header)
      const cN = 4;                                        // courses in one apron
      for (let k = 0; k < n; k++) {
        const y0 = k * uh, pk = p0 - k * step;
        const pTop = pk - step * 0.55, pf = pTop + over;   // slope top, then the frame face:
        //  pf > pk by design, so the frame hangs out past the FOOT of its own talud
        for (let c = 0; c < cN; c++) {
          const y = y0 + tH * (c + 0.5) / cN, pc = pk - step * 0.55 * (c + 0.5) / cN;
          for (const f of F.faces(ctx)) {
            const holes = (k === 0 && y < 2.5) ? F.doorHoles(ctx, f, 1.0) : [];
            F.segBand(ctx, f, y, tH / cN + 0.02, pc, P.course(k * 4 + c), holes, pc * 1.02, 0, true);
          }
        }
        const bY = y0 + tH, tY = y0 + uh, rb = clamp(uh * 0.10, 0.24, 0.42), rt = rb * 1.30;
        for (const f of F.faces(ctx)) {
          const hs = (f.s === sf.s) ? [[-sw / 2 - 0.35, sw / 2 + 0.35]] : [], ov = pf * 1.02;
          // the frame: the bottom rail IS the lip that hangs over the slope, the
          // top rail is the unit's cornice, and the panel sits back between them
          F.segBand(ctx, f, bY + rb / 2, rb, pf, P.light, hs, ov + 0.09);
          F.segBand(ctx, f, tY - rt / 2, rt, pf + 0.05, P.light, hs, ov + 0.14);
          F.segBand(ctx, f, (bY + rb + tY - rt) / 2, (tY - rt) - (bY + rb), pTop + 0.06, red, hs, ov * 0.94);
        }
        const pu = k + 1 < n ? p0 - (k + 1) * step : 0;    // the ledge the frame leaves
        const W = ctx.w / 2 + pf, D = ctx.d / 2 + pf, Wu = ctx.w / 2 + pu, Du = ctx.d / 2 + pu;
        for (const sg of [-1, 1]) { pl(-W, W, sg * Du, sg * D, y0 + uh); pl(sg * Wu, sg * W, -Du, Du, y0 + uh); }
      }
      // the jambs of the passage that runs under the stair to the real door
      for (const sg of [-1, 1]) F.sRib(ctx, sf, sg * hw, 0, tH + 0.3, 0.60, p0, P.light, 0);

      // ---- B. THE BROAD FRONTAL STAIR -----------------------------
      // Cut for the doorway at its foot: a portal, then a passage under the
      // treads to the real hinged leaf. The walk ramp is SPLIT either side of
      // that passage — one ramp across the middle would carry anyone heading
      // for the door up the stair instead, which is the same bug as walling
      // the door off and harder to see.
      const run = p0 * 1.20, nS = Math.max(8, Math.ceil(rTop / 0.40)), r = rTop / nS;
      const bw = sw / 2 - hw;
      for (let i = 0; i < nS; i++) {
        const u = (i + 1) / nS, cy = u * rTop - r / 2, dep = run / nS + 0.10;
        const outN = sf.halfN + run * (1 - u) + run / nS;
        if (cy - r / 2 < e.head + 0.2 && bw > 0.6) {
          for (const sg of [-1, 1]) F.obox(ctx, sf, sg * (hw + bw / 2), cy, bw, r, dep, outN, P.light, i < 2);
        } else F.obox(ctx, sf, 0, cy, sw, r, dep, outN, i % 2 ? P.base : P.light, false);
      }
      // THE ALFARDAS: heavy sloping cheeks, each capped with its own little
      // tablero, which is what stops the stair reading as a bare ramp
      const aw = clamp(unit * 0.075, 0.55, 1.5);
      for (const sg of [-1, 1]) for (let i = 0; i < 8; i++) {
        const u = (i + 0.5) / 8, outN = sf.halfN + run * (1 - u) + run / 8;
        F.obox(ctx, sf, sg * (sw / 2 + aw * 0.6), u * rTop + 0.70, aw, rTop / 8 + 1.4, run / 8 + 0.40, outN, P.base, i < 2);
        F.obox(ctx, sf, sg * (sw / 2 + aw * 0.6), u * rTop + rTop / 16 + 1.30, aw + 0.24, 0.34, run / 8 + 0.58, outN, P.light);
      }
      const o0 = sf.out * sf.halfN, o1 = sf.out * (sf.halfN + run), tp = rTop + ctx.pp;
      for (const sg of [-1, 1]) {
        const t0 = sg * hw, t1 = sg * sw / 2;
        const rmp = sf.horiz ? { z0: ctx.oz + o1, z1: ctx.oz + o0, y0: 0, y1: tp }
          : { axis: "x", x0: ctx.ox + o1, x1: ctx.ox + o0, y0: 0, y1: tp };
        if (sf.horiz) pl(t0, t1, o0, o1, tp, rmp); else pl(o0, o1, t0, t1, tp, rmp);
      }

      // ---- C. THE TOP OF THE PLATFORM -----------------------------
      // The shell builds a cold blue-grey parapet ring at the roofline before
      // any facade runs; clad it or it is the one wrong colour up there.
      F.ring(ctx, rTop + (ctx.pp + 0.20) / 2, ctx.pp + 0.20, 0.64, P.light, 0.3, -0.46);
      ctx.dbox(0, rTop + ctx.pp * 0.5, 0, ctx.w - 0.1, Math.max(0.06, ctx.pp), ctx.d - 0.1, F.shade(P.base, 0.92));
      pl(-ctx.w / 2, ctx.w / 2, -ctx.d / 2, ctx.d / 2, rTop + ctx.pp);
    },
  });
})();
