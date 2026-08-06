/* ============================================================
   world/volcanofx.js — THE VOLCANO'S SURFACES, keyed on a position
   and a HEIGHT FIELD, so the same four builders serve the survival
   island today and a city-side eruption tomorrow.

   OWNER, 2026-08-03: "lava in current game is dumb and see thru".
   He is right, and the reason is one line: the old streams were
   MeshBasicMaterial + AdditiveBlending + opacity 0.95 boxes. Additive
   blending CANNOT be opaque — it only ever ADDS to whatever is behind
   it, so the grass showed through the lava and the lava showed through
   itself where two boxes crossed. Nothing tuned on that material was
   ever going to look like rock.

   SO THE PHYSICS DECIDES THE MATERIAL. A basaltic flow is a RIVER OF
   ROCK WITH A LID: the surface chills against the air within seconds
   into an opaque black-brown crust, and what you actually see glowing
   is the incandescent interior showing through cracks and through the
   open central channel. That is two meshes, and neither of them is
   transparent:

     CRUST    MeshPhongMaterial (shininess 0 — Lambert's look; r128's
              Lambert cannot flat-shade), vertexColors, flatShading,
              OPAQUE. Dark basalt at the levees, scorched red-brown at
              the margins. It is LIT, so it takes the scene's sun and
              reads as ground, and it THICKENS with age (the levees
              build up and the flow stands proud of the grass).
     CHANNEL  MeshBasicMaterial, vertexColors, OPAQUE. Unlit on
              purpose — an unlit material IS incandescence: it ignores
              the sun, so at night it stays exactly as bright as it was
              at noon, which is what self-luminous rock does. White-
              yellow (1150 C) at the vent, cooling through orange to a
              deep dull red at the toe. Its width breathes and pinches
              shut where the crust has welded over.

   The only TRANSPARENT thing in a lava flow here is the heat haze
   ABOVE it — additive sprites, never the flow itself — plus one or two
   pooled PointLights so the thing actually illuminates the hillside at
   night (core/lightpin.js budgets and pins the count, so this is safe).

   THE THREE KILL MODES ARE MODELLED AS WHAT THEY PHYSICALLY ARE:

     column()       the ERUPTION COLUMN, in the three regions a real one
                    has: a narrow GAS THRUST jet leaving the vent at
                    >100 m/s, a CONVECTIVE region that widens as it
                    entrains air and does most of the climbing, and an
                    UMBRELLA that stops rising and spreads sideways at
                    its neutral-buoyancy level. Built from the same
                    opaque overlapping billows as the flow below,
                    because that is the only thing that reads as ONE
                    cloud instead of a bag of separate puffs.
     pyroclastic()  a ground-hugging density current: pulverised rock
                    and 400 C gas rolling DOWN the fall line far faster
                    than anything can run. Boiling, opaque, overlapping
                    billows with an incandescent basal fringe. Inside
                    the lane there is no survival mechanic — evacuation
                    is the mechanic.
     lahar()        wet concrete: a matte, chunky, boulder-carrying mud
                    river that seeks the valley instead of the fall
                    line, moves at river speed, drags what it catches,
                    and HARDENS in place into a permanent scar.
     ashLoad()      accumulation, not weather. A grid of quads whose
                    COVERAGE grows with the ash that has actually
                    landed on that cell — so the blanket creeps
                    downwind, and roofs carry a load a caller can read
                    back and price through the structural ledger.

   ALL FOUR TAKE THE SAME TWO ARGUMENTS and nothing about a game mode:
   `groundAt(x, z)` and `parent` (an Object3D). Hand them the arena's
   groundHeightAt + arena.root, or CBZ.floorAt + CBZ.scene, and they do
   not know or care which world they are in.

   Adoption is one line each (THE BLOCK LAW):
     const f = CBZ.volcanoFx.lavaFlow({ x, z, groundAt, parent, bearing });
     f.update(dt);  f.hitTest(px, pz);  f.dispose();

   Degrade-safe: every entry point returns a handle with the same shape
   (update/dispose/hitTest are always callable), so a caller never has
   to null-check anything but `CBZ.volcanoFx` itself.

   Determinism: shape jitter is CBZ.hash01 off world position, so the
   same vent carves the same channel on every client. Per-frame flicker
   is runtime-only FX and uses Math.random, which the doctrine allows.

   Flags: VOLCANO_V2 (the opaque crust+channel lava; false = the caller
   keeps its legacy visual) · VOLCANO_PYRO · VOLCANO_LAHAR ·
   VOLCANO_ASH_LOAD · VOLCANO_COLUMN. Ratchet: CBZ.volcanoAudit()
   (lavaTransparent AND columnTransparent both pinned at 0).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  CBZ.CONFIG = CBZ.CONFIG || {};

  // Each is a genuine one-line revert of one hazard.
  if (CBZ.CONFIG.VOLCANO_V2 == null) CBZ.CONFIG.VOLCANO_V2 = true;
  if (CBZ.CONFIG.VOLCANO_PYRO == null) CBZ.CONFIG.VOLCANO_PYRO = true;
  // false = the caller keeps its old THREE.Points ash column (see V.column)
  if (CBZ.CONFIG.VOLCANO_COLUMN == null) CBZ.CONFIG.VOLCANO_COLUMN = true;
  if (CBZ.CONFIG.VOLCANO_LAHAR == null) CBZ.CONFIG.VOLCANO_LAHAR = true;
  if (CBZ.CONFIG.VOLCANO_ASH_LOAD == null) CBZ.CONFIG.VOLCANO_ASH_LOAD = true;

  const V = {};
  // live census for CBZ.volcanoAudit() — measured, never counted in source
  const census = { lava: 0, pyro: 0, lahar: 0, ash: 0, column: 0, lights: 0, tris: 0 };
  const LIVE = { lava: [], pyro: [], lahar: [], ash: [], column: [] };

  function h01(x, z, salt) { return CBZ.hash01 ? CBZ.hash01(x, z, salt | 0) : 0.5; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function q(lo, hi) { return CBZ.qScale ? CBZ.qScale(lo, hi) : hi; }
  function qi(lo, hi) { return Math.max(1, Math.round(q(lo, hi))); }
  const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _c3 = new THREE.Color();

  // hex ramp: three stops, t in 0..1
  function ramp3(t, a, b, c, out) {
    t = clamp(t, 0, 1);
    if (t < 0.5) { _c1.setHex(a); _c2.setHex(b); return out.copy(_c1).lerp(_c2, t * 2); }
    _c1.setHex(b); _c2.setHex(c); return out.copy(_c1).lerp(_c2, (t - 0.5) * 2);
  }

  function flatGround() { return 0; }

  /* ---- ONE SOFT RADIAL TEXTURE for every additive glow in this file.
     Built once, shared by heat haze and by the pyroclastic front's dust,
     so the whole volcano costs exactly one texture upload. ---- */
  let _glowTex = null;
  function glowTex() {
    if (_glowTex) return _glowTex;
    const S = 64, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const g = cv.getContext("2d");
    const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.35, "rgba(255,222,170,0.62)");
    rg.addColorStop(1, "rgba(255,180,110,0)");
    g.fillStyle = rg; g.fillRect(0, 0, S, S);
    _glowTex = new THREE.CanvasTexture(cv);
    return _glowTex;
  }

  /* ============================================================
     THE FALL LINE — the one piece of terrain reasoning the whole
     file shares, and the reason a hazard READS as obeying the
     mountain instead of being drawn on top of it.

     Water, lava, ash-avalanches and mud all go the same way: the
     steepest way down. So this walks the height field, probing a fan
     of headings each step and steering toward the lowest one, with a
     turn rate that is the ONE difference between the hazards:

       lava / pyroclastic   turn 0.45 — momentum-carrying, they run
                            fairly straight down the cone's face
       lahar (channel:true) turn 0.8  — water-like, it hunts the
                            valley and will follow it around a bend

     Returns { pts:[{x,z,y}], seg (m), total (m) } — pts[0] is the vent.
     ============================================================ */
  function fallLine(o) {
    o = o || {};
    const groundAt = o.groundAt || flatGround;
    const step = o.step > 0 ? +o.step : 3;
    const count = Math.max(2, Math.round(o.count || 24));
    const turn = o.channel ? 0.8 : (o.turn != null ? +o.turn : 0.45);
    const wander = o.wander != null ? +o.wander : 0.16;
    const salt = o.salt | 0;
    const probe = step * 1.15;
    let x = +o.x || 0, z = +o.z || 0;
    let b = o.bearing;
    if (b == null) {
      // no bearing given: pick the steepest descent over the full circle
      let bestH = 1e9;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const hh = groundAt(x + Math.cos(a) * probe, z + Math.sin(a) * probe);
        if (hh < bestH) { bestH = hh; b = a; }
      }
      if (b == null) b = 0;
    }
    const pts = [{ x: x, z: z, y: groundAt(x, z) }];
    for (let i = 1; i < count; i++) {
      // fan of candidate headings inside +-52 degrees of the current one.
      // THE TIE-BREAK IS LOAD-BEARING: on FLAT ground every probe returns the
      // same height, and a first-wins scan then turns hard to one side every
      // step and spirals the flow into a snail shell. The epsilon penalty on
      // |k| makes "straight on" win any tie, so a flow that reaches the plain
      // simply runs out in the direction it arrived.
      let best = b, bestH = 1e9;
      for (let k = -3; k <= 3; k++) {
        const a = b + (k / 3) * 0.91;
        const hh = groundAt(x + Math.cos(a) * probe, z + Math.sin(a) * probe)
          + Math.abs(k) * 1e-4;
        if (hh < bestH) { bestH = hh; best = a; }
      }
      // steer, then a hash-stable wobble so two flows off the same peak
      // are different rivers and not two copies of one ruler
      let d = best - b;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      b += d * turn + (h01(x, z, salt + i) - 0.5) * wander;
      x += Math.cos(b) * step;
      z += Math.sin(b) * step;
      pts.push({ x: x, z: z, y: groundAt(x, z) });
    }
    return { pts: pts, seg: step, total: step * (count - 1) };
  }
  V.fallLine = fallLine;

  // arc-length sample of a fall line at distance s (metres from the vent)
  function pathAt(path, s, out) {
    const P = path.pts, seg = path.seg;
    if (s <= 0) { out.set(P[0].x, P[0].y, P[0].z); return out; }
    const fi = s / seg, i = Math.floor(fi);
    if (i >= P.length - 1) { const p = P[P.length - 1]; out.set(p.x, p.y, p.z); return out; }
    const t = fi - i, a = P[i], b2 = P[i + 1];
    out.set(a.x + (b2.x - a.x) * t, a.y + (b2.y - a.y) * t, a.z + (b2.z - a.z) * t);
    return out;
  }
  V.pathAt = pathAt;

  // signed along/perp coordinates of (x,z) against the polyline, live length only
  function pathCoord(path, x, z, liveLen) {
    const P = path.pts, seg = path.seg;
    const nMax = Math.min(P.length - 1, Math.max(1, Math.ceil((liveLen == null ? 1e9 : liveLen) / seg)));
    let bestPerp = 1e9, bestS = -1;
    for (let i = 0; i < nMax; i++) {
      const a = P[i], b2 = P[i + 1];
      const dx = b2.x - a.x, dz = b2.z - a.z;
      const L2 = dx * dx + dz * dz || 1;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / L2;
      t = clamp(t, 0, 1);
      const px = a.x + dx * t, pz = a.z + dz * t;
      const perp = Math.hypot(x - px, z - pz);
      if (perp < bestPerp) { bestPerp = perp; bestS = (i + t) * seg; }
    }
    return { s: bestS, perp: bestPerp };
  }
  V.pathCoord = pathCoord;

  /* ============================================================
     LAVA FLOW — opaque crust + incandescent channel.

     OWNER, 2026-08-06: "all the magma shoots out at once instead of
     dripping down the side, which it's very viscous in real life. It
     slowly comes down." He is right on both counts, and the second one
     is the reason the first one looked wrong.

     THE MEASURED TRUTH. A pahoehoe flow front advances at 1-10 METRES
     PER HOUR. The fastest thing anybody calls an ordinary lava flow —
     the 1859 Mauna Loa a'a — averaged 133 m/hour, which is 0.037 m/s.
     This file used to run its fronts at 4.2-6.8 m/s: between one and
     six HUNDRED times too fast, i.e. the flow arrived at the bottom of
     the cone at a jog, which is exactly "it shoots out at once".

     AND IT DOES NOT ADVANCE SMOOTHLY. The front of a real flow is
     hundreds of TOES. Each toe runs for a few minutes, stalls, INFLATES
     as lava keeps being pumped into a bag that has already skinned over,
     and then the chilled skin splits — usually at the seam between two
     toes — and a new toe breaks out. So the front's motion is stall,
     swell, lurch, stall. A constant-velocity ribbon can never read as
     viscous no matter how slow you make it, because viscosity is not a
     speed, it is a PACE.

     Both facts are now in the geometry: `lobeK()` is the stall/breakout
     envelope, the front decelerates as it lengthens and cools, and the
     live tip is pinched in and stood UP into the blunt 1-3 m rubble
     wall an a'a front actually is. A game still has to compress an
     hour into twenty seconds — but it compresses the RATE, not the
     CHARACTER.

     (Sources: Oregon State Volcano World flow rates + pahoehoe/a'a,
     USGS lava-flow-forms.)
     ============================================================ */
  const LAVA_COLS = 5;              // crust columns across the flow
  const LAVA_U = [-1, -0.56, 0, 0.56, 1];
  const CH_COLS = 3;
  const CH_U = [-1, 0, 1];

  V.lavaFlow = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const groundAt = o.groundAt || flatGround;
    const width = o.width > 0 ? +o.width : 5.5;
    const halfW = width * 0.5;
    const len = o.len > 0 ? +o.len : 40;
    const speed = o.speed > 0 ? +o.speed : 5;
    const salt = o.salt != null ? (o.salt | 0) : 4711;
    const seg = Math.max(2.2, width * 0.85);
    const path = fallLine({
      x: o.x, z: o.z, groundAt: groundAt, bearing: o.bearing,
      step: seg, count: Math.ceil(len / seg) + 1, salt: salt, wander: 0.2,
    });
    const N = path.pts.length;

    // ---- per-station shape, hashed off the station's own world position so
    //      the river's outline is identical on every client ----
    const wProf = new Float32Array(N);     // crust half-width multiplier
    const chProf = new Float32Array(N);    // channel half-width multiplier
    const hot0 = new Float32Array(N);      // incandescence at birth
    for (let i = 0; i < N; i++) {
      const p = path.pts[i], u = i / (N - 1);
      // a flow LEAVES the vent narrow and FANS OUT as the ground flattens
      wProf[i] = (0.5 + 0.72 * Math.pow(u, 0.7)) * (0.84 + 0.32 * h01(p.x, p.z, salt + 11));
      // the channel pinches shut where the crust has welded across it
      const gap = h01(p.x, p.z, salt + 23);
      chProf[i] = gap < 0.19 ? 0.05 : (0.16 + 0.34 * gap);
      // temperature falls downstream — this is the whole colour story
      hot0[i] = clamp(1.06 - 0.85 * u + (h01(p.x, p.z, salt + 37) - 0.5) * 0.16, 0.06, 1);
    }

    // ---- CRUST: opaque, lit, flat-shaded, thickening ----
    const cPos = new Float32Array(N * LAVA_COLS * 3);
    const cCol = new Float32Array(N * LAVA_COLS * 3);
    const cIdx = new Uint16Array(Math.max(1, (N - 1) * (LAVA_COLS - 1) * 6));
    let ii = 0;
    for (let i = 0; i < N - 1; i++) {
      for (let c = 0; c < LAVA_COLS - 1; c++) {
        const a = i * LAVA_COLS + c, b2 = a + 1, d = a + LAVA_COLS, e = d + 1;
        cIdx[ii++] = a; cIdx[ii++] = d; cIdx[ii++] = b2;
        cIdx[ii++] = b2; cIdx[ii++] = d; cIdx[ii++] = e;
      }
    }
    const crustGeo = new THREE.BufferGeometry();
    crustGeo.setAttribute("position", new THREE.BufferAttribute(cPos, 3));
    crustGeo.setAttribute("color", new THREE.BufferAttribute(cCol, 3));
    crustGeo.setIndex(new THREE.BufferAttribute(cIdx, 1));
    /* r128 FACT: MeshLambertMaterial does NOT support flatShading — it warns
       and silently ignores it (flatShading lives on Phong/Standard/Normal).
       A crust that is not faceted is not a crust, so this is Phong with the
       specular term switched off: Lambert's diffuse look, with the flat
       normals that make the levees read as broken rock. */
    const crustMat = new THREE.MeshPhongMaterial({
      vertexColors: true, flatShading: true, shininess: 0, specular: 0x000000,
      side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const crust = new THREE.Mesh(crustGeo, crustMat);
    crust.frustumCulled = false;
    crust.renderOrder = 2;
    parent.add(crust);

    // ---- CHANNEL: opaque, UNLIT (= incandescent) ----
    const kPos = new Float32Array(N * CH_COLS * 3);
    const kCol = new Float32Array(N * CH_COLS * 3);
    const kIdx = new Uint16Array(Math.max(1, (N - 1) * (CH_COLS - 1) * 6));
    ii = 0;
    for (let i = 0; i < N - 1; i++) {
      for (let c = 0; c < CH_COLS - 1; c++) {
        const a = i * CH_COLS + c, b2 = a + 1, d = a + CH_COLS, e = d + 1;
        kIdx[ii++] = a; kIdx[ii++] = d; kIdx[ii++] = b2;
        kIdx[ii++] = b2; kIdx[ii++] = d; kIdx[ii++] = e;
      }
    }
    const chGeo = new THREE.BufferGeometry();
    chGeo.setAttribute("position", new THREE.BufferAttribute(kPos, 3));
    chGeo.setAttribute("color", new THREE.BufferAttribute(kCol, 3));
    chGeo.setIndex(new THREE.BufferAttribute(kIdx, 1));
    const chMat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide, fog: true,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    const chan = new THREE.Mesh(chGeo, chMat);
    chan.frustumCulled = false;
    chan.renderOrder = 3;
    parent.add(chan);

    // ---- HEAT HAZE: the ONLY transparent thing here, and it floats ABOVE
    //      the rock rather than being made of it ----
    const hazeN = o.haze === false ? 0 : qi(3, Math.max(4, Math.min(12, Math.round(N * 0.6))));
    const hazeMat = new THREE.SpriteMaterial({
      map: glowTex(), color: 0xff8636, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    });
    const haze = [];
    for (let i = 0; i < hazeN; i++) {
      const s = new THREE.Sprite(hazeMat);
      s.scale.set(width * 1.6, width * 1.6, 1);
      s.renderOrder = 8;
      s.visible = false;
      parent.add(s);
      haze.push({ sp: s, u: (i + 0.5) / hazeN, ph: Math.random() * 6.28 });
    }

    // ---- POOLED LIGHT: budget-conscious, and the reason a night eruption
    //      paints the hillside instead of floating on it ----
    let light = null;
    if (o.light !== false && CBZ.CONFIG.VOLCANO_V2 !== false) {
      light = new THREE.PointLight(0xff6a1e, 0, Math.max(24, width * 6), 2);
      light.castShadow = false;
      parent.add(light);
      census.lights++;
    }

    let adv = Math.min(seg * 1.05, len);   // metres of flow laid down
    let age = 0, dead = false, colT = 0;
    let setT = -1;                         // >=0 once harden() has been called
    const _v = new THREE.Vector3();

    /* THE TOE CYCLE. Two incommensurate slow sines multiplied together give
       an irregular train of breakouts with genuinely dead ground between them
       — long stalls, then a short lurch — which one sine cannot do and a
       random walk cannot do deterministically. Hash-phased off the vent, so
       two flows off the same summit never lurch on the same beat and every
       client sees the same lurches. */
    const lobePh = h01(o.x || 0, o.z || 0, salt + 61) * 6.28;
    function lobeRaw(a) {
      const s = Math.sin(a * 0.85 + lobePh) * Math.sin(a * 0.31 + lobePh * 1.7);
      return 0.22 + 2.6 * Math.pow(Math.max(0, s), 1.2);
    }
    /* `speed` MUST MEAN THE MEAN FRONT SPEED, so the envelope is normalised
       against its own average — sampled here rather than hard-coded, because a
       hard-coded constant silently rescales the whole hazard the first time
       anybody touches the shape. 240 samples over the beat period is exact
       enough that the flow's total run is within a metre of speed*duration. */
    let lobeNorm = 0;
    for (let k = 0; k < 240; k++) lobeNorm += lobeRaw(k * 0.25);
    lobeNorm = 240 / Math.max(0.001, lobeNorm);
    function lobeK(a) { return lobeRaw(a) * lobeNorm; }
    // when each station was actually reached — see writeStations' inflation note
    const bornT = new Float32Array(N).fill(-1);
    bornT[0] = 0; bornT[1] = 0;

    function writeStations(from, to) {
      const setK = setT >= 0 ? clamp(setT / 9, 0, 1) : 0;
      for (let i = from; i <= to && i < N; i++) {
        const p = path.pts[i];
        /* THICKNESS IS INFLATION. A stalled toe does not stop being fed — the
           lava keeps arriving under a skin that has already chilled, so the
           lobe SWELLS in place. That is why a flow that has sat still for a
           minute is the thickest part of the whole thing, and it is why the
           levees stand proud of the grass. `bornT` is when this station was
           actually reached, stamped by update(), because the front no longer
           advances at a constant rate and i*seg/speed would now be fiction. */
        const born = bornT[i] < 0 ? age : bornT[i];
        const localAge = clamp(age - born, 0, 60);
        let thick = 0.2 + 0.62 * (localAge / (localAge + 5)) + 0.4 * wProf[i] * 0.25;
        let hw = halfW * wProf[i];
        /* THE FRONT IS A BLUNT WALL. An a'a front is a 1-3 m bank of rubble
           being bulldozed forward, not a taper that thins to nothing — the
           live tip is therefore pinched narrow and stood UP. Without this the
           slow flow just looked like a painted stripe getting longer. */
        const toe = clamp(1 - (adv - i * seg) / (seg * 1.7), 0, 1);
        hw *= 1 - 0.40 * toe;
        thick *= 1 + 0.75 * toe;
        // cooling: local age, plus the whole flow going cold once it has set
        const cool = clamp(Math.max(localAge / 26, setK), 0, 1);
        const hot = hot0[i] * (1 - 0.78 * cool) * (1 - setK);
        // heading normal for the lateral offset
        const a = path.pts[Math.max(0, i - 1)], b2 = path.pts[Math.min(N - 1, i + 1)];
        let nx = -(b2.z - a.z), nz = (b2.x - a.x);
        const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;

        for (let c = 0; c < LAVA_COLS; c++) {
          const u = LAVA_U[c], off = (i * LAVA_COLS + c) * 3;
          const au = Math.abs(u);
          cPos[off] = p.x + nx * u * hw;
          cPos[off + 2] = p.z + nz * u * hw;
          // convex cross-section: crown in the middle, feathered at the levee
          cPos[off + 1] = p.y + 0.05 + thick * (0.28 + 0.72 * (1 - au * au));
          // COLOUR: black basalt at the levee, scorched red-brown inboard.
          // A rock crust never goes bright — the brightness lives in the
          // channel mesh, which is the whole point of the split.
          const grain = 0.82 + 0.36 * h01(cPos[off], cPos[off + 2], salt + 5);
          ramp3(clamp((1 - au) * (0.35 + 0.65 * hot), 0, 1), 0x241b16, 0x3b241a, 0x6d2f12, _c3);
          cCol[off] = _c3.r * grain;
          cCol[off + 1] = _c3.g * grain;
          cCol[off + 2] = _c3.b * grain;
        }
        // the channel: white-yellow at 1150 C, orange, then dull red as it cools
        const chw = halfW * chProf[i] * (1 - 0.55 * cool);
        const cy = p.y + 0.05 + thick * 1.0 + 0.03;
        for (let c = 0; c < CH_COLS; c++) {
          const u = CH_U[c], off = (i * CH_COLS + c) * 3;
          kPos[off] = p.x + nx * u * chw;
          kPos[off + 2] = p.z + nz * u * chw;
          kPos[off + 1] = cy;
          // edges of the channel are cooler than its middle
          const edge = 1 - Math.abs(u) * 0.42;
          ramp3(clamp(hot * edge, 0, 1), 0x4a1103, 0xe8560a, 0xfff3c4, _c3);
          kCol[off] = _c3.r; kCol[off + 1] = _c3.g; kCol[off + 2] = _c3.b;
        }
      }
    }
    writeStations(0, 1);

    const handle = {
      kind: "lava", group: crust, path: path, mesh: crust, channel: chan,
      get length() { return adv; },
      get tip() {
        pathAt(path, adv, _v);
        return { x: _v.x, y: _v.y, z: _v.z };
      },
      update(dt) {
        if (dead) return handle;
        age += dt;
        if (setT >= 0) setT += dt;
        const was = adv;
        /* STALL, SWELL, LURCH. `lobeK` is the toe cycle; the second term is
           the flow running out of push — it is fed from a vent at a fixed
           rate, so the further it has already gone the more of that supply is
           spent keeping the length it has hot, and the front creeps to a
           halt rather than stopping at a hard cap. */
        if (setT < 0) {
          const spent = 1 / (1 + 2.2 * (adv / Math.max(1, len)));
          adv = Math.min(len, adv + speed * lobeK(age) * spent * dt);
        }
        const st = Math.min(N - 1, Math.floor(adv / seg) + 1);
        for (let i = 0; i <= st && i < N; i++) if (bornT[i] < 0) bornT[i] = age;
        /* Rewrite the whole live ribbon: N is a couple of dozen stations, so
           this is cheaper than tracking dirty ranges and it lets the ENTIRE
           flow cool, thicken and inflate instead of only its front.

           A FINISHED SCAR COSTS NOTHING. Once the deposit has gone fully cold
           its vertices and colours can never change again, so it stops paying
           for a rewrite and a computeVertexNormals() every 0.12 s — which
           matters now that a match can be carrying a dozen of these. */
        const frozen = setT > 9;
        colT += dt;
        if (!frozen && (adv !== was || colT > 0.12)) {
          colT = 0;
          writeStations(0, st);
          crustGeo.attributes.position.needsUpdate = true;
          crustGeo.attributes.color.needsUpdate = true;
          chGeo.attributes.position.needsUpdate = true;
          chGeo.attributes.color.needsUpdate = true;
          crustGeo.setDrawRange(0, Math.max(0, st) * (LAVA_COLS - 1) * 6);
          chGeo.setDrawRange(0, Math.max(0, st) * (CH_COLS - 1) * 6);
          crustGeo.computeVertexNormals();
        }
        if (frozen) return handle;
        // runtime-only flicker (allowed to be non-deterministic): the whole
        // channel breathes as one, which costs one uniform instead of a
        // per-vertex rewrite
        const fl = 0.9 + 0.12 * Math.sin(age * 5.3) + Math.random() * 0.04;
        chMat.color.setScalar(clamp(fl, 0.7, 1.08));

        // a set flow stops being a light source before it stops being a shape
        const glowK = setT >= 0 ? clamp(1 - setT / 9, 0, 1) : 1;
        hazeMat.opacity = 0.3 * glowK;
        for (let i = 0; i < haze.length; i++) {
          const H = haze[i], s = adv * H.u;
          if (s < 0.5 || glowK <= 0.02) { H.sp.visible = false; continue; }
          pathAt(path, s, _v);
          H.sp.visible = true;
          H.sp.position.set(
            _v.x + Math.sin(age * 0.9 + H.ph) * width * 0.3,
            _v.y + 1.4 + 0.7 * Math.sin(age * 1.6 + H.ph),
            _v.z + Math.cos(age * 0.8 + H.ph) * width * 0.3
          );
          const sc = width * (1.2 + 0.35 * Math.sin(age * 1.1 + H.ph));
          H.sp.scale.set(sc, sc, 1);
        }
        if (light) {
          pathAt(path, adv * 0.82, _v);
          light.position.set(_v.x, _v.y + 2.2, _v.z);
          light.intensity = (1.5 + 0.35 * Math.sin(age * 4.1)) * glowK;
        }
        return handle;
      },
      // is (x,z) ON the flow? The lethal corridor IS the drawn ribbon —
      // the same wProf the geometry used, so what kills you is what glows.
      hitTest(x, z) {
        if (setT >= 0) return false;          // set rock is terrain, not lava
        const c = pathCoord(path, x, z, adv);
        if (c.s < 0 || c.s > adv) return false;
        const i = clamp(Math.round(c.s / seg), 0, N - 1);
        return c.perp < halfW * wProf[i] * 0.95;
      },
      // 0..1 "how much of its run has it made" — for threat maps
      progress() { return adv / len; },
      /* IT COOLS, IT DOES NOT EVAPORATE. Lava that has stopped is ROCK, and
         the mountainside keeps it — the same contract the lahar's harden()
         already has, so a caller can park both in the same scar list. The
         front freezes where it stood, the channel goes out over ~9 s and what
         is left is a black basalt tongue down the cone for the rest of the
         match. `hardened` lets a caller stop hit-testing it: cold rock is
         terrain, not a hazard. */
      harden() { if (setT < 0) setT = 0; return handle; },
      get hardened() { return setT >= 0; },
      dispose() {
        if (dead) return;
        dead = true;
        parent.remove(crust); parent.remove(chan);
        crustGeo.dispose(); crustMat.dispose();
        chGeo.dispose(); chMat.dispose();
        for (let i = 0; i < haze.length; i++) parent.remove(haze[i].sp);
        hazeMat.dispose();
        if (light) { parent.remove(light); census.lights--; }
        const k = LIVE.lava.indexOf(handle); if (k >= 0) LIVE.lava.splice(k, 1);
      },
    };
    census.lava++;
    LIVE.lava.push(handle);
    return handle;
  };

  /* ============================================================
     THE ERUPTION COLUMN.

     OWNER, 2026-08-06: "it shoots out ash that just looks like a bunch
     of floating rocks, separate rocks instead of one ash cloud like it
     should be. It comes out like several cyclic or circular clouds."

     That was an exact description of what the code did. The column was
     three THREE.Points clouds — 260 + 200 + 300 untextured square dots
     scattered through a 15 m cylinder 52 m tall. Points with no map are
     hard-edged squares, and a few hundred of them spread over that
     volume are individually resolvable at every distance the player
     ever sees the mountain from. The eye counts them. Counting is the
     failure: a cloud is a thing whose parts you CANNOT count.

     The fix is the one this file already proved on the pyroclastic
     flow: MANY HEAVILY OVERLAPPING OPAQUE LIT BILLOWS. Overlap is what
     turns spheres into a cloud; separation is what turns them into
     rocks. Nothing here is transparent and nothing here is a sprite.

     THE SHAPE IS THE REAL THREE-REGION STRUCTURE, because the three
     regions are what makes a column read as a column instead of a
     smoke pillar:

       GAS THRUST    the lowest ~1-2 km, driven by momentum alone —
                     particles leave the vent at >100 m/s. NARROW, fast,
                     and the only part that is incandescent.
       CONVECTIVE    entrained air heats, expands and takes over; this
                     region does most of the climbing (tens to 200+ m/s)
                     and WIDENS steadily as it entrains.
       UMBRELLA      at neutral buoyancy the column stops rising and
                     goes SIDEWAYS — St Helens' umbrella spread at
                     >55 m/s. This is the flat-topped mushroom cap, and
                     it is the silhouette everyone recognises.

     It also has to BUILD. A column is not present at t=0 — it climbs
     out of the vent, which is why `update(dt, vigour)` chases a live
     top rather than drawing the finished shape on frame one.

     (Sources: Sparks 1986, The dimensions and dynamics of volcanic
     eruption columns; USGS/Wikipedia eruption-column structure.)
     ============================================================ */
  // Ash greys, running PALER with altitude: the low column is dense and
  // dark, the umbrella is fine ash lit from all sides.
  const COL_ASH = [0x2e2b28, 0x3b3733, 0x4a4540, 0x5d574f, 0x716a60, 0x8a8278];
  let _colMats = null;
  function colMats() {
    if (_colMats) return _colMats;
    _colMats = COL_ASH.map(function (c) { return new THREE.MeshLambertMaterial({ color: c }); });
    /* THE GAS-THRUST BASE IS GLOWING ASH, NOT A SUN. It is incandescent —
       that part is real — but the first build gave it emissive 0xd44b08 under
       an eruption sky whose own sun is 0xff6a3a, and the two compounded into a
       saturated yellow ball hanging over the summit. Matched to the
       pyroclastic flow's basal fringe instead, which is the same physical
       thing (hot gas, not hot rock) and was already tuned against this sky. */
    _colMats.push(new THREE.MeshLambertMaterial({
      color: 0x4d2a1c, emissive: 0x8a2c06, emissiveIntensity: 1,
    }));
    return _colMats;
  }

  V.column = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const R = o.radius > 0 ? +o.radius : 12;        // vent-scale radius
    const H = o.height > 0 ? +o.height : 120;       // full column height
    const salt = o.salt != null ? (o.salt | 0) : 5501;
    const cx = +o.x || 0, cz = +o.z || 0, cy = +o.y || 0;
    const rise = o.rise > 0 ? +o.rise : 0.19;       // fraction of H per second
    const bend = o.bend != null ? +o.bend : 1;      // how hard the wind leans it

    // radius of the column at normalised altitude u — the three regions
    function radAt(u) {
      if (u < 0.12) return R * (0.34 + 1.56 * (u / 0.12));
      if (u < 0.70) return R * (1.90 + 2.10 * ((u - 0.12) / 0.58));
      // the umbrella bulges out and then rounds off at the very top
      return R * (4.00 + 3.10 * Math.sin(((u - 0.70) / 0.30) * Math.PI * 0.86));
    }
    // how fast the column is still climbing at u — fast low, dead in the cap
    function riseAt(u) {
      if (u < 0.12) return 1;
      if (u < 0.70) return 1 - 0.52 * ((u - 0.12) / 0.58);
      return 0.48 * (1 - (u - 0.70) / 0.30) + 0.04;
    }

    const geo = billowGeo();
    const mats = colMats();
    const grp = new THREE.Group();
    grp.frustumCulled = false;
    parent.add(grp);

    const N = qi(26, 68);
    const JET = Math.max(4, Math.round(N * 0.15));   // billows pinned to the base
    const blobs = [];
    for (let i = 0; i < N; i++) {
      const jet = i < JET;
      /* STRATIFIED, NOT RANDOM. Scattering u uniformly at random leaves
         altitude bands with no billow in them, and a band with a gap in it is
         precisely the "several separate circular clouds" complaint. Marching u
         with the index guarantees the column is continuous from vent to cap
         before any jitter is added. */
      const q0 = jet ? (i / JET) : ((i - JET) / (N - JET));
      blobs.push({
        m: new THREE.Mesh(geo, jet ? mats[6] : mats[Math.min(5, (i * 7) % 6)]),
        q: q0,
        jet: jet,
        ang: Math.random() * 6.28,
        rr: Math.sqrt(Math.random()),                 // even area fill, not centre-heavy
        sz: 0.62 + Math.pow(Math.random(), 1.5) * 0.72,
        ph: Math.random() * 6.28,
        spin: (Math.random() - 0.5) * 0.35,
        roll: 0.88 + Math.random() * 0.24,            // per-billow rise jitter
      });
      grp.add(blobs[i].m);
    }

    let t = 0, topU = 0, dead = false, vig = 1;
    let wx = o.windX != null ? +o.windX : 0, wz = o.windZ != null ? +o.windZ : 0;

    const handle = {
      kind: "column", group: grp,
      get topY() { return cy + H * topU; },
      get vigour() { return vig; },
      wind(x, z) { wx = +x || 0; wz = +z || 0; return handle; },
      /* update(dt, vigour) — vigour 0..1 is how hard the vent is erupting.
         The live top CHASES it, so the column climbs when the eruption
         starts and slumps when it stops instead of popping in and out. */
      update(dt, vigour) {
        if (dead) return handle;
        t += dt;
        if (vigour != null) vig = clamp(+vigour || 0, 0, 1);
        topU += (vig - topU) * Math.min(1, dt * (vig > topU ? 0.55 : 0.28));
        if (topU < 0.02) {
          for (let i = 0; i < blobs.length; i++) blobs[i].m.visible = false;
          return handle;
        }
        for (let i = 0; i < blobs.length; i++) {
          const B = blobs[i];
          /* A WRAPPING PHASE, NOT AN ALTITUDE. The first build advanced each
             billow's altitude directly and recycled it at the top, and within
             a few seconds every billow had drained out of the middle of the
             column and piled into the umbrella — a glowing lump at the vent, a
             brown lump in the sky, and NOTHING BETWEEN THEM. That is the
             owner's "several circular clouds" reappearing from the other
             direction, and it is inherent to per-billow altitude: any spread
             in rise rate empties some band.

             So the state is a phase that wraps, uniformly spaced at build
             time and advanced at a near-common rate, and ALTITUDE IS DERIVED
             from it. The column can never open a gap, because the phases can
             never bunch. `q^0.62` is what puts the physics back: it maps
             uniform phase onto altitudes crowded toward the top, so material
             piles up and slows down where a real column reaches neutral
             buoyancy. Density and deceleration in the umbrella both fall out
             of one exponent. */
          B.q += rise * B.roll * dt * (0.4 + 0.6 * vig);
          if (B.q >= 1) B.q -= 1;
          /* 0.72, not 0.5 and not 1.0. At 1.0 the phase maps straight to
             altitude and the umbrella carries no more material than the stem,
             which is wrong and looks like a chimney; below ~0.6 so much piles
             into the cap that the STEM goes beaded and you can count the
             billows in it again. */
          const u = B.jet ? B.q * 0.085 : Math.pow(B.q, 0.72);
          B.m.visible = true;
          /* THE COLUMN GROWS OUT OF THE VENT rather than fading in at full
             height: the live top scales BOTH the altitude and the radius, so a
             young column is a small column all the way up — which is also why
             there is no band to be starved while it builds. */
          /* THE GAS THRUST IS A THROAT, NOT A NECKLACE. Its billows sit on the
             same ring as everything else, and at the vent that ring is wide
             enough relative to how FEW of them there are that they read as
             separate glowing lumps floating over the summit — which is the
             owner's "floating rocks" complaint, reintroduced by the fix for
             it. Pulled hard onto the axis so the hot part is one welded throat
             coming out of the crater. */
          const rad = radAt(u) * (0.42 + 0.58 * topU) * (B.jet ? 0.42 : 1);
          // the billows churn about their own anchor — a column boils, and a
          // ring of blobs that only translates reads as a smoke ring
          const churn = 1 + 0.22 * Math.sin(t * 1.6 + B.ph);
          const a = B.ang + t * (B.jet ? 0.5 : 0.16) * (1 - u * 0.6);
          /* THE WIND LEANS IT, AND THE LEAN GROWS WITH ALTITUDE. A plume is
             advected by a wind that has had longer to act the higher it goes,
             so the offset goes as u^1.7 — that curve IS the classic bent
             column, and it is the same wind the ashfall wedge uses. */
          const lean = Math.pow(u, 1.7) * H * topU * 0.42 * bend;
          B.m.position.set(
            cx + Math.cos(a) * rad * B.rr * churn + wx * lean,
            cy + H * topU * u + Math.sin(t * 1.1 + B.ph) * R * 0.14,
            cz + Math.sin(a) * rad * B.rr * churn + wz * lean
          );
          /* SIZE MUST OUTRUN SPACING, BUT NOT BY MUCH. Each billow is scaled
             off the LOCAL column radius so the lumps widen with the column and
             the overlap never opens up — but the first build used 0.62 of the
             radius as a billow RADIUS, i.e. lumps wider than the column they
             were making, and one of them filled the sky. Roughly a third of
             the local radius puts about six billows across the diameter, which
             is the density that reads as boiling rather than as beanbags. */
          const sc = rad * B.sz * (0.42 + 0.07 * Math.sin(t * 2.1 + B.ph)) * (B.jet ? 1.5 : 1);
          B.m.scale.set(sc, sc * (u > 0.70 ? 0.66 : 0.9), sc);
          B.m.rotation.y += B.spin * dt;
          B.m.rotation.x += B.spin * 0.4 * dt;
        }
        return handle;
      },
      dispose() {
        if (dead) return;
        dead = true;
        for (let i = 0; i < blobs.length; i++) grp.remove(blobs[i].m);
        parent.remove(grp);
        const k = LIVE.column.indexOf(handle); if (k >= 0) LIVE.column.splice(k, 1);
      },
    };
    census.column++;
    LIVE.column.push(handle);
    return handle;
  };

  /* ============================================================
     PYROCLASTIC DENSITY CURRENT — the signature killer.

     Real numbers: 400+ mph, 400-700 C, and a bulk density high enough
     that it hugs the ground and pours over ridges instead of rising.
     Nobody in its path survives; there is no cover mechanic and no
     mitigation — the survival verb is EVACUATION, which is why the
     path is drawn along the fall line and telegraphed before it moves.

     THE LOOK, and why it is not the "orange floating rocks" the owner
     rightly hates: many HEAVILY OVERLAPPING smooth-shaded billows, all
     OPAQUE and LIT, sizes spread over 3x, each churning about its own
     anchor on its own phase. Overlap is what turns spheres into a
     cloud; separation is what turns them into rocks. The only hot
     colour is a small basal fringe (emissive) — the incandescence sits
     UNDER the front where the entrained air is burning, exactly where
     the photographs put it.
     ============================================================ */
  const _pyroGeo = { s: null };
  function billowGeo() {
    if (!_pyroGeo.s) _pyroGeo.s = new THREE.IcosahedronGeometry(1, 1);
    return _pyroGeo.s;
  }
  // A density current is pulverised ROCK: cool grey-brown, not chocolate. The
  // warmth in the shot comes from the eruption's own orange sun, which is
  // correct — so the pigment itself has to start neutral or it compounds.
  const PYRO_ASH = [0x3d3a37, 0x4b4640, 0x5a534b, 0x6d6459];
  let _pyroMats = null;
  function pyroMats() {
    if (_pyroMats) return _pyroMats;
    _pyroMats = PYRO_ASH.map(function (c) {
      return new THREE.MeshLambertMaterial({ color: c });
    });
    // the basal incandescence — hot gas, not hot rock, so it is dim and red
    _pyroMats.push(new THREE.MeshLambertMaterial({
      color: 0x4d2a1c, emissive: 0x8a2c06, emissiveIntensity: 1,
    }));
    return _pyroMats;
  }

  V.pyroclastic = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const groundAt = o.groundAt || flatGround;
    const width = o.width > 0 ? +o.width : 26;
    const halfW = width * 0.5;
    const height = o.height > 0 ? +o.height : 20;
    const speed = o.speed > 0 ? +o.speed : 44;    // m/s — 6x a sprinting bot
    const len = o.len > 0 ? +o.len : 150;
    const tail = o.tail > 0 ? +o.tail : 62;
    const salt = o.salt != null ? (o.salt | 0) : 8123;
    const path = fallLine({
      x: o.x, z: o.z, groundAt: groundAt, bearing: o.bearing,
      step: 6, count: Math.ceil(len / 6) + 1, salt: salt, turn: 0.4, wander: 0.1,
    });

    /* ---- ONE LANE, TWO CONSUMERS: the geometry AND the kill test ----------
       OWNER, 2026-08-06: "it doesn't kill you correctly."

       It didn't, and this was one of the two reasons. The billows were placed
       at `lat * halfW * (0.55 + 0.75*ageK)` with |lat| up to 1.15 and then each
       drew a sphere of its own on top of that, so the cloud you SEE reaches
       about 0.82 of the half-width at the head and 1.9 at the tail. The kill
       test used a completely separately-typed 0.62 / 1.22. The band between
       the two numbers is a place where the screen is full of 600 C ash and
       nothing happens to you — which is the worst thing a hazard can do,
       because it teaches the player that the picture is a lie.

       So the two are now the same function plus one honest margin for the
       billow's own radius. This file's own law, from the lava block: WHAT
       KILLS YOU IS WHAT YOU CAN SEE. */
    function laneHalf(ageK) { return halfW * (0.55 + 0.75 * ageK); }
    function blobR(ageK) { return width * 0.23 * (0.42 + 0.5 * ageK); }
    function killHalf(ageK) { return laneHalf(ageK) * 1.05 + blobR(ageK) * 0.7; }
    // ...and it has a TOP. A surge is a ground-hugging current a couple of
    // dozen metres deep, not an infinite column: standing on something taller
    // than the flow is the one piece of cover that physically exists, and the
    // 2D-only test used to kill people who were demonstrably above it.
    function surgeTop(ageK) { return height * (0.32 + 0.85 * ageK) * 1.35 + blobR(ageK) + 2; }

    const geo = billowGeo();
    const mats = pyroMats();
    /* MANY SMALL BILLOWS, NOT A FEW BIG ONES. The first build used ~40 blobs
       at 0.4-1.0 of the flow's half-width and it read as brown balloons: at
       that size each sphere is individually legible and the eye counts them.
       Tripling the count and spreading the sizes over 3x makes the silhouette
       lumpy at every scale, which is the only thing that separates "a cloud"
       from "some spheres". They are still opaque and still overlap heavily —
       that part was right. */
    const N = qi(26, 72);
    const grp = new THREE.Group();
    grp.frustumCulled = false;
    parent.add(grp);
    const blobs = [];
    for (let i = 0; i < N; i++) {
      // the HEAD carries most of the mass: bias lags toward zero
      const lag = Math.pow(Math.random(), 1.7) * tail;
      const basal = i % 7 === 0 && lag < tail * 0.34;
      const m = new THREE.Mesh(geo, basal ? mats[4] : mats[i % 4]);
      m.castShadow = false;
      m.receiveShadow = false;
      grp.add(m);
      blobs.push({
        m: m, lag: lag, basal: basal,
        lat: (Math.random() * 2 - 1) * 1.15,
        hf: basal ? 0.1 + Math.random() * 0.18 : Math.random(),
        ph: Math.random() * 6.28,
        sz: (basal ? 0.20 : 0.22) + Math.pow(Math.random(), 1.6) * 0.62,
        spin: (Math.random() - 0.5) * 0.6,
      });
    }

    let front = 0, t = 0, dead = false;
    const _v = new THREE.Vector3();

    const handle = {
      kind: "pyro", group: grp, path: path,
      get frontS() { return front; },
      get done() { return front > path.total + tail * 0.4; },
      frontPos() { pathAt(path, Math.min(front, path.total), _v); return { x: _v.x, y: _v.y, z: _v.z }; },
      update(dt) {
        if (dead) return handle;
        t += dt;
        front += speed * dt;
        for (let i = 0; i < blobs.length; i++) {
          const B = blobs[i];
          const s = front - B.lag;
          if (s < -4 || s > path.total + 8) { B.m.visible = false; continue; }
          B.m.visible = true;
          pathAt(path, clamp(s, 0, path.total), _v);
          // heading normal so the lateral spread follows the channel
          const fi = clamp(Math.floor(s / path.seg), 0, path.pts.length - 2);
          const a = path.pts[fi], b2 = path.pts[fi + 1];
          let nx = -(b2.z - a.z), nz = (b2.x - a.x);
          const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
          // the cloud SPREADS as it runs out and rises behind the head
          const ageK = clamp(B.lag / Math.max(1, tail), 0, 1);
          const spread = laneHalf(ageK);
          const churn = 1 + 0.35 * Math.sin(t * 2.3 + B.ph);
          const gy = groundAt(_v.x, _v.z);
          B.m.position.set(
            _v.x + nx * B.lat * spread + Math.sin(t * 1.7 + B.ph) * 2.2,
            gy + height * B.hf * (0.32 + 0.85 * ageK) * churn + 1.2,
            _v.z + nz * B.lat * spread + Math.cos(t * 1.9 + B.ph) * 2.2
          );
          const sc = width * B.sz * (0.42 + 0.5 * ageK) * (0.9 + 0.16 * Math.sin(t * 2.9 + B.ph));
          B.m.scale.set(sc, sc * (B.basal ? 0.62 : 0.86), sc);
          B.m.rotation.y += B.spin * dt;
          B.m.rotation.x += B.spin * 0.5 * dt;
        }
        return handle;
      },
      /* INSIDE THE FLOW THERE IS NO SURVIVAL. This is the whole rule, and
         the return value is WHICH death it was: 1 = the head (600 C rock at
         180 km/h — instant incineration), 2 = the trailing ash cloud (still
         lethal, but it is the gas that gets you). 0 = outside, and outside
         is the only survival there is. */
      contains(x, z, y) {
        const c = pathCoord(path, x, z, Math.min(front + 6, path.total));
        if (c.s > front + 3 || c.s < front - tail * 0.9) return 0;
        // the lane widens behind the head, THROUGH THE SAME FUNCTION the
        // geometry used — see the lane note above
        const ageK = clamp((front - c.s) / Math.max(1, tail), 0, 1);
        if (c.perp >= killHalf(ageK)) return 0;
        // above the surge is above the surge, whatever you are standing on
        if (y != null) {
          pathAt(path, clamp(c.s, 0, path.total), _v);
          if (y - groundAt(x, z) > surgeTop(ageK)) return 0;
        }
        return ageK < 0.42 ? 1 : 2;
      },
      // how deep the surge is over the ground at (x,z) right now — a caller
      // that wants to draw or reason about the ceiling asks here, it does not
      // re-type the profile
      depthAt(x, z) {
        const c = pathCoord(path, x, z, Math.min(front + 6, path.total));
        if (c.s > front + 3 || c.s < front - tail * 0.9) return 0;
        const ageK = clamp((front - c.s) / Math.max(1, tail), 0, 1);
        return c.perp >= killHalf(ageK) ? 0 : surgeTop(ageK);
      },
      // 0..1 threat for the bot flee field / minimap, ahead of the front too
      threatAt(x, z) {
        const c = pathCoord(path, x, z, path.total);
        const lane = c.perp < halfW * 1.35 ? 1 - c.perp / (halfW * 1.35) : 0;
        if (!lane) return 0;
        const ahead = c.s - front;
        if (ahead < -tail) return 0;
        return clamp(lane * (ahead < 0 ? 1 : 1 - ahead / 90), 0, 1);
      },
      dispose() {
        if (dead) return;
        dead = true;
        for (let i = 0; i < blobs.length; i++) grp.remove(blobs[i].m);
        parent.remove(grp);
        const k = LIVE.pyro.indexOf(handle); if (k >= 0) LIVE.pyro.splice(k, 1);
      },
    };
    census.pyro++;
    LIVE.pyro.push(handle);
    return handle;
  };

  /* ============================================================
     LAHAR — wet concrete down the valley.

     Ash + meltwater at roughly the density and behaviour of setting
     concrete: it does not splash and it is not translucent, so the
     material is a MATTE Lambert with a chunky flat-shaded surface and
     NO specular story at all. It carries what it has already destroyed
     (boulders and logs riding the surface), it moves at river speed
     rather than avalanche speed, and when it stops it does not drain —
     it SETS, which is why harden() leaves the mesh in the world as a
     permanent grey scar instead of disposing it.
     ============================================================ */
  const LAHAR_COLS = 7;
  const LAHAR_U = [-1, -0.68, -0.32, 0, 0.32, 0.68, 1];

  V.lahar = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const groundAt = o.groundAt || flatGround;
    const width = o.width > 0 ? +o.width : 12;
    const halfW = width * 0.5;
    const len = o.len > 0 ? +o.len : 110;
    const speed = o.speed > 0 ? +o.speed : 11;    // river speed, not avalanche
    const salt = o.salt != null ? (o.salt | 0) : 2609;
    const seg = Math.max(3.5, width * 0.7);
    // channel:true — a lahar hunts the VALLEY, it does not run the fall line
    const path = fallLine({
      x: o.x, z: o.z, groundAt: groundAt, bearing: o.bearing,
      step: seg, count: Math.ceil(len / seg) + 1, salt: salt, channel: true, wander: 0.1,
    });
    const N = path.pts.length;

    const wProf = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const p = path.pts[i];
      wProf[i] = 0.62 + 0.55 * (i / (N - 1)) + 0.3 * h01(p.x, p.z, salt + 3);
    }

    const pos = new Float32Array(N * LAHAR_COLS * 3);
    const col = new Float32Array(N * LAHAR_COLS * 3);
    const idx = new Uint16Array(Math.max(1, (N - 1) * (LAHAR_COLS - 1) * 6));
    let ii = 0;
    for (let i = 0; i < N - 1; i++) {
      for (let c = 0; c < LAHAR_COLS - 1; c++) {
        const a = i * LAHAR_COLS + c, b2 = a + 1, d = a + LAHAR_COLS, e = d + 1;
        idx[ii++] = a; idx[ii++] = d; idx[ii++] = b2;
        idx[ii++] = b2; idx[ii++] = d; idx[ii++] = e;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // Phong, not Lambert — see the crust material: r128 ignores flatShading
    // on Lambert, and a smooth mud river reads as a tarmac ramp.
    const mat = new THREE.MeshPhongMaterial({
      vertexColors: true, flatShading: true, shininess: 0, specular: 0x000000,
      side: THREE.DoubleSide,
      // same neutral floor the ash deposit uses, and for the same reason: an
      // eruption's sun is 0xff6a3a and mud is not peach
      emissive: 0x14161a, emissiveIntensity: 1,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    parent.add(mesh);

    // ---- the freight: boulders and logs riding the surface ----
    const rideN = o.debris === false ? 0 : qi(3, 11);
    const bGeo = new THREE.DodecahedronGeometry(1, 0);
    const lGeo = new THREE.CylinderGeometry(0.34, 0.4, 4.4, 6);
    const bMat = new THREE.MeshPhongMaterial({ color: 0x585047, flatShading: true, shininess: 0, specular: 0x000000 });
    const lMat = new THREE.MeshPhongMaterial({ color: 0x4a3a28, flatShading: true, shininess: 0, specular: 0x000000 });
    const riders = [];
    for (let i = 0; i < rideN; i++) {
      const log = i % 3 === 2;
      const m = new THREE.Mesh(log ? lGeo : bGeo, log ? lMat : bMat);
      const sc = log ? 1 : 0.7 + Math.random() * 1.5;
      m.scale.setScalar(sc);
      m.visible = false;
      parent.add(m);
      riders.push({
        m: m, s: -Math.random() * len * 0.5, lat: (Math.random() * 2 - 1) * 0.7,
        ph: Math.random() * 6.28, spin: (Math.random() - 0.5) * 1.6, log: log,
        v: speed * (0.75 + Math.random() * 0.4),
      });
    }

    let adv = seg, t = 0, dead = false, hardT = -1;
    const _v = new THREE.Vector3();

    function writeStations(to) {
      const setK = hardT >= 0 ? clamp(hardT / 4, 0, 1) : 0;
      for (let i = 0; i <= to && i < N; i++) {
        const p = path.pts[i];
        const hw = halfW * wProf[i];
        const a = path.pts[Math.max(0, i - 1)], b2 = path.pts[Math.min(N - 1, i + 1)];
        let nx = -(b2.z - a.z), nz = (b2.x - a.x);
        const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
        // a travelling chunky wave down the channel — wet concrete heaves,
        // it does not ripple. Frozen once the deposit sets.
        const heave = setK >= 1 ? 0 : Math.sin(t * 2.1 - i * 0.8) * 0.32 * (1 - setK);
        for (let c = 0; c < LAHAR_COLS; c++) {
          const u = LAHAR_U[c], off = (i * LAHAR_COLS + c) * 3;
          const au = Math.abs(u);
          const x = p.x + nx * u * hw, z = p.z + nz * u * hw;
          pos[off] = x; pos[off + 2] = z;
          const lumps = (h01(x, z, salt + 9) - 0.5) * 0.9;
          pos[off + 1] = p.y + 0.08 + (0.75 + 0.7 * (1 - au * au)) + heave * (1 - au) + lumps;
          /* WET CONCRETE, and concrete is MID grey — the first pass was almost
             black and read as a dirt road at any distance. The set deposit is
             paler and dustier still, which is what makes the scar legible
             after the event. */
          const grain = 0.85 + 0.3 * h01(x, z, salt + 17);
          ramp3(clamp(0.25 + 0.5 * (1 - au) + setK * 0.8, 0, 1), 0x453d35, 0x655c4f, 0x968d81, _c3);
          col[off] = _c3.r * grain;
          col[off + 1] = _c3.g * grain;
          col[off + 2] = _c3.b * grain;
        }
      }
    }
    writeStations(1);

    const handle = {
      kind: "lahar", mesh: mesh, path: path,
      get length() { return adv; },
      get hardened() { return hardT >= 4; },
      update(dt) {
        if (dead) return handle;
        t += dt;
        if (hardT >= 0) hardT += dt;
        else adv = Math.min(len, adv + speed * dt);
        const st = Math.min(N - 1, Math.floor(adv / seg) + 1);
        writeStations(st);
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        geo.setDrawRange(0, Math.max(0, st) * (LAHAR_COLS - 1) * 6);
        geo.computeVertexNormals();
        for (let i = 0; i < riders.length; i++) {
          const R = riders[i];
          if (hardT < 0) {
            R.s += R.v * dt;
            if (R.s > adv - seg) R.s = Math.max(0, R.s - adv * 0.75);
          }
          if (R.s < 0.5 || R.s > adv) { R.m.visible = false; continue; }
          pathAt(path, R.s, _v);
          const fi = clamp(Math.floor(R.s / seg), 0, N - 2);
          const a = path.pts[fi], b2 = path.pts[fi + 1];
          let nx = -(b2.z - a.z), nz = (b2.x - a.x);
          const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
          R.m.visible = true;
          R.m.position.set(
            _v.x + nx * R.lat * halfW * 0.72,
            _v.y + 0.75 + (hardT >= 0 ? 0 : 0.22 * Math.sin(t * 2.6 + R.ph)),
            _v.z + nz * R.lat * halfW * 0.72
          );
          if (hardT < 0) {
            R.m.rotation.x += R.spin * dt;
            R.m.rotation.z += R.spin * 0.7 * dt;
          }
        }
        return handle;
      },
      // in the channel? returns null or {depth, dirx, dirz} — the DRAG the
      // caller applies with CBZ.body.hit, and the crush it prices with hurt
      hitTest(x, z) {
        if (hardT >= 0) return null;
        const c = pathCoord(path, x, z, adv);
        if (c.s < 0 || c.s > adv) return null;
        const i = clamp(Math.round(c.s / seg), 0, N - 1);
        const hw = halfW * wProf[i];
        if (c.perp > hw) return null;
        const a = path.pts[Math.max(0, i - 1)], b2 = path.pts[Math.min(N - 1, i + 1)];
        let dx = b2.x - a.x, dz = b2.z - a.z;
        const dl = Math.hypot(dx, dz) || 1;
        return { depth: (1 - c.perp / hw) * 1.5, dirx: dx / dl, dirz: dz / dl, s: c.s };
      },
      // it SETS. Nothing drains away; the valley keeps the scar.
      harden() { if (hardT < 0) hardT = 0; return handle; },
      dispose() {
        if (dead) return;
        dead = true;
        parent.remove(mesh); geo.dispose(); mat.dispose();
        for (let i = 0; i < riders.length; i++) parent.remove(riders[i].m);
        bGeo.dispose(); lGeo.dispose(); bMat.dispose(); lMat.dispose();
        const k = LIVE.lahar.indexOf(handle); if (k >= 0) LIVE.lahar.splice(k, 1);
      },
    };
    census.lahar++;
    LIVE.lahar.push(handle);
    return handle;
  };

  /* ============================================================
     ASHFALL WITH WEIGHT — accumulation, not weather.

     systems/weather.js already owns falling ash as an atmospheric
     term. What it cannot express is the thing that actually kills:
     ash LANDS, it does not wash off, and half a metre of it on a flat
     roof is several hundred kilograms per square metre. So this is a
     LEDGER with a picture attached — a grid of cells, each holding a
     depth in metres, each drawing a quad whose COVERAGE (not opacity)
     grows with that depth. That way the blanket creeps downwind out of
     nothing, the sheet is genuinely OPAQUE where there is ash, and
     there is no sheet at all where there is not.

     Roof cells are the same array with a caller-supplied y, so
     `roofDepth(id)` hands the disaster the number it prices through
     the structural ledger. This file never touches structural.js.
     ============================================================ */
  V.ashLoad = function (o) {
    o = o || {};
    const parent = o.parent || CBZ.scene;
    const groundAt = o.groundAt || flatGround;
    const cx = +o.cx || 0, cz = +o.cz || 0;
    const R = o.r > 0 ? +o.r : 120;
    /* CELL SIZE IS THE WHOLE LOOK. At 26 cells over a 240 m island each patch
       is 9 m across, and a 9 m quad lying on grass reads as a sheet of paper,
       not as ash — the eye resolves the individual quad. At ~70 cells the
       patches are ~3 m, small enough to read as deposit and numerous enough
       to weld into a continuous blanket where the fall has been heavy. The
       cost is paid by throttling: accumulation and the geometry rewrite share
       one 8 Hz tick, so 5000 cells cost the same per second as 700 did. */
    const NC = Math.max(6, Math.min(96, Math.round(o.cells || qi(40, 76))));
    const cell = (R * 2) / NC;
    const salt = o.salt != null ? (o.salt | 0) : 6151;
    // how much ash makes the ground READ as covered (a few cm)
    const FULL = o.full > 0 ? +o.full : 0.05;

    const cells = [];
    // i*NC+j -> cell index, so depthAt() is O(1) instead of a scan over ~500
    // cells per actor per frame (the ash DOT asks once per actor per tick)
    const grid = new Int32Array(NC * NC).fill(-1);
    for (let i = 0; i < NC; i++) {
      for (let j = 0; j < NC; j++) {
        const x = cx - R + (i + 0.5) * cell;
        const z = cz - R + (j + 0.5) * cell;
        if (Math.hypot(x - cx, z - cz) > R * 1.02) continue;
        grid[i * NC + j] = cells.length;
        /* THE GRID MUST NOT LOOK LIKE A GRID. Axis-aligned same-size quads
           read as a chequerboard the moment they saturate — the ash stops
           being a deposit and becomes a texture atlas. A hashed rotation and
           a +-18% size jitter per cell is the whole fix, and it is free:
           the patches still tile the same area, they just stop agreeing
           about where their edges are. */
        cells.push({
          x: x, z: z, y: groundAt(x, z), w: cell, d: cell, depth: 0, roof: false,
          ang: h01(x, z, salt + 71) * Math.PI * 0.5,
          jit: 0.80 + 0.40 * h01(x, z, salt + 89),
          // per-cell coverage gain: the drift does not arrive as a straight
          // edge, it mottles, and one hashed multiplier is the whole effect
          gain: 0.55 + 0.95 * h01(x, z, salt + 103),
        });
      }
    }
    const groundCells = cells.length;
    const MAXC = groundCells + Math.max(0, o.roofs || 64);

    const pos = new Float32Array(MAXC * 4 * 3);
    const col = new Float32Array(MAXC * 4 * 3);
    // r128 will happily build a Uint16 index that silently wraps past 65535
    // and draws garbage; at ~4 m cells over a big region that is reachable.
    const idx = MAXC * 4 > 65535 ? new Uint32Array(MAXC * 6) : new Uint16Array(MAXC * 6);
    for (let i = 0; i < MAXC; i++) {
      const v = i * 4, k = i * 6;
      idx[k] = v; idx[k + 1] = v + 2; idx[k + 2] = v + 1;
      idx[k + 3] = v; idx[k + 4] = v + 3; idx[k + 5] = v + 2;
    }
    /* EVERY ASH QUAD IS HORIZONTAL, FOREVER. So its normal is a constant, and
       recomputing 18,000 of them every rewrite is pure waste — it was the
       single most expensive thing in the ash field. Written once here, and
       the update path never calls computeVertexNormals() again. */
    const nrm = new Float32Array(MAXC * 4 * 3);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    /* OPAQUE. Ash is a solid deposit; the fade-in is coverage, not alpha.
       The small cool emissive is not decoration: an eruption drives the scene
       sun to 0xff6a3a, and a purely diffuse grey under an orange sun comes out
       peach. Volcanic ash is grey in every photograph ever taken of it, so a
       neutral floor under the diffuse term keeps it grey while still letting
       the eruption light it. */
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      emissive: 0x101216, emissiveIntensity: 1,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 1;
    parent.add(mesh);

    let dirty = true, wT = 0, peak = 0, dead = false;

    function writeCell(n) {
      const C = cells[n];
      const cov = clamp((C.depth / FULL) * (C.roof ? 1 : (C.gain || 1)), 0, 1);
      // quads grow from a point at their cell centre; neighbours overlap at
      // full coverage, which is what welds them into one blanket
      const jit = C.roof ? 1 : (C.jit || 1);
      const hw = C.w * 0.78 * cov * jit, hd = C.d * 0.78 * cov * jit;
      const y = C.y + (C.roof ? 0.03 : 0.025) + Math.min(0.5, C.depth) * 0.6;
      const v = n * 4 * 3;
      // roofs keep their footprint; ground patches spin on their own hash
      const ca = C.roof ? 1 : Math.cos(C.ang || 0), sa = C.roof ? 0 : Math.sin(C.ang || 0);
      const qx = [-hw, hw, hw, -hw], qz = [-hd, -hd, hd, hd];
      for (let k = 0; k < 4; k++) {
        pos[v + k * 3] = C.x + qx[k] * ca - qz[k] * sa;
        pos[v + k * 3 + 1] = y;
        pos[v + k * 3 + 2] = C.z + qx[k] * sa + qz[k] * ca;
      }
      /* A THIN DUSTING IS NOT A WHITE PATCH. Coverage alone gave every fleck
         the full deposit colour the moment it existed, so the first minute of
         ashfall looked like confetti on a lawn. A film of ash a millimetre
         thick is mostly the ground you can still see through it, so the colour
         walks from a dark, dirty film up to the pale grey blanket as the
         deposit builds — and then back DOWN as it goes deep and damp. */
      const deep = clamp(C.depth / 0.35, 0, 1);
      const grain = 0.86 + 0.2 * h01(C.x, C.z, salt);
      _c3.setHex(0x585a54).lerp(_c1.setHex(0x9a968e), Math.min(1, cov * 1.15));
      _c3.lerp(_c1.setHex(0x726c63), deep * 0.7);
      for (let k = 0; k < 4; k++) {
        col[v + k * 3] = _c3.r * grain;
        col[v + k * 3 + 1] = _c3.g * grain;
        col[v + k * 3 + 2] = _c3.b * grain;
      }
    }
    for (let n = 0; n < cells.length; n++) writeCell(n);
    geo.setDrawRange(0, cells.length * 6);

    const handle = {
      kind: "ash", mesh: mesh, cell: cell,
      get peakDepth() { return peak; },
      get cellCount() { return cells.length; },
      /* spec: { rate (m/s at the plume axis), windX, windZ, srcX, srcZ,
                 spread (0..1 how much falls off-axis) } */
      update(dt, spec) {
        if (dead) return handle;
        spec = spec || {};
        /* ONE 8 Hz TICK DOES BOTH JOBS. Accumulation and the geometry rewrite
           are throttled together on the SAME accumulated dt, so the depth
           ledger stays exact (nothing is dropped, it is integrated in bigger
           steps) while ~5000 cells cost what 700 cost at 60 Hz. */
        wT += dt;
        const rate = +spec.rate || 0;
        if (wT < 0.125 && !(rate > 0 && peak === 0)) return handle;
        const step = wT; wT = 0;
        if (rate > 0) {
          const wx = spec.windX != null ? +spec.windX : 1;
          const wz = spec.windZ != null ? +spec.windZ : 0;
          const wl = Math.hypot(wx, wz) || 1;
          const ux = wx / wl, uz = wz / wl;
          const sx = spec.srcX != null ? +spec.srcX : cx;
          const sz = spec.srcZ != null ? +spec.srcZ : cz;
          const spread = spec.spread != null ? clamp(+spec.spread, 0, 1) : 0.18;
          for (let n = 0; n < cells.length; n++) {
            const C = cells[n];
            const dx = C.x - sx, dz = C.z - sz;
            const d = Math.hypot(dx, dz) || 0.001;
            // the DOWNWIND WEDGE: a hard cosine lobe on the wind bearing,
            // plus a small isotropic term so the whole island greys over
            const dot = (dx * ux + dz * uz) / d;
            const lobe = dot > 0 ? Math.pow(dot, 2.2) : 0;
            const fall = 1 / (1 + (d / (R * 0.55)) * (d / (R * 0.55)));
            const k = (spread + (1 - spread) * lobe) * fall;
            if (k > 0.001) {
              C.depth += rate * k * step;
              if (C.depth > peak) peak = C.depth;
            }
          }
          dirty = true;
        }
        if (dirty) {
          dirty = false;
          for (let n = 0; n < cells.length; n++) writeCell(n);
          geo.attributes.position.needsUpdate = true;
          geo.attributes.color.needsUpdate = true;
          geo.setDrawRange(0, cells.length * 6);
        }
        return handle;
      },
      // metres of ash standing on the ground at (x,z)
      depthAt(x, z) {
        const i = Math.floor((x - (cx - R)) / cell);
        const j = Math.floor((z - (cz - R)) / cell);
        if (i < 0 || j < 0 || i >= NC || j >= NC) return 0;
        const n = grid[i * NC + j];
        return n < 0 || n >= groundCells ? 0 : cells[n].depth;
      },
      /* A ROOF IS A CELL WITH A CALLER-SUPPLIED CEILING. The disaster hands
         its building rects in once, then reads roofDepth(id) back and prices
         it through the structural ledger — this file never damages anything. */
      addRoof(r) {
        if (!r || cells.length >= MAXC) return -1;
        const id = cells.length;
        cells.push({
          x: +r.x || 0, z: +r.z || 0, y: +r.y || 0,
          w: Math.max(1, +r.w || 4), d: Math.max(1, +r.d || 4),
          depth: 0, roof: true, ref: r.ref || null,
        });
        writeCell(id);
        dirty = true;
        return id;
      },
      roofDepth(id) { const C = cells[id]; return C ? C.depth : 0; },
      roofRef(id) { const C = cells[id]; return C ? C.ref : null; },
      // shed the load (a collapsed roof no longer holds any ash)
      clearCell(id) { const C = cells[id]; if (C) { C.depth = 0; dirty = true; } },
      dispose() {
        if (dead) return;
        dead = true;
        parent.remove(mesh); geo.dispose(); mat.dispose();
        const k = LIVE.ash.indexOf(handle); if (k >= 0) LIVE.ash.splice(k, 1);
      },
    };
    census.ash++;
    LIVE.ash.push(handle);
    return handle;
  };

  /* ============================================================
     CBZ.volcanoAudit() — the ratchet, measured off LIVE objects.

     `lavaTransparent` is the one that matters: it walks every live lava
     mesh's ACTUAL material and counts how many are transparent or
     additively blended. The old streams scored 5; the crust+channel
     build scores 0 by construction, and a future "just make it a bit
     see-through" edit puts the number straight back up where the gate
     can see it.
     ============================================================ */
  CBZ.volcanoAudit = function () {
    let lavaTransparent = 0, lavaMeshes = 0, lavaTris = 0, lavaSet = 0;
    const lavaTips = [];
    for (let i = 0; i < LIVE.lava.length; i++) {
      const f = LIVE.lava[i];
      if (f.hardened) lavaSet++;
      try { lavaTips.push(f.tip); } catch (e) {}
      const ms = [f.mesh, f.channel];
      for (let k = 0; k < ms.length; k++) {
        const m = ms[k]; if (!m || !m.material) continue;
        lavaMeshes++;
        if (m.material.transparent || m.material.blending === THREE.AdditiveBlending) lavaTransparent++;
        const g = m.geometry;
        if (g && g.drawRange) lavaTris += Math.max(0, g.drawRange.count) / 3;
      }
    }
    let pyroBlobs = 0;
    for (let i = 0; i < LIVE.pyro.length; i++) {
      const g = LIVE.pyro[i].group;
      if (g) pyroBlobs += g.children.length;
    }
    /* THE COLUMN'S OWN RATCHET. `columnTransparent` is the ash-cloud twin of
       `lavaTransparent`: the moment any billow becomes transparent or additive
       the column is a sprite pile again, which is the exact failure the owner
       named ("separate rocks... several circular clouds"). Pinned at 0.
       `columnBillows` prints beside it so a fix that passes by drawing NOTHING
       cannot pass. */
    let columnBillows = 0, columnTransparent = 0, columnTop = 0;
    for (let i = 0; i < LIVE.column.length; i++) {
      const C = LIVE.column[i], g = C.group;
      columnTop = Math.max(columnTop, C.topY || 0);
      if (!g) continue;
      for (let k = 0; k < g.children.length; k++) {
        const m = g.children[k];
        if (!m.visible) continue;
        columnBillows++;
        const mt = m.material;
        if (mt && (mt.transparent || mt.blending === THREE.AdditiveBlending)) columnTransparent++;
      }
    }
    let ashPeak = 0, ashCells = 0;
    for (let i = 0; i < LIVE.ash.length; i++) {
      ashPeak = Math.max(ashPeak, LIVE.ash[i].peakDepth);
      ashCells += LIVE.ash[i].cellCount;
    }
    return {
      v2: CBZ.CONFIG.VOLCANO_V2 !== false,
      lavaFlows: LIVE.lava.length,
      lavaMeshes: lavaMeshes,
      lavaTransparent: lavaTransparent,        // MUST be 0
      lavaOpaque: lavaTransparent === 0,
      lavaTris: Math.round(lavaTris),
      // where the live fronts actually are — so a camera (or a threat map)
      // can aim at the flow instead of guessing a hillside
      lavaTips: lavaTips,
      lavaSet: lavaSet,                        // flows that cooled into scars
      pyroLive: LIVE.pyro.length, pyroBlobs: pyroBlobs,
      columnLive: LIVE.column.length,
      columnBillows: columnBillows,
      columnTransparent: columnTransparent,    // MUST be 0
      columnOpaque: columnTransparent === 0,
      columnTopY: +columnTop.toFixed(1),
      laharLive: LIVE.lahar.length,
      ashFields: LIVE.ash.length, ashCells: ashCells,
      ashPeakDepth: +ashPeak.toFixed(3),
      lights: census.lights,
      builtLava: census.lava, builtPyro: census.pyro,
      builtLahar: census.lahar, builtAsh: census.ash,
      builtColumn: census.column,
    };
  };

  /* LIVE HANDLES, for a probe that needs to INTERROGATE a hazard rather than
     photograph it. tools/volcano-check.mjs walks the pyroclastic's own billow
     meshes and asks its own contains() about each one — which is the only way
     to prove "what you see is what kills you" as a number instead of as a
     comment. Read-only by convention; nothing in the game reads it. */
  V.live = LIVE;

  CBZ.volcanoFx = V;
})();
