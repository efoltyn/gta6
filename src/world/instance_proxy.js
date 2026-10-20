/* ============================================================
   world/instance_proxy.js — MANY LIVE MESHES, A FEW DRAW CALLS.

   The disaster island has ~330 trees and ~90 parked cars. Each was its own
   mesh, because each has to stay its own OBJECT: the wildfire recolours a
   tree's own material and scales its crown, the quake sways crowns, the
   tsunami re-parents a trunk into a log and rolls it away, the hurricane
   bends and windthrows, the director flings cars, lightning splits a trunk
   into strips cut from its own geometry and material. Two draws a tree and
   one a car was ~750 draw calls before a single building, on a phone.

   So the meshes stay exactly what they were — same objects, same parents,
   same materials, same `visible`, raycastable — and stop DRAWING: each is
   moved to a private render LAYER no camera enables (layer 30, the trick
   entities/pedinstance.js documents for the ped pool: r128 tests layers per
   object in the render AND shadow passes, never `visible`). One
   InstancedMesh per (geometry, look) draws them all instead.

   A sync pass each frame (onUpdate 96, after every system has moved
   things, before the render) keeps the copies honest, cheaply:
     • transform changed (sway, a fling, a lean)   -> that instance's matrix
     • material colour changed (scorch, char)      -> that instance's colour
     • emissive lit (burning), material swapped,
       reparented (the tsunami's log), layer       -> the mesh goes LIVE: back
       changed by someone else                        on layer 0, drawing as
                                                      itself; its instance is
                                                      zeroed
     • visible false anywhere up its parent chain  -> its instance is zeroed
   and when the mesh is back to rest (a match reset), it returns to the
   instance. Nothing allocates per frame; a static scene costs one compare
   of ten numbers per mesh.

   API
     const P = CBZ.instanceProxy(parent, { name, modeOn })
     P.add(mesh, look, xform?)  look: the material the instance is drawn
                                with (a white-tinted clone is made per look;
                                the mesh's own material colour rides the
                                instance colour). xform: the Object3D whose
                                position/rotation/scale place the mesh in
                                world (default the mesh; a car's group, the
                                body sitting at its origin). Its parent must
                                be identity-transformed (the arena root).
     P.build()                  make the instanced meshes (call once, after
                                every add)
     P.sync()                   the per-frame pass (also hooked on onUpdate)
     P.stats()                  { entries, buckets, live, hidden, draws }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const LAYER = 30;

  CBZ.instanceProxy = function (parent, opts) {
    opts = opts || {};
    const buckets = new Map();
    const entries = [];
    let built = false;
    const _m = new THREE.Matrix4(), _c = new THREE.Color(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);

    function lookOf(look) {
      if (look._proxyLook) return look._proxyLook;
      const m = look.clone();
      if (m.color) m.color.setRGB(1, 1, 1);
      // r128 multiplies the instance colour in only where vColor exists
      // (USE_COLOR): every geometry drawn with a look carries a colour
      // attribute (build() gives a white one to any that lack it)
      m.vertexColors = true;
      m.name = (look.name || "look") + "-instanced";
      look._proxyLook = m;
      return m;
    }
    function add(mesh, look, xform) {
      if (!mesh || !mesh.isMesh || built) return null;
      look = look || mesh.material;
      const key = mesh.geometry.uuid + "|" + look.uuid;
      let b = buckets.get(key);
      if (!b) { b = { geo: mesh.geometry, look: look, list: [], mesh: null, dirtyM: false, dirtyC: false }; buckets.set(key, b); }
      const x = xform || mesh;
      const e = {
        mesh: mesh, xf: x, xfParent: x.parent, meshParent: mesh.parent, mat: mesh.material, b: b, slot: b.list.length,
        p: new Float32Array(10), c: new Float32Array(3), state: 0,      // 0 instanced, 1 live, 2 hidden
        castShadow: mesh.castShadow, tinted: !!(mesh.material && mesh.material.color && look.color),
      };
      e.p[0] = NaN;
      b.list.push(e);
      entries.push(e);
      return e;
    }
    function build() {
      if (built) return;
      built = true;
      buckets.forEach(function (b) {
        if (!b.geo.attributes.color) {
          const n = b.geo.attributes.position.count;
          b.geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
        }
        const im = new THREE.InstancedMesh(b.geo, lookOf(b.look), b.list.length);
        im.name = (opts.name || "proxy") + "-" + b.list.length;
        // a DRAWING of live meshes, never a thing of its own: whoever moves
        // things (world/sinkhole.js's instance lift) moves the mesh instead
        im.userData.instanceProxy = true;
        im.frustumCulled = false;       // r128 culls an InstancedMesh by the geometry's own sphere at the origin
        im.castShadow = b.list.some(function (e) { return e.castShadow; });
        im.receiveShadow = true;
        if (b.list[0].mesh.customDepthMaterial) im.customDepthMaterial = b.list[0].mesh.customDepthMaterial;
        if (im.instanceMatrix.setUsage) im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const tint = b.list.some(function (e) { return e.tinted; });
        if (tint) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(b.list.length * 3).fill(1), 3);
        b.mesh = im;
        parent.add(im);
      });
      for (const e of entries) { e.mesh.layers.set(LAYER); place(e, true); }
      buckets.forEach(function (b) { flush(b); });
    }
    function hiddenUp(o) {
      for (let a = o; a; a = a.parent) { if (a.visible === false) return true; if (a === parent) break; }
      return false;
    }
    function needsLive(e) {
      const m = e.mesh;
      if (m.parent !== e.meshParent || e.xf.parent !== e.xfParent) return true;
      if (m.material !== e.mat) return true;
      const mt = m.material;
      if (mt && mt.emissive && (mt.emissive.r > 0.001 || mt.emissive.g > 0.001 || mt.emissive.b > 0.001) && mt.emissiveIntensity > 0) return true;
      if (mt && (mt.opacity < 1 || mt.visible === false)) return true;
      return false;
    }
    function place(e, force) {
      const x = e.xf, p = e.p;
      const P = x.position, Q = x.quaternion, S = x.scale;
      if (!force && p[0] === P.x && p[1] === P.y && p[2] === P.z && p[3] === Q.x && p[4] === Q.y && p[5] === Q.z && p[6] === Q.w &&
          p[7] === S.x && p[8] === S.y && p[9] === S.z) return;
      p[0] = P.x; p[1] = P.y; p[2] = P.z; p[3] = Q.x; p[4] = Q.y; p[5] = Q.z; p[6] = Q.w; p[7] = S.x; p[8] = S.y; p[9] = S.z;
      _m.compose(P, Q, S);
      if (x !== e.mesh) { e.mesh.updateMatrix(); _m.multiply(e.mesh.matrix); }
      e.b.mesh.setMatrixAt(e.slot, _m);
      e.b.dirtyM = true;
      if (force) { e.c[0] = NaN; tint(e); }
    }
    function tint(e) {
      if (!e.tinted || !e.b.mesh.instanceColor) return;
      const c = e.mesh.material.color;
      if (c.r !== e.c[0] || c.g !== e.c[1] || c.b !== e.c[2]) {
        e.c[0] = c.r; e.c[1] = c.g; e.c[2] = c.b;
        e.b.mesh.setColorAt(e.slot, c);
        e.b.dirtyC = true;
      }
    }
    function flush(b) {
      if (b.dirtyM) { b.mesh.instanceMatrix.needsUpdate = true; b.dirtyM = false; }
      if (b.dirtyC && b.mesh.instanceColor) { b.mesh.instanceColor.needsUpdate = true; b.dirtyC = false; }
    }
    function zero(e) {
      e.b.mesh.setMatrixAt(e.slot, _zero);
      e.b.dirtyM = true;
      e.p[0] = NaN;
    }
    let nLive = 0, nHidden = 0;
    function sync() {
      if (!built) return;
      nLive = 0; nHidden = 0;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (needsLive(e)) {
          if (e.state !== 1) { e.state = 1; e.mesh.layers.set(0); zero(e); }
          nLive++;
          continue;
        }
        if (e.state === 1) {
          // back to rest: hand it back to the instance
          if (e.mesh.layers.mask !== 1) continue;      // someone else owns its layers now
          e.state = 0; e.mesh.layers.set(LAYER); place(e, true);
        }
        if (hiddenUp(e.xf) || hiddenUp(e.mesh)) {
          if (e.state !== 2) { e.state = 2; zero(e); }
          nHidden++;
          continue;
        }
        if (e.state === 2) { e.state = 0; place(e, true); }
        place(e, false);
        tint(e);
      }
      buckets.forEach(flush);
    }
    if (CBZ.onUpdate) CBZ.onUpdate(96, function () {
      if (opts.modeOn && !opts.modeOn()) return;
      sync();
    });
    return {
      add: add, build: build, sync: sync,
      stats: function () { return { entries: entries.length, buckets: buckets.size, live: nLive, hidden: nHidden, draws: buckets.size + nLive }; },
    };
  };
})();
