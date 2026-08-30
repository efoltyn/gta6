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
      // KEPT SHALLOW ON PURPOSE. F.batter's courses are what a proud niche,
      // a vent reveal and the portal recess all have to out-project; a
      // metre of course overhang swallows every one of them and the fort
      // comes out as a plain slab. A splayed plinth thinning to nothing is
      // what these walls actually do anyway.
      const bat = F.batter(ctx, { pal: P, buttress: false,
        n: cl(ctx.storeys + 2, 4, 6), total: cl(u * 0.022, 0.20, 0.40) });

      // ---- B. THE CORNER TOWERS -----------------------------------
      // Half-round drums straddling each corner, carried past the parapet so
      // the silhouette at 200 m is a slab with four studs on it. Failure mode
      // is a tower flush with the roofline, which reads as a pilaster.
      const tr = cl(u * 0.135, 1.00, 2.40);
      const tTop = rTop + cl(FH * 0.62, 0.95, 2.40);
      const bands = Math.max(3, Math.round(tTop / cl(FH * 0.75, 1.6, 2.8)));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * ctx.w / 2, z = sz * ctx.d / 2;
        F.boxShaft(ctx, x, 0, z, tTop, tr, P.base, P.light, true);
        F.boxShaft(ctx, x, 0, z, cl(rTop * 0.26, 0.9, 3.2), tr * 1.16, P.dark, null, true);
        // STRING COURSES ROUND THE DRUM. Without them an octagonal box shaft
        // reads as a flat corner pilaster; the horizontal rings are what say
        // "cylinder" at the distance a player actually sees this from. They
        // are boxShafts too — a SQUARE ring on an octagonal drum sticks out
        // at the diagonals and turns the tower into a set of shelves.
        for (let k = 1; k < bands; k++)
          F.boxShaft(ctx, x, tTop * k / bands, z, cl(tr * 0.14, 0.14, 0.30),
            tr * 1.05, k % 2 ? P.trim : P.dark);
        for (let k = 0; k < 3; k++)          // the corbelled head under the merlons
          F.boxShaft(ctx, x, tTop + 0.02 + k * 0.17, z, 0.19, tr * (1.04 + k * 0.09),
            k === 1 ? P.trim : P.light);
        for (let i = 0; i < 8; i++) {        // the tower's own crenellation
          const a = i * Math.PI / 4;
          ctx.dbox(x + Math.cos(a) * tr * 0.96, tTop + 0.94, z + Math.sin(a) * tr * 0.96,
            tr * 0.44, 0.70, tr * 0.44, P.light);
        }
      }

      // ---- C. THE CRENELLATED PARAPET AND THE ROOF ----------------
      F.parapetWalk(ctx, { pal: P, crenel: true, h: cl(FH * 0.40, 0.70, 1.40),
        thick: bat.projAt(rTop) + 0.16 });

      // ---- D. THE IWAN PORTAL, and its upstand --------------------
      const e = F.entrance(ctx), df = e.f;
      const pTop = cl(rTop * 0.80, Math.min(e.head + 1.6, rTop - 0.5), rTop - 0.45);
      const pd = cl(u * 0.095, 0.55, 1.70);
      const pw = cl(df.span * 0.34, e.gap + 2.4, df.span * 0.50);
      const por = F.portal(ctx, { pal: P, kind: "pointed", muqarnas: false,
        crest: false, top: pTop, depth: pd, width: pw });
      // Above the arch a pishtaq is solid wall, so the upstand is ONE mass —
      // and it is what lets the portal overtop the crenellation.
      // THE ARCH ORDERS, drawn here and not left to F.portal: that move
      // emits its ring at rq+0.12 and its own recess ground at rq+0.14, so
      // the ring lands 2 cm BEHIND the plane it is supposed to sit on and is
      // never visible. Two concentric rings standing proud of the ground is
      // what makes the recess read as deep rather than as a dark rectangle.
      const rq = pd - cl(pd * 0.42, 0.2, 0.6);
      // the vault behind the arch, near-black: a ring needs a void to be a
      // ring, and F.portal's own ground comes out as mid stone in daylight
      F.box(ctx, df, 0, (por.spring + por.rise + 0.4) / 2, pw * 0.94,
        por.spring + por.rise + 0.4, 0.12, F.shade(P.shadow, 0.38), rq + 0.03);
      const AN = 12, ath = cl(pw * 0.095, 0.22, 0.52);
      for (let k = 0; k < AN; k++) {
        const v = (k + 0.5) / AN, hwid = pw * 0.46 * (1 - v);
        const y = por.spring + v * por.rise, ch = por.rise / AN + 0.04;
        for (const sg of [-1, 1]) {
          // the voussoir ring — SEGMENTS, because F.arch lays full-width bars
          // and at iwan scale that fills the head with a stepped pyramid
          F.box(ctx, df, sg * (hwid + ath * 0.5), y, ath * 1.2, ch, rq + 0.46, P.light);
          const sw = pw * 0.5 - hwid - ath;      // the spandrel outside the ring
          if (sw > 0.06) F.box(ctx, df, sg * (pw * 0.5 - sw / 2), y, sw, ch, rq + 0.22, P.base);
        }
      }
      // the ring lands on an impost each side, which is what says "springing"
      for (const sg of [-1, 1])
        F.box(ctx, df, sg * pw * 0.44, por.spring - 0.14, pw * 0.18, 0.30, rq + 0.54, P.trim);
      const up = rTop + cl(FH * 0.80, 1.10, 2.90);
      F.box(ctx, df, 0, (pTop + up) / 2, por.frameW, up - pTop, por.depth, P.light);
      F.box(ctx, df, 0, up + 0.14, por.frameW + 0.52, 0.32, por.depth + 0.24, F.shade(P.light, 0.85));
      const mn = Math.max(3, Math.round(por.frameW / 1.05)), ms = por.frameW / mn;
      for (let i = 0; i < mn; i++) {         // the portal's own stepped crest
        const t = -por.frameW / 2 + (i + 0.5) * ms;
        F.box(ctx, df, t, up + 0.64, ms * 0.60, 0.64, por.depth * 0.80, P.base);
        F.box(ctx, df, t, up + 1.06, ms * 0.34, 0.32, por.depth * 0.80, P.base);
      }

      // ---- E. THE BLIND ARCADE, AND THE ONLY HOLES IN THE WALL ----
      /* LOCAL, not F.blindNiche / F.openingGrid, and deliberately: both of
         those draw their recess at the WALL PLANE (a hardcoded 0.01 inset),
         which on any battered wall is a foot inside the courses — the niche
         and the vent come out invisible. Here every plane is measured off
         bat.projAt(y) instead, so the recess is a real bite out of the
         batter whatever the batter is doing at that height. Worth promoting
         as an `inset` option on both moves; not editing them from here. */
      const keep = por.frameW / 2 + cl(u * 0.05, 0.4, 1.1);
      for (const f of F.faces(ctx)) {
        const n = F.bayCount(f, cl(FH * 1.20, 2.6, 4.2), 3, 9);
        for (const b of F.bays(f, n, cl(f.span * 0.09, 0.6, 1.9))) {
          if (f.s === ctx.doorSide && Math.abs(b.t) < keep + b.w * 0.3) continue;
          // TALL, because that is what a caravanserai's blind arcade is: it
          // runs from the plinth nearly to the cornice. A short niche band
          // reads as a row of windows the mason forgot to open.
          // EVERY PLANE MEASURED OUTWARD FROM THE WALL, never inward. A
          // recess drawn behind the wall plane is drawn inside the shell's
          // own solid wall box and is simply not there; what makes this read
          // as a recess is that the jambs and the ring stand PROUD of the
          // batter, and the ground stays at the wall.
          const y0 = bat.cH * 0.45, hg = (rTop - y0) * 0.68, wd = b.w * 0.56;
          const pr = bat.projAt(y0 + hg * 0.4) + cl(wd * 0.13, 0.22, 0.50);
          const rc = cl(wd * 0.13, 0.20, 0.44);
          F.box(ctx, f, b.t, y0 + hg / 2, wd, hg, 0.10, P.shadow, 0.01);
          for (const sg of [-1, 1])
            F.box(ctx, f, b.t + sg * (wd / 2 + rc * 0.5), y0 + hg / 2 + 0.06,
              rc * 1.10, hg + 0.12, pr, P.light, 0);
          F.box(ctx, f, b.t, y0 - 0.10, wd + rc * 2.4, 0.22, pr + 0.10, P.light);
          F.arch(ctx, f, b.t, y0 + hg, wd, Math.min(hg * 0.34, wd * 0.80),
            rc * 0.55, pr, P.light, "pointed");
          // THE VENT, high in the niche: above head height, slit-thin, and
          // on rather less than half the bays. A strongroom with a row of
          // tidy windows is not a strongroom.
          if (ctx.hash(0x51a0 + f.s * 13 + b.i * 5) > 0.52)
            F.box(ctx, f, b.t, y0 + hg * 0.80, wd * 0.15, hg * 0.15, 0.10,
              F.shade(P.shadow, 0.30), 0.02);
        }
      }
    },
  });
})();
