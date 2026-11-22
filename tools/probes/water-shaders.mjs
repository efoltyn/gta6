/* tools/probes/water-shaders.mjs — does every member of the one water family
   compile and link on the GPU, in a live world?

   r128 draws a broken program SILENTLY (the mesh just vanishes), so a water
   change that only passes node --check can ship an invisible ocean. This
   probe compiles the whole scene plus one of each sea kind the world does not
   itself use (city / external / pool), then asks GL for LINK_STATUS on every
   program the renderer holds.

     node tools/testbus/submit.mjs --probe tools/probes/water-shaders.mjs --world survival   (the world is the request's)
     node tools/testbus/submit.mjs --probe tools/probes/water-shaders.mjs --world battle --query "map=water"

   On the battle page it also asserts that NPC War's own sea sheets were
   adopted into the family (world/water_pages.js). */
export const meta = { fresh: false, dirties: false, timeoutMs: 900000 };

export default async function (t) {
  if (t.world !== "battle") await t.step(20);
  else await t.sleep(4000);
  const r = await t.fn(`
    var R = CBZ.renderer, gl = R && R.getContext && R.getContext();
    if (!R || !gl) return { err: 'no renderer' };
    var scene = CBZ.scene, cam = CBZ.camera;
    var extra = new THREE.Group();
    function add(m) { var me = new THREE.Mesh(new THREE.PlaneGeometry(4, 4, 2, 2), m); me.frustumCulled = false; me.position.set(cam.position.x, -3, cam.position.z); extra.add(me); }
    var kinds = [];
    if (CBZ.waterSeaMaterial) { add(CBZ.waterSeaMaterial({ kind: 'city' })); add(CBZ.waterSeaMaterial({ kind: 'external' })); kinds.push('city', 'external'); }
    if (CBZ.makeDisasterWaterMaterial) {
      var dm = CBZ.makeDisasterWaterMaterial({}); add(dm); kinds.push('arena');
      if (dm.userData.buildRunOverlayMaterial) { add(dm.userData.buildRunOverlayMaterial()); kinds.push('runup-overlay'); }
    }
    if (CBZ.tsuFaceBuild) {
      var face = CBZ.tsuFaceBuild({ width: 40, height: 8, rnd: function () { return 0.5; } });
      face.group.position.set(cam.position.x, -3, cam.position.z); extra.add(face.group); kinds.push('bore-face');
    }
    if (CBZ.tsunamiScene && CBZ.tsunamiScene.materials) {
      var tm = CBZ.tsunamiScene.materials();
      for (var ti = 0; ti < tm.length; ti++) add(tm[ti]);
      if (tm.length) kinds.push('wet-ground');
    }
    if (CBZ.tsuWhite && CBZ.tsuWhite.materials) {
      var wm = CBZ.tsuWhite.materials();
      if (wm.length) {
        // the wall is instanced geometry; one instance at the camera links it
        var wg = new THREE.InstancedBufferGeometry();
        wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0]), 3));
        ['iA','iB','iC'].forEach(function (n) { wg.setAttribute(n, new THREE.InstancedBufferAttribute(new Float32Array([cam.position.x, -3, cam.position.z, 2]), 4)); });
        wg.instanceCount = 1;
        var wmsh = new THREE.Mesh(wg, wm[0]); wmsh.frustumCulled = false; extra.add(wmsh);
        kinds.push('whitewater');
      }
    }
    if (CBZ.tsunamiFlowMaterial) {
      var im = new THREE.InstancedMesh(new THREE.PlaneGeometry(4, 4, 2, 2), CBZ.tsunamiFlowMaterial(), 1);
      im.setMatrixAt(0, new THREE.Matrix4().makeTranslation(cam.position.x, -3, cam.position.z));
      im.frustumCulled = false; extra.add(im); kinds.push('tsunami-flow');
    }
    if (CBZ.waterPoolMaterial) { add(CBZ.waterPoolMaterial()); kinds.push('pool'); }
    if (CBZ.waterCausticMaterial) { add(CBZ.waterCausticMaterial(new THREE.MeshLambertMaterial({ color: 0xc2b280 }))); kinds.push('caustic'); }
    scene.add(extra);
    try { R.compile(scene, cam); R.render(scene, cam); } catch (e) { scene.remove(extra); return { err: String(e && e.message || e) }; }
    scene.remove(extra);
    var bad = [], n = 0;
    (R.info.programs || []).forEach(function (p) {
      n++;
      var ok = gl.getProgramParameter(p.program, gl.LINK_STATUS);
      if (!ok || (p.diagnostics && p.diagnostics.runnable === false)) bad.push(String(p.name) + ': ' + String(gl.getProgramInfoLog(p.program) || '').slice(0, 400));
    });
    var adopted = 0;
    scene.traverse(function (o) { if (o.userData && o.userData.waterAdopted) adopted++; });
    var mode = null;
    var oc = CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.ocean;
    if (oc && oc.material && oc.material.userData) mode = oc.material.userData.waterMode;
    return { bad: bad, programs: n, kinds: kinds, adopted: adopted, oceanMode: mode,
      h: CBZ.waterWaveHeight ? +CBZ.waterWaveHeight(1, 1).toFixed(3) : null,
      wind: CBZ.waterWind ? CBZ.waterWind().w01 : null };
  `);
  if (!r || r.__err || r.err) return { ok: false, summary: "probe error: " + JSON.stringify(r) };
  const shaderErrs = (t.errors() || []).filter((e) => /WebGLProgram|shader|GLSL/i.test(String(e)));
  t.log(JSON.stringify(r));
  const battleOk = t.world !== "battle" || r.adopted >= 1;
  const ok = r.bad.length === 0 && shaderErrs.length === 0 && r.kinds.length >= 4 && battleOk;
  return {
    ok,
    summary: `${r.programs} programs, ${r.bad.length} broken, kinds ${r.kinds.join("/")}, adopted ${r.adopted}, ocean ${r.oceanMode}` +
      (shaderErrs.length ? `, console: ${shaderErrs[0]}` : "") + (r.bad.length ? `, first: ${r.bad[0]}` : ""),
    data: r,
  };
}
