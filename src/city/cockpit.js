/* ============================================================
   city/cockpit.js — THE COCKPIT GRAMMAR. One vocabulary of eight parts
   that every airframe in the game dresses differently, plus — the part
   that actually matters — THE GENERATOR that writes the dressing for you.

   OWNER ASK: "You Opus subagents need to redraw a lot of shit like water
   and COCKPITS IN PLANES." Flying here already has a real aero core (lift,
   stall, ground effect, ETL, three flight classes). What was missing was
   being INSIDE the aircraft: instruments reading the live flight state the
   physics already computes, a canopy frame you see past, controls that move
   with your hands, an airframe around your shoulders.

   ------------------------------------------------------------------
   WHY THIS IS A GENERATOR AND NOT A FORM  (CLAUDE.md, THE BLOCK LAW)
   ------------------------------------------------------------------
   The predator domain just learned this the hard way and it is now law:
   *shipping the thing that WRITES the config matters more than the
   framework*. Three consumers refused a system whose entry cost was
   hand-writing 25-37 tuning numbers.

   A cockpit needs ~40 numbers (eye point, panel size/tilt/distance,
   glareshield depth, canopy bows, console boxes, stick throw, seat rails,
   palette...). If an airframe had to write them, no airframe ever would.
   So NO AIRFRAME WRITES ANY OF THEM. `CBZ.cockpitSpec(craft)` DERIVES the
   whole spec from things the craft ALREADY has:

     craft.airClass                  → which of the five cockpit costumes
     craft.displayName               → bomber/attack detection
     craft.group bounding box        → length / span / height
     craft.group.userData.pilot      → the EXACT eye point (the cosmetic
                                       pilot silhouette's head mesh — it
                                       has been sitting there all along)
     craft.group.userData.canopy     → fallback eye point + glass extent
     craft.group.userData.belly      → floor reference
     craft.armed / craft.maxAmmo     → whether stores pages exist
     craft.modelYawOffset            → nose-along-+X models (airport meshes)

   ADOPTION COST FOR A NEW AIRFRAME: **zero lines.** It flies, it gets a
   cockpit. An airframe that wants to differ writes a PARTIAL override at
   `craft.group.userData.cockpit = { panel: { dist: 0.8 } }` — one to three
   lines, never forty. Every field is deep-merged over the derived spec,
   and a missing/garbage value falls back to the derived one.

   ------------------------------------------------------------------
   THE EIGHT NOUNS (the grammar — city/cockpit_shapes.js builds them)
   ------------------------------------------------------------------
     1 TUB          floor + sidewalls + rear bulkhead — you sit IN something
     2 GLARESHIELD  the hood over the panel. The single most load-bearing
                    part: a dark horizontal mass across the top of the view
                    is what tells the brain "I am inside an enclosure".
     3 PANEL        the instrument face (a live canvas texture)
     4 CANOPY FRAME bows, rails, windscreen post — the STRUCTURE, not the
                    glass (the aircraft model already owns its glass)
     5 CONSOLES     side consoles / centre pedestal / overhead strip
     6 CONTROLS     stick·yoke·cyclic, throttle·collective·quadrant, pedals
     7 SEAT         pan, headrest, shoulder rails at the vision edge
     8 HUD PANE     combiner glass (fighter/bomber only)

   Five costumes: fighter · heli · airliner · bomber · prop. A sixth costs
   one row in CLASS below plus one layout in cockpit_panel.js — not a system.

   ------------------------------------------------------------------
   WHY THE INSTRUMENTS ARE NOT A HUD DOCTRINE VIOLATION
   ------------------------------------------------------------------
   CLAUDE.md: the only sanctioned screen-space popup is the killfeed. It is
   right. Nothing here is screen-space. These pixels live on a MESH inside
   the aircraft: they tilt away when you look off-axis, the canopy bow
   occludes them, they dim at dusk and light up at night. You read them by
   LOOKING DOWN, exactly like the real thing. That is the distinction —
   diegetic instruments are furniture, not UI.

   ------------------------------------------------------------------
   FILE SPLIT
   ------------------------------------------------------------------
     city/cockpit.js         (this)  spec generator · live flight-state feed
                                     · canvas/texture ownership · control
                                     animation · the per-frame tick
     city/cockpit_shapes.js          pure geometry: spec → THREE.Group
     city/cockpit_panel.js           pure 2D: the instrument faces + layouts
     city/cockpit_view.js            the seat: eye placement, head physics,
                                     the near-plane overlay pass, [V] toggle

   LOAD ORDER: cockpit_panel.js and cockpit_shapes.js must both parse BEFORE
   this file; this file must parse AFTER playeraircraft.js (it reads craft
   shapes and CBZ.aircraftSurfaceY). cockpit_view.js loads last of the four.

   EVERY NUMBER ON THE GLASS COMES FROM THE FLIGHT MODEL. Attitude is read
   off the craft's REAL world matrix (not its intent variables), so the
   artificial horizon can never disagree with the horizon you see out of
   the window — the classic sim bug, designed out rather than tuned out.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;

  // ---- CONFIG ------------------------------------------------------------
  // Self-defaulted here (this file owns them); src/config.js should carry a
  // one-line pointer comment for discoverability. `?cfg_COCKPIT_V1=0` in the
  // URL disables the whole domain before boot, with zero code changes.
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});
  // COCKPIT_V1 (city/cockpit*.js) — the diegetic aircraft interior: instrument
  // panel, canopy frame, seat, moving controls, and the first-person seat view.
  // OFF → nothing is built or ticked and flying is byte-identical to before.
  if (CFG.COCKPIT_V1 == null) CFG.COCKPIT_V1 = true;
  // COCKPIT_PANEL_HZ — instrument repaint rate. The static furniture (bezels,
  // arcs, legends, numerals) is painted ONCE per cockpit class and blitted;
  // only needles/tapes/horizons redraw at this rate. 18Hz reads as continuous
  // on a gauge needle and costs ~1/3 of a per-frame repaint.
  if (CFG.COCKPIT_PANEL_HZ == null) CFG.COCKPIT_PANEL_HZ = 18;
  // COCKPIT_SCALE — this game's people are slightly larger than life
  // (fpsmode eye height 2.05m vs a real 1.7m), so a real-world 0.71m
  // eye-to-panel distance reads cramped. One scalar, applied to every derived
  // length, keeps the whole grammar in the game's proportions.
  if (CFG.COCKPIT_SCALE == null) CFG.COCKPIT_SCALE = 1.15;

  function on() { return CFG.COCKPIT_V1 !== false; }

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const MPS_KT = 1.94384, M_FT = 3.28084, MPS_FPM = 196.850;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fin(v, d) { const n = +v; return Number.isFinite(n) ? n : d; }

  // ============================================================
  //  COCKPIT CLASSES — the five costumes. Everything here is a RATIO or a
  //  human-scale length, never an airframe-specific number, because the
  //  generator below multiplies them by what it measures off the model.
  //
  //  Real-world anchors these ratios are calibrated to (see the research
  //  notes in the domain report): the 1947 Armed Forces-NRC design-eye
  //  standard puts the pilot's eye ~0.71 m from the main instrument panel
  //  on fixed-wing types; helicopters sit closer (the standard explicitly
  //  exempts rotary-wing); a HUD combiner sits 0.30-0.40 m out; side
  //  consoles land 0.45-0.55 m to each side (arm's reach).
  // ============================================================
  const CLASS = {
    fighter: {
      layout: "fighter",
      // `h` is DERIVED from the layout's canvas aspect (see the generator) —
      // the value here is only a fallback if the layout goes missing.
      panel: { w: 0.98, h: 0.37, dist: 0.72, drop: 0.34, tilt: 0.30 },
      glare: { depth: 0.20, rise: 0.10, w: 0.98 },
      tub: { w: 1.02, h: 1.30, d: 1.70, floorDrop: 1.02 },
      // fighters get a frameless-ish bubble: ONE overhead bow, NO centre post
      frame: { railY: 0.30, railHalfW: 0.50, bows: 1, bowR: 0.035, postW: 0, windscreenTilt: 0.62 },
      consoleL: { w: 0.24, h: 0.20, d: 0.72, x: -0.50, y: -0.44, z: 0.28 },
      consoleR: { w: 0.24, h: 0.20, d: 0.72, x: 0.50, y: -0.44, z: 0.28 },
      pedestal: null,
      overhead: null,
      stick: { type: "center", x: 0, y: -0.62, z: 0.30, len: 0.34, throwDeg: 15 },
      lever: { type: "throttle", x: -0.46, y: -0.36, z: 0.34, len: 0.24, throwDeg: 38 },
      pedals: { x: 0, y: -0.92, z: 0.86, sep: 0.24, travel: 0.075 },
      seat: { w: 0.56, h: 0.72, d: 0.24, backDrop: 0.62, railH: 0.34 },
      hud: { w: 0.40, h: 0.34, dist: 0.40, drop: 0.06 },
      pal: { hull: 0x22262b, trim: 0x14171b, panelTop: 0x1b2027, panelBot: 0x0e1116,
             bezel: 0x2a323c, dialFace: 0x0b0d10, ink: 0xc8d4e0, backlight: 0x2f6b4a },
    },
    heli: {
      layout: "heli",
      // a helicopter panel is LOW and NARROW on purpose — you fly by looking
      // OVER it and down through the chin bubble, which is why a police
      // chopper reads as a helicopter from the seat and nothing else does.
      panel: { w: 1.02, h: 0.34, dist: 0.78, drop: 0.46, tilt: 0.16 },
      glare: { depth: 0.10, rise: 0.05, w: 1.06 },
      tub: { w: 1.36, h: 1.42, d: 1.62, floorDrop: 1.06 },
      // greenhouse: two door pillars at the shoulders, no overhead bow arch
      frame: { railY: 0.44, railHalfW: 0.66, bows: 2, bowR: 0.030, postW: 0.05, windscreenTilt: 0.48 },
      consoleL: { w: 0.20, h: 0.16, d: 0.52, x: -0.58, y: -0.52, z: 0.16 },
      consoleR: { w: 0.20, h: 0.16, d: 0.52, x: 0.58, y: -0.52, z: 0.16 },
      pedestal: { w: 0.26, h: 0.30, d: 0.44, x: 0, y: -0.60, z: 0.46 },
      overhead: { w: 0.86, d: 0.36, drop: 0.06 },
      stick: { type: "cyclic", x: 0, y: -0.70, z: 0.26, len: 0.40, throwDeg: 14 },
      lever: { type: "collective", x: -0.50, y: -0.64, z: 0.02, len: 0.44, throwDeg: 32 },
      pedals: { x: 0, y: -0.96, z: 0.92, sep: 0.26, travel: 0.085 },
      seat: { w: 0.58, h: 0.62, d: 0.22, backDrop: 0.60, railH: 0.24 },
      hud: null,
      pal: { hull: 0x2b2f33, trim: 0x191c20, panelTop: 0x232830, panelBot: 0x12151a,
             bezel: 0x39414b, dialFace: 0x0b0d10, ink: 0xd6dee8, backlight: 0x3a6f8c },
    },
    airliner: {
      layout: "airliner",
      panel: { w: 1.52, h: 0.52, dist: 0.86, drop: 0.44, tilt: 0.22 },
      // the 737-style glareshield is a real physical SHELF carrying the mode
      // control panel — deep, and it casts the shadow line that reads "deck"
      glare: { depth: 0.34, rise: 0.16, w: 1.72 },
      tub: { w: 2.10, h: 1.55, d: 2.05, floorDrop: 1.10 },
      frame: { railY: 0.42, railHalfW: 0.92, bows: 2, bowR: 0.045, postW: 0.11, windscreenTilt: 0.40 },
      consoleL: { w: 0.26, h: 0.22, d: 0.66, x: -0.86, y: -0.48, z: 0.20 },
      consoleR: null,
      pedestal: { w: 0.40, h: 0.44, d: 0.80, x: 0.44, y: -0.56, z: 0.28 },
      overhead: { w: 1.30, d: 0.56, drop: 0.02 },
      stick: { type: "yoke", x: 0, y: -0.50, z: 0.52, len: 0.30, throwDeg: 22 },
      lever: { type: "quadrant", x: 0.44, y: -0.42, z: 0.30, len: 0.26, throwDeg: 40 },
      pedals: { x: 0, y: -1.00, z: 1.00, sep: 0.30, travel: 0.080 },
      seat: { w: 0.62, h: 0.68, d: 0.26, backDrop: 0.64, railH: 0.20 },
      hud: null,
      pal: { hull: 0x4a4c47, trim: 0x2a2c29, panelTop: 0x2b3038, panelBot: 0x14181e,
             bezel: 0x3d444d, dialFace: 0x080b0f, ink: 0xdfe6ee, backlight: 0x6a7a55 },
    },
    bomber: {
      layout: "bomber",
      // heads-down by design and deliberately dark: the B-2's cockpit lighting
      // is kept low so nothing shows from outside. Small faceted windows.
      panel: { w: 1.10, h: 0.46, dist: 0.76, drop: 0.40, tilt: 0.26 },
      glare: { depth: 0.32, rise: 0.14, w: 1.24 },
      tub: { w: 1.80, h: 1.36, d: 1.90, floorDrop: 1.06 },
      frame: { railY: 0.34, railHalfW: 0.80, bows: 3, bowR: 0.050, postW: 0.14, windscreenTilt: 0.72 },
      consoleL: { w: 0.26, h: 0.20, d: 0.70, x: -0.70, y: -0.46, z: 0.24 },
      consoleR: { w: 0.26, h: 0.20, d: 0.70, x: 0.70, y: -0.46, z: 0.24 },
      pedestal: { w: 0.30, h: 0.34, d: 0.50, x: 0, y: -0.62, z: 0.42 },
      overhead: { w: 1.00, d: 0.40, drop: 0.04 },
      stick: { type: "side", x: 0.42, y: -0.44, z: 0.30, len: 0.26, throwDeg: 13 },
      lever: { type: "quadrant", x: -0.42, y: -0.40, z: 0.30, len: 0.24, throwDeg: 36 },
      pedals: { x: 0, y: -0.96, z: 0.94, sep: 0.28, travel: 0.070 },
      seat: { w: 0.60, h: 0.74, d: 0.26, backDrop: 0.62, railH: 0.32 },
      hud: { w: 0.34, h: 0.28, dist: 0.42, drop: 0.10 },
      pal: { hull: 0x15181b, trim: 0x0a0c0e, panelTop: 0x111519, panelBot: 0x07090b,
             bezel: 0x1c2126, dialFace: 0x03080a, ink: 0x5ce08a, backlight: 0x1d5c38 },
    },
    prop: {
      layout: "prop",
      panel: { w: 1.06, h: 0.58, dist: 0.72, drop: 0.36, tilt: 0.12 },
      glare: { depth: 0.12, rise: 0.06, w: 1.14 },
      tub: { w: 1.24, h: 1.34, d: 1.62, floorDrop: 1.02 },
      frame: { railY: 0.36, railHalfW: 0.60, bows: 2, bowR: 0.038, postW: 0.09, windscreenTilt: 0.52 },
      consoleL: null,
      consoleR: null,
      pedestal: { w: 0.24, h: 0.26, d: 0.40, x: 0, y: -0.58, z: 0.44 },
      overhead: null,
      stick: { type: "yoke", x: -0.24, y: -0.44, z: 0.50, len: 0.26, throwDeg: 24 },
      lever: { type: "knob", x: 0.10, y: -0.40, z: 0.56, len: 0.16, throwDeg: 0 },
      pedals: { x: 0, y: -0.90, z: 0.86, sep: 0.24, travel: 0.070 },
      seat: { w: 0.56, h: 0.58, d: 0.22, backDrop: 0.58, railH: 0.16 },
      hud: null,
      pal: { hull: 0x6d6455, trim: 0x3a352c, panelTop: 0x2e2a22, panelBot: 0x171410,
             bezel: 0x4a453a, dialFace: 0x0b0d10, ink: 0xe6e2d6, backlight: 0x8a6a2f },
    },
  };
  // reference airframe LENGTH (m) each costume was proportioned against —
  // used only for the gentle size ramp below, never as a hard requirement.
  const CLASS_REF_LEN = { fighter: 14, heli: 11, airliner: 37, bomber: 21, prop: 9 };

  // ============================================================
  //  CLASSIFY — which costume does this craft wear?
  //  craft.airClass already exists (playeraircraft.js sets it at spawn:
  //  "heli" | "jet" | "prop" | "airliner"). The one thing it can't tell us
  //  is bomber-vs-fighter, because both are airClass "jet" — so the name
  //  and the presence of a bomb bay break the tie. No new field, no table.
  // ============================================================
  const BOMBER_RE = /\b(B-?2|B2|SPIRIT|BOMBER|LANCER|B-?1|B-?52)\b/i;
  function classOf(craft) {
    if (!craft) return "prop";
    const ud = (craft.group && craft.group.userData) || {};
    if (ud.cockpitClass && CLASS[ud.cockpitClass]) return ud.cockpitClass;   // explicit override, 1 line
    const ac = craft.airClass;
    if (ac === "heli") return "heli";
    if (ac === "airliner") return "airliner";
    const name = String(craft.displayName || ud.milKind || "");
    if (BOMBER_RE.test(name) || ud.bombBay || ud.bayDoors) return "bomber";
    if (ac === "prop") return "prop";
    return "fighter";                                    // airClass "jet"
  }
  CBZ.cockpitClassOf = classOf;

  // ============================================================
  //  MEASURE — the airframe's own geometry, in MODEL-LOCAL space.
  //  Box3.setFromObject() would give a world AABB of a rotated, flying
  //  object (useless). This walks the meshes and unions their geometry
  //  bounds through each mesh's matrix RELATIVE TO the craft group, so the
  //  numbers are stable whatever attitude the aircraft is in.
  //  Cockpit geometry itself is skipped (userData.cockpit) so a second
  //  measure after attaching can never feed back on itself.
  // ============================================================
  const _mb = new THREE.Box3(), _tb = new THREE.Box3(), _mm = new THREE.Matrix4(), _mi = new THREE.Matrix4();
  function measure(grp) {
    _mb.makeEmpty();
    grp.updateWorldMatrix(true, true);
    _mi.copy(grp.matrixWorld).invert();
    grp.traverse(function (o) {
      if (!o.isMesh || !o.geometry) return;
      if (o.userData && o.userData.cockpit) return;
      if (o.visible === false && o.userData && o.userData.pilot) return;
      const g2 = o.geometry;
      if (!g2.boundingBox) { try { g2.computeBoundingBox(); } catch (e) { return; } }
      if (!g2.boundingBox) return;
      _tb.copy(g2.boundingBox);
      _mm.copy(_mi).multiply(o.matrixWorld);
      _tb.applyMatrix4(_mm);
      if (Number.isFinite(_tb.min.x) && Number.isFinite(_tb.max.x)) _mb.union(_tb);
    });
    if (_mb.isEmpty()) return { len: 10, span: 8, hgt: 3, minY: -1, maxY: 2, minZ: -5, maxZ: 5, minX: -4, maxX: 4, ok: false };
    const dx = _mb.max.x - _mb.min.x, dz = _mb.max.z - _mb.min.z;
    return {
      len: Math.max(dx, dz), span: Math.min(dx, dz), hgt: _mb.max.y - _mb.min.y,
      minY: _mb.min.y, maxY: _mb.max.y, maxZ: _mb.max.z, minZ: _mb.min.z,
      maxX: _mb.max.x, minX: _mb.min.x, ok: true,
    };
  }

  // ============================================================
  //  EYE POINT — the one number everything else hangs off, and the one the
  //  repo has quietly been carrying for months without anyone using it.
  //
  //  Every purpose-built craft already has a cosmetic PILOT SILHOUETTE
  //  (playeraircraft.js buildHeli/buildJet: a torso, a head, a stick) that
  //  is shown while you fly so the thing looks crewed from outside. That
  //  head mesh IS the eye point. We read it. No airframe writes a seat
  //  offset; the artist already placed one and didn't know it.
  //
  //  Fallbacks, in order: pilot head → canopy glass centre → bounding box.
  //  Returned in the CANONICAL frame (+Z nose), i.e. after undoing any
  //  modelYawOffset, so every downstream number speaks one language.
  // ============================================================
  const _ev = new THREE.Vector3();
  // HIGHEST-PRIORITY SOURCE: a real modelled crew seat. The airport airliner
  // (island_airport.js buildCabin) already publishes a seat table on
  // `group.userData.cabin.seats` containing `seat-captain` / `seat-firstofficer`
  // with `cockpit: true` — real anchors, at real positions, that the NPC life
  // system already sits pilots in. If an airframe has modelled a captain's
  // chair, the pilot's eye belongs above that chair and nowhere else.
  function eyeFromSeat(grp, off, sc) {
    const cab = grp.userData && grp.userData.cabin;
    const seats = cab && cab.seats;
    if (!seats || !seats.length) return null;
    let best = null;
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      if (!s || !s.cockpit) continue;
      if (!Number.isFinite(+s.x) || !Number.isFinite(+s.y) || !Number.isFinite(+s.z)) continue;
      // the captain's seat is the left-hand one; prefer it, else take any
      // cockpit seat we can find
      if (!best || /captain/i.test(String(s.id || "")) || String(s.role || "") === "pilot") best = s;
      if (/captain/i.test(String(s.id || ""))) break;
    }
    if (!best) return null;
    // the seat anchor sits ON the cushion (cushionH above the deck); a seated
    // human's eyes are about 0.72 m above the cushion at this game's scale.
    const c = toCanonical(+best.x, +best.y + 0.72 * sc, +best.z, off);
    c.z += 0.10 * sc;          // eyes sit forward of the spine
    return c;
  }
  function eyeFromPilot(grp, off) {
    const pilot = grp.userData && grp.userData.pilot;
    if (!pilot) return null;
    // the head is the highest mesh in the silhouette
    let head = null, bestY = -Infinity;
    pilot.traverse(function (o) {
      if (!o.isMesh) return;
      const y = o.position ? o.position.y : 0;
      if (y > bestY) { bestY = y; head = o; }
    });
    if (!head) return null;
    _ev.set(0, 0, 0);
    head.updateWorldMatrix(true, false);
    _ev.setFromMatrixPosition(head.matrixWorld);
    grp.updateWorldMatrix(true, false);
    grp.worldToLocal(_ev);
    // eyes sit a touch above the head-box centre and forward of it
    return toCanonical(_ev.x, _ev.y + 0.05, _ev.z + 0.09, off);
  }
  function eyeFromCanopy(grp, off) {
    const c = grp.userData && grp.userData.canopy;
    if (!c || !c.position) return null;
    let h = 0.9, d = 1.8;
    if (c.geometry) {
      if (!c.geometry.boundingBox) { try { c.geometry.computeBoundingBox(); } catch (e) {} }
      const bb = c.geometry.boundingBox;
      if (bb) { h = bb.max.y - bb.min.y; d = Math.max(bb.max.z - bb.min.z, bb.max.x - bb.min.x); }
    }
    // the pilot's head sits low in the bubble and slightly aft of its centre
    return toCanonical(c.position.x, c.position.y - h * 0.20, c.position.z - d * 0.14, off);
  }
  // model-local (x,y,z) → canonical (+Z nose). Undoes the model yaw offset
  // exactly the way setCraftRotation() composes it (playeraircraft.js:728).
  function toCanonical(x, y, z, off) {
    if (!off) return { x: x, y: y, z: z };
    const c = Math.cos(-off), s = Math.sin(-off);
    return { x: x * c - z * s, y: y, z: x * s + z * c };
  }

  // ============================================================
  //  THE GENERATOR. Airframes call nothing; this reads them.
  // ============================================================
  function deepMerge(base, over) {
    if (!over || typeof over !== "object") return base;
    for (const k in over) {
      const v = over[k];
      if (v == null) continue;
      if (typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") deepMerge(base[k], v);
      else base[k] = v;
    }
    return base;
  }
  function scaleBlock(b, s) {
    if (!b) return b;
    for (const k in b) if (typeof b[k] === "number" && k !== "tilt" && k !== "throwDeg" && k !== "windscreenTilt" && k !== "bows") b[k] *= s;
    return b;
  }

  CBZ.cockpitSpec = function (craft) {
    const id = classOf(craft);
    const C = CLASS[id];
    const grp = craft && craft.group;
    const off = (craft && craft.modelYawOffset) || 0;
    // No group at all (the audit's synthetic probes, or a craft mid-teardown):
    // fall back to the costume's own reference envelope so the generator still
    // produces a complete, finite spec rather than propagating undefined.
    const refL = CLASS_REF_LEN[id] || 12;
    const dim = grp ? measure(grp) : {
      len: refL, span: refL * 0.75, hgt: refL * 0.26,
      minY: -refL * 0.10, maxY: refL * 0.16,
      minZ: -refL * 0.5, maxZ: refL * 0.5, minX: -refL * 0.5, maxX: refL * 0.5, ok: false,
    };

    // ---- SIZE. A cockpit is human-sized: a 737 flight deck is roomier than
    // an F-16's, but it is NOT four times bigger just because the aeroplane
    // is. So the ramp is a quarter-power of the length ratio and hard-clamped
    // — the difference between airframes shows in CLEARANCE, not in scale.
    const ratio = dim.len / (CLASS_REF_LEN[id] || 12);
    const sc = fin(CFG.COCKPIT_SCALE, 1.15) * clamp(Math.pow(Math.max(0.2, ratio), 0.25), 0.86, 1.32);

    // ---- EYE. Read from what the artist already placed, best source first.
    let eyeSource = "bbox";
    let eye = grp ? eyeFromSeat(grp, off, sc) : null;
    if (eye) eyeSource = "seat";
    if (!eye && grp) { eye = eyeFromPilot(grp, off); if (eye) eyeSource = "pilot"; }
    if (!eye && grp) { eye = eyeFromCanopy(grp, off); if (eye) eyeSource = "canopy"; }
    if (!eye) {
      // last resort: sit high and well forward inside the measured envelope.
      // In canonical space the nose is +Z, so "forward" is toward maxZ — but
      // when the model is nose-along-+X the measured extents are swapped,
      // which is why we ask for the canonical conversion of the raw corner.
      const fwdLocal = off ? { x: dim.maxX, z: 0 } : { x: 0, z: dim.maxZ };
      const c = toCanonical(fwdLocal.x * 0.62, dim.minY + dim.hgt * 0.74, fwdLocal.z * 0.62, off);
      eye = c;
      // helicopters and props sit right up in the nose; jets sit further aft
      eye.z *= (id === "heli" || id === "prop") ? 1.06 : 0.92;
    }

    const spec = {
      id: id, layout: C.layout, cls: id,
      eye: { x: fin(eye.x, 0), y: fin(eye.y, 1), z: fin(eye.z, 1) },
      eyeSource: eyeSource,
      scale: sc,
      airframe: { len: dim.len, span: dim.span, hgt: dim.hgt },
      panel: scaleBlock(Object.assign({}, C.panel), sc),
      glare: scaleBlock(Object.assign({}, C.glare), sc),
      tub: scaleBlock(Object.assign({}, C.tub), sc),
      frame: scaleBlock(Object.assign({}, C.frame), sc),
      consoleL: scaleBlock(C.consoleL && Object.assign({}, C.consoleL), sc),
      consoleR: scaleBlock(C.consoleR && Object.assign({}, C.consoleR), sc),
      pedestal: scaleBlock(C.pedestal && Object.assign({}, C.pedestal), sc),
      overhead: scaleBlock(C.overhead && Object.assign({}, C.overhead), sc),
      stick: scaleBlock(Object.assign({}, C.stick), sc),
      lever: scaleBlock(C.lever && Object.assign({}, C.lever), sc),
      pedals: scaleBlock(C.pedals && Object.assign({}, C.pedals), sc),
      seat: scaleBlock(Object.assign({}, C.seat), sc),
      hud: scaleBlock(C.hud && Object.assign({}, C.hud), sc),
      pal: Object.assign({}, C.pal),
      armed: !!(craft && craft.armed && craft.maxAmmo > 0),
      name: (craft && craft.displayName) || "",
      // MINIMAL DRESSING — don't build a shell inside a shell. The airport
      // airliner already has a REAL cockpit room modelled around that captain's
      // chair: a lined shell, front and side windows, a console block and a
      // bulkhead door (island_airport.js buildCabin). Adding our own tub and
      // canopy frame on top of it would put two floors and two windscreens in
      // the same volume. When the airframe brought its own room we dress only
      // what it is missing — the live instrument panel, the glareshield over
      // it, and the controls — and let the existing geometry be the cockpit.
      minimal: !!(grp && grp.userData && grp.userData.cabin && grp.userData.cabin.cockpitLeaf),
    };
    if (spec.minimal) { spec.tub = null; spec.frame = null; spec.overhead = null; spec.seat = null; }
    // `type` strings must survive scaleBlock (it only touches numbers) —
    // re-assert them so a future refactor can't silently mangle a costume.
    spec.stick.type = C.stick.type;
    if (spec.lever) spec.lever.type = C.lever.type;

    // ---- PANEL ASPECT. The instrument face is a bitmap, and a bitmap on a
    // plane of the wrong proportion is a stretched bitmap. The LAYOUT owns
    // its canvas size (cockpit_panel.js declares one per class), so the panel
    // MESH takes its height from that rather than from a second number the
    // costume author would have to keep in sync by hand. Width is authored
    // (it decides how much of your view the panel fills); height follows.
    const psz = CBZ.cockpitLayoutSize ? CBZ.cockpitLayoutSize(spec.layout) : { w: 1024, h: 384 };
    const aspect = (psz.w > 0 && psz.h > 0) ? psz.w / psz.h : 2.667;
    spec.panel.h = spec.panel.w / aspect;
    // same rule for the head-up combiner, against its own fixed canvas
    if (spec.hud) spec.hud.h = spec.hud.w * (HUD_CANVAS.h / HUD_CANVAS.w);

    // ---- HANDEDNESS, resolved once, here.
    // The CLASS table above is authored the way an aviator reads a drawing:
    // +X is the pilot's RIGHT. Geometrically in this scene it is not. An
    // observer facing +Z with +Y up has their right hand at -X (right =
    // forward × up; check it against the stock camera, which looks down -Z
    // and has its right at +X). Rather than make every future costume author
    // hold that in their head — and get it wrong, which is exactly what
    // happened to this repo's own nav lights, where the green starboard lamp
    // sits at +X on a +Z-nose model — the table stays readable and the sign
    // is flipped exactly once, right here.
    // Negating x is the WHOLE fix — do not also swap the two console objects.
    // After the flip, the block authored at x = -0.5 ("left" in the aviator's
    // reading) already sits at +0.5, which IS the pilot's left; swapping the
    // handles on top of that would put it straight back on his right.
    ["stick", "lever", "pedestal", "consoleL", "consoleR"].forEach(function (k) {
      if (spec[k] && Number.isFinite(+spec[k].x)) spec[k].x = -spec[k].x;
    });
    // cockpit_shapes places pedalL at (x - sep/2). A negative separation puts
    // that group on +X, i.e. under the pilot's LEFT foot, so the name stays
    // honest and right rudder still pushes the right pedal forward.
    if (spec.pedals && Number.isFinite(+spec.pedals.sep)) spec.pedals.sep = -Math.abs(spec.pedals.sep);

    // ---- the ONE-TO-THREE-LINE airframe override. A partial object at
    // group.userData.cockpit is deep-merged last, so an airframe that wants a
    // taller glareshield writes `{ glare: { rise: 0.22 } }` and inherits the
    // other thirty-nine numbers. Nothing is required; nothing is validated
    // away — a bad value simply loses to the derived one below.
    const ovr = grp && grp.userData && grp.userData.cockpit;
    if (ovr && typeof ovr === "object") deepMerge(spec, ovr);

    // ---- final sanity sweep: a NaN anywhere would silently produce an
    // invisible cockpit that is very hard to debug. Fix it here, once.
    sanitize(spec, CLASS[id]);
    return spec;
  };

  function sanitize(spec, C) {
    function fix(o, ref) {
      if (!o || !ref) return;
      for (const k in ref) {
        if (typeof ref[k] === "number" && !Number.isFinite(+o[k])) o[k] = ref[k];
      }
    }
    ["panel", "glare", "tub", "frame", "stick", "lever", "pedals", "seat", "hud",
     "consoleL", "consoleR", "pedestal", "overhead"].forEach(function (k) { fix(spec[k], C[k]); });
    ["x", "y", "z"].forEach(function (k) { if (!Number.isFinite(+spec.eye[k])) spec.eye[k] = 0; });
    if (spec.frame) spec.frame.bows = clamp(Math.round(fin(spec.frame.bows, 2)), 0, 4);
    if (!Number.isFinite(+spec.scale) || spec.scale <= 0) spec.scale = 1;
  }

  // ============================================================
  //  LIVE FLIGHT STATE — the feed. Everything the glass shows is read from
  //  the running simulation; nothing is invented, nothing is decorative.
  //
  //  ATTITUDE IS READ OFF THE WORLD MATRIX, NOT off craft.pitch/craft.roll.
  //  That is deliberate and it is the whole reason the horizon can be
  //  trusted: craft.pitch/roll are the flight model's INTENT variables and
  //  they pass through setCraftRotation(), a model-yaw offset and a
  //  quaternion composition before they become the attitude you actually
  //  see out of the canopy. Deriving the ADI from the same matrix that
  //  positions your eye makes "the instrument disagrees with the window" —
  //  the classic flight-sim bug — structurally impossible rather than
  //  something to be tuned back into agreement later.
  // ============================================================
  const _px = new THREE.Vector3(), _py = new THREE.Vector3(), _pz = new THREE.Vector3();
  const _state = {};

  CBZ.cockpitFlightState = function (craft, out) {
    const S = out || _state;
    if (!craft) return S;
    const rec = craft._cockpit || null;
    const anchor = rec && rec.anchor;
    const src = anchor || craft.group;

    // ---- attitude from the live matrix ---------------------------------
    let pitchDeg = 0, bankRad = 0, hdgDeg = 0;
    if (src) {
      src.updateWorldMatrix(true, false);
      const e = src.matrixWorld.elements;
      _px.set(e[0], e[1], e[2]).normalize();     // model right  (+X)
      _py.set(e[4], e[5], e[6]).normalize();     // model up     (+Y)
      _pz.set(e[8], e[9], e[10]).normalize();    // model nose   (+Z, canonical via the anchor)
      pitchDeg = Math.asin(clamp(_pz.y, -1, 1)) * R2D;
      // aviation bank: positive = RIGHT wing down. A positive roll about the
      // model's +Z axis lifts the right wing, so the sign flips here once and
      // never again.
      bankRad = -Math.atan2(_px.y, _py.y || 1e-6);
      // compass with -Z = north (the scene convention): nose swinging from
      // -Z toward +X increases the heading, i.e. a right turn counts up.
      hdgDeg = (Math.atan2(_pz.x, -_pz.z) * R2D + 360) % 360;
    }

    // ---- speeds / altitudes --------------------------------------------
    const tas = Math.abs(fin(craft.airspeed, fin(craft.speed, 0)));
    const y = (craft.pos && craft.pos.y) || 0;
    let surf = 0;
    if (CBZ.aircraftSurfaceY && craft.pos) {
      try { surf = fin(CBZ.aircraftSurfaceY(craft.pos.x, craft.pos.z), 0); } catch (e) { surf = 0; }
    }
    const vy = fin(craft.vy, 0);

    // ---- load factor: a level turn pulls 1/cos(bank); vertical acceleration
    // adds the rest. Smoothed, because a raw per-frame difference of vy is
    // pure noise on a gauge the player is trying to read.
    const now = CBZ.now || 0;
    const dtG = rec ? Math.max(0.001, (now - (rec._gT || now)) / 1000) : 0.016;
    let gRaw = 1 / Math.max(0.18, Math.cos(clamp(bankRad, -1.45, 1.45)));
    if (rec) {
      gRaw += (vy - fin(rec._gVy, vy)) / dtG / 9.81;
      rec._gVy = vy; rec._gT = now;
      rec.g = fin(rec.g, 1) + (clamp(gRaw, -3, 11) - fin(rec.g, 1)) * Math.min(1, dtG * 6);
    }

    // ---- slip/skid: a coordinated turn balances the yaw rate against the
    // bank. The ball sits centre when they agree and swings to the low wing
    // when they do not — the same physics the real instrument measures.
    let slip = 0;
    if (rec && tas > 4) {
      let dh = hdgDeg - fin(rec._hPrev, hdgDeg);
      while (dh > 180) dh -= 360;
      while (dh < -180) dh += 360;
      const yawRate = (dh * D2R) / dtG;
      slip = clamp((Math.tan(clamp(bankRad, -1.2, 1.2)) - yawRate * tas / 9.81) * 0.6, -1, 1);
      rec._hPrev = hdgDeg;
      rec.slip = fin(rec.slip, 0) + (slip - fin(rec.slip, 0)) * Math.min(1, dtG * 5);
      slip = rec.slip;
    }

    // ---- rotor / engine (helicopter). rotorRate is the eased spin-up the
    // flight model already keeps; autorotation drops the engine needle away
    // from the rotor needle, which is exactly what the married needles are
    // FOR — the split IS the emergency.
    const rotorRate = clamp(fin(craft.rotorRate, craft.onGround ? 0 : 1), 0, 1.2);
    const auto = !!craft.autorotating;
    const thr01 = craft.thr != null ? clamp(fin(craft.thr, 0), 0, 1)
      : clamp((fin(craft.throttle, 0) - 38) / 82, 0, 1);

    S.ias = tas * MPS_KT;
    S.gs = S.ias;
    S.mach = tas / 340.3;
    S.alt = y * M_FT;
    S.agl = Math.max(0, y - surf) * M_FT;
    S.vsi = vy * MPS_FPM;
    S.hdg = hdgDeg;
    S.pitch = pitchDeg;
    S.roll = bankRad;
    S.aoa = fin(craft.aoa, 0);
    S.slip = slip;
    S.slipDeg = slip * 8;
    S.g = rec ? fin(rec.g, 1) : 1;
    S.thr = thr01;
    S.rpm = clamp(0.18 + thr01 * 0.72, 0, 1);
    S.rotor = auto ? clamp(rotorRate * 0.94, 0, 1.2) : rotorRate;
    S.ng = auto ? 0.12 : clamp(0.62 + thr01 * 0.42, 0, 1.2);
    S.torque = auto ? 0.05 : clamp(0.15 + thr01 * 0.85, 0, 1.2);
    S.fuel = clamp(fin(craft.fuel, 1), 0, 1);
    S.hp = craft.maxHp > 0 ? clamp(craft.hp / craft.maxHp, 0, 1) : 1;
    S.ammo = fin(craft.ammo, 0);
    S.maxAmmo = fin(craft.maxAmmo, 0);
    S.vne = 999;
    if (craft.perfVmax) S.vne = craft.perfVmax * MPS_KT * 0.97;
    S.stalled = !!craft.stalled;
    S.onGround = !!craft.onGround;
    S.autorotating = auto;
    // GEAR: the flight model never stored a flag — it derives wheel
    // visibility from AGL inline. Read the same truth rather than inventing
    // a second one (a light that lies is worse than no light).
    const gearMesh = craft.group && craft.group.userData && craft.group.userData.gear;
    S.gear = gearMesh ? !!gearMesh.visible : (Math.max(0, y - surf) < 9);
    S.bayOpen = !!(craft.group && craft.group.userData &&
      (craft.group.userData.bayOpen || (craft.group.userData.bay && craft.group.userData.bay.open)));
    // real lock state from the shared lock-on bus (systems/lockon.js) — the
    // same acquisition the missiles actually fly at. A LOCK cue that lights
    // without a lock is exactly the decorative gauge this file forbids.
    S.lock = !!(CBZ.lockonTarget && CBZ.lockonTarget());
    S.name = craft.displayName || "";
    return CBZ.cockpitNormalizeState ? CBZ.cockpitNormalizeState(S) : S;
  };

  // ============================================================
  //  THE GLASS — canvas + texture ownership.
  //  The static furniture (bezels, tick marks, colour arcs, legends) is
  //  painted ONCE PER COCKPIT CLASS into a shared offscreen canvas and
  //  blitted; only the live layer redraws. Two Raptors in the world share
  //  one base bitmap. This is the whole reason a per-frame canvas texture
  //  is affordable here when the repo has never had one before.
  // ============================================================
  const HUD_CANVAS = { w: 512, h: 448 };   // the combiner's bitmap, one size for all
  const baseCache = new Map();          // layoutId -> HTMLCanvasElement
  function hasDom() { return typeof document !== "undefined" && !!document.createElement; }

  function baseCanvasFor(layout, pal) {
    if (!hasDom() || !CBZ.cockpitPaintBase) return null;
    const key = layout;
    let c = baseCache.get(key);
    if (c) return c;
    const size = CBZ.cockpitLayoutSize ? CBZ.cockpitLayoutSize(layout) : { w: 1024, h: 384 };
    c = document.createElement("canvas");
    c.width = size.w; c.height = size.h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    CBZ.cockpitPaintBase(ctx, size.w, size.h, palFor(pal), layout);
    baseCache.set(key, c);
    return c;
  }
  // the panel kit speaks CSS colour strings; the spec speaks hex numbers
  // (the repo's material convention). One conversion, in one place.
  function hex(n) { return "#" + ("00000" + (n >>> 0).toString(16)).slice(-6); }
  function palFor(pal) {
    return {
      panelTop: hex(pal.panelTop), panelBot: hex(pal.panelBot),
      bezel: hex(pal.bezel), dialFace: hex(pal.dialFace), ink: hex(pal.ink),
    };
  }

  // ============================================================
  //  ATTACH / DETACH
  //  Idempotent: calling attach twice returns the same record. Everything
  //  is built lazily on the first attach for a class, and a detached
  //  cockpit's per-craft canvases are released (the shared base bitmaps and
  //  shared geometry stay — they cost one bitmap per class, forever).
  // ============================================================
  const live = [];                       // every attached cockpit record
  let attachCount = 0;

  CBZ.cockpitAttach = function (craft) {
    if (!on() || !craft || !craft.group) return null;
    if (craft._cockpit) return craft._cockpit;
    // A build that failed once will fail every frame for the same reason, and
    // the tick below retries on every tick — so remember the failure and stop.
    // Without this a single bad spec turns into 60 console.errors a second.
    if (craft._cockpitFailed) return null;
    if (!CBZ.cockpitShapes || !CBZ.cockpitShapes.build) return null;

    const spec = CBZ.cockpitSpec(craft);

    // The ANCHOR is an empty Object3D parented to the craft group, rotated
    // so ITS +Z is the true nose whatever frame the model was built in.
    // Everything downstream (eye placement, attitude read, the overlay
    // camera) speaks through it, so nose-along-+X airport meshes and
    // nose-along-+Z purpose-built rigs need no branching anywhere else.
    const anchor = new THREE.Object3D();
    anchor.name = "cockpit-anchor";
    anchor.rotation.y = -((craft.modelYawOffset || 0));
    anchor.userData.cockpit = true;          // never merged by core/batch.js
    craft.group.add(anchor);

    let built = null;
    try { built = CBZ.cockpitShapes.build(spec, { craft: craft }); } catch (e) {
      console.error("[cockpit] shape build failed", e);
    }
    if (!built || !built.root) { craft.group.remove(anchor); craft._cockpitFailed = true; return null; }

    const rec = {
      craft: craft, spec: spec, anchor: anchor,
      root: built.root, parts: built.parts || {},
      layout: spec.layout,
      canvas: null, ctx: null, tex: null,
      hudCanvas: null, hudCtx: null, hudTex: null,
      base: null,
      acc: 0, S: {}, g: 1, slip: 0,
      // control-animation easing state (never snap a stick — a real one has mass)
      aStick: 0, aRoll: 0, aLever: 0, aPed: 0,
      visible: false, detached: false,
    };
    rec.root.userData.cockpit = true;
    rec.root.visible = false;              // shown only by cockpit_view.js
    anchor.add(rec.root);

    // ---- the live panel bitmap ----
    if (hasDom() && rec.parts.panelMesh) {
      const size = CBZ.cockpitLayoutSize ? CBZ.cockpitLayoutSize(spec.layout) : { w: 1024, h: 384 };
      const c = document.createElement("canvas");
      c.width = size.w; c.height = size.h;
      const ctx = c.getContext("2d");
      if (ctx) {
        rec.canvas = c; rec.ctx = ctx; rec.W = size.w; rec.H = size.h;
        rec.base = baseCanvasFor(spec.layout, spec.pal);
        rec.tex = new THREE.CanvasTexture(c);
        rec.tex.minFilter = THREE.LinearFilter;       // no mipmaps: the panel is
        rec.tex.magFilter = THREE.LinearFilter;       // always near, and mip
        rec.tex.generateMipmaps = false;              // regeneration every repaint
        if (THREE.ClampToEdgeWrapping) rec.tex.wrapS = rec.tex.wrapT = THREE.ClampToEdgeWrapping;
        if (THREE.sRGBEncoding != null) rec.tex.encoding = THREE.sRGBEncoding;  // match core/renderer.js
        rec.parts.panelMesh.material.map = rec.tex;
        rec.parts.panelMesh.material.needsUpdate = true;
        paintPanel(rec, true);
      }
    }
    // ---- the head-up combiner (fighter/bomber) ----
    if (hasDom() && rec.parts.hudMesh && CBZ.cockpitHudDraw) {
      const c = document.createElement("canvas");
      c.width = HUD_CANVAS.w; c.height = HUD_CANVAS.h;
      const ctx = c.getContext("2d");
      if (ctx) {
        rec.hudCanvas = c; rec.hudCtx = ctx;
        rec.hudTex = new THREE.CanvasTexture(c);
        rec.hudTex.minFilter = THREE.LinearFilter;
        rec.hudTex.magFilter = THREE.LinearFilter;
        rec.hudTex.generateMipmaps = false;
        rec.parts.hudMesh.material.map = rec.hudTex;
        rec.parts.hudMesh.material.needsUpdate = true;
      }
    }

    craft._cockpit = rec;
    live.push(rec);
    attachCount++;
    return rec;
  };

  CBZ.cockpitOf = function (craft) { return (craft && craft._cockpit) || null; };

  CBZ.cockpitDetach = function (craft) {
    const rec = craft && craft._cockpit;
    if (!rec) return;
    rec.detached = true;
    const i = live.indexOf(rec);
    if (i >= 0) live.splice(i, 1);
    // the root may be living in cockpit_view's overlay scene rather than
    // under the anchor, so detach it from WHEREVER it currently hangs
    if (rec.root && rec.root.parent) rec.root.parent.remove(rec.root);
    if (rec.anchor && rec.anchor.parent) rec.anchor.parent.remove(rec.anchor);
    // per-craft textures/canvases go; the shared base bitmaps and any shared
    // material/geometry caches inside cockpit_shapes stay (one per class).
    if (rec.tex) { try { rec.tex.dispose(); } catch (e) {} }
    if (rec.hudTex) { try { rec.hudTex.dispose(); } catch (e) {} }
    // Teardown goes through the BUILDER, not a local traversal: cockpit_shapes
    // owns which of its materials are module-cached and shared between every
    // cockpit of a class (`_cockpitShared`). A generic sweep here would dispose
    // those and quietly break the NEXT aircraft of the same type.
    if (CBZ.cockpitShapes && CBZ.cockpitShapes.dispose) {
      try { CBZ.cockpitShapes.dispose(rec.root); } catch (e) { disposeTree(rec.root); }
    } else disposeTree(rec.root);
    rec.canvas = rec.ctx = rec.tex = rec.hudCanvas = rec.hudCtx = rec.hudTex = null;
    craft._cockpit = null;
  };
  function disposeTree(o) {
    if (!o) return;
    o.traverse(function (n) {
      if (n.geometry && !n.geometry._shared) { try { n.geometry.dispose(); } catch (e) {} }
      const m = n.material;
      if (!m) return;
      const arr = Array.isArray(m) ? m : [m];
      arr.forEach(function (mm) { if (mm && !mm._shared) { try { mm.dispose(); } catch (e) {} } });
    });
  }

  // ============================================================
  //  PAINT
  // ============================================================
  function paintPanel(rec, force) {
    if (!rec.ctx) return;
    const S = CBZ.cockpitFlightState(rec.craft, rec.S);
    CBZ.cockpitPaintPanel(rec.ctx, rec.base, rec.W, rec.H, S, palFor(rec.spec.pal), rec.layout);
    if (rec.tex) rec.tex.needsUpdate = true;
    if (rec.hudCtx && CBZ.cockpitHudDraw) {
      CBZ.cockpitHudDraw(rec.hudCtx, HUD_CANVAS.w, HUD_CANVAS.h, S,
        { mode: S.lock ? "LOCK" : (S.maxAmmo > 0 ? "A/A" : "NAV") });
      if (rec.hudTex) rec.hudTex.needsUpdate = true;
    }
    return S;
  }

  // ============================================================
  //  CONTROL ANIMATION — the minimum set that sells "the aircraft is
  //  responding to me", per the sim-modelling convention: the primary
  //  control tracks input 1:1 with no lag, the pedals move opposite each
  //  other, the power lever tracks the actual power setting, and at least
  //  one instrument moves. We have all four.
  //
  //  RUDDER RATIO: real aircraft scale visible rudder/pedal travel DOWN as
  //  airspeed rises (a 737 goes from ±15° on the ground to ~±8° at cruise
  //  through a ratio changer). Copying that is one multiply and it is the
  //  difference between "the pedals are animated" and "the pedals feel
  //  connected to something".
  // ============================================================
  const _inp = { pitch: 0, roll: 0, yaw: 0, pwr: 0 };
  function readInput() {
    const k = CBZ.keys || {};
    const v2 = !CFG || CFG.FLIGHT_CONTROLS_V2 !== false;
    // pitch: V2 puts it on W/S (S pulls back = nose up); legacy on Space/Ctrl
    let pitch = 0, roll = 0, yaw = 0, pwr = 0;
    if (v2) {
      if (k["s"]) pitch += 1;
      if (k["w"]) pitch -= 1;
      if (k[" "] || k["shift"]) pwr += 1;
      if (k["control"]) pwr -= 1;
    } else {
      if (k[" "]) pitch += 1;
      if (k["control"] || k["shift"]) pitch -= 1;
      if (k["w"]) pwr += 1;
      if (k["s"]) pwr -= 1;
    }
    if (k["a"]) roll -= 1;      // A banks LEFT → stick left
    if (k["d"]) roll += 1;
    if (k["q"]) yaw -= 1;       // Q yaws left → left pedal forward
    if (k["e"]) yaw += 1;
    // the touch layer writes the same key table (systems/touch_vehicle.js),
    // so a phone player's stick moves too, for free.
    _inp.pitch = pitch; _inp.roll = roll; _inp.yaw = yaw; _inp.pwr = pwr;
    return _inp;
  }

  function animate(rec, dt) {
    const p = rec.parts, sp = rec.spec, craft = rec.craft;
    const inp = readInput();
    const ease = 1 - Math.exp(-14 * dt);          // ~70ms to settle: mass, not lag

    // --- primary control ------------------------------------------------
    // A cyclic/stick shows the PILOT'S HAND, so it must follow the input,
    // not the resulting attitude — a stick that lags the aeroplane reads as
    // the aeroplane flying the pilot.
    rec.aStick += (inp.pitch - rec.aStick) * ease;
    rec.aRoll += (inp.roll - rec.aRoll) * ease;
    const isYoke = sp.stick.type === "yoke";
    if (p.stick) {
      const th = (sp.stick.throwDeg || 14) * D2R;
      // pull back (pitch +1) tips the stick TOWARD the pilot = -X rotation
      p.stick.rotation.x = -rec.aStick * th;
      // A YOKE splits the two axes across two parts: the COLUMN (parts.stick)
      // only ever moves fore/aft, and the WHEEL (parts.yoke, its child) takes
      // the roll — rolling the column too would swing the whole assembly out
      // of the panel, which is the classic yoke-rigging mistake.
      p.stick.rotation.z = isYoke ? 0 : -rec.aRoll * th;
    }
    // a wheel turns several times further than a stick leans — that ratio is
    // most of what makes a yoke read as a yoke and not a short stick
    if (p.yoke) p.yoke.rotation.z = -rec.aRoll * (sp.stick.throwDeg || 22) * D2R * 2.4;

    // --- power lever ----------------------------------------------------
    if (p.lever && sp.lever) {
      const want = sp.lever.type === "collective"
        // a collective is a POSITION, and the heli's vertical command is a
        // held input, so integrate it the same way the flight model does
        ? clamp(fin(rec.aLever, 0) + inp.pwr * dt * 0.9, 0, 1)
        : clamp(fin(craft.thr, (fin(craft.throttle, 38) - 38) / 82), 0, 1);
      rec.aLever += (want - rec.aLever) * ease;
      const th = (sp.lever.throwDeg || 36) * D2R;
      const a = -rec.aLever * th;
      p.lever.rotation.x = a;
      // a twin quadrant: both levers ride together (no per-engine model yet —
      // when there is one, this is the single line that splits them)
      if (p.lever.children && p.lever.children.length > 1 && sp.lever.type === "quadrant") {
        p.lever.children[0].rotation.x = 0;
        p.lever.children[1].rotation.x = 0;
      }
    }

    // --- rudder pedals, with the real speed-scheduled ratio --------------
    if (p.pedalL && p.pedalR && sp.pedals) {
      rec.aPed += (inp.yaw - rec.aPed) * ease;
      const kt = Math.abs(fin(craft.airspeed, fin(craft.speed, 0))) * MPS_KT;
      const ratio = clamp(1 - (kt - 60) / 420, 0.53, 1);     // ±15° → ±8° with speed
      const t = rec.aPed * (sp.pedals.travel || 0.07) * ratio;
      p.pedalL.position.z = (p.pedalL.userData.z0 || 0) - t;   // yaw right → right pedal forward
      p.pedalR.position.z = (p.pedalR.userData.z0 || 0) + t;
    }

    // --- backlighting ---------------------------------------------------
    // Instrument backlight is a NIGHT instrument: it ramps with the same
    // CBZ.nightAmount that lights the city's windows, so dusk in the cockpit
    // and dusk in the world are literally the same number.
    const night = clamp(fin(CBZ.nightAmount, 0), 0, 1);
    const lamps = p.lampMats;
    if (lamps && lamps.length) {
      const ei = 0.10 + night * 0.85;
      for (let i = 0; i < lamps.length; i++) if (lamps[i]) lamps[i].emissiveIntensity = ei;
    }
    // the panel bitmap itself darkens slightly by day (a lit LCD in sunlight
    // is washed, not glowing) — one material property, no repaint.
    if (p.panelMesh && p.panelMesh.material && p.panelMesh.material.color) {
      const lum = 0.72 + night * 0.28;
      p.panelMesh.material.color.setScalar(lum);
    }
  }

  // ============================================================
  //  TICK. Registered in the VEHICLES band, right after the flight
  //  integrator (playeraircraft.js drives flight at onUpdate(12)) and well
  //  before presentation, so the glass shows THIS frame's state and the
  //  camera in cockpit_view.js reads a settled cockpit.
  //
  //  The expensive half (repainting the canvas) runs ONLY while the player
  //  is actually looking at it — in the chase camera the panel is a texture
  //  nobody can see, so it costs nothing at all.
  // ============================================================
  CBZ.onUpdate(CBZ.PRIO && CBZ.PRIO.VEHICLES != null ? CBZ.PRIO.VEHICLES + 0.3 : 42.3, function (dt) {
    if (!on()) return;
    if (CBZ.game && CBZ.game.mode !== "city") return;
    // BUILD ON BOARDING, not on the first [V]. The door arc has just spent a
    // second and a half opening a canopy and walking you in; building ~25
    // meshes and one bitmap inside that beat is invisible, whereas building
    // them on the view toggle is a hitch exactly when the camera cuts.
    const P = CBZ.player;
    if (P && P._aircraft && !P._aircraft._cockpit && !P._aircraft.destroyed) CBZ.cockpitAttach(P._aircraft);
    if (!live.length) return;
    const hz = Math.max(2, fin(CFG.COCKPIT_PANEL_HZ, 18));
    const period = 1 / hz;
    for (let i = live.length - 1; i >= 0; i--) {
      const rec = live[i];
      const craft = rec.craft;
      // a destroyed / released craft takes its cockpit with it
      if (!craft || craft.destroyed || !craft.group || !craft.group.parent) {
        CBZ.cockpitDetach(craft || { _cockpit: rec });
        continue;
      }
      const seen = !!rec.visible;
      if (!seen) { rec.acc = period; continue; }        // primed to repaint on entry
      animate(rec, dt);
      rec.acc += dt;
      if (rec.acc >= period) { rec.acc = 0; paintPanel(rec); }
    }
  });

  // ============================================================
  //  THE RATCHET (CLAUDE.md THE BLOCK LAW, rule 5).
  //  Two numbers the math gate should pin, both of which may only go DOWN:
  //
  //   specFail   — airframe classes whose generated spec contains a
  //                non-finite number. A NaN here produces an invisible or
  //                exploded cockpit that is miserable to diagnose from a
  //                screenshot, so it is pinned at ZERO and proven by
  //                generating all five costumes against a synthetic craft
  //                on every call. No live aircraft required — this runs in
  //                a headless boot with an empty world.
  //   eyeGuessed — live cockpits whose eye point fell all the way through
  //                to the bounding-box estimate because the airframe has
  //                neither a pilot silhouette nor a tagged canopy. Those
  //                are the seats that will feel wrong, and the fix is one
  //                tag on the model. The number should only ever shrink.
  // ============================================================
  const AUDIT_KEYS = ["panel", "glare", "tub", "frame", "stick", "lever", "pedals", "seat", "hud",
                      "consoleL", "consoleR", "pedestal", "overhead"];
  function specIsFinite(spec) {
    if (!spec) return false;
    if (!Number.isFinite(spec.eye.x) || !Number.isFinite(spec.eye.y) || !Number.isFinite(spec.eye.z)) return false;
    if (!Number.isFinite(spec.scale) || spec.scale <= 0) return false;
    for (let i = 0; i < AUDIT_KEYS.length; i++) {
      const b = spec[AUDIT_KEYS[i]];
      if (!b) continue;
      for (const k in b) {
        const v = b[k];
        if (typeof v === "number" && !Number.isFinite(v)) return false;
      }
    }
    return true;
  }
  CBZ.cockpitAudit = function () {
    // synthetic proof: every costume must generate cleanly with NO model at
    // all (the hardest case — the generator has nothing to measure).
    let specFail = 0;
    const probes = [
      { airClass: "heli", displayName: "PROBE HELI" },
      { airClass: "jet", displayName: "PROBE JET" },
      { airClass: "jet", displayName: "B-2 SPIRIT" },
      { airClass: "airliner", displayName: "PROBE LINER", modelYawOffset: -Math.PI / 2 },
      { airClass: "prop", displayName: "PROBE PROP" },
    ];
    for (let i = 0; i < probes.length; i++) {
      let s = null;
      try { s = CBZ.cockpitSpec(probes[i]); } catch (e) { s = null; }
      if (!specIsFinite(s)) specFail++;
    }
    let eyeGuessed = 0;
    for (let i = 0; i < live.length; i++) if (live[i].spec.eyeSource === "bbox") eyeGuessed++;
    return {
      specFail: specFail,            // MUST stay 0
      eyeGuessed: eyeGuessed,        // may only go DOWN
      attached: live.length,
      built: attachCount,
      classes: Object.keys(CLASS).length,
      baseBitmaps: baseCache.size,
    };
  };

  // exposed for cockpit_view.js and for probes
  CBZ.cockpitLive = function () { return live; };
  CBZ.cockpitClasses = CLASS;
})();
