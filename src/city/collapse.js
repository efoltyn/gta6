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
      thing that fell was not the thing that was standing. The shell here is
      built FROM the building's own numbers — its wall colour, its storey
      height, its window rhythm, its plinth and cornice — so the frame the
      swap happens on is the frame nobody can see.
   2. NOTHING BROKE. Every mode of destruction was the same downward SCALE.
      A building that shrinks is a building that is being deleted. Real
      collapse is DISINTEGRATION: the floor the front passes stops existing
      and becomes several hundred kilos of slab travelling outward. So every
      band the front consumes is replaced by real fragments with real
      ballistics that land, bounce, settle and stay.
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
     file adds no unbounded work: the shell is qScale'd bands, the fragment
     pool is hard-capped and recycles oldest-first, and a settled fragment
     costs nothing but a lifetime counter.
   • Materials are all CBZ.cmat() cache hits — a collapse allocates
     geometry, never materials.
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
  // vanish instead of breaking into debris (the cheap tier).
  if (CBZ.CONFIG.COLLAPSE_FRAGMENTS == null) CBZ.CONFIG.COLLAPSE_FRAGMENTS = true;
  // The progressive damage dressing on a building that is still STANDING.
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
  /* WHERE IS THE GROUND UNDER THIS PIECE? A collapse throws debris tens of
     metres past its own footprint, and on the disaster island (hills, a
     beach, a volcano skirt) that is a different height from the building's
     base. Seating every fragment at the base height puts half the field
     buried in a slope and the other half hovering over one.

     The caller knows its own terrain oracle, so it hands one in
     (`desc.groundAt`); this falls back to the building's own base, which is
     exactly right for the flat city. Sampled once per fragment at spawn, not
     per frame — a slab does not need to re-solve the hill it is falling
     toward sixty times a second. */
  function groundUnder(desc, x, z) {
    if (desc.groundAt) {
      try { const y = desc.groundAt(x, z); if (Number.isFinite(y)) return y; } catch (e) {}
    }
    return desc.gy || 0;
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
     2. THE FRAGMENT POOL — real debris with real ballistics.

     This is NOT city/crashfx.js's chunk pool and does not duplicate it.
     That pool is for SHRAPNEL: it hard-refuses anything over 3 m
     (cityDebrisAdopt's `debrisSize > 3.0` cull) because a car panel the size
     of a wall reads as a flying billboard. A collapse is made of pieces that
     are exactly the size that pool exists to reject — floor slabs, wall
     sections, whole spandrel panels — so it needs its own budget, its own
     size class and its own rest behaviour (a slab lands flat and STAYS,
     a shrapnel chunk tumbles and expires).

     Everything else is shared: dust goes to crashfx's pooled puffs, small
     spall goes to crashfx's chunk pool, glass goes to cityShatter.
     ============================================================ */
  const FRAG_CAP = () => Math.round(qs(70, 300));
  const frags = [];
  let unitBox = null;
  function boxGeo() {
    if (!unitBox && typeof THREE !== "undefined") unitBox = new THREE.BoxGeometry(1, 1, 1);
    return unitBox;
  }
  function recycleFrag() {
    const f = frags.shift();
    if (!f) return;
    if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
  }

  /* Throw one piece. Sizes are in metres and are the CALLER's business — the
     grammars size them off the band they came from, so a 40 m tower makes
     slabs and a garden shed makes splinters, with no constant in between. */
  function fragment(root, x, y, z, o) {
    if (!CBZ.CONFIG.COLLAPSE_FRAGMENTS || typeof THREE === "undefined") return null;
    const geo = boxGeo();
    if (!geo || !root) return null;
    const cap = FRAG_CAP();
    while (frags.length >= cap) recycleFrag();
    const sx = o.sx, sy = o.sy, sz = o.sz;
    const mesh = new THREE.Mesh(geo, mat(o.col));
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    mesh.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
    mesh.castShadow = false; mesh.receiveShadow = true;
    root.add(mesh);
    const f = {
      mesh: mesh, root: root,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      wx: o.wx || 0, wy: o.wy || 0, wz: o.wz || 0,
      hh: Math.max(sx, sy, sz) * 0.5,
      flat: Math.min(sx, sy, sz) * 0.5,
      gy: o.gy || 0,
      t: 0, settled: false,
      // A slab that has come to rest is part of the rubble field, and the
      // rubble field is the whole point of a collapse you can walk through.
      // It outlives the animation by a long way, then thins out rather than
      // popping — and demolition.js's own permanent pile has landed by then.
      life: o.life || (34 + rnd() * 22),
    };
    frags.push(f);
    return f;
  }
  C.fragment = fragment;

  function stepFrags(dt) {
    for (let i = frags.length - 1; i >= 0; i--) {
      const f = frags[i];
      f.t += dt;
      if (!f.settled) {
        f.vy -= G * 1.25 * dt;                 // slightly heavy: masonry does not float
        const p = f.mesh.position;
        p.x += f.vx * dt; p.y += f.vy * dt; p.z += f.vz * dt;
        f.mesh.rotation.x += f.wx * dt;
        f.mesh.rotation.y += f.wy * dt;
        f.mesh.rotation.z += f.wz * dt;
        const rest = f.gy + f.flat;
        if (p.y <= rest && f.vy <= 0) {
          if (f.vy < -5.5) {
            // it bounces once, hard, and loses most of its energy — which is
            // what makes a debris field spread past the footprint instead of
            // stacking in a neat cone under the building.
            f.vy = -f.vy * 0.20;
            f.vx *= 0.55; f.vz *= 0.55;
            f.wx *= 0.35; f.wy *= 0.35; f.wz *= 0.35;
            p.y = rest;
            if (CBZ.cityDustKick && rnd() < 0.22) {
              try { CBZ.cityDustKick(p.x, rest, p.z, 0.5); } catch (e) {}
            }
          } else {
            // settle: a slab comes to rest roughly flat, tipped by whatever
            // it landed on. Snapping it dead level reads as a placed prop.
            p.y = rest;
            f.settled = true; f.t = 0;
            f.mesh.rotation.x = (rnd() - 0.5) * 0.42;
            f.mesh.rotation.z = (rnd() - 0.5) * 0.42;
          }
        }
      } else if (f.t > f.life) {
        // thin out from underneath rather than vanish
        f.mesh.position.y -= dt * 0.55;
        if (f.t > f.life + 3.2) {
          if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
          frags.splice(i, 1);
        }
      }
    }
  }
  C.fragCount = function () { return frags.length; };

  /* ============================================================
     3. THE LOOK-ALIKE SHELL.

     The proxy that stands in for the batched building. It is built out of the
     building's OWN numbers so the swap is invisible:

       • storey bands at the real floor height, in the real wall colour
       • a window course per storey, inset, in a glass tone taken off the wall
       • a darker plinth at the base and a cornice at the parapet, because a
         building with neither reads as a packing crate
       • FOUR FACE PANELS + A FLOOR SLAB per band on the quality tiers that
         can afford them, so a grammar can peel one face off, expose the slab
         edge, and hand the panel to the fragment pool as a real wall section

     THE PANEL DECOMPOSITION IS THE WHOLE TRICK. It is what lets one shell
     serve five completely different collapse motions without any of them
     knowing about the others: a pancake crushes the band, a topple sheds it
     tangentially, a shear drops the wound-side panels first, a fold rotates
     the panels inward at their base, a crumble blows all four outward.
     ============================================================ */
  // How much shell can this quality tier afford? Band count, and whether a
  // band is decomposed into four face panels plus a floor slab (which is what
  // lets a grammar peel one face off and expose the slabs behind it) or is a
  // single box that still carries the right colour.
  function shellBudget() {
    return { bands: Math.round(qs(3, 9)), panels: qs(0, 1) > 0.45 };
  }

  C.shell = function (desc, prof) {
    if (!CBZ.CONFIG.COLLAPSE_V2 || typeof THREE === "undefined") return null;
    const root = desc.root || CBZ.scene;
    if (!root) return null;
    prof = prof || C.profile(desc);
    const opt = shellBudget();

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
      w: w, d: d, h: h,
    };
  };

  C.disposeShell = function (sh) {
    if (!sh || !sh.outer) return;
    if (sh.outer.parent) sh.outer.parent.remove(sh.outer);
    sh.outer.traverse(function (o) {
      // the unit box is SHARED — disposing it would take out every fragment
      // in flight and every other shell on screen. Materials are cmat cache
      // entries and are never ours to dispose either.
      if (o.isMesh && o.geometry && o.geometry !== unitBox) o.geometry.dispose();
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
    // go, and spawning its debris at the height it was standing at would put
    // half a tower's rubble in the air above the collapse). For a hinge
    // grammar the caller has already solved the rotated world point and
    // passes x/z/wy in.
    const liveY = (band.g && band.g.position ? band.g.position.y : band.y0) + band.h / 2;
    const wy = o.wy != null ? o.wy : (job.desc.gy || 0) + liveY;
    const cx = o.x != null ? o.x : job.desc.ox;
    const cz = o.z != null ? o.z : job.desc.oz;

    for (const p of band.parts) if (p.g) p.g.visible = false;

    if (!CBZ.CONFIG.COLLAPSE_FRAGMENTS) return;
    // COUNT scales with the band's actual mass, not with a constant, so a
    // wide floor plate makes more pieces than a narrow one and a low quality
    // tier makes fewer of everything.
    const area = sh.w * sh.d;
    const base = Math.min(9, Math.max(2, Math.round(Math.sqrt(area) * 0.42)));
    const n = Math.max(1, Math.round(base * m.frag * qs(0.45, 1.15) * (o.count || 1)));
    // SIZE is the band's own slab, broken into that many pieces — that is
    // what makes a tower shed slabs and a shed shed splinters.
    const piece = Math.max(0.55, Math.sqrt(area / Math.max(1, n)) * 0.62 * m.fragSize);
    const spread = (o.spread || 1) * m.spread;
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.2832;
      const rx = (rnd() - 0.5) * sh.w * 0.72, rz = (rnd() - 0.5) * sh.d * 0.72;
      const sx = piece * (0.55 + rnd() * 0.9);
      const sz = piece * (0.55 + rnd() * 0.9);
      const sy = Math.max(0.18, piece * (0.16 + rnd() * 0.35));    // slabs are FLAT
      fragment(sh.root, cx + rx, wy + (rnd() - 0.4) * band.h, cz + rz, {
        sx: sx, sy: sy, sz: sz,
        col: rnd() < 0.30 ? sh.slabCol : mix(sh.wall, sh.slabCol, rnd() * 0.55),
        vx: (o.vx || 0) + Math.cos(a) * (1.4 + rnd() * 3.4) * spread,
        vy: (o.vy || 0) + (rnd() - 0.15) * 3.2,
        vz: (o.vz || 0) + Math.sin(a) * (1.4 + rnd() * 3.4) * spread,
        wx: (rnd() - 0.5) * 7, wy: (rnd() - 0.5) * 7, wz: (rnd() - 0.5) * 7,
        gy: groundUnder(job.desc, cx + rx, cz + rz),
        rx: rnd() * 3, ry: rnd() * 3, rz: rnd() * 3,
      });
    }
    // the air jet: every floor a front passes expels its air and its contents
    if (!band.blew) {
      band.blew = true;
      const a = rnd() * 6.2832;
      try {
        if (CBZ.cityDustKick) CBZ.cityDustKick(cx + Math.cos(a) * sh.w * 0.5, wy, cz + Math.sin(a) * sh.d * 0.5, 1.5 * m.dust);
        if (CBZ.cityChunk) CBZ.cityChunk(cx + Math.cos(a) * sh.w * 0.4, wy, cz + Math.sin(a) * sh.d * 0.4,
          { count: 3, force: 6, dirx: Math.cos(a), dirz: Math.sin(a) });
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
    if (!CBZ.CONFIG.COLLAPSE_FRAGMENTS) return;
    const sh = job.shell, m = job.prof.m;
    // A SHED is cheaper than a PEEL. A pancake sheds the cladding off every
    // band it eats — up to four panels per band, on a nine-band shell — so at
    // full count one tower would churn the whole fragment budget before its
    // front was a third of the way down and the pieces that matter (the slabs
    // the front is actually making) would evict the pieces that already
    // landed. The shear grammar peels ONE face and can afford the detail.
    const n = Math.max(1, Math.round(3 * m.frag * qs(0.5, 1.2) * (mult == null ? 1 : mult)));
    const piece = Math.max(0.5, Math.sqrt(Math.max(part.w || 2, part.d || 2)) * 0.85 * m.fragSize);
    // WHERE THE PANEL ACTUALLY IS. A cladding panel that lets go of floor 30
    // starts at floor 30 and falls thirty floors — spawning it at the kerb
    // (which the first draft of this did) turns the most recognisable read in
    // collapse footage into a puff of dust at the wrong end of the building.
    // The band's group carries the live crush/sink transform, so read the
    // height off it rather than off the plan.
    // band.g.position.y IS the band's base in shell-local space (shell() seats
    // it at y0 and every grammar writes an absolute local base into it), so
    // this is the band's live mid-height, wherever the collapse has moved it.
    const localY = (band.g && band.g.position ? band.g.position.y : band.y0) + band.h * 0.5;
    const wy = (job.desc.gy || 0) + Math.max(0.6, localY);
    const tx = (part.nz || 0), tz = -(part.nx || 0);          // along the face
    for (let i = 0; i < n; i++) {
      const along = (rnd() - 0.5) * Math.max(part.w || 2, part.d || 2) * 0.9;
      const px = job.desc.ox + (part.nx || 0) * sh.w * 0.5 + tx * along;
      const pz = job.desc.oz + (part.nz || 0) * sh.d * 0.5 + tz * along;
      fragment(sh.root, px, wy + (rnd() - 0.5) * band.h * 0.8, pz, {
        sx: piece * (0.6 + rnd()), sy: Math.max(0.2, piece * 0.3), sz: piece * (0.6 + rnd()),
        col: mix(sh.wall, sh.slabCol, rnd() * 0.6),
        // outward off the face, and DOWN — a shed panel pours off the wall,
        // it is not thrown up off it
        vx: (part.nx || 0) * (1.6 + rnd() * 3.2) * m.spread + tx * (rnd() - 0.5) * 2,
        vy: -0.5 - rnd() * 2.5,
        vz: (part.nz || 0) * (1.6 + rnd() * 3.2) * m.spread + tz * (rnd() - 0.5) * 2,
        wx: (rnd() - 0.5) * 8, wy: (rnd() - 0.5) * 8, wz: (rnd() - 0.5) * 8,
        gy: groundUnder(job.desc, px, pz),
      });
    }
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
        if (CBZ.cityDustKick) CBZ.cityDustKick(desc.ox, desc.gy + 0.6, desc.oz, 2.2 * prof.m.dust);
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
              job.desc.oz + (rnd() - 0.5) * job.prof.d, 1.4 * job.prof.m.dust);
            if (CBZ.shake) CBZ.shake(0.5);
          } catch (e) {}
        }
        if (job.t >= job.pre) {
          try { if (job.onSwap) job.onSwap(job); } catch (e) {}
          job.shell = C.shell(job.desc, job.prof);
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
      // less of it than a masonry block does.
      if (CBZ.cityDustKick) {
        const n = Math.round(qs(4, 11) * p.m.dust);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.2832 + rnd() * 0.4;
          const r = 0.6 + rnd() * 0.7;
          CBZ.cityDustKick(d.ox + Math.cos(a) * p.w * r, d.gy + 0.5, d.oz + Math.sin(a) * p.d * r, 2.6 * p.m.dust);
        }
      }
      if (CBZ.cityChunk) CBZ.cityChunk(d.ox, d.gy + 1.4, d.oz, { count: 16, force: 10 });
      if (CBZ.cityShatter) CBZ.cityShatter(d.ox, d.oz, Math.max(p.w, p.d) + 14);
    } catch (e) {}
  }

  /* ============================================================
     6. THE DAMAGE SKIN — all the stages BEFORE the collapse.

     "All stages of destruction." A building that is hit and survives has to
     LOOK hit, and it has to look progressively worse as it takes more. The
     wall itself is merged into core/batch.js's static buffers and cannot be
     edited, so the skin is a small un-batched group that stands a few
     centimetres proud of the real facade and adds what damage actually adds:

       stage 1 SCARRED   blown window openings on the hit face — the panes are
                         out and the openings are dark. Nothing painted ON the
                         wall (the owner purged facade decals for good reason:
                         soot does not stick to a vertical pane).
       stage 2 WOUNDED   whole spandrel panels missing, the FLOOR SLAB EDGES
                         showing through the gap, a panel left hanging off its
                         top fixing, and the first rubble on the pavement.
       stage 3 BURNING   the fire model owns the flame; the skin darkens the
                         openings on burning floors to soot black.
       stage 4 CRITICAL  the load path is going: a bite taken out of the
                         silhouette at the wound floor, columns standing bare
                         where the cladding used to be, rebar, and a real
                         apron of debris on the street. This is the stage that
                         has to make a player say "that's coming down".

     One group per building, rebuilt (not accumulated) whenever the stage
     changes, so it can never grow without bound.
     ============================================================ */
  const skins = new Map();                      // key -> {group, stage}

  C.skin = function (desc, stage, wound) {
    if (!CBZ.CONFIG.COLLAPSE_SKIN || !CBZ.CONFIG.COLLAPSE_V2) return null;
    if (typeof THREE === "undefined") return null;
    const root = desc.root || CBZ.scene;
    if (!root) return null;
    const key = desc.key || (Math.round(desc.ox) + "," + Math.round(desc.oz));
    let rec = skins.get(key);
    if (rec && rec.stage === stage) return rec;
    if (rec) { if (rec.group.parent) rec.group.parent.remove(rec.group); disposeTree(rec.group); skins.delete(key); }
    if (!(stage > 0)) return null;

    const prof = C.profile(desc);
    const wall = desc.wall != null ? desc.wall : 0x8b8f94;
    const dark = mix(shade(wall, 0.18), 0x0a0c10, 0.6);      // the inside of a blown floor
    const slabCol = mix(shade(wall, prof.m.tone), 0x6d7076, 0.45);
    const rebarCol = 0x4a4038;
    const w = { nx: (wound && wound.nx) || 1, nz: (wound && wound.nz) || 0, floor: (wound && wound.floor) || 0 };
    const nl = Math.hypot(w.nx, w.nz) || 1; w.nx /= nl; w.nz /= nl;

    const g = new THREE.Group();
    g.position.set(desc.ox, desc.gy || 0, desc.oz);
    // NAMED so a probe can find this group specifically. Without the tag the
    // only way to identify it from outside is "a group near the building",
    // which finds the BUILDING — and a check that cannot tell the dressing
    // from the thing it is dressing proves nothing.
    g.userData.cbzCollapseSkin = key;
    g.name = "collapseSkin";
    const horiz = Math.abs(w.nz) > Math.abs(w.nx);
    const halfN = horiz ? prof.d / 2 : prof.w / 2;
    const span = horiz ? prof.w : prof.d;
    const out = horiz ? Math.sign(w.nz) || 1 : Math.sign(w.nx) || 1;
    const FH = prof.FH;
    /* HOW MUCH OF THE FACADE IS GONE, BY STAGE. Two numbers, and they scale
       differently on purpose:

         bite   how far ACROSS the face the wound reaches, as a fraction of
                its bays. This is a fraction because a wide building loses
                proportionally more of a wide face.
         floors how far UP it reaches. This is NOT a fraction of the storeys:
                a wound is LOCAL to where the thing hit, so "10% of the
                building" on a 52-storey tower would put five floors of
                destruction on the frame after one rocket. It grows with the
                stage and only weakly with height (a tall building's wound
                does run further, because there is more load above it to
                redistribute), and it is centred on the floor that was hit. */
    const bite = [0, 0.10, 0.30, 0.34, 0.62][Math.min(4, stage)] || 0;
    const spanByStage = [0, 1, 2, 2, 4][Math.min(4, stage)] || 1;
    const floors = Math.max(1, Math.min(prof.storeys,
      Math.round(spanByStage * (1 + prof.storeys / 40))));
    const f0 = Math.max(0, Math.min(prof.storeys - 1, w.floor - Math.floor(floors / 2)));

    function put(t, y, len, h, depth, col, dz) {
      const m = new THREE.Mesh(boxGeo(), mat(col));
      const n = halfN + (dz || 0);
      if (horiz) { m.scale.set(len, h, depth); m.position.set(t, y, out * n); }
      else { m.scale.set(depth, h, len); m.position.set(out * n, y, t); }
      g.add(m);
      return m;
    }

    const bays = Math.max(2, Math.round(span / 4.2));
    const bayW = span / bays;
    for (let fi = 0; fi < floors; fi++) {
      const fl = f0 + fi;
      if (fl >= prof.storeys) break;
      const y = fl * FH;
      // how wide the wound is on this floor — widest at the hit, tapering up
      const rel = 1 - Math.abs(fl - w.floor) / Math.max(1, floors);
      const nOut = Math.max(1, Math.round(bays * bite * (0.6 + rel * 0.9)));
      for (let bi = 0; bi < nOut; bi++) {
        const idx = Math.floor(bays / 2) + (bi % 2 ? 1 : -1) * Math.ceil(bi / 2);
        if (idx < 0 || idx >= bays) continue;
        const t = -span / 2 + (idx + 0.5) * bayW;
        // THE OPENING — a dark void set slightly INTO the wall, which is what
        // a missing panel actually looks like: you see the floor above's
        // soffit and nothing else.
        put(t, y + FH * 0.55, bayW * 0.86, FH * 0.72, 0.5, stage >= 3 ? shade(dark, 0.5) : dark, -0.26);
        // THE SLAB EDGE — visible through the hole. This single detail is
        // what stops a wound reading as a painted black rectangle.
        if (stage >= 2) put(t, y + 0.14, bayW * 0.9, 0.26, 0.34, slabCol, -0.1);
        // REBAR hanging out of the broken slab
        if (stage >= 4 && (bi & 1) === 0) {
          for (let k = 0; k < 3; k++) {
            const m = put(t + (k - 1) * bayW * 0.22, y - 0.35, 0.05, 0.9, 0.05, rebarCol, 0.05);
            m.rotation.z = (rnd() - 0.5) * 0.7;
          }
        }
      }
      // A PANEL LEFT HANGING off its top fixing — the most legible "this was
      // violent" cue on any damaged building, and it costs one box.
      if (stage >= 2 && fi === 0) {
        const t = -span / 2 + (Math.floor(bays / 2) + 1.5) * bayW;
        const m = put(t, y + FH * 0.35, bayW * 0.7, FH * 0.6, 0.3, shade(wall, 0.92), 0.34);
        m.rotation[horiz ? "x" : "z"] = (horiz ? -out : out) * (0.5 + rnd() * 0.5);
      }
    }

    // BARE COLUMNS at CRITICAL — the cladding is gone off a whole bay and
    // what is left holding the building up is visible from the street.
    if (stage >= 4) {
      for (let bi = 0; bi <= bays; bi++) {
        if ((bi & 1) === 0) continue;
        const t = -span / 2 + bi * bayW;
        put(t, w.floor * FH + FH, 0.55, FH * 2.1, 0.55, mix(slabCol, 0x3c4046, 0.5), -0.2);
      }
    }

    // THE APRON. Everything that came off the building is on the pavement
    // under it, and it grows with the stage. Not fragments — those are live
    // physics and this is settled world — just seated lumps.
    if (stage >= 2) {
      const n = Math.round(qs(3, 9) * (stage >= 4 ? 2.1 : 1));
      for (let i = 0; i < n; i++) {
        const t = (rnd() - 0.5) * span * 0.95;
        const off = halfN + 0.7 + rnd() * (stage >= 4 ? 4.5 : 2.2);
        const s = 0.4 + rnd() * (stage >= 4 ? 1.7 : 0.9);
        const m = new THREE.Mesh(boxGeo(), mat(mix(wall, slabCol, rnd())));
        m.scale.set(s, s * (0.25 + rnd() * 0.4), s * (0.6 + rnd() * 0.8));
        if (horiz) m.position.set(t, s * 0.18, out * off);
        else m.position.set(out * off, s * 0.18, t);
        m.rotation.set((rnd() - 0.5) * 0.5, rnd() * 3, (rnd() - 0.5) * 0.5);
        m.receiveShadow = true;
        g.add(m);
      }
    }

    root.add(g);
    rec = { group: g, stage: stage, key: key };
    skins.set(key, rec);
    return rec;
  };

  C.skinClear = function (desc) {
    const key = (desc && desc.key) || (desc && (Math.round(desc.ox) + "," + Math.round(desc.oz)));
    const rec = skins.get(key);
    if (!rec) return false;
    if (rec.group.parent) rec.group.parent.remove(rec.group);
    disposeTree(rec.group);
    skins.delete(key);
    return true;
  };
  C.skinCount = function () { return skins.size; };

  function disposeTree(o) {
    o.traverse(function (n) { if (n.isMesh && n.geometry && n.geometry !== unitBox) n.geometry.dispose(); });
  }

  /* ============================================================
     7. TICK + RESET + AUDIT
     ============================================================ */
  if (CBZ.onUpdate) CBZ.onUpdate(34.46, function (dt) {
    if (!jobs.length && !frags.length) return;
    const d = dt > 0.25 ? 0.25 : dt;
    if (jobs.length) stepJobs(d);
    if (frags.length) stepFrags(d);
  });

  /* WHAT IS HAPPENING RIGHT NOW — the probe seam. A collapse is a four-second
     animation, which makes it exactly the kind of feature that photographs
     fine and is broken in every way that matters. Every number a tool or a
     storyboard needs to wait on a REAL state (rather than on a wall-clock
     second, which is the pacing fault tools/visual-presets/README.md calls
     out by name) is published here: which grammar each live job picked, what
     phase it is in, how far through the fall it is. */
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
      frags: frags.length, settled: frags.filter(function (f) { return f.settled; }).length,
      skins: skins.size, cap: FRAG_CAP(),
    };
  };

  C.reset = function () {
    for (const job of jobs) { if (job.shell) C.disposeShell(job.shell); }
    jobs.length = 0;
    for (const f of frags) if (f.mesh.parent) f.mesh.parent.remove(f.mesh);
    frags.length = 0;
    skins.forEach(function (rec) { if (rec.group.parent) rec.group.parent.remove(rec.group); disposeTree(rec.group); });
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
      live: jobs.length, frags: frags.length, skins: skins.size,
    };
  };
  CBZ.collapseAudit = C.audit;
})();
