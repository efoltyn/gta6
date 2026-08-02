/* ============================================================
   city/shops.js — the storefront overlay: buy stock, sell/fence your
   loot, and use per-shop services (eat, heal, bank, jobs, buy a car).

   Opened by city/interact.js when you walk up to a vendor counter and
   press E. While it's up, CBZ.cityMenuOpen blocks shooting. Number keys
   buy the listed items; the lettered actions run services.

   DEEPER SHOPPING (GTA-style): clothing/jewelry you can actually WEAR
   (drip → respect + a "look" you carry), barbers that restyle you, food
   that heals, hardware tools, BULK buys with a quantity discount,
   one-shot HAGGLING per visit, and ROBBING THE TILL for risk/reward.
   Researched against GTA V clothing stores, barbers, tattoo parlors, and
   GTA Online store-robbery / intimidation mechanics.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  let panel = null, openLot = null, listItems = [];
  // per-visit transient state (reset every time a shop opens)
  let qty = 1;                 // buy multiplier (1 / 5 / 10), toggled with [Q]... wait, Q is taken
  let haggle = 0;             // -% discount earned this visit (0..maxHaggle), one attempt
  let haggleTried = false;    // only one haggle attempt per visit
  let closetOpen = false;     // boutique CLOSET sub-view: change clothes from owned wearables
  let closetItems = [];       // owned wearables you can equip in the closet (index → name)

  // ---- the WARDROBE: wearables you've equipped (worn flex) + your style ----
  // DRIP is now driven by economy.js's SLOTTED outfit (g.cityOutfit): buying a
  // wearable EQUIPS it into its slot (CBZ.cityEquip), and a new top REPLACES the
  // old top in that slot. We never double-count: the drip comes from whatever is
  // currently WORN, read through CBZ.cityPlayerDrip().
  //
  // "isWorn" here means "currently equipped in its slot" — it reads the shared
  // model (CBZ.cityIsEquipped) so the boutique's ✓worn marks, the no-sell-the-
  // -last-copy rule, and the ICE-OUT bundle all agree with the club's bouncer.
  function isWorn(name) {
    if (CBZ.cityIsEquipped) return !!CBZ.cityIsEquipped(name);
    return false;
  }
  // equip a wearable into its slot via the shared model (replaces that slot).
  // Returns true if it actually went on. Guarded so a missing economy degrades
  // to a plain owned-but-unworn item rather than crashing the buy.
  function equipItem(name) {
    if (CBZ.cityEquip) return !!CBZ.cityEquip(name);
    return false;
  }
  function unequipItem(slotOrName) {
    if (CBZ.cityUnequip) return !!CBZ.cityUnequip(slotOrName);
    return false;
  }
  // the slot an item fills (hat/top/outer/…) so the store can show it + the
  // "buying a new top replaces the old one" hint.
  function slotOf(name) {
    if (CBZ.cityEcon && CBZ.cityEcon.slotOf) return CBZ.cityEcon.slotOf(name);
    const it = CBZ.cityEcon && CBZ.cityEcon.ITEMS[name];
    return it && it.tag === "wearable" ? (it.slot || null) : null;
  }
  // what's currently worn in a given slot (its item name), or "" if empty.
  function wornInSlot(slot) {
    const o = (CBZ.cityEcon && CBZ.cityEcon.outfit) ? CBZ.cityEcon.outfit() : (g.cityOutfit || {});
    return (o && o[slot]) || "";
  }
  function look() {
    g.cityLook = g.cityLook || { hair: "Default", outfit: "Streetwear", swagger: 0 };
    return g.cityLook;
  }
  // The PLAYER's status number — the bouncer's read. Prefer the shared
  // equipped-outfit drip (CBZ.cityPlayerDrip); fall back to legacy inv-sum drip
  // if economy.js's outfit model isn't present yet.
  function playerDrip() {
    if (CBZ.cityPlayerDrip) return CBZ.cityPlayerDrip() | 0;
    if (CBZ.cityEcon && CBZ.cityEcon.drip) return CBZ.cityEcon.drip() | 0;
    return 0;
  }
  CBZ.cityLook = look;

  // BARBER haircuts & CLOTHING outfits — pure-cosmetic-ish style that nudges
  // your street swagger (a small standing respect bonus while you keep it).
  const HAIRCUTS = [
    { name: "Fresh Fade", cost: 35, swag: 2 },
    { name: "Cornrows", cost: 45, swag: 3 },
    { name: "Buzz Cut", cost: 25, swag: 1 },
    { name: "Slick Back", cost: 55, swag: 3 },
    { name: "Dreads", cost: 70, swag: 4 },
    { name: "Mohawk", cost: 60, swag: 4 },
    { name: "Clean Shave + Lineup", cost: 30, swag: 2 },
  ];
  // LEGACY fitting-room list — only used if city/outfits.js (the canonical
  // wardrobe) isn't loaded. With outfits.js live, the rack is catalog-driven:
  // street basics up to the MIDNIGHT TUXEDO (the apex status purchase — worn
  // cloth that opens the Velvet's rope by itself).
  const OUTFITS = [
    { name: "Tracksuit", cost: 180, swag: 3 },
    { name: "Tailored Suit", cost: 900, swag: 8 },
    { name: "Designer Drip", cost: 1400, swag: 12 },
    { name: "Goon Hoodie", cost: 120, swag: 2 },
    { name: "Leather Jacket", cost: 520, swag: 6 },
    { name: "All Black Tactical", cost: 700, swag: 7 },
  ];
  // the boutique RACK from the canonical catalog: every fit with a price tag,
  // cheapest → the tuxedo. Mapped onto the legacy {name,cost,swag} shape so the
  // render/keys code stays one path; `id` marks a catalog fit (drip, not swagger).
  function outfitRack() {
    const cat = CBZ.cityOutfitCatalog && CBZ.cityOutfitCatalog();
    if (!cat) return OUTFITS;
    const out = [];
    for (const k in cat) { const o = cat[k]; if (o.price > 0) out.push({ name: o.name, cost: o.price, swag: o.drip, id: o.id }); }
    out.sort((a, b) => a.cost - b.cost);
    return out.slice(0, 9);
  }

  function el() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cityShop";
    panel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:48;display:none;min-width:340px;max-width:460px;background:rgba(16,18,24,.94);border:2px solid #2c3140;border-radius:16px;padding:16px 18px;color:#e8eef7;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5);pointer-events:auto;max-height:88vh;overflow-y:auto";
    document.body.appendChild(panel);
    return panel;
  }

  function fmt$(n) { return "$" + (n | 0); }

  // the per-shop discount that actually lands on a price: haggle + bulk +
  // a small loyalty cut if you're a baller (the rich get treated better).
  function shopDiscount(n) {
    n = n || 1;
    let d = haggle;                                 // 0..0.18 earned by haggling
    if (n >= 10) d += 0.10; else if (n >= 5) d += 0.05;   // bulk
    const nw = CBZ.cityEcon.netWorth ? CBZ.cityEcon.netWorth() : (g.cash || 0);
    if (nw > 150000) d += 0.03;                     // VIP/loyalty
    return Math.min(0.35, d);
  }
  // final unit price for an item at this counter, after discounts
  function unitPrice(it, n) {
    const base = CBZ.cityEcon.buyPrice(it);
    return Math.max(1, Math.round(base * (1 - shopDiscount(n))));
  }

  // is this a store where buying clothing/jewelry should auto-EQUIP it (build
  // drip)? Boutique/clothing + jewelry + barber accessories all dress you up.
  function isBoutique(kind) { return kind === "clothing" || kind === "boutique" || kind === "jewelry" || kind === "barber"; }
  // the letter that toggles the CLOSET sub-view, chosen so it never collides
  // with this shop's restyle letters (a..styles.length) or a service key. Most
  // boutiques get [G]; the barber (whose haircuts run a..g) falls back to [K].
  function closetKey(kind) {
    if (!isBoutique(kind)) return null;
    const nStyles = styleMenu(kind).length;                 // restyle owns a..(a+nStyles-1)
    const svc = services(kind);
    const prefs = ["g", "h", "k", "u"];
    for (const c of prefs) {
      const restyleLetter = (c.charCodeAt(0) - 97) < nStyles;
      const isSvc = svc.some((s) => s.key === c);
      if (!restyleLetter && !isSvc) return c;
    }
    return null;                                             // (won't happen with these prefs)
  }
  // the drip the player WOULD have after equipping `name` into its slot:
  // current total, minus whatever that slot is worth now, plus this piece.
  function dripAfter(name) {
    const meta = CBZ.cityEcon.ITEMS[name];
    if (!meta || meta.tag !== "wearable") return playerDrip();
    const cur = playerDrip();
    if (isWorn(name)) return cur;                 // already on — no change
    const slot = slotOf(name);
    const prev = slot ? wornInSlot(slot) : "";    // what we'd REPLACE
    const prevDrip = prev && CBZ.cityEcon.ITEMS[prev] ? (CBZ.cityEcon.ITEMS[prev].drip || 0) : 0;
    return cur - prevDrip + (meta.drip || 0);
  }

  // ---- the CLOSET (change-clothes view): equip/unequip what you already OWN --
  // every wearable in your inventory (de-duped), grouped by slot, with the worn
  // piece marked. Number keys equip the listed owned pieces; the slot letters
  // strip the current slot. Light-touch — buying still auto-equips for you.
  function ownedWearables() {
    const inv = g.cityInv || {}, it = CBZ.cityEcon.ITEMS, out = [];
    const SLOTS = (CBZ.cityOutfitSlots && CBZ.cityOutfitSlots()) || ["hat", "top", "outer", "bottom", "shoes", "glasses", "chain", "watch", "ring"];
    const order = {}; SLOTS.forEach((s, i) => { order[s] = i; });
    for (const k in inv) { const m = it[k]; if (m && m.tag === "wearable") out.push(k); }
    // sort by slot order, then by drip desc, so the closet reads head-to-toe.
    out.sort((a, b) => {
      const sa = order[slotOf(a)] != null ? order[slotOf(a)] : 99, sb = order[slotOf(b)] != null ? order[slotOf(b)] : 99;
      if (sa !== sb) return sa - sb;
      return (it[b].drip || 0) - (it[a].drip || 0);
    });
    return out;
  }
  function renderCloset() {
    const it = CBZ.cityEcon.ITEMS;
    const SLOTS = (CBZ.cityOutfitSlots && CBZ.cityOutfitSlots()) || ["hat", "top", "outer", "bottom", "shoes", "glasses", "chain", "watch", "ring"];
    let html = "<div style='font-size:12px;color:#9fb0c6;margin:6px 0 2px'>YOUR CLOSET <span style='color:#7f8794'>· number = wear it · <b style='color:#ff9e6b'>[0]</b> strip everything</span></div>";
    // CURRENTLY WORN, head-to-toe (so you can see the full fit at a glance)
    const o = (CBZ.cityEcon.outfit ? CBZ.cityEcon.outfit() : (g.cityOutfit || {}));
    const wornAny = SLOTS.some((s) => o[s]);
    html += "<div style='font-size:12px;color:#aeb8c6;margin-bottom:4px'>WEARING: ";
    if (wornAny) {
      html += SLOTS.filter((s) => o[s]).map((s) =>
        "<span style='display:inline-block;margin:1px 6px 1px 0'>" +
        "<span style='color:#7f8794'>" + s + ":</span> <span style='color:#7ed957'>" + o[s] + "</span> <span style='color:#7f8794'>+" + (it[o[s]].drip || 0) + "</span></span>"
      ).join("");
    } else html += "<span style='color:#7f8794'>plain clothes — nothing equipped.</span>";
    html += "</div>";
    // OWNED pieces you can put on (number keys). Worn ones marked ✓.
    closetItems = ownedWearables().slice(0, 9);
    if (!closetItems.length) {
      html += "<div style='font-size:12px;color:#7f8794;margin-top:4px'>You don't own any wearables yet — buy a fit to build drip.</div>";
      return html;
    }
    html += "<div style='font-size:12px;color:#9fb0c6;margin:6px 0 2px'>OWN — press the number to wear</div>";
    closetItems.forEach((nm, i) => {
      const m = it[nm], worn = isWorn(nm), slot = slotOf(nm);
      const after = dripAfter(nm), cur = playerDrip();
      html += "<div style='display:flex;justify-content:space-between;padding:2px 0'><span><b style='color:#ffd166'>" + (i + 1) + "</b> " + nm +
        " <span style='color:#7f8794;font-size:11px'>(" + (slot ? slot + " · " : "") + "+" + (m.drip || 0) + " drip)</span>" +
        (worn ? " <span style='color:#7ed957;font-size:11px'>✓worn</span>"
          : " <span style='color:#ffd166;font-size:11px'>DRIP " + cur + "→" + after + "</span>") +
        "</span></div>";
    });
    return html;
  }
  // equip an OWNED wearable from the closet (no purchase). Mirrors the buy-equip
  // path's drip surfacing but never charges or re-rewards respect for a re-wear.
  function closetEquip(i) {
    const nm = closetItems[i]; if (!nm) return;
    if (isWorn(nm)) { CBZ.city.note("Already wearing " + nm + ".", 1.2); return; }
    const before = playerDrip();
    if (equipItem(nm)) {
      const after = playerDrip();
      CBZ.city.note("Put on " + nm + " — sharper already.", 1.6);
      if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    }
    render();
  }
  // take EVERYTHING off (clean slate) — the closet's [0]. Drips back to baseline.
  function closetStripAll() {
    const SLOTS = (CBZ.cityOutfitSlots && CBZ.cityOutfitSlots()) || ["hat", "top", "outer", "bottom", "shoes", "glasses", "chain", "watch", "ring"];
    const o = (CBZ.cityEcon.outfit ? CBZ.cityEcon.outfit() : (g.cityOutfit || {}));
    const had = SLOTS.some((s) => o[s]);
    if (!had) { CBZ.city.note("You're already stripped down.", 1.2); render(); return; }
    const before = playerDrip();
    SLOTS.forEach((s) => { if (o[s]) unequipItem(s); });
    const after = playerDrip();
    CBZ.city.note("Stripped down — back to basics.", 1.6);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    render();
  }

  function render() {
    const econ = CBZ.cityEcon, lot = openLot; if (!lot) return;
    const kind = lot.kind, name = lot.building.name;
    const stock = econ.stockFor(kind);
    // THE GUN WALL (city/gunstore.js): when the walk-in armory is live, the
    // counter menu stops listing the firearms themselves — every gun hangs on
    // the wall as its REAL model and is bought eye-to-iron with [E] at the
    // rack. The clerk's counter keeps the consumables (ammo/armor/grenades/
    // melee). One price source for both paths: cityEcon.buyPrice. Feature-
    // detected: no gunstore.js → this menu sells everything, as before.
    const wallLive = kind === "guns" && CBZ.cityGunWallLive && CBZ.cityGunWallLive(lot);
    listItems = (wallLive ? stock.filter((n) => !(econ.ITEMS[n] && econ.ITEMS[n].gun)) : stock).slice(0, 9);
    let html = "<div style='font-size:20px;font-weight:700;margin-bottom:2px'>" + name + "</div>";
    const disc = shopDiscount(qty);
    // HEADER: cash/bank + your CURRENT DRIP (the club gate). In a boutique we
    // spell out where you stand vs the rope so shopping visibly moves you toward
    // (or past) the velvet rope — the whole money→clothes→drip→club loop.
    const drip = playerDrip();
    const CLUB = (CBZ.CITY && CBZ.CITY.CLUB_DRIP) || 30, VIP = (CBZ.CITY && CBZ.CITY.VIP_DRIP) || 70;
    let dripBadge = "Drip <span style='color:#ffd166'>" + drip + "</span>";
    if (isBoutique(kind)) {
      const tier = drip >= VIP ? "<span style='color:#c9a8ff'> VIP ✦</span>"
        : drip >= CLUB ? "<span style='color:#7ed957'> ✓ past the rope</span>"
        : "<span style='color:#ff9e6b'> need " + CLUB + " for the club</span>";
      dripBadge += "<span style='color:#7f8794'>/" + CLUB + "</span>" + tier;
    }
    html += "<div style='font-size:12px;color:#8a93a3;margin-bottom:6px'>Cash " + fmt$(g.cash) + " · " +
      (g.cityBank ? "Bank " + fmt$(g.cityBank) + " · " : "") +
      dripBadge + " · [Esc]/[E] leave</div>";

    // the walk-in routing line: the WALL sells the guns, the counter the rest.
    if (wallLive) {
      html += "<div style='font-size:12px;color:#9fb0c6;margin:2px 0 6px'>The pieces are <b style='color:#ffd166'>on the wall</b> — " +
        "walk up to one and press <b style='color:#ffd166'>E</b> to take it off the rack. The counter's got the ammo.</div>";
    }

    // BOUTIQUE CLOSET: a compact "change clothes" view — equip/unequip from the
    // wearables you already OWN (separate from buying). Toggled with [G]; while
    // it's up, the number keys EQUIP owned pieces instead of buying. This is the
    // light-touch outfit manager (the buy-equips-it path stays the core).
    const ck = closetKey(kind);
    if (isBoutique(kind) && ck) {
      html += "<div style='font-size:11px;color:#7f8794;margin-bottom:4px'><b style='color:#7fd0ff'>[" + ck.toUpperCase() + "]</b> " +
        (closetOpen ? "back to the store" : "open your closet (change clothes)") + "</div>";
    }
    if (closetOpen && isBoutique(kind)) {
      html += renderCloset();
      el().innerHTML = html;
      return;
    }

    // BUY CONTROLS: bulk multiplier + haggle (only show where there's stock)
    if (listItems.length) {
      html += "<div style='font-size:11px;color:#7f8794;margin-bottom:6px;display:flex;gap:10px;flex-wrap:wrap'>" +
        "<span><b style='color:#7fd0ff'>[X]</b> qty ×" + qty + "</span>" +
        (haggleTried ? "<span style='color:#9fb0c6'>[V] haggled" + (haggle > 0 ? " −" + Math.round(haggle * 100) + "%" : " (no luck)") + "</span>"
          : "<span><b style='color:#7fd0ff'>[V]</b> haggle</span>") +
        (disc > 0 ? "<span style='color:#7ed957'>deal −" + Math.round(disc * 100) + "%</span>" : "") +
        "</div>";
      html += "<div style='font-size:12px;color:#9fb0c6;margin:4px 0'>BUY</div>";
      listItems.forEach((it, i) => {
        const each = unitPrice(it, qty);
        const meta = econ.ITEMS[it];
        const wear = meta.tag === "wearable";
        // the per-item tag: food shows heal, guns show their DAMAGE (so paying
        // the AK premium over the Rifle is a legible upgrade, not a blind flex);
        // a WEARABLE shows its slot + drip value so its status contribution is
        // legible at a glance.
        const slot = wear ? slotOf(it) : null;
        const tagN = kind === "food" ? "+" + (meta.heal || 0) + "hp"
          : (meta.gun ? "gun" + ((meta.dmg || 0) > 1 ? " · " + meta.dmg + " dmg" : "") : (wear ? (slot ? slot + " · " : "") + "+" + (meta.drip || 0) + " drip" : meta.tag));
        const worn = wear && isWorn(it);
        const line = qty > 1 ? (fmt$(each) + " ea · " + fmt$(each * qty) + "/×" + qty) : fmt$(each);
        // E1: FOOD rows get a live ▲▼ off the shim's trend() (sim/market.js) —
        // the moving price tag milestone. Guarded/food-only this wave.
        let trendGlyph = "";
        if (kind === "food" && CBZ.market) {
          const tr = CBZ.market.trend("food");
          trendGlyph = tr === "up" ? " <span style='color:#ff9e6b'>▲</span>"
            : tr === "down" ? " <span style='color:#7ed957'>▼</span>" : "";
        }
        // for a wearable you don't yet wear, preview DRIP x → y (and call out the
        // piece it REPLACES in that slot) so the drip gain is obvious before you buy.
        let dripHint = "";
        if (wear && isBoutique(kind) && !worn) {
          const after = dripAfter(it), cur = playerDrip();
          const cur2 = slot ? wornInSlot(slot) : "";
          dripHint = " <span style='color:#ffd166;font-size:11px'>DRIP " + cur + "→" + after + "</span>" +
            (cur2 ? " <span style='color:#7f8794;font-size:11px'>(replaces " + cur2 + ")</span>" : "");
        }
        html += "<div style='display:flex;justify-content:space-between;padding:3px 0'><span><b style='color:#ffd166'>" + (i + 1) + "</b> " + it +
          " <span style='color:#7f8794;font-size:11px'>(" + tagN + ")</span>" +
          (worn ? " <span style='color:#7ed957;font-size:11px'>✓worn</span>" : dripHint) +
          "</span><span style='color:#7ed957'>" + line + trendGlyph + "</span></div>";
      });
    }
    // BARBER chair / CLOTHING rack. The rack sells whole OUTFITS (the canonical
    // wardrobe): each shows its DRIP — worn status, the same number the bouncer
    // reads — and an owned fit re-wears FREE. The tuxedo tops the list: cloth
    // priced like a car, because the rope opens for it.
    const styles = styleMenu(kind);
    if (styles.length) {
      const label = kind === "barber" ? "BARBER CHAIR" : "FITTING ROOM";
      const cur = kind === "barber" ? look().hair
        : ((CBZ.cityOutfitGet && CBZ.cityOutfitGet().name) || look().outfit);
      html += "<div style='font-size:12px;color:#9fb0c6;margin:8px 0 2px'>" + label +
        " <span style='color:#7f8794'>· wearing: " + cur + "</span></div>";
      const letters = styleLetters(kind);
      const ownedFits = g.cityOutfitsOwned || {};
      const wornId = g.cityOutfitId || "";
      styles.forEach((s, i) => {
        const letter = letters[i]; if (!letter) return;
        const isFit = !!s.id;                                     // catalog outfit (drip) vs haircut (swagger)
        const wornNow = isFit && s.id === wornId;
        const owned = isFit && !!ownedFits[s.id];
        const tag = isFit ? "+" + s.swag + " drip" : "+" + s.swag + " swagger";
        const price = wornNow ? "" : (owned ? "<span style='color:#7fd0ff'>owned · wear</span>" : "<span style='color:#7ed957'>" + fmt$(s.cost) + "</span>");
        html += "<div style='display:flex;justify-content:space-between;padding:2px 0'><span><b style='color:#7fd0ff'>" + letter.toUpperCase() + "</b> " +
          s.name + " <span style='color:#7f8794;font-size:11px'>(" + tag + ")</span>" +
          (wornNow ? " <span style='color:#7ed957;font-size:11px'>✓worn</span>" : "") +
          "</span><span>" + price + "</span></div>";
      });
    }
    // services
    const svc = services(kind);
    if (svc.length) {
      html += "<div style='font-size:12px;color:#9fb0c6;margin:8px 0 2px'>SERVICES</div>";
      svc.forEach((s) => { html += "<div style='padding:2px 0'><b style='color:#7fd0ff'>" + s.key.toUpperCase() + "</b> " + s.label + "</div>"; });
    }
    // sellables you hold
    const sell = sellable(kind);
    if (sell.length) {
      html += "<div style='font-size:12px;color:#9fb0c6;margin:8px 0 2px'>SELL — press <b style='color:#ff9e6b'>0</b> to sell all (" + fmt$(sellTotal(kind)) + ")</div>";
      // show what each lot fences for so a luxe piece's JACKPOT value is obvious.
      html += "<div style='font-size:12px;color:#aeb8c6'>" + sell.map((s) => {
        const ea = econ.sellPrice(s.name, kind);
        const meta = econ.ITEMS[s.name];
        const luxe = meta && meta.luxe;
        const tag = "<span style='color:" + (luxe ? "#ffd166" : "#7ed957") + "'>" + fmt$(ea) + (s.n > 1 ? "×" + s.n : "") + "</span>";
        return (luxe ? "" : "") + s.name + " " + tag;
      }).join(" · ") + "</div>";
    }
    // ROB THE TILL — every shop with a register (not banks/services-only) can be
    // stuck up for the cash drawer: fast money, but it spikes your wanted level.
    if (canRobTill(kind)) {
      // A TAKE IS A TRANSFER, so this reads the drawer's REAL balance right
      // now — not a per-kind constant. It is different at 09:00 and 23:00,
      // different uptown and in the projects, and zero once you have emptied
      // it. That difference is the whole reason to move through the world.
      const held = tillEstimate(openLot);
      const hits = CBZ.cityTill.hits(openLot);
      html += "<div style='font-size:12px;color:#ff7a7a;margin:10px 0 0;border-top:1px solid #2c3140;padding-top:6px'>" +
        "<b style='color:#ff9e6b'>[R]</b> Rob the till <span style='color:#7f8794'>(" +
        (held > 0 ? fmt$(held) + " in the drawer" : "drawer's empty right now") +
        ", and the heat that comes with it)</span>" +
        (hits >= 1 ? "<div style='color:#7f8794'>They've been hit before — the drawer's being dropped every " +
          Math.round(60 * (2 / (1 + hits))) + " min now.</div>" : "") + "</div>";
    }
    el().innerHTML = html;
  }

  // styling menus: the barber chair (swagger) and the clothing rack (whole
  // OUTFITS — identity/status fits from the canonical wardrobe when present)
  function styleMenu(kind) {
    if (kind === "barber") return HAIRCUTS;
    if (kind === "clothing") {
      // The WALK-IN store (clothingstore.js) is the sole buy path for cloth:
      // real racks + mannequins INSIDE the shop, no loose floating "for sale"
      // ghosts. When that store is live for this lot, retire the redundant
      // clerk text-sale entirely so there is ONE way to shop here. Keep the
      // legacy text rack ONLY as a fallback if the store never built (so the
      // clothing shop is never a dead room with nothing to buy).
      if (CBZ.cityClothingLive && CBZ.cityClothingLive(openLot)) return [];
      return outfitRack();
    }
    return [];
  }
  // letters for the style rows, SKIPPING service keys + the closet key so a
  // fit can never be shadowed by the job board (the old a..z mapping silently
  // ate any style whose letter doubled as a service key).
  function styleLetters(kind) {
    const used = {};
    for (const s of services(kind)) used[s.key] = true;
    const ck = closetKey(kind); if (ck) used[ck] = true;
    const list = styleMenu(kind), out = [];
    let c = 97;
    for (let i = 0; i < list.length && c < 123; i++) {
      while (used[String.fromCharCode(c)]) c++;
      if (c >= 123) break;
      out.push(String.fromCharCode(c)); c++;
    }
    return out;
  }

  function services(kind) {
    const s = [];
    if (kind === "hospital") s.push({ key: "h", label: "Heal $200", fn: healFull });
    if (kind === "bank") { s.push({ key: "d", label: "Deposit", fn: deposit }); s.push({ key: "w", label: "Withdraw $500", fn: withdraw }); }
    if (kind === "gas" && CBZ.player.driving) s.push({ key: "r", label: "Refuel", fn: () => CBZ.city.note("Tank filled.", 1.2) });
    if (kind === "gym") s.push({ key: "t", label: "Train $100", fn: train });
    if (kind === "carlot") s.push({ key: "c", label: "Buy $1,500", fn: buyCar });
    if (kind === "carlot") s.push({ key: "y", label: (g.cityCarBiz && g.cityCarBiz.open) ? "Yard" : "Open yard $2,000", fn: () => CBZ.cityOpenCarBiz && CBZ.cityOpenCarBiz() });
    if (kind === "realtor") s.push({ key: "h", label: "Homes", fn: () => CBZ.cityHomeMenu && CBZ.cityHomeMenu() });
    if (kind === "chop") s.push({ key: "c", label: "Sell car", fn: () => CBZ.city.note("Drive a (stolen) car into the chop bay out front to cash it out.", 2.4) });
    if (kind === "bank") s.push({ key: "p", label: "Bribe", fn: bribe });
    if (kind === "security") s.push({ key: "j", label: "Apply", fn: () => CBZ.cityStartCareer && CBZ.cityStartCareer("security") });
    if (kind === "drugs") s.push({ key: "j", label: "Deal", fn: () => CBZ.cityStartCareer && CBZ.cityStartCareer("dealer") });
    if (kind === "bar") s.push({ key: "j", label: "Run crew", fn: () => CBZ.cityStartCareer && CBZ.cityStartCareer("pimp") });
    // the OTHER half of the "drinks · run the night crew" verb: an actual round.
    // The bar has no SHOP_STOCK (so no BUY list) and the food heal path is gated
    // to kind==="food", so a drink would otherwise do nothing — give it a real,
    // kind-local effect here (mirrors the food heal+boost, sized for a quick one).
    // [K] is free at the bar: 'j'/'b' are taken, and the closet's [K] only ever
    // arms in a boutique (bar isn't one), so it can't collide.
    if (kind === "bar") s.push({ key: "k", label: "Round $12", fn: buyDrink });
    if (kind === "casino") s.push({ key: "g", label: "Bet", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Betting") });
    if (kind === "raceway") s.push({ key: "r", label: "Race", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Racing") });
    if (kind === "racepark") s.push({ key: "r", label: "Bet", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Racing") });
    if (kind === "arena" || kind === "gym") s.push({ key: "f", label: "Fight", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Combat") });
    if (kind === "paintball") s.push({ key: "p", label: "Paintball", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Combat") });
    if (kind === "transit") s.push({ key: "t", label: "Routes", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Transit") });
    if (kind === "cityhall") s.push({ key: "p", label: "Civic", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Civic") });
    if (kind === "airfield") s.push({ key: "w", label: "Contracts", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Emergency") });
    /* THE PHONE TIER IS DELETED (2026-07-29). It sold four upgrades for
       $250/$600/$950/$1300 promising "better deals & street intel" and
       `g.cityPhoneTier` was read by NOTHING in 264k lines except the four
       lines that sold it, capped it and printed it. That is CLAUDE.md's
       banned "stat fiction" in its purest form — and the shop row was its
       storefront, so the row goes with the flag. Killing the fiction without
       killing the counter that advertises it just hides the lie.
       The electronics shop keeps its real stock; it no longer sells nothing. */
    // jewelry: ICE OUT — buy the whole chain+ring+grill set at a bundle discount
    if (kind === "jewelry") s.push({ key: "u", label: "Ice out", fn: iceOut });
    // THE CIVIC DESKS (city/civic.js): the seven government trades
    // (courthouse/federal/library/cityannex/postoffice/dmv/firestation) keep
    // their service rows next to their own logic and splice in HERE, so this
    // chain never learns a civic kind. Keys are filtered against everything
    // already taken — the generic [B]jobs, the buy/haggle/rob letters and any
    // row above — so a drifting civic key can never shadow an existing verb.
    // Degrade-safe: no civic.js, no rows, this function is exactly as before.
    if (CBZ.civic && CBZ.civic.services) {
      const taken = { b: 1, x: 1, v: 1, r: 1, e: 1 };
      for (const r0 of s) taken[r0.key] = 1;
      for (const r of CBZ.civic.services(kind)) {
        if (!r || !r.key || taken[r.key]) continue;
        taken[r.key] = 1; s.push(r);
      }
    }
    // every shop offers the job board if careers exist
    if (CBZ.cityJobBoard) s.push({ key: "b", label: "Jobs", fn: () => CBZ.cityJobBoard() });
    return s;
  }

  function sellable(kind) {
    const inv = g.cityInv || {}, econ = CBZ.cityEcon, out = [];
    for (const k in inv) {
      const it = econ.ITEMS[k]; if (!it) continue;
      // don't offer to sell something you're currently WEARING (flex stays on)
      if ((kind === "jewelry" || kind === "pawn") && isWorn(k) && inv[k] <= 1) continue;
      // pawn buys anything; jewelry buys wearables; others buy their own tags
      const ok = kind === "pawn" || (kind === "jewelry" && it.tag === "wearable") ||
        (kind === "electronics" && it.tag === "valuable") || it.tag === "valuable";
      if (ok) out.push({ name: k, n: inv[k] });
    }
    return out;
  }
  function sellTotal(kind) { let t = 0; for (const s of sellable(kind)) t += CBZ.cityEcon.sellPrice(s.name, kind) * s.n; return t; }
  function sellAll(kind) {
    const econ = CBZ.cityEcon; let got = 0, n = 0;
    // track the single fattest fence in this batch so we can fire a JACKPOT
    // headline (vs. the quiet "sold N for $X" note) when you move a luxe piece.
    let jackpotItem = null, jackpotEach = 0;
    for (const s of sellable(kind)) {
      // never sell the last copy of something you're flexing
      let sellN = s.n; if (isWorn(s.name)) sellN = Math.max(0, s.n - 1);
      if (sellN <= 0) continue;
      const p = econ.sellPrice(s.name, kind); got += p * sellN; econ.take(s.name, sellN); n += sellN;
      if (p > jackpotEach) { jackpotEach = p; jackpotItem = s.name; }
      if (econ.bumpFenceRep && (s.name && (econ.ITEMS[s.name].tag === "valuable" || econ.ITEMS[s.name].tag === "wearable"))) econ.bumpFenceRep(sellN);
    }
    if (got > 0) {
      CBZ.city.addCash(got); if (CBZ.sfx) CBZ.sfx("coin");
      // JACKPOT FENCE: a single piece pawning for a real fortune gets a headline
      // — pawning a Patek/ring/bonds should FEEL like the score it is.
      if (jackpotItem && jackpotEach >= 50000 && CBZ.city.big) {
        CBZ.city.note(fmt$(jackpotEach) + " received — pawn sale: " + jackpotItem + ".", 2.4, { from: "Liberty Bank", app: "bank" });
        if (n > 1) CBZ.city.note("…plus the rest of the haul — " + fmt$(got) + " total.", 2);
      } else {
        CBZ.city.note("Sold " + n + " for " + fmt$(got), 1.8);
      }
    }
    else CBZ.city.note("Nothing to sell here.", 1.4);
    render();
  }

  // ---- buying (now supports a quantity multiplier + the shop discount) ------
  function buy(i) {
    const it = listItems[i]; if (!it) return;
    const econ = CBZ.cityEcon, meta = econ.ITEMS[it];
    // weapons/armor are single-buy (you can't carry a stack of the same gun
    // meaningfully); everything else respects the qty multiplier.
    const single = !!(meta.gun || meta.melee || meta.armor);
    const n = single ? 1 : qty;
    const each = unitPrice(it, n);
    const total = each * n;
    if (!CBZ.city.spend(total)) {
      CBZ.city.note("Can't afford " + (n > 1 ? n + "× " : "") + it + " (" + fmt$(total) + ")", 1.6);
      return;
    }
    // E7: Ironclad Arms books half of every player gun-store purchase as
    // real revenue (sim/corporations.js's creditRevenue) — a guns lot the
    // company doesn't even need to have claimed as an outlet.
    if (openLot.kind === "guns" && CBZ.corps && CBZ.corps.creditRevenue) CBZ.corps.creditRevenue("ironclad", total * 0.5);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (openLot.kind === "food" && meta.heal) {
      for (let k = 0; k < n; k++) { g.hunger = Math.min(100, (g.hunger || 0) + meta.heal); if (CBZ.player.hp != null && CBZ.player.maxHp) CBZ.player.hp = Math.min(CBZ.player.maxHp, CBZ.player.hp + Math.round(meta.heal * 0.4)); }
      if (meta.boost) CBZ.player._boost = 12;
      CBZ.city.note((n > 1 ? n + "× " : "Ate ") + it + " (+" + (meta.heal * n) + " food)", 1.6);
    }
    else if (meta.gun || meta.melee) { econ.add(it, 1); CBZ.cityGiveWeapon(it); }
    else if (meta.rounds) { CBZ.cityAddAmmo(meta.rounds * n); CBZ.city.note("+" + (meta.rounds * n) + " ammo", 1.4); }
    else if (meta.armor) { CBZ.player._armor = Math.min(100, (CBZ.player._armor || 0) + meta.armor); CBZ.city.note("Body Armor on (+" + meta.armor + ")", 1.6); }
    else if (meta.tag === "wearable") {
      // OWN it first (add to inventory), THEN wear it. A boutique/jewelry/barber
      // counter auto-EQUIPS the piece into its slot so it's WORN immediately and
      // counts toward your drip (the club gate). The drip preview becomes real.
      econ.add(it, n);
      if (isBoutique(openLot.kind)) equip(it);
      else CBZ.city.note("Bought " + (n > 1 ? n + "× " : "") + it, 1.4);
    }
    else { econ.add(it, n); CBZ.city.note("Bought " + (n > 1 ? n + "× " : "") + it, 1.4); }
    render();
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // Put a wearable you OWN onto your body via the shared outfit model
  // (CBZ.cityEquip → fills its slot, replacing whatever's there). Surfaces the
  // DRIP X → Y change and, when buying pushes you past the rope, calls it out so
  // the money→clothes→drip→club loop is felt. Respect is given ONCE per piece.
  function equip(name) {
    const meta = CBZ.cityEcon.ITEMS[name]; if (!meta || meta.tag !== "wearable") return;
    if (isWorn(name)) { CBZ.city.note("Already wearing " + name + ".", 1.4); return; }
    const before = playerDrip();
    const slot = slotOf(name);
    const replaced = slot ? wornInSlot(slot) : "";   // the old piece in this slot
    const ok = equipItem(name);                       // CBZ.cityEquip (guarded)
    if (!ok) {
      // economy.js outfit model absent — at least mark it as bought.
      CBZ.city.note("Bought " + name + ".", 1.4);
      return;
    }
    const after = playerDrip();
    // give respect ONCE per piece you first put on (don't re-reward re-equips)
    g.cityDripRewarded = g.cityDripRewarded || {};
    if (!g.cityDripRewarded[name] && meta.drip) { CBZ.city.addRespect(meta.drip); g.cityDripRewarded[name] = true; }
    const CLUB = (CBZ.CITY && CBZ.CITY.CLUB_DRIP) || 30, VIP = (CBZ.CITY && CBZ.CITY.VIP_DRIP) || 70;
    // crossing a threshold by buying this piece is a moment — headline it.
    if (before < CLUB && after >= CLUB && after < VIP && CBZ.city.big) {
      CBZ.city.big("That fit turns heads — the Velvet's rope would open for you.");
    } else if (before < VIP && after >= VIP && CBZ.city.big) {
      CBZ.city.big("✦ Dressed like money — the Velvet's elite lounge would wave you up.");
    } else {
      CBZ.city.note("Now wearing " + name + (replaced ? " (over " + replaced + ")" : "") + ".", 1.8);
    }
  }

  // ---- HAGGLING: one attempt per visit. Higher respect = better odds & cut.
  // Win → a discount on everything this visit; lose → clerk holds firm (small
  // chance they're insulted and the deal's slightly worse — risk, not free).
  function tryHaggle() {
    if (haggleTried) { CBZ.city.note("You already worked them. " + (haggle > 0 ? "Deal's −" + Math.round(haggle * 100) + "%." : "No discount this trip."), 1.6); return; }
    haggleTried = true;
    const rep = (g.respect || 0), swag = playerDrip();
    const odds = Math.min(0.85, 0.4 + rep / 800 + swag / 120);
    const roll = Math.random();
    if (roll < odds) {
      const cut = 0.05 + Math.random() * 0.13 + Math.min(0.05, swag / 300);
      haggle = Math.min(0.18, cut);
      if (CBZ.sfx) CBZ.sfx("coin");
      CBZ.city.note("Talked them down −" + Math.round(haggle * 100) + "% on the whole counter.", 2);
    } else if (roll > 0.93 && rep < 40) {
      haggle = 0;
      CBZ.city.note("The clerk's insulted — no deal today.", 1.8);
    } else {
      haggle = 0;
      CBZ.city.note("They won't budge on price.", 1.6);
    }
    render();
  }

  // ============================================================
  //  THE TILL LEDGER — A TAKE IS A TRANSFER, NOT A ROLL.   [CBZ.cityTill]
  // ------------------------------------------------------------
  //  OWNER, 2026-07-29: "i hate ransoms and robberies with dumb hardcoded
  //  limit — imagine what a dumb thing that is to reality".
  //
  //  What this file used to do: a per-kind magic constant, a district
  //  multiplier, a 0.7-1.3x roll, and CBZ.city.addCash — which MINTS the
  //  money. Rob the same bar ten times in a row and it paid ten times. A
  //  casino always had exactly $2,200 in it. The one honest line in the file
  //  was the corps.robOutlet() call: somebody already knew the answer,
  //  implemented it for one chain, and left the rest printing money.
  //
  //  THE LAW NOW: what you get is what the place ACTUALLY HAS at that
  //  moment; it comes OUT of a real balance; and the place is poorer
  //  afterwards until it earns it back. Rob the drawer and it is EMPTY —
  //  come back in ten minutes and there is nothing. The emptiness IS the
  //  cooldown; there is no timer.
  //
  //  WHERE THE MONEY COMES FROM (the non-minting close). sim/npcecon.js's
  //  hourly pass already DEDUCTS consumer spending from the cohort wallets
  //  (`row.wallet -= food+goods+ent+fuel+luxury+guns`) and publishes it as
  //  CBZ.npcEcon.lastSpend[district][category] — real dollars per game hour
  //  that have already left somebody. A register is simply WHERE THOSE
  //  DOLLARS PHYSICALLY SIT before they are banked. So a shop's takings are
  //  its SHARE of its own district's category spend:
  //
  //      flow($/hr) = lastSpend[dk][cat] · weight(lot) / Σ weight(dk, cat)
  //
  //  The sum of every till in the world therefore cannot exceed what the
  //  city actually spent. The money printer is closed by ARITHMETIC.
  //
  //  NOBODY TICKS. A till is not simulated per frame — it is INTEGRATED on
  //  demand from a trading curve, so a thousand shops cost nothing and only
  //  the drawer you are standing at is ever evaluated. Balance =
  //  flow × ∫curve from the last clear to now, and a robbery just moves the
  //  "last clear" mark. That is also what makes it byte-identical per seed.
  //
  //  THE LADDER (the gun-room gradient, applied to money — see CLAUDE.md's
  //  WHY CONSTITUTION, LAW 1): three cash points, same arithmetic, three
  //  clear cycles, each harder to reach than the last.
  //    register — the drawer. Cleared into the safe every ~2 h. Pocket money,
  //               and it is EMPTY at 4 a.m. because the shop was shut.
  //    safe     — the drop safe. Holds every drop since the deposit run
  //               (1-3 game days, per-lot hash). 6-18× the drawer.
  //    vault    — a bank branch / a casino count room. Weekly cycle.
  //
  //  CALIBRATION, so this is neither a printer nor pointless. The degrade
  //  path (no cohort sim yet) is anchored so that a shop at AVERAGE trade
  //  holds exactly what the old constant used to hold: TRADE_PER_M_HOUR was
  //  SOLVED from `TILL.food = 120` (see its comment). Nothing got richer on
  //  average — the money was REDISTRIBUTED across the clock and the map.
  //  What changed is that a busy uptown bar at 01:00 and a barber at dawn
  //  stopped being the same number, which is the entire point: that
  //  difference is a reason to move through the world.
  // ============================================================
  if (CBZ.CONFIG.TILL_IS_BALANCE == null) CBZ.CONFIG.TILL_IS_BALANCE = true;
  if (CBZ.CONFIG.TILL_SAFE_POINTS == null) CBZ.CONFIG.TILL_SAFE_POINTS = true;
  if (CBZ.CONFIG.TILL_HIT_MEMORY == null) CBZ.CONFIG.TILL_HIT_MEMORY = true;

  // LEGACY — the flat per-kind drawer. It is no longer the law: it survives
  // ONLY as (a) the membership test for "does this counter have a register at
  // all" and (b) the last-resort amount when neither the cohort sim nor the
  // catalog can answer. Flip TILL_IS_BALANCE off and this is the whole model
  // again, byte-for-byte.
  const TILL = {
    food: 120, gas: 160, electronics: 600, jewelry: 1400, clothing: 220,
    pawn: 400, hardware: 140, drugs: 500, gym: 90, barber: 70, bar: 350,
    casino: 2200, security: 300,
  };
  function canRobTill(kind) {
    // banks/realtors/services-only counters and vehicle lots don't have a
    // stick-up-able register here (banks are heists handled elsewhere).
    if (kind === "bank" || kind === "realtor" || kind === "carlot" || kind === "chop") return false;
    return TILL[kind] != null;
  }

  // ---- the clock: HOURS SINCE MIDNIGHT, monotonic, anchored on the sun ------
  // core/daynight.js runs a 150 s day (schedule.js's DAY_SECS mirrors it), so
  // real seconds → game hours is a constant.
  //
  // THIS USED TO BE `CBZ.now * T_HPS`, AND THAT WAS A REAL BUG — the one the
  // first gate run caught. `CBZ.now` is time since LOAD, which is the wrong
  // ORIGIN for a shop in two compounding ways:
  //   (1) the drop-cycle lattice (boundary(), below) was anchored at load
  //       time, so a freshly built world handed every register a window of
  //       "however long this session has been running" — six minutes on a
  //       headless gate — instead of a full drop cycle. Measured: the whole
  //       city's fattest drawer read $29 against a modelled $593.
  //   (2) a world that boots at 09:00 has ALREADY TRADED ALL MORNING. Its
  //       registers must hold the morning's takings the instant you arrive,
  //       exactly like the buildings are already standing when you get there.
  // So the ledger runs on a DAY clock: capture the sun's hour ONCE at first
  // use to fix the phase, then advance exactly with CBZ.now. Monotonic by
  // construction (no midnight-wrap logic to get wrong, no accumulating
  // drift), correct at t=0, and hour-of-day is just `% 24` — which also
  // removes the old per-call sunPhase() re-derivation that could disagree
  // with a stored clear mark as the two clocks drifted.
  const T_DAY_SECS = 150, T_HPS = 24 / T_DAY_SECS;
  let _t0 = -1, _n0 = 0;
  function absH() {
    const n = CBZ.now || 0;
    // first use, or a fresh run reset CBZ.now: re-anchor on the sky.
    if (_t0 < 0 || n < _n0) { _t0 = (CBZ.citySunHour ? CBZ.citySunHour() : 12); _n0 = n; }
    return _t0 + (n - _n0) * T_HPS;
  }
  // exposed so a world rebuild can re-anchor deliberately rather than by
  // waiting for CBZ.now to go backwards.
  function tillClockReset() { _t0 = -1; _n0 = 0; }

  // ---- the TRADING CURVE ---------------------------------------------------
  // Footfall through the day, per trade CLASS (never per kind — a new trade is
  // a row in TRADE below, never a new curve). Each class is a shutter window
  // plus gaussian humps; the humps are the real shape of retail footfall
  // (a lunch/dinner double for food, an after-work peak for shops, a late
  // peak for bars, commute humps for fuel). The window is what empties a
  // drawer overnight — no closing code, no "empty the till" pass: outside the
  // window the curve is ZERO, so the integral is zero, so the drawer is empty.
  const BINS = 96, BW = 24 / BINS;
  const CURVES = {
    retail: { win: [7, 21], base: 0.10, humps: [[12, 1.00, 2.6], [17, 1.15, 2.2]] },
    meal:   { win: [6, 23], base: 0.08, humps: [[8, 0.55, 1.0], [12.5, 1.35, 1.1], [19, 1.05, 1.4]] },
    night:  { win: [17, 4], base: 0.06, humps: [[22, 1.00, 2.0], [1.5, 1.25, 2.2]] },
    flow:   { win: [0, 24], base: 0.35, humps: [[8, 0.80, 1.2], [17.5, 0.90, 1.4]] },
  };
  const _cum = {};
  // cum[i] = ∫ curve dh from midnight to hour i·BW, normalised so a whole day
  // integrates to exactly 24 — i.e. the curve's mean is 1 and `flow` is
  // honestly "$ per AVERAGE trading hour".
  function curveTable(cls) {
    if (_cum[cls]) return _cum[cls];
    const spec = CURVES[cls] || CURVES.retail;
    const wo = spec.win[0], wc = spec.win[1];
    const open = (h) => (wo < wc ? (h >= wo && h < wc) : (h >= wo || h < wc));
    const v = new Array(BINS); let tot = 0;
    for (let i = 0; i < BINS; i++) {
      const h = (i + 0.5) * BW;
      if (!open(h)) { v[i] = 0; continue; }
      let y = spec.base;
      for (let j = 0; j < spec.humps.length; j++) {
        const hp = spec.humps[j];
        for (let k = -1; k <= 1; k++) {          // wrap the gaussian across midnight
          const d = (h + k * 24) - hp[0];
          y += hp[1] * Math.exp(-(d * d) / (2 * hp[2] * hp[2]));
        }
      }
      v[i] = y; tot += y;
    }
    const mean = tot / BINS;
    const cum = new Array(BINS + 1); cum[0] = 0;
    for (let i = 0; i < BINS; i++) cum[i + 1] = cum[i] + (mean > 0 ? v[i] / mean : 1) * BW;
    _cum[cls] = cum;
    return cum;
  }
  // ∫ of the trading curve between two ABSOLUTE game hours, in average-trading
  // hours. Exact across day boundaries (the daily integral is exactly 24, so
  // whole days are a multiply). Multiply by flow$/hr to get dollars.
  function curveInteg(cls, a0, a1) {
    if (!(a1 > a0)) return 0;
    if (a1 - a0 > 24 * 90) a0 = a1 - 24 * 90;   // numeric guard: a world left running for a season
    const cum = curveTable(cls);
    // absH() is already hours-since-midnight, so hour-of-day is a modulus and
    // no phase term is needed (nor wanted — see the clock's header).
    const F = function (a) {
      const d = Math.floor(a / 24), r = a - d * 24;
      const t = r / BW, i = Math.min(BINS - 1, Math.max(0, Math.floor(t)));
      return d * 24 + cum[i] + (cum[i + 1] - cum[i]) * (t - i);
    };
    return F(a1) - F(a0);
  }

  // ---- what a trade IS: its money category and its trading rhythm ----------
  // `cat` is the sim/npcecon.js spend category the dollars come out of; `cls`
  // is the curve. ADDING A TRADE IS A ROW.
  const TRADE = {
    food: { cat: "food", cls: "meal" },       bar: { cat: "food", cls: "night" },
    gas: { cat: "fuel", cls: "flow" },        drugs: { cat: "goods", cls: "night" },
    casino: { cat: "luxury", cls: "night" },  jewelry: { cat: "luxury", cls: "retail" },
    guns: { cat: "guns", cls: "retail" },     security: { cat: "guns", cls: "retail" },
    electronics: { cat: "goods", cls: "retail" }, clothing: { cat: "goods", cls: "retail" },
    hardware: { cat: "goods", cls: "retail" }, pawn: { cat: "goods", cls: "retail" },
    barber: { cat: "goods", cls: "retail" },  gym: { cat: "goods", cls: "retail" },
    chop: { cat: "goods", cls: "retail" },    carlot: { cat: "luxury", cls: "retail" },
    hospital: { cat: "goods", cls: "flow" },  bank: { cat: "goods", cls: "retail" },
    realtor: { cat: "goods", cls: "retail" },
  };

  // ---- THE TICKET: what one sale at this counter is worth ------------------
  // Real data, not a table: the mean LIVE price of the stock this trade
  // actually sells (cityEcon.stockFor + buyPrice, which already tracks
  // sim/market.js's category prices). Where the product is a SERVICE the
  // ticket is the price THIS FILE already charges for it — never a new
  // number. Cached with a stamp because it is used as a relative weight and
  // market drift mostly cancels in the ratio.
  let _tickT = -1e9; const _tick = {};
  function ticketOf(kind) {
    if (_sNow() - _tickT > 30) { for (const k in _tick) delete _tick[k]; _tickT = _sNow(); }
    if (_tick[kind] != null) return _tick[kind];
    const E = CBZ.cityEcon;
    let t = 0;
    if (E && E.stockFor && E.buyPrice) {
      const list = E.stockFor(kind) || [];
      let s = 0, n = 0;
      for (let i = 0; i < list.length; i++) { const p = E.buyPrice(list[i]) || 0; if (p > 0) { s += p; n++; } }
      if (n) t = s / n;
    }
    if (!(t > 0)) {
      // service counters, priced off what this game already charges:
      if (kind === "barber") { let s = 0; for (const h of HAIRCUTS) s += h.cost; t = s / HAIRCUTS.length; }   // = $45.7
      else if (kind === "gym") t = 100;               // train()
      else if (kind === "hospital") t = 200;          // healFull()
      // a bar is a marked-up drink: the mark-up IS the trade (≈3× off-licence).
      else if (kind === "bar") t = (E && E.buyPrice ? E.buyPrice("Soda") : 3) * 3;
      else if (kind === "casino") t = 40;             // an average hand/spin at the felt
    }
    if (!(t > 0)) t = 25;                             // a counter with no catalog at all
    _tick[kind] = t;
    return t;
  }

  // CASH SHARE — the fraction of this trade's takings that is physically in a
  // drawer rather than on a card. Real payments data: cash is ~40-50% of
  // small-ticket food/bar/street trade, ~20-25% of general retail and
  // effectively nil on big-ticket goods (a $6,000 watch is a card). It falls
  // out of the TICKET, so it is one curve and not thirteen numbers:
  //      cashShare = 0.55 / (1 + ticket/40)
  //      $8 → 0.46   ·   $46 → 0.26   ·   $600 → 0.034   ·   $2500 → 0.009
  // This is why a diner's drawer beats a jeweller's drawer while the
  // jeweller's CASE is the real score — and why the game did not need to be
  // told that separately: jewelry.js's cases already hold the real items.
  function cashShare(ticket) { return 0.55 / (1 + Math.max(0, ticket) / 40); }

  function tillDistrict(lot) {
    if (lot._tillDk) return lot._tillDk;
    const E = CBZ.cityEcon;
    const dk = (E && E.districtAt) ? E.districtAt(lot.cx || 0, lot.cz || 0) : "downtown";
    return (lot._tillDk = dk || "downtown");
  }
  // throughput scales with COUNTER LENGTH, and counter length with the square
  // root of floor area for a similarly-shaped shop.
  function frontage(lot) { return Math.sqrt(Math.max(9, (lot.w || 12) * (lot.d || 12))); }
  // How big a slice of ONE trade this particular premises is. Only ever
  // compared against other shops of the SAME kind (the casino cage's share of
  // the house's win), because frontage × ticket is not commensurable across
  // trades — see the capacity note in buildDemand() for what that cost.
  function tradeWeight(lot) {
    const T = TRADE[lot.kind]; if (!T) return 0;
    return frontage(lot) * ticketOf(lot.kind);
  }

  // ---- WHAT THE COHORT SIM ACTUALLY KNOWS ----------------------------------
  // The first gate run on a live world proved this half was wrong, and the
  // reason is a UNITS mistake worth stating plainly so it is never repeated:
  //
  //   sim/npcecon.js's cohort rows are seeded from CBZ.cityPopulation().alive,
  //   which peds.js builds as `CITY.peds + CITY.crowd + 200` — the number of
  //   BODIES THE ENGINE RENDERS (1,000), not a city's headcount. Meanwhile
  //   `denom` sums every shop the GENERATOR built, and the generator authors a
  //   city's worth of storefronts. Dividing a 1,000-person sample's spend
  //   across a whole city's shops gives each one a fraction of the truth, and
  //   because `S > 0` won unconditionally the poorer path took over the
  //   instant npcecon ticked once.
  //
  // Scaling S by a population factor would work but requires GUESSING the
  // real headcount, and any error in that guess lands straight on the money.
  // So: use each half for the thing it actually measures.
  //
  //   THE COUNTER'S OWN PHYSICS KNOWS THE SCALE  (calibrated to TILL.food=120)
  //   THE COHORT SIM KNOWS THE SHAPE             (which district and which
  //                                               trade the money is going to)
  //
  // leanOf(dk) is a LOCATION QUOTIENT — this district's share of the city's
  // consumer spend divided by its share of the city's retail capacity:
  //
  //      lean = (S_d / ΣS) / (P_d / ΣP)
  //
  // It is DIMENSIONLESS, so the sample-vs-city population problem cancels out
  // entirely and can never come back. And it is provably neutral: weighting
  // each district by its own capacity share gives
  // Σ (P_d/ΣP)·lean_d = Σ S_d/ΣS = 1 EXACTLY, so the citywide mean multiplier
  // is 1.00, the calibration to the shipped constant survives untouched, and
  // every district gets a real, sim-driven lean.
  //
  // TWO CHOICES HERE ARE LOAD-BEARING AND BOTH WERE MISTAKES ON THE FIRST
  // ATTEMPT — a harness that finally exercised this branch caught them:
  //
  //  • THE CAPACITY MEASURE IS THE GROSS TRADE FLOW, NOT `tradeWeight`.
  //    tradeWeight is frontage × TICKET, which is a fine splitter WITHIN a
  //    category (comparable prices) and meaningless ACROSS one: a jeweller
  //    weighs ~800× a diner purely because a Rolex costs more than a burger,
  //    so it swallowed the whole normaliser and threw every other quotient
  //    into the hundreds. grossOf() is dollars-per-hour of trade — the same
  //    unit on both sides of the ratio, which is what makes it a quotient at
  //    all. It is also compared GROSS to GROSS: `S` is total spend, so the
  //    cash share must be applied AFTER, once, or the index would shove cash
  //    into a jeweller's drawer precisely where cash does not go.
  //
  //  • IT IS PER-DISTRICT, NOT PER-CATEGORY. The cohort sim genuinely knows
  //    how much money a district has right now — that is the whole
  //    circulation chain, and it is what makes robbery bite. It does NOT
  //    reliably know the category mix, because npcecon's propensity table and
  //    the shop generator's kind distribution were authored years apart and
  //    never reconciled: a per-category index reads the DISAGREEMENT between
  //    two tables as if it were demand. Category is left entirely to the
  //    physics, which actually knows about it (ticket → basket size →
  //    cashShare). Districts hold a broad mix of shops, so this index is
  //    stable near 1.
  //
  // The circulation chain VI.4 asked for still works, which is the whole
  // reason the cohort seam exists: strip-mine a district → its cohort wallets
  // fall → its S falls → its lean falls → its tills genuinely hold less.
  // Now it works at ANY population scale.
  let _dmT = -1e9, _dm = null, _dmHi = 0, _dmLo = 0;
  function buildDemand() {
    if (_dm && _sNow() - _dmT <= 20) return;
    _dmT = _sNow(); _dm = null; _dmHi = 0; _dmLo = 0;
    const NE = CBZ.npcEcon, LS = NE && NE.lastSpend;
    if (!LS) return;                                  // no cohort sim → pure physics
    const A = CBZ.city && CBZ.city.arena, lots = (A && A.shopLots) || [];
    // capacity per district, in dollars of gross trade per average hour
    const P = {}; let pAll = 0;
    for (let i = 0; i < lots.length; i++) {
      const L = lots[i];
      if (!L || L.demolished || !L.kind || !TRADE[L.kind]) continue;
      const d = tillDistrict(L), gr = grossOf(L);
      P[d] = (P[d] || 0) + gr; pAll += gr;
    }
    if (!(pAll > 0)) return;
    // Sum S over EXACTLY the districts that have shops, so the neutrality
    // proof holds: money in a district with nowhere to spend it must not leak
    // into the normaliser. Categories with no shop anywhere are excluded for
    // the same reason.
    const cats = {};
    for (let i = 0; i < lots.length; i++) {
      const L = lots[i];
      if (!L || L.demolished || !L.kind || !TRADE[L.kind]) continue;
      cats[TRADE[L.kind].cat] = 1;
    }
    const S = {}; let sAll = 0;
    for (const dk in P) {
      const sp = LS[dk]; if (!sp) continue;
      let s = 0; for (const cat in cats) s += (sp[cat] || 0);
      S[dk] = s; sAll += s;
    }
    if (!(sAll > 0)) return;
    const out = {};
    for (const dk in P) {
      // a district the sim has nothing to say about keeps the physics answer
      const q = S[dk] > 0 ? (S[dk] / sAll) / (P[dk] / pAll) : 1;
      out[dk] = q;
      if (q > _dmHi) _dmHi = q;
      if (_dmLo === 0 || q < _dmLo) _dmLo = q;
    }
    _dm = out;
  }
  function demandOf(dk) {
    buildDemand();
    if (!_dm) return 0;                               // 0 == "the sim isn't answering"
    const q = _dm[dk];
    return q > 0 ? q : 1;
  }

  // TRADE_PER_M_HOUR — the ONE seeded number in the degrade path, and it is
  // SOLVED, not tasted. Requirement: with no cohort sim running, a food shop
  // at AVERAGE trade must hold exactly what the shipped constant held, so
  // this change redistributes money across the clock and the map without
  // inflating it. Working: TILL.food = 120 in a drawer dropped every DROP_H =
  // 2 h ⇒ flow_cash = 60 $/h. cashShare($8 diner ticket) = 0.458 ⇒ flow =
  // 131 $/h. Customers fall as the ticket rises (revenue per m² is far more
  // uniform across trades than ticket size is), so customers ∝ √(REF/ticket)
  // and flow = K·frontage·√(REF·ticket) with REF = $20, an ordinary retail
  // basket in this catalog. A typical 18×14 shop has frontage √252 = 15.9 m,
  // so K = 131 / (15.9·√160) = 0.65 customers per metre of counter per
  // average trading hour — about 10 an hour for that shop. Honest, and
  // deliberately the LOW end, so the cohort-fed path above is the richer one.
  const TRADE_PER_M_HOUR = 0.65, TICKET_REF = 20;
  // flowOf(lot) -> DOLLARS OF CASH per average trading hour that land in this
  // place's drawer. Prefers the real cohort spend; degrades to the physics of
  // the counter itself.
  // grossOf(lot) -> DOLLARS OF TRADE per average trading hour, cash and card
  // together. THE SCALE, and the only place TRADE_PER_M_HOUR is used — K was
  // solved from the shipped TILL.food = 120 (see its comment), so this is the
  // number that keeps the whole change a redistribution rather than an
  // inflation. It must never consult demandOf(): buildDemand() sums it.
  function grossOf(lot) {
    if (!lot || !TRADE[lot.kind]) return 0;
    const dk = tillDistrict(lot), tk = ticketOf(lot.kind);
    const E = CBZ.cityEcon;
    const tier = (E && E.DISTRICTS && E.DISTRICTS[dk]) ? (E.DISTRICTS[dk].tier || 1) : 1;
    return frontage(lot) * TRADE_PER_M_HOUR * Math.sqrt(TICKET_REF * tk) * tier;
  }
  // flowOf(lot) -> DOLLARS OF CASH per average trading hour that land in this
  // place's drawer. gross trade × where the city's money actually is × the
  // fraction of this trade that is paid in notes.
  function flowOf(lot) {
    if (!lot || !TRADE[lot.kind]) return 0;
    // THE SHAPE: neutral (capacity-weighted mean exactly 1.00) across the
    // world, so it bends the map without moving the total. 0 means the cohort
    // sim has not run yet — pure physics.
    const q = demandOf(tillDistrict(lot));
    return grossOf(lot) * (q > 0 ? q : 1) * cashShare(ticketOf(lot.kind));
  }
  CBZ.cityTillFlow = flowOf;

  // ---- the cash points -----------------------------------------------------
  const DROP_H = 2;            // a keeper drops the drawer into the safe ~2-hourly
  const HIT_FADE_DAYS = 3;     // how long a shop remembers being stuck up
  // `reg`/`safe`/`vault` are NULL until somebody actually empties that point.
  // They used to initialise to 0, which reads as "this drawer was emptied at
  // hour zero" and truncated every untouched shop's window — the second half
  // of the boot bug. A shop nobody has robbed is governed by its scheduled
  // clear alone, which is what makes a world you just arrived in already hold
  // the morning's takings.
  function cashState(lot) {
    return lot._cash || (lot._cash = { reg: null, regTook: 0, regMark: -1, safe: null, safeTook: 0, safeMark: -1,
                                       vault: null, vaultTook: 0, vaultMark: -1, hits: 0, hitAt: -1e9 });
  }
  // THE ANTI-FARM RULE, AND IT IS A REAL RETAIL BEHAVIOUR, NOT A COOLDOWN:
  // a shop that has just been robbed starts dropping the drawer more often
  // ("clerk cannot open safe"). Rob it three times and the register holds a
  // quarter as much — so the same target genuinely degrades and you MOVE.
  // It fades over HIT_FADE_DAYS, and the shop card SAYS it is happening, so
  // it is a visible consequence and not a hidden nerf.
  function hitsNow(lot) {
    if (!CBZ.CONFIG.TILL_HIT_MEMORY) return 0;
    const s = cashState(lot);
    if (!(s.hits > 0)) return 0;
    const age = absH() - s.hitAt;
    const f = 1 - age / (24 * HIT_FADE_DAYS);
    return f > 0 ? s.hits * f : 0;
  }
  function dropHours(lot) { return DROP_H / (1 + hitsNow(lot)); }
  // the deposit run: 1-3 game days, DETERMINISTIC per lot (world data → hash,
  // never Math.random), with its own phase so the whole city does not bank at
  // the same minute. The safe is fattest right before the pickup — that is a
  // thing you can learn about a place, which is the point.
  function bankHours(lot) {
    const h = CBZ.hash01 ? CBZ.hash01(lot.cx || 0, lot.cz || 0, "tillbank") : 0.5;
    return 24 * (1 + Math.floor(h * 3));
  }
  function lotPhase(lot, salt) {
    return (CBZ.hash01 ? CBZ.hash01(lot.cx || 0, lot.cz || 0, salt) : 0.5);
  }
  // most recent scheduled boundary of a cycle, in absolute game hours
  function boundary(now, period, phase) {
    const off = phase * period;
    return Math.floor((now - off) / period) * period + off;
  }
  // window start for a point: the later of its scheduled clear and the last
  // time somebody emptied it.
  function windowStart(lot, pt, now) {
    const s = cashState(lot);
    let robbed = pt === "register" ? s.reg : pt === "safe" ? s.safe : s.vault;
    // A MARK IN THE FUTURE IS NONSENSE, AND IT IS PERMANENTLY FATAL: the
    // window would be empty forever and that till would never trade again.
    // The only way to get one is the day clock re-anchoring under us (a world
    // rebuild, a loaded save, a fresh run resetting CBZ.now), so treat it as
    // never-robbed rather than trusting a stale reading.
    if (robbed != null && robbed > now) robbed = null;
    const sched = pt === "register" ? boundary(now, dropHours(lot), lotPhase(lot, "tilldrop"))
                : pt === "safe" ? boundary(now, bankHours(lot), lotPhase(lot, "tillbankph"))
                : boundary(now, 24 * 7, lotPhase(lot, "tillvault"));
    return robbed == null ? sched : Math.max(robbed, sched);
  }
  // which cash points does this place have?
  function pointsOf(lot) {
    if (!lot) return [];
    if (lot._tillSpec) return [lot._tillSpec.point || "vault"];
    // a demolished storefront is not a business: no trade, no drawer, no safe.
    if (lot.demolished) return [];
    const k = lot.kind;
    if (k === "bank") return ["vault"];
    if (!canRobTill(k)) return [];
    if (!CBZ.CONFIG.TILL_SAFE_POINTS) return ["register"];
    return k === "casino" ? ["register", "safe", "vault"] : ["register", "safe"];
  }

  // A place that is NOT a shop lot: a truck, a stash, a cage. ONE call and it
  // is a first-class take source — holds/take/deplete all work on it and the
  // audit sees it. `amount` may be a number OR a function reading a balance
  // SOMEBODY ELSE owns; pass `drain` alongside it and the take is written
  // back to THEM, so this never keeps a mirror of another module's money
  // (the parallel-bookkeeping trap that killed proptypes.js).
  function declare(src, spec) {
    if (!src || !spec) return src;
    src._tillSpec = {
      name: spec.name || "stash", kind: spec.kind || "stash", point: spec.point || "vault",
      amount: spec.amount, of: spec.of, drain: spec.drain,
      depletes: spec.depletes !== false,
    };
    if (typeof spec.amount === "number") src._tillBal = Math.max(0, spec.amount);
    _audit.declared++;
    return src;
  }
  function specHolds(src) {
    const sp = src._tillSpec;
    let amt = 0;
    if (typeof sp.amount === "function") { try { amt = sp.amount(src) || 0; } catch (e) { amt = 0; } }
    else amt = src._tillBal || 0;
    return Math.max(0, amt);
  }

  const PT_NAME = { register: "the register", safe: "the safe", vault: "the vault" };
  // holds(src, opts) -> what this source ACTUALLY has right now. Never capped
  // by a constant. opts.point picks a cash point ("register" by default, or
  // "best" for the fattest one this place has).
  function holds(src, opts) {
    opts = opts || {};
    const out = { amount: 0, kind: "", name: "", why: "", depletes: true, point: "", of: 0 };
    if (!src) { out.why = "nothing there"; return out; }
    if (src._tillSpec) {
      const sp = src._tillSpec;
      out.kind = sp.kind; out.name = sp.name; out.point = sp.point;
      out.depletes = sp.depletes;
      out.amount = out.of = Math.round(specHolds(src));
      if (!(out.amount > 0)) out.why = "already emptied";
      return out;
    }
    const pts = pointsOf(src);
    if (!pts.length) { out.why = "no cash point here"; return out; }
    let pt = opts.point || "register";
    if (pt === "best" || pts.indexOf(pt) < 0) {
      let best = pts[0], bv = -1;
      for (let i = 0; i < pts.length; i++) { const v = holds(src, { point: pts[i] }).amount; if (v > bv) { bv = v; best = pts[i]; } }
      pt = best;
    }
    out.point = pt;
    out.kind = src.kind || "";
    out.name = (src.building && src.building.name) || PT_NAME[pt];
    if (!CBZ.CONFIG.TILL_IS_BALANCE) {
      // FLAG OFF: the shipped constant, byte-for-byte (district multiplier
      // and all) — one line back to the old world.
      const base = TILL[src.kind] || 100;
      const E = CBZ.cityEcon; let mul = 1;
      if (E && E.playerDistrict) { const dk = E.playerDistrict(); mul = (dk === "uptown" || dk === "island") ? 1.4 : (dk === "projects" ? 0.75 : 1); }
      out.amount = out.of = Math.round(base * mul);
      return out;
    }
    const T = TRADE[src.kind];
    const now = absH(), flow = flowOf(src), s = cashState(src);
    let hrs = 0;
    if (pt === "register") {
      hrs = curveInteg(T ? T.cls : "retail", windowStart(src, "register", now), now);
    } else if (pt === "safe") {
      // the safe holds what has DROPPED since the deposit run — never what is
      // still sitting in the drawer, so the two can't double-count.
      const to = boundary(now, dropHours(src), lotPhase(src, "tilldrop"));
      hrs = curveInteg(T ? T.cls : "retail", windowStart(src, "safe", now), to);
    } else {
      hrs = curveInteg("retail", windowStart(src, "vault", now), now);
    }
    let amt = flow * Math.max(0, hrs);
    if (pt === "vault") amt = vaultAmount(src, hrs, amt);
    // a take already made against THIS window comes off before we answer
    const key = pt === "register" ? "regTook" : pt === "safe" ? "safeTook" : "vaultTook";
    const mk = pt === "register" ? "regMark" : pt === "safe" ? "safeMark" : "vaultMark";
    const ws = windowStart(src, pt, now);
    if (s[mk] !== ws) { s[key] = 0; s[mk] = ws; }
    out.of = Math.round(amt);
    out.amount = Math.max(0, Math.round(amt - s[key]));
    if (!(out.amount > 0)) {
      out.why = (src.kind && shopShutSoft(src)) ? "shut — the drawer's dropped for the night" : "already emptied";
    }
    return out;
  }
  // shops.js's shopShut() is declared later in the file (registry section);
  // this is the guarded early read so `holds` can explain an empty drawer.
  function shopShutSoft(lot) { try { return shopShut(lot); } catch (e) { return false; } }

  // A BANK BRANCH holds the district's banked business cash. Derived, not
  // typed: it is the sum of what every shop in the district drops into its
  // safe, split across the branches serving that district, over a weekly
  // pickup cycle. Sanity: ~20 shops × ~$60/h cash × 24 h × 7 d ≈ $200k for a
  // single branch — which lands inside heists.js's own researched
  // $120k-$250k vault band. The research validates the derivation; it is no
  // longer the source of the number.
  function vaultAmount(lot, hrs, fallback) {
    if (lot.kind !== "bank" && lot.kind !== "casino") return fallback;
    const A = CBZ.city && CBZ.city.arena, lots = (A && A.shopLots) || [];
    const dk = tillDistrict(lot);
    if (lot.kind === "casino") {
      // THE CAGE / COUNT ROOM is the money players actually lost in this city:
      // sim/npcecon.js banks every cohort's entertainment spend into entPool,
      // and this casino's share of it is physically in the house.
      const NE = CBZ.npcEcon;
      const pool = (NE && NE.entPool) ? NE.entPool() : 0;
      if (pool > 0) {
        let mine = 0, all = 0;
        for (let i = 0; i < lots.length; i++) { const L = lots[i]; if (!L || L.kind !== "casino" || L.demolished) continue; const w = tradeWeight(L); all += w; if (L === lot) mine = w; }
        if (all > 0) return pool * (mine / all);
      }
      return fallback;
    }
    const dc = districtCash(dk);
    if (!(dc.cash > 0)) return fallback;
    return dc.cash * Math.max(0, hrs) / Math.max(1, dc.branches);
  }
  // districtCash(dk) -> {cash: $/hr of PHYSICAL CASH the businesses in this
  // district take in, branches: how many bank branches serve it}. The one
  // answer to "how much money is moving through this part of town", and the
  // reason a bank vault, an armored truck's load and a district's fatness are
  // three readings of one number instead of three tables.
  let _dcT = -1e9, _dc = {};
  function districtCash(dk) {
    if (_sNow() - _dcT > 20) { _dc = {}; _dcT = _sNow(); }
    if (_dc[dk]) return _dc[dk];
    const A = CBZ.city && CBZ.city.arena, lots = (A && A.shopLots) || [];
    let cash = 0, branches = 0;
    for (let i = 0; i < lots.length; i++) {
      const L = lots[i]; if (!L || L.demolished || !L.kind) continue;
      if (tillDistrict(L) !== dk) continue;
      if (L.kind === "bank") { branches++; continue; }
      cash += flowOf(L);
    }
    return (_dc[dk] = { cash: cash, branches: branches });
  }

  // THE BUSINESS IS POORER. corps.robOutlet was already the one honest line in
  // this file; it now runs for EVERY take, alongside the NPC company that
  // actually owns the lot (city/companies.js's co.cash — the number the phone
  // and the leaderboards already display).
  function books(src, amt, point) {
    if (!(amt > 0) || !src || src._tillSpec) return;
    try { if (CBZ.corps && CBZ.corps.robOutlet) CBZ.corps.robOutlet(src, amt); } catch (e) {}
    try { if (CBZ.cityCompanyRob) CBZ.cityCompanyRob(src, amt); } catch (e) {}
    // THE CAGE IS THE HOUSE'S WIN. sim/npcecon.js banks every cohort's
    // entertainment spend into entPool and vaultAmount() reads this casino's
    // share of it — so taking the count room has to DRAIN the same pool, or
    // the cage would refill itself out of nothing. drainEntPool is the
    // module's own existing writer; we keep no copy of the number.
    if (point === "vault" && src.kind === "casino") {
      try { if (CBZ.npcEcon && CBZ.npcEcon.drainEntPool) CBZ.npcEcon.drainEntPool(amt); } catch (e) {}
    }
  }

  const _audit = { takes: 0, taken: 0, minted: 0, deniedEmpty: 0, declared: 0, legacyFlat: 0 };
  // take(src, opts) -> MOVE money out of a real balance and report what
  // actually moved. It NEVER pays the player: the caller owns where the money
  // goes (a wallet, a loot pile, a mission bag, a crew cut), which is why this
  // is not a 53rd transaction path.
  //   opts: {point, max, frac, dryRun, by}
  function take(src, opts) {
    opts = opts || {};
    const h = holds(src, opts);
    const res = { taken: 0, of: h.of, kind: h.kind, name: h.name, point: h.point, emptied: false, why: h.why };
    let want = h.amount;
    if (opts.frac > 0) want = h.amount * Math.min(1, opts.frac);
    if (opts.max > 0) want = Math.min(want, opts.max);
    want = Math.floor(want);
    if (!(want > 0)) { _audit.deniedEmpty++; res.why = res.why || "empty"; return res; }
    if (opts.dryRun) { res.taken = want; res.emptied = want >= h.amount; return res; }
    // the money-printer detector: with TILL_IS_BALANCE off, `holds` answers
    // from the old flat constant and there is no balance behind the dollars.
    // That is exactly what `minted` counts, and it is pinned at 0.
    if (!CBZ.CONFIG.TILL_IS_BALANCE && !src._tillSpec) _audit.minted++;
    if (src._tillSpec) {
      const sp = src._tillSpec;
      if (typeof sp.drain === "function") { try { sp.drain(want, src); } catch (e) {} }
      else src._tillBal = Math.max(0, (src._tillBal || 0) - want);
    } else {
      const s = cashState(src), now = absH();
      const key = h.point === "register" ? "regTook" : h.point === "safe" ? "safeTook" : "vaultTook";
      const mk = h.point === "register" ? "regMark" : h.point === "safe" ? "safeMark" : "vaultMark";
      if (want >= h.amount || opts.rob) {
        // ROB IT AND IT IS EMPTY. A stick-up clears the point outright even if
        // a resisting clerk only let you reach half of it — what you did not
        // grab, the shop secures the instant you run, and the business is
        // billed only for what actually left with you. That is the owner's
        // rule stated literally, and it is why there is no cooldown anywhere
        // in this file: the emptiness IS the cooldown.
        //
        // The clear mark moves to NOW, so the balance restarts from zero and
        // refills at the rate this place really trades. The partial-take
        // counter MUST be zeroed in the same breath — the integral now starts
        // at `now`, so a stale `regTook` would be subtracted from a fresh
        // window and the drawer would read $0 forever; the shop would never
        // come back.
        s[h.point === "register" ? "reg" : h.point === "safe" ? "safe" : "vault"] = now;
        s[key] = 0; s[mk] = now;
      } else {
        // A NON-HOSTILE PARTIAL TAKE (a wage out of the drawer) leaves the
        // window alone and just remembers what has come out of it, so it is
        // exactly conservative.
        s[key] = (s[key] || 0) + want;
      }
      // THE SHOP ONLY REMEMBERS BEING ROBBED. `opts.rob` is what arms the
      // drop-more-often response, so collecting a wage out of the same drawer
      // does not make the keeper start banking hourly — and, because
      // shortening the drop cycle moves the drawer's window (the money is
      // still in the world, it is just in the SAFE now), a non-hostile take
      // is also exactly conservative on the register.
      if (opts.rob && (h.point === "register" || h.point === "safe")) { s.hits = Math.min(6, hitsNow(src) + 1); s.hitAt = now; }
      books(src, want, h.point);
    }
    _audit.takes++; _audit.taken += want;
    res.taken = want; res.emptied = want >= h.amount;
    return res;
  }
  function deplete(src, amount, opts) { return take(src, Object.assign({}, opts || {}, { max: amount })); }

  // tillEstimate(kindOrLot) — kept at its ORIGINAL name and call shape so the
  // ~4 label sites in this file need no rewrite, but it now answers about a
  // PLACE when it is given one. A bare kind (no lot) can only be answered by
  // the legacy flat table, and every such answer is counted by the ratchet.
  function tillEstimate(kindOrLot) {
    if (kindOrLot && typeof kindOrLot === "object") return holds(kindOrLot, { point: "register" }).amount;
    _audit.legacyFlat++;
    const base = TILL[kindOrLot] || 100;
    const E = CBZ.cityEcon; let mul = 1;
    if (E && E.playerDistrict) { const dk = E.playerDistrict(); mul = (dk === "uptown" || dk === "island") ? 1.4 : (dk === "projects" ? 0.75 : 1); }
    return Math.round(base * mul);
  }

  CBZ.cityTill = {
    holds: holds, take: take, deplete: deplete, declare: declare,
    points: pointsOf, flow: flowOf, hits: hitsNow, districtCash: districtCash,
    districtOf: tillDistrict, demand: demandOf, clockReset: tillClockReset,
    now: absH,
    // "when does this place next get cleared out on its own", in game hours —
    // exposed so a UI can say "bank run in 6 h" instead of inventing a timer.
    nextClear: function (lot, pt) {
      if (!lot || lot._tillSpec) return 0;
      const now = absH();
      const per = pt === "safe" ? bankHours(lot) : pt === "vault" ? 24 * 7 : dropHours(lot);
      const ph = lotPhase(lot, pt === "safe" ? "tillbankph" : pt === "vault" ? "tillvault" : "tilldrop");
      return boundary(now, per, ph) + per - now;
    },
  };
  // RATCHET. `minted` is the money-printer detector and is PINNED AT 0: it
  // counts dollars handed out that came from no balance at all (structurally
  // only reachable with TILL_IS_BALANCE off). `legacyFlat` counts answers
  // still produced by the old per-kind constant and may only ever go DOWN —
  // it is 0 in shipped code because every call site now passes a place.
  // `points`, `spread` and `flowSource` are printed BESIDE them so a "fix"
  // that simply stops answering cannot pass: `spread` is the ratio of the
  // fattest to the leanest live register in the world, and a world where
  // every till is the same number reads 1.
  CBZ.cityTillAudit = function () {
    const A = CBZ.city && CBZ.city.arena, lots = (A && A.shopLots) || [];
    let points = 0, hi = 0, live = 0, sim = 0, sum = 0, nonzero = 0;
    for (let i = 0; i < lots.length; i++) {
      const L = lots[i]; if (!L) continue;
      const pts = pointsOf(L); points += pts.length;
      if (pts.indexOf("register") < 0) continue;
      const v = holds(L, { point: "register" }).amount;
      live++; if (v > hi) hi = v;
      if (v > 0) { nonzero++; sum += v; }
      const NE = CBZ.npcEcon, LS = NE && NE.lastSpend;
      if (LS && LS[tillDistrict(L)]) sim++;
    }
    const mean = nonzero > 0 ? sum / nonzero : 0;
    return {
      takes: _audit.takes, taken: Math.round(_audit.taken), minted: _audit.minted,
      deniedEmpty: _audit.deniedEmpty, declared: _audit.declared,
      legacyFlat: _audit.legacyFlat, points: points, registers: live,
      // the fattest live drawer in the world against the mean of the drawers
      // that have anything in them, plus how many are empty right now. A
      // world of identical constants reads spread 1.0 and empty 0; a world
      // with a real clock and a real map does not.
      hi: hi, mean: Math.round(mean), empty: live - nonzero,
      spread: mean > 0 ? +(hi / mean).toFixed(2) : 0,
      // "sim" once sim/npcecon.js has run an hour and the cohort spend is
      // answering; "derived" while the counter's own physics is.
      flowSource: live === 0 ? "none" : (sim >= live ? "sim" : sim > 0 ? "mixed" : "derived"),
      // THE RECONCILIATION, AS A NUMBER. `pathRatio` is the shop-weighted mean
      // of the cohort demand index over the whole world, and the derivation
      // makes it EXACTLY 1.00 — that is the proof the sim half bends the map
      // without moving the total, so the calibration to the shipped constant
      // still holds. **PIN pathRatio AT 1.00 (± 0.01).** If it drifts, the
      // two halves have started disagreeing about scale again, which is the
      // exact fault the first gate run caught.
      pathRatio: pathRatio(),
      // how hard the sim is leaning: the fattest and leanest district+category
      // demand in the world. 1/1 means the sim has nothing to say (or has not
      // ticked). A wide band is a REAL gradient — an under-shopped rich
      // quarter should be fat — so these are reported, never pinned.
      demandHi: +(_dmHi || 0).toFixed(2), demandLo: +(_dmLo || 0).toFixed(2),
      // the ledger's day clock, so a gate can say WHICH HOUR it measured at.
      // A $6 mean at 04:30 is correct; a $6 mean at 13:00 is a bug.
      hour: +(absH() % 24).toFixed(2),
    };
  };
  // Σ over every shop of (its district's lean × its own gross trade) ÷ Σ gross
  // — i.e. the world's total cash flow WITH the cohort correction divided by
  // the same total WITHOUT it. Provably 1.00 by construction; recomputed here
  // from the live shop list so it is a CHECK on the derivation rather than a
  // restatement of it. If this is not 1.00 the two halves disagree about
  // scale, which is exactly the fault the first gate run caught.
  function pathRatio() {
    buildDemand();
    if (!_dm) return 1;
    const A = CBZ.city && CBZ.city.arena, lots = (A && A.shopLots) || [];
    let num = 0, den = 0;
    for (let i = 0; i < lots.length; i++) {
      const L = lots[i];
      if (!L || L.demolished || !L.kind || !TRADE[L.kind]) continue;
      const gr = grossOf(L);
      num += gr * demandOf(tillDistrict(L)); den += gr;
    }
    return den > 0 ? +(num / den).toFixed(3) : 1;
  }
  // REGISTRATION SEAM for city/take.js: we publish a PROVIDER so the shared
  // CBZ.cityTake / cityHolds entry can answer for PLACES without knowing
  // anything about shops — the person half owns bodies and households, this
  // half owns registers, safes, vaults, cages and trucks.
  //
  // `pools(src)` returns records in take.js's OWN pool shape
  // ({id, label, amount, slow, take(n) -> what actually moved}), so wiring the
  // two halves together is three lines inside its collect(), not an adapter.
  // A safe/vault is marked `slow` because emptying one is not a grab — which
  // is exactly the distinction take.js's liquidateSecs already models.
  //
  // If take.js never consults providers, NOTHING BREAKS: every consumer in
  // this wave calls CBZ.cityTill directly and this array is simply unread.
  (CBZ.cityTakeSources = CBZ.cityTakeSources || []).push({
    id: "place",
    owns: function (src) { return !!(src && typeof src === "object" && (src._tillSpec || (src.kind && pointsOf(src).length))); },
    holds: holds, take: take, deplete: deplete, points: pointsOf,
    pools: function (src) {
      const out = [];
      const pts = pointsOf(src);
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i], h = holds(src, { point: pt });
        if (!(h.amount > 0)) continue;
        out.push({
          id: "place:" + pt, label: (h.name || "the place") + " — " + (PT_NAME[pt] || pt),
          amount: h.amount, slow: pt !== "register",
          // deliberately NOT `rob:true` at this seam: a hostile take clears
          // the whole point, and take.js may be assembling one number out of
          // several pools. The conservative debit is never wrong; the
          // robbery flavour stays with the call sites that mean it.
          take: (function (p) { return function (n) { return take(src, { point: p, max: n }).taken; }; })(pt),
        });
      }
      return out;
    },
  });
  function robTill() {
    const kind = openLot.kind;
    if (!canRobTill(kind)) { CBZ.city.note("No register to crack here.", 1.4); return; }
    const door = openLot.building.door, x = door ? door.x : CBZ.player.pos.x, z = door ? door.z : CBZ.player.pos.z;
    // clerk resistance: the better-defended shops (guns/jewelry/casino) fight
    // back more; a high-respect robber intimidates better (GTA intimidation).
    // The roll now decides HOW MUCH OF THE DRAWER YOU GET, not how much money
    // exists — the drawer's contents are the place's own balance.
    const armed = (kind === "jewelry" || kind === "casino" || kind === "security" || kind === "drugs");
    const intimidation = Math.min(0.9, 0.45 + (g.respect || 0) / 600 + playerDrip() / 150 + (CBZ.cityHasGun && CBZ.cityHasGun() ? 0.2 : 0));
    const resisted = armed && Math.random() > intimidation;
    // A TAKE IS A TRANSFER: this MOVES the drawer's real balance. An empty
    // register pays nothing and says why — that is the anti-farm rule, and it
    // is why there is no cooldown timer anywhere in this function.
    const r = CBZ.cityTill.take(openLot, { point: "register", frac: resisted ? (0.3 + Math.random() * 0.3) : 1, by: "player", rob: true });
    const take = r.taken;
    if (!(take > 0)) {
      CBZ.city.note(r.why === "empty" ? "Drawer's empty — they've already dropped it." : ("Nothing in " + (r.name || "the register") + " — " + (r.why || "empty") + "."), 2.2);
      // it is still an armed robbery even when the score is nothing, and the
      // clerk still screams: fall through to the crime/alarm/panic beats.
    } else CBZ.city.addCash(take);
    if (CBZ.sfx && take > 0) CBZ.sfx("coin");
    // CRIME: this is armed robbery — big heat, marks your last-known position,
    // panics the block, and rolls a chance a unit is already responding.
    if (CBZ.cityCrime) CBZ.cityCrime(resisted ? 220 : 170, { instant: true, x: x, z: z, type: "store robbery" });
    if (CBZ.cityAlarm) CBZ.cityAlarm(x, z, 22, resisted ? 1.4 : 1, CBZ.city.playerActor);
    if (CBZ.cityPanic) CBZ.cityPanic(x, z, 1.2, CBZ.city.playerActor);
    CBZ.city.addRespect(resisted ? 4 : 2);
    // a real chance the silent alarm already called it in: spawn a responder
    if (CBZ.citySpawnCop && (resisted || Math.random() < 0.5)) {
      const ang = Math.random() * Math.PI * 2, r = 26 + Math.random() * 10;
      CBZ.citySpawnCop(x + Math.cos(ang) * r, z + Math.sin(ang) * r, false);
      if (CBZ.sfx) CBZ.sfx("siren");
    }
    if (resisted) CBZ.city.big("Clerk resisted! Grabbed " + fmt$(take) + " — cops rolling!");
    else CBZ.city.big("Robbed the till: " + fmt$(take) + " — WANTED!");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    // the store kicks you out after a stick-up
    close();
  }

  // ---- styling (barber / clothing fitting room) ------------------------------
  function restyle(kind, idx) {
    const list = styleMenu(kind); const s = list[idx]; if (!s) return;
    // a CATALOG fit routes through the wardrobe: pay once, own it, the rig
    // recolors on the spot and the drip lands (outfits.js owns the whole beat).
    if (s.id && CBZ.cityBuyOutfit) { CBZ.cityBuyOutfit(s.id); render(); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); return; }
    const cur = kind === "barber" ? look().hair : look().outfit;
    if (cur === s.name) { CBZ.city.note("You're already rocking that.", 1.4); return; }
    if (!CBZ.city.spend(s.cost)) { CBZ.city.note("Need " + fmt$(s.cost) + " for that.", 1.6); return; }
    // swagger replaces the prior style's swagger contribution (no stacking)
    const prevSwag = stylePrevSwag(kind, cur);
    look().swagger = Math.max(0, (look().swagger || 0) - prevSwag + s.swag);
    if (kind === "barber") look().hair = s.name; else look().outfit = s.name;
    CBZ.city.addRespect(Math.max(1, Math.round(s.swag / 2)));
    if (CBZ.sfx) CBZ.sfx("coin");   // real payment-confirm sound (was a DIY "whoosh" for cuts)
    CBZ.city.note((kind === "barber" ? "Fresh cut: " : "New fit: ") + s.name, 2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    render();
  }
  function stylePrevSwag(kind, name) {
    const list = kind === "barber" ? HAIRCUTS : OUTFITS;
    const f = list.find((x) => x.name === name);
    return f ? f.swag : 0;
  }

  // ---- electronics: the phone-upgrade money sink is DELETED --------------
  // (phoneUpgCost / phoneUpgrade / g.cityPhoneTier). See the note at the
  // electronics row above: four paid tiers, zero readers, a stat fiction.

  // ---- jewelry: ICE OUT bundle (buy the full flex set at a discount) ---------
  // ONE piece per jewelry slot (chain/ring/watch/glasses) so it's a coherent fit
  // (no two chains fighting for the same slot). You only pay for pieces you don't
  // already OWN; everything in the set is then EQUIPPED so your drip jumps at once.
  function iceOut() {
    const econ = CBZ.cityEcon;
    const set = ["Gold Chain", "Diamond Ring", "Rolex", "Diamond Grill"];   // chain · ring · watch · glasses
    const toBuy = set.filter((s) => econ.count(s) <= 0);   // only charge for what you don't own
    const notWorn = set.filter((s) => !isWorn(s));
    if (!notWorn.length) { CBZ.city.note("You're already fully iced out.", 1.8); return; }
    let raw = 0; for (const m of toBuy) raw += econ.buyPrice(m);
    const price = Math.round(raw * 0.82);   // 18% bundle deal (may be $0 if you already own them)
    if (price > 0 && !CBZ.city.spend(price)) { CBZ.city.note("The full set runs " + fmt$(price) + " right now.", 2); return; }
    if (CBZ.sfx) CBZ.sfx("coin");
    for (const m of toBuy) econ.add(m, 1);
    for (const m of set) if (!isWorn(m)) equip(m);          // wear the whole set
    CBZ.city.big("ICED OUT — full set" + (price > 0 ? " for " + fmt$(price) : "") + "!");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    render();
  }

  // ---- services impl ----
  function healFull() { if (CBZ.city.spend(200)) { CBZ.player.hp = CBZ.player.maxHp || 100; CBZ.player._armor = Math.max(CBZ.player._armor || 0, 0); CBZ.city.note("Healed to full.", 1.4); if (CBZ.sfx) CBZ.sfx("coin"); render(); } else CBZ.city.note("Need $200.", 1.4); }
  function deposit() { const c = g.cash || 0; if (c <= 0) return; g.cityBank = (g.cityBank || 0) + c; g.cash = 0; CBZ.city.note("Deposited " + fmt$(c) + " (bank: " + fmt$(g.cityBank) + ")", 2); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); render(); }
  function withdraw() { const amt = Math.min(500, g.cityBank || 0); if (amt <= 0) { CBZ.city.note("Bank empty.", 1.2); return; } g.cityBank -= amt; CBZ.city.addCash(amt); CBZ.city.note("Withdrew " + fmt$(amt), 1.6); render(); }
  function bribe() {
    const stars = g.wanted | 0;
    if (stars <= 0) { CBZ.city.note("You're clean — nothing to pay off.", 1.4); return; }
    const cost = ((CBZ.CITY.econ && CBZ.CITY.econ.bribeBase) || 150) * stars;
    if (!CBZ.city.spend(cost)) { CBZ.city.note("A bribe costs " + fmt$(cost) + " right now.", 1.8); return; }
    const T = CBZ.CITY.starHeat; g.heat = Math.max(0, T[Math.max(0, stars - 1)] - 1);
    if (CBZ.city.addHeat) CBZ.city.addHeat(0);
    CBZ.city.note("Paid off the cops — down to " + (stars - 1) + "★ (" + fmt$(cost) + ")", 2.2);
    if (CBZ.sfx) CBZ.sfx("coin"); render();
  }
  function train() { if ((CBZ.player.maxHp || 100) >= 240) { CBZ.city.note("You're maxed out — the gym can't take you further.", 1.8); return; } if (CBZ.city.spend(100)) { CBZ.player.maxHp = Math.min(240, (CBZ.player.maxHp || 100) + 10); CBZ.player.hp = CBZ.player.maxHp; CBZ.city.addRespect(1); CBZ.city.note("Trained — max HP " + CBZ.player.maxHp, 1.8); render(); } }
  // BAR — buy a round. The bar's verb promises "drinks" but it has no stock and
  // the food heal path is kind-gated; this is the drink. Loosens you up: tops a
  // little hunger, a short stamina boost, and a small patch-up (mirrors the
  // food heal+boost at the buy() path, scaled down for a single round) — and,
  // per city/drinking.js, tips your drunk level: one round is a buzz, several
  // rounds is a stumble, and the bar can absolutely put you on the floor if
  // you keep ordering (guarded — the round still pours fine if that file
  // somehow isn't loaded).
  function buyDrink() {
    if (!CBZ.city.spend(12)) { CBZ.city.note("Need $12.", 1.4); return; }
    if (CBZ.sfx) CBZ.sfx("coin");
    g.hunger = Math.min(100, (g.hunger || 0) + 15);
    CBZ.player._boost = 12;
    if (CBZ.player.hp != null && CBZ.player.maxHp) CBZ.player.hp = Math.min(CBZ.player.maxHp, CBZ.player.hp + 8);
    if (CBZ.cityDrink) CBZ.cityDrink(1);
    CBZ.city.note("Drink — loosened up. That's gonna add up...", 1.8);
    render();
  }
  const MAKER_CORP_ID = { KAI: "kaido", VLT: "volante" };   // economy.js CARS .maker -> sim/corporations.js id
  function buyCar() {
    if (!CBZ.city.spend(1500)) { CBZ.city.note("Need $1,500 for a car.", 1.6); return; }
    const A = CBZ.city.arena, door = openLot.building.door;
    const car = CBZ.citySpawnOwnedCar ? CBZ.citySpawnOwnedCar(door.x + door.nx * 3, door.z + door.nz * 3) : null;
    // E7: Apex Dealership Holdings books half the sale as dealer-margin
    // revenue. E10: the OTHER half goes to the model's actual MAKER (economy.js
    // CARS .maker), boosted by that maker's brandHeat (win-on-Sunday-sell-on-
    // Monday — sim/motorsport.js). A model with no .maker (e.g. the Yellow
    // Cab) leaves that half simply uncredited — no manufacturer to book it to.
    const mkId = car && car.model && MAKER_CORP_ID[car.model.maker];
    const mkCo = mkId && CBZ.corps ? CBZ.corps.get(mkId) : null;
    if (CBZ.corps && CBZ.corps.creditRevenue) {
      CBZ.corps.creditRevenue("apex", 375);
      if (mkId) CBZ.corps.creditRevenue(mkId, 375 * (mkCo ? (mkCo.brandHeat || 1) : 1));
    }
    CBZ.city.note("Your new ride is parked out front!", 2.2);
    close();
  }

  // ---- open / close + input ----
  function open(lot) {
    if (!lot || lot.demolished) return;        // no counter to walk up to — it's rubble
    // a clerk you've ROBBED remembers (social.js shopkeeper memory) — the till
    // stays shut to YOU until the heat of it fades.
    const _v = lot && lot.building && lot.building.vendor;
    if (CBZ.cityVendorRefuses && CBZ.cityVendorRefuses(_v)) { CBZ.city.note("“We're closed. To YOU. Get out.”", 2.2); return; }
    openLot = lot; CBZ.cityMenuOpen = true;
    qty = 1; haggle = 0; haggleTried = false; closetOpen = false;   // reset per visit
    el().style.display = "block";
    render();
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function close() {
    openLot = null; CBZ.cityMenuOpen = false;
    if (panel) panel.style.display = "none";
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }
  CBZ.cityOpenShop = open;
  CBZ.cityShopOpen = function () { return !!openLot; };
  CBZ.cityCloseShop = close;
  // repaint the counter that is ALREADY up (never opens one, never resets the
  // per-visit haggle/qty state that open() owns). city/civic.js's DMV queue
  // advances on the sim clock, so the NOW-SERVING line has to move while you
  // are standing at the window. No-op when no counter is open.
  CBZ.cityShopRender = function () { if (openLot) render(); };
  CBZ.cityShopLot = function () { return openLot; };

  addEventListener("keydown", function (e) {
    if (!openLot) return;
    const k = e.key.toLowerCase();
    if (k === "escape" || k === "e") { e.preventDefault(); close(); return; }
    // the closet toggle (boutique change-clothes view) — its key is chosen to
    // dodge restyle letters & service keys, so it never steals an existing verb.
    const ck = closetKey(openLot.kind);
    if (ck && k === ck) { e.preventDefault(); closetOpen = !closetOpen; render(); return; }
    // while the closet is up, number keys EQUIP owned pieces and [0] strips all
    if (closetOpen && isBoutique(openLot.kind)) {
      if (k >= "1" && k <= "9") { e.preventDefault(); closetEquip(parseInt(k, 10) - 1); return; }
      if (k === "0") { e.preventDefault(); closetStripAll(); return; }
      // fall through for nothing else: closet view owns the keys while it's open
      return;
    }
    if (k >= "1" && k <= "9") { e.preventDefault(); buy(parseInt(k, 10) - 1); return; }
    if (k === "0") { e.preventDefault(); sellAll(openLot.kind); return; }
    // bulk-quantity toggle (1 → 5 → 10 → 1)
    if (k === "x") { e.preventDefault(); qty = qty === 1 ? 5 : qty === 5 ? 10 : 1; render(); return; }
    // haggle (one attempt this visit)
    if (k === "v") { e.preventDefault(); tryHaggle(); return; }
    // rob the till
    if (k === "r" && canRobTill(openLot.kind) && !services(openLot.kind).some((s) => s.key === "r")) {
      e.preventDefault(); robTill(); return;
    }
    // barber / clothing restyle — letters come from styleLetters(), which
    // already skips service keys + the closet key, so they can't collide.
    const styles = styleMenu(openLot.kind);
    if (styles.length && k >= "a" && k <= "z") {
      const idx = styleLetters(openLot.kind).indexOf(k);
      if (idx >= 0 && idx < styles.length) { e.preventDefault(); restyle(openLot.kind, idx); return; }
    }
    const svc = services(openLot.kind).find((s) => s.key === k);
    if (svc) { e.preventDefault(); svc.fn(); }
  });

  // ---- BREAKING & ENTERING through a shot-out window. buildings.js only
  // reports the route (CBZ.cityWindowEntry fires when the player crosses the
  // wall plane inward through a live opening); the LAW lives here with the
  // rest of the shop crime. WHY: shooting out a pane is the burglar's door —
  // quieter than an armed robbery, but a crime the moment you're inside
  // someone's dark shop. Daylight entry is mere trespass — only matters if
  // somebody sees it (cityCrime's witness gate already handles that).
  CBZ.cityWindowEntry = function (rec) {
    if (!rec || rec._charged) return;          // one charge per opening
    rec._charged = true;
    const P = CBZ.player; if (!P || P.dead) return;
    const A = CBZ.city && CBZ.city.arena; if (!A || !A.lots) return;
    let lot = null;
    for (const l of A.lots) {
      if (l.building && Math.abs(P.pos.x - l.cx) < l.w / 2 + 3 && Math.abs(P.pos.z - l.cz) < l.d / 2 + 3) { lot = l; break; }
    }
    const night = (CBZ.nightAmount || 0) > 0.45;
    if (night) {
      CBZ.cityCrime && CBZ.cityCrime(70, { x: P.pos.x, z: P.pos.z, type: "burglary" });
      // a shopfront trips its silent alarm just like the register path
      if (lot && CBZ.cityAlarm) CBZ.cityAlarm(P.pos.x, P.pos.z, 18, 0.7, CBZ.city.playerActor);
    } else {
      CBZ.cityCrime && CBZ.cityCrime(24, { x: P.pos.x, z: P.pos.z, type: "trespass" });
    }
  };

  // ============================================================
  //  THE COUNTER KNOWS WHO'S WORKING IT — registry options (interactions.js).
  //  Every storefront verb below is an OPTION RECORD, not a key listener:
  //  the counter reads the KEEPER's state (alive / at the post / on shift)
  //  and the street reads the WORKER's trade (CBZ.cityJobs class strings),
  //  so a mechanic, a cab driver or a cart vendor is something you can USE,
  //  not just walk past. Worker-only verbs gate on ctx.role (the class
  //  string), never on the ped ref — any actor carrying the trade gets the
  //  same verbs. shops.js loads BEFORE the registry, so registration defers
  //  one tick. All money paths reuse the existing economy (spend/addCash/
  //  buyPrice/sellAll/tillEstimate) — no parallel tills.
  // ============================================================
  const _sNow = () => CBZ.now || 0;
  const _first = (n) => (n || "them").split(" ")[0];
  // WHO IS WORKING: promoted to city/level.js (CBZ.cityPedJob / cityPedJobClass)
  // — role identity is that file's business, and city/roleverbs.js needs the
  // same read to hang a verb on a trade. The old private pair stays underneath
  // as the degrade path, byte-identical to what it always was.
  const _jobOf = (p) => (CBZ.cityPedJob ? CBZ.cityPedJob(p) : ((p && p.job) || ""));
  const _jclass = (p) => {
    if (CBZ.cityPedJobClass) return CBZ.cityPedJobClass(p);
    const J = CBZ.cityJobs && CBZ.cityJobs[_jobOf(p)];
    return J ? J.class : "";
  };

  // is this storefront LOCKED UP for the night? Only the banker's-hours kinds
  // shut (the diner, the gas pump, the bar and the trap never close); hours
  // come off the same sun clock the keepers' timetables run on.
  const SHUT_KINDS = { bank: 1, cityhall: 1, realtor: 1, clothing: 1, barber: 1, electronics: 1, jewelry: 1, carlot: 1 };
  function shopShut(lot) {
    if (!lot) return false;
    const h = CBZ.citySunHour ? CBZ.citySunHour() : 12;
    // GOVERNMENT HOURS first (city/civic.js): a courthouse is not a diner, and
    // 9-to-5 is both the joke and the truth. The fire house returns null there
    // and falls through to the line below — where it isn't listed, so it never
    // closes. Degrade-safe: no civic.js → the original two lines, byte-for-byte.
    const ch = (CBZ.civic && CBZ.civic.hours) ? CBZ.civic.hours(lot.kind) : null;
    if (ch) return h < ch.open || h >= ch.close;
    if (!SHUT_KINDS[lot.kind]) return false;
    return h < 7 || h >= 21;
  }

  // the QUIET TILL: the keeper's dead or gone and the drawer is just sitting
  // there. Reaching over the counter is petty theft, not a stick-up — the
  // heat is witness-gated (cityCrime without `instant`), so an empty street
  // means a clean grab. You get LESS than the armed version because you are
  // scooping notes with one hand, not making anybody open the drawer — and
  // the old five-minute `_tillSneakT` refill timer is DELETED: the drawer is
  // empty because you emptied it, and it refills at the rate the shop
  // actually trades. That is not a cooldown, it is the balance.
  function quietTill(lot) {
    const r = CBZ.cityTill.take(lot, { point: "register", frac: 0.45 + Math.random() * 0.35, by: "player", rob: true });
    const d = lot.building && lot.building.door;
    if (!(r.taken > 0)) {
      CBZ.city.note("Drawer's empty — nothing in it to take.", 1.8);
      return;
    }
    CBZ.city.addCash(r.taken);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityCrime) CBZ.cityCrime(40, { x: d ? d.x : CBZ.player.pos.x, z: d ? d.z : CBZ.player.pos.z, type: "till grab" });
    CBZ.city.note("Cleaned the drawer — " + fmt$(r.taken) + ". Nobody watching.", 2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  // …and the SAFE behind the counter, which is the whole gradient: a drawer is
  // pocket money and the drop safe is a job. It only surfaces on a counter
  // nobody is watching, it takes real time to work, and it is the reason to
  // case a place instead of hitting the first door you pass.
  function crackSafe(lot) {
    const r = CBZ.cityTill.take(lot, { point: "safe", by: "player", rob: true });
    const d = lot.building && lot.building.door;
    const x = d ? d.x : CBZ.player.pos.x, z = d ? d.z : CBZ.player.pos.z;
    if (!(r.taken > 0)) { CBZ.city.note("Safe's already been emptied into the night deposit.", 2); return; }
    CBZ.city.addCash(r.taken);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityCrime) CBZ.cityCrime(150, { x: x, z: z, type: "burglary" });
    if (CBZ.cityAlarm) CBZ.cityAlarm(x, z, 20, 1, CBZ.city.playerActor);
    CBZ.city.addRespect(3);
    CBZ.city.big("Cracked the drop safe: " + fmt$(r.taken));
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }

  // a MECHANIC will only quote on a real wreck close enough to look at —
  // engine health is vehicles.js's master number (engineHp), fire excluded.
  function fixableCar(p) {
    const cars = CBZ.cityCars; if (!cars) return null;
    const P = CBZ.player;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || c.npcDriver || c.engineHp == null || c.engineHp >= 85) continue;
      if (c._onFire) continue;                       // nobody works a burning engine
      const dxp = c.pos.x - p.pos.x, dzp = c.pos.z - p.pos.z;
      if (dxp * dxp + dzp * dzp > 11 * 11) continue;
      const dxP = c.pos.x - P.pos.x, dzP = c.pos.z - P.pos.z;
      if (dxP * dxP + dzP * dzP > 15 * 15) continue;
      return c;
    }
    return null;
  }
  function fixPrice(c) { return Math.round(60 + (100 - Math.max(0, c.engineHp)) * 1.6 * (c.repair || 1)); }

  // a CAB ride: the fare scales with the crosstown distance; the arrival is a
  // straight drop at the far-side intersection (fade-arrive — the ride itself
  // isn't the show, being ACROSS town in five seconds is).
  function cabDest() {
    const A = CBZ.city && CBZ.city.arena;
    if (!A || !A.nearestIntersection) return null;
    const P = CBZ.player;
    return A.nearestIntersection(-P.pos.x, -P.pos.z);   // mirror across the city core
  }
  function cabFare() {
    const it = cabDest(); if (!it) return 0;
    const P = CBZ.player;
    return Math.max(30, Math.round(Math.hypot(it.x - P.pos.x, it.z - P.pos.z) * 0.5));
  }
  function cabRide(p) {
    const it = cabDest(); if (!it) return;
    const P = CBZ.player;
    const dist = Math.hypot(it.x - P.pos.x, it.z - P.pos.z);
    if (dist < 40) { if (CBZ.citySay) CBZ.citySay(p, "“That's a walk, not a fare.”", "#cfe6ff", 2); return; }
    const fare = Math.max(30, Math.round(dist * 0.5));
    if (!CBZ.city.spend(fare)) { if (CBZ.citySay) CBZ.citySay(p, "“No cash, no cab.”", "#cfe6ff", 2); return; }
    p.cash = (p.cash | 0) + fare;
    P.pos.x = it.x + 2; P.pos.z = it.z + 2;
    if (P.vel) { P.vel.x = 0; P.vel.z = 0; }
    CBZ.city.note("Dropped across town — " + fmt$(fare) + " on the meter.", 2.2);
  }
  // A CAB IS A FARE, AND A FARE IS NOT A CAB DRIVER. The crosstown drop above
  // is the only "somebody drives you" effect in the game; a chauffeur standing
  // at an estate gate wants exactly it and should never re-author the meter.
  // Exported (not restructured) so city/roleverbs.js can hang a second trade
  // on the same fare instead of typing a third teleport-and-charge.
  CBZ.cityCabFare = cabFare;
  CBZ.cityCabRide = cabRide;

  const TOOLBAG = ["Crowbar", "Lockpick", "Medkit"];   // the hardware counter's working bundle
  function toolbagPrice() {
    const econ = CBZ.cityEcon; let t = 0;
    for (const n of TOOLBAG) t += econ.buyPrice(n);
    return Math.round(t * 0.85);
  }

  let _regDone = false;
  CBZ.onUpdate(38.5, function () {
    if (_regDone || !CBZ.interactions) return;
    _regDone = true;
    const I = CBZ.interactions;

    // ---- the UNWATCHED REGISTER: a counter whose keeper is dead or gone.
    //      A keeper standing their post keeps the ped:vendor layer in charge;
    //      this zone only surfaces over the gap they leave. Token is cached
    //      per lot so targeting hysteresis sees one stable candidate. ----
    I.registerZone({
      id: "shop-counter-open", kind: "counter", radius: 4.2,
      find: function (px, pz) {
        const A = CBZ.city && CBZ.city.arena; if (!A || !A.shopLots) return null;
        let best = null, bd = 4.2 * 4.2;
        for (let i = 0; i < A.shopLots.length; i++) {
          const lot = A.shopLots[i], b = lot.building;
          if (!b || !b.vendorSpot || lot.demolished) continue;
          const vs = b.vendorSpot;
          const dd = (vs.x - px) * (vs.x - px) + (vs.z - pz) * (vs.z - pz);
          if (dd >= bd) continue;
          const v = b.vendor;
          const away = !v || v.dead || Math.hypot(v.pos.x - vs.x, v.pos.z - vs.z) > 9;
          if (!away) continue;                       // keeper's on the post — not our counter
          bd = dd;
          best = lot._counterTok || (lot._counterTok = { lot, x: vs.x, z: vs.z });
        }
        return best;
      },
      options: [
        // the drawer: what is IN it right now, so the label is a real read on
        // the place and not a constant. An empty drawer says so instead of
        // advertising money that is not there.
        { id: "till-sneak", slot: "e", bad: true,
          label: (t) => { const n = CBZ.cityTill.holds(t.lot, { point: "register" }).amount;
                          return n > 0 ? "Clean out the drawer (" + fmt$(n) + ")" : "Drawer's empty"; },
          canShow: (t) => canRobTill(t.lot.kind),
          onSelect: (t) => quietTill(t.lot) },
        // the drop safe behind the counter — the fat one, and it is on the
        // shop's OWN deposit-run clock, so a place you cased is worth more.
        { id: "till-safe", slot: "f", bad: true,
          label: (t) => { const n = CBZ.cityTill.holds(t.lot, { point: "safe" }).amount;
                          const h = CBZ.cityTill.nextClear(t.lot, "safe");
                          return "Crack the drop safe (" + fmt$(n) + (h > 0 && h < 12 ? " · deposit run in " + Math.round(h) + "h" : "") + ")"; },
          canShow: (t) => CBZ.CONFIG.TILL_SAFE_POINTS && CBZ.cityTill.points(t.lot).indexOf("safe") >= 0 &&
                          CBZ.cityTill.holds(t.lot, { point: "safe" }).amount > 0,
          onSelect: (t) => crackSafe(t.lot) },
      ],
    });
    I.describe("counter", function (t) {
      const v = t.lot.building && t.lot.building.vendor;
      return {
        label: (t.lot.building && t.lot.building.name) || "Counter",
        note: v && v.dead ? "Register's open — nobody left to watch it" : "Register's open — nobody's watching",
      };
    });

    // ---- LOCKED UP: off-shift = shut shop. The shut line outranks "Shop
    //      here" on E for the banker's-hours kinds; the register verbs stay
    //      (a closed store is still a store with a drawer). ----
    I.register("ped:vendor", {
      id: "vendor-shut", slot: "e", prio: 20,
      canShow: (v) => !!v.vendor && shopShut(v.vendor),
      label: (v) => "Locked up for the night — knock anyway",
      onSelect: (v) => {
        if (CBZ.citySay) CBZ.citySay(v, "“We're closed. Sunup.”", "#cfe6ff", 2.2);
        else CBZ.city.note("“We're closed. Sunup.”", 1.6);
      },
    });

    // ---- counter depth where it PAYS: one trade verb per storefront kind ----
    // the diner: a HOT PLATE — the best hunger fill in the city, eaten standing
    I.register("ped:vendor", {
      id: "vendor-hotmeal", slot: "k", prio: 10,
      canShow: (v) => !!v.vendor && v.vendor.kind === "food",
      label: () => "Hot plate — $15 (a real meal)",
      onSelect: () => {
        if (!CBZ.city.spend(15)) { CBZ.city.note("A plate runs $15.", 1.4); return; }
        g.hunger = Math.min(100, (g.hunger || 0) + 50);
        if (CBZ.player.maxHp) CBZ.player.hp = Math.min(CBZ.player.maxHp, (CBZ.player.hp || 0) + 18);
        if (CBZ.sfx) CBZ.sfx("coin");
        CBZ.city.note("Hot plate, straight off the grill.", 1.8);
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      },
    });
    // the barber: the quick chair — a lineup without opening the whole menu
    I.register("ped:vendor", {
      id: "vendor-lineup", slot: "k", prio: 10,
      canShow: (v) => !!v.vendor && v.vendor.kind === "barber" && !shopShut(v.vendor),
      label: () => "Quick lineup — $25",
      onSelect: () => {
        if (!CBZ.city.spend(25)) { CBZ.city.note("The chair runs $25.", 1.4); return; }
        const lk = look(); lk.swagger = (lk.swagger || 0) + 1;
        CBZ.city.addRespect(1);
        if (CBZ.sfx) CBZ.sfx("coin");
        CBZ.city.note("Edges cleaned up — sharper already.", 1.6);
      },
    });
    // the hardware counter: the working TOOL BAG, bundled under list price
    I.register("ped:vendor", {
      id: "vendor-toolbag", slot: "k", prio: 10,
      canShow: (v) => !!v.vendor && v.vendor.kind === "hardware",
      label: () => "Tool bag — " + fmt$(toolbagPrice()) + " (crowbar · picks · medkit)",
      onSelect: () => {
        const price = toolbagPrice();
        if (!CBZ.city.spend(price)) { CBZ.city.note("The bag runs " + fmt$(price) + ".", 1.6); return; }
        const econ = CBZ.cityEcon;
        for (const n of TOOLBAG) {
          econ.add(n, 1);
          const m = econ.ITEMS[n];
          if (m && (m.melee || m.gun) && CBZ.cityGiveWeapon) CBZ.cityGiveWeapon(n);
        }
        if (CBZ.sfx) CBZ.sfx("coin");
        CBZ.city.note("Tool bag over the counter — ready to work.", 1.8);
      },
    });
    // the pawnbroker: one press fences the whole haul (the haggle's built into
    // the counter's own sell prices — no second economy)
    I.register("ped:vendor", {
      id: "vendor-fence", slot: "k", prio: 10,
      canShow: (v) => !!v.vendor && v.vendor.kind === "pawn" && sellTotal("pawn") > 0,
      label: () => "Fence the lot — " + fmt$(sellTotal("pawn")),
      onSelect: () => sellAll("pawn"),
    });
    // YOUR trade pays at the counter too: a player working security collects a
    // watch retainer the same way an NPC guard draws a wage. Gated on the role
    // class string — any actor carrying the trade sees the same verb.
    // A WAGE IS PAID OUT OF THE DRAWER. The keeper hands you the retainer out
    // of the register — so a shop that has just been robbed, or has not
    // opened yet, genuinely cannot pay you, and the money that reaches you
    // leaves the shop's balance like any other take. (The old `_sNow() + 600000`
    // was SECONDS being told it was ms, i.e. a ~7-day gate — a once-per-run
    // faucet by accident. Fixing it to the 10 minutes its own comment claims
    // is only safe BECAUSE the pay now comes out of a real balance.)
    const RETAINER = 40;
    I.register("ped:vendor", {
      id: "vendor-retainer", slot: "l", prio: 12, role: "security",
      canShow: (v) => !!v.vendor && !v.dead && _sNow() > (v._retainerT || 0) &&
                      CBZ.cityTill.holds(v.vendor, { point: "register" }).amount >= RETAINER,
      label: () => "Collect the watch retainer — " + fmt$(RETAINER),
      onSelect: (v) => {
        const paid = CBZ.cityTill.take(v.vendor, { point: "register", max: RETAINER, by: "player" });
        if (!(paid.taken > 0)) {
          if (CBZ.citySay) CBZ.citySay(v, "“Drawer's light. Come back when we've traded.”", "#cfe6ff", 2.4);
          return;
        }
        v._retainerT = _sNow() + 600;              // seconds — one collection per keeper per 10 min
        CBZ.city.addCash(paid.taken);
        if (CBZ.sfx) CBZ.sfx("coin");
        if (CBZ.citySay) CBZ.citySay(v, "“Keep the block quiet, yeah?”", "#cfe6ff", 2.2);
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      },
    });

    // ---- WORKERS ON THE STREET: the trades you can flag down ----
    // a mechanic near your beat-up ride quotes a fix on the spot
    I.register("ped:civ", {
      id: "ped-mechanic-fix", slot: "k", prio: 44,
      canShow: (p, ctx) => !ctx.driving && !p.dead && /mechanic/i.test(_jobOf(p)) && !!fixableCar(p),
      label: (p) => { const c = fixableCar(p); return "Fix ride — " + fmt$(c ? fixPrice(c) : 0); },
      onSelect: (p) => {
        const c = fixableCar(p); if (!c) return;
        const price = fixPrice(c);
        if (!CBZ.city.spend(price)) { CBZ.city.note("Repairs run " + fmt$(price) + " — you're short.", 1.6); return; }
        c.engineHp = 100; c._smoking = false;
        p.cash = (p.cash | 0) + price;
        if (CBZ.sfx) CBZ.sfx("coin");
        if (CBZ.citySay) CBZ.citySay(p, "“Runs better than it looks. We're square.”", "#cfe6ff", 2.2);
        CBZ.city.note("Engine patched — she'll run.", 1.8);
      },
    });
    // a cab driver takes a fare across town (they won't carry a hot one)
    I.register("ped:civ", {
      id: "ped-cab-ride", slot: "k", prio: 43,
      canShow: (p, ctx) => !ctx.driving && !p.dead && !p.rage && p.state !== "flee" &&
        _jobOf(p) === "cab driver" && (ctx.wanted | 0) < 2,
      label: () => "Flag a cab — " + fmt$(cabFare()),
      onSelect: (p) => cabRide(p),
    });
    // a cart vendor sells off the cart — cheap calories without a counter
    I.register("ped:civ", {
      id: "ped-cart-bite", slot: "k", prio: 41,
      canShow: (p) => !p.dead && !p.rage && p.state !== "flee" && _jobOf(p) === "street vendor",
      label: "Buy a bite — $8",
      onSelect: (p) => {
        if (!CBZ.city.spend(8)) { CBZ.city.note("Even the cart wants $8.", 1.4); return; }
        g.hunger = Math.min(100, (g.hunger || 0) + 30);
        if (CBZ.player.maxHp) CBZ.player.hp = Math.min(CBZ.player.maxHp, (CBZ.player.hp || 0) + 8);
        p.cash = (p.cash | 0) + 8;
        if (CBZ.sfx) CBZ.sfx("coin");
        if (CBZ.citySay) CBZ.citySay(p, "“Hot and fresh. Next!”", "#cfe6ff", 2);
      },
    });
    // a posted guard can be GREASED — fifty bucks buys you blind eyes a while
    I.register("ped:civ", {
      id: "ped-guard-grease", slot: "l", prio: 30, bad: true,
      canShow: (p) => !p.dead && !p.rage && !p.gang && _jclass(p) === "law",
      label: "Slip a fifty",
      onSelect: (p) => {
        if (!CBZ.city.spend(50)) { CBZ.city.note("You need a whole fifty to grease anyone.", 1.4); return; }
        p.snitch = 0; p.reactCD = Math.max(p.reactCD || 0, 90);
        p.cash = (p.cash | 0) + 50;
        if (CBZ.citySay) CBZ.citySay(p, "“Didn't see a thing.”", "#cfe6ff", 2.2);
      },
    });
  });
})();
