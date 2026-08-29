/* ============================================================
   city/facades/pagoda.js — "Tiered Eaves": the East Asian timber frame.

   WHAT IS BEING MODELLED. Not a roof shape borrowed off a takeaway menu — a
   STRUCTURAL SYSTEM. A Chinese or Japanese timber hall is a raised stone
   platform, a cage of round columns standing on it, a head beam tying their
   tops, and a bracket set on every column that carries a roof far out past
   the wall. The wall itself carries nothing: it is thin plaster infill and
   lattice screens hung between the posts. Every element below exists because
   that is true, and every dimension is solved from the host building.

     PODIUM     the hall never sits on the dirt. A stone platform a step
                proud of the walls, with a lower step around it. Registered
                with ctx.plat and kept under the physics STEP_UP so the
                player walks straight on and in through the door.

     COLUMNS    round vermilion posts on stone plinths, standing at the
                PODIUM edge rather than against the wall, so they carry a
                veranda in front of the plaster. Count comes from the bay
                lines of each face, deduplicated round the perimeter, so a
                shop gets eight posts and a block gets twenty.

     HEAD BEAM  the architrave that ties the column tops into one frame.
                Without it the posts read as bollards.

     DOUGONG    the bracket sets. Three receding tiers of small blocks, each
                stepping further out than the one under it, sitting on the
                bay lines. They are the honest reason the eave is allowed to
                project as far as it does, and the thing that tells the eye
                this roof is carried, not glued on.

     EAVES      one deep projecting roof per storey (per two on a tall
                block), each a stack of stepped courses: the courses drop as
                they go out, then the outermost two lift again, which is the
                concave profile of a tiled Chinese roof. A heavier verge
                course caps the lip. The DEEPEST eave is the lowest one -
                the roof gets shallower as the tower narrows, which is what
                gives the silhouette its taper.

     UPTURNED   at the four corners of every eave, a diagonal run of blocks
     CORNERS    stepping OUT and UP, with short lateral runs lifting the
                eave line along both meeting faces. This is the single most
                recognisable feature of the style and it is drawn big on
                purpose: a timid corner reads as a mistake, not as a curve.

     LATTICE    a fine grid of slim mullions filling each bay between the
                posts, over a pale plaster dado. The window IS the wall.

     CROWN      the top storey is capped by a hipped pyramid roof with a
                ridge, ornamental finials at each end of the ridge, and a
                central mast of stacked rings - the sorin of a pagoda.

   Meshes: only the veranda columns and the seven-piece finial mint real
   geometry (about 20-28 of them). Everything else is dbox and folds into the
   host's merged trim buckets, so the dressed building costs what it did bare.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("pagoda", {
    label: "Tiered Eaves",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a pagoda is interlocking timber with no nails.
    structure: "timber",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), rTop = ctx.rTop;
      const w = ctx.w, d = ctx.d, small = Math.min(w, d);
      const HW = w / 2, HD = d / 2;

      // ---- palette ------------------------------------------------
      // Derived from the host's wall tone, then pulled hard toward the
      // saturated accents the style is actually built from.
      const base = (ctx.pal && ctx.pal.wall) || ctx.color;
      const greenTile = ctx.hash(0x9a11) > 0.62;      // glazed green vs blue-grey
      const tile = F.mix(greenTile ? 0x2f4a37 : 0x2b3a49, base, 0.10);
      const tileL = F.shade(tile, 1.22);              // the sunlit outer courses
      const tileD = F.shade(tile, 0.78);              // soffit / shadowed steps
      const verm = F.mix(0xa03020, base, 0.08);       // cinnabar timber
      const vermD = F.shade(verm, 0.76);
      const vermL = F.shade(verm, 1.16);
      const plaster = F.mix(0xe7e0cd, base, 0.30);
      const stone = F.mix(0x8d8b83, base, 0.22);
      const stoneD = F.shade(stone, 0.82);
      const gold = 0xc9a23e;
      const dark = F.shade(vermD, 0.62);              // lattice shadow behind

      // ---- the module ---------------------------------------------
      // Everything scales off `small` and FH. A course is the tile unit; the
      // eave depth is the one number the whole silhouette hangs from.
      const ch = Math.max(0.11, Math.min(0.34, FH * 0.085));   // course height
      // EAVE DEPTH. A deep temple eave runs about a quarter of the building's
      // short side per side. Past that the roof plan outgrows its own footprint
      // and the eaves stop reading as roofs and start reading as shelves - and
      // the corner upturn, which reaches further still, comes off the building
      // altogether. 0.26 is the number that survived the render loop.
      const EO = Math.max(1.2, Math.min(4.0, small * 0.26));   // lowest eave depth
      const lipT = Math.max(0.16, ch * 1.25);                  // verge thickness
      const margin = Math.max(0.5, small * 0.05);
      const ent = F.entrance(ctx);

      // ============================================================
      //  1. THE PODIUM
      // ============================================================
      // Top kept under 0.45 so physics STEP_UP lets the player walk on.
      const podTop = Math.min(0.42, Math.max(0.24, FH * 0.11));
      const podOver = Math.max(0.9, EO * 0.72);       // how far it reaches out
      const stepOver = podOver + Math.max(0.5, EO * 0.30);
      ctx.dbox(0, podTop * 0.5, 0, w + podOver * 2, podTop, d + podOver * 2, stone);
      ctx.dbox(0, podTop * 0.25, 0, w + stepOver * 2, podTop * 0.5, d + stepOver * 2, stoneD);
      // the moulded lip of the platform, so it is not a raw slab edge
      ctx.dbox(0, podTop - ch * 0.35, 0, w + podOver * 2 + 0.3, ch * 0.7, d + podOver * 2 + 0.3, F.shade(stone, 1.1));
      ctx.plat(-(w / 2 + podOver), (w / 2 + podOver), -(d / 2 + podOver), (d / 2 + podOver), podTop);
      ctx.plat(-(w / 2 + stepOver), (w / 2 + stepOver), -(d / 2 + stepOver), (d / 2 + stepOver), podTop * 0.5);

      // ============================================================
      //  2. WHERE THE EAVES GO
      // ============================================================
      // One eave per storey, or per two storeys once the block is tall
      // enough that a roof every 3.5 m would read as louvres. The topmost
      // eave always lands on the roofline, because that is the one the crown
      // stands on.
      const per = ST <= 4 ? 1 : 2;
      const levels = [];
      for (let s = per - 1; s < ST - 1; s += per) levels.push((s + 1) * FH);
      levels.push(rTop);
      // the lowest eave must clear the door head; a shop's floor height is
      // sometimes shorter than its own doorway.
      if (levels.length > 1 && levels[0] < ent.head + 0.45) levels[0] = Math.min(levels[1] - FH * 0.5, ent.head + 0.45);
      const NL = levels.length;
      // depth of eave i: the lowest projects most, the top least.
      function depthOf(i) { return EO * (1 - 0.40 * (NL > 1 ? i / (NL - 1) : 0)); }

      // ============================================================
      //  3. AN EAVE
      // ============================================================
      // Five courses, each a ring reaching further from the wall than the
      // last. The profile drops as it goes out and then lifts at the lip -
      // the concave section of a tiled roof, made out of steps because a
      // rotated box is a lie you can see from any other angle.
      const PROF = [0.0, -0.34, -0.60, -0.72, -0.48];
      function eave(y, proj) {
        const nC = PROF.length;
        for (let i = 0; i < nC; i++) {
          const p = proj * (i + 1) / nC;
          const cy = y + PROF[i] * ch * 1.5;
          const over = 2 * p + 0.2;                 // so the four faces meet at the corners
          F.ring(ctx, cy, ch, p, i >= nC - 2 ? tileL : tile, over);
        }
        // the verge / ridge course at the outer lip: heavier, and lifted, so
        // the eave terminates in a line instead of fraying out.
        const yLip = y + PROF[nC - 1] * ch * 1.5 + ch * 0.55;
        F.ring(ctx, yLip, ch * 1.45, lipT, tileL, 2 * (proj + lipT) + 0.24, proj);
        // a dark soffit board tucked under the lip, which is what reads as
        // depth when the sun is on the roof.
        F.ring(ctx, y - ch * 1.9, ch * 0.7, proj * 0.92, tileD, 2 * proj * 0.92 + 0.2);
        return yLip;
      }

      // ---- the upturned corner ------------------------------------
      // A diagonal staircase of blocks climbing out of each corner, plus a
      // short lateral run on both meeting faces so the whole eave LINE lifts
      // toward the corner rather than a horn appearing out of nowhere.
      // THE OVERLAP RULE, which is the whole difference between an upturned
      // corner and a pile of floating slabs: every block in the run must be
      // longer than the step that separates it from the next one, and shorter
      // in rise than its own height. Then consecutive blocks intersect and the
      // merged result is one solid curling ridge with no daylight in it.
      function cornerLift(y, proj, yLip) {
        const N = 5;
        const rise = ch * 0.80;                       // < block height, so they overlap
        const stepOut = Math.max(0.14, proj * 0.075); // 5 steps = +0.30 proj, no more
        const bs = Math.max(0.34, proj * 0.42);       // > 2x stepOut, so they intersect
        const run = Math.max(1.2, proj * 1.15);       // how far the lift reaches along a face
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          // the horn: a diagonal staircase whose FIRST block sits on the verge
          // course itself, so the run grows out of the roof it belongs to.
          for (let j = 0; j < N; j++) {
            const ext = lipT * 0.5 + stepOut * j;
            const yy = yLip + rise * j;
            const sz2 = bs * (1 - 0.10 * j);
            ctx.dbox(sx * (HW + proj + ext), yy, sz * (HD + proj + ext), sz2, ch * 1.3, sz2,
              j === N - 1 ? gold : tileL);
          }
          // the lateral run: the verge course lifting along BOTH meeting faces
          // as it approaches the corner, so the eave LINE curves up instead of
          // a horn appearing out of nowhere at the end of a flat edge. Each
          // segment overlaps its neighbour along the face by 25%.
          const segs = 4;
          for (let j = 1; j <= segs; j++) {
            const yy = yLip + rise * j * 0.55;
            const seg = run / segs;
            const off = run - seg * (j - 0.5);        // j=1 farthest from corner
            ctx.dbox(sx * (HW - off), yy, sz * (HD + proj + lipT * 0.5), seg * 1.25, ch * 1.25, lipT * 1.6, tileL);
            ctx.dbox(sx * (HW + proj + lipT * 0.5), yy, sz * (HD - off), lipT * 1.6, ch * 1.25, seg * 1.25, tileL);
          }
        }
      }

      // ---- the bracket sets ---------------------------------------
      // Three receding tiers under the eave, on the bay lines. Each tier is a
      // block stepping further out with a cross arm on top of it.
      function dougong(y, proj) {
        const bp = Math.max(0.30, proj * 0.42);       // how far the set reaches
        const bh = Math.max(0.16, ch * 1.15);
        const armW = Math.max(0.34, small * 0.055);
        for (const f of F.faces(ctx)) {
          const n = F.bayCount(f, Math.max(2.6, small * 0.24), 2, 8);
          const lines = F.bayLines(f, n, margin);
          for (const t of lines) {
            if (!F.clearsDoor(ctx, f, t, armW) && y < ent.head + 1.2) continue;
            for (let k = 0; k < 3; k++) {
              const p = bp * (k + 1) / 3;
              const cy = y - ch * 2.4 - bh * (2.6 - k * 1.05);
              // the bearing block
              F.box(ctx, f, t, cy, armW * (0.5 + k * 0.10), bh, p, k === 2 ? vermL : verm);
              // the cross arm it carries, wider each tier
              F.box(ctx, f, t, cy + bh * 0.62, armW * (1.0 + k * 0.45), bh * 0.55, p, vermD);
            }
          }
          // the wall plate the whole set sits on
          F.band(ctx, f, y - ch * 2.4 - bh * 3.4, bh * 0.8, Math.max(0.14, bp * 0.30), vermD, 0.3);
        }
      }

      // ============================================================
      //  4. THE WALL BETWEEN THE POSTS: plaster dado + lattice screen
      // ============================================================
      const mullT = Math.max(0.055, small * 0.008);
      const wallProj = Math.max(0.10, small * 0.012);
      for (let k = 0; k < ST; k++) {
        const y0 = k * FH;
        const dadoTop = y0 + FH * 0.30;
        const winTop = y0 + FH * 0.78;
        for (const f of F.faces(ctx)) {
          const n = F.bayCount(f, Math.max(2.6, small * 0.24), 2, 8);
          const bays = F.bays(f, n, margin);
          for (const bay of bays) {
            const ground = (k === 0);
            if (ground && !F.clearsDoor(ctx, f, bay.t, bay.w * 0.5)) continue;
            // pale plaster panel under the screen
            F.box(ctx, f, bay.t, (y0 + dadoTop) / 2 + 0.05, bay.w * 0.94, dadoTop - y0 - 0.1, wallProj, plaster);
            // the dark ground the lattice is read against
            const gh = winTop - dadoTop;
            if (gh <= 0.3) continue;
            F.box(ctx, f, bay.t, (dadoTop + winTop) / 2, bay.w * 0.90, gh, wallProj * 0.45, dark);
            // the frame
            F.box(ctx, f, bay.t, dadoTop + mullT, bay.w * 0.94, mullT * 2.2, wallProj * 1.5, verm);
            F.box(ctx, f, bay.t, winTop - mullT, bay.w * 0.94, mullT * 2.2, wallProj * 1.5, verm);
            // slim mullions: a vertical every ~0.5 m, three horizontals, plus
            // a square panel in the middle - the standard geometric screen.
            const nm = Math.max(3, Math.round(bay.w * 0.86 / 0.52));
            for (let i = 1; i < nm; i++) {
              const t = bay.t - bay.w * 0.43 + (bay.w * 0.86) * i / nm;
              F.rib(ctx, f, t, dadoTop, winTop, mullT, wallProj * 1.35, verm);
            }
            for (let j = 1; j <= 3; j++)
              F.box(ctx, f, bay.t, dadoTop + gh * j / 4, bay.w * 0.90, mullT, wallProj * 1.25, verm);
            // plaster panel above the screen, up to the beam
            const above = y0 + FH - winTop;
            if (above > 0.35)
              F.box(ctx, f, bay.t, winTop + above * 0.5, bay.w * 0.94, above * 0.8, wallProj, plaster);
          }
          // the storey's own tie beam, hiding the floor line
          F.band(ctx, f, y0 + FH - ch * 0.7, ch * 1.25, wallProj * 2.0, verm, 0.3);
          if (k === 0) F.band(ctx, f, podTop + ch * 0.5, ch * 1.1, wallProj * 2.2, stoneD, 0.3);
        }
      }
      // the corner posts of the wall frame itself, full height
      F.corners(ctx, rTop / 2, rTop, Math.max(0.42, small * 0.045), wallProj * 2.2, vermD);

      // ============================================================
      //  5. THE VERANDA: round columns on plinths, tied by a head beam
      // ============================================================
      // The posts stand at the PODIUM edge, not against the wall, so the
      // lowest eave has something under it and the ground storey gains the
      // deep shaded porch the style lives on.
      {
        const colOut = Math.min(podOver * 0.72, EO * 0.60);
        const DX = HW + colOut, DZ = HD + colOut;
        const cr = Math.max(0.15, Math.min(0.40, small * 0.024));
        const beamY = levels[0] - ch * 3.0;
        const colH = Math.max(1.6, beamY - podTop);
        const fx = F.face(ctx, 0), fz = F.face(ctx, 2);
        const nx = Math.max(2, Math.min(5, Math.round(w / Math.max(4.4, small * 0.42))));
        const nz = Math.max(2, Math.min(5, Math.round(d / Math.max(4.4, small * 0.42))));
        const lx = F.bayLines(fx, nx, margin), lz = F.bayLines(fz, nz, margin);
        const pos = [];
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) pos.push({ x: sx * DX, z: sz * DZ });
        for (let i = 1; i < lx.length - 1; i++) { pos.push({ x: lx[i], z: -DZ }); pos.push({ x: lx[i], z: DZ }); }
        for (let i = 1; i < lz.length - 1; i++) { pos.push({ x: -DX, z: lz[i] }); pos.push({ x: DX, z: lz[i] }); }
        for (const p of pos) {
          // never plant a post in the doorway
          const onDoorX = (ctx.doorSide === 0 && p.z < 0) || (ctx.doorSide === 1 && p.z > 0);
          const onDoorZ = (ctx.doorSide === 2 && p.x < 0) || (ctx.doorSide === 3 && p.x > 0);
          if (onDoorX && Math.abs(p.x) < (ent.gap + cr * 2) / 2) continue;
          if (onDoorZ && Math.abs(p.z) < (ent.gap + cr * 2) / 2) continue;
          // stone plinth (free), then the vermilion shaft (a real mesh)
          ctx.dbox(p.x, podTop + cr * 0.30, p.z, cr * 3.0, cr * 0.60, cr * 3.0, stoneD);
          ctx.column(p.x, podTop + cr * 0.6, p.z, cr, colH, verm, 10);
          // the capital block that hands the load to the head beam
          ctx.dbox(p.x, podTop + cr * 0.6 + colH + ch * 0.4, p.z, cr * 2.6, ch * 0.8, cr * 2.6, vermD);
        }
        // THE HEAD BEAM: one continuous architrave round the colonnade, with
        // a lighter fascia over it. Placed by inset so it lands on the post
        // ring rather than on the wall.
        const bt = Math.max(0.20, cr * 1.5);
        const bh = Math.max(0.26, ch * 1.7);
        const yB = podTop + cr * 0.6 + colH + ch * 0.9 + bh * 0.5;
        F.ring(ctx, yB, bh, bt, verm, 2 * colOut + bt + 0.3, colOut - bt / 2);
        F.ring(ctx, yB + bh * 0.72, bh * 0.5, bt * 1.15, vermL, 2 * colOut + bt + 0.4, colOut - bt * 0.575);
      }

      // ============================================================
      //  6. THE EAVES THEMSELVES
      // ============================================================
      for (let i = 0; i < NL; i++) {
        const y = levels[i], proj = depthOf(i);
        dougong(y, proj);
        const yLip = eave(y, proj);
        cornerLift(y, proj, yLip);
      }

      // ============================================================
      //  7. THE CROWN — hipped roof, ridge, finials, sorin mast
      // ============================================================
      {
        const R = F.roof(ctx);
        const topProj = depthOf(NL - 1);
        const y0 = rTop + ch * 1.2;
        // the hip: a stepped pyramid starting a touch inside the top eave, so
        // the eave lip stays the widest thing on the roofline.
        const hipH = Math.max(1.4, small * 0.34);
        const steps = Math.max(5, Math.min(14, Math.round(hipH / Math.max(0.24, ch * 1.15))));
        // NOT F.ziggurat: a constant taper is a straight-sided pyramid, and a
        // Chinese hip is CONCAVE - it holds its width low down and only turns
        // steep near the ridge. Two things fall out of that, both wanted: the
        // section is correct, and the wide skirt swallows the host's own
        // rooftop headhouse, which stands on the slab whatever we build.
        const sh = hipH / steps;
        let top = y0;
        for (let i = 0; i < steps; i++) {
          const u = i / steps;
          const fr = 1 - 0.86 * Math.pow(u, 1.7);
          ctx.dbox(0, top + sh / 2, 0, w * 0.94 * fr, sh, d * 0.94 * fr, F.shade(tile, 1 - i * 0.022));
          top += sh;
        }

        // the ridge along the LONG axis, with a heavier cap
        const along = (w >= d);
        const rl = (along ? w : d) * 0.94 * 0.14 + Math.max(1.0, small * 0.10);
        const rt = Math.max(0.30, small * 0.045);
        const rh = Math.max(0.30, ch * 2.0);
        ctx.dbox(0, top + rh * 0.5, 0, along ? rl : rt, rh, along ? rt : rl, tileL);
        ctx.dbox(0, top + rh + ch * 0.3, 0, along ? rl + 0.3 : rt * 1.5, ch * 0.6, along ? rt * 1.5 : rl + 0.3, gold);

        // ORNAMENTAL FINIALS at each end of the ridge: the owl-tail, drawn as
        // three blocks curling up and outward.
        for (const sg of [-1, 1]) {
          for (let j = 0; j < 3; j++) {
            const ex = rl * 0.5 + rt * (0.3 + j * 0.55);
            const yy = top + rh + ch * (0.6 + j * 0.85);
            const bs = rt * (1.15 - j * 0.22);
            ctx.dbox(along ? sg * ex : 0, yy, along ? 0 : sg * ex, bs, ch * 1.1, bs, j === 2 ? gold : tileL);
          }
        }

        // THE SORIN: the mast of stacked rings that terminates a pagoda. Seven
        // real meshes, the only ones the crown is allowed.
        const mr = Math.max(0.10, small * 0.018);
        const mastH = Math.max(1.6, small * 0.30);
        const mastY = top + rh + ch * 0.6;
        ctx.column(0, mastY, 0, mr, mastH, gold, 8);
        const rings = 4;
        for (let j = 0; j < rings; j++) {
          const rr = mr * (3.2 - j * 0.55);
          ctx.column(0, mastY + mastH * (0.22 + 0.18 * j), 0, rr, mr * 0.55, gold, 12);
        }
        ctx.ball(0, mastY + mastH + mr * 1.4, 0, mr * 1.7, gold);
        // a small flame bead over the jewel, in dbox so it stays free
        ctx.dbox(0, mastY + mastH + mr * 3.4, 0, mr * 1.2, mr * 2.2, mr * 1.2, gold);
        // keep the roof deck reading as a deck under all that
        if (R.base > 3) ctx.dbox(R.cx, rTop + ctx.pp * 0.5, R.cz, R.w, Math.max(0.06, ctx.pp), R.d, stoneD);
      }
    },
  });
})();
