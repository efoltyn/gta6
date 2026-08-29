/* ============================================================
   city/facades/pyramid.js — "Tapered Spire": the Transamerica idea.

   THE READ. This is the one tower in the kit whose identity is pure massing.
   You do not recognise a tapered spire by its surface, you recognise it as a
   triangle on the skyline, and everything in this file is in service of that
   triangle staying legible from a kilometre and still being a real street
   wall from a metre.

   THE THREE BANDS OF THE ELEVATION
     FLARED BASE (bottom ~3 storeys). The mass does not meet the ground, it is
       carried on a splayed colonnade: heavy piers that step OUTWARD as they
       descend, so the taper's widest course is the pavement itself. The
       lobby is dark glass set well back behind them, which makes the bottom
       15 m an arcade a player walks through rather than a painted plinth.
       The doorway is never piered over - a pier that would foul it is simply
       omitted, and the deep soffit that lands on the piers sits far above
       the door head.
     THE TAPERING SHAFT. The host shell is a straight-sided box, so the batter
       is built as cladding that stands PROUD of the shell and gets thinner
       every storey until it dies at the roofline. One band per storey means
       the step is a fifth of a metre on a 40 storey subject: the profile
       reads as a continuous lean, not as a ziggurat, which is the whole
       difference between this grammar and a setback tower.
     THE SPIRE. Above the roofline the taper continues as real volumes and it
       is BLIND - no glass at all for the top third of the total height. That
       blindness is what makes the shape read as a pyramid instead of as a
       tapered office block. Its profile is a mostly-straight line with a
       quadratic tail, so it closes to a real point instead of the bullet
       nose the first render came back with. A 34 m wide shell 128 m tall
       cannot hold one continuous Transamerica slope from pavement to tip, so
       the change of rate is DECLARED at the shoulder as a louvred mechanical
       floor with a heavy cornice - exactly where the service wings die -
       rather than left looking like an accident. A slim mast and two aircraft
       beacons finish it. Roughly a third of the total height is blind.

   THE SERVICE WINGS. Two blind vertical shafts break out of opposite flanks.
   They are the lift bank and the fire stair, which is genuinely why they
   exist on the real building - the plan of a tapering tower loses floor area
   every storey, so the cores get pushed out of it. They start partway up,
   stand clearly proud of the leaning face, and terminate at DIFFERENT heights
   below the spire. Without them the silhouette is a plain cone; with them it
   is unmistakable.

   WINDOWS are deliberately cheap and small: one recessed band per storey with
   a projecting sill line and thin mullions, because at 2.5 percent of the
   elevation per floor the massing is doing all the work and per-storey
   ornament is a triangle bill you cannot see.

   COLOUR is pale precast quartz-concrete, anchored to real mid values rather
   than derived by lightening the host - this renderer clips above about 0x99
   and a white-on-white tower loses every reveal. The spire is a shade darker
   than the shaft so the blind top separates from it against the sky.

   BUDGET. Everything is ctx.dbox (merged, free) except two ctx.lamp beacons -
   two real meshes against a ceiling of forty. About 70 merged boxes per storey
   on the 40 storey subject, which is well inside the sheet's budget.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("pyramid", {
    label: "Tapered Spire",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — a tapered spire is a reinforced concrete core.
    structure: "concrete",
    crownsRoof: true,
    minStoreys: 16,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, H = ctx.rTop, ST = ctx.storeys;
      const smallest = Math.min(ctx.w, ctx.d);
      const faces = F.faces(ctx);
      const ent = F.entrance(ctx);

      // ---------------- palette ----------------
      // Warm pale precast, anchored (not derived by lightening the host) with
      // only a whisper of the host colour so a street of these is not four
      // different buildings.
      // MEASURED, not guessed: the first render came back paper white from top
      // to bottom, every course and every window lost. This renderer clips
      // above about 0x99, so the wall is anchored near 0x7c and the whole
      // remaining range is spent on relief and on glass.
      const CLAD = F.mix(0x6d6a62, ctx.color | 0, 0.12);
      const LIT = F.shade(CLAD, 1.26);      // top lips, sills catching sun
      const MID = F.shade(CLAD, 0.74);      // course shading
      const DARK = F.shade(CLAD, 0.42);     // soffits, reveals
      const GLASS = F.mix(0x141920, CLAD, 0.05);
      const SPIRE = F.shade(CLAD, 0.88);
      const SPIRE_D = F.shade(CLAD, 0.58);

      // ---------------- the taper ----------------
      // FL is how far the cladding stands proud of the shell at ground level,
      // per side; it dies linearly to nothing at the roofline. Everything
      // about the profile comes out of this one number.
      // The per-storey STEP is what has to stay small: FL/storeys is the ledge
      // each course leaves, and the 14-storey render showed that a batter tied
      // only to the plan turns into a wedding cake on a short tower. Tying it
      // to the height as well keeps that ledge near 0.18 m at every storey
      // count, which is the difference between a slope and a ziggurat.
      const FL = Math.max(1.0, Math.min(smallest * 0.26, H * 0.055));
      function proj(y) {
        const p = FL * (1 - Math.max(0, Math.min(1, y / H)));
        return Math.max(0.06, p);
      }

      // the flared base occupies the bottom storeys; the shaft cladding starts
      // above it, and the top storey stays blind as the shaft's own transition.
      const nBase = ST >= 24 ? 3 : 2;
      const yBase = nBase * FH;
      const kTop = ST - 2;                 // last glazed storey

      // ================================================================
      //  1. THE FLARED BASE — an open colonnade of splayed piers
      // ================================================================
      {
        const pTop = proj(yBase);
        for (const f of faces) {
          // recessed glazed lobby on the shell plane, in bays, door left clear
          const nb = F.bayCount(f, 3.6, 3, 10);
          for (const b of F.bays(f, nb, Math.max(0.7, f.span * 0.05))) {
            if (!F.clearsDoor(ctx, f, b.t, b.w)) continue;
            F.box(ctx, f, b.t, yBase * 0.50, b.w * 0.88, yBase * 0.70, 0.07, GLASS);
            F.box(ctx, f, b.t, yBase * 0.10, b.w * 0.92, yBase * 0.12, 0.12, DARK);
          }
          // the piers: four stacked segments, each stepping further out as it
          // goes DOWN, so the colonnade is the bottom of the batter.
          const np = Math.max(2, Math.min(7, Math.round(f.span / 6.0)));
          const lines = F.bayLines(f, np, Math.max(0.6, f.span * 0.05));
          const pw = Math.max(1.3, Math.min(f.span * 0.13, FH * 0.85));
          for (const t of lines) {
            if (!F.clearsDoor(ctx, f, t, pw + 1.0)) continue;
            const segs = 4;
            for (let s = 0; s < segs; s++) {
              const y0 = (s * yBase) / segs, y1 = ((s + 1) * yBase) / segs;
              const pr = pTop + (FL - pTop) * (1 - (s + 0.5) / segs);
              F.box(ctx, f, t, (y0 + y1) / 2, pw, y1 - y0 + 0.02, pr, s % 2 ? MID : CLAD);
              // the outer arris of each lift, so the pier reads as a solid prism
              F.box(ctx, f, t, y1 - 0.06, pw + 0.16, 0.12, pr * 1.01, DARK);
            }
          }
          // the soffit the piers carry: a deep dark lid with a lit lip. This is
          // the line that says "the mass starts here".
          F.band(ctx, f, yBase - 0.28, 0.56, pTop * 1.06, DARK, 2 * pTop + 0.2);
          F.band(ctx, f, yBase + 0.16, 0.30, pTop * 1.02, LIT, 2 * pTop + 0.1);
        }
      }

      // ================================================================
      //  2. THE TAPERING SHAFT — one cladding band per storey
      // ================================================================
      // Each band is four face slabs whose length is the face span plus twice
      // its own projection, so the four bands close on each other at the
      // corners and the storey reads as one continuous stone course.
      for (let k = nBase; k < ST; k++) {
        const y0 = k * FH, y1 = (k + 1) * FH;
        const cy = (y0 + y1) / 2;
        const p = proj(cy);
        const glazed = k <= kTop;
        for (const f of faces) {
          const L = f.span + 2 * p + 0.02;
          if (!glazed) {
            F.box(ctx, f, 0, cy, L, y1 - y0 + 0.02, p, CLAD);
            F.box(ctx, f, 0, y1 - 0.05, L + 0.12, 0.10, p * 1.02, MID);
            continue;
          }
          // THE STOREY IS BUILT AS A NOTCH, not as a wall with a dark stripe
          // painted on it. The first renders drew the cladding full height and
          // set the glass inside it, and at 128 m the window band vanished
          // completely: a recess you cannot see is a recess you did not build.
          // So the cladding is emitted as a SPANDREL and a HEADER with a real
          // gap between them, and the glass sits well behind both planes.
          const sh = (y1 - y0) * 0.42;          // spandrel under the opening
          const hh = (y1 - y0) * 0.20;          // header over it
          const wy0 = y0 + sh, wy1 = y1 - hh;
          F.box(ctx, f, 0, y0 + sh / 2, L, sh + 0.02, p, CLAD);
          F.box(ctx, f, 0, y1 - hh / 2, L, hh + 0.02, p, CLAD);
          F.box(ctx, f, 0, y1 - 0.05, L + 0.12, 0.10, p * 1.02, MID);
          // the glass, set back behind the wall plane by most of the batter
          const gp = Math.max(0.06, p * 0.30);
          const wlen = L - Math.max(1.0, f.span * 0.09);
          F.box(ctx, f, 0, (wy0 + wy1) / 2, wlen, wy1 - wy0, gp, GLASS);
          // the soffit over the glass and the projecting sill line under it -
          // the two horizontals that make the notch read as a shadow at range
          F.box(ctx, f, 0, wy1 - 0.06, wlen, 0.14, p * 0.98, DARK);
          F.box(ctx, f, 0, wy0 + 0.10, wlen + 0.5, 0.34, p * 1.10, LIT);
          F.box(ctx, f, 0, wy0 - 0.10, wlen + 0.3, 0.16, p * 1.04, DARK);
          const nm = Math.max(2, Math.min(10, Math.round(wlen / 4.6)));
          for (let i = 1; i < nm; i++) {
            F.box(ctx, f, -wlen / 2 + (i * wlen) / nm, (wy0 + wy1) / 2, 0.20, wy1 - wy0, p * 0.72, MID);
          }
        }
      }

      // ================================================================
      //  3. THE SERVICE WINGS — two blind cores on opposite flanks
      // ================================================================
      // Which pair of flanks they break out of is the only hashed choice in
      // this facade, and the two wings stop at different heights on purpose.
      const pairH = ctx.hash(0x9c11) > 0.5;               // true → the ±z faces
      const wings = pairH ? [F.face(ctx, 0), F.face(ctx, 1)] : [F.face(ctx, 2), F.face(ctx, 3)];
      const wingOut = Math.max(1.0, Math.min(smallest * 0.15, 3.6));
      const yWing0 = Math.max(yBase + FH, H * 0.16);
      for (let wi = 0; wi < wings.length; wi++) {
        const f = wings[wi];
        const wlen = Math.max(FH * 1.4, Math.min(f.span * 0.30, smallest * 0.42));
        // offset from centre, mirrored, so the pair is not a symmetrical belt
        const t = (wi === 0 ? 1 : -1) * Math.min(f.span * 0.22, (f.span - wlen) * 0.4);
        const yTop = H * (wi === 0 ? 0.94 : 0.80);
        const kA = Math.ceil(yWing0 / FH), kB = Math.floor(yTop / FH);
        for (let k = kA; k < kB; k++) {
          const cy = k * FH + FH / 2;
          const pr = proj(cy) + wingOut;
          F.box(ctx, f, t, cy, wlen, FH + 0.02, pr, wi === 0 ? CLAD : MID);
          // the two vertical arrises, shaded, so it reads as a prism not a slab
          for (const sg of [-1, 1]) {
            F.box(ctx, f, t + sg * (wlen / 2 - 0.16), cy, 0.32, FH + 0.02, pr * 1.01, sg < 0 ? MID : DARK);
          }
          // one pour line per storey - the only surface event a blind core gets
          F.box(ctx, f, t, k * FH + FH - 0.05, wlen + 0.05, 0.09, pr * 1.02, DARK);
        }
        // splayed foot, so the wing lands on the shaft instead of hovering
        const pf = proj(yWing0) + wingOut;
        F.box(ctx, f, t, yWing0 - 0.6, wlen + 0.5, 1.2, pf * 0.72, MID);
        F.box(ctx, f, t, yWing0 - 1.4, wlen + 0.9, 0.9, pf * 0.42, DARK);
        // the cap: a coping, a lit lip and a single louvre slot below it
        const pt = proj(yTop) + wingOut;
        F.box(ctx, f, t, yTop + 0.45, wlen + 0.6, 0.9, pt * 1.06, CLAD);
        F.box(ctx, f, t, yTop + 0.98, wlen + 0.8, 0.24, pt * 1.10, LIT);
        F.box(ctx, f, t, yTop - FH * 0.7, wlen * 0.5, FH * 0.44, pt * 0.95, GLASS);
      }

      // ================================================================
      //  4. THE SHOULDER — where the shaft hands over to the spire
      // ================================================================
      // The spire has to close much faster than the shaft leans (a 34 m wide
      // shell 128 m tall cannot hold one continuous Transamerica slope), so
      // the change of rate is DECLARED here as a mechanical band rather than
      // left to look like a mistake: a louvred plant floor, a heavy cornice
      // and a lit coping, exactly where the wings die.
      {
        const p = proj(H) + Math.max(0.5, smallest * 0.035);
        for (const f of faces) {
          F.band(ctx, f, H - FH * 0.55, FH * 0.62, p * 0.9, GLASS, 0.2);
          const nl = Math.max(4, Math.min(26, Math.round(f.span / 1.6)));
          for (let i = 1; i < nl; i++) {
            F.box(ctx, f, -f.span / 2 + (i * f.span) / nl, H - FH * 0.55, 0.14, FH * 0.62, p * 0.95, MID);
          }
        }
        F.ring(ctx, H - 0.12, 0.55, p * 1.10, CLAD, 0.5);
        F.ring(ctx, H + 0.28, 0.26, p * 1.18, LIT, 0.6);
        F.ring(ctx, H - 0.48, 0.18, p * 1.14, DARK, 0.5);
      }

      // ================================================================
      //  5. THE SPIRE — blind, and the reason this reads as a pyramid
      // ================================================================
      // half(u) = h0 - a*u - b*u^2, with a sized so the profile is mostly a
      // straight line and the quadratic term only closes the last of it to a
      // point. Emitted as solid stacked volumes (one box per lift) because
      // above the roofline there is no shell left to clad.
      // Tall enough to be a spire and never so steep it turns into a coarse
      // stack: on a stubby subject the plan half-width, not the shaft height,
      // is what the cone has to close, so the spire grows with the plan too.
      const spireH = Math.max(H * 0.42, Math.max(ctx.w, ctx.d) * 1.0);
      const roofY = H + ctx.pp;
      const tipW = ctx.w * 0.06, tipD = ctx.d * 0.06;
      const slope = FL / H;                                  // per metre, per side
      function coefs(half0, halfTip) {
        const drop = half0 - halfTip;
        const a = Math.min(Math.max(slope * spireH, drop * 0.72), drop * 0.86);
        return { a: a, b: drop - a, h0: half0 };
      }
      const cx = coefs(ctx.w / 2, tipW / 2), cz = coefs(ctx.d / 2, tipD / 2);
      const lifts = Math.max(12, Math.min(56, Math.round(spireH / Math.max(0.9, FH * 0.32))));
      let tipY = roofY;
      for (let i = 0; i < lifts; i++) {
        const u0 = i / lifts, u1 = (i + 1) / lifts, um = (u0 + u1) / 2;
        const y0 = roofY + u0 * spireH, y1 = roofY + u1 * spireH;
        const hw = cx.h0 - cx.a * um - cx.b * um * um;
        const hd = cz.h0 - cz.a * um - cz.b * um * um;
        ctx.dbox(0, (y0 + y1) / 2, 0, hw * 2, y1 - y0 + 0.02, hd * 2, i % 2 ? SPIRE : F.shade(SPIRE, 0.96));
        // the shadow line at each lift, and a lit arris on the two leading
        // corners so the blind cone still has edges against the sky
        ctx.dbox(0, y1 - 0.06, 0, hw * 2 + 0.16, 0.12, hd * 2 + 0.16, SPIRE_D);
        for (const sx of [-1, 1]) {
          ctx.dbox(sx * hw, (y0 + y1) / 2, 0, 0.26, y1 - y0, hd * 2 * 0.55, sx > 0 ? LIT : SPIRE_D);
        }
        tipY = y1;
      }
      // the mast and its beacons — the only real meshes this facade mints
      const mastH = Math.max(3.5, H * 0.07);
      ctx.dbox(0, tipY + mastH / 2, 0, Math.max(0.5, tipW * 0.30), mastH, Math.max(0.5, tipD * 0.30), SPIRE_D);
      ctx.dbox(0, tipY + mastH * 0.42, 0, Math.max(0.9, tipW * 0.6), 0.24, Math.max(0.9, tipD * 0.6), LIT);
      ctx.lamp(0, tipY + mastH + 0.5, 0, Math.max(0.35, tipW * 0.20), 0xff5a4a);
      ctx.lamp(0, tipY + mastH * 0.42, 0, Math.max(0.25, tipW * 0.14), 0xff5a4a);
    },
  });
})();
