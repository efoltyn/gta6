/* ============================================================
   systems/inventory.js — a Minecraft-style inventory.

   • An always-visible HOTBAR (9 slots) at the bottom; number keys 1-9
     select (when you're not mid-conversation), and tapping/clicking a
     slot quick-USES a consumable.
   • Press [E] to open the full STASH: a 27-slot grid above the hotbar.
     Left-click picks up a stack onto the cursor, click again to place/
     swap/merge (classic Minecraft). Right-click USES a consumable.
   • Items mirror the economy inventory (CBZ.game.inventory is the count
     truth); slots are a re-orderable view that re-syncs whenever items
     are gained or used. New pickups land on the hotbar first.

   Consumables do something: Ramen / Energy Bar shake off stuns and cut
   heat, hooch/pills/powder cool you down. Gun / Shiv / keys just sit in
   the bag (the gun is "held" automatically by first-person mode).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;

  const N_MAIN = 27, N_HOT = 9, N = N_MAIN + N_HOT; // 0..26 main, 27..35 hotbar
  const STACK = 64;
  const ICON = {
    "Lighter": "🔥", "Soap": "🧼", "Shiv": "🔪", "Energy Bar": "🍫",
    "Burner Phone": "📱", "Ramen": "🍜", "Gun-Room Key": "🗝️", "Gun": "🔫",
    "Pills": "💊", "Powder": "❄️", "Pruno Hooch": "🍺",
    "Razor Blade": "🪒", "Phone Charger": "🔌", "Brass Knuckles": "🥊",
    "Energy Drink": "🥤", "Burner SIM": "📇", "Tattoo Gun": "🖊️",
    "Cigarette Carton": "📦", "Painkillers": "💉", "Lockpick": "🪛",
    "Handcuff Key": "🔑", "Bedsheet Rope": "🪢", "Hacksaw Blade": "🪚",
    "Contraband Map": "🗺️", "Stolen Wallet": "👛", "Cash Roll": "💵",
    "Gold Tooth": "🦷", "Gold Chain": "📿", "Luxury Watch": "⌚",
  };
  // items you can FENCE for their cigarette value straight from the bag
  const FENCEABLE = new Set(["Cash Roll", "Cigarette Carton", "Stolen Wallet", "Gold Tooth", "Gold Chain", "Luxury Watch"]);
  const CONSUMABLE = new Set([
    "Energy Bar", "Ramen", "Pruno Hooch", "Pills", "Powder",
    "Painkillers", "Energy Drink", "Cash Roll", "Cigarette Carton",
    "Stolen Wallet", "Gold Tooth", "Gold Chain", "Luxury Watch",
  ]);

  const slots = [];
  for (let i = 0; i < N; i++) slots.push({ item: null, count: 0 });
  let cursor = null;          // {item,count} held by the pointer
  let selIdx = 0;             // selected hotbar slot 0..8
  let invOpen = false;
  let ptr = { x: innerWidth / 2, y: innerHeight - 120 };

  // ---------- DOM ----------
  const bar = document.createElement("div"); bar.id = "hotbar";
  const screen = document.createElement("div"); screen.id = "invScreen";
  const cursorEl = document.createElement("div"); cursorEl.id = "invCursor";
  const barCells = [], mainCells = [], hbCells = [];

  function mkCell(arr, idx) {
    const c = document.createElement("div"); c.className = "islot"; c.dataset.slot = idx;
    arr.push(c); return c;
  }
  // always-visible hotbar mirrors slots 27..35
  for (let i = 0; i < N_HOT; i++) bar.appendChild(mkCell(barCells, N_MAIN + i));

  // full stash overlay
  const panel = document.createElement("div"); panel.className = "card-box invPanel";
  panel.innerHTML = '<div class="invTitle">STASH</div>';
  const grid = document.createElement("div"); grid.className = "invGrid";
  for (let i = 0; i < N_MAIN; i++) grid.appendChild(mkCell(mainCells, i));
  const hbRow = document.createElement("div"); hbRow.className = "invGrid invHot";
  for (let i = 0; i < N_HOT; i++) hbRow.appendChild(mkCell(hbCells, N_MAIN + i));
  const hint = document.createElement("div"); hint.className = "invHint";
  hint.textContent = "Left-click move · Right-click use/fence · B or Esc to close";
  panel.appendChild(grid); panel.appendChild(hbRow); panel.appendChild(hint);
  screen.appendChild(panel);

  document.body.appendChild(bar);
  document.body.appendChild(screen);
  document.body.appendChild(cursorEl);

  // ---------- sync slots <- game.inventory (count truth) ----------
  function firstFree() {
    for (let i = N_MAIN; i < N; i++) if (!slots[i].item) return slots[i]; // hotbar first
    for (let i = 0; i < N_MAIN; i++) if (!slots[i].item) return slots[i];
    return null;
  }
  function totalInSlots(name) {
    let c = 0;
    for (const s of slots) if (s.item === name) c += s.count;
    if (cursor && cursor.item === name) c += cursor.count;
    return c;
  }
  function resync() {
    const inv = (CBZ.game && CBZ.game.inventory) || {};
    for (const s of slots) if (s.item && !(inv[s.item] > 0)) { s.item = null; s.count = 0; }
    for (const name in inv) {
      const target = inv[name]; if (!(target > 0)) continue;
      let have = totalInSlots(name);
      if (have < target) {
        let s = null;
        for (const x of slots) if (x.item === name) { s = x; break; }
        if (!s) { s = firstFree(); if (s) { s.item = name; s.count = 0; } }
        if (s) s.count += (target - have);
      } else if (have > target) {
        let extra = have - target;
        for (const s of slots) { if (extra <= 0) break; if (s.item === name) { const d = Math.min(s.count, extra); s.count -= d; extra -= d; if (s.count <= 0) s.item = null; } }
      }
    }
    render();
  }

  // ---------- render ----------
  function fill(cell, s) {
    cell.classList.remove("r-uncommon", "r-rare", "r-epic");
    if (s && s.item) {
      cell.innerHTML = '<span class="islot-ic">' + (ICON[s.item] || "▪") + "</span>" +
        (s.count > 1 ? '<span class="islot-n">' + s.count + "</span>" : "");
      cell.title = s.item;
      const it = CBZ.econ && CBZ.econ.ITEMS && CBZ.econ.ITEMS[s.item];
      if (it && it.rarity && it.rarity !== "common") cell.classList.add("r-" + it.rarity);
    } else { cell.innerHTML = ""; cell.title = ""; }
  }
  function render() {
    for (let i = 0; i < N_HOT; i++) {
      fill(barCells[i], slots[N_MAIN + i]);
      barCells[i].classList.toggle("sel", i === selIdx);
      fill(hbCells[i], slots[N_MAIN + i]);
      hbCells[i].classList.toggle("sel", i === selIdx);
    }
    for (let i = 0; i < N_MAIN; i++) fill(mainCells[i], slots[i]);
    if (cursor) {
      cursorEl.style.display = "block";
      cursorEl.innerHTML = '<span class="islot-ic">' + (ICON[cursor.item] || "▪") + "</span>" +
        (cursor.count > 1 ? '<span class="islot-n">' + cursor.count + "</span>" : "");
      cursorEl.style.left = ptr.x + "px"; cursorEl.style.top = ptr.y + "px";
    } else cursorEl.style.display = "none";
  }

  // ---------- effects ----------
  function effect(name) {
    if (FENCEABLE.has(name)) {
      const v = (CBZ.econ && CBZ.econ.ITEMS[name] && CBZ.econ.ITEMS[name].value) || 10;
      CBZ.econ && CBZ.econ.addCigs(v);
      CBZ.flashHint && CBZ.flashHint("💰 Fenced " + name + " for " + v + " 🚬", 1.8);
      CBZ.sfx && CBZ.sfx("coin"); return;
    }
    if (name === "Painkillers") { CBZ.player.stun = 0; CBZ.player.hp = Math.min(100, (CBZ.player.hp || 100) + 35); CBZ.addHeat && CBZ.addHeat(-10); CBZ.flashHint && CBZ.flashHint("💉 Patched up — no pain.", 1.6); CBZ.sfx && CBZ.sfx("coin"); return; }
    if (name === "Energy Drink") { CBZ.player.stun = 0; CBZ.player.stamina = 100; CBZ.addHeat && CBZ.addHeat(-8); CBZ.flashHint && CBZ.flashHint("🥤 Wired — wide awake.", 1.6); CBZ.sfx && CBZ.sfx("coin"); return; }
    if (name === "Ramen") { CBZ.player.stun = 0; CBZ.addHeat && CBZ.addHeat(-40); CBZ.flashHint && CBZ.flashHint("🍜 Slurp — calm and clear-headed.", 1.6); }
    else if (name === "Energy Bar") { CBZ.player.stun = 0; CBZ.addHeat && CBZ.addHeat(-25); CBZ.flashHint && CBZ.flashHint("🍫 Sugar rush — shake it off.", 1.6); }
    else if (name === "Pruno Hooch") { CBZ.addHeat && CBZ.addHeat(-20); CBZ.flashHint && CBZ.flashHint("🍺 Liquid courage.", 1.6); }
    else if (name === "Pills") { CBZ.addHeat && CBZ.addHeat(-15); CBZ.flashHint && CBZ.flashHint("💊 Numb to it all.", 1.6); }
    else if (name === "Powder") { CBZ.addHeat && CBZ.addHeat(-15); CBZ.flashHint && CBZ.flashHint("❄️ Wired and jittery.", 1.6); }
    CBZ.sfx && CBZ.sfx("coin");
  }
  function useItem(name) {
    if (!name || !(CBZ.game.inventory[name] > 0)) return;
    if (!CONSUMABLE.has(name)) { CBZ.flashHint && CBZ.flashHint(name + " — equipped.", 1.0); return; }
    if (CBZ.econ && CBZ.econ.takeItem && CBZ.econ.takeItem(name)) { effect(name); resync(); }
  }

  // ---------- slot interaction ----------
  function slotClick(i, right) {
    const s = slots[i];
    if (right) { if (s.item) useItem(s.item); return; }
    if (!cursor) { if (s.item) { cursor = { item: s.item, count: s.count }; s.item = null; s.count = 0; } }
    else if (!s.item) { s.item = cursor.item; s.count = cursor.count; cursor = null; }
    else if (s.item === cursor.item) { s.count = Math.min(STACK, s.count + cursor.count); cursor = null; }
    else { const t = { item: s.item, count: s.count }; s.item = cursor.item; s.count = cursor.count; cursor = t; }
    render();
  }

  // click handlers (delegated)
  bar.addEventListener("mousedown", (e) => {
    const c = e.target.closest && e.target.closest(".islot"); if (!c) return;
    const i = +c.dataset.slot - N_MAIN; selIdx = i;
    if (!invOpen) useItem(slots[+c.dataset.slot].item);   // quick-use from hotbar
    render();
  });
  function gridDown(e) {
    const c = e.target.closest && e.target.closest(".islot"); if (!c) return;
    e.preventDefault();
    slotClick(+c.dataset.slot, e.button === 2);
  }
  screen.addEventListener("mousedown", gridDown);
  screen.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("mousemove", (e) => { if (invOpen) { ptr.x = e.clientX; ptr.y = e.clientY; if (cursor) render(); } });

  // ---------- open / close ----------
  function open() {
    if (invOpen) return; invOpen = true; CBZ.invOpen = true;
    screen.style.display = "flex";
    if (!CBZ.touchMode && document.exitPointerLock) document.exitPointerLock();
    resync();
  }
  function close() {
    if (!invOpen) return; invOpen = false; CBZ.invOpen = false;
    screen.style.display = "none";
    if (cursor) { cursor = null; resync(); }     // counts never changed; resync re-places it
    if (!CBZ.touchMode && CBZ.game.state === "playing" && CBZ.requestLock) CBZ.requestLock();
    render();
  }
  function toggle() { invOpen ? close() : open(); }
  CBZ.toggleInventory = toggle;
  CBZ.invOpen = false;

  // ---------- keys ----------
  addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    // B = open the bag/stash. I/J/K/L are RESERVED for interaction slots, so
    // the stash moved off I; E stays sabotage/vent, numbers drive the hotbar.
    if (k === "b") { toggle(); return; }
    if (k === "escape" && invOpen) { close(); return; }
    if (!invOpen) {
      // number keys ALWAYS drive the hotbar now (interaction options moved to IJKL)
      const n = "123456789".indexOf(e.key);
      if (n >= 0) { selIdx = n; render(); }
    }
  });

  // mirror the grid to game.inventory after ANY change. Everything that
  // grants/consumes items (trade, steal, loot, use) routes through
  // CBZ.refreshInventory, so wrapping it keeps the hotbar + stash live.
  if (CBZ.econ) {
    const _add = CBZ.econ.addItem, _take = CBZ.econ.takeItem;
    if (_add) CBZ.econ.addItem = function (n, c) { _add(n, c); resync(); };
    if (_take) CBZ.econ.takeItem = function (n) { const r = _take(n); resync(); return r; };
  }
  const _refresh = CBZ.refreshInventory;
  CBZ.refreshInventory = function () { if (_refresh) _refresh(); resync(); };

  // hide hotbar / close stash on menus; reset selection on a new run
  let lastEl = 0;
  CBZ.onAlways(97, function () {
    const playing = CBZ.game.state === "playing";
    bar.style.display = playing ? "flex" : "none";
    if (!playing && invOpen) close();
    const el = CBZ.game.elapsed || 0;
    if (el + 0.001 < lastEl) { selIdx = 0; cursor = null; resync(); } // new run
    lastEl = el;
  });

  resync();
})();
