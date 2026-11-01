/* ============================================================
   city/storegoods.js — A SHOP FLOOR THAT READS AS A SHOP.

   OWNER: "gun store having all the real guns for sale on shelves ... i dont
   want a store with a bunch of fake shit why should that even be built." And
   2026-09-27, the de-slop wave: "de-slopify every surface and prop ...
   furniture arranged like real people arrange rooms."

   WHAT THIS FILE REPLACED. The first cut of it stood three grey 2 m boxes a
   side and put TWO scaled-up item models on each board: a 22 cm apple, a
   burger the size of a loaf, round red and yellow blobs spaced a metre apart
   down the far walls of a 28 m hall whose middle was empty floor. From the
   door it read as a warehouse somebody had forgotten to stock. (And
   buildings.js's furnishShop, under it, had been painting rows of 22 cm
   coloured cubes on wall shelves whose own clearance gate never let a single
   one land. That dead code is deleted in the same wave.)

   WHAT A SHOP FLOOR IS, AND SO WHAT THIS FILE STANDS:
     - WALL BAYS down both side walls: a continuous run of 1.25 m sections on
       a perforated back panel, slotted uprights at every section, a base deck
       on a kick plate, four boards with a price channel on every lip and a
       header panel along the top. Full, not sparse.
     - GONDOLA AISLES through the middle: double-sided runs 1.6 m tall (you can
       see over them to the counter), end caps at both ends, broken by a cross
       aisle, and a clear main aisle from the door to the till.
     - A REACH-IN COOLER BANK where the trade sells drinks: black frame, glass
       doors with handles, lit interior, wire shelves, bottles and cans.
     - A COFFEE STATION at a gas station / corner store; a HOT FOOD WARMER on
       the counter where the trade sells hot food.
     - GOODS THAT READ AS GOODS: cereal boxes, cans, bottles, chip bags, jars,
       pill bottles, boxed electronics, paint cans, cartons — real sizes, faced
       up to the front of the board in blocks of one product the way a shop is
       merchandised, a price ticket under every block. Drawn as a handful of
       InstancedMeshes over ONE shared label atlas (a detail texture + a tint
       mask, so a white label panel stays white on a red box).
     - THE REAL, BUYABLE STOCK (cityEcon.stockFor(kind)) as the game's real
       item models (CBZ.itemAsset) at their real size, at waist height: cold
       drinks in the cooler, hot food in the warmer, coffee on the coffee
       station, everything else on the wall bays. [E] takes it off the shelf
       (in your hand until you pay at the counter or put it back; out of the
       door with it is a theft, through CBZ.shopFloor.till), and a bought
       unit leaves the shelf until the daily restock.

   COST. Nothing here is eager: a store's fixtures, goods and real stock are
   built only for the few stores near you (MAX_LIVE), as ~2 merged fixture
   meshes + ~12 instanced goods batches + one merged mesh per stocked product,
   with the fixtures solid (colliders pushed while live, removed after). The
   goods are drawn only inside SHOW_R. No lights: the ceiling fit-out
   (fitout_work.js) owns the troffers; these materials take the same night
   self-lit share the fit-out surfaces do, so a lit shop at night is lit.

   Everything is authored in BUILDING-LOCAL coordinates and parented to the
   shell's own group (a town's translated root included); world numbers are
   derived from the shell's matrixWorld (refreshWorld).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE || !CBZ.onUpdate) return;
  const THREE = window.THREE;

  // Kinds a FLAGSHIP walk-in already owns end to end (gunstore.js's wall,
  // jewelry.js's cases, clothingstore.js's racks, pawnshop.js, the realtor's office,
  // modshop/carlot showrooms), the civic counters, the bar, the bank — and the
  // trap house, which is a gang's front room, not a shop with gondolas.
  const SKIP = {
    guns: 1, jewelry: 1, pawn: 1, clothing: 1, boutique: 1, realtor: 1,
    carlot: 1, chop: 1, casino: 1, bar: 1, bank: 1, cityhall: 1, raceway: 1,
    courthouse: 1, federal: 1, cityannex: 1, postoffice: 1, dmv: 1,
    library: 1, firestation: 1, drugs: 1,
  };

  const LIVE_R = 48;        // a store BUILDS this far out (no pop-in at the glass)
  const SHOW_R = 26;        // …and DRAWS its goods only this close
  const MAX_LIVE = 3;       // never more than this many stores standing at once
  const REACH = 2.6;        // arm's length at the shelf
  // A STORE HAS A STOCK BUDGET, in units on the shelves and in the triangles
  // they cost (a phone draws this). Past it the boards left over stand EMPTY,
  // and the planner fills the eye-level boards first, so what goes bare is
  // the very top and the kick-plate deck, not the middle of an aisle.
  const UNIT_BUDGET = 2400;
  const TRI_BUDGET = 760000;

  /* ---- THE PLAN, PER TRADE ------------------------------------------------
     walls     which side walls get a run of bays (+1 / -1 on the tangent)
     wallStart how far in from the door wall the runs begin (the front corners
               keep the plant, the bin, the window display)
     lanes     gondola lanes PER SIDE of the main aisle
     cooler    reach-in cooler doors at the back of one wall run (0 = none)
     coffee    a coffee station at the front of the other run
     warmer    a hot-food case on the counter (roller-grill dogs, the slices) */
  const PROFILE = {
    store:       { walls: [-1, 1], wallStart: 3.4, lanes: 3, cooler: 5, coffee: false },
    gas:         { walls: [-1, 1], wallStart: 3.4, lanes: 3, cooler: 6, coffee: true, warmer: true },
    transit:     { walls: [-1, 1], wallStart: 3.4, lanes: 2, cooler: 4, coffee: true, warmer: true },
    food:        { walls: [-1, 1], wallStart: 10.6, lanes: 1, centreStart: 10.6, cooler: 4, coffee: false, warmer: true },
    hardware:    { walls: [-1, 1], wallStart: 4.4, lanes: 3, cooler: 0, coffee: false },
    electronics: { walls: [-1, 1], wallStart: 3.4, lanes: 2, cooler: 0, coffee: false },
    security:    { walls: [-1, 1], wallStart: 3.4, lanes: 2, cooler: 0, coffee: false },
    hospital:    { walls: [1], wallStart: 12.6, lanes: 0, cooler: 0, coffee: false },
    gym:         { walls: [1], wallStart: 10.6, lanes: 0, cooler: 3, coffee: false, maxBays: 5 },
    barber:      { walls: [1], wallStart: 8.2, lanes: 0, cooler: 0, coffee: false, maxBays: 3 },
    eyewear:     { walls: [-1, 1], wallStart: 3.4, lanes: 1, cooler: 0, coffee: false },
    arena:       { walls: [-1, 1], wallStart: 3.4, lanes: 2, cooler: 4, coffee: true, warmer: true },
    paintball:   { walls: [-1, 1], wallStart: 3.4, lanes: 2, cooler: 3, coffee: false },
    airfield:    { walls: [-1, 1], wallStart: 3.4, lanes: 2, cooler: 4, coffee: true },
  };
  const DEFAULT_PROFILE = PROFILE.store;

  // where the REAL catalog items stand, by what they are: the cold case, the
  // counter's hot case, the coffee station; everything else on the boards.
  // (Hot food and a poured coffee with no warmer / station to stand in are
  // not shelf goods: they stay on the counter's menu.)
  const COLD = { Soda: 1, "Energy Drink": 1, Water: 1, Milk: 1, Sandwich: 1 };
  const HOT = { Burger: 1, Hotdog: 1, "Pizza Slice": 1, Fries: 1 };
  const BREW = { Coffee: 1 };
  /* ---- FIXTURE DIMENSIONS (metres, above the finished floor) --------------- */
  const BAY = 1.25;                                     // one shelf section
  const WALL = { deep: 0.47, h: 2.2, top: 2.46, levels: [0.14, 0.56, 0.96, 1.50, 1.90] };
  const GOND = { half: 0.50, h: 1.60, levels: [0.14, 0.56, 0.96, 1.30], cap: 0.40 };
  const COOL = { deep: 0.82, h: 2.25, levels: [0.2, 0.56, 0.92, 1.28, 1.62] };
  const REAL_LEVEL = 2;                                 // index into WALL.levels: the 0.96 board
  const COL = {
    body: 0xdcddd8, upright: 0xb7b9b6, board: 0xe9e9e4, kick: 0x4c5056,
    rail: 0xc3c7ca, ticket: 0xf6f6f0, sale: 0xf0cf36, perf: 0xe4e5e1,
    coolFrame: 0x1e2124, coolWire: 0x8d9398, coolLight: 0xe6eef0, handle: 0xc9ced3,
    lam: 0x6f5642, stone: 0xd9d5cc, splash: 0x3b3431, black: 0x1c1d1f, steel: 0xaab0b5,
    warmLight: 0xffcf8f,
  };
  const HEADER = [0x2f5d8a, 0x8a3530, 0x2f7a4a, 0x7a5a2a, 0x4a3f78, 0x1f6f6a];

  const PLANS = [];
  // a streamed job's store plans go with it (core/citystream.js)
  if (CBZ.streamBus) CBZ.streamBus(PLANS, "storePlans");
  const BY_LOT = new WeakMap();
  const RECTS = new WeakMap();            // shell group -> local rects (fitout_work.js reads them)
  const S = { arena: null, live: [], scanT: 0, refreshed: false };
  const LIT = { value: 0.12 };           // night self-lit share (the fit-out's own formula)

  function econ() { return CBZ.cityEcon || null; }
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function hash01(x, z, k) { return CBZ.hash01 ? CBZ.hash01(x, z, k) : 0.5; }
  function today() { return (CBZ.paceDay ? CBZ.paceDay() : 0) | 0; }

  /* ============================================================
     0. SHARED MATERIALS + THE LABEL ATLAS (built once, never freed)
     ============================================================ */
  function litHook(mat, extra) {
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uSgLit = LIT;
      if (extra) extra(sh);
      sh.fragmentShader = sh.fragmentShader
        .replace("void main() {", "uniform float uSgLit;\nvoid main() {")
        .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uSgLit;");
    };
    return mat;
  }
  let _mats = null;
  function perfTex() {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d");
    x.fillStyle = "#e6e7e3"; x.fillRect(0, 0, 128, 128);
    x.fillStyle = "#6f7275";
    const p = 128 / 12;
    for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
      x.beginPath(); x.arc((i + 0.5) * p, (j + 0.5) * p, 1.7, 0, Math.PI * 2); x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function mats() {
    if (_mats) return _mats;
    const fix = litHook(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const perf = litHook(new THREE.MeshLambertMaterial({ vertexColors: true, map: perfTex() }));
    const glass = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.2, depthWrite: false });
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    // THE STOCK: every product on every shelf is its own baked catalog model
    // (CBZ.itemAssetBaked: the model's part colours as vertex colours), drawn
    // instanced through this one material. It takes the fit-out's night share
    // like the fixtures, so a lit shop's goods are lit with it.
    const stock = litHook(new THREE.MeshLambertMaterial({ vertexColors: true }));
    for (const m of [fix, perf, glass, glow, stock]) m._shared = true;
    _mats = { fix: fix, perf: perf, glass: glass, glow: glow, stock: stock };
    return _mats;
  }

  /* ---- WHAT A PRODUCT IS ON A SHELF -----------------------------------------
     A shelf holds NOTHING or a REAL catalog item. There is no other kind of
     goods in this file (2026-10-31; the owner: "I hate the gas stations when
     you put fake products. It should be empty shelves and then real assets,
     like an apple on the shelf that you can have in your inventory"). The
     label atlas of cereal boxes, cans, chip bags and jars that could not be
     bought is deleted. A product's shelf geometry is its item model, baked
     once (one geometry, vertex colours) and re-seated with its base at y = 0
     and centred on its footprint, at its REAL size: a water bottle is 21 cm
     tall on the shelf because it is 21 cm tall in your hand. */
  const PROTO = Object.create(null);           // name -> { geo, w, h, d, tris } | null
  function protoOf(name) {
    if (PROTO[name] !== undefined) return PROTO[name];
    PROTO[name] = null;
    if (!CBZ.itemAssetBaked) return null;
    let m = null;
    try { m = CBZ.itemAssetBaked(null, name); } catch (err) { m = null; }
    if (!m || !m.geometry || !m.geometry.attributes.position) return null;
    const src = m.geometry;
    if (!src.boundingBox) src.computeBoundingBox();
    const bb = src.boundingBox;
    if (!isFinite(bb.min.x) || !isFinite(bb.max.x)) return null;
    const geo = src.clone();
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    geo._shared = true;
    PROTO[name] = { geo: geo, w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y, d: bb.max.z - bb.min.z,
      tris: (geo.attributes.position.count / 3) | 0 };
    return PROTO[name];
  }

  /* ============================================================
     1. THE FIXTURE KIT — boxes into merge buckets (vertex colour)
     ============================================================ */
  const FACES = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const HC = new THREE.Color();
  function Kit(fy) {
    const B = Object.create(null);
    function bk(key) { return B[key] || (B[key] = { pos: [], nor: [], col: [], uv: [], idx: [] }); }
    // (x, y, z) = CENTRE, building-local.
    function box(key, x, y, z, w, h, d, hex) {
      if (!(w > 0.001 && h > 0.001 && d > 0.001)) return;
      const k = bk(key);
      HC.setHex(hex >>> 0);
      const hw = w / 2, hh = h / 2, hd = d / 2, ext = [hw, hh, hd];
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        if (f === 3 && y - hh <= fy + 0.01) continue;                     // no underside on the floor
        const nx = F.n[0], ny = F.n[1], nz = F.n[2];
        const cx = x + nx * hw, cy = y + ny * hh, cz = z + nz * hd;
        const uh = Math.abs(F.u[0]) * ext[0] + Math.abs(F.u[1]) * ext[1] + Math.abs(F.u[2]) * ext[2];
        const vh = Math.abs(F.v[0]) * ext[0] + Math.abs(F.v[1]) * ext[1] + Math.abs(F.v[2]) * ext[2];
        const base = k.pos.length / 3;
        for (let q = 0; q < 4; q++) {
          const su = (q === 0 || q === 3) ? -1 : 1, sv = q < 2 ? -1 : 1;
          const px = cx + F.u[0] * su * uh + F.v[0] * sv * vh;
          const py = cy + F.u[1] * su * uh + F.v[1] * sv * vh;
          const pz = cz + F.u[2] * su * uh + F.v[2] * sv * vh;
          k.pos.push(px, py, pz); k.nor.push(nx, ny, nz);
          // contact shade: the foot of every vertical face, the underside of boards
          let s = 1;
          if (ny === 0) { const up = py - fy; if (up < 0.3) s = 0.7 + 0.3 * Math.max(0, up / 0.3); }
          else if (ny < 0) s = 0.78;
          k.col.push(HC.r * s, HC.g * s, HC.b * s);
          if (key === "perf") {
            const U = nx ? pz : px, V = ny ? pz : py;
            k.uv.push(U / 0.3, V / 0.3);
          }
        }
        k.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    function finish(group) {
      const M = mats(), out = [];
      for (const key in B) {
        const k = B[key];
        if (!k.idx.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(k.pos, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(k.nor, 3));
        g.setAttribute("color", new THREE.Float32BufferAttribute(k.col, 3));
        if (key === "perf") g.setAttribute("uv", new THREE.Float32BufferAttribute(k.uv, 2));
        const n = k.pos.length / 3;
        g.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(k.idx), 1) : new THREE.BufferAttribute(new Uint16Array(k.idx), 1));
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, M[key] || M.fix);
        m.castShadow = false; m.receiveShadow = key !== "glow" && key !== "glass";
        if (key === "glass") m.renderOrder = 2;
        m.matrixAutoUpdate = false; m.updateMatrix();
        group.add(m); out.push(m);
      }
      return out;
    }
    return { box: box, finish: finish };
  }

  /* ============================================================
     2. THE PLAN — pure data, computed once at city build
     ============================================================ */
  function frameOf(b) {
    const dr = b.localDoor;
    if (!dr) return null;
    const inx = dr.nx || 0, inz = dr.nz || 0;
    if (!inx && !inz) return null;
    const tx = -inz, tz = inx, along = Math.abs(inx) > 0.5;
    const halfIn = (along ? b.w : b.d) / 2, halfTan = (along ? b.d : b.w) / 2;
    const wt = b.wt != null ? b.wt : 0.4;
    const F = {
      inx: inx, inz: inz, tx: tx, tz: tz, along: along, halfIn: halfIn, halfTan: halfTan, wt: wt,
      Ti: halfTan - wt, Bi: 2 * halfIn - wt,
      x: function (d, l) { return inx * (-halfIn + d) + tx * l; },
      z: function (d, l) { return inz * (-halfIn + d) + tz * l; },
      d: function (x, z) { return x * inx + z * inz + halfIn; },
      l: function (x, z) { return x * tx + z * tz; },
    };
    return F;
  }
  // a box in the door frame: centre (d, l), BOTTOM y0, extent du on IN, dl on the tangent
  function fbox(kit, F, key, d, l, y0, du, dl, h, col) {
    kit.box(key, F.x(d, l), y0 + h / 2, F.z(d, l), F.along ? du : dl, h, F.along ? dl : du, col);
  }
  function clearAt(b, F, d, l, pad) { return !b.clearFloorPoint || b.clearFloorPoint(F.x(d, l), F.z(d, l), pad); }

  function counterOf(b, F) {
    const s = CBZ.fitoutSiteOf ? CBZ.fitoutSiteOf(b) : null;
    const rec = s && s.floors && s.floors[0];
    // an island shop (world/island_shops.js) stands its own counter and says where
    const K = (rec && rec.info && rec.info.counter) || b.counterLocal || null;
    if (!K) return null;
    const cIn = F.d(K.x, K.z), cLat = F.l(K.x, K.z);
    const hIn = (F.along ? K.w : K.d) / 2, hLat = (F.along ? K.d : K.w) / 2;
    return { cIn: cIn, cLat: cLat, hIn: hIn, hLat: hLat };
  }

  // a board goods can stand on. (d, l) is the FRONT-EDGE MIDPOINT; the run is
  // `len` along `ax` (IN or tangent), goods face `fd` (+/-1) on the OTHER axis.
  function board(plan, o) { plan.boards.push(o); return o; }

  function planWalls(plan, prof, F, b, K) {
    const out = [];
    const H = b.planHints || {};
    const end = Math.min(2 * F.halfIn - (H.backKeep != null ? H.backKeep : 5.0), K ? K.cIn - K.hIn - 1.8 : 1e9);
    for (let si = 0; si < prof.walls.length; si++) {
      const s = prof.walls[si];
      const L0 = H.wallStart != null ? H.wallStart : prof.wallStart, n = Math.floor((end - L0) / BAY);
      if (n < 1) continue;
      // test each bay: centre + both ends, with the unit's half-depth as pad
      const ok = [];
      for (let i = 0; i < n; i++) {
        const dc = L0 + (i + 0.5) * BAY, lc = s * (F.Ti - WALL.deep / 2);
        const pad = WALL.deep / 2 - 0.06;
        ok.push(clearAt(b, F, dc, lc, pad) && clearAt(b, F, dc - BAY / 2 + 0.08, lc, pad) && clearAt(b, F, dc + BAY / 2 - 0.08, lc, pad));
      }
      let i = 0;
      while (i < n) {
        if (!ok[i]) { i++; continue; }
        let j = i;
        while (j + 1 < n && ok[j + 1]) j++;
        out.push({ s: s, d0: L0 + i * BAY, d1: L0 + (j + 1) * BAY, bays: j - i + 1 });
        i = j + 1;
      }
    }
    // a small trade keeps only a few bays
    if (prof.maxBays) {
      for (const r of out) if (r.bays > prof.maxBays) { r.d1 = r.d0 + prof.maxBays * BAY; r.bays = prof.maxBays; }
    }
    return out;
  }

  function planLanes(plan, prof, F, b, K) {
    const out = [];
    if (!prof.lanes) return out;
    const d0 = prof.centreStart || 5.6;
    const d1 = Math.min(2 * F.halfIn - 6.6, K ? K.cIn - K.hIn - 2.4 : 1e9);
    if (d1 - d0 < 3) return out;
    // the main aisle: door (lat 0) to the till (lat cLat), 1.5 m clear each side
    const aLo = Math.min(0, K ? K.cLat : 0) - 1.5, aHi = Math.max(0, K ? K.cLat : 0) + 1.5;
    const W = GOND.half, AIS = 1.8;
    const maxOuter = F.Ti - WALL.deep - 1.5;             // an aisle in front of the wall bays
    // as many lanes as fit at a real aisle pitch (<= the trade's count), spread
    // EVENLY from the main aisle to the wall aisle: a store floor, not a cluster
    // of gondolas in the middle of an empty hall
    const n = Math.max(0, Math.min(prof.lanes, Math.floor((maxOuter - 1.6) / (2 * W + AIS))));
    if (!n) return out;
    const pitch = (maxOuter - 1.6) / n;
    for (const s of [-1, 1]) {
      for (let k = 0; k < n; k++) {
        const c = s * (1.6 + pitch * (k + 0.5));
        if (c + W > aLo && c - W < aHi) continue;
        // segments of <= 8 m, split by 2 m cross aisles
        const L = d1 - d0, nSeg = Math.max(1, Math.ceil((L + 2) / 10));
        const seg = (L - 2 * (nSeg - 1)) / nSeg;
        if (seg < 2.4) continue;
        for (let q = 0; q < nSeg; q++) {
          let a = d0 + q * (seg + 2), z = a + seg;
          // shrink from both ends until every sample along the spine is clear
          let good = false;
          for (let tries = 0; tries < 6 && z - a >= 2.4; tries++) {
            let bad = false;
            for (let t = a + 0.2; t <= z - 0.2 + 1e-6; t += 0.9) if (!clearAt(b, F, t, c, W + 0.05)) { bad = true; break; }
            if (!bad && !clearAt(b, F, z - 0.2, c, W + 0.05)) bad = true;
            if (!bad) { good = true; break; }
            a += 0.6; z -= 0.6;
          }
          if (!good) continue;
          out.push({ c: c, d0: a, d1: z });
        }
      }
    }
    return out;
  }

  /* DISPLAY TABLES (an island optician's frames, a phone shop's handsets):
     a waist-high table either side of the walk from the door to the till,
     the real stock on its top facing the aisle. Only when the shop asks
     (b.planHints.tables) and only where the floor is clear. */
  const TABLE = { len: 1.6, wid: 0.8, top: 0.9 };
  function planTables(plan, F, b, K) {
    const n = (b.planHints && b.planHints.tables) | 0, out = [];
    if (!n) return out;
    const d0 = 2.2, d1 = K ? K.cIn - K.hIn - 1.2 : 2 * F.halfIn - 3;
    if (d1 - d0 < TABLE.len) return out;
    const dm = (d0 + d1) / 2;
    const runEdge = F.Ti - (plan.runs.length ? WALL.deep + 1.1 : 0.9);
    for (const s of [1, -1]) {
      if (out.length >= n) break;
      const c = s * Math.min(runEdge - TABLE.wid / 2, 1.5 + TABLE.wid / 2);
      if (Math.abs(c) < 1.2 + TABLE.wid / 2) continue;
      let ok = true;
      for (let t = -TABLE.len / 2; t <= TABLE.len / 2 + 1e-6; t += TABLE.len / 2) if (!clearAt(b, F, dm + t, c, TABLE.wid / 2 + 0.1)) { ok = false; break; }
      if (!ok) continue;
      out.push({ c: c, d0: dm - TABLE.len / 2, d1: dm + TABLE.len / 2, fd: -s });
    }
    return out;
  }

  function planLot(lot) {
    const e = econ(), b = lot && lot.building;
    if (!e || !b) return null;
    if (b.gunstore || b.jewelry) return null;                    // flagship walk-ins
    const kind = (b.shop && b.shop.kind) || lot.kind || "";
    if (SKIP[kind]) return null;
    // (an island trade names its own: the chandlery's torches and first aid)
    const stock = (b.stock || e.stockFor(kind) || []).filter(function (n) { return !!e.ITEMS[n]; });
    if (!stock.length) return null;
    if (typeof b.clearFloorPoint !== "function") return null;
    const F = frameOf(b);
    if (!F || F.Ti < 3.2) return null;
    const prof = PROFILE[kind] || DEFAULT_PROFILE;
    const K = counterOf(b, F);
    const FY = ((b.floorTops && b.floorTops[0] != null) ? b.floorTops[0] : 0.14) + 0.06;

    const plan = {
      lot: lot, kind: kind, prof: prof, F: F, K: K, FY: FY, cx: lot.cx, cz: lot.cz,
      runs: [], lanes: [], cooler: null, coffee: null, warmer: null,
      boards: [], tickets: [], slots: [], names: [], rects: [],
      group: null, built: false, meshes: [], cols: [], prod: Object.create(null), units: 0, tris: 0,
    };
    const W2 = new THREE.Vector3();
    plan.toWorld = function (lx, ly, lz) {
      W2.set(lx, ly || 0, lz);
      const g = plan.lot.building && plan.lot.building.group;
      // updateWorldMatrix(true, false) walks the ANCESTORS first: a town root
      // that has not yet composed its own matrixWorld must not leave the shell
      // composed against identity.
      if (g) {
        try {
          if (g.updateWorldMatrix) g.updateWorldMatrix(true, false);
          else g.updateMatrixWorld(true);
          W2.applyMatrix4(g.matrixWorld);
        } catch (err) { /* no transform available: local IS world */ }
      }
      return W2;
    };

    // ---- the runs, the lanes, and what takes a slice of them ----
    plan.runs = planWalls(plan, prof, F, b, K);
    plan.lanes = (b.planHints && b.planHints.lanes === 0) ? [] : planLanes(plan, prof, F, b, K);
    plan.tables = planTables(plan, F, b, K);
    // the cooler takes the BACK bays of the first run on its preferred side
    if (prof.cooler && plan.runs.length) {
      const pref = plan.runs.filter(function (r) { return r.s === 1; }).concat(plan.runs.filter(function (r) { return r.s === -1; }));
      for (const r of pref) {
        const bays = Math.min(r.bays, Math.max(2, Math.ceil(prof.cooler * 0.78 / BAY)));
        if (bays < 2) continue;
        const d1 = r.d1, d0 = d1 - bays * BAY;
        plan.cooler = { s: r.s, d0: d0, d1: d1, doors: Math.max(2, Math.floor((d1 - d0) / 0.76)) };
        r.d1 = d0; r.bays -= bays;
        break;
      }
    }
    // the coffee station takes the FRONT two bays of the other side
    if (prof.coffee && plan.runs.length) {
      const other = plan.cooler ? -plan.cooler.s : -1;
      const r = plan.runs.filter(function (q) { return q.s === other && q.bays >= 3; })[0];
      const r2 = r || plan.runs.filter(function (q) { return q.bays >= 3; })[0];
      if (r2) { plan.coffee = { s: r2.s, d0: r2.d0, d1: r2.d0 + 2 * BAY }; r2.d0 += 2 * BAY; r2.bays -= 2; }
    }
    plan.runs = plan.runs.filter(function (r) { return r.bays >= 1 && r.d1 - r.d0 > BAY - 0.01; });
    if (prof.warmer && K && K.hLat > 1.2) {
      // the end of the counter away from the till (the till sits at lat -0.7)
      const sd = K.cLat - 0.7 <= K.cLat ? 1 : -1;
      plan.warmer = { l: K.cLat + sd * (K.hLat - 0.52), d: K.cIn - K.hIn + 0.3, top: 1.245 };
    }

    layoutBoards(plan);
    if (!plan.boards.length && !plan.cooler) return null;
    stockShelves(plan, stock);

    // footprints (building-local) for the fit-out's occupancy ledger
    const R = function (dA, dB, lA, lB, wall) {
      const xa = F.x(dA, lA), xb = F.x(dB, lB), za = F.z(dA, lA), zb = F.z(dB, lB);
      plan.rects.push({ x0: Math.min(xa, xb), x1: Math.max(xa, xb), z0: Math.min(za, zb), z1: Math.max(za, zb),
        d0: Math.min(dA, dB), d1: Math.max(dA, dB), wall: !!wall });
    };
    for (const r of plan.runs) R(r.d0, r.d1, r.s * F.Ti, r.s * (F.Ti - WALL.deep - 0.03), true);
    if (plan.cooler) R(plan.cooler.d0, plan.cooler.d1, plan.cooler.s * F.Ti, plan.cooler.s * (F.Ti - COOL.deep - 0.05), true);
    if (plan.coffee) R(plan.coffee.d0, plan.coffee.d1, plan.coffee.s * F.Ti, plan.coffee.s * (F.Ti - 0.7), true);
    for (const g of plan.lanes) R(g.d0, g.d1, g.c - GOND.half - 0.02, g.c + GOND.half + 0.02, false);
    for (const t of plan.tables) R(t.d0, t.d1, t.c - TABLE.wid / 2, t.c + TABLE.wid / 2, false);
    if (b.group) RECTS.set(b.group, plan.rects);

    refreshWorld(plan);
    BY_LOT.set(lot, plan);
    return plan;
  }

  /* ---- where every board is (pure data; the kit draws the same numbers) ---- */
  function layoutBoards(plan) {
    const F = plan.F, FY = plan.FY;
    // wall bays
    for (const r of plan.runs) {
      const s = r.s, L = r.d1 - r.d0, dm = (r.d0 + r.d1) / 2;
      for (let k = 0; k < WALL.levels.length; k++) {
        const dep = k === 0 ? WALL.deep - 0.02 : (k <= 2 ? WALL.deep - 0.05 : WALL.deep - 0.11);
        const clr = (k + 1 < WALL.levels.length ? WALL.levels[k + 1] - 0.028 : WALL.h + 0.02) - WALL.levels[k] - 0.02;
        board(plan, { kind: "wall", run: r, d: dm, l: s * (F.Ti - dep), ax: "in", len: L - 0.08, fd: -s, sd: dep - 0.05,
          y: FY + WALL.levels[k], clr: clr, level: k });
      }
    }
    // gondolas: two faces + two end caps each
    for (const g of plan.lanes) {
      const bd0 = g.d0 + GOND.cap, bd1 = g.d1 - GOND.cap, L = bd1 - bd0, dm = (bd0 + bd1) / 2;
      for (const s of [-1, 1]) for (let k = 0; k < GOND.levels.length; k++) {
        const clr = (k + 1 < GOND.levels.length ? GOND.levels[k + 1] - 0.028 : GOND.h + 0.02) - GOND.levels[k] - 0.02;
        board(plan, { kind: "gond", lane: g, d: dm, l: g.c + s * GOND.half, ax: "in", len: L - 0.06, fd: s, sd: GOND.half - 0.07,
          y: FY + GOND.levels[k], clr: k === GOND.levels.length - 1 ? 0.34 : clr, level: k });
      }
      for (const e of [-1, 1]) for (let k = 0; k < 3; k++) {
        const lv = GOND.levels[k];
        const clr = GOND.levels[k + 1] - 0.028 - lv - 0.02;
        board(plan, { kind: "cap", lane: g, d: e < 0 ? g.d0 : g.d1, l: g.c, ax: "tan", len: 2 * GOND.half - 0.1, fd: e,
          sd: GOND.cap - 0.06, y: FY + lv, clr: clr, level: k });
      }
    }
    // the display tables: one board each, the top, facing the main aisle
    for (const t of plan.tables || []) {
      board(plan, { kind: "table", d: (t.d0 + t.d1) / 2, l: t.c + t.fd * (TABLE.wid / 2 - 0.04), ax: "in", len: TABLE.len - 0.12,
        fd: t.fd, sd: TABLE.wid - 0.16, y: FY + TABLE.top, clr: 0.5, level: REAL_LEVEL });
    }
    // the cooler's shelves
    if (plan.cooler) {
      const C = plan.cooler, dm = (C.d0 + C.d1) / 2;
      for (let k = 0; k < COOL.levels.length; k++) {
        const clr = (k + 1 < COOL.levels.length ? COOL.levels[k + 1] - 0.02 : COOL.h - 0.34) - COOL.levels[k] - 0.02;
        board(plan, { kind: "cool", d: dm, l: C.s * (F.Ti - COOL.deep + 0.06), ax: "in", len: C.d1 - C.d0 - 0.14, fd: -C.s,
          sd: COOL.deep - 0.26, y: FY + COOL.levels[k], clr: clr, level: k });
      }
    }
  }

  // a point on a board: t along its run (centred), depth r back from its front edge
  function boardPt(F, bo, t, back) {
    let d = bo.d, l = bo.l;
    if (bo.ax === "in") { d += t; l -= bo.fd * back; } else { l += t; d -= bo.fd * back; }
    return { x: F.x(d, l), z: F.z(d, l) };
  }
  function faceYaw(F, bo) {
    // the direction the goods face, as a local vector, as a yaw
    let fx, fz;
    if (bo.ax === "in") { fx = F.tx * bo.fd; fz = F.tz * bo.fd; } else { fx = F.inx * bo.fd; fz = F.inz * bo.fd; }
    return Math.atan2(fx, fz);
  }

  /* ---- THE STOCK: every unit on every board is a real, buyable item --------
     A SLOT is one COLUMN of one product on a board: `units` front to back
     (local position + yaw), `left` of them on the shelf, `held` in a
     customer's hands. Taking a unit takes the FRONT one (the back one stays,
     the way a shelf empties); the day's restock fills every column back up.
     Blocks of one product are faced up side by side (a block of six waters,
     not one), each block with its price ticket on the board's channel. */
  const GAP = 0.006;                         // between facings
  const LOOSE = { Banana: 1, Orange: 1, Apple: 1, Newspaper: 1 };   // laid out, never stacked
  function newSlot(plan, name, bo, units) {
    const sl = { plan: plan, lot: plan.lot, name: name, units: units, left: units.length, held: 0, day: -1,
      clr: bo ? bo.clr : 0.3, x: 0, y: 0, z: 0 };
    plan.slots.push(sl);
    if (plan.names.indexOf(name) < 0) plan.names.push(name);
    plan.units += units.length;
    plan.tris += units.length * (protoOf(name) ? protoOf(name).tris : 0);
    return sl;
  }
  // a product's footprint on a board: along the board (fw), into it (fd),
  // and whether it turns a quarter to fit (a long thing laid along the run)
  function fitOn(P, bo) {
    if (!P || P.h > bo.clr - 0.01) return null;
    if (P.d <= bo.sd - 0.01) return { fw: P.w, fd: P.d, h: P.h, turn: 0 };
    if (P.w <= bo.sd - 0.01) return { fw: P.d, fd: P.w, h: P.h, turn: Math.PI / 2 };
    return null;
  }
  // one block of `n` facings starting at t0 (board-centred t), `rows` deep
  function placeBlock(plan, bo, t0, name, fit, n, rows) {
    const F = plan.F, yaw0 = faceYaw(F, bo) + fit.turn;
    for (let u = 0; u < n; u++) {
      const tc = t0 + u * (fit.fw + GAP) + fit.fw / 2;
      // a FLAT thing (a candy bar, a pack of gum, a blister strip) is stacked
      // the way a shop stacks it, so a block of them reads from the aisle;
      // the units run top-front first, which is the one a hand takes
      const stack = fit.h < 0.04 && !LOOSE[name] ? Math.max(1, Math.min(fit.h < 0.02 ? 6 : 4, Math.floor((Math.min(bo.clr, 0.16) - 0.01) / (fit.h + 0.001)))) : 1;
      const units = [];
      for (let r = 0; r < rows; r++) {
        const p = boardPt(F, bo, tc, 0.014 + fit.fd / 2 + r * (fit.fd + GAP));
        const j = (hash01(p.x * 7.1 + r, p.z * 3.3 + u, 0x9ab3) - 0.5) * (stack > 1 ? 0.04 : 0.10);   // a hand-faced shelf, not a render
        for (let k = stack - 1; k >= 0; k--) {
          const jk = stack > 1 ? (hash01(p.x + k, p.z - r, 0x51c7) - 0.5) * 0.08 : 0;
          units.push({ lx: p.x, ly: bo.y + 0.002 + k * (fit.h + 0.001), lz: p.z, yaw: yaw0 + j + jk });
        }
      }
      newSlot(plan, name, bo, units);
    }
    plan.tickets.push({ bo: bo, t: t0 + Math.min(0.04, fit.fw * 0.4), sale: hash01(t0, bo.y * 7 + bo.d, 0x5a1e) < 0.12 });
  }
  function rowsFor(fit, bo, cap) {
    const deep = Math.max(1, Math.floor((bo.sd - 0.02) / (fit.fd + GAP)));
    const want = fit.fd < 0.09 ? 3 : fit.fd < 0.2 ? 2 : 1;
    return Math.max(1, Math.min(deep, want, cap || 3));
  }
  function overBudget(plan, share) {
    const k = share || 1;
    return plan.units >= UNIT_BUDGET * k || plan.tris >= TRI_BUDGET * k;
  }

  // fill boards with blocks of `names`, round robin, so every product shows
  // before any repeats; a product that does not fit a board is skipped there
  function fillBoards(plan, boards, names, rowCap, seed, share) {
    if (!names.length) return;
    // no one product takes the store: each has a ceiling on its units, so a
    // tray of gum cannot eat the budget a wall of water needed
    const cap = Math.max(18, Math.ceil(UNIT_BUDGET * (share || 1) * 1.6 / names.length));
    const had = Object.create(null);
    for (const sl of plan.slots) had[sl.name] = (had[sl.name] | 0) + sl.units.length;
    let ptr = 0;
    for (let bi = 0; bi < boards.length; bi++) {
      const bo = boards[bi];
      let pos = -bo.len / 2 + 0.02;
      const end = bo.len / 2 - 0.02;
      let misses = 0;
      while (pos < end - 0.05 && misses < names.length && !overBudget(plan, share)) {
        const name = names[ptr % names.length];
        const P = protoOf(name), fit = fitOn(P, bo);
        if (!fit || fit.fw + GAP > end - pos || (had[name] | 0) >= cap) { ptr++; misses++; continue; }
        misses = 0;
        const target = 0.26 + 0.34 * hash01(bi * 3.7 + pos, bo.y + seed, 0x2c9d);
        let n = Math.max(1, Math.round(target / (fit.fw + GAP)));
        if (fit.fw > 0.25) n = Math.min(n, 2);
        n = Math.min(n, Math.floor((end - pos) / (fit.fw + GAP)));
        if (fit.fw < 0.05) n = Math.min(n, 8);           // (a tray of the little things, not a metre of them)
        if (n < 1) { ptr++; misses++; continue; }
        const rows = rowsFor(fit, bo, fit.fw < 0.05 ? Math.min(2, rowCap) : rowCap);
        placeBlock(plan, bo, pos, name, fit, n, rows);
        had[name] = (had[name] | 0) + plan.slots.slice(-n).reduce(function (a, q) { return a + q.units.length; }, 0);
        pos += n * (fit.fw + GAP) + 0.03;
        ptr++;
      }
    }
  }

  function stockShelves(plan, stock) {
    const F = plan.F, e = econ();
    const has = function (n) { return !!(e && e.ITEMS[n]) && !!protoOf(n); };
    const names = stock.filter(has);
    const used = new Set();
    // the cold case: drinks (and the grab-and-go sandwiches), two deep
    const cold = names.filter(function (n) { return COLD[n]; });
    const coolBoards = plan.boards.filter(function (bo) { return bo.kind === "cool"; })
      .sort(function (a, c) { return Math.abs(a.level - 2.4) - Math.abs(c.level - 2.4); });
    if (cold.length && coolBoards.length) {
      fillBoards(plan, coolBoards, cold, 2, 7, 0.3);        // (a third of the store's budget at most)
      for (const n of cold) used.add(n);
    }
    // the hot case on the counter: two tiers, three a tier
    if (plan.warmer) {
      const hot = names.filter(function (n) { return HOT[n]; });
      const W = plan.warmer;
      for (let i = 0; i < 6 && hot.length; i++) {
        const name = hot[i % hot.length], tier = (i / 3) | 0, col = i % 3;
        const l = W.l + (col - 1) * 0.26, d = W.d + 0.02;
        newSlot(plan, name, null, [{ lx: F.x(d, l), ly: W.top + (tier ? 0.252 : 0.05), lz: F.z(d, l), yaw: Math.atan2(-F.inx, -F.inz) }]).clr = 0.17;
      }
      for (const n of hot) used.add(n);
    }
    // the coffee station: a row of cups by the brewer
    if (plan.coffee) {
      for (const name of names) {
        if (!BREW[name]) continue;
        const C = plan.coffee, l = C.s * (F.Ti - 0.34), d = C.d0 + 1.35;
        for (let u = 0; u < 4; u++) {
          const dd = d + u * 0.11;
          newSlot(plan, name, null, [{ lx: F.x(dd, l), ly: plan.FY + 0.92, lz: F.z(dd, l), yaw: Math.atan2(-C.s * F.tx, -C.s * F.tz) }]).clr = 0.3;
        }
        used.add(name);
      }
    }
    // everything else down the boards: the tables first (a phone shop's
    // handsets), then eye level, then the levels either side of it, the deck
    // and the top board last — the budget runs out up there, not mid-aisle.
    const dry = names.filter(function (n) { return !used.has(n) && !COLD[n] && !HOT[n] && !BREW[n]; });
    // (a cold product with no cooler to stand in goes on a board like the rest)
    if (!coolBoards.length) for (const n of cold) if (!used.has(n)) dry.push(n);
    const RANK = { wall: [3, 1, 0, 2, 4], gond: [3, 1, 0, 2], cap: [2, 1, 0] };
    const pool = plan.boards.filter(function (bo) { return bo.kind !== "cool"; });
    pool.sort(function (a, c) {
      const ra = a.kind === "table" ? -1 : (RANK[a.kind] || [])[a.level], rc = c.kind === "table" ? -1 : (RANK[c.kind] || [])[c.level];
      return (ra == null ? 9 : ra) - (rc == null ? 9 : rc) || (a.kind === "cap") - (c.kind === "cap") || a.d - c.d;
    });
    fillBoards(plan, pool, dry, 2, 13);
    for (const sl of plan.slots) { const u = sl.units[0]; sl.lx = u.lx; sl.ly = u.ly; sl.lz = u.lz; }
  }

  /* WORLD COORDINATES ARE A DERIVED, REFRESHABLE FACT. */
  function refreshWorld(plan) {
    const w0 = plan.toWorld(0, 0, 0);
    plan.cx = w0.x; plan.cz = w0.z;
    const F = plan.F;
    for (let i = 0; i < plan.boards.length; i++) {
      const bo = plan.boards[i], c = boardPt(F, bo, 0, bo.sd / 2), w = plan.toWorld(c.x, bo.y, c.z);
      bo.wx = w.x; bo.wy = w.y; bo.wz = w.z;
      const yaw = faceYaw(F, bo), w2 = plan.toWorld(c.x + Math.sin(yaw), bo.y, c.z + Math.cos(yaw));
      const dx = w2.x - bo.wx, dz = w2.z - bo.wz, dl = Math.hypot(dx, dz) || 1;
      bo.wfx = dx / dl; bo.wfz = dz / dl;
    }
    for (let i = 0; i < plan.slots.length; i++) {
      const sl = plan.slots[i], w = plan.toWorld(sl.lx, sl.ly, sl.lz);
      sl.x = w.x; sl.y = w.y; sl.z = w.z;
    }
    plan.worldFresh = true;
  }

  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    const A = city || CBZ._settlementArena || (CBZ.city && CBZ.city.arena) || null;
    if (!A) return;
    for (let i = PLANS.length - 1; i >= 0; i--) {
      if (PLANS[i]._island) continue;                     // an island shop is its island's
      if (PLANS[i]._arena !== A) { teardownPlan(PLANS[i]); PLANS.splice(i, 1); }
    }
    for (let i = 0; i < PLANS.length; i++) if (!PLANS[i]._island) teardownPlan(PLANS[i]);
    S.live = S.live.filter(function (p) { return p._island; });
    const lots = A.shopLots || A.lots || [];
    for (let i = 0; i < lots.length; i++) {
      const lot = lots[i];
      if (!lot || !lot.building || lot.demolished) continue;
      if (!lot.building.group) continue;       // a shell not built yet (streamed): planned when it is
      if (BY_LOT.get(lot)) continue;
      let p = null;
      try { p = planLot(lot); } catch (err) { p = null; }
      if (p) { p._arena = A; PLANS.push(p); }
    }
    S.arena = A;
    S.refreshed = false;
  }, 90.5);
  /* A SHOP WHOSE SHELL IS BUILT LATER (a streamed town parcel, city/towngen.js)
     is planned then: its plan reads the shell's own frame, so at boot it had
     nothing to plan against. */
  CBZ.storeGoodsPlan = function (lot) {
    const A = S.arena || (CBZ.city && CBZ.city.arena) || null;
    if (!A || !lot || !lot.building || !lot.building.group || lot.demolished) return null;
    const had = BY_LOT.get(lot);
    if (had && PLANS.indexOf(had) >= 0) return null;          // planned, and still live
    let p = null;
    try { p = planLot(lot); } catch (err) { p = null; }
    if (p) { p._arena = A; PLANS.push(p); S.refreshed = false; }
    return p;
  };

  /* ============================================================
     3. THE LIVE BUILD — fixtures, goods, real stock, colliders
     ============================================================ */
  function drawFixtures(plan, kit) {
    const F = plan.F, FY = plan.FY;
    // ---- wall bays ----
    for (let ri = 0; ri < plan.runs.length; ri++) {
      const r = plan.runs[ri], s = r.s, L = r.d1 - r.d0, dm = (r.d0 + r.d1) / 2, UD = WALL.deep;
      fbox(kit, F, "perf", dm, s * (F.Ti - 0.013), FY, L, 0.024, WALL.top, COL.perf);                // back panel
      const hc = HEADER[(Math.abs(Math.round(dm * 3 + s * 7)) + ri) % HEADER.length];
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.034), FY + WALL.h + 0.04, L, 0.018, WALL.top - WALL.h - 0.06, hc);   // header panel
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.1), FY + WALL.h + 0.01, L, 0.16, 0.025, COL.body);             // top cap
      for (let i = 0; i <= r.bays; i++) {                                                              // uprights
        const d = Math.min(r.d1 - 0.025, Math.max(r.d0 + 0.025, r.d0 + i * BAY));
        fbox(kit, F, "fix", d, s * (F.Ti - 0.045), FY, 0.05, 0.042, WALL.h + 0.02, COL.upright);
      }
      for (const e of [r.d0 + 0.012, r.d1 - 0.012])                                                     // end panels
        fbox(kit, F, "fix", e, s * (F.Ti - UD / 2 - 0.01), FY, 0.024, UD + 0.02, WALL.h, COL.body);
      fbox(kit, F, "fix", dm, s * (F.Ti - UD + 0.012), FY, L - 0.05, 0.022, 0.12, COL.kick);                 // kick plate
      for (let k = 0; k < WALL.levels.length; k++) {
        const y = FY + WALL.levels[k];
        const dep = k === 0 ? UD - 0.02 : (k <= 2 ? UD - 0.05 : UD - 0.11);
        fbox(kit, F, "fix", dm, s * (F.Ti - dep / 2 - 0.02), y - 0.025, L - 0.05, dep - 0.02, 0.025, COL.board);   // board
        fbox(kit, F, "fix", dm, s * (F.Ti - dep - 0.006), y - 0.034, L - 0.05, 0.014, 0.04, COL.rail);            // price channel
      }
    }
    // ---- gondolas ----
    for (const g of plan.lanes) {
      const bd0 = g.d0 + GOND.cap, bd1 = g.d1 - GOND.cap, L = bd1 - bd0, dm = (bd0 + bd1) / 2, W = GOND.half;
      fbox(kit, F, "perf", dm, g.c, FY, L, 0.05, GOND.h, COL.perf);                                    // spine
      fbox(kit, F, "fix", dm, g.c, FY + GOND.h, L + 0.04, 0.09, 0.03, COL.body);                        // top cap
      for (const e of [bd0 + 0.012, bd1 - 0.012]) fbox(kit, F, "fix", e, g.c, FY, 0.024, 2 * W + 0.02, GOND.h, COL.body);   // end panels
      const nUp = Math.max(1, Math.round(L / BAY));
      for (let i = 1; i < nUp; i++) fbox(kit, F, "fix", bd0 + i * (L / nUp), g.c, FY, 0.05, 0.075, GOND.h, COL.upright);
      for (const s of [-1, 1]) {
        fbox(kit, F, "fix", dm, g.c + s * (W - 0.011), FY, L - 0.05, 0.022, 0.12, COL.kick);
        for (let k = 0; k < GOND.levels.length; k++) {
          const y = FY + GOND.levels[k];
          fbox(kit, F, "fix", dm, g.c + s * (W / 2 + 0.01), y - 0.025, L - 0.05, W - 0.04, 0.025, COL.board);
          fbox(kit, F, "fix", dm, g.c + s * (W + 0.006), y - 0.034, L - 0.05, 0.014, 0.04, COL.rail);
        }
      }
      // end caps: a shallow display facing the cross aisle, cheeks either side
      for (const e of [-1, 1]) {
        const dc = e < 0 ? g.d0 + GOND.cap / 2 : g.d1 - GOND.cap / 2, outer = e < 0 ? g.d0 : g.d1;
        for (const s of [-1, 1]) fbox(kit, F, "fix", dc, g.c + s * (W - 0.012), FY, GOND.cap, 0.024, GOND.levels[2] + 0.36, COL.body);
        fbox(kit, F, "fix", outer - e * 0.011, g.c, FY, 0.022, 2 * W - 0.05, 0.12, COL.kick);
        for (let k = 0; k < 3; k++) {
          const y = FY + GOND.levels[k];
          fbox(kit, F, "fix", dc, g.c, y - 0.025, GOND.cap - 0.04, 2 * W - 0.05, 0.025, COL.board);
          fbox(kit, F, "fix", outer + e * 0.006, g.c, y - 0.034, 0.014, 2 * W - 0.05, 0.04, COL.rail);
        }
      }
    }
    // ---- the cooler bank ----
    if (plan.cooler) {
      const C = plan.cooler, s = C.s, L = C.d1 - C.d0, dm = (C.d0 + C.d1) / 2, CD = COOL.deep;
      const front = s * (F.Ti - CD);
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.02), FY, L, 0.04, COOL.h, COL.coolFrame);                   // back
      for (const e of [C.d0 + 0.025, C.d1 - 0.025]) fbox(kit, F, "fix", e, s * (F.Ti - CD / 2), FY, 0.05, CD, COOL.h, COL.coolFrame);
      fbox(kit, F, "fix", dm, s * (F.Ti - CD / 2), FY + COOL.h - 0.3, L, CD, 0.3, COL.coolFrame);       // header
      fbox(kit, F, "fix", dm, s * (F.Ti - CD / 2), FY, L, CD, 0.16, COL.coolFrame);                     // base + grille
      for (let i = 0; i < 6; i++) fbox(kit, F, "fix", dm, front - s * 0.004, FY + 0.03 + i * 0.022, L - 0.12, 0.006, 0.008, 0x3a3e43);
      fbox(kit, F, "glow", dm, s * (F.Ti - 0.045), FY + 0.17, L - 0.1, 0.01, COOL.h - 0.48, COL.coolLight);   // lit interior back
      for (let k = 0; k < COOL.levels.length; k++)                                                    // wire shelves
        fbox(kit, F, "fix", dm, s * (F.Ti - CD / 2 - 0.04), FY + COOL.levels[k] - 0.02, L - 0.12, CD - 0.2, 0.02, COL.coolWire);
      const dw = L / C.doors;
      for (let i = 0; i <= C.doors; i++)                                                              // mullions
        fbox(kit, F, "fix", C.d0 + i * dw, front + s * 0.03, FY + 0.16, 0.05, 0.06, COOL.h - 0.46, COL.coolFrame);
      fbox(kit, F, "fix", dm, front + s * 0.03, FY + 0.16, L, 0.06, 0.05, COL.coolFrame);
      fbox(kit, F, "fix", dm, front + s * 0.03, FY + COOL.h - 0.35, L, 0.06, 0.05, COL.coolFrame);
      for (let i = 0; i < C.doors; i++) {
        const dc = C.d0 + (i + 0.5) * dw;
        fbox(kit, F, "glass", dc, front + s * 0.03, FY + 0.21, dw - 0.06, 0.012, COOL.h - 0.56, 0xdfeff5);
        const hd = dc + (i % 2 ? -1 : 1) * (dw / 2 - 0.09);
        fbox(kit, F, "fix", hd, front - s * 0.012, FY + 0.82, 0.025, 0.03, 0.72, COL.handle);             // handle
        fbox(kit, F, "glow", C.d0 + i * dw + 0.03, front + s * 0.07, FY + 0.2, 0.012, 0.02, COOL.h - 0.56, 0xf3f8fa);   // LED strip
      }
    }
    // ---- the coffee station ----
    if (plan.coffee) {
      const C = plan.coffee, s = C.s, L = C.d1 - C.d0, dm = (C.d0 + C.d1) / 2;
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.31), FY + 0.1, L - 0.04, 0.6, 0.78, COL.lam);                // cabinet
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.3), FY, L - 0.08, 0.56, 0.1, COL.black);                     // kick
      for (let i = 1; i < 3; i++) fbox(kit, F, "fix", C.d0 + i * L / 3, s * (F.Ti - 0.611), FY + 0.14, 0.008, 0.006, 0.7, 0x4a3a2c);
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.33), FY + 0.88, L, 0.66, 0.04, COL.stone);                   // worktop
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.012), FY + 0.92, L, 0.024, 1.2, COL.splash);                 // back panel
      fbox(kit, F, "fix", dm, s * (F.Ti - 0.17), FY + 2.12, L, 0.34, 0.22, COL.splash);                  // canopy
      fbox(kit, F, "glow", dm, s * (F.Ti - 0.3), FY + 2.1, L - 0.2, 0.05, 0.018, COL.warmLight);         // under-canopy light
      // the brewer: body, hood, two warmer plates
      const bd = C.d0 + 0.5;
      fbox(kit, F, "fix", bd, s * (F.Ti - 0.13), FY + 0.92, 0.6, 0.2, 0.66, COL.black);                  // tower
      fbox(kit, F, "fix", bd, s * (F.Ti - 0.31), FY + 1.36, 0.6, 0.2, 0.2, COL.steel);                   // brew head over the pots
      for (let i = 0; i < 2; i++) fbox(kit, F, "fix", C.d0 + 0.38 + i * 0.22, s * (F.Ti - 0.3), FY + 0.92, 0.17, 0.2, 0.03, 0x2a2a2a);
      // a lid + sugar caddy
      fbox(kit, F, "fix", C.d0 + 1.0, s * (F.Ti - 0.25), FY + 0.92, 0.26, 0.2, 0.1, 0x2a2d31);
      fbox(kit, F, "fix", C.d0 + 2.36, s * (F.Ti - 0.25), FY + 0.92, 0.18, 0.18, 0.12, COL.steel);
      // the station's own kit (not stock): two glass carafes on the plates
      // and the sleeves of empty cups in their dispenser
      for (let i = 0; i < 2; i++) {
        const cd = C.d0 + 0.38 + i * 0.22, cl = s * (F.Ti - 0.3);
        fbox(kit, F, "fix", cd, cl, FY + 0.95, 0.13, 0.13, 0.12, 0x3b2417);                         // the coffee in the pot
        fbox(kit, F, "glass", cd, cl, FY + 1.07, 0.14, 0.14, 0.08, 0xd9e6ea);                      // the glass over it
        fbox(kit, F, "fix", cd, cl, FY + 1.15, 0.10, 0.10, 0.03, COL.black);                       // the lid
        fbox(kit, F, "fix", cd, cl + s * 0.09, FY + 1.0, 0.03, 0.04, 0.1, COL.black);              // the handle
      }
      fbox(kit, F, "fix", C.d0 + 1.95, s * (F.Ti - 0.2), FY + 0.92, 0.36, 0.14, 0.42, COL.black);   // the cup dispenser
      for (let i = 0; i < 3; i++) fbox(kit, F, "fix", C.d0 + 1.83 + i * 0.12, s * (F.Ti - 0.28), FY + 1.34, 0.09, 0.09, 0.16, 0xf4f1ea);
    }
    // ---- display tables: a lacquered top on a plinth with a lit edge ----
    for (const t of plan.tables || []) {
      const dm = (t.d0 + t.d1) / 2, L = t.d1 - t.d0, W = TABLE.wid;
      fbox(kit, F, "fix", dm, t.c, FY + 0.1, L - 0.3, W - 0.3, TABLE.top - 0.14, COL.black);               // plinth
      fbox(kit, F, "fix", dm, t.c, FY, L - 0.24, W - 0.24, 0.1, COL.kick);                                  // kick
      fbox(kit, F, "fix", dm, t.c, FY + TABLE.top - 0.04, L, W, 0.04, 0xeeeeea);                            // top
      fbox(kit, F, "fix", dm, t.c, FY + TABLE.top - 0.075, L - 0.02, W - 0.02, 0.035, COL.steel);           // edge band
      fbox(kit, F, "glow", dm, t.c + t.fd * (W / 2 - 0.15), FY + TABLE.top - 0.16, L - 0.36, 0.01, 0.02, 0xf3f8fa);   // under-lip light
    }
    // ---- the hot food warmer on the counter ----
    if (plan.warmer) {
      const Wm = plan.warmer, y = Wm.top, wl = Wm.l, wd = Wm.d;
      fbox(kit, F, "fix", wd, wl, y, 0.42, 0.84, 0.05, COL.steel);                                      // base
      for (const e of [-1, 1]) fbox(kit, F, "fix", wd, wl + e * 0.41, y + 0.05, 0.4, 0.02, 0.4, COL.steel);   // end frames
      fbox(kit, F, "fix", wd, wl, y + 0.43, 0.42, 0.84, 0.03, COL.steel);                               // lid
      fbox(kit, F, "glow", wd, wl, y + 0.415, 0.3, 0.7, 0.012, COL.warmLight);                          // heat lamp
      fbox(kit, F, "fix", wd + 0.02, wl, y + 0.24, 0.3, 0.8, 0.012, 0x9aa0a4);                         // wire tier
      fbox(kit, F, "glass", wd - 0.2, wl, y + 0.05, 0.01, 0.8, 0.38, 0xf2e6d8);                         // front glass
      fbox(kit, F, "glass", wd + 0.2, wl, y + 0.05, 0.01, 0.8, 0.38, 0xf2e6d8);                         // back glass
    }
    // ---- price tickets on every block ----
    for (const tk of plan.tickets) {
      const bo = tk.bo;
      const off = 0.015;                          // proud of the price channel (or the wire shelf)
      let d = bo.d, l = bo.l;
      if (bo.ax === "in") { d += tk.t; l += bo.fd * off; } else { l += tk.t; d += bo.fd * off; }
      const tw = 0.06, th = 0.032;
      kit.box("fix", F.x(d, l), bo.y - 0.014, F.z(d, l),
        bo.ax === "in" ? (F.along ? tw : 0.004) : (F.along ? 0.004 : tw), th,
        bo.ax === "in" ? (F.along ? 0.004 : tw) : (F.along ? tw : 0.004), tk.sale ? COL.sale : COL.ticket);
    }
  }

  // the fixtures are SOLID while the store is live
  function fixtureCols(plan) {
    const F = plan.F, cols = [];
    const add = function (dA, dB, lA, lB, h) {
      const a = plan.toWorld(F.x(dA, lA), plan.FY, F.z(dA, lA));
      const ax = a.x, ay = a.y, az = a.z;
      const c = plan.toWorld(F.x(dB, lB), plan.FY, F.z(dB, lB));
      cols.push({ minX: Math.min(ax, c.x), maxX: Math.max(ax, c.x), minZ: Math.min(az, c.z), maxZ: Math.max(az, c.z),
        y0: ay - 0.1, y1: ay + h, ref: plan.group, _storegoods: true });
    };
    for (const r of plan.runs) add(r.d0, r.d1, r.s * F.Ti, r.s * (F.Ti - WALL.deep), WALL.top);
    for (const g of plan.lanes) add(g.d0, g.d1, g.c - GOND.half, g.c + GOND.half, GOND.h);
    if (plan.cooler) add(plan.cooler.d0, plan.cooler.d1, plan.cooler.s * F.Ti, plan.cooler.s * (F.Ti - COOL.deep), COOL.h);
    if (plan.coffee) add(plan.coffee.d0, plan.coffee.d1, plan.coffee.s * F.Ti, plan.coffee.s * (F.Ti - 0.64), 0.92);
    for (const t of plan.tables || []) add(t.d0, t.d1, t.c - TABLE.wid / 2, t.c + TABLE.wid / 2, TABLE.top);
    return cols;
  }

  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  /* ---- THE STOCK, INSTANCED PER PRODUCT -------------------------------------
     One product = one InstancedMesh over its baked model, one instance per
     unit on the shelves. A unit that leaves the shelf is a zero matrix; the
     restock puts the matrix back. However deep the stock, a store is one
     draw call per product it sells. */
  // the day's restock, read lazily: a column refills when the day turns
  function onShelf(sl) {
    const d = today();
    if (sl.day !== d) { sl.day = d; sl.left = Math.max(0, sl.units.length - (sl.held | 0)); }
    return sl.left;
  }
  // the unit a hand takes: the front-most one still standing
  function frontUnit(sl) { return sl.units[sl.units.length - onShelf(sl)] || null; }
  function unitMatrix(u, out) {
    _v.set(u.lx, u.ly, u.lz); _e.set(0, u.yaw, 0); _q.setFromEuler(_e); _s.set(1, 1, 1);
    return out.compose(_v, _q, _s);
  }
  function syncSlot(sl) {
    const pr = sl.plan && sl.plan.prod[sl.name];
    if (!pr || !pr.mesh || sl.base == null) return;
    const left = onShelf(sl), n = sl.units.length;
    for (let k = 0; k < n; k++) pr.mesh.setMatrixAt(sl.base + k, k >= n - left ? unitMatrix(sl.units[k], _m4) : ZERO);
    pr.mesh.instanceMatrix.needsUpdate = true;
  }
  function drawStock(plan, group) {
    const M = mats(), out = [];
    const by = Object.create(null);
    for (const sl of plan.slots) (by[sl.name] || (by[sl.name] = [])).push(sl);
    for (const name in by) {
      const P = protoOf(name), list = by[name];
      if (!P) continue;
      let count = 0;
      for (const sl of list) { sl.base = count; count += sl.units.length; }
      const im = new THREE.InstancedMesh(P.geo, M.stock, count);
      im.frustumCulled = false;                 // the instances span the store; the geometry's sphere does not
      im.castShadow = false; im.receiveShadow = false;
      im.matrixAutoUpdate = false; im.updateMatrix();
      im.userData.storeGood = name;
      plan.prod[name] = { mesh: im, slots: list, day: today() };
      for (const sl of list) syncSlot(sl);
      group.add(im); out.push(im);
    }
    return out;
  }

  function buildPlan(plan) {
    if (plan.built) return;
    if (!plan.livedOnce) { plan.livedOnce = true; refreshWorld(plan); }
    const root = (plan.lot.building && plan.lot.building.group) ||
                 (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    if (!root) return;
    const grp = new THREE.Group();
    grp.userData.storeGoods = plan.kind;
    grp.userData.dynamic = true;                 // never folded by core/batch.js
    root.add(grp);
    plan.group = grp;
    const fix = new THREE.Group(); fix.name = "storegoods:fixtures";
    const goods = new THREE.Group(); goods.name = "storegoods:goods";
    grp.add(fix); grp.add(goods);
    plan.fixGroup = fix; plan.goodsGroup = goods;
    const kit = Kit(plan.FY);
    try { drawFixtures(plan, kit); } catch (err) { /* a half-drawn fixture set still stands */ }
    plan.meshes = kit.finish(fix).concat(drawStock(plan, goods));
    plan.cols = fixtureCols(plan);
    if (plan.cols.length && CBZ.colliders) {
      for (const c of plan.cols) { c.ref = grp; CBZ.colliders.push(c); }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    plan.built = true;
  }

  function teardownPlan(plan) {
    if (!plan.built) return;
    if (plan.group && plan.group.parent) plan.group.parent.remove(plan.group);
    for (const m of plan.meshes) {
      // fixture geometry is per store; a product's geometry and every material are shared
      if (m.isInstancedMesh) { try { m.dispose(); } catch (err) {} }
      else { try { m.geometry.dispose(); } catch (err) {} }
    }
    plan.prod = Object.create(null);
    plan.meshes = [];
    if (plan.cols.length && CBZ.colliders) {
      const set = new Set(plan.cols), C = CBZ.colliders;
      let w = 0;
      for (let i = 0; i < C.length; i++) if (!set.has(C[i])) C[w++] = C[i];
      C.length = w;
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    plan.cols = [];
    plan.group = null; plan.fixGroup = null; plan.goodsGroup = null;
    plan.built = false;
  }
  function teardownAll() { for (let i = 0; i < PLANS.length; i++) teardownPlan(PLANS[i]); S.live.length = 0; }

  // one unit off the shelf and into a hand (bought, pocketed or carried to
  // the till): the front one goes, the column behind it stays
  function clearSlot(sl) {
    if (onShelf(sl) <= 0) return false;
    sl.left--; sl.held = (sl.held | 0) + 1;
    syncSlot(sl);
    return true;
  }

  CBZ.onUpdate(37.6, function (dt) {
    const g = CBZ.game;
    // Gang City's shelves stand only in Gang City; an island's (mounted by
    // world/island_shops.js through CBZ.storeGoodsMount) wherever money is real
    const econ = !!g && (CBZ.economyMode ? CBZ.economyMode(g.mode) : g.mode === "city");
    const cityOn = econ && (CBZ.cityArenaLive ? CBZ.cityArenaLive() : (g.mode === "city"));
    if (!econ) { if (S.live.length) teardownAll(); for (const p of PLANS) if (p.till) p.till.dropAll(); return; }
    if (!PLANS.length) return;
    ledgersTick(dt);
    if (S.live.length) {
      const night = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
      LIT.value = 0.12 + 0.42 * Math.max(0, Math.min(1, night));
    }
    S.scanT -= dt;
    if (S.scanT > 0) return;
    S.scanT = 0.4;
    const P = CBZ.player;
    if (!P) return;
    if (!S.refreshed) { S.refreshed = true; for (let i = 0; i < PLANS.length; i++) refreshWorld(PLANS[i]); }
    const px = P.pos.x, pz = P.pos.z;
    const near = [];
    for (let i = 0; i < PLANS.length; i++) {
      const p = PLANS[i];
      if (!p._island && !cityOn) continue;
      const d = Math.hypot(p.cx - px, p.cz - pz);
      if (d <= LIVE_R) near.push([d, p]);
    }
    near.sort(function (a, b) { return a[0] - b[0]; });
    if (near.length > MAX_LIVE) near.length = MAX_LIVE;
    const want = near.map(function (r) { return r[1]; });
    const dOf = new Map();
    for (let i = 0; i < near.length; i++) dOf.set(near[i][1], near[i][0]);
    let builtThisTick = false;
    const day = today();
    for (let i = 0; i < PLANS.length; i++) {
      const p = PLANS[i];
      if (want.indexOf(p) < 0) { if (p.built) teardownPlan(p); continue; }
      // ONE store built per scan: a store is a thousand units of stock
      if (!p.built) { if (builtThisTick) continue; buildPlan(p); builtThisTick = true; }
      else {
        // the day turned while the store stood: the shelves are faced up again
        for (const name in p.prod) {
          const pr = p.prod[name];
          if (pr.day === day) continue;
          pr.day = day;
          for (const sl of pr.slots) syncSlot(sl);
        }
      }
      // BUILT IS NOT DRAWN: the goods show only once you are close enough to
      // read a shelf; the fixtures stand at the glass from further out.
      if (p.goodsGroup) p.goodsGroup.visible = (dOf.get(p) || 0) < SHOW_R;
    }
    S.live = want;
  });

  /* ---- AN ISLAND SHOP'S SHELVES ---------------------------------------------
     CBZ.storeGoodsMount(lot) -> { plan, dispose } | null
       lot: { kind, cx, cz, building: { shop: { kind }, localDoor {nx, nz} (the
       INWARD normal, building-local), w, d, wt, floorTops (local), group,
       clearFloorPoint(lx, lz, pad), counterLocal {x, z, w, d}, planHints
       { wallStart, backKeep, tables, lanes }, vendor (the clerk who watches) } }
       The same plan, fixtures, goods and verbs as a Gang City store, stood
       and torn down by the same tick; dispose takes it out for good (its
       island leaving). */
  CBZ.storeGoodsMount = function (lot) {
    if (!lot || !lot.building || !lot.building.group) return null;
    let p = null;
    try { p = planLot(lot); } catch (err) { console.error("[storegoods island]", err); p = null; }
    if (!p) return null;
    p._island = true;
    PLANS.push(p);
    return {
      plan: p,
      dispose: function () {
        if (p.till) { p.till.dropAll(); if (p.till.clerk && p.till.clerk.standDown) p.till.clerk.standDown(); }
        teardownPlan(p);
        const i = PLANS.indexOf(p); if (i >= 0) PLANS.splice(i, 1);
        const k = S.live.indexOf(p); if (k >= 0) S.live.splice(k, 1);
        BY_LOT.delete(lot);
      },
    };
  };

  /* ============================================================
     4. THE VERBS — one zone, every store in the city
     ============================================================ */
  function nearestSlot(px, pz) {
    let best = null, bd = REACH;
    for (let i = 0; i < S.live.length; i++) {
      const p = S.live[i];
      if (!p.built) continue;
      if (Math.abs(p.cx - px) > 40 || Math.abs(p.cz - pz) > 40) continue;
      for (let k = 0; k < p.slots.length; k++) {
        const sl = p.slots[k];
        if (!(sl.held > 0) && onShelf(sl) <= 0) continue;
        const d = Math.hypot(sl.x - px, sl.z - pz);
        if (d < bd) { bd = d; best = sl; }
      }
      // the counter, while something of this store is in your hands
      const pa = p.payAt;
      if (pa && p.till && p.till.held.length) {
        if (pa.byClerk) { const v = p.till.clerk && p.till.clerk.body(); if (v) { pa.x = v.pos.x; pa.z = v.pos.z; } }
        const d = Math.hypot(pa.x - px, pa.z - pz) - 0.8;          // (a counter is reached across)
        if (d < bd) { bd = d; best = pa; }
      }
    }
    return best;
  }

  function priceOf(name) { const e = econ(); return (e && e.buyPrice) ? e.buyPrice(name) : 0; }
  function note(t, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s); }

  /* THE ONE UNIT, IN THE HAND (systems/verbs_pickup.js). A product's stock
     is one InstancedMesh, so the unit you take is stood up as its own little
     object (the same baked model, the same unit transform) for the length of
     the reach: the hand closes on it, it comes off the shelf in the hand, and
     on that grab frame its instance goes to zero. The stand-up is hidden (the
     shelf still draws the unit) until the hand has it. */
  function slotObject(sl) {
    const p = sl.plan, P = protoOf(sl.name), u = frontUnit(sl);
    const parent = p && (p.goodsGroup || p.group);
    if (!P || !parent || !u) return null;
    const g = new THREE.Group();
    g.position.set(u.lx, u.ly, u.lz);
    g.rotation.set(0, u.yaw, 0);
    g.add(new THREE.Mesh(P.geo, mats().stock));
    g.visible = false;
    parent.add(g);
    return g;
  }
  function byHand(sl, then) {
    if (sl._taking) return;
    const V = CBZ.verbs;
    const obj = V && V.pickup ? slotObject(sl) : null;
    if (!obj) { then(); return; }
    sl._taking = true;
    V.pickup(CBZ.player, obj, {
      onTaken: function () { sl._taking = false; then(); },
      onDone: function () { sl._taking = false; if (obj.parent) obj.parent.remove(obj); },
    });
  }

  // (the harness's straight purchase: the unit off the shelf, paid for)
  function buySlot(sl) {
    if (!sl || onShelf(sl) <= 0 || sl._taking || !CBZ.cityShopAcquire) return;
    if (!CBZ.cityShopAcquire(sl.lot, sl.name, 1, null)) return;
    byHand(sl, function () { if (clearSlot(sl)) sl.held--; });
  }

  /* THE SHELF IS A REAL SHOP'S SHELF. You take the unit off it (it is in
     your hand, the shelf a gap) and you PAY at the counter, or put it back.
     What you are holding is the store's ledger, the one every shop keeps
     (city/shopfloor.js CBZ.shopFloor.till): head for the door with it and
     the clerk says so (an island clerk comes out from behind his counter to
     stand in the doorway); walk out with it and it is stolen — in your bag,
     the clerk calls it in, the goods are hot. The same law as the gun store,
     the pawn shop, the jeweller and the outfitter: one theft system. */
  function ledgerOf(p) {
    if (p.till) return p.till;
    const SF = CBZ.shopFloor, b = p.lot.building, F = p.F;
    if (!SF || !SF.till || !F) return null;
    // the room in the world (quarter turns: the corners' box is the room)
    const cs = [[0, -F.halfTan], [2 * F.halfIn, -F.halfTan], [0, F.halfTan], [2 * F.halfIn, F.halfTan]].map(function (c) {
      const w = p.toWorld(F.x(c[0], c[1]), p.FY, F.z(c[0], c[1])); return { x: w.x, z: w.z };
    });
    const box = { x0: Math.min.apply(null, cs.map(function (c) { return c.x; })), x1: Math.max.apply(null, cs.map(function (c) { return c.x; })),
      z0: Math.min.apply(null, cs.map(function (c) { return c.z; })), z1: Math.max.apply(null, cs.map(function (c) { return c.z; })) };
    const dw = p.toWorld(F.x(0.3, 0), p.FY, F.z(0.3, 0));
    const door = { x: dw.x, z: dw.z };
    // where you pay: the customer's side of the counter, else by the clerk
    if (p.K) {
      const q = p.toWorld(F.x(p.K.cIn - p.K.hIn - 0.45, p.K.cLat), p.FY, F.z(p.K.cIn - p.K.hIn - 0.45, p.K.cLat));
      p.payAt = { plan: p, pay: true, x: q.x, z: q.z };
    } else p.payAt = { plan: p, pay: true, x: door.x, z: door.z, byClerk: true };
    const clerk = b.clerkPost && SF.postedClerk
      ? SF.postedClerk({ post: b.clerkPost, b: b.clerkB, via: b.clerkVia, door: b.clerkDoor, armed: null })
      : SF.cityClerk(p.lot);
    p.till = SF.till({
      clerk: clerk, where: b.where || (p._island ? "isle" : "city"),
      inStore: function (x, z) { return x > box.x0 - 0.5 && x < box.x1 + 0.5 && z > box.z0 - 0.5 && z < box.z1 + 0.5; },
      nearDoor: function (x, z) { return Math.hypot(x - door.x, z - door.z) < 2.4; },
    });
    return p.till;
  }
  function itemOf(sl) {
    const lot = sl.plan.lot, name = sl.name;
    return {
      name: name, price: priceOf(name), slot: sl,
      // rung up: the goods in your bag the way the counter menu hands them over
      onPay: function () { sl.held = Math.max(0, (sl.held | 0) - 1); if (CBZ.cityShopAcquire) CBZ.cityShopAcquire(lot, name, 1, { free: true, bought: true }); },
      onSteal: function () { sl.held = Math.max(0, (sl.held | 0) - 1); if (CBZ.cityShopAcquire) CBZ.cityShopAcquire(lot, name, 1, { free: true }); },
      // back on the shelf (put back, or you went down with it)
      onReturn: function () { restoreSlot(sl); },
    };
  }
  function restoreSlot(sl) {
    sl.held = Math.max(0, (sl.held | 0) - 1);
    if (onShelf(sl) < sl.units.length) sl.left++;
    syncSlot(sl);
  }
  function takeSlot(sl) {
    if (!sl || onShelf(sl) <= 0 || sl._taking) return;
    const T = ledgerOf(sl.plan);
    if (!T) return;
    // one store's goods in your hands at a time: the last store's go back
    for (const q of PLANS) if (q !== sl.plan && q.till && q.till.held.length) q.till.dropAll();
    byHand(sl, function () {
      if (!clearSlot(sl)) return;
      T.hold(itemOf(sl));
      if (CBZ.sfx) CBZ.sfx("pickup");
    });
  }
  function putBack(sl) {
    const T = sl && sl.plan && sl.plan.till;
    if (!T) return;
    const it = T.holding(sl);
    if (!it) return;
    T.release(it);
    it.onReturn();
  }
  function payAt(p) {
    const T = p && p.till;
    if (!T || !T.held.length) return;
    // nobody behind the counter at all: the money is left by the till
    const nobody = !T.clerk || !T.clerk.body();
    T.pay(nobody);
  }
  // the ledger's turn: every store whose goods are in your hands
  function ledgersTick(dt) {
    for (let i = 0; i < PLANS.length; i++) {
      const p = PLANS[i];
      if (!p.till) continue;
      if (p.till.held.length || (p.till.clerk && p.till.clerk.out && p.till.clerk.out())) p.till.tick(dt);
      if (p.till.clerk && p.till.clerk.tick) p.till.clerk.tick(dt);
    }
  }

  const I = CBZ.interactions;
  if (I && I.registerZone) {
    I.registerZone({
      id: "zone-store-goods", kind: "storegoods", prio: 8, driving: false, islands: true,
      find: function (px, pz) {
        const g = CBZ.game;
        if (!g || !(CBZ.economyMode ? CBZ.economyMode(g.mode) : g.mode === "city") || CBZ.cityMenuOpen) return null;
        return nearestSlot(px, pz);
      },
      options: [
        {
          id: "storegoods-pay", slot: "e", prio: 8,
          label: function (t) { return "Pay " + fmt$(t.plan.till.total()); },
          canShow: function (t) { return !!(t && t.pay && t.plan.till && t.plan.till.held.length); },
          onSelect: function (t) { payAt(t.plan); },
        },
        {
          id: "storegoods-take", slot: "e",
          label: "Take",
          canShow: function (t) { return !!(t && !t.pay && onShelf(t) > 0); },
          onSelect: function (t) { takeSlot(t); },
        },
        {
          id: "storegoods-putback", slot: "e",
          label: "Put back",
          canShow: function (t) { return !!(t && !t.pay && t.held > 0 && onShelf(t) <= 0); },
          onSelect: function (t) { putBack(t); },
        },
      ],
    });
    if (I.describe) I.describe("storegoods", function (t) {
      if (t && t.pay) return { label: "Counter" };
      return { label: t.name, note: fmt$(priceOf(t.name)) };
    });
  }

  /* ============================================================
     5. PUBLIC HOOKS
     ============================================================ */
  // shops.js reads this to trim the counter menu: the names actually standing
  // in this store.
  CBZ.cityGoodsLive = function (lot) {
    const p = lot && BY_LOT.get(lot);
    return p ? p.names : null;
  };
  // the boards goods stand on, in world coords (tools / tripods)
  CBZ.cityStoreGoodsShelves = function (lot) {
    const p = lot && BY_LOT.get(lot);
    if (!p) return null;
    return p.boards.map(function (bo) {
      return { x: bo.wx, y: bo.wy, z: bo.wz, top: bo.y, fx: bo.wfx, fz: bo.wfz, island: bo.kind !== "wall", kind: bo.kind };
    });
  };
  // the fit-out's occupancy ledger: building-local footprints of every fixture
  // this file stands in a shell (fitout_work.js keeps its plant, bin, stockroom
  // and set pieces out of them instead of re-deriving the layout).
  CBZ.storeGoodsRects = function (b) { return (b && b.group && RECTS.get(b.group)) || null; };
  CBZ.cityGoodsLot = function (kind) {
    for (let i = 0; i < PLANS.length; i++) if (!kind || PLANS[i].kind === kind) return PLANS[i].lot;
    return null;
  };
  // headless / harness handle: buy a named unit off the nearest live store
  CBZ.cityGoodsBuy = function (name) {
    for (let i = 0; i < S.live.length; i++) {
      const p = S.live[i];
      for (let k = 0; k < p.slots.length; k++) {
        const sl = p.slots[k];
        if (sl.name === name && onShelf(sl) > 0) { buySlot(sl); return true; }
      }
    }
    return false;
  };
  // the lab's handle (tools/lab/storeshelf.js): stand a mounted plan up now,
  // with no player and no tick, so a turntable can photograph a shop floor
  CBZ.storeGoodsBuildNow = function (plan) {
    if (!plan) return false;
    refreshWorld(plan);
    buildPlan(plan);
    if (plan.goodsGroup) plan.goodsGroup.visible = true;
    return !!plan.built;
  };
  CBZ.cityStoreGoodsAudit = function () {
    let shelves = 0, slots = 0, standing = 0, goods = 0, meshes = 0;
    const kinds = {};
    for (let i = 0; i < PLANS.length; i++) {
      const p = PLANS[i];
      shelves += p.boards.length;
      slots += p.slots.length;
      goods += p.units;
      kinds[p.kind] = (kinds[p.kind] | 0) + 1;
      for (let k = 0; k < p.slots.length; k++) standing += onShelf(p.slots[k]);
      if (p.group) p.group.traverse(function (m) { if (m.isMesh) meshes++; });
    }
    return { stores: PLANS.length, kinds: kinds, shelves: shelves, slots: slots, standing: standing,
             goods: goods, meshes: meshes, live: S.live.length };
  };
  CBZ.cityStoreGoodsNear = function () {
    const P = CBZ.player;
    if (!P) return null;
    let best = null, bd = 1e9;
    for (let i = 0; i < PLANS.length; i++) {
      const d = Math.hypot(PLANS[i].cx - P.pos.x, PLANS[i].cz - P.pos.z);
      if (d < bd) { bd = d; best = PLANS[i]; }
    }
    if (!best) return null;
    let standing = 0, mesh = 0;
    for (let k = 0; k < best.slots.length; k++) standing += onShelf(best.slots[k]);
    if (best.group) best.group.traverse(function (m) { if (m.isMesh) mesh++; });
    return { kind: best.kind, dist: Math.round(bd * 10) / 10, names: best.names.slice(),
             shelves: best.boards.length, runs: best.runs.length, lanes: best.lanes.length,
             cooler: !!best.cooler, coffee: !!best.coffee, warmer: !!best.warmer,
             slots: best.slots.length, standing: standing, units: best.units, tris: best.tris,
             meshes: mesh, built: !!best.built };
  };
})();
