/* ===========================================================================
   TAKE — A TAKE IS A TRANSFER, NOT A ROLL.

   OWNER (2026-07-29, verbatim): "i hate ransoms and robberies with dumb
   hardcoded limit — imagine what a dumb thing that is to reality"

   He was describing an arithmetic fact. piracy.js's ransom read

       n = 220 + 2400*w + 55*lvl*(0.4 + w);  n *= (1 + 1.6*w*w*w);

   with w <= 1 and lvl <= 100, so the richest, most powerful human being in
   this world was worth AT MOST $26,832 to kidnap — and the money was MINTED:
   it arrived through mission.start({reward}) and nobody's balance moved. The
   family that "paid" was exactly as rich afterwards.

   THE LAW THIS FILE IS:
     · What you get is what the target ACTUALLY HAS, right now.
     · It comes OUT of a balance the simulation already keeps.
     · That balance is measurably poorer afterwards.
     · NO CEILING, because reality has no ceiling. A billionaire's family pays
       what a billionaire's family can pay.
     · NO FREE LUNCH. Rob the same source twice and the second time it is
       empty, because you emptied it.

   That is not decoration, it is THE WHY CONSTITUTION's LAW 1: a capped roll
   makes every target identical and therefore worth nothing. A real balance
   makes a visible GRADIENT between targets worth taking and targets not —
   and a gradient is the thing a player actually chases.

   ---------------------------------------------------------------------------
   THIS FILE AUTHORS NO BALANCE. Every dollar it moves already lives in a
   module that was modelling it and had NO producer asking:

     sim/npcecon.js      20 cohort wallets. `debit()`'s own comment reads "the
                         SAME dollars leave the cohort's aggregate wallet";
                         `vacancyRate()` turns a drained cohort into REAL
                         building vacancy. Two consumers existed (a street mug
                         and a corpse loot). Nothing else had ever called it.
     sim/billionaires.js netWorthOf(sid) = shares x live price + ledger cash.
                         Consumers before today: a phone readout and two
                         leaderboards. NO TAKE HAD EVER ASKED IT.
     city/schedule.js    cityLedgerEntry/cityLedgerLive — the persistent
                         identity wallets those net worths are built on.
     city/economy.js     cityNetWorthOf(ped) — the modelled fortune of a
                         tycoon / crime boss / VIP / company owner.
     city/gangs.js       gang.treasury — which gangs.js:869 SPENDS on raids,
                         so draining it is felt on the street.
     sim/corporations.js co.cash + debitCash().
     city/companies.js   co.cash (a firm's own till).

   ---------------------------------------------------------------------------
   THE CONTRACT (consumers code against exactly this):

     CBZ.cityHolds(source, opts) -> {
       amount,    // real dollars available to take. NEVER capped by a constant.
       liquid,    // the part that is already cash
       slow,      // the part that must be liquidated (shares, estate)
       kind, name, why, depletes, sid, unit, units, pools
     }
     CBZ.cityTake(source, opts) -> {
       taken,     // DOLLARS that actually left a balance (always dollars)
       unit, units,   // a non-dollar currency (jail cigs) rides here, never `taken`
       of, kind, name, emptied, why, moved, left,
       refund()   // put every dollar back into the SAME balances it came out
                  // of. A consumer that takes money BEFORE it is collected —
                  // city/piracy.js does, because a ransom bag has to exist
                  // before the handover — MUST call this if the collection
                  // never happens, or abandoning holds deletes money from the
                  // world.
     }
     CBZ.cityDeplete(source, amount, opts) -> dollars actually removed
     CBZ.takeAudit() -> { sources, mintedTakes, cappedTakes, transferred, drained, ... }

   PLACES ARE ANSWERED BY WHOEVER OWNS THEM. Another module publishes

       (CBZ.cityTakeSources = CBZ.cityTakeSources || []).push({
         id, owns(src) -> bool, pools(src) -> [pool]
       });

   and collect() consults it for anything that is a PLACE rather than a
   balance. A pool is `{id, label, amount, slow, take(n) -> moved}` — the same
   shape used internally — plus two OPTIONAL fields that decide how much this
   file can promise about it:
       give(n)  ships an exact inverse; without it the pool is NOT refundable
                and `res.irreversible` says so out loud.
       grain    the smallest amount it can move (a whole share, a banded note).
   city/shops.js's `cityTill` is the first provider: registers, safes, vaults,
   an ATM cassette, a casino cage and an armoured truck, every one derived from
   sim/npcecon.js's real cohort spend.

   `source` may be: a ped · a { sid } identity · an org id (string or number) ·
   a gang/company/corp record · a lot or venue record · the string "player" ·
   or an ARRAY of any of those (a household is an array).

   opts: { max, frac, dryRun, by, site, to, bank, silent, reason }
     max    — what the TAKER can carry away. A carry limit is a fact about the
              taker, not a magic lid on the world, so it does NOT count against
              `cappedTakes`.
     frac   — take a share of what they hold.
     to     — credit a destination ("player", a gang record, an org id). OMIT IT
              and cityTake only DEBITS: that is what keeps it composable with
              core/mission.js's reward payout instead of double-paying.
     site   — an adoption id, purely for the ratchet.

   WHY THIS CANNOT BECOME AN INFINITE MONEY PRINTER (the honest limiters — not
   one of them is a constant):
     1. The balance is FINITE and it DEPLETES. Take $4M off a founder's family
        and netWorthOf reads $4M less forever; the phone and both leaderboards
        already show it. Take them twice and the second time there is nothing.
     2. BIG MONEY TAKES LONGER TO RAISE, and the wait is the danger. Assembling
        cash out of an estate runs at a RATE (see ESTATE_* below), so a seven-
        figure number is minutes of holding a body while the city looks for you.
     3. LIQUIDATION IS LOSSY AND LOUD. A forced block sale clears under the
        screen price and SHOCKS the stock (sim/stocks.js's own shock()), so the
        whole market sees what you did.
     4. HEAT SCALES WITH THE NUMBER (the consumer's job; piracy.js does it).
     5. THE STATE REFUSES ENTIRELY — no number exists for a cop or an
        officeholder, which piracy.js has always said and now still says.

   BLOCK LAW: one-line adoption, degrade-safe (`CBZ.cityTake ? ... : <old
   inline>`), consumers migrated in the same change (piracy.js's ransom,
   social.js's legacy hostage payout, family.js's kidnap demand,
   intimidate.js's gunpoint shakedown), ratchet exported from a real game file.
   =========================================================================== */
(function () {
  "use strict";
  const CBZ = (window.CBZ = window.CBZ || {});
  const C = (CBZ.CONFIG = CBZ.CONFIG || {});
  const g = (CBZ.game = CBZ.game || {});

  if (C.TAKE_IS_TRANSFER == null) C.TAKE_IS_TRANSFER = true;
  // sell a founder's stock to make a ransom. Off -> shares are simply not a
  // pool and the number a founder's family can raise falls to their cash.
  if (C.TAKE_LIQUIDATE_SHARES == null) C.TAKE_LIQUIDATE_SHARES = true;
  // debit the district+class cohort wallet (sim/npcecon.js) for money taken off
  // a nameless person. Off -> a district can no longer be strip-mined.
  if (C.TAKE_COHORT_DEBIT == null) C.TAKE_COHORT_DEBIT = true;

  function on() { return C.TAKE_IS_TRANSFER !== false; }
  function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
  function pos(v) { return v > 0 ? v : 0; }

  /* ---------------------------------------------------------------------
     THE RATES. Every one of these SCALES something the world already holds.
     None of them is a lid: multiply a rate by a bigger balance and you get a
     bigger number, forever. That is the whole difference from `Math.min(n,
     26800)`.
     ------------------------------------------------------------------- */
  // A household is more than one wallet, and it can borrow against itself.
  // Applied to sim/npcecon.js's per-head cohort mean, which is that cohort's
  // REAL remaining savings — so a drained district raises less.
  const HOUSEHOLD_HEADS = 2.4;
  const SAVINGS_REACH = 3.2;

  // TURNING AN ESTATE INTO CASH. You can never hand over more than you own
  // (ESTATE_MAXFRAC — a fraction OF THE ESTATE, so it grows with it), and the
  // bigger the pile the smaller the share of it you can actually assemble in
  // spendable money (the power law). Solved against two anchors we want to
  // read right: an $11M listed-corp founder's family raises ~$1.2M, and a $5B
  // tycoon's raises ~$60M. Both are unbounded above; neither is a constant.
  //   raise = min(estate * 0.45, 38 * estate^0.64)
  const ESTATE_A = 38, ESTATE_B = 0.64, ESTATE_MAXFRAC = 0.45;
  // A forced block sale does not clear at the screen price, and the tape sees
  // it: the price moves by SHARE_SHOCK_K x the fraction of the float dumped.
  const SELL_HAIRCUT = 0.82, SHARE_SHOCK_K = 0.55;
  // How fast an illiquid pile becomes cash. Not a cap — a RATE. Consumers turn
  // it into the wait that makes a big number dangerous to collect.
  const LIQUIDATE_SECS = 240;

  // Every real balance this block can reach. Adding a source kind means adding
  // a POOL here, never a new wallet.
  const POOL_KINDS = ["pocket", "ledger", "holdings", "estate", "cohort", "treasury", "firm", "corp", "bank", "jail"];

  /* ------------------------------------------------------- the audit ---- */
  let _sources = 0, _minted = 0, _capped = 0, _transferred = 0, _drained = 0, _maxTake = 0;
  let _unverified = 0;                       // foreign-pool takes nothing could check
  let _spawns = 0, _spawnScaled = 0, _spawnMinted = 0, _spawnNoCohort = 0;
  const _provHit = Object.create(null);       // provider id -> sources claimed
  const _sites = Object.create(null);
  const _seenObj = (typeof WeakSet === "function") ? new WeakSet() : null;
  const _seenStr = Object.create(null);
  function noteSource(src) {
    if (src == null) return;
    if (typeof src === "object") {
      if (_seenObj) { if (_seenObj.has(src)) return; _seenObj.add(src); }
      _sources++;
    } else {
      const k = String(src);
      if (_seenStr[k]) return;
      _seenStr[k] = 1; _sources++;
    }
  }
  function noteSite(site) { if (site) _sites[String(site)] = (_sites[String(site)] | 0) + 1; }

  /* A LEGACY TAKE — a magic-constant formula still deciding what somebody is
     worth. Consumers call this from their flag-off / block-absent branch, so
     `cappedTakes` is a genuine migration counter and not a tautology. */
  CBZ.cityTakeLegacy = function (site) {
    _capped++; noteSite(site ? site + ":legacy" : "legacy");
    return _capped;
  };

  /* ---------------------------------------------------- small readers ---- */
  function ledgerLive(sid) { try { return (CBZ.cityLedgerLive && CBZ.cityLedgerLive(sid)) || null; } catch (e) { return null; } }
  function ledgerEntry(sid) { try { return (CBZ.cityLedgerEntry && CBZ.cityLedgerEntry(sid)) || null; } catch (e) { return null; } }
  function districtOf(ped) {
    const E = CBZ.cityEcon;
    if (!E || !E.districtAt || !ped || !ped.pos) return null;
    try { return E.districtAt(ped.pos.x, ped.pos.z); } catch (e) { return null; }
  }
  function classOf(ped) {
    const N = CBZ.npcEcon;
    if (!N || !N.classFor) return null;
    try { return N.classFor(ped && ped.wealth); } catch (e) { return null; }
  }
  function cohortRow(dk, cls) {
    const N = CBZ.npcEcon;
    if (!N || !dk || !cls) return null;
    if (N.rowOf) { try { return N.rowOf(dk, cls); } catch (e) { return null; } }
    if (!N.summary) return null;
    try {
      const rows = N.summary();
      for (let i = 0; i < rows.length; i++) if (rows[i].d === dk && rows[i].c === cls) return rows[i];
    } catch (e) {}
    return null;
  }
  function nameOfPed(p, fb) { return (p && (p.name || p.desc)) || fb || "them"; }
  function stockPrice(sym) {
    const S = CBZ.stocks;
    if (!S || !S.get) return 0;
    try { const st = S.get(sym); return (st && st.price) || 0; } catch (e) { return 0; }
  }
  // The modelled fortune of a person the sim never gave a real wallet — a
  // tycoon, a crime boss, a VIP, a company owner. city/economy.js owns the
  // arithmetic; `_drained` (written below) is what makes it fall when you take
  // from it, and economy.js's netWorthOf subtracts it.
  function estateOf(ped) {
    if (!CBZ.cityNetWorthOf) return 0;
    let nw = 0;
    try { nw = CBZ.cityNetWorthOf(ped) || 0; } catch (e) { nw = 0; }
    return pos(nw);
  }
  // How much of an estate can actually be assembled in spendable money. See
  // the ESTATE_* comment: two terms, both proportional to the estate.
  function raisableFromEstate(estate) {
    if (!(estate > 0)) return 0;
    return Math.min(estate * ESTATE_MAXFRAC, ESTATE_A * Math.pow(estate, ESTATE_B));
  }

  /* ============================================================
     THE POOLS. A pool is a real balance somewhere in the sim, with a reader
     and a debiter that REPORTS WHAT ACTUALLY MOVED. Nothing here invents a
     balance; every take() below reads before and after, which is why
     `mintedTakes` is an assertion rather than a tautology.
     ============================================================ */
  function poolPocket(ped) {
    const cash = pos(num(ped.cash, 0));
    if (!(cash > 0)) return null;
    return {
      id: "pocket", label: "what they are carrying", amount: cash, slow: false,
      take: function (n) {
        const before = pos(num(ped.cash, 0));
        ped.cash = Math.max(0, before - n);
        const moved = before - ped.cash;
        // the identity page mirrors a live body's cash (schedule.js stamps
        // e.cash = ped.cash) — if we do not write it too, a stash/reload puts
        // the money back and the take was a loan.
        if (ped._sid) { const e = ledgerEntry(ped._sid); if (e) e.cash = ped.cash | 0; }
        cohortDebit(ped, moved);
        return moved;
      },
      give: function (n) {
        ped.cash = pos(num(ped.cash, 0)) + n;
        if (ped._sid) { const e = ledgerEntry(ped._sid); if (e) e.cash = ped.cash | 0; }
        cohortCredit(ped, n);
      },
    };
  }
  // The SAME dollars leave the cohort's aggregate wallet (npcecon.js's own
  // words). This is what makes a strip-mined district look strip-mined: the
  // next hourly pass spends less, drawCash hands future spawns less, and
  // vacancyRate turns the hole into real empty buildings.
  function cohortDebit(ped, moved) {
    if (!(moved > 0) || C.TAKE_COHORT_DEBIT === false) return;
    const N = CBZ.npcEcon; if (!N || !N.debit) return;
    const dk = districtOf(ped), cls = classOf(ped);
    if (!dk || !cls) return;
    try { N.debit(dk, cls, moved); } catch (e) {}
  }
  // THE EXACT INVERSE, and it is not symmetry for its own sake: a ransom is
  // collected minutes before it is handed over, so a captor who never shows up
  // has to leave the payer exactly as rich as they were. Without a way back,
  // abandoning holds would be a way to grind a district's wallets to zero.
  function cohortCredit(ped, moved) {
    if (!(moved > 0) || C.TAKE_COHORT_DEBIT === false) return;
    const N = CBZ.npcEcon; if (!N || !N.credit) return;
    const dk = districtOf(ped), cls = classOf(ped);
    if (!dk || !cls) return;
    try { N.credit(dk, cls, moved); } catch (e) {}
  }

  function poolLedger(sid, live) {
    // a LIVE body's `.cash` is the truth and poolPocket already owns it; the
    // page is a mirror, so counting both would double the person's money.
    if (live) return null;
    const e = ledgerEntry(sid);
    if (!e) return null;
    const cash = pos(num(e.cash, 0));
    if (!(cash > 0)) return null;
    return {
      id: "ledger", label: "their account", amount: cash, slow: false,
      take: function (n) {
        const before = pos(num(e.cash, 0));
        e.cash = Math.max(0, Math.round(before - n));
        return before - e.cash;
      },
      give: function (n) { e.cash = Math.max(0, Math.round(pos(num(e.cash, 0)) + n)); },
    };
  }

  // SHARES. The uncapped tail, and the one that fires a real consequence: a
  // block sale under duress clears under the screen price and shocks the tape.
  function poolHoldings(sid) {
    if (C.TAKE_LIQUIDATE_SHARES === false) return null;
    const B = CBZ.billionaires;
    if (!B || !B.holdingsOf) return null;
    let h = null;
    try { h = B.holdingsOf(sid); } catch (e) { h = null; }
    if (!h) return null;
    let value = 0, grain = 0;
    for (const sym in h) {
      const per = stockPrice(sym) * SELL_HAIRCUT;
      value += pos(h[sym]) * per;
      if (per > grain) grain = per;                 // a share is indivisible
    }
    if (!(value > 0)) return null;
    return {
      // `grain` — the smallest amount this pool can move. A block sale is in
      // WHOLE SHARES, so the last one may carry the take a few dollars past
      // what was asked; the mint assertion below has to know that, or it would
      // report a rounding step as money created out of nothing.
      id: "holdings", label: "stock", amount: value, slow: true, grain: grain,
      take: function (n) {
        if (!B.liquidate) {
          // degrade: no seller in billionaires.js -> the shares are simply not
          // reachable. NEVER fabricate the proceeds.
          return 0;
        }
        let got = 0;
        try { got = B.liquidate(sid, n, { haircut: SELL_HAIRCUT, shockK: SHARE_SHOCK_K }) || 0; } catch (e) { got = 0; }
        return pos(got);
      },
      // YOU CANNOT UN-SELL A SHARE. A refunded block sale leaves the seller
      // holding the CASH instead — which is exactly what really happens to a
      // family that liquidated for a bag nobody ever came to collect. The
      // AMOUNT is exact; only its form changed, and netWorthOf counts both.
      give: function (n) {
        const e = ledgerEntry(sid);
        if (e) e.cash = Math.max(0, Math.round(pos(num(e.cash, 0)) + n));
        const lv = ledgerLive(sid);
        if (lv) lv.cash = pos(num(lv.cash, 0)) + (e ? 0 : n);
      },
    };
  }

  // A MODELLED FORTUNE with no wallet behind it (tycoon / crime boss / VIP /
  // company owner / everybody's wage-class cushion). It is depletable because
  // city/economy.js's netWorthOf subtracts `_drained` — so the rich list, the
  // phone and both leaderboards show a person who got taken as poorer.
  function poolEstate(ped, alreadyCounted) {
    const nw = estateOf(ped);
    const estate = pos(nw - pos(alreadyCounted));
    const raise = raisableFromEstate(estate);
    if (!(raise > 0)) return null;
    return {
      id: "estate", label: "what they can raise against what they own", amount: raise, slow: true,
      take: function (n) {
        const before = pos(num(ped._drained, 0));
        ped._drained = before + n;
        return pos(num(ped._drained, 0)) - before;
      },
      give: function (n) { ped._drained = Math.max(0, pos(num(ped._drained, 0)) - n); },
    };
  }

  // The household savings of somebody the sim never gave a page to — which is
  // exactly what npcecon.js's cohorts ARE ("everyone else is statistics").
  function poolCohort(ped, seen) {
    if (C.TAKE_COHORT_DEBIT === false) return null;
    const N = CBZ.npcEcon; if (!N || !N.debit) return null;
    const dk = districtOf(ped), cls = classOf(ped);
    if (!dk || !cls) return null;
    // ONE household reserve per cohort per ask — two brothers on the same block
    // are the same 20-row wallet, and counting it twice is exactly the
    // double-bookkeeping this file exists to delete.
    if (seen) { const k = "coh:" + dk + ":" + cls; if (seen[k]) return null; seen[k] = 1; }
    const row = cohortRow(dk, cls);
    if (!row || !(row.pop > 0) || !(row.wallet > 0)) return null;
    // NO FREE LUNCH, AND THE COHORT ALONE CANNOT ENFORCE IT. A row is a whole
    // district's income class — taking one household's savings out of ~100
    // heads barely moves the per-head mean, so without this the SAME person
    // could be shaken down over and over for almost the same money while the
    // district drained one percent at a time. `_householdTaken` is the memory
    // that makes it personal: you emptied THEIR savings, so THEY have none,
    // even though the district still has some.
    const already = pos(num(ped._householdTaken, 0));
    const share = (row.wallet / row.pop) * HOUSEHOLD_HEADS * SAVINGS_REACH - already;
    if (!(share > 0)) return null;
    return {
      id: "cohort", label: "the household's savings", amount: share, slow: false,
      take: function (n) {
        const before = cohortRow(dk, cls);
        const wallet = before ? pos(before.wallet) : 0;
        const want = Math.min(n, wallet);
        if (!(want > 0)) return 0;
        try { N.debit(dk, cls, want); } catch (e) { return 0; }
        const after = cohortRow(dk, cls);
        // read the row BACK — the debit is what PROVES the money moved, which
        // is what makes takeAudit().mintedTakes an assertion and not a promise.
        const moved = after ? pos(wallet - pos(after.wallet)) : want;
        ped._householdTaken = already + moved;
        return moved;
      },
      give: function (n) {
        cohortCredit(ped, n);
        ped._householdTaken = Math.max(0, pos(num(ped._householdTaken, 0)) - n);
      },
    };
  }

  function poolTreasury(rec, label) {
    const t = pos(num(rec.treasury, 0));
    if (!(t > 0)) return null;
    return {
      id: "treasury", label: label || "the war chest", amount: t, slow: false,
      take: function (n) {
        const before = pos(num(rec.treasury, 0));
        rec.treasury = Math.max(0, before - n);
        return before - rec.treasury;
      },
      give: function (n) { rec.treasury = pos(num(rec.treasury, 0)) + n; },
    };
  }
  function poolFirmCash(co, label) {
    const c = pos(num(co.cash, 0));
    if (!(c > 0)) return null;
    return {
      id: "firm", label: label || "the company's cash", amount: c, slow: false,
      take: function (n) {
        const before = pos(num(co.cash, 0));
        co.cash = Math.max(0, before - n);
        return before - co.cash;
      },
      give: function (n) { co.cash = pos(num(co.cash, 0)) + n; },
    };
  }
  function poolCorp(id) {
    const R = CBZ.corps;
    if (!R || !R.get || !R.debitCash) return null;
    let co = null;
    try { co = R.get(id); } catch (e) { co = null; }
    if (!co || co.bankrupt) return null;
    const c = pos(num(co.cash, 0));
    if (!(c > 0)) return null;
    return {
      id: "corp", label: (co.name || "the corporation") + "'s cash", amount: c, slow: false,
      take: function (n) {
        const before = pos(num(co.cash, 0));
        try { R.debitCash(id, n); } catch (e) {}
        return pos(before - pos(num(co.cash, 0)));
      },
      give: function (n) { if (R.creditRevenue) { try { R.creditRevenue(id, n); } catch (e) {} } },
    };
  }
  function poolPlayer(useBank) {
    const cash = pos(num(g.cash, 0));
    const bank = useBank ? pos(num(g.cityBank, 0)) : 0;
    const out = [];
    if (cash > 0) out.push({
      id: "pocket", label: "your cash", amount: cash, slow: false,
      take: function (n) {
        const before = pos(num(g.cash, 0));
        const want = Math.min(n, before);
        if (!(want > 0)) return 0;
        if (CBZ.city && CBZ.city.spend) { if (!CBZ.city.spend(want)) return 0; }
        else g.cash = Math.max(0, before - want);
        return before - pos(num(g.cash, 0));
      },
      give: function (n) { if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(n); else g.cash = pos(num(g.cash, 0)) + n; },
    });
    if (bank > 0) out.push({
      id: "bank", label: "your account", amount: bank, slow: true,
      take: function (n) {
        const before = pos(num(g.cityBank, 0));
        g.cityBank = Math.max(0, before - n);
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
        return before - pos(num(g.cityBank, 0));
      },
      give: function (n) { g.cityBank = pos(num(g.cityBank, 0)) + n; if (CBZ.cityHudDirty) CBZ.cityHudDirty(); },
    });
    return out;
  }
  // JAIL. There are no dollars in the escape mode — the currency is cigarettes
  // and systems/economy.js's lootActor already moves them honestly. We do NOT
  // re-implement it; we delegate, and we report cigs in `units`, never in
  // `taken`, so a caller doing addCash(taken) can never mint a dollar here.
  function poolJail(actor) {
    const E = CBZ.econ;
    if (!E || !E.lootActor) return null;
    if (actor.looted) return null;
    let load = actor.loadout;
    if (!load && E.rollLoadout) { try { load = E.rollLoadout(actor); } catch (e) { load = null; } }
    const cigs = load ? pos(num(load.cigs, 0)) : 0;
    const items = load && load.items ? load.items.length : 0;
    if (!cigs && !items) return null;
    return {
      // `always` — this pool moves no DOLLARS, so the dollar budget below must
      // not skip it. A man with three items and no cigs is still worth robbing.
      id: "jail", label: "what they have on them", amount: 0, units: cigs, unit: "cigs", slow: false, always: true,
      take: function (n, opts) {
        let got = null;
        try { got = E.lootActor(actor, { silent: !!(opts && opts.silent), pickpocket: !!(opts && opts.pickpocket) }); } catch (e) { got = null; }
        if (!got) return 0;
        this.movedUnits = pos(num(got.cigs, 0));
        this.movedItems = got.items || [];
        return 0;   // zero DOLLARS moved — cigs ride `units`
      },
    };
  }

  /* ============================================================
     RESOLUTION — what kind of thing is this, and which balances is it?
     ============================================================ */
  function isPed(s) {
    return !!(s && typeof s === "object" && (s.pos || s.group) &&
      (s.cash != null || s.wealth != null || s._sid || s.kind || s.archetype));
  }
  function orgRecord(id) {
    if (id == null) return null;
    if (CBZ.cityGangById) { try { const r = CBZ.cityGangById(id); if (r) return r; } catch (e) {} }
    return null;
  }
  function lotOwner(lot) {
    // a lot is a PLACE; its money is whoever owns it. companies.js already
    // stamps lot._company, and a shop lot already carries its vendor.
    if (lot._company) return lot._company;
    const b = lot.building;
    if (b && b.vendor && !b.vendor.dead) return b.vendor;
    if (lot.owner && typeof lot.owner === "object") return lot.owner;
    return null;
  }

  // Collect the pools of ONE source into `out`. `seen` dedupes identities so a
  // household of four peds who share a founder father counts him once.
  function collect(src, out, seen, opts) {
    if (src == null) return;
    opts = opts || {};

    if (Array.isArray(src)) { for (let i = 0; i < src.length; i++) collect(src[i], out, seen, opts); return; }

    if (src === "player" || src === CBZ.player || (src && src.isPlayer)) {
      if (seen.player) return; seen.player = 1;
      out.kind = out.kind || "player"; out.name = out.name || "you";
      const ps = poolPlayer(!!opts.bank);
      for (let i = 0; i < ps.length; i++) out.pools.push(ps[i]);
      return;
    }

    if (typeof src === "string" || typeof src === "number") {
      const key = "org:" + src;
      if (seen[key]) return; seen[key] = 1;
      const rec = orgRecord(src);
      if (rec) { collect(rec, out, seen, opts); return; }
      const cp = poolCorp(src);
      if (cp) { out.kind = out.kind || "corp"; out.name = out.name || String(src); out.pools.push(cp); return; }
      // an org the world declares but keeps no balance for is not a payer.
      out.why = out.why || "Nothing in that name holds any money.";
      return;
    }

    if (typeof src !== "object") return;

    // an explicit identity handle: { sid }
    if (src.sid && !src.pos && !src.group && src.cash == null) { collectSid(src.sid, null, out, seen); return; }

    // a listed corporation record
    if (src.tickerSym || src.sym) {
      const id = src.id || src.companyId;
      const cp = id != null ? poolCorp(id) : null;
      if (cp) { out.kind = out.kind || "corp"; out.name = out.name || src.name || "the corporation"; out.pools.push(cp); return; }
    }

    // a jail inmate (escape mode) — cigarettes, not dollars
    if (src.loadout || (g.mode === "escape" && src.kind === "inmate")) {
      if (seen.peds.indexOf(src) >= 0) return;
      seen.peds.push(src);
      const jp = poolJail(src);
      out.kind = out.kind || "jail"; out.unit = "cigs";
      out.name = out.name || ((src.data && src.data.name) || "them");
      if (jp) out.pools.push(jp);
      else out.why = out.why || "They have nothing left — you already took it.";
      return;
    }

    if (isPed(src)) { collectPed(src, out, seen, opts); return; }

    /* ---- PLACES: FOREIGN PROVIDERS ------------------------------------
       A building's money is not this file's expertise. `CBZ.cityTakeSources`
       is the seam another module uses to say "I own the money question for
       objects like this" — city/shops.js's `cityTill` registers registers,
       safes, vaults, ATM cassettes, a casino cage and an armoured truck, all
       derived from sim/npcecon.js's real cohort spend. Bodies and households
       are answered above; places are answered here.

       WHY THE PROVIDER IS CONSULTED *HERE* and not at the top of collect():
       every branch above resolves a source that IS a balance (a pocket, a
       page, a war chest, a firm's cash). Those must never be captured by a
       provider's `owns()` — a gang whose roof stash is a declared place would
       otherwise have its whole war chest hidden behind one stash pool, and a
       ransom on that set would silently shrink. So: A SOURCE THAT IS A BALANCE
       IS ANSWERED BY THAT BALANCE; A SOURCE THAT IS A PLACE IS ANSWERED BY
       WHOEVER DECLARED THEY OWN IT.

       AND IT WINS OUTRIGHT for what it claims (the `return`), ahead of the
       generic lot branch below. That branch is a HEURISTIC — it guesses the
       owner off `lot._company` — and running a guess alongside a purpose-built
       till is the parallel-bookkeeping trap this whole file exists to delete.
       It is also the better model: cracking a corner store's drawer should not
       hand you its parent conglomerate's bank account. */
    const PS = CBZ.cityTakeSources;
    if (PS && PS.length) {
      if (seen.places.indexOf(src) >= 0) return;
      for (let i = 0; i < PS.length; i++) {
        const P = PS[i];
        if (!P || typeof P.owns !== "function" || typeof P.pools !== "function") continue;
        let owned = false;
        try { owned = !!P.owns(src); } catch (e) { owned = false; }
        if (!owned) continue;
        let ps = null;
        try { ps = P.pools(src); } catch (e) { ps = null; }
        /* AN EMPTY PLACE IS AN ANSWER, NOT A MISS. Falling through to the
           generic lot branch when a provider returned no pools was a real
           hole: crack a shop's drawer dry, come back a second time, and the
           heuristic below would hand you `lot._company.cash` — the parent
           conglomerate's entire bank account — as the consolation prize.
           A provider that OWNS the source has answered, and "there is nothing
           in it" is the answer. */
        seen.places.push(src);
        out.kind = out.kind || "place";
        out.name = out.name || (src.building && src.building.name) || src.name || "the place";
        _provHit[P.id || ("p" + i)] = (_provHit[P.id || ("p" + i)] | 0) + 1;
        if (!ps || !ps.length) { out.why = out.why || "There is nothing in it — it has already been cleared."; return; }
        for (let k = 0; k < ps.length; k++) {
          const q = ps[k];
          if (!q || typeof q.take !== "function") continue;
          // stamp the provenance so take() can VERIFY a foreign pool by
          // re-asking its owner what is left — see the mint check there.
          q._prov = P; q._src = src;
          out.pools.push(q);
        }
        return;
      }
    }

    // a gang / crew / faction record with a war chest
    if (src.treasury != null) {
      const key = "rec:" + (src.id != null ? src.id : (src.name || "?"));
      if (seen[key]) return; seen[key] = 1;
      out.kind = out.kind || "org"; out.name = out.name || src.name || "the set";
      const tp = poolTreasury(src, (src.name || "the set") + "'s war chest");
      if (tp) out.pools.push(tp);
      else out.why = out.why || ((src.name || "They") + " is broke.");
      return;
    }

    // a city company (companies.js) — cash on hand
    if (src.cash != null && (src.lots || src.owner !== undefined)) {
      const key = "co:" + (src.id != null ? src.id : (src.name || "?"));
      if (seen[key]) return; seen[key] = 1;
      out.kind = out.kind || "firm"; out.name = out.name || src.name || "the firm";
      const fp = poolFirmCash(src, (src.name || "the firm") + "'s cash");
      if (fp) out.pools.push(fp);
      else out.why = out.why || ((src.name || "The firm") + " has nothing in the till.");
      return;
    }

    // a LOT / VENUE — the place has no wallet of its own; whoever owns it does.
    if (src.building || src.cx != null || src.lot) {
      const key = "lot:" + (src.id != null ? src.id : (src.cx + ":" + src.cz));
      if (seen[key]) return; seen[key] = 1;
      const ow = lotOwner(src.lot || src);
      out.kind = out.kind || "till";
      out.name = out.name || src.name || "the place";
      if (ow) collect(ow, out, seen, opts);
      else out.why = out.why || "Nobody owns this — there is nothing here to take.";
      return;
    }

    // a bare wallet-ish record nothing else claimed
    if (src.cash != null) {
      out.kind = out.kind || "till";
      out.name = out.name || src.name || "the till";
      const fp = poolFirmCash(src, src.name || "the till");
      if (fp) out.pools.push(fp);
    }
  }

  // AN IDENTITY. If that identity is standing somewhere right now, the BODY is
  // the truth (schedule.js's offline page is a stale mirror of it), so we hand
  // straight over to collectPed and let it own the sid mark — marking it here
  // first is what would make the live body's own pocket unreachable.
  function collectSid(sid, live, out, seen) {
    if (!sid) return;
    const key = "sid:" + sid;
    if (seen[key]) return;
    const body = live || ledgerLive(sid);
    if (body) { collectPed(body, out, seen, {}); return; }
    seen[key] = 1;
    out.kind = out.kind || "identity";
    out.sid = out.sid || sid;
    if (!out.name) { const e = ledgerEntry(sid); out.name = (e && e.name) || "them"; }
    const lp = poolLedger(sid, null);
    if (lp) out.pools.push(lp);
    const hp = poolHoldings(sid);
    if (hp) out.pools.push(hp);
  }

  function collectPed(ped, out, seen, opts) {
    if (seen.peds.indexOf(ped) >= 0) return;
    seen.peds.push(ped);
    const sid = ped._sid;
    if (sid) {
      const k = "sid:" + sid;
      if (seen[k]) return;            // already counted through their page
      seen[k] = 1;
      out.sid = out.sid || sid;
    }
    out.kind = out.kind || "ped";
    out.name = out.name || nameOfPed(ped, "them");

    let counted = 0;
    const pk = poolPocket(ped);
    if (pk) { out.pools.push(pk); counted += pk.amount; }

    let hasShares = false;
    if (sid) {
      const lp = poolLedger(sid, ped);
      if (lp) { out.pools.push(lp); counted += lp.amount; }
      // a founder embodied on the street is still the founder (billionaires.js
      // hand-assigns _sid onto the magnate body) — his stock is reachable.
      const hp = poolHoldings(ped._bilFounder || sid);
      if (hp) { out.pools.push(hp); counted += hp.amount; hasShares = true; }
    }

    // HOUSEHOLD SAVINGS — a nameless person's real balance. Claimed once for
    // the household (poolCohort dedupes on district+class), but REMEMBERED, so
    // that every other member of that household has it subtracted from their
    // own notional estate below. Without the remembering, a brother whose
    // sibling already claimed the shared savings would come out RICHER for it,
    // because nothing was netted off his private estate.
    const dk = districtOf(ped), cls = classOf(ped);
    const cohKey = (dk && cls) ? "cohAmt:" + dk + ":" + cls : null;
    const cp = poolCohort(ped, seen);
    if (cp) { out.pools.push(cp); counted += cp.amount; if (cohKey) seen[cohKey] = cp.amount; }
    else if (cohKey && seen[cohKey] > 0) counted += seen[cohKey];

    // THE MODELLED FORTUNE, minus everything already counted. Skipped entirely
    // for a shareholder: economy.js's netWorthOf branch 1 IS "shares + cash",
    // so the stock pool already IS this person's estate and adding both would
    // be the same money twice.
    if (!hasShares) {
      const ep = poolEstate(ped, counted);
      if (ep) out.pools.push(ep);
    }
  }

  /* ============================================================
     cityHolds — ASK WHAT THEY ACTUALLY HAVE
     ============================================================ */
  function holds(source, opts) {
    opts = opts || {};
    const out = {
      amount: 0, liquid: 0, slow: 0, kind: null, name: null, why: null,
      depletes: false, sid: null, unit: "$", units: 0, pools: [],
    };
    if (!on()) { out.why = "TAKE_IS_TRANSFER is off."; return finishHolds(out); }
    noteSource(source);
    noteSite(opts.site);
    const seen = { peds: [], places: [] };
    try { collect(source, out, seen, opts); } catch (e) { out.why = out.why || "Nothing here answers for money."; }
    return finishHolds(out);
  }
  function finishHolds(out) {
    for (let i = 0; i < out.pools.length; i++) {
      const p = out.pools[i];
      const a = pos(num(p.amount, 0));
      out.amount += a;
      if (p.slow) out.slow += a; else out.liquid += a;
      if (p.units) { out.units += p.units; out.unit = p.unit || out.unit; }
    }
    out.depletes = out.pools.length > 0;
    if (!out.kind) out.kind = "none";
    if (!out.name) out.name = "nobody";
    if (!out.why) {
      if (!out.pools.length) out.why = "There is nothing to take here.";
      else if (out.amount <= 0 && out.units > 0) out.why = "No money — but they are carrying something.";
      else if (out.amount <= 0) out.why = "They are cleaned out.";
      else out.why = null;
    }
    // how long assembling this would take, as a FRACTION of the liquidation
    // window — consumers turn it into the wait that makes big money dangerous.
    out.slowShare = out.amount > 0 ? out.slow / out.amount : 0;
    out.liquidateSecs = Math.round(out.slowShare * LIQUIDATE_SECS);
    return out;
  }

  /* ============================================================
     cityTake — MOVE IT
     Debits the source. Crediting is the CALLER's business (or opts.to), which
     is exactly what keeps this composable with core/mission.js's reward payout
     instead of paying twice.
     ============================================================ */
  /* Re-ask a foreign provider what one of its pools holds NOW. Used only to
     verify a take: a provider publishes pools(src), so matching on the pool's
     own declared `id` needs nothing from it that it has not already given us
     (in particular it never parses the id, which would be an adapter). Returns
     null when the answer cannot be had — the pool vanished (consistent with a
     full drain) or the provider threw. */
  function provAmount(p) {
    const P = p._prov;
    if (!P || typeof P.pools !== "function") return null;
    let ps = null;
    try { ps = P.pools(p._src); } catch (e) { return null; }
    if (!ps) return null;
    for (let i = 0; i < ps.length; i++) if (ps[i] && ps[i].id === p.id) return pos(num(ps[i].amount, 0));
    return 0;                    // gone from the list = drained to nothing
  }

  function take(source, opts) {
    opts = opts || {};
    const h = holds(source, opts);
    const res = {
      taken: 0, unit: h.unit, units: 0, items: null, of: h.amount, kind: h.kind,
      name: h.name, emptied: false, why: null, moved: [], sid: h.sid,
    };
    if (!on()) { res.why = "TAKE_IS_TRANSFER is off."; return res; }
    if (!h.pools.length) { res.why = h.why || "There is nothing to take here."; return res; }

    let want = h.amount;
    if (opts.frac != null) want = h.amount * Math.max(0, Math.min(1, +opts.frac));
    // A CARRY LIMIT IS A FACT ABOUT THE TAKER, not a lid on the world — it
    // never counts against cappedTakes.
    if (opts.max != null) want = Math.min(want, Math.max(0, +opts.max));
    want = Math.floor(want);

    if (opts.dryRun) {
      res.taken = Math.min(want, Math.floor(h.amount));
      res.units = h.units;
      res.why = res.taken > 0 ? null : (h.why || "Nothing to take.");
      res.emptied = res.taken >= Math.floor(h.amount) && h.amount > 0;
      return res;
    }

    let left = want, movedTotal = 0, movedUnits = 0, items = null, irreversible = 0;
    const back = [];              // {pool, amount} for res.refund()
    for (let i = 0; i < h.pools.length; i++) {
      const p = h.pools[i];
      // a non-dollar pool still runs (jail cigs/items): it moves no dollars by
      // design, so the dollar budget must never gate it out.
      if (left <= 0 && !p.always) continue;
      const ask = p.always && p.amount <= 0 ? 0 : Math.min(left, p.amount);
      let moved = 0;
      try { moved = pos(num(p.take(ask, opts), 0)); } catch (e) { moved = 0; }
      if (p.movedUnits) { movedUnits += p.movedUnits; }
      if (p.movedItems && p.movedItems.length) { items = (items || []).concat(p.movedItems); }
      if (moved > 0) {
        // THE MINT ASSERTION, PART ONE: a pool may never report more than it
        // was asked for, beyond its own indivisible unit (a whole share). If it
        // does, money appeared from nowhere and the ratchet says so. This holds
        // for a FOREIGN pool too — it compares a claim against an ask, and a
        // provider cannot lie its way past that in the direction that pays.
        if (moved > ask + Math.max(1, pos(num(p.grain, 0)))) _minted++;
        // PART TWO, and it is the one a foreign provider could otherwise
        // defeat: a pool that reports 50 moved while moving 0 hands the player
        // $50 out of nothing, and part one cannot see it because 50 <= ask.
        // MY OWN pools are immune by construction — every take() above reads
        // its balance BACK and returns the true delta. A provider's is not, so
        // we re-ask its owner what is left. WHAT CANNOT BE VERIFIED IS COUNTED
        // AS UNVERIFIED, never as clean.
        else if (p._prov) {
          const after = provAmount(p);
          if (after == null) _unverified++;
          else if (after > p.amount - moved + 1 + pos(num(p.grain, 0))) _minted++;
        }
        movedTotal += moved;
        left -= moved;
        res.moved.push({ pool: p.id, label: p.label, amount: Math.round(moved) });
        // REFUND IS OPT-IN, AND A PLACE DELIBERATELY OPTS OUT. See res.refund()
        // below for why a derived till must not be re-credited.
        if (p.give) back.push({ p: p, n: moved });
        else irreversible += moved;
      }
    }

    res.taken = Math.round(movedTotal);
    res.units = movedUnits;
    res.items = items;
    _transferred += res.taken;
    if (res.taken > _maxTake) _maxTake = res.taken;
    noteSite(opts.site);

    // WHAT IS LEFT? Re-ask. A source that answers zero next time is a source
    // you emptied — which is the whole "no free lunch" half of the law.
    const after = holds(source, opts);
    res.emptied = after.amount <= 0 && after.units <= 0;
    if (res.emptied && (res.taken > 0 || res.units > 0)) _drained++;
    res.left = Math.round(after.amount);

    if (res.taken <= 0 && res.units <= 0) res.why = h.why || "There was nothing left.";
    else if (res.taken < want) res.why = "That was everything they had.";

    /* PUT IT BACK. Every pool carries an exact inverse, so a take can be
       undone into the SAME balances it came out of.
       WHY THIS EXISTS AND IS NOT OPTIONAL: city/piracy.js collects a ransom the
       moment the payer finishes RAISING it — minutes before the handover,
       because that is when a bag of money physically starts existing and it is
       what makes robbing the family in the meantime matter. If the captor then
       never turns up, that money would simply be GONE from the world. A player
       could take hostages he never intends to collect and grind a district's
       wallets to zero. So: the bag goes back.
       The one thing that cannot be reversed is a SHARE — you cannot un-sell it
       — so a refunded block sale leaves the family holding the cash instead.
       The amount is exact; only its form changed, which is what really happens
       to somebody who liquidated for a ransom nobody came to collect.

       A PLACE IS DELIBERATELY NOT REFUNDABLE, AND THAT IS THE SAFE ANSWER
       RATHER THAN A MISSING ONE. city/shops.js's till is DERIVED — its balance
       is a function of the trading curve and a "last cleared" mark, not a
       stored number — so putting money back would mean winding that mark
       backwards while the curve has moved on, and the drawer would re-derive
       to something that was never taken from it. That is a mint. So a pool is
       refundable only if IT ships a `give`, absence is the refusal, and
       `res.refundable` / `res.irreversible` report the split HONESTLY instead
       of letting a caller assume the whole bag can come back. Nothing in this
       wave takes from a place in advance of collecting it; if something ever
       does, those two fields are what it must read first. */
    res.refundable = Math.round(movedTotal - irreversible);
    res.irreversible = Math.round(irreversible);
    res.refund = function () {
      let put = 0;
      for (let i = 0; i < back.length; i++) {
        try { back[i].p.give(back[i].n); put += back[i].n; } catch (e) {}
      }
      back.length = 0;
      _transferred -= put;                       // the audit must not count it twice
      if (put > 0 && _drained > 0 && res.emptied) _drained--;
      res.refunded = Math.round(put);
      return res.refunded;
    };

    // OPTIONAL CREDIT — one line for a caller that wants the money in a hand.
    if (opts.to != null && res.taken > 0) credit(opts.to, res.taken, opts);
    return res;
  }

  function credit(dest, amount, opts) {
    if (!(amount > 0)) return 0;
    if (dest === "player" || dest === CBZ.player || (dest && dest.isPlayer)) {
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(amount);
      else g.cash = pos(num(g.cash, 0)) + amount;
      return amount;
    }
    if (typeof dest === "string" || typeof dest === "number") {
      const rec = orgRecord(dest);
      if (rec) { rec.treasury = pos(num(rec.treasury, 0)) + amount; return amount; }
      if (CBZ.corps && CBZ.corps.creditRevenue) { try { CBZ.corps.creditRevenue(dest, amount); return amount; } catch (e) {} }
      return 0;
    }
    if (dest && typeof dest === "object") {
      if (dest.treasury != null) { dest.treasury = pos(num(dest.treasury, 0)) + amount; return amount; }
      if (dest.cash != null) { dest.cash = pos(num(dest.cash, 0)) + amount; return amount; }
    }
    return 0;
  }

  /* cityDeplete — the low level. Debit a balance, floored at 0, credit nobody. */
  function deplete(source, amount, opts) {
    opts = Object.assign({}, opts || {});
    opts.max = Math.max(0, num(amount, 0));
    opts.to = null;
    return take(source, opts).taken;
  }

  /* ============================================================
     THE RATCHET (BLOCK LAW #5)
       mintedTakes — a take whose money did not leave a balance. PIN 0.
       cappedTakes — a take still settled by a magic-constant formula
                     (a consumer's flag-off / block-absent branch). PIN 0.
     Everything else is printed BESIDE them so a "fix" that simply stops
     taking anything cannot pass.
     ============================================================ */
  CBZ.takeAudit = function () {
    const sites = Object.keys(_sites).sort();
    return {
      sources: _sources,            // distinct sources ever resolved this session
      mintedTakes: _minted,         // PIN 0
      cappedTakes: _capped,         // PIN 0
      transferred: Math.round(_transferred),
      drained: _drained,
      maxTake: Math.round(_maxTake),  // largest single take — proves there is no lid
      // SPAWN SIDE — the printer one layer under the ransom. `spawnMinted` is
      // rolled spawns that HAD a cohort to answer to and were not scaled by
      // it. PIN 0. `spawnsNoCohort` is reported separately and deliberately
      // NOT pinned: a body somewhere the district map cannot answer for has
      // nothing to be scaled against, and calling that minted would be a lie.
      spawns: _spawns, spawnsScaled: _spawnScaled,
      spawnMinted: _spawnMinted,    // PIN 0
      spawnsNoCohort: _spawnNoCohort,
      // PLACES — the join with city/shops.js's cityTill. `providers` is the
      // registered count and `wired.places` says the seam is actually read.
      providers: (CBZ.cityTakeSources || []).length,
      providerIds: (CBZ.cityTakeSources || []).map(function (p) { return (p && p.id) || "?"; }),
      providerHits: Object.assign({}, _provHit),
      unverifiedTakes: _unverified,  // foreign takes nothing could check
      sites: sites,
      siteCount: sites.length,
      pools: POOL_KINDS.length,     // balance kinds wired — printed so a "fix"
      poolKinds: POOL_KINDS,        // that just stops finding money cannot pass
      wired: {
        cohort: !!(CBZ.npcEcon && CBZ.npcEcon.debit),
        netWorth: !!(CBZ.billionaires && CBZ.billionaires.netWorthOf),
        liquidate: !!(CBZ.billionaires && CBZ.billionaires.liquidate),
        ledger: !!CBZ.cityLedgerEntry,
        estate: !!CBZ.cityNetWorthOf,
        vacancy: !!(CBZ.npcEcon && CBZ.npcEcon.vacancyRate),
        districtHealth: !!(CBZ.npcEcon && CBZ.npcEcon.districtHealth),
        places: !!(CBZ.cityTakeSources && CBZ.cityTakeSources.length),
      },
      on: on(),
    };
  };

  /* ---- PUBLIC SURFACE ---------------------------------------------------- */
  CBZ.cityHolds = holds;
  CBZ.cityTake = take;
  CBZ.cityDeplete = deplete;
  CBZ.cityTakeCredit = credit;
  // exported so a consumer can turn "how illiquid is this bag" into its own
  // wait without re-typing the window.
  CBZ.cityTakeLiquidateSecs = function () { return LIQUIDATE_SECS; };
  CBZ.cityTakeRaisable = raisableFromEstate;
  /* SPAWN-SIDE ACCOUNTING. city/peds.js calls this once per ROLLED spawn (a
     spawn with authored cash is nobody's printer and is not counted). `dk` is
     the district the body landed in, or null when nothing could answer for the
     place; `scaled` says the cohort supplied that body's scale. This exists so
     "the spawn printer is closed" is a NUMBER and not a claim — an audit
     nobody has executed is not a measurement. */
  CBZ.cityTakeSpawn = function (dk, scaled) {
    _spawns++;
    if (!dk) { _spawnNoCohort++; return; }
    if (scaled) _spawnScaled++; else _spawnMinted++;
  };
})();
