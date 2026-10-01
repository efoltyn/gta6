/* ============================================================
   systems/hotbar_model.js — WHAT THE HOTBAR IS ALLOWED TO HOLD.

   OWNER (2026-09-28): "only guns are cool, and the keycard is cool af. All
   other inventory is dumb af, and when there are many guns it shows dumb
   with the other inventory ... The flashlight is a cool thing in inventory
   because at night it helps. That's inventory that matters."
   OWNER (2026-09-30): "ADD THE INVENTORY OF JAIL GAME TO GANG CITY, IT'S
   DONE WELL." So this is the ONE bar of every game: the prison and Gang
   City run this model and the one renderer (systems/inventory.js); the
   city simply carries more kinds of thing.

   The bar is not a bag. It is the short list of things in your hands or
   on your belt that change what you can DO:

     gun         every firearm you own, one cell each, in carry order
     melee       the bat / knife / hatchet on your belt (city): select = in
                 your hand, select again = put away
     throwable   a grenade / a demolition charge: selecting one puts it IN
                 YOUR HAND (systems/helditems.js), the use input uses it
     detonator   appears once a charge is out; in hand, squeeze = boom
     bandage     a roll of gauze, while you carry one (systems/vitals.js):
                 selecting it puts it in your hand, HOLDING the use input
                 wraps your worst open wound; letting go early stops
     flashlight  the light (systems/playerflashlight.js); lit = emphasized
     phone       the handset (city): select = raise it / put it away
     keycard     a staff / officer's / vault card; passive, it opens doors
                 by itself
     key         a real door key (prison: Gun-Room / Gate / Corridor / Cell;
                 city: whatever door city/keys.js handed you)

   Everything else a pocket holds (ramen, pills, cigarettes, wallets, the
   shiv, drugs, cash) is NOT on the bar: food and meds are taken
   automatically when you need them, trade goods are traded in the world,
   the shiv is in your punch, cash is the number that shows when it moves.

   PURE: no DOM, no THREE. Plain node can load it (tools/check-hotbar.mjs)
   and the browser build reads it off CBZ.hotbarModel.
============================================================ */
(function (root) {
  "use strict";

  const KINDS = ["gun", "melee", "throwable", "detonator", "bandage", "flashlight", "phone", "keycard", "key"];
  // selectable cells answer a digit / a tap; passive cells only show.
  const SELECTABLE = { gun: 1, melee: 1, throwable: 1, detonator: 1, bandage: 1, flashlight: 1, phone: 1 };
  const DOOR_KEYS = ["Gun-Room Key", "Gate Key", "Corridor Key", "Cell Key"];
  // the games whose belt (cards, door keys) rides the bar
  const BELT_MODES = { escape: 1, city: 1 };

  /* s = {
       mode, guns:[id...], held:id|null, holstered:bool,
       melee:{name, active}|null           the city belt weapon
       items:[{kind:"throwable"|"detonator", item, held, count, active}]
         (systems/helditem_model.js cells(): the held things you carry)
       bandage:{count, active}|null        rolls carried; active = in your hand
       flashlight:{owned,on}|null,
       phone:{active, unread, buzz}|null   the handset you carry
       hasKeycard:bool, cards:[name...]    the prison card / the city's cards
       keys:[name...]                      door keys on your belt
     }  ->  [{kind, id?, name?, count?, active, selectable}] in draw order:
     selectable first, passive last (cards, keys), so a digit key always
     means the Nth thing you can pick up and use. */
  function build(s) {
    s = s || {};
    const out = [];
    const seen = Object.create(null);
    const guns = Array.isArray(s.guns) ? s.guns : [];
    for (let i = 0; i < guns.length; i++) {
      const id = guns[i];
      if (!id || seen["g" + id]) continue;          // a gun is never listed twice
      seen["g" + id] = 1;
      out.push({ kind: "gun", id: String(id), active: !s.holstered && id === s.held, selectable: true });
    }
    const ml = s.melee;
    if (ml && ml.name) out.push({ kind: "melee", name: String(ml.name), active: !!ml.active, selectable: true });
    const items = Array.isArray(s.items) ? s.items : [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || (it.kind !== "throwable" && it.kind !== "detonator") || seen["i" + it.item]) continue;
      seen["i" + it.item] = 1;
      out.push({ kind: it.kind, name: it.item, held: it.held || null, count: it.count | 0, active: !!it.active, selectable: true });
    }
    const bd = s.bandage;
    if (bd && (bd.count | 0) > 0) out.push({ kind: "bandage", count: bd.count | 0, active: !!bd.active, selectable: true });
    const fl = s.flashlight;
    if (fl && fl.owned) out.push({ kind: "flashlight", active: !!fl.on, selectable: true });
    const ph = s.phone;
    if (ph) out.push({ kind: "phone", name: "Phone", active: !!ph.active, unread: !!ph.unread, buzz: !!ph.buzz, selectable: true });
    if (BELT_MODES[s.mode]) {
      const cards = (s.hasKeycard ? ["Keycard"] : []).concat(Array.isArray(s.cards) ? s.cards : []);
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (!c || seen["c" + c]) continue;
        seen["c" + c] = 1;
        out.push({ kind: "keycard", name: String(c), active: false, selectable: false });
      }
      const keys = Array.isArray(s.keys) ? s.keys : [];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        // the prison's four real keys are the only keys there; a city key is
        // whatever door handed it to you (the caller lists what you carry)
        if (!k || seen["k" + k] || (s.mode === "escape" && DOOR_KEYS.indexOf(k) < 0)) continue;
        seen["k" + k] = 1;
        out.push({ kind: "key", name: String(k), active: false, selectable: false });
      }
    }
    return out;
  }

  // every entry's kind is on the allow-list. The ratchet the node check runs.
  function allowed(entries) {
    for (let i = 0; i < entries.length; i++) if (KINDS.indexOf(entries[i] && entries[i].kind) < 0) return false;
    return true;
  }

  // digit n (0-based) -> the entry it selects, counting selectable cells only
  function selectableAt(entries, n) {
    let c = 0;
    for (let i = 0; i < entries.length; i++) {
      if (!entries[i].selectable) continue;
      if (c === n) return entries[i];
      c++;
    }
    return null;
  }

  // a compact change signature so the renderer touches the DOM only on change
  function signature(entries, extra) {
    let s = extra || "";
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      s += "|" + e.kind + ":" + (e.id || e.name || "") + (e.active ? "*" : "") + (e.dry ? "d" : "") +
        ((e.count | 0) > 1 ? "#" + (e.count | 0) : "") + (e.unread ? "u" : "") + (e.buzz ? "z" : "");
    }
    return s;
  }

  const api = { KINDS: KINDS, SELECTABLE: SELECTABLE, DOOR_KEYS: DOOR_KEYS, BELT_MODES: BELT_MODES, build: build, allowed: allowed, selectableAt: selectableAt, signature: signature };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.CBZ) root.CBZ.hotbarModel = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
