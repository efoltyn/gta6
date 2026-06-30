/* ============================================================
   city/race_livery.js — PAINT ANY CAR INTO A RACE CAR.

   WHY: the city sells gorgeous cars but they all roll as showroom
   solids. A speedway exists; a championship exists (racing.js); and
   the whole fantasy of a race is the LIVERY — a bold number on the
   doors and roof, a hood stripe, team colours. Without that, an "AI
   field" of opponents is just five anonymous coupés and the player's
   own ride can never look like it belongs on the grid. This layer
   turns ANY freshly-built player-car visual (a THREE.Group from
   cityBuildPlayerCarVisual) into a numbered, liveried NASCAR/GT car
   BEFORE it's merged — so every street car CAN be a race car, and
   the AI opponents + the racer NPCs all read as a real series.

   The number lives on BOTH doors + the roof (real NASCAR practice:
   the car number is shown on both door panels and the roof so it's
   legible from the grandstand and from the blimp). The scheme is a
   couple of painted "wrap" boxes (hood stripe + flank accent) so the
   silhouette reads team-coloured without a texture atlas.

   DRAW-CALL DISCIPLINE
   --------------------
   • The body recolour reuses playercars' exact _bodyPaint traversal
     (clone-once-per-source-mat) so it lands in the SAME paint bucket.
   • The two wrap boxes share ONE Lambert per (scheme,accent) → a
     single extra merge bucket for the whole fleet.
   • Each number 0-99 is ONE cached CanvasTexture on ONE shared
     MeshBasicMaterial; the three plate boxes (two doors + roof) all
     use that one material, so a numbered car adds exactly ONE draw
     call for its number (its own bucket — NOT merged into the body,
     which is the whole point: a plate merged into the paint bucket
     would lose its map and the number would vanish).
   • polygonOffset on the plates (mirrors playercars' glass at :567)
     so the number never z-fights the door it sits on.

   Exports:
     CBZ.cityApplyRaceLivery(visual, {number, scheme, base, accent})
     CBZ.cityRaceSchemeFor(seed) -> deterministic scheme name
     CBZ.SCHEMES (the named scheme table, read-only)

   Headless-safe: window.CBZ + window.THREE guards; every THREE call
   tolerates the lightweight test rigs (no CanvasTexture → number is
   simply skipped, body+wraps still apply).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ---- SCHEMES: named team paint = {base, accent}. base recolours the body,
  // accent paints the wrap stripes + number outline glow. Eight bold, legible
  // schemes so a roster of a dozen racers all look distinct on the grid. ----
  const SCHEMES = {
    flames:   { base: 0xc0392b, accent: 0xf2b133 },   // red w/ gold
    bolt:     { base: 0x1b6ec8, accent: 0xeef2f6 },   // blue w/ white
    tricolor: { base: 0x14171f, accent: 0xc0392b },   // black w/ red
    checkers: { base: 0xeef2f6, accent: 0x14171f },   // white w/ black
    gradient: { base: 0x6a2bd6, accent: 0x2ec4d6 },   // purple → cyan
    sponsor:  { base: 0x2ba24a, accent: 0xf2e23a },   // green w/ yellow
    inferno:  { base: 0xd66a2e, accent: 0x101317 },   // orange w/ black
    ice:      { base: 0x2e6e8a, accent: 0xbfe6f2 },   // teal w/ ice
  };
  const SCHEME_NAMES = Object.keys(SCHEMES);
  CBZ.SCHEMES = SCHEMES;

  // deterministic scheme pick from any integer/string seed (no Math.random).
  CBZ.cityRaceSchemeFor = function (seed) {
    let h = 2166136261 >>> 0;
    const s = String(seed == null ? 0 : seed);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return SCHEME_NAMES[(h >>> 0) % SCHEME_NAMES.length];
  };

  // ---- shared wrap material per (base,accent) pair — ONE Lambert across the
  // whole fleet for each colour combo, so all the stripe boxes merge together. ----
  const wrapMats = new Map();
  function wrapMat(accent) {
    let m = wrapMats.get(accent);
    if (m) return m;
    m = new THREE.MeshLambertMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.06 });
    m._shared = true;               // never disposed by the per-car cleanup
    m._raceWrap = true;
    wrapMats.set(accent, m);
    return m;
  }

  // ---- NUMBER textures: ONE bold black-outlined numeral per integer 0-99 on a
  // transparent canvas (the makeLabelSprite technique from props.js:29-44), each
  // wrapped in ONE MeshBasicMaterial(map,transparent). Cached so a 43-car field
  // of repeated numbers still only bakes each digit-pair once. ----
  const numberMats = new Map();
  function numberMat(n) {
    n = ((n | 0) % 100 + 100) % 100;          // clamp to 0..99
    let m = numberMats.get(n);
    if (m) return m;
    // headless test rigs may not implement canvas/CanvasTexture — bail gracefully
    // (caller then skips the plates; body + wraps still apply).
    if (typeof document === "undefined" || !document.createElement) { numberMats.set(n, null); return null; }
    let tex = null;
    try {
      const c = document.createElement("canvas");
      c.width = 128; c.height = 128;
      const x = c.getContext("2d");
      if (!x) { numberMats.set(n, null); return null; }
      const txt = String(n);
      // bold numeral, fat black outline so it reads from the grandstand on any base
      let fs = 92;
      x.font = "900 " + fs + "px Fredoka, Arial, sans-serif";
      const tw = x.measureText(txt).width;
      if (tw > 116) { fs = Math.max(40, Math.floor(fs * 116 / tw)); x.font = "900 " + fs + "px Fredoka, Arial, sans-serif"; }
      x.textAlign = "center"; x.textBaseline = "middle";
      x.lineJoin = "round";
      x.lineWidth = Math.max(6, fs * 0.16); x.strokeStyle = "rgba(8,8,8,.95)";
      x.strokeText(txt, 64, 70);
      x.fillStyle = "#f6f8fb";
      x.fillText(txt, 64, 70);
      tex = new THREE.CanvasTexture(c);
    } catch (e) { numberMats.set(n, null); return null; }
    if (!tex) { numberMats.set(n, null); return null; }
    m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    m._shared = true; m._raceNumber = true;
    m.polygonOffset = true; m.polygonOffsetFactor = -2;   // sit proud of the door (playercars glass pattern)
    numberMats.set(n, m);
    return m;
  }

  // tiny thin BOX geometry per dim signature, cached & _shared (plate panels). The
  // map faces +z in local space, so callers orient the box to point the numeral out.
  const plateGeos = new Map();
  function plateGeo(w, h) {
    const key = w + "|" + h;
    let g = plateGeos.get(key);
    if (g) return g;
    g = new THREE.PlaneGeometry(w, h);
    g._shared = true;
    plateGeos.set(key, g);
    return g;
  }
  const boxGeos = new Map();
  function boxGeo(w, h, d) {
    const key = w + "|" + h + "|" + d;
    let g = boxGeos.get(key);
    if (g) return g;
    g = new THREE.BoxGeometry(w, h, d);
    g._shared = true;
    boxGeos.set(key, g);
    return g;
  }

  // ---- recolour the body to the livery BASE — reuse playercars' exact pattern
  // (clone the _bodyPaint material once per source mat, tag _playerCarOwned so the
  // existing detach/dispose cleans it up). This keeps the body in its paint bucket. ----
  function recolorBase(root, base) {
    const c = new THREE.Color(base);
    const swapped = new Map();
    root.traverse(function (o) {
      const m = o.material;
      if (!m || Array.isArray(m) || !m._bodyPaint) return;
      let nm = swapped.get(m.id);
      if (!nm) {
        nm = m.clone();
        nm.color = c.clone();
        if (nm.emissive) nm.emissive = c.clone().multiplyScalar(0.16);
        nm._shared = false; nm._bodyPaint = false; nm._playerCarOwned = true;
        swapped.set(m.id, nm);
      }
      o.material = nm;
    });
  }

  // ============================================================
  //  THE PUBLIC ENTRY: paint a freshly-built visual into a race car.
  //  MUTATES `visual` in place (before any merge) and returns it.
  // ============================================================
  CBZ.cityApplyRaceLivery = function (visual, livery) {
    if (!visual || !livery) return visual;
    // resolve scheme/base/accent: explicit base/accent win, else the named scheme,
    // else a deterministic scheme from the number so a bare {number} still looks set.
    let base = livery.base, accent = livery.accent;
    if (base == null || accent == null) {
      const schemeName = livery.scheme || CBZ.cityRaceSchemeFor(livery.number != null ? livery.number : 0);
      const sc = SCHEMES[schemeName] || SCHEMES.flames;
      if (base == null) base = sc.base;
      if (accent == null) accent = sc.accent;
    }
    // (1) BODY → livery base, reusing the proven _bodyPaint recolour.
    recolorBase(visual, base);

    // approximate body dims (every makeRoadCar/SUV/etc. publishes this).
    const dims = (visual.userData && visual.userData.vehicleDims) || { width: 1.95, length: 4.6, height: 1.4 };
    const W = dims.width || 1.95, L = dims.length || 4.6, H = dims.height || 1.4;
    const deckY = H * 0.62;             // hull-deck-ish height for the hood stripe
    const wrap = wrapMat(accent);

    // (2) WRAP scheme boxes — a hood/deck stripe + a roof accent + flank blade.
    //     All share ONE Lambert (one merge bucket for the fleet).
    // hood stripe: a bold accent band up the centre of the front deck.
    const hood = new THREE.Mesh(boxGeo(W * 0.26, 0.02, L * 0.86), wrap);
    hood.position.set(0, deckY + 0.02, 0);
    hood.castShadow = false;
    visual.add(hood);
    // roof accent: a thin cap band so the greenhouse reads team-coloured from above.
    const roof = new THREE.Mesh(boxGeo(W * 0.40, 0.02, L * 0.22), wrap);
    roof.position.set(0, H * 0.99, -L * 0.02);
    roof.castShadow = false;
    visual.add(roof);
    // flank blades: a low accent stripe down each rocker so the side reads liveried.
    [1, -1].forEach(function (side) {
      const blade = new THREE.Mesh(boxGeo(0.02, H * 0.10, L * 0.78), wrap);
      blade.position.set(side * (W * 0.505), H * 0.30, 0);
      blade.castShadow = false;
      visual.add(blade);
    });

    // (3) THE NUMBER — both doors (facing out) + roof (facing up). Each plate is a
    //     plane carrying the one cached number material; its own bucket → 1 draw call.
    if (livery.number != null) {
      const nm = numberMat(livery.number);
      if (nm) {
        const plateH = Math.min(0.72, H * 0.5), plateW = plateH;     // square-ish, legible
        // door plates — one per flank, just below the beltline, numeral facing OUTBOARD.
        [1, -1].forEach(function (side) {
          const door = new THREE.Mesh(plateGeo(plateW, plateH), nm);
          door.position.set(side * (W * 0.52), H * 0.40, L * 0.04);
          // a plane's face is +z; rotate so it points out the side (+x / -x).
          door.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
          door.castShadow = false;
          visual.add(door);
        });
        // roof plate — numeral facing UP, rotated so its top points to the nose.
        const top = new THREE.Mesh(plateGeo(plateW * 0.95, plateH * 0.95), nm);
        top.position.set(0, H * 1.005, -L * 0.02);
        top.rotation.x = -Math.PI / 2;     // lay flat, face up
        top.castShadow = false;
        visual.add(top);
      }
    }
    visual.userData = visual.userData || {};
    visual.userData.raceLivery = { number: livery.number, base: base, accent: accent };
    return visual;
  };
})();
