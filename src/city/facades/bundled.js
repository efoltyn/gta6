/* ============================================================
   city/facades/bundled.js — "Bundled Tube", 1973.

   THE READ. Sears/Willis is the purest argument in the kit: the building has
   essentially NO ornament, and it is still one of the most recognisable
   objects on earth. It is nine square structural tubes bundled into a 3x3
   grid, and they STOP AT DIFFERENT HEIGHTS. That is the whole design. So this
   file spends almost nothing on surface and everything on massing, which is
   also exactly what a 40-storey subject wants: at 128 m a storey is 2.5% of
   the elevation, so per-storey carving is invisible and expensive, while a
   stepped asymmetric termination reads from a kilometre.

   HOW THE BUNDLE IS EXPRESSED
     The host shell is one solid prism to ctx.rTop, so the nine tubes cannot be
     nine separate volumes down there. They are DRAWN INTO the shell instead:
     every tube boundary (x = +/- w/6, z = +/- d/6) gets a deep dark slot with
     a slim fin each side, running the full height on all four faces, and the
     building corners get the same fin. Two planes of shadow the whole way up
     is what makes a flat wall read as four shafts stood together, and it costs
     24 boxes for the entire tower.

     ABOVE ctx.rTop the tubes are real volumes standing on the roof, because
     that is where the stagger has to be legible. Four levels of roofline:

       level 0  two diagonally-opposite corner tubes stop at rTop
       level 1  the other two corners, a little higher
       level 2  three of the four edge tubes
       level 3  the centre tube and ONE adjacent edge tube — the tallest pair

     Which diagonal drops first, and which edge tube joins the centre at the
     top, are the only hash-chosen facts in the file. Every other number is a
     fraction of rTop, w, d or FH, so a 14-storey subject and a 52-storey one
     both re-proportion instead of smearing.

   WHY EACH ELEMENT EXISTS
     TUBE JOINTS   see above. The identity below the roofline, for 24 boxes.
     CORNER FINS   each tube gets a slim blade at every corner so it reads as
                   a distinct shaft rather than a slab with lines on it. On the
                   roof tubes these are what keep the stagger crisp against the
                   sky instead of dissolving into one lumpy mass.
     BANDING       continuous horizontal bronze-glass with a dark spandrel
                   under it: exactly two boxes per storey per face. Deliberately
                   the cheapest element in the file, because the massing is
                   doing the work and a curtain wall is genuinely this simple.
     MECHANICAL    two blank louvred belts crossing ALL nine tubes at the same
                   level. They band the shaft into three readable pieces and
                   they are the honest expression of where the plant floors are.
     TUBE TOPS     every terminated tube is a flat roof with a parapet, a
                   coping and a visible mechanical deck. A tube that merely
                   stops looks like a modelling error; a tube with a parapet
                   and a plant box on it looks like a building.
     MASTS         twin antennas on the two tallest tubes. The final silhouette
                   detail, and the only real meshes in the file.
     PODIUM        the bottom of the tower is a different building: the nine
                   tubes land as ONE plinth, a colonnade of deep piers with the
                   glazed lobby held back behind them, a heavy capping band and
                   a broad entrance canopy. It is the only part a player on foot
                   ever touches, so it is detailed at walking scale.

   COLOUR. Black anodised aluminium and bronze-smoke glass, anchored to real
   mid values rather than derived by lightening the host colour — this renderer
   clips above about 0x99 and a tower built by brightening washes to white. The
   host colour is stirred in at 10% so the lot still owns its building. A
   near-black tower carries its relief with SHAPE and shadow, not with tone,
   which is why the fins project far more than they would on a stone facade.

   BUDGET. Everything is ctx.dbox (merged, free) except two antenna cylinders
   and two beacon lamps: 4 real meshes against a ceiling of 40.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("bundled", {
    label: "Bundled Tube",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a bundled tube is nine steel tubes sharing their walls.
    structure: "steel",
    crownsRoof: true,
    minStoreys: 16,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = ctx.storeys;
      const W = ctx.w, D = ctx.d;
      const small = Math.min(W, D);
      const e = F.entrance(ctx);

      // ---------------- palette ----------------
      // Absolute anodised-metal values with a whisper of the host colour, so
      // two bundled towers on one street are not identical but neither one
      // drifts pale. Nothing here is derived by brightening.
      // MEASURED, not guessed: the first render came back cream and pale grey.
      // At this scene's exposure a hex lands on screen roughly 2.4x lighter
      // than it is written, so a "near-black anodised" tower has to be written
      // near 0x16 and its glass near 0x3a. Everything below is anchored, never
      // derived by brightening.
      const HOST = ctx.color | 0;
      const METAL = F.mix(0x16181c, HOST, 0.08);   // the anodised cladding itself
      const SPAND = F.mix(0x0c0d0f, HOST, 0.05);   // spandrel under every band
      const FIN = 0x080909;                        // fins and parapets: darkest solid
      const SLOT = 0x030304;                       // the tube joint, darker still
      const GLASS = F.mix(0x3a2a16, HOST, 0.07);   // bronze-tinted vision glass
      const LOUV = F.mix(0x1e2126, HOST, 0.05);    // mechanical louvres
      const CAP = F.mix(0x2f333a, HOST, 0.04);     // copings catching sky

      // ---------------- the 3x3 grid ----------------
      const TW = W / 3, TD = D / 3;                // tube plan size
      const GAP = Math.max(0.16, Math.min(TW, TD) * 0.05);   // reveal between tubes
      const HW = TW / 2 - GAP, HD = TD / 2 - GAP;  // tube half-extents on the roof
      const FW = Math.max(0.26, Math.min(TW, TD) * 0.055);   // corner fin blade

      // ---------------- the stagger ----------------
      // Four roofline levels, all fractions of rTop so the profile is the same
      // drawing at 14 storeys and at 52. The tallest pair reaches about a
      // quarter of the shaft again above the shell, which is roughly the
      // proportion the real tower's last two tubes hold.
      const E1 = Math.max(FH * 1.2, H * 0.055);
      const E2 = Math.max(FH * 2.6, H * 0.130);
      const E3 = Math.max(FH * 4.4, H * 0.235);

      const diag = ctx.hash(0x8b11) < 0.5 ? 0 : 1;   // which corner pair drops first
      const edges = [[1, 0], [0, 1], [2, 1], [1, 2]];
      const tallEdge = edges[Math.min(3, (ctx.hash(0x8b12) * 4) | 0)];

      function levelOf(i, j) {
        const corner = (i !== 1 && j !== 1);
        if (corner) {
          // one diagonal pair goes first; the hash picks which diagonal
          const onA = (i === j);
          return (onA === (diag === 0)) ? 0 : 1;
        }
        if (i === 1 && j === 1) return 3;
        if (i === tallEdge[0] && j === tallEdge[1]) return 3;
        return 2;
      }
      const RISE = [0, E1, E2, E3];

      // ================================================================
      //  1. THE SHELL — tube joints, corner fins, curtain wall
      // ================================================================
      // The podium is a separate building; the shaft banding starts above it.
      const POD = Math.max(FH * 2.0, Math.min(FH * 4.0, H * 0.115));
      const k0 = Math.max(1, Math.ceil(POD / FH));

      // mechanical belt levels, snapped to storeys so they land on floor lines
      const mk1 = Math.max(k0 + 2, Math.round(ST * 0.36));
      const mk2 = Math.min(ST - 2, Math.round(ST * 0.71));
      const MB = Math.max(1.0, FH * 0.86);          // belt height
      function inBelt(k) {
        return k === mk1 || k === mk2;
      }

      const faces = F.faces(ctx);
      const SLOTP = Math.max(0.30, small * 0.020);   // how far the joint slot stands out
      const FINP = Math.max(0.45, small * 0.032);    // fin projection

      for (const f of faces) {
        // ---- curtain wall: two boxes per storey. That is the whole surface.
        for (let k = k0; k < ST; k++) {
          if (inBelt(k)) continue;
          const y = k * FH;
          // the spandrel is deliberately deeper and taller than it needs to be:
          // it has to COVER the host shell's own floor-line trim, which is a
          // pale strip and reads as a second stripe under every band.
          F.box(ctx, f, 0, y + FH * 0.63, f.span + 0.06, FH * 0.54, 0.09, GLASS);
          F.box(ctx, f, 0, y + FH * 0.16, f.span + 0.10, FH * 0.44, 0.16, SPAND);
        }
        // ---- the tube joints: a deep dark slot with a fin each side, full
        // height. Two per face, at the thirds of the span.
        const jt = (f.horiz ? W : D) / 6;
        for (const sg of [-1, 1]) {
          F.rib(ctx, f, sg * jt, 0.0, H, GAP * 3.4, SLOTP, SLOT);
          for (const sd of [-1, 1]) {
            F.rib(ctx, f, sg * jt + sd * (GAP * 1.7 + FW / 2), 0.0, H, FW, FINP, FIN);
          }
        }
      }
      // the four building corners get the same blade, so the outer tubes are
      // bounded on all four sides exactly like the inner ones
      F.corners(ctx, H / 2, H, FW * 1.6, FINP * 0.9, FIN);

      // ================================================================
      //  2. THE MECHANICAL BELTS
      // ================================================================
      // Blank louvred bands crossing every tube at one level. They are the only
      // horizontal event in 40 storeys of curtain wall, which is precisely why
      // they read.
      function belt(k) {
        if (k < k0 || k >= ST) return;
        const y = k * FH + FH * 0.5;
        for (const f of faces) {
          F.band(ctx, f, y, MB, SLOTP * 0.9, METAL, 0.24);
          const n = 5;
          for (let i = 0; i < n; i++) {
            const ly = y - MB / 2 + (i + 0.5) * (MB / n);
            F.band(ctx, f, ly, MB / n * 0.46, SLOTP * 1.5, LOUV, 0.30);
          }
          F.band(ctx, f, y + MB / 2 + 0.10, 0.20, SLOTP * 1.7, CAP, 0.36);
          F.band(ctx, f, y - MB / 2 - 0.10, 0.20, SLOTP * 1.7, FIN, 0.36);
        }
      }
      belt(mk1);
      belt(mk2);

      // ================================================================
      //  3. THE ROOF TUBES — the silhouette
      // ================================================================
      // Helper: a band ringing one tube, in building-local coordinates. The
      // x-faces are drawn short and the z-faces long so the corners meet once
      // instead of twice.
      function ringAt(cx, cz, hw, hd, cy, h, proj, col) {
        if (!(h > 0) || !(proj > 0)) return;
        ctx.dbox(cx, cy, cz + hd + proj / 2, hw * 2 + proj * 2, h, proj, col);
        ctx.dbox(cx, cy, cz - hd - proj / 2, hw * 2 + proj * 2, h, proj, col);
        ctx.dbox(cx + hw + proj / 2, cy, cz, proj, h, hd * 2, col);
        ctx.dbox(cx - hw - proj / 2, cy, cz, proj, h, hd * 2, col);
      }

      const PARH = Math.max(0.9, FH * 0.44);        // parapet height
      const PARP = Math.max(0.24, small * 0.016);   // parapet thickness

      // The flat top every tube gets, terminated or not: deck, parapet, coping.
      function topOut(cx, cz, hw, hd, y) {
        // roof slab
        ctx.dbox(cx, y + 0.12, cz, hw * 2 + PARP, 0.24, hd * 2 + PARP, METAL);
        // parapet + coping
        ringAt(cx, cz, hw, hd, y + PARH / 2, PARH, PARP, FIN);
        ringAt(cx, cz, hw + PARP * 0.4, hd + PARP * 0.4, y + PARH + 0.09, 0.18, PARP * 0.9, CAP);
        // the mechanical deck, visibly sitting on the roof
        const dh = Math.max(0.9, FH * 0.60);
        ctx.dbox(cx, y + 0.24 + dh / 2, cz, hw * 1.15, dh, hd * 1.15, LOUV);
        ctx.dbox(cx, y + 0.24 + dh + 0.09, cz, hw * 1.25, 0.18, hd * 1.25, CAP);
        // a grille slot on two sides so the deck is plant and not a plinth
        for (const sg of [-1, 1]) {
          ctx.dbox(cx, y + 0.30 + dh * 0.5, cz + sg * (hd * 0.58 + 0.04), hw * 0.9, dh * 0.5, 0.08, SLOT);
        }
      }

      const tall = [];
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const cx = (i - 1) * TW, cz = (j - 1) * TD;
          const lv = levelOf(i, j);
          const rise = RISE[lv];
          const top = H + rise;
          if (rise > 0.4) {
            // the tube as a real volume standing on the roof
            ctx.dbox(cx, H + rise / 2, cz, HW * 2, rise, HD * 2, METAL);
            // its own curtain wall: the same two boxes per storey, on all four
            // sides, so a roof tube is the same building as the shaft below it
            const kt = Math.max(1, Math.round(rise / FH));
            for (let k = 0; k < kt; k++) {
              const y = H + (k + 0.5) * (rise / kt);
              const sh = (rise / kt);
              ringAt(cx, cz, HW, HD, y + sh * 0.12, sh * 0.52, 0.07, GLASS);
              ringAt(cx, cz, HW, HD, y - sh * 0.30, sh * 0.28, 0.11, SPAND);
            }
            // corner blades, full height of the standing tube
            for (const sx of [-1, 1]) {
              for (const sz of [-1, 1]) {
                ctx.dbox(cx + sx * (HW + FW * 0.30), H + rise / 2, cz + sz * (HD + FW * 0.30),
                  FW, rise, FW, FIN);
              }
            }
            // a shadow reveal where the tube leaves the shell, so it lands on
            // the roof rather than hovering over it
            ringAt(cx, cz, HW, HD, H + 0.22, 0.44, PARP * 0.8, SLOT);
          }
          topOut(cx, cz, HW, HD, top);
          if (lv === 3) tall.push({ cx: cx, cz: cz, y: top + PARH });
        }
      }

      // ================================================================
      //  4. TWIN MASTS — the last thing in the silhouette
      // ================================================================
      // The only real meshes in the file: two cylinders and two beacons.
      {
        const mr = Math.max(0.20, small * 0.022);
        const mh = Math.max(FH * 2.4, H * 0.16);
        for (let i = 0; i < tall.length && i < 2; i++) {
          const t = tall[i];
          // a base collar so the mast is bolted to the deck, not stabbed in
          ctx.dbox(t.cx, t.y + 0.30, t.cz, mr * 4.4, 0.60, mr * 4.4, FIN);
          ctx.column(t.cx, t.y + 0.55, t.cz, mr, mh, FIN, 8);
          // two guy collars up the mast, which is what gives it scale
          for (const u of [0.34, 0.66]) {
            ctx.dbox(t.cx, t.y + 0.55 + mh * u, t.cz, mr * 3.0, mr * 0.9, mr * 3.0, LOUV);
          }
          ctx.lamp(t.cx, t.y + 0.55 + mh + mr * 1.2, t.cz, mr * 1.1, 0xff5a3c);
        }
      }

      // ================================================================
      //  5. THE PODIUM — a different building
      // ================================================================
      // The nine tubes meet the ground as ONE plinth: deep piers on the tube
      // lines with the glazed lobby held back behind them, a heavy capping band
      // and a broad entrance canopy. Everything here is sized off FH and the
      // face span, and every pier that would foul the doorway is dropped rather
      // than nudged.
      {
        const PP = Math.max(0.85, Math.min(1.9, small * 0.055));   // pier projection
        const PWD = Math.max(0.9, Math.min(2.2, FH * 0.52));       // pier width
        for (const f of faces) {
          // the lobby: dark glass on the wall plane, held between the piers
          // proj 0.16, not a hairline: the host shell has its own bright
          // storefront on the ground floor and the lobby glass has to sit in
          // front of it, not fight it.
          F.box(ctx, f, 0, POD * 0.52, f.span + 0.05, POD * 0.74, 0.16, F.shade(GLASS, 0.45));
          F.box(ctx, f, 0, POD * 0.075, f.span + 0.06, POD * 0.15, 0.16, FIN);   // the base kick
          // the piers, on the tube lines plus one between each pair, so the
          // podium has its own closer rhythm the way a street wall needs
          const jt = (f.horiz ? W : D) / 6;
          const lines = [-jt * 2, -jt * 1.5, -jt, -jt * 0.5, 0, jt * 0.5, jt, jt * 1.5, jt * 2];
          for (let i = 0; i < lines.length; i++) {
            const t = lines[i];
            if (Math.abs(t) > f.span / 2 - PWD * 0.4) continue;
            if (!F.clearsDoor(ctx, f, t, PWD + 0.6)) continue;
            const heavy = (i % 2) === 0;                    // the tube lines are the heavy ones
            F.rib(ctx, f, t, 0, POD, heavy ? PWD : PWD * 0.55, heavy ? PP : PP * 0.72,
              heavy ? METAL : FIN);
            if (heavy) F.rib(ctx, f, t, 0, POD, PWD * 0.20, PP * 1.08, FIN);   // the blade on its nose
          }
          // the capping band: the strongest horizontal on the whole tower, and
          // the line that says the podium is finished
          F.band(ctx, f, POD + MB * 0.28, MB * 0.56, PP * 1.10, METAL, 0.4);
          F.band(ctx, f, POD + MB * 0.60, 0.22, PP * 1.22, CAP, 0.5);
          F.band(ctx, f, POD + 0.06, 0.22, PP * 1.18, SLOT, 0.5);
        }
        // THE ENTRANCE CANOPY — broad, flat, and clear of the door head.
        const cy = Math.max(e.head + 0.85, FH * 1.25);
        const cw = Math.min(e.f.span * 0.80, e.gap + Math.max(9.0, e.f.span * 0.42));
        const cd = Math.max(2.8, Math.min(6.0, ctx.d * 0.19));
        F.box(ctx, e.f, 0, cy, cw, 0.70, cd, METAL);
        F.box(ctx, e.f, 0, cy + 0.44, cw + 0.7, 0.24, cd * 1.05, CAP);
        F.box(ctx, e.f, 0, cy - 0.42, cw - 0.5, 0.20, cd * 0.96, SLOT);   // the soffit shadow
        // hangers back to the wall, so the canopy is carried and not glued on
        for (const sg of [-1, 1]) {
          F.box(ctx, e.f, sg * (cw / 2 - 0.6), cy + 1.4, 0.22, 2.8, cd * 0.34, FIN);
        }
        // the reveal the doors sit in: a darker, deeper pocket in the plinth
        F.box(ctx, e.f, 0, Math.min(POD, e.head + 0.4) * 0.5, e.gap + 2.6,
          Math.min(POD, e.head + 0.4), 0.05, F.shade(GLASS, 0.34));
        for (const sg of [-1, 1]) {
          F.rib(ctx, e.f, sg * (e.gap / 2 + 1.5), 0, POD, 0.55, PP * 1.15, FIN);
        }
      }
    },
  });
})();
