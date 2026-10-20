/* ============================================================
   city/facades/gothic.js — "Gothic Revival": the pointed civic hall /
   collegiate front, 1840-1910 (Manchester Town Hall, Trinity Church, the
   college quad).

   REFERENCES:
     Victorian Web, "Early English Gothic" (lancets, buttress stages)
       https://victorianweb.org/art/architecture/gothic/earlyenglish.html
     Washington National Cathedral, "Gothic Architecture 101"
       https://cathedral.org/discover/art-architecture/gothic-architecture-101/
     RIBA, "Gothic movement"
       https://www.riba.org/explore/riba-collections/architectural-styles/gothic-movement/
     My Modern Met, "Gothic architecture characteristics"
       https://mymodernmet.com/gothic-architecture-characteristics/

   THE NUMBERS.
     bays        3.2-3.8 m, one buttress per bay line.
     buttresses  0.6 m wide, projecting 0.75 m at the plinth and stepping
                 back twice (0.75 -> 0.5 -> 0.3 m) at sloped weatherings;
                 a pinnacle 0.36 m square, ~1.6 m tall, over the parapet.
     lancets     1.0-1.2 m wide openings (the host glazes them with a stone
                 mullion pair, a transom and leaded quarries: the "lancet"
                 window), a POINTED HEAD over each rising ~0.75 x the width,
                 glazed (painted leaded glass) inside a stone arch ring, a
                 hood mould over it.
     string      a moulded string course at every floor line, 0.08 m proud;
                 a plinth 0.6 m tall, 0.15 m proud.
     portal      a pointed arch of three receding orders (0.18 / 0.3 / 0.42 m
                 proud), a dark tympanum, a steep gable hood with a finial.
     parapet     a crenellated or pierced parapet 0.8 m over the roof.
     rose        a wheel window on the entrance face's first upper storey
                 when the face is wide enough (>= 13 m).
     colour      grey-buff limestone 0xb5ab95 off the street colour; leaded
                 glass reads dark warm from outside, never blue.

   VARIATION BY SEED: crenellated or plain-coped parapet; buttress pinnacles
   with or without a gablet; rose window or a triple lancet group over the
   portal; how warm the stone is.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  // A POINTED HEAD in three courses: each a box narrower than the last,
  // the stepped profile of a lancet's two arcs meeting at a point. Cheaper
  // than F.arch (no imposts) and it is drawn twice per window.
  function point(ctx, F, f, t, y, W, rise, proj, col) {
    for (let i = 0; i < 3; i++) {
      const u = (i + 0.5) / 3;
      F.box(ctx, f, t, y + u * rise, Math.max(0.1, W * (1 - u * 0.82)), rise / 3 + 0.02, proj, col);
    }
  }

  CBZ.registerFacade("gothic", {
    label: "Gothic Revival",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — unreinforced masonry with buttresses.
    structure: "masonry",
    crownsRoof: true,
    window: "lancet",
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop;
      const grid = !!ctx.grid;
      const df = F.face(ctx, ctx.doorSide);

      // ---- palette ----------------------------------------------------
      const STONE = F.mix(ctx.color, F.mix(0xb5ab95, 0xa89a80, ctx.hash(0x60a2)), 0.6);
      const LIGHT = F.shade(STONE, 1.1);          // dressings
      const DARK = F.shade(STONE, 0.62);          // tympana, orders
      const PLINTH = F.shade(STONE, 0.78);
      const GLASS = F.glass(ctx, F.mix(0x1b1712, 0x33241a, 0.3 + ctx.hash(0x60a1) * 0.3));
      F.windowFrame(ctx, F.shade(STONE, 0.7));
      const crenel = ctx.hash(0x60a3) < 0.55;

      const SKIN = 0.06, BUTT = 0.75, BW = 0.6;
      const BAY = 3.0, WIN = ST >= 8 ? 1.3 : 1.1;
      const plinthH = 0.6;
      // the portal: three orders round the door, its arch over the door head
      const DW = (ctx.doorW || F.DOOR_W), DH = (ctx.doorH || F.DOOR_H);
      const portRise = Math.min(1.3, Math.max(0.5, H + 0.6 - DH - 0.6));

      const faces = F.faces(ctx);
      const plan = [];
      for (const f of faces) {
        const n = F.bayCount(f, BAY, 2, 18);
        const margin = Math.max(0.7, Math.min(1.1, f.span * 0.06));
        const bays = F.bays(f, n, margin);
        const lines = F.bayLines(f, n, margin);
        const step = bays.length ? bays[0].w : f.span;
        const ww = Math.min(WIN, step - BW - 0.5);
        const isDoor = f.s === ctx.doorSide;
        plan.push({ f: f, lines: lines });
        // the rose: centre bay of the entrance face, first upper storey
        // (only on an odd bay count: then a bay, not a buttress line, is central)
        const roseK = (isDoor && ST >= 2 && f.span >= 13 && n % 2 === 1) ? 1 : -1;

        // ---- the openings, storey by storey, and the skin round them ----
        const holes = [];
        for (let k = 0; k < ST; k++) {
          const S = F.storey(ctx, k, Math.min(1.0, FH * 0.3), FH - 0.46);
          for (const b of bays) {
            if (k === 0 && isDoor && Math.abs(b.t) < DW / 2 + 1.0 + ww / 2) continue;   // the portal's bay
            // the rose (or the portal's gable) owns the centre of storey 1
            if (isDoor && k === 1 && Math.abs(b.t) < step * 0.5) continue;
            if (ww < 0.6) continue;
            holes.push({ t0: b.t - ww / 2, t1: b.t + ww / 2, y0: S.sill, y1: S.head, k: k, t: b.t });
          }
        }
        F.cladAround(ctx, f, plinthH, H, holes, SKIN, STONE);

        // ---- each lancet's head, hood and sill ---------------------------
        // Pointed heads on the ground storey and the top storey (the hall and
        // the attic); the storeys between take a square label mould, the way
        // a collegiate or commercial gothic block heads its office floors.
        for (const h of holes) {
          const W = h.t1 - h.t0, rise = Math.min(W * 0.75, FH * 0.3);
          if (h.k === 0 || h.k === ST - 1) {
            point(ctx, F, f, h.t, h.y1, W + 0.24, rise + 0.1, SKIN + 0.05, LIGHT);     // the stone ring
            point(ctx, F, f, h.t, h.y1 - 0.02, W - 0.1, rise - 0.08, SKIN + 0.07, GLASS);   // the glazed point
            F.box(ctx, f, h.t, h.y1 + rise + 0.14, 0.22, 0.12, SKIN + 0.1, LIGHT);   // the hood apex
          } else {
            F.box(ctx, f, h.t, h.y1 + 0.08, W + 0.36, 0.16, SKIN + 0.08, LIGHT);     // the label
            for (const sg of [-1, 1]) F.box(ctx, f, h.t + sg * (W / 2 + 0.12), h.y1 - 0.12, 0.12, 0.3, SKIN + 0.08, LIGHT);
          }
          F.box(ctx, f, h.t, h.y0 - 0.06, W + 0.24, 0.12, SKIN + 0.09, LIGHT);                         // sill
        }

        // ---- string courses at the floor lines ---------------------------
        for (let k = 1; k < ST; k++) F.band(ctx, f, k * FH + 0.12, 0.14, SKIN + 0.08, LIGHT, 0.2);

        // ---- buttresses: on every bay line, two set-offs --------------
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i];
          if (isDoor && !F.clearsDoor(ctx, f, t, BW + 2.6)) continue;
          const end = i === 0 || i === lines.length - 1;
          const tt = end ? t + (i === 0 ? -1 : 1) * (BW * 0.2) : t;
          const s1 = H * 0.42, s2 = H * 0.78;
          F.rib(ctx, f, tt, 0, s1, BW, BUTT, STONE);
          F.rib(ctx, f, tt, s1, s2, BW, BUTT * 0.66, STONE);
          F.rib(ctx, f, tt, s2, H + 0.5, BW * 0.9, BUTT * 0.4, STONE);
          // the weathering at each set-off: a sloped run of two courses
          for (const [y, p0, p1] of [[s1, BUTT, BUTT * 0.66], [s2, BUTT * 0.66, BUTT * 0.4]]) {
            F.box(ctx, f, tt, y + 0.08, BW + 0.06, 0.16, p0, LIGHT);
            F.box(ctx, f, tt, y + 0.22, BW + 0.02, 0.14, (p0 + p1) / 2, LIGHT);
          }
          // the pinnacle on the buttress head
          if (!grid) {
            const py = H + 0.5;
            F.box(ctx, f, tt, py + 0.55, 0.38, 1.1, BUTT * 0.32, STONE, BUTT * 0.04);
            for (let s = 0; s < 3; s++) F.box(ctx, f, tt, py + 1.15 + s * 0.22, 0.3 - s * 0.08, 0.24, Math.max(0.06, BUTT * 0.26 - s * 0.06), LIGHT, BUTT * 0.07 + s * 0.03);
          }
        }

        // ---- the rose window -------------------------------------------
        if (roseK > 0) {
          const S = F.storey(ctx, roseK);
          const R = Math.min(1.5, (S.head - S.sill) * 0.55 + 0.2, step * 0.45);
          const cy = (S.sill + S.head) / 2 + 0.1;
          // the wheel: five courses of a circle, stone ring behind, glass in front
          for (let i = 0; i < 5; i++) {
            const u = (i - 2) / 2.5;
            const hw = Math.sqrt(Math.max(0, 1 - u * u));
            F.box(ctx, f, 0, cy + u * R, (R + 0.14) * 2 * hw + 0.2, R * 0.42, SKIN + 0.05, LIGHT);
            F.box(ctx, f, 0, cy + u * R, R * 2 * hw, R * 0.4, SKIN + 0.07, GLASS);
          }
          // spokes and hub
          F.box(ctx, f, 0, cy, R * 1.9, 0.08, SKIN + 0.1, LIGHT);
          F.box(ctx, f, 0, cy, 0.08, R * 1.9, SKIN + 0.1, LIGHT);
          F.box(ctx, f, 0, cy, 0.34, 0.34, SKIN + 0.12, LIGHT);
        }
      }

      // ---- the plinth ----------------------------------------------------
      F.ring(ctx, plinthH / 2, plinthH, SKIN + 0.12, PLINTH, 0.2);
      F.ring(ctx, plinthH + 0.06, 0.12, SKIN + 0.16, LIGHT, 0.24);

      // ============================================================
      //  THE PORTAL: three receding pointed orders and a gable hood
      // ============================================================
      {
        const f = df, spring = DH + 0.1;
        for (let i = 0; i < 3; i++) {
          const hw = DW / 2 + 0.16 + i * 0.26;
          const pj = 0.18 + i * 0.12;
          const col = i === 1 ? DARK : (i === 0 ? STONE : LIGHT);
          for (const sg of [-1, 1]) F.rib(ctx, f, sg * (hw + 0.13), 0, spring, 0.26, pj, col);
          point(ctx, F, f, 0, spring, hw * 2 + 0.52, portRise + i * 0.18, pj, col);
        }
        // the tympanum: dark stone filling the arch over the door head
        point(ctx, F, f, 0, spring, DW + 0.32, portRise - 0.1, 0.12, DARK);
        // the gable hood over the orders, with a finial
        const gw = DW + 1.3, gy = spring + portRise * 0.55, gh = portRise + 0.3;
        for (let s = 0; s < 4; s++) {
          const u = (s + 0.5) / 4;
          F.box(ctx, f, 0, gy + u * gh, gw * (1 - u * 0.85), gh / 4 + 0.02, 0.52, LIGHT);
        }
        F.box(ctx, f, 0, gy + gh + 0.25, 0.2, 0.5, 0.56, LIGHT);
      }

      // ============================================================
      //  THE PARAPET: crenellated or plain, coped
      // ============================================================
      F.parapet(ctx, 0.75, 0.3, STONE, LIGHT);
      if (crenel) for (const f of faces) F.merlons(ctx, f, H + 1.0, Math.max(4, Math.round(f.span / 1.2)), 0.6, 0.45, 0.3, STONE);
    },
  });
})();
