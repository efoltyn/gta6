/* ============================================================
   systems/stairs.js — CBZ.stairs: THE ONE STAIR SYSTEM, EVERY GAME.

   OWNER: "going up the stairs is impossible too. I want a stairs agent."

   WHY IT WAS IMPOSSIBLE (measured / read, 2026-09-28):
     • Every stair builder hand-rolled its own walk surface. Each re-derived
       the same three facts (a ramp record for groundAt, an overlap into the
       landings, something under the flight so nobody walks into its soffit)
       and each got a different one wrong. The prison's cell-block flight put
       its "don't walk under the stairs" wall over the stairs THEMSELVES
       (a full-width [0, 1.9 m] box on the flight's own footprint): a body on
       the bottom tread had its feet inside that band, so the flight was a
       wall from the floor. Nobody could board it, player or inmate.
     • Nothing told an AI that one floor connects to another. navgrid is a
       2-D grid; a guard whose target is a storey up walks to the spot under
       the target and stands there.

   WHAT THIS FILE IS. Two things, both small:

   1. THE WALK SURFACE OF A FLIGHT — CBZ.stairs.flight(spec). One call builds
      the collision a staircase needs and nothing a builder can get wrong:
        · ONE ramp platform record per flight, footprint stretched `overlap`
          past both nosings so it overlaps the landings (groundAt clamps the
          ramp's t to [0,1], so the stretch is FLAT at the landing heights:
          no seam can drop a fast body through).
        · any direction: an axis-aligned flight gets the frozen {z0,z1} /
          {axis:"x"} ramp shape; a diagonal flight an oriented footprint
          (`obb`) + a direction ramp (`dir`) — physics.js groundAt reads both.
        · optional UNDERSIDE: stepped y-banded colliders under the flight whose
          tops trail the ramp by LAG metres of run. A body ON the flight always
          has its feet above the band it stands over (it is skipped); a body on
          the floor below is stopped where the soffit gets lower than a head.
        · registers the flight as a LINK (below) so every AI can use it.
      Treads, risers, stringers, rails stay the builder's own (they are what
      each game's stair LOOKS like); they must be deco, never colliders.

   2. THE LINKS BETWEEN LEVELS — CBZ.stairs.link / route. A link is a walk
      path bottom→top (world points with y). route(from, to) chains links
      whose ends share a level (|dy| < LEVEL_DY) into one waypoint list, so a
      switchback of two flights, or three flights of a stair core, is simply
      three links and needs no special case. Callers walk the list point to
      point on their own locomotion; groundAt carries the Y.

   Loads right after systems/solidground.js (before any world builder: the
   prison cell block builds at parse time). Owns no update loop.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (!CBZ.platforms) CBZ.platforms = [];
  if (!CBZ.colliders) CBZ.colliders = [];

  const LEVEL_DY = 0.9;       // two points within this height are the same floor
  const SAME_FLOOR_REACH = 70; // max walk between two link ends on one floor
  const QUERY_R = 180;        // links further than this from both ends are ignored
  const LAG = 0.55;           // underside band trails the ramp by this much run
  const SOFFIT_MIN = 0.35;    // no underside where the flight is lower than this

  const links = [];
  let version = 0;

  function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

  /* ---- LINKS ---------------------------------------------------------- */
  // rec: { path:[{x,y,z},…] bottom→top (≥2 points), width?, kind?, owner? }
  function link(rec) {
    if (!rec || !Array.isArray(rec.path) || rec.path.length < 2) return null;
    const p = rec.path;
    let len = 0;
    for (let i = 1; i < p.length; i++) len += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y, p[i].z - p[i - 1].z);
    rec.len = len;
    rec.a = p[0]; rec.b = p[p.length - 1];
    rec.id = links.length ? links[links.length - 1].id + 1 : 1;
    links.push(rec);
    version++;
    return rec;
  }
  // drop every link (and the platforms/colliders flight() made) for an owner
  function removeOwner(owner) {
    if (owner == null) return 0;
    let n = 0;
    for (let i = links.length - 1; i >= 0; i--) {
      const L = links[i];
      if (L.owner !== owner) continue;
      links.splice(i, 1); n++;
      if (L.plats) for (const pl of L.plats) { const j = CBZ.platforms.indexOf(pl); if (j >= 0) CBZ.platforms.splice(j, 1); }
      if (L.cols) for (const c of L.cols) { const j = CBZ.colliders.indexOf(c); if (j >= 0) CBZ.colliders.splice(j, 1); }
    }
    if (n) {
      version++;
      if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    return n;
  }

  /* ---- THE FLIGHT ---------------------------------------------------- */
  /* spec:
       bottom {x,y,z}   centre of the bottom nosing line (where the first riser
                        leaves the lower floor), y = lower floor walk height
       top    {x,y,z}   centre of the top nosing line, y = upper floor height
       width            clear width across the flight (m)
       overlap          flat stretch past each end, default 0.35 (into landings)
       underside        true → stepped soffit colliders under the flight
       owner            anything; removeOwner(owner) undoes the lot
       plats, cols      optional arrays the builder also wants the records in
                        (e.g. a building's own b.platforms for demolition)
       link             false → walk surface only, no AI link
       kind             label for the link ("stair", "ladder", …)
     returns { plat, cols, link } */
  function flight(spec) {
    const B = spec.bottom, T = spec.top;
    const w = Math.max(0.4, +spec.width || 1.0);
    const ov = spec.overlap != null ? +spec.overlap : 0.35;
    let ux = T.x - B.x, uz = T.z - B.z;
    const run = Math.hypot(ux, uz);
    if (!(run > 0.05)) return null;
    ux /= run; uz /= run;
    const px = uz, pz = -ux;                 // across the flight (right-hand)
    const hw = w / 2;
    let plat;
    const AX = Math.abs(ux) < 1e-4, AZ = Math.abs(uz) < 1e-4;
    if (AX || AZ) {
      // axis-aligned: the frozen shape every existing ramp record uses
      const e0x = B.x - ux * ov, e0z = B.z - uz * ov, e1x = T.x + ux * ov, e1z = T.z + uz * ov;
      plat = {
        minX: Math.min(e0x, e1x) - Math.abs(px) * hw, maxX: Math.max(e0x, e1x) + Math.abs(px) * hw,
        minZ: Math.min(e0z, e1z) - Math.abs(pz) * hw, maxZ: Math.max(e0z, e1z) + Math.abs(pz) * hw,
        top: Math.max(B.y, T.y),
        ramp: AX ? { z0: B.z, z1: T.z, y0: B.y, y1: T.y }
                 : { axis: "x", x0: B.x, x1: T.x, y0: B.y, y1: T.y },
      };
    } else {
      // diagonal: oriented footprint + direction ramp (physics.js groundAt)
      const hl = run / 2 + ov;
      const cx = (B.x + T.x) / 2, cz = (B.z + T.z) / 2;
      const ex = Math.abs(ux) * hl + Math.abs(px) * hw, ez = Math.abs(uz) * hl + Math.abs(pz) * hw;
      plat = {
        minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez,
        top: Math.max(B.y, T.y),
        obb: { cx: cx, cz: cz, ux: ux, uz: uz, hl: hl, hw: hw },
        ramp: { dir: true, ox: B.x, oz: B.z, dx: ux, dz: uz, len: run, y0: B.y, y1: T.y },
      };
    }
    plat.stair = true;
    CBZ.platforms.push(plat);
    if (spec.plats) spec.plats.push(plat);

    const cols = [];
    if (spec.underside) {
      // stepped soffit bands, each topped at the ramp height LAG metres of run
      // behind its own low edge: a climber's feet are always above the band
      // under him; a floor-walker meets it once the flight is over his waist.
      const rise = T.y - B.y;
      const seg = 0.5;
      const n = Math.max(1, Math.ceil(run / seg));
      const yaw = Math.atan2(ux, uz);
      for (let i = 0; i < n; i++) {
        const s0 = i * run / n, s1 = (i + 1) * run / n;
        const h = rise * Math.max(0, (s0 - LAG) / run);
        if (h < SOFFIT_MIN) continue;
        const sm = (s0 + s1) / 2;
        const cx = B.x + ux * sm, cz = B.z + uz * sm;
        const hd = (s1 - s0) / 2;
        const c = orientedBox(cx, cz, hw, hd, yaw, Math.min(B.y, T.y) - 0.05, B.y + h);
        c.stairSoffit = true;
        CBZ.colliders.push(c); cols.push(c);
        if (spec.cols) spec.cols.push(c);
      }
      if (cols.length && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();

    let L = null;
    if (spec.link !== false) {
      // walk path: a step clear of each nosing, so an AI arriving at the end
      // of the list is standing on the landing, not on the last tread
      const out = Math.min(0.45, ov * 0.85);   // inside the flat overlap even with no landing built
      L = link({
        path: [
          { x: B.x - ux * out, y: B.y, z: B.z - uz * out },
          { x: B.x, y: B.y, z: B.z },
          { x: T.x, y: T.y, z: T.z },
          { x: T.x + ux * out, y: T.y, z: T.z + uz * out },
        ],
        width: w, kind: spec.kind || "stair", owner: spec.owner != null ? spec.owner : null,
      });
      if (L) { L.plats = [plat]; L.cols = cols; }
    }
    return { plat: plat, cols: cols, link: L };
  }

  // same record shape as physics.js CBZ.orientedCollider (which loads later
  // than the prison's parse-time build, so this file carries its own copy of
  // the ten lines rather than depending on load order)
  function orientedBox(cx, cz, hw, hd, yaw, y0, y1) {
    const co = Math.cos(yaw), si = Math.sin(yaw);
    const ac = Math.abs(co), as = Math.abs(si);
    const ex = hw * ac + hd * as, ez = hw * as + hd * ac;
    const c = { minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, y0: y0, y1: y1 };
    if (as > 1e-4 && ac > 1e-4) { c.cx = cx; c.cz = cz; c.hw = hw; c.hd = hd; c.yaw = yaw; }
    return c;
  }

  /* ---- ROUTING ------------------------------------------------------- */
  /* route(from, to) → waypoints [{x,y,z}] ending at `to`, or [] when both are
     on one level (walk straight / let navgrid steer), or null when no chain
     of links joins the two levels. Dijkstra over link ends; small graph
     (only links within QUERY_R of either end), no allocation worth caching. */
  function sameLevel(a, b) { return Math.abs(a.y - b.y) < LEVEL_DY; }
  /* A LINK WHOSE FLIGHT IS GONE IS NOT A ROUTE. Every teardown in the game
     (a quake collapse, a nuke, a player-built piece knocked down) takes the
     flight's platform out of CBZ.platforms and none of them has to know this
     file exists: route() only offers a link whose own walk surface is still
     in the world. Membership Set rebuilt when the platform array changes size. */
  let liveSet = null, liveLen = -1;
  function standing(L) {
    const p = L.plats && L.plats[0];
    if (!p) return true;                         // a bare link (ladder): trust its owner
    const plats = CBZ.platforms;
    if (!liveSet || liveLen !== plats.length) { liveSet = new Set(plats); liveLen = plats.length; }
    return liveSet.has(p);
  }
  // opts.ladders: include kind "ladder" links (a near-vertical climb no
  // walking AI can do on its ramp-less feet); off by default
  function route(from, to, opts) {
    if (!from || !to) return null;
    if (sameLevel(from, to)) return [];
    const ladders = !!(opts && opts.ladders);
    const R2 = QUERY_R * QUERY_R, S2 = SAME_FLOOR_REACH * SAME_FLOOR_REACH;
    const cand = [];
    for (let i = 0; i < links.length; i++) {
      const L = links[i];
      if (L.off || (!ladders && L.kind === "ladder")) continue;   // off = its building is rubble
      const near = dist2(L.a.x, L.a.z, from.x, from.z) < R2 || dist2(L.a.x, L.a.z, to.x, to.z) < R2 ||
                   dist2(L.b.x, L.b.z, from.x, from.z) < R2 || dist2(L.b.x, L.b.z, to.x, to.z) < R2;
      if (near && standing(L)) cand.push(L);
    }
    if (!cand.length) return null;
    // nodes: 0 = from, 1 = to, then 2+2i = cand[i].a, 3+2i = cand[i].b
    const N = 2 + cand.length * 2;
    const P = new Array(N);
    P[0] = from; P[1] = to;
    for (let i = 0; i < cand.length; i++) { P[2 + 2 * i] = cand[i].a; P[3 + 2 * i] = cand[i].b; }
    const D = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    D[0] = 0;
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < N; i++) if (!done[i] && D[i] < best) { best = D[i]; u = i; }
      if (u < 0 || u === 1) break;
      done[u] = 1;
      const pu = P[u];
      // along a link
      if (u >= 2) {
        const li = (u - 2) >> 1, other = (u & 1) ? u - 1 : u + 1;
        const c = D[u] + cand[li].len * 1.15;       // stairs are a little slower than floor
        if (c < D[other]) { D[other] = c; prev[other] = u; }
      }
      // across a floor, to any node on the same level within reach
      for (let v = 1; v < N; v++) {
        if (done[v] || v === u) continue;
        const pv = P[v];
        if (!sameLevel(pu, pv)) continue;
        const d2 = dist2(pu.x, pu.z, pv.x, pv.z);
        if (d2 > S2 && v !== 1) continue;
        const c = D[u] + Math.sqrt(d2) + 0.5;
        if (c < D[v]) { D[v] = c; prev[v] = u; }
      }
    }
    if (!(D[1] < Infinity)) return null;
    // unwind, expanding each link hop into its full path
    const nodes = [];
    for (let v = 1; v !== -1; v = prev[v]) nodes.push(v);
    nodes.reverse();
    const out = [];
    for (let k = 1; k < nodes.length; k++) {
      const a = nodes[k - 1], b = nodes[k];
      if (a >= 2 && b >= 2 && ((a - 2) >> 1) === ((b - 2) >> 1)) {
        const L = cand[(a - 2) >> 1];
        const fwd = (a & 1) === 0;                  // a is the bottom end
        const p = L.path;
        if (fwd) for (let i = 1; i < p.length; i++) out.push({ x: p[i].x, y: p[i].y, z: p[i].z, stair: true });
        else for (let i = p.length - 2; i >= 0; i--) out.push({ x: p[i].x, y: p[i].y, z: p[i].z, stair: true });
      } else {
        const q = P[b];
        out.push({ x: q.x, y: q.y, z: q.z });
      }
    }
    return out;
  }

  // the flight under a point (for feet placement / animation), or null
  function flightAt(x, z, y) {
    const plats = CBZ.platforms;
    for (let i = 0; i < links.length; i++) {
      const L = links[i];
      if (!L.plats || !L.plats.length) continue;
      if (y != null && (y < Math.min(L.a.y, L.b.y) - 0.5 || y > Math.max(L.a.y, L.b.y) + 0.5)) continue;
      for (let j = 0; j < L.plats.length; j++) {
        const pl = L.plats[j];
        if (!pl.ramp || x < pl.minX || x > pl.maxX || z < pl.minZ || z > pl.maxZ) continue;
        if (plats.indexOf(pl) < 0) continue;
        return L;
      }
    }
    return null;
  }

  /* walkAudit(radius) — walk every link up and down at 5 cm steps on the
     same ground law the player uses (walkGroundAt, collide) and list the
     ones a body cannot finish. Console/probe tool, never called per frame. */
  function walkAudit(radius) {
    const r = radius || 0.38;
    const G = CBZ.walkGroundAt || CBZ.groundAt;
    const bad = [];
    const pos = { x: 0, y: 0, z: 0 };
    function walk(path) {
      let y = path[0].y, pushes = 0, maxUp = 0;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], c = path[i];
        const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 0.05));
        for (let s = 1; s <= n; s++) {
          const x = a.x + (c.x - a.x) * s / n, z = a.z + (c.z - a.z) * s / n;
          const g = G(x, z, y);
          if (g - y > maxUp) maxUp = g - y;
          y = g;                                    // a fall is a fall; the end check catches it
          pos.x = x; pos.z = z;
          if (CBZ.collide) { CBZ.collide(pos, r, y + 0.42, y + 1.7); if (Math.hypot(pos.x - x, pos.z - z) > 0.03) pushes++; }
        }
      }
      const end = path[path.length - 1];
      return { endErr: +(y - end.y).toFixed(2), pushes: pushes, maxUp: +maxUp.toFixed(2) };
    }
    for (const L of links) {
      const up = walk(L.path), down = walk(L.path.slice().reverse());
      if (Math.abs(up.endErr) > 0.3 || Math.abs(down.endErr) > 0.3 || up.pushes > 3 || down.pushes > 3) {
        bad.push({ id: L.id, kind: L.kind, a: [+L.a.x.toFixed(1), +L.a.y.toFixed(1), +L.a.z.toFixed(1)], up: up, down: down });
      }
    }
    return { links: links.length, bad: bad.length, samples: bad.slice(0, 20) };
  }

  CBZ.stairs = {
    walkAudit: walkAudit,
    LEVEL_DY: LEVEL_DY,
    flight: flight,
    link: link,
    removeOwner: removeOwner,
    // a demolished building keeps its records (a heal re-seats them): its links go dormant
    setOwnerActive: function (owner, on) {
      let n = 0;
      for (const L of links) if (L.owner === owner) { L.off = !on; n++; }
      if (n) version++;
      return n;
    },
    route: route,
    flightAt: flightAt,
    links: function () { return links; },
    version: function () { return version; },
    audit: function () {
      let soffits = 0, diag = 0;
      for (const L of links) { if (L.cols) soffits += L.cols.length; if (L.plats && L.plats[0] && L.plats[0].obb) diag++; }
      return { links: links.length, soffitColliders: soffits, diagonal: diag, version: version };
    },
  };
})();
