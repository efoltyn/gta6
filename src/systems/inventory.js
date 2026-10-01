/* ============================================================
   systems/inventory.js — THE HOTBAR. It is the whole inventory, in every
   game that carries things: the prison, Gang City, gun game, survival.

   OWNER (2026-09-28): "only guns are cool, and the keycard is cool af. All
   other inventory is dumb af, and when there are many guns it shows dumb
   with the other inventory. The button to open the inventory is dumb ...
   The flashlight is a cool thing in inventory because at night it helps.
   Its icon should be the flashlight, like how the guns are in inventory."
   OWNER (2026-09-30): "ADD THE INVENTORY OF JAIL GAME TO GANG CITY, IT'S
   DONE WELL."

   History: the prison's bar used to be a 36-slot Minecraft stash; the city
   had its own second bar (city/hud.js #cSlots over fpsmode.js's
   cityHotbar/cityHotbarSelect, its own digit handler, its own tap handler,
   a fade-out, a word strip behind a flag in charpanel). All of that is gone.
   This file is the one bar, the one picker and the one key handler.

   What it is:
     · ONE ROW of real renders, bottom centre: every gun you own (the same
       photograph city/itemicons.js takes of the mesh in your hands), the
       bat/knife on your belt, grenades and charges, the gauze, the
       flashlight, the phone, then the cards and door keys you carry. What
       may appear is decided by systems/hotbar_model.js, a pure allow-list
       the node check pins.
     · NO SCREEN. No [I], no bag button, no stash. Digits 1..9 pick the Nth
       usable cell; the mouse wheel cycles guns (fpsmode.js); a tap picks a
       cell; a sideways swipe along the bar steps to the next/previous gun.
       Picking the thing already in your hands puts it away.
     · POCKETS STILL EXIST, THEY'RE JUST NOT UI. CBZ.game.inventory (prison)
       and CBZ.game.cityInv (city) stay the count truth that trade, frisks,
       bribes, doors and dealers read. Food and painkillers are taken
       automatically when you need them (prison: autoConsume below; city:
       city/hunger.js), drugs are product, cash is the number that shows
       when it moves.

   API (CBZ.inventory):
     entries()          what the bar holds right now (model entries)
     select(i)          act on bar index i (draw, put away, raise, toggle)
     selectKind(kind)   act on the first cell of a kind ("phone", "flashlight")
     onUse(kind, fn)    replace what using a kind does. fn(entry) -> true if it
                        acted. The phone builder can claim the phone here; with
                        no hook the phone cell calls CBZ.phoneOpen when it
                        exists, else the campaign handset, else the city phone.
     onState(kind, fn)  fn() -> {active, unread, buzz} for the phone cell
     audit()            CBZ.hotbarAudit()
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const M = CBZ.hotbarModel;
  if (!M) return;

  /* ---------------- faces: a cell shows the THING ---------------- */
  // the gauze roll, drawn: the wound spiral on its end face, the woven body,
  // a loose tail of gauze off the side
  const BANDAGE_FACE =
    "<svg viewBox='0 0 40 40' aria-hidden='true' style='width:72%;height:72%'>" +
    "<path d='M24 22 q6 2 9 8 q1 3 -2 3 q-3 -4 -8 -6z' fill='#e9e4d6' stroke='#a39c8a' stroke-width='.8'/>" +
    "<path d='M9 13 h16 v14 h-16z' fill='#ece7da'/>" +
    "<path d='M11 15 v10 M14 15 v10 M17 15 v10 M20 15 v10 M23 15 v10' stroke='#d4cebf' stroke-width='.7'/>" +
    "<ellipse cx='25' cy='20' rx='4.2' ry='7' fill='#f4f0e6' stroke='#a39c8a' stroke-width='.9'/>" +
    "<path d='M25 17.5 a1.4 2.4 0 1 1 -.1 5 a2.6 4.3 0 1 0 .1 -8.6' fill='none' stroke='#b9b2a0' stroke-width='.8'/>" +
    "<ellipse cx='9' cy='20' rx='4.2' ry='7' fill='#dcd6c6' stroke='#a39c8a' stroke-width='.9'/>" +
    "<path d='M9 13 h16 M9 27 h16' stroke='#a39c8a' stroke-width='.9'/></svg>";
  function img(src) { return src ? "<img src='" + src + "' alt=''>" : ""; }
  function tryCall(fn, a, b) { try { return fn ? (fn(a, b) || "") : ""; } catch (e) { return ""; } }
  function itemRow(name) { const E = CBZ.cityEcon; return (E && E.ITEMS && E.ITEMS[name]) || {}; }
  // The one face resolver. Every branch is a real render of a real model; a
  // miss returns "" and the bar retries on its next repaint (the GL context /
  // model factory can land later in boot).
  CBZ.hotbarFace = function (e) {
    if (!e) return "";
    switch (e.kind) {
      case "gun":
        return img(tryCall(CBZ.itemIconGun, e.id) || tryCall(CBZ.weaponThumbnail, e.id));
      case "melee":
        return img(tryCall(CBZ.itemIcon, e.name, itemRow(e.name)));
      case "flashlight":
        return img(tryCall(CBZ.flashlightThumbnail));
      case "keycard":
        return img(tryCall(CBZ.itemIcon, e.name || "Keycard", {}));
      case "key":
        return img(tryCall(CBZ.itemIcon, e.name || "Key", {}));
      case "throwable":
        return img(tryCall(CBZ.itemIcon, e.name, itemRow(e.name)));
      case "detonator":
        return tryCall(CBZ.detonatorFaceHtml);
      case "phone":
        return img(tryCall(CBZ.itemIcon, "Phone", {}));
      case "bandage":
        return BANDAGE_FACE;
      default:
        return "";
    }
  };

  /* ---------------- hooks ---------------- */
  const useHooks = Object.create(null), stateHooks = Object.create(null);

  /* ---------------- state -> entries ---------------- */
  function g() { return CBZ.game || {}; }
  function mode() { return g().mode; }
  function city() { return mode() === "city"; }
  function weaponRow(id) {
    const T = CBZ.FPS_WEAPONS;
    if (!T) return -1;
    for (let i = 0; i < T.length; i++) { const w = T[i]; if (w && (w.id === id || w.key === id)) return i; }
    return -1;
  }
  function isDry(id) {
    const f = CBZ.fps, i = weaponRow(id);
    if (!f || !f.rounds || !f.reserves || i < 0) return false;
    const w = CBZ.FPS_WEAPONS[i];
    if (w && w.melee) return false;
    const cur = f.rounds[i] != null ? f.rounds[i] : (w && w.mag) || 0;
    const res = f.reserves[i] != null ? f.reserves[i] : (w && w.reserve) || 0;
    return cur + res <= 0;
  }
  // carry order: the prison keeps its loadout rail order (so a gun never
  // slides when another is picked up), everything else acquisition order.
  function gunOrder() {
    const inv = CBZ.weaponInventory || [];
    if (mode() !== "escape" || !CBZ.prisonWeaponLoadout) return inv.slice();
    const out = [];
    try {
      const rail = CBZ.prisonWeaponLoadout() || [];
      for (let i = 0; i < rail.length; i++) if (rail[i] && inv.indexOf(rail[i]) >= 0) out.push(rail[i]);
    } catch (e) {}
    for (let i = 0; i < inv.length; i++) if (out.indexOf(inv[i]) < 0) out.push(inv[i]);
    return out;
  }
  // no gun is in your hands: put away, or (city) the bat is
  function holstered() {
    const G = g();
    if (mode() === "escape") return !!G.prisonHolstered;
    if (city()) return !!(G.cityHolstered || G.cityMeleeWeapon);
    return false;
  }
  function flashlightState() {
    const F = CBZ.playerFlashlight;
    if (!F) return null;
    try { return { owned: !!F.owned(), on: !!F.on() }; } catch (e) { return null; }
  }
  // the belt weapon (city): in your hand (cityMeleeWeapon) or put away
  // (cityMeleeStowed). Buying a gun stows the bat instead of throwing it away.
  function meleeState() {
    if (!city()) return null;
    const G = g();
    const name = G.cityMeleeWeapon || G.cityMeleeStowed;
    return name ? { name: name, active: !!G.cityMeleeWeapon } : null;
  }
  // the charge / detonator / frag you carry
  function heldCells() {
    const HM = CBZ.heldItemModel, H = CBZ.heldItem;
    const held = H ? H.current() : null;
    if (city()) {
      // the city's pocket: every throwable in the catalog you hold, in
      // catalog order, then the detonator once a charge is out
      const inv = g().cityInv || {}, ITEMS = (CBZ.cityEcon && CBZ.cityEcon.ITEMS) || {};
      const out = [];
      for (const name in ITEMS) {
        const it = ITEMS[name];
        if (!it || it.tag !== "throwable" || !((inv[name] | 0) > 0)) continue;
        const hk = HM ? HM.heldKindOf(name, it) : null;
        out.push({ kind: "throwable", item: name, held: hk, count: inv[name] | 0, active: !!(hk && hk === held) });
      }
      const planted = CBZ.cityC4Planted ? CBZ.cityC4Planted() | 0 : 0;
      if (planted > 0) out.push({ kind: "detonator", item: "Detonator", held: "detonator", count: planted, active: held === "detonator" });
      return out;
    }
    if (!HM || !H) return [];
    const live = CBZ.modeHas ? CBZ.modeHas("blast") : false;
    if (!live) return [];
    return HM.cells({
      c4: CBZ.cityC4Count ? CBZ.cityC4Count() : 0,
      planted: CBZ.cityC4Planted ? CBZ.cityC4Planted() : 0,
      grenades: 0,
      held: held,
    });
  }
  // the gauze rolls you carry (systems/vitals.js owns the count)
  function bandageState() {
    const VT = CBZ.vitals, H = CBZ.heldItem;
    if (!VT || !VT.bandages) return null;
    let n = 0;
    try { n = VT.bandages() | 0; } catch (e) { n = 0; }
    return { count: n, active: !!(H && H.current() === "bandage") };
  }
  CBZ.hotbarBandage = bandageState;
  // the handset (city). Whoever owns a phone publishes its state; the cell
  // exists whenever some phone can be raised.
  function phoneState() {
    if (!city()) return null;
    if (stateHooks.phone) { try { const s = stateHooks.phone(); if (s) return s; } catch (e) {} }
    let chip = null;
    try { chip = typeof CBZ.campaignPhoneChip === "function" ? CBZ.campaignPhoneChip() : null; } catch (e) { chip = null; }
    let open = false;
    try { open = typeof CBZ.phoneIsOpen === "function" ? !!CBZ.phoneIsOpen() : false; } catch (e) { open = false; }
    if (!(chip && chip.available) && typeof CBZ.cityPhoneChip === "function") { try { chip = CBZ.cityPhoneChip(); } catch (e) { chip = null; } }
    if (chip && chip.available) return { active: open || !!chip.open, unread: !!chip.unread, buzz: !!chip.buzz };
    if (useHooks.phone || typeof CBZ.phoneOpen === "function" || typeof CBZ.cityOpenPhone === "function") return { active: open, unread: false, buzz: false };
    return null;
  }
  const CARD_RE = /keycard|key card|access card|swipe card|vault card|pass card/i;
  const KEY_RE = /(^|[^a-z])key([^a-z]|$)/i;
  function belt() {
    const G = g();
    if (mode() === "escape") {
      const inv = G.inventory || {};
      const keys = [];
      for (let i = 0; i < M.DOOR_KEYS.length; i++) if (inv[M.DOOR_KEYS[i]] > 0) keys.push(M.DOOR_KEYS[i]);
      // an officer carries the staff card from the first frame
      return { hasKeycard: !!(G.hasKey || inv["Keycard"] > 0 || (G.role === "cop" && !G.copKeysPulled)), cards: [], keys: keys };
    }
    if (city()) {
      // a city key is an ordinary item in g.cityInv (city/keys.js); the bar
      // shows the ones you carry, cards first
      const inv = G.cityInv || {}, cards = [], keys = [];
      for (const name in inv) {
        if (!((inv[name] | 0) > 0)) continue;
        if (CARD_RE.test(name)) cards.push(name);
        else if (KEY_RE.test(name) || itemRow(name).tag === "key") keys.push(name);
      }
      return { hasKeycard: false, cards: cards, keys: keys };
    }
    return { hasKeycard: false, cards: [], keys: [] };
  }
  function entries() {
    const b = belt();
    const list = M.build({
      mode: mode(),
      guns: gunOrder(),
      held: CBZ.currentWeaponId || null,
      holstered: holstered(),
      melee: meleeState(),
      items: heldCells(),
      bandage: bandageState(),
      flashlight: flashlightState(),
      phone: phoneState(),
      hasKeycard: b.hasKeycard, cards: b.cards, keys: b.keys,
    });
    for (let i = 0; i < list.length; i++) if (list[i].kind === "gun" && !list[i].active) list[i].dry = isDry(list[i].id);
    return list;
  }

  /* ---------------- DOM ---------------- */
  const bar = document.createElement("div");
  bar.id = "hotbar";
  document.body.appendChild(bar);
  let shown = [], sig = "", seen = Object.create(null), missingFace = false;

  function render(list) {
    let html = "", firstPassive = true, missing = false;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const face = CBZ.hotbarFace(e);
      if (!face) missing = true;
      const key = e.kind + ":" + (e.id || e.name || "");
      let cls = "hb " + e.kind;
      if (e.active) cls += " on";
      if (e.dry) cls += " dry";
      if (e.unread) cls += " unread";
      if (e.buzz) cls += " buzz";
      if (!e.selectable) { cls += " passive"; if (firstPassive) { cls += " first"; firstPassive = false; } }
      if (sig && !seen[key]) cls += " fresh";      // a pickup pops in; boot does not
      // a stack (grenades, charges, gauze) shows its count as pips, not a number
      let pips = "";
      const n = e.count | 0;
      if (n > 1 && e.kind !== "detonator") { pips = "<i class='pips'>"; for (let k = 0; k < Math.min(n, 5); k++) pips += "<b></b>"; pips += "</i>"; }
      html += "<div class='" + cls + "' data-i='" + i + "'>" + face + pips + "</div>";
    }
    seen = Object.create(null);
    for (let i = 0; i < list.length; i++) seen[list[i].kind + ":" + (list[i].id || list[i].name || "")] = 1;
    bar.style.setProperty("--hb-n", String(Math.max(1, list.length)));
    bar.innerHTML = html;
    shown = list;
    missingFace = missing;
  }

  // the games that carry things on this bar. Warlord/shark/others own their
  // digit keys and have nothing to carry here.
  const BAR_MODES = { escape: 1, city: 1, gungame: 1, survival: 1, teammatch: 1 };
  function barMode() { return !!BAR_MODES[mode()]; }
  function cuffed() { const C = CBZ.cuffedPlayer; try { return !!(C && C.on && C.on()); } catch (e) { return false; } }
  // a city panel, the map or the verb wheel owns the keys and the glass
  function blocked() {
    if (!city()) return false;
    return !!(CBZ.cityMenuOpen || (CBZ.fullMap && CBZ.fullMap.active) || (CBZ.verbWheel && CBZ.verbWheel.isOpen && CBZ.verbWheel.isOpen()));
  }
  function hudDirty() { if (CBZ.cityHudDirty) { try { CBZ.cityHudDirty(); } catch (e) {} } }

  /* ---------------- using a cell ---------------- */
  function stowMelee() {
    const G = g();
    if (!G.cityMeleeWeapon) return;
    G.cityMeleeStowed = G.cityMeleeWeapon;
    G.cityMeleeWeapon = null;
  }
  function useMelee(e) {
    const G = g();
    if (e.active) {
      // put the bat away; the gun stays where it was (holstered), hands empty
      G.cityHolstered = true;
      stowMelee();
    } else {
      if (CBZ.fpsArmed && CBZ.fpsArmed() && CBZ.cityHolster) CBZ.cityHolster(true);
      else G.cityHolstered = true;
      if (CBZ.heldItem && CBZ.heldItem.clear) CBZ.heldItem.clear();
      G.cityMeleeWeapon = G.cityMeleeStowed || e.name;
      G.cityMeleeStowed = null;
    }
    if (CBZ.sfx) CBZ.sfx("switch");
    hudDirty();
    return true;
  }
  function usePhone(e) {
    if (useHooks.phone) { try { return !!useHooks.phone(e); } catch (err) { return false; } }
    try {
      if (typeof CBZ.phoneOpen === "function") {
        if (e.active && typeof CBZ.phoneClose === "function") { CBZ.phoneClose(); return true; }
        CBZ.phoneOpen();
        return true;
      }
      const chip = typeof CBZ.campaignPhoneChip === "function" ? CBZ.campaignPhoneChip() : null;
      if (chip && chip.available && CBZ.campaignPhoneToggle) return !!CBZ.campaignPhoneToggle();
      if (typeof CBZ.cityOpenPhone === "function") { CBZ.cityOpenPhone(); return true; }
    } catch (err) {}
    return false;
  }
  function pick(e) {
    if (!e || !e.selectable || cuffed()) return false;
    if (useHooks[e.kind] && e.kind !== "phone") { try { return !!useHooks[e.kind](e); } catch (err) { return false; } }
    const m = mode();
    if (e.kind === "gun") {
      // the gun already in your hands, picked again, goes away (prison and
      // city have a holster; other modes simply keep it drawn)
      if (e.active) {
        if (m === "escape" && CBZ.playerHolster) { CBZ.playerHolster(true); return true; }
        if (m === "city" && CBZ.cityHolster) { CBZ.cityHolster(true); return true; }
      }
      if (m === "city") stowMelee();
      const okSel = !!(CBZ.fpsSelectWeaponId && CBZ.fpsSelectWeaponId(e.id));
      if (okSel && m === "city") hudDirty();
      return okSel;
    }
    if (e.kind === "melee") return m === "city" ? useMelee(e) : false;
    if (e.kind === "flashlight") {
      const F = CBZ.playerFlashlight;
      if (F && F.toggle) { F.toggle(); return true; }
      return false;
    }
    if (e.kind === "phone") return usePhone(e);
    if ((e.kind === "throwable" || e.kind === "detonator" || e.kind === "bandage") && CBZ.heldItem) {
      const held = e.kind === "bandage" ? "bandage" : e.held;
      if (held) {
        if (m === "city") stowMelee();
        return !!CBZ.heldItem.select(held);
      }
    }
    // a throwable with no held form still leaves on the pick (city)
    if (e.kind === "throwable" && m === "city" && CBZ.cityThrowFromInventory) { CBZ.cityThrowFromInventory(); return true; }
    return false;
  }
  function stepGun(dir) {
    const guns = shown.filter(function (e) { return e.kind === "gun"; });
    if (!guns.length) return;
    let cur = -1;
    for (let i = 0; i < guns.length; i++) if (guns[i].active) cur = i;
    const next = guns[(cur + dir + guns.length) % guns.length];
    if (next) pick(next.active ? null : next);
  }
  function refresh() { const list = entries(); render(list); sig = M.signature(list, mode()); return list; }

  bar.addEventListener("mousedown", function (ev) {
    const c = ev.target.closest && ev.target.closest(".hb");
    if (!c) return;
    ev.preventDefault(); ev.stopPropagation();
    if (blocked()) return;
    if (pick(shown[+c.dataset.i])) refresh();
  });
  // touch: a tap picks the cell, a sideways swipe along the bar steps guns.
  // (Compat mouse events after touchend are swallowed by preventDefault.)
  let sw = null;
  bar.addEventListener("touchstart", function (ev) {
    const t = ev.changedTouches && ev.changedTouches[0];
    if (t) sw = { x: t.clientX, y: t.clientY, el: ev.target.closest && ev.target.closest(".hb") };
  }, { passive: true });
  bar.addEventListener("touchend", function (ev) {
    const s = sw; sw = null;
    const t = ev.changedTouches && ev.changedTouches[0];
    if (!s || !t) return;
    ev.preventDefault();
    if (blocked()) return;
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy)) { stepGun(dx < 0 ? 1 : -1); refresh(); return; }
    if (s.el && pick(shown[+s.el.dataset.i])) refresh();
  }, { passive: false });

  addEventListener("keydown", function (ev) {
    if (ev.repeat || !barMode() || !CBZ.game || CBZ.game.state !== "playing") return;
    const t = ev.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const n = "123456789".indexOf(ev.key);
    if (n < 0 || blocked()) return;
    const e = M.selectableAt(entries(), n);
    // the roll's digit, held, is the use input held (systems/helditems.js)
    if (e && e.kind === "bandage" && CBZ.heldItem && CBZ.heldItem.keyHold) { if (CBZ.heldItem.keyHold("bandage", ev.code || ev.key)) ev.preventDefault(); return; }
    if (e && pick(e)) { ev.preventDefault(); refresh(); }
  });

  /* ---------------- pockets: automatic, not UI ----------------
     The prison's snacks and painkillers used to be cells you clicked. A man
     who is starving and has a ramen eats the ramen. (The city's own eating
     and patching up is city/hunger.js.) */
  const FOOD = ["Ramen", "Energy Bar", "Energy Drink"];
  let autoT = 0;
  function autoConsume(dt) {
    autoT -= dt;
    if (autoT > 0) return;
    autoT = 1.5;
    if (mode() !== "escape") return;
    const p = CBZ.player, E = CBZ.econ;
    if (!p || p.dead || !E || !E.hasItem || !E.takeItem) return;
    if (p.hunger != null && p.hunger < 30) {
      for (let i = 0; i < FOOD.length; i++) {
        if (E.hasItem(FOOD[i]) && E.takeItem(FOOD[i])) {
          if (CBZ.hunger && CBZ.hunger.onConsume) CBZ.hunger.onConsume(FOOD[i]);
          if (FOOD[i] === "Energy Drink") p.stamina = 100;
          if (CBZ.sfx) CBZ.sfx("coin");
          return;
        }
      }
    }
    if ((p.hp || 100) < 40 && E.hasItem("Painkillers") && E.takeItem("Painkillers")) {
      p.stun = 0;
      p.hp = Math.min(100, (p.hp || 100) + 35);
      if (CBZ.sfx) CBZ.sfx("coin");
    }
  }

  /* ---------------- the tick ---------------- */
  // the city hides the bar behind the wheel (the car's own cluster owns the
  // bottom of the glass; on touch the bar stays, it is the input) and under
  // the [Shift+O] clean-frame toggle
  function cityHidden() {
    if (!city()) return false;
    const P = CBZ.player;
    const touch = !!(CBZ.touchMode || (document.body && document.body.classList && document.body.classList.contains("touch")));
    if (P && P.driving && !touch) return true;
    const CP = CBZ.cityCharPanel;
    try { if (CP && CP.hudHidden && CP.hudHidden()) return true; } catch (e) {}
    return false;
  }
  let pollT = 0, retryT = 0;
  CBZ.onAlways(97, function (dt) {
    dt = dt || 0;
    const playing = CBZ.game && CBZ.game.state === "playing";
    if (!playing || !barMode() || cityHidden()) {
      if (bar.style.display !== "none") bar.style.display = "none";
      return;
    }
    autoConsume(dt);
    pollT -= dt;
    if (pollT > 0) return;
    pollT = 0.1;
    const list = entries();
    const s = M.signature(list, mode());
    // a face that could not be photographed yet (GL / model factory still
    // booting) is retried, but at 2 s, not every poll: a failed offscreen
    // renderer boot is not free.
    retryT -= 0.1;
    if (s !== sig || (missingFace && retryT <= 0)) { render(list); sig = s; retryT = 2; }
    const want = list.length ? "flex" : "none";
    if (bar.style.display !== want) bar.style.display = want;
  });

  // Callers that still poke the old seams get harmless answers.
  CBZ.invOpen = false;
  if (!CBZ.refreshInventory) CBZ.refreshInventory = function () {};

  /* RATCHET: CBZ.hotbarAudit() — what the bar is drawing, as numbers.
     allowed must be true forever; guns must equal the weapons you own;
     bars must be 1 (no second inventory surface anywhere on the page). */
  CBZ.hotbarAudit = function () {
    const list = entries();
    const kinds = {};
    for (let i = 0; i < list.length; i++) kinds[list[i].kind] = (kinds[list[i].kind] || 0) + 1;
    return {
      mode: mode(), cells: list.length, allowed: M.allowed(list), kinds: kinds,
      guns: kinds.gun || 0, owned: (CBZ.weaponInventory || []).length,
      shown: bar.style.display !== "none", screen: false,
      bars: typeof document.querySelectorAll === "function" ? document.querySelectorAll("#hotbar, #cSlots, #invHotbar").length : 1,
    };
  };

  CBZ.inventory = {
    entries: entries,
    select: function (i) { const list = entries(); const ok = pick(list[i]); if (ok) refresh(); return ok; },
    selectKind: function (kind) {
      const list = entries();
      for (let i = 0; i < list.length; i++) if (list[i].kind === kind) { const ok = pick(list[i]); if (ok) refresh(); return ok; }
      return false;
    },
    onUse: function (kind, fn) { if (typeof fn === "function") useHooks[kind] = fn; else delete useHooks[kind]; },
    onState: function (kind, fn) { if (typeof fn === "function") stateHooks[kind] = fn; else delete stateHooks[kind]; },
    audit: CBZ.hotbarAudit,
  };
})();
