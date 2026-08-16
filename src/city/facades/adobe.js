/* ============================================================
   city/facades/adobe.js — "Pueblo Adobe", earthen mass construction.

   The Saltlands (city/biome_desert.js) is a sand city, and govcomplex.js
   already reaches for an adobe material. This is the facade that belongs
   there. The building underneath is the same ordinary office box every lot
   gets; what has to change is not its colour but its MASS. A tan box is the
   failure mode. Adobe reads as adobe because of five things, and this file
   builds exactly those five out of the host's own dimensions:

     1. THE BATTER. A mud wall cannot stand plumb: it is laid thick at the
        bottom and thinned as it rises, so the profile visibly leans inward.
        Built here as 3 to 5 stacked COURSES ringing all four faces, each one
        projecting further than the course above it. This is the foundational
        move and everything else — window reveals, viga roots, the parapet —
        measures itself off the course it lands in, so the whole facade
        re-proportions with w, d and storeys instead of being pinned to
        constants. Corner buttresses swell out of the lowest courses because
        that is where a real earthen wall is thickest.

     2. IRREGULARITY. Adobe is hand-laid over a mud brick core and replastered
        every few years, so no two edges line up and no two panels are the
        same tone. Every course projection, every parapet segment height,
        every viga length and every course tint is nudged by ctx.hash, which
        is the ONLY variation source allowed here (determinism: two boots of
        one seed must be byte-identical).

     3. THE VIGAS. Round roof beams run right through the wall and poke out
        below the roofline in a regular rhythm on every face. It is the
        signature element and the one thing that tells you at 100 m that this
        is a pueblo and not a stucco office. NOTE ON GEOMETRY: ctx.column
        mints a cylinder on the Y axis only, and a viga is horizontal, so a
        column here would read as a peg pointing at the sky. Each viga is
        therefore three concentric merged boxes whose section is an octagon —
        it reads round at every gameplay distance and, being dbox, it is free,
        which is what lets every face carry a full rhythm of them.

     4. STEPPED MASSING. The pueblo silhouette is blocks stacked back from
        one another with the lower roof used as a terrace. The host's walls
        are fixed at w by d, so the step is made by growing a LOWER MASS out
        past them on one axis — a deep apron on one flank and a shallower one
        opposite, asymmetric on purpose — capped with its own parapet, its own
        vigas and its own canales. The apron roof is registered with ctx.plat
        so it is genuinely walkable, and a near-vertical pole ladder leans on
        its lip so it is genuinely reachable.

     5. DEEP SHADE. Thick walls mean SMALL openings set far back, each with a
        heavy timber lintel and a projecting sill throwing a hard bar of
        shadow; and a PORTAL at the door — round timber posts carrying a beam
        under a run of closely spaced latillas, which stripes the wall behind
        it. Canales, the projecting roof drains, punch out at the parapet
        line so the roofline is never a clean machined edge.

   Colour is the host colour warmed hard toward ochre, retinted per course,
   with the reveals dropped to a third of that value so the openings read as
   holes in a thick wall rather than as painted rectangles. Timber is
   weathered grey-brown. The mesh budget goes almost entirely to dbox; the
   only real meshes are the portal posts and the ladder rails, which are
   genuinely vertical round timber and so are genuinely ctx.column's job.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  CBZ.registerFacade("adobe", {
    label: "Pueblo Adobe",
    crownsRoof: true,
    build: function (ctx, F, spec) {
      spec = spec || {};
      const w = ctx.w, d = ctx.d, FH = ctx.FH, rTop = ctx.rTop, storeys = ctx.storeys;
      const small = Math.min(w, d);
      const h = function (s) { return ctx.hash(s); };

      // ---- palette ------------------------------------------------
      // Sun-baked earth: the host colour dragged most of the way to ochre so
      // a grey office shell and a beige one both land in the same desert.
      // Pulled a long way past the host tone: a desert wall photographs much
      // darker and much more saturated than the grey-beige office shell, and
      // the first render of this facade proved a light mix just reads white.
      const earth = F.shade(F.mix(ctx.color, 0xa2653a, 0.90), 0.86);
      const earthD = F.shade(earth, 0.74);
      const earthL = F.mix(earth, 0xe8b783, 0.26);
      const REVEAL = F.shade(earth, 0.26);          // the inside of an opening
      const timber = F.mix(0x50412f, earth, 0.14);  // weathered vigas and posts
      const timberD = F.shade(timber, 0.66);
      // a course's own tint, so no two lifts of mud plaster match
      const courseCol = function (k) {
        return F.shade(F.mix(earth, earthL, h(0xad10 + k) * 0.42), 0.86 + h(0xad20 + k) * 0.20);
      };

      const ent = F.entrance(ctx);
      const df = ent.f;

      // point on face f, `t` along it, D out from centre along its normal
      const pt = function (f, t, D) {
        return f.horiz ? [t, f.out * D] : [f.out * D, t];
      };

      // ============================================================
      //  A. THE BATTER — stacked courses, thickest at the base
      // ============================================================
      const nC = clamp(storeys + 2, 3, 5);
      const PB = clamp(small * 0.075, 0.42, 1.15);   // total batter at the foot
      const cH = rTop / nC;
      const proj = [];                                // outward projection per course
      for (let k = 0; k < nC; k++) {
        proj.push(PB * (1 - k / nC) * (0.80 + h(0xad30 + k) * 0.40) + 0.05);
      }
      // the course a given height falls in (windows and vigas measure off this)
      const courseAt = function (y) { return clamp(Math.floor(y / cH), 0, nC - 1); };

      for (let k = 0; k < nC; k++) {
        const y0 = k * cH, p = proj[k];
        // Each course overhangs its own corners by its own thickness, so the
        // four faces meet in a solid pier instead of leaving a notch.
        for (const f of F.faces(ctx)) {
          F.band(ctx, f, y0 + cH / 2, cH + 0.02, p, courseCol(k), p * 2.05, 0);
        }
        // the shadow line where one lift of plaster sits on the one below
        if (k > 0) {
          for (const f of F.faces(ctx)) {
            F.band(ctx, f, y0 + 0.07, 0.15, p + 0.09, F.shade(courseCol(k), 0.58), p * 2.05, 0);
          }
        }
      }

      // CORNER BUTTRESSES: the swelling at the foot of every earthen corner.
      const butH = clamp(rTop * 0.34, FH * 0.55, rTop - 0.6);
      const butL = clamp(small * 0.16, 0.9, 3.0);
      F.corners(ctx, butH / 2, butH, butL, PB * 1.35, F.shade(earth, 0.97));
      F.corners(ctx, butH * 0.28, butH * 0.56, butL * 1.22, PB * 1.75, earth);

      // ============================================================
      //  B. DEEP-SET WINDOWS
      // ============================================================
      // Small relative to the wall — that IS what thick-wall construction
      // means — with a timber lintel over and a sill sticking out under.
      for (const f of F.faces(ctx)) {
        const n = F.bayCount(f, 4.2, 2, 6);
        const bays = F.bays(f, n, clamp(f.span * 0.13, 1.0, 2.6));
        for (let s = 0; s < storeys; s++) {
          const wh = clamp(FH * 0.30, 0.65, 1.25);
          const sill = s * FH + FH * 0.44;
          const k = courseAt(sill + wh / 2), p = proj[k];
          for (const b of bays) {
            const ww = clamp(b.w * 0.32, 0.55, 1.35);
            // hashed: an adobe wall is not a curtain wall, some bays are blind
            if (h(0xad40 + s * 17 + b.i * 5 + f.s) < 0.16) continue;
            if (!F.clearsDoor(ctx, f, b.t, ww + 1.6)) continue;
            // the opening itself, left on the ORIGINAL wall plane so the whole
            // course thickness in front of it becomes the reveal
            F.box(ctx, f, b.t, sill + wh / 2, ww, wh, 0.10, REVEAL, 0.01);
            // jambs standing proud of the course: the mud-plastered surround
            for (const sg of [-1, 1]) {
              F.rib(ctx, f, b.t + sg * (ww / 2 + 0.13), sill - 0.05, sill + wh + 0.08,
                0.26, 0.14, F.shade(courseCol(k), 1.03), p);
            }
            // HEAVY TIMBER LINTEL — a squared beam, proud of everything
            F.box(ctx, f, b.t, sill + wh + 0.19, ww + 0.86, 0.30, 0.20, timber, p + 0.02);
            F.box(ctx, f, b.t, sill + wh + 0.36, ww + 0.72, 0.10, 0.16, timberD, p + 0.04);
            // PROJECTING SILL, thrown further out than the lintel
            F.box(ctx, f, b.t, sill - 0.13, ww + 0.62, 0.20, 0.30, earthL, p + 0.02);
            F.box(ctx, f, b.t, sill - 0.26, ww + 0.50, 0.10, 0.22, F.shade(earth, 0.66), p + 0.02);
          }
        }
      }

      // ============================================================
      //  C. VIGAS — the round roof beams, in rhythm, on every face
      // ============================================================
      // Three concentric merged boxes make an octagonal section: round at any
      // distance the player sees it from, and free.
      const vigaRow = function (f, y, root, len0, r, salt) {
        const n = Math.max(3, Math.round(f.span / clamp(FH * 0.62, 1.1, 2.2)));
        const step = f.span / n;
        for (let i = 0; i < n; i++) {
          const t = -f.span / 2 + (i + 0.5) * step;
          const L = len0 * (0.72 + h(salt + i * 3) * 0.62);       // ragged ends
          const col = F.shade(timber, 0.88 + h(salt + i * 3 + 1) * 0.24);
          F.box(ctx, f, t, y, r * 1.98, r * 1.10, L, col, root);
          F.box(ctx, f, t, y, r * 1.60, r * 1.60, L, col, root);
          F.box(ctx, f, t, y, r * 1.10, r * 1.98, L, col, root);
          // the beam's shadow where it leaves the wall
          F.box(ctx, f, t, y, r * 2.5, r * 2.5, 0.05, REVEAL, root - 0.01);
        }
      };
      const vr = clamp(small * 0.018, 0.085, 0.17);                // viga radius
      const vLen = clamp(FH * 0.24, 0.40, 0.80);                   // 0.4-0.8 m proud
      const vigaY = rTop - clamp(FH * 0.26, 0.42, 0.85);
      const vigaK = courseAt(vigaY);
      for (const f of F.faces(ctx)) vigaRow(f, vigaY, proj[vigaK], vLen, vr, 0xad50 + f.s * 41);

      // ============================================================
      //  D. THE PARAPET — soft, stepped, with canales
      // ============================================================
      // Never one clean line: segments of hashed height, each capped by two
      // shrinking courses so the top reads rounded rather than machined.
      const parH = clamp(FH * 0.34, 0.55, 1.30);
      const parT = clamp(proj[nC - 1] + small * 0.020, 0.30, 0.70);
      const capParapet = function (f, y, height, thick, salt) {
        const n = Math.max(3, Math.round(f.span / clamp(f.span / 4.2, 1.6, 3.4)));
        const step = f.span / n;
        for (let i = 0; i < n; i++) {
          const t = -f.span / 2 + (i + 0.5) * step;
          const hh = height * (0.74 + h(salt + i * 7) * 0.52);
          const th = thick * (0.90 + h(salt + i * 7 + 3) * 0.24);
          const col = F.shade(earth, 0.95 + h(salt + i * 7 + 5) * 0.16);
          const len = step + thick * 1.9;
          F.box(ctx, f, t, y + hh / 2, len, hh, th, col, -th * 0.42);
          // soft cap: two shrinking lifts, which is how a mud coping weathers
          F.box(ctx, f, t, y + hh + 0.07, len + 0.14, 0.14, th + 0.16, earthL, -th * 0.42);
          F.box(ctx, f, t, y + hh + 0.18, len - 0.10, 0.10, th + 0.02, earthL, -th * 0.42);
        }
        // CANALES: the roof drains, poking out at the parapet foot.
        const cn = Math.max(1, Math.round(f.span / clamp(f.span / 2.2, 3.5, 9.0)));
        for (let i = 0; i < cn; i++) {
          const t = (-0.5 + (i + 0.5) / cn) * f.span * 0.86;
          const cw = clamp(small * 0.03, 0.22, 0.40);
          F.box(ctx, f, t, y + height * 0.30, cw * 2.4, cw * 1.5, thick + 0.62, timberD, -thick * 0.42);
          F.box(ctx, f, t, y + height * 0.30 + cw * 0.35, cw * 1.5, cw * 0.6, thick + 0.66, REVEAL, -thick * 0.42);
        }
      };
      for (const f of F.faces(ctx)) capParapet(f, rTop, parH, parT, 0xad60 + f.s * 53);

      // THE MUD ROOF. An adobe roof is earth laid over the vigas, not a pale
      // deck — and the parapet is low enough that the deck is what an aerial
      // camera actually sees, so leaving the host's slab bare undoes the whole
      // palette from above. A single merged slab, inside the parapet line.
      {
        const roof = F.roof(ctx);
        ctx.dbox(roof.cx, roof.y + 0.07, roof.cz, roof.w - parT * 1.2, 0.14,
          roof.d - parT * 1.2, F.shade(earth, 0.92));
      }

      // ============================================================
      //  E. STEPPED MASSING — the lower block and its terrace
      // ============================================================
      // The host's walls are fixed, so the step is made by growing the LOWER
      // storeys OUT past them on one axis: a deep apron on one flank, a
      // shallower one opposite. Asymmetry is the point.
      if (storeys >= 2) {
        const lowN = clamp(Math.round(storeys * 0.55), 1, storeys - 1);
        const hSet = lowN * FH;
        // the two faces perpendicular to the door face, so the entrance stays
        // on the clean upper wall and the portal reads against it
        const axis = (df.s === 0 || df.s === 1) ? [2, 3] : [0, 1];
        const deep = h(0xad70) < 0.5 ? 0 : 1;
        for (let q = 0; q < 2; q++) {
          const f = F.face(ctx, axis[q]);
          const PA = clamp(small * (q === deep ? 0.26 : 0.11), 0.8, 4.0);
          const segs = clamp(Math.round(hSet / cH), 2, 4);
          const sh = hSet / segs;
          for (let k = 0; k < segs; k++) {
            const pk = PA * (1 - k * 0.10) * (0.94 + h(0xad80 + q * 9 + k) * 0.12);
            F.band(ctx, f, k * sh + sh / 2, sh + 0.02, pk, courseCol(k), pk * 2.05, 0);
            if (k > 0) F.band(ctx, f, k * sh + 0.06, 0.12, pk + 0.06, F.shade(courseCol(k), 0.58), pk * 2.05, 0);
          }
          // this block's own vigas and its own stepped parapet
          const aRoot = PA * (1 - (segs - 1) * 0.10);
          vigaRow(f, hSet - clamp(FH * 0.26, 0.42, 0.85), aRoot, vLen, vr, 0xad90 + q * 61);
          capParapet(f, hSet, parH * 0.86, clamp(aRoot * 0.42, 0.26, 0.55), 0xada0 + q * 67);

          // THE TERRACE, if it is deep enough to stand on.
          if (PA > 1.3) {
            const halfN = f.horiz ? d / 2 : w / 2;
            const inner = halfN, outer = halfN + aRoot - 0.35;
            if (f.horiz) {
              const z0 = f.out < 0 ? -outer : inner, z1 = f.out < 0 ? -inner : outer;
              ctx.plat(-f.span / 2, f.span / 2, z0, z1, hSet + 0.02);
            } else {
              const x0 = f.out < 0 ? -outer : inner, x1 = f.out < 0 ? -inner : outer;
              ctx.plat(x0, x1, -f.span / 2, f.span / 2, hSet + 0.02);
            }
            // THE LADDER: near-vertical pole ladder standing on the ground and
            // over-running the terrace lip, which is what makes it reachable.
            const lt = f.span * 0.34;
            const lD = halfN + aRoot + 0.22;
            const gap = clamp(small * 0.035, 0.36, 0.60);
            const lTop = hSet + clamp(FH * 0.30, 0.7, 1.2);
            for (const sg of [-1, 1]) {
              const c = pt(f, lt + sg * gap / 2, lD);
              ctx.column(c[0], 0, c[1], clamp(vr * 0.62, 0.055, 0.10), lTop, timber, 7);
            }
            const rungs = Math.max(3, Math.round(lTop / clamp(FH * 0.30, 0.55, 0.9)));
            for (let i = 1; i <= rungs; i++) {
              const c = pt(f, lt, lD);
              const ry = (i / (rungs + 1)) * lTop;
              ctx.dbox(c[0], ry, c[1], f.horiz ? gap + 0.22 : 0.13, 0.11,
                f.horiz ? 0.13 : gap + 0.22, timberD);
            }
          }
        }
      }

      // ============================================================
      //  F. THE PORTAL — the covered porch at the door
      // ============================================================
      // Round timber posts carrying a beam, with a run of closely spaced
      // latillas above it striping the wall behind. Every dimension is solved
      // from the entrance so nothing ever hangs into the doorway.
      const porch = clamp(Math.min(FH * 0.85, small * 0.17), 1.1, 3.0);
      // The beam wants to clear F.entrance's head, but on a 1-storey shop that
      // head (3.6 m) is TALLER THAN THE WALL, so an unclamped solve puts the
      // porch roof above the parapet. The roofline wins: the porch is always a
      // storey element, never a crown.
      const beamY = clamp(Math.max(FH * 0.86, Math.min(ent.head + 0.35, rTop - 0.55)),
        2.25, Math.max(2.3, rTop - 0.40));
      const portalW = clamp(Math.max(ent.gap + 3.2, df.span * 0.52), 3.4, df.span * 0.92);
      const dfK = courseAt(beamY);
      const dfP = proj[dfK];
      const postR = clamp(porch * 0.13, 0.10, 0.24);
      const nPost = clamp(Math.round(portalW / clamp(FH * 0.95, 2.2, 3.4)), 1, 4) + 1;
      const outD = df.halfN + porch - postR * 1.4;

      for (let i = 0; i < nPost; i++) {
        const t = -portalW / 2 + (i / (nPost - 1)) * portalW;
        const c = pt(df, t, outD);
        ctx.column(c[0], 0, c[1], postR, beamY, timber, 9);
        // stone footing, and the carved corbel that spreads the beam's bearing
        ctx.dbox(c[0], 0.11, c[1], postR * 3.0, 0.22, postR * 3.0, earthL);
        ctx.dbox(c[0], beamY - 0.16, c[1], postR * 3.4, 0.24, postR * 3.4, timberD);
        ctx.dbox(c[0], beamY - 0.38, c[1], postR * 2.4, 0.22, postR * 2.4, timberD);
      }
      // the beam over the posts, and a matching wall plate against the facade
      F.box(ctx, df, 0, beamY + 0.16, portalW + postR * 5, 0.32, postR * 2.2, timber,
        porch - postR * 2.9);
      F.box(ctx, df, 0, beamY + 0.16, portalW + postR * 5, 0.32, postR * 2.0, timberD, dfP);
      // LATILLAS: the closely spaced peeled saplings over the beam. They run
      // out from the wall, so they stripe the wall with hard shade.
      {
        const lr = clamp(vr * 0.70, 0.055, 0.12);
        const n = Math.max(6, Math.round((portalW + postR * 4) / (lr * 3.6)));
        const step = (portalW + postR * 4) / n;
        for (let i = 0; i < n; i++) {
          const t = -(portalW + postR * 4) / 2 + (i + 0.5) * step;
          const col = F.shade(timber, 0.86 + h(0xadb0 + i) * 0.28);
          const L = porch - dfP + 0.16 + h(0xadc0 + i) * 0.10;
          F.box(ctx, df, t, beamY + 0.44, lr * 1.9, lr * 1.9, L, col, dfP);
        }
        // the mud-and-brush roof laid on the latillas, sealing the porch
        F.box(ctx, df, 0, beamY + 0.60, portalW + postR * 5.6, 0.16, porch + 0.10, earth, 0);
        F.box(ctx, df, 0, beamY + 0.72, portalW + postR * 5.0, 0.10, porch + 0.02, earthL, 0);
      }
      // a low banco bench along the wall each side of the door, under the porch
      for (const sg of [-1, 1]) {
        const bt = sg * (ent.gap / 2 + (portalW / 2 - ent.gap / 2) / 2);
        const bl = Math.max(0.6, portalW / 2 - ent.gap / 2 - 0.2);
        F.box(ctx, df, bt, clamp(FH * 0.075, 0.19, 0.30), bl,
          clamp(FH * 0.15, 0.38, 0.60), clamp(porch * 0.34, 0.36, 0.75), earthL, dfP);
      }
      // and the threshold, one soft step up out of the sand
      F.box(ctx, df, 0, 0.09, ent.gap + 1.6, 0.18, porch + 0.5, F.shade(earth, 1.02), 0);
    },
  });
})();
