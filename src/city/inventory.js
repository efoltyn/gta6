/* ============================================================
   city/inventory.js — INVENTORY V2: the Minecraft-like city inventory.

   WHAT THIS IS (owner's order): guns live in your inventory like items,
   the inventory is a real slot GRID you can rearrange ([I], hosted by
   charpanel's overlay — this module renders the interactive grid into
   it), anything can be DROPPED on the ground as a pickup, any armed
   death drops the guns (the existing NPC/cop drops stay; this module
   adds the PLAYER's death drop by wrapping CBZ.cityKillPlayer), and
   CHESTS can be placed in the world to stash excess loot. Crafting is
   DELETED outright (owner mandate; systems/craft.js is gone).

   DESIGN: a slot-grid VIEW over the two existing truth stores — never a
   third store. g.cityInv ({name:count}, CBZ.cityEcon add/take/count) is
   the count truth for items; CBZ.weaponInventory (engine id strings) +
   g.cityMeleeWeapon are the truth for weapons. Rearranging slots never
   touches truth; truth only moves on the three real operations:
     • drop to ground  → CBZ.cityDropItem world pickup (physical prop)
     • chest transfer  → cityEcon.take/add or weaponInventory splice/unlock
     • death drop      → cityKillPlayer wrap (guns leave the corpse)
   resync() reconciles the grid against truth with STABLE placement (the
   systems/inventory.js pattern): correctly-placed stacks never move.

   HOTBAR: the city already has ONE unified quick bar —
   CBZ.cityHotbar()/cityHotbarSelect (fpsmode.js), drawn Minecraft-style
   by city/hud.js (#cSlots, CITY_HUD_MC) with number keys [1]-[9] wired.
   We do NOT draw a second bar next to it; this module carries a
   fallback bar (#invHotbar, same source, same indices, click-to-select)
   that only appears if the hud.js bar is absent, so a hotbar is ALWAYS
   on screen during city play no matter which HUD variant is loaded.

   PERSISTENCE: worldstate ledger (the storage.js pattern) — add-only
   fields w.invSlots (slot arrangement) + w.chests ([{id,x,z,slots}]),
   hydrated once per run behind g._cityInvHydrated/g._cityChestsHydrated,
   plain JSON only (never a mesh). Chest meshes rebuild on arena change.

   Feature flag: CBZ.CONFIG.INVENTORY_V2 (config.js, default true) — flip
   false and this whole module inerts (charpanel falls back to its old
   read-only grid; player death keeps guns again).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !CBZ.onUpdate || !window.THREE) return;
  const THREE = window.THREE;
  const g = CBZ.game;
  if (!g) return;

  function on() { return !CBZ.CONFIG || CBZ.CONFIG.INVENTORY_V2 !== false; }
  function econ() { return CBZ.cityEcon || null; }
  function items() { const e = econ(); return (e && e.ITEMS) || {}; }
  function cityNow() { return g.mode === "city"; }
  function playing() { return g.state === "playing"; }
  function arena() { return (CBZ.city && CBZ.city.arena) || null; }
  function arenaRoot() { const a = arena(); return a ? a.root : null; }
  function floorY(x, z) { if (CBZ.floorAt) { try { return CBZ.floorAt(x, z) || 0; } catch (e) {} } return 0; }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s); }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  if (CBZ.weaponPhysics && CBZ.weaponPhysics.adopt) CBZ.weaponPhysics.adopt("inventory-drops");

  // ============================================================
  //  CATALOG GLUE
  // ============================================================
  const MAIN_N = 27, CHEST_N = 27;
  const REACH = 2.2;                     // chest open reach
  const CHEST_COST = 250;

  // stack caps by econ tag (Minecraft-ish: bulk stacks big, weapons never)
  const STACK_BY_TAG = {
    weapon: 1, resource: 64, drug: 32, ammo: 16, throwable: 16,
    food: 16, tool: 16, valuable: 16, wearable: 8,
  };
  const STACK_DEFAULT = 16;

  function itemTag(name) { const it = items()[name]; return (it && it.tag) || null; }
  function stackCap(name) {
    const t = itemTag(name);
    const cap = t != null && STACK_BY_TAG[t] != null ? STACK_BY_TAG[t] : STACK_DEFAULT;
    return cap;
  }

  // the "Chest" item itself — registered into the live catalog at runtime so
  // no shop/economy file needs an edit (ITEMS is exported by reference).
  function registerChestItem() {
    const IT = items();
    // `place:true` is what stops a carried chest being an inert box in the bag
    // — it is the field city/itemicons.js reads to give it the PLACE verb.
    if (IT && !IT.Chest) IT.Chest = { value: CHEST_COST, tag: "tool", place: true };
    else if (IT && IT.Chest && !IT.Chest.place) IT.Chest.place = true;
  }

  // engine weapon id -> city item name (economy.js ITEMS `gun` uses a couple of
  // legacy ids that differ from the engine's, so fix those up explicitly).
  const GUN_NAME_FIX = { sidearm: "Pistol", carbine: "Rifle", taser: "Taser", bazooka: "Rocket Launcher" };
  function gunName(id) {
    if (GUN_NAME_FIX[id]) return GUN_NAME_FIX[id];
    const IT = items();
    for (const name in IT) if (IT[name] && IT[name].gun === id) return name;
    return id;
  }

  // ---- ITEM FACES ---------------------------------------------------------
  // This module used to carry its OWN name->glyph table (one of four in the
  // game), and every entry in it had been emptied to "" by the repo-wide emoji
  // strip — so `ICON[name] || TAG_ICON[tag] || "▪"` resolved to "▪" for EVERY
  // item you have ever carried. That is the owner's "super unclear icons".
  // city/itemicons.js draws the real thing from the item's KIND (so a pelt
  // registered at runtime by a species added tomorrow is drawn too, in that
  // animal's own colour). The "▪" stays only as the flag-off fallback.
  function iconFor(name) { return "▪"; }
  function itemFace(name, cls) {
    if (CBZ.itemIconHtml) { const h = CBZ.itemIconHtml(name, items()[name], cls); if (h) return h; }
    return "<span class='ic'>" + iconFor(name) + "</span>";
  }
  function itemTitle(name, count) {
    if (CBZ.itemTip) { try { return CBZ.itemTip(name, items()[name], count); } catch (e) {} }
    return String(name);
  }
  // A GUN IN A WEAPON SLOT AND A GUN IN AN ITEM SLOT MUST BE THE SAME PICTURE.
  // This used to call weapon_thumbnails.js directly — a second offscreen
  // renderer with its own 180x100 frame — so the grid could show the same
  // pistol two ways depending on which store held it. itemicons.js photographs
  // everything now, guns included; weaponThumbnail stays as the degrade.
  function weaponFace(id, name, className) {
    let src = "";
    try { if (CBZ.itemIconGun) src = CBZ.itemIconGun(id || name); } catch (e) {}
    if (!src) { try { if (CBZ.weaponThumbnail) src = CBZ.weaponThumbnail(id || name); } catch (e) {} }
    return src ? "<img class='" + (className || "gunThumb") + "' src='" + src + "' alt=''>"
      : itemFace(name, "");
  }

  // ============================================================
  //  SLOT MODEL — entries are plain JSON (never a mesh / THREE ref):
  //    null
  //    { kind:"item",   name, count }
  //    { kind:"weapon", id, name }             (gun — weaponInventory truth)
  //    { kind:"weapon", melee:true, name }     (g.cityMeleeWeapon truth)
  // ============================================================
  const MAIN = new Array(MAIN_N).fill(null);
  let cursor = null;             // entry held on the mouse
  let cursorSrc = "p";           // which container it was lifted from: "p"|"c"
  const ptr = { x: 0, y: 0 };

  function entryLabel(e) { return e ? e.name : ""; }
  function isGun(e) { return !!(e && e.kind === "weapon" && !e.melee); }
  function isMelee(e) { return !!(e && e.kind === "weapon" && e.melee); }
  function entryCap(e) { return !e ? 0 : (e.kind === "weapon" ? 1 : stackCap(e.name)); }
  function cloneEntry(e) { return e ? JSON.parse(JSON.stringify(e)) : null; }

  function firstFree(grid) { for (let i = 0; i < grid.length; i++) if (!grid[i]) return i; return -1; }

  // does the melee equip ALSO exist as a counted city item? (craft path adds
  // Hatchet to cityInv AND equips it) — then the item stack already shows it
  // and the pseudo melee entry would double-display.
  function meleeShownAsItem() {
    const m = g.cityMeleeWeapon;
    return !!(m && econ() && econ().count(m) > 0);
  }

  // ---- resync: reconcile the grid VIEW against the truth stores. Stable:
  //      a correctly-placed stack never moves; new stuff lands in firstFree.
  function resync() {
    if (!on()) return;
    ensureHydrated();
    const E = econ(); if (!E) return;
    const inv = g.cityInv || {};
    const wids = CBZ.weaponInventory || [];

    // 1) prune entries whose referent vanished (+ dedupe weapon ids)
    const seenW = {};
    for (let i = 0; i < MAIN_N; i++) {
      const s = MAIN[i]; if (!s) continue;
      if (s.kind === "item") { if (!((inv[s.name] | 0) > 0)) MAIN[i] = null; }
      else if (s.melee) { if (g.cityMeleeWeapon !== s.name || meleeShownAsItem()) MAIN[i] = null; }
      else {
        if (wids.indexOf(s.id) < 0 || seenW[s.id]) MAIN[i] = null;
        else seenW[s.id] = true;
      }
    }

    // 2) reconcile item counts (cursor counts toward "have" so an open pick
    //    isn't re-materialized into the grid)
    for (const name in inv) {
      const target = inv[name] | 0; if (target <= 0) continue;
      let have = 0;
      for (let i = 0; i < MAIN_N; i++) { const s = MAIN[i]; if (s && s.kind === "item" && s.name === name) have += s.count; }
      if (cursor && cursor.kind === "item" && cursor.name === name && cursorSrc === "p") have += cursor.count;
      if (have < target) {
        let need = target - have;
        const cap = stackCap(name);
        // top up existing partial stacks first
        for (let i = 0; i < MAIN_N && need > 0; i++) {
          const s = MAIN[i];
          if (s && s.kind === "item" && s.name === name && s.count < cap) { const d = Math.min(cap - s.count, need); s.count += d; need -= d; }
        }
        // then new stacks in free slots
        while (need > 0) {
          const f = firstFree(MAIN);
          if (f < 0) {
            // grid full: overflow onto the first stack of this name so the
            // inventory never LIES about what you own (display over cap).
            let dumped = false;
            for (let i = 0; i < MAIN_N; i++) { const s = MAIN[i]; if (s && s.kind === "item" && s.name === name) { s.count += need; need = 0; dumped = true; break; } }
            if (!dumped) need = 0;   // no slot at all — invisible but still owned
            break;
          }
          const c = Math.min(stackCap(name), need);
          MAIN[f] = { kind: "item", name, count: c };
          need -= c;
        }
      } else if (have > target) {
        let extra = have - target;
        for (let i = MAIN_N - 1; i >= 0 && extra > 0; i--) {
          const s = MAIN[i];
          if (s && s.kind === "item" && s.name === name) {
            const d = Math.min(s.count, extra); s.count -= d; extra -= d;
            if (s.count <= 0) MAIN[i] = null;
          }
        }
      }
    }
    // prune item stacks whose name left inv entirely was done in (1)

    // 3) weapons not yet shown get a slot
    for (let w = 0; w < wids.length; w++) {
      const id = wids[w];
      let shown = false;
      for (let i = 0; i < MAIN_N; i++) { const s = MAIN[i]; if (isGun(s) && s.id === id) { shown = true; break; } }
      if (!shown && cursor && isGun(cursor) && cursor.id === id) shown = true;
      if (!shown) { const f = firstFree(MAIN); if (f >= 0) MAIN[f] = { kind: "weapon", id, name: gunName(id) }; }
    }
    if (g.cityMeleeWeapon && !meleeShownAsItem()) {
      let shown = false;
      for (let i = 0; i < MAIN_N; i++) { const s = MAIN[i]; if (isMelee(s) && s.name === g.cityMeleeWeapon) { shown = true; break; } }
      if (!shown && cursor && isMelee(cursor) && cursor.name === g.cityMeleeWeapon) shown = true;
      if (!shown) { const f = firstFree(MAIN); if (f >= 0) MAIN[f] = { kind: "weapon", melee: true, name: g.cityMeleeWeapon }; }
    }
  }

  // ============================================================
  //  TRUTH MUTATIONS — the only places a slot op touches the stores.
  // ============================================================
  function removeGunFromLoadout(id) {
    const wids = CBZ.weaponInventory; if (!wids) return;
    const at = wids.indexOf(id);
    if (at >= 0) wids.splice(at, 1);
    if (CBZ.currentWeaponId === id) {
      CBZ.currentWeaponId = wids[0] || null;
      if (CBZ.currentWeaponId && CBZ.onWeaponInventoryChanged) { try { CBZ.onWeaponInventoryChanged(CBZ.currentWeaponId, false); } catch (e) {} }
    }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // move `count` of `entry` OUT of the player's truth (into a chest / the ground)
  function truthRemove(entry, count) {
    const E = econ(); if (!E) return false;
    if (entry.kind === "item") return E.take(entry.name, count || entry.count);
    if (entry.melee) { if (g.cityMeleeWeapon === entry.name) g.cityMeleeWeapon = null; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); return true; }
    removeGunFromLoadout(entry.id);
    return true;
  }
  // move `count` of `entry` INTO the player's truth
  function truthAdd(entry, count) {
    const E = econ(); if (!E) return false;
    if (entry.kind === "item") { E.add(entry.name, count || entry.count); return true; }
    if (entry.melee) {
      if (g.cityMeleeWeapon && g.cityMeleeWeapon !== entry.name) { note("Hands full, stash your " + g.cityMeleeWeapon + " first.", 1.8); return false; }
      g.cityMeleeWeapon = entry.name;
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      return true;
    }
    if (CBZ.unlockWeapon) CBZ.unlockWeapon(entry.id, { select: false });
    return true;
  }
  // an entry crossing between the player grid ("p") and a chest grid ("c")
  function crossTransfer(entry, count, to) {
    if (to === "c") return truthRemove(entry, count);
    return truthAdd(entry, count);
  }

  // ============================================================
  //  WORLD ITEM DROPS — CBZ.cityDropItem(x, z, payload)
  //  payload: { name, count } | { weaponId, ammo } | { melee } | { cash }
  //           (+ y?, ttl?)
  //  Kept SEPARATE from peds.js's CBZ.cityDrops so its weapon-only pickup
  //  loop never mishandles an item record. Shared geometry, pooled cmat.
  // ============================================================
  CBZ.cityItemDrops = CBZ.cityItemDrops || [];
  // Drops use recognizable, non-emissive props. No green cube, no light beam,
  // no spinning/bobbing pickup marker: the object on the pavement is the item.
  const DROP_GEO = new Map();
  const DROP_MAT = {};
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
  function sharedMat(key, color) {
    if (!DROP_MAT[key]) {
      DROP_MAT[key] = new THREE.MeshLambertMaterial({ color: color });
      DROP_MAT[key]._shared = true;
    }
    return DROP_MAT[key];
  }
  function boxGeo(sx, sy, sz) {
    const key = "b|" + sx + "|" + sy + "|" + sz;
    let geo = DROP_GEO.get(key);
    if (!geo) { geo = new THREE.BoxGeometry(sx, sy, sz); geo._shared = true; DROP_GEO.set(key, geo); }
    return geo;
  }
  // (the cylinder helper this block used to carry went with the four models it
  // served — city/itemassets.js has its own, and it caches more shapes than a
  // drop path ever needed.)
  function propBox(parent, sx, sy, sz, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(boxGeo(sx, sy, sz), mat);
    m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = true; parent.add(m); return m;
  }
  // what the degrade crate is painted with. The rest of this palette went to
  // city/itemassets.js with the models that used it.
  const PM = {
    case: sharedMat("case", 0x3a2719), trim: sharedMat("trim", 0x17191d),
    cloth: sharedMat("cloth", 0x354553), steel: sharedMat("steel", 0x929ba5),
  };

  // ---- THE THING ON THE PAVEMENT IS THE THING ------------------------------
  // OWNER (2026-07-28): "if it isn't an asset that can be shrunk, why is it a
  // thing that can be an icon? Make the asset then." Those assets live in
  // city/itemassets.js now, and it is the SAME registry city/itemicons.js
  // photographs for the slot — so a Boar Hide in your bag and a Boar Hide you
  // just threw on the ground are one model instead of two guesses.
  //
  // What that fixed here: every non-gun, non-cash drop in this game was a
  // BACKPACK. You dropped a hide, a fillet, a gold bar, a bottle of pills, and
  // a rucksack appeared on the kerb. The four models below MOVED into the
  // registry (byte-identical dimensions and palettes, so a saved chest is the
  // chest it always was); what is left here is the degrade, and it is
  // deliberately a plain crate — a fallback that looks like a real asset is how
  // you stop noticing the registry never loaded.
  function assetProp(name, row, kind, opts) {
    if (!CBZ.itemAssetPickup) return null;
    let o = null;
    if (kind || opts) { o = opts ? Object.assign({}, opts) : {}; if (kind) o.kind = kind; }
    let m = null;
    try { m = CBZ.itemAssetPickup(name || null, row || null, o); } catch (e) { m = null; }
    // itemAssetPickup seats its asset ON y=0, so the drop sites below must not
    // ALSO apply their old "lift a gun 18 cm off the deck" fudge — that fudge
    // existed because buildActorWeapon's origin is a hand, not a floor.
    if (m) m.userData._assetSeated = true;
    return m;
  }
  function crateDegrade(w, h, d, mat) {
    const g0 = new THREE.Group();
    propBox(g0, w, h, d, mat || PM.case, 0, h * 0.5, 0);
    propBox(g0, w * 1.02, h * 0.12, d * 1.02, PM.trim, 0, h * 0.5, 0);
    return g0;
  }
  function makeBriefcase(small) {
    return assetProp("Briefcase of Cash", null, "briefcase", { small: !!small }) ||
      crateDegrade(small ? 0.59 : 0.82, small ? 0.27 : 0.38, small ? 0.16 : 0.22, PM.case);
  }
  function makeBackpack() {
    return assetProp(null, null, "backpack", null) || crateDegrade(0.56, 0.66, 0.28, PM.cloth);
  }
  function makeMelee(name) {
    return assetProp(name, null, "melee", null) || crateDegrade(0.16, 0.10, 0.90, PM.steel);
  }
  function makeWeapon(nameOrId) {
    // The registry's `gun` builder IS this function's old body — buildActorWeapon
    // unmounted from the hand and given the pistol's ground-visibility nudge —
    // so the drop and the icon photograph the same object by construction.
    const a = assetProp(nameOrId, { gun: nameOrId }, "gun", null);
    if (a) {
      // Keep the newer ground-weapon contract on the registry wrapper itself.
      // Physics, pickup QA and NPC-drop replacement inspect the drop root; the
      // authored child mesh carrying this id is not an equivalent public seam.
      a.userData.weaponId = String(nameOrId || "sidearm");
      return a;
    }
    let model = null;
    try { if (CBZ.buildActorWeapon) model = CBZ.buildActorWeapon(nameOrId); } catch (e) {}
    if (!model) {
      const g0 = new THREE.Group();
      propBox(g0, 0.18, 0.14, 0.72, PM.steel, 0, 0.13, -0.22);
      propBox(g0, 0.15, 0.32, 0.16, PM.trim, 0, -0.03, 0.12, -0.2, 0, 0);
      model = g0;
    } else {
      // buildActorWeapon returns a hand-mounted transform; the appearance
      // itself is already authored along the ground plane, so unmount it.
      model.position.set(0, 0, 0);
      model.rotation.set(0, 0, 0);
      // REAL-DIMENSION SIZING (weapons/weapon-scale.js): ground drops live in
      // world space, so the world scalar applies directly; the compact-class
      // READ boost covers the old "pistols are missed on pavement" 1.2 nudge,
      // which stays as the module-absent fallback.
      model.scale.setScalar(
        (CBZ.weaponWorldScale && CBZ.weaponWorldScale(model.userData.weaponId || nameOrId)) ||
        (model.userData && model.userData.weaponSlot === "pistol" ? 1.2 : 1.0)
      );
    }
    return model;
  }
  function makePhysicalDrop(payload) {
    let prop = null;
    if (payload.weaponId) prop = makeWeapon(payload.weaponId);
    else if (payload.melee) prop = makeMelee(payload.melee);
    else if (payload.cash != null) prop = makeBriefcase((payload.cash | 0) < 250);
    else if (payload.name) {
      // the item ITSELF, from the registry — the line that ends the backpacks.
      prop = assetProp(payload.name, items()[payload.name] || null, null, null);
    }
    if (!prop) {
      // the two names that always had a hand-picked container keep it, and a
      // catalog row the registry somehow could not build still gets a bag.
      if (/^(?:briefcase of cash|cash stack)$/i.test(payload.name || "")) prop = makeBriefcase(false);
      else if (/^wallet$/i.test(payload.name || "")) prop = makeBriefcase(true);
      else prop = makeBackpack();
    }
    prop.userData.transient = true;
    prop.userData._invPhysicalDrop = true;
    return prop;
  }

  CBZ.cityDropItem = function (x, z, payload) {
    payload = payload || {};
    let mesh = null;
    const root = arenaRoot();
    const y0 = payload.y != null ? payload.y : floorY(x, z);
    const physicalGun = !!(payload.weaponId && CBZ.weaponPhysics &&
      CBZ.weaponPhysics.drop && (!CBZ.CONFIG || CBZ.CONFIG.WEAPON_GROUND_PHYSICS !== false));
    if (root) {
      mesh = makePhysicalDrop(payload);
      // A physical gun leaves hand/hip height and falls. Non-gun items retain
      // their old static placement until they gain an honest body contract.
      const lift = physicalGun ? 0.78 :
        (mesh.userData._assetSeated ? 0.02 : (payload.weaponId || payload.melee ? 0.18 : 0.03));
      mesh.position.set(x, y0 + lift, z);
      mesh.rotation.y = (x * 7 + z * 13) % 6.28;
      root.add(mesh);
    }
    const rec = {
      x, z, y0, t: 0, ttl: payload.ttl != null ? payload.ttl : 120, mesh,
      name: payload.name || null, count: payload.count || 1,
      weaponId: payload.weaponId || null, ammo: payload.ammo != null ? payload.ammo : 30,
      melee: payload.melee || null, cash: Math.max(0, Math.round(payload.cash || 0)),
    };
    CBZ.cityItemDrops.push(rec);
    if (mesh && physicalGun) {
      const a = (x * 0.731 + z * 1.173) % (Math.PI * 2);
      rec._weaponBody = CBZ.weaponPhysics.drop(mesh, {
        record: rec, source: "inventory-drops",
        vx: Math.cos(a) * 0.7, vy: 1.15, vz: Math.sin(a) * 0.7,
        wx: Math.sin(a * 1.7) * 7.5, wy: Math.cos(a * 0.9) * 5.5, wz: Math.sin(a * 2.3) * 8.5,
      });
    }
  };

  function physicalizeNpcDrop(d) {
    if (!d || d._inv2Physical || !d.mesh) return;
    const old = d.mesh, parent = old.parent || arenaRoot();
    if (!parent) return;
    const y = (typeof d.y === "number" && isFinite(d.y)) ? d.y
      : (d.body && d.body.pos && isFinite(d.body.pos.y) ? d.body.pos.y : floorY(d.x, d.z));
    if (old.parent) old.parent.remove(old);
    if (old.geometry && old.geometry.dispose && !old.geometry._shared) old.geometry.dispose();
    if (old.material && old.material.dispose && !old.material._shared) old.material.dispose();
    const prop = makeWeapon((CBZ.weaponIdFromName && CBZ.weaponIdFromName(d.weapon)) || d.weapon || "Pistol");
    prop.userData.transient = true; prop.userData._invPhysicalDrop = true;
    const physicalGun = !!(CBZ.weaponPhysics && CBZ.weaponPhysics.drop &&
      (!CBZ.CONFIG || CBZ.CONFIG.WEAPON_GROUND_PHYSICS !== false));
    const lift = physicalGun ? 0.72 : (prop.userData._assetSeated ? 0.02 : 0.18);
    prop.position.set(d.x, y + lift, d.z);
    prop.rotation.y = (d.x * 7 + d.z * 13) % 6.28;
    parent.add(prop);
    d.mesh = prop; d._inv2Physical = true;
    if (physicalGun) {
      const a = (d.x * 0.619 + d.z * 1.037) % (Math.PI * 2);
      d._weaponBody = CBZ.weaponPhysics.drop(prop, {
        record: d, source: "inventory-drops",
        vx: Math.cos(a) * 0.55, vy: 0.95, vz: Math.sin(a) * 0.55,
        wx: Math.sin(a * 1.4) * 7, wy: Math.cos(a * 0.8) * 5, wz: Math.sin(a * 2.1) * 8,
      });
    }
  }

  // NPC gun drops use the same real weapon appearance as carried actors.
  function installDropWeaponWrap() {
    if (typeof CBZ.cityDropWeapon !== "function" || CBZ.cityDropWeapon._inv2PhysicalWrap) return;
    const orig = CBZ.cityDropWeapon;
    const wrapped = function (x, z, weapon, ammo) {
      const r = orig.apply(this, arguments);
      try {
        if (on()) {
          const arr = CBZ.cityDrops;
          const d = arr && arr[arr.length - 1];
          if (d && d.x === x && d.z === z) physicalizeNpcDrop(d);
        }
      } catch (e) {}
      return r;
    };
    for (const k in orig) if (Object.prototype.hasOwnProperty.call(orig, k)) wrapped[k] = orig[k];
    wrapped._inv2PhysicalWrap = true;
    CBZ.cityDropWeapon = wrapped;
  }
  function removeItemDrop(i) {
    const d = CBZ.cityItemDrops[i];
    if (d && d._weaponBody && CBZ.weaponPhysics && CBZ.weaponPhysics.release) {
      CBZ.weaponPhysics.release(d._weaponBody);
    }
    if (d && d.mesh && d.mesh.parent) d.mesh.parent.remove(d.mesh);   // pooled mat + shared geo: never dispose
    CBZ.cityItemDrops.splice(i, 1);
  }
  function pickupItemDrop(d) {
    const E = econ();
    if (d.cash > 0) {
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(d.cash);
      else g.cash = Math.max(0, (g.cash || 0) + d.cash);
      note("Recovered $" + d.cash.toLocaleString() + ".", 1.4);
    } else if (d.weaponId) {
      if (CBZ.unlockWeapon) CBZ.unlockWeapon(d.weaponId, { select: false });
      if (d.ammo > 0 && CBZ.fpsAddAmmo) { try { CBZ.fpsAddAmmo(d.ammo, d.weaponId); } catch (e) {} }
      note("Picked up " + gunName(d.weaponId), 1.4);
    } else if (d.melee) {
      if (g.cityMeleeWeapon && g.cityMeleeWeapon !== d.melee) { if (E) E.add(d.melee, 1); }   // hands full → into the bag
      else g.cityMeleeWeapon = d.melee;
      note("Picked up " + d.melee, 1.4);
    } else if (d.name) {
      if (E) E.add(d.name, d.count || 1);
      note("Picked up " + (d.count > 1 ? d.count + "× " : "") + d.name, 1.4);
    }
    sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function tickItemDrops(dt) {
    // Replace EVERY NPC gun placeholder. LAZY SWEEP, not just the
    // cityDropWeapon wrap: cityKillPed calls peds.js's INTERNAL dropWeapon()
    // directly (the global alias never runs), so records can land in
    // CBZ.cityDrops without passing any wrappable function — this sweep
    // catches them before the frame renders.
    const npcDrops = CBZ.cityDrops;
    if (npcDrops && npcDrops.length) {
      for (let i = 0; i < npcDrops.length; i++) {
        const d = npcDrops[i];
        if (!d.mesh) continue;
        if (on()) physicalizeNpcDrop(d);
      }
    }
    const drops = CBZ.cityItemDrops;
    if (!drops.length) return;
    const P = CBZ.player;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.t += dt;
      if (P && !P.dead && !P.driving && Math.abs(P.pos.y - d.y0) < 2.5 &&
          Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < 1.5) {
        pickupItemDrop(d);
        removeItemDrop(i);
        continue;
      }
      if (d.t > d.ttl) removeItemDrop(i);
    }
  }
  function clearItemDrops() { for (let i = CBZ.cityItemDrops.length - 1; i >= 0; i--) removeItemDrop(i); }

  // Corpse contents get a physical container beside the body. A meaningful
  // cash haul reads as a briefcase; carried belongings read as a backpack.
  // The corpse remains the interaction target, so all existing loot rules and
  // economy debits stay authoritative.
  function clearCorpseProp(ped) {
    const prop = ped && ped._invLootProp;
    if (prop && prop.parent) prop.parent.remove(prop);
    if (ped) ped._invLootProp = null;
  }
  function mountCorpseProp(ped) {
    if (!ped || !ped.dead || !ped.deadLoot || ped.deadLoot.looted) { clearCorpseProp(ped); return; }
    if (ped._invLootProp && ped._invLootProp.parent) return;
    const root = arenaRoot(); if (!root || !ped.pos) return;
    const dl = ped.deadLoot, hasItems = Array.isArray(dl.items) && dl.items.some(Boolean);
    if (!(dl.cash > 0) && !hasItems) return;
    const payload = dl.cash >= 250 ? { cash: dl.cash } : hasItems ? { name: "Backpack" } : { cash: dl.cash };
    const prop = makePhysicalDrop(payload);
    const a = ((ped.pos.x * 5 + ped.pos.z * 11) % 6.28);
    prop.position.set(ped.pos.x + Math.cos(a) * 0.48, floorY(ped.pos.x, ped.pos.z) + 0.03, ped.pos.z + Math.sin(a) * 0.48);
    prop.rotation.y = a;
    root.add(prop);
    ped._invLootProp = prop;
  }
  function installCorpseLootWraps() {
    if (typeof CBZ.cityKillPed === "function" && !CBZ.cityKillPed._invLootWrap) {
      const origKill = CBZ.cityKillPed;
      const wrappedKill = function (ped) {
        const wasDead = !ped || ped.dead;
        const r = origKill.apply(this, arguments);
        if (!wasDead && ped && ped.dead) mountCorpseProp(ped);
        return r;
      };
      for (const k in origKill) if (Object.prototype.hasOwnProperty.call(origKill, k)) wrappedKill[k] = origKill[k];
      wrappedKill._invLootWrap = true;
      CBZ.cityKillPed = wrappedKill;
    }
    if (typeof CBZ.cityLootCorpse === "function" && !CBZ.cityLootCorpse._invLootWrap) {
      const origLoot = CBZ.cityLootCorpse;
      const wrappedLoot = function (ped) {
        const r = origLoot.apply(this, arguments);
        if (ped && ped.deadLoot && ped.deadLoot.looted) clearCorpseProp(ped);
        return r;
      };
      for (const k in origLoot) if (Object.prototype.hasOwnProperty.call(origLoot, k)) wrappedLoot[k] = origLoot[k];
      wrappedLoot._invLootWrap = true;
      CBZ.cityLootCorpse = wrappedLoot;
    }
  }
  let corpsePropT = 0;
  function tickCorpseProps(dt) {
    corpsePropT -= dt; if (corpsePropT > 0) return;
    corpsePropT = 0.5;
    const peds = CBZ.cityPeds || [];
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p) continue;
      if (p.culled || !p.dead || !p.deadLoot || p.deadLoot.looted) clearCorpseProp(p);
      else mountCorpseProp(p);
    }
  }

  // drop the cursor stack (or a grid slot) to the ground at the player's feet
  function dropEntryToGround(entry) {
    const P = CBZ.player; if (!P || !entry) return false;
    // leaving the player's possession is a truth removal (if it was theirs)
    const h = (P.heading || 0);
    const x = P.pos.x + Math.sin(h) * 1.2 + (Math.random() - 0.5) * 0.4;
    const z = P.pos.z + Math.cos(h) * 1.2 + (Math.random() - 0.5) * 0.4;
    if (entry.kind === "item") CBZ.cityDropItem(x, z, { name: entry.name, count: entry.count, y: P.pos.y });
    else if (entry.melee) CBZ.cityDropItem(x, z, { melee: entry.name, y: P.pos.y });
    else CBZ.cityDropItem(x, z, { weaponId: entry.id, ammo: 0, y: P.pos.y });
    return true;
  }

  // ============================================================
  //  PLAYER DEATH DROP — wrap CBZ.cityKillPlayer: the guns leave the body
  //  as REAL pickups (Minecraft rule: go back for your gear). Items stay and
  //  carried cash hits the pavement; money deposited in g.cityBank survives.
  //  Stowed guns (police stop, g._copStow) are the effective loadout and
  //  must not resurrect via cityRedrawWeapon — snapshot then null it.
  // ============================================================
  function installDeathWrap() {
    if (typeof CBZ.cityKillPlayer !== "function" || CBZ.cityKillPlayer._invKPWrap) return;
    const orig = CBZ.cityKillPlayer;
    const wrapped = function (reason, imp) {
      try {
        const P = CBZ.player;
        const seen = imp && imp._invDeathSeen;
        if (!seen && on() && cityNow() && P && !P.dead) {
          if (imp) imp._invDeathSeen = true;
          const stow = g._copStow;
          const ids = (stow && stow.inv && stow.inv.length ? stow.inv : (CBZ.weaponInventory || [])).slice();
          const px = P.pos.x, pz = P.pos.z, py = P.pos.y;
          const carriedCash = Math.max(0, Math.round(g.cash || 0));
          if (carriedCash > 0) {
            CBZ.cityDropItem(px + (Math.random() - 0.5) * 0.8, pz + (Math.random() - 0.5) * 0.8,
              { cash: carriedCash, y: py, ttl: 300 });
            g.cash = 0; // g.cityBank is deliberately untouched
          }
          for (let i = 0; i < ids.length; i++) {
            // ammo:0 — reserves live per-weapon inside fpsmode and survive the
            // drop/re-pickup round-trip; a bonus here would be a death-farm.
            CBZ.cityDropItem(px + (Math.random() - 0.5) * 1.6, pz + (Math.random() - 0.5) * 1.6,
              { weaponId: ids[i], ammo: 0, y: py, ttl: 300 });
          }
          if (g.cityMeleeWeapon && !meleeShownAsItem()) {
            CBZ.cityDropItem(px + (Math.random() - 0.5) * 1.6, pz + (Math.random() - 0.5) * 1.6,
              { melee: g.cityMeleeWeapon, y: py, ttl: 300 });
          }
          if (ids.length || g.cityMeleeWeapon || carriedCash) note("Your carried gear and cash are still at the scene.", 3);
          // strip truth so a hospital respawn (or cityRedrawWeapon) can't dupe
          if (CBZ.weaponInventory) CBZ.weaponInventory.length = 0;
          CBZ.currentWeaponId = null;
          g.cityMeleeWeapon = null;
          g._copStow = null; g.cityStowedWeapon = null;
          if (CBZ.cityHudDirty) CBZ.cityHudDirty();
          commit();
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    // carry every marker other wrappers stamped on the original forward
    for (const k in orig) if (Object.prototype.hasOwnProperty.call(orig, k)) wrapped[k] = orig[k];
    wrapped._invKPWrap = true;
    CBZ.cityKillPlayer = wrapped;
  }

  // ============================================================
  //  PERSISTENCE — worldstate ledger, add-only fields (storage.js pattern)
  // ============================================================
  function serializeSlots(grid) { return grid.map(cloneEntry); }
  function persistSlots() {
    if (!CBZ.cityWorldEnsure) return;
    const w = CBZ.cityWorldEnsure(); if (!w) return;
    w.invSlots = serializeSlots(MAIN);
  }
  function persistChests() {
    if (!CBZ.cityWorldEnsure) return;
    const w = CBZ.cityWorldEnsure(); if (!w) return;
    w.chests = chests.map((c) => ({ id: c.id, x: c.x, z: c.z, slots: serializeSlots(c.slots) }));
  }
  function commit() { if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} } }

  function validEntry(e) {
    if (!e || typeof e !== "object") return null;
    if (e.kind === "item" && typeof e.name === "string" && (e.count | 0) > 0) return { kind: "item", name: e.name, count: e.count | 0 };
    if (e.kind === "weapon" && e.melee && typeof e.name === "string") return { kind: "weapon", melee: true, name: e.name };
    if (e.kind === "weapon" && typeof e.id === "string") return { kind: "weapon", id: e.id, name: e.name || gunName(e.id) };
    return null;
  }
  function ensureHydrated() {
    if (g._cityInvHydrated || !CBZ.cityWorldEnsure) return;
    g._cityInvHydrated = true;
    const w = CBZ.cityWorldEnsure();
    if (w && Array.isArray(w.invSlots)) {
      for (let i = 0; i < MAIN_N; i++) MAIN[i] = validEntry(w.invSlots[i]);
    }
    // truth wins over any stale arrangement — resync prunes/refills (callers
    // of ensureHydrated are inside resync already; pruning happens right after)
  }

  // ============================================================
  //  CHESTS — placeable world stashes: { id, x, z, mesh, slots[27] }
  // ============================================================
  const chests = [];
  let _chestRoot = null;
  let openChestRef = null;

  // THE CHEST IN YOUR BAG IS THE CHEST ON THE GROUND. Its three boxes moved to
  // city/itemassets.js's `chest` builder — same dimensions, same palette, same
  // emissive lift — so the item icon is a photograph of the object you are
  // about to place, not a drawing of one. `itemAsset` (not `itemAssetPickup`)
  // because a chest is world-sized already and must not be normalised.
  function buildChestMesh(x, z) {
    const root = arenaRoot(); if (!root) return null;
    const grp = new THREE.Group();
    const y = floorY(x, z);
    grp.position.set(x, y, z);
    let body = null;
    if (CBZ.itemAsset) { try { body = CBZ.itemAsset("Chest", null, { kind: "chest" }); } catch (e) { body = null; } }
    if (body) grp.add(body);
    else {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.8), cmat(0x6b4a2a, { emissive: 0x241505, ei: 0.15 }));
      b.position.y = 0.3; grp.add(b);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.2, 0.84), cmat(0x4a3320, { emissive: 0x1a0f04, ei: 0.15 }));
      lid.position.y = 0.7; grp.add(lid);
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.06), cmat(0xc9a44a, { emissive: 0x6b4f12, ei: 0.4 }));
      latch.position.set(0, 0.58, 0.44); grp.add(latch);
    }
    grp.userData.transient = true;
    root.add(grp);
    return grp;
  }
  function hydrateChests() {
    if (g._cityChestsHydrated || !CBZ.cityWorldEnsure) return;
    g._cityChestsHydrated = true;
    const w = CBZ.cityWorldEnsure();
    if (!w || !Array.isArray(w.chests)) return;
    for (const rec of w.chests) {
      if (!rec || rec.x == null || rec.z == null) continue;
      const slots = new Array(CHEST_N).fill(null);
      if (Array.isArray(rec.slots)) for (let i = 0; i < CHEST_N; i++) slots[i] = validEntry(rec.slots[i]);
      chests.push({ id: rec.id || ("c" + chests.length), x: rec.x, z: rec.z, slots, mesh: buildChestMesh(rec.x, rec.z) });
    }
    _chestRoot = arenaRoot();
  }
  function teardownChests() {
    // close FIRST: closeChest persists — persisting after the clear below
    // would stamp an empty w.chests over the ledger (data loss).
    if (openChestRef) closeChest();
    for (const c of chests) { if (c.mesh && c.mesh.parent) c.mesh.parent.remove(c.mesh); c.mesh = null; }
    chests.length = 0;
    g._cityChestsHydrated = false;
  }
  function chestNear(reach) {
    const P = CBZ.player; if (!P) return null;
    const r = reach || REACH;
    let best = null, bd = r * r;
    for (const c of chests) {
      const dx = c.x - P.pos.x, dz = c.z - P.pos.z, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = c; }
    }
    return best;
  }
  function chestEmpty(c) { for (const s of c.slots) if (s) return false; return true; }

  function spotBlocked(x, z) {
    const cs = CBZ.colliders;
    if (!cs) return false;
    const R = 0.6;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (x + R < c.minX || x - R > c.maxX || z + R < c.minZ || z - R > c.maxZ) continue;
      if (c.y0 != null && c.y0 > 1.5) continue;          // height-gated wall above chest height
      return true;
    }
    return false;
  }

  function placeChest(opts) {
    opts = opts || {};
    if (!on() || !cityNow() || !playing()) return false;
    const P = CBZ.player;
    if (!P || P.dead || P.driving) { note("Get out of the vehicle first.", 1.4); return false; }
    const E = econ(); if (!E) return false;
    registerChestItem();
    let paid = false;
    if (E.count("Chest") > 0) { E.take("Chest", 1); }
    else if (opts.buy) {
      if ((g.cash || 0) < CHEST_COST) { note("A chest costs $" + CHEST_COST + ".", 2); sfx("hit"); return false; }
      g.cash -= CHEST_COST; paid = true;
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    } else { note("You don't own a chest.", 1.6); return false; }
    const h = P.heading || 0;
    const x = P.pos.x + Math.sin(h) * 1.6, z = P.pos.z + Math.cos(h) * 1.6;
    if (spotBlocked(x, z)) {
      note("No room here, face an open spot.", 1.8);
      if (paid) { g.cash += CHEST_COST; } else { E.add("Chest", 1); }
      return false;
    }
    const c = { id: "c" + Date.now().toString(36) + ((Math.random() * 1e4) | 0), x, z, slots: new Array(CHEST_N).fill(null), mesh: buildChestMesh(x, z) };
    chests.push(c);
    note("Chest placed, walk up and press [E] to open it.", 2.4);
    persistChests(); commit();
    return true;
  }
  function pickupEmptyChest(c) {
    if (!chestEmpty(c)) { note("Empty it first.", 1.4); return false; }
    const at = chests.indexOf(c); if (at < 0) return false;
    if (c.mesh && c.mesh.parent) c.mesh.parent.remove(c.mesh);
    chests.splice(at, 1);
    registerChestItem();
    if (econ()) econ().add("Chest", 1);
    note("Chest packed up.", 1.6);
    persistChests(); commit();
    return true;
  }

  // ============================================================
  //  CSS (self-mounted once) — matches the charpanel / hud.mc look
  // ============================================================
  function ensureCss() {
    if (CBZ.itemIconCss) { try { CBZ.itemIconCss(); } catch (e) {} }   // shared item-icon sizing
    if (typeof document === "undefined" || !document.head || document.getElementById("ci2Css")) return;
    const st = document.createElement("style");
    st.id = "ci2Css";
    st.textContent =
      // slot grid cells (Minecraft bevel, matching #cityHud.mc's .cSlot skin)
      ".ci2Grid{display:grid;grid-template-columns:repeat(9,46px);gap:4px;justify-content:start}" +
      ".ci2Slot{position:relative;width:46px;height:46px;box-sizing:border-box;border-radius:4px;background:rgba(10,12,16,.66);" +
      "border:2px solid #0a0c10;box-shadow:inset 2px 2px 0 rgba(0,0,0,.5),inset -2px -2px 0 rgba(255,255,255,.10);" +
      "display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none}" +
      ".ci2Slot:hover{box-shadow:inset 0 0 0 2px rgba(125,231,255,.55),inset 2px 2px 0 rgba(0,0,0,.35)}" +
      ".ci2Slot .ic{font-size:22px;line-height:1;pointer-events:none;filter:drop-shadow(0 1px 1px rgba(0,0,0,.6))}" +
      ".ci2Slot .gunThumb{display:block;width:42px;height:30px;object-fit:contain;pointer-events:none;filter:drop-shadow(0 2px 2px rgba(0,0,0,.8))}" +
      ".ci2Slot .ct{position:absolute;right:2px;bottom:1px;font-size:11px;font-weight:800;color:#fff;pointer-events:none;text-shadow:1px 1px 0 #000,0 0 3px #000}" +
      ".ci2Slot .eq{position:absolute;left:2px;top:1px;font-size:9px;font-weight:800;color:#7de7ff;pointer-events:none;text-shadow:0 1px 2px #000}" +
      ".ci2Slot.equipped{box-shadow:0 0 0 2px rgba(125,231,255,.8),inset 2px 2px 0 rgba(0,0,0,.35)}" +
      ".ci2Foot{grid-column:1/-1;display:flex;gap:6px;margin-top:4px}" +
      ".ci2Btn{font-family:inherit;font-size:11px;font-weight:700;letter-spacing:.3px;color:#9fb0c6;background:rgba(255,255,255,.04);" +
      "border:1px solid rgba(232,236,242,.12);border-radius:8px;padding:6px 10px;cursor:pointer}" +
      ".ci2Btn:hover{border-color:rgba(125,231,255,.5);color:#e8ecf2}" +
      ".ci2Hint{grid-column:1/-1;font-size:10px;color:#7f8ba0;margin-top:2px}" +
      // cursor ghost
      "#ci2Cursor{position:fixed;z-index:250;pointer-events:none;display:none;transform:translate(-50%,-50%);font-size:24px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.7))}" +
      "#ci2Cursor .gunThumb{width:64px;height:40px;object-fit:contain}" +
      "#ci2Cursor .ct{font-size:12px;font-weight:800;color:#fff;text-shadow:1px 1px 0 #000;vertical-align:bottom}" +
      // chest panel
      "#ci2Chest{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:130;display:none;flex-direction:column;gap:10px;" +
      "background:rgba(10,13,20,.94);border:1px solid rgba(232,236,242,.14);border-radius:16px;padding:16px 18px;" +
      "font-family:Fredoka,system-ui,sans-serif;color:#e8ecf2;box-shadow:0 18px 60px rgba(0,0,0,.6)}" +
      "#ci2Chest .ttl{font-size:13px;font-weight:800;letter-spacing:1px;color:#9fb0c6;text-transform:uppercase}" +
      // proximity chip (roofloot pattern)
      "#ci2Chip{position:fixed;left:50%;transform:translateX(-50%);bottom:252px;z-index:24;display:none;padding:6px 12px;border-radius:9px;" +
      "background:rgba(8,14,22,.78);border:1px solid rgba(255,209,102,.30);color:#ffe9bd;font:600 13px/1.2 'Fredoka',system-ui,sans-serif;" +
      "pointer-events:none;text-shadow:0 1px 2px #000}" +
      // fallback HUD hotbar (only if the hud.js unified bar is absent)
      "#invHotbar{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:30;display:none;gap:3px}" +
      "#invHotbar .ci2Slot{cursor:pointer;pointer-events:auto}" +
      "#invHotbar .ci2Slot .s{font-size:11px;font-weight:800;color:#cdd6e2;pointer-events:none;text-shadow:0 1px 2px #000}" +
      "#invHotbar .ci2Slot.sel{box-shadow:0 0 0 2px rgba(232,236,242,.85),inset 2px 2px 0 rgba(0,0,0,.35);transform:scale(1.08)}" +
      // PHONE slot — the campaign handset carried like a gun (campaign_ui.js).
      // The unread LED and the stowed buzz are the two signals the retired
      // corner button owned; they ride the chip now, unchanged in kind.
      "#invHotbar .ci2Slot .led{position:absolute;right:3px;top:3px;width:6px;height:6px;border-radius:50%;background:#53606a;opacity:.35;box-shadow:0 0 0 2px rgba(0,0,0,.28)}" +
      "#invHotbar .ci2Slot.unread .led{background:#ff6258;opacity:1;box-shadow:0 0 0 2px rgba(0,0,0,.28),0 0 8px #ff6258}" +
      "#invHotbar .ci2Slot.buzz{animation:ci2PhoneBuzz .82s ease}" +
      "@keyframes ci2PhoneBuzz{0%,100%{transform:translateY(0) rotate(0)}18%{transform:translateY(-4px) rotate(-5deg)}38%{transform:translateY(-2px) rotate(5deg)}58%{transform:translateY(-1px) rotate(-3deg)}}";
    document.head.appendChild(st);
  }

  // ============================================================
  //  RENDER — player grid (into charpanel's .cpGrid) + chest grids
  // ============================================================
  let attachedGridEl = null;         // charpanel's .cpGrid, once attached
  let cursorEl = null;
  let chestPanel = null, chestGridEl = null, chestPlayerGridEl = null;

  function attr(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;"); }
  function cellHtml(e, gridKey, i) {
    let inner = "";
    if (e) {
      const equipped = isGun(e) ? (CBZ.currentWeaponId === e.id && !g.cityHolstered) : (isMelee(e) && g.cityMeleeWeapon === e.name);
      inner = (isGun(e) ? weaponFace(e.id, e.name) : itemFace(e.name)) +
        (e.kind === "item" && e.count > 1 ? "<span class='ct'>" + e.count + "</span>" : "") +
        (equipped ? "<span class='eq'>EQ</span>" : "");
      // the tooltip says what it IS and what it is FOR — a pelt names its fence
      // price, a steak names its fill. "You can't even hold it" was half an icon
      // problem and half nobody ever telling you what the thing was worth.
      let tip = e.kind === "weapon"
        ? String(e.name) + "\nweapon  ·  right-click to equip"
        : itemTitle(e.name, e.count);
      const v = e.kind === "item" && CBZ.itemVerb ? CBZ.itemVerb(e.name, items()[e.name]) : null;
      if (v && v.id !== "sell") tip += "\nshift + right-click: " + v.label;
      return "<div class='ci2Slot" + (equipped ? " equipped" : "") + "' data-g='" + gridKey + "' data-i='" + i +
        "' title='" + attr(tip) + "'>" + inner + "</div>";
    }
    return "<div class='ci2Slot' data-g='" + gridKey + "' data-i='" + i + "'></div>";
  }
  function renderGridInto(el, grid, gridKey, withFooter) {
    if (!el) return;
    ensureCss();
    el.classList.add("ci2Grid");
    // inline layout so a host panel's own id-scoped grid rules (charpanel's
    // "#cpInv .cpGrid" auto-fill) can't out-specificity the 9-wide slot grid
    el.style.display = "grid";
    el.style.gridTemplateColumns = "repeat(9,46px)";
    el.style.gap = "4px";
    el.style.justifyContent = "start";
    let html = "";
    for (let i = 0; i < grid.length; i++) html += cellHtml(grid[i], gridKey, i);
    if (withFooter) {
      html += "<div class='ci2Hint'>Click: move stack · Right-click: half / place one · Weapons: right-click equips · " +
        "<b style='color:#9fd8a0'>Shift + right-click: eat / use</b> · Shift-click: quick-move · Click backdrop with an item held: drop it</div>";
    }
    el.innerHTML = html;
  }
  function renderAllGrids() {
    if (attachedGridEl) renderGridInto(attachedGridEl, MAIN, "p", true);
    if (openChestRef && chestPanel && chestPanel.style.display !== "none") {
      renderGridInto(chestGridEl, openChestRef.slots, "c", false);
      renderGridInto(chestPlayerGridEl, MAIN, "p", false);
    }
    renderCursor();
  }
  function renderCursor() {
    if (!cursorEl) {
      if (typeof document === "undefined" || !document.body) return;
      ensureCss();
      cursorEl = document.createElement("div");
      cursorEl.id = "ci2Cursor";
      document.body.appendChild(cursorEl);
      addEventListener("mousemove", function (e) {
        ptr.x = e.clientX; ptr.y = e.clientY;
        if (cursor && cursorEl) { cursorEl.style.left = ptr.x + "px"; cursorEl.style.top = ptr.y + "px"; }
      });
    }
    if (cursor) {
      cursorEl.style.display = "block";
      cursorEl.innerHTML = (isGun(cursor) ? weaponFace(cursor.id, cursor.name) : itemFace(cursor.name, "lg")) +
        (cursor.kind === "item" && cursor.count > 1 ? "<span class='ct'>" + cursor.count + "</span>" : "");
      cursorEl.style.left = ptr.x + "px"; cursorEl.style.top = ptr.y + "px";
    } else cursorEl.style.display = "none";
  }

  // ============================================================
  //  SLOT INTERACTION (shared by the [I] grid and the chest panel)
  // ============================================================
  function gridByKey(k) { return k === "c" ? (openChestRef && openChestRef.slots) : MAIN; }

  function equipEntry(e) {
    if (isGun(e)) { g.cityMeleeWeapon = null; g.cityHolstered = false; if (CBZ.setCurrentWeapon) CBZ.setCurrentWeapon(e.id); note("Equipped " + e.name, 1.2); }
    else if (isMelee(e)) { if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(e.name); }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // returns true if the op happened (truth transfers may refuse)
  function slotClick(gridKey, i, right, shift) {
    const grid = gridByKey(gridKey); if (!grid) return;
    const s = grid[i];

    // SHIFT + RIGHT-CLICK: USE the thing. The hotbar is still the primary way
    // to eat (a number key, and a tap on touch — see hud.js's #cSlots), but a
    // bag you can only rearrange is the "you can't even hold it" complaint, so
    // the grid gets the verb too. Deliberately NOT plain right-click: that is
    // the Minecraft stack split and it has to stay. Chest grids are excluded —
    // nothing in a box is in your hands.
    if (shift && right && s && s.kind === "item" && gridKey === "p" && CBZ.cityUseItem) {
      const before = econ() ? econ().count(s.name) : 0;
      CBZ.cityUseItem(s.name);
      if (!econ() || econ().count(s.name) !== before) resync();
      renderAllGrids();
      return;
    }

    // SHIFT-CLICK: quick-move a whole stack to the other container (chest open)
    if (shift && s && openChestRef) {
      const toKey = gridKey === "p" ? "c" : "p";
      const to = gridByKey(toKey);
      // merge into an existing partial stack first (items only), then free slot
      if (s.kind === "item") {
        const cap = stackCap(s.name);
        for (let j = 0; j < to.length && s.count > 0; j++) {
          const t = to[j];
          if (t && t.kind === "item" && t.name === s.name && t.count < cap) {
            const d = Math.min(cap - t.count, s.count);
            if (!crossTransfer({ kind: "item", name: s.name, count: d }, d, toKey)) return;
            t.count += d; s.count -= d;
          }
        }
        if (s.count > 0) {
          const f = firstFree(to);
          if (f >= 0) {
            if (!crossTransfer({ kind: "item", name: s.name, count: s.count }, s.count, toKey)) { renderAllGrids(); return; }
            to[f] = { kind: "item", name: s.name, count: s.count }; s.count = 0;
          }
        }
        if (s.count <= 0) grid[i] = null;
      } else {
        const f = firstFree(to);
        if (f >= 0 && crossTransfer(s, 1, toKey)) { to[f] = s; grid[i] = null; }
      }
      persistSlots(); persistChests();
      renderAllGrids();
      return;
    }

    // RIGHT-CLICK, empty cursor: weapons equip; stacks split in half
    if (right && !cursor) {
      if (!s) return;
      if (s.kind === "weapon") { if (gridKey === "p") equipEntry(s); renderAllGrids(); return; }
      // a melee/gun carried as a COUNTED item (craft/shop paths park Bat/
      // Hatchet in cityInv) equips through the existing city bridge instead
      // of splitting — right-click means "use/equip" for weapons everywhere.
      const cat = items()[s.name];
      if (gridKey === "p" && cat && (cat.melee || cat.gun)) {
        // a GUN item converts into the engine loadout (consume one so it isn't
        // represented twice); a melee item equips in place (craft convention:
        // the tool stays a counted item while g.cityMeleeWeapon points at it).
        if (cat.gun && !cat.melee) {
          const E = econ();
          if (E && E.take(s.name, 1) && CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(s.name);
          resync();
        } else if (CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(s.name);
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
        renderAllGrids();
        return;
      }
      const half = Math.ceil(s.count / 2);
      cursor = { kind: "item", name: s.name, count: half }; cursorSrc = gridKey;
      s.count -= half;
      if (s.count <= 0) grid[i] = null;
      renderAllGrids();
      return;
    }
    // RIGHT-CLICK with a cursor: place exactly one
    if (right && cursor) {
      if (cursor.kind !== "item") return;             // guns don't deal out
      if (!s) {
        if (cursorSrc !== gridKey && !crossTransfer({ kind: "item", name: cursor.name, count: 1 }, 1, gridKey)) return;
        grid[i] = { kind: "item", name: cursor.name, count: 1 };
      } else if (s.kind === "item" && s.name === cursor.name && s.count < stackCap(s.name)) {
        if (cursorSrc !== gridKey && !crossTransfer({ kind: "item", name: cursor.name, count: 1 }, 1, gridKey)) return;
        s.count += 1;
      } else return;
      cursor.count -= 1;                 // the remainder is still from cursorSrc
      if (cursor.count <= 0) cursor = null;
      persistSlots(); persistChests();
      renderAllGrids();
      return;
    }

    // LEFT-CLICK
    if (!cursor) {
      if (!s) return;
      cursor = s; cursorSrc = gridKey; grid[i] = null;
      renderAllGrids();
      return;
    }
    // place / merge / swap (crossing containers moves truth)
    const crossing = cursorSrc !== gridKey;
    if (!s) {
      if (crossing && !crossTransfer(cursor, cursor.kind === "item" ? cursor.count : 1, gridKey)) { renderAllGrids(); return; }
      grid[i] = cursor; cursor = null;
    } else if (s.kind === "item" && cursor.kind === "item" && s.name === cursor.name) {
      const cap = stackCap(s.name);
      const d = Math.min(cap - s.count, cursor.count);
      if (d > 0) {
        if (crossing && !crossTransfer({ kind: "item", name: s.name, count: d }, d, gridKey)) { renderAllGrids(); return; }
        s.count += d; cursor.count -= d;
      }
      if (cursor.count <= 0) cursor = null;
    } else {
      // swap: both entries cross when the containers differ
      if (crossing) {
        const backKey = cursorSrc;
        if (!crossTransfer(cursor, cursor.kind === "item" ? cursor.count : 1, gridKey)) { renderAllGrids(); return; }
        if (!crossTransfer(s, s.kind === "item" ? s.count : 1, backKey)) {
          // roll the first transfer back
          crossTransfer(cursor, cursor.kind === "item" ? cursor.count : 1, backKey);
          renderAllGrids(); return;
        }
      }
      // NOTE: cursorSrc stays as-is — when the containers differ, the swapped-
      // out entry's truth just moved to the OLD cursorSrc side, so that is the
      // new cursor's truth home too (placing it back re-crosses correctly).
      const t = s; grid[i] = cursor; cursor = t;
    }
    persistSlots(); persistChests();
    renderAllGrids();
  }

  function onGridMouseDown(e) {
    const cell = e.target.closest && e.target.closest(".ci2Slot");
    if (cell) {
      e.preventDefault(); e.stopPropagation();
      slotClick(cell.dataset.g, +cell.dataset.i, e.button === 2, e.shiftKey);
      return;
    }
    const btn = e.target.closest && e.target.closest(".ci2Btn");
    if (btn) {
      e.preventDefault(); e.stopPropagation();
      renderAllGrids();
    }
  }
  function bindGridEl(el) {
    if (!el || el._ci2Bound) return;
    el._ci2Bound = true;
    el.addEventListener("mousedown", onGridMouseDown);
    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  // return whatever is on the cursor to its home container (panel closing)
  function stashCursor() {
    if (!cursor) return;
    const fromChest = cursorSrc === "c";
    const home = fromChest && openChestRef ? openChestRef.slots : MAIN;
    // merge back into a partial stack, else first free.
    if (cursor.kind === "item") {
      const cap = stackCap(cursor.name);
      for (let i = 0; i < home.length && cursor.count > 0; i++) {
        const s = home[i];
        if (s && s.kind === "item" && s.name === cursor.name && s.count < cap) { const d = Math.min(cap - s.count, cursor.count); s.count += d; cursor.count -= d; }
      }
      if (cursor.count > 0) { const f = firstFree(home); if (f >= 0) { home[f] = cursor; cursor = null; } }
      if (cursor && cursor.count <= 0) cursor = null;
    } else {
      const f = firstFree(home);
      if (f >= 0) { home[f] = cursor; cursor = null; }
    }
    // homeless leftovers: a "p"-origin entry is still in truth (resync will
    // re-materialize it), but a chest-origin entry's ONLY record is the cursor
    // — hand it to the player's truth so it can never silently vanish.
    if (cursor && fromChest) truthAdd(cursor, cursor.kind === "item" ? cursor.count : 1);
    cursor = null;
    resync();
  }

  // ============================================================
  //  CHEST PANEL — its own overlay (charpanel edits stay minimal)
  // ============================================================
  function buildChestPanel() {
    if (chestPanel || typeof document === "undefined" || !document.body) return;
    ensureCss();
    chestPanel = document.createElement("div");
    chestPanel.id = "ci2Chest";
    chestPanel.innerHTML =
      "<div class='ttl'>Chest</div><div class='ci2Grid' data-grid='c'></div>" +
      "<div class='ttl'>Inventory</div><div class='ci2Grid' data-grid='p'></div>" +
      "<div class='ci2Hint'>Shift-click: quick-move · [E]/[Esc] close · empty chest: [Pick up] below</div>" +
      "<div style='display:flex;gap:6px'><button type='button' class='ci2Btn' data-act='pickup'>Pick up chest</button>" +
      "<button type='button' class='ci2Btn' data-act='close'>Close</button></div>";
    document.body.appendChild(chestPanel);
    chestGridEl = chestPanel.querySelector("[data-grid='c']");
    chestPlayerGridEl = chestPanel.querySelector("[data-grid='p']");
    bindGridEl(chestPanel);
    chestPanel.addEventListener("mousedown", function (e) {
      const btn = e.target.closest && e.target.closest(".ci2Btn");
      if (!btn) return;
      if (btn.dataset.act === "close") { e.preventDefault(); closeChest(); }
      else if (btn.dataset.act === "pickup") {
        e.preventDefault();
        const c = openChestRef;
        if (c && chestEmpty(c)) { closeChest(); pickupEmptyChest(c); }
        else note("Empty it first.", 1.4);
      }
    });
  }
  function openChest(c) {
    if (!on() || !c || openChestRef) return;
    if (CBZ.cityMenuOpen || CBZ.invOpen) return;          // another overlay owns the screen
    buildChestPanel(); if (!chestPanel) return;
    openChestRef = c;
    CBZ.cityMenuOpen = true;
    resync();
    renderAllGrids();
    chestPanel.style.display = "flex";
    if (!CBZ.touchMode && document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function closeChest() {
    if (!openChestRef) return;
    stashCursor();
    openChestRef = null;
    if (chestPanel) chestPanel.style.display = "none";
    CBZ.cityMenuOpen = false;
    persistSlots(); persistChests(); commit();
    if (!CBZ.touchMode && playing() && CBZ.requestLock) CBZ.requestLock();
  }

  // [E] near a chest — document-capture (the roofloot.js pattern) so the
  // window-level interact fallback never double-fires on the same press.
  function onChestKey(e) {
    if (openChestRef) {
      const k = (e.key || "").toLowerCase();
      if (k === "e" || k === "escape") { e.preventDefault(); e.stopPropagation(); closeChest(); }
      return;
    }
    if (!on() || !cityNow() || !playing() || CBZ.cityMenuOpen || CBZ.invOpen) return;
    const P = CBZ.player;
    if (!P || P.dead || P.driving) return;
    if ((e.key || "").toLowerCase() !== "e") return;
    const c = chestNear(REACH);
    if (!c) return;
    e.preventDefault(); e.stopPropagation();
    openChest(c);
  }
  if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("keydown", onChestKey);

  // Your OWN chest, and on touch it could not be opened: the chip carrying the
  // verb is in css/city.css's declutter list. Desktop string unchanged; touch
  // gets the pill that fires the same [E] handler above.
  function chestPrompt(c) {
    const desktop = chestEmpty(c) ? "[E] Open chest (empty)" : "[E] Open chest";
    return CBZ.touchActionPrompt
      ? CBZ.touchActionPrompt("e", chestEmpty(c) ? "OPEN CHEST (EMPTY)" : "OPEN CHEST", desktop)
      : desktop;
  }

  // proximity chip
  let chip = null, _chipLast;
  function chipText(t) {
    if (t === _chipLast) return;
    _chipLast = t;
    if (!chip) {
      if (typeof document === "undefined" || !document.body) return;
      ensureCss();
      chip = document.createElement("div"); chip.id = "ci2Chip";
      document.body.appendChild(chip);
    }
    if (!t) { chip.style.display = "none"; return; }
    if (CBZ.touchPromptChip) { CBZ.touchPromptChip(chip, t); return; }
    chip.style.display = "block"; chip.innerHTML = t;
  }

  // ============================================================
  //  FALLBACK HUD HOTBAR — the city hud (city/hud.js #cSlots) already draws
  //  the unified CBZ.cityHotbar() bar Minecraft-style with [1]-[9] wired
  //  (fpsmode.js). This fallback renders the SAME bar at the SAME indices
  //  only when that HUD bar is missing, so a hotbar is ALWAYS visible.
  // ============================================================
  let hotbarEl = null, _hotSig = "";
  function hudBarPresent() {
    const el = document.getElementById("cSlots");
    if (!el) return false;
    // COMPUTED visibility, not existence: the campaign's declutter CSS hides
    // #cSlots with display:none !important (css/campaign.css) while the node
    // stays in the DOM — the owner's session had NO hotbar because this check
    // used to stop at "the element exists".
    try {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
    } catch (e) {}
    const wrap = document.getElementById("cityHud");
    if (wrap && wrap.style.display === "none") return false;
    return true;
  }
  function renderFallbackHotbar() {
    if (typeof document === "undefined" || !document.body) return;
    const show = on() && cityNow() && playing() && !hudBarPresent();
    if (!hotbarEl) {
      if (!show) return;
      ensureCss();
      hotbarEl = document.createElement("div");
      hotbarEl.id = "invHotbar";
      document.body.appendChild(hotbarEl);
      hotbarEl.addEventListener("mousedown", function (e) {
        const cell = e.target.closest && e.target.closest(".ci2Slot");
        if (!cell) return;
        e.preventDefault();
        if (CBZ.cityHotbarSelect) CBZ.cityHotbarSelect(+cell.dataset.i);
      });
    }
    if (!show) { if (hotbarEl.style.display !== "none") { hotbarEl.style.display = "none"; _hotSig = ""; } return; }
    let bar = [];
    try { bar = (CBZ.cityHotbar && CBZ.cityHotbar()) || []; } catch (e) { bar = []; }
    let sig = "";
    // the phone chip's LED/buzz are state too — without them in the signature
    // the bar would never repaint when the handset actually buzzes.
    for (let i = 0; i < bar.length; i++) {
      const b = bar[i];
      sig += (b.short || b.label) + ":" + (b.count | 0) + ":" + (b.active ? 1 : 0) +
        (b.unread ? "u" : "") + (b.buzz ? "z" : "") + "|";
    }
    if (sig === _hotSig && hotbarEl.style.display === "flex") return;
    _hotSig = sig;
    let html = "";
    for (let i = 0; i < bar.length && i < 9; i++) {
      const b = bar[i];
      const face = (b.kind === "item" || b.kind === "phone") ? itemFace(b.item || b.label, "md")
        : b.kind === "gun" ? weaponFace(b.id, b.label)
        : "<span class='s'>" + String(b.short || b.label || "?").slice(0, 6) + "</span>";
      const flags = b.kind === "phone" ? ((b.unread ? " unread" : "") + (b.buzz ? " buzz" : "")) : "";
      html += "<div class='ci2Slot" + (b.active ? " sel" : "") + flags + "' data-i='" + i + "'>" + face +
        (b.kind === "phone" ? "<i class='led' aria-hidden='true'></i>" : "") +
        (b.count != null && b.count > 1 ? "<span class='ct'>" + (b.count | 0) + "</span>" : "") + "</div>";
    }
    hotbarEl.innerHTML = html;
    hotbarEl.style.display = "flex";
  }

  // ============================================================
  //  PER-FRAME — chest prompts, item drops, arena-change hygiene
  // ============================================================
  let _promptT = 0, _hotT = 0;
  CBZ.onUpdate(37.4, function (dt) {
    if (!on() || !cityNow()) {
      chipText(null);
      if (openChestRef) closeChest();
      if (hotbarEl && hotbarEl.style.display !== "none") hotbarEl.style.display = "none";
      return;
    }
    registerChestItem();
    // arena swapped underneath us → rebuild chest meshes + drop the loose drops
    const root = arenaRoot();
    if (root && root !== _chestRoot) {
      teardownChests();
      clearItemDrops();
      const oldPeds = CBZ.cityPeds || [];
      for (let i = 0; i < oldPeds.length; i++) clearCorpseProp(oldPeds[i]);
      _chestRoot = root;
    }
    if (root) hydrateChests();
    installDeathWrap();          // death.js defines cityKillPlayer before us, but stay lazy-safe
    installDropWeaponWrap();     // peds.js defines cityDropWeapon before us, ditto

    tickItemDrops(dt);
    tickCorpseProps(dt);

    // fallback hotbar (throttled ~5 Hz; it's signature-gated inside)
    _hotT += dt;
    if (_hotT >= 0.2) { _hotT = 0; renderFallbackHotbar(); }

    // chest proximity chip at ~10 Hz
    _promptT += dt;
    if (_promptT >= 0.1) {
      _promptT = 0;
      const P = CBZ.player;
      if (playing() && P && !P.dead && !P.driving && !CBZ.cityMenuOpen && !CBZ.invOpen) {
        const c = chestNear(REACH);
        chipText(c ? chestPrompt(c) : null);
      } else chipText(null);
    }
  });

  // fresh run / mode switch: same lazy reset-chain hook storage.js uses
  function teardownAll() {
    g._cityInvHydrated = false;
    teardownChests();
    clearItemDrops();
    _chestRoot = null;
    cursor = null;
    if (openChestRef) closeChest();
    chipText(null);
  }
  function bindResetChain() {
    if (CBZ.cityVehiclesReset && !CBZ.cityVehiclesReset._inv2Wrapped) {
      const orig = CBZ.cityVehiclesReset;
      const wrapped = function () { try { teardownAll(); } catch (e) {} return orig.apply(this, arguments); };
      for (const k in orig) if (Object.prototype.hasOwnProperty.call(orig, k)) wrapped[k] = orig[k];
      wrapped._inv2Wrapped = true;
      CBZ.cityVehiclesReset = wrapped;
      return true;
    }
    return false;
  }
  if (!bindResetChain()) {
    CBZ.onUpdate(37.45, function () {
      if (CBZ.cityVehiclesReset && CBZ.cityVehiclesReset._inv2Wrapped) return;
      bindResetChain();
    });
  }

  installDeathWrap();
  installDropWeaponWrap();
  installCorpseLootWraps();
  registerChestItem();

  // ============================================================
  //  ICON CENSUS — CBZ.itemIconAudit()
  // ------------------------------------------------------------
  //  OWNER: "we have guns all with actual icons — every single item that can
  //  show in inventory should have an icon, not just a generic thing."
  //  This counts, against the REAL resolution path this file renders with,
  //  how many catalog entries still fall through to GENERIC.
  //    • a GUN resolves through weaponFace() -> CBZ.weaponThumbnail(id): an
  //      offscreen orthographic render of CBZ.buildActorWeapon(id), cached as
  //      one data URL per weapon (city/weapon_thumbnails.js). That is the
  //      style the purge must match — a drawn thing, not a letter.
  //    • everything else resolves through iconFor() -> iconGlyph(), which is
  //      the ICON / TAG_ICON tables above.
  //  The item catalog is read LIVE (cityEcon.ITEMS is exported by reference
  //  and six other files register into it at runtime — wildlife pelts/meat,
  //  farm goods, C4, strategic ordnance, dog food, the chest), so a species
  //  or a good added later shows up here with no edit.
  //  Pass {noRender:true} to skip the GL round-trip (answers from the presence
  //  of the thumbnail API instead) when a caller must not touch the renderer.
  //  RATCHET: `generic` may only ever go DOWN. `items`/`withIcon` are printed
  //  beside it so a "fix" that just shrinks the catalog cannot pass.
  // ============================================================
  function familyOf(name) {
    const it = items()[name] || {};
    if (it.pelt) return it.pristine ? "wildlife:pristine" : "wildlife:pelt";
    if (it.meat) return "wildlife:meat";
    if (it.tag === "weapon") return it.melee ? "weapon:melee" : "weapon:gun";
    if (it.tag === "ordnance" || it.tag === "throwable" || it.tag === "ammo") return "ordnance";
    if (it.tag === "clothing" || it.tag === "jewelry" || it.tag === "wearable") return "apparel:" + it.tag;
    return it.tag ? String(it.tag) : "untagged";
  }
  // "" = falls through to GENERIC. "gun" = a real weapon render. "glyph" = a
  // declared pictogram. Mirrors weaponFace()/iconFor() exactly.
  function iconKindOf(name, noRender) {
    const it = items()[name], gid = it && it.gun;
    if (gid) {
      if (noRender) return CBZ.weaponThumbnail ? "gun" : (iconGlyph(name) ? "glyph" : "");
      let src = "";
      try { if (CBZ.weaponThumbnail) src = CBZ.weaponThumbnail(gid); } catch (e) { src = ""; }
      if (src) return "gun";
    }
    return iconGlyph(name) ? "glyph" : "";
  }
  CBZ.itemIconAudit = function (opts) {
    const noRender = !!(opts && opts.noRender);
    const IT = items();
    const out = { items: 0, withIcon: 0, generic: 0, genericNames: [], guns: 0, glyphs: 0, byFamily: {}, bag: null };
    for (const name in IT) {
      if (!Object.prototype.hasOwnProperty.call(IT, name)) continue;
      out.items++;
      const kind = iconKindOf(name, noRender);
      if (kind === "gun") { out.withIcon++; out.guns++; continue; }
      if (kind === "glyph") { out.withIcon++; out.glyphs++; continue; }
      out.generic++;
      out.genericNames.push(name);
      const fam = familyOf(name);
      out.byFamily[fam] = (out.byFamily[fam] || 0) + 1;
    }
    out.genericNames.sort();
    // The ESCAPE/PRISON stash (systems/inventory.js over systems/economy.js) is
    // a SECOND inventory surface with its own catalog and its own equally empty
    // glyph table. Reported separately so the purge cannot "finish" by fixing
    // one screen, and so the city number stays the thing that is pinned.
    const eIT = CBZ.econ && CBZ.econ.ITEMS;
    if (eIT) {
      const bag = { items: 0, generic: 0, genericNames: [] };
      for (const n in eIT) {
        if (!Object.prototype.hasOwnProperty.call(eIT, n)) continue;
        bag.items++;
        let gl = "";
        try { gl = CBZ.escapeBagIcon ? CBZ.escapeBagIcon(n) : ""; } catch (e) { gl = ""; }
        if (!gl) { bag.generic++; bag.genericNames.push(n); }
      }
      bag.genericNames.sort();
      out.bag = bag;
    }
    return out;
  };

  // ============================================================
  //  PUBLIC SURFACE — charpanel.js hosts the [I] grid through this
  // ============================================================
  CBZ.cityInventory = {
    enabled: on,
    slots() { return MAIN; },
    resync,
    attach(gridEl) { if (!on() || !gridEl) return; attachedGridEl = gridEl; bindGridEl(gridEl); },
    renderPlayerGrid(gridEl) {
      if (!on()) return false;
      if (gridEl && gridEl !== attachedGridEl) { attachedGridEl = gridEl; bindGridEl(gridEl); }
      resync();
      renderGridInto(attachedGridEl, MAIN, "p", true);
      renderCursor();
      return true;
    },
    onOpen() { if (!on()) return; resync(); },
    onClose() { if (!on()) return; stashCursor(); persistSlots(); commit(); if (cursorEl) cursorEl.style.display = "none"; },
    hasCursor() { return !!cursor; },
    dropCursorToGround() {
      if (!cursor) return false;
      // the cursor stack leaves the player's possession for real
      const e = cursor; cursor = null;
      if (cursorSrc === "p") truthRemove(e, e.kind === "item" ? e.count : 1);
      dropEntryToGround(e);
      resync(); persistSlots(); persistChests();
      renderAllGrids();
      return true;
    },
    placeChest, chestNear, openChest, closeChest,
    chests() { return chests; },
  };

  /* ============================================================================
     CASH_BAGS_V1 — MONEY IS A PHYSICAL OBJECT.   [CBZ.cashBags]

     OWNER (2026-08-02, verbatim): "realistic amounts of money — even 10s or
     100s of millions can be in these things — in BAGS that the player can pick
     up and throw (interaction options) and put into the back of a truck…
     this is interaction/animation options and physical assets, not
     choreographed mini-missions. gta is fake, you do the mini missions that
     are choreographed — this is real."

     WHAT WAS WRONG. Every score in this game ended in `CBZ.city.addCash(n)`.
     You blew a vault door open and a NUMBER went up. Nothing left the room,
     nothing was in your hands, nothing could be dropped, stolen back, burned,
     or loaded into anything. The armoured truck came closest — it spills real
     duffel meshes on the tarmac — and then `grabLoot` walks over them and
     converts them to wallet cash on contact, which is the same abstraction
     wearing a mesh.

     THE LAW HERE: a bag is a THING IN THE WORLD with a value riding on it.
     It exists before you touch it, it exists after you drop it, it is still
     there when you come back, and nothing anywhere auto-banks it. The ONLY
     ways its value re-enters the wallet are a deliberate `deposit()` (a bank
     counter) and, in a later wave, a warehouse that counts what you stored.

     THE LEDGER IS STILL city/shops.js's CBZ.cityTill AND THAT IS THE WHOLE
     NON-MINTING ARGUMENT. A bag is SPAWNED by a caller that has already
     `take()`n the money out of a real balance — the vault is poorer by exactly
     what is now sitting on its floor in canvas. `payout()` below is the one
     call every such caller makes, so no site ever chooses between "physical"
     and "abstract" again: under the bag threshold it is notes in your pocket
     (a teller drawer IS notes in your pocket), over it, it is bags.

     THE CARRY IS A REAL COST, and it is expressed in verbs the game already
     owns rather than a new stat: you carry ONE duffel, it goes over your
     shoulder on the real rig, you CANNOT SPRINT with it (`P.sprint = false`,
     the exact line city/death.js writes for a blown leg), and RAISING A GUN
     DROPS IT — a man cannot shoulder a rifle and a duffel at the same time.
     That last rule is what makes a vault run a decision instead of a walk.

     WHY *RAISING*, NOT *CARRYING*, A GUN. The first draft refused the pickup
     while `cityHasGun()` was true, and that is a SOFT-LOCK: nothing in this
     game gives the player a holster key — `g.cityHolstered` is written only by
     wanted.js's surrender and by cinematics.js — so an armed player (i.e. any
     player who just blew a vault) could never have picked a bag up at all. The
     honest gate is the ACTION, not the inventory: `CBZ.isAimingWeapon()` is
     something you are doing this frame and can stop doing, so the cost is a
     decision instead of a wall.

     COST: bags are few by construction (a vault materialises at most
     BAG_CAP_ROOM of them) and the tick early-outs on an empty list. Thrown
     bags integrate ballistically for the second or so they are in the air and
     then go inert — no physics body, no per-frame cost once landed.
     ========================================================================== */
  const CFGB = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (CFGB.CASH_BAGS_V1 == null) CFGB.CASH_BAGS_V1 = true;
  // Below this, money is NOTES IN YOUR HAND (a teller drawer, a register, a
  // wallet off a corpse) and goes straight to the wallet exactly as it always
  // did. At or above it, money is too bulky to pocket and becomes a BAG. The
  // number is the physical fact, not a taste: $25,000 in used $20s is ~1.25 kg
  // and about the volume of a house brick — the last amount a person plausibly
  // walks out with in a jacket.
  const BAG_MIN = 25000;
  // What one duffel physically holds. $1M in $100 bills is ~10 kg and ~12 L;
  // a 60 L holdall therefore tops out near $5M in hundreds and rather less in
  // circulated fifties and twenties, which is what a bank vault actually
  // stores. $500k is the honest working figure for a mixed-denomination bag.
  const BAG_FILL = 500000;
  // ...but a room full of duffels is a room full of draw calls, so a single
  // haul is capped at this many bags and the per-bag value grows past
  // BAG_FILL when it has to. A $20M reserve is 18 fat bags, not 40 thin ones.
  const BAG_CAP_ROOM = 18;
  const BAG_CAP_WORLD = 90;              // citywide ceiling on live bags
  const BAG_REACH = 2.4;                 // how close you stand to pick one up
  const THROW_V = 8.4, THROW_UP = 3.6;   // a two-handed heave, m/s
  const BAG_G = 18.0;                    // the game's chunky gravity, not 9.81

  const BAGS = [];
  let _bagId = 1, _carried = null, _bagPose = false;
  const BAG_TALLY = { spawned: 0, value: 0, picked: 0, thrown: 0, deposited: 0, lost: 0, dyed: 0 };

  function bagsOn() { return CFGB.CASH_BAGS_V1 !== false; }
  function fmtB(n) { return "$" + Math.round(n || 0).toLocaleString("en-US"); }

  /* THE CARRY POSE, registered into the SHARED pose registry rather than
     written as arm math here — entities/poses.js owns the vocabulary and
     `CBZ.setCharPose` is the one entry point both peds.js and the packages
     use. A duffel over the right shoulder: the right arm comes up and across
     to grip the handle at the collarbone, the left hangs low and steadies the
     bag's flank. Degrade-safe: no poses.js, no pose, and the bag still rides
     the torso. */
  function ensureHaulPose() {
    const P = CBZ.charPoses;
    if (!P || P.haul) return;
    // (registered at LOAD, below — a pose that only appears once somebody has
    // already picked a bag up is a pose the first pickup renders without.)
    const damp = function (c, t, r, dt) { return c + (t - c) * (1 - Math.exp(-r * dt)); };
    P.haul = function (ch, dt) {
      const J = ch.low || {}, r = 14;
      const la = ch.parts && ch.parts.la, ra = ch.parts && ch.parts.ra;
      // right arm reaches UP and IN to the strap on the shoulder
      if (ra) { ra.rotation.x = damp(ra.rotation.x, -1.55, r, dt); ra.rotation.z = damp(ra.rotation.z, 0.62, r, dt); }
      if (J.ra) J.ra.rotation.x = Math.min(0, damp(J.ra.rotation.x, -1.55, r, dt));
      // left arm low and slightly out, taking the swing of the load
      if (la) { la.rotation.x = damp(la.rotation.x, -0.22, r, dt); la.rotation.z = damp(la.rotation.z, -0.28, r, dt); }
      if (J.la) J.la.rotation.x = Math.min(0, damp(J.la.rotation.x, -0.34, r, dt));
    };
  }
  // entities/poses.js loads far above this file (index.html 412 vs 1026), so the
  // registry is there at parse and the vocabulary is complete before the first
  // body ever asks for it.
  ensureHaulPose();

  // the mesh. `dyed` swaps the canvas for the ruined red a burst pack leaves.
  function bagMesh(bag) {
    let m = null;
    if (CBZ.itemAsset) {
      try {
        m = CBZ.itemAsset(null, null, {
          kind: "moneybag",
          canvas: bag.dyed ? 0x7a2a26 : (bag.tone != null ? bag.tone : 0x2f3a2c),
          note: bag.dyed ? 0x8c4a44 : 0x6fae5a,
          flash: bag.flash != null ? bag.flash : 0xc9a227,
        });
      } catch (e) { m = null; }
    }
    if (!m) {
      // degrade: still a real bag-shaped object, never an invisible pickup
      m = new THREE.Group();
      const mat = sharedMat(bag.dyed ? "bagdye" : "bagcanvas", bag.dyed ? 0x7a2a26 : 0x2f3a2c);
      propBox(m, 0.34, 0.30, 0.72, mat, 0, 0.16, 0);
      propBox(m, 0.20, 0.05, 0.20, sharedMat("bagstrap", 0x171a16), 0, 0.36, 0);
    }
    // A FAT BAG IS A BIGGER BAG. Log-scaled so a $5M sack reads heavier than a
    // $60k one without a $20M one becoming a shipping container.
    const k = Math.max(0.86, Math.min(1.30, 0.86 + 0.13 * Math.log10(Math.max(1, bag.amount) / 50000 + 1) * 2));
    m.userData._bagScale = k;
    m.scale.setScalar(k);
    m.userData.transient = true;
    m.userData._cashBag = bag.id;
    return m;
  }
  function disposeBagMesh(mesh) {
    if (!mesh) return;
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.traverse(function (o) {
      if (o.geometry && !o.geometry._shared && o.geometry.dispose) o.geometry.dispose();
      if (o.material && !o.material._shared && o.material.dispose) o.material.dispose();
    });
  }
  function reskin(bag) {
    const wasCarried = !!bag.carried;
    const parent = bag.mesh && bag.mesh.parent;
    disposeBagMesh(bag.mesh);
    bag.mesh = bagMesh(bag);
    if (wasCarried) mountOnBody(bag);
    else if (parent) { parent.add(bag.mesh); seatMesh(bag); }
    else { const root = arenaRoot(); if (root) { root.add(bag.mesh); seatMesh(bag); } }
  }
  function seatMesh(bag) {
    if (!bag.mesh) return;
    bag.mesh.position.set(bag.x, bag.y, bag.z);
    bag.mesh.rotation.set(0, bag.rot || 0, 0);
    const k = bag.mesh.userData._bagScale || 1;
    bag.mesh.scale.setScalar(k);            // back in world metres
  }
  /* Ride the real rig's torso: the duffel sits on the RIGHT SHOULDER and leans
     back across the spine, which is what a shouldered holdall does.

     THE SHOULDER IS SOLVED, NOT TYPED. `ch.body`'s local origin is not the
     chest and is not the same height on every rig (character.js builds from a
     per-body `profile`, and a child rig is a different animal entirely), so a
     hand-picked local offset put the bag on the FLOOR at the model's feet on
     the first plate. The arm pivot `ch.parts.ra` IS the shoulder by
     construction, so we ask where it is in world space and convert into the
     host's frame — which is proportion-invariant and needs no rig table. */
  const _mv = new THREE.Vector3(), _mp = new THREE.Vector3(), _mq = new THREE.Quaternion(), _ms = new THREE.Vector3();
  function mountOnBody(bag) {
    const ch = CBZ.playerChar;
    const host = (ch && ch.body) || (ch && ch.group) || null;
    if (!host || !bag.mesh) return false;
    host.add(bag.mesh);
    /* FORCE THE WHOLE RIG'S MATRICES FROM THE ROOT, not from the host. THREE's
       `updateMatrixWorld` recomputes a node from `this.parent.matrixWorld` and
       takes that as given — so calling it on `ch.body` while `ch.model`'s own
       world matrix is still identity (a rig built this frame and never yet
       rendered) silently reads the scale as 1. That is not hypothetical: it is
       exactly what made the first two attempts at this mount look untouched. */
    if (ch.group) ch.group.updateMatrixWorld(true); else host.updateMatrixWorld(true);
    /* THE RIG'S INNER FRAME IS NOT METRES, AND THIS IS THE TRAP.
       entities/character.js:720 does `model.scale.setScalar(humanScale)` — the
       node's own comment calls it "the metre conversion" — so EVERYTHING under
       `ch.model`, `ch.body` included, lives in a 0.70x space. A 0.76 m duffel
       parented there rendered as a 0.3 m green blob beside the character's ear,
       and no amount of nudging the offset would have fixed it, because the
       UNITS were wrong rather than the position. `group.userData.humanScale` is
       the repo's own published answer (character.js:618, read the same way at
       :1394 and :1630); the matrix decomposition behind it covers a rig that
       was scaled by something other than that node. */
    host.matrixWorld.decompose(_mp, _mq, _ms);
    const declared = (ch.group && ch.group.userData && ch.group.userData.humanScale) || 0;
    const hostScale = declared > 0.01 ? declared : (Math.abs(_ms.x) > 1e-4 ? _ms.x : 1);
    const k = (bag.mesh.userData._bagScale || 1) / hostScale;
    bag.mesh.scale.setScalar(k);
    const sh = ch && ch.parts && ch.parts.ra;
    if (sh) {
      sh.getWorldPosition(_mv);
      host.worldToLocal(_mv);
      // STRADDLE the joint, don't perch on top of it. The asset's origin is its
      // BASE (the itemassets.js convention), so seating that base at shoulder
      // height puts the whole bag ABOVE the shoulder. The offsets are in METRES
      // and converted into the host's frame, for the same reason as the scale.
      // OUTBOARD IS A SIGN, NOT A CONSTANT. Which way `+x` points from the
      // torso's origin depends on the rig's own frame, so pushing a fixed
      // +0.20 put the duffel through the middle of the character's chest.
      // Reading the sign off the shoulder joint itself works on any rig and
      // on either arm.
      const side = _mv.x >= 0 ? 1 : -1;
      bag.mesh.position.set(_mv.x + side * 0.12 / hostScale,
                            _mv.y - 0.34 / hostScale,
                            _mv.z - 0.20 / hostScale);
    } else {
      bag.mesh.position.set(0.30 / hostScale, 0.95 / hostScale, -0.10 / hostScale);
    }
    // long axis (Z) runs fore-and-aft down the back, tipped so the mass hangs
    bag.mesh.rotation.set(0.08, -0.20, -0.46);
    return true;
  }

  /* SPAWN — put `amount` dollars on the ground/shelf at (x,y,z). The CALLER
     has already moved the money out of a real balance; this file never mints.
     opts: {src, srcName, tone, flash, rot, dyed} */
  function bagSpawn(x, y, z, amount, opts) {
    if (!bagsOn()) return null;
    amount = Math.max(0, Math.round(amount || 0));
    if (amount <= 0) return null;
    if (BAGS.length >= BAG_CAP_WORLD) return null;
    opts = opts || {};
    const bag = {
      id: "bag" + (_bagId++), amount: amount, x: x, y: y, z: z,
      rot: opts.rot != null ? opts.rot : ((x * 7.13 + z * 3.71) % 6.2832),
      src: opts.src || null, srcName: opts.srcName || "cash",
      tone: opts.tone, flash: opts.flash, dyed: !!opts.dyed,
      carried: false, held: false, vy: 0, vx: 0, vz: 0, air: false, mesh: null,
    };
    bag.mesh = bagMesh(bag);
    const root = arenaRoot() || CBZ.scene;
    if (root) { root.add(bag.mesh); seatMesh(bag); }
    BAGS.push(bag);
    BAG_TALLY.spawned++; BAG_TALLY.value += amount;
    return bag;
  }

  /* PAYOUT — THE ONE CALL every score makes. It is what stops each site
     choosing for itself between "physical" and "a number", and it is why the
     teller drawer and the reserve vault can share one line of code.
     Returns {bags:[…], cash:N} so a caller can say what happened. */
  function bagPayout(x, y, z, amount, opts) {
    amount = Math.max(0, Math.round(amount || 0));
    const out = { bags: [], cash: 0, total: amount };
    if (amount <= 0) return out;
    opts = opts || {};
    if (!bagsOn() || amount < (opts.min != null ? opts.min : BAG_MIN)) {
      // notes in your hand — the shipped path, byte-identical.
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(amount); else g.cash = (g.cash || 0) + amount;
      out.cash = amount;
      return out;
    }
    const cap = Math.max(1, Math.min(BAG_CAP_ROOM, opts.cap || BAG_CAP_ROOM));
    const n = Math.max(1, Math.min(cap, Math.ceil(amount / BAG_FILL)));
    const per = Math.floor(amount / n);
    let left = amount;
    for (let i = 0; i < n; i++) {
      const a = (i === n - 1) ? left : per;
      left -= a;
      // deterministic scatter around the drop point (a build path must never
      // draw on Math.random — CLAUDE.md's determinism law).
      const h = CBZ.hash01 ? CBZ.hash01(x + i * 0.37, z - i * 0.53, "cashbag") : ((i * 0.137) % 1);
      const h2 = CBZ.hash01 ? CBZ.hash01(x - i * 0.71, z + i * 0.29, "cashbag2") : ((i * 0.311) % 1);
      const ang = h * 6.2832, rad = (opts.spread != null ? opts.spread : 1.6) * (0.35 + h2 * 0.65);
      const bx0 = x + Math.cos(ang) * rad, bz0 = z + Math.sin(ang) * rad;
      const b = bagSpawn(bx0, opts.onFloor === false ? y : (CBZ.floorAt ? floorY(bx0, bz0) : y), bz0, a, opts);
      if (b) out.bags.push(b); else { out.cash += a; if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(a); }
    }
    return out;
  }

  function bagNearest(px, pz, reach, py) {
    if (!bagsOn() || !BAGS.length) return null;
    const r = reach || BAG_REACH, r2 = r * r;
    let best = null, bd = r2;
    for (let i = 0; i < BAGS.length; i++) {
      const b = BAGS[i];
      if (b.carried || b.air) continue;
      if (py != null && Math.abs(b.y - py) > 2.4) continue;
      const dx = b.x - px, dz = b.z - pz, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  function bagPickup(bag) {
    if (!bagsOn() || !bag || bag.carried) return false;
    if (_carried) { note("You've already got a bag on your shoulder, put it down first.", 1.8); return false; }
    const P = CBZ.player; if (!P || P.dead) return false;
    // A MAN CANNOT SHOULDER A RIFLE AND A DUFFEL. Lower the gun first — an
    // action you can take, never a wall (see the header's soft-lock note).
    if (CBZ.isAimingWeapon && CBZ.isAimingWeapon()) { note("Both hands. Lower the gun first.", 1.9); return false; }
    if (bag.mesh && bag.mesh.parent) bag.mesh.parent.remove(bag.mesh);
    bag.carried = true; bag.held = true; bag.air = false;
    _carried = bag;
    if (!mountOnBody(bag)) {
      // no rig up (first person before the char exists): keep the record and
      // re-mount on the next tick rather than dropping the money on the floor.
      bag._needMount = true;
    }
    ensureHaulPose();
    if (CBZ.setCharPose && CBZ.playerChar) { try { CBZ.setCharPose(CBZ.playerChar, "haul"); _bagPose = true; } catch (e) {} }
    BAG_TALLY.picked++;
    sfx("coin");
    note("Hauling " + fmtB(bag.amount) + ". You can't sprint or shoot with this.", 2.2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  function releasePose() {
    if (!_bagPose) return;
    _bagPose = false;
    if (CBZ.setCharPose && CBZ.playerChar) { try { CBZ.setCharPose(CBZ.playerChar, "stand"); } catch (e) {} }
  }

  // put the carried bag back into the world. `vel` makes it a THROW.
  function bagRelease(vel, quiet) {
    const bag = _carried;
    if (!bag) return null;
    const P = CBZ.player;
    const yaw = (CBZ.cam && CBZ.cam.yaw) || 0;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const px = P ? P.pos.x : bag.x, pz = P ? P.pos.z : bag.z;
    const py = P ? (P.pos.y || 0) : bag.y;
    _carried = null;
    bag.carried = false;
    if (bag.mesh && bag.mesh.parent) bag.mesh.parent.remove(bag.mesh);
    const root = arenaRoot() || CBZ.scene;
    if (root && bag.mesh) root.add(bag.mesh);
    releasePose();
    if (vel) {
      bag.x = px + fx * 0.7; bag.z = pz + fz * 0.7; bag.y = py + 1.15;
      bag.vx = fx * THROW_V; bag.vz = fz * THROW_V; bag.vy = THROW_UP;
      bag.air = true;
      BAG_TALLY.thrown++;
      if (!quiet) note("Heaved " + fmtB(bag.amount) + ".", 1.5);
    } else {
      bag.x = px + fx * 0.85; bag.z = pz + fz * 0.85;
      bag.y = CBZ.floorAt ? floorY(bag.x, bag.z) : py;
      bag.vx = bag.vy = bag.vz = 0; bag.air = false;
      if (!quiet) note("Set down " + fmtB(bag.amount) + ".", 1.5);
    }
    seatMesh(bag);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return bag;
  }

  // CONSUME a bag into something else — a truck bed, a warehouse shelf, a
  // stash. THE SEAM THE NEXT WAVE EATS: it returns the dollars and destroys
  // the object, so a cargo hold can hold VALUE without this file knowing what
  // a cargo hold is.
  function bagTake(bag) {
    if (!bag) return 0;
    const amt = bag.amount | 0;
    if (bag === _carried) { _carried = null; releasePose(); }
    disposeBagMesh(bag.mesh);
    bag.mesh = null; bag.amount = 0; bag.dead = true;
    const i = BAGS.indexOf(bag); if (i >= 0) BAGS.splice(i, 1);
    return amt;
  }
  // …and the ONE place a bag legitimately becomes wallet money: you handed it
  // over a counter. Nothing calls this by walking near it.
  function bagDeposit(bag) {
    const amt = bagTake(bag);
    if (amt > 0) {
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(amt); else g.cash = (g.cash || 0) + amt;
      BAG_TALLY.deposited += amt;
      sfx("coin");
    }
    return amt;
  }
  // A DYE PACK RUINS NOTES, IT DOES NOT DELETE THEM FROM THE UNIVERSE. The bag
  // stays; it is worth less and it LOOKS ruined, which is the point.
  function bagDye(bag, frac) {
    if (!bag || bag.dyed) return 0;
    const burn = Math.round(bag.amount * Math.max(0, Math.min(0.9, frac || 0.2)));
    bag.amount = Math.max(0, bag.amount - burn);
    bag.dyed = true;
    BAG_TALLY.dyed++;
    reskin(bag);
    return burn;
  }

  function bagsClear() {
    for (let i = BAGS.length - 1; i >= 0; i--) disposeBagMesh(BAGS[i].mesh);
    BAGS.length = 0;
    if (_carried) { _carried = null; releasePose(); }
  }

  // how much of a given source's money the player has physically had hold of.
  // heists.js reads this instead of keeping its own abstract bag meter.
  function bagsHeldFrom(src) {
    let s = 0;
    for (let i = 0; i < BAGS.length; i++) { const b = BAGS[i]; if (b.src === src && b.held) s += b.amount; }
    return s;
  }

  let _bagElapsed = 0;
  CBZ.onUpdate(37.42, function (dt) {
    if (!bagsOn()) return;
    // fresh-run rewind (the same g.elapsed trick armored.js/explosives.js use)
    const el = g.elapsed || 0;
    if (el + 0.001 < _bagElapsed) bagsClear();
    _bagElapsed = el;
    if (g.mode !== "city") { if (BAGS.length) bagsClear(); return; }
    if (!BAGS.length) return;
    const P = CBZ.player;
    // ---- the carried bag ----------------------------------------------------
    if (_carried) {
      if (!P || P.dead) {
        // you go down, the bag hits the deck where you did. It is not deleted:
        // somebody can come back for it, and so can you.
        bagRelease(false, true);
      } else {
        if (_carried._needMount && CBZ.playerChar) { if (mountOnBody(_carried)) _carried._needMount = false; }
        // ENCUMBRANCE, expressed the way this codebase already expresses it
        // (city/death.js's blown-leg line). No new stat, no new multiplier.
        P.sprint = false;
        // and RAISING the gun means the bag goes down — you chose the gun.
        if (CBZ.isAimingWeapon && CBZ.isAimingWeapon()) {
          note("Dropped the bag to bring the gun up.", 1.7);
          bagRelease(false, true);
        } else if (P.driving) {
          // getting into a car with a duffel: it goes in with you (out of the
          // world, into your hands) — the cargo wave gives it a boot to sit in.
          bagRelease(false, true);
        }
      }
    }
    // ---- thrown bags: a second of ballistics, then inert --------------------
    for (let i = 0; i < BAGS.length; i++) {
      const b = BAGS[i];
      if (!b.air) continue;
      b.vy -= BAG_G * dt;
      b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
      const fy = CBZ.floorAt ? floorY(b.x, b.z) : 0;
      if (b.y <= fy) {
        b.y = fy; b.air = false; b.vx = b.vy = b.vz = 0;
        sfx("thud");
      }
      seatMesh(b);
    }
  });

  /* THE SEAM ANOTHER WAVE CONSUMES. Everything a truck bed, a plane hold or a
     warehouse counter needs, and nothing it does not: list what exists, take
     one out of the world for a value, and put one back. */
  CBZ.cashBags = {
    spawn: bagSpawn,
    payout: bagPayout,
    list: function () { return BAGS.slice(); },
    count: function () { return BAGS.length; },
    nearest: bagNearest,
    pickup: bagPickup,
    carried: function () { return _carried; },
    drop: function () { return bagRelease(false, false); },
    throw: function () { return bagRelease(true, false); },
    take: bagTake,
    deposit: bagDeposit,
    dye: bagDye,
    heldFrom: bagsHeldFrom,
    clear: bagsClear,
    value: function (b) { return b ? (b.amount | 0) : 0; },
    // how loaded you are, 0..1 — for anything that wants to bend a number
    // rather than read the boolean.
    encumbrance: function () { return _carried ? Math.min(1, 0.55 + _carried.amount / 8e6) : 0; },
    BAG_MIN: BAG_MIN, BAG_FILL: BAG_FILL,
  };

  /* RATCHET. `orphaned` is the honest failure mode of a physical-money system:
     a bag whose mesh never made it into the scene is money the player can
     never reach, and it is PINNED AT 0. `live`/`value` print beside it so a
     "fix" that simply stops spawning bags cannot pass. `autoBanked` counts
     dollars this file converted to wallet cash WITHOUT a deliberate deposit —
     structurally 0, because the only such path is a sub-BAG_MIN payout, which
     is counted separately as `pocketed`. */
  CBZ.cashBagAudit = function () {
    let live = 0, value = 0, orphaned = 0, carried = 0, dyed = 0;
    for (let i = 0; i < BAGS.length; i++) {
      const b = BAGS[i];
      live++; value += b.amount;
      if (!b.mesh || (!b.carried && !b.mesh.parent)) orphaned++;
      if (b.carried) carried++;
      if (b.dyed) dyed++;
    }
    return {
      live: live, value: value, orphaned: orphaned, carried: carried, dyedLive: dyed,
      spawned: BAG_TALLY.spawned, spawnedValue: BAG_TALLY.value,
      picked: BAG_TALLY.picked, thrown: BAG_TALLY.thrown,
      deposited: BAG_TALLY.deposited, dyed: BAG_TALLY.dyed,
      cap: BAG_CAP_WORLD, bagMin: BAG_MIN, bagFill: BAG_FILL,
      poseWired: !!(CBZ.charPoses && CBZ.charPoses.haul),
    };
  };
})();
