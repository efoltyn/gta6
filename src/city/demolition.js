/* ============================================================
   city/demolition.js — PERSISTENT BUILDING DESTRUCTION.

   Pound a building with enough ordnance and it comes DOWN — and then the
   city visibly heals: smoking rubble → cleared lot behind barriers →
   scaffolding → rebuilt, advancing on the in-game calendar
   (CBZ.paceTime, core/daynight.js's gameplay pace clock). No popups, no timers on
   the HUD: you learn the state of a lot by looking at it.

   Architecture (mirrors city/fracture.js, its wall-scale ancestor):
   - HP accumulates per building from every blast that funnels through
     CBZ.cityExplosion / cityAirstrikeExplosion (RPG, C4, grenades,
     cooking cars, helicopter crashes, airstrikes — one chokepoint,
     wrapped here exactly like buildings.js/armored.js already wrap it).
   - Collapse uses the U1 groundwork: CBZ.batchHideGroup zeroes the
     building's slices inside the shared merged buffers, the live group
     hides, colliders/platforms/LOS/doors/glass all unregister through
     the per-building mirrors makeBuilding now returns. Fully reversible.
   - Rubble is the building's own material (CBZ.debris.pile of its wall,
     floor plates and glass). The RECORD is still just {x, z, atDay}, and
     everything that matters to play (phase, calendar, the mound collider)
     is a pure function of it; the exact seating of the pieces is cosmetic
     and may differ between clients. Barriers/scaffold stay seeded by the
     lot's coordinates (CBZ.hashN).
   - Ledger records are coordinate-keyed (never array indices), serialize
     into the world save next to cityFracture's holes (net/netpersist.js
     already carries blob.demo), and expose onEvent/applyOne for the
     host-authoritative net relay (networld hooks in, frx-style).
   - CBZ.CONFIG.CITY_DEMOLITION gates everything; flip false and blasts
     behave exactly as before this file existed.

   EVERYTHING IS DESTRUCTIBLE, including the flagship mega-tower. Both of
   the old exemptions have been lifted: the hardcoded 11-storey ceiling
   (now CBZ.CONFIG.DEMO_MAX_STOREYS, 64) and the helipad/hangar refusal
   (now CBZ.CONFIG.DEMO_LANDMARKS — the tags are SUSPENDED while the lot
   is rubble and restored by the rebuild calendar, so losing your hangar
   is a consequence with an end date rather than a permanent broken
   state). Only `lot.kind === "park"` is still refused, because there is
   no building there to fell.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.CITY_DEMOLITION == null) CBZ.CONFIG.CITY_DEMOLITION = true;
  // Smooth the phase changes instead of snapping intact→rubble→cleared→
  // scaffold→rebuilt. Default ON; false = the byte-identical snap behaviour
  // that predates this feature (one-line revert, owner rule). See the
  // "transition FX" block below for WHY this is animated object-transform
  // interpolation and NOT r128 morph targets.
  if (CBZ.CONFIG.DEMO_MORPH_V1 == null) CBZ.CONFIG.DEMO_MORPH_V1 = true;

  // ---- tuning ------------------------------------------------------------
  // phases in in-game DAYS since collapse (PACE days: 150 real s each, CBZ.paceTime — the sky day is 48 min now)
  const T_CLEARED = 2.2;    // rubble sits smoking this long
  const T_SCAFFOLD = 4.2;   // then a cleared, barriered lot
  const T_REBUILT = 7.0;    // then scaffolding, then the building returns
  /* AN OWNER'S TEARDOWN IS NOT A WOUND. When the player's contractor knocks a
     building down on a lot he owns (city/plots.js), the city does not heal it:
     the rubble is carted off in a fraction of a day and the lot is left as a
     bare poured pad, HELD, for as long as he owns it. Selling the lot releases
     the hold and the ordinary calendar (cleared -> scaffold -> rebuilt) takes
     the parcel back. 0.12 day = 18 s real, enough to see the pile. */
  const T_HELD_CLEAR = 0.12;
  // Storey ceiling above which a building is immune to collapse. This used to
  // be a hardcoded 11, which made the city's TALLEST buildings — the ones you
  // actually want to fly a plane into — the only ones that could never fall.
  // That was a proxy for "landmark", but landmarks are already identified
  // explicitly by the helipad/hangar test below, so the proxy only cost us the
  // spectacle. Default is now effectively "no storey ceiling"; set
  // ?cfg_DEMO_MAX_STOREYS=11 to restore the old behaviour in one line.
  // NOTE: this makes tall buildings ELIGIBLE, not easy — hpMax() still scales
  // with storeys, so a 12-storey block needs ~18 damage (an airliner crash
  // currently delivers ~3.2). Kinetic impact damage is the other half.
  if (CBZ.CONFIG.DEMO_MAX_STOREYS == null) CBZ.CONFIG.DEMO_MAX_STOREYS = 64;
  /* READ LIVE, NOT LATCHED — this used to be `const MAX_STOREYS =
     CBZ.CONFIG.DEMO_MAX_STOREYS`, a LOAD-TIME COPY, while city/structural.js's
     mirror of this very gate (its `maxCollapseStoreys()`, structural.js:318-324)
     reads the config on every call and its comment states the contract as a
     fact: "Read the SAME config value, live, every call — not a load-time copy
     ... so the two can never drift again". Half of that mirror was a lie.
     Raise DEMO_MAX_STOREYS at runtime (a debug poke, a mission script, a
     `?cfg_` applied after this file parsed) and structural.js would start
     condemning towers this file still refuses: structural batch-hides the
     building, hands the lot to destroy(), destroy() returns false at
     eligible() — and the block is left as a permanently INVISIBLE, NON-SOLID
     hole with no rubble pile and no rebuild calendar. That is the exact
     failure the mirror exists to prevent, so this reader is now shaped
     identically to structural.js's, down to the 64 fallback. No flag: this
     aligns the code to its own already-documented invariant. */
  function maxStoreys() {
    const v = CBZ.CONFIG.DEMO_MAX_STOREYS;
    return (typeof v === "number" && v > 0) ? v : 64;
  }
  /* DEMO_FAST_PURGE — unregister a building's members from the city-sized
     shared arrays in ONE compaction pass instead of indexOf+splice per member.
     Measured at seed 90210 (329 lots, CBZ.colliders.length = 123,332): ONE
     destroy() of the 52-storey flagship (831 colliders + 2,152 window panes)
     took 432.9 ms; destroying all 328 lots took 5,679 ms — and a nuke pays it
     PER CONDEMNED BUILDING PER FRAME through structural.js's finishCollapse,
     at the worst possible case, because structural.js's hideReal() has already
     purged those colliders so every indexOf runs the full 123k length and
     misses. The one-pass primitive already exists in the sibling file
     (structural.js's `purge`, written for this exact case and measured at
     6.2 ms vs 36.9 ms on 3,000 removals); it is published as
     CBZ.structuralPurge and REUSED here, never copied (Block Law).
     false = the byte-identical indexOf/splice loops that predate this, kept
     verbatim below (one-line revert, owner rule). The fast path also degrades
     to them automatically whenever CBZ.structuralPurge is absent — index.html
     loads THIS file (862) before structural.js (1133), so the primitive is
     resolved lazily INSIDE each function, never captured at module scope. */
  if (CBZ.CONFIG.DEMO_FAST_PURGE == null) CBZ.CONFIG.DEMO_FAST_PURGE = true;
  /* DEMO_LOAD_V1 — the load path. D.apply() ran a full destroy() per row
     synchronously: measured 2,063 ms for a 328-row blob, no budget, no
     yielding, inside net/netpersist.js's applyWorld. Three fixes ride this
     flag: (a) ONE purge pass per shared array for the WHOLE blob instead of
     one per row, (b) the healed-check now reads the RESTORED clock (see
     netpersist.js's own comment at the w.demo line), and (c) single-player
     saves carry the ledger at all — see the SP PERSISTENCE block at the foot
     of this file. false = the old per-row path, verbatim, and no SP section.  */
  if (CBZ.CONFIG.DEMO_LOAD_V1 == null) CBZ.CONFIG.DEMO_LOAD_V1 = true;
  // ~3 rockets for a small shop, ~5-6 for a fat 4-storey block (RPG power 1.9)
  function hpMax(b) { return 2 + b.storeys * 1.2 + (b.w * b.d) / 300; }

  /* The shared one-pass compaction, resolved AT CALL TIME (see DEMO_FAST_PURGE
     above for why it can never be captured at module scope). Returns null when
     the flag is off or structural.js is not loaded — every caller treats null
     as "take the legacy loop", which is the degrade-safe contract. */
  function fastPurge() {
    return CBZ.CONFIG.DEMO_FAST_PURGE ? (CBZ.structuralPurge || null) : null;
  }

  const ledger = new Map();      // key "x,z" -> rec
  const hp = new Map();          // lot -> accumulated blast damage (session-local)
  const D = CBZ.cityDemolition = { onEvent: null };

  function keyOf(lot) { return Math.round(lot.cx) + "," + Math.round(lot.cz); }
  function arena() { return CBZ.city && (CBZ.city.arena || CBZ.city); }

  /* DEMO_LANDMARKS — "planes affecting buildings correctly when hitting them".
     The storey ceiling was raised to 64 so tall buildings could come down, and
     the very next line still refused anything with a helipad or a hangar. That
     is not an edge case: `buildings.js` stamps BOTH tags on the 52-storey
     mega-tower (`makeMegaTower` sets `hangar`, the worldgen post-pass adds
     `helipad`), so the single most conspicuous building in the game — the one
     a player flies at precisely because it is the tallest thing on the skyline
     — was still exempt. The headline read backwards: the low-rises around it
     would pancake and the tower he aimed at would burn forever.

     WHY THE EXEMPTION EXISTED, and why it is safe to lift: those tags are the
     player's own aviation infrastructure. `playeraircraft.js` and `phone.js`
     resolve "where does my jet/helicopter appear" through
     `CBZ.cityMegaTower()` and read `t.hangar` / `t.helipad`. Deleting the
     building without touching them would spawn an F-22 in mid-air over a
     rubble pile. But every one of those readers ALREADY guards on the tag
     being present (`if (!s || !s.hangar) …`), so the correct move is not to
     protect the building — it is to SUSPEND the tags while it is rubble and
     restore them when demolition's own rebuild calendar puts it back. Flying
     a plane into your own hangar should cost you the hangar, and then, a few
     in-game days later, give it back. That is a consequence, which is the
     whole point of the feature.

     Flip false (or `?cfg_DEMO_LANDMARKS=0`) to restore the old exemption. */
  if (CBZ.CONFIG.DEMO_LANDMARKS == null) CBZ.CONFIG.DEMO_LANDMARKS = true;

  function eligible(lot) {
    const b = lot && lot.building;
    if (!b || !b.group || !b.colliders || !b.colliders.length) return false;
    if (b.storeys > maxStoreys()) return false;              // landmark tier (live read — see maxStoreys)
    if (!CBZ.CONFIG.DEMO_LANDMARKS && (b.helipad || b.hangar)) return false;
    if (lot.kind === "park") return false;
    return true;
  }

  /* Suspend / restore the aviation tags across a teardown. Stashed on the
     building itself so a save/load or a net replay that recreates the ledger
     rec cannot lose them, and idempotent in both directions so a double
     destroy or a double rebuild is harmless. */
  function suspendAir(b) {
    if (!b || b._demoAir) return;
    if (!b.helipad && !b.hangar) return;
    b._demoAir = { helipad: b.helipad || null, hangar: b.hangar || null };
    b.helipad = null; b.hangar = null;
  }
  function restoreAir(b) {
    if (!b || !b._demoAir) return;
    if (b._demoAir.helipad) b.helipad = b._demoAir.helipad;
    if (b._demoAir.hangar) b.hangar = b._demoAir.hangar;
    b._demoAir = null;
  }

  // ---- deterministic rubble / phase prop builders --------------------------
  // All geometry derives from CBZ.hashN(lotX, lotZ, salt) — same pile on every
  // client, every reload, from a ledger record that is only {x, z, at}.
  function lotRng(lot, salt) {
    let s = CBZ.hashN ? CBZ.hashN(Math.round(lot.cx), Math.round(lot.cz), salt) : ((lot.cx * 73856093) ^ (lot.cz * 19349663)) >>> 0;
    return function () {              // mulberry32, seeded off the position hash
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const mat = (col) => (CBZ.cmat ? CBZ.cmat(col) : new THREE.MeshLambertMaterial({ color: col }));
  // Detailed rubble is deliberately scarce. A nuclear collapse can put every
  // lot in the city on this ledger. The first RUBBLE_DETAIL_CAP piles
  // (structural.js drains nearest-first) are full mounds; the rest are a low
  // scatter of the same stuff. Either way the pieces are CBZ.debris rubble:
  // frozen into one merged draw per material per 16 m cell, not a mesh each.
  const RUBBLE_DETAIL_CAP = 32;
  function box(g, x, y, z, w, h, d, col, ry) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(col));
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    m.castShadow = false; m.receiveShadow = true;
    g.add(m);
    return m;
  }

  /* THE PILE IS THE BUILDING. This used to be 14-21 `new THREE.BoxGeometry`
     slabs in four concrete greys and two leaning grey "wall shards" — a
     quarry of cubes that had never looked at the building it replaced.
     Now it is CBZ.debris.pile of the building's OWN materials (its wall, its
     floor plates, its glass, read off its solids by collapse.materialsOf):
     blocks of that stuff fractured exactly the way a shatter cuts, seated
     biggest-first on the ground and on the pieces the collapse already
     threw, and frozen solid (you climb it). Owned by the lot key, which is
     also the key the collapse's own pieces carry: leaving the rubble phase
     carts both off together (see disposeGroup / clearPhaseProps). */
  function rubbleMats(b) {
    let r = null;
    try { r = CBZ.collapse && CBZ.collapse.materialsOf ? CBZ.collapse.materialsOf(b) : null; } catch (e) {}
    const wall = (r && r.wall) || mat(b.wallColor != null ? b.wallColor : 0x8b8f94);
    const list = [{ material: wall, weight: 3 }];
    if (r && r.slab && r.slab !== wall) list.push({ material: r.slab, kind: "concrete", weight: 2 });
    if (r && r.glass) list.push({ material: r.glass, kind: "glass", weight: 0.6 });
    return list;
  }
  function buildRubble(rec) {
    const lot = rec.lot, b = lot.building, g = new THREE.Group();
    const W = Math.max(2, b.w - 1.2), Dp = Math.max(2, b.d - 1.2);
    const peak = Math.min(3.6, 1.0 + b.storeys * 0.35);
    // The tier LATCHES here, at build time, and is deliberately never
    // retrofitted: rebuilding a pile under the player to chase a budget is a
    // worse bug than an under-detailed one.
    const detailed = ledger.size <= RUBBLE_DETAIL_CAP;
    rec.rubbleDetailed = detailed;
    if (CBZ.debris) {
      try {
        CBZ.debris.pile({
          x: b.ox, z: b.oz, w: W, d: Dp, h: detailed ? peak : Math.min(1.4, peak * 0.45),
          materials: rubbleMats(b), owner: rec.k, solid: true,
          count: detailed ? Math.round(Math.min(110, 20 + W * Dp * 0.2)) : 12,
        });
      } catch (e) {}
    }
    g.userData.debrisOwner = rec.k;
    g.userData.debrisLot = { x: b.ox, z: b.oz, r: Math.max(b.w, b.d) * 0.6 };
    // one central mound collider: you clamber AROUND a fresh collapse
    const c = { minX: b.ox - W * 0.3, maxX: b.ox + W * 0.3, minZ: b.oz - Dp * 0.3, maxZ: b.oz + Dp * 0.3, y0: 0, y1: Math.max(0.9, peak * 0.55) };
    return { group: g, cols: [c] };
  }

  function buildCleared(rec) {
    const lot = rec.lot, b = lot.building, g = new THREE.Group();
    const rng = lotRng(lot, 0xc1ea);
    // graded gravel pad where the pile was
    box(g, b.ox, 0.06, b.oz, b.w - 0.8, 0.12, b.d - 0.8, 0x54585c);
    // orange/white construction barriers around the perimeter
    const bw = 2.2, hw = b.w / 2 - 0.6, hd = b.d / 2 - 0.6;
    for (let s = 0; s < 4; s++) {
      const horiz = s < 2, sign = s % 2 ? 1 : -1;
      const span = (horiz ? b.w : b.d) - 1.2;
      const nSeg = Math.max(2, Math.round(span / (bw + 1.6)));
      for (let i = 0; i < nSeg; i++) {
        const t = -span / 2 + (i + 0.5) * (span / nSeg) + (rng() - 0.5) * 0.4;
        const x = horiz ? b.ox + t : b.ox + sign * hw;
        const z = horiz ? b.oz + sign * hd : b.oz + t;
        box(g, x, 0.55, z, horiz ? bw : 0.14, 0.7, horiz ? 0.14 : bw, i % 2 ? 0xd2691e : 0xe8e4da, 0);
      }
    }
    return { group: g, cols: [] };
  }

  /* PHASE 4, THE HELD PAD: the rubble is gone and what is left is the lot an
     owner builds on. Poured concrete over the whole footprint, saw-cut control
     joints on a 3 m module (the same module the build grid snaps to, so a
     foundation or a wall reads as SET on the slab), a darker cure stain at the
     edges. No colliders: it is ground, and the build gate reads live
     colliders, so nothing here may block a piece. */
  let _padMat = null;
  function padMaterial() {
    if (_padMat) return _padMat;
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g2 = c.getContext("2d");
    g2.fillStyle = "#9a9d9f"; g2.fillRect(0, 0, 256, 256);
    // aggregate speckle + trowel mottling (deterministic arithmetic, no rng)
    for (let i = 0; i < 2600; i++) {
      const x = (i * 97) % 256, y = (i * 61 + ((i * 13) % 17)) % 256;
      const v = 128 + ((i * 53) % 60) - 30;
      g2.fillStyle = "rgba(" + v + "," + v + "," + (v + 2) + ",0.22)";
      g2.fillRect(x, y, 1 + (i % 3 === 0 ? 1 : 0), 1);
    }
    for (let i = 0; i < 26; i++) {
      const x = (i * 71) % 256, y = (i * 113) % 256, r = 18 + (i * 7) % 30;
      const gr = g2.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, i % 2 ? "rgba(70,72,74,0.10)" : "rgba(200,200,196,0.08)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      g2.fillStyle = gr; g2.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // one saw-cut joint at the tile edge: the tile repeats every 3 m
    g2.fillStyle = "rgba(58,60,62,0.75)"; g2.fillRect(0, 0, 256, 2); g2.fillRect(0, 0, 2, 256);
    g2.fillStyle = "rgba(210,210,206,0.35)"; g2.fillRect(0, 2, 256, 1); g2.fillRect(2, 0, 1, 256);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    _padMat = new THREE.MeshLambertMaterial({ map: t });
    _padMat._shared = true;
    return _padMat;
  }
  function buildPad(rec) {
    const lot = rec.lot, b = lot.building, g = new THREE.Group();
    const W = Math.max(2, b.w + 0.6), Dd = Math.max(2, b.d + 0.6);
    const geo = new THREE.BoxGeometry(W, 0.1, Dd);
    // UVs in metres / 3 so one joint tile == one 3 m build cell on the top face
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + b.ox) / 3, (pos.getZ(i) + b.oz) / 3);
    uv.needsUpdate = true;
    const m = new THREE.Mesh(geo, padMaterial());
    m.position.set(b.ox, 0.075, b.oz);
    m.receiveShadow = true; m.castShadow = false;
    g.add(m);
    // a thin darker curb band where the slab meets the yard, so the pad reads as poured, not painted
    const edge = mat(0x6f7274);
    box(g, b.ox, 0.06, b.oz - Dd / 2, W + 0.2, 0.12, 0.18, edge);
    box(g, b.ox, 0.06, b.oz + Dd / 2, W + 0.2, 0.12, 0.18, edge);
    box(g, b.ox - W / 2, 0.06, b.oz, 0.18, 0.12, Dd, edge);
    box(g, b.ox + W / 2, 0.06, b.oz, 0.18, 0.12, Dd, edge);
    return { group: g, cols: [] };
  }

  function buildScaffold(rec) {
    const lot = rec.lot, b = lot.building, g = new THREE.Group();
    const H = Math.min(b.h * 0.75, b.FH * 3.2);                // frame climbs partway up
    const hw = b.w / 2 - 0.5, hd = b.d / 2 - 0.5;
    const POLE = 0x8a8577, PLANK = 0xa88c5f;
    // Perimeter standards + ledgers + plank decks + one diagonal brace per
    // face. MEMBER SIZES ARE VISUAL LOAD-BEARING: at street distance under
    // low-res AA a 0.14u pole disappears and the plank lines read as a
    // FLOATING roof frame (user-filmed). 0.32u posts + 0.2u ledger rails
    // directly under every deck keep the frame visibly CONNECTED to the
    // ground from any range this can be seen at.
    for (let s = 0; s < 4; s++) {
      const horiz = s < 2, sign = s % 2 ? 1 : -1;
      const span = (horiz ? hw : hd) * 2;
      const nP = Math.max(3, Math.round(span / 3.0) + 1);
      for (let i = 0; i < nP; i++) {
        const t = -span / 2 + i * (span / (nP - 1));
        const x = horiz ? b.ox + t : b.ox + sign * hw;
        const z = horiz ? b.oz + sign * hd : b.oz + t;
        box(g, x, H / 2, z, 0.32, H, 0.32, POLE);              // standard (corner posts fall out of i=0/nP-1)
      }
      for (let y = b.FH; y <= H - 0.3; y += b.FH) {
        const x = horiz ? b.ox : b.ox + sign * hw;
        const z = horiz ? b.oz + sign * hd : b.oz;
        box(g, x, y - 0.16, z, horiz ? span : 0.2, 0.2, horiz ? 0.2 : span, POLE);   // ledger rail under the deck
        box(g, x, y, z, horiz ? span : 1.0, 0.14, horiz ? 1.0 : span, PLANK);        // plank deck
      }
      // top cap rail ties the pole heads together (no orphan pole tips)
      box(g, horiz ? b.ox : b.ox + sign * hw, H - 0.1, horiz ? b.oz + sign * hd : b.oz,
        horiz ? span + 0.32 : 0.24, 0.2, horiz ? 0.24 : span + 0.32, POLE);
      // one full-face diagonal brace — the single strongest "scaffold, not
      // railing" cue a construction frame has
      const bl = Math.hypot(span * 0.92, H * 0.92);
      const brace = box(g, horiz ? b.ox : b.ox + sign * hw, H / 2, horiz ? b.oz + sign * hd : b.oz, 0.16, bl, 0.16, POLE);
      if (horiz) brace.rotation.z = Math.atan2(span * 0.92, H * 0.92) * (sign === 1 ? 1 : -1);
      else brace.rotation.x = Math.atan2(span * 0.92, H * 0.92) * (sign === 1 ? -1 : 1);
    }
    // the rising CORE: a plain concrete storey-or-two inside the frame —
    // the diegetic "they're getting somewhere" beat before the reveal
    box(g, b.ox, b.FH * 0.5, b.oz, b.w - 2.4, b.FH, b.d - 2.4, 0x6a6e72);
    const cols = [{ minX: b.ox - (b.w - 2.4) / 2, maxX: b.ox + (b.w - 2.4) / 2, minZ: b.oz - (b.d - 2.4) / 2, maxZ: b.oz + (b.d - 2.4) / 2, y0: 0, y1: b.FH }];
    return { group: g, cols: [] , solids: cols };
  }

  // ---- phase transitions ---------------------------------------------------
  // The rubble phase's pieces live in CBZ.debris under the lot key; the
  // group that stood for them carries that key, so whenever that group goes
  // (snap, exit tween, rebuild, reset) the pile goes with it.
  function cartOff(g) {
    const k = g && g.userData && g.userData.debrisOwner;
    if (k == null || !CBZ.debris) return;
    try { CBZ.debris.clear(k); } catch (e) {}
    // the footprint too (clearNear also lowers the rubble height-field, so the
    // next pile on this lot starts from the ground, not from phantom rubble)
    const L = g.userData.debrisLot;
    if (L && CBZ.debris.clearNear) { try { CBZ.debris.clearNear(L.x, L.z, L.r); } catch (e) {} }
  }
  function clearPhaseProps(rec) {
    if (rec.propGroup) {
      cartOff(rec.propGroup);
      const A = arena();
      if (A && A.root) A.root.remove(rec.propGroup);
      rec.propGroup.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
      rec.propGroup = null;
    }
    releasePropCols(rec);
  }
  // colliders only (leave rec.propGroup ALIVE — the animated path keeps the
  // retiring group in the scene for its exit tween while its physics is already
  // gone: a lot that's mid-clear no longer blocks you).
  function releasePropCols(rec) {
    if (rec.propCols && rec.propCols.length) {
      // Same disease, same cure as destroy() (DEMO_FAST_PURGE). A phase group
      // only ever registers 0-2 colliders, so the win per call is small — but
      // this runs on EVERY phase change of EVERY record, i.e. ~4 times per lot
      // over a 328-lot nuke's rebuild arc, each one previously a full 123k
      // indexOf + a 123k memmove. One compaction pass replaces both, and the
      // shape is now identical to destroy()'s so there is one idiom to read.
      const purge = fastPurge();
      if (purge) purge(CBZ.colliders, new Set(rec.propCols));
      else for (const c of rec.propCols) { const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1); }
      rec.propCols = [];
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
  }

  // ========================================================================
  //  TRANSITION FX (CBZ.CONFIG.DEMO_MORPH_V1) — smooth the phase changes.
  //
  //  Technique = ANIMATED OBJECT-TRANSFORM interpolation (the mission's
  //  "dissolve": scale/position tween of the whole phase group), NOT r128
  //  morph targets. That choice is grounded in what this file/engine really do:
  //   • phase boxes render through CBZ.cmat SHARED cached Lambert materials —
  //     flipping material.morphTargets=true (r128 needs the flag) mutates a
  //     material other city meshes share (shader recompile + look bleed); the
  //     reference "one merged geometry per state" also needs morph-enabled mats.
  //   • the FLOATING-GEOMETRY gate asserts support PER MESH
  //     (g.traverse(o=>o.isMesh) → Box3 each). One merged morph mesh = ONE Box3
  //     = the whole footprint = trivially "grounded" → the invariant is gutted
  //     though its code is untouched. Per-box meshes keep it meaningful.
  //   • r128 Box3.expandByObject reads geometry.boundingBox (the BASE position
  //     attribute) and applies matrixWorld — it NEVER applies morph deformation
  //     (no `precise` path in r128). So a morph-grown member is INVISIBLE to that
  //     very invariant, but a scale/position tween IS baked through matrixWorld —
  //     settled states are judged on exactly what renders.
  //   • the three phases have different topology AND box counts (rubble ~16-24
  //     tilted slabs / cleared ~9-17 pad+barriers / scaffold ~40-60 members) —
  //     no honest vertex correspondence to morph across.
  //  Every transform is GROUND-ANCHORED (pivot y=0) so a box BOTTOM never lifts
  //  off the ground mid-grow, and every settled state is reset to identity →
  //  byte-identical to the snap build. The tween is pure local FX: no seeded
  //  draws, nothing networked (world state — ledger/colliders/visibility —
  //  still changes at transition START exactly as before).
  const DUR = 1.2;                 // seconds per phase change (real wall-clock)
  const tweens = [];
  let _paused = false, _lastNow = 0;
  function liveCity() {
    return !!CBZ.CONFIG.DEMO_MORPH_V1 && CBZ.game && CBZ.game.mode === "city" && CBZ.game.state === "playing";
  }
  function ease(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function disposeGroup(g) {
    if (!g) return;
    cartOff(g);
    if (g.parent) g.parent.remove(g);
    g.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  }
  // presence p∈[0,1]: 1 = fully built at rest, 0 = gone. "flat" is the rubble
  // read (sink flat + shrink footprint toward the lot centre); "v" is the plain
  // ground-anchored vertical grow/retract everything else uses.
  function applyPresence(group, mode, p, pivot) {
    const sy = p < 1e-3 ? 1e-3 : p;               // never a zero-scale matrix (NaN normals)
    if (mode === "flat") {
      const s = 0.4 + 0.6 * p;
      group.scale.set(s, sy, s);
      group.position.set(pivot.x * (1 - s), 0, pivot.z * (1 - s));
    } else {
      group.scale.set(1, sy, 1);
      group.position.set(0, 0, 0);
    }
  }
  function applyTween(tw) {
    const e = ease(tw.t);
    if (tw.inGroup) applyPresence(tw.inGroup, tw.inMode, e, tw.pivot);
    if (tw.outGroup) applyPresence(tw.outGroup, tw.outMode, 1 - e, tw.pivot);
  }
  function finalizeTween(tw) {
    if (tw.inGroup) { tw.inGroup.scale.set(1, 1, 1); tw.inGroup.position.set(0, 0, 0); }  // exact identity → settled == snap build
    if (tw.outGroup) disposeGroup(tw.outGroup);
    if (tw.rec && tw.rec._tw === tw) tw.rec._tw = null;
  }
  function finishTweenFor(rec) {                  // settle a rec's in-flight tween NOW (re-entrancy / skip-ahead)
    const tw = rec && rec._tw;
    if (!tw) return;
    const i = tweens.indexOf(tw); if (i >= 0) tweens.splice(i, 1);
    finalizeTween(tw);
  }
  function killAllTweens() {
    for (const tw of tweens) finalizeTween(tw);
    tweens.length = 0; _lastNow = 0;
  }
  // Advance by REAL wall-clock (CBZ.now = performance.now, set each frame in
  // core/loop.js) so a 1.2s tween finishes in 1.2s of real time even when the
  // headless world dt is clamped/slowed — the gate's real-time sleeps settle it.
  // dtOverride lets the check step deterministically.
  function stepTweens(dtOverride) {
    if (!tweens.length) return;
    let dt;
    if (dtOverride != null) dt = dtOverride;
    else {
      if (_paused) return;
      const now = CBZ.now != null ? CBZ.now : (typeof performance !== "undefined" ? performance.now() : Date.now());
      if (!_lastNow) _lastNow = now;
      dt = (now - _lastNow) / 1000; _lastNow = now;
      dt = dt < 0 ? 0 : dt > 0.25 ? 0.25 : dt;    // spike-cap
    }
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt / tw.dur;
      if (tw.t >= 1) { tw.t = 1; finalizeTween(tw); tweens.splice(i, 1); }
      else applyTween(tw);
    }
  }
  function startTween(o) {
    const outGroup = o.outGroup || null, inGroup = o.inGroup || null;
    if (!outGroup && !inGroup) return;
    const b = o.building;                         // pivot the horizontal scale on the lot centre, not the world origin
    if (!tweens.length) _lastNow = 0;             // fresh clock for a fresh run
    const tw = { rec: o.rec || null, t: 0, dur: DUR, from: o.from, to: o.to,
      inGroup: inGroup, outGroup: outGroup, inMode: "v", outMode: o.outMode || "v",
      pivot: { x: b.ox, z: b.oz } };
    if (tw.rec) tw.rec._tw = tw;
    tweens.push(tw);
    applyTween(tw);                               // stamp the t=0 pose
  }

  // phase-pair choreography (which group animates how) — see the report:
  //   1→2 rubble→cleared : rubble sinks flat + shrinks away, cleared rises
  //   2→3 cleared→scaffold: barriers retract, scaffold frame+core rise
  //   3→rebuilt          : scaffold retracts, revealing the finished building
  //   0→x  (collapse / save-load): SNAP — the explosion FX sells the collapse,
  //        and a load must not animate.
  function setPhase(rec, phase) {
    if (rec.phase === phase) return;
    const anim = liveCity() && rec.phase !== 0;
    if (anim) finishTweenFor(rec);                // settle any in-flight tween → propGroup is the current settled group
    const fromPhase = rec.phase;
    const oldGroup = rec.propGroup;
    if (anim) { releasePropCols(rec); rec.propGroup = null; }  // keep oldGroup alive for its exit tween
    else clearPhaseProps(rec);
    rec.phase = phase;
    const A = arena();
    if (!A || !A.root) { if (anim && oldGroup) disposeGroup(oldGroup); return; }
    if (phase === 4 && CBZ.collapse && CBZ.collapse.clearNear) {
      const bb = rec.lot.building;
      try { CBZ.collapse.clearNear(bb.ox, bb.oz, Math.max(bb.w, bb.d) * 0.72); } catch (e) {}
    }
    const built = phase === 1 ? buildRubble(rec) : phase === 2 ? buildCleared(rec) : phase === 3 ? buildScaffold(rec) : phase === 4 ? buildPad(rec) : null;
    if (built) {
      A.root.add(built.group);
      rec.propGroup = built.group;
      rec.propCols = built.cols.concat(built.solids || []);
      for (const c of rec.propCols) CBZ.colliders.push(c);
      if (rec.propCols.length && CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    if (anim && (oldGroup || built)) {
      startTween({
        rec: rec, building: rec.lot.building, from: fromPhase, to: phase,
        outGroup: oldGroup, inGroup: built ? built.group : null,
        outMode: fromPhase === 1 ? "flat" : "v",    // rubble is the only pile-shaped phase
      });
    }
  }

  // ========================================================================
  //  SHARED-ARRAY BOOKKEEPING (DEMO_FAST_PURGE / DEMO_LOAD_V1).
  //
  //  Both directions of a teardown touch the three city-sized arrays every
  //  system on the map holds a reference to — CBZ.colliders (123,332 entries
  //  at seed 90210), CBZ.platforms, CBZ.losBlockers — and both used to do it
  //  one member at a time with indexOf. Two spans exist so the O(city) cost is
  //  paid ONCE per event instead of once per member and once per lot:
  //
  //    _dbatch   REMOVAL span. destroy() collects into shared Sets and the
  //              span owner runs one purge per array at the end. Opened by
  //              D.apply() so loading a 328-row save blob costs
  //              O(colliders + members), not O(rows x colliders).
  //    _reSets   RE-SEAT span. rebuild()'s "is this already registered?" test
  //              was `indexOf(...) === -1`; it is now a membership Set built
  //              once. A BULK rebuild (D.reset(), or a whole healed district
  //              draining in one tick) shares one set of Sets across every
  //              record, so the Set construction is paid once too.
  //
  //  Both are plain module state, both are opened and closed synchronously by
  //  the function that owns the span, and both degrade to nothing: with the
  //  flag off — or with structural.js simply not loaded, so CBZ.structuralPurge
  //  is undefined — every caller falls through to its original loop verbatim.
  // ========================================================================
  let _dbatch = null;                 // {cols,plats,los} Sets — open removal span
  let _reSets = null;                 // {cols,plats,los} Sets — open re-seat span
  function reSetsBegin() {
    if (_reSets) return false;        // already inside somebody else's span
    _reSets = {
      cols: new Set(CBZ.colliders || []),
      plats: new Set(CBZ.platforms || []),
      los: new Set(CBZ.losBlockers || []),
    };
    return true;                      // caller owns this span and must end it
  }
  function reSetsEnd(owned) { if (owned) _reSets = null; }
  // Push `v` onto `arr` unless it is already there. Inside a span the answer
  // comes from the Set (O(1)); outside one it is the original indexOf scan.
  // NOTE the deliberate staleness allowance: releasePropCols() removes phase-
  // prop colliders from CBZ.colliders during a bulk rebuild, leaving those
  // objects present-but-gone in `_reSets.cols`. Harmless by construction —
  // nothing ever re-seats a phase-prop collider through this helper, and the
  // ARRAY, never the Set, is the truth.
  function seat(arr, set, v) {
    if (!arr || v == null) return;
    if (set) { if (!set.has(v)) { arr.push(v); set.add(v); } return; }
    if (arr.indexOf(v) === -1) arr.push(v);
  }

  // ---- collapse / rebuild --------------------------------------------------
  function destroy(lot, opts) {
    opts = opts || {};
    if (!CBZ.CONFIG.CITY_DEMOLITION) return false;
    if (!eligible(lot) || ledger.has(keyOf(lot))) return false;
    const b = lot.building;

    // 1) the batched shell: merged copies off, shared-buffer slices zeroed
    if (CBZ.batchHideGroup) CBZ.batchHideGroup(b.group);
    b.group.visible = false;
    const purge = fastPurge();
    if (purge) {
      /* ---- FAST PATH (DEMO_FAST_PURGE) --------------------------------------
         Collect EVERY member this building is giving up into three Sets first,
         then compact each shared array exactly once. This is the same code
         structural.js's hideReal() already runs — deliberately, so the two
         teardown paths a nuke alternates between behave identically.
         Inside an open removal span (_dbatch, opened by D.apply for a whole
         save blob) we contribute to the span's Sets and let the SPAN OWNER do
         the compaction, which is what turns a 328-row load from
         O(rows x colliders) into O(colliders + members). */
      const bt = _dbatch;
      const deadCols = bt ? bt.cols : new Set();
      const deadPlats = bt ? bt.plats : new Set();
      const deadLos = bt ? bt.los : new Set();
      for (const gp of b.windows || []) {
        if (gp.shattered) continue;
        gp.shattered = true;
        if (gp.mesh) gp.mesh.visible = false;
        else if (CBZ._paneShow) CBZ._paneShow(gp, false);
        if (gp.col) deadCols.add(gp.col);
      }
      for (const c of b.colliders) deadCols.add(c);
      for (const p of b.platforms || []) deadPlats.add(p);
      for (const m of b.losMeshes || []) deadLos.add(m);
      for (const dr of b.doors || []) {
        dr.demolished = true;
        if (dr.colIn) { deadCols.add(dr.col); dr.colIn = false; }
      }
      if (!bt) {
        purge(CBZ.colliders, deadCols);
        purge(CBZ.platforms, deadPlats);
        purge(CBZ.losBlockers, deadLos);
      }
    } else {
      // ---- LEGACY PATH (flag off, or structural.js not loaded) — verbatim ----
      // 2) glass out of the instanced pools (+ solid panes' meshes/colliders)
      for (const gp of b.windows || []) {
        if (gp.shattered) continue;
        gp.shattered = true;
        if (gp.mesh) gp.mesh.visible = false;
        else if (CBZ._paneShow) CBZ._paneShow(gp, false);
        if (gp.col) { const i = CBZ.colliders.indexOf(gp.col); if (i >= 0) CBZ.colliders.splice(i, 1); }
      }
      // 3) physics + vision: this building no longer blocks anything
      for (const c of b.colliders) { const i = CBZ.colliders.indexOf(c); if (i >= 0) CBZ.colliders.splice(i, 1); }
      for (const p of b.platforms || []) { const i = CBZ.platforms.indexOf(p); if (i >= 0) CBZ.platforms.splice(i, 1); }
      for (const m of b.losMeshes || []) { const i = CBZ.losBlockers.indexOf(m); if (i >= 0) CBZ.losBlockers.splice(i, 1); }
      for (const dr of b.doors || []) {
        dr.demolished = true;
        if (dr.colIn) { const i = CBZ.colliders.indexOf(dr.col); if (i >= 0) CBZ.colliders.splice(i, 1); dr.colIn = false; }
      }
    }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    // 4) the lot's obligations pause while it's a hole in the ground
    lot.demolished = true;
    if (CBZ.stairs) CBZ.stairs.setOwnerActive(b, false);   // no AI routes up a building that is rubble
    suspendAir(b);             // the pad/hangar go with the building (see DEMO_LANDMARKS)
    if (b.home) { b.home._demoListed = b.home.listed; b.home.listed = false; }

    const rec = {
      k: keyOf(lot), lot, at: opts.at != null ? opts.at : (CBZ.paceTime ? CBZ.paceTime() : 0),
      phase: 0, propGroup: null, propCols: [], rubbleDetailed: false,
      held: !!(opts.held || lot._plotHold),
    };
    if (rec.held) lot._plotHold = true;
    ledger.set(rec.k, rec);
    setPhase(rec, phaseFor(rec));

    // 5) collapse FX at the moment it happens (skipped for save/net replays)
    if (!opts.quiet) {
      try {
        if (CBZ.cityScorch) CBZ.cityScorch(b.ox, b.oz, Math.max(b.w, b.d) * 0.55);
        if (CBZ.cityChunk) {
          // chips of THIS building's wall, in its colour
          const wm = rubbleMats(b)[0].material;
          CBZ.cityChunk(b.ox, 1.2, b.oz, { count: 26, force: 9, material: wm });
          CBZ.cityChunk(b.ox - b.w * 0.3, b.h * 0.4, b.oz, { count: 12, force: 7, material: wm });
          CBZ.cityChunk(b.ox + b.w * 0.3, b.h * 0.4, b.oz, { count: 12, force: 7, material: wm });
        }
        // "boom" is NOT in systems/audio.js's BANK — it silently no-ops with a
        // console warning. The bank has the exact cue this beat wants.
        if (CBZ.sfx) CBZ.sfx("collapse");
      } catch (e) {}
    }
    if (typeof D.onEvent === "function" && !opts.silent) try { D.onEvent({ t: "destroy", x: Math.round(lot.cx), z: Math.round(lot.cz), at: rec.at }); } catch (e) {}
    return true;
  }

  function rebuild(rec, opts) {
    opts = opts || {};
    const lot = rec.lot, b = lot.building;
    // A natural rebuild (ticker at T_REBUILT) reveals the finished building at
    // once via batchShowGroup and lets the scaffold RETRACT into the ground over
    // DUR, uncovering it. Save/net/reset rebuilds (silent/quiet) stay instant.
    const anim = liveCity() && !opts.silent && !opts.quiet;
    if (rec._tw) finishTweenFor(rec);
    let retire = null;
    if (anim && rec.propGroup) { retire = rec.propGroup; releasePropCols(rec); rec.propGroup = null; }
    else clearPhaseProps(rec);
    ledger.delete(rec.k);
    hp.delete(lot);
    // any piece of the old building still lying on the lot goes before it stands again
    if (CBZ.debris) { try { CBZ.debris.clear(rec.k); } catch (e) {} }
    lot.demolished = false;
    if (CBZ.stairs) CBZ.stairs.setOwnerActive(b, true);
    restoreAir(b);             // the rebuild calendar gives the pad/hangar back
    if (CBZ.batchShowGroup) CBZ.batchShowGroup(b.group);
    b.group.visible = true;
    /* RE-SEAT (DEMO_FAST_PURGE). The mirror of destroy()'s disease: this used
       to answer "already registered?" with `indexOf(...) === -1` per pane, per
       collider, per platform, per LOS mesh — the 52-storey flagship alone is
       2,152 panes x a 123k scan. One membership Set answers all of them in
       O(1); reSetsBegin() builds it, or joins the bulk span an outer caller
       (D.reset, the phase ticker's healed-rows drain) already opened so a
       whole-city heal pays the O(city) construction ONCE rather than per lot.
       Flag off / structural.js absent => `sets` is null and seat() falls back
       to the original indexOf test, verbatim. */
    const fast = !!fastPurge();
    const owned = fast ? reSetsBegin() : false;
    const sets = fast ? _reSets : null;
    try {
      for (const gp of b.windows || []) {
        if (!gp.shattered) continue;
        gp.shattered = false; gp.cracked = false;
        if (gp.mesh) gp.mesh.visible = true;
        else if (CBZ._paneShow) CBZ._paneShow(gp, true);
        if (gp.col) seat(CBZ.colliders, sets && sets.cols, gp.col);
      }
      for (const c of b.colliders) seat(CBZ.colliders, sets && sets.cols, c);
      for (const p of b.platforms || []) seat(CBZ.platforms, sets && sets.plats, p);
      for (const m of b.losMeshes || []) seat(CBZ.losBlockers, sets && sets.los, m);
      for (const dr of b.doors || []) {
        dr.demolished = false;
        dr.open = false; dr.hold = 0; dr.t = 0; dr.pivot.rotation.y = 0;
        if (!dr.colIn) { seat(CBZ.colliders, sets && sets.cols, dr.col); dr.colIn = true; }
      }
    } finally { reSetsEnd(owned); }
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    if (b.home && b.home._demoListed != null) { b.home.listed = b.home._demoListed; b.home._demoListed = null; }
    if (retire) startTween({ rec: null, building: b, from: 3, to: -1, outGroup: retire, inGroup: null, outMode: "v" });
    if (typeof D.onEvent === "function" && !opts.silent) try { D.onEvent({ t: "rebuild", x: Math.round(lot.cx), z: Math.round(lot.cz) }); } catch (e) {}
  }

  function phaseFor(rec) {
    const now = CBZ.paceTime ? CBZ.paceTime() : 0;
    const el = now - rec.at;
    if (rec.held) return el >= T_HELD_CLEAR ? 4 : 1;
    return el >= T_SCAFFOLD ? 3 : el >= T_CLEARED ? 2 : 1;
  }

  // ========================================================================
  //  MIGRATED (BLOCK LAW): structural HP now lives in ONE place.
  //
  //  This file used to keep its own `hp` Map<lot, number> — one of THREE
  //  independent "how hurt is this building" accumulators in the codebase
  //  (the others: fracture.js's per-facade `wounds`, buildings.js's per-wall
  //  `wallDmg`). They could not see each other, so a tower could be condemned
  //  on one system's books and pristine on another's, and a plane strike had
  //  no way to express "this is worse than three rockets" beyond raw power.
  //
  //  city/structural.js now owns the ledger, the stage machine (scarred ->
  //  wounded -> burning -> critical -> collapsing), the per-floor load-path
  //  check and the collapse choreography. It calls THIS file's destroy() at
  //  the end of the collapse, because the AFTERMATH — the deterministic
  //  rubble pile, the in-game-calendar rebuild arc, the save blob, the net
  //  relay — is machinery this file already owns and does well. Neither side
  //  duplicates the other.
  //
  //  The legacy accumulator below is kept intact as the DEGRADE-SAFE
  //  fallback: with CBZ.CONFIG.STRUCT_LEDGER off, or structural.js simply not
  //  loaded, blasts accumulate here exactly as they always did. `_legacyAccum`
  //  reports live which of the two is in charge, and CBZ.impactAudit() counts
  //  it as a remaining duplicate whenever it is the legacy one.
  // ========================================================================
  function ledgerOn() { return !!(CBZ.CONFIG.STRUCT_LEDGER && CBZ.structure && CBZ.structure.sweep); }
  try {
    Object.defineProperty(D, "_legacyAccum", { get: function () { return !ledgerOn(); }, configurable: true });
  } catch (e) { D._legacyAccum = true; }

  // Damage conversion for a legacy blast entering the shared ledger. The old
  // curve was `hpMax = 2 + storeys*1.2 + (w*d)/300` against an accumulation of
  // `power * prox`; the ledger's capacity is `12 + storeys*7 + (w*d)/26`,
  // ~6x larger, so a legacy blast is scaled 6x to land on the SAME number of
  // rockets it always took. Checked against both ends of the range:
  //   1-storey shop  (w*d~100): old 3.5 hp / 1.9-power RPG => 2 hits.
  //                             new 22.8 cap / 11.4 per hit => 2 hits.
  //   4-storey block (w*d~400): old 8.1 hp => 5 hits. new 55.4 cap => 4.9.
  const LEGACY_TO_LEDGER = 6;

  // ---- the blast hook: HP accumulation at the single ordnance chokepoint ----
  function onBlast(x, z, opts) {
    if (!CBZ.CONFIG.CITY_DEMOLITION) return;
    if (opts && opts.noDamage) return;                 // cosmetic (heli embers)
    // multiplayer: the HOST is the only authority on structural HP. A guest's
    // local blast is FX-only — networld forwards it to the host, whose
    // destroy decision comes back as a bldx event (fracture's frx pattern).
    if (CBZ.net && CBZ.net.active && !CBZ.net.isHost() && !(opts && opts._fromHost)) return;
    // the wrap chain (buildings/armored/us) can end up layered more than once
    // when siblings re-wrap without copying each other's markers — the SAME
    // opts object flows through every layer, so tag it: one blast, one count.
    if (opts) { if (opts._demoSeen) return; opts._demoSeen = true; }
    const A = arena();
    if (!A || !A.lots) return;
    const power = (opts && opts.power) || 1, R = ((opts && opts.radius) || 6);
    const y = opts && opts.y != null ? opts.y : 1.4;

    // ---- DELEGATION: the shared ledger owns structural HP ------------------
    if (ledgerOn()) {
      // A blast that came through CBZ.detonate already fed the ledger with the
      // ordnance row's own struct/pen/fire — counting it again here would make
      // every bus-routed warhead twice as strong as its table row says.
      // TWO guards, because one of them is a convention and the other is not:
      //   • opts._impact — the tag the bus's own composers set.
      //   • inBusBlast() — true for the whole duration of ANY composer the bus
      //     is running, including third-party ones (city/nukefx.js registers
      //     its own) that cannot be relied on to remember the tag.
      if (opts && (opts._impact || opts._airImpact)) return;
      if (CBZ.impact && CBZ.impact.inBusBlast && CBZ.impact.inBusBlast()) return;
      // `_airImpact` above is city/aircraftimpact.js's claim: it recognised
      // this blast as an aircraft crash and already priced it through the bus
      // with the right ordnance row (penetration, fuel fire, ejecta). Its wrap
      // sits INSIDE ours, so by the time we run it has already decided.
      // A LEGACY blast (fpsmode's rocket, a grenade, a cooking car, an
      // airstrike from a file that has not adopted the bus) still has to wound
      // the city. Same footprint the loop below used — full damage inside,
      // fading to zero at 0.6R — expressed as one ring sweep.
      try {
        CBZ.structure.sweep(x, z, 0, R * 0.6, power * LEGACY_TO_LEDGER, {
          kind: "explosion", byPlayer: !!(opts && opts.byPlayer), fire: 0,
          // HEIGHT MATTERS — the legacy loop below carried `if (y > b.h + 4)
          // continue;` and dropping it on the way to the sweep meant an
          // airburst 300m up wounded every footprint under its ground
          // projection. Hand the seat through so the ledger can apply the
          // same test per building.
          y: y,
        });
      } catch (e) {}
      return;
    }

    // ---- LEGACY ACCUMULATOR (flag off / structural.js absent) --------------
    for (const lot of A.lots) {
      const b = lot.building;
      if (!b || lot.demolished || !eligible(lot)) continue;
      // distance from blast to the building's XZ box; full damage inside,
      // fading to zero half a blast-radius out
      const dx = Math.max(0, Math.abs(x - b.ox) - b.w / 2);
      const dz = Math.max(0, Math.abs(z - b.oz) - b.d / 2);
      const dist = Math.hypot(dx, dz);
      if (dist > R * 0.6) continue;
      if (y > b.h + 4) continue;                       // detonated way above the roof
      const prox = 1 - dist / (R * 0.6);
      const dmg = power * prox;
      if (dmg <= 0.05) continue;
      const cur = (hp.get(lot) || 0) + dmg;
      hp.set(lot, cur);
      if (cur >= hpMax(b)) destroy(lot);
    }
  }
  // wrap the same entry points buildings.js/armored.js already wrap — each
  // wrapper calls through, so order doesn't matter. Installed lazily (the base
  // fns don't exist until crashfx has run).
  function wrapBoom(name) {
    const orig = CBZ[name];
    if (typeof orig !== "function" || orig._demoWrapped) return;
    const wrapped = function (x, z, opts) { const r = orig.call(this, x, z, opts); try { onBlast(x, z, opts); } catch (e) {} return r; };
    // carry forward EVERY sibling wrap marker (struct/armored/…) so their
    // idempotence guards hold — copying only one flag is how the chain ends
    // up re-wrapping itself in layers (each layer re-counting damage).
    for (const k in orig) if (k.endsWith("Wrapped")) wrapped[k] = orig[k];
    wrapped._demoWrapped = true;
    CBZ[name] = wrapped;
  }

  // ---- ticking: phase advancement (cheap — ledger is tiny, early-out when 0) --
  CBZ.onUpdate(34.5, function () {
    if (!CBZ.game || CBZ.game.mode !== "city") {
      /* MODE-EXIT SEAM — the tween leak. rebuild() at the `retire` line starts
         an exit tween for the scaffold, and setPhase() starts one on every
         phase change, but stepTweens() only ever ran BEHIND this early return.
         Leave the city mid-tween (die into the menu, jump to another mode) and
         the retiring group was STRANDED in the arena at whatever partial scale
         it happened to hold — a half-sunk scaffold frozen in the world until
         something called D.reset(). This is the smallest honest fix: the
         mode-exit boundary already exists right here, and the file already
         owns the primitive for settling everything at once. killAllTweens()
         finalises each one exactly as a completed tween would — incoming
         groups snap to identity (the file's own rule: "settled == the snap
         build"), outgoing groups are disposed — so re-entering the city finds
         precisely the state a load would have produced. No flag: this is a
         leak, and leaving it is not a behaviour anyone can want. */
      if (tweens.length) killAllTweens();
      return;
    }
    wrapBoom("cityExplosion");
    wrapBoom("cityAirstrikeExplosion");
    // Single-player save wiring — the same lazy, idempotent, marker-guarded
    // install the wrapBoom lines above use, for the same reason (worldstate.js
    // may or may not have mounted yet). Both are a handful of comparisons per
    // frame once installed; see the SP PERSISTENCE block below.
    spWrapSaves();
    spHydrate();
    stepTweens();                    // advance transition FX (a final rebuild's scaffold retracts even after the ledger empties)
    if (!ledger.size) return;
    const now = CBZ.paceTime ? CBZ.paceTime() : 0;
    const recs = Array.from(ledger.values());
    // A whole district heals in ONE tick after a load (or after a day-jump), and
    // each rebuild() otherwise builds its own O(city) membership Set. Count the
    // healed rows first — the ledger is at most a few hundred entries — and open
    // the shared re-seat span only when more than one record will actually use
    // it. A frame of pure phase ticking must not pay an O(colliders) Set build,
    // and this ticker runs every frame for as long as any rubble exists.
    let healed = 0;
    for (const rec of recs) if (!rec.held && now - rec.at >= T_REBUILT) healed++;
    const owned = (healed > 1 && fastPurge()) ? reSetsBegin() : false;
    try {
      for (const rec of recs) {
        if (!rec.held && now - rec.at >= T_REBUILT) rebuild(rec);
        else setPhase(rec, phaseFor(rec));
      }
    } finally { reSetsEnd(owned); }
  });

  // ---- public surface --------------------------------------------------------
  D.destroy = function (lot, opts) { return destroy(lot, opts); };
  D.has = function (lot) { return ledger.has(keyOf(lot)); };
  D.count = function () { return ledger.size; };
  D.rubbleBudget = function () {
    let detailed = 0, light = 0;
    ledger.forEach(function (r) {
      if (r.phase !== 1) return;
      if (r.rubbleDetailed) detailed++; else light++;
    });
    return { detailed: detailed, light: light, detailCap: RUBBLE_DETAIL_CAP };
  };
  D.hp = function (lot) { const b = lot && lot.building; return b ? { cur: hp.get(lot) || 0, max: hpMax(b) } : null; };
  D.list = function () { return Array.from(ledger.values()).map((r) => ({ k: r.k, at: r.at, phase: r.phase })); };
  // tooling accessor (tools/demolition-check.mjs floating-geometry invariant)
  D.propGroup = function (lot) { const rec = ledger.get(keyOf(lot)); return rec ? rec.propGroup : null; };
  // save / late-join snapshot (netpersist worldBlob.demo — see fracture's twin)
  D.serialize = function () {
    return { v: 1, list: Array.from(ledger.values()).map((r) => {
      const row = { x: Math.round(r.lot.cx), z: Math.round(r.lot.cz), at: +r.at.toFixed(3) };
      if (r.held) row.h = 1;                 // an owner's pad: never healed by the calendar
      return row;
    }) };
  };
  D.applyOne = function (row) {
    if (!row) return false;
    const A = arena();
    if (!A || !A.lots) return false;
    const now = CBZ.paceTime ? CBZ.paceTime() : 0;
    if (!row.h && row.at != null && now - row.at >= T_REBUILT) return false;   // already healed
    let best = null, bd = 1e9;
    for (const lot of A.lots) {
      const d = Math.hypot(lot.cx - row.x, lot.cz - row.z);
      if (d < bd) { bd = d; best = lot; }
    }
    if (!best || bd > 3) return false;                                // address didn't resolve
    return destroy(best, { quiet: true, silent: true, at: row.at, held: !!row.h });
  };
  /* THE HOLD (city/plots.js). hold(lot, true) marks a lot's teardown as the
     owner's: a record that already exists stops its calendar and settles to
     the pad; a lot that is still standing is stamped so the NEXT destroy()
     (the contractor's collapse) opens held. hold(lot, false) hands the parcel
     back to the city: the pad becomes the barriered cleared lot and the normal
     rebuild arc resumes from there. */
  D.hold = function (lot, on) {
    if (!lot) return false;
    const rec = ledger.get(keyOf(lot));
    if (on) {
      lot._plotHold = true;
      if (rec && !rec.held) { rec.held = true; setPhase(rec, phaseFor(rec)); }
      return true;
    }
    lot._plotHold = false;
    if (rec && rec.held) {
      rec.held = false;
      const now = CBZ.paceTime ? CBZ.paceTime() : 0;
      rec.at = now - T_CLEARED;
      setPhase(rec, phaseFor(rec));
    }
    return true;
  };
  D.held = function (lot) { const rec = lot && ledger.get(keyOf(lot)); return !!(rec && rec.held); };
  D.phaseOf = function (lot) { const rec = lot && ledger.get(keyOf(lot)); return rec ? rec.phase : 0; };
  /* THE LOAD PATH (DEMO_LOAD_V1). This ran a full destroy() per row,
     synchronously, inside net/netpersist.js's applyWorld: measured 2,063 ms
     for a 328-row blob, because every row paid its own indexOf storm against
     the 123,332-entry collider array. Batching the REMOVALS turns the whole
     blob into O(colliders + members): each destroy() contributes to the shared
     Sets (see the _dbatch span above) and the compaction runs once, here, at
     the end.
     Per-row isolation is preserved EXACTLY — the try/catch is still per row, so
     one unresolvable address still cannot kill the rest of the load — and the
     outer try/finally guarantees the span closes and the arrays are compacted
     even if the loop itself throws. With the flag off, or DEMO_FAST_PURGE off,
     or structural.js not loaded, this is the original loop, verbatim. */
  D.apply = function (blob) {
    if (!blob || blob.v !== 1 || !Array.isArray(blob.list)) return;
    const purge = CBZ.CONFIG.DEMO_LOAD_V1 ? fastPurge() : null;
    if (!purge || _dbatch) {                       // legacy path, or already inside a span
      for (const row of blob.list) try { D.applyOne(row); } catch (e) {}
      return;
    }
    _dbatch = { cols: new Set(), plats: new Set(), los: new Set() };
    try {
      for (const row of blob.list) try { D.applyOne(row); } catch (e) {}
    } finally {
      const bt = _dbatch; _dbatch = null;
      // Phase-prop colliders pushed by each row's setPhase() are NOT in these
      // Sets, so the single compaction below keeps every one of them.
      purge(CBZ.colliders, bt.cols);
      purge(CBZ.platforms, bt.plats);
      purge(CBZ.losBlockers, bt.los);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
  };
  // net-relay surface (networld): a guest applies the host's rebuild event by
  // address; the host applies a guest's forwarded blast without re-running FX.
  D.rebuildAt = function (row) {
    if (!row) return false;
    const rec = ledger.get(Math.round(row.x) + "," + Math.round(row.z));
    if (!rec) return false;
    rebuild(rec, { silent: true });
    return true;
  };
  D.netBlast = function (x, z, opts) { try { onBlast(x, z, opts || {}) } catch (e) {} };
  // full restore for a new run (called from cityGlassReset)
  D.reset = function () {
    killAllTweens();
    // One shared re-seat span for the whole ledger: a post-nuke reset re-seats
    // 328 buildings at once, and without this each of them rebuilt its own
    // membership Set over the 123k collider array.
    const recs = Array.from(ledger.values());
    const owned = (recs.length > 1 && fastPurge()) ? reSetsBegin() : false;
    try { for (const rec of recs) rebuild(rec, { silent: true }); }
    finally { reSetsEnd(owned); }
    hp.clear();
  };

  /* ========================================================================
     SP PERSISTENCE (DEMO_LOAD_V1) — "it must stay loadable".

     D.serialize() had exactly ONE caller in the whole repo: net/netpersist.js's
     worldBlob (its line 137, the MULTIPLAYER HOST path). Single-player saves
     carried no demolition at all, so a player could level the skyline, watch
     the autosave tick, reload — and find the city pristine. The consequence
     with an end date, which is this file's entire thesis (see the
     DEMO_LANDMARKS block up top), evaporated on reload.

     WHAT THE SP LEDGER ACTUALLY OFFERS, having read city/worldstate.js:
     • There is NO existing world-DAMAGE seam to ride. city/fracture.js is in
       the same position this file was — `cityFracture.serialize` is likewise
       called only from netpersist.js:136 — so "ride where fracture reapplies"
       does not exist in single-player. Nothing to copy, nothing to share.
     • There IS a clean, established SECTION pattern, and a structurally
       identical consumer already using it: city/construction.js:1106-1134
       stamps `led.wall` through lazy idempotent wraps of cityWorldCommit /
       cityWorldCollect, then hydrates once per ledger identity off a tick.
       worldstate.js's own comments call this the "stamp before commit"
       pattern. That is what is used below, unchanged in shape.
     • Version safety is BY CONSTRUCTION and needs no new guard: worldstate's
       load() admits only `version === 2`, and a v2 save written before this
       change simply has no `demo` key, which reads as undefined and skips.
       That is exactly how `cashStore`, `identities` and `cityContacts` were
       each added to this record after the fact.

     THE ONE REAL BLOCKER, AND ITS FIX: the SP ledger does NOT persist the
     calendar. CBZ.dayCount/dayPhase ride only the MP world blob
     (netpersist.js:140-141). Our rows are stamped in ABSOLUTE CBZ.paceTime()
     units, so a `at: 12.4` from a save made on day 12 is meaningless against a
     fresh-boot clock sitting at ~0 — phaseFor() would read el = -12 and freeze
     every pile at phase 1 for twelve in-game days before the arc even started.
     So the section stores the clock reading it was TAKEN at (`now`) and
     hydrate REBASES: age = savedNow - row.at is preserved exactly, and the
     rebuild calendar resumes from where it actually stood. No change to
     daynight.js, no change to the wire format netpersist already sends
     (D.serialize() is untouched; `now` is added by the stamp, and D.apply
     ignores keys it does not know).
  ======================================================================== */
  function spLedger() { const g = CBZ.game; return (g && g.cityWorld && typeof g.cityWorld === "object") ? g.cityWorld : null; }
  let _spHydrated = null;                      // the ledger object we have already adopted
  function spStamp() {
    if (!CBZ.CONFIG.DEMO_LOAD_V1) return;
    // MULTIPLAYER keeps its existing, host-authoritative path: worldBlob.demo.
    // Stamping the same state into the CHARACTER ledger too would give a guest
    // a second, stale copy of world truth it has no authority over.
    if (CBZ.net && CBZ.net.active) return;
    const led = spLedger();
    if (!led) return;
    // NEVER overwrite a blob we have not adopted yet. worldstate.js autosaves
    // every 5 s; without this, a reload's first autosave would fire while the
    // ledger is still empty (the run reset re-glazes the city) and erase the
    // very rows we are about to hydrate from.
    if (_spHydrated !== led) return;
    if (!ledger.size) { if (led.demo) led.demo = null; return; }   // a fully healed city stops carrying rows
    const blob = D.serialize();
    blob.now = +(CBZ.paceTime ? CBZ.paceTime() : 0).toFixed(3);      // the clock these `at`s are relative to
    led.demo = blob;
  }
  let _spWrapped = false;
  function spWrapSaves() {
    if (_spWrapped) return;
    const c = CBZ.cityWorldCommit;
    if (typeof c !== "function") return;       // worldstate.js not up yet — retry next tick
    _spWrapped = true;
    if (!c._demoSaveWrap) {
      const w = function () { try { spStamp(); } catch (e) {} return c.apply(this, arguments); };
      w._demoSaveWrap = true; CBZ.cityWorldCommit = w;
    }
    const cc = CBZ.cityWorldCollect;
    if (typeof cc === "function" && !cc._demoSaveWrap) {
      const w2 = function () { try { spStamp(); } catch (e) {} return cc.apply(this, arguments); };
      w2._demoSaveWrap = true; CBZ.cityWorldCollect = w2;
    }
  }
  function spHydrate() {
    if (!CBZ.CONFIG.DEMO_LOAD_V1 || !CBZ.CONFIG.CITY_DEMOLITION) return;
    const led = spLedger();
    if (!led || led === _spHydrated) return;
    // AFTER THE CITY IS BUILT, AND AFTER THE RUN RESET HAS FINISHED.
    // systems/state.js runs `resetGame(); setState("playing")` in that order,
    // and city/mode.js's reset() calls cityGlassReset() -> D.reset(), which
    // rebuilds every record it can see. Waiting for state === "playing" puts
    // us strictly after that teardown, so nothing we admit is undone.
    const A = arena();
    if (!A || !A.lots || !A.lots.length) return;
    if (!CBZ.game || CBZ.game.state !== "playing") return;
    _spHydrated = led;                          // claim it either way — one attempt per ledger
    // MP takes the netpersist worldBlob path; never self-apply a char blob.
    if (CBZ.net && CBZ.net.active) return;
    const blob = led.demo;
    if (!blob || blob.v !== 1 || !Array.isArray(blob.list) || !blob.list.length) return;
    const now = CBZ.paceTime ? CBZ.paceTime() : 0;
    const base = (typeof blob.now === "number" && isFinite(blob.now)) ? blob.now : null;
    // REBASE (see the block comment): preserve each row's AGE, not its absolute
    // timestamp, because the SP ledger carries no clock. Without `blob.now` —
    // a section written by an older build of this file — fall through to the
    // raw rows rather than inventing an age.
    const rows = base == null ? blob.list : blob.list.map(function (r) {
      return { x: r.x, z: r.z, at: now - Math.max(0, base - r.at), h: r.h };
    });
    try { D.apply({ v: 1, list: rows }); } catch (e) {}
  }
  /* NOT re-hydrated on a fresh run inside the same page session: the identity
     check above fires once per g.cityWorld object, and starting a new life
     runs the whole mode.js reset block (gangs, families, real estate, glass —
     line 580-610 there) whose declared job is to hand you a clean city. A page
     RELOAD always mints a new ledger object out of load(), which is the case
     the owner's "must stay loadable" actually names. */

  // ---- transition tooling (tools/demolition-check.mjs interpolation assert) ---
  // Prove a phase change actually INTERPOLATES rather than snaps, deterministically
  // and independent of headless frame timing: pause the auto-stepper, force the
  // next phase, step the tween by an explicit dt, and read the live scale.
  D._tweenState = function (lot) {
    const rec = ledger.get(keyOf(lot));
    const tw = rec && rec._tw;
    if (!tw) return { active: false };
    return {
      active: true, from: tw.from, to: tw.to, t: +tw.t.toFixed(4),
      inScaleY: tw.inGroup ? +tw.inGroup.scale.y.toFixed(4) : null,
      outScaleY: tw.outGroup ? +tw.outGroup.scale.y.toFixed(4) : null,
    };
  };
  D._tweenCount = function () { return tweens.length; };
  D._tweenPause = function (v) { _paused = !!v; _lastNow = 0; };
  D._tweenStep = function (dt) { stepTweens(dt == null ? 0 : dt); return tweens.length; };
  D._forcePhase = function (lot, phase) { const rec = ledger.get(keyOf(lot)); if (rec) setPhase(rec, phase); return rec ? rec.phase : -1; };
})();
