/* ============================================================
   city/props.js — traffic infrastructure plus an opt-in legacy street-prop
   layer and shared billboard-label helper. Hooked by world.js via
   CBZ.cityProps(city).

   Traffic lights are built here (one signal head per intersection
   approach) and attached to the intersection record; city/traffic.js
   drives their colour each frame and reads them for red-light tickets.

   Also builds the HOMELESS CAMPS in the projects/industrial pocket —
   WHY: the money ladder only reads if its bottom rung is VISIBLE. The
   vagrants peds.js spawns on those same lots need somewhere they live
   (tarp tents, a burning barrel, carts, cardboard); driving from this
   to your penthouse IS the scoreboard. CBZ.cityCamps publishes anchors.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const mat = CBZ.mat;

  // PROPS_WIRED_V1 (owner audit — "every prop is interactable or gone"): three
  // street props stop being decor — a PROPANE CAGE cooks off when shot, a
  // PARKING METER spills coins when you ram it, and a MAILBOX can be checked
  // for mail (that verb lives in interact.js). One-line revert. Defaulted here
  // AND in interact.js — idempotent, whichever script loads first wins.
  CBZ.CONFIG = CBZ.CONFIG || {};
  // Kerb furniture (hydrants, bins, news boxes, meters, mailboxes, street
  // trees, bus stops, shop-front dressing) is always built, by the KERB
  // FURNITURE pass (real objects, instanced, placed on the kerbs the street
  // kit drew). This switch now only gates the loud extras: roadside
  // billboards, roof rails/boards and the homeless camps.
  if (CBZ.CONFIG.CITY_STREET_CLUTTER == null) CBZ.CONFIG.CITY_STREET_CLUTTER = false;
  if (CBZ.CONFIG.PROPS_WIRED_V1 == null) CBZ.CONFIG.PROPS_WIRED_V1 = true;
  // JUNCTION_DETAIL (owner: "roads meet at intersections right now feeling very
  // unintentional") — kerb returns, junction resurfacing, stop lines and
  // crosswalks at every crossing city.roads knows about. One line back to
  // square corners. JUNCTION_CURB_TRIM is the half of it that reaches into
  // geometry world.js already built (the straight kerbs the return replaces);
  // it is separately revertible because it is the only part that depends on
  // another file's shape rather than on the road record.
  if (CBZ.CONFIG.JUNCTION_DETAIL == null) CBZ.CONFIG.JUNCTION_DETAIL = true;
  if (CBZ.CONFIG.JUNCTION_CURB_TRIM == null) CBZ.CONFIG.JUNCTION_CURB_TRIM = true;
  if (CBZ.CONFIG.JUNCTION_MAX == null) CBZ.CONFIG.JUNCTION_MAX = 260;
  // PROPS_PURGE_V1 (owner: "MOST INTERIORS AND BUILDING EXTERIOR THERE ARE MANY
  // DUMB PROPS THAT DONT HAVE PHYSICS OR PURPOSE, LIKE ALLEYS FILLED WITH TRASH
  // CANS AND NEWSPAPER BUYING STANDS SO I CANT RUN THROUGH ALLEYS, AND DUMB AC
  // BOXES OUTSIDE WINDOWS ... GET RID OF THE DUMB PROPS.") — the alley-corridor
  // law below plus the per-pass cuts in this file, world/street_furniture.js and
  // world/building_dress.js. ONE line back to the old clutter, and every rng()
  // draw is preserved on both sides of the flag (see the `// purged:` markers)
  // so flipping it off rebuilds the OLD world byte-for-byte, not a third one.
  if (CBZ.CONFIG.PROPS_PURGE_V1 == null) CBZ.CONFIG.PROPS_PURGE_V1 = true;
  // PROPS_KNOCK_PLAYER — a body at a run tips a can/box/cone, through the exact
  // tipProp() a bumper already uses. Separately revertible because it is the one
  // half of the purge that changes a RUNTIME reaction rather than a placement.
  if (CBZ.CONFIG.PROPS_KNOCK_PLAYER == null) CBZ.CONFIG.PROPS_KNOCK_PLAYER = true;

  /* ======================================================================
     THE ALLEY LAW — A GAP BETWEEN TWO BUILDINGS IS A ROUTE, NOT A SHELF.
     ======================================================================
     OWNER: "alleys filled with trash cans and newspaper buying stands so I
     cant run through alleys."

     He is describing a structural fact nobody had ever measured. SIX separate
     scatter passes place street furniture off a lot EDGE or a building's REAR
     FACE — props.js's nine per-lot rolls, street_furniture.js's dumpster/
     crate/barrier walk, its bollard triples — and not one of them knew whether
     the metre it was filling was a pavement or the only way through a block.
     A lot edge that faces a street has 18 m of road behind it; the identical
     edge on the other side of the same lot may have 4 m of gap and a wall.
     The passes could not tell those apart, so the narrow one collected the
     same six props as the wide one, every collider landed in the 4 m, and the
     alley became a wall you could see down and not walk down.

     A CORRIDOR IS DERIVED, NEVER AUTHORED — the same grammar roadrules.js
     used for junctions. `lot.building` has carried a real footprint rect since
     buildings.js shipped; the corridor width at a point is just the distance
     to the nearest wall on each side of each axis, and the narrower of the two
     spans is how wide the gap you are standing in actually is. Nothing is
     declared, no builder tags an "alley", and a building added tomorrow is
     inside the law for free.

     THE NUMBERS ARE SOLVED, NOT TASTED. physics.js gives the player capsule a
     0.55 m radius (physics.js:108), so a body is 1.10 m wide:
       RUN  2.4  the clear width a SPRINT needs — the body plus 0.65 m of
                 slack either side, i.e. you do not have to hug a wall.
       SLOT 3.2  below this a corridor cannot carry the run AND a 0.4 m prop
                 clear of both walls, so nothing generic stands in it at all.
       OPEN 8.0  RUN + two 1.1 m dumpsters + their standoff. Wider than this
                 and the "gap" is a yard or a street; the law steps aside and
                 the old placement rules apply unchanged.
       CELL 14   one building's rear face. The budget is per cell, which is
                 what turns "6 bins and 2 stands" into "one dumpster" without
                 any pass being told how many its neighbours placed.

     ADOPTION IS ONE LINE and degrade-safe:
         if (CBZ.alleyOk && !CBZ.alleyOk(x, z, { solid: true, r: 1.05 })) return;
     `solid` means the prop carries a collider (the only kind that can block a
     route); `r` is its half-width across the corridor. It CLAIMS on success —
     that is deliberate, because the alternative is every caller writing a
     check AND a claim, which is exactly the two-line adoption cost that killed
     proptypes.js. A claim spent on a prop that then fails some later test only
     makes an alley emptier, which is the direction we want to be wrong in.
     world/detail_kit.js routes DK.free() through it, so all four dressing
     passes inherit the law without changing a line. */
  const ALLEY = {
    OPEN: 8.0, RUN: 2.4, SLOT: 3.2, CELL: 14, ITEMS: 2, SOLIDS: 1, SCAN: 16,
  };
  CBZ.ALLEY_LAW = ALLEY;
  // {rects, grid, cell, claims} — rebuilt per world by alleyIndex(city).
  let AIDX = null;
  // live census: what the purge refused, and what each pass reported cutting
  const PURGE = { refused: 0, kept: 0, cut: Object.create(null) };

  function alleyKey(ix, iz) { return ix * 8192 + iz; }
  function alleyIndex(city) {
    PURGE.refused = 0; PURGE.kept = 0; PURGE.cut = Object.create(null);
    AIDX = null;
    if (!city) return;
    const rects = [];
    const sets = [city.lots || []];
    if (city.annex && city.annex.lots) sets.push(city.annex.lots);
    for (let s = 0; s < sets.length; s++) {
      const set = sets[s];
      for (let i = 0; i < set.length; i++) {
        const lot = set[i], b = lot && lot.building;
        // A park's stub building has an owner and no structure — it walls
        // nothing, so it must not read as one side of a corridor.
        if (!b || b.park || !(b.w > 0) || !(b.d > 0)) continue;
        const ox = Number.isFinite(b.ox) ? b.ox : lot.cx;
        const oz = Number.isFinite(b.oz) ? b.oz : lot.cz;
        if (!Number.isFinite(ox) || !Number.isFinite(oz)) continue;
        rects.push({ minX: ox - b.w / 2, maxX: ox + b.w / 2, minZ: oz - b.d / 2, maxZ: oz + b.d / 2 });
      }
    }
    const CELL = 32, grid = new Map();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      // padded by SCAN on insert, so one bucket lookup answers a query that
      // has to see every wall within SCAN of the point
      const i0 = Math.floor((r.minX - ALLEY.SCAN) / CELL), i1 = Math.floor((r.maxX + ALLEY.SCAN) / CELL);
      const j0 = Math.floor((r.minZ - ALLEY.SCAN) / CELL), j1 = Math.floor((r.maxZ + ALLEY.SCAN) / CELL);
      for (let ix = i0; ix <= i1; ix++) for (let iz = j0; iz <= j1; iz++) {
        const k = alleyKey(ix, iz);
        let a = grid.get(k); if (!a) { a = []; grid.set(k, a); }
        a.push(r);
      }
    }
    AIDX = { rects: rects, grid: grid, cell: CELL, claims: new Map() };
  }
  CBZ.alleyIndex = alleyIndex;

  /* How wide is the walkable corridor at this point?
       -> {w, ax, az, inside}
     ax/az are the free spans across x and z; `w` is the narrower of the two,
     i.e. the width of the gap you are standing in. A side with no wall within
     SCAN contributes SCAN, so an open pavement reads >= SCAN and is never an
     alley. `inside` means the point is buried in a building footprint. */
  CBZ.alleyGapAt = function (x, z) {
    const R = ALLEY.SCAN, wide = R * 2;
    const out = { w: wide, ax: wide, az: wide, inside: false };
    if (!AIDX || !Number.isFinite(x) || !Number.isFinite(z)) return out;
    const a = AIDX.grid.get(alleyKey(Math.floor(x / AIDX.cell), Math.floor(z / AIDX.cell)));
    if (!a) return out;
    let xp = R, xn = R, zp = R, zn = R;
    for (let i = 0; i < a.length; i++) {
      const r = a[i];
      const inX = x > r.minX && x < r.maxX;
      const inZ = z > r.minZ && z < r.maxZ;
      if (inX && inZ) { out.inside = true; out.w = out.ax = out.az = 0; return out; }
      // a wall only bounds the X corridor if it actually spans our Z (and v.v.)
      if (inZ) {
        if (r.minX >= x) { const d = r.minX - x; if (d < xp) xp = d; }
        else if (r.maxX <= x) { const d = x - r.maxX; if (d < xn) xn = d; }
      }
      if (inX) {
        if (r.minZ >= z) { const d = r.minZ - z; if (d < zp) zp = d; }
        else if (r.maxZ <= z) { const d = z - r.maxZ; if (d < zn) zn = d; }
      }
    }
    out.ax = xp + xn; out.az = zp + zn;
    out.w = Math.min(out.ax, out.az);
    return out;
  };

  /* Is this point ON a building — inside its footprint, or glued to its wall
     line? The audit needs it to tell a WALL from a thing standing in front of
     one: a wall segment's collider is centred on the footprint boundary, so
     without this every alley in the world would read as blocked by the two
     buildings that make it. 0.7 m clears a facade fitting and still counts a
     dumpster (placed 1.25 m off the wall). */
  function alleyOnWall(x, z, pad) {
    if (!AIDX) return false;
    const a = AIDX.grid.get(alleyKey(Math.floor(x / AIDX.cell), Math.floor(z / AIDX.cell)));
    if (!a) return false;
    const p = pad == null ? 0.7 : pad;
    for (let i = 0; i < a.length; i++) {
      const r = a[i];
      if (x >= r.minX - p && x <= r.maxX + p && z >= r.minZ - p && z <= r.maxZ + p) return true;
    }
    return false;
  }

  /* May a generic prop stand here? CLAIMS on success (see the block comment).
       o.solid  the prop carries a collider   o.r  its half-width, metres */
  CBZ.alleyOk = function (x, z, o) {
    if (CBZ.CONFIG.PROPS_PURGE_V1 === false) return true;
    const g = CBZ.alleyGapAt(x, z);
    if (g.inside) { PURGE.refused++; return false; }
    if (g.w >= ALLEY.OPEN) return true;                 // open ground — not an alley
    if (g.w < ALLEY.SLOT) { PURGE.refused++; return false; }
    const r = (o && o.r != null) ? +o.r : 0.4;
    const solid = !!(o && o.solid);
    // NOTHING may eat the run — not just colliders. A 2 m parasol you can walk
    // THROUGH still reads as a plugged alley, and "you can walk through it" is
    // its own bug (world/clutter.js's NO-DECOY header). `solid` decides the
    // budget below; the clearance is owed by anything with a footprint.
    if (g.w - r * 2 < ALLEY.RUN) { PURGE.refused++; return false; }
    const key = alleyKey(Math.round(x / ALLEY.CELL), Math.round(z / ALLEY.CELL));
    const c = AIDX ? AIDX.claims.get(key) : null;
    const n = c ? c.n : 0, sN = c ? c.s : 0;
    if (n >= ALLEY.ITEMS || (solid && sN >= ALLEY.SOLIDS)) { PURGE.refused++; return false; }
    if (AIDX) AIDX.claims.set(key, { n: n + 1, s: sN + (solid ? 1 : 0) });
    PURGE.kept++;
    return true;
  };

  /* A dressing pass reports what it cut, so propPurgeAudit can name it. Keys
     are per-pass and LAST WRITE WINS, so two passes must never share one —
     that is why the removal counts are `alleyRemoved` (street_furniture) and
     `acRemoved` (building_dress) rather than both being "removed".
       CBZ.propPurgeCensus({ acBoxes: 0, roofItems: 41, acRemoved: 118 }) */
  CBZ.propPurgeCensus = function (o) {
    if (!o) return;
    for (const k in o) { const v = +o[k]; if (Number.isFinite(v)) PURGE.cut[k] = v; }
  };

  /* ======================================================================
     CBZ.propPurgeAudit() — THE RATCHET (BLOCK LAW #5).
     ======================================================================
     Computed LIVE against the world, never against this file's bookkeeping:
     it re-walks CBZ.colliders — the list EVERY prop producer in the game
     already pushes to — and asks the alley oracle where each one is standing.
     That is deliberate and it is the whole value: a collider dropped in an
     alley by a file that has never heard of this law still shows up here.

       alleysBlocked  alley cells whose residual clear width, after every
                      collider standing in them, is under a sprint's RUN.
                      STRUCTURAL TARGET 0 — under the law at most one solid
                      may stand in a cell and only if it leaves RUN. A
                      non-zero reading names a producer that has not adopted
                      it, and `worst` gives you its coordinates.
       solidInAlley   colliders inside a corridor narrower than OPEN. NOT a
                      failure — one dumpster in an alley is the point. It is
                      printed BESIDE alleysBlocked so a "fix" that empties
                      every alley cannot pass as an improvement.
       acBoxes          window air-conditioners hung off facades. Pinned 0.
       facadePlatforms  fake floor-by-floor side boxes. Pinned 0; the real,
                        climbable fire escapes from elevators.js are excluded.
       roofItems        rooftop plant instances still standing.
       propsRemoved   placements this purge refused, across every pass.
     ====================================================================== */
  CBZ.propPurgeAudit = function () {
    const out = {
      enabled: CBZ.CONFIG.PROPS_PURGE_V1 !== false,
      alleysBlocked: 0, solidInAlley: 0,
      acBoxes: PURGE.cut.acBoxes | 0,
      facadePlatforms: PURGE.cut.facadePlatforms | 0,
      roofItems: PURGE.cut.roofItems | 0,
      propsRemoved: (PURGE.refused | 0) + (PURGE.cut.alleyRemoved | 0) +
        (PURGE.cut.acRemoved | 0) + (PURGE.cut.facadePlatformsRemoved | 0),
      alleyCells: 0, alleyKept: PURGE.kept | 0, indexed: AIDX ? AIDX.rects.length : 0,
      worst: null, cut: PURGE.cut,
    };
    if (!AIDX) return out;
    const cols = CBZ.colliders || [];
    const cells = new Map();
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (!c || !Number.isFinite(c.minX) || !Number.isFinite(c.minZ)) continue;
      const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
      if (!(w > 0) || !(d > 0)) continue;
      // A STRUCTURE IS NOT STREET FURNITURE. A wall/shell/plinth is what MAKES
      // the corridor, and counting it as an obstruction inside it would read
      // every alley in the world as blocked by its own two walls. Three
      // filters, cheapest first: a big box on both axes, anything longer than
      // the widest thing this game puts on a pavement (the 3.4 m bus shelter),
      // and — the one that actually catches walls — a centre sitting ON a
      // building's footprint line.
      if (w > 3.2 && d > 3.2) continue;
      if (w > 4.0 || d > 4.0) continue;
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      if (alleyOnWall(cx, cz, 0.7)) continue;
      const g = CBZ.alleyGapAt(cx, cz);
      if (g.inside || g.w >= ALLEY.OPEN) continue;
      out.solidInAlley++;
      // how much of the corridor it eats, measured ACROSS the narrow axis
      const eat = (g.ax <= g.az) ? w : d;
      const key = Math.round(cx / ALLEY.CELL) + "," + Math.round(cz / ALLEY.CELL);
      let e = cells.get(key);
      if (!e) { e = { w: g.w, eat: 0, x: cx, z: cz, n: 0 }; cells.set(key, e); }
      if (g.w < e.w) e.w = g.w;
      e.eat += eat; e.n++;
    }
    out.alleyCells = cells.size;
    cells.forEach(function (e) {
      const clear = e.w - e.eat;
      if (clear >= ALLEY.RUN) return;
      out.alleysBlocked++;
      if (!out.worst || clear < out.worst.clear) {
        out.worst = { x: Math.round(e.x), z: Math.round(e.z), gap: +e.w.toFixed(2), clear: +clear.toFixed(2), props: e.n };
      }
    });
    return out;
  };

  // ---- shared cached DIEGETIC sign panel ---------------------------------
  // Historical callers still use the makeLabelSprite name, but this is no
  // longer a Sprite.  A Sprite always turns to face the camera and ignores the
  // wall/fixture it supposedly belongs to, which is exactly the floating-text
  // look we do not want.  Return a real, depth-tested plane instead: callers
  // can mount it on a facade, pylon, counter or display just like any other
  // prop.  Character/dialogue systems intentionally do not call this helper.
  const labelCache = new Map();
  const labelPlane = new THREE.PlaneGeometry(1, 1);
  const labelBack = new THREE.BoxGeometry(1.035, 1.08, 0.055);
  const labelBackMat = new THREE.MeshLambertMaterial({ color: 0x151a20 });
  labelPlane._shared = true;
  labelBack._shared = true;
  labelBackMat._shared = true;
  CBZ.makeLabelSprite = function (text, opts) {
    opts = opts || {};
    const key = text + "|" + (opts.color || "#eef4ff") + "|" + (opts.board || "#111821");
    let m = labelCache.get(key);
    if (!m) {
      const c = document.createElement("canvas");
      c.width = 256; c.height = 64;
      const x = c.getContext("2d");
      // Opaque board + rim: the lettering now visibly belongs to an object.
      x.fillStyle = opts.board || "#111821";
      x.fillRect(1, 1, 254, 62);
      x.strokeStyle = "rgba(235,244,255,.48)";
      x.lineWidth = 3;
      x.strokeRect(2.5, 2.5, 251, 59);
      // auto-fit: long labels ("MOB BOSS · 24", storefront names) shrink to the
      // canvas instead of clipping at the edges. Cached per text, so it's free.
      let fs = 30;
      x.font = "bold 30px Fredoka, sans-serif";
      const tw = x.measureText(text).width;
      if (tw > 242) { fs = Math.max(16, Math.floor(30 * 242 / tw)); x.font = "bold " + fs + "px Fredoka, sans-serif"; }
      x.textAlign = "center"; x.textBaseline = "middle";
      x.lineWidth = Math.max(4, fs * 0.2); x.strokeStyle = "rgba(0,0,0,.75)";
      x.strokeText(text, 128, 34);
      x.fillStyle = opts.color || "#eef4ff";
      x.fillText(text, 128, 34);
      const tex = new THREE.CanvasTexture(c);
      tex.anisotropy = Math.min(8, CBZ.renderer && CBZ.renderer.capabilities ? CBZ.renderer.capabilities.getMaxAnisotropy() : 1);
      m = new THREE.MeshBasicMaterial({
        map: tex, side: THREE.DoubleSide, transparent: false,
        depthTest: true, depthWrite: true, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      });
      m._shared = true;
      labelCache.set(key, m);
    }
    const s = new THREE.Mesh(labelPlane, m);
    s.name = "diegetic-sign";
    s.userData.diegeticSign = true;
    // A shallow solid back makes even freestanding placards read as objects in
    // profile.  The front sits clear of it, so there is no coplanar flicker.
    const back = new THREE.Mesh(labelBack, labelBackMat);
    back.position.z = -0.034;
    back.name = "diegetic-sign-board";
    back.userData.diegeticSign = true;
    s.add(back);
    s.scale.set(4, 1, 1);
    return s;
  };

  // lamp emissive material factory
  function lampMat(color) { return new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.2 }); }

  /* ======================================================================
     CBZ.lampMast — ONE SOLVE FOR POLE -> ARM -> HEAD.
     ======================================================================
     OWNER: "lightposts all suck, don't connect."

     He is right, and the proximate cause was one character. The street lamp
     below rotated its mast arm about Z, which lays a Y-axis cylinder along the
     fixture's local X — while the head was offset along local +Z. The arm
     therefore crossed the pole SIDEWAYS and the luminaire floated 1.45 m away
     from the end of it with nothing in between: a bare cylinder with a box
     hanging in the air beside it, which is exactly what the screenshot shows.
     towngen.js was worse — a bare 4.6 m cylinder with a cube balanced on top,
     no arm at all, and the head over the PAVEMENT instead of the road.

     But the character is not the bug. The bug is that the arm and the head
     were authored as two independent constants, so nothing could stop them
     disagreeing. Here they come out of ONE solve: hand it a shaft height and
     an overhang and it hands back the arm's length, tilt and centre AND the
     head/bulb/glow positions AT THE ARM'S TIP. They cannot drift, because
     there is only one of them.

     LOCAL FRAME: the fixture's +Z points at the carriageway. A caller yaws the
     whole thing by atan2(faceX, faceZ) — the vector from the lamp toward the
     road centre, which every caller already has from the side of the road it
     placed the lamp on — and the head overhangs the ROAD by construction.

       o.poleH  shaft height (m)          o.reach  overhang from the axis (m)
       o.rise   arm climb, root->tip (m)  o.poleR  shaft radius at the top (m)

     Degrade-safe by construction: a pure function of four numbers returning
     plain floats, so `CBZ.lampMast ? CBZ.lampMast(o) : <old inline consts>`
     is a real fallback and adopting can never break a caller.
     Consumers: this file's street lamps, city/towngen.js's town lamps,
     world/utility_lines.js's cobra mast arms. */
  CBZ.lampMast = function (o) {
    o = o || {};
    const poleH = o.poleH != null ? +o.poleH : 5.6;
    const reach = o.reach != null ? +o.reach : 1.45;
    const rise = o.rise != null ? +o.rise : 0.30;
    const poleR = o.poleR != null ? +o.poleR : 0.11;
    // The arm springs from the shaft just under its cap and climbs to the tip.
    const z0 = poleR * 0.5, y0 = poleH - 0.12;
    const z1 = reach, y1 = poleH + rise;
    const dz = Math.max(0.05, z1 - z0), dy = y1 - y0;
    return {
      poleH: poleH, poleCY: poleH / 2, poleR: poleR, reach: reach,
      armLen: Math.hypot(dz, dy),
      // A Y-axis cylinder lies along +Z at rotation.x = PI/2; subtracting the
      // climb angle lifts the far end. (Rotating about Z — the bug — lays the
      // same cylinder along X, across the pole, pointing at nothing.)
      armRotX: Math.PI / 2 - Math.atan2(dy, dz),
      armCY: (y0 + y1) / 2, armCZ: (z0 + z1) / 2,
      tipY: y1, tipZ: z1,
      headY: y1 - 0.10, headZ: z1,     // luminaire body, hung on the tip
      bulbY: y1 - 0.20, bulbZ: z1,     // the lens, on its underside
      glowY: y1 - 0.26,                // the light comes off the HEAD, never the base
    };
  };

  /* ======================================================================
     CBZ.streetAudit() — THE RATCHET FOR "THE STREET LOOKS DELIBERATE".
     ======================================================================
     Two of these may only ever reach and hold ZERO:

       wiresDisconnected   a conductor whose endpoint is not ON the insulator
                           it hangs from. Measured, not asserted: the wire
                           builder derives every endpoint by pushing the
                           prototype's own insulator offset through the pole's
                           own instance matrix, then re-measures the gap. Any
                           number above zero means the two have drifted apart
                           again, which is precisely the bug the owner
                           photographed.
       paintThroughJunction  a crossing with lane paint still visibly running
                           across the box. Reported beside `junctionPaintRaw`
                           (how many junctions a builder painted through in the
                           first place) so a "fix" that just stops drawing
                           anything cannot pass.

     Everything else is context that must not be allowed to hide a regression:
     poles / junctions / drawCalls fall if the layer is quietly turned off.
     `wiresThroughGeometry` counts spans DROPPED because their straight line
     crossed a building — those are deletions, and a rising number is the wire
     pass correctly refusing to draw through a wall.

     Exported, never called from here. utility_lines.js publishes its half
     through CBZ.streetPoleCensus (the CBZ.heliFleet pattern), so a future pole
     source costs this function no edit. */
  CBZ.streetAudit = function () {
    // CBZ.city is the MODE SHELL; the built world is CBZ.city.arena (mode.js
    // only assigns it after buildCity returns). Reading the shell is how a
    // dozen callers in this repo have quietly measured nothing.
    const c0 = CBZ.city;
    const c = (c0 && c0.arena && c0.arena.roads) ? c0.arena : c0;
    const J = (c && c._junctionStats) || null;
    const P = (typeof CBZ.streetPoleCensus === "function" ? CBZ.streetPoleCensus() : null) || {};
    const L = (c && c._lampCensus) || { lamps: 0, noCollider: 0 };
    return {
      // POLES standing in the world: utility poles + lamp posts, minus the
      // cobra heads bolted onto utility poles (those are luminaires on a pole
      // that is already counted, not a second pole).
      poles: (P.poles | 0) + (L.lamps | 0) - (P.mastLamps | 0),
      wiresDisconnected: P.wiresDisconnected | 0,
      wiresThroughGeometry: P.wiresDropped | 0,
      polesNoCollider: (P.noCollider | 0) + (L.noCollider | 0),
      // junctions
      junctions: J ? J.junctions : 0,
      junctionsDetailed: J ? J.detailed : 0,
      paintThroughJunction: J ? J.uncovered : 0,
      drawCalls: (J ? J.drawCalls : 0) + (P.drawCalls | 0),
      // printed BESIDE the ratchets so neither can quietly absorb a violation
      junctionPaintRaw: J ? J.through : 0,
      junctionApproachesMarked: J ? J.marked : 0,
      curbsTrimmed: J ? J.trimmed : 0,
      wireSpans: P.spans | 0,
      wiresAreColliders: P.wireColliders | 0,
      lamps: L.lamps | 0,
      lampsOverRoad: L.overRoad | 0,
    };
  };

  /* ======================================================================
     CBZ.solidityAudit() — THE RATCHET FOR "YOU CAN RUN THROUGH IT".
     ======================================================================
     OWNER: "find things in the game that you can run through."

     world/clutter.js states the law this measures: *any prop a body can
     meaningfully approach must be solid, or it reads as a decoy.* The census
     below is a STATIC TABLE, hand-counted file-by-file against the drawing
     code, because most of these objects are InstancedMesh rows or merged
     BufferGeometry — there is nothing in the live scene graph to walk and ask
     "are you solid", and a heuristic that scanned CBZ.colliders could not tell
     a tree's AABB from a fence post's. Where a builder CAN publish its own
     live count it does, and this reads that instead of the table
     (CBZ.backcountrySolids, CBZ.forestTrunkSolids, CBZ.farmFenceSolids) — the
     CBZ.heliFleet pattern, so a future consumer costs this function no edit.

     THE THREE NUMBERS THAT RATCHET, and they may only ever move one way:
       classesBare   may only go DOWN   — a drawn class with no collider that
                                          nobody has argued should be bare.
       classesFixed  may only go UP     — printed beside `bare` so a "fix" that
                                          just deletes geometry cannot pass.
       decoyPolicy   may only go DOWN   — a class deliberately left bare. It is
                                          NOT zero and should not be: a traffic
                                          cone that stops a car is a bollard,
                                          and every driver knows the difference.
                                          But every row in it is a promise that
                                          somebody thought about it, so the
                                          number is published, not hidden.

     WHAT THIS CANNOT SEE WITHOUT A BOOT, stated so nobody mistakes the table
     for a measurement: the true INSTANCE counts (they are seed-dependent), and
     whether an added collider stranded a propuse anchor — that is
     CBZ.propUseAudit().blocked's job, and it must not rise.
     ====================================================================== */
  // status: "solid" (was already) · "fixed" (this pass) · "bare" (found, left,
  // reason given) · "decoy" (deliberately non-solid, reason given)
  const SOLIDITY = [
    // ---- fixed in the solidity pass -----------------------------------
    ["continent:backcountry-trunk", "fixed", "~10^3 trees on registered walkable country; trunk only, canopy free"],
    ["continent:backcountry-rock", "fixed", "1.3-2.4 m boulders on the same ground"],
    ["forest:conifer-trunk", "fixed", "was 24 of ~2600, capped 'for perf' against a spatial broadphase"],
    ["forest:birch-trunk", "fixed", "the round-canopy loop was never iterated by the collider pass at all"],
    ["snow:pine-trunk", "fixed", "130 pines, 0 colliders, you rode through the whole stand"],
    ["snow:rocky-outcrop", "fixed", "40 dodecahedra up to 5.5 m on open snow"],
    ["farmland:field-fence", "fixed", "one AABB per RUN (~110) beats one per post (~2400) and is what blocks"],
    ["terrain:mountain-boulder", "fixed", "3-9 m, via rockscliffs.js's new opts.solidMin, the ONE rock factory"],
    ["desert:rock-cluster", "fixed", "same seam; disabled by default flag, wired for when it is on"],
    ["desert:motel-pylon", "fixed", "9 m roadside mast, the one thing at that stop with no col()"],
    ["highway:suspension-tower-leg", "fixed", "26 m leg that ALSO stood in the outer travel lane; moved out AND collided"],
    ["prison:watchtower-stilt", "fixed", "8 towers; the file's own header admitted this and never fixed it"],
    ["prison:water-tower-leg", "fixed", "4 x 8 m columns under the compound's tallest landmark"],
    ["prison:forge/altar/washer/cabinet/workbench/pew/bed", "fixed", "same rooms as the crate+bus that WERE solid"],
    ["town:square-bench", "fixed", "4/town; 0.65 m top is over physics.js's 0.45 STEP_UP"],
    ["town:hitching-rail", "fixed", "and its two POSTS were never drawn at all, a stick floating at waist height"],
    ["street:sign-post", "fixed", "~90; the 1 m bollard beside it was solid, the 3 m post was not"],
    ["street:name-blade-mast", "fixed", "~60, same rule"],
    ["roof:water-tank", "fixed", "5.5 m on a WALKABLE roof; y-gated so it is not a column to the pavement"],
    ["roof:hvac-chiller", "fixed", "2.3 m, same y-gate"],
    ["marina:travel-lift-leg", "fixed", "4 x 8.4 m, the biggest machine on the waterfront"],
    ["marina:mooring-pile", "fixed", "8 x 5.2 m driven timbers at the channel mouth"],
    ["gov:lamp-standard", "fixed", "42 x 6 m; every other standing object in that kit took a col()"],
    ["gov:security-bollard", "fixed", "32, and the PITCH was solved too. 3.4 m let a car through the Capitol line"],
    ["annex:cooler/snack-rack/parts-shelf", "fixed", "free-standing, in rooms with no walls to cover them"],
    ["town:welcome-sign", "fixed", "the INVERSE fault: an 11 m solid wall filling the gap between two posts"],
    ["gov/military:watchtower-deck-rail", "fixed", "a climbable ladder (world/ladderkit.js + systems/climb.js) and height-gated rail colliders with a gap at its head"],
    // ---- already solid before this pass (spot-checked, not re-listed in full)
    ["military:perimeter-fence", "solid", "island_military.js col() runs the full 2.4 m edge, split around gates"],
    ["venue:perimeter-fence", "solid", "speedway_structures fence() flushes contiguous AABBs; colliderPitch is BOX LENGTH, not spacing"],
    ["gov:perimeter-wall/fence", "solid", "wallRun/wallRunFence collide per span, not per post"],
    ["street:hydrant/mailbox/bin/meter/newsbox/planter/bikerack/propane", "solid", "props.js solidCollider"],
    ["street:dumpster/crate/bollard/barrier", "solid", "street_furniture.js DK.solid"],
    ["street:utility-pole/pad-transformer/cabinet", "solid", "utility_lines.js DK.solid"],
    ["bunker:everything-but-the-ammo-crate", "solid", "best-collided file in the game"],
    ["beach:pier/shack/stall/lifeguard/palm", "solid", "several correctly y-gated"],
    ["checkpoint:barrier-board", "solid", "y0/y1 gated, markCollidersDirty'd"],
    // ---- deliberately bare, and WHY (the decoy budget) -----------------
    ["street:traffic-cone", "decoy", "checkpoints.js: 'a cone that stops a car is a bollard'"],
    ["alley:bin/newsbox/cone knockables", "decoy", "tonight's alley law, they tip, they do not wall"],
    ["park:bench/hedge", "decoy", "buildings.js: 'brushable so chases never snag' (authored, and it contradicts clutter.js, flagged, not overruled)"],
    ["terrain:offshore-backdrop-range", "decoy", "'decorative mountains are not geography'; backdropAudit().onPlate pinned 0"],
    ["wildnature:backdrop-scatter", "decoy", "7500 trees + 2100 rocks, off-plate by construction"],
    ["street:litter/weeds/drains/bags/pallets/bikes", "decoy", "detail_kit.js's own fine-grain policy line"],
    ["roof:vent/dish/aerial/duct", "decoy", "sub-1 m, or dormant under PROPS_PURGE_V1"],
    ["facade:awning/shutter/downpipe/wall-lamp", "decoy", "lowest edge 3.1 m, you walk under it"],
    // ---- the old "bare" backlog, closed by systems/meshcollider.js ------
    // (the collider is MEASURED off the drawn geometry — CBZ.solidFromMesh —
    //  or, for merged facade deco with no mesh, registered through ctx.solid
    //  from the same numbers the drawing used)
    ["facade:fire-escape-drop-ladder", "fixed", "brick.js: one banded body per LOW tread (underside < 2.1 m) on the tread's drawn footprint via F.solidBox/ctx.solid; the high end you can walk under stays open"],
    ["gov:perimeter-GATE-opening", "fixed", "the gap is the road in and STAYS open; the missing object was hung: two steel sliding leaves parked open behind the wall (govcomplex.js gateLeaves), each solid, measured; the Mansion keeps its own checkpoint"],
    ["gov:hedge", "fixed", "decided SOLID: 99 parterre hedges, per-instance meshcollider boxes, noCam; park hedges stay brushable decoys"],
    ["bunker:ammo-crate-stack", "fixed", "each crate measured, the stacked one banded on top"],
    ["civic:engaged-column/cheek-wall", "fixed", "ctx.solid plinth-to-capital per column + 0.81 m cheek walls; dormant with BLD_EXTRAS off, solid the moment it draws"],
    ["forest:fallen-log/tent", "fixed", "logs are oriented boxes measured at their random yaw; tents measured off the pyramid base"],
    ["annex:island-tree", "fixed", "all 64 trunks, trunkOnly bole cross-section per instance (was the tallest 14)"],
  ];
  CBZ.solidityAudit = function () {
    const out = { classesChecked: SOLIDITY.length, classesSolid: 0, classesFixed: 0, decoyPolicy: 0, classesBare: 0, bare: [] };
    for (let i = 0; i < SOLIDITY.length; i++) {
      const r = SOLIDITY[i];
      if (r[1] === "solid") out.classesSolid++;
      else if (r[1] === "fixed") out.classesFixed++;
      else if (r[1] === "decoy") out.decoyPolicy++;
      else { out.classesBare++; out.bare.push(r[0] + " — " + r[2]); }
    }
    // LIVE counts where a builder publishes one; null means that builder did
    // not run this boot (flag off / landmass absent), which is not a failure.
    const bc = CBZ.backcountrySolids || null;
    out.live = {
      backcountry: bc ? bc.solids : null,
      backcountryOn: bc ? !!bc.on : null,
      forestTrunks: CBZ.forestTrunkSolids != null ? CBZ.forestTrunkSolids : null,
      farmFenceRuns: CBZ.farmFenceSolids != null ? CBZ.farmFenceSolids : null,
      redCurbs: (CBZ.city && CBZ.city.arena && CBZ.city.arena._redCurbs != null)
        ? CBZ.city.arena._redCurbs
        : ((CBZ.city && CBZ.city._redCurbs != null) ? CBZ.city._redCurbs : null),
      colliders: (CBZ.colliders && CBZ.colliders.length) | 0,
      // systems/meshcollider.js publishes its own live count: records it
      // measured, and the ones it refused (slivers / flat / oversize)
      meshColliders: CBZ.meshCollider ? {
        built: CBZ.meshCollider.stats.built, skipped: CBZ.meshCollider.stats.skipped,
        oversize: CBZ.meshCollider.stats.oversize,
      } : null,
    };
    return out;
  };

  // Street-lamp instance pools (filled by cityProps once every luminaire is
  // placed; read by hitProp when a lamp is shot out): `bulb` = the drop-lens
  // pool, `glow` = the additive LIGHT POOLS on the road, whose first N
  // instances are the lamps in lampIdx order (signal washes follow them).
  // _zeroM4 is the collapse matrix for broken instances.
  const lampPools = { bulb: null, glow: null };
  const _zeroM4 = new THREE.Matrix4().makeScale(0, 0, 0);

  // ---- shared geometry / material caches ----------------------------------
  // Hundreds of props get placed, so EVERY repeated mesh must share one geometry
  // and one material instance. Build them lazily, key by a descriptive string,
  // and never dispose (they live for the whole run).
  const GEO = new Map();
  function geo(key, make) { let g = GEO.get(key); if (!g) { g = make(); GEO.set(key, g); } return g; }
  const MAT = new Map();
  function smat(color, opts) {
    opts = opts || {};
    const key = color + "|" + (opts.emissive || 0) + "|" + (opts.ei || 0) + "|" + (opts.rough || 0);
    let m = MAT.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color });
      if (opts.emissive != null) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.ei || 0; }
      m._shared = true;
      MAT.set(key, m);
    }
    return m;
  }

  /* ======================================================================
     THE KERB KIT — street furniture drawn as the REAL objects.
     ======================================================================
     OWNER (de-slop wave): "there's just some unrealistic random slop." The
     old kerb props were 2-4 primitives each (a hydrant was a cylinder, a
     half-sphere and two stubs; a mailbox was HALF a drum with a plane nailed
     to its front and nothing under it; a news box was a coloured cube with a
     white card; a parking meter carried a glowing green face at noon), one
     scene-graph group per prop, and every bin/meter/news box's group was a
     collider REF, so core/batch.js had to leave its meshes live: three draw
     calls per bin, city-wide. That cost is why the whole layer was switched
     off and the pavements stood empty.

     NOW: each kind is ONE vertex-coloured prototype baked from the parts a
     real one has (a hydrant's base flange and bolts, barrel, breakaway ring,
     bonnet, pentagon operating nut, hose and pumper nozzles with caps and
     chains; a collection box's body, hood, legs and pull-down chute; a news
     box's door, window, the paper behind it and the coin mech ...), with a
     splash-grime band baked into the bottom 25 cm, drawn through
     street_hardware.js's chunked InstancedMesh (one per 200 m cell per kind,
     frustum-culled, shared vertex-colour Lambert). Each kind also keeps its
     ROLE geometries (snap / main / glass) so the moment a prop is knocked,
     tipped, swept or smashed it MATERIALISES: its instance collapses and a
     live group of those meshes takes its place, which is exactly the object
     tipProp / smashProp / the tsunami already animate. Nothing about how a
     prop reacts changed; only what stands there before it does.
  ====================================================================== */
  const _kb = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), s: new THREE.Vector3() };
  function Bake() { this.P = []; this.N = []; this.C = []; }
  // one primitive, transformed (Euler XYZ, three's default) and painted. The
  // bottom 25 cm of anything standing on a pavement takes splash-back grime.
  Bake.prototype.put = function (g, hex, x, y, z, rx, ry, rz, sx, sy, sz, o) {
    const src = g.index ? g.toNonIndexed() : g;
    _kb.e.set(rx || 0, ry || 0, rz || 0);
    _kb.q.setFromEuler(_kb.e);
    _kb.p.set(x || 0, y || 0, z || 0);
    _kb.s.set(sx || 1, sy || 1, sz || 1);
    _kb.m.compose(_kb.p, _kb.q, _kb.s);
    src.applyMatrix4(_kb.m);
    const pa = src.attributes.position.array, na = src.attributes.normal.array;
    const r = ((hex >> 16) & 255) / 255, gg = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    const grime = !(o && o.clean);
    for (let i = 0; i < pa.length; i += 3) {
      this.P.push(pa[i], pa[i + 1], pa[i + 2]);
      this.N.push(na[i], na[i + 1], na[i + 2]);
      const k = grime ? 1 - 0.16 * Math.max(0, 1 - pa[i + 1] / 0.25) : 1;
      this.C.push(r * k, gg * k, b * k);
    }
    if (src !== g) src.dispose();
    g.dispose();
    return this;
  };
  Bake.prototype.box = function (w, h, d, hex, x, y, z, rx, ry, rz, o) {
    return this.put(new THREE.BoxGeometry(w, h, d), hex, x, y, z, rx, ry, rz, 1, 1, 1, o);
  };
  Bake.prototype.cyl = function (rt, rb, h, seg, hex, x, y, z, rx, ry, rz, o) {
    return this.put(new THREE.CylinderGeometry(rt, rb, h, seg, 1, !!(o && o.open), (o && o.t0) || 0, (o && o.tl) || Math.PI * 2),
      hex, x, y, z, rx, ry, rz, 1, 1, 1, o);
  };
  Bake.prototype.sph = function (r, ws, hs, hex, x, y, z, sx, sy, sz, o) {
    return this.put(new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, (o && o.tl) || Math.PI), hex, x, y, z, 0, 0, 0, sx, sy, sz, o);
  };
  Bake.prototype.tor = function (R, t, rs, ts, arc, hex, x, y, z, rx, ry, rz, o) {
    return this.put(new THREE.TorusGeometry(R, t, rs, ts, arc), hex, x, y, z, rx, ry, rz, 1, 1, 1, o);
  };
  Bake.prototype.geo = function () {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.C, 3));
    g.computeBoundingSphere();
    return g;
  };
  // a kind = its role parts (for the live copy) + the whole (for the instances)
  function kindOf(roles) {
    const W = new Bake();
    const parts = [];
    for (const r of roles) {
      W.P = W.P.concat(r.b.P); W.N = W.N.concat(r.b.N); W.C = W.C.concat(r.b.C);
      parts.push({ geo: r.b.geo(), role: r.role || "main", kind: r.kind || null });
    }
    return { whole: W.geo(), parts: parts };
  }

  // Local frame for every kind: origin on the footway surface, +z faces the
  // WALK (the building side; where a person stands to use it), -z the road.
  let _kerbKit = null;
  function kerbKit() {
    if (_kerbKit) return _kerbKit;
    const K = {};
    const PI = Math.PI, HP = Math.PI / 2;

    // ---- FIRE HYDRANT (dry-barrel, 0.83 m): flange + bolts, barrel, the
    // breakaway ring, bonnet with a pentagon operating nut, two hose nozzles
    // and the big pumper nozzle toward the road, caps on chains.
    (function () {
      const RED = 0x9c2b22, RED_D = 0x7a2019, CAP = 0xc9c3b3, NUT = 0x47423e, CHAIN = 0x57524c;
      const b = new Bake();
      b.cyl(0.165, 0.178, 0.05, 14, RED_D, 0, 0.025, 0);
      for (let k = 0; k < 6; k++) { const a = k * PI / 3 + 0.3; b.cyl(0.014, 0.014, 0.024, 6, NUT, Math.cos(a) * 0.148, 0.062, Math.sin(a) * 0.148); }
      b.cyl(0.118, 0.126, 0.30, 14, RED, 0, 0.20, 0);
      b.cyl(0.146, 0.146, 0.045, 14, RED_D, 0, 0.372, 0);
      for (let k = 0; k < 6; k++) { const a = k * PI / 3; b.cyl(0.011, 0.011, 0.055, 6, NUT, Math.cos(a) * 0.136, 0.372, Math.sin(a) * 0.136); }
      b.cyl(0.122, 0.118, 0.27, 14, RED, 0, 0.52, 0);
      b.cyl(0.15, 0.15, 0.04, 14, RED_D, 0, 0.675, 0);
      b.sph(0.13, 14, 6, RED, 0, 0.692, 0, 1, 0.75, 1, { tl: HP });
      b.cyl(0.036, 0.04, 0.05, 5, NUT, 0, 0.815, 0);
      for (let s = -1; s <= 1; s += 2) {
        b.cyl(0.044, 0.048, 0.10, 10, RED, s * 0.16, 0.53, 0, 0, 0, HP);
        b.cyl(0.055, 0.055, 0.036, 10, CAP, s * 0.226, 0.53, 0, 0, 0, HP);
        b.cyl(0.021, 0.021, 0.022, 5, CAP, s * 0.254, 0.53, 0, 0, 0, HP);
        b.tor(0.046, 0.005, 3, 8, PI, CHAIN, s * 0.19, 0.50, 0, 0, 0, PI);
      }
      b.cyl(0.07, 0.076, 0.09, 12, RED, 0, 0.47, -0.16, HP, 0, 0);
      b.cyl(0.087, 0.087, 0.04, 12, CAP, 0, 0.47, -0.225, HP, 0, 0);
      b.cyl(0.027, 0.027, 0.025, 5, CAP, 0, 0.47, -0.257, HP, 0, 0);
      K.hydrant = kindOf([{ b: b, role: "main", kind: "metal" }]);
    })();

    // ---- USPS-STYLE COLLECTION BOX: a real body under the hood (the old one
    // was half a drum with nothing below it), four legs on foot plates, the
    // pull-down chute and its handle on the walk side, a panel line at the
    // back pickup door and the pickup-times label on the flank.
    (function () {
      const BLUE = 0x21427d, BLUE_D = 0x1a3566, LEG = 0x1b2230, STEEL = 0x9aa0a6, SLOT = 0x0d0f14;
      const b = new Bake();
      for (const sx of [-0.2, 0.2]) for (const sz of [-0.22, 0.22]) {
        b.box(0.045, 0.34, 0.045, LEG, sx, 0.17, sz);
        b.box(0.09, 0.012, 0.09, LEG, sx, 0.006, sz);
      }
      b.box(0.47, 0.035, 0.53, BLUE_D, 0, 0.357, 0);
      b.box(0.46, 0.62, 0.52, BLUE, 0, 0.66, 0);
      b.cyl(0.23, 0.23, 0.52, 16, BLUE, 0, 0.97, 0, -HP, 0, 0, { t0: -HP, tl: PI });
      b.box(0.47, 0.02, 0.53, BLUE_D, 0, 0.972, 0);                  // hood seam
      b.box(0.31, 0.10, 0.07, BLUE, 0, 0.93, 0.285, -0.18, 0, 0);    // pull-down chute
      b.box(0.26, 0.014, 0.012, SLOT, 0, 0.975, 0.31, -0.18, 0, 0);
      b.cyl(0.012, 0.012, 0.22, 6, STEEL, 0, 0.875, 0.322, 0, 0, HP);
      b.box(0.36, 0.44, 0.006, BLUE_D, 0, 0.64, -0.262);             // rear pickup door
      b.box(0.02, 0.05, 0.012, STEEL, 0.12, 0.64, -0.268);           // its lock
      b.box(0.006, 0.15, 0.21, 0xe3e0d6, 0.232, 0.78, 0.02);         // pickup-times label
      b.box(0.006, 0.12, 0.3, 0xe3e0d6, -0.232, 0.55, 0.0);          // flank stripe panel
      K.mailbox = kindOf([{ b: b, role: "main", kind: "metal" }]);
    })();

    // ---- LITTER BASKET: fourteen steel slats on three bands, a black liner
    // bag inside it, its lip rolled over the top rim (what a real city bin
    // looks like from a pavement), a darker base ring.
    (function () {
      const GRN = 0x2b4636, GRN_D = 0x22382b, BAG = 0x151618;
      const b = new Bake();
      b.cyl(0.272, 0.282, 0.05, 16, GRN_D, 0, 0.025, 0);
      for (let k = 0; k < 14; k++) {
        const a = k * PI * 2 / 14;
        b.box(0.078, 0.66, 0.018, GRN, Math.sin(a) * 0.266, 0.38, Math.cos(a) * 0.266, 0, a, 0);
      }
      b.cyl(0.286, 0.286, 0.07, 18, GRN_D, 0, 0.74, 0, 0, 0, 0, { open: true });
      b.cyl(0.276, 0.276, 0.04, 18, GRN_D, 0, 0.40, 0, 0, 0, 0, { open: true });
      b.cyl(0.276, 0.276, 0.035, 18, GRN_D, 0, 0.09, 0, 0, 0, 0, { open: true });
      const L = new Bake();
      L.cyl(0.25, 0.235, 0.66, 14, BAG, 0, 0.40, 0, 0, 0, 0, { open: true });
      L.sph(0.25, 14, 4, 0x1c1d20, 0, 0.66, 0, 1, 0.28, 1, { tl: HP });   // the bag's contents
      L.tor(0.27, 0.02, 4, 18, PI * 2, BAG, 0, 0.775, 0, HP, 0, 0);     // liner rolled over the rim
      K.bin = kindOf([{ b: b, role: "main", kind: "metal" }, { b: L, role: "main", kind: "plastic" }]);
    })();

    // ---- SINGLE-SPACE PARKING METER: pipe post on a flange, cast housing,
    // chrome dome with a dark window front and back, coin slot, knob, lock,
    // and the little red violation flag. No emissive face: an LCD does not
    // glow at noon.
    (function () {
      const POST = 0x6a7076, HOUSE = 0x3c4448, DOME = 0x80878d, CHROME = 0xaeb3b6, DARK = 0x16191b;
      const p = new Bake();
      p.cyl(0.07, 0.075, 0.025, 10, POST, 0, 0.0125, 0);
      p.cyl(0.036, 0.04, 1.02, 10, POST, 0, 0.52, 0);
      const h = new Bake();
      h.box(0.20, 0.035, 0.16, HOUSE, 0, 1.045, 0);
      h.box(0.19, 0.20, 0.15, HOUSE, 0, 1.16, 0);
      h.cyl(0.096, 0.096, 0.15, 16, DOME, 0, 1.28, 0, HP, 0, 0);
      h.box(0.06, 0.018, 0.012, DARK, 0, 1.19, 0.078);                 // coin slot
      h.cyl(0.026, 0.026, 0.03, 10, CHROME, 0, 1.105, 0.085, HP, 0, 0); // knob
      h.cyl(0.014, 0.014, 0.02, 8, CHROME, 0.06, 1.1, -0.08, HP, 0, 0); // lock
      const w = new Bake();
      for (const s of [1, -1]) {
        w.cyl(0.07, 0.07, 0.008, 16, 0x2b3632, 0, 1.285, s * 0.077, HP, 0, 0, { clean: true });
        w.box(0.032, 0.012, 0.004, 0xa22d25, -0.02, 1.26, s * 0.082, 0, 0, 0.35, { clean: true });   // expired flag
      }
      K.meter = kindOf([{ b: p, role: "snap", kind: "metal" }, { b: h, role: "main", kind: "metal" }, { b: w, role: "main", kind: "glass" }]);
    })();

    // ---- COIN-OP NEWS BOX (three liveries): body on a pedestal skid, a
    // sloped lid, the door frame and window with TODAY'S PAPER behind it
    // (masthead, headline, a photo block, columns), the coin mechanism on top
    // of the door, and the pull handle.
    const NEWS_LIVERY = [0x9d2e28, 0x2c5793, 0xc99a24];
    NEWS_LIVERY.forEach(function (col, vi) {
      const dcol = ((((col >> 16) & 255) * 0.78) << 16) | ((((col >> 8) & 255) * 0.78) << 8) | ((col & 255) * 0.78);
      const STEEL = 0x2a2d31, MECH = 0x8e959a;
      const b = new Bake();
      b.box(0.5, 0.03, 0.4, STEEL, 0, 0.015, 0);
      for (const sx of [-0.17, 0.17]) b.cyl(0.022, 0.022, 0.32, 8, STEEL, sx, 0.19, -0.02);
      b.box(0.5, 0.66, 0.44, col, 0, 0.67, 0);
      b.box(0.54, 0.05, 0.49, dcol, 0, 1.03, 0.01, -0.07, 0, 0);
      b.box(0.44, 0.52, 0.02, dcol, 0, 0.71, 0.228);
      b.box(0.13, 0.15, 0.07, MECH, 0.14, 0.93, 0.26);
      b.box(0.012, 0.05, 0.006, 0x14161a, 0.14, 0.95, 0.296);
      b.box(0.17, 0.028, 0.03, MECH, 0, 0.52, 0.255);
      const w = new Bake();
      const PAPER = 0xd8d4c8, INK = 0x24262a, GREY = 0x6b6d70;
      w.box(0.34, 0.28, 0.005, PAPER, -0.02, 0.76, 0.24, 0, 0, 0, { clean: true });
      w.box(0.30, 0.045, 0.004, INK, -0.02, 0.87, 0.244, 0, 0, 0, { clean: true });
      w.box(0.28, 0.02, 0.004, 0x3a3c40, -0.02, 0.83, 0.244, 0, 0, 0, { clean: true });
      w.box(0.12, 0.095, 0.004, 0x7c8186, -0.10, 0.76, 0.244, 0, 0, 0, { clean: true });
      for (let k = 0; k < 5; k++) w.box(0.12, 0.006, 0.004, GREY, 0.07, 0.785 - k * 0.018, 0.244, 0, 0, 0, { clean: true });
      for (let k = 0; k < 3; k++) w.box(0.26, 0.006, 0.004, GREY, -0.02, 0.695 - k * 0.018, 0.244, 0, 0, 0, { clean: true });
      K["newsbox" + vi] = kindOf([{ b: b, role: "main", kind: "metal" }, { b: w, role: "main", kind: "glass" }]);
    });
    K.newsVariants = NEWS_LIVERY.length;

    // ---- PARK / BUS-STOP BENCH (1.8 m): cast-iron end frames (raked rear
    // leg, seat bearer, arm on its post), four seat slats, three raked back
    // slats. Cushion (the slat tops) 0.46 m. Front = +z.
    (function () {
      const IRON = 0x2a2d30, WOOD = 0x7b5634, WOOD2 = 0x6e4c2e;
      const b = new Bake(), L = 1.8;
      for (let s = -1; s <= 1; s += 2) {
        const x = s * (L / 2 - 0.1);
        b.box(0.05, 0.43, 0.05, IRON, x, 0.215, 0.19);
        b.box(0.05, 0.86, 0.05, IRON, x, 0.43, -0.2, -0.14, 0, 0);
        b.box(0.05, 0.045, 0.47, IRON, x, 0.415, 0);
        b.box(0.05, 0.04, 0.38, IRON, x, 0.64, 0.02);
        b.box(0.04, 0.2, 0.04, IRON, x, 0.53, 0.2);
        b.box(0.09, 0.015, 0.1, IRON, x, 0.0075, 0.19);
        b.box(0.09, 0.015, 0.1, IRON, x, 0.0075, -0.26);
      }
      const sz = [0.17, 0.06, -0.05, -0.16];
      for (let k = 0; k < 4; k++) b.box(L, 0.032, 0.092, k % 2 ? WOOD2 : WOOD, 0, 0.444, sz[k], 0, 0, 0, { clean: true });
      for (let k = 0; k < 3; k++) b.box(L, 0.09, 0.03, k % 2 ? WOOD2 : WOOD, 0, 0.57 + k * 0.12, -0.215 - k * 0.017, -0.14, 0, 0, { clean: true });
      K.bench = kindOf([{ b: b, role: "main", kind: "wood" }]);
    })();

    // ---- TREE GRATE (1.2 m cast iron) over a mulch pit: the street tree
    // stands IN the pavement, not in a concrete box on top of it.
    (function () {
      const IRON = 0x2d2b29, RUST = 0x4a3526, MULCH = 0x2e241b;
      const b = new Bake();
      b.box(1.18, 0.006, 1.18, MULCH, 0, 0.004, 0, 0, 0, 0, { clean: true });
      for (let s = -1; s <= 1; s += 2) {
        b.box(1.24, 0.022, 0.06, IRON, 0, 0.011, s * 0.59, 0, 0, 0, { clean: true });
        b.box(0.06, 0.022, 1.24, IRON, s * 0.59, 0.011, 0, 0, 0, 0, { clean: true });
        b.box(0.62, 0.02, 0.04, RUST, 0, 0.012, s * 0.3, 0, 0, 0, { clean: true });
        b.box(0.04, 0.02, 0.62, RUST, s * 0.3, 0.012, 0, 0, 0, 0, { clean: true });
      }
      for (let k = 0; k < 12; k++) {
        const a = k * PI / 6;
        b.box(0.03, 0.018, 0.3, IRON, Math.sin(a) * 0.45, 0.011, Math.cos(a) * 0.45, 0, a, 0, { clean: true });
      }
      K.grate = kindOf([{ b: b, role: "keep", kind: "metal" }]);
    })();

    // ---- BUS STOP SIGN POLE: galvanised post, the plate rides on the sign
    // atlas (street_furniture.js), a timetable case at eye height.
    (function () {
      const GALV = 0xa3a9ac;
      const b = new Bake();
      b.cyl(0.035, 0.038, 2.9, 8, GALV, 0, 1.45, 0);
      b.cyl(0.07, 0.07, 0.03, 8, 0x80868a, 0, 0.015, 0);
      b.box(0.26, 0.36, 0.05, 0x2a2f35, 0, 1.45, 0.05);               // timetable case
      b.box(0.22, 0.30, 0.004, 0xdcd8cc, 0, 1.45, 0.077, 0, 0, 0, { clean: true });
      K.busPole = kindOf([{ b: b, role: "main", kind: "metal" }]);
    })();


    // ---- BIKE RACK: three galvanised inverted-U staples on foot plates -----
    (function () {
      const GALV = 0x9da3a6;
      const b = new Bake();
      for (const x of [-0.8, 0, 0.8]) {
        b.tor(0.28, 0.024, 6, 14, PI, GALV, x, 0.52, 0);
        for (const s of [-1, 1]) {
          b.cyl(0.024, 0.024, 0.52, 8, GALV, x + s * 0.28, 0.26, 0);
          b.box(0.1, 0.012, 0.1, 0x80868a, x + s * 0.28, 0.006, 0);
        }
      }
      K.bikerack = kindOf([{ b: b, role: "main", kind: "metal" }]);
    })();

    // ---- PROPANE EXCHANGE CAGE: a steel cabinet with wire-mesh doors and
    // two rows of swap tanks behind them (collar, valve, foot ring).
    (function () {
      const STEEL = 0x5a6167, MESH = 0x7b8288, TANK = 0xd9dad6, TANK2 = 0x3d6aa0, BRASS = 0xa98a4a;
      const c = new Bake();
      c.box(1.3, 0.1, 0.72, STEEL, 0, 0.05, 0);
      c.box(1.3, 0.05, 0.72, STEEL, 0, 1.2, 0);
      for (const sx of [-0.63, 0.63]) for (const sz of [-0.34, 0.34]) c.box(0.045, 1.15, 0.045, STEEL, sx, 0.62, sz);
      c.box(1.3, 0.035, 0.035, STEEL, 0, 0.62, 0.34);
      c.box(0.03, 1.1, 0.03, STEEL, 0, 0.62, 0.35);                      // door meeting stile
      for (let k = 0; k < 13; k++) c.box(0.012, 1.08, 0.012, MESH, -0.6 + k * 0.1, 0.63, 0.345, 0, 0, 0, { clean: true });
      for (let k = 0; k < 6; k++) c.box(1.24, 0.012, 0.012, MESH, 0, 0.16 + k * 0.19, 0.345, 0, 0, 0, { clean: true });
      for (const sx of [-0.635, 0.635]) {
        for (let k = 0; k < 7; k++) c.box(0.012, 1.08, 0.012, MESH, sx, 0.63, -0.3 + k * 0.1, 0, 0, 0, { clean: true });
        for (let k = 0; k < 6; k++) c.box(0.012, 0.012, 0.66, MESH, sx, 0.16 + k * 0.19, 0, 0, 0, 0, { clean: true });
      }
      c.box(0.04, 0.12, 0.03, 0xc9a23c, 0.1, 0.62, 0.37);               // padlock hasp
      const t = new Bake();
      for (let row = 0; row < 2; row++) for (let k = 0; k < 3; k++) {
        const x = -0.4 + k * 0.4, z = row ? -0.16 : 0.16, y0 = 0.1 + row * 0.0;
        const col = (row + k) % 3 === 0 ? TANK2 : TANK;
        t.cyl(0.15, 0.15, 0.4, 12, col, x, y0 + 0.28, z);
        t.sph(0.15, 12, 4, col, x, y0 + 0.48, z, 1, 0.45, 1, { tl: HP });
        t.cyl(0.13, 0.13, 0.06, 12, 0x8a8e91, x, y0 + 0.05, z, 0, 0, 0, { open: true });
        t.cyl(0.09, 0.09, 0.1, 10, 0x8a8e91, x, y0 + 0.6, z, 0, 0, 0, { open: true });
        t.cyl(0.025, 0.025, 0.06, 6, BRASS, x, y0 + 0.585, z);
      }
      K.propane = kindOf([{ b: c, role: "main", kind: "metal" }, { b: t, role: "main", kind: "metal" }]);
    })();

    // ---- BISTRO TABLE: round top on a pedestal, cast base. And the chair:
    // round seat, splayed legs, a bent back hoop.
    (function () {
      const ALU = 0x9aa1a6, DARK = 0x2e3236;
      const b = new Bake();
      b.cyl(0.36, 0.36, 0.025, 20, ALU, 0, 0.735, 0);
      b.cyl(0.35, 0.34, 0.02, 20, DARK, 0, 0.715, 0);
      b.cyl(0.028, 0.034, 0.7, 8, DARK, 0, 0.37, 0);
      b.cyl(0.22, 0.24, 0.025, 14, DARK, 0, 0.0125, 0);
      K.bistroTable = kindOf([{ b: b, role: "main", kind: "metal" }]);
      const c = new Bake();
      c.cyl(0.2, 0.2, 0.03, 16, ALU, 0, 0.45, 0);
      for (let k = 0; k < 4; k++) {
        const a = PI / 4 + k * HP, sx = Math.cos(a), sz = Math.sin(a);
        c.cyl(0.012, 0.012, 0.46, 6, DARK, sx * 0.17, 0.225, sz * 0.17, -sz * 0.12, 0, sx * 0.12);
      }
      c.tor(0.17, 0.012, 5, 12, PI, DARK, 0, 0.78, -0.17, -0.12, 0, 0);
      for (const s of [-1, 1]) c.cyl(0.012, 0.012, 0.33, 6, DARK, s * 0.17, 0.62, -0.18, -0.12, 0, 0);
      K.bistroChair = kindOf([{ b: c, role: "main", kind: "metal" }]);
    })();

    _kerbKit = K;
    return K;
  }
  // shared with city/buildings.js's parks (the same bench, the same baker for
  // the park railing) so there is one outdoor-furniture vocabulary, not two
  CBZ.kerbKit = kerbKit;
  CBZ.kerbBake = function () { return new Bake(); };

  // ============================================================
  //  FAKE-GLOW FRESNEL SHELL (Stemkoski Shader-Glow / ektogamat fake-glow-
  //  material technique, hand-ported to a plain ShaderMaterial string — no
  //  post-processing bloom pass, just a view-dependent rim on a slightly
  //  bigger shell around the real bulb). WHY: with hundreds of bulbs city-
  //  wide, a real light source per bulb is a non-starter (see the POOLED
  //  POINT-LIGHT section below for why), and a flat emissive box alone reads
  //  as a dim rectangle at any distance — the Fresnel rim gives every bulb a
  //  convincing halo for the cost of one extra tiny shell tri-strip, additive-
  //  blended so overlapping shells only ever brighten, never occlude.
  //
  //  ONE InstancedMesh per colour (bulbs only ever need a handful of colours:
  //  warm streetlamp white + red/yellow/green signals), so citywide bulb
  //  count adds ZERO new draw calls beyond these few pooled meshes — matches
  //  this file's existing geo()/smat() sharing discipline, just extended to
  //  ShaderMaterial + InstancedMesh for this one repeated visual.
  //
  //  Per-instance "on/off" without touching instance COUNT: an instanced
  //  aGlow float attribute (0=dark/broken, 1=lit) lets a shot-out streetlamp
  //  or a signal's off-phase colour go dark without reshuffling indices —
  //  same idiom as systems/dustfx.js's per-vertex aFade attribute.
  // ============================================================
  const glowShellGeo = geo("glowShell", () => new THREE.SphereGeometry(1, 8, 6));
  function makeGlowShellMat(colorHex) {
    if (!THREE.ShaderMaterial) return null;    // minimal/headless THREE stub — caller skips the shell entirely
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(colorHex) } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: [
        "attribute float aGlow;",
        "varying float vGlow;",
        "varying vec3 vNormal;",
        "varying vec3 vViewDir;",
        "void main() {",
        "  vGlow = aGlow;",
        "  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);",
        "  vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);",
        "  vViewDir = normalize(-mv.xyz);",
        "  gl_Position = projectionMatrix * mv;",
        "}",
      ].join("\n"),
      fragmentShader: [
        "precision mediump float;",
        "uniform vec3 uColor;",
        "varying float vGlow;",
        "varying vec3 vNormal;",
        "varying vec3 vViewDir;",
        "void main() {",
        // classic Fresnel rim: glancing angles (normal perpendicular to the
        // view) glow brightest, face-on reads almost clear — the fake-glow-
        // material look, no lighting model needed at all.
        "  float rim = 1.0 - max(0.0, dot(normalize(vNormal), normalize(vViewDir)));",
        "  float fres = pow(rim, 2.2);",
        "  gl_FragColor = vec4(uColor, fres * vGlow * 0.85);",
        "}",
      ].join("\n"),
    });
    m._shared = true;
    return m;
  }
  // one small pooled InstancedMesh per glow colour. `cap` instances are
  // pre-allocated (never resized); positions/scales are written once at
  // build time from the collected spot list, aGlow toggled later by index
  // for broken lamps / dark signal phases. Returns null (headless-safe) if
  // ShaderMaterial/InstancedMesh aren't available or there's nothing to draw.
  function buildGlowShellPool(colorHex, spots, sizeScale) {
    if (!spots.length) return null;
    const mat2 = makeGlowShellMat(colorHex);
    if (!mat2) return null;
    // per-pool geometry CLONE: the aGlow instanced attribute below is
    // per-pool state — setting it on the shared prototype let the last-built
    // pool (green) drive every pool's shells (red+yellow halos lit during
    // green phase, no halo at all during red/yellow).
    const im = new THREE.InstancedMesh(glowShellGeo.clone(), mat2, spots.length);
    im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false;
    im.userData.terrain = true;   // farcull: city-spanning pool, prototype bounds
                                  // sit at the origin — never distance-cull it
    im.renderOrder = 5;
    const aGlow = new Float32Array(spots.length).fill(1);
    // real THREE.BufferGeometry supports setAttribute on the instanced mesh's
    // geometry for a per-instance attribute keyed by gl_InstanceID via the
    // standard "instanced attribute" divisor path r128 wires automatically
    // when the attribute lives on the geometry of an InstancedMesh.
    if (im.geometry && im.geometry.setAttribute && THREE.InstancedBufferAttribute) {
      const attr = new THREE.InstancedBufferAttribute(aGlow, 1);
      im.geometry.setAttribute("aGlow", attr);
      im._aGlowAttr = attr;
    }
    im._aGlow = aGlow;
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q0 = new THREE.Quaternion(), s = new THREE.Vector3();
    spots.forEach((sp, i) => {
      p.set(sp.x, sp.y, sp.z);
      s.set(sp.r || sizeScale, sp.r || sizeScale, sp.r || sizeScale);
      m4.compose(p, q0, s);
      im.setMatrixAt(i, m4);
      sp.glowIndex = i; sp.glowPool = im;   // let the caller dim/relight this exact instance later
    });
    im.instanceMatrix.needsUpdate = true;
    return im;
  }
  // dim or relight one instance in a glow-shell pool (e.g. a shot-out
  // streetlamp, or a traffic phase that isn't the currently-lit colour)
  // without touching the shared instance count/order.
  function setGlowOn(spot, on) {
    if (!spot || !spot.glowPool || spot.glowIndex == null) return;
    const im = spot.glowPool;
    if (!im._aGlow) return;
    im._aGlow[spot.glowIndex] = on ? 1 : 0;
    if (im._aGlowAttr) im._aGlowAttr.needsUpdate = true;
  }

  // ============================================================
  //  SHOOTABLE STREET PROPS — the street REACTS to gunfire (USER-FILMED:
  //  "shooting objects feels wrong"). gunfx.js routes every shot LINE here
  //  (CBZ.cityShootProp); we test the few registered props near the segment
  //  and answer in kind: a streetlight SHATTERS DARK, a hydrant POPS a
  //  20-second water geyser (the classic showpiece), trash cans / news boxes
  //  / cones get KNOCKED FLYING, bolted steel (mailboxes, meters) rings and
  //  keeps the pock. WHY: a block you just shot up must LOOK shot up —
  //  that's the show-off receipt. COST: a cheap segment-vs-point scan over a
  //  flat registry (a few flops per prop per tracer), pooled water sprites,
  //  tip animations that touch only group transform — zero new draw calls
  //  beyond the pooled droplets.
  // ============================================================
  let shootables = [];                  // {type,x,z,y,r,...} registered at build
  const knocks = [];                    // props mid-tip
  const geysers = [];                   // popped hydrants {x,z,t,acc}
  const drops = [];                     // live water droplets
  const dropPool = [];
  // NO-DECOY FIX: light street furniture (bin/meter/newsbox/cone) used to be
  // shootable but utterly car-transparent — a car ploughed straight through a
  // trash can with zero reaction. carKnockables mirrors the record a car can
  // actually clip (x,z,r + the SAME group/over fields the shootables record
  // for that prop already carries, so a bullet-knock and a bumper-knock share
  // one "is it already tipped" flag and never double-animate the same prop).
  const carKnockables = [];             // {type,x,z,r,group,ref} — scanned vs CBZ.cityCars
  let waterTex = null;
  const deadLampM = new THREE.MeshLambertMaterial({ color: 0x202329 });
  deadLampM._shared = true;             // survives any teardown traversal
  const _qTip = new THREE.Quaternion(), _axTip = new THREE.Vector3();
  // headless-safe: real THREE.Quaternion always has setFromAxisAngle/multiply;
  // a minimal test stub (tools/harness.js) may not. Feature-detect ONCE so the
  // knock-over animator below can skip the rotation math gracefully instead of
  // throwing — this only ever matters off-browser (harness.js now legitimately
  // reaches tipProp via ordinary traffic driving past a bin/cone/newsbox/meter
  // over a long simulated run, a path nothing exercised before).
  const _hasFullQuat = typeof _qTip.setFromAxisAngle === "function" && typeof _qTip.multiply === "function";

  function waterTexture() {
    if (waterTex) return waterTex;
    const c = document.createElement("canvas"); c.width = c.height = 32;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(16, 16, 1, 16, 16, 15);
    gr.addColorStop(0, "rgba(235,245,255,0.95)");
    gr.addColorStop(0.55, "rgba(180,210,235,0.55)");
    gr.addColorStop(1, "rgba(150,190,225,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    waterTex = new THREE.CanvasTexture(c);
    return waterTex;
  }
  function takeDrop() {
    let s = dropPool.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: waterTexture(), transparent: true, opacity: 0, depthWrite: false }));
      s.renderOrder = 8;
      CBZ.scene.add(s);
    }
    s.visible = true;
    return s;
  }
  // knock a prop over AWAY from the shot: rotate about the horizontal axis
  // perpendicular to the bullet, slide it along, light things hop. Composes
  // with the prop's own yaw via quaternion (q0) — touches transform only.
  function tipProp(s, dirX, dirZ, hop, slide) {
    if (s.over || !s.group) return;
    if (s._mz) s._mz(s);                  // kerb-kit instance -> live group
    s.over = true;
    const dl = Math.hypot(dirX, dirZ) || 1; dirX /= dl; dirZ /= dl;
    // headless-safe: a minimal Quaternion stub (tools/harness.js — it never
    // exercised this path before the car-knock scan below started reaching
    // props during ordinary traffic simulation) may lack .clone(); real THREE
    // always has it, so this fallback is a no-op in the browser.
    const q0 = (s.group.quaternion && s.group.quaternion.clone) ? s.group.quaternion.clone() : s.group.quaternion;
    knocks.push({
      g: s.group, t: 0, dur: 0.4 + Math.random() * 0.18,
      axx: dirZ, axz: -dirX,                  // tips the top toward +dir
      ang: 1.4 + Math.random() * 0.18,
      x0: s.group.position.x, y0: s.group.position.y, z0: s.group.position.z,
      sx: dirX * slide, sz: dirZ * slide, hop: hop || 0,
      q0,
    });
  }
  // one shot reaction, by what the round actually hit
  function hitProp(s, p, n, d) {
    const imp = CBZ.bulletImpact, hole = CBZ.bulletHole;
    if (s.smashed) return s;                           // already lying in pieces
    if (s.type === "lamp") {
      if (imp) imp(p, n, { kind: "spark", power: 1.2 });
      if (!s.broken) {
        killLamp(s);
        if (imp) imp(p, { x: n.x, y: -0.6, z: n.z }, { kind: "chip", power: 1.2, color: 0xdfe9f2 });   // glass rains down
      }
    } else if (s.type === "hydrant") {
      if (imp) imp(p, n, { kind: "spark", power: 1 });
      if (hole) hole(p, n, { size: 0.16, surface: "carpaint" });
      if (!s.gy || s.gy.t <= 0) {                      // POP — the street fountain
        s.gy = { x: s.x, z: s.z, t: 20, acc: 0 };
        geysers.push(s.gy);
      } else s.gy.t = Math.max(s.gy.t, 12);            // re-shot: keep it gushing
    } else if (s.type === "bin") {
      if (imp) imp(p, n, { kind: "chip", power: 0.9, color: 0x356b3e });
      // tip FIRST (it swaps a kerb-kit instance for the live group), then
      // mount the hole ON that group — a scene-parented hole stayed hanging
      // in the air where the bin used to stand once it went over.
      tipProp(s, d.x, d.z, 0, 0.45);
      if (hole) hole(p, n, { size: 0.15, surface: "carpaint", parent: s.group || undefined });
    } else if (s.type === "newsbox") {
      if (imp) imp(p, n, { kind: "chip", power: 0.8, color: 0x9aa0a8 });
      tipProp(s, d.x, d.z, 0.1, 0.6);
      if (hole) hole(p, n, { size: 0.14, surface: "carpaint", parent: s.group || undefined });
    } else if (s.type === "cone") {
      if (imp) imp(p, n, { kind: "chip", power: 0.6, color: 0xff6a1a });
      tipProp(s, d.x, d.z, 0.3, 1.5);                  // light plastic FLIES
    } else if (s.type === "propane") {
      // PROPS_WIRED_V1: a propane cage COOKS OFF. The first rounds ring the
      // steel and split a tank (spark), and the hit that drops hp to 0 DETONATES
      // — exactly once, guarded by s.exploded (a second tracer the same frame,
      // or the blast's own collateral, can't re-pop it: demolition.js's
      // opts._demoSeen idiom). It routes through the EXACT player-blast chain a
      // frag/C4 fire (crashfx cityExplosion byPlayer → kills+heat to you, +
      // shatter + a witnessed crime + a cop alarm). We do NOT fork heat: these
      // are the same cityCrime/cityAlarm calls combat.js's grenade already makes.
      if (imp) imp(p, n, { kind: "spark", power: 1.2 });
      if (hole) hole(p, n, { size: 0.14, surface: "metal" });
      if (!s.exploded) {
        s.hp = (s.hp || 1) - 1;
        if (s.hp <= 0) cookOff(s, true);
      }
    } else {                                           // mailbox / meter: bolted steel
      if (imp) imp(p, n, { kind: "spark", power: 0.9 });
      if (hole) hole(p, n, { size: 0.13, surface: "carpaint" });
    }
    return s;
  }
  /* PUBLIC: the flat shootable-prop registry, read-only by convention. The
     tsunami reads it to entrain the LIGHT street furniture (bin / newsbox /
     cone — things that would genuinely float) as real debris: it marks the
     record `over` through the same flag a bullet-knock or bumper-clip uses,
     so a prop the water took can never be tipped twice. */
  CBZ.cityStreetShootables = function () { return shootables; };

  // PUBLIC: a shot travelled from→to — react the nearest registered prop the
  // line passes through (within its radius). Returns the prop record or null.
  CBZ.cityShootProp = function (from, to) {
    if (!shootables.length || !from || !to) return null;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-4) return null;
    let best = null, bt = 2;
    for (let i = 0; i < shootables.length; i++) {
      const s = shootables[i];
      if (s.smashed) continue;
      const ox = s.x - from.x, oy = s.y - from.y, oz = s.z - from.z;
      const t = (ox * dx + oy * dy + oz * dz) / len2;
      if (t < 0 || t > 1 || t >= bt) continue;
      const mx = ox - dx * t, my = oy - dy * t, mz = oz - dz * t;
      if (mx * mx + my * my + mz * mz > s.r * s.r) continue;
      bt = t; best = s;
    }
    if (!best) return null;
    const il = 1 / Math.sqrt(len2);
    return hitProp(best,
      { x: from.x + dx * bt, y: from.y + dy * bt, z: from.z + dz * bt },
      { x: -dx * il, y: -dy * il, z: -dz * il },
      { x: dx * il, z: dz * il });
  };
  /* ======================================================================
     STREET PROPS BREAK INTO THEMSELVES (REAL DEBRIS, 2026-09-27)
     ======================================================================
     OWNER: "I hate big cubes of fake debris. Make debris realer, all from the
     prop itself." A prop used to have two reactions: tip over, or nothing
     (an RPG into a lamp post was blast FX around a lamp that stood there
     untouched). Now a blast or a hard hit BREAKS it through CBZ.debris, cut
     from its own meshes: a lamp mast snaps at the hit and the stump stays
     planted, the head and arm fall as their own pieces, a pallet splinters
     along the grain, a crown comes apart into clumps and leaves, a bin cracks
     into a few plastic shards, a hydrant is iron and only a very close heavy
     blast shears it off whole.

     Still NOT a wall (memory: props-are-not-walls). Nothing here carves; the
     prop's colliders keep noBreach. It is a separate, deliberate reaction.

     WHY THE TEMP GROUP. core/batch.js merges a prop's inert meshes into
     per-tile buffers and DETACHES the originals (parent = null), and
     city/localinst.js instances some of the rest. So the prop that is drawn
     is not the prop's scene graph any more. Each breakable records its meshes
     at BUILD time (before batching); on a break we rebuild a throwaway group
     from those meshes' own geometry + material + local transform under the
     group's current world matrix (a tipped bin breaks where it lies), hand
     THAT to CBZ.debris, and hide the drawn copy with CBZ.batchHideGroup (the
     merged slices + local instances, the demolition contract) plus the live
     group itself. Instanced lamp bulbs get a temp mesh of the pool's own
     geometry at the lamp's own bulb offset, and the instance is zero-scaled
     through the same broken-lamp path a bullet uses.
  ====================================================================== */
  // per type: kind (debris material), need (effective force to break),
  // keepCol (leave the collider: a stump / a planter box still stands),
  // whole (heavy iron: comes off in one piece or not at all), maxD (whole
  // only: never further than this from the blast), pieces (budget cap).
  const BREAK = {
    lamp:     { kind: "metal",   need: 0.45, keepCol: true,  pieces: 12, carBreak: true },
    signal:   { kind: "metal",   need: 0.45, keepCol: true,  pieces: 12, carBreak: true },
    meter:    { kind: "metal",   need: 0.3,  keepCol: false, pieces: 6,  carBreak: true },
    bin:      { kind: "plastic", need: 0.12, pieces: 6, carBreak: true },
    newsbox:  { kind: "metal",   need: 0.25, pieces: 8, carBreak: true },
    cone:     { kind: "plastic", need: 0.06, pieces: 3, carBreak: true },
    mailbox:  { kind: "metal",   need: 0.8,  whole: true, maxD: 4 },
    hydrant:  { kind: "metal",   need: 1.1,  whole: true, maxD: 2.6 },
    tree:     { kind: "wood",    need: 0.3,  keepCol: true, pieces: 12, carBreak: true },
    shrub:    { kind: "foliage", need: 0.18, keepCol: true, pieces: 6 },
    aframe:   { kind: "wood",    need: 0.12, pieces: 6, carBreak: true },
    patio:    { kind: "plastic", need: 0.2,  pieces: 12, carBreak: true },
    bikerack: { kind: "metal",   need: 0.6,  pieces: 6 },
    propane:  { kind: "metal",   need: 0.5,  pieces: 10 },
    shelter:  { kind: "metal",   need: 0.55, pieces: 14 },
  };
  // world/street_furniture.js's instanced batches (CBZ.detailKit). Dumpsters
  // are a tonne of steel and sign posts carry their faces in a separate sheet
  // (a snapped post would leave the sign hanging in the air) — both stay out.
  const DK_BREAK = {
    "pallets":    { kind: "wood",    need: 0.15, pieces: 8, carBreak: true },
    "crate":      { kind: "wood",    need: 0.2,  pieces: 10, carBreak: true },
    "barrier":    { kind: "plastic", need: 0.15, pieces: 8, carBreak: true },
    "trash-bags": { kind: "plastic", need: 0.08, pieces: 3, carBreak: true },
    "bike":       { kind: "metal",   need: 0.3,  whole: true, maxD: 6, carBreak: true },
    "bollard":    { kind: "metal",   need: 1.2,  whole: true, maxD: 2.4 },
  };
  const DK_CAR = {};
  for (const k in DK_BREAK) if (DK_BREAK[k].carBreak) DK_CAR[k] = true;
  const BLAST_MAX_PROPS = 6;              // nearest N props per blast actually break
  const CAR_BREAK_V = 14;                 // m/s: below this a bumper tips, above it breaks

  let breakables = [];                    // {type, x, z, g, parts, cols, rec, smashed}
  const bgrid = new Map();                // 16 m cells -> breakables, for the per-frame car scan
  const BCELL = 16;
  function bkey(ix, iz) { return ix * 8192 + iz; }
  function regBreakable(b) {
    breakables.push(b);
    const k = bkey(Math.floor(b.x / BCELL), Math.floor(b.z / BCELL));
    let a = bgrid.get(k); if (!a) { a = []; bgrid.set(k, a); }
    a.push(b);
    return b;
  }
  function breakablesNear(x, z, R, out) {
    out.length = 0;
    const i0 = Math.floor((x - R) / BCELL), i1 = Math.floor((x + R) / BCELL);
    const j0 = Math.floor((z - R) / BCELL), j1 = Math.floor((z + R) / BCELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = bgrid.get(bkey(i, j)); if (!a) continue;
      for (let n = 0; n < a.length; n++) {
        const b = a[n]; if (b.smashed) continue;
        const dx = b.x - x, dz = b.z - z;
        if (dx * dx + dz * dz <= R * R) out.push(b);
      }
    }
    return out;
  }
  const _near = [];

  // the lamp goes dark: bulb + glow instances zero-scaled, the per-mesh bulb
  // swapped dead, its Fresnel shell dimmed, and (via .broken) the pooled
  // real-light driver stops choosing it. Shared by a bullet and a break.
  function killLamp(s) {
    if (!s || s.broken) return;
    s.broken = true;
    if (s.lampIdx != null && lampPools.bulb) {
      lampPools.bulb.setMatrixAt(s.lampIdx, _zeroM4);
      lampPools.bulb.instanceMatrix.needsUpdate = true;
      if (lampPools.glow) {
        lampPools.glow.setMatrixAt(s.lampIdx, _zeroM4);
        lampPools.glow.instanceMatrix.needsUpdate = true;
      }
    }
    if (s.bulb) s.bulb.material = deadLampM;
    if (s.glow) s.glow.visible = false;
    setGlowOn(s.glowSpot, false);
  }
  // a signal head dies: its three instanced bulbs collapse, its glow shells
  // go dark and stay dark (the sync driver reads cand.dead), no pooled light.
  // A mast-arm installation is one breakable per POLE: cand.heads lists every
  // head bolted to it ({head, spots}), cand.cands its pooled-light candidates,
  // cand.peds its pedestrian heads. The single-head shape still works.
  function killSignal(b) {
    const c = b.cand;
    if (!c || c.dead) return;
    c.dead = true;
    const heads = c.heads || [c];
    for (const hs of heads) {
      hs.dead = true;
      if (hs.head) hs.head.dead = true;                 // the road wash reads this
      for (const k of ["red", "yel", "grn"]) {
        const h = hs.head && hs.head[k];
        if (h && h.sigPool && h.sigIdx != null) { h.sigPool.setMatrixAt(h.sigIdx, _zeroM4); h.sigPool.instanceMatrix.needsUpdate = true; }
        if (hs.spots) setGlowOn(hs.spots[k], false);
      }
    }
    if (c.cands) for (const x of c.cands) x.dead = true;
    if (c.peds) for (const p of c.peds) {
      p.dead = true;
      for (const h of [p.hand, p.walk]) {
        if (h && h.pool && h.idx != null) { h.pool.setMatrixAt(h.idx, _zeroM4); h.pool.instanceMatrix.needsUpdate = true; }
      }
    }
  }

  const _tm = new THREE.Matrix4(), _tv = new THREE.Vector3(), _tq = new THREE.Quaternion(), _ts = new THREE.Vector3();
  // throwaway group of this prop's recorded meshes with the given role,
  // under the prop group's CURRENT world matrix. Not added to the scene.
  function tempOf(b, role) {
    const T = new THREE.Group();
    b.g.updateWorldMatrix(true, false);
    b.g.matrixWorld.decompose(_tv, _tq, _ts);
    T.position.copy(_tv); T.quaternion.copy(_tq); T.scale.copy(_ts);
    let n = 0;
    for (const p of b.parts) {
      if ((p.role || "main") !== role || !p.m || !p.m.geometry) continue;
      const m = new THREE.Mesh(p.m.geometry, p.mat || p.m.material);
      m.position.copy(p.m.position); m.quaternion.copy(p.m.quaternion); m.scale.copy(p.m.scale);
      m.userData.debrisKind = p.kind || BREAK[b.type].kind;
      m.castShadow = true;
      T.add(m); n++;
    }
    return n ? T : null;
  }
  // ONE rigid body from a whole group: CBZ.debris.adopt makes one body per
  // mesh, which would throw a hydrant's cap and nozzles off separately. Bake
  // the group's meshes (world space) into one geometry with a material group
  // per mesh, so the iron comes off its bolts in one piece.
  function wholeSource(T) {
    T.updateWorldMatrix(true, true);
    const P = [], N = [], mats = [], spans = [];
    let v = 0;
    T.traverse(function (m) {
      if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      const pa = g.attributes.position.array, na = g.attributes.normal ? g.attributes.normal.array : null;
      const n = g.attributes.position.count;
      for (let i = 0; i < n * 3; i++) { P.push(pa[i]); N.push(na ? na[i] : (i % 3 === 1 ? 1 : 0)); }
      spans.push([v, n, mats.length]);
      mats.push(Array.isArray(m.material) ? m.material[0] : m.material);
      v += n;
      g.dispose();
    });
    if (!v) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
    for (const sp of spans) geo.addGroup(sp[0], sp[1], sp[2]);
    return { geometry: geo, matrixWorld: new THREE.Matrix4(), material: mats };
  }
  function dropCols(b) {
    const cs = CBZ.colliders;
    if (!cs || !b.cols || !b.cols.length) return;
    let hit = false;
    for (const c of b.cols) { const i = c ? cs.indexOf(c) : -1; if (i >= 0) { cs.splice(i, 1); hit = true; } }
    b.cols.length = 0;
    if (hit && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }
  /* BREAK ONE PROP. at = impact point, dir = push (x,z; y lifts), f = the
     effective force at the prop (already over its need). Returns true when it
     actually came apart. */
  function smashProp(b, at, dir, f, o) {
    const D = CBZ.debris, T0 = BREAK[b.type];
    if (!D || !T0 || b.smashed || !b.g) return false;
    o = o || {};
    b.smashed = true;
    if (b.rec) { b.rec.smashed = true; b.rec.over = true; }
    if (b.type === "lamp" && b.rec) killLamp(b.rec);
    if (b.type === "signal") killSignal(b);
    // instanced hardware: zero the standing instances and build the stand-in
    // meshes (shared prototype geometry) that the debris below throws
    if (b.onSmash) try { b.onSmash(b); } catch (e) { /* never into the blast */ }
    const owner = o.owner || "street-props";
    const over = Math.max(1, f / T0.need);
    const power = Math.max(0.4, Math.min(2.6, f * 1.4));
    const budget = Math.max(3, Math.min(T0.pieces || 10, Math.round(5 + over * 3)));
    const dl = Math.hypot(dir.x, dir.z) || 1;
    const push = { x: dir.x / dl, y: dir.y != null ? dir.y : 0.3, z: dir.z / dl };
    const hitY = Math.max(0.35, Math.min(2.6, at.y != null ? at.y : 0.8));
    const pt = { x: at.x, y: hitY, z: at.z };
    try {
      if (T0.whole) {
        // heavy iron: it shears off its bolts in one piece, thrown along the blast
        const T = tempOf(b, "main"), W = T && wholeSource(T);
        const sp = Math.min(9, 2.5 + f * 3.5);
        if (W) D.adopt(W, { owner, kind: T0.kind, velocity: new THREE.Vector3(push.x * sp, 1.5 + f * 1.8, push.z * sp),
          angular: new THREE.Vector3(push.z * 3, (Math.random() - 0.5) * 2, -push.x * 3) });
      } else {
        const snap = tempOf(b, "snap");
        if (snap) D.shatter(snap, { at: pt, dir: push, power, owner, snap: true, maxPieces: Math.max(2, Math.round(budget * 0.35)) });
        const main = tempOf(b, "main");
        if (main) D.shatter(main, { at: pt, dir: push, power, owner, maxPieces: snap ? Math.max(3, budget - Math.round(budget * 0.35)) : budget });
        const keep = tempOf(b, "keep"), KW = keep && wholeSource(keep);   // a planter / a lamp's foot: stays where it stood
        if (KW) D.adopt(KW, { owner });
      }
    } catch (e) { /* debris never throws, but a prop must never break the blast */ }
    if (CBZ.batchHideGroup) try { CBZ.batchHideGroup(b.g); } catch (e) {}
    b.g.visible = false;
    b.g.userData.cullLocked = true;                    // core/farcull must never re-show it
    if (!T0.keepCol) dropCols(b);
    return true;
  }
  // PROPS_WIRED_V1 propane cook-off, shared by the last bullet and a blast
  // (a queued blast cook-off detonates a beat later: chain reactions read).
  const cookQ = [];
  function cookOff(s, byPlayer) {
    if (!s || s.exploded) return;
    s.exploded = true;
    const ex = s.x, ez = s.z;
    if (s.brk && !s.brk.smashed && CBZ.debris) smashProp(s.brk, { x: ex, y: 0.5, z: ez }, { x: 0, y: 1, z: 0.01 }, 2.2);
    else if (s.group) s.group.visible = false;         // headless: the cage is simply gone
    if (CBZ.cityExplosion) CBZ.cityExplosion(ex, ez, { power: 1.2, radius: 6, byPlayer: !!byPlayer });
    if (CBZ.cityShatter) CBZ.cityShatter(ex, ez, 8);
    if (byPlayer) {
      if (CBZ.cityCrime) CBZ.cityCrime(120, { x: ex, z: ez, type: "shots-fired" });
      if (CBZ.cityAlarm && CBZ.city) CBZ.cityAlarm(ex, ez, 45, 1.8, CBZ.city.playerActor);
    }
    if (CBZ.cityPostEvent) CBZ.cityPostEvent({ type: "explosion", pos: { x: ex, z: ez }, radius: 80, intensity: 2.0 });
  }
  if (CBZ.onAlways) CBZ.onAlways(7.85, function (dt) {
    if (!cookQ.length) return;
    for (let i = cookQ.length - 1; i >= 0; i--) {
      const q = cookQ[i];
      q.t -= dt;
      if (q.t > 0) continue;
      cookQ.splice(i, 1);
      cookOff(q.s, q.byPlayer);
    }
  });

  /* PUBLIC: an explosion at (x,y,z) with radius R and power (the blast's own
     power, ~1 for a grenade, ~2 for an RPG, more for heavy ordnance) breaks
     the street props it reaches. Effective force at a prop = power x (1 - d/R);
     a prop whose force clears its material's `need` breaks for real (nearest
     BLAST_MAX_PROPS only), a light knockable under it but over half tips away
     from the blast, heavy iron under it just stands. opts: {owner, byPlayer,
     maxProps}. Returns {broken, tipped}. Never throws. */
  CBZ.cityPropsBlast = function (x, y, z, R, power, opts) {
    const out = { broken: 0, tipped: 0 };
    try {
      opts = opts || {};
      if (!(R > 0) || !isFinite(x) || !isFinite(z)) return out;
      power = power > 0 ? power : 1;
      y = isFinite(y) ? y : 0.5;
      const cand = [];
      breakablesNear(x, z, R, _near);
      for (const b of _near) {
        const T0 = BREAK[b.type]; if (!T0) continue;
        const d = Math.hypot(b.x - x, b.z - z);
        const f = power * Math.max(0, 1 - d / R);
        cand.push({ b, d, f, T0 });
      }
      const DK = CBZ.detailKit;
      if (DK && DK.instancesNear) {
        const inst = DK.instancesNear(x, z, R, DK_BREAK);
        for (const e of inst) {
          const T0 = DK_BREAK[e.name];
          cand.push({ dk: e, d: e.d, f: power * Math.max(0, 1 - e.d / R), T0 });
        }
      }
      cand.sort((a, b) => a.d - b.d);
      const cap = opts.maxProps || BLAST_MAX_PROPS;
      for (const c of cand) {
        const T0 = c.T0;
        const px = c.b ? c.b.x : c.dk.item.x, pz = c.b ? c.b.z : c.dk.item.z;
        const dir = { x: px - x, y: 0.35, z: pz - z };
        if (Math.hypot(dir.x, dir.z) < 1e-3) { dir.x = 1; }
        const breaks = c.f >= T0.need && (!T0.whole || c.d <= (T0.maxD || R));
        if (breaks && out.broken < cap) {
          if (c.b && c.b.type === "propane") {
            // a cage caught in a fireball cooks off a beat later, and its own
            // blast carries on down the street — a real chain, one per cage
            const s = c.b.rec;
            if (s && !s.exploded && !s.queued) { s.queued = true; cookQ.push({ s, t: 0.15 + Math.random() * 0.25, byPlayer: !!opts.byPlayer }); out.broken++; }
            continue;
          }
          if (c.b ? smashProp(c.b, { x, y, z }, dir, c.f, opts) : smashInstance(c.dk, { x, y, z }, dir, c.f, T0, opts)) out.broken++;
          continue;
        }
        // under its need: light things still get thrown over
        if (c.b && c.b.rec && c.b.rec.group && !c.b.rec.over && c.f >= T0.need * 0.4 && !T0.whole) {
          tipProp(c.b.rec, dir.x, dir.z, 0.15 + c.f * 0.3, 0.4 + c.f * 1.5);
          out.tipped++;
        }
      }
    } catch (e) { /* never into the explosion core */ }
    return out;
  };
  // one detailKit instance (pallet, crate, barrier, bike, bags, bollard)
  function smashInstance(e, at, dir, f, T0, o) {
    const D = CBZ.debris, DK = CBZ.detailKit;
    if (!D || !DK || !DK.instanceMesh) return false;
    const m = DK.instanceMesh(e.batch, e.i);
    if (!m) return false;
    m.userData.debrisKind = T0.kind;
    const owner = (o && o.owner) || "street-props";
    const dl = Math.hypot(dir.x, dir.z) || 1;
    const push = { x: dir.x / dl, y: dir.y != null ? dir.y : 0.3, z: dir.z / dl };
    // an instance matrix is a WORLD matrix: shatter reads matrixWorld after
    // updateWorldMatrix, which with matrixAutoUpdate off and no parent keeps it
    const G = new THREE.Group(); G.add(m);
    try {
      if (T0.whole) {
        const sp = Math.min(9, 2.5 + f * 3.5);
        D.adopt(G, { owner, velocity: new THREE.Vector3(push.x * sp, 1.5 + f * 1.8, push.z * sp),
          angular: new THREE.Vector3(push.z * 3, (Math.random() - 0.5) * 2, -push.x * 3) });
      } else {
        const over = Math.max(1, f / T0.need);
        D.shatter(G, { at: { x: at.x, y: Math.max(0.3, Math.min(2, at.y != null ? at.y : 0.6)), z: at.z }, dir: push,
          power: Math.max(0.4, Math.min(2.6, f * 1.4)), owner,
          maxPieces: Math.max(3, Math.min(T0.pieces || 8, Math.round(4 + over * 3))) });
      }
    } catch (err) { /* never into the caller */ }
    DK.hideInstance(e.batch, e.i);
    return true;
  }

  // one always-driver animates tips + geysers; idles to a length check when quiet
  if (CBZ.onAlways) CBZ.onAlways(7.8, function (dt) {
    if (!knocks.length && !geysers.length && !drops.length) return;
    // knock-overs: eased tip + slide (+ a hop for the cones)
    for (let i = knocks.length - 1; i >= 0; i--) {
      const k = knocks[i];
      k.t += dt;
      const u = Math.min(1, k.t / k.dur);
      const e = 1 - (1 - u) * (1 - u);
      if (_hasFullQuat) {
        _axTip.set(k.axx, 0, k.axz);
        _qTip.setFromAxisAngle(_axTip, e * k.ang);
        k.g.quaternion.copy(_qTip).multiply(k.q0);
      }
      k.g.position.set(k.x0 + k.sx * e, k.y0 + (k.hop ? Math.sin(u * Math.PI) * k.hop : 0), k.z0 + k.sz * e);
      if (u >= 1) { k.g.position.y = k.y0; knocks.splice(i, 1); }
    }
    // hydrant geysers: emit pooled droplets while anyone's near enough to see
    const cam = CBZ.camera && CBZ.camera.position;
    for (let i = geysers.length - 1; i >= 0; i--) {
      const gy = geysers[i];
      gy.t -= dt;
      if (gy.t <= 0) { geysers.splice(i, 1); continue; }
      if (!cam) continue;
      const gdx = gy.x - cam.x, gdz = gy.z - cam.z;
      if (gdx * gdx + gdz * gdz > 90 * 90) continue;
      const fade = Math.min(1, gy.t / 3);              // pressure dies over the last seconds
      gy.acc += dt;
      while (gy.acc > 0.04 && drops.length < 80) {
        gy.acc -= 0.04;
        const s = takeDrop();
        s.position.set(gy.x + (Math.random() - 0.5) * 0.16, 0.75, gy.z + (Math.random() - 0.5) * 0.16);
        s.scale.set(0.3, 0.5, 1);
        s.material.opacity = 0.85 * fade;
        drops.push({ s, vx: (Math.random() - 0.5) * 1.6, vy: (8.5 + Math.random() * 3.5) * (0.55 + 0.45 * fade), vz: (Math.random() - 0.5) * 1.6, life: 1 });
      }
      if (gy.acc > 0.04) gy.acc = 0;                   // pool full — drop the backlog
    }
    // droplets: ballistic rise + fall, swell and thin out on the way down
    for (let i = drops.length - 1; i >= 0; i--) {
      const p = drops[i];
      p.life -= dt;
      p.vy -= 13 * dt;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      if (p.life <= 0 || p.s.position.y < 0.05) { p.s.visible = false; dropPool.push(p.s); drops.splice(i, 1); continue; }
      const u = 1 - p.life;
      p.s.scale.set(0.3 + u * 0.9, 0.5 + u * 0.7, 1);
      p.s.material.opacity = Math.min(0.85, p.life * 1.7) * 0.9;
    }
  });

  // ---- CAR-VS-PROP KNOCKDOWNS (NO-DECOY FIX) -------------------------------
  // Bullets already tip these four over (hitProp above); a car ploughing
  // through the same trash can/meter/newsbox/cone used to sail straight
  // through with zero reaction — the solidCollider() calls added at each
  // builder give the physics resolver something to nudge against, and THIS
  // scan is what makes it look and feel like a hit: the nearest live city car
  // within reach of an un-tipped prop tips it (tipProp, the exact same
  // animation gunfire uses) in the car's direction of travel, and bleeds a
  // touch of the car's speed so the bump reads as contact, not a phantom
  // wall. Deliberately cheap: a flat O(props × nearby cars) scan at 10Hz
  // (proximity, not per-frame), only over the handful of registered props —
  // never a draw call, never touches vehicles.js's own crash/crumple path
  // (these are far too light to dent a hull).
  let _carKnockT = 0;
  // HEAVY HITS BREAK. Every frame, for the few cars doing more than
  // CAR_BREAK_V: a breakable prop in the car's path (ahead of its centre by
  // up to a bonnet plus two frames of travel, within a half-width sideways)
  // breaks along the car's velocity BEFORE the collider can stop the car —
  // a lamp mast snaps over the bonnet, a pallet splinters, a bin bursts. The
  // car pays for it (a mast costs real speed, a bin barely any). Under that
  // speed the old 10 Hz tip below is untouched.
  const _carNear = [];
  function carBreakScan(cars, dt) {
    const DK = CBZ.detailKit;
    for (let j = 0; j < cars.length; j++) {
      const car = cars[j];
      if (!car || car.dead || !car.pos || !isFinite(car.pos.x) || !isFinite(car.pos.z)) continue;
      const vmag = Math.abs(car.v || 0);
      if (!isFinite(vmag) || vmag <= CAR_BREAK_V) continue;
      const sg = car.v < 0 ? -1 : 1;
      const fx = Math.sin(car.heading || 0) * sg, fz = Math.cos(car.heading || 0) * sg;
      const reach = 2.6 + vmag * (dt || 0.016) * 2;
      const f0 = 0.35 * vmag / CAR_BREAK_V;
      breakablesNear(car.pos.x, car.pos.z, reach + 1.5, _carNear);
      for (let i = 0; i < _carNear.length; i++) {
        const b = _carNear[i], T0 = BREAK[b.type];
        if (!T0 || !T0.carBreak || b.smashed) continue;
        const dx = b.x - car.pos.x, dz = b.z - car.pos.z;
        const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
        if (along < -1.5 || along > reach || lat > 1.05 + (b.rec && b.rec.r ? Math.min(0.5, b.rec.r) : 0.3)) continue;
        if (smashProp(b, { x: b.x, y: 0.75, z: b.z }, { x: fx, y: 0.25, z: fz }, Math.max(T0.need, f0))) {
          const heavy = b.type === "lamp" || b.type === "signal" || b.type === "tree" || b.type === "meter";
          car.v *= heavy ? 0.72 : 0.93;
        }
      }
      if (DK && DK.instancesNear) {
        const inst = DK.instancesNear(car.pos.x, car.pos.z, reach + 1.2, DK_CAR);
        for (let i = 0; i < inst.length; i++) {
          const e = inst[i], T0 = DK_BREAK[e.name];
          const dx = e.item.x - car.pos.x, dz = e.item.z - car.pos.z;
          const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
          if (along < -1.5 || along > reach || lat > 1.35) continue;
          if (smashInstance(e, { x: e.item.x, y: 0.6, z: e.item.z }, { x: fx, y: 0.25, z: fz }, Math.max(T0.need, f0), T0, null)) car.v *= 0.95;
        }
      }
    }
  }
  // order 14.7: strictly after vehicles.js's driving update (11, computes this
  // frame's car.pos/car.v) but its OWN slot — city/combat.js already owns 15
  // (a melee telegraph scan, unrelated but no need to tie-break against it).
  if (CBZ.onUpdate) CBZ.onUpdate(14.7, function (dt) {
    const gm = CBZ.game; if (!gm || gm.mode !== "city") return;
    const cars = (CBZ.cityCars && CBZ.cityCars.length) ? CBZ.cityCars : null;
    // PROPS_KNOCK_PLAYER — A BODY AT A RUN DOES WHAT A BUMPER DOES.
    // OWNER: "alleys filled with trash cans and newspaper buying stands so I
    // cant run through alleys." The alley law upstream decides WHAT stands in a
    // gap; this decides what happens when you meet the one that still does. It
    // is deliberately NOT a new system: same carKnockables list, same tipProp()
    // arc, same 10 Hz proximity scan gunfire and traffic already share — the
    // only new thing is a second thing that can do the knocking.
    // A METER IS EXCLUDED ON PURPOSE: hitProp calls it "bolted steel", a car
    // bends the post and a shoulder does not. A can, a news box and a cone are
    // the three you should be able to run straight through.
    const P = CBZ.player;
    const runner = (CBZ.CONFIG.PROPS_KNOCK_PLAYER !== false && P && P.pos && !P.dead && !P.driving
      && isFinite(P.pos.x) && isFinite(P.pos.z) && (P.speed || 0) > 2.6) ? P : null;
    if (!cars && !runner) return;
    if (cars && CBZ.debris) carBreakScan(cars, dt);
    _carKnockT += dt;
    if (_carKnockT < 0.1) return;                 // 10Hz — a bumper clip doesn't need 60Hz reaction
    _carKnockT = 0;
    if (runner) {
      const pr = runner.radius || 0.55;           // the player capsule (physics.js:108)
      for (let i = 0; i < carKnockables.length; i++) {
        const s = carKnockables[i];
        if (s.over || (s.type !== "bin" && s.type !== "newsbox" && s.type !== "cone")) continue;
        const dx = s.x - runner.pos.x, dz = s.z - runner.pos.z;
        const hitR = s.r + pr;
        const d2 = dx * dx + dz * dz;
        if (d2 > hitR * hitR) continue;
        // AWAY FROM THE BODY, not along a heading — you are inside its radius,
        // so the vector from you to it IS the push, and it needs no yaw
        // convention to get wrong (the sign-error trap CLAUDE.md warns about).
        const light = s.type === "cone";
        tipProp(s, d2 > 1e-4 ? dx : 1, d2 > 1e-4 ? dz : 0, light ? 0.24 : 0.06, light ? 1.1 : 0.4);
      }
    }
    if (!cars) return;
    for (let i = 0; i < carKnockables.length; i++) {
      const s = carKnockables[i];
      if (s.over) continue;
      for (let j = 0; j < CBZ.cityCars.length; j++) {
        const car = CBZ.cityCars[j];
        if (!car || car.dead || !car.pos) continue;
        // a car whose physics went bad (NaN pos, e.g. a wrecked/despawning car
        // mid-teardown) must NOT pass the range test below: a NaN distance
        // compares false against EVERY bound, so an unguarded check would
        // silently treat every prop in the array as "in range" and spuriously
        // tip the whole city's street furniture in one tick.
        if (!isFinite(car.pos.x) || !isFinite(car.pos.z)) continue;
        const vmag = Math.abs(car.v || 0);
        if (!isFinite(vmag) || vmag < 0.6) continue;   // parked/crawling/broken cars don't "hit" anything
        const dx = s.x - car.pos.x, dz = s.z - car.pos.z;
        const hitR = s.r + 1.1;                     // s.r is the prop's own radius; +car half-width fudge
        if (dx * dx + dz * dz > hitR * hitR) continue;
        // tip it AWAY from the car, along its heading (mirrors hitProp's d.x/d.z)
        const fx = Math.sin(car.heading || 0), fz = Math.cos(car.heading || 0);
        const light = s.type === "cone" || s.type === "meter";
        tipProp(s, fx, fz, light ? 0.3 : 0.1, light ? 1.4 : 0.55);
        car.v *= 0.94;                              // barely felt — it's a can, not a curb
        // PROPS_WIRED_V1: ram a PARKING METER and its coin box spills — but only
        // when it's YOU behind the wheel (car.player), never NPC traffic clipping
        // meters all over the city. The outer `if (s.over) continue` above means
        // this runs on the FIRST topple ONLY (paid once; the meter then stays
        // down for the session). Haul is deterministic per meter (hash01 on its
        // position → the coins THAT meter was holding), plus a witnessed
        // petty-theft charge through the same cityCrime heat API everything uses.
        if (CBZ.CONFIG.PROPS_WIRED_V1 && s.type === "meter" && car.player) {
          const coins = 8 + ((CBZ.hash01(s.x, s.z, 4711) * 18) | 0);   // $8–25, fixed per meter
          if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(coins);
          if (CBZ.sfx) CBZ.sfx("coin");
          if (CBZ.city && CBZ.city.note) CBZ.city.note("Cracked the meter. $" + coins + " in coins.", 1.8);
          if (CBZ.cityCrime) CBZ.cityCrime(25, { x: s.x, z: s.z, type: "theft" });
        }
        break;                                       // one car claims the hit this tick
      }
    }
  });

  // ---- shared advertising / poster canvas textures ------------------------
  // Billboards + bus-shelter ad panels read from a pool of generated poster
  // textures. Content is RELEVANT to OUR city — the real gangs that hold turf,
  // the real shops you can walk into, mock local brands, our own radio stations,
  // and the occasional WANTED poster keyed to YOUR notoriety. One CanvasTexture
  // per ad, reused everywhere.
  //
  // Each ad entry: [HEADLINE, tagline, bgHex, fgHex, opts?]
  //   opts.kind  — "ad" (default) | "radio" | "gang" | "wanted" | "shop"
  //   opts.tag   — tiny corner label ("AD","FM","TURF","WANTED","NOW OPEN")
  // The gang ads pull their colours straight from CBZ.CITY.gangs so a Vipers
  // board is always Vipers-green; if the player founds/owns a gang we surface
  // that too. WANTED boards read the live wanted star count.

  function gangDefs() { return (CBZ.CITY && CBZ.CITY.gangs) || []; }
  function hex(n) { return "#" + ("000000" + ((n | 0) & 0xffffff).toString(16)).slice(-6); }
  // a darkened version of a colour for poster backgrounds (so the headline pops)
  function darken(n, f) {
    const r = ((n >> 16) & 255) * f, gg = ((n >> 8) & 255) * f, b = (n & 255) * f;
    return "#" + ("000000" + (((r << 16) | (gg << 8) | b) | 0).toString(16)).slice(-6);
  }

  // ---- STATIC pool: local brands, our shops, radio stations, gang slogans ----
  // Mock local brands + funny in-world ads (kept ours, not a clone — these tie
  // into things you actually do in the city: cash, guns, cars, drip, casino).
  const BRAND_ADS = [
    ["SPRUNK", "carbonated with regret", 0x0b2d6b, 0xffd23a],
    ["CLUCKIN' DINER", "27 herbs, 0 questions", 0x7a3a0d, 0xffce7a, { tag: "EAT" }],
    ["PISSWASSER", "the beer you've earned", 0x5a3a12, 0xf0c060],
    ["eCOLA", "now 30% more cola", 0x7a0d14, 0xffe9e9],
    ["VOLT ELECTRONICS", "phones smarter than you", 0x062a2a, 0x39d0c0],
    ["KEYSTONE REALTY", "own the block, press Z", 0x0d3a2c, 0x4fd0a0, { tag: "Z" }],
    ["GRAND CASINO", "the house misses you", 0x2a1a05, 0xc9a227],
    ["BIGNESS BURGER", "supersize your debt", 0x3a0f0f, 0xffcf3a],
    ["BENNY'S CHOP SHOP", "no plate? no problem", 0x2a2308, 0xd0a23c],
    ["IRON GYM", "lift heavy, hit harder", 0x0d2a26, 0x66d9c0],
    ["VINEWOOD", "now casting nobodies", 0x2a1133, 0xff7ad9],
    ["LIFEINVADER", "we already read this", 0x10202c, 0x3fd0ff],
  ];
  // Our shops you can literally walk into — "advertised" so the city points at them.
  const SHOP_ADS = [
    ["AMMU-NATION", "rights. ammo. respect.", 0x1c2414, 0xff5a2c, { tag: "GUNS" }],
    ["BLING JEWELERS", "drip = respect", 0x2a2205, 0xffe08a, { tag: "DRIP" }],
    ["THREADS & DRIP", "look like money", 0x2a113a, 0xc792ea, { tag: "FITS" }],
    ["PREMIUM AUTOS", "test drive forever", 0x2a1805, 0xe88a3c, { tag: "CARS" }],
    ["PAWN & LOAN", "we buy hot junk", 0x2a1c0d, 0xc89a5a, { tag: "FENCE" }],
    ["VELVET CLUB", "after dark, anything", 0x2a0d1a, 0xe85d8a, { tag: "OPEN" }],
    ["THE TRAP HOUSE", "ask for the special", 0x0d2a18, 0x4caf6e, { tag: "??" }],
    ["FRESH CUTS", "lineup of your life", 0x0d1f2a, 0x6bb6ff, { tag: "STYLE" }],
  ];
  // OUR radio dial — invented stations with our own DJ/flavour (in-world humour).
  const RADIO_ADS = [
    ["98.4 BLOK FM", "all trap, all turf", 0x140c2a, 0xb079ea, { kind: "radio", tag: "FM" }],
    ["K-RAGE 101.1", "drive angry", 0x2a0c0c, 0xff6a4a, { kind: "radio", tag: "FM" }],
    ["SIREN AM 88", "police scanner & jazz", 0x0c1a2a, 0x5b8bff, { kind: "radio", tag: "AM" }],
    ["LOWRIDE 96.9", "bounce all night", 0x0c2a1a, 0x49c46e, { kind: "radio", tag: "FM" }],
    ["GHOST CITY RADIO", "nobody's listening", 0x14171d, 0x9fb0c6, { kind: "radio", tag: "FM" }],
    ["VINEWOOD GOLD", "songs your boss likes", 0x2a2205, 0xf2c43d, { kind: "radio", tag: "AM" }],
  ];

  // a board material per ad-record (so each poster can glow a touch at night).
  // adMat now takes an ad ARRAY (not an index) and caches by a content key so
  // dynamic gang/wanted boards rebuild only when their text changes.
  const adCache = new Map();      // key -> CanvasTexture
  const adMatCache = new Map();   // key -> MeshLambertMaterial
  // E3: the trailing "|line3" keeps the MARKET TICKER's third line (CPI) part
  // of the cache key too — every other kind leaves it "" (no behavior change).
  function adKey(ad) { return ad[0] + "|" + ad[1] + "|" + ((ad[4] && ad[4].kind) || "ad") + "|" + ((ad[4] && ad[4].line3) || ""); }

  function adTextureFor(ad) {
    const key = adKey(ad);
    let t = adCache.get(key);
    if (t) return t;
    const head = ad[0], tag = ad[1], bg = ad[2], fg = ad[3], opt = ad[4] || {};
    const kind = opt.kind || "ad";
    const c = document.createElement("canvas");
    c.width = 256; c.height = 128;
    const x = c.getContext("2d");
    // background — a flat fill plus a subtle top/bottom gradient band so it
    // doesn't read as a single dead rectangle.
    const bgCss = typeof bg === "number" ? hex(bg) : bg;
    x.fillStyle = bgCss; x.fillRect(0, 0, 256, 128);
    x.fillStyle = "rgba(255,255,255,.07)"; x.fillRect(0, 0, 256, 26);
    x.fillStyle = "rgba(0,0,0,.18)"; x.fillRect(0, 104, 256, 24);
    const fgCss = typeof fg === "number" ? hex(fg) : fg;

    if (kind === "wanted") {
      // a mock police WANTED poster — big WANTED banner, the player's "name",
      // a star row for the live wanted level and a bounty.
      x.fillStyle = fgCss;
      x.font = "bold 30px Fredoka, Arial, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText("✦ WANTED ✦", 128, 26);
      x.font = "bold 22px Fredoka, Arial, sans-serif";
      x.fillText(head, 128, 64);                 // headline = the perp line
      x.font = "16px Fredoka, Arial, sans-serif";
      x.fillStyle = "rgba(255,255,255,.92)";
      x.fillText(tag, 128, 96);                   // tagline = bounty line
    } else if (kind === "yours") {
      // the OWNER creative — gold double frame + a stylized mug (head, shades,
      // chain). city/adboard.js puts these up when YOU rent the board: the whole
      // money loop ends with the skyline wearing your name, so it must read as
      // YOURS from a block away, not as one more brand poster.
      x.strokeStyle = fgCss; x.lineWidth = 5; x.strokeRect(6, 6, 244, 116);
      x.lineWidth = 2; x.strokeRect(13, 13, 230, 102);
      x.fillStyle = fgCss;
      x.beginPath(); x.arc(44, 54, 18, 0, 6.3); x.fill();                 // head
      x.fillStyle = bgCss; x.fillRect(28, 45, 32, 8);                     // shades
      x.fillStyle = fgCss;
      for (let ci = 0; ci < 5; ci++) { x.beginPath(); x.arc(34 + ci * 5, 80 - Math.abs(ci - 2) * 2, 2.2, 0, 6.3); x.fill(); }  // chain
      // headline + tagline to the right of the face (shrink-to-fit)
      x.textAlign = "center"; x.textBaseline = "middle";
      let yfs = 26; x.font = "bold " + yfs + "px Fredoka, Arial, sans-serif";
      while (x.measureText(head).width > 158 && yfs > 13) { yfs -= 2; x.font = "bold " + yfs + "px Fredoka, Arial, sans-serif"; }
      x.fillText(head, 158, 50);
      x.font = "13px Fredoka, Arial, sans-serif";
      x.fillStyle = "rgba(255,255,255,.85)";
      x.fillText(tag, 158, 86);
      const yCorner = opt.tag || "YOURS";
      x.font = "bold 12px Fredoka, Arial, sans-serif";
      const ycw = x.measureText(yCorner).width + 12;
      x.fillStyle = fgCss; x.fillRect(256 - ycw - 10, 10, ycw, 16);
      x.fillStyle = bgCss; x.fillText(yCorner, 256 - ycw / 2 - 10, 18);
    } else if (kind === "ticker") {
      // E3 LEGIBILITY: the MARKET TICKER — a dark ticker-tape board reading
      // sim/market.js's live category levels + sim/econstate.js's CPI, straight
      // off the skyline. head/tag are two category lines ("FOOD ×1.24 ▲"),
      // opt.line3 is the CPI line; each line's own color reads its trend arrow
      // (no separate metadata needed — the arrow character IS the signal).
      x.fillStyle = "#05060a"; x.fillRect(0, 0, 256, 128);
      x.strokeStyle = "rgba(80,255,170,.4)"; x.lineWidth = 3; x.strokeRect(5, 5, 246, 118);
      x.textAlign = "center"; x.textBaseline = "middle";
      const lines = [head, tag, opt.line3 || ""];
      const ys = [34, 64, 94];
      lines.forEach(function (ln, i) {
        if (!ln) return;
        x.font = "bold 22px 'Courier New', monospace";
        x.fillStyle = ln.indexOf("▲") >= 0 ? "#ff9e6b" : (ln.indexOf("▼") >= 0 ? "#7ed957" : "#9fd8ff");
        x.fillText(ln, 128, ys[i]);
      });
      x.font = "bold 10px Fredoka, Arial, sans-serif";
      x.fillStyle = "rgba(140,255,200,.6)";
      x.fillText("CITY MARKETS", 128, 114);
    } else {
      // accent rules + corner tag
      x.fillStyle = fgCss;
      x.fillRect(0, 14, 256, 3); x.fillRect(0, 110, 256, 3);
      // big headline
      x.font = "bold 38px Fredoka, Arial, sans-serif";
      x.textAlign = "center"; x.textBaseline = "middle";
      // shrink long headlines to fit the board
      let fs = 38; x.font = "bold " + fs + "px Fredoka, Arial, sans-serif";
      while (x.measureText(head).width > 238 && fs > 18) { fs -= 2; x.font = "bold " + fs + "px Fredoka, Arial, sans-serif"; }
      x.fillText(head, 128, 52);
      x.fillStyle = "rgba(255,255,255,.88)";
      x.font = "16px Fredoka, Arial, sans-serif";
      x.fillText(tag, 128, 90);
      // corner tag chip (AD / FM / GUNS / TURF ...)
      const corner = opt.tag || (kind === "radio" ? "FM" : (kind === "gang" ? "TURF" : (kind === "shop" ? "OPEN" : "AD")));
      x.font = "bold 12px Fredoka, Arial, sans-serif";
      const cw = x.measureText(corner).width + 12;
      x.fillStyle = fgCss; x.fillRect(256 - cw - 6, 6, cw, 18);
      x.fillStyle = bgCss; x.textBaseline = "middle"; x.textAlign = "center";
      x.fillText(corner, 256 - cw / 2 - 6, 16);
    }
    t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    adCache.set(key, t);
    return t;
  }
  function adMatFor(ad) {
    const key = adKey(ad);
    let m = adMatCache.get(key);
    if (!m) {
      const tex = adTextureFor(ad);
      m = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 });
      m._ad = true;
      adMatCache.set(key, m);
    }
    return m;
  }
  // SHARED with city/adboard.js (the rentable-board market): the SAME cached
  // generator renders the player's own creatives, so a rented board looks
  // native to the city and costs zero extra materials when reused.
  CBZ.cityAdMatFor = adMatFor;
  CBZ.cityAdKey = adKey;

  // ---- a per-gang TURF board, coloured straight from the gang definition ----
  // Built on demand so the board always matches CBZ.CITY.gangs (and any gang
  // the player founds/recolours). Slogans are ours, not a clone.
  function gangAd(d) {
    const slogans = {
      vipers: "green means GO",
      kings: "ice in our veins",
      reapers: "steel never sleeps",
      saints: "pray we don't find you",
      // 2nd-wave crews
      lords:    "gold in the hand, iron in the fist",
      surenos:  "bahia sur, from the docks up",
      nortenos: "north of the canyon, nobody passes",
      cartel:   "the plug. everybody eats here",
      cosa:     "this block pays rent to us",
      angels:   "ride or get run over",
      brand:    "one wood, one blood",
    };
    return [d.name.toUpperCase(), slogans[d.id] || "this block is ours", darken(d.color, 0.16), hex(d.color), { kind: "gang", tag: "TURF" }];
  }

  CBZ.cityProps = function (city) {
    const root = city.root, rng = city.rng;
    city.streetProps = city.streetProps || [];
    // THE ALLEY LAW needs the finished footprints, and every prop in this file
    // and in the four world-dressing passes is placed after this point — so one
    // index here covers all six scatter passes. Draws no rng.
    alleyIndex(city);
    const STREET_CLUTTER = CBZ.CONFIG.CITY_STREET_CLUTTER === true;
    // fresh world: drop every shootable record/animation from the old one
    shootables = [];
    carKnockables.length = 0;
    breakables = []; bgrid.clear(); cookQ.length = 0;
    knocks.length = 0; geysers.length = 0;
    for (let i = drops.length - 1; i >= 0; i--) { drops[i].s.visible = false; dropPool.push(drops[i].s); }
    drops.length = 0;
    // ---- THE ROAD STOPS BULLETS: one invisible raycast plane just above the
    // street-paint stack (asphalt 0.04 → crosswalks 0.072 → pavement 0.09).
    // The shot resolver (fpsmode wallDistance) only tests CBZ.losBlockers, so
    // a round fired at the asphalt used to sail through the world and leave
    // NOTHING — now it terminates on the street like a wall hit: dust kick,
    // a persistent pock, the thud. visible=false → never rendered (zero draw
    // calls); r128 raycasts it regardless. Built ONCE, ever (losBlockers is
    // never wholesale reset), and one extra plane per ray is noise.
    if (!CBZ._cityGroundRayPlane && CBZ.losBlockers) {
      const gp = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial());
      gp.material._shared = true; gp.geometry._shared = true;
      gp.rotation.x = -Math.PI / 2;
      gp.position.y = 0.085;
      gp.visible = false;
      gp.updateMatrixWorld(true);          // never in the scene graph — bake the matrix once
      CBZ._cityGroundRayPlane = gp;
      CBZ.losBlockers.push(gp);
    }
    // collected emissive props that should glow after dark (lamp heads, billboard
    // panels, shelter ad-lights, neon shop signs). Driven once/frame in city mode.
    const nightLamps = city._nightLamps = city._nightLamps || [];
    const nightAds = city._nightAds = city._nightAds || [];
    // SMARTER STREET-LIGHT RENDERING collection arrays — fresh per rebuilt
    // world (mirrors shootables/carKnockables above): every streetlamp bulb
    // and every traffic-signal lamp registers a glow-shell "spot" here as
    // it's built; once ALL of them exist (end of cityProps) we bake exactly
    // one pooled InstancedMesh per colour (see buildGlowShellPool) and hand
    // out a small fixed pool of real THREE.PointLights to whichever handful
    // are nearest the camera (see the POOLED DYNAMIC LIGHTS driver near the
    // bottom of this function).
    const lampGlowSpots = [];      // warm streetlamp bulbs {x,y,z,r}
    const sigGlowSpots = { red: [], yel: [], grn: [] };   // traffic-signal lamps, by colour
    const lightCandidates = city._lightCandidates = [];   // {x,y,z,kind,ref|head,spots} — every real-light-eligible bulb, for the pool below
    // boards whose ad CONTENT is live (e.g. the player WANTED poster, or the
    // E3 market ticker below). Each entry is { mesh, dyn, lastKey, cats? } so
    // the driver re-skins only the few that actually change, never every frame.
    const dynAds = city._dynAds = city._dynAds || [];
    // registers a board's mesh for the live-content driver iff pickAd() flagged
    // it dynamic (wanted poster or market ticker) — shared by every board type
    // below so busShelter/billboard/roofBillboard don't each repeat this check.
    // (x,y,z) = the board face's world position: wanted-capable boards also
    // register with city/propuse.js so the player can walk up and READ the
    // live poster (the sole floating-words exception — CBZ.bountyFromPoster).
    function regDynAd(mesh, pick, x, y, z) {
      if (pick && (pick.dyn === "wanted" || pick.dyn === "ticker")) {
        const entry = { mesh: mesh, dyn: pick.dyn, lastKey: adKey(pick.ad), cats: pick.cats };
        dynAds.push(entry);
        if (pick.dyn === "wanted" && CBZ.propRegisterWantedPoster && x != null) {
          CBZ.propRegisterWantedPoster(mesh, x, y || 0, z, entry);
        }
      }
    }
    // RENTABLE AD SURFACES — every billboard face / shelter panel / rooftop
    // board placed below registers here so city/adboard.js can put it on the
    // market (money → skyline visibility → show-off). Each record carries the
    // mesh(es) to re-skin, the walk-up point, the surface class for pricing,
    // and the original material(s) to restore when a lease lapses.
    const adBoards = CBZ.cityAdBoards = [];

    // ---- ad picker: bias gang/wanted boards where they belong --------------
    const gangAdRecords = gangDefs().map(gangAd);
    function gangNear(x, z) {
      // closest gang turf centre, if any registered (gangs.js sets gang.center)
      const list = CBZ.cityGangs || [];
      let best = null, bd = 70 * 70;
      for (const gg of list) {
        if (!gg.center) continue;
        const dx = gg.center.x - x, dz = gg.center.z - z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = gg; }
      }
      return best;
    }
    // the live WANTED poster — reads the player's notoriety so the city literally
    // puts your face up as the heat climbs. Returns null when you're clean.
    const WANTED_NAMES = ["THE KINGPIN", "PUBLIC ENEMY", "THE GHOST", "THAT GUY", "THE MENACE"];
    function wantedAd() {
      const gm = CBZ.game; if (!gm) return null;
      const wl = (gm.wanted | 0);
      if (wl <= 0) return null;
      const stars = "★".repeat(Math.min(5, wl)) + "☆".repeat(Math.max(0, 5 - wl));
      const who = gm.playerGang && gm.playerGang.name ? gm.playerGang.name.toUpperCase() + " BOSS" : WANTED_NAMES[Math.min(WANTED_NAMES.length - 1, wl - 1)];
      const bounty = "BOUNTY $" + (wl * 2500 + (gm.cityKills | 0) * 250).toLocaleString() + "   " + stars;
      return [who, bounty, 0x1a0d0d, 0xffe2a0, { kind: "wanted", tag: "WANTED" }];
    }
    // ---- E3 LEGIBILITY: the MARKET TICKER creative ---------------------------
    // A deterministic 0..1 hash of a WORLD POSITION — never city.rng(). props.js
    // is the LAST consumer of the shared seeded city.rng stream this build (see
    // world.js: "sibling modules build from city.rng stays byte-identical"), so
    // mixing the ticker in via rng() would still be safe, but a position hash
    // keeps pickAd() trivially reusable from anywhere without any ordering worry.
    function posHash01(x, z) {
      const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      return h - Math.floor(h);
    }
    // the same two categories every time this exact (x,z) is asked — so the
    // ~1Hz live-refresh driver (below) recomputes the SAME board's ticker
    // instead of reshuffling which categories it tracks.
    function tickerCatsFor(x, z) {
      const CATS = (CBZ.market && CBZ.market.CATS) || ["food", "goods", "guns", "materials", "fuel", "luxury"];
      const n = CATS.length;
      const i = Math.floor(posHash01(x, z) * n) % n;
      let j = Math.floor(posHash01(z, x) * n) % n;   // swapped args -> an independent-looking hash
      if (j === i) j = (j + 1) % n;
      return [CATS[i], CATS[j]];
    }
    // builds the live 3-line ad record: two category levels (sim/market.js,
    // with trend arrows) + the city CPI (sim/econstate.js). Returns null if
    // neither system is loaded (a plain city build without Stage E still works).
    function tickerAd(cats) {
      const M = CBZ.market;
      if (!M || typeof M.tickerLine !== "function") return null;
      const line1 = M.tickerLine(cats[0]), line2 = M.tickerLine(cats[1]);
      const E = CBZ.econState;
      // E5/E7: every ~20s window in 4, the CPI line makes way for either the
      // roster's rotating earnings line (sim/corporations.js — E7: rotates
      // across all 8 companies + any player IPO, not just Bunbros) or the
      // LBX national index (sim/stocks.js) — "" falls back to CPI until
      // anything has ever listed.
      const C = CBZ.corps, S = CBZ.stocks;
      const win = Math.floor((CBZ.now || 0) / 20000) % 4;
      const corpLine = (win === 3 && C && typeof C.tickerLine === "function") ? C.tickerLine() : "";
      const idxLine = (win === 2 && S && typeof S.indexTickerLine === "function") ? S.indexTickerLine() : "";
      const line3 = corpLine || idxLine || ((E && typeof E.tickerLine === "function") ? E.tickerLine() : "");
      if (!line1 && !line2 && !line3) return null;
      return [line1, line2, 0x05060a, 0x9fd8ff, { kind: "ticker", tag: "MKT", line3: line3 }];
    }
    // returns an ad record for a board at (x,z): mostly static brand/shop/radio,
    // but a roadside board near a gang's turf shows THAT gang, a fraction of
    // boards become live WANTED posters once you have heat, and (E3) ~1-in-4
    // boards become a live MARKET TICKER instead — the economy readable right
    // off the skyline, no menu needed. `register` lets the caller flag a board
    // as dynamic (gets re-skinned later as those live values move).
    function pickAd(x, z, opts) {
      opts = opts || {};
      // TICKER, gated on the position hash above — checked FIRST and returns
      // before any rng() draw so the existing brand/shop/radio/gang/wanted mix
      // (still ~75% of boards) keeps its exact draw pattern unperturbed.
      if (opts.allowTicker !== false) {
        const th = posHash01(x, z);
        if (th < 0.25) {
          const cats = tickerCatsFor(x, z);
          const ad = tickerAd(cats);
          if (ad) return { ad: ad, dyn: "ticker", cats: cats };
        }
      }
      const r = rng();
      // 1 in ~7 big boards is a (potential) live WANTED poster
      if (opts.allowWanted && r < 0.14) {
        return { ad: wantedAd() || BRAND_ADS[(rng() * BRAND_ADS.length) | 0], dyn: "wanted" };
      }
      // near gang turf, prefer that gang's board
      const ng = gangNear(x, z);
      if (ng && rng() < 0.5) {
        const def = gangDefs().find((d) => d.id === ng.id);
        if (def) return { ad: gangAd(def), dyn: null };
      }
      // otherwise a weighted mix of our own world content
      const roll = rng();
      let pool;
      if (roll < 0.42) pool = BRAND_ADS;
      else if (roll < 0.72) pool = SHOP_ADS;
      else if (roll < 0.9) pool = RADIO_ADS;
      else pool = gangAdRecords.length ? gangAdRecords : BRAND_ADS;
      return { ad: pool[(rng() * pool.length) | 0] || BRAND_ADS[0], dyn: null };
    }

    // a tidy collider for solid props (cars crash, peds can't pass). noCam so the
    // chase camera never snaps in on a thin pole.
    /* STREET FURNITURE IS NOT ARCHITECTURE. Every caller below is a lamp mast,
       a signal pole, a sign, a meter, a bollard, a bin, a barrel, a bus
       shelter, a tree trunk — a prop standing in the open. None of them
       declare a y-band, so buildings.js's carve primitive DERIVES one off the
       mesh, and a 5.6 m lamp mast on a 0.34 m box then reads as "tall, thin,
       opaque" — the exact profile of a wall panel. Owner-filmed: an RPG into a
       street lamp hid the mast and built the city's interior-room prefab in
       mid-air over the sidewalk, with a rubble heap for a lamp that weighs
       nothing. `noBreach` is the existing, honoured opt-out (world/yard.js's
       perimeter uses it): the blast still scars, shakes, shatters glass and
       throws its debris here — the prop just never gets carved open, and never
       gets swept away as a "neighbour" of a real facade carve either. */
    function solidCollider(x, z, r, ref, noCam) {
      if (!CBZ.colliders) return null;
      const c = { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, ref, noCam: noCam !== false, noBreach: true };
      CBZ.colliders.push(c);
      return c;
    }
    /* REAL DEBRIS registration (see STREET PROPS BREAK INTO THEMSELVES).
       Records the group's meshes NOW, before core/batch.js detaches them.
       o.snap / o.keep / o.skip: meshes with that role; o.kinds: [[mesh, kind]]
       overrides; o.extra: parts that are not children (an instanced bulb);
       o.cols: this prop's colliders; o.rec: its shootable/knock record. */
    function breakable(g, type, x, z, o) {
      o = o || {};
      const parts = [];
      const has = (arr, m) => !!arr && arr.indexOf(m) >= 0;
      for (const m of g.children) {
        if (!m.isMesh || m.isInstancedMesh || has(o.skip, m)) continue;
        let kind = null;
        if (o.kinds) for (const kv of o.kinds) if (kv[0] === m) kind = kv[1];
        parts.push({ m, role: has(o.snap, m) ? "snap" : has(o.keep, m) ? "keep" : "main", kind });
      }
      if (o.extra) for (const p of o.extra) parts.push(p);
      const b = regBreakable({ type, x, z, g, parts, cols: (o.cols || []).filter(Boolean), rec: o.rec || null, cand: o.cand || null, smashed: false });
      if (o.rec) o.rec.brk = b;
      return b;
    }

    function doorLots() {
      const out = (city.lots || []).slice();
      if (city.annex && city.annex.lots) out.push.apply(out, city.annex.lots);
      return out;
    }
    function pointSegmentD2(px, pz, ax, az, bx, bz) {
      const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
      const den = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / den));
      const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
      return dx * dx + dz * dz;
    }
    // Door points sit just inside the room. Reserve the complete threshold and
    // exterior approach so a pole, bin or bench cannot visually block entry.
    function nearDoor(x, z, radius) {
      const r2 = radius * radius;
      for (const lot of doorLots()) {
        const d = lot.building && lot.building.door;
        if (!d) continue;
        const ex = d.x - d.nx * 4.8, ez = d.z - d.nz * 4.8;
        if (pointSegmentD2(x, z, d.x, d.z, ex, ez) < r2) return true;
      }
      return false;
    }

    // =====================================================================
    //  JUNCTION DETAIL — the corner is what makes a crossing read as designed.
    // =====================================================================
    //  OWNER: "roads meet at intersections right now feeling very
    //  unintentional." Two grey slabs crossed, the kerb met at a square point,
    //  and on every road built outside the mainland grid the centreline ran
    //  straight through the box.
    //
    //  NOTHING HERE IS AUTHORED. `city.roads` is the record every road builder
    //  in this game already pushes; city/roadrules.js now derives the crossings
    //  from it (CBZ.roadJunctions) and solves the kerb-return radius from the
    //  road's OWN cross-section — AASHTO design vehicle off `lanesPerDir`,
    //  minus the parking/clear zone the road already declares, capped by the
    //  footway the lots leave. So a village lane gets a tight 3 m corner and a
    //  four-lane arterial gets a 5 m one without a single number typed per
    //  place, and towns/causeways/minicity links — none of which appear in the
    //  grid's private `city.intersections` array — are junctions for the first
    //  time.
    //
    //  DRAW-CALL BUDGET: 3 for every junction in the world. One merged mesh of
    //  corner asphalt + resurfacing (batch-exempt: it carries polygonOffset,
    //  and core/batch.js's V2 merge re-materials its buckets and would silently
    //  drop it — the floating-yellow-line regression world.js documents), one
    //  merged mesh of kerb returns (plain Lambert, EMPTY userData, so the
    //  batcher may fold it further), one merged mesh of stop bars + crosswalks.
    //  Nothing here gets a collider: a kerb you cannot mount is a wall.
    const JUNCTIONS = (function junctionDetail() {
      if (!CBZ.roadJunctions) return [];
      // The flag turns off the DRAWING, not the MEASURING. With it off the
      // world is byte-identical to before this pass existed AND
      // CBZ.streetAudit() still reports the true before-state — which is the
      // only way `paintThroughJunction` means anything as a ratchet.
      const DRAW = CBZ.CONFIG.JUNCTION_DETAIL !== false;
      const all = CBZ.roadJunctions(city) || [];
      if (!all.length) return [];
      const MAX = Math.max(0, CBZ.CONFIG.JUNCTION_MAX | 0);
      const list = [];
      for (let i = 0; i < all.length && list.length < MAX; i++) {
        const J = all[i];
        // The same access law the lamp walk and every dressing pass obey: a
        // road reserved to one vehicle class (the apron's service lanes, a
        // compound's gate spur) is not a street and does not get a city corner.
        if (CBZ.roadPropRoadOk && (!CBZ.roadPropRoadOk(J.a) || !CBZ.roadPropRoadOk(J.b))) continue;
        // The mainland grid's corners, kerbs, crosswalks and stop bars are
        // drawn by city/streetkit.js as part of ONE street surface (rounded
        // blocks, real kerbs, ramps). A second fan/kerb/paint layer here would
        // only fight it, so both-grid junctions are left to the kit.
        if (J.a && J.b && J.a.grid && J.b.grid) continue;
        // A freeway is not a street: no crosswalks, stop bars, kerb returns
        // or resurface patches where anything meets a highway-district road
        // (highways.js stops its own paint at those junctions).
        if ((J.a && J.a.district === "highway") || (J.b && J.b.district === "highway")) continue;
        list.push(J);
      }
      if (!list.length) return list;

      const FILL_Y = 0.086;      // over world.js's 0.08 sidewalk slab, under its 0.10 lot pad
      const PAINT_Y = 0.092;
      const KERB_TOP = 0.22;     // world.js's own kerb height — the arc continues those strips
      const KERB_W = 0.34;       // ...and their width

      // ---- geometry sinks: three flat arrays, three meshes ---------------
      const fillP = [], fillN = [], kerbP = [], kerbN = [], paintP = [], paintN = [];
      // Winding is computed, never assumed. detail_kit.js's own comment records
      // what the mirrored order costs: the whole sheet silently renders
      // back-faces and vanishes. One cross-product per triangle removes the
      // entire class of bug.
      function tri(P, N, ax, ay, az, bx, by, bz, cx2, cy, cz2, nx, ny, nz) {
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx2 - ax, vy = cy - ay, vz = cz2 - az;
        const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
        if (wx * nx + wy * ny + wz * nz < 0) P.push(ax, ay, az, cx2, cy, cz2, bx, by, bz);
        else P.push(ax, ay, az, bx, by, bz, cx2, cy, cz2);
        for (let i = 0; i < 3; i++) N.push(nx, ny, nz);
      }
      function flatQuad(P, N, ax, az, bx, bz, cx2, cz2, dx2, dz2, y) {
        tri(P, N, ax, y, az, bx, y, bz, cx2, y, cz2, 0, 1, 0);
        tri(P, N, ax, y, az, cx2, y, cz2, dx2, y, dz2, 0, 1, 0);
      }
      // a painted rect on the road, axis-aligned
      function paintRect(cx2, cz2, w, d, y) {
        flatQuad(paintP, paintN, cx2 - w / 2, cz2 - d / 2, cx2 - w / 2, cz2 + d / 2,
          cx2 + w / 2, cz2 + d / 2, cx2 + w / 2, cz2 - d / 2, y);
      }

      // ---- WHAT DOES THIS JUNCTION ALREADY HAVE ---------------------------
      // The world tells the pass what it is missing. Every road-paint mesh in
      // this game is already marked `userData.roadPaint` (world.js, towngen.js
      // and highways.js all set it so core/batch.js cannot re-material away
      // their polygonOffset), so the paint IS queryable — nobody had queried
      // it. Two questions per junction, one scan:
      //   inBox   — lane paint running THROUGH the crossing. That is the
      //             "unintentional" tell, and it is what the resurfacing patch
      //             is for; junctions without it are left alone.
      //   approach— a crosswalk/stop bar already exists on that leg. The
      //             mainland grid has both; towns have crosswalks. Drawing a
      //             second set 0.8 m from the first would be worse than
      //             drawing none, so this pass only fills what is MISSING.
      const CELL = 96;
      const jgrid = new Map();
      function jkey(ix, iz) { return ix * 8192 + iz; }
      for (let i = 0; i < list.length; i++) {
        const J = list[i];
        J._inBox = 0; J._appr = [0, 0, 0, 0];   // -z, +z, -x, +x
        const reach = Math.max(J.ha, J.hb) + 10;
        const i0 = Math.floor((J.x - reach) / CELL), i1 = Math.floor((J.x + reach) / CELL);
        const k0 = Math.floor((J.z - reach) / CELL), k1 = Math.floor((J.z + reach) / CELL);
        for (let a = i0; a <= i1; a++) for (let b = k0; b <= k1; b++) {
          const k = jkey(a, b);
          let arr = jgrid.get(k); if (!arr) { arr = []; jgrid.set(k, arr); }
          arr.push(J);
        }
      }
      const _pv = new THREE.Vector3();
      let paintTris = 0;
      root.traverse(function (o) {
        if (!o.isMesh || !o.userData || !o.userData.roadPaint) return;
        const g = o.geometry, pa = g && g.attributes && g.attributes.position;
        if (!pa) return;
        o.updateWorldMatrix(true, false);
        const mw = o.matrixWorld, n = pa.count;
        const idx = g.index;
        const triN = idx ? idx.count / 3 : n / 3;
        for (let t = 0; t < triN; t++) {
          let sx = 0, sz = 0;
          for (let v = 0; v < 3; v++) {
            const vi = idx ? idx.getX(t * 3 + v) : t * 3 + v;
            _pv.fromBufferAttribute(pa, vi).applyMatrix4(mw);
            sx += _pv.x; sz += _pv.z;
          }
          sx /= 3; sz /= 3;
          paintTris++;
          const bucket = jgrid.get(jkey(Math.floor(sx / CELL), Math.floor(sz / CELL)));
          if (!bucket) continue;
          for (let q = 0; q < bucket.length; q++) {
            const J = bucket[q];
            const dx = sx - J.x, dz = sz - J.z;
            const adx = Math.abs(dx), adz = Math.abs(dz);
            if (adx < J.ha - 0.5 && adz < J.hb - 0.5) { J._inBox++; continue; }
            // APPROACH BAND, deliberately only 4 m deep. That is where a
            // crosswalk and a stop bar live; a lane line that RESUMES after a
            // junction gap starts further out than that (world.js sets back
            // ROAD/2+3 and its first dash centre lands ~6.5 m past the box,
            // towngen's ~6.6 m), so a gapped centreline cannot be mistaken for
            // crossing furniture and suppress the markings this pass adds.
            if (adx <= J.ha && adz > J.hb + 0.2 && adz < J.hb + 4.0) J._appr[dz < 0 ? 0 : 1]++;
            else if (adz <= J.hb && adx > J.ha + 0.2 && adx < J.ha + 4.0) J._appr[dx < 0 ? 2 : 3]++;
          }
        }
      });

      // ---- 1) KERB RETURNS -----------------------------------------------
      // The single change that does more than everything else here. The arc is
      // tangent to BOTH kerb lines by construction (centre at (h+R, h+R), so
      // its ends land exactly on x = h and z = h), which is what makes it read
      // as a road corner instead of a chamfer.
      let detailed = 0;
      for (let i = 0; i < list.length; i++) {
        const J = list[i], R = J.r, ha = J.ha, hb = J.hb;
        if (!(R > 0.5)) continue;
        // the junction's own deck height, so a raised causeway crossing gets
        // its corner at ITS level rather than at the mainland's
        const jy = J.y || 0, FY = FILL_Y + jy, KY = KERB_TOP + jy, PY = PAINT_Y + jy;
        const segs = Math.max(3, Math.min(8, Math.round(R * 1.1)));
        let corners = 0;
        for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
          // A CORNER NEEDS TWO LEGS. At a T-junction — a spur ending on a
          // street, which is most of what govcomplex, the towns and the
          // causeway network build — the two corners on the far side of the
          // through road are not corners at all: the kerb there runs straight.
          // Carving a return into it would be a notch cut out of nothing.
          if (!(sz > 0 ? J.nz : J.sz)) continue;
          if (!(sx > 0 ? J.px : J.mx)) continue;
          const ccx = J.x + sx * (ha + R), ccz = J.z + sz * (hb + R);
          // arc, plus one point pushed onto each carriageway so the new asphalt
          // overlaps the old and cannot leave a hairline at the joint
          const ax = [J.x + sx * (ha - 0.25)], az = [J.z + sz * (hb + R)];
          for (let k = 0; k <= segs; k++) {
            const th = (k / segs) * (Math.PI / 2);
            ax.push(ccx - sx * R * Math.cos(th));
            az.push(ccz - sz * R * Math.sin(th));
          }
          ax.push(J.x + sx * (ha + R)); az.push(J.z + sz * (hb - 0.25));
          // asphalt fan from the square corner out to the arc
          const px = J.x + sx * (ha - 0.25), pz = J.z + sz * (hb - 0.25);
          for (let k = 0; k + 1 < ax.length; k++) {
            tri(fillP, fillN, px, FY, pz, ax[k], FY, az[k], ax[k + 1], FY, az[k + 1], 0, 1, 0);
          }
          // the kerb itself: a top strip running outward from the arc, and the
          // vertical face the road sees. 4 triangles a segment — a box per
          // segment would be three times the vertices for the two faces nobody
          // can see.
          for (let k = 1; k + 1 < ax.length - 1; k++) {
            const x0 = ax[k], z0 = az[k], x1 = ax[k + 1], z1 = az[k + 1];
            let o0x = ccx - x0, o0z = ccz - z0; const l0 = Math.hypot(o0x, o0z) || 1; o0x /= l0; o0z /= l0;
            let o1x = ccx - x1, o1z = ccz - z1; const l1 = Math.hypot(o1x, o1z) || 1; o1x /= l1; o1z /= l1;
            flatQuad(kerbP, kerbN, x0, z0, x0 + o0x * KERB_W, z0 + o0z * KERB_W,
              x1 + o1x * KERB_W, z1 + o1z * KERB_W, x1, z1, KY);
            // inner face, normal pointing back into the junction
            const fnx = -(o0x + o1x) / 2, fnz = -(o0z + o1z) / 2;
            tri(kerbP, kerbN, x0, FY, z0, x1, FY, z1, x1, KY, z1, fnx, 0, fnz);
            tri(kerbP, kerbN, x0, FY, z0, x1, KY, z1, x0, KY, z0, fnx, 0, fnz);
          }
          corners++;
        }
        // counted on CORNERS ACTUALLY BUILT, so a junction whose legs all fail
        // cannot pad the ratchet with a return nobody drew
        if (corners) { detailed++; J._corners = corners; }

        // ---- 2) RESURFACE, but only where paint actually runs through -----
        // A junction whose builder already stops its markings (the mainland
        // grid under ROADS_V2, every town) is left exactly as it was.
        if (J._inBox > 0) {
          if (DRAW) {
            flatQuad(fillP, fillN, J.x - ha, J.z - hb, J.x - ha, J.z + hb,
              J.x + ha, J.z + hb, J.x + ha, J.z - hb, FY);
            J._patched = true;
          }
        }

        // ---- 3) STOP LINE + CROSSWALK on legs that have neither ----------
        // MUTCD geometry: the crosswalk sits tight to the throat, and the stop
        // line is set back 1.2 m (4 ft) BEHIND it — not the 0.2 m the mainland
        // grid uses. Crosswalk width scales with the road it crosses (1.8 m
        // minimum, 3.0 m where the road is wide enough to warrant it).
        const legs = [
          { on: J.sz, ax: 0, s: -1, h: J.hb, cross: J.ha },
          { on: J.nz, ax: 0, s: 1, h: J.hb, cross: J.ha },
          { on: J.mx, ax: 1, s: -1, h: J.ha, cross: J.hb },
          { on: J.px, ax: 1, s: 1, h: J.ha, cross: J.hb },
        ];
        for (let L = 0; L < 4; L++) {
          const leg = legs[L];
          if (!leg.on) continue;                      // no oncoming road on this side
          if (J._appr[L] > 0) continue;               // already marked by its builder
          const halfRoad = leg.cross;
          const xw = Math.max(1.8, Math.min(3.0, 0.16 * halfRoad * 2));
          const near = leg.h + 0.6;
          const stopAt = near + xw + 1.2 + 0.22;      // + half the bar
          // zebra bars, long in the direction of travel, across the full width
          const nb = Math.max(2, Math.ceil(halfRoad / 1.1));
          for (let k = -nb; k <= nb; k++) {
            const lat = k * 1.1;
            if (Math.abs(lat) > halfRoad - 0.5) continue;
            if (leg.ax === 0) paintRect(J.x + lat, J.z + leg.s * (near + xw / 2), 0.6, xw, PY);
            else paintRect(J.x + leg.s * (near + xw / 2), J.z + lat, xw, 0.6, PY);
          }
          // stop bar — the approach half only. Keep right (config.js
          // roadLaneSide): traffic arriving on leg s travels -s, so on a
          // north-south leg its lanes sit on +s in x (heading -z, the driver's
          // right is +x) and on an east-west leg on -s in z. The old signs
          // were mirrored on both axes: the bar sat across the EXIT lanes.
          const barC = halfRoad / 2, barW = halfRoad - 0.6;
          if (leg.ax === 0) paintRect(J.x + (leg.s > 0 ? barC : -barC), J.z + leg.s * stopAt, barW, 0.45, PY);
          else paintRect(J.x + leg.s * stopAt, J.z + (leg.s > 0 ? -barC : barC), 0.45, barW, PY);
          J._marked = (J._marked || 0) + 1;
        }
      }

      // ---- 4) the straight kerbs the return REPLACES ----------------------
      // world.js rings every block with 0.34 x 0.22 kerb boxes that run to the
      // square corner. A return drawn inside them is just a second kerb, so the
      // straight run is shortened to the arc's tangent point — which is what a
      // kerb return IS. This is the one part of this pass that keys off another
      // file's geometry rather than off the road record, so it matches on that
      // exact signature, only ever SHRINKS, and is separately revertible.
      let trimmed = 0;
      if (DRAW && CBZ.CONFIG.JUNCTION_CURB_TRIM !== false) {
        const kerbs = [];
        root.traverse(function (o) {
          if (!o.isMesh || !o.geometry || o.geometry.type !== "BoxGeometry") return;
          const p = o.geometry.parameters;
          if (!p || Math.abs(p.height - 0.22) > 1e-6) return;
          if (Math.abs(o.position.y - 0.11) > 1e-6) return;
          const alongX = Math.abs(p.depth - 0.34) < 1e-6 && p.width > 2;
          const alongZ = Math.abs(p.width - 0.34) < 1e-6 && p.depth > 2;
          if (!alongX && !alongZ) return;
          kerbs.push({ m: o, vert: alongZ, len: alongZ ? p.depth : p.width });
        });
        for (let i = 0; i < kerbs.length; i++) {
          const K = kerbs[i], m = K.m;
          const c = K.vert ? m.position.z : m.position.x;
          const lat = K.vert ? m.position.x : m.position.z;
          const lo = c - K.len / 2, hi = c + K.len / 2;
          let cut0 = 0, cut1 = 0;                     // low end, high end
          for (let j = 0; j < list.length; j++) {
            const J = list[j];
            // jl = the junction coordinate ACROSS the kerb (which road's edge
            // this kerb lines); jc = the junction coordinate ALONG it (where on
            // the kerb the crossing sits); hAl = the half-width of the crossing
            // road, i.e. how far the kerb currently runs into the junction box.
            const jl = K.vert ? J.x : J.z, jc = K.vert ? J.z : J.x;
            const hLat = K.vert ? J.ha : J.hb, hAl = K.vert ? J.hb : J.ha;
            if (Math.abs(lat - jl) > hLat + 1.6) continue;        // not this road's kerb
            const want = hAl + J.r + 0.1;                          // the arc's tangent point
            // ...and only where a return was ACTUALLY drawn. A T-junction's far
            // corners get none (see above), so their kerbs must stay whole —
            // shortening one there would leave a gap with nothing in it.
            const latS = (lat - jl) >= 0 ? 1 : -1;
            const drawn = function (endS) {
              const sx = K.vert ? latS : endS, sz = K.vert ? endS : latS;
              return (sx > 0 ? J.px : J.mx) && (sz > 0 ? J.nz : J.sz);
            };
            if (jc < c && drawn(-1) && Math.abs(lo - (jc + hAl)) < 3.0) cut0 = Math.max(cut0, (jc + want) - lo);
            if (jc > c && drawn(1) && Math.abs(hi - (jc - hAl)) < 3.0) cut1 = Math.max(cut1, hi - (jc - want));
          }
          if (cut0 < 0) cut0 = 0;
          if (cut1 < 0) cut1 = 0;
          if (cut0 <= 0.05 && cut1 <= 0.05) continue;
          const newLen = K.len - cut0 - cut1;
          if (newLen < 1.0) { m.visible = false; trimmed++; continue; }
          const shift = (cut0 - cut1) / 2;
          if (K.vert) { m.scale.z = newLen / K.len; m.position.z += shift; }
          else { m.scale.x = newLen / K.len; m.position.x += shift; }
          trimmed++;
        }
      }

      // ---- build: three meshes for every junction in the world ------------
      function sink(P, N, material, name, exempt, order) {
        if (!P.length) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
        g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(N), 3));
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, material);
        m.name = name;
        m.castShadow = false;
        m.receiveShadow = !exempt;
        m.matrixAutoUpdate = false; m.updateMatrix();
        if (order != null) m.renderOrder = order;
        // roadPaint == "core/batch.js must not re-material this": the V2 merge
        // drops polygonOffset and the decal starts z-fighting the asphalt. The
        // kerb mesh deliberately does NOT set it — it is plain lit geometry and
        // the batcher is welcome to fold it into the rest of the static world.
        if (exempt) m.userData.roadPaint = true;
        root.add(m);
        return m;
      }
      const fillM = new THREE.MeshLambertMaterial({
        color: 0x282a30, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      });
      fillM._shared = true;
      const paintM = new THREE.MeshBasicMaterial({
        color: 0xeef1f5, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
      });
      paintM._shared = true;
      if (DRAW) {
        sink(fillP, fillN, fillM, "junction-surface", true, 2);
        sink(kerbP, kerbN, smat(0xb9ad88), "junction-kerbs", false, null);
        sink(paintP, paintN, paintM, "junction-markings", true, 3);
      }

      // THE RATCHET'S EVIDENCE, and both halves are reported so neither can
      // absorb the other: `through` is how many junctions a road builder ran
      // its lane paint straight across (the owner's "unintentional" tell,
      // measured over the real geometry, not asserted), `uncovered` is how many
      // of those are still VISIBLE after this pass resurfaced the box.
      let through = 0, uncovered = 0, marked = 0;
      for (let i = 0; i < list.length; i++) {
        const J = list[i];
        if (J._inBox > 0) { through++; if (!J._patched) uncovered++; }
        marked += (J._marked || 0);
      }
      city._junctionStats = {
        junctions: list.length, detailed: detailed, trimmed: trimmed,
        through: through, uncovered: uncovered, marked: marked,
        paintTris: paintTris,
        drawCalls: DRAW ? ((fillP.length ? 1 : 0) + (kerbP.length ? 1 : 0) + (paintP.length ? 1 : 0)) : 0,
      };
      // Only a world that was actually DRAWN moves the signal poles onto the
      // rounded corner — flag off, the heads stay exactly where they were.
      return DRAW ? list : [];
    })();

    // ---- TRAFFIC SIGNALS: real US mast-arm installations ----
    // Standard four-leg layout, FAR-SIDE signals (a driver reads the heads
    // across the junction, not the ones beside their bumper):
    //   • each approach gets a MAST ARM from the pole on its far-right corner,
    //     reaching out over its lanes with one 3-section head centred over
    //     every lane (lane centres come from the road record's lane contract,
    //     the same numbers traffic drives on), and the cross street's name
    //     blade hung from the arm beside the heads;
    //   • plus a POLE-MOUNTED head on its far-left corner;
    //   • pedestrian heads (hand over walking person) face across every
    //     crosswalk from both ends, with a push button below each one.
    // Everyone keeps right (config.js roadLaneSide): northbound (+z) runs at
    // -x, southbound at +x, eastbound (+x) at +z, westbound at -z. The four
    // approaches are a literal table checked against CBZ.roadLaneCenter.
    // Each approach's far-right corner is a different corner, so every corner
    // carries one mast arm plus the pedestal head for the approach it is
    // far-left of. The cobra luminaires stay on the NE and SW masts only (the
    // junction's light budget is unchanged).
    // Every piece is one InstancedMesh prototype from city/street_hardware.js
    // (a draw call per prototype for the whole city); the lenses are the
    // three instanced colour pools traffic.js already drives through
    // CBZ.citySignalSet — every extra head is simply another handle in the
    // SAME ns/ew axis arrays, so traffic.js needed no change at all.
    const HW = CBZ.streetHW || null;
    if (HW) HW.resetSets();          // this world's cells only in the distance gate
    const D = HW ? HW.D : {      // headless (no kit loaded): handles only, same numbers
      MAST_TOP: 7.7, ARM_Y: 6.25, HEAD_HANG: 0.76, LENS_Z: 0.135, LENS_DY: 0.355, SIDE_BACK: 0.46,
      PED_Y: 2.72, PED_OUT: 0.35, PED_LENS_DY: 0.19, SIDE_HEAD_Y: 3.95,
      mastRAt: () => 0.18, pedRAt: () => 0.1, armYAt: (s, L) => 6.25 + 0.35 * s / (L || 1), armRAt: () => 0.1,
    };
    const sigLampHandles = { red: [], yel: [], grn: [] };  // every vehicle lens, by colour slot
    const sigShellHeads = [];      // {head, spots}: mast-arm heads carry a Fresnel halo per bulb
    const sigPoolSrc = [];         // one faint coloured wash on the road per approach
    const pedHandles = [];         // {axis, hand, walk, state} per crosswalk end
    const HWI = { mast: [], ped: [], arm: [], headTop: [], headSide: [], pedHead: [] };
    const HWSET = {};              // part -> {set, geo, mat, items}: the standing chunk sets
    const mastLums = [];           // {x,z,ang}: the luminaire on top of each mast pole
    const signalBlades = city._signalBlades = [];   // drawn into the sign atlas by world/street_furniture.js
    function vehHead(cx, cy, cz, ry, mount, halo, owner) {
      const fx = Math.sin(ry), fz = Math.cos(ry);
      const lx = cx + fx * D.LENS_Z, lz = cz + fz * D.LENS_Z;
      const red = { lit: false, x: lx, y: cy + D.LENS_DY, z: lz, ry: ry };
      const yel = { lit: false, x: lx, y: cy, z: lz, ry: ry };
      const grn = { lit: false, x: lx, y: cy - D.LENS_DY, z: lz, ry: ry };
      sigLampHandles.red.push(red); sigLampHandles.yel.push(yel); sigLampHandles.grn.push(grn);
      own(owner, mount === "top" ? "headTop" : "headSide", { x: cx, y: cy, z: cz, ry: ry });
      const head = { red, yel, grn };
      let entry = { head, spots: null };
      if (halo) {
        const hx = lx + fx * 0.06, hz = lz + fz * 0.06;
        const spots = {
          red: { x: hx, y: red.y, z: hz, r: 0.3 },
          yel: { x: hx, y: yel.y, z: hz, r: 0.3 },
          grn: { x: hx, y: grn.y, z: hz, r: 0.3 },
        };
        sigGlowSpots.red.push(spots.red); sigGlowSpots.yel.push(spots.yel); sigGlowSpots.grn.push(spots.grn);
        entry = { head, spots };
        sigShellHeads.push(entry);
      }
      if (owner) owner.heads.push(entry);
      return head;
    }
    // every instance a pole carries is recorded on it ({part, i}), so a break
    // can zero exactly those instances in their chunk cells
    function own(c, part, item) {
      HWI[part].push(item);
      if (c) c.own.push({ part: part, i: HWI[part].length - 1 });
    }
    const allPoles = [];
    // |lateral offset| of every lane centre for travel in the +dir direction,
    // read from the road record (avenues carry a median, streets do not).
    function laneCentres(vertical, line) {
      let road = null;
      for (const r of city.roads) {
        if (!!r.vertical === vertical && Math.abs((vertical ? r.x : r.z) - line) < 0.6) { road = r; break; }
      }
      const n = road && CBZ.roadLanesPerDir ? CBZ.roadLanesPerDir(road) : 2;
      const out = [];
      for (let i = 0; i < n; i++) out.push(road && CBZ.roadLaneCenter ? Math.abs(CBZ.roadLaneCenter(road, 1, i)) : 3.6 * (i + 0.5));
      return out;
    }
    // leg = the leg the approach ARRIVES on; mast/far = corner sign pairs
    // (x, z); arm = the arm's direction from its pole; face = rotY that turns a
    // head's +Z face back at the arriving driver.
    const APPROACHES = [
      { leg: "S", axis: "ns", vert: true,  mast: [-1, 1],  far: [1, 1],   arm: [1, 0],  face: Math.PI },       // northbound, lanes at -x
      { leg: "N", axis: "ns", vert: true,  mast: [1, -1],  far: [-1, -1], arm: [-1, 0], face: 0 },             // southbound, lanes at +x
      { leg: "W", axis: "ew", vert: false, mast: [1, 1],   far: [1, -1], arm: [0, -1], face: -Math.PI / 2 },  // eastbound, lanes at +z
      { leg: "E", axis: "ew", vert: false, mast: [-1, -1], far: [-1, 1], arm: [0, 1],  face: Math.PI / 2 },   // westbound, lanes at -z
    ];
    // crosswalk ends: the head on `corner` faces the far kerb of that
    // crosswalk; its WALK follows the travel axis the crossing runs beside.
    const PED_ENDS = [
      { leg: "N", corner: [1, 1],   face: -Math.PI / 2, axis: "ew" }, { leg: "N", corner: [-1, 1],  face: Math.PI / 2, axis: "ew" },
      { leg: "S", corner: [1, -1],  face: -Math.PI / 2, axis: "ew" }, { leg: "S", corner: [-1, -1], face: Math.PI / 2, axis: "ew" },
      { leg: "E", corner: [1, 1],   face: Math.PI,      axis: "ns" }, { leg: "E", corner: [1, -1],  face: 0,           axis: "ns" },
      { leg: "W", corner: [-1, 1],  face: Math.PI,      axis: "ns" }, { leg: "W", corner: [-1, -1], face: 0,           axis: "ns" },
    ];
    // the footway surface a pole's footing stands on (STREETS' analytic
    // street profile: raised footway, kerb, road). Everything bolted to a
    // pole is placed relative to its own base, so a raised kerb lifts it all.
    function footY(x, z) {
      const st = city.street;
      const h = st && typeof st.heightAt === "function" ? +st.heightAt(x, z) : 0;
      return Number.isFinite(h) ? h : 0;
    }
    // THE POLE STANDS ON THE CORNER THE CORNER ACTUALLY HAS. This offset used
    // to be a flat ROAD/2 + 0.6 — 0.6 m outside the square kerb, which is
    // exactly the ground the kerb RETURN above turns into carriageway. Rounding
    // the corner without moving the signals would leave every head standing in
    // the road. The arc bites 0.2929*R diagonally into the corner (the same
    // constant roadrules.js solves the radius against), so the pole goes just
    // outside that, on the footway, where a real one is bolted.
    const juncOff = (function () {
      const by = new Map();
      for (let i = 0; i < JUNCTIONS.length; i++) {
        const J = JUNCTIONS[i];
        by.set(Math.round(J.x) + "," + Math.round(J.z), J);
      }
      const BITE = CBZ.roadCornerBite != null ? CBZ.roadCornerBite : (1 - Math.SQRT1_2);
      // the grid's own corner (city/streetkit.js, radius city.street.cornerR):
      // the pole lands at the back of the corner footway, clear of the kerb
      const gridOff = city.street && city.street.cornerR > 0
        ? city.ROAD / 2 + BITE * city.street.cornerR + 0.55 : city.ROAD / 2 + 0.6;
      return function (it) {
        const J = by.get(Math.round(it.x) + "," + Math.round(it.z));
        if (!J) return gridOff;
        return Math.max(J.ha, J.hb) + BITE * J.r + 0.55;
      };
    })();
    const NL = city.N != null ? city.N : ((city.xLines || [1]).length - 1);
    for (const it of city.intersections) {
      const off = juncOff(it);
      // a leg exists unless this crossing sits on the outermost line on that side
      const legs = { S: it.j > 0, N: it.j < NL, W: it.i > 0, E: it.i < NL };
      const ns = [], ew = [];
      const vL = laneCentres(true, it.x), hL = laneCentres(false, it.z);
      const corners = new Map();
      const corner = function (s, kind) {
        const k = s[0] + "," + s[1];
        let c = corners.get(k);
        if (!c) {
          const cx = it.x + s[0] * off, cz = it.z + s[1] * off;
          c = { sx: s[0], sz: s[1], x: cx, z: cz, y: footY(cx, cz), kind: kind, own: [], heads: [], cands: [], peds: [], lums: [], col: null };
          corners.set(k, c);
        }
        else if (kind === "mast") c.kind = "mast";
        return c;
      };
      // every mast corner first, so a corner's pole type is settled before
      // anything measures its radius
      for (const A of APPROACHES) if (legs[A.leg]) corner(A.mast, "mast");
      for (const A of APPROACHES) {
        if (!legs[A.leg]) continue;
        const lanes = A.vert ? vL : hL;
        const P = corner(A.mast, "mast");
        const fvx = Math.sin(A.face), fvz = Math.cos(A.face);
        // distance along the arm from the pole axis to each lane centre
        const along = lanes.map(function (c) { return off - c; }).sort(function (a, b) { return a - b; });
        const L = along[along.length - 1] + 0.55;
        own(P, "arm", { x: P.x, y: P.y + D.ARM_Y, z: P.z, ry: Math.atan2(A.arm[0], A.arm[1]), sx: 1, sy: 1, sz: L });
        const axisHeads = A.axis === "ns" ? ns : ew;
        let firstHead = null, fx0 = 0, fy0 = 0, fz0 = 0;
        for (const s of along) {
          const hx = P.x + A.arm[0] * s, hz = P.z + A.arm[1] * s;
          const hy = P.y + D.armYAt(s, L) - D.armRAt(s, L) - D.HEAD_HANG + 0.02;
          const h = vehHead(hx, hy, hz, A.face, "top", true, P);
          axisHeads.push(h);
          if (!firstHead) { firstHead = h; fx0 = hx; fy0 = hy; fz0 = hz; }
        }
        // one real-light candidate per approach (the pooled PointLights below)
        const cand = { x: fx0, y: fy0, z: fz0, kind: "signal", head: firstHead };
        lightCandidates.push(cand); P.cands.push(cand);
        // a faint wash of the lit colour on the road in front of the heads
        let cMid = 0; for (const c of lanes) cMid += c; cMid /= lanes.length;
        const sMid = off - cMid, span = (lanes[lanes.length - 1] - lanes[0]) + 5;
        sigPoolSrc.push({ head: firstHead, x: P.x + A.arm[0] * sMid + fvx * 5.5, z: P.z + A.arm[1] * sMid + fvz * 5.5, ry: A.face, sx: span, sz: 11 });
        // the CROSS street's name, hung from the arm between pole and heads
        const sb = along[0] - 0.25 - 0.9 - 0.35;
        if (sb - 0.9 > 0.4) {
          const by = P.y + D.armYAt(sb, L) - D.armRAt(sb, L) - 0.02 - 0.225;
          signalBlades.push({
            x: P.x + A.arm[0] * sb, y: by, z: P.z + A.arm[1] * sb, nx: fvx, nz: fvz, w: 1.8, h: 0.45,
            key: A.vert ? "h:" + Math.round(it.z) : "v:" + Math.round(it.x), vertical: !A.vert,
          });
        }
        // the supplementary head bolted to the far-left pole
        const F = corner(A.far, "ped");
        const rr = (F.kind === "mast" ? D.mastRAt(D.SIDE_HEAD_Y) : D.pedRAt(D.SIDE_HEAD_Y)) + D.SIDE_BACK;
        axisHeads.push(vehHead(F.x + fvx * rr, F.y + D.SIDE_HEAD_Y, F.z + fvz * rr, A.face, "side", false, F));
      }
      // pedestrian heads + push buttons on every crosswalk end
      for (const E of PED_ENDS) {
        if (!legs[E.leg]) continue;
        const C = corner(E.corner, "ped");
        const rr = C.kind === "mast" ? D.mastRAt(D.PED_Y) : D.pedRAt(D.PED_Y);
        const fvx = Math.sin(E.face), fvz = Math.cos(E.face);
        const bx = C.x + fvx * rr, bz = C.z + fvz * rr;
        own(C, "pedHead", { x: bx, y: C.y + D.PED_Y, z: bz, ry: E.face });
        const lx = bx + fvx * (D.PED_OUT + 0.004), lz = bz + fvz * (D.PED_OUT + 0.004);
        const ph = {
          axis: E.axis, state: -1,
          hand: { x: lx, y: C.y + D.PED_Y + D.PED_LENS_DY, z: lz, ry: E.face },
          walk: { x: lx, y: C.y + D.PED_Y - D.PED_LENS_DY, z: lz, ry: E.face },
        };
        pedHandles.push(ph); C.peds.push(ph);
      }
      // the poles themselves: slim colliders matched to the shafts
      corners.forEach(function (c) {
        const ry = Math.atan2(c.sx, c.sz);     // handhole faces the footway, not the road
        if (c.kind === "mast") {
          own(c, "mast", { x: c.x, y: c.y, z: c.z, ry: ry });
          // the junction is the best-lit spot on a real street: a cobra head
          // on the NE and SW mast tops, aimed diagonally into the box
          if (c.sx === c.sz) {
            const lum = { x: c.x, y: c.y, z: c.z, ang: Math.atan2(-c.sx, -c.sz), i: mastLums.length, rec: null };
            mastLums.push(lum); c.lums.push(lum);
          }
          c.col = solidCollider(c.x, c.z, 0.23, null);
        } else {
          own(c, "ped", { x: c.x, y: c.y, z: c.z, ry: ry });
          c.col = solidCollider(c.x, c.z, 0.15, null);
        }
        allPoles.push(c);
      });
      // ns/ew are arrays of heads; traffic.js lights every head in an axis
      // together. The single-head fields point at each axis' first head.
      const ns0 = ns[0] || null, ew0 = ew[0] || null;
      it.light = { ns, ew, head: ns0 || ew0, red: ns0 && ns0.red, yel: ns0 && ns0.yel, grn: ns0 && ns0.grn };
    }
    if (HW) {
      const M = HW.hardwareMaterial(false), MDS = HW.hardwareMaterial(true);
      // one InstancedMesh per 200 m cell per part, frustum-culled (see chunked())
      const part = function (key, name, geo2, mat2, o) {
        HWSET[key] = { set: HW.chunked(name, geo2, mat2, HWI[key], o).addTo(root), geo: geo2, mat: mat2, items: HWI[key] };
      };
      part("mast", "signal-mast", HW.mastPole(), M, { cast: true });
      part("ped", "signal-pedestal", HW.pedPole(), M, { cast: true });
      part("arm", "signal-arm", HW.mastArm(), M, { cast: true });
      // heads are DoubleSide: the visors are open tubes you see the inside of
      part("headTop", "signal-head-arm", HW.vehicleHead("top"), MDS, { cast: true });
      part("headSide", "signal-head-pole", HW.vehicleHead("side"), MDS, {});
      part("pedHead", "ped-head", HW.pedHead(), MDS, {});
    }

    // ---- STREET LIGHTS: cobra heads on davit poles, both kerbs ----
    // Roads span the whole map, so a lamp marched down a road's length will,
    // wherever it crosses a perpendicular street, land in the MIDDLE of that
    // cross-road. Skip any position within the junction box, its rounded
    // corners and the signal poles standing on them (ROAD/2 + 4.5) so lamps
    // only ever stand on real footway. The junction itself is lit by the
    // luminaires on top of the signal masts.
    const crossClear = city.ROAD / 2 + 4.5;
    const crossLines = (vertical) => (vertical ? (city.allZLines || city.zLines) : (city.allXLines || city.xLines));
    function inCrossRoad(t, vertical, road) {
      const lines = crossLines(vertical);
      const center = vertical ? road.z : road.x;
      const coord = center + t;            // t is measured from road centre
      for (const c of lines) if (Math.abs(coord - c) < crossClear) return true;
      return false;
    }
    // Region builders append roads after the mainland grid lines are frozen.
    // Those causeways therefore do not exist in allXLines/allZLines and the
    // line-only test above missed them. Test the actual rendered travel boxes
    // as well so a lamp from one road can never land in another road's lane.
    function inOtherTravelLane(x, z, own) {
      for (const road of city.roads) {
        if (road === own) continue;
        const half = road.len / 2 + 0.7;
        const travelHalf = ((road.lanesPerDir || 2) * (road.laneW || 3.6)) + 0.7;
        if (road.vertical) {
          if (Math.abs(x - road.x) < travelHalf && Math.abs(z - road.z) < half) return true;
        } else if (Math.abs(z - road.z) < travelHalf && Math.abs(x - road.x) < half) return true;
      }
      return false;
    }
    // THE ONE SOLVE (CBZ.lampMast, top of this file): an 8 m shaft, the head
    // 2.8 m out over the kerb lane, 0.35 m of climb. street_hardware.js builds
    // the davit as one sweep from the shaft top to that solved tip and hangs
    // the cobra head on it, so pole, arm and head cannot come apart.
    const LM = CBZ.lampMast({ poleH: 8.0, reach: 2.8, rise: 0.35, poleR: 0.1 });
    const LO = HW ? HW.lumOffsets(LM) : { bellyY: LM.tipY - 0.04, bulbY: LM.tipY - 0.075, bulbZ: LM.tipZ + 0.33 };
    const headLampM = lampMat(0xffe9a8);          // the drop lens: shared, glow driven by night
    headLampM.emissiveIntensity = 0.0;
    headLampM.color.setHex(0x8e8a80);             // by day: dull glass in a grey housing, not a white disc
    // LIGHT ON THE ROAD. Warm (~3000 K), a type-III footprint: long along the
    // kerb, thrown out over the carriageway, hot spot at the head's nadir.
    // TUNED IN A MODEL, NOT BY EYE (street_hardware.js poolMaterial has the
    // falloff; the numbers are a plain-node fit of the real pipeline: ACES +
    // grade at the deep-night exposure 0.79, asphalt albedo 0.068, the pool
    // added in display space, vs the physical cos^3 sum of 8.4 m heads every
    // 13 m on alternating kerbs, E0 set so the road under a head reads 0.36):
    //   old 15 x 11 m, K 1.0: peak display (0.92, 0.75, 0.57), i.e. an orange
    //     blob near white, and 0.04 (unlit road) between pools, min/max 0.06
    //     along the kerb lane: hard spots on black.
    //   new 32 x 16 m, K 0.42 (x the 0.9 night ramp): peak (0.40, 0.34, 0.29),
    //     kerb lane min/max 0.32 (physical 0.56), centre lanes 0.87 (0.79):
    //     no black gaps, still a visible rhythm of pools.
    // ALONG 32 is the reach the 13 m stagger needs: 28 leaves the unlit 0.05
    // between pools (black again), 36 lifts the trough to 0.17, which is
    // closer to a uniform wash, for +12 % fill. ACROSS 16 with the quad centre SHIFT
    // 3.2 m past the bulb toward the road puts the far rim 3.5 m beyond the
    // centreline and the kerb-side rim at 11.5 m, still on the footway (it
    // ends at 11), never inside a shop.
    const LAMP_POOL_HEX = 0xffc88a, LAMP_POOL_K = 0.42, LAMP_POOL_ALONG = 32, LAMP_POOL_ACROSS = 16, LAMP_POOL_SHIFT = 3.2;
    const SIG_POOL = { red: [0xff2a1c, 0.16], yel: [0xffae00, 0.13], grn: [0x1cff8e, 0.11] };
    const lampBulbSpots = [];                     // {x,z,ang} per luminaire; index == lampIdx
    const lampPosts = [];                         // pole instances (the full lamp prototype)
    // LAMP CENSUS — every lamp POLE in this world and whether its head actually
    // overhangs the carriageway. towngen.js writes into the SAME record (its
    // towns are built earlier in the same buildCity), so CBZ.streetAudit reads
    // ONE count for the whole map and a future lamp source costs it no edit.
    // (The mast-top luminaires are not poles and are not counted.)
    const lampCensus = city._lampCensus = city._lampCensus || { lamps: 0, noCollider: 0, overRoad: 0 };
    // every luminaire (post or mast top) registers the same records: a lens
    // instance, a light-pool instance at the SAME index (hitProp zero-scales
    // both through lampPools when the head is shot out), a Fresnel glow shell,
    // a shootable centred on the HEAD, and a real-light candidate.
    function registerLamp(x, z, ang, y0) {
      const lampIdx = lampBulbSpots.length;
      lampBulbSpots.push({ x, z, ang, y0 });
      const bwx = x + Math.sin(ang) * LO.bulbZ, bwz = z + Math.cos(ang) * LO.bulbZ;
      const glowSpot = { x: bwx, y: y0 + LO.bulbY, z: bwz, r: 0.36 };
      lampGlowSpots.push(glowSpot);
      const shootRec = { type: "lamp", x: bwx, z: bwz, y: y0 + LO.bulbY, r: 0.7, bulb: null, glow: null, lampIdx, broken: false, glowSpot };
      shootables.push(shootRec);
      // `ref` lets the pool driver below skip a shot-out lamp (shootRec.broken
      // flips true in hitProp) without a separate "is this lamp dead" lookup.
      lightCandidates.push({ x: bwx, y: y0 + LO.bulbY, z: bwz, kind: "lamp", ref: shootRec });
      return shootRec;
    }
    const lampBrk = [];            // {i, x, y, z, ang, rec, col} per lamp POST, for breakable()
    function makeLampPost(x, z, faceX, faceZ) {
      const ang = Math.atan2(faceX, faceZ);       // davit reaches toward the road centre
      const y0 = footY(x, z);
      lampPosts.push({ x, y: y0, z, ry: ang });
      // SLIM COLLIDER, matched to the 0.155 m butt of the shaft.
      const col = solidCollider(x, z, 0.17, null);
      city.streetProps.push({ x, z, type: "lamp" });
      const rec = registerLamp(x, z, ang, y0);
      lampBrk.push({ i: lampPosts.length - 1, x, y: y0, z, ang, rec, col });
    }
    for (const m of mastLums) m.rec = registerLamp(m.x, m.z, m.ang, m.y);
    // Stations every LAMP_STEP metres alternate kerbs, so each kerb gets a
    // lamp every 2*LAMP_STEP, staggered against the opposite one: the classic
    // two-sided arterial layout, and the pools overlap into a continuous lit
    // carriageway instead of isolated spots.
    const LAMP_STEP = 13;
    for (const r of city.roads) {
      // NO STREET LAMPS ON HIGHWAYS/BRIDGES (owner: "dumb useless props like
      // streetlights on the highway and bridges"). Real highways/spans here
      // run unlit, so skip those districts outright.
      if (r.district === "highway" || r.district === "bridge") continue;
      // A TOWN LIGHTS ITS OWN STREETS (towngen.js section 6 plants 6 m lamps
      // on them and tags the road). Walking it again stood a second, 8 m city
      // lamp every 13 m between the town's own: two lamp systems, one street.
      if (r.litByTown) continue;
      // NO CITY STREET FURNITURE ON RESTRICTED GROUND (roadrules.js): apron
      // service lanes and compound spurs are not streets.
      if (CBZ.roadPropRoadOk && !CBZ.roadPropRoadOk(r)) continue;
      const n = Math.max(2, Math.floor(r.len / LAMP_STEP));
      const half = (r.w != null ? r.w : city.ROAD) / 2;
      for (let i = 0; i <= n; i++) {
        const t = -r.len / 2 + i * (r.len / n);
        if (inCrossRoad(t, r.vertical, r)) continue;     // would sit in a cross-street
        const sgn = (i % 2 === 0 ? 1 : -1);
        // per-road offset: clear the road's own stamped width, then 0.8 m of footway
        const side = sgn * (half + 0.8);
        const x = r.vertical ? r.x + side : r.x + t;
        const z = r.vertical ? r.z + t : r.z + side;
        if (Math.abs(x) > 9999) continue;
        // ...never INSIDE a place this road is only passing, nor any keep-out
        if (CBZ.roadPropClear && !CBZ.roadPropClear(x, z, r)) continue;
        if (inOtherTravelLane(x, z, r)) continue;
        if (nearDoor(x, z, 1.8)) continue;
        const fx = r.vertical ? -sgn : 0, fz = r.vertical ? 0 : -sgn;
        makeLampPost(x, z, fx, fz);
        // CENSUS, measured not asserted: where did the head actually land?
        lampCensus.lamps++;
        const hx = x + fx * LO.bulbZ, hz = z + fz * LO.bulbZ;
        if (r.vertical ? Math.abs(hx - r.x) < half : Math.abs(hz - r.z) < half) lampCensus.overRoad++;
      }
    }
    // Build: poles + davits + heads, the lens set and the ground light pools,
    // all chunked per 200 m cell (frustum-culled). lampPools.bulb / .glow are
    // chunk SETS addressed by GLOBAL index: a lamp's lens and pool are both
    // at its lampIdx (lamps first, in lampIdx order), then one faint coloured
    // wash per signal approach; hitProp's zero-scale routes to the right cell.
    lampPools.bulb = null; lampPools.glow = null;      // never a previous world's pools
    if (HW) {
      const M = HW.hardwareMaterial(false);
      const postGeo = HW.luminaire(LM, true, "city"), lumGeo = HW.luminaire(LM, false, "city");
      HWSET.lampPost = { set: HW.chunked("lamp-post", postGeo, M, lampPosts, { cast: true }).addTo(root), geo: postGeo, mat: M, items: lampPosts };
      const lumItems = mastLums.map(function (m) { return { x: m.x, y: m.y, z: m.z, ry: m.ang }; });
      HWSET.lum = { set: HW.chunked("mast-luminaire", lumGeo, M, lumItems, { cast: true }).addTo(root), geo: lumGeo, mat: M, items: lumItems };
      const lenses = HW.chunked("lamp-lens", HW.lampLens(), headLampM, lampBulbSpots.map(function (sp) {
        return { x: sp.x + Math.sin(sp.ang) * LO.bulbZ, y: sp.y0 + LO.bellyY - 0.004, z: sp.z + Math.cos(sp.ang) * LO.bulbZ, ry: sp.ang };
      }), { cast: false, receive: false, maxDist: 600 }).addTo(root);
      lampPools.bulb = lenses;
    }
    if (HW) {
      const items = [];
      for (const sp of lampBulbSpots) {
        const fx = Math.sin(sp.ang), fz = Math.cos(sp.ang);
        const cx = sp.x + fx * (LO.bulbZ + LAMP_POOL_SHIFT), cz = sp.z + fz * (LO.bulbZ + LAMP_POOL_SHIFT);
        const py = HW.seatY(city, cx, cz, sp.ang, LAMP_POOL_ALONG, LAMP_POOL_ACROSS);
        // nadir = the bulb, SHIFT behind the quad centre; H = bulb over the pool
        items.push({ x: cx, y: py, z: cz, ry: sp.ang,
          sx: LAMP_POOL_ALONG, sz: LAMP_POOL_ACROSS, color: LAMP_POOL_HEX, k: LAMP_POOL_K,
          nz: -LAMP_POOL_SHIFT, h: Math.max(3, sp.y0 + LO.bulbY - py) });
      }
      // the pool index of lamp k MUST be k (hitProp zero-scales pools by lampIdx)
      if (items.length !== lampBulbSpots.length) console.error("[props] light-pool index bookkeeping broke", items.length, lampBulbSpots.length);
      for (const s of sigPoolSrc) {
        s.idx = items.length; s.key = null;
        items.push({ x: s.x, y: HW.seatY(city, s.x, s.z, s.ry, s.sx, s.sz), z: s.z, ry: s.ry, sx: s.sx, sz: s.sz, color: 0x000000, k: 0 });
      }
      // TOWN LAMPS (towngen.js) light their own streets, and this walk skips
      // those roads (r.litByTown), so the town heads' road light comes from
      // here: the same pool at the village head's height (6.2 m vs 8.4 m,
      // footprint scaled by that 0.74). Appended after the signals: they are
      // not shootable, so no lampIdx bookkeeping.
      for (const t of city._townLampHeads || []) {
        const k = Math.max(0.5, Math.min(1, t.h / 8.4));
        const al = LAMP_POOL_ALONG * k, ac = LAMP_POOL_ACROSS * k, sh = LAMP_POOL_SHIFT * k;
        const cx = t.x + Math.sin(t.ang) * sh, cz = t.z + Math.cos(t.ang) * sh;
        const py = HW.seatY(city, cx, cz, t.ang, al, ac);
        items.push({ x: cx, y: py, z: cz, ry: t.ang, sx: al, sz: ac, color: LAMP_POOL_HEX, k: LAMP_POOL_K,
          nz: -sh, h: Math.max(3, t.y - py) });
      }
      const pools = HW.lightPools(items);
      if (pools) { pools.addTo(root); lampPools.glow = pools; }
    }

    // ---- BREAKABLE HARDWARE (props.js breakable() / smashProp / CBZ.debris) ----
    // The standing hardware is instanced and chunked, so nothing per pole is
    // drawn. Each pole registers an EMPTY group; on the break, b.onSmash zeroes
    // that pole's instances in their cells and fills the group with stand-in
    // meshes on the SAME shared prototype geometry at the same transforms
    // (built only then), which smashProp hands to CBZ.debris. The shaft is the
    // "snap" part (it breaks at the hit); arms, heads, the luminaire come off.
    // Colliders stay (BREAK.signal/lamp keepCol: the stump still stands).
    function standIn(b, key, i, role, kind) {
      const H = HWSET[key];
      if (!H || !H.set) return;
      H.set.setMatrixAt(i, _zeroM4);
      const it = H.items[i];
      const m = new THREE.Mesh(H.geo, H.mat);
      m.position.set(it.x - b.g.position.x, it.y - b.g.position.y, it.z - b.g.position.z);
      m.rotation.y = it.ry || 0;
      m.scale.set(it.sx || 1, it.sy || 1, it.sz || 1);
      m.updateMatrix();
      b.g.add(m);
      b.parts.push({ m, role: role, kind: kind || null });
    }
    const lensGeoB = HW ? HW.lampLens() : null;
    function lensStandIn(b, rec, ang, y0) {
      if (!lensGeoB || !rec) return;
      const m = new THREE.Mesh(lensGeoB, headLampM);
      m.position.set(rec.x - b.g.position.x, y0 + LO.bellyY - 0.004 - b.g.position.y, rec.z - b.g.position.z);
      m.rotation.y = ang;
      b.g.add(m);
      b.parts.push({ m, role: "main", kind: "glass" });
    }
    if (HW && THREE.Group) {
      for (const c of allPoles) {
        const g = new THREE.Group();
        g.position.set(c.x, c.y, c.z);
        g.userData.streetHardware = "signal-pole";
        const b = breakable(g, "signal", c.x, c.z, { cols: [c.col],
          cand: { kind: "signal", heads: c.heads, cands: c.cands, peds: c.peds } });
        b.onSmash = function (bb) {
          for (const o of c.own) standIn(bb, o.part, o.i, (o.part === "mast" || o.part === "ped") ? "snap" : "main");
          for (const lum of c.lums) {
            standIn(bb, "lum", lum.i, "main");
            if (lum.rec) { lensStandIn(bb, lum.rec, lum.ang, lum.y); killLamp(lum.rec); lum.rec.smashed = true; }
          }
        };
      }
      for (const L of lampBrk) {
        const g = new THREE.Group();
        g.position.set(L.x, L.y, L.z);
        g.userData.streetHardware = "lamp-post";
        const b = breakable(g, "lamp", L.x, L.z, { cols: [L.col], rec: L.rec });
        b.onSmash = function (bb) {
          standIn(bb, "lampPost", L.i, "snap");
          lensStandIn(bb, L.rec, L.ang, L.y);
        };
      }
    }


    // =====================================================================
    //  SHOP-FRONT + BUS-STOP PIECES (placed by the KERB FURNITURE pass below).
    //  These are the few-per-city pieces with their own verbs and ads, so
    //  they stay scene-graph groups; their geometry comes from the kerb kit
    //  (vertex-coloured, shared) so a patio is a real bistro set and a rack
    //  is three real staples. y = the footway height they stand on.
    // =====================================================================
    const VCM = HW ? HW.hardwareMaterial(false) : smat(0x8a9099);
    function kitMesh(g, kind, x, y, z, ry) {
      const K = kerbKit()[kind];
      const out = [];
      for (const p of K.parts) {
        const m = new THREE.Mesh(p.geo, VCM);
        m.position.set(x || 0, y || 0, z || 0); m.rotation.y = ry || 0;
        m.castShadow = true; m.receiveShadow = true;
        g.add(m); out.push(m);
      }
      return out;
    }

    // ----- A-FRAME SIDEWALK BOARD: two framed ad panels, hinged at the top ---
    const aFrameWoodM = smat(0x3b2f24);
    function aFrameSign(x, z, yaw, ad, y) {
      const g = new THREE.Group(); g.position.set(x, y || 0, z); g.rotation.y = yaw;
      const panelG = geo("aframePanel2", () => new THREE.PlaneGeometry(0.56, 0.78));
      const railG = geo("aframeRail", () => new THREE.BoxGeometry(0.035, 0.98, 0.03));
      const barG = geo("aframeBar", () => new THREE.BoxGeometry(0.62, 0.035, 0.03));
      for (const s of [1, -1]) {
        const lean = -0.2 * s;
        const leaf = new THREE.Group(); leaf.position.set(0, 0.93, 0); leaf.rotation.x = lean; g.add(leaf);
        for (const lx of [-0.3, 0.3]) { const r = new THREE.Mesh(railG, aFrameWoodM); r.position.set(lx, -0.47, s * 0.0); leaf.add(r); }
        for (const ly of [-0.05, -0.9]) { const bb = new THREE.Mesh(barG, aFrameWoodM); bb.position.set(0, ly, 0); leaf.add(bb); }
        const face = new THREE.Mesh(panelG, adMatFor(ad));
        face.position.set(0, -0.47, s * 0.018); face.rotation.y = s > 0 ? 0 : Math.PI; leaf.add(face);
      }
      root.add(g);
      city.streetProps.push({ x, z, type: "sign" });  // light, no collider
      breakable(g, "aframe", x, z, {});
      return g;
    }
    // Per-shop board: the panel carries the shop's own promo (cached ad pipeline)
    const SHOP_BOARD_AD = {
      food:     ["TODAY'S SPECIAL", "2-for-1 wings til 6", 0x7a3a0d, 0xffce7a, { tag: "EAT" }],
      bar:      ["HAPPY HOUR", "half off, all night", 0x2a0d1a, 0xe85d8a, { tag: "OPEN" }],
      gym:      ["FREE TRIAL WEEK", "lift heavy, hit harder", 0x0d2a26, 0x66d9c0, { tag: "GYM" }],
      hardware: ["TOOL SALE", "everything must go", 0x3a2a08, 0xffd166, { tag: "SALE" }],
      barber:   ["WALK-INS WELCOME", "lineup of your life", 0x0d1f2a, 0x6bb6ff, { tag: "STYLE" }],
      clothing: ["NEW DROP", "look like money", 0x2a113a, 0xc792ea, { tag: "FITS" }],
      jewelry:  ["BLOWOUT", "drip = respect", 0x2a2205, 0xffe08a, { tag: "DRIP" }],
      electronics: ["TRADE-IN", "phones smarter than you", 0x062a2a, 0x39d0c0, { tag: "TECH" }],
      guns:     ["RANGE OPEN", "rights. ammo. respect.", 0x1c2414, 0xff5a2c, { tag: "GUNS" }],
      pawn:     ["WE BUY GOLD", "we buy hot junk", 0x2a1c0d, 0xc89a5a, { tag: "CASH" }],
    };
    function shopBoard(x, z, yaw, kind, y) {
      const ad = SHOP_BOARD_AD[kind];
      if (!ad) return false;
      aFrameSign(x, z, yaw, ad, y);
      return true;
    }

    // ----- PATIO SET: bistro table, two chairs, a parasol --------------------
    const UMBRELLA = [0xb8423c, 0x3f7a4a, 0x2d5f8f, 0xc28f2c].map(function (c) {
      const m = new THREE.MeshLambertMaterial({ color: c, side: THREE.DoubleSide }); m._shared = true; return m;
    });
    function patioSet(x, z, yaw, y) {
      y = y || 0;
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw;
      const table = kitMesh(g, "bistroTable", 0, 0, 0, 0);
      const chairs = [];
      for (const a of [0.6, 3.74]) {
        const cx = Math.cos(a) * 0.72, cz = Math.sin(a) * 0.72;
        // the chair's back is at its local -z; face the table: its +z points
        // from the chair toward the table centre
        const face = Math.atan2(-cx, -cz);
        chairs.push.apply(chairs, kitMesh(g, "bistroChair", cx, 0, cz, face));
        if (CBZ.propRegisterSeat) {
          const cy = Math.cos(yaw), sy = Math.sin(yaw);
          CBZ.propRegisterSeat(x + cx * cy + cz * sy, y, z - cx * sy + cz * cy, yaw + face, "patio", null, { cushion: 0.465, floorBelow: 0 });
        }
      }
      // parasol: pole through the table, eight-panel canopy (seen from below
      // too, so double-sided), a finial
      const pole = new THREE.Mesh(geo("umbPole2", () => new THREE.CylinderGeometry(0.02, 0.02, 2.3, 6)), smat(0xb9bdc0));
      pole.position.y = 1.15; g.add(pole);
      const canopy = new THREE.Mesh(geo("umbTop2", () => new THREE.ConeGeometry(1.15, 0.38, 8, 1, true)),
        UMBRELLA[((CBZ.hash01 ? CBZ.hash01(x, z, 0x77) : 0.5) * UMBRELLA.length) | 0]);
      canopy.position.y = 2.12; canopy.castShadow = true; g.add(canopy);
      const fin = new THREE.Mesh(geo("umbFinial", () => new THREE.SphereGeometry(0.035, 6, 4)), smat(0xb9bdc0));
      fin.position.y = 2.33; g.add(fin);
      root.add(g);
      city.streetProps.push({ x, z, type: "patio" });   // soft furniture, no collider
      breakable(g, "patio", x, z, { kinds: [[canopy, "plastic"], [pole, "metal"]] });
      return g;
    }

    // ----- BIKE RACK: three inverted-U staples at the kerb -------------------
    function bikeRack(x, z, yaw, y) {
      const g = new THREE.Group(); g.position.set(x, y || 0, z); g.rotation.y = yaw;
      kitMesh(g, "bikerack", 0, 0, 0, 0);
      root.add(g);
      const brc = solidCollider(x, z, 0.35, null);
      city.streetProps.push({ x, z, type: "bikerack" });
      breakable(g, "bikerack", x, z, { cols: [brc] });
      return g;
    }

    // ----- PROPANE EXCHANGE CAGE (hardware store) -----------------------------
    function propaneCage(x, z, yaw, y) {
      const g = new THREE.Group(); g.position.set(x, y || 0, z); g.rotation.y = yaw;
      kitMesh(g, "propane", 0, 0, 0, 0);
      root.add(g);
      // WIRED: the collider points at the GROUP so core/batch.js keeps the
      // cage live and the cook-off can hide the whole thing in one go.
      const pc = solidCollider(x, z, 0.55, CBZ.CONFIG.PROPS_WIRED_V1 ? g : null);
      city.streetProps.push({ x, z, type: "propane" });
      if (CBZ.CONFIG.PROPS_WIRED_V1) {
        const prec = { type: "propane", x, z, y: (y || 0) + 0.5, r: 0.7, group: g, hp: 3 };
        shootables.push(prec);
        breakable(g, "propane", x, z, { cols: [pc], rec: prec });
      }
      return g;
    }

    // ----- BUS SHELTER: brushed-aluminium frame, tinted roof with fascia,
    // glass back and one glass end, an ad lightbox on the other end, a real
    // bench inside, the stop's flag sign on a pole at the kerb end ---------
    const shelterAluM = smat(0x8e959b), shelterRoofM = smat(0x3a4046);
    const glassM = new THREE.MeshLambertMaterial({ color: 0xa9c7d6, transparent: true, opacity: 0.22, depthWrite: false });
    glassM._shared = true;
    function busShelter(x, z, yaw, y) {
      y = y || 0;
      const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw;
      const postG = geo("shelterPost2", () => new THREE.BoxGeometry(0.08, 2.3, 0.08));
      for (const px of [-1.75, 1.75]) for (const pz of [-0.62, 0.55]) { const p = new THREE.Mesh(postG, shelterAluM); p.position.set(px, 1.15, pz); g.add(p); }
      const roof = new THREE.Mesh(geo("shelterRoof2", () => new THREE.BoxGeometry(3.9, 0.05, 1.6)), shelterRoofM);
      roof.position.set(0, 2.36, -0.03); roof.castShadow = true; g.add(roof);
      const fasciaG = geo("shelterFascia", () => new THREE.BoxGeometry(3.94, 0.16, 0.05));
      for (const fz of [-0.84, 0.78]) { const f = new THREE.Mesh(fasciaG, shelterAluM); f.position.set(0, 2.32, fz); g.add(f); }
      const railG = geo("shelterRail", () => new THREE.BoxGeometry(3.5, 0.05, 0.05));
      for (const ry of [0.18, 2.2]) { const r = new THREE.Mesh(railG, shelterAluM); r.position.set(0, ry, -0.62); g.add(r); }
      const back = new THREE.Mesh(geo("shelterGlass2", () => new THREE.PlaneGeometry(3.42, 1.98)), glassM);
      back.position.set(0, 1.19, -0.62); g.add(back);
      const endGlass = new THREE.Mesh(geo("shelterEndGlass", () => new THREE.PlaneGeometry(1.1, 1.98)), glassM);
      endGlass.position.set(-1.75, 1.19, -0.04); endGlass.rotation.y = Math.PI / 2; g.add(endGlass);
      // the bench (kerb kit), against the back glass, facing the road (+z)
      const benchMs = kitMesh(g, "bench", 0, 0, -0.33, 0);
      if (CBZ.propRegisterSeat) {
        const cy = Math.cos(yaw), sy = Math.sin(yaw);
        for (const lx of [-0.6, 0, 0.6]) {
          CBZ.propRegisterSeat(x + lx * cy + (-0.31) * sy, y, z - lx * sy + (-0.31) * cy, yaw, "bench", null, { cushion: 0.46, floorBelow: 0 });
        }
      }
      // ad lightbox on the +x end: aluminium case, a poster on each face
      const box = new THREE.Mesh(geo("shelterAdBox", () => new THREE.BoxGeometry(0.12, 1.85, 1.2)), shelterAluM);
      box.position.set(1.8, 1.2, -0.04); g.add(box);
      const pick = pickAd(x, z, { allowWanted: false });
      const adM = adMatFor(pick.ad);
      const adG = geo("shelterAd2", () => new THREE.PlaneGeometry(1.06, 1.7));
      const ad = new THREE.Mesh(adG, adM); ad.position.set(1.738, 1.2, -0.04); ad.rotation.y = -Math.PI / 2; g.add(ad);
      const ad2 = new THREE.Mesh(adG, adM); ad2.position.set(1.862, 1.2, -0.04); ad2.rotation.y = Math.PI / 2; g.add(ad2);
      nightAds.push(adM);
      regDynAd(ad, pick, x + Math.cos(yaw) * 1.74, y + 1.2, z - Math.sin(yaw) * 1.74);
      adBoards.push({ mesh: ad, mesh2: ad2, x: x + Math.cos(yaw) * 1.8, z: z - Math.sin(yaw) * 1.8, y: 0, kind: "shelter", mat0: adM, mat0b: adM });
      // the stop pole at the -x kerb corner with the flag sign
      const tx = Math.cos(yaw), tz = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
      const px = x - tx * 2.25 + fx * 0.45, pz = z - tz * 2.25 + fz * 0.45;
      root.add(g);
      solidCollider(x - tx * 1.75, z - tz * 1.75, 0.35, null);
      solidCollider(x + tx * 1.75, z + tz * 1.75, 0.35, null);
      city.streetProps.push({ x, z, type: "busstop" });
      breakable(g, "shelter", x, z, { kinds: [[back, "glass"], [endGlass, "glass"], [ad, "plastic"], [ad2, "plastic"]]
        .concat(benchMs.map(function (m) { return [m, "wood"]; })) });
      return { poleX: px, poleZ: pz };
    }

    // ----- BILLBOARD: tall steel legs + a big lit ad board -----------------
    const billLegM = smat(0x4a4f57), billFrameM = smat(0x2a2d33);
    function billboard(x, z, yaw, big) {
      const W = big ? 8.5 : 6.0, H = big ? 4.2 : 3.0, post = big ? 8.0 : 6.5;
      const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = yaw;
      const legG = geo("billLeg" + (big ? "B" : "S"), () => new THREE.CylinderGeometry(0.22, 0.28, post, 7));
      for (const lx of [-W * 0.3, W * 0.3]) { const l = new THREE.Mesh(legG, billLegM); l.position.set(lx, post / 2, 0); l.castShadow = true; g.add(l); }
      // cross brace
      const brace = new THREE.Mesh(geo("billBrace" + (big ? "B" : "S"), () => new THREE.BoxGeometry(W * 0.7, 0.16, 0.16)), billLegM);
      brace.position.set(0, post * 0.55, 0); g.add(brace);
      const frame = new THREE.Mesh(geo("billFrame" + (big ? "B" : "S"), () => new THREE.BoxGeometry(W + 0.4, H + 0.4, 0.3)), billFrameM);
      frame.position.set(0, post + H / 2, 0); g.add(frame);
      // each face gets its OWN ad record. Big roadside boards may show a live
      // WANTED poster (your face goes up with your heat); both faces glow at night.
      const pickF = pickAd(x, z, { allowWanted: big });
      const pickB = pickAd(x, z, { allowWanted: false });
      const boardG = geo("billBoard" + (big ? "B" : "S"), () => new THREE.PlaneGeometry(W, H));
      const front = new THREE.Mesh(boardG, adMatFor(pickF.ad)); front.position.set(0, post + H / 2, 0.18); g.add(front);
      const back = new THREE.Mesh(boardG, adMatFor(pickB.ad)); back.position.set(0, post + H / 2, -0.18); back.rotation.y = Math.PI; g.add(back);
      nightAds.push(adMatFor(pickF.ad), adMatFor(pickB.ad));
      // register either face if it's live (WANTED poster or E3 market ticker)
      // so the driver can re-skin its material as those values change.
      regDynAd(front, pickF, x, post + H / 2, z);
      regDynAd(back, pickB, x, post + H / 2, z);
      // rentable: a lease takes BOTH faces (the flex reads from either direction)
      adBoards.push({ mesh: front, mesh2: back, x, z, y: 0, kind: big ? "bill" : "small", mat0: adMatFor(pickF.ad), mat0b: adMatFor(pickB.ad) });
      // walkway light bar under the board
      const bar = new THREE.Mesh(geo("billBar" + (big ? "B" : "S"), () => new THREE.BoxGeometry(W, 0.1, 0.4)), smat(0xfff4d0, { emissive: 0xfff4d0, ei: 0 }));
      bar.position.set(0, post - 0.1, 0.4); g.add(bar);
      nightLamps.push(bar);
      root.add(g);
      // two leg colliders so a car can smash into the billboard base
      solidCollider(x - Math.cos(yaw) * W * 0.3, z + Math.sin(yaw) * W * 0.3, 0.35, g, false);
      solidCollider(x + Math.cos(yaw) * W * 0.3, z - Math.sin(yaw) * W * 0.3, 0.35, g, false);
      city.streetProps.push({ x, z, type: "billboard" });
    }

    // ----- BILLBOARD ROAD-CLEARANCE TEST (BUG FIX) -------------------------
    // A billboard's footprint is a thin slab: its WIDTH (W, plus a little frame)
    // runs along the board TANGENT; it's nearly flat in the facing direction
    // (frame depth + the two leg colliders, r=0.35). The old placers only tested
    // the board CENTRE against ONE road, so a board whose centre cleared the kerb
    // could still throw its width — 4+ metres of it — out across a PERPENDICULAR
    // cross-street, or sit a perimeter board's legs straight in the edge street.
    // This tests the board's whole AABB footprint against EVERY road carriageway
    // (centre-line ± ROAD/2) with a margin, so no part overhangs any kerb.
    function billboardFootprint(yaw, big) {
      const W = big ? 8.5 : 6.0;
      const halfT = W / 2 + 0.2;                 // tangent half-span (frame = W+0.4)
      const halfN = 0.35 + 0.35;                 // facing depth (frame) + leg collider r
      const ca = Math.abs(Math.cos(yaw)), sa = Math.abs(Math.sin(yaw));
      // world AABB half-extents (tangent runs on local +x → world (cos,-sin);
      // normal on local +z → world (sin,cos))
      return { extX: halfT * ca + halfN * sa, extZ: halfT * sa + halfN * ca };
    }
    // true if every part of the board's footprint clears every road by `marg`.
    function billboardClearsRoads(x, z, yaw, big, marg) {
      const fp = billboardFootprint(yaw, big);
      const half = city.ROAD / 2;
      const m = marg == null ? 1.0 : marg;
      for (const r of city.roads) {
        if (r.vertical) {
          // carriageway is x ∈ road.x ± half, spanning z over road.len about road.z
          if (Math.abs(z - r.z) - fp.extZ > r.len / 2) continue;   // footprint off the road's length
          if (Math.abs(x - r.x) - fp.extX < half + m) return false;
        } else {
          if (Math.abs(x - r.x) - fp.extX > r.len / 2) continue;
          if (Math.abs(z - r.z) - fp.extZ < half + m) return false;
        }
      }
      return true;
    }

    // =====================================================================
    //  KERB FURNITURE — sparse, purposeful, standing on the real footway.
    // =====================================================================
    //  The old layer rolled nine props per LOT EDGE off city.rng and scattered
    //  them wherever the edge happened to be (a lot edge is not a kerb: half
    //  of them faced the back of the next block), which is why it read as
    //  junk and was switched off, leaving the pavements bare. This pass walks
    //  the KERBS the street kit actually drew (city.street.solve: the block
    //  grid, its corner radii and its 2 m footway) and puts each thing where
    //  a city puts it:
    //    - a fire hydrant roughly every 60-80 m of kerb, near mid-block;
    //    - a litter bin at a corner (busier districts: most corners) and
    //      beside shop doors;
    //    - news boxes at the far corner of busy blocks, in ones and twos;
    //    - a collection mailbox on some faces;
    //    - single-space meters at stall spacing on commercial kerbs only;
    //    - street trees in iron grates, between the lamps;
    //    - bus stops on the avenues (a shelter where the pad behind it leaves
    //      a walkway, otherwise a stop pole and a bench).
    //  Every spot must be FULL-HEIGHT footway (not a ramp, a driveway apron,
    //  a lot pad or the road), clear of door approaches, lamps, signal poles
    //  and each other. Variation is CBZ.hash01 of the position, so this pass
    //  draws NOTHING from city.rng and the rest of the world is unchanged.
    //  Everything a kind draws is ONE InstancedMesh per 200 m cell (the kerb
    //  kit above); props only become live meshes once something hits them.
    const KERB_STATS = city._kerbFurniture = { hydrant: 0, bin: 0, newsbox: 0, meter: 0, mailbox: 0, tree: 0,
      bench: 0, shelter: 0, busStop: 0, patio: 0, bikerack: 0, propane: 0, aframe: 0, drawSets: 0 };
    const KERB_SETS = {};                    // kind -> chunk set (for materialise)
    // a failure here must never cost the camps/billboards/drivers below it
    try {
    (function kerbFurniture() {
      const st = city.street, G = st && st.solve;
      if (!G || !HW || !THREE.InstancedMesh || typeof st.regionAt !== "function" || typeof st.heightAt !== "function") return;
      let KIT = null;
      try { KIT = kerbKit(); } catch (e) { console.warn("[kerb kit]", e); return; }
      const VC = HW.hardwareMaterial(false);
      const X = G.X, Z = G.Z, N = G.N, h = G.h, S = G.S;
      const YW = st.profile ? st.profile.yWalk : 0.18;
      function hsh(x, z, salt) { return CBZ.hash01 ? CBZ.hash01(x, z, salt) : 0.5; }
      function dkind(x, z) { const d = city.districtAt ? city.districtAt(x, z) : null; return (d && d.kind) || "residential"; }

      // ---- occupancy: what already stands on the kerb + what we add ------
      const OCC = [];
      for (const p of city.streetProps) OCC.push({ x: p.x, z: p.z, r: 0.45 });
      for (const c of allPoles) OCC.push({ x: c.x, z: c.z, r: 0.5 });
      function clearAt(x, z, r) {
        for (let i = 0; i < OCC.length; i++) {
          const o = OCC[i], d = r + o.r;
          const dx = o.x - x, dz = o.z - z;
          if (dx > d || dx < -d || dz > d || dz < -d) continue;
          if (dx * dx + dz * dz < d * d) return false;
        }
        return true;
      }
      function claim(x, z, r) { OCC.push({ x: x, z: z, r: r }); }
      // full-height footway, not a ramp / driveway / pad / road, no door approach
      function onWalk(x, z) {
        if (st.regionAt(x, z) !== 1) return false;
        const y = st.heightAt(x, z);
        return Number.isFinite(y) && y >= YW - 0.012;
      }
      function spotOK(x, z, r, doorR) {
        if (!onWalk(x, z)) return false;
        if (nearDoor(x, z, doorR == null ? 2.2 : doorR)) return false;
        if (CBZ.roadPropClear && !CBZ.roadPropClear(x, z, null)) return false;
        return clearAt(x, z, r);
      }

      // ---- instanced kinds + the materialise-on-contact record ------------
      const ITEMS = {};
      function inst(kind, x, y, z, ry) {
        const a = ITEMS[kind] || (ITEMS[kind] = []);
        a.push({ x: x, y: y, z: z, ry: ry });
        return { kind: kind, i: a.length - 1, done: false };
      }
      function materialize(rec) {
        const I = rec.inst;
        if (!I || I.done) return;
        I.done = true;
        const Kd = KIT[I.kind];
        if (!Kd) return;
        const g = rec.group;
        for (const p of Kd.parts) {
          const m = new THREE.Mesh(p.geo, VC);
          m.castShadow = true; m.receiveShadow = true;
          g.add(m);
          if (rec.brk) rec.brk.parts.push({ m: m, role: p.role === "keep" ? "keep" : p.role, kind: p.kind });
        }
        g.userData.dynamic = true;
        if (!g.parent) root.add(g);
        g.updateMatrixWorld(true);
        const set = KERB_SETS[I.kind];
        if (set) set.setMatrixAt(I.i, _zeroM4);
      }
      // `over` is the flag every knock path (bullet, bumper, runner, blast,
      // tsunami) flips first; flipping it is what brings the live copy in.
      function liveRec(type, kind, x, y, z, ry, hy, r) {
        const g = new THREE.Group();
        g.position.set(x, y, z); g.rotation.y = ry;
        const rec = { type: type, x: x, z: z, y: y + hy, r: r, group: g, inst: inst(kind, x, y, z, ry), _ov: false, _mz: materialize };
        Object.defineProperty(rec, "over", {
          enumerable: true, configurable: true,
          get: function () { return this._ov; },
          set: function (v) { if (v) materialize(this); this._ov = !!v; },
        });
        return rec;
      }
      // local +z toward the walk: forward (sin ry, cos ry) = (bx, bz)
      function yawTo(bx, bz) { return Math.atan2(bx, bz); }

      function hydrant(x, z, bx, bz) {
        const y = st.heightAt(x, z), ry = yawTo(bx, bz);
        const rec = liveRec("hydrant", "hydrant", x, y, z, ry, 0.5, 0.5);
        rec.gy = null;
        const c = solidCollider(x, z, 0.2, rec.group);
        shootables.push(rec);
        breakable(rec.group, "hydrant", x, z, { cols: [c], rec: rec });
        city.streetProps.push({ x: x, z: z, type: "hydrant" });
        claim(x, z, 0.45); KERB_STATS.hydrant++;
      }
      function mailbox(x, z, bx, bz) {
        const y = st.heightAt(x, z), ry = yawTo(bx, bz);
        const rec = liveRec("mailbox", "mailbox", x, y, z, ry, 0.95, 0.5);
        const c = solidCollider(x, z, 0.3, rec.group);
        shootables.push(rec);
        breakable(rec.group, "mailbox", x, z, { cols: [c], rec: rec });
        city.streetProps.push({ x: x, z: z, type: "mailbox" });
        claim(x, z, 0.5); KERB_STATS.mailbox++;
      }
      function bin(x, z, bx, bz) {
        const y = st.heightAt(x, z), ry = yawTo(bx, bz) + hsh(x, z, 0x51a) * 1.2;
        const rec = liveRec("bin", "bin", x, y, z, ry, 0.5, 0.48);
        const c = solidCollider(x, z, 0.27, rec.group);
        shootables.push(rec); carKnockables.push(rec);
        breakable(rec.group, "bin", x, z, { cols: [c], rec: rec });
        city.streetProps.push({ x: x, z: z, type: "bin" });
        claim(x, z, 0.45); KERB_STATS.bin++;
      }
      function newsbox(x, z, bx, bz, vi) {
        const y = st.heightAt(x, z), ry = yawTo(bx, bz);
        const rec = liveRec("newsbox", "newsbox" + vi, x, y, z, ry, 0.6, 0.45);
        const c = solidCollider(x, z, 0.25, rec.group);
        shootables.push(rec); carKnockables.push(rec);
        breakable(rec.group, "newsbox", x, z, { cols: [c], rec: rec });
        city.streetProps.push({ x: x, z: z, type: "newsbox" });
        claim(x, z, 0.32); KERB_STATS.newsbox++;
      }
      function meter(x, z, bx, bz) {
        const y = st.heightAt(x, z), ry = yawTo(bx, bz);
        const rec = liveRec("meter", "meter", x, y, z, ry, 1.25, 0.28);
        const c = solidCollider(x, z, 0.1, rec.group);
        shootables.push(rec); carKnockables.push(rec);
        breakable(rec.group, "meter", x, z, { cols: [c], rec: rec });
        city.streetProps.push({ x: x, z: z, type: "meter" });
        claim(x, z, 0.3); KERB_STATS.meter++;
      }
      // a bench: instanced, solid along its length, three seats facing `ry`
      function bench(x, z, fx, fz) {
        const y = st.heightAt(x, z), ry = yawTo(fx, fz);
        inst("bench", x, y, z, ry);
        const along = Math.abs(fx) > 0.5 ? "z" : "x";
        if (CBZ.colliders) CBZ.colliders.push(along === "x"
          ? { minX: x - 0.9, maxX: x + 0.9, minZ: z - 0.25, maxZ: z + 0.25, ref: null, noCam: true, noBreach: true, y0: y, y1: y + 0.46 }
          : { minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.9, maxZ: z + 0.9, ref: null, noCam: true, noBreach: true, y0: y, y1: y + 0.46 });
        if (CBZ.propRegisterSeat) {
          const tx = -fz, tz = fx;       // along the bench
          for (const l of [-0.6, 0, 0.6]) CBZ.propRegisterSeat(x + tx * l + fx * 0.02, y, z + tz * l + fz * 0.02, ry, "bench", null, { cushion: 0.46, floorBelow: 0 });
        }
        city.streetProps.push({ x: x, z: z, type: "bench" });
        claim(x, z, 1.0); KERB_STATS.bench++;
      }

      // ---- street trees: grate (kerb kit) + the vegetation kit's bole and
      // crown, all instanced; on a break the pieces materialise as meshes.
      const VKIT = CBZ.vegetationKit;
      const GRAM = !!(CBZ.treeCrownGeo && CBZ.treeTrunkGeo);
      const trunkM = VKIT ? VKIT.material("wood", 0x8c6a48) : smat(0x6e4a2c);
      const crownMs = VKIT ? [VKIT.material("foliage", 0x5f9a4c), VKIT.material("foliage", 0x76a856)] : [smat(0x3f7d3a), smat(0x4f9942)];
      const trunkGeo = GRAM ? geo("streetTreeTrunk", () => CBZ.treeTrunkGeo({ rTop: 0.09, rBase: 0.15, h: 2.9, seg: 7,
        roots: 4, rise: 0.18, dip: 0.04, spread: 1.6, flare: 1.4, uvRepeat: 3, site: "street" })) : null;
      const crownGeo = GRAM ? geo("streetTreeCrown", () => CBZ.treeCrownGeo({ tiers: 2, r: 1.25, h: 2.7, seg: 7, taper: 0.66,
        site: "street", leaf: !!VKIT, cards: 12 })) : null;
      const CROWN_Y = 2.3;
      const trunkItems = [], crownItems = [[], []];
      function tree(x, z) {
        if (!GRAM) return;
        const y = st.heightAt(x, z), ry = hsh(x, z, 0x7e1) * 6.283;
        const ci = hsh(x, z, 0x7e2) < 0.5 ? 0 : 1;
        const sc = 0.9 + hsh(x, z, 0x7e3) * 0.25;
        inst("grate", x, y, z, 0);
        const ti = trunkItems.length; trunkItems.push({ x: x, y: y, z: z, ry: ry, sx: sc, sy: sc, sz: sc });
        const cj = crownItems[ci].length; crownItems[ci].push({ x: x, y: y + CROWN_Y * sc, z: z, ry: ry, sx: sc, sy: sc, sz: sc });
        const col = solidCollider(x, z, 0.2, null);
        const g = new THREE.Group(); g.position.set(x, y, z);
        const b = breakable(g, "tree", x, z, { cols: [col] });
        b.onSmash = function (bb) {
          const TS = KERB_SETS._trunk, CS = KERB_SETS["_crown" + ci];
          if (TS) TS.setMatrixAt(ti, _zeroM4);
          if (CS) CS.setMatrixAt(cj, _zeroM4);
          const t = new THREE.Mesh(trunkGeo, trunkM); t.rotation.y = ry; t.scale.setScalar(sc); t.updateMatrix(); bb.g.add(t);
          bb.parts.push({ m: t, role: "snap", kind: "wood" });
          const c = new THREE.Mesh(crownGeo, crownMs[ci]); c.position.y = CROWN_Y * sc; c.rotation.y = ry; c.scale.setScalar(sc); c.updateMatrix(); bb.g.add(c);
          bb.parts.push({ m: c, role: "main", kind: "foliage" });
        };
        city.streetProps.push({ x: x, z: z, type: "tree" });
        claim(x, z, 0.75); KERB_STATS.tree++;
      }

      // ---- the atlas BUS STOP plate (street_furniture.js's sign atlas) ------
      const DKs = CBZ.detailKit;
      let busPlateM = null, busPlateUV = null;
      if (DKs && DKs.signAtlas && DKs.signFaceUV && DKs.signAtlasCells && DKs.signAtlasCells.BUS != null) {
        try {
          busPlateM = geo("__busPlateMat", () => { const m = new THREE.MeshLambertMaterial({ map: DKs.signAtlas() }); m._shared = true; return m; });
          busPlateUV = DKs.signFaceUV(DKs.signAtlasCells.BUS);
        } catch (e) { busPlateM = null; }
      }
      function busPlateGeo() {
        return geo("busPlate", () => {
          const g = new THREE.PlaneGeometry(0.46, 0.69);
          const uv = g.attributes.uv, U = busPlateUV;
          for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) < 0.5 ? U.u0 : U.u1, uv.getY(i) < 0.5 ? U.v0 : U.v1);
          return g;
        });
      }
      function busPole(x, z, fx, fz) {
        const y = st.heightAt(x, z), ry = yawTo(-fx, -fz);   // timetable case faces the walk
        inst("busPole", x, y, z, ry);
        if (busPlateM) {
          // a FLAG sign: the plate sticks out from the pole toward the road
          // and faces up and down the street, so arriving traffic (and the
          // people waiting) read it; both faces carry the legend
          const tx = -fz, tz = fx;
          for (const s of [1, -1]) {
            const m = new THREE.Mesh(busPlateGeo(), busPlateM);
            m.rotation.y = Math.atan2(tx * s, tz * s);
            m.position.set(x + fx * 0.27 + tx * s * 0.004, y + 2.45, z + fz * 0.27 + tz * s * 0.004);
            root.add(m);
          }
        }
        solidCollider(x, z, 0.08, null);
        city.streetProps.push({ x: x, z: z, type: "busstop" });
        claim(x, z, 0.4); KERB_STATS.busStop++;
      }

      // ---- where a pad behind the kerb leaves room (shelters, patios) -------
      function insideBuilding(x, z) { const gp = CBZ.alleyGapAt ? CBZ.alleyGapAt(x, z) : null; return !!(gp && gp.inside); }

      // ---- THE WALK: every straight kerb face of the grid ---------------------
      const shopDoors = [];
      for (const lot of doorLots()) {
        const b = lot.building, d = b && b.door;
        if (!d || !b.shop || !Number.isFinite(d.x)) continue;
        shopDoors.push({ lot: lot, x: d.x, z: d.z, ex: -d.nx, ez: -d.nz, kind: b.shop.kind });
      }
      const faces = [];
      for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) for (const s of [-1, 1]) {
        if (s < 0 ? i === 0 : i === N) continue;
        faces.push({ vertical: true, line: i, c: X[i], a: Z[j] + S + 0.9, b: Z[j + 1] - S - 0.9, s: s, ave: !!(G.isAve && G.isAve(i)) });
      }
      for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) for (const s of [-1, 1]) {
        if (s < 0 ? j === 0 : j === N) continue;
        faces.push({ vertical: false, line: j, c: Z[j], a: X[i] + S + 0.9, b: X[i + 1] - S - 0.9, s: s, ave: false });
      }
      for (const F of faces) {
        const L = F.b - F.a;
        if (L < 6) continue;
        // world point at distance u along the face, `off` metres from the kerb face
        const P = function (u, off) {
          const lat = F.c + F.s * (h + off), al = F.a + u;
          return F.vertical ? { x: lat, z: al } : { x: al, z: lat };
        };
        const bx = F.vertical ? F.s : 0, bz = F.vertical ? 0 : F.s;      // toward the buildings
        const mid = P(L / 2, 1), dk = dkind(mid.x, mid.z);
        const busy = dk === "core" || dk === "commercial";
        const H1 = function (salt) { return hsh(mid.x, mid.z, salt); };
        // try a spot at u, sliding up to `slide` metres either way
        const tryAt = function (u, off, r, slide, doorR) {
          for (let k = 0; k <= (slide || 0) * 2; k++) {
            const du = (k & 1 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
            const uu = u + du;
            if (uu < 0 || uu > L) continue;
            const p = P(uu, off);
            if (spotOK(p.x, p.z, r, doorR)) return p;
          }
          return null;
        };
        let hasStop = false;
        // 1) BUS STOPS on the avenues (and the odd busy street)
        if ((F.ave && H1(0x61) < 0.45) || (!F.ave && busy && H1(0x62) < 0.1)) {
          // a shelter needs the lot pad behind the footway to carry the walk
          const p = tryAt(L * 0.5, 0.95, 1.6, 4, 3.4);
          if (p) {
            const back = { x: p.x + bx * 2.6, z: p.z + bz * 2.6 };
            const padFree = !insideBuilding(back.x, back.z) && !insideBuilding(back.x + bx * 0.8, back.z + bz * 0.8)
              && !nearDoor(p.x, p.z, 4.0);
            if (padFree) {
              // shelter front (+z) toward the road
              const sh = busShelter(p.x, p.z, yawTo(-bx, -bz), st.heightAt(p.x, p.z));
              if (sh && spotOK(sh.poleX, sh.poleZ, 0.2, 2.2)) busPole(sh.poleX, sh.poleZ, -bx, -bz);
              claim(p.x, p.z, 2.1); KERB_STATS.shelter++;
              hasStop = true;
            } else {
              const pp = tryAt(L * 0.5, 0.62, 0.95, 3, 2.8);
              if (pp) {
                bench(pp.x, pp.z, -bx, -bz);
                const tx = F.vertical ? 0 : 1, tz = F.vertical ? 1 : 0;
                const sx = pp.x + tx * 1.5, sz = pp.z + tz * 1.5;
                const sx2 = pp.x - tx * 1.5, sz2 = pp.z - tz * 1.5;
                if (spotOK(sx, sz, 0.2, 2.2)) busPole(sx, sz, -bx, -bz);
                else if (spotOK(sx2, sz2, 0.2, 2.2)) busPole(sx2, sz2, -bx, -bz);
                hasStop = true;
              }
            }
          }
        }
        // 2) HYDRANT near mid-block, ~1 face in 2.6 (a hydrant per 60-80 m)
        if (H1(0x63) < 0.38) {
          const p = tryAt(L * (0.3 + H1(0x64) * 0.4), 0.55, 0.4, 5, 2.6);
          if (p) hydrant(p.x, p.z, bx, bz);
        }
        // 3) LITTER BIN at the near corner
        if (H1(0x65) < (busy ? 0.72 : dk === "industrial" ? 0.2 : 0.42)) {
          const p = tryAt(1.0, 0.6, 0.4, 3, 2.2);
          if (p) bin(p.x, p.z, bx, bz);
        }
        // 4) NEWS BOXES at the far corner of busy blocks, in ones and twos
        if (H1(0x66) < (busy ? 0.5 : dk === "residential" ? 0.12 : 0.04)) {
          const two = busy && H1(0x67) < 0.55;
          const vi0 = (H1(0x68) * KIT.newsVariants) | 0;
          const p = tryAt(L - 1.1, 0.58, 0.32, 3, 2.2);
          if (p) {
            newsbox(p.x, p.z, bx, bz, vi0);
            if (two) {
              const tx = F.vertical ? 0 : 1, tz = F.vertical ? 1 : 0;
              const q = { x: p.x - tx * 0.6, z: p.z - tz * 0.6 };
              if (spotOK(q.x, q.z, 0.28, 2.2)) newsbox(q.x, q.z, bx, bz, (vi0 + 1) % KIT.newsVariants);
            }
          }
        }
        // 5) COLLECTION MAILBOX on some faces
        if (H1(0x69) < (busy ? 0.24 : dk === "residential" ? 0.18 : 0.06)) {
          const p = tryAt(L * 0.64, 0.62, 0.45, 4, 2.6);
          if (p) mailbox(p.x, p.z, bx, bz);
        }
        // 6) STREET TREES in grates between the lamps
        const treeP = dk === "residential" ? 0.85 : busy ? 0.6 : dk === "projects" ? 0.3 : 0.0;
        if (GRAM && H1(0x6a) < treeP) {
          const n = Math.max(1, Math.floor(L / 8.5));
          for (let k = 0; k < n; k++) {
            const p = tryAt((k + 0.5) * (L / n), 0.85, 0.75, 2, 2.4);
            if (p) tree(p.x, p.z);
          }
        }
        // 7) METERS at stall spacing on commercial kerbs (never a bus stop)
        if (busy && !hasStop && H1(0x6b) < 0.7) {
          for (let u = 2.6; u < L - 2.0; u += 6.1) {
            const p = P(u, 0.5);
            if (spotOK(p.x, p.z, 0.22, 1.8)) meter(p.x, p.z, bx, bz);
          }
        }
      }

      // ---- SHOP FRONTS: a bin by the kerb, and the dressing the trade puts
      // out (only where the frontage actually has the room) ----------------
      function kerbDistFrom(x, z, ex, ez) {
        for (let k = 0; k <= 48; k++) {
          const d = k * 0.25;
          if (st.regionAt(x + ex * d, z + ez * d) === 0) return d;
        }
        return -1;
      }
      for (const D of shopDoors) {
        const kd = kerbDistFrom(D.x, D.z, D.ex, D.ez);
        if (kd < 1.5 || kd > 9) continue;
        const tx = -D.ez, tz = D.ex;               // along the frontage
        const side = hsh(D.x, D.z, 0x71) < 0.5 ? -1 : 1;
        // kerbside bin a few metres off the door line
        if (hsh(D.x, D.z, 0x72) < 0.65) {
          const kx = D.x + D.ex * (kd - 0.6), kz = D.z + D.ez * (kd - 0.6);
          for (const off of [2.6, 3.4, -2.6]) {
            const x = kx + tx * off * side, z = kz + tz * off * side;
            if (spotOK(x, z, 0.4, 1.4)) { bin(x, z, -D.ex, -D.ez); break; }
          }
        }
        // the trade's own dressing, against the storefront beside the door.
        // face = the door plane; room = face-to-kerb distance
        const face = 0.35;                          // door point sits just inside
        const room = kd - face;
        const at = function (outM, alongM) {
          return { x: D.x + D.ex * (face + outM) + tx * alongM * side, z: D.z + D.ez * (face + outM) + tz * alongM * side };
        };
        const padOK = function (p, r) {
          const reg = st.regionAt(p.x, p.z);
          return (reg === 1 || reg === 2) && !insideBuilding(p.x, p.z) && !nearDoor(p.x, p.z, 1.6) && clearAt(p.x, p.z, r);
        };
        const k = D.kind;
        if ((k === "food" || k === "bar") && room >= 3.4) {
          const p = at(1.25, 2.9);
          if (padOK(p, 1.0) && patioSet(p.x, p.z, yawTo(D.ex, D.ez), st.heightAt(p.x, p.z))) { claim(p.x, p.z, 1.1); KERB_STATS.patio++; }
        } else if (k === "hardware" && room >= 2.8) {
          const p = at(0.45, 2.4);
          if (padOK(p, 0.75)) { propaneCage(p.x, p.z, yawTo(D.ex, D.ez), st.heightAt(p.x, p.z)); claim(p.x, p.z, 0.8); KERB_STATS.propane++; }
        } else if (k === "gym") {
          const kx = D.x + D.ex * (kd - 0.7) + tx * 3.2 * side, kz = D.z + D.ez * (kd - 0.7) + tz * 3.2 * side;
          if (spotOK(kx, kz, 1.2, 1.6)) { bikeRack(kx, kz, yawTo(tx, tz), st.heightAt(kx, kz)); claim(kx, kz, 1.3); KERB_STATS.bikerack++; }
        }
        // an A-frame board on the OTHER side of the door, against the glass
        if (SHOP_BOARD_AD[k] && room >= 2.0 && hsh(D.x, D.z, 0x73) < 0.55) {
          const p = at(0.4, -1.5);
          if (padOK(p, 0.4)) { shopBoard(p.x, p.z, yawTo(D.ex, D.ez), k, st.heightAt(p.x, p.z)); claim(p.x, p.z, 0.45); KERB_STATS.aframe++; }
        }
      }

      // ---- build the instanced sets (one InstancedMesh per 200 m cell) -----
      for (const kind in ITEMS) {
        const Kd = KIT[kind];
        if (!Kd || !ITEMS[kind].length) continue;
        KERB_SETS[kind] = HW.chunked("kerb-" + kind, Kd.whole, VC, ITEMS[kind], { cast: kind !== "grate", maxDist: 320 }).addTo(root);
        KERB_STATS.drawSets += KERB_SETS[kind].meshes.length;
      }
      if (GRAM && trunkItems.length) {
        KERB_SETS._trunk = HW.chunked("kerb-tree-trunk", trunkGeo, trunkM, trunkItems, { cast: true, maxDist: 420 }).addTo(root);
        KERB_STATS.drawSets += KERB_SETS._trunk.meshes.length;
        for (let c = 0; c < 2; c++) {
          if (!crownItems[c].length) continue;
          const dm = VKIT && VKIT.depthMaterial && crownGeo.userData && crownGeo.userData.leafCards ? VKIT.depthMaterial("foliage") : null;
          KERB_SETS["_crown" + c] = HW.chunked("kerb-tree-crown" + c, crownGeo, crownMs[c], crownItems[c], { cast: true, maxDist: 420,
            perMesh: function (im) { if (dm) im.customDepthMaterial = dm; } }).addTo(root);
          KERB_STATS.drawSets += KERB_SETS["_crown" + c].meshes.length;
        }
      }
    })();
    } catch (e) { console.error("[kerb furniture]", e); }

    // Lot-edge scatter is gone (see KERB FURNITURE above); `lots` feeds only
    // the opt-in layers below (rooftop rails / roof boards / camps).
    const lots = STREET_CLUTTER ? city.lots : [];

    // ----- BILLBOARDS on the perimeter wall + a few rooftops ---------------
    // Big roadside billboards face inward along the outer walls (you see them as
    // you drive the ring road); their legs sit just inside the sidewalk band.
    // BUG FIX: the old fixed +6 inset dropped a board's legs straight into the
    // outermost cross-street (that street's kerb is only ~4.5 from the wall). We
    // now push each board INWARD (along its facing normal, away from the wall)
    // until its full footprint clears every road kerb, then place it — and skip
    // it entirely if no inset within reach is clear (better a gap than a board
    // in the carriageway). The inward direction is the board's local +z normal:
    // world (sin yaw, cos yaw).
    const mnX = city.minX, mxX = city.maxX, mnZ = city.minZ, mxZ = city.maxZ;
    const bbStepX = (mxX - mnX) / 4, bbStepZ = (mxZ - mnZ) / 4;
    // A board may not stand inside a lot footprint (it would clip the facade).
    // This helper deliberately lives outside the STREET_CLUTTER block because
    // both placement helpers close over it.
    function insideLot(x, z) {
      for (const lot of doorLots()) {
        const hw = lot.w / 2 + 1.0, hd = (lot.d != null ? lot.d : lot.w) / 2 + 1.0;
        if (Math.abs(x - lot.cx) < hw && Math.abs(z - lot.cz) < hd) return true;
      }
      return false;
    }
    // place a board at base (bx,bz) facing `yaw`, sliding it INWARD along
    // (inX,inZ) AND laterally along the kerb (the board tangent) until its whole
    // footprint clears every road. The lateral slide matters because a mid-wall
    // board lands square on the perpendicular CENTRAL road, and its width — not
    // its depth — straddles that carriageway: only stepping it sideways off the
    // centre-line clears it. First clear spot wins; give up rather than place in
    // the street.
    function placePerimBoard(bx, bz, yaw, big, inX, inZ) {
      const tx = inZ, tz = -inX;            // kerb tangent (perp to the inward dir)
      for (let step = 0; step <= 9; step++) {
        const ix = bx + inX * step * 1.5, iz = bz + inZ * step * 1.5;
        for (const lat of [0, 9, -9, 16, -16, 22, -22]) {
          const x = ix + tx * lat, z = iz + tz * lat;
          if (Math.abs(x) > 9990 || Math.abs(z) > 9990) continue;
          if (insideLot(x, z) || nearDoor(x, z, 3)) continue;
          if (billboardClearsRoads(x, z, yaw, big, 1.0)) { billboard(x, z, yaw, big); return true; }
        }
      }
      return false;
    }
    if (STREET_CLUTTER) {
      for (let k = 1; k <= 3; k++) {
        // north & south walls (face inward: +z from the south wall, -z from north)
        placePerimBoard(mnX + bbStepX * k, mnZ + 6, 0, true, 0, 1);
        placePerimBoard(mnX + bbStepX * k, mxZ - 6, Math.PI, true, 0, -1);
        // west & east walls (face inward: +x from west wall, -x from east)
        placePerimBoard(mnX + 6, mnZ + bbStepZ * k, Math.PI / 2, true, 1, 0);
        placePerimBoard(mxX - 6, mnZ + bbStepZ * k, -Math.PI / 2, k === 2 ? false : true, -1, 0);
      }
    }

    // ----- CORE-AVENUE BILLBOARDS: the priciest faces in the city ----------
    // Perimeter boards only catch the ring road; the REAL eyeballs are on the
    // two central avenues. Stand a big board on each side of both, turned
    // square at oncoming traffic — these are the district-core surfaces
    // adboard.js prices at multiples of the docks (busyness = rent).
    const cAvX = (mnX + mxX) / 2, cAvZ = (mnZ + mxZ) / 2;
    let vAve = null, hAve = null, bvd = 1e9, bhd = 1e9;
    for (const r of city.roads) {
      if (r.vertical) { const d = Math.abs(r.x - cAvX); if (d < bvd) { bvd = d; vAve = r; } }
      else { const d = Math.abs(r.z - cAvZ); if (d < bhd) { bhd = d; hAve = r; } }
    }
    // BUG FIX: the old coreBand = ROAD/2 + 2.6 only stood the board CENTRE clear
    // of the avenue, and inCrossRoad() only tested the centre — so a board whose
    // 8.5m width spanned a perpendicular cross-street threw its edge/leg into
    // that carriageway. We now search both the along-road position AND the kerb
    // stand-off, and accept a spot ONLY when the board's full footprint clears
    // every road (billboardClearsRoads). If nothing clears, the board is skipped
    // rather than dropped in the street.
    function coreBoard(road, s) {
      if (!road) return;
      const yaw = road.vertical ? (s > 0 ? -Math.PI / 2 : Math.PI / 2) : (s > 0 ? Math.PI : 0);
      // along-road positions, then progressively deeper kerb stand-offs
      for (const t of [38, 24, 52, 16, 64]) {
        for (const band of [city.ROAD / 2 + 2.6, city.ROAD / 2 + 4.5, city.ROAD / 2 + 6.5]) {
          const bx = road.vertical ? road.x + s * band : road.x + s * t;
          const bz = road.vertical ? road.z + s * t : road.z + s * band;
          if (Math.abs(bx) > 9990 || Math.abs(bz) > 9990) continue;
          if (insideLot(bx, bz) || nearDoor(bx, bz, 4)) continue;
          if (!billboardClearsRoads(bx, bz, yaw, true, 1.0)) continue;
          billboard(bx, bz, yaw, true);
          return;
        }
      }
    }
    if (STREET_CLUTTER) for (const s of [-1, 1]) { coreBoard(vAve, s); coreBoard(hAve, s); }

    // ----- PURPOSEFUL ROOFTOPS ---------------------------------------------
    // Generic AC/vent/tank/dish/mast clutter was pure silhouette noise and has
    // been removed. Keep only fall-prevention rails and the rare rentable ad:
    // both have a direct gameplay reason to exist.
    for (const lot of lots) {
      const b = lot.building; if (!b || b.park) continue;   // parks carry a stub building (owner only) but have NO structure — no roof gear floats over them
      // roof height + extent + the gear-clear roof centre (away from the stairwell)
      const h = (b.h || b.height || (8 + (rng() * 14))) + 0.1;
      const rcx = b.roofCx != null ? b.roofCx : lot.cx;
      const rcz = b.roofCz != null ? b.roofCz : lot.cz;
      const halfW = (b.w ? b.w / 2 : lot.w / 2) - 1.5;
      const halfD = (b.d ? b.d / 2 : lot.d / 2) - 1.5;
      if (halfW < 1.5 || halfD < 1.5) continue;
      // Consume the former clutter stream without building anything, preserving
      // every downstream seeded billboard/rail/world-layout decision.
      const units = 2 + ((rng() * 4) | 0);
      for (let u = 0; u < units; u++) {
        rng(); // former x
        rng(); // former z
        const t = rng();
        if (t >= 0.72 && t < 0.85) rng();       // former dish heading
        else if (t >= 0.95) { rng(); rng(); rng(); } // former mast size/arms
      }
      if (h > 14) rng(); // former roof-edge pipe chance
      // ROOFTOP STAIR-HUT bulkhead REMOVED (owner-filmed): a plain box with a
      // door read as a "fake elevator" you'd expect to enter but can't. The draw
      // call below is preserved (same short-circuit as the old `&& rng() < 0.45`)
      // so the deterministic per-roof prop stream stays byte-identical — only the
      // hut meshes are gone. The real elevators (their lobby cab + enclosed shaft
      // + roof headhouse) are built by city/elevators.js on storeys>=3 towers and
      // are untouched.
      if (halfW > 3 && halfD > 3) { rng(); }
      // PARAPET-RAILING SLATS deleted 2026-09-27 (de-slop): a thin rail at
      // knee height floating 1.5 m INSIDE the parapet on the N/S sides only,
      // with slats that stood on nothing, on 60% of roofs. The parapet is the
      // fall guard (city/elevators.js gives reachable roofs rim colliders).
      // The rng draw is kept so the seeded stream downstream is unchanged.
      if (halfW > 2.5 && halfD > 2.5) rng();
      // a RARE rooftop BILLBOARD on tall buildings — a small framed lit ad board
      // standing on the roof, angled to face the street. Big landmark, low odds.
      if (h > 18 && halfW > 3.5 && halfD > 3.5 && rng() < 0.12) {
        const bg = new THREE.Group();
        bg.position.set(rcx, h, rcz + halfD * 0.4);
        bg.rotation.y = rng() < 0.5 ? 0 : Math.PI;
        const legG = geo("roofBillLeg", () => new THREE.CylinderGeometry(0.12, 0.15, 2.4, 6));
        for (const lx of [-2.4, 2.4]) { const l = new THREE.Mesh(legG, billLegM); l.position.set(lx, 1.2, 0); l.castShadow = true; bg.add(l); }
        const frame = new THREE.Mesh(geo("roofBillFrame", () => new THREE.BoxGeometry(6.4, 2.8, 0.25)), billFrameM);
        frame.position.set(0, 3.4, 0); bg.add(frame);
        const pick = pickAd(rcx, rcz, { allowWanted: true });
        const adM = adMatFor(pick.ad);
        const board = new THREE.Mesh(geo("roofBillBoard", () => new THREE.PlaneGeometry(6.0, 2.4)), adM);
        board.position.set(0, 3.4, 0.14); bg.add(board);
        nightAds.push(adM);
        regDynAd(board, pick, bg.position.x, h + 3.4, bg.position.z);   // wanted poster or E3 market ticker -> live-refresh driver
        // rentable from THIS roof (y gates the walk-up): the apex flex — your
        // name over the skyline, reachable via the building's elevator.
        adBoards.push({ mesh: board, x: bg.position.x, z: bg.position.z, y: h, kind: "roof", mat0: adM });
        root.add(bg);
      }
    }

    // =====================================================================
    //  HOMELESS CAMPS — WHERE THE BOTTOM LIVES. 2–3 strips hugging a lot
    //  edge in the projects (industrial fringe as spillover): tarp tents
    //  against the wall, a fire barrel at the kerb, flattened cardboard and
    //  a loaded cart. Deterministic from the city seed and placed AFTER all
    //  other props so the existing rng stream (and thus the whole built
    //  city) is byte-identical to before. Every repeated mesh shares one
    //  geometry/material; the fire is a flicker sprite + an emissive ground
    //  pool — NO real THREE light. CBZ.cityCamps publishes the anchors so
    //  the vagrants can post up here and cop beats can come roust them.
    // =====================================================================
    const camps = CBZ.cityCamps = [];
    const campFires = [];                 // {flame, smoke, y0, ph} — flicker-driven below
    const GY = 0.09;                      // pavement top (sidewalk 0.08 / lot pad 0.10)
    // ridge tent: a 3-sided prism (apex up, flat base on the pavement)
    const tentG = geo("campTent", () => {
      const t = new THREE.CylinderGeometry(1.0, 1.0, 2.1, 3, 1, false, Math.PI / 2);
      t.rotateZ(Math.PI / 2);             // ridge runs along local x
      t.translate(0, 0.5, 0);             // base edge sits at y=0
      return t;
    });
    const flapG = geo("campFlap", () => new THREE.PlaneGeometry(0.55, 0.75));
    // PROPS_PURPOSE: sized so a ~1.8u character actually FITS lying on it —
    // these register as "bedroll" beds (vagrants sleep here; so can you).
    const cardG = geo("campCard", () => new THREE.BoxGeometry(0.95, 0.025, 1.9));
    const barrelG = geo("campBarrel", () => new THREE.CylinderGeometry(0.34, 0.3, 0.95, 8));
    const emberG = geo("campEmber", () => new THREE.CircleGeometry(0.27, 8));
    const poolGeo = geo("campPool", () => new THREE.CircleGeometry(2.0, 12));
    const TARPS = [smat(0x2f5fae), smat(0x4a6b3a), smat(0x6e7280)];  // blue tarp, army surplus, grey sheet
    const flapM = smat(0x191c21), cardM = smat(0xa8895c), rustM = smat(0x5e3422);
    const emberM = smat(0xff7a22, { emissive: 0xff7a22, ei: 0.95 }); // the coals burn day & night
    // ONE warm pool material for every camp → flickering them all is a single write
    const firePoolM = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, depthWrite: false });
    // soft radial sprite texture (one tiny canvas per look, ever)
    function puffTex(inner, outer) {
      const c = document.createElement("canvas"); c.width = c.height = 64;
      const x = c.getContext("2d");
      const gr = x.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, inner); gr.addColorStop(1, outer);
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    }
    const flameM = new THREE.SpriteMaterial({ map: puffTex("rgba(255,232,170,1)", "rgba(255,110,20,0)"), color: 0xffb050, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending });
    const smokeTexS = puffTex("rgba(205,210,220,0.8)", "rgba(205,210,220,0)");

    // a loaded shopping cart: basket + tray + handle + axles + a tarp bundle
    const cartM = smat(0x9aa0a8);
    function shoppingCart(x, z, yaw) {
      const g = new THREE.Group(); g.position.set(x, GY, z); g.rotation.y = yaw;
      const basket = new THREE.Mesh(geo("cartBasket", () => new THREE.BoxGeometry(0.82, 0.5, 0.56)), cartM);
      basket.position.y = 0.78; basket.castShadow = true; g.add(basket);
      const tray = new THREE.Mesh(geo("cartTray", () => new THREE.BoxGeometry(0.7, 0.04, 0.48)), cartM);
      tray.position.y = 0.3; g.add(tray);
      const bar = new THREE.Mesh(geo("cartBar", () => new THREE.BoxGeometry(0.07, 0.07, 0.62)), cartM);
      bar.position.set(-0.52, 1.02, 0); g.add(bar);
      const axleG = geo("cartAxle", () => { const a = new THREE.CylinderGeometry(0.07, 0.07, 0.56, 6); a.rotateX(Math.PI / 2); return a; });
      for (const ax of [-0.3, 0.3]) { const w = new THREE.Mesh(axleG, flapM); w.position.set(ax, 0.08, 0); g.add(w); }
      // everything they own, bundled in a tarp on top
      const bag = new THREE.Mesh(geo("cartBag", () => new THREE.IcosahedronGeometry(0.3, 0)), TARPS[(rng() * TARPS.length) | 0]);
      bag.position.set(0.05, 1.12, 0); bag.scale.set(1.1, 0.75, 0.95); g.add(bag);
      root.add(g);
      city.streetProps.push({ x, z, type: "cart" });   // soft junk, no collider (peds flow past)
    }

    // one camp strip on a lot edge. Local frame: t runs along the edge,
    // n points out toward the street (tents hug the wall, barrel at the kerb).
    function buildCamp(lot, edge) {
      const hw = lot.w / 2;
      const F = edge === 0 ? { ox: lot.cx, oz: lot.cz - hw, tx: 1, tz: 0, nx: 0, nz: -1 }
            : edge === 1   ? { ox: lot.cx, oz: lot.cz + hw, tx: 1, tz: 0, nx: 0, nz: 1 }
            : edge === 2   ? { ox: lot.cx - hw, oz: lot.cz, tx: 0, tz: 1, nx: -1, nz: 0 }
            :                { ox: lot.cx + hw, oz: lot.cz, tx: 0, tz: 1, nx: 1, nz: 0 };
      const at = (t, n) => ({ x: F.ox + F.tx * t + F.nx * n, z: F.oz + F.tz * t + F.nz * n });
      const tOff = (rng() - 0.5) * lot.w * 0.25;
      // the whole strip (≈±3 along the edge) must clear doors and the map rim
      for (const tt of [-2.8, 0, 2.8]) {
        const p = at(tOff + tt, 0.9);
        if (Math.abs(p.x) > 9990 || nearDoor(p.x, p.z, 2.8)) return false;
      }
      const ridgeYaw = F.tx ? 0 : -Math.PI / 2;       // tent ridge runs along the edge
      const nT = 2 + ((rng() * 2) | 0);               // 2–3 tents per camp
      for (let i = 0; i < nT; i++) {
        const tt = tOff + (i - (nT - 1) / 2) * 2.6 + (rng() - 0.5) * 0.4;
        const band = 0.1 + rng() * 0.25;              // hugging the wall line
        const p = at(tt, band);
        const tent = new THREE.Mesh(tentG, TARPS[(rng() * TARPS.length) | 0]);
        tent.position.set(p.x, GY, p.z); tent.rotation.y = ridgeYaw + (rng() - 0.5) * 0.16;
        tent.castShadow = true; root.add(tent);
        // dark door flap closing one open end
        const fs = rng() < 0.5 ? -1 : 1;
        const fp = at(tt + fs * 1.04, band);
        const flap = new THREE.Mesh(flapG, flapM);
        flap.position.set(fp.x, GY + 0.42, fp.z);
        flap.rotation.y = F.tx ? (fs > 0 ? Math.PI / 2 : -Math.PI / 2) : (fs > 0 ? 0 : Math.PI);
        root.add(flap);
        solidCollider(p.x, p.z, 0.8, tent);
      }
      // the FIRE BARREL out at the kerb — the camp's hearth
      const bp = at(tOff + (rng() - 0.5) * 1.4, 1.75);
      const barrel = new THREE.Mesh(barrelG, rustM);
      barrel.position.set(bp.x, GY + 0.48, bp.z); barrel.castShadow = true; root.add(barrel);
      const ember = new THREE.Mesh(emberG, emberM);
      ember.rotation.x = -Math.PI / 2; ember.position.set(bp.x, GY + 0.93, bp.z); root.add(ember);
      const flame = new THREE.Sprite(flameM);
      flame.position.set(bp.x, GY + 1.28, bp.z); flame.scale.set(0.55, 0.7, 1); root.add(flame);
      // each wisp owns its material so it can FADE as it rises (≤3 mats total)
      const smoke = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTexS, color: 0xb9bec8, transparent: true, opacity: 0, depthWrite: false }));
      smoke.position.set(bp.x, GY + 1.5, bp.z); root.add(smoke);
      // warm light POOL on the pavement — an emissive disc, not a real light;
      // the flicker driver fades it up after dark (firelight for free)
      const pool = new THREE.Mesh(poolGeo, firePoolM);
      // SEATED ON THE REAL STREET. The fixed 0.165 was authored for the old
      // 8 cm sidewalk / 10 cm pad; the camp stands on the lot edge, so the 2 m
      // disc now spans the 0.125 lot pad, the back slope and the 0.18 footway,
      // and lay 1.5 cm UNDER the footway it glowed through, flickering. A flat
      // disc cannot follow the kerb profile, so it rides 2 cm over the highest
      // ground under it.
      let poolY = 0.165;
      if (city.groundDecalY) {
        poolY = 0;
        for (const o of [[0, 0], [1.9, 0], [-1.9, 0], [0, 1.9], [0, -1.9]]) poolY = Math.max(poolY, +city.groundDecalY(bp.x + o[0], bp.z + o[1]) || 0);
        poolY += 0.02;
      }
      pool.rotation.x = -Math.PI / 2; pool.position.set(bp.x, poolY, bp.z); root.add(pool);
      campFires.push({ flame, smoke, y0: GY + 1.4, ph: rng() * 6.28 });
      solidCollider(bp.x, bp.z, 0.42, barrel);
      // flattened CARDBOARD bedding between the tents and the fire — each one
      // is a real BEDROLL anchor (same rng draw count: the yaw draw is just
      // captured before use, so the deterministic stream is untouched).
      const nC = 2 + ((rng() * 2) | 0);
      for (let i = 0; i < nC; i++) {
        const p = at(tOff + (rng() - 0.5) * 5.0, 0.7 + rng() * 0.8);
        const card = new THREE.Mesh(cardG, cardM);
        const cyaw = rng() * 6.28;
        // on the drawn ground, 2 cm proud: the fixed 0.12 left the card's top
        // 7 mm over the lot pad (fighting it) or buried in the footway
        const cardY = city.groundDecalY ? (+city.groundDecalY(p.x, p.z) || 0) + 0.0325 : 0.12;
        card.position.set(p.x, cardY, p.z); card.rotation.y = cyaw; root.add(card);
        // head toward the card's local +z end (world (sin cyaw, cos cyaw))
        if (CBZ.propRegisterBed) CBZ.propRegisterBed(p.x, 0, p.z, Math.sin(cyaw), Math.cos(cyaw), 1.9, 0.14, "bedroll", null);
      }
      // a loaded SHOPPING CART parked at the end of the row
      const cp = at(tOff + (rng() < 0.5 ? -1 : 1) * 3.4, 1.2 + rng() * 0.6);
      shoppingCart(cp.x, cp.z, rng() * 6.28);
      const cc = at(tOff, 1.0);
      camps.push({ x: cc.x, z: cc.z, r: 3.6 });        // anchor: vagrants/cops read this
      city.streetProps.push({ x: cc.x, z: cc.z, type: "camp" });
      return true;
    }

    // pick the camp blocks: the projects pocket first, the industrial fringe
    // as spillover — the SAME lots peds.js seeds its vagrants on, so the
    // beggars and their bedrolls end up on the same corners.
    const dKind = (l) => { const d = city.districtAt ? city.districtAt(l.cx, l.cz) : null; return d ? d.kind : null; };
    const okCampLot = (l) => l.building && !l.building.park;     // a camp needs a wall behind it
    const projLots = lots.filter((l) => dKind(l) === "projects" && okCampLot(l));
    const fringeLots = lots.filter((l) => dKind(l) === "industrial" && okCampLot(l));
    const basePool = projLots.length ? projLots : fringeLots;
    if (basePool.length) {
      const usedCampLots = new Set();
      let builtCamps = 0;
      for (let tries = 0; tries < 14 && builtCamps < 3; tries++) {
        // the third camp prefers the industrial fringe (the alley sleepers)
        const pool = (builtCamps === 2 && fringeLots.length) ? fringeLots : basePool;
        const lot = pool[(rng() * pool.length) | 0];
        if (usedCampLots.has(lot)) continue;
        if (buildCamp(lot, (rng() * 4) | 0)) { usedCampLots.add(lot); builtCamps++; }
      }
    }

    // =====================================================================
    //  CAMP-FIRE FLICKER — the camps' only per-frame cost, and it's tiny:
    //  ≤3 sprite transforms + 2 shared material writes. The flame breathes
    //  (two offset sines ≈ fire), smoke wisps rise/grow/fade on a loop, and
    //  after dark the shared pool disc washes each camp warm.
    // =====================================================================
    if (CBZ.onAlways && campFires.length && !city._campFireHooked) {
      city._campFireHooked = true;
      let ft = 0;
      CBZ.onAlways(7.5, function (dt) {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || !root.visible) return;
        ft += dt || 0.016;
        const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
        const fl = 0.82 + Math.sin(ft * 9.3) * 0.11 + Math.sin(ft * 23.7) * 0.07;
        flameM.opacity = 0.5 + fl * 0.4;
        firePoolM.opacity = (0.04 + n * 0.34) * fl;    // the warm pool only reads after dark
        for (const e of campFires) {
          const s = 0.5 + 0.16 * Math.sin(ft * 11 + e.ph) + 0.05 * Math.sin(ft * 27 + e.ph * 2);
          e.flame.scale.set(s, s * 1.25, 1);
          const u = (ft * 0.3 + e.ph) % 1;             // wisp cycle: rise, swell, thin out
          e.smoke.position.y = e.y0 + u * 1.7;
          const ss = 0.35 + u * 0.9;
          e.smoke.scale.set(ss, ss, 1);
          e.smoke.material.opacity = 0.26 * (1 - u);
        }
      });
    }

    // =====================================================================
    //  NIGHT DRIVER — lamp heads glow + billboards/ad panels self-illuminate
    //  after dark. Reads CBZ.nightAmount (0 day .. 1 deep night) set by
    //  core/daynight.js. City mode only; cheap (a handful of material writes
    //  ramped over a couple seconds, not per-prop work every frame).
    // =====================================================================
    if (CBZ.onAlways && !city._propNightHooked) {
      city._propNightHooked = true;
      let lastN = -1;
      CBZ.onAlways(7, function () {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || !root.visible) return;
        const n = CBZ.nightAmount == null ? 0 : CBZ.nightAmount;
        if (Math.abs(n - lastN) < 0.02) return;     // only touch materials on real change
        lastN = n;
        const on = n;                               // 0..1
        headLampM.emissiveIntensity = 0.05 + on * 0.95;
        // the light pools on the asphalt: the street reads by lamplight after dark
        const pools = lampPools.glow;
        if (pools && HW) { HW.setPoolIntensity(pools, on * 0.9); HW.cullSets([pools], CBZ.camera && CBZ.camera.position); }
        for (const glow of nightLamps) { if (glow.material && glow.material.emissive) glow.material.emissiveIntensity = on * 0.9; }
        for (const am of nightAds) { am.emissiveIntensity = 0.06 + on * 0.6; }
      });
    }

    // =====================================================================
    //  LIVE-CONTENT DRIVER — re-skins the handful of boards whose ad is dynamic:
    //  a WANTED poster (your face, as your heat climbs) or an E3 MARKET TICKER
    //  (sim/market.js + sim/econstate.js). Runs at ~1 Hz, only swaps a material
    //  map on the boards that actually changed, so it costs nothing the rest of
    //  the time. City mode only.
    //
    //  Throttling: the wanted branch is gated on a signature (unchanged →
    //  skipped entirely, as before this wave). The ticker branch has no single
    //  signature to gate on (many boards, each tracking its own category pair),
    //  so it recomputes every ~1s tick — but adKey() dedupes per board: a
    //  ticker's canvas/material is only actually rebuilt (cache miss) when its
    //  displayed text changes, i.e. when a price's 2-decimal readout moves,
    //  which is the ">1%" cheap-repaint throttle the plan calls for.
    // =====================================================================
    if (CBZ.onAlways && dynAds.length && !city._propWantedHooked) {
      city._propWantedHooked = true;
      let acc = 0, lastSig = "";
      const tickerCache = new Map();   // "cat0|cat1" -> this tick's ad record (recomputed once per pair, not per board)
      CBZ.onAlways(8, function (dt) {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || !root.visible) return;
        acc += (dt || 0.016);
        if (acc < 1.0) return; acc = 0;
        const sig = (g.wanted | 0) + ":" + (g.cityKills | 0) + ":" + (g.playerGang && g.playerGang.name || "");
        const sigChanged = sig !== lastSig;
        if (sigChanged) lastSig = sig;
        const wAd = sigChanged ? (wantedAd() || BRAND_ADS[0]) : null;
        const lit = (CBZ.nightAmount == null ? 0 : CBZ.nightAmount);
        tickerCache.clear();
        for (const e of dynAds) {
          if (e.mesh.userData.adLease) continue;    // the player RENTS this face (adboard.js) — their creative outranks any live driver
          let ad = null;
          if (e.dyn === "wanted") {
            if (!sigChanged) continue;              // nothing the poster cares about changed
            ad = wAd;
          } else if (e.dyn === "ticker") {
            const ck = (e.cats || []).join("|");
            ad = tickerCache.get(ck);
            if (!ad) { ad = tickerAd(e.cats || []) || BRAND_ADS[0]; tickerCache.set(ck, ad); }
          } else continue;
          const key = adKey(ad);
          if (key === e.lastKey) continue;          // this board already shows it
          e.lastKey = key;
          const mat2 = adMatFor(ad);
          e.mesh.material = mat2;                   // swap to the live material
          mat2.emissiveIntensity = 0.06 + lit * 0.6;
          if (nightAds.indexOf(mat2) < 0) nightAds.push(mat2);
        }
      });
    }

    // =====================================================================
    //  SMARTER STREET-LIGHT RENDERING, part 1: bake the pooled Fresnel
    //  glow-shell InstancedMeshes now that every lamp/signal spot for this
    //  build has been collected above. ONE InstancedMesh per colour (warm
    //  streetlamp + red/yellow/green signal) no matter how many hundreds of
    //  bulbs the city has — draw-call cost is FIXED, not per-bulb. Skips
    //  cleanly (buildGlowShellPool returns null) on a headless/minimal THREE
    //  stub that lacks ShaderMaterial, or when a city rebuild has zero spots.
    // =====================================================================
    // (no glow shell on the street lamps: a Fresnel sphere under a cobra head
    // reads as a white ball hanging off the arm. The flat lens + the light
    // pool on the road are the lamp. lampGlowSpots stay registered so
    // hitProp's setGlowOn is a harmless no-op.)
    // signal halos: one shell pool per 200 m cell per colour, each with a
    // world-space bounding sphere so r128 frustum-culls it (a city-wide pool
    // has to be frustumCulled=false and shades every junction every frame).
    // setGlowOn keeps working unchanged: each spot records its own cell pool.
    function glowShellCells(colorHex, spots, size) {
      const cell = HW ? HW.CELL : 1e9, groups = new Map(), out = [];
      for (const sp of spots) {
        const k = Math.floor(sp.x / cell) + "," + Math.floor(sp.z / cell);
        let gl = groups.get(k); if (!gl) { gl = []; groups.set(k, gl); }
        gl.push(sp);
      }
      groups.forEach(function (gl) {
        const im = buildGlowShellPool(colorHex, gl, size);
        if (!im) return;
        let cx = 0, cy = 0, cz = 0;
        for (const sp of gl) { cx += sp.x; cy += sp.y; cz += sp.z; }
        cx /= gl.length; cy /= gl.length; cz /= gl.length;
        let r = 0;
        for (const sp of gl) r = Math.max(r, Math.hypot(sp.x - cx, sp.y - cy, sp.z - cz));
        if (THREE.Sphere) { im.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r + 1.5); im.frustumCulled = true; }
        out.push(im);
      });
      return out;
    }
    const sigShellMeshes = [].concat(
      glowShellCells(0xff3b3b, sigGlowSpots.red, 0.4),
      glowShellCells(0xffcf3b, sigGlowSpots.yel, 0.4),
      glowShellCells(0x39ff66, sigGlowSpots.grn, 0.4));

    // ---- SIGNAL LENSES ------------------------------------------------------
    // One InstancedMesh per colour SLOT (red/amber/green) for every vehicle
    // head in the city, flat 12-inch discs under their visors, unlit Basic
    // material: the hue lives in instanceColor, so ONE upload flips a lens
    // between LIT and its own dark tinted glass (a dark red lens still reads
    // red-ish at noon, exactly like the real thing). traffic.js calls
    // CBZ.citySignalSet with the handle; nothing there knows about meshes.
    // userData.terrain keeps core/farcull off these city-wide pools.
    const LENS_LIT = { red: 0xff2a1c, yel: 0xffae00, grn: 0x1cff8e };
    const LENS_DARK = { red: 0x2a0806, yel: 0x2c1d04, grn: 0x052418 };
    const _sigC = new THREE.Color();
    if (THREE.InstancedMesh) {
      const lensG = HW ? HW.signalLens() : geo("sigLens", () => new THREE.CircleGeometry(0.15, 14));
      const lensM = new THREE.MeshBasicMaterial({ color: 0xffffff });
      lensM._shared = true;
      for (const key of ["red", "yel", "grn"]) {
        const handles = sigLampHandles[key];
        if (!handles.length) continue;
        // chunked per cell; each handle keeps (its cell mesh, local index)
        const set = HW ? HW.chunked("signal-lens-" + key, lensG, lensM, handles, { cast: false, receive: false }).addTo(root) : null;
        if (!set) continue;
        for (let i = 0; i < handles.length; i++) {
          const h = handles[i], im = set.meshOf(i);
          if (!im) continue;
          h.litHex = LENS_LIT[key]; h.darkHex = LENS_DARK[key];
          h.sigPool = im; h.sigIdx = set.local[i];
          im.setColorAt(h.sigIdx, _sigC.setHex(h.darkHex));
        }
        for (const im of set.meshes) if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
    CBZ.citySignalSet = function (lamp, on, colorHex) {
      if (!lamp || !lamp.sigPool) return;
      lamp.lit = !!on;
      const hex = on ? (lamp.litHex != null ? lamp.litHex : colorHex) : (lamp.darkHex != null ? lamp.darkHex : 0x20242a);
      lamp.sigPool.setColorAt(lamp.sigIdx, _sigC.setHex(hex));
      if (lamp.sigPool.instanceColor) lamp.sigPool.instanceColor.needsUpdate = true;
    };
    // ---- PEDESTRIAN SIGNALS ---------------------------------------------------
    // Two lens pools (raised hand, walking person) sharing one icon texture.
    // They run off traffic.js's own phase clock (CBZ.cityPhase), so they can
    // never disagree with the vehicle heads: WALK while the parallel traffic
    // has green, flashing hand through its amber, steady hand otherwise.
    const PED_LIT = { hand: 0xff7a14, walk: 0xeaf4ff }, PED_DARK = { hand: 0x2a1c12, walk: 0x1c2024 };
    const pedTex = HW ? HW.pedTexture() : null;
    if (pedTex && pedHandles.length && THREE.InstancedMesh) {
      const pm = new THREE.MeshBasicMaterial({ color: 0xffffff, map: pedTex });
      pm._shared = true;
      for (const which of ["hand", "walk"]) {
        const hs = pedHandles.map(function (p) { return p[which]; });
        const set = HW.chunked("ped-signal-" + which, HW.pedLens(which), pm, hs, { cast: false, receive: false }).addTo(root);
        for (let i = 0; i < hs.length; i++) {
          const h = hs[i], im = set.meshOf(i);
          if (!im) continue;
          h.pool = im; h.idx = set.local[i]; h.which = which;
          im.setColorAt(h.idx, _sigC.setHex(PED_DARK[which]));
        }
        for (const im of set.meshes) if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
    function pedSet(h, on) {
      if (!h || !h.pool) return;
      h.pool.setColorAt(h.idx, _sigC.setHex(on ? PED_LIT[h.which] : PED_DARK[h.which]));
      h.pool.instanceColor.needsUpdate = true;
    }
    if (CBZ.onAlways && pedHandles.length && !city._pedSignalHooked) {
      city._pedSignalHooked = true;
      let pacc = 0;
      CBZ.onAlways(7.25, function (dt) {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || !root.visible) return;
        pacc += (dt || 0.016);
        if (pacc < 0.2) return; pacc = 0;
        const ph = CBZ.cityPhase ? CBZ.cityPhase() : null;
        if (!ph) return;
        const blink = ((((CBZ.now || 0) / 500) | 0) % 2) === 0;
        for (let i = 0; i < pedHandles.length; i++) {
          const p = pedHandles[i], st = ph[p.axis];
          if (p.dead) continue;
          const walk = st === "green", hand = st === "red" || (st === "yellow" && blink);
          const code = (walk ? 1 : 0) | (hand ? 2 : 0);
          if (code === p.state) continue;
          p.state = code;
          pedSet(p.walk, walk); pedSet(p.hand, hand);
        }
      });
    }
    // lit-state read that works for BOTH bulb representations: instanced
    // handles carry .lit (written by traffic.js's lampSet); legacy meshes are
    // read off their material exactly as before.
    function sigLit(l) {
      if (!l) return false;
      if (l.lit != null) return !!l.lit;
      return !!(l.material && l.material.emissiveIntensity > 0.5);
    }
    for (const im of sigShellMeshes) root.add(im);
    if (HW) HW.registerMeshes(sigShellMeshes, 350);   // halos gate at 350 m
    // signal glow shells track whichever colour traffic.js actually lit —
    // read the SAME lamp materials traffic.js's axisSet/lampSet already
    // drive (emissiveIntensity 1.0 lit / 0.04 dark) rather than re-deriving
    // the phase clock here, so this never drifts from the real state machine
    // (traffic.js already IS the red/yellow/green timer this task asked for;
    // this only mirrors its output onto the Fresnel shells).
    if (CBZ.onAlways && (sigShellMeshes.length || (lampPools.glow && sigPoolSrc.length)) && !city._sigGlowHooked) {
      city._sigGlowHooked = true;
      let acc = 0;
      CBZ.onAlways(7.2, function (dt) {
        const g = CBZ.game;
        if (!g || g.mode !== "city" || !root.visible) return;
        acc += (dt || 0.016);
        if (acc < 0.15) return; acc = 0;   // a couple times a second is plenty — the phase itself only flips a few times per cycle
        for (let i = 0; i < sigShellHeads.length; i++) {
          if (sigShellHeads[i].dead) continue;      // a snapped head stays dark (killSignal)
          const h = sigShellHeads[i].head, sp = sigShellHeads[i].spots;
          setGlowOn(sp.red, sigLit(h.red));
          setGlowOn(sp.yel, sigLit(h.yel));
          setGlowOn(sp.grn, sigLit(h.grn));
        }
        // the coloured wash on the road in front of each approach retints
        // only when that approach's phase actually changes
        const pools = lampPools.glow;
        if (pools && HW) {
          for (let i = 0; i < sigPoolSrc.length; i++) {
            const s = sigPoolSrc[i], h = s.head;
            const key = h.dead ? null : sigLit(h.red) ? "red" : sigLit(h.yel) ? "yel" : sigLit(h.grn) ? "grn" : null;
            if (key === s.key) continue;
            s.key = key;
            if (key) HW.setPoolColor(pools, s.idx, SIG_POOL[key][0], SIG_POOL[key][1]);
            else HW.setPoolColor(pools, s.idx, 0x000000, 0);
          }
        }
      });
    }

    // =====================================================================
    //  SMARTER STREET-LIGHT RENDERING, part 2: a SMALL FIXED POOL of real
    //  THREE.PointLights (shadows OFF), reparented each throttled tick to
    //  whichever `lightCandidates` (streetlamp bulbs + lit traffic signals)
    //  are currently nearest the camera. WHY a pool instead of "a light per
    //  bulb": hundreds of real lights would be a lighting-pass catastrophe
    //  (the exact "many lights in a city game" problem the three.js forum
    //  guidance warns about) — a bounded handful of real lights exist at
    //  any moment REGARDLESS of city size, and the Fresnel glow shells above
    //  sell every OTHER bulb's presence for free. The distance-sort itself is
    //  a flat scan over lightCandidates (a few hundred entries, cheap) run on
    //  a throttled interval (NOT per frame) — recomputing which handful is
    //  nearest a few times a second is imperceptible; recomputing every
    //  frame would just be wasted CPU for a light that hasn't moved.
    // =====================================================================
    const POOL_SIZE = 8;
    if (!city._lightPool && THREE.PointLight && CBZ.onAlways) {
      const pool = [];
      for (let i = 0; i < POOL_SIZE; i++) {
        const roadRealism = !CBZ.CONFIG || CBZ.CONFIG.CITY_STREET_REALISM_V1 !== false;
        const pl = new THREE.PointLight(0xffe0a0, 0, roadRealism ? 18 : 16, 2);
        pl.castShadow = false;
        pl.visible = false;
        root.add(pl);
        pool.push({ light: pl, boundTo: null });
      }
      city._lightPool = pool;
    }
    if (CBZ.onAlways && city._lightPool && lightCandidates.length && !city._lightPoolHooked) {
      city._lightPoolHooked = true;
      let acc2 = 999;
      CBZ.onAlways(7.3, function (dt) {
        const g = CBZ.game;
        const pool = city._lightPool;
        if (!g || g.mode !== "city" || !root.visible) { for (const slot of pool) slot.light.visible = false; return; }
        acc2 += (dt || 0.016);
        if (acc2 < 0.4) return;    // throttled re-sort — a light doesn't need to jump lamps 60x/sec
        acc2 = 0;
        const cam = CBZ.camera && CBZ.camera.position;
        if (!cam) return;
        // cheap distance-sort: partial selection of the POOL_SIZE nearest
        // candidates (a full sort over a few hundred entries is trivial at
        // this cadence, but partial-select avoids even that).
        const n = lightCandidates.length, want = pool.length;
        const nightSig = 1 + 5 * Math.max(0, Math.min(1, (headLampM.emissiveIntensity - 0.05) / 0.95));
        const best = [];   // {d2, cand}
        for (let i = 0; i < n; i++) {
          const c = lightCandidates[i];
          // a broken streetlamp or a currently-dark signal phase shouldn't
          // steal a pool slot from something actually lit.
          if (c.kind === "lamp" && c.ref && c.ref.broken) continue;
          if (c.dead) continue;                     // a snapped signal head
          if (c.kind === "signal" && c.head) {
            const hh = c.head;
            const litOne = sigLit(hh.red) || sigLit(hh.yel) || sigLit(hh.grn);
            if (!litOne) continue;
          }
          const dx = c.x - cam.x, dz = c.z - cam.z;
          let d2 = dx * dx + dz * dz;
          if (d2 > 90 * 90) continue;               // further than this, a real light adds nothing visible worth the cost
          // STREETLAMPS FIRST. A junction has eight signal heads within a
          // few metres of each other, so standing at one the nearest-eight
          // rule handed EVERY slot to a 0.55 signal glow and the cobra heads
          // lit nothing: the night street was black. A signal only wins a
          // slot over a lamp twice as far away, and at night it has to.
          if (c.kind === "signal") d2 *= nightSig;
          if (best.length < want) { best.push({ d2, c }); best.sort((p, q) => p.d2 - q.d2); }
          else if (d2 < best[want - 1].d2) { best[want - 1] = { d2, c }; best.sort((p, q) => p.d2 - q.d2); }
        }
        // streetlamp real-lights ride the SAME night ramp as their emissive
        // bulb material — a lamp pool light at full brightness at high noon
        // would look like a bug, not a feature. Traffic signals stay lit day
        // and night (real signals do too), so only the "lamp" kind is scaled.
        const nightK = Math.max(0, Math.min(1, (headLampM.emissiveIntensity - 0.05) / 0.95));
        for (let i = 0; i < pool.length; i++) {
          const slot = pool[i], pick = best[i];
          if (!pick) { slot.light.visible = false; slot.boundTo = null; continue; }
          slot.boundTo = pick.c;
          slot.light.position.set(pick.c.x, pick.c.y, pick.c.z);
          if (pick.c.kind === "signal") {
            slot.light.color.setHex(colorForHead(pick.c.head));
            slot.light.intensity = 0.55;
          } else {
            slot.light.color.setHex(0xffe0a0);
            // The old 0.85/16 m light was technically on but disappeared into
            // the city's bright ambient night. Keep the bounded eight-light
            // pool; give each selected cobra head enough reach to paint its
            // own patch of road after the global fill is removed.
            // The road under every head is painted by the additive light
            // pools now; this real light only has to reach what a decal
            // cannot (walls, cars, people), so it no longer doubles the pool.
            slot.light.intensity = (CBZ.CONFIG.CITY_STREET_REALISM_V1 !== false ? 2.2 : 0.85) * nightK;
          }
          slot.light.visible = slot.light.intensity > 0.01;
        }
      });
    }
    function colorForHead(h) {
      if (sigLit(h.red)) return 0xff3b3b;
      if (sigLit(h.yel)) return 0xffcf3b;
      if (sigLit(h.grn)) return 0x39ff66;
      return 0xffe0a0;
    }
  };
})();
