// tools/car-draws-check.mjs — plain node, no browser: the city car's draw calls.
// Builds every traffic body (the real playercars.js / carparts.js / vehicles.js
// pipeline, buildCar) with vehicles.js's plain-colour merge OFF and ON and checks:
//   1. ON draws fewer meshes per car (the plain-colour cmat parts become one);
//   2. the shading inputs are the same picture: for every drawn vertex, its
//      world position weighted by the diffuse colour and by the emissive the
//      shader will see (material uniforms off, vertex colour / cbzEmis on)
//      sums to the same numbers, and the vertex/triangle counts are equal;
//   3. tail lamps, the shared head/tail lamp materials, wheels, glass and
//      the baked doors are never merged.
//   node tools/car-draws-check.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
const ROOT = new URL("../", import.meta.url).pathname;
const read = (f) => readFileSync(ROOT + f, "utf8");
function ctx2d() {
  const t = {};
  return new Proxy(t, {
    get: (t, k) => {
      if (k === "getImageData" || k === "createImageData") return (x, y, w, h) => ({ data: new Uint8ClampedArray((w || 1) * (h || 1) * 4), width: w, height: h });
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern") return () => ({ addColorStop() {} });
      if (k === "measureText") return () => ({ width: 10 });
      if (k in t) return t[k];
      return () => {};
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
const mkEl = () => ({ width: 1, height: 1, style: {}, getContext: () => ctx2d(), addEventListener() {}, toDataURL: () => "", appendChild() {}, setAttribute() {}, classList: { add() {}, remove() {} } });
function world(merge, pbr) {
  const document = { createElement: mkEl, addEventListener() {}, body: mkEl(), documentElement: mkEl(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  const ctx = vm.createContext({ console, Math, document, performance, setTimeout, clearTimeout, navigator: { userAgent: "node" }, location: { search: "" },
    URLSearchParams, Float32Array, Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray, Map, Set, WeakMap, Proxy });
  ctx.window = ctx; ctx.self = ctx;
  // pbr: a PBR tier after core/gfx.js armed it (world/materials.js cmat hands out Standard twins)
  ctx.CBZ = { CONFIG: { CAR_VC_MERGE: merge, GFX_PBR_MATERIALS: !!pbr }, gfxPbrArmed: !!pbr, gfxTier: { pbr: !!pbr }, onAlways() {}, onUpdate() {}, on() {}, flags: {} };
  ctx.addEventListener = () => {}; ctx.removeEventListener = () => {}; ctx.requestAnimationFrame = () => 0;
  for (const f of ["src/vendor/three.r128.min.js", "src/world/materials.js", "src/world/carfx.js", "src/city/carlamps.js", "src/city/carparts.js",
    "src/city/carbody.js", "src/city/carwheels.js", "src/city/carseats.js", "src/city/playercars.js", "src/city/carlod.js", "src/city/vehicles.js"]) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  return ctx;
}
const STYLES = ["coupe", "cybertruck", "ferrari", "hatch", "lowrider", "muscle", "pickup", "porsche", "suv", "tesla-3", "tesla-s", "tesla-y", "van"];
function measure(ctx, style) {
  const T = ctx.THREE, C = ctx.CBZ;
  const g = C.cityBuildAmbientCarVisual({ name: style, style: style, color: 0x993322, s: 1, body: style });
  g.updateMatrixWorld(true);
  const r = { draws: 0, verts: 0, tris: 0, d: [0, 0, 0], e: [0, 0, 0], tail: 0, lamps: 0, keepers: 0, merged: 0 };
  const LF = C.vehicleMat("lightFront"), LT = C.vehicleMat("lightTail");
  const v = new T.Vector3();
  g.traverseVisible((o) => {
    if (!o.isMesh) return;
    r.draws++;
    const m = o.material, geo = o.geometry, P = geo.attributes.position, VC = m.vertexColors ? geo.attributes.color : null, EM = geo.attributes.cbzEmis;
    if (m._cbzVcMerge) { r.merged++; r.mergedTypes = (r.mergedTypes || "") + m.type + (m._cbzPbr ? "+pbr" : "") + (m._cbzTwin && m._cbzTwin._cbzTwin === m ? "+twin" : "") + ","; }
    if (m.emissive && m.emissive.r > 0.78 && m.emissive.g < 0.45 && m.emissive.b < 0.5) r.tail++;
    if (m === LF || m === LT) r.lamps++;
    if (o.userData.playerWheel || o.userData.carGlass || o.userData.doorsShut) r.keepers++;
    const idx = geo.index ? geo.index.array : null, n = idx ? idx.length : P.count;
    r.verts += n; r.tris += n / 3;
    const ei = m.emissiveIntensity != null ? m.emissiveIntensity : 1;
    for (let i = 0; i < n; i++) {
      const k = idx ? idx[i] : i;
      v.fromBufferAttribute(P, k).applyMatrix4(o.matrixWorld);
      const w = 1 + Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z);
      const cr = m.color.r * (VC ? VC.getX(k) : 1), cg = m.color.g * (VC ? VC.getY(k) : 1), cb = m.color.b * (VC ? VC.getZ(k) : 1);
      let er = 0, eg = 0, eb = 0;
      if (m._cbzVcMerge && EM) { er = EM.getX(k); eg = EM.getY(k); eb = EM.getZ(k); }
      else if (m.emissive) { er = m.emissive.r * ei; eg = m.emissive.g * ei; eb = m.emissive.b * ei; }
      r.d[0] += cr * w; r.d[1] += cg * w; r.d[2] += cb * w;
      r.e[0] += er * w; r.e[1] += eg * w; r.e[2] += eb * w;
    }
  });
  return r;
}
let fails = 0, sumOff = 0, sumOn = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } };
for (const PBR of [false, true]) {
const off = world(false, PBR), on = world(true, PBR);
console.log(PBR ? "-- PBR tier (Standard twins)" : "-- Lambert tier");
for (const st of STYLES) {
  const a = measure(off, st), b = measure(on, st);
  sumOff += a.draws; sumOn += b.draws;
  const rel = (x, y) => Math.abs(x - y) / Math.max(1, Math.abs(x));
  ok(b.draws < a.draws, st + ": fewer draws (" + a.draws + " -> " + b.draws + ")");
  ok(a.verts === b.verts && a.tris === b.tris, st + ": same vertices/triangles (" + a.verts + " vs " + b.verts + ")");
  for (let k = 0; k < 3; k++) {
    ok(rel(a.d[k], b.d[k]) < 1e-5, st + ": diffuse moment " + k + " " + a.d[k] + " vs " + b.d[k]);
    ok(rel(a.e[k], b.e[k]) < 1e-5, st + ": emissive moment " + k + " " + a.e[k] + " vs " + b.e[k]);
  }
  ok(a.tail === b.tail && a.lamps === b.lamps && a.keepers === b.keepers, st + ": lamps / wheels / glass / doors untouched");
  ok(b.merged >= 1, st + ": one plain-colour merge");
  // the merged part wears the tier's material, linked to its twin like cmat's
  // (a PBR tier still has Lambert parts whose colour cmat never twinned: they merge apart, as Lambert)
  ok(PBR ? /^((MeshStandardMaterial\+pbr\+twin|MeshLambertMaterial),)+$/.test(b.mergedTypes) && /Standard/.test(b.mergedTypes)
    : /^(MeshLambertMaterial,)+$/.test(b.mergedTypes), st + ": merged material " + b.mergedTypes);
  console.log(st.padEnd(11), "draws", a.draws, "->", b.draws);
}
}
console.log(fails ? "FAIL " + fails : "OK car draws: " + (sumOff / STYLES.length / 2).toFixed(1) + " -> " + (sumOn / STYLES.length / 2).toFixed(1) + " meshes per car, same picture inputs");
process.exit(fails ? 1 : 0);
