/* ============================================================
   systems/craft.js — B7: CRAFTING (gather → craft → build).

   CBZ.craft.RECIPES only ever CRAFTS TOOLS (Hatchet/Pickaxe). Building
   pieces (foundation/wall/.../door/cupboard/container) do NOT craft here —
   they cost on PLACEMENT instead, gated straight against CBZ.building.
   CATALOG.cost by systems/buildmode.js's tryPlace()/costsApply() (the real,
   already-registered costs: door 50 Wood, cupboard 100 Wood, container 80
   Wood — systems/baseclaim.js). These two tool recipes are the pattern the
   task asked for, not a second, competing cost table for those six kinds.

   ONE item-store accessor pair (store()) handles BOTH modes that can reach
   this file: city → g.cityInv via CBZ.cityEcon (count/take/add already
   support an explicit count); escape/survival → g.inventory via the SAME
   bridge systems/baseclaim.js's own container panel already uses, because
   systems/economy.js's CBZ.econ.takeItem() only ever removes exactly ONE
   at a time (no count param) — insufficient for a 20-Wood deduction.
   systems/buildmode.js reuses this exact store (CBZ.craft.itemStore) for
   its own cost gate, so there is only one source of truth for "what item
   store is the current mode's economy."
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const RECIPES = {
    Hatchet: { Wood: 20, Scrap: 5 },
    Pickaxe: { Wood: 15, Scrap: 10 },
  };

  function store() {
    if (g.mode === "city") {
      const E = CBZ.cityEcon;
      return {
        count: function (n) { return E ? E.count(n) : 0; },
        take: function (n, c) { return E ? E.take(n, c) : false; },
        add: function (n, c) { if (E) E.add(n, c); },
      };
    }
    // escape + survival share g.inventory (systems/economy.js's own store,
    // extended here with an explicit COUNT — CBZ.econ.takeItem has none).
    return {
      count: function (n) { return (g.inventory && g.inventory[n]) || 0; },
      take: function (n, c) {
        const have = (g.inventory && g.inventory[n]) || 0;
        if (have < c) return false;
        g.inventory[n] -= c;
        if (g.inventory[n] <= 0) delete g.inventory[n];
        if (CBZ.refreshInventory) CBZ.refreshInventory();
        return true;
      },
      add: function (n, c) {
        g.inventory = g.inventory || {};
        g.inventory[n] = (g.inventory[n] || 0) + c;
        if (CBZ.refreshInventory) CBZ.refreshInventory();
      },
    };
  }

  function canCraft(id) {
    const r = RECIPES[id]; if (!r) return false;
    const S = store();
    for (const mat in r) if (S.count(mat) < r[mat]) return false;
    return true;
  }
  function craft(id) {
    if (!canCraft(id)) return false;
    const r = RECIPES[id], S = store();
    for (const mat in r) S.take(mat, r[mat]);
    S.add(id, 1);
    // a freshly-crafted tool goes straight into your hand in the city — the
    // ONLY equip path a tool has this wave (city/combat.js's melee-weapon
    // slot; systems/resources.js reads it back via CBZ.cityCurrentWeaponName
    // for the harvest multiplier).
    if (g.mode === "city" && CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(id);
    if (CBZ.flashHint) CBZ.flashHint("🔨 Crafted " + id, 1.4);
    if (CBZ.sfx) CBZ.sfx("coin");
    return true;
  }

  CBZ.craft = { RECIPES: RECIPES, canCraft: canCraft, craft: craft, itemStore: store };

  // ============================================================
  //  CRAFT PANEL — [C] toggle. Minimal plain-DOM overlay, same convention
  //  as city/captives.js / systems/baseclaim.js's container panel.
  //
  //  KEY AUDIT (grepped, not guessed):
  //    G is taken TWICE in city mode outdoors — city/combat.js:1053-1060
  //    (throw a grenade) and city/storage.js:451 (open a property) — both
  //    fire under the exact gate this panel would need (mode==="city",
  //    state==="playing", !cityMenuOpen, on foot). Using G here would
  //    silently eat one of those, so it's out per the task's own escape
  //    hatch ("if G taken use comma or a buildmode submenu").
  //    C is claimed only twice, and NEITHER overlaps "on foot, no menu
  //    open": city/playercars.js:1240-1243 binds C to cycle paint but
  //    gates on CBZ.player.driving being TRUE; city/wealth.js:841 binds C
  //    to collect-all but gates on the wealth panel's own `open_` (i.e.
  //    CBZ.cityMenuOpen already true). So C is free the moment you're on
  //    foot with nothing else open — chosen over comma/period (city/
  //    wealth.js already uses those for its own tab-cycle while its panel
  //    is open, so they'd be a worse, more easily-confused pick).
  //    Available in BOTH build mode and out of it (crafting a tool has
  //    value outside a building session too) — buildmode.js's own capture-
  //    phase listener only swallows T/R/F/E/X/Z/1-6 while active, so C
  //    passes through to this bubble-phase listener untouched either way.
  // ============================================================
  let open_ = false, panel = null, bodyEl = null;
  function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text != null) e.textContent = text;
    return e;
  }
  function buildPanel() {
    if (panel || typeof document === "undefined" || !document.body) return;
    panel = el("div",
      "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9001;" +
      "width:min(340px,90vw);font:14px/1.4 system-ui,Segoe UI,Roboto,sans-serif;color:#eef;" +
      "background:rgba(14,16,22,0.95);border:1px solid rgba(120,150,200,0.35);" +
      "border-radius:12px;padding:14px;display:none;box-shadow:0 18px 60px rgba(0,0,0,0.7);");
    panel.appendChild(el("div", "font:700 15px system-ui;color:#fff;margin-bottom:8px;", "🔨 CRAFT"));
    bodyEl = el("div");
    panel.appendChild(bodyEl);
    panel.appendChild(el("div", "margin-top:10px;font:12px system-ui;color:#9aa6bd;", "[1-9] craft  ·  C / Esc close"));
    document.body.appendChild(panel);
  }
  function render() {
    buildPanel(); if (!panel) return;
    bodyEl.innerHTML = "";
    Object.keys(RECIPES).forEach(function (id, i) {
      const r = RECIPES[id], ok = canCraft(id);
      const cost = Object.keys(r).map(function (m) { return r[m] + " " + m; }).join(", ");
      const row = el("div", "display:flex;justify-content:space-between;gap:12px;padding:6px 0;" +
        "border-top:1px solid rgba(255,255,255,0.08);color:" + (ok ? "#eef" : "#7a8296"));
      row.appendChild(el("div", null, (i + 1) + ". " + id));
      row.appendChild(el("div", "color:" + (ok ? "#7ed957" : "#e0616b") + ";white-space:nowrap;", cost));
      bodyEl.appendChild(row);
    });
  }
  function close() {
    open_ = false; CBZ.cityMenuOpen = false;
    if (panel) panel.style.display = "none";
    if (!CBZ.touchMode && CBZ.game.state === "playing" && CBZ.requestLock) CBZ.requestLock();
  }
  function open() {
    if (open_ || (CBZ.cityMenuOpen && !open_)) return;   // another overlay owns the screen (wealth.js's own convention)
    open_ = true; CBZ.cityMenuOpen = true;
    render();
    if (panel) panel.style.display = "block";
    if (!CBZ.touchMode && document.exitPointerLock) document.exitPointerLock();
  }
  function toggle() { open_ ? close() : open(); }

  function canOpen() {
    const P = CBZ.player;
    return g.state === "playing" && (g.mode === "city" || g.mode === "survival") &&
      !CBZ.cityMenuOpen && !CBZ.invOpen && !(P && (P.driving || P.dead));
  }

  addEventListener("keydown", function (e) {
    if (e.repeat) return;
    const k = (e.key || "").toLowerCase();
    if (open_) {
      if (k === "escape" || k === "c") { e.preventDefault(); close(); return; }
      const n = "123456789".indexOf(k);
      if (n >= 0) {
        const id = Object.keys(RECIPES)[n];
        if (id) { craft(id); render(); }
        e.preventDefault();
      }
      return;
    }
    if (k !== "c") return;
    if (!canOpen()) return;
    e.preventDefault();
    toggle();
  });
})();
