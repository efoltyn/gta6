/* ============================================================
   city/perimeter.js — SECURED GROUND IS A WALL TO A CROWD.

   OWNER (2026-10-09, playing the President on his iPad): "The protest crowds
   are inside the gate. That's not realistic. The President has a gate and
   security around the gate, and they're right in front of the front door."

   A real head-of-state residence is read from the street: the crowd stands
   on the public side, across the road from the gate or along the fence on
   the sidewalk, behind bike-rack barricades, with uniformed officers between
   the barricades and the gate facing them. Nobody stands on the lawn under
   the portico unless they broke the gate to get there.

   WHAT THIS FILE IS. One small shared answer to "may a crowd stand here?",
   read by every crowd in the game (city/mob.js's massed crowds, the posted
   speech crowd in city/president_public.js) and by the gate detail
   (city/protection.js):

     MASK   every govcomplex site with a keep-out (`def.keepOut`, the same
            flag ambient pedestrians already obey) is no-go ground: its rect
            IS the fence line (govcomplex.js draws the railing/wall on the
            rect edges), padded by the fence's thickness. Public sites (the
            Capitol, City Hall) have no keep-out and so no mask: a crowd may
            stand on the Capitol plaza, which is what a plaza is for.
     PEN    the protest pen in front of a site's gate: where the barricades
            go, where the crowd's front row stands, where the uniformed line
            stands, and the strip between barricade and fence that is no-go
            while the pen is open (the gate apron stays clear).

   ONLY A BREACH CROSSES IT. A crowd ignores the mask only once it has
   broken a police line (mob.js stage "breach"/"inside"): the gate forced or
   the fence climbed is a real event with news and a Secret Service
   response, never a placement accident.

   PUBLIC: CBZ.perimeter = {
     sites()                      [{id, rect, gate, out}] secured grounds
     gateOut(site)                {x,z} unit normal out of the gate edge
     inside(x, z, pad)            the secured site containing (x,z), or null
     clampOut(x, z, o, pad)       writes the nearest allowed point into o
                                  ({x,z,moved}); also respects open pens
     outward(x, z)                {x,z} the way out of the ground at (x,z)
     pen(siteId)                  the pen plan (below) or null
     openPen(siteId, who) / closePen(siteId, who) / penOpen(siteId)
   }
   pen plan = { id, gate:{x,z}, out:{x,z}, along:{x,z}, at:{x,z}, face,
     half, barricadeD, barricades:[{x,z,yaw,len}], officers:[{x,z,face}],
     apron:{minX,maxX,minZ,maxZ} }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.perimeter) return;

  const PAD = 1.2;              // m: the fence's own half-thickness plus a shoulder
  const BARRICADE_D = 6.5;      // m out from the fence line to the bike racks
  const FRONT_D = 8.2;          // m out to the crowd's front row (behind the racks)
  const RACK = 2.4;             // m: one bike-rack section

  function list() { const L = CBZ.govComplexes; return Array.isArray(L) ? L : []; }
  function secured(s) { return !!(s && s.rect && s.def && s.def.keepOut); }
  function byId(id) { const L = list(); for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === id && L[i].rect) return L[i]; return null; }

  // govcomplex publishes `gate` as a point ON one edge of `rect`; the outward
  // normal is whichever edge it sits on (presidency.js gateOut, same rule)
  function gateOut(s) {
    const R = s.rect, gp = s.gate || { x: s.cx, z: R.maxZ };
    const dl = Math.abs(gp.x - R.minX), dr = Math.abs(gp.x - R.maxX);
    const db = Math.abs(gp.z - R.minZ), dt = Math.abs(gp.z - R.maxZ);
    const m = Math.min(dl, dr, db, dt);
    if (m === dt) return { x: 0, z: 1 };
    if (m === db) return { x: 0, z: -1 };
    if (m === dr) return { x: 1, z: 0 };
    return { x: -1, z: 0 };
  }
  // the gate point snapped onto the fence line it belongs to
  function gateOn(s) {
    const R = s.rect, o = gateOut(s), gp = s.gate || { x: s.cx, z: R.maxZ };
    if (o.z > 0) return { x: gp.x, z: R.maxZ };
    if (o.z < 0) return { x: gp.x, z: R.minZ };
    if (o.x > 0) return { x: R.maxX, z: gp.z };
    return { x: R.minX, z: gp.z };
  }

  function inRect(R, x, z, p) { return x > R.minX - p && x < R.maxX + p && z > R.minZ - p && z < R.maxZ + p; }
  function inside(x, z, pad) {
    const p = pad == null ? PAD : pad, L = list();
    for (let i = 0; i < L.length; i++) { const s = L[i]; if (secured(s) && inRect(s.rect, x, z, p)) return s; }
    return null;
  }
  // nearest point on the padded rect's boundary (the shortest way out)
  function pushOut(R, x, z, p, o) {
    const dL = x - (R.minX - p), dR = (R.maxX + p) - x, dB = z - (R.minZ - p), dT = (R.maxZ + p) - z;
    const m = Math.min(dL, dR, dB, dT);
    if (m === dL) o.x = R.minX - p; else if (m === dR) o.x = R.maxX + p;
    else if (m === dB) o.z = R.minZ - p; else o.z = R.maxZ + p;
    o.moved = true;
  }

  // ---- PENS ---------------------------------------------------------------
  const PENS = Object.create(null);   // siteId -> { who: {key:true} }
  function gateHalf(s) {
    // the estate tier's gate gap (govcomplex.js EST_TIER: 14..26 m) plus
    // the gate piers; a site without an estate layout gets the widest
    const GW = { 5: 26, 4: 24, 3: 18, 2: 16, 1: 14 };
    const t = s.layout && s.layout.tier;
    return (GW[t] || 26) / 2 + 4;
  }
  function pen(siteId) {
    const s = byId(siteId || "execmansion");
    if (!s) return null;
    const o = gateOut(s), g = gateOn(s);
    const ax = o.z, az = -o.x;                    // along the fence
    const half = gateHalf(s);
    const P = function (along, out) { return { x: g.x + ax * along + o.x * out, z: g.z + az * along + o.z * out }; };
    const face = Math.atan2(-o.x, -o.z);          // a crowd in the pen looks at the gate
    const out = Math.atan2(o.x, o.z);             // an officer looks out at the crowd
    const yaw = Math.atan2(ax, az);               // a rack runs along the fence
    const barricades = [];
    const n = Math.max(4, Math.round(half * 2 / RACK));
    for (let k = 0; k < n; k++) {
      const a = -half + (k + 0.5) * (half * 2 / n), q = P(a, BARRICADE_D);
      barricades.push({ x: q.x, z: q.z, yaw: yaw, len: RACK });
    }
    // the returns: two racks each end, back toward the fence, closing the apron
    for (const sgn of [-1, 1]) for (let k = 0; k < 2; k++) {
      const q = P(sgn * (half + 0.15), BARRICADE_D - 1.3 - k * RACK);
      barricades.push({ x: q.x, z: q.z, yaw: yaw + Math.PI / 2, len: RACK });
    }
    // the uniformed line: four across the apron facing the pen, one at each
    // end of the racks along the fence
    const officers = [];
    for (let k = 0; k < 4; k++) { const q = P((k - 1.5) * (half * 0.5), BARRICADE_D - 1.6); officers.push({ x: q.x, z: q.z, face: out }); }
    for (const sgn of [-1, 1]) { const q = P(sgn * (half + 3.2), 1.9); officers.push({ x: q.x, z: q.z, face: out }); }
    const a0 = P(-half - 0.4, 0), a1 = P(half + 0.4, BARRICADE_D + 0.6);
    const apron = { minX: Math.min(a0.x, a1.x), maxX: Math.max(a0.x, a1.x), minZ: Math.min(a0.z, a1.z), maxZ: Math.max(a0.z, a1.z) };
    return {
      id: s.id, gate: g, out: o, along: { x: ax, z: az }, at: P(0, FRONT_D), face: face, half: half,
      barricadeD: BARRICADE_D, frontD: FRONT_D, barricades: barricades, officers: officers, apron: apron,
    };
  }
  const _penCache = { at: null, list: [] };
  function openPens() {
    // pens change a few times a game-hour: rebuild the open list on demand
    const L = [];
    for (const id in PENS) { const W = PENS[id]; let on = false; for (const k in W) if (W[k]) { on = true; break; } if (on) { const p = pen(id); if (p) L.push(p); } }
    return L;
  }
  let _pensDirty = true;
  function pens() { if (_pensDirty) { _penCache.list = openPens(); _pensDirty = false; } return _penCache.list; }
  function openPen(siteId, who) { const id = siteId || "execmansion"; (PENS[id] || (PENS[id] = {}))[who || "any"] = true; _pensDirty = true; return pen(id); }
  function closePen(siteId, who) { const W = PENS[siteId || "execmansion"]; if (W) delete W[who || "any"]; _pensDirty = true; }
  function penOpen(siteId) { const W = PENS[siteId || "execmansion"]; if (!W) return false; for (const k in W) if (W[k]) return true; return false; }

  // ---- THE CLAMP -------------------------------------------------------------
  function clampOut(x, z, o, pad) {
    o = o || {};
    o.x = x; o.z = z; o.moved = false;
    const p = pad == null ? PAD : pad, L = list();
    for (let i = 0; i < L.length; i++) {
      const s = L[i];
      if (secured(s) && inRect(s.rect, o.x, o.z, p)) pushOut(s.rect, o.x, o.z, p, o);
    }
    const PL = pens();
    for (let i = 0; i < PL.length; i++) {
      const A = PL[i].apron;
      if (inRect(A, o.x, o.z, 0.3)) {
        // out of the apron goes OUT, toward the pen, never in through the gate
        const q = PL[i];
        if (q.out.z > 0) o.z = A.maxZ + 0.3; else if (q.out.z < 0) o.z = A.minZ - 0.3;
        else if (q.out.x > 0) o.x = A.maxX + 0.3; else o.x = A.minX - 0.3;
        o.moved = true;
      }
    }
    return o;
  }
  // the way out of the ground at (x,z): the nearest fence edge's normal
  function outward(x, z) {
    const s = inside(x, z, PAD + 2);
    if (!s) return null;
    const R = s.rect, dL = x - R.minX, dR = R.maxX - x, dB = z - R.minZ, dT = R.maxZ - z;
    const m = Math.min(dL, dR, dB, dT);
    return m === dL ? { x: -1, z: 0 } : m === dR ? { x: 1, z: 0 } : m === dB ? { x: 0, z: -1 } : { x: 0, z: 1 };
  }

  CBZ.perimeter = {
    sites: function () { return list().filter(secured).map(function (s) { return { id: s.id, rect: s.rect, gate: gateOn(s), out: gateOut(s) }; }); },
    gateOut: gateOut,
    gateOn: gateOn,
    inside: inside,
    clampOut: clampOut,
    outward: outward,
    pen: pen,
    openPen: openPen,
    closePen: closePen,
    penOpen: penOpen,
    PAD: PAD,
  };
})();
