/* ============================================================
   city/facades/techhouse.js — "Modern Tech House": the hillside house that
   cost twelve million dollars and refuses to say so with ornament.

   WHAT IS BEING MODELLED. The contemporary architect house: two or three
   STACKED, SHIFTED SLABS of one material each, a glass ground floor pushed
   back into the shadow of the volume above it, and one roof plane laid so
   thin at the edge that it looks like it is floating. No cornice, no
   parapet, no moulding, no trim, nothing applied. ALL of the identity is in
   the MASSING and in two claddings fighting each other — warm timber against
   cold concrete — with black steel doing every job neither will do. That is
   the opposite of hightech.js's Exostructure, a tower turned inside out;
   this is a HOUSE, and its argument is subtraction.

   THE COMPOSITION, and why each piece has to be there.
     THE SHIFT     The upper volume is pushed OUT past the wall on two
                   ADJACENT faces; the volume above it (when the house is
                   tall enough to have one) is pushed out on the OTHER two.
                   In plan the slabs are offset diagonally, and that is what
                   makes the house read as stacked boxes at 200 m instead of
                   as one box wearing paint. All else is measured off it.
     THE CANTILEVER  The upper volume stands proud and the ground storey does
                   not, so the ground storey IS the recess: dark, glassy, held
                   on slim steel posts, lost under a deep shaded SOFFIT — a
                   dark reveal at the wall, a timber board, a linear LED.
     BATTENS       The timber volume is a run of slim vertical cedar fins
                   standing PROUD of its own cladding, pitched off the floor
                   height. They cross the host's window band and are SUPPOSED
                   to: fins over glass are a brise-soleil, and they are also
                   how a glazing ribbon stops reading as a ribbon.
     CONCRETE      The other volume is board-formed concrete: pale, cool and
                   flat, carrying nothing but the faint plank reveals of the
                   formwork and the panel joints. Two shades and a joint line
                   is the whole texture budget; minimal is a discipline.
     APERTURES     One large opening per storey per face, pushed hard off
                   centre, and it is where the host's own glazing shows
                   through — the cladding is drawn in SEGMENTS around it,
                   never over it. The two volumes push their openings to
                   opposite ends; that is where the asymmetry comes from.
     GLASS CORNER  Where the two concrete faces meet both apertures run to the
                   corner and no cladding turns it, so the slab bands fly past
                   a notch with the building set back behind. The host keeps
                   0.55 m of solid jamb at every face end, so that jamb is
                   painted in the glass tone and the corner reads postless.
     BLADE + SLOT  The entrance is a full-height SLOT — a vertical void from
                   ground to roof where no cladding, batten or band is drawn
                   at all, so the host's own two storeys of glass glow at the
                   back of it — cut against a stone-clad BLADE WALL that
                   overshoots the roof line. Blade, slot and window make the
                   entrance face three-part.
     THE BRIDGE    A thin floating deck to the door, shadow void beneath, one
                   floating tread in front, registered with ctx.plat at 0.36
                   — under physics STEP_UP — so the player walks straight in.
     THE ROOF      A perimeter eave frame, razor thin, oversailing furthest
                   over the entrance so the entry gets a flying canopy. The
                   host's own parapet is clad out in near-black and left in
                   that eave's shadow — that is how a parapet-less edge is won
                   on a shell that insists on a parapet. The middle stays OPEN,
                   for the array and for rooftop gameplay.
     SOLAR         One big array laid flat in a grid on framed rails, inset
                   from the edges and holding a clear central spine for roof
                   gameplay. This is the element that dates the house.

   THE WINDOW RULE. No horizontal band here crosses the host glazing: every
   band lives in a sill zone (k*FH … +0.55) or a header zone ((k+1)*FH-0.45
   … ), and every band on the entrance face is emitted in segments around the
   slot so nothing can hang across the doorway. What crosses the glass is
   exclusively VERTICAL — battens, mullions, steel posts, the blade — which is
   what turns a ribbon into punched openings.

   SPEC (optional, all defaulted): { timberHex } forces the cedar tone,
   { solar:false } omits the rooftop array. `{style:"techhouse"}` is complete.

   COST. Everything is ctx.dbox and merges into the host's deco buckets; the
   only real meshes are three ctx.lamp glows. The LED lines are bright merged
   boxes, not lights.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Which faces meet the two ENDS of a face's tangent run: [low-t, high-t]. A
  // clad plane extends to exactly the neighbouring plane's own projection, so
  // a proud volume closes its corners instead of leaving a notch.
  const NBR = [[2, 3], [2, 3], [0, 1], [0, 1]];

  // A horizontal run on one face between explicit tangent limits, interrupted
  // by "holes" (the slot, an aperture). You cannot cut a hole in a merged
  // axis-aligned box; you decline to draw over it. stone.js's runBand,
  // generalised to take its own L and R.
  function seg(ctx, F, f, cy, h, proj, col, inset, L, R, holes) {
    if (!(h > 0) || !(proj > 0) || R - L < 0.06) return;
    let x = L;
    const hs = (holes || []).slice().sort(function (a, b) { return a[0] - b[0]; });
    for (let i = 0; i < hs.length; i++) {
      const a = Math.max(L, hs[i][0]), b = Math.min(R, hs[i][1]);
      if (b <= x) continue;
      if (a - x > 0.06) F.box(ctx, f, (x + a) / 2, cy, a - x, h, proj, col, inset);
      x = b;
    }
    if (R - x > 0.06) F.box(ctx, f, (x + R) / 2, cy, R - x, h, proj, col, inset);
  }
  function inHole(holes, t, w) {
    for (let i = 0; i < (holes || []).length; i++) {
      if (t + (w || 0) / 2 > holes[i][0] && t - (w || 0) / 2 < holes[i][1]) return true;
    }
    return false;
  }

  CBZ.registerFacade("techhouse", {
    label: "Modern Tech House",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a modern tech house is steel posts and full-height glazing.
    structure: "glassbox",
    crownsRoof: true,
    // A house grammar: the auto-picker must never hand it to a tower, where
    // one cantilever and one roof plane would simply be lost.
    maxStoreys: 3,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), H = ctx.rTop, PP = ctx.pp;
      const small = Math.min(ctx.w, ctx.d);
      const e = F.entrance(ctx);
      const df = e.f;                                  // the entrance face
      const faces = F.faces(ctx);

      // The two host-solid zones per storey, kept INSIDE the real ones (0.55
      // sill / 0.45 header) so no rounding can put a band on the glass.
      // Everything horizontal in this file is sized off these.
      const SLO = 0.42, SHI = 0.32;

      // ---------------- palette: wood, concrete, stone, black ----------------
      // Three real values plus black, pulled a little toward ctx.color so the
      // house sits in its district without the district flattening it. The
      // timber must stay WARM and the concrete COOL: the moment those two
      // converge the whole facade is one grey box again.
      const WOOD = F.shade(F.mix((spec && spec.timberHex) || 0xa5652f, ctx.color, 0.14), 0.96);
      const WOODL = F.shade(WOOD, 1.15);               // fin faces catching light
      const WOODP = F.shade(WOOD, 0.84);               // the panel BEHIND the fins
      const CONC = F.shade(F.mix(ctx.color, 0xb8bcbb, 0.78), 0.90);
      const CONCL = F.shade(CONC, 1.12);               // slab edges, fascia
      const JOINT = F.shade(CONC, 0.62);               // formwork + panel joints
      const STONE = F.shade(F.mix(0xc2b8a6, ctx.color, 0.16), 0.94);   // the blade
      const STONED = F.shade(STONE, 0.78);
      const STEEL = F.mix(0x24282c, ctx.color, 0.07);  // black steel: posts, frames
      const VOID = F.shade(STEEL, 0.50);               // reveals, soffit shadow, upstand
      const GLASSD = F.mix(0x151d25, ctx.color, 0.12); // the corner jamb, painted as glass
      const LED = 0xffeccb;

      // ---------------- the massing ----------------
      // How far a volume cantilevers: off the SMALL plan dimension, capped
      // hard, because a metre and a half is already a real cantilever and it
      // still does not eat the pavement on a 22 m house.
      const CO = clamp(small * 0.105, 0.70, 1.45);
      const CO2 = CO * 0.92;                  // the upper slab shifts slightly less
      const SKIN = 0.07;                      // a flush face still needs a clad plane
      const T = clamp(FH * 0.055, 0.15, 0.22);    // the razor fascia

      // THE TIMBER PAIR: the entrance face and ONE face beside it, so the wood
      // wraps a corner as an L. The concrete pair is the other two, which are
      // also adjacent, so their shared corner is the glass one — diagonally
      // opposite the timber corner. That diagonal IS the composition.
      const woodAdj = NBR[ctx.doorSide][ctx.hash(0x7c01) < 0.5 ? 0 : 1];
      const isWood = {};
      isWood[ctx.doorSide] = 1; isWood[woodAdj] = 1;
      const cFaces = [0, 1, 2, 3].filter(function (s) { return !isWood[s]; });
      // which END of each concrete face's tangent run is the glass corner
      const glassEnd = {};
      if (cFaces.length === 2) {
        glassEnd[cFaces[0]] = (NBR[cFaces[0]][0] === cFaces[1]) ? -1 : 1;
        glassEnd[cFaces[1]] = (NBR[cFaces[1]][0] === cFaces[0]) ? -1 : 1;
      }
      const bladeSide = ctx.hash(0x7c02) < 0.5 ? -1 : 1;   // which side of the slot
      const apDir = ctx.hash(0x7c03) < 0.5 ? -1 : 1;       // which end openings favour

      // THE VOLUME TABLE. `wood:true` means "timber on the timber faces and
      // proud there"; `wood:false` is the concrete slab above, proud on the
      // other pair. A one-storey house has no floor to cantilever off, so its
      // one volume stands proud from the GROUND and the flying roof does the
      // cantilevering instead.
      const vols = [];
      if (ST >= 3) {
        vols.push({ y0: FH, y1: (ST - 1) * FH, wood: true });
        vols.push({ y0: (ST - 1) * FH, y1: H, wood: false });
      } else if (ST === 2) {
        vols.push({ y0: FH, y1: H, wood: true });
      } else {
        vols.push({ y0: 0, y1: H, wood: true });
      }
      const topVol = vols[vols.length - 1];

      function volProj(v, s) {
        if (v.wood) return isWood[s] ? CO : SKIN;
        return isWood[s] ? SKIN : CO2;
      }
      function volWood(v, s) { return !!(v.wood && isWood[s]); }
      // the tangent limits of a clad plane, mitred into its neighbours
      function ext(f, pf) {
        const n = NBR[f.s];
        return { L: -f.span / 2 - pf(n[0]), R: f.span / 2 + pf(n[1]) };
      }

      // ---------------- the entrance slot + the blade ----------------
      const slotH = (e.gap + clamp(df.span * 0.06, 0.45, 1.1)) / 2;   // half width
      const slotHole = [-slotH, slotH];
      const bladeW = clamp(df.span * 0.145, 1.1, 2.6);
      const bladeP = Math.max(CO, SKIN) + clamp(small * 0.045, 0.35, 0.75);
      const bladeC = bladeSide * (slotH + bladeW / 2);
      function doorHoles(f) { return f.s === ctx.doorSide ? [slotHole] : []; }

      // ============================================================
      //  1. THE APERTURE — one big opening per face per storey
      // ============================================================
      // Positioned, never centred. On the entrance face the composition is
      // already fixed (window | slot | blade) so the opening takes the side
      // the blade did not; on a concrete face it runs to the glass corner;
      // anywhere else it is pushed to one end, opposite ends for the two
      // stacked volumes, so the slabs read as shifted.
      function aperture(v, f, run) {
        const runW = run.R - run.L;
        const pw = clamp(runW * 0.13, 0.85, 2.0);     // narrowest solid panel allowed
        if (f.s === ctx.doorSide) {
          const sg = -bladeSide;
          const a = sg * (slotH + 0.34);
          const b = (sg > 0 ? run.R : run.L) - sg * pw;
          if (Math.abs(b - a) < 1.1) return null;
          return a < b ? [a, b] : [b, a];
        }
        const ge = glassEnd[f.s] || 0;
        if (ge) {
          const E = ge > 0 ? run.R : run.L;
          const apW = Math.min(runW * 0.62, runW - pw - 0.25);
          if (apW < 1.1) return null;
          const a = E - ge * 0.02, b = E - ge * apW;
          return a < b ? [a, b] : [b, a];
        }
        const apW = Math.min(runW * 0.52, runW - pw * 2 - 0.25);
        if (apW < 1.1) return null;
        const dir = v.wood ? apDir : -apDir;
        const c = dir > 0 ? (run.R - pw - apW / 2) : (run.L + pw + apW / 2);
        return [c - apW / 2, c + apW / 2];
      }

      // ============================================================
      //  2. THE CLAD VOLUMES — panels in segments, never over the glass
      // ============================================================
      for (let vi = 0; vi < vols.length; vi++) {
        const v = vols[vi];
        const k0 = Math.round(v.y0 / FH), k1 = Math.round(v.y1 / FH) - 1;
        for (let fi = 0; fi < faces.length; fi++) {
          const f = faces[fi];
          const P = volProj(v, f.s);
          const wood = volWood(v, f.s);
          const panel = wood ? WOODP : CONC;
          const run = ext(f, function (s) { return volProj(v, s); });
          // ONE aperture line per volume, repeated at every storey in it, so
          // the openings stack instead of wandering floor to floor.
          const ap = aperture(v, f, run);
          for (let k = k0; k <= k1; k++) {
            const y0 = k * FH, y1 = (k + 1) * FH;
            const holes = doorHoles(f);
            if (ap) holes.push(ap);
            // sill and header zones run the FULL plane: both are solid host
            // wall, so a band there is safe, and it is what makes the cladding
            // read as one surface rather than as a row of piers.
            seg(ctx, F, f, y0 + SLO / 2, SLO, P, panel, 0, run.L, run.R, doorHoles(f));
            seg(ctx, F, f, y1 - SHI / 2, SHI, P, panel, 0, run.L, run.R, doorHoles(f));
            // the glass zone: cladding ONLY beside the opening
            const my = (y0 + SLO + y1 - SHI) / 2, mh = (y1 - SHI) - (y0 + SLO);
            seg(ctx, F, f, my, mh, P, panel, 0, run.L, run.R, holes);
            if (!ap) continue;
            const apW = ap[1] - ap[0], apC = (ap[0] + ap[1]) / 2;
            // the reveal that makes the opening a hole in a thick wall: dark
            // head and sill inside the solid zones, dark jambs at each end
            // that is not already the end of the plane.
            F.box(ctx, f, apC, y0 + SLO - 0.06, apW, 0.12, P * 0.9, VOID, 0);
            F.box(ctx, f, apC, y1 - SHI + 0.06, apW, 0.12, P * 0.9, VOID, 0);
            for (const sg of [-1, 1]) {
              const t = sg < 0 ? ap[0] : ap[1];
              if (Math.abs(t - (sg < 0 ? run.L : run.R)) < 0.12) continue;
              F.rib(ctx, f, t - sg * 0.08, y0 + SLO - 0.02, y1 - SHI + 0.02, 0.16, P * 0.95, VOID, 0);
            }
          }
          // BOARD-FORMED CONCRETE: faint plank reveals and the vertical joints
          // where the formwork panels met. Emitted with the SAME holes as the
          // cladding, so a horizontal line here can only ever exist where
          // there is solid panel behind it.
          if (!wood && v.y1 - v.y0 > 0.6) {
            const pitch = FH / 3.4;
            const n = Math.max(1, Math.round((v.y1 - v.y0) / pitch));
            for (let i = 0; i < n; i++) {
              const y = v.y0 + (i + 0.5) * ((v.y1 - v.y0) / n);
              const kk = Math.floor((y + 0.001) / FH);
              const holes = doorHoles(f);
              if (ap && y > kk * FH + SLO && y < (kk + 1) * FH - SHI) holes.push(ap);
              seg(ctx, F, f, y, 0.06, P + 0.03, JOINT, 0, run.L, run.R, holes);
            }
            const jp = clamp(FH * 0.62, 1.4, 2.6);
            const jn = Math.max(1, Math.round((run.R - run.L) / jp));
            const jHoles = doorHoles(f);
            if (ap) jHoles.push(ap);           // a panel joint cannot cross an opening
            for (let i = 1; i < jn; i++) {
              const t = run.L + (i * (run.R - run.L)) / jn;
              if (inHole(jHoles, t, 0.2)) continue;
              F.rib(ctx, f, t, v.y0 + 0.06, v.y1 - 0.06, 0.08, P + 0.03, JOINT, 0);
            }
          }
        }
      }

      // ============================================================
      //  3. THE BATTEN SCREEN — slim cedar fins over the timber volume
      // ============================================================
      // Fins standing proud of the timber cladding at a pitch off the floor
      // height, crossing the openings and the host's own glazing exactly as a
      // brise-soleil does. Adjacent fins alternate by one shade: on a flat
      // wall every fin faces the same way and takes the same light, so without
      // that the screen flattens to a single tone at 40 m.
      const bPitch = clamp(FH * 0.115, 0.30, 0.42);
      const bWid = clamp(bPitch * 0.30, 0.07, 0.14);
      const bProj = clamp(small * 0.020, 0.13, 0.24);
      for (let vi = 0; vi < vols.length; vi++) {
        const v = vols[vi];
        if (!v.wood) continue;
        for (let fi = 0; fi < faces.length; fi++) {
          const f = faces[fi];
          if (!volWood(v, f.s)) continue;
          const P = volProj(v, f.s);
          const run = ext(f, function (s) { return volProj(v, s); });
          const runW = run.R - run.L;
          const n = Math.min(60, Math.max(4, Math.round(runW / bPitch)));
          const step = runW / n;
          for (let i = 0; i < n; i++) {
            const t = run.L + (i + 0.5) * step;
            if (inHole(doorHoles(f), t, bWid + 0.3)) continue;       // the slot stays a void
            F.rib(ctx, f, t, v.y0 + 0.10, v.y1 - 0.10, bWid,
              bProj, i % 2 ? WOODL : WOOD, P);
          }
          // head and foot rails in black steel, in the solid zones at the
          // volume's ends: fins have to land on something or they read as
          // stripes painted on the wall.
          seg(ctx, F, f, v.y0 + 0.13, 0.14, bProj + 0.04, STEEL, P, run.L, run.R, doorHoles(f));
          seg(ctx, F, f, v.y1 - 0.13, 0.14, bProj + 0.04, STEEL, P, run.L, run.R, doorHoles(f));
        }
      }

      // ============================================================
      //  4. THE FRAMELESS GLASS CORNER
      // ============================================================
      // The host keeps 0.55 m of solid wall at the end of every face, so a
      // true frameless corner is not on offer — but painting that jamb in the
      // glass tone on both faces, with no cladding turning the corner and no
      // post standing in it, makes the glazing read as wrapping the corner.
      // The fascia flying past overhead finishes the illusion.
      for (let i = 0; i < cFaces.length; i++) {
        const f = F.face(ctx, cFaces[i]);
        const ge = glassEnd[cFaces[i]];
        const t = ge * (f.span / 2 - 0.30);
        F.box(ctx, f, t, H / 2, 0.62, H, 0.12, GLASSD, 0);
        // a hairline black shadow where the glass meets the cladding
        F.rib(ctx, f, t - ge * 0.36, 0, H, 0.07, 0.10, VOID, 0);
      }

      // ============================================================
      //  5. THE RECESSED GROUND FLOOR + the slab edge above it
      // ============================================================
      // Nothing is drawn over this storey's glass: it is left dark and open,
      // its solid sill and header zones clad in near-black so the whole storey
      // recedes, and a few slim steel posts crossing it. Those posts are the
      // structure the cantilever lands on, and being vertical they are also
      // what breaks the host's window ribbon into separate panes.
      if (ST >= 2) {
        for (let fi = 0; fi < faces.length; fi++) {
          const f = faces[fi];
          const run = ext(f, function () { return SKIN; });
          const hs = doorHoles(f);
          seg(ctx, F, f, SLO / 2, SLO, SKIN, VOID, 0, run.L, run.R, hs);
          seg(ctx, F, f, FH - SHI / 2, SHI, SKIN, VOID, 0, run.L, run.R, hs);
          const np = clamp(Math.round(f.span / clamp(f.span * 0.30, 3.0, 5.2)), 2, 5);
          const lines = F.bayLines(f, np, clamp(f.span * 0.10, 0.7, 1.6));
          const pw = clamp(small * 0.020, 0.15, 0.26);
          for (let i = 0; i < lines.length; i++) {
            const t = lines[i];
            if (!F.clearsDoor(ctx, f, t, pw * 2 + 0.6)) continue;
            if (inHole(hs, t, pw + 0.4)) continue;
            // no post at the glass corner — that is the entire point of it
            if (glassEnd[f.s] && Math.abs(t - glassEnd[f.s] * (f.span / 2 - 0.9)) < 1.2) continue;
            F.rib(ctx, f, t, 0, FH - SHI, pw, 0.17, STEEL, 0);
          }
        }
      }

      // THE SLAB EDGES. A band at the bottom of every clad volume, and one
      // capping the top of a volume the one above stepped back from: the
      // exposed floor slab. This is the line that says "stacked slabs" at
      // 200 m, and it always lands in the solid zone at a floor line.
      for (let vi = 0; vi < vols.length; vi++) {
        const v = vols[vi];
        for (let fi = 0; fi < faces.length; fi++) {
          const f = faces[fi];
          const P = volProj(v, f.s) + 0.10;
          const run = ext(f, function (s) { return volProj(v, s) + 0.10; });
          const above = vols[vi + 1];
          if (v.y0 > 0.2) {                             // a ground-bearing volume has none
            seg(ctx, F, f, v.y0 + 0.03, 0.30, P, CONCL, 0, run.L, run.R, doorHoles(f));
            seg(ctx, F, f, v.y0 + 0.20, 0.06, P + 0.03, JOINT, 0, run.L, run.R, doorHoles(f));
          }
          if (above && volProj(above, f.s) < P - 0.3) {
            seg(ctx, F, f, v.y1 - 0.03, 0.26, P, CONCL, 0, run.L, run.R, doorHoles(f));
          }
        }
      }

      // ============================================================
      //  6. THE SOFFIT UNDER THE CANTILEVER — dark reveal, board, LED
      // ============================================================
      // A cantilever is a shadow, not a shape. Three boxes per proud face: a
      // dark reveal where the underside meets the wall, a timber board filling
      // the rest of the projection, and a thin bright line between them — the
      // integrated linear LED this house spends its evening budget on.
      let lampsLeft = 2;                    // real emissive meshes: two, then done
      for (let vi = 0; vi < vols.length; vi++) {
        const v = vols[vi];
        if (v.y0 < 0.2) continue;
        for (let fi = 0; fi < faces.length; fi++) {
          const f = faces[fi];
          const P = volProj(v, f.s);
          if (P < 0.5) continue;                       // a flush face has no soffit
          const run = ext(f, function (s) { return volProj(v, s); });
          const hs = doorHoles(f);
          // All three sit BELOW the slab-edge band above them (which projects
          // P+0.10) or they would simply be buried inside it: dark reveal at
          // the wall, a recessed slot with the LED line in it, then the timber
          // board running out to the underside of the slab edge.
          seg(ctx, F, f, v.y0 - 0.24, 0.24, 0.22, VOID, 0, run.L, run.R, hs);
          seg(ctx, F, f, v.y0 - 0.24, 0.07, 0.10, LED, 0.21, run.L, run.R, hs);
          seg(ctx, F, f, v.y0 - 0.20, 0.16, P - 0.22, WOOD, 0.32, run.L, run.R, hs);
          // one real glow per proud TIMBER face, kept off the doorway
          if (lampsLeft > 0 && v.wood) {
            const lt = (f.s === ctx.doorSide) ? -bladeSide * (slotH + 1.3) : f.span * 0.22;
            if (F.clearsDoor(ctx, f, lt, 0.6)) {
              const nrm = f.halfN + 0.34;
              lampsLeft--;
              ctx.lamp(f.horiz ? lt : f.out * nrm, v.y0 - 0.28, f.horiz ? f.out * nrm : lt,
                clamp(small * 0.012, 0.10, 0.16), LED);
            }
          }
        }
      }
      // A ONE-STOREY house cantilevers nothing, so its proud timber plane gets
      // a hard shadow line where it meets the ground instead — three
      // centimetres proud of the cladding so it wins the surface, dark enough
      // to read as a recess. It still lifts the plane off the earth.
      if (ST === 1) {
        for (let fi = 0; fi < faces.length; fi++) {
          const f = faces[fi];
          const P = volProj(vols[0], f.s);
          if (P < 0.5) continue;
          const run = ext(f, function (s) { return volProj(vols[0], s); });
          seg(ctx, F, f, 0.11, 0.22, P + 0.03, VOID, 0, run.L, run.R, doorHoles(f));
        }
      }

      // ============================================================
      //  7. THE BLADE WALL AND THE FULL-HEIGHT ENTRANCE SLOT
      // ============================================================
      // The blade is the only stone on the house and the only element running
      // unbroken from the ground past the roof line. It is a VERTICAL member,
      // so it may cross the host glazing; the slot beside it is a pure void —
      // no cladding, no batten, no band — which is why the host's own two
      // storeys of glass show at the back of it, and why nothing at all can
      // hang across the doorway.
      const bladeTop = H + PP + T + clamp(FH * 0.30, 0.55, 1.30);
      F.box(ctx, df, bladeC, bladeTop / 2, bladeW, bladeTop, bladeP, STONE, 0);
      {
        const ch = clamp(FH * 0.30, 0.55, 1.05);        // stone course height
        const cn = Math.max(2, Math.floor(bladeTop / ch));
        for (let i = 1; i < cn; i++) {
          F.box(ctx, df, bladeC, (i * bladeTop) / cn, bladeW + 0.02, 0.05, bladeP + 0.02, STONED, 0);
        }
        // the reveal on the slot side, and the blade's own lit outer arris
        F.rib(ctx, df, bladeC - bladeSide * (bladeW / 2 + 0.06), 0, bladeTop, 0.12, bladeP + 0.04, VOID, 0);
        F.rib(ctx, df, bladeC + bladeSide * (bladeW / 2 - 0.07), 0, bladeTop, 0.14, bladeP + 0.05,
          F.shade(STONE, 1.10), 0);
      }
      {
        // the slot's two cheeks: full-height black steel reveals the depth of
        // whatever stands beside them
        const cheek = Math.max(CO, SKIN) + 0.12;
        F.rib(ctx, df, -bladeSide * (slotH - 0.08), 0, H, 0.16, cheek, STEEL, 0);
        F.rib(ctx, df, bladeSide * (slotH - 0.08), 0, H, 0.16, bladeP * 0.9, VOID, 0);
        // the slot's back: dark ONLY in the solid zones, and only above the
        // door head, so the doorway itself is never drawn over
        for (let k = 0; k < ST; k++) {
          const zs = [[k * FH, SLO], [(k + 1) * FH - SHI, SHI]];
          for (let i = 0; i < zs.length; i++) {
            if (zs[i][0] < e.head + 0.02) continue;
            F.box(ctx, df, 0, zs[i][0] + zs[i][1] / 2, slotH * 2 - 0.3, zs[i][1], 0.07, VOID, 0);
          }
        }
        // slim steel mullions inside the slot, clear of the door swing
        for (const sg of [-1, 1]) {
          F.rib(ctx, df, sg * (e.gap / 2 + 0.28), 0, H, 0.10, 0.13, STEEL, 0);
        }
        // The transom sits at the door head, and must still land inside the
        // SILL zone of whichever storey that head falls in — hence the guard.
        const trY = e.head + 0.07, trH = 0.14;
        if (trY + trH <= Math.floor(e.head / FH) * FH + 0.55) {
          F.box(ctx, df, 0, trY + trH / 2, slotH * 2 - 0.3, trH, 0.16, STEEL, 0);
        }
        // the head of the slot: a dark reveal with the LED line under it,
        // washing down the stone. Both sit in the top storey's header zone.
        F.box(ctx, df, 0, H - 0.24, slotH * 2 - 0.3, 0.24, 0.18, VOID, 0);
        F.box(ctx, df, 0, H - 0.38, slotH * 2 - 0.5, 0.07, 0.12, LED, 0.10);
        // the third and last real mesh on the building
        const nrm = df.halfN + 0.30;
        ctx.lamp(df.horiz ? 0 : df.out * nrm, e.head + 0.75, df.horiz ? df.out * nrm : 0,
          clamp(small * 0.012, 0.10, 0.16), LED);
      }

      // ============================================================
      //  8. THE FLOATING BRIDGE TO THE DOOR
      // ============================================================
      // A thin deck with a shadow void under it and one floating tread in
      // front. TOP = 0.36 is under physics STEP_UP (0.45) and the approach is
      // one continuous ramp, so a sprinting player cannot sample a seam.
      if (!e.driveIn) {
        const TOP = 0.36;
        const halfN = df.halfN;
        // exactly as wide as the slot: a bridge, not a terrace, and it cannot
        // then run into the foot of the blade wall standing beside the slot.
        const brW = Math.min(df.span - 1.2, slotH * 2);
        const brD = clamp(small * 0.16, 1.6, 3.0);
        const trD = clamp(brD * 0.45, 0.7, 1.4);
        const tw = brW - 0.6;
        if (df.horiz) {
          ctx.dbox(0, TOP - 0.09, df.out * (halfN + brD / 2), brW, 0.18, brD, CONCL);
          ctx.dbox(0, 0.09, df.out * (halfN + brD * 0.40), brW - 1.0, 0.18, brD * 0.46, VOID);
          ctx.dbox(0, TOP - 0.20, df.out * (halfN + brD - 0.03), brW + 0.04, 0.05, 0.10, JOINT);
          ctx.plat(-brW / 2, brW / 2, df.out > 0 ? halfN : -(halfN + brD),
            df.out > 0 ? halfN + brD : -halfN, TOP, null);
          ctx.dbox(0, 0.11, df.out * (halfN + brD + trD / 2), tw, 0.14, trD, CONCL);
          const o0 = halfN + brD, o1 = halfN + brD + trD;
          const z0 = df.out * o0, z1 = df.out * o1;
          ctx.plat(-tw / 2, tw / 2, Math.min(z0, z1), Math.max(z0, z1), TOP,
            { z0: ctx.oz + z1, z1: ctx.oz + z0, y0: 0, y1: TOP });
        } else {
          ctx.dbox(df.out * (halfN + brD / 2), TOP - 0.09, 0, brD, 0.18, brW, CONCL);
          ctx.dbox(df.out * (halfN + brD * 0.40), 0.09, 0, brD * 0.46, 0.18, brW - 1.0, VOID);
          ctx.dbox(df.out * (halfN + brD - 0.03), TOP - 0.20, 0, 0.10, 0.05, brW + 0.04, JOINT);
          ctx.plat(df.out > 0 ? halfN : -(halfN + brD), df.out > 0 ? halfN + brD : -halfN,
            -brW / 2, brW / 2, TOP, null);
          ctx.dbox(df.out * (halfN + brD + trD / 2), 0.11, 0, trD, 0.14, tw, CONCL);
          const o0 = halfN + brD, o1 = halfN + brD + trD;
          const x0 = df.out * o0, x1 = df.out * o1;
          ctx.plat(Math.min(x0, x1), Math.max(x0, x1), -tw / 2, tw / 2, TOP,
            { axis: "x", x0: ctx.ox + x1, x1: ctx.ox + x0, y0: 0, y1: TOP });
        }
      }

      // ============================================================
      //  9. THE FLOATING ROOF — dark upstand, razor fascia, deep eave
      // ============================================================
      // The host shell always builds itself a parapet, so it is clad out in
      // near-black barely proud of the wall and left in the eave's shadow.
      // Above it the roof is a PERIMETER FRAME, not a lid — thin, oversailing
      // furthest over the entrance, open in the middle so the array has
      // somewhere to be and rooftop gameplay keeps its deck.
      const OVb = clamp(small * 0.085, 0.55, 1.20) + (ST === 1 ? clamp(small * 0.05, 0.30, 0.70) : 0);
      function ovOf(s) {
        const base = Math.max(OVb, volProj(topVol, s) + 0.30);
        return s === ctx.doorSide ? base + clamp(FH * 0.22, 0.40, 0.90) : base;
      }
      const upY = H + PP + 0.12;                       // clear of the host's coping lip
      for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        const up = volProj(topVol, f.s) + 0.06;
        const rU = ext(f, function (s) { return volProj(topVol, s) + 0.06; });
        seg(ctx, F, f, H + (upY - H) / 2, upY - H, up, VOID, 0, rU.L, rU.R, null);
        const OV = ovOf(f.s);
        const rE = ext(f, function (s) { return ovOf(s); });
        // the eave runs to each neighbour's OWN overhang, so the four planes
        // mitre; the run is asymmetric, so it is centred on its own midpoint
        // and not on the face.
        const eC = (rE.L + rE.R) / 2, eW = rE.R - rE.L;
        // the plane: reaching 0.5 m back over the deck so the frame is a frame
        F.box(ctx, f, eC, upY + T / 2, eW, T, OV + 0.5, CONCL, -0.5);
        // the razor: a hairline lit lip on top and a dark drip under the outer
        // edge, which is the whole reason a 0.2 m slab reads as thin.
        F.box(ctx, f, eC, upY + T - 0.02, eW, 0.05, OV + 0.06, F.shade(CONCL, 1.10), -0.04);
        F.box(ctx, f, eC, upY - 0.05, eW, 0.10, OV, VOID, 0);
        // The eave soffit over the entrance: timber, with the LED slot inboard
        // of it. Both are inset past the UPSTAND's own face — anything nearer
        // the wall than that is inside the upstand box and invisible.
        if (f.s === ctx.doorSide && OV - up > 0.26) {
          F.box(ctx, f, eC, upY - 0.16, eW, 0.14, OV - up - 0.12, WOOD, up + 0.12);
          F.box(ctx, f, eC, upY - 0.13, eW - 0.9, 0.06, 0.09, LED, up + 0.02);
        }
      }

      // ============================================================
      //  10. THE ROOFTOP SOLAR ARRAY
      // ============================================================
      // Laid flat in a grid on framed rails, low enough to sit under the eave,
      // inset from the slab edges and holding a clear central spine: roof loot,
      // the headhouse and the helipad all live near the slab centre and a solar
      // farm parked on top of them is a favour to nobody.
      if (!spec || spec.solar !== false) {
        const R = F.roof(ctx);
        const y = ctx.rTop + 0.05;
        const mg = 0.85;
        const availW = R.w - mg * 2, availD = R.d - mg * 2;
        if (availW < 1.4 || availD < 1.4) return;        // no deck worth roofing
        const cell = clamp(Math.min(R.w, R.d) * 0.17, 0.9, 1.8);
        const gap = clamp(cell * 0.12, 0.10, 0.22);
        const nx = Math.max(1, Math.floor(availW / (cell + gap)));
        const nz = Math.max(1, Math.floor(availD / (cell + gap)));
        const sx = availW / nx, sz = availD / nz;
        const kx = R.w * 0.15, kz = R.d * 0.15;        // the keep-out spine
        const SOLAR = F.mix(0x172230, ctx.color, 0.06);
        const SFRM = F.mix(0x8d949a, ctx.color, 0.10);
        let laid = 0;
        for (let ix = 0; ix < nx && laid < 44; ix++) {
          for (let iz = 0; iz < nz && laid < 44; iz++) {
            const px = R.cx - availW / 2 + (ix + 0.5) * sx;
            const pz = R.cz - availD / 2 + (iz + 0.5) * sz;
            if (Math.abs(px - R.cx) < kx && Math.abs(pz - R.cz) < kz) continue;
            laid++;
            ctx.dbox(px, y + 0.06, pz, sx - gap + 0.06, 0.08, sz - gap + 0.06, SFRM);
            ctx.dbox(px, y + 0.13, pz, sx - gap, 0.07, sz - gap, SOLAR);
          }
        }
      }
    },
  });
})();
