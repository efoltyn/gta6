/* ============================================================
   city/inventory.js — THE THINGS YOU DROP, STASH AND CARRY OUT.

   There is no inventory screen. What you carry is the one bar
   (systems/inventory.js #hotbar: the guns, the blade, the phone, the keys)
   and what is in your hands; what you own is where you left it. This file
   is the physical half of that:

     DROPS    CBZ.cityDropItem: a thing on the ground is a real prop you
              walk up to and pick up (a gun, a blade, a stack, cash).
     CORPSES  what a dead man was carrying lies by him as props.
     DEATH    an armed death costs the gun in your hand: it hits the
              pavement as a pickup (wraps CBZ.cityKillPlayer).
     CHESTS   a box you buy and set down anywhere. Standing at it:
                Put in the <gun in your hands>      E, with a gun out
                Take the <last thing in>            E
                Take everything                     hold E
                Put in what you're carrying         product, valuables, materials
                Take the <thing>                    each thing, round the wheel (Q)
                Pick up the chest                   when it is empty
              and its card says what is inside. Saved in the world ledger
              (w.chests), rebuilt when the arena changes.
     BAGS     CBZ.cashBags: money over $25,000 is a duffel you carry.

   (2026-11-22: this file used to draw a 27-slot grid you rearranged with a
   mouse cursor, hosted by an [I] overlay in city/charpanel.js, and a second
   27-slot grid in an HTML panel for every chest. Both grids, their slot
   arrangement save, their stack caps and their stylesheet are deleted.)

   Feature flag: CBZ.CONFIG.INVENTORY_V2 (config.js, default true).
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
  // THE SURFACE A DROPPED THING COMES TO REST ON. floorY is the terrain and
  // knows nothing about roofs, storeys or decks, so a wallet dropped on a
  // roof was drawn at the player's feet and a corpse's cash on the third floor
  // went to the street under it. CBZ.groundAt (systems/physics.js) is the
  // floor the player actually stands on — terrain, slabs, roofs, stairs —
  // asked from just above where the thing left the hand, so it lands on the
  // highest surface at or below that point (over a roof edge: the street).
  function restY(x, z, fromY) {
    if (CBZ.groundAt) {
      try {
        const y = CBZ.groundAt(x, z, fromY != null && isFinite(fromY) ? fromY + 0.4 : undefined);
        if (typeof y === "number" && isFinite(y)) return y;
      } catch (e) {}
    }
    return (fromY != null && isFinite(fromY)) ? fromY : floorY(x, z);
  }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s); }
  function sfx(n) { if (CBZ.sfx) { try { CBZ.sfx(n); } catch (e) {} } }
  if (CBZ.weaponPhysics && CBZ.weaponPhysics.adopt) CBZ.weaponPhysics.adopt("inventory-drops");

  // ============================================================
  //  CATALOG GLUE
  // ============================================================
  const CHEST_N = 27;                    // different things one chest holds
  const REACH = 2.2;                     // chest open reach
  const CHEST_COST = 250;

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

  // ============================================================
  //  WHAT A CHEST HOLDS: plain JSON entries (never a mesh / THREE ref)
  //    { kind:"item",   name, count }
  //    { kind:"weapon", id, name }             (a gun: weaponInventory truth)
  //    { kind:"weapon", melee:true, name }     (g.cityMeleeWeapon truth)
  // ============================================================

  // is the melee piece on your belt also a counted item in your pockets?
  function meleeShownAsItem() {
    const m = g.cityMeleeWeapon;
    return !!(m && econ() && econ().count(m) > 0);
  }

  // ============================================================
  //  TRUTH MUTATIONS — the only places a chest op touches the stores.
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
  // CASH ON THE GROUND IS CASH. A pocket's worth is a folded wad of notes,
  // a take is banded stacks in a heap, a fortune is a zipped duffel. It used
  // to be a BRIEFCASE for every amount — a dead man's $80 appeared beside
  // him as an attache case. Amounts are bucketed so the baked-geometry cache
  // holds a dozen variants, not one per dollar figure.
  function cashOpts(amt) {
    amt = Math.max(1, amt | 0);
    if (amt < 400) return { amount: amt >= 120 ? 200 : 100 };
    return { amount: Math.max(1, Math.min(10, Math.round(amt / 2000))) * 2000 };
  }
  function makeCash(amt) {
    amt = Math.max(0, amt | 0);
    if (amt >= 60000) {
      return assetProp(null, null, "moneybag", { state: "closed" }) || crateDegrade(0.34, 0.30, 0.72, PM.cloth);
    }
    return assetProp(null, null, "cashpile", cashOpts(amt)) || makeBriefcase(amt < 250);
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
    else if (payload.cash != null) prop = makeCash(payload.cash);
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
    const y0 = restY(x, z, payload.y != null ? payload.y : null);
    const physicalGun = !!(payload.weaponId && CBZ.weaponPhysics &&
      CBZ.weaponPhysics.drop && (!CBZ.CONFIG || CBZ.CONFIG.WEAPON_GROUND_PHYSICS !== false));
    if (root) {
      mesh = makePhysicalDrop(payload);
      // A physical gun leaves hand/hip height and falls. Non-gun items retain
      // their old static placement until they gain an honest body contract.
      const lift = physicalGun ? 0.78 :
        (mesh.userData._assetSeated ? 0.004 : (payload.weaponId || payload.melee ? 0.18 : 0.03));   // seated assets rest ON the surface
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
    const lift = physicalGun ? 0.72 : (prop.userData._assetSeated ? 0.004 : 0.18);
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
      if ((g.cityMeleeWeapon || g.cityMeleeStowed) && (g.cityMeleeWeapon || g.cityMeleeStowed) !== d.melee) { if (E) E.add(d.melee, 1); }   // belt full → into the bag
      else { g.cityMeleeWeapon = d.melee; g.cityMeleeStowed = null; }
      note("Picked up " + d.melee, 1.4);
    } else if (d.name) {
      if (E) E.add(d.name, d.count || 1);
      note("Picked up " + (d.count > 1 ? d.count + "× " : "") + d.name, 1.4);
    }
    sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  // TAKEN WITH A HAND (systems/verbs_pickup.js): it leaves the ground in the
  // hand and is yours on the grab frame. Walking over it does this; so do E,
  // Q and a tap on it (the "ground-item" fixture below), from arm's length.
  function takeItemDrop(d) {
    const P = CBZ.player;
    if (!d || d._taking || !P) return;
    d._taking = true;
    const took = function () {
      pickupItemDrop(d);
      const j = CBZ.cityItemDrops.indexOf(d);
      if (j >= 0) removeItemDrop(j);
    };
    const kind = d.cash > 0 ? "cash" : (d.weaponId ? "gun" : "box");
    if (CBZ.verbs && CBZ.verbs.pickup) {
      CBZ.verbs.pickup(P, d.mesh || { x: d.x, y: d.y0, z: d.z, kind: kind },
        { pose: kind === "cash" ? "card" : "grip", keep: !!(d.weaponId || d.melee), onTaken: took });
    } else took();
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
      if (d._taking) continue;           // a hand is already on it
      if (P && !P.dead && !P.driving && !(CBZ.cuffedPlayer && CBZ.cuffedPlayer.on()) && Math.abs(P.pos.y - d.y0) < 2.5 &&
          Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < 1.5) {
        takeItemDrop(d);
        continue;
      }
      if (d.t > d.ttl) removeItemDrop(i);
    }
  }
  function clearItemDrops() { for (let i = CBZ.cityItemDrops.length - 1; i >= 0; i--) removeItemDrop(i); }

  // WHAT A BODY LEAVES ON THE GROUND is what fell out of its pockets: the
  // wallet (or, for a man carrying a real amount, the banded stacks), and ONE
  // carried thing that spilled — the baggie, the phone, the keys. It used to
  // be a BRIEFCASE or a BACKPACK conjured beside every corpse in the city,
  // luggage nobody was carrying a second earlier. Worn things (the watch, the
  // ring, the chain) stay on the body, where the loot card finds them. The
  // corpse remains the interaction target, so every loot rule and economy
  // debit stays authoritative; this is only what you SEE.
  const SPILL_KINDS = { drug: 1, pill: 1, phone: 1, key: 1, keycard: 1, cash: 1, ammo: 1, grenade: 1,
                        melee: 1, pick: 1, tool: 1, crowbar: 1, gold: 1, laptop: 1, bomb: 1 };
  function spillName(list) {
    if (!Array.isArray(list) || !CBZ.itemAssetKind) return null;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (!n || typeof n !== "string") continue;
      let k = null;
      try { k = CBZ.itemAssetKind(n, items()[n] || null, null); } catch (e) { k = null; }
      if (k && SPILL_KINDS[k]) return n;
    }
    return null;
  }
  function corpseProp(dl) {
    const grp = new THREE.Group();
    if (dl.cash > 0) {
      const c = dl.cash >= 1500 ? assetProp(null, null, "cashpile", cashOpts(dl.cash))
        : assetProp("Wallet", items()["Wallet"] || null, "wallet", null);
      if (c) grp.add(c);
    }
    const sp = spillName(dl.items);
    if (sp) {
      const s = assetProp(sp, items()[sp] || null, null, null);
      if (s) { s.position.set(0.30, 0, 0.16); s.rotation.y = 1.1; grp.add(s); }
    }
    return grp.children.length ? grp : null;
  }
  function clearCorpseProp(ped) {
    const prop = ped && ped._invLootProp;
    if (prop && prop.parent) prop.parent.remove(prop);
    if (ped) ped._invLootProp = null;
  }
  function mountCorpseProp(ped) {
    if (!ped || !ped.dead || !ped.deadLoot || ped.deadLoot.looted) { clearCorpseProp(ped); return; }
    if (ped._invLootProp && ped._invLootProp.parent) return;
    const root = arenaRoot(); if (!root || !ped.pos) return;
    const dl = ped.deadLoot;
    if (ped._invLootNone === dl) return;             // nothing fell out of these pockets: never re-ask
    const prop = corpseProp(dl);
    if (!prop) { ped._invLootNone = dl; return; }
    prop.userData.transient = true;
    const a = ((ped.pos.x * 5 + ped.pos.z * 11) % 6.28);
    const px = ped.pos.x + Math.cos(a) * 0.48, pz = ped.pos.z + Math.sin(a) * 0.48;
    prop.position.set(px, restY(px, pz, ped.pos.y) + 0.004, pz);
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

  // ============================================================
  //  PLAYER DEATH DROP. Wraps CBZ.cityKillPlayer. A death costs the GUN IN
  //  YOUR HAND (it hits the pavement as a real pickup you can run back for)
  //  and a QUARTER of the cash in your pocket (scattered at the spot). The
  //  rest of the loadout and 75% of the pocket ride with you to the hospital,
  //  where death.js bills the pocket; wanted.js's cityDeathPenalty takes the
  //  respect + heat. death.js only lockWeapon()s the hand when this V2 path
  //  is absent, so the gun is never removed twice. Stowed guns (a police
  //  stop, g._copStow) were not in your hand: they stay stowed and police.js
  //  redraws them on respawn.
  // ============================================================
  const DEATH_CASH_DROP = 0.25;
  function installDeathWrap() {
    if (typeof CBZ.cityKillPlayer !== "function" || CBZ.cityKillPlayer._invKPWrap) return;
    const orig = CBZ.cityKillPlayer;
    const wrapped = function (reason, imp) {
      try {
        const P = CBZ.player;
        const seen = imp && imp._invDeathSeen;
        if (!seen && on() && cityNow() && P && !P.dead) {
          if (imp) imp._invDeathSeen = true;
          const px = P.pos.x, pz = P.pos.z, py = P.pos.y;
          const lost = [];
          const cash = Math.max(0, Math.round(g.cash || 0));
          const drop = Math.floor(cash * DEATH_CASH_DROP);
          if (drop > 0) {
            CBZ.cityDropItem(px + (Math.random() - 0.5) * 0.8, pz + (Math.random() - 0.5) * 0.8,
              { cash: drop, y: py, ttl: 300 });
            g.cash = cash - drop;
            lost.push("$" + drop);
          }
          const inHand = !g._copStow && CBZ.currentWeaponId;
          if (inHand && CBZ.weaponInventory && CBZ.weaponInventory.indexOf(inHand) >= 0) {
            // ammo:0: reserves live per-weapon inside fpsmode and survive the
            // drop/re-pickup round-trip; a bonus here would be a death-farm.
            CBZ.cityDropItem(px + (Math.random() - 0.5) * 1.6, pz + (Math.random() - 0.5) * 1.6,
              { weaponId: inHand, ammo: 0, y: py, ttl: 300 });
            const nm = gunName(inHand);
            if (CBZ.lockWeapon) CBZ.lockWeapon(inHand);
            else { CBZ.weaponInventory.splice(CBZ.weaponInventory.indexOf(inHand), 1); CBZ.currentWeaponId = CBZ.weaponInventory[0] || null; }
            lost.push("your " + (nm || "gun"));
          } else if (!inHand && !g._copStow && g.cityMeleeWeapon && !meleeShownAsItem()) {
            // bare-handed but swinging a melee piece: that is what was in your hand
            CBZ.cityDropItem(px + (Math.random() - 0.5) * 1.6, pz + (Math.random() - 0.5) * 1.6,
              { melee: g.cityMeleeWeapon, y: py, ttl: 300 });
            lost.push("your " + g.cityMeleeWeapon);
            g.cityMeleeWeapon = null;
          }
          if (lost.length) note("You dropped " + lost.join(" and ") + " where you fell. Go back for it.", 3);
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
  //  PERSISTENCE — the chests, in the worldstate ledger (w.chests)
  // ============================================================
  function cloneEntry(e) { return e ? JSON.parse(JSON.stringify(e)) : null; }
  function persistChests() {
    if (!CBZ.cityWorldEnsure) return;
    const w = CBZ.cityWorldEnsure(); if (!w) return;
    w.chests = chests.map((c) => ({ id: c.id, x: c.x, z: c.z, y: c.y, slots: c.slots.filter(Boolean).map(cloneEntry) }));
  }
  function commit() { if (CBZ.cityWorldCommit) { try { CBZ.cityWorldCommit(); } catch (e) {} } }

  function validEntry(e) {
    if (!e || typeof e !== "object") return null;
    if (e.kind === "item" && typeof e.name === "string" && (e.count | 0) > 0) return { kind: "item", name: e.name, count: e.count | 0 };
    if (e.kind === "weapon" && e.melee && typeof e.name === "string") return { kind: "weapon", melee: true, name: e.name };
    if (e.kind === "weapon" && typeof e.id === "string") return { kind: "weapon", id: e.id, name: e.name || gunName(e.id) };
    return null;
  }

  // ============================================================
  //  CHESTS — placeable world stashes: { id, x, z, mesh, slots[27] }
  // ============================================================
  const chests = [];
  let _chestRoot = null;

  // THE CHEST IN YOUR BAG IS THE CHEST ON THE GROUND: city/itemassets.js's
  // `chest` builder (a banded wooden trunk, same 1.0 x 0.8 x 0.8 footprint),
  // so the item icon is a photograph of the object you are about to place,
  // not a drawing of one. `itemAsset` (not `itemAssetPickup`)
  // because a chest is world-sized already and must not be normalised.
  function buildChestMesh(x, z, y0) {
    const root = arenaRoot(); if (!root) return null;
    const grp = new THREE.Group();
    // the floor it was set down on (a chest in a flat upstairs stays upstairs);
    // records saved before `y` existed fall back to the terrain as before
    const y = (y0 != null && isFinite(y0)) ? restY(x, z, y0) : floorY(x, z);
    grp.position.set(x, y, z);
    let body = null;
    if (CBZ.itemAsset) { try { body = CBZ.itemAsset("Chest", null, { kind: "chest" }); } catch (e) { body = null; } }
    if (body) grp.add(body);
    else {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.8), cmat(0x5e3f24));
      b.position.y = 0.3; grp.add(b);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.2, 0.84), cmat(0x6d4a2b));
      lid.position.y = 0.7; grp.add(lid);
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.06), cmat(0x3a3e44));
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
      const slots = Array.isArray(rec.slots) ? rec.slots.map(validEntry).filter(Boolean) : [];
      chests.push({ id: rec.id || ("c" + chests.length), x: rec.x, z: rec.z, y: rec.y, slots, mesh: buildChestMesh(rec.x, rec.z, rec.y) });
    }
    _chestRoot = arenaRoot();
  }
  function teardownChests() {
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
    const cy = restY(x, z, P.pos.y);
    const c = { id: "c" + Date.now().toString(36) + ((Math.random() * 1e4) | 0), x, z, y: cy, slots: [], mesh: buildChestMesh(x, z, cy) };
    chests.push(c);
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
    persistChests(); commit();
    return true;
  }

  // ============================================================
  //  WHAT IS IN A CHEST, AND THE HANDS THAT MOVE IT. A chest is a box in the
  //  world with things in it. There is no screen: standing at it you put in
  //  the gun in your hands or what you are carrying, and you take things out
  //  by name (E the last thing in, hold E all of it, Q each thing).
  // ============================================================
  function chestList(c) { return c.slots.filter(Boolean); }
  function entryText(e) { return e.kind === "item" && e.count > 1 ? e.count + " " + e.name : e.name; }
  // what the card says is inside, without opening anything
  function chestRead(c) {
    const l = chestList(c);
    if (!l.length) return "empty";
    const head = l.slice(-3).reverse().map(entryText).join(", ");
    return l.length > 3 ? head + " and " + (l.length - 3) + " more" : head;
  }
  function sameEntry(a, b) {
    if (a.kind !== b.kind) return false;
    if (a.kind === "item") return a.name === b.name;
    return a.melee ? (!!b.melee && a.name === b.name) : (!b.melee && a.id === b.id);
  }
  function saveChests() { persistChests(); commit(); }
  // entry leaves you and goes in the box
  function chestPut(c, entry) {
    if (!c || !entry) return false;
    let l = chestList(c);
    const stack = entry.kind === "item" ? l.find((s) => sameEntry(s, entry)) : null;
    if (!stack && l.length >= CHEST_N) { note("It's full.", 1.4); return false; }
    if (!truthRemove(entry, entry.kind === "item" ? entry.count : 1)) return false;
    if (stack) stack.count += entry.count;
    else l.push(cloneEntry(entry));
    c.slots = l;
    sfx("pickup");
    saveChests();
    return true;
  }
  // entry i comes out of the box and is yours
  function chestTake(c, i) {
    const l = chestList(c), e = l[i];
    if (!e) return false;
    if (!truthAdd(e, e.kind === "item" ? e.count : 1)) return false;
    l.splice(i, 1);
    c.slots = l;
    sfx("pickup");
    saveChests();
    return true;
  }
  function chestTakeAll(c) {
    let any = false;
    for (let i = chestList(c).length - 1; i >= 0; i--) if (chestTake(c, i)) any = true;
    return any;
  }
  // the gun you have out
  function heldGun() {
    const id = CBZ.currentWeaponId;
    if (!id || !(CBZ.cityHasGun && CBZ.cityHasGun())) return null;
    if ((CBZ.weaponInventory || []).indexOf(id) < 0) return null;
    return { kind: "weapon", id: id, name: gunName(id) };
  }
  // what you are carrying that a box is for: product, valuables, materials
  const LOOT_TAG = { drug: 1, valuable: 1, resource: 1 };
  function lootOnYou() {
    const inv = g.cityInv || {}, IT = items(), out = [];
    for (const name in inv) {
      const n = inv[name] | 0, it = IT[name];
      if (n > 0 && it && LOOT_TAG[it.tag]) out.push({ kind: "item", name: name, count: n });
    }
    return out;
  }
  function putLoot(c) {
    let any = false;
    for (const e of lootOnYou()) if (chestPut(c, e)) any = true;
    return any;
  }


  let chestWired = false;
  function wireChests() {
    if (chestWired || !CBZ.interactions || !CBZ.interactions.registerFixtures) return;
    chestWired = true;
    if (CBZ.interactions.describe) CBZ.interactions.describe("chest", function (c) { return { label: "Chest", note: chestRead(c) }; });
    CBZ.interactions.registerFixtures({
      id: "chest", kind: "chest", prio: 8,
      list: function () { return on() && cityNow() ? chests : null; },
      reach: function () { return REACH; },
      dot: function () { return 0.55; },
      verbs: (function () {
        const V = [
          { id: "chest-put-gun", slot: "e", prio: 6, canShow: function () { return !!heldGun(); },
            label: function () { const h = heldGun(); return "Put in the " + (h ? h.name : "gun"); },
            onSelect: function (c) { const h = heldGun(); if (h) chestPut(c, h); } },
          { id: "chest-take-last", slot: "e", prio: 5, canShow: function (c) { return !heldGun() && chestList(c).length > 0; },
            label: function (c) { const l = chestList(c); return "Take the " + entryText(l[l.length - 1]); },
            onSelect: function (c) { chestTake(c, chestList(c).length - 1); } },
          { id: "chest-take-all", slot: "e", hold: true, prio: 5, canShow: function (c) { return chestList(c).length > 0; },
            label: "Take everything", onSelect: function (c) { chestTakeAll(c); } },
          { id: "chest-put-loot", prio: 4, canShow: function () { return lootOnYou().length > 0; },
            label: "Put in what you're carrying", onSelect: function (c) { putLoot(c); } },
          { id: "chest-pack", wheel: true, prio: 1, canShow: function (c) { return chestEmpty(c); },
            label: "Pick up the chest", onSelect: function (c) { pickupEmptyChest(c); } },
        ];
        // each thing in it, by name, round the wheel
        for (let n = 0; n < 8; n++) {
          V.push({ id: "chest-take-" + n, wheel: true, prio: 3,
            canShow: function (c) { const l = chestList(c); return !!l[n] && (n !== l.length - 1 || !!heldGun()); },   // (the last one in is E)
            label: function (c) { const e = chestList(c)[n]; return e ? "Take the " + entryText(e) : ""; },
            onSelect: function (c) { chestTake(c, n); } });
        }
        return V;
      })(),
    });
    CBZ.interactions.registerFixtures({
      id: "ground-item", kind: "ground-item", prio: 7,
      list: function () {
        const P = CBZ.player;
        return on() && cityNow() && P && !(CBZ.cuffedPlayer && CBZ.cuffedPlayer.on()) ? CBZ.cityItemDrops : null;
      },
      reach: function () { return 2.6; },
      dot: function () { return 0.4; },
      verbs: [{ id: "ground-pickup", slot: "e", prio: 5, forceYes: true, label: "Pick up",
        canShow: (d) => !d._taking && Math.abs(CBZ.player.pos.y - d.y0) < 2.5, onSelect: takeItemDrop }],
    });
  }

  // ============================================================
  //  PER-FRAME — chest prompts, item drops, arena-change hygiene
  // ============================================================
  CBZ.onUpdate(37.4, function (dt) {
    if (!on() || !cityNow()) return;
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
    wireChests();
  });

  // fresh run / mode switch: same lazy reset-chain hook storage.js uses
  function teardownAll() {
    teardownChests();
    clearItemDrops();
    _chestRoot = null;
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

  // (The ICON CENSUS that lived here was a second CBZ.itemIconAudit that loaded
  // after city/itemicons.js's and replaced it, and it called an iconGlyph()
  // deleted with the empty glyph tables: every call threw. itemicons.js's is
  // the one census.)

  // ============================================================
  //  PUBLIC SURFACE
  // ============================================================
  CBZ.cityInventory = {
    enabled: on,
    placeChest, chestNear, chestPut, chestTake, chestTakeAll, chestRead,
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
  // where a duffel lies: Gang City's arena, or the island you are on
  function bagRoot() { return (g.mode !== "city" && CBZ.surv && CBZ.surv.arena && CBZ.surv.arena.root) || arenaRoot(); }
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
    const mk = CBZ.itemAssetBaked || (CBZ.itemAsset && function (k, n, r, o) { return CBZ.itemAsset(n, r, o); });
    if (mk) {
      try {
        m = mk(null, null, null, {
          kind: "moneybag",
          canvas: bag.dyed ? 0x7a2a26 : (bag.tone != null ? bag.tone : 0x2f3a2c),
          dyed: !!bag.dyed,
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
    const root = bagRoot() || CBZ.scene;
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

  // a hand still on its way to this bag lets go (the take never happens)
  function abortReach(bag) {
    const V = CBZ.verbs, pk = V && V.pickupOf ? V.pickupOf(CBZ.player) : null;
    if (pk && bag && pk.obj === bag.mesh && pk.abort) pk.abort();
  }
  function bagPickup(bag) {
    if (!bagsOn() || !bag || bag.carried) return false;
    if (_carried) { note("You've already got a bag on your shoulder, put it down first.", 1.8); return false; }
    const P = CBZ.player; if (!P || P.dead) return false;
    // A MAN CANNOT SHOULDER A RIFLE AND A DUFFEL. Lower the gun first — an
    // action you can take, never a wall (see the header's soft-lock note).
    if (CBZ.isAimingWeapon && CBZ.isAimingWeapon()) { note("Both hands. Lower the gun first.", 1.9); return false; }
    // The bag is claimed now (nobody else can take it, the hand is going for
    // it); it is TAKEN WITH A HAND (systems/verbs_pickup.js): the hand closes
    // on the handles and lifts it, the haul is yours on the grab frame, and it
    // goes up onto the shoulder when the lift ends.
    bag.carried = true; bag.held = true; bag.air = false;
    _carried = bag;
    const took = function () {
      BAG_TALLY.picked++;
      sfx("coin");
      note("Hauling " + fmtB(bag.amount) + ". You can't sprint or shoot with this.", 2.2);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    };
    const shoulder = function () {
      if (_carried !== bag || !bag.mesh) return;        // set down or spent before the lift ended
      if (bag.mesh.parent) bag.mesh.parent.remove(bag.mesh);
      bag.mesh.visible = true;
      if (!mountOnBody(bag)) {
        // no rig up (first person before the char exists): keep the record and
        // re-mount on the next tick rather than dropping the money on the floor.
        bag._needMount = true;
      }
      ensureHaulPose();
      if (CBZ.setCharPose && CBZ.playerChar) { try { CBZ.setCharPose(CBZ.playerChar, "haul"); _bagPose = true; } catch (e) {} }
    };
    if (CBZ.verbs && CBZ.verbs.pickup && bag.mesh) {
      CBZ.verbs.pickup(P, bag.mesh, { pose: "grip", keep: true, onTaken: took, onDone: shoulder });
    } else { shoulder(); took(); }
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
    abortReach(bag);
    _carried = null;
    bag.carried = false;
    if (bag.mesh && bag.mesh.parent) bag.mesh.parent.remove(bag.mesh);
    if (bag.mesh) bag.mesh.visible = true;              // a take still reaching for it hid it
    const root = bagRoot() || CBZ.scene;
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
    abortReach(bag);
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
    // (money is real on the islands too: a vault there drops duffels, CBZ.economyMode)
    if (!(CBZ.economyMode ? CBZ.economyMode(g.mode) : g.mode === "city")) { if (BAGS.length) bagsClear(); return; }
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
    /* HAND IT TO SOMETHING ELSE. Same release, no "Set down $X" note and no
       floor snap worth trusting — the caller is about to reposition it (into a
       truck bed, onto a shelf) and owns the sentence. This is the seam the
       load-into-the-van verb rides; without it that verb had to drop the bag
       on the tarmac first and then lie about it. */
    stow: function () { return bagRelease(false, true); },
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
