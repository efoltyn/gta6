/* ============================================================
   systems/solidground.js — THE GROUND IS A SOLID, AND ITS STATE IS
   BASE FIELD MINUS CARVINGS.

   Everything this game wants underground — a sinkhole, a bomb crater, a bunker
   with the street intact over it, a prison tunnel, a mine — is the same
   operation: SUBTRACT A VOLUME FROM A SOLID. Not four features, one.

   The default column at any (x,z) is a single implicit span [-inf, base(x,z)].
   It costs no bytes and no time; better than 99.99% of the world is that
   forever. A carving removes a volume from it, and what is LEFT is the answer:

       no carving        [-inf, base]                  ordinary ground
       open cylinder     [-inf, floor]                 a shaft you fall into
       buried box        [-inf, y0] and [y1, base]     A LID — street above,
                                                       room below, both solid

   THE LID IS NEVER STORED. It is what subtraction LEAVES above a closed
   carving. That is the whole trick, and it is why this is one registry rather
   than a "voids" list running beside the shaft list: a crater, a shaft and a
   bunker room are the SAME RECORD, differing only in whether the removed volume
   reaches the surface.

   OWNERSHIP INVERSION — THE PART THAT DELETES A BUG CLASS
   -------------------------------------------------------
   CBZ.floorAt used to have FIVE assignment sites and no owner: city/mode.js
   twice, modes/survival.js, modes/gungame.js and world/groundshaft.js, each
   capturing the previous one and marking itself (_city, _shaft, _gungame) so
   the next reset would not capture ITSELF and recurse. That dance existed only
   because nobody owned the function. city/mode.js's own comment records what it
   cost: "every non-city floorAt call recursed to a stack overflow (the prison
   leg after a city visit crashed the update loop every frame)".

   So: THIS FILE OWNS CBZ.floorAt, permanently and alone. Modes register a base
   field for their mode; everything else registers carvings. No wrappers, no
   markers, no capture, no recursion to be possible.

   THE SIGNATURE, STATED AS LAW
   ----------------------------
     floorAt(x, z, fromY) returns the highest solid top at (x,z) that is
     <= fromY + STEP_UP. Omit fromY and it is +infinity — "seen from the sky".

   That default was chosen so every existing caller becomes CORRECT, not merely
   unbroken (measured: 197 call sites, none passing a third argument):
     · a car's wheel, 2-arg, over an intact lid reads the STREET — a car belongs
       on the road above a bunker. Over an open shaft the topmost solid IS the
       shaft floor, so it still falls in. Today's behaviour, no special case.
     · an actor goes through physics.js groundAt(x, z, fromY), which has always
       passed fromY, so a guard standing in a bunker gets the room floor free.
     · spawn clamps and nav, 2-arg, get the surface. Nothing lands underground
       by accident; going below is only possible by asking to.

   ZERO CARVINGS IS BYTE-IDENTICAL TO BEFORE. One integer test and the base
   field's own answer, unchanged. That is what makes the swap safe to land
   before anything uses it — and tools/ground-check.mjs pins it.

   Ratchet: CBZ.solidAudit().
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.SOLID_GROUND == null) CBZ.CONFIG.SOLID_GROUND = true;

  const STEP_UP = 0.45;          // mirrors systems/physics.js — a kerb, not a flight
  const carvings = CBZ.carvings = [];
  const bases = Object.create(null);
  let nextId = 1;

  function mode() { return (CBZ.game && CBZ.game.mode) || null; }
  function base(x, z) {
    const f = bases[mode()];
    if (!f) return 0;
    const y = +f(x, z);
    return Number.isFinite(y) ? y : 0;
  }
  /* A mode declares the ground it was built on ONCE. It does not wrap anything,
     it does not capture anything, and a mode that registers nothing reads 0 —
     which is exactly what the old wrapper chain's `: 0` tail did for the
     prison. */
  CBZ.registerGroundBase = function (modeName, fn) {
    if (!modeName) return false;
    if (typeof fn !== "function") { delete bases[modeName]; return true; }
    bases[modeName] = fn;
    return true;
  };
  CBZ.groundBaseAt = base;       // the field with NOTHING subtracted

  /* ---- carvings -----------------------------------------------------------
     kind "cyl"  : { x, z, r }              a shaft, a crater, a mine head
     kind "box"  : { cx, cz, hw, hd, yaw }  a room (yaw in radians)
     kind "tube" : { pts:[{x,y,z}...], r }  a tunnel, a culvert
     y0/y1 are the REMOVED span. y1 at or above the surface = open to the sky;
     y1 below it leaves a lid. `floorFn(x,z)` optionally shapes the solid top
     beneath the void (a shaft's rubble cone and spiral stair come through it,
     so that math stays in world/groundshaft.js and is never written twice). */
  function bbox(c) {
    if (c.kind === "cyl") { c._x0 = c.x - c.r; c._x1 = c.x + c.r; c._z0 = c.z - c.r; c._z1 = c.z + c.r; return; }
    if (c.kind === "box") {
      const e = Math.abs(c.hw) + Math.abs(c.hd);
      c._x0 = c.cx - e; c._x1 = c.cx + e; c._z0 = c.cz - e; c._z1 = c.cz + e; return;
    }
    if (c.kind === "tube") {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < c.pts.length; i++) {
        const p = c.pts[i];
        if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
        if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z;
      }
      c._x0 = x0 - c.r; c._x1 = x1 + c.r; c._z0 = z0 - c.r; c._z1 = z1 + c.r; return;
    }
    c._x0 = c._x1 = c._z0 = c._z1 = 0;
  }
  CBZ.addCarving = function (spec) {
    if (!spec) return null;
    const c = spec;
    c.id = nextId++;
    if (c.open == null) c.open = true;
    if (c.dry == null) c.dry = true;
    bbox(c);
    carvings.push(c);
    return c;
  };
  CBZ.removeCarving = function (idOrRec) {
    const id = (idOrRec && idOrRec.id != null) ? idOrRec.id : idOrRec;
    for (let i = 0; i < carvings.length; i++) {
      if (carvings[i].id === id) { carvings.splice(i, 1); return true; }
    }
    return false;
  };
  CBZ.carvingById = function (id) {
    for (let i = 0; i < carvings.length; i++) if (carvings[i].id === id) return carvings[i];
    return null;
  };

  // ---- is (x,z) inside a carving's footprint, and how deep is its floor ----
  function covers(c, x, z) {
    if (x < c._x0 || x > c._x1 || z < c._z0 || z > c._z1) return false;
    if (c.kind === "cyl") { const dx = x - c.x, dz = z - c.z; return dx * dx + dz * dz < c.r * c.r; }
    if (c.kind === "box") {
      const dx = x - c.cx, dz = z - c.cz;
      if (!c.yaw) return Math.abs(dx) < c.hw && Math.abs(dz) < c.hd;
      const co = Math.cos(-c.yaw), si = Math.sin(-c.yaw);
      return Math.abs(dx * co - dz * si) < c.hw && Math.abs(dx * si + dz * co) < c.hd;
    }
    if (c.kind === "tube") {
      const P = c.pts, r2 = c.r * c.r;
      for (let i = 0; i < P.length - 1; i++) {
        const ax = P[i].x, az = P[i].z, bx = P[i + 1].x, bz = P[i + 1].z;
        const ex = bx - ax, ez = bz - az;
        const L2 = ex * ex + ez * ez;
        let t = L2 > 0 ? ((x - ax) * ex + (z - az) * ez) / L2 : 0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const px = ax + ex * t - x, pz = az + ez * t - z;
        if (px * px + pz * pz < r2) return true;
      }
      return false;
    }
    return false;
  }
  // the solid top BENEATH the void: its floor, shaped if the owner shapes it
  function voidFloor(c, x, z) {
    if (c.floorFn) { const y = c.floorFn(x, z); if (y != null && Number.isFinite(y)) return y; }
    return c.y0;
  }
  // the top of the void — for a tube, the swept radius above its axis
  function voidTop(c, x, z) {
    if (c.kind !== "tube") return c.y1;
    const P = c.pts, r2 = c.r * c.r;
    let best = -Infinity;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      const ex = b.x - a.x, ez = b.z - a.z;
      const L2 = ex * ex + ez * ez;
      let t = L2 > 0 ? ((x - a.x) * ex + (z - a.z) * ez) / L2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = a.x + ex * t - x, pz = a.z + ez * t - z;
      const d2 = px * px + pz * pz;
      if (d2 >= r2) continue;
      const y = a.y + (b.y - a.y) * t + Math.sqrt(r2 - d2);
      if (y > best) best = y;
    }
    return best === -Infinity ? c.y1 : best;
  }

  /* ---- SPAN SUBTRACTION — the only new arithmetic in this file.
     Start from one span, cut each covering carving out of it. Scratch arrays,
     no allocation: floorAt is called per wheel per frame. */
  const MAXSP = 8;
  const topA = new Float64Array(MAXSP), botA = new Float64Array(MAXSP);
  const topB = new Float64Array(MAXSP), botB = new Float64Array(MAXSP);
  let nSpan = 0;
  function spansAt(x, z, b) {
    let curT = topA, curB = botA, altT = topB, altB = botB;
    curT[0] = b; curB[0] = -Infinity; nSpan = 1;
    for (let i = 0; i < carvings.length; i++) {
      const c = carvings[i];
      if (x < c._x0 || x > c._x1 || z < c._z0 || z > c._z1) continue;
      if (!covers(c, x, z)) continue;
      const lo = voidFloor(c, x, z), hi = voidTop(c, x, z);
      if (!(hi > lo)) continue;
      let n = 0;
      for (let s = 0; s < nSpan && n < MAXSP - 1; s++) {
        const st = curT[s], sb = curB[s];
        if (hi <= sb || lo >= st) { altT[n] = st; altB[n] = sb; n++; continue; }  // misses this span
        if (lo > sb) { altT[n] = lo; altB[n] = sb; n++; }                          // material below the void
        if (hi < st) { altT[n] = st; altB[n] = hi; n++; }                          // THE LID
      }
      const tT = curT, tB = curB; curT = altT; curB = altB; altT = tT; altB = tB;
      nSpan = n;
      if (!nSpan) break;
    }
    if (curT !== topA) { for (let s = 0; s < nSpan; s++) { topA[s] = curT[s]; botA[s] = curB[s]; } }
    return nSpan;
  }

  const NO_CARVE = function (x, z) { return base(x, z); };

  /* THE FLOOR. One owner, one law, and a fast path that makes a world with no
     holes in it byte-identical to the world before this file existed. */
  CBZ.floorAt = function (x, z, fromY) {
    const b = base(x, z);
    if (!carvings.length || CBZ.CONFIG.SOLID_GROUND === false) return b;
    const n = spansAt(x, z, b);
    if (!n) return b;
    const reach = (fromY == null ? Infinity : fromY + STEP_UP);
    let best = -Infinity;
    for (let s = 0; s < n; s++) if (topA[s] <= reach && topA[s] > best) best = topA[s];
    if (best === -Infinity) {
      // below every solid top: the lowest one is what you are still falling to
      best = topA[0];
      for (let s = 1; s < n; s++) if (topA[s] < best) best = topA[s];
    }
    return best;
  };
  CBZ.floorAt._solid = true;

  /* THE CEILING. physics.js's y-banded collider test (physics.js:185) resolves
     x/z only — nothing in this engine has ever clamped ASCENT. Y-banded walls
     therefore give a bunker its walls for free but NOT its roof, and without
     this a jump inside one puts your head through the street. Infinity when
     there is nothing overhead, which is every column in a world with no lids. */
  CBZ.ceilAt = function (x, z, y) {
    if (!carvings.length || CBZ.CONFIG.SOLID_GROUND === false) return Infinity;
    const n = spansAt(x, z, base(x, z));
    let best = Infinity;
    for (let s = 0; s < n; s++) {
      const bot = botA[s];
      if (bot > y && bot < best) best = bot;
    }
    return best;
  };

  // is this point inside removed material? (swim gating, FX, "am I underground")
  CBZ.carvingAt = function (x, z, y) {
    for (let i = 0; i < carvings.length; i++) {
      const c = carvings[i];
      if (x < c._x0 || x > c._x1 || z < c._z0 || z > c._z1) continue;
      if (!covers(c, x, z)) continue;
      if (y > voidFloor(c, x, z) && y < voidTop(c, x, z)) return c;
    }
    return null;
  };
  // is there solid ground OVER this point — i.e. am I under a lid?
  CBZ.underLid = function (x, z, y) {
    const c = CBZ.carvingAt(x, z, y);
    return !!(c && !c.open);
  };

  CBZ.solidAudit = function () {
    let open = 0, lids = 0;
    const byKind = {};
    for (let i = 0; i < carvings.length; i++) {
      const c = carvings[i];
      byKind[c.kind] = (byKind[c.kind] || 0) + 1;
      if (c.open) open++; else lids++;
    }
    return {
      carvings: carvings.length, open: open, lids: lids, byKind: byKind,
      owner: !!(CBZ.floorAt && CBZ.floorAt._solid),
      bases: Object.keys(bases),
      mode: mode(),
      // with no carvings this file must be invisible; the ratchet pins it
      fastPath: !carvings.length,
      maxSpans: MAXSP,
    };
  };
  void NO_CARVE;
})();
