/* ============================================================
   systems/leave.js — CBZ.leave: PEOPLE WALK OUT. NOBODY VANISHES.

   OWNER (2026-10-14, the President's office): "There's a guy who starts on
   my left, says 'three folders on your desk, sir', and then he disappears. I
   don't like how people disappear. They need to walk out of the room. It's
   dumb. Find the code that lets people just disappear."

   Every game had its own last line for a person whose part was over: a
   staffer, an aide, a dismissed officer, a delivery man, a cutscene extra.
   It was always the same line, `unpost(p)` / `group.parent.remove(...)`, and
   it ran the moment he reached a point a metre or two away, or a timer ran
   out, or the room decided he was surplus: in the middle of the room, in
   front of the player. This is the one rule instead:

     1. HE WALKS OUT. Along the route the caller knows (the office's staff
        door and the corridor past it), or to the nearest exit it offers, or,
        with neither, away from the camera on the navigator. His own legs (the
        body's own mover: CBZ.moves under city/peds.js or the plain actor's
        target), so doors open in front of him (systems/bodydoors.js) and
        shut behind him.
     2. HE IS REMOVED ONLY WHEN NOBODY CAN SEE HIM: outside the camera's
        frustum, or behind something solid (rays from the camera to his head,
        chest and knees all stopped by CBZ.rayColliders), or past FAR metres
        (the crowd stops drawing at 95). Never a pop in view. A man who has
        walked his whole route and is still in plain sight keeps walking the
        way he was going; if he cannot, he stands there, facing away, until
        the camera leaves him. He does not vanish.
     3. A body that dies on the way stays (the corpse law, systems/bodyfall.js);
        one taken into custody is custody's (city/custody.js).

     CBZ.leave.go(body, opts) -> record      start walking him out
       opts.route  [{x, z, door?}]  the waypoints to the exit (a `door: true`
                                    point stamps throughDoorAt when passed)
       opts.exits  [{x, z, route?}] candidate exits: the nearest is taken
       opts.walk   fn(body, x, z)   how this body is told to walk (default:
                                    a city ped's controlled path, or a plain
                                    actor's target)
       opts.remove fn(body)         how he leaves the world (default:
                                    CBZ.cityUnpostNpc, else unparent his rig)
       opts.far    metres           the distance fallback (default 90)
       opts.onGone fn(body, info)   info = { walked, t, throughDoorAt, inView }
       opts.tag    string           who sent him (audit)
     CBZ.leave.unseen(pos [, opts]) -> bool   the visibility rule on its own
     CBZ.leave.seen(pos)            -> { inFrustum, occluded, dist }
     CBZ.leave.busy(body)           -> bool   is he on his way out
     CBZ.leave.audit()              -> walking now, removed, removedInView (0)

   Update order 36.6: after city/peds.js (34) has moved the crowd and the
   staff files (36.25) have handed their people over.
============================================================ */
(function () {
  "use strict";
  const CBZ = (typeof window !== "undefined" ? window : globalThis).CBZ;
  if (!CBZ) return;

  const FAR = 90;              // the crowd stops drawing at 95 m (city/peds.js VIS_D2)
  const ARRIVE = 0.7;          // a waypoint is passed within this
  const CHECK = 0.2;           // seconds between visibility checks
  const REISSUE = 0.6;         // seconds between "keep walking" nudges
  const EXTEND = 4.0;          // metres walked on past the route's end while seen
  const STUCK_T = 4.0;         // no 0.35 m of progress in this long: next waypoint

  const LIVE = [];
  let removed = 0, removedInView = 0, lastInfo = null;

  // ---- WHERE IS HE ----------------------------------------------------------
  function posOf(b) { return b ? (b.pos || (b.group && b.group.position) || null) : null; }

  // ---- CAN ANYBODY SEE HIM --------------------------------------------------
  let _fr = null, _pm = null, _sp = null;
  const _hit = { hit: false };
  const RAY_OPTS = { any: true, noCam: true, minT: 0.05 };
  function inFrustum(x, y, z) {
    const cam = CBZ.camera, THREE = (typeof window !== "undefined" ? window : globalThis).THREE;
    if (!cam || !THREE || !cam.projectionMatrix) return false;
    if (!_fr) { _fr = new THREE.Frustum(); _pm = new THREE.Matrix4(); _sp = new THREE.Sphere(); }
    cam.updateMatrixWorld();
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_pm);
    _sp.center.set(x, y + 0.9, z); _sp.radius = 0.95;          // a standing man, padded
    return _fr.intersectsSphere(_sp);
  }
  // one ray from the camera to a point on him: stopped by something solid?
  function rayStopped(cx, cy, cz, x, y, z) {
    if (typeof CBZ.rayColliders !== "function") return false;  // cannot tell: assume he shows
    const dx = x - cx, dy = y - cy, dz = z - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.6) return false;
    // the last 0.45 m is his own (the door leaf he is pushing, the wall he passes)
    try { return !!CBZ.rayColliders(cx, cy, cz, dx / d, dy / d, dz / d, d - 0.45, _hit, RAY_OPTS); } catch (e) { return false; }
  }
  function occluded(x, y, z) {
    const cam = CBZ.camera;
    if (!cam || !cam.position) return false;
    const c = cam.position;
    // head, chest, knees: any one of them showing is him showing
    return rayStopped(c.x, c.y, c.z, x, y + 1.62, z) && rayStopped(c.x, c.y, c.z, x, y + 1.1, z) && rayStopped(c.x, c.y, c.z, x, y + 0.5, z);
  }
  function seen(pos) {
    const cam = CBZ.camera;
    if (!pos) return { inFrustum: false, occluded: true, dist: Infinity };
    const y = pos.y || 0;
    const c = cam && cam.position;
    const dist = c ? Math.hypot(pos.x - c.x, y - c.y, pos.z - c.z) : Infinity;
    const f = inFrustum(pos.x, y, pos.z);
    return { inFrustum: f, occluded: f ? occluded(pos.x, y, pos.z) : false, dist: dist };
  }
  function unseen(pos, opts) {
    if (!pos) return true;
    const cam = CBZ.camera;
    if (!cam || !cam.position) return true;                  // no eye in this world
    const far = (opts && opts.far) || FAR;
    const c = cam.position, y = pos.y || 0;
    const dx = pos.x - c.x, dz = pos.z - c.z;
    if (dx * dx + dz * dz > far * far) return true;
    if (!inFrustum(pos.x, y, pos.z)) return true;
    return occluded(pos.x, y, pos.z);
  }

  // ---- HOW A BODY IS TOLD TO WALK -------------------------------------------
  function isCityPed(b) { const L = CBZ.cityPeds; return !!(L && L.indexOf(b) >= 0); }
  function walkDefault(b, x, z) {
    if (!b || b.dead) return;
    if (b.pos && ("finalGoal" in b || isCityPed(b))) {
      // a city ped: a controlled path (peds.js walks it on CBZ.moves; the
      // street brain keeps its hands off a controlled body)
      b.controlled = true; b.staffPost = null; b.vendor = false;
      b.path = [{ x: x, z: z }]; b.finalGoal = { x: x, z: z };
      if (b.target && b.target.set) b.target.set(x, 0, z);
      b.state = "walk"; b.pause = 0;
      return;
    }
    // a plain actor (the prison's npcs, the lab's person): its target
    if (b.target && b.target.set) b.target.set(x, b.target.y || 0, z);
    b.pause = 0;
    if (b.aiState != null) b.aiState = "walk";
  }
  function holdDefault(b, face) {
    if (!b || b.dead) return;
    const p = posOf(b);
    if (b.pos && ("finalGoal" in b || isCityPed(b))) { b.path = null; b.finalGoal = null; b.state = "idle"; b.speed = 0; b.pause = 1; }
    if (p && b.target && b.target.set) b.target.set(p.x, b.target.y || 0, p.z);
    if (face != null && b.group) b.group.rotation.y = face;
  }
  function removeDefault(b) {
    if (CBZ.cityUnpostNpc && isCityPed(b)) { if (CBZ.cityUnpostNpc(b)) return; }
    try {
      if (b.group && b.group.parent) b.group.parent.remove(b.group);
      const L = CBZ.npcs; if (L) { const i = L.indexOf(b); if (i >= 0) L.splice(i, 1); }
    } catch (e) {}
  }

  // ---- WHERE IS OUT ---------------------------------------------------------
  function d2(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return dx * dx + dz * dz; }
  // with no route and no exit: thirty metres AWAY from the camera, on the
  // navigator when it covers him (doors, not walls), else straight
  function awayRoute(p) {
    const cam = CBZ.camera;
    let hx = 0, hz = 1;
    if (cam && cam.position) { hx = p.x - cam.position.x; hz = p.z - cam.position.z; }
    const l = Math.hypot(hx, hz) || 1;
    hx /= l; hz /= l;
    const to = { x: p.x + hx * 30, z: p.z + hz * 30 };
    const G = CBZ.navGrid;
    if (G && G.ready && G.ready() && G.inWindow && G.inWindow(p.x, p.z) && G.plan && Math.abs(p.y || 0) < 1.2) {
      let pts = null;
      try { pts = G.plan({ x: p.x, z: p.z }, to); } catch (e) { pts = null; }
      if (pts && pts.length) return pts.map(function (q) { return { x: q.x, z: q.z }; });
    }
    return [to];
  }

  function go(b, opts) {
    opts = opts || {};
    const p = posOf(b);
    if (!b || !p) return null;
    if (b.dead) return null;
    const had = rec(b);
    if (had) LIVE.splice(LIVE.indexOf(had), 1);
    let route = opts.route ? opts.route.slice() : null;
    if (!route && opts.exits && opts.exits.length) {
      let best = null, bd = Infinity;
      for (let i = 0; i < opts.exits.length; i++) {
        const e = opts.exits[i];
        if (!e) continue;
        const dd = d2(p, e);
        if (dd < bd) { bd = dd; best = e; }
      }
      if (best) route = (best.route || []).concat([{ x: best.x, z: best.z, door: !!best.door }]);
    }
    if (!route || !route.length) route = awayRoute(p);
    const r = {
      b: b, route: route, i: 0, t: 0, walked: 0, lx: p.x, lz: p.z,
      chk: 0, nudge: REISSUE, prog: 0, progX: p.x, progZ: p.z, ext: 0,
      throughDoorAt: null, tag: opts.tag || null, far: opts.far || FAR,
      walk: opts.walk || walkDefault, hold: opts.hold || holdDefault, remove: opts.remove || removeDefault,
      onGone: opts.onGone || null, minT: opts.minT != null ? opts.minT : 0.25,
    };
    b._leaving = r;
    LIVE.push(r);
    const w = route[0];
    try { r.walk(b, w.x, w.z); } catch (e) {}
    return r;
  }
  function rec(b) { return b && b._leaving && LIVE.indexOf(b._leaving) >= 0 ? b._leaving : null; }
  function cancel(b) {
    const r = rec(b);
    if (!r) return false;
    LIVE.splice(LIVE.indexOf(r), 1);
    b._leaving = null;
    return true;
  }

  function finish(r, inView) {
    const b = r.b;
    const info = { walked: Math.round(r.walked * 10) / 10, t: Math.round(r.t * 100) / 100, throughDoorAt: r.throughDoorAt, inView: !!inView, tag: r.tag };
    try { r.remove(b); } catch (e) {}
    b._leaving = null;
    removed++;
    if (inView) removedInView++;
    lastInfo = info;
    if (r.onGone) { try { r.onGone(b, info); } catch (e) {} }
  }

  function tick(dt) {
    if (!LIVE.length) return;
    dt = Math.min(0.1, dt || 0.016);
    for (let k = LIVE.length - 1; k >= 0; k--) {
      const r = LIVE[k], b = r.b;
      const p = posOf(b);
      // dead on the way: the body is the world's now (the corpse law);
      // in custody: custody's (city/custody.js); removed by somebody else
      if (!p || b.dead || (CBZ.custody && CBZ.custody.holds && CBZ.custody.holds(b)) ||
          (b.group && !b.group.parent)) {
        LIVE.splice(k, 1); b._leaving = null; continue;
      }
      r.t += dt;
      r.walked += Math.hypot(p.x - r.lx, p.z - r.lz);
      r.lx = p.x; r.lz = p.z;
      // ---- the route ----
      const w = r.route[r.i];
      if (w) {
        const dw = Math.hypot(p.x - w.x, p.z - w.z);
        r.prog += dt;
        if (Math.hypot(p.x - r.progX, p.z - r.progZ) > 0.35) { r.prog = 0; r.progX = p.x; r.progZ = p.z; }
        if (dw < ARRIVE || r.prog > STUCK_T) {
          if (w.door && r.throughDoorAt == null && dw < ARRIVE + 0.3) r.throughDoorAt = Math.round(r.t * 100) / 100;
          r.i++; r.prog = 0; r.nudge = 0;
          const n = r.route[r.i];
          if (n) { try { r.walk(b, n.x, n.z); } catch (e) {} }
        } else if ((r.nudge -= dt) <= 0) {
          // somebody (a brain, a flinch) took his walk: give it back
          r.nudge = REISSUE;
          try { r.walk(b, w.x, w.z); } catch (e) {}
        }
      } else if (r.ext < 3) {
        // the route is walked and he is still in sight: on, the same way,
        // while the floor goes on (the navigator says where it does not)
        const a = r.route[r.route.length - 2] || { x: r.progX, z: r.progZ }, e = r.route[r.route.length - 1];
        let hx = e.x - a.x, hz = e.z - a.z; const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l;
        const nx = p.x + hx * EXTEND, nz = p.z + hz * EXTEND;
        const G = CBZ.navGrid;
        let ok = true;
        if (G && G.ready && G.ready() && G.inWindow && G.inWindow(nx, nz) && G.lineBlocked && Math.abs(p.y || 0) < 1.2) {
          try { ok = !G.lineBlocked(p.x, p.z, nx, nz); } catch (err) { ok = true; }
        }
        r.ext++;
        if (ok) { r.route.push({ x: nx, z: nz }); try { r.walk(b, nx, nz); } catch (err) {} }
        else { r.ext = 3; try { r.hold(b, Math.atan2(hx, hz)); } catch (err) {} }
      }
      // ---- the only way out of the world: unseen ----
      if (r.t < r.minT) continue;
      if ((r.chk -= dt) > 0) continue;
      r.chk = CHECK;
      if (unseen(p, { far: r.far })) { LIVE.splice(k, 1); finish(r, false); }
    }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(36.6, tick);

  CBZ.leave = {
    go: go, cancel: cancel, unseen: unseen, seen: seen, tick: tick,
    busy: function (b) { return !!rec(b); },
    walking: function () { return LIVE.map(function (r) { return r.b; }); },
    // a mode reset: the people walking out go with the world
    clear: function () { for (let i = 0; i < LIVE.length; i++) LIVE[i].b._leaving = null; LIVE.length = 0; },
    audit: function () {
      return { walking: LIVE.length, removed: removed, removedInView: removedInView, last: lastInfo,
        live: LIVE.map(function (r) { return { tag: r.tag, t: Math.round(r.t * 10) / 10, wp: r.i + "/" + r.route.length, walked: Math.round(r.walked * 10) / 10 }; }) };
    },
    FAR: FAR,
  };
})();
