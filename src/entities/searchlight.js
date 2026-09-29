/* ============================================================
   entities/searchlight.js — tower searchlights that sweep the yard.
   A real lamp on each tower roof, a soft beam through the air, a soft
   pool where it lands; and they ALSO catch you: detection.js queries
   CBZ.litBySearchlight(pos, crouch).

   THE LOOK (rebuilt 2026-09-28, owner on his iPad at night: "the beaming
   lights that come from the towers are kind of unrealistic looking").
   It WAS: a glowing cylinder on its side for a head, a flat 10% cone with
   a hard circular mouth you could see from below, and a 22% disc with a
   polygon edge on the ground. It IS:
     · a searchlight: pedestal, turntable, a yoke that yaws, a drum on
       trunnions that pitches, a bezel, cooling rings, a rear cap, a handle,
       and a lens that glows at night; the whole head actually AIMS at the
       spot it is lighting.
     · lens glare: a camera-facing flare that swells when you look up the
       beam at the lamp and is nothing from the side.
     · the beam: an additive cone whose brightness falls off with distance
       from the lens, fades out at its silhouette edges (view-dependent) and
       before its mouth (so there is no hard circle), carries a slow drifting
       dust shimmer, and fades when the camera is inside it. It is bright at
       night and almost invisible by day, like a real one.
     · the pool: a soft-edged light cookie on the ground, stretched along the
       beam into the ellipse a slanted spot really throws.
   Cheap: one shared beam program, one shared pool texture, no new lights
   (the four SpotLights were already here), a handful of meshes per tower.

   CBZ.softBeamMaterial / CBZ.softPoolMaterial / CBZ.unitBeamGeometry are
   the shared pieces, published so every other air beam and floor pool in
   the prison (flood masts, guards' torches: systems/prisonnight.js) uses
   the same soft light instead of a flat cone and a hard disc.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  // This file's CONFIG defaults are published at parse: other files read
  // them before (or without) the prison ever being built.
  if (CBZ.CONFIG.JAIL_SEARCHLIGHT_DETECT == null) CBZ.CONFIG.JAIL_SEARCHLIGHT_DETECT = true;
  // Built when the prison is first needed, as if at this script's parse
  // point (core/prisonlazy.js). Body left at its old indent.
  CBZ.definePrison("entities/searchlight.js", function () {
  const scene = CBZ.prisonRoot || CBZ.scene;

  // searchlights are real SENSORS when this is on: systems/detection.js
  // consumes CBZ.litBySearchlight (heat + guard pings), and down in update()
  // the beam that is actually holding the player flushes red as feedback.

  /* ==========================================================
     1. SHARED SOFT LIGHT
     ========================================================== */
  // one clock for every beam's dust drift
  const BEAM_TIME = { value: 0 };

  // A cone along +Y from y=0 (the lens, radius r0) to y=1 (the far end,
  // radius 1). Scale it (R, length, R) and point +Y down the beam.
  const unitGeoCache = {};
  function unitBeamGeometry(r0) {
    const k = String(r0);
    if (unitGeoCache[k]) return unitGeoCache[k];
    const g = new THREE.CylinderGeometry(1, r0, 1, 24, 6, true);
    g.translate(0, 0.5, 0);
    unitGeoCache[k] = g;
    return g;
  }

  // Additive MeshBasicMaterial with the soft-beam mask patched in. It stays
  // a MeshBasicMaterial so anything that drives `material.opacity` (the
  // fixtures rig) keeps working; `opacity` is the beam's gain.
  function beamPatch(shader) {
    shader.uniforms.uBeamTime = BEAM_TIME;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>",
        "#include <common>\nvarying float vBT;\nvarying vec3 vBN;\nvarying vec3 vBV;\nvarying vec3 vBW;")
      .replace("#include <project_vertex>",
        "#include <project_vertex>\n  vBT = position.y;\n  vBN = normalize(normalMatrix * normal);\n  vBV = -mvPosition.xyz;\n  vBW = (modelMatrix * vec4(position, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>",
        "#include <common>\nuniform float uBeamTime;\nvarying float vBT;\nvarying vec3 vBN;\nvarying vec3 vBV;\nvarying vec3 vBW;")
      .replace("#include <tonemapping_fragment>",
        [
          "{",
          "  float bt = clamp(vBT, 0.0, 1.0);",
          "  float camD = length(vBV);",
          "  float facing = abs(dot(normalize(vBN), vBV / max(camD, 1e-4)));",
          "  float soft = facing * facing * (3.0 - 2.0 * facing);",          // silhouette edges fade to nothing
          "  float axial = 1.0 / (1.0 + 5.0 * bt);",                         // spreads, so it thins with distance
          "  axial *= smoothstep(0.0, 0.035, bt) * (1.0 - smoothstep(0.72, 1.0, bt));",  // no hard lens ring, no hard mouth
          "  vec3 p = vBW * 0.55;",
          "  float dust = sin(p.x * 1.7 + uBeamTime * 0.35) * sin(p.y * 2.3 - uBeamTime * 0.23) * sin(p.z * 1.9 + uBeamTime * 0.29);",
          "  dust = 0.78 + 0.22 * dust + 0.08 * sin(p.x * 5.1 + p.z * 4.3 - uBeamTime * 0.6);",
          "  float nearCam = smoothstep(0.4, 5.0, camD);",                   // standing inside it is not a white sheet
          "  gl_FragColor.a *= soft * axial * dust * nearCam;",
          "}",
          "#include <tonemapping_fragment>",
        ].join("\n"));
  }
  function softBeamMaterial(color, opacity) {
    const m = new THREE.MeshBasicMaterial({
      color: color, transparent: true, opacity: opacity != null ? opacity : 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    m.onBeforeCompile = beamPatch;
    m.customProgramCacheKey = function () { return "cbz-soft-beam"; };
    return m;
  }

  // The pool cookie: a soft radial falloff with a faint lens pattern, drawn
  // once. Maps onto any CircleGeometry or PlaneGeometry (both span 0..1 UV).
  let poolTex = null;
  function poolTexture() {
    if (poolTex) return poolTex;
    const S = 128, c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    const img = g.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
      const r = Math.sqrt(u * u + v * v);
      let a = 0;
      if (r < 1) {
        const core = Math.exp(-r * r * 2.6);                               // the body of the spot
        const hot = Math.exp(-r * r * 14) * 0.35;                          // the filament hot spot
        const ring = 0.06 * Math.sin(r * 26) * Math.exp(-r * r * 3);        // faint reflector rings
        const edge = 1 - Math.pow(Math.max(0, (r - 0.55) / 0.45), 1.6);    // feathered to zero at r = 1
        a = Math.max(0, (core + hot + ring) * edge);
      }
      const i = (y * S + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = Math.min(255, Math.round(a * 255));
    }
    g.putImageData(img, 0, 0);
    poolTex = new THREE.CanvasTexture(c);
    poolTex.minFilter = THREE.LinearFilter;
    poolTex.generateMipmaps = false;
    return poolTex;
  }
  function softPoolMaterial(color, opacity) {
    return new THREE.MeshBasicMaterial({
      color: color, map: poolTexture(), transparent: true, opacity: opacity != null ? opacity : 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
  }

  // the glare on a lens you are looking into
  let glareTex = null;
  function glareTexture() {
    if (glareTex) return glareTex;
    const S = 64, c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, "rgba(255,250,235,1)");
    gr.addColorStop(0.12, "rgba(255,244,214,0.75)");
    gr.addColorStop(0.35, "rgba(255,236,190,0.18)");
    gr.addColorStop(1, "rgba(255,230,180,0)");
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    glareTex = new THREE.CanvasTexture(c);
    return glareTex;
  }

  CBZ.unitBeamGeometry = unitBeamGeometry;
  CBZ.softBeamMaterial = softBeamMaterial;
  CBZ.softPoolMaterial = softPoolMaterial;
  CBZ.softBeamTime = BEAM_TIME;

  /* ==========================================================
     2. THE LAMP
     ========================================================== */
  // where the lamp stands: on the tower's roof apex (world/prisonkit.js)
  const HY = CBZ.towerHeadY || 18;
  const COL = 0xfff3c0, HOT = 0xff6a55;
  const LENS_R = 0.3;
  const PIVOT = 0.62;                                 // trunnion height over the apex

  // shared parts, built once
  const P = {
    paint: CBZ.mat ? CBZ.mat(0x3b4148) : new THREE.MeshLambertMaterial({ color: 0x3b4148 }),
    dark: CBZ.mat ? CBZ.mat(0x23272c) : new THREE.MeshLambertMaterial({ color: 0x23272c }),
    steel: CBZ.mat ? CBZ.mat(0x8d949b) : new THREE.MeshLambertMaterial({ color: 0x8d949b }),
    pedestal: new THREE.CylinderGeometry(0.16, 0.22, 0.34, 14),
    turntable: new THREE.CylinderGeometry(0.3, 0.3, 0.07, 18),
    yokeBase: new THREE.BoxGeometry(0.86, 0.07, 0.2),
    yokeArm: new THREE.BoxGeometry(0.07, 0.5, 0.16),
    drum: new THREE.CylinderGeometry(0.36, 0.36, 0.56, 22, 1, true),
    rib: new THREE.TorusGeometry(0.365, 0.018, 6, 22),
    bezel: new THREE.TorusGeometry(0.335, 0.045, 8, 26),
    back: new THREE.CylinderGeometry(0.36, 0.2, 0.2, 22),
    backCap: new THREE.CylinderGeometry(0.2, 0.2, 0.02, 16),
    pin: new THREE.CylinderGeometry(0.06, 0.06, 0.12, 10),
    handle: new THREE.TorusGeometry(0.13, 0.016, 5, 12, Math.PI),
    lens: new THREE.CircleGeometry(LENS_R, 26),
  };

  // Parts are merged per material per moving group: a lamp is 8 draw calls,
  // not 25. `part(geo, px,py,pz, rx,ry,rz)` bakes a transform into a clone.
  const _m4 = new THREE.Matrix4(), _e = new THREE.Euler();
  function part(geo, px, py, pz, rx, ry, rz) {
    const g = geo.clone();
    _e.set(rx || 0, ry || 0, rz || 0);
    _m4.makeRotationFromEuler(_e).setPosition(px || 0, py || 0, pz || 0);
    g.applyMatrix4(_m4);
    return g;
  }
  function merged(list, mat) {
    const BGU = THREE.BufferGeometryUtils;
    const geo = BGU && BGU.mergeBufferGeometries ? BGU.mergeBufferGeometries(list, false) : list[0];
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    return m;
  }
  const GEO = {};
  function headGeometry() {
    if (GEO.done) return GEO;
    GEO.done = true;
    GEO.base = merged([part(P.pedestal, 0, 0.17, 0)], P.paint).geometry;
    GEO.yokePaint = merged([part(P.yokeBase, 0, 0.1, 0), part(P.yokeArm, -0.45, 0.33, 0), part(P.yokeArm, 0.45, 0.33, 0)], P.paint).geometry;
    GEO.yokeDark = P.turntable.clone().translate(0, 0.035, 0);
    GEO.drumPaint = merged([part(P.drum, 0, 0, 0.04, Math.PI / 2), part(P.back, 0, 0, -0.34, -Math.PI / 2)], P.paint).geometry;
    GEO.drumDark = merged([part(P.rib, 0, 0, -0.14), part(P.rib, 0, 0, 0.02), part(P.rib, 0, 0, 0.18),
      part(P.backCap, 0, 0, -0.445, Math.PI / 2)], P.dark).geometry;
    GEO.drumSteel = merged([part(P.pin, -0.4, 0, 0, 0, 0, Math.PI / 2), part(P.pin, 0.4, 0, 0, 0, 0, Math.PI / 2),
      part(P.bezel, 0, 0, 0.33), part(P.handle, 0, 0.36, -0.12, 0, Math.PI / 2)], P.steel).geometry;
    return GEO;
  }

  function buildHead(x, z) {
    const G = headGeometry();
    const base = new THREE.Group();
    base.position.set(x, HY, z);
    base.add(new THREE.Mesh(G.base, P.paint));
    // everything above the pedestal turns with the beam
    const yoke = new THREE.Group();
    yoke.position.y = 0.34;
    base.add(yoke);
    yoke.add(new THREE.Mesh(G.yokePaint, P.paint), new THREE.Mesh(G.yokeDark, P.dark));
    // the drum pitches on its trunnions; its beam axis is local +z
    const drum = new THREE.Group();
    drum.position.y = PIVOT - 0.34;
    yoke.add(drum);
    drum.add(new THREE.Mesh(G.drumPaint, P.paint), new THREE.Mesh(G.drumDark, P.dark), new THREE.Mesh(G.drumSteel, P.steel));
    // the lens: warm glass that glows when the lamp burns
    const lensMat = new THREE.MeshBasicMaterial({ color: 0x9a9480 });
    const lens = new THREE.Mesh(P.lens, lensMat);
    lens.position.z = 0.325;
    drum.add(lens);
    // glare, at the lens, drawn over the beam
    const glare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glareTexture(), color: COL, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    glare.position.set(0, 0, 0.36);
    glare.scale.set(3.2, 3.2, 1);
    glare.renderOrder = 4;
    drum.add(glare);
    // it turns: keep the static batcher off every piece
    base.traverse(function (o) { o.userData.mover = true; o.castShadow = false; });
    scene.add(base);
    return { base: base, yoke: yoke, drum: drum, lens: lens, lensMat: lensMat, glare: glare };
  }

  // the lamp stands on the finial of the tower at that post: the towers stand
  // back off the wall line (world/prisonkit.js section 5), so the post's
  // wall point is snapped to the nearest built tower's centre
  function towerAt(x, z) {
    let best = null, bd = 6;
    const T = CBZ.prisonTowers || [];
    for (let i = 0; i < T.length; i++) { const d = Math.hypot(T[i].x - x, T[i].z - z); if (d < bd) { bd = d; best = T[i]; } }
    return best;
  }
  function makeLight(towerX, towerZ, phase, sweep, sweepZ, sweepZAmp) {
    const T0 = towerAt(towerX, towerZ);
    if (T0) { towerX = T0.x; towerZ = T0.z; }
    const head = buildHead(towerX, towerZ);

    // a real spotlight for the glow (no shadow: keeps it cheap)
    const spot = new THREE.SpotLight(COL, 1.4, 60, 0.5, 0.5, 1.2);
    spot.position.set(towerX, HY + PIVOT, towerZ);
    const tgt = new THREE.Object3D();
    tgt.userData.mover = true;
    scene.add(tgt);
    spot.target = tgt;
    scene.add(spot);

    // the beam through the air
    const cone = new THREE.Mesh(unitBeamGeometry(0.07), softBeamMaterial(COL, 0));
    cone.userData.mover = true;
    cone.frustumCulled = false;                       // scaled every frame; its bounds are a unit cone
    cone.renderOrder = 3;
    scene.add(cone);

    // the soft cookie where it lands
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), softPoolMaterial(COL, 0));
    pool.userData.mover = true;
    pool.rotation.order = "YXZ";
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.06;
    pool.renderOrder = 2;
    scene.add(pool);

    const sl = {
      head: head.base, rig: head, spot, tgt, cone, pool, phase, sweep,
      sweepZ: sweepZ != null ? sweepZ : 28, sweepZAmp: sweepZAmp != null ? sweepZAmp : 16,
      gx: towerX, gz: towerZ, poolRadius: 5,
      target: new THREE.Vector3(),
      selfLit: true,                                  // core/daynight.js: this file drives its own gain
    };
    CBZ.searchlights.push(sl);
    MINE.push(sl);
    return sl;
  }
  /* THE TOWERS THIS FILE BUILT, and only those. CBZ.searchlights is a SHARED
     registry: src/games/military.js pushes its own beam records into it to
     reuse CBZ.litBySearchlight as a sensor, and those records carry a cone
     and a pool but no head and no sweep fields, because that package drives
     them itself. A driver drives what it BUILT; a sensor may still ask the
     whole registry (litBySearchlight does, defensively). */
  const MINE = [];

  // north exercise yard: two lights sweeping from opposite corners
  makeLight(-30, 52, 0, 18, 28, 16);
  makeLight(30, 52, Math.PI, 18, 28, 16);
  // south block: a wider pair sweeping the lower yard toward the gate
  makeLight(-44, 128, Math.PI / 2, 30, 92, 26);
  makeLight(44, 128, -Math.PI / 2, 30, 92, 26);

  /* ==========================================================
     3. THE SWEEP
     ========================================================== */
  const _pivot = new THREE.Vector3(), _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const _cam = new THREE.Vector3(), _toCam = new THREE.Vector3();
  function update(dt) {
    BEAM_TIME.value = (CBZ.now || 0) * 0.001;
    const night = CBZ.nightAmount != null ? CBZ.nightAmount : 1;
    const cam = CBZ.camera;
    if (cam) cam.getWorldPosition(_cam);
    for (const sl of MINE) {
      const out = sl.disabled > 0;
      if (out) sl.disabled = Math.max(0, sl.disabled - dt);

      // ground target tracks a slow sine sweep across the yard width
      const t = CBZ.now * 0.0006 + sl.phase;
      // (a staged shot or a scripted moment may pin the beam: sl.aimAt = {x, z})
      const tx = sl.aimAt ? sl.aimAt.x : Math.sin(t) * sl.sweep;
      const tz = sl.aimAt ? sl.aimAt.z : sl.sweepZ + Math.cos(t * 0.7) * sl.sweepZAmp;
      // a beam sweeping over a building lands on its ROOF, not on the floor
      // under it (world/roofs.js publishes every lid it laid)
      let ty = 0;
      const roofs = CBZ.prisonRoofs;
      if (roofs) for (let i = 0; i < roofs.length; i++) {
        const r = roofs[i];
        if (tx > r.x0 && tx < r.x1 && tz > r.z0 && tz < r.z1) { ty = Math.max(ty, r.top + (CBZ.prisonRoofT || 0.3)); }
      }
      sl._onRoof = ty > 0.5;
      sl.target.set(tx, ty, tz);
      sl.tgt.position.copy(sl.target);

      // AIM THE LAMP: yaw the yoke, pitch the drum
      const rig = sl.rig;
      _pivot.set(sl.gx, HY + PIVOT, sl.gz);
      _dir.copy(sl.target).sub(_pivot);
      const len = _dir.length();
      _dir.multiplyScalar(1 / len);
      const horiz = Math.sqrt(_dir.x * _dir.x + _dir.z * _dir.z);
      rig.yoke.rotation.y = Math.atan2(_dir.x, _dir.z);
      rig.drum.rotation.x = Math.atan2(-_dir.y, horiz);
      rig.base.updateMatrixWorld(true);

      // the beam leaves the lens, not the pivot
      const ox = _pivot.x + _dir.x * 0.34, oy = _pivot.y + _dir.y * 0.34, oz = _pivot.z + _dir.z * 0.34;
      const R = sl.poolRadius;
      const beamLen = Math.max(1, len - 0.34);
      sl.cone.position.set(ox, oy, oz);
      sl.cone.quaternion.setFromUnitVectors(_up, _dir);
      sl.cone.scale.set(R, beamLen, R);
      sl.cone.updateMatrixWorld();
      sl.spot.position.set(ox, oy, oz);

      // the pool: a slanted spot throws an ellipse, long along the beam
      const sinE = Math.max(0.3, -_dir.y);
      sl.pool.position.set(tx, ty + 0.06, tz);
      sl.pool.rotation.y = Math.atan2(_dir.x, _dir.z);
      sl.pool.scale.set(R * 1.25, Math.min(2.6, 1 / sinE) * R * 1.25, 1);
      sl.pool.updateMatrixWorld();

      // ---- caught-in-the-beam feedback (JAIL_SEARCHLIGHT_DETECT) ----
      // the beam that's actually holding the player flushes red and throbs;
      // systems/detection.js applies the matching heat + guard pings.
      let hot = false;
      if (CBZ.CONFIG && CBZ.CONFIG.JAIL_SEARCHLIGHT_DETECT && !out &&
          CBZ.game.mode === "escape" && CBZ.game.state === "playing" &&
          CBZ.player && CBZ.player.pos && !sl._onRoof) {
        const pdx = CBZ.player.pos.x - tx, pdz = CBZ.player.pos.z - tz;
        const pr = R * (CBZ.player.crouch ? 0.6 : 1.0);
        hot = pdx * pdx + pdz * pdz < pr * pr;
      }
      if (hot !== !!sl._hot) {
        sl._hot = hot;
        const col = hot ? HOT : COL;                  // per-light materials, safe to tint
        sl.cone.material.color.setHex(col);
        sl.pool.material.color.setHex(col);
      }

      // GAIN: a real searchlight beam is a night thing; by day the air
      // shows almost nothing and the pool is a faint warm patch.
      const gain = out ? 0.08 : 1;
      const throb = hot ? 1.25 + 0.2 * Math.sin(CBZ.now * 0.02) : 1;
      sl.spot.intensity = out ? 0.15 : 0.4 + night * 1.8;
      sl.cone.material.opacity = gain * throb * (0.03 + night * 0.42);
      sl.pool.material.opacity = gain * throb * (0.08 + night * 0.5);
      // the lens burns at night; by day it is glass
      const lit = out ? 0.1 : 0.25 + night * 0.75;
      rig.lensMat.color.setRGB(0.6 + 0.4 * lit, 0.58 + 0.4 * lit, 0.5 + 0.4 * lit);
      // glare: only when you look up the beam at the lamp
      let g = 0;
      if (cam && !out) {
        _toCam.copy(_cam).sub(_pivot);
        const dc = _toCam.length();
        const align = dc > 0 ? _toCam.dot(_dir) / dc : 0;
        g = Math.pow(Math.max(0, align), 6) * (0.25 + night * 0.75);
        const sz = 2.4 + 5 * Math.pow(Math.max(0, align), 12) * night;
        rig.glare.scale.set(sz, sz, 1);
      }
      rig.glare.material.opacity = g;
      rig.glare.visible = g > 0.01;
    }
  }

  // detection query: is this position inside any searchlight pool?
  CBZ.litBySearchlight = function (pos, crouch) {
    for (const sl of CBZ.searchlights) {
      if (!sl || !sl.pool || sl.disabled > 0 || sl._onRoof) continue;   // a foreign record may carry neither; a roof shelters
      const dx = pos.x - sl.pool.position.x;
      const dz = pos.z - sl.pool.position.z;
      // crouching effectively shrinks how far into the pool you can be caught
      const r = sl.poolRadius * (crouch ? 0.6 : 1.0);
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  };

  CBZ.searchlightTick = update;     // re-aim now (a staged shot sets sl.aimAt, then ticks)

  CBZ.onUpdate(21, function (dt) {
    if (CBZ.game.mode === "escape") update(dt);
  });
  // keep them sweeping on the title screen too, for atmosphere
  CBZ.onAlways(7, function (dt) {
    if (CBZ.game.mode === "escape" && CBZ.game.state !== "playing") update(dt);
  });
  });
})();
