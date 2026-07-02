/* ============================================================
   city/vehicles.js — REAL traffic + the cars you steal, drive, garage
   and sell.

   Ambient cars have a MODEL (real $ value) and a DRIVER on the same
   aggression spectrum as the peds. The traffic AI does proper road work:
     • lane discipline + car-FOLLOWING (no rear-ending the car ahead)
     • TURNING at intersections (picks a through/turn route)
     • full STOP at red lights (creep, then go on green)
     • AGGRESSIVE drivers speed, tailgate, run yellows/reds, shove
   Running a red near a cop is a VIOLATION → a traffic STOP: calm drivers
   pull over and take the ticket; aggressive ones FLEE (self-wanted → a
   pursuit). High-aggression peds can CARJACK an ambient car and rampage.

   Player driving owns the transform (physics.js bails when driving):
   WASD, follow-cam, run people over, crash, and drive a STOLEN car into
   the chop shop to cash it out (value scales with how rare the car is).

   BRAKE LIGHTS: every car's rear lamps flare when its driver is on the
   brake (slowing for a red / a queue / a ped, or held stopped). WHY: a
   street where you can SEE everyone obeying the rules is what makes
   blasting through it feel like breaking them — and a wall of brake
   lights ahead reads as "traffic" from a block away. Cost: TWO extra
   shared materials for the whole fleet (a bright clone per distinct
   tail material), swapped by pointer only when a car's braking state
   actually changes. No new meshes, so the model audit stays intact.

   HOLE-PROOFING: cars are the most-looked-at prop in a driving game — a
   visible gap reads as broken art (USER-FILMED BUG: "weird holes"). Every
   visual is passed through sealSeams (thin panels get epsilon-overlap;
   deck slabs riding a sloped hull get skirted DOWN into the body) plus
   ONE dark interior-shell box reusing a material the car already draws
   (merges into an existing batch bucket → zero extra draw calls), so a
   residual crack shows cabin-dark interior/floor pan, never daylight.
   crumpleCar clamps panel offsets so deformation can't tear the hull
   away from the merged static grille/bumpers/glass.

   DRIVING JUICE (PLAYER car only — AI traffic keeps just its brake
   lights): the getaway IS the show. A synthesized ENGINE VOICE
   (systems/audio.js CBZ.carAudio) revs with speed+throttle through
   fake gear steps; the [SPACE] handbrake breaks the rear loose for
   slides with a tyre screech; hard slip lays real RUBBER (one
   80-segment ring-buffer mesh = ONE draw call, oldest overwritten)
   and boils white smoke off the rear wheels. WHY: a corner you can
   hear taken flat and then read in skid marks afterwards is showing
   off — the game's whole point — without one extra HUD pixel.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;
  const cmat = CBZ.cmat || mat;
  const boxGeo = CBZ.boxGeom || function (w, h, d) { return new THREE.BoxGeometry(w, h, d); };
  const g = CBZ.game;

  // SHINY material API (world/carfx.js → CBZ.vehicleMat), with a flat-lambert
  // fallback for headless/gallery. Routes the BOX-RIG fallback car's surfaces
  // through the same reflective env-mapped materials the detailed visual uses,
  // so the gallery / no-visual path also reads as polished, not toy-matte.
  function vmat(role, color, opts) {
    return (CBZ.vehicleMat) ? CBZ.vehicleMat(role, color, opts)
                            : cmat(color == null ? 0x888888 : color, opts);
  }

  // CRASH SEVERITY THRESHOLDS — re-grounded in real-world crash data (NHTSA/IIHS).
  // The sim's speed unit ≈ 2.4 mph (sedan top ≈ 35u ≈ 80 mph; cruise 7-12u ≈ 20-30
  // mph), so the bands below map onto the real damage ladder:
  //   • < 5 mph  (≈ 2u)   : fender-bender — scratches/dents/bumper scuff only.
  //   • 10-15 mph(≈ 4-6u) : minor body damage, fully drivable.
  //   • 20-30 mph(≈ 8-13u): real body/frame damage — a "hard" crash.
  //   • 35-40+mph(≈ 14-17u): severe → total-loss territory — "catastrophic".
  // The OLD carHard:8 fired a "real crash" at ~13 mph closing AND mass-inflated
  // severity pushed slow bumps over it, so a parking-lot tap gutted the engine and
  // could reach a fireball. Bars raised so low-speed contact stays cosmetic and a
  // car survives many bumps before it's a wreck.
  const CRASH = CBZ.cityCrashTune = {
    wallHard: 20, wallCatastrophic: 30,   // ~48 / ~72 mph into a fixed wall
    carHard: 14, carCatastrophic: 30,     // ~real body damage / total-loss closing severity
    pedLethal: 14, npcDriverLethal: 30,
  };

  // ---- RUN-OVER JUICE ------------------------------------------------------
  // A lethal run-over currently fires shake + a speed-bleed but — unlike a melee
  // land() (combat.js) — NO hit-stop and NO bass impact, so a kill at speed reads
  // LIGHTER than a punch. This restores the "thunk": a TINY hit-stop, a one-frame
  // car-speed "catch", and a bass-heavy impact voice scaled by impact speed.
  // WHY tiny: loop.js decrements CBZ.hitstop by the WORLD dt (clamped to 0.05s);
  // on the weak Mac at ~5 FPS one rendered frame ≈ 0.2s of wall-clock, so the
  // loop's clamped 0.05 drain means even a 0.05 hit-stop is ~ONE near-frozen
  // frame — long enough to read as weight, short enough not to swallow an input
  // sample. A bigger value here would eat a keypress at low FPS (research:
  // hitstop is "3–5 frames" — but that's at 60 FPS; at 5 FPS 3 frames is a
  // visible stall). Fired AT MOST ONCE per runOver() call (a car can clip
  // several bodies in one frame — we must never stack N hit-stops / spam the
  // audio channel). MP-SAFE: hit-stop scales this client's LOCAL sim dt only,
  // SFX/shake are local present-path effects, and we touch no networked state
  // beyond the car.v bleed the lethal path ALREADY applies here (host-sim value,
  // broadcast via snapshots like today); guests see the ragdoll via snapshots.
  // No ped HP / death / crime / witness / population logic is touched.
  if (CBZ.runoverJuice === undefined) CBZ.runoverJuice = true;   // default ON; honour an owner toggle
  let _s = 1234;
  function rng() { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return _s / 0x7fffffff; }
  let _trafficStopNoteT = 0;   // global cooldown for the ambient "traffic stop nearby" feed line
  const TR = () => (CBZ.CITY && CBZ.CITY.traf) || {};
  // multi-lane geometry (mirrors traffic.js): lane index → signed lateral offset.
  const lanesPerDir = () => Math.max(1, (TR().lanesPerDir != null ? TR().lanesPerDir : 2) | 0);
  const laneWidth = () => (TR().laneW != null ? TR().laneW : 3.6);
  const laneOffset = (dir, idx) => dir * laneWidth() * (idx + 0.5);

  // ---- ambient car MODEL builder ----------------------------------------
  // Cars read as real vehicles: a low body with a chamfered roof/hood, a
  // separate glass-tinted greenhouse (windshield + side windows), four dark
  // wheels at the corners, pale emissive headlights + red taillights, and one
  // of seven BODY TYPES (hatch / sedan / SUV / pickup / van / muscle / coupe) with distinct
  // proportions. crumpleCar animates userData.body + userData.cabin, so those
  // two meshes stay the deformable hull (low at y≈0.78) and roof (y≈1.45).
  const WHEEL_GEO = new THREE.CylinderGeometry(0.45, 0.45, 0.42, 16);   // rounder tyre
  WHEEL_GEO._shared = true;
  const HUB_GEO = new THREE.CylinderGeometry(0.2, 0.2, 0.44, 8);
  HUB_GEO._shared = true;
  const WEDGE_GEOS = new Map();
  function boxMesh(w, h, d, material) { return new THREE.Mesh(boxGeo(w, h, d), material); }
  // a flat-topped wedge prism (a chamfered slab) used for the hull + roof so
  // the body isn't a plain box — tapered top, full-width bottom.
  function wedgeGeo(w, h, d, topFrac, noseFrac, tailFrac) {
    topFrac = topFrac == null ? 0.82 : topFrac;
    const key = [w, h, d, topFrac, noseFrac == null ? 1 : noseFrac, tailFrac == null ? 1 : tailFrac].join("|");
    const cached = WEDGE_GEOS.get(key); if (cached) return cached;
    const tw = (w * topFrac) / 2, bw = w / 2;
    const fz = (d * (noseFrac == null ? 1 : noseFrac)) / 2;   // front (+z) length
    const rz = (d * (tailFrac == null ? 1 : tailFrac)) / 2;   // rear  (-z) length
    const tf = fz * topFrac, tr = rz * topFrac;
    const y0 = -h / 2, y1 = h / 2;
    // 8 verts: bottom (full) then top (tapered, shorter)
    const v = [
      [-bw, y0, -rz], [bw, y0, -rz], [bw, y0, fz], [-bw, y0, fz],   // 0-3 bottom
      [-tw, y1, -tr], [tw, y1, -tr], [tw, y1, tf], [-tw, y1, tf],   // 4-7 top
    ];
    const faces = [
      [0, 1, 2], [0, 2, 3],   // bottom
      [4, 6, 5], [4, 7, 6],   // top
      [3, 2, 6], [3, 6, 7],   // front
      [1, 0, 4], [1, 4, 5],   // back
      [0, 3, 7], [0, 7, 4],   // left
      [2, 1, 5], [2, 5, 6],   // right
    ];
    const pos = [];
    for (const f of faces) for (const i of f) pos.push(v[i][0], v[i][1], v[i][2]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    geo._shared = true;
    WEDGE_GEOS.set(key, geo);
    return geo;
  }

  function mergeGeometryCopies(geos) {
    let vertices = 0;
    for (const geo of geos) vertices += geo.attributes.position.count;
    const pos = new Float32Array(vertices * 3);
    const nrm = new Float32Array(vertices * 3);
    let pi = 0;
    for (const geo of geos) {
      pos.set(geo.attributes.position.array, pi);
      if (geo.attributes.normal) nrm.set(geo.attributes.normal.array, pi);
      pi += geo.attributes.position.array.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    out.computeBoundingSphere();
    return out;
  }

  // ---- ALLOY RIM geometry (shared, built once): a bright wheel face = flat disc
  //      + 5 radial spokes + hub cap, baked into ONE geometry for a radius-0.45
  //      reference wheel and SCALED per car in addWheels. Replaces the old plain
  //      hub cylinder so wheels read as machined alloys, not black discs.
  let RIM_GEO = null;
  function buildRimGeo() {
    if (RIM_GEO) return RIM_GEO;
    try {
      const r = 0.45, width = 0.42, rimR = r * 0.66, parts = [];
      const pushNI = (g3) => { g3.computeVertexNormals(); parts.push(g3.index ? g3.toNonIndexed() : g3); };
      pushNI(new THREE.CylinderGeometry(rimR, rimR, width * 0.5, 16));   // rim face disc
      const spokeLen = rimR * 0.95, spokeW = r * 0.13, spokeT = width * 0.52;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const s = new THREE.BoxGeometry(spokeLen, spokeW, spokeT);
        s.translate(spokeLen * 0.5, 0, 0);
        s.applyMatrix4(new THREE.Matrix4().makeRotationY(a));
        pushNI(s);
      }
      pushNI(new THREE.CylinderGeometry(r * 0.17, r * 0.17, width * 0.62, 8));   // hub cap
      RIM_GEO = mergeGeometryCopies(parts);
      parts.forEach((g3) => g3.dispose && g3.dispose());
    } catch (e) {
      RIM_GEO = HUB_GEO;   // headless renderer w/o BufferGeometry baking: fall back to the old cap
    }
    RIM_GEO._shared = true;
    return RIM_GEO;
  }

  // Ambient-car parts never animate independently, except for the deformable
  // hull and cabin. Bake the rest into a few per-material meshes so richer car
  // silhouettes do not cost dozens of draw calls per traffic vehicle.
  function mergeStaticCarParts(grp, keep) {
    const isMesh = (o) => !!(o && o.geometry && o.material);
    const sourceParts = grp.children.reduce((n, o) => n + (isMesh(o) ? 1 : 0), 0);
    const buckets = new Map();
    for (const mesh of grp.children.slice()) {
      if (!isMesh(mesh) || keep.has(mesh) || Array.isArray(mesh.material)) continue;
      const key = [mesh.material.id, mesh.castShadow ? 1 : 0, mesh.receiveShadow ? 1 : 0].join("|");
      (buckets.get(key) || buckets.set(key, []).get(key)).push(mesh);
    }
    buckets.forEach((meshes) => {
      if (meshes.length < 2) return;
      const proto = meshes[0];
      let mergedGeo;
      if (proto.updateMatrix && proto.geometry.attributes && proto.geometry.attributes.position && proto.geometry.clone && proto.geometry.applyMatrix4) {
        const copies = meshes.map((mesh) => {
          mesh.updateMatrix();
          const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
          geo.applyMatrix4(mesh.matrix);
          return geo;
        });
        mergedGeo = mergeGeometryCopies(copies);
        copies.forEach((geo) => geo.dispose && geo.dispose());
      } else {
        // Lightweight test renderers do not implement BufferGeometry baking.
        mergedGeo = proto.geometry;
      }
      const merged = new THREE.Mesh(mergedGeo, proto.material);
      merged.castShadow = proto.castShadow;
      merged.receiveShadow = proto.receiveShadow;
      merged.matrixAutoUpdate = false;
      grp.add(merged);
      meshes.forEach((mesh) => grp.remove(mesh));
    });
    grp.userData.sourceParts = sourceParts;
    grp.userData.drawMeshes = grp.children.reduce((n, o) => n + (isMesh(o) ? 1 : 0), 0);
  }

  // ---- HOLE-PROOFING (USER-FILMED BUG: "some cars have weird holes in them").
  //      Systematic, not per-model — runs on every visual BEFORE batching:
  //      • deck slabs (hood/trunk breaks, tonneau, roof caps) ride the body
  //        prism's SLOPING nose/tail, so their leading edge floats with an open
  //        slit under it → extend the box DOWN into the hull (the buried part
  //        is invisible; the exposed part reads as a proper panel edge).
  //      • racing stripes were authored ~0.19 above the hood line → settle
  //        them onto the deck and skirt them down a touch.
  //      • every other thin box (door seams, plates, lamps, glass slabs) gets
  //        a few cm of epsilon-overlap on its thin axes so abutting panels
  //        interpenetrate — backface culling can no longer show daylight
  //        through an exact-contact seam at grazing angles.
  //      Touches mesh.scale/position only (geometries are shared caches), and
  //      everything still merges into the same per-material buckets.
  function extendBoxDown(mesh, by) {
    const p = mesh.geometry.parameters, h = p.height;
    by = Math.min(by, mesh.position.y - h / 2 - 0.12);   // never punch below the floor pan
    if (by <= 0) return;
    mesh.scale.y *= (h + by) / h;
    mesh.position.y -= by / 2;                            // top edge stays put, bottom drops
  }
  function sealSeams(root, dims) {
    const hullW = (dims && dims.width) || 2;
    for (const o of root.children) {
      if (!o.geometry || !o.material || Array.isArray(o.material)) continue;
      if (o.userData && o.userData.playerWheel) continue;
      const p = o.geometry.parameters;
      if (!p || p.width == null || p.height == null || p.depth == null) continue;   // boxes only
      const flat = !o.rotation.x && !o.rotation.y && !o.rotation.z;
      // wide flat deck panel narrower than the hull → skirt it into the body
      if (flat && p.height <= 0.1 && p.width >= 1 && p.width < hullW && p.depth >= 0.4) {
        extendBoxDown(o, 0.45);
        continue;
      }
      // long thin hood stripe floated above the deck → settle + skirt
      if (flat && p.height <= 0.03 && p.width <= 0.3 && p.depth >= 2) {
        o.position.y -= 0.19;
        extendBoxDown(o, 0.18);
        continue;
      }
      if (p.width <= 0.09) o.scale.x *= (p.width + 0.04) / p.width;
      if (p.height <= 0.09) o.scale.y *= (p.height + 0.04) / p.height;
      if (p.depth <= 0.09) o.scale.z *= (p.depth + 0.04) / p.depth;
    }
  }
  // ONE dark interior shell + floor pan per car: whatever hairline seam
  // survives now shows a dark cabin/undercarriage instead of seeing clean
  // through the body from a low camera. It reuses the darkest opaque material
  // the car ALREADY draws, so it merges into that existing bucket — zero extra
  // draw calls, one extra source box (the allowed budget).
  function addInteriorShell(root, dims, fallbackMat) {
    const sw = ((dims && dims.width) || 2) * 0.78;
    const top = (dims && dims.shellTop) || (((dims && dims.height) || 1.5) * 0.55);
    const sd = ((dims && dims.length) || 4.4) * 0.78;
    let donor = null, lum = 9;
    for (const o of root.children) {
      const m = o.material;
      if (!o.geometry || !m || Array.isArray(m) || (o.userData && o.userData.playerWheel)) continue;
      if (!m.color || m.color.r == null) continue;
      // skip lamps: judge by actual GLOW (emissive luminance × intensity) —
      // dark trim has default intensity 1 but a black emissive, so it passes.
      const glow = m.emissive && m.emissive.r != null
        ? (m.emissive.r + m.emissive.g + m.emissive.b) * (m.emissiveIntensity == null ? 1 : m.emissiveIntensity) : 0;
      if (glow > 0.8) continue;
      const l = m.color.r + m.color.g + m.color.b;
      if (l < lum) { lum = l; donor = o; }
    }
    const m = donor ? donor.material : fallbackMat;
    if (!m || top - 0.14 <= 0.05) return;
    const shell = boxMesh(sw, top - 0.14, sd, m);
    shell.position.set(0, (top + 0.14) / 2, 0);
    if (donor) { shell.castShadow = donor.castShadow; shell.receiveShadow = donor.receiveShadow; }
    root.add(shell);
  }

  function addWheels(grp, halfTrack, wz, r) {
    const wmat = vmat("tire", 0x131417, { emissive: 0x060708, ei: 0.2 });   // shiny rubber
    const rmat = vmat("rim", 0xc2c9d1, { emissive: 0x20242a, ei: 0.3 });     // bright alloy
    const rim = buildRimGeo();
    [[halfTrack, wz, -1], [-halfTrack, wz, 1], [halfTrack, -wz, -1], [-halfTrack, -wz, 1]].forEach(([wx, wzz, out]) => {
      const wh = new THREE.Mesh(WHEEL_GEO, wmat);
      wh.rotation.z = Math.PI / 2; wh.position.set(wx, r, wzz);
      wh.scale.set(r / 0.45, 1, r / 0.45); wh.castShadow = false; grp.add(wh);   // blob shadows ground cars
      // alloy rim proud of the OUTboard tyre face (sign per side keeps it facing out)
      const rd = new THREE.Mesh(rim, rmat);
      rd.rotation.z = out * Math.PI / 2;
      rd.position.set(wx, r, wzz);
      rd.scale.set(r / 0.45, 1, r / 0.45);
      rd.position.x += out * 0.13 * (r / 0.45);   // push the face outboard a touch
      rd.castShadow = false; grp.add(rd);
    });
  }

  // headlights (front, pale) + taillights (rear, red), as small emissive bars.
  // Colours/emissives are kept EXACTLY as before (the brake-light + crash dead-
  // lamp detectors key off these specific values); vmat just adds the glossy lens.
  function addLights(grp, w, hullTopY, frontZ, rearZ) {
    const head = vmat("lightFront", 0xeaf6ff, { emissive: 0xbfe6ff, ei: 0.85 });
    const tail = vmat("lightTail", 0xff3038, { emissive: 0xff2630, ei: 0.8 });
    const lx = w * 0.34;
    [lx, -lx].forEach((hx) => {
      const hl = boxMesh(0.4, 0.18, 0.06, head);
      hl.position.set(hx, hullTopY, frontZ + 0.02); grp.add(hl);
    });
    const tl = boxMesh(w * 0.86, 0.16, 0.07, tail);
    tl.position.set(0, hullTopY, rearZ - 0.02); grp.add(tl);
  }

  // ---- BRAKE LIGHTS -------------------------------------------------------
  // All tail lamps in the fleet use a handful of SHARED red-emissive materials
  // (cmat / playercars' sharedMat are cached singletons). We lazily build ONE
  // bright "braking" counterpart per distinct tail material (a pool of ~2-3 for
  // the entire city, ever) and flip a car's tail meshes between the two by
  // pointer when its braking state changes. Zero clones per car, zero per-frame
  // material work, and the merged-mesh part structure is untouched.
  const _brakeMats = new Map();           // tail material -> bright counterpart
  function isTailMat(m) {
    // A tail lamp = STRONG red emissive (the glow), regardless of the lens BODY
    // colour. carfx gives lamps a realistic DARK lens (color.r≈0.13) lit by a
    // bright emissive, so the old `color.r>0.78` clause (which assumed a bright
    // red body) wrongly rejected every carfx tail and broke brake lights. We now
    // key purely off the emissive: high red, low green/blue. This still excludes
    // headlights (pale-white emissive → green/blue high) and body PAINT (whose
    // emissive is a dim fraction of its colour, ~0.04-0.2 r, well under 0.78).
    if (!m || !m.emissive || m.emissive.r == null) return false;
    return m.emissive.r > 0.78 && m.emissive.g < 0.45 && m.emissive.b < 0.5;
  }
  function brakeMatFor(tailMat) {
    let b = _brakeMats.get(tailMat);
    if (!b) {
      b = tailMat.clone ? tailMat.clone() : tailMat;
      if (b !== tailMat) {
        if (b.color && b.color.setHex) b.color.setHex(0xff4a52);
        if (b.emissive && b.emissive.setHex) b.emissive.setHex(0xff0d18);
        b.emissiveIntensity = 2.2;
        b._shared = true;                 // never disposed by clearCars
      }
      _brakeMats.set(tailMat, b);
    }
    return b;
  }
  function tagTailMeshes(c) {
    const grp = c.group; if (!grp || !grp.traverse) return;
    const list = [];
    grp.traverse(function (o) {
      const m = o.material;
      if (m && !Array.isArray(m) && isTailMat(m)) { o._tailMat = m; list.push(o); }
    });
    c._tailMeshes = list;
    c._tailVisual = (grp.userData && grp.userData.carVisual) || null;
    c._brakeOn = false;
  }
  function setBrake(c, on) {
    on = !!on;
    if (!c._tailMeshes) return;
    // the [C] style-cycler can rebuild the visual under us — re-tag and re-apply
    const vis = (c.group && c.group.userData && c.group.userData.carVisual) || null;
    if (vis !== c._tailVisual) tagTailMeshes(c);
    if (c._brakeOn === on) return;
    c._brakeOn = on;
    for (let i = 0; i < c._tailMeshes.length; i++) {
      const mesh = c._tailMeshes[i];
      mesh.material = on ? brakeMatFor(mesh._tailMat) : mesh._tailMat;
    }
  }

  // tinted-glass greenhouse: a thin windshield slab + two side-window slabs
  // wrapped around the cabin so the cabin reads as a windowed passenger box.
  function addGlass(grp, cabinW, cabinD, cabinY, cabinH, raked) {
    // keep the tint colour (crash frost-glass detector keys off it); vmat adds gloss.
    const glass = vmat("glass", 0x16242e, { emissive: 0x0a151c, ei: 0.45 });
    const half = cabinD / 2;
    // windshield (front, raked back) + rear glass
    const wsW = cabinW * 0.9;
    [half + 0.01, -half - 0.01].forEach((zz, i) => {
      const gw = boxMesh(wsW, cabinH * 0.7, 0.05, glass);
      gw.position.set(0, cabinY, zz);
      gw.rotation.x = (i === 0 ? -1 : 1) * (raked ? 0.5 : 0.32);
      grp.add(gw);
    });
    // side windows
    [cabinW / 2 + 0.005, -cabinW / 2 - 0.005].forEach((xx) => {
      const sw = boxMesh(0.04, cabinH * 0.6, cabinD * 0.84, glass);
      sw.position.set(xx, cabinY, 0); grp.add(sw);
    });
  }

  function addModelIdentity(grp, model, d) {
    const style = model && model.designStyle;
    if (!style) return;
    const { w, len, hullH, hullY, roofW, roofH, roofY, roofZ, paint, trim } = d;
    const bodyY = 0.78 + (hullY - 0.72);
    const front = len * 0.5 + 0.055, rear = -len * 0.5 - 0.055;
    const chrome = vmat("chrome", 0xaeb7c0, { emissive: 0x24292e, ei: 0.3 });
    const head = vmat("lightFront", 0xeaf6ff, { emissive: 0xbfe6ff, ei: 0.85 });   // exact colour kept
    const tail = vmat("lightTail", 0xff3038, { emissive: 0xff2630, ei: 0.8 });     // for brake/crash detectors
    const add = (ww, hh, dd, x, y, z, material) => {
      const mesh = boxMesh(ww, hh, dd, material);
      mesh.position.set(x, y, z); grp.add(mesh); return mesh;
    };

    if (style === "prius") {
      [1, -1].forEach((side) => add(0.12, roofH * 0.62, 0.065, side * w * 0.39, roofY - roofH * 0.08, rear, tail));
    } else if (style === "civic") {
      [1, -1].forEach((side) => add(0.18, 0.12, 0.16, side * w * 0.28, bodyY - hullH * 0.32, rear, chrome));
    } else if (style === "malibu") {
      [-0.1, 0.1].forEach((yy) => add(w * 0.58, 0.035, 0.035, 0, bodyY + yy, front, chrome));
    } else if (style === "caravan") {
      [1, -1].forEach((side) => {
        add(0.05, 0.05, len * 0.64, side * roofW * 0.45, roofY + roofH * 0.55, roofZ - len * 0.04, trim);
        add(0.035, 0.035, len * 0.44, side * w * 0.505, bodyY + hullH * 0.24, -len * 0.12, trim);
      });
    } else if (style === "f150") {
      [1, -1].forEach((side) => add(0.07, 0.08, len * 0.38, side * w * 0.46, bodyY + hullH * 0.62, -len * 0.22, trim));
      [-0.13, 0.13].forEach((yy) => add(w * 0.62, 0.045, 0.04, 0, bodyY + yy, front, chrome));
    } else if (style === "370z") {
      add(roofW * 0.68, 0.035, len * 0.2, 0, roofY + roofH * 0.52, roofZ - len * 0.02, trim);
      [1, -1].forEach((side) => add(0.18, 0.1, 0.14, side * w * 0.3, bodyY - hullH * 0.28, rear, chrome));
    } else if (style === "cherokee") {
      [1, -1].forEach((side) => add(0.055, 0.06, len * 0.58, side * roofW * 0.43, roofY + roofH * 0.54, roofZ, trim));
      for (let i = -3; i <= 3; i++) add(0.055, hullH * 0.42, 0.04, i * w * 0.075, bodyY, front, trim);
    } else if (style === "charger") {
      [1, -1].forEach((side) => add(w * 0.16, 0.035, len * 0.34, side * w * 0.19, bodyY + hullH * 0.53, len * 0.18, trim));
    } else if (style === "corvette") {
      [1, -1].forEach((side) => {
        add(0.18, 0.1, 0.14, side * w * 0.28, bodyY - hullH * 0.3, rear, chrome);
        add(w * 0.1, 0.035, len * 0.44, side * w * 0.12, bodyY + hullH * 0.5, len * 0.1, trim);
      });
    } else if (style === "sclass") {
      [-0.12, 0, 0.12].forEach((yy) => add(w * 0.56, 0.035, 0.035, 0, bodyY + yy, front, chrome));
      add(0.035, 0.18, 0.035, 0, bodyY + hullH * 0.62, len * 0.38, chrome);
    } else if (style === "models") {
      add(w * 0.7, 0.055, 0.09, 0, bodyY + hullH * 0.47, rear, paint);
    } else if (style === "modelx") {
      [1, -1].forEach((side) => add(0.04, roofH * 0.48, 0.04, side * roofW * 0.5, roofY, roofZ, trim));
    } else if (style === "porsche") {
      [1, -1].forEach((side) => add(0.26, 0.24, 0.07, side * w * 0.29, bodyY + hullH * 0.45, front, head));
    } else if (style === "aventador") {
      [1, -1].forEach((side) => {
        const lamp = add(w * 0.24, 0.08, 0.075, side * w * 0.3, bodyY + hullH * 0.42, front, head);
        lamp.rotation.z = side * -0.18;
      });
      add(w * 0.74, 0.07, 0.18, 0, bodyY + hullH * 0.65, -len * 0.43, trim);
    } else if (style === "ferrari") {
      [1, -1].forEach((side) => add(w * 0.13, 0.05, len * 0.24, side * w * 0.18, bodyY + hullH * 0.52, len * 0.13, trim));
    } else if (style === "enzo") {
      [1, -1].forEach((side) => add(w * 0.14, 0.055, len * 0.32, side * w * 0.2, bodyY + hullH * 0.5, len * 0.12, trim));
      add(w * 0.16, 0.06, len * 0.38, 0, bodyY + hullH * 0.53, len * 0.12, paint);
    } else if (style === "veyron") {
      add(w * 0.24, 0.045, len * 0.66, 0, bodyY + hullH * 0.53, -len * 0.02, chrome);
      [1, -1].forEach((side) => add(0.18, 0.16, 0.06, side * w * 0.2, bodyY, front, trim));
    }
  }

  // Every named model has a stable body class. The old random fallback could
  // turn a Prius or a Yellow Cab into a pickup/van, which made the traffic mix
  // look broken rather than varied. Unknown models fall back to a normal sedan.
  function modelBodyKind(model) {
    if (model && model.body) return model.body;
    const nm = model ? model.name : "";
    if (/F-150|Caravan|Sprinter|Transit|truck|pickup/i.test(nm)) return /Caravan|Sprinter|Transit|van/i.test(nm) ? "van" : "pickup";
    if (/van|cargo/i.test(nm)) return "van";
    if (/Charger|Mustang|Camaro|Challenger|muscle/i.test(nm)) return "muscle";
    if (/Cherokee|SUV|Model X|Model Y|Cybertruck|Escalade|Tahoe|Range/i.test(nm)) return "suv";
    if (/Corvette|911|370Z|Aventador|Enzo|Veyron|coupe|Ferrari|Porsche/i.test(nm)) return "coupe";
    if (/Prius|Civic|Golf|hatch/i.test(nm)) return "hatch";
    return "sedan";
  }
  function vehicleProfile(model, body) {
    const s = model ? model.s || 1 : 1;
    const bk = body || modelBodyKind(model);
    let mass = 1.05, armor = 0.05, repair = 1.0;
    if (bk === "coupe") { mass = 0.9; armor = 0.02; repair = 1.18; }
    else if (bk === "muscle") { mass = 1.12; armor = 0.08; repair = 1.1; }
    else if (bk === "suv") { mass = 1.36; armor = 0.16; repair = 1.12; }
    else if (bk === "pickup") { mass = 1.44; armor = 0.2; repair = 0.98; }
    else if (bk === "van") { mass = 1.5; armor = 0.18; repair = 0.94; }
    else if (bk === "hatch") { mass = 0.96; armor = 0.04; repair = 0.9; }
    if (s > 1.35) { mass *= 0.94; repair *= 1.25; }     // exotics are lighter and expensive to fix
    return { mass, armor, repair };
  }

  // UNIFIED car visual: build the SAME detailed model the player drives, painted
  // for THIS car, so it looks identical parked, in traffic, and while driven —
  // no more swap-on-entry (a car was a small box rig until you stole it, then
  // popped into a different hero mesh of a different colour). Falls back to the
  // lightweight box rig when the visual system isn't loaded (headless / gallery).
  function buildCar(model) {
    if (!CBZ.cityBuildPlayerCarVisual || !CBZ.cityInferCarStyle) return buildCarBox(model);
    const grp = new THREE.Group();
    const bt = modelBodyKind(model);
    const s = model ? (model.s || 1) : 1;
    const baseColor = model ? model.color : 0x3c6fd6;
    // per-car clearcoat tint so a row of one model still reads as varied
    const tint = 0.86 + rng() * 0.28;
    const paintHex = new THREE.Color(baseColor).multiplyScalar(tint).getHex();
    const style = CBZ.cityInferCarStyle(model) || "tesla-3";
    let visual = null;
    try { visual = CBZ.cityBuildPlayerCarVisual(style, paintHex); } catch (e) { visual = null; }
    if (!visual) return buildCarBox(model);
    grp.add(visual);
    // Wheels stay as individual meshes (tagged playerWheel) so the driven car can
    // spin them; everything else merges into a few meshes — the city is draw-call
    // bound (core/profile.js), and an unmerged hero mesh per car would blow that.
    const keep = new Set();
    visual.traverse(function (o) { if (o.userData && o.userData.playerWheel) keep.add(o); });
    const dims = visual.userData.vehicleDims ||
      { width: 2, length: 4.4 * s, height: 1.5, wheelbase: 2.7 };
    // hole-proof the panel work before it gets baked into the merge buckets
    // (bikes/aircraft/boats have open frames by design — no shell, no sealing)
    if (!/motorcycle|helicopter|boat/.test(style)) {
      sealSeams(visual, dims);
      addInteriorShell(visual, dims, null);
    }
    if (mergeStaticCarParts) mergeStaticCarParts(visual, keep);
    grp.userData.carVisual = visual;
    grp.userData.carStyle = style;
    grp.userData.bodyKind = bt;
    grp.userData.designStyle = (model && model.designStyle) || bt;
    grp.userData.vehicleDims = dims;
    return grp;
  }

  function buildCarBox(model) {
    const grp = new THREE.Group();
    const s = model ? model.s : 1;
    const len = 4.2 * s;
    const color = model ? model.color : 0x3c6fd6;
    // a steered palette: dim/lighten the model colour a touch per-car so a
    // row of the same model still varies, plus a clearcoat-ish emissive sheen.
    const tint = 0.86 + rng() * 0.28;
    const c3 = new THREE.Color(color).multiplyScalar(tint);
    const paintHex = c3.getHex();
    // shiny clearcoat body (fresh per car so it carries THIS colour + reflections)
    const paint = vmat("paint", paintHex, { emissive: c3.clone().multiplyScalar(0.18).getHex(), ei: 0.5 });
    const trim = vmat("plastic", 0x16181c, { emissive: 0x070809, ei: 0.25 });

    // Use the model's stable body class so named traffic always reads correctly.
    let bt = modelBodyKind(model);

    // shared dimensions, tuned per body type below
    let w = 2.0, hullH = 0.62, hullY = 0.7, wheelR = 0.45, halfTrack = 0.98;
    let roofW = 1.62, roofH = 0.66, roofD = len * 0.42, roofY = 1.45, roofZ = -0.1;
    let topFrac = 0.8, raked = false;

    if (bt === "sedan") {
      w = 1.94; hullH = 0.64; hullY = 0.72; wheelR = 0.46; halfTrack = 0.99;
      roofW = 1.56; roofH = 0.62; roofD = len * 0.42; roofY = 1.42; roofZ = -0.12; topFrac = 0.84;
    } else if (bt === "hatch") {
      w = 1.84; hullH = 0.66; hullY = 0.72; wheelR = 0.44; halfTrack = 0.94;
      roofW = 1.52; roofH = 0.74; roofD = len * 0.53; roofY = 1.48; roofZ = -0.2; topFrac = 0.88;
    } else if (bt === "suv") {
      w = 2.1; hullH = 0.9; hullY = 0.86; wheelR = 0.54; halfTrack = 1.06;
      roofW = 1.82; roofH = 0.84; roofD = len * 0.52; roofY = 1.78; roofZ = -0.04; topFrac = 0.92;
    } else if (bt === "pickup") {
      w = 2.08; hullH = 0.82; hullY = 0.82; wheelR = 0.54; halfTrack = 1.06;
      // cab sits forward; an open bed sits behind it
      roofW = 1.72; roofH = 0.76; roofD = len * 0.32; roofY = 1.66; roofZ = len * 0.18; topFrac = 0.94;
    } else if (bt === "muscle") { // long-hood American muscle: wide, low, fat rear
      w = 2.06; hullH = 0.6; hullY = 0.66; wheelR = 0.5; halfTrack = 1.03;
      roofW = 1.6; roofH = 0.56; roofD = len * 0.3; roofY = 1.3; roofZ = -0.2; topFrac = 0.8;
    } else if (bt === "van") { // tall slab-sided cargo box, short hood
      w = 2.14; hullH = 1.36; hullY = 1.06; wheelR = 0.5; halfTrack = 1.06;
      roofW = 1.96; roofH = 0.5; roofD = len * 0.4; roofY = 2.02; roofZ = len * 0.18; topFrac = 0.98;
    } else { // coupe — sports car: low, wide, raked
      w = 2.04; hullH = 0.5; hullY = 0.58; wheelR = 0.47; halfTrack = 1.01;
      roofW = 1.5; roofH = 0.52; roofD = len * 0.34; roofY = 1.18; roofZ = -0.16; topFrac = 0.74; raked = true;
    }

    // ---- HULL (the deformable body the crumpler caves in). chamfered wedge,
    //      kept centred at y≈0.78 so crumpleCar's 0.78-baseline math still lands. ----
    const body = new THREE.Mesh(wedgeGeo(w, hullH, len, topFrac, bt === "coupe" ? 0.92 : 1, 1), paint);
    body.position.y = 0.78; body.castShadow = false; grp.add(body);   // blob shadows ground cars
    // raise/lower the visual hull to its type's ride height without breaking the
    // crumpler baseline (it sets body.position.y = 0.78 - c*0.14): nudge via the
    // group children offset instead — keep body at 0.78 and float a skirt.
    if (hullY !== 0.7) body.position.y = 0.78 + (hullY - 0.72);

    // ---- ROOF / CABIN (the deformable greenhouse). ----
    const cabin = new THREE.Mesh(wedgeGeo(roofW, roofH, roofD, topFrac * 0.94, raked ? 0.6 : 0.8, 0.95), paint);
    cabin.position.set(0, roofY, roofZ); grp.add(cabin);
    grp.userData.body = body; grp.userData.cabin = cabin;   // crash crumpling
    grp.userData.crashBase = { bodyY: body.position.y, bodyZ: body.position.z, cabinY: cabin.position.y, cabinZ: cabin.position.z };

    // glass on the greenhouse
    addGlass(grp, roofW, roofD, roofY, roofH, raked);

    // a contrasting belt-line / bumpers so the body isn't one flat colour
    const beltY = 0.78 + (hullY - 0.72) - hullH * 0.18;
    const belt = boxMesh(w + 0.04, 0.16, len * 0.96, trim);
    belt.position.set(0, Math.max(0.5, beltY), 0); grp.add(belt);

    // pickup bed walls (an open box behind the cab)
    if (bt === "pickup") {
      const bedY = 0.78 + (hullY - 0.72) + hullH * 0.32;
      const bedmat = paint;
      const sideD = len * 0.42;
      [w / 2 - 0.06, -w / 2 + 0.06].forEach((bx) => {
        const wall = boxMesh(0.1, 0.26, sideD, bedmat);
        wall.position.set(bx, bedY + 0.13, -len * 0.22); grp.add(wall);
      });
      const tail = boxMesh(w - 0.1, 0.26, 0.1, bedmat);
      tail.position.set(0, bedY + 0.13, -len * 0.44); grp.add(tail);
    }
    // coupe rear spoiler
    if (bt === "coupe") {
      const spoiler = boxMesh(w * 0.74, 0.07, 0.2, trim);
      spoiler.position.set(0, 0.78 + (hullY - 0.72) + hullH * 0.42, -len * 0.46); grp.add(spoiler);
    }
    // muscle: a black hood scoop + a low ducktail wing so it reads aggressive
    if (bt === "muscle") {
      const scoop = boxMesh(w * 0.36, 0.13, len * 0.18, trim);
      scoop.position.set(0, 0.78 + (hullY - 0.72) + hullH * 0.5, len * 0.26); grp.add(scoop);
      const wing = boxMesh(w * 0.8, 0.08, 0.16, trim);
      wing.position.set(0, 0.78 + (hullY - 0.72) + hullH * 0.5, -len * 0.46); grp.add(wing);
    }
    // van: a side-crease + a roof cap so the tall slab doesn't read as a brick
    if (bt === "van") {
      const cap = boxMesh(roofW + 0.06, 0.1, roofD, paint);
      cap.position.set(0, roofY + roofH * 0.5, roofZ); grp.add(cap);
    }
    if (bt === "hatch") {
      const spoiler = boxMesh(roofW * 0.92, 0.07, 0.16, trim);
      spoiler.position.set(0, roofY + roofH * 0.52, -len * 0.43); grp.add(spoiler);
    }

    // Small universal cues matter at traffic distance: mirrors, door cuts and a
    // rear plate make the silhouette read as a vehicle instead of stacked boxes.
    [1, -1].forEach((side) => {
      const mirror = boxMesh(0.18, 0.12, 0.26, trim);
      mirror.position.set(side * (roofW * 0.56), roofY - roofH * 0.18, roofZ + roofD * 0.28); grp.add(mirror);
      const seam = boxMesh(0.025, hullH * 0.68, 0.035, trim);
      seam.position.set(side * (w * 0.505), 0.78 + (hullY - 0.72) + hullH * 0.1, -len * 0.05); grp.add(seam);
    });
    const plate = boxMesh(w * 0.28, 0.14, 0.025, vmat("metal", 0xe8edf2, { emissive: 0x25282c, ei: 0.25 }));
    plate.position.set(0, 0.78 + (hullY - 0.72) - hullH * 0.08, -len * 0.5 - 0.085); grp.add(plate);

    if (model && model.livery === "taxi") {
      const sign = boxMesh(0.72, 0.22, 0.34, cmat(0xf8e46b, { emissive: 0x5a4a14, ei: 0.45 }));
      sign.position.set(0, roofY + roofH * 0.62, roofZ); grp.add(sign);
      const check = boxMesh(w + 0.025, 0.1, len * 0.48, trim);
      check.position.set(0, 0.78 + (hullY - 0.72) + hullH * 0.28, -len * 0.05); grp.add(check);
    }
    const detail = model && model.detailStyle;
    if (detail && /^tesla-/.test(detail)) {
      const roofGlass = boxMesh(roofW * 0.72, 0.035, roofD * 0.5, vmat("glass", 0x111d26, { emissive: 0x061018, ei: 0.35 }));
      roofGlass.position.set(0, roofY + roofH * 0.51, roofZ - roofD * 0.04); grp.add(roofGlass);
      const cleanNose = boxMesh(w * 0.72, 0.06, 0.03, paint);
      cleanNose.position.set(0, 0.78 + (hullY - 0.72) - hullH * 0.05, len * 0.5 + 0.02); grp.add(cleanNose);
    }
    if (detail === "cybertruck") {
      const cyberGlass = vmat("glass", 0x111d26, { emissive: 0x061018, ei: 0.35 });
      const tonneau = boxMesh(w * 0.86, 0.08, len * 0.34, trim);
      tonneau.position.set(0, roofY - roofH * 0.2, -len * 0.28); grp.add(tonneau);
      [1, -1].forEach((side) => {
        const sideGlass = boxMesh(0.035, roofH * 0.52, roofD * 0.7, cyberGlass);
        sideGlass.position.set(side * roofW * 0.51, roofY, roofZ); grp.add(sideGlass);
      });
    }
    if (detail && /ferrari|enzo|veyron|aventador|porsche/.test(detail)) {
      [1, -1].forEach((side) => {
        const intake = boxMesh(0.035, 0.18, len * 0.2, trim);
        intake.position.set(side * w * 0.505, 0.78 + (hullY - 0.72), -len * 0.05); grp.add(intake);
      });
    }
    addModelIdentity(grp, model, { w, len, hullH, hullY, roofW, roofH, roofY, roofZ, paint, trim });

    // shared FRONT FASCIA: a dark grille + a slim bumper bar so every nose has a
    // face (and a chrome-ish bumper at the tail). Cheap boxes; one trim material.
    const noseY = 0.78 + (hullY - 0.72) - hullH * 0.05;
    const grille = boxMesh(w * 0.7, hullH * 0.55, 0.08, trim);
    grille.position.set(0, noseY, len * 0.5 - 0.03); grp.add(grille);
    [len * 0.5 + 0.02, -len * 0.5 - 0.02].forEach((bz) => {
      const bump = boxMesh(w * 0.96, 0.18, 0.12, trim);
      bump.position.set(0, 0.78 + (hullY - 0.72) - hullH * 0.38, bz); grp.add(bump);
    });

    addWheels(grp, halfTrack, len * (bt === "van" ? 0.34 : 0.32), wheelR);
    addLights(grp, w, 0.78 + (hullY - 0.72) + hullH * 0.05, len * 0.5, -len * 0.5);
    grp.userData.bodyKind = bt;
    grp.userData.designStyle = model && model.designStyle || bt;
    grp.userData.vehicleDims = { width: w, length: len, height: roofY + roofH * 0.5, wheelbase: len * (bt === "van" ? 0.68 : 0.64) };
    // same hole-proofing as the unified visual: seal thin-panel seams and drop
    // a dark interior shell inside the hull (merges into the trim/tire bucket)
    sealSeams(grp, { width: w });
    addInteriorShell(grp, { width: w, length: len, shellTop: 0.78 + (hullY - 0.72) + hullH * 0.45 }, trim);
    mergeStaticCarParts(grp, new Set([body, cabin]));
    return grp;
  }

  function makeCar(x, z, heading, vertical, model, aggr) {
    const grp = buildCar(model);
    grp.position.set(x, 0, z); grp.rotation.y = heading;
    CBZ.city.arena.root.add(grp);
    const prof = vehicleProfile(model, grp.userData && grp.userData.bodyKind);
    const c = {
      group: grp, pos: grp.position, heading, vertical, model: model || null,
      v: 0, vx: 0, vz: 0, color: model ? model.color : 0x3c6fd6, stolen: false, player: false, ai: true,
      lane: 0, road: null, dirSign: 1, dead: false,
      driver: { aggr: aggr != null ? aggr : 0.3 },
      pullover: 0, ranRedCD: 0, turnCD: 1 + rng() * 2, npcWanted: 0, npcDriver: null, dwell: 0, stopT: 0,
      roadRageTarget: null, roadRageT: 0, playerHitCD: 0,
      _bk: grp.userData && grp.userData.bodyKind, dims: grp.userData && grp.userData.vehicleDims,
      mass: prof.mass, armor: prof.armor, repair: prof.repair,
    };
    tagTailMeshes(c);                     // one traverse per car, at build time
    CBZ.cityCars.push(c);
    return c;
  }

  // Lightweight inspection hooks used by the vehicle audit/gallery tools.
  CBZ.cityVehicleBodyKind = modelBodyKind;
  // multiplayer: net code spawns real local cars (ownership transfer on enter/exit)
  CBZ.cityMakeCar = makeCar;
  CBZ.cityBuildAmbientCarVisual = function (modelName) {
    const model = CBZ.cityEcon && CBZ.cityEcon.carByName ? CBZ.cityEcon.carByName(modelName) : null;
    return buildCar(model);
  };
  // A drive-by / hit car used to be a crude placeholder box (gangs.js buildDbCar)
  // — the user's "fake-as-fuck car comes when a hit is sent". This builds the SAME
  // real detailed visual every other city car uses, painted in the gang's colour so
  // the rolling-up car reads as that crew's ride. A real model (rarity-weighted to
  // common street cars) carries the body/style; only the paint is overridden.
  // Returns null when the visual system isn't loaded (headless/gallery) so the
  // caller can keep its lightweight box fallback. Parity, not new cost: this is the
  // exact pipeline used by all traffic.
  CBZ.cityBuildGangCarVisual = function (color) {
    if (!CBZ.cityBuildPlayerCarVisual || !CBZ.cityInferCarStyle) return null;
    const econ = CBZ.cityEcon;
    let model = econ && econ.pickCar ? econ.pickCar(rng() < 0.1) : null;
    // paint it the gang's colour (shallow clone so the catalog entry is untouched)
    if (color != null) model = Object.assign({}, model || {}, { color: color });
    // buildCar runs the real cityBuildPlayerCarVisual pipeline (guarded above), so
    // this is the same detailed mesh all traffic uses — painted for this gang.
    return buildCar(model);
  };

  CBZ.spawnCityTraffic = function (n) {
    clearCars();
    const A = CBZ.city.arena; if (!A) return;
    _s = 1234 + n;
    const econ = CBZ.cityEcon;
    const reckFrac = TR().recklessFrac != null ? TR().recklessFrac : 0.18;
    const [cLo, cHi] = TR().cruise || [7, 12];
    for (let i = 0; i < n; i++) {
      const r = A.roads[(rng() * A.roads.length) | 0];
      const along = (rng() - 0.5) * r.len * 0.85;
      const dirSign = rng() < 0.5 ? 1 : -1;
      const laneIdx = (rng() * lanesPerDir()) | 0;
      const lane = laneOffset(dirSign, laneIdx);
      const x = r.vertical ? r.x + lane : r.x + along;
      const z = r.vertical ? r.z + along : r.z + lane;
      const heading = r.vertical ? (dirSign > 0 ? 0 : Math.PI) : (dirSign > 0 ? Math.PI / 2 : -Math.PI / 2);
      const reckless = rng() < reckFrac;
      const aggr = reckless ? 0.65 + rng() * 0.35 : 0.15 + rng() * 0.35;
      const model = econ ? econ.pickCar(rng() < 0.12) : null;
      const c = makeCar(x, z, heading, r.vertical, model, aggr);
      c.road = r; c.lane = lane; c.dirSign = dirSign; c.laneIdx = laneIdx;
      c.baseV = (cLo + rng() * (cHi - cLo)) * (reckless ? (TR().aggrSpeedMul || 1.7) : 1);
      c.v = c.baseV * 0.6; c.reckless = reckless;
    }
  };

  function clearCars() {
    for (const c of CBZ.cityCars) {
      if (CBZ.cityDemotePlayerCar) CBZ.cityDemotePlayerCar(c);
      if (c.group && c.group.parent) c.group.parent.remove(c.group);
      if (c.group) c.group.traverse(function (o) {
        if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
        if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
      });
    }
    CBZ.cityCars.length = 0;
  }
  CBZ.clearCityCars = clearCars;

  // a car the player bought / pulled from a garage — owned, full value
  CBZ.citySpawnOwnedCar = function (x, z, modelName) {
    if (!CBZ.city || !CBZ.city.arena) return null;
    const econ = CBZ.cityEcon;
    const model = modelName && econ ? econ.carByName(modelName) : (econ ? econ.pickCar(true) : null);
    const c = makeCar(x, z, 0, true, model, 0.2);
    c.stolen = false; c.ai = false; c.owned = true; c.baseV = 0; c.v = 0;
    return c;
  };

  CBZ.cityNearestCar = function (x, z, maxd) {
    let best = null, bd = maxd || 4;
    for (const c of CBZ.cityCars) { if (c.player) continue; const d = Math.hypot(c.pos.x - x, c.pos.z - z); if (d < bd) { bd = d; best = c; } }
    return best;
  };

  // ---- carjacking: a high-aggression ped grabs an ambient car + rampages ----
  let npcDrivers = 0;
  CBZ.cityNpcCarjack = function (ped, target) {
    if (npcDrivers >= 3) return false;            // bound the chaos
    const car = nearestAmbientCar(ped.pos.x, ped.pos.z, 6.5);
    if (!car) return false;
    car.npcDriver = ped; car.ai = true; car.stolen = true; car.reckless = true;
    car.driver.aggr = Math.max(0.8, ped.aggr); car.baseV = ((TR().cruise || [7, 12])[1]) * (TR().aggrSpeedMul || 1.7);
    car.pullover = 0; car.npcWanted = 1;
    // A victim escalating from a contact event pursues that offender directly.
    // Autonomous carjackers still create general traffic chaos without
    // magically knowing to target the player.
    car.roadRageTarget = target && target.pos ? target : null; car.roadRageT = car.roadRageTarget ? 12 : 0;
    ped.inCar = car; ped.group.visible = false; ped.controlled = true;
    npcDrivers++;
    if (CBZ.cityNpcOffense) CBZ.cityNpcOffense(ped, 24, "carjacking");
    return true;
  };
  function ejectNpcDriver(car) {
    const ped = car.npcDriver; if (!ped) return;
    car.npcDriver = null; npcDrivers = Math.max(0, npcDrivers - 1);
    ped.inCar = null; ped.controlled = false; ped.group.visible = true;
    ped.pos.set(car.pos.x + 1.6, 0, car.pos.z); ped.target.copy(ped.pos);
    if (CBZ.playerCharSync) {}
  }

  // ---- visible crash damage: permanently squash/cave the car mesh. Severity
  //      accumulates, so a worse hit (or a second one) deforms it further. Only
  //      group SCALE + child rotations are touched (the AI rewrites group
  //      position/heading.y every frame but never these), so the wreck persists. ----
  function crumpleCar(car, sev, impact) {
    car.crumple = Math.min(1, (car.crumple || 0) + sev);
    if (car._cside == null) car._cside = Math.random() < 0.5 ? -1 : 1;
    const c = car.crumple, grp = car.group, ud = grp.userData;
    // unified visuals now carry REAL panel craters (crashdeform.js), so the
    // whole-body squash drops to a hint — the old full squash stacked on the
    // vertex damage read as a melting toy. Box rigs keep the legacy read.
    if (CBZ.cityCarImpact && ud && ud.carVisual) grp.scale.set(1 - c * 0.05, 1 - c * 0.1, 1 - c * 0.04);
    else grp.scale.set(1 - c * 0.14, 1 - c * 0.32, 1 - c * 0.12);
    const base = ud && ud.crashBase ? ud.crashBase : { bodyY: 0.78, bodyZ: 0, cabinY: 1.45, cabinZ: 0 };
    let front = 0, rear = 0, side = 0;
    if (impact) {
      const fx = Math.sin(car.heading || 0), fz = Math.cos(car.heading || 0);
      const sx = Math.cos(car.heading || 0), sz = -Math.sin(car.heading || 0);
      const f = impact.x * fx + impact.z * fz, s = impact.x * sx + impact.z * sz;
      if (Math.abs(f) >= Math.abs(s)) { if (f > 0) front = c; else rear = c; }
      else side = c * Math.sign(s || car._cside);
    } else side = c * car._cside;
    // Deformation stays CLAMPED to panel contact (USER-FILMED BUG: the old
    // bigger offsets tore the deformable hull/cabin away from the merged
    // STATIC panels — grille/bumpers/glass floated free with see-through
    // holes between them). These maxima keep every neighbour overlapping the
    // hull at full crumple, so a wreck reads caved-in, never hollowed-out.
    if (ud && ud.body) {
      ud.body.rotation.z = (side || c * car._cside) * 0.18;
      ud.body.position.y = base.bodyY - c * 0.14;
      ud.body.position.z = base.bodyZ + (rear - front) * 0.08;
      ud.body.scale.x = 1 - Math.abs(side) * 0.1;
      ud.body.scale.z = 1 - (front + rear) * 0.12;
    }
    if (ud && ud.cabin) {
      ud.cabin.rotation.x = -front * 0.22 + rear * 0.12;
      ud.cabin.rotation.z = (side || c * car._cside) * 0.12;
      ud.cabin.position.y = base.cabinY - c * 0.26;
      ud.cabin.position.z = base.cabinZ + (rear - front) * 0.08;
    }
  }
  function crashBurst(x, z, speed, hard, catastrophic, dir) {
    if (CBZ.cityCrashFX) CBZ.cityCrashFX(x, z, { speed, hard, catastrophic, dir });
  }

  // ============================================================
  //  MULTI-STAGE VEHICLE DAMAGE  —  intact → dented → SMOKING → FIRE → EXPLODE
  //  Engine HP (100 → 0) is the master health. Crashes, gunfire and ramming
  //  chip it. Thresholds (per the GTA wisp→flame→fireball model):
  //    < 45  : SMOKING  (engine wisps, light grey)
  //    <= 15 : ON FIRE  (orange flames, ticking burn HP + driver damage)
  //    <= 0  : EXPLODE  (cityExplosion fireball, car removed)
  //  Visuals are a tiny pooled-sprite emitter LOCAL to this module (crashfx's
  //  puff pool is private), so it stays cheap: only burning/smoking cars emit,
  //  capped, distance-culled, and reusing one shared radial texture.
  // ============================================================
  const SMOKE_AT = 45, FIRE_AT = 15;
  // shared soft radial texture for all car smoke/flame sprites
  let _vfxTex = null;
  function vfxTex() {
    if (_vfxTex) return _vfxTex;
    const cv = document.createElement("canvas"); cv.width = cv.height = 48;
    const ctx = cv.getContext("2d"), r = 24, gr = ctx.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.4, "rgba(255,255,255,0.5)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 48, 48);
    _vfxTex = new THREE.Texture(cv); _vfxTex.needsUpdate = true; return _vfxTex;
  }
  const _vparts = [], _vpool = [];
  function getVPart(additive) {
    let p = _vpool.pop();
    if (!p) {
      const m = new THREE.SpriteMaterial({ map: vfxTex(), depthWrite: false, transparent: true, opacity: 0 });
      p = new THREE.Sprite(m); p.renderOrder = 9; CBZ.scene.add(p);
    }
    p.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.visible = true; return p;
  }
  // emit one smoke / flame / tyre puff. type: "smoke" | "fire" | "tire"
  function spawnVPart(x, y, z, type) {
    if (_vparts.length > 140) return;             // hard cap — never flood the GPU
    const fire = type === "fire";
    const p = getVPart(fire);
    p.position.set(x, y, z);
    const base = type === "tire" ? 0.5 : (fire ? 0.7 : 0.9);
    p.scale.set(base, base, 1); p.material.opacity = 0;
    p.material.rotation = Math.random() * 6.28;
    _vparts.push({
      s: p, age: 0,
      life: type === "tire" ? 0.5 + Math.random() * 0.3 : (fire ? 0.45 + Math.random() * 0.35 : 1.1 + Math.random() * 0.7),
      base, pop: type === "tire" ? 1.4 : (fire ? 2.0 + Math.random() : 2.6 + Math.random() * 1.4),
      vy: type === "tire" ? 0.2 : (fire ? 2.2 + Math.random() * 1.4 : 1.3 + Math.random() * 0.8),
      vx: (Math.random() - 0.5) * (fire ? 0.5 : 1.0), vz: (Math.random() - 0.5) * (fire ? 0.5 : 1.0),
      type, maxOp: type === "tire" ? 0.4 : (fire ? 0.95 : 0.42),
    });
  }
  function emitTireSmoke(car, side) {
    const a = car.heading, hx = Math.sin(a), hz = Math.cos(a), sx = Math.cos(a), sz = -Math.sin(a);
    if (side == null) side = Math.random() < 0.5 ? 1 : -1;   // a slide boils BOTH rears (caller passes ±1)
    spawnVPart(car.pos.x - hx * 1.3 + sx * side * 0.95, 0.3, car.pos.z - hz * 1.3 + sz * side * 0.95, "tire");
  }

  // ---- SKID MARKS — rubber the PLAYER's rear wheels leave under slides,
  //      handbrake lock-ups and burnouts. WHY: marks are the receipt a
  //      power-slide writes on the asphalt — you look back after the corner
  //      and SEE you drove it sideways (and a burnout outside the club is
  //      showing off in rubber). COST: every segment lives in ONE
  //      pre-allocated mesh with ONE shared material (a single draw call,
  //      ever) — a ring buffer of 80 quads, oldest silently overwritten;
  //      laying a strip is an 18-float write, zero allocation. Quads sit at
  //      y≈0.08, ABOVE the road paint stack (asphalt 0.04 → crosswalks
  //      0.072) because real rubber covers lane lines. AI cars never lay. ----
  const SKID_MAX = 80, SKID_W = 0.3;
  let skidMesh = null, skidPosArr = null, skidRing = 0, skidDead = false;
  function ensureSkidMesh() {
    if (skidMesh || skidDead) return;
    try {
      skidPosArr = new Float32Array(SKID_MAX * 18);          // 2 tris × 3 verts × xyz per segment
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(skidPosArr, 3));
      geo.computeBoundingSphere();
      const m = new THREE.MeshBasicMaterial({ color: 0x0c0d10, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
      m._shared = true;
      skidMesh = new THREE.Mesh(geo, m);
      skidMesh.frustumCulled = false;                        // verts span blocks; 1 call is cheaper than reculling
      skidMesh.matrixAutoUpdate = false;
      skidMesh.renderOrder = 2;
      CBZ.scene.add(skidMesh);
    } catch (e) { skidDead = true; }                          // stub renderer (headless) — marks just skip
  }
  function laySkidSegment(x0, z0, x1, z1) {
    ensureSkidMesh();
    if (!skidMesh) return;
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (len < 0.05) return;
    const px = (-dz / len) * SKID_W * 0.5, pz = (dx / len) * SKID_W * 0.5;
    const y = 0.078 + (skidRing % 5) * 0.0012;               // micro-stagger: crossing marks never z-fight
    const o = skidRing * 18; skidRing = (skidRing + 1) % SKID_MAX;
    const p = skidPosArr;
    p[o] = x0 + px; p[o + 1] = y; p[o + 2] = z0 + pz;
    p[o + 3] = x0 - px; p[o + 4] = y; p[o + 5] = z0 - pz;
    p[o + 6] = x1 - px; p[o + 7] = y; p[o + 8] = z1 - pz;
    p[o + 9] = x0 + px; p[o + 10] = y; p[o + 11] = z0 + pz;
    p[o + 12] = x1 - px; p[o + 13] = y; p[o + 14] = z1 - pz;
    p[o + 15] = x1 + px; p[o + 16] = y; p[o + 17] = z1 + pz;
    skidMesh.geometry.attributes.position.needsUpdate = true;
  }
  // lay strips under both rear wheels while the tyres are working hard. Anchors
  // per-wheel previous positions on the car; a gap (respawn/teleport/slide end)
  // re-anchors instead of drawing one long false stripe across the city.
  function laySkids(car, amt, fwdX, fwdZ) {
    if (amt <= 0.25 || Math.abs(car.v) < 3) { if (car._skid) car._skid.on = false; return; }
    const cm = CBZ.camera.position;
    const ddx = car.pos.x - cm.x, ddz = car.pos.z - cm.z;
    if (ddx * ddx + ddz * ddz > 60 * 60) { if (car._skid) car._skid.on = false; return; }   // beyond 60u nobody reads rubber
    const d = vehicleDims(car);
    const rb = (d.wheelbase || 2.7) * 0.45;                  // rear axle behind centre
    const two = car._playerCarFeel && car._playerCarFeel.twoWheel;
    const tw = two ? 0 : (d.width || 2) * 0.4;               // a bike lays ONE centre stripe
    const lx = car.pos.x - fwdX * rb + fwdZ * tw, lz = car.pos.z - fwdZ * rb - fwdX * tw;
    const rx = car.pos.x - fwdX * rb - fwdZ * tw, rz = car.pos.z - fwdZ * rb + fwdX * tw;
    const S = car._skid || (car._skid = { lx: 0, lz: 0, rx: 0, rz: 0, on: false });
    const moved = Math.hypot(lx - S.lx, lz - S.lz);
    if (!S.on || moved > 3.5) S.on = true;                   // (re)anchor this frame, draw from the next
    else if (moved > 0.55) {
      laySkidSegment(S.lx, S.lz, lx, lz);
      if (!two) laySkidSegment(S.rx, S.rz, rx, rz);
    } else return;                                           // not far enough yet — keep the anchor
    S.lx = lx; S.lz = lz; S.rx = rx; S.rz = rz;
  }
  // per-frame: float + fade every live car particle. Cheap; runs only when any exist.
  CBZ.onAlways(9.6, function (dt) {
    if (skidMesh && skidMesh.visible !== (g.mode === "city")) skidMesh.visible = g.mode === "city";   // rubber is city asphalt only
    if (g.mode !== "city" || !_vparts.length) return;
    for (let i = _vparts.length - 1; i >= 0; i--) {
      const p = _vparts[i]; p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) { p.s.visible = false; _vpool.push(p.s); _vparts.splice(i, 1); continue; }
      const sc = p.base + (p.pop - p.base) * (1 - (1 - t) * (1 - t));
      p.s.scale.set(sc, sc, 1);
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.s.material.opacity = (t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88) * p.maxOp;
      const col = p.s.material.color;
      if (p.type === "fire") {
        // white-hot → orange → dark over the puff's short life
        col.setRGB(1, 0.85 - t * 0.55, 0.25 - t * 0.22);
      } else if (p.type === "tire") col.setRGB(0.82, 0.82, 0.84);   // burnout smoke is WHITE — vaporized rubber, not engine oil
      else col.setRGB(0.17, 0.21, 0.2);  // grey-ish engine smoke
    }
  });

  // apply mechanical damage to a car's engine. fromGun/explosion may ignite or
  // pop it instantly at high amounts. CRASHES (fromGun=false) NEVER instant-pop:
  // reaching 0 HP from an impact leaves a DISABLED, SMOKING wreck — a fire (and
  // then an explosion) only develops over time via the burn fuse, mirroring the
  // real world where post-crash fires are rare (~0.2% of all crashes) and build
  // over minutes rather than detonating on contact (a fuel-tank fireball is a
  // Hollywood myth). Gunfire/explosive damage keeps the old instant-pop so those
  // weapons still cook a car off as before.
  function damageEngine(car, amount, fromGun) {
    if (!car || car.dead) return;
    if (car.engineHp == null) car.engineHp = 100;
    const armor = Math.max(0, Math.min(0.35, car.armor || 0));
    amount *= Math.max(0.55, 1 - armor * (fromGun ? 1.25 : 0.85));
    car.engineHp = Math.max(-50, car.engineHp - amount);
    if (car.engineHp <= 0 && !car._exploded) {
      if (fromGun) { explodeCar(car); return; }            // weapon hits still pop instantly
      // a crash that guts the motor DISABLES it (smoking wreck). A fire only
      // sometimes develops — post-crash fires are rare (~0.2% of crashes) — and
      // when it does it cooks off slowly, never an instant bump-to-fireball.
      car._smoking = true;
      maybeCrashFire(car, true);
      return;
    }
    if (fromGun) { if (car.engineHp <= FIRE_AT && !car._onFire) igniteCar(car, false); }
    else if (car.engineHp <= FIRE_AT) maybeCrashFire(car, false);   // badly-crashed: a CHANCE to ignite
    if (car.engineHp <= SMOKE_AT) car._smoking = true;
  }
  // CRASH-INDUCED FIRE — rare and slow, per real-world data (vehicle fires occur
  // in only ~0.2% of all crashes / ~2.9% of fatal ones, and post-crash fires
  // build over minutes, they do NOT instant-detonate). A badly-wrecked car only
  // SOMETIMES catches fire; disabled = the common outcome. `gutted` (engine fully
  // dead) carries a higher chance than merely fire-threshold damage.
  function maybeCrashFire(car, gutted) {
    car._smoking = true;                          // a hurt-enough motor always wisps
    if (car._onFire || car.dead || car._exploded || car._crashFireRolled) return;
    car._crashFireRolled = true;                  // roll once per wreck (re-bumps don't re-roll)
    const chance = gutted ? 0.18 : 0.06;          // most wrecks just smoke + die
    if (Math.random() < chance) igniteCar(car, true);
  }
  // crashFire = a slow post-crash burn (long cook-off); otherwise a weapon/molotov
  // fire that cooks off in a few seconds as before.
  function igniteCar(car, crashFire) {
    if (car._onFire || car.dead || car._exploded) return;
    car._onFire = true; car._smoking = true;
    car._crashFire = !!crashFire;
    // a FUSE: a weapon fire cooks off in a few seconds; a CRASH fire builds slowly
    // (real post-crash fires take minutes), giving plenty of time to bail. About
    // half of crash fires simply BURN OUT into a charred wreck instead of ever
    // exploding (a fuel-tank fireball is the exception, not the rule).
    car._fuse = crashFire ? (14 + Math.random() * 12) : (2.4 + Math.random() * 2.2);
    car._burnsOut = crashFire && Math.random() < 0.5;   // crash fire that never detonates
    if (CBZ.city && (car.player || nearCam(car, 60))) CBZ.city.note("🔥 The car's on fire — bail out!", 1.1);
  }
  function explodeCar(car) {
    if (car._exploded) return;
    car._exploded = true; car.dead = true; car._onFire = false; car._smoking = false;
    const x = car.pos.x, z = car.pos.z;
    if (car.npcDriver) killNpcDriverInCar(car);
    const byPlayer = !!(car._burnByPlayer || car.player);
    if (CBZ.cityExplosion) CBZ.cityExplosion(x, z, { power: 1.15, radius: 6.5, byPlayer: byPlayer });
    // B7: a wreck the PLAYER caused leaves scrap behind (systems/resources.js's
    // Scrap item) — a real reason to blow cars up beyond the spectacle.
    if (byPlayer && CBZ.cityEcon && CBZ.cityEcon.add) CBZ.cityEcon.add("Scrap", 2 + ((Math.random() * 5) | 0));
    // if the PLAYER was still inside, the blast handles their damage; eject them
    if (car.player && CBZ.player.driving) { CBZ.cityExitVehicle(); }
    // remove the wreck mesh now; DEFER the array splice to the reaper so we never
    // mutate cityCars mid-iteration (explodeCar fires from inside the AI loop).
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    if (car.group) car.group.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
      if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
    });
    car._reap = true;
  }
  // damage-stage tick for EVERY non-player car (smoke/fire/explode progresses
  // for ambient + abandoned wrecks too, independent of the AI lane logic), then
  // reap exploded wrecks — AFTER every per-car pass has finished this frame so we
  // never mutate cityCars mid-iteration.
  CBZ.onUpdate(38, function (dt) {
    if (g.mode !== "city") return;
    const cars = CBZ.cityCars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.player || c.dead || c.engineHp == null) continue;
      tickDamageStage(c, dt);
    }
    for (let i = cars.length - 1; i >= 0; i--) if (cars[i]._reap) cars.splice(i, 1);
  });
  function nearCam(car, r) {
    const cm = CBZ.camera.position, dx = car.pos.x - cm.x, dz = car.pos.z - cm.z;
    return dx * dx + dz * dz < r * r;
  }
  // run the smoke/fire/explosion lifecycle for ONE car for this frame. Called for
  // the player's car (every frame) and for AI cars (time-sliced in the AI loop).
  function tickDamageStage(car, dt) {
    if (car.dead || car._exploded) return;
    if (car.engineHp == null) return;          // never damaged → nothing to do
    const visible = car.player || nearCam(car, 95);
    // SMOKING — engine wisps once the motor's hurt
    if (car._smoking || car.engineHp < SMOKE_AT) {
      car._smoking = true;
      if (visible) {
        car._smkT = (car._smkT || 0) + dt;
        const rate = car._onFire ? 0.05 : 0.16;   // fire smokes harder
        if (car._smkT > rate) {
          car._smkT = 0;
          const a = car.heading, hx = Math.sin(a) * 1.7, hz = Math.cos(a) * 1.7;
          spawnVPart(car.pos.x + hx + (Math.random() - 0.5) * 0.6, 1.1, car.pos.z + hz + (Math.random() - 0.5) * 0.6, "smoke");
        }
      }
    }
    // ON FIRE — flames off the hood + a ticking burn that finishes the engine,
    // hurts the driver, and finally cooks off into the explosion.
    if (car._onFire) {
      car._burnByPlayer = car._burnByPlayer || car.player;
      car._fuse -= dt;
      // burn keeps eating the engine so even a parked burning weapon-fire car
      // eventually blows. A crash fire's engine is already gutted, so its cook-off
      // is governed by the (long) fuse alone — not an instantly-zero engineHp.
      if (!car._crashFire) car.engineHp -= 7 * dt;
      if (visible) {
        car._fireT = (car._fireT || 0) + dt;
        if (car._fireT > 0.06) {
          car._fireT = 0;
          const a = car.heading, hx = Math.sin(a) * 1.7, hz = Math.cos(a) * 1.7;
          spawnVPart(car.pos.x + hx + (Math.random() - 0.5) * 0.7, 1.0, car.pos.z + hz + (Math.random() - 0.5) * 0.7, "fire");
        }
      }
      // tick damage to whoever's inside while it burns
      if (car.player && CBZ.cityHurtPlayer) {
        car._burnTickCD = (car._burnTickCD || 0) - dt;
        if (car._burnTickCD <= 0) { car._burnTickCD = 0.5; CBZ.cityHurtPlayer(6, car.pos.x, car.pos.z, "burned in the car", false, null, true); if (CBZ.player.dead) return; }
      }
      // cook-off: weapon fires blow when the burn finishes the engine or the
      // fuse runs out; a crash fire only when its (long) fuse expires — and a
      // _burnsOut crash fire just dies down into a charred, smoking wreck.
      if (car._crashFire) {
        if (car._fuse <= 0) {
          if (car._burnsOut) { car._onFire = false; car._smoking = true; car._fuse = 0; return; }
          explodeCar(car); return;
        }
      } else if (car._fuse <= 0 || car.engineHp <= 0) { explodeCar(car); return; }
    }
  }

  // ============================================================
  //  TIRES ARE A TARGET — shoot a wheel and THAT tire blows, instead of the
  //  round quietly chipping generic engine HP (USER-FILMED: "shooting cars
  //  feels wrong"). WHY: aiming for rubber is the classic chase-ender — it
  //  must read corner-exact: the struck wheel deflates, the body settles
  //  toward it, a front flat drags the nose, a rear flat kills the launch,
  //  and all four leaves you grinding along on the rims.
  //  State: car._flats bitmask — 1=front-left  2=front-right
  //                              4=rear-left   8=rear-right
  //  (left = the car's local +x side; forward = local +z, like heading math)
  // ============================================================
  function tireAt(car, p) {
    if (!p || p.y == null || p.y > 1.1) return 0;          // wheels live below ~1.1u
    const d = vehicleDims(car);
    const wb = (d.wheelbase || 2.7) * 0.5, track = (d.width || 2) * 0.5;
    const h = car.heading || 0;
    const fx = Math.sin(h), fz = Math.cos(h), sx = Math.cos(h), sz = -Math.sin(h);
    const rx = p.x - car.pos.x, rz = p.z - car.pos.z;
    const along = rx * fx + rz * fz, lat = rx * sx + rz * sz;
    // nearest wheel centre in the car's own frame — generous 0.75u radius so a
    // round into the arch/fender skirt still counts as a wheel shot.
    const ca = along > 0 ? wb : -wb, cl = lat > 0 ? track : -track;
    const da = along - ca, dl = lat - cl;
    if (da * da + dl * dl > 0.75 * 0.75) return 0;
    return 1 << ((along > 0 ? 0 : 2) + (lat > 0 ? 0 : 1));
  }
  // body settles toward the dead corner(s) — tiny angles, but at a glance the
  // car reads "sitting wrong" exactly where you shot it.
  function flatLean(car) {
    const f = car._flats | 0; if (!f) return null;
    let roll = 0, pitch = 0;
    if (f & 1) { roll += 0.032; pitch += 0.02; }
    if (f & 2) { roll -= 0.032; pitch += 0.02; }
    if (f & 4) { roll += 0.032; pitch -= 0.02; }
    if (f & 8) { roll -= 0.032; pitch -= 0.02; }
    return { roll, pitch };
  }
  // deflate the struck corner's wheel MESH (radial squash + drop onto the rim).
  // Wheels stay unmerged + tagged playerWheel by the unified visual builder;
  // scale.x/z shrink the cylinder's radius and stay invariant under the spin
  // applied by cityUpdatePlayerCarVisual. Box rigs merge their wheels — they
  // skip the squash and keep just the body lean.
  function applyFlatVisual(car) {
    const ud = car.group && car.group.userData;
    const vis = car._playerCarVisual || (ud && ud.carVisual);
    car._flatVis = vis || null;
    if (!vis) return;
    const wheels = (vis.userData && vis.userData.playerWheels) || [];
    const list = wheels.length ? wheels : (function () {
      const out = [];
      vis.traverse(function (o) { if (o.userData && o.userData.playerWheel) out.push(o); });
      return out;
    })();
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const bit = 1 << ((w.position.z > 0 ? 0 : 2) + (w.position.x > 0 ? 0 : 1));
      if (!(car._flats & bit) || w._flatSq) continue;
      w._flatSq = true;
      const r = (w.geometry && w.geometry.parameters && w.geometry.parameters.radiusTop) || 0.4;
      w.scale.x *= 0.68; w.scale.z *= 0.68;        // radial: tire's gone, rim's left
      w.position.y -= r * 0.3;                     // settle the rim toward the road
    }
  }
  // PUBLIC: a bullet landed at `point` — if that's a wheel, blow the tire.
  // Returns true when the round hit rubber (callers soften engine damage).
  CBZ.cityCarTireHit = function (car, point) {
    if (!car || car.dead || !point) return false;
    const bit = tireAt(car, point);
    if (!bit) return false;
    if (car._flats == null) car._flats = 0;
    const side = (bit === 1 || bit === 4) ? 1 : -1;
    emitTireSmoke(car, side);                      // even re-shooting a flat coughs rubber
    if (car._flats & bit) return true;             // that corner's already dead
    car._flats |= bit;
    // the POP: a burst of shredded-rubber smoke + a bang you hear over the gun
    emitTireSmoke(car, side); emitTireSmoke(car, side);
    if (CBZ.sfx && nearCam(car, 70)) CBZ.sfx("clank");
    applyFlatVisual(car);
    const L = flatLean(car);
    if (L && !car.player) {                        // AI loop only writes rotation.y — set the sag once
      car.group.rotation.x = L.pitch; car.group.rotation.z = L.roll;
    }
    // a fresh flat under an AI driver: a brief swerve/wobble (the wreckT spin
    // machinery the crash path already uses), then LIMP to the curb and crawl —
    // a blown tire ends the cruise, it doesn't get floored through.
    if (car.ai && !car.player) {
      car.wreckT = Math.max(car.wreckT || 0, 0.7);
      car.spin = (car.spin || 0) + (Math.random() < 0.5 ? -1 : 1) * (0.8 + Math.random() * 0.9);
      car.baseV = Math.min(car.baseV || 9, 2.2);
      if (car.lane) {                                          // hug the curb (scaled to road width)
        const rd = (CBZ.CITY && CBZ.CITY.road) || 9;
        car.lane = (car.lane < 0 ? -1 : 1) * Math.max(2.2, rd / 2 - 1.5);
        car.laneIdx = lanesPerDir() - 1;
      }
      car.reckless = false;
    }
    return true;
  };

  // ---- PUBLIC: take damage from bullets / explosions elsewhere (combat, cops).
  //      amount is in engine-HP points; opts.byPlayer attributes the kill. A
  //      direct hit on an already-smoking car can light it; big hits pop it. ----
  CBZ.cityDamageCar = function (car, amount, opts) {
    if (!car || car.dead) return;
    opts = opts || {};
    if (opts.byPlayer) car._burnByPlayer = true;
    if (car.engineHp == null) car.engineHp = 100;
    // WHEEL SHOT: the round went into rubber, not the motor — blow that tire
    // and let only a sliver of the energy reach the engine block.
    const tire = opts.point ? CBZ.cityCarTireHit(car, opts.point) : false;
    if (tire) amount *= 0.25;
    // tracer hits also visibly spark/dent the hull a touch
    if (!tire && opts.crumple) crumpleCar(car, Math.min(0.2, amount * 0.004));
    // exact-point dent: a small crater under the bullet-hole decal. The shot
    // resolver threads opts.point (world Vector3-ish), opts.normal (entry
    // face, toward the shooter) and opts.cal — caliber sets the dimple.
    if (!tire && opts.point && CBZ.cityCarImpact) {
      const n = opts.normal || { x: 0, y: 0, z: 0 };
      CBZ.cityCarImpact(car, opts.point, { x: -(n.x || 0), y: -(n.y || 0), z: -(n.z || 0) },
        1.6 + (opts.cal || 1) * 1.5, { r: 0.22 + (opts.cal || 1) * 0.08 });
    }
    damageEngine(car, amount, true);
    // a driver taking fire doesn't keep cruising the speed limit — they FLOOR it
    // (unless the round just took a tire: you can't floor it on a flat)
    if (!tire && opts.byPlayer && car.ai && !car.dead && !car.npcDriver) {
      car.reckless = true;
      car.baseV = Math.max(car.baseV || 0, ((CBZ.CITY.traf && CBZ.CITY.traf.cruise) || [7, 12])[1] * 1.5);
    }
  };
  // PUBLIC: force a car to catch fire now (e.g. molotov, fuel-line shot)
  CBZ.cityCarIgnite = function (car, byPlayer) {
    if (!car || car.dead) return;
    if (car.engineHp == null || car.engineHp > FIRE_AT) car.engineHp = FIRE_AT;
    if (byPlayer) car._burnByPlayer = true;
    igniteCar(car);
  };
  // PUBLIC: read damage stage for HUD/minimap. 0 intact,1 dented,2 smoke,3 fire
  CBZ.cityCarStage = function (car) {
    if (!car || car.engineHp == null) return (car && car.crumple > 0.25) ? 1 : 0;
    if (car._onFire) return 3;
    if (car.engineHp < SMOKE_AT) return 2;
    return car.crumple > 0.25 ? 1 : 0;
  };
  // a driver dies AT THE WHEEL (a fast crash into a building/post): the body
  // drops out and the now-driverless car careens to a dead stop and is abandoned.
  function killNpcDriverInCar(car) {
    const ped = car.npcDriver;
    ejectNpcDriver(car);                                  // body drops out, visible
    if (ped && !ped.dead && CBZ.cityKillPed) CBZ.cityKillPed(ped, { fromX: car.pos.x, fromZ: car.pos.z, force: 5, fling: 2 }, "killed in the crash");
    car.npcWanted = 0; car.stolen = false; car.roadRageTarget = null; car.roadRageT = 0; car.pullover = 0;
    car.abandoned = true;
    car.wreckT = Math.max(car.wreckT || 0, 1.0);
  }
  function nearestAmbientCar(x, z, maxd) {
    let best = null, bd = maxd * maxd;
    for (const c of CBZ.cityCars) { if (c.player || c.npcDriver || c.owned || c.dead) continue; const dd = (c.pos.x - x) * (c.pos.x - x) + (c.pos.z - z) * (c.pos.z - z); if (dd < bd) { bd = dd; best = c; } }
    return best;
  }

  // ---- enter / exit ----
  CBZ.cityEnterVehicle = function (car) {
    if (!car || car.player) return false;
    if (car.npcDriver) ejectNpcDriver(car);
    const P = CBZ.player;
    P.driving = true; P._vehicle = car;
    car.player = true; car.ai = false; car.pullover = 0;
    if (!car.stolen && !car.owned) {
      car.stolen = true;
      CBZ.cityCrime && CBZ.cityCrime(60, { x: car.pos.x, z: car.pos.z, type: "gta" });
      if (anyWitness(car.pos.x, car.pos.z, 22)) CBZ.city && CBZ.city.note("🚗 Grand Theft Auto!", 1.6);
    }
    car.v = 0;
    CBZ.playerChar.group.visible = false;
    if (CBZ.cityPromotePlayerCar) CBZ.cityPromotePlayerCar(car);
    if (CBZ.sfx) CBZ.sfx("door");
    if (CBZ.carAudio) CBZ.carAudio.start();   // the motor turns over the moment you're in
    const worth = car.model ? "  ·  " + car.model.name : "";   // value stays hidden until you chop it
    CBZ.city && CBZ.city.note("Driving" + worth + " — [E] out  [C] car style", 1.8);
    return true;
  };
  CBZ.cityExitVehicle = function () {
    const P = CBZ.player, car = P._vehicle;
    P.driving = false; P._vehicle = null;
    if (CBZ.carAudio) CBZ.carAudio.stop();    // key off — the engine voice dies with the seat
    if (car && car._skid) car._skid.on = false;
    if (car) {
      car.player = false; car.v = 0; car.vx = car.vz = 0; car.ai = false;
      car._pitch = car._roll = 0;
      setBrake(car, false);               // parked — foot's off the pedal
      if (car.group) car.group.rotation.set(0, car.heading, 0);   // drop the weight-transfer lean
      if (CBZ.cityDemotePlayerCar) CBZ.cityDemotePlayerCar(car);
    }
    CBZ.playerChar.group.visible = true;
    if (car) {
      const ox = Math.cos(car.heading) * 1.6, oz = -Math.sin(car.heading) * 1.6;
      P.pos.set(car.pos.x + ox, 0, car.pos.z + oz);
      P.grounded = true; P.vy = 0;
      CBZ.playerChar.group.position.copy(P.pos);
    }
    if (CBZ.sfx) CBZ.sfx("door");
  };

  function anyWitness(x, z, r) {
    const r2 = r * r;
    for (const p of CBZ.cityPeds) { if (p.dead || p.vendor) continue; const dx = p.pos.x - x, dz = p.pos.z - z; if (dx * dx + dz * dz < r2) return true; }
    for (const c of CBZ.cityCops) { if (c.dead) continue; const dx = c.pos.x - x, dz = c.pos.z - z; if (dx * dx + dz * dz < r2) return true; }
    return false;
  }
  function copNear(x, z, r) {
    const r2 = r * r;
    for (const c of CBZ.cityCops) { if (c.dead) continue; const dx = c.pos.x - x, dz = c.pos.z - z; if (dx * dx + dz * dz < r2) return c; }
    return null;
  }

  // (the old dedicated F-to-enter/exit binding is GONE: car enter/boost/jack/
  //  step-out are option records in the interaction registry now — see
  //  city/interact.js "vehicle" / "vehicle:inside" registrations. One context
  //  system, every verb visible before you press it.)

  // ---- per-car DYNAMICS, derived from the model + how wrecked it is ---------
  // GTA-style arcade handling: a body type sets the base feel (a coupe darts,
  // an SUV/pickup is heavy & numb), the model's rarity (s) scales top speed +
  // grunt, and accumulated DAMAGE (engine HP) eats accel/grip/top-speed and
  // adds a bent-axle pull so a beat-up car drives like a beat-up car.
  function bodyKind(car) {
    if (car._bk) return car._bk;
    car._bk = modelBodyKind(car.model); return car._bk;
  }
  // 0 = pristine, 1 = totalled. engineHp starts at 100 and only falls.
  function carDmg(car) { return 1 - Math.max(0, Math.min(100, car.engineHp == null ? 100 : car.engineHp)) / 100; }
  function vehicleCondition(car) {
    const engine = Math.max(0, Math.min(100, !car || car.engineHp == null ? 100 : car.engineHp));
    const cr = Math.max(0, Math.min(1, (car && car.crumple) || 0));
    const burn = car && car._onFire ? 0.35 : 0;
    const pct = Math.max(0, Math.min(1, engine / 100 - cr * 0.35 - burn));
    const label = car && car._onFire ? "on fire"
      : pct > 0.82 ? "clean"
      : pct > 0.62 ? "dented"
      : pct > 0.38 ? "wrecked"
      : pct > 0.12 ? "barely running"
      : "totaled";
    const valueMul = Math.max(0.12, 0.42 + pct * 0.68 - cr * 0.22);
    return { pct, label, valueMul, engine, crumple: cr };
  }
  CBZ.cityVehicleCondition = vehicleCondition;
  function carDynamics(car) {
    const bk = bodyKind(car);
    const rarity = car.model ? Math.max(0, Math.min(1, car.model.rarity || 0)) : 0.35;
    // Base profile per body type. Wheelbase + steering lock feed a bicycle-model
    // yaw approximation; drag/rolling resistance control coast-down separately
    // from braking, so letting off the throttle no longer feels like braking.
    // GTA vehicle-class feel — super/sports grip + accel high, muscle grunty but
    // loose-tailed, SUV/van/pickup heavy & numb with weaker brakes.
    let accel = 30, top = 33, turn = 2.5, grip = 7.0, brake = 30;
    let wheelbase = 2.62, steerLock = 0.56, drag = 0.0065, rolling = 1.15;
    if (bk === "coupe") { accel = 42; top = 44; turn = 3.0; grip = 9.4; brake = 38; }
    else if (bk === "muscle") { accel = 40; top = 41; turn = 2.45; grip = 6.6; brake = 30; }   // fast in a line, tail steps out
    else if (bk === "sedan") { accel = 32; top = 35; turn = 2.6; grip = 7.4; brake = 32; }
    else if (bk === "suv") { accel = 26; top = 31; turn = 2.1; grip = 5.6; brake = 27; }
    else if (bk === "pickup") { accel = 27; top = 32; turn = 2.0; grip = 5.2; brake = 26; }
    else if (bk === "van") { accel = 23; top = 29; turn = 1.85; grip = 4.8; brake = 24; }
    else if (bk === "hatch") { accel = 29; top = 31; turn = 2.85; grip = 7.2; brake = 31; wheelbase = 2.42; steerLock = 0.6; }
    if (bk === "coupe") { wheelbase = 2.48; steerLock = 0.58; drag = 0.0055; rolling = 0.9; }
    else if (bk === "muscle") { wheelbase = 2.78; steerLock = 0.52; rolling = 1.05; }
    else if (bk === "suv") { wheelbase = 2.9; steerLock = 0.48; drag = 0.008; rolling = 1.4; }
    else if (bk === "pickup") { wheelbase = 3.08; steerLock = 0.46; drag = 0.0085; rolling = 1.5; }
    else if (bk === "van") { wheelbase = 3.18; steerLock = 0.44; drag = 0.009; rolling = 1.6; }
    // Performance follows the model's market tier, not its visual length. The
    // old use of `s` accidentally made long vans faster than short sports cars.
    top *= 0.88 + rarity * 0.28;
    accel *= 0.9 + rarity * 0.22;
    // the promoted player-car STYLE layers its GTA-class feel on top (a Veyron
    // grips and rockets, a van wallows) so swapping style ([C]) actually drives
    // differently — published by playercars.js as car._playerCarFeel.
    const feel = car.player ? car._playerCarFeel : null;
    let roll = 0.6, drift = 1.0;
    if (feel) {
      accel *= feel.accel; top *= feel.top; turn *= feel.turn; grip *= feel.grip; brake *= feel.brake;
      roll = feel.roll == null ? 0.6 : feel.roll; drift = feel.drift == null ? 1.0 : feel.drift;
      if (feel.twoWheel) roll = 0;   // a bike leans via its own rider rig, not whole-body roll
    } else {
      if (bk === "coupe") { roll = 0.4; drift = 0.9; }
      else if (bk === "muscle") { roll = 0.7; drift = 1.35; }
      else if (bk === "suv") { roll = 1.1; drift = 1.05; }
      else if (bk === "pickup") { roll = 1.0; drift = 1.05; }
      else if (bk === "van") { roll = 1.3; drift = 1.1; }
    }
    // DAMAGE degrades it: a smoking/burning car is gutless and squirrelly
    const d = carDmg(car);
    accel *= 1 - d * 0.55; top *= 1 - d * 0.42; grip *= 1 - d * 0.5; turn *= 1 - d * 0.28;
    // BLOWN TIRES (car._flats bitmask): a flat FRONT cuts grip + steering and
    // (in the drive loop) drags the nose toward the dead side; a flat REAR cuts
    // grip + top speed. All four = riding on rims — barely a car anymore.
    const f = car._flats | 0;
    let flatPull = 0;
    if (f) {
      const fc = (f & 1 ? 1 : 0) + (f & 2 ? 1 : 0), rc = (f & 4 ? 1 : 0) + (f & 8 ? 1 : 0);
      grip *= 1 - fc * 0.18 - rc * 0.14;
      turn *= 1 - fc * 0.2;
      top *= 1 - fc * 0.05 - rc * 0.14;
      accel *= 1 - (fc + rc) * 0.07;
      if (fc + rc === 4) { top *= 0.45; grip *= 0.65; }
      // front flats steer the car: pull toward the flat side (left = +heading)
      flatPull = (f & 1 ? 0.14 : 0) - (f & 2 ? 0.14 : 0);
    }
    return { accel, top, turn, grip, brake, dmg: d, roll, drift, wheelbase, steerLock, drag, rolling, flatPull };
  }
  function vehicleDims(car) {
    return (car && (car._visualDims || car.dims)) || { width: 2, length: 4.4, wheelbase: 2.7 };
  }
  // ---- ENGINE VOICE class + fake gearbox ----------------------------------
  // The audio synth (systems/audio.js CBZ.carAudio) has five crank voices; map
  // whatever you're sitting in onto one so a stolen Veyron SOUNDS exotic and a
  // work van sounds like a work van. Re-checked every frame (string compare,
  // free) so the [C] style-cycler retunes the motor the moment the body swaps.
  function engineFlavor(car) {
    const feel = car._playerCarFeel, cls = feel && feel.class;
    if (cls === "motorcycle") return "bike";
    if (cls === "super" || cls === "sports") return "sports";
    if (cls === "muscle" || cls === "lowrider") return "muscle";
    if (cls === "suv" || cls === "van" || cls === "boat" || cls === "helicopter") return "truck";
    const bk = bodyKind(car);
    if (bk === "coupe") return "sports";
    if (bk === "muscle") return "muscle";
    if (bk === "suv" || bk === "pickup" || bk === "van") return "truck";
    return "sedan";
  }
  // top-of-gear points as fractions of the car's own top speed: revs climb
  // through each band and DROP on the shift — five fake gears read as a real
  // box without simulating one.
  const GEAR_TOP = [0.14, 0.30, 0.50, 0.74, 1.01];
  function wallRadius(car) {
    const d = vehicleDims(car);
    return Math.max(1.05, Math.min(1.6, d.width * 0.58));
  }
  function collideVehicle(car) {
    if (!CBZ.collide || !car || !car.pos) return 0;
    const ox = car.pos.x, oz = car.pos.z, radius = wallRadius(car);
    CBZ.collide(car.pos, radius);
    const d = vehicleDims(car);
    const reach = Math.max(0, d.length * 0.5 - radius * 0.45);
    if (reach > 0.2) {
      const sign = (car.v || 0) < -0.1 ? -1 : 1;
      const fx = Math.sin(car.heading || 0) * sign, fz = Math.cos(car.heading || 0) * sign;
      const probe = { x: car.pos.x + fx * reach, y: car.pos.y || 0, z: car.pos.z + fz * reach };
      const px = probe.x, pz = probe.z;
      CBZ.collide(probe, radius * 0.75);
      car.pos.x += probe.x - px;
      car.pos.z += probe.z - pz;
    }
    return Math.hypot(car.pos.x - ox, car.pos.z - oz);
  }
  CBZ.cityCollideVehicle = collideVehicle;

  // ---- player driving (order 11) ----
  CBZ.onUpdate(11, function (dt) {
    if (g.mode !== "city") return;
    const P = CBZ.player;
    if (!P.driving || !P._vehicle || P.dead) return;
    const car = P._vehicle, k = CBZ.keys;
    const D = carDynamics(car);
    const ACCEL = D.accel, MAXV = D.top, REV = 13, TURN = D.turn;
    // ---- throttle / braking ----
    let throttle = 0;
    if (k["w"]) throttle += 1;
    if (k["s"]) throttle -= 1;
    const handbrake = !!k[" "];   // SPACE = handbrake → break grip and DRIFT
    if (throttle > 0) {
      if (car.v < 0) car.v += D.brake * dt;           // brake out of reverse first
      else car.v += ACCEL * dt * (1 - Math.min(0.7, car.v / MAXV));   // accel tapers near top end
    } else if (throttle < 0) {
      if (car.v > 0.5) car.v -= D.brake * dt;         // S brakes hard when rolling forward
      else car.v -= (ACCEL * 0.55) * dt;              // then backs up
    }
    if (throttle === 0) {
      const coast = (D.rolling + D.drag * car.v * car.v) * dt;
      if (car.v > 0) car.v = Math.max(0, car.v - coast);
      else if (car.v < 0) car.v = Math.min(0, car.v + coast);
    }
    if (handbrake) car.v *= Math.pow(0.34, dt);       // handbrake bleeds forward speed
    car.v = Math.max(-REV, Math.min(MAXV, car.v));
    // ---- steering: smooth input + speed-sensitive bicycle-model yaw. This
    //      keeps low-speed parking controllable and removes instant high-speed
    //      direction changes while preserving arcade authority. ----
    let steer = 0;
    if (k["a"]) steer += 1;
    if (k["d"]) steer -= 1;
    const vmag = Math.abs(car.v);
    // brake lights: S while rolling forward, or the handbrake at speed
    setBrake(car, (throttle < 0 && car.v > 0.4) || (handbrake && vmag > 1));
    const steerRate = steer ? 7.5 : 10.5;
    car._steerInput = (car._steerInput || 0) + (steer - (car._steerInput || 0)) * Math.min(1, dt * steerRate);
    const speedNorm = Math.min(1, vmag / Math.max(1, MAXV));
    const lock = D.steerLock * (1 - speedNorm * 0.48);
    const bicycleYaw = (car.v / Math.max(1.8, D.wheelbase)) * Math.tan(car._steerInput * lock);
    const yawLimit = TURN * (1 - speedNorm * 0.42) * (handbrake ? 1.35 : 1);
    const yaw = Math.max(-yawLimit, Math.min(yawLimit, bicycleYaw));
    if (vmag > 0.3) {
      car.heading += yaw * dt;
      if (D.dmg > 0.45) {                              // damaged axle drags the nose to one side
        if (car._pull == null) car._pull = (car._cside || 1) * (0.18 + Math.random() * 0.12);
        car.heading += car._pull * (D.dmg - 0.45) * dt * Math.min(1, vmag / 8);
      }
      // a blown FRONT tire drags the wheel steadily toward the flat — you hold
      // opposite lock the whole way home (carDynamics signs it per corner)
      if (D.flatPull) car.heading += D.flatPull * dt * Math.min(1, vmag / 8);
    }
    // ---- GRIP model: split the PREVIOUS velocity into forward + lateral
    //      (relative to the now-steered heading), bleed the lateral slip down by
    //      grip, then rebuild velocity = engine-forward + the surviving slip. Low
    //      grip (handbrake / a steered hard turn / a worn car) lets the rear step
    //      out and the car holds a power-slide instead of running on rails. ----
    const fwdX = Math.sin(car.heading), fwdZ = Math.cos(car.heading);
    const prevX = car.vx == null ? fwdX * car.v : car.vx;
    const prevZ = car.vz == null ? fwdZ * car.v : car.vz;
    const latDot = prevX * fwdX + prevZ * fwdZ;        // forward component of old vel
    let latX = prevX - fwdX * latDot, latZ = prevZ - fwdZ * latDot;   // sideways slip
    // grip = how fast lateral slip decays. handbrake / power-steer keeps it alive.
    // loose-tailed cars (muscle, van — D.drift>1) let the rear step out sooner; a
    // grippy super (D.drift<1) stays planted. throttle-on in a hard turn also
    // breaks traction a touch (power-oversteer) so muscle cars feel rowdy.
    const driftMul = D.drift || 1;
    const power = throttle > 0 && vmag > 10 ? 1.4 * driftMul : 0;
    const rawSlip = Math.hypot(latX, latZ);
    const slipRatio = rawSlip / Math.max(3, vmag);
    // Tire force peaks at modest slip, then falls once the tire is sliding. It
    // makes a drift recoverable without the rear snapping unrealistically back.
    const slideGrip = slipRatio <= 0.18 ? 1 : Math.max(0.38, 1 - (slipRatio - 0.18) * 1.75);
    const gripFactor = handbrake ? 0.75 : Math.max(0.42, (D.grip + (car._steerInput && vmag > 8 ? -2.25 * driftMul : 0) - power) * slideGrip);
    const latKeep = handbrake ? Math.min(0.95, 0.9 + driftMul * 0.02) : Math.max(0, 1 - gripFactor * dt);
    latX *= latKeep; latZ *= latKeep;
    const velX = fwdX * car.v + latX, velZ = fwdZ * car.v + latZ;
    const slip = Math.hypot(latX, latZ);
    car._drift = slip;
    // ---- DRIVING JUICE: one number — how hard are the rear tyres working?
    //      Slides (lateral slip), handbrake lock-ups, a full-brake stop from
    //      speed and a hard launch in something powerful all count. It drives
    //      the screech volume, the white smoke and the rubber on the road. ----
    const burnout = throttle > 0 && vmag > 0.6 && vmag < 7 && D.accel > 32;   // a strong motor lights them up off the line
    const skidAmt = Math.max(
      slip > 2.2 && vmag > 6 ? Math.min(1, slip / 8) : 0,
      handbrake && vmag > 6 ? 0.85 : 0,
      throttle < 0 && car.v > Math.max(14, MAXV * 0.55) ? 0.55 : 0,           // locked-up panic stop
      burnout ? 0.6 : 0
    );
    if (skidAmt > 0.3) {                               // white smoke boils off BOTH rears
      car._tireT = (car._tireT || 0) + dt;
      if (car._tireT > 0.13 - skidAmt * 0.06) { car._tireT = 0; emitTireSmoke(car, 1); emitTireSmoke(car, -1); }
    }
    // ALL FOUR SHOT OUT: grinding along on bare rims — a constant cough of
    // shredded-rubber/rim smoke off both rears whenever you force it to move
    if (car._flats === 15 && vmag > 6) {
      car._rimT = (car._rimT || 0) + dt;
      if (car._rimT > 0.16) { car._rimT = 0; emitTireSmoke(car, 1); emitTireSmoke(car, -1); }
    }
    laySkids(car, skidAmt, fwdX, fwdZ);
    // ---- ENGINE VOICE: revs climb through the fake gear band, snap down on
    //      the upshift. Reverse whines low; revving at a standstill screams. ----
    if (CBZ.carAudio) {
      const sN = Math.min(1, vmag / Math.max(1, MAXV));
      let gear = 0; while (gear < GEAR_TOP.length - 1 && sN >= GEAR_TOP[gear]) gear++;
      const glo = gear === 0 ? 0 : GEAR_TOP[gear - 1];
      let rev = car.v < 0 ? Math.min(1, vmag / REV) * 0.4
        : (sN - glo) / Math.max(0.05, GEAR_TOP[gear] - glo);
      rev = 0.06 + Math.max(0, Math.min(1, rev)) * 0.9;
      if (throttle > 0 && vmag < 2.5) rev = Math.max(rev, 0.5);   // revving it off the line / mid-burnout
      const shifted = car._gear != null && gear > car._gear && throttle > 0;
      car._gear = gear;
      CBZ.carAudio.update(rev, throttle > 0 ? 1 : 0, skidAmt, engineFlavor(car), shifted);
    }
    // ---- WEIGHT TRANSFER (visual game-feel): the body PITCHES (squat on
    //      throttle, dive on brake) and ROLLS into a turn, eased so it reads as
    //      mass shifting. softer cars (high D.roll) lean more. Touches only the
    //      group rotation x/z, which the crash crumple leaves alone. ----
    const accelG = throttle > 0 ? -1 : (throttle < 0 && car.v > 0.5 ? 1.3 : 0);
    const pitchTarget = Math.max(-0.07, Math.min(0.09, accelG * 0.05 * Math.min(1, vmag / 14)));
    // body leans OUTWARD of the turn: steering at speed plus any tail-out slip.
    const latG = car._steerInput * Math.min(1, vmag / 12) + (latX * fwdZ - latZ * fwdX) * 0.16;
    let rollTarget = Math.max(-0.16, Math.min(0.16, latG * 0.06 * (D.roll || 0.6)));
    let pitchT2 = pitchTarget;
    // the body SITS on its blown corner(s) — the lean rides the same eased
    // weight-transfer channel, so it composes with squat/dive/roll for free
    if (car._flats) {
      const FL = flatLean(car);
      if (FL) { pitchT2 += FL.pitch; rollTarget += FL.roll; }
      // [C] style-cycler swapped the visual under us — re-deflate the new wheels
      if (car._playerCarVisual && car._playerCarVisual !== car._flatVis) applyFlatVisual(car);
    }
    car._pitch = (car._pitch || 0) + (pitchT2 - (car._pitch || 0)) * Math.min(1, dt * 7);
    car._roll = (car._roll || 0) + (rollTarget - (car._roll || 0)) * Math.min(1, dt * 6);
    car.vx = velX; car.vz = velZ;
    car.pos.x += velX * dt; car.pos.z += velZ * dt;
    const before = { x: car.pos.x, z: car.pos.z };
    const moved = collideVehicle(car);
    if (moved > 0.05 && vmag > 5) {
      // CRASH — far cooler at speed: the car PILES INTO the wall, sheds nearly all
      // its forward momentum but RICOCHETS back along the surface (keeps a chunk of
      // the slide so it slews sideways instead of dead-stopping), spins out, jolts
      // the driver, throws a big speed-scaled shake + hitstop, a metal crunch, and
      // shatters / drives through any storefront glass ahead.
      const hard = vmag >= CRASH.wallHard, catastrophic = vmag >= CRASH.wallCatastrophic;
      // approximate the wall normal from how the collider pushed the car back
      let nwx = before.x - car.pos.x, nwz = before.z - car.pos.z;
      const nl = Math.hypot(nwx, nwz) || 1; nwx /= nl; nwz /= nl;
      car.v *= catastrophic ? 0.05 : (hard ? 0.14 : 0.48);
      // momentum transfer into the wall: bleed the velocity, reflect a little of it
      // back off the surface so the hull slews + scrubs rather than freezing.
      const bounce = catastrophic ? 0.12 : (hard ? 0.2 : 0.35);
      const vdotn = car.vx * nwx + car.vz * nwz;
      car.vx = (car.vx - 2 * vdotn * nwx) * bounce; car.vz = (car.vz - 2 * vdotn * nwz) * bounce;
      // the impact damages the engine on a SPEED-SCALED curve (NHTSA/IIHS ladder):
      // a low-speed wall scuff barely touches the motor, a moderate hit dings it,
      // and only a fast slam guts it. Even a catastrophic hit no longer instantly
      // explodes (damageEngine routes crashes through the burn fuse) — it disables
      // the car into a smoking/burning wreck the player can bail from.
      //   below wallHard : 0.6 HP per unit of speed above the 5-unit no-damage floor
      //                    (~9 HP at a 20 mph clip — survives many; many bumps to kill)
      //   hard           : ~26 + speed-over-threshold ramp
      //   catastrophic   : heavy enough to GUT the motor (engineHp→0) so it always
      //                    becomes at least a disabled, smoking wreck (was 52 → a
      //                    30-unit slam left it at HP 48, not even smoking; the bug
      //                    fast-impact-velocity-detonate flags). Now it reliably
      //                    disables, then cooks off via the (rare, slow) fire fuse.
      const crashE = catastrophic ? (110 + (vmag - CRASH.wallCatastrophic) * 8)
                   : hard         ? (24 + (vmag - CRASH.wallHard) * 2)
                                  : Math.max(0, (vmag - 5) * 0.6);
      damageEngine(car, crashE, false);
      // TOP-SPEED ram ALWAYS ignites → explodes (fast-impact-velocity-detonate
      // "things hitting things BLOW UP when they should"): a genuinely flat-out
      // slam (vmag>=38 ≈ 91mph, near a car's top end) is past the point where it
      // merely smokes — it GUARANTEES a cook-off, overriding the rare-fire roll.
      // A mid-catastrophic ram (30..38) keeps the realistic odds (usually a
      // disabled smoker, sometimes a slow burn). Guarded so a freak engine state
      // never double-ignites. The breach above + the wreck flag dedup the carve.
      if (catastrophic && vmag >= 38 && !car._onFire && !car._exploded && !car.dead) {
        car._smoking = true; car._crashFireRolled = true;   // we're forcing it — skip the chance roll
        igniteCar(car, true);                               // slow crash-fire fuse → time to bail, then detonates
        car._burnsOut = false;                              // a top-speed ram fireball does NOT just burn out
      }
      // crater point from the PRE-impact pose (group.matrixWorld still holds it) —
      // captured before the push-back/spin below so the dent lands on the contact
      const dentX = car.pos.x + Math.sin(car.heading) * 2.2, dentZ = car.pos.z + Math.cos(car.heading) * 2.2;
      const back = Math.min(catastrophic ? 2.2 : 1.35, vmag * (catastrophic ? 0.075 : 0.05));
      car.pos.x += nwx * back; car.pos.z += nwz * back;
      // a glancing hit SPINS the car off the wall toward the surface tangent; a
      // square hit just shudders. scaled by speed so a fast clip whips it around.
      const tang = car.vx * -nwz + car.vz * nwx;     // sideways component along the wall
      const spinKick = Math.sign(tang || (Math.random() - 0.5)) * Math.min(catastrophic ? 2.0 : 1.1, vmag * (catastrophic ? 0.08 : 0.05));
      car.heading += spinKick + (Math.random() - 0.5) * (catastrophic ? 0.5 : 0.2);
      // JOLT the driver: a sharp camera punch back from the impact (weighty stop)
      if (CBZ.cam) { CBZ.cam.pitch = (CBZ.cam.pitch || 0) - Math.min(0.25, vmag * 0.012); }
      if (CBZ.shake) CBZ.shake(catastrophic ? 2.4 : (hard ? 1.3 : 0.34));
      if (CBZ.doHitstop) CBZ.doHitstop(catastrophic ? 0.16 : (hard ? 0.085 : 0.028));
      if (catastrophic && CBZ.doSlowmo) CBZ.doSlowmo(0.34);
      if (CBZ.sfx) { CBZ.sfx(hard ? "ko" : "clank"); if (hard) CBZ.sfx("punch"); }
      const ix = car.pos.x + Math.sin(car.heading) * 2.2, iz = car.pos.z + Math.cos(car.heading) * 2.2;
      crashBurst(ix, iz, vmag, hard, catastrophic, { x: -nwx, z: -nwz });   // debris sprays into the wall
      if (hard && CBZ.cityShatter) CBZ.cityShatter(ix, iz, catastrophic ? 10 : 6);
      if (CBZ.cityRankEvent) CBZ.cityRankEvent("crash", { speed: vmag, hard, catastrophic, wall: true, car });
      // the car visibly CRUMPLES (the building/post is only lightly scuffed)
      crumpleCar(car, catastrophic ? 0.78 : (hard ? 0.42 : 0.08), { x: -nwx, z: -nwz });
      // and the nose CRATERS at the contact — a 60mph wall hit stays cratered
      if (CBZ.cityCarImpact) CBZ.cityCarImpact(car, { x: dentX, y: (vehicleDims(car).height || 1.5) * 0.42, z: dentZ }, { x: -nwx, y: 0, z: -nwz }, vmag);
      // ---- STRUCTURAL COUPLING (ram-breaches-building): the WALL the car hit
      //      reacts to the slam, not just the car. A HARD hit scorches/dents the
      //      facade, bursts its panes and knocks chunks loose (the same damage
      //      escalation an explosion uses, dialled modest so it scuffs — never
      //      levels — at <=1.4 power). A CATASTROPHIC (top-speed, vmag>=30) ram
      //      ALSO punches a car-sized WALK-THROUGH BREACH so a 70mph ram opens a
      //      hole you can keep driving through — the exact ground-floor carve the
      //      RPG ground-hit uses, which self-dedups via fracture.recent() and is
      //      a harmless no-op on open air. NOT a detonation: a ram makes no
      //      fireball unless the engine later cooks off through the damage fuse.
      //      Contact point ix,iz + wall normal nwx,nwz are already derived above.
      if (hard && CBZ.cityDamageBuilding) {
        const wy = (CBZ.floorAt ? CBZ.floorAt(ix, iz) : 0) + 1.0;
        CBZ.cityDamageBuilding(ix, wy, iz, catastrophic ? 1.4 : 0.8);
      }
      if (catastrophic && CBZ.cityBreach) CBZ.cityBreach(ix, iz, 1.6);
      // Medium crashes hurt but are explicitly non-lethal. Only a truly
      // catastrophic top-speed slam is allowed to kill the driver.
      if (hard && CBZ.cityHurtPlayer) {
        // a building crash should HURT, not auto-kill — you survive most of them
        // (heavy damage), and only a genuinely extreme top-speed slam is fatal.
        const dmg = catastrophic ? 90 + (vmag - CRASH.wallCatastrophic) * 12
                                 : 16 + (vmag - CRASH.wallHard) * 8;
        CBZ.cityHurtPlayer(Math.round(dmg), car.pos.x, car.pos.z, "crashed the car", false, null, !catastrophic);
        if (P.dead) return;                  // death.js ejects + ragdolls the driver
      }
    }
    if (CBZ.city.arena) CBZ.city.arena.clampToCity(car.pos, wallRadius(car));
    car.group.position.set(car.pos.x, 0, car.pos.z);
    car.group.rotation.set(car._pitch || 0, car.heading, car._roll || 0);   // y=heading, x/z = weight-transfer lean
    if (vmag > 6) runOver(car, vmag);
    P.pos.set(car.pos.x, 0, car.pos.z);
    CBZ.playerChar.group.position.copy(P.pos);
    CBZ.playerChar.group.visible = false;   // keep the driver's body hidden every frame (FPS/view toggles kept re-showing it → head poked out the roof)
    P.speed = vmag;
    if (CBZ.cityUpdatePlayerCarVisual) CBZ.cityUpdatePlayerCarVisual(car, dt);
    if (CBZ.cam && vmag > 3) {
      const target = car.heading + Math.PI;
      CBZ.cam.yaw = CBZ.lerpAngle(CBZ.cam.yaw, target, 1 - Math.pow(0.02, dt));
    }
    // chop shop: idle a stolen/owned car in the bay to cash it out
    chopCheck(car, vmag, dt);
    // multi-stage damage: smoke → fire → explode (ticking burn under the player)
    tickDamageStage(car, dt);
  });

  // ---- SOLID car-vs-car collision + crashes (spatially-near pairs, once a frame).
  //      Cars can no longer phase through each other; a fast impact WRECKS the
  //      AI cars (spin off-rails, smoke, lose control) and dramatically shakes
  //      the screen. The player keeps the wheel but loses most of their speed. ----
  function carVel(car) {
    if (car && Number.isFinite(car.vx) && Number.isFinite(car.vz) && (Math.abs(car.vx) + Math.abs(car.vz)) > 0.01) {
      return { x: car.vx, z: car.vz };
    }
    const v = car ? car.v || 0 : 0, h = car ? car.heading || 0 : 0;
    return { x: Math.sin(h) * v, z: Math.cos(h) * v };
  }
  function setCrashVelocity(car, x, z, offRails) {
    car.vx = x; car.vz = z;
    const speed = Math.hypot(x, z);
    if (car.player) {
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      car.v = x * fx + z * fz;
    } else if (offRails) {
      car.v = speed;
      if (speed > 0.1) car.heading = Math.atan2(x, z);
    } else {
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
      car.v = Math.max(0, x * fx + z * fz);
    }
  }
  function collisionImpulse(a, b, av, bv, nx, nz, closing, hard, catastrophic) {
    const am = Math.max(0.6, a.mass || 1), bm = Math.max(0.6, b.mass || 1);
    const restitution = catastrophic ? 0.04 : (hard ? 0.1 : 0.2);
    const impulse = (1 + restitution) * closing / (1 / am + 1 / bm);
    const ax = av.x - nx * impulse / am, az = av.z - nz * impulse / am;
    const bx = bv.x + nx * impulse / bm, bz = bv.z + nz * impulse / bm;
    const deltaA = Math.hypot(ax - av.x, az - av.z);
    const deltaB = Math.hypot(bx - bv.x, bz - bv.z);
    setCrashVelocity(a, ax, az, hard);
    setCrashVelocity(b, bx, bz, hard);
    return { deltaA, deltaB, am, bm };
  }
  function wreckCar(c, speed, dir, rammer, hard, catastrophic) {
    if (c.player) {
      // The impulse owns the actual velocity change. The player keeps control,
      // but a side impact now slews the car instead of being overwritten by a
      // canned speed multiplier.
      if (!rammer && hard && CBZ.cam) CBZ.cam.pitch = (CBZ.cam.pitch || 0) - Math.min(0.18, speed * 0.008);
      return;
    }
    c.wreckT = Math.max(c.wreckT || 0, catastrophic ? 2.8 : (hard ? 1.8 : 0.72));
    // spin scales with impact + the struck side: a T-bone whips the car around,
    // a glancing tap just nudges it — heavier on the car that got rammed.
    const spinMag = (rammer ? 0.55 : 1) * Math.min(catastrophic ? 9 : 6, speed * 0.45);
    c.spin = (c.spin || 0) + (Math.random() - 0.5) * spinMag + dir * Math.min(catastrophic ? 4.5 : 2.8, speed * 0.15);
    c.pullover = 0; c.turning = false;     // abandon whatever it was doing
  }
  function carCrash(a, b, speed, nx, nz) {
    const av = carVel(a), bv = carVel(b);
    const aSpeed = Math.hypot(av.x, av.z), bSpeed = Math.hypot(bv.x, bv.z);
    const am = Math.max(0.6, a.mass || 1), bm = Math.max(0.6, b.mass || 1);
    const reducedMass = (am * bm) / (am + bm);
    const severity = speed * Math.sqrt(Math.max(0.5, reducedMass * 2));
    const hard = severity >= CRASH.carHard, catastrophic = severity >= CRASH.carCatastrophic;
    a._crashCD = hard ? 0.6 : 0.24; b._crashCD = hard ? 0.6 : 0.24;
    // The rammer is whichever vehicle contributes more velocity into the contact
    // normal. A stationary player hit from the side is no longer blamed as the rammer.
    const aInto = Math.max(0, av.x * nx + av.z * nz);
    const bInto = Math.max(0, -(bv.x * nx + bv.z * nz));
    const aRammer = aInto >= bInto;
    const imp = collisionImpulse(a, b, av, bv, nx, nz, speed, hard, catastrophic);
    wreckCar(a, severity, -1, aRammer, hard, catastrophic);
    wreckCar(b, severity, 1, !aRammer, hard, catastrophic);
    const massAvg = Math.max(0.8, Math.min(1.65, (am + bm) * 0.5));
    const heavy = (catastrophic ? 0.92 : (hard ? 0.62 : 0.26)) * massAvg;
    const light = (catastrophic ? 0.6 : (hard ? 0.34 : 0.12)) * massAvg;
    crumpleCar(a, aRammer ? light : heavy, { x: nx, z: nz });
    crumpleCar(b, aRammer ? heavy : light, { x: -nx, z: -nz });
    // panel craters at the actual contact point: each hull caves toward its
    // own centre (n points a→b), the rammed car the deeper of the two
    if (CBZ.cityCarImpact) {
      const px = (a.pos.x + b.pos.x) / 2, pz = (a.pos.z + b.pos.z) / 2;
      const py = Math.min(vehicleDims(a).height || 1.5, vehicleDims(b).height || 1.5) * 0.4;
      CBZ.cityCarImpact(a, { x: px, y: py, z: pz }, { x: -nx, y: 0, z: -nz }, severity * (aRammer ? 0.75 : 1));
      CBZ.cityCarImpact(b, { x: px, y: py, z: pz }, { x: nx, y: 0, z: nz }, severity * (aRammer ? 1 : 0.75));
    }
    // engine HP: a collision guts the motor on a SPEED-SCALED curve, the rammed
    // car taking the worst of it. A low-speed fender-bender (severity below
    // carHard) costs only a sliver per car, so two cars can trade many bumps
    // without dying; repeated/major rams build toward smoke → fire → explosion.
    // No collision instantly turns a car into a fireball — even a catastrophic
    // wreck disables it and the fire (then blast) develops over the burn fuse.
    //   below carHard : ~0.5 HP per severity-unit over the 6-unit no-damage floor
    //   hard          : ~26 + ramp over threshold
    //   catastrophic  : heavy (still routed through the fire fuse, not instant)
    const sevOver = Math.max(0, severity - 6);
    const eHeavy = catastrophic ? (58 + (severity - CRASH.carCatastrophic) * 3)
                 : hard         ? (26 + (severity - CRASH.carHard) * 2.2)
                                : sevOver * 0.5;
    const eLight = catastrophic ? (36 + (severity - CRASH.carCatastrophic) * 2)
                 : hard         ? (15 + (severity - CRASH.carHard) * 1.3)
                                : sevOver * 0.28;
    damageEngine(a, Math.min(82, (aRammer ? eLight : eHeavy) * Math.max(0.85, Math.min(1.3, bm))), false);
    damageEngine(b, Math.min(82, (aRammer ? eHeavy : eLight) * Math.max(0.85, Math.min(1.3, am))), false);
    if ((a.player || b.player)) { if (a.player) a._burnByPlayer = true; if (b.player) b._burnByPlayer = true; }
    // Occupant injury follows delta-v, the quantity people actually feel in a
    // collision. Normal bumps do nothing; a hard side/T-bone hit hurts badly.
    if (hard && CBZ.cityHurtPlayer) {
      const playerCar = a.player ? a : (b.player ? b : null);
      const deltaV = a.player ? imp.deltaA : imp.deltaB;
      if (playerCar && deltaV > 4.5) {
        const protection = Math.max(0.68, 1 - (playerCar.armor || 0) * 0.75);
        const dmg = Math.min(catastrophic ? 165 : 88, Math.round((deltaV - 4.5) * (catastrophic ? 7.2 : 4.5) * protection));
        if (dmg > 0) CBZ.cityHurtPlayer(dmg, playerCar.pos.x, playerCar.pos.z, "car crash", false, null, !catastrophic);
      }
    }
    // A small contact-position kick prevents the meshes from immediately
    // re-colliding; velocity transfer itself is handled by the impulse above.
    const kick = Math.min(catastrophic ? 1.6 : 0.9, severity * (catastrophic ? 0.05 : 0.035));
    const aMassFac = Math.max(0.5, Math.min(1.8, bm / am));   // how hard A is shoved (by B's mass)
    const bMassFac = Math.max(0.5, Math.min(1.8, am / bm));
    a.pos.x -= nx * kick * aMassFac; a.pos.z -= nz * kick * aMassFac;
    b.pos.x += nx * kick * bMassFac; b.pos.z += nz * kick * bMassFac;
    const cx = (a.pos.x + b.pos.x) / 2, cz = (a.pos.z + b.pos.z) / 2;
    const cam = CBZ.camera.position, cd2 = (cx - cam.x) * (cx - cam.x) + (cz - cam.z) * (cz - cam.z);
    if (a.player || b.player || cd2 < 75 * 75) {
      if (a.player || b.player) {
        const playerCar = a.player ? a : b;
        playerCar.lastCrashScore = Math.max(playerCar.lastCrashScore || 0, Math.round(severity * massAvg));
        if (CBZ.cityRankEvent) CBZ.cityRankEvent("crash", { speed: severity, hard, catastrophic, carA: a, carB: b });
      }
      crashBurst(cx, cz, severity, hard, catastrophic, { x: nx, z: nz });
      if (CBZ.shake) CBZ.shake(catastrophic ? 1.45 : (hard ? 0.95 : 0.26));
      if (CBZ.doHitstop) CBZ.doHitstop(catastrophic ? 0.1 : (hard ? 0.06 : 0.02));
      if (CBZ.sfx) CBZ.sfx(hard ? "ko" : "punch");
      if (hard && CBZ.cityShatter) CBZ.cityShatter(cx, cz, catastrophic ? 8 : 4.5);
    }
  }
  function collisionSupport(car, nx, nz) {
    const d = vehicleDims(car), h = car.heading || 0;
    const fx = Math.sin(h), fz = Math.cos(h), sx = Math.cos(h), sz = -Math.sin(h);
    return Math.abs(nx * fx + nz * fz) * d.length * 0.5 + Math.abs(nx * sx + nz * sz) * d.width * 0.5;
  }
  function collisionBound(car) {
    const d = vehicleDims(car);
    return Math.hypot(d.width, d.length) * 0.5;
  }
  const CAR_GRID_CELL = 9;
  const carGrid = new Map();
  function resolveCars(dt) {
    const cars = CBZ.cityCars, n = cars.length;
    carGrid.clear();
    for (let i = 0; i < n; i++) {
      const a = cars[i]; if (a.dead) continue;
      if (a._crashCD > 0) a._crashCD -= dt;
      const gx = Math.floor(a.pos.x / CAR_GRID_CELL), gz = Math.floor(a.pos.z / CAR_GRID_CELL);
      // numeric key (no per-frame string alloc; gx/gz are small at CELL=9) — packs
      // two ints collision-free for any |coord| < 1024 (offset+stride 4096 > range).
      const key = (gx + 1024) * 4096 + (gz + 1024), bucket = carGrid.get(key);
      if (bucket) bucket.push(i); else carGrid.set(key, [i]);
    }
    for (let i = 0; i < n; i++) {
      const a = cars[i]; if (a.dead) continue;
      const gx = Math.floor(a.pos.x / CAR_GRID_CELL), gz = Math.floor(a.pos.z / CAR_GRID_CELL);
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const bucket = carGrid.get(((gx + ox) + 1024) * 4096 + ((gz + oz) + 1024)); if (!bucket) continue;
        for (let bi = 0; bi < bucket.length; bi++) {
          const j = bucket[bi]; if (j <= i) continue;
          const b = cars[j]; if (b.dead) continue;
          const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
          const broadHit = collisionBound(a) + collisionBound(b);
          if (d2 > broadHit * broadHit) continue;
          const d = Math.sqrt(Math.max(1e-6, d2));
          const nx = d2 < 1e-6 ? (i & 1 ? 1 : -1) : dx / d, nz = d2 < 1e-6 ? 0 : dz / d;
          const hit = collisionSupport(a, nx, nz) + collisionSupport(b, nx, nz);
          if (d >= hit) continue;
          const overlap = hit - d;
        // SOLID separation — they cannot occupy the same space
          const am = Math.max(0.6, a.mass || 1), bm = Math.max(0.6, b.mass || 1), tm = am + bm;
          const aw = bm / tm, bw = am / tm;
          a.pos.x -= nx * overlap * aw; a.pos.z -= nz * overlap * aw;
          b.pos.x += nx * overlap * bw; b.pos.z += nz * overlap * bw;
        // closing speed along the contact normal
          const va = carVel(a), vb = carVel(b);
          const closing = (va.x - vb.x) * nx + (va.z - vb.z) * nz;
          if (closing > 2 && (a._crashCD || 0) <= 0 && (b._crashCD || 0) <= 0) carCrash(a, b, closing, nx, nz);
          else if (closing > 0.25) {
            const imp = collisionImpulse(a, b, va, vb, nx, nz, closing, false, false);
            if (imp.deltaA < 0.01 && imp.deltaB < 0.01) { a.v *= 0.98; b.v *= 0.98; }
          }
        // keep visuals (and the player's position/camera) in sync this frame
          a.group.position.set(a.pos.x, 0, a.pos.z); b.group.position.set(b.pos.x, 0, b.pos.z);
          if (a.player) { CBZ.player.pos.set(a.pos.x, 0, a.pos.z); CBZ.playerChar.group.position.copy(CBZ.player.pos); }
          if (b.player) { CBZ.player.pos.set(b.pos.x, 0, b.pos.z); CBZ.playerChar.group.position.copy(CBZ.player.pos); }
        }
      }
    }
  }
  // run after the player (order 11) and the AI traffic (order 37) have moved
  CBZ.onUpdate(37.6, function (dt) { if (g.mode === "city") resolveCars(dt); });

  function runOver(car, vmag) {
    const P = CBZ.player;
    if (!car.player && !P.dead && !P.driving && car.playerHitCD <= 0) {
      const pdx = P.pos.x - car.pos.x, pdz = P.pos.z - car.pos.z;
      if (pdx * pdx + pdz * pdz < 3.6) {
        car.playerHitCD = 0.85;
        // you get hit the SAME way you hit others: a fast car FLINGS you into a
        // ragdoll tumble (physics.js owns the airborne state); a slow one knocks
        // you down. Damage, shake and hitstop all scale hard with speed.
        if (CBZ.cityHurtPlayer) CBZ.cityHurtPlayer(Math.min(165, 12 + vmag * 5), car.pos.x, car.pos.z, "run over", false, car.npcDriver || null, vmag < 18);
        if (!P.dead && CBZ.body && CBZ.city) {
          if (vmag > 13) CBZ.body.fling(CBZ.city.playerActor, { fromX: car.pos.x, fromZ: car.pos.z, force: 6 + vmag * 0.5, up: 4 + vmag * 0.24 });
          else CBZ.body.knockdown(CBZ.city.playerActor, { fromX: car.pos.x, fromZ: car.pos.z, force: 8 + vmag * 0.4, t: 1.6 });
        }
        if (car.npcDriver && CBZ.cityNpcOffense) CBZ.cityNpcOffense(car.npcDriver, 48, "vehicular-assault");
        if (CBZ.shake) CBZ.shake(0.4 + Math.min(1.2, vmag * 0.05));
        if (CBZ.doHitstop) CBZ.doHitstop(Math.min(0.1, 0.03 + vmag * 0.002));
        car.v *= 0.7;
      }
    }
    // one-per-call latch so a car that clips SEVERAL bodies this frame still
    // fires exactly ONE hit-stop / impact voice / "catch" (never stack N).
    let juiced = false;
    for (const p of CBZ.cityPeds) {
      if (p.dead || p.inCar) continue;
      const dx = p.pos.x - car.pos.x, dz = p.pos.z - car.pos.z;
      if (dx * dx + dz * dz < 3.2) {
        if ((p._carHitUntil || 0) > (CBZ.now || 0)) continue;
        p._carHitUntil = (CBZ.now || 0) + 850;
        // Low-speed contact knocks a person over and makes them react. Only a
        // genuinely fast impact becomes a lethal run-over.
        const imp = { fromX: car.pos.x, fromZ: car.pos.z, force: 8 + vmag * 0.35, fling: 4 + vmag * 0.3 };
        if (!car.player) { imp.attacker = car.npcDriver || null; imp.byPlayer = false; }
        const lethal = vmag >= CRASH.pedLethal && !p.dead;   // a genuine kill THIS contact
        if (vmag >= CRASH.pedLethal) CBZ.cityKillPed && CBZ.cityKillPed(p, imp, "run over");
        else {
          const offender = car.player ? CBZ.city.playerActor : (car.npcDriver || null);
          p.ko = Math.max(p.ko || 0, 2.2 + vmag * 0.2);
          p.alarmed = Math.max(p.alarmed || 0, 6);
          p.fear = Math.min(10, (p.fear || 0) + 3);
          if (offender) {
            p.mem = offender;
            if ((p.aggr || 0) >= 0.58) { p.rage = offender; p.state = "fight"; }
          }
          if (CBZ.body) CBZ.body.hit(p, { fromX: car.pos.x, fromZ: car.pos.z, force: 5 + vmag * 0.45, knockdown: true });
          if (car.player) {
            CBZ.cityAlarm && CBZ.cityAlarm(p.pos.x, p.pos.z, 14, 0.8, CBZ.city.playerActor);
            // only a genuinely HARD impact is the 2★ vehicular-assault; a light
            // nudge (rolling into someone) is just 1★ reckless driving at low sev,
            // so it can't climb past the star-1 floor.
            if (vmag >= CRASH.carHard) CBZ.cityCrime && CBZ.cityCrime(28, { x: p.pos.x, z: p.pos.z, type: "vehicular-assault" });
            else CBZ.cityCrime && CBZ.cityCrime(15, { x: p.pos.x, z: p.pos.z, type: "reckless" });
          } else if (car.npcDriver && CBZ.cityNpcOffense) CBZ.cityNpcOffense(car.npcDriver, 22, "vehicular-assault");
        }
        if (CBZ.shake) CBZ.shake((car.player ? 0.2 : 0.12) + Math.min(0.7, vmag * 0.025));
        // ---- THE THUNK (CBZ.runoverJuice, once per call, clean lethal only) ----
        // Make a kill-at-speed read as WEIGHT, matching melee's land(). A car
        // that mows a whole line still thunks exactly once (the `juiced` latch).
        if (lethal && CBZ.runoverJuice && !juiced) {
          juiced = true;
          // TINY, speed-scaled, hard-capped hit-stop. Base ~0.038s so even at
          // 5 FPS it's a single near-frozen frame (loop.js drains by the clamped
          // 0.05 world dt); never above 0.05 so it can't eat an input sample.
          // doHitstop() is Math.max-merged in loop.js, so the per-call latch +
          // this cap together guarantee it can't compound across bodies/frames.
          if (CBZ.doHitstop) CBZ.doHitstop(Math.min(0.05, 0.034 + vmag * 0.0009));
          // BASS-HEAVY impact voice, speed-scaled, camera-distance attenuated so
          // a far kill is quieter (dist convention used elsewhere in this file).
          // `ko` is the layered heavy-punch + low-pitched thud_real (the bass);
          // a faster impact layers `clank` (metal-crunch) on top for the crunch.
          if (CBZ.sfx) {
            const cm = CBZ.camera && CBZ.camera.position;
            const dist = cm ? Math.hypot(car.pos.x - cm.x, car.pos.z - cm.z) : 0;
            const hard = vmag >= CRASH.carHard;            // a normal-speed-or-faster kill
            const vol = Math.min(1, 0.62 + vmag * 0.012);  // louder the faster you hit
            // pitch DOWN slightly with speed → more bass/body on a heavy impact
            const pitch = Math.max(0.84, 1.02 - vmag * 0.006);
            CBZ.sfx("ko", { dist: dist, volume: vol, pitch: pitch });
            if (hard) CBZ.sfx("clank", { dist: dist, volume: Math.min(0.9, vol * 0.8), pitch: pitch * 1.04 });
          }
        }
        // one-frame car "catch": a lethal kill bleeds a touch more speed when
        // juiced so the car visibly hooks on the body (today: *=0.9). Floored at
        // *=0.82 so a determined player still plows THROUGH a crowd — we never
        // strand the car, never zero v (that would change driving logic).
        const lethalBleed = (CBZ.runoverJuice && car.player) ? 0.84 : 0.9;
        car.v *= vmag >= CRASH.pedLethal ? lethalBleed : 0.72;
      }
    }
    // mow down the ambient instanced crowd (the far NPCs) — player car only so
    // the kill is attributed to you, not to NPC drivers. Fast impacts are lethal.
    if (car.player && vmag >= CRASH.pedLethal && CBZ.cityCrowdCircleKill) {
      const n = CBZ.cityCrowdCircleKill(car.pos.x, car.pos.z, 2.0, { byCar: true, fromX: car.pos.x, fromZ: car.pos.z });
      if (n > 0 && CBZ.shake) CBZ.shake(0.25 + Math.min(0.5, vmag * 0.02));
      // same THUNK for plowing the ambient crowd (shares the per-call `juiced`
      // latch so a kill that already thunked above doesn't double-fire). Note:
      // cityCrowdCircleKill already plays a "ko" voice (crowd.js) — we only add
      // the missing hit-stop here, never a second bass voice, to avoid stacking.
      if (n > 0 && CBZ.runoverJuice && !juiced) {
        juiced = true;
        if (CBZ.doHitstop) CBZ.doHitstop(Math.min(0.05, 0.034 + vmag * 0.0009));
      }
    }
    for (const c of CBZ.cityCops) {
      if (c.dead) continue;
      const dx = c.pos.x - car.pos.x, dz = c.pos.z - car.pos.z;
      if (dx * dx + dz * dz < 3.2) {
        if ((c._carHitUntil || 0) > (CBZ.now || 0)) continue;
        c._carHitUntil = (CBZ.now || 0) + 850;
        if (vmag >= CRASH.pedLethal) CBZ.cityHurtCop && CBZ.cityHurtCop(c, 90, { fromX: car.pos.x, fromZ: car.pos.z, force: 8 + vmag * 0.3, fling: 3 + vmag * 0.2, attacker: car.player ? null : (car.npcDriver || null), byPlayer: !!car.player });
        else if (CBZ.body) CBZ.body.hit(c, { fromX: car.pos.x, fromZ: car.pos.z, force: 5 + vmag * 0.4, knockdown: true });
        car.v *= 0.82;
      }
    }
  }

  function advanceRoadRage(car, dt, arena) {
    const target = car.roadRageTarget;
    if (!target || target.dead || car.roadRageT <= 0) {
      car.roadRageTarget = null; car.roadRageT = 0;
      return false;
    }
    car.roadRageT -= dt;
    const dx = target.pos.x - car.pos.x, dz = target.pos.z - car.pos.z;
    const desired = Math.atan2(dx, dz);
    car.heading = CBZ.lerpAngle(car.heading, desired, 1 - Math.pow(0.0008, dt));
    const top = Math.max(13, car.baseV || 13);
    car.v += Math.min(18 * dt, top - car.v);
    car.v = Math.max(0, car.v);
    car.pos.x += Math.sin(car.heading) * car.v * dt;
    car.pos.z += Math.cos(car.heading) * car.v * dt;
    collideVehicle(car);
    if (arena) arena.clampToCity(car.pos, wallRadius(car));
    car.group.position.set(car.pos.x, 0, car.pos.z);
    car.group.rotation.y = car.heading;
    if (car.npcDriver && car.npcDriver.pos) car.npcDriver.pos.set(car.pos.x, 0, car.pos.z);
    if (car.v > 6) runOver(car, car.v);
    setBrake(car, false);                 // a rammer is flat on the throttle
    const cdx = car.pos.x - CBZ.camera.position.x, cdz = car.pos.z - CBZ.camera.position.z;
    car.group.visible = (cdx * cdx + cdz * cdz) < 150 * 150;
    return true;
  }

  function chopCheck(car, vmag, dt) {
    const lot = CBZ.city.arena.chopShop; if (!lot || !lot.building.chopZone) return;
    const cz = lot.building.chopZone;
    const inZone = Math.hypot(car.pos.x - cz.x, car.pos.z - cz.z) < cz.r;
    if (inZone && vmag < 1.5 && (car.stolen || car.owned)) {
      car.dwell = (car.dwell || 0) + dt;
      if (car.dwell > 1.2) { sellToChop(car); }
      else if (CBZ.city) CBZ.city.note("🔧 Hold still to chop this " + (car.model ? car.model.name : "car") + "…", 0.5);
    } else car.dwell = 0;
  }
  function sellToChop(car) {
    const E = (CBZ.CITY && CBZ.CITY.econ) || {};
    const base = car.model ? car.model.value : 3000;
    const frac = car.owned ? (E.chopOwned || 0.85) : (E.chopStolen || 0.42);
    const cond = vehicleCondition(car);
    const pay = Math.round(base * frac * cond.valueMul);
    CBZ.cityExitVehicle();
    if (car.group && car.group.parent) car.group.parent.remove(car.group);
    const idx = CBZ.cityCars.indexOf(car); if (idx >= 0) CBZ.cityCars.splice(idx, 1);
    CBZ.city.addCash(pay); CBZ.city.addRespect(2);
    CBZ.city.big("CHOPPED " + (car.model ? car.model.name : "car") + " + $" + pay.toLocaleString());
    CBZ.city.note("Condition: " + cond.label + " · payout adjusted", 1.5);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (!car.owned && anyWitness(CBZ.player.pos.x, CBZ.player.pos.z, 26)) CBZ.cityCrime && CBZ.cityCrime((CBZ.CITY.econ && CBZ.CITY.econ.chopHeat) || 14, { type: "chop" });
  }

  // ---- ambient traffic AI (order 37) ----
  // FAR-CAR LOD: full traffic AI is costly per car — world-collision raycasts
  // against ~1000 colliders AND a scan of every ped to brake for. A car BEYOND
  // the render-visibility cull (the player literally can't see it) doesn't need
  // that every frame, so we step it on a 1-in-3 stride with accumulated dt;
  // its straight-line motion stays continuous and it snaps back to full-rate
  // simulation the instant it matters (turning, wrecked, wanted, fleeing, or
  // back on screen). This is the single biggest CPU saving in the traffic loop.
  let _vframe = 0, _vslice = 0;
  const FARCAR_D2 = 150 * 150;     // == the group-visibility cull distance below

  // ---- CAR-AHEAD broad phase (the O(n²) killer) -----------------------------
  // carAhead() below is the traffic loop's hot path: it scans the ENTIRE car
  // list once (sometimes twice) PER car, PER frame, to find the nearest vehicle
  // in that driver's path. With ~66 ambient cars + parked/cop/player cars that's
  // a few thousand pair tests every frame on the average — and a single-frame
  // SPIKE when a light releases a cluster and every car simultaneously runs at
  // full rate (the far-car LOD stride below stops hiding the cost). Mirroring
  // peds.js / crowd.js, we rebuild ONE spatial hash of the cars per frame
  // (CBZ.makeGrid, alloc-free after warm-up) and let carAhead inspect only the
  // cells its speed-scaled lookahead actually reaches. The cars near a clustered
  // light are genuinely close (the grid can't conjure them apart), but every car
  // on a DIFFERENT block — the bulk of the list — is skipped, which is what
  // turns the all-pairs spike back into a local scan.
  //
  // CORRECTNESS: the grid only chooses the CANDIDATE set (bucketed from this
  // frame's start positions). The gap / along / lateral math in carAhead still
  // reads each candidate's LIVE o.pos exactly as the old full scan did, so the
  // steering decision is byte-identical. A car moves <~0.6m in one 60fps frame —
  // far less than the cell-quantised padding of the query box below — so a car
  // that should be a candidate can never have slipped out of the queried cells.
  // Reverse the flag and carAhead falls straight back to the original full scan.
  const CARAHEAD_GRID = true;      // default ON (proven peds/crowd pattern; candidate-complete)
  const CAR_AHEAD_CELL = 12;       // cell ≈ a couple of car lengths; query pads to cover `look`
  let _carGrid = null;
  function _carVec(c) { return c.pos; }
  function rebuildCarGrid() {
    if (!CARAHEAD_GRID) return;
    if (!_carGrid && CBZ.makeGrid) _carGrid = CBZ.makeGrid(CAR_AHEAD_CELL);
    if (!_carGrid) return;
    // bucket EVERY car carAhead would otherwise scan — including the player's
    // car and parked/stolen/cop cars (carAhead treats them all as obstacles).
    // Dead cars are skipped inside carAhead, so bucketing them is harmless, but
    // we drop them here too so the cells stay small.
    _carGrid.rebuild(CBZ.cityCars, _carVec);
  }

  CBZ.onUpdate(37, function (dt) {
    if (g.mode !== "city") return;
    const A = CBZ.city.arena; if (!A) return;
    const baseDt = dt;
    const camx = CBZ.camera.position.x, camz = CBZ.camera.position.z;
    _vframe++;
    rebuildCarGrid();   // ONE rebuild per frame; carAhead queries it per car
    for (const c of CBZ.cityCars) {
      dt = baseDt;     // reset each car (a strided far car overrides this below)
      if (c.player || c.dead || !c.ai || !c.road) continue;
      // off-screen, non-critical cars: skip 2 of every 3 frames, banking dt so
      // they still cover the same ground when they do tick.
      const _cdx = c.pos.x - camx, _cdz = c.pos.z - camz;
      // a DEAD driver at the wheel must be handled EVERY frame (eject + wreck), or
      // the far-car LOD skip below ghost-drives the corpse until its slice comes up.
      const _critical = c.turning || c.wreckT > 0 || (c.npcWanted | 0) >= 1 || c.pullover || c.roadRageTarget || c.abandoned || (c.npcDriver && c.npcDriver.dead);
      if (!_critical && (_cdx * _cdx + _cdz * _cdz) > FARCAR_D2) {
        if (c._vsl == null) c._vsl = (_vslice++ & 3);
        c._acc = (c._acc || 0) + baseDt;
        if ((_vframe + c._vsl) % 3 !== 0) continue;     // skipped this frame
        dt = c._acc; c._acc = 0;                         // catch-up step
      }
      // DRIVER SHOT DEAD AT THE WHEEL (cops / gunfire): drop the body out and let
      // the now-driverless car careen to a stop — no more ghost-driving a corpse.
      if (c.npcDriver && c.npcDriver.dead) {
        ejectNpcDriver(c);
        c.abandoned = true; c.npcWanted = 0; c.stolen = false; c.roadRageTarget = null; c.roadRageT = 0; c.pullover = 0;
        c.wreckT = Math.max(c.wreckT || 0, 1.1);
      }
      // WRECKED (just crashed): spin out off-rails and coast to a stop, then
      // recover and drive on — skips all lane-keeping so the crash actually reads.
      if (c.wreckT > 0) {
        setBrake(c, false);               // nobody's on the pedal mid-spin
        c.wreckT -= dt;
        c.v *= Math.pow(0.04, dt);
        c.spin = (c.spin || 0) * Math.pow(0.25, dt);
        c.heading += c.spin * dt;
        c.pos.x += Math.sin(c.heading) * c.v * dt;
        c.pos.z += Math.cos(c.heading) * c.v * dt;
        const pushed = collideVehicle(c);
        if (A.clampToCity) A.clampToCity(c.pos, wallRadius(c));
        // slammed a building / lamppost mid-spin: crumple the car (the structure
        // only sheds some glass), and a fast hit kills whoever's driving.
        if (pushed > 0.05 && c.v > 11) {
          const catastrophic = c.v >= CRASH.npcDriverLethal, hard = c.v >= CRASH.wallHard;
          crumpleCar(c, catastrophic ? 0.7 : (hard ? 0.42 : 0.16), { x: -Math.sin(c.heading), z: -Math.cos(c.heading) });
          if (CBZ.cityCarImpact) {
            const fx = Math.sin(c.heading), fz = Math.cos(c.heading), vd = vehicleDims(c);
            CBZ.cityCarImpact(c, { x: c.pos.x + fx * vd.length * 0.45, y: (vd.height || 1.5) * 0.4, z: c.pos.z + fz * vd.length * 0.45 }, { x: -fx, y: 0, z: -fz }, c.v);
          }
          // speed-scaled (NHTSA/IIHS ladder): a slow scrape barely dents the
          // motor, only a fast slam disables it — and never an instant fireball
          // (damageEngine routes the crash through the burn fuse).
          damageEngine(c, catastrophic ? (50 + (c.v - CRASH.npcDriverLethal) * 3)
                          : hard ? (24 + (c.v - CRASH.wallHard) * 2)
                          : Math.max(0, (c.v - 5) * 0.6), false);
          crashBurst(c.pos.x, c.pos.z, c.v, hard, catastrophic);
          if (hard && CBZ.cityShatter) CBZ.cityShatter(c.pos.x, c.pos.z, catastrophic ? 8 : 4.5);
          const cm = CBZ.camera.position;
          if (((c.pos.x - cm.x) * (c.pos.x - cm.x) + (c.pos.z - cm.z) * (c.pos.z - cm.z)) < 80 * 80) {
            if (CBZ.shake) CBZ.shake(0.12 + Math.min(0.6, c.v * 0.03));
            if (CBZ.sfx) CBZ.sfx(c.v > 16 ? "ko" : "punch");
          }
          if (catastrophic && c.npcDriver && !c.abandoned) killNpcDriverInCar(c);
          c.v *= catastrophic ? 0.08 : (hard ? 0.18 : 0.45);
        }
        c.group.position.set(c.pos.x, 0, c.pos.z);
        c.group.rotation.y = c.heading;
        if (c.npcDriver && c.npcDriver.pos) c.npcDriver.pos.set(c.pos.x, 0, c.pos.z);
        const wdx = c.pos.x - CBZ.camera.position.x, wdz = c.pos.z - CBZ.camera.position.z;
        c.group.visible = (wdx * wdx + wdz * wdz) < 150 * 150;
        if (c.wreckT <= 0 && c.abandoned) c.ai = false;   // settle as an abandoned wreck
        continue;
      }
      if (c.playerHitCD > 0) c.playerHitCD = Math.max(0, c.playerHitCD - dt);
      if (c.npcDriver && c.roadRageTarget && advanceRoadRage(c, dt, A)) continue;
      if (c.ranRedCD > 0) c.ranRedCD -= dt;
      if (c.turnCD > 0) c.turnCD -= dt;

      // ---- mid-turn: arc smoothly through the intersection (no snap) ----
      if (c.turning) {
        let tv = Math.min(c.baseV, c.reckless ? 11 : 8);   // ease off to corner
        // yield mid-arc: don't sweep the turn into a car crossing the box
        const blk = carAhead(c);
        if (blk && blk.gap < 5) tv = Math.min(tv, Math.max(0.8, blk.v * 0.5));
        c.v += Math.max(-20 * dt, Math.min(12 * dt, tv - c.v));
        c.v = Math.max(0.8, c.v);
        advanceTurn(c, dt);
        c.group.position.set(c.pos.x, 0, c.pos.z);
        c.group.rotation.y = c.heading;
        if (c.npcDriver && c.npcDriver.pos) c.npcDriver.pos.set(c.pos.x, 0, c.pos.z);
        if (c.v > 9 && (c.reckless || c.pullover === 4)) runOver(c, c.v);
        const tdx = c.pos.x - CBZ.camera.position.x, tdz = c.pos.z - CBZ.camera.position.z;
        c.group.visible = (tdx * tdx + tdz * tdz) < 150 * 150;
        setBrake(c, c.group.visible && tv < c.v - 0.4);   // easing off into the corner
        continue;
      }
      const r = c.road;

      // ---- desired speed: cruise, modulated by lights, following, stops ----
      let target = c.baseV;

      // red-light stop (calm drivers; the reckless gamble on it). HIGHWAY +
      // arterial roads (the new mini-city/island network) have NO city-grid
      // intersection, so nearestIntersection can return null — treat that as
      // "no signal ahead" (open highway) instead of dereferencing undefined.
      const it = A.nearestIntersection(c.pos.x, c.pos.z);
      const distToInt = !it ? 1e9 : (r.vertical ? (it.z - c.pos.z) * c.dirSign : (it.x - c.pos.x) * c.dirSign);
      const red = CBZ.cityIsRed(r.vertical);
      const stopGap = TR().stopGap || 6.5;
      const redLookahead = stopGap + 5 + Math.min(11, c.v * 0.75);
      // calm drivers ANTICIPATE the red — ease to a smooth stop at the line from
      // further out (reads clearly as obeying the signal). Reckless ones gamble.
      if (red && distToInt > 1.2 && distToInt < redLookahead) {
        if (!c.reckless || c.driver.aggr < 0.8) target = Math.min(target, Math.max(0, (distToInt - 1.6) * 1.25));
      }

      // Car-following uses bumper gap + speed headway. Fixed centre-to-centre
      // spacing made long vans overlap and made fast cautious drivers brake late.
      const ahead = carAhead(c);
      if (ahead) {
        const gap = ahead.gap;
        const staticGap = Math.max(2.4, (TR().follow || 8) * 0.45);
        const headway = c.reckless ? 0.3 : (c.driver.aggr < 0.25 ? 0.9 : 0.62);
        const follow = staticGap + c.v * headway;
        if (gap < follow) target = Math.min(target, Math.max(0, ahead.v * (gap < follow * 0.4 ? 0.3 : 0.85)));
      }

      // a signalled pull-over: comply (stop) unless fleeing
      if (c.pullover === 1) { if (c.driver.aggr >= 0.6 || c.npcWanted >= 1) { startFlee(c); } else { c.pullover = 2; } }
      if (c.pullover === 2 || c.pullover === 3) {
        target = 0;
        const enf = copNear(c.pos.x, c.pos.z, 7);
        if (enf) { c.pullover = 3; c.stopT += dt; if (c.stopT > 3) { c.pullover = 0; c.stopT = 0; CBZ.city && CBZ.city.note("🎫 " + (c.model ? c.model.name : "Driver") + " ticketed", 0.8); } }
        else { c.stopT += dt; if (c.stopT > 6) { c.pullover = 0; c.stopT = 0; } }   // no cop showed — drive on
      }
      if (c.pullover === 4) {
        target = c.baseV * 1.15;                                    // fleeing flat-out
        c.fleeT -= dt;
        if (c.fleeT <= 0) { c.pullover = 0; c.npcWanted = 0; c.stopT = 0; }   // lost them
      }

      // PEDESTRIANS: a normal driver brakes for someone in their lane ahead; a
      // RECKLESS one (the aggression stat maxed out) keeps their foot down and
      // mows them over — the personality spectrum's extreme is a maniac.
      if ((!c.reckless || c.driver.aggr < 0.8) && c.pullover !== 4) {
        const fwx = r.vertical ? 0 : c.dirSign, fwz = r.vertical ? c.dirSign : 0;
        const pedLookahead = Math.min(19, 7 + c.v * 0.7);
        const dangerGap = 2.5 + c.v * 0.22;
        let brake = 0;
        for (let i = 0; i < CBZ.cityPeds.length && brake < 1; i++) {
          const p = CBZ.cityPeds[i]; if (p.dead || p.inCar) continue;
          const dx = p.pos.x - c.pos.x, dz = p.pos.z - c.pos.z, ah = dx * fwx + dz * fwz;
          if (ah > 0.5 && ah < pedLookahead && Math.abs(dx * -fwz + dz * fwx) < 2.0) brake = ah < dangerGap ? 1 : Math.max(brake, 0.5);
        }
        if (brake < 1 && !CBZ.player.driving && !CBZ.player.dead) {
          const dx = CBZ.player.pos.x - c.pos.x, dz = CBZ.player.pos.z - c.pos.z, ah = dx * fwx + dz * fwz;
          if (ah > 0.5 && ah < pedLookahead && Math.abs(dx * -fwz + dz * fwx) < 2.0) brake = ah < dangerGap ? 1 : Math.max(brake, 0.5);
        }
        if (brake >= 1) target = 0; else if (brake > 0) target = Math.min(target, c.v * 0.3);
      }

      // approach the target speed (real city pace: pulls away from a green
      // briskly, brakes hard when it must)
      const accel = (target > c.v ? 12 : 22) * (c.reckless ? 1.3 : 1);
      c.v += Math.max(-accel * dt, Math.min(accel * dt, target - c.v));
      c.v = Math.max(0, c.v);

      // ---- advance along the road ----
      const moveAxisZ = r.vertical;
      if (moveAxisZ) c.pos.z += c.dirSign * c.v * dt; else c.pos.x += c.dirSign * c.v * dt;

      // lane-keeping: EASE toward the lane line instead of pinning to it, so a
      // lane flip (overtake, U-turn, post-crash recovery) reads as a real
      // steered swerve, not a 4-metre sideways teleport. Reckless drivers WEAVE
      // (drunk/aggressive sway) within the lane so they read as bad drivers.
      const swayAmp = c.reckless ? 0.85 : 0;
      let phaseRate = 0;
      if (swayAmp) { phaseRate = (1.6 + (c.driver.aggr - 0.6) * 1.4); c.swayPhase = (c.swayPhase || rng() * 6) + dt * phaseRate; }
      const sway = swayAmp ? Math.sin(c.swayPhase) * swayAmp : 0;
      const latNow = moveAxisZ ? c.pos.x - r.x : c.pos.z - r.z;
      // KEEP RIGHT as the baseline (lane-recover-right): a CALM, non-deviating
      // car whose lane offset somehow ended up on the WRONG side of the centre-
      // line (sign of c.lane ≠ sign of c.dirSign — e.g. a botched turn/U-turn
      // restore left it crossed over) is snapped back onto its proper right-hand
      // lane. We do NOT touch a car that is deliberately deviating — reckless
      // weavers, an active road-rage pass (_rageT, including the reckless
      // oncoming chicken-pass), a car mid-turn, or one pulling over — those OWN
      // their lane this frame. WHY: right-hand driving is the law of the road;
      // recklessness is the deviation ON TOP, not the default.
      if (!c.reckless && (c._rageT || 0) <= 0 && !c.turning && !c.pullover && !c.roadRageTarget) {
        const want = laneOffset(c.dirSign, c.laneIdx != null ? c.laneIdx : 0);
        if (c.lane * want < 0 || Math.abs(c.lane) < 0.2) c.lane = want;   // crossed over (or zeroed) → back to the right
      }
      const latWant = c.lane + sway;
      // faster car corrects faster. A calm (non-weaving) car corrects MORE
      // briskly so a recovered/crossed lane is reclaimed promptly instead of
      // drifting; reckless cars keep the gentler rate so their weave still reads.
      const latRate = c.reckless ? (1.6 + Math.abs(c.v) * 0.24) : (2.2 + Math.abs(c.v) * 0.3);
      const lat = latNow + Math.max(-latRate * dt, Math.min(latRate * dt, latWant - latNow));
      if (moveAxisZ) c.pos.x = r.x + lat; else c.pos.z = r.z + lat;

      // heading follows the ACTUAL motion (forward + lateral correction), so the
      // nose visibly steers through lane changes and weaves instead of crabbing
      const dlat = dt > 0.0001 ? (lat - latNow) / dt : 0;
      const dalong = c.dirSign * Math.max(2, c.v);
      c.heading = moveAxisZ ? Math.atan2(dlat, dalong) : Math.atan2(dalong, dlat);

      // crossing the intersection: ran-a-red check + ONE committed route choice
      // per box (the old per-frame coin-flip re-rolled every frame a car sat in
      // the intersection — most cars turned at almost every corner, so traffic
      // read as aimless wandering instead of people going somewhere).
      const insideInt = it != null && Math.abs(c.pos.x - it.x) < A.ROAD / 2 + 0.5 && Math.abs(c.pos.z - it.z) < A.ROAD / 2 + 0.5;
      if (insideInt && red && c.ranRedCD <= 0 && c.v > 4) {
        c.ranRedCD = 3; ranRed(c);
      }
      if (insideInt && !c._intActive) {
        c._intActive = true;
        if (c.v > 1 && (c._mustTurn || (c.turnCD <= 0 && rng() < 0.38))) {
          beginTurn(c, it, A);
          if (c.turning) c._mustTurn = false;
        }
      } else if (!insideInt && c._intActive) c._intActive = false;

      // approaching the end of the road: commit to turning off at the next
      // intersection; if there is none left, U-TURN at the dead end (swing into
      // the opposite lane and head back) — never teleport-wrap across the map.
      const lim = r.len / 2 - 2;
      const along = moveAxisZ ? (c.pos.z - r.z) * c.dirSign : (c.pos.x - r.x) * c.dirSign;
      if (lim - along < 26) c._mustTurn = true;
      if (along > lim) {
        c.dirSign *= -1;
        c.lane = -c.lane;                       // back onto the right-hand side
        c.heading = moveAxisZ ? (c.dirSign > 0 ? 0 : Math.PI) : (c.dirSign > 0 ? Math.PI / 2 : -Math.PI / 2);
        c.v = Math.min(c.v, 4);                 // a U-turn is taken slow
        c._mustTurn = false;
      }

      // fleeing suspect caught: a cop right on it ends the chase
      if (c.pullover === 4) {
        const cop = copNear(c.pos.x, c.pos.z, 3.2);
        if (cop) busted(c);
      }

      c.group.position.set(c.pos.x, 0, c.pos.z);
      c.group.rotation.y = c.heading;
      // keep a carjacker's body riding with the car so cops chase the right spot
      if (c.npcDriver && c.npcDriver.pos) c.npcDriver.pos.set(c.pos.x, 0, c.pos.z);
      // any moving car hits whoever's in front of it — calm drivers braked
      // above so they rarely connect; reckless ones plow straight through.
      if (c.v > 5) runOver(c, c.v);
      // simple distance cull: cars far from the camera stop drawing
      const cdx = c.pos.x - CBZ.camera.position.x, cdz = c.pos.z - CBZ.camera.position.z;
      c.group.visible = (cdx * cdx + cdz * cdz) < 150 * 150;
      // brake lights flare while the driver is shedding speed (red / queue /
      // ped ahead) or held stopped — only swapped for cars you can see.
      setBrake(c, c.group.visible && (target < c.v - 0.6 || (c.v < 0.45 && target < 0.6)));
    }
  });

  // nearest car directly ahead of `c` — scanned in c's OWN heading frame, so it
  // sees EVERYTHING in its path: the car it's following, cross traffic sweeping
  // the intersection, a car mid-turn, the player's dumped getaway car. The old
  // same-road-only check made drivers blind to anything not in their exact lane
  // record — they'd plow into crossing traffic and phase past parked obstacles.
  // carAhead's running best, shared by the grid scan and the full-scan fallback
  // so BOTH paths run byte-identical per-candidate math. _caTest(c,o,...) folds
  // one candidate `o` into the best-so-far and returns the new bumper gap.
  let _caBest = null, _caBg = 1e9, _caAlong = 0;
  function _caConsider(c, o, fx, fz, myHalf, look) {
    if (o === c || o.dead) return;
    const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z;   // LIVE pos (same as old full scan)
    const along = dx * fx + dz * fz;
    if (along <= 0 || along > look) return;
    const lat = Math.abs(dx * fz - dz * fx);
    if (lat > 2.3) return;
    const bumperGap = along - myHalf - vehicleDims(o).length * 0.5;
    if (bumperGap < _caBg) { _caBg = bumperGap; _caBest = o; _caAlong = along; }
  }
  function carAhead(c) {
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    const myHalf = vehicleDims(c).length * 0.5;
    const look = 8 + Math.abs(c.v) * 1.1;          // speed-scaled lookahead
    _caBest = null; _caBg = 1e9; _caAlong = 0;
    if (CARAHEAD_GRID && _carGrid) {
      // Visit only the cells the lookahead box can reach. Padding by `look` on
      // every side (floor/ceil over the radius — the standard variable-radius
      // hash query, same shape as CBZ.queryCollidersNear) guarantees we never
      // miss a candidate the old full scan would have found. A car only LOOKS
      // forward (along>0) but is bucketed by its centre, so a long obstacle
      // straddling a cell boundary just behind us must still be reachable — the
      // symmetric ±look box covers that with margin to spare.
      const gx0 = _carGrid.cellIndex(c.pos.x - look), gx1 = _carGrid.cellIndex(c.pos.x + look);
      const gz0 = _carGrid.cellIndex(c.pos.z - look), gz1 = _carGrid.cellIndex(c.pos.z + look);
      for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
        const cell = _carGrid.bucket(gx, gz); if (!cell) continue;
        for (let i = 0; i < cell.length; i++) _caConsider(c, cell[i], fx, fz, myHalf, look);
      }
    } else {
      // fallback (flag OFF / grid unavailable): the original whole-list scan.
      const cars = CBZ.cityCars;
      for (let i = 0; i < cars.length; i++) _caConsider(c, cars[i], fx, fz, myHalf, look);
    }
    const best = _caBest;
    if (!best) return null;
    // how fast the obstacle is moving AWAY along our heading (crossing traffic
    // and oncoming cars project to ~0 → we brake instead of matching "speed")
    const ov = carVel(best);
    return { v: Math.max(0, ov.x * fx + ov.z * fz), gap: _caBg, car: best, along: _caAlong };
  }

  // set up a smooth quarter-arc onto the perpendicular road. The arc is a
  // quadratic Bézier from the car's current lane position, through the corner
  // where the two lane centre-lines meet, out onto the new lane — so the car
  // sweeps the turn instead of teleporting + snapping its heading.
  function beginTurn(c, it, A) {
    const wantVertical = !c.vertical;
    const road = findRoad(A, wantVertical, wantVertical ? it.x : it.z);
    if (!road) return;
    let newDir = rng() < 0.5 ? 1 : -1;
    // don't turn INTO a dead end: if this direction runs out of road in a couple
    // of car lengths, take the other one (real drivers turn toward the city,
    // not the wall — and it kills the U-turn-right-after-turning read).
    const intAlong = wantVertical ? it.z - road.z : it.x - road.x;
    if (road.len / 2 - intAlong * newDir < 30) newDir = -newDir;
    // keep the car's lane INDEX through the turn → its offset on the new road.
    const idx = c.laneIdx != null ? c.laneIdx : 0;
    const newLane = laneOffset(newDir, idx);
    const lead = A.ROAD / 2 + 1.2;

    // P0: where we are now, snapped onto the current lane's lateral line
    const P0 = c.vertical ? { x: c.road.x + c.lane, z: c.pos.z }
                          : { x: c.pos.x, z: c.road.z + c.lane };
    // P2: out onto the new lane, just past the intersection
    const P2 = wantVertical ? { x: road.x + newLane, z: it.z + newDir * lead }
                            : { x: it.x + newDir * lead, z: road.z + newLane };
    // P1: the corner — intersection of the old lane line and the new lane line
    const P1 = c.vertical ? { x: c.road.x + c.lane, z: road.z + newLane }
                          : { x: road.x + newLane, z: c.road.z + c.lane };

    const len = Math.hypot(P1.x - P0.x, P1.z - P0.z) + Math.hypot(P2.x - P1.x, P2.z - P1.z);
    const endH = wantVertical ? (newDir > 0 ? 0 : Math.PI) : (newDir > 0 ? Math.PI / 2 : -Math.PI / 2);
    c.turning = { P0, P1, P2, len, t: 0, road, vertical: wantVertical, dirSign: newDir, lane: newLane, endH };
    c.turnCD = 3 + rng() * 3;
  }

  // advance the in-progress turn arc by this frame's distance
  function advanceTurn(c, dt) {
    const T = c.turning;
    T.t += (c.v * dt) / Math.max(0.5, T.len);
    if (T.t >= 1) {                                   // arrived — commit to the new road
      c.pos.x = T.P2.x; c.pos.z = T.P2.z;
      c.road = T.road; c.vertical = T.vertical; c.dirSign = T.dirSign; c.lane = T.lane;
      c.heading = T.endH; c.turning = null;
      return;
    }
    const t = T.t, u = 1 - t;
    c.pos.x = u * u * T.P0.x + 2 * u * t * T.P1.x + t * t * T.P2.x;
    c.pos.z = u * u * T.P0.z + 2 * u * t * T.P1.z + t * t * T.P2.z;
    const dx = 2 * u * (T.P1.x - T.P0.x) + 2 * t * (T.P2.x - T.P1.x);
    const dz = 2 * u * (T.P1.z - T.P0.z) + 2 * t * (T.P2.z - T.P1.z);
    c.heading = Math.atan2(dx, dz);                   // nose follows the arc tangent
  }
  function findRoad(A, vertical, coord) {
    let best = null, bd = 9;
    for (const r of A.roads) { if (!!r.vertical !== !!vertical) continue; const v = vertical ? r.x : r.z; const d = Math.abs(v - coord); if (d < bd) { bd = d; best = r; } }
    return best;
  }

  // a car ran a red — a violation; a nearby cop starts a stop
  function ranRed(c) {
    c.npcViolation = (c.npcViolation || 0) + 1;
    const cop = copNear(c.pos.x, c.pos.z, 30);
    if (cop) {
      if (c.driver.aggr >= 0.6) { startFlee(c); }
      else {
        c.pullover = 1;
        // only surface this ambient line when it's actually near the player AND
        // not more than once every several seconds (complements the feed cooldown).
        if (nearCam(c, 60) && (CBZ.now || 0) - _trafficStopNoteT > 6000) {
          _trafficStopNoteT = CBZ.now || 0;
          CBZ.city && CBZ.city.note("🚓 Traffic stop nearby", 0.8);
        }
      }
    }
  }
  function startFlee(c) {
    if (c.pullover === 4) return;
    c.pullover = 4; c.npcWanted = Math.max(1, c.npcWanted); c.fleeT = 12 + rng() * 6;
    CBZ.city && CBZ.city.note("🚨 " + (c.model ? c.model.name : "A driver") + " is fleeing the police!", 1.2);
    // register the fleeing driver as an NPC offender the cops will chase
    if (CBZ.cityRegisterCarSuspect) CBZ.cityRegisterCarSuspect(c);
  }
  function busted(c) {
    c.pullover = 0; c.npcWanted = 0; c.v = 0; c.baseV = Math.max(2, c.baseV * 0.5); c.reckless = false; c.driver.aggr = 0.2;
    if (c.npcDriver) { const ped = c.npcDriver; ejectNpcDriver(c); if (ped && CBZ.cityNpcArrest) CBZ.cityNpcArrest(ped); }
  }
  CBZ.cityVehiclesReset = function () {
    npcDrivers = 0;
    if (CBZ.cityCarDeformReset) CBZ.cityCarDeformReset();   // pristine fleet on a fresh run
    if (CBZ.carAudio) CBZ.carAudio.stop();   // a fresh run never inherits an orphaned motor
    // wipe the rubber: a new run starts on clean asphalt (zeroed quads are degenerate = invisible)
    if (skidPosArr) { skidPosArr.fill(0); skidRing = 0; if (skidMesh) skidMesh.geometry.attributes.position.needsUpdate = true; }
    // retire any live smoke/flame sprites to the pool so a reset starts clean
    for (let i = _vparts.length - 1; i >= 0; i--) { _vparts[i].s.visible = false; _vpool.push(_vparts[i].s); }
    _vparts.length = 0;
  };
  // let police flag a car for a stop
  CBZ.cityCarPullover = function (c) { if (c && !c.player && c.pullover === 0) c.pullover = 1; };
})();
