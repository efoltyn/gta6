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
      if (CBZ.sfx) CBZ.sfx("door");
      CBZ.city.note("👕 Put on " + nm + " — sharper already.", 1.6);
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
      html += "<div style='font-size:12px;color:#9fb0c6;margin:2px 0 6px'>🔫 The pieces are <b style='color:#ffd166'>on the wall</b> — " +
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
        return (luxe ? "💎 " : "") + s.name + " " + tag;
      }).join(" · ") + "</div>";
    }
    // ROB THE TILL — every shop with a register (not banks/services-only) can be
    // stuck up for the cash drawer: fast money, but it spikes your wanted level.
    if (canRobTill(kind)) {
      html += "<div style='font-size:12px;color:#ff7a7a;margin:10px 0 0;border-top:1px solid #2c3140;padding-top:6px'>" +
        "<b style='color:#ff9e6b'>[R]</b> Rob the till <span style='color:#7f8794'>(~" + fmt$(tillEstimate(kind)) + ", and the heat that comes with it)</span></div>";
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
    if (kind === "hospital") s.push({ key: "h", label: "Heal to full — $200", fn: healFull });
    if (kind === "bank") { s.push({ key: "d", label: "Deposit all cash (safe on death)", fn: deposit }); s.push({ key: "w", label: "Withdraw $500", fn: withdraw }); }
    if (kind === "gas" && CBZ.player.driving) s.push({ key: "r", label: "Refuel car", fn: () => CBZ.city.note("Tank filled.", 1.2) });
    if (kind === "gym") s.push({ key: "t", label: "Train — +10 max HP ($100)", fn: train });
    if (kind === "carlot") s.push({ key: "c", label: "Buy a car — $1,500", fn: buyCar });
    if (kind === "carlot") s.push({ key: "y", label: (g.cityCarBiz && g.cityCarBiz.open) ? "Manage your car-resale yard" : "Open a car-resale yard — $2,000 (free if you own this lot)", fn: () => CBZ.cityOpenCarBiz && CBZ.cityOpenCarBiz() });
    if (kind === "realtor") s.push({ key: "h", label: "Browse homes — rent or buy", fn: () => CBZ.cityHomeMenu && CBZ.cityHomeMenu() });
    if (kind === "chop") s.push({ key: "c", label: "Sell a car — drive it into the bay out front", fn: () => CBZ.city.note("Drive a (stolen) car into the chop bay out front to cash it out.", 2.4) });
    if (kind === "bank") s.push({ key: "p", label: "Pay off the cops — bribe down 1 star", fn: bribe });
    if (kind === "security") s.push({ key: "j", label: "Apply: Security Guard job", fn: () => CBZ.cityStartCareer && CBZ.cityStartCareer("security") });
    if (kind === "drugs") s.push({ key: "j", label: "Become a dealer (street sales)", fn: () => CBZ.cityStartCareer && CBZ.cityStartCareer("dealer") });
    if (kind === "bar") s.push({ key: "j", label: "Run the night crew (pimp/entrepreneur)", fn: () => CBZ.cityStartCareer && CBZ.cityStartCareer("pimp") });
    // the OTHER half of the "drinks · run the night crew" verb: an actual round.
    // The bar has no SHOP_STOCK (so no BUY list) and the food heal path is gated
    // to kind==="food", so a drink would otherwise do nothing — give it a real,
    // kind-local effect here (mirrors the food heal+boost, sized for a quick one).
    // [K] is free at the bar: 'j'/'b' are taken, and the closet's [K] only ever
    // arms in a boutique (bar isn't one), so it can't collide.
    if (kind === "bar") s.push({ key: "k", label: "Buy a round — $12 (drink up)", fn: buyDrink });
    if (kind === "casino") s.push({ key: "g", label: "Casino, sportsbook, fight and race betting", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Betting") });
    if (kind === "raceway") s.push({ key: "r", label: "Racing board: legal, street, drag", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Racing") });
    if (kind === "racepark") s.push({ key: "r", label: "Horse and greyhound betting", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Racing") });
    if (kind === "arena" || kind === "gym") s.push({ key: "f", label: "Fight card: boxing and MMA", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Combat") });
    if (kind === "paintball") s.push({ key: "p", label: "Paintball match board", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Combat") });
    if (kind === "transit") s.push({ key: "t", label: "Bus and train routes", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Transit") });
    if (kind === "cityhall") s.push({ key: "p", label: "Politics, permits, civic contracts", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Civic") });
    if (kind === "airfield") s.push({ key: "w", label: "War, air support and emergency contracts", fn: () => CBZ.cityOpenActivities && CBZ.cityOpenActivities("Emergency") });
    // electronics: spend on a phone upgrade that pings nearby loot/cash on people
    if (kind === "electronics") s.push({ key: "u", label: (g.cityPhoneTier ? "Upgrade your phone (tier " + g.cityPhoneTier + ")" : "Buy a smartphone — track marks & deals") + " — $" + phoneUpgCost(), fn: phoneUpgrade });
    // jewelry: ICE OUT — buy the whole chain+ring+grill set at a bundle discount
    if (kind === "jewelry") s.push({ key: "u", label: "Ice out — buy the full set (bundle deal)", fn: iceOut });
    // every shop offers the job board if careers exist
    if (CBZ.cityJobBoard) s.push({ key: "b", label: "Job board (hustles for cash)", fn: () => CBZ.cityJobBoard() });
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
      if (CBZ.sfx) CBZ.sfx("glass");
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
      CBZ.city.big("💎 That fit turns heads — the Velvet's rope would open for you.");
    } else if (before < VIP && after >= VIP && CBZ.city.big) {
      CBZ.city.big("✦ Dressed like money — the Velvet's elite lounge would wave you up.");
    } else {
      CBZ.city.note("💎 Now wearing " + name + (replaced ? " (over " + replaced + ")" : "") + ".", 1.8);
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
      CBZ.city.note("🤝 Talked them down −" + Math.round(haggle * 100) + "% on the whole counter.", 2);
    } else if (roll > 0.93 && rep < 40) {
      haggle = 0;
      CBZ.city.note("The clerk's insulted — no deal today.", 1.8);
    } else {
      haggle = 0;
      CBZ.city.note("They won't budge on price.", 1.6);
    }
    render();
  }

  // ---- ROBBING THE TILL: GTA convenience-store stick-up. Big cash for the
  // register, but it's an armed robbery: instant wanted spike, a panicking
  // clerk + witnesses, and a real chance cops are already rolling. The clerk
  // may also resist (you get less + extra heat). Bigger shops = fatter tills.
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
  function tillEstimate(kind) {
    const base = TILL[kind] || 100;
    // richer districts keep more cash on hand; scale a touch with your rep too
    let mul = 1;
    if (CBZ.cityEcon.playerDistrict) {
      const dk = CBZ.cityEcon.playerDistrict();
      mul = (dk === "uptown" || dk === "island") ? 1.4 : (dk === "projects" ? 0.75 : 1);
    }
    return Math.round(base * mul);
  }
  function robTill() {
    const kind = openLot.kind;
    if (!canRobTill(kind)) { CBZ.city.note("No register to crack here.", 1.4); return; }
    const door = openLot.building.door, x = door ? door.x : CBZ.player.pos.x, z = door ? door.z : CBZ.player.pos.z;
    const est = tillEstimate(kind);
    // clerk resistance: the better-defended shops (guns/jewelry/casino) fight
    // back more; a high-respect robber intimidates better (GTA intimidation).
    const armed = (kind === "jewelry" || kind === "casino" || kind === "security" || kind === "drugs");
    const intimidation = Math.min(0.9, 0.45 + (g.respect || 0) / 600 + playerDrip() / 150 + (CBZ.cityHasGun && CBZ.cityHasGun() ? 0.2 : 0));
    let take = est;
    let resisted = false;
    if (armed && Math.random() > intimidation) {
      resisted = true;
      take = Math.round(est * (0.3 + Math.random() * 0.3));   // grabbed what you could
    } else {
      take = Math.round(est * (0.7 + Math.random() * 0.6));   // 0.7×–1.3× of the estimate
    }
    take = Math.max(20, take);
    CBZ.city.addCash(take);
    // E5: robbing a Bunbros outlet's till hits the SAME dollars off the
    // company's books (city/shops.js is the till-robbery site; guarded no-op
    // for every non-outlet shop, i.e. almost all of them this wave).
    if (CBZ.corps && CBZ.corps.robOutlet) CBZ.corps.robOutlet(openLot, take);
    if (CBZ.sfx) CBZ.sfx("coin");
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
    if (resisted) CBZ.city.big("🔫 Clerk resisted! Grabbed " + fmt$(take) + " — cops rolling!");
    else CBZ.city.big("💸 Robbed the till: " + fmt$(take) + " — WANTED!");
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
    if (!CBZ.city.spend(s.cost)) { CBZ.city.note("Need " + fmt$(s.cost) + " for that.", 1.6); if (CBZ.sfx) CBZ.sfx("glass"); return; }
    // swagger replaces the prior style's swagger contribution (no stacking)
    const prevSwag = stylePrevSwag(kind, cur);
    look().swagger = Math.max(0, (look().swagger || 0) - prevSwag + s.swag);
    if (kind === "barber") look().hair = s.name; else look().outfit = s.name;
    CBZ.city.addRespect(Math.max(1, Math.round(s.swag / 2)));
    if (CBZ.sfx) CBZ.sfx("coin");   // real payment-confirm sound (was a DIY "whoosh" for cuts)
    CBZ.city.note((kind === "barber" ? "💈 Fresh cut: " : "🧥 New fit: ") + s.name, 2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    render();
  }
  function stylePrevSwag(kind, name) {
    const list = kind === "barber" ? HAIRCUTS : OUTFITS;
    const f = list.find((x) => x.name === name);
    return f ? f.swag : 0;
  }

  // ---- electronics: a phone upgrade money sink (utility flex) ----------------
  function phoneUpgCost() { return 250 + (g.cityPhoneTier || 0) * 350; }
  function phoneUpgrade() {
    const cost = phoneUpgCost();
    if ((g.cityPhoneTier || 0) >= 4) { CBZ.city.note("Top-tier phone already — nothing better in stock.", 1.8); return; }
    if (!CBZ.city.spend(cost)) { CBZ.city.note("Need " + fmt$(cost) + ".", 1.6); if (CBZ.sfx) CBZ.sfx("glass"); return; }
    g.cityPhoneTier = (g.cityPhoneTier || 0) + 1;
    if (CBZ.sfx) CBZ.sfx("coin");
    CBZ.city.note("📱 New phone — better deals & street intel.", 2.2);
    render();
  }

  // ---- jewelry: ICE OUT bundle (buy the full flex set at a discount) ---------
  // ONE piece per jewelry slot (chain/ring/watch/glasses) so it's a coherent fit
  // (no two chains fighting for the same slot). You only pay for pieces you don't
  // already OWN; everything in the set is then EQUIPPED so your drip jumps at once.
  function iceOut() {
    const econ = CBZ.cityEcon;
    const set = ["Gold Chain", "Diamond Ring", "Rolex", "Diamond Grill"];   // chain · ring · watch · glasses
    const toBuy = set.filter((s) => econ.count(s) <= 0);   // only charge for what you don't own
    const notWorn = set.filter((s) => !isWorn(s));
    if (!notWorn.length) { CBZ.city.note("You're already fully iced out. 💎", 1.8); return; }
    let raw = 0; for (const m of toBuy) raw += econ.buyPrice(m);
    const price = Math.round(raw * 0.82);   // 18% bundle deal (may be $0 if you already own them)
    if (price > 0 && !CBZ.city.spend(price)) { CBZ.city.note("The full set runs " + fmt$(price) + " right now.", 2); if (CBZ.sfx) CBZ.sfx("glass"); return; }
    if (CBZ.sfx) CBZ.sfx("coin");
    for (const m of toBuy) econ.add(m, 1);
    for (const m of set) if (!isWorn(m)) equip(m);          // wear the whole set
    CBZ.city.big("💎💎 ICED OUT — full set" + (price > 0 ? " for " + fmt$(price) : "") + "!");
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
    CBZ.city.note("💰 Paid off the cops — down to " + (stars - 1) + "★ (" + fmt$(cost) + ")", 2.2);
    if (CBZ.sfx) CBZ.sfx("coin"); render();
  }
  function train() { if (CBZ.city.spend(100)) { CBZ.player.maxHp = (CBZ.player.maxHp || 100) + 10; CBZ.player.hp = CBZ.player.maxHp; CBZ.city.addRespect(1); CBZ.city.note("Trained — max HP " + CBZ.player.maxHp, 1.8); render(); } }
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
    CBZ.city.note("🍸 Drink — loosened up. That's gonna add up...", 1.8);
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
    if (CBZ.cityVendorRefuses && CBZ.cityVendorRefuses(_v)) { CBZ.city.note("🚫 “We're closed. To YOU. Get out.”", 2.2); return; }
    openLot = lot; CBZ.cityMenuOpen = true;
    qty = 1; haggle = 0; haggleTried = false; closetOpen = false;   // reset per visit
    el().style.display = "block";
    if (CBZ.sfx) CBZ.sfx("door");
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
  const _jobOf = (p) => (p && p.job) || "";
  const _jclass = (p) => { const J = CBZ.cityJobs && CBZ.cityJobs[_jobOf(p)]; return J ? J.class : ""; };

  // is this storefront LOCKED UP for the night? Only the banker's-hours kinds
  // shut (the diner, the gas pump, the bar and the trap never close); hours
  // come off the same sun clock the keepers' timetables run on.
  const SHUT_KINDS = { bank: 1, cityhall: 1, realtor: 1, clothing: 1, barber: 1, electronics: 1, jewelry: 1, carlot: 1 };
  function shopShut(lot) {
    if (!lot || !SHUT_KINDS[lot.kind]) return false;
    const h = CBZ.citySunHour ? CBZ.citySunHour() : 12;
    return h < 7 || h >= 21;
  }

  // the QUIET TILL: the keeper's dead or gone and the drawer is just sitting
  // there. Reaching over the counter is petty theft, not a stick-up — the
  // heat is witness-gated (cityCrime without `instant`), so an empty street
  // means a clean grab. Smaller take than the armed version, long refill.
  function quietTill(lot) {
    const est = tillEstimate(lot.kind);
    const take = Math.max(15, Math.round(est * (0.45 + Math.random() * 0.35)));
    lot._tillSneakT = _sNow() + 300000;              // ms — the drawer refills slowly (~5 min)
    CBZ.city.addCash(take);
    if (CBZ.sfx) CBZ.sfx("coin");
    const d = lot.building && lot.building.door;
    if (CBZ.cityCrime) CBZ.cityCrime(40, { x: d ? d.x : CBZ.player.pos.x, z: d ? d.z : CBZ.player.pos.z, type: "till grab" });
    CBZ.city.note("🤫 Cleaned the drawer — " + fmt$(take) + ". Nobody watching.", 2);
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
    if (CBZ.sfx) CBZ.sfx("door");
    CBZ.city.note("🚕 Dropped across town — " + fmt$(fare) + " on the meter.", 2.2);
  }

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
        { id: "till-sneak", slot: "e", bad: true,
          label: (t) => "Clean out the drawer (~" + fmt$(Math.round(tillEstimate(t.lot.kind) * 0.6)) + ")",
          canShow: (t) => canRobTill(t.lot.kind) && _sNow() > (t.lot._tillSneakT || 0),
          onSelect: (t) => quietTill(t.lot) },
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
        CBZ.city.note("🍛 Hot plate, straight off the grill.", 1.8);
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
        CBZ.city.note("💈 Edges cleaned up — sharper already.", 1.6);
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
        CBZ.city.note("🧰 Tool bag over the counter — ready to work.", 1.8);
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
    I.register("ped:vendor", {
      id: "vendor-retainer", slot: "l", prio: 12, role: "security",
      canShow: (v) => !!v.vendor && !v.dead && _sNow() > (v._retainerT || 0),
      label: () => "Collect the watch retainer — $40",
      onSelect: (v) => {
        v._retainerT = _sNow() + 600000;           // ms — one collection per keeper per long while
        CBZ.city.addCash(40);
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
      label: (p) => { const c = fixableCar(p); return "Pay " + _first(p.name) + " to fix your ride — " + fmt$(c ? fixPrice(c) : 0); },
      onSelect: (p) => {
        const c = fixableCar(p); if (!c) return;
        const price = fixPrice(c);
        if (!CBZ.city.spend(price)) { CBZ.city.note("Repairs run " + fmt$(price) + " — you're short.", 1.6); return; }
        c.engineHp = 100; c._smoking = false;
        p.cash = (p.cash | 0) + price;
        if (CBZ.sfx) CBZ.sfx("coin");
        if (CBZ.citySay) CBZ.citySay(p, "“Runs better than it looks. We're square.”", "#cfe6ff", 2.2);
        CBZ.city.note("🔧 Engine patched — she'll run.", 1.8);
      },
    });
    // a cab driver takes a fare across town (they won't carry a hot one)
    I.register("ped:civ", {
      id: "ped-cab-ride", slot: "k", prio: 43,
      canShow: (p, ctx) => !ctx.driving && !p.dead && !p.rage && p.state !== "flee" &&
        _jobOf(p) === "cab driver" && (ctx.wanted | 0) < 2,
      label: () => "Flag a ride across town — " + fmt$(cabFare()),
      onSelect: (p) => cabRide(p),
    });
    // a cart vendor sells off the cart — cheap calories without a counter
    I.register("ped:civ", {
      id: "ped-cart-bite", slot: "k", prio: 41,
      canShow: (p) => !p.dead && !p.rage && p.state !== "flee" && _jobOf(p) === "street vendor",
      label: (p) => "Buy a bite off " + _first(p.name) + "'s cart — $8",
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
      label: (p) => "Slip " + _first(p.name) + " a fifty — eyes elsewhere",
      onSelect: (p) => {
        if (!CBZ.city.spend(50)) { CBZ.city.note("You need a whole fifty to grease anyone.", 1.4); return; }
        p.snitch = 0; p.reactCD = Math.max(p.reactCD || 0, 90);
        p.cash = (p.cash | 0) + 50;
        if (CBZ.citySay) CBZ.citySay(p, "“Didn't see a thing.”", "#cfe6ff", 2.2);
      },
    });
  });
})();
