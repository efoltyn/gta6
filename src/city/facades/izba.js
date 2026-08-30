/* ============================================================
   city/facades/izba.js — "Russian Izba": the northern log house, Kizhi to
   the Volga, and the domestic half of the timber road this era is built on.

   THE ONE THING A PLAYER RECOGNISES, and it is not the roof: HORIZONTAL LOG
   COURSES WHOSE ENDS RUN PAST THE CORNER. Every course, every corner, the
   round ends stick out beyond the wall face, and the two directions ALTERNATE
   which one runs long — that alternation IS the interlocked notch, and it is
   the whole reason a log house looks woven rather than clad. Section B spends
   most of this file's budget on it and nothing else in the kit does it.
   Against stave.js, whose planks are VERTICAL, this is the one-glance
   difference; get it wrong and the two are the same brown box.

   THE REST, in the order it is built:

     PODKLET   the storage undercroft. The living floor sits over it, so the
               bottom courses are darker, heavier and stand out further, and
               the porch climbs to a deck rather than starting at the dirt.
     ROOF      one steep gable with the RIDGE PERPENDICULAR to the door face,
               so the street sees the gable end — which is where all the
               carving is. F.gableRoof's default pitch is clamped to 0.60 of
               the wall height, which is a suburban roof; the rise is passed
               in explicitly for this reason.
     PRICHELINY the carved bargeboards down both rakes of that gable, with a
               scalloped lower edge and the polotentse pendant hung at the
               apex. This is the ornament the building is famous for.
     NALICHNIKI the carved window surrounds. They stand PROUD OF THE LOGS —
               side boards, a stepped head, a pendant apron — which is the
               point of them: a flush window on a log wall is a hole, and an
               izba's windows are framed pictures.
     KRYLTSO   the covered porch and its steps. `ownDoor` is declared, so the
               kit's automatic surround is skipped and section F draws the
               plank jambs and the carved head board itself.

   WALL MODE "own": a log wall has no glazing band. The shell hands over solid
   wall and the nalichniki in E are the only openings, placed exactly where
   the bays put them.

   SOLIDITY: the ground log courses are the mass a player runs into and go
   through the solid emitter (which auto-refuses the courses above head
   height, so the whole wall does not become 200 colliders). The porch posts
   and step cheeks come out of moves that already emit solid. Bargeboards,
   nalichniki and shingles stay free.

   MESHES: zero.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  const cl = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  CBZ.registerFacade("izba", {
    label: "Russian Izba",
    era: "silkroad",
    // city/collapse.js MATERIALS — stacked round logs, corner-notched, no
    // frame and no fixings. It racks and rolls apart; it does not pancake.
    structure: "timber",
    wall: "own",
    ownDoor: true,
    // Three storeys of stacked logs is a bell tower, not a house.
    maxStoreys: 2,
    build: function (ctx, F) {
      const FH = ctx.FH, rTop = ctx.rTop, u = Math.min(ctx.w, ctx.d);
      const hw = ctx.w / 2, hd = ctx.d / 2, e = F.entrance(ctx);
      const S = ctx.sbox || ctx.dbox;
      const P = F.palette(ctx, "timber", { pull: 0.90, grain: 0.34 });
      // The carving is PAINTED and the logs are not — that contrast is what
      // makes the nalichniki read at 30 m. Which paint is a position hash.
      const carve = F.mix(P.light, 0xf3f0e6, 0.62);
      const carveD = ctx.hash(0x1b21) < 0.5 ? F.mix(0x3f6d86, carve, 0.30) : F.mix(0x8e3a2e, carve, 0.30);
      const sh = F.mix(P.roof, 0x2a2620, 0.35);

      // ---- A. THE PODKLET LINE ------------------------------------
      const pk = cl(FH * 0.30, 0.68, 1.25);          // top of the undercroft

      // ---- B. THE LOG COURSES -------------------------------------
      const ch = cl(FH * 0.115, 0.26, 0.42);         // one log's diameter
      const lug = cl(u * 0.048, 0.36, 0.80);         // how far the ends run past
      const N = Math.ceil(rTop / ch);
      for (let k = 0; k < N; k++) {
        const cy = k * ch + ch / 2;
        if (cy > rTop - 0.05) break;
        const j = 0.90 + ctx.hash(0x1b00 + k) * 0.16;         // hewn, not milled
        const t = ch * j, low = cy < pk;
        const c = low ? F.shade(P.course(k), 0.56) : P.course(k);
        const cL = F.shade(c, 1.18), cD = F.shade(c, 0.62);
        const p = cl(ch * (low ? 1.20 : 0.98), 0.32, 0.52);   // proud of the wall
        // SOLID only where a body can meet it. sbox refuses the rest anyway,
        // and asking it 200 times for boxes 6 m up is 200 wasted scans.
        const E = cy < 2.7 ? S : ctx.dbox;
        // MEASURED PAST THE PERPENDICULAR LOG, not past the wall. A course
        // that only reaches the wall plane has its end buried inside the log
        // it is notched into and the corner comes out mitred — which is the
        // one thing a log house never looks like.
        const ox = (k % 2) ? p + lug : -p * 0.15, oz = (k % 2) ? -p * 0.15 : p + lug;
        for (const sg of [-1, 1]) {
          E(0, cy, sg * (hd + p / 2), ctx.w + ox * 2, t, p, c);
          E(sg * (hw + p / 2), cy, 0, p, t, ctx.d + oz * 2, c);
          // the lit belly of a round log, and the dark chink under it
          ctx.dbox(0, cy + t * 0.20, sg * (hd + p * 0.74), ctx.w + ox * 2 - 0.06, t * 0.26, p * 0.58, cL);
          ctx.dbox(sg * (hw + p * 0.74), cy + t * 0.20, 0, p * 0.58, t * 0.26, ctx.d + oz * 2 - 0.06, cL);
          ctx.dbox(0, cy - t * 0.46, sg * (hd + p * 0.58), ctx.w + ox * 2 + 0.02, 0.07, p * 0.74, cD);
          ctx.dbox(sg * (hw + p * 0.58), cy - t * 0.46, 0, p * 0.74, 0.07, ctx.d + oz * 2 + 0.02, cD);
        }
      }
      const wp = cl(ch * 1.20, 0.32, 0.52) + lug + 0.16;   // everything stands off this
      // THE OKLADNOY VENETS: the heavy sill beam the living floor lands on,
      // and the line that says the dark courses below it are a cellar.
      F.ring(ctx, pk + 0.10, 0.26, cl(ch * 1.30, 0.40, 0.62), F.shade(P.base, 0.80), 0.5, 0);

      // ---- C. THE ROOF --------------------------------------------
      // Ridge PERPENDICULAR to the door face, so the street gets the gable.
      const zAxis = F.face(ctx, ctx.doorSide).horiz;
      const rov = cl(u * 0.075, 0.50, 1.30);
      const hT = (zAxis ? ctx.w : ctx.d) / 2 + rov;
      const roof = F.gableRoof(ctx, { pal: P, col: sh, axis: zAxis ? "z" : "x",
        over: rov, courses: 15, verge: false, rise: cl(hT * 0.98, FH * 0.90, u * 1.30) });

      // ---- D. THE PRICHELINY --------------------------------------
      // Carved boards down both rakes of the gable with a scalloped edge, and
      // the polotentse hung at the apex. Emitted in world coordinates rather
      // than through F.box because the gable plane stands `over` past the
      // wall the face helpers measure from.
      const gN = 15, gp = (zAxis ? hd : hw) + roof.over;
      const gb = roof.halfT0 / gN + 0.34;                    // covers its own step
      for (const sg of [-1, 1]) {
        for (let i = 0; i < gN; i++) {
          const v = (i + 0.5) / gN, ht = roof.halfT0 * (1 - v) - gb * 0.34;
          const y = roof.y0 + roof.h * v;
          for (const sq of [-1, 1]) {
            const bx = zAxis ? sq * ht : sg * gp, bz = zAxis ? sg * gp : sq * ht;
            ctx.dbox(bx, y, bz, zAxis ? gb : 0.36, roof.h / gN + 0.07, zAxis ? 0.36 : gb, carve);
            ctx.dbox(bx, y - 0.30, bz, zAxis ? gb * 0.72 : 0.30, 0.34, zAxis ? 0.30 : gb * 0.72,
              i % 2 ? carveD : carve);                       // the scallop
          }
        }
        for (let i = 0; i < 3; i++)                          // the polotentse
          ctx.dbox(zAxis ? 0 : sg * gp, roof.ridge - 0.30 - i * 0.34, zAxis ? sg * gp : 0,
            zAxis ? 0.46 - i * 0.10 : 0.34, 0.32, zAxis ? 0.34 : 0.46 - i * 0.10,
            i === 1 ? carveD : carve);
      }

      // ---- E. THE NALICHNIKI --------------------------------------
      for (const f of F.faces(ctx)) {
        const n = F.bayCount(f, cl(u * 0.32, 2.1, 3.6), 2, 5);
        for (const b of F.bays(f, n, cl(f.span * 0.14, 0.9, 2.4))) {
          for (let k = 0; k < ctx.storeys; k++) {
            const wh = cl(FH * 0.30, 0.70, 1.20), ww = cl(b.w * 0.36, 0.60, 1.15);
            const sy = k * FH + Math.max(pk + 0.25, FH * 0.40);
            if (sy + wh > rTop - 0.2 || !F.clearsDoor(ctx, f, b.t, ww + 2.4)) continue;
            F.box(ctx, f, b.t, sy + wh / 2, ww, wh, wp - 0.12, P.glass, 0.02);
            for (const sg of [-1, 1]) {                      // the glazing bar and the side boards
              F.box(ctx, f, b.t + sg * ww * 0.02, sy + wh / 2, 0.07, wh - 0.06, wp - 0.06, carve, 0.02);
              F.rib(ctx, f, b.t + sg * (ww / 2 + 0.17), sy - 0.16, sy + wh + 0.16, 0.34, wp, carve);
            }
            F.box(ctx, f, b.t, sy + wh + 0.28, ww + 0.98, 0.32, wp + 0.05, carve);
            for (let q = 0; q < 3; q++)                      // the stepped carved head
              F.box(ctx, f, b.t, sy + wh + 0.50 + q * 0.20, (ww + 0.86) * (1 - q * 0.26), 0.20,
                wp + 0.05, q === 1 ? carveD : carve);
            F.box(ctx, f, b.t, sy - 0.28, ww + 0.82, 0.26, wp + 0.08, carve);   // the apron
          }
        }
      }

      // ---- F. THE KRYLTSO, AND THIS BUILDING'S OWN DOOR -----------
      F.porch(ctx, { pal: P, roof: "gable", col: carve, trimCol: carveD, roofCol: sh,
        depth: cl(u * 0.17, 1.15, 2.40), deckTop: Math.min(pk, F.STEP_RISE), posts: 2,
        width: cl(e.gap + u * 0.24, 3.0, 5.6), eave: cl(FH * 1.05, e.head + 0.4, rTop - 0.4) });
      // ownDoor is declared, so nothing else will draw a surround: heavy
      // plank jambs and a carved head board, standing proud of the logs.
      for (const sg of [-1, 1])
        F.rib(ctx, e.f, sg * (F.DOOR_W / 2 + 0.22), 0, F.DOOR_H + 0.18, 0.36, wp, carve);
      F.box(ctx, e.f, 0, F.DOOR_H + 0.34, F.DOOR_W + 1.10, 0.34, wp, carve);
      F.box(ctx, e.f, 0, F.DOOR_H + 0.62, F.DOOR_W + 0.70, 0.24, wp + 0.06, carveD);
    },
  });
})();
