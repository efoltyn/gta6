/* ============================================================
   city/bling.js — VISIBLE wealth: the street-read made physical.
   WHY: the game is "make money + show off" — levels tell you WHO is
   dangerous, bling tells you WHO is worth robbing. A ped's rolled
   valuables (peds.js/economy.js: "Gold Chain", "Rolex", "Engagement
   Ring"…) already decide the payout; this makes them VISIBLE so you
   can spot the gold chain / iced watch with your EYES and pick your
   mark — no menus, no inspection, just looking at people. Gang
   members also get a crew-colored rag so a block reads at a glance.

   What you see:
     • neck   — chain loop on the chest (gold = Gold/Iced Chain,
                ice-white = Diamond Necklace)
     • wristL — watch band (gold = Rolex/Omega; iced = the luxe
                unicorns: AP / Patek / Richard Mille / Iced Watch —
                the brighter the wrist, the bigger the score)
     • ring   — tiny glint on the right hand (Engagement/Diamond
                Ring/Pinky — the $5M rock is a pixel of light you
                learn to hunt)
     • wristR — iced band (Tennis Bracelet)
     • head   — gang-colored rag (ped.gang), so crews read as crews

   PERF (the game is draw-call bound):
     • ONE shared geometry per accessory kind + ONE shared material
       per finish (gold/ice/glint; rag materials shared per gang
       color via cmat's cache). Meshes are POOLED and reused.
     • dress only within ~45u of the camera, undress past ~60u,
       hard cap 60 dressed peds, scan time-sliced (~14 peds/frame).
     • castShadow stays off — a 0.1u box's shadow is invisible.

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
  const CAP = 60;          // hard cap on dressed peds (≤ ~300 tiny meshes total)
  const SLICE = 14;        // peds scanned per frame (full roster every ~0.2s)
  const POOL_MAX = 48;     // per-kind pool bound; extras just drop (shared geo/mat)

  // ---- shared geometry per accessory KIND (lazy; built once, never disposed) ----
  const geos = {};
  function geoFor(kind) {
    let gm = geos[kind];
    if (gm) return gm;
    if (kind === "chain") {
      // a vertical loop lying on the chest reads as a necklace in blocky style.
      // Harness THREE stub has no TorusGeometry — fall back to a thin slab.
      gm = THREE.TorusGeometry ? new THREE.TorusGeometry(0.26, 0.045, 6, 14)
                               : new THREE.BoxGeometry(0.5, 0.5, 0.08);
      gm._shared = true;
    } else if (kind === "band") gm = CBZ.boxGeom(0.36, 0.1, 0.36);   // wraps the 0.3 arm
    else if (kind === "ring") gm = CBZ.boxGeom(0.12, 0.07, 0.12);
    else gm = CBZ.boxGeom(0.68, 0.18, 0.68);                          // rag: encloses hair
    geos[kind] = gm;
    return gm;
  }

  // ---- shared materials per FINISH (cmat caches; nothing here mutates them) ----
  let _mats = null;
  function mats() {
    if (_mats) return _mats;
    _mats = {
      gold: CBZ.cmat(0xffd451, { emissive: 0x7a5c00, ei: 0.5 }),
      ice: CBZ.cmat(0xeaf6ff, { emissive: 0x9fd8ff, ei: 0.65 }),
      glint: CBZ.cmat(0xffffff, { emissive: 0xcfeaff, ei: 0.95 }),
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

  // ---- where each slot sits on the rig (character.js hierarchy):
  //   body  = upper-body group (torso front face at z 0.25, collar at y 1.84)
  //   la/ra = arm pivots; hand cap centers at y ≈ -0.82 in pivot space
  //   neck  = head pivot; hair box at y 0.62 — the rag encloses it like a do-rag
  const SLOTS = {
    neck: { kind: "chain", anchor: "body", x: 0, y: 1.74, z: 0.27, rx: 0.12 },
    wristL: { kind: "band", anchor: "la", x: 0, y: -0.68, z: 0 },
    wristR: { kind: "band", anchor: "ra", x: 0, y: -0.68, z: 0 },
    ring: { kind: "ring", anchor: "ra", x: 0, y: -0.8, z: 0.22 },
    head: { kind: "rag", anchor: "neck", x: 0, y: 0.66, z: 0 },
  };
  const SLOT_KEYS = ["neck", "wristL", "wristR", "ring", "head"];

  // ---- mesh pools per kind (reuse: dressing is pointer-swaps, not allocs) ----
  const pools = { chain: [], band: [], ring: [], rag: [] };
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

  // ---- what a ped SHOULD be wearing right now, straight from their valuables.
  // A looted corpse is picked clean (jewelry gone) but keeps its gang colors —
  // the rag is clothing, not loot. First match wins per slot (one chain, one
  // watch: legibility beats completeness).
  function lootedOut(ped) {
    return !!(ped.dead && ped.deadLoot && ped.deadLoot.looted);
  }
  function computeWant(ped) {
    const M = mats();
    let neck = null, wristL = null, wristR = null, ring = null, head = null, any = false;
    const vals = ped.valuables;
    if (!lootedOut(ped) && vals && vals.length) {
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i]; if (!v) continue;
        const s = ("" + v).toLowerCase();
        if (!neck && (s.indexOf("chain") >= 0 || s.indexOf("necklace") >= 0)) {
          neck = s.indexOf("gold") >= 0 ? M.gold : M.ice; any = true;
        } else if (!wristL && (s.indexOf("rolex") >= 0 || s.indexOf("omega") >= 0 || s.indexOf("piguet") >= 0 ||
                               s.indexOf("patek") >= 0 || s.indexOf("mille") >= 0 || s.indexOf("watch") >= 0)) {
          // the luxe unicorns read ICED — the brighter the wrist, the fatter the fence.
          const luxe = s.indexOf("piguet") >= 0 || s.indexOf("patek") >= 0 || s.indexOf("mille") >= 0 || s.indexOf("iced") >= 0;
          wristL = luxe ? M.ice : M.gold; any = true;
        } else if (!ring && (s.indexOf("ring") >= 0 || s.indexOf("pinky") >= 0)) {
          ring = M.glint; any = true;
        } else if (!wristR && s.indexOf("bracelet") >= 0) {
          wristR = M.ice; any = true;
        }
      }
    }
    if (ped.gang) { head = ragMat(ped.gang); any = true; }
    if (!any) return null;
    return { neck, wristL, wristR, ring, head };
  }

  // ---- dress / undress (pooled). ped._bling = { meshes, nVal, looted, gang } ----
  const dressed = [];   // peds currently wearing meshes (≤ CAP)
  function anchorsOf(ped) {
    const ch = ped.char;
    if (!ch) return null;
    return { body: ch.body, neck: ch.neck, la: ch.parts && ch.parts.la, ra: ch.parts && ch.parts.ra };
  }
  function dress(ped, want) {
    const an = anchorsOf(ped);
    if (!an) return;
    const meshes = [];
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const key = SLOT_KEYS[i];
      const mtl = want[key]; if (!mtl) continue;
      const def = SLOTS[key];
      const parent = an[def.anchor];
      if (!parent || !parent.add) continue;     // harness rigs have empty parts — skip slot
      const mesh = acquire(def.kind);
      mesh.material = mtl;
      mesh.position.set(def.x, def.y, def.z);
      mesh.rotation.set(def.rx || 0, 0, 0);
      parent.add(mesh);
      meshes.push(mesh);
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
    if (!cam || !cam.position || dressed.length >= CAP) return;
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
  let _flex = null;   // [{ name, slot, luxe, value }] — player-visible candidates
  function flexTable() {
    if (_flex) return _flex;
    const items = CBZ.cityEcon && CBZ.cityEcon.ITEMS;
    if (!items) return null;            // econ not booted yet — retry next tick
    _flex = [];
    for (const name in items) {
      const it = items[name];
      if (!it || (it.tag !== "wearable" && it.tag !== "valuable")) continue;
      const s = name.toLowerCase();
      let slot = null, luxe = false;
      if (s.indexOf("chain") >= 0 || s.indexOf("necklace") >= 0) {
        slot = "neck"; luxe = s.indexOf("iced") >= 0 || s.indexOf("diamond") >= 0;
      } else if (s.indexOf("rolex") >= 0 || s.indexOf("omega") >= 0 || s.indexOf("piguet") >= 0 ||
                 s.indexOf("patek") >= 0 || s.indexOf("mille") >= 0 || s.indexOf("watch") >= 0) {
        slot = "wristL"; luxe = s.indexOf("piguet") >= 0 || s.indexOf("patek") >= 0 || s.indexOf("mille") >= 0 || s.indexOf("iced") >= 0;
      } else if (s.indexOf("earring") < 0 && (s.indexOf("ring") >= 0 || s.indexOf("pinky") >= 0)) {
        slot = "ring";                  // earrings stay off the hand — legibility
      } else if (s.indexOf("bracelet") >= 0) {
        slot = "wristR"; luxe = true;
      }
      if (slot) _flex.push({ name, slot, luxe, value: it.value || 0 });
    }
    return _flex;
  }

  // crew colors: your FOUNDED gang's color outranks the set you're patched into
  // (a boss flies his own flag). Returns { mat, key } or null. cmat caches per
  // color, so this is the same shared material every member of the crew wears.
  function playerRag() {
    const pg = g.playerGang;
    if (pg && pg.founded) {
      const col = pg.color != null ? pg.color : 0xb079ea;
      return { mat: CBZ.cmat(col, { emissive: col, ei: 0.12 }), key: "own:" + col };
    }
    const m = g.cityMembership;
    if (m && m.gangId) return { mat: ragMat(m.gangId), key: "memb:" + m.gangId };
    return null;
  }

  // The player's SHOULD-WEAR set + a cheap signature (best item names + gang +
  // VIP flag). Best per slot = highest catalog value among what you still OWN —
  // sell or lose the piece and the next tick strips it off your body.
  function computePlayerWant() {
    const tab = flexTable();
    if (!tab) return null;
    const econ = CBZ.cityEcon, M = mats();
    const best = { neck: null, wristL: null, wristR: null, ring: null };
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
      neck: best.neck ? (best.neck.luxe ? M.ice : M.gold) : null,
      wristL: best.wristL ? (best.wristL.luxe ? M.ice : M.gold) : null,
      wristR: best.wristR ? M.ice : (vip ? M.ice : null),
      ring: best.ring ? M.glint : null,
      head: rag ? rag.mat : null,
    };
    const any = want.neck || want.wristL || want.wristR || want.ring || want.head;
    const sig = (best.neck ? best.neck.name : "") + "|" + (best.wristL ? best.wristL.name : "") + "|" +
                (best.wristR ? best.wristR.name : "") + "|" + (best.ring ? best.ring.name : "") + "|" +
                (rag ? rag.key : "") + "|" + (vip ? 1 : 0);
    return { want: any ? want : null, sig };
  }

  // dress/undress the player rig — same SLOTS, same pooled meshes as peds.
  // No distance/CAP gating: it's ≤5 tiny meshes and it IS the protagonist.
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
    const an = { body: ch.body, neck: ch.neck, la: ch.parts && ch.parts.la, ra: ch.parts && ch.parts.ra };
    const meshes = [];
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const key = SLOT_KEYS[i];
      const mtl = res.want[key]; if (!mtl) continue;
      const def = SLOTS[key];
      const parent = an[def.anchor];
      if (!parent || !parent.add) continue;    // harness stubs — skip slot
      const mesh = acquire(def.kind);
      mesh.material = mtl;
      mesh.position.set(def.x, def.y, def.z);
      mesh.rotation.set(def.rx || 0, 0, 0);
      parent.add(mesh);
      meshes.push(mesh);
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
    const n = peds.length;
    if (!n || dressed.length >= CAP) return;
    for (let k = 0; k < SLICE && dressed.length < CAP; k++) {
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
})();
