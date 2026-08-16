/* ============================================================
   city/facades/sunburst.js — "Radiator Crown", 1930.

   THE READ. The Chrysler idea is a bargain: the shaft is an ordinary pale
   brick office building, and every scrap of money, metal and invention is
   spent in the last twenty metres. So this grammar is written top-down. The
   crown is solved first from ctx.rTop, the shaft gets whatever discipline is
   left, and the base is treated as a separate small building because it is
   the only part of a 128 m tower a player on foot will ever touch.

   WHY EACH ELEMENT EXISTS

     THE CROWN (the whole point)
       Seven tiers of radiating arches, each tier NARROWER in plan and TALLER
       in apex than the one below, all springing from a common shoulder. Each
       tier is drawn as stacked courses whose half-width follows a semicircle,
       which is the honest way to draw a fan out of axis-aligned merged boxes
       and reads as a nested set of fans converging on a point from any
       distance. The tiers overlap deliberately: a fan that starts where the
       last one ended is a wedding cake, a fan that starts INSIDE the last one
       is a sunburst. Bright nickel arrises are laid on every course edge so
       the assembly catches light as a set of concentric rings, which is what
       makes the real thing legible against the sky at a kilometre.

     TRIANGULAR LIGHTS
       Two radiating rows of triangular dormer windows punched into every
       tier, on all four faces, counted down as the tiers narrow. This is the
       detail that separates a Chrysler crown from a generic stepped dome: a
       dome has a smooth edge, this one is perforated with dark triangles.

     THE SPIRE
       A slender stepped mast standing on the crown, a real fraction of the
       crown's height rather than a toothpick, with collars breaking its taper
       so it reads as structure, and a small finial. The mast is merged boxes;
       only the knob and the very tip are real meshes (two of them).

     CORNER EAGLES
       At the transition where the shaft stops and the crown begins, a bold
       stepped triangular ornament thrusts OUT and UP from each corner. They
       are the famous ones, they are what stops the crown looking like a hat
       balanced on a box, and they give the silhouette four barbs at exactly
       the height the eye reads as the top of the building.

     THE SHAFT
       Deliberately restrained so the crown wins: continuous vertical piers
       running the full height uninterrupted, a recessed spandrel and a dark
       glass band per storey (two cheap boxes per face per floor and nothing
       else), and two chevron transition bands that break the height into
       thirds without spending geometry per storey.

     THE BASE
       Dark polished granite, tall narrow openings between heavy piers, a
       showroom cornice, and an entrance surround with a radiating metal fan
       over the door — the crown's own motif, brought down to eye level, which
       is how a real deco tower ties its top to its bottom.

   COLOUR is anchored to real mid values rather than derived by lightening the
   host, because this renderer clips above about 0x99 and a crown that washes
   to white loses every arris the tiers are made of. Pale brick shaft, mid
   nickel-steel crown a full step cooler and brighter than the brick, near
   black granite base.

   BUDGET. Everything is ctx.dbox except two meshes at the spire tip. Detail
   is BANDED: nothing repeats per storey except two boxes per face, so a
   40-storey subject stays far under the sheet's box-per-storey ceiling.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("sunburst", {
    label: "Radiator Crown",
    crownsRoof: true,
    minStoreys: 14,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = ctx.storeys;
      const W2 = ctx.w / 2, D2 = ctx.d / 2;
      const small = Math.min(ctx.w, ctx.d);
      const e = F.entrance(ctx);
      const faces = F.faces(ctx);

      // ---------------- palette ----------------
      // Anchored, not derived: the host colour only tints the brick.
      const BRICK = F.mix(ctx.color, 0x877d70, 0.86);
      const PIER = F.shade(BRICK, 1.14);      // the lit face of a pier
      const SPAND = F.shade(BRICK, 0.62);     // recessed spandrel
      const VOID = 0x14171c;                  // glazing, the darkest thing here
      const NICK = 0x848f9b;                  // nickel steel: cooler than brick
      const NLIT = F.shade(NICK, 1.14);       // arrises catching the sun
      const NDRK = F.shade(NICK, 0.44);       // the shaded side of a course
      const GRAN = 0x32353b;                  // polished black granite
      const GLINT = F.shade(GRAN, 1.55);      // its chamfers and reveals

      // ================================================================
      //  0. THE VERTICAL SPLIT — solved from the top down
      // ================================================================
      // The crown is sized FIRST, as a fraction of the whole elevation, and
      // the shaft is only ever what is left between the base and the crown.
      const CH = Math.max(FH * 3.0, Math.min(H * 0.26, H * 0.28));  // crown assembly
      const nBase = Math.max(2, Math.min(5, Math.round(15 / FH)));
      const yBase = Math.min(nBase * FH, H * 0.20);                  // top of granite
      const yShaftTop = H;                                           // crown stands on rTop

      // ================================================================
      //  1. THE BASE — a different building
      // ================================================================
      // Granite plane, heavy piers, tall narrow openings between them. It is
      // clad edge to edge first so the tower has one continuous street wall
      // and the piers have something dark to stand against.
      for (const f of faces) {
        F.band(ctx, f, yBase / 2, yBase, 0.14, GRAN, 0.18);
        const n = F.bayCount(f, 3.4, 3, 9);
        const lines = F.bayLines(f, n, Math.max(0.8, f.span * 0.06));
        const bays = F.bays(f, n, Math.max(0.8, f.span * 0.06));
        const oy0 = yBase * 0.14, oy1 = yBase * 0.80;
        for (const b of bays) {
          const ow = Math.min(b.w * 0.52, (oy1 - oy0) * 0.34);
          if (!F.clearsDoor(ctx, f, b.t, ow + 1.4)) continue;
          F.box(ctx, f, b.t, (oy0 + oy1) / 2, ow, oy1 - oy0, 0.08, VOID, 0);
          F.box(ctx, f, b.t, oy1 + 0.16, ow + 0.5, 0.22, 0.30, NICK, 0.14);   // metal head
          F.box(ctx, f, b.t, oy0 - 0.12, ow + 0.5, 0.20, 0.30, GLINT, 0.14);  // sill
        }
        for (const t of lines) {
          if (!F.clearsDoor(ctx, f, t, 1.2)) continue;
          F.rib(ctx, f, t, 0.0, yBase - 0.30, Math.max(0.6, f.span * 0.035), 0.30, GRAN, 0.14);
          F.rib(ctx, f, t, 0.0, yBase - 0.30, 0.12, 0.36, GLINT, 0.14);       // polished arris
        }
        // the shop-front cornice that ends the base as its own storey
        F.band(ctx, f, yBase - 0.16, 0.34, 0.52, GRAN, 0.5, 0.10);
        F.band(ctx, f, yBase + 0.06, 0.16, 0.60, NICK, 0.6, 0.10);
        F.band(ctx, f, yBase + 0.24, 0.12, 0.40, NLIT, 0.5, 0.10);
      }

      // THE ENTRANCE SURROUND — the crown's fan brought to the pavement.
      {
        const df = e.f;
        const pw = e.gap + 2.6, ph = Math.min(yBase - 1.4, e.head + 1.6);
        if (ph > 2.0) {
          F.box(ctx, df, 0, ph / 2, pw + 1.8, ph, 0.44, GRAN, 0.10);          // surround
          F.box(ctx, df, 0, ph / 2, pw, ph, 0.12, F.shade(GRAN, 0.6), 0.44);  // recess
          for (const sg of [-1, 1])
            F.rib(ctx, df, sg * (pw / 2 + 0.34), 0.1, ph + 0.5, 0.30, 0.56, NICK, 0.10);
          // the radiating fan: ribs of a half-sunburst over the opening
          const fr = Math.min(pw * 0.56, (yBase - ph) * 0.9);
          const rays = 9;
          for (let i = 0; i < rays; i++) {
            const a = Math.PI * (i + 0.5) / rays;              // 0..PI across the head
            const t = Math.cos(a) * fr * 0.92;
            const hy = Math.sin(a) * fr;
            F.box(ctx, df, t, ph + 0.10 + hy / 2, 0.20, Math.max(0.2, hy), 0.50, i % 2 ? NICK : NLIT, 0.10);
          }
          F.box(ctx, df, 0, ph + 0.08, pw + 2.2, 0.26, 0.60, NLIT, 0.10);     // the fan's springing
        }
      }

      // ================================================================
      //  2. THE SHAFT — restrained on purpose
      // ================================================================
      // Continuous piers first. They run unbroken from the base cornice to
      // the crown shoulder, which is the single move that makes a deco tower
      // read as vertical rather than as forty stacked floors.
      const shaftY0 = yBase + 0.40, shaftY1 = yShaftTop;
      const pierProj = Math.max(0.30, Math.min(0.55, small * 0.018));
      for (const f of faces) {
        const n = F.bayCount(f, 3.2, 4, 12);
        const lines = F.bayLines(f, n, Math.max(0.6, f.span * 0.045));
        const pw = Math.max(0.45, f.span / (n * 3.2));
        for (const t of lines) {
          F.rib(ctx, f, t, shaftY0, shaftY1, pw, pierProj, PIER, 0);
          F.rib(ctx, f, t, shaftY0, shaftY1, pw * 0.28, pierProj * 1.16, F.shade(PIER, 1.10), 0);
        }
        // TWO BOXES PER STOREY PER FACE and nothing else: a dark glass band
        // set back behind the piers, and a recessed spandrel under it.
        const k0 = Math.ceil(shaftY0 / FH), k1 = Math.floor((shaftY1 - FH * 0.2) / FH);
        for (let k = k0; k <= k1; k++) {
          const y = k * FH;
          F.box(ctx, f, 0, y + FH * 0.60, f.span + 0.1, FH * 0.52, 0.06, VOID, -0.02);
          F.box(ctx, f, 0, y + FH * 0.20, f.span + 0.1, FH * 0.26, 0.10, SPAND, 0);
        }
      }

      // TRANSITION BANDS. Two chevron courses break the shaft into thirds
      // without costing anything per storey.
      const bandYs = [shaftY0 + (shaftY1 - shaftY0) * 0.36, shaftY0 + (shaftY1 - shaftY0) * 0.68];
      for (let bi = 0; bi < bandYs.length; bi++) {
        const by = bandYs[bi];
        const bh = Math.max(0.8, FH * 0.55);
        F.ring(ctx, by, bh, pierProj * 1.5, F.shade(BRICK, 0.86), 0.4, 0);
        F.ring(ctx, by + bh * 0.56, 0.20, pierProj * 1.9, NICK, 0.5, 0);
        F.ring(ctx, by - bh * 0.56, 0.20, pierProj * 1.9, F.shade(NICK, 0.7), 0.5, 0);
        for (const f of faces) {
          const cn = Math.max(4, Math.min(16, Math.round(f.span / 2.2)));
          const cs = F.bays(f, cn, 0.4);
          for (const c of cs) {
            // a chevron: two short courses meeting at the bay centre
            const half = c.w * 0.30;
            for (const sg of [-1, 1]) {
              F.box(ctx, f, c.t + sg * half * 0.55, by + bh * 0.10, half, bh * 0.22, pierProj * 1.7, NLIT, 0);
              F.box(ctx, f, c.t + sg * half * 0.95, by - bh * 0.14, half * 0.6, bh * 0.22, pierProj * 1.7, NICK, 0);
            }
          }
        }
      }

      // ================================================================
      //  3. THE SHOULDER — where the shaft stops and the metal starts
      // ================================================================
      const shH = Math.max(0.9, FH * 0.7);
      F.ring(ctx, H - shH * 0.5, shH, pierProj * 2.2, F.shade(BRICK, 0.80), 0.5, 0);
      F.ring(ctx, H - 0.10, 0.34, pierProj * 2.9, NICK, 0.7, 0);
      F.ring(ctx, H + 0.16, 0.16, pierProj * 2.4, NLIT, 0.6, 0);

      // ---- CORNER EAGLES ------------------------------------------------
      // A stepped triangular form thrusting out and up from each corner at
      // exactly the shoulder line. Six courses, each shorter and pushed
      // further out, so the profile is a barb rather than a bracket.
      {
        const steps = 6;
        const reach = Math.max(0.7, Math.min(small * 0.085, 2.0));
        const rise = Math.max(1.8, Math.min(FH * 2.2, small * 0.26, CH * 0.55));
        const len = Math.max(1.0, small * 0.115);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          for (let i = 0; i < steps; i++) {
            const u = (i + 0.5) / steps;
            const out = reach * Math.pow(u, 0.65);    // further out as it rises
            const l = len * (1 - u * 0.42);
            const th = rise / steps + 0.03;
            const cy = H - shH * 0.35 + u * rise;
            const col = i % 2 ? NICK : NLIT;
            ctx.dbox(sx * (W2 + out * 0.5), cy, sz * (D2 + out * 0.72), l, th, l * 0.75, col);
            ctx.dbox(sx * (W2 + out * 0.72), cy, sz * (D2 + out * 0.5), l * 0.75, th, l, col);
          }
          // the head: a short blunt block finishing the barb, so the ornament
          // ends in a mass rather than tapering away into a wire.
          ctx.dbox(sx * (W2 + reach * 0.92), H - shH * 0.35 + rise * 1.02, sz * (D2 + reach * 0.92),
            len * 0.60, rise * 0.22, len * 0.60, NLIT);
          ctx.dbox(sx * (W2 + reach * 0.92), H - shH * 0.35 + rise * 1.18, sz * (D2 + reach * 0.92),
            len * 0.34, rise * 0.14, len * 0.34, NICK);
        }
      }

      // ================================================================
      //  4. THE CROWN — nested fans of radiating arches
      // ================================================================
      // Geometry of one tier: it springs from a shoulder low in the assembly
      // and rises to its own apex. Half-width follows sqrt(1-u*u), so the
      // profile is a semicircle drawn in courses. Each successive tier is
      // narrower in plan and higher at the apex, and starts INSIDE the last
      // one — that overlap is what makes the group read as a sunburst.
      const TIERS = 7;
      const HT = CH * 0.56;                 // the fans
      const HS = CH - HT;                   // the spire
      const yC = H + 0.30;                  // the crown's own datum
      // HOW WIDE THE CROWN MAY BE. A fan whose rise is less than its own
      // half-span is a dome, not a sunburst — proved by the 14-storey render,
      // where a full-width crown flattened into a lid. So the crown's plan is
      // capped by its own height: on a tall subject it takes the whole
      // footprint, on a squat one it steps back onto the roof and reads as a
      // separate lantern, which is the correct move at that scale anyway.
      const CS = Math.min(1, (CH * 0.56) / (Math.max(W2, D2) * 0.95));
      const COURSES = 10;

      // a box on one of the crown's four faces, at a given plane distance
      function cface(horiz, sgn, t, cy, len, h, proj, col, plane) {
        const n = plane + proj / 2;
        if (horiz) ctx.dbox(t, cy, sgn * n, len, h, proj, col);
        else ctx.dbox(sgn * n, cy, t, proj, h, len, col);
      }

      // a triangular dormer light: three shrinking courses, dark, with a
      // bright sill so it reads as a punched opening and not a smudge.
      function triLight(horiz, sgn, t, y, wid, h, plane) {
        const st = 3;
        for (let i = 0; i < st; i++) {
          const u = (i + 0.5) / st;
          cface(horiz, sgn, t, y + u * h, wid * (1 - u * 0.86), h / st + 0.02, 0.26, VOID, plane);
        }
        cface(horiz, sgn, t, y - h * 0.10, wid * 1.22, h * 0.16, 0.34, NLIT, plane);
      }

      for (let i = 0; i < TIERS; i++) {
        const k = 1 - 0.128 * i;                        // plan shrink per tier
        const hx = W2 * k * CS, hz = D2 * k * CS;
        const y0 = yC + HT * 0.34 * (i / (TIERS - 1));  // springing, creeping up
        const apex = yC + HT * (0.34 + 0.66 * (i + 1) / TIERS);
        const span = apex - y0;
        if (span < 0.4) continue;
        for (let j = 0; j < COURSES; j++) {
          const u = (j + 0.5) / COURSES;
          const frac = Math.sqrt(Math.max(0.02, 1 - u * u));
          const ch = span / COURSES + 0.03;
          const cy = y0 + u * span;
          const lx = hx * frac * 2, lz = hz * frac * 2;
          ctx.dbox(0, cy, 0, lx, ch, lz, j % 2 ? NICK : NDRK);
          // the arris: a bright lip standing proud of each course edge, which
          // is what makes the tiers read as concentric rings from far away.
          ctx.dbox(0, cy + ch * 0.42, 0, lx + 0.11, ch * 0.18, lz + 0.11, NLIT);
        }
        // TRIANGULAR LIGHTS: two radiating rows per tier, on all four faces.
        const nL = Math.max(2, 6 - i);
        for (const row of [0.30, 0.58]) {
          const frac = Math.sqrt(Math.max(0.02, 1 - row * row));
          const y = y0 + row * span;
          const lh = Math.min(span * 0.22, HT * 0.10);
          for (const horiz of [true, false]) {
            const halfT = (horiz ? hx : hz) * frac;
            const plane = (horiz ? hz : hx) * frac;
            const step = (halfT * 2 * 0.82) / nL;
            if (step < 0.5) continue;
            for (const sgn of [-1, 1]) {
              for (let m = 0; m < nL; m++) {
                const t = -halfT * 0.82 + (m + 0.5) * step;
                triLight(horiz, sgn, t, y, Math.min(step * 0.52, lh * 0.8), lh, plane);
              }
            }
          }
        }
      }

      // ================================================================
      //  5. THE SPIRE
      // ================================================================
      {
        const segs = 14;
        const yS = yC + HT * 1.00;
        const r0 = Math.max(0.45, small * CS * 0.085);
        for (let i = 0; i < segs; i++) {
          const u = i / segs, u1 = (i + 1) / segs;
          const r = r0 * (1 - u1 * 0.86);
          const sh = (HS * 0.86) / segs;
          ctx.dbox(0, yS + (u + (u1 - u) / 2) * HS * 0.86, 0, r * 2, sh + 0.02, r * 2, i % 2 ? NICK : NLIT);
          // collars: a wider band every third segment so the mast reads as a
          // built lattice instead of an extruded pencil.
          if (i % 3 === 1) ctx.dbox(0, yS + u1 * HS * 0.86, 0, r * 3.0, sh * 0.22, r * 3.0, NLIT);
        }
        const yK = yS + HS * 0.86;
        const knob = Math.max(0.28, r0 * 0.42);
        ctx.ball(0, yK + knob, 0, knob, NLIT);              // real mesh 1
        ctx.cone(0, yK + knob * 1.6, 0, knob * 0.62, HS * 0.14, NLIT);  // real mesh 2
      }
    },
  });
})();
