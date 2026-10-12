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
             drawn by a FAR FORM of the same thing (metro HLOD tiles, the
             farcull lot boxes; trees: world/treelod.js's mid copies and
             impostors) that hands over to the near form.

   A system asks:
     CBZ.sight()                     -> { far, near, detail, reach, camFar,
                                          airborne, x, y, z (eye), px, pz
                                          (player), eyeOff }
     CBZ.sightSees(x, z, r)          could a thing of radius r at x,z still be
                                     a pixel short of full fog (within reach)?
     CBZ.sightNeedsDetail(x, z, r)   ... inside detail?
     CBZ.sightU                      shared shader uniform { cbzSightEye }: the
                                     eye, for per-instance distance work in a
                                     shader (world/treelod.js's crossfades),
                                     refreshed every frame by sightPublish().

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

  /* ---- the eye, for shaders (world/treelod.js) ---------------------- */
  const U = CBZ.sightU = {
    cbzSightEye: { value: THREE ? new THREE.Vector3() : { x: 0, y: 0, z: 0 } },
  };
  CBZ.sightPublish = function () {
    CBZ.sight();
    const e = U.cbzSightEye.value;
    if (e.set) e.set(S.x, S.y, S.z); else { e.x = S.x; e.y = S.y; e.z = S.z; }
    return S;
  };
})();
