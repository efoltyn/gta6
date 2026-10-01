/* ============================================================
   systems/resources.js — B7: HARVEST NODES (CITY ONLY).

   Trees, rocks and scrap piles scattered along the city's road fringes
   (park/sidewalk strips — never on the road itself, never inside anything
   CBZ.placement already reserves). Swinging a melee blow at one (city/
   combat.js's lightAttack/heavyAttack, when there's no ped in the cone —
   see the CBZ.resourceHarvestSwing() calls added there) knocks Wood/Stone/
   Scrap into the player's city inventory (g.cityInv via CBZ.cityEcon),
   scaled by whichever tool is equipped (Hatchet on trees, Pickaxe on
   rocks). A depleted node poolReleases its instance and comes back later.

   DRAW-CALL / F6 DISCIPLINE: one CBZ.assets instanceable def per species
   (harvest-tree / harvest-rock / harvest-scrap) → ONE InstancedMesh each,
   addressed through CBZ.assets.poolAcquire/poolRelease (city/assets.js's
   F6 free-list) so a chopped-down tree actually frees its GPU slot instead
   of just hiding forever — and a respawn re-acquires (very likely the SAME
   slot back) rather than growing the pool without bound.

   PLACEMENT: a seeded LCG (never Math.random — deterministic scatter, same
   forest every run) walks the city's own road grid lines (CBZ.CITY: center/
   blocks/block/road — the exact math city/world.js's buildCity() uses) and
   offers candidates just past each road's shoulder (the sidewalk/park
   fringe), skipping road corners, anything CBZ.placement already reserves
   (roads/lots that opted into the occupancy layer, player-built pieces,
   etc.) and anything too close to an already-placed node. Reserves its own
   footprint afterward so later building doesn't stack a foundation on a
   tree stump.

   Publishes:
     CBZ.resourceNodes            — live node records (see NODE SHAPE below)
     CBZ.resourceHarvestSwing()   — try to harvest whatever's directly in
                                    front of the player within melee reach;
                                    returns true if a swing landed on a node
   NODE SHAPE: { id, kind:"tree"|"rock"|"scrap", x, z, rot, scale, hp, maxHp,
                 poolKey, slot, depleted, respawnAt }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  const A = CBZ.assets;

  function cmat(hex, opts) {
    if (CBZ.cmat) return CBZ.cmat(hex, opts);
    if (CBZ.mat) return CBZ.mat(hex, opts);
    return new THREE.MeshLambertMaterial({ color: hex });
  }

  // ============================================================
  //  ASSET DEFS — one instanceable single-mesh species per kind so
  //  poolAcquire/poolRelease (the fast, addressable path) is always
  //  available; each also ships a build() for feature-parity with the
  //  rest of city/assets.js's registry even though this file only ever
  //  goes through the pool path.
  // ============================================================
  // TREES_V2 (config.js): the old harvest tree's canopy base sat at EXACTLY
  // the trunk top (both at y=1.6 — a zero-margin knife-edge). V2 sinks the
  // canopy 0.25 onto the trunk and the trunk base 0.05 under the ground
  // plane, and stacks a small second tier into the same merged geo (still
  // ONE pooled InstancedMesh — zero draw-call change). Nodes register with
  // world/treeaudit.js through an alive() gate so a chopped tree never
  // reads as "missing parts".
  const TREES2 = !!(CBZ.CONFIG && CBZ.CONFIG.TREES_V2 !== false && CBZ.treeRegisterTree);
  // ONE TREE GRAMMAR / ROOTS (world/treeaudit.js §2)
  const GRAM = !!(CBZ.CONFIG && CBZ.CONFIG.TREES_ONE_GRAMMAR !== false);
  const ROOTS = !!(CBZ.CONFIG && CBZ.CONFIG.TREES_ROOTS !== false);
  const HARVEST_Y0 = (ROOTS && CBZ.treeTrunkGeo) ? -0.12 : -0.05;   // the geo's real floor, roots included
  if (A && !A.has("harvest-tree")) {
    A.define("harvest-tree", {
      footprint: { hx: 0.6, hz: 0.6 }, clearance: 0.6, y1: 6, zone: "nature",
      instanceable: true,
      geom: function () {
        const merge = THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries;
        if (TREES2) {
          // ONE TREE GRAMMAR + ROOTS (world/treeaudit.js §2). A harvest node
          // is UNIFORMLY scaled, so the flare is authored in metres. Roots
          // matter more here than anywhere else in the game: this is a tree
          // the player walks up to and swings an axe at, i.e. the one you
          // actually look at the bottom of.
          const trunk = (ROOTS && CBZ.treeTrunkGeo)
            ? CBZ.treeTrunkGeo({ rTop: 0.18, rBase: 0.26, h: 1.65, y0: -0.05, seg: 6,
                roots: 4, rise: 0.24, dip: 0.07, spread: 2.2, flare: 1.5, site: "harvest" })
            : (function () { const t = new THREE.CylinderGeometry(0.18, 0.26, 1.65, 6); t.translate(0, 0.775, 0); return t; })();
          if (GRAM && CBZ.treeCrownGeo) {
            // same envelope as the authored pair below: [1.35 .. 4.00],
            // widest radius 1.0, tip radius 0.62 — solved, not re-typed.
            const crown = CBZ.treeCrownGeo({ tiers: 2, r: 1.0, h: 2.65, y0: 1.35, seg: 7, taper: 0.62, site: "harvest" });
            if (merge) { const m = merge([trunk, crown], false); if (m) return m; }
            return crown;
          }
          const canopy = new THREE.ConeGeometry(1.0, 2.2, 7); canopy.translate(0, 2.45, 0);              // [1.35 .. 3.55] — trunk top buried 0.25
          const tip = new THREE.ConeGeometry(0.62, 1.3, 7); tip.translate(0, 3.35, 0);                   // [2.70 .. 4.00] — second tier, overlaps 0.85
          if (merge) { const m = merge([trunk, canopy, tip], false); if (m) return m; }
          return canopy;
        }
        const trunk = new THREE.CylinderGeometry(0.18, 0.26, 1.6, 6); trunk.translate(0, 0.8, 0);
        const canopy = new THREE.ConeGeometry(1.0, 2.2, 7); canopy.translate(0, 2.7, 0);
        if (merge) { const m = merge([trunk, canopy], false); if (m) return m; }
        return canopy;                          // fallback: a bare canopy still reads as "a tree"
      },
      material: function () { return cmat(0x3f7a3f); },
      build: function (ctx) {
        const s = ctx.scale || 1;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.26 * s, 1.6 * s, 6), cmat(0x5a3d22));
        trunk.position.y = 0.8 * s; ctx.group.add(trunk);
        const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.0 * s, 2.2 * s, 7), cmat(0x3f7a3f));
        canopy.position.y = TREES2 ? 2.45 * s : 2.7 * s;   // V2: base 1.35s — the trunk top (1.6s) is buried 0.25s
        ctx.group.add(canopy);
      },
    });
  }
  if (A && !A.has("harvest-rock")) {
    A.define("harvest-rock", {
      footprint: { hx: 0.7, hz: 0.7 }, clearance: 0.4, y1: 1.2, zone: "nature",
      instanceable: true,
      // A HARVEST ROCK IS STILL A ROCK, IT JUST STOPS BEING A SOLID. This was
      // a bare IcosahedronGeometry — the smooth 20-faced potato that
      // world/rockscliffs.js exists to replace, and the same "little gray
      // geometric thing" the owner asked us to stop scattering. Same radius,
      // same footprint, same y1, same one instanced draw call: only the
      // vertices change, through the ONE rock factory (its scrape algorithm
      // chips real planar fracture facets). Size is deliberately NOT touched
      // — this one you walk up to and swing a pickaxe at.
      geom: function () {
        return CBZ.makeRock ? CBZ.makeRock(0.7, 0x2E5716, 1, { scrapes: 9, depthMin: 0.06, depthMax: 0.34 })
          : new THREE.IcosahedronGeometry(0.7, 0);
      },
      material: function () { const m = cmat(0x7c7a73); m.flatShading = true; return m; },
      build: function (ctx) {
        const s = ctx.scale || 1;
        const rg = CBZ.makeRock ? CBZ.makeRock(0.7 * s, 0x2E5716, 1, { scrapes: 9, depthMin: 0.06, depthMax: 0.34 })
          : new THREE.IcosahedronGeometry(0.7 * s, 0);
        const m = new THREE.Mesh(rg, cmat(0x7c7a73));
        m.position.y = 0.35 * s; ctx.group.add(m);
      },
    });
  }
  // the scrap pile, authored in metres, footprint inside the def's 0.6 x 0.5
  // half-extents, base on y = 0. Built and baked once.
  let _scrapGeo;
  function scrapPileGeo() {
    if (_scrapGeo !== undefined) return _scrapGeo;
    _scrapGeo = null;
    if (!CBZ.itemAssetBakeGroup || !CBZ.itemAssetVCMat) return null;
    try {
      const grp = new THREE.Group();
      const part = function (geo, hex, x, y, z, rx, ry, rz, sx, sy, sz) {
        const m = new THREE.Mesh(geo, cmat(hex));
        m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0);
        if (sx) m.scale.set(sx, sy || sx, sz || sx);
        grp.add(m); return m;
      };
      const B = function (w, h, d) { return new THREE.BoxGeometry(w, h, d); };
      const Cy = function (r, h, seg) { return new THREE.CylinderGeometry(r, r, h, seg || 10); };
      // a steel drum lying on its side, dented (squashed), faded paint + rims
      part(Cy(0.21, 0.56, 14), 0x3f5c74, 0.18, 0.19, -0.14, 0, 0.35, Math.PI / 2, 1, 1, 0.86);
      part(Cy(0.215, 0.03, 14), 0x2c3a44, 0.18 - Math.cos(0.35) * 0.20, 0.19, -0.14 + Math.sin(0.35) * 0.20, 0, 0.35, Math.PI / 2, 1, 1, 0.86);
      part(Cy(0.215, 0.03, 14), 0x2c3a44, 0.18 + Math.cos(0.35) * 0.20, 0.19, -0.14 - Math.sin(0.35) * 0.20, 0, 0.35, Math.PI / 2, 1, 1, 0.86);
      // a rusted corrugated sheet slumped over it, ridges along its length
      const sheet = new THREE.Group();
      sheet.position.set(0.02, 0.24, 0.02); sheet.rotation.set(0.10, -0.12, 0.30); grp.add(sheet);
      const sm = function (geo, hex, x, y, z) { const m = new THREE.Mesh(geo, cmat(hex)); m.position.set(x, y, z); sheet.add(m); };
      sm(B(0.96, 0.012, 0.62), 0x7b4a2c, 0, 0, 0);
      for (let i = 0; i < 6; i++) sm(B(0.96, 0.022, 0.04), i % 2 ? 0x6a3f26 : 0x8a5634, 0, 0.012, -0.26 + i * 0.104);
      // an old tyre lying flat, and its rim well
      part(new THREE.TorusGeometry(0.25, 0.085, 8, 18), 0x1d1e20, -0.30, 0.085, 0.20, Math.PI / 2, 0, 0);
      part(Cy(0.17, 0.02, 14), 0x2a2b2e, -0.30, 0.02, 0.20);
      // pipe and angle iron
      part(Cy(0.028, 1.02, 8), 0x6d7174, -0.05, 0.03, 0.34, 0, 0.18, Math.PI / 2);
      part(Cy(0.022, 0.84, 8), 0x7e5a3e, 0.10, 0.07, 0.30, 0.1, -0.30, Math.PI / 2 - 0.08);
      part(B(0.9, 0.04, 0.004), 0x5f5850, 0.05, 0.02, -0.38, 0, 0.08, 0);
      part(B(0.9, 0.004, 0.04), 0x5f5850, 0.05, 0.002, -0.36, 0, 0.08, 0);
      // a broken pallet leaning into the back of the pile
      const pal = new THREE.Group();
      pal.position.set(-0.36, 0.22, -0.20); pal.rotation.set(0, 0.4, 0.95); grp.add(pal);
      const pm = function (geo, hex, x, y, z) { const m = new THREE.Mesh(geo, cmat(hex)); m.position.set(x, y, z); pal.add(m); };
      for (let i = 0; i < 4; i++) if (i !== 2) pm(B(0.09, 0.018, 0.62), i % 2 ? 0x8b7556 : 0x9a8462, -0.15 + i * 0.1, 0, 0);
      pm(B(0.40, 0.06, 0.06), 0x7a6548, 0, -0.04, -0.24);
      pm(B(0.40, 0.06, 0.06), 0x7a6548, 0, -0.04, 0.24);
      _scrapGeo = CBZ.itemAssetBakeGroup(grp);
      // the loose parts were only scaffolding for the bake
      grp.traverse(function (o) { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      if (_scrapGeo) {
        _scrapGeo.computeBoundingBox();
        const lo = _scrapGeo.boundingBox.min.y;
        _scrapGeo.translate(0, -lo - 0.01, 0);                   // sit on the ground, a hair bedded in
        _scrapGeo.computeBoundingBox(); _scrapGeo.computeBoundingSphere();
      }
    } catch (e) { _scrapGeo = null; }
    return _scrapGeo;
  }
  if (A && !A.has("harvest-scrap")) {
    A.define("harvest-scrap", {
      footprint: { hx: 0.6, hz: 0.5 }, clearance: 0.3, y1: 0.7, zone: "nature",
      instanceable: true,
      // A SCRAP PILE IS SCRAP. It was one 1.1 x 0.55 x 0.8 brown box — thirty
      // identical cardboard-coloured cubes along the city's sidewalks with a
      // "hit it for Scrap" verb on them. Now it is the thing a scrapper picks
      // through: a rusted corrugated sheet slumped over a lying drum, an old
      // tyre, lengths of pipe and angle iron, a broken pallet. Still ONE
      // instanced draw call: the parts are baked into a single vertex-coloured
      // geometry by city/itemassets.js's bake (the box stays as the degrade).
      geom: function () {
        const baked = scrapPileGeo();
        if (baked) return baked;
        const bg = new THREE.BoxGeometry(1.1, 0.55, 0.8); bg.translate(0, 0.275, 0); return bg;
      },
      material: function () {
        return (scrapPileGeo() && CBZ.itemAssetVCMat) ? CBZ.itemAssetVCMat() : cmat(0x6b5a4a);
      },
      build: function (ctx) {
        const s = ctx.scale || 1;
        const geo = scrapPileGeo();
        const m = geo ? new THREE.Mesh(geo, CBZ.itemAssetVCMat()) : new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.8), cmat(0x6b5a4a));
        if (!geo) m.position.y = 0.275;
        m.scale.setScalar(s); if (!geo) m.position.y *= s;
        ctx.group.add(m);
      },
    });
  }

  // ============================================================
  //  SCATTER — deterministic LCG (never Math.random)
  // ============================================================
  let _s = 424242;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }

  const QUOTA = { tree: 60, rock: 40, scrap: 30 };
  const CAP = { tree: 96, rock: 64, scrap: 48 };          // pool capacity, headroom above quota
  const HP0 = { tree: 10, rock: 12, scrap: 8 };
  const POOLKEY = { tree: "harvest-tree", rock: "harvest-rock", scrap: "harvest-scrap" };
  const RESOURCE_OF = { tree: "Wood", rock: "Stone", scrap: "Scrap" };
  const RESPAWN_MS = 240000;                              // 240s

  CBZ.resourceNodes = CBZ.resourceNodes || [];
  let built = false, nextId = 1;

  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(),
    _sc = new THREE.Vector3(), _ax = new THREE.Vector3(0, 1, 0);

  // (re)acquire a pool slot for `node` and write its transform. Used both at
  // first placement and again on respawn (same x/z/rot/scale each time).
  function acquireAndSet(node) {
    if (!A) return false;
    const rec = A.poolAcquire(POOLKEY[node.kind], CAP[node.kind]);
    if (!rec) return false;
    node.slot = rec.index;
    _q.setFromAxisAngle(_ax, node.rot);
    _v.set(node.x, node.y || 0, node.z);
    _sc.set(node.scale, node.scale, node.scale);
    _m4.compose(_v, _q, _sc);
    rec.mesh.setMatrixAt(node.slot, _m4);
    rec.mesh.instanceMatrix.needsUpdate = true;
    return true;
  }

  function tooClose(list, x, z, min) {
    for (let i = 0; i < list.length; i++) { const n = list[i]; if (Math.hypot(n.x - x, n.z - z) < min) return true; }
    return false;
  }

  function build() {
    built = true;                       // never retry every frame even if something below bails
    if (!A || !CBZ.placement || !CBZ.CITY) return;
    if (TREES2 && CBZ.treeAuditResetSite) CBZ.treeAuditResetSite("harvest");
    const C = CBZ.CITY, cx = C.center.x, cz = C.center.z;
    const N = C.blocks, BLK = C.block, ROAD = C.road;
    const step = BLK + ROAD, half = (N * step) / 2;
    const xLines = [], zLines = [];
    for (let k = 0; k <= N; k++) { xLines.push(cx - half + k * step); zLines.push(cz - half + k * step); }
    const spanLo = -half + 4, spanHi = half - 4;   // local coordinate along a line, relative to its own axis centre
    const kinds = ["tree", "rock", "scrap"];
    const need = { tree: QUOTA.tree, rock: QUOTA.rock, scrap: QUOTA.scrap };
    const placed = [];
    const MIN_SPACING = 5;
    const CORNER_BUFFER = 8;
    const MAX_TRIES = 6000;
    let tries = 0;

    function wantKind() {
      const avail = kinds.filter(function (k) { return need[k] > 0; });
      if (!avail.length) return null;
      return avail[(rng() * avail.length) | 0];
    }

    // axis A: x = const grid lines, walk along z. axis B: z = const grid
    // lines, walk along x. Candidates sit just past the road's shoulder
    // (ROAD/2 + a few metres — the sidewalk/park fringe), never ON the road.
    const axes = [
      { lines: xLines, vertical: true },
      { lines: zLines, vertical: false },
    ];
    outer:
    for (let ai = 0; ai < axes.length; ai++) {
      const axis = axes[ai];
      for (let li = 0; li < axis.lines.length; li++) {
        const L = axis.lines[li];
        let t = spanLo + (axis.vertical ? cz : cx);
        const tHi = spanHi + (axis.vertical ? cz : cx);
        while (t <= tHi) {
          tries++;
          if (tries > MAX_TRIES || !kinds.some(function (k) { return need[k] > 0; })) break outer;
          const along = t + (rng() - 0.5) * 6;
          t += 9 + rng() * 7;
          const localAlong = along - (axis.vertical ? cz : cx);
          if (Math.abs(localAlong - spanLo) < CORNER_BUFFER || Math.abs(localAlong - spanHi) < CORNER_BUFFER) continue;
          const side = rng() < 0.5 ? -1 : 1;
          const off = (ROAD / 2) + 2.5 + rng() * 4;
          let x, z;
          if (axis.vertical) { x = L + off * side; z = along; } else { x = along; z = L + off * side; }
          if (tooClose(placed, x, z, MIN_SPACING)) continue;
          const hx = 0.9;
          const rect = { minX: x - hx, maxX: x + hx, minZ: z - hx, maxZ: z + hx };
          if (!CBZ.placement.isFree(rect)) continue;
          const kind = wantKind();
          if (!kind) break outer;
          // THE GROUND IT STANDS ON. Nodes used to be planted at y 0 while the
          // footway / lot they stand on is 0.125-0.18 up: every harvest tree's
          // root flare was buried and its trunk came straight out of the
          // paving, every rock and scrap pile sunk to its knees.
          const SK = CBZ.streetKit;
          let gy = SK && SK.heightAt ? SK.heightAt(x, z) : null;
          if (gy == null && typeof CBZ.floorAt === "function") gy = CBZ.floorAt(x, z);
          const node = {
            id: nextId++, kind: kind, x: x, y: isFinite(gy) ? gy : 0, z: z, rot: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.6,
            hp: HP0[kind], maxHp: HP0[kind], poolKey: POOLKEY[kind], slot: -1,
            depleted: false, respawnAt: 0,
          };
          if (!acquireAndSet(node)) continue;    // pool at capacity — skip this candidate
          if (TREES2 && kind === "tree") {
            // register with the connection-law audit. The V2 merged geo is one
            // rigid part (tiers overlap by authored construction — see geom()
            // above: trunk [-0.05..1.6], canopy [1.35..3.55], tip [2.7..4.0]),
            // so the audit applies the seat law; alive() skips chopped trees.
            const parts = [];
            // HARVEST_Y0 tracks the geo's REAL floor: the root spurs sink to
            // -0.12, and a registered box that stopped at -0.05 would be
            // claiming less tree than is drawn. An audit bound is only worth
            // anything while it matches the vertices.
            CBZ.treeAabbPush(parts, _m4, -1.0, HARVEST_Y0, -1.0, 1.0, 4.0, 1.0);   // _m4 still holds this node's matrix
            CBZ.treeRegisterTree("harvest", node.y, parts, (function (nd) {
              return function () { return !nd.depleted && nd.slot >= 0; };
            })(node));
          }
          CBZ.placement.reserve(rect);
          placed.push(node);
          need[kind]--;
        }
      }
    }
    CBZ.resourceNodes.push.apply(CBZ.resourceNodes, placed);
    // contact: the crown's shade under every harvest tree (a stump keeps it)
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    if (CBZ.treeFoot && root) {
      const feet = [];
      for (const n of placed) if (n.kind === "tree") feet.push(n.x, n.y, n.z, 1.3 * n.scale, 0);
      CBZ.treeFoot.add(root, feet, { name: "harvest-trees", fogScale: 0.10 });
    }
  }

  // ============================================================
  //  RESPAWN — mirrors city/roofloot.js's own restock-timer pattern.
  // ============================================================
  CBZ.onUpdate(36.75, function (dt) {           // near roofloot's 36.7 band — same kind of "world content" tick
    if (g.mode !== "city") return;
    if (!built) {
      if (CBZ.city && CBZ.city.arena) build();
      if (!built) return;
    }
    const now = CBZ.now || 0;
    const nodes = CBZ.resourceNodes;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.depleted && now >= n.respawnAt) {
        n.hp = n.maxHp; n.depleted = false;
        acquireAndSet(n);
      }
    }
  });

  // ============================================================
  //  HARVESTING — called from city/combat.js's lightAttack/heavyAttack when
  //  the swing found no ped in front (aimTarget only ever considers cityCops/
  //  cityPeds, so a miss there is exactly "nothing but maybe a node here").
  // ============================================================
  const REACH = 2.2;      // "nearest node < 2.2m in the facing direction" per the task spec
  const CONE = 0.5;       // forgiving ~60° half-cone, same spirit as combat.js's own aimTarget cone

  function lookDir() {
    const y = CBZ.cam ? CBZ.cam.yaw : 0;
    return { x: -Math.sin(y), z: -Math.cos(y) };
  }

  function nearestNode(px, pz, dir) {
    let best = null, bd = REACH;
    const nodes = CBZ.resourceNodes;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.depleted) continue;
      const dx = n.x - px, dz = n.z - pz, d = Math.hypot(dx, dz);
      if (d > REACH || d < 0.15) continue;
      const dot = (dx / d) * dir.x + (dz / d) * dir.z;
      if (dot < CONE) continue;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  // Tool multiplier: Hatchet chops trees 3x, Pickaxe mines rocks 3x, bare
  // hands (or the wrong tool) are 1x. "Equipped" reads the SAME slot
  // city/combat.js's melee weapons already occupy (CBZ.cityCurrentWeaponName
  // → g.cityMeleeWeapon) — see city/economy.js's Hatchet/Pickaxe entries,
  // which carry melee:true so CBZ.cityGiveWeapon puts them there with zero
  // special-casing (tools are bought/looted; crafting is deleted).
  function toolMult(kind, tool) {
    if (kind === "tree" && tool === "Hatchet") return 3;
    if (kind === "rock" && tool === "Pickaxe") return 3;
    return 1;
  }

  CBZ.resourceHarvestSwing = function () {
    if (g.mode !== "city" || !CBZ.player || !CBZ.resourceNodes || !CBZ.resourceNodes.length) return false;
    const P = CBZ.player;
    const node = nearestNode(P.pos.x, P.pos.z, lookDir());
    if (!node) return false;
    const tool = CBZ.cityCurrentWeaponName ? CBZ.cityCurrentWeaponName() : null;
    const mult = toolMult(node.kind, tool);
    const base = 1 + ((rng() * 2) | 0);              // 1-2 units per hit, bare-handed
    const give = base * mult;
    node.hp -= give;
    if (CBZ.cityEcon && CBZ.cityEcon.add) CBZ.cityEcon.add(RESOURCE_OF[node.kind], give);
    if (node.kind !== "rock" && CBZ.sfx) CBZ.sfx("hit");
    if (CBZ.flashHint) CBZ.flashHint("+" + give + " " + RESOURCE_OF[node.kind], 0.8);
    if (node.hp <= 0 && !node.depleted) {
      node.depleted = true;
      node.respawnAt = (CBZ.now || 0) + RESPAWN_MS;
      if (node.slot >= 0 && A) A.poolRelease(node.poolKey, node.slot);
      if (CBZ.flashHint) CBZ.flashHint((node.kind === "tree" ? "Tree" : node.kind === "rock" ? "Rock" : "Scrap pile") + " depleted", 1.0);
    }
    return true;
  };
})();
