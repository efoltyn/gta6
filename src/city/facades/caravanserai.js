/* ============================================================
   city/facades/caravanserai.js — "Caravanserai": the fortified road inn of
   the Silk Road, Anatolia to Bukhara (Sultanhani, Rabat-i Sharaf, Tash Rabat).

   THE ONE FACADE IT MUST NOT BE MISTAKEN FOR is mosque.js, which is its
   cousin: both are Islamic, both put a pishtaq on the front. So the entire
   file is spent on the three things that make a caravanserai NOT a mosque:

     1. IT IS A FORT. A caravanserai held a season's worth of other people's
        silk overnight in bandit country. So: a battered blank curtain wall,
        HALF-ROUND CORNER TOWERS carried past the roofline on all four
        corners, a crenellated parapet, and — the giveaway — NO openings at
        all on the ground storey. The vents start above head height and are
        arrow-slit thin. Mosque has a dome and a minaret; this has neither,
        and if you ever add one you have built the wrong building.

     2. THE PORTAL IS THE ONLY EVENT. One monumental iwan: a tall rectangular
        frame enclosing a deep pointed-arch recess, and it BREAKS THE PARAPET
        LINE — the frame carries on above the crenellation as a solid slab
        with its own crest. A portal that stops under the cornice is a
        doorcase, and this building has nothing else, so the portal has to
        carry the whole elevation on its own.

     3. THE REST OF THE WALL IS ALMOST BARE. One register of shallow blind
        pointed niches, nothing else. No tilework band, no jali, no string
        course per floor — those are mosque.js's surface grammar and putting
        them here is how the two become the same building.

   WALL MODE "own": a warehouse-fort has no glazing. The shell hands over
   solid wall and the only holes are the slits in D and the portal in F.

   SOLIDITY: the batter courses, the tower drums and their battered feet, and
   the portal jambs are the mass a player runs into and go through the solid
   emitter. The crenellations, niches, corbel heads and portal crest are up in
   the air or moulding-sized — sbox would refuse their colliders anyway, so
   they stay free.

   MESHES: zero. The towers are F.boxShaft — three concentric boxes that read
   round at every distance a player stands — so a fort with four drum towers
   costs the same draw calls as a bare box.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  const cl = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  CBZ.registerFacade("caravanserai", {
    label: "Caravanserai",
    era: "silkroad",
    // city/collapse.js MATERIALS — rubble-cored ashlar curtain wall. It shears
    // and crumbles; there is no frame in it to pancake.
    structure: "masonry",
    wall: "own",
    crownsRoof: true,
    build: function (ctx, F) {
      const FH = ctx.FH, rTop = ctx.rTop, u = Math.min(ctx.w, ctx.d);
      const P = F.palette(ctx, "sandstone", { pull: 0.86 });

      // ---- A. THE BATTERED CURTAIN WALL ---------------------------
      // A defensive wall leans in as it rises so a ram cannot get a flat
      // face. F.batter emits its courses solid, which is most of this
      // building's mass; the corner buttresses are off because the TOWERS
      // are what turns the corners here.
      const bat = F.batter(ctx, { pal: P, buttress: false,
        n: cl(ctx.storeys + 1, 3, 5), total: cl(u * 0.055, 0.34, 0.95) });

      // ---- B. THE CORNER TOWERS -----------------------------------
      // Half-round drums straddling each corner, carried past the parapet so
      // the silhouette at 200 m is a slab with four studs on it. Failure mode
      // is a tower flush with the roofline, which reads as a pilaster.
      const tr = cl(u * 0.115, 0.85, 2.20);
      const tTop = rTop + cl(FH * 0.62, 0.95, 2.40);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * ctx.w / 2, z = sz * ctx.d / 2;
        F.boxShaft(ctx, x, 0, z, tTop, tr, P.base, P.light, true);
        F.boxShaft(ctx, x, 0, z, cl(rTop * 0.28, 0.9, 3.2), tr * 1.15, P.dark, null, true);
        for (let k = 0; k < 3; k++)          // the corbelled head under the merlons
          ctx.dbox(x, tTop + 0.10 + k * 0.17, z, tr * (2.0 + k * 0.15), 0.18,
            tr * (2.0 + k * 0.15), k === 1 ? P.trim : P.light);
        for (let i = 0; i < 8; i++) {        // the tower's own crenellation
          const a = i * Math.PI / 4;
          ctx.dbox(x + Math.cos(a) * tr * 0.94, tTop + 0.92, z + Math.sin(a) * tr * 0.94,
            tr * 0.46, 0.66, tr * 0.46, P.light);
        }
      }

      // ---- C. THE CRENELLATED PARAPET AND THE ROOF ----------------
      F.parapetWalk(ctx, { pal: P, crenel: true, h: cl(FH * 0.40, 0.70, 1.40),
        thick: bat.projAt(rTop) + 0.16 });

      // ---- D. THE VENTS -------------------------------------------
      // Above head height only, and mostly blind. A ground-floor window on a
      // strongroom is the single fastest way to stop reading as a fort.
      F.openingGrid(ctx, { pal: P, shape: "slit", blind: 0.42, hi: 5,
        y0: FH * 0.9, hFrac: 0.30, wFrac: 0.085, sillFrac: 0.50,
        lintel: false, sillOut: false });

      // ---- E. THE IWAN PORTAL, and its upstand --------------------
      const e = F.entrance(ctx), df = e.f;
      const pTop = cl(rTop * 0.80, Math.min(e.head + 1.6, rTop - 0.5), rTop - 0.45);
      const por = F.portal(ctx, { pal: P, kind: "pointed", muqarnas: false, crest: false,
        top: pTop, depth: cl(u * 0.095, 0.55, 1.70),
        width: cl(df.span * 0.34, e.gap + 2.4, df.span * 0.50) });
      // Above the arch a pishtaq is solid wall, so the upstand is ONE mass —
      // and it is what lets the portal overtop the crenellation.
      const up = rTop + cl(FH * 0.80, 1.10, 2.90);
      F.box(ctx, df, 0, (pTop + up) / 2, por.frameW, up - pTop, por.depth, P.light);
      F.box(ctx, df, 0, up + 0.14, por.frameW + 0.52, 0.32, por.depth + 0.24, F.shade(P.light, 0.85));
      const mn = Math.max(3, Math.round(por.frameW / 1.05)), ms = por.frameW / mn;
      for (let i = 0; i < mn; i++) {         // the portal's own stepped crest
        const t = -por.frameW / 2 + (i + 0.5) * ms;
        F.box(ctx, df, t, up + 0.64, ms * 0.60, 0.64, por.depth * 0.80, P.base);
        F.box(ctx, df, t, up + 1.06, ms * 0.34, 0.32, por.depth * 0.80, P.base);
      }

      // ---- F. THE BLIND ARCADE ------------------------------------
      // The only articulation the flanks get. Run AFTER the portal so the
      // door face can be told how much of itself the iwan has already taken.
      const keep = por.frameW / 2 + cl(u * 0.05, 0.4, 1.1);
      for (const f of F.faces(ctx)) {
        const n = F.bayCount(f, cl(FH * 1.20, 2.6, 4.2), 3, 9);
        for (const b of F.bays(f, n, cl(f.span * 0.09, 0.6, 1.9))) {
          if (f.s === ctx.doorSide && Math.abs(b.t) < keep + b.w * 0.3) continue;
          F.blindNiche(ctx, f, { pal: P, t: b.t, y0: bat.cH * 0.55,
            h: cl(FH * 1.20, 1.9, 3.6), wid: b.w * 0.50, kind: "pointed",
            recess: cl(b.w * 0.065, 0.10, 0.26), sill: false });
        }
      }
    },
  });
})();
