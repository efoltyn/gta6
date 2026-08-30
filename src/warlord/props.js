/* ============================================================
   warlord/props.js — THE OBJECT LIBRARY. Everything on this island that is
   a THING you can see and is not terrain and is not a person.

   WHY ONE FILE AND NOT TWO. The campaign layer flies over a depot at 400 m
   and the battle layer fights beside the same depot at 4 m. If each layer
   owned its own depot they would drift within a week: the campaign's would
   grow a crane, the battle's would grow cover, and the player would ride to
   a landmark and arrive somewhere else. So there is ONE depot, built once,
   with a near half and a far half, and both layers ask this file for it.

   WHAT IT PUBLISHES

     W.props.outpost(kind, opts)   depot | camp | well | market — the four
                                   kinds outpost.js already declares, as places
     W.props.banner(colour, opts)  one hero flag, cloth that moves
     W.props.bannerField(opts)     sixty of them in three draw calls
     W.props.wreck(kind, opts)     truck | plane | tank | caravan | bones
     W.props.cover(kind, opts)     sandbag | gabion | barricade | ruin |
                                   boulder | slab | bank | palm | crate
     W.props.coverField(list)      a whole battlefield's cover, batched
     W.props.bivouac(opts)         YOUR camp: fires, bedrolls, picket, rifles
     W.props.palm/fire/tent/...    the pieces, exposed, because a second copy
                                   of a palm is exactly what this file exists
                                   to stop
     W.props.scatterKit()          shared geometry+material for desert.js's
                                   instanced scatter (see NOTE TO desert.js)
     W.props.place(g, x,y,z, yaw)  put it in the world and register its cover
     W.props.lodTick(camPos)       near/far swap, driven off CBZ.onUpdate

   EVERY FACTORY RETURNS A THREE.Group AT THE ORIGIN, +Y up, facing +Z, with
   `userData.colliders` = the boxes that are real cover, in LOCAL metres. The
   caller places it. Nothing here touches W.state, and nothing here adds
   itself to the scene.

   ---------------------------------------------------------------------
   WHAT I REUSED, AND WHAT I HAD TO MAKE, AND WHY

   REUSED, straight:
     · CBZ.cmat / CBZ.boxGeom  (world/materials.js, on the page through the
       `look` pack that `people` pulls in) — the shared material and geometry
       caches. Every colour in this file goes through cmat, so a hundred
       sandbags share one material instance.
     · CBZ.batchStaticUnder (core/batch.js, in this page's NEED list) — a
       depot leaves this file as ~13 draw calls instead of ~70 because the
       inert boxes get merged before the group is returned. Measured below.
     · CBZ.makeRock (world/rockscliffs.js) — the scrape/spall boulder. Its
       fractured facets are what a desert boulder looks like and an
       Icosahedron is not; I am not writing a second one. See LAZY, below.
     · CBZ.studio.model("truck"|"tank"|"cargo"|"heli") — the repo's SHIPPED
       military models. A burnt-out truck is that truck, tilted, sunk and
       charred. Redrawing a truck out of boxes when city/island_military.js
       already ships one would be the single dumbest thing in this file.
     · CBZ.weaponAppearance.<id> — the REAL rifles, for the stacked-arms pile
       in a camp. Three actual AKs leaning together, not three brown boxes.

   HAD TO MAKE, and why the existing one did not fit:
     · The outposts, the banners, the tents, the shade cloth, the well head,
       the wrecking/charring, the sandbag walls. Nothing like these exists.
     · A palm. world/vegetation.js's kit is temperate (trunk/crown/spire) and
       city/beach.js DOES have a good leaning palm — but it is written inline
       inside cityBuildBeach(), reads that function's local rng and pier
       position, and is not callable. Extracting it means editing beach.js,
       which is not mine to edit. So the palm here copies its TECHNIQUE
       (instanced trunk + a crown hub instance + six drooping fronds, the
       trunk-top read off the instance matrix rather than re-derived with
       hand trig — beach.js's own TREES_V2 bug note) and none of its code.
     · Sandbags/crates/barricades. world/crates.js and world/clutter.js draw
       these, but both are LOAD-TIME PASSES that stamp the prison yard at
       fixed coordinates off CBZ.WORLD/CBZ.DIM. They are not factories, they
       are not in any studio pack, and razorwire.js/towers.js would throw at
       load on this page (`CBZ.DIM.YH` of a prison that does not exist here).

   LAZY, and why: rockscliffs.js and the military models are in NO studio
   pack, so this page does not have them. boot() appends both — a script tag
   and one studio.need() — and nothing in this file builds until it is asked.
   A wreck asked for before the models land is EMPTY and fills itself when
   they arrive, rather than being a box that later disagrees with the same
   wreck built one second later. Shape stability beats being on screen a
   frame earlier; a prop that changes shape when a chunk reloads is the exact
   defect the determinism rule exists to stop.

   DETERMINISM: every variation comes off W.rngFrom(seed) or W.hash01. There
   is no Math.random in this file.

   MATERIALS: 23 shared materials for the whole library, all through
   CBZ.cmat, so a depot, a camp and four hundred rocks between them own
   twenty-three material objects. Counted in W.props.audit().

   EVENTS: none. This file answers questions; it does not have opinions.

   FLAGS: ?propkit=old   every factory returns the flat primitive the rest of
                         the game drew before this file existed (desert.js's
                         icosahedron rock, battle.js's rotated cover box, a
                         bare pole for a banner). This is the honest A/B: it
                         is not "props off", it is the game one commit ago.
          ?props=1       the gallery — every prop in a row on a flat pad, so
                         this file is never blocked on another agent's.
          ?wrecks=box    do not lazy-load the military pack; box wrecks.
          ?proprock=box  do not lazy-load rockscliffs.js; icosahedron rocks.
============================================================ */
(function () {
  "use strict";
  const G = (typeof window !== "undefined" ? window : globalThis);
  const CBZ = (G.CBZ = G.CBZ || {});
  const W = (CBZ.warlord = CBZ.warlord || {});
  if (!W.state) { console.error("[warlord] props.js loaded without core.js"); return; }
  const THREE = G.THREE;

  const Q = new URLSearchParams(G.location ? G.location.search : "");
  const OLD = Q.get("propkit") === "old";
  const NO_MIL = Q.get("wrecks") === "box";
  const NO_ROCK = Q.get("proprock") === "box";
  const TAU = Math.PI * 2;

  const P = {};                       // the published API; W.module("props", P) at the end

  /* ============================================================ MATERIALS
     ONE TABLE. Everything in this file paints from it, so the whole library
     costs 23 material objects however many depots you build. cmat() is
     world/materials.js's shared cache — the same call world/crates.js and
     city/beach.js make — so if the city is ever on the page beside us we
     share ITS instances too rather than minting near-duplicates.

     The desert palette is deliberately narrow and low-chroma. The first pass
     used saturated tent canvas and shipping-container reds straight off a
     reference photo; against desert.js's sand (0xc8ab74-ish at noon) they
     read as toys. Everything is pulled toward the sand except the three
     container paints and the banners, which are the only things allowed to
     shout — and they shout because that is their JOB, they are how you
     recognise a place and a faction from a kilometre away. */
  const COL = {
    sand:       0xbda574,
    sandDark:   0x8e7647,
    canvas:     0xcbbc98,   // tent cloth, sun-bleached
    canvasDark: 0xa08a5f,
    tarp:       0x8a7f63,
    wood:       0x6d5233,
    woodDark:   0x483722,
    metal:      0x767c82,
    metalDark:  0x3d434a,
    rust:       0x8b4e2e,
    char:       0x241f1a,   // what a burnt thing is
    rock:       0x8a7a63,   // matched to desert.js's scatter rock on purpose
    rockDark:   0x6b5f4c,
    palmTrunk:  0x6b5334,   // matched to desert.js's oasis palms, same reason
    frond:      0x3d6f2c,
    bone:       0xd8cfb4,
    rope:       0xa8946c,
    hide:       0x7a5a3c,
    water:      0x3f7f8f,
    boxRed:     0x9c4a35,
    boxBlue:    0x2f5a72,
    boxGreen:   0x4a6a48,
    ember:      0xff7a2a,
  };
  const _mats = {};
  function M(key) {
    let m = _mats[key];
    if (m) return m;
    const c = COL[key];
    if (key === "ember") {
      // a fire has to be visible in daylight, and a Lambert lit by the sun is
      // not. Emissive at full is the cheapest honest answer; no light is
      // added — sixty campfires with real point lights is how a phone dies.
      m = CBZ.cmat ? CBZ.cmat(c, { emissive: 0xff5a10, ei: 1 })
        : new THREE.MeshLambertMaterial({ color: c, emissive: 0xff5a10 });
    } else {
      m = CBZ.cmat ? CBZ.cmat(c) : new THREE.MeshLambertMaterial({ color: c });
    }
    _mats[key] = m;
    return m;
  }
  /* CLOTH IS TWO-SIDED AND THE SHARED CACHE IS NOT. cmat() hands back ONE
     material instance per colour to the whole engine; writing side =
     DoubleSide on it to make a shade sail work turns every rock, crate and
     container in the game double-sided too — twice the overdraw, for a bug
     nobody would ever trace back to a tarpaulin. So cloth gets its own tiny
     parallel table. Four entries, and they are the only materials in this
     file that are not cmat's. */
  const _twoSide = {};
  function MD(key) {
    let m = _twoSide[key];
    if (m) return m;
    m = new THREE.MeshLambertMaterial({ color: COL[key], side: THREE.DoubleSide });
    m._shared = true;
    _twoSide[key] = m;
    return m;
  }
  // smoke/haze wants its own transparent material and must never be batched
  let _smokeMat = null;
  function smokeMat() {
    if (!_smokeMat) {
      _smokeMat = new THREE.MeshBasicMaterial({
        color: 0xbfb5a4, transparent: true, opacity: 0.16, depthWrite: false,
        side: THREE.DoubleSide, fog: true,
      });
    }
    return _smokeMat;
  }

  /* ============================================================ GEOMETRY
     boxGeom is materials.js's shared cache. Falling back to a local one
     rather than `new BoxGeometry` per call matters here: a camp is ninety
     boxes and a coverField is four hundred. */
  const _geo = new Map();
  function BG(w, h, d) {
    if (CBZ.boxGeom) return CBZ.boxGeom(w, h, d);
    const k = "b" + w + "," + h + "," + d;
    let g = _geo.get(k);
    if (!g) { g = new THREE.BoxGeometry(w, h, d); g._shared = true; _geo.set(k, g); }
    return g;
  }
  function CG(rt, rb, h, seg) {
    const k = "c" + rt + "," + rb + "," + h + "," + seg;
    let g = _geo.get(k);
    if (!g) { g = new THREE.CylinderGeometry(rt, rb, h, seg || 8); g._shared = true; _geo.set(k, g); }
    return g;
  }
  // place a box. Returns the mesh so a caller can tilt it.
  function box(parent, w, h, d, mat, x, y, z, ry, rx, rz) {
    const m = new THREE.Mesh(BG(w, h, d), mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (ry || rx || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function cyl(parent, rt, rb, h, seg, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(CG(rt, rb, h, seg), mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  // a raw triangle soup -> flat-shaded BufferGeometry. Used for the tent
  // prism and the sagging cloth, which are the two shapes a box cannot be.
  function soup(tris) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tris), 3));
    g.computeVertexNormals();
    return g;
  }

  /* ============================================================ DICE
     One stream per prop, seeded by the caller. A depot built at the same
     seed is the same depot on every machine and after every reload — which
     is the whole point, because outpost.js hands out positions from a hash
     and campaign.js will rebuild these when a chunk comes back. */
  function stream(seed) {
    const r = W.rngFrom((seed == null ? 1 : seed | 0) || 1);
    return {
      f: r,
      range: function (a, b) { return a + r() * (b - a); },
      pick: function (arr) { return arr[Math.floor(r() * arr.length) % arr.length]; },
      chance: function (p) { return r() < p; },
    };
  }

  /* ============================================================ LAZY DEPS
     Two engine assets this game genuinely wants and this page does not load:
     the fractured boulder and the military models. Both are pulled here, at
     boot, and both have an explicit "not yet" state so nothing builds a
     provisional shape it would later contradict. */
  let rockReady = false, rockAsked = false;
  const rockWaiters = [];
  function wantRock() {
    if (rockAsked || NO_ROCK || OLD) return;
    rockAsked = true;
    if (CBZ.makeRock) { rockReady = true; return; }
    if (!G.document || !CBZ.studio || !CBZ.studio.root) return;
    const s = G.document.createElement("script");
    s.src = CBZ.studio.root + "world/rockscliffs.js";
    s.async = false;
    s.onload = function () {
      rockReady = !!CBZ.makeRock;
      while (rockWaiters.length) { try { rockWaiters.shift()(); } catch (e) {} }
    };
    s.onerror = function () { console.warn("[warlord/props] rockscliffs.js did not load; boulders are icosahedra"); };
    G.document.head.appendChild(s);
  }

  let milState = "idle";              // idle | loading | ready | absent
  const milWaiters = [];
  function wantMil() {
    if (milState !== "idle") return;
    if (NO_MIL || OLD) { milState = "absent"; return; }
    if (CBZ.milModels || (CBZ.studio && CBZ.studio.model && CBZ.studio.models().length)) { milState = "ready"; return; }
    if (!CBZ.studio || !CBZ.studio.need) { milState = "absent"; return; }
    milState = "loading";
    CBZ.studio.need(["military"]).then(function () {
      milState = CBZ.milModels ? "ready" : "absent";
      flushMil();
    }).catch(function (e) {
      console.warn("[warlord/props] military pack absent; wrecks are primitives", e);
      milState = "absent";
      flushMil();
    });
  }
  function flushMil() { while (milWaiters.length) { try { milWaiters.shift()(); } catch (e) {} } }
  function onMil(fn) {
    if (milState === "ready" || milState === "absent") { fn(); return; }
    milWaiters.push(fn);
  }
  /* THE MODEL FACTORIES DO NOT RETURN AN Object3D. Every one of
     CBZ.milModels' builders returns a RECORD — {group, footW, footL, height}
     — because the airbase needs the dimensions to park it. Assuming an
     Object3D came back and writing .position.y on it is a
     "Cannot set properties of undefined" one line later, which is exactly
     what the first run of this file did. Unwrap, and keep the record on
     userData so a caller that wants the real footprint has it. */
  function milModel(name) {
    if (milState !== "ready") return null;
    let rec = null;
    try { rec = CBZ.studio && CBZ.studio.model ? CBZ.studio.model(name) : null; } catch (e) { return null; }
    if (!rec) return null;
    const g = rec.isObject3D ? rec : rec.group;
    if (!g || !g.isObject3D) return null;
    if (!rec.isObject3D) g.userData.milRec = { footW: rec.footW, footL: rec.footL, height: rec.height };
    return g;
  }
  /* AND SEAT IT ON THE SAND BY MEASURING IT. world/airbase.js's own note:
     "parked aircraft sit on their wheels because seat() measures the bounding
     box instead of guessing a gear drop". Same problem here and the same
     answer — these models are authored around whatever origin their author
     found convenient, and a wreck floating 40 cm over its own scorch mark is
     the single most obvious defect this file could ship. */
  function seat(obj, sink) {
    const bb = new THREE.Box3().setFromObject(obj);
    if (!isFinite(bb.min.y)) { obj.position.y = -sink; return 0; }
    obj.position.y -= bb.min.y + sink;
    return bb.max.y - bb.min.y;
  }

  /* ============================================================ BATCHING
     core/batch.js merges every inert flat-colour mesh under a root into a
     handful of big ones. It is the difference between a depot costing ~70
     draw calls and ~13 (measured with renderer.info in the ?props=1
     gallery — the numbers are printed by W.props.audit()).

     THREE RULES it imposes, and all three are load-bearing here:
       1. It bakes into WORLD space off matrixWorld, so it must run while the
          group is still at the origin — i.e. inside the factory, before the
          caller places it. That is why every factory ends with settle().
       2. It refuses any mesh carrying userData and skips any subtree tagged
          userData.dynamic. So everything that moves (banner cloth, fire
          flicker, smoke) lives under a group tagged `dynamic` and survives.
       3. It merges across the whole subtree, so a near-LOD mesh and a
          far-LOD mesh handed to it together end up in ONE mesh and the LOD
          can never be toggled again. near and far are settled separately.

     freezeStaticUnder is NOT called here — it sets matrixAutoUpdate=false on
     the ROOT too, which would silently swallow the caller's own position
     write. It belongs in place(), after the group has been put somewhere. */
  function settle(root) {
    if (!root) return root;
    try { if (CBZ.batchStaticUnder) CBZ.batchStaticUnder(root); } catch (e) {}
    return root;
  }

  /* ============================================================ COLLIDERS
     A collider here is a plain {x,y,z,w,h,d} in the group's LOCAL frame, y
     being the box CENTRE. place() rotates it into the world and registers it
     with CBZ.micro.addBoxCollider, which is the same registry combat_iq's
     cover search reads through CBZ.queryCollidersNear.

     combat_iq's own thresholds (systems/combat_iq.js, COVER_MIN_H 0.85 /
     COVER_MIN_W 0.7 / y0 <= 1.2) decide whether a box is cover at all, so
     anything in this file that is MEANT as cover is at least 1.0 m tall,
     0.8 m across and sits on the ground. A 0.6 m sandbag course looks right
     in a photograph and is invisible to every fighter on the field, which is
     worse than not drawing it. Anything below the bar is tagged solid:true,
     cover:false — it still stops a body, it just does not pretend. */
  function col(list, x, y, z, w, h, d, tag) {
    list.push({ x: x, y: y, z: z, w: w, h: h, d: d, tag: tag || "" });
    return list;
  }

  /* THE AABB PROBLEM, STATED. micro's colliders are axis-aligned; a prop
     placed at a yaw is not. There is no exact AABB for a rotated box, so the
     footprint is expanded to the rotated box's own bounding rectangle. That
     errs toward MORE solid, which for cover is the right direction to err —
     a man who thinks a sandbag wall is 20 cm wider than it is takes cover
     behind it; a man who thinks it is narrower stands in the open. */
  P.place = function (group, x, y, z, yaw) {
    if (!group) return null;
    yaw = yaw || 0;
    group.position.set(x || 0, y || 0, z || 0);
    group.rotation.y = yaw;
    group.updateMatrixWorld(true);
    const cs = (group.userData && group.userData.colliders) || [];
    const M2 = CBZ.micro;
    const out = [];
    if (M2 && M2.addBoxCollider) {
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        if (c.cover === false && c.solid === false) continue;
        const wx = x + c.x * cy + c.z * sy;
        const wz = z - c.x * sy + c.z * cy;
        const ew = Math.abs(c.w * cy) + Math.abs(c.d * sy);
        const ed = Math.abs(c.w * sy) + Math.abs(c.d * cy);
        out.push(M2.addBoxCollider(wx, y + c.y, wz, ew, c.h, ed,
          { warlordProp: true, propTag: c.tag || "" }));
      }
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    group.userData.placed = out;
    // matrix freeze last: the group's own transform is final from here.
    try { if (CBZ.freezeStaticUnder) CBZ.freezeStaticUnder(group); } catch (e) {}
    return group;
  };
  P.unplace = function (group) {
    const M2 = CBZ.micro;
    const raised = group && group.userData && group.userData.placed;
    if (!raised || !M2 || !M2.colliders) return;
    for (let i = raised.length - 1; i >= 0; i--) {
      const at = M2.colliders.indexOf(raised[i]);
      if (at >= 0) M2.colliders.splice(at, 1);
    }
    group.userData.placed = null;
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (M2.rebuildColliderGrid) M2.rebuildColliderGrid();
  };

  /* ============================================================ LOD
     These get drawn at 30 m and at 3 km. At 3 km one metre is a third of a
     pixel at this fov, so a depot is a SHAPE and nothing else — and the
     shape had better be the right one, because it is how you navigate a 14
     km island. Each outpost therefore carries two children: `near`, the
     real thing, and `far`, a deliberately over-scaled block silhouette
     (crane + container row, a cluster of triangles, a palm crown and a
     sail). The far version is exaggerated ON PURPOSE — a 2.6 m container is
     a quarter pixel at 3 km and a 9 m one is nearly a pixel, and being
     recognisable beats being to scale at a range where nothing is to scale.

     SWITCH DISTANCE 420 m: measured against desert.js's fog (fogNear 1400)
     — past ~400 m the near version's detail is under a pixel and the two
     read identically, and below it the far version's exaggeration shows. */
  const LOD_SWITCH = 420;
  const lodList = [];
  function lodable(group, near, far, r) {
    group.userData.lod = { near: near, far: far, r: r || LOD_SWITCH };
    far.visible = false;
    lodList.push(group);
    return group;
  }
  P.lodTick = function (camPos) {
    if (!camPos) return 0;
    let swapped = 0;
    for (let i = lodList.length - 1; i >= 0; i--) {
      const g = lodList[i];
      if (!g.parent) { lodList.splice(i, 1); continue; }   // dropped from the scene
      const L = g.userData.lod;
      const dx = g.position.x - camPos.x, dz = g.position.z - camPos.z;
      const farSide = (dx * dx + dz * dz) > L.r * L.r;
      if (L.near.visible === farSide) {
        L.near.visible = !farSide;
        L.far.visible = farSide;
        swapped++;
      }
    }
    return swapped;
  };
  P.forget = function (group) {
    const at = lodList.indexOf(group);
    if (at >= 0) lodList.splice(at, 1);
  };

  /* ============================================================ PIECES
     The vocabulary. Everything below builds out of these, and they are
     published because outpost.js/battle.js/campaign.js wanting "a palm" or
     "a fire" is the exact situation this file exists to answer once. */

  /* A PALM. Technique borrowed from city/beach.js's TREES_V2 note: the crown
     hub sits at the trunk-top read off the trunk's own matrix, and the six
     fronds are pulled INWARD so their inner ends run through the hub. The
     bug that note records — deriving the leaned top with hand trig and a
     wrong sign, so the frond ring floats beside the trunk — is avoided here
     the cheap way: this palm leans by rotating the whole GROUP, so the trunk
     top is trivially (0, h, 0) in group space and there is no trig to get
     wrong. */
  P.palm = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const r = stream(opts.seed);
    const h = opts.h || r.range(6.5, 10.5);
    const lean = opts.lean == null ? r.range(-0.16, 0.16) : opts.lean;
    const yaw = opts.yaw == null ? r.f() * TAU : opts.yaw;
    cyl(g, 0.20, 0.34, h, 6, M("palmTrunk"), 0, h / 2 - 0.25, 0);
    // the fibrous boss the fronds actually grow out of
    cyl(g, 0.44, 0.30, 0.7, 6, M("palmTrunk"), 0, h - 0.2, 0);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = yaw + i * (TAU / n) + r.range(-0.16, 0.16);
      const len = r.range(2.5, 3.6);
      const droop = r.range(0.30, 0.55);
      const f = box(g, len, 0.09, 0.66, M("frond"),
        Math.cos(a) * (len * 0.42), h - 0.05 - len * 0.42 * Math.sin(droop), Math.sin(a) * (len * 0.42));
      f.rotation.set(0, -a, -droop);
    }
    if (r.chance(0.55)) {                       // dates, because a palm has a colour on it
      const b = box(g, 0.5, 0.4, 0.5, M("rust"), 0, h - 0.55, 0);
      b.rotation.y = yaw;
    }
    g.rotation.z = lean;
    g.rotation.y = yaw * 0.3;
    g.userData.colliders = [];
    col(g.userData.colliders, 0, h / 2, 0, 0.8, Math.min(h, 3.4), 0.8, "palm");
    return g;
  };

  /* A FIRE. Log tripod, an ember core, and a smoke column — and the smoke is
     the part that matters. A camp you cannot see from a kilometre away is
     not a landmark, and at that range the tents are two pixels and the smoke
     is forty. It is one tapered double-sided quad pair, unlit, sorted behind
     nothing, and it drifts on a sine. */
  P.fire = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const r = stream(opts.seed);
    const rad = opts.r || 0.9;
    // stone ring
    const ring = new THREE.InstancedMesh(BG(0.34, 0.24, 0.3), M("rock"), 9);
    const d = new THREE.Object3D();
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU + r.range(-0.1, 0.1);
      d.position.set(Math.cos(a) * rad, 0.1, Math.sin(a) * rad);
      d.rotation.set(0, a, r.range(-0.2, 0.2));
      d.scale.setScalar(r.range(0.75, 1.3));
      d.updateMatrix(); ring.setMatrixAt(i, d.matrix);
    }
    ring.castShadow = true;
    g.add(ring);
    // logs, leaning in
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + r.range(-0.3, 0.3);
      const L = box(g, 0.16, 0.16, 1.5, M("woodDark"), Math.cos(a) * 0.4, 0.28, Math.sin(a) * 0.4);
      L.rotation.set(0.62, -a + Math.PI / 2, 0);
    }
    // the live half: embers + smoke, tagged dynamic so batch.js leaves it be
    const live = new THREE.Group();
    live.userData.dynamic = true;
    const flame = new THREE.Mesh(CG(0.02, 0.42, 1.0, 6), M("ember"));
    flame.position.y = 0.55;
    live.add(flame);
    if (opts.smoke !== false) {
      const H = opts.smokeH || 11;
      const sm = new THREE.Mesh(smokeCol(H), smokeMat());
      sm.position.y = 0.9;
      sm.castShadow = false; sm.receiveShadow = false;
      live.add(sm);
      live.userData.smoke = sm;
    }
    live.userData.flame = flame;
    live.userData.phase = r.f() * TAU;
    g.add(live);
    g.userData.live = live;
    liveFires.push(live);
    g.userData.colliders = [];
    return g;
  };
  // a smoke column: two crossed tapered quads, widening and fading upward.
  function smokeCol(h) {
    const w0 = 0.7, w1 = h * 0.42;
    const t = [];
    function quad(ax, az) {
      // (-w0..w0) at the base, (-w1..w1) at the top, leaning downwind in +x
      const drift = h * 0.35;
      const p = function (u, v) {
        const wq = w0 + (w1 - w0) * v;
        return [ax * u * wq + drift * v * v, v * h, az * u * wq];
      };
      const a = p(-1, 0), b = p(1, 0), c = p(1, 1), e = p(-1, 1);
      t.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      t.push(a[0], a[1], a[2], c[0], c[1], c[2], e[0], e[1], e[2]);
    }
    quad(1, 0); quad(0, 1);
    return soup(t);
  }

  /* A RIDGE TENT, as one prism geometry rather than five boxes, because a
     camp is nine of them and a prism instances where five boxes do not. */
  let _tentGeo = null;
  function tentGeo() {
    if (_tentGeo) return _tentGeo;
    const w = 1.6, h = 1.0, l = 2.3;      // half-extents; instances scale it
    const t = [];
    const A = [-w, 0, -l], B = [w, 0, -l], C = [w, 0, l], D = [-w, 0, l];
    const R0 = [0, h, -l], R1 = [0, h, l];
    function tri(p, q, s) { t.push(p[0], p[1], p[2], q[0], q[1], q[2], s[0], s[1], s[2]); }
    tri(A, R0, R1); tri(A, R1, D);         // left slope
    tri(B, C, R1); tri(B, R1, R0);         // right slope
    tri(A, B, R0);                         // back gable
    tri(D, R1, C);                         // front gable
    _tentGeo = soup(t);
    return _tentGeo;
  }
  P.tents = function (list, opts) {
    opts = opts || {};
    const im = new THREE.InstancedMesh(tentGeo(), M(opts.mat || "canvas"), list.length);
    const d = new THREE.Object3D();
    const hasCol = !!im.setColorAt;
    const c = new THREE.Color();
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      d.position.set(t.x, t.y || 0, t.z);
      d.rotation.set(0, t.yaw || 0, 0);
      d.scale.set(t.s || 1, t.sy || t.s || 1, t.s || 1);
      d.updateMatrix(); im.setMatrixAt(i, d.matrix);
      // per-tent bleach: real canvas in a desert is nine shades of the same
      // colour, and one flat tint is the loudest "generated" signal there is
      if (hasCol) { const k = 0.82 + (t.tint == null ? 0.3 : t.tint) * 0.34; c.setHex(COL[opts.mat || "canvas"]).multiplyScalar(k); im.setColorAt(i, c); }
    }
    im.instanceMatrix.needsUpdate = true;
    if (hasCol && im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    return im;
  };

  /* SAGGING CLOTH — a shade sail, a market tarpaulin, a tent fly. Four
     corners and a catenary droop in the middle. A flat quad reads as a
     sheet of plywood; the droop is the entire difference between "cloth"
     and "a plane with a cloth colour on it". */
  function sagGeo(w, d, sag, seg) {
    seg = seg || 4;
    const t = [];
    const at = function (i, j) {
      const u = i / seg, v = j / seg;
      const dip = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * sag;
      return [(u - 0.5) * w, -dip, (v - 0.5) * d];
    };
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), e = at(i, j + 1);
      t.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      t.push(a[0], a[1], a[2], c[0], c[1], c[2], e[0], e[1], e[2]);
    }
    return soup(t);
  }
  P.canopy = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const w = opts.w || 6, d = opts.d || 5, h = opts.h || 2.9;
    const cloth = new THREE.Mesh(sagGeo(w, d, opts.sag == null ? h * 0.22 : opts.sag, 4),
      MD(opts.mat || "tarp"));
    cloth.position.y = h;
    cloth.castShadow = true; cloth.receiveShadow = true;
    g.add(cloth);
    for (let i = 0; i < 4; i++) {
      const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? 1 : -1;
      cyl(g, 0.07, 0.09, h, 5, M("wood"), sx * w / 2, h / 2, sz * d / 2);
    }
    g.userData.colliders = [];
    return g;
  };

  /* SANDBAGS. One bag geometry, N instances, one draw call — and a REAL
     cover box along the run, because a sandbag wall that combat_iq cannot
     see is decoration and this game's whole fight is about cover. Height is
     1.05 m: over combat_iq's 0.85 m bar with room to spare, and low enough
     that a man behind it is shooting over it rather than hiding from the
     camera. */
  P.sandbags = function (opts) {
    opts = opts || {};
    const len = opts.len || 6;
    const h = opts.h || 1.05;
    const curve = opts.curve || 0;          // metres of bow across the run
    const r = stream(opts.seed);
    const rows = Math.max(2, Math.round(h / 0.26));
    const per = Math.max(2, Math.round(len / 0.62));
    const g = new THREE.Group();
    const im = new THREE.InstancedMesh(BG(0.6, 0.26, 0.42), M("canvasDark"), rows * per + 4);
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    let n = 0;
    for (let y = 0; y < rows; y++) {
      const inset = y * 0.035;              // the wall batters inward as it rises
      const stagger = (y % 2) * 0.31;
      for (let i = 0; i < per; i++) {
        const u = (i + 0.5) / per;
        const x = (u - 0.5) * len + stagger * 0.5;
        if (Math.abs(x) > len / 2) continue;
        const z = Math.sin(u * Math.PI) * curve;
        d.position.set(x, 0.13 + y * 0.245, z);
        d.rotation.set(r.range(-0.05, 0.05), r.range(-0.09, 0.09), r.range(-0.06, 0.06));
        d.scale.set(1 - inset, 1, 1 - inset * 1.6);
        d.updateMatrix(); im.setMatrixAt(n, d.matrix);
        if (im.setColorAt) { c.setHex(COL.canvasDark).multiplyScalar(0.86 + r.f() * 0.28); im.setColorAt(n, c); }
        n++;
      }
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = im.receiveShadow = true;
    g.add(im);
    g.userData.colliders = [];
    // one collider per 3 m of run, so a bowed wall is cover from every angle
    const segs = Math.max(1, Math.round(len / 3));
    for (let i = 0; i < segs; i++) {
      const u = (i + 0.5) / segs;
      col(g.userData.colliders, (u - 0.5) * len, h / 2, Math.sin(u * Math.PI) * curve,
        len / segs + 0.2, h, 0.9, "sandbag");
    }
    return g;
  };

  /* A GABION / HESCO — a wire cage of rubble. Cheaper than sandbags for the
     same cover (one box + one rock instance mesh) and it reads as a modern
     defensive line rather than a WWI one, which is what a desert warlord's
     depot would actually have. */
  P.gabion = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const r = stream(opts.seed);
    const len = opts.len || 4, h = opts.h || 1.35, d0 = opts.d || 1.0;
    box(g, len, h, d0, M("rockDark"), 0, h / 2, 0);
    // the mesh cage: four thin frames, so the silhouette has an edge on it
    box(g, len + 0.06, 0.07, d0 + 0.06, M("metalDark"), 0, h - 0.03, 0);
    box(g, len + 0.06, 0.07, d0 + 0.06, M("metalDark"), 0, 0.05, 0);
    const nrk = Math.round(len * 5);
    const im = new THREE.InstancedMesh(rockGeo(0), M("rock"), nrk);
    const dm = new THREE.Object3D();
    for (let i = 0; i < nrk; i++) {
      dm.position.set(r.range(-len / 2 + 0.2, len / 2 - 0.2), h + r.range(-0.05, 0.14), r.range(-d0 / 2, d0 / 2));
      dm.rotation.set(r.f() * TAU, r.f() * TAU, r.f() * TAU);
      dm.scale.setScalar(r.range(0.14, 0.26));
      dm.updateMatrix(); im.setMatrixAt(i, dm.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    g.add(im);
    g.userData.colliders = [];
    col(g.userData.colliders, 0, h / 2, 0, len, h, d0, "gabion");
    return g;
  };

  /* CRATES. Deliberately NOT world/crates.js: that file stamps five crates
     into the prison yard at load and is not on this page. Same three-box
     recipe (body, plank band, corner bracket) because that recipe is right;
     built as an instanced stack because a depot has thirty of them. */
  P.crates = function (opts) {
    opts = opts || {};
    const r = stream(opts.seed);
    const n = opts.n || 10;
    const spread = opts.spread || 3.2;
    const g = new THREE.Group();
    const im = new THREE.InstancedMesh(BG(1, 1, 1), M("wood"), n);
    const band = new THREE.InstancedMesh(BG(1.04, 0.3, 1.04), M("woodDark"), n);
    const d = new THREE.Object3D();
    const cs = [];
    let top = 0;
    for (let i = 0; i < n; i++) {
      const s = r.range(0.75, 1.25);
      // stack in tiers: two thirds on the ground, the rest on top of those
      const tier = i < n * 0.62 ? 0 : (i < n * 0.9 ? 1 : 2);
      const x = r.range(-spread, spread) * (tier ? 0.55 : 1);
      const z = r.range(-spread, spread) * (tier ? 0.55 : 1);
      const y = tier * 1.05 + s / 2;
      d.position.set(x, y, z);
      d.rotation.set(0, r.f() * TAU, 0);
      d.scale.setScalar(s);
      d.updateMatrix(); im.setMatrixAt(i, d.matrix); band.setMatrixAt(i, d.matrix);
      if (y + s / 2 > top) top = y + s / 2;
      if (tier === 0 && s > 0.85) cs.push({ x: x, y: y, z: z, w: s, h: s, d: s });
    }
    im.instanceMatrix.needsUpdate = band.instanceMatrix.needsUpdate = true;
    im.castShadow = band.castShadow = im.receiveShadow = true;
    g.add(im); g.add(band);
    g.userData.colliders = [];
    // a single crate is 1 m and combat_iq wants 0.85 — so the stack is cover
    // and the strays are not. Only the big ground-tier ones are registered.
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      col(g.userData.colliders, c.x, c.y, c.z, c.w, c.h, c.d, "crate");
    }
    g.userData.top = top;
    return g;
  };

  /* DRUMS — fuel, water, whatever. One cylinder, N instances, and two ring
     ribs so it is a drum and not a can. */
  P.drums = function (opts) {
    opts = opts || {};
    const r = stream(opts.seed);
    const n = opts.n || 8;
    const g = new THREE.Group();
    const body = new THREE.InstancedMesh(CG(0.29, 0.29, 0.88, 10), M(opts.mat || "rust"), n);
    const rib = new THREE.InstancedMesh(CG(0.31, 0.31, 0.08, 10), M("metalDark"), n * 2);
    const d = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const lying = r.chance(0.25);
      const sp = opts.spread || 1.8;
      const x = r.range(-sp, sp);
      const z = r.range(-sp, sp);
      d.position.set(x, lying ? 0.29 : 0.44, z);
      d.rotation.set(lying ? Math.PI / 2 : 0, r.f() * TAU, 0);
      d.scale.setScalar(1);
      d.updateMatrix(); im2(body, i, d.matrix);
      const yy = d.position.y;
      for (let k = 0; k < 2; k++) {
        d.position.y = lying ? yy : yy + (k ? 0.24 : -0.24);
        d.updateMatrix(); im2(rib, i * 2 + k, d.matrix);
      }
      d.position.y = yy;
    }
    body.instanceMatrix.needsUpdate = rib.instanceMatrix.needsUpdate = true;
    body.castShadow = rib.castShadow = true;
    g.add(body); g.add(rib);
    g.userData.colliders = [];
    return g;
  };
  function im2(m, i, mat) { m.setMatrixAt(i, mat); }

  /* A SHIPPING CONTAINER. Six boxes: body, two door leaves, a top rail, a
     bottom rail and a lock bar. The corrugation a real container has is
     eighteen more boxes per unit for a texture you cannot see past 40 m; the
     rails are what actually give the silhouette its edge. */
  P.container = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const L = opts.len || 12.2, H = 2.6, D = 2.44;
    const paint = M(opts.paint || "boxRed");
    box(g, L, H, D, paint, 0, H / 2, 0);
    box(g, L + 0.1, 0.16, D + 0.1, M("metalDark"), 0, H - 0.06, 0);
    box(g, L + 0.1, 0.2, D + 0.1, M("metalDark"), 0, 0.08, 0);
    // doors on the -x end
    box(g, 0.1, H * 0.92, D * 0.47, M("metalDark"), -L / 2 - 0.05, H / 2, D * 0.24);
    box(g, 0.1, H * 0.92, D * 0.47, M("metalDark"), -L / 2 - 0.05, H / 2, -D * 0.24);
    box(g, 0.14, H * 0.9, 0.1, M("metal"), -L / 2 - 0.09, H / 2, 0);
    g.userData.colliders = [];
    col(g.userData.colliders, 0, H / 2, 0, L, H, D, "container");
    return g;
  };

  /* ============================================================ BANNERS
     core.js gives five factions a colour each and this is where that colour
     becomes a thing on the sand. Two versions, and they exist for two
     different problems:

       banner()      ONE flag, its own meshes, its own cloth chain. For the
                     thing beside you: your camp, a depot's mast, a band's
                     standard in a battle you are standing in.
       bannerField() SIXTY flags in three draw calls. For the map: every band
                     on the island flying its colours at once.

     THE CLOTH IS A CHAIN, not a rotated rectangle. Three segments walked
     out from the pole head, each picking up the previous segment's tip and
     adding its own yaw and pitch off a sine — so the flag ripples along its
     fly and the tip whips further than the hoist, which is what a flag
     does. The first draft rotated one quad about the pole and it read as a
     signboard swinging on a hinge.

     WIND IS ONE GLOBAL. Sixty flags on the same island are in the same wind;
     giving each its own direction is both more expensive and wrong. */
  const WIND = { dir: 0.7, gust: 0 };
  P.wind = function (dirRad) { if (dirRad != null) WIND.dir = dirRad; return WIND; };

  const CLOTH_SEG = 3;
  function clothChain(t, phase, fly, drop, out) {
    // returns CLOTH_SEG {x,y,z,yaw,pitch} steps walked out from (0,0,0)
    let px = 0, py = 0, pz = 0;
    const seg = fly / CLOTH_SEG;
    for (let i = 0; i < CLOTH_SEG; i++) {
      const u = (i + 0.5) / CLOTH_SEG;
      const yaw = WIND.dir + Math.sin(t * 2.3 + phase + u * 3.4) * (0.20 + u * 0.55);
      const pitch = -drop * u + Math.sin(t * 3.1 + phase + u * 4.2) * (0.06 + u * 0.30);
      const cx = Math.cos(yaw) * Math.cos(pitch), cy = Math.sin(pitch), cz = Math.sin(yaw) * Math.cos(pitch);
      const o = out[i] || (out[i] = {});
      o.x = px + cx * seg * 0.5; o.y = py + cy * seg * 0.5; o.z = pz + cz * seg * 0.5;
      o.yaw = yaw; o.pitch = pitch;
      px += cx * seg; py += cy * seg; pz += cz * seg;
    }
    return out;
  }

  const liveBanners = [];
  const liveFires = [];
  // one cloth material per faction colour, not one per flag: five factions on
  // the map is five materials however many standards are flying.
  const _clothMats = {};
  function clothMatFor(hex) {
    let m = _clothMats[hex];
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color: hex, side: THREE.DoubleSide });
      m._shared = true;
      _clothMats[hex] = m;
    }
    return m;
  }

  P.banner = function (colour, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const h = opts.h || 7.5;
    const fly = opts.fly || h * 0.34;
    const hoist = opts.hoist || fly * 0.62;
    if (OLD) {                       // the revert: a bare pole, no cloth
      cyl(g, 0.06, 0.09, h, 6, M("wood"), 0, h / 2, 0);
      g.userData.colliders = [];
      return g;
    }
    cyl(g, 0.055, 0.09, h, 6, M("wood"), 0, h / 2, 0);
    box(g, 0.16, 0.16, 0.16, M("metal"), 0, h + 0.09, 0);
    const mat = clothMatFor(colour == null ? 0xc4593a : colour);
    const live = new THREE.Group();
    live.userData.dynamic = true;
    live.position.y = h - hoist * 0.55;
    const segs = [];
    const segGeo = BG(fly / CLOTH_SEG, hoist, 0.03);
    for (let i = 0; i < CLOTH_SEG; i++) {
      const m = new THREE.Mesh(segGeo, mat);
      m.castShadow = true;
      live.add(m);
      segs.push(m);
    }
    g.add(live);
    const rec = { segs: segs, phase: (opts.seed || 0) * 0.7919 % TAU, fly: fly,
                  drop: opts.drop == null ? 0.22 : opts.drop, out: [] };
    live.userData.banner = rec;
    liveBanners.push(rec);
    g.userData.banner = rec;
    g.userData.colliders = [];
    return g;
  };

  /* SIXTY BANNERS IN THREE DRAW CALLS. Pole InstancedMesh, finial
     InstancedMesh, cloth InstancedMesh at CLOTH_SEG instances per banner
     with per-instance colour. The cloth only re-composes for banners inside
     `liveR` of the camera: at 300 m a flag is four pixels and the ripple is
     information nobody receives, so past it the last matrices just stay. */
  P.bannerField = function (opts) {
    opts = opts || {};
    const cap = opts.cap || 64;
    const h = opts.h || 7.0;
    const fly = opts.fly || 2.6, hoist = opts.hoist || 1.7;
    const g = new THREE.Group();
    g.userData.dynamic = true;      // the cloth moves; batch.js must skip it
    const pole = new THREE.InstancedMesh(CG(0.06, 0.1, h, 5), M("wood"), cap);
    const finial = new THREE.InstancedMesh(BG(0.18, 0.18, 0.18), M("metal"), cap);
    const clothMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const cloth = new THREE.InstancedMesh(BG(fly / CLOTH_SEG, hoist, 0.03), clothMat, cap * CLOTH_SEG);
    pole.castShadow = cloth.castShadow = true;
    pole.count = finial.count = cloth.count = 0;
    pole.frustumCulled = finial.frustumCulled = cloth.frustumCulled = false;
    g.add(pole); g.add(finial); g.add(cloth);
    const items = [];
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    const out = [];
    const api = {
      group: g,
      count: function () { return items.length; },
      add: function (x, y, z, colour, scale) {
        if (items.length >= cap) return null;
        const i = items.length;
        const s = scale || 1;
        d.position.set(x, y + h * 0.5 * s, z); d.rotation.set(0, 0, 0); d.scale.set(s, s, s);
        d.updateMatrix(); pole.setMatrixAt(i, d.matrix);
        d.position.set(x, y + h * s + 0.1 * s, z);
        d.updateMatrix(); finial.setMatrixAt(i, d.matrix);
        if (cloth.setColorAt) {
          c.setHex(colour == null ? 0xc4593a : colour);
          for (let k = 0; k < CLOTH_SEG; k++) cloth.setColorAt(i * CLOTH_SEG + k, c);
        }
        const rec = { x: x, y: y, z: z, s: s, phase: (i * 1.937) % TAU };
        items.push(rec);
        pole.count = finial.count = items.length;
        cloth.count = items.length * CLOTH_SEG;
        pole.instanceMatrix.needsUpdate = finial.instanceMatrix.needsUpdate = true;
        if (cloth.instanceColor) cloth.instanceColor.needsUpdate = true;
        api.tick(0, null);
        return rec;
      },
      clear: function () {
        items.length = 0;
        pole.count = finial.count = cloth.count = 0;
      },
      tick: function (t, camPos) {
        const liveR = opts.liveR || 300;
        const r2 = liveR * liveR;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (camPos) {
            const dx = it.x - camPos.x, dz = it.z - camPos.z;
            if (dx * dx + dz * dz > r2) continue;
          }
          clothChain(t, it.phase, fly * it.s, 0.22, out);
          for (let k = 0; k < CLOTH_SEG; k++) {
            const o = out[k];
            d.position.set(it.x + o.x, it.y + h * it.s - hoist * 0.55 * it.s + o.y, it.z + o.z);
            d.rotation.set(0, -o.yaw, o.pitch);
            d.scale.set(it.s, it.s, it.s);
            d.updateMatrix();
            cloth.setMatrixAt(i * CLOTH_SEG + k, d.matrix);
          }
        }
        cloth.instanceMatrix.needsUpdate = true;
      },
    };
    return api;
  };

  /* ============================================================ ROCKS
     CBZ.makeRock's scrape algorithm, four variants, built once and shared by
     every boulder, gabion and rubble pile in the game. If rockscliffs.js
     has not landed yet the fallback is a plain icosahedron — which is what
     desert.js's scatter already uses, so the game is no worse than it was;
     it just is not better yet. */
  const rockGeos = [];
  function rockGeo(i) {
    i = i % 4;
    if (rockGeos[i]) return rockGeos[i];
    let g = null;
    if (rockReady && CBZ.makeRock) {
      try { g = CBZ.makeRock(1, 9001 + i * 137, 1, i === 3 ? { squashY: 0.42, scrapes: 11 } : null); } catch (e) { g = null; }
    }
    if (!g) g = new THREE.IcosahedronGeometry(1, i === 3 ? 0 : 1);
    rockGeos[i] = g;
    return g;
  }
  /* A GEOMETRY BUILT BEFORE rockscliffs.js LANDED KEEPS ITS SHAPE. There is
     no live swap here on purpose: a boulder that silently becomes a different
     boulder one second after it was drawn is the exact "the prop changed when
     the chunk reloaded" failure the determinism rule exists to stop. boot()
     asks for the file immediately and nothing builds a rock until it is
     needed, so in practice the fallback is only ever reached with ?proprock=box
     or a 404. */

  /* ============================================================ COVER
     The things a man hides behind. Every one of these is sized against
     combat_iq's thresholds, not against a photograph.

     `cover(kind)` builds ONE. `coverField(list)` builds a battlefield's
     worth in a handful of draw calls, which is what battle.js should call:
     it hands out ~34 cover boxes today and draws each as its own rotated
     box mesh — 34 draw calls of grey cube. */
  const COVER_KINDS = ["boulder", "slab", "bank", "sandbag", "gabion", "barricade", "ruin", "crate", "palm"];
  P.coverKinds = COVER_KINDS.slice();

  P.cover = function (kind, opts) {
    opts = opts || {};
    const w = opts.w || 2.2, h = opts.h || 1.4, d = opts.d || 2.0;
    if (OLD) {
      // battle.js's own rockMesh, verbatim in spirit: one rotated grey box
      const g = new THREE.Group();
      const m = box(g, w, h, d, M("rock"), 0, h / 2, 0, W.hash01(w, d, 3) * Math.PI);
      m.castShadow = m.receiveShadow = true;
      g.userData.colliders = []; col(g.userData.colliders, 0, h / 2, 0, w, h, d, kind || "cover");
      return g;
    }
    const r = stream(opts.seed == null ? Math.round(w * 97 + h * 31 + d * 7) : opts.seed);
    switch (kind) {
      case "sandbag":   return P.sandbags({ len: w, h: h, curve: opts.curve || w * 0.12, seed: opts.seed });
      case "gabion":    return P.gabion({ len: w, h: h, d: d, seed: opts.seed });
      case "crate":     return P.crates({ n: Math.max(3, Math.round(w * 2)), spread: w * 0.45, seed: opts.seed });
      case "palm":      return P.palm({ h: h, seed: opts.seed });
      case "barricade": return barricade(w, h, d, r);
      case "ruin":      return ruin(w, h, d, r);
      case "bank":      return bank(w, h, d, r);
      case "slab":      return boulder(w, h, d, r, true);
      default:          return boulder(w, h, d, r, false);
    }
  };

  function boulder(w, h, d, r, slab) {
    const g = new THREE.Group();
    const v = slab ? 3 : Math.floor(r.f() * 3);
    const m = new THREE.Mesh(rockGeo(v), M(r.chance(0.5) ? "rock" : "rockDark"));
    m.scale.set(w / 2, h / (slab ? 0.9 : 2), d / 2);
    m.rotation.set(r.range(-0.18, 0.18), r.f() * TAU, r.range(-0.18, 0.18));
    m.position.y = h * (slab ? 0.34 : 0.42);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    // spall at the foot: real boulders sit in their own broken-off rubble,
    // and a boulder with a clean line where it meets sand reads as dropped in
    const n = 4 + Math.floor(r.f() * 4);
    const im = new THREE.InstancedMesh(rockGeo(3), M("rockDark"), n);
    const dm = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = r.f() * TAU, rr = (w + d) * 0.25 * r.range(0.75, 1.3);
      dm.position.set(Math.cos(a) * rr, r.range(0.04, 0.18), Math.sin(a) * rr);
      dm.rotation.set(r.f() * TAU, r.f() * TAU, r.f() * TAU);
      dm.scale.setScalar(r.range(0.12, 0.34) * Math.max(0.6, w * 0.3));
      dm.updateMatrix(); im.setMatrixAt(i, dm.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    g.add(im);
    g.userData.colliders = [];
    col(g.userData.colliders, 0, h / 2, 0, w * 0.86, h, d * 0.86, slab ? "slab" : "boulder");
    return g;
  }

  // a wadi bank: a long low wedge of packed sand, cut on one face
  function bank(w, h, d, r) {
    const g = new THREE.Group();
    const t = [];
    const seg = 6;
    for (let i = 0; i < seg; i++) {
      const u0 = i / seg, u1 = (i + 1) / seg;
      const x0 = (u0 - 0.5) * w, x1 = (u1 - 0.5) * w;
      const h0 = h * (0.55 + 0.45 * Math.sin(u0 * Math.PI)) * r.range(0.9, 1.1);
      const h1 = h * (0.55 + 0.45 * Math.sin(u1 * Math.PI)) * r.range(0.9, 1.1);
      const zb = d / 2, zf = -d / 2;
      // cut face (front), slope (back), top
      t.push(x0, 0, zf, x1, 0, zf, x1, h1, zf);
      t.push(x0, 0, zf, x1, h1, zf, x0, h0, zf);
      t.push(x0, h0, zf, x1, h1, zf, x1, 0, zb);
      t.push(x0, h0, zf, x1, 0, zb, x0, 0, zb);
    }
    const m = new THREE.Mesh(soup(t), M("sandDark"));
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    g.userData.colliders = [];
    col(g.userData.colliders, 0, h / 2, -d * 0.25, w, h, d * 0.5, "bank");
    return g;
  }

  // a timber barricade: two X-frames and three planks. Cover you can see
  // through, which is a different tactical object from a sandbag wall.
  function barricade(w, h, d, r) {
    const g = new THREE.Group();
    for (let s = -1; s <= 1; s += 2) {
      const x = s * (w / 2 - 0.25);
      const a = box(g, 0.14, h * 1.35, 0.14, M("wood"), x, h / 2, 0, 0, 0, 0.55);
      const b = box(g, 0.14, h * 1.35, 0.14, M("wood"), x, h / 2, 0, 0, 0, -0.55);
      a.receiveShadow = b.receiveShadow = true;
    }
    for (let i = 0; i < 3; i++) {
      box(g, w, 0.2, 0.16, M("woodDark"), 0, 0.3 + i * (h - 0.4) / 2, r.range(-0.05, 0.05),
        0, 0, r.range(-0.03, 0.03));
    }
    // sandbags piled at the foot — this is what makes it real cover rather
    // than three planks combat_iq can see a man through
    const bags = P.sandbags({ len: w * 0.8, h: 0.78, seed: r.f() * 1e6 | 0 });
    bags.position.z = -0.35;
    g.add(bags);
    g.userData.colliders = [];
    col(g.userData.colliders, 0, h / 2, 0, w, h, Math.max(0.8, d * 0.6), "barricade");
    return g;
  }

  // a ruined mud-brick wall — three stumps of different heights with a
  // collapsed gap and rubble. The gap matters: it is a firing port, and it
  // is the reason a ruin plays differently from a rock of the same size.
  function ruin(w, h, d, r) {
    const g = new THREE.Group();
    const segs = 3;
    for (let i = 0; i < segs; i++) {
      const u = (i + 0.5) / segs;
      const sh = h * r.range(0.45, 1.05);
      const sw = (w / segs) * r.range(0.7, 0.98);
      if (i === 1 && r.chance(0.55)) continue;          // the breach
      const m = box(g, sw, sh, d * 0.5, M("sandDark"), (u - 0.5) * w, sh / 2, r.range(-0.1, 0.1),
        r.range(-0.05, 0.05), 0, r.range(-0.04, 0.04));
      m.receiveShadow = true;
      // a broken top course, so the wall does not end in a straight cut
      box(g, sw * r.range(0.3, 0.7), 0.22, d * 0.5, M("sand"),
        (u - 0.5) * w + r.range(-0.3, 0.3), sh + 0.11, 0, r.range(-0.1, 0.1));
    }
    const n = 8;
    const im = new THREE.InstancedMesh(BG(0.4, 0.18, 0.26), M("sandDark"), n);
    const dm = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      dm.position.set(r.range(-w / 2, w / 2), 0.09, r.range(-d, d));
      dm.rotation.set(r.range(-0.3, 0.3), r.f() * TAU, r.range(-0.3, 0.3));
      dm.scale.setScalar(r.range(0.6, 1.4));
      dm.updateMatrix(); im.setMatrixAt(i, dm.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
    g.userData.colliders = [];
    col(g.userData.colliders, -w / 3, h / 2, 0, w / 3, h * 0.8, d * 0.5, "ruin");
    col(g.userData.colliders, w / 3, h / 2, 0, w / 3, h * 0.8, d * 0.5, "ruin");
    return g;
  }

  /* A WHOLE BATTLEFIELD'S COVER IN A HANDFUL OF DRAW CALLS.
     list: [{x,y,z,w,h,d,yaw,kind}] in the caller's local frame — exactly the
     shape desert.js's battlefieldAt().cover already hands out. Boulders and
     slabs, which are the bulk, go into per-variant InstancedMeshes; the
     built kinds (sandbag, ruin, barricade) build individually and are then
     merged by core/batch.js. Returns {group, colliders} where colliders is
     already in the same local frame, so battle.js registers them itself
     rather than this file guessing which frame it is in. */
  P.coverField = function (list, opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const colliders = [];
    const rockBuckets = [[], [], [], []];
    const rubble = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const kind = c.kind || "boulder";
      const seed = Math.round((c.x * 131 + c.z * 977 + i * 17)) | 0;
      if (!OLD && (kind === "boulder" || kind === "slab")) {
        const r = stream(seed);
        const v = kind === "slab" ? 3 : Math.floor(r.f() * 3);
        rockBuckets[v].push({ c: c, r: r, slab: kind === "slab" });
        colliders.push({ x: c.x, y: (c.y || 0) + c.h / 2, z: c.z, w: c.w * 0.86, h: c.h, d: c.d * 0.86, tag: kind });
        for (let k = 0; k < 4; k++) {
          const a = r.f() * TAU, rr = (c.w + c.d) * 0.25 * r.range(0.8, 1.3);
          rubble.push({ x: c.x + Math.cos(a) * rr, y: (c.y || 0) + 0.1, z: c.z + Math.sin(a) * rr,
                        s: r.range(0.14, 0.4) * Math.max(0.7, c.w * 0.3),
                        rx: r.f() * TAU, ry: r.f() * TAU, rz: r.f() * TAU });
        }
        continue;
      }
      const sub = P.cover(kind, { w: c.w, h: c.h, d: c.d, seed: seed });
      sub.position.set(c.x, c.y || 0, c.z);
      sub.rotation.y = c.yaw || 0;
      g.add(sub);
      const sc = sub.userData.colliders || [];
      const cy = Math.cos(sub.rotation.y), sy = Math.sin(sub.rotation.y);
      for (let k = 0; k < sc.length; k++) {
        const q = sc[k];
        colliders.push({
          x: c.x + q.x * cy + q.z * sy, y: (c.y || 0) + q.y, z: c.z - q.x * sy + q.z * cy,
          w: Math.abs(q.w * cy) + Math.abs(q.d * sy), h: q.h,
          d: Math.abs(q.w * sy) + Math.abs(q.d * cy), tag: q.tag,
        });
      }
    }
    const d = new THREE.Object3D();
    for (let v = 0; v < 4; v++) {
      const b = rockBuckets[v];
      if (!b.length) continue;
      const im = new THREE.InstancedMesh(rockGeo(v), M(v & 1 ? "rockDark" : "rock"), b.length);
      for (let i = 0; i < b.length; i++) {
        const c = b[i].c, r = b[i].r, slab = b[i].slab;
        d.position.set(c.x, (c.y || 0) + c.h * (slab ? 0.34 : 0.42), c.z);
        d.rotation.set(r.range(-0.18, 0.18), (c.yaw || 0) + r.f() * TAU, r.range(-0.18, 0.18));
        d.scale.set(c.w / 2, c.h / (slab ? 0.9 : 2), c.d / 2);
        d.updateMatrix(); im.setMatrixAt(i, d.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = im.receiveShadow = true;
      g.add(im);
    }
    if (rubble.length) {
      const im = new THREE.InstancedMesh(rockGeo(3), M("rockDark"), rubble.length);
      for (let i = 0; i < rubble.length; i++) {
        const q = rubble[i];
        d.position.set(q.x, q.y, q.z);
        d.rotation.set(q.rx, q.ry, q.rz);
        d.scale.setScalar(q.s);
        d.updateMatrix(); im.setMatrixAt(i, d.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      g.add(im);
    }
    settle(g);
    g.userData.colliders = colliders;
    return { group: g, colliders: colliders };
  };

  /* ============================================================ WRECKS
     What makes an empty desert read as a place with a history instead of a
     noise function. Five kinds, and four of them are the repo's OWN shipped
     models put through the same three-step wreck: TILT it off level, SINK it
     so the sand has taken the wheels, and CHAR every material it owns.

     CHARRING IS A CLONE, never an in-place write. milModels hands back
     meshes sharing the module's cached materials; darkening those would
     blacken every truck in the engine, including the ones a live mode is
     driving. Measured the cheap way: one shared clone per source material
     per wreck, so a truck wreck adds ~6 materials, not 60. */
  const WRECK_KINDS = ["truck", "plane", "tank", "caravan", "bones"];
  P.wreckKinds = WRECK_KINDS.slice();

  function charify(root, amount) {
    const seen = new Map();
    root.traverse(function (o) {
      if (!o.material || Array.isArray(o.material)) return;
      const src = o.material;
      let m = seen.get(src);
      if (!m) {
        m = src.clone();
        if (m.color) {
          m.color.multiplyScalar(1 - amount);
          m.color.lerp(new THREE.Color(COL.char), amount * 0.55);
        }
        if (m.emissive) m.emissive.setHex(0x000000);
        m._shared = false;
        seen.set(src, m);
      }
      o.material = m;
      o.castShadow = true;
    });
    return seen.size;
  }

  P.wreck = function (kind, opts) {
    opts = opts || {};
    kind = WRECK_KINDS.indexOf(kind) >= 0 ? kind : "truck";
    const g = new THREE.Group();
    const r = stream(opts.seed);
    g.userData.colliders = [];
    g.userData.wreckKind = kind;

    if (kind === "bones") { bonesInto(g, r); settle(g); return g; }
    if (kind === "caravan") { caravanInto(g, r, opts); settle(g); return g; }

    // scorch: a dark disc under everything. Cheap, and it is what says
    // "burned" from above, where the campaign camera actually looks.
    if (!OLD) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(kind === "plane" ? 11 : 5.2, 14), M("char"));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.04;
      disc.receiveShadow = true;
      g.add(disc);
    }

    const MODEL = { truck: "truck", tank: "tank", plane: "cargo" };
    const sink = { truck: 0.35, tank: 0.85, plane: 0.6 }[kind];
    const tilt = { truck: 0.16, tank: 0.09, plane: 0.22 }[kind];
    const shell = new THREE.Group();
    g.add(shell);

    function fill() {
      let m = OLD ? null : milModel(MODEL[kind]);
      if (m) {
        shell.add(m);
        seat(m, sink);
        charify(m, kind === "tank" ? 0.5 : 0.62);
        shell.userData.real = true;
      } else {
        primitiveWreck(shell, kind, r);
        shell.userData.real = false;
      }
      shell.rotation.set(tilt * r.range(-1, 1), r.f() * TAU, tilt * r.range(0.4, 1));
      // debris, always ours: the model does not come pre-broken
      debrisInto(g, r, kind === "plane" ? 14 : 6, kind === "plane" ? 18 : 8);
    }
    if (OLD || milState === "ready" || milState === "absent") fill();
    else onMil(function () { fill(); settle(shell); });

    // COLLIDERS ARE DECLARED, NOT MEASURED. They are gameplay — the cover a
    // man takes behind a dead truck — and they must be identical whether the
    // real model landed or the primitive did, or the fight changes shape
    // depending on a download.
    const CBOX = {
      truck: [[0, 1.0, 0, 6.4, 2.0, 2.6]],
      tank:  [[0, 1.1, 0, 7.2, 2.2, 3.4]],
      plane: [[0, 1.6, 0, 5.0, 3.2, 22.0], [0, 1.0, -9, 3.0, 2.0, 6.0]],
    }[kind];
    for (let i = 0; i < CBOX.length; i++) {
      const b = CBOX[i];
      col(g.userData.colliders, b[0], b[1], b[2], b[3], b[4], b[5], kind);
    }
    settle(g);
    return g;
  };

  // the fallback body when the military pack is absent. Not a good truck —
  // a deliberately blunt one, so the difference is visible in the A/B and
  // nobody mistakes it for the shipped model.
  function primitiveWreck(shell, kind, r) {
    if (kind === "truck") {
      box(shell, 6.0, 1.5, 2.4, M("char"), 0, 0.95, 0);
      box(shell, 2.0, 1.3, 2.3, M("char"), 2.2, 1.9, 0);
      for (let i = 0; i < 4; i++) {
        cyl(shell, 0.55, 0.55, 0.36, 8, M("char"), (i < 2 ? 1.9 : -1.7), 0.5, (i % 2 ? 1.2 : -1.2), 0, 0, Math.PI / 2);
      }
    } else if (kind === "tank") {
      box(shell, 6.4, 1.1, 3.2, M("char"), 0, 0.9, 0);
      box(shell, 3.0, 0.9, 2.4, M("char"), -0.3, 1.85, 0);
      cyl(shell, 0.13, 0.16, 4.4, 8, M("char"), 1.9, 2.0, 0, 0, 0, Math.PI / 2);
      box(shell, 6.6, 0.7, 0.7, M("char"), 0, 0.5, 1.5);
      box(shell, 6.6, 0.7, 0.7, M("char"), 0, 0.5, -1.5);
    } else {
      box(shell, 4.0, 3.0, 20, M("char"), 0, 2.0, 0);
      box(shell, 22, 0.4, 3.4, M("char"), 0, 3.0, 1.5, 0, 0, r.range(-0.2, 0.2));
      box(shell, 0.4, 4.0, 3.0, M("char"), 0, 4.0, -8.5);
    }
  }

  function debrisInto(g, r, n, spread) {
    const im = new THREE.InstancedMesh(BG(0.9, 0.14, 0.6), M("char"), n);
    const d = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = r.f() * TAU, rr = r.range(spread * 0.3, spread);
      d.position.set(Math.cos(a) * rr, 0.08, Math.sin(a) * rr);
      d.rotation.set(r.range(-0.4, 0.4), r.f() * TAU, r.range(-0.4, 0.4));
      d.scale.setScalar(r.range(0.5, 1.7));
      d.updateMatrix(); im.setMatrixAt(i, d.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    g.add(im);
  }

  /* BONES. Ribs are half-tori — the one shape in this file that is not a box
     or a soup, and the only shape that reads as a ribcage at any distance.
     desert.js's scatter draws a bone as a 0.24×0.24×2.1 box, which is a
     stick; this is what the stick was standing in for. */
  P.bones = function (opts) {
    const g = new THREE.Group();
    bonesInto(g, stream((opts || {}).seed));
    g.userData.colliders = [];
    settle(g);
    return g;
  };
  function bonesInto(g, r) {
    const nrib = 7;
    const spine = r.range(2.6, 4.2);
    for (let i = 0; i < nrib; i++) {
      const u = i / (nrib - 1);
      const rad = 0.85 * (0.55 + Math.sin(u * Math.PI) * 0.65) * r.range(0.9, 1.05);
      const m = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.055, 4, 7, Math.PI * 0.95), M("bone"));
      m.position.set((u - 0.5) * spine, rad * 0.35, 0);
      m.rotation.set(0, Math.PI / 2, r.range(-0.14, 0.14));
      m.castShadow = true;
      g.add(m);
    }
    // spine + a skull that is three boxes and reads as a skull because of
    // the jaw, not because of the cranium
    box(g, spine * 1.05, 0.09, 0.14, M("bone"), 0, 0.16, 0, 0, 0, r.range(-0.05, 0.05));
    const sk = new THREE.Group();
    box(sk, 0.7, 0.42, 0.4, M("bone"), 0, 0.21, 0);
    box(sk, 0.5, 0.16, 0.34, M("bone"), 0.5, 0.1, 0);
    box(sk, 0.12, 0.36, 0.1, M("bone"), 0.1, 0.5, 0.18, 0, 0, 0.4);
    box(sk, 0.12, 0.36, 0.1, M("bone"), 0.1, 0.5, -0.18, 0, 0, 0.4);
    sk.position.set(spine * 0.62, 0, r.range(-0.2, 0.2));
    sk.rotation.y = r.range(-0.5, 0.5);
    g.add(sk);
    // scattered long bones
    const im = new THREE.InstancedMesh(BG(0.9, 0.08, 0.08), M("bone"), 9);
    const d = new THREE.Object3D();
    for (let i = 0; i < 9; i++) {
      const a = r.f() * TAU, rr = r.range(0.8, 3.4);
      d.position.set(Math.cos(a) * rr, 0.05, Math.sin(a) * rr);
      d.rotation.set(0, r.f() * TAU, r.range(-0.1, 0.1));
      d.scale.setScalar(r.range(0.6, 1.5));
      d.updateMatrix(); im.setMatrixAt(i, d.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    g.add(im);
  }

  /* A DEAD CARAVAN. The one wreck with a story in it: a toppled cart, the
     bones of the animals still in the traces, spilled crates, and a strip of
     cloth that never got buried. Nothing in the engine ships this. */
  function caravanInto(g, r, opts) {
    // the cart, on its side
    const cart = new THREE.Group();
    box(cart, 3.2, 0.24, 1.9, M("woodDark"), 0, 0.6, 0);
    box(cart, 3.2, 0.7, 0.14, M("wood"), 0, 0.95, 0.9);
    box(cart, 3.2, 0.7, 0.14, M("wood"), 0, 0.95, -0.9);
    box(cart, 0.14, 0.7, 1.9, M("wood"), -1.6, 0.95, 0);
    for (let s = -1; s <= 1; s += 2) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.09, 4, 10), M("woodDark"));
      wheel.position.set(0.2, 0.72, s * 1.05);
      wheel.rotation.y = Math.PI / 2;
      wheel.castShadow = true;
      cart.add(wheel);
      for (let k = 0; k < 6; k++) {
        box(cart, 1.36, 0.07, 0.07, M("woodDark"), 0.2, 0.72, s * 1.05, 0, 0, k * Math.PI / 6)
          .rotation.set(0, Math.PI / 2, k * Math.PI / 6);
      }
    }
    // shafts, pointing where the animals were
    box(cart, 2.6, 0.1, 0.1, M("wood"), -2.7, 0.7, 0.4);
    box(cart, 2.6, 0.1, 0.1, M("wood"), -2.7, 0.7, -0.4);
    cart.rotation.set(r.range(0.9, 1.25), r.range(-0.3, 0.3), 0);
    cart.position.y = 0.35;
    g.add(cart);
    // the animals, in the traces
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Group();
      bonesInto(b, stream(((opts && opts.seed) || 1) * 31 + i * 7));
      b.position.set(-5.4 - i * 0.4, 0, (i ? 1 : -1) * r.range(0.6, 1.2));
      b.rotation.y = r.range(-0.4, 0.4);
      b.scale.setScalar(0.8);
      g.add(b);
    }
    // spilled cargo and a strip of cloth
    const cr = P.crates({ n: 6, spread: 2.0, seed: ((opts && opts.seed) || 1) * 13 });
    cr.position.set(1.8, 0, 1.4);
    g.add(cr);
    const cloth = new THREE.Mesh(sagGeo(2.4, 1.6, 0.3, 3), MD("canvas"));
    cloth.position.set(2.6, 0.22, -1.6);
    cloth.rotation.set(0, r.f() * TAU, 0.06);
    g.add(cloth);
    col(g.userData.colliders, 0, 0.9, 0, 3.2, 1.8, 2.0, "caravan");
  }

  /* ============================================================ CAMP KIT
     Your own army's camp when you rest. This is the only prop set in the
     file the player OWNS, so it is the only one that scales with something:
     `men` decides how many bedrolls and fires there are, because a camp for
     six and a camp for two hundred should not be the same picture. */
  P.bivouac = function (opts) {
    opts = opts || {};
    const men = Math.max(1, opts.men || 8);
    const g = new THREE.Group();
    const r = stream(opts.seed);
    g.userData.colliders = [];
    const near = new THREE.Group(); g.add(near);

    const fires = Math.max(1, Math.min(6, Math.round(Math.sqrt(men) / 1.6)));
    const R = 3.0 + Math.sqrt(men) * 0.9;
    for (let i = 0; i < fires; i++) {
      const a = i / fires * TAU + 0.4;
      const f = P.fire({ seed: (opts.seed || 1) * 17 + i, smokeH: 9 });
      f.position.set(Math.cos(a) * R * 0.55, 0, Math.sin(a) * R * 0.55);
      near.add(f);
      // bedrolls around each fire, because that is where men sleep
      const per = Math.min(7, Math.ceil(men / fires));
      for (let k = 0; k < per; k++) {
        const b = k / per * TAU + r.range(-0.2, 0.2);
        const rr = 2.0 + r.range(0, 0.6);
        const roll = new THREE.Group();
        box(roll, 2.0, 0.2, 0.72, M("canvasDark"), 0, 0.1, 0);
        box(roll, 0.5, 0.26, 0.5, M("hide"), -0.85, 0.2, 0);   // the pack at the head
        roll.position.set(f.position.x + Math.cos(b) * rr, 0, f.position.z + Math.sin(b) * rr);
        roll.rotation.y = b + Math.PI / 2;
        near.add(roll);
      }
    }
    // STACKED ARMS — the real rifles. Three guns leaning muzzle-up in a
    // tripod is the oldest picture of an army at rest there is, and this
    // repo already ships the rifle.
    const stacks = Math.max(1, Math.round(men / 12));
    for (let s = 0; s < stacks; s++) {
      const a = (s + 0.5) / stacks * TAU;
      const st = P.armStack({ seed: (opts.seed || 1) * 91 + s, id: r.chance(0.5) ? "ak47" : "carbine" });
      st.position.set(Math.cos(a) * R * 0.92, 0, Math.sin(a) * R * 0.92);
      st.rotation.y = r.f() * TAU;
      near.add(st);
    }
    // the picket line: two posts and a rope, for whatever mounts.js parks here
    const pl = new THREE.Group();
    const span = 3.5 + Math.min(9, men * 0.25);
    cyl(pl, 0.09, 0.11, 1.7, 5, M("wood"), -span / 2, 0.85, 0);
    cyl(pl, 0.09, 0.11, 1.7, 5, M("wood"), span / 2, 0.85, 0);
    const rope = box(pl, span, 0.05, 0.05, M("rope"), 0, 1.5, 0);
    rope.castShadow = false;
    pl.position.set(0, 0, -R * 1.05);
    near.add(pl);
    // the cart your baggage lives in
    const cart = new THREE.Group();
    box(cart, 2.6, 0.2, 1.6, M("woodDark"), 0, 0.85, 0);
    box(cart, 2.6, 0.55, 0.12, M("wood"), 0, 1.15, 0.75);
    box(cart, 2.6, 0.55, 0.12, M("wood"), 0, 1.15, -0.75);
    for (let s = -1; s <= 1; s += 2) {
      const wl = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.08, 4, 10), M("woodDark"));
      wl.position.set(0.1, 0.68, s * 0.9); wl.rotation.y = Math.PI / 2; wl.castShadow = true;
      cart.add(wl);
    }
    box(cart, 2.2, 0.5, 1.2, M("canvas"), 0, 1.4, 0);
    cart.position.set(R * 0.95, 0, R * 0.5);
    cart.rotation.y = r.f() * TAU;
    near.add(cart);
    col(g.userData.colliders, cart.position.x, 0.9, cart.position.z, 2.8, 1.6, 2.0, "cart");

    if (opts.banner !== false) {
      const b = P.banner(opts.colour == null ? 0xd9b979 : opts.colour, { h: 8.5, seed: opts.seed || 1 });
      b.position.set(0, 0, R * 0.2);
      g.add(b);
    }
    settleNear(near);
    return g;
  };

  /* Three real rifles, stacked. Reaches straight into CBZ.weaponAppearance,
     which is the table every appearance file registers into and which THIS
     page already loads for the battle. systems/actorweapons.js keeps its own
     buildActorWeapon() private, so the four-helper ctx those factories take
     (box, cyl, mat, THREE) is rebuilt here — twelve lines against forking a
     rifle, which is the trade the armoury doctrine asks for. */
  let _gunCtx = null;
  function gunCtx() {
    if (_gunCtx) return _gunCtx;
    const gm = {
      dark: M("metalDark"), black: M("char"), bore: M("char"), steel: M("metal"),
      worn: M("metal"), tan: M("wood"), polymer: M("metalDark"), brass: M("rust"),
      redShell: M("boxRed"), skin: M("metalDark"),
    };
    _gunCtx = {
      THREE: THREE, mat: gm,
      box: function (p, sx, sy, sz, m, x, y, z, rx, ry, rz) {
        const o = new THREE.Mesh(BG(sx, sy, sz), m || gm.dark);
        o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0);
        o.castShadow = true; p.add(o); return o;
      },
      cyl: function (p, rr, len, m, x, y, z, rx, ry, rz) {
        const o = new THREE.Mesh(CG(rr, rr, len, 8), m || gm.dark);
        o.position.set(x || 0, y || 0, z || 0); o.rotation.set(rx || 0, ry || 0, rz || 0);
        o.castShadow = true; p.add(o); return o;
      },
    };
    return _gunCtx;
  }
  P.gun = function (id) {
    const f = CBZ.weaponAppearance && CBZ.weaponAppearance[id];
    if (!f) return null;
    try { return f(gunCtx()); } catch (e) { return null; }
  };
  P.armStack = function (opts) {
    opts = opts || {};
    const g = new THREE.Group();
    const r = stream(opts.seed);
    const id = opts.id || "ak47";
    let made = 0;
    for (let i = 0; i < 3; i++) {
      const m = OLD ? null : P.gun(id);
      const a = i / 3 * TAU + r.range(-0.15, 0.15);
      /* A WRAPPER, NOT A THREE-AXIS EULER. The appearance factories author a
         gun lying along -z with the grip at the origin, so standing it up is
         one +X rotation — but THREE's default XYZ Euler applies Y BEFORE X,
         so writing rotation.set(x, yaw, 0) yaws the gun while it is still
         lying down and the tripod comes out flat on the sand. The wrapper
         carries the yaw, the gun carries the stand-up, and the order is
         unambiguous. Rx(+pi/2) sends -z (the muzzle) to +y and +z (the butt)
         to the ground; the 0.30 short of vertical is the lean that makes
         three of them hold each other up. */
      const wrap = new THREE.Group();
      wrap.rotation.y = a;
      g.add(wrap);
      if (m) {
        m.rotation.x = Math.PI / 2 - 0.30;
        m.position.set(0, 0.40, 0.26);
        wrap.add(m);
        made++;
      } else {
        const b = box(wrap, 0.1, 1.05, 0.1, M("woodDark"), 0, 0.52, 0.26);
        b.rotation.x = -0.30;
      }
    }
    g.userData.realGuns = made;
    g.userData.colliders = [];
    return g;
  };

  /* ============================================================ OUTPOSTS
     THE FOUR PLACES. outpost.js already declares what they DO; this is what
     they LOOK like, and the rule for all four is the same:

       YOU MUST BE ABLE TO NAME IT FROM A KILOMETRE AWAY, BY SHAPE ALONE.

     At the campaign camera's fov, one metre is about a third of a pixel at 3
     km and about half a pixel at 1 km. So each kind gets ONE tall thing
     nobody else has and one wide thing nobody else has:

       DEPOT   a 16 m gantry crane over a row of 12 m containers   (tall+box)
       CAMP    nine triangles and three columns of smoke           (spiky)
       WELL    a ring of palm crowns and a low pale sail           (round+flat)
       MARKET  four wide low canopies, no mast at all              (flat)

     None of them shares a silhouette with any other, which is the whole
     specification. Detail below that is for the 30 m view and gets thrown
     away by the far LOD.

     NO GROUND PAD. The first draft laid a flat hardstand disc under each
     outpost; on desert.js's dunes a 36 m disc floats a metre on one side and
     buries itself on the other. Everything here is sunk 0.2-0.3 m into the
     sand instead and the terrain shows through, which is both cheaper and
     correct on ground that is never flat. */
  function settleNear(near) { settle(near); }

  P.outpost = function (kind, opts) {
    opts = opts || {};
    const build = { depot: buildDepot, camp: buildCamp, well: buildWell, market: buildMarket }[kind];
    return (build || buildDepot)(opts);
  };
  P.depot = function (o) { return buildDepot(o || {}); };
  P.camp = function (o) { return buildCamp(o || {}); };
  P.well = function (o) { return buildWell(o || {}); };
  P.market = function (o) { return buildMarket(o || {}); };

  function shellFor(opts) {
    const g = new THREE.Group();
    const near = new THREE.Group();
    const far = new THREE.Group();
    g.add(near); g.add(far);
    g.userData.colliders = [];
    g.userData.near = near; g.userData.far = far;
    return g;
  }
  function finish(g, opts) {
    settle(g.userData.near);
    settle(g.userData.far);
    if (opts.lod !== false) lodable(g, g.userData.near, g.userData.far, opts.lodR);
    else g.userData.far.visible = false;
    return g;
  }

  // ---------------------------------------------------------- ARMS DEPOT
  function buildDepot(opts) {
    const g = shellFor(opts);
    const near = g.userData.near, far = g.userData.far;
    const r = stream(opts.seed == null ? 7 : opts.seed);
    const CS = g.userData.colliders;
    if (OLD) { oldBlock(near, CS, 14, 3, "metalDark"); return finish(g, opts); }

    // --- the containers: three on the ground, one stacked, one askew ----
    const paints = ["boxRed", "boxBlue", "boxGreen", "rust"];
    const lay = [
      { x: -6, z: -9, yaw: 0, y: 0 },
      { x: -6, z: -6.2, yaw: 0, y: 0 },
      { x: -6, z: -9, yaw: 0, y: 2.62 },
      { x: 9.5, z: 2, yaw: Math.PI / 2, y: 0 },
    ];
    for (let i = 0; i < lay.length; i++) {
      const L = lay[i];
      const c = P.container({ paint: paints[i % paints.length], len: i === 3 ? 6.1 : 12.2 });
      c.position.set(L.x, L.y - 0.22, L.z);
      c.rotation.y = L.yaw + r.range(-0.04, 0.04);
      near.add(c);
      if (L.y === 0) {
        const cw = (i === 3 ? 6.1 : 12.2), cd = 2.44;
        const sw = Math.abs(cw * Math.cos(L.yaw)) + Math.abs(cd * Math.sin(L.yaw));
        const sd = Math.abs(cw * Math.sin(L.yaw)) + Math.abs(cd * Math.cos(L.yaw));
        col(CS, L.x, 1.2, L.z, sw, 2.4, sd, "container");
      }
    }

    /* --- THE CRANE. This is the whole silhouette. 16 m to the beam:
       enough to clear a stacked pair with room to lift, and tall enough to
       be a real pixel at a kilometre where the containers are not. */
    const crane = new THREE.Group();
    const H = 16, SPAN = 15;
    for (let s = -1; s <= 1; s += 2) {
      for (let t = -1; t <= 1; t += 2) {
        const leg = box(crane, 0.42, H, 0.42, M("metal"), s * SPAN / 2 + t * 0.9, H / 2, t * 1.6);
        leg.rotation.x = -t * 0.09;      // splay, so it reads as a frame not a post
      }
      // leg bracing, the diagonal that makes it read as a frame
      box(crane, 0.28, 4.6, 0.28, M("metalDark"), s * SPAN / 2, 5.0, 0, 0, 0.62, 0);
      box(crane, 0.3, 3.8, 0.3, M("metalDark"), s * SPAN / 2, H - 2.6, 0, 0, -0.62, 0);
      col(CS, s * SPAN / 2, 1.2, 0, 2.6, 2.4, 3.6, "crane");
    }
    box(crane, SPAN + 3.0, 0.75, 1.0, M("metal"), 0, H, 0);
    box(crane, SPAN + 3.0, 0.24, 0.24, M("metalDark"), 0, H + 0.55, 0);
    // trolley + hook on a cable — the detail that makes it a CRANE and not
    // a gantry, and it is three boxes
    const tx = r.range(-4, 4);
    box(crane, 1.5, 0.6, 1.4, M("rust"), tx, H - 0.6, 0);
    box(crane, 0.08, 6.4, 0.08, M("metalDark"), tx, H - 4.1, 0);
    box(crane, 0.7, 0.7, 0.7, M("metalDark"), tx, H - 7.5, 0);
    crane.position.set(-6, 0, -7.6);
    near.add(crane);

    // --- the wall, the crates, the drums, the mast --------------------
    const wall = P.sandbags({ len: 16, h: 1.2, curve: 2.2, seed: (opts.seed || 7) * 3 });
    wall.position.set(2, -0.1, 9.5);
    near.add(wall);
    pushCols(CS, wall, 2, -0.1, 9.5, 0);
    const wall2 = P.gabion({ len: 7, h: 1.5, d: 1.1, seed: (opts.seed || 7) * 5 });
    wall2.position.set(-13, -0.1, 3);
    wall2.rotation.y = Math.PI / 2;
    near.add(wall2);
    pushCols(CS, wall2, -13, -0.1, 3, Math.PI / 2);

    const crates = P.crates({ n: 16, spread: 3.4, seed: (opts.seed || 7) * 11 });
    crates.position.set(3.5, -0.1, 1.5);
    near.add(crates);
    pushCols(CS, crates, 3.5, -0.1, 1.5, 0);
    const drums = P.drums({ n: 10, spread: 2.4, seed: (opts.seed || 7) * 13 });
    drums.position.set(8, -0.05, -6);
    near.add(drums);

    // a lifting frame with a cargo net-ish tarp, and the mast
    const shade = P.canopy({ w: 7, d: 5, h: 3.1, mat: "tarp" });
    shade.position.set(-1, -0.15, 6.5);
    near.add(shade);
    const mast = P.banner(opts.colour == null ? 0xb9a13f : opts.colour, { h: 13, seed: opts.seed || 7 });
    mast.position.set(12, -0.2, 8);
    g.add(mast);                       // outside near/far: the flag flies at both

    // ---- THE FAR SILHOUETTE: crane + a container row, over-scaled ----
    farCrane(far, H * 1.15, SPAN * 1.2);
    for (let i = 0; i < 3; i++) {
      box(far, 14, 3.4, 3.2, M("metalDark"), -6, 1.7 + i * 3.45, -9 + i * 3.2);
    }
    box(far, 8, 3.2, 3.2, M("metalDark"), 10, 1.6, 2);
    box(far, 18, 1.8, 3.0, M("sandDark"), 2, 0.9, 9.5);   // the wall, as a bar

    return finish(g, opts);
  }
  function farCrane(far, H, SPAN) {
    for (let s = -1; s <= 1; s += 2) {
      box(far, 0.9, H, 0.9, M("metal"), -6 + s * SPAN / 2, H / 2, -7.6);
    }
    box(far, SPAN + 3, 1.4, 1.6, M("metal"), -6, H, -7.6);
  }
  function pushCols(CS, sub, x, y, z, yaw) {
    const sc = sub.userData.colliders || [];
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (let i = 0; i < sc.length; i++) {
      const q = sc[i];
      col(CS, x + q.x * cy + q.z * sy, y + q.y, z - q.x * sy + q.z * cy,
        Math.abs(q.w * cy) + Math.abs(q.d * sy), q.h, Math.abs(q.w * sy) + Math.abs(q.d * cy), q.tag);
    }
  }
  function oldBlock(near, CS, w, h, mat) {
    // the ?propkit=old outpost: what an outpost was before this file — one
    // box. Not a straw man; there was nothing.
    box(near, w, h, w, M(mat), 0, h / 2, 0);
    col(CS, 0, h / 2, 0, w, h, w, "old");
  }

  // ---------------------------------------------------------- RECRUIT CAMP
  function buildCamp(opts) {
    const g = shellFor(opts);
    const near = g.userData.near, far = g.userData.far;
    const r = stream(opts.seed == null ? 13 : opts.seed);
    const CS = g.userData.colliders;
    if (OLD) { oldBlock(near, CS, 10, 2.5, "canvasDark"); return finish(g, opts); }

    /* NINE RIDGE TENTS IN A HORSESHOE, not a grid and not a circle. A grid
       reads as a base and a circle reads as a ritual; a horseshoe open
       toward the water is what a hiring camp on an oasis actually is, and it
       gives the player somewhere to ride IN to. */
    const list = [];
    const R = 13;
    for (let i = 0; i < 9; i++) {
      const a = -1.9 + (i / 8) * 4.4;
      const rr = R * r.range(0.86, 1.12);
      list.push({
        x: Math.cos(a) * rr, z: Math.sin(a) * rr, y: -0.12,
        yaw: a + Math.PI / 2 + r.range(-0.2, 0.2),
        s: r.range(1.0, 1.35), sy: r.range(1.0, 1.3), tint: r.f(),
      });
    }
    near.add(P.tents(list, {}));
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      col(CS, t.x, 0.9, t.z, 3.6 * t.s, 1.8, 4.8 * t.s, "tent");
    }
    // two big bell tents at the head — the captains'
    for (let s = -1; s <= 1; s += 2) {
      const bell = new THREE.Group();
      cyl(bell, 0.05, 3.4, 3.6, 9, M("canvas"), 0, 1.8, 0);
      cyl(bell, 3.5, 3.5, 0.5, 9, M("canvasDark"), 0, 0.25, 0);
      cyl(bell, 0.06, 0.06, 4.6, 5, M("wood"), 0, 2.3, 0);
      bell.position.set(s * 5.5, -0.2, -9.5);
      bell.rotation.y = r.f() * TAU;
      near.add(bell);
      col(CS, s * 5.5, 1.4, -9.5, 6.4, 2.8, 6.4, "tent");
    }

    /* THREE FIRES WITH SMOKE, and the smoke is the long-range read. A tent
       is 3 m and invisible at a kilometre; an 11 m smoke column that widens
       to 4 m is not. This is the same trick a real army gave itself away
       with, which is a good sign it works. */
    for (let i = 0; i < 3; i++) {
      const a = -1.2 + i * 1.2;
      const f = P.fire({ seed: (opts.seed || 13) * 7 + i, smokeH: 11 + i * 2 });
      f.position.set(Math.cos(a) * 5.5, -0.05, Math.sin(a) * 5.5);
      near.add(f);
    }
    // a cook pot over the middle one
    const pot = new THREE.Group();
    for (let s = -1; s <= 1; s += 2) cyl(pot, 0.06, 0.06, 2.0, 5, M("wood"), s * 0.8, 1.0, 0, 0, 0, s * 0.22);
    box(pot, 1.9, 0.06, 0.06, M("wood"), 0, 1.95, 0);
    cyl(pot, 0.42, 0.34, 0.55, 8, M("metalDark"), 0, 1.2, 0);
    pot.position.set(Math.cos(0) * 5.5, 0, 0);
    near.add(pot);

    // the arms: four rifle stacks and a rack, which is what says RECRUIT
    for (let i = 0; i < 4; i++) {
      const a = 0.4 + i * 0.55;
      const st = P.armStack({ seed: (opts.seed || 13) * 29 + i, id: i & 1 ? "ak47" : "carbine" });
      st.position.set(Math.cos(a) * 8.5, -0.05, Math.sin(a) * 8.5);
      st.rotation.y = r.f() * TAU;
      near.add(st);
    }
    // a rope corral for whatever mounts.js parks here
    const cor = new THREE.Group();
    const posts = 9, CR = 6.5;
    for (let i = 0; i < posts; i++) {
      const a = i / posts * TAU;
      cyl(cor, 0.08, 0.1, 1.5, 5, M("wood"), Math.cos(a) * CR, 0.7, Math.sin(a) * CR);
      const b = box(cor, CR * TAU / posts + 0.3, 0.05, 0.05, M("rope"),
        Math.cos(a + Math.PI / posts) * CR, 1.25, Math.sin(a + Math.PI / posts) * CR);
      b.rotation.y = -(a + Math.PI / posts) + Math.PI / 2;
      b.castShadow = false;
    }
    cor.position.set(-2, -0.1, 16);
    near.add(cor);

    const crates = P.crates({ n: 8, spread: 2.2, seed: (opts.seed || 13) * 17 });
    crates.position.set(9, -0.1, -4);
    near.add(crates);
    pushCols(CS, crates, 9, -0.1, -4, 0);

    const mast = P.banner(opts.colour == null ? 0x4a8f5a : opts.colour, { h: 11, seed: opts.seed || 13 });
    mast.position.set(0, -0.2, -12.5);
    g.add(mast);

    // ---- FAR: a cluster of triangles and three smoke columns ---------
    const flist = [];
    for (let i = 0; i < 9; i++) {
      const a = -1.9 + (i / 8) * 4.4;
      flist.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, y: 0, yaw: a, s: 2.6, sy: 2.6, tint: 0.5 });
    }
    far.add(P.tents(flist, {}));
    box(far, 8, 6, 8, M("canvas"), -5.5, 3, -9.5);
    box(far, 8, 6, 8, M("canvas"), 5.5, 3, -9.5);
    const fsm = new THREE.Group();
    fsm.userData.dynamic = true;       // basic-material smoke: never batch it
    for (let i = 0; i < 3; i++) {
      const a = -1.2 + i * 1.2;
      const s = new THREE.Mesh(smokeCol(26 + i * 5), smokeMat());
      s.position.set(Math.cos(a) * 5.5, 1, Math.sin(a) * 5.5);
      fsm.add(s);
    }
    far.add(fsm);

    return finish(g, opts);
  }

  // ---------------------------------------------------------- WELL / OASIS
  function buildWell(opts) {
    const g = shellFor(opts);
    const near = g.userData.near, far = g.userData.far;
    const r = stream(opts.seed == null ? 23 : opts.seed);
    const CS = g.userData.colliders;
    if (OLD) { oldBlock(near, CS, 6, 2, "palmTrunk"); return finish(g, opts); }

    // the water: a small dark disc, because green in a desert is the signal
    const pool = new THREE.Mesh(new THREE.CircleGeometry(4.6, 18), M("water"));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(2.5, -0.25, 3);
    pool.receiveShadow = true;
    near.add(pool);
    // and the grass ring that only grows where the water is
    const grass = new THREE.Mesh(new THREE.RingGeometry(4.4, 7.4, 18), M("frond"));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(2.5, -0.28, 3);
    grass.receiveShadow = true;
    near.add(grass);

    // THE PALMS, in a broken ring — a perfect ring reads as planted, and
    // this is meant to read as the reason the well is here
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU + r.range(-0.3, 0.3);
      const rr = r.range(6.5, 11.5);
      const p = P.palm({ seed: (opts.seed || 23) * 31 + i, h: r.range(7, 11) });
      p.position.set(2.5 + Math.cos(a) * rr, -0.2, 3 + Math.sin(a) * rr);
      near.add(p);
      col(CS, p.position.x, 1.6, p.position.z, 0.8, 3.2, 0.8, "palm");
    }

    /* THE WELL HEAD. A stone drum, a timber A-frame, a winch and a bucket on
       a rope. Nine boxes and a cylinder, and it is the one thing that names
       the place — a ring of palms is an oasis, a ring of palms with a winch
       over a hole is a WELL, which is a thing somebody built. */
    const wh = new THREE.Group();
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 1.0, 12, 1, true), MD("rock"));
    drum.position.y = 0.5;
    drum.castShadow = drum.receiveShadow = true;
    wh.add(drum);
    cyl(wh, 1.55, 1.55, 0.16, 12, M("rockDark"), 0, 1.0, 0);
    const dark = new THREE.Mesh(new THREE.CircleGeometry(1.42, 12), M("char"));
    dark.rotation.x = -Math.PI / 2; dark.position.y = 0.86;
    wh.add(dark);
    for (let s = -1; s <= 1; s += 2) {
      box(wh, 0.16, 3.2, 0.16, M("wood"), s * 1.5, 1.6, 0.5, 0, 0, -s * 0.22);
      box(wh, 0.16, 3.2, 0.16, M("wood"), s * 1.5, 1.6, -0.5, 0, 0, -s * 0.22);
      box(wh, 0.14, 1.3, 0.14, M("wood"), s * 1.5, 2.4, 0, 0, Math.PI / 2, 0.9);
    }
    cyl(wh, 0.18, 0.18, 2.6, 8, M("woodDark"), 0, 2.95, 0, 0, 0, Math.PI / 2);
    box(wh, 0.1, 0.5, 0.1, M("wood"), 1.45, 2.7, 0, 0, 0, 0.7);   // the handle
    box(wh, 0.04, 1.9, 0.04, M("rope"), 0.3, 2.0, 0);
    box(wh, 0.42, 0.42, 0.42, M("woodDark"), 0.3, 0.9, 0);        // the bucket
    wh.position.set(-4.5, -0.15, -2);
    near.add(wh);
    col(CS, -4.5, 0.6, -2, 3.2, 1.2, 3.2, "well");

    // SHADE CLOTH — the wide flat thing. A pale sail 8 m across is the only
    // horizontal in a landscape of verticals, which is why a well reads
    // differently from a camp at range even though both are cloth.
    const sail = P.canopy({ w: 9, d: 7, h: 3.2, sag: 0.9, mat: "canvas" });
    sail.position.set(-4.5, -0.15, 5.5);
    near.add(sail);
    const trough = new THREE.Group();
    box(trough, 3.6, 0.5, 0.9, M("wood"), 0, 0.25, 0);
    box(trough, 3.6, 0.12, 0.78, M("water"), 0, 0.46, 0);
    trough.position.set(-1.5, -0.15, -6);
    trough.rotation.y = 0.3;
    near.add(trough);
    // a low mud-brick wall, half fallen — somebody lived here
    const rn = ruin(7, 1.5, 0.9, r);
    rn.position.set(7.5, -0.15, -7);
    rn.rotation.y = 0.5;
    near.add(rn);
    pushCols(CS, rn, 7.5, -0.15, -7, 0.5);

    // ---- FAR: palm crowns and the sail. No mast: a well has no flag. ----
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TAU;
      const rr = 9;
      box(far, 5.2, 1.6, 5.2, M("frond"), 2.5 + Math.cos(a) * rr, 10.5, 3 + Math.sin(a) * rr);
      box(far, 1.2, 10, 1.2, M("palmTrunk"), 2.5 + Math.cos(a) * rr, 5, 3 + Math.sin(a) * rr);
    }
    box(far, 10, 0.8, 8, M("canvas"), -4.5, 3.6, 5.5);
    const fp = new THREE.Mesh(new THREE.CircleGeometry(6.5, 12), M("water"));
    fp.rotation.x = -Math.PI / 2; fp.position.set(2.5, 0.1, 3);
    far.add(fp);

    return finish(g, opts);
  }

  // ---------------------------------------------------------- NIGHT MARKET
  function buildMarket(opts) {
    const g = shellFor(opts);
    const near = g.userData.near, far = g.userData.far;
    const r = stream(opts.seed == null ? 41 : opts.seed);
    const CS = g.userData.colliders;
    if (OLD) { oldBlock(near, CS, 9, 2.5, "tarp"); return finish(g, opts); }

    /* THE MARKET IS THE ONE WITH NO MAST. Four wide low canopies in two
       facing rows with a lane between them: at range it is a flat dark bar
       and nothing else on this island is a flat dark bar. outpost.js's own
       blurb is "lamps, tarpaulin, and a man who does not ask where you got
       it", and a mast is exactly what a man who does not ask does not put up. */
    const stallCols = ["tarp", "canvasDark", "rust", "boxBlue"];
    for (let i = 0; i < 5; i++) {
      const side = i % 2 ? 1 : -1;
      const z = -6 + Math.floor(i / 2) * 6.5;
      const c = P.canopy({
        w: r.range(5.5, 7.5), d: r.range(4.5, 5.5), h: r.range(2.7, 3.2),
        mat: stallCols[i % stallCols.length],
      });
      c.position.set(side * 5.5, -0.15, z + r.range(-0.6, 0.6));
      c.rotation.y = r.range(-0.12, 0.12);
      near.add(c);
      col(CS, side * 5.5, 1.0, z, 1.2, 2.0, 4.4, "stall");
      // the counter under it, and the goods on it
      box(near, 0.9, 0.9, 4.6, M("wood"), side * 3.9, 0.3, z);
      const goods = P.crates({ n: 5, spread: 1.5, seed: (opts.seed || 41) * (i + 3) });
      goods.position.set(side * 6.4, -0.15, z + 1.4);
      goods.scale.setScalar(0.6);
      near.add(goods);
    }

    /* THE LAMPS. This is the only outpost that is meant to be read at NIGHT,
       so the lamps are emissive rather than lights — sixteen point lights
       across nine outposts is how the frame budget dies, and an emissive
       globe under this repo's fog reads as a lit lamp anyway. */
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      const z = -8 + Math.floor(i / 2) * 7.5;
      cyl(near, 0.07, 0.09, 3.6, 5, M("wood"), side * 2.2, 1.6, z);
      const globe = new THREE.Mesh(BG(0.42, 0.42, 0.42), M("ember"));
      globe.position.set(side * 2.2, 3.5, z);
      near.add(globe);
    }
    const f = P.fire({ seed: (opts.seed || 41) * 3, smokeH: 7 });
    f.position.set(0, -0.05, 8);
    near.add(f);
    const bales = P.drums({ n: 7, spread: 2.0, mat: "hide", seed: (opts.seed || 41) * 19 });
    bales.position.set(0, -0.1, -11);
    near.add(bales);
    const rn = ruin(9, 2.4, 1.1, r);
    rn.position.set(-11, -0.15, 2);
    rn.rotation.y = Math.PI / 2;
    near.add(rn);
    pushCols(CS, rn, -11, -0.15, 2, Math.PI / 2);
    // one banner, small, on a stall — not a mast
    const b = P.banner(opts.colour == null ? 0x8f4fb8 : opts.colour, { h: 4.4, fly: 1.6, seed: opts.seed || 41 });
    b.position.set(-5.5, 2.6, -6);
    g.add(b);

    // ---- FAR: two low dark bars and a fire glow. No verticals. -------
    for (let s = -1; s <= 1; s += 2) box(far, 7, 3.4, 20, M("tarp"), s * 5.5, 2.6, 0);
    box(far, 20, 0.6, 22, M("sandDark"), 0, 0.3, 0);
    const fg = new THREE.Mesh(BG(2.4, 2.4, 2.4), M("ember"));
    fg.position.set(0, 1.4, 8);
    far.add(fg);

    return finish(g, opts);
  }

  /* ============================================================ NOTE TO desert.js
     desert.js's scatter builds its own four instanced primitives inline —
     an IcosahedronGeometry rock, a cone brush, a box bone, a box wreck. That
     is exactly the right SHAPE of system (instanced, hash-placed, camera
     following) and exactly the wrong geometry, and it is a one-line change
     to fix, from this side of the fence:

         const K = W.props.scatterKit();
         rock: im(K.rock.geo, K.rock.colour, SC_CAP.rock, true),

     scatterKit hands back the same geometry the hero props use — the
     scraped boulder, a real dead bush, a rib arc, a burnt chassis — with the
     colours already matched to this file's palette. It builds nothing until
     it is called. */
  P.scatterKit = function () {
    return {
      rock:  { geo: rockGeo(0), colour: COL.rock, mat: M("rock") },
      rock2: { geo: rockGeo(3), colour: COL.rockDark, mat: M("rockDark") },
      brush: { geo: brushGeo(), colour: 0x6a6238, mat: M("frond") },
      bone:  { geo: ribGeo(), colour: COL.bone, mat: M("bone") },
      wreck: { geo: chassisGeo(), colour: COL.char, mat: M("char") },
    };
  };
  let _brush = null, _rib = null, _chassis = null;
  function brushGeo() {
    if (_brush) return _brush;
    // a dead desert bush: six splayed twigs, not a cone. A cone in a desert
    // reads as a Christmas tree and desert.js's scatter is full of them.
    const t = [];
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * TAU, lean = 0.55 + (i % 3) * 0.14;
      const tx = Math.cos(a) * lean, tz = Math.sin(a) * lean;
      const w = 0.05;
      t.push(-w, 0, 0, w, 0, 0, tx, 1, tz);
      t.push(0, 0, -w, 0, 0, w, tx, 1, tz);
    }
    _brush = soup(t);
    return _brush;
  }
  function ribGeo() {
    if (_rib) return _rib;
    _rib = new THREE.TorusGeometry(0.55, 0.05, 3, 6, Math.PI);
    return _rib;
  }
  function chassisGeo() {
    if (_chassis) return _chassis;
    // a burnt chassis rather than a 2.2×1.4×5.0 box: cab, bed, and a gap
    // between them, which is what makes a wreck at 200 m read as a vehicle
    const t = [];
    function bx(cx, cy, cz, sx, sy, sz) {
      const X = [cx - sx / 2, cx + sx / 2], Y = [cy - sy / 2, cy + sy / 2], Z = [cz - sz / 2, cz + sz / 2];
      const q = function (a, b, c, d) { t.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]); };
      const V = function (i, j, k) { return [X[i], Y[j], Z[k]]; };
      q(V(0, 0, 0), V(1, 0, 0), V(1, 1, 0), V(0, 1, 0));
      q(V(1, 0, 1), V(0, 0, 1), V(0, 1, 1), V(1, 1, 1));
      q(V(0, 0, 1), V(0, 0, 0), V(0, 1, 0), V(0, 1, 1));
      q(V(1, 0, 0), V(1, 0, 1), V(1, 1, 1), V(1, 1, 0));
      q(V(0, 1, 0), V(1, 1, 0), V(1, 1, 1), V(0, 1, 1));
      q(V(0, 0, 1), V(1, 0, 1), V(1, 0, 0), V(0, 0, 0));
    }
    bx(0, 0.5, 1.4, 2.2, 1.0, 2.2);    // cab
    bx(0, 0.35, -1.3, 2.0, 0.5, 3.0);  // flatbed
    bx(0, 0.75, -2.6, 1.9, 1.2, 0.2);  // the one standing panel
    _chassis = soup(t);
    return _chassis;
  }

  /* ============================================================ THE FRAME
     One updater for the whole library: the banner cloth, the fire flicker,
     the smoke drift and the LOD swap. Sixty banners at three segments is 180
     matrix composes; the fires are one scale write each. Registered at order
     46 — after the world moves and before the frame is drawn. */
  let clock = 0;
  function tickAll(dt) {
    clock += dt || 0.016;
    const cam = CBZ.camera;
    const out = [];
    for (let i = liveBanners.length - 1; i >= 0; i--) {
      const b = liveBanners[i];
      if (!b.segs[0].parent) { liveBanners.splice(i, 1); continue; }
      clothChain(clock, b.phase, b.fly, b.drop, out);
      for (let k = 0; k < CLOTH_SEG; k++) {
        const o = out[k];
        b.segs[k].position.set(o.x, o.y, o.z);
        b.segs[k].rotation.set(0, -o.yaw, o.pitch);
      }
    }
    // PRUNE AS WE GO. A campaign that rides past forty camps registers forty
    // fires; without this the list only grows and the frame cost of a torn-down
    // outpost never goes away.
    for (let i = liveFires.length - 1; i >= 0; i--) {
      const f = liveFires[i];
      const fl = f.userData.flame;
      if (!fl || !fl.parent || !f.parent) { liveFires.splice(i, 1); continue; }
      const k = 0.78 + Math.sin(clock * 11 + f.userData.phase) * 0.12 + Math.sin(clock * 27 + f.userData.phase * 3) * 0.09;
      fl.scale.set(k, k * 1.15, k);
      const sm = f.userData.smoke;
      if (sm) sm.rotation.y = Math.sin(clock * 0.23 + f.userData.phase) * 0.5 + WIND.dir;
    }
    if (cam) P.lodTick(cam.position);
  }

  /* ============================================================ AUDIT */
  P.audit = function () {
    const info = CBZ.renderer && CBZ.renderer.info;
    return {
      materials: Object.keys(_mats).length,
      geometries: _geo.size,
      rockSource: rockReady ? "rockscliffs.makeRock" : "icosahedron fallback",
      wreckSource: milState === "ready" ? "studio.model (shipped)" : milState,
      guns: !!(CBZ.weaponAppearance && CBZ.weaponAppearance.ak47),
      banners: liveBanners.length, fires: liveFires.length, lod: lodList.length,
      batch: !!CBZ.batchStaticUnder,
      draws: info ? info.render.calls : null,
      tris: info ? info.render.triangles : null,
      old: OLD,
    };
  };

  /* ============================================================ THE GALLERY
     ?props=1 — every prop in this file in a row on a flat pad, with a camera
     tour. It exists so this file can be looked at without desert.js,
     campaign.js or battle.js being finished, and it is what the before/after
     preset photographs. */
  const SHOTS = P.SHOTS = [
    { id: "depot",    label: "ARMS DEPOT",     eye: [-96, 13, 44],  aim: [-90, 5, 0],   fov: 44 },
    { id: "camp",     label: "RECRUIT CAMP",   eye: [-16, 12, 42],  aim: [-20, 3, 0],   fov: 46 },
    { id: "well",     label: "WELL / OASIS",   eye: [46, 11, 40],   aim: [42, 3, 2],    fov: 46 },
    { id: "market",   label: "NIGHT MARKET",   eye: [104, 10, 38],  aim: [98, 3, 0],    fov: 46 },
    { id: "banners",  label: "FACTION BANNERS", eye: [-40, 7, 118], aim: [-16, 5, 92],  fov: 40 },
    { id: "field",    label: "SIXTY BANNERS",  eye: [86, 24, 132],  aim: [86, 4, 92],   fov: 50 },
    { id: "wrecks",   label: "WRECKAGE",       eye: [-40, 12, 196], aim: [-20, 2, 156], fov: 50 },
    { id: "cover",    label: "BATTLE COVER",   eye: [-10, 8, 250],  aim: [10, 1.5, 214], fov: 52 },
    { id: "camp2",    label: "YOUR BIVOUAC",   eye: [4, 9, 300],    aim: [0, 2, 276],   fov: 46 },
    { id: "range",    label: "SILHOUETTES AT 900 m", eye: [10, 120, 900], aim: [0, 10, 0], fov: 26 },
  ];

  P.gallery = function () {
    const scene = CBZ.scene;
    if (!scene || galleryRoot) return galleryRoot;
    galleryRoot = new THREE.Group();
    galleryRoot.name = "warlordPropGallery";
    // a pad, big enough that no shot sees its edge
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), M("sand"));
    pad.rotation.x = -Math.PI / 2;
    pad.receiveShadow = true;
    galleryRoot.add(pad);

    const put = function (g, x, z, yaw) { P.place(g, x, 0, z, yaw || 0); galleryRoot.add(g); return g; };

    put(P.outpost("depot",  { seed: 7,  colour: 0xb9a13f }), -90, 0, 0.35);
    put(P.outpost("camp",   { seed: 13, colour: 0x4a8f5a }), -20, 0, -0.2);
    put(P.outpost("well",   { seed: 23 }), 42, 0, 0.6);
    put(P.outpost("market", { seed: 41, colour: 0x8f4fb8 }), 98, 0, 0.1);

    // the five factions, one hero banner each
    const F = W.FACTIONS || [];
    for (let i = 0; i < F.length; i++) {
      put(P.banner(F[i].colour, { h: 7.5, seed: i + 1 }), -60 + i * 12, 92, 0);
    }
    // and sixty of them, in three draw calls
    const field = P.bannerField({ cap: 64, liveR: 4000 });
    for (let i = 0; i < 60; i++) {
      const fx = 62 + (i % 10) * 5.4, fz = 78 + Math.floor(i / 10) * 5.6;
      field.add(fx, 0, fz, F.length ? F[i % F.length].colour : 0xc4593a, 0.8 + (i % 3) * 0.12);
    }
    galleryRoot.add(field.group);
    galleryField = field;

    const wk = P.wreckKinds;
    for (let i = 0; i < wk.length; i++) {
      put(P.wreck(wk[i], { seed: 100 + i * 7 }), -80 + i * 40, 156, i * 0.7);
    }
    const ck = P.coverKinds;
    for (let i = 0; i < ck.length; i++) {
      put(P.cover(ck[i], { w: 3.2, h: 1.9, d: 2.4, seed: 200 + i * 11 }), -70 + i * 20, 214, i * 0.4);
    }
    // and one real field: 120 boulders, batched, so the draw count is honest
    const list = [];
    for (let i = 0; i < 120; i++) {
      const a = W.hash01(i, 3, 91) * TAU, rr = 6 + Math.sqrt(W.hash01(i, 5, 97)) * 34;
      list.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, y: 0,
                  w: 1.4 + W.hash01(i, 7, 101) * 3.4, h: 1.1 + W.hash01(i, 9, 103) * 2.2,
                  d: 1.3 + W.hash01(i, 11, 107) * 3.0, yaw: W.hash01(i, 13, 109) * TAU,
                  kind: W.hash01(i, 15, 113) < 0.25 ? "slab" : "boulder" });
    }
    const cf = P.coverField(list);
    cf.group.position.set(150, 0, 214);
    galleryRoot.add(cf.group);

    put(P.bivouac({ men: 40, seed: 5, colour: 0xd9b979 }), 0, 276, 0);

    scene.add(galleryRoot);
    return galleryRoot;
  };
  let galleryRoot = null, galleryField = null;

  P.look = function (id) {
    const cam = CBZ.camera;
    let s = null;
    for (let i = 0; i < SHOTS.length; i++) if (SHOTS[i].id === id) s = SHOTS[i];
    if (!cam || !s) return null;
    cam.position.set(s.eye[0], s.eye[1], s.eye[2]);
    cam.lookAt(s.aim[0], s.aim[1], s.aim[2]);
    if (s.fov) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
    if (galleryField) galleryField.tick(clock, null);
    P.lodTick(cam.position);
    return s;
  };

  /* ============================================================ MODULE
     Registered as the API OBJECT ITSELF, not a fresh {needs, boot} literal —
     core's W.module does `W[name] = api`, and handing it a literal would
     replace W.props with an object holding two keys, which is the trap
     desert.js's own comment shouts about.

     boot() costs a script tag, a studio.need() and one updater. It builds no
     geometry: nine outposts of prop meshes at page load is a second-long
     stall before the title card, and the campaign does not need one until
     you are on the island. */
  P.needs = [];
  P.boot = function (ctx) {
    P.ctx = ctx;
    wantRock();
    wantMil();
    if (CBZ.onUpdate) CBZ.onUpdate(46.0, tickAll);
    if (ctx && ctx.Q && ctx.Q.get("audit") === "1") {
      try { console.log("[warlord/props]", P.audit()); } catch (e) {}
    }
    if (!Q.get("props")) return;
    /* THE GALLERY ENTRY. Deferred a beat so every other module has booted and
       the page's own menu is up to be closed; the wait loop is on the LAZY
       deps, not on a number of milliseconds, so the pictures always contain
       the real rock and the real truck rather than whatever had landed when
       a timer fired. */
    const start = Date.now();
    (function waitThenBuild() {
      const ready = (rockReady || NO_ROCK || OLD || Date.now() - start > 6000) &&
                    (milState === "ready" || milState === "absent" || Date.now() - start > 6000);
      if (!ready) { setTimeout(waitThenBuild, 60); return; }
      if (ctx && ctx.closeScreen) ctx.closeScreen();
      const hud = ctx && ctx.hud;
      if (hud) hud.classList.remove("on");
      /* THE PHASE STAYS "menu". Handing it to campaign.js would raise the
         whole 14 km island under the gallery and this entry exists precisely
         so props.js is never blocked on campaign.js existing. The screen is
         closed by hand instead, and micro's own render loop draws CBZ.scene
         whether or not anybody owns a phase. */
      P.gallery();
      P.look(Q.get("shot") || "depot");
      G.__warlordProps = P;
      G.__warlordPropsReady = true;
      try { console.log("[warlord/props] gallery", P.audit()); } catch (e) {}
    })();
  };
  W.module("props", P);
})();
