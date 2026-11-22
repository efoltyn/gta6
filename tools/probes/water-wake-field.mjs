/* tools/probes/water-wake-field.mjs — is the wake field alive, complete and
   readable, and do hulls by size and splashes reach it?

   Boots the shark sim (index.html, the island sea with the real fleet), runs
   a jetski and a cruiser on straight legs with the camera beside them, drops
   a body and a car-sized mass into the sea, then:
     - reads CBZ.waterWakeAudit() (target type, box, steps, sources, max |h|,
       foam sum, framebuffer completeness),
     - compiles a test material whose vertex AND fragment shaders call
       cbzWake() through CBZ.waterWakeGLSL() and checks it links,
     - reads each hull's seakeeping audit (periods, pitch, slams),
     - collects console errors.
     node tools/testbus/standalone.mjs tools/probes/water-wake-field.mjs */
export const meta = { world: "sharksim", fresh: true, dirties: true, timeoutMs: 900000 };

export default async function (t) {
  await t.step(60);
  const setup = await t.fn(`
    var A = CBZ.surv.arena, c = A.center, p = null;
    for (var r = 20; r < 2000; r += 10) { var x = c.x + r, z = c.z; if (CBZ.survFloodDepthMeanAt(x, z) > 8) { p = { x: x + 80, z: z }; break; } }
    if (!p) return { err: 'no deep water' };
    var js = CBZ.seaCraft.spawn('jetski', p.x, p.z, 0, { crew: 1, speed: 15, route: [{ x: p.x, z: p.z + 900 }, { x: p.x, z: p.z + 1800 }] });
    var cr = CBZ.seaCraft.spawn('cruiser', p.x + 40, p.z, 0, { crew: 1, speed: 7.3, route: [{ x: p.x + 40, z: p.z + 900 }, { x: p.x + 40, z: p.z + 1800 }] });
    window.__wf = { js: js, cr: cr, p: p };
    return { p: p, js: !!js, cr: !!cr, seam: typeof CBZ.waterWakeGLSL, twin: typeof CBZ.waterWakeHeightAt, sample: typeof CBZ.waterSample };
  `);
  t.log("setup " + JSON.stringify(setup));
  if (!setup || setup.err || setup.__err) return { ok: false, summary: "setup: " + JSON.stringify(setup) };
  const cam = `var W = window.__wf, r = W.js, c = CBZ.camera; c.position.set(r.pos.x + 14, 9, r.pos.z - 10); c.lookAt(r.pos.x, 0, r.pos.z + 6); c.updateMatrixWorld(true); return 1;`;
  for (let i = 0; i < 240; i++) { await t.fn(cam); await t.step(1); }
  // a person off a 14 m height and a car into the water beside the jetski's track
  const hits = await t.fn(`
    var r = window.__wf.js, y = CBZ.citySeaHeightAt(r.pos.x, r.pos.z);
    var a = CBZ.waterHit(r.pos.x - 6, y, r.pos.z - 20, { kind: 'body', mass: 78, speed: 16.6 });
    var b = CBZ.waterHit(r.pos.x + 8, y, r.pos.z - 30, { kind: 'vehicle', mass: 1400, speed: 14 });
    // an iron meteor (the 'impact' class: 0.42 m, 7800 kg/m3, 13 km/s) 200 m off
    var mt = CBZ.waterHit(r.pos.x - 200, y, r.pos.z, { kind: 'meteor', mass: 7800 * Math.PI / 6 * 0.42 * 0.42 * 0.42, speed: 13000, hot: true });
    return { body: a, car: b, meteor: mt, stats: CBZ.waterImpactStats ? CBZ.waterImpactStats() : null,
      fx: CBZ.waterFxAudit ? (function(){ var f = CBZ.waterFxAudit(); delete f.field; return f; })() : null };
  `);
  t.log("hits " + JSON.stringify(hits));
  for (let i = 0; i < 60; i++) { await t.fn(cam); await t.step(1); }
  const res = await t.fn(`
    var W = window.__wf;
    var audit = CBZ.waterWakeAudit();
    // the seam, in both stages, through a real program link
    var R = CBZ.renderer, gl = R.getContext();
    var glsl = CBZ.waterWakeGLSL();
    var mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, CBZ.waterWakeUniforms()),
      vertexShader: glsl + "\\nvarying vec4 vW;\\nvoid main(){ vec4 wp = modelMatrix * vec4(position,1.0); vec4 k = cbzWake(wp.xz); wp.y += k.w; vW = k; gl_Position = projectionMatrix * viewMatrix * wp; }",
      fragmentShader: glsl + "\\nvarying vec4 vW;\\nvoid main(){ vec4 k = cbzWake(gl_FragCoord.xy); gl_FragColor = vec4(k.z + vW.z, abs(k.x) + abs(vW.w), 0.0, 1.0); }",
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4, 2, 2), mat);
    mesh.frustumCulled = false; mesh.position.copy(CBZ.camera.position); mesh.position.y -= 5;
    CBZ.scene.add(mesh);
    var linkOk = null, log = '';
    try { R.compile(CBZ.scene, CBZ.camera); R.render(CBZ.scene, CBZ.camera); } catch (e) { log = String(e && e.message || e); }
    (R.info.programs || []).forEach(function (pr) { if (pr.name === mat.name || (pr.cacheKey && pr.cacheKey.indexOf('cbzWake') >= 0)) {} });
    var progs = R.properties.get(mat);
    var prog = progs && progs.currentProgram;
    if (prog && prog.program) { linkOk = !!gl.getProgramParameter(prog.program, gl.LINK_STATUS); if (!linkOk) log = gl.getProgramInfoLog(prog.program); }
    CBZ.scene.remove(mesh); mesh.geometry.dispose(); mat.dispose();
    // every program the renderer holds must link (the spray and crown sheet included)
    var bad = [];
    (R.info.programs || []).forEach(function (pr) {
      if (pr.program && !gl.getProgramParameter(pr.program, gl.LINK_STATUS)) bad.push(String(pr.name) + ': ' + String(gl.getProgramInfoLog(pr.program) || '').slice(0, 300));
    });
    var names = []; CBZ.scene.traverse(function (o) { if (o.name === 'world-water-spray' || o.name === 'world-water-crown') names.push(o.name + ':' + o.visible); });
    // the CPU twin over the water astern of the jetski: its biggest crest
    var twin = 0;
    for (var ix = -20; ix <= 20; ix += 1) for (var iz = -60; iz <= 0; iz += 1) {
      var hh = CBZ.waterWakeHeightAt(W.js.pos.x + ix, W.js.pos.z + iz, null);
      if (Math.abs(hh) > Math.abs(twin)) twin = hh;
    }
    return { audit: audit, seamLinked: linkOk, seamLog: log, badPrograms: bad, fxMeshes: names,
      jetski: CBZ.hullSeakeepAudit(W.js), cruiser: CBZ.hullSeakeepAudit(W.cr),
      stab: CBZ.hullStabAudit(), twinH: +twin.toFixed(3), fx: CBZ.waterFxAudit ? (function(){ var f = CBZ.waterFxAudit(); delete f.field; return f; })() : null };
  `);
  const errs = (t.errors() || []).filter((e) => !/favicon|404/i.test(String(e)));
  t.log("result " + JSON.stringify(res));
  t.log("errors " + JSON.stringify(errs.slice(0, 8)));
  if (!res || res.__err) return { ok: false, summary: "probe error: " + JSON.stringify(res) };
  const a = res.audit || {};
  const ok = a.built && a.complete === true && a.steps > 0 && res.seamLinked === true && errs.length === 0 &&
    !(res.badPrograms && res.badPrograms.length);
  return {
    ok,
    summary: `field ${a.target} ${a.n}^2 box ${a.box} m texel ${a.texel} m steps ${a.steps} src ${a.sourcesThisStep} maxH ${a.maxH} maxSlope ${a.maxSlope} slope>0.1 ${a.slopeOver010M2} m2 slope>0.25 ${a.slopeOver025M2} m2 foam ${a.foamM2} m2 (saturated ${a.foamSaturatedM2} m2) complete ${a.complete}; seam linked ${res.seamLinked}; bad programs ${(res.badPrograms || []).length} ${JSON.stringify(res.fxMeshes)}; ` +
      `jetski ${JSON.stringify(res.jetski)}; cruiser ${JSON.stringify(res.cruiser)}; twinH ${res.twinH}; errors ${errs.length}`,
    data: res,
  };
}
