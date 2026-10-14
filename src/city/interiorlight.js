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
     CBZ.cityInteriorBreak(win, parent) — a window's glass broke: its panel
        comes out of the hole and a dark room box goes in behind it (see
        "A BROKEN WINDOW" below). CBZ.cityInteriorMend([win]) undoes it.

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
  var _roomTex = null, _roomTexLit = null;
  // THE LIT ROOM has its lights on: the same room with a ceiling fitting in
  // the top band, the pool it throws on the ceiling round it and a wash down
  // the back wall. A lit room's ceiling is the BRIGHT part of the view from the
  // street, not the dark one, and that single cue is what reads as "someone
  // switched the lights on" instead of "a beige panel got brighter".
  function makeLitRoomTexture() {
    if (_roomTexLit) return _roomTexLit;
    var base = makeRoomTexture();
    var cv = document.createElement("canvas");
    cv.width = 64; cv.height = 128;
    var g = cv.getContext("2d");
    g.drawImage(base.image, 0, 0);
    var cg = g.createRadialGradient(32, 5, 1, 32, 5, 30);
    cg.addColorStop(0, "rgba(255,255,255,0.55)"); cg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = cg; g.fillRect(0, 0, 64, 24);
    var wg = g.createRadialGradient(32, 30, 2, 32, 30, 34);
    wg.addColorStop(0, "rgba(255,255,255,0.16)"); wg.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = wg; g.fillRect(0, 10, 64, 60);
    g.fillStyle = "#ffffff"; g.fillRect(21, 3, 22, 3);          // the fitting itself
    _roomTexLit = new THREE.CanvasTexture(cv);
    _roomTexLit.wrapS = _roomTexLit.wrapT = THREE.ClampToEdgeWrapping;
    if (THREE.sRGBEncoding != null) _roomTexLit.encoding = THREE.sRGBEncoding;
    // MIPMAPPED (64x128 is a power of two): a 1.5 m window at 100 m covers ~10
    // pixels of this 64-texel painting, and with LinearFilter alone every turn
    // of the view re-picked which texels landed: the room panels shimmered
    // as dark-grey squares behind the glass while the camera moved.
    _roomTexLit.minFilter = THREE.LinearMipmapLinearFilter;
    _roomTexLit.generateMipmaps = true;
    return _roomTexLit;
  }
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
    // mipmapped: seen far more often from the street than near (see the lit twin)
    _roomTex.minFilter = THREE.LinearMipmapLinearFilter;
    _roomTex.generateMipmaps = true;
    return _roomTex;
  }

  function build() {
    if (built || !ensureThree()) return built;
    // ONE plane, faces +Z by default; we orient per-instance via the matrix.
    geo = new THREE.PlaneGeometry(1, 1);
    var roomTex = makeRoomTexture();
    // unlit and FRONT-SIDED: the plane's +Z faces OUT through the opening, so
    // it reads from every street angle and is culled from INSIDE the room.
    // It used to be DoubleSide, which meant anyone standing in a real, fully
    // furnished tower floor looked at a 96%-opaque grey painting of a room
    // hung 0.18 m inside every window: the exec suite 160 m up "showed only
    // flat grey haze" because every curtain-wall bay had this panel in it.
    // depthWrite OFF so it never z-fights the pane and stays behind the glass.
    // The shared ROOM-DEPTH texture supplies floor/wall/ceiling contrast; the
    // material color tints it day→night.
    var litTex = makeLitRoomTexture();
    function mk(lit) {
      return new THREE.MeshBasicMaterial({
        color: 0x808080, map: lit ? litTex : roomTex, transparent: true, opacity: 0.96,
        depthWrite: false, side: THREE.FrontSide, fog: true
      });
    }
    mats = { coolLit: mk(true), warmLit: mk(true), coolDark: mk(false), warmDark: mk(false) };
    layers = {};
    counts = {};
    Object.keys(mats).forEach(function (k) {
      var im = new THREE.InstancedMesh(geo, mats[k], MAX_INSTANCES);
      im.count = 0;                       // grow as windows register
      im.castShadow = false; im.receiveShadow = false;  // unlit, off the sun pass
      im.frustumCulled = true;            // big bounding sphere; still cheap
      im.renderOrder = -1;                // draw before glass panes
      im.name = "cityInteriorGlow_" + k;
      // DECLARE THE COORDINATE SPACE. Every matrix written below is composed
      // from WORLD coordinates, so this pool is only correct while its whole
      // ancestor chain is at identity. That is not a comment any more — it is
      // the fact CBZ.poolParentAudit() (city/buildings.js) reads, and the
      // stamp is what makes this pool visible to it at all.
      im.userData.worldSpacePool = "cityInteriorGlow";
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

  // THE ONE ANSWER to "where does a world-coordinate pool hang?" lives in
  // city/buildings.js (CBZ.poolIdentityHost) — it owns the three oldest pools
  // and the doctrine. index.html loads buildings.js (line ~539) before this
  // file (~541) so it is always there in the real game; the fallback is the
  // old one-hop, which is correct for the shipped nesting and keeps a stripped
  // load order from losing its panels entirely.
  function identityHost(node) {
    if (CBZ.poolIdentityHost) return CBZ.poolIdentityHost(node);
    return (node && node.parent && node.parent.add) ? node.parent : node;
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

    // First time a layer gets an instance, attach it. THE COMMENT ABOVE SAID
    // "under the city root"; THE CODE ATTACHED IT TO THE BUILDING.
    //
    // OWNER (screenshot): dark slab boxes on a glass tower's curtain wall, one
    // per bay across several floors, at the window head/sill line, some ANGLED
    // and standing proud of the glass. That is these panels, and this line is
    // why. Every instance matrix above is composed from WORLD coordinates —
    // buildings.js:2951 passes `wx = ox + cx, wz = oz + cz` — but the pool is a
    // SHARED InstancedMesh parented to whichever building group happened to
    // register first, and a building group is TRANSLATED
    // (`bgroup.position.set(ox, 0, oz)`, buildings.js:2279). So every interior
    // panel in the city was displaced by +(ox0, 0, oz0), the first building's
    // origin. The Y offset is 0, which is exactly why this was so easy to miss
    // and so ugly: the panels kept their correct window-band HEIGHTS, so they
    // landed at plausible sill/head lines on OTHER buildings, wearing the yaw
    // of the facade they came from — hence "angled" — and outside the host's
    // glass rather than behind it. Unlit MeshBasicMaterial in the coolDark /
    // warmDark day tints reads as a dark grey slab, which is what got called
    // an AC unit.
    //
    // buildings.js already solved this for its own pooled panes and wrote down
    // the reason (buildings.js:226-232): "parent the pools to the city root
    // (the building groups' parent) so they inherit the mode-visibility toggle.
    // Records hold WORLD coords and the root is at identity ... so no
    // re-basing." Same records, same requirement, same answer.
    //
    // THE ANCHOR IS ABSOLUTE, NOT A HOP. The first cure for this was
    // `parent.parent` — one level up from the building group. That is RIGHT
    // TODAY only because every one of the ~12 cityMakeBuilding callers happens
    // to hand `city.root` in as its root, so a building group is always
    // exactly one level under identity. It is a relative fix to an absolute
    // requirement: nest a building group one level deeper (a district group, a
    // town group, a demolition holder) and the hop silently lands on a
    // TRANSLATED node and the whole disease comes back, in the same silent way,
    // with no error anywhere. So we do not count levels — we look for the
    // property the records actually need: identityHost walks the real ancestor
    // chain and returns the DEEPEST node whose accumulated transform is still
    // identity. For today's world that IS city.root (so the mode-visibility
    // toggle still owns these panels and nothing changes), and for any future
    // nesting it is still the correct node by construction.
    if (!im.parent && parent && parent.add) {
      var host = identityHost(parent) || parent;
      host.add(im);
    }

    // force a night re-apply next tick so the new panel gets the right tint
    nightApplied = -1;
    return { layer: key, index: idx };
  };

  // tiny matrix helpers that avoid re-allocating constant vectors per call
  var __axisZ = null, __scaleV = null;
  function _AXIS_Z() { if (!__axisZ) __axisZ = new THREE.Vector3(0, 0, 1); return __axisZ; }
  function _scale(sx, sy) { if (!__scaleV) __scaleV = new THREE.Vector3(); return __scaleV.set(sx, sy, 1); }

  /* PUBLIC: A BLAST OPENED THE FACADE — the fake interior must stop pretending.

     These panels are the arch-viz trick: one flat plane 0.18 m behind each
     opening, painted with a room-depth gradient, that reads as a furnished
     room ONLY while there is glass and a frame in front of it. Blow the bay
     open (city/buildings.js carveHole) and the trick is standing in the hole
     with nothing in front of it — MEASURED on an 8-storey office after a
     missile: a flat tan billboard, banded like brick, filling the breach
     across two storeys, in front of the real floor slabs the blast just
     exposed. The illusion has to be removed with the wall it was hiding
     behind.

     Zero the instance scale for every panel whose centre lies in the world box
     (an InstancedMesh has no per-instance visibility; a zero-scale matrix is
     the cheap, allocation-free equivalent, and it keeps every other index
     stable). cityInteriorGlowReset restores the whole pool on a new run, the
     same way every other pooled record in the city comes back.

     Returns how many it cleared, so a caller/gate can assert it happened. */
  CBZ.cityInteriorGlowClearBox = function (minX, maxX, y0, y1, minZ, maxZ) {
    if (roomIM && !built) roomsInBox(minX, maxX, y0, y1, minZ, maxZ, function (r, i) { r.dead = true; r.hidden = true; roomShow(r); rooms.splice(i, 1); });
    if (!built || !ensureThree()) return 0;
    if (!__clearM) { __clearM = new THREE.Matrix4(); __clearP = new THREE.Vector3(); }
    var cleared = 0;
    // a panel a fit-out has HIDDEN is zeroed already; blasting its bay must also
    // forget the saved matrix, or walking away would restore it into the breach
    for (var id in HIDDEN) {
      var sv = HIDDEN[id];
      if (sv[12] < minX || sv[12] > maxX || sv[14] < minZ || sv[14] > maxZ || sv[13] < y0 || sv[13] > y1) continue;
      delete HIDDEN[id]; cleared++;
    }
    for (var bid in BROKEN) {
      var bv = BROKEN[bid];
      if (bv[12] < minX || bv[12] > maxX || bv[14] < minZ || bv[14] > maxZ || bv[13] < y0 || bv[13] > y1) continue;
      delete BROKEN[bid];
    }
    if (roomIM) roomsInBox(minX, maxX, y0, y1, minZ, maxZ, function (r, i) { r.dead = true; r.hidden = true; roomShow(r); rooms.splice(i, 1); });
    Object.keys(layers).forEach(function (k) {
      var im = layers[k], n = counts[k];
      for (var i = 0; i < n; i++) {
        im.getMatrixAt(i, __clearM);
        __clearP.setFromMatrixPosition(__clearM);
        if (__clearP.x < minX || __clearP.x > maxX) continue;
        if (__clearP.z < minZ || __clearP.z > maxZ) continue;
        if (__clearP.y < y0 || __clearP.y > y1) continue;
        if (__clearM.elements[0] === 0 && __clearM.elements[5] === 0) continue;   // already cleared
        __clearM.makeScale(0, 0, 0);
        im.setMatrixAt(i, __clearM);
        cleared++;
      }
      if (cleared) im.instanceMatrix.needsUpdate = true;
    });
    return cleared;
  };
  var __clearM = null, __clearP = null;

  /* PUBLIC: A REAL ROOM IS BEHIND THIS GLASS NOW — hide the painting of one.

     city/fitout.js builds the actual interior of the storey you walk up to
     (floor, walls, ceiling, lamps, furniture). With the panel still hung 0.18 m
     inside every window, that finished room could never be seen from the
     street: you looked at a 96%-opaque gradient of a room in front of the
     room. hide=true zero-scales every panel whose centre is in the box and
     SAVES its matrix; hide=false puts back exactly what it saved (and only
     that) when the fit-out frees the floor. Returns the count touched. */
  var HIDDEN = {};                      // "layer:index" -> saved matrix elements
  CBZ.cityInteriorGlowHideBox = function (minX, maxX, y0, y1, minZ, maxZ, hide) {
    var n2 = 0;
    // the broken windows' rooms on this storey: the real one replaces them
    if (hide) HIDE_REGIONS.push([minX, maxX, y0, y1, minZ, maxZ]);
    else for (var hr = HIDE_REGIONS.length - 1; hr >= 0; hr--) {
      var q = HIDE_REGIONS[hr];
      if (q[0] === minX && q[1] === maxX && q[2] === y0 && q[3] === y1 && q[4] === minZ && q[5] === maxZ) { HIDE_REGIONS.splice(hr, 1); break; }
    }
    if (roomIM) n2 += roomsInBox(minX, maxX, y0, y1, minZ, maxZ, function (r) {
      var h = hide ? true : inRegion(r);
      if (h !== r.hidden) { r.hidden = h; roomShow(r); }
    });
    if (!built || !ensureThree()) return n2;
    if (!__clearM) { __clearM = new THREE.Matrix4(); __clearP = new THREE.Vector3(); }
    Object.keys(layers).forEach(function (k) {
      var im = layers[k], n = counts[k], touched = false;
      for (var i = 0; i < n; i++) {
        var id = k + ":" + i, sv = HIDDEN[id];
        if (BROKEN[id]) continue;
        if (hide) {
          if (sv) continue;
          im.getMatrixAt(i, __clearM);
          var e = __clearM.elements;
          if (e[0] === 0 && e[5] === 0) continue;                 // blasted / cleared
          if (e[12] < minX || e[12] > maxX || e[14] < minZ || e[14] > maxZ || e[13] < y0 || e[13] > y1) continue;
          HIDDEN[id] = e.slice();
          __clearM.makeScale(0, 0, 0);
          im.setMatrixAt(i, __clearM);
        } else {
          if (!sv) continue;
          if (sv[12] < minX || sv[12] > maxX || sv[14] < minZ || sv[14] > maxZ || sv[13] < y0 || sv[13] > y1) continue;
          __clearM.fromArray(sv);
          im.setMatrixAt(i, __clearM);
          delete HIDDEN[id];
        }
        touched = true; n2++;
      }
      if (touched) im.instanceMatrix.needsUpdate = true;
    });
    return n2;
  };

  /* ---- A BROKEN WINDOW: THE PAINTING COMES OUT, A ROOM GOES IN ------------

     OWNER: "Sometimes when I break a window, there's just this gray slab that
     replaces the window. It's really dumb."

     The slab was the panel above. It is a picture of a room for looking at
     THROUGH GLASS: 96% opaque, unlit, mid-grey by day, 12 cm behind the pane.
     Shoot the pane out and nothing hides what it is. Only a successful wall
     carve (buildings.js's old tryWindowOpening) ever took it down, and that
     carve failed on the second window of a wall, outside the city mode, past
     its queue cap. MEASURED in the lab (kit window-break): the third window
     shot on a brick storey, a grey #998975 sheet at 0.12 m in.

     And taking the panel down is not enough on its own: a city shell is
     hollow behind its windows (the fit-out builds a real storey only within
     9 m), so the hole then showed the shell's far wall 5-26 m away, lit by
     the sun as if it stood outdoors: another flat grey.

     So a broken window gets a ROOM: one inward-facing box behind the opening,
     3.2 m deep, a metre wider than the window on each side (an oblique look
     meets its side wall, never the void), floor to ceiling of the storey,
     coloured like a room with the lights off by day (floor brightest by the
     window, the back corners darkest) and a strip fitting on the ceiling.
     Unlit (MeshBasic), so the sun never flattens it; inward faces only, so
     from outside its walls and from inside the building it is invisible.
     Every room is one instance of one unit box: a city of broken windows is
     one draw call. A window that breaks next to an open room widens it.

     The fit-out hides rooms with the panels (HideBox) so the real storey is
     what you see when you are close; a blast's ClearBox takes them with the
     wall; CBZ.cityInteriorMend() (buildings.js's re-glaze) puts every panel
     back and drops every room. */
  var ROOM_MAX = 1024, ROOM_DEPTH = 3.2, ROOM_SIDE = 1.0;
  var roomGeo = null, roomMat = null, roomIM = null;
  var rooms = [];                 // live: {nx, nz, fixed, u0, u1, y0, y1, idx, hidden}
  var roomNext = 0;               // ring cursor once the pool is full
  var BROKEN = {};                // "layer:index" -> saved panel matrix (a broken window's painting)
  var HIDE_REGIONS = [];          // the fit-out's live floors: new rooms inside one start hidden

  function lin(hex) { var c = new THREE.Color(hex); if (c.convertSRGBToLinear) c.convertSRGBToLinear(); return c; }
  function buildRoomGeo() {
    // unit room: x -0.5..0.5 (across the window), y 0..1 (floor..ceiling),
    // z -1..0 (deep..the glass plane). Faces point INTO the room.
    var P = [], C = [];
    function quad(a, b, c, d, ca, cb, cc, cd, want) {
      // wind so the face's normal is `want`
      var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var flip = nx * want[0] + ny * want[1] + nz * want[2] < 0;
      var tri = flip ? [[a, ca], [c, cc], [b, cb], [a, ca], [d, cd], [c, cc]] : [[a, ca], [b, cb], [c, cc], [a, ca], [c, cc], [d, cd]];
      for (var i = 0; i < 6; i++) { P.push(tri[i][0][0], tri[i][0][1], tri[i][0][2]); C.push(tri[i][1].r, tri[i][1].g, tri[i][1].b); }
    }
    var floorNear = lin(0x6a6156), floorFar = lin(0x37322d);
    var backLow = lin(0x37312b), backHigh = lin(0x5a5148);
    var sideNear = lin(0x544c43), sideFar = lin(0x2e2a26), sideTopNear = lin(0x463f38);
    var ceilNear = lin(0x3e3832), ceilFar = lin(0x4a433b);
    var strip = lin(0xfff4dc);
    var L = -0.5, R = 0.5;
    // floor (y=0, normal +y): light by the window, falling off to the back
    quad([L, 0, 0], [R, 0, 0], [R, 0, -1], [L, 0, -1], floorNear, floorNear, floorFar, floorFar, [0, 1, 0]);
    // ceiling (y=1, normal -y): lifted toward the back by the fitting's spill
    quad([L, 1, 0], [R, 1, 0], [R, 1, -1], [L, 1, -1], ceilNear, ceilNear, ceilFar, ceilFar, [0, -1, 0]);
    // back wall (z=-1, normal +z): the strip's wash on its upper half
    quad([L, 0, -1], [R, 0, -1], [R, 1, -1], [L, 1, -1], backLow, backLow, backHigh, backHigh, [0, 0, 1]);
    // side walls (normals inward)
    quad([L, 0, 0], [L, 0, -1], [L, 1, -1], [L, 1, 0], sideNear, sideFar, sideFar, sideTopNear, [1, 0, 0]);
    quad([R, 0, 0], [R, 0, -1], [R, 1, -1], [R, 1, 0], sideNear, sideFar, sideFar, sideTopNear, [-1, 0, 0]);
    // the ceiling fitting: a strip across the room ~1.5 m in (where a look up
    // from the street lands past the window head), a hair under the board
    quad([-0.24, 0.993, -0.42], [0.24, 0.993, -0.42], [0.24, 0.993, -0.5], [-0.24, 0.993, -0.5], strip, strip, strip, strip, [0, -1, 0]);
    var g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
    return g;
  }
  function ensureRooms(parent) {
    if (roomIM) {
      if (!roomIM.parent && parent) { var h0 = identityHost(parent) || parent; if (h0 && h0.add) h0.add(roomIM); }
      return true;
    }
    if (!ensureThree()) return false;
    roomGeo = buildRoomGeo();
    roomMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide, fog: true });
    roomIM = new THREE.InstancedMesh(roomGeo, roomMat, ROOM_MAX);
    roomIM.count = 0;
    roomIM.castShadow = false; roomIM.receiveShadow = false;
    // world-coordinate instances spread over the whole city: one sphere can't
    // bound them tightly, and a culled draw of a few hundred boxes saves nothing
    roomIM.frustumCulled = false;
    roomIM.name = "cityBrokenWindowRooms";
    roomIM.userData.worldSpacePool = "cityBrokenWindowRooms";
    var host = parent ? (identityHost(parent) || parent) : CBZ.scene;
    if (host && host.add) host.add(roomIM);
    return true;
  }
  var _rm = null, _rq = null, _rp = null, _rs = null, _rz = null, _rn = null;
  function roomMatrix(r) {
    if (!_rm) { _rm = new THREE.Matrix4(); _rq = new THREE.Quaternion(); _rp = new THREE.Vector3(); _rs = new THREE.Vector3(); _rz = new THREE.Vector3(0, 0, 1); _rn = new THREE.Vector3(); }
    var uc = (r.u0 + r.u1) / 2, horiz = r.nz !== 0;
    _rp.set(horiz ? uc : r.fixed, r.y0, horiz ? r.fixed : uc);
    _rq.setFromUnitVectors(_rz, _rn.set(r.nx, 0, r.nz));
    _rs.set(r.u1 - r.u0, Math.max(0.5, r.y1 - r.y0), ROOM_DEPTH);
    return _rm.compose(_rp, _rq, _rs);
  }
  var _zero = null;
  function roomShow(r) {
    if (!_zero) _zero = new THREE.Matrix4().makeScale(0, 0, 0);
    roomIM.setMatrixAt(r.idx, (r.hidden || r.camIn || r.dead) ? _zero : roomMatrix(r));
    roomIM.instanceMatrix.needsUpdate = true;
  }
  // a room is WHERE ITS WINDOW IS: the middle of its open side, on the glass plane
  function roomFront(r) {
    var uc = (r.u0 + r.u1) / 2, horiz = r.nz !== 0;
    return { x: horiz ? uc : r.fixed, y: (r.y0 + r.y1) / 2, z: horiz ? r.fixed : uc };
  }
  function inRegion(r) {
    var c = roomFront(r);
    for (var i = 0; i < HIDE_REGIONS.length; i++) {
      var b = HIDE_REGIONS[i];
      if (c.x >= b[0] && c.x <= b[1] && c.y >= b[2] && c.y <= b[3] && c.z >= b[4] && c.z <= b[5]) return true;
    }
    return false;
  }
  // zero the painted panel(s) standing in this opening, saving them for the mend
  function breakPanels(minX, maxX, y0, y1, minZ, maxZ) {
    if (!built) return 0;
    if (!__clearM) { __clearM = new THREE.Matrix4(); __clearP = new THREE.Vector3(); }
    var n = 0;
    Object.keys(layers).forEach(function (k) {
      var im = layers[k], cnt = counts[k], touched = false;
      for (var i = 0; i < cnt; i++) {
        var id = k + ":" + i;
        if (BROKEN[id]) continue;
        var sv = HIDDEN[id];
        var e;
        if (sv) e = sv;                              // the fit-out hid it: the break owns it now
        else { im.getMatrixAt(i, __clearM); e = __clearM.elements; if (e[0] === 0 && e[5] === 0) continue; }
        if (e[12] < minX || e[12] > maxX || e[14] < minZ || e[14] > maxZ || e[13] < y0 || e[13] > y1) continue;
        BROKEN[id] = e.slice();
        if (sv) { delete HIDDEN[id]; continue; }
        __clearM.makeScale(0, 0, 0);
        im.setMatrixAt(i, __clearM);
        touched = true; n++;
      }
      if (touched) im.instanceMatrix.needsUpdate = true;
    });
    return n;
  }
  /* PUBLIC: a window broke. w = { horiz, out (+1/-1 along the face normal),
     fixed (the glass plane, world), u0, u1 (its span along the face, world),
     y0, y1 (the opening), fy0, fy1 (its storey's floor and ceiling) },
     parent = any node of the building (the pool hangs off its identity host).
     Idempotent per window record. Returns the room record. */
  CBZ.cityInteriorBreak = function (w, parent) {
    if (!w || w.room) return w ? w.room : null;
    if (!ensureThree()) return null;
    var nx = w.horiz ? 0 : w.out, nz = w.horiz ? w.out : 0;
    // the painting in this opening (its centre is the opening's centre, 0.2-0.3 m in)
    var ux0 = w.u0 - 0.05, ux1 = w.u1 + 0.05, f0 = w.fixed - 0.7, f1 = w.fixed + 0.7;
    w.panels = breakPanels(w.horiz ? ux0 : f0, w.horiz ? ux1 : f1, w.y0 - 0.1, w.y1 + 0.1, w.horiz ? f0 : ux0, w.horiz ? f1 : ux1);
    if (w.furnished) return null;               // a real room is already behind this glass
    if (!ensureRooms(parent)) return null;
    var y0 = (w.fy0 != null ? w.fy0 : w.y0 - 0.9) + 0.015, y1 = w.fy1 != null ? w.fy1 : w.y1 + 0.4;   // floor a hair over the slab: never coplanar
    var u0 = w.u0 - ROOM_SIDE, u1 = w.u1 + ROOM_SIDE;
    // a room already open on this storey of this face, touching this window: widen it
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      if (r.dead || r.nx !== nx || r.nz !== nz || Math.abs(r.fixed - w.fixed) > 0.35 || Math.abs(r.y0 - y0) > 0.3) continue;
      if (u0 > r.u1 + 0.2 || u1 < r.u0 - 0.2) continue;
      r.u0 = Math.min(r.u0, u0); r.u1 = Math.max(r.u1, u1);
      r.wins++;
      roomShow(r);
      w.room = r;
      return r;
    }
    var idx;
    if (roomIM.count < ROOM_MAX) idx = roomIM.count++;
    else {
      // full: the oldest room goes (its window keeps its hole and its teeth)
      idx = roomNext; roomNext = (roomNext + 1) % ROOM_MAX;
      for (var j = 0; j < rooms.length; j++) if (rooms[j].idx === idx) { rooms[j].dead = true; rooms.splice(j, 1); break; }
    }
    var rec = { nx: nx, nz: nz, fixed: w.fixed, u0: u0, u1: u1, y0: y0, y1: y1, idx: idx, hidden: false, wins: 1 };
    rec.hidden = inRegion(rec);
    rooms.push(rec);
    roomShow(rec);
    w.room = rec;
    return rec;
  };
  /* PUBLIC: re-glaze. Every broken window's panel comes back, every room goes.
     With a window record: just that window (a rebuilt building's panes). */
  CBZ.cityInteriorMend = function (w) {
    if (w) {
      var r = w.room;
      w.room = null;
      if (r && !r.dead && --r.wins <= 0) { r.dead = true; r.hidden = true; if (roomIM) roomShow(r); rooms.splice(rooms.indexOf(r), 1); }
      return;
    }
    if (built) {
      Object.keys(BROKEN).forEach(function (id) {
        var p = id.split(":"), im = layers[p[0]];
        if (!im) return;
        __clearM = __clearM || new THREE.Matrix4();
        im.setMatrixAt(+p[1], __clearM.fromArray(BROKEN[id]));
        im.instanceMatrix.needsUpdate = true;
      });
    }
    BROKEN = {};
    for (var i = 0; i < rooms.length; i++) rooms[i].dead = true;
    rooms.length = 0; roomNext = 0;
    if (roomIM) { roomIM.count = 0; roomIM.instanceMatrix.needsUpdate = true; }
  };
  CBZ.cityInteriorRoomsAudit = function () {
    var vis = 0;
    for (var i = 0; i < rooms.length; i++) if (!rooms[i].hidden) vis++;
    return { rooms: rooms.length, visible: vis, panelsBroken: Object.keys(BROKEN).length, capacity: ROOM_MAX };
  };
  // rooms whose centre lies in a world box: hide/show (fit-out) or drop (blast)
  function roomsInBox(minX, maxX, y0, y1, minZ, maxZ, fn) {
    var n = 0;
    for (var i = rooms.length - 1; i >= 0; i--) {
      var c = roomFront(rooms[i]);
      if (c.x < minX || c.x > maxX || c.z < minZ || c.z > maxZ || c.y < y0 || c.y > y1) continue;
      fn(rooms[i], i); n++;
    }
    return n;
  }

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
    HIDDEN = {};
    CBZ.cityInteriorMend();
    BROKEN = {};
    HIDE_REGIONS.length = 0;
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
  /* A ROOM IS FOR LOOKING INTO, NOT FOR STANDING IN. Seen from the street a
     room box is the dark storey behind a broken window. But a storey can be
     real (a dressed floor, an apartment the shell furnished) and the player
     can walk up to the hole from inside it, or climb in through it: then the
     box's walls would close round him. So a room whose window the camera is
     BEHIND (on the building's side of the glass, within its storey and its
     reach) is not drawn. A handful of rooms, a few compares a frame. */
  function roomsForCamera() {
    if (!roomIM || !rooms.length) return;
    var cam = CBZ.camera; if (!cam) return;
    var p = cam.position, any = false;
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i], horiz = r.nz !== 0;
      var off = horiz ? (p.z - r.fixed) * r.nz : (p.x - r.fixed) * r.nx;     // + = the street side
      var u = horiz ? p.x : p.z;
      var inside = off < 0.05 && off > -(ROOM_DEPTH + 6) && u > r.u0 - 3 && u < r.u1 + 3 && p.y > r.y0 - 1 && p.y < r.y1 + 1;
      if (inside !== !!r.camIn) { r.camIn = inside; roomShow(r); any = true; }
    }
    return any;
  }
  CBZ.onUpdate(0.34, function () {
    if (!CBZ.game || CBZ.game.mode !== "city") return;
    roomsForCamera();
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
