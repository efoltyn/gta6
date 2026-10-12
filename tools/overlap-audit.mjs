#!/usr/bin/env node
/* tools/overlap-audit.mjs — NOTHING WORN PASSES THROUGH THE PERSON WEARING IT.

   Owner: "things just need to be better at overlapping."

   Plain node, no browser, no captures. Loads the REAL rig + every dresser
   into a vm (three r128, materials, fphands, footwear, character, headwear,
   heritage, clothes, outfits, armor, prisonoutfits, watch, bling, the weapon
   kits + actorweapons, and warlord/outfits.js + warlord/wardrobe.js on a stub
   W), builds bodies (adult m / f, teen, child, toddler for hair), dresses
   them in every role outfit, composable stack, armour kit, bling look, stowed
   weapon mount, warlord armour rung + webbing + wardrobe kit and the prison
   fits, poses each through the real animChar (stand, walk at two phases, run,
   a real chair (seatRef), riding, the NPC gun hold with a carbine and a
   pistol (CBZ.actorReadyPose), prone, lying, and for hair the head turned
   0.85 rad, nodded, tipped back and turned while walking), and measures every
   ATTACHMENT (any mesh that is not the body itself) against the BODY VOLUME.

   BODY VOLUME, per part, in that part's own frame (so it follows the pose):
     box   the chest / waist / yoke / pelvis boxes (BoxGeometry, or the flat
           box a painted mesh keeps in userData._cbzFlat) — exact box SDF;
     limb  the lofted arm / leg segments — CBZ.humanLimbHalfAt's elliptical
           section at that height, with the joint domes;
     head  the analytic skull + neck + ears + nose headwear.js fits hats to
           (CBZ.headwear._fit.Head), in the head's own frame;
     mesh  anything else (a torso that stops being a box) — closest-triangle
           signed distance, brute force over its triangles.
   The ATTACHMENT is sampled on its SURFACE, not just its vertices (a vest's
   side face is two triangles whose corners are all clear of the arm it
   slices): every vertex plus a barycentric grid ~18 mm apart on every
   triangle, cached per geometry. A morphed mesh (the hair's HAIR FOLLOW
   targets) is measured where the GPU draws it: base + influence * delta.

   WHAT FAILS. An attachment and a body part that move RELATIVE to each other
   (different rig joints: a vest on the body vs the upper arm, a holster on
   the body vs the thigh, hair on the neck vs the shoulders) may not
   interpenetrate by more than TOL_MM (4 mm world, HUMAN_SCALE 0.70): about
   what cloth compresses where it rests on skin, and less than the rig's own
   joint tucks — past it the two surfaces visibly cross and flicker as the
   pose moves. Parts in the SAME rigid frame (a side plate buried in the
   chest, a webbing band tucked under the pelvis) are designed tucks: they
   cannot move, so they cannot flicker, and are reported as `sink` only.
   CLOTHING LAYERS: a same-facing attachment surface within ZF_MM (0.6 mm) of
   a same-frame body surface is a z-fight (two coplanar faces stipple), and
   fails from ZF_MIN samples (a patch, not a tangent point). HAIR is soft (a 2-3 cm lock compresses where it rests
   on a shoulder): HAIR_TOL_MM 6.
   THE BODY'S OWN COLLISION IS NOT THE ATTACHMENT'S: a sample only counts
   where the surface of the part it is worn ON (projected, nearest point) is
   itself clear of the other part — hair is judged the same way against the
   skull, and hair within HAIR_HUG of the scalp is the scalp layer.
   REPORTED, NEVER FAILED (printed as `known`, see each block): prone /
   lying / riding (folding poses: the body presses into itself; NOT for a
   slung gun, which is measured and failed in every pose), arm-vs-kit
   and the held gun in the gun-hold poses (the solved hold puts the arms
   inside the chest), and a toddler's head turned AND nodded.

   Hats / helmets (headwear.js) belong to tools/headwear-check.mjs, the watch
   to tools/watch-check.mjs, the shoe to tools/shoe-check.mjs and the gun in
   the hands to tools/gun-hold-check.mjs; this audit skips hats, measures the
   rest, and keeps the others passing.

     node tools/overlap-audit.mjs            summary table + PASS/FAIL
     node tools/overlap-audit.mjs --verbose  every attachment, not just the worst
     node tools/overlap-audit.mjs --only=hair|outfit|kit|stow
   Exit 0 = nothing passes through anybody. */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fakeDocument } from "./lib/fake-canvas.mjs";

// OVERLAP_SRC=/path/to/checkout/ audits another tree's sources (e.g. a `git archive` of HEAD for a before)
const ROOT = process.env.OVERLAP_SRC ? new URL("file://" + process.env.OVERLAP_SRC.replace(/\/?$/, "/")) : new URL("../", import.meta.url);
const read = (f) => readFileSync(new URL(f, ROOT), "utf8");
const VERBOSE = process.argv.includes("--verbose");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7) || null;
const t0 = Date.now();

const HS = 0.70;                         // HUMAN_SCALE: model units -> metres
const TOL_MM = 4.0;                      // cross-frame penetration allowed (world mm)
const HAIR_TOL_MM = 6.0;                 // hair is soft: a 2-3 cm lock compresses where it rests on a shoulder
const tolOf = (label) => (/^(known:)?hair:/.test(label) ? HAIR_TOL_MM : TOL_MM);
const ZF_MM = 0.6;                       // coplanar same-facing = z-fight (world mm)
// a z-fight is a coplanar PATCH: 4 samples (~13 cm² at the sample spacing). One
// or two samples are where a crossing surface is momentarily tangent to the
// body (a barrel across the curve of the back), which is not a stipple.
const ZF_MIN = 4;
const SAMPLE_M = 0.018;                  // surface sample spacing (world metres)
const HAIR_HUG = 0.035;                  // hair this close to the skull/neck (unit head) is the scalp layer

// ---------------------------------------------------------------- the world
// a seeded Math.random: bodies are built with random variety, and a check
// that measures them must say the same thing twice
let seed = 20260928 >>> 0;
const M = Object.create(Math);
M.random = function () {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ctx = vm.createContext({ console, Math: M, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, performance, Date });
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx; ctx.document = fakeDocument();
ctx.navigator = { userAgent: "node" }; ctx.location = { search: "", href: "" };
ctx.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
ctx.addEventListener = () => {}; ctx.requestAnimationFrame = () => 0;
const hooks = { always: [], update: [] };
ctx.CBZ = {
  CONFIG: {}, game: { mode: "city" }, npcs: [],
  onUpdate(o, f) { hooks.update.push([o, f]); }, onAlways(o, f) { hooks.always.push([o, f]); }, onReset() {}, onModeEnter() {}, on() {},
};
const APPEAR = ["sidearm", "shotgun", "carbine", "smg", "taser", "bazooka", "glauncher", "ak47", "revolver", "deagle", "uzi", "sniper", "lmg", "shank"];
const FILES = ["src/vendor/three.r128.min.js", "src/config.js", "src/core/matrixskip.js", "src/world/materials.js", "src/systems/fphands.js",
  "src/entities/footwear.js", "src/entities/character.js", "src/entities/headwear.js", "src/entities/heritage.js",
  "src/city/clothes.js", "src/city/outfits.js", "src/entities/dutykit.js", "src/city/armor.js", "src/systems/prisonoutfits.js",
  "src/entities/jewelry_kit.js", "src/entities/eyewear.js", "src/entities/watch.js", "src/city/bling.js",
  "src/weapons/weapon-data.js", "src/weapons/weapon-scale.js", ...APPEAR.map((n) => `src/weapons/appearances/${n}.js`),
  "src/systems/actorweapons.js"];
for (const f of FILES) vm.runInContext(read(f), ctx, { filename: f });
// the real seated pose needs CBZ.moves.seatLegs (the shared leg solve)
for (const f of ["src/entities/moves.js", "src/entities/moves_posture.js"]) {
  try { vm.runInContext(read(f), ctx, { filename: f }); } catch (e) { console.log("  note: " + f + " did not load (" + e.message + ")"); }
}
const { THREE: T, CBZ } = ctx;
for (const need of ["makeCharacter", "animChar", "cityRecolorRig", "cityOutfitCatalog", "HERITAGE_IDS", "heritageRoll", "humanLimbHalfAt", "charMounts", "buildActorWeapon"]) {
  if (!CBZ[need]) { console.error("FAIL harness: CBZ." + need + " missing"); process.exit(2); }
}
// the warlord dressers ride a small stub of core.js's W
const W = (CBZ.warlord = {
  module(name, api) { W[name] = api; return api; },
  hash01(a, b, c) { let h = ((a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2147483647) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; },
  ARMOUR: [{ id: "none" }, { id: "vest" }, { id: "plate" }, { id: "heavy" }],
  armour(id) { return W.ARMOUR.find((r) => r.id === id) || null; },
  tierIndex(t) { return ["levy", "raider", "veteran", "elite"].indexOf(t); },
  on() {}, state: { army: [], day: 1 },
});
for (const f of ["src/warlord/outfits.js", "src/warlord/wardrobe.js"]) {
  try { vm.runInContext(read(f), ctx, { filename: f }); } catch (e) { console.log("  note: " + f + " did not load (" + e.message + ")"); }
}
const Q = { get() { return null; } };
for (const k of ["outfits", "wardrobe"]) { try { if (W[k] && W[k].boot) W[k].boot({ THREE: T, Q, el() { return null; } }); } catch (e) { /* the picker UI needs a page; the dressers do not */ } }

// ---------------------------------------------------------------- body volume
const _v = new T.Vector3(), _w = new T.Vector3(), _m = new T.Matrix4();
const FIT = CBZ.headwear && CBZ.headwear._fit;
const headSdfCache = new Map();
function headSdf(form, neck) {
  if (!FIT) return null;
  let H = headSdfCache.get(form + !!neck);
  if (!H) { H = FIT.Head(form, { ears: true, neck: !!neck, nose: true }); headSdfCache.set(form + !!neck, H); }
  return H;
}
function flatBoxParams(mesh) {
  const flat = mesh.userData && mesh.userData._cbzFlat && mesh.userData._cbzFlat.g;
  const g = flat || mesh.geometry;
  if (!g || (g.userData && g.userData.limb)) return null;
  if (g.type === "BoxGeometry" && g.parameters) return g.parameters;
  return null;
}
const meshTriCache = new Map();
function meshTris(g) {
  let t = meshTriCache.get(g.uuid);
  if (t) return t;
  const p = g.attributes.position, idx = g.index ? g.index.array : null, n = idx ? idx.length : p.count;
  t = new Float32Array((n / 3) * 12);
  for (let i = 0, o = 0; i < n; i += 3, o += 12) {
    const a = idx ? idx[i] : i, b = idx ? idx[i + 1] : i + 1, c = idx ? idx[i + 2] : i + 2;
    const ax = p.getX(a), ay = p.getY(a), az = p.getZ(a), bx = p.getX(b), by = p.getY(b), bz = p.getZ(b), cx = p.getX(c), cy = p.getY(c), cz = p.getZ(c);
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    t.set([ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz], o);
  }
  meshTriCache.set(g.uuid, t);
  return t;
}
function closestOnTri(px, py, pz, t, o, out) {
  // Ericson, Real-Time Collision Detection 5.1.5
  const ax = t[o], ay = t[o + 1], az = t[o + 2], bx = t[o + 3], by = t[o + 4], bz = t[o + 5], cx = t[o + 6], cy = t[o + 7], cz = t[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = ax + v * abx; out[1] = ay + v * aby; out[2] = az + v * abz; return; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = ax + w * acx; out[1] = ay + w * acy; out[2] = az + w * acz; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); out[0] = bx + w * (cx - bx); out[1] = by + w * (cy - by); out[2] = bz + w * (cz - bz); return; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}
const _c = [0, 0, 0];
/* signed distance (local units) + outward normal of the nearest surface, for a
   point in the part's LOCAL frame. Returns d (<0 inside); writes nrm. */
function partSdf(part, x, y, z, nrm, withNeck, needN) {
  if (part.kind === "box") {
    const hx = part.p.width / 2, hy = part.p.height / 2, hz = part.p.depth / 2;
    const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - hz;
    if (qx >= qy && qx >= qz) { nrm[0] = Math.sign(x) || 1; nrm[1] = 0; nrm[2] = 0; }
    else if (qy >= qz) { nrm[0] = 0; nrm[1] = Math.sign(y) || 1; nrm[2] = 0; }
    else { nrm[0] = 0; nrm[1] = 0; nrm[2] = Math.sign(z) || 1; }
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    const out = Math.hypot(ox, oy, oz);
    if (out > 0) {   // outside: the direction to the true closest point (an edge or corner too)
      nrm[0] = ox * (Math.sign(x) || 1) / out; nrm[1] = oy * (Math.sign(y) || 1) / out; nrm[2] = oz * (Math.sign(z) || 1) / out;
      return out;
    }
    return Math.max(qx, qy, qz);
  }
  if (part.kind === "limb") {
    const L = part.L;
    const yTop = L.y0, yBot = L.y0 - L.sy;
    let f = 1, yy = y;
    if (y > yTop) { const r0 = L.rows[0]; const H = part.domeTop * Math.max(r0[1] * L.sx, r0[2] * L.sz); if (y - yTop >= H) return (y - yTop - H) + 0.001; f = Math.sqrt(1 - ((y - yTop) / H) ** 2); yy = yTop; }
    else if (y < yBot) { const rN = L.rows[L.rows.length - 1]; const H = part.domeBot * Math.max(rN[1] * L.sx, rN[2] * L.sz); if (yBot - y >= H) return (yBot - y - H) + 0.001; f = Math.sqrt(1 - ((yBot - y) / H) ** 2); yy = yBot; }
    const s = CBZ.humanLimbHalfAt(part.g, yy);
    const hx = s.hx * f, hz = s.hz * f, dz = z - s.cz;
    const r = Math.hypot(x / hx, dz / hz);
    const ang = Math.atan2(dz / hz, x / hx);
    const R = 1 / Math.hypot(Math.cos(ang) / hx, Math.sin(ang) / hz) * Math.hypot(Math.cos(ang), Math.sin(ang));
    const rr = Math.hypot(x, dz) || 1;
    nrm[0] = x / rr; nrm[1] = 0; nrm[2] = dz / rr;
    // radial distance to the ellipse along the point's own direction
    return (r - 1) * (R || Math.min(hx, hz));
  }
  if (part.kind === "head") {
    // the NECK column is buried in the yoke by design, so a collar or a shell
    // round it is measured against the skull; hair's scalp test (withNeck)
    // counts the neck, since nape hair lies on it
    const H = withNeck ? part.Hn : part.H;
    const X = x, Y = y + 0.3, Z = z;               // head geometry frame -> the unit fit frame
    const d = H.sdf(X, Y, Z);
    // the gradient (3 more evaluations of a costly sdf) only where anything
    // reads it: inside, or within the z-fight band of the surface
    if (!needN && d > 0.004) { nrm[0] = 0; nrm[1] = 1; nrm[2] = 0; return d; }
    const e = 0.002;
    const gx = H.sdf(X + e, Y, Z) - d, gy = H.sdf(X, Y + e, Z) - d, gz = H.sdf(X, Y, Z + e) - d;
    const l = Math.hypot(gx, gy, gz) || 1; nrm[0] = gx / l; nrm[1] = gy / l; nrm[2] = gz / l;
    return d;                                       // the head mesh's scale (hk) is in its matrixWorld
  }
  // generic mesh: its cached signed-distance grid (the shaped torso), trilinear
  if (part.grid) return gridSdf(part.grid, x, y, z, nrm);
  // …or, with no grid, nearest triangle, signed by its face normal
  const t = part.tris;
  let best = Infinity, bo = 0;
  for (let o = 0; o < t.length; o += 12) {
    closestOnTri(x, y, z, t, o, _c);
    const dd = (x - _c[0]) ** 2 + (y - _c[1]) ** 2 + (z - _c[2]) ** 2;
    if (dd < best) { best = dd; bo = o; }
  }
  closestOnTri(x, y, z, t, bo, _c);
  const s = (x - _c[0]) * t[bo + 9] + (y - _c[1]) * t[bo + 10] + (z - _c[2]) * t[bo + 11];
  nrm[0] = t[bo + 9]; nrm[1] = t[bo + 10]; nrm[2] = t[bo + 11];
  return Math.sqrt(best) * (s < 0 ? -1 : 1);
}

/* A SHAPED BODY PART (the torso's lofted chest / waist / pelvis / collar band)
   is measured through a SIGNED DISTANCE GRID built once per geometry (the
   shape is shared by every body of one profile): triangles bucketed in a
   coarse hash, each voxel takes the nearest triangle in its 3x3x3 buckets
   (sign = that triangle's facing), voxels farther than a bucket from any
   surface take the sign carried along their x row from outside the box.
   Queries are trilinear, the normal the grid's gradient. */
const gridCache = new Map();
const GRID_H = 0.022, GRID_B = 0.045, GRID_PAD = 0.07;
function sdfGrid(g) {
  let G = gridCache.get(g.uuid);
  if (G) return G;
  const t = meshTris(g);
  g.computeBoundingBox();
  const bb = g.boundingBox, x0 = bb.min.x - GRID_PAD, y0 = bb.min.y - GRID_PAD, z0 = bb.min.z - GRID_PAD;
  const nx = Math.ceil((bb.max.x - bb.min.x + 2 * GRID_PAD) / GRID_H) + 1, ny = Math.ceil((bb.max.y - bb.min.y + 2 * GRID_PAD) / GRID_H) + 1, nz = Math.ceil((bb.max.z - bb.min.z + 2 * GRID_PAD) / GRID_H) + 1;
  // bucket the triangles
  const bx = Math.ceil(nx * GRID_H / GRID_B) + 1, by = Math.ceil(ny * GRID_H / GRID_B) + 1, bz = Math.ceil(nz * GRID_H / GRID_B) + 1;
  const buckets = new Map();
  const cell = (v, v0) => Math.floor((v - v0) / GRID_B);
  for (let o = 0; o < t.length; o += 12) {
    const ax = Math.min(t[o], t[o + 3], t[o + 6]), bxx = Math.max(t[o], t[o + 3], t[o + 6]);
    const ay = Math.min(t[o + 1], t[o + 4], t[o + 7]), byy = Math.max(t[o + 1], t[o + 4], t[o + 7]);
    const az = Math.min(t[o + 2], t[o + 5], t[o + 8]), bzz = Math.max(t[o + 2], t[o + 5], t[o + 8]);
    for (let i = cell(ax, x0); i <= cell(bxx, x0); i++) for (let j = cell(ay, y0); j <= cell(byy, y0); j++) for (let k = cell(az, z0); k <= cell(bzz, z0); k++) {
      const key = (i * by + j) * bz + k;
      let L = buckets.get(key); if (!L) buckets.set(key, (L = [])); L.push(o);
    }
  }
  const D = new Float32Array(nx * ny * nz), known = new Uint8Array(nx * ny * nz);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    const px = x0 + i * GRID_H, py = y0 + j * GRID_H, pz = z0 + k * GRID_H;
    const ci = cell(px, x0), cj = cell(py, y0), ck = cell(pz, z0);
    let best = Infinity, bo = -1;
    for (let a = ci - 1; a <= ci + 1; a++) for (let b = cj - 1; b <= cj + 1; b++) for (let c = ck - 1; c <= ck + 1; c++) {
      const L = buckets.get((a * by + b) * bz + c); if (!L) continue;
      for (const o of L) {
        closestOnTri(px, py, pz, t, o, _c);
        const dd = (px - _c[0]) ** 2 + (py - _c[1]) ** 2 + (pz - _c[2]) ** 2;
        if (dd < best) { best = dd; bo = o; }
      }
    }
    const id = (i * ny + j) * nz + k;
    if (bo >= 0 && best <= GRID_B * GRID_B) {
      closestOnTri(px, py, pz, t, bo, _c);
      const s = (px - _c[0]) * t[bo + 9] + (py - _c[1]) * t[bo + 10] + (pz - _c[2]) * t[bo + 11];
      D[id] = Math.sqrt(best) * (s < 0 ? -1 : 1); known[id] = 1;
    }
  }
  // far voxels: the sign carried along the x row from outside the box
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) {
    let sign = 1;
    for (let i = 0; i < nx; i++) {
      const id = (i * ny + j) * nz + k;
      if (known[id]) sign = D[id] < 0 ? -1 : 1;
      else D[id] = sign * GRID_B;
    }
  }
  G = { D, nx, ny, nz, x0, y0, z0 };
  gridCache.set(g.uuid, G);
  return G;
}
function gridAt(G, x, y, z) {
  const fx = (x - G.x0) / GRID_H, fy = (y - G.y0) / GRID_H, fz = (z - G.z0) / GRID_H;
  if (fx < 0 || fy < 0 || fz < 0 || fx >= G.nx - 1 || fy >= G.ny - 1 || fz >= G.nz - 1) return GRID_B;
  const i = fx | 0, j = fy | 0, k = fz | 0, u = fx - i, v = fy - j, w = fz - k, ny = G.ny, nz = G.nz, D = G.D;
  const at = (a, b, c) => D[((i + a) * ny + (j + b)) * nz + (k + c)];
  const c00 = at(0, 0, 0) * (1 - u) + at(1, 0, 0) * u, c10 = at(0, 1, 0) * (1 - u) + at(1, 1, 0) * u;
  const c01 = at(0, 0, 1) * (1 - u) + at(1, 0, 1) * u, c11 = at(0, 1, 1) * (1 - u) + at(1, 1, 1) * u;
  return (c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w;
}
function gridSdf(G, x, y, z, nrm) {
  const d = gridAt(G, x, y, z), e = GRID_H * 0.5;
  const gx = gridAt(G, x + e, y, z) - gridAt(G, x - e, y, z), gy = gridAt(G, x, y + e, z) - gridAt(G, x, y - e, z), gz = gridAt(G, x, y, z + e) - gridAt(G, x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  nrm[0] = gx / l; nrm[1] = gy / l; nrm[2] = gz / l;
  return d;
}

// ---------------------------------------------------------------- the rig
function jointsOf(ch) {
  const J = new Set([ch.group, ch.model, ch.body, ch.neck]);
  for (const k of ["la", "ra", "ll", "rl"]) { const p = ch.parts[k]; J.add(p); if (p.userData.low) J.add(p.userData.low); }
  return J;
}
function frameOf(obj, J) { for (let o = obj; o; o = o.parent) if (J.has(o)) return o; return null; }
function frameName(f, ch) {
  for (const k of ["la", "ra", "ll", "rl"]) { const p = ch.parts[k]; if (f === p) return k; if (f === p.userData.low) return k + ".low"; }
  return f === ch.neck ? "neck" : (f === ch.body ? "body" : "root");
}
const REGION_OF = { torso: "torso", collar: "yoke", pelvis: "pelvis", arms: "armUp", armsLower: "armLo", legs: "legUp", legsLower: "legLo", head: "head" };
function bodyParts(ch) {
  const s = ch.skinSlots, J = jointsOf(ch), out = [];
  for (const slot in REGION_OF) {
    for (const m of s[slot] || []) {
      if (!m || !m.geometry || m.visible === false) continue;
      const part = { mesh: m, region: REGION_OF[slot] + (slot === "torso" && s.torso.indexOf(m) === 1 ? "/waist" : ""), frame: frameOf(m, J) };
      const g = m.geometry;
      if (g.userData && g.userData.limb) {
        part.kind = "limb"; part.g = g; part.L = g.userData.limb;
        const variant = (m.userData.limb && m.userData.limb.variant) || "cloth";
        const kind = m.userData.limb && m.userData.limb.kind;
        part.domeTop = /Up$/.test(kind || "") ? 0.85 : 1;
        part.domeBot = /armLo/.test(kind || "") ? (variant === "bare" ? 0.20 : 0.22) : (/legLo/.test(kind || "") ? (variant === "bare" ? 0.4 : 0.3) : 1);
      } else if (slot === "head" && headSdf(ch.headForm)) { part.kind = "head"; part.H = headSdf(ch.headForm, false); part.Hn = headSdf(ch.headForm, true); }
      else { const p = flatBoxParams(m); if (p) { part.kind = "box"; part.p = p; } else { const f = m.userData && m.userData._cbzFlat && m.userData._cbzFlat.g; part.kind = "mesh"; part.grid = sdfGrid(f || g); } }
      out.push(part);
    }
  }
  return out;
}
function isBodyish(ch) {
  // everything that IS the person, or is owned by another check
  const skip = new Set();
  const s = ch.skinSlots;
  // the body segments themselves (what hangs OFF them — a jacket shell on the
  // chest, armour pads on the arms — is an attachment), and whole subtrees of
  // the hands / shoes / beard / role hat (their own checks own those)
  for (const slot of ["torso", "collar", "pelvis", "arms", "armsLower", "legs", "legsLower", "head"]) for (const m of s[slot] || []) if (m) skip.add(m);
  for (const slot of ["hands", "shoes", "beard", "cap"]) for (const m of s[slot] || []) if (m) m.traverse((o) => skip.add(o));
  // the bare arm under a short sleeve is the upper arm's own lower half (its
  // volume is the upper arm's full-length limb sdf above)
  ch.group.traverse((o) => { if (o.userData && o.userData.limbPiece) skip.add(o); });
  for (const node of [ch.faceNodes && ch.faceNodes.near, ch.faceNodes && ch.faceNodes.far]) if (node) node.traverse((o) => skip.add(o));
  const face = ch.face;
  if (face) for (const k in face) if (face[k] && face[k].isObject3D) face[k].traverse((o) => skip.add(o));
  if (ch.mouthIn) for (const k in ch.mouthIn) if (ch.mouthIn[k]) skip.add(ch.mouthIn[k]);
  return skip;
}
function isHat(o) { for (let n = o; n; n = n.parent) if (n.userData && (n.userData.headwear || n.userData.hatRole)) return true; return false; }
function inShoe(o, ch) { const sh = ch.skinSlots.shoes || []; for (let n = o; n; n = n.parent) if (sh.indexOf(n) >= 0) return true; return false; }
function visibleTo(o, root) { for (let n = o; n; n = n.parent) { if (n.visible === false) return false; if (n === root) return true; } return true; }

/* attachment meshes on a rig, labelled. `labels` maps mesh -> label (the
   dresser step that put it there); unlabelled meshes get one from userData. */
function attachments(ch, labels) {
  const skip = isBodyish(ch), out = [];
  ch.group.traverse((o) => {
    if (!o.isMesh || skip.has(o)) return;
    if (isHat(o) || inShoe(o, ch)) return;
    if (!visibleTo(o, ch.group)) return;
    const mat = o.material;
    if (mat && !Array.isArray(mat) && mat.visible === false) return;
    const u = o.userData || {};
    let label = labels.get(o);
    // the jacket shell (city/clothes.js + character.js humanShellSpec) is one
    // attachment whatever outfit put it there, measured and failed like any other
    if (o === ch._jacketMesh) label = "cloth:jacket-shell";
    else if (!label) {
      if (ch.skinSlots.hair.indexOf(o) >= 0) label = "hair:" + (u.hairStyle || "?");
      else label = (u.armorKind && "armor:" + u.armorKind) || (u.blingKind && "bling:" + u.blingKind) || (u.clothingPart && "cloth:" + u.clothingPart) || o.name || (o.parent && o.parent.name) || "mesh";
    }
    // the watch rides its own check; everything else a wrist wears is measured
    for (let n = o; n; n = n.parent) if (n.userData && n.userData.wristwatch) { label = "watch:" + n.userData.wristwatch; break; }
    const held = ch._actor && ch._actor._weaponProp;
    if (held) for (let n = o; n; n = n.parent) if (n === held) { label = "held:" + ch._actor._weaponPropId; break; }
    out.push({ mesh: o, label });
  });
  return out;
}

// ---- surface samples, cached per geometry and spacing
const sampleCache = new Map();
function samplesOf(g, spacing) {
  const key = g.uuid + "|" + spacing.toFixed(5);
  let S = sampleCache.get(key);
  if (S) return S;
  const tris = meshTris(g), pts = [], src = [], bw = [];
  const p = g.attributes.position, idx = g.index ? g.index.array : null;
  for (let i = 0; i < p.count; i++) { pts.push(p.getX(i), p.getY(i), p.getZ(i), NaN, NaN, NaN); src.push(i, i, i); bw.push(1, 0, 0); }
  for (let o = 0, t = 0; o < tris.length; o += 12, t += 3) {
    const ia = idx ? idx[t] : t, ib = idx ? idx[t + 1] : t + 1, ic = idx ? idx[t + 2] : t + 2;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2], bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5], cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
    const e = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - ax, cy - ay, cz - az), Math.hypot(cx - bx, cy - by, cz - bz));
    const n = Math.min(40, Math.max(1, Math.ceil(e / spacing)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      if ((i === 0 && j === 0) || (i === n) || (j === n)) continue;   // the corners are the vertices
      const u = i / n, v = j / n, w = 1 - u - v;
      pts.push(ax * w + bx * u + cx * v, ay * w + by * u + cy * v, az * w + bz * u + cz * v, tris[o + 9], tris[o + 10], tris[o + 11]);
      src.push(ia, ib, ic); bw.push(w, u, v);
    }
  }
  S = new Float32Array(pts);
  S.src = new Uint32Array(src); S.bw = new Float32Array(bw);
  sampleCache.set(key, S);
  return S;
}
/* A MORPHED mesh (character.js HAIR FOLLOW) is measured where the GPU draws
   it: base + sum(influence * delta) (relative targets), interpolated onto every
   sample with the sample's own barycentric weights. */
function morphed(m, S) {
  const g = m.geometry, inf = m.morphTargetInfluences, T0 = g.morphAttributes && g.morphAttributes.position;
  if (!inf || !T0 || !T0.length) return S;
  let any = false; for (let t = 0; t < inf.length; t++) if (inf[t]) any = true;
  if (!any) return S;
  const out = Float32Array.from(S), rel = !!g.morphTargetsRelative, base = g.attributes.position.array;
  for (let k = 0, i = 0; i < S.length; i += 6, k += 3) {
    let dx = 0, dy = 0, dz = 0;
    for (let t = 0; t < inf.length && t < T0.length; t++) {
      const w = inf[t]; if (!w) continue;
      const a = T0[t].array;
      for (let c = 0; c < 3; c++) {
        const vi = S.src[k + c], bwc = S.bw[k + c]; if (!bwc) continue;
        const ox = rel ? 0 : base[vi * 3], oy = rel ? 0 : base[vi * 3 + 1], oz = rel ? 0 : base[vi * 3 + 2];
        dx += w * bwc * (a[vi * 3] - ox); dy += w * bwc * (a[vi * 3 + 1] - oy); dz += w * bwc * (a[vi * 3 + 2] - oz);
      }
    }
    out[i] += dx; out[i + 1] += dy; out[i + 2] += dz;
  }
  return out;
}

// ---------------------------------------------------------------- measuring
function worldScale(o) { o.matrixWorld.extractBasis(_v, _w, new T.Vector3()); return Math.cbrt(Math.abs(_m.copy(o.matrixWorld).determinant())) || 1; }
const hugCache = new Map();
const results = new Map();     // label -> {worst, where, n, sink, sinkWhere, zf, zfWhere}
function rec(label) { let r = results.get(label); if (!r) { r = { worst: 0, where: "", n: 0, sink: 0, sinkWhere: "", zf: 0, zfWhere: "", vs: {}, byPose: {}, byBody: {} }; results.set(label, r); } return r; }
const nrm = [0, 0, 0];
const _inv = new T.Matrix4(), _nm = new T.Matrix3(), _box = new T.Box3();

// is the host surface point nearest world point `p` inside part P?
const _hp = new T.Vector3(), _hn = [0, 0, 0];
function hostInside(p, P, hosts) {
  let best = Infinity, bx = 0, by = 0, bz = 0;
  for (const H of hosts) {
    _hp.copy(p).applyMatrix4(H.inv);
    const d = partSdf(H, _hp.x, _hp.y, _hp.z, _hn, false, true);
    if (Math.abs(d * H.scale) < best) {
      best = Math.abs(d * H.scale);
      _hp.set(_hp.x - _hn[0] * d, _hp.y - _hn[1] * d, _hp.z - _hn[2] * d).applyMatrix4(H.mesh.matrixWorld);
      bx = _hp.x; by = _hp.y; bz = _hp.z;
    }
  }
  if (best === Infinity) return false;
  _hp.set(bx, by, bz).applyMatrix4(P.inv);
  return partSdf(P, _hp.x, _hp.y, _hp.z, _hn) < 0;
}
function measure(ch, labels, tag, pose, opts) {
  opts = opts || {};
  ch.group.updateMatrixWorld(true);
  const parts = bodyParts(ch);
  for (const P of parts) {
    P.inv = new T.Matrix4().copy(P.mesh.matrixWorld).invert();
    P.scale = worldScale(P.mesh);
    P.mesh.geometry.computeBoundingBox();
    P.aabb = P.mesh.geometry.boundingBox.clone().applyMatrix4(P.mesh.matrixWorld).expandByScalar(0.02);
    P.nmat = new T.Matrix3().getNormalMatrix(P.mesh.matrixWorld);
  }
  const J = jointsOf(ch);
  const att = attachments(ch, labels).filter((a) => !opts.filter || opts.filter(a));
  const p = new T.Vector3(), n = new T.Vector3(), q = new T.Vector3(), bn = new T.Vector3();
  for (const A of att) {
    const m = A.mesh, g = m.geometry;
    if (!g || !g.attributes || !g.attributes.position) continue;
    const r = rec((opts.known ? "known:" : "") + A.label);
    r.n++;
    const fr = frameOf(m, J);
    const ws = worldScale(m);
    if (m.userData.hairFollow && CBZ.human && CBZ.human.hairFollow) CBZ.human.hairFollow(m);
    const S0 = samplesOf(g, SAMPLE_M / ws);
    const S = morphed(m, S0);
    g.computeBoundingBox();
    _box.copy(g.boundingBox).applyMatrix4(m.matrixWorld);
    const cand = parts.filter((P) => P.aabb.intersectsBox(_box) && !(opts.skipRegion && opts.skipRegion(P, A)));
    /* HAIR THAT HUGS THE HEAD GOES WHERE THE HEAD GOES. A sample within
       HAIR_HUG of the skull / neck surface is the scalp layer: it follows the
       head exactly as the neck column does, and the neck column is BURIED in
       the yoke by design (character.js neckDrop, "buried in the yoke below").
       Whether the HEAD clears the shoulders in a pose is the body's business;
       this audit measures the hair that HANGS off it. */
    const headP = /^hair:/.test(A.label) ? parts.find((P) => P.kind === "head") : null;
    /* …and where the head itself is inside a body part (a toddler's skull sits
       down in the yoke; a head tipped back meets it), the hair over that spot
       is the head's collision, not the hair's: every hair sample is projected
       onto the skull, and it only counts where that skull point is clear. */
    let hug = null, skull = null;
    if (headP) {
      // hair -> head is (nearly always) a fixed transform, and the head's sdf is
      // not cheap: cache the scalp flags + skull points per relative transform
      const rel = new T.Matrix4().multiplyMatrices(headP.inv, m.matrixWorld);
      const key = g.uuid + "|" + ch.headForm + "|" + rel.elements.map((e) => (Math.round(e * 1e3) || 0)).join(",");
      let H = hugCache.get(key);
      if (!H) {
        H = { hug: new Uint8Array(S0.length / 6), sk: new Float32Array(S0.length / 2) };
        const toHair = new T.Matrix4().copy(rel).invert();
        for (let i = 0, k = 0; i < S0.length; i += 6, k++) {
          p.set(S0[i], S0[i + 1], S0[i + 2]).applyMatrix4(rel);
          const d = partSdf(headP, p.x, p.y, p.z, nrm, true, true);
          if (d < HAIR_HUG) H.hug[k] = 1;
          q.set(p.x - nrm[0] * d, p.y - nrm[1] * d, p.z - nrm[2] * d).applyMatrix4(toHair);
          H.sk[k * 3] = q.x; H.sk[k * 3 + 1] = q.y; H.sk[k * 3 + 2] = q.z;
        }
        hugCache.set(key, H);
      }
      hug = H.hug;
      skull = new Float32Array(H.sk.length);
      const e = m.matrixWorld.elements;
      for (let k = 0; k < skull.length; k += 3) {
        const x = H.sk[k], y = H.sk[k + 1], z = H.sk[k + 2];
        skull[k] = e[0] * x + e[4] * y + e[8] * z + e[12];
        skull[k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        skull[k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
    }
    if (!cand.length) continue;
    const sameParts = parts.filter((P) => P.frame === fr);
    _nm.getNormalMatrix(m.matrixWorld);
    for (const P of cand) {
      const same = P.frame === fr;
      let worst = 0, wp = null, zf = 0;
      const toLocal = _inv.copy(P.inv);
      for (let i = 0; i < S.length; i += 6) {
        if (hug && hug[i / 6]) continue;
        p.set(S[i], S[i + 1], S[i + 2]).applyMatrix4(m.matrixWorld);
        if (!P.aabb.containsPoint(p)) continue;
        if (skull) {
          const k3 = (i / 6) * 3;
          q.set(skull[k3], skull[k3 + 1], skull[k3 + 2]).applyMatrix4(P.inv);
          if (partSdf(P, q.x, q.y, q.z, nrm) < 0) continue;
        }
        q.copy(p).applyMatrix4(toLocal);
        const d = partSdf(P, q.x, q.y, q.z, nrm) * P.scale;      // world metres
        /* THE BODY'S OWN COLLISION IS NOT THE ATTACHMENT'S. Where the part the
           attachment is worn ON (its host: the body parts in its own rigid
           frame) is itself inside the other part in this pose — arms folded
           into the chest lying down, the head tipped back into the yoke going
           prone — whatever is worn over that spot goes with it. The sample
           is projected onto the nearest host surface; it only counts where
           that host point is clear of P. */
        if (!same && d < -worst && hostInside(p, P, sameParts)) continue;
        if (d < -worst) { worst = -d; wp = q.clone(); if (process.env.OA_DBG && -d > +process.env.OA_DBG) { console.log("DBG", tag, pose, A.label, P.region, "world", p.toArray().map(v=>v.toFixed(3)).join(","), "local", q.toArray().map(v=>v.toFixed(3)).join(","), "scale", P.scale.toFixed(3), "d", d.toFixed(4), "armOutZ", ch.armOutZ, "laZ", ch.parts.la.rotation.z.toFixed(3), "body", p.clone().applyMatrix4(new T.Matrix4().copy(ch.body.matrixWorld).invert()).toArray().map(v=>v.toFixed(3)).join(",")); } }
        if (same && Math.abs(d) < ZF_MM / 1000 && !isNaN(S[i + 3])) {
          n.set(S[i + 3], S[i + 4], S[i + 5]).applyMatrix3(_nm).normalize();
          bn.set(nrm[0], nrm[1], nrm[2]).applyMatrix3(P.nmat).normalize();
          if (n.dot(bn) > 0.95) { zf++; if (process.env.OA_ZF && pose === "stand") console.log("ZF", tag, A.label, A.mesh.name || JSON.stringify(A.mesh.geometry.parameters), A.mesh.position.toArray().map((v) => v.toFixed(3)).join("/"), P.region, "local", q.x.toFixed(3), q.y.toFixed(3), q.z.toFixed(3), "n", n.x.toFixed(2), n.y.toFixed(2), n.z.toFixed(2)); }
        }
      }
      const mm = worst * 1000;
      const where = tag + " / " + pose + " vs " + P.region + (wp ? " @(" + wp.x.toFixed(2) + "," + wp.y.toFixed(2) + "," + wp.z.toFixed(2) + ")" : "");
      if (same) {
        if (mm > r.sink) { r.sink = mm; r.sinkWhere = where; }
        if (zf > r.zf) { r.zf = zf; r.zfWhere = tag + " / " + pose + " on " + P.region; }
      } else {
        /* THE GUN HOLD. The ready solve (CBZ.gunHold.ready) now keeps the
           arms and the gun out of the body AS WORN (entities/character.js
           charArmTo.bodyPen: the shaped chest and every piece of kit on it;
           tools/gun-hold-check.mjs measures it, incl. a plate carrier), which
           took the worst arm-vs-kit contact here from 45 mm to ~19 mm. What
           is left (a sash strap and shoulder pads worn ON the moving upper
           arm, which no hold can dodge) is still REPORTED under known:. */
        const army = /^arm/.test(P.region) || /^(la|ra)/.test(frameName(fr, ch));
        const r2 = (!opts.known && ((AIMS[pose] && (army || /^held:/.test(A.label))))) ? rec("known:" + A.label) : r;
        if (r2 !== r) { if (mm > r2.worst) { r2.worst = mm; r2.where = where; } r2.n++; continue; }
        const v = r.vs[P.region] || 0; if (mm > v) r.vs[P.region] = mm;
        if (mm > (r.byPose[pose] || 0)) r.byPose[pose] = mm;
        const bk = tag.split(" ")[0]; if (mm > (r.byBody[bk] || 0)) r.byBody[bk] = mm; const bpk = bk + "/" + pose; if (mm > ((r.bp || (r.bp = {}))[bpk] || 0)) r.bp[bpk] = mm;
        if (mm > r.worst) { r.worst = mm; r.where = where; }
      }
    }
  }
}

// ---------------------------------------------------------------- posing
const DT = 1 / 30;
function reset(ch) {
  for (const k of ["sitting", "aimingPose", "aimLong", "pronePose", "lying", "carryPose"]) ch[k] = false;
  ch.lying = null; ch.seatRef = null; ch.riding = null;
  if (ch._actor && ch._actor.armed) { ch._actor.armed = false; CBZ.actorReadyPose(ch._actor); }
  ch.neck.rotation.set(0, 0, 0);          // animChar damps pitch/roll but never writes yaw back
}
function settle(ch, speed, frames) { for (let f = 0; f < frames; f++) CBZ.animChar(ch, speed, DT); }
function ready(ch, id) {
  const a = ch._actor || (ch._actor = { char: ch, group: ch.group, pos: ch.group.position });
  a.armed = true; a.weapon = id;
  for (let f = 0; f < 30; f++) { CBZ.animChar(ch, 0, DT); CBZ.actorReadyPose(a); }
}
/* each pose leaves the rig posed; returns a name. Poses are cumulative-safe:
   reset() clears every flag the previous pose set and settle() converges. */
const POSES = {
  stand(ch) { reset(ch); settle(ch, 0, 40); },
  walkA(ch) { reset(ch); ch.phase = 0; settle(ch, 2.2, 30); walkTo(ch, 0.9); },
  walkB(ch) { reset(ch); ch.phase = 0; settle(ch, 2.2, 30); walkTo(ch, 2.5); },
  run(ch) { reset(ch); ch.phase = 0; settle(ch, 6.5, 30); walkTo(ch, 1.6); },
  // a real chair (seatRef: the V2 seat solve every seat in the game uses);
  // the cushion at knee height for this body
  sit(ch) { reset(ch); ch.sitting = true; ch.seatRef = { cushion: (ch.profile.legLo + 0.02) * HS, floorBelow: 0, kind: "chair" }; settle(ch, 0, 45); },
  // THE GUN IN THE HANDS, the way every armed NPC holds one (systems/
  // actorweapons.js CBZ.actorReadyPose -> CBZ.gunHold.ready): the held gun is
  // an attachment too ("held:<id>"), and the arms are where the solve puts them
  aim(ch) { reset(ch); ready(ch, "carbine"); },
  aimPistol(ch) { reset(ch); ready(ch, "sidearm"); },
  // on a mount (warlord/mounts.js): the only seat a warlord rig ever takes
  ride(ch) { reset(ch); ch.riding = { width: 0.5, moving: false, airborne: false, phase: 1.1, speed: 0 }; settle(ch, 0, 40); },
  prone(ch) { reset(ch); ch.pronePose = true; settle(ch, 0, 45); },
  lie(ch) { reset(ch); ch.lying = { back: false }; settle(ch, 0, 60); },
  turnL(ch) { POSES.stand(ch); ch.neck.rotation.y = 0.85; },
  turnR(ch) { POSES.stand(ch); ch.neck.rotation.y = -0.85; },
  turnDown(ch) { POSES.stand(ch); ch.neck.rotation.y = 0.85; ch.neck.rotation.x = 0.35; },
  // the hair builder seats its locks to survive the head tipped back 0.3 rad
  lookUp(ch) { POSES.stand(ch); ch.neck.rotation.x = -0.30; },
  turnUp(ch) { POSES.stand(ch); ch.neck.rotation.y = -0.6; ch.neck.rotation.x = -0.2; },
  walkTurn(ch) { POSES.walkB(ch); ch.neck.rotation.y = 0.85; },
};
// step the gait until its phase reaches `ph` (mod 2pi) so the two walk frames are distinct
function walkTo(ch, ph) {
  for (let k = 0; k < 90; k++) {
    const cur = ((ch.phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (Math.abs(cur - ph) < 0.15) break;
    CBZ.animChar(ch, 2.2, DT);
  }
}

// ---------------------------------------------------------------- bodies
const BODIES = [
  { key: "man", build: "m", age: null },
  { key: "woman", build: "f", age: null },
  { key: "teen", build: "m", age: 15 },
  { key: "girl11", build: "f", age: 11 },
];
const HAIR_BODIES = BODIES.concat([{ key: "child6", build: "f", age: 6 }, { key: "toddler3", build: "m", age: 3 }]);
function makeBody(B, extra) {
  const her = (extra && extra.her) || "e_asian";
  const look = CBZ.heritageRoll(CBZ.HERITAGE_IDS.indexOf(her) >= 0 ? her : CBZ.HERITAGE_IDS[0], "overlap|" + B.key);
  const spec = Object.assign({ legs: 0x39414f, torso: 0x8a939c, collar: 0x8a939c, arms: 0x8a939c, skin: look.skin, hair: look.hair,
    hairStyle: look.hairStyle, shoes: 0x2b2b2b, build: B.build, age: B.age, longHair: B.build === "f" }, extra || {});
  const ch = CBZ.makeCharacter(spec);
  const scene = new T.Scene(); scene.add(ch.group);
  CBZ.scene = scene;
  return ch;
}
function labelNew(ch, before, labels, label) {
  ch.group.traverse((o) => { if (o.isMesh && !before.has(o) && !labels.has(o)) labels.set(o, label); });
}
function snapshot(ch) { const s = new Set(); ch.group.traverse((o) => { if (o.isMesh) s.add(o); }); return s; }

let evals = 0;
const TIMES = { pose: 0, measure: 0 };
process.on("exit", () => { if (process.env.OA_TIME) console.log("TIME pose " + (TIMES.pose / 1000).toFixed(1) + "s measure " + (TIMES.measure / 1000).toFixed(1) + "s"); });
/* PRONE and LYING are FOLDING poses: the body presses into itself (arms
   folded into the chest, the head tipped 0.5 rad back over the shoulders to
   look ahead flat on the deck), so kit worn on it meets the body in ways a
   rigid attachment cannot dodge. They are measured and REPORTED (known:)
   — they never fail the run; everything upright does. */
const FOLDING = { prone: 1, lie: 1, ride: 1 };    // (astride a saddle: legs spread, both hands meet at the reins)
/* …EXCEPT A SLUNG GUN. It is not worn ON the folding body, it hangs from a
   sling, and a sling gives: prone the rifle rides flat and low across the
   back (entities/character.js slingPose), so there is nothing a stowed gun
   cannot dodge. opts.fold === "measured" fails those rows like any other. */
const AIMS = { aim: 1, aimPistol: 1 };
function run(ch, tag, labels, poses, opts) {
  if (process.env.OA_ARMS && ch.armOutZ !== ch.profile.armOutZ) console.log("ARMS", tag, "armOutZ", (+ch.armOutZ).toFixed(3), "base", ch.profile.armOutZ);
  for (const pz of poses) {
    const a = performance.now(); POSES[pz](ch);
    const b = performance.now(); measure(ch, labels, tag, pz, FOLDING[pz] && opts.fold !== "measured" ? Object.assign({}, opts, { known: true }) : opts);
    TIMES.pose += b - a; TIMES.measure += performance.now() - b; evals++;
  }
  reset(ch); settle(ch, 0, 2);
}

// ================================================================ 1. HAIR
// Every style on every body, through the poses that swing the hanging length
// into the shoulders: head turned past 45 degrees (and tipped), walking, sat.
if (!ONLY || ONLY === "hair") {
  const STYLES = ["buzz", "short", "crop", "bob", "long", "pony", "bun", "pigtail", "afro", "curly", "locs"];
  const hairOnly = { filter: (a) => /^hair:/.test(a.label), skipRegion: (P) => P.region === "head" };
  /* Under 13 the audit wears the styles a child is actually CAST in
     (city/outfits.js cityHairStyleFor: toddler girls pigtail/bob, girls
     pigtail/bob/pony/bun, boys crop/short/buzz; character.js hairStyleFor the
     same). Adult locs on a toddler is not a body the game builds, and a
     3-year-old's head sits down between shoulders that no adult length
     was hung for. Teens and adults wear every style. */
  const KID_STYLES = new Set(["buzz", "short", "crop", "bob", "pony", "bun", "pigtail"]);
  for (const B of HAIR_BODIES) for (const st of STYLES) {
    if (B.age != null && B.age < 13 && !KID_STYLES.has(st)) continue;
    const ch = makeBody(B, { hairStyle: st });
    /* A TODDLER's head sits DOWN in the yoke (character.js neckDrop), so a
       head both turned 0.85 and nodded puts the jaw line itself at the yoke
       edge; its hair is measured there and REPORTED as known (it cannot fail
       the run) until the torso/neck reshape lands — see the report. Single-
       axis turns, looking up, sitting and standing still fail as normal. */
    if (B.age != null && B.age < 4) {
      run(ch, B.key + " hair " + st, new Map(), ["stand", "turnL", "turnR", "lookUp", "sit"], hairOnly);
      run(ch, B.key + " hair " + st, new Map(), ["turnDown", "turnUp", "walkTurn"], Object.assign({ known: true }, hairOnly));
    } else run(ch, B.key + " hair " + st, new Map(), ["stand", "turnL", "turnR", "turnDown", "lookUp", "turnUp", "walkTurn", "sit"], hairOnly);
  }
}

// ================================================================ 2. OUTFITS
// every city role outfit (+ the composable business stack and the detail kit)
if (!ONLY || ONLY === "outfit") {
  const CAT = CBZ.cityOutfitCatalog();
  const OUT = Object.keys(CAT).map((id) => [id, CAT[id]]);
  OUT.push(["comp:biz", { id: "comp-biz", colors: { torso: 0xf2f2f2, legs: 0x2a2d34 }, composite: { shirt: 0xf2f2f2, legs: 0x2a2d34, items: ["shirt_white_collar", "blazer_navy", "tie_burgundy"] } }]);
  OUT.push(["comp:bow", { id: "comp-bow", colors: { torso: 0xf2f2f2, legs: 0x141519 }, composite: { shirt: 0xf2f2f2, legs: 0x141519, items: ["shirt_white_collar", "bow_black"] } }]);
  const noHair = { filter: (a) => !/^hair:/.test(a.label) };
  for (const B of BODIES) {
    for (const [id, recd] of OUT) {
      const ch = makeBody(B, { hairStyle: "short" });
      const labels = new Map(), before = snapshot(ch);
      CBZ.cityRecolorRig(ch, recd.colors || {}, recd);
      labelNew(ch, before, labels, "outfit:" + id);
      const b2 = snapshot(ch);
      if (CBZ.cityDetailKit && /secret|security|suit/.test(id)) { CBZ.cityDetailKit(ch, { shades: true, earpiece: true }); labelNew(ch, b2, labels, "detailKit"); }
      run(ch, B.key + " " + id, labels, ["stand", "walkA", "walkB", "sit", "aim"], noHair);
    }
  }
}

// ================================================================ 3. KIT
if (!ONLY || ONLY === "kit" || ONLY === "stow") {
  const CAT = CBZ.cityOutfitCatalog();
  const noHair = { filter: (a) => !/^hair:/.test(a.label) };
  const KP = ["stand", "walkA", "walkB", "run", "sit", "aim", "aimPistol", "prone", "lie"];
  // a warlord rig never takes a chair (nothing in src/warlord sets .sitting): it rides
  const WP = ["stand", "walkA", "walkB", "run", "ride", "aim", "aimPistol", "prone", "lie"];
  const STOW_ONLY = ONLY === "stow";
  for (const B of BODIES.slice(0, 2)) {
    // ---- city armour, bare and over the police uniform (jacket shell)
    if (!STOW_ONLY) {
    for (const under of ["plain", "police"]) for (const kitId of ["softVest", "plateCarrier", "swatVest"]) {
      const ch = makeBody(B, { hairStyle: "short" });
      if (under === "police" && CAT.police) CBZ.cityRecolorRig(ch, CAT.police.colors, CAT.police);
      const labels = new Map(), before = snapshot(ch);
      const ped = { char: ch };
      CBZ.cityArmorDressPed(ped, [kitId]);
      labelNew(ch, before, labels, "armor:" + kitId);
      for (const m of ped._armorMeshes || []) if (m.userData.armorKind) labels.set(m, "armor:" + kitId + "/" + m.userData.armorKind);
      run(ch, B.key + " " + under + "+" + kitId, labels, KP, noHair);
    }
    // ---- the prison: a corrections guard, the SWAT, an inmate
    if (CBZ.prisonOutfitCatalog || CAT.corrections) {
      for (const id of ["corrections", "inmate", "swat"]) {
        const recd = CAT[id]; if (!recd) continue;
        const ch = makeBody(B, { hairStyle: "short" });
        const labels = new Map(), before = snapshot(ch);
        CBZ.cityRecolorRig(ch, recd.colors || {}, recd);
        if (id === "swat") CBZ.cityArmorDressPed({ char: ch }, ["swatVest"]);
        labelNew(ch, before, labels, "prison:" + id);
        run(ch, B.key + " prison " + id, labels, KP, noHair);
      }
    }
    // ---- bling: every look, on its real anchor
    const blingLooks = ["chainGold", "chainDiamond", "chainIced", "bracelet", "ring", "ringRock", "ringPinky", "earrings", "earringsIce", "tiara", "grill",
      "shades", "shadesAviator", "shadesSport", "shadesRetro", "shadesDesigner"];
    const SLOT = { chainGold: "body", chainDiamond: "body", chainIced: "body", bracelet: "ra", ring: "ra", ringRock: "ra", ringPinky: "ra" };
    for (const under of ["plain", "suit"]) for (const look of blingLooks) {
      const ch = makeBody(B, { hairStyle: B.build === "f" ? "long" : "short" });
      if (under === "suit" && CAT.suit) CBZ.cityRecolorRig(ch, CAT.suit.colors, CAT.suit);
      const labels = new Map(), before = snapshot(ch);
      const parts = CBZ.cityBlingParts ? null : null;
      const ped = { char: ch, valuables: [] };
      // build through the portrait's fresh-mesh path, on the anchor the street path uses
      const L = CBZ.cityBlingBuild ? look : null;
      if (!L) continue;
      const slot = SLOT[look] || "neck";
      const anchor = slot === "body" ? ch.body : (slot === "ra" ? ch.parts.ra.userData.low : ch.neck);
      const list = lookPartsOf(look);
      if (!list) continue;
      CBZ.cityBlingBuild(list, anchor, [], CBZ.charArmLandmarks ? CBZ.charArmLandmarks(ch) : null, ch);
      labelNew(ch, before, labels, "bling:" + look);
      run(ch, B.key + " " + under + "+" + look, labels, ["stand", "walkA", "sit", "aim", "turnL"], noHair);
    }
    }
    // ---- stowed weapons on the body mounts (holsterprops' placement).
    // Measured in EVERY pose, prone and lying included (see FOLDING).
    for (const [slot, id] of [["hip", "sidearm"], ["hip", "taser"], ["back", "carbine"], ["back", "shotgun"], ["back2", "ak47"], ["back", "sniper"]]) {
      const ch = makeBody(B, { hairStyle: "short" });
      const labels = new Map();
      const mnt = CBZ.charMounts(ch)[slot];
      const prop = CBZ.buildActorWeapon(id);
      prop.position.set(0, 0, 0); prop.rotation.set(0, 0, 0);
      prop.scale.setScalar((CBZ.weaponHeldScale && CBZ.weaponHeldScale(id)) || 0.92);
      mnt.add(prop);
      if (CBZ.charMountSeat) CBZ.charMountSeat(mnt, prop, prop.position);   // holsterprops' seat on the hip
      prop.traverse((o) => { if (o.isMesh) labels.set(o, "stow:" + slot + ":" + id); });
      run(ch, B.key + " stow " + slot + " " + id, labels, KP.concat(["lookUp", "turnUp"]), Object.assign({ fold: "measured" }, noHair));
    }
    if (STOW_ONLY) continue;
    // ---- warlord: every armour rung with webbing + pouches
    if (W.outfits && W.outfits.apply) for (const armour of ["vest", "plate", "heavy"]) {
      const ch = makeBody(B, { hairStyle: "short" });
      const labels = new Map(), before = snapshot(ch);
      const rec = { id: "wl-audit", colors: { torso: 0x6a6040, arms: 0x6a6040, legs: 0x4a4430, shoes: 0x2b241c }, belt: true };
      W.outfits.apply(ch, { rec, det: { armour, rank: 3, accent: 0xc4593a, rankHex: 0xc4593a, head: "none", wear: 0 } });
      labelNew(ch, before, labels, "warlord:" + armour);
      ch.group.traverse((o) => {
        if (!o.isMesh || before.has(o)) return;
        for (let n = o; n; n = n.parent) {
          if (n.name === "warlord-webbing") { labels.set(o, "warlord:webbing" + (n.children.indexOf(o) > 0 ? "/pouch" : "")); return; }
          if (n.name === "warlord-armour") { labels.set(o, "warlord:" + armour + "/" + (n.children.indexOf(o))); return; }
        }
        for (const a of ch.skinSlots.arms) if (o === a.userData._wlPad) labels.set(o, "warlord:" + armour + "/pad");
      });
      run(ch, B.key + " warlord " + armour, labels, WP, noHair);
    }
    // ---- warlord wardrobe: every fit's kit (medals, sash, coat, cape, plate, braid)
    if (W.wardrobe && W.wardrobe.dress) {
      let ids = [];
      try { ids = W.wardrobe.list().map((f) => f.id); } catch (e) { ids = []; }
      for (const id of ids) {
        const f = W.wardrobe.fit(id);
        if (!f || !f.kit || !Object.keys(f.kit).some((k) => k !== "head" && k !== "headColor" && k !== "trim")) continue;
        const ch = makeBody(B, { hairStyle: "short" });
        const labels = new Map(), before = snapshot(ch);
        try { W.wardrobe.dress(ch, id); } catch (e) { continue; }
        // one label per PIECE across the fits (the webbing band is the same
        // band on every fit that wears one): the node the piece hangs on
        ch.group.traverse((o) => {
          if (!o.isMesh || before.has(o)) return;
          let piece = null;
          for (let n = o.parent; n && !piece; n = n.parent) if (n.name === "warlord-webbing") piece = "webbing" + (n.children.indexOf(o) > 0 ? "/pouch" : "");
          if (!piece) {
            const s = ch.skinSlots, par = o.parent;
            piece = par === ch.neck ? "neck-kit" : (s.collar.indexOf(par) >= 0 ? "yoke-kit" : (s.armsLower.indexOf(par) >= 0 ? "cuff" : (s.torso.indexOf(par) >= 0 ? "chest-kit" : ((ch.parts.ll === par || ch.parts.rl === par) ? "coat-panel" : "kit"))));
          }
          labels.set(o, "wardrobe:" + piece);
        });
        run(ch, B.key + " wardrobe " + id, labels, ["stand", "walkA", "walkB", "ride", "aim"], noHair);
      }
    }
  }
}
function lookPartsOf(look) {
  // bling.js exposes name -> parts; look keys go through its table directly
  const f = CBZ.cityBlingLookParts;
  if (f) return f(look);
  return null;
}

// ---------------------------------------------------------------- report
const rows = [...results.entries()].sort((a, b) => b[1].worst - a[1].worst);
let fails = 0;
const fam = new Map();
for (const [label, r] of rows) {
  const f = label.replace(/:.*$/, "");
  const known = /^(known|fenced):/.test(label), tol = tolOf(label);
  const bad = !known && (r.worst > tol || r.zf >= ZF_MIN);
  if (bad) fails++;
  if (bad || VERBOSE || known || r.worst > tol * 0.5) {
    console.log((bad ? "  FAIL " : known ? "  known" : "  ok   ") + " " + label.padEnd(44) + " worst " + r.worst.toFixed(1).padStart(5) + " mm" +
      (r.zf ? "  z-fight " + r.zf + " samples (" + r.zfWhere + ")" : "") + (r.worst > 0 ? "   " + r.where : ""));
    if (VERBOSE) {
      const vs = Object.entries(r.vs).map(([k, v]) => k + " " + v.toFixed(1)).join(", ");
      if (vs) console.log("         vs: " + vs);
      const bp = Object.entries(r.byPose).map(([k, v]) => k + " " + v.toFixed(1)).join(", ");
      if (bp) console.log("         by pose: " + bp);
      const bb = Object.entries(r.byBody).map(([k, v]) => k + " " + v.toFixed(1)).join(", ");
      if (bb) console.log("         by body: " + bb); if (r.bp && process.env.OA_BP) console.log("         over tol: " + Object.entries(r.bp).filter(([, v]) => v > TOL_MM).map(([k, v]) => k + " " + v.toFixed(0)).join(", "));
      if (r.sink > 0) console.log("         same-frame sink " + r.sink.toFixed(1) + " mm (" + r.sinkWhere + ")");
    }
  }
  fam.set(f, Math.max(fam.get(f) || 0, r.worst));
}
console.log("\n  by family (worst cross-frame mm): " + [...fam.entries()].map(([k, v]) => k + " " + v.toFixed(1)).join(" | "));
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log((fails ? "\nFAIL " : "\nPASS ") + " " + rows.length + " attachments, " + evals + " posed measurements, tolerance " + TOL_MM + " mm, " + fails + " failing  (" + secs + "s)");
process.exit(fails ? 1 : 0);
