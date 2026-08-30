/* ============================================================
   warlord/territory.js — WHO OWNS WHAT, AND THE MAP THAT SHOWS IT.

   THE ASK, in the owner's words: "a multiplayer option like open front.io".
   OpenFront is not a lobby feature. It is ONE PICTURE — a map where you can
   see who owns what and watch it change — and everything else in that game
   is a consequence of that picture existing. So this file does not build a
   netcode; warnet.js does that. This file builds the picture, and the state
   underneath it that makes the picture worth looking at.

   WHAT THIS FILE OWNS
     · REGIONS      the island cut into ~22 holdings, derived from its own
                    geography and from the seed alone
     · OWNERSHIP    who holds each one: you, one of core's five factions, or
                    nobody
     · THE ECONOMY  what a holding pays you at dawn, and what its garrison
                    costs you — the thing that finally makes core's wage
                    brake survivable at scale
     · THE WAR      the five factions taking ground off each other every
                    dawn, abstractly but visibly, so the island is a world
                    and not a set of encounters arranged around the player
     · THE MAP      the full-screen strategic map. This is the deliverable.

   WHY THE REGIONS ARE NOT A GRID. A hex or square grid on a desert reads as
   a spreadsheet — and worse, it makes every region interchangeable, which is
   the death of "I want THAT one". So the island cuts itself up: every oasis
   is the seed of a holding ("the water and the ground that drinks from it"),
   and the rest of the land is divided between anchors dropped on a
   low-discrepancy spiral and rejected until they are far enough apart. A
   point belongs to the nearest anchor AFTER a two-octave warp is applied to
   its coordinates, which is what turns straight Voronoi walls into borders
   that wander like real frontiers. Nothing here is drawn by hand and nothing
   is stored on disk: it is a pure function of `W.state.seed`.

   THAT IS ALSO THE MULTIPLAYER DESIGN. warnet.js syncs a shared island by
   sharing one integer. If the regions were rolled at runtime, every client
   would compute a different map and the whole thing would need the geometry
   on the wire. Because they are derived, the ONLY thing that ever has to be
   sent is ownership — `snapshot()` is a string of one character per region.

   WHY THE MAP SCREEN AND NOT campaign.js's. campaign.js already had a world
   map (#wlMap): the painted island with dots on it, opened by its MAP
   button. Two maps in one game is exactly the drift CLAUDE.md warns about,
   so this file does not add a second one — it TAKES THE BUTTON. A capture
   listener on the way down swallows the click and opens this screen instead;
   `?terrmap=old` gives the button back. Nothing in campaign.js was edited.

   PUBLISHED SURFACE
     W.territory.regions[]           {id,name,kind,x,z,areaKm2,wells,...}
     W.territory.at(x, z)            region under a world point, or null
     W.territory.byId(id)
     W.territory.owner(regionId)     "you" | faction id | null
     W.territory.claim(id, ownerId)  <- battle.js / campaign.js / warnet.js
     W.territory.claimAt(x, z, ownerId)
     W.territory.onBattleWon(report) <- army.js, one call, see the report
     W.territory.income(ownerId)     $/dawn, derived
     W.territory.held(ownerId)       [region]
     W.territory.strengthOf(ownerId)
     W.territory.open() close() toggle()
     W.territory.snapshot() apply(s) <- warnet.js
     W.territory.autoWar(bool)       <- warnet.js: clients do not simulate
     W.territory.audit()

   EVENTS EMITTED
     territory:ready   {regions:n}       the map has been derived
     territory:claim   {region, from, to} ownership changed, any cause
     territory:dawn    {income, paid, flips}
     territory:open  territory:close

   FLAGS (repo doctrine — every behaviour switch has a revert)
     ?terr=off        no regions, no income, no war, campaign keeps its map.
                      The honest "before" for the A/B tool.
     ?terrwar=off     regions and income, but the factions never move
     ?terrmap=old     campaign.js's flat map back on the MAP button
     ?map=1           open the strategic map straight from boot, with a
                      plausible ownership spread. ?map=1&stage=day1|mid|late
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});

  const QP = (function () {
    try { return new URLSearchParams(G.location ? G.location.search : ""); }
    catch (e) { return { get: function () { return null; } }; }
  })();
  const FLAG_OFF = QP.get("terr") === "off";
  const FLAG_NOWAR = QP.get("terrwar") === "off";
  const FLAG_OLDMAP = QP.get("terrmap") === "old";

  const T = W.territory = W.territory || {};
  const TAU = Math.PI * 2;
  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  const S = function () { return W.state; };

  /* ============================================================ COLOUR
     One conversion, used by the map, the labels and the cards. Faction
     colours are core's — this file is not allowed to have an opinion about
     what a Desert Legion looks like. */
  const YOU_COLOUR = 0xff8a3d;          // the shell's --hot. You are the orange one.
  const NONE_COLOUR = 0x6b6154;
  function ownerColour(id) {
    if (id === "you") return YOU_COLOUR;
    if (!id) return NONE_COLOUR;
    const f = W.faction ? W.faction(id) : null;
    return (f && f.colour) || NONE_COLOUR;
  }
  function ownerLabel(id) {
    if (id === "you") return (S().you && S().you.name) || "YOU";
    if (!id) return "UNCLAIMED";
    const f = W.faction ? W.faction(id) : null;
    return (f && f.label) || String(id).toUpperCase();
  }
  function hex(c) { return "#" + ("000000" + ((c | 0) >>> 0).toString(16)).slice(-6); }
  function rgba(c, a) {
    const n = c | 0;
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  // every owner id in a fixed order — the wire format indexes into this
  function ownerIds() {
    const out = ["you"];
    const F = W.FACTIONS || [];
    for (let i = 0; i < F.length; i++) out.push(F[i].id);
    return out;
  }

  /* ============================================================ NOISE
     A tiny value-noise pair, only ever used to WARP the region lookup so
     borders wander. It is built on W.hash01 rather than desert.js's private
     h2 because this runs 100k times at generate and never again, and reusing
     the public hash means the warp is identical in Node and in the browser —
     which is the whole determinism claim. The seed is folded into the salt,
     so a different island gets different frontiers. */
  let NSALT = 0;
  function vn(x, z, scale, salt) {
    const fx = x / scale, fz = z / scale;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
    const s = (salt + NSALT) | 0;
    const a = W.hash01(ix, iz, s), b = W.hash01(ix + 1, iz, s);
    const c = W.hash01(ix, iz + 1, s), d = W.hash01(ix + 1, iz + 1, s);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz;
  }
  /* TWO OCTAVES, AND THE SECOND ONE IS THE POINT. One octave gives borders
     that bulge in smooth arcs — better than straight lines, still obviously
     mathematical. The 380 m octave puts a kink in them at the scale a player
     reads on the map, which is what makes a frontier look like it was fought
     over rather than drawn. */
  function warpX(x, z) { return x + (vn(x, z, 1500, 9001) - 0.5) * 900 + (vn(x, z, 380, 9013) - 0.5) * 260; }
  function warpZ(x, z) { return z + (vn(x, z, 1500, 9007) - 0.5) * 900 + (vn(x, z, 380, 9019) - 0.5) * 260; }

  /* ============================================================ NAMES
     A region with no name is a number, and a number is not somewhere you
     want. Nouns come from what the ground actually IS (desert.js's own biome
     string), the qualifier from where it sits, so the name teaches you the
     map: THE NORTH MESAS is in the north and is mesas. */
  const NOUNS = {
    rock:   ["MESAS", "THE BUTTES", "STONE TABLE", "RED ROCK"],
    salt:   ["SALT PAN", "THE WHITE FLAT", "BITTER PAN"],
    dune:   ["GREAT ERG", "DUNE SEA", "THE SANDS", "LONG DUNES"],
    wadi:   ["THE WADI", "DRY RIVER", "THE CUT"],
    gravel: ["HARDPAN", "GRAVEL PLAIN", "THE FLATS", "STONY GROUND"],
    shore:  ["SHORE", "THE COAST", "LANDING", "SALT BEACH"],
    oasis:  ["OASIS"],
    sea:    ["THE SHALLOWS"],
  };
  function bearingWord(x, z) {
    const r = Math.hypot(x, z);
    const D = W.desert;
    const R = (D && D.RADIUS) || 6700;
    if (r < R * 0.3) return "INNER";
    const a = Math.atan2(x, -z);              // 0 = north, clockwise
    const k = Math.round(a / (TAU / 8) + 8) % 8;
    return ["NORTH", "NORTH-EAST", "EAST", "SOUTH-EAST", "SOUTH", "SOUTH-WEST", "WEST", "NORTH-WEST"][k];
  }

  /* ============================================================ REGIONS */
  const REG = [];                 // the published array — same object, always
  T.regions = REG;

  let GS = QP.get("regions") === "coarse" ? 160 : 320;   // raster cells across the island
  let cellRegion = null;          // Int16Array, -1 = sea
  let BOUNDS = 8300, CELL = 1;
  let segs = null;                // border segments: {x1,z1,x2,z2,a,b,axis}
  let builtSeed = null;
  let ISLAND_MEN = 0;

  /* ONE TYPED NUMBER IN THIS FILE. Everything else — every region's income,
     every garrison it can hold, the whole map economy — is derived from it.

     AN OASIS FEEDS A HUNDRED MEN. That is a design statement, not a
     measurement, and it is stated in the same voice core.js uses for "you
     are worth fourteen men": it has to be big enough that taking an oasis
     changes what army you can afford (a hundred levies at wage 1 is $100 a
     dawn, and core's whole mid-game brake is that wage), and small enough
     that one oasis is not the game. Seven oases on the island puts the
     island's total carrying capacity near 1400 men once every acre is held,
     which pays for about 350 SOLDIERS at wage 4 — an army the size of the
     biggest thing core's band roller will ever spawn. That is the ceiling
     the whole campaign is aimed at, and it comes out of this one number. */
  const MEN_PER_OASIS = 100;
  /* The land that drinks feeds, ISLAND-WIDE, exactly as many men as the
     water does — so the per-km² figure is not typed at all, it is solved for
     at generate time against the arable area this particular seed produced.
     A seed with a lot of wadi therefore does not quietly inflate the
     economy; it spreads the same total over more ground. */
  let MEN_PER_ARABLE_KM2 = 0;
  /* A market feeds a quarter of what water does. Trade is real here — the
     depots are where the guns are — but a warlord who holds the shops and no
     wells still starves, which is the sentence this ratio is written to say. */
  const MEN_PER_POST = MEN_PER_OASIS / 4;

  function desertReady() {
    const D = W.desert;
    return !!(D && D.coastAt && D.biomeAt && D.oases);
  }

  /* THE ANCHORS. Oases first, always, because "the oasis and the ground that
     drinks from it" is the one region shape the island hands you for free.
     Then a golden-angle spiral over the disc, accepting a point if it is on
     land and no nearer than `sep` to anything already accepted. The spiral
     rather than a random scatter because rejection sampling with W.rnd()
     would make the anchor set depend on how many times anything else rolled
     the dice first, and that is not a seed-derived map, it is a lucky one. */
  const TARGET_REGIONS = 22;      // about twenty labels is what a phone map holds
  function buildAnchors(D) {
    const anchors = [];
    const O = D.oases || [];
    for (let i = 0; i < O.length; i++) {
      anchors.push({ x: O[i].x, z: O[i].z, kind: "oasis", name: O[i].name, oasis: O[i].id,
                     /* an oasis holding is TIGHT: the ground that drinks from
                        one well is not a third of a desert. The weight
                        divides the distance, so <1 pulls the border in. */
                     w: 0.72 });
    }
    // measure the land radius this seed actually produced, so `sep` is not a
    // guess that leaves five regions on a small island and forty on a big one
    let land = 0, tries = 0;
    const R = D.RADIUS || 6700;
    for (let i = 0; i < 1200; i++) {
      const a = i * 2.399963, r = Math.sqrt((i + 0.5) / 1200) * R * 1.15;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      tries++;
      if (D.coastAt(x, z) > 0) land++;
    }
    const landArea = Math.PI * Math.pow(R * 1.15, 2) * (land / Math.max(1, tries));
    const want = Math.max(8, TARGET_REGIONS - anchors.length);
    let sep = Math.sqrt(landArea / TARGET_REGIONS) * 1.02;

    for (let pass = 0; pass < 6 && anchors.length < TARGET_REGIONS; pass++) {
      for (let i = 0; i < 3000 && anchors.length < TARGET_REGIONS; i++) {
        const a = i * 2.399963, r = Math.sqrt((i + 0.5) / 3000) * R * 1.06;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (D.coastAt(x, z) < 90) continue;         // not a sandbar
        let clash = false;
        for (let k = 0; k < anchors.length; k++) {
          const d = Math.hypot(anchors[k].x - x, anchors[k].z - z);
          if (d < sep * (anchors[k].kind === "oasis" ? 0.82 : 1)) { clash = true; break; }
        }
        if (clash) continue;
        anchors.push({ x: x, z: z, kind: D.biomeAt(x, z), name: null, oasis: null, w: 1 });
      }
      sep *= 0.86;                                   // relax and try again
    }
    void want;
    return anchors;
  }

  function nameAnchors(anchors) {
    const used = {};
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (a.name) { used[a.name] = 1; continue; }
      const pool = NOUNS[a.kind] || NOUNS.gravel;
      const bear = bearingWord(a.x, a.z);
      let name = null;
      for (let k = 0; k < pool.length * 2 && !name; k++) {
        const noun = pool[(Math.floor(W.hash01(a.x, a.z, 4400 + k) * pool.length) + k) % pool.length];
        const cand = (k < pool.length ? bear + " " + noun : noun);
        if (!used[cand]) name = cand;
      }
      if (!name) name = bear + " " + (pool[0] || "GROUND") + " II";
      used[name] = 1;
      a.name = name;
    }
  }

  /* THE RASTER. `at(x,z)` reads this and nothing else, which is the only way
     to guarantee the map and the game agree about where a border is: the
     picture IS the lookup table. 320 cells across 16.6 km is 52 m a cell —
     finer than a warband is wide, and 100k nearest-anchor tests, which
     measured at well under a fifth of a second here. */
  function rasterise(anchors) {
    const D = W.desert;
    BOUNDS = D.BOUNDS || 8300;
    CELL = (BOUNDS * 2) / GS;
    cellRegion = new Int16Array(GS * GS);
    const n = anchors.length;
    const ax = new Float32Array(n), az = new Float32Array(n), aw = new Float32Array(n);
    for (let i = 0; i < n; i++) { ax[i] = anchors[i].x; az[i] = anchors[i].z; aw[i] = anchors[i].w; }
    for (let j = 0; j < GS; j++) {
      const z = -BOUNDS + (j + 0.5) * CELL;
      for (let k = 0; k < GS; k++) {
        const x = -BOUNDS + (k + 0.5) * CELL;
        if (D.coastAt(x, z) <= 0) { cellRegion[j * GS + k] = -1; continue; }
        const wx = warpX(x, z), wz = warpZ(x, z);
        let best = 0, bd = 1e18;
        for (let i = 0; i < n; i++) {
          const dx = wx - ax[i], dz = wz - az[i];
          const d = (dx * dx + dz * dz) * aw[i];
          if (d < bd) { bd = d; best = i; }
        }
        cellRegion[j * GS + k] = best;
      }
    }
  }

  /* WHAT EACH REGION IS MADE OF. Area and arable fraction are counted off the
     raster (biome sampled on a 3×3 stride — a fraction does not need every
     cell and biomeAt is the expensive call in the loop). */
  function measure(anchors) {
    const D = W.desert;
    const cellKm2 = (CELL * CELL) / 1e6;
    const cells = new Int32Array(anchors.length);
    const arable = new Int32Array(anchors.length);
    const sampled = new Int32Array(anchors.length);
    const sx = new Float64Array(anchors.length), sz = new Float64Array(anchors.length);
    for (let j = 0; j < GS; j++) {
      const z = -BOUNDS + (j + 0.5) * CELL;
      for (let k = 0; k < GS; k++) {
        const r = cellRegion[j * GS + k];
        if (r < 0) continue;
        cells[r]++;
        const x = -BOUNDS + (k + 0.5) * CELL;
        sx[r] += x; sz[r] += z;
        if ((j % 3) || (k % 3)) continue;
        sampled[r]++;
        const b = D.biomeAt(x, z);
        // THE GROUND THAT DRINKS. Only these three hold water a man can use:
        // an oasis bowl, a wadi floor (the water table is metres down, not
        // hundreds) and the shore strip. Erg and salt pan feed nobody, which
        // is exactly why the map is worth fighting over unevenly.
        if (b === "oasis" || b === "wadi" || b === "shore") arable[r]++;
      }
    }
    let totalArableKm2 = 0;
    for (let i = 0; i < anchors.length; i++) {
      const f = sampled[i] ? arable[i] / sampled[i] : 0;
      totalArableKm2 += f * cells[i] * cellKm2;
    }
    const wells = (D.oases || []).length;
    MEN_PER_ARABLE_KM2 = totalArableKm2 > 0.01 ? (wells * MEN_PER_OASIS) / totalArableKm2 : 0;

    REG.length = 0;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const areaKm2 = cells[i] * cellKm2;
      const f = sampled[i] ? arable[i] / sampled[i] : 0;
      let nWells = 0;
      const O = D.oases || [];
      for (let k = 0; k < O.length; k++) if (rawAt(O[k].x, O[k].z) === i) nWells++;
      REG.push({
        id: "r" + i, idx: i,
        name: a.name, kind: a.kind,
        x: a.x, z: a.z,
        // the LABEL point is the region's centre of mass, not the anchor: an
        // anchor sitting on a coastal lobe put three names in the sea
        lx: cells[i] ? sx[i] / cells[i] : a.x,
        lz: cells[i] ? sz[i] / cells[i] : a.z,
        areaKm2: areaKm2, arable: f, wells: nWells,
        neighbours: [],
      });
    }
  }

  // raw index lookup, used during generate before REG exists
  function rawAt(x, z) {
    if (!cellRegion) return -1;
    const k = Math.floor((x + BOUNDS) / CELL), j = Math.floor((z + BOUNDS) / CELL);
    if (k < 0 || j < 0 || k >= GS || j >= GS) return -1;
    return cellRegion[j * GS + k];
  }

  /* BORDERS AND NEIGHBOURS IN ONE PASS. Every cell compares with the cell to
     its right and the cell below; a mismatch is a frontier segment (in world
     metres, so it survives any zoom) and a neighbour link. Segments carry
     BOTH region indices because the map draws a border in each side's own
     colour, offset half a stroke each way — the thing that makes OpenFront's
     map readable at a glance is that a border tells you who is on both sides
     of it, not just that there is one. */
  function edges() {
    const list = [];
    const seen = {};
    function link(a, b) {
      const key = a < b ? a + "," + b : b + "," + a;
      if (seen[key]) return;
      seen[key] = 1;
      REG[a].neighbours.push(REG[b].id);
      REG[b].neighbours.push(REG[a].id);
    }
    for (let j = 0; j < GS; j++) {
      for (let k = 0; k < GS; k++) {
        const a = cellRegion[j * GS + k];
        const x0 = -BOUNDS + k * CELL, z0 = -BOUNDS + j * CELL;
        if (k + 1 < GS) {
          const b = cellRegion[j * GS + k + 1];
          if (b !== a) {
            list.push({ x1: x0 + CELL, z1: z0, x2: x0 + CELL, z2: z0 + CELL, a: a, b: b, ax: 0 });
            if (a >= 0 && b >= 0) link(a, b);
          }
        }
        if (j + 1 < GS) {
          const b = cellRegion[(j + 1) * GS + k];
          if (b !== a) {
            list.push({ x1: x0, z1: z0 + CELL, x2: x0 + CELL, z2: z0 + CELL, a: a, b: b, ax: 1 });
            if (a >= 0 && b >= 0) link(a, b);
          }
        }
      }
    }
    segs = list;
  }

  let generating = false;
  function generate(force) {
    if (FLAG_OFF && !force) return false;
    if (!desertReady()) return false;
    const seed = (S().seed | 0);
    if (builtSeed === seed && REG.length && !force) return true;
    if (generating) return false;
    generating = true;
    try {
      const D = W.desert;
      /* THE ISLAND MUST BE THIS SEED'S ISLAND BEFORE WE CUT IT UP. desert.js
         defaults to SEED 1337 until somebody builds it, and campaign.enter()
         is what normally does that — the map screen can be opened before the
         player has ever ridden, so reseed here too. It is a no-op if the
         island is already this seed. */
      if (D.reseed) D.reseed(seed);
      NSALT = (Math.imul(seed, 2654435761) >>> 3) & 0x3fffff;
      const t0 = (G.performance && G.performance.now) ? G.performance.now() : 0;
      const anchors = buildAnchors(D);
      nameAnchors(anchors);
      rasterise(anchors);
      measure(anchors);
      edges();
      builtSeed = seed;
      ISLAND_MEN = 0;
      for (let i = 0; i < REG.length; i++) ISLAND_MEN += supportOf(REG[i]);
      ensureOwnState(true);
      const t1 = (G.performance && G.performance.now) ? G.performance.now() : 0;
      try {
        console.log("[warlord/territory]", REG.length, "regions, seed", seed,
                    "in", Math.round(t1 - t0), "ms");
      } catch (e) {}
      W.emit("territory:ready", { regions: REG.length, seed: seed });
      return true;
    } finally { generating = false; }
  }
  function ensure() { if (!REG.length || builtSeed !== (S().seed | 0)) generate(); return REG.length > 0; }

  /* ============================================================ THE STATE
     Ownership lives in W.state, so it saves, loads and serialises with
     everything else — core.js's rule, and the reason a region's garrison is
     a REAL roster of core soldiers rather than a number. The men you leave
     behind are men, with names, that you can take back.

     `gp` is the same thing for somebody ELSE's garrison: a network peer
     sends you strength, not thirty names, and the map only needs a number to
     draw. Real roster wins when there is one. */
  function tState() {
    const s = S();
    if (!s.territory) s.territory = { own: {}, gar: {}, gp: {}, taken: {}, press: {} };
    const t = s.territory;
    if (!t.own) t.own = {};
    if (!t.gar) t.gar = {};
    if (!t.gp) t.gp = {};
    if (!t.taken) t.taken = {};
    if (!t.press) t.press = {};
    return t;
  }

  /* DAY ONE: EVERY FACTION HOLDS ITS ONE HOME, AND NOBODY HOLDS ANYTHING
     ELSE. That is the picture the brief asks for on day one — a mostly empty
     island — and it is also the honest starting position for a game whose
     whole arc is that the map fills in. Which region is whose is hashed off
     the seed and the faction id, so every client agrees without a message,
     and a faction is pushed to the anchor furthest from the ones already
     placed so the five of them start spread out rather than in a huddle. */
  function ensureOwnState(reset) {
    const t = tState();
    if (!reset && Object.keys(t.own).length) return;
    if (reset) { t.own = {}; t.gar = {}; t.gp = {}; t.taken = {}; t.press = {}; }
    const F = W.FACTIONS || [];
    const placed = [];
    for (let i = 0; i < F.length; i++) {
      let best = -1, bs = -1;
      for (let r = 0; r < REG.length; r++) {
        if (t.own[REG[r].id]) continue;
        // hash gives the taste, distance-from-placed gives the spread
        let far = 1e9;
        for (let p = 0; p < placed.length; p++) far = Math.min(far, Math.hypot(REG[r].x - placed[p].x, REG[r].z - placed[p].z));
        if (!placed.length) far = 4000;
        const score = W.hash01(REG[r].x, REG[r].z, 7700 + i) * 2600 + Math.min(far, 6000);
        if (score > bs) { bs = score; best = r; }
      }
      if (best < 0) break;
      t.own[REG[best].id] = F[i].id;
      t.taken[REG[best].id] = 1;
      placed.push(REG[best]);
    }
  }

  T.at = function (x, z) {
    if (!ensure()) return null;
    const i = rawAt(x, z);
    return i < 0 ? null : REG[i];
  };
  T.byId = function (id) {
    for (let i = 0; i < REG.length; i++) if (REG[i].id === id) return REG[i];
    return null;
  };
  T.owner = function (id) { ensure(); return tState().own[id] || null; };
  T.held = function (ownerId) {
    ensure();
    const t = tState(), out = [];
    for (let i = 0; i < REG.length; i++) if ((t.own[REG[i].id] || null) === (ownerId || null)) out.push(REG[i]);
    return out;
  };

  /* ============================================================ THE MONEY
     A region pays the wages of the men it can feed, and nothing else. There
     is no tax rate, no build queue and no second currency: the number IS
     core's payroll unit, which is what makes "I hold six regions" and "I can
     field ninety soldiers" the same sentence. */
  function supportOf(r) {
    let posts = 0;
    const O = S().outposts || [];
    for (let i = 0; i < O.length; i++) if (rawAt(O[i].x, O[i].z) === r.idx) posts++;
    return r.wells * MEN_PER_OASIS
         + r.arable * r.areaKm2 * MEN_PER_ARABLE_KM2
         + posts * MEN_PER_POST;
  }
  const LEVY_WAGE = function () { return (W.tier ? W.tier("levy").wage : 1) || 1; };
  T.regionIncome = function (r) {
    if (!r) return 0;
    return Math.round(supportOf(r) * LEVY_WAGE());
  };
  T.income = function (ownerId) {
    ensure();
    const held = T.held(ownerId == null ? "you" : ownerId);
    let n = 0;
    for (let i = 0; i < held.length; i++) n += T.regionIncome(held[i]);
    return n;
  };

  function garrison(id) { return tState().gar[id] || null; }
  T.garrison = garrison;
  T.garrisonPower = function (id) {
    const men = garrison(id);
    if (men && men.length) return W.power(men);
    return tState().gp[id] || 0;
  };
  T.garrisonSize = function (id) {
    const men = garrison(id);
    if (men) return men.length;
    const p = tState().gp[id] || 0;
    // a remote garrison arrives as strength; turn it back into a headcount
    // with core's own soldier power so both maps draw the same size dot
    return p > 0 ? Math.max(1, Math.round(p / 4.2)) : 0;
  };
  function garrisonPayroll(id) {
    const men = garrison(id);
    if (!men) return 0;
    let n = 0;
    for (let i = 0; i < men.length; i++) n += W.tier(men[i].tier).wage;
    return n;
  }

  /* ============================================================ CLAIMING */
  T.claim = function (regionId, ownerId, opts) {
    if (!ensure()) return false;
    const r = T.byId(regionId);
    if (!r) return false;
    const t = tState();
    const from = t.own[regionId] || null;
    const to = ownerId || null;
    if (from === to) return false;
    t.own[regionId] = to;
    if (!to) delete t.own[regionId];
    t.taken[regionId] = S().day;
    delete t.press[regionId];
    /* THE GARRISON DIES WITH THE HOLDING. Men you left in a region that was
       taken off you are gone — that is the entire reason garrisoning is a
       decision and not free insurance. They are logged by name count so the
       loss reads as a loss. */
    const lost = (t.gar[regionId] || []).length;
    delete t.gar[regionId];
    delete t.gp[regionId];
    if (!(opts && opts.quiet)) {
      const verb = from ? "took " + r.name + " from " + ownerLabel(from) : "claimed " + r.name;
      W.log(ownerLabel(to) + " " + verb + ".", to === "you" ? "good" : from === "you" ? "bad" : "");
      if (lost && from === "you") W.log(lost + " men of your garrison were lost with it.", "bad");
    }
    W.emit("territory:claim", { region: r, from: from, to: to });
    repaintSoon();
    return true;
  };
  T.claimAt = function (x, z, ownerId, opts) {
    const r = T.at(x, z);
    return r ? T.claim(r.id, ownerId, opts) : false;
  };

  /* WHAT army.js / battle.js CALLS. One function, and it takes the aftermath
     report exactly as army.js already builds it — outcome, and the band you
     beat. YOU TAKE GROUND BY BEATING THE FORCE THAT HOLDS IT: the region
     flips only if the band you just destroyed belonged to the faction that
     owned it, or if the ground was unclaimed. Beating a bandit crew that
     wandered into Legion land does not hand you the Legion's province, which
     is the rule that stops the map falling over in the first hour. */
  T.onBattleWon = function (report) {
    if (!ensure() || !report) return null;
    const won = report.outcome === "won" || report.outcome === "surrender";
    if (!won) return null;
    const b = report.band;
    const x = b ? b.x : (report.x != null ? report.x : S().you.x);
    const z = b ? b.z : (report.z != null ? report.z : S().you.z);
    const r = T.at(x, z);
    if (!r) return null;
    const holder = T.owner(r.id);
    const theirs = b ? b.faction : null;
    if (holder && holder !== theirs) return null;         // wrong enemy, wrong ground
    if (holder === "you") return null;
    T.claim(r.id, "you");
    W.toast(r.name + " IS YOURS", "good");
    return r;
  };

  /* ============================================================ THE WAR
     Resolved abstractly — no simulated battles between two AI factions,
     because nobody is watching them and a hundred rolled skirmishes a dawn
     is a hundred log lines nobody reads. What matters is that the map CHANGES
     and the log says who took what from whom.

     A faction's strength is what it holds plus what it has walking around:
     the income of its regions (which is the men that ground feeds) plus the
     real power of its real bands on the map. Nothing invented. */
  function strengthOf(ownerId) {
    let n = T.income(ownerId);
    const B = S().bands || [];
    for (let i = 0; i < B.length; i++) {
      if (ownerId === "you") continue;
      if (B[i].faction === ownerId) n += W.bandPower(B[i]) * 0.5;
    }
    if (ownerId === "you") n += W.yourPower();
    return n;
  }
  T.strengthOf = strengthOf;

  /* WHAT A REGION IS WORTH DEFENDING WITH. Garrison first, because that is
     the player's lever. Then the ground itself: a holding raises its own
     levies, and the number of them is the income again — so a rich province
     is genuinely harder to take than a stretch of erg, without a "defence"
     stat existing anywhere. And a very recent capture is brittle: the week
     after you take somewhere is when you lose it. */
  function defenceOf(r) {
    const t = tState();
    const own = t.own[r.id] || null;
    if (!own) return T.regionIncome(r) * 0.35;             // nobody's — thin local levies
    let d = T.garrisonPower(r.id) + T.regionIncome(r) * 0.9;
    const took = t.taken[r.id] || 0;
    const settled = clamp((S().day - took) / 6, 0, 1);
    d *= 0.55 + 0.45 * settled;
    if (own === "you" && Math.hypot(S().you.x - r.x, S().you.z - r.z) < 1400) {
      d += W.yourPower();                                  // you are standing in it
    }
    return d;
  }
  T.defenceOf = defenceOf;

  function pressureOn(r) {
    const t = tState();
    const own = t.own[r.id] || null;
    let best = null, bs = 0;
    const tally = {};
    for (let i = 0; i < r.neighbours.length; i++) {
      const nOwn = t.own[r.neighbours[i]] || null;
      if (!nOwn || nOwn === own) continue;
      tally[nOwn] = (tally[nOwn] || 0) + 1;
    }
    const keys = Object.keys(tally);
    for (let i = 0; i < keys.length; i++) {
      /* A FACTION ONLY BRINGS WHAT IT CAN REACH. Its full strength times the
         share of this region's frontier it actually stands on — which is
         what stops a faction on the far shore from threatening everything at
         once, and what makes a salient with three enemy neighbours the thing
         that falls. */
      const share = tally[keys[i]] / Math.max(1, r.neighbours.length);
      const s = strengthOf(keys[i]) * (0.35 + 0.65 * share);
      if (s > bs) { bs = s; best = keys[i]; }
    }
    return best ? { owner: best, force: bs } : null;
  }
  T.pressureOn = pressureOn;

  let WAR_ON = true;
  T.autoWar = function (on) { if (on != null) WAR_ON = !!on; return WAR_ON; };

  /* ONE DAWN OF THE WAR. Every region is looked at once; at most a few
     change hands. The cap is not decoration: without it a strong faction
     flipped nine regions on one dawn and the log became unreadable, and a
     map that changes that fast cannot be planned against. Three flips on a
     twenty-two region island is one visible move a day, which is what a
     strategy map should feel like between sessions. */
  function warDawn() {
    const t = tState();
    const flips = [];
    const cap = Math.max(2, Math.round(REG.length / 8));
    /* WEAKEST FIRST. Sorting by how badly a region is outmatched means the
       flips that happen are the ones the player could see coming from the
       map, rather than three arbitrary ones out of nine equally likely. */
    const cand = [];
    for (let i = 0; i < REG.length; i++) {
      const r = REG[i];
      const p = pressureOn(r);
      if (!p) { delete t.press[r.id]; continue; }
      const d = defenceOf(r);
      const odds = W.odds(p.force, d);
      const own = t.own[r.id] || null;
      if (own === "you") t.press[r.id] = odds > 0.5 ? (t.press[r.id] || 0) + 1 : 0;
      cand.push({ r: r, p: p, odds: odds, own: own });
    }
    cand.sort(function (a, b) { return b.odds - a.odds; });
    for (let i = 0; i < cand.length && flips.length < cap; i++) {
      const c = cand[i];
      /* THE ROLL, and it is deliberately not "odds > 0.5 wins". A front that
         is 55/45 should move sometimes and not every single dawn, or the map
         oscillates and every border is noise. Squaring the odds is what makes
         a marginal advantage take a week and an overwhelming one take a day. */
      if (!W.chance(c.odds * c.odds * 0.9)) continue;
      if (c.own === "you") {
        /* YOUR GROUND GETS ONE WARNING. The dawn a region first reads as lost
           it only wobbles; it falls on the second. Without that, a player who
           was in a battle when the front moved simply finds a province gone
           with no way to have known, and "conquer everything and idle" gets
           replaced by "conquer everything and be punished at random". */
        if ((t.press[c.r.id] || 0) < 2) {
          W.log(ownerLabel(c.p.owner) + " is massing on " + c.r.name + ".", "bad");
          continue;
        }
      }
      T.claim(c.r.id, c.p.owner);
      flips.push({ region: c.r.id, to: c.p.owner });
    }
    return flips;
  }

  /* ============================================================ DAWN */
  function dawn() {
    if (FLAG_OFF) return;
    if (!ensure()) return;
    const t = tState();
    const mine = T.held("you");
    let income = 0, paid = 0, men = 0;
    for (let i = 0; i < mine.length; i++) {
      income += T.regionIncome(mine[i]);
      paid += garrisonPayroll(mine[i].id);
      men += T.garrisonSize(mine[i].id);
    }
    const net = income - paid;
    if (mine.length) {
      if (net >= 0) W.earn(net);
      else {
        // the garrisons cost more than the ground makes: you cover it
        const s = S();
        s.gold = Math.max(0, s.gold + net);
        W.emit("gold", s.gold);
      }
      W.log("the island paid $" + income + (paid ? " — $" + paid + " to " + men + " men in garrison" : "")
            + " from " + mine.length + " holding" + (mine.length === 1 ? "" : "s") + ".",
            net >= 0 ? "good" : "bad");
    }
    let flips = [];
    if (WAR_ON && !FLAG_NOWAR) flips = warDawn();
    W.emit("territory:dawn", { income: income, paid: paid, flips: flips.length });
    repaintSoon();
  }

  /* ============================================================ SNAPSHOT
     THE ONLY THING THAT GOES ON THE WIRE. The regions are a function of the
     seed, so a client that has the seed already has the map; all it is
     missing is who holds what. One character per region and one integer per
     garrison — a 22-region island is under 200 bytes, which is small enough
     to send on every tick if warnet.js wants to.

     `.` is nobody, `@` is the sending player, and a digit indexes
     W.FACTIONS. Sent as characters rather than an array because JSON of 22
     nulls-and-strings is 300 bytes of quotes. */
  const OWN_CHARS = "@0123456789";
  T.snapshot = function () {
    ensure();
    const t = tState();
    const ids = ownerIds();
    let o = "", gp = [];
    for (let i = 0; i < REG.length; i++) {
      const own = t.own[REG[i].id] || null;
      const k = own ? ids.indexOf(own) : -1;
      o += k < 0 ? "." : OWN_CHARS.charAt(k);
      gp.push(Math.round(T.garrisonPower(REG[i].id)));
    }
    return { v: 1, seed: S().seed | 0, n: REG.length, o: o, gp: gp };
  };
  T.apply = function (snap) {
    if (!snap || snap.v !== 1) return false;
    if ((snap.seed | 0) !== (S().seed | 0)) {
      /* A SNAPSHOT FROM A DIFFERENT ISLAND IS NOT A MERGE PROBLEM, IT IS A
         BUG UPSTREAM. Refusing loudly beats painting somebody else's borders
         over your own terrain, which is what the first draft did and it took
         an hour to work out why the map looked plausible and wrong. */
      console.warn("[warlord/territory] snapshot seed", snap.seed, "≠ island", S().seed);
      return false;
    }
    if (!ensure()) return false;
    if (snap.n !== REG.length) { console.warn("[warlord/territory] snapshot region count mismatch"); return false; }
    const t = tState();
    const ids = ownerIds();
    let changed = 0;
    for (let i = 0; i < REG.length; i++) {
      const ch = snap.o.charAt(i);
      const own = ch === "." ? null : ids[OWN_CHARS.indexOf(ch)] || null;
      const cur = t.own[REG[i].id] || null;
      if (own !== cur) {
        changed++;
        if (own) t.own[REG[i].id] = own; else delete t.own[REG[i].id];
        // an ownership change that arrives from the host wipes the local
        // roster: those men are not yours to draw any more
        if (t.gar[REG[i].id]) delete t.gar[REG[i].id];
      }
      const p = snap.gp && snap.gp[i] || 0;
      if (!t.gar[REG[i].id]) { if (p) t.gp[REG[i].id] = p; else delete t.gp[REG[i].id]; }
    }
    if (changed) { W.emit("territory:claim", { region: null, from: null, to: null, bulk: changed }); repaintSoon(); }
    return true;
  };

  /* ============================================================ THE MAP
     The deliverable. A full-screen canvas that answers "who owns what" in
     one look, drawn over desert.js's own painted island so the borders sit
     on the real coast and the real mesas rather than on a decoration.

     FOUR LAYERS, and the order is the whole design:
       1. the island        desert.mapTexture — the real heightfield
       2. the ownership wash a soft colour per holding, scaled up WITH
                            smoothing on purpose: hard cell edges at 52 m
                            read as a grid, which is the one thing the brief
                            forbids. The border line on top is what defines
                            the actual boundary; the wash only has to say
                            "this side is orange".
       3. the borders       each frontier stroked TWICE, offset half a stroke
                            to each side, in each side's own colour
       4. the pieces        outposts, wells, warbands sized by real strength,
                            you, and the labels
  */
  let root = null, cv = null, g2 = null, tintCv = null, tintDirty = true;
  let view = { cx: 0, cz: 0, mpp: 26 };
  let selected = null;
  let open = false;
  let raf = 0;

  function tintCanvas() {
    if (tintCv && !tintDirty) return tintCv;
    if (!tintCv) {
      tintCv = document.createElement("canvas");
      tintCv.width = tintCv.height = GS;
    }
    const g = tintCv.getContext("2d");
    const img = g.createImageData(GS, GS);
    const px = img.data;
    const t = tState();
    const cols = new Int32Array(REG.length);
    const on = new Uint8Array(REG.length);
    for (let i = 0; i < REG.length; i++) {
      const own = t.own[REG[i].id] || null;
      on[i] = own ? 1 : 0;
      cols[i] = ownerColour(own);
    }
    for (let i = 0; i < GS * GS; i++) {
      const r = cellRegion[i];
      const o = i * 4;
      if (r < 0 || !on[r]) { px[o + 3] = 0; continue; }
      const c = cols[r];
      px[o] = (c >> 16) & 255; px[o + 1] = (c >> 8) & 255; px[o + 2] = c & 255;
      px[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    tintDirty = false;
    return tintCv;
  }

  function fitView(w, h) {
    const D = W.desert;
    const R = (D && D.RADIUS) || 6700;
    view.cx = 0; view.cz = 0;
    view.mpp = (R * 2.25) / Math.max(1, Math.min(w, h));
  }
  function sx(x, w) { return (x - view.cx) / view.mpp + w / 2; }
  function sy(z, h) { return (z - view.cz) / view.mpp + h / 2; }
  function wx(px, w) { return (px - w / 2) * view.mpp + view.cx; }
  function wz(py, h) { return (py - h / 2) * view.mpp + view.cz; }

  function draw() {
    raf = 0;
    if (!open || !cv || !g2) return;
    const dpr = cv._dpr || 1;
    const w = cv.width / dpr, h = cv.height / dpr;
    const g = g2;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    // the deep water the island sits in — the same blue desert.js paints
    g.fillStyle = "#0d2436";
    g.fillRect(0, 0, w, h);

    const D = W.desert;
    if (!D || !REG.length) return;
    const dx = sx(-BOUNDS, w), dy = sy(-BOUNDS, h), dw = (BOUNDS * 2) / view.mpp;

    /* 1. THE ISLAND. 512 is desert.js's own cache size and it is already
       painted for campaign's minimap, so asking for it here is free after
       the first call. Guarded: an agent-in-progress desert.js that has no
       mapTexture yet must cost the ownership map its backdrop, not its
       existence. */
    let painted = false;
    try {
      const src = D.mapTexture && D.mapTexture(512);
      if (src) { g.imageSmoothingEnabled = true; g.drawImage(src, dx, dy, dw, dw); painted = true; }
    } catch (e) {}
    if (!painted) {
      // no island texture: draw the land mask off the raster so the map is
      // still a map rather than a blue rectangle
      g.save();
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 1;
      g.fillStyle = "#b99a63";
      const s = dw / GS;
      for (let j = 0; j < GS; j++) for (let k = 0; k < GS; k++) {
        if (cellRegion[j * GS + k] >= 0) g.fillRect(dx + k * s, dy + j * s, s + 0.6, s + 0.6);
      }
      g.restore();
    }

    /* 2. THE WASH */
    g.save();
    g.globalAlpha = 0.46;
    g.imageSmoothingEnabled = true;
    g.drawImage(tintCanvas(), dx, dy, dw, dw);
    g.restore();

    /* 3. THE BORDERS */
    const t = tState();
    const px = 1 / view.mpp;                       // pixels per metre
    g.lineCap = "butt";
    // every region edge, hairline, so unowned ground still reads as divided
    g.strokeStyle = "rgba(20,14,8,.30)";
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.a < 0 || s.b < 0) continue;
      g.moveTo(sx(s.x1, w), sy(s.z1, h));
      g.lineTo(sx(s.x2, w), sy(s.z2, h));
    }
    g.stroke();
    // and then the frontiers that matter, twice, one colour per side
    const own = [];
    for (let i = 0; i < REG.length; i++) own.push(t.own[REG[i].id] || null);
    const bw = clamp(2.4, 1.6, 4);
    for (let side = 0; side < 2; side++) {
      const byColour = {};
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.a < 0 || s.b < 0) continue;
        const oa = own[s.a], ob = own[s.b];
        if (oa === ob) continue;
        const me = side === 0 ? oa : ob;
        if (!me) continue;
        const key = String(ownerColour(me));
        (byColour[key] = byColour[key] || []).push({ s: s, sign: side === 0 ? -1 : 1 });
      }
      const keys = Object.keys(byColour);
      for (let c = 0; c < keys.length; c++) {
        const list = byColour[keys[c]];
        g.strokeStyle = "rgba(" + ((+keys[c] >> 16) & 255) + "," + ((+keys[c] >> 8) & 255) + "," + (+keys[c] & 255) + ",.95)";
        g.lineWidth = bw;
        g.beginPath();
        for (let i = 0; i < list.length; i++) {
          const s = list[i].s, sg = list[i].sign;
          // offset along the edge normal: a vertical edge (ax 0) pushes in x
          const ox = s.ax ? 0 : sg * bw * 0.5, oy = s.ax ? sg * bw * 0.5 : 0;
          g.moveTo(sx(s.x1, w) + ox, sy(s.z1, h) + oy);
          g.lineTo(sx(s.x2, w) + ox, sy(s.z2, h) + oy);
        }
        g.stroke();
      }
    }

    // the selected region gets a bright outline, so a tap has an answer
    if (selected) {
      g.strokeStyle = "rgba(255,255,255,.92)";
      g.lineWidth = 2.6;
      g.setLineDash([7, 5]);
      g.beginPath();
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.a !== selected.idx && s.b !== selected.idx) continue;
        g.moveTo(sx(s.x1, w), sy(s.z1, h));
        g.lineTo(sx(s.x2, w), sy(s.z2, h));
      }
      g.stroke();
      g.setLineDash([]);
    }

    /* 4. THE PIECES */
    const st = S();
    // wells
    const O = (D.oases || []);
    for (let i = 0; i < O.length; i++) {
      const p = { x: sx(O[i].x, w), y: sy(O[i].z, h) };
      g.fillStyle = "#39d0a8";
      g.beginPath(); g.arc(p.x, p.y, 3.6, 0, TAU); g.fill();
      g.strokeStyle = "rgba(0,0,0,.5)"; g.lineWidth = 1; g.stroke();
    }
    // outposts
    const OP = st.outposts || [];
    for (let i = 0; i < OP.length; i++) {
      const p = { x: sx(OP[i].x, w), y: sy(OP[i].z, h) };
      g.fillStyle = "#ffb15a";
      g.strokeStyle = "rgba(0,0,0,.6)"; g.lineWidth = 1;
      g.beginPath();
      g.rect(p.x - 3.6, p.y - 3.6, 7.2, 7.2);
      g.fill(); g.stroke();
    }
    // WARBANDS, SIZED BY REAL STRENGTH. A six-man crew and a three-hundred
    // man army must not be the same dot — that is the single most useful
    // thing a strategic map can tell you. Cube root rather than square root
    // because core's band sizes span 2..320 and a square root still made the
    // armies eat the island.
    const B = st.bands || [];
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      const p = { x: sx(b.x, w), y: sy(b.z, h) };
      if (p.x < -30 || p.y < -30 || p.x > w + 30 || p.y > h + 30) continue;
      const pow = W.bandPower(b);
      const r = 2.4 + Math.pow(Math.max(1, pow), 0.34) * 1.35;
      g.fillStyle = rgba(b.colour || ownerColour(b.faction), b.mood === "hunt" ? 0.98 : 0.8);
      g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill();
      g.strokeStyle = "rgba(10,7,4,.75)"; g.lineWidth = 1.2; g.stroke();
    }
    // garrisons — a shield on the holding that has one
    for (let i = 0; i < REG.length; i++) {
      const n = T.garrisonSize(REG[i].id);
      if (!n) continue;
      const p = { x: sx(REG[i].lx, w), y: sy(REG[i].lz, h) + 13 };
      g.fillStyle = rgba(ownerColour(own[i]), 0.95);
      g.strokeStyle = "rgba(10,7,4,.8)"; g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(p.x, p.y - 6); g.lineTo(p.x + 5, p.y - 3); g.lineTo(p.x + 5, p.y + 2);
      g.lineTo(p.x, p.y + 6); g.lineTo(p.x - 5, p.y + 2); g.lineTo(p.x - 5, p.y - 3);
      g.closePath(); g.fill(); g.stroke();
    }
    // peers, if warnet has any
    const peers = st.peers || {};
    Object.keys(peers).forEach(function (k) {
      const p = peers[k];
      if (p.x == null) return;
      const q = { x: sx(p.x, w), y: sy(p.z, h) };
      g.strokeStyle = "#7fa8c8"; g.lineWidth = 2;
      g.beginPath(); g.arc(q.x, q.y, 6, 0, TAU); g.stroke();
    });
    // you
    const me = { x: sx(st.you.x, w), y: sy(st.you.z, h) };
    g.strokeStyle = "#fff"; g.lineWidth = 2.4;
    g.beginPath(); g.arc(me.x, me.y, 8, 0, TAU); g.stroke();
    g.fillStyle = hex(YOU_COLOUR);
    g.beginPath(); g.arc(me.x, me.y, 3.4, 0, TAU); g.fill();

    /* THE LABELS, and they are the thing that turns a coloured blob into a
       place. Only drawn when a region is actually big enough on screen to
       carry one — the first draft printed all twenty-two at every zoom and
       the fit-to-island view was unreadable text soup. */
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let i = 0; i < REG.length; i++) {
      const r = REG[i];
      const onPx = Math.sqrt(r.areaKm2 * 1e6) / view.mpp;    // region's rough width in px
      if (onPx < 58) continue;
      const p = { x: sx(r.lx, w), y: sy(r.lz, h) };
      if (p.x < -60 || p.y < -40 || p.x > w + 60 || p.y > h + 40) continue;
      const o = own[i];
      const size = clamp(onPx / 7, 9, 15);
      g.font = "800 " + size.toFixed(1) + "px ui-sans-serif,system-ui,-apple-system,sans-serif";
      g.lineWidth = 3.2;
      g.strokeStyle = "rgba(8,6,4,.82)";
      g.strokeText(r.name, p.x, p.y);
      g.fillStyle = o ? hex(ownerColour(o)) : "rgba(244,236,216,.62)";
      g.fillText(r.name, p.x, p.y);
      if (onPx > 96) {
        g.font = "700 " + (size * 0.68).toFixed(1) + "px ui-sans-serif,system-ui,sans-serif";
        const sub = "$" + T.regionIncome(r) + (o ? " · " + ownerLabel(o) : " · UNCLAIMED");
        g.lineWidth = 2.6;
        g.strokeStyle = "rgba(8,6,4,.8)";
        g.strokeText(sub, p.x, p.y + size * 1.15);
        g.fillStyle = "rgba(244,236,216,.78)";
        g.fillText(sub, p.x, p.y + size * 1.15);
      }
    }
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    void px;
  }
  function repaint() { if (open && !raf) raf = requestAnimationFrame(draw); }
  function repaintSoon() { tintDirty = true; repaint(); }

  /* ============================================================ THE SCREEN */
  const CSS =
    '#wlTerr{position:fixed;inset:0;z-index:5;display:flex;flex-direction:column;' +
      'background:#0d2436;overscroll-behavior:none;touch-action:none}' +
    '#wlTerrCv{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab}' +
    '#wlTerrCv:active{cursor:grabbing}' +
    '#wlTerrTop{position:relative;z-index:2;display:flex;gap:10px;align-items:center;flex-wrap:wrap;' +
      'padding:calc(env(safe-area-inset-top,0px) + 44px) 14px 10px;' +
      'background:linear-gradient(rgba(8,6,4,.86),rgba(8,6,4,0));pointer-events:none}' +
    '#wlTerrTop b{font:800 15px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.1em}' +
    '#wlTerrTop .chip{font:700 11px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.16em;opacity:.8}' +
    '#wlTerrTop .sp{flex:1}' +
    '#wlTerrTop button{pointer-events:auto}' +
    '#wlTerrLegend{position:relative;z-index:2;display:flex;gap:7px;flex-wrap:wrap;padding:0 14px 6px;pointer-events:none}' +
    '#wlTerrLegend span{font:700 10px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.12em;' +
      'padding:5px 8px;border-radius:7px;background:rgba(8,6,4,.62);display:flex;gap:6px;align-items:center}' +
    '#wlTerrLegend i{width:9px;height:9px;border-radius:3px;display:inline-block}' +
    '#wlTerrCard{position:relative;z-index:2;margin-top:auto;padding:12px 14px calc(env(safe-area-inset-bottom,0px) + 14px);' +
      'background:linear-gradient(rgba(8,6,4,0),rgba(8,6,4,.9) 22%);pointer-events:none}' +
    '#wlTerrCard .in{pointer-events:auto;max-width:640px;margin:0 auto;' +
      'border:1px solid rgba(255,255,255,.14);border-radius:14px;background:rgba(18,14,9,.9);padding:12px 14px}' +
    '#wlTerrCard h3{margin:0 0 2px;font:800 17px/1.1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.02em}' +
    '#wlTerrCard .who{font:700 11px/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.18em}' +
    '#wlTerrCard .facts{display:flex;gap:14px;flex-wrap:wrap;margin:8px 0 2px;' +
      'font:700 11px/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.1em;opacity:.72}' +
    '#wlTerrCard .facts b{color:#ffd166}' +
    '#wlTerrHint{font:700 11px/1.5 ui-sans-serif,system-ui,sans-serif;letter-spacing:.14em;opacity:.55;text-align:center}';

  function screenHtml() {
    return '<style>' + CSS + '</style>' +
      '<div id="wlTerr">' +
        '<canvas id="wlTerrCv"></canvas>' +
        '<div id="wlTerrTop">' +
          '<b>THE <em style="font-style:normal;color:#ff8a3d">ISLAND</em></b>' +
          '<span class="chip" id="wlTerrHold"></span>' +
          '<span class="sp"></span>' +
          '<button class="wl-btn" id="wlTerrFit">FIT</button>' +
          '<button class="wl-btn hot" id="wlTerrClose">CLOSE</button>' +
        '</div>' +
        '<div id="wlTerrLegend"></div>' +
        '<div id="wlTerrCard"><div class="in" id="wlTerrCardIn">' +
          '<div id="wlTerrHint">TAP A HOLDING</div>' +
        '</div></div>' +
      '</div>';
  }

  function paintLegend() {
    const box = document.getElementById("wlTerrLegend");
    if (!box) return;
    const ids = ownerIds();
    let html = "";
    for (let i = 0; i < ids.length; i++) {
      const held = T.held(ids[i]);
      if (!held.length && ids[i] !== "you") continue;
      let inc = 0;
      for (let k = 0; k < held.length; k++) inc += T.regionIncome(held[k]);
      html += '<span><i style="background:' + hex(ownerColour(ids[i])) + '"></i>' +
              ownerLabel(ids[i]) + ' ' + held.length + '</span>';
      void inc;
    }
    const free = T.held(null).length;
    if (free) html += '<span><i style="background:' + hex(NONE_COLOUR) + '"></i>UNCLAIMED ' + free + '</span>';
    box.innerHTML = html;
    const hold = document.getElementById("wlTerrHold");
    if (hold) {
      const mine = T.held("you");
      hold.textContent = mine.length + " HELD · +$" + T.income("you") + "/DAY · DAY " + S().day;
    }
  }

  /* THE CARD. Everything you can do on this screen is here, and there are at
     most three buttons on it — "ultra-simple controls" is a hard requirement
     of this game and a strategic map is exactly where a build queue would
     grow if it were allowed to. Look, tap, ride or garrison. */
  function paintCard() {
    const box = document.getElementById("wlTerrCardIn");
    if (!box) return;
    if (!selected) {
      box.innerHTML = '<div id="wlTerrHint">TAP A HOLDING · DRAG TO PAN · PINCH OR SCROLL TO ZOOM</div>';
      return;
    }
    const r = selected;
    const o = T.owner(r.id);
    const st = S();
    const here = Math.hypot(st.you.x - r.x, st.you.z - r.z);
    const inIt = T.at(st.you.x, st.you.z) === r;
    const gsz = T.garrisonSize(r.id);
    const p = pressureOn(r);
    const def = defenceOf(r);
    let risk = "";
    if (o === "you" && p) {
      const odds = W.odds(p.force, def);
      risk = odds > 0.5
        ? '<div class="who" style="color:#ffc9c4">' + ownerLabel(p.owner) + ' CAN TAKE THIS — GARRISON IT</div>'
        : '<div class="who" style="color:rgba(244,236,216,.5)">' + ownerLabel(p.owner) + ' PRESSES THE BORDER · YOU HOLD</div>';
    }
    let btns = '<div class="wl-btns">';
    if (o !== "you") {
      btns += '<button class="wl-btn hot" id="wlTerrRide">RIDE HERE</button>';
    } else {
      btns += '<button class="wl-btn" id="wlTerrRide">RIDE HERE</button>';
      if (inIt) {
        btns += '<button class="wl-btn" id="wlTerrGarM" ' + (gsz ? "" : "disabled") + '>&minus;10 MEN</button>';
        btns += '<button class="wl-btn" id="wlTerrGarP" ' + (st.army.length ? "" : "disabled") + '>+10 MEN</button>';
      } else {
        btns += '<span class="wl-small wl-dim" style="align-self:center">RIDE THERE TO CHANGE THE GARRISON</span>';
      }
    }
    btns += '</div>';
    box.innerHTML =
      '<h3>' + r.name + '</h3>' +
      '<div class="who" style="color:' + hex(ownerColour(o)) + '">' + ownerLabel(o) + '</div>' +
      risk +
      '<div class="facts">' +
        '<span>+<b>$' + T.regionIncome(r) + '</b>/DAY</span>' +
        '<span>' + r.areaKm2.toFixed(0) + ' KM&sup2;</span>' +
        (r.wells ? '<span>' + r.wells + ' WELL' + (r.wells > 1 ? "S" : "") + '</span>' : '') +
        '<span>GARRISON ' + gsz + '</span>' +
        '<span>' + (here < 900 ? "YOU ARE HERE" : (here / 1000).toFixed(1) + " KM AWAY") + '</span>' +
      '</div>' + btns;

    const ride = document.getElementById("wlTerrRide");
    if (ride) ride.onclick = function () {
      if (W.campaign && W.campaign.dest) W.campaign.dest(r.x, r.z);
      W.toast("RIDING FOR " + r.name);
      close();
    };
    const gm = document.getElementById("wlTerrGarM");
    if (gm) gm.onclick = function () { moveGarrison(r, -10); };
    const gp = document.getElementById("wlTerrGarP");
    if (gp) gp.onclick = function () { moveGarrison(r, +10); };
  }

  /* GARRISONING IS THE ONE VERB THIS SCREEN HAS, and it moves REAL soldiers:
     core's own objects out of W.state.army and into the holding, with their
     guns on their backs (removeSoldier's keepKit:false, or the cart eats the
     rifle and hands the man a stick). Weakest men go first — you leave levies
     to hold a well and take veterans with you, which is what every player
     does anyway and what the tier order here makes free. */
  function moveGarrison(r, n) {
    const t = tState();
    const st = S();
    const list = t.gar[r.id] = t.gar[r.id] || [];
    if (n > 0) {
      const pool = st.army.slice().sort(function (a, b) { return W.tierIndex(a.tier) - W.tierIndex(b.tier); });
      let moved = 0;
      for (let i = 0; i < pool.length && moved < n; i++) {
        const s = W.removeSoldier(pool[i].id, false);
        if (s) { list.push(s); moved++; }
      }
      if (moved) W.toast(moved + " MEN HOLD " + r.name);
    } else {
      let moved = 0;
      while (list.length && moved < -n) { W.addSoldier(list.pop()); moved++; }
      if (moved) W.toast(moved + " MEN BACK IN THE COLUMN");
    }
    if (!list.length) delete t.gar[r.id];
    delete t.gp[r.id];
    if (W.save) W.save();
    paintCard(); paintLegend(); repaintSoon();
  }

  function sizeCanvas() {
    if (!cv) return;
    const dpr = Math.min(2, G.devicePixelRatio || 1);
    const w = cv.clientWidth || G.innerWidth, h = cv.clientHeight || G.innerHeight;
    cv.width = Math.max(2, Math.round(w * dpr));
    cv.height = Math.max(2, Math.round(h * dpr));
    cv._dpr = dpr;
  }

  /* PAN AND ZOOM ON BOTH HANDS. One pointer map serves mouse drag, one-finger
     touch pan and two-finger pinch, which is the only way to get this right
     once instead of writing a mouse path and a touch path that disagree. */
  function bind() {
    const pts = new Map();
    let drag = null, pinch = null, downT = 0, moved = 0;
    cv.addEventListener("pointerdown", function (e) {
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz };
        downT = Date.now(); moved = 0;
      } else if (pts.size === 2) {
        const a = Array.from(pts.values());
        pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mpp: view.mpp };
        drag = null;
      }
      e.preventDefault();
    });
    cv.addEventListener("pointermove", function (e) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) {
        const a = Array.from(pts.values());
        const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        view.mpp = clampZoom(pinch.mpp * (pinch.d / Math.max(6, d)));
        repaint();
        return;
      }
      if (!drag) return;
      const ddx = e.clientX - drag.x, ddy = e.clientY - drag.y;
      moved = Math.max(moved, Math.hypot(ddx, ddy));
      view.cx = drag.cx - ddx * view.mpp;
      view.cz = drag.cz - ddy * view.mpp;
      clampView();
      repaint();
    });
    function up(e) {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size && drag) {
        // a press that did not move is a SELECT — campaign.js's own 8px/380ms
        // gate, so tap-to-pick and drag-to-pan never fight on a thumb
        if (moved <= 9 && Date.now() - downT < 420) {
          const rect = cv.getBoundingClientRect();
          const r = T.at(wx(e.clientX - rect.left, rect.width), wz(e.clientY - rect.top, rect.height));
          selected = r || null;
          paintCard();
          repaint();
        }
        drag = null;
      }
    }
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", function (e) {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const before = { x: wx(mx, rect.width), z: wz(my, rect.height) };
      view.mpp = clampZoom(view.mpp * (e.deltaY > 0 ? 1.16 : 1 / 1.16));
      // zoom about the cursor, not the centre: zooming to the middle of the
      // island when you are looking at a corner is the thing that makes a
      // strategic map feel broken
      const after = { x: wx(mx, rect.width), z: wz(my, rect.height) };
      view.cx += before.x - after.x;
      view.cz += before.z - after.z;
      clampView();
      repaint();
    }, { passive: false });
    G.addEventListener("resize", function () { if (open) { sizeCanvas(); repaint(); } });
  }
  function clampZoom(m) {
    const D = W.desert;
    const R = (D && D.RADIUS) || 6700;
    const w = cv ? (cv.clientWidth || G.innerWidth) : 900;
    const h = cv ? (cv.clientHeight || G.innerHeight) : 600;
    const fit = (R * 2.6) / Math.max(1, Math.min(w, h));
    return clamp(m, 2.2, fit);
  }
  function clampView() {
    const lim = BOUNDS * 1.05;
    view.cx = clamp(view.cx, -lim, lim);
    view.cz = clamp(view.cz, -lim, lim);
  }

  let hidden = null, stageZ = null;
  function open_() {
    if (open) return;
    const ctx = T.ctx;
    if (!ctx || !ctx.screen) return;
    if (!ensure()) { W.toast("the island is not raised yet", "bad"); return; }
    open = true;
    ctx.screen(screenHtml());
    /* THE STAGE HAS TO COME UP OVER campaign.js's HUD. #stage is z-index 40
       and #wlCampHud is 45, so a map painted into the stage would be under
       the compass and the MAP button. Raising the stage for the life of this
       screen and putting it back on close is one line and touches nobody
       else's file; hiding the campaign HUD outright is the other half,
       because a compass over a strategic map is noise. */
    const st = ctx.stage || document.getElementById("stage");
    if (st) { stageZ = st.style.zIndex; st.style.zIndex = "66"; }
    hidden = document.getElementById("wlCampHud");
    if (hidden) hidden.style.display = "none";
    const oldMap = document.getElementById("wlMap");
    if (oldMap) oldMap.classList.remove("on");

    cv = document.getElementById("wlTerrCv");
    g2 = cv.getContext("2d");
    sizeCanvas();
    fitView(cv.clientWidth || G.innerWidth, cv.clientHeight || G.innerHeight);
    // open looking at yourself, not at the origin — the origin is the middle
    // of the sea on plenty of seeds
    const you = S().you;
    if (you) { view.cx = you.x * 0.35; view.cz = you.z * 0.35; }
    clampView();
    bind();
    tintDirty = true;
    selected = T.at(you.x, you.z) || null;
    paintLegend(); paintCard(); repaint();
    document.getElementById("wlTerrClose").onclick = close;
    document.getElementById("wlTerrFit").onclick = function () {
      fitView(cv.clientWidth, cv.clientHeight); repaint();
    };
    W.emit("territory:open", null);
  }
  function close() {
    if (!open) return;
    open = false;
    const ctx = T.ctx;
    if (ctx && ctx.closeScreen) ctx.closeScreen();
    const st = ctx && (ctx.stage || document.getElementById("stage"));
    if (st) st.style.zIndex = stageZ || "";
    if (hidden) hidden.style.display = "";
    hidden = null; cv = null; g2 = null;
    W.emit("territory:close", null);
  }
  T.open = open_;
  T.close = close;
  T.toggle = function () { if (open) close(); else open_(); };
  T.isOpen = function () { return open; };

  /* ============================================================ THE DEMO
     `?map=1` opens the strategic map straight from the title with a plausible
     spread on it. It exists because this file has to be photographable
     before campaign.js, army.js and battle.js have agreed to call any of it —
     an agent blocked on four other agents ships nothing. It is also the only
     way to get the "day one / mid / late" pictures the presentation needs
     out of one page load. */
  T.demo = function (stage) {
    ensure();
    const t = tState();
    ensureOwnState(true);
    const F = W.FACTIONS || [];
    if (stage === "day1") { repaintSoon(); return; }
    /* The spread is hashed, not rolled, so the three photographs are of the
       same island at three moments rather than three different islands. */
    const mid = stage !== "late";
    for (let i = 0; i < REG.length; i++) {
      const r = REG[i];
      if (t.own[r.id]) continue;
      const h = W.hash01(r.x, r.z, mid ? 8801 : 8802);
      if (mid) {
        if (h < 0.16) t.own[r.id] = "you";
        else if (h < 0.72) t.own[r.id] = F[Math.floor(h * 997) % F.length].id;
      } else {
        if (h < 0.56) t.own[r.id] = "you";
        else if (h < 0.9) t.own[r.id] = F[Math.floor(h * 997) % F.length].id;
      }
    }
    // a couple of garrisons so the shields and the card have something to say
    const mine = T.held("you");
    for (let i = 0; i < mine.length; i += 2) t.gp[mine[i].id] = 40 + (i * 13);
    repaintSoon();
  };

  /* ============================================================ AUDIT */
  T.audit = function () {
    ensure();
    const t = tState();
    const byOwner = {};
    let inc = 0;
    for (let i = 0; i < REG.length; i++) {
      const o = t.own[REG[i].id] || "none";
      byOwner[o] = (byOwner[o] || 0) + 1;
      if (o === "you") inc += T.regionIncome(REG[i]);
    }
    return {
      seed: S().seed, regions: REG.length, cells: GS, cellM: Math.round(CELL),
      segs: segs ? segs.length : 0,
      islandMen: Math.round(ISLAND_MEN), perArableKm2: Math.round(MEN_PER_ARABLE_KM2),
      byOwner: byOwner, yourIncome: inc, war: WAR_ON && !FLAG_NOWAR,
      names: REG.map(function (r) { return r.name; }),
      flags: { off: FLAG_OFF, nowar: FLAG_NOWAR, oldmap: FLAG_OLDMAP },
    };
  };

  /* ============================================================ BOOT */
  T.needs = ["desert"];
  T.boot = function (ctx) {
    T.ctx = ctx;
    if (FLAG_OFF) {
      try { console.log("[warlord/territory] ?terr=off — no regions, campaign keeps its map"); } catch (e) {}
      return;
    }

    /* TAKE THE MAP BUTTON. campaign.js already owns a MAP button and a flat
       island overlay; two maps in one game is the drift CLAUDE.md is written
       against, so this swallows the click on the way down and opens the real
       one. Registered at boot, which is BEFORE campaign.enter() binds
       anything, so this listener is always first in the capture phase.
       ?terrmap=old hands the button back. */
    if (!FLAG_OLDMAP) {
      document.addEventListener("click", function (e) {
        const btn = e.target && e.target.closest && e.target.closest("#wlMapBtn");
        if (!btn) return;
        e.stopPropagation();
        e.preventDefault();
        open_();
      }, true);
      G.addEventListener("keydown", function (e) {
        if (e.code !== "KeyM") return;
        const p = W.phase();
        if (p !== "campaign" && !open) return;
        e.stopPropagation();
        T.toggle();
      }, true);
    }

    /* AND THEN STOP THE CAMPAIGN FEELING THE MAP. campaign.js listens for
       pointers and the wheel in the CAPTURE phase on window, gated only on
       `live`, which is still true while this screen is up — so every pan of
       the strategic map was also spinning the 3D camera and every pinch was
       zooming it, invisibly, and the player came back to a world that had
       moved. Registered at boot so it lands ahead of campaign's own. */
    ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel"].forEach(function (ev) {
      G.addEventListener(ev, function (e) { if (open) e.stopPropagation(); }, true);
    });

    W.on("dawn", dawn);
    W.on("newgame", function () {
      const s = S();
      s.territory = { own: {}, gar: {}, gp: {}, taken: {}, press: {} };
      builtSeed = null; REG.length = 0; selected = null;
      // built lazily on first use — newGame runs before the island is raised
    });
    W.on("loaded", function () { builtSeed = null; REG.length = 0; selected = null; });
    W.on("campaign:ready", function () { ensure(); });
    W.on("outpost:place", function () { repaintSoon(); });
    /* THE BATTLE HOOK THAT WORKS TODAY. army.js already publishes the whole
       aftermath report as the phase payload, so this needs nothing from
       anybody: won a fight standing on somebody's ground, take the ground.
       T.onBattleWon is still published for battle.js/army.js to call
       explicitly once they want to — calling it twice is a no-op, because
       the second call finds the region already yours. */
    W.on("phase:aftermath", function (r) { try { T.onBattleWon(r); } catch (e) {} });

    if (ctx.Q && ctx.Q.get("audit") === "1") {
      setTimeout(function () { try { console.log("[warlord/territory]", T.audit()); } catch (e) {} }, 0);
    }

    /* THE DEBUG ENTRY. Deferred a tick so the shell's own ?go=1 has already
       started a game and campaign.js has had its chance to raise the island. */
    if (ctx.Q && ctx.Q.get("map") === "1") {
      setTimeout(function () {
        if (W.phase() === "menu" || W.phase() === "boot") {
          W.newGame({ seed: parseInt(ctx.Q.get("seed") || "", 10) || 1337 });
        }
        ensure();
        T.demo(ctx.Q.get("stage") || "mid");
        open_();
        G.__warlordMapReady = true;
      }, 30);
    }
  };
  W.module("territory", T);
})();
