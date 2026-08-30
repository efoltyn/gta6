/* ============================================================
   city/facades/shikhara.js — "Nagara Temple": the North Indian curvilinear
   tower. Khajuraho, Bhubaneswar, Modhera.

   THE ONE SHAPE THIS FILE EXISTS TO DRAW. A rekha deul is not a pyramid and
   it is not a ziggurat. Its profile leaves the wall almost VERTICAL, holds
   that line for half its height, and only then curves in — hard — to a flat
   throat. Everything else in the kit that goes up in stages (pyramid.js,
   ziggurat.js, F.spire) tapers at a constant or accelerating-from-the-start
   rate, which reads as a cone. The curve here is `1 - 0.86*t^2.4`: at half
   height it has given up 16% of its width, at nine tenths it has given up
   70%. That exponent IS the building. Drop it toward 1 and you have built a
   Maya temple by accident.

   The curve is made of many stacked receding COURSES, because that is how the
   thing was actually built — corbelled ashlar, course on course — and because
   a stack of boxes is free while a real curve is not.

   WHY EACH PART IS HERE
     ADHISTHANA   the moulded plinth. A temple stands on a platform, never on
                  the dirt; the podium's own plat lets the player walk up it.
     RATHA PLAN   the star plan. Every course — wall and tower alike — is a
                  CRUCIFORM of five overlapping boxes: a core, two karna
                  collars and two deep bhadra fins on the axes. That is what
                  makes the tower a star in plan instead of a tapered box, and
                  it is why the vertical offsets run unbroken from the plinth
                  to the throat: the wall below and the tower above are laid
                  out by the same table.
     LATTICE      the chain of gavaksha (horseshoe-arch mesh) up the centre of
                  each bhadra fin, one bead per course, alternating width. At
                  200 m it is a texture; at 5 m it is the only thing telling
                  you the tower is carved rather than cast.
     AMALAKA      the flat ribbed stone cushion that caps the tower. SINGULAR:
                  one per building, whatever the size. Three shallow cylinders
                  give the lens section, eight rim blocks give the ribs. If it
                  is missing the tower just stops, and a shikhara that stops
                  is a chimney.
     KALASHA      the pot finial over it. Ball plus bud, two meshes.
     MANDAPA      the porch hall in front, with its own low stepped-pyramid
                  (samvarana) roof. This is the half of the silhouette people
                  actually recognise: a small pyramid leading up to a big
                  curved tower. Without it the tower reads as a single obelisk.

   SOLID: plinth, the wall's own ratha offsets and the mandapa piers are all
   emitted through F.solid, so the porch you can see is a porch you bump into.
   Everything above the roofline is moulding-sized or out of reach and stays
   free. Meshes: 3 for the amalaka, 2 for the kalasha, 2 for the mandapa pot.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;
  const cl = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  CBZ.registerFacade("shikhara", {
    label: "Nagara Temple",
    era: "southasia",
    // WHAT IT IS MADE OF (city/collapse.js MATERIALS) — dry-laid corbelled ashlar.
    structure: "stone",
    // The wall is a temple wall: solid stone, one doorway, sculpture niches.
    // An office glazing band on a garbhagriha is the failure this flag fixes.
    wall: "own",
    crownsRoof: true,
    // A rekha deul is a one-cell shrine. Above ~8 storeys the tower it needs
    // to carry would be a 60 m stone needle, which is not a thing that stands.
    maxStoreys: 8,
    build: function (ctx, F) {
      const w = ctx.w, d = ctx.d, u = Math.min(w, d), rTop = ctx.rTop, FH = ctx.FH;
      const P = F.palette(ctx, "sandstone");

      // ---- 1. ADHISTHANA: the plinth and its mouldings ----------------
      const pod = F.podium(ctx, { pal: P, over: cl(u * 0.09, 0.7, 2.2) });
      F.waterTable(ctx, { y: pod.top, pal: P });

      // ---- 2. THE RATHA TABLE: the star plan, used twice ---------------
      // [tangent fraction of span, projection multiple, width fraction].
      // The wall reads it as ribs; the tower reads it as course collars. One
      // table, so the offsets line up across the roofline instead of drifting.
      const pr = cl(u * 0.038, 0.24, 0.75);
      const RATHA = [[0, 1.7, 0.26], [0.30, 0.85, 0.15], [0.45, 0.45, 0.10]];
      for (const f of F.faces(ctx)) {
        for (const r of RATHA) {
          for (const sg of (r[0] ? [-1, 1] : [0])) {
            F.sRib(ctx, f, sg * r[0] * f.span, pod.top, rTop, f.span * r[2], pr * r[1], P.base);
          }
        }
        // the two horizontal string courses that band the jangha
        for (const k of [0.42, 0.74]) F.band(ctx, f, pod.top + (rTop - pod.top) * k, cl(FH * 0.07, 0.14, 0.30), pr * 2.0, P.light, 0.3);
      }
      // the rathika niche on the centre offset of every face but the door's:
      // where the wall has no window, it has a deity instead.
      for (const f of F.flanks(ctx)) {
        F.blindNiche(ctx, f, { t: 0, y0: pod.top + (rTop - pod.top) * 0.46, h: (rTop - pod.top) * 0.30, wid: f.span * 0.15, kind: "pointed", pal: P });
      }
      F.cornice(ctx, { y: rTop, kind: "corbel", pal: P });

      // ---- 3. THE REKHA: the curvilinear tower -------------------------
      // Height is tied to the PLAN, not the storeys: a shikhara is roughly
      // 1.4x the sanctum's width. Tying it to rTop alone gives a 2-storey
      // shop a stub and a 8-storey block a mast.
      const TH = cl(Math.max(u * 1.45, rTop * 0.75), u * 1.05, u * 2.1);
      const N = cl(Math.round(TH / cl(u * 0.05, 0.30, 0.85)), 12, 30);
      const ch = TH / N;
      let hw = w / 2, hd = d / 2;
      for (let i = 0; i < N; i++) {
        const t = i / N;
        const fr = 0.97 - 0.86 * Math.pow(t, 2.4);      // THE CURVE. See header.
        hw = w * fr / 2; hd = d * fr / 2;
        const cy = rTop + ch * (i + 0.5), p = pr * fr, c = P.course(i);
        const c2 = F.shade(c, 0.93), hh = ch + 0.04;
        ctx.dbox(0, cy, 0, hw * 2, hh, hd * 2, c);                         // core
        ctx.dbox(0, cy, 0, hw * 2 + p * 2, hh, hd * 1.56, c2);             // karna collars
        ctx.dbox(0, cy, 0, hw * 1.56, hh, hd * 2 + p * 2, c2);
        ctx.dbox(0, cy, 0, hw * 2 + p * 3.4, hh, hd * 0.86, c);            // bhadra fins
        ctx.dbox(0, cy, 0, hw * 0.86, hh, hd * 2 + p * 3.4, c);
        // the gavaksha chain up the centre of each fin: one bead a course,
        // alternating width, so the band reads as links and not as a pipe.
        const bb = (i % 2) ? 0.68 : 0.46, bp = Math.max(0.08, p * 0.8);
        for (const sg of [-1, 1]) {
          ctx.dbox(0, cy, sg * (hd + p * 1.7 + bp / 2), hw * 0.86 * bb, ch * 0.72, bp, P.trim);
          ctx.dbox(sg * (hw + p * 1.7 + bp / 2), cy, 0, bp, ch * 0.72, hd * 0.86 * bb, P.trim);
        }
      }

      // ---- 4. THE AMALAKA and the KALASHA ------------------------------
      // ONE per building. The ribbed disc lies flat like a cushion on the
      // throat; the pot sits on it. Three shallow cylinders make the lens
      // section, eight rim blocks make the ribs read from every angle.
      const aY = rTop + TH, aR = Math.max(0.5, (hw + hd) * 0.72), at = Math.max(0.26, aR * 0.42);
      ctx.dbox(0, aY + ch * 0.5, 0, aR * 1.05, ch, aR * 1.05, P.dark);      // the beki throat
      const m = F.mesh(ctx, 5), ay = aY + ch;
      if (m >= 3) {
        ctx.column(0, ay, 0, aR * 0.80, at * 0.32, P.light, 14);
        ctx.column(0, ay + at * 0.32, 0, aR, at * 0.44, P.light, 16);
        ctx.column(0, ay + at * 0.76, 0, aR * 0.76, at * 0.30, P.light, 14);
      } else {
        for (let k = 0; k < 3; k++) ctx.dbox(0, ay + at * (0.16 + k * 0.34), 0, aR * (k === 1 ? 1.9 : 1.5), at * 0.34, aR * (k === 1 ? 1.9 : 1.5), P.light);
      }
      for (const rb of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.72, 0.72], [-0.72, 0.72], [0.72, -0.72], [-0.72, -0.72]]) {
        ctx.dbox(rb[0] * aR * 0.86, ay + at * 0.40, rb[1] * aR * 0.86, aR * 0.34, at * 0.60, aR * 0.34, F.shade(P.light, 0.88));
      }
      ctx.dbox(0, ay + at * 1.06, 0, aR * 0.86, at * 0.28, aR * 0.86, P.trim);   // abacus
      if (m >= 5) { ctx.ball(0, ay + at * 1.45, 0, aR * 0.32, P.trim); ctx.cone(0, ay + at * 1.66, 0, aR * 0.19, aR * 0.62, P.trim); }
      else for (let k = 0; k < 3; k++) ctx.dbox(0, ay + at * 1.3 + aR * k * 0.3, 0, aR * (0.6 - k * 0.16), aR * 0.3, aR * (0.6 - k * 0.16), P.trim);

      // ---- 5. THE MANDAPA: the porch and its stepped pyramid -----------
      // The porch is what the player walks into, so its piers are solid and
      // F.porch drops any post that would foul the doorway.
      const e = F.entrance(ctx), fd = e.f;
      const mD = cl(u * 0.40, 1.8, 5.5);
      const mW = Math.min(fd.span * 0.68, e.gap + cl(fd.span * 0.34, 2.6, 7.0));
      const por = F.porch(ctx, { face: fd, pal: P, depth: mD, width: mW, roof: "flat",
        deckTop: Math.min(pod.top, F.STEP_RISE), posts: 3, roofCol: P.dark,
        eave: cl(FH * 1.15 + 0.5, e.head + 0.6, rTop - 0.5) });
      const mN = fd.halfN + mD / 2;
      F.spire(ctx, { cx: fd.horiz ? 0 : fd.out * mN, cz: fd.horiz ? fd.out * mN : 0,
        y: por.eave + 0.28, base: Math.min(mW * 1.02, mD * 2.2), h: Math.min(mW, mD * 2) * 0.70,
        steps: 6, concave: false, broach: false, col: P.base, trim: P.trim, pal: P });
    },
  });
})();
