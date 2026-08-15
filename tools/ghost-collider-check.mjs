#!/usr/bin/env node
/* tools/ghost-collider-check.mjs — FIND EVERY INVISIBLE WALL, BY MEASURING.
   ------------------------------------------------------------------
   The owner's rule, and it is the right one: "I understand you hit a
   building. You hit a building. You hit a light post, you hit a light post."
   A collider you can SEE is not a bug however solid it is. A collider with
   NOTHING DRAWN AT IT is an invisible wall, always, everywhere.

   So this does not reason about ring-walkers or bounding boxes or any other
   theory of how the bug happens. It boots the real game, takes every record
   in CBZ.colliders, and asks one question: is there any visible geometry
   standing in this box? Whatever answers no is an invisible wall, wherever
   it came from and whoever built it.

   HOW THE VISIBLE SET IS BUILT. Every mesh under the scene that is visible
   (and whose whole ancestry is visible) contributes its world AABB.
   InstancedMesh is expanded PER INSTANCE from instanceMatrix — three.js
   r128's Box3.expandByObject ignores instance transforms, and this game
   draws most of its props instanced, so trusting it would report half the
   street furniture as invisible. Sprites and lights contribute nothing:
   you cannot walk into a sprite.

   A collider counts as SEEN when drawn geometry overlaps its footprint by
   COVER of its area and meets it in height. Partial credit is deliberate:
   a fence collider a little thicker than its mesh is seen, a fence collider
   nine metres out in a car park is not.

   Reports the worst offenders by area, grouped into named regions so the
   output says WHERE rather than just how many.

   Usage:
     node tools/ghost-collider-check.mjs                # default seed, report
     node tools/ghost-collider-check.mjs --seed 1
     node tools/ghost-collider-check.mjs --max-area 40  # gate: fail over 40 m2
*/
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const argS = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const seed = +argS("--seed", "90210");
const maxArea = argv.includes("--max-area") ? +argS("--max-area", "40") : null;
const topN = +argS("--top", "25");
// --near x,z,r — interrogate ONE piece of ground. The world's biggest ghost
// cluster (farmland field fences) is 35k records and drowns everything else
// in a global report, so asking about the port has to be possible directly.
const near = (argS("--near", "") || "").split(",").map(Number).filter(Number.isFinite);
// --sweep x0,z0,x1,z1[,step] — WALK THE GROUND instead of reading the ledger.
// Iterating CBZ.colliders can only find what is IN CBZ.colliders, and the
// port's pontoons and the beach's floating dock block through mpCollide in a
// moving rig's LOCAL frame, so they are invisible to a ledger scan by
// construction. This mode samples free space, calls the shipping resolver at
// each point, and reports ground you are pushed out of with nothing drawn
// near it -- which catches every blocker whatever registered it.
const sweep = (argS("--sweep", "") || "").split(",").map(Number).filter(Number.isFinite);
// --vehicle — sweep as a CAR instead of on foot, reproducing vehicles.js's own
// call exactly: CBZ.collide(car.pos, radius) with NO feetY/headY. physics.js's
// contract is that omitting the height pair makes EVERY collider full-height,
// so a car meets overhead geometry -- gantry beams, balconies, upper-floor
// window bands, stand rails twenty metres up -- at road level.
const asVehicle = argv.includes("--vehicle");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CBZ_CHROME
  || (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "/opt/pw-browsers/chromium");

const NEAR = near.length === 3 ? near : null;
const SWEEP = sweep.length >= 4 ? sweep : null;
const AS_VEH = asVehicle;
const PROBE = `(() => {
  const NEAR = ${JSON.stringify(near.length === 3 ? near : null)};
  const cols = CBZ.colliders || [];
  const MIN_OFF = 0.45;        // metres past the drawn thing before it is a WALL
                               // (player radius 0.38: below this you are touching it)
  const YSLOP = 0.6;           // vertical slop when matching a height-gated box

  // ---- 1. every drawn thing, as a world AABB -------------------------
  const boxes = [];            // flat [minX,minY,minZ,maxX,maxY,maxZ, ...]
  const _b = new THREE.Box3(), _m = new THREE.Matrix4(), _v = new THREE.Vector3();
  function pushBox(b) {
    if (!isFinite(b.min.x) || !isFinite(b.max.x)) return;
    boxes.push(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
  }
  function visibleChain(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
  CBZ.scene.traverse(function (o) {
    if (!o.isMesh && !o.isInstancedMesh) return;
    if (o.isSprite || o.isPoints || o.isLine) return;
    if (!o.visible || !visibleChain(o)) return;
    const g = o.geometry; if (!g) return;
    if (!g.boundingBox) { try { g.computeBoundingBox(); } catch (e) { return; } }
    if (!g.boundingBox) return;
    if (o.isInstancedMesh) {
      // PER INSTANCE. r128's expandByObject does not do this and most of the
      // world's props are instanced, so skipping it would invent ghosts.
      const n = o.count;
      for (let i = 0; i < n; i++) {
        o.getMatrixAt(i, _m);
        _m.premultiply(o.matrixWorld);
        _b.copy(g.boundingBox).applyMatrix4(_m);
        pushBox(_b);
      }
    } else {
      _b.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      pushBox(_b);
    }
  });

  // ---- 2. a coarse grid over the drawn boxes, so the test is not O(n*m) --
  const CELL = 16, grid = new Map();
  const key = (gx, gz) => gx * 100000 + gz;
  for (let i = 0; i < boxes.length; i += 6) {
    const x0 = Math.floor(boxes[i] / CELL), x1 = Math.floor(boxes[i + 3] / CELL);
    const z0 = Math.floor(boxes[i + 2] / CELL), z1 = Math.floor(boxes[i + 5] / CELL);
    if ((x1 - x0) > 64 || (z1 - z0) > 64) continue;      // a ground plane helps nobody
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = key(gx, gz); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i);
    }
  }

  // ---- 3. THE STANDOFF: how far past the visible thing does this box reach --
  // "Nothing drawn at all" is only the extreme case. What an invisible wall
  // FEELS like is being stopped short of something you can see -- a lamp post
  // with a two-metre collider is a wall even though the post is right there.
  // So the number reported is the STANDOFF: on each of the four side faces,
  // how far the collider reaches past the drawn geometry standing inside it.
  // A collider snug on its mesh scores 0. A pure ghost scores its own half-
  // extent. Add the body radius and that is the gap the player feels.
  function standoffOf(c) {
    const y0 = c.y0 != null ? c.y0 : -1e5, y1 = c.y1 != null ? c.y1 : 1e5;
    let uX0 = Infinity, uX1 = -Infinity, uZ0 = Infinity, uZ1 = -Infinity, hits = 0;
    const seen = new Set();
    const gx0 = Math.floor(c.minX / CELL), gx1 = Math.floor(c.maxX / CELL);
    const gz0 = Math.floor(c.minZ / CELL), gz1 = Math.floor(c.maxZ / CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const a = grid.get(key(gx, gz)); if (!a) continue;
      for (let q = 0; q < a.length; q++) {
        const i = a[q]; if (seen.has(i)) continue; seen.add(i);
        if (boxes[i + 4] < y0 - YSLOP || boxes[i + 1] > y1 + YSLOP) continue;
        // clip the drawn box to the collider: geometry OUTSIDE this box is
        // some other object and must not excuse this one
        const x0 = Math.max(c.minX, boxes[i]), x1 = Math.min(c.maxX, boxes[i + 3]);
        const z0 = Math.max(c.minZ, boxes[i + 2]), z1 = Math.min(c.maxZ, boxes[i + 5]);
        if (x1 <= x0 || z1 <= z0) continue;
        hits++;
        if (x0 < uX0) uX0 = x0; if (x1 > uX1) uX1 = x1;
        if (z0 < uZ0) uZ0 = z0; if (z1 > uZ1) uZ1 = z1;
      }
    }
    const hw = (c.maxX - c.minX) / 2, hd = (c.maxZ - c.minZ) / 2;
    if (!hits) return { off: Math.min(hw, hd), hits: 0 };   // nothing drawn: a pure ghost
    // the worst of the four faces, but never more than the box's own half-depth
    // (reaching past a wall's END is a length question, not an invisible wall)
    const off = Math.max(
      Math.min(uX0 - c.minX, hw), Math.min(c.maxX - uX1, hw),
      Math.min(uZ0 - c.minZ, hd), Math.min(c.maxZ - uZ1, hd));
    return { off: Math.max(0, off), hits: hits };
  }

  // ---- 4. name the ground, so the report says WHERE ---------------------
  // Every anchor is READ FROM THE LIVE WORLD, never typed: the city rect off
  // CBZ.city (world.js publishes minX..maxZ on it), the marina off its own
  // accessor (cityMarina.site is a FUNCTION), the compounds off the gov audit.
  // A zone map built from remembered coordinates reports the wrong district
  // the first time anything moves, which is worse than reporting none.
  // EVERY ONE OF THESE IS DEFENSIVE ON PURPOSE. A probe that throws because
  // one accessor changed shape reports nothing at all, which is the worst
  // possible answer to "where are the invisible walls".
  function tryGet(fn, dflt) { try { const v = fn(); return v == null ? dflt : v; } catch (e) { return dflt; } }
  // THE CITY RECT IS ON CBZ.city.arena, NOT CBZ.city. mode.js owns the name
  // CBZ.city for its own actor/mode object and hangs world.js's built city
  // (the one carrying minX..maxZ) off dot-arena. Reading the outer one finds
  // nothing, silently, and sends the whole city to "outland".
  const A = tryGet(function () {
    const c = CBZ.city && CBZ.city.arena;
    return (c && c.minX != null) ? c : null;
  }, null);
  const M = tryGet(function () { return CBZ.cityMarina.site(); }, null);
  const GOV = tryGet(function () {
    // gov sites report cx/cz (centre), not x/z — filtering on x drops all of them
    return (CBZ.govComplexAudit().sites || []).filter(function (s) {
      return s && isFinite(s.cx) && isFinite(s.cz);
    });
  }, []);
  function where(x, z) { try { return where_(x, z); } catch (e) { return "unclassified"; } }
  function where_(x, z) {
    if (Math.hypot(x - 640, z + 950) < 190) return "arena (Ironjaw)";
    if (Math.hypot(x - 490, z + 350) < 420) return "speedway";
    if (M && isFinite(M.QX) && Math.abs(x - M.QX) < 150 && Math.abs(z - M.BZ) < 150) return "PORT: marina";
    for (const s of GOV) {
      if (!s || s.x == null) continue;
      if (Math.abs(x - s.cx) < (s.hx || 0) + 30 && Math.abs(z - s.cz) < (s.hz || 0) + 30) {
        return (s.id === "freeport" ? "PORT: freeport" : "gov: " + s.id);
      }
    }
    if (A) {
      const inRect = x > A.minX && x < A.maxX && z > A.minZ && z < A.maxZ;
      if (inRect) return "Port Vance (city grid)";
      // the quay/seawall belt: outside the grid but on the city's waterfront
      if (x > A.minX - 90 && x < A.maxX + 90 && z > A.minZ - 90 && z < A.maxZ + 90) {
        return "PORT: city waterfront";
      }
    }
    return "outland";
  }

  // ---- 5. the verdict ---------------------------------------------------
  const ghosts = [];
  let checked = 0, ghostArea = 0;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (!isFinite(c.minX) || !isFinite(c.maxZ)) continue;
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    const area = w * d;
    if (area < 0.6) continue;                 // a bollard is not worth a report
    const px = (c.minX + c.maxX) / 2, pz = (c.minZ + c.maxZ) / 2;
    if (NEAR && Math.hypot(px - NEAR[0], pz - NEAR[1]) > NEAR[2]) continue;
    checked++;
    const so = standoffOf(c);
    if (so.off < MIN_OFF) continue;
    const x = px, z = pz;
    ghostArea += area;
    ghosts.push({ x: +x.toFixed(1), z: +z.toFixed(1), w: +w.toFixed(1), d: +d.toFixed(1),
                  area: +area.toFixed(1), off: +so.off.toFixed(2), drawn: so.hits,
                  y0: c.y0 == null ? null : +c.y0.toFixed(1),
                  y1: c.y1 == null ? null : +c.y1.toFixed(1),
                  yaw: c.yaw ? 1 : 0, ref: c.ref ? (c.ref.name || "mesh") : null,
                  zone: where(x, z) });
  }
  ghosts.sort((a, b) => b.off - a.off);
  const byZone = {};
  for (const g of ghosts) {
    const b = byZone[g.zone] || (byZone[g.zone] = { n: 0, area: 0, worst: 0 });
    b.n++; b.area += g.area;
    if (g.off > b.worst) b.worst = g.off;
  }
  for (const k in byZone) { byZone[k].area = +byZone[k].area.toFixed(0); byZone[k].worst = +byZone[k].worst.toFixed(2); }
  // WHAT THE ZONE MAP ACTUALLY RESOLVED. An anchor that came back null sends
  // its whole district to "outland" silently, which reads as "no bug there"
  // when it means "never looked" — so the anchors are reported, always.
  const anchors = {
    city: A && A.minX != null ? [+A.minX.toFixed(0), +A.minZ.toFixed(0), +A.maxX.toFixed(0), +A.maxZ.toFixed(0)] : null,
    marina: (M && isFinite(M.QX)) ? [+M.QX.toFixed(0), +M.BZ.toFixed(0)] : null,
    gov: GOV.length,
    freeport: (function () {
      const f = GOV.find(function (s) { return s.id === "freeport"; });
      return f ? [+f.cx.toFixed(0), +f.cz.toFixed(0), f.hx || 0, f.hz || 0] : null;
    })(),
  };
  // CLUSTERS, not rows: the same authored shape repeated a thousand times is
  // ONE bug, and a report that lists it a thousand times hides every other one.
  const clus = new Map();
  for (const g of ghosts) {
    const k = g.zone + "|" + Math.round(g.w) + "x" + Math.round(g.d) + "|" + g.y0 + ".." + g.y1;
    let e = clus.get(k);
    if (!e) clus.set(k, e = { zone: g.zone, w: g.w, d: g.d, y0: g.y0, y1: g.y1, n: 0, area: 0, off: 0, drawn: g.drawn, at: [g.x, g.z] });
    e.n++; e.area += g.area; if (g.off > (e.off || 0)) e.off = g.off;
  }
  const clusters = [...clus.values()].sort((a, b) => b.off - a.off || b.area - a.area).slice(0, 18)
    .map(function (e) { e.area = +e.area.toFixed(0); return e; });
  return { anchors, clusters, drawn: boxes.length / 6, colliders: cols.length, checked,
           ghosts: ghosts.length, ghostArea: +ghostArea.toFixed(0),
           byZone, top: ghosts.slice(0, ${topN}) };
})()`;


const SWEEP_PROBE = `(() => {
  const S = ${JSON.stringify(sweep)};
  const step = S[4] || 1.5;
  const CLEAR = 0.9;            // a blocked point this far from anything drawn is a wall
  const VEH = ${asVehicle ? "true" : "false"};
  const R = VEH ? 1.35 : ((CBZ.TUNE && CBZ.TUNE.playerRadius) || 0.38);
  const CAR_H = 1.9;           // roof height of an ordinary car in this game

  // ---- the drawn world, same construction as the ledger probe ----------
  const boxes = [];
  const _b = new THREE.Box3(), _m = new THREE.Matrix4();
  function visibleChain(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
  CBZ.scene.traverse(function (o) {
    if ((!o.isMesh && !o.isInstancedMesh) || o.isSprite || o.isPoints || o.isLine) return;
    if (!o.visible || !visibleChain(o)) return;
    const g = o.geometry; if (!g) return;
    if (!g.boundingBox) { try { g.computeBoundingBox(); } catch (e) { return; } }
    if (!g.boundingBox) return;
    const n = o.isInstancedMesh ? o.count : 1;
    for (let i = 0; i < n; i++) {
      if (o.isInstancedMesh) { o.getMatrixAt(i, _m); _m.premultiply(o.matrixWorld); _b.copy(g.boundingBox).applyMatrix4(_m); }
      else _b.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      if (!isFinite(_b.min.x)) continue;
      // Only things a MOVING BODY meets. On foot that is 0.25..2.2 m; for a
      // car the band is the hood height, and anything above it is exactly what
      // this run is here to catch, so nothing overhead counts as "drawn".
      if (_b.max.y < 0.2 || _b.min.y > (VEH ? 1.9 : 2.2)) continue;
      // A GROUND PLANE IS BIG IN BOTH AXES; A SEAWALL IS BIG IN ONE. Testing
      // either axis threw out the city's 535 m waterfront cap -- a mesh that
      // matches its collider exactly -- and reported it as half a kilometre of
      // invisible wall. Excluding on the SHORT axis drops slabs and keeps walls.
      if (Math.min(_b.max.x - _b.min.x, _b.max.z - _b.min.z) > 60) continue;
      boxes.push(_b.min.x, _b.min.z, _b.max.x, _b.max.z);
    }
  });
  const CELL = 8, grid = new Map(), key = (a, b) => a * 100000 + b;
  for (let i = 0; i < boxes.length; i += 4) {
    const x0 = Math.floor((boxes[i] - CLEAR) / CELL), x1 = Math.floor((boxes[i + 2] + CLEAR) / CELL);
    const z0 = Math.floor((boxes[i + 1] - CLEAR) / CELL), z1 = Math.floor((boxes[i + 3] + CLEAR) / CELL);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = key(gx, gz); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i);
    }
  }
  function drawnNear(x, z) {
    const a = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    let best = 1e9; if (!a) return best;
    for (let q = 0; q < a.length; q++) {
      const i = a[q];
      const dx = Math.max(boxes[i] - x, 0, x - boxes[i + 2]);
      const dz = Math.max(boxes[i + 1] - z, 0, z - boxes[i + 3]);
      const d = Math.hypot(dx, dz); if (d < best) best = d;
    }
    return best;
  }

  // ---- walk the ground -------------------------------------------------
  const p = { x: 0, z: 0, y: 0 };
  // an ordinary sedan, the shape vehicles.js's own default assumes
  const _car = { pos: { x: 0, y: 0, z: 0 }, heading: 0, v: 0,
                 _visualDims: { width: 2.0, length: 4.4, height: 1.5, wheelbase: 2.7 } };
  const hits = [];
  let tested = 0, blocked = 0, stillBlocked = 0;
  for (let x = S[0]; x <= S[2]; x += step) {
    for (let z = S[1]; z <= S[3]; z += step) {
      const gy = CBZ.groundAt ? CBZ.groundAt(x, z) : 0;
      if (!isFinite(gy)) continue;
      tested++;
      p.x = x; p.z = z; p.y = gy;
      if (VEH) CBZ.collide(p, R);                    // vehicles.js:4130, verbatim
      else CBZ.collide(p, R, gy + 0.25, gy + 1.7);   // the player's own body band
      if (Math.hypot(p.x - x, p.z - z) < 1e-4) continue;
      blocked++;
      if (VEH) {
        // THE OVERHEAD TEST, and it needs no meshes at all -- which is the
        // point, because merged geometry makes a drawn-AABB test lie. Re-run
        // the SAME resolve with the car's real vertical span. Anything that
        // stops moving it was standing entirely above the roof: a gantry beam,
        // a balcony, an upper-floor window band, a stand rail twenty metres up.
        // That is a wall in open air by construction, not by inference.
        p.x = x; p.z = z;
        CBZ.collide(p, R, gy + 0.1, gy + CAR_H);
        if (Math.hypot(p.x - x, p.z - z) > 1e-4) continue;   // a real, solid thing
        // AND NOW THE SHIPPING PATH. The two lines above describe the DEFECT
        // (a bare CBZ.collide sees every height-gated box as full-height);
        // this drives city/vehicles.js's own resolver on a real car record, so
        // the fix is measured where the game actually runs it, not where a
        // probe re-implements it.
        let live = true;
        if (CBZ.cityCollideVehicle) {
          _car.pos.x = x; _car.pos.z = z; _car.pos.y = gy;
          _car._sweepX = null; _car._sweepZ = null;
          try { live = CBZ.cityCollideVehicle(_car) > 1e-4; } catch (e) { live = true; }
        }
        if (live) stillBlocked++;
        hits.push([x, z, 0]);
      } else {
        const far = drawnNear(x, z);
        if (far > CLEAR) hits.push([x, z, +far.toFixed(2)]);
      }
    }
  }

  // ---- group contiguous hits so one wall reads as one line -------------
  const cell = step * 1.7, occ = new Map(), blobs = [];
  for (const h of hits) occ.set(key(Math.round(h[0] / cell), Math.round(h[1] / cell)), h);
  const done = new Set();
  for (const [k, h] of occ) {
    if (done.has(k)) continue;
    const stack = [k]; done.add(k);
    let n = 0, sx = 0, sz = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, far = 0;
    while (stack.length) {
      const c = stack.pop(), e = occ.get(c); if (!e) continue;
      n++; sx += e[0]; sz += e[1]; if (e[2] > far) far = e[2];
      if (e[0] < x0) x0 = e[0]; if (e[0] > x1) x1 = e[0];
      if (e[1] < z0) z0 = e[1]; if (e[1] > z1) z1 = e[1];
      const gx = Math.round(e[0] / cell), gz = Math.round(e[1] / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const nk = key(gx + a, gz + b);
        if (occ.has(nk) && !done.has(nk)) { done.add(nk); stack.push(nk); }
      }
    }
    blobs.push({ n, x: +(sx / n).toFixed(1), z: +(sz / n).toFixed(1),
                 w: +(x1 - x0).toFixed(1), d: +(z1 - z0).toFixed(1),
                 area: +(n * step * step).toFixed(0), far: far });
  }
  blobs.sort((a, b) => b.area - a.area);
  return { tested, blocked, ghost: hits.length, stillBlocked, veh: VEH,
           step, clear: CLEAR, blobs: blobs.slice(0, 20) };
})()`;

const portDbg = 9790 + Math.floor(Math.random() * 100);
const port = 8790 + Math.floor(Math.random() * 40);
const server = spawn("python3", [path.join(ROOT, "tools/devserver.py")],
  { env: { ...process.env, PORT: String(port) }, stdio: "ignore" });
await sleep(700);
const profile = `/tmp/cbz-ghost-${portDbg}`;
await rm(profile, { recursive: true, force: true });
const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--enable-webgl", "--mute-audio", "--window-size=1000,800",
  `--remote-debugging-port=${portDbg}`, `--user-data-dir=${profile}`,
  `http://127.0.0.1:${port}/?seed=${seed}`,
], { stdio: "ignore" });

let page = null;
for (let i = 0; i < 80 && !page; i++) {
  try {
    const ps = await (await fetch(`http://127.0.0.1:${portDbg}/json/list`)).json();
    page = ps.find((q) => q.type === "page" && q.url.includes("seed="));
  } catch (_) { /* not up yet */ }
  if (!page) await sleep(250);
}
if (!page) { console.error("no page"); chrome.kill("SIGKILL"); server.kill("SIGKILL"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
let id = 1; const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => {
  const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
});
const evl = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (r.result && r.result.exceptionDetails) {
    console.error("EXC:", JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  }
  return r.result && r.result.result && r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");
for (let i = 0; i < 60; i++) {
  if (await evl("!!(window.CBZ && CBZ.game && document.getElementById('playBtn'))")) break;
  await sleep(500);
}
let playing = false;
for (let i = 0; i < 120 && !playing; i++) {
  await evl("(() => { const b = document.getElementById('playBtn'); if (b) b.click(); return true; })()");
  await sleep(600);
  playing = await evl("!!(CBZ.game && CBZ.game.state === 'playing')");
}
if (!playing) { console.error("never reached play"); chrome.kill("SIGKILL"); server.kill("SIGKILL"); process.exit(1); }
await sleep(9000);

const r = SWEEP ? await evl(SWEEP_PROBE) : await evl(PROBE);
chrome.kill("SIGKILL"); server.kill("SIGKILL");
try { await rm(profile, { recursive: true, force: true }); } catch (_) { /* ignore */ }

if (!r) { console.error("probe returned nothing"); process.exit(1); }
if (SWEEP) {
  console.log(`\nseed ${seed}: swept ${r.tested} ground points at ${r.step} m over ` +
              `x ${SWEEP[0]}..${SWEEP[2]}, z ${SWEEP[1]}..${SWEEP[3]}`);
  console.log(`  blocked: ${r.blocked} (${((r.blocked / r.tested) * 100).toFixed(1)}% of the ground)`);
  if (r.veh) {
    console.log(`  stopped by geometry ENTIRELY ABOVE THE CAR ROOF: ${r.ghost}`);
    console.log(`  ...of those, still blocked through cityCollideVehicle: ${r.stillBlocked}\n`);
  } else console.log(`  BLOCKED WITH NOTHING VISIBLE WITHIN ${r.clear} m: ${r.ghost}\n`);
  if (!r.ghost) { console.log("  no invisible walls on this ground\n"); }
  else {
    console.log("  clusters (contiguous blocked-but-empty ground):");
    for (const c of r.blobs) {
      console.log(`    ${String(c.n).padStart(5)} pts  ~${c.area} m2  centre (${c.x}, ${c.z})  ` +
                  `span ${c.w}x${c.d} m  nearest drawn thing ${c.far} m away`);
    }
  }
  console.log("");
  process.exit(0);
}
console.log(`\nseed ${seed}: ${r.drawn} drawn boxes, ${r.colliders} colliders (${r.checked} big enough to judge)`);
console.log(`INVISIBLE WALLS: ${r.ghosts} colliders reaching >0.45 m past anything drawn (${r.ghostArea} m2)\n`);
console.log("  by region:");
for (const [z, b] of Object.entries(r.byZone).sort((a, c) => c[1].area - a[1].area)) {
  console.log(`    ${z.padEnd(24)} ${String(b.n).padStart(5)} walls  ${String(b.area).padStart(7)} m2  WORST STANDOFF ${b.worst} m`);
}
console.log("\n  anchors resolved: " + JSON.stringify(r.anchors));
console.log("\n  clusters (one authored shape = one line):");
for (const c of r.clusters) {
  console.log(`    ${c.zone.padEnd(24)} ${String(c.n).padStart(4)} x ${c.w}x${c.d} m  y ${c.y0}..${c.y1}  standoff ${c.off} m  ${c.drawn ? c.drawn + " meshes in it" : "NOTHING DRAWN"}  eg (${c.at[0]}, ${c.at[1]})`);
}
console.log("\n  worst offenders:");
for (const g of r.top) {
  console.log(`    ${g.zone.padEnd(22)} (${g.x}, ${g.z})  ${g.w}x${g.d} m  y ${g.y0}..${g.y1}  standoff ${g.off} m  ${g.drawn ? g.drawn + " meshes" : "NOTHING DRAWN"}  ref=${g.ref || "-"}`);
}
if (maxArea != null && r.ghostArea > maxArea) {
  console.error(`\nFAILED: ${r.ghostArea} m2 of invisible wall (limit ${maxArea})`);
  process.exit(1);
}
console.log("");
