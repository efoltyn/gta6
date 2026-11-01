/* lab kit "asset": THE TURNTABLE. Any builder in the repo, alone on the lab
   floor, photographed from any cam. The cheap way to LOOK at one model while
   rebuilding it, without booting a 729-script game under SwiftShader.

     node tools/lab/run.mjs --kit asset \
       --params 'file=src/city/itemassets.js&expr=CBZ.itemAsset("Apple")' \
       --frames 0 --cam 3q,side,front,close --out /tmp/shots/apple

   params
     file   comma list of scripts to load (their load-time closure is traced)
     need   comma list of CBZ symbols to pull in by definer
     expr   a JS expression evaluated after boot. It may return one Object3D,
            an array of them (laid out in a row along X, `gap` m apart), or a
            function(scene) that adds things itself and returns the subjects.
     gap    metres between items in a row (default: auto from each width)
     y      lift every subject by this many metres (default 0)
     floor  0 = hide the lab floor (a hull, a fish, an aircraft in the air)

   The probe reports, per subject: bounding size (m), mesh count, triangle
   count and material count, so a rebuild can be held to a budget in numbers
   as well as pictures. */
CBZ.lab.kit("asset", {
  about: "one or more models from any builder (expr=), alone on the floor, for before/after shots",
  uses: [],
  duration: 0.1,
  frameMin: 0.02,   // frame a 2 cm bullet as tightly as a 60 m airliner
  depth: 1,
  setup: function (W, P) {
    const THREE = window.THREE;
    W._assetSubjects = [];
    W._assetError = null;
    if (String(P.floor) === "0") {
      CBZ.scene.traverse(function (o) { if (o.isMesh && o.geometry && o.geometry.type === "PlaneGeometry") o.visible = false; });
    }
    let out = null;
    try {
      // eslint-disable-next-line no-new-func
      out = (new Function("CBZ", "THREE", "W", "P", "return (" + String(P.expr || "null") + ");"))(CBZ, THREE, W, P);
      if (typeof out === "function") out = out(CBZ.scene);
    } catch (e) { W._assetError = String(e && e.stack || e); return; }
    let list = Array.isArray(out) ? out : (out ? [out] : []);
    list = list.filter(function (o) { return o && o.isObject3D; });
    let x = 0;
    const lift = +P.y || 0;
    const gap = P.gap != null ? +P.gap : null;
    const box = new THREE.Box3(), size = new THREE.Vector3();
    list.forEach(function (o, i) {
      if (!o.parent) CBZ.scene.add(o);
      o.updateMatrixWorld(true);
      box.setFromObject(o); box.getSize(size);
      const w = Math.max(0.05, size.x);
      if (list.length > 1) {
        if (i > 0) x += (gap != null ? gap : Math.max(0.1, w * 0.35)) + w / 2;
        o.position.x += x;
        x += w / 2;
      }
      o.position.y += lift;
      o.updateMatrixWorld(true);
    });
    if (list.length > 1) { const c = x / 2; list.forEach(function (o) { o.position.x -= c; o.updateMatrixWorld(true); }); }
    W._assetSubjects = list;
  },
  frame: function (W) { return W._assetSubjects && W._assetSubjects.length ? W._assetSubjects : null; },
  probe: function (W) {
    const THREE = window.THREE;
    if (W._assetError) return { ok: false, summary: "expr threw: " + W._assetError.split("\n")[0], data: { error: W._assetError } };
    const subs = W._assetSubjects || [];
    const box = new THREE.Box3(), size = new THREE.Vector3();
    const data = subs.map(function (o) {
      let meshes = 0, tris = 0; const mats = new Set();
      o.traverse(function (m) {
        if (!m.isMesh || !m.geometry) return;
        meshes++;
        const g = m.geometry, n = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
        tris += (n / 3) * (m.isInstancedMesh ? m.count : 1);
        (Array.isArray(m.material) ? m.material : [m.material]).forEach(function (x) { if (x) mats.add(x.uuid); });
      });
      box.setFromObject(o); box.getSize(size);
      return { name: o.name || "", size: [+size.x.toFixed(3), +size.y.toFixed(3), +size.z.toFixed(3)], meshes: meshes, tris: Math.round(tris), materials: mats.size };
    });
    return {
      ok: subs.length > 0,
      summary: subs.length ? subs.length + " subject(s): " + data.map(function (d) { return (d.name || "?") + " " + d.size.join("x") + " m, " + d.meshes + " meshes, " + d.tris + " tris, " + d.materials + " mats"; }).join(" | ") : "expr returned no Object3D",
      data: data,
    };
  },
});
