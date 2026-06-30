/* ============================================================
   city/armor.js — HUMAN BODY ARMOR: the prop IS the stat.

   WHY (owner's #1 rule): armor is not a hidden number you "have" — it
   is a VEST you can SEE on a cop, PEEL off a SWAT corpse, and STRAP on
   yourself, where it visibly sits over your chest and a helmet caps
   your head. The armor BAR is just that prop's condition; when the pool
   hits zero the vest has done its job and visibly FALLS OFF ("ARMOR
   GONE"). Best armor (the SWAT plate) is police-issue: LOOT-ONLY — you
   cannot buy your way to the best, you have to take it off a body.

   The live damage pool is CBZ.player._armor (death.js already absorbs
   through it). This module UPGRADES that bare scalar into tiered, visible,
   lootable kits without changing death.js's pool contract:

     • CBZ.ARMOR_KITS        — the kit catalog (points / absorb / look)
     • CBZ.cityEquipArmor    — strap a kit on the PLAYER (mounts the mesh)
     • CBZ.cityArmorDressPed — mount armor on a cop/SWAT (pooled, cheap)
     • CBZ.cityArmorKitOf    — read a ped's kit record
     • CBZ.cityLootArmorFromCorpse — take a body's _armorLoot onto you
     • CBZ.cityArmorBroke    — vest spent → unmount + "ARMOR GONE" note

   The meshes are POOLED (bling.js pattern): ONE shared geometry per part
   + ONE shared material per kit finish, acquired/released, so dressing a
   wave of SWAT is draw-call cheap and survives ped promotion/recast.

   Mesh layout against the rig (entities/character.js):
     • torso box at body-local y 1.42 (0.92×0.95×0.5) → a vest is a
       slightly-inflated shell over it, mounted on ch.body.
     • neck pivot at y 1.88, head 0.6 cube at neck-local y 0.3 → a helmet
       is a shell over the head, mounted on ch.neck.

   Headless-safe: every THREE / rig / API touch is guarded so the harness
   (stub THREE, rigs with empty parts) never throws. A death-reset hook is
   wrapped around CBZ.cityDeathReset so the player's kit/pool/meshes clear
   on respawn (outfits.js wrap pattern).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const THREE = window.THREE;
  const g = CBZ.game;

  // ---- KIT CATALOG ----------------------------------------------------------
  // pts    : armor points the piece contributes to the pool (the bar's length).
  // absorb : fraction of an incoming BODY hit the pool eats (chest pieces).
  //          soft=pistol-grade, plate=rifle-grade, swat=best (loot-only).
  // headFrac: with a helmet on, a HEADSHOT only pushes this fraction through to
  //          flesh-equivalent absorb math (lower = better head protection).
  // color  : the vest/helmet tint so each tier reads at a glance.
  const ARMOR_KITS = {
    softVest:     { id: "softVest",     name: "Soft Vest",     slot: "chest", pts: 50,  absorb: 0.55, color: 0x2b2f36 },
    plateCarrier: { id: "plateCarrier", name: "Plate Carrier", slot: "chest", pts: 100, absorb: 0.72, color: 0x3a3d33 },
    swatVest:     { id: "swatVest",     name: "SWAT Plate",    slot: "chest", pts: 150, absorb: 0.82, color: 0x14161a, lootOnly: true },
    helmet:       { id: "helmet",       name: "Ballistic Helmet", slot: "head", pts: 25, headFrac: 0.25, color: 0x1b1d22 },
    shield:       { id: "shield",       name: "Riot Shield",   slot: "hand",  pts: 0 },
  };
  CBZ.ARMOR_KITS = ARMOR_KITS;
  function kit(id) { return id && ARMOR_KITS[id] ? ARMOR_KITS[id] : null; }

  // default absorb/headFrac when nothing is equipped (mirrors death.js fallbacks)
  const BASE_ABSORB = 0.7, BASE_HEADFRAC = 0.45;

  // ---- pooled meshes (bling.js pattern) ------------------------------------
  const POOL_MAX = 48;
  const geos = {}, pools = {};
  function geoFor(kind) {
    let gm = geos[kind];
    if (gm) return gm;
    if (!THREE || !CBZ.boxGeom) return null;
    // vest = inflated shell over the 0.92×0.95×0.5 torso; helmet = shell over the
    // 0.6 head cube; shield = a flat slab carried at the forearm.
    if (kind === "vest")        gm = CBZ.boxGeom(1.02, 0.86, 0.62);
    else if (kind === "vestHi") gm = CBZ.boxGeom(1.04, 0.30, 0.64);   // plate band across the chest
    else if (kind === "helmet") gm = CBZ.boxGeom(0.70, 0.46, 0.70);   // dome over the upper head
    else if (kind === "shield") gm = CBZ.boxGeom(0.04, 0.95, 0.62);
    else gm = CBZ.boxGeom(1.0, 0.8, 0.6);
    geos[kind] = gm;
    return gm;
  }
  function acquire(kind) {
    const pool = pools[kind] || (pools[kind] = []);
    let mesh = pool.pop();
    if (!mesh) {
      const gm = geoFor(kind);
      if (!gm || !THREE) return null;
      mesh = new THREE.Mesh(gm, null);
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.userData.armorKind = kind;
    }
    mesh.visible = true;
    return mesh;
  }
  function releaseMesh(mesh) {
    if (!mesh) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    const pool = pools[mesh.userData.armorKind];
    if (pool && pool.length < POOL_MAX) pool.push(mesh);
  }

  // ---- shared materials per kit finish (cmat caches by color) ---------------
  const _kitMat = {};
  function matFor(kitId, color) {
    let m = _kitMat[kitId];
    if (m) return m;
    if (!CBZ.cmat) return null;
    m = CBZ.cmat(color != null ? color : 0x2b2f36, { emissive: 0x0a0c0f, ei: 0.18 });
    _kitMat[kitId] = m;
    return m;
  }

  // build the pooled meshes for ONE chest kit + helmet onto a rig, push into out[].
  function mountKitMeshes(an, kitId, out) {
    const k = kit(kitId);
    if (!k || !an) return;
    if (k.slot === "chest" && an.body && an.body.add) {
      const mat = matFor(k.id, k.color);
      const vest = acquire("vest");
      if (vest) { vest.material = mat; vest.position.set(0, 1.40, 0); an.body.add(vest); out.push(vest); }
      // the harder kits get a raised plate band so a SWAT reads heavier than a beat-cop vest
      if (k.id !== "softVest") {
        const band = acquire("vestHi");
        if (band) { band.material = mat; band.position.set(0, 1.58, 0.02); an.body.add(band); out.push(band); }
      }
    } else if (k.slot === "head" && an.neck && an.neck.add) {
      const mat = matFor(k.id, k.color);
      const helm = acquire("helmet");
      if (helm) { helm.material = mat; helm.position.set(0, 0.40, 0); an.neck.add(helm); out.push(helm); }
    } else if (k.slot === "hand" && an.la && an.la.add) {
      const mat = matFor("shield", 0x3a3f47);
      const sh = acquire("shield");
      if (sh) { sh.material = mat; sh.position.set(0.32, -0.2, 0.18); an.la.add(sh); out.push(sh); }
    }
  }

  // ---- kit math: derive pool/absorb from a {chest,head} kit map -------------
  function kitPts(kitMap) {
    let pts = 0;
    if (!kitMap) return 0;
    const c = kit(kitMap.chest), h = kit(kitMap.head);
    if (c) pts += c.pts | 0;
    if (h) pts += h.pts | 0;
    return pts;
  }
  function kitAbsorb(kitMap) {
    const c = kitMap && kit(kitMap.chest);
    return c && c.absorb != null ? c.absorb : BASE_ABSORB;
  }
  function kitHeadFrac(kitMap) {
    const h = kitMap && kit(kitMap.head);
    return h && h.headFrac != null ? h.headFrac : BASE_HEADFRAC;
  }

  // ============================================================
  //  PLAYER
  // ============================================================
  let _pMeshes = null;   // pooled meshes currently on the player rig

  function playerAnchors() {
    const ch = CBZ.playerChar;
    if (!ch) return null;
    return { body: ch.body, neck: ch.neck, la: ch.parts && ch.parts.la, ra: ch.parts && ch.parts.ra };
  }
  function unmountPlayer() {
    if (!_pMeshes) return;
    for (let i = 0; i < _pMeshes.length; i++) releaseMesh(_pMeshes[i]);
    _pMeshes = null;
  }
  // (re)mirror the player's worn kit as meshes — strip then mount from _armorKit.
  function syncPlayerMesh() {
    unmountPlayer();
    const P = CBZ.player; if (!P || !P._armorKit) return;
    const an = playerAnchors();
    if (!an) return;
    const out = [];
    if (P._armorKit.chest) mountKitMeshes(an, P._armorKit.chest, out);
    if (P._armorKit.head)  mountKitMeshes(an, P._armorKit.head, out);
    if (out.length) _pMeshes = out;
  }
  CBZ.cityArmorPlayerResync = syncPlayerMesh;

  // ---- equip a kit on the player: set the slot, recompute pool/fractions,
  //      mount the visible mesh. Pool is RAISED to the equipped total (a fresh
  //      vest is full) but never lowered (a half-spent vest you re-mount keeps
  //      its wear). Returns true on a real equip.
  CBZ.cityEquipArmor = function (kitId) {
    const P = CBZ.player; if (!P) return false;
    const k = kit(kitId); if (!k) return false;
    if (!P._armorKit) P._armorKit = { chest: null, head: null };
    if (k.slot === "chest") P._armorKit.chest = k.id;
    else if (k.slot === "head") P._armorKit.head = k.id;
    else if (k.slot === "hand") P._armorKit.hand = k.id;   // shield: cosmetic, 0 pts
    const max = kitPts(P._armorKit);
    P._armorMax = max;
    P._armor = Math.max(P._armor || 0, max);               // a fresh kit tops you up
    P._armorAbsorb = kitAbsorb(P._armorKit);
    P._armorHeadFrac = kitHeadFrac(P._armorKit);
    syncPlayerMesh();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  };

  // ---- the vest is spent: unmount the prop (it visibly comes off) + flash a
  //      note. Called by death.js the instant the pool drains to 0. Keeps the
  //      kit fractions cleared so you're back to bare-flesh absorb.
  CBZ.cityArmorBroke = function () {
    const P = CBZ.player; if (!P) return;
    P._armor = 0; P._armorMax = 0;
    P._armorKit = { chest: null, head: null };
    P._armorAbsorb = BASE_ABSORB; P._armorHeadFrac = BASE_HEADFRAC;
    unmountPlayer();
    if (CBZ.city && CBZ.city.note) CBZ.city.note("🛡️ ARMOR GONE", 1.8);
    else if (CBZ.city && CBZ.city.big) CBZ.city.big("🛡️ ARMOR GONE");
    if (CBZ.sfx) try { CBZ.sfx("hit"); } catch (e) {}
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  };

  // ---- PED (cop/SWAT) armor: mount visible meshes + set the soak pool/kit ----
  // kitIds is an ordered list e.g. ["swatVest","helmet"]. Sets ped._armor (the
  // pool police.js's cityHurtCop drains), ped._armorKit (ids → the loot drop),
  // and ped._armorMax. Cheap pooled meshes; re-callable after a recast.
  CBZ.cityArmorDressPed = function (ped, kitIds) {
    if (!ped) return false;
    // strip any previous armor meshes first (recast / re-dress)
    if (ped._armorMeshes) { for (let i = 0; i < ped._armorMeshes.length; i++) releaseMesh(ped._armorMeshes[i]); ped._armorMeshes = null; }
    const ids = Array.isArray(kitIds) ? kitIds : (kitIds ? [kitIds] : []);
    const map = { chest: null, head: null, hand: null };
    let pts = 0;
    for (let i = 0; i < ids.length; i++) {
      const k = kit(ids[i]); if (!k) continue;
      if (k.slot === "chest") map.chest = k.id;
      else if (k.slot === "head") map.head = k.id;
      else if (k.slot === "hand") map.hand = k.id;
      pts += k.pts | 0;
    }
    ped._armorKit = ids.slice();          // flat id list — police.js copies this to _armorLoot on death
    ped._armorKitMap = map;
    ped._armorMax = pts;
    ped._armor = pts;                      // the soak pool
    // mount meshes (guarded: harness rigs have no body/neck)
    const ch = ped.char;
    const an = ch ? { body: ch.body, neck: ch.neck, la: ch.parts && ch.parts.la, ra: ch.parts && ch.parts.ra } : null;
    if (an) {
      const out = [];
      if (map.chest) mountKitMeshes(an, map.chest, out);
      if (map.head)  mountKitMeshes(an, map.head, out);
      if (map.hand)  mountKitMeshes(an, map.hand, out);
      if (out.length) ped._armorMeshes = out;
    }
    return true;
  };

  // ---- read a ped's kit record ----
  CBZ.cityArmorKitOf = function (ped) {
    if (!ped) return null;
    return ped._armorKitMap || (ped._armorKit ? { ids: ped._armorKit.slice() } : null);
  };

  // ---- take a corpse's dropped armor onto the player. Reads body._armorLoot
  //      (a flat id list police.js stamps on a downed cop), equips each piece,
  //      clears the loot so it's a one-time take, returns the ids taken. ----
  CBZ.cityLootArmorFromCorpse = function (body) {
    if (!body || !body._armorLoot || !body._armorLoot.length) return null;
    const took = [];
    for (let i = 0; i < body._armorLoot.length; i++) {
      const id = body._armorLoot[i];
      if (kit(id) && CBZ.cityEquipArmor(id)) took.push(id);
    }
    body._armorLoot = null;
    // the corpse's worn vest mesh comes OFF — it's on you now
    if (body._armorMeshes) { for (let i = 0; i < body._armorMeshes.length; i++) releaseMesh(body._armorMeshes[i]); body._armorMeshes = null; }
    if (took.length) {
      const names = took.map(function (id) { const k = kit(id); return k ? k.name : id; });
      if (CBZ.city && CBZ.city.big) CBZ.city.big("🛡️ Took their armor — " + names.join(" + "));
      else if (CBZ.city && CBZ.city.note) CBZ.city.note("🛡️ Took their armor", 2);
      if (CBZ.sfx) try { CBZ.sfx("loot"); } catch (e) {}
    }
    return took.length ? took : null;
  };

  // ---- corpse-armor pickup sweep: a downed cop/SWAT carrying _armorLoot offers
  //      its vest to a player who walks over it. Self-contained (the generic
  //      corpse-loot loop in interact.js only scans cityPeds for deadLoot — cop
  //      corpses live in cityCops and carry _armorLoot, not deadLoot). The PROP
  //      transfers on contact: you see the vest leave the body and appear on you.
  const PICK_R2 = 2.6 * 2.6;
  CBZ.onUpdate(38.5, function () {
    if (!g || g.mode !== "city" || g.state !== "playing") return;
    const P = CBZ.player; if (!P || P.dead || !P.pos) return;
    const px = P.pos.x, pz = P.pos.z;
    function trySrc(list) {
      if (!list) return false;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (!c || !c.dead || !c._armorLoot || !c._armorLoot.length || !c.pos) continue;
        const dx = c.pos.x - px, dz = c.pos.z - pz;
        if (dx * dx + dz * dz <= PICK_R2) { CBZ.cityLootArmorFromCorpse(c); return true; }
      }
      return false;
    }
    // one take per frame is plenty (you walked onto one body)
    if (trySrc(CBZ.cityCops)) return;
    trySrc(CBZ.cityPeds);
  });

  // also fold armor into the generic body-loot path: when interact.js loots a
  // body that happens to carry _armorLoot, take the vest too (lazy idempotent
  // wrap — bling.js pattern, load-order-proof).
  let _wLoot = false;
  function wrapLoot() {
    const orig = CBZ.cityLootCorpse;
    if (typeof orig !== "function" || orig._armorWrapped) return !!(orig && orig._armorWrapped);
    const w = function (ped) {
      const ret = orig.apply(this, arguments);
      try { if (ret && ped && ped._armorLoot && ped._armorLoot.length) CBZ.cityLootArmorFromCorpse(ped); } catch (e) {}
      return ret;
    };
    w._armorWrapped = true; w._armorOrig = orig;
    CBZ.cityLootCorpse = w;
    return true;
  }
  CBZ.onUpdate(38.6, function () {
    if (!_wLoot) _wLoot = wrapLoot();
    // drop the player's mesh when we leave city mode (mirror bling.js) so the
    // jail jumpsuit / survival rig never wears a city vest.
    if (g && g.mode !== "city" && _pMeshes) unmountPlayer();
  });

  // ---- death-reset hook: clear the player's kit + pool + meshes on respawn.
  //      Wrap (never replace) CBZ.cityDeathReset — outfits.js pattern. Also runs
  //      a guarded immediate clear if death.js hasn't loaded yet (it does).
  function clearPlayerArmor() {
    const P = CBZ.player; if (!P) return;
    P._armor = 0; P._armorMax = 0;
    P._armorKit = { chest: null, head: null };
    P._armorAbsorb = BASE_ABSORB; P._armorHeadFrac = BASE_HEADFRAC;
    unmountPlayer();
  }
  CBZ.cityArmorResetPlayer = clearPlayerArmor;
  (function wrapDeathReset() {
    const orig = CBZ.cityDeathReset;
    if (typeof orig === "function") {
      if (orig._armorWrapped) return;
      const w = function () { const r = orig.apply(this, arguments); try { clearPlayerArmor(); } catch (e) {} return r; };
      w._armorWrapped = true; w._armorOrig = orig;
      CBZ.cityDeathReset = w;
    } else {
      // death.js loads after us in some orders — install a placeholder that the
      // real one can chain through once it lands (re-wrap on first frame).
      let done = false;
      CBZ.onUpdate(38.7, function () {
        if (done) return;
        const o = CBZ.cityDeathReset;
        if (typeof o === "function" && !o._armorWrapped) {
          const w = function () { const r = o.apply(this, arguments); try { clearPlayerArmor(); } catch (e) {} return r; };
          w._armorWrapped = true; w._armorOrig = o;
          CBZ.cityDeathReset = w; done = true;
        }
      });
    }
  })();

  // seed the player fields so death.js's reads are always defined, even before
  // the first equip (death.js has its own fallbacks, but this keeps the bar/HUD
  // honest from frame 0).
  (function seed() {
    const P = CBZ.player;
    if (!P) return;
    if (P._armorKit == null) P._armorKit = { chest: null, head: null };
    if (P._armorMax == null) P._armorMax = 0;
    if (P._armor == null) P._armor = 0;
    if (P._armorAbsorb == null) P._armorAbsorb = BASE_ABSORB;
    if (P._armorHeadFrac == null) P._armorHeadFrac = BASE_HEADFRAC;
  })();
})();
