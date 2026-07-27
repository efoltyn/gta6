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
    // BLD_ROOF_CLUTTER_V1 — rooftop mechanical plant (HVAC condensers, vent
    // stacks, a timber water tank, aerials, parapet caps). Pure merged deco
    // ABOVE the roof slab: no colliders, so roof loot / helipads / snipers are
    // untouched. OFF → bare roofs, exactly as before.
    if (CBZ.CONFIG.BLD_ROOF_CLUTTER_V1 == null) CBZ.CONFIG.BLD_ROOF_CLUTTER_V1 = true;
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
    const pierN = 4 + ((ctx.hash(0x71a5) * 3) | 0);
    for (const s of sides) {
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
    if (!flag("BLD_MASONRY_V1") || !flag("BLD_CIVIC_PODIUM")) return;
    const { w, d, FH, storeys, doorSide } = ctx;
    const pal = ctx.pal;
    const STONE = pal.stone, SHAFT = shade(pal.stone, 0.98), CAP = shade(pal.stone, 1.08);
    const f = faceOf(ctx, doorSide);
    const spec = ctx.civic || {};

    // A drive-in APPARATUS BAY (the fire house) cannot have a flight of steps
    // and a colonnade across its opening — the engine has to get out. Those
    // buildings keep the pilaster order, entablature and tower but skip the
    // podium entirely, and the column rhythm opens a bay-width gap.
    const driveIn = !!(spec.showroom || ctx.showroom);
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
    if (driveIn) { /* apparatus bay: no podium, no steps, no cheek walls */ }
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
    for (let i = 0; !driveIn && i < nSteps; i++) {
      const th = TERR_TOP * (nSteps - i) / nSteps;
      const dOff = terrD + (i + 0.5) * (stepD / nSteps);
      const td = stepD / nSteps + 0.02;
      if (f.horiz) ctx.dbox(0, th / 2, f.out * (halfN + dOff), sw, th, td, shade(STONE, 0.92 + i * 0.03));
      else ctx.dbox(f.out * (halfN + dOff), th / 2, 0, td, th, sw, shade(STONE, 0.92 + i * 0.03));
    }
    if (!driveIn) {
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
    for (const sg of (driveIn ? [] : [-1, 1])) {
      const t = sg * (sw / 2 + 0.35);
      const cD = terrD + stepD;
      if (f.horiz) {
        ctx.dbox(t, 0.34, f.out * (halfN + cD / 2), 0.55, 0.68, cD, shade(STONE, 0.90));
        ctx.dbox(t, 0.74, f.out * (halfN + cD - 0.4), 0.62, 0.14, 0.66, CAP);
      } else {
        ctx.dbox(f.out * (halfN + cD / 2), 0.34, t, cD, 0.68, 0.55, shade(STONE, 0.90));
        ctx.dbox(f.out * (halfN + cD - 0.4), 0.74, t, 0.66, 0.14, 0.62, CAP);
      }
      ctx.ball(f.horiz ? t : f.out * (halfN + cD - 0.4), 0.98,
        f.horiz ? f.out * (halfN + cD - 0.4) : t, 0.24, CAP);
    }

    // ---------- ENGAGED COLUMN / PILASTER ORDER ----------
    // Runs the full height of the "principal" storeys (all but the attic), so
    // the front reads as one monumental order rather than stacked floors.
    const colBase = driveIn ? 0 : TERR_TOP;   // no podium under an apparatus bay
    // Sized so the ENTABLATURE lands clear BELOW the corbelled cornice
    // bldMasonryDress puts at rTop-0.62 — otherwise a tall order would drive
    // its cornice straight through the roofline trim. Solve backwards from
    // that clearance instead of from the storey count.
    const orderH = Math.max(FH * 1.1, ctx.rTop - colBase - 1.9);
    const round = spec.order === "doric" || spec.order === "ionic";
    const nCol = Math.max(4, Math.min(10, Math.round(f.span / 3.0)));
    const colStep = (f.span - 1.6) / nCol;
    const R = Math.min(0.42, colStep * 0.20);
    for (let i = 0; i <= nCol; i++) {
      const t = -(f.span - 1.6) / 2 + i * colStep;
      if (Math.abs(t) < doorGap / 2 - 0.1) continue;          // keep the doorway clear
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
    faceBox(ctx, f, 0, entY + 0.18, f.span + 0.5, 0.26, 0.34, shade(STONE, 1.00));   // architrave
    faceBox(ctx, f, 0, entY + 0.56, f.span + 0.5, 0.46, 0.30, shade(STONE, 0.94));   // frieze
    faceBox(ctx, f, 0, entY + 0.94, f.span + 0.9, 0.24, 0.52, shade(STONE, 1.08));   // cornice
    // triglyph blocks on a doric frieze (the giveaway detail of the order)
    if (spec.order === "doric") {
      const tn = nCol * 2;
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
    const sealR = pedimented && pw > 3.0 ? Math.min(1.25, pRise * 0.44) : Math.min(1.35, f.span * 0.09);
    const sealY = pedimented && pw > 3.0 ? (entY + 1.18 + pRise * 0.40) : Math.max(DOOR_HEAD, entY - 1.5);
    ctx.seal(f, sealY, sealR, spec.kind || "civic");

    // ---------- FLAGPOLES ----------
    for (const sg of [-1, 1]) {
      const t = sg * (Math.min(f.span / 2 - 0.9, terrW / 2 - 0.9));
      const px = f.horiz ? t : f.out * (halfN + terrD * 0.55);
      const pz = f.horiz ? f.out * (halfN + terrD * 0.55) : t;
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
    // only by their emissive material — 2 small meshes per civic building)
    for (const sg of [-1, 1]) {
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
    if (!flag("BLD_MASONRY_V1") || !flag("BLD_CIVIC_PODIUM")) return;
    const spec = ctx.civic || {};
    const pal = ctx.pal;
    const STONE = pal.stone, CAP = shade(pal.stone, 1.08);
    const cx = ctx.slabCx, cz = ctx.slabCz, top = ctx.rTop + ctx.pp;
    const base = Math.min(ctx.slabW, ctx.slabD);
    if (base < 4) return;

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
  //  5. ROOF CLUTTER — the #2 "buildings look fake" tell after flat facades
  // ============================================================
  // Real roofs are machine yards. Everything here is merged deco ABOVE the
  // roof slab with NO collider and NO platform, so rooftop gameplay (loot,
  // snipers, helipads, the elevator headhouse) is completely unaffected, and
  // a central KEEP-OUT square is left clear for exactly that reason.
  CBZ.bldRoofClutter = function (ctx) {
    if (!flag("BLD_ROOF_CLUTTER_V1")) return;
    if (ctx.garageGround) return;                        // the flagship owns its roof
    const { rTop, slabCx, slabCz, slabW, slabD } = ctx;
    if (slabW < 5 || slabD < 5) return;
    const METAL = 0x8f959c, DARKM = 0x5b626b, RUST = 0x7a5a44, DUCT = 0xa2a8ae;
    const keepR = Math.min(slabW, slabD) * 0.22;         // central keep-out (helipad/loot)
    // deterministic slot grid around the roof perimeter
    const cols = Math.max(2, Math.min(5, Math.round(slabW / 5.5)));
    const rows = Math.max(2, Math.min(5, Math.round(slabD / 5.5)));
    // HARD CAP. This runs on EVERY building in the world, and the tank/mast/
    // vent helpers mint real meshes (not merged dbox geometry), so an uncapped
    // grid would multiply mesh count city-wide for plant nobody stands next to.
    const CAP = ctx.storeys >= 2 ? 5 : 3;
    let placed = 0;
    for (let i = 0; i < cols && placed < CAP; i++) for (let j = 0; j < rows && placed < CAP; j++) {
      const t = ctx.hash(0x4c00 + i * 37 + j * 101);
      const lx = slabCx - slabW / 2 + (i + 0.5) * (slabW / cols);
      const lz = slabCz - slabD / 2 + (j + 0.5) * (slabD / rows);
      if (Math.abs(lx - slabCx) < keepR && Math.abs(lz - slabCz) < keepR) continue;
      if (t < 0.30) continue;                            // leave gaps — a roof isn't a warehouse
      placed++;
      if (t < 0.56) {
        // HVAC condenser: a ribbed box on a low curb with a fan grille on top
        const uw = 1.5 + t * 1.6, ud = 1.2 + t * 1.1, uh = 0.85 + t * 0.5;
        ctx.dbox(lx, rTop + 0.09, lz, uw + 0.3, 0.18, ud + 0.3, DARKM);            // curb
        ctx.dbox(lx, rTop + 0.18 + uh / 2, lz, uw, uh, ud, METAL);
        for (let r2 = 0; r2 < 4; r2++)
          ctx.dbox(lx, rTop + 0.30 + r2 * (uh / 4.6), lz + ud / 2 + 0.02, uw * 0.82, 0.06, 0.05, DARKM);  // fins
        ctx.dbox(lx, rTop + 0.18 + uh + 0.05, lz, uw * 0.62, 0.10, ud * 0.62, DARKM);                     // fan grille
        ctx.dbox(lx, rTop + 0.18 + uh + 0.14, lz, uw * 0.20, 0.08, ud * 0.20, 0x2f343a);                  // hub
      } else if (t < 0.72) {
        // VENT STACK cluster: three pipes of different heights with cowls
        for (let p = 0; p < 3; p++) {
          const px = lx + (p - 1) * 0.55, ph = 0.7 + ((p * 7 + (t * 100 | 0)) % 5) * 0.28;
          ctx.column(px, rTop + 0.02, lz, 0.14, ph, METAL, 8);
          ctx.dbox(px, rTop + 0.02 + ph + 0.07, lz, 0.42, 0.14, 0.42, DARKM);
        }
      } else if (t < 0.84) {
        // ROOFTOP DUCTWORK: a run of square duct on short legs, with a bend
        const len = Math.min(slabW, slabD) * 0.35;
        ctx.dbox(lx, rTop + 0.72, lz, len, 0.5, 0.5, DUCT);
        ctx.dbox(lx + len / 2 - 0.25, rTop + 0.72, lz + 0.9, 0.5, 0.5, 1.8, DUCT);
        for (let g2 = -1; g2 <= 1; g2 += 2)
          ctx.dbox(lx + g2 * (len / 2 - 0.4), rTop + 0.24, lz, 0.14, 0.48, 0.14, DARKM);
      } else if (t < 0.93) {
        // WATER TANK: timber-staved cylinder on a steel frame — the New York
        // rooftop silhouette, and the single most recognisable roof object.
        const tr = 1.05, legH = 1.5;
        for (const sx of [-1, 1]) for (const sz of [-1, 1])
          ctx.dbox(lx + sx * tr * 0.62, rTop + legH / 2, lz + sz * tr * 0.62, 0.16, legH, 0.16, DARKM);
        ctx.dbox(lx, rTop + legH + 0.08, lz, tr * 2, 0.16, tr * 2, DARKM);
        ctx.column(lx, rTop + legH + 0.16, lz, tr, 2.5, RUST, 14);
        for (let h2 = 0; h2 < 3; h2++)
          ctx.column(lx, rTop + legH + 0.5 + h2 * 0.8, lz, tr + 0.05, 0.12, 0x4a4e54, 14);   // steel hoops
        ctx.cone(lx, rTop + legH + 2.66, lz, tr + 0.1, 0.7, shade(RUST, 0.85));
      } else {
        // AERIAL MAST + satellite dish
        ctx.column(lx, rTop + 0.02, lz, 0.09, 3.4, METAL, 6);
        for (let a2 = 0; a2 < 3; a2++)
          ctx.dbox(lx, rTop + 1.4 + a2 * 0.7, lz, 1.1 - a2 * 0.22, 0.06, 0.06, METAL);
        ctx.dbox(lx + 0.8, rTop + 0.42, lz, 0.7, 0.06, 0.7, 0xd7dbe0);
        ctx.dbox(lx + 0.8, rTop + 0.20, lz, 0.16, 0.44, 0.16, DARKM);
      }
    }
    // a service DOOR HOOD + a low skylight lantern if anything else landed
    if (placed) {
      ctx.dbox(slabCx + slabW * 0.30, rTop + 0.06, slabCz - slabD * 0.30, 1.5, 0.12, 1.5, 0xd7dbe0);
      ctx.dbox(slabCx + slabW * 0.30, rTop + 0.20, slabCz - slabD * 0.30, 1.2, 0.16, 1.2, 0xeef4f8);
    }
  };

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
