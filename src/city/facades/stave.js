/* ============================================================
   city/facades/stave.js — "Stave Church": Borgund, Heddal, Urnes.

   WHAT MAKES IT UNMISTAKABLE, AND THE FAILURE MODE IT IS FIGHTING. Every
   attempt at this building that goes wrong goes wrong the same way: it comes
   out as a shed with a steep roof. A stave church is not a steep roof. It is
   a stack of steep roofs — three or four of them, each stepping BACK and UP
   off the one below, so the mass climbs to a point like a wooden mountain.
   That stack is the whole silhouette and this file spends most of its budget
   on it. If you ever find yourself with two tiers, you have built a barn.

     SVALGANG   the external covered gallery on posts wrapping the base. It
                is why the building has a wide skirt at the bottom and a
                needle at the top, and it is walkable — ctx.plat, no collider
                — so the player can go round the outside of the church.

     STAVES     the wall above the gallery is VERTICAL planking: split staves
                stood upright in a sill beam. That is where the building gets
                its name, and it is also the one-glance difference from
                izba.js next door, whose whole argument is horizontal logs.

     TIERS      three or four shingled roofs. Each tapers only partway, and
                the next starts exactly where the last one stopped, so the
                profile is continuous; what separates them is the EAVE FLARE
                at the foot of each — a board standing out past the roof it
                lands on. Take the flares away and the stack reads as a cone.

     DRAGONS    carved dragon-head finials springing off the eave corners and
                off both ends of the top ridge. Nothing else in the kit has
                them and they are the thing a player remembers. The neck must
                visibly BEND — a straight spike is a lightning rod.

   WALL MODE "own": a stave church has a handful of small dark holes bored
   high in the planking and nothing else. The shell hands over solid wall and
   section C bores the holes.

   SOLIDITY: the stone sill podium and the gallery posts are what a player
   runs into, and both come out of moves that emit solid. The planking is
   surface relief, the shingles and the dragons are up in the air; sbox would
   refuse their colliders anyway, so they stay free.

   MESHES: zero. The gallery posts are F.boxShaft octagons.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  const cl = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  CBZ.registerFacade("stave", {
    label: "Stave Church",
    era: "silkroad",
    // city/collapse.js MATERIALS — a pegged timber cage on a stone sill. It
    // racks and folds; there is no masonry in it to crumble.
    structure: "timber",
    wall: "own",
    crownsRoof: true,
    // The tier stack is roughly as tall again as the walls it stands on. Past
    // three storeys that is a 40 m timber spire, which is not a thing.
    maxStoreys: 3,
    build: function (ctx, F) {
      const FH = ctx.FH, rTop = ctx.rTop, u = Math.min(ctx.w, ctx.d);
      const P = F.palette(ctx, "timber", { pull: 0.92, grain: 0.30 });
      const tim = P.base, timD = F.shade(tim, 0.66), timL = P.light, eo = cl(u * 0.055, 0.34, 0.85);
      // TARRED BLACK, not brown. A stave church roof is pine tar over pine
      // shingles and it is the darkest thing in any street it stands in —
      // which is also what makes the tier stack read as a black stepped
      // silhouette from 200 m instead of as a big beige lump.
      const sh = F.mix(P.roof, 0x14100c, 0.62), shD = F.shade(sh, 0.55);

      // ---- A. THE STONE SILL --------------------------------------
      const pod = F.podium(ctx, { pal: P, col: P.trim, capCol: P.shadow,
        over: cl(u * 0.05, 0.35, 0.95), top: cl(FH * 0.10, 0.22, F.STEP_RISE) });

      // ---- B. THE SVALGANG ----------------------------------------
      const gal = F.veranda(ctx, { pal: P, sides: "all", storeys: 1,
        depth: cl(u * 0.13, 0.95, 2.10), deckTop: Math.min(pod.top, F.STEP_RISE),
        colTop: cl(FH * 1.02, 2.50, 3.40), col: timL, trimCol: timD });

      // ---- C. THE STAVE WALL --------------------------------------
      // Upright planks, hand-split, so no two are the same width or stand out
      // the same amount. Horizontal siding here would be a log cabin.
      for (const f of F.faces(ctx)) {
        const n = Math.max(6, Math.round(f.span / cl(u * 0.036, 0.30, 0.56))), st = f.span / n;
        for (let i = 0; i < n; i++) {
          const t = -f.span / 2 + (i + 0.5) * st, j = ctx.hash(0x5700 + f.s * 41 + i);
          F.rib(ctx, f, t, pod.top, rTop, st * (0.60 + j * 0.26), 0.09 + j * 0.08, F.shade(tim, 0.84 + j * 0.32));
        }
        F.band(ctx, f, pod.top + 0.16, 0.34, 0.24, timD, 0.24);        // the sill beam
        // THE ONLY OPENINGS. A stave church is famously dark: a few small
        // bored holes high in the planking, nothing at eye level. A row of
        // windows here turns it straight back into a barn.
        for (let i = 2; i < n - 1; i += Math.max(4, n >> 2)) {
          const t = -f.span / 2 + (i + 0.5) * st;
          if (F.clearsDoor(ctx, f, t, st * 2)) F.box(ctx, f, t, rTop - cl(FH * 0.55, 1.0, 1.9), st * 1.5, st * 1.5, 0.22, P.glass, 0.03);
        }
      }

      // ---- D. THE TIER STACK --------------------------------------
      /* ONE SHINGLED TIER: stepped courses walking in on both plan axes from
         (hw,hd) toward (hw*tw, hd*td), under an EAVE FLARE that stands out
         past whatever it lands on. Local rather than F.hipRoof because that
         move is pinned to ctx.w/ctx.d and cannot be handed a smaller
         footprint — which is exactly what a tier stack is made of. Worth
         promoting as an {hw,hd,cx,cz} option on hipRoof; not editing it. */
      const tier = function (y0, hw, hd, h, tw, td, k, vg) {
        const n = Math.max(4, Math.round(h / cl(u * 0.036, 0.24, 0.44))), fl = Math.min(eo * 1.5, hw * 0.34);
        // soffit, eave board, drip — the flare that separates this tier from
        // the one it lands on. [dy, thickness, share of the flare, colour]
        for (const q of [[-0.07, 0.22, 1, shD], [0.17, 0.28, 1, timL], [0.40, 0.18, 0.5, shD]])
          ctx.dbox(0, y0 + q[0], 0, (hw + fl * q[2]) * 2, q[1], (hd + fl * q[2]) * 2, q[3]);
        for (let i = 0; i < n; i++) {
          const v = (i + 1) / n, hc = h / n + 0.05, cy = y0 + h * (i + 0.5) / n;
          const j = 0.92 + ctx.hash(0x57a0 + k * 37 + i) * 0.18, e1 = vg === 1;
          const cw = Math.max(0.20, hw * (1 - (1 - tw) * v)), cd = Math.max(0.12, hd * (1 - (1 - td) * v));
          ctx.dbox(0, cy, 0, cw * 2, hc, cd * 2, F.shade(sh, i % 2 ? j * 1.16 : j * 0.92));
          // the shingle lap, hand-split so the rows do not machine up
          if (i % 2 === 0) ctx.dbox(0, y0 + h * i / n + 0.05, 0, cw * 2 + 0.18, 0.08, cd * 2 + 0.18, shD);
          // THE GABLE ENDS, boarded and raked. Left as the sawn edge of the
          // shingle courses a gable reads as a hip; painted pale it reads as
          // stucco, which no tarred Norwegian church has ever been.
          if (vg) for (const sg of [-1, 1]) {
            ctx.dbox(e1 ? sg * (cw + 0.12) : 0, cy, e1 ? 0 : sg * (cd + 0.12), e1 ? 0.26 : cw * 2 + 0.34, hc, e1 ? cd * 2 + 0.34 : 0.26, i % 2 ? tim : timD);
            for (const sq of [-1, 1]) ctx.dbox(e1 ? sg * (cw + 0.24) : sq * (cw + 0.03), cy, e1 ? sq * (cd + 0.03) : sg * (cd + 0.24), 0.34, hc, 0.34, timL);
          }
        }
        return y0 + h;
      };
      // the pent roof over the gallery — the skirt the whole stack sits on
      const gw = ctx.w / 2 + gal.depth, gd = ctx.d / 2 + gal.depth;
      tier(gal.colTop, gw, gd, cl(u * 0.10, 0.75, 1.60), (ctx.w / 2) / gw, (ctx.d / 2) / gd, 9);

      /* AT LEAST THREE ROOFS, whatever the host, and they are two different
         things — which is the correction that made this stop reading as a
         pagoda. Roof on roof is a cone. What a stave church actually stacks
         is ROOF, then a vertical TURRET DRUM standing on the ridge, then a
         smaller roof on that, and so on: the drum is the riser and the roof
         is the tread. Take the drums out and the whole stack merges. */
      const alongX = ctx.w >= ctx.d, hw0 = ctx.w / 2 + eo * 0.5, hd0 = ctx.d / 2 + eo * 0.5;
      // THE NAVE ROOF is a GABLE: the width survives, the depth collapses to
      // a ridge. Tapering both axes equally is the pyramid this is not.
      const nav = cl((alongX ? hd0 : hw0) * 1.45, rTop * 0.55, rTop * 1.35);
      let ty = tier(rTop, hw0, hd0, nav, alongX ? 0.99 : 0.06, alongX ? 0.06 : 0.99, 0, alongX ? 1 : 2);
      const rdg = (alongX ? hw0 : hd0) * 0.99;       // half the ridge's length

      // THE TOWER on the ridge. Turret size is capped by rTop as well as by
      // the plan, or a one-storey chapel grows a cathedral spire.
      const NT = ctx.storeys >= 2 ? 3 : 2;
      let tw = cl(Math.min(u * 0.24, rTop * 0.30), 0.80, 2.40);
      for (let k = 1; k <= NT; k++) {
        const dh = tw * 0.95, last = k === NT;
        ctx.dbox(0, ty + dh / 2, 0, tw * 2, dh, tw * 2, tim);                 // the drum
        for (const a of [0, 1])                                              // its belfry openings
          ctx.dbox(0, ty + dh * 0.56, 0, tw * (a ? 1.7 : 2.06), dh * 0.46, tw * (a ? 2.06 : 1.7), P.glass);
        for (const sx of [-1, 1]) for (const sz of [-1, 1])                  // corner staves
          ctx.dbox(sx * tw * 0.86, ty + dh / 2, sz * tw * 0.86, tw * 0.36, dh, tw * 0.36, timL);
        ty = tier(ty + dh, tw, tw, tw * 1.10, last ? 0.20 : 0.42, last ? 0.07 : 0.42, k);
        tw *= 0.55;
      }
      const mh = cl(u * 0.024, 0.18, 0.36);
      for (let k = 0; k < 3; k++)                    // the mast over the crossing
        ctx.dbox(0, ty + 0.16 + k * mh, 0, tw * (1.5 - k * 0.35), mh, tw * (1.5 - k * 0.35), k % 2 ? timL : timD);

      // ---- E. THE DRAGON HEADS ------------------------------------
      const dragon = function (x, y, z, dx, dz, s) {
        for (let i = 0; i < 6; i++) {               // the neck, which must BEND
          const v = i / 5, r = s * (0.15 + v * 2.15), g = s * (0.34 - v * 0.11);
          ctx.dbox(x + dx * r, y + s * (1.55 * v - 0.58 * v * v), z + dz * r,
            g + Math.abs(dx) * s * 0.22, s * (0.42 - v * 0.11), g + Math.abs(dz) * s * 0.22, i % 2 ? tim : timD);
        }
        const hx = x + dx * s * 2.30, hy = y + s * 0.97, hz = z + dz * s * 2.30;
        ctx.dbox(hx, hy, hz, s * 0.64, s * 0.54, s * 0.64, timL);                     // skull
        ctx.dbox(hx + dx * s * 0.58, hy - s * 0.13, hz + dz * s * 0.58, s * 0.48, s * 0.30, s * 0.48, tim);
        ctx.dbox(hx + dx * s * 0.44, hy - s * 0.36, hz + dz * s * 0.44, s * 0.36, s * 0.20, s * 0.36, timD);
        for (let k = 0; k < 3; k++)                 // the crest down the nape
          ctx.dbox(hx - dx * s * k * 0.36, hy + s * (0.46 + k * 0.11), hz - dz * s * k * 0.36, s * 0.17, s * (0.36 - k * 0.07), s * 0.17, timL);
      };
      const ds = cl(u * 0.058, 0.34, 0.90);
      for (const sx of [-1, 1]) for (const sz of [-1, 1])     // the nave eave corners
        dragon(sx * hw0, rTop + 0.34, sz * hd0, sx * 0.72, sz * 0.72, ds);
      for (const sg of [-1, 1])                               // and the gable apexes
        dragon(alongX ? sg * rdg : 0, rTop + nav + 0.10, alongX ? 0 : sg * rdg, alongX ? sg : 0, alongX ? 0 : sg, ds * 0.92);
    },
  });
})();
