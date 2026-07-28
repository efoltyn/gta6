/* ============================================================
   core/farcull.js — distance culling for the static city.

   WHY: at low quality tiers the fog is pulled in hard (quality.js
   publishes CBZ.cityFogFar), so everything beyond fog.far renders as a
   fully fog-coloured silhouette — invisible, yet still fully drawn.
   Frustum culling can't reject what's IN FRONT of the camera, and the
   glass/emissive window meshes can't be batch-merged (they shatter
   individually), so a distant tower still costs hundreds of draw calls
   to paint pure fog. This module hides whole top-level city groups
   (building shells + their windows + towns + islands) once they sit
   entirely past the full-detail radius. Real lot buildings continue through
   the atmospheric range as the measured instanced LOD below; only their
   unseen panes/interiors are removed (see core/quality.js's QUALITY table).

   SAFETY RULES (why this can't break gameplay):
     • visible=false does NOT affect r128 raycasts (LOS keeps hitting),
       colliders read rects, so physics/AI are untouched — the exact
       fact the wall-batch pass (core/batch.js) is built on.
     • We only ever RE-SHOW groups WE hid (own WeakSet). A group some
       other system hid (demolition's batchHideGroup companion
       b.group.visible=false, mode roots…) is skipped entirely, so we
       never resurrect a demolished building.
     • Anything dynamic is skipped: userData.dynamic subtrees, the
       named crowd root, and any group whose position moves between
       sweeps gets permanently blacklisted from culling.
     • Bounds are cached once per group (radius from a one-time Box3);
       the 4Hz sweep is a flat distance test per top-level child.
   Flag: CBZ.CONFIG.CITY_FAR_CULL (default ON). Flip false → every
   group this module hid is restored on the next sweep and it goes idle.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  if (CBZ.CONFIG && CBZ.CONFIG.CITY_FAR_CULL == null) CBZ.CONFIG.CITY_FAR_CULL = true;

  const hidByUs = new Set();        // groups WE set visible=false on
  const bounds = new WeakMap();     // group -> {x,z,r,px,pz,dynamic}
  const _box = new THREE.Box3();
  const _v = new THREE.Vector3();

  // ---- REAL DISTANT-BUILDING LOD ----------------------------------------
  // The old 430m fog wall hid every distant building. Merely lifting it made
  // the renderer submit every pane, room and prop from a kilometre away
  // (~8k calls at q3). Keep the *real* skyline cheaply instead: one box per
  // actual lot building, instanced in a single draw. Full enterable/glass
  // groups remain untouched nearby and are culled only once this measured
  // proxy is already present. Nothing is invented: position, footprint and
  // height all come from the live lot.building record.
  let proxyArena = null, proxyMesh = null, proxyRecords = [];
  const proxyDummy = new THREE.Object3D();
  const proxyColor = new THREE.Color();

  function disposeProxy() {
    if (proxyMesh && proxyMesh.parent) proxyMesh.parent.remove(proxyMesh);
    if (proxyMesh && proxyMesh.geometry) proxyMesh.geometry.dispose();
    if (proxyMesh && proxyMesh.material) proxyMesh.material.dispose();
    proxyMesh = null; proxyRecords = []; proxyArena = null;
  }

  function ensureProxy(A) {
    if (proxyArena === A && proxyMesh) return;
    disposeProxy();
    if (!A || !A.root || !THREE.InstancedMesh) return;
    // THE COMMERCE ANNEX HAD NO DISTANCE SKYLINE. `A.lots` is the mainland +
    // every town (towngen pushes into it), but city/expansion.js keeps the
    // island's ~20 buildings — including the 38- and 32-storey twin towers —
    // on its OWN `annex.lots` and never merged them in. So past the cull
    // radius the annex's whole skyline popped out and the island read as a
    // bare green disc beside downtown while every other settlement in the
    // world kept its proxy. Same records, same shape, one concat.
    //
    // AND THE CONCAT WAS THE TELL. A LOT is an ECONOMY record (Zillow, shops,
    // jobs, map POIs), not a census of what stands in the world — so keying the
    // distance skyline on it makes every builder that raises a shell without
    // selling one invisible past the radius. FOUR do, and they are exactly the
    // ones standing on empty ground where a missing skyline shows most:
    // govcomplex.js's nine complexes, island_military.js, island_airport.js's
    // terminal and biome_forest.js's cabins. `root.userData.shells` is
    // city/buildings.js's own registry — every cityMakeBuilding return, pushed
    // by the one function that mints a shell, so nobody opts in and a fifth
    // builder cannot re-open this. LOTS GO IN FIRST so a lot-backed record wins
    // the dedupe and keeps its `demolished` flag (demolition only ever walks
    // city.lots); shells merely fill the gaps. Degrade-safe: no registry, no
    // change.
    const seen = new Set();
    let lots = A.lots || [];
    if (A.annex && Array.isArray(A.annex.lots) && A.annex.lots.length) lots = lots.concat(A.annex.lots);
    const src = [];
    for (let i = 0; i < lots.length; i++) src.push({ lot: lots[i], b: lots[i] && lots[i].building });
    const shells = (A.root.userData && A.root.userData.shells) || null;
    if (shells) for (let i = 0; i < shells.length; i++) src.push({ lot: null, b: shells[i] });
    for (let i = 0; i < src.length; i++) {
      const lot = src[i].lot, b = src[i].b;
      if (!b || b.park || !b.group || seen.has(b.group)) continue;
      const w = +b.w, d = +b.d, h = +b.h;
      if (!(w > 1 && d > 1 && h > 1)) continue;
      seen.add(b.group);
      const x = Number.isFinite(b.ox) ? b.ox : ((lot && +lot.cx) || 0);
      const z = Number.isFinite(b.oz) ? b.oz : ((lot && +lot.cz) || 0);
      proxyRecords.push({ lot, grp: b.group, x, z, w, d, h, r: Math.hypot(w, d) * 0.5, shown: false });
    }
    if (!proxyRecords.length) { proxyArena = A; return; }

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, fog: true });
    proxyMesh = new THREE.InstancedMesh(geo, mat, proxyRecords.length);
    proxyMesh.name = "real-building-distance-lod";
    proxyMesh.userData.dynamic = true;       // batch/farcull must not consume its one draw
    proxyMesh.frustumCulled = false;          // prototype bounds do not span all instances in r128
    proxyMesh.castShadow = false; proxyMesh.receiveShadow = false;
    proxyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < proxyRecords.length; i++) {
      const r = proxyRecords[i];
      proxyDummy.position.set(r.x, -10000, r.z);
      proxyDummy.scale.set(0.001, 0.001, 0.001);
      proxyDummy.rotation.set(0, 0, 0); proxyDummy.updateMatrix();
      proxyMesh.setMatrixAt(i, proxyDummy.matrix);
      // Cool glass/concrete variants keep the actual skyline readable without
      // duplicating the full facade material graph in the distance pass.
      const n = CBZ.hash01 ? CBZ.hash01(r.x, r.z, 0xd157) : ((i * 0.61803398875) % 1);
      proxyColor.setHex(n < 0.34 ? 0x7899a2 : (n < 0.68 ? 0x8aa6aa : 0x71858f));
      proxyMesh.setColorAt(i, proxyColor);
    }
    proxyMesh.instanceMatrix.needsUpdate = true;
    if (proxyMesh.instanceColor) proxyMesh.instanceColor.needsUpdate = true;
    A.root.add(proxyMesh);
    proxyArena = A;
    CBZ.realBuildingLOD = { total: proxyRecords.length, visible: 0, drawCalls: 1, detailRadius: 0 };
  }

  function updateProxy(A, P, R) {
    ensureProxy(A);
    if (!proxyMesh || !P) return;
    let dirty = false, visible = 0;
    const enter = Math.max(0, R - 20); // overlap while inset: proxy is hidden inside the full shell
    for (let i = 0; i < proxyRecords.length; i++) {
      const r = proxyRecords[i];
      const d = Math.hypot(r.x - P.x, r.z - P.z) - r.r;
      // r.lot is null for a shell that never registered a lot (govcomplex, the
      // military island, the airport terminal, forest cabins) — and those are
      // precisely the ones demolition never touches, since it walks city.lots.
      const show = !!R && !(r.lot && r.lot.demolished) && d > enter;
      if (show) visible++;
      if (show === r.shown) continue;
      r.shown = show; dirty = true;
      if (show) {
        // A slight inset makes the transition overlap depth-safe: while the
        // detailed shell still exists, it fully covers this proxy.
        proxyDummy.position.set(r.x, r.h * 0.49, r.z);
        proxyDummy.scale.set(r.w * 0.92, r.h * 0.98, r.d * 0.92);
      } else {
        proxyDummy.position.set(r.x, -10000, r.z);
        proxyDummy.scale.set(0.001, 0.001, 0.001);
      }
      proxyDummy.rotation.set(0, 0, 0); proxyDummy.updateMatrix();
      proxyMesh.setMatrixAt(i, proxyDummy.matrix);
    }
    proxyMesh.visible = !!R;
    if (dirty) proxyMesh.instanceMatrix.needsUpdate = true;
    CBZ.realBuildingLOD = { total: proxyRecords.length, visible, drawCalls: visible ? 1 : 0, detailRadius: R };
  }

  function boundsFor(o) {
    let b = bounds.get(o);
    // A pool's bounds are its INSTANCES, so the "it MOVED → don't trust the
    // cache" rule the sweep applies to o.position has to apply to them too:
    // an InstancedMesh never moves its object transform, it rewrites matrices.
    // BufferAttribute bumps `version` on every needsUpdate, so that is the
    // cheap tell. Re-measure rather than blacklist — the pane pools legitimately
    // rewrite matrices on every shatter and every dusk flip, and a pool that
    // gets blacklisted for doing its job is the exemption bug all over again.
    if (b && b.dynamic) return b;
    if (b && !(o.isInstancedMesh && o.instanceMatrix && b.iv !== o.instanceMatrix.version)) return b;
    // one-time measure. Meshes with a bounding sphere are cheap; groups pay
    // one Box3 walk. Anything unmeasurable or world-spanning is marked
    // dynamic=true (== never cull).
    b = { x: 0, z: 0, r: 1e9, px: o.position.x, pz: o.position.z, dynamic: false };
    // A verdict taken from a TRANSIENT state must not be cached. The warm
    // night-pane pools sit at count 0 all day (city/buildings.js zeroes them so
    // ~60k degenerate instances stop entering the vertex shader); measuring one
    // at noon and caching "dynamic" would exempt it from culling for the whole
    // session, and it is exactly the pool that lights up after dusk.
    let cacheable = true;
    try {
      if (o.userData && (o.userData.dynamic || o.userData.terrain)) { b.dynamic = true; }
      else if (o.name === "city-crowd") { b.dynamic = true; }
      else if (o.isInstancedMesh) {
        // an InstancedMesh's geometry sphere is ONE prototype at the object's
        // own (usually origin) transform — measuring that hid far-flung pools
        // whenever the player left the origin, or never culled them at all.
        // Aggregate the true spread from the instance matrices once (positions
        // live at elements 12/14 of each 16-float block).
        //
        // THE GHOST CITY WAS THIS LINE. The per-instance slack used to be
        // `geometry.boundingSphere.radius * 3` — which assumes that sphere
        // describes ONE instance. city/buildings.js's pooledIM() deliberately
        // HAND-SETS an AGGREGATE sphere spanning its whole 320 u sector, so
        // r128 can frustum-cull the sector (its own comment: "core/farcull.js
        // can drop far cells wholesale"). Two files describing one object
        // independently: a populated downtown sector reads radius ~230, x3 =
        // ~690 of "slack", and b.r lands ~920 — straight past the 400 u
        // never-cull guard below. EVERY glass-pane, interior-mullion and
        // masonry-veneer pool in the world was therefore permanently exempt
        // from the culling it exists to enable, while the SHELLS those panes
        // belong to (building groups + core/batch.js's per-building merged
        // walls) culled normally. Past the radius the walls went and the
        // windows stayed: a see-through city of frames on empty ground.
        // The slack is now measured off the instances themselves — the
        // prototype's own extent (boundingBox, which never touches the
        // hand-set boundingSphere) times the largest instance scale — so it
        // is correct for a hand-set sphere and a real prototype alike.
        const a = o.instanceMatrix && o.instanceMatrix.array;
        const n = o.count | 0;
        if (!a || !n) { b.dynamic = true; cacheable = false; }
        else {
          let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxS = 0;
          for (let i = 0; i < n; i++) {
            const o16 = i * 16;
            const x = a[o16 + 12], z = a[o16 + 14];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
            // columns 0..2 of the instance matrix are the SCALED basis vectors:
            // their lengths are the instance's scale on each axis.
            const sx = Math.hypot(a[o16], a[o16 + 1], a[o16 + 2]);
            const sy = Math.hypot(a[o16 + 4], a[o16 + 5], a[o16 + 6]);
            const sz = Math.hypot(a[o16 + 8], a[o16 + 9], a[o16 + 10]);
            if (sx > maxS) maxS = sx; if (sy > maxS) maxS = sy; if (sz > maxS) maxS = sz;
          }
          // computeBoundingBox does NOT write boundingSphere, so a pool that
          // published its own sector sphere keeps it (and keeps frustum-culling).
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox;
          const protoR = bb
            ? Math.hypot(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) * 0.5
            : 2;
          const proto = Math.max(0.5, protoR * (maxS > 0 ? maxS : 1));
          // instance positions are pool-local; nearly every pool sits at the
          // identity, but honour a translated pool object anyway.
          b.x = (minX + maxX) / 2 + o.position.x; b.z = (minZ + maxZ) / 2 + o.position.z;
          b.r = Math.hypot(maxX - minX, maxZ - minZ) / 2 + proto;
          b.iv = o.instanceMatrix.version;     // the measurement's own receipt
        }
      }
      else if (o.isMesh && o.geometry) {
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        const s = o.geometry.boundingSphere;
        _v.copy(s.center).applyMatrix4(o.matrixWorld);
        b.x = _v.x; b.z = _v.z; b.r = s.radius * Math.max(o.scale.x, o.scale.z, 1);
      } else {
        _box.setFromObject(o);
        if (isFinite(_box.min.x) && isFinite(_box.max.x)) {
          b.x = (_box.min.x + _box.max.x) / 2; b.z = (_box.min.z + _box.max.z) / 2;
          b.r = Math.hypot(_box.max.x - _box.min.x, _box.max.z - _box.min.z) / 2;
        } else b.dynamic = true;
      }
      // a footprint wider than a few blocks (terrain tiles, the sea, road
      // webs) never culls anyway — skip it forever instead of re-testing.
      // (world/detail_kit.js's dressing pools are ONE InstancedMesh per prop
      // type for the WHOLE world by design, so they land here and stay drawn;
      // that is correct — a world-spanning pool cannot be dropped wholesale.)
      if (b.r > 400) b.dynamic = true;
    } catch (e) { b.dynamic = true; }
    if (cacheable) bounds.set(o, b);
    return b;
  }

  let lastSweepAt = 0, cursor = 0;
  CBZ.onAlways(3.6, function () {
    // WALL-CLOCK pacing, not game-dt: dt is clamped to 0.05s/frame, so on a
    // low-fps machine (the exact machines the cull radius exists FOR) a
    // dt-accumulated "4Hz" sweep degraded to once per several wall-seconds
    // and freshly-built worlds sat unculled for minutes.
    const now = performance.now();
    if (now - lastSweepAt < 250) return;   // 4Hz is plenty for walking/driving speeds
    lastSweepAt = now;
    const g = CBZ.game;
    const root = CBZ.city && CBZ.city.arena && CBZ.city.arena.root;
    // City player state lives in `.pos`, not `.position`. Falling back to the
    // camera made street culling follow the look rig rather than the actor and
    // masked the true player location whenever the camera was offset.
    const P = CBZ.player && (CBZ.player.pos || CBZ.player.position)
      ? (CBZ.player.pos || CBZ.player.position)
      : (CBZ.camera ? CBZ.camera.position : null);
    const airborne = !!(CBZ.player && CBZ.player._aircraft && CBZ.player.pos && CBZ.player.pos.y > 24);
    // Aircraft see farther, but they no longer need every room/window from the
    // entire world. Keep a wider full-detail bubble in flight and let the real
    // measured building proxies carry the rest of the skyline in one draw.
    const baseR = (CBZ.CONFIG && CBZ.CONFIG.CITY_FAR_CULL !== false && g && g.mode === "city")
      ? (CBZ.cityCullRadius || 0) : 0;
    const R = airborne && baseR ? Math.max(700, baseR + 180) : baseR;
    if (!root) return;
    updateProxy(CBZ.city && CBZ.city.arena, P, R);
    if (!R) {                       // OFF (high tiers / flag) — restore and idle
      if (hidByUs.size) { hidByUs.forEach(function (o) { o.visible = true; }); hidByUs.clear(); }
      return;
    }
    if (!P) return;
    const kids = root.children;
    // amortize: at most ~1/4 of the children measured/tested per sweep → the
    // whole city re-evaluates every ~1s, still far faster than you can drive
    // through a fog wall. Hysteresis (show at R-20) stops boundary flicker.
    const slice = Math.max(64, Math.ceil(kids.length / 4));
    // First-time measurements are the expensive part (a group pays a Box3
    // subtree walk) — measured 30-50ms hitch-stacks right after a tier drop
    // when ~1000 unmeasured children landed in one sweep. Cap fresh measures
    // per sweep; already-measured children stay full-rate (they're a Map hit).
    // MESHES with a precomputed bounding sphere are O(1) to measure (batch.js
    // computes spheres for every merged tile/shell) — measuring them free of
    // the budget keeps ~1k merged meshes from sitting unculled for ~30s after
    // a build/tier change while the budget crawls to them.
    let freshMeasures = 32;
    for (let n = 0; n < slice; n++) {
      cursor = (cursor + 1) % kids.length;
      const o = kids[cursor];
      if (!o || (!o.isMesh && !o.isGroup)) continue;
      if (!bounds.has(o)) {
        // plain mesh with a precomputed sphere = O(1); instanced pools pay an
        // O(instances) aggregate scan, so they stay on the budget.
        const cheap = o.isMesh && !o.isInstancedMesh && o.geometry && o.geometry.boundingSphere;
        if (!cheap) {
          if (freshMeasures <= 0) continue;
          freshMeasures--;
        }
      }
      const b = boundsFor(o);
      if (b.dynamic) continue;
      if (o.position.x !== b.px || o.position.z !== b.pz) {
        // it MOVED — an actor/vehicle, not static city. Blacklist forever and
        // hand visibility back if we were the ones who hid it.
        b.dynamic = true;
        if (hidByUs.has(o)) { o.visible = true; hidByUs.delete(o); }
        continue;
      }
      const dx = b.x - P.x, dz = b.z - P.z;
      const d = Math.sqrt(dx * dx + dz * dz) - b.r;   // nearest possible point
      if (d > R) {
        // no `!hidByUs.has(o)` guard: if another system handed visibility back
        // (a quality tier restoring the masonry veneer), the sweep must be able
        // to re-take it, or the object stays drawn forever while the set still
        // claims we own it. Re-adding to a Set is free.
        if (o.visible) { o.visible = false; hidByUs.add(o); }
      } else if (d < R - 20) {
        // userData.cullLocked = "another system wants this hidden at this
        // quality tier" (city/buildings.js's masonry veneer is dropped whole at
        // tier 0). Re-showing on approach would override that owner. Culling it
        // is still fine — hidden is hidden.
        if (hidByUs.has(o) && !(o.userData && o.userData.cullLocked)) { o.visible = true; hidByUs.delete(o); }
      }
    }
  });

  /* ==================================================================
     CBZ.farcullAudit() — WHAT IS EXEMPT FROM DISTANCE CULLING, AND WHY.

     The ghost city was not a coordinate bug: it was a shell that culled
     and a window that did not. Two numbers therefore have to be visible
     together, or a "fix" that simply stops drawing something passes.

       poolsExempt — pooled facade geometry (glass panes, interior sky/
                     mullion strips, masonry veneer) that boundsFor marks
                     dynamic, i.e. can never be dropped with the wall it
                     is stuck to. MUST BE 0.
       unproxied   — buildings with no distance-LOD box, so past the cull
                     radius they leave nothing but their fittings. MUST
                     BE 0.
       shells/lots/proxied/pools are printed BESIDE them so neither can
       be zeroed by building or drawing less.

     Pure read: it measures through the same boundsFor the sweep uses, so
     it cannot disagree with the live behaviour. NOT YET PINNED — whoever
     runs it first writes the numbers into CLAUDE.md (do not repeat the
     propUseAudit mistake of pinning a guess).
  ================================================================== */
  CBZ.farcullAudit = function () {
    const A = CBZ.city && CBZ.city.arena;
    const root = A && A.root;
    const out = {
      radius: CBZ.cityCullRadius || 0, hidden: hidByUs.size,
      shells: 0, lots: 0, proxied: proxyRecords.length, unproxied: 0,
      pools: 0, poolsExempt: 0, poolsIdle: 0, worldPools: 0,
    };
    if (!root) return out;
    const shells = (root.userData && root.userData.shells) || [];
    out.shells = shells.length;
    let lots = (A.lots || []);
    if (A.annex && Array.isArray(A.annex.lots)) lots = lots.concat(A.annex.lots);
    out.lots = lots.length;
    // A building is "proxied" when the live proxy carries its group — an
    // identity test, not a coordinate one, so two towers on one spot can never
    // cover for each other.
    const have = new Set();
    for (let i = 0; i < proxyRecords.length; i++) have.add(proxyRecords[i].grp);
    const all = [];
    for (let i = 0; i < lots.length; i++) if (lots[i] && lots[i].building) all.push(lots[i].building);
    for (let i = 0; i < shells.length; i++) all.push(shells[i]);
    const seenB = new Set();
    for (let i = 0; i < all.length; i++) {
      const b = all[i];
      if (!b || b.park || !b.group || seenB.has(b.group)) continue;
      if (!(+b.w > 1 && +b.d > 1 && +b.h > 1)) continue;
      seenB.add(b.group);
      if (!have.has(b.group)) out.unproxied++;
    }
    // pooled facade geometry: buildings.js tags every one of its pools.
    // A pool at count 0 submits nothing (the warm night panes by day), so it
    // cannot ghost anything and is reported apart rather than failing the gate.
    const kids = root.children;
    for (let i = 0; i < kids.length; i++) {
      const o = kids[i];
      if (!o || !o.isInstancedMesh) continue;
      const ud = o.userData || {};
      if (!(ud.glassPool || ud.masonryPool)) { if (!ud.dynamic) out.worldPools++; continue; }
      if (!(o.count | 0)) { out.poolsIdle++; continue; }
      out.pools++;
      if (boundsFor(o).dynamic) out.poolsExempt++;
    }
    return out;
  };

  // tier changed → new radius applies next sweep; if it WIDENED, groups past
  // the old radius but inside the new one re-show within a second via the
  // rolling cursor. Nothing to do here beyond an immediate restore when OFF.
  if (CBZ.onQualityChange) CBZ.onQualityChange(function () {
    if (!(CBZ.cityCullRadius || 0) && hidByUs.size) {
      hidByUs.forEach(function (o) { o.visible = true; });
      hidByUs.clear();
    }
  });
})();
