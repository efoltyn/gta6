/* ============================================================
   core/sight.js — WHAT THE CAMERA CAN SEE. One rule for every spawner.

   Owner, 2026-10-11 (iPad, helicopter): "The forest spawns in view, but
   cities don't. I don't like things spawning in view, it's very dumb. You
   can see the bare ground, and then the trees spawn in." And: "this is not
   just the forest, it's a deeper problem with the game logic."

   THE DEEPER PROBLEM. Every system that decided "is this far enough away
   to not exist yet" kept its OWN answer: the streamer a ring of ground fog
   around the player's feet, the backcountry forest a 3.5 km disc, Redhollow
   a 420 m band around the biome centre, farcull the player's position, the
   phone reach pass 1.8x fog below 250 m. None of them knew that the fog
   opens from ~760 m to 4-11 km the moment the eye leaves the ground
   (city/mode.js), so from a helicopter they were all inside the picture.

   THE RULE. There are exactly two distances, both measured from the EYE
   (the camera, not the body: a chase cam, a heli boom or a photo lens is
   where the picture is taken from):

     far     where the scene fog closes for this eye. Ground: the quality
             tier's city fog (CBZ.cityFogFar). Airborne: grows with the eye's
             height, 4200 m skimming roofs to 11 km at 760 m and up (the
             formula moved here from city/mode.js, which now reads it). This
             is the horizon. ANYTHING inside it must already exist, in some
             form that looks like itself.
     detail  how far the full-detail form is kept: the ground fog's end
             (+36 m for its soft edge and the camera boom). On the ground it
             equals `far`, so nothing changes form inside view. In the air,
             `far` outruns it, and whatever stands between the two must be
             drawn by a FAR FORM of the same thing (metro HLOD tiles, which
             carry the far copy of every building in the world, the
             forest's far crowns) that crossfades to the near form at
             `detail`.

   A system asks:
     CBZ.sight()                     -> { far, near, detail, reach, camFar,
                                          airborne, x, y, z (eye), px, pz
                                          (player), eyeOff }
     CBZ.sightSees(x, z, r)          could a thing of radius r at x,z still be
                                     a pixel short of full fog (within reach)?
     CBZ.sightNeedsDetail(x, z, r)   ... inside detail?
     CBZ.sightFade(mat, which, opts) the dithered near/far crossfade (below)
     CBZ.sightAhead(T)               where the body will be after T s of
                                     travel (streamers build there first)
     CBZ.sightU                      the shared fade uniforms, refreshed every
                                     frame by CBZ.sightPublish().

   Loads right after core/slice.js (THREE is in by then); touches nothing at
   load. Gang City only: the other modes own their fog.
============================================================ */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const THREE = window.THREE;

  // ground fog the quality tier pays for (core/quality.js publishes it)
  function groundFar() { const f = +CBZ.cityFogFar; return f > 0 ? f : 1000; }

  // the fog for an eye at height eyeY (see the derivation that used to live
  // in city/mode.js: Koschmieder haze carries the kilometres, THREE.Fog only
  // closes the world where real air has finished it)
  function airFar(eyeY) {
    const t = Math.max(0, Math.min(1, (eyeY - 60) / 700));
    return 4200 + 6800 * t * t * (3 - 2 * t);
  }
  CBZ.sightAirFar = airFar;

  const S = { far: 1000, near: 160, detail: 1036, reach: 1400, camFar: 1400, airborne: false, x: 0, y: 0, z: 0, px: 0, pz: 0, eyeOff: 0 };

  CBZ.sight = function () {
    const cam = CBZ.camera, P = CBZ.player, pos = P && P.pos;
    const ex = cam ? cam.position.x : (pos ? pos.x : 0);
    const ey = cam ? cam.position.y : (pos ? pos.y : 0);
    const ez = cam ? cam.position.z : (pos ? pos.z : 0);
    S.x = ex; S.y = ey; S.z = ez;
    S.px = pos ? pos.x : ex; S.pz = pos ? pos.z : ez;
    S.eyeOff = Math.hypot(ex - S.px, ez - S.pz);
    // AIRBORNE IS AN ALTITUDE, NOT A VEHICLE: a plane, a heli, a chute, a
    // freefall, or a lens hung far above a body on the ground
    const chuting = !!(CBZ.cityChuteState && CBZ.cityChuteState());
    const highUp = !!(pos && pos.y > 24 && !P.grounded);
    const lifted = !!(pos && cam && cam.position.y - pos.y > 60);
    S.airborne = !!(pos && ((pos.y > 24 && (P._aircraft || chuting || highUp)) || lifted));
    const g = groundFar();
    const eyeY = Math.max(ey, pos ? pos.y : 0);
    S.far = S.airborne ? Math.max(g, airFar(eyeY)) : g;
    S.near = Math.max(90, Math.round(S.far * 0.16));
    S.detail = g + 36;
    // THE FOG IS PLANAR, A DISTANCE TEST IS RADIAL. r128 fogs by view depth
    // (-mvPosition.z), so a thing in the corner of the frame is as hazy as
    // its depth, not its range: it reaches `far` depth at far / cos(the
    // half-diagonal of the lens). `reach` is that range: the farthest a pixel
    // still short of full fog can stand. Drop-past tests use it.
    let k = 1.4;
    if (cam && cam.isPerspectiveCamera) {
      const tv = Math.tan((cam.fov || 60) * Math.PI / 360), th = tv * (cam.aspect || 1.5);
      k = Math.sqrt(1 + tv * tv + th * th);
    }
    // A raised eye (a roof, a hill road) also thins the height fog along the
    // line of sight (core/renderer.js cbzHaze), so past `far` a pool keeps a
    // trace of contrast that grows with the eye's height: 2 m of range per
    // metre of eye height (the phone reach pass's measured margin).
    S.reach = S.far * k + Math.max(0, ey) * 2;
    // distant landmarks / metro HLOD may ask for projection room past the fog
    const landmarkFar = Math.max(CBZ.cityDistantLandmarkFar || 0, CBZ.metroViewFar || 0);
    S.camFar = S.airborne ? Math.max(7000, S.far + 900, landmarkFar) : Math.max(1400, S.far + 180, landmarkFar);
    return S;
  };

  // nearest horizontal distance from the eye to a disc
  function eyeDist(x, z, r) { return Math.hypot(x - S.x, z - S.z) - (r || 0); }
  CBZ.sightSees = function (x, z, r) { CBZ.sight(); return eyeDist(x, z, r) < S.reach; };
  CBZ.sightNeedsDetail = function (x, z, r) { CBZ.sight(); return eyeDist(x, z, r) < S.detail; };

  /* ---- how far a thing of `size` metres is still a pixel ----------------
     size x (drawing-buffer height / (2 tan(fov/2))). Street hardware sizes
     its draw range by this. */
  CBZ.sightPixelRange = function (size) {
    let k = 1000;
    const cam = CBZ.camera, cv = CBZ.renderer && CBZ.renderer.domElement;
    if (cam && cam.isPerspectiveCamera && cv && cv.height > 0) k = cv.height / (2 * Math.tan((cam.fov || 60) * Math.PI / 360));
    return size * k;
  };

  /* ---- could the camera see a thing there right now? --------------------
     For anything that is about to appear, vanish or be moved (a recycled
     car, a despawned group): inside the eye's reach AND on a padded screen
     (the frame plus a margin for the turn the next half second makes).
     Occlusion is not asked: a wall the camera might clear next frame is no
     licence to pop something behind it. y defaults to 1 m over the ground
     at the eye's height. */
  const _sv = THREE ? new THREE.Vector3() : null;
  CBZ.sightCanSee = function (x, y, z, r) {
    CBZ.sight();
    if (eyeDist(x, z, r || 0) > S.reach) return false;
    const cam = CBZ.camera;
    if (!cam || !_sv || !cam.projectionMatrix || !cam.matrixWorldInverse) return true;
    _sv.set(x, y == null ? (CBZ.player && CBZ.player.pos ? CBZ.player.pos.y + 1 : 1) : y, z).project(cam);
    return _sv.z >= -1.05 && _sv.z <= 1.05 && Math.abs(_sv.x) <= 1.3 && Math.abs(_sv.y) <= 1.4;
  };

  /* ---- THE CROSSFADE: every near/far hand-over is a dithered fade ------
     Owner + research (2026-10-12): "every near/far switch is a CROSSFADE,
     never a hard cut". A far form and a near form of the same thing both
     cover a place; across a BAND (30 m) round the swap distance each pixel
     is drawn by exactly one of them, chosen by a 4x4 ordered (Bayer)
     threshold on the screen: the near form keeps a pixel where the fade t
     is under the threshold, the far form where it is at or over it, so the
     two are complementary (no hole, no double) and the share moves smoothly
     from all-near to all-far across the band. A discard in the fragment
     shader through onBeforeCompile: r128, WebGL1, phones.

       t = clamp((distance from the eye - (swap - band/2)) / band, 0, 1)
       t = max(t, 1 - ready)          ready: is the near form there? (0..1)

     READY is the time half of the fade. A far form whose near form has not
     loaded yet has ready 0: it draws everywhere, up to the camera, so a
     thing still loading is shown as ITS OWN simplified copy, never as
     nothing. When the near form arrives its owner ramps ready to 1 over half
     a second and the two dissolve into each other; when it leaves, ready
     drops to 0 at once (the far form is whole the same frame).

     CBZ.sightFade(mat, which, opts)   which "near" | "far"; opts:
       anchor   "world" (each pixel by its own ground position: a big merged
                tile), "instance" (each instance by its root: a scatter) or
                "object" (each mesh by its origin). Default "world".
       swap     a uniform {value} with the swap distance (metres from the
                eye); default the shared `detail` ring (CBZ.sightU.cbzSightSwap)
       ready    a uniform {value} 0..1 for this material (default 1)
       readyMap { map: uniform(texture), size: uniform(vec2), attr } a per-
                building ready read from a texture by a vertex attribute id
                (r = ready, g > 0.5 = gone: never drawn). city/metro.js's far
                form of the built world uses it.
       cover    true: the far form wins the depth test against a coplanar
                near form (polygon offset), so it can dissolve OVER a near
                form that is not itself dithered (a building shell is a
                hundred materials; its far copy is one).
     CBZ.sightSwapMaterial(mat, which) = sightFade(mat, which, {anchor:
     "instance"}): the per-instance scatter hand-over (trees).
     CBZ.sightFadeT(d, swap) is the same t on the CPU, and
     CBZ.SIGHT_FADE_BAND the band, for owners deciding what to draw. */
  const BAND = 30;
  CBZ.SIGHT_FADE_BAND = BAND;
  const U = CBZ.sightU = {
    cbzSightEye: { value: THREE ? new THREE.Vector3() : { x: 0, y: 0, z: 0 } },
    cbzSightSwap: { value: 1036 },
    cbzSightBand: { value: BAND },
  };
  const ONE = { value: 1 };
  CBZ.sightFadeT = function (d, swap) {
    const s = swap == null ? S.detail : swap;
    return Math.max(0, Math.min(1, (d - (s - BAND / 2)) / BAND));
  };

  /* ---- WHERE THE BODY IS GOING (streaming ahead) ------------------------
     The body's ground velocity, measured on GAME time (dt clamped like the
     game's: a phone at 20 fps moving a car at 30 m/s reads 30 m/s), smoothed
     over ~half a second; a jump of more than 400 m (a teleport) resets it.
     CBZ.sightAhead(T) -> { x, z, lead, hx, hz, speed }: where the body will
     be after T seconds of travel, capped (450 m on the ground, 2 km in the
     air: a plane at 200 m/s). Every streamer reads this one answer. */
  const MV = { t: 0, wall: 0, x: 0, z: 0, at: 0, has: false };
  S.vx = 0; S.vz = 0; S.speed = 0; S.hx = 0; S.hz = 0;
  function track() {
    const P = CBZ.player, pos = P && P.pos;
    if (!pos) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const step = MV.wall ? Math.min(0.05, Math.max(0, (now - MV.wall) / 1000)) : 0;
    MV.wall = now; MV.t += step;
    if (!MV.has) { MV.has = true; MV.x = pos.x; MV.z = pos.z; MV.at = MV.t; return; }
    const dt = MV.t - MV.at;
    if (dt < 0.1) return;
    const dx = pos.x - MV.x, dz = pos.z - MV.z, d = Math.hypot(dx, dz);
    MV.x = pos.x; MV.z = pos.z; MV.at = MV.t;
    if (d > 400) { S.vx = S.vz = S.speed = 0; return; }
    const k = Math.min(1, dt / 0.5);
    S.vx += (dx / dt - S.vx) * k; S.vz += (dz / dt - S.vz) * k;
    S.speed = Math.hypot(S.vx, S.vz);
    if (S.speed > 0.5) { S.hx = S.vx / S.speed; S.hz = S.vz / S.speed; }
  }
  const AHEAD = { x: 0, z: 0, lead: 0, hx: 0, hz: 0, speed: 0 };
  CBZ.sightAhead = function (T) {
    const lead = S.speed > 3 ? Math.min(S.airborne ? 2000 : 450, S.speed * (T == null ? 6 : T)) : 0;
    AHEAD.hx = S.hx; AHEAD.hz = S.hz; AHEAD.speed = S.speed; AHEAD.lead = lead;
    AHEAD.x = S.px + S.hx * lead; AHEAD.z = S.pz + S.hz * lead;
    return AHEAD;
  };

  CBZ.sightPublish = function () {
    CBZ.sight();
    track();
    const e = U.cbzSightEye.value;
    if (e.set) e.set(S.x, S.y, S.z); else { e.x = S.x; e.y = S.y; e.z = S.z; }
    U.cbzSightSwap.value = S.detail;
    return S;
  };

  // 4x4 ordered dither, 16 levels in [0, 1) (no arrays: GLSL ES 1.0)
  const GLSL_BAYER = [
    "float cbzBayer2( vec2 a ) { a = floor( a ); return fract( a.x * 0.5 + a.y * a.y * 0.75 ); }",
    "float cbzBayer4( vec2 a ) { return cbzBayer2( 0.5 * a ) * 0.25 + cbzBayer2( a ); }",
  ].join("\n");
  CBZ.sightFade = function (mat, which, o) {
    if (!mat || (mat.userData && mat.userData._cbzSightFade)) return mat;
    o = o || {};
    const far = which === "far";
    const anchor = o.anchor === "instance" || o.anchor === "object" ? o.anchor : "world";
    const swapU = o.swap || U.cbzSightSwap, readyU = o.ready || ONE;
    const RM = o.readyMap && o.readyMap.map ? o.readyMap : null;
    const idAttr = RM ? (RM.attr || "aFarId") : null;
    mat.userData = mat.userData || {};
    mat.userData._cbzSightFade = which;
    if (far && o.cover) {
      // the far form wins a tie with the near form it stands over
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = Math.min(mat.polygonOffsetFactor || 0, -1);
      mat.polygonOffsetUnits = Math.min(mat.polygonOffsetUnits || 0, -4);
    }
    const tag = "|fade-" + which + "-" + anchor + (RM ? "-rm" : "");
    // r128's default key is this.onBeforeCompile.toString(), which after the
    // wrap below is the same text for every faded material: key on the
    // material's own key, else on the hook it had before (two materials with
    // different hooks must never share a program)
    const prev = mat.onBeforeCompile;
    const ownKey = Object.prototype.hasOwnProperty.call(mat, "customProgramCacheKey") ? mat.customProgramCacheKey : null;
    const prevSrc = prev ? String(prev) : "";
    mat.customProgramCacheKey = function () { return (ownKey ? ownKey.call(this) : prevSrc) + tag; };
    mat.onBeforeCompile = function (sh, r) {
      if (prev) prev.call(this, sh, r);
      if (sh.vertexShader.indexOf("#include <project_vertex>") < 0 || sh.fragmentShader.indexOf("#include <clipping_planes_fragment>") < 0) return;
      sh.uniforms.cbzSightEye = U.cbzSightEye;
      sh.uniforms.cbzSightBand = U.cbzSightBand;
      sh.uniforms.cbzFadeSwap = swapU;
      sh.uniforms.cbzFadeReady = readyU;
      if (RM) { sh.uniforms.cbzReadyMap = RM.map; sh.uniforms.cbzReadySize = RM.size; }
      const head = "uniform vec3 cbzSightEye;\nuniform float cbzSightBand;\nuniform float cbzFadeSwap;\nuniform float cbzFadeReady;\n";
      const fadeOf = function (d) {
        return "max( clamp( ( " + d + " - ( cbzFadeSwap - 0.5 * cbzSightBand ) ) / cbzSightBand, 0.0, 1.0 ), 1.0 - cbzFadeReady )";
      };
      let vHead = head, vBody = "";
      if (anchor === "world") {
        vHead += "varying vec2 vCbzW;\n";
        vBody =
          "#ifdef USE_INSTANCING\n" +
          "  vCbzW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xz;\n" +
          "#else\n" +
          "  vCbzW = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;\n" +
          "#endif\n";
      } else {
        vHead += "varying float vCbzT;\n";
        vBody =
          (anchor === "instance" ? "#ifdef USE_INSTANCING\n  vec2 cbzRoot = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz;\n#else\n" : "") +
          "  vec2 cbzRoot = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xz;\n" +
          (anchor === "instance" ? "#endif\n" : "") +
          "  vCbzT = " + fadeOf("length( cbzRoot - cbzSightEye.xz )") + ";\n" +
          // wholly the other form's: not even a vertex of it
          (far ? "  if ( vCbzT <= 0.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );\n"
               : "  if ( vCbzT >= 1.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );\n");
      }
      if (RM) { vHead += "attribute float " + idAttr + ";\nvarying float vCbzId;\n"; vBody += "  vCbzId = " + idAttr + ";\n"; }
      sh.vertexShader = vHead + sh.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n" + vBody);
      let fHead = head + GLSL_BAYER + "\n" + (anchor === "world" ? "varying vec2 vCbzW;\n" : "varying float vCbzT;\n");
      let fBody = "{\n  float cbzT = " + (anchor === "world" ? fadeOf("length( vCbzW - cbzSightEye.xz )") : "vCbzT") + ";\n";
      if (RM) {
        fHead += "uniform sampler2D cbzReadyMap;\nuniform vec2 cbzReadySize;\nvarying float vCbzId;\n";
        fBody +=
          "  float cbzI = floor( vCbzId + 0.5 );\n" +
          "  vec4 cbzR = texture2D( cbzReadyMap, vec2( ( mod( cbzI, cbzReadySize.x ) + 0.5 ) / cbzReadySize.x, ( floor( cbzI / cbzReadySize.x ) + 0.5 ) / cbzReadySize.y ) );\n" +
          "  if ( cbzR.g > 0.5 ) discard;\n" +
          "  cbzT = max( cbzT, 1.0 - cbzR.r );\n";
      }
      fBody += "  float cbzThr = cbzBayer4( gl_FragCoord.xy ) + 0.03125;\n" +
        (far ? "  if ( cbzT < cbzThr ) discard;\n" : "  if ( cbzT >= cbzThr ) discard;\n") + "}\n";
      sh.fragmentShader = fHead + sh.fragmentShader.replace("#include <clipping_planes_fragment>", fBody + "#include <clipping_planes_fragment>");
    };
    mat.needsUpdate = true;
    return mat;
  };
  // the per-instance scatter hand-over (world/vegetation.js lodMaterial)
  CBZ.sightSwapMaterial = function (mat, which) { return CBZ.sightFade(mat, which, { anchor: "instance" }); };
})();
