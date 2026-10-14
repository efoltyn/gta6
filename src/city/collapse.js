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
  const SLICE_MS = PHONE ? 4 : 7;                      // cutting budget per frame
  const MAX_PARTS = PHONE ? 8 : 14;                    // level groups a falling cluster is drawn in
  const ST = 11;                                       // floats per vertex: pos3 nrm3 uv2 col3
  const BAND = 0.9;                                    // m inside a face plane that is that face's wall
  const SL = 0.3;                                      // storey cut sits this far under the floor
  const SLAB_T = 0.32;                                 // the floor plate (the cap a slab edge shows)
  const WT = 0.4;                                      // the wall solid (the cap a wall section shows)
  const YARD = 5;                                      // past this outside the footprint: the yard's, not the building's
  const TOL = 0.5;                                     // m a support may be penetrated in one step
  const TICK = 0.1;                                    // load path solve period (s)

  const structs = [];                                  // live structures (cut, standing or falling)
  const byGroup = new WeakMap();                       // building group -> structure
  const retired = new WeakMap();                       // group -> what a rebuild must restore
  const holes = [];                                    // undermined ground: {x, z, r, depth}
  const bodies = [];                                   // falling structural bodies
  const stats = { cuts: 0, cutMs: 0, tris: 0, pieces: 0, bodiesMade: 0, maxAwake: 0, awakeSum: 0, frames: 0,
    ms: 0, msMax: 0, carsCrushed: 0, baked: 0, shattered: 0, crushed: 0, blasted: 0 };

  // ---- growable float buffer -----------------------------------------------
  function Buf() { this.a = new Float32Array(ST * 48); this.n = 0; }
  Buf.prototype.need = function (k) {
    if (this.n + k <= this.a.length) return;
    let L = this.a.length * 2;
    while (L < this.n + k) L *= 2;
    const b = new Float32Array(L); b.set(this.a.subarray(0, this.n)); this.a = b;
  };

  // ---- which building, in what frame ---------------------------------------
  function arenaLots() { const A = CBZ.city && (CBZ.city.arena || CBZ.city); return (A && A.lots) || null; }
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

  function makeStruct(D) {
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
      levelLost: new Uint8Array(ns + 1), deadCols: [], deadPlats: [], newCols: [], newPlats: [],
      instHide: [], origCols: null, coreMat: null, topY: D.h,
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
  function gatherSources(S) {
    const D = S.D, grp = D.grp, out = [];
    const solids = new Set(D.solids || []);
    const bld = D.b;
    const skinnable = !!(bld && CBZ.citySkin && CBZ.cityIsShellMat);
    grp.updateWorldMatrix(true, true);
    grp.traverse(function (o) {
      if (!o.isMesh || o.isSkinnedMesh) return;
      if (o.userData && (o.userData.debrisPiece || o.userData.cbzCollapseShell)) return;
      if (!solids.has(o) && !visibleIn(o, grp.parent)) return;
      if (o._breached && !solids.has(o) && !o.visible) return;
      const geo = o.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      let any = false;
      for (const mm of mats) if (mm && mm.visible !== false && !(mm.transparent && mm.opacity < 0.05)) any = true;
      if (!any) return;
      if (o.isInstancedMesh) {
        const n = o.count, tri = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
        if (n * tri > 60000) return;
        for (let i = 0; i < n; i++) {
          o.getMatrixAt(i, _m4);
          const M = new THREE.Matrix4().multiplyMatrices(S.Linv, _m4b.multiplyMatrices(o.matrixWorld, _m4));
          out.push({ geo: geo, mat: o.material, M: M, glass: isGlass(mats[0]), col: o.instanceColor ? colorOf(o.instanceColor, i) : null });
        }
        return;
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
      out.push({ geo: geo, mat: mt, M: new THREE.Matrix4().multiplyMatrices(S.Linv, o.matrixWorld), glass: isGlass(mats[0]), col: null });
    });
    // the merged deco core/batch.js took out of the group (world space)
    const R = CBZ.batchRangesOf ? CBZ.batchRangesOf(grp) : null;
    if (R) for (const e of R) {
      if (!e || e.whole || e._stash || !e.mesh || (e.mesh._cbzRoom && !e.mesh._cbzRoom.built)) continue;
      const g = e.mesh.geometry;
      if (!g || !g.attributes || !g.attributes.position || e.mesh._cbzPacked) continue;
      out.push({ geo: g, mat: e.mesh.material, M: new THREE.Matrix4().multiplyMatrices(S.Linv, e.mesh.matrixWorld), glass: false, col: null, start: e.start, count: e.count });
    }
    // the panes (instanced pools, world records)
    const panes = [];
    for (const gp of D.panes || []) {
      if (!gp || gp.shattered || gp.mesh || !(gp.hw > 0) || !(gp.hh > 0)) continue;
      const pm = (gp.proxy && gp.proxy.material) || (gp.pool && gp.pool.material);
      if (!pm) continue;
      const M = new THREE.Matrix4().makeScale(gp.hw * 2, gp.hh * 2, Math.max(gp.hd || 0, 0.006) * 2).setPosition(gp.x, gp.y, gp.z);
      out.push({ geo: unitBox(), mat: pm, M: new THREE.Matrix4().multiplyMatrices(S.Linv, M), glass: true, col: null });
      panes.push(gp);
    }
    S.panes = panes;
    // the instanced trim / veneer pools on the city root (world coordinates,
    // owned by no group): every instance standing on this building is read
    // and, at the swap, hidden
    const hosts = new Set();
    if (grp.parent) hosts.add(grp.parent);
    if (CBZ.poolIdentityHost) { try { const h = CBZ.poolIdentityHost(grp); if (h) hosts.add(h); } catch (e) {} }
    const wc = new THREE.Vector3(D.ox, D.gy + D.h / 2, D.oz), wr = Math.hypot(D.w, D.d, D.h) / 2 + 3;
    hosts.forEach(function (host) {
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
          if (arr[o] === 0 && arr[o + 5] === 0 && arr[o + 10] === 0) continue;      // a hidden instance
          _v3.set(arr[o + 12], arr[o + 13], arr[o + 14]).applyMatrix4(S.Linv);
          if (!inFoot(S, _v3.x, _v3.y, _v3.z, 1.2)) continue;
          S.instHide.push({ im: im, i: i, m: arr.slice(o, o + 16) });
          if (lit || (glassPool && D.panes)) continue;                               // the panes come in through their records
          _m4.fromArray(arr, o);
          out.push({ geo: im.geometry.index ? null : im.geometry, ig: im.geometry, mat: im.instanceColor ? vcMat(im.material) : im.material,
            M: new THREE.Matrix4().multiplyMatrices(S.Linv, _m4), glass: glassPool, col: im.instanceColor ? colorOf(im.instanceColor, i) : null });
        }
      }
    });
    return out;
  }
  function colorOf(attr, i) { return [attr.getX(i), attr.getY(i), attr.getZ(i)]; }

  /* THE CUTTER. One triangle in (33 floats, building-local), clipped at every
     line it crosses, each piece filed into the chunk its centroid is in. */
  const EPS = 1e-4;
  function splitOf(S, a, b) {        // the first line strictly inside [a, b] on this axis (lines sorted)
    for (let i = 1; i < a.length - 1; i++) { const v = a[i]; if (v > b[0] + EPS && v < b[1] - EPS) return v; }
    return null;
  }
  function findSplit(S, P) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const v of P) {
      if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0];
      if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1];
      if (v[2] < z0) z0 = v[2]; if (v[2] > z1) z1 = v[2];
    }
    if (x1 - x0 > 0.02) { const x = splitOf(S, S.xs, [x0, x1]); if (x != null) return [0, x]; }
    if (z1 - z0 > 0.02) { const z = splitOf(S, S.zs, [z0, z1]); if (z != null) return [2, z]; }
    if (y1 - y0 > 0.02) {
      const k = Math.floor((y0 + SL) / S.FH) + 1;
      const Y = k * S.FH - SL;
      if (k >= 1 && k <= S.ns && Y > y0 + EPS && Y < y1 - EPS) return [1, Y];
    }
    return null;
  }
  function lerpV(a, b, t) {
    const o = new Float32Array(ST);
    for (let k = 0; k < ST; k++) o[k] = a[k] + (b[k] - a[k]) * t;
    return o;
  }
  function clipEmit(S, P, mat, glass, depth) {
    const sp = depth < 12 ? findSplit(S, P) : null;
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
  function emitPoly(S, P, mat, glass) {
    let cx = 0, cy = 0, cz = 0;
    for (const v of P) { cx += v[0]; cy += v[1]; cz += v[2]; }
    cx /= P.length; cy /= P.length; cz /= P.length;
    const c = chunkAt(S, cx, cy, cz);
    if (!c) return;
    if (!c.bufs) c.bufs = new Map();
    let B = c.bufs.get(mat);
    if (!B) { B = new Buf(); c.bufs.set(mat, B); }
    const out = c.kind === 0 ? outN(S, c.f) : null;
    for (let i = 1; i + 1 < P.length; i++) {
      const a = P[0], b = P[i], d = P[i + 1];
      // area + face normal (the solidity a wall panel shows its street)
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ar2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (ar2 < 1e-7) continue;
      if (out) {
        const dn = (nx * out[0] + nz * out[2]) / ar2;
        if (glass) c.glA += ar2 * 0.5 * Math.abs(dn);
        else if (dn > 0.6) c.opA += ar2 * 0.5;
      }
      B.need(ST * 3);
      const A = B.a;
      for (const v of [a, b, d]) {
        const o = B.n;
        for (let k = 0; k < ST; k++) A[o + k] = v[k];
        const l = Math.hypot(v[3], v[4], v[5]) || 1;
        A[o + 3] /= l; A[o + 4] /= l; A[o + 5] /= l;
        B.n += ST;
        if (!c.gb) c.gb = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
        const g = c.gb;
        if (v[0] < g[0]) g[0] = v[0]; if (v[0] > g[1]) g[1] = v[0];
        if (v[1] < g[2]) g[2] = v[1]; if (v[1] > g[3]) g[3] = v[1];
        if (v[2] < g[4]) g[4] = v[2]; if (v[2] > g[5]) g[5] = v[2];
      }
      c.tris++;
    }
    if (cy > S.topY) S.topY = cy;
  }
  const OUTN = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  function outN(S, f) { return OUTN[f]; }

  /* The generator: every source's triangles through the cutter, yielding to
     the frame every ~1500 triangles. */
  function* cutGen(S) {
    const t0 = performance.now();
    let srcs;
    try { srcs = gatherSources(S); } catch (e) { console.warn("[collapse] gather", e); srcs = []; }
    S.cutGatherMs = performance.now() - t0;
    yield;
    const nm = new THREE.Matrix3();
    let n = 0;
    // one scratch triangle, three views on it: the common case (a triangle
    // inside one cell) allocates nothing; only a triangle that is actually
    // clipped makes new vertices
    const V = new Float32Array(ST * 3);
    const P = [V.subarray(0, ST), V.subarray(ST, ST * 2), V.subarray(ST * 2, ST * 3)];
    for (const src of srcs) {
      const geo = src.geo || src.ig;
      if (!geo) continue;
      const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv, col = geo.attributes.color;
      const idx = geo.index;
      const M = src.M, e = M.elements;
      nm.getNormalMatrix(M);
      const q = nm.elements;
      const mats = Array.isArray(src.mat) ? src.mat : null;
      const total = idx ? idx.count : pos.count;
      const runs = (mats && geo.groups && geo.groups.length)
        ? geo.groups.map(function (g) { return [g.start, Math.min(total, g.start + g.count), mats[g.materialIndex || 0]]; })
        : [[src.start != null ? src.start : 0, src.count != null ? src.start + src.count : total, mats ? mats[0] : src.mat]];
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
            else if (col) { v[8] = col.getX(i); v[9] = col.getY(i); v[10] = col.getZ(i); }
            else { v[8] = 1; v[9] = 1; v[10] = 1; }
            if (!isFinite(v[0] + v[1] + v[2])) bad = true;
          }
          if (bad) continue;
          clipEmit(S, P, mt, glass, 0);
          if ((++n & 2047) === 0) yield;
        }
      }
    }
    S.stats.tris = n;
    finishCut(S);
    S.stats.cutMs = Math.round(performance.now() - t0);
    stats.cuts++; stats.tris += n;
  }

  /* ---- after the cut: weights, the load graph, the design, the caps, the
     standing meshes ------------------------------------------------------ */
  function finishCut(S) {
    const ns = S.ns, FH = S.FH, m = S.m;
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
    // THE DESIGN: intact loads, then capacity = safety factor x load. The
    // factor drops on a storey that is mostly glass: the soft storey.
    loads(S, true);
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
      S.totalMass += c.mass;
    }
    S.standingMass = S.totalMass; S.standingCount = S.chunks.length;
    S.standingReal = S.chunks.filter(function (c) { return c.tris > 0; }).length;
    S.stats.chunks = S.chunks.filter(function (c) { return c.tris > 0; }).length;
    // the cut faces
    S.coreMat = mat(mix(shade(S.D.wall, m.tone), 0x8d8a84, 0.4));
    for (const c of S.chunks) if (c.tris) addCaps(S, c);
    buildStanding(S);
    S.ready = true;
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
  function buildStanding(S) {
    const per = Math.max(1, Math.ceil((S.ns + 1) / BANDS));
    const root = new THREE.Group();
    root.name = "collapseStanding";
    root.userData.cbzCollapseShell = S.key;
    root.position.set(S.ox, S.gy, S.oz); root.rotation.y = S.yaw;
    root.updateMatrix(); root.updateMatrixWorld(true);
    for (let b0 = 0; b0 <= S.ns; b0 += per) {
      const byMat = new Map();
      for (let s = b0; s < Math.min(S.ns + 1, b0 + per); s++) {
        for (const c of S.levels[s]) {
          if (!c.bufs) continue;
          c.bufs.forEach(function (B, mt) {
            if (!B.n) return;
            let L = byMat.get(mt); if (!L) { L = []; byMat.set(mt, L); }
            L.push([c, B]);
          });
        }
      }
      byMat.forEach(function (L, mt) {
        let nv = 0;
        for (const it of L) nv += it[1].n / ST;
        const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), Cc = new Float32Array(nv * 3);
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
            Cc[o * 3] = A[s + 8]; Cc[o * 3 + 1] = A[s + 9]; Cc[o * 3 + 2] = A[s + 10];
          }
        }
        const g = new THREE.BufferGeometry();
        const pa = new THREE.BufferAttribute(P, 3);
        pa.setUsage(THREE.DynamicDrawUsage);
        g.setAttribute("position", pa);
        g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
        g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
        g.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, mt);
        mesh.castShadow = !PHONE; mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.name = "collapseBand";
        root.add(mesh);
        S.meshes.push(mesh);
        S.pristine.push(P.slice());
      });
    }
    for (const c of S.chunks) c.bufs = null;
    S.root = root;
  }

  /* A set of chunks' own geometry, building-local minus `off`, one geometry
     per material. */
  function geoOf(S, list, off) {
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
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), Cc = new Float32Array(nv * 3);
      let o = 0;
      for (let k = 0; k < L.length; k += 3) {
        const mi = L[k], st = L[k + 1], n = L[k + 2];
        const src = S.meshes[mi].geometry.attributes, pp = S.pristine[mi];
        const nn = src.normal.array, uu = src.uv.array, cc = src.color.array;
        for (let v = 0; v < n; v++, o++) {
          const s = st + v;
          P[o * 3] = pp[s * 3] - off.x; P[o * 3 + 1] = pp[s * 3 + 1] - off.y; P[o * 3 + 2] = pp[s * 3 + 2] - off.z;
          N[o * 3] = nn[s * 3]; N[o * 3 + 1] = nn[s * 3 + 1]; N[o * 3 + 2] = nn[s * 3 + 2];
          U[o * 2] = uu[s * 2]; U[o * 2 + 1] = uu[s * 2 + 1];
          Cc[o * 3] = cc[s * 3]; Cc[o * 3 + 1] = cc[s * 3 + 1]; Cc[o * 3 + 2] = cc[s * 3 + 2];
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(P, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      g.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
      g.computeBoundingSphere();
      out.push(new THREE.Mesh(g, mt));
    });
    return out;
  }

  /* ---- THE SWAP: the real building out, its chunks in, on one frame ------- */
  function swap(S) {
    if (S.swapped || !S.ready) return;
    S.swapped = true;
    S.stats.born = nowT;
    const D = S.D, grp = S.grp;
    (D.root || CBZ.scene).add(S.root);
    try { if (CBZ.batchHideGroup) CBZ.batchHideGroup(grp); } catch (e) {}
    grp.visible = false;
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
      for (const c of list) {
        if (!c || c._cbzS) continue;
        c._cbzS = S;
        c._cbzCh = chunksOverlapping(S, c.minX, c.maxX, c.y0 != null ? c.y0 : -1e9, c.y1 != null ? c.y1 : 1e9, c.minZ, c.maxZ);
        for (const ch of c._cbzCh) (ch.origCols || (ch.origCols = [])).push(c);
        S.origCols.push(c);
      }
      for (const p of b.platforms || []) {
        if (!p || p._cbzS) continue;
        p._cbzS = S;
        p._cbzCh = chunksOverlapping(S, p.minX, p.maxX, p.top - 0.05, p.top - 0.05, p.minZ, p.maxZ);
        for (const ch of p._cbzCh) (ch.origPlats || (ch.origPlats = [])).push(p);
      }
    }
    wrapCarve();
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
    c.standing = false;
    S.standingCount--; S.standingMass -= c.mass;
    if (c.tris) S.standingReal--;
    S.levelLost[c.s] = 1;
    S.active = Math.max(S.active, 3);
    if (!keepDrawn) hideChunk(S, c);
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
    if (S.b && S.b.doors) for (const dr of S.b.doors) if (dr && dr.col && dr.col._cbzGone && !dr.demolished) { dr.demolished = true; dr.colIn = false; }
    if (!S.losGone && S.b && S.b.losMeshes) { S.losGone = true; S.deadLos = S.b.losMeshes.slice(); }
  }
  function hideChunk(S, c) {
    if (c.hidden || S.disposed) return;
    c.hidden = true;
    const rg = c.rg;
    if (rg) for (let k = 0; k < rg.length; k += 3) {
      const mesh = S.meshes[rg[k]];
      if (!mesh) continue;
      mesh.geometry.attributes.position.array.fill(0, rg[k + 1] * 3, (rg[k + 1] + rg[k + 2]) * 3);
      S.dirty.add(mesh);
    }
  }
  function flushWorld(S) {
    if (S.deadCols.length || S.deadPlats.length || S.deadLos) {
      const cols = new Set(S.deadCols), plats = new Set(S.deadPlats), los = new Set(S.deadLos || []);
      S.deadCols.length = 0; S.deadPlats.length = 0; S.deadLos = null;
      try {
        if (CBZ.structuralTakeOut) CBZ.structuralTakeOut(cols, plats, los);
        else {
          if (cols.size) {
            if (CBZ.colliderRemoveMany) CBZ.colliderRemoveMany(Array.from(cols));
            else if (CBZ.micro && CBZ.micro.removeCollider) cols.forEach(function (c) { CBZ.micro.removeCollider(c); });
          }
          if (plats.size && CBZ.platforms) { const a = CBZ.platforms; let w = 0; for (let i = 0; i < a.length; i++) if (!plats.has(a[i])) a[w++] = a[i]; a.length = w; }
          if (los.size && CBZ.losBlockers) { const a = CBZ.losBlockers; let w = 0; for (let i = 0; i < a.length; i++) if (!los.has(a[i])) a[w++] = a[i]; a.length = w; }
          if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
        }
      } catch (e) {}
      if (plats.size && CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    }
    if (S.newCols.length) {
      for (const c of S.newCols) { try { if (CBZ.colliderAdd) CBZ.colliderAdd(c); else if (CBZ.colliders) CBZ.colliders.push(c); } catch (e) {} }
      S.newCols.length = 0;
    }
    if (S.newPlats.length && CBZ.platforms) {
      for (const p of S.newPlats) CBZ.platforms.push(p);
      S.newPlats.length = 0;
      if (CBZ.markPlatformsDirty) CBZ.markPlatformsDirty();
    }
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
        else for (const b of c.below) if (b.standing && b.held) { c.direct = true; break; }
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
  let markId = 1;
  function detach(S, list, tipped) {
    const id = ++markId;
    for (const c of list) c.mark = id;
    const comps = [];
    for (const c of list) {
      if (c.mark !== id) continue;
      const comp = [];
      const st = [c]; c.mark = -id;
      while (st.length) {
        const a = st.pop(); comp.push(a);
        const nb = a.below.concat(a.above, a.lat);
        for (const n of nb) if (n.mark === id) { n.mark = -id; st.push(n); }
      }
      comps.push(comp);
    }
    comps.sort(function (a, b) { return b.length - a.length; });
    for (const comp of comps) {
      for (const c of comp) leave(S, c, true);
      S.stats.detached += comp.length;
      // a lone empty cell (air, a room with nothing in it) has nothing to show
      const real = comp.filter(function (c) { return c.tris > 0; });
      if (!real.length) continue;
      if (awake() >= BODY_CAP && real.length <= 2) { for (const c of real) queueShatter(S, c, null, 0.6); continue; }
      const B = makeBody(S, comp, null);
      if (B && tipped) B.tip = true;
      if (!B) for (const c of comp) hideChunk(S, c);
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
    const job = function () {
      if (S.disposed || c.hidden) return;
      hideChunk(S, c);
      shatterStanding(S, c, dir, power);
    };
    // a blast's own chunks go at the head of the queue: they are what the
    // player is looking at the moment the charge goes off
    if (first) work.unshift(job); else work.push(job);
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
      const n = Math.max(3, Math.min(Math.min(room - 2, PHONE ? 8 : 16), Math.round(2 + (mass || 2) * 1.1 * S.m.frag)));
      let r = null;
      try {
        r = D.shatter(g, {
          at: at, dir: dir || null, power: Math.max(0.4, Math.min(2.2, power || 0.6)),
          speed: 2.2 * S.m.spread, velocity: vel || null, maxPieces: n, owner: S.key, solid: true,
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
  const work = [];
  const WORK_MS = PHONE ? 3 : TABLET ? 4 : 6;
  function runWork(budget) {
    const t0 = performance.now();
    let n = 0;
    while (work.length && (n === 0 || performance.now() - t0 < budget)) {
      const f = work.shift();
      try { f(); } catch (e) { console.warn("[collapse] work", e); }
      n++;
    }
  }
  // a part's picture: its chunks' own geometry about its body's centre
  function buildPart(p) {
    if (p.meshes) return;
    const B = p.body, S = p.S;
    if (!B || B.dead || S.disposed) { for (const c of p.chunks) hideChunk(S, c); p.meshes = []; return; }
    p.meshes = geoOf(S, p.chunks.filter(function (c) { return c.tris; }), B.com);
    for (const ms of p.meshes) { ms.castShadow = !PHONE; ms.receiveShadow = true; B.g.add(ms); }
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
        if (!was) work.push(buildPart.bind(null, p));
      }
    }
    // the first part (the one at the bottom, the one that lands) is made now
    if (!handed && parts[0] && !parts[0].meshes) buildPart(parts[0]);
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
  const _sup = { h: 0, src: 0, ch: null, lat: false, nx: 0, nz: 0, depth: 0 };
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
        _sup.lat = true; _sup.depth = mn; _sup.ch = c;
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
  const CC = new Array(16);
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
    B.ownC.length = 0;
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
        if (vn < 0 && nC < 16) { CP[nC * 4] = rx; CP[nC * 4 + 1] = ry; CP[nC * 4 + 2] = rz; CP[nC * 4 + 3] = 0; CS[nC] = 2; CC[nC] = sp.nx * 10 + sp.nz; nC++; if (-vn > hardest) hardest = -vn; neighbourHit(B, sp.ch, wx, wy, wz, -vn); }
      }
      const d = sp.h - wy;
      if (d > -0.02 && nC < 16) {
        const vy = v.y + (w.z * rx - w.x * rz);
        CP[nC * 4] = rx; CP[nC * 4 + 1] = ry; CP[nC * 4 + 2] = rz; CP[nC * 4 + 3] = d;
        CS[nC] = sp.src === 1 ? 1 : 0; CC[nC] = sp.ch;
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
    let skipOwn = false;
    if (crushSet.length && nowT - B.lastCrush > 0.04) {
      B.lastCrush = nowT;
      skipOwn = crushStorey(B, crushSet, ownHard);
    }
    B.contact = nC > 0;
    if (nC) {
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
    for (const p of B.parts) if (!p.meshes && p.body === B) { for (const c of p.chunks) hideChunk(B.S, c); p.meshes = []; }
  }
  function buildAll(B) { for (const p of B.parts) if (!p.meshes) buildPart(p); }
  // settle: the body becomes static rubble where it lies
  /* SETTLE: the body is rubble where it lies. It is KEPT as it is (debris.js
     keep: no copy into a rubble bucket, no re-merge of the cell around it),
     solid through colliders fitted to its own chunks, and its meshes are
     merged per material later, from the work queue. */
  function bake(B) {
    const S = B.S;
    buildAll(B);
    const i0 = bodies.indexOf(B);
    if (i0 >= 0) bodies.splice(i0, 1);
    B.dead = true;
    B.g.position.copy(B.pos); B.g.quaternion.copy(B.q);
    B.g.updateMatrixWorld(true);
    footprint(S, B);
    S.stats.baked++; stats.baked++;
    rubbleKeys.add(S.key);
    S.stats.lastSettle = nowT - S.stats.born;
    const D = CBZ.debris;
    if (D && D.keep) {
      try { D.keep(B.g, { owner: S.key, cols: bodyCols(B) }); } catch (e) { console.warn("[collapse] keep", e); }
      if (B.g.children.length > 3) work.push(function () { mergeKept(B.g); });
    } else if (B.g.parent) { B.g.parent.remove(B.g); B.g.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); }); }
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
        // a tilted piece's bounds overstate it sideways: keep the core of them
        const sx = (b - a) * 0.12, sz = (c1 - c0) * 0.12;
        out.push({ minX: a + sx, maxX: b - sx, minZ: c0 + sz, maxZ: c1 - sz, y0: lo, y1: lo + (hi - lo) * 0.85 });
      }
    }
    return out;
  }
  // a kept body drawn as one mesh per material (its parts' meshes merged)
  function mergeKept(g) {
    if (!g.parent) return;
    const byMat = new Map();
    for (const ms of g.children) {
      if (!ms.isMesh) continue;
      let L = byMat.get(ms.material); if (!L) { L = []; byMat.set(ms.material, L); }
      L.push(ms);
    }
    const n3 = new THREE.Matrix3();
    byMat.forEach(function (L, mt) {
      if (L.length < 2) return;
      let nv = 0;
      for (const ms of L) nv += ms.geometry.attributes.position.count;
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), Cc = new Float32Array(nv * 3);
      let o = 0;
      for (const ms of L) {
        ms.updateMatrix();
        const e = ms.matrix.elements, A = ms.geometry.attributes;
        n3.getNormalMatrix(ms.matrix);
        const q = n3.elements;
        const pa = A.position.array, na = A.normal.array, ua = A.uv.array, ca = A.color.array;
        for (let i = 0; i < A.position.count; i++, o++) {
          const x = pa[i * 3], y = pa[i * 3 + 1], z = pa[i * 3 + 2];
          P[o * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
          P[o * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          P[o * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          const a = na[i * 3], b2 = na[i * 3 + 1], c = na[i * 3 + 2];
          N[o * 3] = q[0] * a + q[3] * b2 + q[6] * c; N[o * 3 + 1] = q[1] * a + q[4] * b2 + q[7] * c; N[o * 3 + 2] = q[2] * a + q[5] * b2 + q[8] * c;
          U[o * 2] = ua[i * 2]; U[o * 2 + 1] = ua[i * 2 + 1];
          Cc[o * 3] = ca[i * 3]; Cc[o * 3 + 1] = ca[i * 3 + 1]; Cc[o * 3 + 2] = ca[i * 3 + 2];
        }
        g.remove(ms);
        ms.geometry.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      geo.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mt);
      m.matrixAutoUpdate = false;
      m.userData.debrisRubble = true;
      m.castShadow = !PHONE; m.receiveShadow = true;
      g.add(m);
    });
    g.updateMatrixWorld(true);
  }
  function footprint(S, B) {
    const F = S.stats.foot, a = B.aabb;
    if (!a) return;
    F.minX = Math.min(F.minX, a[0]); F.maxX = Math.max(F.maxX, a[1]); F.minZ = Math.min(F.minZ, a[3]); F.maxZ = Math.max(F.maxZ, a[4]);
    // area actually covered, on a 1 m grid, from the body's oriented box
    const R = new THREE.Matrix4().makeRotationFromQuaternion(B.q);
    const lo = B.lo, hi = B.hi;
    const stepX = Math.max(0.5, (hi.x - lo.x) / 24), stepZ = Math.max(0.5, (hi.z - lo.z) / 24), stepY = Math.max(0.5, (hi.y - lo.y) / 24);
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
    const room = Math.max(0, BODY_CAP - bodies.length + 1);
    if (B.parts.length > 1) {
      const nSeg = Math.min(room, Math.min(6, Math.ceil(B.parts.length / 2)));
      if (nSeg < 2) { bake(B); return; }
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
        else for (const p of ps) { if (p.meshes) for (const ms of p.meshes) ms.geometry.dispose(); else for (const c of p.chunks) hideChunk(S, c); }
      }
      return;
    }
    const real = B.chunks.filter(function (c) { return c.tris > 0; });
    if (real.length > 1) {
      // into groups of neighbouring chunks, as many as the budget allows
      const n = Math.max(1, Math.min(real.length, room, PHONE ? 6 : 12));
      if (n < 2) { bake(B); return; }
      real.sort(function (a, b) { return (a.kind - b.kind) || (a.f - b.f) || (a.j - b.j) || (a.ix - b.ix) || (a.iz - b.iz); });
      const per = Math.ceil(real.length / n);
      buildAll(B);
      // the old body stays on screen, frozen, until its pieces are drawn
      const i0 = bodies.indexOf(B);
      if (i0 >= 0) bodies.splice(i0, 1);
      B.dead = true;
      B.g.position.copy(B.pos); B.g.quaternion.copy(B.q);
      const ghost = { g: B.g, n: 0, done: false };
      for (let i = 0; i < real.length; i += per) {
        const nb = makeBody(S, real.slice(i, i + per), B, null, ghost);
        if (nb) { nb.hard = 0; nb.split = (B.split || 0) + 1; }
      }
      if (ghost.n <= 0) dropGhost(ghost);
      return;
    }
    // one chunk, hard landing: pieces of itself
    const c = real[0];
    if (!c) { removeBody(B, false); return; }
    const at = B.pos.clone();
    footprint(S, B);
    buildAll(B);
    const i0 = bodies.indexOf(B);
    if (i0 >= 0) bodies.splice(i0, 1);
    B.dead = true;
    B.g.position.copy(B.pos); B.g.quaternion.copy(B.q);
    const vel = B.v.clone().multiplyScalar(0.4);
    work.push(function () {
      // the meshes keep their offsets inside the body group: shatter the group
      if (B.g.parent) B.g.parent.remove(B.g);
      B.g.updateMatrix();
      shatterMeshes(S, B.g.children.slice(), B.g.matrix, at, null, 0.5, vel, c.mass, B.g);
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
    const vel = B.v.clone().multiplyScalar(0.3), pm = p.mass;
    work.push(function () {
      if (hold.parent) hold.parent.remove(hold);
      shatterMeshes(S, hold.children.slice(), hold.matrix, at, null, 0.5, vel, pm, hold);
    });
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

  function stepBodies(dt) {
    if (!bodies.length) return;
    const sub = Math.max(1, Math.min(4, Math.ceil(dt / (1 / 90))));
    const h = dt / sub;
    for (let i = bodies.length - 1; i >= 0; i--) {
      const B = bodies[i];
      if (!B || B.dead) continue;
      B.hard = 0;
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
        for (const c of B.ownC) { c.ext = share; c.extT = nowT; c.S.active = Math.max(c.S.active, 1); }
      }
      crushCars(B);
      const S = B.S, m = S.m;
      // a hard landing on anything that is not its own stump breaks it
      const multi = B.parts.length > 1 || B.chunks.length > 1;
      const brk = multi ? m.breakV : m.shatterV;
      if (B.hard > brk && B.t > 0.05) {
        if (B.mass > 3) crushPeople(B, B.pos.x, B.pos.z, Math.max(2, B.radius * 0.7));
        if (B.parts.length > 1 && B.mass > 40) pall(S, B.pos.x, B.pos.y + B.lo.y, B.pos.z, Math.min(2.5, 0.8 + B.hard * 0.1), B.radius * 0.6);
        if (multi || B.hard > m.shatterV) { split(B); continue; }
      }
      // a toppling mass that has gone over and is touching down comes apart as it lands
      if (B.parts.length > 1 && B.contact && B.tilt > 0.62) { split(B); continue; }
      if (B.calm > 0.5 || B.t > 30) { bake(B); continue; }
      if (B.pos.y < -120) removeBody(B, false);
    }
  }

  /* ============================================================
     6. THE API.
     ============================================================ */
  function structFor(x, start) {
    const D = norm(x);
    if (!D || typeof THREE === "undefined") return null;
    let S = byGroup.get(D.grp);
    if (S && !S.disposed) return S;
    if (!start) return null;
    S = makeStruct(D);
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
      } catch (e) { console.warn("[collapse] cut failed", e); S.gen = null; S.failed = true; }
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
    const S = bld && bld.chunks ? bld : structFor(bld, true);
    if (!S || S.failed) return null;
    const req = { k: "dmg", p: { x: point.x, y: point.y, z: point.z }, r: radius, e: energy, dir: dir || null, o: opts, bld: bld };
    if (!S.ready || S.pending.length) { S.pending.push(req); return { queued: true, key: S.key }; }
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
  function applyUndermine(S, R, o) {
    swap(S);
    let n = 0;
    for (const c of S.levels[0]) {
      if (!c.standing || c.undermined) continue;
      const w = new THREE.Vector3(c.cx, 0, c.cz).applyMatrix4(S.L);
      if (!inRegion(R, w.x, w.z)) continue;
      c.undermined = true; n++;
    }
    if (o && o.depth > 0) holes.push(Object.assign({ y: S.gy, depth: +o.depth }, R));
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
    if (S) dispose(S, true);
    rubbleKeys.delete(D.key);
    const R = retired.get(D.grp);
    if (R) {
      const touched = new Set();
      for (const r of R.inst) { r.im.instanceMatrix.array.set(r.m, r.i * 16); touched.add(r.im); }
      touched.forEach(function (im) { im.instanceMatrix.needsUpdate = true; });
      retired.delete(D.grp);
    }
    return true;
  };
  const finals = new WeakMap();           // group -> the last summary of a structure that is gone
  function dispose(S, forRebuild) {
    if (S.disposed) return;
    try { finals.set(S.grp, summary(S)); } catch (e) {}
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
    flushWorld(S);
    if (S.root) {
      if (S.root.parent) S.root.parent.remove(S.root);
      for (const ms of S.meshes) ms.geometry.dispose();
    }
    S.meshes.length = 0; S.pristine.length = 0;
    if (S.swapped && S.instHide.length && !forRebuild) retired.set(S.grp, { inst: S.instHide });
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
        if ((standing < 0.02 && !mine) || job.t > 30) {
          // anything still standing (or still moving) settles where it is
          for (const b of bodies.slice()) if (b.S === S) bake(b);
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
    if (!structs.length && !bodies.length && !jobs.length && !work.length) return;
    const t0 = performance.now();
    dt = Math.min(dt, 0.1);
    nowT += dt;
    runCuts(SLICE_MS);
    let ta = performance.now(); prof("cut", ta - t0);
    for (let i = structs.length - 1; i >= 0; i--) {
      const S = structs[i];
      if (!S.ready) continue;
      while (S.pending.length) { const q = S.pending.shift(); try { applyReq(S, q); } catch (e) { console.warn("[collapse] request", e); } }
      if (!S.swapped) continue;
      S.tick += dt;
      if (S.active > 0 && S.tick >= TICK) {
        S.tick = 0;
        let changed = 0;
        try { changed = solve(S); } catch (e) { console.warn("[collapse] solve", e); }
        if (!changed && !S.condemned) S.active -= TICK;
      }
      flushWorld(S);
      { const tb = performance.now(); prof("solve", tb - ta); ta = tb; }
      // a building nothing is left of, with nothing falling, is done
      if (S.standingReal <= 0 && !S.job && !bodies.some(function (b) { return b.S === S; })) dispose(S, false);
    }
    ta = performance.now();
    stepBodies(dt);
    { const tb = performance.now(); prof("bodies", tb - ta); ta = tb; }
    runWork(WORK_MS);
    { const tb = performance.now(); prof("work", tb - ta); ta = tb; }
    stepJobs(dt);
    for (const S of structs) flushWorld(S);
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
      memBytes: S.meshes.reduce(function (a, m) { const g = m.geometry.attributes; return a + (g.position.array.byteLength + g.normal.array.byteLength + g.uv.array.byteLength + g.color.array.byteLength); }, 0)
        + S.pristine.reduce(function (a, p) { return a + p.byteLength; }, 0),
      drawCalls: S.meshes.length,
      outcome: st.maxTilt > 0.75 ? "topple" : st.pancaked >= 2 ? "pancake" : st.detached > 0 ? "partial" : st.crushed + st.blasted > 0 ? "holed" : "intact",
    };
  }
  C.stats = function (bld) {
    if (bld == null) {
      return { structures: structs.length, bodies: bodies.length, cuts: stats.cuts, tris: stats.tris, pieces: stats.pieces, bodiesMade: stats.bodiesMade,
        maxAwake: stats.maxAwake, awakeAvg: stats.frames ? +(stats.awakeSum / stats.frames).toFixed(2) : 0,
        msAvg: stats.frames ? +(stats.ms / stats.frames).toFixed(3) : 0, msMax: +stats.msMax.toFixed(2),
        carsCrushed: stats.carsCrushed, baked: stats.baked, shattered: stats.shattered, crushed: stats.crushed, blasted: stats.blasted,
        cap: BODY_CAP, device: DEVICE,
        prof: Object.keys(profT).reduce(function (o, k) { o[k] = { avg: +(profT[k].sum / Math.max(1, stats.frames)).toFixed(3), max: +profT[k].max.toFixed(1) }; return o; }, {}) };
    }
    const S = bld && bld.chunks ? bld : structFor(bld, false);
    if (S) return summary(S);
    const D = norm(bld);
    return D ? (finals.get(D.grp) || null) : null;
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
    for (const S of structs.slice()) dispose(S, true);
    jobs.length = 0;
    work.length = 0;
    holes.length = 0;
    crushedCars.length = 0;
    rubbleKeys.clear();
    if (CBZ.debris) owners.forEach(function (k) { try { CBZ.debris.clear(k); } catch (e) {} });
    owners.clear();
    skins.clear();
  };

  /* THE RATCHET (Block Law rule 5). `hardcoded` is the number of registered
     facade grammars that have not declared what they are built of, and are
     therefore relying on this file's inference instead of on their author's
     knowledge. It only goes down. */
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
