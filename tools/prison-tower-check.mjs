#!/usr/bin/env node
/* tools/prison-tower-check.mjs — IS THE TOWER WHAT IT LOOKS LIKE?

   Owner, 2026-09-29: "improve the realism of the towers, because right now
   you get up to them and then you can't even jump off to exit ... there's
   like this fake invisible wall. I hate invisible walls."

   Plain node, no browser. Loads the REAL three r128, config.js, prisonkit.js,
   ladderkit.js, yard.js, towers.js, the perimeter half of prisonwings.js and
   physics.js into a vm, and for every tower in CBZ.prisonTowers measures:

     1. SOLID vs DRAWN on the deck, at body height (feet+0.42 .. 1.8 m):
          GHOST   m2 solid that nothing drawn stands in  (an invisible wall)
          PHANTOM m2 drawn that nothing solid stands in   (walk-through steel)
        The drawn oracle is exact: every convex piece (box / cylinder /
        cone) is tested point-in-hull, inflated by TOL for thin rails.
     2. THE FLOOR: platform under a point <=> the deck plate is drawn there
          FLOAT   m2 of walkable air, HOLE m2 of drawn deck you fall through
     3. THE DECK IS ONE ROOM: flood fill from the ladder head with the body's
        radius; every walkway flat and the cab must be reached.
     4. THE WAY OFF: from each of the 8 walkway flats, facing out, the REAL
        traversal probe (physics.js characterTraversal) must go over the rail,
        and the body must have a clear fall to the ground. From the outer
        flats of a perimeter tower that ground must be OUTSIDE the prison.
     5. THE WAY UP: the climb record's foot and head stand on real floor,
        are not inside anything, and the shaft is clear from foot to hatch;
        the foot is walkable from the compound.

     node tools/prison-tower-check.mjs [--verbose]     exit 0 = ok      */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const VERBOSE = process.argv.includes("--verbose");

let fails = 0;
const rows = [];
function check(ok, name, detail) { rows.push({ ok, name, detail }); if (!ok) fails++; }

/* ---- the page, minus the page ---------------------------------------- */
const noop = () => {};
function ctx2d() {
  return new Proxy({}, {
    get(t, k) {
      if (k === "createImageData") return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === "getImageData") return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern") return () => ({ addColorStop: noop });
      if (k in t) return t[k];
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const el = () => ({
  style: {}, width: 0, height: 0, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  appendChild: noop, addEventListener: noop, removeEventListener: noop, setAttribute: noop,
  getContext: () => ctx2d(), querySelector: () => null, querySelectorAll: () => [],
});
const sandbox = {
  console, Math, JSON, Date, Map, Set, WeakMap, Float32Array, Uint8Array, Uint8ClampedArray, Uint16Array,
  Uint32Array, Int32Array, Int16Array, Int8Array, Float64Array, ArrayBuffer, DataView, Promise, Symbol, Proxy, Reflect,
  performance: { now: () => 0 }, setTimeout: noop, clearTimeout: noop, requestAnimationFrame: noop,
  navigator: { maxTouchPoints: 0, userAgent: "node" },
  location: { search: "", hash: "", href: "http://x/" },
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  document: {
    createElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    body: el(), head: el(), documentElement: el(), addEventListener: noop,
  },
  addEventListener: noop, removeEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }),
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
function run(path, soft) {
  try { vm.runInContext(read(path), ctx, { filename: path }); return true; }
  catch (e) { if (!soft) throw e; if (VERBOSE) console.log("  (soft) " + path + ": " + String(e.message).slice(0, 140)); return false; }
}
run("src/vendor/three.r128.min.js");
run("src/vendor/BufferGeometryUtils.js");
const THREE = sandbox.THREE;
run("src/config.js");
const CBZ = sandbox.CBZ;
CBZ.scene = new THREE.Scene();
CBZ.prisonRoot = CBZ.scene;
CBZ.onUpdate = noop; CBZ.onAlways = noop;
CBZ.game.mode = "escape";
const mats = new Map();
CBZ.mat = CBZ.cmat = (c) => { if (!mats.has(c)) mats.set(c, new THREE.MeshLambertMaterial({ color: c })); return mats.get(c); };
// world/materials.js addBox, verbatim semantics (solid -> collider, y0/y1 band)
CBZ.addBox = function (x, y, z, w, h, d, color, opts) {
  opts = opts || {};
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), CBZ.mat(color));
  m.position.set(x, y, z);
  CBZ.scene.add(m);
  if (opts.solid) {
    const col = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, ref: m };
    if (opts.y0 != null) col.y0 = opts.y0;
    if (opts.y1 != null) col.y1 = opts.y1;
    CBZ.colliders.push(col);
    m.userData.collider = col;
  }
  if (opts.blockLOS) CBZ.losBlockers.push(m);
  return m;
};
run("src/world/prisonkit.js");
run("src/world/ladderkit.js");
run("src/world/corridorkit.js");
run("src/world/yard.js");
run("src/world/razorwire.js", true);
run("src/world/towers.js");
// prisonwings.js builds the outer wall and the four corner towers in its first
// 220 lines; the rooms after that need half the game. Run it softly: what it
// throws on is after everything this check reads.
CBZ.roomShell = CBZ.roomShell || function () { throw new Error("rooms are not this check's business"); };
run("src/world/prisonwings.js", true);
// the escape-mode law's own outside test (systems/prisonlaw.js)
const lawSrc = read("src/systems/prisonlaw.js");
const oob = lawSrc.match(/function outOfBounds\(x, z\) \{([^}]*)\}/);
const outOfBounds = new Function("x", "z", oob[1]);

/* ---- physics.js, with a body to push around --------------------------- */
const player = { pos: new THREE.Vector3(), radius: 0.38, vy: 0, grounded: true, speed: 0 };
CBZ.player = player;
CBZ.playerChar = { group: new THREE.Group(), metric: { height: 1.8 } };
CBZ.keys = {};
CBZ.lerpAngle = (a, b, t) => a + (b - a) * t;
CBZ.animChar = noop;
CBZ.TUNE = CBZ.TUNE || { gravity: 22, jumpVel: 6.5, walkSpeed: 4.2, crouchSpeed: 2 };
CBZ.modeHas = () => true;
run("src/systems/physics.js");
run("src/systems/vitals.js", true);
CBZ.altExitZones = CBZ.altExitZones || [];
run("src/world/escape_routes.js", true);

/* ---- the drawn oracle ------------------------------------------------- */
CBZ.scene.updateMatrixWorld(true);
const HULLS = [];
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
CBZ.scene.traverse((m) => {
  if (!m.isMesh || !m.geometry) return;
  const t = m.geometry.type;
  if (t !== "BoxGeometry" && t !== "BoxBufferGeometry" && t !== "CylinderGeometry" && t !== "CylinderBufferGeometry" && t !== "ConeGeometry" && t !== "ConeBufferGeometry") return;
  if (m.material && m.material.transparent && m.material.opacity < 0.5 && t.indexOf("Box") < 0) return;
  const g = m.geometry, pos = g.attributes.position, idx = g.index;
  const W = m.matrixWorld;
  const pts = [];
  for (let i = 0; i < pos.count; i++) pts.push(_v.fromBufferAttribute(pos, i).applyMatrix4(W).clone());
  const planes = [];
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    _a.copy(pts[i1]).sub(pts[i0]); _b.copy(pts[i2]).sub(pts[i0]);
    const nn = _c.copy(_a).cross(_b);
    const L = nn.length(); if (L < 1e-9) continue;
    nn.multiplyScalar(1 / L);
    const d = nn.dot(pts[i0]);
    if (!planes.some((p) => Math.abs(p.n.x - nn.x) < 1e-4 && Math.abs(p.n.y - nn.y) < 1e-4 && Math.abs(p.n.z - nn.z) < 1e-4 && Math.abs(p.d - d) < 1e-4)) planes.push({ n: nn.clone(), d });
  }
  const bb = new THREE.Box3().setFromPoints(pts);
  if (planes.length >= 4) HULLS.push({ planes, bb, name: m.name || t });
});
let NEAR = HULLS;
function nearHulls(x0, x1, z0, z1) {
  NEAR = HULLS.filter((H) => H.bb.max.x > x0 - 0.2 && H.bb.min.x < x1 + 0.2 && H.bb.max.z > z0 - 0.2 && H.bb.min.z < z1 + 0.2);
}
function drawnAt(x, y, z, tol) {
  for (let i = 0; i < NEAR.length; i++) {
    const H = NEAR[i], bb = H.bb;
    if (x < bb.min.x - tol || x > bb.max.x + tol || y < bb.min.y - tol || y > bb.max.y + tol || z < bb.min.z - tol || z > bb.max.z + tol) continue;
    let inside = true;
    for (let k = 0; k < H.planes.length; k++) { const p = H.planes[k]; if (p.n.x * x + p.n.y * y + p.n.z * z - p.d > tol) { inside = false; break; } }
    if (inside) return true;
  }
  return false;
}
function drawnColumn(x, z, y0, y1, tol) {
  for (let y = y0; y <= y1 + 1e-6; y += 0.1) if (drawnAt(x, y, z, tol)) return true;
  return false;
}
// solid for a body whose feet are at `feet` (physics.js resolveCollisions: feet+STEP_SOLID .. feet+1.8)
function solidAt(x, z, feet, r) {
  const lo = feet + 0.42, hi = feet + 1.8;
  for (const c of CBZ.colliders) {
    if (c._city) continue;
    if (c.y0 != null && (hi <= c.y0 || lo >= c.y1)) continue;
    if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) continue;
    if (c.yaw) {
      // physics.js pushOut's oriented box: world -> local by the yaw
      const co = Math.cos(c.yaw), si = Math.sin(c.yaw), rx = x - c.cx, rz = z - c.cz;
      const lx = rx * co - rz * si, lz = rx * si + rz * co;
      const qx = Math.max(-c.hw, Math.min(lx, c.hw)), qz = Math.max(-c.hd, Math.min(lz, c.hd));
      if ((lx - qx) ** 2 + (lz - qz) ** 2 > r * r + 1e-9) continue;
      return c;
    }
    if (r > 0) {
      const cx = Math.max(c.minX, Math.min(x, c.maxX)), cz = Math.max(c.minZ, Math.min(z, c.maxZ));
      if ((x - cx) ** 2 + (z - cz) ** 2 > r * r) continue;
    }
    return c;
  }
  return null;
}
// the deck plate as drawn: an octagon of circumradius R turned PI/8 (flats on the axes and diagonals)
function inOct(dx, dz, R) {
  const a = R * Math.cos(Math.PI / 8);
  return Math.abs(dx) <= a && Math.abs(dz) <= a && Math.abs(dx) + Math.abs(dz) <= a * Math.SQRT2;
}

/* ---- the census, per tower -------------------------------------------- */
const TOWERS = CBZ.prisonTowers || [];
check(TOWERS.length === 12, "twelve towers built", TOWERS.length + " (8 wall + 4 perimeter corners)");
const STEP = 0.05, CELL = STEP * STEP;
let totGhost = 0, totPhantom = 0, totFloat = 0, totHole = 0;
// the tower doors stand OPEN for the reach tests (a door is a key question,
// not a geometry one): their leaf colliders come out
for (const d of CBZ._prisonDoorSpecs || []) {
  if (!/^tower-/.test(d.id || "")) continue;
  const c = d.col && d.col(), i = c ? CBZ.colliders.indexOf(c) : -1;
  if (i >= 0) CBZ.colliders.splice(i, 1);
}
if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
const towerDoors = (CBZ._prisonDoorSpecs || []).filter((d) => /^tower-/.test(d.id || "")).length;
check(towerDoors === TOWERS.length, "every tower has a real door at its foot (corridorkit)", towerDoors + " of " + TOWERS.length);
for (let ti = 0; ti < TOWERS.length; ti++) {
  const T = TOWERS[ti];
  const DECK_R = T.deckR || 3.25;
  nearHulls(T.x - DECK_R - 1, T.x + DECK_R + 1, T.z - DECK_R - 1, T.z + DECK_R + 1);
  const fl = T.floor, name = "tower " + ti + " (" + T.x.toFixed(1) + "," + T.z.toFixed(1) + ")";
  let ghost = 0, phantom = 0, float = 0, hole = 0;
  const ghostWho = new Map();
  const R = DECK_R + 0.6;
  for (let x = T.x - R; x <= T.x + R; x += STEP) {
    for (let z = T.z - R; z <= T.z + R; z += STEP) {
      const onDeck = inOct(x - T.x, z - T.z, DECK_R);
      const g = CBZ.groundAt(x, z, fl);
      const floor = Math.abs(g - fl) < 0.08;
      if (floor && !onDeck) float++;
      if (!floor && onDeck && inOct(x - T.x, z - T.z, DECK_R - 0.1)) {
        // the one hole a deck may have: the hatch, while its lid is up (it is down in a build)
        hole++;
      }
      if (!onDeck) continue;
      const s = solidAt(x, z, fl, 0);
      const d = drawnColumn(x, z, fl + 0.45, fl + 1.8, 0.0);
      if (s && !drawnColumn(x, z, fl + 0.45, fl + 1.8, 0.1)) {
        ghost++;
        const k = s.ref ? "wall/box " + (s.maxX - s.minX).toFixed(1) + "x" + (s.maxZ - s.minZ).toFixed(1) + (s.y0 != null ? " y" + s.y0.toFixed(1) + "-" + s.y1.toFixed(1) : " FULL-HEIGHT")
          : "band " + (s.y0 != null ? s.y0.toFixed(2) + "-" + s.y1.toFixed(2) : "FULL-HEIGHT");
        ghostWho.set(k, (ghostWho.get(k) || 0) + 1);
      }
      if (d && !s && !solidAt(x, z, fl, 0.1)) phantom++;
    }
  }
  // the same census at the foot (feet on the ground), round the shaft and the wall
  let gGhost = 0, gPhantom = 0;
  const doorBox = (CBZ._prisonDoorSpecs || []).filter((d) => /^tower-/.test(d.id || "")).map((d) => d.at());
  for (let x = T.x - R; x <= T.x + R; x += STEP) {
    for (let z = T.z - R; z <= T.z + R; z += STEP) {
      if (doorBox.some((d) => Math.hypot(x - d.x, z - d.z) < 1.0)) continue;   // the door leaf's own swing (its collider is out for the reach test)
      const s0 = solidAt(x, z, 0, 0);
      if (s0 && !drawnColumn(x, z, 0.45, 1.8, 0.1)) gGhost++;
      else if (!s0 && drawnColumn(x, z, 0.45, 1.8, 0) && !solidAt(x, z, 0, 0.1)) gPhantom++;
    }
  }
  check(gGhost * CELL < 0.05, name + " no invisible wall at the foot", "ghost " + (gGhost * CELL).toFixed(2) + " m2, phantom " + (gPhantom * CELL).toFixed(2) + " m2 (the ladder's rungs are climbed, not walked into)");
  totGhost += gGhost * CELL;
  totGhost += ghost * CELL; totPhantom += phantom * CELL; totFloat += float * CELL; totHole += hole * CELL;
  const who = [...ghostWho.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0] + " " + (e[1] * CELL).toFixed(2) + "m2").join("; ");
  check(ghost * CELL < 0.05, name + " no invisible wall on the deck", "ghost " + (ghost * CELL).toFixed(2) + " m2" + (who ? " <- " + who : ""));
  check(phantom * CELL < 0.3, name + " nothing drawn you walk through", "phantom " + (phantom * CELL).toFixed(2) + " m2");
  check(float * CELL < 0.1 && hole * CELL < 0.1, name + " floor == drawn deck", "float " + (float * CELL).toFixed(2) + " m2, hole " + (hole * CELL).toFixed(2) + " m2");

  /* 3. one room: flood at 0.1 m from the ladder head, body radius 0.38 */
  const L = (CBZ.ladderSpecs || []).find((s) => s.meta === T);
  const head = L ? L.top : T.head;
  const G = 0.1, N = Math.ceil((2 * R) / G);
  const key = (i, j) => i * N + j;
  const ok = (i, j) => {
    const x = T.x - R + i * G, z = T.z - R + j * G;
    return Math.abs(CBZ.groundAt(x, z, fl) - fl) < 0.08 && !solidAt(x, z, fl, 0.38);
  };
  const seen = new Set();
  const si = Math.round((head.x - (T.x - R)) / G), sj = Math.round((head.z - (T.z - R)) / G);
  const q = [];
  if (ok(si, sj)) { q.push([si, sj]); seen.add(key(si, sj)); }
  while (q.length) {
    const [i, j] = q.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= N || b >= N || seen.has(key(a, b))) continue;
      if (!ok(a, b)) continue;
      seen.add(key(a, b)); q.push([a, b]);
    }
  }
  const reachAt = (x, z) => {
    let best = false;
    for (let di = -3; di <= 3 && !best; di++) for (let dj = -3; dj <= 3 && !best; dj++) {
      if (seen.has(key(Math.round((x - (T.x - R)) / G) + di, Math.round((z - (T.z - R)) / G) + dj))) best = true;
    }
    return best;
  };
  const flats = [];
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    flats.push({ a, x: T.x + Math.cos(a) * 2.5, z: T.z + Math.sin(a) * 2.5, nx: Math.cos(a), nz: Math.sin(a) });
  }
  const walkReached = flats.filter((f) => reachAt(f.x, f.z)).length;
  check(!!L && seen.size > 0, name + " ladder head stands on the deck", L ? "head (" + head.x.toFixed(2) + "," + head.z.toFixed(2) + ")" : "no climb record");
  check(walkReached === 8 && reachAt(T.x + T.face.x * 0.6, T.z + T.face.z * 0.6), name + " the whole deck is one room",
    walkReached + "/8 walkway flats, cab " + (reachAt(T.x + T.face.x * 0.6, T.z + T.face.z * 0.6) ? "yes" : "NO") + ", " + (seen.size * G * G).toFixed(1) + " m2 reached");

  /* 4. the way off, off every flat */
  let over = 0, outside = 0, outsideWant = 0, drops = [];
  const pn = T.perimeter, best = pn ? Math.max(...flats.map((f) => f.nx * pn.x + f.nz * pn.z)) : 0;
  for (const f of flats) {
    player.pos.set(f.x, fl, f.z); player.grounded = true; player._traversal = null; player.dead = false;
    CBZ.characterTraversal.clearWhy();
    const s = CBZ.characterTraversal.probe(player, CBZ.playerChar, f.nx, f.nz, { speed: 4.2, radius: 0.38, height: 1.8, allowTop: true, sprinting: false });
    if (!s && process.env.DBG) {
      const ex = f.x + f.nx * 1.4, ez = f.z + f.nz * 1.4;
      for (const c of CBZ.colliders) if (c.maxX > ex - 1 && c.minX < ex + 1 && c.maxZ > ez - 1 && c.minZ < ez + 1 && (c.y0 == null || c.y1 > fl)) console.log("DBG", ti, JSON.stringify({ minX: c.minX, maxX: c.maxX, minZ: c.minZ, maxZ: c.maxZ, y0: c.y0, y1: c.y1, rail: c.rail }));
    }
    if (!s) { drops.push("flat " + Math.round(f.a * 180 / Math.PI) + ": no move (" + JSON.stringify(CBZ.characterTraversal.stats().why) + ")"); continue; }
    const ex = s.endX, ez = s.endZ;
    const rr = Math.hypot(ex - T.x, ez - T.z);
    const beyond = rr > DECK_R * Math.cos(Math.PI / 8) + 0.1;
    // the fall: from the end of the move to whatever floor is under it, clear all the way
    const land = CBZ.groundAt(ex, ez, s.endY);
    let clear = true;
    for (let y = land; y < s.endY; y += 0.25) if (solidAt(ex, ez, y, 0.3)) { clear = false; break; }
    if (beyond && clear && land < fl - 2) over++;
    const out = outOfBounds(ex, ez);
    const wantOut = !!pn && (f.nx * pn.x + f.nz * pn.z) > best - 0.01;
    if (wantOut) {
      outsideWant++;
      // and from where you land, away from the wall into the field: nothing in the way
      let run = true, won = false, runM = 0;
      const zone = (CBZ.altExitZones || []).find((z) => z.kind === "wall");
      for (let k = 0; k <= 60 && !won; k++) {
        const q = k * 0.5, qx = ex + f.nx * q, qz = ez + f.nz * q;
        if (solidAt(qx, qz, 0, 0.38)) { run = false; break; }
        if (zone && zone.test(qx, qz)) { won = true; runM = q; }
      }
      if (won) drops.push("out after a " + runM.toFixed(1) + " m run");
      if (out && beyond && clear && run && won) outside++;
      else drops.push("OUT-FAIL out " + out + " beyond " + beyond + " clear " + clear + " run " + run + " won " + won);
    }
    drops.push("flat " + Math.round(f.a * 180 / Math.PI) + ": " + s.kind + " -> (" + ex.toFixed(1) + "," + ez.toFixed(1) + ") endY " + s.endY.toFixed(2) + " land " + land.toFixed(2) + (clear ? "" : " BLOCKED") + (out ? " OUTSIDE" : ""));
  }
  check(over === 8, name + " over the rail and down, off all 8 flats", over + "/8" + (VERBOSE || over < 8 ? " | " + drops.join(" | ") : ""));
  if (T.perimeter) check(outsideWant > 0 && outside === outsideWant, name + " a perimeter tower drops you OUTSIDE the wall, and the field beyond is the way out",
    outside + "/" + outsideWant + " outer flats land outside, the run into the field is clear and 'over the wall' wins at its end" + (outside < outsideWant ? " | " + drops.join(" | ") : ""));

  /* 5. the way up */
  if (L) {
    const fg = CBZ.groundAt(L.bottom.x, L.bottom.z, L.y0 + 0.3);
    check(Math.abs(fg - L.y0) < 0.1 && !solidAt(L.bottom.x, L.bottom.z, L.y0, 0.3), name + " the ladder foot is floor",
      "y0 " + L.y0.toFixed(2) + " floor " + fg.toFixed(2));
    const hg = CBZ.groundAt(L.top.x, L.top.z, L.y1);
    check(Math.abs(hg - L.y1) < 0.1 && !solidAt(L.top.x, L.top.z, L.y1, 0.3), name + " the ladder head is floor", "y1 " + L.y1.toFixed(2) + " floor " + hg.toFixed(2));
    const cx = L.x + L.nx * (L.stand || 0.42), cz = L.z + L.nz * (L.stand || 0.42);
    let shaftClear = true, where = "";
    for (let y = L.y0; y < L.y1 - 0.2; y += 0.3) { const c = solidAt(cx, cz, y, 0.2); if (c) { shaftClear = false; where = "y " + y.toFixed(1); break; } }
    check(shaftClear, name + " the climb column is clear foot to hatch", where || "clear");
    // walk to the foot from the compound, 7 m in along the face
    const sx = T.x + T.face.x * 7, sz = T.z + T.face.z * 7;
    const GG = 0.2, RR = 9, NN = Math.ceil(2 * RR / GG);
    const k2 = (i, j) => i * NN + j, cx0 = (L.bottom.x + sx) / 2 - RR, cz0 = (L.bottom.z + sz) / 2 - RR;
    const ok2 = (i, j) => { const x = cx0 + i * GG, z = cz0 + j * GG; return CBZ.groundAt(x, z, L.y0 + 0.3) < L.y0 + 0.5 && !solidAt(x, z, CBZ.groundAt(x, z, L.y0 + 0.3), 0.38); };
    const s2 = new Set(), q2 = [];
    const a0 = Math.round((sx - cx0) / GG), b0 = Math.round((sz - cz0) / GG);
    if (ok2(a0, b0)) { q2.push([a0, b0]); s2.add(k2(a0, b0)); }
    while (q2.length) {
      const [i, j] = q2.pop();
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= NN || b >= NN || s2.has(k2(a, b)) || !ok2(a, b)) continue;
        s2.add(k2(a, b)); q2.push([a, b]);
      }
    }
    const fi = Math.round((L.bottom.x - cx0) / GG), fj = Math.round((L.bottom.z - cz0) / GG);
    let footReached = false;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (s2.has(k2(fi + di, fj + dj))) footReached = true;
    check(footReached, name + " you can walk to the ladder foot", footReached ? "from 7 m in" : "sealed");
  }
}
/* ---- the rest of the route, off the towers ----------------------------- */
{
  const doors = (CBZ._prisonDoorSpecs || []).filter((d) => /^tower-/.test(d.id || ""));
  check(doors.length && doors.every((d) => d.keyed), "tower doors lock (Corridor Key, the post officer's belt)", doors.length + " keyed");
  const econ = read("src/systems/economy.js");
  check(/post === "tower"\)[^\n]*Corridor Key/.test(econ), "the tower post carries the Corridor Key", "economy.js rollLoadout");
  const V = CBZ.vitals;
  if (V && V.fall) {
    const who = { isPlayer: false, pos: { x: 0, y: 0, z: 0 } };
    const m0 = V.speedMul(who);
    V.fall(who, 12.75);
    const m1 = V.speedMul(who);
    V.dress(who, {});
    const m2 = V.speedMul(who);
    check(m0 === 1 && m1 < 0.5 && m2 > 0.7 && m2 < 0.85, "a tower drop breaks your legs; a splint gets you walking",
      "speed x" + m0 + " -> x" + m1.toFixed(2) + " after 12.75 m -> x" + m2.toFixed(2) + " splinted");
  } else check(false, "vitals.js loads for the fall check", "no CBZ.vitals.fall");
  const cap = read("src/systems/capture.js"), phy = read("src/systems/physics.js"), clm = read("src/systems/climb.js");
  check(/CBZ\.prisonFallLand = function/.test(cap) && /CBZ\.prisonFallLand\(/.test(phy) && /CBZ\.prisonFallLand\(/.test(clm) && !/weapon: "fall"/.test(clm),
    "one fall rule in the prison (capture.js), fed by physics.js and climb.js", "no fall as a bullet wound");
  const zone = (CBZ.altExitZones || []).find((z) => z.kind === "wall");
  check(!!zone && zone.test(-150, 0) && zone.test(0, 150) && !zone.test(0, 0) && !zone.test(-126, 0), "'over the wall' is a way out, and only clear of the wall", zone ? "x<-138 | x>138 | z<-130 | z>142" : "missing");
  // the walls under the towers are as tall as they are drawn, and no taller
  const walls = CBZ.colliders.filter((c) => c.ref && c.noClimb && c.y1 > 10);
  check(walls.length > 10 && walls.every((c) => c.y0 === 0 && c.y1 <= 12.1), "perimeter + division walls stop at the wire", walls.length + " wall colliders, top " + Math.max(...walls.map((c) => c.y1)).toFixed(2) + " m");
}
console.log("");
for (const r of rows) console.log((r.ok ? "  ok   " : "  FAIL ") + r.name + (r.detail ? "  — " + r.detail : ""));
console.log("\n  TOTAL ghost " + totGhost.toFixed(2) + " m2 · phantom " + totPhantom.toFixed(2) + " m2 · floating floor " + totFloat.toFixed(2) + " m2 · deck holes " + totHole.toFixed(2) + " m2");
console.log(fails ? "\n" + fails + " FAIL" : "\nall ok");
process.exit(fails ? 1 : 0);
