/* ============================================================
   city/facade_kit.js — THE FACADE KIT: president-mode's grammar, opened up.

   OWNER (verbatim): "look how president mode turns the exact building that is
   already great — the office building … we have an amazing base building and
   the president mode uses a facade that makes a great base building
   interesting … every other attempt at facade in the codebase is horrible and
   don't use any of them at all."

   ------------------------------------------------------------------
   WHY PRESIDENT MODE'S FACADE WORKS (the thing this file generalises)
   ------------------------------------------------------------------
   govcomplex.js does not build a Capitol. It builds the SAME office building
   every lot in the city gets, and hands it a five-field spec at the call site:

       civic(root, cx, cz - 26, 92, 56, 3, M.marble, 1,
         { kind:"capitol", crown:"dome", order:"ionic",
           motto:"THE PEOPLE'S HOUSE", stone:true }, "The Capitol");

   Four properties make that read as architecture instead of as a skin:

     1. THE SPEC IS WRITTEN WHERE THE BUILDING IS PLACED. Not looked up from a
        trade table, not rolled from a district. The author who knows what the
        building IS says so in one object literal.
     2. THE ORNAMENT DERIVES EVERY DIMENSION FROM THE HOST. Nothing is a
        constant. Column count comes from `f.span`, order height is solved
        BACKWARDS from the roofline it must clear. Change w/d/storeys and the
        facade re-proportions instead of breaking.
     3. IT OWNS THE SILHOUETTE, NOT JUST THE SURFACE. A dome, a tower, a
        parapet, a set of steps. You can identify the Capitol from 200 m as a
        black shape. That is what "interesting" means at gameplay distance —
        a repainted box is still a box.
     4. IT COSTS NOTHING. Everything lands in the host's merged deco buckets
        before flushDeco(), so a dressed building is the same draw call count
        as an undressed one.

   This file is that contract, made pluggable, and NOTHING ELSE. It does not
   call bldMasonryDress, bldCivicOrder, bldGhostSign or bldRoofClutter, and it
   never will — per the owner those passes are out of scope for this kit.

   ------------------------------------------------------------------
   THE CONTRACT
   ------------------------------------------------------------------
   A facade is one file in city/facades/ that registers a builder:

       CBZ.registerFacade("brick", {
         label: "Chicago Loft",
         build: function (ctx, F, spec) { ... }
       });

   `ctx`  — the host building's REAL numbers + emitters (buildings.js:4019).
            ox, oz, w, d, storeys, FH, WT, rTop, pp, doorSide, slabCx/Cz/W/D,
            pal, color, TRIM, BASE, PIL, MULL, hash(salt),
            dbox lbox plat ball column cone dome lamp disc plaque seal.
   `F`    — this file's shared vocabulary (see §2). Pure coordinate math and
            compound shapes. No state, no scene graph, no rng.
   `spec` — the object literal the CALL SITE wrote: `{ style:"brick", ... }`.
            Everything past `style` belongs to the facade that reads it.

   A builder may emit ONLY through ctx. It must not touch THREE, the scene
   graph, colliders or rng directly — same isolation buildings_civic.js has,
   for the same reason.

   DETERMINISM: `ctx.hash(salt)` (position-hashed) is the ONLY source of
   variation. Never Math.random, never an rng() stream draw — a facade must
   not be able to desync city placement. tools/math-gate.mjs enforces this.

   LOAD ORDER: after city/buildings.js is irrelevant — this file only needs to
   be parsed before the first cityMakeBuilding call. city/facades/*.js load
   AFTER this file (they call registerFacade).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  // ============================================================
  //  FLAGS
  // ============================================================
  if (CBZ.CONFIG) {
    // FACADE_KIT — the master switch for this whole file. OFF → every dressed
    // building renders as the bare base building it already was, which is
    // exactly the "before" side of the comparison tool. One flag, one revert.
    if (CBZ.CONFIG.FACADE_KIT == null) CBZ.CONFIG.FACADE_KIT = true;
    // FACADE_KIT_CITY — hand ordinary, undressed city buildings a facade by
    // position hash. DEFAULT OFF: the kit ships inert on the live city so it
    // cannot move a single shop, lot or math-gate number without being asked.
    // Turn on with ?cfg_FACADE_KIT_CITY=1 to see the whole skyline wearing it.
    if (CBZ.CONFIG.FACADE_KIT_CITY == null) CBZ.CONFIG.FACADE_KIT_CITY = false;
  }
  function on(n) { return !(CBZ.CONFIG && CBZ.CONFIG[n] === false); }

  // ============================================================
  //  1. THE REGISTRY
  // ============================================================
  const REG = new Map();
  CBZ.registerFacade = function (id, def) {
    if (!id || !def || typeof def.build !== "function") return;
    REG.set(id, { id: id, label: def.label || id, build: def.build,
      // `crownsRoof` tells the host this facade puts something tall on the
      // roof, so a caller can skip its own roof furniture rather than have a
      // water tank grow through a minaret.
      crownsRoof: !!def.crownsRoof });
  };
  CBZ.facadeList = function () { return Array.from(REG.values()).map((f) => ({ id: f.id, label: f.label })); };
  CBZ.facadeDef = function (id) { return REG.get(id) || null; };

  // ============================================================
  //  2. F — THE SHARED VOCABULARY
  // ============================================================
  // Everything here is coordinate math over the host's own dimensions. These
  // are the primitives a facade needs so often that writing them ten times
  // would guarantee ten subtly different bugs.
  const F = {};

  // ---- colour -------------------------------------------------
  F.shade = function (hex, f) {
    const r = Math.max(0, Math.min(255, (((hex >> 16) & 255) * f) | 0));
    const g = Math.max(0, Math.min(255, (((hex >> 8) & 255) * f) | 0));
    const b = Math.max(0, Math.min(255, ((hex & 255) * f) | 0));
    return (r << 16) | (g << 8) | b;
  };
  // blend two colours, t=0 → a, t=1 → b
  F.mix = function (a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return ((((ar + (br - ar) * t) | 0) << 16) | (((ag + (bg - ag) * t) | 0) << 8) | ((ab + (bb - ab) * t) | 0));
  };

  // ---- faces --------------------------------------------------
  // A building has four faces: 0 = -z, 1 = +z, 2 = -x, 3 = +x.
  //   horiz — the face runs along x (its normal is ±z)
  //   out   — outward sign along the normal axis
  //   span  — the face's own width (what you divide into bays)
  //   halfN — distance from centre to this face's outer plane
  F.face = function (ctx, s) {
    const horiz = (s === 0 || s === 1);
    const out = (s === 0 || s === 2) ? -1 : 1;
    return { s: s, horiz: horiz, out: out,
      span: horiz ? ctx.w : ctx.d,
      halfN: (horiz ? ctx.d : ctx.w) / 2 };
  };
  F.faces = function (ctx) { return [0, 1, 2, 3].map((s) => F.face(ctx, s)); };
  // every face EXCEPT the entrance (the door face usually wants its own kit)
  F.flanks = function (ctx) { return [0, 1, 2, 3].filter((s) => s !== ctx.doorSide).map((s) => F.face(ctx, s)); };

  // ---- placing a box on a face --------------------------------
  // The single most-used call in the kit. Places a box on face `f`:
  //   t     tangent offset along the face (0 = centred)
  //   cy    centre height
  //   len   length ALONG the face
  //   h     height
  //   proj  how far it stands PROUD of the wall plane (must be > 0)
  //   inset push the whole thing in (negative) or out (positive) from the wall
  // Because proj is measured from the wall face, the box centre lands at
  // halfN + inset + proj/2 — get that wrong and your ornament floats.
  F.box = function (ctx, f, t, cy, len, h, proj, col, inset) {
    if (!(proj > 0)) return;                     // a zero/negative depth inverts the geometry
    const n = f.halfN + (inset || 0) + proj / 2;
    if (f.horiz) ctx.dbox(t, cy, f.out * n, len, h, proj, col);
    else ctx.dbox(f.out * n, cy, t, proj, h, len, col);
  };
  // a band running the FULL width of a face, with an overhang past the corners
  // so the four faces' bands meet instead of leaving a notch at each corner.
  F.band = function (ctx, f, cy, h, proj, col, over, inset) {
    F.box(ctx, f, 0, cy, f.span + (over == null ? 0.2 : over), h, proj, col, inset);
  };
  // the same band on all four faces — a string course, a cornice, a coping
  F.ring = function (ctx, cy, h, proj, col, over, inset) {
    for (const f of F.faces(ctx)) F.band(ctx, f, cy, h, proj, col, over, inset);
  };
  // a vertical rib (pier, pilaster, mullion, buttress face) on one face
  F.rib = function (ctx, f, t, y0, y1, wid, proj, col, inset) {
    if (y1 <= y0) return;
    F.box(ctx, f, t, (y0 + y1) / 2, wid, y1 - y0, proj, col, inset);
  };
  // a box at the building's four CORNERS, present on both meeting faces so the
  // corner reads solid (a quoin, a buttress, a corner pier).
  F.corners = function (ctx, cy, h, len, proj, col) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      ctx.dbox(sx * (ctx.w / 2 - len / 2 + proj / 2), cy, sz * (ctx.d / 2 + proj / 2), len, h, proj, col);
      ctx.dbox(sx * (ctx.w / 2 + proj / 2), cy, sz * (ctx.d / 2 - len / 2 + proj / 2), proj, h, len, col);
    }
  };

  // ---- bays ---------------------------------------------------
  // Divide a face into N bays and hand back the CENTRE of each. This is how a
  // facade gets its rhythm from the building instead of from a constant.
  // `margin` keeps the end bays off the corners.
  F.bays = function (f, n, margin) {
    const m = margin == null ? 0.9 : margin;
    const usable = f.span - m * 2;
    const out = [];
    if (usable <= 0 || n < 1) return out;
    const step = usable / n;
    for (let i = 0; i < n; i++) out.push({ t: -usable / 2 + (i + 0.5) * step, w: step, i: i });
    return out;
  };
  // …and the LINES between bays (where piers go), including the two ends.
  F.bayLines = function (f, n, margin) {
    const m = margin == null ? 0.9 : margin;
    const usable = f.span - m * 2;
    const out = [];
    if (usable <= 0 || n < 1) return out;
    const step = usable / n;
    for (let i = 0; i <= n; i++) out.push(-usable / 2 + i * step);
    return out;
  };
  // A sane bay count for a face: about one bay per `per` metres, clamped.
  F.bayCount = function (f, per, lo, hi) {
    return Math.max(lo || 2, Math.min(hi || 9, Math.round(f.span / (per || 3.4))));
  };

  // ---- compound shapes ----------------------------------------
  // A STEPPED ARCH over an opening — the honest way to draw a curve out of
  // axis-aligned merged boxes. `kind`: "round" | "pointed" | "horseshoe" |
  // "segmental". Reads as an arch at any gameplay distance and costs nothing.
  F.arch = function (ctx, f, t, y, wid, rise, thick, proj, col, kind) {
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const u = (i + 0.5) / steps;                 // 0..1 up the rise
      let frac;                                    // half-width at this course
      if (kind === "pointed") frac = 1 - u;                       // straight taper to a point
      else if (kind === "horseshoe") frac = Math.cos(Math.asin(Math.min(1, u * 0.86)) ) * 1.06;
      else if (kind === "segmental") frac = Math.sqrt(Math.max(0, 1 - u * u * 0.55));
      else frac = Math.sqrt(Math.max(0, 1 - u * u));              // round
      const lw = Math.max(0.12, wid * frac);
      F.box(ctx, f, t, y + u * rise, lw + thick * 2, rise / steps + 0.02, proj, col);
    }
    // the springing impost each side, which is what tells you it is an arch
    for (const sg of [-1, 1]) F.box(ctx, f, t + sg * (wid / 2 + thick * 0.5), y - 0.08, thick * 1.6, 0.16, proj + 0.03, col);
  };
  // A STEPPED PYRAMID / ziggurat — spires, setback crowns, tiled roofs.
  // Returns the height reached, so the caller can stand a finial on it.
  F.ziggurat = function (ctx, cx, cz, y, wid, dep, h, steps, col, taper, shadeStep) {
    let sy = y, sw = wid, sd = dep;
    const sh = h / steps;
    for (let i = 0; i < steps; i++) {
      ctx.dbox(cx, sy + sh / 2, cz, sw, sh, sd, shadeStep ? F.shade(col, 1 - i * shadeStep) : col);
      sy += sh; sw *= (taper || 0.74); sd *= (taper || 0.74);
    }
    return sy;
  };
  // A PARAPET the facade owns: a wall standing on the roof edge, with a coping
  // cap. Every good facade terminates deliberately instead of just stopping.
  F.parapet = function (ctx, h, thick, wall, cap) {
    const y = ctx.rTop;
    for (const f of F.faces(ctx)) {
      F.box(ctx, f, 0, y + h / 2, f.span + 0.24, h, thick, wall, -thick * 0.5);
      F.box(ctx, f, 0, y + h + 0.07, f.span + 0.4, 0.14, thick + 0.22, cap, -thick * 0.5);
    }
  };
  // MERLONS / crenellation / a run of small blocks along a face top.
  F.merlons = function (ctx, f, cy, n, wid, h, proj, col) {
    const step = f.span / n;
    for (let i = 0; i <= n; i++) F.box(ctx, f, -f.span / 2 + i * step, cy, wid, h, proj, col);
  };

  // ---- the entrance -------------------------------------------
  // Where the door actually is, in face-tangent terms, and how much room the
  // facade must leave clear. Every facade needs this and nobody should be
  // guessing it: buildings.js puts the door at the CENTRE of ctx.doorSide, and
  // a drive-in bay needs far more room than a person does.
  F.entrance = function (ctx) {
    const f = F.face(ctx, ctx.doorSide);
    const driveIn = !!(ctx.showroom || ctx.garageGround);
    return { f: f, t: 0,
      gap: driveIn ? 6.4 : 2.8,          // keep ornament off this tangent band
      head: driveIn ? (ctx.FH + 0.9) : 3.6,   // nothing hangs below this height
      driveIn: driveIn };
  };
  // true when tangent `t` on face `f` would foul the doorway
  F.clearsDoor = function (ctx, f, t, wid) {
    if (f.s !== ctx.doorSide) return true;
    const e = F.entrance(ctx);
    return Math.abs(t) > (e.gap + (wid || 0)) / 2;
  };

  // ---- the roof -----------------------------------------------
  // Where a crown may stand without fouling rooftop gameplay. buildings.js
  // keeps roof loot, helipads and the elevator headhouse near the slab centre,
  // so a crown gets the centre and a keep-out radius is the caller's problem.
  F.roof = function (ctx) {
    return { cx: ctx.slabCx, cz: ctx.slabCz, w: ctx.slabW, d: ctx.slabD,
      y: ctx.rTop + ctx.pp, base: Math.min(ctx.slabW, ctx.slabD) };
  };

  CBZ.FACADE_F = F;

  // ============================================================
  //  3. THE SEAM — what buildings.js calls
  // ============================================================
  // Called from makeBuilding's dressing block, BEFORE flushDeco(), so every
  // dbox a facade emits folds into the host's merged trim buckets and then
  // into core/batch.js's city-wide merge. A dressed building costs the same
  // draw calls as a bare one.
  //
  // Returns the resolved facade def (or null), so the host can ask whether
  // this building crowned its own roof.
  // Which style does this caller get? Shared by dressFacade and the early
  // crown question below so the two can never disagree about it.
  function resolve(dress, hash) {
    if (!on("FACADE_KIT")) return null;
    let spec = dress || null;
    // CITY-WIDE MODE (off by default): give an undressed building a style by
    // position hash. Deterministic — lot #23's style is decidable without
    // building lots 0..22 — and it never draws from the rng stream.
    if (!spec && on("FACADE_KIT_CITY") && REG.size && hash) {
      const ids = Array.from(REG.keys()).sort();
      spec = { style: ids[Math.min(ids.length - 1, (hash(0x7ac1) * ids.length) | 0)] };
    }
    if (!spec || !spec.style) return null;
    const def = REG.get(spec.style);
    return def ? { def: def, spec: spec } : null;
  }

  // WILL THIS FACADE TAKE THE ROOF? Asked BEFORE the shell is built, because
  // buildings.js decides its own setback crown and corner finials hundreds of
  // lines before dressFacade() runs. Without this the host grows a spire
  // through a dome, a minaret or a mansard — two crowns on one roof.
  CBZ.facadeCrownsRoof = function (dress, hash) {
    const r = resolve(dress, hash);
    return !!(r && r.def.crownsRoof);
  };

  CBZ.dressFacade = function (ctx) {
    const r = resolve(ctx.dress, ctx.hash);
    if (!r) return null;
    try { r.def.build(ctx, F, r.spec); }
    catch (e) { if (window.console) console.warn("facade " + r.spec.style + ": " + e.message); }
    return r.def;
  };
})();
