/* ============================================================
   city/bling.js — VISIBLE wealth: the street-read made physical.
   WHY: the game is "make money + show off" — levels tell you WHO is
   dangerous, bling tells you WHO is worth robbing. A ped's rolled
   valuables (peds.js/economy.js: "Gold Chain", "Rolex", "Engagement
   Ring"…) already decide the payout; this makes them VISIBLE so you
   can spot the gold chain / iced watch with your EYES and pick your
   mark — no menus, no inspection, just looking at people. Gang
   members also get a crew-colored rag so a block reads at a glance.

   What you see (REAL jewelry scale — reads at street distance, not
   clownish up close):
     • neck   — a chain lying FLAT against the upper chest: a shallow V
                of two LINK RUNS meeting at a pendant just below the
                collar (gold curb links + a cross = Gold Chain; fine
                silver links + a cut stone = Diamond Necklace; fat iced
                links + a medallion = Iced Chain). Never a hoop, never
                upright, never bigger than the head.
     • wristL — a WATCH, not a box: a thin band wrapping the forearm
                just above the hand, a case with lugs, a bezel ring, a
                dial and four marks on it. The tier is in the finish —
                steel / gold / diver (dark bezel + lume pip) / iced
                (pavé) — and the loot unicorns get their own read:
                Royal-Oak octagon (AP), gold dress case (Patek),
                tonneau carbon (Richard Mille). Smaller than the hand.
     • ring   — a BAND round the finger with a cut stone on it, on the
                right hand's edge (Engagement = the $5M rock, Diamond
                Ring, Pinky = smaller and further outboard)
     • wristR — slim iced band + stones (Tennis Bracelet)
     • ears   — two studs / hoops at the lobes (Earrings). They used to
                render NOTHING on you and a stray RING glint on a ped —
                one classifier now answers for both.
     • crown  — an arc of stones across the front of the skull (Diamond
                Tiara — the mob wife's seven-figure set)
     • head   — gang-colored rag (ped.gang), a headband wrapping the
                hair, so crews read as crews
   (The FORMAL KIT — tux shirt-front / bow-tie / pocket square — is
   now PAINTED into the outfit textures by clothes.js; bling carries
   jewelry + colors only.)

   PERF (the game is draw-call bound):
     • ONE shared geometry per accessory part kind + ONE shared
       material per finish (gold/silver/ice/glint; rag materials
       shared per gang color via cmat's cache). Meshes are POOLED
       and reused.
     • A piece that reads as jewelry needs more PARTS than a box, and
       these mount on every dripped ped in the crowd bubble — so a run
       of chain links, a pavé cluster, a set of grill teeth and a
       tiara's stones are MERGED ONCE into a single cached geometry.
       A 7-link strand costs the same one draw call the single link
       box cost, and the whole chain is still 3 meshes.
     • dress only within ~45u of the camera, undress past ~60u,
       hard cap 60 dressed peds, scan time-sliced (~14 peds/frame).
     • castShadow stays off — a 0.05u box's shadow is invisible.

   TRUTH: bling mirrors ped.valuables LIVE. Mug/loot strips the ice
   off the body the moment it's taken (call-through wrappers around
   CBZ.cityRobPed / CBZ.cityLootCorpse — the social.js wrap pattern),
   and a cheap per-frame signature check catches pickpocket dips. A
   corpse KEEPS its shine until looted — you can spot a body still
   wearing its chain from across the street.

   YOUR OWN DRIP: the same read applied to the PLAYER. The city can
   read everyone — so your body must show YOUR money: the best chain /
   watch / ring you actually OWN (g.cityInv, classified through
   CBZ.cityEcon.ITEMS — the looted Patek on your wrist, the $5M rock a
   glint on your hand), a VIP-level fit (CBZ.cityPlayerDrip ≥ VIP_DRIP)
   ices the off-wrist too, and your crew's colors as a rag (own founded
   gang first, else the set you're patched into). Mounted on
   CBZ.playerChar's rig — third person, shoulder cam, the club line and
   the WASTED kill-cam all show your status; pure first person hides it
   for free because fpsmode hides the whole playerChar.group. Selling /
   losing a piece undresses it: re-derived on a 1s timer via a cheap
   signature compare (never per-frame), ZERO new geometry/material
   types — the player wears the exact same shared meshes as the street.

   Headless-safe: every anchor/geometry/API access is guarded, so
   the harness (stub THREE, stub rigs with empty parts) never throws.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // BLING_V2 — jewelry made of jewelry parts (link runs, cased watches, banded
  // rings, ear studs, a tiara) instead of the proud boxes this file shipped
  // with. Declared here rather than in config.js so the whole look is one line
  // back: false restores the V1 part tables byte-for-byte, and looks() rebuilds
  // on the toggle so it applies without a reload.
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.BLING_V2 == null) CBZ.CONFIG.BLING_V2 = true;
  function v2() { return CBZ.CONFIG.BLING_V2 !== false; }

  // dress within 45u, undress past 60u (hysteresis so border peds don't flicker)
  const DRESS_D2 = 45 * 45, UNDRESS_D2 = 60 * 60;
  // cap on dressed peds — rides the LIVE quality tier (lo 30 → hi 120); read at
  // every check so the slider applies instantly. Budget per ped: a rag is 1, a
  // chain 3, a watch 5-6 (the repetition is inside merged geometry, not in the
  // mesh count) — a body carrying the whole set is ~15 and almost nobody does.
  const CAP = () => Math.round(CBZ.qScale ? CBZ.qScale(30, 120) : 60);
  const SLICE = 14;        // peds scanned per frame (full roster every ~0.2s)
  // per-kind pool bound; extras just drop (shared geo/mat). 128 because a full
  // bubble of chain-wearers wants two strand meshes EACH — at 48 the pool
  // missed and re-allocated on every dress, which is the churn it exists to stop.
  const POOL_MAX = 128;

  // ---- shared geometry per accessory PART kind (lazy; built once, never disposed).
  // Real-jewelry scale against the rig (torso 0.92w, front face z 0.25; arm 0.3
  // square; hand cap 0.31 x 0.2 x 0.35; head 0.6 cube):
  const geos = {};

  // ---- COMPOSITE PARTS (V2). A chain that reads as a chain is ~14 links; 14
  // meshes per strand times 60 dressed peds is not a jewelry system, it is a
  // frame budget. So the pieces whose detail is REPETITION (link runs, pavé,
  // grill teeth, tiara stones, bracelet stones) are baked into ONE cached
  // BufferGeometry each. Positions are constants — nothing here rolls a die,
  // so two clients build byte-identical jewelry.
  // Degrade-safe: BufferGeometryUtils is vendored (src/vendor) but the headless
  // harness has no merge and no Octahedron, so every exotic constructor falls
  // back to a box and a merge falls back to its first element. A piece may read
  // plainer without the vendor; it is never missing.
  function mergeGeos(parts) {
    const BGU = THREE.BufferGeometryUtils;
    if (BGU && BGU.mergeBufferGeometries && parts.length > 1) {
      try {
        const m = BGU.mergeBufferGeometries(parts);
        if (m) { for (let i = 0; i < parts.length; i++) if (parts[i].dispose) parts[i].dispose(); return m; }
      } catch (e) { /* vendor mismatch — fall through to the single-part read */ }
    }
    for (let i = 1; i < parts.length; i++) if (parts[i].dispose) parts[i].dispose();
    return parts[0];
  }
  function mergeBoxes(specs) {
    const parts = [];
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      const gm = new THREE.BoxGeometry(s.w, s.h, s.d);
      if (s.ry && gm.rotateY) gm.rotateY(s.ry);
      if (s.rx && gm.rotateX) gm.rotateX(s.rx);
      if (s.rz && gm.rotateZ) gm.rotateZ(s.rz);
      if (gm.translate) gm.translate(s.x || 0, s.y || 0, s.z || 0);
      parts.push(gm);
    }
    return mergeGeos(parts);
  }
  // ONE strand of chain: n links alternating flat / on-edge along X, spanning
  // the SAME 0.30 the single link box spanned — so CHAIN_Y/CHAIN_Z/CHAIN_TILT
  // seat the V exactly where they always did. `len` overlaps the step so the
  // run has no gaps at any viewing angle.
  function linkRun(n, len, w, t) {
    const step = 0.30 / n, specs = [];
    for (let i = 0; i < n; i++) {
      const up = (i & 1) === 1;
      specs.push({ w: len, h: up ? t : w, d: up ? w : t, x: -0.15 + step * (i + 0.5) });
    }
    return mergeBoxes(specs);
  }
  // stones spaced round a circle in the XZ plane (bracelet) — same radius as
  // the band torus, so they sit ON the band rather than beside it.
  function ringStones(n, r, s, y) {
    const specs = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      specs.push({ w: s, h: s, d: s, x: Math.sin(a) * r, y: y || 0, z: Math.cos(a) * r, ry: a });
    }
    return mergeBoxes(specs);
  }
  // a torus that lies FLAT around a limb (limb axis = local Y): the default
  // torus lies in XY with its axis on Z, so it wants the same rotateX the V1
  // cuff already did. Falls back to a box ring-ish slab with no THREE.Torus.
  // NEITHER fallback may hand back CBZ.boxGeom's SHARED cache entry: these two
  // feed mergeGeos, which disposes the parts it swallowed, and a scaled/disposed
  // shared box would take the whole engine's box cache with it.
  function limbBand(r, tube, rad, tub) {
    if (!THREE.TorusGeometry) return new THREE.BoxGeometry(r * 2, tube * 2, r * 2);
    const gm = new THREE.TorusGeometry(r, tube, rad, tub);
    if (gm.rotateX) gm.rotateX(Math.PI / 2);
    return gm;
  }
  // a disc facing the camera (+Z): watch case / dial / medallion.
  function disc(r, depth, seg) {
    if (!THREE.CylinderGeometry) return new THREE.BoxGeometry(r * 2, r * 2, depth);
    const gm = new THREE.CylinderGeometry(r, r, depth, seg || 8);
    if (gm.rotateX) gm.rotateX(Math.PI / 2);
    return gm;
  }

  function geoFor(kind) {
    let gm = geos[kind];
    if (gm) return gm;
    if (kind === "link") gm = CBZ.boxGeom(0.30, 0.035, 0.03);        // chain strand (gold chain)
    else if (kind === "linkThin") gm = CBZ.boxGeom(0.30, 0.026, 0.024); // diamond necklace's finer strand
    else if (kind === "linkThick") gm = CBZ.boxGeom(0.30, 0.055, 0.035); // iced chain's fat links
    else if (kind === "pendant") gm = CBZ.boxGeom(0.07, 0.07, 0.03);  // small flat pendant block
    else if (kind === "cuff") {
      // A BAND, NOT A BLOCK (owner: "bracelets overlap clothes and look dumb").
      // The old cuff was a 0.32 box around a 0.30 forearm — one centimetre of
      // clearance per side, which any sleeve thickness at all swallows, so the
      // watch sank INTO the shirt and z-fought its own arm. It was also square,
      // so its corners poked through a round-ish limb at every angle.
      // A torus wraps the limb properly and 0.185 of radius clears the sleeve
      // with room to spare; 8 radial segments keeps it in the low-poly language
      // of everything else on the body.
      gm = new THREE.TorusGeometry(0.185, 0.028, 4, 8);
      gm.rotateX(Math.PI / 2);          // torus lies in XY by default; lay it flat around the arm
    }
    else if (kind === "face") gm = CBZ.boxGeom(0.10, 0.07, 0.03);     // watch face plate on the band
    else if (kind === "ring") gm = CBZ.boxGeom(0.05, 0.04, 0.05);     // a glint dot, not a knuckle-duster
    else if (kind === "grill") gm = CBZ.boxGeom(0.16, 0.05, 0.04);    // an iced bar across the mouth (a grill)
    else if (kind === "lens") gm = CBZ.boxGeom(0.20, 0.17, 0.05);     // one shade lens (two of these cover the eyes)
    else if (kind === "bridge") gm = CBZ.boxGeom(0.09, 0.055, 0.05);  // nose bridge joining the lenses
    else if (kind === "temple") gm = CBZ.boxGeom(0.035, 0.045, 0.30); // arm running back over the ear
    // ---- V2 PARTS ---------------------------------------------------------
    // chain strands: three weights of the same 0.30 run (fine necklace / curb
    // chain / fat iced links), each ONE merged geometry.
    else if (kind === "chainRun") gm = linkRun(7, 0.050, 0.034, 0.020);
    else if (kind === "chainRunFine") gm = linkRun(9, 0.040, 0.024, 0.014);
    else if (kind === "chainRunFat") gm = linkRun(6, 0.058, 0.050, 0.030);
    // pendants with a shape: a cross and a rimmed medallion.
    else if (kind === "cross") gm = mergeBoxes([
      { w: 0.026, h: 0.105, d: 0.020 }, { w: 0.070, h: 0.026, d: 0.020, y: 0.018 }]);
    else if (kind === "medallion") {
      const parts = [disc(0.045, 0.016, 8)];
      if (THREE.TorusGeometry) { const rim = new THREE.TorusGeometry(0.045, 0.009, 4, 8); if (rim.translate) rim.translate(0, 0, 0.004); parts.push(rim); }
      gm = mergeGeos(parts);
    }
    // a cut stone. An octahedron is 8 faces — the cheapest thing in the engine
    // that catches light like a brilliant instead of like a sugar cube.
    else if (kind === "gem") gm = THREE.OctahedronGeometry ? new THREE.OctahedronGeometry(0.030, 0) : CBZ.boxGeom(0.040, 0.052, 0.040);
    // watch: band, case+lugs, bezel ring, dial, marks, pavé. WHY a bezel TORUS
    // and not a second cylinder — a solid disc buries the dial; a ring leaves
    // the hole the dial shows through, which is what makes it read as a watch.
    else if (kind === "band2") gm = limbBand(0.185, 0.020, 6, 8);
    else if (kind === "bandFine") gm = limbBand(0.185, 0.014, 6, 8);
    else if (kind === "wCase" || kind === "wTonneau") {
      // 0.124 across (a third of the 0.31 hand cap) and only 0.040 deep: the
      // whole stack — band 0.185 + case + bezel — stands 0.071 off the forearm
      // centre, i.e. about 1.5 cm of watch over 2.4 cm of sleeve clearance in
      // real units. A deeper case is what made the V1 face read as a taped box.
      const body = disc(0.062, 0.040, 8);
      // Richard Mille's tonneau: the SAME octagonal case stretched up the
      // forearm. A barrel, not a puck, and it costs no extra geometry kind.
      if (kind === "wTonneau" && body.scale) body.scale(1, 1.30, 1);
      const lugs = [];
      for (let i = 0; i < 2; i++) {
        const b = new THREE.BoxGeometry(0.042, 0.066, 0.042);
        if (b.translate) b.translate(i ? 0.066 : -0.066, 0, -0.010);
        lugs.push(b);
      }
      gm = mergeGeos([body].concat(lugs));
    }
    else if (kind === "wBezel") {
      gm = THREE.TorusGeometry ? new THREE.TorusGeometry(0.064, 0.014, 4, 8) : CBZ.boxGeom(0.156, 0.156, 0.028);
    }
    else if (kind === "wDial") gm = disc(0.046, 0.010, 8);
    else if (kind === "wMarks") gm = mergeBoxes([
      { w: 0.010, h: 0.022, d: 0.010, y: 0.032 }, { w: 0.010, h: 0.022, d: 0.010, y: -0.032 },
      { w: 0.022, h: 0.010, d: 0.010, x: 0.032 }, { w: 0.022, h: 0.010, d: 0.010, x: -0.032 }]);
    else if (kind === "wPave") {
      const specs = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        specs.push({ w: 0.015, h: 0.015, d: 0.015, x: Math.sin(a) * 0.064, y: Math.cos(a) * 0.064, rz: a });
      }
      gm = mergeBoxes(specs);
    }
    // bracelet: a finer band + the stones that make it a TENNIS bracelet.
    else if (kind === "braceStones") gm = ringStones(8, 0.185, 0.020, 0);
    // ring: a band round the finger, and the stone is a separate `gem` part.
    else if (kind === "ringBand") gm = limbBand(0.045, 0.011, 4, 6);
    // ear hoop hangs in the YZ plane (axis across the head), so it needs the
    // OTHER rotation — a rotateX hoop would lie flat on top of the ear.
    else if (kind === "hoop") {
      if (!THREE.TorusGeometry) gm = CBZ.boxGeom(0.014, 0.076, 0.076);
      else { gm = new THREE.TorusGeometry(0.038, 0.009, 4, 8); if (gm.rotateY) gm.rotateY(Math.PI / 2); }
    }
    // grill: six teeth, not one bar. Merged, so it is still one draw call.
    else if (kind === "grillTeeth") {
      const specs = [];
      for (let i = 0; i < 6; i++) specs.push({ w: 0.021, h: 0.046, d: 0.028, x: -0.0625 + i * 0.025 });
      gm = mergeBoxes(specs);
    }
    // tiara: an arc of band segments across the FRONT of the skull with stones
    // standing on it, tallest at centre. R clears the 0.60 head by 0.025.
    else if (kind === "tiaraArc") {
      const specs = [], R = 0.325;
      for (let i = 0; i < 9; i++) {
        const a = -0.95 + i * (1.9 / 8), x = Math.sin(a) * R, z = Math.cos(a) * R;
        specs.push({ w: 0.078, h: 0.026, d: 0.028, x: x, z: z, ry: a });
        if (i % 2 === 0) {
          const h = 0.075 - Math.abs(i - 4) * 0.012;
          specs.push({ w: 0.020, h: h, d: 0.020, x: x, y: 0.013 + h / 2, z: z, ry: a });
        }
      }
      gm = mergeBoxes(specs);
    }
    else gm = CBZ.boxGeom(0.68, 0.16, 0.68);                          // rag: headband enclosing the 0.64 hair
    geos[kind] = gm;
    return gm;
  }

  // ---- shared materials per FINISH (cmat caches; nothing here mutates them) ----
  let _mats = null;
  function mats() {
    if (_mats) return _mats;
    _mats = {
      gold: CBZ.cmat(0xc9a44a, { emissive: 0x6b4f12, ei: 0.4 }),    // warm metal, not neon
      silver: CBZ.cmat(0xb9c0c8, { emissive: 0x7e8790, ei: 0.35 }),
      ice: CBZ.cmat(0xeaf6ff, { emissive: 0x9fd8ff, ei: 0.65 }),
      glint: CBZ.cmat(0xffffff, { emissive: 0xcfeaff, ei: 0.95 }),
      blueDial: CBZ.cmat(0x1b3a6b, { emissive: 0x0a1830, ei: 0.3 }),   // a diver's blue dial
      lensDark: CBZ.cmat(0x0a0d12, { emissive: 0x1b2535, ei: 0.30 }),  // basic sunglasses lens: near-black, faint cool sheen
      lensMirror: CBZ.cmat(0x0e1422, { emissive: 0x37588a, ei: 0.50 }),// designer lens: darker, brighter mirrored cool tint
      frameDark: CBZ.cmat(0x111317, { emissive: 0x000000, ei: 0.0 }),  // black plastic frame
      // V2 finishes. cmat is a Lambert with an emissive tint (and returns a PBR
      // twin by itself on the high tier) — a metal here wants a DARKER body and
      // a warmer/cooler self-glow than the flat V1 pair, because contrast
      // between the case and the dial is what makes a wrist read as a watch at
      // 20 u. Never build a material per wearer: these are shared and cached.
      steel: CBZ.cmat(0x9aa3ad, { emissive: 0x4e565f, ei: 0.30 }),     // brushed steel case/band
      goldRich: CBZ.cmat(0xd4af37, { emissive: 0x7a5510, ei: 0.45 }),  // precious-metal case (the 0xd4af37 family)
      rose: CBZ.cmat(0xc08464, { emissive: 0x6b3a24, ei: 0.35 }),      // rose gold — the tonneau's hardware
      carbon: CBZ.cmat(0x191c21, { emissive: 0x0b0e12, ei: 0.20 }),    // forged carbon / a skeleton dial
      bezelDark: CBZ.cmat(0x11161d, { emissive: 0x0a1018, ei: 0.25 }), // a diver's dark bezel insert
      dialWhite: CBZ.cmat(0xe6ebef, { emissive: 0x8f99a3, ei: 0.28 }), // white dress dial
      dialBlack: CBZ.cmat(0x15181d, { emissive: 0x080a0d, ei: 0.18 }), // black dial
    };
    return _mats;
  }
  // gang rag material — per-gang shared (cmat caches by color, so every member
  // of a crew shares ONE material). Color resolved once per gang id.
  const _ragMats = {};
  function ragMat(gangId) {
    let m = _ragMats[gangId];
    if (m) return m;
    let col = 0xb079ea;
    try {
      const gg = CBZ.cityGangById && CBZ.cityGangById(gangId);
      if (gg && gg.color != null) col = gg.color;
      else {
        const defs = (CBZ.CITY && CBZ.CITY.gangs) || [];
        for (let i = 0; i < defs.length; i++) if (defs[i].id === gangId) { col = defs[i].color; break; }
      }
    } catch (e) { /* color lookup must never break dressing */ }
    m = CBZ.cmat(col, { emissive: col, ei: 0.12 });   // slight glow so the rag pops at dusk
    _ragMats[gangId] = m;
    return m;
  }

  // ---- LOOKS: each wearable is a small list of PARTS (kind + finish + local
  // transform). Positions are in the anchor's local space (character.js):
  //   body — torso front face at z 0.25, yoke bottom ≈ y 1.75
  //   la/ra — THE ELBOW GROUP (anchorsOf resolves `low`), NOT the shoulder:
  //           the forearm runs +0.06 -> -armLo and the drawn hand cap spans
  //           -armLo - 0.03 -> handH - armLo. Anything on this anchor declares
  //           `at:"wrist"` or `at:"hand"` and lets CBZ.charArmLandmarks place
  //           it — the two stale absolute y's that used to be documented here
  //           are what put the watch on the back of the hand, twice.
  //   neck — hair box at y 0.62
  // CHAIN: a shallow flat V hugging the upper chest — strand tops at x ±0.20
  // y 1.76 (under the yoke), meeting at (0, 1.54); each strand is 0.30 long
  // tilted ±0.83 rad, sitting ~0.03 proud of the torso face. Pendant hangs at
  // the meet. WATCH: band ON THE WRIST + a face plate on the outer front.
  // RING: a dot on the front edge of the hand, at the knuckle line.
  const CHAIN_Y = 1.65, CHAIN_Z = 0.268, CHAIN_TILT = 0.83;
  // WZ — the watch stack's z on the wrist: the band torus's front centre, so
  // the case sits ON the band and every plate above it is an offset FROM that
  // one number instead of six independently-typed z's that drift apart.
  const WZ = 0.185;
  let _looks = null, _looksFlag = null;
  function looks() {
    if (_looks && _looksFlag === v2()) return _looks;
    const M = mats();
    const v = function (kind, mat) {
      return [
        { kind: kind, mat: mat, x: -0.10, y: CHAIN_Y, z: CHAIN_Z, rz: -CHAIN_TILT },
        { kind: kind, mat: mat, x: 0.10, y: CHAIN_Y, z: CHAIN_Z, rz: CHAIN_TILT },
      ];
    };
    /* THE WRIST IS DERIVED NOW, NOT TYPED (owner: "watches are on HANDS now —
       move them up to WRISTS"). Every `at:"wrist"` / `at:"hand"` part below
       carries an OFFSET from a landmark that mountParts resolves against the
       rig it is being mounted on (CBZ.charArmLandmarks, entities/character.js).

       WHY THIS FILE KEPT GETTING IT WRONG: the anchor is the ELBOW group, and
       the previous two passes both measured against `leftHand` — the wrist
       SOCKET, at -armLo - 0.01 — when the thing you can actually SEE is
       limb()'s hand `cap`, which starts 0.03 lower and is (handH + 0.03) tall,
       so it reaches UP to handH - armLo = -0.26 on an adult male. -0.36 is
       0.10 inside that box: the watch was on the back of the hand. There is no
       constant to get wrong any more, and it is no longer authored for one
       body — a woman's shorter forearm and a child's much shorter one place
       their own watch correctly with no table here. */
    const watch = function (band, faceM) {
      return [
        { kind: "cuff", at: "wrist", mat: band, x: 0, y: 0, z: 0 },
        { kind: "face", at: "wrist", mat: faceM, x: 0, y: 0, z: 0.175 },   // the dial rides ON the band
      ];
    };
    _looks = {
      // necklaces — flat V + pendant, all smaller than the head
      chainGold: v("link", M.gold).concat([{ kind: "pendant", mat: M.gold, x: 0, y: 1.515, z: 0.272 }]),
      chainDiamond: v("linkThin", M.silver).concat([{ kind: "pendant", mat: M.glint, x: 0, y: 1.515, z: 0.272 }]),
      chainIced: v("linkThick", M.ice).concat([{ kind: "pendant", mat: M.ice, x: 0, y: 1.515, z: 0.272 }]),
      // watches — thin band + face, on the WRIST (see `watch` above)
      watchGold: watch(M.gold, M.gold),
      watchSilver: watch(M.silver, M.silver),
      watchIced: watch(M.ice, M.glint),
      watchSteel: watch(M.silver, M.silver),                                   // clean steel dress watch
      watchDiver: [{ kind: "cuff", at: "wrist", mat: M.silver, x: 0, y: 0, z: 0 },     // steel band, on the wrist
        { kind: "face", at: "wrist", mat: M.blueDial, x: 0, y: 0, z: 0.175 },          // signature blue dial
        { kind: "ring", at: "wrist", mat: M.glint, x: 0, y: 0.06, z: 0.19 }],          // lume pip
      // tennis bracelet — band only
      bracelet: [{ kind: "cuff", at: "wrist", mat: M.ice, x: 0, y: 0.06, z: 0 }],   // a band's width above the watch line, on skin
      // ring — a glint dot on the hand's front edge (the ONE piece that really
      // does belong on the hand: `at:"hand"` is the knuckle line, not the wrist)
      ring: [{ kind: "ring", at: "hand", mat: M.glint, x: 0.10, y: 0, z: 0.17 }],
      // grill — a small iced bar across the lower face (the mouth)
      grill: [{ kind: "grill", mat: M.glint, x: 0, y: 0.28, z: 0.265 }],
      // shades — two lenses + bridge + temples sitting on the eyes (neck-local,
      // so they turn with the head). Status you wear on your FACE: the same
      // "I've got money" read as the chain, just up at eye level.
      shades: [
        { kind: "lens", mat: M.lensDark, x: -0.145, y: 0.345, z: 0.34 },
        { kind: "lens", mat: M.lensDark, x: 0.145, y: 0.345, z: 0.34 },
        { kind: "bridge", mat: M.frameDark, x: 0.0, y: 0.345, z: 0.34 },
        { kind: "temple", mat: M.frameDark, x: -0.27, y: 0.345, z: 0.17 },
        { kind: "temple", mat: M.frameDark, x: 0.27, y: 0.345, z: 0.17 },
      ],
      // designer shades — same frame, mirrored lens + gold hardware (the pricier read)
      shadesDesigner: [
        { kind: "lens", mat: M.lensMirror, x: -0.145, y: 0.345, z: 0.34 },
        { kind: "lens", mat: M.lensMirror, x: 0.145, y: 0.345, z: 0.34 },
        { kind: "bridge", mat: M.gold, x: 0.0, y: 0.345, z: 0.34 },
        { kind: "temple", mat: M.gold, x: -0.27, y: 0.345, z: 0.17 },
        { kind: "temple", mat: M.gold, x: 0.27, y: 0.345, z: 0.17 },
      ],
    };
    if (v2()) blingV2(_looks, M);
    _looksFlag = v2();
    return _looks;
  }

  /* ============================================================
     V2 — the same SEATS, made of jewelry instead of boxes.
     OWNER: watches and chains read as boxes taped to the body. Nothing about
     WHERE a piece sits moves here: the chain still hangs on CHAIN_Y/Z/TILT,
     the watch still resolves `at:"wrist"` through CBZ.charArmLandmarks, the
     ring is still on the knuckle line. What changes is what each piece is
     MADE of, and the tier is carried by the FINISH (a look is a small parts
     list, so a tier costs materials, not geometry).
     Two rules this table must keep: every part list stays short (these mount
     on every dripped ped in the bubble — the repetition is inside merged
     geometry, not in the list), and no position is random.
  ============================================================ */
  function blingV2(L, M) {
    // chain strand pair — same V, a link RUN instead of one smooth bar.
    const strand = function (kind, mat) {
      return [
        { kind: kind, mat: mat, x: -0.10, y: CHAIN_Y, z: CHAIN_Z, rz: -CHAIN_TILT },
        { kind: kind, mat: mat, x: 0.10, y: CHAIN_Y, z: CHAIN_Z, rz: CHAIN_TILT },
      ];
    };
    // one watch: band → case+lugs → bezel ring → dial → marks (+ pavé). Every
    // z is WZ plus a stack offset, so the parts can never separate.
    const watch2 = function (o) {
      const P = [
        { kind: "band2", at: "wrist", mat: o.band, x: 0, y: 0, z: 0 },
        { kind: o.tonneau ? "wTonneau" : "wCase", at: "wrist", mat: o.body, x: 0, y: 0, z: WZ },
        { kind: "wBezel", at: "wrist", mat: o.bezel, x: 0, y: 0, z: WZ + 0.022 },
        { kind: "wDial", at: "wrist", mat: o.dial, x: 0, y: 0, z: WZ + 0.022 },
        { kind: "wMarks", at: "wrist", mat: o.mark, x: 0, y: 0, z: WZ + 0.029 },
      ];
      if (o.pave) P.push({ kind: "wPave", at: "wrist", mat: M.glint, x: 0, y: 0, z: WZ + 0.022 });
      // a diver's lume pip at 12 o'clock — up the FOREARM, which is +y here.
      if (o.pip) P.push({ kind: "gem", at: "wrist", mat: M.glint, s: 0.42, x: 0, y: 0.072, z: WZ + 0.026 });
      return P;
    };
    // ---- necklaces: gold curb + cross, fine silver + stone, fat iced + medal
    L.chainGold = strand("chainRun", M.gold).concat([{ kind: "cross", mat: M.gold, x: 0, y: 1.505, z: 0.278 }]);
    L.chainDiamond = strand("chainRunFine", M.silver).concat([{ kind: "gem", mat: M.glint, x: 0, y: 1.515, z: 0.284 }]);
    L.chainIced = strand("chainRunFat", M.ice).concat([
      { kind: "medallion", mat: M.ice, x: 0, y: 1.505, z: 0.278 },
      { kind: "gem", mat: M.glint, s: 0.7, x: 0, y: 1.505, z: 0.298 },
    ]);
    // ---- watches. The tier IS the finish; the unicorns get their own read so
    // a $900k wrist is not the same picture as a $12k one.
    L.watchSteel = watch2({ band: M.steel, body: M.steel, bezel: M.steel, dial: M.dialWhite, mark: M.carbon });
    L.watchSilver = L.watchSteel;                       // economy.js's declared name for the steel look
    L.watchGold = watch2({ band: M.goldRich, body: M.goldRich, bezel: M.goldRich, dial: M.gold, mark: M.carbon });
    L.watchDiver = watch2({ band: M.steel, body: M.steel, bezel: M.bezelDark, dial: M.blueDial, mark: M.glint, pip: true });
    L.watchIced = watch2({ band: M.ice, body: M.ice, bezel: M.ice, dial: M.glint, mark: M.ice, pave: true });
    // Royal Oak: steel case, GOLD octagonal bezel (the wBezel torus is 8-sided
    // already), blue dial. Patek: a gold dress watch, white dial, no ice.
    L.watchAP = watch2({ band: M.steel, body: M.steel, bezel: M.goldRich, dial: M.blueDial, mark: M.goldRich });
    L.watchPatek = watch2({ band: M.goldRich, body: M.goldRich, bezel: M.goldRich, dial: M.dialWhite, mark: M.carbon });
    L.watchRM = watch2({ band: M.carbon, body: M.carbon, bezel: M.rose, dial: M.carbon, mark: M.rose, tonneau: true });
    // ---- tennis bracelet: a finer band than the watch's, plus its stones.
    L.bracelet = [
      { kind: "bandFine", at: "wrist", mat: M.silver, x: 0, y: 0.06, z: 0 },
      { kind: "braceStones", at: "wrist", mat: M.glint, x: 0, y: 0.06, z: 0 },
    ];
    // ---- rings: a BAND round the finger with a stone on it. The pinky ring is
    // smaller and further outboard (x 0.145 sits inside the 0.31-wide hand cap).
    L.ring = [
      { kind: "ringBand", at: "hand", mat: M.silver, x: 0.10, y: 0, z: 0.15 },
      { kind: "gem", at: "hand", mat: M.glint, s: 0.62, x: 0.10, y: 0.022, z: 0.175 },
    ];
    L.ringRock = [                                       // the $5M stone: same band, a rock you can spot
      { kind: "ringBand", at: "hand", mat: M.silver, x: 0.10, y: 0, z: 0.15 },
      { kind: "gem", at: "hand", mat: M.glint, s: 1.0, x: 0.10, y: 0.030, z: 0.182 },
    ];
    L.ringPinky = [
      { kind: "ringBand", at: "hand", mat: M.gold, s: 0.8, x: 0.145, y: -0.01, z: 0.14 },
      { kind: "gem", at: "hand", mat: M.ice, s: 0.5, x: 0.145, y: 0.010, z: 0.162 },
    ];
    // ---- earrings. THE OWNER BUG: this slot rendered nothing on the player and
    // a stray ring glint on a ped. The lobes are at the head box's sides
    // (0.60 cube on the neck anchor, so |x| = 0.30 is skin) and FORWARD of the
    // hair side panel, whose front face is z +0.12 — z 0.15 is what keeps a
    // stud out of a long-haired ped's hair.
    L.earrings = [
      { kind: "hoop", mat: M.gold, x: -0.322, y: 0.235, z: 0.15 },
      { kind: "hoop", mat: M.gold, x: 0.322, y: 0.235, z: 0.15 },
    ];
    L.earringsIce = [
      { kind: "gem", mat: M.glint, s: 0.6, x: -0.318, y: 0.265, z: 0.15 },
      { kind: "gem", mat: M.glint, s: 0.6, x: 0.318, y: 0.265, z: 0.15 },
    ];
    // ---- tiara: one merged arc across the front of the crown.
    L.tiara = [{ kind: "tiaraArc", mat: M.glint, x: 0, y: 0.50, z: 0 }];
    // ---- grill: teeth, and ON the mouth. The V1 bar sat at y 0.28 / z 0.265 —
    // that is above the mouth (character.js draws it at y 0.16) and 0.035 BEHIND
    // the head's own front face (z 0.30), i.e. buried inside the skull where
    // nobody could ever see it. The lip box's front plane is z 0.345, so the
    // teeth have to stand just proud of THAT, not of the skull.
    L.grill = [{ kind: "grillTeeth", mat: M.glint, x: 0, y: 0.172, z: 0.340 }];
  }
  // gang rag looks cached per gang id (one tiny array each, shared material)
  const _ragLooks = {};
  function ragLook(gangId) {
    let lk = _ragLooks[gangId];
    if (!lk) { lk = _ragLooks[gangId] = [{ kind: "rag", mat: ragMat(gangId), x: 0, y: 0.66, z: 0 }]; }
    return lk;
  }
  function customRagLook(mat, key) {
    let lk = _ragLooks[key];
    if (!lk) { lk = _ragLooks[key] = [{ kind: "rag", mat: mat, x: 0, y: 0.66, z: 0 }]; }
    return lk;
  }

  // ---- which rig anchor each slot hangs from. `ears` and `crown` ride the
  // neck (head) group with the rag and the shades, so they turn with the head.
  const SLOTS = { neck: "body", wristL: "la", wristR: "ra", ring: "ra", ears: "neck", crown: "neck", head: "neck", mouth: "neck", eyes: "neck" };
  const SLOT_KEYS = ["neck", "wristL", "wristR", "ring", "ears", "crown", "head", "mouth", "eyes"];
  // which slot a look belongs to — declared ONCE, beside the look names, so a
  // classifier can answer "where does this hang" without a second keyword pass.
  const LOOK_SLOT = {
    chainGold: "neck", chainIced: "neck", chainDiamond: "neck",
    watchSteel: "wristL", watchSilver: "wristL", watchGold: "wristL", watchIced: "wristL",
    watchDiver: "wristL", watchAP: "wristL", watchPatek: "wristL", watchRM: "wristL",
    bracelet: "wristR",
    ring: "ring", ringRock: "ring", ringPinky: "ring",
    earrings: "ears", earringsIce: "ears",
    tiara: "crown", grill: "mouth",
    shades: "eyes", shadesDesigner: "eyes",
  };
  // With BLING_V2 off the V1 table has no unicorns, no ears and no tiara — a
  // look key that does not exist there degrades to its nearest V1 sibling
  // rather than leaving a slot silently empty.
  const LOOK_V1 = {
    watchSteel: "watchSilver", watchAP: "watchIced", watchPatek: "watchGold", watchRM: "watchIced",
    ringRock: "ring", ringPinky: "ring",
  };
  function lookParts(key) {
    const L = looks();
    return (key && (L[key] || L[LOOK_V1[key]])) || null;
  }

  /* ---- ONE CLASSIFIER, AND THE CATALOG OUTRANKS IT ------------------------
     OWNER BUG: economy.js's jewel() rows have carried an explicit `blingLook`
     since the composable wardrobe shipped and this file classified by NAME
     KEYWORDS anyway — so the catalog could declare a look and be ignored, and
     the two sides could disagree with nobody noticing. The catalog is now read
     FIRST; keywords are the fallback that keeps the LOOT valuables working
     (Omega / Patek / Richard Mille carry no blingLook and never will, because
     they are loot rows, not wardrobe rows).
     Also fixed here: "Earrings" contains "ring". The player path used to except
     it by hand and the ped path did not, so an NPC carrying earrings wore a
     RING and you wore nothing. Order is the fix — earrings are tested before
     rings, once, for everybody.
     Returns { slot, look } (look is a KEY, resolved through lookParts at mount
     time so a flag flip re-points every wearer) or null for "not visible". */
  const _cls = Object.create(null);
  function classify(name) {
    if (!name) return null;
    const key = "" + name;
    const hit = _cls[key];
    if (hit !== undefined) return hit;
    const items = CBZ.cityEcon && CBZ.cityEcon.ITEMS;
    const res = classifyRaw(key, items ? items[key] : null);
    if (items) _cls[key] = res;      // only memoize once the catalog can answer
    return res;
  }
  function classifyRaw(name, it) {
    if (it && it.blingLook && LOOK_SLOT[it.blingLook]) return { slot: LOOK_SLOT[it.blingLook], look: it.blingLook };
    const s = name.toLowerCase();
    const iced = s.indexOf("iced") >= 0 || s.indexOf("diamond") >= 0;
    if (s.indexOf("grill") >= 0) return { slot: "mouth", look: "grill" };          // FIRST: its econ slot is "glasses"
    if (s.indexOf("tiara") >= 0) return { slot: "crown", look: "tiara" };
    if (s.indexOf("earring") >= 0) return { slot: "ears", look: iced ? "earringsIce" : "earrings" };
    if (s.indexOf("shades") >= 0 || s.indexOf("sunglass") >= 0) {
      return { slot: "eyes", look: s.indexOf("designer") >= 0 ? "shadesDesigner" : "shades" };
    }
    if (s.indexOf("chain") >= 0 || s.indexOf("necklace") >= 0) return { slot: "neck", look: chainLookKey(s) };
    if (s.indexOf("watch") >= 0 || s.indexOf("rolex") >= 0 || s.indexOf("omega") >= 0 ||
        s.indexOf("piguet") >= 0 || s.indexOf("audemars") >= 0 || s.indexOf("patek") >= 0 ||
        s.indexOf("philippe") >= 0 || s.indexOf("mille") >= 0) {
      return { slot: "wristL", look: watchLookKey(s) };
    }
    if (s.indexOf("bracelet") >= 0) return { slot: "wristR", look: "bracelet" };
    if (s.indexOf("ring") >= 0 || s.indexOf("pinky") >= 0) return { slot: "ring", look: ringLookKey(s) };
    return null;
  }
  function chainLookKey(s) {
    if (s.indexOf("necklace") >= 0 || s.indexOf("diamond") >= 0) return "chainDiamond";
    if (s.indexOf("iced") >= 0) return "chainIced";
    return "chainGold";
  }
  function watchLookKey(s) {
    if (s.indexOf("mille") >= 0 || s.indexOf("richard") >= 0) return "watchRM";
    if (s.indexOf("piguet") >= 0 || s.indexOf("audemars") >= 0) return "watchAP";
    if (s.indexOf("patek") >= 0 || s.indexOf("philippe") >= 0) return "watchPatek";
    if (s.indexOf("iced") >= 0 || s.indexOf("diamond") >= 0) return "watchIced";
    if (s.indexOf("diver") >= 0) return "watchDiver";
    if (s.indexOf("steel") >= 0 || s.indexOf("omega") >= 0 || s.indexOf("silver") >= 0) return "watchSteel";
    return "watchGold";                                  // a nameless watch keeps the V1 default
  }
  function ringLookKey(s) {
    if (s.indexOf("engagement") >= 0) return "ringRock"; // the $5M stone you learn to hunt
    if (s.indexOf("pinky") >= 0) return "ringPinky";
    return "ring";
  }

  // ---- mesh pools per part kind (reuse: dressing is pointer-swaps, not allocs) ----
  // (lazy per kind: V2 added a dozen part kinds and a hand-typed table of empty
  // arrays is exactly the sort of thing that silently loses one)
  const pools = Object.create(null);
  function poolFor(kind) { return pools[kind] || (pools[kind] = []); }
  function acquire(kind) {
    const pool = poolFor(kind);
    let mesh = pool && pool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(geoFor(kind), null);
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.userData.blingKind = kind;
    }
    mesh.visible = true;
    return mesh;
  }
  function releaseMesh(mesh) {
    if (!mesh) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    const pool = poolFor(mesh.userData.blingKind);
    if (pool && pool.length < POOL_MAX) pool.push(mesh);
  }

  // Landmarks in the forearm (ELBOW group) frame for the rig being dressed —
  // one call per dress, not per part. Degrade-safe: an old character.js with no
  // export, or CHAR_WRIST_LANDMARK=false, falls back to the adult-male numbers
  // this table used to hard-code, so nothing can be left unmounted.
  const LM_FALLBACK = { wrist: -0.22, hand: -0.34 };
  function armLandmarks(ch) {
    const f = CBZ.charArmLandmarks && CBZ.charArmLandmarks(ch);
    return f || LM_FALLBACK;
  }
  // mount one slot's parts onto an anchor; pushes the pooled meshes into `out`.
  // `lm` resolves a part's `at:` landmark — its y is then an OFFSET from that
  // point on THIS body, instead of an absolute authored for the adult male.
  // `s` scales a shared part instead of authoring a second geometry for it (a
  // pinky ring is a ring, a lume pip is a small stone) — always written, never
  // defaulted, because these meshes come back out of a pool wearing the last
  // wearer's scale.
  function mountParts(parts, parent, out, lm) {
    if (!parts || !parent || !parent.add) return;   // harness rigs have empty parts — skip slot
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const mesh = acquire(p.kind);
      mesh.material = p.mat;
      const base = (p.at && lm && lm[p.at] != null) ? lm[p.at] : 0;
      mesh.position.set(p.x, base + p.y, p.z);
      mesh.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
      const s = p.s == null ? 1 : p.s;
      mesh.scale.set(s, s, s);
      parent.add(mesh);
      out.push(mesh);
    }
  }

  // ---- what a ped SHOULD be wearing right now, straight from their valuables.
  // A looted corpse is picked clean (jewelry gone) but keeps its gang colors —
  // the rag is clothing, not loot. First match wins per slot (one chain, one
  // watch: legibility beats completeness). Each slot value is a parts LIST.
  function lootedOut(ped) {
    return !!(ped.dead && ped.deadLoot && ped.deadLoot.looted);
  }
  function computeWant(ped) {
    const want = {};
    let any = false;
    const vals = ped.valuables;
    if (!lootedOut(ped) && vals && vals.length) {
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i]; if (!v) continue;
        // ONE classifier for the street and for you — a Patek robbed off a
        // wrist is the same picture on yours (see classify()).
        const cl = classify("" + v);
        if (!cl || want[cl.slot]) continue;             // first match wins per slot
        const parts = lookParts(cl.look);
        if (!parts) continue;
        want[cl.slot] = parts; any = true;
      }
    }
    if (ped.gang) { want.head = ragLook(ped.gang); any = true; }
    return any ? want : null;
  }

  // ---- dress / undress (pooled). ped._bling = { meshes, nVal, looted, gang } ----
  const dressed = [];   // peds currently wearing meshes (≤ CAP)
  function anchorsOf(ped) {
    const ch = ped.char;
    if (!ch) return null;
    const laLow = ch.low && ch.low.la || (ch.parts && ch.parts.la && ch.parts.la.userData.low) || (ch.parts && ch.parts.la);
    const raLow = ch.low && ch.low.ra || (ch.parts && ch.parts.ra && ch.parts.ra.userData.low) || (ch.parts && ch.parts.ra);
    return { body: ch.body, neck: ch.neck, la: laLow, ra: raLow };
  }
  function dress(ped, want) {
    const an = anchorsOf(ped);
    if (!an) return;
    const meshes = [];
    const lm = armLandmarks(ped.char);
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const key = SLOT_KEYS[i];
      const parts = want[key]; if (!parts) continue;
      mountParts(parts, an[SLOTS[key]], meshes, lm);
    }
    if (!meshes.length) return;
    ped._bling = {
      meshes,
      nVal: ped.valuables ? ped.valuables.length : 0,
      looted: lootedOut(ped),
      gang: ped.gang || null,
    };
    dressed.push(ped);
  }
  function undress(ped) {
    const b = ped._bling;
    if (!b) return;
    for (let i = 0; i < b.meshes.length; i++) releaseMesh(b.meshes[i]);
    ped._bling = null;
    const j = dressed.indexOf(ped);
    if (j >= 0) dressed.splice(j, 1);
  }
  function clearAll() {
    for (let i = dressed.length - 1; i >= 0; i--) undress(dressed[i]);
  }

  // re-mirror ONE ped after their valuables changed (mug/loot/pickpocket):
  // strip, then re-dress with whatever they still have on (e.g. the gang rag
  // stays after a mugging — you took the ice, not the colors).
  function resyncPed(ped) {
    undress(ped);
    if (!ped || ped.culled || !ped.group || !ped.group.parent) return;
    const cam = CBZ.camera;
    if (!cam || !cam.position || dressed.length >= CAP()) return;
    const dx = ped.pos.x - cam.position.x, dz = ped.pos.z - cam.position.z;
    if (dx * dx + dz * dz > UNDRESS_D2) return;
    const want = computeWant(ped);
    if (want) dress(ped, want);
  }

  // ---- strip-on-take: wrap (never replace) the deed APIs, social.js-style.
  // Call the ORIGINAL first (preserving every side effect/return), then mirror
  // the victim's remaining bling. Only on a REAL take (ret truthy) — a no-op rob
  // must not flicker the chain off and on.
  function wrapStrip(name) {
    const orig = CBZ[name];
    if (typeof orig !== "function") return false;
    if (orig._blingWrapped) return true;
    const w = function (ped) {
      const ret = orig.apply(this, arguments);
      try { if (ret && ped && ped._bling) resyncPed(ped); } catch (e) { /* never break the deed */ }
      return ret;
    };
    w._blingWrapped = true; w._blingOrig = orig;
    CBZ[name] = w;
    return true;
  }
  let _wRob = false, _wLoot = false;

  // ============================================================
  //  YOUR OWN DRIP — the player's body shows the player's money.
  // ============================================================
  // What you OWN that reads on a body, classified ONCE from the econ catalog
  // (so a new luxe item added to ITEMS auto-shows with zero changes here).
  // The SAME classify() the ped path runs → same slots, same finishes: the
  // Patek on your wrist is indistinguishable from the one you robbed, and
  // neither side can grow a private exception for earrings again.
  let _flex = null;   // [{ name, slot, look, value }] — player-visible candidates
  function flexTable() {
    if (_flex) return _flex;
    const items = CBZ.cityEcon && CBZ.cityEcon.ITEMS;
    if (!items) return null;            // econ not booted yet — retry next tick
    _flex = [];
    for (const name in items) {
      const it = items[name];
      if (!it || (it.tag !== "wearable" && it.tag !== "valuable" && it.tag !== "jewelry")) continue;
      const cl = classify(name);        // catalog first, keywords second
      if (cl) _flex.push({ name: name, slot: cl.slot, look: cl.look, value: it.value || 0 });
    }
    return _flex;
  }

  // crew colors: your FOUNDED gang's color outranks the set you're patched into
  // (a boss flies his own flag). Returns { parts, key } or null. cmat caches per
  // color, so this is the same shared material every member of the crew wears.
  function playerRag() {
    const pg = g.playerGang;
    if (pg && pg.founded) {
      const col = pg.color != null ? pg.color : 0xb079ea;
      const key = "own:" + col;
      return { parts: customRagLook(CBZ.cmat(col, { emissive: col, ei: 0.12 }), key), key };
    }
    const m = g.cityMembership;
    if (m && m.gangId) return { parts: ragLook(m.gangId), key: "memb:" + m.gangId };
    return null;
  }

  // The player's SHOULD-WEAR set + a cheap signature (best item names + gang +
  // VIP flag). Best per slot = highest catalog value among what you still OWN —
  // sell or lose the piece and the next tick strips it off your body.
  function computePlayerWant() {
    const tab = flexTable();
    if (!tab) return null;
    const econ = CBZ.cityEcon;
    const best = {};
    for (let i = 0; i < tab.length; i++) {
      const e = tab[i];
      if (econ.count(e.name) <= 0) continue;
      const b = best[e.slot];
      if (!b || e.value > b.value) best[e.slot] = e;
    }
    // a VIP-level fit (the bouncer's elite read) ices the off-wrist even
    // without a Tennis Bracelet — full luxury reads iced on BOTH wrists.
    const drip = CBZ.cityPlayerDrip ? CBZ.cityPlayerDrip() | 0 : 0;
    const vip = drip >= ((CBZ.CITY && CBZ.CITY.VIP_DRIP) || 70);
    const rag = playerRag();
    const want = {};
    let any = false, sig = "";
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const k = SLOT_KEYS[i];
      if (k === "head") continue;                       // the rag is not an owned item
      const e = best[k];
      const parts = e ? lookParts(e.look) : null;
      if (parts) { want[k] = parts; any = true; }
      sig += (e ? e.name : "") + "|";
    }
    if (!want.wristR && vip) { want.wristR = lookParts("bracelet"); any = !!want.wristR || any; }
    if (rag) { want.head = rag.parts; any = true; }
    sig += (rag ? rag.key : "") + "|" + (vip ? 1 : 0);
    return { want: any ? want : null, sig };
  }

  // dress/undress the player rig — same SLOTS, same pooled meshes as peds.
  // No distance/CAP gating: it's a handful of tiny meshes and it IS the protagonist.
  let _pMeshes = null, _pSig = "", _pT = 0, _pDirty = false;
  function undressPlayer() {
    if (_pMeshes) for (let i = 0; i < _pMeshes.length; i++) releaseMesh(_pMeshes[i]);
    _pMeshes = null; _pSig = "";
  }
  function syncPlayer() {
    const res = computePlayerWant();
    if (!res) return;                          // econ not up yet
    if (res.sig === _pSig && (_pMeshes || !res.want)) return;   // unchanged
    if (_pMeshes) { for (let i = 0; i < _pMeshes.length; i++) releaseMesh(_pMeshes[i]); _pMeshes = null; }
    _pSig = res.sig;
    if (!res.want) return;
    const ch = CBZ.playerChar;
    if (!ch) { _pSig = ""; return; }           // rig not up — retry next tick
    // wristL(watch)/wristR(bracelet)/ring hang from the "la"/"ra" slot, which on
    // the two-segment rig MUST resolve to the ELBOW group (forearm frame) — the
    // watch's `at:"wrist"` landmark is solved in that frame. Resolving to ch.parts.la
    // (the SHOULDER pivot) instead put the player's watch up at the ARMPIT while
    // every ped + the portrait card (charpanel.js) used the elbow. Mirror
    // anchorsOf() exactly so all three paths agree.
    const laA = (ch.low && ch.low.la) || (ch.parts && ch.parts.la && ch.parts.la.userData.low) || (ch.parts && ch.parts.la);
    const raA = (ch.low && ch.low.ra) || (ch.parts && ch.parts.ra && ch.parts.ra.userData.low) || (ch.parts && ch.parts.ra);
    const an = { body: ch.body, neck: ch.neck, la: laA, ra: raA };
    const meshes = [];
    const lm = armLandmarks(ch);
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const key = SLOT_KEYS[i];
      const parts = res.want[key]; if (!parts) continue;
      mountParts(parts, an[SLOTS[key]], meshes, lm);
    }
    if (meshes.length) _pMeshes = meshes;
  }
  // instant-feedback hook (optional): shops/econ can poke this on buy/sell/equip
  // so the chain appears the FRAME you buy it; the 1s timer catches everything
  // anyway (sell, drop, rob-loss, gang join/leave) without any caller changes.
  CBZ.cityBlingPlayerDirty = function () { _pDirty = true; };
  CBZ.cityPlayerBlingCount = function () { return _pMeshes ? _pMeshes.length : 0; };

  // ---- per-frame: maintain the dressed set (cheap, ≤60), time-slice the scan ----
  let cursor = 0;
  CBZ.onUpdate(34.7, function (dt) {
    if (g.mode !== "city") {
      if (dressed.length) clearAll();
      if (_pMeshes) undressPlayer();           // jail jumpsuit wears no city ice
      return;
    }
    // the player's drip: re-derive at 1Hz (or next frame when poked dirty) —
    // a signature compare, so an unchanged inventory costs ~nothing.
    _pT -= dt || 0.016;
    if (_pDirty || _pT <= 0) { _pT = 1; _pDirty = false; syncPlayer(); }
    // lazy idempotent wrapping — load order with peds.js/social.js doesn't matter,
    // wrappers chain through whatever is current.
    if (!_wRob) _wRob = wrapStrip("cityRobPed");
    if (!_wLoot) _wLoot = wrapStrip("cityLootCorpse");
    const peds = CBZ.cityPeds, cam = CBZ.camera;
    if (!peds || !cam || !cam.position) return;
    const camx = cam.position.x, camz = cam.position.z;

    // 1) dressed peds: undress when far/gone; catch valuable changes that have
    //    no hook (pickpocket lucky dip, defection) via a cheap signature compare.
    for (let i = dressed.length - 1; i >= 0; i--) {
      const p = dressed[i], b = p._bling;
      if (!b) { dressed.splice(i, 1); continue; }
      if (p.culled || !p.group || !p.group.parent) { undress(p); continue; }
      const dx = p.pos.x - camx, dz = p.pos.z - camz;
      if (dx * dx + dz * dz > UNDRESS_D2) { undress(p); continue; }
      const nVal = p.valuables ? p.valuables.length : 0;
      if (nVal !== b.nVal || lootedOut(p) !== b.looted || (p.gang || null) !== b.gang) resyncPed(p);
    }

    // 2) sliced scan: dress newly-near peds (a few per frame; full roster ~every
    //    0.2s — fast enough that bling appears before you can read the face).
    const n = peds.length, cap = CAP();   // live read: slider moves the cap this frame
    if (!n || dressed.length >= cap) return;
    for (let k = 0; k < SLICE && dressed.length < cap; k++) {
      cursor = (cursor + 1) % n;
      const p = peds[cursor];
      if (!p || p._bling || p.culled || p._parked || p.inCar) continue;
      if (!p.group || !p.group.parent || !p.pos) continue;
      const dx = p.pos.x - camx, dz = p.pos.z - camz;
      if (dx * dx + dz * dz > DRESS_D2) continue;
      const want = computeWant(p);
      if (want) dress(p, want);
    }
  });

  // exposed for the harness/debug: how many peds are dressed right now.
  CBZ.cityBlingCount = function () { return dressed.length; };

  // ---- THE ONE ANSWER TO "WHAT DOES THIS ITEM LOOK LIKE ON A BODY" ---------
  // charpanel.js's portrait had its own copy of the geometry table, the finish
  // table, the part lists AND the slot classifier — a fourth copy that had
  // already drifted (it still tests `earring` by hand). These three exports
  // are what let a caller delete all four and stay identical to the street.
  CBZ.cityBlingClassify = classify;                    // name -> { slot, look } | null
  CBZ.cityBlingParts = function (name) {               // name -> parts list | null
    const cl = classify(name);
    return cl ? lookParts(cl.look) : null;
  };
  CBZ.cityBlingGeo = geoFor;                           // shared geometry per part kind
  // Mount a parts list on a rig OUTSIDE the pooled street path (the portrait's
  // offscreen rig). FRESH meshes on purpose: the pool belongs to the dressed
  // roster, and a caller that removes its meshes without releasing them would
  // drain it. Same shared geometry + materials, so the read is identical.
  CBZ.cityBlingBuild = function (parts, parent, out, lm) {
    if (!parts || !parent || !parent.add) return out || null;
    out = out || [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const geo = geoFor(p.kind);
      if (!geo || !p.mat) continue;
      const m = new THREE.Mesh(geo, p.mat);
      m.castShadow = false; m.receiveShadow = false;
      const base = (p.at && lm && lm[p.at] != null) ? lm[p.at] : 0;
      m.position.set(p.x, base + p.y, p.z);
      m.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
      const s = p.s == null ? 1 : p.s;
      m.scale.set(s, s, s);
      parent.add(m);
      out.push(m);
    }
    return out;
  };
  // RATCHET — every catalog row that can appear on a body, resolved through the
  // classifier the game actually runs. Never called here.
  //   holes      — a row the catalog itself calls jewellery (tag "jewelry", or
  //                an econ slot of chain/watch/ring/glasses) that renders
  //                NOTHING. THIS is the number that may only go DOWN: it read 1
  //                before this wave (Earrings) and 0 after. `unclassified` is
  //                informational — a Wallet is not a hole, it is a wallet.
  //   meshes/maxMeshes — the draw-call bill, printed beside the count so a look
  //                that gets fancier cannot hide what it costs.
  //   declared   — rows whose look came from economy.js instead of a keyword
  //                guess; it should climb as the catalog is filled in.
  const JEWEL_SLOTS = { chain: 1, watch: 1, ring: 1, glasses: 1 };
  CBZ.cityBlingAudit = function () {
    const items = CBZ.cityEcon && CBZ.cityEcon.ITEMS;
    const out = { rows: [], slots: {}, count: 0, declared: 0, holes: 0, holeNames: [], unclassified: 0, meshes: 0, maxMeshes: 0 };
    if (!items) return out;
    for (const name in items) {
      const it = items[name];
      if (!it || (it.tag !== "wearable" && it.tag !== "valuable" && it.tag !== "jewelry")) continue;
      const cl = classify(name);
      if (!cl) {
        out.unclassified++;
        if (it.tag === "jewelry" || JEWEL_SLOTS[it.slot]) { out.holes++; out.holeNames.push(name); }
        continue;
      }
      const parts = lookParts(cl.look);
      const n = parts ? parts.length : 0;
      if (!n) { out.holes++; out.holeNames.push(name); }
      out.rows.push({ name: name, slot: cl.slot, look: cl.look, meshes: n, declared: !!it.blingLook });
      out.slots[cl.slot] = (out.slots[cl.slot] || 0) + 1;
      if (it.blingLook) out.declared++;
      out.meshes += n;
      if (n > out.maxMeshes) out.maxMeshes = n;
    }
    out.count = out.rows.length;
    return out;
  };
  // re-mirror ONE ped's attachments after their valuables/colors changed
  // out-of-band — outfits.js calls this on the corpse-swap so the jewelry
  // read stays honest the moment the trade lands.
  CBZ.cityBlingResyncPed = resyncPed;
})();
