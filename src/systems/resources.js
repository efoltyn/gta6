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
  if (A && !A.has("harvest-tree")) {
    A.define("harvest-tree", {
      footprint: { hx: 0.6, hz: 0.6 }, clearance: 0.6, y1: 6, zone: "nature",
      instanceable: true,
      geom: function () {
        const trunk = new THREE.CylinderGeometry(0.18, 0.26, 1.6, 6); trunk.translate(0, 0.8, 0);
        const canopy = new THREE.ConeGeometry(1.0, 2.2, 7); canopy.translate(0, 2.7, 0);
        const merge = THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries;
        if (merge) { const m = merge([trunk, canopy], false); if (m) return m; }
        return canopy;                          // fallback: a bare canopy still reads as "a tree"
      },
      material: function () { return cmat(0x3f7a3f); },
      build: function (ctx) {
        const s = ctx.scale || 1;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.26 * s, 1.6 * s, 6), cmat(0x5a3d22));
        trunk.position.y = 0.8 * s; ctx.group.add(trunk);
        const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.0 * s, 2.2 * s, 7), cmat(0x3f7a3f));
        canopy.position.y = 2.7 * s; ctx.group.add(canopy);
      },
    });
  }
  if (A && !A.has("harvest-rock")) {
    A.define("harvest-rock", {
      footprint: { hx: 0.7, hz: 0.7 }, clearance: 0.4, y1: 1.2, zone: "nature",
      instanceable: true,
      geom: function () { return new THREE.IcosahedronGeometry(0.7, 0); },
      material: function () { return cmat(0x7c7a73); },
      build: function (ctx) {
        const s = ctx.scale || 1;
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7 * s, 0), cmat(0x7c7a73));
        m.position.y = 0.35 * s; ctx.group.add(m);
      },
    });
  }
  if (A && !A.has("harvest-scrap")) {
    A.define("harvest-scrap", {
      footprint: { hx: 0.6, hz: 0.5 }, clearance: 0.3, y1: 0.7, zone: "nature",
      instanceable: true,
      geom: function () { const bg = new THREE.BoxGeometry(1.1, 0.55, 0.8); bg.translate(0, 0.275, 0); return bg; },
      material: function () { return cmat(0x6b5a4a); },
      build: function (ctx) {
        const s = ctx.scale || 1;
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.1 * s, 0.55 * s, 0.8 * s), cmat(0x6b5a4a));
        m.position.y = 0.275 * s; ctx.group.add(m);
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
    _v.set(node.x, 0, node.z);
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
          const node = {
            id: nextId++, kind: kind, x: x, z: z, rot: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.6,
            hp: HP0[kind], maxHp: HP0[kind], poolKey: POOLKEY[kind], slot: -1,
            depleted: false, respawnAt: 0,
          };
          if (!acquireAndSet(node)) continue;    // pool at capacity — skip this candidate
          CBZ.placement.reserve(rect);
          placed.push(node);
          need[kind]--;
        }
      }
    }
    CBZ.resourceNodes.push.apply(CBZ.resourceNodes, placed);
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
  // which carry melee:true so CBZ.cityGiveWeapon (systems/craft.js calls it
  // right after crafting one) puts them there with zero special-casing.
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
    if (CBZ.sfx) CBZ.sfx(node.kind === "rock" ? "clank" : "hit");
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
