/* ============================================================
   core/drawcheck.js — WHO DRAWS PAST THE END OF A BUFFER (?debugInstanced=1).

   Chrome logs "glDrawElementsInstanced: Vertex buffer is not big enough for
   the draw call" and names nothing. With ?debugInstanced=1 every draw is
   checked just before three issues it (Object3D.onBeforeRender): an instanced
   mesh whose count is past its instance matrix / instance colour / any
   per-instance attribute, an instanced geometry whose instanceCount is past
   its per-instance attributes, an attribute whose array is gone (freed
   after upload and then re-uploaded empty) or shorter than the index reaches.
   Each offender is logged ONCE with its name and parent chain;
   CBZ.drawCheckAudit() lists them. Without the flag this file does nothing.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ, THREE = window.THREE;
  if (!CBZ || !THREE) return;
  let on = false;
  try { on = /[?&]debugInstanced=1\b/.test(location.search); } catch (e) {}
  const seen = new WeakSet(), found = [];
  let installed = false;
  // always answerable: "off" until the check is on (the URL flag, or
  // CBZ.drawCheckOn() in a live world: frames drawn after it are checked)
  CBZ.drawCheckAudit = function () { return installed ? found.slice() : "off (load with &debugInstanced=1 or call CBZ.drawCheckOn())"; };
  CBZ.drawCheckOn = function () { if (!installed) install(); return "on"; };
  if (on) install();
  function install() {
  installed = true;
  const maxIndex = new WeakMap();
  function chain(o) { const a = []; for (let p = o; p && a.length < 6; p = p.parent) a.push(p.name || p.type); return a.join(" < "); }
  function report(o, why) {
    if (seen.has(o)) return; seen.add(o);
    const r = { name: o.name || o.type, why: why, chain: chain(o), builder: (function () { for (let p = o; p; p = p.parent) if (p.userData && p.userData._builder) return p.userData._builder; return null; })() };
    found.push(r); console.error("[drawcheck]", JSON.stringify(r));
  }
  function idxMax(g) {
    let m = maxIndex.get(g);
    if (m != null && m.v === (g.index ? g.index.version : -1)) return m.max;
    let max = -1;
    const a = g.index && g.index.array;
    if (a) for (let i = 0; i < a.length; i++) if (a[i] > max) max = a[i];
    maxIndex.set(g, { v: g.index ? g.index.version : -1, max: max });
    return max;
  }
  const orig = THREE.Mesh.prototype.onBeforeRender;
  THREE.Mesh.prototype.onBeforeRender = function (renderer, scene, camera, geometry) {
    try {
      const g = geometry || this.geometry;
      if (g && g.attributes) {
        let prim = -1;
        if (this.isInstancedMesh) {
          prim = this.count;
          if (this.instanceMatrix && prim > this.instanceMatrix.count) report(this, "count " + prim + " > instanceMatrix " + this.instanceMatrix.count);
          if (this.instanceColor && prim > this.instanceColor.count) report(this, "count " + prim + " > instanceColor " + this.instanceColor.count);
        } else if (g.isInstancedBufferGeometry) prim = g.instanceCount;
        const im = g.index ? idxMax(g) : -1;
        for (const k in g.attributes) {
          const a = g.attributes[k];
          if (!a) continue;
          if (a.isInstancedBufferAttribute) {
            const need = prim >= 0 ? Math.ceil(prim / (a.meshPerAttribute || 1)) : 0;
            if (need > a.count) report(this, "per-instance '" + k + "' " + a.count + " < " + need);
          } else if (!a.isInterleavedBufferAttribute) {
            if (a.array === null) report(this, "attribute '" + k + "' array freed");
            else if (im >= a.count) report(this, "attribute '" + k + "' " + a.count + " <= max index " + im);
          }
        }
      }
    } catch (e) {}
    return orig.apply(this, arguments);
  };
  }
})();
