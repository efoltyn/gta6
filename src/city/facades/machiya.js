/* ============================================================
   city/facades/machiya.js — "Japanese Residence": the minka / machiya.

   WHAT IS BEING MODELLED. A HOUSE, not a temple. The Japanese townhouse and
   farmhouse are the same building at two densities: a low timber frame with
   pale plaster panels between its posts, a veranda deck along the street
   face, and — sitting on top of all of it and dominating everything — one
   enormous tiled roof whose eaves reach so far past the wall that the ground
   floor lives permanently in its shade. That last fact is the whole style.
   A minka is a roof with a house parked under it, and this file spends most
   of its geometry accordingly: the roof owns 40-55 percent of the elevation
   at every subject size, and it is ONE roof.

   HOW THIS DIFFERS FROM pagoda.js ("Tiered Eaves"), DELIBERATELY. That file
   is a temple: many stacked eaves, dougong bracket sets, upturned corners,
   round vermilion columns, a gilt sorin mast. This one is domestic and it
   refuses all five of those moves.
     · ONE roof, not a tier per storey. There is exactly one ridge.
     · IRIMOYA (hipped-and-gabled): the lower part of the roof hips round all
       four sides, and above the hip break it becomes a straight gable with a
       plastered triangular end (tsuma) inside dark barge boards. That double
       profile is the single most recognisable Japanese roof shape and no
       other facade in the kit makes it.
     · The eave is carried on EXPOSED RAFTER TAILS — a rank of small cedar
       ends walking out from under the tile — not on bracket sets. A house
       cannot afford dougong and does not pretend to.
     · The corners come DOWN, not up. A domestic kawara eave is a straight
       low line; an upturned horn on a farmhouse would read as a mistake.
     · Every post is SQUARE, so every post is a free dbox. pagoda spends
       twenty real cylinders on its colonnade; this facade mints two meshes
       in total, both of them entry lanterns.

   THE ELEMENTS AND WHY EACH ONE IS HERE.

     GREAT ROOF   stepped horizontal courses of dark kawara tile from the
                  eave lip up to the ridge, sized at each course's TOP so
                  every course laps the one below it, with a thin darker lap
                  line at each joint. It starts BELOW the wall head and
                  reaches EO past the wall on every side, so the eave line
                  sits low and the wall is in shadow — the reason these
                  houses read as horizontal from any distance.
     RIDGE        three stacked courses, deliberately thick, with a heavier
                  capping roll and an onigawara end block at each end. A thin
                  ridge is the fastest way to make a tiled roof look printed.
     END TILES    a small block at the eave lip over EVERY rafter, because
                  kawara terminates in a row of round tile ends and that
                  dotted line is what the eye actually reads as "tile".
     GABLE        plastered tsuma panel, stepped dark barge boards up both
                  slopes, a gegyo pendant under the ridge point and a barred
                  mushiko vent for the attic.
     SHINKABE     the wall: pale plaster in the solid sill and header zones,
                  gridded by exposed dark posts on every bay line (verticals
                  may cross the host glazing and that is exactly how a
                  continuous ribbon turns back into separate punched
                  windows), horizontal nageshi and kamoi rails inside the
                  solid zones only, and a dark timber base board at the foot.
     KOUSHI /     the host's own window band is FRAMED, never covered: the
     SHOJI        street storey gets a close-set dark lattice screen over it,
                  the upper storeys a coarser pale shoji grid. The glass
                  behind is the dark ground those muntins are read against.
     ENGAWA       a continuous veranda deck along the entrance face, 0.40 m
                  up (under physics STEP_UP 0.45) with a 0.20 m stone step in
                  the door gap, both registered with ctx.plat so the player
                  walks up and straight in. Low koran railing, board seams
                  running parallel to the wall the way engawa boards do, and
                  slender square posts up to the veranda roof.
     HISASHI      that veranda roof: a low tiled pent in the ground storey's
                  SOLID header zone, stepping down and out over the deck,
                  held clear of the wall on its way out and cut in segments
                  around the doorway. Two storeys and up only — a one-storey
                  minka needs no second roof, the great eave already covers
                  the deck.
     ENTRY        over the door, above the hisashi and clear of e.head, a
     CANOPY       small raised tiled hood on cheek boards, with a pair of
                  andon lanterns. The one place the elevation is allowed to
                  step forward.

   COLOUR is three values with real distance between them: near-black
   blue-grey kawara, warm pale plaster, and dark timber lining every edge of
   it. All three are pulled off ctx.pal.wall so the house sits in its
   district, but only lightly — the city's ambient is bright enough that a
   nominal charcoal returns as mid grey, so the tile is driven well down.

   Every dimension comes from w, d, storeys, FH, rTop or a face span. spec is
   read for one optional field, spec.tile ("slate" | "brown"), which pins the
   kawara colourway that ctx.hash would otherwise choose.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // A horizontal run on ONE face, emitted in SEGMENTS around a list of
  // tangent holes — stone.js's runBand, plus an `inset` so an eave course can
  // be held clear of the wall instead of lying against it. You do not cut a
  // hole in merged axis-aligned boxes; you decline to draw over it.
  function runBand(ctx, F, f, cy, h, proj, col, holes, over, inset) {
    const L = -f.span / 2 - (over == null ? 0.12 : over);
    const R = -L;
    let x = L;
    const hs = (holes || []).slice().sort(function (a, b) { return a[0] - b[0]; });
    for (let i = 0; i < hs.length; i++) {
      const a = Math.max(L, hs[i][0]), b = Math.min(R, hs[i][1]);
      if (b <= x) continue;
      if (a - x > 0.05) F.box(ctx, f, (x + a) / 2, cy, a - x, h, proj, col, inset);
      x = b;
    }
    if (R - x > 0.05) F.box(ctx, f, (x + R) / 2, cy, R - x, h, proj, col, inset);
  }

  CBZ.registerFacade("machiya", {
    label: "Japanese Residence",
    crownsRoof: true,
    // A minka is two storeys, three at the very most (a town machiya with a
    // low attic over the shop). Never a block, so the city-wide auto-picker
    // may not put this grammar above three.
    maxStoreys: 3,
    build: function (ctx, F, spec) {
      spec = spec || {};
      const w = ctx.w, d = ctx.d, FH = ctx.FH, rTop = ctx.rTop;
      const ST = Math.max(1, ctx.storeys | 0);
      const small = Math.min(w, d);
      const e = F.entrance(ctx);
      const ef = e.f;
      const faces = F.faces(ctx);

      // ---- palette -------------------------------------------------
      const base = (ctx.pal && ctx.pal.wall) || ctx.color;
      const brownTile = spec.tile ? (spec.tile === "brown") : (ctx.hash(0x4d17) > 0.66);
      const tile = F.shade(F.mix(brownTile ? 0x3a2f26 : 0x2a323c, base, 0.10), 0.80);
      const tileM = F.shade(tile, 0.90);
      const tileL = F.shade(tile, 1.30);              // sunlit courses / lip
      const tileD = F.shade(tile, 0.66);              // lap lines, ridge bed
      const plaster = F.mix(0xdcd1b6, base, 0.30);    // shikkui / juraku wall
      const plasterD = F.shade(plaster, 0.88);
      const timber = F.shade(F.mix(0x342719, base, 0.10), 0.88);   // posts, rails
      const timberD = F.shade(timber, 0.70);          // shadowed edges, recesses
      const cedar = F.mix(0x7a5934, base, 0.16);      // deck boards, rafter tails
      const shoji = F.mix(0xe9e0c8, base, 0.12);      // pale muntins, gegyo
      const stone = F.mix(0x8b8880, base, 0.20);      // the step at the door

      // ---- the module ----------------------------------------------
      // PB is the standard relief depth; every proj below is a multiple of it,
      // so the whole wall thickens and thins with the building.
      const PB = clamp(small * 0.016, 0.12, 0.26);
      const margin = Math.max(0.55, small * 0.055);
      const nBay = function (f) { return F.bayCount(f, clamp(small * 0.30, 2.8, 4.0), 2, 8); };

      // THE ROOF BUDGET, solved first because everything else has to stay
      // clear of it. roofH is 55 percent of the wall height — that is what
      // buys the roof its third of the elevation — but it is also clamped
      // against the PLAN, because a hip's pitch is height over half-depth and
      // a roof taller than half its own footprint is a spire, not a house.
      const EO = clamp(small * 0.22, 1.2, 3.2);        // eave overhang per side
      const eaveDrop = clamp(EO * 0.30, 0.26, 0.95);   // how far the lip sits below the wall head
      const roofH = clamp(rTop * 0.55, small * 0.30, small * 0.52);
      const yEave = rTop - eaveDrop;                   // the eave lip line
      const runV = roofH + eaveDrop;                   // total vertical run of tile

      // Ridge coordinates: `a` runs ALONG the ridge, `b` across it. Written
      // this way once so no roof line below has to know which host axis is
      // longer, and so a 22x16 lot and a 16x22 lot are the same house turned.
      const along = (w >= d);
      const A0 = (along ? w : d) + EO * 2;             // eave plan along the ridge
      const B0 = (along ? d : w) + EO * 2;             // ...and across it
      const wallA = (along ? w : d) / 2, wallB = (along ? d : w) / 2;
      const ridgeT = Math.max(0.30, small * 0.038);
      // THE HIP BREAK. Below it the roof hips on all four sides; above it the
      // ends go vertical and it is a gable. hipRun is not a taste number: at
      // one pitch the hip travels exactly as far in as the cross slope does
      // over the same rise, which is what makes the two profiles meet.
      const uBreak = 0.44;
      const hipRun = uBreak * (B0 / 2 - ridgeT / 2);
      function halfA(u) { return A0 / 2 - hipRun * Math.min(1, u / uBreak); }
      function halfB(u) { return B0 / 2 + (ridgeT / 2 - B0 / 2) * u; }
      // a box in ridge coordinates
      function rbox(a, y, b, la, h, lb, col) {
        if (along) ctx.dbox(a, y, b, la, h, lb, col);
        else ctx.dbox(b, y, a, lb, h, la, col);
      }
      // how far this face's eave reaches out (the two axes differ by a course)
      const tileC = clamp(FH * 0.115, 0.24, 0.46);
      const nR = Math.max(8, Math.min(24, Math.round(runV / tileC)));
      function eaveROf(f) {
        const bAxis = along ? f.horiz : !f.horiz;
        return bAxis ? (halfB(1 / nR) - wallB) : (halfA(1 / nR) - wallA);
      }

      // door holes: any band whose underside is below e.head must step around
      // the doorway on the entrance face.
      const doorHole = [-(e.gap / 2 + 0.75), e.gap / 2 + 0.75];
      function holes(f, yBottom) {
        return (f.s === ctx.doorSide && yBottom < e.head) ? [doorHole] : [];
      }

      // ============================================================
      //  1. THE SHINKABE WALL — plaster panels in a dark timber frame
      // ============================================================
      // Every horizontal here lives inside a SOLID host zone: the sill zone
      // k*FH … k*FH+0.55, or the header zone (k+1)*FH-0.45 … (k+1)*FH. The
      // host's continuous glazing between them is never drawn over.
      for (const f of faces) {
        for (let k = 0; k < ST; k++) {
          const y0 = k * FH, y1 = y0 + FH;
          if (k === 0) {
            // SHITAMI-ITA: the dark weatherboard base the wall stands on, with
            // a chamfered cap. On the entrance face the engawa deck stands in
            // front of it; on the flanks it is the whole plinth.
            runBand(ctx, F, f, 0.21, 0.42, PB * 1.3, timber, holes(f, 0), 0.16);
            runBand(ctx, F, f, 0.47, 0.13, PB * 1.9, timberD, holes(f, 0), 0.22);
          } else {
            // NAGESHI: the rail that covers the floor line, then the plaster
            // apron above it up to the window sill.
            runBand(ctx, F, f, y0 + 0.13, 0.26, PB * 1.5, timber, holes(f, y0), 0.20);
            runBand(ctx, F, f, y0 + 0.41, 0.28, PB * 0.8, plaster, holes(f, y0 + 0.27), 0.10);
          }
          // KAMOI: the head rail over the screens, then plaster to the ceiling.
          runBand(ctx, F, f, y1 - 0.33, 0.22, PB * 1.5, timber, holes(f, y1 - 0.44), 0.20);
          runBand(ctx, F, f, y1 - 0.11, 0.22, PB * 0.8, plaster, holes(f, y1 - 0.22), 0.10);
        }
        // THE POSTS. One plaster pier per bay line with an exposed dark post
        // down the middle of it. These are the only members allowed to cross
        // the host's window band, and crossing it is the point: without them
        // the glazing is a ribbon, with them it is a row of punched screens.
        const n = nBay(f);
        const lines = F.bayLines(f, n, margin);
        const bayW = lines.length > 1 ? (lines[1] - lines[0]) : f.span;
        const pierW = clamp(bayW * 0.22, 0.5, 1.15);
        const postW = clamp(bayW * 0.10, 0.22, 0.44);
        for (const t of lines) {
          F.rib(ctx, f, t, 0.0, rTop - 0.10, pierW, PB * 0.7, plasterD);
          F.rib(ctx, f, t, 0.0, rTop - 0.10, postW, PB * 1.9, timber);
        }
      }
      // corner posts, and the KETA — the wall plate the rafters sit on, which
      // rides in the top storey's header zone and ties the four faces.
      const cornW = clamp(small * 0.045, 0.30, 0.62);
      F.corners(ctx, rTop / 2, rTop - 0.08, cornW * 1.7, PB * 0.8, plasterD);
      F.corners(ctx, rTop / 2, rTop - 0.08, cornW, PB * 2.0, timberD);
      F.ring(ctx, rTop - 0.17, 0.30, PB * 2.3, timber, 0.36);

      // ============================================================
      //  2. KOUSHI AND SHOJI — the host's own windows, framed
      // ============================================================
      // The glass zone per storey is k*FH+0.55 … (k+1)*FH-0.45. Nothing solid
      // goes in it: only muntins, and a frame around it. The street storey
      // gets a close-set dark lattice (the machiya's signature), the storeys
      // above it a coarser pale shoji grid, which is also the honest reading —
      // downstairs is the shop, upstairs is where people sleep.
      const mullT = clamp(small * 0.008, 0.05, 0.09);
      for (const f of faces) {
        const n = nBay(f);
        const bays = F.bays(f, n, margin);
        for (let k = 0; k < ST; k++) {
          const g0 = k * FH + 0.56, g1 = (k + 1) * FH - 0.46;
          const gh = g1 - g0;
          if (gh < 0.5) continue;
          const street = (k === 0);
          for (const bay of bays) {
            const bw = bay.w * 0.86;
            if (street && !F.clearsDoor(ctx, f, bay.t, bw)) continue;
            const proj = street ? PB * 2.0 : PB * 1.0;      // the shop lattice bows out
            const col = street ? timber : shoji;
            // the frame: two stiles and a head/foot board. The stiles cross
            // the glass; the boards sit inside the bay, so neither is a run.
            for (const sg of [-1, 1])
              F.rib(ctx, f, bay.t + sg * (bw / 2 + mullT), g0, g1, mullT * 2.4, proj * 1.15, timber);
            F.box(ctx, f, bay.t, g0 + mullT, bw + mullT * 4, mullT * 2.2, proj * 1.15, timber);
            F.box(ctx, f, bay.t, g1 - mullT, bw + mullT * 4, mullT * 2.2, proj * 1.15, timber);
            // the muntins themselves
            const nv = street
              ? Math.max(4, Math.min(18, Math.round(bw / clamp(small * 0.016, 0.15, 0.24))))
              : Math.max(2, Math.min(6, Math.round(bw / 0.62)));
            for (let i = 1; i < nv; i++)
              F.rib(ctx, f, bay.t - bw / 2 + (bw * i) / nv, g0, g1, mullT, proj, col);
            const nh = street ? 3 : Math.max(2, Math.min(4, Math.round(gh / 0.62)));
            for (let j = 1; j < nh; j++)
              F.box(ctx, f, bay.t, g0 + (gh * j) / nh, bw, mullT, proj * 0.92, col);
            // a projecting sill board under the street lattice, which is what
            // makes it read as a screen standing off the wall rather than a
            // grille painted on it.
            if (street) {
              F.box(ctx, f, bay.t, g0 - 0.10, bw + mullT * 6, 0.16, proj * 1.5, cedar);
              F.box(ctx, f, bay.t, g1 + 0.09, bw + mullT * 6, 0.14, proj * 1.4, timberD);
            }
          }
        }
      }

      // ============================================================
      //  3. THE ENGAWA — the veranda deck along the entrance face
      // ============================================================
      // Top at 0.40 with one 0.20 step in the door gap: two rises, both well
      // under physics STEP_UP (0.45), so the deck is genuinely walkable and
      // the door genuinely reachable. No collider is minted — a veranda must
      // never be able to seal the house's own front door.
      const DECK = 0.40, STEP = 0.20;
      const engD = clamp(small * 0.16, 1.15, 2.4);
      const deckW = ef.span + 0.24;
      const halfN = ef.halfN;
      const gapHalf = (e.gap + 1.1) / 2;
      const stepD = clamp(engD * 0.45, 0.5, 1.0);
      {
        const mid = halfN + engD / 2;
        // the deck slab, its shadowed substructure, and the outer edge board
        if (ef.horiz) {
          ctx.dbox(0, DECK - 0.08, ef.out * mid, deckW, 0.16, engD, cedar);
          ctx.dbox(0, (DECK - 0.16) / 2, ef.out * mid, deckW - 0.5, DECK - 0.16, engD - 0.35, timberD);
        } else {
          ctx.dbox(ef.out * mid, DECK - 0.08, 0, engD, 0.16, deckW, cedar);
          ctx.dbox(ef.out * mid, (DECK - 0.16) / 2, 0, engD - 0.35, DECK - 0.16, deckW - 0.5, timberD);
        }
        F.box(ctx, ef, 0, DECK - 0.13, deckW + 0.1, 0.24, 0.16, timber, engD - 0.16);
        // board seams. Engawa boards run PARALLEL to the wall, so the seams
        // are long lines at stepped distances out — four boxes, not seventy.
        const nSeam = Math.max(2, Math.round(engD / 0.38));
        for (let i = 1; i < nSeam; i++)
          F.box(ctx, ef, 0, DECK - 0.02, deckW - 0.1, 0.05, 0.05, timberD, (engD * i) / nSeam);
        // the walk surfaces
        if (ef.horiz) {
          const z0 = ef.out > 0 ? halfN : -(halfN + engD), z1 = ef.out > 0 ? halfN + engD : -halfN;
          ctx.plat(-deckW / 2, deckW / 2, z0, z1, DECK, null);
        } else {
          const x0 = ef.out > 0 ? halfN : -(halfN + engD), x1 = ef.out > 0 ? halfN + engD : -halfN;
          ctx.plat(x0, x1, -deckW / 2, deckW / 2, DECK, null);
        }
        // THE KUTSUNUGI-ISHI: the stone step in the railing gap, ramped so a
        // sprinting player never samples the seam between it and the deck.
        const so = halfN + engD, so1 = so + stepD;
        if (ef.horiz) {
          ctx.dbox(0, STEP / 2, ef.out * (so + stepD / 2), gapHalf * 2, STEP, stepD, stone);
          const z0 = ef.out * so, z1 = ef.out * so1;
          ctx.plat(-gapHalf, gapHalf, Math.min(z0, z1), Math.max(z0, z1), STEP,
            { z0: ctx.oz + z1, z1: ctx.oz + z0, y0: 0, y1: STEP });
        } else {
          ctx.dbox(ef.out * (so + stepD / 2), STEP / 2, 0, stepD, STEP, gapHalf * 2, stone);
          const x0 = ef.out * so, x1 = ef.out * so1;
          ctx.plat(Math.min(x0, x1), Math.max(x0, x1), -gapHalf, gapHalf, STEP,
            { axis: "x", x0: ctx.ox + x1, x1: ctx.ox + x0, y0: 0, y1: STEP });
        }
        // KORAN: the low railing, in two runs that stop clear of the step so
        // the way in is open. Low on purpose — an engawa rail is a place to
        // sit, not a balustrade.
        const railH = clamp(FH * 0.20, 0.48, 0.78);
        const rIn = engD - 0.20;
        for (const sg of [-1, 1]) {
          const t0 = sg * gapHalf, t1 = sg * (deckW / 2 - 0.12);
          const len = Math.abs(t1 - t0);
          if (len < 0.6) continue;
          const tc = (t0 + t1) / 2;
          F.box(ctx, ef, tc, DECK + railH, len, 0.13, 0.18, timber, rIn);
          F.box(ctx, ef, tc, DECK + railH * 0.36, len, 0.09, 0.14, timberD, rIn + 0.02);
          const nB = Math.max(2, Math.round(len / clamp(small * 0.03, 0.28, 0.46)));
          for (let i = 1; i < nB; i++)
            F.rib(ctx, ef, t0 + ((t1 - t0) * i) / nB, DECK, DECK + railH, 0.07, 0.10, timberD, rIn + 0.03);
          for (const tt of [t0, t1])
            F.rib(ctx, ef, tt, DECK, DECK + railH + 0.14, 0.15, 0.20, timber, rIn - 0.01);
        }
      }

      // ============================================================
      //  4. THE HISASHI — the veranda roof, and the entry canopy
      // ============================================================
      // A low tiled pent whose innermost course lies in the ground storey's
      // SOLID header zone and whose outer courses step down and out, held
      // clear of the wall by their own inset. Two storeys and up only: on a
      // one-storey minka the great eave already shades the deck, and a second
      // roof there would start the tiering this facade exists to avoid.
      const hisY = FH - 0.20;
      const hisProj = engD + 0.18;
      const wantHis = (ST >= 2 && hisY > 1.6);
      // the entry canopy sits ABOVE e.head, so it breaks the hisashi line
      // rather than hanging into the doorway.
      const canY = Math.max(e.head + 0.16, hisY + 0.62);
      const canW = Math.min(ef.span * 0.52, e.gap + 1.9);
      const canProj = clamp(engD * 0.85, 0.9, 2.0);
      const wantCan = (rTop - canY) > 1.15;
      if (wantHis) {
        const nH = 3, dr = hisProj / nH, hDrop = clamp(hisProj * 0.26, 0.2, 0.55);
        for (const f of faces) {
          const hole = (f.s === ctx.doorSide) ? [[-canW / 2 - 0.15, canW / 2 + 0.15]] : [];
          for (let j = 0; j < nH; j++) {
            const inset = j * dr;
            const cy = hisY - (hDrop * (j + 0.5)) / nH;
            runBand(ctx, F, f, cy, 0.22, dr + 0.14, j === nH - 1 ? tileL : tile, hole,
              2 * (inset + dr) + 0.24, inset);
          }
          // the lip: a heavier verge course, a dark fascia under it, and a run
          // of end tiles so the little roof terminates like the big one.
          const lipR = hisProj - dr * 0.5;
          runBand(ctx, F, f, hisY - hDrop - 0.03, 0.26, 0.26, tileL, hole, 2 * (lipR + 0.26) + 0.3, lipR);
          runBand(ctx, F, f, hisY - hDrop - 0.24, 0.20, 0.20, timberD, hole, 2 * (lipR + 0.2) + 0.3, lipR);
          const pitch = clamp(small * 0.09, 0.6, 1.2);
          const nT = Math.max(3, Math.min(34, Math.round(f.span / pitch)));
          for (let i = 0; i <= nT; i++) {
            const t = -f.span / 2 + (f.span / nT) * i;
            if (f.s === ctx.doorSide && Math.abs(t) < canW / 2 + 0.15) continue;
            F.box(ctx, f, t, hisY - hDrop + 0.14, 0.22, 0.20, 0.24, tileL, lipR - 0.06);
          }
          // KIGAESHI brackets on the flanks, where no veranda post stands
          // under the pent. On the entrance face the engawa posts do that job.
          if (f.s === ctx.doorSide) continue;
          const lines = F.bayLines(f, nBay(f), margin);
          for (const t of lines) {
            for (let j = 0; j < 3; j++)
              F.box(ctx, f, t, hisY - 0.45 - j * 0.20, 0.20, 0.20, hisProj * (0.52 - j * 0.15), timberD);
          }
        }
        // THE ENGAWA POSTS: slender square timber from the deck to the pent,
        // on the wall's own bay lines so the frame lines up, and never in the
        // doorway. Square, therefore free — no ctx.column is spent here.
        const pw = clamp(small * 0.022, 0.15, 0.28);
        const lines = F.bayLines(ef, nBay(ef), margin);
        for (const t of lines) {
          if (!F.clearsDoor(ctx, ef, t, pw * 2 + 1.2)) continue;
          F.rib(ctx, ef, t, DECK - 0.05, hisY - 0.30, pw, pw, timber, engD - 0.28 - pw / 2);
          // a small head brace, so the post meets the beam like a joint
          F.box(ctx, ef, t, hisY - 0.42, pw * 3.4, 0.16, pw * 1.2, timberD, engD - 0.28 - pw * 0.85);
        }
        // the beam the posts carry, running the deck edge
        F.box(ctx, ef, 0, hisY - 0.34, deckW, 0.20, pw * 1.5, timber, engD - 0.28 - pw * 0.75);
      }
      if (wantCan) {
        // A small raised hood over the door: four courses out and down, a
        // verge lip, end tiles, and two cheek boards dropping to the hisashi
        // line to tie it in. Its lowest geometry clears e.head by design.
        const nC = 4, dr = canProj / nC, drop = clamp(canProj * 0.24, 0.2, 0.5);
        F.box(ctx, ef, 0, canY + 0.16, canW, 0.28, PB * 1.4, timber);
        for (let j = 0; j < nC; j++) {
          const inset = j * dr;
          F.box(ctx, ef, 0, canY + 0.48 - (drop * (j + 0.5)) / nC, canW + inset * 0.5,
            0.24, dr + 0.14, j >= nC - 2 ? tileL : tile, inset);
        }
        const lipR = canProj - dr * 0.5;
        F.box(ctx, ef, 0, canY + 0.48 - drop - 0.04, canW + canProj * 0.5, 0.28, 0.28, tileL, lipR);
        F.box(ctx, ef, 0, canY + 0.48 - drop - 0.26, canW + canProj * 0.5, 0.20, 0.22, timberD, lipR);
        const nT = Math.max(3, Math.round(canW / 0.55));
        for (let i = 0; i <= nT; i++)
          F.box(ctx, ef, -canW / 2 + (canW / nT) * i, canY + 0.48 - drop + 0.16, 0.20, 0.20, 0.24,
            tileL, lipR - 0.06);
        for (const sg of [-1, 1])
          F.rib(ctx, ef, sg * (canW / 2 + 0.12), wantHis ? hisY - 0.28 : DECK, canY + 0.4, 0.22, PB * 2.2, timber);
      }
      // THE DOOR ITSELF: two heavy jamb posts and, where there is room under
      // whatever is above, a lintel. Nothing crosses below e.head.
      {
        const jTop = Math.min(rTop - 0.32, wantCan ? canY - 0.04 : e.head + 0.55);
        for (const sg of [-1, 1])
          F.rib(ctx, ef, sg * (e.gap / 2 + 0.38), DECK - 0.1, jTop, 0.34, PB * 2.4, timber);
        // ANDON: the pair of paper lanterns either side of the entrance. Two
        // real meshes, and the only two this facade mints.
        const ly = Math.min(jTop - 0.45, e.head - 0.55);
        if (ly > DECK + 0.8) {
          const lr = clamp(small * 0.017, 0.12, 0.22);
          const nrm = halfN + engD * 0.55;
          for (const sg of [-1, 1]) {
            const t = sg * (e.gap / 2 + 0.38);
            F.box(ctx, ef, t, ly + lr * 2.1, lr * 0.8, lr * 1.6, engD * 0.6, timberD);
            const lx = ef.horiz ? t : ef.out * nrm, lz = ef.horiz ? ef.out * nrm : t;
            ctx.lamp(lx, ly, lz, lr, 0xffe0a8);
          }
        }
      }

      // ============================================================
      //  5. THE GREAT IRIMOYA ROOF
      // ============================================================
      // Stepped horizontal courses, each sized at its OWN TOP so it is inset
      // behind the course below and every joint shows a lap. Below the wall
      // head a course is emitted as four bands (the eave overhang is hollow —
      // it is a roof, not a lid over the top storey); above it, one box.
      function tileRing(cy, h, a2, b2, col) {
        if (cy - h / 2 < rTop - 0.02) {
          const tA = clamp(a2 / 2 - wallA + 0.34, 0.45, a2 / 2);
          const tB = clamp(b2 / 2 - wallB + 0.34, 0.45, b2 / 2);
          for (const sb of [-1, 1]) rbox(0, cy, sb * (b2 - tB) / 2, a2, h, tB, col);
          for (const sa of [-1, 1]) rbox(sa * (a2 - tA) / 2, cy, 0, tA, h, b2, col);
        } else {
          rbox(0, cy, 0, a2, h, b2, col);
        }
      }
      const ribW = clamp(small * 0.05, 0.24, 0.58);       // hip arris
      const bgT = clamp(small * 0.035, 0.20, 0.42);       // barge board thickness
      const bgL = clamp(B0 * 0.055, 0.42, 1.0);           // ...and its length
      const pa = halfA(1);                                // the gable's own half-length
      for (let i = 0; i < nR; i++) {
        const u0 = i / nR, u1 = (i + 1) / nR, u = (u0 + u1) / 2;
        const cy = yEave + runV * u;
        const h = runV / nR + 0.02;
        const a2 = halfA(u1) * 2, b2 = halfB(u1) * 2;
        tileRing(cy, h, a2, b2, i % 3 === 1 ? tileL : (i % 3 === 2 ? tileM : tile));
        // the lap line: a thin darker course at this course's foot, sized at
        // the foot (so it is wider) — the shadow that reads as tile at 100 m.
        tileRing(yEave + runV * u0 + 0.04, 0.08, halfA(u0) * 2 + 0.12, halfB(u0) * 2 + 0.12, tileD);
        if (u < uBreak) {
          // HIP RIBS down the four corners of the skirt.
          for (const sa of [-1, 1]) for (const sb of [-1, 1])
            rbox(sa * (a2 / 2 - ribW * 0.5), cy, sb * (b2 / 2 - ribW * 0.5),
              ribW * 1.8, h * 1.12, ribW * 1.8, tileL);
        } else {
          // THE GABLE: a plaster tsuma panel capping the tile end, framed by
          // two barge boards that step up the slope. Two blocks per end per
          // course is what makes the diagonal without rotating anything.
          for (const sa of [-1, 1]) {
            rbox(sa * (pa + 0.10), cy, 0, 0.18, h + 0.02, Math.max(0.25, b2 - bgL * 1.2), plaster);
            for (const sb of [-1, 1])
              rbox(sa * (pa + 0.28), cy, sb * (b2 / 2 + 0.05 - bgL / 2), bgT, h * 1.3, bgL, timberD);
          }
        }
      }

      // ---- the eave underside: rafter tails, fascia, end tiles ------
      // The rafters are the soffit. There is no soffit board, on purpose:
      // exposed hanadaruki are what a domestic eave is carried on, and hiding
      // them behind a panel is exactly what makes an eave look like a shelf.
      const rafPitch = clamp(small * 0.085, 0.55, 1.2);
      for (const f of faces) {
        const r = eaveROf(f);
        if (r < 0.4) continue;
        const runT = f.span + r;
        const nT = Math.max(3, Math.min(40, Math.round(runT / rafPitch)));
        const step = runT / nT;
        const rw = clamp(step * 0.30, 0.11, 0.26);
        for (let i = 0; i <= nT; i++) {
          const t = -runT / 2 + step * i;
          // two stepped segments per tail, so the tail descends with the roof
          for (let j = 0; j < 2; j++) {
            const dr = (r - 0.06) / 2;
            F.box(ctx, f, t, rTop - 0.38 - (eaveDrop - 0.12) * ((j + 0.5) / 2), rw, rw * 1.4,
              dr + 0.05, cedar, 0.06 + dr * j);
          }
          // one round tile end at the lip over every rafter
          F.box(ctx, f, t, yEave + 0.15, rw * 1.5, 0.24, 0.26, tileL, r - 0.10);
        }
        // HANAKAKUSHI: the dark fascia board closing the eave edge
        F.box(ctx, f, 0, yEave - 0.03, f.span + 2 * (r + 0.32), 0.26, 0.22, timberD, r - 0.02);
      }

      // ---- the gable's own furniture -------------------------------
      {
        const yBreak = yEave + runV * uBreak;
        const bBreak = halfB(uBreak) * 2;
        const yRidge = yEave + runV;
        const uv = Math.min(0.86, uBreak + 0.16);
        const vy = yEave + runV * uv;
        const vw = Math.min(halfB(uv) * 1.15, clamp(small * 0.14, 0.8, 2.1));
        const vh = Math.min(runV * 0.12, halfB(uv) * 0.75, 0.95);
        const gw = clamp(small * 0.09, 0.5, 1.15);
        for (const sa of [-1, 1]) {
          // the horizontal at the hip break: the foot of the barge boards
          rbox(sa * (pa + 0.26), yBreak + 0.06, 0, 0.32, 0.28, bBreak + 0.55, timberD);
          // GEGYO: the pendant hung under the ridge point. Three diminishing
          // blocks — the one ornament a farmhouse gable is allowed.
          for (let j = 0; j < 3; j++)
            rbox(sa * (pa + 0.34), yRidge - 0.34 - j * 0.24, 0, 0.20, 0.26,
              gw * (1 - j * 0.27), j === 1 ? shoji : cedar);
          // MUSHIKO-MADO: the barred attic vent, dark behind pale bars.
          if (vh > 0.3 && vw > 0.5) {
            rbox(sa * (pa + 0.17), vy, 0, 0.16, vh, vw, F.shade(timberD, 0.55));
            for (const sy of [-1, 1])
              rbox(sa * (pa + 0.27), vy + sy * (vh / 2 + 0.09), 0, 0.22, 0.16, vw + 0.34, timber);
            const nb = Math.max(3, Math.round(vw / 0.26));
            for (let j = 1; j < nb; j++)
              rbox(sa * (pa + 0.29), vy, -vw / 2 + (vw * j) / nb, 0.18, vh * 0.88, 0.07, plaster);
          }
        }

        // ============================================================
        //  6. THE RIDGE — thick, capped, and ended in onigawara
        // ============================================================
        const rl = pa * 2 + clamp(small * 0.05, 0.3, 0.85);
        const rT = ridgeT;
        rbox(0, yRidge + 0.07, 0, rl, 0.26, rT * 2.4, tileD);
        rbox(0, yRidge + 0.32, 0, rl, 0.30, rT * 1.9, tile);
        rbox(0, yRidge + 0.58, 0, rl - 0.12, 0.26, rT * 2.8, tileL);
        for (const sa of [-1, 1]) {
          rbox(sa * (rl / 2 - 0.14), yRidge + 0.44, 0, 0.34, 0.88, rT * 3.0, tileL);
          rbox(sa * (rl / 2 - 0.14), yRidge + 0.96, 0, 0.26, 0.30, rT * 2.0, tileD);
        }
        // KEMUDASHI: the little smoke vent that straddles a farmhouse ridge.
        // Position-hashed, and only on the low subjects where a minka read is
        // the right one — a three-storey town machiya vents through the shop.
        if (ST <= 2 && ctx.hash(0x6d21) > 0.42) {
          const vl = Math.min(rl * 0.30, clamp(small * 0.22, 1.2, 2.8));
          rbox(0, yRidge + 1.10, 0, vl, 0.72, rT * 3.4, plasterD);
          rbox(0, yRidge + 1.52, 0, vl + 0.24, 0.22, rT * 4.0, tile);
          rbox(0, yRidge + 1.68, 0, vl * 0.6, 0.20, rT * 4.6, tileL);
        }
      }
    },
  });
})();
