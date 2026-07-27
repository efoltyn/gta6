/* ============================================================================
   systems/quadruped_ragdoll.js — VERLET CORPSE PHYSICS FOR ANIMALS (CBZ)
   ----------------------------------------------------------------------------
   OWNER, verbatim: "animals are the coolest thing but when they are killed they
   don't have death ragdoll like humans they just sit head pointed to sky dumb
   death animation unrealistic ... theres a lot of physics underdone."

   He is describing three separate faults and this file answers the biggest one.
   city/ragdoll.js has been solving REAL bodies for people since it shipped —
   13 mass points, Jakobsen sticks, joint limits, ground friction, buoyancy —
   and it is hard-wired to the humanoid: OFF[] is character.js's joint table,
   STICKS are its skeleton, and start() refuses anything without `ch.parts`. An
   animal could never pass that gate, so every one of the 45 species died by
   easing `group.rotation.z` to a constant. That is the "head pointed to sky".

   THIS IS A PARALLEL SOLVER, NOT A REFACTOR. The two skeletons share no bone,
   no index and no rest pose; what they share is the MATH, which is copied here
   deliberately and verbatim in spirit — verlet integrate, relax distance
   sticks, clamp the joints, collide the ground, ramp buoyancy, sleep and
   freeze. Rewriting ragdoll.js to be species-generic would have put a runtime
   skeleton lookup inside the hottest loop the game has, to serve two callers
   that never change shape. Copy the method; do not generalise the human.

   DISCOVERY, NOT DECLARATION (the law predator_anim.js lives by, applied
   again): there is NO species table in this file and adding the 46th animal
   must never mean adding a row. The point graph is found geometrically, from
   the same evidence wildlife.js's buildGaitRig already reads:
     * a LEG is a mesh taller than it is wide whose bottom sits on the ground;
       meshes stacked on the same (x,z) are ONE column (feet, pads, stripes).
     * the FRONT columns are the ones at x > 0 (every model is authored nose
       toward +X) and the REAR columns are the rest — that is the axle split.
     * the HEAD is the cluster far forward and up off the ground.
     * the TAIL is what is left hanging off the BACK, above the ground.
   When wildlife.js already discovered a gait rig we reuse ITS columns rather
   than re-deriving them (one law, one answer, and it is cheaper); dogs.js's
   strays have no gait rig at all, so the same sweep runs here on their raw
   children and finds four legs and a head anyway. Nothing is named.

   THE SKELETON (14 points max):
       0 head
       1,2 shoulder pair      3,4 hip pair        5 tail/rump
       6..13  knee + foot for up to four columns
   The torso is a rigid QUAD (both axles, braced diagonally) exactly like the
   human's shoulders/hips, and for exactly the same reason: two points make a
   line, and a line has no roll — you cannot build a body basis from it, so a
   two-point spine can only ever produce the head-to-sky pose we are here to
   delete. Four points give the corpse a real orientation, which is why a body
   that lands on its FLANK reads as dead and a body that lands on its belly
   reads as asleep.

   WRITE-BACK. These animals have no bones: every box is a direct child of the
   group at an authored position. So the pose is written in two passes — the
   torso quad gives group.position + group.quaternion (the body, on the real
   terrain slope, on its side), then the leg columns, head cluster and tail are
   walked back into the group's LOCAL frame and re-placed off the solved
   points. That is what makes the legs splay and the head loll instead of the
   whole animal rotating as one welded prop.

   BUDGET. Pool, LRU and a camera-range gate, all copied from ragdoll.js: a
   dozen solving corpses is plenty and a kill outside RANGE keeps the cheap
   path. When this file declines — flag off, no readable legs (snakes, fish),
   pool full, too far — the caller runs CBZ.wildlifeDeathTumble instead, which
   is the single-rigid-body tumble wildlife.js already had. Degrading is a
   first-class outcome here, not an error.

   Flag: CBZ.CONFIG.WILDLIFE_RAGDOLL (default ON) — one line back to tumbles.
============================================================================ */
(function () {
  "use strict";
  var CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  var THREE = window.THREE;

  // ---- flags: declared here, never in src/config.js -------------------------
  var CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  if (CFG.WILDLIFE_RAGDOLL == null) CFG.WILDLIFE_RAGDOLL = true;
  if (CFG.QUAD_RAGDOLL_BUOYANCY == null) CFG.QUAD_RAGDOLL_BUOYANCY = true;
  function ON() { return CBZ.CONFIG.WILDLIFE_RAGDOLL !== false; }
  function buoyOn() { return CBZ.CONFIG.QUAD_RAGDOLL_BUOYANCY !== false; }

  // ---- budget (same shape as ragdoll.js; smaller because a carcass lingers
  //      for CARCASS_LINGER seconds and we must not hold slots that long) -----
  function MAX_ACTIVE() { return CBZ.qScale ? CBZ.qScale(4, 14) : 8; }
  var POOL = 18;              // slots incl. frozen corpses still holding a pose
  var RANGE2 = 78 * 78;       // only kills this close to the camera solve
  var SLEEP_V = 0.20;         // u/s — under this the body counts as still
  var SLEEP_T = 0.55;         // s of stillness before the pose freezes
  var MAX_LIFE = 6.5;         // hard cap on solve time (safety)
  var ITER = 3;               // constraint relaxation passes per substep
  var KICK_DT = 1 / 120, VK = 0.52;
  var BUOY_G = -0.35, BUOY_DRAG = 0.86, FLOAT_BAND = 1.2;
  var RELIGHT_MAX = 5;        // times the roll may be re-armed on an upright corpse
  function GRAV() { return (CBZ.TUNE && CBZ.TUNE.gravity) || 22; }

  var MAXCOL = 4;             // columns actually simulated (see pickColumns)
  var MAXP = 7 + MAXCOL * 2;  // 15 points
  var MAXS = 56;              // stick slots (flat [i, j, rest, minOnly])
  // THE SPINE POINT IS NOT DECORATION — it is the reason a corpse can lie on
  // its FLANK. The shoulder and hip points all sit on the leg-attach line, i.e.
  // they are COPLANAR, and a flat four-point plate with one ground radius each
  // can only ever settle horizontal: a vertical quad puts two of its points in
  // mid-air and gravity brings them straight back down. So a body built from
  // that quad alone always reads belly-down, whatever torque you apply to it
  // (measured on the first build: up.y = 1.000 after a 400-step fall, every
  // time). One point on the mid-line ABOVE that plane gives the torso a real
  // cross-section, and rolled — spine and one flank on the deck — is then a
  // stable three-point contact the solver can actually find.
  var HEAD = 0, SHL = 1, SHR = 2, HIPL = 3, HIPR = 4, TAIL = 5, SPINE = 6, LEG0 = 7;

  var EMPTY = {};
  function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function cl1(v) { return v > 1 ? 1 : (v < -1 ? -1 : v); }

  // ==========================================================================
  //  RIG DISCOVERY — geometric, cached per actor, NO species anywhere.
  // ==========================================================================
  function meshDims(m) {
    var p = m.geometry && m.geometry.parameters;
    if (p && p.width != null) {
      return { w: Math.max(p.width, p.depth || p.width), h: p.height, d: p.depth || p.width };
    }
    var bb = m.geometry && m.geometry.boundingBox;
    if (!bb && m.geometry && m.geometry.computeBoundingBox) {
      try { m.geometry.computeBoundingBox(); bb = m.geometry.boundingBox; } catch (e) { bb = null; }
    }
    if (!bb) return null;
    return { w: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z), h: bb.max.y - bb.min.y, d: bb.max.z - bb.min.z };
  }

  // The sweep. This is buildGaitRig's leg/head test (wildlife.js), run here so
  // an actor with no gait rig of its own — every dog — still resolves.
  function sweep(a) {
    var grp = a.group, kids = grp.children;
    var cols = [], rest = [], maxX = 0, minX = 0, i, c;
    for (i = 0; i < kids.length; i++) {
      var m = kids[i]; if (!m || !m.isMesh) continue;
      var d = meshDims(m); if (!d) continue;
      if (m.position.x > maxX) maxX = m.position.x;
      if (m.position.x < minX) minX = m.position.x;
      var bottom = m.position.y - d.h / 2;
      if (d.h >= 0.10 && d.h >= d.w * 1.1 && bottom <= 0.16 && bottom >= -0.06) {
        var col = null;
        for (c = 0; c < cols.length; c++) {
          if (Math.abs(cols[c].x - m.position.x) <= 0.14 && Math.abs(cols[c].z - m.position.z) <= 0.14) { col = cols[c]; break; }
        }
        if (!col) { col = { x: m.position.x, z: m.position.z, top: 0, h: d.h, w: d.w, parts: [] }; cols.push(col); }
        col.top = Math.max(col.top, m.position.y + d.h / 2);
        col.h = Math.max(col.h, d.h);
        col.w = Math.max(col.w, d.w);
        col.parts.push({ m: m, bx: m.position.x, by: m.position.y, bz: m.position.z });
      } else rest.push({ m: m, d: d, bottom: bottom });
    }
    if (cols.length < 2) return null;
    var head = [], tail = [], backY = 0;
    for (i = 0; i < rest.length; i++) {
      var r = rest[i], rm = r.m, joined = false;
      for (c = 0; c < cols.length; c++) {
        var cc = cols[c];
        if (Math.abs(cc.x - rm.position.x) <= 0.13 && Math.abs(cc.z - rm.position.z) <= 0.13 &&
            rm.position.y - r.d.h / 2 < cc.top && r.d.h <= cc.h * 1.2) {
          cc.parts.push({ m: rm, bx: rm.position.x, by: rm.position.y, bz: rm.position.z });
          joined = true; break;
        }
      }
      if (joined) continue;
      if (maxX > 0.3 && rm.position.x >= maxX * 0.55 && r.bottom >= 0.25 * maxX) {
        head.push({ m: rm, bx: rm.position.x, by: rm.position.y, bz: rm.position.z });
      } else if (minX < -0.2 && rm.position.x <= minX * 0.62 && r.bottom >= 0.12) {
        tail.push({ m: rm, bx: rm.position.x, by: rm.position.y, bz: rm.position.z });
      } else {
        // TORSO. What is left between the axles is the body, and its TOP is the
        // animal's back — the height the spine point rides at.
        var topOf = rm.position.y + r.d.h / 2;
        if (topOf > backY) backY = topOf;
      }
    }
    return { cols: cols, head: head, tail: tail, backY: backY };
  }

  // wildlife.js already ran the same sweep for the gait. Reuse ITS answer when
  // it exists — one law, one set of columns, and the tail is the only thing we
  // still have to find ourselves (the gait never needed one).
  function fromGait(a) {
    var gt = a.gait;
    if (!gt || !gt.cols || gt.cols.length < 2) return null;
    var cols = [], i, p;
    for (i = 0; i < gt.cols.length; i++) {
      var g = gt.cols[i];
      var col = { x: g.x, z: g.z, top: g.top || g.h || 0.4, h: g.h || 0.4, w: 0.12, parts: [] };
      for (p = 0; p < g.parts.length; p++) {
        var pt = g.parts[p];
        col.parts.push({ m: pt.m, bx: pt.bx, by: pt.by, bz: pt.m.position.z });
      }
      cols.push(col);
    }
    var head = [];
    if (gt.head) for (i = 0; i < gt.head.length; i++) {
      head.push({ m: gt.head[i].m, bx: gt.head[i].bx, by: gt.head[i].by, bz: gt.head[i].m.position.z });
    }
    // the tail: whatever hangs off the BACK, above the ground, that is not a
    // leg part and not in the head cluster. One pass over the raw children.
    var tail = [], kids = a.group.children, minX = 0, backY = 0;
    for (i = 0; i < kids.length; i++) if (kids[i].isMesh && kids[i].position.x < minX) minX = kids[i].position.x;
    for (i = 0; i < kids.length; i++) {
      var m = kids[i]; if (!m.isMesh) continue;
      var d = meshDims(m); if (!d) continue;
      var used = false, c2;
      for (c2 = 0; c2 < cols.length && !used; c2++) {
        for (p = 0; p < cols[c2].parts.length; p++) if (cols[c2].parts[p].m === m) { used = true; break; }
      }
      for (c2 = 0; c2 < head.length && !used; c2++) if (head[c2].m === m) used = true;
      if (used) continue;
      if (minX < -0.2 && m.position.x <= minX * 0.62 && m.position.y - d.h / 2 >= 0.12) {
        tail.push({ m: m, bx: m.position.x, by: m.position.y, bz: m.position.z });
      } else {
        // TORSO — what is neither leg, head nor tail is the body, and its top
        // is the back the spine point rides at.
        var topOf = m.position.y + d.h / 2;
        if (topOf > backY) backY = topOf;
      }
    }
    return { cols: cols, head: head, tail: tail, backY: backY };
  }

  // At most MAXCOL columns actually get mass points. Keep the WIDEST pair on
  // each axle so `side` means the same thing on a four-legged deer and on a
  // six-legged something nobody has authored yet; the surplus columns simply
  // ride the group like any other decoration.
  function pickColumns(cols) {
    var front = [], rear = [], i;
    for (i = 0; i < cols.length; i++) (cols[i].x > 0 ? front : rear).push(cols[i]);
    function byZ(u, v) { return u.z - v.z; }
    front.sort(byZ); rear.sort(byZ);
    var out = [];
    if (front.length) { out.push(front[0]); if (front.length > 1) out.push(front[front.length - 1]); }
    if (rear.length) { out.push(rear[0]); if (rear.length > 1) out.push(rear[rear.length - 1]); }
    // a body with legs only at one end is not a quadruped we can pose
    if (!front.length || !rear.length) return null;
    return out;
  }

  function buildRig(a) {
    var rig = a._quadRig;
    if (rig !== undefined && rig && rig.src === (a.gait || a.group)) return rig;
    if (rig === null) return null;                 // discovery already failed once
    // SWIMMERS AND SLITHERERS ARE NOT QUADRUPEDS, and the geometric sweep can
    // be fooled by them — a shark's pectorals sit low and forward and its tail
    // low and aft, which is exactly the front/rear column signature this file
    // looks for. The refusal reads the RIG FACTS wildlife.js already discovered
    // (a.swim / a.segs), the same evidence predator_anim.js branches on, so it
    // is still not a species table. Both keep the shared tumble, which is the
    // right death for a body with no legs to splay.
    var sp = a.species || EMPTY;
    if (a.swim || (a.segs && a.segs.length) || sp.aquatic || sp.snake) { a._quadRig = null; return null; }
    var raw = fromGait(a) || sweep(a);
    var cols = raw && pickColumns(raw.cols);
    if (!cols) { a._quadRig = null; return null; }

    var i, c;
    var off = new Float32Array(MAXP * 3), rad = new Float32Array(MAXP);
    // the axle geometry, straight off the discovered columns
    var fx = 0, fn = 0, rx = 0, rn = 0, halfW = 0, topY = 0, legH = 0;
    for (c = 0; c < cols.length; c++) {
      var col = cols[c];
      if (col.x > 0) { fx += col.x; fn++; } else { rx += col.x; rn++; }
      halfW = Math.max(halfW, Math.abs(col.z));
      topY = Math.max(topY, col.top);
      legH = Math.max(legH, col.h);
    }
    fx = fn ? fx / fn : 0.3; rx = rn ? rx / rn : -0.3;
    if (halfW < 0.04) halfW = Math.max(0.06, (fx - rx) * 0.16);   // a bird: give it width
    var bodyY = Math.max(topY, legH * 1.02);

    off[SHL * 3] = fx; off[SHL * 3 + 1] = bodyY; off[SHL * 3 + 2] = -halfW;
    off[SHR * 3] = fx; off[SHR * 3 + 1] = bodyY; off[SHR * 3 + 2] = halfW;
    off[HIPL * 3] = rx; off[HIPL * 3 + 1] = bodyY; off[HIPL * 3 + 2] = -halfW;
    off[HIPR * 3] = rx; off[HIPR * 3 + 1] = bodyY; off[HIPR * 3 + 2] = halfW;

    // head anchor: the cluster's centroid, else a nose-length in front
    var hx = fx + (fx - rx) * 0.55, hy = bodyY + legH * 0.28, hz = 0, hspan = halfW;
    if (raw.head && raw.head.length) {
      var sx = 0, sy = 0, sz = 0, loY = 1e9, hiY = -1e9;
      for (i = 0; i < raw.head.length; i++) {
        sx += raw.head[i].bx; sy += raw.head[i].by; sz += raw.head[i].bz;
        if (raw.head[i].by < loY) loY = raw.head[i].by;
        if (raw.head[i].by > hiY) hiY = raw.head[i].by;
      }
      hx = sx / raw.head.length; hy = sy / raw.head.length; hz = sz / raw.head.length;
      hspan = Math.max(halfW * 0.7, (hiY - loY) * 0.5 + halfW * 0.25);
    }
    off[HEAD * 3] = hx; off[HEAD * 3 + 1] = hy; off[HEAD * 3 + 2] = hz;

    // tail / rump: a real tail if the model has one, else a rear extremity so
    // the corpse has something to catch on the ground behind the hips.
    var tx = rx - (fx - rx) * 0.34, ty = bodyY, tz = 0, hasTail = false;
    if (raw.tail && raw.tail.length) {
      var tsx = 0, tsy = 0, tsz = 0;
      for (i = 0; i < raw.tail.length; i++) { tsx += raw.tail[i].bx; tsy += raw.tail[i].by; tsz += raw.tail[i].bz; }
      tx = tsx / raw.tail.length; ty = tsy / raw.tail.length; tz = tsz / raw.tail.length;
      hasTail = true;
    }
    off[TAIL * 3] = tx; off[TAIL * 3 + 1] = ty; off[TAIL * 3 + 2] = tz;

    // THE SPINE. Placed on the mid-line at the animal's own BACK height (the top
    // of whatever discovery decided was torso), falling back to one body-width
    // above the axle line when a rig has no readable body block. See the SPINE
    // comment at the top: without this point the corpse cannot lie on a flank.
    var backY = (raw.backY > bodyY + 0.02) ? raw.backY : (bodyY + halfW * 1.05);
    off[SPINE * 3] = (fx + rx) * 0.5; off[SPINE * 3 + 1] = backY; off[SPINE * 3 + 2] = 0;

    var bodyR = Math.max(0.04, Math.min(halfW * 0.8, (backY - bodyY) * 0.45));
    rad[HEAD] = Math.max(0.05, hspan);
    rad[SHL] = rad[SHR] = rad[HIPL] = rad[HIPR] = bodyR;
    rad[SPINE] = Math.max(0.05, halfW * 0.55);
    rad[TAIL] = Math.max(0.04, bodyR * 0.6);

    // ---- the legs: knee halfway up the column, foot on the deck ------------
    var recs = [];
    for (c = 0; c < cols.length; c++) {
      var cn = cols[c];
      var ki = LEG0 + c * 2, fi = ki + 1;
      var attach = (cn.x > 0) ? (cn.z < 0 ? SHL : SHR) : (cn.z < 0 ? HIPL : HIPR);
      var opp = (cn.x > 0) ? (cn.z < 0 ? SHR : SHL) : (cn.z < 0 ? HIPR : HIPL);
      // THE FOOT POINT SITS AT THE LOWEST AUTHORED PART, AND ITS GROUND RADIUS
      // IS THAT SAME HEIGHT. Both halves matter and getting either wrong shows
      // up as a corpse whose legs are 2cm too long: the point is the bottom of
      // the chain, so nothing may map below it; and at rest it stands exactly
      // that far above the deck, so the ground clamp must use the same number
      // or the whole animal is jacked up by the difference.
      var lowY = 1e9;
      for (var q2 = 0; q2 < cn.parts.length; q2++) if (cn.parts[q2].by < lowY) lowY = cn.parts[q2].by;
      if (!(lowY < 1e8)) lowY = Math.max(0.02, cn.w * 0.5);
      var footR = Math.max(0.02, lowY);
      // the knee is the true midpoint of the chain, not half the column height:
      // a straight rest leg means ANY part's height solves to a unique point on
      // it, which is what makes the rest pose round-trip exactly.
      var kneeY = (footR + bodyY) * 0.5;
      off[ki * 3] = cn.x; off[ki * 3 + 1] = kneeY; off[ki * 3 + 2] = cn.z;
      off[fi * 3] = cn.x; off[fi * 3 + 1] = footR; off[fi * 3 + 2] = cn.z;
      rad[ki] = Math.max(0.02, cn.w * 0.5);
      rad[fi] = footR;
      // y0/y1/y2 are the rest HEIGHTS of foot, knee and attach. The write-back
      // parameterises each mesh by its own authored height between them, so the
      // rest pose is reproduced EXACTLY even when this column is shorter than
      // the tallest one (the axle points sit at a shared body line, and a naive
      // by/top ratio would then stretch the short legs on every corpse).
      recs.push({
        x: cn.x, z: cn.z, parts: cn.parts, ax: attach, opp: opp, ki: ki, fi: fi,
        y0: footR, y1: kneeY, y2: bodyY,
      });
    }
    var n = LEG0 + recs.length * 2;

    // ---- sticks ------------------------------------------------------------
    var st = new Float32Array(MAXS * 4), ns = 0;
    function dist(i2, j2) {
      var dx = off[i2 * 3] - off[j2 * 3], dy = off[i2 * 3 + 1] - off[j2 * 3 + 1], dz = off[i2 * 3 + 2] - off[j2 * 3 + 2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
    }
    function push(i2, j2, minOnly, rest) {
      if (ns >= MAXS) return;
      var b = ns * 4;
      st[b] = i2; st[b + 1] = j2; st[b + 2] = rest == null ? dist(i2, j2) : rest; st[b + 3] = minOnly ? 1 : 0;
      ns++;
    }
    // rigid torso quad + both diagonals — the body, and the ONLY thing that
    // gives a corpse a readable orientation.
    push(SHL, SHR); push(HIPL, HIPR); push(SHL, HIPL); push(SHR, HIPR);
    push(SHL, HIPR); push(SHR, HIPL);
    // ...and the spine ties the quad into a real VOLUME (see the SPINE note).
    push(SPINE, SHL); push(SPINE, SHR); push(SPINE, HIPL); push(SPINE, HIPR);
    // head hung off both shoulders, spaced off the hips so it lolls but never
    // folds back through the ribcage
    push(HEAD, SHL); push(HEAD, SHR); push(HEAD, SPINE, 1); push(HEAD, HIPL, 1); push(HEAD, HIPR, 1);
    // tail off both hips, spaced off the shoulders for the same reason
    push(TAIL, HIPL); push(TAIL, HIPR); push(TAIL, SPINE, 1); push(TAIL, SHL, 1); push(TAIL, SHR, 1);
    for (c = 0; c < recs.length; c++) {
      var rc = recs[c];
      push(rc.ax, rc.ki); push(rc.ki, rc.fi);
      // a one-sided spacer to the OPPOSITE side of the same axle: a leg may
      // fold any way gravity takes it, but it may never pass through the body.
      push(rc.ki, rc.opp, 1);
    }

    rig = {
      src: a.gait || a.group,
      n: n, off: off, rad: rad, st: st, ns: ns,
      cols: recs, head: (raw.head && raw.head.length) ? raw.head : null,
      tail: hasTail ? raw.tail : null,
      hx: hx, hy: hy, hz: hz, tx: tx, ty: ty, tz: tz,
      neckX: fx, neckY: bodyY, neckZ: 0,
      hipX: rx, hipY: bodyY, hipZ: 0,
      bodyY: bodyY, legH: legH, halfW: halfW,
    };
    a._quadRig = rig;
    return rig;
  }

  // ==========================================================================
  //  SLOTS
  // ==========================================================================
  function makeSlot(idx) {
    return {
      idx: idx, used: false, act: null, rig: null,
      age: 0, still: 0, asleep: false, life: 0, thud: false,
      s: 1, n: 0,
      p: new Float32Array(MAXP * 3), q: new Float32Array(MAXP * 3),
      kv: new Float32Array(MAXP * 3), kicked: false,
      cx: 0, cy: 0, cz: 0, gy: 0,
      // the DYING BEAT (city/ragdoll.js's dyt, same idea): a brief sustained
      // roll while the body is still folding. A one-shot impulse cannot do this
      // job — a standing animal's torso is barely half a metre off the deck, so
      // the ground clamp eats the angular velocity in ~0.2s and the corpse
      // levels out belly-down (measured: up.y 1.000 -> 0.968 -> back to 1.000).
      dyt: 0, dyMax: 0, dyPx: 0, dyPz: 0, dyRoll: 0, relight: 0,
      pin: null, wet: false, seaY: 0, seaDy: 0,
    };
  }
  var slots = [];
  for (var si = 0; si < POOL; si++) slots.push(makeSlot(si));
  var seq = 0, refused = 0, started = 0;

  // scratch — zero per-frame allocation (the file's whole hot path)
  var _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3();
  var _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3();
  var _m = new THREE.Matrix4(), _qt = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _qh = new THREE.Quaternion();
  var _c = { x: 0, y: 0, z: 0 };
  var _pinAt = { x: 0, y: 0, z: 0 };

  function groundUnder(x, z, y) {
    if (CBZ.groundAt) return CBZ.groundAt(x, z, y);
    return CBZ.floorAt ? CBZ.floorAt(x, z) : 0;
  }

  function releaseSlot(s) {
    if (s.act && s.act._quadSlot === s.idx) { s.act._quadSlot = null; s.act._quadRagOn = false; }
    s.used = false; s.act = null; s.rig = null;
    s.asleep = false; s.still = 0; s.life = 0; s.thud = false;
    s.kicked = false; s.kv.fill(0); s.relight = 0; s.dyt = 0; s.dyMax = 0;
    s.pin = null; s.wet = false; s.seaY = 0; s.seaDy = 0;
  }

  // ==========================================================================
  //  THE KICK — the killing round, distributed over the points.
  //
  //  The human's law applies unchanged and is the reason this reads as death
  //  rather than as a shove: a body does not slide along the bullet, it
  //  TOPPLES. High mass (head/shoulders) takes far more push than the planted
  //  feet, and the feet get a small counter-kick back toward the shooter, so
  //  the pair is a couple that pitches the animal over AWAY from the gun.
  //  On top of that a quadruped gets a ROLL couple — the far flank is pushed
  //  harder than the near one — because the whole owner complaint is that the
  //  corpse ends up upright. A body has to land on its SIDE.
  // ==========================================================================
  function kick(s, point, dir, imp) {
    var rig = s.rig, p = s.p, kv = s.kv, sc = s.s;
    s.kicked = true;
    var dx = dir ? (+dir.x || 0) : 0, dy = dir ? (+dir.y || 0) : 0, dz = dir ? (+dir.z || 0) : 0;
    var dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dl < 0.001) { var ang = Math.random() * 6.283; dx = Math.cos(ang); dz = Math.sin(ang); dy = 0; }
    else { dx /= dl; dy /= dl; dz /= dl; }
    // MASS DAMPS EVERYTHING. A rabbit is thrown; a bull moose absorbs the same
    // round and folds where it stands. scale^2 is the standing mass proxy
    // wildlife.js's own tumble already used — same curve, so the two death
    // paths cannot disagree about how heavy an animal is.
    var mass = Math.max(0.6, sc * sc * 1.7);
    var m = cl((imp || 6) / Math.sqrt(mass), 1, 30);
    var boom = m >= 20;
    var topY = rig.bodyY * sc;
    var hitX = point ? point.x : null, hitY = point ? point.y : 0, hitZ = point ? point.z : 0;

    // ---- THE ROLL AXIS IS THE ANIMAL'S, NOT THE BULLET'S. This was wrong on
    // the first build and it is worth spelling out, because the wrong version
    // passes every "did it rotate" check. A round striking above the support
    // applies a torque about (d x up), i.e. about the axis PERPENDICULAR to
    // travel — so a shot taken in the flank tips the animal end-over-end and a
    // head-on shot rolls it. That is arguably correct rigid-body physics and it
    // is the wrong answer to the question asked here, because a somersaulting
    // deer lands back on its feet (measured: up.y = 1.000 on every flank shot).
    // A dead quadruped goes over its OWN long axis, always; the round only
    // decides WHICH flank. So the axis is nose-to-tail off the live points, and
    // the round is consulted for a sign and nothing else.
    var lx = (p[SHL * 3] + p[SHR * 3]) * 0.5 - (p[HIPL * 3] + p[HIPR * 3]) * 0.5;
    var lz = (p[SHL * 3 + 2] + p[SHR * 3 + 2]) * 0.5 - (p[HIPL * 3 + 2] + p[HIPR * 3 + 2]) * 0.5;
    var ll = Math.sqrt(lx * lx + lz * lz) || 1; lx /= ll; lz /= ll;
    var px2 = -lz, pz2 = lx;                  // the body's own left-right axis
    // which flank it falls onto: the way the round was travelling across the
    // body, else the side the shot came from, else a coin.
    var lean = dx * px2 + dz * pz2;
    if (Math.abs(lean) < 0.2 && hitX != null) {
      lean = -((hitX - s.cx) * px2 + (hitZ - s.cz) * pz2);
    }
    var side = (Math.abs(lean) < 1e-4) ? (Math.random() < 0.5 ? -1 : 1) : (lean >= 0 ? 1 : -1);
    for (var i = 0; i < s.n; i++) {
      var ix = i * 3, iy = ix + 1, iz = ix + 2;
      var w = 0.75;
      if (hitX != null) {
        var ddx = p[ix] - hitX, ddy = p[iy] - hitY, ddz = p[iz] - hitZ;
        var dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        w = Math.max(0.3, 1 - dd / (1.6 + 1.4 * sc));
      }
      var hf = topY > 0.01 ? cl((p[iy] - s.gy) / topY, 0, 1.2) : 0.5;   // 0 feet .. 1 back
      var toppleHi = 0.45 + 1.05 * hf;
      var toppleLo = (1 - hf) * 0.45;
      var along = m * VK * w * (toppleHi - toppleLo);
      var vx = dx * along, vz = dz * along;
      // slide the mass above the legs off to one side (translation only — the
      // ROLL itself is the vertical couple below).
      var roll = m * VK * w * hf * 0.30 * side;
      vx += px2 * roll; vz += pz2 * roll;
      var vy = (dy * m * VK + m * 0.05 * hf) * w;
      // THE ROLL COUPLE, and this is the line that answers the owner's actual
      // complaint. A sideways push on the torso quad is PURE TRANSLATION: the
      // quad is rigid by construction, so every point moves together and the
      // body slides upright. A roll needs opposite VERTICAL velocities across
      // the spine — the struck flank driven down, the far flank lifted — which
      // is a torque about the animal's own long axis. Measured before this: the
      // corpse settled at up.y = 1.000, i.e. standing.
      if (i < LEG0) {                      // the whole mass above the legs
        // rotation about the body's long axis: vertical velocity proportional
        // to how far the point sits across the spine, mirrored either side.
        var dPerp = (p[ix] - s.cx) * px2 + (p[iz] - s.cz) * pz2;
        vy += -side * dPerp * (m * VK * 0.75) * w;
        // the spine is off the axle plane, so it also gets a straight sideways
        // shove — that is the lever the flat quad never had.
        if (i === SPINE) { vx += px2 * m * VK * 0.5 * side * w; vz += pz2 * m * VK * 0.5 * side * w; }
      }
      if (boom) vy += (m * 0.28 + Math.random() * 2) * w;
      vx += (Math.random() - 0.5) * m * 0.06;
      vz += (Math.random() - 0.5) * m * 0.06;
      kv[ix] -= vx * KICK_DT; kv[iy] -= vy * KICK_DT; kv[iz] -= vz * KICK_DT;
    }

    // ---- THE COLLAPSE (city/ragdoll.js's DYING BEAT, on a discovered rig).
    // A dead animal must not land on its feet, and a four-legged frame of rigid
    // struts is STABLE: verlet has no reason to buckle a vertical column in
    // pure compression, so without this the corpse settles STANDING (measured
    // exactly that, up.y = 1.000 after 400 steps, on the first build). So the
    // legs are actively taken out from under it the way a real one gives way —
    // the feet slide IN under the body, the knees swing out and sag, and from
    // there gravity and the roll couple above do the rest. Every number is
    // damped by the same mass proxy as the impulse: a moose folds slowly.
    var cxx = (p[SHL * 3] + p[SHR * 3] + p[HIPL * 3] + p[HIPR * 3]) * 0.25;
    var czz = (p[SHL * 3 + 2] + p[SHR * 3 + 2] + p[HIPL * 3 + 2] + p[HIPR * 3 + 2]) * 0.25;
    var buck = (1.8 + m * 0.10) * sc;
    for (var c2 = 0; c2 < rig.cols.length; c2++) {
      var f3 = rig.cols[c2].fi * 3, k3 = rig.cols[c2].ki * 3;
      var ux = cxx - p[f3], uz = czz - p[f3 + 2];
      var ul = Math.sqrt(ux * ux + uz * uz) || 1; ux /= ul; uz /= ul;
      // in under the body, AND out from under it on the struck side, so the
      // legs fold the same way the torso is going over. Legs collapsing
      // symmetrically drop an animal onto its belly, which is the pose we are
      // here to delete just as much as the nose-to-sky one.
      var lx = ux * buck - px2 * side * buck * 0.55;
      var lz = uz * buck - pz2 * side * buck * 0.55;
      kv[f3] -= lx * KICK_DT; kv[f3 + 2] -= lz * KICK_DT;
      kv[k3] += ux * buck * 0.5 * KICK_DT; kv[k3 + 2] += uz * buck * 0.5 * KICK_DT;
      kv[k3 + 1] += buck * 0.45 * KICK_DT;      // kv is SUBTRACTED in solve: +y here = the knee DROPS
    }

    // ARM THE DYING BEAT. See the slot comment: a standing quadruped's torso is
    // half a metre off the deck, so an impulse-only roll is arrested by the
    // ground before it can turn the body over. This keeps a decaying roll on
    // the mass ABOVE the axle line for the half-second the legs are folding,
    // which is the window a real animal actually goes over in.
    // The jitter is not decoration: a herd shot from one position must not
    // become a row of identical toys, which is the exact criticism the shared
    // tumble's own rest-pose variance was written to answer.
    s.dyMax = s.dyt = 0.4 + Math.random() * 0.22;
    s.dyPx = px2 * side; s.dyPz = pz2 * side;
    s.dyRoll = (1.5 + m * 0.10) * sc * (0.75 + Math.random() * 0.6);
  }

  // ==========================================================================
  //  START — seed the points from the rig's CURRENT transform.
  // ==========================================================================
  function start(a, opts) {
    if (!ON() || !a || !a.group || !a.group.position) return false;
    var rig = buildRig(a);
    if (!rig) { refused++; return false; }
    var grp = a.group;
    var cam = CBZ.camera && CBZ.camera.position;
    if (cam) {
      var gdx = grp.position.x - cam.x, gdz = grp.position.z - cam.z;
      if (gdx * gdx + gdz * gdz > RANGE2) { refused++; return false; }
    }
    opts = opts || {};
    var s = (a._quadSlot != null) ? slots[a._quadSlot] : null;
    if (s && s.used && s.act === a) {
      kick(s, opts.point, opts.dir, opts.imp);
      s.asleep = false; s.still = 0; s.life = 0; s.age = ++seq;
      return true;
    }
    // LRU: over budget → freeze the oldest SETTLING body, never a fresh one
    // (a grenade in a herd starts several corpses in one call stack, and
    // freezing those locks them bolt upright — the exact bug we are here for).
    var active = 0, oldest = null, i;
    for (i = 0; i < POOL; i++) {
      var t = slots[i];
      if (t.used && !t.asleep) { active++; if (t.life > 0.5 && (!oldest || t.age < oldest.age)) oldest = t; }
    }
    if (active >= MAX_ACTIVE()) {
      if (oldest) oldest.asleep = true;
      else { refused++; return false; }
    }
    s = null; var stale = null;
    for (i = 0; i < POOL; i++) {
      var t2 = slots[i];
      if (!t2.used) { s = t2; break; }
      if (t2.asleep && (!stale || t2.age < stale.age)) stale = t2;
    }
    if (!s && stale) { releaseSlot(stale); s = stale; }
    if (!s) { refused++; return false; }

    var sc = (grp.scale && grp.scale.x) ? grp.scale.x : 1;
    s.s = sc; s.rig = rig; s.n = rig.n;
    _qt.copy(grp.quaternion);
    var off = rig.off;
    for (i = 0; i < rig.n; i++) {
      _a.set(off[i * 3] * sc, off[i * 3 + 1] * sc, off[i * 3 + 2] * sc).applyQuaternion(_qt);
      var ix = i * 3;
      s.p[ix] = s.q[ix] = grp.position.x + _a.x;
      s.p[ix + 1] = s.q[ix + 1] = grp.position.y + _a.y;
      s.p[ix + 2] = s.q[ix + 2] = grp.position.z + _a.z;
    }
    s.used = true; s.act = a; s.age = ++seq;
    s.still = 0; s.asleep = false; s.life = 0; s.thud = false; s.pin = null;
    s.kv.fill(0); s.kicked = false; s.relight = 0;
    s.cx = grp.position.x; s.cy = grp.position.y + rig.bodyY * sc; s.cz = grp.position.z;
    s.gy = grp.position.y;
    a._quadSlot = s.idx; a._quadRagOn = true;
    started++;
    kick(s, opts.point, opts.dir, opts.imp);
    return true;
  }

  // ==========================================================================
  //  THE SOLVE — verlet + sticks + joint knot-guard + ground + buoyancy.
  //  Every line of method here is city/ragdoll.js's, re-indexed onto this
  //  skeleton (see the header: copy the math, do not generalise the human).
  // ==========================================================================
  var _ux, _uy, _uz, _lx, _ly, _lz, _hx, _hy, _hz;
  // THE KNOT GUARD. The human solver knows which way a knee bends because it
  // knows what a knee is; a DISCOVERED column does not — a front knee folds
  // backward and a rear hock forward, and the sign flips again on a bird. So
  // this limit is deliberately symmetric and generous: a leg may fold as far
  // as gravity takes it, but it may not double back through itself into a knot
  // (which is the only leg artefact a player ever actually notices on a
  // corpse). Anatomy per column would need a species table; this does not.
  var BEND_MAX = 2.45;
  function clampBend(p, top, mid, end, aA, aB) {
    var ti = top * 3, mi = mid * 3, ei = end * 3, ai = aA * 3, bi = aB * 3;
    _ux = p[mi] - p[ti]; _uy = p[mi + 1] - p[ti + 1]; _uz = p[mi + 2] - p[ti + 2];
    _lx = p[ei] - p[mi]; _ly = p[ei + 1] - p[mi + 1]; _lz = p[ei + 2] - p[mi + 2];
    var ul = Math.sqrt(_ux * _ux + _uy * _uy + _uz * _uz) || 0.0001;
    var ll = Math.sqrt(_lx * _lx + _ly * _ly + _lz * _lz) || 0.0001;
    _ux /= ul; _uy /= ul; _uz /= ul; _lx /= ll; _ly /= ll; _lz /= ll;
    _hx = p[bi] - p[ai]; _hy = p[bi + 1] - p[ai + 1]; _hz = p[bi + 2] - p[ai + 2];
    var hl = Math.sqrt(_hx * _hx + _hy * _hy + _hz * _hz) || 0.0001;
    _hx /= hl; _hy /= hl; _hz /= hl;
    var cx = _uy * _lz - _uz * _ly, cy = _uz * _lx - _ux * _lz, cz = _ux * _ly - _uy * _lx;
    var bend = Math.atan2(cx * _hx + cy * _hy + cz * _hz, _ux * _lx + _uy * _ly + _uz * _lz);
    var target = bend < -BEND_MAX ? -BEND_MAX : (bend > BEND_MAX ? BEND_MAX : bend);
    if (target === bend) return;
    var dA = target - bend, co = Math.cos(dA), sn = Math.sin(dA);
    var kx = _hy * _lz - _hz * _ly, ky = _hz * _lx - _hx * _lz, kz = _hx * _ly - _hy * _lx;
    var hdl = _hx * _lx + _hy * _ly + _hz * _lz;
    var lpx = _lx * co + kx * sn + _hx * hdl * (1 - co);
    var lpy = _ly * co + ky * sn + _hy * hdl * (1 - co);
    var lpz = _lz * co + kz * sn + _hz * hdl * (1 - co);
    var k = 0.35 * ll;
    p[mi] -= (lpx - _lx) * k; p[mi + 1] -= (lpy - _ly) * k; p[mi + 2] -= (lpz - _lz) * k;
  }

  // The body's own up axis, straight off the torso quad — same construction
  // writePose uses, without building a matrix for it. Cheap enough to ask every
  // frame and it is what the rest-on-its-feet invariant is written against.
  function bodyUpY(s) {
    var p = s.p;
    var fx2 = (p[SHL * 3] + p[SHR * 3]) * 0.5 - (p[HIPL * 3] + p[HIPR * 3]) * 0.5;
    var fy2 = (p[SHL * 3 + 1] + p[SHR * 3 + 1]) * 0.5 - (p[HIPL * 3 + 1] + p[HIPR * 3 + 1]) * 0.5;
    var fz2 = (p[SHL * 3 + 2] + p[SHR * 3 + 2]) * 0.5 - (p[HIPL * 3 + 2] + p[HIPR * 3 + 2]) * 0.5;
    var rx2 = p[SHR * 3] - p[SHL * 3], ry2 = p[SHR * 3 + 1] - p[SHL * 3 + 1], rz2 = p[SHR * 3 + 2] - p[SHL * 3 + 2];
    // up = right x forward (local +Z cross local +X is local +Y — see writePose)
    var ux2 = ry2 * fz2 - rz2 * fy2, uy2 = rz2 * fx2 - rx2 * fz2, uz2 = rx2 * fy2 - ry2 * fx2;
    var ul2 = Math.sqrt(ux2 * ux2 + uy2 * uy2 + uz2 * uz2);
    return ul2 > 1e-8 ? uy2 / ul2 : 1;
  }

  function applyPin(s) {
    var pin = s.pin; if (!pin) return;
    _pinAt.x = pin.x; _pinAt.y = pin.y; _pinAt.z = pin.z;
    if (pin.at) { try { pin.at(_pinAt); } catch (e) { return; } }
    if (!(isFinite(_pinAt.x) && isFinite(_pinAt.y) && isFinite(_pinAt.z))) return;
    pin.x = _pinAt.x; pin.y = _pinAt.y; pin.z = _pinAt.z;
    var p = s.p, q = s.q, pts = pin.pts, n = pts.length;
    var mx = 0, my = 0, mz = 0, k, i;
    for (k = 0; k < n; k++) { i = pts[k] * 3; mx += p[i]; my += p[i + 1]; mz += p[i + 2]; }
    var inv = 1 / n, stf = pin.stiff, keep = 1 - stf;
    var ox = (_pinAt.x - mx * inv) * stf, oy = (_pinAt.y - my * inv) * stf, oz = (_pinAt.z - mz * inv) * stf;
    for (k = 0; k < n; k++) {
      i = pts[k] * 3;
      var vx = p[i] - q[i], vy = p[i + 1] - q[i + 1], vz = p[i + 2] - q[i + 2];
      p[i] += ox; p[i + 1] += oy; p[i + 2] += oz;
      q[i] = p[i] - vx * keep; q[i + 1] = p[i + 1] - vy * keep; q[i + 2] = p[i + 2] - vz * keep;
    }
  }

  // ONE water query per body per frame — never per point. Taken below the body
  // for the same reason ragdoll.js takes it below the pelvis: a probe AT the
  // surface flickers wet/dry as the corpse bobs and the body oscillates.
  function waterProbe(s) {
    s.seaDy = 0;
    if (!buoyOn() || !CBZ.waterSubmergence) { s.wet = false; return; }
    var py = s.cy - 3;
    var d = CBZ.waterSubmergence(s.cx, py, s.cz);
    if (!(d > 0)) { s.wet = false; return; }
    var ny = py + d;
    if (s.wet) { var dy = ny - s.seaY; if (dy > -1 && dy < 1) s.seaDy = dy; }
    s.wet = true; s.seaY = ny;
  }
  function bobAsleep(s) {
    var dy = s.seaDy;
    if (!dy || Math.abs(s.cy - s.seaY) > FLOAT_BAND) return;
    var p = s.p, q = s.q, n3 = s.n * 3;
    for (var i = 1; i < n3; i += 3) { p[i] += dy; q[i] += dy; }
  }

  function solve(s, dt) {
    if (dt <= 0) return;
    var p = s.p, q = s.q, rig = s.rig, sc = s.s, n = s.n, i, ix, iy, iz;
    var rad = rig.rad, st = rig.st, ns = rig.ns;
    // two support columns (front axle / rear axle) so a carcass draped over a
    // kerb, a rock or a stair folds over it instead of hovering flat.
    var ax = (p[SHL * 3] + p[SHR * 3]) * 0.5, az = (p[SHL * 3 + 2] + p[SHR * 3 + 2]) * 0.5;
    var bx = (p[HIPL * 3] + p[HIPR * 3]) * 0.5, bz = (p[HIPL * 3 + 2] + p[HIPR * 3 + 2]) * 0.5;
    var g0 = groundUnder(ax, az, (p[SHL * 3 + 1] + p[SHR * 3 + 1]) * 0.5 + 0.3);
    var g1 = groundUnder(bx, bz, (p[HIPL * 3 + 1] + p[HIPR * 3 + 1]) * 0.5 + 0.3);
    var h = Math.min(dt, 0.04) * 0.5;
    if (s.kicked) {
      var ks = h / KICK_DT, kv = s.kv;
      for (i = 0; i < n * 3; i++) { q[i] += kv[i] * ks; kv[i] = 0; }
      s.kicked = false;
    }
    // ---- THE DYING BEAT: a decaying roll on the mass above the axle line
    //      while the legs fold. Moving p ahead of q IS setting a velocity —
    //      the same trick ragdoll.js's stumble uses, and the reason it survives
    //      the ground clamp when a one-shot impulse does not.
    if (s.dyt > 0) {
      s.dyt = Math.max(0, s.dyt - dt);
      var kf = s.dyMax > 0 ? s.dyt / s.dyMax : 0;
      var push = h * s.dyRoll * kf;
      p[SPINE * 3] += s.dyPx * push; p[SPINE * 3 + 2] += s.dyPz * push;
      p[HEAD * 3] += s.dyPx * push * 0.55; p[HEAD * 3 + 2] += s.dyPz * push * 0.55;
      p[TAIL * 3] += s.dyPx * push * 0.55; p[TAIL * 3 + 2] += s.dyPz * push * 0.55;
    }
    var gh2 = GRAV() * h * h;
    var wet = s.wet, seaTop = s.seaY;
    var maxd2 = 0, sub, it, c;
    for (sub = 0; sub < 2; sub++) {
      for (i = 0; i < n; i++) {
        ix = i * 3; iy = ix + 1; iz = ix + 2;
        var vx = (p[ix] - q[ix]) * 0.992, vy = (p[iy] - q[iy]) * 0.992, vz = (p[iz] - q[iz]) * 0.992;
        var sp2 = vx * vx + vy * vy + vz * vz;
        if (sp2 > 0.2025) { var kk = 0.45 / Math.sqrt(sp2); vx *= kk; vy *= kk; vz *= kk; }
        if (sp2 > maxd2) maxd2 = sp2;
        q[ix] = p[ix]; q[iy] = p[iy]; q[iz] = p[iz];
        var gg = gh2;
        if (wet) {
          var dep = seaTop - p[iy];
          if (dep > 0) {
            var rr = rad[i] * sc;
            var kw = dep < rr ? dep / (rr || 0.01) : 1;
            gg = gh2 * (1 + (BUOY_G - 1) * kw);
            var dr = 1 - (1 - BUOY_DRAG) * kw;
            vx *= dr; vy *= dr; vz *= dr;
          }
        }
        p[ix] += vx; p[iy] += vy - gg; p[iz] += vz;
      }
      for (it = 0; it < ITER; it++) {
        for (c = 0; c < ns; c++) {
          var b4 = c * 4, ii = st[b4] * 3, jj = st[b4 + 1] * 3;
          var rest = (st[b4 + 3] ? st[b4 + 2] * 0.8 : st[b4 + 2]) * sc;
          var ddx = p[jj] - p[ii], ddy = p[jj + 1] - p[ii + 1], ddz = p[jj + 2] - p[ii + 2];
          var dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) || 0.0001;
          if (st[b4 + 3] && dd > rest) continue;
          var kc = (rest - dd) / dd * 0.5;
          ddx *= kc; ddy *= kc; ddz *= kc;
          p[ii] -= ddx; p[ii + 1] -= ddy; p[ii + 2] -= ddz;
          p[jj] += ddx; p[jj + 1] += ddy; p[jj + 2] += ddz;
        }
        for (c = 0; c < rig.cols.length; c++) {
          var col = rig.cols[c];
          clampBend(p, col.ax, col.ki, col.fi, col.ax, col.opp);
        }
      }
      // ground: clamp + friction + a whisper of bounce
      for (i = 0; i < n; i++) {
        ix = i * 3; iy = ix + 1; iz = ix + 2;
        var da = (p[ix] - ax) * (p[ix] - ax) + (p[iz] - az) * (p[iz] - az);
        var db = (p[ix] - bx) * (p[ix] - bx) + (p[iz] - bz) * (p[iz] - bz);
        var fl = (da < db ? g0 : g1) + rad[i] * sc;
        if (p[iy] < fl) {
          var bvy = p[iy] - q[iy];
          p[iy] = fl;
          q[iy] = fl + bvy * 0.20;
          q[ix] = p[ix] - (p[ix] - q[ix]) * 0.44;
          q[iz] = p[iz] - (p[iz] - q[iz]) * 0.44;
          if (!s.thud && bvy < -0.07) {
            s.thud = true;
            var cm = CBZ.camera && CBZ.camera.position;
            if (cm && CBZ.sfx) {
              var tx = p[ix] - cm.x, tz = p[iz] - cm.z;
              if (tx * tx + tz * tz < 900) { try { CBZ.sfx("hit", { dist: Math.sqrt(tx * tx + tz * tz) }); } catch (e) {} }
            }
          }
        }
      }
      if (s.pin) applyPin(s);
    }
    // walls: only the EXTREMITIES get the shared circle-vs-box push (head,
    // tail, feet) — the same six-ish points ragdoll.js pushes, and for the same
    // reason: the torso is held between two axles of sticks and cannot get into
    // a wall on its own, so pushing it too would be four wasted queries a frame.
    if (CBZ.collide) {
      for (i = 0; i < n; i++) {
        if (i >= SHL && i <= HIPR) continue;              // torso quad: the sticks own it
        if (i === SPINE) continue;
        if (i >= LEG0 && (i - LEG0) % 2 === 0) continue;  // knees ride their feet
        ix = i * 3;
        _c.x = p[ix]; _c.y = p[ix + 1]; _c.z = p[ix + 2];
        try { CBZ.collide(_c, rad[i] * sc, p[ix + 1] - 0.1, p[ix + 1] + 0.1); } catch (e) {}
        p[ix] = _c.x; p[ix + 2] = _c.z;
      }
    }
    if (s.pin) applyPin(s);
    // never let a body freeze mid dying-beat: the roll moves slowly and would
    // otherwise be caught by the sleep test half way over.
    if (s.dyt <= 0 && Math.sqrt(maxd2) / h < SLEEP_V) s.still += dt; else s.still = 0;
    s.life += dt;

    // ---- THE INVARIANT: A CORPSE MAY NOT COME TO REST ON ITS FEET.
    // The kick's roll is an initial condition, and initial conditions can be
    // beaten: a heavy hit throws the body far enough that the beat expires in
    // mid-air, the legs trail out and it lands square on all fours (measured on
    // the tuned build — 2 trials in 12, and always the hardest hits). Chasing
    // that with impulse curves never fully closes it, and "a dead deer standing
    // up" is the ONE outcome this whole file exists to delete. So the solver
    // refuses it outright: a body that is settling and still upright re-arms the
    // beat, harder each time. Bounded, so it can never become a perpetual
    // motion machine, and it costs nothing on a corpse that fell correctly.
    // (the life clause matters: a body hurled a long way can still be sliding
    //  when MAX_LIFE forces it to sleep, so "settling" alone would never fire.)
    if (s.dyt <= 0 && (s.still > 0.12 || s.life > MAX_LIFE - 1.4) &&
        s.relight < RELIGHT_MAX && bodyUpY(s) > 0.62) {
      s.relight++;
      s.dyMax = s.dyt = 0.42;
      s.dyRoll = (2.1 + 1.4 * s.relight) * sc;   // each refusal pushes harder
      var qx = p[SHL * 3] - p[SHR * 3], qz = p[SHL * 3 + 2] - p[SHR * 3 + 2];
      var qll = Math.sqrt(qx * qx + qz * qz) || 1;
      var sgn = (Math.random() < 0.5 ? -1 : 1);
      s.dyPx = (qx / qll) * sgn; s.dyPz = (qz / qll) * sgn;
      s.still = 0; s.asleep = false;
      s.life = Math.min(s.life, MAX_LIFE - 0.6);   // give the re-armed roll room to run
    }
    if (!s.pin && (s.still > SLEEP_T || s.life > MAX_LIFE)) s.asleep = true;
  }

  // ==========================================================================
  //  WRITE-BACK — the solved points, back onto the actual meshes.
  //
  //  Pass 1 fits the group to the torso quad (this alone is the death pose:
  //  a body lying on its flank, following the real terrain slope). Pass 2
  //  walks the legs, head and tail into the group's LOCAL frame off their own
  //  points, which is what makes the limbs splay and the head loll instead of
  //  the corpse rotating as one welded prop.
  // ==========================================================================
  function writePose(s) {
    var a = s.act, rig = s.rig, grp = a && a.group;
    if (!grp) return;
    var p = s.p, sc = s.s || 1, inv = 1 / sc;
    var smx = (p[SHL * 3] + p[SHR * 3]) * 0.5, smy = (p[SHL * 3 + 1] + p[SHR * 3 + 1]) * 0.5, smz = (p[SHL * 3 + 2] + p[SHR * 3 + 2]) * 0.5;
    var hmx = (p[HIPL * 3] + p[HIPR * 3]) * 0.5, hmy = (p[HIPL * 3 + 1] + p[HIPR * 3 + 1]) * 0.5, hmz = (p[HIPL * 3 + 2] + p[HIPR * 3 + 2]) * 0.5;
    // FORWARD is hips -> shoulders (models are nose toward +X) and SIDE is the
    // shoulder line toward local +z. Local +z cross local +x is local +y, so
    // up = side x forward — get that handedness wrong and every corpse in the
    // game is upside down.
    _f.set(smx - hmx, smy - hmy, smz - hmz);
    _r.set(p[SHR * 3] - p[SHL * 3], p[SHR * 3 + 1] - p[SHL * 3 + 1], p[SHR * 3 + 2] - p[SHL * 3 + 2]);
    if (_f.lengthSq() < 1e-7 || _r.lengthSq() < 1e-7) return;
    _f.normalize();
    _u.crossVectors(_r, _f);
    if (_u.lengthSq() < 1e-7) return;
    _u.normalize();
    _r.crossVectors(_f, _u).normalize();          // re-orthogonalise the side axis
    _m.makeBasis(_f, _u, _r);                     // columns = local X, Y, Z
    _qt.setFromRotationMatrix(_m);
    grp.quaternion.copy(_qt);                     // syncs .rotation for every reader
    // anchor on the hip midpoint, whose model-local offset we know exactly
    _a.set(rig.hipX * sc, rig.bodyY * sc, rig.hipZ * sc).applyQuaternion(_qt);
    grp.position.set(hmx - _a.x, hmy - _a.y, hmz - _a.z);
    s.cx = (smx + hmx) * 0.5; s.cy = (smy + hmy) * 0.5; s.cz = (smz + hmz) * 0.5;
    _qi.copy(_qt).invert();

    // ---- legs: each part rides the attach -> knee -> foot polyline at its own
    //      authored height fraction, so a stacked paw/pad/stripe follows too.
    var cols = rig.cols, off = rig.off, i, j;
    for (i = 0; i < cols.length; i++) {
      var col = cols[i];
      var ki = col.ki * 3, fi = col.fi * 3, ai = col.ax * 3;
      _a.set(p[ai] - grp.position.x, p[ai + 1] - grp.position.y, p[ai + 2] - grp.position.z).applyQuaternion(_qi);
      var Ax = _a.x * inv, Ay = _a.y * inv, Az = _a.z * inv;
      _a.set(p[ki] - grp.position.x, p[ki + 1] - grp.position.y, p[ki + 2] - grp.position.z).applyQuaternion(_qi);
      var Kx = _a.x * inv, Ky = _a.y * inv, Kz = _a.z * inv;
      _a.set(p[fi] - grp.position.x, p[fi + 1] - grp.position.y, p[fi + 2] - grp.position.z).applyQuaternion(_qi);
      var Fx = _a.x * inv, Fy = _a.y * inv, Fz = _a.z * inv;
      for (j = 0; j < col.parts.length; j++) {
        var pt = col.parts[j];
        var cxp, cyp, czp, k2;
        if (pt.by <= col.y1) {
          k2 = (col.y1 > col.y0) ? cl((pt.by - col.y0) / (col.y1 - col.y0), 0, 1) : 0;
          cxp = Fx + (Kx - Fx) * k2; cyp = Fy + (Ky - Fy) * k2; czp = Fz + (Kz - Fz) * k2;
        } else {
          k2 = (col.y2 > col.y1) ? cl((pt.by - col.y1) / (col.y2 - col.y1), 0, 1) : 0;
          cxp = Kx + (Ax - Kx) * k2; cyp = Ky + (Ay - Ky) * k2; czp = Kz + (Az - Kz) * k2;
        }
        // the part's own off-axis offset (a paw pad set forward, a stripe set
        // out to the side) is preserved rather than collapsed onto the bone.
        pt.m.position.set(cxp + (pt.bx - col.x), cyp, czp + (pt.bz - col.z));
      }
    }

    // ---- head: rotate the whole cluster about the neck, off the solved head
    //      point. A rigid translate alone reads as a floating skull.
    if (rig.head) {
      _a.set(p[HEAD * 3] - grp.position.x, p[HEAD * 3 + 1] - grp.position.y, p[HEAD * 3 + 2] - grp.position.z).applyQuaternion(_qi);
      var hlx = _a.x * inv, hly = _a.y * inv, hlz = _a.z * inv;
      _d0.set(rig.hx - rig.neckX, rig.hy - rig.neckY, rig.hz - rig.neckZ);
      _d1.set(hlx - rig.neckX, hly - rig.neckY, hlz - rig.neckZ);
      if (_d0.lengthSq() > 1e-8 && _d1.lengthSq() > 1e-8) {
        _d0.normalize(); _d1.normalize();
        _qh.setFromUnitVectors(_d0, _d1);
        for (i = 0; i < rig.head.length; i++) {
          var hb = rig.head[i];
          _b.set(hb.bx - rig.neckX, hb.by - rig.neckY, hb.bz - rig.neckZ).applyQuaternion(_qh);
          hb.m.position.set(rig.neckX + _b.x, rig.neckY + _b.y, rig.neckZ + _b.z);
        }
      }
    }

    // ---- tail: the same swing, hung off the hips.
    if (rig.tail) {
      _a.set(p[TAIL * 3] - grp.position.x, p[TAIL * 3 + 1] - grp.position.y, p[TAIL * 3 + 2] - grp.position.z).applyQuaternion(_qi);
      var tlx = _a.x * inv, tly = _a.y * inv, tlz = _a.z * inv;
      _d0.set(rig.tx - rig.hipX, rig.ty - rig.hipY, rig.tz - rig.hipZ);
      _d1.set(tlx - rig.hipX, tly - rig.hipY, tlz - rig.hipZ);
      if (_d0.lengthSq() > 1e-8 && _d1.lengthSq() > 1e-8) {
        _d0.normalize(); _d1.normalize();
        _qh.setFromUnitVectors(_d0, _d1);
        for (i = 0; i < rig.tail.length; i++) {
          var tb = rig.tail[i];
          _b.set(tb.bx - rig.hipX, tb.by - rig.hipY, tb.bz - rig.hipZ).applyQuaternion(_qh);
          tb.m.position.set(rig.hipX + _b.x, rig.hipY + _b.y, rig.hipZ + _b.z);
        }
      }
    }
    // r128 freezes hidden animals' matrices (wildlife.js's setLiveMats). We are
    // range-gated well inside every LOD radius, but a corpse that flips hidden
    // mid-solve must not keep a stale matrix — cheap and unconditional.
    if (grp.matrixAutoUpdate === false) { try { grp.updateMatrix(); } catch (e) {} }
  }

  // ==========================================================================
  //  PUBLIC API
  // ==========================================================================
  // CBZ.quadRagdoll(actor, {point, dir, imp}) -> bool
  //   true  = this file now owns the corpse's transform; the caller must NOT
  //           run its own tumble/topple.
  //   false = declined (flag off, no readable legs, out of range, budget full)
  //           — the caller runs CBZ.wildlifeDeathTumble instead.
  CBZ.quadRagdoll = function (actor, opts) {
    try { return start(actor, opts); } catch (e) { return false; }
  };
  CBZ.quadRagdollActive = function (actor) {
    if (!actor || actor._quadSlot == null) return false;
    var s = slots[actor._quadSlot];
    return !!(s && s.used && s.act === actor);
  };
  // "is a quadruped ragdoll even POSSIBLE for this actor" — asked before a
  // death so a caller can pick its path without starting anything.
  CBZ.quadRagdollCan = function (actor) {
    if (!ON() || !actor || !actor.group) return false;
    try { return !!buildRig(actor); } catch (e) { return false; }
  };

  // ---- PIN: the animal sibling of CBZ.ragdollPin. A jaw holds one point and
  //      the rest of the skeleton whips off it — which is the whole difference
  //      between a carcass being carried and a carcass being SHAKEN.
  var PIN_PTS = { torso: [SHL, SHR], head: [HEAD], hips: [HIPL, HIPR], tail: [TAIL] };
  var PIN_MAX = 8;
  CBZ.quadRagdollPin = function (actor, opts) {
    if (!actor) return false;
    opts = opts || {};
    var s = (actor._quadSlot != null) ? slots[actor._quadSlot] : null;
    if (!s || !s.used || s.act !== actor) {
      if (!CBZ.quadRagdoll(actor, { imp: 1 })) return false;
      s = (actor._quadSlot != null) ? slots[actor._quadSlot] : null;
      if (!s || !s.used || s.act !== actor) return false;
    }
    var pts = PIN_PTS[opts.point] || PIN_PTS.torso, p = s.p;
    var mx = 0, my = 0, mz = 0;
    for (var k = 0; k < pts.length; k++) { var i = pts[k] * 3; mx += p[i]; my += p[i + 1]; mz += p[i + 2]; }
    var inv = 1 / pts.length;
    s.pin = {
      pts: pts,
      at: typeof opts.at === "function" ? opts.at : null,
      t: Math.max(0.05, Math.min(PIN_MAX, opts.until == null ? 3 : opts.until)),
      stiff: Math.max(0, Math.min(1, opts.stiff == null ? 1 : opts.stiff)),
      x: mx * inv, y: my * inv, z: mz * inv,
    };
    s.asleep = false; s.still = 0; s.age = ++seq;
    return true;
  };
  CBZ.quadRagdollUnpin = function (actor) {
    if (!actor || actor._quadSlot == null) return;
    var s = slots[actor._quadSlot];
    if (s && s.used && s.act === actor) s.pin = null;
  };

  CBZ.quadRagdollAudit = function () {
    var act = 0, sleep = 0, pinned = 0;
    for (var i = 0; i < POOL; i++) {
      var s = slots[i]; if (!s.used) continue;
      if (s.asleep) sleep++; else act++;
      if (s.pin) pinned++;
    }
    return { solving: act, frozen: sleep, pinned: pinned, pool: POOL, cap: MAX_ACTIVE(), started: started, refused: refused };
  };

  // ==========================================================================
  //  THE UPDATER — 47.5: after wildlife.js's tick (47.1) and after the seize
  //  (47.35), so the pose we write is the last word on a corpse for the frame.
  //  A SLEEPING body is not written at all, which is deliberate: its meshes
  //  already hold the frozen pose, and NOT writing is what lets wildlife.js's
  //  skinned-husk sink still lower the group.
  // ==========================================================================
  if (CBZ.onUpdate) CBZ.onUpdate(47.5, function (dt) {
    if (!(dt > 0)) return;
    for (var i = 0; i < POOL; i++) {
      var s = slots[i];
      if (!s.used) continue;
      var a = s.act;
      if (!a || !a.group || !a.group.parent || !a.dead || !ON()) { releaseSlot(s); continue; }
      if (s.pin) {
        s.pin.t -= dt;
        if (s.pin.t <= 0) s.pin = null;
        else { s.asleep = false; s.still = 0; }
      }
      waterProbe(s);
      if (!s.asleep) { solve(s, dt); writePose(s); }
      else if (s.wet) { bobAsleep(s); writePose(s); }
    }
  });
})();
