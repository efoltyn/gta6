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
  const OUTFITS = [
    { name: "Tracksuit", cost: 180, swag: 3 },
    { name: "Tailored Suit", cost: 900, swag: 8 },
    { name: "Designer Drip", cost: 1400, swag: 12 },
    { name: "Goon Hoodie", cost: 120, swag: 2 },
    { name: "Leather Jacket", cost: 520, swag: 6 },
    { name: "All Black Tactical", cost: 700, swag: 7 },
  ];

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
      CBZ.city.note("👕 Put on " + nm + " — DRIP " + before + "→" + after, 1.6);
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
    CBZ.city.note("Stripped down — DRIP " + before + "→" + after, 1.6);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    render();
  }

  function render() {
    const econ = CBZ.cityEcon, lot = openLot; if (!lot) return;
    const kind = lot.kind, name = lot.building.name;
    const stock = econ.stockFor(kind);
    listItems = stock.slice(0, 9);
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
        // the per-item tag: food shows heal, guns "gun"; a WEARABLE shows its
        // slot + drip value so its status contribution is legible at a glance.
        const slot = wear ? slotOf(it) : null;
        const tagN = kind === "food" ? "+" + (meta.heal || 0) + "hp"
          : (meta.gun ? "gun" : (wear ? (slot ? slot + " · " : "") + "+" + (meta.drip || 0) + " drip" : meta.tag));
        const worn = wear && isWorn(it);
        const line = qty > 1 ? (fmt$(each) + " ea · " + fmt$(each * qty) + "/×" + qty) : fmt$(each);
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
          "</span><span style='color:#7ed957'>" + line + "</span></div>";
      });
    }
    // BARBER chair / CLOTHING styling (real cosmetic restyle that nudges swagger)
    const styles = styleMenu(kind);
    if (styles.length) {
      const label = kind === "barber" ? "BARBER CHAIR" : "FITTING ROOM";
      html += "<div style='font-size:12px;color:#9fb0c6;margin:8px 0 2px'>" + label +
        " <span style='color:#7f8794'>· current: " + (kind === "barber" ? look().hair : look().outfit) + "</span></div>";
      styles.forEach((s, i) => {
        const letter = String.fromCharCode(97 + i);  // a,b,c...
        html += "<div style='display:flex;justify-content:space-between;padding:2px 0'><span><b style='color:#7fd0ff'>" + letter.toUpperCase() + "</b> " +
          s.name + " <span style='color:#7f8794;font-size:11px'>(+" + s.swag + " swagger)</span></span><span style='color:#7ed957'>" + fmt$(s.cost) + "</span></div>";
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

  // styling menus (cosmetic restyle that grants a small standing swagger bonus)
  function styleMenu(kind) {
    if (kind === "barber") return HAIRCUTS;
    if (kind === "clothing") return OUTFITS;
    return [];
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
        CBZ.city.big("💰 PAWNED " + jackpotItem + " for " + fmt$(jackpotEach) + "!");
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
      CBZ.city.big("💎 DRIP " + before + "→" + after + " — you'd clear the rope now!");
    } else if (before < VIP && after >= VIP && CBZ.city.big) {
      CBZ.city.big("✦ DRIP " + before + "→" + after + " — VIP-tier fit!");
    } else {
      CBZ.city.note("💎 Now wearing " + name + (replaced ? " (over " + replaced + ")" : "") +
        " — DRIP " + before + "→" + after, 1.8);
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
    const cur = kind === "barber" ? look().hair : look().outfit;
    if (cur === s.name) { CBZ.city.note("You're already rocking that.", 1.4); return; }
    if (!CBZ.city.spend(s.cost)) { CBZ.city.note("Need " + fmt$(s.cost) + " for that.", 1.6); if (CBZ.sfx) CBZ.sfx("glass"); return; }
    // swagger replaces the prior style's swagger contribution (no stacking)
    const prevSwag = stylePrevSwag(kind, cur);
    look().swagger = Math.max(0, (look().swagger || 0) - prevSwag + s.swag);
    if (kind === "barber") look().hair = s.name; else look().outfit = s.name;
    CBZ.city.addRespect(Math.max(1, Math.round(s.swag / 2)));
    if (CBZ.sfx) CBZ.sfx("coin");   // real payment-confirm sound (was a DIY "whoosh" for cuts)
    CBZ.city.note((kind === "barber" ? "💈 Fresh cut: " : "🧥 New fit: ") + s.name + " (+" + s.swag + " swagger)", 2);
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
    CBZ.city.note("📱 Phone upgraded to tier " + g.cityPhoneTier + " — better deals & street intel.", 2.2);
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
  function buyCar() {
    if (!CBZ.city.spend(1500)) { CBZ.city.note("Need $1,500 for a car.", 1.6); return; }
    const A = CBZ.city.arena, door = openLot.building.door;
    if (CBZ.citySpawnOwnedCar) CBZ.citySpawnOwnedCar(door.x + door.nx * 3, door.z + door.nz * 3);
    CBZ.city.note("Your new ride is parked out front!", 2.2);
    close();
  }

  // ---- open / close + input ----
  function open(lot) {
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
    // barber / clothing restyle (letters a..g map to the style list)
    const styles = styleMenu(openLot.kind);
    if (styles.length && k >= "a" && k <= "z") {
      const idx = k.charCodeAt(0) - 97;
      if (idx < styles.length) {
        // don't hijack a letter that's also a service key
        if (!services(openLot.kind).some((s) => s.key === k)) { e.preventDefault(); restyle(openLot.kind, idx); return; }
      }
    }
    const svc = services(openLot.kind).find((s) => s.key === k);
    if (svc) { e.preventDefault(); svc.fn(); }
  });
})();
