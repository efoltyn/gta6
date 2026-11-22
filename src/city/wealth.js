/* ============================================================
   city/wealth.js — WHAT MONEY DOES FOR YOU, and the businesses you own.

   OWNER: "No dashboards are needed. Everything can be existing. ... No need
   for a gang management dashboard: you can see gang members wearing the
   same colors."

   WHAT THIS REPLACED. An "EMPIRE" overlay on Shift+B with three tabs:
     - a catalog of twelve BUSINESSES you bought from the list ("Sudz Car
       Wash", "Vault Nightclub", "Cook Lab (Bunker)", "Vinewood Tower"), each
       a row with a tier, a supply bar, Collect / Upgrade / Security / Hire /
       IPO pills. Not one of them was a place: no building, no door, no
       staff. They shadowed the businesses that ARE places: every shop in the
       city is a listing you can buy at its sale sign (city/zillow.js,
       city/plots.js) and it has a person behind its counter.
     - four "OPPORTUNITIES": a stake, a dice roll and a multiplier with a
       name on it ("Insider Stock Play", "Cartel Shipment").
     - a PERKS readout of your wealth tier.
   The catalog, its raids, its gig-company fleet (city/gigfleet.js), the
   opportunities and the overlay are deleted.

   NOW a business you own is somewhere you go:
     - It is a real lot you bought (city/zillow.js). Its profit is not paid
       into your pocket from nowhere: it WAITS AT THE BUSINESS (zillow's
       takings), and the manager only holds so much.
     - THE MANAGER is the person behind its counter. On his card, for the
       owner:
         The takings $X     he hands you the envelope
         The books          he turns the ledger round: a sheet of paper you
                            hold (city/paper.js) with what it takes a cycle,
                            the tax, what he is holding, what the place is
                            worth, what you still owe on it; and he tells
                            you how it is going
         Wash $X through the till   dirty cash becomes banked money, less the
                            cut; every business you own shaves the cut
     - BOTTLE SERVICE is asked of a bartender.
     - Your wealth TIER (economy.js, by net worth) still buys real things
       (cheaper bribes and bodyguards, a harder turf squeeze): nobody reads
       it off a screen; other files ask tierPerk().

   Exposes: CBZ.cityWealth { tierPerk, hasVIP, flexLevel, partySpend,
   laundromats }, CBZ.cityFlexLevel, CBZ.cityAddFlex, CBZ.cityWealthReset.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function money(n) { n = Math.round(n || 0); const neg = n < 0; n = Math.abs(n); return (neg ? "-$" : "$") + n.toLocaleString("en-US"); }
  function E() { return CBZ.cityEcon || {}; }
  function Z() { return CBZ.cityZillow || null; }
  function sfx(n) { if (CBZ.sfx) try { CBZ.sfx(n); } catch (e) {} }
  function say(v, text, secs) {
    if (v && !v.dead && CBZ.citySay) { try { CBZ.citySay(v, text, null, { secs: secs || 3, force: true }); return; } catch (e) {} }
    if (CBZ.city && CBZ.city.note) CBZ.city.note(text, 2.2);
  }
  // cash first, then bank
  function charge(amt) {
    amt = Math.round(amt);
    if (((g.cash || 0) + (g.cityBank || 0)) < amt) return false;
    let owe = amt; const fromCash = Math.min(g.cash || 0, owe);
    g.cash = (g.cash || 0) - fromCash; owe -= fromCash;
    if (owe > 0) g.cityBank = Math.max(0, (g.cityBank || 0) - owe);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    return true;
  }
  function netWorth() { const e = E(); return e.netWorth ? e.netWorth() : ((g.cash || 0) + (g.cityBank || 0)); }
  function tierIndex() { const e = E(); if (!e.TIERS || !e.wealthTier) return 0; return Math.max(0, e.TIERS.indexOf(e.wealthTier())); }

  // ---- what is kept: the laundering total and your standing with the rich ----
  function state() {
    if (!g.cityWealthLog) g.cityWealthLog = { laundered: 0, flexSpent: 0 };
    if (g.cityFlexBonus == null) g.cityFlexBonus = 0;
    return g;
  }
  function persist() {
    if (!CBZ.cityWorldEnsure) return;
    const w = CBZ.cityWorldEnsure(); if (!w || !w.assets) return;
    w.assets.businesses = [];                     // (the catalog that used to be written here is gone)
    if (w.economy) w.economy.laundering = (g.cityWealthLog && g.cityWealthLog.laundered) || 0;
    w.assets.flex = g.cityFlexBonus | 0;
  }
  function hydrate() {
    state();
    if (g._wealthHydrated) return;
    g._wealthHydrated = true;
    if (!CBZ.cityWorldEnsure) return;
    const w = CBZ.cityWorldEnsure(); if (!w) return;
    if (w.assets && w.assets.flex != null) g.cityFlexBonus = w.assets.flex | 0;
  }

  /* ---- WEALTH-TIER PERKS: what your net worth buys, asked by other files ----
     turfMul      how hard your collectors squeeze the blocks you hold (economy.js)
     bribeDisc    off a cop's bribe (economy.js)
     bodyguardDisc  off hired protection (city/protection.js)
     vip          the money half of a velvet rope */
  //               broke  hustler comfort  M'aire rich    kingpin+
  const PERKS = {
    turfMul:      [1.00,  1.08,   1.18,    1.32,  1.55,   1.85],
    bribeDisc:    [0.00,  0.05,   0.10,    0.18,  0.28,   0.40],
    bodyguardDisc:[0.00,  0.05,   0.10,    0.18,  0.28,   0.40],
    vip:          [false, false,  false,   true,  true,   true],
  };
  function tierPerk(name) {
    const arr = PERKS[name]; if (!arr) return 0;
    return arr[clamp(tierIndex(), 0, arr.length - 1)];
  }
  function hasVIP() { return !!tierPerk("vip"); }
  // your standing with the city's rich: city/millionaires.js earns it (a
  // charity gala) and reads it back to decide how its tycoons treat you
  function flexLevel() { return g.cityFlexBonus || 0; }

  /* ---- BOTTLE SERVICE: asked of a bartender. A vanity drain that buys
     respect; the price is elastic to what you are worth (economy.js). ------- */
  function bottlePrice() { const e = E(); return e.SINKS && e.SINKS.bottleService ? e.SINKS.bottleService() : Math.max(250, Math.round(netWorth() * 0.01)); }
  function partySpend(v) {
    const cost = bottlePrice();
    if (!charge(cost)) { say(v, "Bottle service is " + money(cost) + " tonight."); sfx("hit"); return false; }
    state().cityWealthLog.flexSpent = (g.cityWealthLog.flexSpent || 0) + cost;
    if (v) v.cash = (v.cash | 0) + cost;
    const rep = clamp(Math.round(cost / 400), 2, 40);
    if (CBZ.city) CBZ.city.addRespect(rep);
    g.cityNotoriety = (g.cityNotoriety || 0) + 3;
    sfx("coin");
    say(v, "Bottles to your table. The whole room saw that.", 3.2);
    return true;
  }

  /* ---- THE MANAGER: the person behind the counter of a lot you own -------- */
  function owns(lot) { return !!(lot && CBZ.cityOwnsLot && CBZ.cityOwnsLot(lot)); }
  function laundromats() { const z = Z(); try { return z && z.ownedBusinesses ? z.ownedBusinesses().length : 0; } catch (e) { return 0; } }
  function handOver(v, then) {
    const V = CBZ.verbs;
    let S0 = null, done = false;
    const fin = function () { if (done) return; done = true; then(); };
    if (v) v._faceT = Math.max(v._faceT || 0, 1.8);
    if (v && V && V.takeFrom) { try { S0 = V.takeFrom(CBZ.player, v, { at: "wristR", kind: "cash", pose: "card", dur: 0.55, onTaken: fin }); } catch (e) { S0 = null; } }
    if (!S0) fin();
  }
  function takings(v, lot) {
    const z = Z(); if (!z || !z.takingsForLot) return false;
    const n = z.takingsForLot(lot);
    if (n <= 0) { say(v, "Nothing to hand over yet, boss."); return false; }
    say(v, money(n) + " since you were last in. It's all there.");
    handOver(v, function () {
      const got = z.collectByLot(lot);
      if (got > 0) { sfx("coin"); if (CBZ.cityHudDirty) CBZ.cityHudDirty(); }
    });
    return true;
  }
  function howItGoes(bk) {
    if (!bk.open) return "We're dark this week. No trade, and the tax still comes.";
    if (bk.net <= 0) return "It isn't covering its tax. That's the block, not the shop.";
    if (bk.control === "mine") return "Good. Your people on the block bring them in.";
    if (bk.control === "rival") return "Slow. This is somebody else's block and they know whose shop it is.";
    return "Steady. Nothing to complain about.";
  }
  function showBooks(v, lot) {
    const z = Z(), K = CBZ.cityPaper;
    const bk = z && z.booksForLot ? z.booksForLot(lot) : null;
    if (!bk) return false;
    say(v, howItGoes(bk), 3.4);
    if (!K) return true;
    const perMin = function (n) { return money(n) + " a cycle"; };
    const lines = [
      { k: "TAKEN IN", v: perMin(bk.gross) },
      { k: "PROPERTY TAX", v: perMin(-bk.tax) },
      { k: "CLEARS", v: perMin(bk.net), big: true },
      { gap: 6 },
      { k: "HELD FOR THE OWNER", v: money(bk.takings) },
      { k: "THE MANAGER HOLDS UP TO", v: money(bk.holdsUpTo) },
      { gap: 6 },
      { k: "THE PLACE IS WORTH", v: money(bk.value) },
    ];
    if (bk.mortgage > 0) lines.push({ k: "STILL OWED ON IT", v: money(bk.mortgage) });
    K.show({
      key: "books", org: bk.name, title: "LEDGER", ink: "#3b2f24", lines: lines,
      foot: bk.address ? bk.address + ". " + (bk.open ? "Trading." : "Closed this cycle.") : (bk.open ? "Trading." : "Closed this cycle."),
      sign: v && v.name ? v.name : "",
    });
    return true;
  }
  // dirty cash through your own till: it lands in the bank as the day's
  // trade, less the cut (economy.js; each business you own shaves it)
  function washable() { return Math.floor(g.cash || 0); }
  function wash(v) {
    const e = E(), dirty = washable();
    if (dirty < 100 || !e.launder) { say(v, "There's nothing there worth ringing up."); return false; }
    const r = e.launder(dirty);
    state().cityWealthLog.laundered = (g.cityWealthLog.laundered || 0) + (r.banked || 0);
    persist();
    sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    say(v, "Rung up as sales. " + money(r.banked) + " goes to the bank tonight.", 3.2);
    return true;
  }

  (CBZ._counterAsks || (CBZ._counterAsks = [])).push(function (v, lot, kind, add) {
    if (kind === "bar") add("bottles", "Bottle service " + money(bottlePrice()), function (vv) { partySpend(vv); });
    if (!owns(lot)) return;
    const z = Z(), held = z && z.takingsForLot ? z.takingsForLot(lot) : 0;
    if (held > 0) add("own-takings", "The takings " + money(held), function (vv) { takings(vv, lot); });
    add("own-books", "The books", function (vv) { showBooks(vv, lot); });
    if (washable() >= 100) add("own-wash", "Wash " + money(washable()) + " through the till", function (vv) { wash(vv); });
  });

  // hydrate the little that is kept, once the world ledger is up
  if (CBZ.onUpdate) CBZ.onUpdate(41, function () { if (g.mode === "city" && !g._wealthHydrated) hydrate(); });

  CBZ.cityWealthReset = function () {
    g.cityWealthLog = { laundered: 0, flexSpent: 0 };
    g.cityFlexBonus = 0; g._wealthHydrated = false;
  };

  CBZ.cityFlexLevel = flexLevel;
  // the one way to earn flex: bumps and persists in a single call
  CBZ.cityAddFlex = function (n) {
    state();
    g.cityFlexBonus = (g.cityFlexBonus || 0) + (n | 0);
    persist();
    return g.cityFlexBonus;
  };
  CBZ.cityWealth = {
    PERKS: PERKS, tierPerk: tierPerk, hasVIP: hasVIP, flexLevel: flexLevel,
    partySpend: partySpend, laundromats: laundromats,
    takings: takings, books: showBooks, wash: wash,
  };
  // economy.js's SINKS.launderCut() asks CBZ.cityEmpire (the car trade,
  // city/empire.js, which loads first and owns that object)
  if (CBZ.cityEmpire && !CBZ.cityEmpire.laundromats) CBZ.cityEmpire.laundromats = laundromats;
})();
