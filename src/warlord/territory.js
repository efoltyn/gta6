/* ============================================================
   warlord/territory.js — WHO OWNS WHAT, AND THE MAP THAT SHOWS IT.

   THE ASK, in the owner's words: "ultra simple mechanics, made for
   multiplayer — it's almost like openfront.io met Bannerlord."

   OpenFront is not a lobby feature. It is ONE PICTURE — a map where you can
   see who owns what and WATCH IT CHANGE — and everything else in that game
   is a consequence of that picture existing. So this file is not a strategic
   overlay bolted onto a singleplayer campaign. It is the game's front page.
   If the map is beautiful and legible this game works; if it is not, no
   amount of battle detail saves it.

   WHAT THIS FILE OWNS
     · REGIONS      the island cut into ~22 holdings, derived from its own
                    geography and from the seed ALONE
     · OWNERSHIP    who holds each one: you, one of core's five factions, or
                    any warlord match.js/warnet.js registers
     · THE ECONOMY  what a holding pays at dawn and what its garrison costs —
                    the thing that makes core's wage brake survivable at
                    scale and turns the mid-game from raiding into ruling
     · THE WAR      the factions taking ground off each other, abstractly but
                    VISIBLY, so the island is a world and not a set of
                    encounters arranged around the player
     · THE MAP      full-screen, real-time, animated. The deliverable.

   WHY THE REGIONS ARE NOT A GRID. A hex or square grid on a desert reads as
   a spreadsheet, and worse, it makes every region interchangeable — the
   death of "I want THAT one". So the island cuts itself up: every oasis is
   the seed of a holding ("the water and the ground that drinks from it"),
   and the rest is divided between anchors dropped on a low-discrepancy
   spiral and rejected until they are far enough apart. A point belongs to
   the nearest anchor AFTER a two-octave warp of its coordinates, which is
   what turns straight Voronoi walls into borders that wander like real
   frontiers. Nothing here is drawn by hand and nothing is stored: the whole
   map is a pure function of `W.state.seed`.

   THAT IS ALSO THE MULTIPLAYER DESIGN, AND IT IS THE LOAD-BEARING DECISION.
   A shared island is shared by sharing one integer. If the regions were
   rolled at runtime, every client would compute a different map and the
   geometry would have to go on the wire every join. Because they are
   derived, THE ONLY THING THAT IS EVER SENT IS OWNERSHIP — snapshot() is one
   character per region plus a small owner table. A 22-region island is under
   300 bytes, which is small enough to send on a tick.

   REAL TIME, NEVER PAUSED. The map assumes ownership is changing while it is
   being looked at. It runs its own frame loop, updates the ownership layer
   INCREMENTALLY (only the cells of regions that are actually changing), and
   never assumes it owns the world for a frame. A claim does not snap: the
   new colour SPREADS across the holding from the frontier it was taken
   across, over about a second, because watching that happen is the entire
   pleasure the owner asked for.

   WHY THE MAP SCREEN AND NOT campaign.js's. campaign.js already had a world
   map (#wlMap): the painted island with dots on it, opened by its MAP
   button. Two maps in one game is exactly the drift CLAUDE.md warns about,
   so this file does not add a second one — it TAKES THE BUTTON. A capture
   listener on the way down swallows the click and opens this screen instead;
   `?terrmap=old` gives the button back. Nothing in campaign.js was edited.

   PUBLISHED SURFACE — the whole thing match.js drives the game through
     regions[] at(x,z) byId(id) neighboursOf(id) frontierOf(owner)
     owner(id) held(owner) ownerList() registerOwner({id,label,colour})
     claim(id, owner, opts) claimAt(x,z,owner,opts) setOwners(map, opts)
     garrison(id) garrisonSize(id) garrisonPower(id) setGarrisonPower(id,n)
     regionIncome(r) income(owner) strengthOf(owner) defenceOf(r) pressureOn(r)
     snapshot() apply(snap) autoWar(bool) dawn()
     open() close() toggle() isOpen() focus(regionId)
     demo(stage) audit()

   EVENTS EMITTED
     territory:ready  {regions, seed}
     territory:claim  {region, from, to}      every ownership change, any cause
     territory:dawn   {income, paid, flips}
     territory:open   territory:close

   FLAGS (repo doctrine — every behaviour switch has a revert)
     ?terr=off       no regions, no income, no war; campaign keeps its flat
                     map. The honest "before" for the A/B tool.
     ?terrwar=off    regions and income, but the factions never move
     ?terrmap=old    campaign.js's flat map back on the MAP button
     ?terranim=off   claims snap instead of spreading (the pre-animation look)
     ?regions=coarse 160-cell raster instead of 320 (slow devices)
     ?map=1          open the map straight from boot with a plausible spread.
                     ?map=1&stage=day1|mid|late
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
  const FLAG_NOANIM = QP.get("terranim") === "off";

  const T = W.territory = W.territory || {};
  const TAU = Math.PI * 2;
  const clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  const S = function () { return W.state; };
  const now = function () { return (G.performance && G.performance.now) ? G.performance.now() : Date.now(); };

  /* ============================================================ OWNERS
     NOT FIVE FACTIONS AND YOU. An OpenFront match has as many warlords as
     joined the lobby, so ownership is a registry rather than an enum:
     core's five plus you are registered at boot, and match.js/warnet.js add
     one per player as they arrive. The wire format ships the owner TABLE
     alongside the ownership string (see snapshot) rather than trusting both
     ends to have registered the same people in the same order — that
     assumption is exactly the bug that would only show up with four players
     in a lobby, i.e. never on this machine. */
  const OWNERS = {};
  let ownerOrder = [];
  const YOU_COLOUR = 0xff8a3d;          // the shell's --hot. You are the orange one.
  const NONE_COLOUR = 0x6b6154;

  T.registerOwner = function (o) {
    if (!o || !o.id) return null;
    const cur = OWNERS[o.id];
    const rec = cur || { id: o.id, label: o.label || String(o.id).toUpperCase(), colour: NONE_COLOUR };
    if (o.label) rec.label = o.label;
    if (o.colour != null) rec.colour = o.colour | 0;
    if (!cur) { OWNERS[o.id] = rec; ownerOrder.push(o.id); }
    return rec;
  };
  function baseOwners() {
    if (ownerOrder.length) return;
    T.registerOwner({ id: "you", label: (S().you && S().you.name) || "YOU", colour: YOU_COLOUR });
    const F = W.FACTIONS || [];
    for (let i = 0; i < F.length; i++) T.registerOwner({ id: F[i].id, label: F[i].label, colour: F[i].colour });
  }
  T.ownerList = function () { baseOwners(); return ownerOrder.slice(); };
  function ownerColour(id) {
    if (!id) return NONE_COLOUR;
    baseOwners();
    const r = OWNERS[id];
    return r ? r.colour : NONE_COLOUR;
  }
  function ownerLabel(id) {
    if (!id) return "UNCLAIMED";
    baseOwners();
    if (id === "you") return (S().you && S().you.name) || "YOU";
    const r = OWNERS[id];
    return r ? r.label : String(id).toUpperCase();
  }
  T.ownerColour = ownerColour;
  T.ownerLabel = ownerLabel;
  function hex(c) { return "#" + ("000000" + ((c | 0) >>> 0).toString(16)).slice(-6); }
  function rgba(c, a) {
    const n = c | 0;
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  /* ============================================================ NOISE
     A tiny value-noise pair, only ever used to WARP the region lookup so the
     borders wander. Built on W.hash01 rather than desert.js's private hash
     because this runs 100k times at generate and never again, and the public
     hash is identical in Node and in the browser — which is the whole
     determinism claim. The seed is folded into the salt, so a different
     island gets different frontiers. */
  let NSALT = 0;
  function vn(x, z, scale, salt) {
    const fx = x / scale, fz = z / scale;
    const ix = Math.floor(fx), iz = Math.floor(fz);
    const tx = fx - ix, tz = fz - iz;
    const sx0 = tx * tx * (3 - 2 * tx), sz0 = tz * tz * (3 - 2 * tz);
    const s = (salt + NSALT) | 0;
    const a = W.hash01(ix, iz, s), b = W.hash01(ix + 1, iz, s);
    const c = W.hash01(ix, iz + 1, s), d = W.hash01(ix + 1, iz + 1, s);
    const top = a + (b - a) * sx0, bot = c + (d - c) * sx0;
    return top + (bot - top) * sz0;
  }
  /* TWO OCTAVES, AND THE SECOND ONE IS THE POINT. One octave gives borders
     that bulge in smooth arcs — better than straight lines, still obviously
     mathematical. The 380 m octave puts a kink in them at the scale a player
     actually reads on the map, which is what makes a frontier look like it
     was fought over rather than drawn. */
  function warpX(x, z) { return x + (vn(x, z, 1500, 9001) - 0.5) * 900 + (vn(x, z, 380, 9013) - 0.5) * 260; }
  function warpZ(x, z) { return z + (vn(x, z, 1500, 9007) - 0.5) * 900 + (vn(x, z, 380, 9019) - 0.5) * 260; }

  /* ============================================================ NAMES
     A region with no name is a number, and a number is not somewhere you
     want. The noun comes from what the ground actually IS (desert.js's own
     biome string), the qualifier from where it sits — so the name teaches
     the map: THE NORTH MESAS is in the north and is mesas. */
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
    const D = W.desert;
    const R = (D && D.RADIUS) || 6700;
    if (Math.hypot(x, z) < R * 0.3) return "INNER";
    const a = Math.atan2(x, -z);              // 0 = north, clockwise
    const k = ((Math.round(a / (TAU / 8)) % 8) + 8) % 8;
    return ["NORTH", "NORTH-EAST", "EAST", "SOUTH-EAST", "SOUTH", "SOUTH-WEST", "WEST", "NORTH-WEST"][k];
  }

  /* ============================================================ REGIONS */
  const REG = [];                 // the published array — the SAME object, always
  T.regions = REG;

  const GS = QP.get("regions") === "coarse" ? 160 : 320;   // raster cells across the island
  let cellRegion = null;          // Int16Array, -1 = sea
  let cellsOf = [];               // per region: Int32Array of its cell indices
  let BOUNDS = 8300, CELL = 1;
  let segs = null;                // border segments in world metres
  let builtSeed = null;
  let ISLAND_MEN = 0;

  /* ONE TYPED NUMBER IN THIS FILE. Everything else — every region's income,
     every garrison it can hold, the whole map economy — is derived from it.

     AN OASIS FEEDS A HUNDRED MEN. A design statement, not a measurement, in
     the same voice core.js uses for "you are worth fourteen men": big enough
     that taking an oasis changes what army you can afford (a hundred levies
     at wage 1 is $100 a dawn, and core's whole mid-game brake IS that wage),
     small enough that one oasis is not the game. Seven oases puts the
     island's total carrying capacity near 1400 men once every acre is held,
     which pays for about 350 SOLDIERS at wage 4 — the size of the biggest
     thing core's band roller will ever spawn. That ceiling, which is what
     the whole campaign is aimed at, comes out of this one number. */
  const MEN_PER_OASIS = 100;
  /* The land that drinks feeds, ISLAND-WIDE, exactly as many men as the
     water does — so the per-km² figure is not typed at all, it is solved for
     at generate time against the arable area this seed actually produced. A
     seed with a lot of wadi therefore does not quietly inflate the economy;
     it spreads the same total over more ground. */
  let MEN_PER_ARABLE_KM2 = 0;
  /* A market feeds a quarter of what water does. Trade is real here — the
     depots are where the guns are — but a warlord who holds every shop and
     no well still starves, which is the sentence this ratio exists to say. */
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
     would make the anchor set depend on how many times anything ELSE rolled
     the dice first — and that is not a seed-derived map, it is a lucky one. */
  const TARGET_REGIONS = 22;      // about twenty labels is what a phone map holds
  function buildAnchors(D) {
    const anchors = [];
    const O = D.oases || [];
    for (let i = 0; i < O.length; i++) {
      anchors.push({ x: O[i].x, z: O[i].z, kind: "oasis", name: O[i].name, oasis: O[i].id,
                     /* an oasis holding is TIGHT: the ground that drinks from
                        one well is not a third of a desert. The weight
                        multiplies the squared distance, so <1 pulls it in. */
                     w: 0.72 });
    }
    // measure the land this seed actually produced, so `sep` is not a guess
    // that leaves five regions on a small island and forty on a big one
    let land = 0, tries = 0;
    const R = D.RADIUS || 6700;
    for (let i = 0; i < 1200; i++) {
      const a = i * 2.399963, r = Math.sqrt((i + 0.5) / 1200) * R * 1.15;
      tries++;
      if (D.coastAt(Math.cos(a) * r, Math.sin(a) * r) > 0) land++;
    }
    const landArea = Math.PI * Math.pow(R * 1.15, 2) * (land / Math.max(1, tries));
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
      sep *= 0.86;                                   // relax and go round again
    }
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
     to guarantee that the map and the game agree about where a border is:
     the picture IS the lookup table. 320 cells across 16.6 km is 52 m a cell
     — finer than a warband is wide — and 102k nearest-anchor tests, which is
     a one-time cost of well under a fifth of a second on this box. */
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
        /* coastAt, not onLand. onLand also calls heightAt, which is the
           expensive one (~40 hash lookups) and answers a question this loop
           is not asking: coastAt <= 0 is exactly desert.js's own definition
           of sea, and it costs a fifth as much. */
        if (D.coastAt(x, z) <= 0) { cellRegion[j * GS + k] = -1; continue; }
        const wx0 = warpX(x, z), wz0 = warpZ(x, z);
        let best = 0, bd = 1e18;
        for (let i = 0; i < n; i++) {
          const dx = wx0 - ax[i], dz = wz0 - az[i];
          const d = (dx * dx + dz * dz) * aw[i];
          if (d < bd) { bd = d; best = i; }
        }
        cellRegion[j * GS + k] = best;
      }
    }
  }

  // raw index lookup — used during generate, before REG exists
  function rawAt(x, z) {
    if (!cellRegion) return -1;
    const k = Math.floor((x + BOUNDS) / CELL), j = Math.floor((z + BOUNDS) / CELL);
    if (k < 0 || j < 0 || k >= GS || j >= GS) return -1;
    return cellRegion[j * GS + k];
  }

  /* WHAT EACH REGION IS MADE OF. Area and arable fraction counted off the
     raster (biome sampled on a 3×3 stride — a fraction does not need every
     cell and biomeAt is the expensive call in this loop). The cell index
     list per region is kept, because the ownership layer repaints ONE
     region's cells when it flips rather than all 102k of them. */
  function measure(anchors) {
    const D = W.desert;
    const cellKm2 = (CELL * CELL) / 1e6;
    const n = anchors.length;
    const cells = new Int32Array(n), arable = new Int32Array(n), sampled = new Int32Array(n);
    const cx = new Float64Array(n), cz = new Float64Array(n);
    for (let j = 0; j < GS; j++) {
      const z = -BOUNDS + (j + 0.5) * CELL;
      for (let k = 0; k < GS; k++) {
        const r = cellRegion[j * GS + k];
        if (r < 0) continue;
        cells[r]++;
        const x = -BOUNDS + (k + 0.5) * CELL;
        cx[r] += x; cz[r] += z;
        if ((j % 3) || (k % 3)) continue;
        sampled[r]++;
        const b = D.biomeAt(x, z);
        /* THE GROUND THAT DRINKS. Only these three hold water a man can use:
           an oasis bowl, a wadi floor (the table is metres down, not
           hundreds) and the shore strip. Erg and salt pan feed nobody, which
           is exactly why the map is worth fighting over unevenly. */
        if (b === "oasis" || b === "wadi" || b === "shore") arable[r]++;
      }
    }
    // second pass: the cell lists
    cellsOf = [];
    const fill = [];
    for (let i = 0; i < n; i++) { cellsOf.push(new Int32Array(cells[i])); fill.push(0); }
    for (let i = 0; i < GS * GS; i++) {
      const r = cellRegion[i];
      if (r < 0) continue;
      cellsOf[r][fill[r]++] = i;
    }

    let totalArableKm2 = 0;
    for (let i = 0; i < n; i++) {
      const f = sampled[i] ? arable[i] / sampled[i] : 0;
      totalArableKm2 += f * cells[i] * cellKm2;
    }
    const wells = (D.oases || []).length;
    MEN_PER_ARABLE_KM2 = totalArableKm2 > 0.01 ? (wells * MEN_PER_OASIS) / totalArableKm2 : 0;

    REG.length = 0;
    for (let i = 0; i < n; i++) {
      const a = anchors[i];
      const f = sampled[i] ? arable[i] / sampled[i] : 0;
      let nWells = 0;
      const O = D.oases || [];
      for (let k = 0; k < O.length; k++) if (rawAt(O[k].x, O[k].z) === i) nWells++;
      REG.push({
        id: "r" + i, idx: i,
        name: a.name, kind: a.kind,
        x: a.x, z: a.z,
        /* the LABEL point is the region's centre of mass, not the anchor: an
           anchor sitting on a coastal lobe put three names in the sea. */
        lx: cells[i] ? cx[i] / cells[i] : a.x,
        lz: cells[i] ? cz[i] / cells[i] : a.z,
        areaKm2: cells[i] * cellKm2, arable: f, wells: nWells,
        neighbours: [], border: {},
      });
    }
  }

  /* BORDERS AND NEIGHBOURS IN ONE PASS. Every cell compares with the cell to
     its right and the cell below; a mismatch is a frontier segment (in world
     metres, so it survives any zoom) and a neighbour link. `border[id]` is
     how many cells long that shared frontier is — match.js weighting an
     attack by contact length needs it and nothing else can compute it. */
  function edges() {
    const list = [];
    function link(a, b) {
      const A = REG[a], B = REG[b];
      if (!A.border[B.id]) { A.border[B.id] = 0; A.neighbours.push(B.id); }
      if (!B.border[A.id]) { B.border[A.id] = 0; B.neighbours.push(A.id); }
      A.border[B.id]++; B.border[A.id]++;
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
         sits on SEED 1337 until somebody builds it, and campaign.enter() is
         what normally does that — but this map can be opened before the
         player has ever ridden. A no-op if the island is already this seed. */
      if (D.reseed) D.reseed(seed);
      NSALT = (Math.imul(seed, 2654435761) >>> 3) & 0x3fffff;
      const t0 = now();
      const anchors = buildAnchors(D);
      nameAnchors(anchors);
      rasterise(anchors);
      measure(anchors);
      edges();
      builtSeed = seed;
      ISLAND_MEN = 0;
      for (let i = 0; i < REG.length; i++) ISLAND_MEN += supportOf(REG[i]);
      baseOwners();
      /* NOT (true). generate() runs again after a load and after a reseed,
         and the first draft reset every border the save had just restored. The
         day-one homes are only laid down when nobody owns anything at all. */
      ensureOwnState(false);
      tintFull();
      try {
        console.log("[warlord/territory]", REG.length, "regions, seed", seed,
                    "in", Math.round(now() - t0), "ms");
      } catch (e) {}
      W.emit("territory:ready", { regions: REG.length, seed: seed });
      return true;
    } finally { generating = false; }
  }
  function ensure() { if (!REG.length || builtSeed !== (S().seed | 0)) generate(); return REG.length > 0; }

  /* ============================================================ THE STATE
     Ownership lives in W.state, so it saves, loads and serialises with
     everything else — core.js's rule, and the reason a garrison is a REAL
     roster of core soldiers rather than a number. The men you leave behind
     are men, with names, and you can come back for them.

     `gp` is the same thing for somebody ELSE's garrison: a network peer
     sends you strength, not thirty names, and the map only needs a number to
     draw a shield. A real roster wins wherever there is one. */
  function tState() {
    const s = S();
    if (!s.territory) s.territory = {};
    const t = s.territory;
    if (!t.own) t.own = {};
    if (!t.gar) t.gar = {};
    if (!t.gp) t.gp = {};
    if (!t.taken) t.taken = {};
    if (!t.press) t.press = {};
    return t;
  }

  /* DAY ONE: EVERY FACTION HOLDS ITS ONE HOME AND NOBODY HOLDS ANYTHING
     ELSE. That is the picture the design asks for on day one — a mostly
     empty island — and the honest starting position for a game whose whole
     arc is the map filling in. Which region is whose is hashed off the seed
     and the faction id so every client agrees without a message, and each
     faction is pushed away from the ones already placed so the five of them
     start spread out instead of in a huddle. */
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
        let far = placed.length ? 1e9 : 4000;
        for (let p = 0; p < placed.length; p++) far = Math.min(far, Math.hypot(REG[r].x - placed[p].x, REG[r].z - placed[p].z));
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
    const want = ownerId || null;
    for (let i = 0; i < REG.length; i++) if ((t.own[REG[i].id] || null) === want) out.push(REG[i]);
    return out;
  };
  T.neighboursOf = function (id) {
    const r = T.byId(id);
    if (!r) return [];
    const out = [];
    for (let i = 0; i < r.neighbours.length; i++) out.push(T.byId(r.neighbours[i]));
    return out;
  };
  /* EVERY REGION THIS OWNER COULD ATTACK NEXT — the one query an
     openfront-style expansion tick actually needs, sorted so the easiest
     grab is first. Contact length is in it because a region you touch along
     forty cells is not the same target as one you touch along three. */
  T.frontierOf = function (ownerId) {
    ensure();
    const t = tState();
    const seen = {}, out = [];
    for (let i = 0; i < REG.length; i++) {
      if ((t.own[REG[i].id] || null) !== (ownerId || null)) continue;
      const r = REG[i];
      for (let k = 0; k < r.neighbours.length; k++) {
        const nid = r.neighbours[k];
        if ((t.own[nid] || null) === (ownerId || null)) continue;
        if (seen[nid]) { seen[nid].contact += r.border[nid] || 0; continue; }
        const tgt = T.byId(nid);
        const rec = { region: tgt, owner: t.own[nid] || null, contact: r.border[nid] || 0,
                      defence: defenceOf(tgt) };
        seen[nid] = rec; out.push(rec);
      }
    }
    out.sort(function (a, b) { return (a.defence / Math.max(1, a.contact)) - (b.defence / Math.max(1, b.contact)); });
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
  function levyWage() { return (W.tier ? W.tier("levy").wage : 1) || 1; }
  T.regionIncome = function (r) { return r ? Math.round(supportOf(r) * levyWage()) : 0; };
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
    /* a remote garrison arrives as strength, not names; turn it back into a
       headcount with core's own mean soldier power so both ends of a match
       draw the same size shield. 4.2 is W.soldierPower of a levy with a
       sidearm — the cheapest real man in the game. */
    return p > 0 ? Math.max(1, Math.round(p / 4.2)) : 0;
  };
  T.setGarrisonPower = function (id, n) {
    const t = tState();
    if (n > 0) t.gp[id] = n; else delete t.gp[id];
    bump();
  };
  function garrisonPayroll(id) {
    const men = garrison(id);
    if (!men) return 0;
    let n = 0;
    for (let i = 0; i < men.length; i++) n += W.tier(men[i].tier).wage;
    return n;
  }

  /* ============================================================ CLAIMING
     ONE DOOR. Every ownership change in the game goes through here — the
     player winning a battle, a faction's dawn advance, match.js's tick,
     warnet.js applying the host's snapshot — so there is exactly one place
     that logs it, fires the event and starts the animation. */
  let ownVer = 0;
  function bump() { ownVer++; }

  T.claim = function (regionId, ownerId, opts) {
    if (!ensure()) return false;
    opts = opts || {};
    const r = T.byId(regionId);
    if (!r) return false;
    const t = tState();
    const from = t.own[regionId] || null;
    const to = ownerId || null;
    if (from === to) return false;
    if (to) t.own[regionId] = to; else delete t.own[regionId];
    t.taken[regionId] = S().day;
    delete t.press[regionId];
    /* THE GARRISON DIES WITH THE HOLDING. Men you left in a region that was
       taken off you are gone, and that is the entire reason garrisoning is a
       decision rather than free insurance. */
    const lost = (t.gar[regionId] || []).length;
    delete t.gar[regionId];
    delete t.gp[regionId];
    if (!opts.quiet) {
      const verb = from ? "took " + r.name + " from " + ownerLabel(from) : "claimed " + r.name;
      W.log(ownerLabel(to) + " " + verb + ".", to === "you" ? "good" : from === "you" ? "bad" : "");
      if (lost && from === "you") W.log(lost + " men of your garrison were lost with it.", "bad");
    }
    startClaimAnim(r, from, to, opts.fromRegion || null);
    bump();
    news(ownerLabel(to) + (from ? " TOOK " : " CLAIMED ") + r.name, to);
    W.emit("territory:claim", { region: r, from: from, to: to });
    return true;
  };
  T.claimAt = function (x, z, ownerId, opts) {
    const r = T.at(x, z);
    return r ? T.claim(r.id, ownerId, opts) : false;
  };
  /* BULK, for match.js and warnet.js: apply a whole tick of conquest in one
     call so the map animates them together instead of firing 20 log lines. */
  T.setOwners = function (map, opts) {
    if (!ensure() || !map) return 0;
    let n = 0;
    Object.keys(map).forEach(function (id) { if (T.claim(id, map[id], opts)) n++; });
    return n;
  };

  /* WHAT army.js / battle.js CALLS. One function, and it takes the aftermath
     report exactly as army.js already builds it. YOU TAKE GROUND BY BEATING
     THE FORCE THAT HOLDS IT: the region flips only if the band you just
     destroyed belonged to the faction that owned it, or if the ground was
     unclaimed. Beating a bandit crew that wandered into Legion country does
     not hand you the Legion's province — the rule that stops the map falling
     over inside the first hour. */
  T.onBattleWon = function (report) {
    if (!ensure() || !report) return null;
    if (!(report.outcome === "won" || report.outcome === "surrender")) return null;
    const b = report.band;
    const x = b ? b.x : (report.x != null ? report.x : S().you.x);
    const z = b ? b.z : (report.z != null ? report.z : S().you.z);
    const r = T.at(x, z);
    if (!r) return null;
    const holder = T.owner(r.id);
    if (holder === "you") return null;
    if (holder && holder !== (b ? b.faction : null)) return null;
    T.claim(r.id, "you");
    W.toast(r.name + " IS YOURS", "good");
    return r;
  };

  /* ============================================================ THE WAR
     Resolved abstractly — no simulated battles between two AI factions,
     because nobody is watching them and a hundred rolled skirmishes a dawn
     is a hundred log lines nobody reads. What matters is that the map
     CHANGES and the log says who took what from whom.

     A faction's strength is what it holds plus what it has walking around:
     the income of its regions (which is the men that ground feeds) plus the
     real power of its real bands on the map. Nothing invented. */
  function strengthOf(ownerId) {
    let n = T.income(ownerId);
    if (ownerId === "you") return n + W.yourPower();
    const B = S().bands || [];
    for (let i = 0; i < B.length; i++) if (B[i].faction === ownerId) n += W.bandPower(B[i]) * 0.5;
    return n;
  }
  T.strengthOf = strengthOf;

  /* WHAT A REGION IS WORTH DEFENDING WITH. Garrison first, because that is
     the player's lever. Then the ground itself: a holding raises its own
     levies and the number of them is the income again — so a rich province
     is genuinely harder to take than a stretch of erg without a "defence"
     stat existing anywhere. And a very recent capture is brittle: the week
     after you take somewhere is when you lose it. */
  function defenceOf(r) {
    if (!r) return 0;
    const t = tState();
    const own = t.own[r.id] || null;
    if (!own) return T.regionIncome(r) * 0.35;             // nobody's — thin local levies
    let d = T.garrisonPower(r.id) + T.regionIncome(r) * 0.9;
    const settled = clamp((S().day - (t.taken[r.id] || 0)) / 6, 0, 1);
    d *= 0.55 + 0.45 * settled;
    if (own === "you" && Math.hypot(S().you.x - r.x, S().you.z - r.z) < 1400) d += W.yourPower();
    return d;
  }
  T.defenceOf = defenceOf;

  function pressureOn(r) {
    const t = tState();
    const own = t.own[r.id] || null;
    const tally = {};
    for (let i = 0; i < r.neighbours.length; i++) {
      const nOwn = t.own[r.neighbours[i]] || null;
      if (!nOwn || nOwn === own) continue;
      tally[nOwn] = (tally[nOwn] || 0) + (r.border[r.neighbours[i]] || 1);
    }
    let total = 0;
    for (let i = 0; i < r.neighbours.length; i++) total += r.border[r.neighbours[i]] || 1;
    const keys = Object.keys(tally);
    let best = null, bs = 0, from = null;
    for (let i = 0; i < keys.length; i++) {
      /* A FACTION ONLY BRINGS WHAT IT CAN REACH: its full strength times the
         share of this region's frontier it actually stands on. That is what
         stops a faction on the far shore threatening everything at once, and
         what makes a salient with three enemy neighbours the thing that
         falls — which is a picture the player can read off the map. */
      const share = tally[keys[i]] / Math.max(1, total);
      const s = strengthOf(keys[i]) * (0.35 + 0.65 * share);
      if (s > bs) { bs = s; best = keys[i]; }
    }
    if (!best) return null;
    for (let i = 0; i < r.neighbours.length; i++) {
      if ((t.own[r.neighbours[i]] || null) === best) { from = r.neighbours[i]; break; }
    }
    return { owner: best, force: bs, from: from };
  }
  T.pressureOn = pressureOn;

  let WAR_ON = true;
  T.autoWar = function (on) { if (on != null) WAR_ON = !!on; return WAR_ON; };

  /* ONE DAWN OF THE WAR. Every region is looked at once; at most a few change
     hands. The cap is not decoration: without it a strong faction flipped
     nine regions in one dawn, the log became unreadable, and a map that
     changes that fast cannot be planned against. Three flips on a
     twenty-two region island is one visible move a day, which is what a
     strategy map should feel like between sessions. */
  function warDawn() {
    const t = tState();
    const flips = [];
    const cap = Math.max(2, Math.round(REG.length / 8));
    const cand = [];
    for (let i = 0; i < REG.length; i++) {
      const r = REG[i];
      const p = pressureOn(r);
      if (!p) { delete t.press[r.id]; continue; }
      const odds = W.odds(p.force, defenceOf(r));
      const own = t.own[r.id] || null;
      if (own === "you") t.press[r.id] = odds > 0.5 ? (t.press[r.id] || 0) + 1 : 0;
      cand.push({ r: r, p: p, odds: odds, own: own });
    }
    /* WEAKEST FIRST. Sorting by how badly a region is outmatched means the
       flips that happen are the ones a player could see coming off the map,
       rather than three arbitrary ones out of nine equally likely. */
    cand.sort(function (a, b) { return b.odds - a.odds; });
    for (let i = 0; i < cand.length && flips.length < cap; i++) {
      const c = cand[i];
      /* THE ROLL, and it is deliberately not "odds > 0.5 wins". A 55/45 front
         should move sometimes and not every single dawn, or the map
         oscillates and every border is noise. Squaring the odds is what makes
         a marginal advantage take a week and an overwhelming one take a day. */
      if (!W.chance(c.odds * c.odds * 0.9)) continue;
      if (c.own === "you" && (t.press[c.r.id] || 0) < 2) {
        /* YOUR GROUND GETS ONE WARNING. Without it a player who was in a
           battle when the front moved simply finds a province gone with no
           way to have known, and "conquer everything and idle" is replaced by
           "be punished at random". */
        W.log(ownerLabel(c.p.owner) + " is massing on " + c.r.name + ".", "bad");
        continue;
      }
      T.claim(c.r.id, c.p.owner, { fromRegion: c.p.from });
      flips.push({ region: c.r.id, to: c.p.owner });
    }
    return flips;
  }

  /* ============================================================ DAWN */
  function dawn() {
    if (FLAG_OFF) return;
    if (!ensure()) return;
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
        const s = S();
        s.gold = Math.max(0, s.gold + net);
        W.emit("gold", s.gold);
      }
      W.log("the island paid $" + income + (paid ? " — $" + paid + " to " + men + " men in garrison" : "") +
            " from " + mine.length + " holding" + (mine.length === 1 ? "" : "s") + ".",
            net >= 0 ? "good" : "bad");
    }
    let flips = [];
    if (WAR_ON && !FLAG_NOWAR) flips = warDawn();
    W.emit("territory:dawn", { income: income, paid: paid, flips: flips.length });
  }
  T.dawn = dawn;

  /* ============================================================ SNAPSHOT
     THE ONLY THING THAT EVER GOES ON THE WIRE. The regions are a function of
     the seed, so a client that has the seed already has the map; all it is
     missing is who holds what.

       o    one character per region: "." nobody, otherwise an index into ow
       ow   the owner table, IN ORDER — ids, and label/colour for anybody the
            receiver has never met (a warlord who joined the lobby after it)
       gp   garrison strength per region, integers

     The table is shipped rather than assumed because "both ends registered
     the same owners in the same order" is exactly the assumption that only
     breaks with four players in a lobby, i.e. never on this machine. */
  const OWN_CHARS = "@ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  T.snapshot = function () {
    ensure();
    const t = tState();
    const ids = T.ownerList();
    let o = "";
    const gp = [];
    for (let i = 0; i < REG.length; i++) {
      const own = t.own[REG[i].id] || null;
      const k = own ? ids.indexOf(own) : -1;
      o += (k < 0 || k >= OWN_CHARS.length) ? "." : OWN_CHARS.charAt(k);
      gp.push(Math.round(T.garrisonPower(REG[i].id)));
    }
    const ow = ids.map(function (id) { return { i: id, l: ownerLabel(id), c: ownerColour(id) }; });
    return { v: 2, seed: S().seed | 0, n: REG.length, o: o, gp: gp, ow: ow };
  };
  T.apply = function (snap) {
    if (!snap || (snap.v !== 1 && snap.v !== 2)) return false;
    if ((snap.seed | 0) !== (S().seed | 0)) {
      /* A SNAPSHOT FROM A DIFFERENT ISLAND IS NOT A MERGE PROBLEM, IT IS A
         BUG UPSTREAM. Refusing loudly beats painting somebody else's borders
         over your own terrain, which is what the first draft did — and it
         took an hour to work out why the map looked plausible and wrong. */
      console.warn("[warlord/territory] snapshot seed", snap.seed, "!= island", S().seed);
      return false;
    }
    if (!ensure()) return false;
    if (snap.n !== REG.length) { console.warn("[warlord/territory] snapshot region count mismatch"); return false; }
    baseOwners();
    if (snap.ow) for (let i = 0; i < snap.ow.length; i++) {
      T.registerOwner({ id: snap.ow[i].i, label: snap.ow[i].l, colour: snap.ow[i].c });
    }
    const ids = snap.ow ? snap.ow.map(function (o) { return o.i; }) : T.ownerList();
    const t = tState();
    let changed = 0;
    for (let i = 0; i < REG.length; i++) {
      const ch = snap.o.charAt(i);
      const own = ch === "." ? null : (ids[OWN_CHARS.indexOf(ch)] || null);
      const cur = t.own[REG[i].id] || null;
      if (own !== cur) {
        changed++;
        // one door: the animation, the event and the log all live in claim()
        T.claim(REG[i].id, own, { quiet: true });
      }
      const p = (snap.gp && snap.gp[i]) || 0;
      if (!t.gar[REG[i].id]) { if (p) t.gp[REG[i].id] = p; else delete t.gp[REG[i].id]; }
    }
    if (changed) bump();
    return true;
  };

  /* ============================================================ THE MAP
     Drawn over desert.js's own painted island, so the borders sit on the
     real coast and the real mesas rather than on a decoration.

     FOUR LAYERS, and the order is the whole design:
       1. the island        desert.mapTexture — the real heightfield
       2. the ownership wash a soft colour per holding, scaled up WITH
                            smoothing on purpose: hard 52 m cell edges read as
                            a grid, the one thing the design forbids. The
                            border line on top defines the actual boundary;
                            the wash only has to say "this side is orange".
       3. the frontiers     stroked in each side's own colour, offset half a
                            stroke each way, over a dark casing. A contested
                            frontier is dashed and CRAWLS.
       4. the pieces        outposts, wells, warbands sized by real strength,
                            garrison shields, you, and the labels.

     REAL TIME. The loop runs while the screen is up and reads live state
     every frame. The expensive things are cached against two version
     counters — the view (pan/zoom) and ownership — so a frame in which
     nothing changed is two drawImages and about eighty markers. */
  let root = null, cv = null, g2 = null;
  let tintCv = null, tintImg = null, tintPx = null;
  let view = { cx: 0, cz: 0, mpp: 26 };
  let viewVer = 0;
  let selected = null;
  let open = false;
  let raf = 0, slow = 0;
  let paths = null, pathsKey = "";
  let contested = [], contestedAt = 0, contestedVer = 0;
  let anims = [];
  let lastInteract = 0;
  let newsText = "", newsColour = 0, newsAt = 0;

  function news(text, ownerId) {
    newsText = text; newsColour = ownerColour(ownerId); newsAt = now();
  }

  function tintEnsure() {
    if (tintCv) return;
    tintCv = document.createElement("canvas");
    tintCv.width = tintCv.height = GS;
    const g = tintCv.getContext("2d");
    tintImg = g.createImageData(GS, GS);
    tintPx = tintImg.data;
  }
  function paintCells(list, colour, alpha) {
    tintEnsure();
    const r = (colour >> 16) & 255, gg = (colour >> 8) & 255, b = colour & 255;
    const a = Math.round(255 * (alpha == null ? 1 : alpha));
    for (let i = 0; i < list.length; i++) {
      const o = list[i] * 4;
      tintPx[o] = r; tintPx[o + 1] = gg; tintPx[o + 2] = b; tintPx[o + 3] = a;
    }
  }
  function clearCells(list) {
    tintEnsure();
    for (let i = 0; i < list.length; i++) tintPx[list[i] * 4 + 3] = 0;
  }
  let tintPushed = false;
  function tintFull() {
    if (!cellsOf.length) return;
    tintEnsure();
    const t = tState();
    for (let i = 0; i < REG.length; i++) {
      const own = t.own[REG[i].id] || null;
      if (own) paintCells(cellsOf[i], ownerColour(own));
      else clearCells(cellsOf[i]);
    }
    tintPushed = false;
  }
  function tintPush() {
    if (tintPushed || !tintCv) return;
    tintCv.getContext("2d").putImageData(tintImg, 0, 0);
    tintPushed = true;
  }

  /* THE CLAIM ANIMATION. The new colour does not appear, it SPREADS — from
     the frontier it was taken across, so you can see which way the war is
     moving without reading a word. Cheap by construction: each cell of the
     one region that changed gets a normalised distance from the attacker,
     and each frame only rewrites the cells whose threshold the wave has just
     passed. Nothing else in the ownership layer is touched. */
  const CLAIM_MS = 900;
  function startClaimAnim(r, from, to, fromRegionId) {
    if (!cellsOf.length || !cellsOf[r.idx]) return;
    if (FLAG_NOANIM || !open) {
      if (to) paintCells(cellsOf[r.idx], ownerColour(to)); else clearCells(cellsOf[r.idx]);
      tintPushed = false;
      return;
    }
    // the wave starts at the attacker's side of the border; with no attacker
    // (a first claim, or a snapshot) it blooms out of the region's middle
    let ox = r.lx, oz = r.lz, bloom = true;
    const src = fromRegionId ? T.byId(fromRegionId) : null;
    if (src) { ox = src.lx; oz = src.lz; bloom = false; }
    const cells = cellsOf[r.idx];
    const sp = new Float32Array(cells.length);
    let lo = 1e18, hi = -1e18;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const k = c % GS, j = (c - k) / GS;
      const x = -BOUNDS + (k + 0.5) * CELL, z = -BOUNDS + (j + 0.5) * CELL;
      const d = Math.hypot(x - ox, z - oz);
      sp[i] = d;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < cells.length; i++) sp[i] = (sp[i] - lo) / span;
    // remove any animation still running on this region — a region taken
    // twice in one tick must not have two waves crossing it
    anims = anims.filter(function (a) { return a.idx !== r.idx; });
    anims.push({ idx: r.idx, from: from, to: to, t0: now(), cells: cells, sp: sp,
                 done: new Uint8Array(cells.length), bloom: bloom });
  }
  function stepAnims() {
    if (!anims.length) return false;
    const tNow = now();
    let touched = false;
    for (let a = anims.length - 1; a >= 0; a--) {
      const an = anims[a];
      const t = clamp((tNow - an.t0) / CLAIM_MS, 0, 1);
      const e = t * t * (3 - 2 * t);
      const col = an.to ? ownerColour(an.to) : 0;
      for (let i = 0; i < an.cells.length; i++) {
        if (an.done[i] || an.sp[i] > e) continue;
        an.done[i] = 1;
        const o = an.cells[i] * 4;
        if (an.to) { tintPx[o] = (col >> 16) & 255; tintPx[o + 1] = (col >> 8) & 255; tintPx[o + 2] = col & 255; tintPx[o + 3] = 255; }
        else tintPx[o + 3] = 0;
        touched = true;
      }
      if (t >= 1) anims.splice(a, 1);
    }
    if (touched) tintPushed = false;
    return true;
  }

  const TOP_INSET = 112, BOT_INSET = 178;   // the header strip and the card
  function fitView(w, h) {
    const D = W.desert;
    const R = (D && D.RADIUS) || 6700;
    const uh = Math.max(140, h - TOP_INSET - BOT_INSET);
    view.mpp = (R * 2.22) / Math.max(1, Math.min(w, uh));
    view.cx = 0;
    // put the island's middle in the middle of the BAND, not of the viewport
    view.cz = (h / 2 - TOP_INSET - uh / 2) * view.mpp;
    viewVer++;
  }
  function sx(x, w) { return (x - view.cx) / view.mpp + w / 2; }
  function sy(z, h) { return (z - view.cz) / view.mpp + h / 2; }
  function wxAt(px, w) { return (px - w / 2) * view.mpp + view.cx; }
  function wzAt(py, h) { return (py - h / 2) * view.mpp + view.cz; }

  function refreshContested() {
    const t = now();
    if (t - contestedAt < 900) return;
    contestedAt = t;
    const st = tState();
    const out = [];
    for (let i = 0; i < REG.length; i++) {
      const r = REG[i];
      const own = st.own[r.id] || null;
      if (!own) continue;
      const p = pressureOn(r);
      if (!p) continue;
      if (W.odds(p.force, defenceOf(r)) < 0.5) continue;
      out.push({ idx: r.idx, by: p.owner });
    }
    const key = out.map(function (o) { return o.idx + o.by; }).join("|");
    if (key !== contested._key) { contested = out; contested._key = key; contestedVer++; }
  }

  /* THE STROKED GEOMETRY, CACHED. Rebuilt only when the view moves or
     ownership changes — the first draft rebuilt 20 000 line segments every
     frame and the phone frame ran at 14 fps for no reason at all. */
  function buildPaths(w, h) {
    const t = tState();
    const own = [];
    for (let i = 0; i < REG.length; i++) own.push(t.own[REG[i].id] || null);
    const hair = new Path2D();
    const casing = new Path2D();
    const byColour = {};
    const BW = 2.6;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.a < 0 || s.b < 0) continue;
      const x1 = sx(s.x1, w), y1 = sy(s.z1, h), x2 = sx(s.x2, w), y2 = sy(s.z2, h);
      if ((x1 < -20 && x2 < -20) || (y1 < -20 && y2 < -20) || (x1 > w + 20 && x2 > w + 20) || (y1 > h + 20 && y2 > h + 20)) continue;
      hair.moveTo(x1, y1); hair.lineTo(x2, y2);
      const oa = own[s.a], ob = own[s.b];
      if (oa === ob) continue;
      casing.moveTo(x1, y1); casing.lineTo(x2, y2);
      // offset half a stroke to each side, along the edge's own normal
      for (let side = 0; side < 2; side++) {
        const me = side === 0 ? oa : ob;
        if (!me) continue;
        const sg = side === 0 ? -1 : 1;
        const ox = s.ax ? 0 : sg * BW * 0.5, oy = s.ax ? sg * BW * 0.5 : 0;
        const key = ownerColour(me);
        const p = byColour[key] || (byColour[key] = new Path2D());
        p.moveTo(x1 + ox, y1 + oy); p.lineTo(x2 + ox, y2 + oy);
      }
    }
    // contested frontiers get their own dashed path, drawn crawling
    const hot = {};
    for (let c = 0; c < contested.length; c++) hot[contested[c].idx] = contested[c].by;
    const hotPaths = {};
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.a < 0 || s.b < 0) continue;
      const oa = own[s.a], ob = own[s.b];
      if (oa === ob) continue;
      let by = null;
      if (hot[s.a] && hot[s.a] === ob) by = ob;
      else if (hot[s.b] && hot[s.b] === oa) by = oa;
      if (!by) continue;
      const key = ownerColour(by);
      const p = hotPaths[key] || (hotPaths[key] = new Path2D());
      p.moveTo(sx(s.x1, w), sy(s.z1, h)); p.lineTo(sx(s.x2, w), sy(s.z2, h));
    }
    // the selection ring
    let sel = null;
    if (selected) {
      sel = new Path2D();
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.a !== selected.idx && s.b !== selected.idx) continue;
        sel.moveTo(sx(s.x1, w), sy(s.z1, h)); sel.lineTo(sx(s.x2, w), sy(s.z2, h));
      }
    }
    paths = { hair: hair, casing: casing, byColour: byColour, hot: hotPaths, sel: sel, bw: BW, own: own };
  }

  function draw() {
    raf = 0;
    if (!open || !cv || !g2) return;
    const dpr = cv._dpr || 1;
    const w = cv.width / dpr, h = cv.height / dpr;
    const g = g2;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* THE OCEAN OUTSIDE THE TEXTURE. desert.js's mapTexture only covers the
       16.6 km bounds square; the first draft filled the rest with a darker
       blue and the square edge was plainly visible in the sea. This is that
       texture's own deepest colour (20,70,110), so there is no seam. */
    g.fillStyle = "#144670";
    g.fillRect(0, 0, w, h);

    const D = W.desert;
    if (!D || !REG.length) { schedule(false); return; }
    refreshContested();
    stepAnims();
    tintPush();

    const dx = sx(-BOUNDS, w), dy = sy(-BOUNDS, h), dw = (BOUNDS * 2) / view.mpp;

    /* 1. THE ISLAND. 512 is desert.js's own cache size and campaign's minimap
       already asked for it, so this is free after the first call. Guarded: an
       in-progress desert.js with no mapTexture must cost the ownership map
       its backdrop, not its existence. */
    let painted = false;
    try {
      const src = D.mapTexture && D.mapTexture(512);
      if (src) { g.imageSmoothingEnabled = true; g.drawImage(src, dx, dy, dw, dw); painted = true; }
    } catch (e) {}
    if (!painted && cellRegion) {
      g.fillStyle = "#b99a63";
      const s = dw / GS;
      for (let j = 0; j < GS; j++) for (let k = 0; k < GS; k++) {
        if (cellRegion[j * GS + k] >= 0) g.fillRect(dx + k * s, dy + j * s, s + 0.7, s + 0.7);
      }
    }

    /* 2. THE WASH */
    if (tintCv) {
      g.save();
      g.globalAlpha = 0.46;
      g.imageSmoothingEnabled = true;
      g.drawImage(tintCv, dx, dy, dw, dw);
      g.restore();
    }

    /* 3. THE FRONTIERS */
    const key = viewVer + ":" + ownVer + ":" + contestedVer + ":" + (selected ? selected.idx : -1);
    if (key !== pathsKey) { buildPaths(w, h); pathsKey = key; }
    if (paths) {
      g.lineCap = "butt";
      g.strokeStyle = "rgba(20,14,8,.28)"; g.lineWidth = 1;
      g.stroke(paths.hair);
      g.strokeStyle = "rgba(10,7,4,.72)"; g.lineWidth = paths.bw * 2 + 1.4;
      g.stroke(paths.casing);
      const keys = Object.keys(paths.byColour);
      g.lineWidth = paths.bw;
      for (let i = 0; i < keys.length; i++) {
        g.strokeStyle = rgba(+keys[i], 0.96);
        g.stroke(paths.byColour[keys[i]]);
      }
      /* A CONTESTED BORDER CRAWLS. It is the one thing on this map that has
         to be legible without tapping anything: white marching ants in the
         attacker's colour mean "this is being taken off somebody right now". */
      const hk = Object.keys(paths.hot);
      if (hk.length) {
        g.save();
        g.setLineDash([6, 7]);
        g.lineDashOffset = -(now() / 42) % 13;
        g.lineWidth = paths.bw + 1.6;
        for (let i = 0; i < hk.length; i++) {
          g.strokeStyle = rgba(+hk[i], 0.5 + 0.45 * (0.5 + 0.5 * Math.sin(now() / 260)));
          g.stroke(paths.hot[hk[i]]);
        }
        g.restore();
      }
      if (paths.sel) {
        g.save();
        g.setLineDash([7, 5]);
        g.strokeStyle = "rgba(255,255,255,.92)"; g.lineWidth = 2.6;
        g.stroke(paths.sel);
        g.restore();
      }
    }

    /* 4. THE PIECES */
    const st = S();
    const own = paths ? paths.own : [];
    const O = D.oases || [];
    for (let i = 0; i < O.length; i++) {
      const px = sx(O[i].x, w), py = sy(O[i].z, h);
      g.fillStyle = "#39d0a8";
      g.beginPath(); g.arc(px, py, 3.6, 0, TAU); g.fill();
      g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 1; g.stroke();
    }
    const OP = st.outposts || [];
    g.strokeStyle = "rgba(0,0,0,.6)"; g.lineWidth = 1;
    for (let i = 0; i < OP.length; i++) {
      const px = sx(OP[i].x, w), py = sy(OP[i].z, h);
      g.fillStyle = "#ffb15a";
      g.beginPath(); g.rect(px - 3.6, py - 3.6, 7.2, 7.2); g.fill(); g.stroke();
    }
    /* WARBANDS, SIZED BY REAL STRENGTH. A six-man crew and a three-hundred
       man army must not be the same dot — the single most useful thing a
       strategic map can tell you. Cube root rather than square root because
       core's band sizes span 2..320 and a square root still let the armies
       eat the island. */
    const B = st.bands || [];
    for (let i = 0; i < B.length; i++) {
      const b = B[i];
      const px = sx(b.x, w), py = sy(b.z, h);
      if (px < -30 || py < -30 || px > w + 30 || py > h + 30) continue;
      const r = 2.4 + Math.pow(Math.max(1, W.bandPower(b)), 0.34) * 1.35;
      g.fillStyle = rgba(b.colour || ownerColour(b.faction), b.mood === "hunt" ? 0.98 : 0.82);
      g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill();
      g.strokeStyle = "rgba(10,7,4,.75)"; g.lineWidth = 1.2; g.stroke();
    }
    for (let i = 0; i < REG.length; i++) {
      const n = T.garrisonSize(REG[i].id);
      if (!n) continue;
      const px = sx(REG[i].lx, w), py = sy(REG[i].lz, h) + 15;
      g.fillStyle = rgba(ownerColour(own[i]), 0.95);
      g.strokeStyle = "rgba(10,7,4,.8)"; g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(px, py - 6); g.lineTo(px + 5, py - 3); g.lineTo(px + 5, py + 2);
      g.lineTo(px, py + 6); g.lineTo(px - 5, py + 2); g.lineTo(px - 5, py - 3);
      g.closePath(); g.fill(); g.stroke();
    }
    const peers = st.peers || {};
    Object.keys(peers).forEach(function (k) {
      const p = peers[k];
      if (!p || p.x == null) return;
      g.strokeStyle = "#7fa8c8"; g.lineWidth = 2;
      g.beginPath(); g.arc(sx(p.x, w), sy(p.z, h), 6, 0, TAU); g.stroke();
    });
    const mex = sx(st.you.x, w), mey = sy(st.you.z, h);
    g.strokeStyle = "#fff"; g.lineWidth = 2.4;
    g.beginPath(); g.arc(mex, mey, 8, 0, TAU); g.stroke();
    g.fillStyle = hex(YOU_COLOUR);
    g.beginPath(); g.arc(mex, mey, 3.4, 0, TAU); g.fill();

    /* THE LABELS turn a coloured blob into a place. Only drawn when a region
       is actually big enough on screen to carry one — the first draft printed
       all twenty-two at every zoom and the fit-to-island view was text soup. */
    /* THE LABELS turn a coloured blob into a place, and they are the part of
       this map that was actually broken in the first photograph: every
       holding printed its name AND its income at fit zoom, four of them
       collided along the north coast, and the top of the island was an
       unreadable pile of words. Two rules fix it and both are measured
       against the drawn text rather than guessed — biggest holding gets the
       label, and a label that would overlap one already placed is dropped.
       The income line is a detail, so it only appears when the holding is
       big enough on screen to have room under its own name. */
    g.textAlign = "center";
    g.textBaseline = "middle";
    const order = [];
    for (let i = 0; i < REG.length; i++) {
      const onPx = Math.sqrt(REG[i].areaKm2 * 1e6) / view.mpp;
      if (onPx < 54) continue;
      order.push({ i: i, onPx: onPx });
    }
    order.sort(function (a, b) { return b.onPx - a.onPx; });
    const taken = [];
    if (selected) {
      // the tapped holding always gets its name, whatever else is crowding it
      for (let k = 0; k < order.length; k++) if (order[k].i === selected.idx) { order.unshift(order.splice(k, 1)[0]); break; }
    }
    for (let k = 0; k < order.length; k++) {
      const r = REG[order[k].i], onPx = order[k].onPx;
      const px = sx(r.lx, w), py = sy(r.lz, h);
      if (px < -70 || py < TOP_INSET - 26 || px > w + 70 || py > h + 40) continue;
      const o = own[order[k].i];
      const size = clamp(onPx / 7.5, 9.5, 16);
      const sub = onPx > 116 ? ("$" + T.regionIncome(r) + (o ? " · " + ownerLabel(o) : " · UNCLAIMED")) : null;
      g.font = "800 " + size.toFixed(1) + "px ui-sans-serif,system-ui,-apple-system,sans-serif";
      const tw = g.measureText(r.name).width;
      const box = { x0: px - tw / 2 - 4, x1: px + tw / 2 + 4,
                    y0: py - size * 0.8, y1: py + (sub ? size * 1.7 : size * 0.8) };
      let clash = false;
      for (let q = 0; q < taken.length; q++) {
        const b = taken[q];
        if (box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0) { clash = true; break; }
      }
      if (clash) continue;
      taken.push(box);
      g.lineWidth = 3.4;
      g.strokeStyle = "rgba(8,6,4,.85)";
      g.strokeText(r.name, px, py);
      g.fillStyle = o ? hex(ownerColour(o)) : "rgba(244,236,216,.7)";
      g.fillText(r.name, px, py);
      if (sub) {
        g.font = "700 " + (size * 0.66).toFixed(1) + "px ui-sans-serif,system-ui,sans-serif";
        g.lineWidth = 2.8;
        g.strokeStyle = "rgba(8,6,4,.82)";
        g.strokeText(sub, px, py + size * 1.16);
        g.fillStyle = "rgba(244,236,216,.8)";
        g.fillText(sub, px, py + size * 1.16);
      }
    }
    g.textAlign = "left";
    g.textBaseline = "alphabetic";

    /* THE NEWS LINE. Somebody took something while you were looking at the
       map: say so, in their colour, for three seconds. This is what "watch it
       change" means when the change happened off screen. */
    const age = now() - newsAt;
    if (newsText && age < 3400) {
      const a = clamp(1 - (age - 2600) / 800, 0, 1);
      g.save();
      g.globalAlpha = a;
      g.font = "800 13px ui-sans-serif,system-ui,sans-serif";
      const tw = g.measureText(newsText).width;
      g.fillStyle = "rgba(8,6,4,.82)";
      g.fillRect(w / 2 - tw / 2 - 12, h - 118, tw + 24, 26);
      g.fillStyle = hex(newsColour);
      g.textAlign = "center";
      g.fillText(newsText, w / 2, h - 100);
      g.textAlign = "left";
      g.restore();
    }

    /* THE FRAME BUDGET. Ownership is changing in real time, so this loop does
       not stop — but an idle map with nothing animating does not need 60 Hz
       either, and on a phone that was the difference between a warm handset
       and a cool one. Full rate while something is moving, 20 Hz when not. */
    schedule(anims.length || (now() - lastInteract < 900) || (now() - newsAt < 3400));
  }
  function schedule(busy) {
    if (!open || raf || slow) return;
    if (busy) raf = requestAnimationFrame(draw);
    else slow = setTimeout(function () { slow = 0; raf = requestAnimationFrame(draw); }, 45);
  }
  function kick() { schedule(true); }
  function touch() { lastInteract = now(); kick(); }

  /* ============================================================ THE SCREEN */
  const CSS =
    '#wlTerr{position:fixed;inset:0;z-index:5;display:flex;flex-direction:column;' +
      'background:#144670;overscroll-behavior:none;touch-action:none}' +
    '#wlTerrCv{position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab}' +
    '#wlTerrCv:active{cursor:grabbing}' +
    '#wlTerrTop{position:relative;z-index:2;display:flex;gap:10px;align-items:center;' +
      'padding:calc(env(safe-area-inset-top,0px) + 42px) 13px 8px;' +
      'background:linear-gradient(rgba(8,6,4,.88),rgba(8,6,4,0));pointer-events:none}' +
    '#wlTerrTop b{font:800 15px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.1em;white-space:nowrap}' +
    '#wlTerrTop .chip{font:700 11px/1.3 ui-sans-serif,system-ui,sans-serif;letter-spacing:.14em;opacity:.82}' +
    '#wlTerrTop .sp{flex:1}' +
    '#wlTerrTop button{pointer-events:auto}' +
    /* THE SHARE BAR is the legend, and it is a legend you do not have to
       read: one strip, one block per warlord, width = how much of the island
       he holds. Who is winning, at a glance, with no words in it. */
    '#wlTerrShare{position:relative;z-index:2;margin:0 13px 8px;height:12px;border-radius:6px;overflow:hidden;' +
      'display:flex;border:1px solid rgba(255,255,255,.18);background:rgba(8,6,4,.5)}' +
    '#wlTerrShare i{display:block;height:100%;transition:width .5s cubic-bezier(.2,.8,.2,1)}' +
    '#wlTerrCard{position:relative;z-index:2;margin-top:auto;' +
      'padding:12px 13px calc(env(safe-area-inset-bottom,0px) + 13px);' +
      'background:linear-gradient(rgba(8,6,4,0),rgba(8,6,4,.9) 24%);pointer-events:none}' +
    '#wlTerrCard .in{pointer-events:auto;max-width:620px;margin:0 auto;' +
      'border:1px solid rgba(255,255,255,.14);border-radius:14px;background:rgba(18,14,9,.92);padding:11px 13px}' +
    '#wlTerrCard h3{margin:0 0 2px;font:800 17px/1.1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.02em}' +
    '#wlTerrCard .who{font:700 11px/1.5 ui-sans-serif,system-ui,sans-serif;letter-spacing:.18em}' +
    '#wlTerrCard .facts{display:flex;gap:13px;flex-wrap:wrap;margin:7px 0 1px;' +
      'font:700 11px/1.4 ui-sans-serif,system-ui,sans-serif;letter-spacing:.09em;opacity:.74}' +
    '#wlTerrCard .facts b{color:#ffd166}' +
    '#wlTerrCard .wl-btns{margin-top:9px}' +
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
        '<div id="wlTerrShare"></div>' +
        '<div id="wlTerrCard"><div class="in" id="wlTerrCardIn">' +
          '<div id="wlTerrHint">TAP A HOLDING</div>' +
        '</div></div>' +
      '</div>';
  }

  function paintShare() {
    const box = document.getElementById("wlTerrShare");
    if (!box) return;
    const ids = T.ownerList();
    const total = Math.max(1, REG.length);
    let html = "";
    for (let i = 0; i < ids.length; i++) {
      const n = T.held(ids[i]).length;
      if (!n) continue;
      html += '<i title="' + ownerLabel(ids[i]) + '" style="width:' + (n / total * 100).toFixed(2) +
              '%;background:' + hex(ownerColour(ids[i])) + '"></i>';
    }
    const free = T.held(null).length;
    if (free) html += '<i style="width:' + (free / total * 100).toFixed(2) + '%;background:rgba(120,108,90,.42)"></i>';
    box.innerHTML = html;
    const hold = document.getElementById("wlTerrHold");
    if (hold) {
      const mine = T.held("you");
      hold.textContent = mine.length + "/" + REG.length + " HELD · +$" + T.income("you") + "/DAY";
    }
  }

  /* THE CARD. Everything you can do on this screen is on it, and there are at
     most three buttons — "ultra simple controls" is a hard requirement of
     this game, and a strategic map is exactly where a build queue would grow
     if it were allowed to. Look, tap, ride, garrison. That is the whole UI. */
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
    let risk = "";
    if (p) {
      const odds = W.odds(p.force, defenceOf(r));
      if (o === "you") {
        risk = odds > 0.5
          ? '<div class="who" style="color:#ffc9c4">' + ownerLabel(p.owner) + ' CAN TAKE THIS — GARRISON IT</div>'
          : '<div class="who" style="color:rgba(244,236,216,.45)">' + ownerLabel(p.owner) + ' PRESSES THE BORDER · YOU HOLD</div>';
      } else if (odds > 0.5) {
        risk = '<div class="who" style="color:rgba(244,236,216,.45)">' + ownerLabel(p.owner) + ' IS TAKING THIS</div>';
      }
    }
    let btns = '<div class="wl-btns">';
    btns += '<button class="wl-btn' + (o === "you" ? '' : ' hot') + '" id="wlTerrRide">RIDE HERE</button>';
    if (o === "you") {
      if (inIt) {
        btns += '<button class="wl-btn" id="wlTerrGarM"' + (gsz ? "" : " disabled") + '>&minus;10 MEN</button>';
        btns += '<button class="wl-btn" id="wlTerrGarP"' + (st.army.length ? "" : " disabled") + '>+10 MEN</button>';
      } else {
        btns += '<span class="wl-small wl-dim" style="align-self:center">RIDE THERE TO GARRISON IT</span>';
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
     guns on their backs (removeSoldier's keepKit:false — otherwise the cart
     eats the rifle and the man is handed a stick). Weakest first: you leave
     levies to hold a well and take veterans with you, which is what every
     player does anyway and what the tier sort makes free. */
  function moveGarrison(r, n) {
    const t = tState();
    const st = S();
    const list = t.gar[r.id] = t.gar[r.id] || [];
    let moved = 0;
    if (n > 0) {
      const pool = st.army.slice().sort(function (a, b) { return W.tierIndex(a.tier) - W.tierIndex(b.tier); });
      for (let i = 0; i < pool.length && moved < n; i++) {
        const s = W.removeSoldier(pool[i].id, false);
        if (s) { list.push(s); moved++; }
      }
      if (moved) W.toast(moved + " MEN HOLD " + r.name);
    } else {
      while (list.length && moved < -n) { W.addSoldier(list.pop()); moved++; }
      if (moved) W.toast(moved + " MEN BACK IN THE COLUMN");
    }
    if (!list.length) delete t.gar[r.id];
    delete t.gp[r.id];
    if (W.save) W.save();
    bump();
    paintCard(); paintShare(); touch();
  }

  function sizeCanvas() {
    if (!cv) return;
    const dpr = Math.min(2, G.devicePixelRatio || 1);
    const w = cv.clientWidth || G.innerWidth, h = cv.clientHeight || G.innerHeight;
    cv.width = Math.max(2, Math.round(w * dpr));
    cv.height = Math.max(2, Math.round(h * dpr));
    cv._dpr = dpr;
    viewVer++;
  }

  /* PAN AND ZOOM ON BOTH HANDS. One pointer map serves mouse drag, one-finger
     touch pan and two-finger pinch — the only way to get this right once
     instead of writing a mouse path and a touch path that disagree. */
  function bind() {
    const pts = new Map();
    let drag = null, pinch = null, downT = 0, moved = 0;
    cv.addEventListener("pointerdown", function (e) {
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz }; downT = Date.now(); moved = 0; }
      else if (pts.size === 2) {
        const a = Array.from(pts.values());
        pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mpp: view.mpp };
        drag = null;
      }
      e.preventDefault();
      touch();
    });
    cv.addEventListener("pointermove", function (e) {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2 && pinch) {
        const a = Array.from(pts.values());
        const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        view.mpp = clampZoom(pinch.mpp * (pinch.d / Math.max(6, d)));
        viewVer++; touch();
        return;
      }
      if (!drag) return;
      const ddx = e.clientX - drag.x, ddy = e.clientY - drag.y;
      moved = Math.max(moved, Math.hypot(ddx, ddy));
      view.cx = drag.cx - ddx * view.mpp;
      view.cz = drag.cz - ddy * view.mpp;
      clampView(); viewVer++; touch();
    });
    function up(e) {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size && drag) {
        /* A press that did not move is a SELECT — campaign.js's own 8px/380ms
           gate, so tap-to-pick and drag-to-pan never fight on a thumb. */
        if (moved <= 9 && Date.now() - downT < 420) {
          const rect = cv.getBoundingClientRect();
          selected = T.at(wxAt(e.clientX - rect.left, rect.width), wzAt(e.clientY - rect.top, rect.height)) || null;
          paintCard();
        }
        drag = null;
        touch();
      }
    }
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", function (e) {
      e.preventDefault();
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const bx = wxAt(mx, rect.width), bz = wzAt(my, rect.height);
      view.mpp = clampZoom(view.mpp * (e.deltaY > 0 ? 1.16 : 1 / 1.16));
      /* ZOOM ABOUT THE CURSOR, not the centre. Zooming to the middle of the
         island while you are looking at a corner is the single thing that
         makes a strategic map feel broken. */
      view.cx += bx - wxAt(mx, rect.width);
      view.cz += bz - wzAt(my, rect.height);
      clampView(); viewVer++; touch();
    }, { passive: false });
    G.addEventListener("resize", function () { if (open) { sizeCanvas(); touch(); } });
  }
  function clampZoom(m) {
    const D = W.desert;
    const R = (D && D.RADIUS) || 6700;
    const w = cv ? (cv.clientWidth || G.innerWidth) : 900;
    const h = cv ? (cv.clientHeight || G.innerHeight) : 600;
    return clamp(m, 3.2, (R * 2.6) / Math.max(1, Math.min(w, h)));
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
       the compass and under the very button that opened it. Raising the
       stage for the life of this screen and putting it back on close is one
       line and touches nobody else's file; hiding the campaign HUD is the
       other half, because a compass over a strategic map is noise. */
    const stg = ctx.stage || document.getElementById("stage");
    if (stg) { stageZ = stg.style.zIndex; stg.style.zIndex = "66"; }
    hidden = document.getElementById("wlCampHud");
    if (hidden) hidden.style.display = "none";
    const oldMap = document.getElementById("wlMap");
    if (oldMap) oldMap.classList.remove("on");

    cv = document.getElementById("wlTerrCv");
    g2 = cv.getContext("2d");
    sizeCanvas();
    /* OPEN ON THE WHOLE ISLAND. The first draft opened offset toward the
       player and the map's first frame was a corner of a coastline — which
       is the one thing a strategic map must never be. Where you are is a dot
       on it; what everybody holds is the picture. */
    fitView(cv.clientWidth || G.innerWidth, cv.clientHeight || G.innerHeight);
    clampView();
    bind();
    tintFull();
    pathsKey = "";
    const me = S().you;
    selected = (me && T.at(me.x, me.z)) || null;
    paintShare(); paintCard();
    document.getElementById("wlTerrClose").onclick = close;
    document.getElementById("wlTerrFit").onclick = function () {
      fitView(cv.clientWidth, cv.clientHeight); touch();
    };
    touch();
    W.emit("territory:open", null);
  }
  function close() {
    if (!open) return;
    open = false;
    if (raf) { try { cancelAnimationFrame(raf); } catch (e) {} raf = 0; }
    if (slow) { clearTimeout(slow); slow = 0; }
    anims.length = 0;
    tintFull();                       // finish any half-spread claim instantly
    const ctx = T.ctx;
    if (ctx && ctx.closeScreen) ctx.closeScreen();
    const stg = ctx && (ctx.stage || document.getElementById("stage"));
    if (stg) stg.style.zIndex = stageZ || "";
    if (hidden) hidden.style.display = "";
    hidden = null; cv = null; g2 = null; paths = null; pathsKey = "";
    W.emit("territory:close", null);
  }
  T.open = open_;
  T.close = close;
  T.toggle = function () { if (open) close(); else open_(); };
  T.isOpen = function () { return open; };
  /* match.js and events.js both want "show them what just happened": open the
     map already looking at one holding, with its card up. */
  T.focus = function (regionId, zoom) {
    const r = T.byId(regionId);
    if (!r) return false;
    if (!open) open_();
    if (!open) return false;
    view.cx = r.lx; view.cz = r.lz;
    if (zoom !== false) view.mpp = clampZoom(Math.sqrt(r.areaKm2 * 1e6) / Math.max(1, Math.min(cv.clientWidth, cv.clientHeight)) * 2.4);
    clampView(); viewVer++;
    selected = r;
    paintCard(); touch();
    return true;
  };

  // ownership can change while the screen is up, from anywhere
  W.on("territory:claim", function () { if (open) { paintShare(); paintCard(); touch(); } });

  /* ============================================================ THE DEMO
     `?map=1` opens the strategic map straight from the title with a plausible
     spread on it. It exists because this file has to be photographable before
     campaign.js, army.js, battle.js and match.js have agreed to call any of
     it — an agent blocked on four other agents ships nothing. It is also the
     only way to get the day-one / mid / late pictures the presentation needs
     out of one page load. */
  T.demo = function (stage) {
    ensure();
    const t = tState();
    ensureOwnState(true);
    const F = W.FACTIONS || [];
    if (stage !== "day1") {
      /* Hashed, not rolled, so the three photographs are of the same island
         at three moments rather than three different islands. */
      const mid = stage !== "late";
      for (let i = 0; i < REG.length; i++) {
        const r = REG[i];
        if (t.own[r.id]) continue;
        const h = W.hash01(r.x, r.z, mid ? 8801 : 8802);
        if (mid) {
          if (h < 0.17) t.own[r.id] = "you";
          else if (h < 0.74) t.own[r.id] = F[Math.floor(h * 997) % F.length].id;
        } else {
          if (h < 0.58) t.own[r.id] = "you";
          else if (h < 0.92) t.own[r.id] = F[Math.floor(h * 997) % F.length].id;
        }
      }
      const mine = T.held("you");
      for (let i = 0; i < mine.length; i += 2) t.gp[mine[i].id] = 40 + i * 13;
    }
    bump(); tintFull(); pathsKey = "";
    if (open) { paintShare(); paintCard(); touch(); }
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
      snapshotBytes: JSON.stringify(T.snapshot()).length,
      names: REG.map(function (r) { return r.name; }),
      flags: { off: FLAG_OFF, nowar: FLAG_NOWAR, oldmap: FLAG_OLDMAP, noanim: FLAG_NOANIM },
    };
  };

  /* ============================================================ BOOT */
  T.needs = ["desert"];
  T.boot = function (ctx) {
    T.ctx = ctx;
    void root;
    if (FLAG_OFF) {
      try { console.log("[warlord/territory] ?terr=off — no regions, campaign keeps its map"); } catch (e) {}
      return;
    }

    /* TAKE THE MAP BUTTON. campaign.js already owns a MAP button and a flat
       island overlay; two maps in one game is the drift CLAUDE.md is written
       against, so this swallows the click on the way DOWN and opens the real
       one. Registered at boot, which is before campaign.enter() binds
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
        if (W.phase() !== "campaign" && !open) return;
        e.stopPropagation();
        T.toggle();
      }, true);
    }

    /* AND THEN STOP THE CAMPAIGN FEELING THE MAP. campaign.js listens for
       pointers and the wheel in the CAPTURE phase on window, gated only on
       `live` — which is still true while this screen is up. Every pan of the
       strategic map was also spinning the 3D camera and every pinch was
       zooming it, invisibly, and the player came back to a world that had
       moved. Registered at boot so it lands ahead of campaign's own. */
    ["pointerdown", "pointermove", "pointerup", "pointercancel", "wheel"].forEach(function (ev) {
      G.addEventListener(ev, function (e) { if (open) e.stopPropagation(); }, true);
    });

    W.on("dawn", dawn);
    W.on("newgame", function () {
      S().territory = { own: {}, gar: {}, gp: {}, taken: {}, press: {} };
      builtSeed = null; REG.length = 0; selected = null; anims.length = 0;
      // regions are built lazily on first use: newGame runs before the island
    });
    W.on("loaded", function () { builtSeed = null; REG.length = 0; selected = null; anims.length = 0; });
    W.on("campaign:ready", function () { ensure(); });
    W.on("outpost:place", function () { bump(); });
    /* THE BATTLE HOOK THAT WORKS TODAY. army.js already publishes the whole
       aftermath report as the phase payload, so this needs nothing from
       anybody: won a fight standing on somebody's ground, take the ground.
       T.onBattleWon stays published for battle.js/army.js to call explicitly
       once they want to — calling it twice is a no-op, because the second
       call finds the region already yours. */
    W.on("phase:aftermath", function (r) { try { T.onBattleWon(r); } catch (e) {} });

    if (ctx.Q && ctx.Q.get("audit") === "1") {
      setTimeout(function () { try { console.log("[warlord/territory]", T.audit()); } catch (e) {} }, 0);
    }

    /* THE DEBUG ENTRY. Deferred a tick so the shell's own ?go=1 has already
       started a game and campaign.js has had its chance to raise the island. */
    if (ctx.Q && ctx.Q.get("map") === "1") {
      setTimeout(function () {
        const p = W.phase();
        if (p === "menu" || p === "boot") {
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
