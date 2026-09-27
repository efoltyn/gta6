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
    /* FACADE_KIT_CITY — hand ordinary, undressed city buildings a facade by
       position hash.

       DEFAULT ON (2026-08-20). It shipped OFF so the kit could not move a
       single shop, lot or math-gate number without being asked, and that was
       the right call while it was 31 grammars nobody had walked past. The
       owner has now asked for the opposite, by name: "this also means adding
       these facades to gang city". The disaster island has been wearing them
       since it was built (world/disaster_arena.js dressIslandFacade) and the
       city — the mode the kit was written for, off the president's Capitol —
       was the one place still standing in bare boxes.

       WHAT IT COSTS: nothing per building. Every box a grammar emits lands in
       the host's merged deco buckets before flushDeco() and then in
       core/batch.js's city-wide merge, so a dressed skyline is the same draw
       call count as a bare one — that is property 4 in this file's header and
       the reason the kit was built this way.

       WHAT IT DOES NOT TOUCH: an explicit {dress:{style}} at a call site
       always wins, undressed lots still get their style filtered by storey
       range, and the pick is a pure position hash — no rng draw, so city
       placement cannot desync.

       One-line revert: ?cfg_FACADE_KIT_CITY=0. */
    if (CBZ.CONFIG.FACADE_KIT_CITY == null) CBZ.CONFIG.FACADE_KIT_CITY = true;
  }
  function on(n) { return !(CBZ.CONFIG && CBZ.CONFIG[n] === false); }

  // ============================================================
  //  1. THE REGISTRY
  // ============================================================
  const REG = new Map();
  /* HOW MANY GRAMMARS ARE ACTUALLY LOADED. The registry is a Map that fills
     from city/facades/*.js, one file per style, and until now nothing could
     ask it how full it was — so a build that shipped the kit and none of its
     styles looked identical from the outside to one that shipped all nine, and
     the island's town (SURV_FACADES is ON: this island is the kit's showroom)
     quietly came out undressed. tools/disaster-check.mjs counts them. */
  CBZ.facadeStyles = function () { return REG.size; };
  CBZ.registerFacade = function (id, def) {
    if (!id || !def || typeof def.build !== "function") return;
    REG.set(id, { id: id, label: def.label || id, build: def.build,
      // `crownsRoof` tells the host this facade puts something tall on the
      // roof, so a caller can skip its own roof furniture rather than have a
      // water tank grow through a minaret.
      crownsRoof: !!def.crownsRoof,
      // STOREY RANGE. A grammar written for a 4-storey block does not become a
      // skyscraper by being stretched, and a bundled-tube tower is nonsense on
      // a corner shop. Tower facades declare minStoreys; low-rise ones declare
      // maxStoreys. Only FACADE_KIT_CITY's automatic pick honours these — an
      // explicit {dress:{style}} at a call site is always obeyed, because the
      // author who wrote it knows something the registry does not.
      minStoreys: def.minStoreys || 0,
      maxStoreys: def.maxStoreys || Infinity,
      // `ownDoor` tells the kit this grammar draws its own entrance, so the
      // automatic door surround is skipped rather than stacked on top of it.
      ownDoor: !!def.ownDoor,
      // WHAT IS IT MADE OF. A key into city/collapse.js's MATERIALS table
      // ("masonry" | "brick" | "adobe" | "stone" | "concrete" | "steel" |
      // "glassbox" | "timber"). The grammar's AUTHOR knows this and nobody
      // else does: adobe.js is adobe, megabrace.js is a braced steel tube,
      // ranch.js is stick-built timber. Declaring it here is what lets the
      // collapse engine decide whether this building pancakes, topples,
      // shears, folds or crumbles WITHOUT carrying a table of facade names —
      // which is the same reason `crownsRoof` and `minStoreys` live here.
      // Omitted → collapse.js infers from storeys/plan/masonry, which is a
      // defensible default and a worse answer than yours.
      structure: def.structure || null });
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

  // ---- THE DOOR -----------------------------------------------
  /* OWNER: "they don't have holes cut out for doors — you just added a white
     doorframe on all, dumb af. It should be building colour and it should cut
     a hole for the actual real door we have coded already that has code to
     open and lock already built."

     Both halves of that are right, and the second one is the important one.

     buildings.js hangs a REAL door at the centre of ctx.doorSide: a hinged
     leaf on a pivot with a vision pane and a push bar, a collider that fills
     the closed gap, and the open/lock logic already written against it. The
     job of a facade is to leave that door showing — not to draw a picture of
     a door over it, and certainly not to clad straight over it.

     What was here before did exactly the wrong thing: it added a bright
     doorcase in a colour nobody asked for and left the cladding covering the
     opening. The claim in its comment — that merged axis-aligned boxes cannot
     have holes cut in them — was also wrong, and stone.js has disproved it
     since the day it was written: you cut a hole by emitting the band in
     SEGMENTS either side of the opening. carveDoorway() below does that
     automatically for every box a facade lays across the entrance, so the
     hole is real on all 31 grammars without any of them being edited.

     What is left here is a REVEAL, not a frame: a jamb return each side and a
     head band above, in the host's own wall colour a couple of shades down,
     so the opening reads as a hole in this building's wall rather than as a
     white sticker on it.                                                    */
  F.door = function (ctx, opts) {
    opts = opts || {};
    if (ctx.__kitDoor) return;                 // one door per building
    ctx.__kitDoor = true;
    const e = F.entrance(ctx);
    if (e.driveIn) return;                     // a vehicle bay is its own opening
    const f = e.f;
    const W = opts.width || F.DOOR_W;
    const H = opts.height || F.DOOR_H;
    const P = opts.proj || 0.30;
    // The reveal is the wall's own colour, darkened — the shading of a return
    // face turned away from the sun. Never a contrast trim: this is the wall
    // going round a corner into a hole, and that is what it should look like.
    const base = opts.wall != null ? opts.wall : ctx.color;
    const jamb = opts.jamb != null ? opts.jamb : F.shade(base, 0.86);
    const soffit = opts.soffit != null ? opts.soffit : F.shade(base, 0.62);

    for (const sg of [-1, 1]) {
      F.rib(ctx, f, sg * (W / 2 + 0.11), 0, H + 0.04, 0.22, P, jamb, -0.02);
    }
    F.box(ctx, f, 0, H + 0.13, W + 0.44, 0.22, P, jamb, -0.02);
    F.box(ctx, f, 0, H + 0.02, W + 0.06, 0.14, P * 0.55, soffit, -0.01);
    // a threshold you can see you are meant to walk over, flush enough that
    // nothing in physics has to know about it
    F.box(ctx, f, 0, 0.05, W + 0.30, 0.10, P + 0.16, jamb, -0.02);
  };

  // The shell's real doorway, so a facade and the carve agree on where the
  // hole is: buildings.js DOORW / DOORH, plus the margin a reveal needs.
  F.DOOR_W = 1.6;
  F.DOOR_H = 2.25;

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
  function resolve(dress, hash, storeys) {
    if (!on("FACADE_KIT")) return null;
    // `dress: false` is a call site saying "this building already has its
    // grammar, keep the city pick off it". govcomplex.js's civic shells carry
    // buildings_civic.js's own order + crown; before this opt-out existed the
    // city-wide hash pick landed a Tudor manor on the Executive Mansion and a
    // pagoda on its West Wing, on top of the doric order and the dome.
    if (dress === false) return null;
    let spec = dress || null;
    // CITY-WIDE MODE (off by default): give an undressed building a style by
    // position hash. Deterministic — lot #23's style is decidable without
    // building lots 0..22 — and it never draws from the rng stream. The
    // candidate pool is filtered to grammars that suit the building's HEIGHT,
    // so a tower gets a tower facade and a shop does not.
    if (!spec && on("FACADE_KIT_CITY") && REG.size && hash) {
      const st = storeys || 1;
      let ids = Array.from(REG.keys()).sort()
        .filter(function (k) { const d = REG.get(k); return st >= d.minStoreys && st <= d.maxStoreys; });
      if (!ids.length) ids = Array.from(REG.keys()).sort();
      spec = { style: ids[Math.min(ids.length - 1, (hash(0x7ac1) * ids.length) | 0)] };
    }
    if (!spec || !spec.style) return null;
    const def = REG.get(spec.style);
    return def ? { def: def, spec: spec } : null;
  }

  /* WHICH GRAMMAR IS THIS BUILDING WEARING? Asked LONG AFTER it was built.

     resolve() is the single source of truth for that question, and it was
     private, so anybody downstream who needed the answer had to re-derive it
     — and would get it wrong the moment the candidate pool, the storey filter
     or the hash salt changed here. city/collapse.js needs it (a grammar
     declares what it is MADE OF, which decides whether the building pancakes
     or topples), and it is exactly the kind of question that must never be
     answered twice.

     Same two arguments the host passes: the building's world origin (which is
     what the position hash is over) and its storey count. `dress` is the call
     site's explicit spec when it had one. Returns the style id or null. */
  CBZ.facadePick = function (ox, oz, storeys, dress) {
    const r = resolve(dress === false ? false : (dress || null),
      function (salt) { return CBZ.hash01 ? CBZ.hash01(ox, oz, salt) : 0.42; },
      storeys);
    return r ? r.spec.style : null;
  };

  // WILL THIS FACADE TAKE THE ROOF? Asked BEFORE the shell is built, because
  // buildings.js decides its own setback crown and corner finials hundreds of
  // lines before dressFacade() runs. Without this the host grows a spire
  // through a dome, a minaret or a mansard — two crowns on one roof.
  CBZ.facadeCrownsRoof = function (dress, hash, storeys) {
    const r = resolve(dress, hash, storeys);
    return !!(r && r.def.crownsRoof);
  };

  /* ============================================================
     KEEP-CLEAR COLUMNS AND THE CROWN DECK
     ============================================================
     OWNER (Natural Disaster Survival, on a tablet): "the elevator isn't
     getting me to the top of the building ... because of the facade."

     Measured, not guessed (a plain-node run of every grammar at the island's
     tower numbers): the ten skyline grammars build 5 to 45 m of REAL-LOOKING
     volume above ctx.rTop (bundled tubes, a pencil's slim shaft, a ziggurat's
     stages, a neogothic crown, a pyramid cap), and 9 of the 10 stand some of
     it squarely over the middle of the roof. The host's lift ran to rTop and
     stopped there, so you arrived INSIDE the crown: boxes all round your head,
     the building's visible top 20-45 m further up, nothing to stand on.

     Two things fix it at the source, for any host:

       ctx.keepClear  [{x0,x1,z0,z1,y0,y1?}] in building-local metres. Any box
                      a grammar lays through one of these volumes is re-emitted
                      as the pieces AROUND it (the same move as the door carve
                      below), so a lift shaft runs cleanly up through a crown
                      and its walls read as the shaft's walls. A round
                      primitive (dome, cone, column, ball) cannot be split, so
                      one that fouls a column is left out.
       ctx.crown      filled in by dressFacade: every box that stands above
                      rTop - 0.3 after the carve.
     CBZ.facadeLiftTop (below) decides both BEFORE the build: where the lift
     comes out and which volumes the grammar has to leave open for it.     */
  function hitsClear(cols, x0, x1, y0, y1, z0, z1) {
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i], cy1 = c.y1 != null ? c.y1 : Infinity;
      if (x1 > c.x0 + 1e-4 && x0 < c.x1 - 1e-4 && z1 > c.z0 + 1e-4 && z0 < c.z1 - 1e-4 &&
          y1 > c.y0 + 1e-4 && y0 < cy1 - 1e-4) return c;
    }
    return null;
  }
  // AABB minus AABB: up to six pieces (left/right in x, then front/back in z
  // over the middle x span, then below/above in y over the middle xz cell)
  function subtractBox(b, c) {
    const out = [];
    let [x0, x1, y0, y1, z0, z1] = b;
    const cy1 = c.y1 != null ? c.y1 : Infinity;
    if (x0 < c.x0) { out.push([x0, c.x0, y0, y1, z0, z1]); x0 = c.x0; }
    if (x1 > c.x1) { out.push([c.x1, x1, y0, y1, z0, z1]); x1 = c.x1; }
    if (z0 < c.z0) { out.push([x0, x1, y0, y1, z0, c.z0]); z0 = c.z0; }
    if (z1 > c.z1) { out.push([x0, x1, y0, y1, c.z1, z1]); z1 = c.z1; }
    if (y0 < c.y0) out.push([x0, x1, y0, c.y0, z0, z1]);
    if (y1 > cy1) out.push([x0, x1, cy1, y1, z0, z1]);
    return out.filter(function (p) { return p[1] - p[0] > 0.02 && p[3] - p[2] > 0.02 && p[5] - p[4] > 0.02; });
  }
  // shared with hosts that cut openings through their own boxes (the island's
  // glazing pass cuts window holes through the shell and the cladding with it)
  F.subtractBox = subtractBox;

  /* WHERE DOES A LIFT UP THROUGH THIS FACADE COME OUT?
     Asked BEFORE the facade is built, because the answer decides what the
     grammar may lay there. CBZ.facadeCrownProbe dry-runs the grammar against
     recording emitters (a grammar is pure: ctx in, emitter calls out, no rng,
     no scene graph, so running it twice is safe) and returns every piece that
     stands above rTop - 0.3 as [x0,x1,y0,y1,z0,z1] in building-local metres.

     CBZ.facadeLiftTop(ctx, shaft, o) then reads that crown over a lift shaft
     rect {x0,x1,z0,z1}:
       y        the TOP OF THE CROWN'S MASS over the shaft: the highest level
                where at least half of the shaft's own square is inside solid
                crown. A ziggurat keeps every stage and the lift comes out on
                the top one, a pencil at the top of its slim shaft, a pyramid
                where its section is still as wide as the car. No crown over
                the shaft: y is rTop (the host's own roof).
       deck     {x0,x1,z0,z1}: the shaft plus as much of an o.ring-metre
                apron round it as has headroom. The host lays a real deck slab
                here (it may oversail a narrow top stage, the way a sky deck
                does), with a rail.
       keepClear  what to hand dressFacade so the lift can reach y: the shaft
                column hollowed from the roof to the headroom over the top.
       headhouse  something stands over the shaft above that: the host roofs
                the top stop so it has something to stand on.
       roofBuried  true when the crown fills the host roof round the shaft, so
                a lift stop AT rTop would open onto the inside of the crown. */
  CBZ.facadeCrownProbe = function (ctx) {
    const r = resolve(ctx.dress, ctx.hash, ctx.storeys);
    if (!r) return [];
    const pieces = [], yRec = (ctx.rTop || 0) - 0.3;
    const rec = function (x0, x1, y0, y1, z0, z1) { if (y1 > yRec) pieces.push([x0, x1, y0, y1, z0, z1]); };
    const nop = function () {};
    const bx = function (x, y, z, w, h, d) { rec(x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2); };
    const dry = Object.assign({}, ctx, {
      keepClear: null, doorTint: null, crown: null,
      dbox: bx, lbox: bx, plat: nop, lamp: nop, disc: nop, plaque: nop, seal: nop,
      ball: function (x, y, z, rr) { rec(x - rr, x + rr, y - rr, y + rr, z - rr, z + rr); },
      column: function (x, y, z, rr, h) { rec(x - rr, x + rr, y, y + h, z - rr, z + rr); },
      cone: function (x, y, z, rr, h) { rec(x - rr, x + rr, y, y + h, z - rr, z + rr); },
      dome: function (x, y, z, rr) { rec(x - rr, x + rr, y, y + rr, z - rr, z + rr); },
    });
    try { r.def.build(dry, F, r.spec); } catch (e) { /* the real pass reports it */ }
    return pieces;
  };
  CBZ.facadeLiftTop = function (ctx, shaft, o) {
    o = o || {};
    const rTop = ctx.rTop, ring = o.ring != null ? o.ring : 1.1, thin = o.thin != null ? o.thin : 0.6;
    const wt = ctx.WT || 0.3;
    const lim = {
      x0: Math.max(-ctx.w / 2 + wt, shaft.x0 - ring), x1: Math.min(ctx.w / 2 - wt, shaft.x1 + ring),
      z0: Math.max(-ctx.d / 2 + wt, shaft.z0 - ring), z1: Math.min(ctx.d / 2 - wt, shaft.z1 + ring),
    };
    const all = CBZ.facadeCrownProbe(ctx);
    // massive pieces only: a mast or a finial is not something to stand on
    const mass = all.filter(function (p) { return Math.min(p[1] - p[0], p[5] - p[4]) > thin; });
    const STEP = 0.3;
    function cover(y, R) {
      let n = 0, hit = 0;
      for (let x = R.x0 + STEP / 2; x < R.x1; x += STEP) for (let z = R.z0 + STEP / 2; z < R.z1; z += STEP) {
        n++;
        for (let i = 0; i < mass.length; i++) {
          const p = mass[i];
          if (x > p[0] && x < p[1] && z > p[4] && z < p[5] && p[2] < y && p[3] >= y) { hit++; break; }
        }
      }
      return n ? hit / n : 0;
    }
    // candidate levels: the top of every massive piece over the deck square
    const cands = [];
    for (let i = 0; i < mass.length; i++) {
      const p = mass[i];
      if (p[3] > rTop + 0.3 && p[1] > shaft.x0 && p[0] < shaft.x1 && p[5] > shaft.z0 && p[4] < shaft.z1) cands.push(p[3]);
    }
    cands.sort(function (a, b) { return b - a; });
    let y = rTop;
    for (let i = 0; i < cands.length; i++) {
      if (cover(cands[i] - 0.05, shaft) >= 0.5) { y = cands[i]; break; }
    }
    const raised = y > rTop + 0.3;
    /* The shaft is hollow from the roof to HEAD above the top stop. Whatever
       the grammar stands over the shaft ABOVE that (a needle, a finial, the
       last tiers of a ziggurat) is kept, and ends up standing on a lift
       HEADHOUSE the host builds there: a small room round the car with open
       sides, which is what a real tower's lift overrun is. So the silhouette
       keeps its spire and the car never rises into it.
       The DECK is then grown out from the shaft, a strip at a time up to
       `ring` metres, only while the strip has HEAD of clear air over it: a
       taller tube or quadrant standing beside the shaft stays whole and the
       deck simply stops at its wall. */
    const HEAD = o.head != null ? o.head : 2.6;
    const keepClear = [
      { x0: shaft.x0, x1: shaft.x1, z0: shaft.z0, z1: shaft.z1, y0: rTop - 0.2, y1: y + HEAD },
    ];
    function clear(x0, x1, z0, z1) {
      let n = 0, ok = 0;
      for (let x = x0 + 0.125; x < x1; x += 0.25) for (let z = z0 + 0.125; z < z1; z += 0.25) {
        n++;
        let hit = false;
        for (let i = 0; i < mass.length && !hit; i++) {
          const p = mass[i];
          hit = x > p[0] && x < p[1] && z > p[4] && z < p[5] && p[2] < y + HEAD && p[3] > y + 0.05;
        }
        if (!hit) ok++;
      }
      return n ? ok / n >= 0.9 : true;
    }
    const deck = { x0: shaft.x0, x1: shaft.x1, z0: shaft.z0, z1: shaft.z1 };
    for (let grew = true, guard = 0; grew && guard < 40; guard++) {
      grew = false;
      if (deck.x0 - 0.25 >= lim.x0 - 1e-6 && clear(deck.x0 - 0.25, deck.x0, deck.z0, deck.z1)) { deck.x0 -= 0.25; grew = true; }
      if (deck.x1 + 0.25 <= lim.x1 + 1e-6 && clear(deck.x1, deck.x1 + 0.25, deck.z0, deck.z1)) { deck.x1 += 0.25; grew = true; }
      if (deck.z0 - 0.25 >= lim.z0 - 1e-6 && clear(deck.x0, deck.x1, deck.z0 - 0.25, deck.z0)) { deck.z0 -= 0.25; grew = true; }
      if (deck.z1 + 0.25 <= lim.z1 + 1e-6 && clear(deck.x0, deck.x1, deck.z1, deck.z1 + 0.25)) { deck.z1 += 0.25; grew = true; }
    }
    let spire = false;
    for (let i = 0; i < all.length && !spire; i++) {
      const p = all[i];
      if (p[3] > y + HEAD + 0.05 && p[1] > shaft.x0 && p[0] < shaft.x1 && p[5] > shaft.z0 && p[4] < shaft.z1) spire = true;
    }
    return { y: y, raised: raised, deck: deck, keepClear: keepClear, head: HEAD,
      // something stands over the shaft above the headroom: the host roofs the
      // car's top stop with a headhouse for it to stand on
      headhouse: spire,
      roofBuried: raised && cover(rTop + 1.2, lim) > 0.3 };
  };

  CBZ.dressFacade = function (ctx) {
    const r = resolve(ctx.dress, ctx.hash, ctx.storeys);
    if (!r) return null;

    // ---- keep-clear carve + crown record (see KEEP-CLEAR COLUMNS above) ----
    const keep = Array.isArray(ctx.keepClear) && ctx.keepClear.length ? ctx.keepClear : null;
    const crown = { boxes: [] };
    ctx.crown = crown;
    const yRec = (ctx.rTop || 0) - 0.3;
    const origDbox = ctx.dbox, origLbox = ctx.lbox;
    function carving(fn) {
      if (typeof fn !== "function") return fn;
      const emit = function (x, y, z, w, h, d) {
        const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h / 2, y1 = y + h / 2, z0 = z - d / 2, z1 = z + d / 2;
        const c = keep ? hitsClear(keep, x0, x1, y0, y1, z0, z1) : null;
        if (c) {
          const rest = Array.prototype.slice.call(arguments, 6);
          const parts = subtractBox([x0, x1, y0, y1, z0, z1], c);
          for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            emit.apply(this, [(p[0] + p[1]) / 2, (p[2] + p[3]) / 2, (p[4] + p[5]) / 2,
              p[1] - p[0], p[3] - p[2], p[5] - p[4]].concat(rest));
          }
          return;
        }
        if (y1 > yRec) crown.boxes.push([x0, x1, y0, y1, z0, z1]);
        return fn.apply(this, arguments);
      };
      return emit;
    }
    // a round primitive cannot be split: recorded for the crown, dropped if
    // it stands in a keep-clear column
    const roundWraps = {};
    function roundGuard(name, ext) {
      const fn = ctx[name];
      if (typeof fn !== "function") return;
      roundWraps[name] = fn;
      ctx[name] = function () {
        const e = ext.apply(null, arguments);
        if (keep && hitsClear(keep, e[0], e[1], e[2], e[3], e[4], e[5])) return;
        if (e[3] > yRec) crown.boxes.push(e);
        return fn.apply(this, arguments);
      };
    }
    roundGuard("ball", function (x, y, z, r) { return [x - r, x + r, y - r, y + r, z - r, z + r]; });
    roundGuard("column", function (x, y, z, r, h) { return [x - r, x + r, y, y + h, z - r, z + r]; });
    roundGuard("cone", function (x, y, z, r, h) { return [x - r, x + r, y, y + h, z - r, z + r]; });
    roundGuard("dome", function (x, y, z, r) { return [x - r, x + r, y, y + r, z - r, z + r]; });
    ctx.dbox = carving(origDbox);
    if (origLbox) ctx.lbox = carving(origLbox);

    /* CUT THE HOLE. Every box a facade lays on the entrance face is checked
       against the doorway, and any box that would cover it is re-emitted as
       the pieces AROUND it — left of the opening, right of it, and over its
       head — instead of being drawn across it. That is the same move
       stone.js makes by hand with runBand, applied to all 31 grammars at once
       without editing any of them, and it is what puts a real hole in front
       of buildings.js's real door: the hinged leaf, its vision pane, its push
       bar and its collider are all still there, and now you can see and reach
       them.

       Only boxes on the doorway's own face, standing at or outside the wall
       plane, are touched — nothing inside the building, nothing on the other
       three faces, and nothing above the door head. A facade that already
       leaves its own opening (stone, brick, greekrev) emits nothing that
       overlaps, so the carve is a no-op for it and costs one comparison.

       DEPTH is measured at the same time: the doorcase has to stand proud of
       whatever the facade clad the wall with, and the deepest box seen at the
       entrance is what it stands proud of. */
    const face = F.face(ctx, ctx.doorSide);
    const halfN = face.halfN, horiz = face.horiz, out = face.out;
    const e0 = F.entrance(ctx);
    const HW = (e0.driveIn ? e0.gap : F.DOOR_W) / 2 + 0.16;   // half the hole
    const HH = (e0.driveIn ? e0.head : F.DOOR_H) + 0.12;      // its head
    let deepest = 0;
    /* THE WALL'S OWN COLOUR, taken from the wall we cut through. ctx.color is
       the shell's base tone, but every grammar repaints its walls in its own
       palette — an adobe's earth, a brick's red — so a reveal shaded off
       ctx.color comes out the wrong colour on exactly the buildings that care
       most. The widest box the carve cuts through IS the wall at the door, so
       its colour is what the returns are shaded from. */
    let wallCol = null, wallSpan = 0;
    /* THE FACADE'S OWN PALETTE, gathered as it paints. Every colour it lays on
       the entrance face is weighted by the area it covers, so the door can be
       painted in a colour that is genuinely OFF THIS BUILDING rather than in
       one tone shared by all 31 grammars. */
    const palette = new Map();
    const realDbox = ctx.dbox;
    ctx.dbox = function (x, y, z, w, h, d, col) {
      const tC = horiz ? x : z, tH = (horiz ? w : d) / 2;      // along the face
      const nC = horiz ? z : x, nH = (horiz ? d : w) / 2;      // across it
      const y0 = y - h / 2, y1 = y + h / 2;
      // how far this box's outer surface stands proud of the wall plane
      const proud = out > 0 ? (nC + nH) - halfN : -halfN - (nC - nH);
      const onFace = proud > -0.02;
      if (onFace && h > 0.12 && tH > 0.06) {
        palette.set(col, (palette.get(col) || 0) + tH * 2 * h);
      }
      if (!onFace || y0 > HH || y1 < 0 ||
          tC - tH > HW || tC + tH < -HW) {
        if (onFace && proud > deepest && proud < 6.5 &&
            Math.abs(tC) < 2.2 + tH && y0 < 3.4) deepest = proud;
        return realDbox.apply(this, arguments);
      }
      if (proud > deepest && proud < 6.5) deepest = proud;
      if (tH * 2 > wallSpan && h > 0.5) { wallSpan = tH * 2; wallCol = col; }
      // ---- the box crosses the doorway: emit what is left of it ----------
      const t0 = tC - tH, t1 = tC + tH;
      const put = function (ta, tb, ya, yb) {
        const tw = tb - ta, hh = yb - ya;
        if (tw < 0.02 || hh < 0.02) return;
        const tc = (ta + tb) / 2, yc = (ya + yb) / 2;
        if (horiz) realDbox.call(this, tc, yc, z, tw, hh, d, col);
        else realDbox.call(this, x, yc, tc, w, hh, tw, col);
      };
      if (t0 < -HW) put(t0, Math.min(t1, -HW), y0, y1);        // left of the hole
      if (t1 > HW) put(Math.max(t0, HW), t1, y0, y1);          // right of it
      if (y1 > HH) put(Math.max(t0, -HW), Math.min(t1, HW), HH, y1);   // over the head
      if (y0 < 0) put(Math.max(t0, -HW), Math.min(t1, HW), y0, 0);     // under the sill
    };

    try { r.def.build(ctx, F, r.spec); }
    catch (e) { if (window.console) console.warn("facade " + r.spec.style + ": " + e.message); }
    // the carves are build-time only
    ctx.dbox = origDbox;
    if (origLbox) ctx.lbox = origLbox;
    for (const k in roundWraps) ctx[k] = roundWraps[k];

    const doorProj = Math.max(0.30, Math.min(6.5, deepest + 0.16));

    /* PAINT THE DOOR IN ONE OF THIS BUILDING'S OWN COLOURS.
       OWNER: "now door gets to match building colour somehow — beauty is it
       doesn't have to be perfect colour of building, just A colour from the
       building."
       That is the right instinct and an easier target than matching: the door
       wants to belong to the building, not to disappear into it. So the
       candidates are the colours the facade actually painted, weighted by how
       much wall each covers; anything too close in tone to the wall AT the
       door is dropped (a door the same value as its surround is the invisible
       slab we started with); and which of the survivors gets used is a
       position hash, so two brick lofts on one street do not have the same
       door and each one is the same on every boot. The stiles and rails take a
       lifted shade of whatever was picked, so the panelling still reads. */
    if (ctx.doorTint) {
      const lum = function (c) {
        return (((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114) / 255;
      };
      const wallL = lum(wallCol != null ? wallCol : ctx.color);
      const cands = [];
      palette.forEach(function (weight, col) {
        if (weight < 0.8) return;                       // a sliver, not a colour
        if (Math.abs(lum(col) - wallL) < 0.13) return;  // too close to the wall
        cands.push({ col: col, w: weight });
      });
      cands.sort(function (a, b) { return b.w - a.w; });
      const pool = cands.slice(0, 6);
      let leafHex;
      if (pool.length) leafHex = pool[Math.min(pool.length - 1, (ctx.hash(0xd0af) * pool.length) | 0)].col;
      else leafHex = F.shade(wallCol != null ? wallCol : ctx.color, 0.55);
      // keep it a door and not a light box: never brighter than its own wall
      if (lum(leafHex) > wallL + 0.10) leafHex = F.shade(leafHex, 0.72);
      const railHex = lum(leafHex) < 0.42 ? F.mix(leafHex, 0xffffff, 0.22) : F.shade(leafHex, 0.78);
      try { ctx.doorTint(leafHex, railHex); } catch (e) {}
    }
    // THE DOOR GUARANTEE. Every dressed building ends up with a legible
    // entrance whether or not its grammar thought about one: a facade that
    // drew its own called F.door (which latches ctx.__kitDoor) or declared
    // ownDoor, and everything else gets the kit's surround here. Emitted
    // AFTER build so it lands on top of whatever cladding the facade laid.
    if (!r.def.ownDoor) {
      try { F.door(ctx, { proj: doorProj, wall: wallCol }); } catch (e) {}
    }
    return r.def;
  };
})();
