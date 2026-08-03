/* ============================================================
   city/cockpit_shapes.js — THE FURNITURE: the physical cockpit you sit
   inside, for every airframe class, built from ONE grammar.

   This is the GEOMETRY half of the cockpit system (city/cockpit_panel.js is
   THE GLASS — the instrument faces; city/cockpit.js owns the spec, the live
   flight state and the camera). It owns NO state and NO scene: you hand it a
   fully-populated SPEC and it hands back a THREE.Group of body-local cockpit
   furniture plus a bag of NAMED part handles the caller animates every frame.

   THE GRAMMAR — eight nouns, five costumes. Every cockpit in the game is the
   same eight parts (tub · glareshield · panel · canopy frame · consoles ·
   controls · seat · HUD pane) wearing different numbers and shades. A sixth
   airframe is a row in DRESS + a spec, never a new builder. That is the whole
   point: the fighter and the Cessna are not two models, they are two dressings
   of one sentence.

   WHY THE FRAME MATTERS MORE THAN THE GAUGES — a dark horizontal mass across
   the top of your view (the GLARESHIELD) plus dark tubes at the edge of
   peripheral vision (canopy rail, bows, seat rails, door pillars) is what says
   "I am inside something". The panel content is the smaller half of the read,
   so the mesh budget is spent on silhouette first. Detail you would only see
   by leaning forward (switch rows, rivets, placards) is deliberately NOT
   modelled — it becomes a lamp strip and a texture grain instead.

   BUDGET — a whole cockpit is <= 26 meshes and ~8 materials. Related trim is
   sculpted into ONE CBZ.taperBox rather than assembled from five little boxes;
   repeated surfaces share a module-cached Lambert keyed by colour. The build
   counts itself and warns if a spec ever pushes it over.

   COORDINATE FRAME — body-local metres, the repo aircraft convention:
   +Z = nose/forward, +Y = up, X = lateral. Origin = the aircraft group origin.
   The pilot's eye is spec.eye; everything is built AROUND that point, so a
   part "0.8 m in front of the pilot" lives at z = spec.eye.z + 0.8.

   DETERMINISM — no Math.random anywhere (the grain texture uses the repo's
   fixed arithmetic-sequence speckle, same as world/materials.js concreteTex),
   and every mesh carries userData.cockpit so core/batch.js can never merge the
   furniture away underneath the caller's part handles.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  // COCKPIT_SIGHTLINE (city/cockpit_shapes.js) — lay the glareshield, the
  // instrument panel and the nose deck out against the pilot's DOWN-VISION
  // LINE instead of against each other, so you can see over the nose. OFF →
  // the panel sits at its costume's authored `panel.drop` and the hood at its
  // authored `hoodTilt`, i.e. byte-identical to the geometry that shipped
  // before this flag existed. One-line revert; `?cfg_COCKPIT_SIGHTLINE=0` too.
  if (CFG.COCKPIT_SIGHTLINE == null) CFG.COCKPIT_SIGHTLINE = true;

  // ==========================================================================
  //  COCKPIT_CLEAN_V2 (city/cockpit_shapes.js) — ONE MACHINE, NOT FORTY PROPS.
  //
  //  OWNER: "when in first person in cockpit it looks shit theres too many
  //  props." His reference is a fighter canopy: ONE dark arc sweeping
  //  overhead, ONE big integrated panel, a slim centre pedestal, and air
  //  everywhere else. Ours was arithmetically the opposite — the bomber
  //  costume put THIRTY-SEVEN separate objects around a seated man, and the
  //  lightest costume still built twenty-six.
  //
  //  The fix is NOT to delete the cockpit. Every part below still exists and
  //  the silhouette is unchanged or better; what changes is that the parts
  //  which are ONE THING IN THE REAL WORLD are now one thing here:
  //
  //    canopy frame   2 rails + up to 4 bows + centre post + door pillars +
  //                   screen cap + wiper + HUD bracket   ->  ONE welded arch
  //    canopy glass   windscreen + 2 side lights         ->  ONE pane; and on
  //                   the two bubble costumes (fighter, heli) a genuinely
  //                   CURVED ellipsoidal canopy instead of three flat sheets
  //    glareshield    hood + coaming roll                ->  ONE shelf
  //    seat           pan + back + 2 shoulder rails      ->  ONE seat
  //    consoles       left + right                       ->  ONE console mass
  //    backlight      panel flood + overhead strip       ->  ONE lamp
  //    controls       stick shaft + grip / yoke rim +
  //                   spoke / two quadrant levers        ->  ONE per handle
  //
  //  ...plus ONE ARC, not four: a canopy is a canopy, and a row of hoops over
  //  your head is a cage. V2 clamps `bows` to one, placed at the costume's
  //  own `soloBow` station. The wiper — which no fighter, helicopter or
  //  bomber has ever had — becomes airliner/prop dressing (D.wiper).
  //
  //  WELDING, NOT DELETING. The geometry is baked into one BufferGeometry
  //  through the vendored THREE.BufferGeometryUtils (index.html loads it; if
  //  it is ever missing this degrades to the old one-mesh-per-part build, see
  //  emit()). A welded group must therefore share ONE material — which is why
  //  the coaming roll now wears the glareshield's tone and the seat rails the
  //  seat's. That is a real (small) loss of tonal separation and it is the
  //  price of the owner's ask; the SHAPES are all still there.
  //
  //  OFF → every part is built exactly where and how it was before this flag
  //  existed, four bows and all. One-line revert; `?cfg_COCKPIT_CLEAN_V2=0`.
  // ==========================================================================
  if (CFG.COCKPIT_CLEAN_V2 == null) CFG.COCKPIT_CLEAN_V2 = true;
  function clean() { return CFG.COCKPIT_CLEAN_V2 !== false; }

  // Hard draw-call budget per cockpit. 26 was authored before the bomber
  // costume existed; that costume builds ~34 and the B-2 deck's two mission
  // stacks make 36, so 26 had become a warn on EVERY bomber build — a warning
  // that always fires is a warning nobody reads (this repo has been burned by
  // exactly that once already, in clearanceSweep). 40 is the measured heaviest
  // costume plus small headroom; a NEW costume that trips it is still a bug.
  // CLEAN_MAX is the V2 budget: the measured heaviest V2 costume (bomber, 19)
  // plus headroom. A costume that trips it has grown props back.
  const MAX_MESHES = 40;
  const CLEAN_MAX = 22;
  // A display cannot share the bezel's depth plane. The old panel sat exactly
  // on the bezel's rear face, so the depth buffer alternated between canvas
  // and frame pixels (the crawling black/white pattern visible in first
  // person). Twelve millimetres is visually still an inset instrument face,
  // but is a real geometric gap even in the bomber overlay camera.
  // SCREEN LAW (V2): a face must stand >= 0.025 m proud of its bezel. Twelve
  // millimetres survived the depth buffer but still read as a sticker printed
  // ON the frame; at 28 mm the panel is unmistakably a screen SET INTO a
  // machine, which is the whole read the owner's reference photo has.
  const SCREEN_GAP = 0.012;
  const SCREEN_GAP_V2 = 0.028;

  // ---- small numeric helpers ----------------------------------------------
  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Darken/brighten a packed hex. Used to separate adjacent surfaces: a flat
  // cockpit where floor, wall and hood share one colour reads as a painted box,
  // not a shape — every noun gets its own multiplier off the palette.
  function shade(hex, mul) {
    hex = (hex | 0) >>> 0;
    const r = clamp(Math.round(((hex >> 16) & 255) * mul), 0, 255);
    const g = clamp(Math.round(((hex >> 8) & 255) * mul), 0, 255);
    const b = clamp(Math.round((hex & 255) * mul), 0, 255);
    return (r << 16) | (g << 8) | b;
  }

  // ---- sculpted-box helper (the repo's shared aircraft sculptor) -----------
  // carfx.js owns CBZ.taperBox; fall back to a plain box only if this file is
  // ever loaded before it (degrade-safe, never a crash).
  function taper(w, h, d, opt) {
    if (CBZ.taperBox) return CBZ.taperBox(w, h, d, opt);
    return new THREE.BoxGeometry(w, h, d);
  }

  // Keep only the named faces of a BoxGeometry. BoxGeometry's six groups are
  // always in the order px(0) nx(1) py(2) ny(3) pz(4) nz(5) — stable since r7x.
  // This is how the TUB becomes an open bucket instead of a sealed crate: keep
  // the two sidewalls and the rear bulkhead, drop the roof (the canopy frame
  // does that job) and the front face (which would otherwise be a wall painted
  // over the whole world in front of the pilot).
  const FACE = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5 };
  function keepFaces(geo, keep) {
    const groups = geo.groups, idx = geo.getIndex();
    if (!groups || !groups.length || !idx) return geo;
    const src = idx.array, out = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (keep.indexOf(g.materialIndex) < 0) continue;
      for (let j = g.start, e = g.start + g.count; j < e; j++) out.push(src[j]);
    }
    if (!out.length) return geo;
    geo.setIndex(out);
    geo.clearGroups();
    return geo;
  }

  // ---- surface grain -------------------------------------------------------
  // ONE 64px speckle canvas shared by every cockpit, so painted interior
  // surfaces aren't perfectly flat colour (the single biggest "this is a
  // videogame box" tell at low poly). Deterministic arithmetic sequence, not
  // Math.random — same pattern as world/materials.js concreteTex.
  let grainTex;                           // undefined = untried, false = unavailable
  function grain() {
    if (grainTex !== undefined) return grainTex;
    grainTex = false;
    if (typeof document === "undefined" || !document.createElement) return grainTex;
    let c, g;
    try {
      c = document.createElement("canvas");
      c.width = c.height = 64;
      g = c.getContext("2d");
    } catch (e) { return grainTex; }
    if (!g) return grainTex;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 700; i++) {
      const x = (i * 53) % 64, y = (i * 97) % 64;
      const v = 206 + ((i * 37) % 44);    // 206..249 — a whisper, not a pattern
      g.fillStyle = "rgb(" + v + "," + v + "," + v + ")";
      g.fillRect(x, y, 1, 1);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 3);
    if (THREE.sRGBEncoding != null) t.encoding = THREE.sRGBEncoding;   // r128-safe
    grainTex = t;
    return grainTex;
  }

  // ---- THE WELDER (COCKPIT_CLEAN_V2) ---------------------------------------
  // Collects geometries that belong to ONE physical object, bakes each one's
  // placement into its vertices, and hands back a single merged geometry. The
  // matrix is composed exactly the way Object3D composes its own (position,
  // then an XYZ Euler — the default order), so a part that moves from `put()`
  // to `add()` lands in precisely the same place; that equality is what makes
  // the flag a true one-line revert rather than a second layout.
  //
  // DETERMINISM: pure function of its inputs, no iteration order dependence
  // beyond the caller's own add() sequence.
  const _wM = new THREE.Matrix4(), _wQ = new THREE.Quaternion(),
        _wE = new THREE.Euler(), _wP = new THREE.Vector3(), _wS = new THREE.Vector3(1, 1, 1);
  function weld() {
    const bag = [];
    return {
      n: 0,
      // add(geo, x, y, z, rx, ry, rz) — same argument order as a position/
      // rotation pair on a Mesh, so a converted call site reads unchanged.
      add: function (geo, x, y, z, rx, ry, rz) {
        if (!geo) return null;
        _wE.set(rx || 0, ry || 0, rz || 0);
        _wQ.setFromEuler(_wE);
        _wP.set(x || 0, y || 0, z || 0);
        _wM.compose(_wP, _wQ, _wS);
        geo.applyMatrix4(_wM);
        bag.push(geo);
        this.n++;
        return geo;
      },
      list: bag,
      merged: function () {
        if (!bag.length) return null;
        if (bag.length === 1) return bag[0];
        const BGU = THREE.BufferGeometryUtils;
        if (!BGU || !BGU.mergeBufferGeometries) return null;
        let g = null;
        try { g = BGU.mergeBufferGeometries(bag, false); } catch (e) { g = null; }
        return g;
      },
    };
  }

  // ---- material cache ------------------------------------------------------
  // Cockpit surfaces render in a small separate scene with NO fog, so every
  // material this file builds sets fog:false. These are cached module-wide and
  // keyed by their full description, so two aircraft of the same class cost one
  // set — and because nothing outside this file ever mutates them, sharing is
  // safe. (Lamp + glass materials deliberately bypass this cache: the caller
  // animates those, so they must be per-instance.)
  const matCache = new Map();
  function lam(color, o) {
    o = o || {};
    const side = o.side || THREE.FrontSide;
    const key = color + "|" + side + "|" + (o.grain ? 1 : 0) + "|" +
      (o.emissive != null ? o.emissive : -1) + "|" + num(o.ei, 1);
    let m = matCache.get(key);
    if (m) return m;
    const def = { color: color, fog: false, side: side };
    if (o.grain) { const t = grain(); if (t) def.map = t; }
    if (o.emissive != null) { def.emissive = o.emissive; def.emissiveIntensity = num(o.ei, 1); }
    m = new THREE.MeshLambertMaterial(def);
    m._cockpitShared = true;              // never dispose (see dispose() below)
    matCache.set(key, m);
    return m;
  }

  // ---- the five costumes ---------------------------------------------------
  // Everything class-specific lives HERE. Shades are multipliers off the spec
  // palette (so a repaint stays one edit), and the booleans are the dressing
  // beats: a fighter's ejection rails, a helicopter's door pillars, an
  // airliner's coaming lip.
  // `sightDown` is the OVER-THE-NOSE DOWN-VISION ANGLE in degrees this costume
  // is laid out against — how far below the horizon the pilot can see straight
  // ahead before his own aeroplane gets in the way. It is a certification
  // quantity, not a taste one (FAR/CS 25.773 + SAE AS580/ARP4101 define the
  // binocular vision polygon a transport flight deck must deliver from the
  // DESIGN EYE POSITION), and 15° is the floor CBZ.cockpitSightAudit() pins.
  // A new costume that omits it inherits SIGHT.DOWN and is still legal.
  const DRESS = {
    // tight, cramped, near-black; one prominent hoop; ejection rails in the
    // corner of both eyes; low hood so the HUD owns the view.
    fighter: {
      shell: 0.70, floor: 0.58, hood: 0.38, lip: true, hoodTilt: 0.05,
      frame: 0.50, console: 0.76, seat: 0.60, ctrl: 0.42,
      soloBow: 0.50, seatRails: true, pillars: false, lamp2: false, lampEi: 0.75,
      sightDown: 17,      // the F-16's famous over-the-nose figure is 15°
      // V2: a one-piece blown canopy, which is the single most recognisable
      // thing about a modern fighter from the seat — and no wiper, because no
      // fighter has ever had one.
      bubble: true, wiper: false,
      sillDrop: 0.21,
    },
    // greenhouse: airy, minimal structure, thick door pillars at the shoulders,
    // an overhead strip, and a hood that barely exists (you look OVER the panel
    // and down through the chin bubble).
    heli: {
      shell: 0.95, floor: 0.70, hood: 0.50, lip: false, hoodTilt: 0.02,
      frame: 0.62, console: 0.90, seat: 0.80, ctrl: 0.50,
      soloBow: 0.40, seatRails: false, pillars: true, lamp2: true, lampEi: 0.70,
      sightDown: 22,      // a chin-bubble cabin sees far further down than a jet
      bubble: true, wiper: false,   // V2: the greenhouse IS one curved surface
      sillDrop: 0.30,   // you look DOWN through a chin bubble; the door sill is low
    },
    // flight deck: roomy, blue-grey/beige, a BIG deep glareshield, heavy centre
    // post between two windscreen panes, overhead panel, crew seat (no rails).
    airliner: {
      shell: 1.00, floor: 0.72, hood: 0.46, lip: true, hoodTilt: -0.06,
      frame: 0.80, console: 1.05, seat: 0.90, ctrl: 0.55,
      soloBow: 0.45, seatRails: false, pillars: false, lamp2: false, lampEi: 0.80,
      sightDown: 17,      // 737-class: you see the runway threshold on the flare
      // a transport windscreen genuinely IS flat panes in a heavy frame, and
      // it genuinely does have a wiper parked at the bottom of the captain's.
      bubble: false, wiper: true,
      sillDrop: 0.12,   // a flight deck's side window sill is about shoulder height
    },
    // dark and closed: small windows, very deep hood, near-black everything,
    // the backlight (green, per palette) doing all the work.
    bomber: {
      shell: 0.55, floor: 0.45, hood: 0.30, lip: true, hoodTilt: 0.03,
      frame: 0.42, console: 0.60, seat: 0.50, ctrl: 0.38,
      soloBow: 0.55, seatRails: true, pillars: false, lamp2: false, lampEi: 0.90,
      sightDown: 16,      // heads-down by design, but still a certified cockpit
      stacks: true,       // the two lit mission blocks — see MISSION STACKS below
      bubble: false, wiper: false,   // small faceted windows, no wiper
      sillDrop: 0.14,
    },
    // light GA: tan plastic, honest exposed tube frame, thick plexiglass centre
    // bar, a yoke on a column and one throttle knob on a shaft.
    prop: {
      shell: 1.05, floor: 0.80, hood: 0.72, lip: false, hoodTilt: -0.03,
      frame: 0.90, console: 1.00, seat: 0.95, ctrl: 0.60,
      soloBow: 0.42, seatRails: false, pillars: false, lamp2: false, lampEi: 0.65,
      sightDown: 17,      // a high-wing single is nearly all window forward
      bubble: false, wiper: true,    // flat plexiglass in a tube frame, one wiper
      sillDrop: 0.18,
    },
  };

  // ==========================================================================
  //  THE SIGHTLINE  —  why this exists, and what was actually wrong
  // ==========================================================================
  //  OWNER: "the controls go too high and the window starts too high, you
  //  can't see in front of you."  He is right, and the cause is arithmetic
  //  rather than art. Measure the airliner costume as it shipped:
  //
  //    panel.drop 0.44 × scale 1.15            = 0.506 m below the eye
  //    panel.h    (DERIVED from the layout's
  //                1024×384 canvas, not the
  //                0.52 fallback in CLASS)     = 0.655 m tall
  //    glare.rise 0.16 × 1.15                  = 0.184 m above the panel top
  //
  //    panel top  = -0.506 + (0.655/2)·cos(0.22)   = -0.186 m
  //    hood sits  = -0.186 + 0.184                 = -0.002 m  ← EYE LEVEL
  //
  //  The windscreen sill is the hood's own height, so the aperture began at
  //  the pilot's eye and everything below it — half a metre of glareshield,
  //  bezel and panel spanning the full width of the deck — sat in the middle
  //  of the frame. The forward-most top edge of the hood measured +2.8°
  //  ABOVE the horizon: you had to look UP to see the sky, which is exactly
  //  the screenshot. Every other costume was broken the same way (fighter
  //  +2.4°, bomber +2.3°, prop +0.4°, heli the only one in the black at
  //  ~13°, and even that misses the 15° floor).
  //
  //  Three compounding mistakes, all of them fixed below:
  //
  //  1. `panel.drop` was authored against `panel.h`'s FALLBACK (0.52) but the
  //     generator derives the real height from the layout canvas aspect
  //     (0.655) and nobody re-checked the drop. Worth ~2.4° on its own.
  //  2. `glare.rise` floats the shelf a further 0.18 m ABOVE the panel's top
  //     edge. A real glareshield's underside IS the top of the panel; every
  //     centimetre of float is a centimetre the whole stack has to fall to
  //     buy the sightline back, and it steals it from the panel.
  //  3. `hoodTilt` was NEGATIVE on the airliner and the prop, i.e. the front
  //     lip of the shelf was tipped UP into the view. A real glareshield
  //     slopes down and away, roughly parallel to the vision line — which is
  //     WHY the limiting edge of a shelf is its FAR edge, not its near one
  //     (from above a table you lose the floor beyond the far edge first).
  //
  //  THE FIX IS TO STOP AUTHORING HEIGHTS AND START AUTHORING THE ANGLE.
  //  A cockpit is laid out from the design eye position against a vision
  //  line — y(z) = -tan(θ)·z in front of the pilot — and the glareshield, the
  //  coaming roll, the nose deck and the wiper all live UNDER that line. So
  //  that is what solveSight does: it takes the costume's θ (DRESS.sightDown)
  //  and solves for the ONE number the layout actually needs, `drop`, plus
  //  the tilts and the nose-deck height that keep the rest of the forward
  //  structure below the line. `drop` is only ever INCREASED (never reduced),
  //  so an airframe's `userData.cockpit = { panel: { drop: … } }` override
  //  that asks for a LOWER panel still wins — the sightline is a floor, not a
  //  replacement.
  //
  //  CBZ.cockpitSightAudit() (city/cockpit.js) re-measures the result by
  //  raycasting the built triangles, so the solve below is checked rather
  //  than trusted, and downVisionDeg >= 15 is the ratchet.
  // ==========================================================================
  const SIGHT = {
    DOWN: 17,          // default down-vision (deg) for a costume with no sightDown
    MIN: 15,           // the floor cockpitSightAudit() pins — never lower this
    RISE_MAX: 0.075,   // m × spec.scale — how far the shelf may float above the
                       // panel top. Above this it is stealing panel, not shading it.
    RISE_MIN: 0.048,   // m — the hood is 0.085 thick; below this its own body
                       // swallows the panel's top edge instead of overhanging it.
    HOOD_H: 0.085,     // the hood box's authored height (see the taper call below)
    HOOD_NZ: 0.94,     // ...and its taper factors, which scale the box's HALF-HEIGHT
    HOOD_TZ: 0.99,     // at the nose/tail ends (taperBox scales Y by the z factor)
    LIP_H: 0.075,      // the coaming roll's height
    DECK_LEN: 0.62,    // default nose-deck length
    DECK_H: 0.05, DECK_NZ: 0.55, DECK_TZ: 0.34,
    MARGIN: 0.006,     // m of slack under the vision line, so a rounding
                       // difference between this solve and the audit's
                       // raycast can never be the thing that fails the gate.
  };

  // The two TOP corners of a box, in the box's own frame, after rotation.x = a.
  // `tFwd`/`tAft` are its half-heights at the two ends (taperBox shrinks a box's
  // height with depth, so they differ), `hd` is its half-depth. Returns offsets
  // from the box CENTRE. The forward corner is listed first because it is
  // almost always the binding one: a shelf hides the ground beyond its FAR
  // edge, so the far edge is what limits how far down you can see.
  function topCorners(tFwd, tAft, hd, a) {
    const ca = Math.cos(a), sa = Math.sin(a);
    return [
      { dy: tFwd * ca - hd * sa, dz: tFwd * sa + hd * ca },
      { dy: tAft * ca + hd * sa, dz: tAft * sa - hd * ca },
    ];
  }

  // solveSight(S, D, g) — g is { pH, pTilt, pDist, gDepth, rise0, drop0 }, all
  // already scaled, all in metres. Everything it returns is EYE-RELATIVE (the
  // frame the whole builder works in) so the caller just adds ey/ez.
  function solveSight(S, D, g) {
    const sc = num(S.scale, 1);
    const halfTop = (g.pH / 2) * Math.cos(g.pTilt);   // panel top edge above panel centre
    const out = {
      on: false,
      downDeg: num(D.sightDown, SIGHT.DOWN),
      drop: g.drop0, rise: g.rise0, hoodTilt: num(D.hoodTilt, 0),
      deckTilt: 0.09, deckY: null, wiperY: null, sillY: 0,
    };
    // OFF → hand back exactly what the costume authored. `sillY` is still
    // computed, because userData.sight/the audit must be able to report the
    // broken geometry as faithfully as the fixed geometry.
    if (CFG.COCKPIT_SIGHTLINE === false) {
      out.sillY = -out.drop + halfTop + out.rise;
      return out;
    }
    out.on = true;
    const td = Math.tan(clamp(out.downDeg, 0, 40) * Math.PI / 180);

    // 1. THE SHELF SITS ON THE PANEL. Clamp the float first, because the solve
    //    below pays for it twice: once in how far the panel must fall, and
    //    once in how far down you must look to read it.
    out.rise = clamp(g.rise0, SIGHT.RISE_MIN, SIGHT.RISE_MAX * sc);

    // 2. THE SHELF FOLLOWS THE LINE. Tilting the hood to the vision angle is
    //    the single cheapest degree in here: a level shelf trades its whole
    //    depth against the line, a raked one trades only its thickness.
    out.hoodTilt = td > 0 ? Math.atan(td) : num(D.hoodTilt, 0);

    // 3. SOLVE THE SILL. topZ (the panel's top edge, and the shelf's forward
    //    edge) does not depend on `drop`, so this is closed-form: put the
    //    higher of the hood's two top corners exactly on the vision line.
    const topZ = g.pDist + (g.pH / 2) * Math.sin(g.pTilt);
    const hoodZ = topZ - g.gDepth / 2;
    const hc = topCorners(SIGHT.HOOD_H / 2 * SIGHT.HOOD_NZ,
                          SIGHT.HOOD_H / 2 * SIGHT.HOOD_TZ,
                          g.gDepth / 2, out.hoodTilt);
    let sill = Infinity;
    for (let i = 0; i < hc.length; i++) {
      const z = hoodZ + hc[i].dz;
      if (z <= 0.02) continue;                      // behind the eye: cannot block
      sill = Math.min(sill, -td * z - hc[i].dy - SIGHT.MARGIN);
    }
    if (!isFinite(sill)) sill = -out.drop + halfTop + out.rise;
    out.sillY = sill;
    // drop is what the builder consumes; NEVER raise the panel, only lower it,
    // so an airframe override asking for a deeper panel keeps its wish.
    out.drop = Math.max(g.drop0, halfTop + out.rise - sill);
    out.sillY = -out.drop + halfTop + out.rise;     // re-read after the max()

    // 4. THE NOSE DECK. The skin ahead of the windscreen is the SECOND thing
    //    that can eat the view, and at ~1.2-1.8 m out it eats it fast — the
    //    old fixed "0.10 m below the sill" put it at 13.5° on the airliner,
    //    under the floor all by itself. Rake it along the vision line like
    //    the shelf, then drop it until both its ends are under the line.
    out.deckTilt = out.hoodTilt;
    const dLen = num(D.noseLen, SIGHT.DECK_LEN);
    const deckZ = topZ + dLen * 0.5 + 0.10;
    const dc = topCorners(SIGHT.DECK_H / 2 * SIGHT.DECK_NZ,
                          SIGHT.DECK_H / 2 * SIGHT.DECK_TZ,
                          dLen / 2, out.deckTilt);
    // out.sillY, not the local `sill` — an airframe override may have pushed
    // the panel DEEPER than the solve asked for, and the deck follows the sill
    // that was actually built rather than the one that was requested.
    let deckY = out.sillY - 0.10;                   // never HIGHER than the old placement
    for (let i = 0; i < dc.length; i++) {
      const z = deckZ + dc[i].dz;
      if (z <= 0.02) continue;
      deckY = Math.min(deckY, -td * z - dc[i].dy - SIGHT.MARGIN);
    }
    out.deckY = deckY;

    // 5. THE WIPER parks at the base of the screen, i.e. tucked under the
    //    shelf's forward lip. It used to sit 0.03 m ABOVE the sill, which put
    //    a black bar across the view of anyone glancing off-centre.
    out.wiperY = out.sillY + hc[0].dy - 0.055;
    return out;
  }

  // ==========================================================================
  //  BUILD
  // ==========================================================================
  // build(spec, opts) -> { root, parts }
  //   opts.grain  (default true)  — procedural speckle on painted surfaces
  //   opts.name   (default "cockpit-<id>") — root .name, for debugging
  function build(spec, opts) {
    opts = opts || {};
    const S = spec || {};
    const cls = DRESS[S.id] ? S.id : "fighter";
    const D = DRESS[cls];
    const useGrain = opts.grain !== false;

    const eye = S.eye || { x: 0, y: 0, z: 0 };
    const ex = num(eye.x, 0), ey = num(eye.y, 0), ez = num(eye.z, 0);

    const pal = S.pal || {};
    const HULL = num(pal.hull, 0x3b4148);
    const TRIM = num(pal.trim, 0x23282d);
    const BEZEL = num(pal.bezel, 0x15181c);
    const LAMP = num(pal.backlight, 0x2fd6a0);

    const root = new THREE.Group();
    root.name = opts.name || ("cockpit-" + cls);
    // userData.cockpit is the load-bearing tag: core/batch.js spares ANY mesh
    // with non-empty userData, so the caller's part handles can never be merged
    // into a shared buffer. dynamic tells batch/farcull not to descend at all.
    root.userData.cockpit = true;
    root.userData.dynamic = true;

    let count = 0;
    function put(geo, mat, parent) {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = false;               // interior: lit by its own pass
      m.receiveShadow = false;
      m.userData.cockpit = true;
      (parent || root).add(m);
      count++;
      return m;
    }
    function grp(x, y, z, parent) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.userData.cockpit = true;
      (parent || root).add(g);
      return g;
    }
    // Turn a welder into the ONE mesh it describes. If the vendored merger is
    // absent or refuses the batch, every collected geometry is emitted on its
    // own instead — the transforms are already baked, so the fallback build is
    // visually identical, just back to the old draw count. Nothing here can
    // fail in a way that loses a part.
    function emit(w, mat, name, parent) {
      if (!w || !w.n) return null;
      const g = w.merged();
      if (g) { const m = put(g, mat, parent); m.name = name; return m; }
      let last = null;
      for (let i = 0; i < w.list.length; i++) { last = put(w.list[i], mat, parent); last.name = name; }
      return last;
    }
    const V2 = clean();
    // the ONE dark canopy structure: rails, the arch, the centre post, door
    // pillars, the screen cap, the wiper and the HUD bracket. Emitted once,
    // right at the end, because the nose furniture is built inside the
    // glazing section further down.
    const frameW = V2 ? weld() : null;

    const mShell = lam(shade(HULL, D.shell), { side: THREE.BackSide, grain: useGrain });
    const mFloor = lam(shade(HULL, D.floor), { grain: useGrain });
    const mHood = lam(shade(TRIM, D.hood), { grain: useGrain });
    const mFrame = lam(shade(TRIM, D.frame));
    const mBezel = lam(BEZEL);
    const mConsole = lam(shade(HULL, D.console), { grain: useGrain });
    const mSeat = lam(shade(TRIM, D.seat), { grain: useGrain });
    const mCtrl = lam(shade(TRIM, D.ctrl));

    // -----------------------------------------------------------------
    // 1. TUB — the bucket you are sitting in.
    // -----------------------------------------------------------------
    // A spec may set `tub` to null (spec.minimal — the airport airliner brings
    // its OWN modelled cockpit room, so building a second shell inside it would
    // put two floors and two bulkheads in one volume). The dimensions are still
    // needed as a reference frame for the rails and pillars, so they survive;
    // only the geometry is skipped.
    const tub = S.tub || {};
    const tW = num(tub.w, 1.4), tD = num(tub.d, 1.9);
    const floorDrop = num(tub.floorDrop, 0.95);
    // THE SILL COMES DOWN BELOW THE EYE (V2).
    //
    // This is the single biggest thing in the owner's "it looks shit" plate
    // and it is arithmetic, not taste. Measure the fighter as it shipped:
    // floorDrop 1.02·1.15 = 1.17 m below the eye, tub height 1.30·1.15 =
    // 1.50 m — so the sidewalls topped out 0.33 m ABOVE the pilot's eye, 0.59 m
    // to either side. From the design eye position that is two near-black
    // slabs filling the outer third of both eyes, and the forward view becomes
    // a LETTERBOX between them. No amount of decluttering fixes a mail slot.
    //
    // A real canopy rail sits at about shoulder height: you can see DOWN over
    // the side of a fighter, which is most of what makes one feel like a
    // bubble rather than a trench. `sillDrop` is that height, per costume,
    // measured DOWN from the eye — and it is a CLAMP, never a stretch, so a
    // costume (or an airframe override) asking for a lower tub keeps it.
    let tH = num(tub.h, 1.3);
    if (clean()) {
      const sd = num(D.sillDrop, 0.16) * num(S.scale, 1);
      tH = Math.min(tH, Math.max(0.45, floorDrop - sd));
    }
    const floorY = ey - floorDrop;
    // Fore/aft placement: a fixed slice of the tub sits BEHIND the eye (seat +
    // bulkhead), the rest runs forward to the panel.
    const aft = Math.min(0.8, tD * 0.35);
    const tubZ = ez + tD / 2 - aft;

    if (S.tub) {
      const shell = put(
        keepFaces(taper(tW, tH, tD, { nz: 1.02, tz: 0.9, top: 0.88, bot: 0.8, segD: 4 }),
          [FACE.PX, FACE.NX, FACE.NZ]),    // sidewalls + rear bulkhead; open top & front
        mShell);
      shell.position.set(ex, floorY + tH / 2, tubZ);
      shell.name = "cockpit-tub";

      // separate floor plate, a shade off the walls — flat-identical surfaces
      // are what make a low-poly interior read as one painted box.
      const floor = put(taper(tW * 0.97, 0.06, tD * 0.97, { nz: 0.98, tz: 0.94 }), mFloor);
      floor.position.set(ex, floorY + 0.03, tubZ);
      floor.name = "cockpit-floor";
    }

    // -----------------------------------------------------------------
    // 2/3. PANEL + GLARESHIELD — the hood is the single most important
    //      shape in here, so it is built from the panel's real top edge.
    // -----------------------------------------------------------------
    const pn = S.panel || {};
    const gl = S.glare || {};
    const pW = num(pn.w, 0.9), pH = num(pn.h, 0.4);
    const pTilt = num(pn.tilt, 0.35);
    const pDist = num(pn.dist, 0.72);
    // THE SIGHTLINE SOLVE (see the block above build()). This is the ONE call
    // that decides how high the whole forward mass sits, and it runs before a
    // single vertex is placed — `drop`, the hood's rake, the nose deck's
    // height and the wiper all come out of it together, because they are all
    // the same question: what is below the pilot's down-vision line?
    const SS = solveSight(S, D, {
      pH: pH, pTilt: pTilt, pDist: pDist,
      gDepth: num(gl.depth, 0.22),
      rise0: num(gl.rise, 0.1), drop0: num(pn.drop, 0.42),
    });
    const pCz = ez + pDist;
    const pCy = ey - SS.drop;
    // The panel's own local axes after the tilt. +Y of a plane reclined by
    // `tilt` about the lateral axis points (0, cos, sin) — the top edge leans
    // AWAY from the pilot (+Z) for a positive tilt, which is the spec's sign.
    const upY = Math.cos(pTilt), upZ = Math.sin(pTilt);
    const topY = pCy + (pH / 2) * upY;
    const topZ = pCz + (pH / 2) * upZ;

    // BEZEL first (it sits just FORWARD of the glass, so the canvas reads as
    // set into a frame instead of floating). Offset along the panel's forward
    // normal = (0, -sin, +cos).
    // V2 deepens the surround (0.07 -> 0.11) as well as widening it: the face
    // now stands 28 mm proud of it, and a frame thinner than the inset reads
    // as a picture mount rather than as a machine the screen is buried in.
    const bzD = V2 ? 0.11 : 0.07;
    const bezel = put(taper(pW + (V2 ? 0.15 : 0.10), pH + (V2 ? 0.13 : 0.09), bzD,
      { top: 0.92, bot: 0.92 }), mBezel);
    bezel.position.set(ex, pCy - (bzD / 2) * upZ, pCz + (bzD / 2) * upY);
    bezel.rotation.x = pTilt;
    bezel.name = "cockpit-bezel";

    // THE PANEL FACE. PlaneGeometry's default normal is +Z. The pilot sits at
    // LOWER z and looks toward +Z, so the face must be turned to point back at
    // him: rotation.y = PI puts the normal on -Z. That same PI also maps the
    // plane's local +X to world -X — which is exactly right, NOT mirrored: a
    // viewer facing +Z with up +Y has world +X on his screen-LEFT, and after
    // the flip the texture's u=0 column lands on world +X, i.e. screen-left.
    // Text on the canvas therefore reads the correct way round. Euler order is
    // the default XYZ (M = Rx*Ry*Rz), so the tilt in rotation.x is applied
    // AFTER the flip, about the world lateral axis — a clean recline.
    const panelMat = new THREE.MeshBasicMaterial({ map: null, fog: false, toneMapped: false });
    const panelMesh = put(new THREE.PlaneGeometry(pW, pH), panelMat);
    // Pull the glass AFT, toward the pilot, along the panel normal. It used to
    // be exactly coplanar with the bezel's aft face at (pCy,pCz).
    const scrGap = V2 ? SCREEN_GAP_V2 : SCREEN_GAP;
    panelMesh.position.set(ex, pCy + scrGap * upZ, pCz - scrGap * upY);
    panelMesh.rotation.set(pTilt, Math.PI, 0);
    panelMesh.name = "cockpit-panel";

    // GLARESHIELD — the dark horizontal mass over the panel. `depth` juts AFT
    // over the panel top toward the pilot, `rise` lifts it above the top edge.
    // Both `rise` and the rake come from the sightline solve now: this shelf is
    // the single object standing between the pilot and the ground ahead, so its
    // top surface is laid parallel to (and just under) his down-vision line.
    const gDepth = num(gl.depth, 0.22), gRise = SS.rise, gW = num(gl.w, pW + 0.2);
    // V2: the shelf and its coaming roll are ONE shelf (they are one moulding
    // on a real aeroplane). The welder collects both and the mesh is emitted
    // below, still named "cockpit-glareshield" — cockpitSightAudit() measures
    // that name and must keep finding it.
    const hoodW = V2 ? weld() : null;
    const hoodGeo = taper(gW, SIGHT.HOOD_H, gDepth, { nz: SIGHT.HOOD_NZ, tz: SIGHT.HOOD_TZ, top: 0.7, bot: 0.94, segD: 3 });
    let hood = null;
    if (V2) {
      hoodW.add(hoodGeo, ex, topY + gRise, topZ - gDepth * 0.5, SS.hoodTilt);
    } else {
      hood = put(hoodGeo, mHood);
      hood.position.set(ex, topY + gRise, topZ - gDepth * 0.5);
      hood.rotation.x = SS.hoodTilt;      // + tips the forward edge down
      hood.name = "cockpit-glareshield";
    }
    // COAMING LIP — the padded roll along the hood's aft edge. This is the
    // silhouette line the eye actually locks onto, so the deep-hood classes get
    // it as its own slightly darker mass. It RIDES the hood's aft edge rather
    // than sitting at a fixed offset below the sill: once the hood is raked to
    // the vision line its aft edge is the high one, and a lip left behind at
    // the old offset would float in mid-air under it.
    if (D.lip) {
      const lipGeo = taper(gW * 0.99, SIGHT.LIP_H, 0.075, { top: 0.6, bot: 0.7 });
      let lx = ex, ly, lz;
      if (SS.on) {
        // centre of the hood's aft FACE, then down by half the roll, so the
        // roll's top is flush with the corner the solve already placed on the
        // line — the lip can never become the new blocker.
        const ca = Math.cos(SS.hoodTilt), sa = Math.sin(SS.hoodTilt);
        ly = topY + gRise + (gDepth / 2) * sa - SIGHT.LIP_H / 2;
        lz = topZ - gDepth * 0.5 - (gDepth / 2) * ca + 0.03;
      } else {
        ly = topY + gRise - 0.022;
        lz = topZ - gDepth + 0.03;
      }
      if (V2) hoodW.add(lipGeo, lx, ly, lz);
      else { const lip = put(lipGeo, lam(shade(TRIM, D.hood * 0.72))); lip.position.set(lx, ly, lz); lip.name = "cockpit-coaming"; }
    }
    if (V2) hood = emit(hoodW, mHood, "cockpit-glareshield");

    // -----------------------------------------------------------------
    // 4. CANOPY FRAME — structure only, never glass (the aircraft model in
    //    the main scene owns its own canopy). Dark tubes at the edge of
    //    peripheral vision are most of the "I am inside something" read.
    // -----------------------------------------------------------------
    const fr = S.frame || {};
    const railY = ey + num(fr.railY, 0.34);
    const railHW = num(fr.railHalfW, 0.46);
    // ONE ARC. A canopy has a windscreen arch; a row of hoops over the pilot's
    // head is a birdcage, and it was the single biggest contributor to the
    // "too many props" read (the bomber built three).
    const bows = V2 ? Math.min(1, clamp(Math.round(num(fr.bows, 1)), 0, 4))
                    : clamp(Math.round(num(fr.bows, 1)), 0, 4);
    const bowR = num(fr.bowR, 0.035);
    const postW = num(fr.postW, 0);
    const wsTilt = num(fr.windscreenTilt, 0.5);

    // `frame` null (spec.minimal) means the airframe modelled its own
    // windscreen and pillars — adding ours would double every mullion.
    if (S.frame) for (let s = -1; s <= 1; s += 2) {
      const railGeo = taper(0.055, 0.075, tD * 0.95, { nz: 0.55, tz: 0.7, top: 0.7, bot: 0.7, segD: 3 });
      if (V2) frameW.add(railGeo, ex + s * railHW, railY, tubZ);
      else { const rail = put(railGeo, mFrame); rail.position.set(ex + s * railHW, railY, tubZ); rail.name = "cockpit-rail"; }
    }

    // Hoops arcing over the pilot. A default torus lies in the XY plane with its
    // axis on Z, which is already the right attitude for a canopy bow; arc = PI
    // gives the top half, and its two ends land exactly on the rails.
    const bowFwd = topZ + gRise * 0.4 + 0.08;   // the windscreen arch
    const bowAft = ez - 0.5;                     // the hoop behind the head
    for (let i = 0; S.frame && i < bows; i++) {
      const t = bows === 1 ? D.soloBow : i / (bows - 1);
      // V2 fattens the single arch a little: it is now the ONLY hoop, and the
      // owner's reference reads as one heavy dark sweep, not a wire.
      const bowGeo = new THREE.TorusGeometry(railHW, bowR * (V2 ? 1.35 : 1), 6, V2 ? 18 : 14, Math.PI);
      const bz = bowFwd + (bowAft - bowFwd) * t;
      const brx = -wsTilt * (1 - t) * 0.6;       // the forward arch follows the screen
      if (V2) frameW.add(bowGeo, ex, railY, bz, brx);
      else { const bow = put(bowGeo, mFrame); bow.position.set(ex, railY, bz); bow.rotation.x = brx; bow.name = "cockpit-bow"; }
    }

    // Windscreen centre post — leans BACK from vertical, i.e. its top is aft
    // (toward the pilot, -Z), so the rotation about the lateral axis is negative.
    //
    // ...AND IT DOES NOT GO IN FRONT OF THE PILOT'S NOSE. This bar spans the
    // whole height of the windscreen and it used to be built at `ex`, which is
    // the pilot's own centreline — so on every costume that has one (all four
    // but the fighter) the player was looking straight AT a mullion. It is the
    // second half of the owner's "you can't see in front of you", and it is
    // the half nothing analytic would have caught: the first thing
    // CBZ.cockpitSightAudit() ever printed was that the helicopter and the
    // bomber had NO clear ray at ANY angle between 50° down and 70° up,
    // because the post covered everything the panel didn't.
    //
    // A real narrowbody's centre post divides two windscreen panes and the
    // captain sits OUTBOARD of it — he flies looking through the left pane,
    // which is exactly what the owner's reference photo shows. The pilot's
    // right is -X (see the handedness note in cockpit.js), so the post moves
    // to his right and the primary sightline runs through glass.
    if (S.frame && postW > 0.001) {
      const postBaseY = topY + gRise + 0.02;
      const postH = (railY + railHW * 0.5) - postBaseY;
      if (postH > 0.06) {
        const postGeo = taper(postW, postH, 0.075, { top: 0.85, bot: 1.0 });
        const px2 = SS.on ? ex - railHW * 0.42 : ex;
        const py2 = postBaseY + (postH / 2) * Math.cos(wsTilt);
        const pz2 = topZ + 0.06 - (postH / 2) * Math.sin(wsTilt);
        if (V2) frameW.add(postGeo, px2, py2, pz2, -wsTilt);
        else { const post = put(postGeo, mFrame); post.position.set(px2, py2, pz2); post.rotation.x = -wsTilt; post.name = "cockpit-post"; }
      }
    }

    // Door pillars (helicopter dressing): the thick vertical posts at your
    // shoulders that a greenhouse cabin is hung on.
    if (S.frame && D.pillars) {
      for (let s = -1; s <= 1; s += 2) {
        const ph = Math.max(0.2, railY - floorY);
        const pilGeo = taper(0.09, ph, 0.11, { top: 0.8, bot: 0.9 });
        const pilX = ex + s * (tW * 0.5 - 0.02), pilY = floorY + ph / 2, pilZ = ez + 0.2;
        if (V2) frameW.add(pilGeo, pilX, pilY, pilZ);
        else { const pil = put(pilGeo, mFrame); pil.position.set(pilX, pilY, pilZ); pil.name = "cockpit-pillar"; }
      }
    }

    // -----------------------------------------------------------------
    // 4b. THE GLAZING — actual glass in the actual frame.
    //
    // OWNER: "the cockpit has some glass but it's not good at all." It had
    // NONE. The header above said so outright — "structure only, never glass"
    // — on the theory that the exterior aircraft model owns the canopy. From
    // the pilot's seat that theory fails: you sit inside a bare hoop-and-rail
    // cage and look straight out through nothing. There is no pane between you
    // and the sky, so nothing ever catches the light, and the one surface that
    // should say "you are sealed inside a machine at altitude" is absent.
    //
    // These panes are CBZ.glass — the same material as the curtain wall on
    // every tower in the city, which is the glass the owner says is perfect.
    // Not a lookalike: the same object out of the same pool. Two deliberate
    // deviations from the building preset, both forced by sitting INSIDE it:
    //   • far lower opacity — a 0.6 pane is a windscreen you cannot fly
    //     through. Aircraft glass is nearly clear; it is the TINT and the
    //     emissive lift that sell it, not the density.
    //   • DoubleSide + no depth write — you are on the inside of this pane,
    //     and a canopy that writes depth sorts in front of its own instrument
    //     panel and punches a hole through the cockpit.
    //
    // Frameless airframes (spec.minimal, which model their own windscreen)
    // are skipped for exactly the reason their frame is: doubling a mullion
    // is bad, and doubling a windscreen is worse.
    // -----------------------------------------------------------------
    const glassMats = [];
    let wsMesh = null, deckMesh = null;      // handles for CBZ.cockpitSightAudit()
    if (S.frame && CBZ.glass && D.glaze !== false) {
      const gMat = CBZ.glass({
        opacity: num(D.glazeOpacity, 0.17),
        side: THREE.DoubleSide,
        ei: 0.34,                       // a touch under the building lift
        fog: false,                     // this interior renders in a fog-free pass
      });
      glassMats.push(gMat);
      const gw = railHW * 2 * 0.98;
      var wsH = Math.max(0.24, (railY + railHW * 0.42) - (topY + gRise));
      // V2 collects every pane into ONE canopy (see the flag header). The
      // BUBBLE costumes get a genuinely curved shell instead; either way the
      // result is a single mesh, tagged glass, and the flat-pane path is the
      // old geometry byte-for-byte.
      const glassW = V2 ? weld() : null;

      if (V2 && D.bubble) {
        // ---- THE ONE-PIECE CANOPY -------------------------------------
        // An open-ended cylinder wrapped around the seat, tapered inward at
        // the crown and squeezed laterally into an ELLIPSE by the mesh scale:
        // narrow across the shoulders, long fore-and-aft, which is the shape
        // of every blown canopy and every helicopter greenhouse. Three flat
        // sheets meeting at hard angles is what made ours read as a diorama.
        //
        // r128 CylinderGeometry places theta=0 at +Z, so an arc centred on
        // -half..+half is centred on the NOSE with no extra rotation.
        // THE ARC IS SOLVED, NOT GUESSED. A 252° sweep has to reach the
        // windscreen at the front AND close behind the pilot's head, and the
        // rear-most point of an arc that wide is NOT its centre-minus-radius
        // — it is cos(A/2)·r back from the centre. Authoring the centre and
        // the radius separately (the first cut of this) left the canopy
        // ending 30 cm in FRONT of the eye: a fighter with no glass over its
        // own pilot. Two equations, closed form, no tuning.
        const front = topZ + 0.07;                        // just ahead of the screen cap
        const back = ez - Math.max(0.45, tD * 0.30);      // aft of the headrest
        const arc = 4.40;                                 // ~252°: the open 108° is the bulkhead
        const k = Math.cos(arc / 2);                      // < 0 for anything past a half turn
        const rFore = Math.max(0.30, (front - back) / (1 - k));
        const zc = front - rFore;
        const rLat = Math.max(0.22, railHW * 1.02);
        const yBot = topY + gRise - 0.02;                 // the sill, front and side
        // the crown clears the canopy ARCH (a torus of radius railHW standing
        // on the rails) instead of stopping half way up it — a hoop poking out
        // through the top of the glass is the one thing that would make this
        // read as two objects again.
        const yTop = railY + railHW * 1.02;
        const bubH = Math.max(0.30, yTop - yBot);
        const bub = new THREE.CylinderGeometry(0.62, 1.0, bubH, 20, 1, true, -arc / 2, arc);
        const ws = put(bub, gMat);
        ws.position.set(ex, yBot + bubH / 2, zc);
        ws.scale.set(rLat, 1, rFore);
        ws.name = "cockpit-canopy-glass";
        ws.renderOrder = 6;             // after the opaque interior, always
        ws.userData.glass = true;
        wsMesh = ws;
      } else {
        // WINDSCREEN — one pane raked on the same axis as the centre post, so
        // it lands flush inside the forward bow rather than floating in it.
        const wsGeo = new THREE.PlaneGeometry(gw, wsH);
        const wy = topY + gRise + (wsH / 2) * Math.cos(wsTilt);
        const wz = topZ + 0.055 - (wsH / 2) * Math.sin(wsTilt);
        if (V2) {
          glassW.add(wsGeo, ex, wy, wz, -wsTilt);
        } else {
          const ws = put(wsGeo, gMat);
          ws.position.set(ex, wy, wz);
          ws.rotation.x = -wsTilt;
          ws.name = "cockpit-windscreen";
          ws.renderOrder = 6;           // after the opaque interior, always
          ws.userData.glass = true;
          wsMesh = ws;
        }
      }

      // THE NOSE, FROM THE INSIDE (owner: "the front of planes looks good from
      // outside, not from inside" / "the front of planes needs some redoing").
      // From the seat, the forward structure was a hood and then NOTHING — the
      // windscreen ended and the world began, with no coaming, no nose deck and
      // no wiper. So the aircraft appeared to have no front at all: you looked
      // straight off the edge of the glareshield into open sky, which is why the
      // outside read fine and the inside did not. These are the three parts you
      // genuinely see over the panel of a real aeroplane.
      const noseW = gW * 0.94;
      // the rail capping the TOP of the windscreen — closes the frame. (Named
      // apart from the glareshield's own coaming roll; two meshes called
      // "cockpit-coaming" used to make a probe's name lookup a coin toss.)
      const coamGeo = taper(noseW, 0.05, 0.10, { top: 0.7, bot: 0.9 });
      const coamY = topY + gRise + wsH * Math.cos(wsTilt) + 0.02;
      const coamZ = topZ + 0.055 - wsH * Math.sin(wsTilt);
      if (V2) frameW.add(coamGeo, ex, coamY, coamZ, -wsTilt);
      else { const coam = put(coamGeo, mFrame); coam.position.set(ex, coamY, coamZ); coam.rotation.x = -wsTilt; coam.name = "cockpit-screencap"; }
      // the NOSE DECK visible beyond the glass — the sloping skin ahead of the
      // windscreen that tells you where the aircraft ENDS. It sits at 1.2-1.8 m
      // out, which is far enough that a few centimetres of height is several
      // degrees of view: at its old fixed "sill minus 0.10" it cut the airliner
      // off at 13.5° all by itself, under the floor even with a clear shelf. So
      // it is raked along the vision line and solved to sit under it (§4 of
      // solveSight). You are meant to SEE this thing — just not to see it
      // instead of the runway.
      const dLen = D.noseLen != null ? D.noseLen : SIGHT.DECK_LEN;
      const deck = put(taper(noseW * 0.86, SIGHT.DECK_H, dLen,
        { nz: SIGHT.DECK_NZ, tz: SIGHT.DECK_TZ, top: 0.8, bot: 0.8, segD: 3 }), mHood);   // the hull skin ahead of the screen wears the hood tone
      deck.position.set(ex,
        SS.deckY != null ? ey + SS.deckY : topY + gRise - 0.10,
        topZ + dLen * 0.5 + 0.10);
      deck.rotation.x = SS.deckTilt;             // falls away toward the nose
      deck.name = "cockpit-nosedeck";
      deckMesh = deck;
      // one wiper parked at the base of the screen — tiny, and it is the detail
      // that says "this glass is real and someone maintains it". PARKED means
      // below the shelf's forward lip: at its old sill+0.03 it stood proud of
      // the glareshield and drew a black bar across the off-centre view.
      // V2 gives it only to the types that HAVE one: a fighter, a gunship and
      // a stealth bomber all fly without wipers, and a black bar across the
      // one clear pane is the last thing those three needed.
      if (!V2 || D.wiper) {
        const wipGeo = taper(0.02, 0.02, 0.30, { top: 0.7, bot: 0.7 });
        const wipX = ex - noseW * 0.22;
        const wipY = SS.wiperY != null ? ey + SS.wiperY : topY + gRise + 0.03;
        if (V2) frameW.add(wipGeo, wipX, wipY, topZ + 0.08, -wsTilt + 0.12);
        else { const wip = put(wipGeo, mFrame); wip.position.set(wipX, wipY, topZ + 0.08); wip.rotation.x = -wsTilt + 0.12; wip.name = "cockpit-wiper"; }
      }

      // SIDE LIGHTS — the panes your peripheral vision actually reads while
      // you bank. Hung on the rails, canted in slightly at the top the way a
      // real greenhouse tapers toward the spine.
      const sideL = Math.max(0.3, tD * 0.62);
      const sideH = Math.max(0.2, railHW * 0.72);
      // (the bubble already IS the side glass — it wraps to both shoulders.)
      if (!V2 || !D.bubble) for (let s = -1; s <= 1; s += 2) {
        const paneGeo = new THREE.PlaneGeometry(sideL, sideH);
        const pnX = ex + s * railHW * 0.99, pnY = railY - sideH * 0.34, pnZ = tubZ + 0.02;
        if (V2) {
          glassW.add(paneGeo, pnX, pnY, pnZ, 0, s * Math.PI / 2, s * 0.12);
        } else {
          const pane = put(paneGeo, gMat);
          pane.position.set(pnX, pnY, pnZ);
          pane.rotation.y = s * Math.PI / 2;
          pane.rotation.z = s * 0.12;
          pane.name = "cockpit-sidelight";
          pane.renderOrder = 6;
          pane.userData.glass = true;
        }
      }
      // ...and the flat-pane costumes' glazing becomes ONE pane here.
      if (V2 && glassW.n) {
        const gm = emit(glassW, gMat, "cockpit-canopy-glass");
        if (gm) { gm.renderOrder = 6; gm.userData.glass = true; wsMesh = gm; }
      }
    }

    // -----------------------------------------------------------------
    // 5. CONSOLES — one sculpted box each. Switch rows are NOT modelled
    //    (five draws for detail you never look straight at); the lamp
    //    strip below is what makes them read at a glance.
    // -----------------------------------------------------------------
    function consoleGeo(c) {
      return taper(num(c.w, 0.2), num(c.h, 0.2), num(c.d, 0.5),
        { nz: 0.92, tz: 0.98, top: 0.86, bot: 0.96, segD: 3 });
    }
    function consoleBox(c, name, w) {
      if (!c) return null;
      // EYE-RELATIVE, like every other noun in here. The spec's console /
      // control offsets are authored as "0.5 m to the pilot's side, 0.44 m
      // below his eye" — absolute placement would leave the stick a metre
      // behind a pilot whose seat sits forward in the nose.
      const cx = ex + num(c.x, 0), cy = ey + num(c.y, 0), cz = ez + num(c.z, 0);
      if (w) { w.add(consoleGeo(c), cx, cy, cz); return null; }
      const m = put(consoleGeo(c), mConsole);
      m.position.set(cx, cy, cz);
      m.name = name;
      return m;
    }
    // V2: the left and right side consoles are one console mass — on a real
    // fighter they are the two arms of a single tub moulding, and drawn apart
    // they were two more objects in the corner of both eyes. The PEDESTAL
    // stays its own thing on purpose: the owner's reference has exactly one
    // slim centre stack and it is the only console you actually look at.
    const conW = V2 ? weld() : null;
    consoleBox(S.consoleL, "cockpit-consoleL", conW);
    consoleBox(S.consoleR, "cockpit-consoleR", conW);
    if (V2) emit(conW, mConsole, "cockpit-consoles");
    const pedestal = consoleBox(S.pedestal, "cockpit-pedestal");

    let overheadMesh = null;
    if (S.overhead) {
      const ov = S.overhead;
      overheadMesh = put(taper(num(ov.w, 0.5), 0.1, num(ov.d, 0.4),
        { nz: 0.9, tz: 0.9, top: 0.8, bot: 0.92 }), mConsole);
      overheadMesh.position.set(ex, railY - num(ov.drop, 0.12), ez + 0.22);
      overheadMesh.name = "cockpit-overhead";
    }

    // ---- backlighting: per-instance emissive materials the caller ramps
    // with CBZ.nightAmount. Never cached — these get written every frame.
    const lampMats = [];
    function lampMat() {
      const m = new THREE.MeshLambertMaterial({
        color: shade(LAMP, 0.22), emissive: LAMP,
        emissiveIntensity: D.lampEi * 0.35, fog: false,
      });
      lampMats.push(m);
      return m;
    }
    // the panel flood: a strip tucked under the hood's aft lip washing the face.
    // V2 welds the flood and the overhead strip into ONE emissive object: they
    // are the same lamp circuit, they ramp off the same CBZ.nightAmount, and
    // one material instead of two is one less thing the animator writes.
    const lampW = V2 ? weld() : null;
    const floodGeo = taper(pW * 0.92, 0.028, 0.05, { nz: 0.9, tz: 0.9 });
    const floodY = topY + gRise * 0.42, floodZ = topZ - gDepth * 0.55;
    if (V2) lampW.add(floodGeo, ex, floodY, floodZ);
    else {
      const flood = put(floodGeo, lampMat());
      flood.position.set(ex, floodY, floodZ);
      flood.name = "cockpit-flood";
    }
    if (D.lamp2) {
      const host = overheadMesh || pedestal;
      if (host) {
        const stripGeo = taper(0.14, 0.022, 0.24, { nz: 0.9, tz: 0.9 });
        if (V2) lampW.add(stripGeo, host.position.x, host.position.y - 0.055, host.position.z);
        else {
          const strip = put(stripGeo, lampMat());
          strip.position.set(host.position.x, host.position.y - 0.055, host.position.z);
          strip.name = "cockpit-lampstrip";
        }
      }
    }
    if (V2) emit(lampW, lampMat(), "cockpit-flood");

    // ---- MISSION STACKS (bomber dressing only) ------------------------------
    // b2code.html's front office is not a wall of gauges — it is two LIT BLOCKS
    // flanking the crew: a stores list on one side, a BDA readout on the other,
    // both in the same phosphor the flight symbology uses. That contrast is most
    // of why a strategic cockpit reads differently from a fighter's, and it is
    // two faces, not a system. They ride the consoles the spec ALREADY declares
    // (no new spec fields, no new material family), sit on each console's own
    // top surface and cant up toward the crew's eyeline. Being minted through
    // lampMat() means the caller's existing CBZ.nightAmount ramp drives them for
    // free — there is no second lighting path here and there must not be one.
    if (D.stacks) {
      const hosts = [S.consoleL, S.consoleR];
      const stackW = V2 ? weld() : null;
      for (let i = 0; i < hosts.length; i++) {
        const c = hosts[i];
        if (!c) continue;
        const cw = num(c.w, 0.2), cd = num(c.d, 0.5), chh = num(c.h, 0.2);
        const faceGeo = taper(cw * 0.78, 0.022, cd * 0.62, { nz: 0.94, tz: 0.94 });
        const fx = ex + num(c.x, 0), fy = ey + num(c.y, 0) + chh / 2 + 0.014, fz = ez + num(c.z, 0);
        if (V2) stackW.add(faceGeo, fx, fy, fz, -0.10);   // canted up out of the console top
        else {
          const face = put(faceGeo, lampMat());
          face.position.set(fx, fy, fz);
          face.rotation.x = -0.10;
          face.name = "cockpit-stack-" + (i ? "R" : "L");
        }
      }
      if (V2) emit(stackW, lampMat(), "cockpit-stacks");
    }

    // -----------------------------------------------------------------
    // 6. CONTROLS — the parts that MOVE. Every animated handle is a GROUP
    //    whose ORIGIN is the real pivot; the visible geometry is a child,
    //    pre-translated so the mesh grows out of that pivot. The caller
    //    writes rotation on the groups, so this file never sets one on a
    //    group it hands back (a lean lives on the CHILD instead).
    // -----------------------------------------------------------------
    // an arm rising +Y from the origin, fattening into a grip/knob at the top.
    function armGeo(len, w, knob) {
      const g = taper(w, w * 1.05, len, { nz: knob, tz: 0.78, top: 0.92, bot: 0.92, segD: 4 });
      g.translate(0, 0, len / 2);         // base at the origin, body toward +Z
      g.rotateX(-Math.PI / 2);            // ...then stand it up: +Z -> +Y
      return g;
    }

    const st = S.stick || {};
    const stType = st.type || "center";
    const stLen = num(st.len, 0.3);
    let stick = null, yoke = null;

    if (stType === "yoke") {
      // A yoke pivots at the COLUMN root down on the panel and the wheel spins
      // on the column axis. parts.stick is the column pivot (rotate X = pitch,
      // exactly like a stick) and parts.yoke is the wheel (rotate Z = roll), so
      // the caller drives both with the same two numbers.
      stick = grp(ex + num(st.x, 0), ey + num(st.y, 0), ez + num(st.z, 0) + stLen);
      stick.name = "cockpit-column";
      const col = put(taper(0.085, 0.085, stLen, { nz: 1.06, tz: 0.9, top: 0.9, bot: 0.9, segD: 3 }), mCtrl, stick);
      col.position.z = -stLen / 2;        // runs aft from the pivot to the wheel
      col.name = "cockpit-column-tube";
      yoke = grp(0, 0, -stLen, stick);
      yoke.name = "cockpit-yoke";
      // partial-torus wheel with the gap at the top (the classic horned yoke);
      // the torus lies in XY with its axis on Z, so parts.yoke.rotation.z spins it.
      const arc = Math.PI * 1.32;
      const rimGeo = new THREE.TorusGeometry(0.15, 0.028, 6, 16, arc);
      const rimRz = Math.PI / 2 - (arc + Math.PI * 2) / 2;
      const spokeGeo = taper(0.29, 0.05, 0.035, { nz: 0.8, tz: 0.8, top: 0.8 });
      if (V2) {
        // one control wheel, not a rim and a spoke that happen to overlap
        const w = weld();
        w.add(rimGeo, 0, 0, 0, 0, 0, rimRz);
        w.add(spokeGeo, 0, 0, 0);
        emit(w, mCtrl, "cockpit-yoke-wheel", yoke);
      } else {
        const rim = put(rimGeo, mCtrl, yoke);
        rim.rotation.z = rimRz;
        rim.name = "cockpit-yoke-rim";
        const spoke = put(spokeGeo, mCtrl, yoke);
        spoke.name = "cockpit-yoke-spoke";
      }
    } else {
      stick = grp(ex + num(st.x, 0), ey + num(st.y, 0), ez + num(st.z, 0));
      stick.name = "cockpit-stick";
      const lean = stType === "side" ? 0.14 : 0.0;   // a side-stick cants inboard
      const shaftLen = stLen * 0.82;
      const shaftGeo = new THREE.CylinderGeometry(0.024, 0.032, shaftLen, 8);
      // the grip: a fat sculpted head — on a fighter this is the whole hand.
      const gripGeo = taper(0.075, stLen * 0.34, 0.09, { nz: 0.8, tz: 0.9, top: 0.62, bot: 1.12, segD: 3 });
      const gripX = -Math.sin(lean) * stLen * 0.9, gripY = stLen * 0.9;
      if (V2) {
        // a control column is one object; the shaft and the grip were two only
        // because they are two boxes. Welded INSIDE the pivot group, so the
        // caller still animates it exactly as before.
        const w = weld();
        w.add(shaftGeo, 0, shaftLen / 2, 0, 0, 0, lean);
        w.add(gripGeo, gripX, gripY, 0, 0, 0, lean);
        emit(w, mCtrl, "cockpit-stick-body", stick);
      } else {
        const shaft = put(shaftGeo, mCtrl, stick);
        shaft.position.set(0, shaftLen / 2, 0);
        shaft.rotation.z = lean;
        shaft.name = "cockpit-stick-shaft";
        const grip = put(gripGeo, mCtrl, stick);
        grip.position.set(gripX, gripY, 0);
        grip.rotation.z = lean;
        grip.name = "cockpit-stick-grip";
      }
    }

    // ---- throttle / collective / quadrant / knob
    const lv = S.lever;
    let lever = null;
    if (lv) {
      lever = grp(ex + num(lv.x, 0), ey + num(lv.y, 0), ez + num(lv.z, 0));
      lever.name = "cockpit-lever";
      const lLen = num(lv.len, 0.26);
      const lType = lv.type || "throttle";
      if (lType === "quadrant") {
        // twin levers side by side — a two-engine airliner has to READ as two.
        // V2 welds the pair: they are one quadrant and they move together (the
        // animator has never split them; when a per-engine model exists, the
        // split is a second weld, not four meshes).
        const qW = V2 ? weld() : null;
        for (let i = 0; i < 2; i++) {
          const ax = (i === 0 ? -1 : 1) * 0.055;
          if (V2) qW.add(armGeo(lLen, 0.05, 2.0), ax, 0, 0);
          else {
            const arm = put(armGeo(lLen, 0.05, 2.0), mCtrl, lever);
            arm.position.x = ax;
            arm.name = "cockpit-quadrant-" + i;
          }
        }
        if (V2) emit(qW, mCtrl, "cockpit-quadrant", lever);
      } else if (lType === "knob") {
        // a GA plunger: a shaft out of the panel with a fat knob on the aft end.
        const g = taper(0.045, 0.045, lLen, { nz: 0.85, tz: 2.4, top: 0.95, bot: 0.95, segD: 4 });
        g.translate(0, 0, -lLen / 2);     // origin at the panel end, body aft
        const arm = put(g, mCtrl, lever);
        arm.name = "cockpit-knob";
      } else {
        // throttle (fighter, left console) or collective (heli, left hip — the
        // arm rakes forward from the pivot instead of standing straight up).
        const arm = put(armGeo(lLen, 0.055, 1.7), mCtrl, lever);
        if (lType === "collective") arm.rotation.x = 0.55;
        arm.name = "cockpit-" + lType;
      }
    }

    // ---- rudder pedals: two groups the caller slides on Z.
    let pedalL = null, pedalR = null;
    if (S.pedals) {
      const pd = S.pedals;
      const px = ex + num(pd.x, 0), py = ey + num(pd.y, 0), pz = ez + num(pd.z, 0);
      const sep = num(pd.sep, 0.26);
      // pedalL is the (x - sep/2) group. The spec generator hands us a NEGATIVE
      // separation precisely so that lands on +X — which, for an observer
      // facing +Z with +Y up, is the pilot's LEFT foot (right = forward × up
      // puts his right hand on -X). Names stay honest either way.
      pedalL = grp(px - sep / 2, py, pz); pedalL.name = "cockpit-pedalL";
      pedalR = grp(px + sep / 2, py, pz); pedalR.name = "cockpit-pedalR";
      [pedalL, pedalR].forEach(function (g) {
        const plate = put(taper(0.115, 0.2, 0.05, { top: 0.85, bot: 0.95 }), mCtrl, g);
        plate.position.set(0, 0.07, 0);
        plate.rotation.x = -0.42;         // face reclined back toward the boot
        plate.name = "cockpit-pedal-plate";
      });
    }

    // -----------------------------------------------------------------
    // 7. SEAT — you never look at it, which is the point: the headrest and
    //    the shoulder rails live in the far corners of vision and are what
    //    make the view feel OWNED by a body.
    // -----------------------------------------------------------------
    const se = S.seat || {};
    const sW = num(se.w, 0.46), sH = num(se.h, 0.62), sD = num(se.d, 0.42);
    const panY = ey - num(se.backDrop, 0.55);
    // V2: pan + back + shoulder rails are ONE ejection seat. This is the
    // clearest case in the file — nobody has ever looked at an aircraft seat
    // and counted four objects.
    const seatW = V2 ? weld() : null;
    if (S.seat) {
      const panGeo = taper(sW * 0.94, 0.11, sD, { nz: 1.05, tz: 0.9, top: 0.82, bot: 0.94, segD: 3 });
      // back + headrest as ONE sculpted mass (top narrows into the head box).
      const backGeo = taper(sW, sH, 0.15, { top: 0.66, bot: 1.0, segD: 2 });
      if (V2) {
        seatW.add(panGeo, ex, panY, ez + 0.1);
        seatW.add(backGeo, ex, panY + sH / 2, ez - 0.3);
      } else {
        const pan = put(panGeo, mSeat);
        pan.position.set(ex, panY, ez + 0.1);
        pan.name = "cockpit-seatpan";
        const back = put(backGeo, mSeat);
        back.position.set(ex, panY + sH / 2, ez - 0.3);
        back.name = "cockpit-seatback";
      }
    }
    if (S.seat && D.seatRails) {
      const rh = num(se.railH, 0.4);
      for (let s = -1; s <= 1; s += 2) {
        const rGeo = taper(0.06, rh, 0.1, { top: 0.7, bot: 1.0 });
        const rx = ex + s * (sW / 2 + 0.02), ry = panY + 0.05 + rh / 2, rz = ez - 0.06;
        if (V2) seatW.add(rGeo, rx, ry, rz);
        else { const r = put(rGeo, lam(shade(TRIM, D.seat * 0.75))); r.position.set(rx, ry, rz); r.name = "cockpit-seatrail"; }
      }
    }
    if (V2) emit(seatW, mSeat, "cockpit-seat");

    // -----------------------------------------------------------------
    // 8. HUD PANE — combiner glass, fighter/bomber only. Additive and
    //    depth-write-free so the symbology floats over the world instead
    //    of masking it.
    // -----------------------------------------------------------------
    let hudMesh = null;
    if (S.hud) {
      const hd = S.hud;
      const hW = num(hd.w, 0.3), hH = num(hd.h, 0.24);
      const hy = ey - num(hd.drop, 0.1), hz = ez + num(hd.dist, 0.5);
      const hudMat = new THREE.MeshBasicMaterial({
        map: null, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
      });
      hudMesh = put(new THREE.PlaneGeometry(hW, hH), hudMat);
      hudMesh.position.set(ex, hy, hz);
      // Same flip as the panel (normal -> -Z, texture unmirrored), plus the
      // combiner's own small recline toward the pilot.
      hudMesh.rotation.set(-0.14, Math.PI, 0);
      hudMesh.renderOrder = 4;
      hudMesh.name = "cockpit-hud";
      // A combiner is GLASS you shoot symbology at — it is deliberately in
      // front of your eye and it must never count as an obstruction. The tag
      // is what keeps CBZ.cockpitSightAudit()'s raycast honest (the side
      // panes carry userData.glass for the same reason).
      hudMesh.userData.seeThrough = true;
      const brGeo = taper(hW + 0.06, 0.05, 0.1, { top: 0.7, bot: 0.9 });
      const brY = hy - hH / 2 - 0.03, brZ = hz + 0.01;
      // the combiner's mount is part of the canopy structure, not a prop
      if (V2) frameW.add(brGeo, ex, brY, brZ);
      else { const bracket = put(brGeo, mFrame); bracket.position.set(ex, brY, brZ); bracket.name = "cockpit-hud-bracket"; }
    }

    // ---- and finally the ONE canopy structure everything above fed ---------
    if (V2) emit(frameW, mFrame, "cockpit-canopy");

    if (count > MAX_MESHES) {
      console.warn("[cockpit_shapes] " + cls + " built " + count +
        " meshes (budget " + MAX_MESHES + ")");
    } else if (V2 && count > CLEAN_MAX) {
      console.warn("[cockpit_shapes] " + cls + " built " + count +
        " meshes (V2 budget " + CLEAN_MAX + ")");
    }
    root.userData.cockpitMeshCount = count;
    // THE SIGHTLINE RECORD, in the frame the audit wants: body-local absolute
    // Y for the three heights a human argument is actually about ("is the
    // glareshield below the pilot's eye or not"), plus what the solve asked
    // for. cockpitSightAudit() reports the MEASURED angle beside `wantDownDeg`
    // so a solve that silently stops working shows up as a disagreement
    // rather than as a screenshot somebody has to notice.
    root.userData.sight = {
      on: SS.on,
      wantDownDeg: SS.downDeg,
      eyeY: ey,
      sillY: ey + SS.sillY,               // the windscreen's lower edge
      glareY: ey + SS.sillY + (SIGHT.HOOD_H / 2) * SIGHT.HOOD_TZ * Math.cos(SS.hoodTilt)
                            + (num(S.glare && S.glare.depth, 0.22) / 2) * Math.sin(SS.hoodTilt),
      panelTopY: topY, panelBotY: pCy - (pH / 2) * upY,
      panelCz: pCz, topZ: topZ,
      drop: SS.drop, rise: SS.rise, hoodTilt: SS.hoodTilt,
      deckY: SS.deckY != null ? ey + SS.deckY : null,
    };

    return {
      root: root,
      parts: {
        panelMesh: panelMesh,
        hudMesh: hudMesh,
        stick: stick,
        lever: lever,
        pedalL: pedalL,
        pedalR: pedalR,
        yoke: yoke,
        lampMats: lampMats,
        glassMats: glassMats,             // REAL panes now — see section 4b
        glareMesh: hood,                  // the three the sightline audit reads
        windscreenMesh: wsMesh,
        deckMesh: deckMesh,
      },
    };
  }

  // Optional teardown for a cockpit that is being replaced. Disposes only what
  // this build OWNS: its geometries and its per-instance materials. Cached
  // surface materials (_cockpitShared) and the one grain texture are shared
  // module-wide and are never disposed.
  function dispose(res) {
    const r = res && (res.root || res);
    if (!r || !r.traverse) return;
    r.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.geometry && o.geometry.dispose && !o.geometry._shared) o.geometry.dispose();
      const m = o.material;
      if (m && m.dispose && !m._cockpitShared) m.dispose();
    });
    if (r.parent) r.parent.remove(r);
  }

  // SIGHT rides along so city/cockpit.js's audit pins the SAME floor this file
  // solved against — two copies of "15" that can drift is exactly the stat
  // fiction CLAUDE.md bans.
  // CLEAN_MAX rides along for the same reason SIGHT does: CBZ.cockpitAudit()
  // pins the prop budget this file actually builds against, so the two can
  // never drift into two different "22"s.
  CBZ.cockpitShapes = { build: build, dispose: dispose, SIGHT: SIGHT, solveSight: solveSight, CLEAN_MAX: CLEAN_MAX };
})();
