/* ============================================================
   city/blobshadows.js — EVERYTHING TOUCHES THE GROUND.

   WHY: the city's dynamic actors (full-rig peds, cops, cars) either
   visually FLOATED or paid for real sun-shadow casting — and the shadow
   pass re-renders every caster, so ~90 rigs + ~40 cars was a second
   city render nobody could actually see (a rig's shadow is a few px
   past 40u). Blob shadows are how every low-poly game grounds its
   movers: one soft radial-gradient quad under each body reads as
   ground contact at ANY distance, the whole pool costs ONE instanced
   draw call, and castShadow can go OFF on all dynamics — the frames
   come back from the sun pass. Buildings/props keep their real shadows
   (those long shapes are what sell the sun).

   HOW: a single InstancedMesh pool (cap 120) of ground-flattened quads
   sharing ONE radial-gradient CanvasTexture/material with the ambient
   crowd's shadow layer (CBZ.blobShadowMat — defined guarded in both
   files, first caller builds it). Slots are acquired by a TIME-SLICED
   scan over CBZ.cityPeds / CBZ.cityCops / CBZ.cityCars inside a ~45u
   gate, recycled past 52u (hysteresis so a body pacing the boundary
   doesn't flicker), and refreshed each frame with one cheap matrix
   compose per held slot — ZERO per-frame allocation. Cars get a
   stretched yaw-following ellipse sized off their real dims (fallback
   2.2×4.5); dead peds get a long smear so corpses read grounded too.
   The blob fades with CBZ.nightAmount (no hard sun, no hard shadow) —
   one shared-material opacity write also tunes the crowd layer.
   City-gated; headless builds no meshes and the update no-ops.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;

  // ---- ONE shared blob texture/material (same factory lives guarded in
  //      city/crowd.js so include order doesn't matter; the result is cached
  //      on CBZ._blobShadowMat and shared by BOTH instanced layers).
  CBZ.blobShadowMat = CBZ.blobShadowMat || function () {
    if (CBZ._blobShadowMat !== undefined) return CBZ._blobShadowMat;
    let tex = null;
    if (typeof document !== "undefined" && document.createElement && THREE.CanvasTexture) {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const ctx = c.getContext && c.getContext("2d");
      if (ctx) {
        const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
        grad.addColorStop(0, "rgba(0,0,0,0.55)");
        grad.addColorStop(0.6, "rgba(0,0,0,0.34)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
        tex = new THREE.CanvasTexture(c);
      }
    }
    // headless / no-DOM: no texture → no material (callers guard on null)
    if (!tex || !THREE.MeshBasicMaterial) return (CBZ._blobShadowMat = null);
    CBZ._blobShadowMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,            // never occludes, never z-buffers
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,   // floats clear of the road plane
    });
    return CBZ._blobShadowMat;
  };

  const CAP = 120;                       // hard ceiling on pooled blobs (≈ rigs+cars ever inside the gate)
  const GATE2 = 45 * 45;                 // acquire inside 45u — past that a blob is sub-pixel
  const DROP2 = 52 * 52;                 // release past 52u (hysteresis: no boundary flicker)
  const PED_SCAN = 22, CAR_SCAN = 12, COP_SCAN = 8;   // per-frame acquisition time-slice budgets
  const GY = 0.04;                       // quad lift above the ground (with polygonOffset)

  let mesh = null, built = false;
  const owner = new Array(CAP).fill(null);   // slot → ped/cop/car record (or null)
  const kind = new Uint8Array(CAP);          // 1 = ped-like rig, 2 = car
  const free = new Int32Array(CAP); let freeTop = 0;   // free-slot stack (no allocation, ever)
  let dum = null;                            // the ONE matrix-compose scratch (built with the mesh —
  let HIDE = null;                           // headless THREE stubs lack Matrix4, so never at module scope)
  let pedCur = 0, carCur = 0, copCur = 0;    // rolling scan cursors (time-slicing)

  function build() {
    if (built) return; built = true;
    if (!THREE.InstancedMesh || !THREE.PlaneGeometry || !THREE.Matrix4 || !CBZ.scene) return;   // headless → render no-op
    const mat = CBZ.blobShadowMat(); if (!mat) return;
    dum = new THREE.Object3D();
    HIDE = new THREE.Matrix4();
    HIDE.makeScale(0.0001, 0.0001, 0.0001); HIDE.setPosition(0, -4000, 0);
    mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
    mesh.name = "city-blob-shadows";
    // park EVERY slot off-map up front (identity instances would draw at the origin)
    freeTop = 0;
    for (let s = 0; s < CAP; s++) { mesh.setMatrixAt(s, HIDE); free[freeTop++] = s; }
    mesh.instanceMatrix.needsUpdate = true;
    // on the SCENE, not the arena root: city teardown nukes the arena, but the
    // pool survives resets (slots just free themselves when owners vanish).
    CBZ.scene.add(mesh);
  }

  function release(s) {
    owner[s] = null;
    mesh.setMatrixAt(s, HIDE);
    free[freeTop++] = s;
  }
  function freeAll() {
    if (!mesh) return;
    freeTop = 0;
    for (let s = 0; s < CAP; s++) { owner[s] = null; mesh.setMatrixAt(s, HIDE); free[freeTop++] = s; }
    mesh.instanceMatrix.needsUpdate = true;
  }
  // does this record already hold a slot? (stale _blobSlot stamps are fine —
  // the owner[] check is the source of truth)
  function has(o) { const s = o._blobSlot; return s != null && s >= 0 && s < CAP && owner[s] === o; }
  function acquire(o, k) {
    const s = free[--freeTop];
    owner[s] = o; kind[s] = k; o._blobSlot = s;
  }
  // a rig worth a blob: parented + visible + actually ON the ground.
  // Dead peds KEEP theirs (the corpse smear) until medics cull the body.
  function pedAlive(p) {
    return !!(p && p.pos && p.group && p.group.parent && p.group.visible && !p.inCar && !p._parked && !p.culled);
  }
  function carAlive(c) {
    return !!(c && c.pos && c.group && c.group.parent && c.group.visible !== false);
  }

  // time-sliced acquisition: walk a small rolling window of one roster per
  // frame; anything eligible inside the gate grabs a free slot. Returns the
  // advanced cursor (cost stays bounded no matter how big the roster gets).
  function scan(list, cur, budget, k, ppx, ppz) {
    const n = list ? list.length : 0;
    if (!n) return 0;
    let i = cur % n;
    for (let t = 0; t < budget && t < n; t++) {
      if (!freeTop) break;
      const o = list[i]; i = (i + 1) % n;
      if (!o || has(o)) continue;
      if (k === 1 ? !pedAlive(o) : !carAlive(o)) continue;
      const dx = o.pos.x - ppx, dz = o.pos.z - ppz;
      if (dx * dx + dz * dz > GATE2) continue;
      acquire(o, k);
    }
    return i;
  }

  // every held slot recomposes its quad each frame (position/yaw/scale only —
  // one Object3D compose per slot, the same cost peds/cars already pay per part).
  function updateSlots(ppx, ppz) {
    for (let s = 0; s < CAP; s++) {
      const o = owner[s]; if (!o) continue;
      if (kind[s] === 2 ? !carAlive(o) : !pedAlive(o)) { release(s); continue; }
      const x = o.pos.x, z = o.pos.z;
      const dx = x - ppx, dz = z - ppz;
      if (dx * dx + dz * dz > DROP2) { release(s); continue; }   // recycle by distance
      const gy = (CBZ.floorAt ? CBZ.floorAt(x, z) : 0) + GY;
      dum.position.set(x, gy, z);
      if (kind[s] === 2) {
        // car: stretched ellipse under the chassis, following the yaw —
        // sized off the car's REAL footprint when vehicles.js stamped dims.
        const dims = o.dims;
        dum.rotation.set(-Math.PI / 2, 0, o.group.rotation.y);
        dum.scale.set(((dims && dims.width) || 2.2) * 1.1, ((dims && dims.length) || 4.5) * 1.05, 1);
      } else if (o.dead) {
        // corpse: long smear aligned under the lying body
        dum.rotation.set(-Math.PI / 2, 0, o.char && o.char.group ? o.char.group.rotation.y : 0);
        dum.scale.set(1.5, 2.3, 1);
      } else {
        // walker: round contact blob, pressed a touch wider when moving fast
        const ss = 1.15 + Math.min(1, (o.speed || 0) * 0.2) * 0.2;
        dum.rotation.set(-Math.PI / 2, 0, 0);
        dum.scale.set(ss, ss * 0.94, 1);
      }
      dum.updateMatrix();
      mesh.setMatrixAt(s, dum.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  // after vehicles resolve (37.x/38) and peds move (34): blobs ride THIS
  // frame's final positions, never last frame's.
  CBZ.onUpdate(38.5, function () {
    const g = CBZ.game;
    if (!g || g.mode !== "city") {
      if (mesh && mesh.visible) { mesh.visible = false; freeAll(); }   // city-gated: other modes never see it
      return;
    }
    if (!built) build();
    if (!mesh) return;
    mesh.visible = true;
    const P = CBZ.player; if (!P || !P.pos) return;
    // soft sun, soft contact: fade the SHARED material with the night clock —
    // one uniform write also tunes the crowd's instanced shadow layer.
    const mat = CBZ._blobShadowMat;
    if (mat) mat.opacity = 1 - 0.55 * (CBZ.nightAmount || 0);
    const ppx = P.pos.x, ppz = P.pos.z;
    updateSlots(ppx, ppz);
    pedCur = scan(CBZ.cityPeds, pedCur, PED_SCAN, 1, ppx, ppz);
    copCur = scan(CBZ.cityCops, copCur, COP_SCAN, 1, ppx, ppz);
    carCur = scan(CBZ.cityCars, carCur, CAR_SCAN, 2, ppx, ppz);
  });
})();
