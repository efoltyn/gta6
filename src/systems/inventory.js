/* ============================================================
   systems/inventory.js — THE HOTBAR. It is the whole inventory.

   OWNER (2026-09-28): "only guns are cool, and the keycard is cool af. All
   other inventory is dumb af, and when there are many guns it shows dumb
   with the other inventory. The button to open the inventory is dumb ...
   The flashlight is a cool thing in inventory because at night it helps.
   Its icon should be the flashlight, like how the guns are in inventory."

   What this file used to be: a 36-slot Minecraft stash (27-slot grid on [I]
   plus a 9-slot hotbar), a drag-to-rearrange weapon-key screen, 40 hand-drawn
   SVG pictograms for ramen and soap and gold teeth, and a docking trick that
   reparented fpsmode's #weaponStrip into the bar. All deleted.

   What it is now:
     · ONE ROW of real renders, bottom centre: every gun you own (the same
       photograph city/itemicons.js takes of the mesh in your hands), then the
       flashlight when you carry one, then the keycard and any door key on
       your belt. What may appear is decided by systems/hotbar_model.js, a
       pure allow-list the node check pins.
     · NO SCREEN. There is no [I], no bag button, no stash. Digits 1..9 pick
       the Nth usable cell; the wheel cycles guns (fpsmode.js); a tap picks a
       cell; a sideways swipe along the bar steps to the next/previous gun.
       Picking the gun already in your hands puts it away (prison).
     · POCKETS STILL EXIST, THEY'RE JUST NOT UI. CBZ.game.inventory remains
       the count truth that trade, frisks, bribes and the escape plan read.
       Food and painkillers are taken automatically when you need them
       (autoConsume below); trade goods are traded in the world; the shiv is
       already in your punch (systems/prisonshanks.js).

   The city draws its own bar (city/hud.js #cSlots over CBZ.cityHotbar) with
   the same faces via CBZ.hotbarFace, so a gun looks identical in every game.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const M = CBZ.hotbarModel;
  if (!M) return;

  /* ---------------- faces: a cell shows the THING ---------------- */
  function img(src) { return src ? "<img src='" + src + "' alt=''>" : ""; }
  function tryCall(fn, a, b) { try { return fn ? (fn(a, b) || "") : ""; } catch (e) { return ""; } }
  // The one face resolver, shared with city/hud.js. Every branch is a real
  // render of a real model; a miss returns "" and the caller retries on its
  // next repaint (the GL context / model factory can land later in boot).
  CBZ.hotbarFace = function (e) {
    if (!e) return "";
    switch (e.kind) {
      case "gun":
        return img(tryCall(CBZ.itemIconGun, e.id) || tryCall(CBZ.weaponThumbnail, e.id));
      case "flashlight":
        return img(tryCall(CBZ.flashlightThumbnail));
      case "keycard":
        return img(tryCall(CBZ.itemIcon, "Keycard", {}));
      case "key":
        return img(tryCall(CBZ.itemIcon, e.name || "Key", {}));
      case "throwable":
        return (CBZ.itemIconHtml && tryCall(CBZ.itemIconHtml, e.name)) || img(tryCall(CBZ.itemIcon, e.name));
      case "detonator":
        return tryCall(CBZ.detonatorFaceHtml);
      case "phone":
        return img(tryCall(CBZ.itemIcon, "Phone", {}));
      default:
        return "";
    }
  };

  /* ---------------- state -> entries ---------------- */
  function mode() { return CBZ.game && CBZ.game.mode; }
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
  function holstered() {
    const g = CBZ.game || {};
    return mode() === "escape" ? !!g.prisonHolstered : false;
  }
  function flashlightState() {
    const F = CBZ.playerFlashlight;
    if (!F) return null;
    try { return { owned: !!F.owned(), on: !!F.on() }; } catch (e) { return null; }
  }
  // the charge / detonator you carry (the pen's armory cage has them)
  function heldCells() {
    const HM = CBZ.heldItemModel, H = CBZ.heldItem;
    if (!HM || !H) return [];
    const live = CBZ.modeHas ? CBZ.modeHas("blast") : mode() === "city";
    if (!live) return [];
    return HM.cells({
      c4: CBZ.cityC4Count ? CBZ.cityC4Count() : 0,
      planted: CBZ.cityC4Planted ? CBZ.cityC4Planted() : 0,
      grenades: 0,
      held: H.current(),
    });
  }
  function entries() {
    const g = CBZ.game || {};
    const inv = g.inventory || {};
    const keys = [];
    for (let i = 0; i < M.DOOR_KEYS.length; i++) if (inv[M.DOOR_KEYS[i]] > 0) keys.push(M.DOOR_KEYS[i]);
    const list = M.build({
      mode: mode(),
      guns: gunOrder(),
      held: CBZ.currentWeaponId || null,
      holstered: holstered(),
      // an officer carries the staff card from the first frame
      hasKeycard: !!(g.hasKey || inv["Keycard"] > 0 || (mode() === "escape" && g.role === "cop" && !g.copKeysPulled)),
      keys: keys,
      flashlight: flashlightState(),
      items: heldCells(),
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
      if (!e.selectable) { cls += " passive"; if (firstPassive) { cls += " first"; firstPassive = false; } }
      if (sig && !seen[key]) cls += " fresh";      // a pickup pops in; boot does not
      html += "<div class='" + cls + "' data-i='" + i + "'>" + face + "</div>";
    }
    seen = Object.create(null);
    for (let i = 0; i < list.length; i++) seen[list[i].kind + ":" + (list[i].id || list[i].name || "")] = 1;
    bar.style.setProperty("--hb-n", String(Math.max(1, list.length)));
    bar.innerHTML = html;
    shown = list;
    missingFace = missing;
  }

  // the games that carry guns on this bar. The city draws its own (#cSlots);
  // warlord/shark/others own their digit keys and have nothing to carry here.
  const BAR_MODES = { escape: 1, gungame: 1, survival: 1, teammatch: 1 };
  function barMode() { return !!BAR_MODES[mode()]; }

  /* ---------------- selecting ---------------- */
  function pick(e) {
    if (!e || !e.selectable) return false;
    if (e.kind === "gun") {
      // the gun already in your hands, picked again, goes away (prison has a
      // holster; other modes simply keep it drawn)
      if (e.active && mode() === "escape" && CBZ.playerHolster) { CBZ.playerHolster(true); return true; }
      return !!(CBZ.fpsSelectWeaponId && CBZ.fpsSelectWeaponId(e.id));
    }
    if (e.kind === "flashlight") {
      const F = CBZ.playerFlashlight;
      if (F && F.toggle) { F.toggle(); return true; }
    }
    if ((e.kind === "throwable" || e.kind === "detonator") && e.held && CBZ.heldItem) return !!CBZ.heldItem.select(e.held);
    return false;
  }
  function stepGun(dir) {
    const guns = shown.filter(function (e) { return e.kind === "gun"; });
    if (!guns.length) return;
    let cur = -1;
    for (let i = 0; i < guns.length; i++) if (guns[i].active) cur = i;
    const next = guns[(cur + dir + guns.length) % guns.length];
    if (next && CBZ.fpsSelectWeaponId) CBZ.fpsSelectWeaponId(next.id);
  }

  bar.addEventListener("mousedown", function (ev) {
    const c = ev.target.closest && ev.target.closest(".hb");
    if (!c) return;
    ev.preventDefault(); ev.stopPropagation();
    pick(shown[+c.dataset.i]);
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
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy)) { stepGun(dx < 0 ? 1 : -1); return; }
    if (s.el) pick(shown[+s.el.dataset.i]);
  }, { passive: false });

  addEventListener("keydown", function (ev) {
    if (ev.repeat || !barMode() || !CBZ.game || CBZ.game.state !== "playing") return;
    const t = ev.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    const n = "123456789".indexOf(ev.key);
    if (n < 0) return;
    const e = M.selectableAt(shown, n);
    if (e && pick(e)) ev.preventDefault();
  });

  /* ---------------- pockets: automatic, not UI ----------------
     The prison's snacks and painkillers used to be cells you clicked. A man
     who is starving and has a ramen eats the ramen. */
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
  let pollT = 0, retryT = 0;
  CBZ.onAlways(97, function (dt) {
    dt = dt || 0;
    const playing = CBZ.game && CBZ.game.state === "playing";
    if (!playing || !barMode()) {
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
     allowed must be true forever; guns must equal the weapons you own. */
  CBZ.hotbarAudit = function () {
    const list = entries();
    const kinds = {};
    for (let i = 0; i < list.length; i++) kinds[list[i].kind] = (kinds[list[i].kind] || 0) + 1;
    return {
      mode: mode(), cells: list.length, allowed: M.allowed(list), kinds: kinds,
      guns: kinds.gun || 0, owned: (CBZ.weaponInventory || []).length,
      shown: bar.style.display !== "none", screen: false,
    };
  };
})();
