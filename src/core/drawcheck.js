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
  /* NaN GEOMETRY (always on, cheap): three logs "computeBoundingSphere():
     Computed radius is NaN" and names nothing. The first time a geometry
     computes a NaN sphere, say WHO asked (the calling stack) and which
     attribute holds the NaN; CBZ.nanGeometryAudit() lists them. */
  const nanSeen = new WeakSet(), nanFound = [];
  const cbs = THREE.BufferGeometry.prototype.computeBoundingSphere;
  THREE.BufferGeometry.prototype.computeBoundingSphere = function () {
    const out = cbs.apply(this, arguments);
    const bs = this.boundingSphere;
    if (bs && bs.radius !== bs.radius && !nanSeen.has(this)) {
      nanSeen.add(this);
      const p = this.attributes && this.attributes.position;
      let first = -1;
      if (p && p.array) for (let i = 0; i < p.array.length; i++) if (p.array[i] !== p.array[i]) { first = i; break; }
      const st = (new Error().stack || "").split("\n").slice(2, 7).map(function (l) { return l.trim().replace(/^at /, "").replace(/\?[^:)]*/, ""); });
      const r = { name: this.name || this.type, verts: p ? p.count : 0, firstNaN: first, from: st };
      nanFound.push(r);
      console.error("[nan geometry]", JSON.stringify(r));
    }
    return out;
  };
  CBZ.nanGeometryAudit = function () { return nanFound.slice(); };

  let on = false;
  try { on = /[?&]debugInstanced=1\b/.test(location.search); } catch (e) {}
  const seen = new WeakSet(), found = [];
  let installed = false;
  // always answerable: "off" until the check is on (the URL flag, or
  // CBZ.drawCheckOn() in a live world: frames drawn after it are checked)
  CBZ.drawCheckAudit = function () { return installed ? found.slice() : "off (load with &debugInstanced=1 or call CBZ.drawCheckOn())"; };
  CBZ.drawCheckOn = function () { if (!installed) install(); return "on"; };
  if (on) install();
  let current = null, glWrapped = false;
  // the GL's own verdict: after every draw call, gl.getError() (a sync read:
  // debug only), charged to the object three was drawing
  function wrapGL() {
    if (glWrapped) return;
    const r = CBZ.renderer; if (!r || !r.getContext) return;
    const gl = r.getContext(); if (!gl) return;
    glWrapped = true;
    ["drawElementsInstanced", "drawArraysInstanced", "drawElements", "drawArrays"].forEach(function (fn) {
      const f = gl[fn]; if (typeof f !== "function") return;
      gl[fn] = function () {
        const out = f.apply(gl, arguments);
        const e = gl.getError();
        if (e && current) report(current, "GL error 0x" + e.toString(16) + " on " + fn + "(" + Array.prototype.slice.call(arguments).join(",") + ")");
        return out;
      };
    });
  }
  function install() {
  installed = true;
  wrapGL();
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
    current = this;
    if (!glWrapped) wrapGL();
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
            if (a.array === null) { /* released after upload (core/citystream.js, metro far tiles): fine while on the GPU */ }
            else if (im >= a.count) report(this, "attribute '" + k + "' " + a.count + " <= max index " + im);
          }
        }
      }
    } catch (e) {}
    return orig.apply(this, arguments);
  };
  }
})();
