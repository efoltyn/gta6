/* ============================================================
   city/facades/romanvilla.js — "Roman Villa": the patrician villa urbana.

   WHAT IS BEING MODELLED. Not a temple and not a hacienda: the Roman country
   house pulled into town — travertine, lime render, terracotta. A villa is
   recognised before any detail is, because its whole argument is HORIZONTAL:
   it is long, it is low, it is arcaded, and it wears a tiled hat two sizes too
   big for it. Every element below exists to state one of those four facts, and
   every dimension is solved from ctx.w / ctx.d / ctx.storeys / ctx.FH /
   ctx.rTop or a face span so an 11 m cottage and a 22 m block both read.

   WHY EACH ELEMENT IS HERE.
     PLINTH      a cut-stone base course the render stands on. A stuccoed wall
                 that runs into the ground looks like a tent; a villa is
                 always shown standing on stone. It lives entirely inside the
                 host's own sill zone, and it steps aside at the doorway.
     LOGGIA      THE SIGNATURE. A real covered walk — piers on a stylobate,
                 round arches between them, one continuous impost line — that
                 wraps the entrance face and at least one flank. It stands on
                 its own podium a metre and a half OUT from the wall, so it is
                 a freestanding screen: you look THROUGH the arches at the
                 host building's own window band, which is the whole point.
                 The arches are semicircular wherever the storey height allows
                 it; the ring is travertine, the spandrel is render, and a
                 dark soffit ring on the arcade's inner face puts real shadow
                 in every arch head. On the door face the centre bay is
                 widened until BOTH its piers clear F.clearsDoor — the doorway
                 sets that width, not taste — and its bigger arch is allowed
                 to break up through the architrave, which is exactly how a
                 villa announces its entrance.
     RENDER      ochre lime plaster over the whole wall, laid only where the
                 wall is actually solid: a band in each storey's sill zone, a
                 band in its head zone, and PIERS between the windows. The
                 piers are verticals, so they may cross the host's glass — and
                 they must, because that is what turns one continuous ribbon
                 into a row of separate punched openings.
     ARCHED      every window that is not behind the loggia gets a round head
     HEADS       drawn ENTIRELY in the solid band above the glass: a dark void
                 with a travertine archivolt, springing off an impost. The
                 attic storey has only the 0.45 m header band to work in, so
                 its heads are small — which is what a villa's upper windows
                 are anyway.
     CORNICE     modillion brackets under a bed mould, a deep soffit and a
                 fascia. The eave overhangs far enough to cover the loggia
                 below it, which is why the loggia depth is clamped against
                 it: on a Mediterranean house the roof shelters the walk.
     PANTILES    a LOW hipped roof of stepped terracotta courses with hip ribs
                 on the four diagonals, a heavy eave course, and a run of
                 half-round rolls along the lip. Its colour is the strongest
                 in the palette and its shape is the silhouette. Hence
                 crownsRoof.
     COMPLUVIUM  the roof does not close: the courses stop short and leave a
                 rectangular opening over the middle of the house, ringed by a
                 low parapet with a travertine coping, urns on the four
                 corners and a pergola along one side. From the street it is a
                 villa's top line; from the roof it is a terrace, and it is
                 the host's own walkable roof deck, so nothing is taken away
                 from rooftop gameplay.

   COLOUR. Ochre render, travertine trim a little LIGHTER than the render,
   terracotta clearly darker than both, and a near-black warm shade for every
   arch head. The host colour is mixed in only enough to keep the villa in its
   district; stone.js's header explains why mixing hard to white flattens a
   facade whose whole subject is shadow.

   COST. Everything is ctx.dbox except four urn bowls (ctx.ball). Bay counts,
   arch courses and tile rolls are all capped against the face span.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // A band on one face emitted in SEGMENTS around a list of [t0,t1] holes —
  // stone.js's trick, plus an `inset` so a band can also run out at the
  // loggia's own plane. You never cut a hole in a merged axis-aligned box; you
  // decline to draw over it.
  function runBand(ctx, F, f, cy, h, proj, col, holes, over, inset) {
    const L = -f.span / 2 - (over == null ? 0.12 : over), R = -L;
    let x = L;
    const hs = (holes || []).slice().sort(function (a, b) { return a[0] - b[0]; });
    for (let i = 0; i < hs.length; i++) {
      const a = Math.max(L, hs[i][0]), b = Math.min(R, hs[i][1]);
      if (b <= x) continue;
      if (a - x > 0.05) F.box(ctx, f, (x + a) / 2, cy, a - x, h, proj, col, inset);
      x = b;
    }
    if (R - x > 0.05) F.box(ctx, f, (x + R) / 2, cy, R - x, h, proj, col, inset);
  }

  CBZ.registerFacade("romanvilla", {
    label: "Roman Villa",
    crownsRoof: true,
    // A villa is a horizontal building. Three storeys is already a tall one;
    // past that the grammar would be a mansion block wearing a villa's hat, so
    // the city-wide auto-picker is told not to. An explicit {dress:{style}} at
    // a call site is still obeyed, and everything below re-proportions for it.
    maxStoreys: 3,
    build: function (ctx, F, spec) {
      spec = spec || {};
      const W = ctx.w, D = ctx.d, FH = ctx.FH, H = ctx.rTop;
      const ST = Math.max(1, ctx.storeys | 0);
      const small = Math.min(W, D);
      const rnd = function (s) { return ctx.hash(s); };
      const e = F.entrance(ctx);
      const faces = F.faces(ctx);

      // ============================================================
      //  1. PALETTE — travertine, ochre render, terracotta
      // ============================================================
      // The host shell arrives grey-beige; a timid mix comes back as pale
      // nothing (adobe.js learned this on its first render), so the render is
      // dragged most of the way to ochre and the tile most of the way to
      // burnt earth. Trim is LIGHTER than the wall, roof clearly darker.
      const base = (ctx.pal && ctx.pal.wall) || ctx.color;
      const STUC = F.shade(F.mix(base, 0xc9a163, 0.84), 0.93 + rnd(0x7201) * 0.10);
      const STUCD = F.shade(STUC, 0.82);
      const TRAV = F.mix(0xdfd2b2, base, 0.14);
      const TRAVD = F.shade(TRAV, 0.86);
      const TILE = F.shade(F.mix(base, 0xa4522b, 0.90), 0.86);
      const TILEL = F.mix(TILE, 0xd08a55, 0.30);
      const TILED = F.shade(TILE, 0.70);
      const GLOOM = F.mix(0x15181b, STUC, 0.10);   // arch heads, loggia shade

      // ============================================================
      //  2. THE RULING DIMENSIONS
      // ============================================================
      const PJ = clamp(small * 0.028, 0.16, 0.40);       // render relief depth
      const plinthH = clamp(FH * 0.14, 0.28, 0.46);      // stays under the 0.55 sill
      const podH = clamp(plinthH * 0.58, 0.18, 0.32);    // podium: under STEP_UP
      const EO = clamp(small * 0.17, 0.85, 1.95);        // eave overhang
      // The loggia is never deeper than the eave that shelters it. That single
      // clamp is why this facade needs no lean-to roof over the arcade: the
      // main eave IS the loggia's roof, which is the Mediterranean answer.
      const LD = Math.min(clamp(small * 0.19, 1.20, 2.60), EO * 0.94);
      const PD = LD + 0.20;                              // podium projection
      const AT = clamp(LD * 0.42, 0.40, 0.80);           // arcade screen thickness
      const pierW = clamp(LD * 0.40, 0.42, 0.95);
      const rH = clamp(small * 0.135, 0.85, 2.05);       // roof rise — LOW
      const inRun = clamp(small * 0.20, 1.10, 3.20);     // ridge inset = compluvium
      const nLog = (ST >= 3) ? 2 : 1;                    // superimposed loggias

      // WHICH FACES ARE ARCADED. The entrance always, one flank by position
      // hash, both flanks once the plan is wide enough to carry a U. The face
      // opposite the door is the service wall and never gets one.
      const adj = (ctx.doorSide === 0 || ctx.doorSide === 1) ? [2, 3] : [0, 1];
      const arc = [false, false, false, false];
      arc[ctx.doorSide] = true;
      arc[adj[rnd(0x7211) < 0.5 ? 0 : 1]] = true;
      if (small >= 12.0) { arc[adj[0]] = true; arc[adj[1]] = true; }
      // the two faces meeting this one at its -t and +t ends
      function ends(f) { return f.horiz ? [2, 3] : [0, 1]; }
      // a box at the loggia's own plane: `outAt` is the distance from the wall
      // to its OUTER face, which is how every arcade member is dimensioned.
      function lob(f, t, cy, len, hh, dep, outAt, col) {
        F.box(ctx, f, t, cy, len, hh, dep, col, outAt - dep);
      }
      const doorHole = [-(e.gap / 2 + 0.5), e.gap / 2 + 0.5];

      // ============================================================
      //  3. THE TIERS — solved BACKWARDS from the roofline
      // ============================================================
      // Each loggia tier is capped by the floor line above it. The TOP tier of
      // a building whose loggia reaches the wall head is capped by the eave
      // instead, which buys it most of a metre of extra arcade.
      function tierOf(k) {
        const tt = (k + 1) * FH;
        const underEave = (tt >= H - 0.05);
        const entH = clamp(FH * 0.12, 0.28, 0.44);
        const entTop = underEave ? (H - 0.14) : (tt - 0.42);
        return { k: k, tt: tt, underEave: underEave, entH: entH, entTop: entTop,
          archTop: entTop - entH - 0.04,
          // how high an arch crown may go: into the architrave if it must, but
          // never into the deck above or through the wall head.
          maxCrown: underEave ? (entTop - 0.08) : (tt - 0.48),
          wl: (k === 0) ? podH : (k * FH + 0.10) };
      }
      const T0 = tierOf(0);
      // the arch proportion we WANT, from the height we actually have
      const wantPitch = clamp((T0.archTop - T0.wl) / 1.40, 1.10, 2.60) + pierW;

      // THE BAY LAYOUT of one arcaded face. Computed once and shared by every
      // tier, so a two-storey loggia stacks pier on pier.
      function layout(f) {
        const margin = clamp(pierW * 0.5 + 0.24, 0.46, 1.20);
        const usable = f.span - margin * 2;
        if (usable < wantPitch + pierW) return null;
        const out = { usable: usable, lines: [], c0: 0, c1: 0, centre: false };
        if (f.s === ctx.doorSide) {
          // THE CENTRE BAY straddles the door, and its width is dictated: both
          // of its piers have to clear F.clearsDoor or one of them stands in
          // the doorway. Everything either side divides into ordinary bays.
          const cw = Math.min(Math.max(wantPitch, e.gap + pierW + 0.34),
            usable - 2 * (pierW + 0.80));
          if (cw >= wantPitch * 0.85) {
            const side = (usable - cw) / 2;
            const ns = clamp(Math.round(side / wantPitch), 1, 4);
            for (let i = 0; i <= ns; i++) out.lines.push(-usable / 2 + i * (side / ns));
            for (let i = ns; i >= 0; i--) out.lines.push(usable / 2 - i * (side / ns));
            out.c0 = -cw / 2; out.c1 = cw / 2; out.centre = true;
            return out;
          }
        }
        const n = clamp(Math.round(usable / wantPitch), 2, 8);
        for (let i = 0; i <= n; i++) out.lines.push(-usable / 2 + i * (usable / n));
        return out;
      }
      const lay = [null, null, null, null];
      for (const f of faces) if (arc[f.s]) lay[f.s] = layout(f);

      // THE SPRINGING LINE, one per tier and shared by every arcaded face, so
      // the arcade turns the corner as ONE line of imposts. It is set by the
      // widest ORDINARY bay — whose crown then lands on archTop — and then
      // dropped, if it must, until the wide centre arch also fits under
      // maxCrown as a true semicircle rather than a flattened one.
      function springOf(T) {
        let sideR = 0, ctrR = 0;
        for (const f of faces) {
          const L = lay[f.s];
          if (!L) continue;
          for (let i = 0; i + 1 < L.lines.length; i++) {
            const c = (L.lines[i + 1] - L.lines[i] - pierW) / 2;
            const isC = L.centre && L.lines[i] <= L.c0 + 0.01 && L.lines[i + 1] >= L.c1 - 0.01;
            if (isC) { if (c > ctrR) ctrR = c; } else if (c > sideR) sideR = c;
          }
        }
        if (sideR <= 0) sideR = ctrR;
        let y = T.archTop - sideR;
        if (ctrR > 0) y = Math.min(y, T.maxCrown - ctrR);
        return clamp(y, T.wl + 0.55, T.archTop - 0.28);
      }

      // ============================================================
      //  4. THE PLINTH and the corner pilasters
      // ============================================================
      // Both live in the host's solid sill zone (0 … 0.55); the plinth steps
      // aside at the doorway so the threshold is clean.
      for (const f of faces) {
        const holes = (f.s === ctx.doorSide) ? [doorHole] : [];
        runBand(ctx, F, f, plinthH / 2, plinthH, PJ + 0.14, TRAVD, holes, 0.34);
        runBand(ctx, F, f, plinthH + 0.03, 0.14, PJ + 0.24, TRAV, holes, 0.40);
      }
      // corner pilasters: VERTICALS, so they may run the full height. They are
      // what ties four rendered walls into one block.
      F.corners(ctx, H / 2, H - 0.1, clamp(small * 0.055, 0.44, 1.00), PJ + 0.05, TRAV);

      // ============================================================
      //  5. THE RENDERED WALL — sill band, piers, round-arched heads
      // ============================================================
      function wallStorey(f, k) {
        const sy = k * FH;
        const gTop = (k + 1) * FH - 0.45;            // the host's glass head
        const isTop = (k === ST - 1);
        // THE HEAD IS DRAWN ONLY IN THE WALL'S OWN SOLID BAND — from the glass
        // head up to 0.45 into the storey above, one metre in all, of which the
        // impost and the string course above take 0.28. Hence a 0.72 ceiling on
        // the rise. The TOP storey has only its 0.45 m header to work in.
        const rise = clamp(isTop ? (H - gTop - 0.20) : 0.72, 0.18, 0.72);
        // A semicircle wherever the head room allows one. It does not on the
        // attic, where a window as narrow as 2*rise would be a slit — the host
        // glazes a full 2.2 m of storey and nothing may cover that — so the
        // attic keeps a sane opening and takes a segmental head instead.
        const winW = Math.max(rise * 2, clamp(FH * 0.34, 0.95, 1.45));
        const segH = winW > rise * 2 + 0.02;
        const step = winW + clamp(winW * 0.62, 0.55, 1.20);
        const nb = clamp(Math.round((f.span - 1.3) / step), 2, 7);
        const bays = F.bays(f, nb, clamp(f.span * 0.06 + 0.55, 0.62, 1.40));
        const holes = (f.s === ctx.doorSide && sy < e.head) ? [doorHole] : [];

        // the render, in the two solid zones only
        if (k > 0) runBand(ctx, F, f, sy + 0.27, 0.50, PJ, STUC, holes, 0.18);
        runBand(ctx, F, f, gTop + (rise + 0.20) / 2, rise + 0.20, PJ, STUC, holes, 0.18);
        // the floor line: a travertine string course capping the head band
        runBand(ctx, F, f, gTop + rise + 0.16, 0.16, PJ + 0.12, TRAV, holes, 0.34);

        for (const b of bays) {
          const t = b.t;
          if (sy < e.head && !F.clearsDoor(ctx, f, t, winW + 1.2)) continue;
          const pw = Math.max(0.24, (b.w - winW) / 2);
          for (const sg of [-1, 1]) {
            // the pier between two windows. A VERTICAL crossing the host's
            // glass is exactly how the ribbon becomes separate openings.
            F.rib(ctx, f, t + sg * (winW / 2 + pw / 2), sy + 0.04, sy + FH - 0.02, pw + 0.02, PJ, STUC);
            F.rib(ctx, f, t + sg * (winW / 2 + 0.09), sy + 0.34, gTop + 0.02, 0.18, PJ + 0.07, TRAV);
          }
          // sill (inside the sill zone). The ground storey already has the
          // plinth cap doing that job.
          if (k > 0) F.box(ctx, f, t, sy + 0.40, winW + 0.46, 0.18, PJ + 0.16, TRAV);
          // THE ARCHED HEAD: impost, dark void, travertine archivolt — all of
          // it above gTop, so not one course of it lies over the glass.
          F.box(ctx, f, t, gTop + 0.07, winW + 0.52, 0.14, PJ + 0.12, TRAV);
          const st = rise > 0.5 ? 4 : 3;
          for (let j = 0; j < st; j++) {
            const u = (j + 0.5) / st;
            const vh = (winW / 2) * Math.sqrt(Math.max(0, 1 - u * u * (segH ? 0.58 : 1)));
            const cy = gTop + 0.14 + u * rise, ch = rise / st + 0.04;
            F.box(ctx, f, t, cy, vh * 2, ch, PJ + 0.02, GLOOM);
            for (const sg of [-1, 1])
              F.box(ctx, f, t + sg * (vh + 0.11), cy, 0.22, ch, PJ + 0.12, TRAV);
          }
        }
      }
      for (const f of faces) {
        for (let k = 0; k < ST; k++) {
          if (arc[f.s] && k < nLog) continue;         // the loggia owns that storey
          wallStorey(f, k);
        }
      }
      // the shaded back wall of the loggia, inside the storey's header band —
      // the depth cue that makes the arcade read as a walk and not a relief.
      for (const f of faces) {
        if (!arc[f.s]) continue;
        for (let k = 0; k < nLog; k++) {
          const holes = (f.s === ctx.doorSide && k * FH < e.head) ? [doorHole] : [];
          runBand(ctx, F, f, (k + 1) * FH - 0.24, 0.40, PJ * 0.6, GLOOM, holes, 0.10);
        }
      }
      // the doorway's own jambs. No lintel: nothing of this facade's is
      // allowed to hang across the opening below e.head, and on a house that
      // head is taller than the storey — the loggia's centre arch, standing a
      // metre and a half clear of the wall, is what gives the door its head.
      for (const sg of [-1, 1]) {
        F.rib(ctx, e.f, sg * (e.gap / 2 + 0.28), 0.05, Math.min(FH - 0.5, e.head), 0.56, PJ + 0.16, TRAV);
      }

      // ============================================================
      //  6. THE PODIUM — the stylobate the loggia stands on
      // ============================================================
      // One step high, well under physics STEP_UP, registered with ctx.plat so
      // the whole covered walk is genuinely walkable, and carried around the
      // corner wherever the next face is arcaded too.
      for (const f of faces) {
        if (!arc[f.s]) continue;
        const nb = ends(f);
        const eNeg = arc[nb[0]] ? PD : 0.12, ePos = arc[nb[1]] ? PD : 0.12;
        const len = f.span + eNeg + ePos, tc = (ePos - eNeg) / 2;
        F.box(ctx, f, tc, podH / 2, len, podH, PD, TRAVD, 0);
        F.box(ctx, f, tc, podH - 0.04, len + 0.10, 0.10, PD + 0.06, TRAV, 0);
        const hn = f.halfN;
        if (f.horiz) {
          const z0 = f.out > 0 ? hn : -(hn + PD), z1 = f.out > 0 ? hn + PD : -hn;
          ctx.plat(tc - len / 2, tc + len / 2, z0, z1, podH, null);
        } else {
          const x0 = f.out > 0 ? hn : -(hn + PD), x1 = f.out > 0 ? hn + PD : -hn;
          ctx.plat(x0, x1, tc - len / 2, tc + len / 2, podH, null);
        }
      }
      // one broad tread out of the street, half the podium's rise, with a ramp
      // under it so a sprinting player is never stopped by the lip.
      if (!e.driveIn) {
        const df = e.f, hn = df.halfN;
        const sd = clamp(LD * 0.50, 0.50, 1.10), sh = podH * 0.55;
        const sw = Math.min(df.span - 0.6, e.gap + Math.max(2.4, df.span * 0.30));
        F.box(ctx, df, 0, sh / 2, sw, sh, sd, TRAV, PD);
        const o0 = hn + PD, o1 = hn + PD + sd;
        if (df.horiz) {
          const z0 = df.out * o0, z1 = df.out * o1;
          ctx.plat(-sw / 2, sw / 2, Math.min(z0, z1), Math.max(z0, z1), sh,
            { z0: ctx.oz + z1, z1: ctx.oz + z0, y0: 0, y1: sh });
        } else {
          const x0 = df.out * o0, x1 = df.out * o1;
          ctx.plat(Math.min(x0, x1), Math.max(x0, x1), -sw / 2, sw / 2, sh,
            { axis: "x", x0: ctx.ox + x1, x1: ctx.ox + x0, y0: 0, y1: sh });
        }
      }

      // ============================================================
      //  7. THE LOGGIA — round arches carried on piers
      // ============================================================
      function arcade(f, T, L, springY) {
        // A pier that would stand in the doorway is DROPPED, never nudged: the
        // two bays it separated merge into one wider arch, which reads as an
        // intercolumniation instead of as a mistake.
        const lines = [];
        for (let i = 0; i < L.lines.length; i++)
          if (F.clearsDoor(ctx, f, L.lines[i], pierW)) lines.push(L.lines[i]);
        if (lines.length < 2) return;
        const ey = T.entTop - T.entH;                 // underside of the architrave
        const holes = [];

        for (let i = 0; i < lines.length; i++) {
          const t = lines[i];
          const wide = (i === 0 || i === lines.length - 1)
            || (L.centre && (Math.abs(t - L.c0) < 0.01 || Math.abs(t - L.c1) < 0.01));
          const pw = pierW * (wide ? 1.35 : 1.0);
          // plinth, shaft, impost. The impost block is the detail that says an
          // arch lands here rather than that a wall has a hole in it.
          lob(f, t, (T.wl + springY) / 2, pw, springY - T.wl, AT, LD, TRAV);
          lob(f, t, T.wl + 0.11, pw + 0.24, 0.22, AT + 0.09, LD + 0.05, TRAV);
          lob(f, t, springY - 0.10, pw + 0.30, 0.20, AT + 0.11, LD + 0.06, TRAVD);
        }

        for (let i = 0; i + 1 < lines.length; i++) {
          const t0 = lines[i], t1 = lines[i + 1];
          const tc = (t0 + t1) / 2, clear = t1 - t0 - pierW;
          if (clear < 0.5) continue;
          const isC = L.centre && t0 <= L.c0 + 0.01 && t1 >= L.c1 - 0.01;
          const rise = Math.min(clear / 2, T.maxCrown - springY);
          if (rise < 0.22) continue;
          // only where the storey simply has no room does the arch flatten to
          // a segment; everywhere else rise = half the span, i.e. a semicircle.
          const seg = rise < clear / 2 - 0.03;
          const st = clamp(Math.round(rise / 0.24), 4, 7);
          const vt = clamp(clear * 0.10, 0.16, 0.34);          // voussoir depth
          for (let j = 0; j < st; j++) {
            const u = (j + 0.5) / st;
            const frac = seg ? Math.sqrt(Math.max(0, 1 - u * u * 0.58))
              : Math.sqrt(Math.max(0, 1 - u * u));
            const vh = clear / 2 * frac;                       // half the void here
            const cy = springY + u * rise, ch = rise / st + 0.04;
            for (const sg of [-1, 1]) {
              lob(f, tc + sg * (vh + vt / 2), cy, vt, ch, AT + 0.08, LD + 0.04, TRAV);
              // the spandrel behind the ring is render, but a shade down: it
              // sits under the eave and an arcade whose spandrels are as
              // bright as the wall stops reading as a deep screen.
              const sw = (clear / 2 + pierW * 0.55) - (vh + vt);
              if (sw > 0.06) lob(f, tc + sg * (vh + vt + sw / 2), cy, sw + 0.02, ch, AT, LD, STUCD);
              // the intrados, on the arcade's INNER face and in shade. This is
              // the dark that makes an arch head read as a hole in a thick
              // screen instead of as a ring painted on a flat one.
              lob(f, tc + sg * (vh - 0.04), cy, 0.20, ch, AT * 0.45, LD - AT * 0.55, GLOOM);
            }
          }
          lob(f, tc, springY + rise + 0.04, clamp(clear * 0.16, 0.24, 0.52), 0.34,
            AT + 0.15, LD + 0.10, TRAV);                       // keystone
          const above = ey - (springY + rise + 0.14);
          if (above > 0.08)
            lob(f, tc, (springY + rise + 0.14 + ey) / 2, clear + pierW * 0.9, above, AT, LD, STUCD);
          // the centre arch is allowed to break up through the architrave, so
          // the architrave runs in segments around it.
          if (isC && springY + rise + 0.06 > ey) holes.push([t0 - 0.10, t1 + 0.10]);
        }

        // THE ARCHITRAVE over the arcade, and the fillet that terminates it.
        runBand(ctx, F, f, ey + T.entH * 0.34, T.entH * 0.68, AT + 0.10, TRAV, holes, 0.10,
          LD + 0.04 - (AT + 0.10));
        runBand(ctx, F, f, T.entTop - 0.09, 0.20, AT + 0.26, TRAVD, holes, 0.16,
          LD + 0.10 - (AT + 0.26));

        // A tier that is NOT under the eave carries a deck: the floor of the
        // loggia above it, or a terrace if there is none. Its inner edge lands
        // in the wall's own solid floor band, never on glass.
        if (!T.underEave) {
          const nb = ends(f);
          const eNeg = arc[nb[0]] ? LD : 0.10, ePos = arc[nb[1]] ? LD : 0.10;
          const len = f.span + eNeg + ePos, tc = (ePos - eNeg) / 2;
          F.box(ctx, f, tc, T.tt - 0.16, len, 0.52, LD + 0.10, TRAVD, 0);
          F.box(ctx, f, tc, T.tt + 0.13, len + 0.12, 0.10, LD + 0.16, TRAV, 0);
          // the balustrade: dado, balusters on a spacing the bay chooses, rail
          const bh = clamp(FH * 0.26, 0.62, 0.95), by = T.tt + 0.18;
          const oa = LD + 0.06;
          F.box(ctx, f, tc, by + 0.09, len, 0.18, 0.26, TRAV, oa - 0.26);
          F.box(ctx, f, tc, by + bh, len, 0.16, 0.30, TRAV, oa - 0.30);
          for (let i = 0; i + 1 < lines.length; i++) {
            const gap = lines[i + 1] - lines[i] - pierW;
            const n = clamp(Math.round(gap / 0.46), 2, 6);
            for (let j = 0; j < n; j++) {
              const t = lines[i] + pierW / 2 + (gap / n) * (j + 0.5);
              F.box(ctx, f, t, by + bh * 0.55, (gap / n) * 0.42, bh - 0.20, 0.20, TRAV, oa - 0.22);
            }
          }
        }
      }
      for (let k = 0; k < nLog; k++) {
        const T = tierOf(k), sy = springOf(T);
        for (const f of faces) if (lay[f.s]) arcade(f, T, lay[f.s], sy);
      }

      // ============================================================
      //  8. THE BRACKETED CORNICE
      // ============================================================
      // Modillions hang in the header band and carry a soffit that flies out
      // as far as EO — far enough to roof the loggia. A shy eave here would
      // turn the whole villa back into a box with a hat on.
      for (const f of faces) {
        const pitch = clamp(FH * 0.36, 0.85, 1.35);
        const n = clamp(Math.round((f.span + 0.4) / pitch), 4, 34);
        const stp = (f.span + 0.4) / n;
        const bw = clamp(stp * 0.30, 0.16, 0.34);
        for (let i = 0; i < n; i++) {
          const t = -(f.span + 0.4) / 2 + (i + 0.5) * stp;
          F.box(ctx, f, t, H - 0.22, bw, 0.40, EO * 0.52, TRAV);
          F.box(ctx, f, t, H - 0.09, bw + 0.10, 0.18, EO * 0.68, TRAV);
        }
        F.band(ctx, f, H - 0.05, 0.16, EO * 0.34, TRAVD, 0.30);     // bed mould
        F.band(ctx, f, H + 0.07, 0.16, EO * 0.96, TRAVD, 0.36);     // soffit
        F.band(ctx, f, H + 0.22, 0.26, EO * 1.00, TRAV, 0.42);      // fascia
      }

      // ============================================================
      //  9. THE PANTILE ROOF — low, hipped, strongly overhanging
      // ============================================================
      const roofY0 = H + 0.34;
      const nT = clamp(Math.round(rH / 0.26), 4, 9);
      const radial = (EO + inRun) / nT;               // plan run per course
      for (let i = 0; i < nT; i++) {
        const outAt = EO - radial * i;                // walks inward as it rises
        const cy = roofY0 + rH * (i + 0.5) / nT, ch = rH / nT + 0.05;
        const col = (i % 3 === 1) ? TILEL : (i % 3 === 2 ? TILED : TILE);
        for (const f of faces) {
          const len = f.span + 2 * outAt + 0.05;
          if (len < 0.6) continue;
          F.box(ctx, f, 0, cy, len, ch, radial + 0.07, col, outAt - radial - 0.07);
        }
        // the hip ribs: four diagonals of heavier tile, which is the only
        // thing that tells you a stepped roof is HIPPED and not a wedding cake.
        const rb = clamp(small * 0.030, 0.22, 0.42);
        for (const sx of [-1, 1]) for (const sz of [-1, 1])
          ctx.dbox(sx * (W / 2 + outAt), cy, sz * (D / 2 + outAt), rb * 1.7, ch, rb * 1.7, TILEL);
      }
      for (const f of faces) {
        // the heavy eave course, lowest and furthest out
        F.box(ctx, f, 0, roofY0 + 0.11, f.span + 2 * (EO + 0.14) + 0.05, 0.24, 0.42, TILED,
          EO + 0.14 - 0.42);
        // PANTILE ROLLS running up the slope. This is the whole terracotta
        // read at 40 m: a rhythm, not a smooth plane.
        const rp = clamp(small * 0.038, 0.30, 0.46);
        const n = clamp(Math.round((f.span + 2 * EO) / rp), 6, 42);
        const stp = (f.span + 2 * EO) / n;
        for (let i = 0; i < n; i++) {
          F.box(ctx, f, -(f.span + 2 * EO) / 2 + (i + 0.5) * stp, roofY0 + 0.30,
            stp * 0.42, 0.16, radial * 1.5, TILEL, EO + 0.10 - radial * 1.5);
        }
        // The host builds its own parapet on the roof slab, up to ~1 m of it.
        // The roof springs above that, so a bed course straddling the wall
        // plane wraps it in tile instead of leaving a grey stub at the eaves.
        const bed = clamp(roofY0 + rH * (EO / (EO + inRun)) - H, 1.15, 2.00);
        F.box(ctx, f, 0, H + bed / 2, f.span + 0.3, bed, 0.72, TILED, -0.44);
      }

      // ============================================================
      //  10. THE COMPLUVIUM — the roof does not close
      // ============================================================
      // The courses stop inRun short of the middle and leave a rectangular
      // opening: from the street, a low parapet and urns finishing the top
      // line; from above, a terrace on the host's own walkable roof deck.
      const ridgeY = roofY0 + rH;
      const parH = clamp(rH * 0.40, 0.34, 0.62);
      const tW = W - 2 * inRun, tD = D - 2 * inRun;
      for (const f of faces) {
        const len = f.span - 2 * inRun;
        if (len < 1.2) continue;
        F.box(ctx, f, 0, ridgeY + parH / 2, len + 0.52, parH, 0.44, STUC, -inRun - 0.22);
        F.box(ctx, f, 0, ridgeY + parH + 0.09, len + 0.74, 0.18, 0.62, TRAV, -inRun - 0.31);
      }
      // the paving, laid on the solid part of the host's roof slab only, so it
      // never floats over the stairwell void
      {
        const R = F.roof(ctx);
        if (tW > 1.6 && tD > 1.6)
          ctx.dbox(R.cx, H - 0.05, R.cz, Math.min(tW - 0.2, R.w), 0.10,
            Math.min(tD - 0.2, R.d), TRAVD);
      }
      // URNS on the four corners of the coping — the only real meshes on the
      // whole villa, four of them, well inside the ~40 budget.
      {
        const ur = clamp(small * 0.030, 0.20, 0.34), uy = ridgeY + parH + 0.18;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const ux = sx * (W / 2 - inRun), uz = sz * (D / 2 - inRun);
          ctx.dbox(ux, uy + 0.14, uz, ur * 2.3, 0.28, ur * 2.3, TRAV);
          ctx.ball(ux, uy + 0.30 + ur, uz, ur, TRAV);
          ctx.dbox(ux, uy + 0.36 + ur * 2, uz, ur * 0.9, ur * 0.8, ur * 0.9, TRAV);
        }
      }
      // THE PERGOLA on the terrace: two rows of posts, a beam over each and a
      // run of rafters across. It stands on the +x side, away from the host's
      // roof stairwell (which lives at -x), and its rafters ride just above
      // the coping so the trellis is part of the silhouette from the street.
      if (tW > 3.2 && tD > 2.6) {
        const postH = clamp(ridgeY + parH - H + 0.12, 1.90, 2.90);
        const px0 = W / 2 - inRun - 0.50, px1 = px0 - clamp(tW * 0.30, 1.00, 1.80);
        const zs = tD - 0.9, ps = clamp(small * 0.022, 0.14, 0.22);
        const n = clamp(Math.round(zs / 1.9), 2, 5);
        for (let i = 0; i <= n; i++) {
          const z = -zs / 2 + (zs / n) * i;
          for (const px of [px0, px1]) ctx.dbox(px, H + postH / 2, z, ps * 2, postH, ps * 2, TRAV);
        }
        for (const px of [px0, px1])
          ctx.dbox(px, H + postH + 0.10, 0, ps * 2.2, 0.20, zs + 0.5, TRAV);
        const nr = clamp(Math.round(zs / 0.6), 3, 14);
        for (let i = 0; i <= nr; i++) {
          ctx.dbox((px0 + px1) / 2, H + postH + 0.28, -zs / 2 + (zs / nr) * i,
            Math.abs(px0 - px1) + 0.5, 0.12, 0.14, TRAVD);
        }
      }
    },
  });
})();
