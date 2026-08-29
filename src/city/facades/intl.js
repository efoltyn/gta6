/* ============================================================
   city/facades/intl.js — "Seagram Curtain Wall", 1958.

   THE READ. This is the hardest grammar in the tower set because it has no
   ornament to hide behind. An International Style tower is beautiful for
   exactly three reasons, and if any one of them is missing it collapses into
   the glass box every bad city is made of:

     1. AN ABSOLUTELY REGULAR GRID, MEASURED IN METRES. The mullion pitch is a
        constant (about 1.5 m), so the number of bays is decided by the
        BUILDING, not the bay width by the building. A 26 m face and a 38 m
        face get the same rhythm at different counts, which is why the same
        drawing survives at 14 storeys and at 52.
     2. THE MULLION IS A REAL OBJECT. Mies bolted non-structural bronze
        I-beams to the outside of a fireproofed frame — the famous, slightly
        absurd detail that the whole style is remembered for. Drawn here as
        three boxes: an inner flange on the wall, a web standing proud, and an
        outer flange capping it. That tiny projection is the only thing
        casting shadow on the entire shaft, so it is where the geometry goes.
     3. THE TOWER IS LIFTED AND SET BACK FROM ITS OWN GROUND. Seagram gives up
        half its plot to a granite plaza and stands the shaft behind a
        double-height lobby recessed between exposed piers. That void at the
        bottom is what makes the shaft read as a slab hovering on a podium
        instead of a box sitting in mud.

   WHY EACH ELEMENT EXISTS
     PLAZA       A low granite platform the tower stands on, wider on the
                 entrance side, with one step up. Registered with ctx.plat and
                 topped at 0.42 — under physics STEP_UP (0.45) — so a player
                 walks on and through the door instead of bouncing off it.
     PIERS       The ground two storeys are pushed back into darkness behind
                 heavy piers on every third mullion line. Any pier that would
                 foul the doorway is dropped, not nudged.
     SOFFIT      A deep dark reveal at the podium head, with a lit lip. This
                 single line is what separates "a different building at the
                 bottom" from "the bottom slice of a shaft".
     SHAFT       Spandrel (darkest, opaque, at the floor line), transom, and
                 vision glass (warm smoky bronze) — three cheap merged bands
                 per storey per face. Everything else on the elevation is the
                 mullion run, emitted ONCE full-height rather than per floor,
                 which is both correct (the bronze runs continuous) and the
                 reason this grammar costs a fraction of its box budget.
     MECHANICAL  Two windowless storeys near the top where the same grid is
                 filled with horizontal louvre blades. The plant floor is real
                 and expressing it is the only permissible break in the field.
     CROWN       The grid simply stops, under a deep flat cap that oversails
                 the wall by about a metre, with a slim parapet set inboard of
                 it. Restraint is the correct answer here — but the cap has
                 real depth and a real overhang, so on the skyline plate the
                 tower is a crisp flat-topped slab with a shadow line under
                 its lid, not a shell with a raw parapet.

   COLOUR is anchored to real mid values rather than derived by lightening the
   host, because this renderer clips above about 0x99 and a bronze tower that
   washes out is a white tower. Mullions graphite-bronze, vision glass a warm
   smoky bronze one step up, spandrels darker than both.

   BUDGET. Everything is ctx.dbox (merged, free). No real meshes are minted at
   all. On the 40-storey subject this lands near 30 merged boxes per storey
   against a ceiling of 225.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("intl", {
    label: "Seagram Curtain Wall",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — Seagram is a bronze-and-glass curtain wall on a steel frame.
    structure: "glassbox",
    crownsRoof: true,
    minStoreys: 10,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = ctx.storeys;
      const smallest = Math.min(ctx.w, ctx.d);
      const faces = F.faces(ctx);
      const e = F.entrance(ctx);

      // ---------------- palette ----------------
      // Fixed mid values, only faintly tinted by the host so two of these on
      // one street are not literally the same bronze.
      // MEASURED, not guessed. The first two renders came back paper-beige top
      // to bottom, and sampling the PNG said why: the studio key multiplies a
      // source hex by roughly three and a half before it lands on screen, so a
      // "mid bronze" 0x5c is a cream wall by the time you see it, and mixing
      // toward a cool host colour desaturates whatever survives. These values
      // are therefore anchored DARK and WARM - a source near 0x24 renders as
      // the smoky bronze that was wanted - and the host tint is only a hint,
      // enough that two of these on one street are not the same drawing.
      const BRONZE = F.mix(0x1d160e, ctx.color, 0.05);   // the mullion itself
      const BRZ_LIT = F.shade(BRONZE, 1.90);             // the outer flange face
      const BRZ_DK = F.shade(BRONZE, 0.45);              // webs, reveals, soffits
      const VISION = F.mix(0x241a0c, ctx.color, 0.05);   // warm smoky bronze glass
      const SPAND = F.shade(VISION, 0.34);               // opaque panel at the floor line
      const LOUVRE = F.shade(BRONZE, 0.80);
      const GRANITE = F.mix(0x232220, ctx.color, 0.07);  // plaza / pier stone
      const GRAN_LIT = F.shade(GRANITE, 1.50);
      const GRAN_DK = F.shade(GRANITE, 0.50);

      // ---------------- the grid ----------------
      // THE constant of this facade: a mullion every ~1.5 m, in metres, so bay
      // COUNT scales with the building. A faint hash nudge (a few centimetres)
      // keeps two neighbouring towers from moireing into one wall.
      const PITCH = 1.5 + (ctx.hash(0x1701) - 0.5) * 0.16;
      const MW = 0.30;                       // mullion flange width
      const MP = Math.max(0.26, Math.min(0.42, FH * 0.11));  // how far the web stands proud
      const WALL = 0.22;                     // the curtain plane's own projection

      function lines(f) {
        const n = Math.max(2, Math.round(f.span / PITCH));
        return F.bayLines(f, n, MW * 0.6);
      }

      // ---------------- the vertical zoning ----------------
      // Podium (double-height lobby) · shaft · mechanical · a couple of floors
      // above it · crown. Every boundary is a floor index, so the banding
      // re-proportions on a 14-storey block and a 52-storey flagship alike.
      const podFloors = ST >= 12 ? 2 : 1;
      const yPod = podFloors * FH;
      const mechFloors = ST >= 20 ? 2 : 1;
      const topFloors = 2;
      const kMech0 = Math.max(podFloors + 2, ST - topFloors - mechFloors);
      const kMech1 = kMech0 + mechFloors - 1;

      // ================================================================
      //  1. THE PLAZA — a granite platform, wider on the entrance side
      // ================================================================
      // Emitted as a FRAME around the footprint (never a slab through the
      // building) so the walls are not standing in their own stone, and
      // registered as walk platforms under STEP_UP so it is real ground.
      {
        const TOP = 0.42;                       // < physics STEP_UP (0.45)
        // An up-facing slab takes the key square on and renders far lighter
        // than a wall of the same stone, so the paving is mixed darker than
        // GRANITE on purpose - at GRANITE it photographed as white paper.
        const STEP = TOP / 2;
        const PAVING = F.shade(GRANITE, 0.52);
        const side = Math.max(2.6, Math.min(6.0, smallest * 0.17));
        const front = Math.max(side * 2.0, Math.min(smallest * 0.60, 14.0));
        const ef = e.f;
        // per-side outward depth: the entrance side gets the deep half
        const dep = [side, side, side, side];
        dep[ef.s] = front;
        const halfX = ctx.w / 2, halfZ = ctx.d / 2;
        const x0 = -halfX - dep[2], x1 = halfX + dep[3];
        const z0 = -halfZ - dep[0], z1 = halfZ + dep[1];
        // four slabs forming the frame, plus their platforms
        const rects = [
          [x0, x1, z0, -halfZ], [x0, x1, halfZ, z1],
          [x0, -halfX, -halfZ, halfZ], [halfX, x1, -halfZ, halfZ],
        ];
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i];
          if (r[1] - r[0] < 0.2 || r[3] - r[2] < 0.2) continue;
          ctx.dbox((r[0] + r[1]) / 2, TOP / 2, (r[2] + r[3]) / 2,
            r[1] - r[0], TOP, r[3] - r[2], i < 2 ? PAVING : F.shade(PAVING, 0.88));
          ctx.plat(r[0], r[1], r[2], r[3], TOP, null);
        }
        // the coping line at the plaza edge — a plaza needs an edge or it is
        // a puddle of grey. A thin lit lip all the way round.
        for (const s of [[x0, x1, z0, 0.34], [x0, x1, z1, -0.34]]) {
          ctx.dbox((s[0] + s[1]) / 2, TOP - 0.03, s[2] + s[3] / 2, s[1] - s[0], 0.10, Math.abs(s[3]), F.shade(PAVING, 1.6));
        }
        for (const s of [[z0, z1, x0, 0.34], [z0, z1, x1, -0.34]]) {
          ctx.dbox(s[2] + s[3] / 2, TOP - 0.03, (s[0] + s[1]) / 2, Math.abs(s[3]), 0.10, s[1] - s[0], F.shade(PAVING, 1.6));
        }
        // ONE step up on the entrance side, its own platform + ramp so a
        // sprinting player never samples a seam.
        const stepD = Math.max(0.9, front * 0.16);
        const stepW = Math.min(ef.span + front, (ef.horiz ? (x1 - x0) : (z1 - z0)) * 0.72);
        const o0 = (ef.horiz ? halfZ : halfX) + dep[ef.s];
        const o1 = o0 + stepD;
        if (ef.horiz) {
          ctx.dbox(0, STEP / 2, ef.out * (o0 + stepD / 2), stepW, STEP, stepD, F.shade(PAVING, 0.9));
          const za = ef.out * o0, zb = ef.out * o1;
          ctx.plat(-stepW / 2, stepW / 2, Math.min(za, zb), Math.max(za, zb), STEP,
            { z0: ctx.oz + zb, z1: ctx.oz + za, y0: 0, y1: STEP });
        } else {
          ctx.dbox(ef.out * (o0 + stepD / 2), STEP / 2, 0, stepD, STEP, stepW, F.shade(PAVING, 0.9));
          const xa = ef.out * o0, xb = ef.out * o1;
          ctx.plat(Math.min(xa, xb), Math.max(xa, xb), -stepW / 2, stepW / 2, STEP,
            { axis: "x", x0: ctx.ox + xb, x1: ctx.ox + xa, y0: 0, y1: STEP });
        }
      }

      // ================================================================
      //  2. THE PODIUM — a recessed double-height lobby behind piers
      // ================================================================
      for (const f of faces) {
        // the glazed lobby wall, pushed BACK behind the wall plane so the
        // ground floor is a void and the shaft above it reads as carried
        F.box(ctx, f, 0, yPod * 0.54, f.span + 0.08, yPod * 0.80, 0.06, BRZ_DK, -0.10);
        F.box(ctx, f, 0, yPod * 0.10, f.span + 0.08, yPod * 0.18, 0.09, GRAN_DK, -0.10);
        // the lobby's own light grid: one slim transom at the intermediate
        // floor line, so the double height is legible as double height
        if (podFloors > 1) F.box(ctx, f, 0, FH, f.span + 0.06, 0.14, 0.12, BRONZE, -0.08);
        // PIERS on every third mullion line. Granite-faced, standing well
        // proud, dropped (never shifted) where the doorway is.
        const L = lines(f);
        const pw = Math.max(0.55, Math.min(1.05, PITCH * 0.55));
        for (let i = 0; i < L.length; i += 3) {
          if (!F.clearsDoor(ctx, f, L[i], pw + 0.8)) continue;
          F.box(ctx, f, L[i], yPod * 0.5, pw, yPod, MP * 1.9, GRANITE, 0);
          F.box(ctx, f, L[i], yPod * 0.5, pw * 0.34, yPod, MP * 2.0, GRAN_LIT, 0);   // lit arris
          F.box(ctx, f, L[i], 0.30, pw + 0.26, 0.60, MP * 2.0, GRAN_DK, 0);          // pier base
        }
        // THE SOFFIT at the podium head — the line that makes the bottom a
        // different building: a deep dark reveal with a lit lip over it.
        F.box(ctx, f, 0, yPod - 0.24, f.span + 0.3, 0.48, MP * 2.2, BRZ_DK, 0);
        F.box(ctx, f, 0, yPod + 0.12, f.span + 0.36, 0.24, MP * 2.3, BRZ_LIT, 0);
      }

      // ================================================================
      //  3. THE SHAFT — spandrel, transom, vision glass, floor by floor
      // ================================================================
      // Three merged bands per storey per face and nothing else. The panels
      // are the FIELD; the mullions below are the only thing with depth.
      for (const f of faces) {
        for (let k = podFloors; k < ST; k++) {
          const y = k * FH;
          const mech = (k >= kMech0 && k <= kMech1);
          // spandrel: opaque, darkest, sitting on the floor line
          F.box(ctx, f, 0, y + FH * 0.17, f.span + 0.04, FH * 0.34, WALL, SPAND, 0);
          // transom at the floor line itself
          F.box(ctx, f, 0, y + 0.02, f.span + 0.10, 0.16, WALL + 0.10, BRONZE, 0);
          if (mech) {
            // MECHANICAL: the same grid, filled with horizontal louvre blades
            F.box(ctx, f, 0, y + FH * 0.68, f.span + 0.04, FH * 0.62, WALL * 0.7, BRZ_DK, 0);
            const nb = 5;
            for (let b = 0; b < nb; b++) {
              F.box(ctx, f, 0, y + FH * 0.42 + (b + 0.5) * (FH * 0.52 / nb),
                f.span + 0.02, FH * 0.52 / nb * 0.52, WALL + 0.06, LOUVRE, 0);
            }
          } else {
            // vision glass
            F.box(ctx, f, 0, y + FH * 0.66, f.span + 0.04, FH * 0.58, WALL * 0.62, VISION, 0);
          }
        }
      }

      // ================================================================
      //  4. THE MULLIONS — bronze I-beams, continuous, full shaft height
      // ================================================================
      // Emitted ONCE per line rather than once per line per storey: the bronze
      // really does run continuous, and it is what keeps this grammar under
      // its box budget at 52 storeys. Three boxes each: inner flange on the
      // wall, web standing proud, outer flange capping it and catching light.
      {
        const y0 = yPod + 0.24;
        const y1 = H + 0.10;
        for (const f of faces) {
          const L = lines(f);
          for (let i = 0; i < L.length; i++) {
            const t = L[i];
            const end = (i === 0 || i === L.length - 1);
            const wid = end ? MW * 1.5 : MW;              // the corner mullion is heavier
            F.rib(ctx, f, t, y0, y1, wid, WALL + 0.06, BRONZE, 0);              // inner flange
            F.rib(ctx, f, t, y0, y1, wid * 0.42, MP + WALL, BRZ_DK, 0);         // web
            F.box(ctx, f, t, (y0 + y1) / 2, wid, y1 - y0, 0.09, BRZ_LIT, MP + WALL - 0.09);  // outer flange
          }
        }
      }

      // ================================================================
      //  5. THE CROWN — the grid stops under a deep flat cap
      // ================================================================
      // No spire, no setback, no ornament. What has to survive at a kilometre
      // is a crisp flat-topped slab with a shadow line under its lid, which is
      // a projecting cap plus a parapet held INBOARD of it.
      {
        const capH = Math.max(0.85, Math.min(FH * 0.55, 1.8));
        const capP = Math.max(0.75, Math.min(smallest * 0.045, 1.35));
        // the last spandrel, closing the grid cleanly at the top
        F.ring(ctx, H - capH * 0.10, 0.26, WALL + 0.14, BRONZE, 0.2, 0);
        // drip edge · the cap itself · the lit top lip
        F.ring(ctx, H + capH * 0.10, 0.22, capP * 1.02, BRZ_DK, 0.4, 0);
        F.ring(ctx, H + capH * 0.55, capH * 0.80, capP, F.shade(GRANITE, 0.82), 0.4, 0);
        F.ring(ctx, H + capH * 1.00, 0.18, capP * 1.06, BRZ_LIT, 0.5, 0);
        // a slim parapet, set inboard so the cap keeps its overhanging line
        const parH = Math.max(0.9, Math.min(FH * 0.42, 1.5));
        const parT = 0.34;
        const ins = -capP * 0.55;
        for (const f of faces) {
          F.band(ctx, f, H + capH * 1.09 + parH / 2, parH, parT, BRZ_DK, 0.1, ins);
          F.band(ctx, f, H + capH * 1.09 + parH + 0.06, 0.12, parT + 0.14, BRONZE, 0.2, ins);
        }
      }
    },
  });
})();
