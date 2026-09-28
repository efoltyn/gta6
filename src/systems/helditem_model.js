/* ============================================================
   systems/helditem_model.js — THINGS YOU USE BY HOLDING THEM.

   OWNER (2026-09-28): the charge "shouldn't be its own button, that's dumb;
   it should be something you have to hold."

   So a demolition charge, the detonator that sets it off and a frag are
   hotbar cells like a gun: select one and it is in your hand, and the ONE
   use input (left click, the touch FIRE button, the pad trigger) does the
   thing that object does:

     charge     hold the use input ~0.5 s with a surface in reach: the hand
                presses the brick flush onto the wall / door / car / ground
                you are looking at. Nothing in reach: nothing happens (the
                ghost on the surface is how you know it will stick).
     detonator  appears as its own cell once a charge is out; squeeze = every
                placed charge goes.
     grenade    hold = the pin comes out and the hand winds up; release =
                the throw, harder the longer you held (up to 1 s).

   PURE: no DOM, no THREE. tools/check-c4-held.mjs loads it in plain node and
   the browser build reads CBZ.heldItemModel.
============================================================ */
(function (root) {
  "use strict";

  const C4_ITEM = "C4 Charge";
  const GRENADE_ITEM = "Grenade";
  // the brick as modelled (weapons/appearances/c4.js): thin axis is local +Y
  const BRICK = { len: 0.28, thick: 0.055, wide: 0.11 };
  const REACH = 2.6;          // metres from the eye a charge can be pressed on
  const PLACE_HOLD = 0.5;     // seconds the use input is held to press it on
  const MAX_OUT = 5;          // the receiver tracks five charges

  // ---- which held kind a hotbar item name means ----
  function heldKindOf(itemName, itemRow) {
    if (itemRow && itemRow.c4) return "c4";
    if (itemName === C4_ITEM) return "c4";
    if (itemName === GRENADE_ITEM) return "grenade";
    return null;
  }

  /* The cells a carrier of these things gets on the bar, in order.
     s = { c4: count, planted: count, grenades: count, bandages: count,
           held: "c4"|"detonator"|"grenade"|"bandage"|null }
     A charge cell exists while you carry bricks; the Detonator cell exists
     while any charge is out (it outlives the last brick in the bag). */
  function cells(s) {
    s = s || {};
    const out = [];
    if ((s.grenades | 0) > 0) out.push({ kind: "throwable", item: GRENADE_ITEM, held: "grenade", count: s.grenades | 0, active: s.held === "grenade", selectable: true });
    if ((s.c4 | 0) > 0) out.push({ kind: "throwable", item: C4_ITEM, held: "c4", count: s.c4 | 0, active: s.held === "c4", selectable: true });
    if ((s.planted | 0) > 0) out.push({ kind: "detonator", item: "Detonator", held: "detonator", count: s.planted | 0, active: s.held === "detonator", selectable: true });
    return out;
  }

  // what the hand should show for a held kind given the world (a charge cell
  // with no bricks left but charges out falls through to the detonator)
  function resolveHeld(held, s) {
    s = s || {};
    // the gauze roll stays in your hand while you have one (or are mid-wrap)
    if (held === "bandage") return (s.bandages | 0) > 0 || s.wrapping ? "bandage" : null;
    if (held === "c4" && !((s.c4 | 0) > 0)) return (s.planted | 0) > 0 ? "detonator" : null;
    if (held === "detonator" && !((s.planted | 0) > 0)) return null;
    if (held === "grenade" && !((s.grenades | 0) > 0)) return null;
    return held || null;
  }

  function norm(v) {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  }

  /* ---- SURFACE PICK: the cheap analytic ray the ghost runs every frame ----
     o = eye, d = unit look dir, world = {
       boxes: [{minX,maxX,minZ,maxZ,y0?,y1?, door?, person?, ref?}]  colliders + people
       cars:  [{x,y,z, yaw, hx,hy,hz, ref}]           oriented car hulls
       floorAt(x,z) -> ground height                   the land
     }
     -> { kind:"wall"|"door"|"car"|"ground", point, normal, dist, ref } | null */
  function rayBox(o, d, minX, maxX, minY, maxY, minZ, maxZ) {
    let t0 = 0, t1 = Infinity, nAxis = -1, nSign = 0;
    const lo = [minX, minY, minZ], hi = [maxX, maxY, maxZ], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
    for (let a = 0; a < 3; a++) {
      if (Math.abs(dd[a]) < 1e-9) { if (oo[a] < lo[a] || oo[a] > hi[a]) return null; continue; }
      let ta = (lo[a] - oo[a]) / dd[a], tb = (hi[a] - oo[a]) / dd[a], s = -1;
      if (ta > tb) { const t = ta; ta = tb; tb = t; s = 1; }
      if (ta > t0) { t0 = ta; nAxis = a; nSign = s; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
    if (nAxis < 0) return null;            // eye inside the box: no face to press on
    const n = { x: 0, y: 0, z: 0 };
    n[nAxis === 0 ? "x" : nAxis === 1 ? "y" : "z"] = nSign;
    return { t: t0, n: n };
  }

  function pickSurface(o, d, world, reach) {
    reach = reach || REACH;
    d = norm(d);
    world = world || {};
    let best = null;
    const boxes = world.boxes || [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const y0 = b.y0 != null ? b.y0 : -1e4, y1 = b.y1 != null ? b.y1 : 1e4;
      const h = rayBox(o, d, b.minX, b.maxX, y0, y1, b.minZ, b.maxZ);
      if (!h || h.t > reach || (best && h.t >= best.dist)) continue;
      best = { kind: b.person ? "person" : b.door ? "door" : (h.n.y > 0.5 ? "ground" : "wall"), dist: h.t, normal: h.n, ref: b.ref || b };
    }
    const cars = world.cars || [];
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      // into the car's frame (group.rotation.y = heading; local +Z is the nose)
      const cs = Math.cos(c.yaw || 0), sn = Math.sin(c.yaw || 0);
      const px = o.x - c.x, pz = o.z - c.z;
      const lo = { x: cs * px - sn * pz, y: o.y - c.y, z: sn * px + cs * pz };
      const ld = { x: cs * d.x - sn * d.z, y: d.y, z: sn * d.x + cs * d.z };
      const h = rayBox(lo, ld, -c.hx, c.hx, 0, 2 * c.hy, -c.hz, c.hz);
      if (!h || h.t > reach || (best && h.t >= best.dist)) continue;
      // local normal back to world
      const n = { x: cs * h.n.x + sn * h.n.z, y: h.n.y, z: -sn * h.n.x + cs * h.n.z };
      best = { kind: "car", dist: h.t, normal: n, ref: c.ref || c };
    }
    // the ground: march the ray (cheap, reach is short)
    if (world.floorAt && d.y < -0.02) {
      const step = 0.08;
      let prev = 0;
      for (let t = step; t <= reach + 1e-6; t += step) {
        if (best && t >= best.dist) break;
        const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
        const f = world.floorAt(x, z) || 0;
        if (y <= f) {
          // refine between prev and t by bisection
          let a = prev, b2 = t;
          for (let k = 0; k < 8; k++) {
            const m = (a + b2) / 2;
            if (o.y + d.y * m <= (world.floorAt(o.x + d.x * m, o.z + d.z * m) || 0)) b2 = m; else a = m;
          }
          best = { kind: "ground", dist: b2, normal: { x: 0, y: 1, z: 0 }, ref: null };
          break;
        }
        prev = t;
      }
    }
    if (!best) return null;
    best.point = { x: o.x + d.x * best.dist, y: o.y + d.y * best.dist, z: o.z + d.z * best.dist };
    return best;
  }

  /* ---- PLACEMENT: where the brick sits on a hit surface ----
     The brick's thin axis (local +Y) is laid along the surface normal and
     its centre sits half a thickness off the surface, so it is flush: not
     floating, not sunk. Beyond reach, or no hit: null. */
  const STICK = { wall: "wall", door: "wall", car: "car", ground: "ground", person: "body" };
  function placement(hit, reach) {
    reach = reach || REACH;
    if (!hit || !hit.point || !hit.normal) return null;
    if (hit.dist != null && hit.dist > reach) return null;
    const stick = STICK[hit.kind];
    if (!stick) return null;
    const n = norm(hit.normal);
    const off = BRICK.thick / 2;
    return {
      stick: stick,
      kind: hit.kind,
      ref: hit.ref || null,
      normal: n,
      up: n,                                  // the brick's local +Y maps here
      pos: { x: hit.point.x + n.x * off, y: hit.point.y + n.y * off, z: hit.point.z + n.z * off },
    };
  }

  // grenade throw strength from how long the use input was held
  function throwPower(holdT) {
    const t = Math.max(0, Math.min(1, holdT || 0));
    return 0.45 + 0.55 * t;
  }

  const api = {
    C4_ITEM: C4_ITEM, GRENADE_ITEM: GRENADE_ITEM, BRICK: BRICK, REACH: REACH,
    PLACE_HOLD: PLACE_HOLD, MAX_OUT: MAX_OUT,
    heldKindOf: heldKindOf, cells: cells, resolveHeld: resolveHeld,
    pickSurface: pickSurface, placement: placement, throwPower: throwPower,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.CBZ) root.CBZ.heldItemModel = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
