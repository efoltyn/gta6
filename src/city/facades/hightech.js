/* ============================================================
   city/facades/hightech.js — "Exostructure": the inside-out building
   (Lloyd's of London, Centre Pompidou, HSBC Hong Kong; 1977-1986).

   REFERENCES
     Lloyd's building (Richard Rogers, 1986):
       https://historicengland.org.uk/listing/the-list/list-entry/1405493
       https://www.architecturelab.net/lloyds-of-london-building-richard-rogers/
       https://www.ice.org.uk/what-is-civil-engineering/infrastructure-projects/lloyds-building
     High-tech as a style: https://en.wikipedia.org/wiki/High-tech_architecture

   WHAT MAKES IT HIGH-TECH (and the numbers used)
     * SERVED AND SERVANT SPACES. The floors are clear; everything that a
       normal tower buries in its core — stairs, lifts, toilets, risers,
       ducts — is bolted to the OUTSIDE in its own towers. Lloyd's has six
       satellite towers of stainless-clad prefabricated toilet pods, one per
       floor, stacked on a frame. Here: one SERVICE TOWER on a flank (pods
       ~2.6 m wide, a storey high, 1.2 m deep, a seam at every floor), a
       GLAZED LIFT shaft beside it with a car parked at some floor, a bundle
       of square DUCTS with collars every second floor that turns onto the
       roof, and an external STAIR CAGE on a second flank. Depth off the
       wall is held to 1.5 m so the shell keeps its lot.
     * THE FRAME OUTSIDE THE GLASS. Exposed columns on a 5.4 m grid
       (Lloyd's 10.8 m, halved for a city lot), 0.4 m square, standing 0.3 m
       clear of the glass, tied back by a bracket at every floor and joined
       by a ring beam in front of each slab edge.
     * BRACING in one bay per face, a two-storey X every fourth storey.
     * The skin: structural glazing on a 1.8 m module with a transom at
       door-head height ("steel" window, facade_openings.js), a 1.0 m opaque
       panel at every floor line.
     * The roof is plant as architecture: a gantry, and a blue maintenance
       crane on the service tower (Lloyd's still has them).

   PALETTES (ctx.hash): Lloyd's stainless + concrete columns + blue cranes;
   Pompidou colour-coding (blue air, green water, yellow power, red lifts)
   on a white frame; HSBC grey steel with a red accent.

   Everything is ctx.dbox (merged). Diagonals are short stepped blocks.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  const PALETTES = [
    // Lloyd's: stainless pods and panels, concrete columns, blue crane
    { frame: 0xb3aea4, panel: 0xaeb5b9, pod: 0xc4cacd, duct: 0xbac0c4, lift: 0x9aa1a6, car: 0xd8dcdf, stair: 0xa5acb0, crane: 0x2f63a8, win: 0x9aa1a6 },
    // Pompidou: white frame, colour-coded services
    { frame: 0xe2e5e8, panel: 0xc9ced2, pod: 0xdfe3e6, duct: 0x2f6fd0, lift: 0xc8392b, car: 0xc8392b, stair: 0xe0b81e, crane: 0x3f8f4a, win: 0x2c3034 },
    // HSBC: grey steel, red accent
    { frame: 0x6c747a, panel: 0x8e969b, pod: 0x9aa2a7, duct: 0x7d858a, lift: 0x5d656a, car: 0xa8322a, stair: 0xa8322a, crane: 0xe0b81e, win: 0x6c7378 },
  ];

  CBZ.registerFacade("hightech", {
    label: "Exostructure",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — the structure is on the OUTSIDE and it is steel.
    structure: "steel",
    crownsRoof: true,
    window: "steel",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const PAL = PALETTES[Math.min(PALETTES.length - 1, (ctx.hash(0x7e01) * PALETTES.length) | 0)];
      const tint = function (c) { return F.mix(c, ctx.color, 0.05); };
      const FRAME = tint(PAL.frame), PANEL = tint(PAL.panel), POD = tint(PAL.pod), DUCT = PAL.duct;
      const LIFT = PAL.lift, CAR = PAL.car, STAIR = PAL.stair, CRANE = PAL.crane;
      const DARK = F.shade(PANEL, 0.42);
      F.windowFrame(ctx, PAL.win);
      const faces = F.faces(ctx);

      // ---- the frame ------------------------------------------------------
      const COLW = 0.4, COL_IN = 0.3;             // standoff: air between glass and steel
      const COLBAY = 5.4;
      const SP_DN = 0.45, SP_UP = 0.55;
      function colLines(f) {
        const a = -f.span / 2 + 0.55, b = f.span / 2 - 0.55;
        const n = Math.max(1, Math.round((b - a) / COLBAY));
        const out = [];
        for (let i = 0; i <= n; i++) out.push(a + (b - a) * i / n);
        return out;
      }

      // the services claim one flank (end bay); the stair a second flank
      const flanks = F.flanks(ctx);
      const svc = flanks[Math.min(flanks.length - 1, (ctx.hash(0x7e02) * flanks.length) | 0)];
      const others = flanks.filter((f) => f !== svc);
      const stairF = ST >= 3 && others.length ? others[Math.min(others.length - 1, (ctx.hash(0x7e03) * others.length) | 0)] : null;
      const side = ctx.hash(0x7e04) < 0.5 ? -1 : 1;
      const SW = Math.min(3.0, Math.max(2.0, svc.span * 0.2));        // pod tower width
      const LW = Math.min(2.1, Math.max(1.6, svc.span * 0.14));       // lift shaft width
      const tSvc = side * (svc.span / 2 - 0.5 - SW / 2);
      const tLift = tSvc - side * (SW / 2 + 0.25 + LW / 2);
      const tDuct = tLift - side * (LW / 2 + 0.6);
      const DEP = 1.45;                                                // max depth off the wall
      // tangent bands on each face the bolt-ons occupy (no frame through them)
      const busy = function (f, t, w) {
        if (f === svc) return Math.abs(t - tSvc) < SW / 2 + w / 2 + 0.2 || Math.abs(t - tLift) < LW / 2 + w / 2 + 0.2 || Math.abs(t - tDuct) < 0.75 + w / 2;
        if (f === stairF) return Math.abs(t - stairT) < stairW / 2 + w / 2 + 0.2;
        return false;
      };
      const stairW = stairF ? Math.min(3.2, Math.max(2.2, stairF.span * 0.2)) : 0;
      const stairT = stairF ? -side * (stairF.span / 2 - 0.5 - stairW / 2) : 0;

      // ================================================================
      //  1. BASE + FLOOR LINES
      // ================================================================
      for (const f of faces) {
        F.windowStyle(ctx, f.s, 0, "lobby");
        F.band(ctx, f, 0.25, 0.5, 0.06, F.shade(FRAME, 0.7), 0.12);         // steel plinth
        for (let k = 1; k <= ST; k++) {
          const y0 = k * FH - SP_DN, y1 = Math.min(k * FH + SP_UP, H);
          F.band(ctx, f, (y0 + y1) / 2, y1 - y0, 0.07, PANEL, 0.07);        // the slab-edge panel
          // the ring beam in front of the slab, carried by the columns
          F.box(ctx, f, 0, k * FH + 0.08, f.span + 0.2, 0.32, 0.30, FRAME, COL_IN);
        }
      }

      // ================================================================
      //  2. THE EXPOSED FRAME — columns, brackets, a braced bay
      // ================================================================
      for (const f of faces) {
        const L = colLines(f);
        for (let i = 0; i < L.length; i++) {
          const t = L[i];
          if (busy(f, t, COLW)) continue;
          const y0 = F.clearsDoor(ctx, f, t, COLW + 0.6) ? 0 : 3.4;
          F.rib(ctx, f, t, y0, H + 0.4, COLW, COLW, FRAME, COL_IN);
          // a bracket back to the slab at every floor
          for (let k = 1; k <= ST; k++) F.box(ctx, f, t, k * FH + 0.08, 0.24, 0.3, COL_IN + 0.02, F.shade(FRAME, 0.82));
          // the column shoe
          if (y0 === 0) F.box(ctx, f, t, 0.3, COLW + 0.2, 0.6, COLW + 0.1, F.shade(FRAME, 0.7), COL_IN - 0.05);
        }
        // ONE braced bay per face: a two-storey X every fourth storey
        if (L.length >= 2 && ST >= 2) {
          const bi = f.s % 2 ? 0 : L.length - 2;
          const ta = L[bi] + COLW / 2, tb = L[bi + 1] - COLW / 2;
          if (!busy(f, (ta + tb) / 2, tb - ta) && tb - ta > 1.5) {
            for (let k = 1; k + 2 <= ST; k += 4) {
              const ya = k * FH + 0.25, yb = (k + 2) * FH - 0.1;
              for (const dir of [1, -1]) {
                const n = Math.max(4, Math.round(Math.hypot(tb - ta, yb - ya) / 0.6));
                for (let s = 0; s < n; s++) {
                  const u = (s + 0.5) / n;
                  const t = dir > 0 ? ta + (tb - ta) * u : tb - (tb - ta) * u;
                  F.box(ctx, f, t, ya + (yb - ya) * u, (tb - ta) / n + 0.05, (yb - ya) / n + 0.1, 0.16, F.shade(FRAME, 1.06), COL_IN + 0.08);
                }
              }
            }
          }
        }
      }

      // ================================================================
      //  3. THE SERVICE TOWER — stacked stainless pods on their own frame
      // ================================================================
      {
        const f = svc, top = H + FH * 0.9;
        for (const sg of [-1, 1]) for (const dp of [0.1, DEP - 0.2]) {
          F.box(ctx, f, tSvc + sg * (SW / 2 - 0.1), top / 2, 0.2, top, 0.2, FRAME, dp - 0.1 + 0.05);
        }
        for (let k = 0; k < ST + 1; k++) {
          const y0 = k * FH + 0.15, y1 = Math.min((k + 1) * FH - 0.1, top - 0.1);
          if (y1 - y0 < 0.5) continue;
          F.box(ctx, f, tSvc, (y0 + y1) / 2, SW - 0.4, y1 - y0, 1.12, POD, 0.15);
          F.box(ctx, f, tSvc, y1 - 0.45, SW * 0.5, 0.22, 0.03, DARK, 1.27);          // the pod's vent slot
          F.box(ctx, f, tSvc, k * FH + 0.05, SW - 0.2, 0.18, DEP - 0.15, F.shade(FRAME, 0.85), 0.05);   // floor yoke
        }
        F.box(ctx, f, tSvc, top + 0.12, SW + 0.1, 0.24, DEP, F.shade(FRAME, 0.8), 0);
        // ---- the crane on top of it (Lloyd's blue gantry cranes) ----
        if (ST >= 4) {
          const mh = Math.min(5, FH * 1.4);
          F.box(ctx, f, tSvc, top + 0.24 + mh / 2, 0.32, mh, 0.32, CRANE, DEP * 0.5 - 0.16);
          const jib = Math.min(6, f.span * 0.3);
          F.box(ctx, f, tSvc - side * jib / 2, top + 0.24 + mh - 0.2, jib, 0.3, 0.3, CRANE, DEP * 0.5 - 0.15);
          F.box(ctx, f, tSvc + side * 0.8, top + 0.24 + mh - 0.35, 1.2, 0.6, 0.5, F.shade(CRANE, 0.7), DEP * 0.5 - 0.25);
        }
      }

      // ================================================================
      //  4. THE GLAZED LIFT — an open steel shaft with a car in it
      // ================================================================
      {
        const f = svc, top = H + FH * 0.6, D = 1.25;
        F.rib(ctx, f, tLift, 0, top, LW, 0.04, DARK);                         // the shaft's back plate
        for (const sg of [-1, 1]) F.rib(ctx, f, tLift + sg * (LW / 2 - 0.07), 0, top, 0.14, 0.14, LIFT, D - 0.14);
        for (let k = 1; k <= ST; k++) {
          F.box(ctx, f, tLift, k * FH + 0.05, LW, 0.12, 0.08, LIFT, D - 0.08);      // the front ring
          for (const sg of [-1, 1]) F.box(ctx, f, tLift + sg * (LW / 2 - 0.04), k * FH + 0.05, 0.08, 0.12, D - 0.1, LIFT, 0.04);
        }
        F.box(ctx, f, tLift, top + 0.4, LW + 0.2, 0.8, D + 0.1, LIFT, 0);          // the winding house
        const kc = Math.min(ST - 1, Math.max(0, (ctx.hash(0x7e05) * ST) | 0));
        F.box(ctx, f, tLift, kc * FH + 1.35, LW - 0.4, 2.5, D - 0.4, CAR, 0.18);
      }

      // ================================================================
      //  5. DUCTS — a bundle of three, collared, turning onto the roof
      // ================================================================
      {
        const f = svc;
        for (let i = 0; i < 3; i++) {
          const t = tDuct - side * i * 0.5, dp = 0.12 + (i % 2) * 0.35;
          const wd = i === 1 ? 0.5 : 0.38;
          F.rib(ctx, f, t, 0.6, H + 0.9 + i * 0.3, wd, wd, DUCT, dp);
          for (let k = 2; k <= ST; k += 2) F.box(ctx, f, t, k * FH - 0.3, wd + 0.1, 0.16, wd + 0.1, F.shade(DUCT, 0.82), dp - 0.05);
          // the elbow over the parapet and back along the roof
          F.box(ctx, f, t, H + 0.9 + i * 0.3, wd, wd, dp + wd + 2.0, DUCT, -2.0);
        }
      }

      // ================================================================
      //  6. THE STAIR CAGE — landings, flights, a mesh frame
      // ================================================================
      if (stairF) {
        const f = stairF, D = 1.3, top = H + 1.2;
        for (const sg of [-1, 1]) for (const dp of [0.05, D - 0.16]) F.box(ctx, f, stairT + sg * (stairW / 2 - 0.08), top / 2, 0.16, top, 0.16, STAIR, dp);
        F.rib(ctx, f, stairT, 0, top, stairW, 0.04, DARK);
        for (let k = 1; k <= ST; k++) {
          F.box(ctx, f, stairT, k * FH, stairW, 0.14, D, STAIR, 0);                 // landing
          F.box(ctx, f, stairT, k * FH + 1.0, stairW, 0.06, 0.06, STAIR, D - 0.06); // guard rail
          // the flight up from the landing below: six stepped treads across
          const n = 6;
          for (let s = 0; s < n; s++) {
            const u = (s + 0.5) / n, dir = k % 2 ? 1 : -1;
            F.box(ctx, f, stairT + dir * (u - 0.5) * (stairW - 0.4), (k - 1) * FH + FH * u, (stairW - 0.4) / n + 0.04, 0.12, D * 0.5, F.shade(STAIR, 0.85), D * 0.45);
          }
        }
        F.box(ctx, f, stairT, top + 0.1, stairW + 0.1, 0.2, D + 0.05, STAIR, 0);
      }

      // ================================================================
      //  7. ROOF PLANT — a framed gantry, off the deck centre
      // ================================================================
      if (ST >= 2) {
        const R = F.roof(ctx);
        const gw = Math.min(R.w * 0.36, 7), gd = Math.min(R.d * 0.3, 5), gh = Math.min(3.0, FH);
        const gx = R.cx + (R.w / 2 - gw / 2 - 0.8) * (ctx.hash(0x7e06) < 0.5 ? -1 : 1);
        const gz = R.cz + (R.d / 2 - gd / 2 - 0.8) * (ctx.hash(0x7e07) < 0.5 ? -1 : 1);
        ctx.dbox(gx, R.y + gh * 0.4, gz, gw - 0.6, gh * 0.8, gd - 0.6, F.shade(PANEL, 0.8));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) ctx.dbox(gx + sx * gw / 2, R.y + gh / 2, gz + sz * gd / 2, 0.22, gh, 0.22, FRAME);
        for (const sz of [-1, 1]) ctx.dbox(gx, R.y + gh, gz + sz * gd / 2, gw + 0.22, 0.24, 0.22, FRAME);
        ctx.dbox(gx, R.y + gh, gz, 0.22, 0.24, gd, FRAME);
      }
    },
  });
})();
