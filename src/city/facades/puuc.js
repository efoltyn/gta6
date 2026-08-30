/* ============================================================
   city/facades/puuc.js — "Puuc Palace": Uxmal, Kabah, Labná.

   THE READ, AND THE FAILURE MODE. Puuc is the exact opposite of the
   temple-pyramid next door in this folder: horizontal, long, low, and split
   by ONE hard line. Below the medial moulding the wall is a plain veneered
   ashlar plane with nothing on it but doorways. Above it, a frieze that is
   solid mosaic to the last centimetre — colonnettes, stepped-fret lattice,
   long-nosed Chaac masks piled up at the corners — closed by a superior
   moulding. The CONTRAST is the style. A wall decorated evenly top to bottom
   is not a lesser Puuc palace, it is a different building, and it is the one
   way this file can fail while still looking busy.

   WHAT MAKES A RANGE. The Governor's Palace is one storey; ctx.storeys is
   whatever the city hands us. So the unit that repeats is the RANGE — plain
   wall, medial moulding, frieze, superior moulding — and a taller host gets
   more of them, stacked the way the Nunnery Quadrangle stacks its own. Every
   band is a fraction of the range and the range is a fraction of rTop, so an
   11 m shop and a 34 m block both come out banded instead of stretched.

   THE THREE THINGS IN THE FRIEZE, and why each is there:
     COLONNETTES  a close run of half-round shafts across the lower frieze —
                  the mosaic quotes the bound-pole walls the masonry replaced.
                  Their pitch is the smallest rhythm on the building.
     STEPPED FRET the xicalcoliuhqui: a hook of stepped bars, mirrored every
                  other unit so the run reads as a woven band and not as a row
                  of identical stamps.
     CORNER MASKS stacks of long-nosed Chaac masks at BOTH ends of every face,
                  so at each arris two stacks meet and the corner grows a
                  vertical pile of snouts. That pile is the Puuc silhouette
                  cue at distance, and it is why the masks live at the ends
                  rather than being spread evenly along the frieze.

   WALL MODE "own": no glass. The only openings are the row of plain
   rectangular doorways at plaza level, with real solid jambs and a heavy
   lintel — the Maya had no arch, so every opening is a beam over two piers.

   SOLIDITY: the basal platform, the doorway jambs and the ground-level
   colonnette run are F.solid; everything in the frieze is up at 8 m+ where
   sbox refuses colliders anyway, so it goes through ctx.dbox and is free.

   BUDGET: zero meshes.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("puuc", {
    label: "Puuc Palace",
    era: "meso",
    structure: "stone",
    wall: "own",
    maxStoreys: 8,
    build: function (ctx, F, spec) {
      const rTop = ctx.rTop, FH = ctx.FH, unit = Math.min(ctx.w, ctx.d);
      const P = F.palette(ctx, "ashlar", { pull: 0.84, grain: 0.14 });
      const red = F.mix(P.dark, 0x9c3222, 0.55);          // paint left in the mask sockets
      const mp = clamp(unit * 0.045, 0.30, 0.62);         // how far a moulding oversails

      // ---- A. THE BASAL PLATFORM ----------------------------------
      const pod = F.podium(ctx, { pal: P, over: clamp(unit * 0.075, 0.7, 2.2) });

      // ---- B. THE FRIEZE, drawn on one face ------------------------
      const frieze = function (f, y0, y1) {
        const fh = y1 - y0;
        const cz = clamp(fh * 1.15, 1.2, 3.0);            // the corner mask zone
        const half = f.span / 2;
        // MASKS: two stacks per face end, so every arris carries four
        const nm = Math.max(2, Math.round(fh / clamp(fh * 0.52, 0.7, 1.4)));
        for (const sg of [-1, 1]) for (let m = 0; m < nm; m++) {
          const t = sg * (half - cz * 0.5), mh = fh / nm, cy = y0 + (m + 0.5) * mh;
          F.box(ctx, f, t, cy, cz * 0.92, mh * 0.96, mp * 0.78, P.course(m + f.s * 3));
          F.box(ctx, f, t, cy + mh * 0.32, cz * 1.00, mh * 0.22, mp * 1.05, P.light);   // the brow
          for (const e of [-1, 1]) F.box(ctx, f, t + e * cz * 0.26, cy + mh * 0.08, cz * 0.26, mh * 0.26, mp * 0.98, red);
          for (let k = 0; k < 3; k++) {                   // the snout, curling up and out
            F.box(ctx, f, t, cy - mh * 0.24 + k * mh * 0.14, cz * (0.30 - k * 0.06), mh * 0.16,
              mp * (1.15 + k * 0.75), k === 2 ? P.light : P.base);
          }
        }
        // COLONNETTES across the lower frieze, between the mask stacks
        const mid = f.span - cz * 2, y2 = y0 + fh * 0.46;
        const nc = Math.max(3, Math.round(mid / clamp(unit * 0.028, 0.34, 0.52)));
        for (let i = 0; i < nc; i++) {
          const t = -mid / 2 + (i + 0.5) * (mid / nc);
          F.rib(ctx, f, t, y0 + 0.06, y2 - 0.06, (mid / nc) * 0.62, mp * 0.80, P.course(i * 2 + 7));
          F.rib(ctx, f, t, y0 + 0.06, y2 - 0.06, (mid / nc) * 0.30, mp * 1.02, P.light);
        }
        // STEPPED FRET across the upper frieze, mirrored unit to unit
        const uw = clamp(fh * 0.85, 0.8, 2.2), nf = Math.max(2, Math.round(mid / uw));
        const step = mid / nf, fy = y2 + 0.10, fhh = y1 - fy - 0.06;
        for (let i = 0; i < nf; i++) {
          const t = -mid / 2 + (i + 0.5) * step, e = (i % 2) ? 1 : -1;
          F.box(ctx, f, t, fy + fhh * 0.86, step * 0.86, fhh * 0.24, mp * 0.95, P.light);
          for (let k = 0; k < 3; k++) {
            F.box(ctx, f, t + e * step * (0.30 - k * 0.11), fy + fhh * (0.14 + k * 0.24),
              step * (0.30 + k * 0.16), fhh * 0.22, mp * 0.95, k % 2 ? P.base : P.light);
          }
          F.rib(ctx, f, t - e * step * 0.34, fy, fy + fhh * 0.62, step * 0.22, mp * 0.95, P.shadow);
        }
      };

      // ---- C. THE RANGES ------------------------------------------
      const nR = Math.max(1, Math.round(ctx.storeys / 2)), rh = rTop / nR;
      for (let g = 0; g < nR; g++) {
        const y0 = g * rh, med = y0 + rh * 0.56, top = y0 + rh;
        // THE PLAIN WALL. A thin ashlar veneer over the shell, one box a face:
        // without it the blank half is the host's office colour and the two
        // halves of the range read as two different buildings.
        for (const f of F.faces(ctx)) F.band(ctx, f, (y0 + med) / 2, med - y0, 0.10, P.course(g * 5 + f.s), 0.16, 0);
        // THE MEDIAL MOULDING — the line the whole grammar turns on
        F.ring(ctx, med + 0.11, 0.22, mp * 0.62, P.shadow, 0.22, 0);
        F.ring(ctx, med + 0.36, 0.34, mp, P.light, 0.26, 0);
        F.ring(ctx, med + 0.60, 0.16, mp * 0.74, P.base, 0.22, 0);
        for (const f of F.faces(ctx)) frieze(f, med + 0.74, top - 0.56);
        // THE SUPERIOR MOULDING closing the frieze
        F.ring(ctx, top - 0.40, 0.36, mp * 1.10, P.light, 0.28, 0);
        F.ring(ctx, top - 0.12, 0.18, mp * 0.80, P.base, 0.22, 0);
      }

      // ---- D. THE DOORWAY ROW at plaza level ----------------------
      // A beam on two piers: there is no arch anywhere in this architecture,
      // and a Puuc range is read from the ground by its row of dark holes.
      const dh = clamp(FH * 0.80, 2.2, 3.0);
      for (const f of F.faces(ctx)) {
        const bays = F.bays(f, F.bayCount(f, 4.6, 2, 6), clamp(f.span * 0.11, 0.9, 2.2));
        for (const b of bays) {
          const ww = clamp(b.w * 0.34, 1.0, 2.1);
          if (!F.clearsDoor(ctx, f, b.t, ww + 1.6)) continue;
          F.box(ctx, f, b.t, pod.top + dh / 2, ww, dh, 0.12, F.shade(P.shadow, 0.30), 0.02);
          for (const sg of [-1, 1]) F.sRib(ctx, f, b.t + sg * (ww / 2 + 0.24), pod.top, pod.top + dh + 0.12, 0.46, 0.32, P.light, 0.02);
          F.box(ctx, f, b.t, pod.top + dh + 0.30, ww + 1.30, 0.34, 0.36, P.trim, 0.02);
        }
      }

      // ---- E. THE ROOF --------------------------------------------
      // The shell's own parapet is a cold blue-grey ring it builds before any
      // facade runs; clad it, or the one wrong colour on the building is the
      // top edge of it. Deck walkable — a palace roof is a terrace.
      F.ring(ctx, rTop + (ctx.pp + 0.20) / 2, ctx.pp + 0.20, 0.64, P.light, 0.3, -0.46);
      ctx.dbox(0, rTop + ctx.pp * 0.5, 0, ctx.w - 0.1, Math.max(0.06, ctx.pp), ctx.d - 0.1, F.shade(P.base, 0.92));
      ctx.plat(-ctx.w / 2, ctx.w / 2, -ctx.d / 2, ctx.d / 2, rTop + ctx.pp);
    },
  });
})();
