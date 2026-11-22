/* ============================================================
   city/shops.js — WHAT A COUNTER IS: the one way goods change hands, what
   you can ask the person behind it, and the cash a shop holds (CBZ.cityTill).

   THE MENU IS GONE (2026-11-22). Every counter in Gang City used to open one
   panel: a numbered price list, lettered services, a bulk multiplier, a
   closet. The owner: "No dashboards are needed. Everything can be existing
   in the world." So a shop is its room. Its goods stand on its shelves, its
   racks and under its glass and you pick them up (city/storegoods.js,
   gunstore.js, jewelry.js, pawnshop.js, clothingstore.js, dealership.js),
   you pay the person behind the counter (CBZ.shopFloor.till), and walking
   out with them unpaid is a theft. What is left to ask a clerk is asked OF
   the clerk: the rows below are options on him in the city's one
   interaction card (city/interactions.js), nothing else.

     acquire / CBZ.cityShopAcquire   the one path a bought or pocketed unit
                                     takes into your bag, your hands, onto
                                     your body
     counterRows(v)                  what this clerk can do for you: the
                                     trade's service (a doctor patches you,
                                     a trainer trains you, a barber cuts
                                     your hair, a bartender pours), anything
                                     he keeps behind the counter and hands
                                     over, what he will buy off you, a price
                                     talked down, a civic desk's business
                                     (city/civic.js), and work
     CBZ.cityTill                    the ledger: a register, a drop safe, a
                                     vault are balances, and a take moves one
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const g = CBZ.game;

  // ---- WHAT YOU WEAR. The outfit is economy.js's slotted model (g.cityOutfit):
  // a wearable EQUIPS into its slot, a new top replaces the old one, and your
  // drip is whatever is on you (CBZ.cityPlayerDrip, the bouncer's read).
  function isWorn(name) { return CBZ.cityIsEquipped ? !!CBZ.cityIsEquipped(name) : false; }
  function equipItem(name) { return CBZ.cityEquip ? !!CBZ.cityEquip(name) : false; }
  function slotOf(name) {
    if (CBZ.cityEcon && CBZ.cityEcon.slotOf) return CBZ.cityEcon.slotOf(name);
    const it = CBZ.cityEcon && CBZ.cityEcon.ITEMS[name];
    return it && it.tag === "wearable" ? (it.slot || null) : null;
  }
  function wornInSlot(slot) {
    const o = (CBZ.cityEcon && CBZ.cityEcon.outfit) ? CBZ.cityEcon.outfit() : (g.cityOutfit || {});
    return (o && o[slot]) || "";
  }
  function look() {
    g.cityLook = g.cityLook || { hair: "Default", outfit: "Streetwear", swagger: 0 };
    return g.cityLook;
  }
  function playerDrip() {
    if (CBZ.cityPlayerDrip) return CBZ.cityPlayerDrip() | 0;
    if (CBZ.cityEcon && CBZ.cityEcon.drip) return CBZ.cityEcon.drip() | 0;
    return 0;
  }
  CBZ.cityLook = look;

  function fmt$(n) { return "$" + (n | 0); }
  // a store where what you buy goes straight on you
  function isBoutique(kind) { return kind === "clothing" || kind === "boutique" || kind === "jewelry" || kind === "barber" || kind === "eyewear"; }

  // ---- what a counter BUYS off you -------------------------------------------
  function sellable(kind) {
    const inv = g.cityInv || {}, econ = CBZ.cityEcon, out = [];
    for (const k in inv) {
      const it = econ.ITEMS[k]; if (!it) continue;
      // don't offer to sell something you're currently WEARING (flex stays on)
      if ((kind === "jewelry" || kind === "pawn") && isWorn(k) && inv[k] <= 1) continue;
      // pawn buys anything; jewelry buys wearables; others buy their own tags.
      // A GROCER/DINER BUYS YOUR GAME: wild meat and a fresh catch are tag
      // "food" (city/wildlife.js: they are things you EAT), so a hunter can
      // sell a boar's meat where venison goes. `wild` keeps it to what you
      // harvested; the counter does not buy back your half-eaten burger.
      const ok = kind === "pawn" || (kind === "jewelry" && it.tag === "wearable") ||
        (kind === "electronics" && it.tag === "valuable") || it.tag === "valuable" ||
        (kind === "food" && it.tag === "food" && it.wild);
      if (ok) out.push({ name: k, n: inv[k] });
    }
    return out;
  }
  function sellTotal(kind) { let t = 0; for (const s of sellable(kind)) t += CBZ.cityEcon.sellPrice(s.name, kind) * (isWorn(s.name) ? Math.max(0, s.n - 1) : s.n); return t; }
  function sellAll(kind) {
    const econ = CBZ.cityEcon; let got = 0, n = 0;
    // the single fattest piece in the batch gets the headline when it is a score
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
      if (jackpotItem && jackpotEach >= 50000 && CBZ.city.big) {
        CBZ.city.note(fmt$(jackpotEach) + " received, pawn sale: " + jackpotItem + ".", 2.4, { from: "Liberty Bank", app: "bank" });
        if (n > 1) CBZ.city.note("…plus the rest of the haul · " + fmt$(got) + " total.", 2);
      } else {
        CBZ.city.note("Sold " + n + " for " + fmt$(got), 1.8);
      }
    }
    return got;
  }

  // ---- buying -------------------------------------------------------------
  //  ONE ACQUIRE PATH. A unit off a shelf (city/storegoods.js), a thing handed
  //  over a counter (counterRows below) and a pocketed one all land through
  //  this: the same money, the same bag, the same equip-on-buy for a wearable.
  //  `free` is "no money moves here" (pocketed, or already rung up at the
  //  shop's till: `bought`).
  function acquire(lot, it, n, each, free, bought) {
    const econ = CBZ.cityEcon, meta = econ.ITEMS[it];
    if (!meta || !CBZ.city) return false;
    const kind = (lot && lot.kind) || "";
    const total = each * n;
    if (!free) {
      if (!CBZ.city.spend(total)) {
        CBZ.city.note("Can't afford " + (n > 1 ? n + "× " : "") + it + " (" + fmt$(total) + ")", 1.6);
        return false;
      }
      // E7: Ironclad Arms books half of every player gun-store purchase as
      // real revenue (sim/corporations.js's creditRevenue).
      if (kind === "guns" && CBZ.corps && CBZ.corps.creditRevenue) CBZ.corps.creditRevenue("ironclad", total * 0.5);
      if (CBZ.sfx) CBZ.sfx("coin");
    }
    if (kind === "food" && meta.heal) {
      // YOU BUY FOOD, THEN YOU EAT IT: the counter hands you the goods and you
      // eat ONE through the one eat path (city/hunger.js: chew beat, sfx,
      // note); the rest ride in your bag.
      econ.add(it, n);
      const ate = CBZ.cityEat ? CBZ.cityEat(it) : false;
      if (n > 1) CBZ.city.note((n - (ate ? 1 : 0)) + "× " + it + " in the bag", 1.4);
      else if (!ate) CBZ.city.note("Bought " + it, 1.4);
    }
    else if (meta.gun || meta.melee) { econ.add(it, 1); CBZ.cityGiveWeapon(it); }
    else if (meta.rounds) { CBZ.cityAddAmmo(meta.rounds * n); CBZ.city.note("+" + (meta.rounds * n) + " ammo", 1.4); }
    else if (meta.armor) { CBZ.player._armor = Math.min(100, (CBZ.player._armor || 0) + meta.armor); CBZ.city.note("Body Armor on (+" + meta.armor + ")", 1.6); }
    else if (meta.tag === "wearable") {
      // OWN it first, THEN wear it: a boutique / jeweller / barber counter puts
      // the piece on you, so it counts toward your drip at once.
      econ.add(it, n);
      if (isBoutique(kind)) equip(it);
      else CBZ.city.note((free && !bought ? "Pocketed " : "Bought ") + (n > 1 ? n + "× " : "") + it, 1.4);
    }
    else { econ.add(it, n); CBZ.city.note((free && !bought ? "Pocketed " : "Bought ") + (n > 1 ? n + "× " : "") + it, 1.4); }
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  /* THE SHELF'S DOOR INTO THIS FILE (city/storegoods.js). opts.free: no money
     moves here (pocketed, or already rung up at the shop's till: opts.bought).
     Returns true only if it actually happened. */
  CBZ.cityShopAcquire = function (lot, name, n, opts) {
    const meta = CBZ.cityEcon && CBZ.cityEcon.ITEMS[name];
    if (!meta || !CBZ.city || !lot) return false;
    const single = !!(meta.gun || meta.melee || meta.armor);
    const cnt = single ? 1 : Math.max(1, n | 0);
    const free = !!(opts && opts.free);
    return acquire(lot, name, cnt, free ? 0 : CBZ.cityEcon.buyPrice(name), free, !!(opts && opts.bought));
  };

  // Put a wearable you OWN onto your body via the shared outfit model
  // (CBZ.cityEquip fills its slot, replacing whatever's there). Respect is
  // given ONCE per piece; crossing the club's rope by dressing is a moment.
  function equip(name) {
    const meta = CBZ.cityEcon.ITEMS[name]; if (!meta || meta.tag !== "wearable") return;
    if (isWorn(name)) return;
    const before = playerDrip();
    const slot = slotOf(name);
    const replaced = slot ? wornInSlot(slot) : "";
    if (!equipItem(name)) { CBZ.city.note("Bought " + name + ".", 1.4); return; }
    const after = playerDrip();
    g.cityDripRewarded = g.cityDripRewarded || {};
    if (!g.cityDripRewarded[name] && meta.drip) { CBZ.city.addRespect(meta.drip); g.cityDripRewarded[name] = true; }
    const CLUB = (CBZ.CITY && CBZ.CITY.CLUB_DRIP) || 30, VIP = (CBZ.CITY && CBZ.CITY.VIP_DRIP) || 70;
    if (before < CLUB && after >= CLUB && after < VIP && CBZ.city.big) CBZ.city.big("That fit turns heads, the Velvet's rope would open for you.");
    else if (before < VIP && after >= VIP && CBZ.city.big) CBZ.city.big("Dressed like money, the Velvet's elite lounge would wave you up.");
    else CBZ.city.note("Now wearing " + name + (replaced ? " (over " + replaced + ")" : "") + ".", 1.8);
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
  // ONE bank in the world is not a branch — see vaultTierOf() / reserveHolds().
  // Off → every bank is an ordinary branch and the numbers are byte-identical
  // to what shipped.
  if (CBZ.CONFIG.TILL_RESERVE_VAULT == null) CBZ.CONFIG.TILL_RESERVE_VAULT = true;

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
    // stick-up-able register here (a bank's money is its tellers' drawers and
    // its vault, city/bank.js).
    if (kind === "bank" || kind === "realtor" || kind === "carlot" || kind === "chop") return false;
    return TILL[kind] != null;
  }

  // ---- the clock: HOURS SINCE MIDNIGHT, monotonic, read straight off the sky -
  // WORLD TIME: a till is "the day's takings so far" and the shutters follow
  // the sky's hours, so this IS the sky calendar: core/daynight.js's
  // CBZ.dayTime() (days since boot, 0 = sunrise) in hours. The city day is a
  // 48-minute GTA day now; nothing here types a day length.
  //
  // It used to be a private copy (`const T_DAY_SECS = 150`) advanced by
  // CBZ.now — which is MILLISECONDS, so the till clock ran 1000x fast — and
  // before that `CBZ.now * T_HPS` from load, which gave a fresh world empty
  // drawers. Reading the sky directly fixes both: a world that boots at 09:00
  // has ALREADY TRADED ALL MORNING, sleep/wait skips move the tills with the
  // sun, and there is no second clock to drift. Monotonic: only a deliberate
  // rewind of the sky (a preset / tool setting dayPhase back) re-anchors it.
  let _lastH = -1;
  function absH() {
    const h = (CBZ.dayTime ? CBZ.dayTime() : 0) * 24 + 6;
    if (h >= _lastH || h < _lastH - 1) _lastH = h;    // tiny backward jitter never reverses time
    return _lastH;
  }
  // exposed so a world rebuild can re-anchor deliberately.
  function tillClockReset() { _lastH = -1; }

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
  const HIT_FADE_DAYS = 3;     // PACE days (core/daynight.js) a shop remembers being stuck up
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
    // GAMEPLAY PACE: the grudge fades over HIT_FADE_DAYS PACE days of real play
    // (3 x 150 s), converted into the sky hours absH() counts in.
    const fadeH = HIT_FADE_DAYS * CBZ.PACE_DAY_SECONDS / CBZ.hourSeconds();
    const f = Math.min(1, 1 - age / fadeH);
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
    // the vault's own cycle is a QUERY, not a constant: a reserve banks
    // quarterly and a branch weekly (see vaultCycleH / the RESERVE header).
    const sched = pt === "register" ? boundary(now, dropHours(lot), lotPhase(lot, "tilldrop"))
                : pt === "safe" ? boundary(now, bankHours(lot), lotPhase(lot, "tillbankph"))
                : boundary(now, vaultCycleH(lot), lotPhase(lot, "tillvault"));
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
      out.why = (src.kind && shopShutSoft(src)) ? "shut, the drawer's dropped for the night" : "already emptied";
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
  // single branch — which lands inside the researched $120k-$250k band for a
  // high-street branch's cash vault. The research validates the derivation;
  // it is not the source of the number.
  /* ==========================================================================
     THE RESERVE — WHY ONE VAULT IN THE WORLD HOLDS TENS OF MILLIONS.

     OWNER (2026-08-02): "realistic amounts of money — even 10s or 100s of
     millions can be in these things."

     A BRANCH cannot honestly hold that and this file already proves why: a
     branch vault is the district's banked retail cash over a weekly pickup,
     which lands at $120k-$250k, and that IS what a high-street branch holds.
     Typing a bigger number on a branch would be the exact "dumb hardcoded
     limit" the whole ledger exists to delete.

     But a city does not only have branches. It has ONE cash-processing centre
     — the place the armoured trucks actually drive to, where the notes of the
     whole city sit between the tills and the shredder. That building can
     honestly hold two orders of magnitude more, and the number is still
     DERIVED from this ledger and nothing else.

     THE DERIVATION, and it is checked two independent ways because a number
     this big has to be defensible:

       C = Σ over every district of districtCash(d).cash
           = dollars of PHYSICAL CASH per average trading hour that the
             businesses of this city take in. Every term is already in this
             file and is already bounded by what the cohort sim spent.

       (a) BY CYCLE. A cash centre banks on a quarterly armoured cycle, not a
           weekly one, so it holds C × (24 × 90) average trading hours.
       (b) BY FLOAT. Published US figures: currency in circulation (~$2.3T)
           runs ~2.3x annual CASH retail sales (~$1T), and ~10-13% of currency
           outstanding sits in Reserve Bank + commercial bank vaults rather
           than in wallets and tills. So the vaulted note float is
           C × 8760 × 2.3 × 0.12 = C × 2418.

     (a) gives C × 2160 and (b) gives C × 2418 — within 12% of each other from
     two unrelated anchors, which is the reason to believe either. We take the
     CYCLE form, because it is the one that also has to be true of the refill:
     empty the reserve and it takes a real quarter of the city's whole cash
     intake to fill again. There is no cooldown here, exactly as there is none
     anywhere else in this file — the emptiness IS the cooldown, and at this
     scale the emptiness lasts.

     WHAT THIS DOES *NOT* DO: it does not mint. Every dollar of C already
     passed through a shop's drawer in this model, and the reserve is where
     those dollars physically SIT afterwards. It also scales with the world
     rather than with a constant: a 10x city (GAMEPLAN's scale pillar) has 10x
     the shops, therefore 10x C, therefore a reserve in the hundreds of
     millions — with no number in this file changed. The owner's upper figure
     is a function of the map, not of a literal.
     ========================================================================= */
  const RESERVE_CYCLE_DAYS = 90;
  // which cash cycle a vault runs on, in hours. A branch and a casino count
  // room bank weekly; the reserve banks quarterly.
  function vaultCycleH(lot) {
    return vaultTierOf(lot) === "reserve" ? 24 * RESERVE_CYCLE_DAYS : 24 * 7;
  }
  // WHICH bank is the reserve. Deterministic and derived from the world, never
  // authored: the biggest bank building in the city is its cash centre, ties
  // broken by position hash so a seed always picks the same one. Cached per
  // arena object, so a rebuild re-picks and a demolished reserve is re-elected.
  let _resArena = null, _resLot = null;
  function reserveLot() {
    if (!CBZ.CONFIG.TILL_RESERVE_VAULT) return null;
    const A = CBZ.city && CBZ.city.arena;
    if (!A) return null;
    if (_resArena === A && _resLot && !_resLot.demolished) return _resLot;
    _resArena = A; _resLot = null;
    const lots = A.shopLots || A.lots || [];
    let best = null, bw = -1;
    for (let i = 0; i < lots.length; i++) {
      const L = lots[i];
      if (!L || L.demolished || L.kind !== "bank" || !L.building) continue;
      // frontage is this file's own size measure; the hash is a stable
      // tie-break, never a re-roll.
      const w = frontage(L) + (CBZ.hash01 ? CBZ.hash01(L.cx, L.cz, "tillreserve") * 0.5 : 0);
      if (w > bw) { bw = w; best = L; }
    }
    _resLot = best;
    return _resLot;
  }
  // "branch" | "reserve" | "count" | "" — the ONE answer to "what grade of
  // vault is this", so bank.js draws a strongroom or a blast-door cash centre
  // off the same fact the money comes from.
  function vaultTierOf(lot) {
    if (!lot || lot._tillSpec) return "";
    if (lot.kind === "casino") return "count";
    if (lot.kind !== "bank") return "";
    return (CBZ.CONFIG.TILL_RESERVE_VAULT && reserveLot() === lot) ? "reserve" : "branch";
  }
  // C — the city's physical cash intake, dollars per average trading hour.
  // Summed over districts through the SAME districtCash() a branch vault and
  // an armoured truck's load are derived from, so the three can never disagree.
  function cityCashFlow() {
    const A = CBZ.city && CBZ.city.arena, lots = (A && A.shopLots) || [];
    const seen = {};
    let c = 0;
    for (let i = 0; i < lots.length; i++) {
      const L = lots[i]; if (!L || L.demolished || !L.kind) continue;
      const dk = tillDistrict(L);
      if (seen[dk]) continue;
      seen[dk] = 1;
      c += districtCash(dk).cash;
    }
    return c;
  }

  function vaultAmount(lot, hrs, fallback) {
    if (lot.kind !== "bank" && lot.kind !== "casino") return fallback;
    const A = CBZ.city && CBZ.city.arena, lots = (A && A.shopLots) || [];
    const dk = tillDistrict(lot);
    if (vaultTierOf(lot) === "reserve") {
      // THE CASH CENTRE. `hrs` is already integrated over the quarterly window
      // (vaultCycleH), so this is C × the trading hours actually elapsed since
      // the last pickup — the same arithmetic a branch runs, over a bigger
      // scope and a longer cycle. A reserve you emptied yesterday is empty.
      const c = cityCashFlow();
      if (c > 0) return c * Math.max(0, hrs);
      return fallback;
    }
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
    // A HOSTILE TAKE BY YOUR HAND IS A ROBBERY, whatever was robbed: a
    // register at gunpoint, a drawer nobody is watching, a drop safe, a
    // teller's window, a vault, a truck. They all pass through this line and
    // nowhere else, so this is where city/stickup.js hears of it: the take
    // is hot until you are clear, and the men who were in on it are owed.
    if (opts.by === "player" && (opts.rob || (src._tillSpec && src._tillSpec.kind === "armored")) && CBZ.cityStickup) {
      try { CBZ.cityStickup.took(src, want, h.point); } catch (e) {}
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
    // WHAT GRADE OF VAULT THIS IS, and the city-scale number behind it. Read by
    // city/bank.js (a strongroom vs a cash centre — different door, different
    // room, different guard) and city/casino.js (the count room). The MONEY and
    // the ARCHITECTURE come from the same fact, so they can never disagree.
    vaultTier: vaultTierOf,
    reserveLot: reserveLot,
    cityCashFlow: cityCashFlow,
    vaultCycleH: vaultCycleH,
    // "when does this place next get cleared out on its own", in game hours —
    // exposed so a UI can say "bank run in 6 h" instead of inventing a timer.
    nextClear: function (lot, pt) {
      if (!lot || lot._tillSpec) return 0;
      const now = absH();
      const per = pt === "safe" ? bankHours(lot) : pt === "vault" ? vaultCycleH(lot) : dropHours(lot);
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
      // THE VAULT LADDER, as numbers, so "tens of millions" is a measurement
      // and not a claim. `cityCashFlow` is C in the RESERVE header; `reserve`
      // is what the cash centre holds RIGHT NOW (it fills over a quarter, so
      // a freshly-built world reads a fraction of `reserveFull`); `branchHi`
      // is the fattest ordinary branch, and the RATIO of the two is the whole
      // point of the tier existing at all. NOT PINNED — measure and record.
      cityCashFlow: Math.round(cityCashFlow()),
      reserve: (function () { const L = reserveLot(); return L ? holds(L, { point: "vault" }).amount : 0; })(),
      reserveFull: Math.round(cityCashFlow() * 24 * RESERVE_CYCLE_DAYS),
      branchHi: (function () {
        const A = CBZ.city && CBZ.city.arena, ls = (A && A.shopLots) || [];
        let hi2 = 0;
        for (let i = 0; i < ls.length; i++) {
          const L = ls[i];
          if (!L || L.kind !== "bank" || L.demolished || vaultTierOf(L) === "reserve") continue;
          const v = holds(L, { point: "vault" }).amount; if (v > hi2) hi2 = v;
        }
        return hi2;
      })(),
      banks: (function () {
        const A = CBZ.city && CBZ.city.arena, ls = (A && A.shopLots) || [];
        let n = 0; for (let i = 0; i < ls.length; i++) if (ls[i] && ls[i].kind === "bank" && !ls[i].demolished) n++;
        return n;
      })(),
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
  // ============================================================
  //  WHAT YOU CAN ASK THE PERSON BEHIND THE COUNTER.
  // ------------------------------------------------------------
  //  These were the lettered rows of the storefront panel. They are the
  //  clerk's own options now (the "ped:vendor" layer of the one interaction
  //  card, registered at the foot of this file): look at him and I J K L are
  //  the first four, the Q wheel the rest. Each is a thing a person behind a
  //  counter does: he says it, he hands it over, his hands do the work.
  // ============================================================
  function vsay(v, text, secs) {
    if (v && !v.dead && CBZ.citySay) { try { CBZ.citySay(v, text, null, { secs: secs || 2.4, force: true }); return true; } catch (e) {} }
    return false;
  }
  function tell(v, text) { if (!vsay(v, text)) CBZ.city.note(text, 2); }
  // HANDED OVER, NOT MINTED: he holds it out, your hand takes it out of his
  // (CBZ.verbs.takeFrom at his wrist), and only then is it yours.
  function handOver(v, kind, then) {
    const V = CBZ.verbs;
    let S = null, done = false;
    const fin = function () { if (done) return; done = true; then(); };
    v._faceT = Math.max(v._faceT || 0, 1.6);
    if (V && V.takeFrom) { try { S = V.takeFrom(CBZ.player, v, { at: "wristR", kind: kind || "box", pose: "grip", dur: 0.55, onTaken: fin }); } catch (e) { S = null; } }
    if (!S) fin();
  }
  // HAGGLING. You work the clerk once a visit; what he gives is off everything
  // he rings up for you (CBZ.shopFloor.till reads the same field) and off what
  // he hands over. Respect and the clothes on your back are the odds.
  const HAGGLE_HOLD = 300;                       // seconds a deal (or a refusal) stands
  function haggleOf(v) {
    const h = v && v._haggle;
    if (!h) return null;
    if ((CBZ.now || 0) / 1000 - h.t > HAGGLE_HOLD) { v._haggle = null; return null; }
    return h;
  }
  function haggle(v) {
    if (haggleOf(v)) return;
    const rep = (g.respect || 0), swag = playerDrip();
    const odds = Math.min(0.85, 0.4 + rep / 800 + swag / 120);
    const roll = Math.random();
    let cut = 0;
    if (roll < odds) cut = Math.min(0.18, 0.05 + Math.random() * 0.13 + Math.min(0.05, swag / 300));
    v._haggle = { cut: cut, t: (CBZ.now || 0) / 1000 };
    if (cut > 0) { if (CBZ.sfx) CBZ.sfx("coin"); vsay(v, "Alright. " + Math.round(cut * 100) + " off, for you. Today."); }
    else if (roll > 0.93 && rep < 40) vsay(v, "You're insulting me. Price is the price.");
    else vsay(v, "Price is the price.");
  }
  function priceAt(v, name) {
    const h = haggleOf(v);
    return Math.max(1, Math.round(CBZ.cityEcon.buyPrice(name) * (1 - (h ? h.cut : 0))));
  }

  // ---- the trades' own services ------------------------------------------------
  function heal(v) {
    const P = CBZ.player;
    if ((P.hp || 0) >= (P.maxHp || 100)) { tell(v, "Nothing wrong with you that I can see."); return; }
    if (!CBZ.city.spend(200)) { tell(v, "It's two hundred to be seen."); return; }
    P.hp = P.maxHp || 100;
    if (CBZ.sfx) CBZ.sfx("coin");
    v.cash = (v.cash | 0) + 200;
    tell(v, "Hold still. There. You'll live.");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  function train(v) {
    const P = CBZ.player;
    if ((P.maxHp || 100) >= 240) { tell(v, "There's nothing left for me to teach you."); return; }
    if (!CBZ.city.spend(100)) { tell(v, "A session's a hundred."); return; }
    P.maxHp = Math.min(240, (P.maxHp || 100) + 10); P.hp = P.maxHp;
    CBZ.city.addRespect(1);
    if (CBZ.sfx) CBZ.sfx("coin");
    tell(v, "Good work. Same again tomorrow.");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  // the fight card is fought at Ironjaw Arena: he points you there
  function fightCard(v) {
    const site = CBZ.arenaFightSite;
    if (site && CBZ.fullMap && CBZ.fullMap.setWaypoint) CBZ.fullMap.setWaypoint(site.x, site.z, site.name);
    tell(v, "Fight nights are out at " + ((site && site.name) || "Ironjaw Arena") + ". Bets are taken ringside.");
  }
  // A ROUND. He pours it and slides it over; you drink it. One is a buzz,
  // several is a stumble (city/drinking.js), and the bar will put you on the
  // floor if you keep ordering.
  function drink(v) {
    if (!CBZ.city.spend(12)) { tell(v, "Twelve a round."); return; }
    if (CBZ.sfx) CBZ.sfx("coin");
    v.cash = (v.cash | 0) + 12;
    handOver(v, "bottle", function () {
      const P = CBZ.player;
      g.hunger = Math.min(100, (g.hunger || 0) + 15);
      P._boost = 12;
      if (P.hp != null && P.maxHp) P.hp = Math.min(P.maxHp, P.hp + 8);
      if (CBZ.cityDrink) CBZ.cityDrink(1);
    });
  }
  // THE CHAIR. A cut is the hair on your head (entities/character.js
  // CBZ.charRestyleHair rebuilds the rig's hair in that style), not a word in
  // a record.
  const HAIRCUTS = [
    { name: "Buzz cut", cost: 25, style: "buzz" },
    { name: "Fade", cost: 35, style: "crop" },
    { name: "Short back and sides", cost: 30, style: "short" },
    { name: "Curls", cost: 55, style: "curly" },
    { name: "Afro", cost: 60, style: "afro" },
    { name: "Locs", cost: 70, style: "locs" },
  ];
  function cutHair(v, cut) {
    const rig = CBZ.playerChar || null;
    if (!CBZ.charRestyleHair || !rig) { tell(v, "Chair's broken. Come back."); return; }
    if (CBZ.charHairStyle && CBZ.charHairStyle(rig) === cut.style) { tell(v, "That's the cut you've got."); return; }
    if (!CBZ.city.spend(cut.cost)) { tell(v, "It's " + fmt$(cut.cost) + " for that."); return; }
    if (!CBZ.charRestyleHair(rig, cut.style)) { CBZ.city.addCash(cut.cost); tell(v, "Nothing there for me to cut."); return; }
    v.cash = (v.cash | 0) + cut.cost;
    look().hair = cut.name;
    g.cityHairStyle = cut.style;
    CBZ.city.addRespect(2);
    if (CBZ.sfx) CBZ.sfx("coin");
    tell(v, "There you go. Sharp.");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
  }
  // a thing he keeps behind the counter: money to him, the thing out of his hand
  function overCounter(v, lot, name) {
    const price = priceAt(v, name);
    if (!CBZ.city.spend(price)) { tell(v, fmt$(price) + ". You're short."); return; }
    if (CBZ.sfx) CBZ.sfx("coin");
    v.cash = (v.cash | 0) + price;
    handOver(v, "box", function () { acquire(lot, name, 1, 0, true, true); });
  }
  function career(kind) { if (CBZ.cityStartCareer) CBZ.cityStartCareer(kind); }

  /* THE ROWS, for the clerk you are looking at. Built from what his counter
     is: the trade, the stock he keeps behind it (anything his shop sells that
     is not standing on its floor: a dealer's product, a counter's coffee),
     what he buys, the civic desk's business. Memoised per clerk for a moment
     (every option's gate and label asks). */
  const ROW_MAX = 14;
  /* WHAT ELSE A CLERK DOES. A file that gives a counter a job registers one
     function here: fn(v, lot, kind, add) is asked every time the rows are
     built and calls add(id, label, run(v), sub?) for each thing this clerk
     will do for you right now. (This is how the things that used to be
     panels are asked of a person: no file opens a screen from a counter.) */
  const ASKS = CBZ._counterAsks || (CBZ._counterAsks = []);
  CBZ.cityCounterAsk = function (fn) { if (typeof fn === "function" && ASKS.indexOf(fn) < 0) ASKS.push(fn); };
  let _rowsOf = null, _rowsAt = -1, _rows = [];
  // is this lot's floor a flagship file's (its goods are on its own racks)?
  function flagship(lot) {
    switch (lot.kind) {
      case "guns":     return !!(CBZ.cityGunWallLive && CBZ.cityGunWallLive(lot));
      case "jewelry":  return !!(CBZ.cityJewelryLive && CBZ.cityJewelryLive(lot));
      case "pawn":     return !!(CBZ.cityPawnLive && CBZ.cityPawnLive(lot));
      case "clothing": return !!(CBZ.cityClothingLive && CBZ.cityClothingLive(lot));
      default:         return false;
    }
  }
  function counterRows(v) {
    const now = CBZ.now || 0;
    if (v === _rowsOf && now - _rowsAt < 200) return _rows;
    _rowsOf = v; _rowsAt = now;
    const R = _rows = [];
    const lot = v && v.vendor, kind = lot && lot.kind;
    if (!lot || !kind || lot.demolished || v.dead || v._keepFree || v.surrender || v.rage) return R;
    if (shopShutSoft(lot)) return R;
    // a clerk you robbed serves you nothing until it fades (city/social.js)
    if (CBZ.cityVendorRefuses && CBZ.cityVendorRefuses(v)) return R;
    const econ = CBZ.cityEcon;
    // (the authored campaign owns progression while it runs: a counter still
    //  sells and serves, it starts no side job, bet or bout under the contract)
    let owned = false;
    try { owned = !!(CBZ.cityCampaignOwnsMission && CBZ.cityCampaignOwnsMission()); } catch (e) { owned = false; }
    const SIDE = { horses: 1, dogs: 1, card: 1, yard: 1, guard: 1, corner: 1, crew: 1, work: 1 };
    // (what you ask a clerk FOR is not the clerk: the row prints as written, not
    //  cut down to its verb, city/verbword.js)
    const VW = CBZ.cityVerbWord;
    const add = function (id, label, fn, sub) {
      if (R.length >= ROW_MAX || (owned && SIDE[id])) return;
      if (VW && VW.keep) VW.keep(label);
      R.push({ id: id, label: label, fn: fn, sub: sub || "" });
    };
    // ---- he has just told you about a job (city/careers.js): your answers
    //      to it are the only things on him until you give one or walk off
    if (CBZ.cityWorkPitch && CBZ.cityWorkPitch(v)) {
      add("work-take", "Take it", function (vv) { CBZ.cityWorkTake(vv); });
      add("work-next", "What else", function (vv) { CBZ.cityWorkNext(vv); });
      return R;
    }
    // ---- the trade
    if (kind === "hospital") add("heal", "Get patched up " + fmt$(200), heal);
    if (kind === "gym") add("train", "Train " + fmt$(100), train);
    if (kind === "bar") add("round", "A round " + fmt$(12), drink);
    if (kind === "barber") for (const cut of HAIRCUTS) add("cut-" + cut.style, cut.name + " " + fmt$(cut.cost), function (vv) { cutHair(vv, cut); });
    if (kind === "racepark") {
      add("horses", "Bet the horses", function (vv) { if (CBZ.cityTrackBook) CBZ.cityTrackBook("horses", vv); });
      add("dogs", "Bet the dogs", function (vv) { if (CBZ.cityTrackBook) CBZ.cityTrackBook("dogs", vv); });
    }
    if (kind === "gym" || kind === "arena") add("card", "Fight card", fightCard);
    if (kind === "chop") add("chop", "Sell a car", function (vv) { tell(vv, "Drive it into the bay out front. I pay on the hook."); });
    if (kind === "realtor" && CBZ.cityHomeMenu && !(CBZ.cityRealtyLive && CBZ.cityRealtyLive(lot))) add("homes", "Homes", function () { CBZ.cityHomeMenu(); });
    // ---- what another file has this clerk do (CBZ.cityCounterAsk above):
    //      the car dealer's trade-in, your own manager's takings and books,
    //      the yacht broker's hulls, the bookmaker's card
    for (let i = 0; i < ASKS.length; i++) {
      try { ASKS[i](v, lot, kind, add); } catch (e) { if (!ASKS[i]._warned) { ASKS[i]._warned = true; console.error("[counter ask]", e); } }
    }
    // ---- the civic desks (city/civic.js keeps its rows next to their logic)
    if (CBZ.civic && CBZ.civic.services) {
      for (const r of CBZ.civic.services(kind)) {
        if (!r || !r.fn) continue;
        const parts = String(r.label || "").split(/<span[^>]*>/);
        add("civic-" + r.key, parts[0].trim(), r.fn, parts[1] ? parts[1].replace(/<[^>]+>/g, "").trim() : "");
      }
    }
    // ---- what he keeps behind the counter and hands over
    if (!flagship(lot)) {
      const onFloor = (CBZ.cityGoodsLive && CBZ.cityGoodsLive(lot)) || null;
      const stock = econ.stockFor(kind) || [];
      for (let i = 0; i < stock.length; i++) {
        const name = stock[i];
        if (!econ.ITEMS[name] || (onFloor && onFloor.indexOf(name) >= 0)) continue;
        add("buy-" + name, name + " " + fmt$(priceAt(v, name)), function (vv) { overCounter(vv, lot, name); });
      }
    }
    // ---- what he buys
    const sell = sellTotal(kind);
    if (sell > 0) add("sell", (kind === "pawn" ? "Fence " : "Sell ") + fmt$(sell), function (vv) { if (sellAll(kind) > 0) vsay(vv, "Pleasure."); });
    // ---- the price, the job, the crew
    // (a jeweller's pieces are priced on their cards: nothing there is rung up to be talked down)
    if (canRobTill(kind) && kind !== "jewelry" && !haggleOf(v) && (econ.stockFor(kind) || []).length) add("haggle", "Haggle", haggle);
    if (kind === "security") add("guard", "Guard work", function () { career("security"); });
    if (kind === "drugs") add("corner", "Work a corner", function () { career("dealer"); });
    if (kind === "bar") add("crew", "Run the night crew", function () { career("pimp"); });
    if (CBZ.cityAskWork) add("work", "Ask about work", function (vv) { CBZ.cityAskWork(vv); });
    return R;
  }
  CBZ.cityCounterRows = function (v) { return counterRows(v).map(function (r) { return { id: r.id, label: r.label }; }); };
  // (other files' "the shop menu is open" guards: there is no menu to be open)
  CBZ.cityShopOpen = function () { return false; };

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
  /* WHAT YOU TOOK IS IN YOUR HANDS: notes in your pocket, or, past what a
     jacket holds, duffels on the floor at your feet that you (and the men
     with you) carry out. One call, CBZ.cashBags.payout, decides which; every
     counter robbery pays through here (the stick-up at gunpoint in
     city/racket.js too) so a fat safe is canvas and a drawer is notes. */
  function toHands(lot, amount) {
    const B = CBZ.cashBags, P = CBZ.player;
    if (!(amount > 0)) return;
    if (B && B.payout && P && P.pos) {
      const vs = lot && lot.building && lot.building.vendorSpot;
      let x = P.pos.x, z = P.pos.z;
      if (vs) { const dx = vs.x - x, dz = vs.z - z, l = Math.hypot(dx, dz) || 1; x += dx / l * 0.7; z += dz / l * 0.7; }
      B.payout(x, P.pos.y || 0, z, amount, { src: lot || null, srcName: (lot && lot.building && lot.building.name) || "the take", spread: 0.7, cap: 6, onFloor: false });
    } else CBZ.city.addCash(amount);
  }
  CBZ.cityTakeToHands = toHands;
  function quietTill(lot) {
    const r = CBZ.cityTill.take(lot, { point: "register", frac: 0.45 + Math.random() * 0.35, by: "player", rob: true });
    const d = lot.building && lot.building.door;
    if (!(r.taken > 0)) {
      CBZ.city.note("Drawer's empty, nothing in it to take.", 1.8);
      return;
    }
    toHands(lot, r.taken);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityCrime) CBZ.cityCrime(40, { x: d ? d.x : CBZ.player.pos.x, z: d ? d.z : CBZ.player.pos.z, type: "till grab" });
    CBZ.city.note("Cleaned the drawer · " + fmt$(r.taken) + ". Nobody watching.", 2);
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
    toHands(lot, r.taken);
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

  // NO CAB RIDE. A "cab driver" here is a man on the pavement with no car,
  // and his Ride verb charged a fare and teleported you to the mirror point
  // across the city core: teleport-for-money. Deleted until a cab is a car
  // that drives you on the roads (systems/roadgraph.js routes it).

  // is this counter shut for the night? (interact.js hides Buy on a shut shop)
  CBZ.cityShopShut = shopShutSoft;

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
      id: "shop-counter-open", kind: "counter", radius: 4.2, islands: true,
      find: function (px, pz) {
        // (the till runs wherever money is real; Gang City's counters are
        //  only reachable in Gang City, an island's come through CBZ.islandVenue)
        const A = CBZ.cityArenaLive ? CBZ.cityArenaLive() : (CBZ.city && CBZ.city.arena); if (!A || !A.shopLots) return null;
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
        // the place and not a constant. An empty drawer offers no verb at all
        // rather than advertising money that is not there.
        { id: "till-sneak", slot: "e", bad: true,
          label: (t) => { const n = CBZ.cityTill.holds(t.lot, { point: "register" }).amount;
                          return "Rob " + fmt$(n); },
          canShow: (t) => canRobTill(t.lot.kind) && CBZ.cityTill.holds(t.lot, { point: "register" }).amount > 0,
          onSelect: (t) => quietTill(t.lot) },
        // the drop safe behind the counter — the fat one, and it is on the
        // shop's OWN deposit-run clock, so a place you cased is worth more.
        { id: "till-safe", slot: "f", bad: true,
          label: (t) => { const n = CBZ.cityTill.holds(t.lot, { point: "safe" }).amount;
                          return "Crack " + fmt$(n); },
          // (a shop whose drop safe is a real safe in its back room, city/gunstore.js, is cracked there)
          canShow: (t) => CBZ.CONFIG.TILL_SAFE_POINTS && !t.lot._realSafe && CBZ.cityTill.points(t.lot).indexOf("safe") >= 0 &&
                          CBZ.cityTill.holds(t.lot, { point: "safe" }).amount > 0,
          onSelect: (t) => crackSafe(t.lot) },
      ],
    });
    I.describe("counter", function (t) {
      const v = t.lot.building && t.lot.building.vendor;
      return {
        label: (t.lot.building && t.lot.building.name) || "Counter",
        note: v && v.dead ? "Register's open, nobody left to watch it" : "Register's open, nobody's watching",
      };
    });

    // THE CLERK'S ROWS (counterRows above): what this counter does for you,
    // as options on the person behind it. One option per row position; each
    // asks the live row list, so a desk whose business changes while you
    // stand at it (a queue being called, a drawer emptied) changes its rows.
    for (let i = 0; i < ROW_MAX; i++) {
      I.register("ped:vendor", {
        id: "counter-row-" + i, prio: 86 - i,          // (his trade comes before the street's verbs about him)
        canShow: (v) => !!v.vendor && !!counterRows(v)[i],
        label: (v) => { const r = counterRows(v)[i]; return r ? r.label : ""; },
        sub: (v) => { const r = counterRows(v)[i]; return r ? r.sub : ""; },
        onSelect: (v) => { const r = counterRows(v)[i]; _rowsAt = -1; if (r) r.fn(v); },
      });
    }
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
      label: () => "Collect " + fmt$(RETAINER),
      onSelect: (v) => {
        const paid = CBZ.cityTill.take(v.vendor, { point: "register", max: RETAINER, by: "player" });
        if (!(paid.taken > 0)) {
          if (CBZ.citySay) CBZ.citySay(v, "Slow day. Drawer's light.", "#cfe6ff", 2.4);
          return;
        }
        v._retainerT = _sNow() + 600;              // seconds — one collection per keeper per 10 min
        CBZ.city.addCash(paid.taken);
        if (CBZ.sfx) CBZ.sfx("coin");
        if (CBZ.citySay) CBZ.citySay(v, "Keep the block quiet, yeah?", "#cfe6ff", 2.2);
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      },
    });

    // ---- WORKERS ON THE STREET: the trades you can flag down ----
    // a mechanic near your beat-up ride quotes a fix on the spot
    I.register("ped:civ", {
      id: "ped-mechanic-fix", slot: "k", prio: 44,
      canShow: (p, ctx) => !ctx.driving && !p.dead && /mechanic/i.test(_jobOf(p)) && !!fixableCar(p),
      label: (p) => { const c = fixableCar(p); return "Fix " + fmt$(c ? fixPrice(c) : 0); },
      onSelect: (p) => {
        const c = fixableCar(p); if (!c) return;
        const price = fixPrice(c);
        if (!CBZ.city.spend(price)) { CBZ.city.note("Repairs run " + fmt$(price) + " · you're short.", 1.6); return; }
        c.engineHp = 100; c._smoking = false;
        p.cash = (p.cash | 0) + price;
        if (CBZ.sfx) CBZ.sfx("coin");
        if (CBZ.citySay) CBZ.citySay(p, "Runs better than it looks. We're square.", "#cfe6ff", 2.2);
        CBZ.city.note("Engine patched, she'll run.", 1.8);
      },
    });
    // a cart vendor sells off the cart — cheap calories without a counter
    I.register("ped:civ", {
      id: "ped-cart-bite", slot: "k", prio: 41,
      canShow: (p) => !p.dead && !p.rage && p.state !== "flee" && _jobOf(p) === "street vendor",
      label: "Buy $8",
      // HANDED OVER, NOT MINTED: he holds it out, your hand takes it out of
      // his (CBZ.verbs.takeFrom at his wrist), and only then is it yours.
      onSelect: (p) => {
        if (!CBZ.city.spend(8)) { if (CBZ.citySay) CBZ.citySay(p, "Eight bucks, pal.", "#cfe6ff", 2); return; }
        p.cash = (p.cash | 0) + 8;
        if (CBZ.sfx) CBZ.sfx("coin");
        p._faceT = Math.max(p._faceT || 0, 1.6);
        if (CBZ.cityDialogue && CBZ.cityDialogue.beat) CBZ.cityDialogue.beat(p, "dlgSeal", 1.0);
        let done = false;
        const eat = function () {
          if (done) return; done = true;
          g.hunger = Math.min(100, (g.hunger || 0) + 30);
          if (CBZ.player.maxHp) CBZ.player.hp = Math.min(CBZ.player.maxHp, (CBZ.player.hp || 0) + 8);
          if (CBZ.citySayTopic) CBZ.citySayTopic(p, "handOver", { force: true });
          else if (CBZ.citySay) CBZ.citySay(p, "Here you go.", "#cfe6ff", 2);
        };
        const V = CBZ.verbs;
        let S = null;
        if (V && V.takeFrom) { try { S = V.takeFrom(CBZ.player, p, { at: "wristR", kind: "cash", pose: "card", dur: 0.55, onTaken: eat }); } catch (e) { S = null; } }
        if (!S) eat();
      },
    });
  });
})();
