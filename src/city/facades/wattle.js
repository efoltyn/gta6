/* ============================================================
   city/facades/wattle.js — "Wattle Roundhouse": the British Iron Age hut.

   THE PROBLEM THIS FILE EXISTS TO SOLVE. The shell's plan is a RECTANGLE and
   no facade can change that, but a roundhouse that reads as a box with a
   pyramid on it is not a roundhouse. Three moves, together, make it round:

     1. THE WALL BELLIES. bulge() below is a cosine across each face: the
        middle of the wall stands a metre proud, the corners stay nearly
        flush against the shell. In plan that is a rounded rectangle, and it
        is the only way merged axis-aligned boxes can approach a circle.
     2. THE POST RING. Free-standing posts on an ELLIPSE — emitted at world
        positions, not on faces, so they owe nothing to the rectangle —
        clamped to a small margin off the wall, which turns the ellipse into
        a rounded-rectangle path that hugs the flanks and CUTS THE CORNERS.
        The corners are where the box gives itself away; the posts stand in
        front of them.
     3. THE CONE DOES THE REST. Above the eave nothing is rectangular at all:
        stacked ConeGeometry, radius solved off the plan's half-DIAGONAL so
        the box is entirely inside it, ~2.5× the wall height. This is the one
        place in the grammar worth minting real meshes — four of them, asked
        for through F.mesh so the budget can refuse, with F.thatch as the
        fallback when it does.

   THE WALL ITSELF is the culture: split stakes driven into a stone footing,
   hazel withies woven through them, daub thrown over the weave — and fallen
   off in patches, which is where you see the weave. The patches are hashed,
   so they are the same on every boot and different on every hut.

   THE PORCH is two posts and a lintel: the one bit of the building that
   sticks out of the circle, and the thing that tells a player at 30 m which
   side the door is on.

   WALL MODE "own": no windows. A roundhouse has a door and a smoke hole.

   SOLIDITY: the post ring, the porch posts and the stone footing are solid
   (F.boxShaft(solid) / F.sBox). Stakes, withies and daub are surface relief
   backed by the shell's own solid wall — sbox would refuse their colliders,
   so they go out free.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("wattle", {
    label: "Wattle Roundhouse",
    era: "neolithic",
    // city/collapse.js MATERIALS — a stake-and-withy basket rendered in mud.
    structure: "timber",
    wall: "own",
    crownsRoof: true,
    maxStoreys: 1,
    build: function (ctx, F, spec) {
      spec = spec || {};
      const rTop = ctx.rTop, FH = ctx.FH, unit = Math.min(ctx.w, ctx.d);
      const h = function (s) { return ctx.hash(s); };
      const P = F.palette(ctx, "thatch", { pull: 0.92, grain: 0.32 });
      const T = F.palette(ctx, "timber", { pull: 0.96, grain: 0.30 });
      // daub is mud, not plaster: a bright infill panel between dark stakes
      // reads as a shuttered window, which is the whole failure mode here
      const DAUB = F.shade(F.mix(P.base, 0xc7b492, 0.50), 0.86);

      // ---- THE ROUND PLAN -----------------------------------------
      const B = clamp(unit * 0.105, 0.42, 1.15);        // belly at mid-face
      const bulge = function (t, span) {
        const c = Math.cos(clamp(t / (span / 2), -1, 1) * Math.PI / 2);
        return 0.14 + B * (0.16 + 0.84 * c * c);
      };

      // ---- A. THE STAKE-AND-DAUB WALL -----------------------------
      const foot = clamp(FH * 0.13, 0.30, 0.52);
      const rows = Math.max(4, Math.round((rTop - foot) / clamp(FH * 0.22, 0.42, 0.85)));
      for (const f of F.faces(ctx)) {
        F.sBox(ctx, f, 0, foot / 2, f.span + B, foot, bulge(0, f.span) + 0.16, T.shadow, 0);
        const n = Math.max(5, Math.round(f.span / clamp(unit * 0.13, 0.55, 1.05)));
        const step = f.span / n;
        for (let i = 0; i < n; i++) {
          const t = -f.span / 2 + (i + 0.5) * step, p = bulge(t, f.span);
          F.rib(ctx, f, t, foot, rTop, step * 0.40, p + 0.06, F.shade(T.course(i + f.s * 7), 0.88));
          if (h(0x9c10 + f.s * 23 + i) < 0.30) {
            // the daub has come off here: hazel withies woven through the stakes
            for (let r = 0; r < rows; r++) {
              const y = foot + (r + 0.55) * (rTop - foot) / rows;
              F.box(ctx, f, t, y, step * 1.04, 0.13, p + 0.11, T.dark);
            }
          } else {
            // and here it is still on, one hand-thrown panel per bay
            F.rib(ctx, f, t, foot, rTop - 0.05, step * 1.08, p + 0.12,
              F.shade(DAUB, 0.90 + h(0x9c40 + f.s * 19 + i) * 0.18));
          }
        }
      }

      // ---- B. THE RING OF POSTS -----------------------------------
      // An ellipse, clamped to a fixed margin off the wall: on the flanks it
      // clamps flat and follows the face; near the diagonals it does not, and
      // the posts stand out in front of the shell's corners and hide them.
      const q = B + 0.55, pr = clamp(unit * 0.050, 0.19, 0.40);
      const eave = rTop + clamp(FH * 0.12, 0.26, 0.55);
      const nR = clamp(Math.round((ctx.w + ctx.d) / clamp(unit * 0.30, 1.3, 2.4)), 10, 22);
      const dF = F.face(ctx, ctx.doorSide);
      for (let i = 0; i < nR; i++) {
        const a = (i + 0.5) * Math.PI * 2 / nR;
        const px = clamp(Math.cos(a) * (ctx.w / 2 + q) * 1.30, -(ctx.w / 2 + q), ctx.w / 2 + q);
        const pz = clamp(Math.sin(a) * (ctx.d / 2 + q) * 1.30, -(ctx.d / 2 + q), ctx.d / 2 + q);
        // never stand a post in the doorway
        const cross = dF.horiz ? px : pz, norm = dF.horiz ? pz : px;
        if (norm * dF.out > 0 && Math.abs(cross) < 2.6) continue;
        F.boxShaft(ctx, px, 0, pz, eave - 0.12, pr, T.base, F.mix(T.base, 0xffffff, 0.16), true);
        ctx.dbox(px, eave - 0.06, pz, pr * 3.0, 0.20, pr * 3.0, T.dark);      // the head that takes the ring beam
      }

      // ---- C. THE CONE --------------------------------------------
      // Radius off the HALF-DIAGONAL, so the whole rectangle is inside it and
      // the eave overhangs on every side including the corners.
      const Rc = Math.hypot(ctx.w, ctx.d) / 2 + clamp(unit * 0.10, 0.55, 1.5);
      const CH = clamp(Rc * 1.10, FH * 1.8, 17);
      const layers = F.mesh(ctx, 5);
      for (let k = 0; k < layers; k++) {
        const u = k / 5;
        // each layer starts higher AND narrower than the last, so its foot
        // stands slightly proud of the one below: a course line, not a seam
        ctx.cone(0, eave + CH * u * 0.55, 0, Rc * (1 - u * 0.50), CH * (1 - u * 0.50),
          k === 0 ? F.shade(P.roof, 0.86) : P.course(k * 3 + 5));
      }
      if (layers < 2) {
        // budget spent: an honest stepped thatch cone in free boxes
        F.thatch(ctx, { pal: P, y0: eave, h: CH, over: Rc - Math.max(ctx.w, ctx.d) / 2 });
      }
      // the shaggy cut eave, and the bound topknot over the smoke hole
      if (layers) ctx.cone(0, eave - 0.55, 0, Rc * 1.045, 1.5, F.shade(P.roof, 0.74));
      const tk = clamp(unit * 0.05, 0.22, 0.5);
      for (let k = 0; k < 3; k++) ctx.dbox(0, eave + CH * 1.02 + k * tk * 1.2, 0,
        tk * (2.2 - k * 0.4), tk * 1.3, tk * (2.2 - k * 0.4), P.course(k + 60));

      // ---- D. THE PORCH: TWO POSTS AND A LINTEL -------------------
      const e = F.entrance(ctx), fe = e.f;
      const dp = clamp(unit * 0.15, 0.9, 2.0), dh = F.DOOR_H + 0.85;
      for (const sg of [-1, 1]) {
        const t = sg * (e.gap / 2 + pr * 1.4);
        const px = fe.horiz ? t : fe.out * (fe.halfN + dp);
        const pz = fe.horiz ? fe.out * (fe.halfN + dp) : t;
        F.boxShaft(ctx, px, 0, pz, dh, pr * 1.35, T.light, F.mix(T.light, 0xffffff, 0.18), true);
      }
      F.obox(ctx, fe, 0, dh + 0.19, e.gap + pr * 4.6, 0.38, dp + pr * 3.0, fe.halfN + dp + pr * 1.6, T.dark);
      for (let k = 0; k < 3; k++) {
        const u = (k + 0.5) / 3;
        F.obox(ctx, fe, 0, dh + 0.46 + u * 0.5, (e.gap + pr * 5.4) * (1 - u * 0.20), 0.22,
          (dp + pr * 3.4) * (1 - u * 0.40), fe.halfN + dp + pr * 1.9 - u * 0.25, P.course(k + 9));
      }
      // the door is a hole through a thick daub wall: laid across the opening
      // so the kit's carve leaves the two cheeks and the head standing
      F.box(ctx, fe, 0, F.DOOR_H / 2 + 0.08, e.gap * 0.94, F.DOOR_H + 0.18,
        bulge(0, fe.span) + 0.17, F.shade(DAUB, 0.62));
    },
  });
})();
