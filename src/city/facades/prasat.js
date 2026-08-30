/* ============================================================
   city/facades/prasat.js — "Khmer Prasat": the Angkorian temple-mountain,
   Bakong through Angkor Wat. Laterite core, sandstone dressings.

   THE PLAN IS THE BUILDING. Everything else in the kit that crowns a roof
   puts ONE thing up there — a dome, a spire, a shikhara, a mansard. A prasat
   is a QUINCUNX: one big tower at the centre and four smaller ones on the
   corners of the platform, the five peaks of Mount Meru. Read the silhouette
   from any angle and you count five towers, never one. If the four corner
   towers are dropped for cost this file has built a bad shikhara instead.

   WHY EACH PART IS HERE
     TERRACE      the moulded platform. A prasat stands on stacked terraces,
                  never on the dirt; the podium's plat lets the player walk up.
     CORNER PIER  the four corner towers cannot land on air, so the wall
                  carries a full-height laterite pier under each of them. That
                  pier is SOLID: it is the mass you bump into at ground level,
                  and it is what makes the quincunx structural instead of
                  scenery parked on a roof deck.
     THE TOWER    a stack of diminishing storeys, each an exact MINIATURE of
                  the one below — same redented cross plan, same cornice, same
                  four horns — at 0.80 the size. That self-similarity is the
                  Khmer rule; a smooth taper reads as a spire from Europe.
     ANTEFIXES    horns at every corner of every tier. This is the one detail
                  that keeps the outline PRICKLY. Without them the stack is a
                  wedding cake and the tower could be Mesoamerican.
     FALSE DOOR   a carved blind doorway on each flank: a sunk slab with
                  register bands, colonnettes and a stacked pediment. A prasat
                  has ONE real entrance and three sham ones. It is deliberately
                  NOT the kit's door — no reveal, no hole, no threshold, and it
                  is a head shorter — because a player who walks at it and
                  cannot get in must be able to see why from across the street.
     GOPURA       the gate porch, with its own three-tier tower over it. The
                  approach to a prasat always passes under a smaller prasat.
     NAGA         the serpent balustrades flanking that approach, ending in a
                  reared multi-headed hood. Solid cheeks, set outside the door
                  gap so they frame the entrance instead of blocking it.

   SOLID: terrace, corner piers, gopura posts, false-door colonnettes and the
   naga cheeks. Everything above the roofline is out of reach and free.
   Meshes: at most one cone, for the central tower's finial bud.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  const cl = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  CBZ.registerFacade("prasat", {
    label: "Khmer Prasat",
    era: "southasia",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — dry-laid laterite and
    // sandstone, no mortar: it shears and topples, it does not pancake.
    structure: "stone",
    // A temple wall is solid stone with one doorway. An office glazing band on
    // a sanctuary is the failure this flag exists to fix.
    wall: "own",
    crownsRoof: true,
    // Five stone towers on a tall block would be a folly on a car park. The
    // quincunx belongs on a low mass, which is what a prasat is.
    maxStoreys: 6,
    build: function (ctx, F) {
      const w = ctx.w, d = ctx.d, u = Math.min(w, d), rTop = ctx.rTop, FH = ctx.FH;
      const ST = Math.max(1, ctx.storeys | 0);
      const sbox = ctx.sbox || ctx.dbox;          // resolve ONCE, never call ctx.sbox
      const P = F.palette(ctx, "laterite"), Q = F.palette(ctx, "sandstone");  // red mass, carved dressings

      // ---- 1. THE TERRACE ----------------------------------------------
      const pod = F.podium(ctx, { pal: P, over: cl(u * 0.11, 0.9, 2.6) });
      F.waterTable(ctx, { y: pod.top, pal: Q });

      // ---- 2. ONE TOWER, BUILT SIX TIMES -------------------------------
      // Each tier repeats the tier below at 0.80 scale: core, two redented
      // arms making the cross plan, a cornice, four horns. Returns its top.
      function tower(cx, cz, b, tiers, y0, salt, big) {
        let y = y0, s = b;
        for (let i = 0; i < tiers; i++) {
          const th = s * 0.62, cy = y + th / 2, c = P.course(salt + i);
          ctx.dbox(cx, cy, cz, s, th, s, c);                                   // core
          ctx.dbox(cx, cy, cz, s * 1.22, th * 0.90, s * 0.46, F.shade(c, 0.94));  // redented arms
          ctx.dbox(cx, cy, cz, s * 0.46, th * 0.90, s * 1.22, F.shade(c, 0.94));
          ctx.dbox(cx, y + th - s * 0.05, cz, s * 1.14, s * 0.11, s * 1.14, Q.light);  // tier cornice
          // THE HORNS. Two blocks per corner, the upper one smaller, standing
          // on the cornice so they bristle round the foot of the tier above.
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let k = 0; k < 2; k++) {
            ctx.dbox(cx + sx * s * (0.54 + k * 0.05), y + th + s * (0.07 + k * 0.15), cz + sz * s * (0.54 + k * 0.05),
              s * (0.22 - k * 0.07), s * (0.24 - k * 0.06), s * (0.22 - k * 0.07), k ? Q.trim : Q.light);
          }
          y += th; s *= 0.80;
        }
        // THE LOTUS BUD. One pad, one bud. Boxes unless this is the central
        // tower and the mesh budget can still afford a single cone.
        const fr = s * 1.6;
        ctx.dbox(cx, y + fr * 0.14, cz, fr * 0.86, fr * 0.28, fr * 0.86, Q.light);
        ctx.dbox(cx, y + fr * 0.42, cz, fr * 0.54, fr * 0.30, fr * 0.54, Q.trim);
        if (big && F.mesh(ctx, 1) >= 1) ctx.cone(cx, y + fr * 0.56, cz, fr * 0.30, fr * 1.20, Q.trim);
        else for (let k = 0; k < 3; k++) ctx.dbox(cx, y + fr * (0.66 + k * 0.28), cz, fr * (0.38 - k * 0.10), fr * 0.30, fr * (0.38 - k * 0.10), Q.trim);
        return y;
      }

      // ---- 3. THE QUINCUNX ---------------------------------------------
      // Tower size comes from the PLAN, tier count from the tower: a bigger
      // shrine gets a taller stack, never a stretched one.
      const bC = cl(u * 0.44, 2.4, 9.0), bK = bC * 0.50;
      const kx = w / 2 - bK * 0.30, kz = d / 2 - bK * 0.30, tiers = cl(Math.round(3.2 + bC * 0.40), 4, 7);
      // the piers that carry the corner towers, SOLID, standing proud of both
      // meeting faces so they read as corner mass and stop the player
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        sbox(sx * kx, rTop * 0.5, sz * kz, bK * 1.06, rTop, bK * 1.06, P.dark);
        // storey mouldings round the pier, or it is a featureless pylon
        for (let k = 1; k <= ST; k++) ctx.dbox(sx * kx, Math.min(k * FH, rTop - 0.15), sz * kz, bK * 1.20, 0.20, bK * 1.20, Q.light);
        tower(sx * kx, sz * kz, bK, Math.max(3, tiers - 2), rTop, 0x41 + (sx > 0 ? 2 : 0) + (sz > 0 ? 4 : 0), false);
      }
      tower(0, 0, bC, tiers, rTop, 0x31, true);

      // ---- 4. THE WALL: laterite facing, laid course on course ----------
      // The shell's own wall is bare host colour under wall:"own"; if the
      // facing is left off, a red temple comes out grey office.
      const nC = cl(Math.round((rTop - pod.top) / cl(FH * 0.16, 0.45, 0.90)), 6, 30), cH = (rTop - pod.top) / nC;
      const every = Math.max(3, Math.round(nC / (ST + 1)));   // where a sandstone string course lands
      for (const f of F.faces(ctx)) for (let i = 0; i < nC; i++) {
        F.band(ctx, f, pod.top + cH * (i + 0.5), cH + 0.03, i % every ? 0.22 : 0.32, i % every ? P.course(i) : Q.light, 0.3);
      }
      for (const f of F.flanks(ctx)) {
        const dw = Math.min(f.span * 0.20, 2.3), dh = Math.min(FH * 1.25, (rTop - pod.top) * 0.52), y0 = pod.top + 0.10;
        F.box(ctx, f, 0, y0 + dh / 2, dw, dh, 0.10, P.shadow, 0.01);           // the sunk sham leaf
        for (let i = 1; i < 6; i++) F.box(ctx, f, 0, y0 + dh * i / 6, dw * 0.84, 0.10, 0.20, Q.trim, 0.02);  // its carved registers
        for (const sg of [-1, 1]) F.sRib(ctx, f, sg * (dw / 2 + 0.20), y0, y0 + dh + 0.24, 0.36, 0.30, Q.light);  // colonnettes
        F.box(ctx, f, 0, y0 + dh + 0.42, dw + 1.1, 0.40, 0.36, Q.light);        // lintel
        for (let k = 0; k < 3; k++) F.box(ctx, f, 0, y0 + dh + 0.74 + k * 0.34, (dw + 0.9) * (1 - k * 0.26), 0.34, 0.34 - k * 0.07, k ? Q.light : Q.trim);
      }
      F.cornice(ctx, { y: rTop, kind: "corbel", pal: Q });
      // the terrace the five towers stand on: a paved deck and a low parapet,
      // so the roofline is a platform and not the shell's bare slab
      ctx.dbox(0, rTop + 0.14, 0, w * 0.99, 0.28, d * 0.99, Q.base);
      F.parapet(ctx, cl(FH * 0.17, 0.5, 0.95), 0.34, P.dark, Q.light);

      // ---- 5. THE GOPURA and the NAGA APPROACH --------------------------
      const e = F.entrance(ctx), fd = e.f;
      const gD = cl(u * 0.32, 1.6, 4.4);
      const gW = Math.min(fd.span * 0.54, e.gap + cl(fd.span * 0.30, 2.4, 6.0));
      const por = F.porch(ctx, { face: fd, pal: Q, depth: gD, width: gW, roof: "flat",
        deckTop: Math.min(pod.top, F.STEP_RISE), posts: 2, roofCol: P.dark,
        eave: cl(FH * 1.2 + 0.4, e.head + 0.7, rTop - 0.6) });
      const gN = fd.halfN + gD / 2;
      tower(fd.horiz ? 0 : fd.out * gN, fd.horiz ? fd.out * gN : 0,
        Math.min(gW * 0.58, gD * 1.5), 3, por.eave + 0.26, 0x71, false);
      // put(): one call that works on any of the four door faces. t runs along
      // the face, n is distance from the building centre along its normal.
      const put = function (t, n, cy, len, h, dep, col, solid) {
        (solid ? sbox : ctx.dbox)(fd.horiz ? t : fd.out * n, cy, fd.horiz ? fd.out * n : t, fd.horiz ? len : dep, h, fd.horiz ? dep : len, col);
      };
      const nL = cl(u * 0.30, 1.8, 4.2), nH = cl(FH * 0.30, 0.85, 1.40), nT = cl(u * 0.045, 0.34, 0.72);
      // set just OUTSIDE the gopura mouth: any nearer and the balustrade that
      // frames the entrance becomes the wall that seals it
      const nOff = Math.min(fd.span * 0.46, gW * 0.5 + nT * 0.6);
      for (const sg of [-1, 1]) {
        put(sg * nOff, fd.halfN + gD + nL / 2, nH * 0.5, nT, nH, nL, P.dark, true);      // the serpent body
        put(sg * nOff, fd.halfN + gD + nL / 2, nH + 0.09, nT * 1.5, 0.18, nL, Q.light);  // its coping
        const hn = fd.halfN + gD + nL - nT * 0.5;
        put(sg * nOff, hn, nH * 1.15, nT * 1.3, nH * 1.7, nT * 1.5, P.base, true);       // the reared neck
        for (let k = 0; k < 5; k++)                                                       // the seven-headed hood
          put(sg * nOff + (k - 2) * nT * 0.66, hn, nH * 2.05 + (2 - Math.abs(k - 2)) * nT * 0.40,
            nT * 0.54, nT * 1.7, nT * 0.95, Q.trim);
      }
    },
  });
})();
