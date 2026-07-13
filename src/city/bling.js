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
     • neck   — a thin chain lying FLAT against the upper chest: a
                shallow V of two slim links meeting at a small pendant
                just below the collar (gold = Gold Chain; thin silver
                links + white rock = Diamond Necklace; thicker iced
                links = Iced Chain). Never a hoop, never upright,
                never bigger than the head.
     • wristL — a thin watch band hugging the forearm just ABOVE the
                hand + a small face plate (gold = Rolex; silver =
                Omega; iced = the luxe unicorns: AP / Patek / Richard
                Mille / Iced Watch — the brighter the wrist, the
                bigger the score). Whole piece smaller than the hand.
     • ring   — tiny ≤0.05 glint on the right hand's edge (Engagement/
                Diamond Ring/Pinky — the $5M rock is a pixel of light
                you learn to hunt)
     • wristR — slim iced band (Tennis Bracelet)
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

  // dress within 45u, undress past 60u (hysteresis so border peds don't flicker)
  const DRESS_D2 = 45 * 45, UNDRESS_D2 = 60 * 60;
  // cap on dressed peds — rides the LIVE quality tier (lo 30 → hi 120, ≈ up to
  // ~5 tiny meshes each); read at every check so the slider applies instantly.
  const CAP = () => Math.round(CBZ.qScale ? CBZ.qScale(30, 120) : 60);
  const SLICE = 14;        // peds scanned per frame (full roster every ~0.2s)
  const POOL_MAX = 48;     // per-kind pool bound; extras just drop (shared geo/mat)

  // ---- shared geometry per accessory PART kind (lazy; built once, never disposed).
  // Real-jewelry scale against the rig (torso 0.92w, front face z 0.25; arm 0.3
  // square; hand cap 0.31 x 0.2 x 0.35; head 0.6 cube):
  const geos = {};
  function geoFor(kind) {
    let gm = geos[kind];
    if (gm) return gm;
    if (kind === "link") gm = CBZ.boxGeom(0.30, 0.035, 0.03);        // chain strand (gold chain)
    else if (kind === "linkThin") gm = CBZ.boxGeom(0.30, 0.026, 0.024); // diamond necklace's finer strand
    else if (kind === "linkThick") gm = CBZ.boxGeom(0.30, 0.055, 0.035); // iced chain's fat links
    else if (kind === "pendant") gm = CBZ.boxGeom(0.07, 0.07, 0.03);  // small flat pendant block
    else if (kind === "cuff") gm = CBZ.boxGeom(0.32, 0.05, 0.32);     // thin band wrapping the 0.3 forearm
    else if (kind === "face") gm = CBZ.boxGeom(0.10, 0.07, 0.03);     // watch face plate on the band
    else if (kind === "ring") gm = CBZ.boxGeom(0.05, 0.04, 0.05);     // a glint dot, not a knuckle-duster
    else if (kind === "grill") gm = CBZ.boxGeom(0.16, 0.05, 0.04);    // an iced bar across the mouth (a grill)
    else if (kind === "lens") gm = CBZ.boxGeom(0.20, 0.17, 0.05);     // one shade lens (two of these cover the eyes)
    else if (kind === "bridge") gm = CBZ.boxGeom(0.09, 0.055, 0.05);  // nose bridge joining the lenses
    else if (kind === "temple") gm = CBZ.boxGeom(0.035, 0.045, 0.30); // arm running back over the ear
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
  //   body — torso front face at z 0.25, collar bottom ≈ y 1.75
  //   la/ra — arm pivots; arm box 0..-0.92, hand cap spans y -0.92..-0.72
  //   neck — hair box at y 0.62
  // CHAIN: a shallow flat V hugging the upper chest — strand tops at x ±0.20
  // y 1.76 (under the collar), meeting at (0, 1.54); each strand is 0.30 long
  // tilted ±0.83 rad, sitting ~0.03 proud of the torso face. Pendant hangs at
  // the meet. WATCH: band at y -0.66 (forearm end, ABOVE the hand) + a face
  // plate on the outer front. RING: a dot on the front edge of the hand.
  const CHAIN_Y = 1.65, CHAIN_Z = 0.268, CHAIN_TILT = 0.83;
  let _looks = null;
  function looks() {
    if (_looks) return _looks;
    const M = mats();
    const v = function (kind, mat) {
      return [
        { kind: kind, mat: mat, x: -0.10, y: CHAIN_Y, z: CHAIN_Z, rz: -CHAIN_TILT },
        { kind: kind, mat: mat, x: 0.10, y: CHAIN_Y, z: CHAIN_Z, rz: CHAIN_TILT },
      ];
    };
    const watch = function (band, faceM) {
      return [
        { kind: "cuff", mat: band, x: 0, y: -0.20, z: 0 },
        { kind: "face", mat: faceM, x: 0, y: -0.20, z: 0.165 },
      ];
    };
    _looks = {
      // necklaces — flat V + pendant, all smaller than the head
      chainGold: v("link", M.gold).concat([{ kind: "pendant", mat: M.gold, x: 0, y: 1.515, z: 0.272 }]),
      chainDiamond: v("linkThin", M.silver).concat([{ kind: "pendant", mat: M.glint, x: 0, y: 1.515, z: 0.272 }]),
      chainIced: v("linkThick", M.ice).concat([{ kind: "pendant", mat: M.ice, x: 0, y: 1.515, z: 0.272 }]),
      // watches — thin band + face, on the WRIST (hand top is y -0.72)
      watchGold: watch(M.gold, M.gold),
      watchSilver: watch(M.silver, M.silver),
      watchIced: watch(M.ice, M.glint),
      watchSteel: watch(M.silver, M.silver),                                   // clean steel dress watch
      watchDiver: [{ kind: "cuff", mat: M.silver, x: 0, y: -0.20, z: 0 },      // steel band
        { kind: "face", mat: M.blueDial, x: 0, y: -0.20, z: 0.165 },           // signature blue dial
        { kind: "ring", mat: M.glint, x: 0, y: -0.14, z: 0.18 }],              // lume pip
      // tennis bracelet — band only
      bracelet: [{ kind: "cuff", mat: M.ice, x: 0, y: -0.20, z: 0 }],
      // ring — a glint dot on the hand's front edge
      ring: [{ kind: "ring", mat: M.glint, x: 0.10, y: -0.34, z: 0.17 }],
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
    return _looks;
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

  // ---- which rig anchor each slot hangs from ----
  const SLOTS = { neck: "body", wristL: "la", wristR: "ra", ring: "ra", head: "neck", mouth: "neck", eyes: "neck" };
  const SLOT_KEYS = ["neck", "wristL", "wristR", "ring", "head", "mouth", "eyes"];

  // shared finish classifiers — the SAME name reads the same on a ped and on you.
  function chainLookOf(s) {
    const L = looks();
    if (s.indexOf("necklace") >= 0 || s.indexOf("diamond") >= 0) return L.chainDiamond;
    if (s.indexOf("iced") >= 0) return L.chainIced;
    return L.chainGold;
  }
  function watchLookOf(s) {
    const L = looks();
    if (s.indexOf("piguet") >= 0 || s.indexOf("patek") >= 0 || s.indexOf("mille") >= 0 || s.indexOf("iced") >= 0) return L.watchIced;
    if (s.indexOf("diver") >= 0) return L.watchDiver;
    if (s.indexOf("steel") >= 0 || s.indexOf("omega") >= 0) return L.watchSilver;
    return L.watchGold;
  }
  function eyewearLookOf(s) {
    const L = looks();
    if (s.indexOf("designer") >= 0) return L.shadesDesigner;   // gold-framed mirror — the pricier flex
    return L.shades;
  }

  // ---- mesh pools per part kind (reuse: dressing is pointer-swaps, not allocs) ----
  const pools = { link: [], linkThin: [], linkThick: [], pendant: [], cuff: [], face: [], ring: [], grill: [], lens: [], bridge: [], temple: [], rag: [] };
  function acquire(kind) {
    const pool = pools[kind];
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
    const pool = pools[mesh.userData.blingKind];
    if (pool && pool.length < POOL_MAX) pool.push(mesh);
  }

  // mount one slot's parts onto an anchor; pushes the pooled meshes into `out`.
  function mountParts(parts, parent, out) {
    if (!parent || !parent.add) return;          // harness rigs have empty parts — skip slot
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const mesh = acquire(p.kind);
      mesh.material = p.mat;
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.set(p.rx || 0, 0, p.rz || 0);
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
    const L = looks();
    let neck = null, wristL = null, wristR = null, ring = null, head = null, eyes = null, any = false;
    const vals = ped.valuables;
    if (!lootedOut(ped) && vals && vals.length) {
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i]; if (!v) continue;
        const s = ("" + v).toLowerCase();
        if (!neck && (s.indexOf("chain") >= 0 || s.indexOf("necklace") >= 0)) {
          neck = chainLookOf(s); any = true;
        } else if (!wristL && (s.indexOf("rolex") >= 0 || s.indexOf("omega") >= 0 || s.indexOf("piguet") >= 0 ||
                               s.indexOf("patek") >= 0 || s.indexOf("mille") >= 0 || s.indexOf("watch") >= 0)) {
          // the luxe unicorns read ICED — the brighter the wrist, the fatter the fence.
          wristL = watchLookOf(s); any = true;
        } else if (!ring && (s.indexOf("ring") >= 0 || s.indexOf("pinky") >= 0)) {
          ring = L.ring; any = true;
        } else if (!wristR && s.indexOf("bracelet") >= 0) {
          wristR = L.bracelet; any = true;
        } else if (!eyes && (s.indexOf("shades") >= 0 || s.indexOf("sunglass") >= 0)) {
          // shades read as money on the FACE — same spot-the-mark cue as the chain.
          eyes = eyewearLookOf(s); any = true;
        }
      }
    }
    if (ped.gang) { head = ragLook(ped.gang); any = true; }
    if (!any) return null;
    return { neck, wristL, wristR, ring, head, eyes };
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
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const key = SLOT_KEYS[i];
      const parts = want[key]; if (!parts) continue;
      mountParts(parts, an[SLOTS[key]], meshes);
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
  // Same keyword classifier as ped computeWant → same slots, same finishes:
  // the Patek on your wrist is indistinguishable from the one you robbed.
  let _flex = null;   // [{ name, slot, value }] — player-visible candidates
  function flexTable() {
    if (_flex) return _flex;
    const items = CBZ.cityEcon && CBZ.cityEcon.ITEMS;
    if (!items) return null;            // econ not booted yet — retry next tick
    _flex = [];
    for (const name in items) {
      const it = items[name];
      if (!it || (it.tag !== "wearable" && it.tag !== "valuable" && it.tag !== "jewelry")) continue;
      const s = name.toLowerCase();
      let slot = null;
      if (s.indexOf("grill") >= 0) slot = "mouth";   // FIRST: "Diamond Grill"'s econ slot is "glasses" — keep it off the eyes
      else if (s.indexOf("shades") >= 0 || s.indexOf("sunglass") >= 0) slot = "eyes";
      else if (s.indexOf("chain") >= 0 || s.indexOf("necklace") >= 0) slot = "neck";
      else if (s.indexOf("rolex") >= 0 || s.indexOf("omega") >= 0 || s.indexOf("piguet") >= 0 ||
               s.indexOf("patek") >= 0 || s.indexOf("mille") >= 0 || s.indexOf("watch") >= 0) slot = "wristL";
      else if (s.indexOf("earring") < 0 && (s.indexOf("ring") >= 0 || s.indexOf("pinky") >= 0)) {
        slot = "ring";                  // earrings stay off the hand — legibility
      } else if (s.indexOf("bracelet") >= 0) slot = "wristR";
      if (slot) _flex.push({ name, slot, value: it.value || 0 });
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
    const econ = CBZ.cityEcon, L = looks();
    const best = { neck: null, wristL: null, wristR: null, ring: null, mouth: null, eyes: null };
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
    const want = {
      neck: best.neck ? chainLookOf(best.neck.name.toLowerCase()) : null,
      wristL: best.wristL ? watchLookOf(best.wristL.name.toLowerCase()) : null,
      wristR: (best.wristR || vip) ? L.bracelet : null,
      ring: best.ring ? L.ring : null,
      head: rag ? rag.parts : null,
      mouth: best.mouth ? L.grill : null,
      eyes: best.eyes ? eyewearLookOf(best.eyes.name.toLowerCase()) : null,
    };
    const any = want.neck || want.wristL || want.wristR || want.ring || want.head || want.mouth || want.eyes;
    const sig = (best.neck ? best.neck.name : "") + "|" + (best.wristL ? best.wristL.name : "") + "|" +
                (best.wristR ? best.wristR.name : "") + "|" + (best.ring ? best.ring.name : "") + "|" +
                (best.mouth ? best.mouth.name : "") + "|" + (best.eyes ? best.eyes.name : "") + "|" +
                (rag ? rag.key : "") + "|" + (vip ? 1 : 0);
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
    // watch offset (y -0.20) reads at the wrist there. Resolving to ch.parts.la
    // (the SHOULDER pivot) instead put the player's watch up at the ARMPIT while
    // every ped + the portrait card (charpanel.js) used the elbow. Mirror
    // anchorsOf() exactly so all three paths agree.
    const laA = (ch.low && ch.low.la) || (ch.parts && ch.parts.la && ch.parts.la.userData.low) || (ch.parts && ch.parts.la);
    const raA = (ch.low && ch.low.ra) || (ch.parts && ch.parts.ra && ch.parts.ra.userData.low) || (ch.parts && ch.parts.ra);
    const an = { body: ch.body, neck: ch.neck, la: laA, ra: raA };
    const meshes = [];
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const key = SLOT_KEYS[i];
      const parts = res.want[key]; if (!parts) continue;
      mountParts(parts, an[SLOTS[key]], meshes);
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
  // re-mirror ONE ped's attachments after their valuables/colors changed
  // out-of-band — outfits.js calls this on the corpse-swap so the jewelry
  // read stays honest the moment the trade lands.
  CBZ.cityBlingResyncPed = resyncPed;
})();
