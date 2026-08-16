/* ============================================================
   city/facades/neogothic.js — "Cathedral of Commerce": the gothic SKYSCRAPER.

   WHAT IS BEING MODELLED. Cass Gilbert's Woolworth Building (1913): gothic
   verticality applied to a sixty-storey speculative office tower. This is a
   different animal from the low-rise Gothic Revival hall already in the kit.
   A cathedral front is a wall of bays you read one at a time from thirty
   metres. A tower is read as a WHOLE, from a kilometre, and its storeys are
   2.5% of its elevation each. So the grammar is not "the hall, forty times".
   It is banded:

       PODIUM   3-4 storeys of richly worked stone, the street wall
       SHAFT    thirty storeys of UNBROKEN vertical pier, cheap and long
       TRANSIT  a gargoyle-and-niche band where the shaft stops
       CROWN    setback mass, flying buttresses, pinnacles, a central spire

   WHY EACH ELEMENT EXISTS.
     PIERS       The core move, and the reason this grammar is affordable.
                 One tall box per bay line per face runs from the podium
                 cornice to the transition band WITHOUT a single horizontal
                 crossing it. Nothing in the shaft is allowed to interrupt a
                 pier - that prohibition is the entire sensation of soaring,
                 and it costs four boxes per bay for a hundred metres.
     BAYS        Between the piers the wall recesses into a continuous dark
                 glass slot, one box for the whole shaft height. The recess
                 is what makes the piers read as structure rather than stripe.
     SPANDRELS   The floor lines only exist INSIDE the recess: a light
                 traceried panel plus one mullion stub per bay per storey.
                 Two boxes. That is the whole per-storey budget, deliberately,
                 because at 128 m a third box would be invisible and would
                 cost 900 more of them.
     GRADUATED   The stone pales as it rises. Gilbert's terracotta does this
     COLOUR      on purpose to exaggerate height - the top looks further away
                 than it is. Reproduced here by mixing the pier colour against
                 height, which is free.
     TRANSITION  Where the shaft dies: a corbelled cornice, canopied niches on
                 alternate piers, and gargoyle waterspouts. Signals the end of
                 the shaft so the crown is not simply a hat.
     CROWN       Where all the geometry is spent, because this is what the
                 skyline plate photographs. The mass steps in twice, corner
                 turrets grow crocketed pinnacles, stepped flying-buttress
                 arcs spring from those turrets to the central tourelle, and a
                 tall stepped spire with a finial tops the lot. Four distinct
                 roofline levels, all of it silhouette.
     PODIUM      The only part a player on foot touches. Deep buttressed
                 piers, tall traceried pointed windows over two storeys, a
                 huge pointed entrance portal with three receding orders, and
                 a crocketed cornice. Detailed at hand scale because it is
                 seen at hand scale.

   BUDGET. Everything is ctx.dbox - not one real mesh is minted, so a dressed
   tower is the same draw call count as a bare one. MEASURED on the standard
   34x28 m 40-storey subject: 8332 merged boxes shell included, 208 per
   storey, against the 9000 / 225 ceiling. It gets there by banding - the
   shaft is 60% of the height and about a third of the boxes, because a shaft
   bay costs three boxes for its whole hundred metres plus two per floor line,
   while a podium bay costs thirty. Every dimension derives from ctx.w /
   ctx.d / ctx.storeys / ctx.FH /
   ctx.rTop or a face span, so an 18-storey subject drops a crown tier and a
   52-storey one lengthens the shaft rather than smearing the ornament.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("neogothic", {
    label: "Cathedral of Commerce",
    crownsRoof: true,
    minStoreys: 18,
    build: function (ctx, F, spec) {
      const W = ctx.w, D = ctx.d, FH = ctx.FH, ST = Math.max(1, ctx.storeys);
      const unit = Math.min(W, D);
      const H = ctx.rTop;

      // ---- palette --------------------------------------------------
      // Warm cream terracotta, anchored to REAL mid values. Deriving it by
      // lightening the host colour washes everything out - this renderer
      // clips above about 0x99 - so the two anchors are literal and the host
      // colour only tints them.
      const C = {};
      C.lo = F.mix(0x6f6047, ctx.color, 0.14);       // podium: warm, saturated
      C.hi = F.mix(0x8b8065, ctx.color, 0.08);       // crown: paler, chalkier
      C.dark = F.shade(C.lo, 0.52);                  // reveals
      C.deep = F.shade(C.lo, 0.34);                  // the deepest orders
      C.plinth = F.shade(ctx.color, 0.42);
      C.glass = F.mix(0x141210, 0x2a2018, 0.30 + ctx.hash(0x4e05) * 0.3);
      // the graduated stone: t=0 at the pavement, t=1 at the spire tip
      const stone = function (y) { return F.mix(C.lo, C.hi, clamp(y / Math.max(1, H), 0, 1)); };

      // ---- the banding ----------------------------------------------
      // Solved from the storey count so the same grammar holds at 18 and 52.
      const podST = clamp(Math.round(ST * 0.09), 3, 4);   // podium storeys
      const podY = podST * FH;                            // podium cornice line
      const transH = clamp(FH * 1.3, 2.2, 6);             // transition band depth
      const shaftTop = H - transH;                        // where piers stop
      const PJp = clamp(unit * 0.045, 0.35, 1.5);         // pier projection
      const PJw = clamp(unit * 0.016, 0.12, 0.34);        // window relief
      const e = F.entrance(ctx);

      // ============================================================
      //  1. PLINTH — the ground course everything lands on
      // ============================================================
      const plinthH = clamp(FH * 0.30, 0.6, 1.5);
      F.ring(ctx, plinthH / 2, plinthH, PJp * 0.9, C.plinth, 0.3);
      F.ring(ctx, plinthH + 0.12, 0.24, PJp * 1.05, C.dark, 0.4);

      // ============================================================
      //  2. THE BAY PLAN — one rhythm, shared by podium, shaft and crown
      // ============================================================
      const plan = [];
      for (const f of F.faces(ctx)) {
        // A TOWER BAY IS WIDER THAN A HALL BAY. At 128 m a 3 m bay makes a
        // pinstripe and costs a storey's worth of boxes per bay to do it.
        const per = clamp(unit * 0.16, 3.6, 5.2);
        const n = F.bayCount(f, per, 3, 8);
        const marg = clamp(f.span * 0.055, 0.4, 1.4);
        const lines = F.bayLines(f, n, marg);
        const bays = F.bays(f, n, marg);
        const step = lines.length > 1 ? (lines[1] - lines[0]) : f.span;
        plan.push({ f: f, n: n, marg: marg, lines: lines, bays: bays, step: step,
          pw: clamp(step * 0.34, 0.5, step * 0.44) });
      }

      // ============================================================
      //  3. THE SHAFT — unbroken piers, recessed glass, tracery spandrels
      // ============================================================
      // THE RULE: between podY and shaftTop nothing horizontal may cross a
      // pier. Every floor line lives INSIDE the recess, behind the pier face.
      const shaftH = Math.max(FH, shaftTop - podY);
      for (const p of plan) {
        const f = p.f;
        const bw = p.pw;

        // --- the piers: one box, a hundred metres, no interruptions ----
        for (let i = 0; i < p.lines.length; i++) {
          const t = p.lines[i];
          const end = (i === 0 || i === p.lines.length - 1);
          const w = end ? bw * 1.25 : bw;
          F.rib(ctx, f, t, podY, shaftTop, w, PJp, stone((podY + shaftTop) / 2));
          // a slim colonnette riding the pier face, standing further proud.
          // It is what stops a pier being a plank, and it is one more box.
          F.rib(ctx, f, t, podY, shaftTop, w * 0.30, PJp * 1.30, C.hi);
          // ...and its shadow groove either side, again full height.
          F.rib(ctx, f, t, podY, shaftTop, w * 0.72, PJp * 0.62, C.dark);
        }

        // --- the recessed bays: one glass slot each, full shaft height ---
        const gw = Math.max(0.4, p.step - bw - 0.1);
        for (const b of p.bays) {
          F.rib(ctx, f, b.t, podY, shaftTop, gw, PJw * 0.5, C.glass);
          // the bay mullion, also unbroken, dividing the slot into two lights
          F.rib(ctx, f, b.t, podY, shaftTop, clamp(gw * 0.10, 0.1, 0.3), PJw * 1.5, C.hi);
        }

        // --- the spandrels: TWO boxes per bay per storey, and no more ----
        const s0 = Math.ceil(podY / FH), s1 = Math.floor(shaftTop / FH);
        for (let s = s0; s <= s1; s++) {
          const y = s * FH;
          if (y <= podY + 0.2 || y >= shaftTop - 0.2) continue;
          const col = stone(y);
          for (const b of p.bays) {
            // the traceried panel at the floor line, set BACK from the pier
            F.box(ctx, f, b.t, y, gw * 0.92, FH * 0.20, PJw * 1.1, col, -PJw * 0.1);
            // a quatrefoil stub centred on it, on ALTERNATE floors only. At
            // this distance the eye reads the rhythm, not the count, and every
            // floor would cost 450 boxes to say the same thing.
            if (s % 2 === 0) F.box(ctx, f, b.t, y, gw * 0.20, FH * 0.13, PJw * 1.9, C.dark, -PJw * 0.1);
          }
        }
      }

      // ============================================================
      //  4. THE PODIUM — a street wall in its own right
      // ============================================================
      const PJb = PJp * 1.7;                      // podium piers are DEEPER
      const podWinTop = podY - FH * 0.55;
      for (const p of plan) {
        const f = p.f;
        // deep buttressed piers, landing on the plinth, carrying the shaft
        for (let i = 0; i < p.lines.length; i++) {
          const t = p.lines[i];
          const end = (i === 0 || i === p.lines.length - 1);
          const w = (end ? p.pw * 1.25 : p.pw) * 1.15;
          F.rib(ctx, f, t, plinthH, podY, w, PJb, C.lo);
          F.rib(ctx, f, t, plinthH + 0.2, podY - 0.3, w * 0.34, PJb * 1.16, C.hi);
          // the weathered setback where the podium pier hands off to the shaft
          for (let k = 0; k < 3; k++) {
            F.box(ctx, f, t, podY - 0.5 + k * 0.22, w * (1 - k * 0.07), 0.2,
              PJb * (1 - k * 0.20), C.hi);
          }
        }
        // TALL TRACERIED WINDOWS spanning the podium's upper storeys, so the
        // base reads as one order rather than as three stacked shop fronts.
        const y0 = plinthH + FH * 0.55;
        for (const b of p.bays) {
          const ww = Math.max(0.5, p.step * 0.62);
          if (!F.clearsDoor(ctx, f, b.t, ww + PJw * 4)) continue;
          // full tracery only on the entrance face, where a player stands
          podWindow(ctx, F, f, b.t, y0, ww, podWinTop - y0, PJw, C, stone(podY * 0.5),
            f.s === ctx.doorSide);
        }
        // CANOPIED NICHES between the podium windows at first-floor level
        for (let i = 1; i < p.lines.length - 1; i += 2) {
          const t = p.lines[i];
          if (!F.clearsDoor(ctx, f, t, p.pw * 2)) continue;
          niche(ctx, F, f, t, podY - FH * 1.5, p.pw * 0.62, FH * 0.9, PJb, C);
        }
      }
      // the podium cornice: corbels, a crocketed run and a coping. This is the
      // horizontal the shaft is NOT allowed to have, spent all in one place.
      {
        const cy = podY - FH * 0.18;
        F.ring(ctx, cy, FH * 0.10, PJb * 1.25, C.dark, 0.4);
        F.ring(ctx, cy + FH * 0.16, FH * 0.16, PJb * 1.55, C.hi, 0.5);
        F.ring(ctx, cy + FH * 0.30, FH * 0.07, PJb * 1.15, C.lo, 0.4);
        for (const p of plan) {
          const f = p.f;
          const cn = Math.max(6, p.n * 3);
          F.merlons(ctx, f, cy + FH * 0.09, cn, clamp(f.span / (cn * 3), 0.14, 0.5),
            FH * 0.16, PJb * 1.4, C.lo);          // the corbel course
          F.merlons(ctx, f, cy + FH * 0.40, p.n * 2, clamp(f.span / (p.n * 7), 0.16, 0.5),
            FH * 0.22, PJb * 1.1, C.hi);          // crockets on the coping
        }
      }

      // ============================================================
      //  5. THE PORTAL — a huge pointed arch, three receding orders
      // ============================================================
      {
        const f = e.f;
        const portW = clamp(e.gap * 2.2, unit * 0.24, unit * 0.50);
        const portH = Math.max(e.head + 0.6, clamp(FH * 2.0, 3.2, podY * 0.72));
        const jw = clamp(portW * 0.10, 0.22, 0.8);
        const rise = portW * 0.66;
        const body = Math.max(0.6, portH - rise);
        F.box(ctx, f, 0, body * 0.55, portW * 0.88, body * 0.9, PJw * 0.6, C.deep);
        F.box(ctx, f, 0, body + rise * 0.32, portW * 0.86, rise * 0.6, PJw * 0.6, C.deep);
        for (let i = 2; i >= 0; i--) {
          const hw = portW / 2 + jw * i;
          const pj = PJb * (0.5 + i * 0.36);
          const col = i === 0 ? C.deep : (i === 1 ? C.dark : C.hi);
          for (const sg of [-1, 1]) {
            F.rib(ctx, f, sg * (hw + jw / 2), 0, body, jw, pj, col);
            F.rib(ctx, f, sg * (hw + jw / 2), plinthH * 0.7, body - 0.22, jw * 0.5, pj * 1.12, C.hi);
            F.box(ctx, f, sg * (hw + jw / 2), body - 0.1, jw * 1.2, 0.2, pj * 1.2, C.hi);
          }
          F.arch(ctx, f, 0, body, hw * 2, rise + jw * i * 0.8, jw * 0.5, pj, col, "pointed");
        }
        // a steep crocketed gable hood over the portal, dying into the cornice
        const gh = portW * 0.42, gw = portW + jw * 7;
        const gsteps = 6;
        for (let k = 0; k < gsteps; k++) {
          const u = (k + 0.5) / gsteps;
          const lw = gw * (1 - u);
          const gy = portH + rise * 0.10 + u * gh;
          F.box(ctx, f, 0, gy, lw + jw * 1.2, gh / gsteps + 0.04, PJb * 0.7, C.hi);
          if (k % 2 === 0 && lw > jw * 2) {
            for (const sg of [-1, 1])
              F.box(ctx, f, sg * (lw / 2 + jw * 0.5), gy + gh / gsteps * 0.5,
                jw * 0.7, jw * 0.55, PJb * 0.85, C.lo);
          }
        }
        F.rib(ctx, f, 0, portH + rise * 0.10 + gh, portH + rise * 0.10 + gh * 1.3,
          jw * 0.5, PJb * 0.85, C.hi);
      }

      // ============================================================
      //  6. THE TRANSITION BAND — where the shaft is allowed to stop
      // ============================================================
      {
        const y = shaftTop;
        const cs = stone(y);
        F.ring(ctx, y + transH * 0.10, transH * 0.16, PJp * 1.5, C.dark, 0.4);
        F.ring(ctx, y + transH * 0.30, transH * 0.20, PJp * 2.0, cs, 0.5);
        F.ring(ctx, y + transH * 0.52, transH * 0.14, PJp * 1.3, C.hi, 0.4);
        for (const p of plan) {
          const f = p.f;
          // canopied niches on ALTERNATE piers only. Every pier would double
          // the band's cost and read as a fringe rather than as figures.
          for (let i = 1; i < p.lines.length - 1; i += 2) {
            niche(ctx, F, f, p.lines[i], y - transH * 0.9, p.pw * 0.6, transH * 0.8, PJp * 1.4, C);
          }
          // GARGOYLES: waterspouts jutting from the band at every pier head.
          // Reach is tied to the spout's own thickness so a deep-piered tower
          // does not grow scaffolding.
          for (let i = 0; i < p.lines.length; i++) {
            const t = p.lines[i];
            const g1 = Math.min(PJp * 2.2, p.pw * 1.8);
            F.box(ctx, f, t, y + transH * 0.34, p.pw * 0.44, p.pw * 0.36, g1, C.dark, PJp * 0.4);
            F.box(ctx, f, t, y + transH * 0.42, p.pw * 0.24, p.pw * 0.22, g1 * 1.4, C.deep, PJp * 0.4);
          }
        }
      }

      // ============================================================
      //  7. THE CROWN — the silhouette, and where the geometry is spent
      // ============================================================
      // Above the transition band the mass steps IN twice, so the tower has a
      // profile instead of a lid. Sizes are fractions of the footprint, so the
      // crown is always a crown and never a second tower.
      const cw0 = W * 0.70, cd0 = D * 0.70;
      const tierH = clamp(FH * 1.5, 3, 8);
      const t1y = H;
      // tier 1
      ctx.dbox(0, t1y + tierH / 2, 0, cw0, tierH, cd0, stone(t1y));
      ctx.dbox(0, t1y + tierH + 0.25, 0, cw0 + 1.1, 0.5, cd0 + 1.1, C.hi);
      // tier 1 blind arcading, so the setback is not a bare drum
      {
        for (const s of [0, 1, 2, 3]) {
          const horiz = (s === 0 || s === 1), out = (s === 0 || s === 2) ? -1 : 1;
          const span = horiz ? cw0 : cd0, halfN = (horiz ? cd0 : cw0) / 2;
          const nn = Math.max(3, Math.round(span / 3.2));
          for (let i = 0; i < nn; i++) {
            const t = -span / 2 + (i + 0.5) * (span / nn);
            const aw = (span / nn) * 0.6;
            const x = horiz ? t : out * (halfN + 0.16);
            const z = horiz ? out * (halfN + 0.16) : t;
            // a pointed blind arch as four stepped courses
            for (let k = 0; k < 4; k++) {
              const u = (k + 0.5) / 4;
              const lw = Math.max(0.12, aw * (1 - u * 0.9));
              const yy = t1y + tierH * 0.42 + u * tierH * 0.42;
              ctx.dbox(x, yy, z, horiz ? lw : 0.32, tierH * 0.12, horiz ? 0.32 : lw, C.dark);
            }
            ctx.dbox(x, t1y + tierH * 0.24, z, horiz ? aw * 0.8 : 0.3,
              tierH * 0.34, horiz ? 0.3 : aw * 0.8, C.glass);
          }
        }
      }
      // tier 2
      const cw1 = cw0 * 0.62, cd1 = cd0 * 0.62;
      const t2y = t1y + tierH + 0.5;
      ctx.dbox(0, t2y + tierH * 0.85 / 2, 0, cw1, tierH * 0.85, cd1, stone(t2y));
      ctx.dbox(0, t2y + tierH * 0.85 + 0.2, 0, cw1 + 0.9, 0.4, cd1 + 0.9, C.hi);

      // --- CORNER TURRETS with crocketed pinnacles ---------------------
      const pinBase = clamp(unit * 0.075, 0.6, 2.1);
      const pinH = clamp(FH * 4.2, 7, H * 0.18);
      const turretTop = t2y + tierH * 1.5;
      const corners = [];
      // They stand on the BUILDING's corners, not the setback's, so the
      // stepped-in crown mass leaves a real gap for the flying buttresses to
      // span. Turrets buried in the setback are the thing that turns a crown
      // into a lid.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * (W / 2 - pinBase * 0.85), z = sz * (D / 2 - pinBase * 0.85);
        // the turret shaft the pinnacle stands on, rising past tier 2
        ctx.dbox(x, (t1y + turretTop) / 2, z, pinBase * 2.1, turretTop - t1y, pinBase * 2.1, stone(turretTop));
        ctx.dbox(x, turretTop + 0.22, z, pinBase * 2.6, 0.44, pinBase * 2.6, C.hi);
        pinnacle(ctx, x, z, turretTop + 0.44, pinBase, pinH, C);
        corners.push({ x: x, z: z });
      }
      // --- SECONDARY PINNACLES at the tier-1 edge midpoints -------------
      for (const o of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const x = o[0] * (cw0 / 2 - pinBase * 0.8), z = o[1] * (cd0 / 2 - pinBase * 0.8);
        ctx.dbox(x, t1y + tierH * 0.7, z, pinBase * 1.5, tierH * 1.4, pinBase * 1.5, stone(t1y));
        pinnacle(ctx, x, z, t1y + tierH * 1.4, pinBase * 0.66, pinH * 0.62, C);
      }

      // --- THE CENTRAL SPIRE --------------------------------------------
      // A stepped tourelle, an octagonal-ish belfry stage, then a long stepped
      // spire to a finial. This is the shape the skyline plate sees.
      const spBase = Math.min(cw1, cd1) * 0.66;
      let sy = t2y + tierH * 0.85 + 0.4;
      ctx.dbox(0, sy + tierH * 0.9, 0, spBase, tierH * 1.8, spBase, stone(sy));
      // belfry lights on all four sides of the tourelle
      for (const s of [0, 1, 2, 3]) {
        const horiz = (s === 0 || s === 1), out = (s === 0 || s === 2) ? -1 : 1;
        const x = horiz ? 0 : out * (spBase / 2 + 0.1), z = horiz ? out * (spBase / 2 + 0.1) : 0;
        // narrow paired lights, not a picture window: a wide dark rectangle at
        // this scale reads as a hole punched in the tourelle.
        for (const sg of [-1, 1]) {
          const off = spBase * 0.16 * sg;
          ctx.dbox(horiz ? off : x, sy + tierH * 0.85, horiz ? z : off,
            horiz ? spBase * 0.20 : 0.22, tierH * 0.95, horiz ? 0.22 : spBase * 0.20, C.glass);
        }
        for (let k = 0; k < 4; k++) {
          const u = (k + 0.5) / 4;
          const lw = Math.max(0.12, spBase * 0.5 * (1 - u * 0.92));
          ctx.dbox(x, sy + tierH * 1.55 + u * tierH * 0.4, z, horiz ? lw : 0.3,
            tierH * 0.11, horiz ? 0.3 : lw, C.hi);
        }
      }
      sy += tierH * 1.8;
      ctx.dbox(0, sy + 0.25, 0, spBase * 1.25, 0.5, spBase * 1.25, C.hi);
      sy += 0.5;
      // corner spirelets around the spire's foot
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        pinnacle(ctx, sx * spBase * 0.55, sz * spBase * 0.55, sy, pinBase * 0.5, pinH * 0.5, C);
      }
      // the spire proper: a long stepped taper, crocketed on the way up
      {
        const steps = 14, spH = clamp(FH * 10, 12, H * 0.30), ssh = spH / steps;
        let sw = spBase * 0.66;
        for (let i = 0; i < steps; i++) {
          ctx.dbox(0, sy + ssh / 2, 0, sw, ssh, sw, i % 2 ? C.hi : F.shade(C.hi, 0.86));
          if (i % 2 === 0) {
            for (const sg of [-1, 1]) {
              ctx.dbox(sg * sw * 0.6, sy + ssh * 0.72, 0, sw * 0.26, ssh * 0.42, sw * 0.26, C.lo);
              ctx.dbox(0, sy + ssh * 0.72, sg * sw * 0.6, sw * 0.26, ssh * 0.42, sw * 0.26, C.lo);
            }
          }
          sy += ssh; sw *= 0.88;
        }
        ctx.dbox(0, sy + spBase * 0.3, 0, spBase * 0.16, spBase * 0.6, spBase * 0.16, C.hi);
        ctx.dbox(0, sy + spBase * 0.75, 0, spBase * 0.32, spBase * 0.14, spBase * 0.32, C.hi);
        ctx.dbox(0, sy + spBase * 1.1, 0, spBase * 0.09, spBase * 0.6, spBase * 0.09, C.hi);
      }

      // --- FLYING BUTTRESSES: turret head to spire tourelle ---------------
      // A stepped quarter-arc of boxes, springing from each corner turret and
      // landing on the tourelle. Built from axis-aligned boxes: the arc is the
      // path, each box is a voussoir.
      {
        const ty = turretTop - pinBase * 0.6;
        const targetY = t2y + tierH * 1.35;
        const steps = 9;
        for (const c of corners) {
          const dx = -c.x * 0.80, dz = -c.z * 0.80;
          for (let i = 0; i < steps; i++) {
            const u = (i + 0.5) / steps;
            const x = c.x + dx * u, z = c.z + dz * u;
            // the rise follows a quarter sine, so the arc is convex upward
            const y = ty + (targetY - ty) * u + Math.sin(u * Math.PI) * tierH * 0.5;
            const th = clamp(pinBase * 0.52, 0.3, 1.2);
            ctx.dbox(x, y, z, th, th * (1.5 - u * 0.5), th, i % 2 ? C.hi : stone(y));
            // the pierced spandrel below the arc, hanging to the tier-1 roof
            if (i % 3 === 1) {
              const drop = Math.max(0.4, y - (t1y + tierH));
              ctx.dbox(x, y - drop / 2, z, th * 0.5, drop, th * 0.5, C.lo);
            }
          }
        }
      }
    },
  });

  // ------------------------------------------------------------------
  // A PINNACLE: plinth, shaft with corner colonnettes, capital, a stepped
  // crocketed spirelet, a finial. Local coordinates, all dbox.
  // ------------------------------------------------------------------
  function pinnacle(ctx, x, z, y, base, h, C) {
    ctx.dbox(x, y + base * 0.3, z, base * 1.6, base * 0.6, base * 1.6, C.lo);
    let sy = y + base * 0.6;
    const shaftH = h * 0.34;
    ctx.dbox(x, sy + shaftH / 2, z, base, shaftH, base, C.hi);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      ctx.dbox(x + sx * base * 0.48, sy + shaftH / 2, z + sz * base * 0.48,
        base * 0.3, shaftH, base * 0.3, C.lo);
    }
    sy += shaftH;
    ctx.dbox(x, sy + base * 0.12, z, base * 1.5, base * 0.24, base * 1.5, C.hi);
    sy += base * 0.24;
    const steps = 7, ssh = (h * 0.58) / steps;
    let sw = base * 1.12;
    for (let i = 0; i < steps; i++) {
      ctx.dbox(x, sy + ssh / 2, z, sw, ssh, sw, i % 2 ? C.lo : C.hi);
      if (i % 2 === 0) {
        for (const sg of [-1, 1]) {
          ctx.dbox(x + sg * sw * 0.62, sy + ssh * 0.74, z, sw * 0.32, ssh * 0.42, sw * 0.32, C.lo);
          ctx.dbox(x, sy + ssh * 0.74, z + sg * sw * 0.62, sw * 0.32, ssh * 0.42, sw * 0.32, C.lo);
        }
      }
      sy += ssh; sw *= 0.74;
    }
    ctx.dbox(x, sy + base * 0.26, z, base * 0.2, base * 0.52, base * 0.2, C.hi);
  }

  // ------------------------------------------------------------------
  // A CANOPIED NICHE: a dark recess, a figure block, a corbel underneath and
  // a stepped gabled canopy over it. Ten boxes, used at the two bands where a
  // player or a distant eye can actually resolve it.
  // ------------------------------------------------------------------
  function niche(ctx, F, f, t, y, wid, h, proj, C) {
    F.box(ctx, f, t, y + h / 2, wid, h, proj * 1.1, C.deep);         // the recess
    F.box(ctx, f, t, y + h * 0.42, wid * 0.4, h * 0.7, proj * 1.35, C.hi);  // the figure
    F.box(ctx, f, t, y - h * 0.06, wid * 1.25, h * 0.12, proj * 1.45, C.lo); // corbel
    for (let k = 0; k < 4; k++) {                                     // the canopy
      const u = (k + 0.5) / 4;
      F.box(ctx, f, t, y + h + u * h * 0.42, wid * (1.3 - u * 1.1), h * 0.11,
        proj * (1.5 - u * 0.4), C.hi);
    }
  }

  // ------------------------------------------------------------------
  // A PODIUM WINDOW: a tall two-storey traceried opening - glass, jambs, a
  // sill, a pointed head with a hood mould, a mullion and a transom band.
  // Only the podium gets this; the shaft's bays are deliberately plainer.
  // ------------------------------------------------------------------
  function podWindow(ctx, F, f, t, y0, wid, h, PJ, C, stoneCol, full) {
    if (h < 1.2 || wid < 0.4) return;
    const rise = Math.min(wid * 0.85, h * 0.32);
    const body = h - rise;
    const gp = PJ * 0.4, jp = PJ * 1.3;
    const jw = clamp(wid * 0.11, 0.12, 0.5);
    const mw = clamp(wid * 0.07, 0.08, 0.3);
    F.rib(ctx, f, t, y0, y0 + body, wid, gp, C.glass);
    for (let i = 0; i < 4; i++) {
      const u = (i + 0.5) / 4;
      F.box(ctx, f, t, y0 + body + u * rise, Math.max(0.1, wid * (1 - u)), rise / 4 + 0.02, gp, C.glass);
    }
    for (const sg of [-1, 1]) F.rib(ctx, f, t + sg * (wid / 2 + jw / 2), y0 - 0.06, y0 + body, jw, jp, C.hi);
    F.box(ctx, f, t, y0 - 0.16, wid + jw * 3, 0.18, jp * 1.25, C.hi);           // sill
    F.arch(ctx, f, t, y0 + body, wid, rise, jw * 0.5, jp, C.hi, "pointed");
    F.arch(ctx, f, t, y0 + body + 0.12, wid + jw * 1.4, rise * 1.02, jw * 0.6, jp * 1.35, stoneCol, "pointed");
    F.rib(ctx, f, t, y0, y0 + body + rise * 0.22, mw, jp * 0.95, C.hi);          // mullion
    F.box(ctx, f, t, y0 + body * 0.52, wid * 0.98, 0.14, jp * 0.95, C.hi);       // transom
    if (wid < 0.9 || !full) return;
    for (const sg of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        F.box(ctx, f, t + sg * wid * (0.06 + k * 0.07), y0 + body + rise * (0.22 + k * 0.09),
          mw, rise * 0.11, jp * 0.95, C.hi);
      }
    }
    const qy = y0 + body + rise * 0.66, qr = Math.max(0.07, wid * 0.13);
    for (const o of [[-1, 0], [1, 0], [0, -1], [0, 1]])
      F.box(ctx, f, t + o[0] * qr, qy + o[1] * qr, qr * 0.9, qr * 0.9, jp * 1.05, C.hi);
    F.box(ctx, f, t, qy, qr * 0.55, qr * 0.55, jp * 1.15, C.dark);
  }
})();
