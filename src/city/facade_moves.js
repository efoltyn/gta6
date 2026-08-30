/* ============================================================
   city/facade_moves.js — THE MOVE LIBRARY.

   WHY THIS FILE EXISTS
   --------------------
   The 31 grammars in city/facades/ are 15,168 lines. They decompose into 231
   named MOVES (`// 1. THE PODIUM`, `// 2. THE CROWN`, …) at an almost constant
   43 code lines per move. The reason a move costs 43 lines is that the shared
   vocabulary F is at the wrong altitude: it publishes 21 helpers and they are
   assembly language. F.box is called 614 times, F.shade/F.mix 449,
   F.rib/F.ring/F.band 336. There is no F.podium. So the kit contains eight
   hand-written podiums, seven crowns, six shafts, five chimney stacks and four
   roofs, each re-derived from boxes and each subtly different for no reason.

   This file adds the missing altitude. It does NOT touch facade_kit.js and it
   does NOT touch any of the 31 — they are the reference, not the patient. It
   extends CBZ.facadeF, which is the exact object handed to every
   build(ctx, F, spec), so every move below is instantly available to every
   grammar, old and new.

   HOW TO USE IT
   -------------
       CBZ.registerFacade("mycity", {
         label: "…", structure: "stone", crownsRoof: true,
         build: function (ctx, F, spec) {
           const P = F.palette(ctx, "lime");            // the whole colour set
           const pod = F.podium(ctx, { pal: P });       // plinth + walkable top
           F.pierBay(ctx, { pal: P, y0: pod.top });     // the wall
           const roof = F.hipRoof(ctx, { pal: P });     // the silhouette
           F.dormerRow(ctx, roof, { pal: P });
           F.chimneyStack(ctx, { roof: roof, pal: P });
         },
       });

   EVERY MOVE OBEYS THE KIT'S FOUR RULES
     1. Every dimension derives from the host: ctx.w, ctx.d, ctx.storeys,
        ctx.FH, ctx.rTop, F.bayCount(...). No constant assumes one building
        size. Each move is exercised at 11 m, 22 m and 34 m wide and at 1, 4
        and 40 storeys; a move that only works at one size is a decoration.
     2. Emission is ONLY through ctx (dbox / sbox / lbox / plat / column /
        dome / cone / ball). Never THREE, the scene graph, colliders or rng.
     3. Variation is ONLY ctx.hash(salt). No Math.random, no rng stream.
     4. Cost: merged boxes are free (they fold into the host's deco buckets
        before flushDeco). ctx.column/dome/ball/cone mint REAL meshes and are
        not — F.mesh(ctx, n) is the shared budget (36 per building); every
        mesh-minting move below asks it first and degrades to boxes when the
        budget is gone, so a facade can never blow the count by accident.

   SOLID vs FREE — WHICH EMITTER A MOVE USES
   -----------------------------------------
   OWNER: "beautiful simple facades should all have colliders and not be able
   to just run thru them."

   ctx.dbox draws and pushes NO collider. ctx.sbox draws through the same free
   merged path AND pushes one collider AABB, and it auto-skips that collider
   for anything a player cannot walk into (bottom more than ~2.6 m above the
   nearest walkable surface, or under ~0.35 m in both horizontal dimensions),
   so mouldings and crowns stay free without anyone thinking about it.

   ctx.sbox may not exist yet in a given build, so EVERY solid emission in this
   file goes through `F.solid(ctx)` (=== ctx.sbox || ctx.dbox), resolved once
   per move. Facades doing their own solid work must do the same:

       const S = F.solid(ctx);            // never call ctx.sbox directly

   SOLID (blocking mass, stands on the ground, thicker than a fence post):
     podium bodies · batter courses · rustication blocks · waterTable bodies
     pierBay piers and corner returns · arcade piers and imposts
     colonnade shafts, pedestals and pilasters · porch and veranda posts
     portal jambs and reveals · blindNiche jambs · setbackStack podium collar
     chimney bases at ground · steps cheeks · terraceRoof apron mass
   FREE (deco only — up in the air, or a moulding):
     every cornice, entablature, parapet, coping, dentil, string course
     all roofs (gable, hip, mansard, eaveTier, thatch), dormers, ridge crests
     crownStack, domeOnDrum, spire, finialRow, tracery, arch rings, sills
   ctx.plat is ORTHOGONAL and unchanged: it makes a top surface walkable and
   deliberately pushes no collider, so a monumental stair can never seal the
   building's own front door. A podium wants both — plat on top, solid below.

   ------------------------------------------------------------------
   THE API. Every move takes (ctx, o) with `o` optional; every number in `o`
   has a host-derived default, so `F.podium(ctx)` is a legal, correct podium.
   `o.pal` is a palette from F.palette and supplies every colour a move needs;
   individual colours can still be overridden by name.
   ------------------------------------------------------------------

   COLOUR
     F.palette(ctx, key, o?)      → {base,light,dark,trim,accent,shadow,roof,
                                     glass,course(k),key}
        A coherent set derived from an ERA KEY and the host's own
        ctx.pal.wall, so the building belongs to its district and to its era
        at once. o.pull (0..1) = how far from the district toward the era,
        o.host overrides the district colour. course(k) is a per-course tint
        for hand-laid materials (hashed, deterministic).
     F.PALETTES                   the key table. Keys:
        mud lime cinnabar polychrome timber laterite coral copper concrete
        bronzeglass ashlar sandstone granite brick terracotta marble basalt
        thatch whitewash
     F.paletteKeys()              → the key list (for a catalog/tool).

   PRIMITIVES this file adds to F (used by the moves, useful on their own)
     F.solid(ctx)                 → ctx.sbox || ctx.dbox  (resolve once)
     F.sBox(ctx,f,t,cy,len,h,proj,col,inset?)    F.box, emitted SOLID
     F.sRib(ctx,f,t,y0,y1,wid,proj,col,inset?)   F.rib, emitted SOLID
     F.obox(ctx,f,t,cy,len,h,dep,outN,col,solid?)
        a box on face f whose OUTER surface sits at normal distance outN from
        the building centre (F.box measures from the wall plane; this measures
        absolutely, which is what verandas, dormers and roof overhangs need).
     F.segBand(ctx,f,cy,h,proj,col,holes,over?,inset?)
        a band across a face drawn in SEGMENTS around `holes` ([[t0,t1],…]).
        Four facades hand-rolled this; it is how you put a real hole in merged
        axis-aligned geometry.
     F.doorHoles(ctx,f,pad?)      → [] or [[-hw,hw]] for the door on face f.
     F.mesh(ctx,n)                → how many of the n real meshes you may mint
                                    (shared 36-per-building budget).
     F.boxShaft(ctx,x,y0,z,h,r,col,lit?,solid?)
        a ROUND shaft with no mesh: three concentric boxes make an octagonal
        section that reads round at any distance a player stands, plus four
        lit slivers for the arrises. What every mesh-minting move here falls
        back to when the budget is spent.
     F.STEP_RISE                  0.42 — the tallest single rise a player walks
                                    up (physics STEP_UP is 0.45).

   BASE / BODY
     F.podium(ctx,o)   → {top,over,stepOver}
        Stepped plinth the building stands on + a walkable ctx.plat on top,
        capped at STEP_RISE unless o.top asks for more, in which case it grows
        its own ramped steps on the door face so it stays reachable.
        o: top over steps stepOver lip col capCol stairs(bool) walk(bool) pal
     F.batter(ctx,o)   → {n,cH,proj[],projAt(y),top}
        Courses that thicken toward the ground — earthen mass construction.
        Everything else on the wall measures off projAt(y).
        o: n top total(batter at foot) buttress(bool) grain col pal
     F.setbackStack(ctx,o) → {stages[{y0,y1,p}],top,topProj,joint(y,pl)}
        The 1916 zoning envelope. Cladding collars standing proud of the shell,
        stepping IN as they rise, with a designed junction (cornice, terrace
        deck, parapet, coping) at every step.
        o: n p0 piers(bool) glazed(bool) spandrels(bool) base(bool) pal
     F.waterTable(ctx,o) → {top}
        The course where the wall lands on its foundation: plinth, wash, drip.
        o: y h proj col capCol pal
     F.rustication(ctx,o) → {courses,cH}
        Alternating proud / recessed ashlar courses, cut around the doorway.
        o: y0 y1 courseH proj recess col dark holes faces pal

   WALL
     F.pierBay(ctx,o)  → {of(f)→{n,lines,bays,pierW,proj},pierW,top}
        Structural piers between the openings, corner returns, spandrel
        panels, sills and heads. The default masonry wall.
        o: y0 y1 per lo hi pierW proj margin spandrel(bool) sill(bool)
           head("arch"|"lintel"|null) archKind faces pal
     F.arcade(ctx,f,o) → {lines,spring,crown,holes}
        A run of arches on ONE face: piers, imposts, arch rings, keystones,
        a dark intrados so each arch reads as a hole, spandrel fill. Piers
        that would stand in the doorway are DROPPED, never nudged.
        o: y0 spring rise kind(round|pointed|horseshoe|segmental) n lines
           pierW proj depth key(bool) impost(bool) pal
     F.colonnade(ctx,o) → {t[],r,colY,colH,capH,entY,entTop,depth,cq,order}
        Columns + entablature SOLVED BACKWARDS from the roofline they must
        clear: entablature first, then the roof springs off it, then the shaft
        gets what is left. The central intercolumniation is widened until the
        door fits, which is the classical answer and the reason no column ever
        has to be dropped. Engaged (pilasters) or freestanding (portico).
        o: face clear entH count order(doric|ionic|tuscan|corinthian)
           engaged(bool) depth base ring(bool) round(bool) even(bool) pal
     F.blindNiche(ctx,f,o) → {top}          o.inset = the depth your CLADDING
                                            stands at (default 0.01 = the bare
                                            shell wall). Clad proud of it and
                                            forget this and the niche is buried.
        A recessed panel with an arched or flat head — the wall articulated
        where a culture has no window.
        o: t y0 h wid recess kind col dark sill(bool) pal
     F.openingGrid(ctx,o) → {count}         o.inset — same rule as blindNiche.
                                            A negative inset is inside the
                                            shell's solid wall box and is not
                                            drawn at all.
        THE CULTURE'S OWN WINDOWS, for a facade that declared wall:"own" and
        therefore has a solid wall with no glazing to frame.
        o: shape(rect|arch|lancet|slit|round|none) rows per storey, sill height
           frac, wid frac, reveal glass lintel(bool) sillOut(bool) blind(0..1)
           faces y0 y1 pal

   ROOF   (all three roofs return the same SLOPE DESCRIPTOR, so dormerRow,
           chimneyStack and ridgeCrest work against any of them:
           {kind,y0,h,top,pitch,nrm(f,u),tan(f,u),slopeOn(f)})
     F.gableRoof(ctx,o)  → slope    ridge on one axis, stepped courses
        o: axis("x"|"z") y0 rise pitch over courses ridgeCap verge lap pal
     F.hipRoof(ctx,o)    → slope    both axes narrow, hip ribs, ridge
        o: y0 h pitch over courses ribs(bool) ridge(bool) pal
     F.mansard(ctx,o)    → slope + {deckY,dW,dD}
        the top storey as a near-vertical slope with a flat deck and a
        cresting rail. o: y0 h inset courses over deck(bool) rail(bool) pal
     F.eaveTier(ctx,o)   → [lipY,…]
        Deep tiered East-Asian eaves with upturned corners and bracket sets.
        o: levels(true = one per storey, or [{y,proj}]) proj ch brackets(bool)
           upturn(bool) soffit(bool) gold pal
     F.thatch(ctx,o)     → slope
        A thick shaggy roof: ragged hashed courses, deep overhang, dark
        under-eave, a bound ridge. o: y0 h over gable(bool) courses pal
     F.terraceRoof(ctx,o) → {deckY,parTop,apron}
        A flat walkable roof: parapet, coping, canales, ctx.plat deck, and
        optionally a LOWER stepped mass on one flank (also walkable) — the
        pueblo silhouette. o: parH canales(bool) apron(bool) walk(bool) pal
     F.parapetWalk(ctx,o) → {parTop,deckY}
        Parapet + coping + walkable roof deck, optionally crenellated.
        o: h thick crenel(bool) merlonN walk(bool) col capCol pal
     F.cornice(ctx,o)    → {top}
        The wall head. kind: "plain" | "dentil" | "bracket" | "modillion" |
        "corbel". o: y kind depth pitch col dark faces pal
     F.dormerRow(ctx,slope,o) → {count}
        Dormers whose front plane is solved from the slope at their own top,
        so one can never sink into the roof it stands in.
        o: n dw dh hood("pediment"|"gable"|"shed") glass faces pal
     F.chimneyStack(ctx,o) → [{x,z,top,w}]
        Corbelled stacks with pots, rising out of the slope past the ridge.
        o: roof n along w top corbel(bool) pots(bool) courses(bool) pal
     F.ridgeCrest(ctx,o) → {top}
        What terminates a ridge: "iron" cresting, "tile" roll + owl-tails,
        "finial" posts. o: roof y axis len kind h pitch col pal

   FRONT
     F.steps(ctx,o)      → {depth,width,top}
        Cosmetic treads over ONE continuous ramp ctx.plat, so a sprinting
        player cannot sample a seam and no collider can seal the door.
        o: face top width depth treads cheeks(bool) col pal
     F.porch(ctx,o)      → {deckTop,eave,depth,width}
        A roofed entrance on the door face: deck, posts, beam, shed/gable/flat
        roof, steps. o: width depth deckTop posts roof eave rail(bool) pal
     F.veranda(ctx,o)    → {depth,deckTop,tX[],tZ[],colTop}
        The ground deck and, on a taller host, the two-storey gallery: posts
        round the perimeter, a deck at every floor line, balustrade runs
        between the posts. o: sides("all"|"front"|"L") depth deckTop storeys
        postPitch rail(bool) pal
     F.portal(ctx,o)     → {frameW,top,depth}
        A monumental recessed entrance: jambs, lintel, a recessed arch set
        back inside the frame, muqarnas or a tympanum in its head, a crest.
        o: width top depth kind recess muqarnas(bool) crest(bool) tile pal

   CROWN
     F.crownStack(ctx,o) → {top,w,d,cx,cz}
        The thing seven facades each hand-rolled: diminishing stages above
        rTop, each with its own cornice / deck / parapet, budgeted as a
        FRACTION of rTop (a crown is 30-45% of a building; a per-storey rule
        grows a second skyscraper on a tall block).
        o: stages budget bias piers(bool) glazed(bool) pal
     F.finialRow(ctx,o)  → {count}
        kind: "merlon" | "stepped" | "pinnacle" | "acroterion" | "ball" |
        "crocket". o: y n wid h proj kind faces col pal
     F.domeOnDrum(ctx,o) → {top,R,drumTop}
        A dome that is BUTTRESSED, not a ball on a box: stepped square
        substructure, drum, semi-domes on the four axes taking the thrust,
        weight turrets on the diagonals, finial. Degrades to stacked boxes
        when the mesh budget is spent. o: r drumH semis(bool) turrets(bool)
        finial(bool) meshes(bool) pal
     F.spire(ctx,o)      → {top}
        A stepped tapering spire with an optional broach base, mast and ball.
        o: cx cz y base h steps taper concave(bool) mast(bool) ball(bool) pal

   LOAD ORDER: after city/facade_kit.js (it needs CBZ.facadeF), before
   city/facades/*.js. One <script> line in index.html, nothing else.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const F = CBZ && CBZ.facadeF;
  if (!F) return;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
  function unitOf(ctx) { return Math.min(ctx.w, ctx.d); }

  // ============================================================
  //  0. PRIMITIVES THE MOVES ARE BUILT OUT OF
  // ============================================================

  // The tallest single rise a player walks up without jumping (physics
  // STEP_UP is 0.45; 0.42 leaves the margin every walkable move in the kit
  // has always left — see pagoda.js's podium).
  F.STEP_RISE = 0.42;

  /* THE SOLID EMITTER, resolved per call site. ctx.sbox draws through the
     same free merged path as dbox AND pushes a collider AABB, auto-skipping
     the collider for anything unreachable. It may not exist in a given build,
     so nothing in the kit may ever call it directly. */
  F.solid = function (ctx) { return ctx.sbox || ctx.dbox; };

  // F.box / F.rib, emitted SOLID. Same arguments, same meaning.
  F.sBox = function (ctx, f, t, cy, len, h, proj, col, inset) {
    if (!(proj > 0) || !(h > 0) || !(len > 0)) return;
    const S = F.solid(ctx);
    const n = f.halfN + (inset || 0) + proj / 2;
    if (f.horiz) S(t, cy, f.out * n, len, h, proj, col);
    else S(f.out * n, cy, t, proj, h, len, col);
  };
  F.sRib = function (ctx, f, t, y0, y1, wid, proj, col, inset) {
    if (y1 <= y0) return;
    F.sBox(ctx, f, t, (y0 + y1) / 2, wid, y1 - y0, proj, col, inset);
  };

  /* A box on face `f` whose OUTER SURFACE sits at normal distance `outN` from
     the building centre. F.box measures projection from the wall plane, which
     is right for cladding and wrong for everything that stands off the
     building — a veranda deck, a dormer face, a roof overhang — where what
     you know is where the outer plane IS. */
  F.obox = function (ctx, f, t, cy, len, h, dep, outN, col, isSolid) {
    if (!(dep > 0) || !(h > 0) || !(len > 0)) return;
    const E = isSolid ? F.solid(ctx) : ctx.dbox;
    const n = outN - dep / 2;
    if (f.horiz) E(t, cy, f.out * n, len, h, dep, col);
    else E(f.out * n, cy, t, dep, h, len, col);
  };

  /* A BAND DRAWN IN SEGMENTS AROUND HOLES. You cannot cut a hole in merged
     axis-aligned geometry; you decline to draw over it. greekrev, stone,
     romanvilla and neogothic each wrote this function. Here it is once.
     `holes` is [[t0,t1], …] in face-tangent coordinates. */
  F.segBand = function (ctx, f, cy, h, proj, col, holes, over, inset, isSolid) {
    const L = -f.span / 2 - (over == null ? 0.12 : over), R = -L;
    const put = isSolid ? F.sBox : F.box;
    let x = L;
    const hs = (holes || []).slice().sort(function (a, b) { return a[0] - b[0]; });
    for (let i = 0; i < hs.length; i++) {
      const a = Math.max(L, hs[i][0]), b = Math.min(R, hs[i][1]);
      if (b <= x) continue;
      if (a - x > 0.05) put(ctx, f, (x + a) / 2, cy, a - x, h, proj, col, inset);
      x = b;
    }
    if (R - x > 0.05) put(ctx, f, (x + R) / 2, cy, R - x, h, proj, col, inset);
  };

  // The doorway as a hole list for segBand — empty on the three other faces.
  F.doorHoles = function (ctx, f, pad) {
    if (f.s !== ctx.doorSide) return [];
    const e = F.entrance(ctx);
    const hw = e.gap / 2 + (pad == null ? 0.5 : pad);
    return [[-hw, hw]];
  };

  /* THE MESH BUDGET. ctx.column / dome / cone / ball each mint a real mesh and
     a dressed building's working budget is about 40. Every mesh-minting move
     below asks for what it wants and takes what it is given, so a facade that
     stacks a colonnade, a dome and a minaret degrades gracefully to boxes
     instead of quietly costing 90 draw calls. */
  F.MESH_BUDGET = 36;
  F.mesh = function (ctx, n) {
    ctx.__fmMesh = ctx.__fmMesh || 0;
    const got = Math.max(0, Math.min(n | 0, F.MESH_BUDGET - ctx.__fmMesh));
    ctx.__fmMesh += got;
    return got;
  };

  /* A ROUND SHAFT WITHOUT A MESH. Three concentric boxes make an octagonal
     section that reads round at every distance a player stands, and it is
     free. adobe.js proved it on the vigas; this is the vertical version, and
     it is what colonnade/porch/veranda fall back to when the budget is out. */
  function boxShaft(ctx, x, y0, z, h, r, col, lit, isSolid) {
    if (!(h > 0) || !(r > 0)) return;
    const E = isSolid ? F.solid(ctx) : ctx.dbox;
    const cy = y0 + h / 2;
    E(x, cy, z, r * 1.98, h, r * 1.10, col);
    E(x, cy, z, r * 1.10, h, r * 1.98, col);
    E(x, cy, z, r * 1.62, h, r * 1.62, col);
    // the lit centre and dark arrises of a turned shaft, four free boxes
    if (lit != null) {
      for (const sg of [-1, 1]) {
        ctx.dbox(x + sg * r * 0.86, cy, z, 0.05, h - 0.08, r * 0.72, lit);
        ctx.dbox(x, cy, z + sg * r * 0.86, r * 0.72, h - 0.08, 0.05, lit);
      }
    }
  }
  F.boxShaft = boxShaft;

  // ============================================================
  //  1. COLOUR — THE ERA PALETTES
  // ============================================================
  /* Every facade in the kit opens with 8-15 hand-written F.mix / F.shade
     consts, and every one of them is solving the same problem: pull the
     host's district colour toward what this culture actually built out of,
     then derive a coherent light / dark / trim / accent / shadow set off the
     result. Doing that by hand is how you get 31 different answers to one
     question and a facade that goes white the moment the district is pale.

     Each entry is a MATERIAL, not a style: `hue` is what the stuff is,
     `pull` is how far past the district we drag it, and the rest are the
     relationships that make a set read as one building. */
  F.PALETTES = {
    // earth and mud
    mud:        { hue: 0xa2653a, pull: 0.90, dim: 0.86, lite: 0xe8b783, liteT: 0.26, darkF: 0.74, shadF: 0.42, trimHue: 0x50412f, trimT: 0.58, accent: 0x8c6a3f, roof: 0x6e5539, glass: 0x241a12, grain: 0.22 },
    laterite:   { hue: 0x8a5238, pull: 0.88, dim: 0.90, lite: 0xb57a56, liteT: 0.26, darkF: 0.72, shadF: 0.44, trimHue: 0x5c3626, trimT: 0.50, accent: 0x6e7b5a, roof: 0x6b4230, glass: 0x1e1512, grain: 0.30 },
    coral:      { hue: 0xd8cdb6, pull: 0.80, dim: 0.96, lite: 0xf3ecda, liteT: 0.30, darkF: 0.80, shadF: 0.52, trimHue: 0x8e8b7a, trimT: 0.50, accent: 0x2f6e6b, roof: 0x8f7a5e, glass: 0x1c2422, grain: 0.28 },
    // plaster and paint
    lime:       { hue: 0xede6d2, pull: 0.78, dim: 0.98, lite: 0xfffdf2, liteT: 0.34, darkF: 0.84, shadF: 0.58, trimHue: 0xb9ae95, trimT: 0.50, accent: 0x2e5d6e, roof: 0xa85a3c, glass: 0x1a2027, grain: 0.08 },
    whitewash:  { hue: 0xf2f0e6, pull: 0.82, dim: 1.00, lite: 0xffffff, liteT: 0.30, darkF: 0.84, shadF: 0.56, trimHue: 0x3a6a8c, trimT: 0.44, accent: 0x2a5c86, roof: 0x8e5a46, glass: 0x1b2128, grain: 0.08 },
    polychrome: { hue: 0xe4d9be, pull: 0.70, dim: 0.98, lite: 0xfff6df, liteT: 0.30, darkF: 0.80, shadF: 0.52, trimHue: 0xc24a2c, trimT: 0.55, accent: 0x1f5fa0, roof: 0xb4462b, glass: 0x20242b, grain: 0.06 },
    // stone
    ashlar:     { hue: 0xb6ac96, pull: 0.78, dim: 0.94, lite: 0xd8d0bb, liteT: 0.28, darkF: 0.80, shadF: 0.52, trimHue: 0x8c8472, trimT: 0.50, accent: 0x6e6a5a, roof: 0x5f6668, glass: 0x161c24, grain: 0.10 },
    sandstone:  { hue: 0xc08a55, pull: 0.82, dim: 0.94, lite: 0xe3b786, liteT: 0.26, darkF: 0.76, shadF: 0.48, trimHue: 0x8a6a46, trimT: 0.50, accent: 0x9c5a34, roof: 0x8e5a3a, glass: 0x1f1a16, grain: 0.20 },
    granite:    { hue: 0x77746e, pull: 0.84, dim: 0.92, lite: 0x9e9b94, liteT: 0.26, darkF: 0.74, shadF: 0.48, trimHue: 0x55534e, trimT: 0.50, accent: 0x8a6a5a, roof: 0x4e5257, glass: 0x141920, grain: 0.14 },
    marble:     { hue: 0xefede4, pull: 0.72, dim: 1.00, lite: 0xfffffa, liteT: 0.28, darkF: 0.86, shadF: 0.60, trimHue: 0xcfc9b8, trimT: 0.50, accent: 0x9a6e4a, roof: 0x8c939a, glass: 0x1a2028, grain: 0.05 },
    basalt:     { hue: 0x3e4247, pull: 0.90, dim: 1.00, lite: 0x6a6f76, liteT: 0.30, darkF: 0.70, shadF: 0.44, trimHue: 0x8a8f94, trimT: 0.40, accent: 0xa85a3c, roof: 0x2e3236, glass: 0x101418, grain: 0.18 },
    // fired clay
    brick:      { hue: 0x8e4433, pull: 0.86, dim: 0.92, lite: 0xb2664b, liteT: 0.26, darkF: 0.72, shadF: 0.46, trimHue: 0xc9bfa6, trimT: 0.45, accent: 0x3e4a55, roof: 0x5a544e, glass: 0x171c22, grain: 0.24 },
    terracotta: { hue: 0xb05a34, pull: 0.86, dim: 0.94, lite: 0xd98a5e, liteT: 0.26, darkF: 0.74, shadF: 0.46, trimHue: 0xe0d6bc, trimT: 0.45, accent: 0x2f6e6b, roof: 0x9c4e2e, glass: 0x1c1714, grain: 0.22 },
    // organic
    timber:     { hue: 0x6b573e, pull: 0.86, dim: 0.94, lite: 0xa8906e, liteT: 0.30, darkF: 0.70, shadF: 0.46, trimHue: 0x3a2e22, trimT: 0.50, accent: 0x8f7248, roof: 0x4a4038, glass: 0x161a1c, grain: 0.26 },
    thatch:     { hue: 0xb79a5c, pull: 0.88, dim: 0.92, lite: 0xd9be84, liteT: 0.28, darkF: 0.70, shadF: 0.44, trimHue: 0x6b5a3e, trimT: 0.50, accent: 0x8a6a3e, roof: 0x9a7f4a, glass: 0x1a160f, grain: 0.34 },
    cinnabar:   { hue: 0xa03020, pull: 0.84, dim: 1.00, lite: 0xd9694e, liteT: 0.28, darkF: 0.72, shadF: 0.48, trimHue: 0xc9a23e, trimT: 0.55, accent: 0xc9a23e, roof: 0x2f4a37, glass: 0x191410, grain: 0.10 },
    // metal, concrete, glass
    copper:     { hue: 0x4e9c86, pull: 0.80, dim: 0.95, lite: 0x7fc8ae, liteT: 0.28, darkF: 0.70, shadF: 0.46, trimHue: 0x2f5e52, trimT: 0.50, accent: 0xb87333, roof: 0x3e7f6c, glass: 0x141a19, grain: 0.16 },
    concrete:   { hue: 0x9a9a94, pull: 0.82, dim: 0.90, lite: 0xc0bfb8, liteT: 0.26, darkF: 0.74, shadF: 0.50, trimHue: 0x6e6e68, trimT: 0.50, accent: 0x50524f, roof: 0x7a7a74, glass: 0x171b1f, grain: 0.12 },
    bronzeglass:{ hue: 0x6b5a3e, pull: 0.70, dim: 0.95, lite: 0xa08a5e, liteT: 0.28, darkF: 0.68, shadF: 0.42, trimHue: 0x3b3226, trimT: 0.50, accent: 0xc8a05a, roof: 0x2a2620, glass: 0x1b1a16, grain: 0.05 },
  };
  F.paletteKeys = function () { return Object.keys(F.PALETTES); };

  F.palette = function (ctx, key, o) {
    o = o || {};
    const e = F.PALETTES[key] || F.PALETTES.lime;
    const host = num(o.host, (ctx.pal && ctx.pal.wall) || ctx.color);
    const pull = clamp(num(o.pull, e.pull), 0, 1);
    const base = F.shade(F.mix(host, e.hue, pull), num(o.dim, e.dim));
    const light = F.mix(base, e.lite, e.liteT);
    const dark = F.shade(base, e.darkF);
    const shadow = F.shade(base, e.shadF);
    const trim = F.mix(base, e.trimHue, e.trimT);
    const accent = F.mix(e.accent, base, 0.14);
    const roof = F.mix(e.roof, base, 0.12);
    const glass = F.mix(e.glass, base, 0.08);
    const grain = clamp(num(o.grain, e.grain), 0, 1);
    const salt = num(o.salt, 0x9f00);
    return {
      key: F.PALETTES[key] ? key : "lime",
      base: base, light: light, dark: dark, trim: trim,
      accent: accent, shadow: shadow, roof: roof, glass: glass,
      // A HAND-LAID COURSE'S OWN TINT. No two lifts of plaster, no two loads
      // of brick and no two runs of thatch match; `grain` is how much they
      // differ. Deterministic — ctx.hash is the only source of variation.
      course: function (k) {
        if (grain <= 0.001) return base;
        const a = ctx.hash(salt + (k | 0) * 7), b = ctx.hash(salt + (k | 0) * 7 + 3);
        return F.shade(F.mix(base, light, a * grain * 1.6), 1 - grain * 0.5 + b * grain);
      },
    };
  };

  // resolve a palette argument: an explicit palette object, a key, or lime.
  function P(ctx, o) {
    if (o && o.pal && o.pal.base != null) return o.pal;
    if (o && typeof o.pal === "string") return F.palette(ctx, o.pal);
    if (!ctx.__fmPal) ctx.__fmPal = F.palette(ctx, "lime");
    return ctx.__fmPal;
  }

  // ============================================================
  //  2. BASE / BODY
  // ============================================================

  /* THE PODIUM. A building never sits on the dirt. A stone platform standing
     proud of the walls with a lower step around it, registered with ctx.plat
     so the player walks straight on and in through the door, and emitted
     SOLID below so nobody runs through the plinth.

     NOTE ON THE DOORWAY. The kit's carve (facade_kit.js dressFacade) removes
     any box on the entrance face that crosses the real door opening, so the
     podium comes out with a threshold slot at the door — which is correct:
     buildings.js hangs the actual hinged leaf at ground level, and a platform
     drawn across it would bury the door. The plat still spans it, so the walk
     on is unbroken. */
  F.podium = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const S = F.solid(ctx);
    const unit = unitOf(ctx), FH = ctx.FH;
    const wantTop = num(o.top, clamp(FH * 0.11, 0.24, F.STEP_RISE));
    const top = Math.max(0.10, wantTop);
    const over = Math.max(0.25, num(o.over, clamp(unit * 0.06, 0.6, 2.4)));
    const stepOver = Math.max(over + 0.15, num(o.stepOver, over + clamp(over * 0.45, 0.35, 1.2)));
    const col = num(o.col, pal.base);
    const capCol = num(o.capCol, pal.light);
    const dark = num(o.darkCol, F.shade(col, 0.82));

    // the lower step is a STEP: never taller than one stride, whatever the
    // podium above it is, or the thing meant to get you up there is a ledge
    const stepTop = Math.min(top * 0.5, F.STEP_RISE);
    S(0, top * 0.5, 0, ctx.w + over * 2, top, ctx.d + over * 2, col);
    if (o.steps !== false) {
      S(0, stepTop * 0.5, 0, ctx.w + stepOver * 2, stepTop, ctx.d + stepOver * 2, dark);
    }
    // the moulded lip, so the platform is not a raw slab edge
    if (o.lip !== false) {
      const lh = clamp(top * 0.30, 0.07, 0.22);
      ctx.dbox(0, top - lh * 0.5, 0, ctx.w + over * 2 + 0.28, lh, ctx.d + over * 2 + 0.28, capCol);
    }
    if (o.walk !== false) {
      ctx.plat(-(ctx.w / 2 + over), ctx.w / 2 + over, -(ctx.d / 2 + over), ctx.d / 2 + over, top);
      if (o.steps !== false) {
        ctx.plat(-(ctx.w / 2 + stepOver), ctx.w / 2 + stepOver,
          -(ctx.d / 2 + stepOver), ctx.d / 2 + stepOver, stepTop);
      }
      // A PODIUM TALLER THAN ONE STRIDE MUST GROW ITS OWN STAIR, or the
      // building the player cannot reach is worse than no podium at all.
      if (top > F.STEP_RISE && o.stairs !== false) {
        F.steps(ctx, { top: top, out: stepOver, col: dark, capCol: capCol, pal: pal });
      }
    }
    return { top: top, over: over, stepOver: stepOver };
  };

  /* THE BATTER. A mud or rubble wall cannot stand plumb: it is laid thick at
     the bottom and thinned as it rises, so the profile visibly leans inward.
     Built as stacked courses ringing all four faces, each projecting further
     than the one above. Everything else on such a wall — window reveals, beam
     roots, the parapet — measures itself off projAt(y), which is what lets
     the whole facade re-proportion instead of pinning to constants. */
  F.batter = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const unit = unitOf(ctx);
    const top = num(o.top, ctx.rTop);
    const n = clamp(Math.round(num(o.n, ctx.storeys + 2)), 2, 6);
    const total = num(o.total, clamp(unit * 0.075, 0.42, 1.15));
    const cH = top / n;
    const salt = num(o.salt, 0xb100);
    const proj = [];
    for (let k = 0; k < n; k++) {
      proj.push(total * (1 - k / n) * (0.80 + ctx.hash(salt + k) * 0.40) + 0.05);
    }
    const courseAt = function (y) { return clamp(Math.floor(y / cH), 0, n - 1); };
    for (let k = 0; k < n; k++) {
      const y0 = k * cH, p = proj[k], col = o.col != null ? o.col : pal.course(k);
      for (const f of F.faces(ctx)) {
        // each course overhangs its own corners by its own thickness, so the
        // four faces meet in a solid pier instead of leaving a notch
        F.sBox(ctx, f, 0, y0 + cH / 2, f.span + p * 2.05, cH + 0.02, p, col, 0);
        // the shadow line where one lift sits on the one below
        if (k > 0) F.box(ctx, f, 0, y0 + 0.07, f.span + p * 2.05, 0.15, p + 0.09, F.shade(col, 0.58), 0);
      }
    }
    if (o.buttress !== false) {
      const bh = clamp(top * 0.34, ctx.FH * 0.55, Math.max(0.8, top - 0.6));
      const bl = clamp(unit * 0.16, 0.9, 3.0);
      F.corners(ctx, bh / 2, bh, bl, total * 1.35, F.shade(pal.base, 0.97));
      F.corners(ctx, bh * 0.28, bh * 0.56, bl * 1.22, total * 1.75, pal.base);
    }
    return { n: n, cH: cH, proj: proj, top: top,
      projAt: function (y) { return proj[courseAt(y)]; },
      courseAt: courseAt };
  };

  /* THE SETBACK STACK — the zoning envelope. ctx.w/ctx.d are the shell's
     fixed footprint and a facade cannot shrink the shell, so the mass is
     built the other way up: the shell wall is the INNERMOST plane and every
     stage is a cladding collar standing proud of it, the podium proudest.
     Stepping the collar IN as it rises gives exactly the silhouette of a mass
     stepping back, and it makes the exposed top of each lower stage a real
     terrace. Stage heights ACCELERATE — evenly spaced steps read as a wedding
     cake, accelerating ones read as a building obeying a rule. */
  F.setbackStack = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const H = ctx.rTop, FH = ctx.FH, unit = unitOf(ctx);
    const n = clamp(Math.round(num(o.n, 5)), 2, 7);
    const p0 = Math.max(0.4, num(o.p0, clamp(unit * 0.20, 1.6, 6.0)));
    const wall = num(o.col, pal.base), light = num(o.lightCol, pal.light);
    const mid = F.shade(wall, 0.88), shadow = num(o.shadowCol, pal.shadow);
    const glass = num(o.glassCol, pal.glass);
    const baseCol = num(o.baseCol, F.shade(F.mix(wall, pal.dark, 0.62), 0.72));

    // stage 0 is the street wall; the rest divide what is left with shrinking
    // steps, so the first setback is nearly half the tower and the last a tenth
    const y1_0 = Math.min(H * 0.15, 4 * FH);
    const stages = [{ y0: 0, y1: y1_0, p: p0, base: true }];
    let wsum = 0; for (let i = 0; i < n - 1; i++) wsum += Math.pow(0.68, i);
    let acc = 0;
    for (let i = 0; i < n - 1; i++) {
      acc += Math.pow(0.68, i) / wsum;
      stages.push({ y0: stages[i].y1, y1: y1_0 + (H - y1_0) * acc,
        p: Math.max(p0 * 0.06, p0 * Math.pow(0.58, i + 1)) });
    }
    stages[stages.length - 1].y1 = H;

    const pierW = Math.max(0.5, Math.min(FH * 0.36, unit * 0.05));
    function linesFor(f) { return F.bayLines(f, F.bayCount(f, FH * 1.15, 3, 12), Math.max(0.7, f.span * 0.045)); }
    function baysFor(f) { return F.bays(f, F.bayCount(f, FH * 1.15, 3, 12), Math.max(0.7, f.span * 0.045)); }

    // ---- the collars
    for (let si = (o.base === false ? 0 : 1); si < stages.length; si++) {
      const s = stages[si], h = s.y1 - s.y0;
      if (h < 0.6) continue;
      const proj = Math.max(0.18, s.p);
      for (const f of F.faces(ctx)) {
        F.box(ctx, f, 0, (s.y0 + s.y1) / 2, f.span + 0.16, h, proj, wall, 0);
        if (o.glazed !== false) {
          for (const b of baysFor(f)) {
            F.box(ctx, f, b.t, (s.y0 + s.y1) / 2, b.w * 0.74, h - 0.1, proj + 0.05, glass, 0);
          }
        }
        if (o.piers !== false) {
          const pp = proj + Math.max(0.30, pierW * 0.55);
          const lines = linesFor(f);
          // the ground-storey piers are the only part a player can touch
          for (let i = 0; i < lines.length; i++) {
            const solidTo = Math.min(s.y1, 3.0);
            if (s.y0 < 3.0) F.sRib(ctx, f, lines[i], s.y0, solidTo, pierW, pp, i % 2 ? wall : mid, 0);
            if (s.y1 > solidTo) F.rib(ctx, f, lines[i], solidTo, s.y1, pierW, pp, i % 2 ? wall : mid, 0);
          }
        }
        if (o.spandrels !== false) {
          const k0 = Math.ceil(s.y0 / FH), k1 = Math.floor((s.y1 - 0.2) / FH);
          for (let k = k0; k <= k1; k++) {
            F.box(ctx, f, 0, k * FH, f.span + 0.1, FH * 0.15, proj + 0.09, shadow, 0);
          }
        }
      }
    }

    /* THE JUNCTION. Every step is a designed joint, never a raw edge: an
       oversailing cornice under it, a lit deck on top of the stage below, a
       parapet with its own coping at the deck's outer edge, and a squat pier
       on each terrace corner so the parapet is not a ribbon of tape. */
    const joint = function (y, pl, hiP) {
      const railH = Math.max(0.7, Math.min(FH * 0.42, H * 0.012 + 0.6));
      const railT = Math.max(0.30, pl * 0.34);
      const ch = Math.max(0.30, Math.min(FH * 0.32, pl * 0.55));
      F.ring(ctx, y - ch * 0.55, ch, pl + ch * 0.55, light, 0.5, 0);
      F.ring(ctx, y - ch * 1.15, ch * 0.30, pl + ch * 0.25, shadow, 0.4, 0);
      F.ring(ctx, y + 0.10, 0.20, pl + 0.10, light, 0.36, 0);
      const pIn = pl + 0.10 - railT;
      F.ring(ctx, y + 0.20 + railH / 2, railH, railT, F.shade(light, 0.94), 0.3, pIn);
      F.ring(ctx, y + 0.24 + railH, 0.18, railT + 0.26, light, 0.36, pIn - 0.13);
      F.corners(ctx, y + 0.30 + railH * 0.6, railH * 1.2, railH * 1.5, pl + 0.06, light);
      if (hiP != null) F.ring(ctx, y + 0.34, 0.16, Math.max(0.16, hiP) + 0.06, shadow, 0.2, 0);
    };
    for (let si = 0; si + 1 < stages.length; si++) {
      joint(stages[si].y1, Math.max(0.20, stages[si].p), stages[si + 1].p);
    }

    // ---- the massive base: a street wall in its own right, and SOLID
    if (o.base !== false) {
      const s = stages[0], proj = s.p;
      for (const f of F.faces(ctx)) {
        F.sBox(ctx, f, 0, s.y1 / 2, f.span + 0.2, s.y1, proj, baseCol, 0);
        const nc = Math.max(3, Math.round(s.y1 / (FH * 0.55)));
        for (let i = 1; i < nc; i++) {
          F.box(ctx, f, 0, (i * s.y1) / nc, f.span + 0.24, 0.10, proj + 0.05, F.shade(baseCol, 0.72), 0);
        }
        const bays = F.bays(f, F.bayCount(f, 6.2, 2, 5), Math.max(1.1, f.span * 0.08));
        const oy0 = Math.max(0.9, s.y1 * 0.12), head = s.y1 * 0.66;
        for (const b of bays) {
          const ow = Math.min(b.w * 0.56, head - oy0);
          if (ow < 1.0 || !F.clearsDoor(ctx, f, b.t, ow + 1.6)) continue;
          F.box(ctx, f, b.t, (oy0 + head) / 2, ow, head - oy0, proj + 0.06, glass, 0);
          const rise = Math.min((s.y1 - head) * 0.5, ow * 0.34);
          if (rise > 0.25) F.arch(ctx, f, b.t, head, ow, rise, 0.22, proj + 0.22, light, "segmental");
          for (const sg of [-1, 1]) F.sRib(ctx, f, b.t + sg * (ow / 2 + 0.24), oy0, head, 0.46, proj + 0.20, F.shade(light, 0.88), 0);
          F.box(ctx, f, b.t, oy0 - 0.16, ow + 1.0, 0.26, proj + 0.30, light, 0);
        }
      }
      F.ring(ctx, 0.22, 0.44, proj + 0.34, F.shade(baseCol, 0.86), 0.6, 0);
    }
    return { stages: stages, top: H, topProj: stages[stages.length - 1].p, joint: joint };
  };

  /* THE WATER TABLE. Where the wall lands on its foundation: a thicker plinth
     course, a sloped wash throwing the rain clear, and a drip under it. Two
     lines and a shadow — but every masonry facade needs it, and a wall that
     just meets the pavement reads as a sticker. */
  F.waterTable = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const y = num(o.y, 0);
    const h = Math.max(0.16, num(o.h, clamp(ctx.FH * 0.22, 0.38, 0.95)));
    const proj = Math.max(0.08, num(o.proj, clamp(unitOf(ctx) * 0.022, 0.18, 0.42)));
    const col = num(o.col, F.shade(pal.base, 0.88));
    const cap = num(o.capCol, pal.light);
    for (const f of F.faces(ctx)) {
      F.sBox(ctx, f, 0, y + h / 2, f.span + proj * 2.1, h, proj, col, 0);
      F.box(ctx, f, 0, y + h + 0.05, f.span + proj * 2.1 + 0.1, 0.14, proj * 0.78, cap, 0);
      F.box(ctx, f, 0, y + h - 0.10, f.span + proj * 2.1, 0.09, proj + 0.06, F.shade(col, 0.66), 0);
    }
    return { top: y + h + 0.12 };
  };

  /* RUSTICATION. Alternating proud and recessed ashlar courses, the deep
     joints between them cut round the doorway rather than drawn over it. */
  F.rustication = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const y0 = num(o.y0, 0);
    const y1 = num(o.y1, Math.min(ctx.rTop, Math.max(2 * ctx.FH, ctx.rTop * 0.32)));
    if (y1 - y0 < 0.4) return { courses: 0, cH: 0 };
    const cH = Math.max(0.28, num(o.courseH, clamp(ctx.FH / 5, 0.34, 0.8)));
    const n = Math.max(2, Math.round((y1 - y0) / cH));
    const h = (y1 - y0) / n;
    const proj = Math.max(0.10, num(o.proj, Math.max(0.14, (ctx.WT || 0.18) * 1.1)));
    const rec = num(o.recess, proj * 0.45);
    const col = num(o.col, pal.base), dark = num(o.dark, pal.shadow);
    const faces = o.faces || F.faces(ctx);
    for (const f of faces) {
      const holes = (o.holes ? o.holes.slice() : []).concat(F.doorHoles(ctx, f, 0.9));
      for (let i = 0; i < n; i++) {
        const cy = y0 + (i + 0.5) * h;
        const out = (i % 2 === 0);
        F.segBand(ctx, f, cy, h - 0.06, out ? proj : rec,
          out ? (o.grain === false ? col : pal.course(i)) : F.shade(col, 0.90), holes, 0.14, 0, true);
        // the deep joint under each proud course — the whole read of ashlar
        F.segBand(ctx, f, y0 + i * h + 0.03, 0.08, rec * 0.7, dark, holes, 0.10, 0);
      }
    }
    return { courses: n, cH: h };
  };

  // ============================================================
  //  3. WALL
  // ============================================================

  /* PIER BAYS. The default masonry wall: structural piers on the bay lines
     running from the pavement to the wall head, a corner return at each arris
     (F.bays keeps the end bay off the corner, so without them the cladding
     stops short and the shell shows as a stripe down the edge), spandrel
     panels between the storeys, and a sill and head at every opening.
     Returns the layout so the caller's windows, arches and balconies can be
     laid on the SAME rhythm — the piers and the openings disagreeing is what
     makes an elevation read as two unrelated drawings. */
  F.pierBay = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const FH = ctx.FH, unit = unitOf(ctx);
    const y0 = num(o.y0, 0);
    const y1 = num(o.y1, ctx.rTop - clamp(FH * 0.12, 0.2, 0.7));
    const per = num(o.per, clamp(FH * 1.05, 2.8, 4.6));
    const proj = Math.max(0.10, num(o.proj, clamp(unit * 0.028, 0.20, 0.55)));
    const panelProj = Math.max(0.05, num(o.panelProj, proj * 0.45));
    const col = num(o.col, pal.base), dark = num(o.dark, pal.dark);
    const stone = num(o.trim, pal.trim);
    const faces = o.faces || F.faces(ctx);
    const cache = {};
    const head = o.head === undefined ? "lintel" : o.head;

    for (const f of faces) {
      const n = F.bayCount(f, per, num(o.lo, 2), num(o.hi, 9));
      const margin = num(o.margin, clamp(f.span * 0.075, 0.7, 1.8));
      const bays = F.bays(f, n, margin), lines = F.bayLines(f, n, margin);
      const step = bays.length ? bays[0].w : f.span;
      const pierW = Math.max(0.40, Math.min(num(o.pierW, step * 0.30), 1.6));
      cache[f.s] = { n: n, lines: lines, bays: bays, pierW: pierW, proj: proj, margin: margin };

      /* THE PIERS, SOLID: this is the mass a player walks into. A pier that
         would stand in the doorway does not move — it STARTS ABOVE THE DOOR
         HEAD instead, so the vertical rhythm survives all the way up the
         elevation and the ground in front of the door is clear. A nudged
         pier reads as a mistake; a missing one reads as a wide bay; a pier
         that begins over the opening reads as what it is. */
      const dHead = F.entrance(ctx).head + 0.25;
      const pier = function (t, wid) {
        if (F.clearsDoor(ctx, f, t, wid)) { F.sRib(ctx, f, t, y0, y1, wid, proj, col); return; }
        const ys = Math.max(y0, dHead);
        if (y1 - ys > 0.4) F.rib(ctx, f, t, ys, y1, wid, proj, col);
      };
      for (const t of lines) pier(t, pierW);
      for (const sg of [-1, 1]) pier(sg * (f.span / 2 - margin / 2), margin + pierW * 0.3);
      if (o.spandrel !== false) {
        // the panel under each opening and the lap over it, so the only bare
        // wall left is the opening itself
        const k0 = Math.max(0, Math.floor(y0 / FH));
        for (const b of bays) {
          for (let k = k0; k < ctx.storeys; k++) {
            const sill = k * FH + FH * 0.30, hd = k * FH + FH * 0.80;
            if (sill < y0 || hd > y1) continue;
            const ground = (k === 0);
            if (ground && !F.clearsDoor(ctx, f, b.t, b.w * 0.5)) continue;
            const sp0 = Math.max(y0 + 0.10, k * FH - FH * 0.14);
            if (sill - sp0 > 0.2) {
              F.box(ctx, f, b.t, (sp0 + sill) / 2, b.w * 0.90, sill - sp0, panelProj, dark);
            }
            const lap1 = Math.min((k + 1) * FH - FH * 0.14, y1);
            if (lap1 - hd > 0.15) F.box(ctx, f, b.t, (hd + lap1) / 2, b.w * 0.90, lap1 - hd, panelProj, dark);
            if (o.sill !== false) {
              F.box(ctx, f, b.t, sill - 0.09, b.w * 0.62 + pierW * 0.4, 0.20, proj * 0.9, stone);
            }
            const ww = b.w * 0.55;
            if (head === "arch") {
              const rise = Math.min(FH * 0.18, ww * 0.32);
              F.arch(ctx, f, b.t, hd, ww, rise, 0.14, proj * 0.8, F.shade(col, 1.08), o.archKind || "segmental");
              F.box(ctx, f, b.t, hd + rise * 0.72, pierW * 0.40, rise * 1.15, proj * 0.95, stone);
            } else if (head === "lintel") {
              F.box(ctx, f, b.t, hd + 0.14, ww + pierW * 0.6, 0.26, proj * 0.9, stone);
            }
          }
        }
      }
    }
    // the horizontal courses, as rings so the four faces meet
    if (o.courses !== false) {
      for (let k = 1; k * FH < y1; k++) {
        F.ring(ctx, k * FH - FH * 0.10, clamp(FH * 0.06, 0.10, 0.24), proj * 0.55, F.shade(stone, 0.9), 0.24);
      }
    }
    return { of: function (f) { return cache[f.s] || cache[0]; }, pierW: proj, top: y1, byFace: cache };
  };

  /* AN ARCADE on one face: piers, imposts, arch rings, keystones, and a dark
     intrados behind each ring so the arch reads as a HOLE in a thick screen
     rather than a ring painted on a flat one. A pier that would stand in the
     doorway is DROPPED, never nudged — the two bays it separated merge into
     one wider arch, which reads as an intercolumniation instead of a mistake. */
  F.arcade = function (ctx, f, o) {
    o = o || {};
    const pal = P(ctx, o);
    const FH = ctx.FH;
    const y0 = num(o.y0, 0);
    const kind = o.kind || "round";
    const proj = Math.max(0.12, num(o.proj, clamp(Math.min(FH * 0.55, f.halfN * 0.22), 0.5, 2.4)));
    const pierW = Math.max(0.26, num(o.pierW, clamp(f.span * 0.05, 0.34, 1.1)));
    const col = num(o.col, pal.light), dark = num(o.dark, pal.shadow);
    const wall = num(o.wallCol, pal.base);
    const gloom = F.shade(dark, 0.55);
    const n = Math.max(1, Math.round(num(o.n, F.bayCount(f, clamp(FH * 1.05, 2.4, 3.8), 2, 8))));
    const margin = num(o.margin, clamp(f.span * 0.06, 0.5, 1.6));
    const all = o.lines || F.bayLines(f, n, margin);
    const lines = [];
    for (let i = 0; i < all.length; i++) if (F.clearsDoor(ctx, f, all[i], pierW)) lines.push(all[i]);
    if (lines.length < 2) return { lines: [], spring: y0, crown: y0, holes: [] };
    const spring = num(o.spring, Math.max(F.entrance(ctx).head + 0.2, y0 + clamp(FH * 0.62, 1.9, 3.4)));
    const holes = [];
    let crown = spring;

    for (let i = 0; i < lines.length; i++) {
      const t = lines[i];
      const wide = (i === 0 || i === lines.length - 1);
      const pw = pierW * (wide ? 1.35 : 1.0);
      F.sRib(ctx, f, t, y0, spring, pw, proj, col);                       // the pier
      if (o.impost !== false) {
        F.sBox(ctx, f, t, y0 + 0.12, pw + 0.24, 0.24, proj + 0.08, col);  // plinth
        F.box(ctx, f, t, spring - 0.10, pw + 0.30, 0.20, proj + 0.10, F.shade(col, 0.86)); // impost
      }
    }
    for (let i = 0; i + 1 < lines.length; i++) {
      const t0 = lines[i], t1 = lines[i + 1];
      const clear = t1 - t0 - pierW, tc = (t0 + t1) / 2;
      if (clear < 0.5) continue;
      const rise = Math.max(0.22, num(o.rise, clear * (kind === "pointed" ? 0.62 : 0.5)));
      crown = Math.max(crown, spring + rise);
      // the void first, so the ring has a dark to stand against
      F.box(ctx, f, tc, spring + rise * 0.42, clear, (spring - y0) * 0.0 + rise * 0.84 + 0.2,
        proj * 0.40, gloom, proj - proj * 0.40 - 0.02);
      F.box(ctx, f, tc, (y0 + spring) / 2, clear, spring - y0, proj * 0.32, gloom, proj - proj * 0.32 - 0.02);
      F.arch(ctx, f, tc, spring, clear, rise, clamp(clear * 0.10, 0.14, 0.34), proj + 0.06, col, kind);
      if (o.key !== false) {
        F.box(ctx, f, tc, spring + rise + 0.04, clamp(clear * 0.16, 0.24, 0.52), 0.34, proj + 0.14, col);
      }
      // the spandrel between two arch heads
      const top = num(o.top, spring + rise + clamp(FH * 0.28, 0.5, 1.2));
      if (top - (spring + rise + 0.14) > 0.08) {
        F.box(ctx, f, tc, (spring + rise + 0.14 + top) / 2, clear + pierW * 0.9,
          top - (spring + rise + 0.14), proj * 0.8, F.shade(wall, 0.92));
      }
      holes.push([t0 - 0.05, t1 + 0.05]);
    }
    return { lines: lines, spring: spring, crown: crown, holes: holes, proj: proj, pierW: pierW };
  };

  /* THE COLONNADE, SOLVED BACKWARDS FROM THE ROOFLINE IT MUST CLEAR.

     Order matters and it is the whole reason this move exists: entablature
     first, off ctx.rTop; then whatever roof springs off the entablature; the
     shaft gets what is left. Doing it the other way round is how an order
     grows through its own roofline.

     The other half is the door. The CENTRAL intercolumniation is widened
     until the doorway plus a column radius fits, and if that leaves the outer
     columns closer than 2.6 diameters a PAIR is removed rather than a wall of
     stone built — which is the classical answer, and the reason no column
     ever has to be dropped or nudged out of the way here. */
  F.colonnade = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const FH = ctx.FH, H = ctx.rTop, unit = unitOf(ctx);
    const e = F.entrance(ctx);
    const f = o.face || e.f;
    const order = o.order || "doric";
    const col = num(o.col, pal.light), trim = num(o.trim, pal.trim);
    const dim = num(o.dim, F.shade(col, 0.86)), flut = F.shade(col, 0.72);

    const clear = num(o.clear, H - clamp(FH * 0.10, 0.25, 0.6));
    const entH = Math.max(0.55, num(o.entH, clamp(FH * 0.66, 0.8, Math.min(FH * 0.95, clear * 0.26))));
    const entY = clear - entH;
    const colY = num(o.base, 0);
    const colH = Math.max(0.9, entY - colY - 0.02);
    // slenderness is a real number: Greek Doric runs 5.5-7 diameters, Tuscan
    // 7, Ionic about 9, Corinthian 10. Everything else follows from it.
    const slender = order === "ionic" ? 9.0 : order === "corinthian" ? 10.0 : order === "tuscan" ? 7.0 : 6.3;

    let n = Math.round(num(o.count, f.span >= 16.5 ? 6 : 4));
    n = clamp(n, 2, 10);
    const even = o.even !== false;
    if (even && n % 2) n += 1;
    let r = Math.max(0.17, Math.min(colH / (slender * 2), f.span / (n * 3.0)));
    const capH = r * (order === "doric" ? 1.15 : 1.00);
    const marg = Math.max(0.80, f.span * 0.055);
    const outer = Math.max(r + 0.4, f.span / 2 - marg);
    const t = [];
    if (even) {
      const A0 = num(o.doorGap, e.gap) / 2 + r + 0.30;
      let m = Math.max(1, n >> 1);
      let A = Math.max(A0, outer / (2 * m - 1));
      while (m > 1 && (outer - A) / (m - 1) < r * 2.6) { m--; A = Math.max(A0, outer / (2 * m - 1)); }
      const cs = m > 1 ? (outer - A) / (m - 1) : 0;
      for (let i = 0; i < m; i++) { t.push(-(A + cs * i)); t.push(A + cs * i); }
    } else {
      const lines = F.bayLines(f, n, marg);
      for (let i = 0; i < lines.length; i++) if (F.clearsDoor(ctx, f, lines[i], r * 2.6)) t.push(lines[i]);
    }
    t.sort(function (a, b) { return a - b; });

    const engaged = !!o.engaged;
    // portico depth: deep enough for a column and its shadow, shallow enough
    // that a pediment over it stays a pediment and not a canopy
    const depth = engaged ? r * 1.3
      : Math.max(2 * r + 0.75, num(o.depth, clamp(Math.min(f.halfN * 0.55, f.span * 0.17), 1.5, 3.9)));
    const cq = engaged ? -r * 0.30 : depth - r - 0.28;
    const qOut = f.out * (f.halfN + cq);
    const wantMesh = (o.round !== false) && !engaged;
    const meshes = wantMesh ? F.mesh(ctx, t.length) : 0;

    for (let i = 0; i < t.length; i++) {
      const tt = t[i];
      const lx = f.horiz ? tt : qOut, lz = f.horiz ? qOut : tt;
      let sy = colY, sh = colH - capH;
      // Ionic and Corinthian stand on a base; Doric lands on the pavement
      if (order !== "doric") {
        F.obox(ctx, f, tt, colY + 0.11, r * 2.5, 0.22, r * 2.5, f.halfN + cq + r * 1.25, trim, true);
        F.obox(ctx, f, tt, colY + 0.29, r * 2.2, 0.16, r * 2.2, f.halfN + cq + r * 1.1, col, true);
        sy = colY + 0.37; sh = colH - capH - 0.37;
      }
      if (sh < 0.4) continue;
      if (i < meshes) {
        ctx.column(lx, sy, lz, r, sh, col, 14);
        // a solid core so the shaft is not walk-through: one narrow sbox
        // inside the cylinder, which sbox itself drops if it is out of reach
        F.solid(ctx)(lx, sy + sh / 2, lz, r * 1.35, sh, r * 1.35, col);
        // FLUTING: dark slivers round the visible arc. Free, and at any
        // distance a player stands it reads as grooving.
        const nf = 7;
        for (let k = 0; k < nf; k++) {
          const a = (-1 + 2 * (k + 0.5) / nf) * 1.15;
          F.obox(ctx, f, tt + Math.sin(a) * r * 0.94, sy + sh * 0.5, r * 0.20, sh * 0.94, r * 0.20,
            f.halfN + cq + Math.cos(a) * r * 0.94 + r * 0.10, flut);
        }
      } else {
        boxShaft(ctx, lx, sy, lz, sh, r, col, F.mix(col, 0xffffff, 0.14), true);
      }
      // necking, capital, abacus
      const cy0 = sy + sh;
      F.obox(ctx, f, tt, cy0 - 0.07, r * 2.02, 0.09, r * 2.02, f.halfN + cq + r * 1.01, dim);
      if (order === "ionic") {
        for (const sg of [-1, 1]) {
          F.obox(ctx, f, tt + sg * r * 0.92, cy0 + capH * 0.38, r * 0.80, capH * 0.62, r * 1.7, f.halfN + cq + r * 0.85, trim);
        }
        F.obox(ctx, f, tt, cy0 + capH * 0.30, r * 1.9, capH * 0.44, r * 1.9, f.halfN + cq + r * 0.95, col);
      } else if (order === "corinthian") {
        for (let k = 0; k < 3; k++) {
          const u = (k + 1) / 3;
          F.obox(ctx, f, tt, cy0 + capH * (0.18 + k * 0.30), r * (1.7 + k * 0.42), capH * 0.30, r * (1.7 + k * 0.42),
            f.halfN + cq + r * (0.85 + k * 0.21), k % 2 ? dim : trim);
        }
      } else {
        F.obox(ctx, f, tt, cy0 + capH * 0.26, r * 2.14, capH * 0.46, r * 2.14, f.halfN + cq + r * 1.07, col);
        F.obox(ctx, f, tt, cy0 + capH * 0.60, r * 2.46, capH * 0.28, r * 2.46, f.halfN + cq + r * 1.23, col);
      }
      F.obox(ctx, f, tt, cy0 + capH * 0.88, r * 2.76, capH * 0.26, r * 2.76, f.halfN + cq + r * 1.38, trim);
    }

    // THE ENTABLATURE — architrave, frieze, cornice. A ring when the order
    // wraps the building (a peristyle), a band when it is one portico.
    const aH = entH * 0.24, frH = entH * 0.44, coH = entH * 0.32;
    const outP = depth + 0.10;
    if (o.ring) {
      F.ring(ctx, entY + aH / 2, aH, outP, trim, 0.4, 0);
      F.ring(ctx, entY + aH + frH / 2, frH, outP - 0.08, col, 0.4, 0);
      F.ring(ctx, entY + aH + frH + coH * 0.5, coH, outP + 0.22, trim, 0.6, 0);
      F.ring(ctx, entY + aH + frH + coH, 0.14, outP + 0.30, F.shade(trim, 0.9), 0.7, 0);
    } else {
      const wide = f.span + 0.3;
      F.box(ctx, f, 0, entY + aH / 2, wide, aH, outP, trim, 0);
      F.box(ctx, f, 0, entY + aH + frH / 2, wide - 0.2, frH, outP - 0.08, col, 0);
      F.box(ctx, f, 0, entY + aH + frH + coH * 0.5, wide + 0.2, coH, outP + 0.22, trim, 0);
      F.box(ctx, f, 0, entY + aH + frH + coH, wide + 0.3, 0.14, outP + 0.30, F.shade(trim, 0.9), 0);
    }
    // TRIGLYPHS: one over every column and one between each pair. Doric only,
    // and the cheapest thing in the file that says which order this is.
    if (order === "doric" && o.triglyphs !== false && t.length > 1) {
      const tw = Math.max(0.16, r * 0.9);
      const marks = t.slice();
      for (let i = 0; i + 1 < t.length; i++) marks.push((t[i] + t[i + 1]) / 2);
      for (const tt of marks) {
        F.box(ctx, f, tt, entY + aH + frH * 0.5, tw, frH * 0.92, outP - 0.02, trim, 0);
        for (const sg of [-1, 1]) F.box(ctx, f, tt + sg * tw * 0.26, entY + aH + frH * 0.5, 0.05, frH * 0.86, outP + 0.01, dim, 0);
      }
    }
    return { t: t, r: r, colY: colY, colH: colH, capH: capH,
      entY: entY, entTop: clear, entH: entH, depth: depth, cq: cq, order: order };
  };

  /* A BLIND NICHE. The wall articulated where a culture has no window: a
     recessed panel with an arched or flat head, jambs standing proud, and a
     sill. Cheap, and the difference between a blank elevation and a wall. */
  F.blindNiche = function (ctx, f, o) {
    o = o || {};
    const pal = P(ctx, o);
    const t = num(o.t, 0), y0 = num(o.y0, ctx.FH * 0.4);
    const h = Math.max(0.4, num(o.h, ctx.FH * 0.55));
    const wid = Math.max(0.3, num(o.wid, h * 0.45));
    const rec = Math.max(0.06, num(o.recess, clamp(wid * 0.16, 0.10, 0.32)));
    const col = num(o.col, pal.base), dark = num(o.dark, pal.shadow);
    /* WHERE THE WALL ACTUALLY IS. `inset` was hardcoded to 0.01 — the SHELL's
       wall plane — which is right only for a grammar that draws straight onto
       it. Three agents on three unrelated eras hit the same wall: any facade
       that clads or batters its wall stands its own courses proud of 0.01, so
       every niche it drew was buried behind its own stonework and simply never
       appeared. swahili escaped it only by thinning its plaster to 0.065,
       baroque gave up and hand-rolled its niches, and it is why sahelian's
       slits do not show. Pass the depth your cladding stands at. */
    const ins = num(o.inset, 0.01);
    if (!F.clearsDoor(ctx, f, t, wid + 1.2)) return { top: y0 };
    // the recess: a dark ground left ON the wall face, so the jambs in front
    // of it become the reveal
    F.box(ctx, f, t, y0 + h / 2, wid, h, 0.08, dark, ins);
    for (const sg of [-1, 1]) {
      F.sRib(ctx, f, t + sg * (wid / 2 + rec * 0.55), y0 - 0.05, y0 + h + 0.10, rec * 1.1, rec, F.shade(col, 1.03), ins);
    }
    const kind = o.kind || "round";
    if (kind === "flat") {
      F.box(ctx, f, t, y0 + h + rec * 0.6, wid + rec * 2.6, rec * 1.2, rec * 1.1, col);
    } else {
      F.arch(ctx, f, t, y0 + h, wid, Math.min(h * 0.5, wid * (kind === "pointed" ? 0.75 : 0.5)),
        rec * 0.7, rec * 1.05, col, kind);
    }
    if (o.sill !== false) F.box(ctx, f, t, y0 - 0.10, wid + rec * 3.0, 0.16, rec * 1.6, F.shade(col, 1.06));
    return { top: y0 + h + rec * 2 };
  };

  /* THE CULTURE'S OWN WINDOWS — for a grammar that declared wall:"own" and so
     has a solid wall with no glazing to frame. Shape, rhythm and how many are
     blind are the culture's; the sizes are the host's. */
  F.openingGrid = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const FH = ctx.FH;
    const shape = o.shape || "rect";
    if (shape === "none") return { count: 0 };
    const reveal = num(o.reveal, F.shade(pal.base, 0.30));
    const glass = num(o.glass, pal.glass);
    const trim = num(o.trim, pal.trim);
    const blind = clamp(num(o.blind, 0.10), 0, 0.9);
    const faces = o.faces || F.faces(ctx);
    const k0 = Math.max(0, Math.floor(num(o.y0, 0) / FH));
    const k1 = Math.min(ctx.storeys, Math.ceil(num(o.y1, ctx.rTop) / FH));
    const salt = num(o.salt, 0xc300);
    let count = 0;
    for (const f of faces) {
      const n = F.bayCount(f, num(o.per, clamp(f.span / 5, 2.6, 4.6)), num(o.lo, 2), num(o.hi, 7));
      const bays = F.bays(f, n, num(o.margin, clamp(f.span * 0.12, 0.9, 2.6)));
      for (let k = k0; k < k1; k++) {
        const hFrac = num(o.hFrac, shape === "slit" ? 0.42 : 0.34);
        const wh = clamp(FH * hFrac, 0.5, FH * 0.7);
        const sill = k * FH + FH * num(o.sillFrac, 0.42);
        for (const b of bays) {
          const ww = Math.max(0.28, clamp(b.w * num(o.wFrac, shape === "slit" ? 0.12 : 0.32), 0.28, 1.6));
          if (ctx.hash(salt + k * 17 + b.i * 5 + f.s) < blind) continue;
          if (!F.clearsDoor(ctx, f, b.t, ww + 1.6)) continue;
          count++;
          const p = num(o.proj, 0.10);
          // the opening, left on the wall FACE so the reveal in front of it is
          // the wall's own thickness. `inset` for the same reason blindNiche
          // takes one: on a battered or clad wall 0.01 is a foot inside the
          // courses and the window is never drawn at all.
          F.box(ctx, f, b.t, sill + wh / 2, ww, wh, p, reveal, num(o.inset, 0.01));
          if (shape !== "slit") {
            F.box(ctx, f, b.t, sill + wh / 2, ww * 0.82, wh * 0.86, p * 0.5, glass, 0.02);
          }
          for (const sg of [-1, 1]) {
            F.sRib(ctx, f, b.t + sg * (ww / 2 + 0.12), sill - 0.05, sill + wh + 0.08, 0.24, num(o.jambProj, 0.14), F.shade(pal.base, 1.03), p);
          }
          if (shape === "arch" || shape === "lancet" || shape === "round") {
            const rise = shape === "lancet" ? ww * 0.9 : ww * 0.5;
            F.arch(ctx, f, b.t, sill + wh, ww, rise, 0.14, num(o.jambProj, 0.14) + 0.04, trim,
              shape === "lancet" ? "pointed" : "round");
          } else if (o.lintel !== false) {
            F.box(ctx, f, b.t, sill + wh + 0.16, ww + 0.7, 0.26, num(o.jambProj, 0.14) + 0.06, trim, p);
          }
          if (o.sillOut !== false) {
            F.box(ctx, f, b.t, sill - 0.12, ww + 0.5, 0.18, num(o.jambProj, 0.14) + 0.10, F.shade(trim, 1.02), p);
          }
        }
      }
    }
    return { count: count };
  };

  // ============================================================
  //  4. ROOF
  // ============================================================
  /* THE SLOPE DESCRIPTOR. gableRoof, hipRoof, mansard and thatch all return
     the same object, so dormerRow, chimneyStack and ridgeCrest work against
     any of them without knowing which:
        y0 h top pitch kind
        nrm(f,u)   half-extent along face f's NORMAL at height fraction u
        tan(f,u)   half-extent along face f's TANGENT at u
        slopeOn(f) whether f's side of the roof is a slope (dormers go there)
     Everything below is stepped courses. Nothing is rotated: a rotated box is
     a lie you can see from any other angle, and the step size is the pitch. */
  function slopeDesc(kind, y0, h, fw, fd, ft, pitch) {
    return { kind: kind, y0: y0, h: h, top: y0 + h, pitch: pitch,
      nrm: function (f, u) { return f.horiz ? fd(u) : fw(u); },
      tan: function (f, u) { return f.horiz ? fw(u) : fd(u); },
      slopeOn: ft };
  }

  /* A GABLE ROOF: stepped courses narrowing on ONE axis, with a lap line on
     every other course — what turns a staircase of boxes into a slope of
     slate — a ridge cap, and verge boards on the gable ends. */
  F.gableRoof = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const unit = unitOf(ctx);
    const along = o.axis || (ctx.w >= ctx.d ? "x" : "z");
    const y0 = num(o.y0, ctx.rTop);
    const over = Math.max(0, num(o.over, clamp(unit * 0.055, 0.35, 1.15)));
    const halfT0 = ((along === "x") ? ctx.d : ctx.w) / 2 + over;
    const roofLen = ((along === "x") ? ctx.w : ctx.d) + over * 2;
    const rise = Math.max(0.3, num(o.rise, Math.min(halfT0 * num(o.pitch, 0.55), ctx.rTop * 0.60)));
    const n = clamp(Math.round(num(o.courses, rise / 0.30)), 6, 22);
    const cH = rise / n;
    const roof = num(o.col, pal.roof), lightR = num(o.lightCol, F.shade(num(o.col, pal.roof), 1.24));
    const put = function (cy, ht, hq, h, col) {
      if (along === "x") ctx.dbox(0, cy, 0, hq * 2, h, ht * 2, col);
      else ctx.dbox(0, cy, 0, ht * 2, h, hq * 2, col);
    };
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const ht = Math.max(0.22, halfT0 * (1 - u));
      const col = (i % 3 === 1) ? lightR : (i % 3 === 2 ? F.shade(roof, 0.88) : roof);
      put(y0 + (i + 0.5) * cH, ht, roofLen / 2, cH + 0.02, col);
      if (o.lap !== false && i % 2 === 0) {
        put(y0 + i * cH + 0.04, ht + 0.06, roofLen / 2 + 0.04, 0.07, F.shade(roof, 0.72));
      }
    }
    if (o.ridgeCap !== false) {
      const rw = clamp(halfT0 * 0.07, 0.28, 0.9);
      put(y0 + rise + 0.10, rw, roofLen / 2 + 0.05, 0.20, lightR);
    }
    // THE VERGE: raking boards on the gable ends, so the roof has an edge
    if (o.verge !== false) {
      const vb = clamp(over * 0.6, 0.24, 0.7);
      const q = roofLen / 2 - 0.16;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n, ht = Math.max(0.22, halfT0 * (1 - u));
        const cy = y0 + (i + 0.5) * cH;
        for (const sq of [-1, 1]) for (const sg of [-1, 1]) {
          if (along === "x") ctx.dbox(sq * q, cy, sg * (ht - vb * 0.5), 0.32, cH + 0.02, vb, pal.trim);
          else ctx.dbox(sg * (ht - vb * 0.5), cy, sq * q, vb, cH + 0.02, 0.32, pal.trim);
        }
      }
    }
    const halfAt = function (u) { return Math.max(0.22, halfT0 * (1 - clamp(u, 0, 1))); };
    const flat = function () { return roofLen / 2; };
    const isSlope = function (f) { return (along === "x") ? f.horiz : !f.horiz; };
    const d = (along === "x")
      ? slopeDesc("gable", y0, rise, flat, halfAt, isSlope, rise / Math.max(0.1, halfT0))
      : slopeDesc("gable", y0, rise, halfAt, flat, isSlope, rise / Math.max(0.1, halfT0));
    d.axis = along; d.over = over; d.ridge = y0 + rise; d.roofLen = roofLen; d.halfT0 = halfT0;
    return d;
  };

  /* A HIPPED ROOF: the same courses walking in on BOTH axes, with hip ribs
     down the four corners — without them a stack of boxes reads as a
     ziggurat instead of a roof — and a ridge where the two slopes meet. */
  F.hipRoof = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const unit = unitOf(ctx);
    const y0 = num(o.y0, ctx.rTop);
    const over = Math.max(0, num(o.over, clamp(unit * 0.10, 0.4, 2.2)));
    const RW = ctx.w + over * 2, RD = ctx.d + over * 2;
    const run = Math.min(RW, RD) / 2 - 0.5;
    const h = Math.max(0.4, num(o.h, clamp(unit * 0.30, ctx.FH * 0.62, ctx.FH * 1.6)));
    const pitch = num(o.pitch, 0.46);
    const inSet = Math.min(Math.max(0.3, run), h / Math.max(0.12, pitch));
    const n = clamp(Math.round(num(o.courses, 12)), 6, 20);
    const cH = h / n;
    const roof = num(o.col, pal.roof), lightR = num(o.lightCol, F.shade(num(o.col, pal.roof), 1.22));
    const rb = clamp(unit * 0.030, 0.16, 0.42);
    for (let i = 0; i < n; i++) {
      const ins = inSet * ((i + 1) / n);
      const cy = y0 + h * (i + 0.5) / n;
      const col = (i % 3 === 1) ? lightR : (i % 3 === 2 ? F.shade(roof, 0.90) : roof);
      const cw = Math.max(0.4, RW - ins * 2), cd = Math.max(0.4, RD - ins * 2);
      ctx.dbox(0, cy, 0, cw, cH + 0.02, cd, col);
      if (o.lap !== false && i % 3 === 0) {
        ctx.dbox(0, y0 + h * (i / n) + 0.04, 0, cw + 0.10, 0.07, cd + 0.10, F.shade(roof, 0.72));
      }
      if (o.ribs !== false) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          ctx.dbox(sx * cw / 2, cy, sz * cd / 2, rb * 1.7, cH + 0.02, rb * 1.7, lightR);
        }
      }
    }
    if (o.ridge !== false) {
      const rw = Math.max(0.4, RW - inSet * 2), rd = Math.max(0.4, RD - inSet * 2);
      ctx.dbox(0, y0 + h + 0.07, 0, rw + 0.22, 0.16, rd + 0.22, lightR);
      ctx.dbox(0, y0 + h + 0.19, 0, rw * 0.88, 0.12, rd * 0.88, F.shade(lightR, 0.90));
    }
    const d = slopeDesc("hip", y0, h,
      function (u) { return Math.max(0.2, RW / 2 - inSet * clamp(u, 0, 1)); },
      function (u) { return Math.max(0.2, RD / 2 - inSet * clamp(u, 0, 1)); },
      function () { return true; }, h / Math.max(0.1, inSet));
    d.over = over; d.inSet = inSet; d.RW = RW; d.RD = RD;
    return d;
  };

  /* A MANSARD: the top storey as a near-vertical stepped slope with a flat
     deck on top and an iron cresting rail round it. The step size makes the
     pitch; twelve courses is enough that at street distance the stagger reads
     as slate. Hip ribs down the four corners for the same reason as hipRoof. */
  F.mansard = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const unit = unitOf(ctx), FH = ctx.FH;
    const y0 = num(o.y0, ctx.rTop);
    const h = Math.max(0.8, num(o.h, clamp(FH * 1.18, 2.2, FH * 1.4)));
    const over = num(o.over, clamp(unit * 0.02, 0.1, 0.5));
    const cW0 = ctx.w + over * 2, cD0 = ctx.d + over * 2;
    const inSet = Math.min(Math.min(cW0, cD0) / 2 - 0.6, num(o.inset, clamp(h * 0.32, 0.6, unit * 0.17)));
    const n = clamp(Math.round(num(o.courses, 12)), 6, 18);
    const slate = num(o.col, pal.roof), slateL = F.shade(slate, 1.20);
    const trimD = num(o.ribCol, F.shade(pal.trim, 0.8));
    const ribW = clamp(unit * 0.035, 0.16, 0.42);
    for (let i = 0; i < n; i++) {
      const u0 = i / n, u1 = (i + 1) / n, ins = inSet * u1;
      const cy = y0 + h * (u0 + u1) / 2;
      const cw = Math.max(0.4, cW0 - ins * 2), cd = Math.max(0.4, cD0 - ins * 2);
      ctx.dbox(0, cy, 0, cw, h / n + 0.02, cd, (i % 3 === 1) ? slateL : (i % 3 === 2 ? F.shade(slate, 0.88) : slate));
      if (i % 3 === 0) ctx.dbox(0, y0 + h * u0 + 0.03, 0, cw + 0.10, 0.07, cd + 0.10, F.shade(slate, 0.72));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        ctx.dbox(sx * cw / 2, cy, sz * cd / 2, ribW * 1.6, h / n + 0.02, ribW * 1.6, trimD);
      }
    }
    const deckY = y0 + h;
    const dW = Math.max(0.6, cW0 - inSet * 2), dD = Math.max(0.6, cD0 - inSet * 2);
    if (o.deck !== false) {
      ctx.dbox(0, deckY + 0.10, 0, dW + 0.26, 0.20, dD + 0.26, pal.trim);
      ctx.dbox(0, deckY + 0.26, 0, dW - 0.10, 0.14, dD - 0.10, F.shade(slate, 0.94));
    }
    if (o.rail !== false) {
      F.ridgeCrest(ctx, { y: deckY + 0.34, w: dW, d: dD, kind: "iron", pal: pal,
        h: clamp(h * 0.20, 0.32, 0.85), col: num(o.railCol, F.shade(pal.shadow, 0.7)) });
    }
    const d = slopeDesc("mansard", y0, h,
      function (u) { return Math.max(0.2, cW0 / 2 - inSet * clamp(u, 0, 1)); },
      function (u) { return Math.max(0.2, cD0 / 2 - inSet * clamp(u, 0, 1)); },
      function () { return true; }, h / Math.max(0.1, inSet));
    d.deckY = deckY; d.dW = dW; d.dD = dD; d.inSet = inSet;
    return d;
  };

  /* TIERED EAVES with upturned corners — the East Asian timber roof.

     Each tier is a stack of stepped courses reaching further from the wall as
     they go out; the profile DROPS as it goes and then LIFTS at the lip,
     which is the concave section of a tiled roof made out of steps. Under it
     sit the bracket sets that are the honest reason the eave is allowed to
     project so far, and at each corner a diagonal staircase of blocks climbs
     out and up while the eave LINE lifts along both meeting faces — the
     single most recognisable feature of the style, drawn big on purpose,
     because a timid corner reads as a mistake and not as a curve.

     THE OVERLAP RULE (the difference between an upturned corner and a pile of
     floating slabs): every block in the run must be longer than the step that
     separates it from the next, and shorter in rise than its own height. Then
     consecutive blocks intersect and the merge is one solid curling ridge. */
  F.eaveTier = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const FH = ctx.FH, small = unitOf(ctx), ST = Math.max(1, ctx.storeys | 0);
    const ch = Math.max(0.10, num(o.ch, clamp(FH * 0.085, 0.11, 0.34)));
    const EO = Math.max(0.7, num(o.proj, clamp(small * 0.26, 1.2, 4.0)));
    const lipT = Math.max(0.15, ch * 1.25);
    const tile = num(o.col, pal.roof), tileL = F.shade(tile, 1.22), tileD = F.shade(tile, 0.78);
    const timber = num(o.timberCol, pal.accent), timberD = F.shade(timber, 0.76), timberL = F.shade(timber, 1.16);
    const gold = num(o.gold, pal.trim);
    const ent = F.entrance(ctx);
    const HW = ctx.w / 2, HD = ctx.d / 2;

    // WHERE THE TIERS GO: one per storey, or per two once the block is tall
    // enough that a roof every 3.5 m would read as louvres. The topmost always
    // lands on the roofline, because that is the one a crown stands on.
    let levels = o.levels;
    if (!Array.isArray(levels)) {
      const per = ST <= 4 ? 1 : 2;
      const ys = [];
      for (let s = per - 1; s < ST - 1; s += per) ys.push((s + 1) * FH);
      ys.push(ctx.rTop);
      if (ys.length > 1 && ys[0] < ent.head + 0.45) ys[0] = Math.min(ys[1] - FH * 0.5, ent.head + 0.45);
      const NL = ys.length;
      levels = ys.map(function (y, i) { return { y: y, proj: EO * (1 - 0.40 * (NL > 1 ? i / (NL - 1) : 0)) }; });
    }

    const PROF = [0.0, -0.34, -0.60, -0.72, -0.48];
    const lips = [];
    for (const L of levels) {
      const y = L.y, proj = Math.max(0.3, L.proj == null ? EO : L.proj);
      // ---- the bracket sets, on the bay lines
      if (o.brackets !== false) {
        const bp = Math.max(0.30, proj * 0.42), bh = Math.max(0.16, ch * 1.15);
        const armW = Math.max(0.34, small * 0.055);
        for (const f of F.faces(ctx)) {
          const lines = F.bayLines(f, F.bayCount(f, Math.max(2.6, small * 0.24), 2, 8), Math.max(0.5, small * 0.05));
          for (const t of lines) {
            if (!F.clearsDoor(ctx, f, t, armW) && y < ent.head + 1.2) continue;
            for (let k = 0; k < 3; k++) {
              const p = bp * (k + 1) / 3, cy = y - ch * 2.4 - bh * (2.6 - k * 1.05);
              F.box(ctx, f, t, cy, armW * (0.5 + k * 0.10), bh, p, k === 2 ? timberL : timber);
              F.box(ctx, f, t, cy + bh * 0.62, armW * (1.0 + k * 0.45), bh * 0.55, p, timberD);
            }
          }
          F.band(ctx, f, y - ch * 2.4 - bh * 3.4, bh * 0.8, Math.max(0.14, bp * 0.30), timberD, 0.3);
        }
      }
      // ---- the eave itself
      const nC = PROF.length;
      for (let i = 0; i < nC; i++) {
        const p = proj * (i + 1) / nC;
        F.ring(ctx, y + PROF[i] * ch * 1.5, ch, p, i >= nC - 2 ? tileL : tile, 2 * p + 0.2);
      }
      const yLip = y + PROF[nC - 1] * ch * 1.5 + ch * 0.55;
      F.ring(ctx, yLip, ch * 1.45, lipT, tileL, 2 * (proj + lipT) + 0.24, proj);
      if (o.soffit !== false) F.ring(ctx, y - ch * 1.9, ch * 0.7, proj * 0.92, tileD, 2 * proj * 0.92 + 0.2);
      lips.push(yLip);
      // ---- the upturned corners
      if (o.upturn !== false) {
        const N = 5;
        const rise = ch * 0.80;                        // < block height, so they overlap
        const stepOut = Math.max(0.14, proj * 0.075);
        const bs = Math.max(0.34, proj * 0.42);        // > 2x stepOut, so they intersect
        const run = Math.max(1.2, proj * 1.15);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          for (let j = 0; j < N; j++) {
            const ext = lipT * 0.5 + stepOut * j, yy = yLip + rise * j, sz2 = bs * (1 - 0.10 * j);
            ctx.dbox(sx * (HW + proj + ext), yy, sz * (HD + proj + ext), sz2, ch * 1.3, sz2,
              j === N - 1 ? gold : tileL);
          }
          const segs = 4;
          for (let j = 1; j <= segs; j++) {
            const yy = yLip + rise * j * 0.55, seg = run / segs, off = run - seg * (j - 0.5);
            ctx.dbox(sx * (HW - off), yy, sz * (HD + proj + lipT * 0.5), seg * 1.25, ch * 1.25, lipT * 1.6, tileL);
            ctx.dbox(sx * (HW + proj + lipT * 0.5), yy, sz * (HD - off), lipT * 1.6, ch * 1.25, seg * 1.25, tileL);
          }
        }
      }
    }
    return lips;
  };

  /* A THATCHED ROOF. Thick, shaggy and deeply overhanging: ragged hashed
     course widths (a bundle of reed is not a machined edge), a dark
     under-eave where the thatch is a foot thick, and a bound ridge of crossed
     poles. Hipped by default; `gable:true` narrows on one axis only. */
  F.thatch = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const unit = unitOf(ctx);
    const y0 = num(o.y0, ctx.rTop);
    const over = Math.max(0.3, num(o.over, clamp(unit * 0.16, 0.7, 2.6)));
    const h = Math.max(0.8, num(o.h, clamp(unit * 0.52, ctx.FH * 0.9, ctx.FH * 2.4)));
    const RW = ctx.w + over * 2, RD = ctx.d + over * 2;
    const n = clamp(Math.round(num(o.courses, 14)), 8, 22);
    const gable = !!o.gable;
    const along = o.axis || (ctx.w >= ctx.d ? "x" : "z");
    const inW = gable && along === "x" ? 0 : Math.min(RW / 2 - 0.3, h / 0.9);
    const inD = gable && along === "z" ? 0 : Math.min(RD / 2 - 0.3, h / 0.9);
    const salt = num(o.salt, 0xd400);
    const straw = num(o.col, pal.roof);
    for (let i = 0; i < n; i++) {
      const u = (i + 1) / n, cy = y0 + h * (i + 0.5) / n;
      const rag = 1 + (ctx.hash(salt + i) - 0.5) * 0.10;
      const cw = Math.max(0.3, (RW - inW * 2 * u) * rag), cd = Math.max(0.3, (RD - inD * 2 * u) * rag);
      ctx.dbox(0, cy, 0, cw, h / n + 0.05, cd, pal.course(i + 40));
      // the thick, shaggy lower lip
      if (i === 0) {
        ctx.dbox(0, y0 + h / n * 0.35, 0, cw + 0.16, h / n * 1.5, cd + 0.16, F.shade(straw, 0.86));
        ctx.dbox(0, y0 - 0.09, 0, cw + 0.04, 0.22, cd + 0.04, F.shade(straw, 0.48));   // under-eave shadow
      }
    }
    // the bound ridge: a roll plus crossed poles over it
    const rw = Math.max(0.4, RW - inW * 2), rd = Math.max(0.4, RD - inD * 2);
    ctx.dbox(0, y0 + h + 0.10, 0, rw + 0.20, 0.30, rd + 0.20, F.shade(straw, 0.92));
    const np = Math.max(3, Math.round(Math.max(rw, rd) / clamp(unit * 0.12, 0.6, 1.4)));
    for (let i = 0; i <= np; i++) {
      const t = -0.5 + i / np;
      for (const sg of [-1, 1]) {
        if (rw >= rd) ctx.dbox(t * rw, y0 + h + 0.24, sg * rd * 0.34, 0.10, 0.34, rd * 0.85, pal.accent);
        else ctx.dbox(sg * rw * 0.34, y0 + h + 0.24, t * rd, rw * 0.85, 0.34, 0.10, pal.accent);
      }
    }
    const d = slopeDesc("thatch", y0, h,
      function (u) { return Math.max(0.2, RW / 2 - inW * clamp(u, 0, 1)); },
      function (u) { return Math.max(0.2, RD / 2 - inD * clamp(u, 0, 1)); },
      function () { return true; }, h / Math.max(0.1, Math.max(inW, inD)));
    d.over = over;
    return d;
  };

  /* A PARAPET AND A ROOF WALK. The wall carried past the roofline with a
     coping on it, optionally crenellated, and the deck inside it registered
     with ctx.plat so the roof is genuinely somewhere the player can stand. */
  F.parapetWalk = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const R = F.roof(ctx);
    const h = Math.max(0.3, num(o.h, clamp(ctx.FH * 0.32, 0.55, 1.35)));
    const thick = Math.max(0.14, num(o.thick, clamp(unitOf(ctx) * 0.026, 0.22, 0.46)));
    const wall = num(o.col, pal.base), cap = num(o.capCol, pal.light);
    F.parapet(ctx, h, thick, wall, cap);
    if (o.crenel) {
      for (const f of F.faces(ctx)) {
        const n = Math.max(4, Math.round(num(o.merlonN, f.span / clamp(ctx.FH * 0.55, 1.1, 2.1))));
        const mw = (f.span / n) * 0.52;
        F.merlons(ctx, f, ctx.rTop + h + 0.28, n, mw, h * 0.55, thick * 0.9, cap);
      }
    }
    if (o.walk !== false && R.base > 3) {
      ctx.dbox(R.cx, ctx.rTop + ctx.pp * 0.5, R.cz, R.w, Math.max(0.06, ctx.pp), R.d, F.shade(wall, 0.9));
      ctx.plat(R.cx - R.w / 2, R.cx + R.w / 2, R.cz - R.d / 2, R.cz + R.d / 2, ctx.rTop + ctx.pp);
    }
    return { parTop: ctx.rTop + h + 0.14, deckY: ctx.rTop + ctx.pp };
  };

  /* A FLAT TERRACE ROOF — the earthen/Mediterranean answer. A parapet with a
     soft stepped top, canales (the projecting roof drains that stop the
     roofline being a machined edge), a walkable deck, and optionally a LOWER
     STEPPED MASS growing out past one flank, capped with its own parapet and
     registered with ctx.plat: the pueblo silhouette, and the only way to step
     a mass whose w and d the shell has already fixed. */
  F.terraceRoof = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const S = F.solid(ctx);
    const unit = unitOf(ctx), FH = ctx.FH;
    const parH = Math.max(0.30, num(o.parH, clamp(FH * 0.34, 0.55, 1.3)));
    const thick = Math.max(0.16, num(o.thick, clamp(unit * 0.05, 0.26, 0.7)));
    const salt = num(o.salt, 0xe100);
    const wall = num(o.col, pal.base);
    // a SOFT parapet: each face in segments of slightly different height, so
    // the top line is hand-laid and not machined
    for (const f of F.faces(ctx)) {
      const n = Math.max(2, Math.round(f.span / clamp(unit * 0.28, 1.6, 3.4)));
      const seg = (f.span + 0.3) / n;
      for (let i = 0; i < n; i++) {
        const t = -(f.span + 0.3) / 2 + (i + 0.5) * seg;
        const hh = parH * (0.82 + ctx.hash(salt + i * 3 + f.s) * 0.36);
        F.box(ctx, f, t, ctx.rTop + hh / 2, seg * 1.02, hh, thick, pal.course(i + 20), -thick * 0.45);
      }
      // CANALES: the drains punching out through the parapet
      if (o.canales !== false) {
        const nc = Math.max(2, Math.round(f.span / clamp(unit * 0.34, 2.2, 4.2)));
        for (let i = 0; i < nc; i++) {
          const t = -f.span / 2 + (i + 0.5) * (f.span / nc);
          F.box(ctx, f, t, ctx.rTop + parH * 0.42, clamp(unit * 0.035, 0.18, 0.34), 0.20,
            thick + clamp(unit * 0.03, 0.30, 0.75), num(o.timberCol, pal.accent), -thick * 0.45);
        }
      }
    }
    const R = F.roof(ctx);
    if (o.walk !== false && R.base > 3) {
      ctx.dbox(R.cx, ctx.rTop + ctx.pp * 0.5, R.cz, R.w, Math.max(0.06, ctx.pp), R.d, F.shade(wall, 0.92));
      ctx.plat(R.cx - R.w / 2, R.cx + R.w / 2, R.cz - R.d / 2, R.cz + R.d / 2, ctx.rTop + ctx.pp);
    }
    // ---- THE LOWER MASS. Asymmetric on purpose: deep on one flank, shallow
    // opposite, both walkable, both parapeted.
    let apron = null;
    if (o.apron) {
      const side = (ctx.hash(salt + 0x11) < 0.5) ? -1 : 1;
      const horiz = (ctx.doorSide === 0 || ctx.doorSide === 1);
      const topY = Math.max(FH * 0.9, Math.min(ctx.rTop - FH * 0.6, FH * (ctx.storeys > 2 ? 1 : 0.62)));
      const deep = clamp(unit * 0.42, 1.6, 5.0), shallow = deep * 0.55;
      apron = [];
      for (const sg of [-1, 1]) {
        const reach = (sg === side) ? deep : shallow;
        // never in front of the door
        const onDoor = horiz ? ((ctx.doorSide === 2 && sg < 0) || (ctx.doorSide === 3 && sg > 0))
          : ((ctx.doorSide === 0 && sg < 0) || (ctx.doorSide === 1 && sg > 0));
        if (onDoor) continue;
        const cx = horiz ? sg * (ctx.w / 2 + reach / 2) : 0;
        const cz = horiz ? 0 : sg * (ctx.d / 2 + reach / 2);
        const bw = horiz ? reach : ctx.w * 0.94, bd = horiz ? ctx.d * 0.94 : reach;
        S(cx, topY / 2, cz, bw, topY, bd, pal.course(3));
        ctx.dbox(cx, topY + parH * 0.35, cz, bw + 0.12, parH * 0.7, bd + 0.12, pal.course(5));
        ctx.plat(cx - bw / 2, cx + bw / 2, cz - bd / 2, cz + bd / 2, topY);
        apron.push({ x: cx, z: cz, w: bw, d: bd, top: topY });
      }
    }
    return { deckY: ctx.rTop + ctx.pp, parTop: ctx.rTop + parH, apron: apron };
  };

  /* THE CORNICE — the wall head, and the strongest horizontal on most
     buildings. Five kinds, one shape of code:
       plain      a bed mould, a fascia and a crown mould
       dentil     a tight run of little blocks under the fascia
       bracket    paired scroll brackets, three stepped blocks each
       modillion  single brackets on a wide pitch, carrying a deep soffit
       corbel     three brick courses each stepping further out (no brackets) */
  F.cornice = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const unit = unitOf(ctx);
    const y = num(o.y, ctx.rTop);
    const kind = o.kind || "plain";
    const dep = Math.max(0.14, num(o.depth, clamp(unit * 0.055, 0.30, 1.10)));
    const col = num(o.col, pal.light), dark = num(o.dark, pal.trim);
    const faces = o.faces || F.faces(ctx);
    const braH = Math.max(0.24, num(o.h, clamp(ctx.FH * 0.26, 0.4, 1.1)));
    const base = y - braH - 0.5;
    for (const f of faces) {
      if (kind === "corbel") {
        for (let i = 0; i < 3; i++) {
          F.band(ctx, f, base + braH * (i + 0.5) / 1.6, braH * 0.62, dep * (0.5 + i * 0.30),
            i === 2 ? col : F.shade(col, 1 - i * 0.03), 0.5);
        }
        continue;
      }
      F.band(ctx, f, base + braH / 2, braH, dep * 0.24, F.shade(col, 0.92), 0.14);
      if (kind === "bracket" || kind === "modillion") {
        const pitch = num(o.pitch, clamp(unit * (kind === "bracket" ? 0.085 : 0.13), 0.62, 1.5));
        const nb = Math.max(3, Math.round((f.span - 0.4) / pitch));
        const bw = clamp((f.span / nb) * (kind === "bracket" ? 0.26 : 0.32), 0.12, 0.44);
        for (let i = 0; i <= nb; i++) {
          const t = -f.span / 2 + (f.span / nb) * i;
          const arms = kind === "bracket" ? [-1, 1] : [0];
          for (const sg of arms) {
            const tt = t + sg * bw * 0.85;
            for (let k = 0; k < 3; k++) {
              const u = (k + 1) / 3;
              F.box(ctx, f, tt, base + braH * (k + 0.5) / 3, bw, braH / 3 + 0.02, dep * (0.30 + u * 0.62), col);
            }
          }
          if (kind === "bracket") F.box(ctx, f, t, base + braH * 0.20, bw * 0.9, braH * 0.30, dep * 0.34, dark);
        }
      }
      if (kind === "dentil" || kind === "bracket") {
        const dn = Math.max(6, Math.round(f.span / clamp(unit * 0.035, 0.26, 0.55)));
        const dw = (f.span / dn) * 0.52;
        for (let i = 0; i <= dn; i++) {
          F.box(ctx, f, -f.span / 2 + (f.span / dn) * i, base + braH + 0.14, dw, 0.24, dep * 0.80, dark);
        }
      }
      // the moulded fascia and its crown mould: the deepest thing on the block
      F.band(ctx, f, base + braH + 0.42, 0.34, dep * 0.92, col, 0.34);
      F.band(ctx, f, base + braH + 0.68, 0.22, dep * 1.00, dark, 0.42);
      F.band(ctx, f, base + braH + 0.88, 0.26, dep * 0.86, col, 0.36);
    }
    return { top: base + braH + 1.0 };
  };

  /* A ROW OF DORMERS in a slope. The front plane is solved from the slope at
     the dormer's own TOP and then pushed out past the slope's foot, so a
     dormer can never sink into the roof it stands in — the bug every
     hand-written dormer in the kit had to be fixed for once. */
  F.dormerRow = function (ctx, slope, o) {
    o = o || {};
    if (!slope || !slope.nrm) return { count: 0 };
    const pal = P(ctx, o);
    const unit = unitOf(ctx);
    const trim = num(o.trim, pal.light), trimD = num(o.trimD, pal.trim);
    const glass = num(o.glass, pal.glass), roofC = num(o.roofCol, pal.roof);
    const hood = o.hood || "pediment";
    const faces = o.faces || F.faces(ctx);
    let count = 0;
    for (const f of faces) {
      if (!slope.slopeOn(f)) continue;
      const n0 = slope.nrm(f, 0), n1 = slope.nrm(f, 1);
      if (n0 - n1 < 0.15) continue;                       // no slope on this face
      const dh = Math.max(0.6, num(o.dh, clamp(slope.h * 0.36, 0.8, 1.6)));
      // solve u so the front plane lands just outside the wall line
      const want = f.halfN + clamp(unit * 0.04, 0.2, 0.6);
      let uf = clamp((n0 - want) / Math.max(0.1, n0 - n1), 0.08, 0.55);
      const frontN = Math.max(f.halfN + 0.12, slope.nrm(f, uf) + clamp(unit * 0.05, 0.3, 0.9));
      const y0 = slope.y0 + slope.h * uf;
      const uTop = Math.min(1, uf + dh / Math.max(0.2, slope.h));
      const availHalf = slope.tan(f, uTop) - 0.55;
      const dw = clamp(num(o.dw, unit * 0.14), 0.8, 2.1);
      if (availHalf < dw) continue;
      const nd = clamp(Math.round(num(o.n, (availHalf * 2) / Math.max(1.4, unit * 0.34))), 1, 5);
      const dep = Math.max(0.35, frontN - slope.nrm(f, uTop) + 0.3);
      for (let i = 0; i < nd; i++) {
        const t = -availHalf + (i + 0.5) * (availHalf * 2 / nd);
        count++;
        const jw = clamp(dw * 0.16, 0.12, 0.34);
        const put = function (tt, cy, len, h, depth, off, colr) {
          F.obox(ctx, f, tt, cy, len, h, depth, frontN + (off || 0), colr);
        };
        put(t, y0 + dh / 2, dw + jw * 2, dh, dep, 0, trimD);                       // the cheeks
        put(t, y0 + dh / 2, dw + jw * 2 + 0.10, dh * 0.94, 0.16, 0.06, trim);      // painted face
        put(t, y0 + dh * 0.54, dw * 0.84, dh * 0.60, 0.10, 0.12, glass);           // the sash
        put(t, y0 + dh * 0.54, 0.055, dh * 0.60, 0.10, 0.16, trim);                // muntin
        put(t, y0 + dh * 0.54, dw * 0.84, 0.05, 0.10, 0.16, trim);
        for (const sg of [-1, 1]) put(t + sg * (dw / 2 + jw * 0.4), y0 + dh * 0.54, jw, dh * 0.68, 0.14, 0.16, trim);
        put(t, y0 + dh * 0.18, dw + jw * 3.0, 0.16, 0.24, 0.20, trim);             // sill
        const hy = y0 + dh * 0.90;
        if (hood === "shed") {
          put(t, hy + 0.14, dw + jw * 3.4, 0.20, dep * 0.8, 0.18, roofC);
        } else {
          put(t, hy, dw + jw * 3.4, 0.18, 0.30, 0.22, trim);
          for (let k = 0; k < 3; k++) {
            const u = (k + 1) / 3;
            put(t, hy + 0.14 + k * 0.18, (dw + jw * 2.6) * (1 - u * 0.58), 0.19,
              0.28 - k * 0.05, 0.18 - k * 0.03, k === 1 ? trimD : trim);
          }
          if (hood === "gable") put(t, hy + 0.20, dw + jw * 1.4, 0.5, dep * 0.7, -0.10, roofC);
        }
      }
    }
    return { count: count };
  };

  /* CHIMNEY STACKS. Corbelled brick rising out of the slope and past the
     ridge, with a capping course and pots. They are what says somebody lives
     here rather than works here, and they read from a kilometre. */
  F.chimneyStack = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const S = F.solid(ctx);
    const unit = unitOf(ctx), FH = ctx.FH;
    const roof = o.roof || null;
    const y0 = num(o.y0, roof ? roof.y0 - 0.4 : ctx.rTop - 0.3);
    const top = num(o.top, roof ? roof.top + clamp(roof.h * 0.34, 0.85, 1.9)
      : ctx.rTop + clamp(FH * 0.8, 1.2, 3.0));
    const n = clamp(Math.round(num(o.n, (ctx.storeys >= 2 || unit > 12) ? 2 : 1)), 1, 3);
    const cw = Math.max(0.4, num(o.w, clamp(unit * 0.10, 0.65, 1.5)));
    const brick = num(o.col, pal.accent);
    const alongX = o.along ? (o.along === "x") : (ctx.w >= ctx.d);
    const half = (alongX ? ctx.w : ctx.d) / 2;
    const off = Math.max(cw, half - Math.max(0.9, unit * 0.14));
    const out = [];
    for (let i = 0; i < n; i++) {
      const fr = n === 1 ? 0 : (-1 + 2 * i / (n - 1)) * 0.86;
      const cx = alongX ? fr * off : 0, cz = alongX ? 0 : fr * off;
      if (top - y0 < 0.4) continue;
      // the shaft. Solid at the bottom in case it lands on a walkable terrace;
      // sbox drops the collider itself when nothing can reach it.
      S(cx, (y0 + top) / 2, cz, cw, top - y0, cw * 0.78, brick);
      if (o.courses !== false) {
        for (const u of [0.36, 0.62]) {
          ctx.dbox(cx, y0 + (top - y0) * u, cz, cw + 0.05, 0.09, cw * 0.78 + 0.05, F.shade(brick, 0.78));
        }
      }
      if (o.corbel !== false) {
        ctx.dbox(cx, top + 0.11, cz, cw + 0.24, 0.22, cw * 0.78 + 0.24, F.shade(brick, 1.10));
        ctx.dbox(cx, top + 0.29, cz, cw + 0.10, 0.14, cw * 0.78 + 0.10, F.shade(brick, 0.86));
      }
      if (o.pots !== false) {
        for (const sg of [-1, 1]) {
          ctx.dbox(cx + (alongX ? 0 : sg * cw * 0.26), top + 0.54, cz + (alongX ? sg * cw * 0.26 : 0),
            cw * 0.30, 0.40, cw * 0.30, F.shade(brick, 0.74));
        }
      }
      out.push({ x: cx, z: cz, top: top + 0.7, w: cw });
    }
    return out;
  };

  /* WHAT TERMINATES A RIDGE. "iron" is Victorian cresting — posts, two rails,
     finial buds and corner spikes; "tile" is a ridge roll with owl-tail
     finials curling up at each end; "finial" is a plain run of posts. */
  F.ridgeCrest = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const roof = o.roof || null;
    const y = num(o.y, roof ? roof.top + 0.2 : ctx.rTop + 0.2);
    const W = num(o.w, roof ? (roof.nrm ? roof.tan(F.face(ctx, 0), 1) * 2 : ctx.w) : ctx.w);
    const D = num(o.d, roof ? (roof.nrm ? roof.nrm(F.face(ctx, 0), 1) * 2 : ctx.d) : ctx.d);
    const kind = o.kind || "iron";
    const col = num(o.col, kind === "tile" ? pal.roof : F.shade(pal.shadow, 0.8));
    const unit = unitOf(ctx);
    const h = Math.max(0.16, num(o.h, clamp(unit * 0.06, 0.3, 0.9)));
    const dW = Math.max(0.3, W), dD = Math.max(0.3, D);
    if (kind === "tile") {
      const alongX = dW >= dD;
      ctx.dbox(0, y + h * 0.4, 0, alongX ? dW + 0.3 : h * 1.4, h * 0.8, alongX ? h * 1.4 : dD + 0.3, col);
      ctx.dbox(0, y + h * 0.85, 0, alongX ? dW * 0.9 : h * 0.9, h * 0.4, alongX ? h * 0.9 : dD * 0.9, F.shade(col, 1.2));
      for (const sg of [-1, 1]) for (let j = 0; j < 3; j++) {
        const ex = (alongX ? dW : dD) * 0.5 + h * (0.3 + j * 0.55);
        ctx.dbox(alongX ? sg * ex : 0, y + h * (0.8 + j * 0.7), alongX ? 0 : sg * ex,
          h * (1.1 - j * 0.22), h * 0.9, h * (1.1 - j * 0.22), j === 2 ? pal.trim : F.shade(col, 1.2));
      }
      return { top: y + h * 3 };
    }
    const pitch = num(o.pitch, clamp(unit * 0.11, 0.55, 1.4));
    for (const ax of [0, 1]) {
      const len = ax ? dD : dW, other = (ax ? dW : dD) / 2 - 0.02;
      const np = Math.max(2, Math.round(len / pitch));
      for (const sg of [-1, 1]) {
        for (let i = 0; i <= np; i++) {
          const t = -len / 2 + (len / np) * i;
          const px = ax ? sg * other : t, pz = ax ? t : sg * other;
          ctx.dbox(px, y + h / 2, pz, 0.09, h, 0.09, col);
          if (kind !== "finial") ctx.dbox(px, y + h * 0.62, pz, 0.16, 0.09, 0.16, col);
        }
        if (kind !== "finial") {
          const rx = ax ? sg * other : 0, rz = ax ? 0 : sg * other;
          ctx.dbox(rx, y + h, rz, ax ? 0.07 : len, 0.08, ax ? len : 0.07, col);
          ctx.dbox(rx, y + h * 0.34, rz, ax ? 0.06 : len, 0.06, ax ? len : 0.06, col);
        }
      }
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      ctx.dbox(sx * (dW / 2 - 0.02), y + h * 0.6, sz * (dD / 2 - 0.02), 0.16, h * 1.2, 0.16, col);
      ctx.dbox(sx * (dW / 2 - 0.02), y + h * 1.30, sz * (dD / 2 - 0.02), 0.20, 0.20, 0.20, col);
    }
    return { top: y + h * 1.5 };
  };

  // ============================================================
  //  5. FRONT
  // ============================================================

  /* FRONT STEPS. Cosmetic treads over ONE continuous ramp platform, so a
     sprinting player cannot sample a seam between them, and no collider — a
     monumental stair must never be able to seal a building's own front door.
     `out` is where the flight starts, measured out from the wall plane. */
  F.steps = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const e = F.entrance(ctx);
    const f = o.face || e.f;
    const top = Math.max(0.05, num(o.top, F.STEP_RISE));
    if (e.driveIn && o.force !== true) return { depth: 0, width: 0, top: top };
    const width = Math.max(1.2, num(o.width, Math.min(f.span - 0.6, e.gap + clamp(f.span * 0.30, 1.8, 4.2))));
    const out = Math.max(0, num(o.out, 0));
    const depth = Math.max(0.5, num(o.depth, clamp(top * 2.2, 0.8, 2.4)));
    const nS = clamp(Math.round(num(o.treads, Math.max(2, top / 0.20))), 1, 6);
    const col = num(o.col, F.shade(pal.light, 0.94));
    for (let i = 0; i < nS; i++) {
      const th = top * (nS - i) / nS;
      const o0 = out + i * (depth / nS);
      F.obox(ctx, f, 0, th / 2, width - i * 0.24, th, depth / nS + 0.02,
        f.halfN + o0 + depth / nS, F.shade(col, 0.94 + i * 0.03), true);
    }
    // ONE ramp platform under the whole flight
    const a0 = f.halfN + out, a1 = f.halfN + out + depth;
    if (f.horiz) {
      const z0 = f.out * a0, z1 = f.out * a1;
      ctx.plat(-width / 2, width / 2, Math.min(z0, z1), Math.max(z0, z1), top,
        { z0: ctx.oz + z1, z1: ctx.oz + z0, y0: 0, y1: top });
    } else {
      const x0 = f.out * a0, x1 = f.out * a1;
      ctx.plat(Math.min(x0, x1), Math.max(x0, x1), -width / 2, width / 2, top,
        { axis: "x", x0: ctx.ox + x1, x1: ctx.ox + x0, y0: 0, y1: top });
    }
    if (o.cheeks !== false) {
      const cw = clamp(top * 1.1, 0.34, 0.8);
      for (const sg of [-1, 1]) {
        F.obox(ctx, f, sg * (width / 2 + cw * 0.6), top * 0.62, cw, top * 1.24, depth + 0.24,
          f.halfN + out + depth + 0.12, num(o.capCol, pal.base), true);
      }
    }
    return { depth: depth, width: width, top: top };
  };

  /* A PORCH: the roofed entrance on the door face. Deck (walkable), posts,
     head beam, a shed / gable / flat roof, and the steps up to it. Everything
     is solved so the beam soffit clears the door head — a porch that hangs
     into its own doorway is the commonest failure in the kit. */
  F.porch = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const e = F.entrance(ctx);
    const f = o.face || e.f;
    const FH = ctx.FH, unit = unitOf(ctx);
    const depth = Math.max(0.9, num(o.depth, clamp(unit * 0.17, 1.2, 3.0)));
    const width = Math.max(2.0, num(o.width, Math.min(f.span - 0.4, e.gap + clamp(f.span * 0.34, 2.2, 6.0))));
    const deckTop = e.driveIn ? 0 : clamp(num(o.deckTop, 0.30), 0, F.STEP_RISE);
    const eave = Math.max(e.head + 0.30, num(o.eave, Math.min(FH + 0.45, ctx.rTop - 0.35)));
    const trim = num(o.col, pal.light), trimD = num(o.trimCol, pal.trim);
    const roofC = num(o.roofCol, pal.roof);
    const outN = f.halfN + depth;

    // the deck
    if (deckTop > 0.02) {
      F.obox(ctx, f, 0, deckTop - 0.09, width, 0.18, depth, outN, F.shade(trim, 0.95), true);
      F.obox(ctx, f, 0, deckTop - 0.24, width + 0.06, 0.14, depth * 0.94, outN + 0.04, trimD);
      if (f.horiz) ctx.plat(-width / 2, width / 2, Math.min(0, f.out * outN), Math.max(0, f.out * outN), deckTop);
      else ctx.plat(Math.min(0, f.out * outN), Math.max(0, f.out * outN), -width / 2, width / 2, deckTop);
      F.steps(ctx, { face: f, top: deckTop, width: Math.min(width - 0.4, e.gap + 1.6), out: depth, pal: pal });
    }
    // the posts, on the edge of the deck and never in the doorway
    const nP = clamp(Math.round(num(o.posts, width / clamp(unit * 0.20, 1.8, 3.2))), 2, 6);
    const pr = Math.max(0.09, num(o.postR, clamp(depth * 0.115, 0.10, 0.24)));
    const beamBot = eave - clamp(FH * 0.14, 0.28, 0.55);
    const meshes = (o.round === true) ? F.mesh(ctx, nP + 1) : 0;
    let used = 0;
    for (let i = 0; i <= nP; i++) {
      const t = -width / 2 + (width / nP) * i;
      if (!F.clearsDoor(ctx, f, t, pr * 3)) continue;
      const px = f.horiz ? t : f.out * (outN - pr * 1.3), pz = f.horiz ? f.out * (outN - pr * 1.3) : t;
      F.obox(ctx, f, t, deckTop + 0.09, pr * 3.0, 0.18, pr * 3.0, outN - pr * 0.1, trimD, true);
      if (used < meshes) { ctx.column(px, deckTop + 0.18, pz, pr, beamBot - deckTop - 0.18, trim, 10); used++; F.solid(ctx)(px, (deckTop + beamBot) / 2, pz, pr * 1.4, beamBot - deckTop, pr * 1.4, trim); }
      else boxShaft(ctx, px, deckTop + 0.18, pz, beamBot - deckTop - 0.18, pr, trim, F.mix(trim, 0xffffff, 0.16), true);
      F.obox(ctx, f, t, beamBot - 0.06, pr * 2.6, 0.14, pr * 2.6, outN - pr * 0.1, trimD);
    }
    // the head beam and the roof
    F.obox(ctx, f, 0, beamBot + 0.16, width + 0.3, 0.32, depth + 0.10, outN + 0.08, trim);
    const kind = o.roof || "shed";
    if (kind === "flat") {
      F.obox(ctx, f, 0, eave + 0.10, width + 0.5, 0.20, depth + 0.30, outN + 0.18, roofC);
    } else if (kind === "gable") {
      const rise = clamp(width * 0.16, 0.4, 1.3), nC = 5;
      for (let i = 0; i < nC; i++) {
        const u = (i + 0.5) / nC;
        F.obox(ctx, f, 0, eave + rise * u, (width + 0.5) * (1 - u * 0.92), rise / nC + 0.03,
          depth + 0.30, outN + 0.18, i % 2 ? F.shade(roofC, 1.15) : roofC);
      }
    } else {
      const nC = 5, rise = clamp(depth * 0.34, 0.25, 0.9);
      for (let i = 0; i < nC; i++) {
        const u = (i + 0.5) / nC;
        F.obox(ctx, f, 0, eave + rise * u, width + 0.5, rise / nC + 0.05,
          (depth + 0.30) * (1 - u * 0.80), outN + 0.18 - (depth + 0.30) * u * 0.10,
          i % 2 ? F.shade(roofC, 1.15) : roofC);
      }
    }
    return { deckTop: deckTop, eave: eave, depth: depth, width: width };
  };

  /* THE VERANDA, and on a taller host the two-storey GALLERY. Posts round the
     perimeter (corner posts shared by the two faces that meet there, which is
     what makes a colonnade TURN instead of stopping at each corner), a deck
     at every floor line, and a balustrade run between each pair of posts.

     THE DECKS LIVE IN THE HOST'S SOLID SILL ZONE (k*FH … k*FH+0.55). That is
     the only reason a two-metre projection may touch the wall at all. */
  F.veranda = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const FH = ctx.FH, unit = unitOf(ctx), ST = Math.max(1, ctx.storeys | 0);
    const e = F.entrance(ctx);
    const depth = Math.max(0.9, num(o.depth, clamp(unit * 0.16, 1.2, 3.0)));
    const deckTop = clamp(num(o.deckTop, 0.30), 0.0, F.STEP_RISE);
    const sides = o.sides || "all";
    const trim = num(o.col, pal.light), trimD = num(o.trimCol, pal.trim);
    const dark = num(o.darkCol, pal.shadow);
    const nStorey = clamp(Math.round(num(o.storeys, ST)), 1, ST);
    const colTop = num(o.colTop, Math.min(ctx.rTop - 0.3, nStorey * FH + FH * 0.10));
    const faces = (sides === "front") ? [e.f] : F.faces(ctx);
    const useFace = {}; for (const f of faces) useFace[f.s] = true;
    const hw = Math.max(0.10, num(o.postR, clamp(depth * 0.13, 0.11, 0.28)));

    // ---- post tangents per axis, shared so corners are stood once
    const pitch = num(o.postPitch, clamp(unit * 0.24, 2.0, 3.6));
    function runT(span) {
      const n = Math.max(1, Math.round((span - 0.4) / pitch));
      const out = [];
      for (let i = 0; i <= n; i++) out.push(-(span / 2) + (span / n) * i);
      return out;
    }
    const cxC = ctx.w / 2 + depth - hw * 1.2, czC = ctx.d / 2 + depth - hw * 1.2;
    const PX = runT(ctx.w + depth * 2 - hw * 2.4), PZ = runT(ctx.d + depth * 2 - hw * 2.4);

    // ---- the deck and the plats
    for (const f of faces) {
      const outN = f.halfN + depth;
      const len = f.span + (useFace[f.horiz ? 2 : 0] ? depth * 2 : 0) + 0.1;
      const bay = (f.s === ctx.doorSide && e.driveIn) ? e.gap + 1.0 : 0;
      const lay = function (cy, h, dep, on, colr) {
        if (bay <= 0) { F.obox(ctx, f, 0, cy, len, h, dep, on, colr, cy < 1.2); return; }
        const seg = (len - bay) / 2;
        if (seg > 0.25) for (const sg of [-1, 1]) F.obox(ctx, f, sg * (bay + seg) / 2, cy, seg, h, dep, on, colr, cy < 1.2);
      };
      if (deckTop > 0.02) {
        lay(deckTop - 0.10, 0.20, depth, outN, trim);
        lay(deckTop - 0.26, 0.14, 0.14, outN + 0.05, trimD);
        lay(deckTop * 0.45, deckTop * 0.9, depth * 0.94, outN - 0.06, dark);
      }
    }
    if (deckTop > 0.02 && o.walk !== false) {
      const hx = ctx.w / 2, hz = ctx.d / 2;
      if (useFace[0]) ctx.plat(-(hx + depth), hx + depth, -(hz + depth), -hz, deckTop);
      if (useFace[1]) ctx.plat(-(hx + depth), hx + depth, hz, hz + depth, deckTop);
      if (useFace[2]) ctx.plat(-(hx + depth), -hx, -(hz + depth), hz + depth, deckTop);
      if (useFace[3]) ctx.plat(hx, hx + depth, -(hz + depth), hz + depth, deckTop);
      F.steps(ctx, { top: deckTop, out: depth, width: e.gap + clamp(unit * 0.24, 1.4, 3.2), pal: pal });
    }

    // ---- the posts
    const spots = [];
    if (sides === "front") {
      for (const t of PX) spots.push({ x: t, z: e.f.horiz ? e.f.out * czC : t });
      spots.length = 0;
      const f = e.f;
      const line = f.horiz ? PX : PZ;
      for (const t of line) {
        if (Math.abs(t) > f.span / 2 + 0.05) continue;
        spots.push(f.horiz ? { x: t, z: f.out * czC } : { x: f.out * cxC, z: t });
      }
    } else {
      for (const sg of [-1, 1]) {
        for (const t of PX) spots.push({ x: t, z: sg * czC });
        for (const t of PZ) { if (Math.abs(Math.abs(t) - czC) < 0.01) continue; spots.push({ x: sg * cxC, z: t }); }
      }
    }
    const meshes = (o.round === true) ? F.mesh(ctx, spots.length) : 0;
    let used = 0;
    for (const p of spots) {
      const onDoorX = (ctx.doorSide === 0 && p.z < 0) || (ctx.doorSide === 1 && p.z > 0);
      const onDoorZ = (ctx.doorSide === 2 && p.x < 0) || (ctx.doorSide === 3 && p.x > 0);
      if (onDoorX && Math.abs(p.x) < (e.gap + hw * 2) / 2) continue;
      if (onDoorZ && Math.abs(p.z) < (e.gap + hw * 2) / 2) continue;
      const h = colTop - deckTop - 0.4;
      if (h < 0.5) continue;
      ctx.dbox(p.x, deckTop + 0.13, p.z, hw * 2.9, 0.26, hw * 2.9, trim);           // plinth block
      ctx.dbox(p.x, deckTop + 0.32, p.z, hw * 2.5, 0.14, hw * 2.5, trimD);          // base mould
      if (used < meshes) { ctx.column(p.x, deckTop + 0.39, p.z, hw, h, trim, 10); used++; F.solid(ctx)(p.x, deckTop + 0.39 + h / 2, p.z, hw * 1.4, h, hw * 1.4, trim); }
      else boxShaft(ctx, p.x, deckTop + 0.39, p.z, h, hw, trimD, trim, true);
      ctx.dbox(p.x, colTop - 0.30, p.z, hw * 1.86, 0.12, hw * 1.86, trimD);         // necking
      ctx.dbox(p.x, colTop - 0.17, p.z, hw * 2.3, 0.14, hw * 2.3, trim);            // echinus
      ctx.dbox(p.x, colTop - 0.06, p.z, hw * 2.75, 0.12, hw * 2.75, trim);          // abacus
    }

    // ---- the galleries: a deck and a balustrade at every floor line
    const railH = clamp(FH * 0.29, 0.85, 1.15);
    function railRun(f, t0, t1, yDeck, outN) {
      const inner = (t1 - t0) - hw * 2.2;
      if (inner < 0.4) return;
      const tc = (t0 + t1) / 2;
      F.obox(ctx, f, tc, yDeck + 0.13, inner, 0.13, 0.17, outN, trim);
      const cnt = Math.max(2, Math.round(inner / 0.34)), sp = inner / cnt;
      for (let i = 0; i < cnt; i++) {
        const t = t0 + hw * 1.1 + (i + 0.5) * sp;
        F.obox(ctx, f, t, yDeck + (railH + 0.22) / 2, sp * 0.30, railH - 0.24, 0.12, outN - 0.02, trim);
        F.obox(ctx, f, t, yDeck + 0.22 + (railH - 0.24) * 0.34, sp * 0.50, (railH - 0.24) * 0.26, 0.14, outN - 0.01, trimD);
      }
      F.obox(ctx, f, tc, yDeck + railH, inner, 0.14, 0.22, outN + 0.02, trim);
      F.obox(ctx, f, tc, yDeck + railH + 0.11, inner, 0.08, 0.28, outN + 0.05, trimD);
    }
    for (let k = 1; k < nStorey; k++) {
      const y = k * FH;
      for (const f of faces) {
        const outN = f.halfN + depth;
        const len = f.span + (useFace[f.horiz ? 2 : 0] ? depth * 2 : 0) + 0.1;
        F.obox(ctx, f, 0, y + 0.34, len, 0.36, depth, outN, trim);
        F.obox(ctx, f, 0, y + 0.14, len - 0.10, 0.10, depth * 0.96, outN - 0.06, dark);
        F.obox(ctx, f, 0, y + 0.44, len + 0.06, 0.16, 0.13, outN + 0.05, trimD);
        F.band(ctx, f, y + 0.07, 0.12, 0.05, dark, 0.14);
        const L = f.horiz ? PX : PZ;
        for (let i = 0; i + 1 < L.length; i++) railRun(f, L[i], L[i + 1], y + 0.52, outN - 0.14);
      }
    }
    if (nStorey === 1 && o.rail !== false && deckTop > 0.02) {
      for (const f of faces) {
        const L = f.horiz ? PX : PZ, outN = f.halfN + depth;
        for (let i = 0; i + 1 < L.length; i++) {
          const mid = (L[i] + L[i + 1]) / 2;
          if (f.s === ctx.doorSide && Math.abs(mid) < e.gap / 2 + 0.8) continue;
          railRun(f, L[i], L[i + 1], deckTop, outN - 0.14);
        }
      }
    }
    return { depth: depth, deckTop: deckTop, tX: PX, tZ: PZ, colTop: colTop, postR: hw };
  };

  /* A MONUMENTAL PORTAL — the pishtaq, the church west door, the temple gate.
     A tall rectangular frame standing proud of everything else, enclosing a
     RECESSED arch set back inside it, with muqarnas or a tympanum in the head
     and a crest on top. Its height is solved so it overtops whatever the
     ground storey wears and stops short of the cornice; it never exceeds the
     wall, and the arch springs above the door head so nothing hangs into the
     doorway. Jambs and reveals are SOLID — this is a mass a player walks into. */
  F.portal = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const e = F.entrance(ctx);
    const f = o.face || e.f;
    const FH = ctx.FH, unit = unitOf(ctx), H = ctx.rTop;
    const col = num(o.col, pal.light), dark = num(o.dark, pal.shadow), tile = num(o.tile, pal.accent);
    const wid = clamp(num(o.width, Math.max(e.gap + 2.6, f.span * 0.30)), 2.4, f.span * 0.58);
    const depth = Math.max(0.25, num(o.depth, clamp(unit * 0.07, 0.45, 1.6)));
    const jamb = clamp(num(o.jamb, wid * 0.16), 0.35, 1.4);
    const top = clamp(num(o.top, Math.max(FH * 1.35, H * 0.72)), Math.min(e.head + 1.4, H - 0.5), H - 0.45);
    const frameW = wid + jamb * 2;
    const kind = o.kind || "pointed";

    for (const sg of [-1, 1]) {
      F.sRib(ctx, f, sg * (wid + jamb) / 2, 0, top, jamb, depth, col, 0);
      if (o.tileFillet !== false) F.rib(ctx, f, sg * (wid / 2 + jamb * 0.24), 0.4, top - 0.5, jamb * 0.30, depth + 0.06, tile, 0);
    }
    F.box(ctx, f, 0, top - jamb * 0.55, frameW, jamb * 1.1, depth, col, 0);
    // an inscription band inside the frame head
    const bn = Math.max(5, Math.round(frameW / 0.7));
    for (let i = 0; i < bn; i++) {
      const t = -frameW / 2 + (i + 0.5) * (frameW / bn);
      F.box(ctx, f, t, top - jamb * 0.55, (frameW / bn) * 0.7, jamb * 0.5, 0.10, (i % 2) ? F.shade(tile, 0.8) : tile, depth);
    }
    F.box(ctx, f, 0, top + 0.16, frameW + 0.44, 0.32, depth + 0.20, F.shade(col, 0.86), 0);
    if (o.crest !== false) {
      const mn = Math.max(3, Math.round(frameW / 1.1)), step = frameW / mn;
      for (let i = 0; i < mn; i++) {
        const t = -frameW / 2 + (i + 0.5) * step;
        F.box(ctx, f, t, top + 0.52, step * 0.62, 0.42, depth * 0.6, col, 0);
        F.box(ctx, f, t, top + 0.86, step * 0.38, 0.30, depth * 0.6, col, 0);
      }
    }
    // THE RECESSED ARCH, springing above the door head
    const spring = Math.max(e.head + 0.2, num(o.spring, FH * 0.75));
    const rise = Math.max(0.6, Math.min(top - 0.9 - spring, wid * (kind === "pointed" ? 0.75 : 0.5)));
    const rq = Math.max(0.06, depth - clamp(depth * 0.42, 0.2, 0.6));
    F.sBox(ctx, f, 0, (spring + rise * 0.5) / 1, wid, spring + rise + 0.4, 0.14, F.shade(dark, 0.9), rq);
    /* THE RING HAS TO STAND ON THE GROUND IT FRAMES. The recess ground above
       is a 0.14-deep box at inset rq, so its outer FACE is at rq + 0.14 — and
       the ring was being drawn at rq + 0.12, two centimetres BEHIND the plane
       it is supposed to sit on. It was never visible on any portal in the kit;
       caravanserai noticed and drew its own voussoirs over the top. */
    F.arch(ctx, f, 0, spring, wid * 0.86, rise, 0.16, rq + 0.16, col, kind);
    if (o.muqarnas !== false && rise > 0.9) {
      const tiers = 4, th = Math.min(0.42, rise / (tiers + 1));
      for (let r = 0; r < tiers; r++) {
        const frac = 1 - r * 0.19;
        const cells = Math.max(2, Math.round((wid * frac) / 0.55));
        const cw = (wid * frac * 0.9) / cells;
        const y = spring + rise - 0.25 - r * th;
        for (let i = 0; i < cells; i++) {
          F.box(ctx, f, -wid * frac * 0.45 + (i + 0.5) * cw, y, cw * 0.82, th * 0.86,
            0.16 + r * 0.055, (r % 2) ? F.shade(col, 0.86) : col, rq);
        }
      }
    }
    if (o.steps !== false && !e.driveIn) {
      F.steps(ctx, { face: f, top: clamp(FH * 0.09, 0.16, 0.34), width: wid + 1.0, out: depth + 0.1, pal: pal });
    }
    return { frameW: frameW, top: top, depth: depth, spring: spring, rise: rise };
  };

  // ============================================================
  //  6. CROWN
  // ============================================================

  /* THE CROWN STACK — the thing seven facades each hand-rolled.

     THE BUDGET IS A FRACTION OF ctx.rTop, never storeys times a constant. A
     crown that TERMINATES a building is 30-45% of it; anything more is a
     second skyscraper that landed on an office block, which is exactly what a
     per-storey rule produces on a tall one. How many stages the budget can
     AFFORD follows from the height available, never from the storey count:
     splitting a 3 m stack four ways gives four 40 cm trays that read as noise.
     Both plan axes step in by DIFFERENT amounts and the remainder is shoved
     off-centre, because a zoning envelope steps where the lot lines are. */
  F.crownStack = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const H = ctx.rTop, FH = ctx.FH, unit = unitOf(ctx);
    const salt = num(o.salt, 0xf200);
    const budget = Math.max(FH * 0.6, num(o.budget, H * (0.34 + ctx.hash(salt) * 0.10)));
    const nStage = clamp(Math.round(num(o.stages, budget / (FH * 0.62))), 2, 5);
    const stone = num(o.col, pal.base), light = num(o.lightCol, pal.light);
    const metal = num(o.capCol, pal.trim), shadow = num(o.shadowCol, pal.shadow);
    const bias0 = num(o.bias, 0.9);
    let sy = H, sw = ctx.slabW, sd = ctx.slabD, sx = ctx.slabCx, sz = ctx.slabCz;
    let wsum = 0; for (let i = 0; i < nStage; i++) wsum += 1 - i * 0.16;
    let cap = metal;
    for (let i = 0; i < nStage; i++) {
      // the FIRST stage barely steps in — it is the shoulder standing on the
      // roof edge, and if it starts small the roof reads as a bare deck with a
      // lid dropped on it. Everything above bites hard.
      const k0 = i === 0 ? 0.86 : 0.62, kr = i === 0 ? 0.09 : 0.16;
      const nw = sw * (k0 + ctx.hash(salt + 0x10 + i) * kr);
      const nd = sd * (k0 + ctx.hash(salt + 0x20 + i) * kr);
      if (nw < 1.0 || nd < 1.0) break;
      const bias = (ctx.hash(salt + 0x30 + i) - 0.5) * (i === 0 ? bias0 * 0.45 : bias0);
      const nx = sx + (sw - nw) / 2 * bias, nz = sz + (sd - nd) / 2 * bias;
      const sh = budget * ((1 - i * 0.16) / wsum) - 0.32;
      if (sh < 0.35) break;
      ctx.dbox(nx, sy + sh / 2, nz, nw, sh, nd, F.shade(stone, 1 - i * 0.02));
      if (o.glazed) ctx.dbox(nx, sy + sh / 2, nz, nw + 0.06, sh * 0.86, nd + 0.06, pal.glass);
      if (o.piers !== false) {
        const PJ = Math.max(0.18, clamp(unit * 0.02, 0.18, 0.5));
        const pn = Math.max(2, Math.round(nw / clamp(unit * 0.24, 2.4, 4.4)));
        const ppw = clamp(nw / (pn * 3), 0.20, 0.9);
        for (let k = 0; k <= pn; k++) {
          const t = -nw / 2 + (nw / pn) * k;
          for (const sg of [-1, 1]) ctx.dbox(nx + t, sy + sh / 2, nz + sg * (nd / 2 + PJ * 0.4), ppw, sh, PJ * 0.8, light);
        }
        const dn = Math.max(2, Math.round(nd / clamp(unit * 0.24, 2.4, 4.4)));
        const dpw = clamp(nd / (dn * 3), 0.20, 0.9);
        for (let k = 0; k <= dn; k++) {
          const t = -nd / 2 + (nd / dn) * k;
          for (const sg of [-1, 1]) ctx.dbox(nx + sg * (nw / 2 + PJ * 0.4), sy + sh / 2, nz + t, PJ * 0.8, sh, dpw, light);
        }
      }
      const cy = sy + sh;
      ctx.dbox(nx, cy + 0.09, nz, nw + 0.6, 0.18, nd + 0.6, shadow);        // setback reveal
      ctx.dbox(nx, cy + 0.25, nz, nw + 0.3, 0.14, nd + 0.3, cap);           // metal line
      cap = F.shade(cap, 0.86);
      sy = cy + 0.32; sw = nw; sd = nd; sx = nx; sz = nz;
    }
    return { top: sy, w: sw, d: sd, cx: sx, cz: sz };
  };

  /* A RUN OF FINIALS along a face top or right round the building. Merlons,
     stepped Mamluk merlons, gothic pinnacles, classical acroteria, ball
     finials, crockets. Three notches in the skyline for nothing. */
  F.finialRow = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const unit = unitOf(ctx);
    const y = num(o.y, ctx.rTop + 0.3);
    const kind = o.kind || "merlon";
    const col = num(o.col, pal.light);
    const faces = o.faces || F.faces(ctx);
    let count = 0;
    for (const f of faces) {
      const n = Math.max(3, Math.round(num(o.n, f.span / clamp(unit * 0.16, 1.0, 2.4))));
      const wid = Math.max(0.14, num(o.wid, (f.span / n) * 0.52));
      const h = Math.max(0.2, num(o.h, clamp(unit * 0.06, 0.34, 1.1)));
      const proj = Math.max(0.12, num(o.proj, clamp(unit * 0.03, 0.22, 0.55)));
      const step = f.span / n;
      for (let i = 0; i <= n; i++) {
        const t = -f.span / 2 + i * step;
        count++;
        if (kind === "stepped") {
          F.box(ctx, f, t, y + h * 0.5, wid, h, proj, col);
          F.box(ctx, f, t, y + h * 1.3, wid * 0.62, h * 0.6, proj * 0.9, col);
        } else if (kind === "pinnacle") {
          F.box(ctx, f, t, y + h * 0.5, wid, h, proj, col);
          for (let k = 0; k < 4; k++) {
            const u = (k + 1) / 4;
            F.box(ctx, f, t, y + h + h * (k + 0.5) * 0.42, wid * (1 - u * 0.72), h * 0.44, proj * (1 - u * 0.5), col);
          }
          // crockets down the spirelet
          for (const sg of [-1, 1]) F.box(ctx, f, t + sg * wid * 0.55, y + h * 1.5, wid * 0.28, wid * 0.28, proj * 0.8, F.shade(col, 0.88));
        } else if (kind === "acroterion") {
          for (let k = 0; k < 3; k++) {
            const u = (k + 1) / 3;
            F.box(ctx, f, t, y + h * (k + 0.5) / 3, wid * 1.4 * (1 - u * 0.52), h / 3 + 0.02, proj, k === 1 ? F.shade(col, 0.92) : col);
          }
        } else if (kind === "ball") {
          F.box(ctx, f, t, y + h * 0.4, wid * 0.5, h * 0.8, proj * 0.7, col);
          F.box(ctx, f, t, y + h * 0.95, wid * 0.8, wid * 0.8, proj * 0.9, col);
          F.box(ctx, f, t, y + h * 1.25, wid * 0.5, wid * 0.5, proj * 0.6, col);
        } else if (kind === "crocket") {
          for (let k = 0; k < 3; k++) {
            F.box(ctx, f, t, y + h * (0.3 + k * 0.45), wid * (1 - k * 0.2), h * 0.34, proj * (0.7 + k * 0.16), col);
          }
        } else {
          F.box(ctx, f, t, y + h * 0.5, wid, h, proj, col);
        }
      }
    }
    return { count: count };
  };

  /* A DOME ON A DRUM — BUTTRESSED, not a ball on a box.

     A real dome never lands a circular drum straight on a flat roof: there is
     a stepped masonry substructure spreading the load out to the piers, and
     semi-domes on the four axes taking the thrust down into it. Those
     semi-domes are the reason the crown reads as architecture rather than as
     a sphere someone parked on a roof, and the weight turrets on the
     diagonals are what pin the corners of the substructure down.

     MESH-BUDGET AWARE: asks F.mesh for what it wants and degrades to stacked
     boxes (an honest stepped dome) when the budget is gone. */
  F.domeOnDrum = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const R0 = F.roof(ctx);
    const roofCx = num(o.cx, R0.cx), roofCz = num(o.cz, R0.cz);
    const R = clamp(num(o.r, R0.base * 0.30), 1.0, 12.0);
    const drumR = R * 0.94;
    const drumH = Math.max(0.6, num(o.drumH, clamp(ctx.FH * 0.75, 1.2, 3.6)));
    const drumY = num(o.y, R0.y);
    const stone = num(o.col, pal.light), stoneD = F.shade(stone, 0.82);
    const shell = num(o.shellCol, pal.roof), tile = num(o.accent, pal.accent);
    const trim = num(o.trim, pal.trim);

    // the square substructure
    const baseTop = F.ziggurat(ctx, roofCx, roofCz, drumY, drumR * 2.5, drumR * 2.5, drumH * 0.55, 2, stone, 0.84, 0.05);
    const want = 2 + (o.semis === false ? 0 : 4) + (o.turrets === false ? 0 : 8) + (o.finial === false ? 0 : 1);
    const got = (o.meshes === false) ? 0 : F.mesh(ctx, want);
    let spend = got;
    const take = function (n) { const g = Math.min(n, spend); spend -= g; return g; };

    // the drum: a real cylinder if we can afford one, else a boxed polygon
    if (take(1)) ctx.column(roofCx, baseTop, roofCz, drumR, drumH, stone, 16);
    else {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI;
        ctx.dbox(roofCx, baseTop + drumH / 2, roofCz, drumR * 2 * Math.cos(a * 0.5) || drumR * 2,
          drumH, drumR * 2 * Math.sin(a * 0.5) || drumR * 0.6, stone);
      }
      ctx.dbox(roofCx, baseTop + drumH / 2, roofCz, drumR * 1.86, drumH, drumR * 1.86, stone);
    }
    // a ring of pointed lights round the drum, as free teeth
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.dbox(roofCx + Math.cos(a) * drumR * 0.99, baseTop + drumH * 0.55, roofCz + Math.sin(a) * drumR * 0.99,
        drumR * 0.16, drumH * 0.5, drumR * 0.16, stoneD);
    }
    ctx.dbox(roofCx, baseTop + drumH - 0.12, roofCz, drumR * 2.06, 0.24, drumR * 2.06, tile);

    const domeY = baseTop + drumH;
    if (take(1)) ctx.dome(roofCx, domeY, roofCz, R, shell);
    else {
      // an honest stepped dome: slices of a hemisphere, free
      const n = 7;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n, rr = R * Math.sqrt(Math.max(0, 1 - u * u));
        ctx.dbox(roofCx, domeY + u * R, roofCz, rr * 2, R / n + 0.04, rr * 2, F.shade(shell, 1 - i * 0.02));
      }
    }
    if (o.finial !== false) {
      ctx.dbox(roofCx, domeY + R + 0.35, roofCz, R * 0.10, R * 0.7, R * 0.10, trim);
      if (take(1)) ctx.ball(roofCx, domeY + R + 0.72 + R * 0.10, roofCz, clamp(R * 0.14, 0.16, 0.6), trim);
      else ctx.dbox(roofCx, domeY + R + 0.78, roofCz, R * 0.24, R * 0.24, R * 0.24, trim);
    }
    // THE SEMI-DOMES: the buttresses
    if (o.semis !== false) {
      const sR = R * 0.58, sOff = drumR + sR * 0.18;
      for (const v of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const px = roofCx + v[0] * sOff, pz = roofCz + v[1] * sOff;
        ctx.dbox(px, baseTop + drumH * 0.22, pz, sR * 1.9, drumH * 0.99, sR * 1.9, stone);
        if (take(1)) ctx.dome(px, baseTop + drumH * 0.44, pz, sR, shell);
        else {
          for (let i = 0; i < 4; i++) {
            const u = (i + 0.5) / 4, rr = sR * Math.sqrt(Math.max(0, 1 - u * u));
            ctx.dbox(px, baseTop + drumH * 0.44 + u * sR, pz, rr * 2, sR / 4 + 0.04, rr * 2, shell);
          }
        }
      }
    }
    // WEIGHT TURRETS on the diagonals
    if (o.turrets !== false) {
      const tR = clamp(R * 0.16, 0.18, 0.7), tOff = drumR * 1.02, tH = drumH * 1.05;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = roofCx + sx * tOff, pz = roofCz + sz * tOff;
        if (take(1)) ctx.column(px, baseTop, pz, tR, tH, stone, 8);
        else ctx.dbox(px, baseTop + tH / 2, pz, tR * 1.8, tH, tR * 1.8, stone);
        if (take(1)) ctx.cone(px, baseTop + tH, pz, tR * 1.25, tH * 0.62, shell);
        else F.ziggurat(ctx, px, pz, baseTop + tH, tR * 2.4, tR * 2.4, tH * 0.62, 3, shell, 0.62, 0.04);
      }
    }
    return { top: domeY + R + 1.2, R: R, drumTop: domeY, baseTop: baseTop };
  };

  /* A SPIRE. Stepped courses tapering to a point, with an optional broach
     base (the square-to-octagon transition every real spire needs), a mast
     and a ball. `concave` gives the swept, entasis profile of a Gothic
     spire or a Chinese hip; the default straight taper is a pyramid. */
  F.spire = function (ctx, o) {
    o = o || {};
    const pal = P(ctx, o);
    const unit = unitOf(ctx);
    const cx = num(o.cx, ctx.slabCx), cz = num(o.cz, ctx.slabCz);
    const y = num(o.y, ctx.rTop + ctx.pp);
    const base = Math.max(0.4, num(o.base, Math.min(ctx.slabW, ctx.slabD) * 0.52));
    const h = Math.max(0.8, num(o.h, clamp(unit * 0.9, 3.0, 26.0)));
    const n = clamp(Math.round(num(o.steps, h / clamp(unit * 0.05, 0.30, 0.9))), 5, 26);
    const col = num(o.col, pal.roof), light = F.shade(col, 1.16);
    const trim = num(o.trim, pal.trim);
    let top = y;
    if (o.broach !== false) {
      // the square base the spire springs from, with corner pinnacles
      const bh = Math.max(0.3, h * 0.10);
      ctx.dbox(cx, y + bh / 2, cz, base * 1.16, bh, base * 1.16, num(o.baseCol, pal.light));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        ctx.dbox(cx + sx * base * 0.56, y + bh * 1.1, cz + sz * base * 0.56, base * 0.16, bh * 1.9, base * 0.16, num(o.baseCol, pal.light));
        ctx.dbox(cx + sx * base * 0.56, y + bh * 2.2, cz + sz * base * 0.56, base * 0.10, bh * 0.9, base * 0.10, trim);
      }
      top = y + bh;
    }
    const sh = h / n;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const fr = o.concave === false ? (1 - u) : (1 - Math.pow(u, num(o.power, 1.35)));
      const s = Math.max(0.08, base * fr);
      ctx.dbox(cx, top + sh * (i + 0.5), cz, s, sh + 0.03, s, i % 3 === 1 ? light : F.shade(col, 1 - i * 0.008));
      // the hip ribs, so the taper reads as a spire and not as a stack
      if (o.ribs !== false && s > 0.24) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          ctx.dbox(cx + sx * s / 2, top + sh * (i + 0.5), cz + sz * s / 2, s * 0.20, sh + 0.03, s * 0.20, light);
        }
      }
    }
    let ty = top + h;
    if (o.mast !== false) {
      const mr = Math.max(0.07, base * 0.05), mh = Math.max(0.5, h * 0.16);
      const got = F.mesh(ctx, o.ball === false ? 1 : 2);
      if (got >= 1) ctx.column(cx, ty, cz, mr, mh, trim, 8);
      else ctx.dbox(cx, ty + mh / 2, cz, mr * 1.8, mh, mr * 1.8, trim);
      ty += mh;
      if (o.ball !== false) {
        if (got >= 2) ctx.ball(cx, ty + mr * 1.6, cz, mr * 1.9, trim);
        else ctx.dbox(cx, ty + mr * 1.6, cz, mr * 3.2, mr * 3.2, mr * 3.2, trim);
        ty += mr * 3.4;
      }
    }
    return { top: ty };
  };
})();
