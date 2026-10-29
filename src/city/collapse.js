/* ============================================================
   city/collapse.js — HOW BUILDINGS BREAK. One structural model for every
   building in every game: Gang City's RPGs, airstrikes and planes, the
   disaster island's quake / tornado / sinkhole / meteor / tsunami, the nuke.

   OWNER BRIEF (2026-10-14): "almost voxel", Teardown-style. The building is
   made of real breakable structural pieces, not swapped for generic rubble;
   pieces are supported by what is under them; damage removes pieces and
   whatever is left unsupported falls; a corner gives and the floors above
   sag and pancake, or a tower tips over as one mass and breaks on impact;
   soft storeys fail first; falling pieces are real bodies that break again
   when they land, pile up, crush cars; dust comes off the collapse and the
   rooms show on the cut faces. Lazily, only the building being hit, and on
   a phone.

   WHAT WAS HERE BEFORE, and why it went. This file used to be a CHOREOGRAPHER:
   a building that structural.js condemned was cut into storey bands and one
   of five scripted motions (pancake / topple / shear / fold / crumble) was
   played on them, every band bursting into debris at a scripted moment. The
   look was the building's own, but nothing in it was structural: the motion
   was picked from a table before anything moved, a hit on the left side and
   a hit on the right side produced the same fall, nothing a disaster did
   could take away part of a building and leave the rest standing, and the
   pieces were made at a scripted instant rather than when something broke.
   The band shell, the grammar registry and the job choreography are deleted.
   What replaced them:

   1. THE CUT (section 3). The first time a building is damaged it is cut —
      in slices across frames, never at boot, never any building but that
      one — along its OWN lines: every storey line (just under each floor
      slab) and the bay lines between its windows (read off the building's
      own openings, so a cut runs down a pier, never through a window). Its
      real triangles — walls, facade relief, trim, veneer, glass, floor
      plates, the furniture of the rooms — are clipped exactly at those
      planes, so every CHUNK is a piece of the actual building: a wall panel
      (one bay of one face for one storey, with its windows), a floor tile
      (one bay-by-bay slab with the room on it and the columns under the
      next one), a roof section, a parapet / cornice run. The cut faces get
      caps in the material's broken-core colour: slab edges, wall sections.
      The standing building is then drawn from a few merged meshes (bands of
      storeys x materials), so a cut building costs about what it did whole.
   2. THE LOAD PATH (section 4). Chunks know what is under them, beside them
      and on them. Every tenth of a second a damaged building is solved:
      what is HELD (by the ground, through the chunks under it, or hanging
      off a neighbour), what each chunk CARRIES (its weight plus its share of
      everything above), and whether that exceeds what it was DESIGNED for.
      Capacities are designed from the intact load times a safety factor, so
      an undamaged building stands with margin everywhere; the factor drops
      on a storey that is mostly glass (a storefront, a lobby): the soft
      storey, which fails first. Three things then happen on their own:
        crush   — an overloaded chunk fails; its load moves to its
                  neighbours, who may fail next tick: the collapse PROPAGATES
        orphan  — what is no longer held falls, as connected clusters
        tip     — when the weight above a storey stands outside what is left
                  under it, everything above goes as ONE MASS and rotates
                  over the stump's edge: a tower topples toward its wound.
      Frames (steel, concrete, curtain wall) and slender stacks act RIGID:
      a hole hangs off the frame and the whole top tips; brittle low masonry
      shears: the part over the hole drops, the rest stands.
   3. THE FALL (section 5). Falling clusters are rigid bodies with real mass
      and inertia, resting on the ground, the stump, the rubble and other
      buildings. A falling mass that lands on its own stump crushes the
      storey under it and loses only the energy that took — the pancake runs
      down the building. A hard landing breaks a body: a tower into
      segments, a segment into chunks, a chunk into Voronoi pieces of itself
      (CBZ.debris.shatter). A body that stops is baked into the merged static
      rubble (CBZ.debris.bake): one draw per material per cell, a solid
      collider, a height-field the next piece piles on. Cars underneath are
      crushed; people underneath are killed through the shared kill bus.
   4. THE BUDGET. Structural bodies awake at once are capped per device
      (phone 14, tablet 24, desktop 48); a split that would exceed it
      shatters or bakes the overflow instead. Debris pieces ride debris.js's
      own device caps. Cutting runs a few milliseconds a frame.

   THE API (every disaster calls these; none of them needs to know chunks):
     CBZ.collapse.damage(building, point, radius, energy, dir, opts)
         energy in MJ (an RPG ~3, C4 ~6, a car bomb ~25, a 500 lb bomb ~90,
         a meteor hundreds); radius in metres; dir the push (optional).
         Chunks inside the radius lose integrity by energy/toughness; a chunk
         that reaches zero is blown out as pieces of itself.
     CBZ.collapse.undermine(building, region, opts)
         region {x, z, r} or {minX, maxX, minZ, maxZ}: the ground under those
         chunks is gone (sinkhole, liquefaction, a washed-out bank). opts.depth
         lowers the ground the falling pieces land on there.
     CBZ.collapse.shake(building, intensity, dir)    a quake's cyclic damage:
         soft storeys and glassy walls lose the most
     CBZ.collapse.fracture(building)  cut it now (otherwise the first damage does)
     CBZ.collapse.play(desc, opts)    THE CONDEMNED PATH (structural.js,
         strike.js, disasters.js): the building comes down, all of it. The
         wound is removed for real (one side of the wound storey, or the whole
         storey for a controlled drop / a pancake frame), and the load path
         does the rest; the design margin is then run down so nothing is left
         standing. onSwap / onGround / onDone as before.
     CBZ.collapse.stats(building) / isFractured / forget / debug / audit
   `building` is a Gang City record (cityMakeBuilding), its lot, an island
   building record, or a desc {group, ox, oz, w, d, h, storeys, ...}.

   DETERMINISM: runtime spectacle over an already-decided outcome, so
   Math.random is legal here (the licence structural.js's FX carry). Which
   building came down is still decided and replayed by structural.js and
   demolition.js; the rubble those ledgers serialise is theirs.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.collapse) return;                       // idempotent family guard

  CBZ.CONFIG = CBZ.CONFIG || {};
  // Master switch. false → play() returns null and every caller keeps the
  // fallback it has (structural.js snaps to rubble, the island its old sink).
  if (CBZ.CONFIG.COLLAPSE_V2 == null) CBZ.CONFIG.COLLAPSE_V2 = true;
  // The pieces. false → chunks that break vanish into dust instead of
  // shattering into rigid pieces of themselves.
  if (CBZ.CONFIG.COLLAPSE_FRAGMENTS == null) CBZ.CONFIG.COLLAPSE_FRAGMENTS = true;
  // The progressive damage (real carves at the wound) on a building that is
  // still STANDING.
  if (CBZ.CONFIG.COLLAPSE_SKIN == null) CBZ.CONFIG.COLLAPSE_SKIN = true;

  const C = (CBZ.collapse = {});
  const G = 9.81;

  function qs(lo, hi) { return CBZ.qScale ? CBZ.qScale(lo, hi) : (lo + hi) / 2; }
  function rnd() { return Math.random(); }
  function shade(hex, f) {
    const r = Math.max(0, Math.min(255, (((hex >> 16) & 255) * f) | 0));
    const g = Math.max(0, Math.min(255, (((hex >> 8) & 255) * f) | 0));
    const b = Math.max(0, Math.min(255, ((hex & 255) * f) | 0));
    return (r << 16) | (g << 8) | b;
  }
  function mix(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    return ((((ar + (br - ar) * t) | 0) << 16) | (((ag + (bg - ag) * t) | 0) << 8) | (((ab + (bb - ab) * t) | 0)));
  }
  function mat(col) {
    if (CBZ.cmat) return CBZ.cmat(col);
    return new THREE.MeshLambertMaterial({ color: col });
  }

  /* ============================================================
     1. WHAT IS IT MADE OF — the declarative materials table.

     Every number here is a PHYSICAL property something below reads.
     Nothing in this table names a building, a lot, a district or a facade.

       ductile   0..1  how far the frame deforms before it lets go; >= 0.4
                       makes the building act RIGID (a hole hangs off the
                       frame, the whole top tips as one mass)
       hinge     0..1  tendency to rotate about a base hinge: a slender
                       stack with a high hinge is rigid too
       frag/fragSize   how many / how big the pieces it breaks into
       dust      x     dust volume
       spread    x     how far outward pieces are thrown
       tone      0..1  shade of the BROKEN face (the cut caps)
       burn      0..1  does it feed a fire (structural.js's fire model)
       sf              design safety factor: capacity = sf x intact load
       hang            what a chunk can hang off its neighbour, as a
                       fraction of its capacity (a cantilever / a frame)
       breakV  m/s     a falling mass breaks apart landing faster than this
       shatterV m/s    a single chunk shatters into pieces above this
       tough   MJ/t^.8 blast energy to blow a chunk out, per its mass^0.8
       rho     t/m3    the wall solid's density
     ============================================================ */
  const MATERIALS = {
    masonry:  { label: "unreinforced masonry", ductile: 0.10, hinge: 0.85, frag: 1.35, fragSize: 0.75, dust: 1.30, rate: 1.15, spread: 1.25, tone: 0.62, burn: 0.05, sf: 2.0, hang: 0.10, breakV: 2.6, shatterV: 5.0, tough: 0.30, rho: 1.9 },
    brick:    { label: "load-bearing brick",   ductile: 0.18, hinge: 0.70, frag: 1.25, fragSize: 0.80, dust: 1.15, rate: 1.05, spread: 1.10, tone: 0.58, burn: 0.10, sf: 2.2, hang: 0.15, breakV: 3.0, shatterV: 6.0, tough: 0.35, rho: 1.9 },
    adobe:    { label: "adobe / rammed earth", ductile: 0.05, hinge: 0.45, frag: 1.50, fragSize: 0.62, dust: 1.55, rate: 1.35, spread: 1.05, tone: 0.70, burn: 0.05, sf: 1.8, hang: 0.05, breakV: 2.0, shatterV: 4.0, tough: 0.20, rho: 1.7 },
    stone:    { label: "cut stone",            ductile: 0.08, hinge: 0.90, frag: 0.95, fragSize: 1.25, dust: 1.20, rate: 0.90, spread: 1.30, tone: 0.66, burn: 0.02, sf: 2.4, hang: 0.10, breakV: 3.0, shatterV: 6.5, tough: 0.45, rho: 2.4 },
    concrete: { label: "reinforced concrete",  ductile: 0.45, hinge: 0.25, frag: 0.85, fragSize: 1.35, dust: 1.10, rate: 0.95, spread: 0.85, tone: 0.55, burn: 0.05, sf: 2.6, hang: 0.35, breakV: 4.0, shatterV: 8.0, tough: 0.55, rho: 2.4 },
    steel:    { label: "steel frame",          ductile: 0.85, hinge: 0.10, frag: 0.70, fragSize: 1.15, dust: 0.80, rate: 0.80, spread: 0.70, tone: 0.42, burn: 0.20, sf: 3.0, hang: 0.55, breakV: 6.0, shatterV: 11.0, tough: 0.70, rho: 1.6 },
    glassbox: { label: "curtain-wall frame",   ductile: 0.75, hinge: 0.12, frag: 1.10, fragSize: 0.70, dust: 0.70, rate: 0.90, spread: 0.95, tone: 0.36, burn: 0.25, sf: 2.8, hang: 0.45, breakV: 5.0, shatterV: 10.0, tough: 0.60, rho: 1.5 },
    timber:   { label: "timber frame",         ductile: 0.55, hinge: 0.35, frag: 1.20, fragSize: 0.70, dust: 0.55, rate: 1.30, spread: 0.80, tone: 0.74, burn: 0.90, sf: 2.4, hang: 0.30, breakV: 4.0, shatterV: 7.0, tough: 0.25, rho: 0.7 },
  };
  C.MATERIALS = MATERIALS;


  /* WHICH MATERIAL — asked of the FACADE first, inferred only as a fallback.

     A facade grammar knows what it is: city/facades/adobe.js is adobe and
     city/facades/megabrace.js is a braced steel tube. So the answer lives at
     the definition site (`registerFacade({ structure: "adobe" })`) and this
     file never carries a table of facade names — that would be exactly the
     hardcoding the brief forbids, and it would rot the moment somebody added
     a 32nd grammar.

     The inference below is the honest fallback for an UNDRESSED building, and
     it reads only physical facts the building itself carries: does it have a
     masonry colourway, how many storeys does it stand, how big is its plan.
     Every one of those is a real-world predictor of structural system, which
     is why it is a defensible default rather than a guess. */
  function materialOf(desc) {
    let id = null;
    if (desc.style && CBZ.facadeDef) {
      const def = CBZ.facadeDef(desc.style);
      if (def && def.structure) id = def.structure;
    }
    if (!id && desc.material) id = desc.material;
    if (!id) {
      const st = desc.storeys || 1;
      const plan = (desc.w || 10) * (desc.d || 10);
      if (desc.masonry) id = st >= 6 ? "concrete" : "brick";
      else if (st >= 14) id = "steel";
      else if (st >= 8) id = "glassbox";
      else if (st >= 4) id = "concrete";
      else if (st <= 2 && plan < 220) id = "timber";
      else id = "brick";
    }
    return MATERIALS[id] ? id : "concrete";
  }


  C.profile = function (desc) {
    const w = Math.max(1, desc.w || 10), d = Math.max(1, desc.d || 10);
    const h = Math.max(2, desc.h || (desc.storeys || 1) * (desc.FH || 3.2));
    const mId = materialOf(desc);
    const m = MATERIALS[mId];
    const minSide = Math.min(w, d);
    return {
      material: mId, m: m,
      w: w, d: d, h: h,
      storeys: Math.max(1, desc.storeys || Math.round(h / (desc.FH || 3.2)) || 1),
      FH: desc.FH || (h / Math.max(1, desc.storeys || 1)),
      slender: h / minSide,
      mass: w * d * h,
      // how brittle the whole assembly is — the number the grammars weigh
      brittle: 1 - m.ductile,
    };
  };


  /* ============================================================
     2. THE BUILDING'S MATERIALS (read by demolition.js's mound and
     structural.js's chips, and by the skin below): its own solids.
     ============================================================ */
  const owners = new Set();           // every building key we have thrown debris for
  // What the rubble is made of, from the building's structural system (the
  // MATERIALS table above). Only used where the material itself says nothing
  // more specific: a named/transparent pane stays glass, a metal trim metal.
  const RUBBLE_KIND = {
    masonry: "brick", brick: "brick", adobe: "dirt", stone: "rock",
    concrete: "concrete", steel: "concrete", glassbox: "concrete", timber: "wood",
  };

  const HAS3 = typeof THREE !== "undefined";
  const _bb = HAS3 ? new THREE.Box3() : null;
  const _sz = HAS3 ? new THREE.Vector3() : null;
  const _n3 = HAS3 ? new THREE.Matrix3() : null;
  let paneUnit = null;                // a pooled (instanced) pane is read through a unit box
  function paneGeo() {
    if (!paneUnit) { paneUnit = new THREE.BoxGeometry(1, 1, 1); paneUnit._shared = true; }
    return paneUnit;
  }
  function isGlass(m) {
    if (!m) return false;
    if (m.transparent && m.opacity < 0.9) return true;
    return /glass|window|pane/i.test(m.name || "");
  }
  /* GLASS DRAWS AS THE PANE DID. The pools draw a building's glass with no
     shadows, after the opaque world (renderOrder 1). Cut into the standing
     bands, a falling block or the kept rubble, the same glass casting and
     receiving shadows reads darker than the pane next to it that has not
     broken yet, so every mesh of see-through glass keeps the pool's
     settings. */
  function glassDraw(ms) {
    const m = ms.material;
    if (!m || !(m.transparent || isGlass(m))) return ms;
    if (!m.transparent && m.opacity >= 0.9) return ms;          // an opaque mirror-glass skin is a wall
    ms.castShadow = false; ms.receiveShadow = false;
    if (ms.renderOrder < 1) ms.renderOrder = 1;
    return ms;
  }
  function visibleIn(o, top) {
    for (let a = o; a && a !== top; a = a.parent) if (a.visible === false) return false;
    return true;
  }

  /* THE BUILDING'S OWN SOLIDS, read at the swap.

     desc.group   the building's real Object3D (city: b.group)
     desc.solids  meshes that are drawn through core/batch.js's merged copy
                  and are therefore visible=false on their own (the storey
                  walls, slabs, parapets: b.losMeshes). They are still the
                  building; batch only stopped them drawing individually.
     desc.panes   b.windows — the glass lives in instanced pools, so each
                  intact pane is read as its own world box in its pool's
                  own material.
     Furniture and interior partitions (anything that stays more than a
     metre inside the footprint and is not a floor plate) are left out: they
     cannot be seen during a fall and would only cost draw calls. A carved
     wall (`_breached`) is left out too: its remnants stand in for it.
     Returns [{geo, mat, m (building-local), cx, cy, cz, vol, slab, glass}]. */
  function gatherSolids(desc) {
    const grp = desc.group;
    if (!HAS3 || !grp || !grp.isObject3D) return null;
    const solids = new Set(desc.solids || []);
    const ox = desc.ox, oy = desc.gy || 0, oz = desc.oz;
    const hw = Math.max(1, desc.w || 10) / 2, hd = Math.max(1, desc.d || 10) / 2;
    const out = [];
    // THE SKIN, not the shell: a perimeter wall under a facade skin is read in
    // the skin's material (buildings.js CBZ.citySkin, per face), so the shell
    // that falls and every piece cut from it wear the brick / ashlar / stucco
    // that was on screen, not the shell's hidden base tint.
    const bld = (grp.userData && grp.userData.bld) || null;
    const skinnable = !!(bld && CBZ.citySkin && CBZ.cityIsShellMat);
    try { grp.updateWorldMatrix(true, true); } catch (e) { return null; }
    grp.traverse(function (o) {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
      const geo = o.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) return;
      if (o._breached || (o.userData && (o.userData.debrisPiece || o.userData.cbzCollapseShell || o.userData.cbzInterior))) return;   // (an island interior merge spans the footprint: it cannot be seen falling)
      if (!solids.has(o) && !visibleIn(o, grp.parent)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      let any = false;
      for (const m of mats) if (m && m.visible !== false && !(m.transparent && m.opacity < 0.05)) any = true;
      if (!any) return;
      if (!geo.boundingBox) geo.computeBoundingBox();
      _bb.copy(geo.boundingBox).applyMatrix4(o.matrixWorld);
      _bb.getSize(_sz);
      const cx = (_bb.min.x + _bb.max.x) / 2 - ox, cz = (_bb.min.z + _bb.max.z) / 2 - oz;
      const cy = (_bb.min.y + _bb.max.y) / 2 - oy;
      if (Math.abs(cx) > hw + 3 || Math.abs(cz) > hd + 3) return;      // yard dressing
      const slab = _sz.x >= hw * 1.2 && _sz.z >= hd * 1.2 && _sz.y < 1.2;
      const IN = 1.2;
      if (!slab && _bb.min.x - ox > -hw + IN && _bb.max.x - ox < hw - IN
          && _bb.min.z - oz > -hd + IN && _bb.max.z - oz < hd - IN) return;   // interior
      const m = new THREE.Matrix4().makeTranslation(-ox, -oy, -oz).multiply(o.matrixWorld);
      const glass = isGlass(mats[0]);
      let mat = o.material;
      if (skinnable && !slab && !glass && CBZ.cityIsShellMat(bld, mat)) {
        let sk = null;
        try { sk = CBZ.citySkin(bld, cx + ox, cz + oz); } catch (e) { sk = null; }
        if (sk) mat = sk;
      }
      out.push({ geo: geo, mat: mat, m: m, cx: cx, cy: cy, cz: cz,
        sx: _sz.x, sy: _sz.y, sz: _sz.z,
        vol: Math.max(1e-4, _sz.x * _sz.y * _sz.z), slab: slab, glass: glass });
    });
    for (const gp of desc.panes || []) {
      if (!gp || gp.shattered || gp.mesh || !(gp.hw > 0) || !(gp.hh > 0)) continue;
      const mat = (gp.proxy && gp.proxy.material) || (gp.pool && gp.pool.material);
      if (!mat) continue;
      const sx = gp.hw * 2, sy = gp.hh * 2, sz = Math.max(gp.hd || 0, 0.006) * 2;
      const m = new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(gp.x - ox, gp.y - oy, gp.z - oz);
      out.push({ geo: paneGeo(), mat: mat, m: m, cx: gp.x - ox, cy: gp.y - oy, cz: gp.z - oz,
        vol: sx * sy * sz, slab: false, glass: true });
    }
    return out.length >= 4 ? out : null;
  }

  /* WHICH MATERIALS IS IT MADE OF — the wall (the biggest opaque non-slab
     material by volume), the floor plates, and the glass. Shared with
     demolition.js's rubble mound so the mound on the lot is the same stuff
     that was standing on it. Cached on the record. */
  function pickMats(items) {
    const vol = new Map();
    let glass = null, glassV = 0, slabM = null, slabV = 0;
    for (const it of items) {
      const m = Array.isArray(it.mat) ? it.mat[0] : it.mat;
      if (!m) continue;
      if (it.glass) { if (it.vol > glassV) { glassV = it.vol; glass = m; } continue; }
      if (it.slab) { if (it.vol > slabV) { slabV = it.vol; slabM = m; } continue; }
      vol.set(m, (vol.get(m) || 0) + it.vol);
    }
    let wall = null, best = 0;
    vol.forEach(function (v, m) { if (v > best) { best = v; wall = m; } });
    return { wall: wall || slabM, slab: slabM || wall, glass: glass };
  }
  C.materialsOf = function (b) {
    if (!b) return null;
    if (b._debrisMats) return b._debrisMats;
    const items = gatherSolids({ group: b.group, solids: b.losMeshes, panes: b.windows,
      ox: b.ox, oz: b.oz, gy: 0, w: b.w, d: b.d });
    const r = items ? pickMats(items) : null;
    if (r && r.wall) b._debrisMats = r;
    return r;
  };

  // Kept for any old caller: a lone fragment is a spit of chips of that
  // colour now — a box of it would be exactly what the owner banned.
  C.fragment = function (root, x, y, z, o) {
    o = o || {};
    if (!CBZ.debris) return null;
    try {
      CBZ.debris.chips(x, y, z, { color: o.col, count: 6, power: 1,
        dir: (o.vx || o.vz) ? { x: o.vx || 0, y: 0.3, z: o.vz || 0 } : null });
    } catch (e) {}
    return null;
  };
  // Live (still tumbling) pieces in the shared debris sim.
  C.fragCount = function () {
    try { return CBZ.debris ? CBZ.debris.stats().live : 0; } catch (e) { return 0; }
  };
  /* HAULED OFF: the owner's crew clears a lot it was paid to clear
     (demolition.js, when a held lot reaches its bare pad). Every real piece
     within the radius goes — live bodies, frozen rubble, grit, the rubble's
     colliders — leaving the lot bare. */
  C.clearNear = function (x, z, r) {
    if (!CBZ.debris || !CBZ.debris.clearNear) return 0;
    try { return CBZ.debris.clearNear(x, z, r) || 0; } catch (e) { return 0; }
  };


  /* ============================================================
     3. THE CUT — a building becomes chunks of itself.

     Frame: building-local metres, origin at the footprint centre on the
     ground, x across the width, z across the depth (the building's own
     yaw). Faces 0 -z, 1 +z, 2 -x, 3 +x (the facade kit's convention).

     Lines: bay lines xs[] / zs[] (the piers between the windows), and the
     storey lines Y(k) = k*FH - SL just UNDER each floor slab, so a floor
     plate stays whole with the storey it is the floor of. Level k holds
     everything from Y(k) to Y(k+1); the top level (k = ns) is the roof
     slab, the parapet, the crown and whatever stands on the roof.

     A triangle is assigned to the chunk its centroid is in AFTER it has
     been clipped at every line it crosses: a 40 m wall face of two
     triangles becomes the exact rectangles of its bays and storeys, with
     interpolated uv / normal / colour, so the brick course and the paint
     carry on across every break.
     ============================================================ */
  const DEVICE = CBZ.deviceClass || "desktop";
  const PHONE = DEVICE === "phone", TABLET = DEVICE === "tablet";
  const BODY_CAP = PHONE ? 14 : TABLET ? 24 : 48;     // structural bodies awake at once
  const BAY_TARGET = PHONE ? 4.2 : 3.4;                // m: one structural bay (never finer than the building's own)
  const MAX_BAYS = PHONE ? 8 : 12;                     // per axis
  const BANDS = PHONE ? 6 : 10;                        // standing draw bands (storey groups)
  const SLICE_MS = PHONE ? 3 : 6;                      // cutting budget per frame
  const CUT_STEP = PHONE ? 511 : 1023;                 // triangles between yields (a slice must fit a phone frame)
  const GATHER_STEP = PHONE ? 120 : 300;               // meshes / instances read between yields
  const MAX_PARTS = PHONE ? 8 : 14;                    // level groups a falling cluster is drawn in
  const ST = 11;                                       // floats per vertex: pos3 nrm3 uv2 col3
  const BAND = 0.9;                                    // m inside a face plane that is that face's wall
  const SL = 0.3;                                      // storey cut sits this far under the floor
  const SLAB_T = 0.32;                                 // the floor plate (the cap a slab edge shows)
  const WT = 0.4;                                      // the wall solid (the cap a wall section shows)
  const YARD = 5;                                      // past this outside the footprint: the yard's, not the building's
  const TOL = 0.5;                                     // m a support may be penetrated in one step
  const TICK = 0.1;                                    // load path solve period (s)
  const W_MAX = 4;                                     // rad/s: the most a loose panel tumbles
  const V_SIDE = 9;                                    // m/s: the most a split-off block keeps sideways
  const PIECE_UP = 1.2;                                // m/s: the most a piece of a landing storey climbs
  const PIECE_SPIN = 7;                                // rad/s: ... and tumbles

  const structs = [];                                  // live structures (cut, standing or falling)
  const byGroup = new WeakMap();                       // building group -> structure
  const retired = new WeakMap();                       // group -> what a rebuild must restore
  const holes = [];                                    // undermined ground: {x, z, r, depth}
  const bodies = [];                                   // falling structural bodies
  const stats = { cuts: 0, cutMs: 0, tris: 0, pieces: 0, bodiesMade: 0, maxAwake: 0, awakeSum: 0, frames: 0,
    ms: 0, msMax: 0, carsCrushed: 0, baked: 0, shattered: 0, crushed: 0, blasted: 0,
    capSettled: 0, capShattered: 0, drops: 0, rewoken: 0 };

  // ---- growable float buffer -----------------------------------------------
  function Buf() { this.a = new Float32Array(ST * 48); this.n = 0; }
  Buf.prototype.need = function (k) {
    if (this.n + k <= this.a.length) return;
    let L = this.a.length * 2;
    while (L < this.n + k) L *= 2;
    const b = new Float32Array(L); b.set(this.a.subarray(0, this.n)); this.a = b;
  };

  // ---- which building, in what frame ---------------------------------------
  // the ledger's one lot list (arena + annex + promoted), so an annex tower's
  // key is its lot's like every other building's
  function arenaLots() {
    if (CBZ.structure && CBZ.structure.allLots) return CBZ.structure.allLots();
    const A = CBZ.city && (CBZ.city.arena || CBZ.city); return (A && A.lots) || null;
  }
  function norm(x) {
    if (!x) return null;
    if (x.building && x.building.group) x = x.building;           // a lot
    const grp = x.group;
    if (!grp || !grp.isObject3D) return null;
    const ud = grp.userData || {};
    const b = ud.bld || (x.colliders && x.windows ? x : null);
    const B = b || {};
    const ox = x.ox != null ? x.ox : x.x != null ? x.x : B.ox;
    const oz = x.oz != null ? x.oz : x.z != null ? x.z : B.oz;
    if (!isFinite(ox) || !isFinite(oz)) return null;
    const storeys = Math.max(1, Math.round(x.storeys || B.storeys || ((x.h || B.h || 3.2) / (x.FH || B.FH || 3.2))) || 1);
    const FH = x.FH || B.FH || ((x.h || B.h) ? (x.h || B.h) / storeys : 3.2);
    let key = x.key || (b && b._cbzKey) || null;
    if (!key && b) {
      const lots = arenaLots();
      if (lots) for (let i = 0; i < lots.length; i++) if (lots[i].building === b) { key = Math.round(lots[i].cx) + "," + Math.round(lots[i].cz); break; }
    }
    return {
      grp: grp, b: b, ox: ox, oz: oz, gy: x.gy != null ? x.gy : (B.gy || 0),
      w: Math.max(1, x.w || B.w || 10), d: Math.max(1, x.d || B.d || 10),
      h: Math.max(2, x.h || B.h || storeys * FH), storeys: storeys, FH: FH,
      key: key || (Math.round(ox) + "," + Math.round(oz)),
      style: x.style || (B.dress && B.dress.style) || B.dressStyle || B.facadeStyle || null,
      wall: x.wall != null ? x.wall : (B.wallColor != null ? B.wallColor : (x.color != null ? x.color : 0x8b8f94)),
      masonry: x.masonry != null ? x.masonry : B.masonry,
      panes: x.panes || B.windows || null, solids: x.solids || B.losMeshes || null,
      root: x.root || grp.parent || CBZ.scene, groundAt: x.groundAt || null,
      openings: B.openings || null, material: x.material || null,
    };
  }

  /* BAY LINES along one axis: cut down the piers. `iv` are the openings'
     [t0, t1] along this axis; a cut lands on the middle of the pier nearest
     each target, so a line never runs through a window. */
  function bayLines(span, iv, target, maxN) {
    const half = span / 2;
    let n = Math.max(1, Math.round(span / target));
    if (n > maxN) n = maxN;
    const step = span / n;
    iv = (iv || []).filter(function (a) { return a[1] > -half && a[0] < half; }).sort(function (a, b) { return a[0] - b[0]; });
    const merged = [];
    for (const a of iv) {
      const m = merged[merged.length - 1];
      if (m && a[0] <= m[1] + 0.05) m[1] = Math.max(m[1], a[1]); else merged.push([a[0], a[1]]);
    }
    const piers = [];
    for (let i = 0; i + 1 < merged.length; i++) piers.push((merged[i][1] + merged[i + 1][0]) / 2);
    const out = [-half];
    for (let i = 1; i < n; i++) {
      const want = -half + step * i;
      let best = want, bd = step * 0.4;
      for (const p of piers) { const dd = Math.abs(p - want); if (dd < bd) { bd = dd; best = p; } }
      if (best > out[out.length - 1] + step * 0.45 && best < half - step * 0.45) out.push(best);
    }
    out.push(half);
    return out;
  }

  /* THE REGION. A strike into the 30th floor of a 38-storey tower used to cut
     the WHOLE tower at full resolution — every storey clipped down every
     pier, every pane of every floor copied in as glass, a cap on every
     piece: 150k triangles in, ~450k out, ~60 MB of arrays and the same again
     on the GPU (measured on the tablet profile), enough on its own to take
     an iPad tab down. Only the storeys round the damage are cut fine now:
     REGION_PAD storeys either side of the damage sphere. Above and below,
     the building is still cut into its storeys (so it stands, sags,
     pancakes and topples as before, storey by storey), but a storey is not
     clipped down its piers (a triangle goes whole to the bay its centre is
     in), gets no caps, and its glass stays in the instanced pane pools
     drawing as it always did: a pane is only turned into geometry when the
     piece it is on actually comes away (geoOf). A condemnation, a quake or
     an undermine — damage that is everywhere at once — still cuts it all. */
  const REGION_PAD = PHONE ? 2 : TABLET ? 2 : 3;
  /* THE BUDGET: what every standing cut building holds in arrays (its bands
     and their pristine copy; the GPU holds the bands again). Past it, a new
     cut keeps to the struck storey and one either side. */
  const CUT_BUDGET = (PHONE ? 16 : TABLET ? 32 : 96) * 1048576;
  function bandBytes(S) {
    let b = 0;
    for (const ms of S.meshes) { const A = ms.geometry.attributes; for (const k in A) if (A[k].array) b += A[k].array.byteLength; }
    for (const p of S.pristine) b += p.byteLength;
    return b + (S.liveBytes || 0);
  }
  C.liveBytes = function () { let b = 0; for (const S of structs) if (!S.disposed) b += S.bytes || 0; return b; };
  function regionOf(D, hint) {
    const ns = D.storeys;
    if (!hint || !isFinite(hint.y)) return { all: true, fine: null };
    const k = Math.floor((hint.y - D.gy + SL) / D.FH);
    const pad = (C.liveBytes() > CUT_BUDGET ? 1 : REGION_PAD) + Math.ceil(Math.max(0, hint.r || 0) / D.FH);
    const s0 = Math.max(0, k - pad), s1 = Math.min(ns, k + pad);
    if (s0 <= 0 && s1 >= ns) return { all: true, fine: null };
    const fine = new Uint8Array(ns + 1);
    for (let s = s0; s <= s1; s++) fine[s] = 1;
    return { all: false, fine: fine };
  }
  // the region is a SET of storeys (a second strike lower down adds its own
  // storeys, never the untouched ones between the two)
  function fineLevel(S, s) { return S.region.all || S.region.fine[s] === 1; }
  function coarseSpan(S, a, b) { if (S.region.all) return false; for (let s = a; s <= b; s++) if (S.region.fine[s] === 1) return false; return true; }
  function fineSpan(S, a, b) { if (S.region.all) return true; for (let s = a; s <= b; s++) if (S.region.fine[s] !== 1) return false; return true; }
  function makeStruct(D, hint) {
    const P = C.profile({ w: D.w, d: D.d, h: D.h, storeys: D.storeys, FH: D.FH, style: D.style, masonry: D.masonry, material: D.material });
    const m = P.m;
    const ns = D.storeys, FH = D.FH;
    // the building's own window spans along each axis (faces 0/1 run along x, 2/3 along z)
    const ivX = [], ivZ = [];
    for (const op of D.openings || []) {
      if (!op || op.t0 == null) continue;
      ((op.s === 0 || op.s === 1) ? ivX : ivZ).push([op.t0, op.t1]);
    }
    const xs = bayLines(D.w, ivX, BAY_TARGET, MAX_BAYS);
    const zs = bayLines(D.d, ivZ, BAY_TARGET, MAX_BAYS);
    const nx = xs.length - 1, nz = zs.length - 1;
    // the frame: origin on the footprint centre, the group's own yaw
    D.grp.updateWorldMatrix(true, false);
    const e = D.grp.matrixWorld.elements;
    const yaw = Math.atan2(e[8], e[0]);
    const L = new THREE.Matrix4().makeRotationY(yaw).setPosition(D.ox, D.gy, D.oz);
    const Linv = new THREE.Matrix4().copy(L).invert();
    const S = {
      D: D, key: D.key, b: D.b, grp: D.grp, prof: P, m: m, material: P.material,
      ox: D.ox, oz: D.oz, gy: D.gy, yaw: yaw, cos: Math.cos(yaw), sin: Math.sin(yaw),
      L: L, Linv: Linv, q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      w: D.w, d: D.d, hw: D.w / 2, hd: D.d / 2, h: D.h, FH: FH, ns: ns, xs: xs, zs: zs, nx: nx, nz: nz,
      rigid: m.ductile >= 0.4 || (m.hinge >= 0.6 && P.slender >= 1.9),
      chunks: [], levels: [], wallBase: [0, 0, 0, 0], nWall: [nx, nx, nz, nz], tileBase: 0,
      ready: false, swapped: false, disposed: false, gen: null, pending: [],
      meshes: [], pristine: [], dirty: new Set(), root: null,
      standingCount: 0, standingMass: 0, totalMass: 0, capMul: 1, active: 0, tick: 0,
      levelLost: new Uint8Array(ns + 1), deadCols: [], deadPlats: [], newCols: [], newPlats: [], surgQ: [], surgI: 0,
      instHide: [], origCols: null, coreMat: null, topY: D.h,
      region: regionOf(D, hint), livePanes: [], liveInst: [], readback: null,
      liveSrc: [], liveWalls: new Set(), triHid: [], wallHid: [], xv: null, xT: 0, liveBytes: 0, spans: [], promo: [], collect: null, promoting: false, spanMode: false,
      stats: { chunks: 0, tris: 0, crushed: 0, blasted: 0, detached: 0, bodies: 0, pieces: 0, baked: 0, carsCrushed: 0,
        tipped: 0, maxTilt: 0, pancaked: 0, firstFall: -1, lastSettle: -1, cutMs: 0, born: nowT,
        foot: { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, cells: new Set() } },
      outcome: null,
    };
    // the chunk grid: every wall (face x bay x level) and every tile (bay x bay x level)
    let id = 0;
    for (let f = 0; f < 4; f++) {
      S.wallBase[f] = id;
      for (let j = 0; j < S.nWall[f]; j++) for (let s = 0; s <= ns; s++) S.chunks.push(newChunk(S, id++, 0, f, j, -1, -1, s));
    }
    S.tileBase = id;
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) for (let s = 0; s <= ns; s++) S.chunks.push(newChunk(S, id++, 1, -1, -1, ix, iz, s));
    for (let s = 0; s <= ns; s++) S.levels.push([]);
    for (const c of S.chunks) S.levels[c.s].push(c);
    return S;
  }
  function wallAt(S, f, j, s) { return S.chunks[S.wallBase[f] + j * (S.ns + 1) + s]; }
  function tileAt(S, ix, iz, s) { return S.chunks[S.tileBase + (ix * S.nz + iz) * (S.ns + 1) + s]; }
  function ylo(S, s) { return s === 0 ? -0.6 : s * S.FH - SL; }
  function yhi(S, s) { return s < S.ns ? (s + 1) * S.FH - SL : Math.max(S.topY, S.ns * S.FH + 0.6); }
  function newChunk(S, id, kind, f, j, ix, iz, s) {
    const c = { i: id, kind: kind, f: f, j: j, ix: ix, iz: iz, s: s, S: S,
      bufs: null, gb: null, rg: null, tris: 0,
      opA: 0, glA: 0, sol: 0, mass: 0, cap0: 1, hp: 1, tough: 1, load: 0, inc: 0, ratio: 0,
      standing: true, held: true, direct: true, hang: null, hd: 0, tear: false, undermined: false,
      below: [], bw: [], above: [], lat: [],
      cx: 0, cy: 0, cz: 0, x0: 0, x1: 0, z0: 0, z1: 0, top: 0,
      origCols: null, subCols: null, origPlats: null, subPlats: null, panes: null, body: null, mark: 0 };
    // the cell box (building-local)
    if (kind === 0) {
      const xs = S.xs, zs = S.zs, hw = S.hw, hd = S.hd;
      if (f < 2) { c.x0 = xs[j]; c.x1 = xs[j + 1]; c.z0 = f === 0 ? -hd - 0.3 : hd - BAND; c.z1 = f === 0 ? -hd + BAND : hd + 0.3; }
      else { c.z0 = zs[j]; c.z1 = zs[j + 1]; c.x0 = f === 2 ? -hw - 0.3 : hw - BAND; c.x1 = f === 2 ? -hw + BAND : hw + 0.3; }
    } else { c.x0 = S.xs[ix]; c.x1 = S.xs[ix + 1]; c.z0 = S.zs[iz]; c.z1 = S.zs[iz + 1]; }
    return c;
  }
  function idxIn(lines, v) {               // bay index of v, clamped
    let lo = 0, hi = lines.length - 2;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lines[mid] <= v) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function levelOf(S, y) { const k = Math.floor((y + SL) / S.FH); return k < 0 ? 0 : k > S.ns ? S.ns : k; }
  // the chunk a building-local point belongs to (null: the yard's)
  function chunkAt(S, x, y, z) {
    const hw = S.hw, hd = S.hd;
    const d0 = z + hd, d1 = hd - z, d2 = x + hw, d3 = hw - x;
    let f = 0, m = d0;
    if (d1 < m) { m = d1; f = 1; }
    if (d2 < m) { m = d2; f = 2; }
    if (d3 < m) { m = d3; f = 3; }
    if (m < -YARD || y < -1.2) return null;
    const s = levelOf(S, y);
    if (m < BAND) return wallAt(S, f, f < 2 ? idxIn(S.xs, x) : idxIn(S.zs, z), s);
    return tileAt(S, idxIn(S.xs, x), idxIn(S.zs, z), s);
  }

  // ---- the sources: everything the building draws, in building-local space
  const _m4 = HAS3 ? new THREE.Matrix4() : null, _m4b = HAS3 ? new THREE.Matrix4() : null;
  const _n3b = HAS3 ? new THREE.Matrix3() : null;
  const _v3 = HAS3 ? new THREE.Vector3() : null;
  let unitBoxGeo = null;
  function unitBox() {
    if (!unitBoxGeo) { unitBoxGeo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed(); unitBoxGeo._shared = true; }
    return unitBoxGeo;
  }
  const vcMats = new WeakMap();            // a material + per-vertex colour (instanced trim baked to verts)
  function vcMat(m) {
    if (!m || m.vertexColors) return m;
    let v = vcMats.get(m);
    if (!v) { v = m.clone(); v.vertexColors = true; v.color = new THREE.Color(0xffffff); vcMats.set(m, v); }
    return v;
  }
  function inFoot(S, lx, ly, lz, pad) {
    return lx > -S.hw - pad && lx < S.hw + pad && lz > -S.hd - pad && lz < S.hd + pad && ly > -1 && ly < S.h + 4;
  }
  /* A generator, like the cut it feeds: a tower's group holds thousands of
     meshes and its pools tens of thousands of instances, so reading them
     yields to the frame every few hundred instead of landing on one. */
  /* A GPU-ONLY GEOMETRY HAS NO TRIANGLES TO CUT. The streamed city drops a
     merged mesh's JS arrays once they are uploaded (core/batch.js
     dropUploaded, core/citystream.js), so the cut read `index.array` as
     null, threw, and the building was marked failed for good: every annex
     and downtown tower whose deco or rooms had been merged could take no
     damage at all — a plane into its 30th floor carved nothing. The
     arrays are read back from the GPU for the cut (once, for this one
     building: core/batch.js batchReadbackGeo) and dropped again when the
     cut is done (releaseReadback). A geometry that cannot be read back is
     left out of the cut rather than failing it. */
  function readable(S, g) {
    const pos = g.attributes.position;
    let need = !pos.array || (g.index && !g.index.array);
    if (!need) for (const k in g.attributes) { const a = g.attributes[k]; if (a && !a.array && !a.isInterleavedBufferAttribute) { need = true; break; } }
    if (!need) return true;
    // a packed (quantised) attribute is citystream's to restore, not ours
    for (const k in g.attributes) { const a = g.attributes[k]; if (a && (a._cbzQ || a._cbzQn)) return false; }
    const gone = [];
    for (const k in g.attributes) { const a = g.attributes[k]; if (a && !a.array) gone.push(a); }
    if (g.index && !g.index.array) gone.push(g.index);
    if (!CBZ.batchReadbackGeo || !CBZ.batchReadbackGeo(g)) return false;
    (S.readback || (S.readback = new Map())).set(g, { attrs: gone, n: 0 });
    return !!(pos.array && (!g.index || g.index.array));
  }
  // every source that reads a read-back geometry holds it; the last one to
  // be cut drops its arrays at once (cutGen), not at the end of the cut
  function holdReadback(S, srcs) {
    if (!S.readback) return;
    for (const s of srcs) { const r = S.readback.get(s.geo || s.ig); if (r) r.n++; }
  }
  function doneReadback(S, g) {
    const r = S.readback && S.readback.get(g);
    if (!r || --r.n > 0) return;
    for (const a of r.attrs) a.array = null;
    S.readback.delete(g);
  }
  function releaseReadback(S) {
    if (!S.readback) return;
    S.readback.forEach(function (r) { for (const a of r.attrs) a.array = null; });
    S.readback = null;
  }
  function* gatherSources(S) {
    const D = S.D, grp = D.grp, out = [];
    const solids = new Set(D.solids || []);
    const bld = D.b;
    // the merged shells (core/batch.js wall pass) that know their walls: a
    // wall in one of them can go on drawing from it (see LIVE)
    const R = CBZ.batchRangesOf ? CBZ.batchRangesOf(grp) : null;
    const shells = new Map();
    if (R && CBZ.batchWallSliceOf && CBZ.batchWallHide) for (const e of R) if (e && e.whole && e.walls && e.mesh) shells.set(e.mesh, e);
    const skinnable = !!(bld && CBZ.citySkin && CBZ.cityIsShellMat);
    grp.updateWorldMatrix(true, true);
    const objs = [];
    grp.traverse(function (o) { if (o.isMesh && !o.isSkinnedMesh) objs.push(o); });
    let work = 0;
    for (const o of objs) {
      if ((work += o.isInstancedMesh ? o.count : 1) > GATHER_STEP) { work = 0; yield; }
      if (o.userData && (o.userData.debrisPiece || o.userData.cbzCollapseShell)) continue;
      if (!solids.has(o) && !visibleIn(o, grp.parent)) continue;
      if (o._breached && !solids.has(o) && !o.visible) continue;
      const geo = o.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) continue;
      if (!readable(S, geo)) continue;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      let any = false;
      for (const mm of mats) if (mm && mm.visible !== false && !(mm.transparent && mm.opacity < 0.05)) any = true;
      if (!any) continue;
      if (o.isInstancedMesh) {
        const n = o.count, tri = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        if (n * tri > 60000) continue;
        for (let i = 0; i < n; i++) {
          o.getMatrixAt(i, _m4);
          const M = new THREE.Matrix4().multiplyMatrices(S.Linv, _m4b.multiplyMatrices(o.matrixWorld, _m4));
          out.push({ k: "inst", geo: geo, mat: o.material, M: M, glass: isGlass(mats[0]), col: o.instanceColor ? colorOf(o.instanceColor, i) : null });
        }
        continue;
      }
      let mt = o.material;
      if (skinnable && !Array.isArray(mt) && !isGlass(mt) && CBZ.cityIsShellMat(bld, mt)) {
        if (!geo.boundingBox) geo.computeBoundingBox();
        _bb.copy(geo.boundingBox).applyMatrix4(o.matrixWorld);
        const slab = (_bb.max.x - _bb.min.x) > S.w * 0.6 && (_bb.max.z - _bb.min.z) > S.d * 0.6;
        if (!slab) {
          let sk = null;
          try { sk = CBZ.citySkin(bld, (_bb.min.x + _bb.max.x) / 2, (_bb.min.z + _bb.max.z) / 2); } catch (e) { sk = null; }
          if (sk) mt = sk;
        }
      }
      const los = solids.has(o) && !o.visible;
      const src = { k: los ? "los" : "own", geo: geo, mat: mt, M: new THREE.Matrix4().multiplyMatrices(S.Linv, o.matrixWorld), glass: isGlass(mats[0]), col: null };
      // a wall baked into its shell keeps drawing from it, triangle by
      // triangle, where its storey is coarse: its triangles are the shell's
      // run of the index at the wall's place in the bake (see shellRun)
      if (los && !o._breached && !Array.isArray(mt) && shells.size) {
        const sl = CBZ.batchWallSliceOf(o), sh = sl && shells.get(sl.mesh);
        const io = sh ? shellRun(sh, o) : -1;
        if (io >= 0) { src.wall = o; src.entry = sh; src.mesh = sl.mesh; src.off = io; src.vbase = sl.start; src.live = true; }
      }
      out.push(src);
    }
    yield;
    // the merged deco core/batch.js took out of the group (world space)
    if (R) for (const e of R) {
      if (!e || e.whole || e._stash || !e.mesh || (e.mesh._cbzRoom && !e.mesh._cbzRoom.built)) continue;
      const g = e.mesh.geometry;
      if (!g || !g.attributes || !g.attributes.position || e.mesh._cbzPacked) continue;
      if (!readable(S, g)) continue;
      // e.start / e.count count VERTICES; the cut walks triangles, so the
      // slice is its run of the index (the merge keeps each source's indices
      // together, in vertex order). It used to read the index at the vertex
      // offsets: two thirds of a room, or another building's deco.
      const tr = triRun(g, e.start, e.count);
      out.push({ k: e.mesh._cbzRoom ? "room" : "batch", geo: g, mat: e.mesh.material, M: new THREE.Matrix4().multiplyMatrices(S.Linv, e.mesh.matrixWorld), glass: false, col: null,
        start: tr[0], count: tr[1] - tr[0], entry: e, mesh: e.mesh, live: !!(g.index && CBZ.batchTriHide && !Array.isArray(e.mesh.material)) });
    }
    /* THE PANES (instanced pools, world records), cut from what the pool
       DRAWS: the pool's own geometry (its front and back faces and two edge
       slivers; a whole unit box adds a top and bottom layer of glass that
       reads darker) and the material it shows right now (a lit pane shows
       in the warm pool after dusk). The cut keeps the pool's draw settings
       (no shadows, after the opaque world): see glassDraw(). */
    const panes = [];
    for (const gp of D.panes || []) {
      if (!gp || gp.shattered || gp.mesh || !(gp.hw > 0) || !(gp.hh > 0)) continue;
      // a pane on a storey outside the region stays in its pool, drawing; it
      // becomes geometry only if its piece comes away (geoOf / hideChunk)
      if (!S.region.all) {
        _v3.set(gp.x, gp.y, gp.z).applyMatrix4(S.Linv);
        if (!fineLevel(S, levelOf(S, _v3.y))) { S.livePanes.push(gp); continue; }
      }
      let pm = (gp.proxy && gp.proxy.material) || (gp.pool && gp.pool.material);
      let pg = (gp.pool && gp.pool.geometry) || null;
      if (gp.litPool && gp.litId >= 0 && gp.litPool.count > gp.litId) {
        const a = gp.litPool.instanceMatrix.array, o = gp.litId * 16;
        if (a[o] !== 0 || a[o + 5] !== 0) { pm = gp.litPool.material; pg = gp.litPool.geometry || pg; }
      }
      if (!pm) continue;
      if (!pg || !pg.attributes || !pg.attributes.position) pg = unitBox();
      const M = new THREE.Matrix4().makeScale(gp.hw * 2, gp.hh * 2, Math.max(gp.hd || 0, 0.006) * 2).setPosition(gp.x, gp.y, gp.z);
      out.push({ k: "pane", geo: pg, mat: pm, M: new THREE.Matrix4().multiplyMatrices(S.Linv, M), glass: true, col: null });
      panes.push(gp);
    }
    S.panes = panes;
    yield;
    // the instanced trim / veneer pools on the city root (world coordinates,
    // owned by no group): every instance standing on this building is read
    // and, at the swap, hidden
    const hosts = new Set();
    if (grp.parent) hosts.add(grp.parent);
    if (CBZ.poolIdentityHost) { try { const h = CBZ.poolIdentityHost(grp); if (h) hosts.add(h); } catch (e) {} }
    const wc = new THREE.Vector3(D.ox, D.gy + D.h / 2, D.oz), wr = Math.hypot(D.w, D.d, D.h) / 2 + 3;
    for (const host of hosts) {
      for (const im of host.children) {
        if (!im.isInstancedMesh || im === grp) continue;
        const ud = im.userData || {};
        if (!ud.glassPool && !ud.masonryPool && ud.litCapacity == null) continue;
        const bs = im.geometry.boundingSphere;
        if (bs && bs.center.distanceTo(wc) > bs.radius + wr) continue;
        const glassPool = !!(im.material && im.material.transparent);
        const lit = ud.litCapacity != null;
        const arr = im.instanceMatrix.array;
        for (let i = 0; i < im.count; i++) {
          const o = i * 16;
          if ((++work & 4095) === 0) yield;
          if (arr[o] === 0 && arr[o + 5] === 0 && arr[o + 10] === 0) continue;      // a hidden instance
          _v3.set(arr[o + 12], arr[o + 13], arr[o + 14]).applyMatrix4(S.Linv);
          if (!inFoot(S, _v3.x, _v3.y, _v3.z, 1.2)) continue;
          // a pane outside the region keeps drawing from its pool (its record
          // is a live pane: see S.livePanes)
          const fine = fineLevel(S, levelOf(S, _v3.y));
          if ((lit || (glassPool && D.panes)) && !fine) continue;
          // trim / veneer outside the region likewise stays an instance in its
          // pool, drawing; its piece takes it as geometry only if it comes away
          if (!fine) {
            S.liveInst.push({ im: im, i: i, m: arr.slice(o, o + 16), x: arr[o + 12], y: arr[o + 13], z: arr[o + 14],
              mat: im.instanceColor ? vcMat(im.material) : im.material, col: im.instanceColor ? colorOf(im.instanceColor, i) : null });
            continue;
          }
          S.instHide.push({ im: im, i: i, m: arr.slice(o, o + 16) });
          if (lit || (glassPool && D.panes)) continue;                               // the panes come in through their records
          _m4.fromArray(arr, o);
          out.push({ k: "pool", geo: im.geometry.index ? null : im.geometry, ig: im.geometry, mat: im.instanceColor ? vcMat(im.material) : im.material,
            M: new THREE.Matrix4().multiplyMatrices(S.Linv, _m4), glass: glassPool, col: im.instanceColor ? colorOf(im.instanceColor, i) : null });
        }
      }
    }
    return out;
  }
  function colorOf(attr, i) { return [attr.getX(i), attr.getY(i), attr.getZ(i)]; }

  /* THE CUTTER. One triangle in (33 floats, building-local), clipped at every
     line it crosses, each piece filed into the chunk its centroid is in. */
  const EPS = 1e-4;
  /* The line strictly inside [b0, b1] NEAREST ITS MIDDLE (lines sorted).
     Halving, not peeling: a facade member emitted once full-height (a
     curtain wall's mullion runs 70 m in two triangles) is cut into its
     storeys in log2(storeys) levels of recursion, never left whole because
     the recursion ran out peeling one storey at a time. */
  function splitOf(S, a, b) {
    const mid = (b[0] + b[1]) / 2;
    let best = null, bd = Infinity;
    for (let i = 1; i < a.length - 1; i++) {
      const v = a[i];
      if (v <= b[0] + EPS || v >= b[1] - EPS) continue;
      const d = Math.abs(v - mid);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
  function findSplit(S, P) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const v of P) {
      if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0];
      if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1];
      if (v[2] < z0) z0 = v[2]; if (v[2] > z1) z1 = v[2];
    }
    // OUTSIDE THE REGION a triangle is only cut at the storey lines (so each
    // storey keeps its own), never down the piers
    if (!S.region.all) {
      const ka = levelOf(S, y0 + EPS), kb = levelOf(S, y1 - EPS);
      if (!fineSpan(S, ka, kb)) {
        if (kb <= ka || y1 - y0 <= 0.02) return null;
        if (S.spanMode && coarseSpan(S, ka, kb)) return null;
        const k0 = Math.max(1, Math.floor((y0 + SL) / S.FH) + 1);
        const k1 = Math.min(S.ns, Math.ceil((y1 + SL) / S.FH) - 1);
        if (k0 <= k1) {
          const k = Math.round((k0 + k1) / 2), Y = k * S.FH - SL;
          if (Y > y0 + EPS && Y < y1 - EPS) return [1, Y];
          const Y0 = k0 * S.FH - SL;
          if (Y0 > y0 + EPS && Y0 < y1 - EPS) return [1, Y0];
        }
        return null;
      }
    }
    if (x1 - x0 > 0.02) { const x = splitOf(S, S.xs, [x0, x1]); if (x != null) return [0, x]; }
    if (z1 - z0 > 0.02) { const z = splitOf(S, S.zs, [z0, z1]); if (z != null) return [2, z]; }
    if (y1 - y0 > 0.02) {
      const k0 = Math.max(1, Math.floor((y0 + SL) / S.FH) + 1);
      const k1 = Math.min(S.ns, Math.ceil((y1 + SL) / S.FH) - 1);
      if (k0 <= k1) {
        const k = Math.round((k0 + k1) / 2), Y = k * S.FH - SL;
        if (Y > y0 + EPS && Y < y1 - EPS) return [1, Y];
        const Y0 = k0 * S.FH - SL;
        if (Y0 > y0 + EPS && Y0 < y1 - EPS) return [1, Y0];
      }
    }
    return null;
  }
  function lerpV(a, b, t) {
    const o = new Float32Array(ST);
    for (let k = 0; k < ST; k++) o[k] = a[k] + (b[k] - a[k]) * t;
    return o;
  }
  function clipEmit(S, P, mat, glass, depth) {
    const sp = depth < 48 ? findSplit(S, P) : null;
    if (!sp) { emitPoly(S, P, mat, glass); return; }
    const ax = sp[0], val = sp[1], lo = [], hi = [];
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      const da = a[ax] - val, db = b[ax] - val;
      if (da <= 0) lo.push(a);
      if (da >= 0) hi.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const v = lerpV(a, b, da / (da - db)); lo.push(v); hi.push(v); }
    }
    if (lo.length >= 3) clipEmit(S, lo, mat, glass, depth + 1);
    if (hi.length >= 3) clipEmit(S, hi, mat, glass, depth + 1);
  }
  const _ct = new Float32Array(3);
  /* S.collect (a Set): the cut is LEARNING where a live span triangle's
     pieces would go (everything is accounted, nothing is copied; the pieces
     are collected). S.promoting: a span is being cut for real, long after the
     cut accounted it (everything is copied, nothing accounted twice). */
  function emitPoly(S, P, mat, glass) {
    if (S.spanMode) {
      let y0 = Infinity, y1 = -Infinity;
      for (const v of P) { if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1]; }
      const ka = levelOf(S, y0 + EPS), kb = levelOf(S, y1 - EPS);
      if (kb > ka && y1 - y0 > 0.02 && coarseSpan(S, ka, kb)) { spanEmit(S, P, mat, glass); return; }
    }
    let cx = 0, cy = 0, cz = 0;
    for (const v of P) { cx += v[0]; cy += v[1]; cz += v[2]; }
    cx /= P.length; cy /= P.length; cz /= P.length;
    const c = chunkAt(S, cx, cy, cz);
    if (!c) return;
    // a refine files only into its own storeys' standing (or empty) pieces:
    // a piece that has already come away does not get its slab back
    if (S.refining && (!c.refine || (!c.standing && !c.void))) return;
    const col = S.collect, acc = !S.promoting;
    let B = null;
    if (!col) {
      if (!c.bufs) c.bufs = new Map();
      B = c.bufs.get(mat);
      if (!B) { B = new Buf(); c.bufs.set(mat, B); }
    }
    const out = c.kind === 0 ? outN(S, c.f) : null;
    for (let i = 1; i + 1 < P.length; i++) {
      const a = P[0], b = P[i], d = P[i + 1];
      // area + face normal (the solidity a wall panel shows its street)
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ar2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (ar2 < 1e-7) continue;
      if (out && acc) {
        const dn = (nx * out[0] + nz * out[2]) / ar2;
        if (glass) c.glA += ar2 * 0.5 * Math.abs(dn);
        else if (dn > 0.6) c.opA += ar2 * 0.5;
      }
      if (B) B.need(ST * 3);
      for (const v of [a, b, d]) {
        if (B) {
          const A = B.a, o = B.n;
          for (let k = 0; k < ST; k++) A[o + k] = v[k];
          const l = Math.hypot(v[3], v[4], v[5]) || 1;
          A[o + 3] /= l; A[o + 4] /= l; A[o + 5] /= l;
          B.n += ST;
        }
        if (!acc) continue;
        if (!c.gb) c.gb = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
        const g = c.gb;
        if (v[0] < g[0]) g[0] = v[0]; if (v[0] > g[1]) g[1] = v[0];
        if (v[1] < g[2]) g[2] = v[1]; if (v[1] > g[3]) g[3] = v[1];
        if (v[2] < g[4]) g[4] = v[2]; if (v[2] > g[5]) g[5] = v[2];
      }
      if (!acc) continue;
      c.tris++;
      const ok = (S._srcK || "?") + (col ? "L" : fineLevel(S, c.s) ? "F" : "C"), OK = S.stats.outK || (S.stats.outK = {});
      OK[ok] = (OK[ok] || 0) + 1;
      if (col) { c.ltris = (c.ltris || 0) + 1; col.add(c); }
    }
    if (acc && cy > S.topY) S.topY = cy;
  }
  const OUTN = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  function outN(S, f) { return OUTN[f]; }

  /* ============================================================
     LIVE — what the bounded cut leaves where it is drawn. A coarse storey
     (outside the region) is never clipped down its piers, so a triangle of
     it that sits inside one storey is filed WHOLE into the piece its centre
     is in: copying it into the standing bands was a second copy of the
     building's own geometry (~10 MB of a 38-storey tower's rooms and walls,
     JS and GPU) to draw what was already drawing. Such a triangle now stays
     in the merged mesh it came from (a room's furniture, the deco, a wall in
     its merged shell) and only its piece knows it is there: its run of the
     index (or its wall) is taken out of that mesh the moment the piece comes
     away (hideChunk), and read back as geometry for the body / the pieces /
     the rubble it becomes (geoOf), or for the fine cut a later hit makes of
     its storey (refineGen). Everything the cut did take — the region, a
     triangle across a storey line, a wall across two pieces — is taken out
     of those meshes at the swap. Index runs (core/batch.js batchTriHide)
     never touch the vertices, so they compose with every position-zeroing
     hide a demolition or a rebuild does to the same building.
     ============================================================ */
  const DEAD = { dead: true };
  // where a wall's indices start in its merged shell: the bake writes each
  // wall's indices (or one per vertex) in the order of the shell's walls
  function shellRun(sh, wall) {
    let M = sh._cbzRun;
    if (!M) {
      M = sh._cbzRun = new Map();
      let io = 0;
      for (const w of sh.walls) {
        const g = w.geometry, pa = g && g.attributes && g.attributes.position;
        if (!pa) { M = sh._cbzRun = new Map(); break; }
        M.set(w, io);
        io += g.index ? g.index.count : pa.count;
      }
      const ix = sh.mesh.geometry && sh.mesh.geometry.index;
      if (!ix || ix.count !== io) M.clear();            // not the bake this was read from
    }
    const r = M.get(wall);
    return r == null ? -1 : r;
  }
  // the index run of a merged slice of vertices [vs, vs + vc): the first
  // triangle at or past each end (indices come in source order)
  function triRun(g, vs, vc) {
    const I = g.index && g.index.array;
    if (!I) return [vs, vs + vc];
    const first = function (v) {
      let lo = 0, hi = (I.length / 3) | 0;
      while (lo < hi) { const m = (lo + hi) >> 1; if (I[m * 3] < v) lo = m + 1; else hi = m; }
      return lo * 3;
    };
    return [first(vs), first(vs + vc)];
  }
  // the coarse piece a triangle sits wholly inside (it would be filed there
  // unsplit), or null
  /* (a floor-to-ceiling partition, a column, a stair flight reaches the
     storey line under the next floor by the slab's depth: it is its own
     storey's whole, as long as what it reaches into is coarse too) */
  const LIVE_TOL = 0.45;
  function liveChunk(S, P) {
    let y0 = Infinity, y1 = -Infinity;
    for (let j = 0; j < 3; j++) { const y = P[j][1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const cx = (P[0][0] + P[1][0] + P[2][0]) / 3, cy = (P[0][1] + P[1][1] + P[2][1]) / 3, cz = (P[0][2] + P[1][2] + P[2][2]) / 3;
    const s = levelOf(S, cy);
    if (fineLevel(S, s)) {
      // in the region: only what the cutter would not split at all (a desk,
      // a wall panel between two piers) — it goes whole to its piece either way
      const sm = S.spanMode;
      S.spanMode = false;
      const sp = findSplit(S, P);
      S.spanMode = sm;
      if (sp) return null;
      const c = chunkAt(S, cx, cy, cz);
      return c && c.s === s ? c : null;
    }
    const lo = ylo(S, s), hi = yhi(S, s);
    if (lo - y0 > LIVE_TOL || y1 - hi > LIVE_TOL) return null;
    if (y0 < lo - EPS && s > 0 && fineLevel(S, s - 1)) return null;
    if (y1 > hi + EPS && s < S.ns && fineLevel(S, s + 1)) return null;
    const c = chunkAt(S, cx, cy, cz);
    return c && c.s === s ? c : null;
  }
  // what emitPoly learns from a triangle (bounds, solidity, the count),
  // without the copy
  function fileLive(S, c, P, glass) {
    const a = P[0], b = P[1], d = P[2];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const ar2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (ar2 >= 1e-7 && c.kind === 0) {
      const out = OUTN[c.f], dn = (nx * out[0] + nz * out[2]) / ar2;
      if (glass) c.glA += ar2 * 0.5 * Math.abs(dn);
      else if (dn > 0.6) c.opA += ar2 * 0.5;
    }
    if (!c.gb) c.gb = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    const g = c.gb;
    for (let j = 0; j < 3; j++) {
      const v = P[j];
      if (v[0] < g[0]) g[0] = v[0]; if (v[0] > g[1]) g[1] = v[0];
      if (v[1] < g[2]) g[2] = v[1]; if (v[1] > g[3]) g[3] = v[1];
      if (v[2] < g[4]) g[4] = v[2]; if (v[2] > g[5]) g[5] = v[2];
    }
    c.tris++; c.ltris = (c.ltris || 0) + 1;
    const cy = (a[1] + b[1] + d[1]) / 3;
    if (cy > S.topY) S.topY = cy;
    const OK = S.stats.outK || (S.stats.outK = {}), ok = (S._srcK || "?") + "L";
    OK[ok] = (OK[ok] || 0) + 1;
  }
  // one triangle of a merged slice: live in its piece, or cut (and so taken
  // out of the mesh at the swap)
  function liveTri(S, L, k, P, mt, glass) {
    const c = P ? liveChunk(S, P) : null;
    if (c) fileLive(S, c, P, glass);
    else if (P) clipEmit(S, P, mt, glass, 0);
    const h = c || DEAD;
    if (h !== L.cur) { closeRun(L, k); L.cur = h; L.a = k; }
  }
  function closeRun(L, k) {
    const c = L.cur;
    if (!c || k <= L.a) return;
    if (c === DEAD) L.dead.push(L.a, k);
    else { (c.lr || (c.lr = [])).push(L, L.a, k); L.nLive += (k - L.a) / 3; }
  }
  /* A SPAN: a polygon across coarse storeys (a stair core's wall, a lift
     shaft, an atrium's glass run the height of the tower) used to be cut at
     every storey line it crossed — ~70 triangles of copy for one — though
     nothing there may ever break. The cut (S.spanMode) stops at the coarse
     run and files it WHOLE in a span: one band range, every piece it would
     have been cut into accounted as if it had been and told it is there.
     The first of those pieces to leave cuts it for real (promote), into all
     of them at once. */
  function spanEmit(S, P, mat, glass) {
    const got = S.collect = new Set();
    S.spanMode = false;
    try { clipEmit(S, P, mat, glass, 0); } finally { S.collect = null; S.spanMode = true; }
    if (!got.size) return;
    const H = { span: true, bufs: new Map(), rg: null, chunks: Array.from(got), mt: mat, glass: glass, done: false };
    const B = new Buf();
    H.bufs.set(mat, B);
    for (let i = 1; i + 1 < P.length; i++) {
      B.need(ST * 3);
      for (const v of [P[0], P[i], P[i + 1]]) {
        const A = B.a, o = B.n;
        for (let k = 0; k < ST; k++) A[o + k] = v[k];
        const l = Math.hypot(v[3], v[4], v[5]) || 1;
        A[o + 3] /= l; A[o + 4] /= l; A[o + 5] /= l;
        B.n += ST;
      }
    }
    for (const ch of H.chunks) (ch.sp || (ch.sp = [])).push(H);
    S.spans.push(H);
  }
  // a piece with spans leaves: they are cut for real (batched: the first
  // read or hide after it flushes the lot)
  function queueSpans(S, c) {
    if (!c.sp) return;
    for (const sp of c.sp) if (!sp.done) { sp.done = true; S.promo.push(sp); }
  }
  function flushSpans(S) {
    // (never inside a cut or a refine: those own the pieces' buffers until
    // they are banded; the spans wait for the next frame after it)
    if (!S.promo.length || S.disposed || S.gen || S.refining) return;
    const list = S.promo.splice(0);
    const V = new Float32Array(ST * 3);
    const P = [V.subarray(0, ST), V.subarray(ST, ST * 2), V.subarray(ST * 2, ST * 3)];
    S.promoting = true;
    try {
      for (const sp of list) {
        const rg = sp.rg;
        if (!rg) continue;
        for (let r = 0; r < rg.length; r += 3) {
          const mesh = S.meshes[rg[r]], st = rg[r + 1], n = rg[r + 2];
          if (!mesh) continue;
          const Aa = mesh.geometry.attributes, pp = S.pristine[rg[r]], nn = Aa.normal.array, uu = Aa.uv.array, cc = Aa.color ? Aa.color.array : null;
          for (let t = 0; t + 2 < n; t += 3) {
            for (let j = 0; j < 3; j++) {
              const q = st + t + j, v = P[j];
              v[0] = pp[q * 3]; v[1] = pp[q * 3 + 1]; v[2] = pp[q * 3 + 2];
              v[3] = nn[q * 3]; v[4] = nn[q * 3 + 1]; v[5] = nn[q * 3 + 2];
              v[6] = uu[q * 2]; v[7] = uu[q * 2 + 1];
              if (cc) { v[8] = cc[q * 3]; v[9] = cc[q * 3 + 1]; v[10] = cc[q * 3 + 2]; } else { v[8] = 1; v[9] = 1; v[10] = 1; }
            }
            clipEmit(S, P, mesh.material, sp.glass, 0);
          }
          // the whole span's range goes dark: its pieces draw it now
          mesh.geometry.attributes.position.array.fill(0, st * 3, (st + n) * 3);
          S.dirty.add(mesh);
        }
        sp.rg = null;
      }
    } finally { S.promoting = false; }
    // (every piece that took some: a storey refined since is cut down its piers too)
    const made = [], before = new Map();
    for (const ch of S.chunks) if (ch.bufs) { made.push(ch); before.set(ch, ch.rg ? ch.rg.length : 0); }
    if (!made.length) return;
    makeBands(S, made, S.root);
    for (const ch of made) {
      ch.bufs = null;
      // a piece already gone from the picture draws none of it
      if (ch.hidden && ch.rg) for (let k = before.get(ch) || 0; k < ch.rg.length; k += 3) {
        const mesh = S.meshes[ch.rg[k]];
        if (!mesh) continue;
        mesh.geometry.attributes.position.array.fill(0, ch.rg[k + 1] * 3, (ch.rg[k + 1] + ch.rg[k + 2]) * 3);
        S.dirty.add(mesh);
      }
    }
    S.bytes = bandBytes(S);
    stats.spans = (stats.spans || 0) + list.length;
  }
  // take a run / a wall out of the mesh that draws it (remembered: a rebuild
  // puts it back)
  function triHide(S, L, a, b) {
    if (CBZ.batchTriHide(L.mesh, a, L.orig.subarray(a - L.ia, b - L.ia))) S.triHid.push(L, a, b);
  }
  function wallHide(S, w) {
    if (CBZ.batchWallHide(w)) S.wallHid.push(w);
  }
  function hideLive(S, c) {
    if (c.lHid) return;
    c.lHid = true;
    if (c.lr) for (let r = 0; r < c.lr.length; r += 3) triHide(S, c.lr[r], c.lr[r + 1], c.lr[r + 2]);
  }
  function restoreLive(tri, walls) {
    for (let r = 0; r < tri.length; r += 3) {
      const L = tri[r], a = tri[r + 1], b = tri[r + 2];
      try { CBZ.batchTriShow(L.mesh, a, L.orig.subarray(a - L.ia, b - L.ia)); } catch (e) {}
    }
    for (const w of walls) { try { CBZ.batchWallShow(w); } catch (e) {} }
  }
  /* The arrays a live source is read from, when its piece comes away: what
     the geometry holds; read back from the GPU for this (the streamed city
     keeps none once uploaded) or unpacked from its parked 16-bit form, the
     geometry itself left as it was; a room that is only its recipe again,
     baked for this. Kept for a burst (a storey coming away is many pieces
     over a few frames), dropped two seconds after the last read. */
  function viewOf(S, src) {
    const key = src.wall ? src.geo : (src.mesh || src.geo);
    let v = S.xv ? S.xv.get(key) : undefined;
    if (v !== undefined) { S.xT = nowT; return v; }
    v = null;
    let g = src.geo;
    const R = !src.wall && src.mesh && src.mesh._cbzRoom;
    if (R && !R.built) g = CBZ.batchRoomBake ? CBZ.batchRoomBake(src.mesh) : null;
    const A = g && g.attributes;
    if (A && A.position) {
      const back = [];
      for (const k in A) if (A[k] && !A[k].array && !A[k]._cbzQ && !A[k]._cbzQn) back.push(A[k]);
      if (g.index && !g.index.array) back.push(g.index);
      const ok = !back.length || (CBZ.batchReadbackGeo && CBZ.batchReadbackGeo(g));
      const pa = A.position, na = A.normal, ua = A.uv, ca = A.color;
      let P = pa.array;
      if (!P && pa._cbzQ) {
        const Q = pa._cbzQ, q = Q.q;
        P = new Float32Array(q.length);
        for (let i = 0; i < q.length; i += 3) { P[i] = Q.o[0] + q[i] * Q.s[0]; P[i + 1] = Q.o[1] + q[i + 1] * Q.s[1]; P[i + 2] = Q.o[2] + q[i + 2] * Q.s[2]; }
      }
      const C = ca && ca.array;
      if (ok && P) v = { P: P, N: na ? (na.array || na._cbzQn || null) : null, U: ua ? ua.array : null, C: C || null, I: g.index ? g.index.array : null,
        cs: C && ca.normalized && !(C instanceof Float32Array) ? 1 / (C instanceof Int8Array ? 127 : C instanceof Uint16Array ? 65535 : C instanceof Int16Array ? 32767 : 255) : 1 };
      for (const a of back) a.array = null;
    }
    (S.xv || (S.xv = new Map())).set(key, v);
    S.xT = nowT;
    return v;
  }
  // a chunk's live triangles, building-local, appended per material (ST floats)
  const _lm3 = HAS3 ? new THREE.Matrix3() : null;
  function liveTris(S, c, byMat) {
    const put = function (src, vw, ids, k0, k1, viaIdx) {
      const e = src.M.elements, q = _lm3.getNormalMatrix(src.M).elements;
      const mt = src.mat;
      let B = byMat.get(mt); if (!B) { B = new Buf(); byMat.set(mt, B); }
      const Pp = vw.P, N = vw.N, U = vw.U, Cc = vw.C, cs = vw.cs;
      B.need(Math.max(0, k1 - k0) * ST);
      for (let k = k0; k + 2 < k1; k += 3) {
        for (let j = 0; j < 3; j++) {
          const i = viaIdx ? ids[k + j] : k + j, o = B.n, A = B.a;
          const px = Pp[i * 3], py = Pp[i * 3 + 1], pz = Pp[i * 3 + 2];
          A[o] = e[0] * px + e[4] * py + e[8] * pz + e[12];
          A[o + 1] = e[1] * px + e[5] * py + e[9] * pz + e[13];
          A[o + 2] = e[2] * px + e[6] * py + e[10] * pz + e[14];
          if (N) {
            const a = N[i * 3], b = N[i * 3 + 1], d = N[i * 3 + 2];
            let x = q[0] * a + q[3] * b + q[6] * d, y = q[1] * a + q[4] * b + q[7] * d, z = q[2] * a + q[5] * b + q[8] * d;
            const l = Math.hypot(x, y, z) || 1;
            A[o + 3] = x / l; A[o + 4] = y / l; A[o + 5] = z / l;
          } else { A[o + 3] = 0; A[o + 4] = 1; A[o + 5] = 0; }
          if (U) { A[o + 6] = U[i * 2]; A[o + 7] = U[i * 2 + 1]; } else { A[o + 6] = 0; A[o + 7] = 0; }
          if (src.col) { A[o + 8] = src.col[0]; A[o + 9] = src.col[1]; A[o + 10] = src.col[2]; }
          else if (Cc) { A[o + 8] = Cc[i * 3] * cs; A[o + 9] = Cc[i * 3 + 1] * cs; A[o + 10] = Cc[i * 3 + 2] * cs; }
          else { A[o + 8] = 1; A[o + 9] = 1; A[o + 10] = 1; }
          B.n += ST;
        }
      }
    };
    if (c.lr) for (let r = 0; r < c.lr.length; r += 3) {
      const L = c.lr[r], vw = viewOf(S, L);
      if (!vw) continue;
      const a = c.lr[r + 1] - L.ia, b = c.lr[r + 2] - L.ia;
      // a wall is read from its own geometry (its own material, the skin the
      // cut gives it), a room / deco slice from the merged mesh
      if (L.wall) { if (vw.I) put(L, vw, vw.I, a, b, true); else put(L, vw, null, a, b, false); }
      else put(L, vw, L.orig, a, b, true);
    }
  }
  // ST buffers (per material) as meshes, about `off`
  function bufMeshes(byMat, off) {
    const out = [];
    byMat.forEach(function (B, mt) {
      const nv = B.n / ST;
      if (!nv || !mt) return;
      const vc = !!mt.vertexColors, A = B.a;
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), Cc = vc ? new Float32Array(nv * 3) : null;
      for (let v = 0; v < nv; v++) {
        const s = v * ST;
        P[v * 3] = A[s] - off.x; P[v * 3 + 1] = A[s + 1] - off.y; P[v * 3 + 2] = A[s + 2] - off.z;
        N[v * 3] = A[s + 3]; N[v * 3 + 1] = A[s + 4]; N[v * 3 + 2] = A[s + 5];
        U[v * 2] = A[s + 6]; U[v * 2 + 1] = A[s + 7];
        if (Cc) { Cc[v * 3] = A[s + 8]; Cc[v * 3 + 1] = A[s + 9]; Cc[v * 3 + 2] = A[s + 10]; }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      if (Cc) g.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
      g.computeBoundingSphere();
      out.push(glassDraw(new THREE.Mesh(g, mt)));
    });
    return out;
  }

  /* The generator: every source's triangles through the cutter, yielding to
     the frame every ~1500 triangles. */
  function* cutGen(S) {
    const t0 = performance.now();
    let srcs;
    try { srcs = yield* gatherSources(S); } catch (e) { console.warn("[collapse] gather", e); srcs = []; }
    holdReadback(S, srcs);
    S.cutGatherMs = performance.now() - t0;
    yield;
    const nm = new THREE.Matrix3();
    let n = 0;
    // one scratch triangle, three views on it: the common case (a triangle
    // inside one cell) allocates nothing; only a triangle that is actually
    // clipped makes new vertices
    const V = new Float32Array(ST * 3);
    const P = [V.subarray(0, ST), V.subarray(ST, ST * 2), V.subarray(ST * 2, ST * 3)];
    S.spanMode = !S.region.all;
    for (const src of srcs) {
      const geo = src.geo || src.ig;
      if (!geo) continue;
      const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv, col = geo.attributes.color;
      const idx = geo.index;
      if (!pos.array || (idx && !idx.array) || (nrm && !nrm.array) || (uv && !uv.array) || (col && !col.array)) continue;
      const M = src.M, e = M.elements;
      nm.getNormalMatrix(M);
      const q = nm.elements;
      const mats = Array.isArray(src.mat) ? src.mat : null;
      const total = idx ? idx.count : pos.count;
      const runs = (mats && geo.groups && geo.groups.length)
        ? geo.groups.map(function (g) { return [g.start, Math.min(total, g.start + g.count), mats[g.materialIndex || 0]]; })
        : [[src.start != null ? src.start : 0, src.count != null ? src.start + src.count : total, mats ? mats[0] : src.mat]];
      // a merged room / deco slice and a wall in its merged shell, triangle
      // by triangle: what a piece holds unsplit stays where it is drawn (LIVE)
      const LR = src.live && !S.region.all && runs.length === 1 && (idx || src.wall) ? src : null;
      const off = LR ? (LR.off || 0) : 0;
      if (LR) {
        LR.ia = runs[0][0] + off; LR.ib = runs[0][1] + off;
        if (src.wall) {
          // the shell's indices for this wall, as the bake wrote them
          const n0 = runs[0][0], nn = runs[0][1] - n0, o = new Uint32Array(Math.max(0, nn));
          for (let k = 0; k < nn; k++) o[k] = (idx ? idx.array[n0 + k] : n0 + k) + src.vbase;
          LR.orig = o;
        } else LR.orig = idx.array.slice(LR.ia, LR.ib);
        LR.dead = []; LR.cur = null; LR.a = LR.ia; LR.nLive = 0;
      }
      // a normalized colour attribute (the merged meshes keep 8-bit colour)
      const cs = col && col.normalized && !(col.array instanceof Float32Array) ? 1 / (col.array instanceof Int8Array ? 127 : col.array instanceof Uint16Array ? 65535 : col.array instanceof Int16Array ? 32767 : 255) : 1;
      for (const run of runs) {
        const mt = run[2];
        if (!mt || mt.visible === false) continue;
        const glass = src.glass || isGlass(mt);
        for (let k = run[0]; k + 2 < run[1]; k += 3) {
          let bad = false;
          for (let j = 0; j < 3; j++) {
            const i = idx ? idx.getX(k + j) : k + j;
            const v = P[j];
            const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
            v[0] = e[0] * px + e[4] * py + e[8] * pz + e[12];
            v[1] = e[1] * px + e[5] * py + e[9] * pz + e[13];
            v[2] = e[2] * px + e[6] * py + e[10] * pz + e[14];
            if (nrm) {
              const a = nrm.getX(i), b = nrm.getY(i), c = nrm.getZ(i);
              v[3] = q[0] * a + q[3] * b + q[6] * c; v[4] = q[1] * a + q[4] * b + q[7] * c; v[5] = q[2] * a + q[5] * b + q[8] * c;
            } else { v[3] = 0; v[4] = 1; v[5] = 0; }
            if (uv) { v[6] = uv.getX(i); v[7] = uv.getY(i); } else { v[6] = 0; v[7] = 0; }
            if (src.col) { v[8] = src.col[0]; v[9] = src.col[1]; v[10] = src.col[2]; }
            else if (col) { v[8] = col.getX(i) * cs; v[9] = col.getY(i) * cs; v[10] = col.getZ(i) * cs; }
            else { v[8] = 1; v[9] = 1; v[10] = 1; }
            if (!isFinite(v[0] + v[1] + v[2])) bad = true;
          }
          S._srcK = src.k;
          if (LR) { liveTri(S, LR, k + off, bad ? null : P, mt, glass); if ((++n & CUT_STEP) === 0) yield; continue; }
          if (bad) continue;
          clipEmit(S, P, mt, glass, 0);
          if ((++n & CUT_STEP) === 0) yield;
        }
      }
      if (LR) {
        closeRun(LR, LR.ib);
        if (LR.nLive) { S.liveSrc.push(LR); S.liveBytes += LR.orig.byteLength; if (LR.wall) S.liveWalls.add(LR.wall); }
        else LR.orig = null;
        LR.cur = null;
      }
      doneReadback(S, geo);
      const sk = S.stats.srcK || (S.stats.srcK = {});
      sk[src.k || "?"] = (sk[src.k || "?"] || 0) + n - (S._nPrev || 0);
      S._nPrev = n;
    }
    S.spanMode = false;
    S.stats.tris = n;
    releaseReadback(S);
    yield* finishCut(S);
    S.stats.cutMs = Math.round(performance.now() - t0);
    stats.cuts++; stats.tris += n;
  }

  /* ---- after the cut: weights, the load graph, the design, the caps, the
     standing meshes ------------------------------------------------------ */
  /* Also a generator: on a tower the weights, the graph, the design, the
     caps, the standing meshes and the colliders' filing are each a frame's
     worth of work, so each gets its own. */
  function* finishCut(S) {
    const ns = S.ns, FH = S.FH, m = S.m;
    // the live panes (outside the region, still in their pools) belong to the
    // piece they sit in: its glass, as if they had been cut into it
    for (const gp of S.livePanes) {
      const c = chunkAtWorld(S, gp.x, gp.y, gp.z);
      if (!c) continue;
      (c.livePanes || (c.livePanes = [])).push(gp);
      c.tris += 12; c.vtris = (c.vtris || 0) + 12;
      if (c.kind === 0) c.glA += 4 * gp.hh * Math.max(gp.hw, gp.hd || 0);
    }
    for (const it of S.liveInst) {
      const c = chunkAtWorld(S, it.x, it.y, it.z);
      if (!c) continue;
      (c.liveInst || (c.liveInst = [])).push(it);
      const g = it.im.geometry;
      const vt = Math.max(1, ((g.index ? g.index.count : g.attributes.position.count) / 3) | 0);
      c.tris += vt; c.vtris = (c.vtris || 0) + vt;
    }
    // solidity + mass
    for (const c of S.chunks) {
      const lvH = Math.max(0.5, Math.min(yhi(S, c.s), c.s < ns ? 1e9 : yhi(S, c.s)) - ylo(S, c.s));
      if (c.kind === 0) {
        const len = c.f < 2 ? c.x1 - c.x0 : c.z1 - c.z0;
        const face = len * Math.min(lvH, FH);
        c.sol = Math.max(0.05, Math.min(1, c.opA / Math.max(0.5, face)));
        if (!c.tris) c.sol = 0.05;
        c.mass = len * Math.min(lvH, FH) * WT * Math.max(0.15, c.sol) * m.rho + (c.tris ? 0.05 : 0.02);
        if (c.s === ns) c.mass *= c.tris ? 0.5 : 0.1;              // a parapet, not a storey of wall
      } else {
        const area = (c.x1 - c.x0) * (c.z1 - c.z0);
        c.mass = c.s === 0 ? area * 0.12 : area * (SLAB_T * 2.4 + 0.12);
        if (c.s === ns) c.mass += area * 0.05;
      }
      c.cx = (c.x0 + c.x1) / 2; c.cz = (c.z0 + c.z1) / 2;
      c.cy = (ylo(S, c.s) + yhi(S, c.s)) / 2;
      c.top = yhi(S, c.s);
      if (c.s === ns && c.gb) c.top = Math.max(ylo(S, c.s) + 0.3, c.gb[3]);
      if (!c.gb) c.gb = [c.x0, c.x1, ylo(S, c.s), yhi(S, c.s), c.z0, c.z1];
    }
    // OUTSIDE THE REGION a wall's veneer and trim are still instances in their
    // pools, so its measured solidity undercounts it: it takes the solidity
    // its own face shows inside the region (the same facade), never less
    if (!S.region.all) {
      const sum = [0, 0, 0, 0], num = [0, 0, 0, 0];
      for (const c of S.chunks) if (c.kind === 0 && c.tris && fineLevel(S, c.s) && c.s < ns) { sum[c.f] += c.sol; num[c.f]++; }
      for (const c of S.chunks) {
        if (c.kind !== 0 || !c.tris || fineLevel(S, c.s) || !num[c.f]) continue;
        const ref = sum[c.f] / num[c.f];
        if (ref <= c.sol) continue;
        const lvH = Math.max(0.5, Math.min(yhi(S, c.s), c.s < ns ? 1e9 : yhi(S, c.s)) - ylo(S, c.s));
        const len = c.f < 2 ? c.x1 - c.x0 : c.z1 - c.z0;
        c.sol = ref;
        c.mass = len * Math.min(lvH, FH) * WT * Math.max(0.15, c.sol) * m.rho + 0.05;
        if (c.s === ns) c.mass *= 0.5;
      }
    }
    yield;
    // the graph. A FRAME (steel, concrete, curtain wall, timber posts) has
    // columns: a floor tile stands on the tile under it. Bearing masonry
    // and adobe have none: a floor spans between the walls, hanging off the
    // tiles that sit on them (two bays in from each wall at most).
    const frame = S.frame = m.ductile >= 0.4;
    const wCol = frame ? 1.0 : 0.5, wWall = frame ? 0.4 : 1.2;
    const link = function (a, b) { if (a.lat.indexOf(b) < 0) { a.lat.push(b); b.lat.push(a); } };
    const sup = function (c, by, w) { c.below.push(by); c.bw.push(w); by.above.push(c); };
    const edgeTile = function (f, j, s) {
      return f === 0 ? tileAt(S, j, 0, s) : f === 1 ? tileAt(S, j, S.nz - 1, s) : f === 2 ? tileAt(S, 0, j, s) : tileAt(S, S.nx - 1, j, s);
    };
    for (let s = 0; s <= ns; s++) {
      for (let f = 0; f < 4; f++) {
        const n = S.nWall[f];
        for (let j = 0; j < n; j++) {
          const c = wallAt(S, f, j, s);
          if (s > 0) sup(c, wallAt(S, f, j, s - 1), 1);
          if (j + 1 < n) link(c, wallAt(S, f, j + 1, s));
          link(c, edgeTile(f, j, s));
        }
      }
      // the four corners
      link(wallAt(S, 0, 0, s), wallAt(S, 2, 0, s));
      link(wallAt(S, 0, S.nx - 1, s), wallAt(S, 3, 0, s));
      link(wallAt(S, 1, 0, s), wallAt(S, 2, S.nz - 1, s));
      link(wallAt(S, 1, S.nx - 1, s), wallAt(S, 3, S.nz - 1, s));
      for (let ix = 0; ix < S.nx; ix++) for (let iz = 0; iz < S.nz; iz++) {
        const c = tileAt(S, ix, iz, s);
        if (ix + 1 < S.nx) link(c, tileAt(S, ix + 1, iz, s));
        if (iz + 1 < S.nz) link(c, tileAt(S, ix, iz + 1, s));
        if (s > 0) {
          if (frame) sup(c, tileAt(S, ix, iz, s - 1), wCol);
          if (iz === 0) sup(c, wallAt(S, 0, ix, s - 1), wWall);
          if (iz === S.nz - 1) sup(c, wallAt(S, 1, ix, s - 1), wWall);
          if (ix === 0) sup(c, wallAt(S, 2, iz, s - 1), wWall);
          if (ix === S.nx - 1) sup(c, wallAt(S, 3, iz, s - 1), wWall);
        }
      }
    }
    /* EMPTY CELLS ARE NOT STRUCTURE. A cell the building put nothing in (a
       stair well, an atrium, the air over a setback) carries nothing: it must
       never hold up a slab, or a falling block, or be what a floor hangs off.
       The one exception is the ground storey of a frame, which stands on its
       columns whether the cut found anything drawn there or not. */
    for (const c of S.chunks) {
      // (outside the region a slab went whole to the bay its centre is in:
      // the frame's other bays on that storey still stand on their columns)
      if (c.tris || (frame && c.kind === 1 && (c.s === 0 || !fineLevel(S, c.s)))) continue;
      c.standing = false; c.void = true; c.hidden = true;
    }
    yield;
    // THE DESIGN: intact loads, then capacity = safety factor x load. The
    // factor drops on a storey that is mostly glass: the soft storey.
    loads(S, true);
    yield;
    // anything the building drew that the design could not find a way to
    // hold (a sign on a stalk, a lantern off a bracket) stays where it was
    // built for as long as something beside or under it stands
    for (const c of S.chunks) if (c.standing && !c.held) c.anchor = true;
    const sol = [];
    for (let s = 0; s < ns; s++) {
      let a = 0, n = 0;
      for (const c of S.levels[s]) if (c.kind === 0 && c.tris) { a += c.sol; n++; }
      sol.push(n ? a / n : 0.5);
    }
    const ref = sol.length > 1 ? sol.slice(1).sort(function (a, b) { return a - b; })[Math.floor((sol.length - 1) / 2)] : (sol[0] || 0.5);
    S.sf = [];
    for (let s = 0; s <= ns; s++) {
      const r = s < ns ? Math.pow(Math.max(0.05, sol[s]) / Math.max(0.05, ref), 0.6) : 1;
      S.sf.push(m.sf * Math.max(0.55, Math.min(1.15, r)));
    }
    S.soft = S.sf.indexOf(Math.min.apply(null, S.sf.slice(0, Math.max(1, ns))));
    for (const c of S.chunks) {
      c.cap0 = Math.max(S.sf[c.s] * c.load, c.mass * 2 + 0.3);
      c.tough = m.tough * Math.pow(Math.max(0.2, c.mass), 0.8);
      if (c.standing) S.totalMass += c.mass;
    }
    S.standingMass = S.totalMass;
    S.standingCount = S.chunks.filter(function (c) { return c.standing; }).length;
    S.standingReal = S.chunks.filter(function (c) { return c.tris > 0; }).length;
    S.stats.chunks = S.chunks.filter(function (c) { return c.tris > 0; }).length;
    // the cut faces
    S.coreMat = mat(mix(shade(S.D.wall, m.tone), 0x8d8a84, 0.4));
    yield;
    let k = 0;
    // caps on the region's pieces only: outside it a storey breaks as whole
    // bays, and nothing there was cut down a pier to need one
    for (const c of S.chunks) { if (c.tris && fineLevel(S, c.s)) addCaps(S, c); if ((++k & 255) === 0) yield; }
    yield* buildStanding(S);
    yield* fileColliders(S);
    S.ready = true;
  }
  /* THE COLLIDERS' FILING, ahead of the swap: which chunks each of the
     building's boxes and floors overlaps (the swap used to work this out on
     the frame of the first hit, a few hundred boxes against every storey). */
  function* fileColliders(S) {
    const b = S.b;
    S.colFile = new Map(); S.platFile = new Map();
    if (!b) return;
    const list = (b.colliders || []).slice();
    for (const dr of b.doors || []) if (dr && dr.col) list.push(dr.col);
    let k = 0;
    for (const c of list) {
      if (!c || c._cbzS || S.colFile.has(c)) continue;
      S.colFile.set(c, chunksOverlapping(S, c.minX, c.maxX, c.y0 != null ? c.y0 : -1e9, c.y1 != null ? c.y1 : 1e9, c.minZ, c.maxZ));
      if ((++k & 63) === 0) yield;
    }
    for (const p of b.platforms || []) {
      if (!p || p._cbzS || S.platFile.has(p)) continue;
      S.platFile.set(p, chunksOverlapping(S, p.minX, p.maxX, p.top - 0.05, p.top - 0.05, p.minZ, p.maxZ));
      if ((++k & 63) === 0) yield;
    }
  }

  /* CAPS: the inside of the material where the building was cut. A wall
     panel shows its section (the wall's thickness) at its bay ends and its
     storey lines; a floor tile shows its slab edge. Built once; inside a
     standing building they lie hidden in the solid, and the moment a
     neighbour falls away they are the broken face that was always there. */
  function quad(B, p0, p1, p2, p3, n) {
    // wind it to face n
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2], vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    let q = [p0, p1, p2, p3];
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) q = [p0, p3, p2, p1];
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const tri = [0, 1, 2, 0, 2, 3];
    B.need(ST * 6);
    for (const t of tri) {
      const o = B.n, A = B.a, p = q[t];
      A[o] = p[0]; A[o + 1] = p[1]; A[o + 2] = p[2];
      A[o + 3] = n[0]; A[o + 4] = n[1]; A[o + 5] = n[2];
      A[o + 6] = uvs[t][0]; A[o + 7] = uvs[t][1];
      A[o + 8] = 1; A[o + 9] = 1; A[o + 10] = 1;
      B.n += ST;
    }
  }
  function addCaps(S, c) {
    if (!c.bufs) c.bufs = new Map();
    let B = c.bufs.get(S.coreMat);
    if (!B) { B = new Buf(); c.bufs.set(S.coreMat, B); }
    const g = c.gb, y0 = Math.max(ylo(S, c.s), g[2]), y1 = Math.min(yhi(S, c.s), g[3]);
    if (c.kind === 0) {
      if (y1 - y0 < 0.2) return;
      const f = c.f, hw = S.hw, hd = S.hd, n = S.nWall[f];
      if (f < 2) {
        const zo = f === 0 ? -hd : hd, zi = f === 0 ? -hd + WT : hd - WT;
        if (c.j > 0) quad(B, [c.x0, y0, zo], [c.x0, y0, zi], [c.x0, y1, zi], [c.x0, y1, zo], [-1, 0, 0]);
        if (c.j < n - 1) quad(B, [c.x1, y0, zo], [c.x1, y0, zi], [c.x1, y1, zi], [c.x1, y1, zo], [1, 0, 0]);
        const xa = Math.max(c.x0, -hw), xb = Math.min(c.x1, hw);
        if (c.s > 0) quad(B, [xa, y0, zo], [xb, y0, zo], [xb, y0, zi], [xa, y0, zi], [0, -1, 0]);
        if (c.s < S.ns) quad(B, [xa, y1, zo], [xb, y1, zo], [xb, y1, zi], [xa, y1, zi], [0, 1, 0]);
      } else {
        const xo = f === 2 ? -hw : hw, xi = f === 2 ? -hw + WT : hw - WT;
        if (c.j > 0) quad(B, [xo, y0, c.z0], [xi, y0, c.z0], [xi, y1, c.z0], [xo, y1, c.z0], [0, 0, -1]);
        if (c.j < n - 1) quad(B, [xo, y0, c.z1], [xi, y0, c.z1], [xi, y1, c.z1], [xo, y1, c.z1], [0, 0, 1]);
        const za = Math.max(c.z0, -hd), zb = Math.min(c.z1, hd);
        if (c.s > 0) quad(B, [xo, y0, za], [xo, y0, zb], [xi, y0, zb], [xi, y0, za], [0, -1, 0]);
        if (c.s < S.ns) quad(B, [xo, y1, za], [xo, y1, zb], [xi, y1, zb], [xi, y1, za], [0, 1, 0]);
      }
    } else if (c.s > 0) {
      // the slab edge, if this tile carries a floor plate at its foot
      const fy = c.s * S.FH;
      if (g[2] > fy - SL + 0.35) return;
      const a0 = fy - SL + 0.02, a1 = fy + 0.04;
      const zA = Math.max(c.z0, -S.hd + WT), zB = Math.min(c.z1, S.hd - WT), xA = Math.max(c.x0, -S.hw + WT), xB = Math.min(c.x1, S.hw - WT);
      if (c.ix > 0) quad(B, [c.x0, a0, zA], [c.x0, a0, zB], [c.x0, a1, zB], [c.x0, a1, zA], [-1, 0, 0]);
      if (c.ix < S.nx - 1) quad(B, [c.x1, a0, zA], [c.x1, a0, zB], [c.x1, a1, zB], [c.x1, a1, zA], [1, 0, 0]);
      if (c.iz > 0) quad(B, [xA, a0, c.z0], [xB, a0, c.z0], [xB, a1, c.z0], [xA, a1, c.z0], [0, 0, -1]);
      if (c.iz < S.nz - 1) quad(B, [xA, a0, c.z1], [xB, a0, c.z1], [xB, a1, c.z1], [xA, a1, c.z1], [0, 0, 1]);
    }
  }

  /* THE STANDING BUILDING: one merged mesh per (storey band, material), each
     chunk a vertex range in it. A chunk that leaves is zeroed out of its
     range (degenerate, drawn as nothing); its own geometry is always read
     back from the pristine positions kept per mesh. */
  function* buildStanding(S) {
    const per = Math.max(1, Math.ceil((S.ns + 1) / BANDS));
    const root = new THREE.Group();
    root.name = "collapseStanding";
    root.userData.cbzCollapseShell = S.key;
    root.position.set(S.ox, S.gy, S.oz); root.rotation.y = S.yaw;
    root.updateMatrix(); root.updateMatrixWorld(true);
    for (let b0 = 0; b0 <= S.ns; b0 += per) {
      const list = [];
      for (let s = b0; s < Math.min(S.ns + 1, b0 + per); s++) for (const c of S.levels[s]) list.push(c);
      makeBands(S, list, root);
      // this band's cut buffers are copied: let them go now, not after the
      // last band (the peak was every chunk's buffers AND every band at once)
      for (const c of list) c.bufs = null;
      yield;
    }
    if (S.spans.length) { makeBands(S, S.spans, root); for (const H of S.spans) H.bufs = null; }
    for (const c of S.chunks) c.bufs = null;
    S.root = root;
    S.bytes = bandBytes(S);
  }
  // one merged mesh per material from these chunks' cut buffers, each chunk
  // a vertex range in it (c.rg)
  function makeBands(S, list, root) {
    const byMat = new Map();
    for (const c of list) {
      if (!c.bufs) continue;
      c.bufs.forEach(function (B, mt) {
        if (!B.n) return;
        let L = byMat.get(mt); if (!L) { L = []; byMat.set(mt, L); }
        L.push([c, B]);
      });
    }
    byMat.forEach(function (L, mt) {
      let nv = 0;
      for (const it of L) nv += it[1].n / ST;
      // a vertex colour only a vertex-coloured material reads: everywhere
      // else it was 12 bytes a vertex in JS and 12 more on the GPU, unread
      const vc = !!(mt && mt.vertexColors);
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), Cc = vc ? new Float32Array(nv * 3) : null;
      const mi = S.meshes.length;
      let o = 0;
      for (const it of L) {
        const c = it[0], A = it[1].a, n = it[1].n / ST;
        (c.rg || (c.rg = [])).push(mi, o, n);
        for (let v = 0; v < n; v++, o++) {
          const s = v * ST;
          P[o * 3] = A[s]; P[o * 3 + 1] = A[s + 1]; P[o * 3 + 2] = A[s + 2];
          N[o * 3] = A[s + 3]; N[o * 3 + 1] = A[s + 4]; N[o * 3 + 2] = A[s + 5];
          U[o * 2] = A[s + 6]; U[o * 2 + 1] = A[s + 7];
          if (Cc) { Cc[o * 3] = A[s + 8]; Cc[o * 3 + 1] = A[s + 9]; Cc[o * 3 + 2] = A[s + 10]; }
        }
      }
      const g = new THREE.BufferGeometry();
      const pa = new THREE.BufferAttribute(P, 3);
      pa.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("position", pa);
      g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      if (Cc) g.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mt);
      mesh.castShadow = !PHONE; mesh.receiveShadow = true;
      glassDraw(mesh);
      mesh.matrixAutoUpdate = false;
      mesh.name = "collapseBand";
      root.add(mesh);
      mesh.updateMatrixWorld(true);
      S.meshes.push(mesh);
      S.pristine.push(P.slice());
    });
  }

  /* ============================================================
     REFINE — a later hit OUTSIDE the region. The storeys it reaches (and
     REGION_PAD either side) are cut fine now, from what they already draw:
     each standing piece hands back its own triangles (the band copy), they
     go down the piers like the region's did, and the storeys get their caps
     and new bands. The old ranges go dark. Incremental and sliced: a second
     strike higher up a tower costs the storeys it hits, never the tower.
     ============================================================ */
  /* A band rebuilt without the ranges no chunk refers to any more (the
     refine took them): the memory goes with them, the chunks still in it
     keep their geometry, their zeroed (hidden) state and their pristine. */
  function compactBand(S, mi) {
    const mesh = S.meshes[mi];
    if (!mesh) return;
    const old = mesh.geometry, A = old.attributes, pp = S.pristine[mi];
    const keep = [];
    let nv = 0;
    for (const c of S.chunks.concat(S.spans)) {
      const rg = c.rg;
      if (rg) for (let k = 0; k < rg.length; k += 3) if (rg[k] === mi) { keep.push(c, k); nv += rg[k + 2]; }
    }
    if (nv >= A.position.count * 0.9) return;
    const vc = !!A.color;
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), Cc = vc ? new Float32Array(nv * 3) : null, PR = new Float32Array(nv * 3);
    const op = A.position.array, on = A.normal.array, ou = A.uv.array, oc = vc ? A.color.array : null;
    let o = 0;
    for (let i = 0; i < keep.length; i += 2) {
      const rg = keep[i].rg, k = keep[i + 1], st = rg[k + 1], n = rg[k + 2];
      P.set(op.subarray(st * 3, (st + n) * 3), o * 3);
      PR.set(pp.subarray(st * 3, (st + n) * 3), o * 3);
      N.set(on.subarray(st * 3, (st + n) * 3), o * 3);
      U.set(ou.subarray(st * 2, (st + n) * 2), o * 2);
      if (Cc) Cc.set(oc.subarray(st * 3, (st + n) * 3), o * 3);
      rg[k + 1] = o;
      o += n;
    }
    const g = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(P, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("position", pa);
    g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
    if (Cc) g.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
    g.computeBoundingSphere();
    mesh.geometry = g;
    old.dispose();
    S.pristine[mi] = PR;
    if (!nv) mesh.visible = false;
  }
  function wantRefine(S, ly0, ly1) {
    if (S.region.all) return;
    const a = levelOf(S, ly0), b = levelOf(S, ly1);
    if (fineSpan(S, Math.max(0, a), Math.min(S.ns, b))) return;
    const w = S.wantRefine || (S.wantRefine = [a, b]);
    if (a < w[0]) w[0] = a;
    if (b > w[1]) w[1] = b;
  }
  function* refineGen(S, a, b) {
    const s0 = Math.max(0, a - REGION_PAD), s1 = Math.min(S.ns, b + REGION_PAD);
    const lv = [];
    for (let s = s0; s <= s1; s++) if (!fineLevel(S, s)) { lv.push(s); S.region.fine[s] = 1; }
    if (S.region.fine.every(function (v) { return v === 1; })) S.region = { all: true, fine: null };
    // 1) every standing piece of those storeys gives its triangles back (a
    // span through them is cut into its pieces first)
    for (const s of lv) for (const c of S.levels[s]) if (c.sp) queueSpans(S, c);
    flushSpans(S);
    const byMat = new Map(), touched = new Set();
    for (const s of lv) {
      for (const c of S.levels[s]) {
        if (!c.standing || (!c.rg && !c.lr)) continue;
        // what it left drawing in the merged meshes comes out of them, into the cut
        if (c.lr) { liveTris(S, c, byMat); hideLive(S, c); c.lr = null; c.ltris = 0; }
        const rg = c.rg || [];
        for (let k = 0; k < rg.length; k += 3) {
          const mi = rg[k], st = rg[k + 1], n = rg[k + 2];
          const mesh = S.meshes[mi];
          if (!mesh) continue;
          const A = mesh.geometry.attributes, pp = S.pristine[mi];
          const nn = A.normal.array, uu = A.uv.array, cc = A.color ? A.color.array : null;
          let B = byMat.get(mesh.material); if (!B) { B = new Buf(); byMat.set(mesh.material, B); }
          B.need(n * ST);
          const F = B.a;
          for (let v = 0; v < n; v++) {
            const q = st + v, o = B.n + v * ST;
            F[o] = pp[q * 3]; F[o + 1] = pp[q * 3 + 1]; F[o + 2] = pp[q * 3 + 2];
            F[o + 3] = nn[q * 3]; F[o + 4] = nn[q * 3 + 1]; F[o + 5] = nn[q * 3 + 2];
            F[o + 6] = uu[q * 2]; F[o + 7] = uu[q * 2 + 1];
            if (cc) { F[o + 8] = cc[q * 3]; F[o + 9] = cc[q * 3 + 1]; F[o + 10] = cc[q * 3 + 2]; }
            else { F[o + 8] = 1; F[o + 9] = 1; F[o + 10] = 1; }
          }
          B.n += n * ST;
          mesh.geometry.attributes.position.array.fill(0, st * 3, (st + n) * 3);
          S.dirty.add(mesh); touched.add(mi);
        }
        c.rg = null; c.gb = null; c.tris = c.vtris || 0;
      }
    }
    // (the struck storeys' own pieces only: nothing else may take a piece)
    for (const s of lv) for (const c of S.levels[s]) if (!c.rg && !c.bufs) c.refine = true;
    yield;
    // 2) down the piers, into the pieces of their own storeys
    S.refining = true;
    const V = new Float32Array(ST * 3);
    const P = [V.subarray(0, ST), V.subarray(ST, ST * 2), V.subarray(ST * 2, ST * 3)];
    let n = 0;
    try {
      for (const ent of byMat) {
        const mt = ent[0], B = ent[1], A = B.a, glass = isGlass(mt);
        for (let t = 0; t + ST * 3 <= B.n; t += ST * 3) {
          for (let j = 0; j < 3; j++) { const v = P[j], o = t + j * ST; for (let k = 0; k < ST; k++) v[k] = A[o + k]; }
          clipEmit(S, P, mt, glass, 0);
          if ((++n & CUT_STEP) === 0) yield;
        }
      }
    } finally { S.refining = false; }
    byMat.clear();
    // 3) the pieces that now hold something stand; their caps; their bands
    const list = [];
    for (const s of lv) for (const c of S.levels[s]) {
      c.refine = false;
      if (!c.bufs) { if (!c.gb) c.gb = [c.x0, c.x1, ylo(S, c.s), yhi(S, c.s), c.z0, c.z1]; continue; }
      if (c.void) {
        c.void = false; c.hidden = false; c.standing = true;
        S.standingCount++; S.standingMass += c.mass; S.totalMass += c.mass; S.standingReal++;
      }
      if (!c.gb) c.gb = [c.x0, c.x1, ylo(S, c.s), yhi(S, c.s), c.z0, c.z1];
      addCaps(S, c);
      list.push(c);
    }
    yield;
    makeBands(S, list, S.root);
    for (const c of list) c.bufs = null;
    // the coarse copies those storeys used to be drawn from go (the bands
    // they sat in are rebuilt without them)
    touched.forEach(function (mi) { compactBand(S, mi); });
    S.active = Math.max(S.active, 3);
    stats.refines = (stats.refines || 0) + 1;
    S.bytes = bandBytes(S);
    S.ready = true;
  }

  /* A set of chunks' own geometry, building-local minus `off`, one geometry
     per material. */
  function geoOf(S, list, off) {
    if (S.promo.length) flushSpans(S);
    const byMat = new Map();
    for (const c of list) {
      const rg = c.rg;
      if (!rg) continue;
      for (let k = 0; k < rg.length; k += 3) {
        const mesh = S.meshes[rg[k]];
        let L = byMat.get(mesh.material); if (!L) { L = []; byMat.set(mesh.material, L); }
        L.push(rg[k], rg[k + 1], rg[k + 2]);
      }
    }
    const out = [];
    byMat.forEach(function (L, mt) {
      let nv = 0;
      for (let k = 0; k < L.length; k += 3) nv += L[k + 2];
      if (!nv) return;
      const vc = !!S.meshes[L[0]].geometry.attributes.color;
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), Cc = vc ? new Float32Array(nv * 3) : null;
      let o = 0;
      for (let k = 0; k < L.length; k += 3) {
        const mi = L[k], st = L[k + 1], n = L[k + 2];
        const src = S.meshes[mi].geometry.attributes, pp = S.pristine[mi];
        const nn = src.normal.array, uu = src.uv.array, cc = src.color ? src.color.array : null;
        for (let v = 0; v < n; v++, o++) {
          const s = st + v;
          P[o * 3] = pp[s * 3] - off.x; P[o * 3 + 1] = pp[s * 3 + 1] - off.y; P[o * 3 + 2] = pp[s * 3 + 2] - off.z;
          N[o * 3] = nn[s * 3]; N[o * 3 + 1] = nn[s * 3 + 1]; N[o * 3 + 2] = nn[s * 3 + 2];
          U[o * 2] = uu[s * 2]; U[o * 2 + 1] = uu[s * 2 + 1];
          if (Cc) {
            if (cc) { Cc[o * 3] = cc[s * 3]; Cc[o * 3 + 1] = cc[s * 3 + 1]; Cc[o * 3 + 2] = cc[s * 3 + 2]; }
            else { Cc[o * 3] = 1; Cc[o * 3 + 1] = 1; Cc[o * 3 + 2] = 1; }
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      if (Cc) g.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
      g.computeBoundingSphere();
      out.push(new THREE.Mesh(g, mt));
    });
    // the glass of a piece outside the region was never cut: it is still
    // its panes in the pools, so the piece takes them now, as geometry
    const live = [];
    for (const c of list) {
      if (c.livePanes) for (const gp of c.livePanes) {
        const q = paneSrc(gp);
        if (q) live.push({ geo: q.pg, mat: q.pm, M: new THREE.Matrix4().makeScale(gp.hw * 2, gp.hh * 2, Math.max(gp.hd || 0, 0.006) * 2).setPosition(gp.x, gp.y, gp.z), col: null });
      }
      if (c.liveInst) for (const it of c.liveInst) live.push({ geo: it.im.geometry, mat: it.mat, M: new THREE.Matrix4().fromArray(it.m), col: it.col });
    }
    if (live.length) for (const ms of liveMeshes(S, live, off)) out.push(ms);
    // ... and so are the triangles it left in the merged meshes (LIVE)
    const lm = new Map();
    for (const c of list) if (c.lr) liveTris(S, c, lm);
    if (lm.size) for (const ms of bufMeshes(lm, off)) out.push(ms);
    return out;
  }
  /* Live panes (never cut) as building-local glass meshes, one per material,
     the same box the cut would have made of them (gatherSources). */
  const _pm = HAS3 ? new THREE.Matrix4() : null, _pv = HAS3 ? new THREE.Vector3() : null;
  function paneSrc(gp) {
    let pm = (gp.proxy && gp.proxy.material) || (gp.pool && gp.pool.material);
    let pg = (gp.pool && gp.pool.geometry) || null;
    if (gp.litPool && gp.litId >= 0 && gp.litPool.count > gp.litId) {
      const a = gp.litPool.instanceMatrix.array, o = gp.litId * 16;
      if (a[o] !== 0 || a[o + 5] !== 0) { pm = gp.litPool.material; pg = gp.litPool.geometry || pg; }
    }
    if (!pg || !pg.attributes || !pg.attributes.position || !pg.attributes.position.array || (pg.index && !pg.index.array)) pg = unitBox();
    return pm ? { pm: pm, pg: pg } : null;
  }
  /* Live items (never cut: panes in their pools, trim / veneer instances) as
     building-local meshes, one per material: items {geo, mat, M (world),
     col}. A geometry whose arrays have gone to the GPU only is read back
     for this (it is a pool's shared unit shape: small, and kept). */
  function liveMeshes(S, items, off) {
    const byMat = new Map();
    for (const it of items) {
      const g = it.geo;
      if (!g || !g.attributes || !g.attributes.position || !it.mat) continue;
      if (!g.attributes.position.array || (g.index && !g.index.array)) { if (!CBZ.batchReadbackGeo || !CBZ.batchReadbackGeo(g)) continue; }
      let L = byMat.get(it.mat); if (!L) { L = []; byMat.set(it.mat, L); }
      L.push(it);
    }
    const out = [];
    byMat.forEach(function (L, mt) {
      let nv = 0;
      for (const it of L) { const g = it.geo; nv += g.index ? g.index.count : g.attributes.position.count; }
      if (!nv) return;
      const vc = !!mt.vertexColors;
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), Cc = vc ? new Float32Array(nv * 3) : null;
      let o = 0;
      for (const it of L) {
        const g = it.geo;
        _pm.multiplyMatrices(S.Linv, it.M);
        const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv, col = g.attributes.color, idx = g.index;
        const n = idx ? idx.count : pos.count;
        for (let v = 0; v < n; v++, o++) {
          const i = idx ? idx.getX(v) : v;
          _pv.fromBufferAttribute(pos, i).applyMatrix4(_pm);
          P[o * 3] = _pv.x - off.x; P[o * 3 + 1] = _pv.y - off.y; P[o * 3 + 2] = _pv.z - off.z;
          if (nrm && nrm.array) { _pv.fromBufferAttribute(nrm, i).transformDirection(_pm); N[o * 3] = _pv.x; N[o * 3 + 1] = _pv.y; N[o * 3 + 2] = _pv.z; }
          else N[o * 3 + 1] = 1;
          if (uv && uv.array) { U[o * 2] = uv.getX(i); U[o * 2 + 1] = uv.getY(i); }
          if (Cc) {
            if (it.col) { Cc[o * 3] = it.col[0]; Cc[o * 3 + 1] = it.col[1]; Cc[o * 3 + 2] = it.col[2]; }
            else if (col && col.array) { Cc[o * 3] = col.getX(i); Cc[o * 3 + 1] = col.getY(i); Cc[o * 3 + 2] = col.getZ(i); }
            else { Cc[o * 3] = 1; Cc[o * 3 + 1] = 1; Cc[o * 3 + 2] = 1; }
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      if (Cc) g.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
      g.computeBoundingSphere();
      out.push(glassDraw(new THREE.Mesh(g, mt)));
    });
    return out;
  }
  // a live pane stops drawing from its pool (its piece has come away)
  function hidePane(gp) {
    if (!gp || gp._cbzLiveGone) return;
    gp._cbzLiveGone = true;
    try { if (gp.mesh) gp.mesh.visible = false; else if (CBZ._paneShow) CBZ._paneShow(gp, false); } catch (e) {}
  }

  /* ---- THE SWAP: the real building out, its chunks in, on one frame ------- */
  function swap(S) {
    if (S.swapped || !S.ready) return;
    S.swapped = true;
    S.stats.born = nowT;
    const D = S.D, grp = S.grp;
    (D.root || CBZ.scene).add(S.root);
    // the merged meshes the coarse storeys go on drawing from stay up; what
    // the cut took out of them goes (LIVE)
    const keep = new Set();
    for (const L of S.liveSrc) keep.add(L.entry);
    try { if (CBZ.batchHideGroup) CBZ.batchHideGroup(grp, keep.size ? keep : undefined); } catch (e) {}
    grp.visible = false;
    try {
      for (const L of S.liveSrc) for (let r = 0; r < L.dead.length; r += 2) triHide(S, L, L.dead[r], L.dead[r + 1]);
      keep.forEach(function (e) { if (e.whole) for (const w of e.walls) if (!S.liveWalls.has(w)) wallHide(S, w); });
    } catch (e) { console.warn("[collapse] live", e); }
    evictReplaced(S);
    for (const gp of S.panes || []) {
      if (gp.shattered) continue;
      gp._cbzWasWhole = true;
      try { if (gp.mesh) gp.mesh.visible = false; else if (CBZ._paneShow) CBZ._paneShow(gp, false); } catch (e) {}
      const c = chunkAtWorld(S, gp.x, gp.y, gp.z);
      if (c) (c.panes || (c.panes = [])).push(gp);
    }
    const Z = new THREE.Matrix4().makeScale(0, 0, 0).elements;
    const touched = new Set();
    for (const r of S.instHide) { r.im.instanceMatrix.array.set(Z, r.i * 16); touched.add(r.im); }
    touched.forEach(function (im) { im.instanceMatrix.needsUpdate = true; });
    // THE COLLIDERS STAY THE BUILDING'S until a chunk leaves: each one is
    // filed under the chunks it overlaps, and when one of them goes the
    // original box comes out and the chunks still standing get their share
    // of it back as boxes of their own (see leave()).
    const b = S.b;
    S.origCols = [];
    if (b) {
      const list = (b.colliders || []).slice();
      for (const dr of b.doors || []) if (dr && dr.col) list.push(dr.col);
      const CF = S.colFile, PF = S.platFile;
      for (const c of list) {
        if (!c || c._cbzS) continue;
        c._cbzS = S;
        c._cbzCh = (CF && CF.get(c)) || chunksOverlapping(S, c.minX, c.maxX, c.y0 != null ? c.y0 : -1e9, c.y1 != null ? c.y1 : 1e9, c.minZ, c.maxZ);
        for (const ch of c._cbzCh) (ch.origCols || (ch.origCols = [])).push(c);
        S.origCols.push(c);
      }
      for (const p of b.platforms || []) {
        if (!p || p._cbzS) continue;
        p._cbzS = S;
        p._cbzCh = (PF && PF.get(p)) || chunksOverlapping(S, p.minX, p.maxX, p.top - 0.05, p.top - 0.05, p.minZ, p.maxZ);
        for (const ch of p._cbzCh) (ch.origPlats || (ch.origPlats = [])).push(p);
      }
      S.colFile = null; S.platFile = null;
    }
    wrapCarve();
  }
  /* THE REPLACED MESHES GIVE THEIR GPU COPY BACK. The building's own merged
     meshes (core/batch.js ranges that are WHOLLY this building's) are hidden
     by the swap and its chunks draw instead, but they went on holding their
     vertex buffers on the GPU for as long as the session lasted: the tower
     twice over. They are evicted the way core/farcull.js evicts a far mesh
     (dropped from the GPU; a GPU-only one read back and packed first), and
     C.forget expands them again when the building is rebuilt. */
  function evictReplaced(S) {
    const R = CBZ.batchRangesOf ? CBZ.batchRangesOf(S.grp) : null;
    if (!R) return;
    for (const e of R) {
      const m = e && e.whole ? e.mesh : null, g = m && m.geometry;
      const a = g && g.attributes && g.attributes.position;
      if (!a || !a._cbzUploaded || !g._evictable || m.visible) continue;
      const drop = function () {
        g.dispose();
        for (const k in g.attributes) g.attributes[k]._cbzUploaded = false;
        if (g.index) g.index._cbzUploaded = false;
      };
      if (!CBZ.geoReuploadable || CBZ.geoReuploadable(g)) { drop(); continue; }
      if (!CBZ.batchQueueEvict) continue;
      CBZ.batchQueueEvict(g, function () { return !m.visible && !S.disposed; }, function () {
        if (CBZ.geoCompactOwned) CBZ.geoCompactOwned(g);
        drop();
      });
    }
    S.evicted = true;
  }
  function expandReplaced(grp) {
    const R = CBZ.batchRangesOf ? CBZ.batchRangesOf(grp) : null;
    if (!R || !CBZ.geoExpandAll) return;
    for (const e of R) { const g = e && e.whole && e.mesh ? e.mesh.geometry : null; if (g && g._cbzNoDraw) { try { CBZ.geoExpandAll(g); } catch (er) {} } }
  }
  function chunkAtWorld(S, x, y, z) {
    _v3.set(x, y, z).applyMatrix4(S.Linv);
    return chunkAt(S, _v3.x, _v3.y, _v3.z);
  }
  // the standing chunks a WORLD box overlaps (the frame's yaw taken into the box's bounds)
  function chunksOverlapping(S, x0, x1, y0, y1, z0, z1) {
    let lx0 = Infinity, lx1 = -Infinity, lz0 = Infinity, lz1 = -Infinity;
    for (const px of [x0, x1]) for (const pz of [z0, z1]) {
      _v3.set(px, 0, pz).applyMatrix4(S.Linv);
      if (_v3.x < lx0) lx0 = _v3.x; if (_v3.x > lx1) lx1 = _v3.x;
      if (_v3.z < lz0) lz0 = _v3.z; if (_v3.z > lz1) lz1 = _v3.z;
    }
    const ly0 = y0 - S.gy, ly1 = y1 - S.gy;
    const s0 = levelOf(S, Math.max(-0.5, ly0) + 0.01), s1 = levelOf(S, Math.min(S.h + 50, ly1) - 0.01);
    const out = [];
    for (let s = s0; s <= s1; s++) for (const c of S.levels[s]) {
      if (c.x1 <= lx0 + 0.02 || c.x0 >= lx1 - 0.02 || c.z1 <= lz0 + 0.02 || c.z0 >= lz1 - 0.02) continue;
      out.push(c);
    }
    return out;
  }
  // a chunk's world AABB clipped by a world box (the share of a collider it keeps)
  function clipToChunk(S, c, x0, x1, z0, z1) {
    let a = Infinity, b = -Infinity, e = Infinity, f = -Infinity;
    for (const px of [c.x0, c.x1]) for (const pz of [c.z0, c.z1]) {
      _v3.set(px, 0, pz).applyMatrix4(S.L);
      if (_v3.x < a) a = _v3.x; if (_v3.x > b) b = _v3.x;
      if (_v3.z < e) e = _v3.z; if (_v3.z > f) f = _v3.z;
    }
    const r = { minX: Math.max(a, x0), maxX: Math.min(b, x1), minZ: Math.max(e, z0), maxZ: Math.min(f, z1) };
    return (r.maxX - r.minX > 0.04 && r.maxZ - r.minZ > 0.04) ? r : null;
  }

  /* ---- A CHUNK LEAVES THE STANDING BUILDING (fails, is blown out, or
     detaches into a falling body). Its range goes dark, its share of every
     collider / floor it held goes with it. */
  /* keepDrawn: the chunk has left the load path NOW, but goes on being drawn
     where it stood until whatever replaces it on screen (its body's mesh,
     its pieces) has been made (see the work queue, section 5). */
  function leave(S, c, keepDrawn) {
    if (!c.standing) return;
    markGone(S, c);
    if (!keepDrawn) hideChunk(S, c);
    S.surgQ.push(c);
  }
  /* THE SURGERY QUEUE. Taking a chunk's share out of the building's boxes
     and floors (and handing its neighbours theirs back) is a few clipped
     boxes per chunk, which is nothing for one chunk and tens of
     milliseconds for the 1,500 chunks of a tower top that tips at once. The
     load path does not read the boxes (it reads the chunks, which leave at
     once), so the boxes follow over the next frames inside a budget. */
  const SURG_MS = PHONE ? 1 : 2;
  function runSurgery(S, budget) {
    const Q = S.surgQ;
    if (S.surgI >= Q.length) return;
    const t0 = performance.now();
    let n = 0;
    while (S.surgI < Q.length && (n < 1 || performance.now() - t0 < budget)) { surgery(S, Q[S.surgI++]); n++; }
    if (S.surgI >= Q.length) { Q.length = 0; S.surgI = 0; }
  }
  function markGone(S, c) {
    c.standing = false;
    if (c.sp) queueSpans(S, c);
    S.standingCount--; S.standingMass -= c.mass;
    if (c.tris) S.standingReal--;
    S.levelLost[c.s] = 1;
    S.active = Math.max(S.active, 3);
  }
  function surgery(S, c) {
    const torn = !!(S.b && S.b._tornDown);
    for (const oc of c.origCols || []) {
      if (oc._cbzGone) continue;
      oc._cbzGone = true;
      S.deadCols.push(oc);
      if (torn) continue;
      for (const j of oc._cbzCh) {
        if (j === c || !j.standing) continue;
        const r = clipToChunk(S, j, oc.minX, oc.maxX, oc.minZ, oc.maxZ);
        if (!r) continue;
        const nc = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, _cbzS: S, _cbzSub: true, ref: oc.ref, noBreach: true };
        const ly0 = S.gy + ylo(S, j.s), ly1 = S.gy + yhi(S, j.s);
        nc.y0 = Math.max(oc.y0 != null ? oc.y0 : ly0, ly0); nc.y1 = Math.min(oc.y1 != null ? oc.y1 : ly1, ly1);
        if (nc.y1 - nc.y0 < 0.05) continue;
        (j.subCols || (j.subCols = [])).push(nc);
        S.newCols.push(nc);
      }
    }
    for (const sc of c.subCols || []) S.deadCols.push(sc);
    c.subCols = null;
    for (const op of c.origPlats || []) {
      if (op._cbzGone) continue;
      op._cbzGone = true;
      S.deadPlats.push(op);
      if (torn) continue;
      for (const j of op._cbzCh) {
        if (j === c || !j.standing) continue;
        const r = clipToChunk(S, j, op.minX, op.maxX, op.minZ, op.maxZ);
        if (!r) continue;
        const np = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, top: op.top, _cbzS: S, _cbzSub: true };
        (j.subPlats || (j.subPlats = [])).push(np);
        S.newPlats.push(np);
      }
    }
    for (const sp of c.subPlats || []) S.deadPlats.push(sp);
    c.subPlats = null;
    for (const gp of c.panes || []) {
      gp.shattered = true;
      if (gp.col) S.deadCols.push(gp.col);
    }
    for (const gp of c.livePanes || []) {
      if (gp.shattered) continue;
      gp.shattered = true;
      if (gp.col) S.deadCols.push(gp.col);
    }
    if (S.b && S.b.doors) for (const dr of S.b.doors) if (dr && dr.col && dr.col._cbzGone && !dr.demolished) { dr.demolished = true; dr.colIn = false; }
    if (!S.losGone && S.b && S.b.losMeshes) { S.losGone = true; S.deadLos = S.b.losMeshes.slice(); }
  }
  function hideChunk(S, c) {
    if (c.hidden || S.disposed) return;
    if (S.promo.length) flushSpans(S);
    c.hidden = true;
    if (c.lr) hideLive(S, c);
    if (c.livePanes) for (const gp of c.livePanes) hidePane(gp);
    if (c.liveInst) {
      for (const it of c.liveInst) {
        if (it.gone) continue;
        it.gone = true;
        it.im.instanceMatrix.array.fill(0, it.i * 16, it.i * 16 + 15);
        it.im.instanceMatrix.array[it.i * 16 + 15] = 1;               // the swap's own zero-scale matrix
        it.im.instanceMatrix.needsUpdate = true;
        S.instHide.push({ im: it.im, i: it.i, m: it.m });          // a rebuild puts it back (dispose / forget)
      }
    }
    const rg = c.rg;
    if (rg) for (let k = 0; k < rg.length; k += 3) {
      const mesh = S.meshes[rg[k]];
      if (!mesh) continue;
      mesh.geometry.attributes.position.array.fill(0, rg[k + 1] * 3, (rg[k + 1] + rg[k + 2]) * 3);
      S.dirty.add(mesh);
    }
  }
  /* THE WORLD'S INDICES, IN PLACE AND IN BATCHES. A box comes out of the
     collider grid by an indexOf in each cell it covers, and a cut building's
     cells hold its every box and every share of one: taking a whole tipped
     storey's boxes out on one frame was that search squared (the 20 ms frame
     in the lab). At most a batch a frame comes out (the rest wait a frame or
     two: an invisible wall for a few frames where the building just fell
     away), and nothing marks a grid dirty for a full rebuild. `now` (the
     structure is going) takes everything. */
  const FLUSH_COLS = PHONE ? 48 : 128;
  function flushWorld(S, now) {
    if (S.deadCols.length || S.deadPlats.length || S.deadLos) {
      const cap = now ? Infinity : FLUSH_COLS;
      const cols = new Set(S.deadCols.length > cap ? S.deadCols.splice(0, cap) : S.deadCols.splice(0));
      const plats = new Set(S.deadPlats.length > cap ? S.deadPlats.splice(0, cap) : S.deadPlats.splice(0));
      const los = new Set(S.deadLos || []);
      S.deadLos = null;
      // the settled pieces lying on what just went are checked first
      if (cols.size && CBZ.debris && CBZ.debris.disturb) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        cols.forEach(function (c) { if (c.minX < x0) x0 = c.minX; if (c.maxX > x1) x1 = c.maxX; if (c.minZ < z0) z0 = c.minZ; if (c.maxZ > z1) z1 = c.maxZ; });
        if (isFinite(x0)) { try { CBZ.debris.disturb(x0, x1, z0, z1); } catch (e) {} }
      }
      try {
        if (CBZ.structuralTakeOut) CBZ.structuralTakeOut(cols, plats, los);
        else {
          if (cols.size) {
            if (CBZ.colliderRemoveMany) CBZ.colliderRemoveMany(cols);
            else if (CBZ.micro && CBZ.micro.removeCollider) cols.forEach(function (c) { CBZ.micro.removeCollider(c); });
            else if (CBZ.colliders) { const a = CBZ.colliders; let w = 0; for (let i = 0; i < a.length; i++) if (!cols.has(a[i])) a[w++] = a[i]; a.length = w; if (CBZ.markCollidersDirty) CBZ.markCollidersDirty(); }
          }
          if (plats.size) {
            if (CBZ.platformRemoveMany) CBZ.platformRemoveMany(plats);
            else if (CBZ.platforms) { const a = CBZ.platforms; let w = 0; for (let i = 0; i < a.length; i++) if (!plats.has(a[i])) a[w++] = a[i]; a.length = w; if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty(); }
          }
          if (los.size) {
            if (CBZ.losRemoveMany) CBZ.losRemoveMany(los);
            else if (CBZ.losBlockers) { const a = CBZ.losBlockers; let w = 0; for (let i = 0; i < a.length; i++) if (!los.has(a[i])) a[w++] = a[i]; a.length = w; }
          }
        }
      } catch (e) {}
    }
    if (S.newPlats.length && CBZ.platforms) {
      if (CBZ.platformAddMany) CBZ.platformAddMany(S.newPlats.splice(0));
      else { for (const p of S.newPlats) CBZ.platforms.push(p); S.newPlats.length = 0; if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty(); }
    }
    if (S.newCols.length) {
      for (const c of S.newCols) { try { if (CBZ.colliderAdd) CBZ.colliderAdd(c); else if (CBZ.colliders) CBZ.colliders.push(c); } catch (e) {} }
      S.newCols.length = 0;
    }
    flushMeshes(S);
  }
  function flushMeshes(S) {
    if (S.dirty.size) {
      S.dirty.forEach(function (mesh) { mesh.geometry.attributes.position.needsUpdate = true; });
      S.dirty.clear();
    }
  }

  /* ============================================================
     4. THE LOAD PATH.

     held   bottom-up: level 0 stands on the ground (unless undermined);
            a chunk above is DIRECT when anything under it is held; one
            that is not may HANG off a direct neighbour on its own level
            (one bay for brittle masonry, the whole floor for a frame).
     load   top-down: a chunk carries its weight plus everything resting
            on it, split over its supports by stiffness and integrity;
            a hanging chunk passes its load to the neighbour it hangs off,
            and TEARS free if that exceeds what the link can hang.
     fail   a chunk carrying more than its capacity x integrity x the
            building's margin crushes.
     tip    the weight above a storey standing outside the hull of what is
            left under it: everything above goes as one mass.
     ============================================================ */
  function loads(S, design) {
    const ns = S.ns, m = S.m;
    for (const c of S.chunks) { c.inc = 0; c.load = 0; c.hang = null; c.hd = 0; c.tear = false; c.held = false; c.direct = false; }
    S._ord = S._ord || [];
    for (let s = 0; s <= ns; s++) {
      const lv = S.levels[s], ord = [];
      for (const c of lv) {
        if (!c.standing) continue;
        if (s === 0) c.direct = !c.undermined;
        else if (c.anchor) {
          for (const b of c.below) if (b.standing) { c.direct = true; break; }
          if (!c.direct) for (const b of c.lat) if (b.standing) { c.direct = true; break; }
        } else for (const b of c.below) if (b.standing && b.held) { c.direct = true; break; }
        c.held = c.direct;
        if (c.direct) ord.push(c);
      }
      // what hangs: off the frame (rigid: the whole floor), a slab across
      // its span, a wall panel over a hole off the panel beside it
      const limW = S.rigid ? 99 : 1, limT = S.rigid ? 99 : S.frame ? 1 : 3;
      for (let q = 0; q < ord.length; q++) {
        const c = ord[q];
        for (const nb of c.lat) {
          if (nb.s !== s || !nb.standing || nb.held) continue;
          // the intact building is designed with everything it has hanging
          // where it hangs: a span is allowed as far as it was built
          if (!design && c.hd + 1 > Math.max(nb.kind === 1 ? limT : limW, nb.hd0 || 0)) continue;
          nb.held = true; nb.hang = c; nb.hd = c.hd + 1;
          if (design) nb.hd0 = nb.hd;
          ord.push(nb);
        }
      }
      S._ord[s] = ord;
    }
    for (let s = ns; s >= 0; s--) {
      const ord = S._ord[s];
      for (let i = ord.length - 1; i >= 0; i--) {
        const c = ord[i];
        const L = c.mass + c.inc + (!design && nowT - (c.extT || -9) < 0.3 ? c.ext : 0);
        c.load = L;
        if (c.hang) {
          const p = c.hang;
          if (design) c.hang0 = L;
          else {
            // what the link was built to hang (a floor spanning its bays), or
            // what the material can cantilever when it was never meant to
            const cap = ((c.hang0 || 0) * S.sf[s] + m.hang * (S.rigid ? 3 : 1) * Math.min(c.cap0, p.cap0)) * Math.min(c.hp, p.hp) * S.capMul;
            if (L > cap) { c.tear = true; continue; }
          }
          p.inc += L;
          continue;
        }
        if (s === 0) continue;
        let ws = 0;
        for (let k = 0; k < c.below.length; k++) { const b = c.below[k]; if (b.standing && b.held && !b.hang) ws += c.bw[k] * b.hp; }
        if (ws <= 0) for (let k = 0; k < c.below.length; k++) { const b = c.below[k]; if (b.standing && b.held) ws += c.bw[k] * b.hp; }
        if (ws <= 0) continue;
        for (let k = 0; k < c.below.length; k++) {
          const b = c.below[k];
          if (b.standing && b.held) b.inc += L * c.bw[k] * b.hp / ws;
        }
      }
    }
  }

  function solve(S) {
    loads(S, false);
    // crush: the overloaded fail, worst first; at most a few dozen a tick so
    // the failure SPREADS through the building instead of happening at once
    const fails = [];
    let creak = null, worst = 0;
    for (const c of S.chunks) {
      if (!c.standing || !c.held) continue;
      const r = c.load / Math.max(1e-6, c.cap0 * c.hp * S.capMul);
      c.ratio = r;
      if (r > 1) fails.push(c);
      else if (r > 0.85 && r > worst) { worst = r; creak = c; }
    }
    fails.sort(function (a, b) { return b.ratio - a.ratio; });
    const nf = Math.min(fails.length, PHONE ? 18 : 40);
    for (let i = 0; i < nf; i++) crush(S, fails[i]);
    if (creak && rnd() < 0.3) dustAt(S, creak, 0.5);
    // tip
    const tip = tipCheck(S);
    // what falls: everything not held, every tear, and the tipping block
    const D = [];
    for (const c of S.chunks) {
      if (!c.standing) continue;
      if (c.s > 0 && c.tris && S.levelLost[c.s]) {
        let braced = false;
        for (const nb of c.lat) if (nb.standing && nb.s === c.s) { braced = true; break; }
        if (!braced) c.tear = true;
      }
      if (!c.held || c.tear || (tip >= 0 && c.s >= tip)) D.push(c);
    }
    if (tip >= 0) S.stats.tipped++;
    if (D.length) detach(S, D, tip >= 0);
    return nf + D.length;
  }

  // 2-D convex hull (monotone chain), points [[x,z],...]
  function hull(pts) {
    pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    const cr = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); };
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop();
    return lo.concat(up);
  }
  // signed distance of p inside a CCW hull (min over edges; < 0 outside)
  function insideBy(H, x, z) {
    if (H.length < 3) return -1;
    let d = Infinity;
    for (let i = 0; i < H.length; i++) {
      const a = H[i], b = H[(i + 1) % H.length];
      const ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez) || 1;
      const s = (ex * (z - a[1]) - ez * (x - a[0])) / l;
      if (s < d) d = s;
    }
    return d;
  }
  function tipCheck(S) {
    const ns = S.ns;
    let any = false;
    for (let s = 0; s < ns; s++) if (S.levelLost[s]) { any = true; break; }
    if (!any) return -1;
    // the held mass above each level, and its centre
    const M = new Float64Array(ns + 2), X = new Float64Array(ns + 2), Z = new Float64Array(ns + 2);
    for (let s = ns; s >= 0; s--) {
      let m = 0, x = 0, z = 0;
      for (const c of S.levels[s]) if (c.standing && c.held && !c.tear) { m += c.mass; x += c.mass * c.cx; z += c.mass * c.cz; }
      M[s] = M[s + 1] + m; X[s] = X[s + 1] + x; Z[s] = Z[s + 1] + z;
    }
    const margin = Math.min(0.6, Math.min(S.w, S.d) * 0.04);
    for (let s = 1; s <= ns; s++) {
      if (!S.levelLost[s - 1]) continue;
      if (M[s] < S.totalMass * 0.04) break;
      const pts = [];
      for (const c of S.levels[s - 1]) if (c.standing && c.held && !c.hang && !c.tear) {
        pts.push([c.x0, c.z0], [c.x1, c.z0], [c.x1, c.z1], [c.x0, c.z1]);
      }
      if (pts.length < 3) continue;          // nothing under it at all: it is an orphan, not a tip
      const H = hull(pts);
      if (insideBy(H, X[s] / M[s], Z[s] / M[s]) < margin) return s;
    }
    return -1;
  }

  /* DETACH: the falling set, in connected clusters, each a rigid body of
     itself. */
  /* Only what decides the fall happens on the detaching frame: the
     clusters, the chunks leaving the load path, the bodies (numbers, no
     geometry). The boxes follow through the surgery queue; each body's
     picture is taken over part by part through the work queue, its bottom
     part first. */
  let markId = 1;
  function detach(S, list, tipped) {
    const id = ++markId;
    for (const c of list) c.mark = id;
    const comps = [];
    const st = [];
    for (const c of list) {
      if (c.mark !== id) continue;
      const comp = [];
      st.length = 0; st.push(c); c.mark = -id;
      while (st.length) {
        const a = st.pop(); comp.push(a);
        for (const n of a.below) if (n.mark === id) { n.mark = -id; st.push(n); }
        for (const n of a.above) if (n.mark === id) { n.mark = -id; st.push(n); }
        for (const n of a.lat) if (n.mark === id) { n.mark = -id; st.push(n); }
      }
      comps.push(comp);
    }
    comps.sort(function (a, b) { return b.length - a.length; });
    for (const c of list) { if (c.standing) markGone(S, c); S.surgQ.push(c); }
    for (const comp of comps) {
      S.stats.detached += comp.length;
      // a lone empty cell (air, a room with nothing in it) has nothing to show
      let real = 0;
      for (const c of comp) if (c.tris > 0) real++;
      if (!real) continue;
      if (awake() >= BODY_CAP && real <= 2) { for (const c of comp) if (c.tris) queueShatter(S, c, null, 0.6); continue; }
      const B = makeBody(S, comp, null);
      if (B && tipped) B.tip = true;
      // no room in the budget even after the calmest settled: it goes as
      // pieces of itself (never as nothing)
      if (!B) for (const c of comp) { if (c.tris) queueShatter(S, c, null, 0.6); else hideChunk(S, c); }
    }
    if (S.stats.firstFall < 0) S.stats.firstFall = nowT - S.stats.born;
  }

  /* ---- breaking a chunk where it stands ----------------------------------- */
  function crush(S, c) {
    if (!c.standing) return;
    S.stats.crushed++; stats.crushed++;
    leave(S, c, true);
    if (c.tris) queueShatter(S, c, { x: 0, y: -1, z: 0 }, 0.5); else hideChunk(S, c);
  }
  function blast(S, c, dir, power) {
    if (!c.standing) return;
    S.stats.blasted++; stats.blasted++;
    leave(S, c, true);
    if (c.tris) queueShatter(S, c, dir, power, true); else hideChunk(S, c);
  }
  function queueShatter(S, c, dir, power, first) {
    // cheap: the backlog is long (a whole storey crushed at once): the chunk
    // goes the way a crushed storey mostly does, as dust and grit
    const job = function (cheap) {
      if (S.disposed || c.hidden) return;
      hideChunk(S, c);
      if (cheap) { pulverise(S, c); return; }
      shatterStanding(S, c, dir, power);
    };
    // a blast's own chunks go at the head of the queue: they are what the
    // player is looking at the moment the charge goes off
    if (first) work.unshift(job); else work.push(job);
  }
  function pulverise(S, c) {
    const w = new THREE.Vector3(c.cx, c.cy, c.cz).applyMatrix4(S.L);
    try {
      if (CBZ.debris && CBZ.debris.chips) CBZ.debris.chips(w.x, w.y, w.z, { color: S.D.wall, count: 8, power: 1, dust: true });
      else dustAt(S, c, 0.8);
    } catch (e) {}
  }
  // the chunk's own geometry handed to CBZ.debris as pieces of itself
  function shatterStanding(S, c, dir, power) {
    const off = { x: 0, y: 0, z: 0 };
    const at = new THREE.Vector3(c.cx, c.cy, c.cz).applyMatrix4(S.L);
    shatterMeshes(S, geoOf(S, [c], off), S.L, at, dir, power, null, c.mass);
  }
  const _wm = HAS3 ? new THREE.Matrix4() : null;
  function shatterMeshes(S, meshes, M, at, dir, power, vel, mass, holder) {
    if (!meshes.length) return;
    const D = CBZ.debris;
    const st = D && D.stats ? D.stats() : null;
    const room = st ? st.caps.live - st.live : 0;
    if (D && CBZ.CONFIG.COLLAPSE_FRAGMENTS && room > 4) {
      const g = holder || new THREE.Group();
      g.matrixAutoUpdate = false; g.matrix.copy(M);
      if (!holder) for (const ms of meshes) g.add(ms);
      g.updateMatrixWorld(true);
      // (pieces cost the cut linearly: a bay-sized chunk reads as broken in ten)
      const n = Math.max(3, Math.min(Math.min(room - 2, PHONE ? 6 : 10), Math.round(2 + (mass || 2) * 1.1 * S.m.frag)));
      let r = null;
      try {
        r = D.shatter(g, {
          at: at, dir: dir || null, power: Math.max(0.4, Math.min(2.2, power || 0.6)),
          speed: 2.2 * S.m.spread, velocity: vel || null, maxPieces: n, owner: S.key, solid: true,
          // a storey breaking up is thrown out and down, never up into the sky
          maxUp: PIECE_UP, maxSpin: PIECE_SPIN,
          // a cut chunk is a piece of a building, not a pole: no stump of a
          // mullion or a post is left standing where the storey was
          snap: false,
          size: Math.min(2.2, Math.max(0.45, 0.8 * S.m.fragSize)), dust: 0.9 * S.m.dust,
        });
      } catch (e) { r = null; }
      if (r) { S.stats.pieces += r.pieces; stats.pieces += r.pieces; }
      stats.shattered++;
    } else if (D && D.chips) {
      // over the budget: the chunk is pulverised (the dust it would have made, and grit)
      try { D.chips(at.x, at.y, at.z, { color: S.D.wall, count: 10, power: 1.2, dust: true }); } catch (e) {}
    }
    for (const ms of meshes) ms.geometry.dispose();
  }
  function dustAt(S, c, power) {
    const w = new THREE.Vector3(c.cx, c.cy, c.cz).applyMatrix4(S.L);
    try {
      if (CBZ.cityDustKick) CBZ.cityDustKick(w.x, w.y, w.z, power * S.m.dust, dustCol(S));
      else if (CBZ.debris && CBZ.debris.dust) CBZ.debris.dust(w.x, w.y, w.z, { color: dustCol(S), power: power, radius: 1.5 });
    } catch (e) {}
  }
  function dustCol(S) { return mix(S.D.wall, 0xb3ada2, 0.5); }

  /* ============================================================
     5. THE FALL — rigid bodies made of chunks.

     A body is a set of chunks drawn as one merged mesh per material per
     level group (so a pancake can shed its bottom storey without rebuilding
     the rest). Its frame is the building's own axes about its centre of
     mass, so a body split off another body, or off the standing building,
     is just a different subset of the same building-local geometry.

     Contacts are at the body's hull points against: the ground (and any
     undermined hole in it), the standing chunks of every cut building
     (the stump a block tips over, the storey a pancake crushes), the
     world's colliders (other buildings, settled rubble), and crushed cars.
     ============================================================ */
  let nowT = 0;
  function awake() { return bodies.length; }

  /* THE WORK QUEUE. What costs real milliseconds -- copying a falling block's
     geometry out of the standing meshes, cutting a chunk into Voronoi pieces
     -- is queued and run inside a per-frame budget, so a storey failing all at
     once is spread over a few frames instead of landing on one. The physics
     never waits: a body falls from the frame it detached; its picture is
     taken over from the standing building part by part, and a chunk keeps
     being drawn where it stood until its pieces exist. */
  /* Two queues. FIRST: what is on screen in the wrong place until it runs (a
     falling block's parts still drawn where they stood, a broken body frozen
     in the air, a shed storey). It always goes before the pieces. THEN: the
     pieces. A backlog of pieces longer than the device can cut (a whole
     tower's storeys crushed in one tick) is worked off the front as dust and
     grit, so no chunk waits seconds to break. */
  const workHi = [], work = [], workIdle = [];   // (idle: tidying, when nothing else waits)
  const WORK_MS = PHONE ? 3 : TABLET ? 4 : 6;
  const BACKLOG = PHONE ? 16 : TABLET ? 28 : 48;
  function runWork(budget) {
    const t0 = performance.now();
    let n = 0;
    while (workHi.length && (n === 0 || performance.now() - t0 < budget)) {
      const f = workHi.shift();
      try { f(); } catch (e) { console.warn("[collapse] work", e); }
      n++;
    }
    while (work.length && (n === 0 || performance.now() - t0 < budget)) {
      const f = work.shift();
      try { f(false); } catch (e) { console.warn("[collapse] work", e); }
      n++;
    }
    while (work.length > BACKLOG) {
      const f = work.shift();
      try { f(true); } catch (e) {}
    }
    while (!work.length && !workHi.length && workIdle.length && performance.now() - t0 < budget) {
      const f = workIdle.shift();
      try { f(); } catch (e) {}
    }
  }
  // a part's picture: its chunks' own geometry about its body's centre
  function buildPart(p) {
    if (p.meshes) return;
    const B = p.body, S = p.S;
    // (a body that has died since -- settled, broken up, gone as pieces --
    // still wants its picture: the kept rubble, the ghost and the pieces are
    // made of it. Only a structure that is gone has nothing to copy from.)
    if (!B || S.disposed) { for (const c of p.chunks) hideChunk(S, c); p.meshes = []; return; }
    p.meshes = geoOf(S, p.chunks.filter(function (c) { return c.tris; }), B.com);
    for (const ms of p.meshes) { ms.castShadow = !PHONE; ms.receiveShadow = true; glassDraw(ms); B.g.add(ms); }
    for (const c of p.chunks) hideChunk(S, c);
    if (p.ghost && --p.ghost.n <= 0) dropGhost(p.ghost);
  }
  function dropGhost(gh) {
    if (gh.done) return;
    gh.done = true;
    if (gh.g.parent) gh.g.parent.remove(gh.g);
    gh.g.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  }
  function partsOf(S, list) {
    const lv = Array.from(new Set(list.map(function (c) { return c.s; }))).sort(function (a, b) { return a - b; });
    const per = Math.max(1, Math.ceil(lv.length / MAX_PARTS));
    const parts = [];
    for (let i = 0; i < lv.length; i += per) {
      const set = new Set(lv.slice(i, i + per));
      const pc = list.filter(function (c) { return set.has(c.s); });
      parts.push({ S: S, chunks: pc, meshes: null, body: null, ghost: null, s0: lv[i], mass: pc.reduce(function (a, c) { return a + c.mass; }, 0) });
    }
    return parts;
  }

  function makeBody(S, list, parent, handed, ghost) {
    let M = 0, cx = 0, cy = 0, cz = 0;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const c of list) {
      const g = c.gb;
      M += c.mass; cx += c.mass * (g[0] + g[1]) / 2; cy += c.mass * (g[2] + g[3]) / 2; cz += c.mass * (g[4] + g[5]) / 2;
      if (!c.tris) continue;
      if (g[0] < x0) x0 = g[0]; if (g[1] > x1) x1 = g[1];
      if (g[2] < y0) y0 = g[2]; if (g[3] > y1) y1 = g[3];
      if (g[4] < z0) z0 = g[4]; if (g[5] > z1) z1 = g[5];
    }
    if (!(M > 0) || !isFinite(x0)) return null;
    // THE HARD CAP: a slot is made (the calmest body lying on something
    // settles, else the smallest still moving goes as pieces) or there is no body
    if (!freeSlot(!!handed || list.length > 8)) return null;
    const com = new THREE.Vector3(cx / M, cy / M, cz / M);
    // parts: level groups, bottom first. Handed-over parts (a segment split
    // off a falling tower) keep their meshes: re-based on the new centre,
    // nothing is copied.
    const parts = handed || partsOf(S, list);
    const g = new THREE.Group();
    g.name = "collapseBody";
    g.userData.cbzCollapseShell = S.key;
    const B = {
      S: S, g: g, parts: parts, chunks: list, com: com, mass: M, invM: 1 / M,
      lo: new THREE.Vector3(x0, y0, z0).sub(com), hi: new THREE.Vector3(x1, y1, z1).sub(com),
      pos: new THREE.Vector3(), q: new THREE.Quaternion(), v: new THREE.Vector3(), w: new THREE.Vector3(),
      iI: [0, 0, 0], pts: null, t: 0, calm: 0, contact: false, lastShed: -1, lastHit: -1, lastCrush: -1, lastCar: -1,
      hard: 0, tip: false, cols: null, colsT: -1, floorY: 0, floorT: -1, tilt: 0, born: nowT, ownC: [],
    };
    shapeBody(B);
    if (parent) {
      const r = new THREE.Vector3().copy(com).sub(parent.com).applyQuaternion(parent.q);
      B.pos.copy(parent.pos).add(r);
      B.q.copy(parent.q);
      B.v.copy(parent.v).add(new THREE.Vector3().crossVectors(parent.w, r));
      B.w.copy(parent.w);
      tame(B);
    } else {
      B.pos.copy(com).applyMatrix4(S.L);
      B.q.copy(S.q);
    }
    for (const c of list) c.body = B;
    for (const p of parts) {
      const was = p.body;
      p.body = B;
      if (p.meshes) {
        const off = was ? new THREE.Vector3().copy(was.com).sub(com) : null;
        for (const ms of p.meshes) { if (off) ms.position.add(off); g.add(ms); }
      } else {
        if (ghost) { p.ghost = ghost; ghost.n++; }
        // the bottom part (the one that lands) goes to the head of the queue:
        // it is copied this same frame, inside the budget, never all at once
        if (!was) { if (p === parts[0]) workHi.unshift(buildPart.bind(null, p)); else workHi.push(buildPart.bind(null, p)); }
      }
    }
    g.position.copy(B.pos); g.quaternion.copy(B.q);
    (S.D.root || CBZ.scene).add(g);
    bodies.push(B);
    S.stats.bodies++; stats.bodiesMade++;
    if (bodies.length > stats.maxAwake) stats.maxAwake = bodies.length;
    return B;
  }
  // inertia + hull points from the body's box (about its COM)
  function shapeBody(B) {
    const lo = B.lo, hi = B.hi;
    const ex = Math.max(0.2, hi.x - lo.x), ey = Math.max(0.2, hi.y - lo.y), ez = Math.max(0.2, hi.z - lo.z);
    const M = B.mass;
    // the most it may climb and spin: a block toppling about its foot never
    // turns faster than a rod of its length falling flat from upright
    // (sqrt(3g/L)), a loose panel may tumble a little more
    const L = Math.max(ex, ey, ez), wTop = Math.sqrt(3 * G / L);
    const multi = B.parts && B.parts.length > 1;
    B.maxW = multi ? 1.3 * wTop : Math.min(W_MAX, Math.max(1.5, 2 * wTop));
    B.maxUp = multi ? 0.6 : 1.5;
    B.iI = [12 / (M * (ey * ey + ez * ez)), 12 / (M * (ex * ex + ez * ez)), 12 / (M * (ex * ex + ey * ey))];
    B.radius = 0.5 * Math.hypot(ex, ey, ez);
    const P = [];
    const xs = [lo.x, (lo.x + hi.x) / 2, hi.x], ys = [lo.y, (lo.y + hi.y) / 2, hi.y], zs = [lo.z, (lo.z + hi.z) / 2, hi.z];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let c = 0; c < 3; c++) {
      if (a === 1 && b === 1 && c === 1) continue;
      P.push(xs[a], ys[b], zs[c]);
    }
    B.pts = new Float32Array(P);
  }

  // ---- what holds a point up (world) -----------------------------------------
  const _sup = { h: 0, src: 0, ch: null, lat: false, lch: null, nx: 0, nz: 0, depth: 0 };
  function groundAt(B, x, z) {
    let y = B.floorY;
    for (const H of holes) {
      const dx = x - H.x, dz = z - H.z;
      if (H.r != null ? dx * dx + dz * dz < H.r * H.r : (x > H.minX && x < H.maxX && z > H.minZ && z < H.maxZ)) y = Math.min(y, H.y - H.depth);
    }
    return y;
  }
  // the standing chunk column under a building-local point: the highest top
  // at or below ymax (local)
  function columnTop(S, lx, lz, ymax) {
    const hw = S.hw, hd = S.hd;
    if (lx < -hw - 0.3 || lx > hw + 0.3 || lz < -hd - 0.3 || lz > hd + 0.3) return null;
    const d0 = lz + hd, d1 = hd - lz, d2 = lx + hw, d3 = hw - lx;
    let f = 0, m = d0;
    if (d1 < m) { m = d1; f = 1; } if (d2 < m) { m = d2; f = 2; } if (d3 < m) { m = d3; f = 3; }
    const ix = idxIn(S.xs, lx), iz = idxIn(S.zs, lz);
    let best = null, bt = -Infinity;
    const s0 = Math.min(S.ns, levelOf(S, ymax));
    for (let pass = 0; pass < 2; pass++) {
      if (pass === 0 && m >= BAND) continue;
      for (let s = s0; s >= 0; s--) {
        const c = pass === 0 ? wallAt(S, f, f < 2 ? ix : iz, s) : tileAt(S, ix, iz, s);
        if (!c.standing) continue;
        if (c.top <= ymax) { if (c.top > bt) { bt = c.top; best = c; } break; }
      }
    }
    if (!best) return null;
    _col.top = bt; _col.c = best;
    return _col;
  }
  const _col = { top: 0, c: null };
  function support(B, x, y, z) {
    _sup.h = groundAt(B, x, z); _sup.src = 0; _sup.ch = null; _sup.lat = false;
    for (const T of structs) {
      if (!T.swapped || T.standingCount <= 0) continue;
      const dx = x - T.ox, dz = z - T.oz;
      if (Math.abs(dx) > T.hw + T.hd + 1 && Math.abs(dz) > T.hw + T.hd + 1) continue;
      const lx = dx * T.cos - dz * T.sin, lz = dx * T.sin + dz * T.cos;   // world -> building-local (R_y(-yaw))
      const r = columnTop(T, lx, lz, y - T.gy + TOL);
      if (r && r.top + T.gy > _sup.h) { _sup.h = r.top + T.gy; _sup.src = 1; _sup.ch = r.c; }
    }
    const near = B.near;
    if (near) for (let i = 0; i < near.length; i++) {
      const O = near[i];
      if (O.dead || O.upY < 0.55) continue;
      /* A BODY RESTS ONLY ON A BODY UNDER IT. Two thin slabs that overlapped
         each read the other as the floor: each step one was lifted onto the
         other's top, then the other onto its top, and the pair climbed a
         ladder of their own making at ~17 m/s to 700 m (the pieces of
         buildings flying way up into the sky). What holds a body up is lower
         than it is. */
      if (O.pos.y >= B.pos.y) continue;
      const dx = x - O.pos.x, dy = y - O.pos.y, dz = z - O.pos.z;
      const R = O.R;
      // into the other body's frame (R is row-major, its transpose is the inverse)
      const lx = R[0] * dx + R[3] * dy + R[6] * dz, ly = R[1] * dx + R[4] * dy + R[7] * dz, lz = R[2] * dx + R[5] * dy + R[8] * dz;
      if (lx < O.lo.x || lx > O.hi.x || lz < O.lo.z || lz > O.hi.z || ly < O.lo.y || ly > O.hi.y + TOL) continue;
      const top = y + (O.hi.y - ly) / O.upY;
      if (top <= y + TOL && top > _sup.h) { _sup.h = top; _sup.src = 4; _sup.ch = null; }
    }
    const cols = B.cols;
    if (cols) for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      const top = c.y1 != null ? c.y1 : Infinity, bot = c.y0 != null ? c.y0 : -Infinity;
      if (top <= y + TOL) { if (top > _sup.h) { _sup.h = top; _sup.src = 2; _sup.ch = c; } }
      else if (y > bot && !_sup.lat) {
        // inside a solid from the side: out through the nearest face
        const a = x - c.minX, b = c.maxX - x, e = z - c.minZ, f = c.maxZ - z;
        const mn = Math.min(a, b, e, f);
        _sup.lat = true; _sup.depth = mn; _sup.lch = c;
        _sup.nx = mn === a ? -1 : mn === b ? 1 : 0; _sup.nz = mn === e ? -1 : mn === f ? 1 : 0;
      }
    }
    for (const car of crushedCars) {
      const p = car.pos; if (!p) continue;
      const hl = ((car.dims && car.dims.length) || 4.6) / 2 + 0.3;
      if (Math.abs(x - p.x) > hl || Math.abs(z - p.z) > hl) continue;
      const top = p.y + 0.55;
      if (top <= y + TOL && top > _sup.h) { _sup.h = top; _sup.src = 3; }
    }
    return _sup;
  }

  // ---- one body, one substep ---------------------------------------------------
  const _q = HAS3 ? new THREE.Quaternion() : null, _ax = HAS3 ? new THREE.Vector3() : null;
  const _R = new Float64Array(9), _Iw = new Float64Array(9);
  const CP = new Float64Array(16 * 4), CS = new Int8Array(16);
  /* a side contact's normal code (nx * 10 + nz); 0 for the rest. It used to
     hold the CHUNK of every other contact too, which nothing read: the last
     body's last contacts kept their chunk -> its structure -> the building's
     whole cut (bands, chunk triangles, read-back copies) alive after
     dispose() and after the match reset, ~35 MB on the island
     (tools/probes/disaster-leak.mjs). Numbers only now. */
  const CC = new Int16Array(16);
  function stepBody(B, h) {
    const p = B.pos, v = B.v, w = B.w, q = B.q, S = B.S;
    B.t += h;
    v.y -= G * h;
    // air drag on the big flat things is not nothing, but small: keep the fall honest
    p.x += v.x * h; p.y += v.y * h; p.z += v.z * h;
    const wl = w.length();
    if (wl > 1e-6) { _q.setFromAxisAngle(_ax.copy(w).divideScalar(wl), wl * h); q.premultiply(_q); q.normalize(); }
    // rotation matrix (row-major) + world inverse inertia
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const R = _R;
    R[0] = 1 - 2 * (qy * qy + qz * qz); R[1] = 2 * (qx * qy - qz * qw); R[2] = 2 * (qx * qz + qy * qw);
    R[3] = 2 * (qx * qy + qz * qw); R[4] = 1 - 2 * (qx * qx + qz * qz); R[5] = 2 * (qy * qz - qx * qw);
    R[6] = 2 * (qx * qz - qy * qw); R[7] = 2 * (qy * qz + qx * qw); R[8] = 1 - 2 * (qx * qx + qy * qy);
    const iI = B.iI, Iw = _Iw;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      Iw[i * 3 + j] = R[i * 3] * iI[0] * R[j * 3] + R[i * 3 + 1] * iI[1] * R[j * 3 + 1] + R[i * 3 + 2] * iI[2] * R[j * 3 + 2];
    }
    B.tilt = Math.acos(Math.max(-1, Math.min(1, R[4])));
    if (B.tilt > S.stats.maxTilt && B.parts.length > 1) S.stats.maxTilt = B.tilt;
    // the world near it (colliders), refreshed at 10 Hz
    if (nowT - B.colsT > 0.1) {
      B.colsT = nowT;
      B.cols = [];
      if (CBZ.queryCollidersNear) {
        try {
          const L = CBZ.queryCollidersNear(p.x, p.z, B.radius + 1.5, []);
          for (const c of L) if (!c._cbzS && !c.carCollider) B.cols.push(c);
        } catch (e) {}
      }
      let f = 0;
      try { f = S.D.groundAt ? S.D.groundAt(p.x, p.z) : CBZ.groundAt ? CBZ.groundAt(p.x, p.z) : (CBZ.floorAt ? CBZ.floorAt(p.x, p.z, -50) : 0); } catch (e) { f = 0; }
      B.floorY = isFinite(f) ? f : 0;
    }
    // contacts
    const pts = B.pts;
    let nC = 0, maxD = 0, latX = 0, latZ = 0, latD = 0, hardest = 0, ownHard = 0;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, minZ = Infinity, maxZ = -Infinity;
    const crushSet = [];
    B.ownC.length = 0; B.onBody = false;
    for (let i = 0; i < pts.length; i += 3) {
      const lx = pts[i], ly = pts[i + 1], lz = pts[i + 2];
      const rx = R[0] * lx + R[1] * ly + R[2] * lz, ry = R[3] * lx + R[4] * ly + R[5] * lz, rz = R[6] * lx + R[7] * ly + R[8] * lz;
      const wx = p.x + rx, wy = p.y + ry, wz = p.z + rz;
      if (wx < minX) minX = wx; if (wx > maxX) maxX = wx; if (wy < minY) minY = wy; if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      const sp = support(B, wx, wy, wz);
      if (sp.lat && sp.depth > 0.02) {
        if (sp.depth > latD) { latD = sp.depth; latX = sp.nx; latZ = sp.nz; }
        const vx = v.x + (w.y * rz - w.z * ry), vz = v.z + (w.x * ry - w.y * rx);
        const vn = vx * sp.nx + vz * sp.nz;
        if (vn < 0 && nC < 16) { CP[nC * 4] = rx; CP[nC * 4 + 1] = ry; CP[nC * 4 + 2] = rz; CP[nC * 4 + 3] = 0; CS[nC] = 2; CC[nC] = sp.nx * 10 + sp.nz; nC++; if (-vn > hardest) hardest = -vn; neighbourHit(B, sp.lch, wx, wy, wz, -vn); }
      }
      const d = sp.h - wy;
      if (d > -0.02 && nC < 16) {
        const vy = v.y + (w.z * rx - w.x * rz);
        CP[nC * 4] = rx; CP[nC * 4 + 1] = ry; CP[nC * 4 + 2] = rz; CP[nC * 4 + 3] = d;
        CS[nC] = sp.src === 1 ? 1 : 0; CC[nC] = 0;
        if (sp.src === 4) B.onBody = true;
        if (sp.src === 1 && sp.ch) {
          if (-vy > 1.6) crushSet.push(sp.ch);
          if (B.ownC.indexOf(sp.ch) < 0) B.ownC.push(sp.ch);
        }
        if (-vy > (sp.src === 1 ? ownHard : hardest)) { if (sp.src === 1) ownHard = -vy; else hardest = -vy; }
        if (d > maxD) maxD = d;
        nC++;
      }
    }
    B.aabb = [minX, maxX, minY, minZ, maxZ];
    // THE PANCAKE: landing on a standing storey at speed crushes it, and the
    // mass keeps what the crush did not take
    let skipOwn = false, skipAll = false;
    if (crushSet.length && nowT - B.lastCrush > 0.04) {
      B.lastCrush = nowT;
      skipOwn = crushStorey(B, crushSet, ownHard);
    }
    /* THE PANCAKE ON THE GROUND. An upright block of several storeys that
       lands hard on the ground (or on rubble, or on another block) does not
       bounce and stand there: its bottom storeys are what takes the blow.
       They are consumed (shed as pieces of themselves) and the block keeps
       the speed the crush did not absorb, so it goes on crushing down to the
       ground storey by storey. */
    if (!skipOwn && hardest > B.S.m.breakV && B.parts.length > 1 && B.tilt < 0.45 && nowT - B.lastShed > 0.06 && !B.shed) {
      const p0 = B.parts[0];
      let need = 0;
      for (const c of p0.chunks) need += c.tough;
      const absorbed = need * 1000;
      B.v.y = -Math.sqrt(Math.max(0, B.v.y * B.v.y - 2 * absorbed / Math.max(1e-3, B.mass)));
      B.shed = true; B.pancaking = true; skipAll = true;
      hardest = 0;
    }
    B.contact = nC > 0;
    if (nC && !skipAll) {
      for (let it = 0; it < 5; it++) {
        for (let k = 0; k < nC; k++) {
          if (skipOwn && CS[k] === 1) continue;
          const rx = CP[k * 4], ry = CP[k * 4 + 1], rz = CP[k * 4 + 2];
          let nx = 0, ny = 1, nz = 0;
          if (CS[k] === 2) { const code = CC[k]; nx = Math.round(code / 10); nz = code - nx * 10; ny = 0; }
          const vrx = v.x + (w.y * rz - w.z * ry), vry = v.y + (w.z * rx - w.x * rz), vrz = v.z + (w.x * ry - w.y * rx);
          const vn = vrx * nx + vry * ny + vrz * nz;
          if (vn >= 0) continue;
          const e = it === 0 && -vn > 2 ? 0.08 : 0;
          const jn = -(1 + e) * vn / kEff(B, rx, ry, rz, nx, ny, nz);
          applyImp(B, rx, ry, rz, nx * jn, ny * jn, nz * jn);
          // friction
          const ux = v.x + (w.y * rz - w.z * ry), uy = v.y + (w.z * rx - w.x * rz), uz = v.z + (w.x * ry - w.y * rx);
          const un = ux * nx + uy * ny + uz * nz;
          let tx = ux - un * nx, ty = uy - un * ny, tz = uz - un * nz;
          const vt = Math.hypot(tx, ty, tz);
          if (vt > 1e-5) {
            tx /= vt; ty /= vt; tz /= vt;
            const jt = Math.min(vt / kEff(B, rx, ry, rz, tx, ty, tz), 0.75 * jn);
            applyImp(B, rx, ry, rz, -tx * jt, -ty * jt, -tz * jt);
          }
        }
      }
      if (maxD > 0.003 && !skipOwn) p.y += Math.min(maxD, 0.5) * 0.85;
      if (latD > 0.02) { p.x += latX * Math.min(latD, 0.5) * 0.8; p.z += latZ * Math.min(latD, 0.5) * 0.8; }
      // rolling resistance: a slab lying on its face stops rocking
      if (nC >= 3) { const f = Math.max(0, 1 - 3 * h); w.multiplyScalar(f); }
    }
    /* NOTHING IS LAUNCHED. A long block landing on one end takes the whole
       landing through one corner; the impulse loop answers with a spin and a
       climb a building does not have (the far end of a 60 m tower thrown up
       at 30 m/s). A falling building's mass comes down: whatever the contact
       solve made, the climb and the tumble stay within what a mass that size
       can do. */
    if (v.y > B.maxUp) v.y = B.maxUp;
    { const wl2 = w.length(); if (wl2 > B.maxW) w.multiplyScalar(B.maxW / wl2); }
    if (hardest > B.hard) B.hard = hardest;
    // rest
    const still = B.contact && v.lengthSq() < 0.12 && w.lengthSq() < 0.1;
    B.calm = still ? B.calm + h : 0;
  }
  function kEff(B, rx, ry, rz, nx, ny, nz) {
    // invM + n . ((Iw (r x n)) x r)
    const cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx;
    const I = _Iw;
    const ax = I[0] * cx + I[1] * cy + I[2] * cz, ay = I[3] * cx + I[4] * cy + I[5] * cz, az = I[6] * cx + I[7] * cy + I[8] * cz;
    const bx = ay * rz - az * ry, by = az * rx - ax * rz, bz = ax * ry - ay * rx;
    return B.invM + nx * bx + ny * by + nz * bz;
  }
  function applyImp(B, rx, ry, rz, jx, jy, jz) {
    B.v.x += jx * B.invM; B.v.y += jy * B.invM; B.v.z += jz * B.invM;
    const cx = ry * jz - rz * jy, cy = rz * jx - rx * jz, cz = rx * jy - ry * jx;
    const I = _Iw;
    B.w.x += I[0] * cx + I[1] * cy + I[2] * cz;
    B.w.y += I[3] * cx + I[4] * cy + I[5] * cz;
    B.w.z += I[6] * cx + I[7] * cy + I[8] * cz;
  }

  /* THE PANCAKE STEP. The block arrives on the standing storey under it at
     speed vn; the energy it brings (1/2 M vn^2) is spent on the chunks of
     that storey under its footprint. Every one it breaks is gone and the
     block keeps falling with what is left; if any hold, it lands on them. */
  function crushStorey(B, hitList, vn) {
    const T = hitList[0].S || B.S;
    const s = hitList[0].s;
    const E = 0.5 * B.mass * vn * vn / 1000;                 // MJ (t, m/s)
    // the storey under the body's footprint
    const a = B.aabb, cand = [];
    const lo = new THREE.Vector3(a[0], 0, a[3]).applyMatrix4(T.Linv), hi = new THREE.Vector3(a[1], 0, a[4]).applyMatrix4(T.Linv);
    const x0 = Math.min(lo.x, hi.x), x1 = Math.max(lo.x, hi.x), z0 = Math.min(lo.z, hi.z), z1 = Math.max(lo.z, hi.z);
    for (const c of T.levels[s]) {
      if (!c.standing || c.x1 < x0 || c.x0 > x1 || c.z1 < z0 || c.z0 > z1) continue;
      cand.push(c);
    }
    if (!cand.length) return false;
    let need = 0;
    for (const c of cand) need += c.tough * c.hp;
    // the block's own bottom breaks too, on a hard enough landing
    if (vn > T.m.breakV && B.parts.length > 1 && nowT - B.lastShed > 0.12) B.shed = true;
    if (E >= need * 0.7) {
      for (const c of cand) crush(T, c);
      T.stats.pancaked++;
      const absorbed = Math.min(E * 0.9, need) * 1000;
      const v2 = Math.max(0, B.v.y * B.v.y - 2 * absorbed / B.mass);
      B.v.y = -Math.sqrt(v2);
      pall(T, B.pos.x, B.pos.y + B.lo.y, B.pos.z, Math.min(2.5, 0.6 + E * 0.02), (x1 - x0 + z1 - z0) * 0.25);
      return true;
    }
    for (const c of cand) {
      c.hp -= E / (cand.length * c.tough);
      if (c.hp <= 0.05) crush(T, c);
    }
    T.active = Math.max(T.active, 2);
    return false;
  }

  // a toppling body ploughing into another building: it takes the hit too
  function neighbourHit(B, col, x, y, z, vn) {
    if (!col || vn < 2.5 || nowT - B.lastHit < 0.25) return;
    const ref = col.ref, bld = ref && ref.parent && ref.parent.userData && ref.parent.userData.bld;
    if (!bld || !bld.group) return;
    B.lastHit = nowT;
    const E = Math.min(80, 0.5 * B.mass * vn * vn / 1000 * 0.4);
    if (E < 0.8) return;
    try { C.damage(bld, { x: x, y: y, z: z }, 3.2, E, { x: B.v.x, y: 0, z: B.v.z }); } catch (e) {}
  }

  const crushedCars = [];
  function crushCars(B) {
    const cars = CBZ.cityCars;
    if (!cars || !cars.length || !B.aabb || nowT - B.lastCar < 0.05) return;
    B.lastCar = nowT;
    const a = B.aabb;
    if (B.v.y > -1.0 && B.v.lengthSq() < 4) return;
    for (const car of cars) {
      if (!car || car._cbzCrushed || !car.pos) continue;
      const p = car.pos, r = ((car.dims && car.dims.width) || 2) * 0.5;
      if (p.x < a[0] - r || p.x > a[1] + r || p.z < a[3] - r || p.z > a[4] + r) continue;
      const top = p.y + ((car.dims && car.dims.height) || 1.5);
      if (a[2] > top + 0.2) continue;
      car._cbzCrushed = true;
      crushedCars.push(car);
      B.S.stats.carsCrushed++; stats.carsCrushed++;
      try { if (CBZ.cityCarImpact) CBZ.cityCarImpact(car, { x: p.x, y: top, z: p.z }, { x: 0, y: -1, z: 0 }, 40, { r: 1.8 }); } catch (e) {}
      try { if (CBZ.cityDamageCar) CBZ.cityDamageCar(car, 1000, { blast: true, cause: "crushed by a falling building" }); } catch (e) {}
      car.v = 0; car.vx = 0; car.vz = 0;
      if (car.group) car.group.scale.y = Math.min(car.group.scale.y, 0.55);
    }
  }
  function crushPeople(B, x, z, r) {
    const cause = "crushed by the falling building";
    try {
      if (CBZ.crowds && CBZ.crowds.crush) CBZ.crowds.crush(x, z, r, { cause: cause });
      for (const pd of (CBZ.cityPeds || [])) {
        if (!pd || pd.dead || !pd.pos) continue;
        if (Math.hypot(pd.pos.x - x, pd.pos.z - z) > r) continue;
        if (CBZ.cityKillPed) CBZ.cityKillPed(pd, { fromX: x, fromZ: z, force: 8, fling: 4 }, cause);
      }
      const PL = CBZ.player;
      if (PL && !PL.dead && PL.pos && CBZ.cityHurtPlayer && Math.hypot(PL.pos.x - x, PL.pos.z - z) < r && PL.pos.y < B.pos.y + B.hi.y) {
        CBZ.cityHurtPlayer(9999, x, z, cause, false, null, false);
      }
    } catch (e) {}
  }

  // THE PALL: a ring of the building's own dust rolling out along the ground
  function pall(S, x, y, z, power, R) {
    const dc = dustCol(S);
    const n = Math.max(3, Math.round(qs(3, 8) * S.m.dust * Math.min(1.5, power)));
    try {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.2832 + rnd() * 0.5, r = (0.5 + rnd() * 0.6) * Math.max(1, R);
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (CBZ.cityDustKick) CBZ.cityDustKick(px, y + 0.4, pz, 2.0 * power * S.m.dust, dc, { dirx: Math.cos(a), dirz: Math.sin(a), speed: 2 + power * 2 });
        else if (CBZ.debris && CBZ.debris.dust) CBZ.debris.dust(px, y + 0.4, pz, { color: dc, power: power, radius: 1.6 + R * 0.15 });
      }
    } catch (e) {}
  }

  /* ---- what happens to a body after a step ---------------------------------- */
  function removeBody(B, keepMeshes) {
    const i = bodies.indexOf(B);
    if (i >= 0) bodies.splice(i, 1);
    if (B.g.parent) B.g.parent.remove(B.g);
    if (!keepMeshes) B.g.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    B.dead = true;
    for (const p of B.parts) if (!p.meshes && p.body === B) {
      for (const c of p.chunks) hideChunk(B.S, c);
      p.meshes = [];
      if (p.ghost && --p.ghost.n <= 0) dropGhost(p.ghost);
    }
  }
  function buildAll(B) { for (const p of B.parts) if (!p.meshes) buildPart(p); }

  /* ---- THE BUDGET, HARD ------------------------------------------------------
     There are never more than BODY_CAP structural bodies awake. A body that
     would be one too many first makes its own room: the CALMEST body that is
     lying on something (not on another moving body) settles where it lies;
     failing that, the smallest body still moving goes as pieces of itself. */
  /* Making room costs a settle test (or a break-up) per body, so a storey
     coming apart into forty clusters on one frame may make room only a few
     times that frame: the rest of the small clusters go as pieces of
     themselves (queued). A big block (a tower's top) always gets its slot. */
  const FREE_PER_FRAME = PHONE ? 2 : 4;
  let freeBudget = FREE_PER_FRAME;
  function freeSlot(force) {
    if (bodies.length < BODY_CAP) return true;
    if (freeBudget <= 0 && !force) return false;
    freeBudget--;
    return freeOne() && bodies.length < BODY_CAP;
  }
  function freeOne() {
    let best = null, be = Infinity;
    for (const b of bodies) {
      if (!b.contact || b.onBody || b.parts.length > 1 || b.t < 0.15) continue;
      const e = b.v.lengthSq() + b.w.lengthSq() * Math.max(1, b.radius * b.radius);
      if (e < be) { be = e; best = b; }
    }
    if (best) { bake(best); stats.capSettled++; return true; }
    let sm = null;
    for (const b of bodies) if (b.parts.length < 2 && (!sm || b.mass < sm.mass)) sm = b;
    if (sm) { shatterBody(sm); stats.capShattered++; return true; }
    return false;
  }
  // a body handed over as pieces of itself (its picture first, then the cut)
  function shatterBody(B) {
    const i = bodies.indexOf(B);
    if (i >= 0) bodies.splice(i, 1);
    B.dead = true;
    const S = B.S;
    B.g.position.copy(B.pos); B.g.quaternion.copy(B.q);
    const at = B.pos.clone(), vel = B.v.clone().multiplyScalar(0.4), mass = B.mass;
    if (vel.y > 0) vel.y = 0;
    const real = B.chunks.filter(function (c) { return c.tris > 0; });
    if (real.length < 2 || S.disposed) {
      workHi.push(function () {
        footprint(S, B);
        buildAll(B);
        if (B.g.parent) B.g.parent.remove(B.g);
        B.g.updateMatrix();
        shatterMeshes(S, B.g.children.slice(), B.g.matrix, at, null, 0.5, vel, mass, B.g);
      });
      return;
    }
    piecesOf(S, real, B.pos, B.q, B.com, vel, B.g, function () { footprint(S, B); });
  }
  /* PIECES, ONE CHUNK A JOB. A body (or a pancaking block's bottom storey)
     breaking up is cut chunk by chunk in the pieces queue: one Voronoi of a
     whole storey was a 15 ms job, and a long backlog goes as dust and grit
     like any crushed storey. `pic` (the picture: the body's group, the shed
     storey) stays drawn until the last of its chunks has gone. */
  function piecesOf(S, list, pos0, q0, com0, vel, pic, onDone) {
    let left = list.length;
    const pos = pos0.clone(), q = q0.clone(), com = com0.clone();
    const done = function () {
      if (--left > 0) return;
      if (onDone) { try { onDone(); } catch (e) {} }
      if (pic) {
        if (pic.parent) pic.parent.remove(pic);
        pic.traverse(function (o) { if (o.isMesh && o.geometry && !o.geometry._shared) o.geometry.dispose(); });
      }
    };
    if (!left) { left = 1; done(); return; }
    for (const c of list) {
      work.push(function (cheap) {
        if (S.disposed) { done(); return; }
        hideChunk(S, c);
        const at = new THREE.Vector3(c.cx - com.x, c.cy - com.y, c.cz - com.z).applyQuaternion(q).add(pos);
        if (cheap) {
          try { if (CBZ.debris && CBZ.debris.chips) CBZ.debris.chips(at.x, at.y, at.z, { color: S.D.wall, count: 8, power: 1, dust: true }); } catch (e) {}
          done(); return;
        }
        const hold = new THREE.Group();
        hold.position.copy(pos); hold.quaternion.copy(q);
        for (const ms of geoOf(S, [c], com)) hold.add(ms);
        hold.updateMatrix(); hold.updateMatrixWorld(true);
        shatterMeshes(S, hold.children.slice(), hold.matrix, at, null, 0.5, vel, c.mass, hold);
        done();
      });
    }
  }
  // what a body inherits when it is split off a moving one: never thrown
  function tame(B) {
    const w = B.w, wl = w.length();
    if (wl > B.maxW) w.multiplyScalar(B.maxW / wl);
    if (B.v.y > B.maxUp) B.v.y = B.maxUp;
    const hs = Math.hypot(B.v.x, B.v.z);
    if (hs > V_SIDE) { B.v.x *= V_SIDE / hs; B.v.z *= V_SIDE / hs; }
  }

  /* ---- NOTHING RESTS ON NOTHING ----------------------------------------------
     A body settles only where something holds it: the ground (or the floor
     of a hole), its stump, kept rubble, a crushed car, a building. Resting on
     another body that is still awake does not count (that one may go). The
     test is geometric and fresh: the world's colliders near it right now
     (minus its own kept solids), the standing chunks, the ground. A body that
     is not held when it would settle does not settle: it drops, straight
     down, until it lands on something, and is kept there. Kept rubble is
     watched the same way (a few a frame): the slab it lay on can be carried
     off, the stump under it can crush, a crater can open; then it drops
     again. */
  const HOLD = 0.3;                       // m: a hull point this close over a support is resting on it
  function refreshCols(B, own) {
    B.cols = [];
    if (CBZ.queryCollidersNear) {
      try {
        const L = CBZ.queryCollidersNear(B.pos.x, B.pos.z, B.radius + 1.5, []);
        for (const c of L) if (!c._cbzS && !c.carCollider && !(own && own.has(c))) B.cols.push(c);
      } catch (e) {}
    }
    let f = 0;
    const S = B.S, p = B.pos;
    try { f = S.D.groundAt ? S.D.groundAt(p.x, p.z) : CBZ.groundAt ? CBZ.groundAt(p.x, p.z) : (CBZ.floorAt ? CBZ.floorAt(p.x, p.z, -50) : 0); } catch (e) { f = 0; }
    B.floorY = isFinite(f) ? f : 0;
    B.colsT = nowT;
  }
  // the smallest gap between the body's hull and what holds it up (< 0: in it)
  function gapUnder(B) {
    frameOf(B);
    const R = B.R, p = B.pos, pts = B.pts;
    const near = B.near; B.near = null;
    let gap = Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const lx = pts[i], ly = pts[i + 1], lz = pts[i + 2];
      const wx = p.x + R[0] * lx + R[1] * ly + R[2] * lz, wy = p.y + R[3] * lx + R[4] * ly + R[5] * lz, wz = p.z + R[6] * lx + R[7] * ly + R[8] * lz;
      const sp = support(B, wx, wy, wz);
      const d = wy - sp.h;
      if (d < gap) gap = d;
    }
    B.near = near;
    return gap;
  }
  function heldAt(B, own) {
    refreshCols(B, own);
    return gapUnder(B) <= HOLD;
  }
  const baking = [];                      // settling, waiting for their picture
  const droppers = [];                    // settled where nothing holds them: falling straight down
  const settled = [];                     // kept rubble, watched: {B, rec, t}
  let watchI = 0;
  // settle: the body becomes rubble where it lies (if something holds it)
  function bake(B) {
    const i0 = bodies.indexOf(B);
    if (i0 >= 0) bodies.splice(i0, 1);
    B.g.position.copy(B.pos); B.g.quaternion.copy(B.q);
    B.v.set(0, 0, 0); B.w.set(0, 0, 0);
    // it waits in the settle queue (frozen where it lies) for its picture
    // and its turn: the support test is never a cascade inside one solve
    if (baking.indexOf(B) < 0) baking.push(B);
  }
  function settleNow(B) {
    if (heldAt(B, null)) keepBody(B);
    else drop(B);
  }
  function drop(B) {
    B.dead = true;
    B.dropV = 0;
    stats.drops++;
    if (droppers.indexOf(B) < 0) droppers.push(B);
  }
  const SETTLE_PER_FRAME = PHONE ? 3 : 6;
  function stepBaking() {
    let n = SETTLE_PER_FRAME;
    for (let i = baking.length - 1; i >= 0 && n > 0; i--) {
      const B = baking[i];
      let ready = true;
      for (const p of B.parts) if (!p.meshes) { ready = false; break; }
      if (!ready) continue;
      baking.splice(i, 1);
      settleNow(B);
      n--;
    }
  }
  function stepDroppers(dt) {
    for (let i = droppers.length - 1; i >= 0; i--) {
      const B = droppers[i];
      if (!B.g.parent && B.kept) { droppers.splice(i, 1); continue; }
      B.dropV = Math.min(40, B.dropV + G * dt);
      let dy = B.dropV * dt, landed = false;
      if (nowT - B.colsT > 0.1) refreshCols(B, null);
      // in steps no longer than a support may be penetrated by
      while (dy > 0) {
        const st = Math.min(dy, 0.35);
        const gap = gapUnder(B);
        if (gap <= st + 0.02) { B.pos.y -= Math.max(0, gap); landed = true; break; }
        B.pos.y -= st; dy -= st;
      }
      if (B.pos.y < -120) { droppers.splice(i, 1); if (B.g.parent) B.g.parent.remove(B.g); B.g.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); }); continue; }
      B.g.position.copy(B.pos);
      if (!B.g.matrixAutoUpdate) { B.g.updateMatrix(); B.g.updateMatrixWorld(true); }
      if (landed) { droppers.splice(i, 1); keepBody(B); }
    }
  }
  /* KEEP: the body is rubble where it lies. It is KEPT as it is (debris.js
     keep: no copy into a rubble bucket, no re-merge of the cell around it),
     solid through colliders fitted to its own chunks, and its meshes are
     merged per material later, from the work queue. */
  function keepBody(B) {
    const S = B.S;
    B.dead = true;
    B.g.position.copy(B.pos); B.g.quaternion.copy(B.q);
    B.g.updateMatrix(); B.g.updateMatrixWorld(true);
    if (!B.kept) {
      footprint(S, B);
      S.stats.baked++; stats.baked++;
      rubbleKeys.add(S.key);
      S.stats.lastSettle = nowT - S.stats.born;
    }
    const D = CBZ.debris;
    if (D && D.keep) {
      let rec = null;
      try { rec = D.keep(B.g, { owner: S.key, cols: bodyCols(B) }); } catch (e) { console.warn("[collapse] keep", e); }
      if (rec) settled.push({ B: B, rec: rec, t: nowT });
      if (!B.kept && B.g.children.length > 3) workIdle.push(function () { mergeKept(B.g); });
    } else if (B.g.parent) { B.g.parent.remove(B.g); B.g.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); }); }
    B.kept = true;
  }
  function watchSettled() {
    if (!settled.length || !CBZ.debris || !CBZ.debris.unkeep) return;
    let n = PHONE ? 2 : 4;
    while (n-- > 0 && settled.length) {
      if (watchI >= settled.length) watchI = 0;
      const e = settled[watchI];
      // cleared by its owner (a rebuilt lot, a reset): no longer ours to watch
      if (!e.B.g.parent) { settled.splice(watchI, 1); continue; }
      if (nowT - e.t < 0.5) { watchI++; continue; }
      if (!heldAt(e.B, new Set(e.rec.cols))) {
        if (CBZ.debris.unkeep(e.rec)) { settled.splice(watchI, 1); stats.rewoken++; drop(e.B); continue; }
      }
      watchI++;
    }
  }
  /* The solids a settled body leaves: one box per chunk (one per level group
     on a big block), fitted to that chunk's own extent in the pose it came to
     rest in. Upright, an oriented box on the body's own yaw; tilted, the
     chunk's world bounds — a wall panel's, a slab tile's, never the block's. */
  const _cw = HAS3 ? new THREE.Vector3() : null;
  function bodyCols(B) {
    const out = [];
    const real = B.chunks.filter(function (c) { return c.tris > 0; });
    const groups = real.length > 64
      ? B.parts.map(function (p) { return p.chunks.filter(function (c) { return c.tris > 0; }); }).filter(function (a) { return a.length; })
      : real.map(function (c) { return [c]; });
    const M = new THREE.Matrix4().compose(B.pos, B.q, new THREE.Vector3(1, 1, 1));
    const e = M.elements;
    const upright = B.tilt < 0.2;
    const yaw = Math.atan2(-e[2], e[0]);
    for (const grp of groups) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const c of grp) {
        const g = c.gb;
        x0 = Math.min(x0, g[0]); x1 = Math.max(x1, g[1]); y0 = Math.min(y0, g[2]); y1 = Math.max(y1, g[3]); z0 = Math.min(z0, g[4]); z1 = Math.max(z1, g[5]);
      }
      x0 -= B.com.x; x1 -= B.com.x; y0 -= B.com.y; y1 -= B.com.y; z0 -= B.com.z; z1 -= B.com.z;
      let a = Infinity, b = -Infinity, lo = Infinity, hi = -Infinity, c0 = Infinity, c1 = -Infinity;
      for (const px of [x0, x1]) for (const py of [y0, y1]) for (const pz of [z0, z1]) {
        _cw.set(px, py, pz).applyMatrix4(M);
        if (_cw.x < a) a = _cw.x; if (_cw.x > b) b = _cw.x;
        if (_cw.y < lo) lo = _cw.y; if (_cw.y > hi) hi = _cw.y;
        if (_cw.z < c0) c0 = _cw.z; if (_cw.z > c1) c1 = _cw.z;
      }
      if (hi - lo < 0.25) continue;                       // a sheet on the ground: walked over, not into
      if (upright && CBZ.orientedCollider) {
        _cw.set((x0 + x1) / 2, 0, (z0 + z1) / 2).applyMatrix4(M);
        out.push(CBZ.orientedCollider(_cw.x, _cw.z, (x1 - x0) / 2, (z1 - z0) / 2, yaw, lo, hi));
      } else {
        // a tilted piece's bounds overstate it in every direction (a slab lying
        // at 40 degrees has an AABB as tall as it is wide): the solid is the
        // core of them, up to the piece's own middle, so nothing lands on air
        // above it and nobody under its low edge is lifted
        const sx = (b - a) * 0.2, sz = (c1 - c0) * 0.2;
        _cw.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).applyMatrix4(M);
        out.push({ minX: a + sx, maxX: b - sx, minZ: c0 + sz, maxZ: c1 - sz, y0: Math.max(lo, _cw.y - 0.6), y1: Math.max(lo + 0.25, _cw.y) });
      }
    }
    return out;
  }
  // a kept body drawn as one mesh per material (its parts' meshes merged)
  /* one material per call (a kept tower holds a hundred thousand vertices of
     wall: merging all of it in one idle job was a frame of its own); the
     rest re-queue */
  function mergeKept(g) {
    if (!g.parent) return;
    const byMat = new Map();
    for (const ms of g.children) {
      if (!ms.isMesh || ms.userData.debrisMerged) continue;
      let L = byMat.get(ms.material); if (!L) { L = []; byMat.set(ms.material, L); }
      L.push(ms);
    }
    const n3 = new THREE.Matrix3();
    let done = false;
    byMat.forEach(function (L, mt) {
      if (L.length < 2 || done) return;
      done = true;
      let nv = 0, vc = false;
      for (const ms of L) { nv += ms.geometry.attributes.position.count; if (ms.geometry.attributes.color) vc = true; }
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), Cc = vc ? new Float32Array(nv * 3) : null;
      let o = 0;
      for (const ms of L) {
        ms.updateMatrix();
        const e = ms.matrix.elements, A = ms.geometry.attributes;
        n3.getNormalMatrix(ms.matrix);
        const q = n3.elements;
        const pa = A.position.array, na = A.normal.array, ua = A.uv.array, ca = A.color ? A.color.array : null;
        for (let i = 0; i < A.position.count; i++, o++) {
          const x = pa[i * 3], y = pa[i * 3 + 1], z = pa[i * 3 + 2];
          P[o * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
          P[o * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          P[o * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          const a = na[i * 3], b2 = na[i * 3 + 1], c = na[i * 3 + 2];
          N[o * 3] = q[0] * a + q[3] * b2 + q[6] * c; N[o * 3 + 1] = q[1] * a + q[4] * b2 + q[7] * c; N[o * 3 + 2] = q[2] * a + q[5] * b2 + q[8] * c;
          U[o * 2] = ua[i * 2]; U[o * 2 + 1] = ua[i * 2 + 1];
          if (Cc) {
            if (ca) { Cc[o * 3] = ca[i * 3]; Cc[o * 3 + 1] = ca[i * 3 + 1]; Cc[o * 3 + 2] = ca[i * 3 + 2]; }
            else { Cc[o * 3] = 1; Cc[o * 3 + 1] = 1; Cc[o * 3 + 2] = 1; }
          }
        }
        g.remove(ms);
        ms.geometry.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      if (Cc) geo.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mt);
      m.matrixAutoUpdate = false;
      m.userData.debrisRubble = true; m.userData.debrisMerged = true;
      m.castShadow = !PHONE; m.receiveShadow = true;
      glassDraw(m);
      g.add(m);
    });
    g.updateMatrixWorld(true);
    if (done) workIdle.push(function () { mergeKept(g); });
  }
  function footprint(S, B) {
    const F = S.stats.foot, a = B.aabb;
    if (!a) return;
    F.minX = Math.min(F.minX, a[0]); F.maxX = Math.max(F.maxX, a[1]); F.minZ = Math.min(F.minZ, a[3]); F.maxZ = Math.max(F.maxZ, a[4]);
    // area actually covered, on a 1 m grid, from the body's oriented box
    const R = new THREE.Matrix4().makeRotationFromQuaternion(B.q);
    const lo = B.lo, hi = B.hi;
    const stepX = Math.max(0.5, (hi.x - lo.x) / 16), stepZ = Math.max(0.5, (hi.z - lo.z) / 16), stepY = Math.max(0.5, (hi.y - lo.y) / 4);
    const v = new THREE.Vector3();
    for (let x = lo.x; x <= hi.x; x += stepX) for (let y = lo.y; y <= hi.y; y += stepY) for (let z = lo.z; z <= hi.z; z += stepZ) {
      v.set(x, y, z).applyMatrix4(R).add(B.pos);
      F.cells.add(Math.floor(v.x) + "," + Math.floor(v.z));
      if (F.cells.size > 40000) return;
    }
  }
  // break a body apart: a tower into segments, a segment into chunks, a chunk into pieces
  function split(B) {
    const S = B.S;
    if (B.parts.length > 1) {
      const nSeg = Math.max(2, Math.min(6, Math.ceil(B.parts.length / 2)));
      const per = Math.ceil(B.parts.length / nSeg);
      // the segments TAKE the parts (meshes and all): nothing is copied
      const i0 = bodies.indexOf(B);
      if (i0 >= 0) bodies.splice(i0, 1);
      B.dead = true;
      if (B.g.parent) B.g.parent.remove(B.g);
      for (let i = 0; i < B.parts.length; i += per) {
        const ps = B.parts.slice(i, i + per), list = [];
        for (const p of ps) for (const c of p.chunks) list.push(c);
        for (const p of ps) if (p.meshes) for (const ms of p.meshes) B.g.remove(ms);
        const nb = makeBody(S, list, B, ps);
        if (nb) { nb.hard = 0; nb.split = (B.split || 0) + 1; }
        else shatterParts(S, B, ps);
      }
      return;
    }
    const real = B.chunks.filter(function (c) { return c.tris > 0; });
    if (real.length > 1) {
      // into groups of neighbouring chunks, as many as the budget holds
      // (the body itself frees one slot; the calmest settled free the rest)
      const i0 = bodies.indexOf(B);
      if (i0 >= 0) bodies.splice(i0, 1);
      let room = BODY_CAP - bodies.length;
      for (const b of bodies) if (b.contact && !b.onBody && b.parts.length < 2) room++;
      const n = Math.min(real.length, room, PHONE ? 6 : 12);
      if (n < 2) { shatterBody(B); return; }
      real.sort(function (a, b) { return (a.kind - b.kind) || (a.f - b.f) || (a.j - b.j) || (a.ix - b.ix) || (a.iz - b.iz); });
      const per = Math.ceil(real.length / n);
      // the old body stays on screen, frozen, until its pieces are drawn
      // (its own picture is never copied here: what it has is the ghost,
      // what it lacks is still queued and lands in the ghost)
      B.dead = true;
      B.g.position.copy(B.pos); B.g.quaternion.copy(B.q);
      const ghost = { g: B.g, n: 0, done: false };
      for (let i = 0; i < real.length; i += per) {
        const grp = real.slice(i, i + per);
        const nb = makeBody(S, grp, B, null, ghost);
        if (nb) { nb.hard = 0; nb.split = (B.split || 0) + 1; }
        else shatterChunks(S, B, grp);
      }
      if (ghost.n <= 0) workHi.push(function () { dropGhost(ghost); });
      return;
    }
    // one chunk, hard landing: pieces of itself
    if (!real[0]) { removeBody(B, false); return; }
    shatterBody(B);
  }
  // segments a full budget could not take: their pictures go as pieces
  function shatterParts(S, B, ps) {
    const pos = B.pos.clone(), q = B.q.clone(), com = B.com.clone();
    const vel = B.v.clone().multiplyScalar(0.4); if (vel.y > 0) vel.y = 0;
    let mass = 0; for (const p of ps) mass += p.mass;
    workHi.push(function () {
      const hold = new THREE.Group();
      hold.position.copy(pos); hold.quaternion.copy(q);
      for (const p of ps) {
        if (!p.meshes) p.meshes = S.disposed ? [] : geoOf(S, p.chunks.filter(function (c) { return c.tris; }), com);
        for (const c of p.chunks) hideChunk(S, c);
        for (const ms of p.meshes) { if (ms.parent) ms.parent.remove(ms); hold.add(ms); }
      }
      hold.updateMatrix(); hold.updateMatrixWorld(true);
      shatterMeshes(S, hold.children.slice(), hold.matrix, pos, null, 0.5, vel, mass, hold);
    });
  }
  // a group of a broken body's chunks the budget could not take as a body
  function shatterChunks(S, B, grp) {
    const pos = B.pos.clone(), q = B.q.clone(), com = B.com.clone();
    const vel = B.v.clone().multiplyScalar(0.4); if (vel.y > 0) vel.y = 0;
    let mass = 0; for (const c of grp) mass += c.mass;
    workHi.push(function () {
      if (S.disposed) return;
      const hold = new THREE.Group();
      hold.position.copy(pos); hold.quaternion.copy(q);
      for (const ms of geoOf(S, grp, com)) hold.add(ms);
      hold.updateMatrix(); hold.updateMatrixWorld(true);
      shatterMeshes(S, hold.children.slice(), hold.matrix, pos, null, 0.5, vel, mass, hold);
    });
  }
  // the bottom storey of a pancaking block is consumed
  function shedBottom(B) {
    B.shed = false;
    if (B.parts.length < 2) return;
    B.lastShed = nowT;
    const S = B.S, p = B.parts.shift();
    // its meshes -> pieces, at the body's pose (queued: a block pancaking
    // through ten storeys sheds one every few frames)
    if (!p.meshes) buildPart(p);
    const hold = new THREE.Group();
    hold.position.copy(B.pos); hold.quaternion.copy(B.q);
    for (const ms of p.meshes) { B.g.remove(ms); hold.add(ms); }
    (S.D.root || CBZ.scene).add(hold);
    hold.updateMatrix();
    const at = new THREE.Vector3(0, B.lo.y, 0).applyQuaternion(B.q).add(B.pos);
    const vel = B.v.clone().multiplyScalar(0.3);
    if (vel.y > 0) vel.y = 0;
    if (S.disposed) {
      workHi.push(function () {
        if (hold.parent) hold.parent.remove(hold);
        shatterMeshes(S, hold.children.slice(), hold.matrix, at, null, 0.5, vel, p.mass, hold);
      });
    } else piecesOf(S, p.chunks.filter(function (c) { return c.tris > 0; }), B.pos, B.q, B.com, vel, hold, null);
    S.stats.pancaked++;
    const set = new Set(p.chunks);
    B.chunks = B.chunks.filter(function (c) { return !set.has(c); });
    // the new centre of mass, the meshes re-based on it
    let M = 0; const com = new THREE.Vector3();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const c of B.chunks) {
      const g = c.gb;
      M += c.mass; com.x += c.mass * (g[0] + g[1]) / 2; com.y += c.mass * (g[2] + g[3]) / 2; com.z += c.mass * (g[4] + g[5]) / 2;
      if (!c.tris) continue;
      x0 = Math.min(x0, g[0]); x1 = Math.max(x1, g[1]); y0 = Math.min(y0, g[2]); y1 = Math.max(y1, g[3]); z0 = Math.min(z0, g[4]); z1 = Math.max(z1, g[5]);
    }
    if (!(M > 0) || !isFinite(x0)) { removeBody(B, false); return; }
    com.divideScalar(M);
    const dl = new THREE.Vector3().copy(com).sub(B.com);
    for (const ch of B.g.children) ch.position.sub(dl);
    B.pos.add(dl.clone().applyQuaternion(B.q));
    B.com.copy(com); B.mass = M; B.invM = 1 / M;
    B.lo.set(x0, y0, z0).sub(com); B.hi.set(x1, y1, z1).sub(com);
    shapeBody(B);
    pall(S, at.x, at.y, at.z, 1.2, Math.max(B.hi.x - B.lo.x, B.hi.z - B.lo.z) * 0.4);
  }

  function frameOf(B) {
    const q = B.q, R = B.R || (B.R = new Float64Array(9));
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    R[0] = 1 - 2 * (qy * qy + qz * qz); R[1] = 2 * (qx * qy - qz * qw); R[2] = 2 * (qx * qz + qy * qw);
    R[3] = 2 * (qx * qy + qz * qw); R[4] = 1 - 2 * (qx * qx + qz * qz); R[5] = 2 * (qy * qz - qx * qw);
    R[6] = 2 * (qx * qz - qy * qw); R[7] = 2 * (qy * qz + qx * qw); R[8] = 1 - 2 * (qx * qx + qy * qy);
    B.upY = R[4];
  }
  /* THE CAP IS HARD: makeBody makes its own room (freeSlot). This only
     catches a body that got in some other way: calmest settled first. */
  function relieve() {
    let guard = 16;
    while (bodies.length > BODY_CAP && guard-- > 0) if (!freeOne()) break;
  }
  const _step = [];
  function stepBodies(dt) {
    if (!bodies.length) return;
    relieve();
    const sub = Math.max(1, Math.min(4, Math.ceil(dt / (1 / 90))));
    const h = dt / sub;
    for (const B of bodies) frameOf(B);
    for (const B of baking) frameOf(B);
    for (const B of bodies) {
      let L = null;
      for (let k = 0; k < bodies.length + baking.length; k++) {
        const O = k < bodies.length ? bodies[k] : baking[k - bodies.length];
        if (O === B || O.S !== B.S && Math.abs(O.pos.x - B.pos.x) > 200) continue;
        const r = O.radius + B.radius + 0.5;
        if (Math.abs(O.pos.x - B.pos.x) > r || Math.abs(O.pos.z - B.pos.z) > r || O.pos.y > B.pos.y + 0.5) continue;
        (L || (L = [])).push(O);
      }
      B.near = L;
    }
    // (a snapshot: a body settling, splitting or making room changes the list)
    _step.length = 0;
    for (let i = bodies.length - 1; i >= 0; i--) _step.push(bodies[i]);
    for (let i = 0; i < _step.length; i++) {
      const B = _step[i];
      if (!B || B.dead || bodies.indexOf(B) < 0) continue;
      B.hard = 0; B.pancaking = false;
      for (let k = 0; k < sub && !B.dead; k++) {
        stepBody(B, h);
        if (B.shed) shedBottom(B);
      }
      if (B.dead) continue;
      B.g.position.copy(B.pos); B.g.quaternion.copy(B.q);
      // a body RESTING on a standing storey is weight on it: the load path
      // carries it (and fails under it) like any other load
      if (B.ownC.length) {
        const share = B.mass / B.ownC.length;
        for (const c of B.ownC) { if (!c.S) continue; c.ext = share; c.extT = nowT; c.S.active = Math.max(c.S.active, 1); }
      }
      crushCars(B);
      const S = B.S, m = S.m;
      // a hard landing on anything that is not its own stump breaks it
      const multi = B.parts.length > 1 || B.chunks.length > 1;
      const brk = multi ? m.breakV : m.shatterV;
      if (B.hard > brk && B.t > 0.05 && !B.pancaking) {
        if (B.mass > 3) crushPeople(B, B.pos.x, B.pos.z, Math.max(2, B.radius * 0.7));
        if (B.parts.length > 1 && B.mass > 40) pall(S, B.pos.x, B.pos.y + B.lo.y, B.pos.z, Math.min(2.5, 0.8 + B.hard * 0.1), B.radius * 0.6);
        if (multi || B.hard > m.shatterV) { split(B); continue; }
      }
      // a toppling mass that has gone over and is touching down comes apart as it lands
      if (B.parts.length > 1 && B.contact && B.tilt > 0.62) { split(B); continue; }
      /* A BLOCK OF STOREYS NEVER COMES TO REST ON ITS RUBBLE. Upright and
         stopped on anything but its own standing stump (whose load path
         carries it, or crushes under it), a block of several storeys is a
         wrecked frame standing on a heap: its bottom storey gives every
         few tenths of a second and it settles storey by storey to the
         ground, the last of it lying in its own pile. */
      if (B.parts.length > 1 && B.contact && !B.ownC.length && B.tilt < 0.62 && B.v.lengthSq() < 4 && nowT - B.lastShed > 0.3) { shedBottom(B); if (B.dead) continue; }
      // settle: still on something for half a second, or barely moving long
      // after the fall. Never while lying on another body that is still
      // awake (it would be left hanging in the air when that one goes: it
      // waits for that one to settle, then lies on its rubble), and a block
      // of storeys never settles whole: past its time it breaks up. Past
      // half a minute it settles whatever it is doing, and bake() still
      // keeps it nowhere nothing holds it: it drops.
      const one = B.parts.length < 2;
      if (B.t > 18 && !one) { split(B); continue; }
      if (one && !B.onBody && (B.calm > 0.5 || (B.contact && B.t > 8 && B.v.lengthSq() < 1 && B.w.lengthSq() < 0.5) || (B.contact && B.t > 18))) { bake(B); continue; }
      if (one && B.t > 30) { bake(B); continue; }
      if (B.pos.y < -120) removeBody(B, false);
    }
    // the snapshot lets go: stepBodies returns at once once nothing is
    // falling, so whatever it still listed (bodies -> their structures -> the
    // building's cut) stayed alive after the bake, the dispose and the match
    // reset (tools/probes/disaster-leak.mjs: ~40 MB on the island)
    _step.length = 0;
  }

  /* ============================================================
     6. THE API.
     ============================================================ */
  /* hint {y, r}: the world height and radius of the damage that made this
     structure — the cut is bounded to the storeys round it (see REGION).
     No hint (a condemnation, a quake, an undermine, a tool): the whole. */
  function structFor(x, start, hint) {
    const D = norm(x);
    if (!D || typeof THREE === "undefined") return null;
    let S = byGroup.get(D.grp);
    if (S && !S.disposed) return S;
    if (!start) return null;
    S = makeStruct(D, hint);
    S.gen = cutGen(S);
    owners.add(S.key);
    byGroup.set(D.grp, S);
    structs.push(S);
    return S;
  }
  // run the cutters within the frame's budget (the lab and a tool may pass
  // Infinity to cut synchronously)
  function runCuts(budgetMs) {
    const t0 = performance.now();
    for (const S of structs) {
      if (!S.gen) continue;
      try {
        while (performance.now() - t0 < budgetMs) {
          const r = S.gen.next();
          if (r.done) { S.gen = null; break; }
        }
      } catch (e) {
        console.warn("[collapse] cut failed", e); S.gen = null; S.refining = false; releaseReadback(S);
        // a refine that fails leaves the standing building as it was drawn
        if (S.root && S.meshes.length) S.ready = true; else S.failed = true;
      }
      if (performance.now() - t0 >= budgetMs) break;
    }
  }
  function ready(S) {
    if (S.ready) return true;
    if (S.gen && S.D.sync) runCuts(Infinity);
    return S.ready;
  }

  /* damage(building, point, radius, energy, dir, opts) */
  const MIN_E = 0.35;
  /* opts.frac: `energy` is a FRACTION of what brings this building down (the
     island ledger's scale: 0.35 glass out, 0.7 spalling, 1 collapse) rather
     than megajoules. It is turned into energy against the chunks it reaches,
     and the fractions add up on the building: at 1 it is condemned and comes
     down through play(), exactly as the ledger would have had it. */
  C.damage = function (bld, point, radius, energy, dir, opts) {
    opts = opts || {};
    if (!CBZ.CONFIG.COLLAPSE_V2 || !point || !(radius > 0) || !(energy > (opts.frac ? 0 : MIN_E))) return null;
    const S = bld && bld.chunks ? bld : structFor(bld, true, opts.frac >= 1 ? null : { y: point.y, r: radius });
    if (!S || S.failed) return null;
    const req = { k: "dmg", p: { x: point.x, y: point.y, z: point.z }, r: radius, e: energy, dir: dir || null, o: opts, bld: bld };
    // a hit on storeys the bounded cut left coarse cuts them fine first
    if (!S.region.all && !opts.frac) {
      _v3.set(point.x, point.y, point.z).applyMatrix4(S.Linv);
      wantRefine(S, _v3.y - radius, _v3.y + radius);
    }
    if (!S.ready || S.pending.length || S.wantRefine) { S.pending.push(req); return { queued: true, key: S.key }; }
    return applyReq(S, req);
  };
  function applyDamage(S, p, R, E, dir) {
    swap(S);
    const lp = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(S.Linv);
    let removed = 0, weakened = 0;
    const s0 = levelOf(S, lp.y - R), s1 = levelOf(S, lp.y + R);
    for (let s = s0; s <= s1; s++) for (const c of S.levels[s]) {
      if (!c.standing) continue;
      // distance from the point to the chunk's box
      const g = c.gb;
      const dx = Math.max(g[0] - lp.x, 0, lp.x - g[1]), dy = Math.max(g[2] - lp.y, 0, lp.y - g[3]), dz = Math.max(g[4] - lp.z, 0, lp.z - g[5]);
      const d = Math.hypot(dx, dy, dz);
      if (d >= R) continue;
      const f = 1 - d / R;
      const e = E * f * f;
      c.hp -= e / c.tough;
      if (c.hp <= 0) {
        // blown out: away from the charge, plus the push
        const w = new THREE.Vector3((g[0] + g[1]) / 2 - lp.x, (g[2] + g[3]) / 2 - lp.y, (g[4] + g[5]) / 2 - lp.z);
        w.applyQuaternion(S.q).normalize();
        if (dir) w.addScaledVector(new THREE.Vector3(dir.x || 0, dir.y || 0, dir.z || 0).normalize(), 0.8);
        blast(S, c, w, Math.min(2.2, 0.6 + Math.sqrt(e / Math.max(0.5, c.mass)) * 0.9));
        removed++;
      } else weakened++;
    }
    S.active = Math.max(S.active, 4);
    if (removed) pall(S, p.x, Math.max(S.gy, p.y - 1), p.z, Math.min(2, 0.4 + removed * 0.15), Math.min(R, 6));
    return { key: S.key, removed: removed, weakened: weakened };
  }
  function applyReq(S, q) {
    if (q.k === "dmg") {
      if (!q.o.frac) return applyDamage(S, q.p, q.r, q.e, q.dir);
      // the ledger's fraction -> energy against what it reaches
      const lp = new THREE.Vector3(q.p.x, q.p.y, q.p.z).applyMatrix4(S.Linv);
      let T = 0;
      for (const c of S.chunks) {
        if (!c.standing || !c.tris) continue;
        const g = c.gb;
        const d = Math.hypot(Math.max(g[0] - lp.x, 0, lp.x - g[1]), Math.max(g[2] - lp.y, 0, lp.y - g[3]), Math.max(g[4] - lp.z, 0, lp.z - g[5]));
        if (d < q.r) T += c.tough;
      }
      S.frac = (S.frac || 0) + q.e;
      const r = q.e >= 0.3 ? applyDamage(S, q.p, q.r, q.e * Math.max(1, T) * 0.35, q.dir) : { key: S.key, removed: 0, weakened: 0 };
      if (S.frac >= 1 && !S.job) {
        const B = q.bld, d = q.dir || {};
        C.play(B, { wound: { nx: d.x || 0, nz: d.z || 0, floor: levelOf(S, lp.y) }, preShudder: 0.3,
          onGround: function () { if (B && typeof B === "object" && !B.chunks) B.fallen = true; } });
        r.condemned = true;
      }
      return r;
    }
    if (q.k === "under") return applyUndermine(S, q.region, q.o);
    if (q.k === "shake") return applyShake(S, q.i);
    if (q.k === "fn") return q.fn(S);
    return null;
  }

  /* undermine(building, region, opts): the ground under part of it is gone */
  C.undermine = function (bld, region, opts) {
    if (!CBZ.CONFIG.COLLAPSE_V2 || !region) return null;
    const S = bld && bld.chunks ? bld : structFor(bld, true);
    if (!S || S.failed) return null;
    const req = { k: "under", region: region, o: opts || {} };
    if (!S.ready || S.pending.length) { S.pending.push(req); return { queued: true, key: S.key }; }
    return applyReq(S, req);
  };
  function inRegion(R, x, z) {
    if (R.r != null) { const dx = x - R.x, dz = z - R.z; return dx * dx + dz * dz <= R.r * R.r; }
    return x >= R.minX && x <= R.maxX && z >= R.minZ && z <= R.maxZ;
  }
  /* The region callers hand in:
       {x, z, r} or {minX, maxX, minZ, maxZ}  the ground gone from there;
         depth (or bottom, the hole's floor) on the region or in opts: what
         the falling pieces land on there (world/sinkhole.js passes its shaft)
       {ax, az, ...} with no place: the soil gives under one SIDE (a quake's
         settlement, systems/quake.js): rotation axis (ax, az), so the side
         that goes is the one the building would tilt toward */
  function applyUndermine(S, R, o) {
    swap(S);
    let n = 0;
    const placed = R.r != null || R.minX != null;
    let lnx = 0, lnz = 0, ext = 1;
    if (!placed) {
      const tx = -(R.az || 0), tz = R.ax || 0, l = Math.hypot(tx, tz) || 1;
      lnx = (tx / l) * S.cos - (tz / l) * S.sin; lnz = (tx / l) * S.sin + (tz / l) * S.cos;
      ext = Math.abs(lnx) * S.hw + Math.abs(lnz) * S.hd;
    }
    for (const c of S.levels[0]) {
      if (!c.standing || c.undermined) continue;
      if (placed) {
        const w = new THREE.Vector3(c.cx, 0, c.cz).applyMatrix4(S.L);
        if (!inRegion(R, w.x, w.z)) continue;
      } else if (c.cx * lnx + c.cz * lnz < 0.1 * ext) continue;
      c.undermined = true; n++;
    }
    const depth = (o && o.depth > 0) ? +o.depth : R.depth > 0 ? +R.depth : (R.bottom != null && isFinite(R.bottom)) ? S.gy - R.bottom : 0;
    if (placed && depth > 0) holes.push({ x: R.x, z: R.z, r: R.r, minX: R.minX, maxX: R.maxX, minZ: R.minZ, maxZ: R.maxZ, y: S.gy, depth: depth });
    S.active = Math.max(S.active, 5);
    return { key: S.key, undermined: n };
  }

  /* shake(building, intensity, dir): a quake's cyclic damage. The weakest
     walls (mostly glass, the soft storey) lose the most. */
  C.shake = function (bld, intensity, dir) {
    if (!CBZ.CONFIG.COLLAPSE_V2 || !(intensity > 0)) return null;
    const S = bld && bld.chunks ? bld : structFor(bld, true);
    if (!S || S.failed) return null;
    const req = { k: "shake", i: intensity };
    if (!S.ready || S.pending.length) { S.pending.push(req); return { queued: true, key: S.key }; }
    return applyReq(S, req);
  };
  function applyShake(S, I) {
    swap(S);
    const minSf = Math.min.apply(null, S.sf);
    let n = 0;
    for (const c of S.chunks) {
      if (!c.standing) continue;
      const soft = minSf / S.sf[c.s];
      c.hp -= I * 0.05 * (1.25 - (c.kind === 0 ? c.sol : 0.5)) * soft * (0.6 + rnd() * 0.8);
      if (c.hp <= 0.02) { crush(S, c); n++; }
    }
    S.active = Math.max(S.active, 3);
    return { key: S.key, crushed: n };
  }

  C.fracture = function (bld, opts) {
    const S = structFor(bld, true);
    if (!S) return null;
    if (opts && opts.sync) runCuts(Infinity);
    return { key: S.key, ready: S.ready };
  };
  C.isFractured = function (bld) { const S = structFor(bld, false); return !!(S && S.swapped); };

  /* forget(building): the lot is being rebuilt. Whatever of the cut building
     still stands goes; the pooled trim / veneer the cut hid comes back. */
  C.forget = function (bld) {
    const D = norm(bld);
    if (!D) return false;
    const S = byGroup.get(D.grp);
    if (S) {
      dispose(S, true);
      /* AND ITS PIECES. dispose() ends the live bodies, but a body waiting
         to be baked or dropping onto its rest went on to become kept rubble
         of a building that no longer exists, on a lot being rebuilt (or
         hanging where its support had been). They go now, with every piece
         and every kept slab the structure handed to debris.js. */
      const gone = function (B) {
        if (B.S !== S) return false;
        if (B.g.parent) B.g.parent.remove(B.g);
        B.g.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); });
        return true;
      };
      for (let k = baking.length - 1; k >= 0; k--) if (gone(baking[k])) baking.splice(k, 1);
      for (let k = droppers.length - 1; k >= 0; k--) if (gone(droppers[k])) droppers.splice(k, 1);
      for (let k = settled.length - 1; k >= 0; k--) if (settled[k].B.S === S) settled.splice(k, 1);
      if (CBZ.debris) { try { CBZ.debris.clear(S.key); } catch (e) {} }
      owners.delete(S.key);
    }
    rubbleKeys.delete(D.key);
    expandReplaced(D.grp);
    const R = retired.get(D.grp);
    if (R) {
      const touched = new Set();
      for (const r of R.inst) { r.im.instanceMatrix.array.set(r.m, r.i * 16); touched.add(r.im); }
      touched.forEach(function (im) { im.instanceMatrix.needsUpdate = true; });
      restoreLive(R.tri || [], R.walls || []);
      retired.delete(D.grp);
    }
    return true;
  };
  const finals = new WeakMap();           // group -> the last summary of a structure that is gone
  /* The support query's scratch (_sup, _col) keeps the last chunk it touched
     between calls; a chunk holds its structure, so one stale reference held
     a whole disposed building's cut alive. They let go with the structure. */
  function dropScratch() { _sup.ch = null; _sup.lch = null; _col.c = null; }
  function dispose(S, forRebuild) {
    if (S.disposed) return;
    dropScratch();
    try { finals.set(S.grp, summary(S)); } catch (e) {}
    // the boxes still owed to chunks that left come out now (none may be
    // left standing in the world as an invisible wall), and a body still
    // waiting on its picture copies it before the bands go
    runSurgery(S, Infinity);
    for (const b of baking) if (b.S === S) buildAll(b);
    S.disposed = true;
    const i = structs.indexOf(S); if (i >= 0) structs.splice(i, 1);
    if (byGroup.get(S.grp) === S) byGroup.delete(S.grp);
    for (let k = bodies.length - 1; k >= 0; k--) if (bodies[k].S === S) removeBody(bodies[k], false);
    // every box this structure put in the world comes out; the originals are
    // the building's (demolition.js re-seats them on a rebuild)
    for (const c of S.chunks) {
      for (const sc of c.subCols || []) S.deadCols.push(sc);
      for (const sp of c.subPlats || []) S.deadPlats.push(sp);
      c.subCols = null; c.subPlats = null;
    }
    for (const oc of S.origCols || []) { oc._cbzS = null; oc._cbzCh = null; oc._cbzGone = false; }
    if (S.b) for (const p of S.b.platforms || []) { p._cbzS = null; p._cbzCh = null; p._cbzGone = false; }
    flushWorld(S, true);
    if (S.root) {
      if (S.root.parent) S.root.parent.remove(S.root);
      for (const ms of S.meshes) ms.geometry.dispose();
    }
    S.meshes.length = 0; S.pristine.length = 0;
    // what still stands in the merged meshes goes with the bands (a rebuild
    // puts back all that was taken out of them)
    if (S.swapped) for (const c of S.chunks) if (c.lr && !c.lHid) { try { hideLive(S, c); } catch (e) {} }
    S.xv = null;
    if (S.swapped && forRebuild) restoreLive(S.triHid, S.wallHid);
    if (S.swapped && !forRebuild && (S.instHide.length || S.triHid.length || S.wallHid.length)) retired.set(S.grp, { inst: S.instHide, tri: S.triHid, walls: S.wallHid });
    else if (S.swapped && S.instHide.length && forRebuild) {
      const touched = new Set();
      for (const r of S.instHide) { r.im.instanceMatrix.array.set(r.m, r.i * 16); touched.add(r.im); }
      touched.forEach(function (im) { im.instanceMatrix.needsUpdate = true; });
    }
    if (forRebuild && S.swapped) {
      for (const gp of S.panes || []) if (gp._cbzWasWhole) gp._cbzWasWhole = false;
    }
  }
  /* What is left standing becomes rubble where it stands (a condemned
     building's last stump, handed to the lot's owner key so the calendar
     carts it off with the rest). */
  function bakeStanding(S) {
    const left = S.chunks.filter(function (c) { return c.standing && c.tris; });
    if (!left.length) return 0;
    for (const c of left) leave(S, c);
    if (CBZ.debris && CBZ.debris.keep) {
      const g = new THREE.Group();
      g.position.set(S.ox, S.gy, S.oz); g.quaternion.copy(S.q);
      for (const ms of geoOf(S, left, { x: 0, y: 0, z: 0 })) g.add(ms);
      (S.D.root || CBZ.scene).add(g);
      // the stump stands as it stood: one upright box per chunk
      const cols = [];
      for (const c of left) {
        const gb = c.gb;
        _cw.set((gb[0] + gb[1]) / 2, 0, (gb[4] + gb[5]) / 2).applyMatrix4(S.L);
        if (CBZ.orientedCollider) cols.push(CBZ.orientedCollider(_cw.x, _cw.z, (gb[1] - gb[0]) / 2, (gb[5] - gb[4]) / 2, S.yaw, S.gy + gb[2], S.gy + gb[3]));
      }
      try { CBZ.debris.keep(g, { owner: S.key, cols: cols }); } catch (e) {}
    }
    return left.length;
  }

  /* ============================================================
     7. THE CONDEMNED PATH — play(desc, opts).

     structural.js (the city ledger), strike.js (one charge law) and
     disasters.js (the island) decide a building is coming down; this makes
     it come down, for real:
       the TELL     creak and dust for opts.preShudder seconds (the cut runs
                    in the background meanwhile)
       the WOUND    the struck storey is removed on the struck side: a frame
                    or a slender stack then hangs off its frame and tips toward
                    the wound; brittle masonry shears, the part over the hole
                    dropping first. A controlled drop / a framed pancake loses
                    the whole storey: the top comes straight down and crushes
                    its way to the ground. A timber house or adobe loses its
                    ground storey and folds / crumbles into it.
       the RUN-DOWN the design margin is drained so whatever the wound did
                    not bring down follows it, weakest first
     opts: wound {nx, nz, floor}, preShudder, mode (force an initiation),
           onSwap(job), onGround(job), onDone(job), quiet
     ============================================================ */
  const MODES = ["pancake", "topple", "shear", "fold", "crumble"];
  C.modeList = function () { return MODES.slice(); };
  C.registerMode = function () { /* the motion is the structure's now: nothing to register */ };
  // what WOULD this building do (tools, HUD): the same reading the wound uses
  function predictMode(P, wound) {
    const m = P.m;
    if (P.material === "timber" && P.storeys <= 3) return "fold";
    if (P.material === "adobe" || (P.brittle > 0.9 && P.h <= 16 && P.slender < 1.9)) return "crumble";
    if (P.slender >= 1.9 && m.hinge >= 0.6) return "topple";
    if (m.ductile < 0.4 && P.storeys >= 2 && P.slender <= 3.4 && (!wound || (wound.floor || 0) <= Math.max(1, P.storeys * 0.45))) return "shear";
    return "pancake";
  }
  C.predict = function (desc, wound) {
    const P = C.profile(desc);
    return { material: P.material, mode: predictMode(P, wound), slender: +P.slender.toFixed(2) };
  };

  const jobs = [];
  const SETTLE = 2.4;
  C.play = function (desc, opts) {
    if (!CBZ.CONFIG.COLLAPSE_V2) return null;
    opts = opts || {};
    const S = structFor(desc, true);
    if (!S || S.failed) return null;
    if (S.job && !S.job.finished) return S.job;
    const w = opts.wound || {};
    let nx = w.nx || 0, nz = w.nz || 0;
    const nl = Math.hypot(nx, nz);
    if (nl < 1e-3) { const a = rnd() * 6.2832; nx = Math.cos(a); nz = Math.sin(a); } else { nx /= nl; nz /= nl; }
    const job = {
      S: S, desc: desc, prof: S.prof, key: S.key,
      wound: { nx: nx, nz: nz, floor: Math.max(0, Math.min(S.ns - 1, w.floor || 0)) },
      t: 0, phase: 0, dustAcc: 0, pre: opts.preShudder != null ? opts.preShudder : 1.15,
      mode: opts.mode || (desc && desc.tight ? "pancake" : predictMode(S.prof, w)), tight: !!(desc && desc.tight),
      onSwap: opts.onSwap || null, onGround: opts.onGround || null, onDone: opts.onDone || null,
      quiet: !!opts.quiet, grounded: false, finished: false, fall: 0,
    };
    job.mode = { id: job.mode };
    S.job = job;
    jobs.push(job);
    if (!job.quiet) {
      try {
        if (CBZ.shake) CBZ.shake(1.4);
        if (CBZ.sfx) CBZ.sfx("rumble");
        if (CBZ.cityDustKick) CBZ.cityDustKick(S.ox, S.gy + 0.6, S.oz, 2.2 * S.m.dust, dustCol(S));
      } catch (e) {}
    }
    return job;
  };
  C.modeOf = function (job) { return job && job.mode ? job.mode.id : null; };

  function initiate(job) {
    const S = job.S, mode = job.mode.id, f = job.wound.floor;
    const n = job.wound;
    // the wound side: chunks whose centre lies toward the wound normal
    const lnx = n.nx * S.cos - n.nz * S.sin, lnz = n.nx * S.sin + n.nz * S.cos;   // into building axes
    const ext = Math.abs(lnx) * S.hw + Math.abs(lnz) * S.hd;
    const side = function (c) { return (c.cx * lnx + c.cz * lnz) > -0.2 * ext; };
    const kill = function (c, dir) { if (c.standing) blast(S, c, dir, 0.8); };
    const out = new THREE.Vector3(n.nx, 0.15, n.nz);
    if (mode === "pancake" || job.tight) {
      // the whole storey: the top comes straight down on what is under it
      for (const c of S.levels[f]) kill(c, job.tight ? null : out);
      if (S.ns > 6 && f + 1 <= S.ns) for (const c of S.levels[f + 1]) if (c.kind === 0) kill(c, null);
    } else if (mode === "fold" || mode === "crumble") {
      for (const c of S.levels[0]) if (c.kind === 0 || rnd() < 0.5) kill(c, out);
      S.capMulRate = 0.6;
    } else {
      // topple / shear: the struck side of the struck storey (two storeys on a tall one)
      const k = S.ns > 8 ? 2 : 1;
      for (let s = f; s < Math.min(S.ns, f + k); s++) for (const c of S.levels[s]) if (side(c)) kill(c, out);
      if (mode === "topple") S.rigid = true;
    }
    S.active = Math.max(S.active, 6);
    S.condemned = true;
  }

  function stepJobs(dt) {
    for (let i = jobs.length - 1; i >= 0; i--) {
      const job = jobs[i], S = job.S;
      job.t += dt;
      if (S.disposed && job.phase < 2) job.phase = 2;
      if (job.phase === 0) {
        job.dustAcc += dt;
        if (job.dustAcc > 0.28 && !job.quiet) {
          job.dustAcc = 0;
          try {
            if (CBZ.cityDustKick) CBZ.cityDustKick(S.ox + (rnd() - 0.5) * S.w, S.gy + 0.5, S.oz + (rnd() - 0.5) * S.d, 1.4 * S.m.dust, dustCol(S));
            if (CBZ.shake) CBZ.shake(0.5);
          } catch (e) {}
        }
        if (job.t >= job.pre && (ready(S) || S.failed)) {
          if (S.failed) {
            try { if (job.onSwap) job.onSwap(job); if (job.onGround) job.onGround(job); if (job.onDone) job.onDone(job); } catch (e) {}
            job.finished = true; jobs.splice(i, 1); continue;
          }
          swap(S);
          try { if (job.onSwap) job.onSwap(job); } catch (e) {}
          initiate(job);
          job.phase = 1; job.t = 0;
          if (!job.quiet) { try { if (CBZ.sfx) CBZ.sfx("explosion"); if (CBZ.shake) CBZ.shake(2.6); } catch (e) {} }
        }
        continue;
      }
      if (job.phase === 1) {
        // the run-down: after the wound has had its say, the margin drains
        if (job.t > 1.2) S.capMul = Math.max(0.08, S.capMul - dt * (S.capMulRate || 0.22));
        S.active = Math.max(S.active, 1);
        const standing = S.standingMass / Math.max(1e-6, S.totalMass);
        const mine = bodies.filter(function (b) { return b.S === S; }).length;
        job.fall = job.t;
        if (!job.grounded && ((standing < 0.5 && (S.stats.baked > 0 || job.t > 3)) || job.t > 12)) {
          job.grounded = true;
          try { if (job.onGround) job.onGround(job); } catch (e) {}
          if (!job.quiet) { try { if (CBZ.sfx) { CBZ.sfx("collapse"); CBZ.sfx("rumble", { delay: 0.35 }); } if (CBZ.shake) CBZ.shake(Math.min(4.5, 1.6 + S.h * 0.055)); } catch (e) {} }
        }
        const waiting = baking.some(function (b) { return b.S === S; });
        if ((standing < 0.02 && !mine && !waiting) || job.t > 30) {
          // anything still moving settles where it is, the lowest first (so
          // what lies on it finds its rubble), and only where something holds
          // it (bake() drops the rest); what still waits on its picture is
          // finished now, before the structure it copies from goes
          const mineB = bodies.filter(function (b) { return b.S === S; })
            .sort(function (a, b) { return (a.pos.y + a.lo.y) - (b.pos.y + b.lo.y); });
          for (const b of mineB) bake(b);
          for (const b of baking.slice()) if (b.S === S) { buildAll(b); baking.splice(baking.indexOf(b), 1); settleNow(b); }
          bakeStanding(S);
          if (!job.grounded) { job.grounded = true; try { if (job.onGround) job.onGround(job); } catch (e) {} }
          flushWorld(S);
          dispose(S, false);
          job.phase = 2; job.t = 0;
        }
        continue;
      }
      if (job.t >= SETTLE) {
        job.finished = true;
        try { if (job.onDone) job.onDone(job); } catch (e) {}
        jobs.splice(i, 1);
      }
    }
  }
  C.active = function () { return jobs.length; };
  // the real rubble of this lot lies on the ground already (demolition.js
  // need not raise a stand-in mound)
  C.leftRubble = function (key) { for (const j of jobs) if (j.key === key && j.phase >= 1) return true; return !!rubbleKeys.has(key); };
  const rubbleKeys = new Set();

  /* ============================================================
     8. THE CARVE SEAM. Once a building is cut, the original walls are not
     drawn: a rocket's carve (CBZ.cityCarveWall, the one every warhead and
     fracture.js goes through) on a cut building is turned into chunk damage
     at the same seat, sized from the carve (or the charge's own TNT mass).
     ============================================================ */
  function structAt(x, y, z) {
    for (const S of structs) {
      if (!S.swapped || S.disposed) continue;
      const dx = x - S.ox, dz = z - S.oz;
      const lx = dx * S.cos - dz * S.sin, lz = dx * S.sin + dz * S.cos;
      if (Math.abs(lx) < S.hw + 0.8 && Math.abs(lz) < S.hd + 0.8 && y > S.gy - 1 && y < S.gy + S.h + 2) return S;
    }
    return null;
  }
  function wrapCarve() {
    if (C._carveWrapped || typeof CBZ.cityCarveWall !== "function") return;
    const orig = CBZ.cityCarveWall;
    CBZ.cityCarveWall = function (x, y, z, r, o) {
      const S = structs.length ? structAt(x, y, z) : null;
      if (S) {
        const W = o && o.charge && o.charge.W > 0 ? o.charge.W : 0;
        const E = W ? 4.2 * W : 1.2 * Math.pow(Math.max(0.4, r || 1), 3) + 0.8;
        applyDamage(S, { x: x, y: y, z: z }, Math.max(1.4, (r || 1) * 1.6 + (W ? Math.cbrt(W) * 0.6 : 0)), E, null);
        return null;
      }
      return orig.apply(this, arguments);
    };
    C._carveWrapped = true;
  }
  if (typeof CBZ.cityCarveWall === "function") wrapCarve();

  /* ============================================================
     9. THE FRAME.
     ============================================================ */
  function update(dt) {
    if (!(dt > 0)) return;
    if (!structs.length && !bodies.length && !jobs.length && !work.length && !workHi.length && !workIdle.length && !droppers.length && !baking.length && !settled.length) return;
    const t0 = performance.now();
    dt = Math.min(dt, 0.1);
    nowT += dt;
    freeBudget = FREE_PER_FRAME;
    runCuts(SLICE_MS);
    let ta = performance.now(); prof("cut", ta - t0);
    for (let i = structs.length - 1; i >= 0; i--) {
      const S = structs[i];
      if (!S.ready) continue;
      if (S.wantRefine && !S.gen) { const w = S.wantRefine; S.wantRefine = null; S.ready = false; S.gen = refineGen(S, w[0], w[1]); continue; }
      while (S.pending.length) { const q = S.pending.shift(); try { applyReq(S, q); } catch (e) { console.warn("[collapse] request", e); } }
      if (!S.swapped) continue;
      if (S.promo.length) flushSpans(S);
      if (S.xv && nowT - S.xT > 2) S.xv = null;           // the live sources' read-back arrays (viewOf)
      S.tick += dt;
      if (S.active > 0 && S.tick >= TICK) {
        S.tick = 0;
        let changed = 0;
        try { changed = solve(S); } catch (e) { console.warn("[collapse] solve", e); }
        if (!changed && !S.condemned) S.active -= TICK;
      }
      { const tb = performance.now(); prof("solve", tb - ta); ta = tb; }
      runSurgery(S, SURG_MS);
      flushWorld(S);
      { const tb = performance.now(); prof("boxes", tb - ta); ta = tb; }
      // a building nothing is left of, with nothing falling, is done
      if (S.standingReal <= 0 && !S.job && !bodies.some(function (b) { return b.S === S; }) && !baking.some(function (b) { return b.S === S; })) {
        dispose(S, false);
        const tb = performance.now(); prof("dispose", tb - ta); ta = tb;
      }
    }
    ta = performance.now();
    stepBodies(dt);
    { const tb = performance.now(); prof("bodies", tb - ta); ta = tb; }
    runWork(WORK_MS);
    stepBaking();
    { const tb = performance.now(); prof("work", tb - ta); ta = tb; }
    stepDroppers(dt);
    watchSettled();
    { const tb = performance.now(); prof("settle", tb - ta); ta = tb; }
    stepJobs(dt);
    // what the bodies and the queue changed this frame: the standing bands'
    // vertex ranges (the world's boxes went out once, in the loop above)
    for (const S of structs) flushMeshes(S);
    prof("jobs", performance.now() - ta);
    const ms = performance.now() - t0;
    stats.frames++; stats.ms += ms; if (ms > stats.msMax) stats.msMax = ms;
    stats.awakeSum += bodies.length;
  }
  C.update = update;
  const profT = {};
  function prof(k, ms) { const r = profT[k] || (profT[k] = { sum: 0, max: 0 }); r.sum += ms; if (ms > r.max) r.max = ms; }
  if (CBZ.onUpdate) CBZ.onUpdate(34.46, function (dt) { update(dt > 0.25 ? 0.25 : dt); });

  /* ---- what is happening (tools, the lab, storyboards) ---------------------- */
  function summary(S) {
    const st = S.stats;
    const F = st.foot;
    let standingLv = 0;
    for (let s = 0; s <= S.ns; s++) if (S.levels[s].some(function (c) { return c.standing && c.tris; })) standingLv++;
    return {
      key: S.key, material: S.material, rigid: S.rigid, ready: S.ready, swapped: S.swapped,
      storeys: S.ns, bays: [S.nx, S.nz], chunks: st.chunks, cells: S.chunks.length, tris: st.tris, cutMs: st.cutMs,
      standing: S.chunks.filter(function (c) { return c.standing && c.tris; }).length, standingLevels: standingLv,
      standingMass: +(S.standingMass / Math.max(1e-6, S.totalMass)).toFixed(3),
      crushed: st.crushed, blasted: st.blasted, detached: st.detached, bodies: st.bodies, pieces: st.pieces, baked: st.baked,
      carsCrushed: st.carsCrushed, tipped: st.tipped, maxTiltDeg: Math.round(st.maxTilt * 57.3), pancaked: st.pancaked,
      firstFall: st.firstFall >= 0 ? +st.firstFall.toFixed(2) : null, lastSettle: st.lastSettle >= 0 ? +st.lastSettle.toFixed(2) : null,
      soft: S.soft, sf: S.sf ? S.sf.map(function (v) { return +v.toFixed(2); }) : null,
      footprint: isFinite(F.minX) ? { minX: +F.minX.toFixed(1), maxX: +F.maxX.toFixed(1), minZ: +F.minZ.toFixed(1), maxZ: +F.maxZ.toFixed(1), area: F.cells.size } : null,
      memBytes: S.meshes.reduce(function (a, m) { const g = m.geometry.attributes; return a + (g.position.array.byteLength + g.normal.array.byteLength + g.uv.array.byteLength + (g.color ? g.color.array.byteLength : 0)); }, 0)
        + S.pristine.reduce(function (a, p) { return a + p.byteLength; }, 0),
      drawCalls: S.meshes.length,
      // the bounded cut: which storeys were cut fine, what each half holds
      region: S.region.all ? "all" : (function () { const r = []; let a = -1; for (let s = 0; s <= S.ns + 1; s++) { const f = s <= S.ns && S.region.fine[s] === 1; if (f && a < 0) a = s; if (!f && a >= 0) { r.push(a + "-" + (s - 1)); a = -1; } } return r.join(","); })(),
      vertsFine: S.meshes.length ? S.chunks.reduce(function (a, c) { if (!c.rg || !fineLevel(S, c.s)) return a; for (let k = 2; k < c.rg.length; k += 3) a += c.rg[k]; return a; }, 0) : 0,
      vertsCoarse: S.meshes.length ? S.chunks.reduce(function (a, c) { if (!c.rg || fineLevel(S, c.s)) return a; for (let k = 2; k < c.rg.length; k += 3) a += c.rg[k]; return a; }, 0) : 0,
      livePanes: S.livePanes.length, liveInst: S.liveInst.length, srcTris: st.srcK || null, outTris: st.outK || null,
      liveTris: S.chunks.reduce(function (a, c) { return a + (c.lHid ? 0 : (c.ltris || 0)); }, 0), spans: S.spans.length, spansCut: S.spans.filter(function (sp) { return sp.done; }).length, liveWalls: S.liveWalls.size, liveKB: Math.round((S.liveBytes || 0) / 1024),
      outcome: st.maxTilt > 0.75 ? "topple" : st.pancaked >= 2 ? "pancake" : st.detached > 0 ? "partial" : st.crushed + st.blasted > 0 ? "holed" : "intact",
    };
  }
  C.stats = function (bld) {
    if (bld == null) {
      return { structures: structs.length, bodies: bodies.length, cuts: stats.cuts, tris: stats.tris, pieces: stats.pieces, bodiesMade: stats.bodiesMade,
        maxAwake: stats.maxAwake, awakeAvg: stats.frames ? +(stats.awakeSum / stats.frames).toFixed(2) : 0,
        msAvg: stats.frames ? +(stats.ms / stats.frames).toFixed(3) : 0, msMax: +stats.msMax.toFixed(2),
        carsCrushed: stats.carsCrushed, baked: stats.baked, shattered: stats.shattered, crushed: stats.crushed, blasted: stats.blasted,
        cap: BODY_CAP, device: DEVICE, capSettled: stats.capSettled, capShattered: stats.capShattered,
        drops: stats.drops, rewoken: stats.rewoken, refines: stats.refines || 0, liveMB: +(C.liveBytes() / 1048576).toFixed(1), dropping: droppers.length, baking: baking.length, kept: settled.length,
        prof: Object.keys(profT).reduce(function (o, k) { o[k] = { avg: +(profT[k].sum / Math.max(1, stats.frames)).toFixed(3), max: +profT[k].max.toFixed(1) }; return o; }, {}) };
    }
    const S = bld && bld.chunks ? bld : structFor(bld, false);
    if (S) return summary(S);
    const D = norm(bld);
    return D ? (finals.get(D.grp) || null) : null;
  };
  /* NOTHING IN THE AIR (the lab's probe): every settled body (kept rubble,
     waiting on its picture) whose hull is more than `gap` m above whatever
     could hold it (the ground, a stump, any collider but its own, a crushed
     car). Bodies still awake and bodies dropping are falling, not resting:
     they are counted apart. */
  C.unsupported = function (o) {
    const gap = (o && o.gap) || 0.5;
    const out = { kept: settled.length, air: 0, worst: 0, falling: bodies.length + droppers.length, list: [] };
    const check = function (B, own) {
      refreshCols(B, own);
      const d = gapUnder(B);
      if (d > gap) {
        out.air++; if (d > out.worst) out.worst = +d.toFixed(2);
        if (out.list.length < 12) out.list.push({ key: B.S.key, x: +B.pos.x.toFixed(1), y: +(B.pos.y + B.lo.y).toFixed(1), z: +B.pos.z.toFixed(1), gap: +d.toFixed(2), chunks: B.chunks.length });
      }
    };
    for (const e of settled) if (e.B.g.parent) check(e.B, new Set(e.rec.cols));
    for (const B of baking) check(B, null);
    return out;
  };
  /* CBZ.debrisAudit's `collapse` source: kept structural rubble hanging
     over nothing (C.unsupported), and the falling bodies' speed and height. */
  (CBZ.debrisAuditSources || (CBZ.debrisAuditSources = {})).collapse = function (o) {
    o = o || {};
    const u = C.unsupported({ gap: o.gap || 0.5 });
    const fastV = o.fast || 30, high = o.high || 120;
    const r = { floating: u.air, worstGap: u.worst, list: u.list.slice(0, 6), falling: u.falling, kept: u.kept,
      fast: 0, high: 0, maxSpeed: 0, maxHeight: 0 };
    for (const B of bodies) {
      const sp = B.v.length();
      if (sp > r.maxSpeed) r.maxSpeed = +sp.toFixed(1);
      if (sp > fastV) r.fast++;
      let g = 0;
      try { g = B.S.D.groundAt ? B.S.D.groundAt(B.pos.x, B.pos.z) : (CBZ.groundAt ? CBZ.groundAt(B.pos.x, B.pos.z) : 0); } catch (e) { g = 0; }
      const h = B.pos.y + (B.lo ? B.lo.y : 0) - (isFinite(g) ? g : 0);
      if (h > r.maxHeight) r.maxHeight = +h.toFixed(1);
      if (h > high) { r.high++; if (r.list.length < 8) r.list.push({ key: B.S.key, high: +h.toFixed(1), y: +B.pos.y.toFixed(1), g: +(+g).toFixed(1), v: +B.v.y.toFixed(1), t: +B.t.toFixed(1), contact: !!B.contact }); }
    }
    return r;
  };
  C.resetStats = function () { for (const k in stats) stats[k] = 0; for (const k in profT) delete profT[k]; };
  C._structs = structs; C._bodies = bodies;

  /* ============================================================
     10. THE DAMAGE SKIN — the stages BEFORE anything breaks off.

     A building that is hit and survives has to LOOK hit, progressively
     worse. The wound is the building's own wall, opened through the same
     carve every rocket uses (CBZ.cityCarveWall). On a building that has
     already been cut, that carve becomes chunk damage (section 8).
       stage 2 WOUNDED   the bays at the wound open
       stage 4 CRITICAL  the bays either side and the floor above go too
     ============================================================ */
  const skins = new Map();                      // key -> {key, stage, carved}

  C.skin = function (desc, stage, wound) {
    if (!CBZ.CONFIG.COLLAPSE_SKIN || !CBZ.CONFIG.COLLAPSE_V2) return null;
    const key = desc.key || (Math.round(desc.ox) + "," + Math.round(desc.oz));
    let rec = skins.get(key);
    if (!(stage > 0)) { if (rec) skins.delete(key); return null; }
    if (!rec) { rec = { key: key, stage: 0, carved: 0 }; skins.set(key, rec); }
    if (rec.stage === stage) return rec;
    rec.stage = stage;
    const at = desc.at;
    const want = stage >= 4 ? 4 : stage >= 2 ? 2 : 0;
    if (!at || !CBZ.cityCarveWall || want <= rec.carved) return rec;
    let nx = (wound && wound.nx) || 0, nz = (wound && wound.nz) || 0;
    const nl = Math.hypot(nx, nz);
    if (nl < 1e-3) return rec;
    nx /= nl; nz /= nl;
    const tx = -nz, tz = nx;                    // along the struck face
    const FH = desc.FH || 3.2;
    const bay = 3.4;
    // the hit itself has usually already carved its own bay (a breached wall
    // refuses a second carve), so the wound spreads to its neighbours
    const spots = [];
    if (rec.carved < 2) spots.push([0, 0], [bay, 0]);
    if (want >= 4) spots.push([-bay, 0], [bay * 2, 0], [0, FH], [bay, FH]);
    rec.carved = want;
    const fr = CBZ.cityFracture;
    for (const sp of spots) {
      // through the fracture ledger, so the wound persists and replays
      try {
        if (fr && fr.blastAt) fr.blastAt({ x: at.x + tx * sp[0], y: at.y + sp[1], z: at.z + tz * sp[0] }, { r: 1.3 });
        else CBZ.cityCarveWall(at.x + tx * sp[0], at.y + sp[1], at.z + tz * sp[0], 1.3);
      } catch (e) {}
    }
    return rec;
  };

  /* ---- C.gut — A STOREY BLOWN OUT --------------------------------------------
     city/structural.js calls this when a charge guts floors (the law's
     Z_GUT . W^(1/3) >= a room). For each gutted storey, every facade bay the
     gut sphere reaches is opened FLOOR TO CEILING through the same carve a
     rocket uses — the bay's own wall leaves as pieces of itself, the charred
     pocket stands behind, the ledger remembers it. Nearest bays first, capped
     per blast by quality so a Mk-84 costs a bounded number of openings.
       desc   { ox, oz, w, d, FH, key }
       floors [{ f, r }]  storey index + the gut radius at that storey's height
       at     the charge's seat
     Returns the vents [{x,y,z,nx,nz,f}] the fire plumes leave through. */
  const GUT_BAY = 3.2;
  C.gut = function (desc, floors, at, opts) {
    const fr = CBZ.cityFracture;
    if (!fr || !fr.blastAt || !floors || !floors.length) return [];
    const FH = desc.FH || 3.2, hw = (desc.w || 10) / 2, hd = (desc.d || 10) / 2;
    const cand = [];
    // the four faces: a point on the face line, its outward normal, its axis
    const faces = [
      { nx: 0, nz: -1, fx: 0, fz: -hd, horiz: true }, { nx: 0, nz: 1, fx: 0, fz: hd, horiz: true },
      { nx: -1, nz: 0, fx: -hw, fz: 0, horiz: false }, { nx: 1, nz: 0, fx: hw, fz: 0, horiz: false },
    ];
    for (const fl of floors) {
      for (const F of faces) {
        const px = desc.ox + F.fx, pz = desc.oz + F.fz;
        const off = F.horiz ? Math.abs(at.z - pz) : Math.abs(at.x - px);
        if (off > fl.r) continue;
        const half = Math.sqrt(fl.r * fl.r - off * off);
        const c = F.horiz ? at.x : at.z, lo0 = F.horiz ? desc.ox - hw : desc.oz - hd, hi0 = F.horiz ? desc.ox + hw : desc.oz + hd;
        const lo = Math.max(lo0 + 0.5, c - half), hi = Math.min(hi0 - 0.5, c + half);
        if (hi - lo < 1.0) continue;
        const n = Math.max(1, Math.round((hi - lo) / GUT_BAY));
        const bw = (hi - lo) / n;
        for (let i = 0; i < n; i++) {
          const u = lo + bw * (i + 0.5);
          const x = F.horiz ? u : px, z = F.horiz ? pz : u;
          cand.push({ x: x, z: z, f: fl.f, nx: F.nx, nz: F.nz, bw: bw, d: Math.hypot(x - at.x, z - at.z) + Math.abs(fl.f * FH + FH / 2 - at.y) });
        }
      }
    }
    cand.sort(function (a, b) { return a.d - b.d; });
    const cap = Math.round(qs(4, 10));
    const vents = [];
    for (let i = 0; i < cand.length && i < cap; i++) {
      const c = cand[i];
      const y0 = c.f * FH, yMid = y0 + FH * 0.5;
      try {
        // seat just inside the face so the carve resolves THIS wall, not a neighbour's
        fr.blastAt({ x: c.x - c.nx * 0.15, y: yMid, z: c.z - c.nz * 0.15 }, {
          r: Math.min(1.8, c.bw * 0.45), gapW: c.bw * 0.86, v0: y0 + 0.02, v1: y0 + FH - 0.02,
          storey: true, search: 1.2, byPlayer: !!(opts && opts.byPlayer),
        });
      } catch (e) {}
      vents.push({ x: c.x, y: yMid, z: c.z, nx: c.nx, nz: c.nz, f: c.f });
    }
    return vents;
  };

  C.skinClear = function (desc) {
    const key = (desc && desc.key) || (desc && (Math.round(desc.ox) + "," + Math.round(desc.oz)));
    return skins.delete(key);
  };
  C.skinCount = function () { return skins.size; };


  /* ============================================================
     11. RESET + DEBUG + AUDIT
     ============================================================ */
  function debrisStat(k) {
    try {
      const s = CBZ.debris ? CBZ.debris.stats() : null;
      if (!s) return 0;
      return k === "caps" ? s.caps.live : (s[k] || 0);
    } catch (e) { return 0; }
  }
  C.debug = function () {
    return {
      jobs: jobs.map(function (j) {
        const S = j.S;
        let lv = 0;
        if (!S.disposed) for (let s = 0; s <= S.ns; s++) if (S.levels[s].some(function (c) { return c.standing && c.tris; })) lv++;
        return {
          key: j.key, x: Math.round(S.ox), z: Math.round(S.oz),
          material: S.material, mode: j.mode.id, phase: j.phase, t: +j.t.toFixed(2),
          fall: +j.fall.toFixed(2), frac: j.phase === 1 ? +Math.min(1, 1 - S.standingMass / Math.max(1e-6, S.totalMass)).toFixed(3) : (j.phase > 1 ? 1 : 0),
          bands: S.ns + 1, standing: lv, bodies: bodies.filter(function (b) { return b.S === S; }).length,
        };
      }),
      structures: structs.map(summary),
      bodies: bodies.length,
      frags: debrisStat("live"), settled: debrisStat("static"),
      skins: skins.size, cap: debrisStat("caps"),
    };
  };

  C.reset = function () {
    for (const B of bodies.slice()) removeBody(B, false);
    for (const B of baking.concat(droppers)) { if (B.g.parent) B.g.parent.remove(B.g); B.g.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); }); }
    baking.length = 0; droppers.length = 0; settled.length = 0; watchI = 0;
    for (const S of structs.slice()) dispose(S, true);
    jobs.length = 0;
    work.length = 0; workHi.length = 0; workIdle.length = 0;
    holes.length = 0;
    crushedCars.length = 0;
    rubbleKeys.clear();
    if (CBZ.debris) owners.forEach(function (k) { try { CBZ.debris.clear(k); } catch (e) {} });
    owners.clear();
    skins.clear();
    dropScratch(); _step.length = 0;
  };

  /* THE RATCHET (Block Law rule 5). `hardcoded` is the number of registered
     facade grammars that have not declared what they are built of, and are
     therefore relying on this file's inference instead of on their author's
     knowledge. It only goes down. */
  /* liveAudit(building): is what the merged meshes draw of a cut building
     what its pieces say? Every run the cut took (dead), every run of a piece
     that has come away (gone) must be zero-area in the index the GPU draws;
     every run of a standing piece (up) its own indices. Reads the index
     buffers back (a tool's question, not a frame's). */
  C.liveAudit = function (bld) {
    const S = bld && bld.chunks ? bld : structFor(bld, false);
    if (!S) return null;
    const R = CBZ.renderer, gl = R && R.getContext && R.getContext(), M = self.__cbzGLAttr, K = M && gl && M.get(gl);
    const cur = new Map();
    const idxOf = function (mesh) {
      if (cur.has(mesh)) return cur.get(mesh);
      const ix = mesh.geometry && mesh.geometry.index;
      let a = ix && ix.array;
      if (!a && ix && K && K.get(ix)) {
        const b = K.get(ix), T = b.type === 5125 ? Uint32Array : b.type === 5123 ? Uint16Array : Uint8Array;
        a = new T(ix.count);
        gl.bindBuffer(gl.COPY_READ_BUFFER, b.buffer); gl.getBufferSubData(gl.COPY_READ_BUFFER, 0, a); gl.bindBuffer(gl.COPY_READ_BUFFER, null);
      }
      cur.set(mesh, a || null);
      return a || null;
    };
    const out = { sources: S.liveSrc.length, walls: S.liveWalls.size, spans: S.spans.length, spansCut: 0, dead: [0, 0], gone: [0, 0], up: [0, 0], unread: 0 };
    const check = function (L, a, b, want, slot) {
      const I = idxOf(L.mesh);
      if (!I) { out.unread++; return; }
      for (let k = a; k + 2 < b; k += 3) {
        const o = L.orig, i = k - L.ia;
        const degen = I[k] === I[k + 1] && I[k] === I[k + 2];
        const same = I[k] === o[i] && I[k + 1] === o[i + 1] && I[k + 2] === o[i + 2];
        if (want === "degen" ? degen : same) slot[0]++; else slot[1]++;
      }
    };
    for (const L of S.liveSrc) for (let r = 0; r < L.dead.length; r += 2) check(L, L.dead[r], L.dead[r + 1], "degen", out.dead);
    for (const c of S.chunks) if (c.lr) for (let r = 0; r < c.lr.length; r += 3) check(c.lr[r], c.lr[r + 1], c.lr[r + 2], c.lHid ? "degen" : "same", c.lHid ? out.gone : out.up);
    for (const sp of S.spans) if (sp.done) out.spansCut++;
    // what a piece's live triangles read back as lies in that piece, with
    // colours a material can show
    out.read = { chunks: 0, tris: 0, outside: 0, badColour: 0, noView: 0 };
    for (const L of S.liveSrc) if (!viewOf(S, L)) out.read.noView++;
    for (const c of S.chunks) {
      if (!c.lr || out.read.chunks >= 400) continue;
      const m = new Map();
      liveTris(S, c, m);
      out.read.chunks++;
      const g = c.gb;
      m.forEach(function (B) {
        for (let o = 0; o < B.n; o += ST) {
          const A = B.a;
          if (A[o] < g[0] - 0.05 || A[o] > g[1] + 0.05 || A[o + 1] < g[2] - 0.05 || A[o + 1] > g[3] + 0.05 || A[o + 2] < g[4] - 0.05 || A[o + 2] > g[5] + 0.05) out.read.outside++;
          if (A[o + 8] > 1.001 || A[o + 9] > 1.001 || A[o + 10] > 1.001 || A[o + 8] < 0) out.read.badColour++;
        }
        out.read.tris += B.n / ST / 3;
      });
    }
    return out;
  };
  C.audit = function () {
    const list = CBZ.facadeList ? CBZ.facadeList() : [];
    let undeclared = 0;
    const missing = [];
    for (const f of list) {
      const def = CBZ.facadeDef ? CBZ.facadeDef(f.id) : null;
      if (!def || !def.structure) { undeclared++; missing.push(f.id); }
    }
    return {
      facades: list.length, hardcoded: undeclared, missing: missing,
      modes: C.modeList(), materials: Object.keys(MATERIALS),
      live: jobs.length, frags: debrisStat("live"), skins: skins.size,
      structures: structs.length, bodies: bodies.length,
    };
  };
  CBZ.collapseAudit = C.audit;
})();
