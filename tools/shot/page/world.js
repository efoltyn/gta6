/* tools/shot/page/world.js — the IN-PAGE half of the shot service for the
   CBZ worlds (city, president, escape/prison, survival/disaster). Same contract
   as page/npcwar.js: window.__shot.stage(spec) / at(t) / shot(cam, W, H, fmt) /
   clear(). The world is already booted and frozen by the testbus boot
   (tools/testbus/worlds.mjs): rAF off, time moves only through CBZ.stepSim.

   spec: at=x,z (what to look at; default the player), heading=deg (the
   camera's bearing; default the player's view yaw), dist=m (orbit radius),
   js (run after staging with S = CBZ.player, B = CBZ, CBZ, THREE, spec).
   Cams: chase (behind and above the look point), fp (the player's eye),
   top, orbit:<yawDeg>:<pitchDeg>[:dist], at:<x>,<y>,<z>:<lx>,<ly>,<lz>. */
(function () {
  "use strict";
  var V = "dev";   // the daemon stamps a content hash here
  if (window.__shot && window.__shot.v === V) return true;
  var THREE = window.THREE, CBZ = window.CBZ;
  if (!THREE || !CBZ || !CBZ.scene) return false;
  var S = window.__shot = { v: V };
  var ST = { t: 0, snap: null, spec: {}, look: null, yaw: 0 };
  var V3 = function (x, y, z) { return new THREE.Vector3(x || 0, y || 0, z || 0); };

  function player() { return CBZ.player && CBZ.player.pos ? CBZ.player : null; }
  S.clear = function () {
    try { if (ST.snap && window.__tb) __tb.restore(ST.snap); } catch (e) {}
    ST.t = 0; ST.snap = null; ST.spec = {};
    return true;
  };
  S.stage = function (spec) {
    spec = spec || {};
    ST.spec = spec; ST.t = 0;
    try { ST.snap = window.__tb ? __tb.snap() : null; } catch (e) { ST.snap = null; }
    var P = player();
    if (spec.at) {
      var a = String(spec.at).split(",").map(Number);
      var y = a.length > 2 ? a[1] : (CBZ.groundAt ? CBZ.groundAt(a[0], a[a.length - 1]) : P ? P.pos.y : 0);
      ST.look = V3(a[0], y + 1.2, a[a.length - 1]);
    } else ST.look = P ? V3(P.pos.x, P.pos.y + 1.2, P.pos.z) : V3(0, 1.2, 0);
    ST.yaw = spec.heading != null ? (+spec.heading) * Math.PI / 180 : (CBZ.cam && typeof CBZ.cam.yaw === "number" ? CBZ.cam.yaw : 0);
    if (spec.js) {
      try { new Function("S", "B", "CBZ", "THREE", "spec", spec.js)(P, CBZ, CBZ, THREE, spec); }
      catch (e) { return { ok: false, error: "setup js threw: " + (e && e.message || e) }; }
    }
    return { ok: true, period: 1, warn: [], look: [ST.look.x, ST.look.y, ST.look.z].map(function (v) { return Math.round(v * 10) / 10; }) };
  };
  S.at = function (t) {
    t = +t || 0;
    var n = Math.max(0, Math.round((t - ST.t) * 60));
    var P = player();
    for (var i = 0; i < n; i++) {
      if (P) { P.hp = Math.max(P.hp || 0, 100); }
      if (window.__tb) __tb.step(1); else CBZ.stepSim(1 / 60);
    }
    if (t > ST.t) ST.t = t;
    return { t: ST.t };
  };
  function frame(cam) {
    var P = player(), L = ST.look.clone(), d = +ST.spec.dist || 9, parts = String(cam || "chase").split(":");
    var yaw = ST.yaw, pitch = 0.32, pos;
    // the game's yaw convention: the camera looks along (-sin yaw, -cos yaw)
    var dirFrom = function (yw, pt, dd) { return V3(Math.sin(yw) * Math.cos(pt) * dd, Math.sin(pt) * dd, Math.cos(yw) * Math.cos(pt) * dd); };
    switch (parts[0]) {
      case "chase": pos = L.clone().add(dirFrom(yaw, 0.32, d)); break;
      case "fp": {
        var eye = P ? V3(P.pos.x, P.pos.y + 1.62, P.pos.z) : L.clone();
        return { pos: eye, target: eye.clone().add(V3(-Math.sin(yaw), -0.05, -Math.cos(yaw))), fov: 70 };
      }
      case "top": pos = L.clone().add(V3(0.01, d * 3, 0)); break;
      case "orbit": pos = L.clone().add(dirFrom(yaw + (+parts[1] || 0) * Math.PI / 180, (parts[2] != null ? +parts[2] : 20) * Math.PI / 180, parts[3] != null ? +parts[3] : d)); break;
      case "at": {
        var p = String(parts[1] || "").split(",").map(Number), q = String(parts[2] || "").split(",").map(Number);
        if (p.length !== 3 || q.length !== 3) return null;
        return { pos: V3(p[0], p[1], p[2]), target: V3(q[0], q[1], q[2]), fov: 55 };
      }
      default: return null;
    }
    return { pos: pos, target: L, fov: 55 };
  }
  /* the first render of a CBZ world compiles every shader (a minute or more
     in swiftshader on a loaded Mac): the daemon pays it once, at boot */
  S.warm = function () {
    var R = CBZ.renderer, C = CBZ.camera;
    if (!R || !C) return false;
    R.setPixelRatio(1); R.setSize(320, 200, false);
    try { if (R.compile) R.compile(CBZ.scene, C); } catch (e) {}
    R.render(CBZ.scene, C);
    return true;
  };
  S.cams = ["chase", "fp", "top", "orbit:<yawDeg>:<pitchDeg>[:dist]", "at:<x,y,z>:<lx,ly,lz>"];
  S.shot = function (cam, W, H, fmt) {
    W = Math.max(64, Math.min(2048, W | 0 || 640)); H = Math.max(64, Math.min(2048, H | 0 || 400));
    var R = CBZ.renderer, C = CBZ.camera;
    if (!R || !C) return { error: "no renderer/camera" };
    var F = frame(cam);
    if (!F) return { error: "unknown cam \"" + cam + "\" (know: " + S.cams.join(", ") + ")" };
    var save = { pos: C.position.clone(), q: C.quaternion.clone(), fov: C.fov, aspect: C.aspect, near: C.near, far: C.far };
    var dome = CBZ.skyDome && CBZ.skyDome.parent, domeAt = dome ? dome.position.clone() : null;
    try {
      if (R.getPixelRatio() !== 1) R.setPixelRatio(1);
      var sz = R.getSize(new THREE.Vector2());
      if (sz.x !== W || sz.y !== H) R.setSize(W, H, false);
      C.fov = F.fov; C.aspect = W / H; C.position.copy(F.pos); C.lookAt(F.target);
      C.updateProjectionMatrix(); C.updateMatrixWorld(true);
      if (C.matrixWorldInverse) C.matrixWorldInverse.copy(C.matrixWorld).invert();
      // the sky rig follows the camera in the game loop; with the loop frozen we move it
      if (dome) dome.position.set(F.pos.x, 0, F.pos.z);
      R.render(CBZ.scene, C);
      return { url: R.domElement.toDataURL(fmt || "image/png") };
    } finally {
      if (dome && domeAt) dome.position.copy(domeAt);
      C.position.copy(save.pos); C.quaternion.copy(save.q);
      C.fov = save.fov; C.aspect = save.aspect; C.near = save.near; C.far = save.far; C.updateProjectionMatrix();
    }
  };
  return true;
})();
