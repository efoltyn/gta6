#!/usr/bin/env node
/* tools/facade-reach-check.mjs — DOES ANY FACADE STAND ON THE STREET?

   OWNER: "facades, many spill onto streets."

   Plain node, the game's own generators, no browser, no captures. Counts
   every piece of building dressing that crosses its parcel line onto the
   footway or the road, in the three places buildings are dressed:

   1. GANG CITY DOWNTOWN (buildings.js cityBuildings). One lot per block, the
      parcel ends at the footway's back edge (world.js: lot = BLK - 4). Every
      street of the identity table (CITY_STREET_STYLE) is built through
      cityMakeBuilding exactly as the grid builds it — its homes in each
      grammar at each height, its storefront at shopSt and mixSt — at the
      street's setback (cityStreetSetback when the tree has it, else the
      table's constant), with opts.reach = that setback.
   2. TOWNS (towngen.js). A lot is its parcel (the footway runs outside the
      block's lots, neighbours abut). A spread of lot sizes, positions (so
      facadeAutoDress deals every family) and heights, sized the way towngen
      sizes them (cityFitShell when present, else lot - 1.5 m, no fence).
   3. THE METROS (metro_fabric.js facade cells: Kingsport, Karvel, the Gang
      City boroughs). Every dressed building's kit geometry as the fabric
      writes it, against the street's carriageway and the footway in front of
      it (a grid block's own footway ring, sw; elsewhere the 3.3 m pad ring
      and collector walks; a pad's local lanes have none).

   A shell violates when any drawn vertex, instanced piece or walk platform
   stands more than TOL past the parcel line. Reported per case: how far
   (m) and how many triangles. A metro building violates when any of its kit
   vertices lies inside a carriageway or footway band.

   Usage: node tools/facade-reach-check.mjs [--shells] [--metro] [-v]
          FR_ROOT=<tree>  measure another checkout (the "before" numbers)
   Exit 1 when anything violates.                                          */
import fs from "fs";
import vm from "vm";
import path from "path";
import { createRequire } from "module";

const ROOT = process.env.FR_ROOT || new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const argv = process.argv.slice(2);
const V = argv.includes("-v");
const ONLY_SHELLS = argv.includes("--shells"), ONLY_METRO = argv.includes("--metro");
const DO_SHELLS = !ONLY_METRO, DO_METRO = !ONLY_SHELLS;
const TOL = 0.02;

function indexScripts(re) {
  const html = fs.readFileSync(ROOT + "/index.html", "utf8");
  const out = [];
  for (const m of html.matchAll(/<script src="([^"?]+)(\?[^"]*)?"/g)) if (re.test(m[1])) out.push(m[1]);
  return out;
}

// ------------------------------------------------------------ 1+2. shells
function shellEnv() {
  const ctx = { console, Math, Date, JSON, Object, Array, Number, String, Boolean, Set, Map, WeakMap, WeakSet, Float32Array, Uint16Array, Uint32Array, Int32Array, Int16Array, Int8Array, Uint8Array, Float64Array, ArrayBuffer, DataView, Symbol, Error, TypeError, RangeError, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, Proxy, Reflect, Promise, setTimeout, clearTimeout, Uint8ClampedArray };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = function () {}; ctx.removeEventListener = function () {};
  ctx.performance = { now: () => Date.now() }; ctx.requestAnimationFrame = function () {};
  ctx.navigator = { userAgent: "node", maxTouchPoints: 0 };
  ctx.innerWidth = 1280; ctx.innerHeight = 720; ctx.devicePixelRatio = 1;
  ctx.location = { search: "", href: "http://x/", hostname: "x" };
  const c2d = (c) => new Proxy({ canvas: c, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), measureText: (t) => ({ width: String(t).length * 8 }),
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), createPattern: () => ({}) },
    { get(t, k) { return k in t ? t[k] : function () {}; }, set(t, k, v) { t[k] = v; return true; } });
  ctx.document = { createElement() { return { width: 300, height: 150, style: {}, getContext() { return this._c || (this._c = c2d(this)); }, addEventListener() {}, toDataURL() { return ""; } }; },
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, body: { appendChild() {} }, head: { appendChild() {} }, addEventListener() {} };
  vm.createContext(ctx);
  const load = (rel) => vm.runInContext(fs.readFileSync(ROOT + "/" + rel, "utf8"), ctx, { filename: rel });
  load("src/vendor/three.r128.min.js");
  load("src/vendor/BufferGeometryUtils.js");
  const THREE = ctx.THREE, matCache = new Map();
  ctx.CBZ = {
    CONFIG: {}, colliders: [], platforms: [], losBlockers: [], game: { mode: "city" }, WORLD_SEED: 90210,
    cmat(c, o) { o = o || {}; const k = c + "|" + (o.emissive || 0); if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color: c, emissive: o.emissive || 0 })); return matCache.get(k); },
    boxGeom(w, h, d) { return new THREE.BoxGeometry(w, h, d); },
    hash01(x, z, s) { const v = Math.sin(x * 12.9898 + z * 78.233 + (s || 0) * 0.123) * 43758.5453; return v - Math.floor(v); },
    onUpdate() {}, onAlways() {}, _lm: [], addLandmass(fn, order) { this._lm.push({ fn, order }); },
    markCollidersDirty() {}, markPlatformsDirty() {},
    registerCityRegion(city, r) { (city.regions = city.regions || []).push(r); return r; }, registerNoSpawnZone() {},
  };
  ctx.CBZ.mat = ctx.CBZ.cmat;
  const tryLoad = (f) => { try { load(f); } catch (e) { console.warn("load " + f + ": " + e.message); } };
  for (const f of ["src/world/textures_masonry.js", "src/world/building_dress.js"]) tryLoad(f);
  for (const f of ["src/systems/stairs.js", "src/city/buildings_civic.js", "src/city/buildings.js", "src/city/interiorlight.js"]) load(f);
  if (fs.existsSync(ROOT + "/src/city/facade_openings.js")) load("src/city/facade_openings.js");
  load("src/city/facade_kit.js");
  for (const f of indexScripts(/^src\/city\/facades\//)) load(f);
  return { THREE, CBZ: ctx.CBZ };
}

// the table as it stood before it was exported (the "before" tree)
const STREET_FALLBACK = {
  Midtown:    { grammar: "artdeco", shop: "artdeco", storeys: [12, 16], shopSt: 4, mixSt: 7, setback: 1.5 },
  Eastgate:   { grammar: "brick", shop: "brick", storeys: [10, 8], shopSt: 3, mixSt: 6, setback: 1.5 },
  Westend:    { grammar: "stone", shop: "stone", storeys: [8, 10], shopSt: 3, mixSt: 6, setback: 1.5 },
  Harborside: { grammar: "brick", shop: "brick", storeys: [7, 6], shopSt: 3, mixSt: 5, setback: 1.5 },
  Northpoint: { grammar: "brickhouse", shop: "brick", storeys: [3, 3], shopSt: 2, setback: 3.5 },
  Crownhill:  { grammar: ["queenanne", "victorian"], shop: "stone", storeys: [3, 3], shopSt: 2, setback: 3.5 },
  Southside:  { grammar: "brutalist", shop: "brick", storeys: [7, 8], shopSt: 2, setback: 3.0 },
  Ironworks:  { grammar: "brick", shop: "brick", storeys: [3, 3], shopSt: 2, setback: 2.0 },
  Dockyard:   { grammar: "brutalist", shop: "brick", storeys: [3, 4], shopSt: 2, setback: 2.0 },
};

function runShells() {
  const { THREE, CBZ } = shellEnv();
  const cases = [];
  let slot = 0;
  // how far past the parcel line a built shell reaches, and how many triangles do
  // `sawn`: the same shell built WITHOUT its parcel fence (opts.reach) — how
  // far its dressing would have run past the line, i.e. how much of it the
  // fence cuts off. A fence that saws a flight of steps in half keeps the
  // street clear by wrecking the facade; a shell sized for its facade has
  // nothing for the fence to cut.
  function measure(name, lotW, lotD, w, d, storeys, side, opts) {
    const build = function (o) {
      const ox = 2000 + (slot % 10) * 120, oz = -2000 + Math.floor(slot / 10) * 120;
      slot++;
      const root = new THREE.Group();
      CBZ.colliders.length = 0; CBZ.platforms.length = 0; CBZ.losBlockers.length = 0;
      const b = CBZ.cityMakeBuilding(root, ox, oz, w, d, storeys, 0x8a8f96, side, Object.assign({}, o));
      return measureAt(root, b, name, lotW, lotD, w, d, ox, oz);
    };
    try {
      const r = build(opts);
      if (opts.reach != null) { const o2 = Object.assign({}, opts); delete o2.reach; r.sawn = build(o2).over; }
      cases.push(r);
    } catch (e) { cases.push({ name, error: String(e && e.message || e) }); }
  }

  // ---- 1. Gang City downtown --------------------------------------------
  const TABLE = CBZ.CITY_STREET_STYLE || STREET_FALLBACK;
  const LOT = 30;   // config.js block 34 - 4 (world.js lot pad)
  for (const name in TABLE) {
    const SS = TABLE[name];
    const sb = CBZ.cityStreetSetback ? CBZ.cityStreetSetback(SS, 0, -700, LOT, LOT) : SS.setback;
    const w = LOT - 2 * sb;
    const grammars = Array.isArray(SS.grammar) ? SS.grammar : [SS.grammar];
    const heights = Array.isArray(SS.storeys) ? SS.storeys : [SS.storeys];
    const seen = new Set();
    for (const g of grammars) for (const st of heights) {
      if (seen.has(g + st)) continue; seen.add(g + st);
      for (const side of [0, 3]) measure("gang " + name + " " + g + " " + st + "st s" + side, LOT, LOT, w, w, st, side, { district: "core", facade: "office", dress: { style: g }, reach: sb });
    }
    for (const st of new Set([SS.shopSt, SS.mixSt || SS.shopSt])) {
      measure("gang " + name + " shop " + SS.shop + " " + st + "st", LOT, LOT, w, w, st, 1, { retail: true, storefront: true, district: "commercial", dress: { style: SS.shop }, reach: sb });
    }
  }
  // the flagship (makeMegaTower: 52 storeys on a parking deck, 1 m build
  // line, its body keep-clear), in each facade family's neighbourhood
  for (const [fx, fz] of [[0, -700], [360, -700], [720, -700], [1080, -700]]) {
    const STO = 52, FHs = 3.2;
    // sized the way the grid sizes it (cityBuildings standBack), when it can
    const fit = CBZ.cityFitShell ? CBZ.cityFitShell(fx, fz, LOT, LOT, 1, STO, 1, { garageGround: true, district: "core" }) : null;
    const w = fit ? fit.w : LOT - 2;
    const root = new THREE.Group();
    CBZ.colliders.length = 0; CBZ.platforms.length = 0;
    const opts = { garageGround: true, district: "core",
      keepClear: [{ x0: -w / 2, x1: w / 2, z0: -w / 2, z1: w / 2, y0: 0.01, y1: STO * FHs - 0.01 }] };
    if (fit) opts.reach = (LOT - w) / 2;
    try {
      const b = CBZ.cityMakeBuilding(root, fx, fz, w, w, STO, 0x223040, 1, Object.assign({}, opts));
      cases.push(measureAt(root, b, "gang flagship @" + fx + "," + fz, LOT, LOT, w, w, fx, fz));
    } catch (e) { cases.push({ name: "gang flagship", error: e.message }); }
  }
  // ---- 2. towns -----------------------------------------------------------
  const LOTS = [[12, 14], [14, 18], [16, 24], [20, 20], [24, 16], [13, 26]];
  const HEIGHTS = [1, 2, 4, 11];
  let k = 0;
  for (const [lw, ld] of LOTS) for (const st of HEIGHTS) for (const shop of [false, true]) {
    // positions 360 m apart: facadeAutoDress deals each a different family
    const cx = 5000 + (k % 7) * 360, cz = 3000 + Math.floor(k / 7) * 360; k++;
    const side = k % 4;
    const baseOpts = shop ? { retail: true } : { stairs: true };
    const fit = CBZ.cityFitShell ? CBZ.cityFitShell(cx, cz, lw, ld, 0.75, st, side, baseOpts) : null;
    const w = Math.max(8, fit ? fit.w : lw - 1.5), d = Math.max(8, fit ? fit.d : ld - 1.5);
    const reach = Math.min(lw - w, ld - d) / 2;
    const opts = fit && reach > 0.05 ? Object.assign({}, baseOpts, { reach }) : baseOpts;
    // measured at the town's own position (the auto pick is a position hash)
    const ox0 = cx, oz0 = cz;
    const root = new THREE.Group();
    CBZ.colliders.length = 0; CBZ.platforms.length = 0;
    let b; try { b = CBZ.cityMakeBuilding(root, ox0, oz0, w, d, st, 0x8a8f96, side, Object.assign({}, opts)); } catch (e) { cases.push({ name: "town", error: e.message }); continue; }
    if (!b.dressStyle) continue;   // a bare shell has no kit to spill
    cases.push(measureAt(root, b, "town " + lw + "x" + ld + " " + st + "st" + (shop ? " shop" : "") + " s" + side, lw, ld, w, d, ox0, oz0));
  }
  function measureAt(root, b, name, lotW, lotD, w, d, ox, oz) {
    if (CBZ.cityFlushPools) CBZ.cityFlushPools();
    const LX = lotW / 2, LZ = lotD / 2;
    let over = 0, tris = 0;
    const v = new THREE.Vector3(), m4 = new THREE.Matrix4(), M = new THREE.Matrix4();
    const past = (x, z) => Math.max(Math.abs(x - ox) - LX, Math.abs(z - oz) - LZ);
    root.updateMatrixWorld(true);
    root.traverse(function (o) {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      const P = o.geometry.attributes.position.array, I = o.geometry.index ? o.geometry.index.array : null;
      const n = I ? I.length / 3 : P.length / 9;
      const inst = o.isInstancedMesh ? o.count : 1;
      for (let q = 0; q < inst; q++) {
        if (o.isInstancedMesh) { o.getMatrixAt(q, m4); M.multiplyMatrices(o.matrixWorld, m4); } else M.copy(o.matrixWorld);
        for (let t = 0; t < n; t++) {
          let worst = -1e9;
          for (let c = 0; c < 3; c++) { const vi = I ? I[t * 3 + c] : t * 3 + c; v.set(P[vi * 3], P[vi * 3 + 1], P[vi * 3 + 2]).applyMatrix4(M); worst = Math.max(worst, past(v.x, v.z)); }
          if (o.isInstancedMesh && worst > 40) continue;
          if (worst > TOL) {
            tris++; over = Math.max(over, worst);
            if (process.env.FR_WHY && !o.__why) { o.__why = 1; console.log("      why " + name + ": " + (o.name || o.geometry.type) + " " + (o.material && o.material.color ? o.material.color.getHexString() : "") + " past " + worst.toFixed(2) + " y " + v.y.toFixed(2)); }
          }
        }
      }
    });
    for (const p of CBZ.platforms) {
      const o2 = Math.max(Math.max(Math.abs(p.minX - ox), Math.abs(p.maxX - ox)) - LX, Math.max(Math.abs(p.minZ - oz), Math.abs(p.maxZ - oz)) - LZ);
      if (o2 > TOL) { tris += 2; over = Math.max(over, o2); }
    }
    return { name, style: b.dressStyle || "-", lot: lotW + "x" + lotD, shell: w.toFixed(1) + "x" + d.toFixed(1), over: +over.toFixed(2), tris };
  }
  return cases;
}

// ------------------------------------------------------------ 3. metros
const HIST = {};
function runMetro() {
  const require = createRequire(import.meta.url);
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/metro-world-snapshot.json"), "utf8"));
  const THREE = require(path.join(ROOT, "src/vendor/three.r128.min.js"));
  globalThis.window = { THREE, CBZ: { CONFIG: {}, WORLD_SEED: 90210, highwayNetTable: () => snap.hw, HIGHWAY_NET_HALF: snap.H } };
  require(path.join(ROOT, "src/core/seed.js"));
  require(path.join(ROOT, "src/city/facade_kit.js"));
  for (const f of indexScripts(/^src\/city\/facades\//)) require(path.join(ROOT, f));
  require(path.join(ROOT, "src/city/zoning.js"));
  require(path.join(ROOT, "src/city/metroplan.js"));
  require(path.join(ROOT, "src/city/metro.js"));
  require(path.join(ROOT, "src/city/metro_fabric.js"));
  const CBZ = globalThis.window.CBZ, L = CBZ.metroLib, F = CBZ.metroFabric, segDist = CBZ.metroPlanLib.segDist;
  const _warn = console.warn; console.warn = function () { const t = Array.from(arguments).join(" "); if (/metro_fabric/.test(t)) return; return _warn.apply(console, arguments); };
  F.setFreeFar(false);
  const PAD_SW = 3.3;          // metro_ground.js: kerb + 3 m footway round a pad / street
  const city = {
    regions: snap.regions.map((r) => Object.assign({ kind: "rect" }, r)),
    roads: snap.roads.map((r) => ({ x: r[0], z: r[1], vertical: !!r[2], len: r[3], w: r[4], district: r[5] })),
    minX: snap.city.minX, maxX: snap.city.maxX, minZ: snap.city.minZ, maxZ: snap.city.maxZ, annex: snap.annex,
  };
  const out = [], planned = [];
  for (const site of L.siteTable(city)) {
    const P = L.planSite(city, site, planned);
    planned.push({ id: site.id, regions: L.planRegions(P), plan: P });
    // street segments, hashed
    const SH = 48, sh = new Map();
    for (const s of P.streets) for (let i = 0; i < s.pts.length - 1; i++) {
      const a = s.pts[i], b = s.pts[i + 1], pad = s.w / 2 + 6;
      for (let ix = Math.floor((Math.min(a.x, b.x) - pad) / SH); ix <= Math.floor((Math.max(a.x, b.x) + pad) / SH); ix++)
        for (let iz = Math.floor((Math.min(a.z, b.z) - pad) / SH); iz <= Math.floor((Math.max(a.z, b.z) + pad) / SH); iz++) {
          const k = ix * 100003 + iz; let l = sh.get(k); if (!l) sh.set(k, l = []); l.push([s, a, b]);
        }
    }
    // how deep (x,z) stands in a street's walk band: + = inside it. The pad
    // ring (arterials) and the collectors carry a footway; a pad's local
    // lanes and country roads have rolled kerbs and no walk (metro_ground)
    const fwOf = (st) => (st.k === "loc" || st.k === "rural") ? 0 : PAD_SW;
    const walkDepth = (x, z) => {
      let best = -1e9, road = false; const l = sh.get(Math.floor(x / SH) * 100003 + Math.floor(z / SH)); if (!l) return { d: best, road };
      for (const e of l) {
        const d = segDist(x, z, e[1].x, e[1].z, e[2].x, e[2].z) - e[0].w / 2;
        if (d < -TOL) road = true;
        if (fwOf(e[0]) - d > best) best = fwOf(e[0]) - d;
      }
      return { d: best, road };
    };
    const BH = 120, bh = new Map();
    for (const k of P.blocks || []) for (let ix = Math.floor(k.x0 / BH); ix <= Math.floor(k.x1 / BH); ix++) for (let iz = Math.floor(k.z0 / BH); iz <= Math.floor(k.z1 / BH); iz++) {
      const key = ix * 100003 + iz; let l = bh.get(key); if (!l) bh.set(key, l = []); l.push(k);
    }
    const blockAt = (x, z) => { const l = bh.get(Math.floor(x / BH) * 100003 + Math.floor(z / BH)); if (l) for (const k of l) if (x >= k.x0 && x <= k.x1 && z >= k.z0 && z <= k.z1) return k; return null; };
    // where is (x,z): 2 = carriageway, 1 = footway, 0 = the parcel
    const band = (x, z) => {
      const k = blockAt(x, z);
      if (k) { const sw = k.sw - TOL; return (x < k.x0 + sw || x > k.x1 - sw || z < k.z0 + sw || z > k.z1 - sw) ? 1 : 0; }
      const e = walkDepth(x, z);
      return e.road ? 2 : e.d > TOL ? 1 : 0;
    };
    const pr = F.prepare(P, { tile: L.TILE, name: site.id });
    const rec = { id: site.id, dressed: 0, onFoot: 0, onRoad: 0, deepest: 0, ex: [] };
    const V3 = F.variants(P);
    for (const c of pr.kit) {
      const J = F.job(P, c, "kit"); J.marks = [];
      F.runJob(J, Infinity);
      const geos = (c.meshes || []).slice(0, c.chunks).map((m) => m.geometry);
      const pos = new Float32Array(geos.reduce((a, g) => a + g.attributes.position.array.length, 0));
      { let o = 0; for (const g of geos) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; } }
      const ox = (c.ix + 0.5) * F.KIT_CELL, oz = (c.iz + 0.5) * F.KIT_CELL;
      const M = J.marks;
      for (let q = 0; q < M.length; q += 3) {
        const i = M[q], v0 = M[q + 1], v1 = M[q + 2], b = V3[i];
        if (v1 <= v0) continue;
        rec.dressed++;
        // the wall itself may stand where the band test says footway (a pad
        // building's corner): only kit relief that the WALL does not, counts
        const wallBand = Math.max(band(b.x, b.z), 0);
        let worst = 0, depth = 0;
        for (let v = v0; v < v1; v++) {
          const x = pos[v * 3] + ox, z = pos[v * 3 + 2] + oz;
          const bd = band(x, z);
          if (bd && process.env.FR_AT && Math.abs(b.x - +process.env.FR_AT.split(",")[0]) < 1 && Math.abs(b.z - +process.env.FR_AT.split(",")[1]) < 1 && !b.__p) { b.__p = 1; const k = blockAt(x, z); console.log("AT", JSON.stringify({ x, y: pos[v * 3 + 1], z, b: { x: b.x, z: b.z, w: b.w, d: b.d, rot: b.rot, face: b.face, type: b.type }, blk: k && { x0: k.x0, x1: k.x1, z0: k.z0, z1: k.z1, sw: k.sw } })); }
          if (bd > worst) worst = bd;
          if (bd) { const k = blockAt(x, z); const dd = k ? Math.max(k.x0 + k.sw - x, x - (k.x1 - k.sw), k.z0 + k.sw - z, z - (k.z1 - k.sw)) : walkDepth(x, z).d; if (dd > depth) depth = dd; }
        }
        if (wallBand) continue;
        if (worst === 2) rec.onRoad++;
        if (worst >= 1 && process.env.FR_DBG) { const kk = b.type + (b.kind ? "/" + b.kind : "") + (blockAt(b.x, b.z) ? " blk" : " pad") + " " + (depth < 0.2 ? "<0.2" : depth < 0.7 ? "<0.7" : ">=0.7"); HIST[kk] = (HIST[kk] || 0) + 1; }
        if (worst >= 1) { rec.onFoot++; rec.deepest = Math.max(rec.deepest, depth); if (rec.ex.length < 4) rec.ex.push(b.type + "/" + (b.style || "") + "@" + b.x.toFixed(0) + "," + b.z.toFixed(0) + " " + depth.toFixed(2) + "m"); }
      }
      for (const g of geos) g.dispose();
    }
    rec.deepest = +rec.deepest.toFixed(2);
    out.push(rec);
  }
  return out;
}

// ------------------------------------------------------------------ main
let bad = 0;
if (DO_SHELLS) {
  const cases = runShells();
  const gang = cases.filter((c) => /^gang/.test(c.name)), town = cases.filter((c) => /^town/.test(c.name));
  for (const [label, list] of [["Gang City downtown", gang], ["towns", town]]) {
    const v = list.filter((c) => c.error || c.over > TOL);
    bad += v.length;
    console.log(label + ": " + v.length + " of " + list.length + " shells cross their parcel line" +
      (v.length ? " (worst " + Math.max(...v.map((c) => c.over || 0)).toFixed(2) + " m, " + v.reduce((a, c) => a + (c.tris || 0), 0) + " triangles)" : ""));
    const sawn = list.filter((c) => c.sawn > TOL);
    if (label !== "towns") console.log("   " + sawn.length + " of " + list.length + " have dressing the parcel fence saws off" +
      (sawn.length ? " (up to " + Math.max(...sawn.map((c) => c.sawn)).toFixed(2) + " m of it)" : ""));
    for (const c of (V ? list : v.concat(sawn))) console.log("   " + (c.error ? c.name + " ERROR " + c.error : c.name.padEnd(42) + " " + String(c.style).padEnd(11) + " lot " + c.lot.padEnd(6) + " shell " + c.shell.padEnd(10) + " over " + c.over.toFixed(2) + " m  tris " + c.tris + (c.sawn != null ? "  sawn " + c.sawn.toFixed(2) + " m" : "")));
  }
}
if (DO_METRO) {
  const recs = runMetro();
  let foot = 0, road = 0, dressed = 0;
  for (const r of recs) { foot += r.onFoot; road += r.onRoad; dressed += r.dressed; }
  bad += foot;
  console.log("metros: " + foot + " of " + dressed + " dressed buildings put kit on the footway (" + road + " reach the carriageway)");
  for (const r of recs) if (r.onFoot || V) console.log("   " + r.id.padEnd(12) + " " + r.onFoot + "/" + r.dressed + " on the footway, " + r.onRoad + " on the road, deepest " + r.deepest + " m  " + r.ex.join(" | "));
}
if (process.env.FR_DBG) console.log(JSON.stringify(HIST, null, 1));
process.exit(bad ? 1 : 0);
