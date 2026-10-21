#!/usr/bin/env node
/* tools/island-ghost-colliders.mjs — EVERY INVISIBLE WALL ON THE DISASTER ISLAND.

   Owner: "There's this building with a fire escape on the side and it has an
   invisible wall to the left of it. Find invisible walls throughout the
   Natural Disaster game." An invisible wall is a collider you walk into with
   nothing drawn there, or one reaching past what is drawn.

   tools/ghost-collider-check.mjs asks the same question of Gang City, but it
   judges by mesh AABBs and a face STANDOFF capped at a box's half-depth, so a
   300 m wall with a building at one end scores as "seen" and a merged shell
   mesh (one AABB per building) excuses every box inside it. This one is
   finer, and it knows who built each box:

   1. WHO REGISTERED IT. A preload wraps CBZ.colliders.push before one line of
      game script runs, and stamps every record with the first two stack
      frames outside physics.js — "world/disaster_arena.js:3561" — so the
      report says which builder made the wall instead of where it stands.

   2. WHAT IS DRAWN, AS VOXELS. Every visible, non-transparent mesh's
      triangles are sampled onto a 0.5 m voxel set (surface samples, not
      bounding boxes: a merged building shell no longer covers its own
      courtyard). InstancedMesh contributes per-instance AABBs. Ground is
      skipped by what it IS: a mesh over 40 m both ways that is flatter than
      3 m or whose vertices hug the terrain, and anything over 1 km (sky,
      sea, backdrop). Standing on the terrain is not walking into it. Meshes that
      exist but are HIDDEN (visible=false anywhere up the chain) go into a
      second voxel set, so a box covered only by hidden geometry — the merge
      kept the original, a streamer culled it — is reported as such.

   3. THE VERDICT, per collider. Its footprint (oriented boxes in their own
      frame) is sampled every 0.5 m; a sample is COVERED when a visible voxel
      stands in the band a walker meets there (the box's own y0..y1 clipped to
      ground+0.3..ground+1.8, or that band for a full-height box). A collider
      is a GHOST when >= 0.75 m2 of its footprint is uncovered and coverage is
      under 85 %. Pure ghosts (0 %) and partials are reported apart.

      The PERIMETER metric asks the same of the box's edge only (what you
      walk into), so a hollow drawn shell is not a ghost for being hollow.

   4. THE SWEEP. The ledger only knows CBZ.colliders; moving walls and cars
      block through other paths. Every 1 m of the island a standing body is
      resolved through CBZ.collide, and every 2 m a sedan through
      city/vehicles.js's resolver; a contact with nothing drawn near it is
      reported with whoever pushed it.

   Also lists every collider whose LONGEST side exceeds 60 m, with its
   source (one wall across the map is one line, not lost among a thousand),
   and every brick building with a fire escape (the only grammar that hangs
   one) with the ghosts within 40 m of it. Prison boxes (_prison, stamped by
   core/prisonlazy.js) and city boxes (_city) are not solid on the island and
   are counted apart.

     node tools/island-ghost-colliders.mjs             # disaster.html
     node tools/island-ghost-colliders.mjs --url index.html
     node tools/island-ghost-colliders.mjs --near x,z,r  # one piece of ground
     node tools/island-ghost-colliders.mjs --json out.json
*/
import { writeFileSync } from "node:fs";
import { launch, sleep } from "./lib/cdp.mjs";

const argv = process.argv.slice(2);
const arg = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : d; };
const URL_REL = arg("--url", "disaster.html");
const SEED = arg("--seed", "90210");
const NEAR = (arg("--near", "") || "").split(",").map(Number).filter(Number.isFinite);
const JSON_OUT = arg("--json", "");
const TOP = +arg("--top", "30");

/* THE SOURCE STAMP. Runs before any game script. window.CBZ is created by
   src/config.js; the setter here catches that assignment and every later
   CBZ.colliders = [...] reassignment, and wraps push on each array. */
const PRELOAD = `(() => {
  function src() {
    const st = (new Error().stack || "").split("\\n").slice(2);
    const out = [];
    for (const l of st) {
      const m = l.match(/\\/src\\/([^?:)]+)(?:\\?[^:)]*)?:(\\d+)/);
      if (!m) continue;
      if (/systems\\/(physics|meshcollider)\\.js$/.test(m[1]) && !out.length) continue;
      out.push(m[1] + ":" + m[2]);
      if (out.length >= 2) break;
    }
    return out.join(" < ") || "?";
  }
  function wrap(a) {
    if (!a || a.__wrapped || !Array.isArray(a)) return a;
    const p = a.push;
    Object.defineProperty(a, "push", { configurable: true, writable: true, value: function () {
      const s = src();
      for (let i = 0; i < arguments.length; i++) {
        const c = arguments[i];
        if (c && typeof c === "object" && c.__src == null) {
          try { Object.defineProperty(c, "__src", { value: s, writable: true, configurable: true }); } catch (e) {}
        }
      }
      return p.apply(this, arguments);
    } });
    Object.defineProperty(a, "__wrapped", { value: true });
    return a;
  }
  function hookCBZ(o) {
    if (!o || o.__colHook) return o;
    Object.defineProperty(o, "__colHook", { value: true });
    let cols = wrap(o.colliders);
    Object.defineProperty(o, "colliders", { configurable: true, enumerable: true,
      get() { return cols; }, set(v) { cols = wrap(v); } });
    return o;
  }
  let _cbz = window.CBZ ? hookCBZ(window.CBZ) : undefined;
  Object.defineProperty(window, "CBZ", { configurable: true, enumerable: true,
    get() { return _cbz; }, set(v) { _cbz = hookCBZ(v); } });
})();`;

const PROBE = `(() => {
  const NEAR = ${JSON.stringify(NEAR.length === 3 ? NEAR : null)};
  const T0 = performance.now();
  const A = CBZ.surv && CBZ.surv.arena;
  const gAt = (x, z) => {
    try { const g = A && A.groundHeightAt ? A.groundHeightAt(x, z) : (CBZ.groundAt ? CBZ.groundAt(x, z) : 0); return isFinite(g) ? g : 0; }
    catch (e) { return 0; }
  };
  const V = 0.5, VY = 0.5;
  const key = (gx, gz, gy) => ((gx + 8192) * 16384 + (gz + 8192)) * 1024 + (gy + 256);
  // A V8 Set stops at 2^24 entries; a voxel store that rolls over to a new
  // shard instead of throwing (the first full run died at "Set maximum size")
  function VoxSet() { this.s = [new Set()]; }
  VoxSet.prototype.add = function (k) {
    let cur = this.s[this.s.length - 1];
    if (cur.size >= 16000000) { if (this.has(k)) return; cur = new Set(); this.s.push(cur); }
    cur.add(k);
  };
  VoxSet.prototype.has = function (k) { for (let i = 0; i < this.s.length; i++) if (this.s[i].has(k)) return true; return false; };
  Object.defineProperty(VoxSet.prototype, "size", { get: function () { let n = 0; for (const x of this.s) n += x.size; return n; } });
  const vis = new VoxSet(), hid = new VoxSet();
  function chainVisible(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
  function matDrawn(m) {
    const ms = Array.isArray(m) ? m : [m];
    for (const x of ms) {
      if (!x) continue;
      if (x.visible === false || x.colorWrite === false) continue;
      if (x.transparent && x.opacity < 0.08) continue;
      return true;
    }
    return false;
  }
  function markBox(set, x0, y0, z0, x1, y1, z1) {
    const gx0 = Math.floor(x0 / V), gx1 = Math.floor(x1 / V);
    const gz0 = Math.floor(z0 / V), gz1 = Math.floor(z1 / V);
    const gy0 = Math.floor(y0 / VY), gy1 = Math.floor(y1 / VY);
    if ((gx1 - gx0 + 1) * (gz1 - gz0 + 1) * (gy1 - gy0 + 1) > 40000) return;
    for (let a = gx0; a <= gx1; a++) for (let b = gz0; b <= gz1; b++) for (let c = gy0; c <= gy1; c++) set.add(key(a, b, c));
  }
  const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _b = new THREE.Box3();
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();
  let meshes = 0, tris = 0, skippedGround = 0, hiddenMeshes = 0;
  const S = 0.4;
  function markTri(set, a, b, c) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
    const lab = Math.hypot(abx, aby, abz), lac = Math.hypot(acx, acy, acz);
    const nu = Math.max(1, Math.ceil(lab / S)), nv = Math.max(1, Math.ceil(lac / S));
    if (nu * nv > 200000) return;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      for (let j = 0; j <= nv - Math.floor(u * nv); j++) {
        const w = j / nv;
        if (u + w > 1.0001) break;
        const x = a.x + abx * u + acx * w, y = a.y + aby * u + acy * w, z = a.z + abz * u + acz * w;
        set.add(key(Math.floor(x / V), Math.floor(z / V), Math.floor(y / VY)));
      }
    }
  }
  const MB = [];                 // every mesh's world AABB + why it does or does not count
  function noteMesh(o, b, why) {
    if (!isFinite(b.min.x)) return;
    MB.push({ n: (o.name || ((o.parent && o.parent.name ? o.parent.name + "/" : "") + o.type)).slice(0, 48), why: why,
      b: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z] });
  }
  CBZ.scene.updateMatrixWorld(true);
  CBZ.scene.traverse(function (o) {
    if (!(o.isMesh || o.isInstancedMesh) || o.isSprite || o.isPoints || o.isLine) return;
    const g = o.geometry; if (!g || !g.attributes || !g.attributes.position) return;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!o.isInstancedMesh) _b.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
    if (!matDrawn(o.material)) { if (!o.isInstancedMesh) noteMesh(o, _b, "material draws nothing"); return; }
    const shown = chainVisible(o);
    if (!o.isInstancedMesh) noteMesh(o, _b, shown ? "visible" : "hidden");
    const set = shown ? vis : hid;
    if (!shown) hiddenMeshes++;
    if (!g.boundingBox) g.computeBoundingBox();
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, _m); _m.premultiply(o.matrixWorld);
        _b.copy(g.boundingBox).applyMatrix4(_m);
        if (!isFinite(_b.min.x)) continue;
        markBox(set, _b.min.x, _b.min.y, _b.min.z, _b.max.x, _b.max.y, _b.max.z);
      }
      meshes++; return;
    }
    _b.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
    if (!isFinite(_b.min.x)) return;
    const ex = _b.max.x - _b.min.x, ez = _b.max.z - _b.min.z, ey = _b.max.y - _b.min.y;
    /* GROUND IS SKIPPED BY WHAT IT IS, NOT HOW BIG IT IS. The first pass
       dropped anything over 400 m both ways as "terrain or sea", and the
       island's dressing rock mesh (one draw, every boulder on the island)
       is that wide: 40 boulders were reported as ghosts standing in their
       own rock. A wide mesh is ground only when its vertices hug the
       terrain (or the sea plane). */
    // the sky dome, the sea, the far backdrop: kilometres across, never a wall
    // (the second full run died voxelizing one of them)
    if (ex > 1000 || ez > 1000) { skippedGround++; return; }
    if (ex > 40 && ez > 40) {
      const P0 = g.attributes.position, step = Math.max(1, Math.floor(P0.count / 300));
      let n = 0, low = 0;
      for (let i = 0; i < P0.count; i += step) {
        pa.fromBufferAttribute(P0, i).applyMatrix4(o.matrixWorld);
        const gg = gAt(pa.x, pa.z);
        n++; if (Math.abs(pa.y - gg) < 0.35 || (pa.y < 0.4 && gg < 0.4)) low++;
      }
      if (ey < 3 || low >= n * 0.8) { skippedGround++; return; }
    }
    meshes++;
    const P = g.attributes.position, I = g.index, mw = o.matrixWorld;
    const n = I ? I.count : P.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const i0 = I ? I.getX(t) : t, i1 = I ? I.getX(t + 1) : t + 1, i2 = I ? I.getX(t + 2) : t + 2;
      pa.fromBufferAttribute(P, i0).applyMatrix4(mw);
      pb.fromBufferAttribute(P, i1).applyMatrix4(mw);
      pc.fromBufferAttribute(P, i2).applyMatrix4(mw);
      markTri(set, pa, pb, pc); tris++;
    }
  });
  const tVox = performance.now() - T0;

  function bandAt(c, g) {
    let lo = g + 0.3, hi = g + 1.8;
    if (c.y0 != null) {
      const a = Math.max(lo, c.y0), b = Math.min(hi, c.y1);
      if (b > a) { lo = a; hi = b; } else { lo = c.y0; hi = c.y1; }
    }
    return [lo, hi];
  }
  function hitAt(set, x, z, lo, hi) {
    const gx = Math.floor(x / V), gz = Math.floor(z / V);
    const gy0 = Math.floor(lo / VY), gy1 = Math.floor(hi / VY);
    // one voxel of slack each way: a wall's faces sit at the collider's faces,
    // so a sample in the middle of a 0.3 m wall may fall in the next voxel over
    for (let gy = gy0; gy <= gy1; gy++) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++)
      if (set.has(key(gx + a, gz + b, gy))) return true;
    return false;
  }

  const cols = CBZ.colliders || [];
  const out = [], longs = [];
  const perimGhosts = {}, perimBySrc = {};
  if (A && !A.center) A.center = { x: (CBZ.SURV && CBZ.SURV.arena.cx) || 0, z: (CBZ.SURV && CBZ.SURV.arena.cz) || 600 };
  let checked = 0, cityOff = 0, prisonOff = 0;
  const prisonHidden = !!(CBZ.prisonRoot && CBZ.prisonRoot.visible === false);
  const bySrc = {};
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (!c || !isFinite(c.minX) || !isFinite(c.maxX) || !isFinite(c.minZ) || !isFinite(c.maxZ)) continue;
    if (c._city) { cityOff++; continue; }
    // core/prisonlazy.js stamps the prison's boxes; they are not solid while
    // the compound is hidden (systems/physics.js), so they are not walls here
    if (c._prison && prisonHidden) { prisonOff++; continue; }
    const ori = !!c.yaw;
    const hw = ori ? c.hw : (c.maxX - c.minX) / 2, hd = ori ? c.hd : (c.maxZ - c.minZ) / 2;
    const cx = ori ? c.cx : (c.minX + c.maxX) / 2, cz = ori ? c.cz : (c.minZ + c.maxZ) / 2;
    if (NEAR && Math.hypot(cx - NEAR[0], cz - NEAR[1]) > NEAR[2]) continue;
    const L = Math.max(hw, hd) * 2;
    const src = c.__src || "untagged";
    if (L > 60) longs.push({ i: i, src: src, cx: +cx.toFixed(1), cz: +cz.toFixed(1), w: +(hw * 2).toFixed(2), d: +(hd * 2).toFixed(2),
      yaw: ori ? +c.yaw.toFixed(3) : 0, y0: c.y0 == null ? null : +c.y0.toFixed(2), y1: c.y1 == null ? null : +c.y1.toFixed(2),
      ref: c.ref ? (c.ref.name || c.ref.type || "obj") : null, tag: c.tag || c.kind || c.src || null });
    const area = 4 * hw * hd;
    if (area < 0.25) continue;
    checked++;
    const co = Math.cos(c.yaw || 0), si = Math.sin(c.yaw || 0);
    let nu = Math.max(1, Math.ceil(hw * 2 / V)), nv = Math.max(1, Math.ceil(hd * 2 / V));
    while (nu * nv > 6000) { nu = Math.ceil(nu / 2); nv = Math.ceil(nv / 2); }
    let cov = 0, hidCov = 0, tot = 0;
    let ux0 = 1e9, ux1 = -1e9, uz0 = 1e9, uz1 = -1e9;
    for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
      const lx = -hw + (a + 0.5) * (hw * 2 / nu), lz = -hd + (b + 0.5) * (hd * 2 / nv);
      const x = ori ? cx + lx * co + lz * si : cx + lx;
      const z = ori ? cz - lx * si + lz * co : cz + lz;
      const g = gAt(x, z), bd = bandAt(c, g);
      tot++;
      if (hitAt(vis, x, z, bd[0], bd[1])) { cov++; continue; }
      if (hitAt(hid, x, z, bd[0], bd[1])) hidCov++;
      if (x < ux0) ux0 = x; if (x > ux1) ux1 = x; if (z < uz0) uz0 = z; if (z > uz1) uz1 = z;
    }
    // THE PERIMETER: what you walk INTO is the box's edge. A hollow drawn
    // shell (a barn, a house) is solid all through but seen all round.
    let pc = 0, pt = 0;
    {
      const ins = Math.min(0.2, hw * 0.5), ind = Math.min(0.2, hd * 0.5);
      const ring = function (lx, lz) {
        const x = ori ? cx + lx * co + lz * si : cx + lx;
        const z = ori ? cz - lx * si + lz * co : cz + lz;
        const bd = bandAt(c, gAt(x, z));
        pt++; if (hitAt(vis, x, z, bd[0], bd[1])) pc++;
      };
      const nx = Math.max(1, Math.round(hw * 2 / V)), nz = Math.max(1, Math.round(hd * 2 / V));
      const sx = Math.max(1, Math.ceil(nx / 600)), sz = Math.max(1, Math.ceil(nz / 600));
      for (let a = 0; a <= nx; a += sx) { const lx = -hw + ins + (hw * 2 - 2 * ins) * a / nx; ring(lx, -hd + ind); ring(lx, hd - ind); }
      for (let b2 = 1; b2 < nz; b2 += sz) { const lz = -hd + ind + (hd * 2 - 2 * ind) * b2 / nz; ring(-hw + ins, lz); ring(hw - ins, lz); }
    }
    const perim = pc / pt, perimLen = 4 * (hw + hd);
    const onIsland = A ? Math.hypot(cx - A.center.x, cz - A.center.z) < (A.radius || 240) + 60 : true;
    if (perimLen * (1 - perim) >= 1.0 && perim < 0.85) {
      const pk = onIsland ? "island" : "off-island";
      perimGhosts[pk] = (perimGhosts[pk] || 0) + 1;
      const pb = perimBySrc[src] || (perimBySrc[src] = { n: 0, island: 0, m: 0 });
      pb.n++; if (onIsland) pb.island++; pb.m += perimLen * (1 - perim);
    }
    const frac = cov / tot, unc = area * (1 - frac);
    const b = bySrc[src] || (bySrc[src] = { total: 0, ghost: 0, pure: 0, partial: 0, hiddenOnly: 0, area: 0 });
    b.total++;
    if (!(unc >= 0.75 && frac < 0.85)) continue;
    b.ghost++; b.area += unc;
    const pure = cov === 0;
    if (pure) b.pure++; else b.partial++;
    if (hidCov > (tot - cov) * 0.5) b.hiddenOnly++;
    out.push({ i: i, src: src, cx: +cx.toFixed(1), cz: +cz.toFixed(1), w: +(hw * 2).toFixed(2), d: +(hd * 2).toFixed(2),
      yaw: ori ? +c.yaw.toFixed(2) : 0, y0: c.y0 == null ? null : +c.y0.toFixed(1), y1: c.y1 == null ? null : +c.y1.toFixed(1),
      cover: +frac.toFixed(2), uncovered: +unc.toFixed(1), hiddenCover: +(hidCov / tot).toFixed(2),
      perim: +perim.toFixed(2), island: onIsland,
      emptySpan: [+ux0.toFixed(1), +uz0.toFixed(1), +ux1.toFixed(1), +uz1.toFixed(1)],
      ref: c.ref ? (c.ref.name || c.ref.type || "obj") : null });
  }
  for (const k in bySrc) bySrc[k].area = +bySrc[k].area.toFixed(1);
  for (const k in perimBySrc) perimBySrc[k].m = +perimBySrc[k].m.toFixed(1);
  // WHO IS THERE: for the island's ghosts, every mesh whose box meets the
  // collider's, and why it did or did not count as drawn
  for (const g of out) {
    if (!g.island) continue;
    const c = cols[g.i], seen = [];
    for (const m of MB) {
      const b = m.b;
      if (b[3] < c.minX - 0.3 || b[0] > c.maxX + 0.3 || b[5] < c.minZ - 0.3 || b[2] > c.maxZ + 0.3) continue;
      if (c.y0 != null && (b[4] < c.y0 - 0.5 || b[1] > c.y1 + 0.5)) continue;
      if ((b[3] - b[0]) > 150 && (b[5] - b[2]) > 150 && m.n.indexOf("dressing") < 0) continue;   // ground and sea meet everything
      seen.push(m.n + " [" + m.why + "] y " + b[1].toFixed(1) + ".." + b[4].toFixed(1));
      if (seen.length >= 6) break;
    }
    g.there = seen;
  }

  /* ---- THE SWEEP: walk the island, not the ledger ----------------------
     Every 1 m over the island's disc, a standing body (the player's radius,
     its body band) is resolved through CBZ.collide: the shipping resolver,
     moving walls and cars included. A point pushed by a CONTACT (no more
     than a body radius: met from outside, not standing deep inside a
     building) with no visible voxel within ~1 m is an invisible wall felt
     from open ground. Grouped into runs, each with the sources that pushed. */
  const sweep = { tested: 0, blocked: 0, ghost: 0, blobs: [] };
  if (A && CBZ.collide) {
    const R0 = (CBZ.TUNE && CBZ.TUNE.playerRadius) || 0.38;
    const RA = (A.radius || 240) + 25, X0 = A.center.x - RA, Z0 = A.center.z - RA, ST = 1.0;
    const p = { x: 0, y: 0, z: 0 }, q = { x: 0, y: 0, z: 0 };
    const hits = [], near = [];
    const hitNear2 = function (x, z, lo, hi) {
      const gx = Math.floor(x / V), gz = Math.floor(z / V);
      const gy0 = Math.floor(lo / VY), gy1 = Math.floor(hi / VY);
      for (let gy = gy0; gy <= gy1; gy++) for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++)
        if (vis.has(key(gx + a, gz + b, gy))) return true;
      return false;
    };
    for (let x = X0; x <= X0 + 2 * RA; x += ST) for (let z = Z0; z <= Z0 + 2 * RA; z += ST) {
      if (Math.hypot(x - A.center.x, z - A.center.z) > RA) continue;
      const gy = gAt(x, z);
      sweep.tested++;
      p.x = x; p.z = z; p.y = gy;
      CBZ.collide(p, R0, gy + 0.25, gy + 1.7);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < 1e-4) continue;
      sweep.blocked++;
      if (d > R0 + 0.1) continue;
      if (hitNear2(x, z, gy + 0.25, gy + 1.8)) continue;
      const who = new Set();
      CBZ.queryCollidersNear(x, z, R0 + 0.05, near);
      for (const c of near) {
        if (c._city || (c._prison && prisonHidden)) continue;
        if (c.y0 != null && (gy + 1.7 <= c.y0 || gy + 0.25 >= c.y1)) continue;
        let lx, lz, hw, hd;
        if (c.yaw) { const co = Math.cos(c.yaw), si = Math.sin(c.yaw), rx = x - c.cx, rz = z - c.cz; lx = rx * co - rz * si; lz = rx * si + rz * co; hw = c.hw; hd = c.hd; }
        else { hw = (c.maxX - c.minX) / 2; hd = (c.maxZ - c.minZ) / 2; lx = x - c.minX - hw; lz = z - c.minZ - hd; }
        const ex = Math.max(Math.abs(lx) - hw, 0), ez = Math.max(Math.abs(lz) - hd, 0);
        if (ex * ex + ez * ez < R0 * R0) who.add((c.__src || "untagged") + " " + (2 * hw).toFixed(1) + "x" + (2 * hd).toFixed(1));
      }
      if (!who.size && CBZ.mpCollide) { q.x = x; q.z = z; q.y = gy; CBZ.mpCollide(q, R0, gy + 0.25, gy + 1.7); if (Math.hypot(q.x - x, q.z - z) > 1e-4) who.add("moving-platform (mpCollide)"); }
      if (!who.size) who.add("car or other (not in the ledger)");
      sweep.ghost++;
      hits.push([x, z, Array.from(who)]);
    }
    /* THE SAME GROUND, DRIVEN. The island's cars run city/vehicles.js's
       resolver; a sedan parked at every 2 m point, heading north, is
       blocked by something with nothing drawn in or round its body. */
    const vhits = [];
    if (CBZ.cityCollideVehicle) {
      const car = { pos: { x: 0, y: 0, z: 0 }, heading: 0, v: 0, _visualDims: { width: 2.0, length: 4.4, height: 1.5, wheelbase: 2.7 } };
      const carDrawn = function (x, z, gy) {
        const gx0 = Math.floor((x - 1.5) / V), gx1 = Math.floor((x + 1.5) / V);
        const gz0 = Math.floor((z - 2.7) / V), gz1 = Math.floor((z + 2.7) / V);
        const gy0 = Math.floor((gy + 0.2) / VY), gy1 = Math.floor((gy + 1.9) / VY);
        for (let a = gx0; a <= gx1; a++) for (let b = gz0; b <= gz1; b++) for (let c = gy0; c <= gy1; c++) if (vis.has(key(a, b, c))) return true;
        return false;
      };
      for (let x = X0; x <= X0 + 2 * RA; x += 2) for (let z = Z0; z <= Z0 + 2 * RA; z += 2) {
        if (Math.hypot(x - A.center.x, z - A.center.z) > RA) continue;
        const gy = gAt(x, z);
        if (gy < 0.2) continue;                         // the sea: boats skip the wall resolver
        sweep.vTested = (sweep.vTested || 0) + 1;
        car.pos.x = x; car.pos.z = z; car.pos.y = gy; car._sweepX = null; car._sweepZ = null;
        let push = 0;
        try { push = CBZ.cityCollideVehicle(car); } catch (e) { push = 0; }
        if (!(push > 1e-4)) continue;
        if (Math.hypot(car.pos.x - x, car.pos.z - z) > 1.2) continue;     // parked deep inside something
        if (carDrawn(x, z, gy)) continue;
        const who = new Set();
        CBZ.queryCollidersNear(x, z, 2.6, near);
        for (const c of near) {
          if (c._city || (c._prison && prisonHidden)) continue;
          if (c.maxX < x - 1.0 || c.minX > x + 1.0 || c.maxZ < z - 2.2 || c.minZ > z + 2.2) continue;
          who.add((c.__src || "untagged") + " y " + (c.y0 == null ? "full" : (c.y0 - gy).toFixed(1) + ".." + (c.y1 - gy).toFixed(1)));
        }
        if (!who.size) who.add("car or other (not in the ledger)");
        vhits.push([x, z, Array.from(who)]);
      }
    }
    sweep.vGhost = vhits.length;
    const vs = {};
    for (const h of vhits) for (const w of h[2]) vs[w] = (vs[w] || 0) + 1;
    sweep.vSrcs = Object.entries(vs).sort((a, b) => b[1] - a[1]).slice(0, 25);
    sweep.vEg = vhits.slice(0, 12).map((h) => [h[0], h[1]]);

    const cell = ST * 1.5, occ = new Map(), kk = (a, b) => a * 100000 + b;
    for (const h of hits) occ.set(kk(Math.round(h[0] / cell), Math.round(h[1] / cell)), h);
    const done = new Set();
    for (const [k0] of occ) {
      if (done.has(k0)) continue;
      const stack = [k0]; done.add(k0);
      let n = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; const srcs = {};
      while (stack.length) {
        const k = stack.pop(), e = occ.get(k); if (!e) continue;
        n++; if (e[0] < x0) x0 = e[0]; if (e[0] > x1) x1 = e[0]; if (e[1] < z0) z0 = e[1]; if (e[1] > z1) z1 = e[1];
        for (const s2 of e[2]) srcs[s2] = (srcs[s2] || 0) + 1;
        const gx = Math.round(e[0] / cell), gz = Math.round(e[1] / cell);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const nk = kk(gx + a, gz + b); if (occ.has(nk) && !done.has(nk)) { done.add(nk); stack.push(nk); } }
      }
      sweep.blobs.push({ n: n, x0: +x0.toFixed(1), z0: +z0.toFixed(1), x1: +x1.toFixed(1), z1: +z1.toFixed(1), srcs: srcs });
    }
    sweep.hitsNear = function (x, z, r) {
      return hits.filter((h) => Math.hypot(h[0] - x, h[1] - z) < r).slice(0, 12).map((h) => [h[0], h[1], h[2].join(" + ")]);
    };
    sweep.blobs.sort((a, b) => b.n - a.n);
    sweep.blobs = sweep.blobs.slice(0, 40);
  }
  out.sort((a, b) => b.uncovered - a.uncovered);
  longs.sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d));
  // movement-blocking LOS meshes and moving walls are not in the ledger; say how many exist
  /* THE OWNER'S BUILDING: "a building with a fire escape on the side".
     On the island only the brick grammar hangs one (city/facades/brick.js,
     section 3: one flank, more than two storeys). Every such building, with
     every ghost collider and every swept ghost point within 40 m of it. */
  const fireEscapes = [];
  for (const b of (A && A.fragile) || []) {
    if (!b || b.facadeStyle !== "brick" || !(b.storeys > 2)) continue;
    const bx = b.ox != null ? b.ox : b.x, bz = b.oz != null ? b.oz : b.z;
    const nearG = out.filter((g) => Math.hypot(g.cx - bx, g.cz - bz) < 40).map((g) => [g.cx, g.cz, g.w + "x" + g.d, g.src]);
    const nearS = sweep.hitsNear ? sweep.hitsNear(bx, bz, 40) : [];
    fireEscapes.push({ x: +bx.toFixed(1), z: +bz.toFixed(1), w: b.w, d: b.d, storeys: b.storeys, fallen: !!b.fallen, ghosts: nearG, swept: nearS });
  }
  if (sweep.hitsNear) delete sweep.hitsNear;
  let mp = 0; try { mp = (CBZ.movingPlatforms || CBZ.mpList || []).length || 0; } catch (e) {}
  return { colliders: cols.length, checked: checked, cityOff: cityOff, meshes: meshes, tris: tris, hiddenMeshes: hiddenMeshes,
    skippedGround: skippedGround, voxVis: vis.size, voxHid: hid.size, msVox: Math.round(tVox), ms: Math.round(performance.now() - T0),
    ghosts: out.length, ghostArea: +out.reduce((s, g) => s + g.uncovered, 0).toFixed(0),
    pure: out.filter((g) => g.cover === 0).length, bySrc: bySrc, longs: longs.slice(0, 60), nLong: longs.length,
    all: out, mp: mp, perimGhosts: perimGhosts, perimBySrc: perimBySrc, sweep: sweep,
    prisonOff: prisonOff, prisonStamped: cols.filter((c) => c && c._prison).length, fireEscapes: fireEscapes,
    island: out.filter((g) => g.island).length, islandPure: out.filter((g) => g.island && g.cover === 0).length };
})()`;

const rig = await launch({ rafBudget: 1600, preload: PRELOAD });
let r = null;
try {
  // mode=survival so index.html (the six-game page) opens on the island too
  await rig.open(URL_REL, `seed=${SEED}&mode=survival`);
  if (!await rig.wait("window.CBZ && CBZ.game", 150000)) throw new Error("no engine");
  const playing = await rig.wait(`(() => {
    if (CBZ.game.state === 'playing' && CBZ.game.mode === 'survival') return true;
    const mb = document.querySelector('.mode-btn[data-mode="survival"]'); if (mb) mb.click();
    const pb = document.getElementById('playBtn'); if (pb) pb.click();
    return CBZ.game.state === 'playing' && CBZ.game.mode === 'survival';
  })()`, 300000, 300);
  if (!playing) throw new Error("never entered a survival match");
  await sleep(6000);
  // freeze the director so a disaster does not tear the island apart mid-census
  try { await rig.evl("window.__stopRaf && window.__stopRaf(); true"); } catch (_) {}
  const tagged = await rig.evl("(() => { const c = CBZ.colliders; let t = 0; for (const x of c) if (x && x.__src) t++; return [c.length, t]; })()");
  console.log(`colliders ${tagged[0]}, source-tagged ${tagged[1]}`);
  r = await rig.evl(PROBE);
} catch (e) {
  console.error("FAILED:", e.message);
  if (rig.errors.length) console.error(rig.errors.slice(0, 8).join("\n"));
} finally {
  await rig.close();
}
if (!r) process.exit(1);

console.log(`\n${URL_REL} seed ${SEED}: ${r.colliders} colliders (${r.checked} judged, ${r.cityOff} city-stamped and off here)`);
console.log(`drawn: ${r.meshes} meshes, ${r.tris} tris -> ${r.voxVis} visible voxels; ${r.hiddenMeshes} hidden meshes -> ${r.voxHid} voxels; ${r.skippedGround} ground slabs skipped (${r.msVox} ms voxelize, ${r.ms} ms total)`);
console.log(`\nGHOST COLLIDERS: ${r.ghosts} (${r.pure} with NOTHING drawn), ${r.ghostArea} m2 of empty footprint`);
console.log(`  on the island: ${r.island} (${r.islandPure} with nothing drawn); prison boxes stamped ${r.prisonStamped}, not solid while hidden: ${r.prisonOff}`);
console.log(`  by PERIMETER (what you walk into): ${JSON.stringify(r.perimGhosts)}\n`);
console.log("  by source (who pushed it):");
for (const [k, b] of Object.entries(r.bySrc).filter((e) => e[1].ghost).sort((a, b) => b[1].area - a[1].area)) {
  console.log(`    ${k.padEnd(64)} ${String(b.ghost).padStart(5)}/${String(b.total).padEnd(5)} ghost  pure ${String(b.pure).padStart(4)}  partial ${String(b.partial).padStart(4)}  hidden-only ${String(b.hiddenOnly).padStart(4)}  ${b.area} m2`);
}
console.log(`\n  colliders longer than 60 m: ${r.nLong}`);
for (const l of r.longs) {
  console.log(`    ${String(Math.max(l.w, l.d)).padStart(7)} m  (${l.cx}, ${l.cz})  ${l.w}x${l.d}  yaw ${l.yaw}  y ${l.y0}..${l.y1}  ${l.src}${l.tag ? "  tag=" + l.tag : ""}${l.ref ? "  ref=" + l.ref : ""}`);
}
console.log(`\n  worst ${TOP} by empty footprint:`);
for (const g of r.all.slice(0, TOP)) {
  console.log(`    (${g.cx}, ${g.cz})  ${g.w}x${g.d}${g.yaw ? " yaw " + g.yaw : ""}  y ${g.y0}..${g.y1}  cover ${g.cover}  empty ${g.uncovered} m2${g.hiddenCover ? "  hidden " + g.hiddenCover : ""}  ${g.src}${g.ref ? "  ref=" + g.ref : ""}`);
}
console.log("\n  perimeter ghosts by source:");
for (const [k, b] of Object.entries(r.perimBySrc).sort((a, c) => c[1].m - a[1].m).slice(0, 30)) {
  console.log(`    ${k.padEnd(64)} ${String(b.n).padStart(5)} (island ${b.island})  ${b.m} m of unseen edge`);
}
console.log("\n  island ghosts, and what is drawn there:");
for (const g of r.all.filter((g) => g.island).slice(0, TOP)) {
  console.log(`    (${g.cx}, ${g.cz})  ${g.w}x${g.d}  y ${g.y0}..${g.y1}  cover ${g.cover} perim ${g.perim}  ${g.src}`);
  for (const t of g.there || []) console.log(`        ${t}`);
}
const S = r.sweep;
console.log(`\n  SWEEP: ${S.tested} standing points at 1 m, ${S.blocked} touch a solid, ${S.ghost} touch one with nothing drawn within ~1 m`);
for (const b of S.blobs) {
  const L = Math.max(b.x1 - b.x0, b.z1 - b.z0).toFixed(0);
  console.log(`    ${String(b.n).padStart(5)} pts  x ${b.x0}..${b.x1}  z ${b.z0}..${b.z1}  (${L} m)  ${Object.entries(b.srcs).map((e) => e[0] + " x" + e[1]).join(", ")}`);
}
console.log(`\n  DRIVEN SWEEP: ${S.vTested || 0} sedan spots at 2 m, ${S.vGhost || 0} blocked with nothing drawn in or round the body`);
for (const [k, n] of S.vSrcs || []) console.log(`    ${String(n).padStart(5)}  ${k}`);
if (S.vEg && S.vEg.length) console.log(`    e.g. ${S.vEg.map((p) => "(" + p[0].toFixed(0) + ", " + p[1].toFixed(0) + ")").join(" ")}`);
console.log(`\n  brick buildings with a fire escape (more than two storeys): ${r.fireEscapes.length}`);
for (const f of r.fireEscapes) {
  console.log(`    (${f.x}, ${f.z})  ${f.w}x${f.d}  ${f.storeys} storeys${f.fallen ? "  FALLEN" : ""}  ghosts within 40 m: ${f.ghosts.length}  swept ghost points: ${f.swept.length}`);
  for (const g of f.ghosts) console.log(`        collider (${g[0]}, ${g[1]}) ${g[2]} ${g[3]}`);
  for (const h of f.swept) console.log(`        swept (${h[0]}, ${h[1]}) ${h[2]}`);
}
if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(r, null, 1)); console.log(`\nwrote ${JSON_OUT}`); }
console.log("");
