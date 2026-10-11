"use strict";
/* src/battle/arenas/cover.js — NPC War: COVER. Every thing on a battlefield a
   man can put between himself and a gun, as ONE registry the AI can ask.

   WHY. The arenas had colliders and nothing else. combat_iq walked the
   collider list for "the far side of a box" every second per man, which
   finds the yard's containers and nothing at all on the dunes: a crest is
   not a collider, a crater is not a collider, a log in a wood was not even
   built. So the ground's cover lives here, in three kinds that answer the
   same question:

     PROPS     real objects at real sizes, instanced, each with a collider
               (sandbag walls, hesco, jersey barriers, burnt-out cars,
               boulders, deadfall logs, dry-stone walls, round bales, rubble,
               containers). Each has hit points; a blast that beats them
               leaves rubble or nothing, and the collider goes with it.
     TERRAIN   points where the ground itself hides a man: the windward foot
               of a dune crest, the lip of a crater, the back of a berm, a
               hedge bank. Measured off MAP.groundAt (the same ground the men
               stand on and terrain sight cuts with), not authored.
     WALLS     the sides of every collider the venue already registered
               (the downtown's buildings, the yard's containers), so a real
               place's cover is in the same list as a placed one.

   A COVER POINT is { x, z, y, nx, nz, h, kind, low, rec }: stand at (x, z)
   and the cover is on the -n side of you, h metres of it above your feet
   (low = under 1.3 m: crouch or prone). It shields you from a threat T when
   (T - p) . n < 0, which is what near() and from() test.

   PUBLIC  CBZ.battleCover = {
     reset(), ground(fn)                          the arena's groundAt
     add(o) -> rec                                a prop: {x,z,yaw,hw,hd,h,kind,hp,rubbleH,onDestroy}
     terrain(x, z, nx, nz, h, kind)               a point the ground provides
     fromColliders(cx, cz, R)                     the venue's own walls
     scanGround(cx, cz, hx, hz, step, opts)       find terrain cover by measurement
     near(x, z, r, out, opts) -> points           opts: {threat:{x,z}, minH, maxH, kinds}
     from(x, z, tx, tz, r, opts) -> point|null    the best point that shields (x,z)'s
                                                  area from a threat at (tx,tz)
     damage(x, z, R, power) -> destroyed count
     stats(), list() }
   The arena's MAP record carries coverNear / coverFrom (the same function
   objects), so HOST.coverNear(...) is how the battle core asks. */

CBZ.battleCover = (function () {
  const recs = [];
  const pts = [];
  const grid = new Map();
  const CELL = 8;
  let ground = function () { return 0; };
  const counts = { props: 0, terrain: 0, walls: 0, destroyed: 0, queries: 0 };

  function cellKey(ix, iz) { return ix * 100003 + iz; }
  function addPoint(p) {
    p.alive = true;
    p.low = p.h < 1.3;
    pts.push(p);
    const k = cellKey(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
    let a = grid.get(k);
    if (!a) { a = []; grid.set(k, a); }
    a.push(p);
    if (p.rec) p.rec.pts.push(p);
    return p;
  }
  function reset() {
    recs.length = 0; pts.length = 0; grid.clear();
    counts.props = counts.terrain = counts.walls = counts.destroyed = counts.queries = 0;
  }

  /* the sides of an oriented box, every ~1.4 m, standing 0.55 m off it */
  function boxPoints(rec, x, z, yaw, hw, hd, h, kind) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // local +x is (c, -s) in world xz (rotation.y convention), local +z is (s, c)
    const ax = [c, -s], az = [s, c];
    const sides = [
      { n: ax, half: hd, along: az, off: hw },
      { n: [-ax[0], -ax[1]], half: hd, along: az, off: hw },
      { n: az, half: hw, along: ax, off: hd },
      { n: [-az[0], -az[1]], half: hw, along: ax, off: hd },
    ];
    for (let i = 0; i < 4; i++) {
      const S = sides[i];
      const n = Math.max(1, Math.round((S.half * 2) / 1.4));
      for (let k = 0; k < n; k++) {
        const t = n === 1 ? 0 : (k / (n - 1) - 0.5) * (S.half * 2 - 0.5);
        const px = x + S.n[0] * (S.off + 0.55) + S.along[0] * t;
        const pz = z + S.n[1] * (S.off + 0.55) + S.along[1] * t;
        addPoint({ x: px, z: pz, y: ground(px, pz), nx: S.n[0], nz: S.n[1], h: h, kind: kind, rec: rec });
      }
    }
  }

  /* A PROP. The collider is in world height, sunk to the lowest corner of the
     ground under it so a box on a slope never lets a round under its low
     end; `gy` rides on the record so a ground-relative reader (combat_iq's
     tallEnough) can measure the cover from the feet, not from sea level. */
  function add(o) {
    const yaw = o.yaw || 0;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let lo = Infinity, gy = o.gy != null ? o.gy : ground(o.x, o.z);
    if (o.gy == null) {
      for (let k = 0; k < 4; k++) {
        const lx = (k & 1 ? 1 : -1) * o.hw, lz = (k & 2 ? 1 : -1) * o.hd;
        const y = ground(o.x + lx * c + lz * s, o.z - lx * s + lz * c);
        if (y < lo) lo = y;
      }
    } else lo = gy;
    if (!isFinite(lo)) lo = gy;
    const rec = {
      kind: o.kind || "prop", x: o.x, z: o.z, yaw: yaw, hw: o.hw, hd: o.hd, h: o.h, gy: gy, base: lo,
      hp: o.hp == null ? 300 : o.hp, maxHp: o.hp == null ? 300 : o.hp, alive: true,
      rubbleH: o.rubbleH || 0, onDestroy: o.onDestroy || null, onHit: o.onHit || null,
      pts: [], col: null, data: o.data || null,
    };
    if (o.collide !== false && CBZ.micro && CBZ.micro.addBoxCollider) {
      const y0 = lo - 0.15, y1 = gy + o.h;
      rec.col = CBZ.micro.addBoxCollider(o.x, (y0 + y1) / 2, o.z, o.hw * 2, y1 - y0, o.hd * 2,
        { yaw: yaw, gy: gy, cover: rec, tag: "cover:" + rec.kind });
    }
    if (o.points !== false) boxPoints(rec, o.x, o.z, yaw, o.hw, o.hd, o.h, rec.kind);
    recs.push(rec);
    counts.props++;
    return rec;
  }

  function terrain(x, z, nx, nz, h, kind) {
    counts.terrain++;
    return addPoint({ x: x, z: z, y: ground(x, z), nx: nx, nz: nz, h: h, kind: kind || "crest", rec: null });
  }

  /* THE VENUE'S OWN WALLS. Every collider in the window that a standing man
     can hide behind (0.85 m of it above the ground there) gives its sides.
     Our own props are skipped: they already wrote their points. */
  function fromColliders(cx, cz, R) {
    const M = CBZ.micro;
    if (!M || !M.colliders) return 0;
    let n = 0;
    const list = M.colliders;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || b.cover || b.minX == null) continue;
      const mx = (b.minX + b.maxX) / 2, mz = (b.minZ + b.maxZ) / 2;
      if (Math.abs(mx - cx) > R || Math.abs(mz - cz) > R) continue;
      const g = ground(mx, mz);
      const y0 = b.y0 != null ? b.y0 : g - 1, y1 = b.y1 != null ? b.y1 : g + 30;
      const h = Math.min(30, y1 - g);
      if (h < 0.85 || y0 - g > 1.2) continue;             // a kerb, a rail, a roof edge
      const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
      if (w < 0.6 && d < 0.6) continue;                    // a post
      if (w > 400 || d > 400) continue;                    // a perimeter, not a wall to stand at
      if (b.yaw) boxPoints(null, b.cx, b.cz, b.yaw, b.hw, b.hd, h, "wall");
      else boxPoints(null, mx, mz, 0, w / 2, d / 2, h, "wall");
      n++;
    }
    counts.walls += n;
    return n;
  }

  /* TERRAIN COVER, BY MEASUREMENT. At every sample, look 2-7 m out in eight
     directions: where the ground rises at least `min` metres over the line a
     man's chest would make, that direction is covered. Only the strongest
     one or two directions per sample are kept, so a crest gives a line of
     points along its windward foot and not a fog of them. */
  const DIRS = [];
  for (let i = 0; i < 8; i++) DIRS.push([Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
  function scanGround(cx, cz, hx, hz, step, opts) {
    opts = opts || {};
    const min = opts.min || 0.9, kind = opts.kind || "crest";
    let n = 0;
    for (let x = cx - hx; x <= cx + hx; x += step) {
      for (let z = cz - hz; z <= cz + hz; z += step) {
        const g = ground(x, z);
        let b1 = 0, b1d = -1, b2 = 0, b2d = -1;
        for (let d = 0; d < 8; d++) {
          const D = DIRS[d];
          let rise = 0;
          for (let s = 2; s <= 7; s += 2.5) {
            const r = ground(x + D[0] * s, z + D[1] * s) - g;
            if (r > rise) rise = r;
          }
          if (rise > b1) { b2 = b1; b2d = b1d; b1 = rise; b1d = d; }
          else if (rise > b2) { b2 = rise; b2d = d; }
        }
        if (b1 >= min) {
          const D = DIRS[b1d];
          terrain(x, z, -D[0], -D[1], Math.min(3, b1), kind); n++;
          if (b2 >= min && Math.abs(b2d - b1d) >= 2 && Math.abs(b2d - b1d) <= 6) {
            const E = DIRS[b2d];
            terrain(x, z, -E[0], -E[1], Math.min(3, b2), kind); n++;
          }
        }
      }
    }
    return n;
  }

  const _out = [];
  function near(x, z, r, out, opts) {
    out = out || _out; out.length = 0;
    counts.queries++;
    opts = opts || {};
    const T = opts.threat, minH = opts.minH || 0, maxH = opts.maxH || 1e9, kinds = opts.kinds;
    const r2 = r * r;
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = grid.get(cellKey(i, j));
      if (!a) continue;
      for (let k = 0; k < a.length; k++) {
        const p = a[k];
        if (!p.alive || p.h < minH || p.h > maxH) continue;
        const dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz > r2) continue;
        if (kinds && kinds.indexOf(p.kind) < 0) continue;
        if (T) {
          const tx = T.x - p.x, tz = T.z - p.z, tl = Math.hypot(tx, tz) || 1;
          if ((tx * p.nx + tz * p.nz) / tl > -0.35) continue;      // the threat must be on the far side
        }
        out.push(p);
      }
    }
    return out;
  }
  // the one a man would run to: close, behind something, not toward the gun,
  // and taller cover preferred when it is no further
  function from(x, z, tx, tz, r, opts) {
    opts = opts || {};
    const list = near(x, z, r || 14, null, { threat: { x: tx, z: tz }, minH: opts.minH, kinds: opts.kinds });
    const dT = Math.hypot(x - tx, z - tz);
    let best = null, bs = 1e9;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const walk = Math.hypot(p.x - x, p.z - z);
      const closing = Math.max(0, dT - Math.hypot(p.x - tx, p.z - tz));
      const s = walk + closing * 1.4 - Math.min(2, p.h) * 1.2 + (p.taken || 0) * 3;
      if (s < bs) { bs = s; best = p; }
    }
    return best;
  }

  function destroy(rec) {
    if (!rec.alive) return;
    rec.alive = false;
    counts.destroyed++;
    for (let i = 0; i < rec.pts.length; i++) rec.pts[i].alive = false;
    if (rec.col && CBZ.micro && CBZ.micro.removeCollider) CBZ.micro.removeCollider(rec.col);
    rec.col = null;
    // what is left of a wall is a heap, and a heap is still low cover
    if (rec.rubbleH > 0.25) {
      const h = rec.rubbleH;
      if (CBZ.micro && CBZ.micro.addBoxCollider) {
        rec.col = CBZ.micro.addBoxCollider(rec.x, rec.base + (h + 0.15) / 2 - 0.15, rec.z, rec.hw * 2.1, h + 0.15, rec.hd * 2.3,
          { yaw: rec.yaw, gy: rec.gy, cover: rec, tag: "cover:rubble" });
      }
      boxPoints(rec, rec.x, rec.z, rec.yaw, rec.hw * 1.05, rec.hd * 1.15, h, "rubble");
    }
    if (rec.onDestroy) { try { rec.onDestroy(rec); } catch (e) { console.warn("[cover] onDestroy", e); } }
  }
  // a blast: everything inside R + its own size takes power x falloff
  function damage(x, z, R, power) {
    let n = 0;
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (!r.alive) continue;
      const size = Math.max(r.hw, r.hd);
      const d = Math.hypot(r.x - x, r.z - z);
      if (d > R + size) continue;
      const fall = 1 - Math.max(0, d - size * 0.5) / (R + size * 0.5);
      if (fall <= 0) continue;
      r.hp -= power * 140 * fall * fall;
      if (r.onHit) { try { r.onHit(r, fall); } catch (e) {} }
      if (r.hp <= 0) { destroy(r); n++; }
    }
    return n;
  }

  return {
    reset: reset,
    ground: function (fn) { if (typeof fn === "function") ground = fn; return ground; },
    add: add, terrain: terrain, fromColliders: fromColliders, scanGround: scanGround,
    near: near, from: from, damage: damage, destroy: destroy,
    list: function () { return recs; },
    points: function () { return pts; },
    stats: function () {
      let alive = 0, low = 0;
      for (let i = 0; i < pts.length; i++) if (pts[i].alive) { alive++; if (pts[i].low) low++; }
      return { props: counts.props, terrain: counts.terrain, walls: counts.walls, points: alive, low: low,
        destroyed: counts.destroyed, queries: counts.queries };
    },
  };
})();
