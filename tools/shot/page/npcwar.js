/* tools/shot/page/npcwar.js — the IN-PAGE half of the shot service for NPC War
   (games/battle.html). Evaluated into a warm, frozen battle page; defines
   window.__shot. The node side (tools/shot/worlds.mjs) calls:

     __shot.stage(spec)      clear the field, spawn the subject(s), pose setup
                             -> { ok, subjects[], period, warn[] }
     __shot.at(t)            move the staged moment to time t (sim seconds; for
                             an attack, t is the strike phase 0..1)
     __shot.shot(cam, W, H, fmt) -> dataURL of one frame
     __shot.clear()          studio down, field empty, visibility restored
     __shot.species()        every bestiary id this page can spawn

   Nothing here is a second animal system. Bodies come from __battle.restage
   (the species' own build(), the shared gait/swim rig, the team collar), gait
   frames come from CBZ.wildlifeRig.animateGait / CBZ.animateSwim / CBZ.animChar
   (the calls the battle makes every frame), attacks from CBZ.predatorPose
   with CBZ.creatureStyleFor, deaths from the page's own damage route
   (CBZ.modes.npcwar.hurt -> hurtMan -> killMan -> the ragdoll solver) and
   __battle.advance. The service only moves the body along a line at a stated
   speed (a puppet walk, so a gait frame is a statement about a speed rather
   than about whatever the AI felt like) and points the camera.

   THE STUDIO (stage=studio, the default for portraits): every scene child that
   is not a subject is hidden for the one render, a grey cyclorama + 1 m scale
   grid + 2 m ruler + contact shadow go in, and a key/fill/rim rig is placed
   relative to the camera, so every angle is lit the same way and the animal
   is the only thing in the frame. stage=map renders the real arena instead. */
(function () {
  "use strict";
  var V = "dev";   // the daemon stamps a content hash here, so an edited lib re-installs
  if (window.__shot && window.__shot.v === V) return true;
  var THREE = window.THREE, CBZ = window.CBZ, B = window.__battle;
  if (!THREE || !CBZ || !B) return false;
  var S = window.__shot = { v: V };

  var ST = { spec: null, subj: [], t: 0, startPos: [], studio: null, base: null, period: 1, warn: [] };
  var V3 = function (x, y, z) { return new THREE.Vector3(x || 0, y || 0, z || 0); };
  var UP = V3(0, 1, 0);

  S.species = function () {
    var SP = CBZ.WILDLIFE_SPECIES || {};
    var out = Object.keys(SP).filter(function (k) { return SP[k] && SP[k].build; });
    // and every unit with its own file (src/units/manifest.js): the dog, the vehicles
    var MAN = CBZ.UNIT_MANIFEST || {};
    Object.keys(MAN).forEach(function (k) { if (MAN[k].kind !== "men" && out.indexOf(k) < 0) out.push(k); });
    return out.sort();
  };
  // a unit id this page can field: a bestiary species, or a unit file (species/vehicle)
  function knownUnit(k) {
    var SP = CBZ.WILDLIFE_SPECIES || {};
    if (k === "men" || (SP[k] && SP[k].build)) return true;
    var K = CBZ.unitKit;
    return !!(K && (K.kindOf(k) === "vehicle" || (K.kindOf(k) === "species" && K.has(k))));
  }

  /* ---- bodies ----------------------------------------------------------- */
  function grp(m) { return m.group || (m.char && m.char.group) || null; }
  function fwdOf(m) {
    var g = grp(m); if (!g) return V3(1, 0, 0);
    g.updateMatrixWorld(true);
    var q = new THREE.Quaternion(); g.getWorldQuaternion(q);
    var f = (m.beast ? V3(1, 0, 0) : V3(0, 0, 1)).applyQuaternion(q); f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(1, 0, 0);
    return f.normalize();
  }
  function face(m, h) {
    m.heading = h; m.faceH = h;
    if (m.beast) { if (CBZ.faceAnimalHeading) CBZ.faceAnimalHeading(m, h); else grp(m).rotation.y = -h; }
    else { var ry = Math.PI / 2 - h; m.yaw = ry; grp(m).rotation.y = ry; }
  }
  function boxOf(list) {
    var b = new THREE.Box3(), tmp = new THREE.Box3();
    for (var i = 0; i < list.length; i++) {
      var g = grp(list[i]); if (!g) continue;
      g.updateMatrixWorld(true);
      tmp.setFromObject(g);
      if (!tmp.isEmpty()) b.union(tmp);
    }
    if (b.isEmpty()) b.setFromCenterAndSize(V3(0, 1, 0), V3(2, 2, 2));
    return b;
  }
  function headBox(m) {
    if (!m.beast) {
      var b = boxOf([m]), h = b.max.y - b.min.y, c = b.getCenter(V3());
      return new THREE.Box3().setFromCenterAndSize(V3(c.x, b.max.y - h * 0.09, c.z), V3(h * 0.16, h * 0.18, h * 0.16));
    }
    try {
      var rig = CBZ.predatorRigBuild && CBZ.predatorRigBuild(m);
      var parts = rig && rig.head;
      if (parts && parts.length) {
        var hb = new THREE.Box3(), t = new THREE.Box3();
        for (var i = 0; i < parts.length; i++) {
          var o = parts[i] && (parts[i].m || parts[i].mesh || parts[i]);
          if (o && o.isObject3D) { o.updateMatrixWorld(true); t.setFromObject(o); if (!t.isEmpty()) hb.union(t); }
        }
        if (!hb.isEmpty()) return hb;
      }
    } catch (e) {}
    // fallback: the front-top of the body (nose is +X)
    var bb = boxOf([m]), f = fwdOf(m), c2 = bb.getCenter(V3()), sz = bb.getSize(V3());
    var len = Math.max(sz.x, sz.z), H = sz.y;
    var p = c2.clone().addScaledVector(f, len * 0.38); p.y = bb.min.y + H * 0.78;
    return new THREE.Box3().setFromCenterAndSize(p, V3(H * 0.3, H * 0.3, H * 0.3));
  }

  /* ---- the studio ------------------------------------------------------- */
  function gradTex() {
    var c = document.createElement("canvas"); c.width = c.height = 64;
    var x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(0.6, "rgba(0,0,0,0.22)"); g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  function buildStudio(spec, box) {
    var size = box.getSize(V3()), c = box.getCenter(V3());
    var span = Math.max(size.x, size.z, size.y);
    var R = Math.max(14, span * 4 + (spec.travel || 0));
    var g = new THREE.Group(); g.name = "shot-studio";
    var floorY = box.min.y;
    g.position.set(c.x, floorY, c.z);
    // the cyclorama: a floor that curves up into a wall all the way round
    var cove = Math.max(3, R * 0.25), Hh = R * 1.2, pts = [];
    pts.push(new THREE.Vector2(0.001, 0));
    pts.push(new THREE.Vector2(R, 0));
    for (var i = 1; i <= 8; i++) { var a = (i / 8) * Math.PI / 2; pts.push(new THREE.Vector2(R + Math.sin(a) * cove, cove - Math.cos(a) * cove)); }
    pts.push(new THREE.Vector2(R + cove, Hh));
    var shell = new THREE.Mesh(new THREE.LatheGeometry(pts, 64),
      new THREE.MeshStandardMaterial({ color: 0x74777c, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }));
    shell.position.y = -0.004;
    g.add(shell);
    if (spec.grid !== "0") {
      var div = Math.max(2, Math.round(R * 2)), minor = new THREE.GridHelper(R * 2, div, 0x6f7378, 0x7b7f84);
      minor.position.y = 0.002; minor.material.transparent = true; minor.material.opacity = 0.55; g.add(minor);
      var major = new THREE.GridHelper(R * 2, Math.max(1, Math.round(div / 5)), 0x55585d, 0x55585d);
      major.position.y = 0.003; major.material.transparent = true; major.material.opacity = 0.8; g.add(major);
    }
    if (spec.ruler !== "0") {
      // a 2 m pole in 0.5 m bands: scale you can read in any frame it is in
      var rl = new THREE.Group();
      for (var k = 0; k < 4; k++) {
        var band = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 10),
          new THREE.MeshStandardMaterial({ color: k % 2 ? 0xf2f2f2 : 0xc8262c, roughness: 0.6 }));
        band.position.y = 0.25 + k * 0.5; rl.add(band);
      }
      g.add(rl); g.userData.ruler = rl;
    }
    var sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: gradTex(), transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.006; sh.renderOrder = 1;
    g.add(sh); g.userData.shadow = sh;
    // three-point rig + a low ambient; placed per shot, relative to the camera
    var key = new THREE.DirectionalLight(0xfff1e0, 0.8), fill = new THREE.DirectionalLight(0xdce6ff, 0.32),
      rim = new THREE.DirectionalLight(0xffffff, 0.8), amb = new THREE.HemisphereLight(0xffffff, 0x50535a, 0.22);
    var tgt = new THREE.Object3D();
    key.target = fill.target = rim.target = tgt;
    g.add(key, fill, rim, amb, tgt);
    g.userData.lights = { key: key, fill: fill, rim: rim, tgt: tgt, R: R };
    g.userData.floorY = floorY;
    CBZ.scene.add(g);
    return g;
  }
  function placeStudio(st, camPos, target, box) {
    var L = st.userData.lights, R = L.R;
    st.updateMatrixWorld(true);
    var toLocal = function (v) { return st.worldToLocal(v.clone()); };
    var d = camPos.clone().sub(target); d.y = 0; if (d.lengthSq() < 1e-6) d.set(0, 0, 1); d.normalize();
    var right = d.clone().cross(UP).normalize();
    var t = toLocal(target); L.tgt.position.copy(t);
    var put = function (light, v) { light.position.copy(t).add(v); };
    put(L.key, d.clone().multiplyScalar(R * 0.7).addScaledVector(right, R * 0.6).addScaledVector(UP, R * 0.9));
    put(L.fill, d.clone().multiplyScalar(R * 0.6).addScaledVector(right, -R * 0.8).addScaledVector(UP, R * 0.3));
    put(L.rim, d.clone().multiplyScalar(-R).addScaledVector(right, -R * 0.2).addScaledVector(UP, R * 0.8));
    // the shadow and the ruler follow the subject (a run crosses the floor)
    var c = box.getCenter(V3()), sz = box.getSize(V3());
    var sh = st.userData.shadow, lc = toLocal(V3(c.x, st.userData.floorY, c.z));
    sh.position.set(lc.x, 0.006, lc.z);
    sh.scale.set(Math.max(0.6, sz.x * 1.25), Math.max(0.6, sz.z * 1.25), 1);
    var rl = st.userData.ruler;
    if (rl && ST.subj[0]) {
      var f = fwdOf(ST.subj[0]), side = f.clone().cross(UP).normalize();
      var p = V3(c.x, st.userData.floorY, c.z).addScaledVector(f, sz.length() * 0.35 + 0.6).addScaledVector(side, -(sz.length() * 0.3 + 0.6));
      var lp = toLocal(p); rl.position.set(lp.x, 0, lp.z);
    }
  }
  /* hide everything that is not a subject or the studio, for one render */
  function isolate(keep) {
    var K = new Set(), A = new Set(), changed = [];
    keep.forEach(function (o) { if (!o) return; K.add(o); for (var p = o.parent; p; p = p.parent) A.add(p); });
    (function walk(o) {
      for (var i = 0; i < o.children.length; i++) {
        var c = o.children[i];
        if (K.has(c)) continue;
        if (A.has(c)) { walk(c); continue; }
        if (c.visible) { c.visible = false; changed.push(c); }
      }
    })(CBZ.scene);
    return changed;
  }

  /* ---- staging ----------------------------------------------------------- */
  S.clear = function () {
    if (ST.studio) { if (ST.studio.parent) ST.studio.parent.remove(ST.studio); ST.studio = null; }
    try { B.restage({ rn: 0, bn: 0 }); } catch (e) {}
    ST.subj = []; ST.spec = null; ST.t = 0;
    return true;
  };

  var MOTION = { walk: 1, trot: 1, run: 1 };
  /* THE UNITS LOAD FIRST. Unit files are lazy on the page (a roster asks for
     them); the stage asks the registry for its subject and opponent (and their
     engine needs) and stages once they are in. A swapped-in file is already
     registered; need() still brings its needs. */
  S.stage = function (spec) {
    spec = spec || {};
    var K = CBZ.unitKit, R = CBZ.battleRoster;
    if (!K || !R) return stageNow(spec);
    var ids = R.ids(spec.species || spec.unit || "men").concat(spec.vs ? R.ids(spec.vs) : []);
    return K.need(ids).then(function () { return stageNow(spec); });
  };
  /* THE WAR AS THE PAGE FIGHTS IT (pose=war). Nothing is restaged: the page
     booted the battle its own URL asked for (red/blue/map/tier/worker ...;
     a tiered war is src/battle/mass.js), and the shot steps that battle
     with __battle.advance. lens=dx,dz[,h] parks the page's own camera that
     far from the field's centre while time runs, so the FULL ring (it
     follows the lens) is where the shot looks. Cams: lens (the page's own
     camera), field (the whole field, high), front (low, along the lines),
     plus wide / hot. Each frame's stats (tiers, crowd draw, sim ms) come
     back as the shot's info. */
  function stageWar(spec) {
    ST.warn = [];
    if (ST.studio) { if (ST.studio.parent) ST.studio.parent.remove(ST.studio); ST.studio = null; }
    ST.spec = spec; ST.pose = "war"; ST.t = 0; ST.subj = B.roster();
    ST.lens = String(spec.lens || "0,0").split(",").map(Number);
    parkLens();
    if (spec.js) {
      try { new Function("S", "B", "CBZ", "THREE", "spec", spec.js)(ST.subj, B, CBZ, THREE, spec); }
      catch (e) { return { ok: false, error: "setup js threw: " + (e && e.message || e) }; }
    }
    return { ok: true, pose: "war", period: 1, subjects: [], warn: ST.warn };
  }
  function parkLens() {
    try {
      /* global MAP, cam, setCamMode */
      var cx = MAP.cx + (ST.lens[0] || 0), cz = MAP.cz + (ST.lens[1] || 0), h = ST.lens[2] || 24;
      setCamMode("free");
      cam.focus.set(cx, MAP.groundAt(cx, cz), cz); cam.wFocus.copy(cam.focus);
      cam.yaw = cam.wYaw = 0.35; cam.pitch = cam.wPitch = Math.atan2(h, 40); cam.dist = cam.wDist = Math.hypot(h, 40);
    } catch (e) { ST.warn.push("lens: " + e.message); }
  }
  function warInfo() {
    var o = {};
    try { var a = B.audit(); o.mass = a.mass; o.simT = a.clock; } catch (e) {}
    try { if (CBZ.massDraw) o.draw = CBZ.massDraw.audit(); } catch (e) {}
    try { var t = B.tally(); o.alive = t.alive; o.dead = t.dead; } catch (e) {}
    return o;
  }
  function stageNow(spec) {
    spec = spec || {};
    if (spec.pose === "war") return stageWar(spec);
    ST.warn = [];
    if (ST.studio) { if (ST.studio.parent) ST.studio.parent.remove(ST.studio); ST.studio = null; }
    var SP = CBZ.WILDLIFE_SPECIES || {};
    var kind = spec.species || spec.unit || "men";
    var kinds = String(kind).split("|");
    for (var i = 0; i < kinds.length; i++) {
      if (!knownUnit(kinds[i])) {
        return { ok: false, error: "unknown species \"" + kinds[i] + "\". Known: " + S.species().join(" ") };
      }
    }
    if (spec.vs && !knownUnit(spec.vs)) return { ok: false, error: "unknown species \"" + spec.vs + "\"" };
    var pose = spec.pose || "idle";
    var fight = pose === "fight" || !!spec.vs;
    var n = Math.max(1, Math.min(200, +spec.n || 1));
    var o = { ru: kind, rn: n, bn: 0, now: true };
    if (fight) { o.bu = spec.vs || "men"; o.bn = Math.max(1, Math.min(400, +(spec.vn || spec.n2 || 1))); }
    if (spec.rw) o.rw = spec.rw; if (spec.bw) o.bw = spec.bw;
    if (spec.rt) o.rt = spec.rt; if (spec.bt) o.bt = spec.bt;
    var r = B.restage(o);
    var men = B.roster();
    ST.subj = men.filter(function (m) { return fight || m.team === "red"; });
    if (!ST.subj.length) return { ok: false, error: "restage produced no bodies (" + JSON.stringify(r) + ")" };
    ST.spec = spec; ST.t = 0; ST.pose = pose;
    var lead = ST.subj[0], h = (+spec.heading || 0) * Math.PI / 180;
    if (!fight) {
      // a line abreast, facing +X (heading 0), on the lead's spawn point
      var x0 = lead.pos.x, z0 = lead.pos.z, y0 = lead.pos.y;
      var bb0 = boxOf([lead]), s0 = bb0.getSize(V3()), gap = Math.max(1.2, Math.max(s0.x, s0.z) * 0.9);
      for (var j = 0; j < ST.subj.length; j++) {
        var m = ST.subj[j];
        m.pos.set(x0 + Math.sin(h) * (j - (ST.subj.length - 1) / 2) * gap, y0, z0 - Math.cos(h) * (j - (ST.subj.length - 1) / 2) * gap);
        face(m, h);
        m.tgt = null;
      }
    }
    // the motion speed for a puppet walk: the species' own numbers
    var sp0 = lead.beast ? lead.species : null, cls = null;
    try { cls = sp0 && CBZ.wildlifeRig ? CBZ.wildlifeRig.classify(sp0) : null; } catch (e) {}
    var wander = sp0 ? (sp0.spd || 1.6) : 1.5;
    var chase = sp0 ? Math.max(4.2, Math.min(8.6, wander * ((cls && cls.atkM) || 2.2) * 1.15)) : 6.5;
    var speed = +spec.speed || (pose === "walk" ? wander : pose === "trot" ? Math.min(chase * 0.62, Math.max(wander * 1.9, chase * 0.5)) : pose === "run" ? chase : 0);
    ST.speed = speed;
    ST.period = 1;
    if (MOTION[pose]) {
      if (!lead.beast) ST.period = 0.75;
      else if (lead.swim) ST.period = 1;
      else if (lead.gait) {
        var rate = Math.min(speed * (lead.gait.freq || 1), (cls && cls.stepCap) || 15);
        ST.period = rate > 0 ? (Math.PI * 2) / rate : 1;
      } else ST.warn.push("no gait rig on " + (sp0 ? sp0.id : "men") + ": legs will not move");
      // start a little behind the mark so t=0 is mid-stride at the centre
      var warm = 0.6;
      for (var q = 0; q < ST.subj.length; q++) {
        var mm = ST.subj[q], f = fwdOf(mm);
        mm.pos.x -= f.x * speed * warm; mm.pos.z -= f.z * speed * warm;
      }
      for (var w = 0, nW = Math.round(warm * 60); w < nW; w++) puppet(1 / 60);
    }
    if (pose === "attack") {
      if (!lead.beast) ST.warn.push("attack poses are for beasts (men fight with guns: use pose=fight)");
      ST.style = spec.style || (CBZ.creatureStyleFor ? CBZ.creatureStyleFor(lead.species) : "bite");
    }
    if (pose === "death") {
      var route = CBZ.modes && CBZ.modes.npcwar && CBZ.modes.npcwar.hurt;
      for (var d = 0; d < ST.subj.length; d++) {
        var dm = ST.subj[d];
        var dir = fwdOf(dm).multiplyScalar(-1);
        if (route) route(dm, 1e9, { byTeam: "blue", dir: { x: dir.x, z: dir.z }, cause: "shot" });
        else { ST.warn.push("no npcwar hurt route: cannot kill"); break; }
      }
    }
    if (spec.js) {
      try { new Function("S", "B", "CBZ", "THREE", "spec", spec.js)(ST.subj, B, CBZ, THREE, spec); }
      catch (e) { return { ok: false, error: "setup js threw: " + (e && e.message || e) }; }
    }
    if (pose === "fight" || pose === "death") ST.travel = 0;
    var box = boxOf(ST.subj);
    ST.studio = (spec.stage || (fight ? "map" : "studio")) === "studio" ? buildStudio({ grid: spec.grid, ruler: spec.ruler, travel: speed * 3 }, box) : null;
    return {
      ok: true, pose: pose, period: Math.round(ST.period * 1000) / 1000, speed: Math.round(speed * 100) / 100, style: ST.style || null,
      subjects: ST.subj.slice(0, 12).map(function (m) {
        var b = boxOf([m]), s = b.getSize(V3());
        return { id: m.id, team: m.team, kind: m.beast ? m.species.id : "men", size: [s.x, s.y, s.z].map(function (v) { return Math.round(v * 100) / 100; }) };
      }),
      warn: ST.warn,
    };
  };

  function puppet(dt) {
    for (var i = 0; i < ST.subj.length; i++) {
      var m = ST.subj[i]; if (m.dead) continue;
      var f = fwdOf(m), y = m.pos.y;
      m.pos.x += f.x * ST.speed * dt; m.pos.z += f.z * ST.speed * dt; m.pos.y = y;
      try {
        if (!m.beast) { if (CBZ.animChar && m.char) CBZ.animChar(m.char, ST.speed, dt); }
        else if (m.swim) { if (CBZ.animateSwim) CBZ.animateSwim(m, dt); }
        else if (CBZ.wildlifeRig) CBZ.wildlifeRig.animateGait(m, dt);
      } catch (e) { if (ST.warn.length < 5) ST.warn.push("rig threw: " + e.message); }
      m.pos.y = y;     // the gait's bob is on the group; the ground is ours
    }
  }

  S.at = function (t) {
    t = +t || 0;
    var pose = ST.pose;
    if (MOTION[pose]) {
      var steps = Math.max(0, Math.round((t - ST.t) * 60));
      for (var i = 0; i < steps; i++) puppet(1 / 60);
      if (t > ST.t) ST.t = t;
    } else if (pose === "attack") {
      for (var k = 0; k < ST.subj.length; k++) {
        var m = ST.subj[k];
        if (m.beast && CBZ.predatorPose) {
          CBZ.predatorPose(m, ST.style, 0, 0, 0);            // release: a clean absolute write
          CBZ.predatorPose(m, ST.style, t % 1 === 0 && t > 0 ? 0.999 : t % 1, 1, 1 / 60);
        }
      }
      ST.t = t;
    } else if (pose === "death" || pose === "fight") {
      if (t > ST.t) { B.advance(t - ST.t); ST.t = t; }
    } else if (pose === "war") {
      // a big war at 1/30 s frames, the lens held where the shot will look
      while (t > ST.t + 1e-6) {
        var d = Math.min(1, t - ST.t);
        parkLens();
        B.advance(d, 1 / 30);
        ST.t += d;
      }
      ST.subj = B.roster();
      return { t: ST.t, info: warInfo() };
    }
    return { t: ST.t, alive: ST.subj.filter(function (m) { return !m.dead; }).length };
  };

  /* ---- cameras ----------------------------------------------------------- */
  function frameWar(cam, aspect) {
    /* global MAP, MASS, STORE */
    var name = String(cam || "lens").split(":")[0];
    var C = CBZ.camera;
    if (name === "lens") return { pos: C.position.clone(), target: C.position.clone().add(C.getWorldDirection(V3()).multiplyScalar(50)), fov: C.fov, dist: 50, up: null, box: null };
    // the field: every living row (or every man, in an all-FULL war)
    var x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    try {
      if (MASS.on) {
        var K = STORE.cols;
        for (var r = 0; r < STORE.rows; r += 7) {
          if (K.life[r] !== 1 && K.life[r] !== 2) continue;
          if (K.x[r] < x0) x0 = K.x[r]; if (K.x[r] > x1) x1 = K.x[r]; if (K.z[r] < z0) z0 = K.z[r]; if (K.z[r] > z1) z1 = K.z[r];
        }
      }
    } catch (e) {}
    if (x0 > x1) { var bb = boxOf(B.roster()); x0 = bb.min.x; x1 = bb.max.x; z0 = bb.min.z; z1 = bb.max.z; }
    var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, gy = MAP.groundAt(cx, cz);
    var fov = 40, vfov = fov * Math.PI / 180;
    if (name === "field") {
      var span = Math.max(x1 - x0, (z1 - z0) / aspect) * 0.55;
      var dist = span / Math.tan(vfov / 2), e = 52 * Math.PI / 180;
      var tgt = V3(cx, gy, cz);
      return { pos: tgt.clone().add(V3(0, Math.sin(e) * dist, Math.cos(e) * dist)), target: tgt, fov: fov, dist: dist, up: null, box: null };
    }
    if (name === "front") {
      // low behind the lens's side of the lines, looking across no man's land
      var lx = MAP.cx + (ST.lens[0] || 0), lz = MAP.cz + (ST.lens[1] || 0);
      var tg = V3(lx, MAP.groundAt(lx, lz) + 1.5, lz);
      var p = V3(lx - 70, 0, lz + 28); p.y = MAP.groundAt(p.x, p.z) + 9;
      return { pos: p, target: tg, fov: 52, dist: 75, up: null, box: null };
    }
    return null;
  }
  function frame(cam, aspect) {
    if (ST.pose === "war") { var fw = frameWar(cam, aspect); if (fw) return fw; }
    var lead = ST.subj[0];
    var all = ST.pose === "fight" ? B.roster() : ST.subj;
    var box = boxOf(ST.pose === "fight" ? all.filter(function (m) { return !m.dead || true; }) : all);
    var c = box.getCenter(V3()), sz = box.getSize(V3());
    var f = lead ? fwdOf(lead) : V3(1, 0, 0), right = f.clone().cross(UP).normalize();
    var fov = 30, target = c.clone(), rad = Math.max(0.3, sz.length() / 2), dirH = f.clone(), elev = 8, dist = 0, up = null, distMul = 1;
    var name = String(cam || "3q"), parts = name.split(":");
    switch (parts[0]) {
      case "front": dirH = f.clone(); elev = 8; break;
      case "back": dirH = f.clone().negate(); elev = 10; break;
      case "side": case "right": dirH = right.clone(); elev = 5; break;
      case "left": dirH = right.clone().negate(); elev = 5; break;
      case "3q": dirH = f.clone().add(right).normalize(); elev = 18; break;
      case "3qb": dirH = f.clone().negate().add(right).normalize(); elev = 18; break;
      case "top": dirH = f.clone().negate(); elev = 89.5; up = f.clone(); break;
      case "head": {
        var hb = headBox(lead), hs = hb.getSize(V3());
        target = hb.getCenter(V3()); rad = Math.max(0.1, hs.length() * 0.38);
        dirH = f.clone().multiplyScalar(0.8).add(right.clone().multiplyScalar(0.6)).normalize(); elev = 12; fov = 28;
        break;
      }
      case "feet": {
        var H = sz.y, L = Math.max(sz.x, sz.z);
        target = V3(c.x, box.min.y + H * 0.14, c.z);
        rad = Math.max(0.25, Math.max(L, H) * 0.3);
        dirH = right.clone().multiplyScalar(0.9).add(f.clone().multiplyScalar(0.45)).normalize(); elev = 4; fov = 34;
        break;
      }
      case "wide": dirH = V3(0.3, 0, 1).normalize(); elev = 38; fov = 40; distMul = 1.05; break;
      case "hot": {
        var hsp = null; try { hsp = B.look(30, 0.45); } catch (e) {}
        if (hsp) target = V3(hsp.x, c.y, hsp.z);
        rad = Math.min(rad, 16); dirH = V3(0.3, 0, 1).normalize(); elev = 26; fov = 40;
        break;
      }
      case "orbit": {
        var yaw = (+parts[1] || 0) * Math.PI / 180;
        dirH = f.clone().multiplyScalar(Math.cos(yaw)).add(right.clone().multiplyScalar(Math.sin(yaw))).normalize();
        elev = parts[2] != null ? +parts[2] : 15; distMul = parts[3] != null ? +parts[3] || 1 : 1;
        break;
      }
      default: return null;
    }
    var vfov = fov * Math.PI / 180, hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    dist = (rad / Math.sin(Math.min(vfov, hfov) / 2)) * 1.02 * distMul;
    var e = elev * Math.PI / 180;
    var pos = target.clone().addScaledVector(dirH, Math.cos(e) * dist).addScaledVector(UP, Math.sin(e) * dist);
    // never under the studio floor (a low feet shot on a slope)
    if (ST.studio && pos.y < ST.studio.userData.floorY + 0.05) pos.y = ST.studio.userData.floorY + 0.05;
    return { pos: pos, target: target, fov: fov, dist: dist, up: up, box: box };
  }

  S.cams = ["front", "side", "back", "left", "3q", "3qb", "top", "head", "feet", "wide", "hot", "orbit:<yawDeg>:<pitchDeg>[:distMul]"];

  S.shot = function (cam, W, H, fmt) {
    W = Math.max(64, Math.min(2048, W | 0 || 640)); H = Math.max(64, Math.min(2048, H | 0 || 400));
    var R = CBZ.renderer || (CBZ.micro && CBZ.micro.renderer), C = CBZ.camera, scene = CBZ.scene;
    if (!R || !C) return { error: "no renderer/camera" };
    var F = frame(cam, W / H);
    if (!F) return { error: "unknown cam \"" + cam + "\" (know: " + S.cams.join(", ") + ")" };
    var save = { pos: C.position.clone(), q: C.quaternion.clone(), up: C.up.clone(), fov: C.fov, aspect: C.aspect, near: C.near, far: C.far,
      bg: scene.background, fog: scene.fog, pr: R.getPixelRatio() };
    var hidden = null;
    try {
      if (ST.studio) {
        placeStudio(ST.studio, F.pos, F.target, F.box);
        var keep = [ST.studio];
        for (var i = 0; i < ST.subj.length; i++) keep.push(grp(ST.subj[i]));
        hidden = isolate(keep);
        scene.background = new THREE.Color(0x74777c); scene.fog = null;
      }
      if (R.getPixelRatio() !== 1) R.setPixelRatio(1);
      var sz = R.getSize(new THREE.Vector2());
      if (sz.x !== W || sz.y !== H) R.setSize(W, H, false);
      C.fov = F.fov; C.aspect = W / H;
      C.near = Math.max(0.01, F.dist * 0.01); C.far = Math.max(2000, F.dist * 50);
      C.position.copy(F.pos);
      C.up.copy(F.up || UP);
      C.lookAt(F.target);
      C.updateProjectionMatrix(); C.updateMatrixWorld(true);
      if (C.matrixWorldInverse) C.matrixWorldInverse.copy(C.matrixWorld).invert();
      R.render(scene, C);
      return { url: R.domElement.toDataURL(fmt || "image/png"), dist: Math.round(F.dist * 100) / 100, info: ST.pose === "war" ? JSON.stringify(warInfo()) : undefined };
    } finally {
      if (hidden) for (var h = 0; h < hidden.length; h++) hidden[h].visible = true;
      scene.background = save.bg; scene.fog = save.fog;
      C.position.copy(save.pos); C.quaternion.copy(save.q); C.up.copy(save.up);
      C.fov = save.fov; C.aspect = save.aspect; C.near = save.near; C.far = save.far; C.updateProjectionMatrix();
    }
  };
  return true;
})();
