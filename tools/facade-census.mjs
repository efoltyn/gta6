#!/usr/bin/env node
/* tools/facade-census.mjs — EVERY BUILDING'S SKIN, COUNTED.

   OWNER: "Every single building in the game should expose real windows and
   have real doors. Many, like townhouses, mess this up, and some facades
   flicker because of overlap with the building structure."

   This builds one sample of every building TYPE the game makes, headless in
   plain node on the vendored r128 (no browser, no captures), through the
   generator's own code, and measures the skin it actually wrote:

     WINDOWS  per opening (panes grouped into the hole they glaze):
                real      glass set back >= 5 cm behind the wall face, a frame
                          round it, a sill under it, and >= 75% of it visible
                          from the street (nothing clad over it)
                covered   real glass with ornament laid across it
                flat      glass on (or proud of) the wall plane, no reveal
                painted   a window that is only paint (texture or shader) on
                          a flat wall, with no recess in geometry or shader
                shader    painted, but recessed by a parallax shader that
                          offsets the glass and the room behind it by depth
     DOORS    per building: real (a leaf in a recessed framed opening),
              flat (a leaf/box on the wall plane, no reveal), painted, or
              missing; and the street-door kit: step/stoop, light, number.
     ZFIGHT   coplanar faces with the SAME outward normal within 5 mm that
              would not draw the same pixel (tools/lib/facade-geom.mjs).

   COST     per type: merged faces (deco trim + walls), instanced module
            members (the window/door trim pool) and an estimate of what it
            holds (4 x 32 B a merged face, 76 B an instance).

   USAGE  node tools/facade-census.mjs [--json out.json] [--type substr] [-v]
          [--max-zfight N]  exit 1 when any type has more z-fight pairs
          [--gate]          exit 1 unless every type has real windows and a
                            real door and zero z-fights
          FC_ROOT=<tree>    measure another checkout (the "before" numbers:
                            git archive the base commit, point FC_ROOT at it)
          FC_BLOCK=1 -v     print what stands in front of a covered opening
          FC_BREAK=1        faces per mesh kind; FC_FORCED=1 forced windows  */
import fs from "fs";
import vm from "vm";
import { meshQuads, boxQuads, zfight, paneVisible } from "./lib/facade-geom.mjs";

const ROOT = process.env.FC_ROOT || new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const argv = process.argv.slice(2);
const V = argv.includes("-v");
const GATE = argv.includes("--gate");
const ONLY = argv.indexOf("--type") >= 0 ? argv[argv.indexOf("--type") + 1] : null;
const JSON_OUT = argv.indexOf("--json") >= 0 ? argv[argv.indexOf("--json") + 1] : null;
const MAXZ = argv.indexOf("--max-zfight") >= 0 ? +argv[argv.indexOf("--max-zfight") + 1] : null;
const TOL = 0.005;

// ---------------------------------------------------------------- the env
function makeEnv() {
  const ctx = { console, Math, Date, JSON, Object, Array, Number, String, Boolean, Set, Map, WeakMap, WeakSet, Float32Array, Uint16Array, Uint32Array, Int32Array, Int16Array, Int8Array, Uint8Array, Float64Array, ArrayBuffer, DataView, Symbol, Error, TypeError, RangeError, parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, Proxy, Reflect, Promise, setTimeout, clearTimeout, Uint8ClampedArray };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.addEventListener = function () {}; ctx.removeEventListener = function () {};
  ctx.performance = { now: () => Date.now() }; ctx.requestAnimationFrame = function () {};
  ctx.navigator = { userAgent: "node", maxTouchPoints: 0 };
  ctx.innerWidth = 1280; ctx.innerHeight = 720; ctx.devicePixelRatio = 1;
  ctx.location = { search: "", href: "http://x/", hostname: "x" };
  function ctx2d(c) {
    const base = { canvas: c, getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4).fill(128), width: w, height: h }; },
      createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }, measureText(t) { return { width: String(t).length * 8 }; },
      createLinearGradient() { return { addColorStop() {} }; }, createRadialGradient() { return { addColorStop() {} }; }, createPattern() { return {}; } };
    return new Proxy(base, { get(t, k) { if (k in t) return t[k]; return function () {}; }, set(t, k, v) { t[k] = v; return true; } });
  }
  ctx.document = { createElement() { return { width: 300, height: 150, style: {}, getContext() { return this._c || (this._c = ctx2d(this)); }, addEventListener() {}, toDataURL() { return ""; } }; },
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, body: { appendChild() {} }, head: { appendChild() {} }, addEventListener() {} };
  vm.createContext(ctx);
  const load = (rel) => vm.runInContext(fs.readFileSync(ROOT + "/" + rel, "utf8"), ctx, { filename: rel });
  load("src/vendor/three.r128.min.js");
  load("src/vendor/BufferGeometryUtils.js");
  const THREE = ctx.THREE;
  const matCache = new Map();
  ctx.CBZ = {
    CONFIG: {}, colliders: [], platforms: [], losBlockers: [], game: { mode: "city" }, WORLD_SEED: 90210,
    cmat(c, o) { o = o || {}; const k = c + "|" + (o.emissive || 0) + "|" + (o.ei || 0); if (!matCache.has(k)) { const m = new THREE.MeshLambertMaterial({ color: c, emissive: o.emissive || 0 }); m._shared = true; matCache.set(k, m); } return matCache.get(k); },
    boxGeom(w, h, d) { return new THREE.BoxGeometry(w, h, d); },
    hash01(x, z, s) { const v = Math.sin(x * 12.9898 + z * 78.233 + (s || 0) * 0.123) * 43758.5453; return v - Math.floor(v); },
    onUpdate() {}, onAlways() {}, _lm: [], addLandmass(fn, order) { this._lm.push({ fn, order }); },
    markCollidersDirty() {}, markPlatformsDirty() {},
    registerCityRegion(city, r) { (city.regions = city.regions || []).push(r); return r; },
    registerNoSpawnZone() {},
  };
  ctx.CBZ.mat = ctx.CBZ.cmat;
  return { ctx, load, THREE, CBZ: ctx.CBZ };
}

function indexScripts(re) {
  const html = fs.readFileSync(ROOT + "/index.html", "utf8");
  const out = [];
  for (const m of html.matchAll(/<script src="([^"?]+)(\?[^"]*)?"/g)) if (re.test(m[1])) out.push(m[1]);
  return out;
}

// ------------------------------------------------------ the shell world
const S = makeEnv();
{
  const tryLoad = (f) => { try { S.load(f); } catch (e) { console.warn("load " + f + ": " + e.message); } };
  for (const f of ["src/world/textures_masonry.js", "src/world/building_dress.js"]) tryLoad(f);
  for (const f of ["src/systems/stairs.js", "src/city/buildings_civic.js", "src/city/buildings.js", "src/city/interiorlight.js"]) S.load(f);
  if (fs.existsSync(ROOT + "/src/city/facade_openings.js")) S.load("src/city/facade_openings.js");
  S.load("src/city/facade_kit.js");
  for (const f of indexScripts(/^src\/city\/facades\//)) S.load(f);
}
const THREE = S.THREE, CBZ = S.CBZ;

/* ---- opening analysis for a makeBuilding shell -------------------------
   panes come from b.windows (the shell's own glass records, world coords).
   Group panes that share a plane into the opening they glaze, then judge
   each opening against the boxes around it. */
function faceOf(b, p) {
  // which face of the shell this pane belongs to, by its nearest wall plane
  const lx = p.x - b.ox, lz = p.z - b.oz;
  const thinX = p.hw < p.hd;            // a pane thin in x faces ±x
  if (thinX) return { ax: 0, sg: lx < 0 ? -1 : 1, plane: b.ox + (lx < 0 ? -b.w / 2 : b.w / 2) };
  return { ax: 2, sg: lz < 0 ? -1 : 1, plane: b.oz + (lz < 0 ? -b.d / 2 : b.d / 2) };
}
function openingsOf(b, panes) {
  const groups = new Map();
  for (const p of panes) {
    const f = faceOf(b, p);
    const outer = f.ax === 0 ? (f.sg > 0 ? p.x + p.hw : p.x - p.hw) : (f.sg > 0 ? p.z + p.hd : p.z - p.hd);
    const key = f.ax + "|" + f.sg + "|" + outer.toFixed(3);
    let g = groups.get(key); if (!g) { g = { f, outer, panes: [] }; groups.set(key, g); } g.panes.push(p);
  }
  const out = [];
  groups.forEach(function (g) {
    // union-find panes that touch within 2 cm into openings
    const rects = g.panes.map((p) => ({ t0: (g.f.ax === 0 ? p.z - p.hd : p.x - p.hw), t1: (g.f.ax === 0 ? p.z + p.hd : p.x + p.hw), y0: p.y - p.hh, y1: p.y + p.hh, p }));
    const par = rects.map((_, i) => i);
    const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], c = rects[j];
      if (a.t0 <= c.t1 + 0.02 && c.t0 <= a.t1 + 0.02 && a.y0 <= c.y1 + 0.02 && c.y0 <= a.y1 + 0.02) par[find(i)] = find(j);
    }
    const m = new Map();
    rects.forEach((r, i) => { const k = find(i); let o = m.get(k); if (!o) { o = { f: g.f, outer: g.outer, t0: 1e9, t1: -1e9, y0: 1e9, y1: -1e9, panes: [] }; m.set(k, o); } o.t0 = Math.min(o.t0, r.t0); o.t1 = Math.max(o.t1, r.t1); o.y0 = Math.min(o.y0, r.y0); o.y1 = Math.max(o.y1, r.y1); o.panes.push(r.p); });
    m.forEach((o) => out.push(o));
  });
  return out;
}
/* the shell's own opening list (the facade-openings shells publish b.openings):
   each opening with the panes that glaze it. An opening with no glass is a
   derelict's broken window: judged as an opening, glass not required. */
function openingsFromRecord(b) {
  const out = [];
  const panes = b.windows || [];
  for (const op of b.openings) {
    const horiz = op.s === 0 || op.s === 1, sg = (op.s === 0 || op.s === 2) ? -1 : 1;
    const plane = horiz ? b.oz + sg * b.d / 2 : b.ox + sg * b.w / 2;
    const f = { ax: horiz ? 2 : 0, sg: sg, plane: plane };
    const T0 = (horiz ? b.ox : b.oz) + op.t0, T1 = (horiz ? b.ox : b.oz) + op.t1;
    const mine = panes.filter((p) => {
      const t = horiz ? p.x : p.z, n = horiz ? p.z : p.x;
      return t > T0 - 0.01 && t < T1 + 0.01 && p.y > op.y0 - 0.01 && p.y < op.y1 + 0.01 && Math.abs(n - plane) < 0.6 && (horiz ? p.hd < p.hw : p.hw < p.hd);
    });
    let outer = plane - sg * 0.2;
    if (mine.length) { const p = mine[0]; outer = horiz ? p.z + sg * p.hd : p.x + sg * p.hw; }
    out.push({ f: f, outer: outer, t0: T0, t1: T1, y0: op.y0, y1: op.y1, panes: mine, rec: op });
  }
  return out;
}
function judgeOpening(o, boxes) {
  const f = o.f;
  const recess = (f.plane - o.outer) * f.sg;              // + = glass behind the face
  const W = o.t1 - o.t0, H = o.y1 - o.y0;
  const tAx = f.ax === 0 ? "z" : "x";
  const nAx = f.ax === 0 ? "x" : "z";
  const out = (b) => f.sg > 0 ? b[nAx + "1"] - f.plane : f.plane - b[nAx + "0"];   // how far a box stands proud
  // frame members: boxes inside the opening's border band, between the pane
  // and just proud of the face
  let head = false, jl = false, jr = false, sill = false, lintel = false;
  for (const b of boxes) {
    const bt0 = b[tAx + "0"], bt1 = b[tAx + "1"];
    const front = f.sg > 0 ? b[nAx + "1"] : -b[nAx + "0"];
    const back = f.sg > 0 ? b[nAx + "0"] : -b[nAx + "1"];
    const paneOut = f.sg > 0 ? o.outer : -o.outer;
    const faceOut = f.sg > 0 ? f.plane : -f.plane;
    const inDepth = front >= paneOut - 0.005 && back <= faceOut + 0.25;
    // a frame member lies inside the opening (or its 6 cm surround) and in its depth
    if (inDepth) {
      const overT = Math.min(bt1, o.t1 + 0.06) - Math.max(bt0, o.t0 - 0.06);
      const overY = Math.min(b.y1, o.y1 + 0.06) - Math.max(b.y0, o.y0 - 0.06);
      if (overT > W * 0.7 && b.y1 - b.y0 < 0.3 && Math.abs(b.y0 - o.y1) < 0.08 || (overT > W * 0.7 && b.y0 < o.y1 + 0.02 && b.y1 > o.y1 - 0.12 && b.y1 - b.y0 < 0.3)) head = true;
      if (overY > H * 0.7 && bt1 - bt0 < 0.3 && Math.abs(bt1 - o.t0) < 0.1) jl = true;
      if (overY > H * 0.7 && bt1 - bt0 < 0.3 && Math.abs(bt0 - o.t1) < 0.1) jr = true;
    }
    // a sill: under the opening bottom, proud of the face, as wide as it
    const overW = Math.min(bt1, o.t1) - Math.max(bt0, o.t0);
    if (overW > W * 0.8 && b.y1 <= o.y0 + 0.07 && b.y1 >= o.y0 - 0.12 && out(b) >= 0.02) sill = true;
    if (overW > W * 0.8 && b.y0 >= o.y1 - 0.07 && b.y0 <= o.y1 + 0.35 && out(b) >= 0.01) lintel = true;
  }
  // visibility: every pane of the opening, area-weighted
  let vis = 0, A = 0;
  const nrm = { ax: f.ax, sg: f.sg };
  for (const p of o.panes) {
    const a = (p.hw * 2 + p.hd * 2) * p.hh * 2;
    vis += a * paneVisible({ x0: p.x - p.hw, x1: p.x + p.hw, y0: p.y - p.hh, y1: p.y + p.hh, z0: p.z - p.hd, z1: p.z + p.hd }, nrm, boxes, 1.0, 0.09);
    A += a;
  }
  if (!o.panes.length) {
    // no glass (a derelict's broken window): what you see is the hole itself
    const p0 = { x0: 0, x1: 0, y0: o.y0, y1: o.y1, z0: 0, z1: 0 };
    if (f.ax === 0) { p0.x0 = p0.x1 = f.plane - f.sg * 0.2; p0.z0 = o.t0; p0.z1 = o.t1; }
    else { p0.z0 = p0.z1 = f.plane - f.sg * 0.2; p0.x0 = o.t0; p0.x1 = o.t1; }
    vis = paneVisible(p0, nrm, boxes, 1.0, 0.09); A = 1;
  }
  vis = A ? vis / A : 0;
  const framed = (head ? 1 : 0) + (jl ? 1 : 0) + (jr ? 1 : 0) >= 2;
  // a storefront's glass meets the floor on its frame (no sill by design), and
  // an opening whose facade laid its own course under it is sat on that
  const needSill = !(o.rec && (o.rec.style === "shop" || o.rec.bare === false));
  let cls;
  if (recess < 0.045) cls = "flat";
  else if (vis < 0.5) cls = "covered";
  else if (!framed || (needSill && !sill)) cls = "bare";
  else cls = "real";
  return { cls, recess, vis, framed, sill, lintel, W, H };
}
/* THE STREET DOORS, measured off what was drawn:
     real    a hinged leaf whose street face sits >= 8 cm behind the wall face,
             in a framed opening (a stop or casing round it)
     flat    a leaf on (or proud of) the wall plane
     missing no leaf at all
   and the street-door kit, each found in the geometry near the door:
     step   a box standing out >= 25 cm from the wall with its top 5-50 cm up
     light  a self-lit fitting (emissive) within 2.6 m of the door, 1.5-3.4 m up
     number digits (the house-number pool) within 2.6 m, 1.4-3.4 m up        */
function doorsOf(b, boxes, root) {
  const out = [];
  const lamps = [];
  b.group.updateMatrixWorld(true);
  b.group.traverse(function (o) {
    if (!o.isMesh || !o.material || !o.material.emissive) return;
    const e = o.material.emissive;
    if (e.r + e.g + e.b < 0.3 || o.material.transparent) return;
    const bb = new THREE.Box3().setFromObject(o);
    lamps.push(bb);
  });
  const digits = [];
  const m4 = new THREE.Matrix4(), pv = new THREE.Vector3();
  root.traverse(function (o) {
    if (!o.isInstancedMesh || o.name !== "house-numbers") return;
    for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m4); pv.setFromMatrixPosition(m4); digits.push(pv.clone()); }
  });
  for (const dr of (b.doors || [])) {
    const leaf = dr.leaf;
    if (!leaf) { out.push({ cls: "missing" }); continue; }
    leaf.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(leaf);
    const nx = -dr.inx, nz = -dr.inz;                 // outward
    let plane, sg, ax;
    if (Math.abs(nx) > 0.5) { ax = 0; sg = nx > 0 ? 1 : -1; plane = b.ox + sg * b.w / 2; }
    else { ax = 2; sg = nz > 0 ? 1 : -1; plane = b.oz + sg * b.d / 2; }
    const leafFront = ax === 0 ? (sg > 0 ? bb.max.x : bb.min.x) : (sg > 0 ? bb.max.z : bb.min.z);
    const recess = (plane - leafFront) * sg;
    const tAx = ax === 0 ? "z" : "x", nAx = ax === 0 ? "x" : "z";
    const dc = ax === 0 ? dr.wz : dr.wx;
    let step = false, frame = false;
    for (const x of boxes) {
      const proud = sg > 0 ? x[nAx + "1"] - plane : plane - x[nAx + "0"];
      const near = Math.min(x[tAx + "1"], dc + 1.6) - Math.max(x[tAx + "0"], dc - 1.6);
      if (near <= 0) continue;
      if (x.y1 <= 0.5 && x.y1 > 0.05 && proud > 0.25) step = true;
      // a stop / casing: a member inside the reveal beside or over the leaf
      if (proud < 0 && proud > -0.2 && x.y1 > 1.0 && (x[tAx + "1"] - x[tAx + "0"]) < 0.3) frame = true;
    }
    const near2 = function (x, y, z) {
      const t = ax === 0 ? z : x, n = ax === 0 ? x : z;
      return Math.abs(t - dc) < 2.6 && Math.abs(n - plane) < 1.8 && y > 1.4 && y < 3.6;
    };
    let light = false;
    for (const L of lamps) { const c = L.getCenter(new THREE.Vector3()); if (near2(c.x, c.y, c.z)) { light = true; break; } }
    let number = false;
    for (const d of digits) if (near2(d.x, d.y, d.z)) { number = true; break; }
    const kit = b.doorKit || [];
    out.push({ cls: recess >= 0.08 && frame ? "real" : (recess >= 0.08 ? "unframed" : "flat"), recess, step: step || kit.indexOf("stoop") >= 0, light, number,
      transom: kit.indexOf("transom") >= 0, stoop: kit.indexOf("stoop") >= 0, canopy: kit.indexOf("canopy") >= 0 });
  }
  if (!out.length) out.push({ cls: b.doorKind === "deck" ? "bay" : "missing" });
  return out;
}

const CITY_ROOT = new THREE.Group();
function shellRecords(b, root) {
  // the pooled records this shell registered: glass (b.windows), plus the
  // world-space pools (interior glow, veneer, room deco) — pull them out of
  // the global lists by the shell's footprint
  const pad = 1.5;
  const inFoot = (x, z) => x > b.ox - b.w / 2 - pad && x < b.ox + b.w / 2 + pad && z > b.oz - b.d / 2 - pad && z < b.oz + b.d / 2 + pad;
  const quads = [], boxes = [];
  let instTrim = 0;
  for (const p of b.windows || []) {
    const bx = { x0: p.x - p.hw, x1: p.x + p.hw, y0: p.y - p.hh, y1: p.y + p.hh, z0: p.z - p.hd, z1: p.z + p.hd };
    for (const q of boxQuads(bx, "glass" + (p.kind || "") + (p.tint || 0), "xz")) quads.push(q);
  }
  // instanced pools hung on the root (interior glow planes, masonry veneer, room deco)
  root.updateMatrixWorld(true);
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), q4 = new THREE.Quaternion(), scl = new THREE.Vector3();
  root.traverse(function (o) {
    if (!o.isInstancedMesh) return;
    if (o.userData && o.userData.glassPool && !/^cityInteriorGlow/.test(o.name || "")) {
      // the pane pools carry b.windows (already counted from the records);
      // the room-deco / veneer pools ride the same flag: keep those
      const c = o.material && o.material.color ? o.material.color.getHex() : 0;
      if (o.material && o.material.transparent) return;
    }
    const key = (o.name || "im") + ":" + (o.material && o.material.color ? o.material.color.getHex().toString(16) : "");
    const g = o.geometry; g.computeBoundingBox && g.computeBoundingBox();
    const gb = g.boundingBox;
    const isPlane = gb && (gb.max.z - gb.min.z) < 1e-6;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m4); m4.decompose(pos, q4, scl);
      if (scl.x === 0 && scl.y === 0) continue;
      if (!inFoot(pos.x, pos.z)) continue;
      if (isPlane) {
        // a +z plane rotated about y to face its window: axis-aligned only
        const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q4);
        const ax = Math.abs(n.x) > 0.99 ? 0 : 2;
        const sg = ax === 0 ? Math.sign(n.x) : Math.sign(n.z);
        const hw = scl.x / 2, hh = scl.y / 2;
        if (ax === 0) quads.push({ ax: 0, sg, off: pos.x, u0: pos.y - hh, u1: pos.y + hh, v0: pos.z - hw, v1: pos.z + hw, key, vc: false, src: "#" + key });
        else quads.push({ ax: 2, sg, off: pos.z, u0: pos.x - hw, u1: pos.x + hw, v0: pos.y - hh, v1: pos.y + hh, key, vc: false, src: "#" + key });
      } else {
        const ik = o.instanceColor ? key + ":" + new THREE.Color(o.instanceColor.getX(i), o.instanceColor.getY(i), o.instanceColor.getZ(i)).getHex().toString(16) : key;
        if (o.name === "facade-trim") instTrim++;
        const bx = { x0: pos.x - scl.x / 2, x1: pos.x + scl.x / 2, y0: pos.y - scl.y / 2, y1: pos.y + scl.y / 2, z0: pos.z - scl.z / 2, z1: pos.z + scl.z / 2 };
        for (const q of boxQuads(bx, ik, "xyz")) { q.src = (o.name === "facade-trim" ? "trim" : "") + "#" + ik; quads.push(q); }
        if (!(o.material && o.material.transparent)) boxes.push(Object.assign({ look: ik }, bx));
      }
    }
  });
  return { quads, boxes, instTrim };
}

let __slot = 0;
function buildShell(spec) {
  // each sample on its own patch of ground, far from the others
  const ox = 1000 + (__slot % 8) * 160, oz = -1000 + Math.floor(__slot / 8) * 160;
  __slot++;
  const root = new THREE.Group();
  CBZ.colliders.length = 0; CBZ.platforms.length = 0; CBZ.losBlockers.length = 0;
  const opts = Object.assign({}, spec.opts || {});
  const b = CBZ.cityMakeBuilding(root, ox, oz, spec.w, spec.d, spec.storeys, spec.color || 0x8a8f96, spec.side || 0, opts);
  if (CBZ.cityFlushPools) CBZ.cityFlushPools();
  return { b, root };
}

function measureShell(name, gen, spec) {
  const { b, root } = buildShell(spec);
  return measureBuilt(THREE, name, gen, b, root);
}
function measureBuilt(THREE_, name, gen, b, root) {
  const G = meshQuads(THREE_, b.group);
  if (process.env.FC_BREAK) { const by = {}; for (const q of G.quads) { const k = q.src.split("#")[0]; by[k] = (by[k] || 0) + 1; } console.log("   faces by mesh kind", JSON.stringify(by)); }
  const P = shellRecords(b, root);
  const quads = G.quads.concat(P.quads);
  const boxes = G.boxes.concat(P.boxes);
  const ops = Array.isArray(b.openings) ? openingsFromRecord(b) : openingsOf(b, b.windows || []);
  if (process.env.FC_FORCED && Array.isArray(b.openings)) { let f = 0; for (const op of b.openings) if (op.forced) f++; console.log("   forced", f, "of", b.openings.length); }
  const wins = { real: 0, covered: 0, flat: 0, bare: 0, painted: 0, shader: 0 };
  let recessSum = 0;
  const ex = [];
  for (const o of ops) {
    const j = judgeOpening(o, boxes);
    wins[j.cls]++; recessSum += j.recess;
    // FC_BLOCK=1 -v: print what stands in front of the first covered opening
    if (process.env.FC_BLOCK && j.cls === "covered" && !ex.length) {
      const p = o.panes[0], f = o.f;
      const cx = p.x, cy = p.y, cz = p.z;
      for (const b of boxes) {
        const tw = f.ax === 0 ? Math.min(b.z1 - b.z0, b.y1 - b.y0) : Math.min(b.x1 - b.x0, b.y1 - b.y0);
        if (tw <= 0.09 || cy <= b.y0 || cy >= b.y1) continue;
        if (f.ax === 0 ? (cz <= b.z0 || cz >= b.z1) : (cx <= b.x0 || cx >= b.x1)) continue;
        const n0 = f.ax === 0 ? b.x0 : b.z0, n1 = f.ax === 0 ? b.x1 : b.z1, pc = f.ax === 0 ? cx : cz;
        if ((f.sg > 0 && n1 > pc) || (f.sg < 0 && n0 < pc)) console.log("   blocker", b.look, [b.x0 - b.x0, b.x1 - b.x0, b.y0, b.y1, b.z1 - b.z0].map((v) => +v.toFixed(2)), "n", (n0 - pc).toFixed(3), (n1 - pc).toFixed(3));
      }
    }
    if (j.cls !== "real" && ex.length < 3) ex.push(j.cls + " " + o.f.ax + o.f.sg + " y" + o.y0.toFixed(2) + " w" + j.W.toFixed(2) + " rec" + j.recess.toFixed(2) + " vis" + j.vis.toFixed(2) + (j.framed ? "" : " noframe") + (j.sill ? "" : " nosill"));
  }
  const doors = doorsOf(b, boxes, root);
  const z = zfight(quads, TOL, { samples: 6, solids: boxes });
  return { name, gen, kind: "shell", style: b.dressStyle || b.facade, openings: ops.length, wins, recess: ops.length ? +(recessSum / ops.length).toFixed(3) : 0,
    doors, z, tris: G.quads.length, inst: P.instTrim, panes: (b.windows || []).length, cols: (b.colliders || []).length,
    // what it costs to hold: merged faces (4 vertices x 32 B: position, normal,
    // uv) + instanced trim (a 4x4 matrix + a colour: 76 B each)
    bytes: G.quads.length * 4 * 32 + P.instTrim * 76, ex };
}

// ------------------------------------------------------------ the types
/* Every generator that makes a building, and the shell variant it asks
   makeBuilding for. The generators that go through makeBuilding are
   measured by building that exact variant; `check` greps the generator for
   the call so a type cannot outlive its caller unnoticed. */
const SHELL_TYPES = [
  // Gang City lots (buildings.js STREET_STYLE) — the realism-wave facades
  { name: "gang: Midtown tower (artdeco)", gen: "buildings.js", w: 22, d: 20, storeys: 9, opts: { district: "core", dress: { style: "artdeco" }, reach: 1.5 }, color: 0xcfc2a4 },
  { name: "gang: Eastgate loft (brick)", gen: "buildings.js", w: 18, d: 16, storeys: 5, opts: { district: "commercial", dress: { style: "brick" }, reach: 1.5 }, color: 0x8a3b26 },
  { name: "gang: Westend (stone)", gen: "buildings.js", w: 18, d: 16, storeys: 4, opts: { district: "commercial", dress: { style: "stone" }, reach: 1.5 }, color: 0xcab99a },
  { name: "gang: Northpoint rowhouse (brickhouse)", gen: "buildings.js", w: 12, d: 14, storeys: 3, opts: { district: "residential", dress: { style: "brickhouse" }, reach: 3.5 }, color: 0x98482e },
  { name: "gang: Crownhill (queenanne)", gen: "buildings.js", w: 12, d: 14, storeys: 3, opts: { district: "residential", dress: { style: "queenanne" }, reach: 3.5 }, color: 0x6f8ea4 },
  { name: "gang: Crownhill (victorian)", gen: "buildings.js", w: 12, d: 14, storeys: 3, opts: { district: "residential", dress: { style: "victorian" }, reach: 3.5 }, color: 0xb09a78 },
  { name: "gang: Southside block (brutalist)", gen: "buildings.js", w: 22, d: 18, storeys: 6, opts: { district: "projects", dress: { style: "brutalist" }, reach: 3.0 }, color: 0x8c8983 },
  { name: "gang: shop (brick storefront)", gen: "buildings.js", w: 14, d: 14, storeys: 3, opts: { district: "commercial", retail: true, dress: { style: "brick" }, reach: 1.5 }, color: 0x8a3b26 },
  { name: "gang: shop (stone storefront)", gen: "buildings.js", w: 14, d: 14, storeys: 2, opts: { district: "commercial", retail: true, dress: { style: "stone" }, reach: 1.5 }, color: 0xcab99a },
  { name: "gang: showroom (car lot)", gen: "buildings.js", w: 18, d: 16, storeys: 1, opts: { showroom: true, retail: true, dress: false }, color: 0x8a8f96 },
  { name: "gang: office tower (bare glass)", gen: "buildings.js", w: 20, d: 20, storeys: 10, opts: { office: true, glassKind: "clear", district: "core", dress: false }, color: 0x5b6b82 },
  { name: "gang: derelict (boarded)", gen: "buildings.js", w: 16, d: 14, storeys: 3, opts: { boarded: true, district: "projects", dress: false }, color: 0x4a4438 },
  { name: "gang: bank (fortified)", gen: "buildings.js", w: 18, d: 16, storeys: 2, opts: { facade: "fortified", dress: false }, color: 0xb0aa9e },
  { name: "civic: courthouse (civic order)", gen: "buildings_civic.js / govcomplex.js", w: 30, d: 22, storeys: 3, opts: { facade: "civic", civic: { kind: "courthouse", order: "doric", stone: true, monumental: true }, dress: false }, color: 0xd8d2c4 },
  { name: "civic: state house (4.6 m storeys, dome)", gen: "govcomplex.js estate", w: 40, d: 26, storeys: 2, opts: { fh: 4.6, facade: "civic", civic: { kind: "capitol", order: "ionic", crown: "dome", stone: true, monumental: true }, dress: false }, color: 0xe2dccd },
  { name: "gang: flagship parking deck", gen: "buildings.js makeMegaTower", w: 30, d: 30, storeys: 12, opts: { garageGround: true, office: true, glassKind: "clear", dress: false }, color: 0x223040 },
  { name: "gang: Ironworks works (industrial)", gen: "buildings.js", w: 22, d: 18, storeys: 3, opts: { district: "industrial", dress: { style: "brick" }, reach: 2.0 }, color: 0x5c3a2c },
  { name: "gang: apartment block (undressed)", gen: "buildings.js / expansion.js", w: 20, d: 16, storeys: 6, opts: { district: "residential", dress: false }, color: 0x8a8f96 },
  // the automatic family pick (towns, islands, biomes: facade_kit.js FAMILIES)
  { name: "town: house (manor)", gen: "towngen.js / facadeAutoDress", w: 12, d: 12, storeys: 2, opts: { dress: { style: "manor" } }, color: 0xb9a888 },
  { name: "town: house (techhouse)", gen: "towngen.js / facadeAutoDress", w: 12, d: 12, storeys: 2, opts: { dress: { style: "techhouse" } }, color: 0xa0a4a8 },
  { name: "town: tower (intl)", gen: "towngen.js / facadeAutoDress", w: 20, d: 20, storeys: 12, opts: { dress: { style: "intl" } }, color: 0x7a8696 },
  { name: "town: block (brick, auto)", gen: "towngen.js / minicities / citytemplates", w: 16, d: 14, storeys: 4, opts: { dress: { style: "brick" } }, color: 0x8a5040 },
  { name: "town: house (brickhouse, auto)", gen: "towngen.js / villagekit / settlements", w: 10, d: 12, storeys: 2, opts: { dress: { style: "brickhouse" } }, color: 0x98482e },
  { name: "town: house (queenanne, auto)", gen: "towngen.js", w: 10, d: 12, storeys: 2, opts: { dress: { style: "queenanne" } }, color: 0x6f8ea4 },
  { name: "town: block (stone, auto)", gen: "towngen.js", w: 16, d: 14, storeys: 4, opts: { dress: { style: "stone" } }, color: 0xcab99a },
  { name: "town: block (victorian, auto)", gen: "towngen.js", w: 14, d: 14, storeys: 4, opts: { dress: { style: "victorian" } }, color: 0xb09a78 },
  { name: "town: tower (artdeco, auto)", gen: "towngen.js", w: 20, d: 20, storeys: 11, opts: { dress: { style: "artdeco" } }, color: 0xcfc2a4 },
  { name: "town: block (brutalist, auto)", gen: "towngen.js", w: 18, d: 16, storeys: 5, opts: { dress: { style: "brutalist" } }, color: 0x8c8983 },
  // island / expansion / military annexes (bare shells: expansion.js, island_military.js)
  { name: "island: annex tower (bare)", gen: "expansion.js / island_military.js", w: 18, d: 18, storeys: 6, opts: {}, color: 0x7d8790 },
  { name: "island: low block (bare)", gen: "island_military.js / biomes", w: 14, d: 12, storeys: 2, opts: {}, color: 0x8b8a7e },
  // the jail's admin building and the gov complexes ride the same shell
  { name: "jail: admin building", gen: "games/jail.js", w: 24, d: 16, storeys: 3, opts: { facade: "brick", dress: false }, color: 0x8a4a36 },
];
// every other registered grammar, as the disaster island / facade_demo wears it
const OTHER_GRAMMARS = true;

function main() {
  const rows = [];
  for (const t of SHELL_TYPES) {
    if (ONLY && t.name.indexOf(ONLY) < 0) continue;
    try { rows.push(measureShell(t.name, t.gen, t)); }
    catch (e) { rows.push({ name: t.name, gen: t.gen, error: String(e && e.stack || e).split("\n").slice(0, 3).join(" | ") }); }
  }
  if (OTHER_GRAMMARS) {
    const used = new Set(SHELL_TYPES.map((t) => t.opts && t.opts.dress && t.opts.dress.style).filter(Boolean));
    for (const g of CBZ.facadeList()) {
      if (used.has(g.id)) continue;
      const def = CBZ.facadeDef(g.id);
      const st = Math.max(def.minStoreys || 0, Math.min(def.maxStoreys === Infinity ? 6 : def.maxStoreys, def.minStoreys ? def.minStoreys + 2 : 3));
      const name = "kit: " + g.id + " (" + g.label + ")";
      if (ONLY && name.indexOf(ONLY) < 0) continue;
      const big = st >= 10;
      try { rows.push(measureShell(name, "facades/" + g.id + ".js (disaster island, explicit specs)", { w: big ? 24 : 16, d: big ? 24 : 14, storeys: st, opts: { dress: { style: g.id } }, color: 0x9a948a })); }
      catch (e) { rows.push({ name, gen: "facades/" + g.id + ".js", error: String(e && e.stack || e).split("\n").slice(0, 3).join(" | ") }); }
    }
  }
  return rows;
}

// ---------------------------------------------- the generators with their own writer
import { otherWriters, estateRows } from "./lib/facade-census-writers.mjs";

const rows = main();
let others = [];
try { others = await otherWriters({ ROOT, makeEnv, indexScripts, TOL, ONLY, V }); }
catch (e) { others = [{ name: "other writers", error: String(e && e.stack || e).split("\n").slice(0, 4).join(" | ") }]; }
try {
  if (!ONLY || "estate".indexOf(ONLY) >= 0 || ONLY.indexOf("estate") >= 0)
    for (const r of estateRows({ ROOT, makeEnv }, function (E, name, gen, b, root) { return measureBuilt(E.THREE, name, gen, b, root); })) rows.push(r);
}
catch (e) { rows.push({ name: "estates", error: String(e && e.stack || e).split("\n").slice(0, 4).join(" | ") }); }
const all = rows.concat(others);

// ------------------------------------------------------------ the report
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n);
console.log("FACADE CENSUS  (z-fight tolerance " + (TOL * 1000) + " mm)\n");
console.log(pad("type", 44) + pad("openings", 9) + pad("real", 6) + pad("covered", 8) + pad("flat", 6) + pad("bare", 6) + pad("painted", 8) + pad("shader", 7) + pad("door", 9) + pad("stoop/light/no", 15) + "zfight");
let tot = { openings: 0, real: 0, covered: 0, flat: 0, bare: 0, painted: 0, shader: 0, z: 0, doorsReal: 0, doorsShader: 0, doorsBay: 0, types: 0, typesNoDoor: 0, noDoor: [] };
let gateFail = [];
for (const r of all) {
  if (r.error) { console.log(pad(r.name, 44) + "ERROR " + r.error); gateFail.push(r.name + ": error"); continue; }
  const d0 = r.doors && r.doors[0] || { cls: "missing" };
  const dl = (r.doors || []).map((d) => d.cls).join(",");
  const kit = d0.cls === "missing" ? "-" : (d0.step ? "S" : "s") + (d0.light ? "L" : "l") + (d0.number ? "N" : "n");
  console.log(pad(r.name, 44) + pad(r.openings, 9) + pad(r.wins.real, 6) + pad(r.wins.covered, 8) + pad(r.wins.flat, 6) + pad(r.wins.bare, 6) + pad(r.wins.painted, 8) + pad(r.wins.shader, 7) + pad(dl, 9) + pad(kit, 15) + r.z.pairs + (r.z.pairs ? " (" + r.z.area + " m2)" : ""));
  if (V) {
    for (const e of r.ex || []) console.log("      window " + e);
    for (const s of r.z.samples || []) console.log("      zfight " + JSON.stringify(s));
    if (r.z.byKind) [...r.z.byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([k, n]) => console.log("      zf " + n + "x " + k));
    if (r.note) console.log("      " + r.note);
  }
  tot.types++; tot.openings += r.openings; for (const k of ["real", "covered", "flat", "bare", "painted", "shader"]) tot[k] += r.wins[k]; tot.z += r.z.pairs;
  const realDoor = (r.doors || []).some((d) => d.cls === "real");
  const shaderDoor = !realDoor && (r.doors || []).some((d) => d.cls === "shader");
  const bayDoor = !realDoor && (r.doors || []).some((d) => d.cls === "bay");
  if (realDoor) tot.doorsReal++; else if (shaderDoor) tot.doorsShader++; else if (bayDoor) tot.doorsBay++;
  else if (d0.cls !== "-") { tot.typesNoDoor++; tot.noDoor.push(r.name + " [" + dl + "]"); }
  if (GATE) {
    const okWin = r.openings > 0 && (r.wins.real + r.wins.shader) === r.openings;
    if (!okWin) gateFail.push(r.name + ": windows " + JSON.stringify(r.wins));
    if (!realDoor && !shaderDoor && !bayDoor && d0.cls !== "-") gateFail.push(r.name + ": door " + dl);
    if (r.z.pairs) gateFail.push(r.name + ": " + r.z.pairs + " z-fights");
  }
  if (MAXZ != null && r.z.pairs > MAXZ) gateFail.push(r.name + ": " + r.z.pairs + " z-fights > " + MAXZ);
}
console.log("\nTOTAL  types " + tot.types + "  openings " + tot.openings + "  real " + tot.real + "  shader-recessed " + tot.shader + "  covered " + tot.covered + "  flat " + tot.flat + "  bare " + tot.bare + "  painted " + tot.painted +
  "\n       doors: real (geometry) " + tot.doorsReal + "  shader-recessed " + tot.doorsShader + "  drive-in bays " + tot.doorsBay + "  without a door " + tot.typesNoDoor +
  (tot.noDoor.length ? " (" + tot.noDoor.join(", ") + ")" : "") + "  | z-fight pairs " + tot.z);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(all.map((r) => Object.assign({}, r, { z: r.z ? { pairs: r.z.pairs, area: r.z.area, byKind: r.z.byKind ? Object.fromEntries(r.z.byKind) : null } : null })), null, 1));
if (gateFail.length) { console.log("\nFAIL\n  " + gateFail.slice(0, 60).join("\n  ")); process.exit(1); }
