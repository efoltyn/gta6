/* ============================================================
   city/facades/hightech.js — "Exostructure": the inside-out building.

   WHAT IS BEING MODELLED. The Lloyd's / Pompidou move: a building whose
   floors are hung off a frame that stands OUTSIDE the weather line, and
   whose services are bolted to the outside of that frame. Everything a
   normal building buries in a core is put on show, and the show IS the
   architecture. Each element below exists because that one decision is
   true:

     EXOSKELETON  vertical tubes standing proud of the glass on every face,
                  one per bay line (count from F.bayCount, so an 11 m shop
                  gets three and a 40 m block gets nine), tied by a RING
                  BEAM at every floor line. The frame is a cage in front of
                  the wall, not a pattern on it — that gap of air is the
                  whole read, so the standoff scales with the building and
                  never collapses to zero.
     BRACING      selected bays get a stepped X (or, at one storey, a K).
                  dbox is axis-aligned, so a diagonal is drawn as a short
                  staircase of small blocks; at gameplay distance that
                  reads as a brace and costs nothing. Only SOME bays are
                  braced — bracing every bay reads as noise, not structure.
     GASKETED     between the frame, a dark recessed glass field with slim
     GLAZING      mullions on the floor grid. The glass is flush and taut
                  and DARK; the frame is bright. That contrast is the style
                  and the two colours must never converge.
     SERVICE      fat cylindrical ducts run the full height of one flank in
     RISERS       a signal colour, with banded joints at the floor lines
                  and an elbow bend turning onto the roof at the top. The
                  side is picked by ctx.hash, so it is the same every boot.
     STAIR TUBE   a glazed escape/lift shaft expressed on another flank:
                  a full-height glass box on its own frame, with visible
                  landings on the floor lines and a stepped stair run
                  zig-zagging between them.
     ROOF PLANT   plant as architecture: a framed gantry, two masts with
                  stepped guy-ties and a small crane arm, all held OFF the
                  slab centre (F.roof) so rooftop gameplay keeps its deck.

   Every dimension derives from ctx.w / ctx.d / ctx.storeys / ctx.FH /
   ctx.rTop / ctx.pp or a face span. Real meshes (column) are budgeted and
   fall back to square dbox posts once the budget is spent, so the whole
   facade is a handful of cylinders plus merged trim.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("hightech", {
    label: "Exostructure",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, ST = Math.max(1, ctx.storeys | 0), rTop = ctx.rTop;
      const small = Math.min(ctx.w, ctx.d);
      const big = Math.max(ctx.w, ctx.d);

      // ---- palette: bright frame, dark glass. Never let them converge. ----
      const accents = [0xe8ebee, 0xdfe3e6, 0x2f6fd0, 0xd23c2a];
      const frame = (spec && spec.frameHex) ||
        accents[(ctx.hash(0x11e1) * accents.length) | 0];
      const frameD = F.shade(frame, 0.82);          // shadow side of the cage
      const frameL = F.shade(frame, 1.08);
      const glass = F.mix(0x18222c, 0x24303c, ctx.hash(0x2c31));
      const glassD = F.shade(glass, 0.78);
      const mull = F.mix(frame, 0x3a4149, 0.55);    // slim gasket bars
      const duct = (ctx.hash(0x3d0c) < 0.5) ? 0x2f6fd0 : 0xc9ced4;
      const ductD = F.shade(duct, 0.8);
      const steel = 0x9aa2aa;

      // ---- the cage geometry, all solved off the host ----
      // how far the frame stands in front of the glass. Big enough to read as
      // air at 200 m, small enough not to eat the sidewalk on a small shop.
      const stand = Math.max(0.34, Math.min(1.15, small * 0.055));
      const tubeR = Math.max(0.13, Math.min(0.36, small * 0.017));
      const beamT = tubeR * 1.5;                    // ring beam depth
      const beamH = Math.max(0.16, Math.min(0.46, FH * 0.10));
      const barT = Math.max(0.05, tubeR * 0.42);    // bracing / mullion stock
      const margin = Math.max(0.45, small * 0.045);
      const BAY_PER = 3.9;

      // A real-mesh budget: cylinders are lovely for tubes and ducts but they
      // are actual draw calls, so past the budget a tube becomes a square dbox
      // post — at distance the difference is invisible.
      let meshBudget = 34;
      function tube(x, y0, y1, r, col) {
        if (y1 <= y0) return;
        if (meshBudget > 0) { meshBudget--; ctx.column(x[0], y0, x[1], r, y1 - y0, col, 10); }
        else ctx.dbox(x[0], (y0 + y1) / 2, x[1], r * 2, y1 - y0, r * 2, col);
      }
      // world point of a tangent t on face f, off metres out from the wall
      function pt(f, t, off) {
        const n = f.halfN + off;
        return f.horiz ? [t, f.out * n] : [f.out * n, t];
      }
      // a box on face f whose CENTRE sits off out from the wall plane
      function exo(f, t, cy, len, h, thick, col, off) {
        F.box(ctx, f, t, cy, len, h, thick, col, off - thick / 2);
      }
      // a stepped run of small blocks from (t0,y0) to (t1,y1) on face f —
      // the only honest diagonal available to an axis-aligned merged box.
      function diag(f, t0, y0, t1, y1, thick, col, off, steps) {
        const n = Math.max(4, steps || Math.round(Math.abs(y1 - y0) / Math.max(0.35, FH * 0.13)));
        const dt = (t1 - t0) / n, dy = (y1 - y0) / n;
        for (let i = 0; i < n; i++) {
          const tt = t0 + dt * (i + 0.5), yy = y0 + dy * (i + 0.5);
          exo(f, tt, yy, Math.abs(dt) + thick, Math.abs(dy) + thick, thick, col, off);
        }
      }

      const faces = F.faces(ctx);
      const ent = F.entrance(ctx);
      const doorFace = ctx.doorSide;

      // deterministic service sides, chosen from the non-door faces so the
      // ducts and the stair never bury the entrance.
      const flanks = F.flanks(ctx);
      const riserF = flanks[(ctx.hash(0x5a11) * flanks.length) | 0] || flanks[0];
      const stairF = flanks.filter(function (f) { return f.s !== riserF.s; })[
        (ctx.hash(0x77b2) * Math.max(1, flanks.length - 1)) | 0] || flanks[0];

      // ============================================================
      //  1. GASKETED GLAZING — the taut dark skin the cage stands in front of
      // ============================================================
      for (const f of faces) {
        const n = F.bayCount(f, BAY_PER, 2, 9);
        const bays = F.bays(f, n, margin);
        const isDoor = (f.s === doorFace);
        for (const bay of bays) {
          for (let k = 0; k < ST; k++) {
            const y0 = k * FH + beamH * 0.7;
            const y1 = (k + 1) * FH - beamH * 0.7;
            if (y1 - y0 < 0.25) continue;
            if (k === 0 && isDoor && !F.clearsDoor(ctx, f, bay.t, bay.w * 0.6)) continue;
            // the glass field: barely proud of the wall so it reads flush
            exo(f, bay.t, (y0 + y1) / 2, bay.w * 0.97, y1 - y0, 0.09,
              (k % 2) ? glass : glassD, 0.05);
            // slim mullions: a pair of verticals and a transom at mid-storey.
            // Kept THIN and dark — they are the gasket grid, and the moment
            // they get fat they start competing with the bracing for the eye.
            const mw = barT * 0.7;
            for (const sg of [-1, 1])
              exo(f, bay.t + sg * bay.w * 0.24, (y0 + y1) / 2, mw, y1 - y0, mw, mull, 0.10);
            exo(f, bay.t, (y0 + y1) / 2, bay.w * 0.97, mw, mw, F.shade(mull, 0.85), 0.10);
          }
        }
        // spandrel gasket at every floor line, behind the ring beam
        for (let k = 0; k <= ST; k++)
          F.band(ctx, f, Math.min(rTop, k * FH), beamH * 1.3, 0.1, F.shade(mull, 0.85), 0.1, 0.0);
      }

      // ============================================================
      //  2. THE EXOSKELETON — tubes on the bay lines, ring beams on the floors
      // ============================================================
      const colTop = rTop + Math.max(0.6, FH * 0.22);   // the cage overshoots the roof
      for (const f of faces) {
        const n = F.bayCount(f, BAY_PER, 2, 9);
        const lines = F.bayLines(f, n, margin);
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i];
          // the corner lines belong to the neighbouring face too; draw them
          // once, on the face that runs along x, so corners are not doubled.
          if (!f.horiz && (i === 0 || i === lines.length - 1)) continue;
          const y0 = (f.s === doorFace && !F.clearsDoor(ctx, f, t, tubeR * 2)) ? ent.head : 0;
          tube(pt(f, t, stand), y0, colTop, tubeR, frame);
          // collar plates where the ring beams land on the tube
          for (let k = 0; k <= ST; k++) {
            const y = Math.min(rTop, k * FH);
            if (y < y0) continue;
            exo(f, t, y, tubeR * 2.9, beamH * 0.55, tubeR * 2.9, frameL, stand);
          }
        }
        // the ring beam at every floor line, standing out with the tubes
        for (let k = 0; k <= ST; k++) {
          const y = Math.min(rTop, k * FH);
          const solid = (k === 0 || k === ST);
          exo(f, 0, y, f.span + stand * 2, beamH * (solid ? 1.35 : 1.0), beamT,
            solid ? frame : frameD, stand);
          // short outriggers tying the beam back to the wall, so the cage is
          // visibly HELD OFF the building rather than floating in front of it
          const ties = F.bays(f, F.bayCount(f, BAY_PER, 2, 9), margin);
          for (const b of ties) {
            if (f.s === doorFace && k === 0 && !F.clearsDoor(ctx, f, b.t, 0)) continue;
            F.box(ctx, f, b.t, y, barT * 1.6, barT * 1.6, stand, steel, 0);
          }
        }
      }

      // ============================================================
      //  3. BRACING — stepped X (or K at one storey) in SELECTED bays only
      // ============================================================
      for (const f of faces) {
        const n = F.bayCount(f, BAY_PER, 2, 9);
        const bays = F.bays(f, n, margin);
        if (!bays.length) continue;
        // brace roughly every third bay, offset per face by hash: enough to
        // read as structure, sparse enough not to read as hatching.
        const phase = (ctx.hash(0x9c00 + f.s) * 3) | 0;
        for (const bay of bays) {
          if ((bay.i + phase) % 3 !== 0) continue;
          for (let k = 0; k < ST; k++) {
            const y0 = k * FH + beamH * 0.6, y1 = (k + 1) * FH - beamH * 0.6;
            if (y1 - y0 < 0.5) continue;
            if (f.s === doorFace && k === 0 && !F.clearsDoor(ctx, f, bay.t, bay.w)) continue;
            const hw = bay.w * 0.44;
            if (ST === 1) {
              // a K: two struts up to the head of the single storey
              diag(f, bay.t - hw, y0, bay.t, y1, barT * 1.15, frame, stand);
              diag(f, bay.t + hw, y0, bay.t, y1, barT * 1.15, frame, stand);
            } else {
              diag(f, bay.t - hw, y0, bay.t + hw, y1, barT * 1.15, frame, stand);
              diag(f, bay.t + hw, y0, bay.t - hw, y1, barT * 1.15, frame, stand);
            }
          }
        }
      }

      // ============================================================
      //  4. SERVICE RISERS — fat ducts up one flank, elbowing onto the roof
      // ============================================================
      {
        const f = riserF;
        const off = stand + tubeR + Math.max(0.22, small * 0.02);
        const dr = Math.max(0.22, Math.min(0.62, small * 0.032));
        const nD = f.span > 14 ? 3 : 2;
        const spread = Math.min(f.span * 0.34, dr * 8);
        const top = rTop + Math.max(1.0, FH * 0.35);
        for (let i = 0; i < nD; i++) {
          const t = (nD === 1) ? 0 : -spread + (i * spread * 2) / (nD - 1);
          const r = dr * (i === 1 ? 1.0 : 0.78);
          const dcol = (i % 2) ? ductD : duct;
          tube(pt(f, t, off + r), 0, top, r, dcol);
          // banded joints on the floor lines — the detail that says "duct"
          for (let k = 0; k <= ST; k++) {
            const y = Math.min(rTop, k * FH);
            exo(f, t, y, r * 2.5, r * 0.55, r * 2.5, F.shade(dcol, 1.14), off + r);
          }
          // the elbow: a stepped shoulder turning inboard onto the roof deck
          const inT = t * 0.45;
          diag(f, t, top, inT, top + Math.max(0.7, FH * 0.3), r * 1.5, dcol, off + r, 4);
          // and the horizontal run back over the parapet line
          exo(f, inT, top + Math.max(0.7, FH * 0.3), r * 2, r * 2, off + r * 2,
            dcol, (off + r) / 2);
        }
        // each duct gets a NARROW back-strip so it never reads as a pipe
        // floating in front of nothing. A single wide plate here reads as a
        // blank slab and kills the flank — strips keep the glass visible.
        for (let i = 0; i < nD; i++) {
          const t = (nD === 1) ? 0 : -spread + (i * spread * 2) / (nD - 1);
          exo(f, t, rTop / 2, dr * 2.2, rTop, barT * 2, frameD, stand * 0.5);
        }
      }

      // ============================================================
      //  5. THE STAIR TUBE — a glazed shaft with visible landings
      // ============================================================
      if (stairF && stairF.s !== riserF.s) {
        const f = stairF;
        const wid = Math.min(f.span * 0.34, Math.max(2.4, small * 0.20));
        const dep = Math.max(1.2, Math.min(2.6, wid * 0.62));
        const off = stand + dep / 2;
        const t0 = (ctx.hash(0x4411) < 0.5 ? -1 : 1) * f.span * 0.24;
        const top = rTop + Math.max(0.8, FH * 0.28);
        // the glass shell
        exo(f, t0, top / 2, wid, top, dep, glass, off);
        // its own corner posts, which is what makes it a tube and not a bump
        for (const sg of [-1, 1]) {
          tube(pt(f, t0 + sg * (wid / 2), off + dep / 2 - tubeR), 0, top, tubeR * 0.85, frame);
          exo(f, t0 + sg * (wid / 2), top / 2, barT * 2, top, dep, frameD, off);
        }
        exo(f, t0, top, wid + barT * 4, beamH * 1.2, dep + barT * 3, frame, off);
        exo(f, t0, 0.05, wid + barT * 4, beamH * 1.2, dep + barT * 3, frame, off);
        // landings + the zig-zag flight between them, drawn on the outer face
        const fo = off + dep / 2 - barT;
        for (let k = 0; k <= ST; k++) {
          const y = Math.min(rTop, k * FH);
          exo(f, t0, y + beamH * 0.4, wid * 0.9, beamH * 0.5, dep * 0.8, steel, off);
          if (k >= ST) continue;
          const sg = (k % 2) ? 1 : -1;
          diag(f, t0 - sg * wid * 0.34, y + beamH * 0.4, t0 + sg * wid * 0.34,
            y + FH - beamH * 0.4, barT * 1.4, steel, fo, 6);
        }
      }

      // ============================================================
      //  6. ROOF PLANT — gantry, masts, crane arm. Off the slab centre.
      // ============================================================
      {
        const R = F.roof(ctx);
        const y = R.y;
        // PLANT SCALE. Rooftop plant is sized by the building it serves: a
        // one-storey shop has one air handler, not a refinery. Without this
        // the masts and the crane out-measure a small shell and the thing
        // reads as an oil rig standing on a kiosk.
        const ps = Math.max(0.34, Math.min(1, rTop / (FH * 3.2)));
        const legH = Math.max(0.85, FH * 0.55 * ps);
        const gw = Math.min(R.w * 0.42, R.base * 0.5);
        const gd = Math.min(R.d * 0.30, R.base * 0.34);
        // the gantry sits toward one edge, deterministic, clear of the middle
        const sgx = (ctx.hash(0x6b21) < 0.5) ? -1 : 1;
        const gx = R.cx + sgx * R.w * 0.30;
        const gz = R.cz - R.d * 0.28;
        const legT = Math.max(0.14, tubeR * 1.2);
        for (const ox2 of [-1, 1]) for (const oz2 of [-1, 1])
          ctx.dbox(gx + ox2 * gw / 2, y + legH / 2, gz + oz2 * gd / 2, legT, legH, legT, frame);
        // deck + the plant box it carries
        ctx.dbox(gx, y + legH + 0.1, gz, gw + legT * 2, 0.2, gd + legT * 2, frameD);
        const plantH = Math.max(0.5, FH * 0.28 * ps);
        ctx.dbox(gx, y + legH + 0.1 + plantH / 2, gz, gw * 0.8, plantH, gd * 0.8, steel);
        // handrail round the deck
        for (const sg of [-1, 1]) {
          ctx.dbox(gx, y + legH + 0.7, gz + sg * (gd / 2 + legT), gw + legT * 2, barT, barT, frameL);
          ctx.dbox(gx + sg * (gw / 2 + legT), y + legH + 0.7, gz, barT, barT, gd + legT * 2, frameL);
        }

        // two masts, tied down with stepped guys. The masts are what give the
        // silhouette its top — this style has no cornice and needs one.
        const mastH = Math.max(FH * 0.5, Math.min(rTop * 0.5, FH * 3.0));
        const mr = Math.max(0.10, tubeR * 0.75);
        for (const sg of [-1, 1]) {
          const mx = R.cx + sg * R.w * 0.34;
          const mz = R.cz + R.d * 0.30;
          if (meshBudget > 0) { meshBudget--; ctx.column(mx, y, mz, mr, mastH, frame, 8); }
          else ctx.dbox(mx, y + mastH / 2, mz, mr * 2, mastH, mr * 2, frame);
          ctx.dbox(mx, y + mastH * 0.62, mz, mr * 4, mr * 1.2, mr * 4, frameL);   // collar
          // guy ties: stepped runs from near the mast head down to the deck
          const gyH = mastH * 0.72, reach = Math.min(R.w, R.d) * 0.16;
          for (const q of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const n = 5;
            for (let i = 0; i < n; i++) {
              const u = (i + 0.5) / n;
              ctx.dbox(mx + q[0] * reach * u, y + gyH * (1 - u) + 0.25, mz + q[1] * reach * u,
                Math.max(barT, Math.abs(q[0]) * reach / n + barT), gyH / n + barT,
                Math.max(barT, Math.abs(q[1]) * reach / n + barT), steel);
            }
          }
        }

        // a small crane arm off the gantry: mast, horizontal jib, stepped stay
        {
          const cx2 = gx, cz2 = gz + gd / 2 + legT * 2;
          const ch = Math.max(FH * 0.45, Math.min(FH * 1.1, legH * 1.7));
          ctx.dbox(cx2, y + ch / 2, cz2, legT * 1.4, ch, legT * 1.4, frame);
          const jib = Math.min(R.w * 0.26, Math.max(2.2, R.base * 0.22));
          const jx = -sgx;                       // the jib points off the roof edge
          ctx.dbox(cx2 + jx * jib / 2, y + ch, cz2, jib, legT * 1.1, legT * 1.1, frame);
          for (let i = 0; i < 5; i++) {          // the stay, stepped
            const u = (i + 0.5) / 5;
            ctx.dbox(cx2 + jx * jib * u, y + ch * 0.55 + (ch * 0.45) * (1 - u), cz2,
              jib / 5 + barT, ch * 0.45 / 5 + barT, barT, steel);
          }
          ctx.dbox(cx2 + jx * jib * 0.92, y + ch - Math.max(0.6, ch * 0.22), cz2,
            barT, Math.max(0.6, ch * 0.22), barT, steel);   // the hoist line
        }
      }
    },
  });
})();
