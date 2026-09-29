/* ============================================================
   city/collapse.js — THE COLLAPSE ENGINE. One shared, data-driven answer to
   "what does a building LOOK LIKE while it is being destroyed", used by the
   city ledger (city/structural.js), the disaster island (systems/disasters.js)
   and anything else that condemns a structure.

   OWNER BRIEF (verbatim): "buildings with facades in nat disaster and buildings
   in gang city — all buildings when hit with plane in gang city or earthquake
   in nat disaster or rpg or airstrike — they need an animation of collapsing
   that is much more real. The RPG explosion is amazing because it looks real
   but the effect of the rpg on buildings isn't real yet … all stages of
   destruction, and don't hardcode this shit, make it better coded."

   ------------------------------------------------------------------
   THE THREE THINGS THAT WERE WRONG
   ------------------------------------------------------------------
   1. THE SWAP WAS VISIBLE. city/structural.js hid a dressed, windowed,
      facade-clad tower and put EIGHT FLAT GREY BOXES in its place. The
      collapse was choreographed well and still read as fake, because the
      thing that fell was not the thing that was standing. The shell here IS
      the building: its own walls, slabs, facade and glass, cut into storey
      bands at the swap (section 3), so the frame the swap happens on is the
      frame nobody can see.
   2. NOTHING BROKE. Every mode of destruction was the same downward SCALE.
      A building that shrinks is a building that is being deleted. Real
      collapse is DISINTEGRATION: the floor the front passes stops existing
      and becomes several hundred kilos of slab travelling outward. So every
      band the front consumes is broken into pieces OF ITSELF (its own
      geometry, material and paint, via CBZ.debris) that tumble as rigid
      bodies, pile on each other and freeze into the rubble.
   3. ONE MOTION FOR EVERY BUILDING. A 52-storey steel tower, a brick
      walk-up and a timber ranch house all sank straight down at 2/3 g. They
      do not. A frame pancakes, a slender masonry stack HINGES AT ITS BASE
      and falls across the street, a wounded mid-rise SHEARS along the hit
      and takes the rest down after it, light timber FOLDS in on itself,
      adobe CRUMBLES. Which one you get is derived from what the building is
      made of and how slender it is — never from its name.

   ------------------------------------------------------------------
   WHY THIS IS A FILE AND NOT A PATCH TO structural.js
   ------------------------------------------------------------------
   The island had its own collapse (`fallingBuildings` in systems/disasters.js:
   sink the group into the ground at h*0.6 m/s, tilt it, hide it at t>1.8) and
   the city had its own (structural.js's band stack). Two systems, two looks,
   neither reusable. Everything visual lives here now and both callers drive
   it through the SAME entry point, so the earthquake, the plane, the RPG and
   the airstrike all produce the same quality of picture and a fix lands once.

   BLOCK LAW COMPLIANCE (scrolls/claude/doctrine.md):
   1. ONE-LINE ADOPTION — `CBZ.collapse.play(desc, opts)`. The caller keeps
      its own ledger, its own kill rules and its own aftermath.
   2. DEGRADE-SAFE — `COLLAPSE_V2 = false` makes play() return null. The
      island falls straight back to its old ticker (still in that file for
      exactly this reason); the city sends the condemnation down the same
      queue an over-the-cap collapse already takes, so a building still comes
      down and still hands off to demolition.js — it just does it without a
      picture. Neither caller can be left holding an invisible hole.
   3. >=3 REAL CONSUMERS MIGRATED IN THE SAME CHANGE — city/structural.js
      (the city pancake), systems/disasters.js (the island sink-into-ground),
      and the progressive damage skin now driven from structural.js's stage
      transitions (city) and disasters.js's structureHit stages (island).
   4. NAMED IN CLAUDE.md.
   5. RATCHET — `CBZ.collapse.audit()` reports `.hardcoded`, the number of
      registered facade grammars that have NOT declared what they are built
      of and are therefore falling back to inference. It only goes down.

   ------------------------------------------------------------------
   PERFORMANCE ENVELOPE
   ------------------------------------------------------------------
   • Concurrency is the CALLER's cap (structural.js keeps its 1..4). This
     file adds no unbounded work: the shell is qScale'd bands drawn as one
     merged copy per material per face, a burst reads at most SRC_CAP of
     the band's biggest solids, and every piece lives in CBZ.debris's
     device-capped pools (live bodies freeze into merged static rubble).
   • Materials are the building's own (or CBZ.cmat() cache hits for the
     proxy) — a collapse allocates geometry, never materials.
   • Everything is disposed on finish and on CBZ.collapse.reset().

   DETERMINISM: this is runtime spectacle over an already-decided outcome, so
   Math.random is legal here (same licence city/structural.js's FX carry).
   Nothing in this file decides WHETHER a building comes down, only how it
   looks doing it.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  if (CBZ.collapse) return;                       // idempotent family guard

  CBZ.CONFIG = CBZ.CONFIG || {};
  // Master switch. false → shell()/play() return null and every caller keeps
  // the collapse it had before this file existed.
  if (CBZ.CONFIG.COLLAPSE_V2 == null) CBZ.CONFIG.COLLAPSE_V2 = true;
  // The disintegration. false → bands still move under their grammar but
  // vanish instead of breaking into pieces of themselves.
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

     Every number here is a PHYSICAL property that some grammar below reads.
     Nothing in this table names a building, a lot, a district or a facade —
     add a material by adding a row, and every collapse grammar picks it up.

       ductile   0..1  how far the frame deforms before it lets go. Steel
                       rides down as one mass; unreinforced masonry has
                       nothing holding one course to the next and comes apart
                       almost immediately. Drives WHEN bands fragment and how
                       far a topple rotates before it breaks up.
       hinge     0..1  tendency to rotate about a base hinge rather than drop
                       vertically. A slender masonry stack (a chimney, a
                       campanile, a brick walk-up gable) hinges; a steel frame
                       whose columns buckle in place does not.
       frag      x     fragment COUNT multiplier — how many pieces it makes.
       fragSize  x     fragment SIZE multiplier — masonry makes many small
                       pieces, precast concrete makes fewer, larger slabs.
       dust      x     dust volume. Masonry and concrete are made of dust;
                       steel and timber are not.
       rate      x     how fast a consumed band actually crushes.
       spread    x     how far outward fragments are thrown. A brittle
                       material ejects; a ductile one drops close.
       tone      0..1  shade factor for the BROKEN face — the colour of the
                       inside of this material when it is torn open.
       burn      0..1  does it feed a fire (read by the caller's fire model,
                       published here so the property lives with the material)
     ============================================================ */
  const MATERIALS = {
    masonry:  { label: "unreinforced masonry", ductile: 0.10, hinge: 0.85, frag: 1.35, fragSize: 0.75, dust: 1.30, rate: 1.15, spread: 1.25, tone: 0.62, burn: 0.05 },
    brick:    { label: "load-bearing brick",   ductile: 0.18, hinge: 0.70, frag: 1.25, fragSize: 0.80, dust: 1.15, rate: 1.05, spread: 1.10, tone: 0.58, burn: 0.10 },
    adobe:    { label: "adobe / rammed earth", ductile: 0.05, hinge: 0.45, frag: 1.50, fragSize: 0.62, dust: 1.55, rate: 1.35, spread: 1.05, tone: 0.70, burn: 0.05 },
    stone:    { label: "cut stone",            ductile: 0.08, hinge: 0.90, frag: 0.95, fragSize: 1.25, dust: 1.20, rate: 0.90, spread: 1.30, tone: 0.66, burn: 0.02 },
    concrete: { label: "reinforced concrete",  ductile: 0.45, hinge: 0.25, frag: 0.85, fragSize: 1.35, dust: 1.10, rate: 0.95, spread: 0.85, tone: 0.55, burn: 0.05 },
    steel:    { label: "steel frame",          ductile: 0.85, hinge: 0.10, frag: 0.70, fragSize: 1.15, dust: 0.80, rate: 0.80, spread: 0.70, tone: 0.42, burn: 0.20 },
    glassbox: { label: "curtain-wall frame",   ductile: 0.75, hinge: 0.12, frag: 1.10, fragSize: 0.70, dust: 0.70, rate: 0.90, spread: 0.95, tone: 0.36, burn: 0.25 },
    timber:   { label: "timber frame",         ductile: 0.55, hinge: 0.35, frag: 1.20, fragSize: 0.70, dust: 0.55, rate: 1.30, spread: 0.80, tone: 0.74, burn: 0.90 },
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

  /* ---- THE PROFILE -------------------------------------------------------
     Everything a grammar needs, solved once from the building's own numbers.
     `slender` is the single most predictive figure in collapse mechanics:
     height over least plan dimension. Below ~1.5 a structure cannot topple
     (its footprint is wider than it is tall); above ~4 a brittle one almost
     always does.
  ------------------------------------------------------------------------ */
  /* (desc.groundAt is no longer read here: the pieces are rigid bodies in
     CBZ.debris, which lands every one of them on CBZ.floorAt, the real
     ground under wherever it flew — hills, beach and volcano skirt included.) */
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
     2. THE DEBRIS IS THE BUILDING.

     This file used to own a private fragment pool: `new THREE.Mesh(unitBox)`
     slabs in two blended greys, flown by its own ballistics loop and parked
     on the street as seated cubes. Whatever fell — a sandstone walk-up, a
     blue curtain-wall tower, a timber house — ended as the same grey boxes.
     The owner's law (2026-09-27): "I hate big cubes of fake debris. Make
     debris realer, all from the prop itself."

     So there is no pool here any more. A band that fails is handed, AS IT IS
     AT THAT INSTANT (crushed, leaning, half-way through a topple), to
     CBZ.debris.shatter: the building's OWN solids — its storey walls, floor
     slabs, facade pieces and window panes, in their own materials and
     vertex colours — are cut into Voronoi pieces that tumble as rigid
     bodies, pile on each other and freeze into merged rubble owned by the
     building's key. demolition.js clears that key when the lot is carted
     off. Grit and dust come out in the building's own colours: a brick
     block throws red dust, a white render tower white.
     ============================================================ */
  const owners = new Set();           // every building key we have thrown debris for
  const SRC_CAP = 44;                 // biggest solids read into one burst (the rest were grit anyway)
  const GLASS_CAP = 8;                // panes read into one burst (radial shards)
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

  // The building's own solids, cloned (geometry and material SHARED, nothing
  // copied) at their live world pose, into a throwaway root for the reader.
  function readSource(list, kind) {
    const src = new THREE.Group();
    for (const c of list) {
      const mesh = new THREE.Mesh(c.geo, c.mat);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(c.world);
      if (kind && !c.glass && CBZ.debris.kindOf(c.mat) === "concrete") mesh.userData.debrisKind = kind;
      src.add(mesh);
    }
    return src;
  }
  // Every solid of these parts, at its pose this frame. A real shell carries
  // its items; the proxy (no group to read) is read off its own meshes.
  function partSolids(parts) {
    const all = [];
    for (const p of parts) {
      if (!p || !p.g) continue;
      p.g.updateWorldMatrix(true, true);
      if (p.items) {
        for (const it of p.items) {
          all.push({ geo: it.geo, mat: it.mat, world: new THREE.Matrix4().multiplyMatrices(p.g.matrixWorld, it.m), vol: it.vol, glass: it.glass });
        }
      } else {
        p.g.traverse(function (o) {
          // (the part group itself may already be hidden by the grammar)
          if (!o.isMesh || !o.geometry || !visibleIn(o, p.g)) return;
          _bb.setFromObject(o); _bb.getSize(_sz);
          all.push({ geo: o.geometry, mat: o.material, world: o.matrixWorld.clone(), vol: Math.max(1e-4, _sz.x * _sz.y * _sz.z), glass: !!o.userData.cbzGlass || isGlass(o.material) });
        });
      }
    }
    return all;
  }

  /* BREAK THESE PARTS. The one operation every grammar ends in: the parts
     stop being a shell and become pieces of themselves.
       o.at {x,y,z}   where the failure is (pieces there are smaller/faster)
       o.vx/vy/vz     the velocity the collapse motion was carrying
       o.dir          push direction; o.n budget; o.size piece size (m)
       o.spread       how far the material throws (MATERIALS.spread) */
  function breakParts(job, parts, o) {
    for (const p of parts) if (p && p.g) p.g.visible = false;
    if (!CBZ.CONFIG.COLLAPSE_FRAGMENTS || !CBZ.debris || !HAS3) return 0;
    const sh = job.shell;
    let all;
    try { all = partSolids(parts); } catch (e) { return 0; }
    if (!all.length) return 0;
    // the biggest solids carry the budget; the smallest were only ever grit
    const solid = all.filter(function (c) { return !c.glass; }).sort(function (a, b) { return b.vol - a.vol; }).slice(0, SRC_CAP);
    const glass = all.filter(function (c) { return c.glass; }).sort(function (a, b) { return b.vol - a.vol; }).slice(0, GLASS_CAP);
    const key = job.desc.key || "collapse";
    owners.add(key);
    // A CONTROLLED DEMOLITION (desc.tight) drops into its own footprint:
    // the charges cut the columns, nothing is thrown, so the pieces barely
    // leave the plan they stood on.
    const tight = job.desc.tight ? 0.4 : 1;
    const spread = (o.spread || 1) * tight;
    const r = CBZ.debris.shatter(readSource(solid.concat(glass), sh.kind), {
      at: o.at, dir: job.desc.tight ? null : (o.dir || null),
      velocity: new THREE.Vector3((o.vx || 0) * tight, o.vy || 0, (o.vz || 0) * tight),
      power: Math.max(0.6, Math.min(1.8, 0.8 * spread)),
      speed: 2.4 * spread,
      maxPieces: o.n, size: o.size, owner: key, solid: true,
      dust: job.quiet ? false : job.prof.m.dust,
    });
    return r ? r.pieces : 0;
  }

  // The dust of THIS building: its wall colour ground into the grey of a
  // pulverised floor plate. Handed to every dust kick this file makes.
  function dustOf(sh, job) {
    const wall = sh && sh.wall != null ? sh.wall : (job && job.desc.wall != null ? job.desc.wall : 0x8b8f94);
    return mix(wall, 0xb3ada2, 0.5);
  }

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
     3. THE SHELL — the building itself, cut into storey bands.

     The real building's walls are merged into core/batch.js's static
     buffers and cannot move, so a collapse animates a stand-in behind the
     dust. The stand-in used to be a PROXY: boxes in the wall colour with a
     window strip, a plinth and a cornice. It is now THE BUILDING: at the
     swap its own solids (desc.group / desc.solids / desc.panes, see
     gatherSolids) are sorted into storey bands and, per band, into the
     four face panels and the floor plates, and each part is drawn as one
     merged copy of its own geometry per material. Same windows, same
     facade, same paint — the swap frame is the same picture, and when a
     band fails the pieces are cut out of those very solids.

     THE PANEL DECOMPOSITION IS THE WHOLE TRICK. It is what lets one shell
     serve five completely different collapse motions without any of them
     knowing about the others: a pancake crushes the band, a topple sheds it
     tangentially, a shear drops the wound-side panels first, a fold rotates
     the panels inward at their base, a crumble blows all four outward.

     THE PROXY stays only for a caller that cannot hand over its building
     (no group): it is still built from that building's own numbers, and it
     still breaks into pieces of itself rather than into invented slabs.
     ============================================================ */
  // How much shell can this quality tier afford? Band count, and whether a
  // band is decomposed into four face panels plus a floor slab (which is what
  // lets a grammar peel one face off and expose the slabs behind it) or is
  // one part per band.
  function shellBudget() {
    return { bands: Math.round(qs(3, 9)), panels: qs(0, 1) > 0.45 };
  }

  /* One merged copy of a part's solids per material: the draw-call cost of
     a band is (faces x materials), never (meshes). Multi-material meshes
     split by their own geometry groups. */
  function mergeInto(g, list) {
    const byMat = new Map();
    for (const it of list) {
      const geo = it.geo, idx = geo.index, pos = geo.attributes.position;
      const n = idx ? idx.count : pos.count;
      if (it.tris) {                        // a split piece of a taller mesh: its own triangles
        let a = byMat.get(it.mat); if (!a) { a = []; byMat.set(it.mat, a); }
        a.push({ geo: geo, m: it.m, s: 0, c: it.tris.length * 3, tris: it.tris });
        continue;
      }
      const groups = Array.isArray(it.mat) && geo.groups && geo.groups.length ? geo.groups : null;
      if (groups) {
        for (const gr of groups) {
          const m = it.mat[gr.materialIndex || 0];
          if (!m) continue;
          let a = byMat.get(m); if (!a) { a = []; byMat.set(m, a); }
          a.push({ geo: geo, m: it.m, s: gr.start, c: Math.min(gr.count, n - gr.start) });
        }
      } else {
        const m = Array.isArray(it.mat) ? it.mat[0] : it.mat;
        if (!m) continue;
        let a = byMat.get(m); if (!a) { a = []; byMat.set(m, a); }
        a.push({ geo: geo, m: it.m, s: 0, c: n });
      }
    }
    byMat.forEach(function (runs, mat) {
      let total = 0;
      for (const r of runs) total += r.c - (r.c % 3);
      if (!total) return;
      const P = new Float32Array(total * 3), N = new Float32Array(total * 3), U = new Float32Array(total * 2);
      const vc = !!mat.vertexColors, Cc = vc ? new Float32Array(total * 3) : null;
      let o = 0;
      for (const r of runs) {
        const geo = r.geo, idx = geo.index, pos = geo.attributes.position;
        const nrm = geo.attributes.normal, uv = geo.attributes.uv, col = geo.attributes.color;
        // inlined affine transform: this runs once per vertex of a whole
        // building on the swap frame, so no per-vertex method calls
        _n3.getNormalMatrix(r.m);
        const e = r.m.elements, q = _n3.elements;
        // (an interleaved attribute is flattened once so the loop stays flat)
        const flat = function (a, n) {
          if (!a) return null;
          if (!a.isInterleavedBufferAttribute && a.itemSize === n) return a.array;
          const f = new Float32Array(a.count * n);
          for (let j = 0; j < a.count; j++) for (let c = 0; c < n; c++) f[j * n + c] = a.getComponent ? a.getComponent(j, c) : [a.getX(j), a.getY(j), a.getZ(j)][c];
          return f;
        };
        const pa = flat(pos, 3), ps = 3;
        const na = flat(nrm, 3), ua = flat(uv, 2), ca = flat(col, 3);
        const ia = idx ? idx.array : null;
        const end = r.s + r.c - (r.c % 3), tr = r.tris;
        for (let kk = r.s; kk < end; kk++) {
          const k = tr ? tr[(kk / 3) | 0] + (kk % 3) : kk;
          const i = ia ? ia[k] : k;
          const x = pa[i * ps], y = pa[i * ps + 1], z = pa[i * ps + 2];
          P[o * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
          P[o * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          P[o * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
          if (na) {
            const a = na[i * 3], b = na[i * 3 + 1], c = na[i * 3 + 2];
            const nx = q[0] * a + q[3] * b + q[6] * c, ny = q[1] * a + q[4] * b + q[7] * c, nz = q[2] * a + q[5] * b + q[8] * c;
            const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            N[o * 3] = nx / l; N[o * 3 + 1] = ny / l; N[o * 3 + 2] = nz / l;
          }
          if (ua) { U[o * 2] = ua[i * 2]; U[o * 2 + 1] = ua[i * 2 + 1]; }
          if (vc) {
            if (ca) { Cc[o * 3] = ca[i * 3]; Cc[o * 3 + 1] = ca[i * 3 + 1]; Cc[o * 3 + 2] = ca[i * 3 + 2]; }
            else { Cc[o * 3] = 1; Cc[o * 3 + 1] = 1; Cc[o * 3 + 2] = 1; }
          }
          o++;
        }
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.BufferAttribute(P, 3));
      bg.setAttribute("normal", new THREE.BufferAttribute(N, 3));
      bg.setAttribute("uv", new THREE.BufferAttribute(U, 2));
      if (vc) bg.setAttribute("color", new THREE.BufferAttribute(Cc, 3));
      bg.computeBoundingSphere();
      const mesh = new THREE.Mesh(bg, mat);
      mesh.receiveShadow = true; mesh.castShadow = false;
      g.add(mesh);
    });
  }

  function realShell(desc, prof, items, opt, root) {
    const w = prof.w, d = prof.d, h = prof.h, hw = w / 2, hd = d / 2;
    const nBand = Math.max(2, Math.min(prof.storeys, opt.bands));
    const bandH = h / nBand;
    const outer = new THREE.Group(), pivot = new THREE.Group(), body = new THREE.Group();
    pivot.add(body); outer.add(pivot);
    outer.position.set(desc.ox, desc.gy || 0, desc.oz);
    // a face part sits on its face's base line (the fold hinges it there)
    const FACES = [
      { nx: 0, nz: -1, px: 0, pz: -hd, w: w, d: 0.42 },
      { nx: 0, nz: 1, px: 0, pz: hd, w: w, d: 0.42 },
      { nx: -1, nz: 0, px: -hw, pz: 0, w: 0.42, d: d },
      { nx: 1, nz: 0, px: hw, pz: 0, w: 0.42, d: d },
    ];
    const bands = [];
    for (let i = 0; i < nBand; i++) {
      const g = new THREE.Group();
      g.position.y = bandH * i;
      body.add(g);
      bands.push({ g: g, y0: bandH * i, h: bandH, parts: [], crushed: 0, blew: false, dead: false, _p: {} });
    }
    function partOf(band, key) {
      let p = band._p[key];
      if (p) return p;
      const g = new THREE.Group();
      if (key >= 0) {
        const f = FACES[key];
        g.position.set(f.px, 0, f.pz);
        p = { g: g, nx: f.nx, nz: f.nz, w: f.w, d: f.d, gone: false, items: [] };
      } else p = { g: g, slab: key === -1, gone: false, items: [] };
      band.g.add(g); band.parts.push(p); band._p[key] = p;
      return p;
    }
    const faceKey = function (cx, cz, slab) {
      if (!opt.panels) return -2;                   // cheap tier: one part per band
      const dist = [cz + hd, hd - cz, cx + hw, hw - cx];
      let k = 0;
      for (let j = 1; j < 4; j++) if (dist[j] < dist[k]) k = j;
      return (slab || dist[k] > 1.6) ? -1 : k;      // floor plates + core
    };
    const bandOf = function (y) { return Math.max(0, Math.min(nBand - 1, Math.floor(y / bandH))); };
    for (const it of items) {
      /* A MESH TALLER THAN A BAND IS CUT BY ITS TRIANGLES. The island's
         buildings (and any merged host) carry whole-building meshes: the
         shell merge, and the facade kit's one-mesh-per-colour flush that
         wraps all four faces from plinth to cornice. Filed whole by its
         bounding-box centre, such a mesh rode ONE band, so when the ground
         floor failed the whole facade hung in the air above it. Each
         triangle now goes to the band and face its centroid sits in. */
      const tall = it.sy > bandH * 1.3 || (opt.panels && !it.slab && !it.glass && it.sx > w * 0.7 && it.sz > d * 0.7);
      if (tall && it.geo && it.geo.attributes && it.geo.attributes.position) {
        const geo = it.geo, idx = geo.index, pa = geo.attributes.position, e = it.m.elements;
        const n = idx ? idx.count : pa.count;
        const runs = Array.isArray(it.mat) && geo.groups && geo.groups.length
          ? geo.groups.map(function (gr) { return { s: gr.start, c: Math.min(gr.count, n - gr.start), mat: it.mat[gr.materialIndex || 0] }; })
          : [{ s: 0, c: n, mat: Array.isArray(it.mat) ? it.mat[0] : it.mat }];
        const buckets = new Map();
        for (const run of runs) {
          if (!run.mat) continue;
          const end = run.s + run.c - (run.c % 3);
          for (let k = run.s; k < end; k += 3) {
            let x = 0, y = 0, z = 0;
            for (let v = 0; v < 3; v++) {
              const i = idx ? idx.getX(k + v) : k + v;
              const px = pa.getX(i), py = pa.getY(i), pz = pa.getZ(i);
              x += e[0] * px + e[4] * py + e[8] * pz + e[12];
              y += e[1] * px + e[5] * py + e[9] * pz + e[13];
              z += e[2] * px + e[6] * py + e[10] * pz + e[14];
            }
            x /= 3; y /= 3; z /= 3;
            const bk = bandOf(y) * 8 + faceKey(x, z, false) + 2;
            let perMat = buckets.get(bk); if (!perMat) { perMat = new Map(); buckets.set(bk, perMat); }
            let arr = perMat.get(run.mat); if (!arr) { arr = []; perMat.set(run.mat, arr); }
            arr.push(k);
          }
        }
        buckets.forEach(function (perMat, bk) {
          const band = bands[Math.floor(bk / 8)], key = (bk % 8) - 2;
          const p = partOf(band, key);
          const lm = new THREE.Matrix4().makeTranslation(-p.g.position.x, -band.y0, -p.g.position.z).multiply(it.m);
          perMat.forEach(function (arr, m) {
            p.items.push({ geo: geo, mat: m, m: lm, vol: it.vol * arr.length * 3 / Math.max(3, n), glass: it.glass, tris: Uint32Array.from(arr) });
          });
        });
        continue;
      }
      const band = bands[bandOf(it.cy)];
      const p = partOf(band, faceKey(it.cx, it.cz, it.slab));
      const lm = new THREE.Matrix4().makeTranslation(-p.g.position.x, -band.y0, -p.g.position.z).multiply(it.m);
      p.items.push({ geo: it.geo, mat: it.mat, m: lm, vol: it.vol, glass: it.glass });
    }
    for (const band of bands) { for (const p of band.parts) mergeInto(p.g, p.items); band._p = null; }
    const mats = pickMats(items);
    const wall = mats.wall && mats.wall.color ? mats.wall.color.getHex() : (desc.wall != null ? desc.wall : 0x8b8f94);
    outer.userData.cbzCollapseShell = desc.key || true;
    outer.name = "collapseShell";
    root.add(outer);
    return {
      outer: outer, pivot: pivot, body: body, bands: bands, root: root,
      bandH: bandH, wall: desc.wall != null ? desc.wall : wall,
      slabCol: mats.slab && mats.slab.color ? mats.slab.color.getHex() : wall,
      w: w, d: d, h: h, real: true, kind: RUBBLE_KIND[prof.material] || "concrete",
      wallMat: mats.wall || mat(wall), glassMat: mats.glass,
    };
  }

  C.shell = function (desc, prof) {
    if (!CBZ.CONFIG.COLLAPSE_V2 || typeof THREE === "undefined") return null;
    const root = desc.root || CBZ.scene;
    if (!root) return null;
    prof = prof || C.profile(desc);
    const opt = shellBudget();

    // THE BUILDING ITSELF when the caller hands it over.
    if (desc.group) {
      try {
        const items = gatherSolids(desc);
        if (items) { const sh = realShell(desc, prof, items, opt, root); if (sh) return sh; }
      } catch (e) {}
    }
    return proxyShell(desc, prof, opt, root);
  };

  // ---- THE PROXY: for a caller with no group to read ------------------------
  let unitBox = null;
  function boxGeo() {
    if (!unitBox && typeof THREE !== "undefined") { unitBox = new THREE.BoxGeometry(1, 1, 1); unitBox._shared = true; }
    return unitBox;
  }
  function proxyShell(desc, prof, opt, root) {

    const w = prof.w, d = prof.d, h = prof.h;
    const wall = desc.wall != null ? desc.wall : 0x8b8f94;
    // The glass tone is DERIVED, never a constant: a window is the wall's own
    // colour seen through a dark reflective plane, so a sand-coloured adobe
    // gets warm openings and a blue tower gets cold ones.
    const glass = desc.glass != null ? desc.glass : mix(shade(wall, 0.36), 0x2b3440, 0.55);
    const trim = desc.trim != null ? desc.trim : shade(wall, 1.14);
    const plinth = shade(wall, 0.72);
    const slabCol = mix(shade(wall, prof.m.tone), 0x6d7076, 0.45);

    // One band per storey up to the quality cap, so a 4-storey block never
    // gets 9 bands and a 52-storey tower groups its floors instead of
    // spawning 52 meshes.
    const nBand = Math.max(2, Math.min(prof.storeys, opt.bands));
    const bandH = h / nBand;
    const floorsPer = prof.storeys / nBand;

    const outer = new THREE.Group();          // sits at the building origin
    const pivot = new THREE.Group();          // rotates (hinge lives here)
    const body = new THREE.Group();           // holds the bands
    pivot.add(body); outer.add(pivot);
    outer.position.set(desc.ox, desc.gy || 0, desc.oz);

    const bands = [];
    const T = 0.42;                           // panel thickness (a wall, not a sheet)
    for (let i = 0; i < nBand; i++) {
      const y0 = bandH * i;
      const g = new THREE.Group();
      g.position.y = y0;
      body.add(g);
      const parts = [];

      if (opt.panels) {
        // ---- four face panels + the floor slab they sit on ----------------
        const faces = [
          { nx: 0, nz: -1, sx: w, sz: T, px: 0, pz: -(d / 2 - T / 2) },
          { nx: 0, nz: 1, sx: w, sz: T, px: 0, pz: (d / 2 - T / 2) },
          { nx: -1, nz: 0, sx: T, sz: d - T * 2, px: -(w / 2 - T / 2), pz: 0 },
          { nx: 1, nz: 0, sx: T, sz: d - T * 2, px: (w / 2 - T / 2), pz: 0 },
        ];
        for (const f of faces) {
          const pg = new THREE.Group();
          pg.position.set(f.px, 0, f.pz);
          // the wall itself
          const wallMesh = new THREE.Mesh(boxGeo(), mat(wall));
          wallMesh.scale.set(f.sx, bandH, f.sz);
          wallMesh.position.y = bandH / 2;
          wallMesh.receiveShadow = true;
          pg.add(wallMesh);
          // the window course — one strip per storey inside this band, stood
          // a hair proud of the wall so it never z-fights it
          const nWin = Math.max(1, Math.round(floorsPer));
          const winH = Math.min(bandH / nWin * 0.52, prof.FH * 0.5);
          const along = Math.max(f.sx, f.sz);
          const winLen = along * 0.82;
          for (let k = 0; k < nWin; k++) {
            const wy = (k + 0.58) * (bandH / nWin);
            if (wy + winH / 2 > bandH) continue;
            const wm = new THREE.Mesh(boxGeo(), mat(glass));
            wm.userData.cbzGlass = true;          // breaks as glass, not as wall
            if (f.nz) wm.scale.set(winLen, winH, T + 0.06);
            else wm.scale.set(T + 0.06, winH, winLen);
            wm.position.y = wy;
            pg.add(wm);
          }
          g.add(pg);
          parts.push({ g: pg, nx: f.nx, nz: f.nz, w: f.sx, d: f.sz, gone: false });
        }
        // the floor slab — invisible until a panel peels, and then it is the
        // single most important thing in the frame: floor plates stacked in
        // the air with nothing around them is what a real collapse looks like
        const slab = new THREE.Mesh(boxGeo(), mat(slabCol));
        slab.scale.set(w - T * 1.4, Math.max(0.22, bandH * 0.10), d - T * 1.4);
        slab.position.y = 0.11;
        slab.receiveShadow = true;
        g.add(slab);
        parts.push({ g: slab, slab: true, gone: false });
      } else {
        // ---- cheap tier: one box, still the right colour -------------------
        const m = new THREE.Mesh(boxGeo(), mat(wall));
        m.scale.set(w - 0.06, bandH, d - 0.06);
        m.position.y = bandH / 2;
        m.receiveShadow = true;
        g.add(m);
        parts.push({ g: m, gone: false });
      }

      bands.push({ g: g, y0: y0, h: bandH, parts: parts, crushed: 0, blew: false, dead: false });
    }

    // ---- plinth + cornice: the two mouldings that stop it reading as a box
    const pl = new THREE.Mesh(boxGeo(), mat(plinth));
    pl.scale.set(w + 0.5, Math.min(1.1, h * 0.05), d + 0.5);
    pl.position.y = Math.min(1.1, h * 0.05) / 2;
    bands[0].g.add(pl);
    bands[0].parts.push({ g: pl, gone: false });
    const co = new THREE.Mesh(boxGeo(), mat(trim));
    const coH = Math.min(0.9, h * 0.035);
    co.scale.set(w + 0.7, coH, d + 0.7);
    const topBand = bands[bands.length - 1];
    co.position.y = topBand.h - coH / 2;
    topBand.g.add(co);
    topBand.parts.push({ g: co, gone: false });

    outer.userData.cbzCollapseShell = desc.key || true;
    outer.name = "collapseShell";
    root.add(outer);
    return {
      outer: outer, pivot: pivot, body: body, bands: bands, root: root,
      bandH: bandH, wall: wall, glass: glass, slabCol: slabCol,
      w: w, d: d, h: h, real: false, kind: RUBBLE_KIND[prof.material] || "concrete",
      wallMat: mat(wall), glassMat: null,
    };
  }

  C.disposeShell = function (sh) {
    if (!sh || !sh.outer) return;
    if (sh.outer.parent) sh.outer.parent.remove(sh.outer);
    sh.outer.traverse(function (o) {
      // the proxy's unit box is SHARED with every other proxy on screen, and
      // materials are the building's own (or cmat cache entries) — never
      // ours to dispose. The merged band copies are ours.
      if (o.isMesh && o.geometry && o.geometry !== unitBox && !o.geometry._shared) o.geometry.dispose();
    });
    sh.outer = null; sh.bands = null;
  };

  /* ---- turning a band into debris ---------------------------------------
     The one operation every grammar shares. A band stops existing and its
     mass leaves at whatever velocity the grammar hands in. `bias` is the
     direction the collapse is throwing this piece; `spin` is how violently.
  ------------------------------------------------------------------------ */
  function burstBand(job, band, o) {
    o = o || {};
    const sh = job.shell, prof = job.prof, m = prof.m;
    if (band.dead) return;
    band.dead = true;
    // World-space seat of this band. Read its LIVE base off the group (a
    // pancaked band has already ridden a long way down by the time it lets
    // go). For a hinge grammar the caller has already solved the rotated
    // world point and passes x/z/wy in.
    const liveY = (band.g && band.g.position ? band.g.position.y : band.y0) + band.h / 2;
    const wy = o.wy != null ? o.wy : (job.desc.gy || 0) + liveY;
    const cx = o.x != null ? o.x : job.desc.ox;
    const cz = o.z != null ? o.z : job.desc.oz;

    // HOW MANY PIECES scales with the band's actual mass, never a constant,
    // and HOW BIG with the band's own plate: a tower sheds slabs, a garden
    // shed splinters. The pieces themselves are cut out of the band's own
    // walls, plates and glass (breakParts).
    const area = sh.w * sh.d;
    const n = Math.max(6, Math.round(Math.sqrt(area) * 0.9 * m.frag * qs(0.5, 1.1) * (o.count || 1)));
    const size = Math.min(3.2, Math.max(0.55, Math.sqrt(area / n) * 0.62 * m.fragSize));
    breakParts(job, band.parts.filter(function (p) { return !p.gone; }), {
      at: { x: cx, y: wy, z: cz }, n: n, size: size,
      vx: o.vx, vy: o.vy, vz: o.vz, spread: (o.spread || 1) * m.spread,
    });
    for (const p of band.parts) if (p.g) p.g.visible = false;
    // the air jet: every floor a front passes expels its air and its contents
    if (!band.blew) {
      band.blew = true;
      const a = rnd() * 6.2832;
      try {
        if (CBZ.cityDustKick) CBZ.cityDustKick(cx + Math.cos(a) * sh.w * 0.5, wy, cz + Math.sin(a) * sh.d * 0.5, 1.5 * m.dust, dustOf(sh, job));
        if (CBZ.cityChunk) CBZ.cityChunk(cx + Math.cos(a) * sh.w * 0.4, wy, cz + Math.sin(a) * sh.d * 0.4,
          { count: 3, force: 6, dirx: Math.cos(a), dirz: Math.sin(a), material: sh.wallMat });
      } catch (e) {}
    }
  }
  C.burstBand = burstBand;

  /* ============================================================
     4. THE GRAMMARS — a registry, not a switch.

     Each grammar answers two questions:
       pick(prof, job) → a score. Highest score wins. A grammar that cannot
                         apply returns 0 and is never considered again.
       plan(job)       → one-time setup (hinge point, fall duration, tilt).
       step(job, dt)   → the motion. Returns true when the shell has hit the
                         ground and the caller should run its aftermath.

     Adding a collapse behaviour is `CBZ.collapse.registerMode(id, def)` from
     any file, at any time. Nothing here has to be edited to add one, and
     nothing here knows the names of the five below.
     ============================================================ */
  const MODES = new Map();
  C.registerMode = function (id, def) {
    if (!id || !def || typeof def.step !== "function") return;
    MODES.set(id, { id: id, label: def.label || id, pick: def.pick || function () { return 0.1; }, plan: def.plan || function () {}, step: def.step });
  };
  C.modeList = function () { return Array.from(MODES.keys()); };

  function chooseMode(job) {
    if (job.forceMode && MODES.has(job.forceMode)) return MODES.get(job.forceMode);
    let best = null, bestS = -1;
    MODES.forEach(function (mo) {
      let s = 0;
      try { s = mo.pick(job.prof, job) || 0; } catch (e) { s = 0; }
      if (s > bestS) { bestS = s; best = mo; }
    });
    return best;
  }

  // ---- helper: free-fall time for a height ---------------------------------
  // NIST/Bazant put the observed collapse front at about 2/3 of free fall,
  // because the intact structure below is still resisting all the way down.
  const FRONT_G = 6.5;
  function fallTime(h) { return Math.max(1.1, Math.min(9, Math.sqrt(2 * Math.max(1, h) / FRONT_G))); }

  /* WHICH WAY DOES A LEAN GO. Three grammars tilt a shell and all three have
     to agree, so the sign lives here once.

     A rotation of +a about z carries the up-axis toward -x; a rotation of +a
     about x carries it toward +z. So leaning a building toward the unit
     ground vector (nx, nz) is rotation.x = +nz*a and rotation.z = -nx*a, and
     writing that out by hand a third time is how you end up with a tower
     that falls back toward the man who fired the rocket — which is what the
     pancake was doing before this helper existed, because it had copied the
     signs from a version where the wound normal pointed the other way.

     (nx, nz) is the direction the collapse is heading: the ordnance's TRAVEL
     direction where the caller gave one, otherwise the outward normal of the
     struck face. */
  function leanTo(pivot, nx, nz, a) {
    pivot.rotation.x = nz * a;
    pivot.rotation.z = -nx * a;
  }

  /* ---- PANCAKE — the framed high-rise ------------------------------------
     Crush-down from the wound under ~2/3 g, crush-up chasing it, the surviving
     upper block riding down as ONE MASS while everything between the two
     fronts is consumed. This is the only grammar the file had before, and it
     is still the right one for a steel or concrete frame.
  ------------------------------------------------------------------------ */
  C.registerMode("pancake", {
    label: "pancake / progressive floor collapse",
    pick: function (p) {
      // ductile frames pancake; the taller they are the more certainly
      return 0.35 + p.m.ductile * 1.1 + Math.min(0.55, p.slender * 0.12);
    },
    plan: function (job) {
      const p = job.prof;
      job.initY = Math.max(0.5, Math.min(p.h - 0.5, job.wound.floor * p.FH));
      job.front = job.initY; job.frontUp = job.initY;
      const tDown = Math.sqrt(2 * job.initY / FRONT_G);
      const tUp = Math.sqrt(2 * Math.max(0.5, p.h - job.initY) / (FRONT_G * 0.8));
      job.fall = Math.max(1.6, Math.min(9, Math.max(tDown, tUp)));
      // tilt AWAY from the wound: the side that lost its columns goes first
      job.tiltMax = 0.16 + p.m.hinge * 0.22;
    },
    step: function (job, dt) {
      const p = job.prof, sh = job.shell;
      job.front = Math.max(0, job.initY - 0.5 * FRONT_G * job.t * job.t);
      job.frontUp = Math.min(p.h, job.initY + 0.5 * FRONT_G * 0.8 * job.t * job.t);
      /* HOW FAR HAS THE SURVIVING BLOCK ABOVE ACTUALLY DESCENDED?

         It is the height of the structure the two fronts have EATEN between
         them, less what that structure now occupies as rubble. Collapsed
         floor plates compact to roughly a fifth of their standing height, so
         about 0.8 of every metre consumed is a metre the block above falls.

         The old code answered `initY - front`, i.e. the crush-DOWN distance
         only — which is zero for a collapse that starts at the ground floor,
         and a ground-floor initiation is what EVERY demolition, every
         car-bomb and every forceCollapse() produces. So the headline case
         was a tower standing perfectly still with its lobby quietly
         disappearing under it for eight seconds. Both fronts consume
         structure; both fronts have to lower the mass above them. */
      const sink = Math.max(0, (job.frontUp - job.front) * 0.8);
      const tk = Math.min(1, job.t / (job.fall * 0.5));
      // lean in, then straighten as the mass centres itself over the wreck
      const lean = job.tiltMax * (tk < 1 ? tk : 1 - (job.t / job.fall - 0.5) * 0.5);
      leanTo(sh.pivot, job.wound.nx, job.wound.nz, lean);
      for (const band of sh.bands) {
        if (band.dead) continue;
        if (band.y0 + band.h <= job.front) continue;               // below: intact
        if (band.y0 >= job.frontUp) {                              // above: rides down
          band.g.position.y = Math.max(0, band.y0 - sink);
          continue;
        }
        band.crushed += dt * 2.4 * p.m.rate;
        if (band.crushed >= 1) {
          burstBand(job, band, { vy: -3.5 - rnd() * 3, spread: 0.9 });
          continue;
        }
        const s = 1 - band.crushed * 0.9;
        band.g.scale.y = s < 0.08 ? 0.08 : s;
        band.g.position.y = Math.max(0, job.front + (Math.max(0, band.y0 - sink) - job.front) * (1 - band.crushed));
        // the cladding lets go of a floor a beat BEFORE the frame does — the
        // sheet of facade running ahead of the front is the most recognisable
        // thing in any collapse footage
        if (!band.shed && band.crushed > 0.12) {
          band.shed = true;
          for (const part of band.parts) {
            if (part.slab || part.nx == null || part.gone) continue;
            part.gone = true;
            part.g.visible = false;
            burstBand.panelBurst(job, band, part, 0.4);
          }
        }
      }
      return job.t >= job.fall;
    },
  });

  /* ---- TOPPLE — the slender brittle stack --------------------------------
     A masonry campanile, a brick chimney stack, a stone tower. It does not
     drop: it rotates about a hinge at the base on the wounded side, and the
     equation is the real one for a rigid rod hinged at its foot,

         d2theta/dt2 = (3g / 2L) * sin(theta)

     which is why it starts imperceptibly and finishes shockingly fast. Once
     the lean passes what the material can carry in tension, the stack starts
     coming apart FROM THE TOP, because that is where the tangential speed is,
     and the pieces leave on the tangent — which is what throws a toppling
     tower's debris clear across the street instead of into its own footprint.
  ------------------------------------------------------------------------ */
  C.registerMode("topple", {
    label: "topple about a base hinge",
    pick: function (p) {
      if (p.slender < 1.9) return 0;                    // wider than it is tall: cannot
      return 0.2 + p.m.hinge * 1.5 * Math.min(1.6, p.slender / 2.6);
    },
    plan: function (job) {
      const p = job.prof, sh = job.shell;
      // the hinge is the base edge on the side the building is falling TOWARD
      const fx = job.wound.nx, fz = job.wound.nz;
      const hx = fx * p.w * 0.5, hz = fz * p.d * 0.5;
      sh.pivot.position.set(hx, 0, hz);
      sh.body.position.set(-hx, 0, -hz);
      job.ang = 0.02 + rnd() * 0.02;
      job.om = 0.05;
      job.fall = fallTime(p.h) * 1.25;
      // brittle materials come apart early in the swing; ductile ones ride
      // the whole way over and break on landing
      job.breakAt = 0.30 + p.m.ductile * 0.85;
      job.shedFrom = sh.bands.length - 1;
    },
    step: function (job, dt) {
      const p = job.prof, sh = job.shell;
      job.om += (3 * G / (2 * p.h)) * Math.sin(job.ang) * dt;
      job.ang = Math.min(Math.PI / 2, job.ang + job.om * dt);
      leanTo(sh.pivot, job.wound.nx, job.wound.nz, job.ang);
      // shed from the top down once the swing passes what it can carry
      if (job.ang > job.breakAt) {
        job.shedAcc = (job.shedAcc || 0) + dt;
        const per = 0.11 + 0.25 * p.m.ductile;
        while (job.shedAcc > per && job.shedFrom >= 0) {
          job.shedAcc -= per;
          const band = sh.bands[job.shedFrom--];
          if (!band || band.dead) continue;
          /* WORLD seat of a band on a rotating stack, and the tangential
             velocity it leaves with.

             The band's centre is at (0, r, 0) in the body's frame, i.e. at
             (-h, r) in the hinge's frame where h is the half-plan offset the
             hinge sits at. Rotating that by `ang` and adding the hinge back
             gives the real point — the h*(1-cos) term is what stops every
             band's debris spawning half a building's width off the stack at
             the start of the swing, which is where the first draft put it. */
          const r = band.y0 + band.h / 2;
          const s = Math.sin(job.ang), c = Math.cos(job.ang);
          const hOff = Math.abs(job.wound.nx) * p.w * 0.5 + Math.abs(job.wound.nz) * p.d * 0.5;
          const outDist = hOff * (1 - c) + r * s;
          const wx = job.desc.ox + job.wound.nx * outDist;
          const wz = job.desc.oz + job.wound.nz * outDist;
          const v = job.om * r;
          burstBand(job, band, {
            x: wx, z: wz, wy: (job.desc.gy || 0) + hOff * s + r * c,
            vx: job.wound.nx * v * 0.8, vz: job.wound.nz * v * 0.8,
            vy: -1.5 - rnd() * 2, spread: 1.15, count: 1.15,
          });
        }
      }
      return job.ang >= Math.PI / 2 - 0.03 || job.t > job.fall + 3;
    },
  });

  /* ---- SHEAR — the wounded mid-rise --------------------------------------
     The read the owner asked for by name: an RPG or an airstrike takes out
     the columns on ONE FACE, that face's bay slides down and outward while
     the rest of the building is still standing, and a beat later the
     remainder folds into the hole the first half left. Two events, not one,
     which is exactly what makes it look like a consequence.
  ------------------------------------------------------------------------ */
  C.registerMode("shear", {
    label: "shear failure at the wound, then the remainder",
    pick: function (p, job) {
      if (!job || !job.wound || job.wound.floor == null) return 0;
      // it needs a LOCAL wound low in a building that is neither a tower nor
      // a bungalow — that is the whole geometry of a shear failure
      if (p.slender > 3.4 || p.storeys < 2) return 0;
      const low = job.wound.floor <= Math.max(1, p.storeys * 0.45);
      return low ? (0.9 + p.brittle * 0.5) : 0.25;
    },
    plan: function (job) {
      const p = job.prof;
      job.fall = fallTime(p.h) * 1.35;
      job.second = job.fall * 0.42;              // when the remainder lets go
      job.slide = 0;
      // the wound-side panels are the ones whose outward normal agrees with
      // the direction the hit came from
      for (const band of job.shell.bands) {
        for (const part of band.parts) {
          if (part.slab || part.nx == null) continue;
          part.wound = (part.nx * job.wound.nx + part.nz * job.wound.nz) > 0.5;
        }
      }
    },
    step: function (job, dt) {
      const p = job.prof, sh = job.shell;
      job.slide += dt;
      const k = Math.min(1, job.slide / (job.second));
      // PHASE A — the wounded face peels off and falls, floor slabs exposed
      for (let i = 0; i < sh.bands.length; i++) {
        const band = sh.bands[i];
        if (band.dead) continue;
        for (const part of band.parts) {
          if (!part.wound || part.gone) continue;
          const lag = i / sh.bands.length * 0.35;
          const kk = Math.max(0, k - lag) / (1 - lag || 1);
          if (kk <= 0) continue;
          part.g.position.y = -0.5 * G * 0.55 * (kk * job.second) * (kk * job.second);
          part.g.rotation.x += job.wound.nz * dt * 1.5;
          part.g.rotation.z -= job.wound.nx * dt * 1.5;
          part.g.position.x += job.wound.nx * dt * 2.2;
          part.g.position.z += job.wound.nz * dt * 2.2;
          if (band.y0 + part.g.position.y < 0.5) {
            part.gone = true; part.g.visible = false;
            burstBand.panelBurst(job, band, part);
          }
        }
      }
      // PHASE B — the remainder, deprived of the bay that was carrying it,
      // drops into the hole. Same crush-down as the pancake, but starting at
      // the wound and accelerating faster, because there is now nothing left
      // to resist it.
      if (job.slide > job.second) {
        const t2 = job.slide - job.second;
        const front = Math.max(0, job.wound.floor * p.FH - 0.5 * FRONT_G * 1.15 * t2 * t2);
        leanTo(sh.pivot, job.wound.nx, job.wound.nz, Math.min(0.34, t2 * 0.30));
        const sink = Math.max(0, job.wound.floor * p.FH - front);
        for (const band of sh.bands) {
          if (band.dead) continue;
          if (band.y0 + band.h <= front) continue;
          band.g.position.y = Math.max(0, band.y0 - sink);
          if (band.g.position.y < 0.35 || band.y0 - sink < 0.35) {
            burstBand(job, band, { vy: -3 - rnd() * 3, spread: 1.05 });
          }
        }
        if (t2 > job.fall - job.second) return true;
      }
      return job.slide > job.fall + 1.2;
    },
  });

  /* A single panel becoming debris — the shear grammar's per-part burst. Hung
     off burstBand so the two can never drift on colour or sizing. */
  burstBand.panelBurst = function (job, band, part, mult) {
    if (!CBZ.CONFIG.COLLAPSE_FRAGMENTS) { if (part.g) part.g.visible = false; return; }
    const sh = job.shell, m = job.prof.m;
    // A SHED is cheaper than a PEEL. A pancake sheds the cladding off every
    // band it eats — up to four panels per band, on a nine-band shell — so a
    // shed panel gets a small budget and the pieces that matter (the plates
    // the front is actually making) keep theirs. The shear grammar peels ONE
    // face and can afford the detail.
    const n = Math.max(3, Math.round(6 * m.frag * qs(0.5, 1.2) * (mult == null ? 1 : mult)));
    // WHERE THE PANEL ACTUALLY IS: the band's group carries the live
    // crush/sink transform, so its height is read off it — a cladding panel
    // that lets go of floor 30 starts at floor 30 and falls thirty floors.
    const localY = (band.g && band.g.position ? band.g.position.y : band.y0) + band.h * 0.5;
    const wy = (job.desc.gy || 0) + Math.max(0.6, localY);
    const nx = part.nx || 0, nz = part.nz || 0;
    const px = job.desc.ox + nx * sh.w * 0.5, pz = job.desc.oz + nz * sh.d * 0.5;
    // outward off the face and DOWN — a shed panel pours off the wall, it is
    // not thrown up off it
    breakParts(job, [part], {
      at: { x: px, y: wy, z: pz }, n: n,
      size: Math.min(2.4, Math.max(0.5, Math.sqrt(Math.max(part.w || 2, part.d || 2)) * 0.85 * m.fragSize)),
      dir: { x: nx, y: -0.4, z: nz },
      vx: nx * 1.6 * m.spread, vy: -0.5 - rnd() * 1.5, vz: nz * 1.6 * m.spread, spread: 0.8 * m.spread,
    });
  };

  /* ---- FOLD — light timber ------------------------------------------------
     A stick-built house does not pancake and does not topple: the roof drops
     through the ceiling joists, the walls rotate INWARD at their base plates,
     and the whole thing is a metre-high pile of lumber in about a second and
     a half. Fast, low, and almost no dust — the read that makes a wood house
     obviously not a concrete one.
  ------------------------------------------------------------------------ */
  C.registerMode("fold", {
    label: "fold — walls rotate inward, roof drops through",
    pick: function (p) {
      if (p.storeys > 3 || p.h > 13) return 0;
      return 0.3 + (1 - p.m.hinge) * 0.4 + (p.material === "timber" ? 1.4 : 0);
    },
    plan: function (job) { job.fall = 1.3 + rnd() * 0.4; },
    step: function (job, dt) {
      const sh = job.shell;
      const k = Math.min(1, job.t / job.fall);
      const e = k * k;                          // accelerating
      for (let i = 0; i < sh.bands.length; i++) {
        const band = sh.bands[i];
        if (band.dead) continue;
        const up = i / Math.max(1, sh.bands.length - 1);
        // Walls rotate INWARD about their own base plate. The part group's
        // origin sits at the band's floor with the wall standing above it, so
        // rotating the group IS a base hinge — and the direction is the
        // panel's own normal REVERSED, because a folding house falls into
        // itself. (Passing the un-negated normal here lays every wall flat
        // outward, which is a demolition, not a collapse.)
        for (const part of band.parts) {
          if (part.slab || part.nx == null) continue;
          leanTo(part.g, -part.nx, -part.nz, e * 1.35);
        }
        band.g.position.y = band.y0 * (1 - e * (0.55 + up * 0.45));
        band.g.scale.y = Math.max(0.12, 1 - e * 0.7);
        if (k > 0.72 + up * 0.2) burstBand(job, band, { vy: -1.5, spread: 0.55, count: 0.8 });
      }
      return k >= 1;
    },
  });

  /* ---- CRUMBLE — adobe, rubble stone, anything with no frame at all -------
     There is nothing to pancake and nothing to hinge on. The wall stops being
     a wall and becomes the heap it was always one shove away from being.
     Everything lets go within a fraction of a second of everything else, and
     the dust is the loudest thing in the frame.
  ------------------------------------------------------------------------ */
  C.registerMode("crumble", {
    label: "crumble — no frame, straight to a heap",
    pick: function (p) {
      if (p.h > 16) return 0;
      return 0.25 + p.brittle * 1.15 * (p.material === "adobe" ? 1.6 : 1);
    },
    plan: function (job) { job.fall = 1.5 + job.prof.h * 0.045; },
    step: function (job, dt) {
      const sh = job.shell, p = job.prof;
      const k = Math.min(1, job.t / job.fall);
      // BOTTOM-UP, and carrying a running total of what has already gone.
      // Whatever is still standing has to come DOWN by the height of the
      // courses that failed beneath it (less what they now occupy as rubble),
      // or the top of the wall hangs in mid-air for half a second waiting for
      // its own turn — which is the exact tell that gave the island's old
      // sink-into-the-ground collapse away.
      let consumed = 0;
      for (let i = 0; i < sh.bands.length; i++) {
        const band = sh.bands[i];
        if (band.dead) { consumed += band.h * 0.8; continue; }
        // low courses go first — the bottom of an unframed wall is carrying
        // everything above it and is where it actually fails
        const when = 0.10 + (i / sh.bands.length) * 0.55;
        if (k >= when) {
          burstBand(job, band, { vy: -1 - rnd() * 2, spread: 1.35 * p.m.spread, count: 1.25 });
          consumed += band.h * 0.8;
        } else {
          band.g.position.x = (rnd() - 0.5) * 0.10 * p.brittle;
          band.g.position.z = (rnd() - 0.5) * 0.10 * p.brittle;
          band.g.position.y = Math.max(0, band.y0 - consumed);
        }
      }
      return k >= 1;
    },
  });

  /* ============================================================
     5. THE JOB — one collapse, start to finish.

     The caller owns the DECISION and the AFTERMATH. This owns the picture
     between them:

        play(desc, opts) → job
          opts.wound     {nx,nz,floor}  where it was hit and from what side
          opts.preShudder seconds of creak-and-dust before anything moves.
                          The city gives it 1.15 s (the tell). The island's
                          quake has been shaking for ten seconds already, so
                          it passes ~0.3 and gets straight to it.
          opts.onSwap()   called at the exact frame the real building must be
                          hidden and its colliders pulled — hidden BEHIND the
                          dust, which is the industry-standard trick and the
                          only honest one in an engine with merged geometry.
          opts.onGround() called when the shell reaches the ground.
          opts.onDone()   called when the dust has settled and the job retires.
          opts.mode       force a grammar (tools and tests; never gameplay)
     ============================================================ */
  const jobs = [];
  const SETTLE = 2.4;

  C.play = function (desc, opts) {
    if (!CBZ.CONFIG.COLLAPSE_V2) return null;
    opts = opts || {};
    desc = Object.assign({}, desc);
    desc.gy = desc.gy || 0;
    desc.root = desc.root || CBZ.scene;
    const prof = C.profile(desc);
    const w = opts.wound || {};
    let nx = w.nx || 0, nz = w.nz || 0;
    const nl = Math.hypot(nx, nz);
    if (nl < 1e-3) { const a = rnd() * 6.2832; nx = Math.cos(a); nz = Math.sin(a); }
    else { nx /= nl; nz /= nl; }
    const job = {
      desc: desc, prof: prof,
      wound: { nx: nx, nz: nz, floor: Math.max(0, Math.min(prof.storeys - 1, w.floor || 0)) },
      t: 0, phase: 0, dustAcc: 0,
      pre: opts.preShudder != null ? opts.preShudder : 1.15,
      forceMode: opts.mode || null,
      onSwap: opts.onSwap || null, onGround: opts.onGround || null, onDone: opts.onDone || null,
      shell: null, mode: null, quiet: !!opts.quiet,
    };
    job.mode = chooseMode(job);
    jobs.push(job);
    // THE TELL — rumble, dust jets out of the wound, a groan of steel. The
    // player gets this long to understand what is about to happen, which is
    // what makes the collapse read as a consequence rather than as a cut.
    if (!job.quiet) {
      try {
        if (CBZ.shake) CBZ.shake(1.4);
        if (CBZ.sfx) CBZ.sfx("rumble");
        if (CBZ.cityDustKick) CBZ.cityDustKick(desc.ox, desc.gy + 0.6, desc.oz, 2.2 * prof.m.dust, dustOf(null, job));
      } catch (e) {}
    }
    return job;
  };
  C.modeOf = function (job) { return job && job.mode ? job.mode.id : null; };
  // What WOULD this building do? Asked by tools and by the HUD without
  // condemning anything.
  C.predict = function (desc, wound) {
    const prof = C.profile(desc);
    const j = { prof: prof, wound: wound || { nx: 1, nz: 0, floor: 0 } };
    const mo = chooseMode(j);
    return { material: prof.material, mode: mo ? mo.id : null, slender: +prof.slender.toFixed(2) };
  };

  function stepJobs(dt) {
    for (let i = jobs.length - 1; i >= 0; i--) {
      const job = jobs[i];
      job.t += dt;

      // ---- PHASE 0: the pre-shudder. Nothing moves; the world knows. ------
      if (job.phase === 0) {
        job.dustAcc += dt;
        if (job.dustAcc > 0.28 && !job.quiet) {
          job.dustAcc = 0;
          try {
            if (CBZ.cityDustKick) CBZ.cityDustKick(
              job.desc.ox + (rnd() - 0.5) * job.prof.w, job.desc.gy + 0.5,
              job.desc.oz + (rnd() - 0.5) * job.prof.d, 1.4 * job.prof.m.dust, dustOf(null, job));
            if (CBZ.shake) CBZ.shake(0.5);
          } catch (e) {}
        }
        if (job.t >= job.pre) {
          // THE SHELL IS READ FIRST and the real building hidden second, in
          // the same frame: the shell is built out of what is standing right
          // now, and the swap is what stops it standing.
          try { job.shell = C.shell(job.desc, job.prof); } catch (e) { job.shell = null; }
          try { if (job.onSwap) job.onSwap(job); } catch (e) {}
          if (!job.shell) { try { if (job.onGround) job.onGround(job); if (job.onDone) job.onDone(job); } catch (e) {} jobs.splice(i, 1); continue; }
          try { if (job.mode.plan) job.mode.plan(job); } catch (e) {}
          job.phase = 1; job.t = 0;
          if (!job.quiet) { try { if (CBZ.sfx) CBZ.sfx("explosion"); if (CBZ.shake) CBZ.shake(2.6); } catch (e) {} }
        }
        continue;
      }

      // ---- PHASE 1: the grammar drives ------------------------------------
      if (job.phase === 1) {
        let done = false;
        try { done = !!job.mode.step(job, dt); } catch (e) { done = true; }
        job.dustAcc += dt;
        if (job.dustAcc > 0.16 && !job.quiet) {
          job.dustAcc = 0;
          try { if (CBZ.shake) CBZ.shake(1.4); } catch (e) {}
        }
        if (done) {
          groundImpact(job);
          C.disposeShell(job.shell);
          try { if (job.onGround) job.onGround(job); } catch (e) {}
          job.phase = 2; job.t = 0;
        }
        continue;
      }

      // ---- PHASE 2: the pall thins, the job retires ------------------------
      if (job.t >= SETTLE) {
        try { if (job.onDone) job.onDone(job); } catch (e) {}
        jobs.splice(i, 1);
      }
    }
  }

  /* The ground beat. Every band that never got consumed becomes debris here
     — a grammar is allowed to reach the floor with mass still standing (a
     topple lands most of itself in one piece) and that mass has to go
     somewhere.  */
  function groundImpact(job) {
    const sh = job.shell, p = job.prof, d = job.desc;
    if (sh && sh.bands) {
      for (const band of sh.bands) if (!band.dead) burstBand(job, band, { vy: -1, spread: 0.85 });
    }
    if (job.quiet) return;
    try {
      if (CBZ.shake) CBZ.shake(Math.min(4.5, 1.6 + p.h * 0.055));
      if (CBZ.sfx) { CBZ.sfx("collapse"); CBZ.sfx("rumble", { delay: 0.35 }); }
      if (CBZ.cityScorch && !d.gy) CBZ.cityScorch(d.ox, d.oz, Math.max(p.w, p.d) * 0.6);
      // THE PALL. Dust volume many times the footprint, rolling OUT along the
      // ground, is the signature of a real collapse and the thing that makes
      // it read at 200 m. Scaled by the material: a steel frame makes far
      // less of it than a masonry block does. It is THIS building's dust.
      if (CBZ.cityDustKick) {
        const dc = dustOf(sh, job);
        const n = Math.round(qs(4, 11) * p.m.dust);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.2832 + rnd() * 0.4;
          const r = 0.6 + rnd() * 0.7;
          CBZ.cityDustKick(d.ox + Math.cos(a) * p.w * r, d.gy + 0.5, d.oz + Math.sin(a) * p.d * r, 2.6 * p.m.dust, dc,
            { dirx: Math.cos(a), dirz: Math.sin(a), speed: 3 + Math.min(5, p.h * 0.08) });
        }
      }
      if (CBZ.cityChunk) CBZ.cityChunk(d.ox, d.gy + 1.4, d.oz, { count: 16, force: 10, material: sh && sh.wallMat });
      if (CBZ.cityShatter) CBZ.cityShatter(d.ox, d.oz, Math.max(p.w, p.d) + 14);
    } catch (e) {}
  }

  /* ============================================================
     6. THE DAMAGE — all the stages BEFORE the collapse, on the building.

     "All stages of destruction." A building that is hit and survives has to
     LOOK hit, and progressively worse as it takes more. This used to be a
     DRESSING: a group of invented boxes stood a few centimetres proud of the
     facade — dark boxes for blown openings, grey boxes for slab edges, a box
     "panel" hanging off its fixing, box columns, rebar sticks, and an apron
     of seated grey lumps on the pavement. None of it was the building, and
     the apron was exactly the fake rubble the owner banned.

     The wound is now the building's own wall, opened. At each stage the
     wall at the wound is carved (CBZ.cityCarveWall, the same carve every
     rocket uses): the wall's own material leaves through CBZ.debris as
     pieces of itself, a ragged welded rim stays, the floor plates show
     through the gap, and what lands on the pavement is the wall that came
     out of the hole.
       stage 2 WOUNDED   the bays at the wound open
       stage 4 CRITICAL  the bays either side and the floor above go too
     Each stage carves once per building. A caller with no wall point to
     carve at (no desc.at — the island, whose own spall drops pieces of its
     wall material) gets the bookkeeping only.
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
     7. TICK + RESET + AUDIT
     ============================================================ */
  if (CBZ.onUpdate) CBZ.onUpdate(34.46, function (dt) {
    if (!jobs.length) return;
    stepJobs(dt > 0.25 ? 0.25 : dt);
  });

  /* WHAT IS HAPPENING RIGHT NOW — the probe seam. A collapse is a four-second
     animation, which makes it exactly the kind of feature that photographs
     fine and is broken in every way that matters. Every number a tool or a
     storyboard needs to wait on a REAL state (rather than on a wall-clock
     second, which is the pacing fault tools/visual-presets/README.md calls
     out by name) is published here: which grammar each live job picked, what
     phase it is in, how far through the fall it is. */
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
        return {
          key: j.desc.key || null,
          x: Math.round(j.desc.ox), z: Math.round(j.desc.oz),
          material: j.prof.material, mode: j.mode ? j.mode.id : null,
          phase: j.phase, t: +j.t.toFixed(2),
          fall: j.fall ? +j.fall.toFixed(2) : 0,
          frac: j.phase === 1 && j.fall ? +Math.min(1, j.t / j.fall).toFixed(3) : (j.phase > 1 ? 1 : 0),
          bands: j.shell && j.shell.bands ? j.shell.bands.length : 0,
          standing: j.shell && j.shell.bands ? j.shell.bands.filter(function (b) { return !b.dead; }).length : 0,
        };
      }),
      // the pieces live in CBZ.debris now: live = still tumbling, settled =
      // frozen into rubble (every building's, not just this file's)
      frags: debrisStat("live"), settled: debrisStat("static"),
      skins: skins.size, cap: debrisStat("caps"),
    };
  };

  C.reset = function () {
    for (const job of jobs) { if (job.shell) C.disposeShell(job.shell); }
    jobs.length = 0;
    if (CBZ.debris) owners.forEach(function (k) { try { CBZ.debris.clear(k); } catch (e) {} });
    owners.clear();
    skins.clear();
  };
  C.active = function () { return jobs.length; };

  /* THE RATCHET (Block Law rule 5). `hardcoded` is the number of registered
     facade grammars that have not declared what they are built of, and are
     therefore relying on this file's inference instead of on their author's
     knowledge. Every one that gets a `structure:` field takes it down by one.
     It must never go up: a new grammar declares its material or the number
     moves and the gate catches it. */
  // The Block Law wants the ratchet at CBZ.<name>Audit() on the real game file
  // (never on a tool), so tools/math-gate.mjs can pin it without knowing this
  // file's shape. Same function, two handles.
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
    };
  };
  CBZ.collapseAudit = C.audit;
})();
