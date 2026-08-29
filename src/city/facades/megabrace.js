/* ============================================================
   city/facades/megabrace.js — "Braced Tube": the structure IS the building.

   WHAT IS BEING MODELLED. The John Hancock Center: a tower that tapers on
   BOTH plan axes and carries gigantic exterior X-braces, each crossing six
   to ten storeys at once. There is essentially no ornament — every element
   below is a load path, and the load paths are what you see from a
   kilometre away.

     TAPERED ENVELOPE  the host shell is a fixed box, so the taper is built
                       as an ENVELOPE FUNCTION: every structural member
                       stands proud of the wall by env(y), which is large at
                       the plaza and shrinks to almost nothing at the roof.
                       The tower is therefore visibly wider at its base than
                       at its top on both plan axes, and the taper continues
                       above the roofline as real, narrower volume. Without
                       this the grammar would be a rectangle with stripes.
     CORNER COLUMNS    four chamfered megacolumns, the thickest thing on the
                       building, running plaza to crown and following the
                       taper. They are what the braces frame into, and they
                       are drawn per storey so the taper is continuous.
     GIANT X-BRACES    five or six X's for the WHOLE height, each spanning a
                       whole belt-to-belt zone. dbox cannot rotate, so each
                       diagonal is a stepped run of heavy blocks; at any
                       gameplay distance that reads as a single member. They
                       run on all four faces and span the full face width,
                       narrow faces included, so the four elevations read as
                       one braced TUBE rather than as a decorated box.
     NODES             where diagonals meet a column, and where the two
                       diagonals of an X cross, a thicker block. A node is
                       how you can tell structure from a painted stripe.
     BELT TRUSSES      a deep band wrapping all four faces at every node
                       level, tying the X's together and announcing the
                       floor where the structure changes. This is the only
                       horizontal event in the shaft, which is why it can
                       afford to be deep.
     WINDOWS           one dark recessed band per storey between the
                       structure. Cheap on purpose: four boxes a floor. The
                       glass sits well inside the members so every reveal is
                       deep — on a near-black tower the relief has to come
                       from shape and shadow, never from colour.
     CROWN             the taper terminates in a stepped mechanical block, a
                       deep parapet and twin antenna masts. No ornament.
     BASE              the columns land on a raised granite plaza with a
                       broad flight of steps (registered with ctx.plat, each
                       tread under the 0.45 physics step-up so the player can
                       walk up it) and a deeply recessed dark lobby held back
                       behind heavy granite piers.

   Every dimension comes from ctx.w / ctx.d / ctx.storeys / ctx.FH / ctx.rTop
   / ctx.pp or a face span; the only variation is ctx.hash. Real meshes are
   two antenna masts and their beacons — four in total.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("megabrace", {
    label: "Braced Tube",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a braced tube is diagonal steel megabracing.
    structure: "steel",
    crownsRoof: true,
    minStoreys: 20,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), rTop = ctx.rTop;
      const small = Math.min(ctx.w, ctx.d);
      const faces = F.faces(ctx);
      const clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

      // ---- palette: matte black-bronze steel, dark bronze glass, grey
      // granite. Anchored to real mid values, never derived by lightening the
      // host colour — this renderer clips above about 0x99.
      const steel = (spec && spec.steelHex) || F.mix(0x2b2622, 0x36302a, ctx.hash(0x4b12));
      const steelL = F.mix(steel, 0x6a6058, 0.34);      // sunlit chord / node
      const steelD = F.shade(steel, 0.62);              // the reveal
      const glass = F.mix(0x191d20, 0x241d15, ctx.hash(0x7c31));
      const glassD = F.shade(glass, 0.72);
      const granite = F.mix(0x807f7a, 0x8d8b84, ctx.hash(0x2b70));
      const graniteD = F.shade(granite, 0.72);

      // ============================================================
      //  0. THE ENVELOPE — where the taper actually lives
      // ============================================================
      // How far the primary structure stands proud of the fixed shell at a
      // given height. Big at the plaza, nearly flush at the crown; the outer
      // silhouette therefore tapers on both plan axes.
      const P0 = clamp(small * 0.135, 1.8, 4.0);
      const PT = P0 * 0.08;
      function env(y) { return P0 + (PT - P0) * clamp(y / Math.max(1, rTop), 0, 1); }

      // a box on face f whose OUTER plane sits `off` metres proud of the wall
      function skin(f, t, cy, len, h, thick, col, off) {
        F.box(ctx, f, t, cy, len, h, thick, col, off - thick);
      }
      // a stepped run of heavy blocks from (t0,y0) to (t1,y1): the only honest
      // diagonal available when nothing may be rotated.
      function diag(f, t0, y0, t1, y1, wid, thick, col) {
        const rise = Math.abs(y1 - y0);
        const n = clamp(Math.round(rise / Math.max(0.9, FH * 0.42)), 5, 26);
        const dt = (t1 - t0) / n, dy = (y1 - y0) / n;
        for (let i = 0; i < n; i++) {
          const tt = t0 + dt * (i + 0.5), yy = y0 + dy * (i + 0.5);
          skin(f, tt, yy, Math.abs(dt) + wid, Math.abs(dy) + wid * 0.75, thick,
            (i % 2) ? col : F.shade(col, 0.93), env(yy));
        }
      }

      // ---- structural sizing, all off the plan ----
      const colW = clamp(small * 0.115, 1.5, 3.6);       // corner megacolumn
      const braceW = clamp(small * 0.095, 1.3, 3.0);     // diagonal stock
      const beltH = clamp(FH * 0.62, 1.3, 2.6);          // belt truss depth
      const memT = clamp(small * 0.05, 0.7, 1.7);        // radial thickness

      // ---- the base is a different building: how much height it takes ----
      const podH = Math.min(rTop * 0.16, Math.max(FH * 3, 12.5));
      const plazaTop = 0.42;                             // under STEP_UP (0.45)

      // ============================================================
      //  1. BAND THE HEIGHT — belt levels, and the X zones between them
      // ============================================================
      // Five or six X's for the entire tower, never one per floor. The count
      // is solved from the storey count so a 20-storey block gets three and a
      // 52-storey flagship gets six, each still crossing 6-10 floors.
      const nX = clamp(Math.round((ST - 4) / 7), 3, 6);
      const zTop = rTop - beltH * 1.1;
      const zoneH = (zTop - podH) / nX;
      const belts = [];
      for (let i = 0; i <= nX; i++) belts.push(podH + zoneH * i);

      // ============================================================
      //  2. WINDOWS — one dark recessed band per storey. Cheap, deep, dark.
      // ============================================================
      // The shaft's skin is a CONTINUOUS dark field, not forty separate
      // bands: a light stripe of bare shell between each storey turns the
      // whole elevation into a horizontal hatch and the giant braces vanish
      // into it. So the field runs unbroken from the podium to the roof and
      // the storeys are told by slim spandrel lines drawn ON it.
      for (const f of faces) {
        const half = f.span / 2 - colW * 0.72;
        if (half <= 0.6) continue;
        const yA = podH, yB = rTop;
        const nSeg = Math.max(2, nX);
        for (let i = 0; i < nSeg; i++) {
          const s0 = yA + ((yB - yA) * i) / nSeg, s1 = yA + ((yB - yA) * (i + 1)) / nSeg;
          const e = env((s0 + s1) / 2) * 0.34;
          skin(f, 0, (s0 + s1) / 2, half * 2, s1 - s0, Math.max(0.16, e * 0.6),
            (i % 2) ? glass : glassD, Math.max(0.2, e));
        }
        for (let k = 0; k < ST; k++) {
          const y = (k + 1) * FH;
          if (y < podH || y > rTop - 0.4) continue;
          skin(f, 0, y, half * 2, Math.max(0.28, FH * 0.13), 0.22, steelD,
            Math.max(0.34, env(y) * 0.44));
        }
      }

      // ============================================================
      //  3. CORNER MEGACOLUMNS — the thickest thing on the building
      // ============================================================
      // Drawn per storey so the proud offset can follow the taper without a
      // single sloped surface, and chamfered with a narrower outer plate.
      for (let k = 0; k < ST; k++) {
        const y0 = k * FH, y1 = (k + 1) * FH;
        const cy = (y0 + y1) / 2, h = y1 - y0 + 0.04;
        const e = env(cy);
        for (const f of faces) {
          for (const sg of [-1, 1]) {
            const t = sg * (f.span / 2 - colW / 2);
            skin(f, t, cy, colW, h, memT * 1.5, steel, e * 1.22);
            // the chamfer: a narrower plate standing further out, so the
            // column has a lit edge and a shadowed cheek at every hour
            skin(f, t, cy, colW * 0.52, h, memT * 0.7, steelL, e * 1.22 + memT * 0.55);
          }
        }
      }

      // ============================================================
      //  4. THE GIANT X-BRACES + their nodes
      // ============================================================
      for (const f of faces) {
        const tH = f.span / 2 - colW * 0.45;             // where a brace meets a column
        if (tH <= 1) continue;
        for (let z = 0; z < nX; z++) {
          const yA = belts[z] + beltH * 0.5, yB = belts[z + 1] - beltH * 0.5;
          if (yB - yA < FH) continue;
          diag(f, -tH, yA, tH, yB, braceW, memT * 1.25, steel);
          diag(f, tH, yA, -tH, yB, braceW, memT * 1.25, steel);
          // the crossing node — where the two diagonals actually share load
          const ym = (yA + yB) / 2;
          skin(f, 0, ym, braceW * 2.6, braceW * 2.6, memT * 1.6, steelL, env(ym) + memT * 0.2);
          // and a node block where each diagonal lands on a column
          for (const sg of [-1, 1]) for (const yy of [yA, yB]) {
            skin(f, sg * tH, yy, braceW * 2.2, braceW * 2.0, memT * 1.5, steelL,
              env(yy) + memT * 0.15);
          }
        }
      }

      // ============================================================
      //  5. BELT TRUSSES — a deep band wrapping all four faces at each node
      // ============================================================
      for (const y of belts) {
        const e = env(y);
        for (const f of faces) {
          F.band(ctx, f, y, beltH, memT * 1.35, steel, 0.3, e * 1.05 - memT * 1.35);
          // top and bottom chords, caught by the light, so the belt reads as
          // a truss rather than as a painted stripe
          F.band(ctx, f, y + beltH * 0.42, beltH * 0.22, memT * 1.7, steelL, 0.5,
            e * 1.1 - memT * 1.7);
          F.band(ctx, f, y - beltH * 0.42, beltH * 0.22, memT * 1.7, steelD, 0.5,
            e * 1.1 - memT * 1.7);
        }
      }

      // ============================================================
      //  6. THE BASE — granite plaza, broad steps, deeply recessed lobby
      // ============================================================
      {
        const ent = F.entrance(ctx);
        const reach = Math.max(3.5, small * 0.22);       // plaza apron
        const px = ctx.w / 2 + reach, pz = ctx.d / 2 + reach;
        // the raised plaza the whole tower stands on, walkable
        ctx.dbox(0, plazaTop / 2, 0, px * 2, plazaTop, pz * 2, granite);
        ctx.plat(-px, px, -pz, pz, plazaTop);
        // a chamfered kerb so the plaza is a plinth and not a rug
        ctx.dbox(0, plazaTop * 0.35, 0, px * 2 + 0.5, plazaTop * 0.5, pz * 2 + 0.5, graniteD);
        // the broad flight of steps on the door face, two treads under the
        // 0.45 m physics step-up so a player walks straight up it
        {
          const f = ent.f;
          const runW = Math.min(f.span * 0.92, f.span - 1.0) + reach;
          const nT = 2, tread = Math.max(0.7, reach * 0.30), riser = plazaTop / (nT + 1);
          for (let i = 0; i < nT; i++) {
            const top = riser * (i + 1);
            const outer = (f.horiz ? pz : px) + tread * (nT - i);
            const inner = (f.horiz ? pz : px) + tread * (nT - i - 1);
            if (f.horiz) {
              ctx.dbox(0, top / 2, f.out * (inner + outer) / 2, runW, top, outer - inner, i ? granite : graniteD);
              ctx.plat(-runW / 2, runW / 2, f.out > 0 ? inner : -outer, f.out > 0 ? outer : -inner, top);
            } else {
              ctx.dbox(f.out * (inner + outer) / 2, top / 2, 0, outer - inner, top, runW, i ? granite : graniteD);
              ctx.plat(f.out > 0 ? inner : -outer, f.out > 0 ? outer : -inner, -runW / 2, runW / 2, top);
            }
          }
        }
        // The podium as a street wall: heavy granite piers standing far proud,
        // with the dark lobby glass held right back at the wall plane. The
        // depth between the two IS the recess — nothing is cut into the shell.
        const e0 = env(podH * 0.5);
        const lobH = Math.min(podH - FH * 0.6, FH * 2.4);
        for (const f of faces) {
          const nP = F.bayCount(f, 6.5, 2, 5);
          for (const t of F.bayLines(f, nP, colW * 1.1)) {
            if (!F.clearsDoor(ctx, f, t, colW * 1.3)) continue;
            skin(f, t, plazaTop + (podH - plazaTop) / 2, colW * 0.95, podH - plazaTop,
              memT * 1.8, granite, e0 * 1.25);
          }
          // the corner piers, thicker, continuing the megacolumn to the ground
          for (const sg of [-1, 1]) {
            skin(f, sg * (f.span / 2 - colW * 0.75), plazaTop + (podH - plazaTop) / 2,
              colW * 1.5, podH - plazaTop, memT * 2.1, granite, e0 * 1.35);
          }
          // the recessed lobby: dark glass at the wall plane, with a shadow
          // soffit over it so the reveal reads as depth even on a flat day
          const gw = f.span - colW * 2.4;
          if (gw > 1.5) {
            skin(f, 0, plazaTop + lobH / 2, gw, lobH, 0.18, glassD, 0.2);
            skin(f, 0, plazaTop + lobH + 0.25, gw + 0.4, 0.5, memT * 1.4, steelD, e0 * 1.1);
          }
          // the podium cap: the plane the shaft's structure lands on
          F.band(ctx, f, podH, beltH * 0.85, memT * 1.9, granite, 0.5, e0 * 1.3 - memT * 1.9);
          F.band(ctx, f, podH + beltH * 0.45, 0.28, memT * 2.2, graniteD, 0.7, e0 * 1.35 - memT * 2.2);
        }
      }

      // ============================================================
      //  7. THE CROWN — the taper carried above the roof, then stopped flat
      // ============================================================
      {
        const R = F.roof(ctx);
        const y0 = rTop;
        // deep mechanical parapet, the last belt
        F.parapet(ctx, Math.max(1.6, FH * 0.75), memT * 1.5, steel, steelL);
        // the taper continues as real volume: two stepped mechanical blocks,
        // each narrower than the last, so the silhouette keeps closing
        const mh = Math.max(FH * 0.9, rTop * 0.028);
        let bw = ctx.w * 0.80, bd = ctx.d * 0.80, by = y0 + Math.max(1.6, FH * 0.75);
        for (let i = 0; i < 2; i++) {
          ctx.dbox(R.cx, by + mh / 2, R.cz, bw, mh, bd, i ? steelD : steel);
          ctx.dbox(R.cx, by + mh + 0.18, R.cz, bw + 0.7, 0.36, bd + 0.7, steelL);  // coping
          // louvre courses on the plant box: horizontal only, no ornament
          for (let k = 1; k <= 3; k++) {
            const ly = by + (mh * k) / 4;
            ctx.dbox(R.cx, ly, R.cz, bw + 0.16, mh * 0.11, bd + 0.16, steelD);
          }
          by += mh + 0.36; bw *= 0.78; bd *= 0.78;
        }
        // twin antenna masts — the only real meshes on the whole building
        const mastH = clamp(rTop * 0.16, FH * 2.2, FH * 7);
        const mr = Math.max(0.16, colW * 0.14);
        for (const sg of [-1, 1]) {
          const mx = R.cx + sg * bw * 0.42;
          ctx.column(mx, by, R.cz, mr, mastH, steel, 8);
          ctx.dbox(mx, by + mastH * 0.34, R.cz, mr * 3.4, mr * 1.3, mr * 3.4, steelL);
          ctx.dbox(mx, by + mastH * 0.62, R.cz, mr * 2.6, mr * 1.1, mr * 2.6, steelL);
          ctx.lamp(mx, by + mastH + mr, R.cz, mr * 0.9, 0xff5544);
        }
      }
    },
  });
})();
