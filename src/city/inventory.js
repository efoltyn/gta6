/* ============================================================
   city/inventory.js — INVENTORY V2: the Minecraft-like city inventory.

   WHAT THIS IS (owner's order): guns live in your inventory like items,
   the inventory is a real slot GRID you can rearrange ([I], hosted by
   charpanel's overlay — this module renders the interactive grid into
   it), anything can be DROPPED on the ground as a pickup, any armed
   death drops the guns (the existing NPC/cop drops stay; this module
   adds the PLAYER's death drop by wrapping CBZ.cityKillPlayer), and
   CHESTS can be placed in the world to stash excess loot. Crafting is
   killed separately (systems/craft.js behind CBZ.CONFIG.CRAFTING_ENABLED).

   DESIGN: a slot-grid VIEW over the two existing truth stores — never a
   third store. g.cityInv ({name:count}, CBZ.cityEcon add/take/count) is
   the count truth for items; CBZ.weaponInventory (engine id strings) +
   g.cityMeleeWeapon are the truth for weapons. Rearranging slots never
   touches truth; truth only moves on the three real operations:
     • drop to ground  → CBZ.cityDropItem world pickup (bobbing box)
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
    if (IT && !IT.Chest) IT.Chest = { value: CHEST_COST, tag: "tool" };
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

  const ICON = {
    // weapons / tools
    Pistol: "🔫", Revolver: "🔫", "Desert Eagle": "🔫", SMG: "🔫", Uzi: "🔫",
    Shotgun: "🔫", Rifle: "🔫", "AK-47": "🔫", LMG: "🔫", Sniper: "🔫",
    Bazooka: "🚀", "Rocket Launcher": "🚀", Taser: "⚡", Bat: "🏏", Knife: "🔪",
    Grenade: "🧨", "Ammo Box": "📦", Medkit: "🩹", "Body Armor": "🦺",
    Lockpick: "🪛", Crowbar: "🔧", "Burner Phone": "📱", Chest: "🧰",
    Wood: "🪵", Stone: "🪨", Scrap: "⚙️", Hatchet: "🪓", Pickaxe: "⛏️",
    // food / drugs
    Burger: "🍔", Hotdog: "🌭", "Pizza Slice": "🍕", Soda: "🥤", Fries: "🍟",
    "Energy Drink": "🥤", Weed: "🌿", Coke: "❄️", Meth: "🧪", Pills: "💊",
    // valuables
    Wallet: "👛", Phone: "📱", Laptop: "💻", "Cash Stack": "💵", "Gold Bar": "🥇",
    "Briefcase of Cash": "💼",
  };
  const TAG_ICON = { weapon: "🔫", food: "🍔", drug: "💊", wearable: "💎", valuable: "💰", throwable: "🧨", tool: "🧰", ammo: "📦", resource: "📦" };
  function iconFor(name) { return ICON[name] || TAG_ICON[itemTag(name)] || "▪"; }

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
      if (g.cityMeleeWeapon && g.cityMeleeWeapon !== entry.name) { note("Hands full — stash your " + g.cityMeleeWeapon + " first.", 1.8); return false; }
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
  //  payload: { name, count } | { weaponId, ammo } | { melee } (+ y?, ttl?)
  //  Kept SEPARATE from peds.js's CBZ.cityDrops so its weapon-only pickup
  //  loop never mishandles an item record. Shared geometry, pooled cmat.
  // ============================================================
  CBZ.cityItemDrops = CBZ.cityItemDrops || [];
  const DROP_GEO = new THREE.BoxGeometry(0.55, 0.55, 0.55);
  const cmat = CBZ.cmat || CBZ.mat || function (c) { return new THREE.MeshLambertMaterial({ color: c }); };
  function dropMat(payload) {
    if (payload.weaponId || payload.melee) return cmat(0x23262d, { emissive: 0x39ff66, ei: 0.55 });
    return cmat(0x2a2438, { emissive: 0xffd166, ei: 0.55 });
  }

  // ---- UNMISSABLE-DROP kit: a glow shell hugging the cube + a tall additive
  //      light column, pulsing (the modshop.js/playeraircraft.js additive-
  //      basic-material pattern — our OWN materials, never a pooled cmat, so
  //      the per-frame opacity pulse can't bleed into anyone else's mesh).
  //      GREEN column = weapon, GOLD column = item — readable from a firefight
  //      away. Shared geometry + 4 shared materials across ALL drops.
  const SHELL_GEO = new THREE.BoxGeometry(0.78, 0.78, 0.78);
  const BEAM_CORE_GEO = new THREE.BoxGeometry(0.22, 5.4, 0.22);
  const BEAM_HALO_GEO = new THREE.BoxGeometry(0.52, 5.4, 0.52);
  function beaconMat(color, opacity, additive) {
    return new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
    });
  }
  // the beacon is a Minecraft-style light column: a near-SOLID saturated CORE
  // (normal blending — additive alone disappears against bright daylight)
  // wrapped in an ADDITIVE halo, plus an additive shell hugging the cube.
  const MAT_CORE_W = beaconMat(0x17e04e, 0.95), MAT_CORE_I = beaconMat(0xffb81f, 0.95);
  const MAT_HALO_W = beaconMat(0x39ff66, 0.35, true), MAT_HALO_I = beaconMat(0xffd166, 0.35, true);
  const MAT_SHELL_W = beaconMat(0x39ff66, 0.3, true), MAT_SHELL_I = beaconMat(0xffd166, 0.3, true);
  // attach the glow kit to a drop mesh (children ride its bob/spin). scaleComp
  // un-scales the kit when the parent mesh itself is scaled (NPC gun planks).
  function attachBeacon(mesh, isWeapon, scaleComp) {
    if (!mesh || mesh._inv2Beacon) return;
    mesh._inv2Beacon = true;
    const k = scaleComp || 1;
    const shell = new THREE.Mesh(SHELL_GEO, isWeapon ? MAT_SHELL_W : MAT_SHELL_I);
    shell.scale.setScalar(k);
    const core = new THREE.Mesh(BEAM_CORE_GEO, isWeapon ? MAT_CORE_W : MAT_CORE_I);
    core.scale.setScalar(k);
    core.position.y = 2.7 * k;
    const halo = new THREE.Mesh(BEAM_HALO_GEO, isWeapon ? MAT_HALO_W : MAT_HALO_I);
    halo.scale.setScalar(k);
    halo.position.y = 2.7 * k;
    mesh.add(shell); mesh.add(core); mesh.add(halo);
  }
  // one global pulse — every drop breathes together (6 material writes/frame)
  function pulseBeacons() {
    const s = Math.sin((CBZ.now || 0) * 3.2);
    MAT_CORE_W.opacity = 0.88 + 0.1 * s; MAT_CORE_I.opacity = 0.88 + 0.1 * s;
    MAT_HALO_W.opacity = 0.26 + 0.16 * s; MAT_HALO_I.opacity = 0.26 + 0.16 * s;
    MAT_SHELL_W.opacity = 0.24 + 0.14 * s; MAT_SHELL_I.opacity = 0.24 + 0.14 * s;
  }

  CBZ.cityDropItem = function (x, z, payload) {
    payload = payload || {};
    let mesh = null;
    const root = arenaRoot();
    const y0 = (payload.y != null ? payload.y : floorY(x, z)) + 0.5;
    const isWeapon = !!(payload.weaponId || payload.melee);
    if (root) {
      mesh = new THREE.Mesh(DROP_GEO, dropMat(payload));
      mesh.position.set(x, y0, z);
      mesh.rotation.y = (x * 7 + z * 13) % 6.28;   // deterministic-ish cosmetic spin seed
      mesh.userData.transient = true;
      attachBeacon(mesh, isWeapon);
      root.add(mesh);
    }
    CBZ.cityItemDrops.push({
      x, z, y0, t: 0, ttl: payload.ttl != null ? payload.ttl : 120, mesh,
      name: payload.name || null, count: payload.count || 1,
      weaponId: payload.weaponId || null, ammo: payload.ammo != null ? payload.ammo : 30,
      melee: payload.melee || null,
    });
  };

  // ---- NPC gun drops (peds.js CBZ.cityDrops) get the SAME beacon: wrap
  //      CBZ.cityDropWeapon (peds.js untouched). Their pickup path removes
  //      the whole mesh subtree, so the kit leaves with the drop; my tick
  //      bobs/spins their (otherwise static) plank too.
  function installDropWeaponWrap() {
    if (typeof CBZ.cityDropWeapon !== "function" || CBZ.cityDropWeapon._inv2BeaconWrap) return;
    const orig = CBZ.cityDropWeapon;
    const wrapped = function (x, z, weapon, ammo) {
      const r = orig.apply(this, arguments);
      try {
        if (on()) {
          const arr = CBZ.cityDrops;
          const d = arr && arr[arr.length - 1];
          if (d && d.mesh && !d.mesh._inv2Beacon && d.x === x && d.z === z) {
            d.mesh.scale.setScalar(1.5);              // the 0.7u plank reads at distance now
            attachBeacon(d.mesh, true, 1 / 1.5);
            d._inv2Y0 = d.mesh.position.y;
          }
        }
      } catch (e) {}
      return r;
    };
    for (const k in orig) if (Object.prototype.hasOwnProperty.call(orig, k)) wrapped[k] = orig[k];
    wrapped._inv2BeaconWrap = true;
    CBZ.cityDropWeapon = wrapped;
  }
  function removeItemDrop(i) {
    const d = CBZ.cityItemDrops[i];
    if (d && d.mesh && d.mesh.parent) d.mesh.parent.remove(d.mesh);   // pooled mat + shared geo: never dispose
    CBZ.cityItemDrops.splice(i, 1);
  }
  function pickupItemDrop(d) {
    const E = econ();
    if (d.weaponId) {
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
    pulseBeacons();
    // beacon-ize + bob/spin EVERY NPC gun drop. LAZY SWEEP, not just the
    // cityDropWeapon wrap: cityKillPed calls peds.js's INTERNAL dropWeapon()
    // directly (the global alias never runs), so records can land in
    // CBZ.cityDrops without passing any wrappable function — this sweep
    // catches them all within a frame. Idempotent via mesh._inv2Beacon.
    const npcDrops = CBZ.cityDrops;
    if (npcDrops && npcDrops.length) {
      for (let i = 0; i < npcDrops.length; i++) {
        const d = npcDrops[i];
        if (!d.mesh) continue;
        if (!d.mesh._inv2Beacon && on()) {
          d.mesh.scale.setScalar(1.5);
          attachBeacon(d.mesh, true, 1 / 1.5);
          d._inv2Y0 = d.mesh.position.y;
        }
        if (!d.mesh._inv2Beacon) continue;
        d.mesh.position.y = (d._inv2Y0 != null ? d._inv2Y0 : 0.25) + 0.18 + Math.sin((d.t || 0) * 2.6) * 0.16;
        d.mesh.rotation.y += dt * 2.0;
      }
    }
    const drops = CBZ.cityItemDrops;
    if (!drops.length) return;
    const P = CBZ.player;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.t += dt;
      if (d.mesh) { d.mesh.position.y = d.y0 + 0.1 + Math.sin(d.t * 2.6) * 0.16; d.mesh.rotation.y += dt * 2.0; }
      if (P && !P.dead && !P.driving && Math.abs(P.pos.y - (d.y0 - 0.5)) < 2.5 &&
          Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < 1.5) {
        pickupItemDrop(d);
        removeItemDrop(i);
        continue;
      }
      if (d.t > d.ttl) removeItemDrop(i);
    }
  }
  function clearItemDrops() { for (let i = CBZ.cityItemDrops.length - 1; i >= 0; i--) removeItemDrop(i); }

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
    sfx("clank");
    return true;
  }

  // ============================================================
  //  PLAYER DEATH DROP — wrap CBZ.cityKillPlayer: the guns leave the body
  //  as REAL pickups (Minecraft rule: go back for your gear). Items stay.
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
          if (ids.length || g.cityMeleeWeapon) note("💀 Your weapons hit the pavement — go back for them.", 3);
          // strip truth so a hospital respawn (or cityRedrawWeapon) can't dupe
          if (CBZ.weaponInventory) CBZ.weaponInventory.length = 0;
          CBZ.currentWeaponId = null;
          g.cityMeleeWeapon = null;
          g._copStow = null; g.cityStowedWeapon = null;
          if (CBZ.cityHudDirty) CBZ.cityHudDirty();
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

  function buildChestMesh(x, z) {
    const root = arenaRoot(); if (!root) return null;
    const grp = new THREE.Group();
    const y = floorY(x, z);
    grp.position.set(x, y, z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.8), cmat(0x6b4a2a, { emissive: 0x241505, ei: 0.15 }));
    body.position.y = 0.3; grp.add(body);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.2, 0.84), cmat(0x4a3320, { emissive: 0x1a0f04, ei: 0.15 }));
    lid.position.y = 0.7; grp.add(lid);
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.06), cmat(0xc9a44a, { emissive: 0x6b4f12, ei: 0.4 }));
    latch.position.set(0, 0.58, 0.44); grp.add(latch);
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
      if ((g.cash || 0) < CHEST_COST) { note("⛔ A chest costs $" + CHEST_COST + ".", 2); sfx("hit"); return false; }
      g.cash -= CHEST_COST; paid = true;
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    } else { note("You don't own a chest.", 1.6); return false; }
    const h = P.heading || 0;
    const x = P.pos.x + Math.sin(h) * 1.6, z = P.pos.z + Math.cos(h) * 1.6;
    if (spotBlocked(x, z)) {
      note("No room here — face an open spot.", 1.8);
      if (paid) { g.cash += CHEST_COST; } else { E.add("Chest", 1); }
      return false;
    }
    const c = { id: "c" + Date.now().toString(36) + ((Math.random() * 1e4) | 0), x, z, slots: new Array(CHEST_N).fill(null), mesh: buildChestMesh(x, z) };
    chests.push(c);
    note("🧰 Chest placed — walk up and press [E] to open it.", 2.4);
    sfx("door");
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
    note("🧰 Chest packed up.", 1.6);
    sfx("clank");
    persistChests(); commit();
    return true;
  }

  // ============================================================
  //  CSS (self-mounted once) — matches the charpanel / hud.mc look
  // ============================================================
  function ensureCss() {
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
      "#invHotbar .ci2Slot.sel{box-shadow:0 0 0 2px rgba(232,236,242,.85),inset 2px 2px 0 rgba(0,0,0,.35);transform:scale(1.08)}";
    document.head.appendChild(st);
  }

  // ============================================================
  //  RENDER — player grid (into charpanel's .cpGrid) + chest grids
  // ============================================================
  let attachedGridEl = null;         // charpanel's .cpGrid, once attached
  let cursorEl = null;
  let chestPanel = null, chestGridEl = null, chestPlayerGridEl = null;

  function cellHtml(e, gridKey, i) {
    let inner = "";
    if (e) {
      const equipped = isGun(e) ? (CBZ.currentWeaponId === e.id && !g.cityHolstered) : (isMelee(e) && g.cityMeleeWeapon === e.name);
      inner = "<span class='ic'>" + iconFor(e.name) + "</span>" +
        (e.kind === "item" && e.count > 1 ? "<span class='ct'>" + e.count + "</span>" : "") +
        (equipped ? "<span class='eq'>EQ</span>" : "");
      return "<div class='ci2Slot" + (equipped ? " equipped" : "") + "' data-g='" + gridKey + "' data-i='" + i + "' title='" +
        String(e.name).replace(/'/g, "&#39;") + (e.kind === "weapon" ? " — right-click to equip" : "") + "'>" + inner + "</div>";
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
      const E = econ();
      const owned = E ? E.count("Chest") : 0;
      html += "<div class='ci2Foot'>" +
        (owned > 0
          ? "<button type='button' class='ci2Btn' data-act='place'>🧰 Place Chest (" + owned + " owned)</button>"
          : "<button type='button' class='ci2Btn' data-act='buy'>🧰 Buy &amp; Place Chest — $" + CHEST_COST + "</button>") +
        "</div>" +
        "<div class='ci2Hint'>Click: move stack · Right-click: half / place one · Weapons: right-click equips · Shift-click: quick-move · Click backdrop with an item held: drop it</div>";
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
      cursorEl.innerHTML = iconFor(cursor.name) + (cursor.kind === "item" && cursor.count > 1 ? "<span class='ct'>" + cursor.count + "</span>" : "");
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
      if (btn.dataset.act === "place") placeChest({});
      else if (btn.dataset.act === "buy") placeChest({ buy: true });
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
      "<div class='ttl'>🧰 Chest</div><div class='ci2Grid' data-grid='c'></div>" +
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
    chip.style.display = "block"; chip.textContent = t;
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
    for (let i = 0; i < bar.length; i++) { const b = bar[i]; sig += (b.short || b.label) + ":" + (b.count | 0) + ":" + (b.active ? 1 : 0) + "|"; }
    if (sig === _hotSig && hotbarEl.style.display === "flex") return;
    _hotSig = sig;
    let html = "";
    for (let i = 0; i < bar.length && i < 9; i++) {
      const b = bar[i];
      const face = b.kind === "item" ? "<span class='ic'>" + iconFor(b.item || b.label) + "</span>"
        : "<span class='s'>" + String(b.short || b.label || "?").slice(0, 6) + "</span>";
      html += "<div class='ci2Slot" + (b.active ? " sel" : "") + "' data-i='" + i + "'>" + face +
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
      _chestRoot = root;
    }
    if (root) hydrateChests();
    installDeathWrap();          // death.js defines cityKillPlayer before us, but stay lazy-safe
    installDropWeaponWrap();     // peds.js defines cityDropWeapon before us, ditto

    tickItemDrops(dt);

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
        chipText(c ? (chestEmpty(c) ? "[E] Open chest (empty)" : "[E] Open chest") : null);
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
  registerChestItem();

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
})();
