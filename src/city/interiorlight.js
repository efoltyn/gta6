/* ============================================================
   city/interiorlight.js — INTERIOR READABILITY behind glass.

   THE PROBLEM (why this file exists):
     buildings.js makes windows shatter and even carves walkable openings, and
     it tints ~15% of panes "lit" warm at dusk (cityGlassNight). But the ROOM
     BEHIND the glass is just the solid wall box — so a broken/clear window
     reads as a flat black void by day and a dead hole at night. A real city
     reads INHABITED: by day you glimpse a dim room, after dusk a warm glow.

   THE TECHNIQUE (cheap, no per-room lights — we are DRAW-CALL BOUND):
     Games fake interiors-through-glass without real lights. The heavy version
     is parallax "interior mapping" (Forza Horizon 4's window shader, Joost van
     Dongen's paper) — baked cubemap interiors that cost nothing at runtime but
     need a custom shader. We don't need parallax depth here; the windows are
     small and seen in passing from the street. The lightweight, well-worn
     trick is an EMISSIVE / UNLIT interior plane: a flat panel set just behind
     the opening that is visible regardless of scene lighting (so the room
     never goes pure black in daylight), with an emissive term that ramps up at
     night so the window GLOWS warm after dusk — the same idea as an emissive
     "fill" plane used for window light, minus any real light cast.

   HOW WE STAY CHEAP:
     • Geometry: ONE shared 1x1 plane, instanced into a few pooled InstancedMesh
       layers (one per material variant). Each window = a couple of instances,
       not a couple of meshes. Net cost ≈ a handful of draw calls for the WHOLE
       city, independent of window count.
     • Materials: a tiny fixed set of SHARED MeshBasicMaterial (unlit — never
       touched by the sun pass, never casts/receives shadow). The day/night
       ramp is a FEW writes to those shared materials per update, not per
       window. MeshBasicMaterial has no .emissive, so "emissive" here = we lerp
       the basic material's color from a dim daytime room tone up to a warm lit
       tone, and raise opacity — visually identical to an emissive glow for an
       unlit panel, and cheaper.
     • Update: throttled to a few Hz, gated to city mode, capped instance count.

   PUBLIC API (integrator/buildings.js wires the calls — we assume nothing):
     CBZ.cityInteriorGlow(parent, x,y,z, w,h, faceNormal, opts)
        Add a readability layer for an opening of size w×h centered at world
        (x,y,z) whose wall faces outward along faceNormal (a THREE.Vector3 or
        {x,z}). Pushed slightly INSIDE the wall so it reads as the room behind.
        opts: { lit:bool (this window glows at night, else stays dim),
                warm:0..1 (hue, 0=cool/white room .. 1=warm lamp),
                inset:meters behind the plane (default 0.18),
                pool:bool (default true; false = own material, rare) }
        Returns a small handle (or null if capped) — currently informational.
     CBZ.cityInteriorGlowReset()  — drop all layers (new run / island rebuild).

   It COMPLEMENTS buildings.js's pane tint (cityGlassNight): theirs is the
   GLASS, ours is the ROOM seen through it. We read CBZ.nightAmount on the same
   dusk curve so the whole night look lands together.
   ============================================================ */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  var CBZ = window.CBZ = window.CBZ || {};
  // Three may load after us in some include orders; defer anything that needs
  // it. The plane geometry + materials are lazy-built on first cityInteriorGlow.
  var THREE = window.THREE;

  // ---- tunables ------------------------------------------------------------
  var MAX_INSTANCES = 1400;   // hard cap across all layers (≈700 windows × 2)
  var DEFAULT_INSET = 0.18;   // metres the panel sits behind the opening plane
  var CULL_NONE = 0;          // we let the GPU frustum-cull the instanced mesh

  // SHARED look tables. Two material "rooms": a COOL/neutral room and a WARM
  // (lamp/incandescent) room. Each is one MeshBasicMaterial, unlit. We animate
  // its color (dim-day → glow-night) and opacity by CBZ.nightAmount. The
  // material's color MULTIPLIES the shared ROOM-DEPTH gradient texture (see
  // makeRoomTexture) — so every panel already carries floor/back-wall/ceiling
  // contrast and reads as a real room with depth, not a flat tinted panel.
  //
  // WHY THESE NUMBERS (the fix): the old DAY tones (~0.10 RGB, 0.62 opacity)
  // were so dim a clear pane over them read as "the colour of the building" —
  // the exact complaint. Research (arch-viz fake interiors, fake-interior
  // shaders) is unanimous: the plane must be SELF-LUMINOUS, noticeably brighter
  // than a shadowed wall, and carry an internal gradient so the eye reads DEPTH.
  // So the daytime room is now a clearly-lit shaded interior (mid-grey, ~0.95
  // opaque so it OCCLUDES the void behind and you plainly see a room), still a
  // touch below the sunlit facade so it never glows unnaturally in daylight.
  // Because the gradient texture darkens the ceiling band and brightens the
  // floor/back-wall on its own, the flat color can be relatively bright without
  // looking like a glowing solid box.
  var DAY = {
    cool: { r: 0.52, g: 0.56, b: 0.62, o: 0.96 },  // bright shadowed grey room
    warm: { r: 0.60, g: 0.54, b: 0.46, o: 0.96 }   // bright warm-toned room
  };
  var NIGHT = {
    cool: { r: 0.62, g: 0.70, b: 0.88, o: 0.97 },  // cool TV/fluorescent glow
    warm: { r: 1.00, g: 0.74, b: 0.42, o: 0.97 }   // warm lamp glow
  };
  // Windows flagged lit:false never glow — they stay at the DAY dim level even
  // at night (vacant/dark room). They use the same shared materials but their
  // night ramp factor is forced to 0 by routing them to a "dark" layer.

  // ---- state ---------------------------------------------------------------
  var built = false;
  var geo = null;                 // shared 1x1 XY plane
  var mats = null;                // { coolLit, warmLit, coolDark, warmDark }
  var layers = null;              // matching InstancedMesh, by same keys
  var counts = null;              // live instance count per layer
  var total = 0;                  // grand total across layers
  var _m = null, _q = null, _v = null, _e = null, _up = null; // scratch (reused)
  var nightApplied = -1;          // last night value we wrote (skip no-op writes)

  function ensureThree() { if (!THREE) THREE = window.THREE; return !!THREE; }

  // ---- ROOM-DEPTH texture --------------------------------------------------
  // ONE shared CanvasTexture, ~white so the material color tints it cleanly.
  // It is a vertical gradient that fakes a room with DEPTH on a flat plane —
  // the standard arch-viz / fake-interior trick: the eye reads the gradient as
  // ceiling → back wall → floor receding in shadow. Painted purely in greys
  // (luminance), so the day/night material color sets the hue/brightness and
  // this only supplies the internal light/shadow STRUCTURE. Built once.
  //   • top band  : CEILING — darkest (in shadow, no window light reaches it)
  //   • upper-mid : where daylight from the window grazes the back wall — bright
  //   • mid→lower : BACK WALL falling into shadow with depth — mid greys
  //   • bottom    : FLOOR catching the most window light — brightest, with a
  //                 soft warm pool, then a thin dark skirting line at the base.
  // A faint vertical seam down the centre hints at a back corner so two side
  // walls are implied — enough parallax-free depth cue to never read as flat.
  var _roomTex = null;
  function makeRoomTexture() {
    if (_roomTex) return _roomTex;
    var cv = document.createElement("canvas");
    cv.width = 64; cv.height = 128;            // tall: top=ceiling, bottom=floor
    var g = cv.getContext("2d");
    // base vertical gradient: dark ceiling → lit back wall → bright floor.
    var grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0.00, "#3a3a3a");        // ceiling: in shadow
    grad.addColorStop(0.10, "#5a5a5a");        // ceiling/wall corner
    grad.addColorStop(0.34, "#9a9a9a");        // upper back wall: catches light
    grad.addColorStop(0.60, "#6e6e6e");        // back wall recedes into shadow
    grad.addColorStop(0.82, "#b6b6b6");        // floor near wall: lit
    grad.addColorStop(0.96, "#d8d8d8");        // foreground floor: brightest
    grad.addColorStop(1.00, "#454545");        // skirting / front sill shadow
    g.fillStyle = grad; g.fillRect(0, 0, 64, 128);
    // soft floor light-pool (radial, lower-centre) — a believable lit spot.
    var rg = g.createRadialGradient(32, 104, 4, 32, 104, 40);
    rg.addColorStop(0, "rgba(255,255,255,0.30)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = rg; g.fillRect(0, 64, 64, 64);
    // faint back-corner seam (implies two side walls meeting) — subtle.
    g.fillStyle = "rgba(0,0,0,0.10)";
    g.fillRect(31, 18, 2, 84);
    // very soft side vignette so edges fall to shadow (side walls in gloom).
    var sg = g.createLinearGradient(0, 0, 64, 0);
    sg.addColorStop(0.00, "rgba(0,0,0,0.28)");
    sg.addColorStop(0.18, "rgba(0,0,0,0)");
    sg.addColorStop(0.82, "rgba(0,0,0,0)");
    sg.addColorStop(1.00, "rgba(0,0,0,0.28)");
    g.fillStyle = sg; g.fillRect(0, 0, 64, 128);
    _roomTex = new THREE.CanvasTexture(cv);
    _roomTex.wrapS = _roomTex.wrapT = THREE.ClampToEdgeWrapping;
    if (THREE.sRGBEncoding != null) _roomTex.encoding = THREE.sRGBEncoding;
    _roomTex.minFilter = THREE.LinearFilter;   // no mipmaps needed (small, seen near)
    _roomTex.generateMipmaps = false;
    return _roomTex;
  }

  function build() {
    if (built || !ensureThree()) return built;
    // ONE plane, faces +Z by default; we orient per-instance via the matrix.
    geo = new THREE.PlaneGeometry(1, 1);
    var roomTex = makeRoomTexture();
    // unlit, double-sided so it reads from a slight angle through the opening,
    // depthWrite OFF so it never z-fights the pane and stays behind the glass.
    // The shared ROOM-DEPTH texture supplies floor/wall/ceiling contrast; the
    // material color tints it day→night.
    function mk() {
      return new THREE.MeshBasicMaterial({
        color: 0x808080, map: roomTex, transparent: true, opacity: 0.96,
        depthWrite: false, side: THREE.DoubleSide, fog: true
      });
    }
    mats = { coolLit: mk(), warmLit: mk(), coolDark: mk(), warmDark: mk() };
    layers = {};
    counts = {};
    Object.keys(mats).forEach(function (k) {
      var im = new THREE.InstancedMesh(geo, mats[k], MAX_INSTANCES);
      im.count = 0;                       // grow as windows register
      im.castShadow = false; im.receiveShadow = false;  // unlit, off the sun pass
      im.frustumCulled = true;            // big bounding sphere; still cheap
      im.renderOrder = -1;                // draw before glass panes
      im.name = "cityInteriorGlow_" + k;
      layers[k] = im;
      counts[k] = 0;
    });
    _m = new THREE.Matrix4();
    _q = new THREE.Quaternion();
    _v = new THREE.Vector3();
    _e = new THREE.Vector3();
    _up = new THREE.Vector3(0, 1, 0);
    built = true;
    return true;
  }

  // pick the layer key for a window
  function keyFor(opts) {
    var warm = opts && opts.warm != null ? opts.warm : 0.7;
    var lit = !opts || opts.lit !== false;
    var hot = warm >= 0.5;
    return (hot ? "warm" : "cool") + (lit ? "Lit" : "Dark");
  }

  /* PUBLIC: add a readability panel for one opening. Pooled by default. */
  CBZ.cityInteriorGlow = function (parent, x, y, z, w, h, faceNormal, opts) {
    if (!build()) return null;
    if (total >= MAX_INSTANCES) return null;   // capped — silently no-op
    opts = opts || {};
    var key = keyFor(opts);
    var im = layers[key];
    var idx = counts[key];
    if (idx >= MAX_INSTANCES) return null;

    // outward normal (Vector3 or {x,z}); default +Z
    var nx = 0, nz = 1;
    if (faceNormal) {
      nx = faceNormal.x || 0;
      nz = (faceNormal.z != null ? faceNormal.z : (faceNormal.y || 0));
    }
    var nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;

    // Position: shove the panel slightly INTO the wall along -normal so it sits
    // behind the glass and reads as the room, not a sticker on the facade.
    var inset = opts.inset != null ? opts.inset : DEFAULT_INSET;
    var px = x - nx * inset, py = y, pz = z - nz * inset;

    // Orient the +Z plane to face back OUT through the opening (toward +normal),
    // and scale to fill the opening (a touch oversize hides the frame edges).
    _v.set(nx, 0, nz);                 // already unit length (normalized above)
    _q.setFromUnitVectors(_AXIS_Z(), _v);
    _m.compose(_e.set(px, py, pz), _q, _scale(w * 1.04, h * 1.04));
    im.setMatrixAt(idx, _m);

    counts[key] = idx + 1;
    if (idx + 1 > im.count) im.count = idx + 1;
    im.instanceMatrix.needsUpdate = true;
    total++;

    // first time a layer gets an instance, attach it under the city root so it
    // shares the world transform / lifecycle. parent is whatever buildings.js
    // hands us (its building/city group).
    if (!im.parent && parent && parent.add) parent.add(im);

    // force a night re-apply next tick so the new panel gets the right tint
    nightApplied = -1;
    return { layer: key, index: idx };
  };

  // tiny matrix helpers that avoid re-allocating constant vectors per call
  var __axisZ = null, __scaleV = null;
  function _AXIS_Z() { if (!__axisZ) __axisZ = new THREE.Vector3(0, 0, 1); return __axisZ; }
  function _scale(sx, sy) { if (!__scaleV) __scaleV = new THREE.Vector3(); return __scaleV.set(sx, sy, 1); }

  /* PUBLIC: wipe everything (new run / island regen). */
  CBZ.cityInteriorGlowReset = function () {
    if (!built) return;
    Object.keys(layers).forEach(function (k) {
      var im = layers[k];
      im.count = 0;
      counts[k] = 0;
      if (im.parent) im.parent.remove(im);   // re-added on next register
    });
    total = 0;
    nightApplied = -1;
  };

  // ---- day/night ramp ------------------------------------------------------
  // A FEW shared-material writes, throttled, gated to city mode. The "Dark"
  // layers never ramp (vacant rooms stay dim); the "Lit" layers glow.
  function lerp(a, b, t) { return a + (b - a) * t; }

  function applyNight(n) {
    if (!built) return;
    // ease the ramp so windows "come on" around dusk, matching buildings.js's
    // hysteresis band (~0.45..0.6) rather than fading linearly all day.
    var glow = (n - 0.30) / 0.45; glow = glow < 0 ? 0 : glow > 1 ? 1 : glow;
    glow = glow * glow * (3 - 2 * glow);   // smoothstep

    // LIT rooms: bright shaded day → warm/cool glow-night.
    setMat(mats.warmLit, DAY.warm, NIGHT.warm, glow, 0);
    setMat(mats.coolLit, DAY.cool, NIGHT.cool, glow, 0);
    // DARK (vacant/unlit) rooms: by DAY they read exactly like a lit room —
    // sunlight fills any room through the glass — so they sit at the full bright
    // daytime depth. By NIGHT they must NOT glow; instead they DARKEN toward a
    // dim shadowed interior (a room with the lights off, still faintly readable
    // by streetlight, never pitch black). So we fade the day tone DOWN by glow
    // rather than ramping toward the night glow.
    setMat(mats.warmDark, DAY.warm, DAY.warm, 0, glow);
    setMat(mats.coolDark, DAY.cool, DAY.cool, 0, glow);
  }

  // t = day→night glow lerp (0..1). dark = how much to DARKEN the result toward
  // an unlit shadowed room (0 = none, 1 = nearly off); used for vacant rooms at
  // night so they don't glow. Brightness floor keeps them faintly readable.
  function setMat(m, day, night, t, dark) {
    var r = lerp(day.r, night.r, t);
    var gg = lerp(day.g, night.g, t);
    var b = lerp(day.b, night.b, t);
    var o = lerp(day.o, night.o, t);
    if (dark) {
      var k = lerp(1, 0.22, dark);       // fade toward 22% — dim, not black
      r *= k; gg *= k; b *= k;
      o = lerp(o, 0.88, dark);           // stay opaque enough to read as a room
    }
    m.color.setRGB(r, gg, b);
    m.opacity = o;
  }

  // throttled updater — a few Hz is plenty for a dusk ramp. 0.34 = order slot
  // near buildings.js's own night pass so they settle together.
  CBZ.onUpdate(0.34, function () {
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    if (!built) return;
    var n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
    // quantize so we only write the shared materials when the value moves —
    // turns this into a no-op on the vast majority of frames.
    var q = Math.round(n * 40) / 40;
    if (q === nightApplied) return;
    nightApplied = q;
    applyNight(n);
  });
})();
