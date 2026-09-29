/* ============================================================
   city/buildings_civic.js — the MASONRY + CIVIC building grammar.

   OWNER: "make new building types like gov buildings and brick buildings."

   WHAT THIS FILE OWNS
     1. The BLD_* feature flags for the whole masonry/civic pass (each a
        one-line revert, per CLAUDE.md).
     2. CBZ.CIVIC_SHOPS — the new civic TRADES (courthouse, federal building,
        public library, post office, records/DMV office, fire station, city
        hall annex). Plain data; city/buildings.js's cityBuildings() places
        them on geometry-picked lots (no new rng() draws — see below).
     3. The shared MASONRY / CIVIC geometry vocabulary: string courses,
        quoins, water tables, corbelled cornices, roofline weathering, ghost
        signs, monumental podium + entry steps, engaged pilaster orders,
        entablature + pediment, seals and lettering, flagpoles, domes and
        clock towers, and rooftop mechanical clutter.

   WHY IT IS A SEPARATE FILE: city/buildings.js is already ~6.8k lines. Every
   helper here is PURE GEOMETRY driven by a small `ctx` the caller passes in
   (its own dbox/lbox/veneer/plat closures + the building's dimensions), so
   this file never touches the global scene graph, colliders or rng directly.

   DETERMINISM: every random-looking choice here is CBZ.hash01 position-hashed
   through ctx.hash(salt) — NEVER Math.random, NEVER a shared rng() stream
   draw. Two boots of one seed produce byte-identical masonry.

   DRAW CALLS: everything except the handful of civic PLAQUES/SEALS/DOMES is
   emitted through ctx.dbox (merged per building by flushDeco, then merged
   city-wide by core/batch.js) or ctx.veneer (InstancedMesh pools). Plaques
   carry a canvas `map` so core/batch.js spares them — that is deliberate and
   BOUNDED: only civic anchors get one, and there are ~4-6 of those per world.

   LOAD ORDER: before city/buildings.js (which reads CBZ.CIVIC_SHOPS and the
   BLD_* flags). Depends on world/textures_masonry.js for the palette.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ============================================================
  //  FEATURE FLAGS (self-defaulted; ?cfg_BLD_X=0 flips any of them pre-boot)
  // ============================================================
  if (CBZ.CONFIG) {
    // BLD_MASONRY_V1 — revive the punched-masonry facade grammar that has been
  // ======================================================================
  //  PURGED — but the switch is NOT here. src/config.js's BLD_EXTRAS is the
  //  ONE flag (owner: "it's one fucking flag"), and it force-sets every flag
  //  below to false before this file parses. These defaults therefore stay
  //  TRUE on purpose: they are what ?cfg_BLD_EXTRAS=1 restores. Setting them
  //  false here as well would make the master switch a one-way door.
  // ======================================================================
    // dead code since `const punched = false` landed (buildings.js), and add
    // the new "brick" / "civic" facade archetypes on top of it. ON → brick and
    // government buildings render as real masonry (piers, sills, lintels,
    // string courses, cornices) instead of aliasing to the glass office shell.
    // Flip false (or ?cfg_BLD_MASONRY_V1=0) and every facade falls back to the
    // exact prior office/retail curtain wall.
    if (CBZ.CONFIG.BLD_MASONRY_V1 == null) CBZ.CONFIG.BLD_MASONRY_V1 = true;
    // BLD_MASONRY_TEXTURE — the InstancedMesh brick/stone VENEER bands at
    // eye level and on the parapet. ON → real brick coursing where the player
    // stands. OFF → the geometry-only masonry read (zero textured materials in
    // the world). Independent of BLD_MASONRY_V1 so the texture cost can be
    // dropped without losing the facade grammar.
    if (CBZ.CONFIG.BLD_MASONRY_TEXTURE == null) CBZ.CONFIG.BLD_MASONRY_TEXTURE = true;
    // BLD_CIVIC_LOTS_V1 — place the new civic trades (courthouse, federal,
    // library, post office, records office, fire station, annex) on mainland
    // lots picked BY GEOMETRY (nearest-to-centre), never by an rng draw.
    // OFF → the mainland is exactly as before (City Hall only).
    if (CBZ.CONFIG.BLD_CIVIC_LOTS_V1 == null) CBZ.CONFIG.BLD_CIVIC_LOTS_V1 = true;
    // BLD_CIVIC_PODIUM — the monumental entry: raised terrace, broad steps,
    // engaged column order, entablature/pediment, seal, flagpoles, dome or
    // clock tower. OFF → civic buildings keep the masonry facade but meet the
    // street like any other shop.
    if (CBZ.CONFIG.BLD_CIVIC_PODIUM == null) CBZ.CONFIG.BLD_CIVIC_PODIUM = true;
    // BLD_WEATHERING_V1 — roofline soot streaking under cornices + painted
    // "ghost sign" ads on blank masonry flanks. Merged deco, zero draw calls.
    if (CBZ.CONFIG.BLD_WEATHERING_V1 == null) CBZ.CONFIG.BLD_WEATHERING_V1 = true;
  }
  function flag(n) { return !(CBZ.CONFIG && CBZ.CONFIG[n] === false); }
  CBZ.bldFlag = flag;

  // ============================================================
  //  THE CIVIC TRADES
  // ============================================================
  // Shape matches city/buildings.js's SHOPS[] entries exactly ({kind, name,
  // sign, storeys, ...}) so cityBuildings can hand one to the identical
  // makeBuilding → signAwning → furnishShop → stampOwner path. Extra fields:
  //   civic     — marks the trade for the civic facade + portico dressing
  //   crown     — "pediment" | "dome" | "clock" | "tower" | "flat"
  //   order     — engaged-column order: "doric" | "ionic" | "pilaster"
  //   motto     — the lettering carved over the entrance
  //   rank      — lower = wants a more central lot (ties broken by list order)
  //
  // NOTE ON SHOP COUNT (math-gate): these are placed on lots that would
  // otherwise have rolled home/park/derelict, so `A.shopLots` grows by exactly
  // the number of civic anchors placed (4 on the stock 6×6 mainland). Against
  // the calibrated GOLDEN of 178 shops that is +2.2% — well inside the gate's
  // 12% band. They are NOT added to SHOPS[] itself, so the shopQueue shuffle
  // draws the SAME number of rng() values as before.
  const CIVIC_SHOPS = [
    { kind: "courthouse",  name: "Freeland County Courthouse", sign: 0xd8d0ba, storeys: 3,
      civic: true, crown: "pediment", order: "doric",    motto: "EQUAL JUSTICE UNDER LAW", rank: 0, stone: true },
    { kind: "federal",     name: "Federal Building",           sign: 0xc4c9ce, storeys: 4,
      civic: true, crown: "tower",    order: "pilaster", motto: "FEDERAL BUILDING",        rank: 1, stone: true },
    { kind: "library",     name: "Freeland Public Library",    sign: 0xcfbf9c, storeys: 2,
      civic: true, crown: "dome",     order: "ionic",    motto: "PUBLIC LIBRARY",          rank: 2, stone: true },
    { kind: "cityannex",   name: "City Hall Annex",            sign: 0xcfd5de, storeys: 3,
      civic: true, crown: "clock",    order: "pilaster", motto: "CITY HALL ANNEX",         rank: 3, stone: true },
    { kind: "postoffice",  name: "Freeland Post Office",       sign: 0xbcc6d2, storeys: 2,
      civic: true, crown: "pediment", order: "pilaster", motto: "POST OFFICE",             rank: 4, stone: true },
    { kind: "dmv",         name: "Dept. of Records & Licensing", sign: 0xa9b1a3, storeys: 2,
      civic: true, crown: "flat",     order: "pilaster", motto: "RECORDS & LICENSING",     rank: 5, stone: false },
    { kind: "firestation", name: "Engine Co. 7 Fire Station",  sign: 0xb8412f, storeys: 2,
      civic: true, crown: "tower",    order: "pilaster", motto: "ENGINE CO. 7", rank: 6, stone: false, showroom: true },
  ];
  CBZ.CIVIC_SHOPS = CIVIC_SHOPS;

  // District affinity for the civic trades, in the same shape as
  // buildings.js's AFFINITY table. cityBuildings picks civic LOTS by geometry
  // (nearest the centre) and then uses this table to decide WHICH civic trade
  // lands on WHICH of those lots — a pure argmax, no rng draw. Civic clusters
  // downtown by construction: the whole candidate pool is the central ring.
  CBZ.CIVIC_AFFINITY = {
    core:        { courthouse: 5, federal: 5, cityannex: 4, library: 3, postoffice: 3, dmv: 2, firestation: 1 },
    commercial:  { postoffice: 4, dmv: 4, library: 3, cityannex: 3, courthouse: 2, federal: 2, firestation: 2 },
    residential: { library: 4, firestation: 4, postoffice: 3, dmv: 2, cityannex: 1, courthouse: 0.6, federal: 0.4 },
    projects:    { firestation: 4, dmv: 3, postoffice: 2, library: 2, courthouse: 0.5, federal: 0.4, cityannex: 0.5 },
    industrial:  { firestation: 4, dmv: 2, postoffice: 2, library: 0.6, courthouse: 0.4, federal: 0.4, cityannex: 0.5 },
  };
  // opening float for the wallet ledger (mirrors buildings.js's ACCT_SEED)
  CBZ.CIVIC_ACCT_SEED = { courthouse: 4600, federal: 6400, library: 1800, cityannex: 3800,
    postoffice: 2400, dmv: 2000, firestation: 2600 };
  // register-screen / signage accent per civic trade (mirrors kindAccent)
  CBZ.CIVIC_ACCENT = { courthouse: 0xd8c98a, federal: 0x8fb6e8, library: 0xe0b96b,
    cityannex: 0xd8dde8, postoffice: 0x6fa2e0, dmv: 0x9fc08a, firestation: 0xff7043 };
  CBZ.CIVIC_KINDS = new Set(CIVIC_SHOPS.map((s) => s.kind));
  const BY_KIND = new Map();
  for (const s of CIVIC_SHOPS) BY_KIND.set(s.kind, s);
  CBZ.civicShop = function (kind) { return BY_KIND.get(kind) || null; };

  // EXISTING trades that have always been civic in everything but their facade.
  // City Hall is the flagship: the domed, colonnaded anchor the whole civic
  // quarter reads off. The bank keeps its temple-front pediment (which is what
  // every real 1920s trust company built). These EXTEND buildings.js's SHOPS[]
  // entries — no new trade, no new placement, no new rng draw.
  // NOTE the bank is deliberately NOT here. It gets the civic ASHLAR FACADE
  // (see CIVIC_FACADE_KINDS) but no portico: bank.js's heist flow and the
  // storefront sign kit both live on that door face, and a colonnade across it
  // would fight them for the same 3 metres. Facade upgrade, no monumental entry.
  const EXTRA_SPECS = {
    cityhall: { kind: "cityhall", civic: true, crown: "dome", order: "ionic", motto: "CITY HALL", stone: true },
  };
  CBZ.civicSpecFor = function (kind) { return BY_KIND.get(kind) || EXTRA_SPECS[kind] || null; };
  // trades that render with the CIVIC (ashlar / monumental) facade even though
  // they are not government offices — a bank and a security firm should never
  // read as the same glass box as a phone shop.
  CBZ.CIVIC_FACADE_KINDS = new Set(["cityhall", "bank", "security"].concat(CIVIC_SHOPS.map((s) => s.kind)));

  // ============================================================
  //  SMALL SHARED HELPERS
  // ============================================================
  function shade(hex, f) {
    const r = Math.max(0, Math.min(255, (((hex >> 16) & 255) * f) | 0));
    const g = Math.max(0, Math.min(255, (((hex >> 8) & 255) * f) | 0));
    const b = Math.max(0, Math.min(255, ((hex & 255) * f) | 0));
    return (r << 16) | (g << 8) | b;
  }
  // face geometry for a door side: 0=-z, 1=+z, 2=-x, 3=+x.
  //   horiz  — the face runs along x (its normal is ±z)
  //   out    — outward sign on the normal axis
  //   span   — the face's own width
  function faceOf(ctx, s) {
    const horiz = (s === 0 || s === 1);
    const out = (s === 0 || s === 2) ? -1 : 1;
    return { s, horiz, out, span: horiz ? ctx.w : ctx.d, depth: horiz ? ctx.d : ctx.w };
  }
  // place a box on face `f` at tangent offset t, height cy: `len` along the
  // face, `h` tall, `proj` proud of the outer plane (measured from the wall
  // face, so proj/2 is the box centre offset).
  function faceBox(ctx, f, t, cy, len, h, proj, col, inset) {
    const halfN = (f.horiz ? ctx.d : ctx.w) / 2;
    const n = halfN + (inset || 0) + proj / 2;
    if (f.horiz) ctx.dbox(t, cy, f.out * n, len, h, proj, col);
    else ctx.dbox(f.out * n, cy, t, proj, h, len, col);
  }

  /* THE CIVIC BAY RHYTHM of one face: heavy corner piers, then nBay tall
     openings at a ~4.0 m pitch, symmetric about the face centre. This is the
     rhythm buildings.js's civic facade branch glazes (its `endPier` / `nBay`
     / `cellC` / `winW`), stated once here so the column order can stand ON
     the piers between the windows instead of on its own unrelated 5.4 m
     pitch (which parked colossal shafts across half the window openings).
     `piers[i]` is the centre of the pier between bay i-1 and bay i. */
  function civicBays(span) {
    const endPier = Math.max(1.0, span * 0.075);
    const usable = span - 2 * endPier;
    const nBay = Math.max(1, Math.round(usable / 4.0));
    const cell = usable / nBay;
    const piers = [];
    for (let i = 0; i <= nBay; i++) piers.push(-usable / 2 + i * cell);
    return { endPier, usable, nBay, cell, winW: Math.min(2.6, cell * 0.56), piers };
  }
  CBZ.civicBays = civicBays;

  // ============================================================
  //  1. MASONRY DRESSING — what turns a coloured box into BRICKWORK
  // ============================================================
  // Every element below is a real thing a mason builds, sized off published
  // brickwork practice: a WATER TABLE (projecting stone course capping the
  // damp-proof base), STRING COURSES at each floor line, QUOINS (alternating
  // long/short corner stones), a CORBELLED CORNICE (three stepped courses
  // under the parapet), and COPING on the parapet head. All merged deco.
  CBZ.bldMasonryDress = function (ctx) {
    if (!flag("BLD_MASONRY_V1")) return;
    const { w, d, FH, storeys, rTop, pp } = ctx;
    const pal = ctx.pal;
    const STONE = pal.stone, DARK = shade(pal.wall, 0.72), LIGHT = shade(pal.wall, 1.10);
    const sides = [0, 1, 2, 3];

    // ---- WATER TABLE: a projecting stone course at ~0.9m, the line where a
    // masonry base traditionally steps in to the wall above. Skips the door
    // face's centre so it never crosses the threshold.
    for (const s of sides) {
      const f = faceOf(ctx, s);
      if (s === ctx.doorSide) {
        const gap = 2.2, side = (f.span - gap) / 2;
        if (side > 0.4) for (const sg of [-1, 1])
          faceBox(ctx, f, sg * (gap / 2 + side / 2), 0.92, side, 0.16, 0.13, STONE);
      } else {
        faceBox(ctx, f, 0, 0.92, f.span + 0.16, 0.16, 0.13, STONE);
      }
      // GRADE PLINTH: one heavy projecting course where the wall meets the
      // pavement. Kept BELOW y=0.12 so it never covers the textured veneer band
      // (0.12..0.86) — the veneer is the base's material, this is its edge.
      faceBox(ctx, f, 0, 0.06, f.span + 0.14, 0.12, 0.16, shade(pal.wall, 0.72));
    }

    // ---- STRING COURSES at every floor line (masonry storeys must read from
    // the street). Alternating profile: a deep band on even floors, a slim
    // bead on odd ones, so a tall brick block isn't a stack of identical lines.
    for (let L = 1; L < storeys; L++) {
      const cy = L * FH;
      const deep = (L % 2) === 0;
      for (const s of sides) {
        const f = faceOf(ctx, s);
        faceBox(ctx, f, 0, cy, f.span + 0.20, deep ? 0.20 : 0.12, deep ? 0.14 : 0.09, STONE);
        if (deep) faceBox(ctx, f, 0, cy - 0.16, f.span + 0.12, 0.08, 0.08, DARK);   // shadow bead
      }
    }

    // ---- QUOINS: alternating long/short corner stones up the full height.
    // Real quoining alternates a stretcher face on one wall with a header on
    // the other — we emit the pair per course so the corner reads interlocked.
    const qh = 0.44;
    // capped: every quoin is a merged BoxGeometry created then disposed at
    // flushDeco, so an unbounded count on a tall block is pure build-time cost
    // for stones nobody can resolve past the first few storeys.
    const nQ = Math.max(2, Math.min(30, Math.floor((rTop - 0.9) / qh)));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      for (let i = 0; i < nQ; i++) {
        const cy = 0.9 + (i + 0.5) * qh;
        const lng = (i % 2) === 0;
        const a = lng ? 0.78 : 0.46, b = lng ? 0.46 : 0.78;
        const col = (i % 2) === 0 ? STONE : shade(STONE, 0.93);
        ctx.dbox(sx * (w / 2 - a / 2 + 0.05), cy, sz * (d / 2 + 0.05), a, qh - 0.04, 0.11, col);
        ctx.dbox(sx * (w / 2 + 0.05), cy, sz * (d / 2 - b / 2 + 0.05), 0.11, qh - 0.04, b, col);
      }
    }

    // ---- CORBELLED CORNICE: three stepped courses under the parapet, each
    // projecting further than the last — the classic brick corbel table. Plus
    // DENTILS (small blocks on a regular pitch) on the top course.
    const cy0 = rTop - 0.62;
    for (const s of sides) {
      const f = faceOf(ctx, s);
      faceBox(ctx, f, 0, cy0 + 0.00, f.span + 0.14, 0.18, 0.12, shade(pal.wall, 0.90));
      faceBox(ctx, f, 0, cy0 + 0.20, f.span + 0.26, 0.16, 0.20, STONE);
      faceBox(ctx, f, 0, cy0 + 0.44, f.span + 0.40, 0.20, 0.30, shade(STONE, 1.04));
      // dentil row tucked under the top course
      const dn = Math.max(4, Math.min(28, Math.round(f.span / 0.62)));
      const step = (f.span - 0.4) / dn;
      for (let i = 0; i < dn; i++) {
        const t = -(f.span - 0.4) / 2 + (i + 0.5) * step;
        faceBox(ctx, f, t, cy0 + 0.22, step * 0.52, 0.14, 0.26, shade(STONE, 0.88));
      }
      // ---- COPING on the parapet head (a wide flat stone cap with a drip lip)
      faceBox(ctx, f, 0, rTop + pp + 0.06, f.span + 0.30, 0.12, 0.26, shade(STONE, 1.06));
    }

    // ---- PARAPET PIERS: short brick piers punctuating the parapet, the tell
    // that a masonry roofline is built, not extruded. Deterministic count.
    // A host that runs a BALUSTRADE along this parapet (govcomplex.js's
    // estate houses: `civic.balustrade`) sets its own dados on its own
    // rhythm, so these stand down rather than stand inside its balusters.
    const pierN = 4 + ((ctx.hash(0x71a5) * 3) | 0);
    for (const s of ((ctx.civic && ctx.civic.balustrade) ? [] : sides)) {
      const f = faceOf(ctx, s);
      const step = f.span / pierN;
      for (let i = 0; i <= pierN; i++) {
        const t = -f.span / 2 + i * step;
        faceBox(ctx, f, t, rTop + pp * 0.5 + 0.10, 0.42, pp + 0.20, 0.16, shade(pal.wall, 1.04));
        faceBox(ctx, f, t, rTop + pp + 0.20, 0.54, 0.14, 0.22, shade(STONE, 1.06));
      }
    }

    // ---- WEATHERING: soot streaks running DOWN from the cornice, and rain
    // staining below every string course. Thin, dark, merged, cast:false.
    if (flag("BLD_WEATHERING_V1")) {
      for (const s of sides) {
        const f = faceOf(ctx, s);
        const n = Math.max(3, Math.min(14, Math.round(f.span / 2.2)));
        for (let i = 0; i < n; i++) {
          const hh = ctx.hash(0x5100 + s * 37 + i * 11);
          if (hh < 0.34) continue;                       // not every bay streaks
          const t = -f.span / 2 + (i + 0.5) * (f.span / n) + (hh - 0.5) * 0.5;
          const len = 0.8 + hh * (FH * 1.6);
          faceBox(ctx, f, t, rTop - 0.75 - len / 2, 0.16 + hh * 0.22, len, 0.045, pal.dirt);
        }
      }
    }

    // ---- LIGHTENED PARAPET INNER FACE so the roofline doesn't read as one flat
    // tone from the roof side. The parapet wall spans halfN-WT .. halfN, so this
    // slim liner rides just inside its INNER face (a positive-depth box at a
    // negative inset — faceBox's `proj` must always stay positive or the
    // BoxGeometry inverts).
    for (const s of sides) {
      const f = faceOf(ctx, s);
      faceBox(ctx, f, 0, rTop + pp * 0.5, f.span - 0.9, pp * 0.7, 0.06, LIGHT, -(ctx.WT + 0.06));
    }
  };

  // ============================================================
  //  2. GHOST SIGN — a faded painted wall advertisement
  // ============================================================
  // Brick flanks in every real city carry a half-erased painted ad. Built from
  // merged deco only (a bleached field + bold "letter" bars + a rule line) so
  // it costs ZERO draw calls, unlike a canvas decal. Placed on a blank
  // non-door face of a brick building, upper-middle, deterministic.
  CBZ.bldGhostSign = function (ctx) {
    if (!flag("BLD_WEATHERING_V1") || !flag("BLD_MASONRY_V1")) return;
    if (ctx.storeys < 3) return;
    if (ctx.hash(0x9e05) > 0.42) return;                 // ~42% of tall brick blocks
    // pick a face that is neither the door face nor its opposite (so the sign
    // lands on a flank the street actually sees down the block).
    const cands = [0, 1, 2, 3].filter((s) => s !== ctx.doorSide);
    const s = cands[(ctx.hash(0x9e06) * cands.length) | 0];
    const f = faceOf(ctx, s);
    const pal = ctx.pal;
    const paint = shade(pal.wall, 1.34);                 // bleached lime paint
    const ink = shade(pal.wall, 0.62);
    const bw = Math.min(f.span - 2.4, 9.0);
    if (bw < 3.2) return;
    const bh = Math.min(ctx.FH * 1.7, 5.0);
    const cy = ctx.rTop - 1.9 - bh / 2;
    if (cy - bh / 2 < ctx.FH) return;
    faceBox(ctx, f, 0, cy, bw, bh, 0.03, paint);         // the bleached field
    // three rows of "lettering": bars of varying length + gaps, hashed.
    for (let r = 0; r < 3; r++) {
      const ry = cy + bh / 2 - 0.7 - r * (bh / 3.4);
      const lh = (r === 0 ? 0.62 : 0.42);
      let x = -bw / 2 + 0.6;
      for (let i = 0; i < 7 && x < bw / 2 - 0.6; i++) {
        const hh = ctx.hash(0x9e10 + r * 29 + i * 7);
        const lw = 0.35 + hh * 0.75;
        if (hh > 0.22) faceBox(ctx, f, x + lw / 2, ry, lw, lh, 0.045, ink);
        x += lw + 0.22;
      }
    }
    faceBox(ctx, f, 0, cy - bh / 2 + 0.35, bw - 1.4, 0.10, 0.045, ink);   // rule line
  };

  // ============================================================
  //  3. THE CIVIC ORDER — podium, steps, columns, entablature, pediment
  // ============================================================
  // Sized off classical practice scaled to this game's 3.2m floor: a column
  // roughly 1 storey + entablature per two storeys, six to eight columns
  // across a monumental front, a pediment whose rise is ~1/5 its span.
  CBZ.bldCivicOrder = function (ctx) {
    const spec = ctx.civic || {};
    // `monumental` is a landmark opt-in, not a back door for citywide brick.
    // The Executive Mansion keeps its declared order while BLD_MASONRY_V1
    // remains off for every ordinary lot.
    if ((!flag("BLD_MASONRY_V1") && spec.monumental !== true) || !flag("BLD_CIVIC_PODIUM")) return;
    const { w, d, FH, storeys, doorSide } = ctx;
    const pal = ctx.pal;
    const STONE = pal.stone, SHAFT = shade(pal.stone, 0.98), CAP = shade(pal.stone, 1.08);
    const f = faceOf(ctx, doorSide);

    // A drive-in APPARATUS BAY (the fire house) cannot have a flight of steps
    // and a colonnade across its opening — the engine has to get out. Those
    // buildings keep the pilaster order, entablature and tower but skip the
    // podium entirely, and the column rhythm opens a bay-width gap.
    const driveIn = !!(spec.showroom || ctx.showroom);
    // govcomplex.js already owns a broad, walkable perron derived from the
    // Mansion threshold. Keep that one and add only the architectural order;
    // stacking the generic 2.5 m civic stair over it would make two entrances.
    const externalPerron = spec.externalPerron === true;
    const doorGap = driveIn ? 6.0 : 2.6;
    // clear height above the doorway/apparatus opening — anything hung on the
    // wall over the entrance must start above this or it covers the door head.
    const DOOR_HEAD = driveIn ? (ctx.FH + 0.9) : 3.6;

    // ---------- PODIUM + MONUMENTAL STEPS ----------
    // Deliberately LOW (0.30m top). The interior floor slab tops out at 0.14
    // and physics' STEP_UP is 0.45, so a rider walks up the flight, across the
    // terrace and straight in without a ledge. Registered as PLATFORMS only
    // (no colliders) — the same contract the interior stairs already use, so
    // nothing can be sealed out of its own front door.
    const TERR_TOP = 0.30;
    // Kept SHALLOW on purpose: lots inset the building by 1m, so a deep flight
    // would spill across the sidewalk into the carriageway. 2.5m total reads
    // monumental under the column order without leaving the parcel apron.
    const terrD = 1.6, stepD = 0.9, nSteps = 3;
    const terrW = Math.max(3.0, f.span - 0.6);
    const halfN = (f.horiz ? d : w) / 2;
    // terrace slab
    if (driveIn || externalPerron) { /* the host owns the arrival platform */ }
    else if (f.horiz) {
      ctx.dbox(0, TERR_TOP / 2, f.out * (halfN + terrD / 2), terrW, TERR_TOP, terrD, shade(STONE, 0.96));
      ctx.plat(-terrW / 2, terrW / 2, f.out > 0 ? halfN : -(halfN + terrD), f.out > 0 ? halfN + terrD : -halfN, TERR_TOP, null);
    } else {
      ctx.dbox(f.out * (halfN + terrD / 2), TERR_TOP / 2, 0, terrD, TERR_TOP, terrW, shade(STONE, 0.96));
      ctx.plat(f.out > 0 ? halfN : -(halfN + terrD), f.out > 0 ? halfN + terrD : -halfN, -terrW / 2, terrW / 2, TERR_TOP, null);
    }
    // the flight: three shallow treads, plus ONE continuous ramp platform so a
    // fast runner can never sample a seam between tread AABBs (the exact bug
    // the interior switchback rig documents).
    const sw = terrW - 1.2;
    for (let i = 0; !driveIn && !externalPerron && i < nSteps; i++) {
      const th = TERR_TOP * (nSteps - i) / nSteps;
      const dOff = terrD + (i + 0.5) * (stepD / nSteps);
      const td = stepD / nSteps + 0.02;
      if (f.horiz) ctx.dbox(0, th / 2, f.out * (halfN + dOff), sw, th, td, shade(STONE, 0.92 + i * 0.03));
      else ctx.dbox(f.out * (halfN + dOff), th / 2, 0, td, th, sw, shade(STONE, 0.92 + i * 0.03));
    }
    if (!driveIn && !externalPerron) {
      const o0 = halfN + terrD, o1 = halfN + terrD + stepD;     // inner→outer
      if (f.horiz) {
        const z0 = f.out * o0, z1 = f.out * o1;
        ctx.plat(-sw / 2, sw / 2, Math.min(z0, z1), Math.max(z0, z1), TERR_TOP,
          { z0: ctx.oz + z1, z1: ctx.oz + z0, y0: 0, y1: TERR_TOP });
      } else {
        const x0 = f.out * o0, x1 = f.out * o1;
        ctx.plat(Math.min(x0, x1), Math.max(x0, x1), -sw / 2, sw / 2, TERR_TOP,
          { axis: "x", x0: ctx.ox + x1, x1: ctx.ox + x0, y0: 0, y1: TERR_TOP });
      }
    }
    // cheek walls flanking the flight, each capped with a stone ball finial
    for (const sg of ((driveIn || externalPerron) ? [] : [-1, 1])) {
      const t = sg * (sw / 2 + 0.35);
      const cD = terrD + stepD;
      if (f.horiz) {
        ctx.dbox(t, 0.34, f.out * (halfN + cD / 2), 0.55, 0.68, cD, shade(STONE, 0.90));
        ctx.dbox(t, 0.74, f.out * (halfN + cD - 0.4), 0.62, 0.14, 0.66, CAP);
      } else {
        ctx.dbox(f.out * (halfN + cD / 2), 0.34, t, cD, 0.68, 0.55, shade(STONE, 0.90));
        ctx.dbox(f.out * (halfN + cD - 0.4), 0.74, t, 0.66, 0.14, 0.62, CAP);
      }
      // 0.81 m of stone is over the 0.45 STEP_UP: a cheek wall you step
      // AROUND, not through (its finial rides on top, deco)
      if (ctx.solid) {
        if (f.horiz) ctx.solid(t, 0.405, f.out * (halfN + cD / 2), 0.55, 0.81, cD);
        else ctx.solid(f.out * (halfN + cD / 2), 0.405, t, cD, 0.81, 0.55);
      }
      ctx.ball(f.horiz ? t : f.out * (halfN + cD - 0.4), 0.98,
        f.horiz ? f.out * (halfN + cD - 0.4) : t, 0.24, CAP);
    }

    // ---------- ENGAGED COLUMN / PILASTER ORDER ----------
    // Runs the full height of the "principal" storeys (all but the attic), so
    // the front reads as one monumental order rather than stacked floors.
    const colBase = driveIn ? 0 : TERR_TOP;   // host perron shares TERR_TOP
    // Sized so the ENTABLATURE lands clear BELOW the corbelled cornice
    // bldMasonryDress puts at rTop-0.62 — otherwise a tall order would drive
    // its cornice straight through the roofline trim. Solve backwards from
    // that clearance instead of from the storey count.
    const orderH = Math.max(FH * 1.1, ctx.rTop - colBase - 1.9);
    const round = spec.order === "doric" || spec.order === "ionic";
    /* THE COLUMNS STAND ON THE PIERS. The order used to run its own pitch
       ((span-1.6)/10 = 5.44 m on the Mansion) against the facade's 3.97 m
       window bays, so half the shafts stood in front of glass. Now every
       column takes the pier between two openings (civicBays, the rhythm the
       shell glazes), every other pier when a long front would carry more
       than a dozen shafts, symmetric about the door, never in the doorway. */
    const BAYS = civicBays(f.span);
    const stride = Math.max(1, Math.ceil((BAYS.nBay + 1) / 13));
    const colStep = BAYS.cell * stride;
    // THE SHAFT KEEPS ITS PROPORTION. 0.42 m is right for a one- or two-
    // storey order; a colossal order two tall storeys high on that radius is
    // a broom handle (1:13). Past ~8 m the radius follows the height at a
    // doric-to-corinthian 1:8.5, still capped by the intercolumniation.
    const R = Math.min(colStep * 0.20, Math.max(0.42, (orderH - 1.0) / 17));
    const colTs = [];
    for (let i = 0; i <= BAYS.nBay; i++) {
      if (Math.abs(i - BAYS.nBay / 2) % stride > 1e-6 && stride > 1) continue;
      const t = BAYS.piers[i];
      if (Math.abs(t) < doorGap / 2 + R) continue;             // keep the doorway clear
      colTs.push(t);
      const cx = f.horiz ? t : f.out * (halfN + R + 0.06);
      const cz = f.horiz ? f.out * (halfN + R + 0.06) : t;
      // plinth block
      ctx.dbox(cx, colBase + 0.20, cz, R * 2.5, 0.40, R * 2.5, shade(STONE, 0.90));
      if (round) {
        ctx.column(cx, colBase + 0.40, cz, R, orderH - 1.0, SHAFT, spec.order === "ionic" ? 20 : 16);
      } else {
        // pilaster: a flat engaged pier with two shadow reveals
        ctx.dbox(cx, colBase + 0.40 + (orderH - 1.0) / 2, cz, R * 2.2, orderH - 1.0, R * 1.5, SHAFT);
        ctx.dbox(cx, colBase + 0.40 + (orderH - 1.0) / 2, cz, R * 1.5, orderH - 1.0, R * 1.9, shade(SHAFT, 1.05));
      }
      // capital (abacus + echinus) and, for ionic, two volute blocks
      const capY = colBase + 0.40 + (orderH - 1.0);
      // THE ORDER IS SOLID. An 8 m column standing proud of the wall on the
      // front walk was walk-through (merged deco has no body). The body is
      // the plinth's footprint (R*2.5 square, the widest drawn part below the
      // capital) from the ground to the capital's top.
      if (ctx.solid) ctx.solid(cx, (capY + 0.34) / 2, cz, R * 2.5, capY + 0.34, R * 2.5, { noCam: true });
      ctx.dbox(cx, capY + 0.10, cz, R * 2.4, 0.20, R * 2.4, CAP);
      ctx.dbox(cx, capY + 0.26, cz, R * 2.9, 0.16, R * 2.9, shade(CAP, 1.04));
      if (spec.order === "ionic") for (const sg of [-1, 1]) {
        const vx = f.horiz ? cx + sg * R * 1.25 : cx;
        const vz = f.horiz ? cz : cz + sg * R * 1.25;
        ctx.dbox(vx, capY + 0.18, vz, R * 0.7, 0.30, R * 0.7, shade(CAP, 0.94));
      }
    }

    // ---------- ENTABLATURE (architrave / frieze / cornice) ----------
    const entY = colBase + 0.40 + (orderH - 1.0) + 0.34;
    // Publish the front as built (building-local: `t` runs along the door
    // face, `n` is the distance out from the shell centre), so a host that
    // hangs cloth or a balcony on it reads these numbers, never a copy.
    if (typeof ctx.publishOrder === "function") {
      ctx.publishOrder({
        face: doorSide, horiz: !!f.horiz, out: f.out, halfN: halfN, span: f.span,
        cols: colTs, R: R, colN: halfN + R + 0.06, colStep: colStep,
        deck: colBase, orderH: orderH, entY: entY, archUnder: entY + 0.05,
        corniceTop: entY + 1.06, doorGap: doorGap, doorHead: DOOR_HEAD,
      });
    }
    faceBox(ctx, f, 0, entY + 0.18, f.span + 0.5, 0.26, 0.34, shade(STONE, 1.00));   // architrave
    faceBox(ctx, f, 0, entY + 0.56, f.span + 0.5, 0.46, 0.30, shade(STONE, 0.94));   // frieze
    faceBox(ctx, f, 0, entY + 0.94, f.span + 0.9, 0.24, 0.52, shade(STONE, 1.08));   // cornice
    // triglyph blocks on a doric frieze (the giveaway detail of the order)
    if (spec.order === "doric") {
      const tn = Math.max(8, Math.round(f.span / 2.7));
      const tstep = (f.span - 1.0) / tn;
      for (let i = 0; i <= tn; i++)
        faceBox(ctx, f, -(f.span - 1.0) / 2 + i * tstep, entY + 0.56, 0.24, 0.46, 0.36, shade(STONE, 1.10));
    }

    // ---------- PEDIMENT ----------
    // A stepped triangle (five courses) is the honest way to build a gable out
    // of axis-aligned merged boxes — it silhouettes as a pediment at any
    // gameplay distance and costs nothing extra.
    const pedimented = (spec.crown === "pediment" || spec.crown === "dome");
    // A CENTRAL PAVILION pediment, not a full-width gable: at ~46% of the face
    // it breaks the parapet by a metre or two (the correct monumental read)
    // instead of towering a storey and a half over its own roofline.
    const pw = Math.min(f.span * 0.46, 12.0);
    const pRise = pw * 0.19;
    if (pedimented && pw > 3.0) {
      const pStep = 5;
      for (let i = 0; i < pStep; i++) {
        const frac = i / pStep;
        const lw = pw * (1 - frac * 0.92);
        faceBox(ctx, f, 0, entY + 1.18 + (i + 0.5) * (pRise / pStep), lw, pRise / pStep + 0.02, 0.44,
          shade(STONE, 1.02 - i * 0.02));
      }
      // raking cornice lip + a tympanum field a shade darker
      faceBox(ctx, f, 0, entY + 1.10, pw + 0.4, 0.16, 0.56, shade(STONE, 1.10));
      faceBox(ctx, f, 0, entY + 1.18 + pRise * 0.32, pw * 0.62, pRise * 0.5, 0.30, shade(STONE, 0.86));
      // acroterion finial at the apex
      ctx.ball(f.horiz ? 0 : f.out * (halfN + 0.5), entY + 1.30 + pRise, f.horiz ? f.out * (halfN + 0.5) : 0, 0.26, CAP);
    }

    // ---------- LETTERING + SEAL over the entrance ----------
    // The ONLY textured (canvas `map`) elements a civic building emits —
    // core/batch.js spares anything with a map, which is exactly why these are
    // two plates on a handful of buildings city-wide and not a facade system.
    // The motto is carved on the FRIEZE; the seal goes in the tympanum when
    // there is a pediment to hold it, and otherwise sits on the wall over the
    // door (never on top of the lettering).
    if (spec.motto) ctx.plaque(f, entY + 0.56, Math.min(f.span - 2.0, 8.4), 0.62, spec.motto, STONE);
    // a host that builds its own portico carries the seal in ITS tympanum
    // (`seal:false`); a wall seal with no pediment over it would otherwise
    // hang across the upper windows of the door bay
    if (spec.seal !== false) {
      const sealR = pedimented && pw > 3.0 ? Math.min(1.25, pRise * 0.44) : Math.min(1.35, f.span * 0.09);
      const sealY = pedimented && pw > 3.0 ? (entY + 1.18 + pRise * 0.40) : Math.max(DOOR_HEAD, entY - 1.5);
      ctx.seal(f, sealY, sealR, spec.kind || "civic");
    }

    // ---------- FLAGPOLES ----------
    for (const sg of [-1, 1]) {
      const t = sg * (Math.min(f.span / 2 - 0.9, terrW / 2 - 0.9));
      // IN FRONT of the corner column, never inside it: the pole used to
      // stand at the column's own station, through its shaft
      const poleN = halfN + Math.max(terrD * 0.55, 2 * R + 0.5);
      const px = f.horiz ? t : f.out * poleN;
      const pz = f.horiz ? f.out * poleN : t;
      ctx.column(px, colBase, pz, 0.075, 7.2, 0xb9bec6, 8);
      ctx.dbox(px, colBase + 0.16, pz, 0.42, 0.32, 0.42, shade(STONE, 0.88));    // pole base
      ctx.ball(px, colBase + 7.34, pz, 0.11, 0xd8c98a);                          // gold truck
      // the flag itself: a thin banner hanging off the pole, tangent to the face
      const fw = 1.5, fh = 0.9, fy = colBase + 6.1;
      const fx2 = f.horiz ? px + (sg > 0 ? -fw / 2 - 0.09 : fw / 2 + 0.09) : px;
      const fz2 = f.horiz ? pz : pz + (sg > 0 ? -fw / 2 - 0.09 : fw / 2 + 0.09);
      if (f.horiz) {
        ctx.dbox(fx2, fy, fz2, fw, fh, 0.05, 0x1f4fa8);
        ctx.dbox(fx2 - fw * 0.28, fy + fh * 0.22, fz2 + 0.03, fw * 0.42, fh * 0.5, 0.04, 0xe8e8ee);
      } else {
        ctx.dbox(fx2, fy, fz2, 0.05, fh, fw, 0x1f4fa8);
        ctx.dbox(fx2 + 0.03, fy + fh * 0.22, fz2 - fw * 0.28, 0.04, fh * 0.5, fw * 0.42, 0xe8e8ee);
      }
    }

    // ---------- ENTRY LAMPS flanking the door (warm, emissive, merged-exempt
    // only by their emissive material — 2 small meshes per civic building).
    // An external perron's host dresses its own doorcase and lights it.
    for (const sg of (externalPerron ? [] : [-1, 1])) {
      const t = sg * (doorGap / 2 + 0.55);
      const lx = f.horiz ? t : f.out * (halfN + 0.30);
      const lz = f.horiz ? f.out * (halfN + 0.30) : t;
      ctx.dbox(lx, 2.55, lz, 0.16, 0.9, 0.16, shade(STONE, 0.7));
      ctx.lamp(lx, 3.15, lz, 0.30, 0xffd9a0);
    }
  };

  // ============================================================
  //  4. CIVIC CROWN — dome / clock tower / lantern
  // ============================================================
  CBZ.bldCivicCrown = function (ctx) {
    const spec = ctx.civic || {};
    if ((!flag("BLD_MASONRY_V1") && spec.monumental !== true) || !flag("BLD_CIVIC_PODIUM")) return;
    const pal = ctx.pal;
    const STONE = pal.stone, CAP = shade(pal.stone, 1.08);
    const cx = ctx.slabCx, cz = ctx.slabCz, top = ctx.rTop + ctx.pp;
    const base = Math.min(ctx.slabW, ctx.slabD);
    // "none": the host roofs the building itself (govcomplex.js's estate
    // houses lay a hipped slate roof and chimneys over the plate)
    if (base < 4 || spec.crown === "none") return;

    if (spec.crown === "dome") {
      // DRUM (a ring of engaged colonnettes) → DOME → LANTERN → finial.
      const R = Math.min(base * 0.30, 4.4);
      ctx.dbox(cx, top + 0.30, cz, R * 2.5, 0.60, R * 2.5, shade(STONE, 0.94));     // podium block
      ctx.column(cx, top + 0.60, cz, R, 2.4, STONE, 24);                             // drum
      const nCol = 12;
      for (let i = 0; i < nCol; i++) {
        const a = (i / nCol) * Math.PI * 2;
        ctx.column(cx + Math.cos(a) * (R + 0.14), top + 0.80, cz + Math.sin(a) * (R + 0.14), 0.14, 2.0, CAP, 8);
      }
      ctx.dbox(cx, top + 3.15, cz, R * 2.3, 0.30, R * 2.3, CAP);                     // drum cornice
      // dome → lantern → lantern cap → mast → finial, each seated on the last.
      const domeY = top + 3.30;                       // dome springing line
      const domeTop = domeY + R * 1.02;               // its apex
      ctx.dome(cx, domeY, cz, R * 1.02, 0x6f9a86);                                   // verdigris copper dome
      const lanH = 1.5, lanTop = domeTop + lanH;
      ctx.column(cx, domeTop, cz, 0.52, lanH, CAP, 12);                              // lantern drum
      ctx.dome(cx, lanTop, cz, 0.56, 0x6f9a86);                                      // lantern cap
      const mastY = lanTop + 0.56, mastH = 1.6;
      ctx.column(cx, mastY, cz, 0.07, mastH, 0xd8c98a, 6);                           // mast
      ctx.ball(cx, mastY + mastH + 0.14, cz, 0.16, 0xd8c98a);                        // gilded finial
      return;
    }

    if (spec.crown === "clock" || spec.crown === "tower") {
      // A square TOWER rising off the roof, with a belfry (clock faces on the
      // clock variant, louvred openings on the plain tower) and a stepped
      // spire. Deco only: no collider, no platform, nothing to fall through.
      const tw = Math.min(base * 0.42, 5.2);
      const th = ctx.FH * (2.4 + ctx.hash(0x3c10) * 1.4);
      ctx.dbox(cx, top + 0.35, cz, tw + 1.0, 0.70, tw + 1.0, shade(STONE, 0.92));    // tower base
      ctx.dbox(cx, top + 0.70 + th / 2, cz, tw, th, tw, shade(pal.wall, 1.02));      // shaft
      // corner pilasters up the shaft
      for (const sx of [-1, 1]) for (const sz of [-1, 1])
        ctx.dbox(cx + sx * (tw / 2 - 0.12), top + 0.70 + th / 2, cz + sz * (tw / 2 - 0.12), 0.30, th, 0.30, STONE);
      // string course halfway
      ctx.dbox(cx, top + 0.70 + th * 0.5, cz, tw + 0.28, 0.16, tw + 0.28, STONE);
      const belY = top + 0.70 + th;
      ctx.dbox(cx, belY + 0.14, cz, tw + 0.5, 0.28, tw + 0.5, CAP);                  // belfry sill
      ctx.dbox(cx, belY + 1.30, cz, tw, 2.0, tw, shade(pal.wall, 0.94));             // belfry stage
      for (let s = 0; s < 4; s++) {
        const horiz = s < 2, sg = (s % 2) ? 1 : -1;
        const ox2 = horiz ? 0 : sg * (tw / 2 + 0.06), oz2 = horiz ? sg * (tw / 2 + 0.06) : 0;
        if (spec.crown === "clock") {
          // clock face: a pale disc, a dark bezel and two hands
          ctx.disc(cx + ox2 * 1.02, belY + 1.30, cz + oz2 * 1.02, tw * 0.34, horiz, sg, 0xf2efe4, 0x2a2f37);
        } else {
          // louvred belfry opening (three slats + a surround)
          for (let l = -1; l <= 1; l++) {
            if (horiz) ctx.dbox(cx, belY + 1.30 + l * 0.42, cz + oz2, tw * 0.5, 0.22, 0.10, shade(pal.wall, 0.55));
            else ctx.dbox(cx + ox2, belY + 1.30 + l * 0.42, cz, 0.10, 0.22, tw * 0.5, shade(pal.wall, 0.55));
          }
        }
      }
      ctx.dbox(cx, belY + 2.48, cz, tw + 0.8, 0.36, tw + 0.8, CAP);                  // belfry cornice
      // stepped spire
      let sy = belY + 2.66, sw2 = tw * 0.92;
      for (let i = 0; i < 4; i++) {
        const sh = 0.9 - i * 0.1;
        ctx.dbox(cx, sy + sh / 2, cz, sw2, sh, sw2, shade(pal.wall, 1.0 - i * 0.03));
        sy += sh; sw2 *= 0.72;
      }
      ctx.column(cx, sy, cz, 0.08, 2.0, 0xd8c98a, 6);
      ctx.ball(cx, sy + 2.1, cz, 0.18, 0xd8c98a);
      return;
    }

    // "flat" crown: a plain stone attic block + a flagstaff, so even the
    // humblest civic office still terminates deliberately.
    ctx.dbox(cx, top + 0.35, cz, base * 0.5, 0.70, base * 0.5, shade(STONE, 0.94));
    ctx.dbox(cx, top + 0.80, cz, base * 0.42, 0.24, base * 0.42, CAP);
    ctx.column(cx, top + 0.92, cz, 0.07, 4.0, 0xb9bec6, 6);
  };

  // ============================================================
  //  5. ROOF CLUTTER — deleted 2026-09-27. It was a hashed slot grid of
  //  primitive stand-ins (a box for a condenser, a box for a dish, a white
  //  "skylight" slab pair) placed before the lifts, stashes and helipad
  //  existed, with no colliders, and config.js had already switched it off.
  //  Roof plant now lives in world/building_dress.js (placed after every
  //  other roof claimant, real prototypes, y-gated colliders).
  // ============================================================

  // ============================================================
  //  6. CANVAS PLAQUE / SEAL TEXTURES (bounded: civic anchors only)
  // ============================================================
  const plaqueCache = new Map();
  CBZ.civicPlaqueTex = function (text, stoneHex) {
    const key = text + "|" + stoneHex;
    let t = plaqueCache.get(key); if (t) return t;
    const c = document.createElement("canvas"); c.width = 512; c.height = 96;
    const x = c.getContext("2d");
    const base = "#" + ("000000" + (stoneHex >>> 0).toString(16)).slice(-6);
    x.fillStyle = base; x.fillRect(0, 0, 512, 96);
    // incised-letter look: a dark shadow offset up-left, a bright highlight
    // down-right, then the face — the way carved Roman capitals read.
    let fs = 58; x.textAlign = "center"; x.textBaseline = "middle";
    do { x.font = "700 " + fs + "px Georgia, Times New Roman, serif"; fs -= 3; }
    while (x.measureText(text).width > 476 && fs > 16);
    x.fillStyle = "rgba(0,0,0,0.55)"; x.fillText(text, 255, 47);
    x.fillStyle = "rgba(255,255,255,0.30)"; x.fillText(text, 257, 49);
    x.fillStyle = "rgba(40,36,30,0.85)"; x.fillText(text, 256, 48);
    t = new THREE.CanvasTexture(c); plaqueCache.set(key, t); return t;
  };
  const sealCache = new Map();
  CBZ.civicSealTex = function (kind) {
    let t = sealCache.get(kind); if (t) return t;
    const c = document.createElement("canvas"); c.width = 256; c.height = 256;
    const x = c.getContext("2d");
    x.clearRect(0, 0, 256, 256);
    const GOLD = "#c9ab5e", DARK = "#2f3a2c";
    x.fillStyle = DARK; x.beginPath(); x.arc(128, 128, 118, 0, 7); x.fill();
    x.strokeStyle = GOLD; x.lineWidth = 9; x.beginPath(); x.arc(128, 128, 112, 0, 7); x.stroke();
    x.lineWidth = 4; x.beginPath(); x.arc(128, 128, 92, 0, 7); x.stroke();
    // laurel/ray ring
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      x.beginPath(); x.moveTo(128 + Math.cos(a) * 94, 128 + Math.sin(a) * 94);
      x.lineTo(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108); x.lineWidth = 3; x.stroke();
    }
    // an emblem per branch of government
    x.fillStyle = GOLD;
    if (kind === "courthouse") {           // scales
      x.fillRect(122, 62, 12, 96);
      x.fillRect(74, 82, 108, 8);
      for (const bx of [78, 170]) { x.beginPath(); x.arc(bx, 122, 22, 0, Math.PI); x.fill(); x.fillRect(bx - 2, 90, 4, 32); }
    } else if (kind === "firestation") {   // maltese-ish cross
      x.fillRect(112, 62, 32, 132); x.fillRect(62, 112, 132, 32);
    } else if (kind === "library") {       // open book
      x.fillRect(64, 106, 56, 60); x.fillRect(136, 106, 56, 60); x.fillRect(122, 100, 12, 72);
    } else if (kind === "postoffice") {    // envelope
      x.fillRect(68, 100, 120, 76);
      x.fillStyle = DARK; x.beginPath(); x.moveTo(68, 100); x.lineTo(128, 146); x.lineTo(188, 100); x.closePath(); x.fill();
    } else {                                // star (federal / city / records)
      x.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 34 : 76, a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const px = 128 + Math.cos(a) * r, py = 128 + Math.sin(a) * r;
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.closePath(); x.fill();
    }
    t = new THREE.CanvasTexture(c); sealCache.set(kind, t); return t;
  };
})();

/* ============================================================
   7. THE MONUMENT KIT — CBZ.civicMonument (a legislature's own architecture)

   OWNER (President mode): "all the buildings in the presidential mode just
   need to be redone ... inside and out." The Capitol was a 92 m office box
   with a 30 cm perron: this file's own order and crown were switched off
   (BLD_EXTRAS) and, even on, its dome is a 4.4 m radius cap sized for a
   courthouse roof. A legislature is read from a kilometre away by three
   things at their REAL size, and this kit draws those three:

     portico(b, o)  a projecting colonnaded portico on the PRINCIPAL floor
                    (the US Capitol's east front): a rusticated arcade at
                    grade that you walk through to the building's one door,
                    the deck over it at floorTops[1], two broad flights up
                    to the deck with a half landing each, eight columns at a
                    1:9 order, entablature, a real sloped pediment and roof.
                    Every tread is the stair system's (CBZ.stairs.flight with
                    `steps`), drawn to exactly the rule the walk surface
                    answers; parapets, newels and the deck balustrade carry
                    colliders.
     dome(b, o)     stepped base, a peristyle drum of 24 columns, attic, a
                    ribbed dome at the building's own scale and a lantern;
                    INSIDE, the drum wall with its lit windows, a coffered
                    inner dome and an oculus, so a rotunda carved under it
                    (city/interior_programs.js "rotunda") looks up into a
                    real dome.
     colonnade(root, o)  an open covered colonnade in WORLD space (the
                    hyphens that tie a Capitol's wings to its centre).

   HOW IT DRAWS. Building-local, into b.group, as merged geometry per colour
   (Pen) plus InstancedMesh for the repeats (columns, balusters): a portico
   costs a handful of draw calls before core/batch.js folds the merged ones.
   Colliders and platforms go to CBZ.colliders/CBZ.platforms AND the
   building's own lists (b.colliders/b.platforms), so a demolition or an
   audit that reads the shell reads these too. Authored for a shell whose
   door is on its +z face (every Capitol shell is); any other side returns
   null. No rng: every number is derived from the shell and the spec.

   It also teaches the civic order/crown one thing: a spec with
   `hostOrder:true` / `hostCrown:true` keeps the monumental FACADE (ashlar,
   bays, cornice) and lets its host draw the order or the crown itself —
   the Capitol's portico and dome replace the kit's engaged columns and its
   courthouse cap instead of being stacked on top of them.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ---- 7a. the host opt-outs (wrapped once, markers carried) --------------
  function hostAware(name, key) {
    const base = CBZ[name];
    if (typeof base !== "function" || base._hostAware) return;
    const wrapped = function (ctx) {
      const s = ctx && ctx.civic;
      if (s && s[key] === true) return;
      return base.apply(this, arguments);
    };
    for (const k in base) { try { wrapped[k] = base[k]; } catch (e) {} }
    wrapped._hostAware = true;
    CBZ[name] = wrapped;
  }
  hostAware("bldCivicOrder", "hostOrder");
  hostAware("bldCivicCrown", "hostCrown");

  // ---- 7b. geometry helpers ------------------------------------------------
  function cm(hex, o) { return CBZ.cmat ? CBZ.cmat(hex, o) : new THREE.MeshLambertMaterial({ color: hex }); }
  const BACK = new Map();
  function backMat(hex, em, ei) {
    const k = hex + "|" + (em || 0) + "|" + (ei || 0);
    let m = BACK.get(k);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: hex, side: THREE.BackSide, emissive: em || 0, emissiveIntensity: ei == null ? 1 : ei });
      m._shared = true;
      BACK.set(k, m);
    }
    return m;
  }
  // concatenate geometries into one non-indexed position/normal/uv geometry
  function merge(list) {
    const pos = [], nor = [], uv = [];
    for (let k = 0; k < list.length; k++) {
      let g = list[k];
      if (!g) continue;
      if (g.index) g = g.toNonIndexed();
      if (!g.attributes.normal) g.computeVertexNormals();
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        pos.push(p.getX(i), p.getY(i), p.getZ(i));
        nor.push(n.getX(i), n.getY(i), n.getZ(i));
        uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    out.computeBoundingSphere(); out.computeBoundingBox();
    return out;
  }
  // a box, then (optionally) rotated about y / z / x through its own centre,
  // then moved to (x,y,z)
  function bx(w, h, d, x, y, z, ry, rz, rx) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return g;
  }
  function lathe(profile, seg) {
    const g = new THREE.LatheGeometry(profile.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), seg || 16);
    g.computeVertexNormals();
    return g;
  }
  function tube(r0, r1, h, y0, seg, open) {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg || 48, 1, open !== false);
    g.translate(0, y0 + h / 2, 0);
    return g;
  }
  // a flat annulus at height y, facing up (dn:true faces down)
  function ring(r0, r1, y, seg, dn) {
    const g = new THREE.RingGeometry(r0, r1, seg || 48, 1);
    g.rotateX(dn ? Math.PI / 2 : -Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  }

  /* THE PEN. Every static piece of a monument goes into a per-colour bucket
     (building-local geometry) and comes out as ONE mesh per colour. */
  function Pen(b) {
    const B = new Map();
    const put = function (hex, g, kind) {
      const k = hex + "|" + (kind || "");
      let L = B.get(k);
      if (!L) { L = { hex: hex, kind: kind || "", list: [] }; B.set(k, L); }
      L.list.push(g);
      return g;
    };
    return {
      add: function (hex, g) { return put(hex, g, ""); },
      glow: function (hex, g, ei) { return put(hex, g, "glow:" + (ei == null ? 0.7 : ei)); },
      back: function (hex, g) { return put(hex, g, "back"); },
      backGlow: function (hex, g, ei) { return put(hex, g, "backglow:" + (ei == null ? 0.7 : ei)); },
      box: function (hex, w, h, d, x, y, z, ry, rz, rx) { return put(hex, bx(w, h, d, x, y, z, ry, rz, rx), ""); },
      flush: function (name) {
        const out = [];
        B.forEach(function (L) {
          const geo = merge(L.list);
          let mat;
          if (L.kind === "back") mat = backMat(L.hex);
          else if (L.kind.indexOf("backglow:") === 0) mat = backMat(L.hex, L.hex, +L.kind.slice(9));
          else if (L.kind.indexOf("glow:") === 0) mat = cm(L.hex, { emissive: L.hex, ei: +L.kind.slice(5) });
          else mat = cm(L.hex);
          const m = new THREE.Mesh(geo, mat);
          m.name = name || "civic-monument";
          m.castShadow = L.kind === "" && geo.boundingSphere && geo.boundingSphere.radius > 1.5;
          m.receiveShadow = L.kind.indexOf("glow") < 0;
          m.matrixAutoUpdate = false; m.updateMatrix();
          b.group.add(m);
          out.push(m);
        });
        B.clear();
        return out;
      },
    };
  }
  // an InstancedMesh of one geometry at building-local points {x,y,z,ry}
  function instances(b, geo, hex, pts, name) {
    if (!pts.length) return null;
    const im = new THREE.InstancedMesh(geo, cm(hex), pts.length);
    const o = new THREE.Object3D();
    for (let i = 0; i < pts.length; i++) {
      o.position.set(pts[i].x, pts[i].y || 0, pts[i].z);
      o.rotation.set(0, pts[i].ry || 0, 0);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    im.name = name || "civic-instances";
    b.group.add(im);
    return im;
  }
  // colliders and walk surfaces, filed where the world AND the shell look
  function Phys(b) {
    const ox = b.ox, oz = b.oz;
    const file = function (list, rec) { list.push(rec); return rec; };
    return {
      solid: function (x0, x1, z0, z1, y0, y1) {
        const c = { minX: ox + Math.min(x0, x1), maxX: ox + Math.max(x0, x1), minZ: oz + Math.min(z0, z1), maxZ: oz + Math.max(z0, z1), y0: y0, y1: y1, ref: null };
        CBZ.colliders = CBZ.colliders || [];
        file(CBZ.colliders, c);
        if (b.colliders) b.colliders.push(c);
        return c;
      },
      walk: function (x0, x1, z0, z1, top) {
        const p = { minX: ox + Math.min(x0, x1), maxX: ox + Math.max(x0, x1), minZ: oz + Math.min(z0, z1), maxZ: oz + Math.max(z0, z1), top: top };
        CBZ.platforms = CBZ.platforms || [];
        file(CBZ.platforms, p);
        if (b.platforms) b.platforms.push(p);
        return p;
      },
      dirty: function () {
        if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
        if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
      },
    };
  }

  /* A COLUMN OF THE ORDER, as one lathe: square plinth, attic base (two tori
     and a scotia), a shaft with entasis (full to a third, 0.86 at the neck),
     astragal, a flared bell capital, four corner volutes and the abacus.
     Origin at the plinth's foot; total height H; lower shaft radius R. */
  const COLG = new Map();
  function columnGeo(R, H) {
    const key = R.toFixed(3) + "|" + H.toFixed(3);
    if (COLG.has(key)) return COLG.get(key);
    const yPl = 0.5 * R, yB = yPl + 0.5 * R, capH = 2.1 * R, abH = 0.3 * R;
    const yS1 = H - capH - abH;
    const prof = [
      [0, yPl], [1.36 * R, yPl], [1.36 * R, yPl + 0.14 * R], [1.16 * R, yPl + 0.26 * R],
      [1.22 * R, yPl + 0.38 * R], [1.04 * R, yB - 0.03 * R], [R, yB],
      [R, yB + (yS1 - yB) / 3], [0.93 * R, yB + (yS1 - yB) * 0.7], [0.86 * R, yS1],
      [0.96 * R, yS1 + 0.05 * R], [0.96 * R, yS1 + 0.16 * R], [0.87 * R, yS1 + 0.2 * R],
      [0.98 * R, yS1 + 0.9 * R], [1.3 * R, yS1 + capH - 0.02 * R], [0, yS1 + capH],
    ];
    const parts = [
      bx(2.72 * R, yPl, 2.72 * R, 0, yPl / 2, 0),
      lathe(prof, 18),
      bx(2.9 * R, abH, 2.9 * R, 0, H - abH / 2, 0),
    ];
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      parts.push(bx(0.55 * R, 0.55 * R, 0.55 * R, sx * 1.12 * R, H - abH - 0.34 * R, sz * 1.12 * R));
    const g = merge(parts);
    COLG.set(key, g);
    return g;
  }
  let BALG = null;
  function balusterGeo() {
    if (BALG) return BALG;
    BALG = lathe([[0, 0], [0.085, 0], [0.085, 0.05], [0.06, 0.09], [0.1, 0.26], [0.05, 0.46],
      [0.045, 0.52], [0.075, 0.56], [0.075, 0.64], [0, 0.64]], 10);
    return BALG;
  }
  // a balustrade run along x or z: plinth, balusters (instanced), rail; and
  // the SOLID band it is (a guard you lean on, never step through)
  function balustrade(b, pen, phys, bal, axis, at, from, to, y, hex, capHex) {
    const L = Math.abs(to - from), mid = (from + to) / 2;
    if (L < 0.3) return;
    const alongX = axis === "x";
    pen.box(hex, alongX ? L : 0.34, 0.16, alongX ? 0.34 : L, alongX ? mid : at, y + 0.08, alongX ? at : mid);
    pen.box(capHex, alongX ? L + 0.1 : 0.4, 0.14, alongX ? 0.4 : L + 0.1, alongX ? mid : at, y + 0.87, alongX ? at : mid);
    const n = Math.max(1, Math.floor(L / 0.3));
    for (let i = 0; i < n; i++) {
      const t = Math.min(from, to) + (i + 0.5) * L / n;
      bal.push({ x: alongX ? t : at, y: y + 0.16, z: alongX ? at : t });
    }
    if (alongX) phys.solid(Math.min(from, to), Math.max(from, to), at - 0.2, at + 0.2, y, y + 1.0);
    else phys.solid(at - 0.2, at + 0.2, Math.min(from, to), Math.max(from, to), y, y + 1.0);
  }
  /* A PARAPET THAT FOLLOWS A FLIGHT: a wall whose top runs 1.0 m over the
     walk line, profile [[z, yTop], ...] (z strictly monotonic), from the
     ground (y 0) up, thickness t along x on [x0, x0 + t]. One extruded
     prism, a coping on every segment, and a banded collider every half
     metre so nobody steps off the side of a five-metre stair. The profile may
     run either way along z. */
  function parapet(pen, phys, x0, t, prof, hex, capHex) {
    const sh = new THREE.Shape();
    sh.moveTo(prof[0][0], 0);
    for (let i = 0; i < prof.length; i++) sh.lineTo(prof[i][0], prof[i][1]);
    sh.lineTo(prof[prof.length - 1][0], 0);
    sh.lineTo(prof[0][0], 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false, steps: 1 });
    g.rotateY(-Math.PI / 2);                 // shape x -> world z, extrude -> world -x
    g.translate(x0 + t, 0, 0);
    pen.add(hex, g);
    for (let i = 1; i < prof.length; i++) {
      const za = prof[i - 1][0], ya = prof[i - 1][1], zb = prof[i][0], yb = prof[i][1];
      const len = Math.hypot(zb - za, yb - ya);
      if (len < 0.05) continue;
      pen.box(capHex, t + 0.12, 0.12, len + 0.06, x0 + t / 2, (ya + yb) / 2 + 0.06, (za + zb) / 2, 0, 0, Math.atan2(-(yb - ya), zb - za));
      const nb = Math.max(1, Math.ceil(Math.abs(zb - za) / 0.5));
      for (let k = 0; k < nb; k++) {
        const z0 = za + (zb - za) * k / nb, z1 = za + (zb - za) * (k + 1) / nb;
        const y1 = Math.max(ya + (yb - ya) * k / nb, ya + (yb - ya) * (k + 1) / nb);
        phys.solid(x0, x0 + t, z0, z1, 0, y1 + 0.02);
      }
    }
  }

  /* ---- 7c. THE PORTICO ------------------------------------------------------
     o: { depth: 11, half: 19 (colonnade half-width), flightW: 8, ground: 0.10,
          stone, stoneD, roof, bronze, order: { R: 0.55 } }
     Returns the record the host files (walk rects for its ground oracle,
     the deck, the flights, the column line). */
  function portico(b, o) {
    if (!b || !b.group || !b.localDoor || !(b.localDoor.nz < -0.5)) return null;
    if (!Array.isArray(b.floorTops) || b.floorTops.length < 3 || !CBZ.stairs || !CBZ.stairs.flight) return null;
    o = o || {};
    const STONE = o.stone || 0xe6e3d8, STONED = o.stoneD || 0xc9c4b4, CAP = o.cap || 0xf0ede4;
    const RUST = o.rust || 0xd3cebf, ROOF = o.roof || 0x7f8489, BRONZE = o.bronze || 0xb99347;
    const pen = Pen(b), phys = Phys(b), bal = [];
    const zf = b.d / 2;                       // the facade's outer face
    const P = o.depth || 11, X1 = o.half || 19, FW = o.flightW || 8, X2 = X1 + FW;
    const deck = b.floorTops[1], soffit = deck - 0.6;
    const g0 = o.ground != null ? o.ground : 0.10;
    const zTop = zf + P;                      // the deck's front edge = the top nosing
    const rec = { deck: deck, zf: zf, zTop: zTop, half: X1, outer: X2, ground: [], flights: [], treads: [] };

    // ---- the deck, its front string course, the flank masses under it
    pen.box(STONE, 2 * X2, 0.6, P, 0, deck - 0.3, zf + P / 2);
    phys.walk(-X2, X2, zf, zTop, deck);
    pen.box(CAP, 2 * X2 + 0.3, 0.28, 0.3, 0, soffit + 0.14, zTop + 0.05);
    for (const s of [-1, 1]) {
      pen.box(CAP, 0.3, 0.28, P + 0.15, s * (X2 + 0.05), soffit + 0.14, zf + P / 2 + 0.07);
      const xm = s * (X1 + FW / 2);
      pen.box(RUST, FW, soffit, P, xm, soffit / 2, zf + P / 2);
      phys.solid(xm - FW / 2, xm + FW / 2, zf, zTop, 0, soffit);
      // rustication: V-joints every 0.55 m on the outer and inner faces
      for (let y = 0.55; y < soffit - 0.2; y += 0.55) {
        pen.box(STONED, 0.04, 0.05, P, s * (X2 + 0.015), y, zf + P / 2);
        pen.box(STONED, 0.04, 0.05, P - 1.0, s * (X1 - 0.015), y, zf + (P - 1) / 2);
      }
    }
    // ---- the ARCADE: five round-headed openings through a rusticated wall
    const nA = 5, pitch = 2 * X1 / nA, ow = Math.min(4.0, pitch - 1.6), hr = ow / 2;
    const spring = Math.max(1.6, soffit - 0.25 - hr);
    const sh = new THREE.Shape();
    sh.moveTo(-X1, 0);
    const centres = [];
    for (let i = 0; i < nA; i++) {
      const c = -X1 + pitch * (i + 0.5);
      centres.push(c);
      sh.lineTo(c - hr, 0);
      sh.lineTo(c - hr, spring);
      sh.absarc(c, spring, hr, Math.PI, 0, true);
      sh.lineTo(c + hr, 0);
    }
    sh.lineTo(X1, 0); sh.lineTo(X1, soffit); sh.lineTo(-X1, soffit); sh.lineTo(-X1, 0);
    const ag = new THREE.ExtrudeGeometry(sh, { depth: 1.0, bevelEnabled: false, curveSegments: 10 });
    ag.translate(0, 0, zTop - 1.0);
    pen.add(RUST, ag);
    for (let i = 0; i <= nA; i++) {
      const xa = i === 0 ? -X1 : centres[i - 1] + hr, xb = i === nA ? X1 : centres[i] - hr;
      phys.solid(xa, xb, zTop - 1.0, zTop, 0, soffit);
      // the pier's rusticated joints, below the springing only
      for (let y = 0.55; y < spring - 0.1; y += 0.55) pen.box(STONED, xb - xa, 0.05, 0.04, (xa + xb) / 2, y, zTop + 0.015);
      pen.box(CAP, xb - xa + 0.1, 0.2, 0.14, (xa + xb) / 2, spring - 0.1, zTop + 0.06);   // impost band
    }
    for (const c of centres) pen.box(CAP, 0.56, 0.8, 1.14, c, spring + hr - 0.12, zTop - 0.5);   // keystones
    // ---- the VESTIBULE under the deck: piers, coffered soffit, lanterns, floor
    const zV = zf + (P - 1) / 2;
    for (let i = 0; i < nA - 1; i++) {
      const xp = (centres[i] + centres[i + 1]) / 2;
      pen.box(STONE, 1.2, soffit, 1.2, xp, soffit / 2, zV);
      pen.box(CAP, 1.5, 0.3, 1.5, xp, soffit - 0.15, zV);
      pen.box(STONED, 1.5, 0.22, 1.5, xp, 0.11, zV);
      phys.solid(xp - 0.75, xp + 0.75, zV - 0.75, zV + 0.75, 0, soffit);
    }
    for (let x = -X1 + pitch; x < X1 - 0.1; x += pitch) pen.box(STONED, 0.34, 0.3, P - 1.0, x, soffit - 0.15, zV);
    for (let z = zf + 2.5; z < zTop - 1.2; z += 2.5) pen.box(STONED, 2 * X1, 0.3, 0.34, 0, soffit - 0.15, z);
    pen.box(0xa9a397, 2 * X1, g0, P - 1.0, 0, g0 / 2, zV);           // paving, top at the ground height
    rec.ground.push({ x0: -X1, x1: X1, z0: zf, z1: zTop - 1.0, y: g0 });
    for (const x of [-pitch, 0, pitch]) {
      pen.box(BRONZE, 0.05, 0.9, 0.05, x, soffit - 0.75, zV);
      pen.glow(0xffe2b0, bx(0.55, 0.75, 0.55, x, soffit - 1.55, zV), 0.9);
      pen.box(BRONZE, 0.7, 0.1, 0.7, x, soffit - 1.13, zV);
    }
    // ---- the DOOR SURROUND on the facade: architrave, frieze, hood
    pen.box(CAP, 0.5, 3.3, 0.24, -1.25, 1.65, zf + 0.12);
    pen.box(CAP, 0.5, 3.3, 0.24, 1.25, 1.65, zf + 0.12);
    pen.box(CAP, 3.0, 0.5, 0.24, 0, 2.75, zf + 0.12);
    pen.box(STONE, 3.4, 0.35, 0.5, 0, 3.2, zf + 0.25);
    pen.box(STONED, 3.7, 0.12, 0.62, 0, 3.43, zf + 0.31);

    // ---- the two FLIGHTS, each with a half landing: rise from the forecourt
    //      toward the building and arrive on the deck's front edge
    const GO = 0.40, LAND = 2.4, PT = 0.5;
    const n = Math.max(8, Math.round((deck - g0) / 0.165));
    const rise = (deck - g0) / n, n1 = Math.ceil(n / 2), n2 = n - n1;
    const yL = g0 + n1 * rise;
    const zL0 = zTop + n2 * GO, zL1 = zL0 + LAND, zBot = zL1 + n1 * GO;
    rec.zBot = zBot;
    for (const s of [-1, 1]) {
      const xa = s > 0 ? X1 : -X2, xb = s > 0 ? X2 : -X1;
      const W = (xb - xa) - 2 * PT, xc = (xa + xb) / 2;
      const f1 = CBZ.stairs.flight({
        bottom: { x: b.ox + xc, y: g0, z: b.oz + zBot }, top: { x: b.ox + xc, y: yL, z: b.oz + zL1 },
        width: W, overlap: 0.3, steps: n1, owner: b, plats: b.platforms || undefined, cols: b.colliders || undefined, kind: "stair",
      });
      const f2 = CBZ.stairs.flight({
        bottom: { x: b.ox + xc, y: yL, z: b.oz + zL0 }, top: { x: b.ox + xc, y: deck, z: b.oz + zTop },
        width: W, overlap: 0.3, steps: n2, owner: b, plats: b.platforms || undefined, cols: b.colliders || undefined, kind: "stair",
      });
      rec.flights.push(f1 && f1.link ? f1.link.id : null, f2 && f2.link ? f2.link.id : null);
      phys.walk(xc - W / 2, xc + W / 2, zL0 - 0.02, zL1 + 0.02, yL);
      const mass = function (zStart, base, cnt) {
        for (let i = 1; i <= cnt; i++) {
          const top = base + i * rise, zc = zStart - (i - 0.5) * GO, zFront = zStart - (i - 1) * GO;
          pen.box(STONE, W, top, GO + 0.004, xc, top / 2, zc);
          pen.box(CAP, W, 0.035, 0.07, xc, top - 0.0175, zFront - 0.035);     // the nosing, flush
          phys.solid(xc - W / 2, xc + W / 2, zc - GO / 2, zc + GO / 2, -0.05, top);
          rec.treads.push({ x: b.ox + xc, z: b.oz + zc, top: top, w: W, go: GO });
        }
      };
      mass(zBot, g0, n1);
      pen.box(STONE, W, yL, LAND + 0.004, xc, yL / 2, (zL0 + zL1) / 2);
      phys.solid(xc - W / 2, xc + W / 2, zL0, zL1, -0.05, yL);
      mass(zL0, yL, n2);
      // the paving apron the first riser rises from (drawn at the ground height)
      pen.box(0xa9a397, W + 2 * PT, g0, 2.0, xc, g0 / 2, zBot + 1.0);
      rec.ground.push({ x0: xa, x1: xb, z0: zBot, z1: zBot + 2.0, y: g0 });
      // parapets: the outer one runs on along the deck's side to the facade
      const up = 1.0;
      const line = [[zBot, g0 + up], [zL1, yL + up], [zL0, yL + up], [zTop, deck + up]];
      parapet(pen, phys, s > 0 ? xb - PT : xa, PT, line.concat([[zf, deck + up]]), RUST, CAP);
      parapet(pen, phys, s > 0 ? xa : xb - PT, PT, line, RUST, CAP);
      // newels at the foot of both parapets: pedestal, cap, a bronze lantern
      for (const xn of [xa + PT / 2, xb - PT / 2]) {
        pen.box(RUST, 0.9, 1.5, 0.9, xn, 0.75, zBot - 0.1);
        pen.box(CAP, 1.05, 0.16, 1.05, xn, 1.58, zBot - 0.1);
        pen.box(BRONZE, 0.1, 1.0, 0.1, xn, 2.16, zBot - 0.1);
        pen.glow(0xffe2b0, bx(0.34, 0.46, 0.34, xn, 2.86, zBot - 0.1), 0.85);
        pen.box(BRONZE, 0.44, 0.08, 0.44, xn, 3.13, zBot - 0.1);
        phys.solid(xn - 0.45, xn + 0.45, zBot - 0.55, zBot + 0.35, 0, 1.66);
      }
    }
    // ---- the DECK: balustrade along the front between the flights
    balustrade(b, pen, phys, bal, "x", zTop - 0.3, -X1, X1, deck, RUST, CAP);

    // ---- THE ORDER: eight columns on the front, a return column and an anta
    const R = (o.order && o.order.R) || 0.55;
    const E0 = deck + (o.order && o.order.H || 9.6);                 // architrave soffit
    const zc = zTop - 1.7;
    const xo = X1 - 1.5, nC = 8;
    const cols = [];
    for (let i = 0; i < nC; i++) cols.push({ x: -xo + i * (2 * xo) / (nC - 1), y: deck, z: zc });
    for (const s of [-1, 1]) cols.push({ x: s * xo, y: deck, z: zc - (P - 1.7) / 2 - 0.4 });
    instances(b, columnGeo(R, E0 - deck), STONE, cols, "civic-portico-columns");
    for (const c of cols) phys.solid(c.x - 1.36 * R, c.x + 1.36 * R, c.z - 1.36 * R, c.z + 1.36 * R, deck, deck + 3.0);
    for (const s of [-1, 1]) {           // antae: pilasters where the order meets the wall
      pen.box(STONE, 1.5 * R * 2, E0 - deck, 0.5, s * xo, (deck + E0) / 2, zf + 0.25);
      pen.box(CAP, 1.7 * R * 2, 0.5, 0.62, s * xo, E0 - 0.25, zf + 0.31);
    }
    rec.columns = cols.map(function (c) { return { x: b.ox + c.x, z: b.oz + c.z }; });
    // ---- ENTABLATURE: architrave, frieze, cornice on the front and both returns
    const ent = function (y0, h, proj, hex) {
      const front = 2 * xo + 2 * R * 1.45 + proj * 2;
      pen.box(hex, front, h, 1.35 * R * 2 + proj, 0, y0 + h / 2, zc + proj / 2);
      for (const s of [-1, 1])
        pen.box(hex, 1.35 * R * 2 + proj, h, zc - zf + 0.02, s * (xo + proj / 2), y0 + h / 2, (zc + zf) / 2);
    };
    ent(E0, 0.8, 0, STONE);
    ent(E0 + 0.8, 0.75, -0.06, STONED);
    for (let x = -xo; x <= xo + 0.01; x += (2 * xo) / 21) pen.box(CAP, 0.3, 0.55, 0.12, x, E0 + 1.17, zc + 1.35 * R - 0.02);   // frieze blocks
    ent(E0 + 1.55, 0.2, 0.25, CAP);
    ent(E0 + 1.75, 0.4, 0.55, STONE);
    const EC = E0 + 2.15;                                    // cornice top
    // the portico's own ceiling, coffered, under the architrave line
    pen.box(STONED, 2 * xo, 0.3, zc - zf, 0, E0 + 0.15, (zc + zf) / 2);
    for (let x = -xo + (2 * xo) / 7; x < xo - 0.1; x += (2 * xo) / 7) pen.box(STONE, 0.35, 0.34, zc - zf, x, E0 - 0.17, (zc + zf) / 2);
    for (let z = zf + 2.4; z < zc - 0.5; z += 2.4) pen.box(STONE, 2 * xo, 0.34, 0.35, 0, E0 - 0.17, z);
    // ---- THE PEDIMENT: a real triangle (1:4.3), raking cornices, tympanum,
    //      the medallion in it, acroteria; the roof behind it back to the wall
    const hw = xo + R * 1.45 + 0.55, pr = hw * Math.tan(13.5 * Math.PI / 180);
    const tri = function (half, rise, depth) {
      const t = new THREE.Shape();
      t.moveTo(-half, 0); t.lineTo(half, 0); t.lineTo(0, rise); t.lineTo(-half, 0);
      return new THREE.ExtrudeGeometry(t, { depth: depth, bevelEnabled: false });
    };
    const tf = zc + 1.35 * R - 0.1;                           // tympanum face
    const tg = tri(hw - 0.5, pr - 0.4, tf - zf); tg.translate(0, EC, zf); pen.add(STONED, tg);
    const slope = Math.atan2(pr, hw), rl = Math.hypot(hw, pr) + 0.4;
    for (const s of [-1, 1]) {
      pen.box(CAP, rl, 0.5, 1.1, s * hw / 2, EC + pr / 2 + 0.12, tf + 0.25, 0, -s * slope);
      pen.box(STONE, rl, 0.22, 0.8, s * hw / 2, EC + pr / 2 - 0.16, tf + 0.12, 0, -s * slope);
      pen.box(CAP, 0.9, 0.9, 0.9, s * (hw - 0.3), EC + 0.45, tf);                   // corner acroteria
      // the ROOF: two lead planes from the ridge down to the eaves, back to the wall
      pen.box(ROOF, rl, 0.3, tf - zf + 0.6, s * hw / 2, EC + pr / 2 + 0.05, (tf + zf) / 2 + 0.3, 0, -s * slope);
    }
    pen.box(CAP, 1.1, 1.3, 0.9, 0, EC + pr + 0.5, tf);                              // apex acroterion
    const med = new THREE.CylinderGeometry(1.25, 1.25, 0.24, 28); med.rotateX(Math.PI / 2); med.translate(0, EC + pr * 0.42, tf + 0.12);
    pen.add(BRONZE, med);
    const medR = new THREE.TorusGeometry(1.32, 0.12, 6, 28); medR.translate(0, EC + pr * 0.42, tf + 0.2);
    pen.add(CAP, medR);

    if (bal.length) instances(b, balusterGeo(), CAP, bal, "civic-portico-balusters");
    pen.flush("civic-portico");
    phys.dirty();
    rec.pediment = { apex: EC + pr, cornice: EC };
    rec.entablature = E0;
    return rec;
  }
  /* ---- 7d. THE DOME --------------------------------------------------------
     Over the shell's centre, standing on its roof (b.h). Real scale for the
     building it crowns: o.R is the dome's springing radius (default 0.46 of
     the short side, capped 13). Outside: two base steps, the peristyle drum
     (24 columns, entablature, balustrade), the attic, a ribbed dome, the
     lantern and its finial. Inside: the drum wall with lit windows, a cornice,
     a coffered inner dome and the oculus, over whatever the host opens under
     it. Returns the numbers a host needs (inner radius, springing, apex). */
  function dome(b, o) {
    if (!b || !b.group) return null;
    o = o || {};
    const STONE = o.stone || 0xe6e3d8, STONED = o.stoneD || 0xc9c4b4, CAP = o.cap || 0xf0ede4;
    const SKIN = o.skin || 0xeceae3, RIB = o.rib || 0xd6d2c6, GLASS = 0x2a3440, BRONZE = o.bronze || 0xb99347;
    const INNER = o.inner || 0xe9e1cd, COFFER = o.coffer || 0xcfc4a8;
    const pen = Pen(b);
    const y0 = b.h;
    const Rd = o.R || Math.min(13, Math.min(b.w, b.d) * 0.23);   // drum outer radius
    const Ri = Rd - 0.6;                                          // the room's radius inside it
    const S1 = Rd + 3.4, S2 = Rd + 2.8, SB = Rd + 2.6;             // base steps, stylobate
    // base steps + stylobate
    pen.add(STONED, tube(S1, S1, 0.8, y0, 64));
    pen.add(STONE, ring(Rd - 0.05, S1, y0 + 0.8, 64));
    pen.add(STONED, tube(S2, S2, 0.8, y0 + 0.8, 64));
    pen.add(STONE, ring(Rd - 0.05, S2, y0 + 1.6, 64));
    pen.add(STONE, tube(SB, SB, 0.8, y0 + 1.6, 64));
    pen.add(CAP, ring(Rd - 0.05, SB + 0.05, y0 + 2.4, 64));
    // the drum wall
    const yC0 = y0 + 2.4, colH = o.colH || 8.4, yE = yC0 + colH, yE1 = yE + 1.2;
    pen.add(STONE, tube(Rd, Rd, yE1 - (y0 + 1.6), y0 + 1.6, 64));
    // peristyle
    const NC = 24, Rc = Rd + 1.35, cr = 0.42;
    const pts = [];
    for (let i = 0; i < NC; i++) {
      const a = (i / NC) * Math.PI * 2;
      pts.push({ x: Math.cos(a) * Rc, y: yC0, z: Math.sin(a) * Rc, ry: -a });
    }
    instances(b, columnGeo(cr, colH), STONE, pts, "civic-drum-columns");
    // windows between the columns: dark glass in a stone architrave outside,
    // lit panes on the inner wall (the rotunda's daylight)
    const winH = colH - 2.6, winY = yC0 + 1.0 + winH / 2;
    const glass = [], trim = [], lit = [], pil = [];
    for (let i = 0; i < NC; i++) {
      const a = ((i + 0.5) / NC) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), ry = Math.PI / 2 - a;
      glass.push(bx(1.5, winH, 0.06, ca * (Rd + 0.02), winY, sa * (Rd + 0.02), ry));
      trim.push(bx(2.0, 0.3, 0.2, ca * (Rd + 0.08), winY + winH / 2 + 0.2, sa * (Rd + 0.08), ry));
      trim.push(bx(1.9, 0.18, 0.24, ca * (Rd + 0.1), winY - winH / 2 - 0.1, sa * (Rd + 0.1), ry));
      lit.push(bx(1.4, winH - 0.2, 0.05, ca * (Ri + 0.02), winY, sa * (Ri + 0.02), ry));
      const b2 = (i / NC) * Math.PI * 2;
      pil.push(bx(0.8, colH + 1.0, 0.3, Math.cos(b2) * (Ri + 0.1), yC0 + (colH + 1.0) / 2 - 0.4, Math.sin(b2) * (Ri + 0.1), Math.PI / 2 - b2));
    }
    pen.add(GLASS, merge(glass));
    pen.add(CAP, merge(trim));
    pen.glow(0xfff1d8, merge(lit), 0.55);
    pen.back(INNER, merge(pil));
    // the entablature ring and the balustrade on it
    pen.add(STONE, tube(Rc + 0.75, Rc + 0.75, 1.2, yE, 64));
    pen.add(STONED, ring(Rd, Rc + 0.75, yE, 64, true));                 // its soffit
    pen.add(CAP, tube(Rc + 1.0, Rc + 1.0, 0.3, yE1 - 0.3, 64));
    pen.add(CAP, ring(Rd - 0.05, Rc + 1.0, yE1, 64));
    const balPts = [];
    const Rb = Rc + 0.6, nb = Math.round(2 * Math.PI * Rb / 0.32);
    for (let i = 0; i < nb; i++) { const a = (i / nb) * Math.PI * 2; balPts.push({ x: Math.cos(a) * Rb, y: yE1 + 0.16, z: Math.sin(a) * Rb }); }
    instances(b, balusterGeo(), CAP, balPts, "civic-drum-balusters");
    pen.add(STONED, tube(Rb + 0.16, Rb + 0.16, 0.16, yE1, 64, false));
    pen.add(CAP, tube(Rb + 0.2, Rb + 0.2, 0.14, yE1 + 0.8, 64, false));
    // the attic: a plainer upper drum with pilasters and square lights
    const Ra = Rd - 0.25, yA1 = yE1 + 3.6;
    pen.add(STONE, tube(Ra, Ra, yA1 - yE1, yE1, 64));
    const at = [], atG = [];
    for (let i = 0; i < NC; i++) {
      const a = (i / NC) * Math.PI * 2, ry = Math.PI / 2 - a;
      at.push(bx(0.7, 3.2, 0.2, Math.cos(a) * (Ra + 0.08), yE1 + 1.8, Math.sin(a) * (Ra + 0.08), ry));
      const a2 = ((i + 0.5) / NC) * Math.PI * 2;
      atG.push(bx(1.1, 1.2, 0.06, Math.cos(a2) * (Ra + 0.02), yE1 + 1.9, Math.sin(a2) * (Ra + 0.02), Math.PI / 2 - a2));
    }
    pen.add(CAP, merge(at));
    pen.add(GLASS, merge(atG));
    pen.add(CAP, tube(Ra + 0.7, Ra + 0.7, 0.4, yA1 - 0.4, 64));
    pen.add(CAP, ring(Ri, Ra + 0.7, yA1, 64));
    // THE DOME: a raised (stilted) profile, sixteen ribs, a ring at its eye
    const yS = yA1, Rs = Ra - 0.15, Hd = o.H || Rs * 1.12, rEye = Math.max(1.8, Rs * 0.19);
    const tMax = Math.acos(rEye / Rs), NP = 18;
    const prof = [];
    for (let i = 0; i <= NP; i++) { const t = tMax * i / NP; prof.push([Rs * Math.cos(t), yS + Hd * Math.sin(t)]); }
    const yEye = prof[NP][1];
    pen.add(SKIN, lathe(prof.concat([[0, yEye]]), 64));
    const ribs = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const cp = prof.map(function (p) { return new THREE.Vector3(ca * (p[0] + 0.1), p[1] + 0.05, sa * (p[0] + 0.1)); });
      ribs.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cp), 24, 0.2, 5, false));
    }
    pen.add(RIB, merge(ribs));
    for (const f of [0.02, 0.3]) {
      const i = Math.round(f * NP), p = prof[i];
      const tg = new THREE.TorusGeometry(p[0] + 0.12, 0.2, 6, 64); tg.rotateX(Math.PI / 2); tg.translate(0, p[1], 0);
      pen.add(RIB, tg);
    }
    // THE LANTERN: a ring, eight colonnettes round a glazed drum, its cap, the finial
    const yL0 = yEye;
    pen.add(CAP, tube(rEye + 0.5, rEye + 0.5, 0.5, yL0 - 0.1, 32, false));
    const lp = [], lh = 3.4;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; lp.push({ x: Math.cos(a) * (rEye + 0.1), y: yL0 + 0.4, z: Math.sin(a) * (rEye + 0.1) }); }
    instances(b, columnGeo(0.16, lh), CAP, lp, "civic-lantern-columns");
    pen.add(GLASS, tube(rEye - 0.4, rEye - 0.4, lh, yL0 + 0.4, 24, false));
    pen.add(CAP, tube(rEye + 0.45, rEye + 0.45, 0.5, yL0 + 0.4 + lh, 32, false));
    pen.add(CAP, ring(0, rEye + 0.45, yL0 + 0.4 + lh + 0.5, 32));
    const yLc = yL0 + 0.9 + lh;
    pen.add(SKIN, lathe([[rEye + 0.2, yLc], [rEye * 0.8, yLc + rEye * 0.55], [rEye * 0.4, yLc + rEye * 0.95], [0, yLc + rEye * 1.05]], 32));
    const yF = yLc + rEye * 1.05;
    pen.add(BRONZE, lathe([[0, yF], [0.35, yF], [0.18, yF + 0.6], [0.3, yF + 0.9], [0.1, yF + 1.6], [0.26, yF + 1.9], [0, yF + 2.4]], 12));
    // ---- INSIDE: the drum's inner wall from the roof slab up, its cornice, the
    //      inner dome with coffer rings and a lit oculus at the lantern's eye
    const yIn0 = y0 - 0.2;
    pen.back(INNER, tube(Ri, Ri, yS - yIn0, yIn0, 64));
    const cor = new THREE.TorusGeometry(Ri - 0.2, 0.28, 6, 64); cor.rotateX(Math.PI / 2); cor.translate(0, yE - 0.2, 0);
    pen.add(COFFER, cor);
    const cor2 = new THREE.TorusGeometry(Ri - 0.25, 0.32, 6, 64); cor2.rotateX(Math.PI / 2); cor2.translate(0, yS - 0.1, 0);
    pen.add(COFFER, cor2);
    const iH = Hd - 0.6, iprof = [];
    for (let i = 0; i <= NP; i++) { const t = Math.acos(Math.min(1, (rEye - 0.3) / Ri)) * i / NP; iprof.push([Ri * Math.cos(t), yS + iH * Math.sin(t)]); }
    const iTop = iprof[NP][1];
    pen.back(INNER, lathe(iprof.concat([[0, iTop]]), 64));
    for (const f of [0.18, 0.36, 0.54, 0.72]) {
      const i = Math.round(f * NP), p = iprof[i];
      const tg = new THREE.TorusGeometry(p[0] - 0.1, 0.16, 5, 64); tg.rotateX(Math.PI / 2); tg.translate(0, p[1] - 0.05, 0);
      pen.add(COFFER, tg);
    }
    const eye = new THREE.CircleGeometry(rEye - 0.35, 28); eye.rotateX(Math.PI / 2); eye.translate(0, iTop - 0.04, 0);
    pen.glow(0xfff4dc, eye, 0.9);
    pen.flush("civic-dome");
    return { innerR: Ri, drumR: Rd, springing: yS, apex: yF + 2.4, eye: iTop, floorY: y0 };
  }

  /* ---- 7e. AN OPEN COLONNADE in WORLD space (a hyphen between two blocks)
     o: { x0, x1, z0, z1, h, stone, cap, roof, ground }: two rows of columns
     along the long axis, an entablature, a flat roof with a balustraded
     edge, paving under it at the ground height. Solid columns. */
  function colonnade(root, o) {
    if (!root || !o) return null;
    const host = { group: new THREE.Group(), ox: 0, oz: 0, colliders: null, platforms: null };
    host.group.name = "civic-colonnade";
    root.add(host.group);
    const pen = Pen(host), phys = Phys(host);
    const STONE = o.stone || 0xe6e3d8, CAP = o.cap || 0xf0ede4, STONED = o.stoneD || 0xc9c4b4;
    const alongX = (o.x1 - o.x0) >= (o.z1 - o.z0);
    const L = alongX ? o.x1 - o.x0 : o.z1 - o.z0, D = alongX ? o.z1 - o.z0 : o.x1 - o.x0;
    const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2, H = o.h || 6.0, g0 = o.ground != null ? o.ground : 0.10;
    const R = 0.34, n = Math.max(2, Math.round(L / 3.2) + 1), pts = [];
    for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
      const t = -L / 2 + 0.8 + i * (L - 1.6) / (n - 1), u = s * (D / 2 - 0.6);
      pts.push({ x: cx + (alongX ? t : u), y: g0, z: cz + (alongX ? u : t) });
    }
    instances(host, columnGeo(R, H), STONE, pts, "civic-colonnade-columns");
    for (const p of pts) phys.solid(p.x - 1.36 * R, p.x + 1.36 * R, p.z - 1.36 * R, p.z + 1.36 * R, 0, g0 + 3);
    const E = g0 + H;
    const ww = alongX ? L : D, dd = alongX ? D : L;
    pen.box(STONE, ww, 0.7, dd, cx, E + 0.35, cz);
    pen.box(CAP, ww + 0.5, 0.3, dd + 0.5, cx, E + 0.85, cz);
    pen.box(STONED, ww - 0.3, 0.05, dd - 0.3, cx, E - 0.02, cz);          // the soffit's shadow line
    for (const s of [-1, 1]) {
      pen.box(CAP, alongX ? L + 0.5 : 0.3, 0.7, alongX ? 0.3 : L + 0.5, cx + (alongX ? 0 : s * (dd / 2 + 0.1)), E + 1.35, cz + (alongX ? s * (dd / 2 + 0.1) : 0));
    }
    pen.box(0xa9a397, ww, g0, dd, cx, g0 / 2, cz);
    pen.flush("civic-colonnade");
    phys.dirty();
    return { ground: { x0: o.x0, x1: o.x1, z0: o.z0, z1: o.z1, y: g0 }, top: E + 1.7 };
  }

  CBZ.civicMonument = { portico: portico, dome: dome, colonnade: colonnade, columnGeo: columnGeo };
})();
