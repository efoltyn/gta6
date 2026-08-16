/* ============================================================
   city/facades/pencil.js — "Supertall Slim": the Billionaires' Row pencil.

   THE READ. A pencil tower is not a tall office block. It is a structural
   argument made visible: a footprint far too small for its height, held up by
   a concrete exoskeleton of huge square piers, tied back to the core by
   outrigger belts, and punched through at intervals by OPEN floors that let
   the wind pass straight through the building. Everything a player recognises
   about 432 Park or Steinway is in those four facts, so this file spends its
   whole budget on them and on nothing else.

   THE HEIGHT IS BANDED, never per-storey-decorated. At 128 m one storey is
   2.5 percent of the elevation, so the composition is:

     PODIUM      the bottom double height, which is the only part a player on
                 foot ever touches. The exoskeleton piers land as heavy square
                 blocks and the lobby is a dark recess pushed back BEHIND them,
                 under a slim canopy. A small footprint meeting the ground
                 hard, which is exactly how these towers meet the street.
     SHAFT       repeated cheaply: one continuous pier per bay line for a whole
                 segment (not per storey), one floor band per storey, one deep
                 square window per bay. Piers proud, bands half as proud, and
                 the openings left at the wall plane in near-black glass, so
                 the elevation reads as a LATTICE of big square holes rather
                 than as a curtain wall.
     VOID FLOORS the identity. Every dozen storeys the shaft stops being a
                 building: the cladding comes off, four corner columns and a
                 deep beam top and bottom are all that is left, and diagonal
                 bracing crosses the opening. Below the shell roof the void is
                 a black recess; ABOVE it, where this facade owns real volume,
                 the void is a genuine hole with sky through it, which is what
                 makes the silhouette plate unmistakable.
     OUTRIGGER   each void is wrapped top and bottom by a belt deeper than
     BELTS       anything else on the tower. That is the level where the
                 exoskeleton ties back to the core, and expressing it is why
                 the voids read as structure rather than as missing wall.
     CROWN       nothing. A pencil tower has no hat: the frame simply stops in
                 a sharp parapet with a slim cap and a pair of beacons. Any
                 ornament here would undo the whole argument.

   SLENDERNESS ON A FIXED SHELL. The host shell is a given width and depth, so
   apparent slimness is manufactured two ways. The cladding is inset from each
   face by IN and the leftover strip at each end is left as a near-black shadow
   gap running the full height, so the lit tower you see is narrower than the
   box it stands on. And above ctx.rTop the slim shaft continues as REAL volume
   for about a fifth of the building again, so the pencil visibly out-rises its
   own shell instead of stopping with it.

   COLOUR is anchored to fixed mid values, never derived by lightening the host
   colour: this renderer clips above about 0x99 and a white-on-white lattice
   has no lattice. Warm grey concrete for the frame, near-black glass in the
   openings, blacker still inside the voids.

   Every dimension comes from ctx.w / ctx.d / ctx.storeys / ctx.FH / ctx.rTop
   or a face span. Variation is ctx.hash only. Everything is merged ctx.dbox
   except two beacon lamps.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.registerFacade) return;

  CBZ.registerFacade("pencil", {
    label: "Supertall Slim",
    crownsRoof: true,
    minStoreys: 20,
    build: function (ctx, F, spec) {
      const FH = ctx.FH, rTop = ctx.rTop, ST = ctx.storeys;
      const small = Math.min(ctx.w, ctx.d);

      // ---------------- palette ----------------
      // Fixed concrete values with only a whisper of the host colour, so two
      // pencils on one street are related without either washing out.
      // MEASURED, not guessed: the first render came back as a white tower on
      // a white sky and the lattice had no lattice in it — this renderer clips
      // above about 0x99, so the frame is anchored at a real mid grey and the
      // whole remaining range is spent on relief.
      const STONE = F.mix(0x6e6b64, ctx.color, 0.14);
      const LIT = F.shade(STONE, 1.28);     // belt tops, the cap
      const MID = F.shade(STONE, 0.74);     // pier sides, floor bands
      const DEEP = F.shade(STONE, 0.42);    // reveals
      const GLASS = 0x0e1116;               // the square openings
      const VOIDC = 0x0a0c0e;               // inside a mechanical void
      const GAP = 0x101214;                 // the shadow gap at the corners

      // ---------------- the slim shaft ----------------
      // How far the cladding is pulled in from the shell on every face. Big
      // enough to read as a genuine step at 200 m, never so big that the
      // shaft becomes a stick on a narrow lot.
      const IN = Math.max(1.1, Math.min(small * 0.13, 3.6));
      const HX = ctx.w / 2 - IN, HZ = ctx.d / 2 - IN;
      // The extension: real volume above the host roof. A pencil that stops
      // level with its own shell has given up its only free silhouette.
      const EXT = Math.max(FH * 4, Math.min(rTop * 0.21, FH * 9));
      const TOP = rTop + EXT;

      // slim faces: same shape F.face returns, but measured on the shaft
      // rather than the shell, so F.box places on the extension correctly.
      function slimFace(s) {
        const horiz = (s === 0 || s === 1);
        return { s: s, horiz: horiz, out: (s === 0 || s === 2) ? -1 : 1,
          span: horiz ? HX * 2 : HZ * 2, halfN: horiz ? HZ : HX };
      }
      const SHELL = [0, 1, 2, 3].map((s) => F.face(ctx, s));
      const SLIM = [0, 1, 2, 3].map(slimFace);
      // the clad half-width on a shell face equals the slim face's half span,
      // which is what keeps the lattice in one plane the whole way up.
      function region(s, y) {
        return (y < rTop)
          ? { f: SHELL[s], tHalf: SLIM[s].span / 2 }
          : { f: SLIM[s], tHalf: SLIM[s].span / 2 };
      }

      // ---------------- structural pitch ----------------
      // Wide, regular, and derived from the shaft rather than the shell: a
      // pencil's piers sit 5-6 m apart whatever the plan is.
      const CP = Math.max(0.55, Math.min(small * 0.055, 1.25));   // pier projection
      const PW = Math.max(0.9, Math.min(small * 0.085, 2.0));     // pier width
      function bayLines(tHalf) {
        const n = Math.max(2, Math.min(7, Math.round((tHalf * 2) / (FH * 1.75))));
        const out = [];
        for (let i = 0; i <= n; i++) out.push(-tHalf + (i * tHalf * 2) / n);
        return out;
      }

      // ---------------- the vertical composition ----------------
      const PODH = Math.min(FH * 3.0, rTop * 0.12);      // the tall open base
      // A void is double height on a 20-storey tower and triple on a supertall:
      // the 20-storey render showed a fixed triple-height void eating a third
      // of a short shaft, which is a tower made of holes rather than a tower
      // with holes in it.
      const VH = FH * Math.min(3.0, Math.max(2.0, ST / 14));
      const CAPZONE = FH * 3.5;                           // solid shaft under the crown
      const usable = TOP - PODH - CAPZONE;
      const nVoid = Math.max(1, Math.min(5, Math.round(usable / (FH * 12))));
      const seg = usable / nVoid;
      const voids = [];
      for (let i = 0; i < nVoid; i++) {
        let y1 = PODH + (i + 1) * seg;
        let y0 = y1 - VH;
        // never let a void straddle the shell roof: the plane the cladding
        // sits on changes there, and a half-in-half-out void reads as a bug.
        if (y0 < rTop && y1 > rTop) { const sh = y1 - rTop; y0 -= sh; y1 -= sh; }
        if (y0 > PODH + FH) voids.push({ y0: y0, y1: y1 });
      }
      // the solid runs between them
      const solids = [];
      let cur = PODH;
      for (const v of voids) { if (v.y0 - cur > FH * 0.6) solids.push([cur, v.y0]); cur = v.y1; }
      if (TOP - cur > 0.4) solids.push([cur, TOP]);

      // ================================================================
      //  1. THE SHADOW GAP — what makes the tower look narrower than it is
      // ================================================================
      // The leftover strip of shell each side of the clad shaft, painted out
      // to the corner and running the full height of the shell. Plus a thin
      // deeper reveal on the cladding edge so the step is a line, not a tone.
      for (const f of SHELL) {
        const tH = SLIM[f.s].span / 2;
        const strip = f.span / 2 - tH;
        if (strip > 0.25) {
          for (const sg of [-1, 1]) {
            F.box(ctx, f, sg * (tH + strip / 2), rTop / 2, strip + 0.1, rTop, 0.10, GAP);
            F.box(ctx, f, sg * (tH + 0.09), rTop / 2, 0.18, rTop, CP * 0.55, VOIDC);
          }
        }
      }

      // ================================================================
      //  2. THE SHAFT — piers, floor bands, deep square openings
      // ================================================================
      // One pier run per SEGMENT, not per storey: at this height a per-storey
      // pier is the same picture for forty times the boxes.
      function cladRun(y0, y1) {
        for (let s = 0; s < 4; s++) {
          const r = region(s, (y0 + y1) / 2);
          const f = r.f, tH = r.tHalf;
          const lines = bayLines(tH);
          const cell = (tH * 2) / (lines.length - 1);
          // the wall plane the openings sit in. It has to be SHALLOWER than
          // the glass that follows: the first close-up showed the openings
          // buried inside this panel (a box at proj 0.06 behind a panel at
          // 0.12 is simply not there), and the elevation read as scratches.
          F.box(ctx, f, 0, (y0 + y1) / 2, tH * 2, y1 - y0, 0.10, MID);
          // continuous piers
          for (let i = 0; i < lines.length; i++) {
            const t = lines[i];
            const wid = (i === 0 || i === lines.length - 1) ? PW * 1.25 : PW;
            F.rib(ctx, f, t, y0, y1, wid, CP, STONE);
            // a shaded return each side so the pier reads as a square block
            for (const sg of [-1, 1])
              F.rib(ctx, f, t + sg * (wid / 2 - 0.09), y0, y1, 0.18, CP * 1.02, sg < 0 ? MID : DEEP);
          }
          // per storey: the floor band, then one deep square opening per bay
          const k0 = Math.ceil(y0 / FH), k1 = Math.floor((y1 - FH * 0.35) / FH);
          for (let k = k0; k <= k1; k++) {
            const fy = k * FH;
            if (fy - y0 < 0.2 || y1 - fy < 0.2) continue;
            F.box(ctx, f, 0, fy, tH * 2 + 0.06, FH * 0.30, CP * 0.46, MID);
            F.box(ctx, f, 0, fy + FH * 0.16, tH * 2 + 0.06, FH * 0.05, CP * 0.50, LIT);
            // BIG square openings. The first render made them small enough
            // that the elevation read as speckle rather than as a lattice;
            // a pencil tower's window is nearly the whole bay.
            const openH = FH * 0.66, openW = Math.min(cell * 0.80, openH * 1.15);
            const cy = fy + FH * 0.52;
            if (cy + openH / 2 > y1 - 0.1) continue;
            for (let i = 0; i + 1 < lines.length; i++) {
              const t = (lines[i] + lines[i + 1]) / 2;
              if (cy - openH / 2 < ctx.FH * 1.2 && !F.clearsDoor(ctx, f, t, openW)) continue;
              F.box(ctx, f, t, cy, openW, openH, 0.15, GLASS);
            }
          }
        }
      }
      for (const s of solids) {
        // solid runs that cross the shell roof are clad in two halves, one on
        // each plane, because the plane itself steps in there.
        if (s[0] < rTop && s[1] > rTop) { cladRun(s[0], rTop); cladRun(rTop, s[1]); }
        else cladRun(s[0], s[1]);
        // above the shell this facade owns the volume, so the run is real mass
        if (s[1] > rTop) {
          const a = Math.max(s[0], rTop);
          ctx.dbox(0, (a + s[1]) / 2, 0, HX * 2, s[1] - a, HZ * 2, MID);
        }
      }

      // ================================================================
      //  3. THE VOIDS + OUTRIGGER BELTS — the identity
      // ================================================================
      const BP = CP * 1.75;                    // belts are the deepest thing here
      const BH = Math.max(0.9, FH * 0.40);
      for (const v of voids) {
        const above = v.y0 >= rTop - 0.01;
        const F4 = above ? SLIM : SHELL;
        // the void itself: black, and on the extension it is real sky, because
        // nothing is emitted across the opening at all.
        for (let s = 0; s < 4; s++) {
          const f = F4[s], tH = SLIM[s].span / 2;
          if (!above) F.box(ctx, f, 0, (v.y0 + v.y1) / 2, tH * 2, v.y1 - v.y0, 0.09, VOIDC);
          // the four corner columns that carry the tower across the opening
          const lines = bayLines(tH);
          for (const t of [lines[0], lines[lines.length - 1]]) {
            F.rib(ctx, f, t, v.y0 - BH * 0.5, v.y1 + BH * 0.5, PW * 1.35, CP * 1.15, STONE);
          }
          // expressed diagonal bracing inside the void: a stepped X, which is
          // the honest way to draw a diagonal out of merged axis boxes. The
          // first render drew both runs converging on the centre, which reads
          // as a gable — a brace has to CROSS or it is not carrying anything.
          const nStep = 9, run = tH * 0.88, rise = (v.y1 - v.y0) * 0.82;
          for (const sg of [-1, 1]) {
            for (let i = 0; i < nStep; i++) {
              const u = (i + 0.5) / nStep;
              F.box(ctx, f, sg * (-run + 2 * run * u), v.y0 + (v.y1 - v.y0) * 0.09 + u * rise,
                (run * 2 / nStep) * 1.35, rise / nStep + 0.08, CP * 0.8, i % 2 ? MID : STONE);
            }
          }
          // the belts, top and bottom, oversailing the piers
          for (const by of [v.y0 - BH * 0.5, v.y1 + BH * 0.5]) {
            F.box(ctx, f, 0, by, tH * 2 + 0.5, BH, BP, STONE);
            F.box(ctx, f, 0, by + BH * 0.44, tH * 2 + 0.7, BH * 0.20, BP * 1.05, LIT);
            F.box(ctx, f, 0, by - BH * 0.44, tH * 2 + 0.7, BH * 0.16, BP * 1.02, DEEP);
          }
        }
        // above the roof the belts and corner columns need real volume too, or
        // the void is a picture on nothing.
        if (above) {
          for (const by of [v.y0 - BH * 0.5, v.y1 + BH * 0.5])
            ctx.dbox(0, by, 0, HX * 2 + BP, BH, HZ * 2 + BP, STONE);
          const cs = PW * 1.35;
          for (const sx of [-1, 1]) for (const sz of [-1, 1])
            ctx.dbox(sx * (HX - cs / 2), (v.y0 + v.y1) / 2, sz * (HZ - cs / 2),
              cs, v.y1 - v.y0, cs, STONE);
        }
      }

      // ================================================================
      //  4. THE PODIUM — a different building, 15 m tall
      // ================================================================
      // The piers land as heavy blocks; the lobby is a dark glazed plane
      // pushed BEHIND them; a slim canopy runs over it, clear of the door head.
      {
        const e = F.entrance(ctx);
        for (let s = 0; s < 4; s++) {
          const f = SHELL[s], tH = SLIM[s].span / 2;
          const lines = bayLines(tH);
          // The lobby is a HOLE, not a wall: near-black for the podium's whole
          // height so the piers stand in front of a void, which is what makes
          // the base read as a different building from the shaft above it.
          F.box(ctx, f, 0, PODH * 0.55, tH * 2, PODH * 0.90, 0.06, VOIDC);
          F.box(ctx, f, 0, 0.26, tH * 2 + 0.2, 0.52, CP * 0.9, DEEP);
          // half as many piers as the shaft, twice as heavy: the load has been
          // gathered, and a pencil meets the ground on very few points.
          for (let i = 0; i < lines.length; i++) {
            const end = (i === 0 || i === lines.length - 1);
            if (!end && (i % 2) === 1) continue;
            const t = lines[i];
            const wid = end ? PW * 1.8 : PW * 1.5;
            if (!F.clearsDoor(ctx, f, t, wid)) continue;
            F.rib(ctx, f, t, 0, PODH, wid, CP * 1.7, STONE);
            for (const sg of [-1, 1])
              F.rib(ctx, f, t + sg * (wid / 2 - 0.10), 0, PODH, 0.20, CP * 1.72, sg < 0 ? MID : DEEP);
            F.box(ctx, f, t, PODH * 0.05, wid + 0.36, PODH * 0.10, CP * 1.85, MID);
          }
          // the canopy: slim, well above the door head, with a lit front edge
          const cy = Math.max(e.head + 0.8, PODH * 0.52);
          if (cy + 0.5 < PODH) {
            F.box(ctx, f, 0, cy, tH * 2 + 0.5, 0.22, CP * 1.9, MID);
            F.box(ctx, f, 0, cy + 0.16, tH * 2 + 0.7, 0.12, CP * 2.0, LIT);
            F.box(ctx, f, 0, cy - 0.15, tH * 2 + 0.3, 0.08, CP * 1.8, DEEP);
          }
        }
        // the transfer band where the podium hands the load to the shaft
        for (let s = 0; s < 4; s++) {
          const f = SHELL[s], tH = SLIM[s].span / 2;
          F.box(ctx, f, 0, PODH, tH * 2 + 0.6, BH * 1.1, BP, STONE);
          F.box(ctx, f, 0, PODH + BH * 0.5, tH * 2 + 0.8, BH * 0.2, BP * 1.04, LIT);
        }
      }

      // ================================================================
      //  5. THE CROWN — the frame stops, and that is all
      // ================================================================
      {
        const ph = Math.max(1.0, Math.min(FH * 0.7, EXT * 0.10));
        for (let s = 0; s < 4; s++) {
          const f = SLIM[s];
          F.box(ctx, f, 0, TOP + ph / 2, f.span + 0.1, ph, 0.45, STONE, -0.45);
          F.box(ctx, f, 0, TOP + ph + 0.10, f.span + 0.34, 0.20, 0.62, LIT, -0.55);
        }
        ctx.dbox(0, TOP - 0.2, 0, HX * 2, 0.4, HZ * 2, MID);
        // the aviation beacons: the only real meshes this facade mints.
        const br = Math.max(0.22, small * 0.022);
        const bx = HX - br * 2.2, bz = HZ - br * 2.2;
        const sg = ctx.hash(0x9e01) > 0.5 ? 1 : -1;
        ctx.lamp(sg * bx, TOP + ph + 0.55, bz, br, 0xff3524);
        ctx.lamp(-sg * bx, TOP + ph + 0.55, -bz, br, 0xff3524);
      }
    },
  });
})();
