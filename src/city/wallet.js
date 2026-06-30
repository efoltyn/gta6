/* ============================================================
   city/wallet.js — THE MONEY-FLOW LEDGER (conservation of cash).

   WHY: the living city pays wages, collects rent, banks shop takings — but if
   each of those just *invented* or *deleted* cash out of thin air, the economy
   would mean nothing (a worker's pay would be free, a tenant's rent would
   vanish). This module is the single SPINE every flow routes through, so a
   dollar always MOVES from one pocket to another: the workplace till pays the
   worker, the tenant pays the landlord, and when YOU are the landlord that rent
   lands in YOUR wallet — never minted, never burned.

   Each business/landlord lot keeps a tiny account on its OWNER object
   (lot.building.owner._acct = { cash }), seeded once from the lot's value so a
   shop opens with a float in the register. A COMPANY-managed lot (companies.js
   stamps lot._company) has NO private account: its wages are drawn from — and
   its rent banked into — the SHARED company pot (co.cash) that companies.js and
   citystaff.js already read, so the books stay consistent across all three. The
   player (a home you own) is paid through the real faucet, CBZ.city.addCash,
   exactly like the turf-tax income (economy.js).

   ADDITIVE + SAFE: city-mode only, headless-guarded, O(1) + allocation-free per
   call (no temp objects/arrays in the hot path), and it only ADDS/SUBTRACTS
   co.cash — never resets it (that belongs to companies.js). cityWalletReset
   nulls just the private _acct floats it created.
   ============================================================ */
(function () {
  if (!window.CBZ || !window.THREE) return;      // headless / stub guard
  const CBZ = window.CBZ;

  // --- self-defaulted tuning (never edit config.js from a build module) ------
  const C = CBZ.CONFIG || (CBZ.CONFIG = {});
  if (C.CITY_WALLET == null) C.CITY_WALLET = true;           // master on/off
  // Fraction of a lot's value parked as the owner's opening register float.
  if (C.CITY_WALLET_SEED == null) C.CITY_WALLET_SEED = 0.06;
  // A broke company can't fully stiff its staff: it still pays this fraction of
  // the wage from nothing (a small "the firm covers payroll on credit" faucet)
  // so workers never hard-stall waiting on an empty corporate pot.
  if (C.CITY_WALLET_BROKEWAGE == null) C.CITY_WALLET_BROKEWAGE = 0.4;
  // Milliseconds between player "rent from a tenant" feed notes (anti-spam).
  if (C.CITY_WALLET_NOTE_GAP == null) C.CITY_WALLET_NOTE_GAP = 18000;

  // Registry of every private account we've handed out, so a new run can null
  // them in one cheap sweep. We NEVER store company pots here (companies.js owns
  // those) — only owner._acct floats this module created.
  const accts = [];
  let noteAt = -1e9;   // ms of the last player-rent note surfaced
  // Same clock the rest of city mode throttles on (mode.js note()): CBZ.now when
  // present, else perf.now(); Date.now() keeps it headless-safe as a last resort.
  const nowMs = function () {
    if (CBZ.now != null) return CBZ.now;
    return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
  };

  // Cheap, deterministic lot value (mirrors companies.js lotValue so a shop and
  // a tower seed proportionally to size; companies.js keeps lotValue private, so
  // we replicate the same formula rather than reach into it).
  function lotValue(lot) {
    const b = (lot && lot.building) || {};
    const area = ((lot && lot.w) || 10) * ((lot && lot.d) || 10);
    return Math.round(area * (b.shop ? 1400 : 900) * (1 + ((b.storeys || 1) * 0.1)));
  }

  // The COMPANY pot for a lot, if companies.js manages it — else null. This pot
  // is SHARED (co.cash); we only += / -= it, never seed or reset it.
  function companyPot(lot) {
    const co = lot && lot._company;
    if (co && typeof co.cash === "number") return co;        // raw company record
    return null;
  }

  // Lazily create & return the OWNER's private account for a lot. Idempotent +
  // O(1): once seeded, just returns the same object. Returns null when there's
  // no ownable owner (gang turf / city property carry no till).
  function lazyAcct(lot) {
    const b = lot && lot.building;
    const owner = b && b.owner;
    if (!owner) return null;
    if (owner._acct) return owner._acct;
    // Seed the opening float from the lot's worth (a home leans on its rent so a
    // micro-unit landlord still floats something even with a tiny lot).
    let seed = lotValue(lot) * C.CITY_WALLET_SEED;
    const home = b.home;
    if (home && (home.rent || 0) > 0) seed = Math.max(seed, (home.rent | 0) * 12);
    if (!(seed > 0)) seed = 2500;                            // flat fallback float
    // _owner back-ref lets cityWalletReset() null the float in one sweep without
    // a parallel owners array (one field on an object we're already creating).
    const acct = { cash: Math.round(seed), _owner: owner };
    owner._acct = acct;
    accts.push(acct);
    return acct;
  }

  // True when this lot's owner is the PLAYER (a home you bought). The home owner
  // is a live getter (buildings.js): type flips to "player" the moment
  // home.owned is set, so we read it through the same gate.
  function ownerIsPlayer(lot) {
    const b = lot && lot.building;
    const owner = b && b.owner;
    if (owner && owner.type === "player") return true;
    return !!(b && b.home && b.home.owned);
  }

  // ---- (b) WAGES: the workplace till pays the worker ------------------------
  // Debit the lot owner's account (company pot if managed, else private float),
  // credit ped.cash, return what was actually paid. A broke company still pays a
  // reduced "on credit" wage so the worker keeps clocking in.
  CBZ.cityWagePay = function (ped, lot, amount) {
    amount = +amount;
    if (!ped || !(amount > 0)) return 0;
    let pay = amount;
    const pot = companyPot(lot);
    if (pot) {
      if (pot.cash >= amount) { pot.cash -= amount; }
      else {
        // Empty corporate coffers: the firm covers a reduced wage on credit.
        const reduced = Math.round(amount * C.CITY_WALLET_BROKEWAGE);
        pot.cash = Math.max(0, pot.cash - reduced);          // drain what's left toward it
        pay = reduced;
      }
    } else {
      const acct = lazyAcct(lot);
      if (acct) {
        if (acct.cash >= amount) { acct.cash -= amount; }
        else { pay = acct.cash > 0 ? acct.cash : 0; acct.cash = 0; }
      }
      // No ownable account (gang/city lot): the lot still pays in full — there's
      // no till to deplete, and stalling these workers would be worse than the
      // tiny faucet (matches how such jobs paid before this ledger existed).
    }
    if (!(pay > 0)) return 0;
    ped.cash = (ped.cash | 0) + pay;   // workers carry integer cash (| 0 coerces undefined → 0)
    return pay;
  };

  // ---- (c) RENT: the tenant pays the landlord -------------------------------
  // Debit ped.cash (clamp), credit the home owner. If YOU own the home, the rent
  // lands in your wallet via the real faucet (CBZ.city.addCash) with a throttled
  // one-line note — mirroring the turf-tax faucet in economy.js. Returns paid.
  CBZ.cityRentPay = function (ped, homeLot, amount) {
    amount = +amount;
    if (!ped || !(amount > 0)) return 0;
    const have = ped.cash | 0;
    const pay = have >= amount ? amount : (have > 0 ? have : 0);
    if (!(pay > 0)) return 0;
    ped.cash = have - pay;

    if (ownerIsPlayer(homeLot)) {
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(pay);
      const t = nowMs();
      if (t - noteAt >= C.CITY_WALLET_NOTE_GAP && CBZ.city && CBZ.city.note) {
        noteAt = t;
        CBZ.city.note("🏠 Rent from a tenant: +$" + pay + ".", 3);
      }
      // (addCash already flags the HUD dirty + commits world state for us.)
      return pay;
    }
    // NPC landlord / managing company: bank the rent in the matching pot.
    const pot = companyPot(homeLot);
    if (pot) { pot.cash += pay; return pay; }
    const acct = lazyAcct(homeLot);
    if (acct) acct.cash += pay;
    return pay;
  };

  // ---- (d) read-only peek + reset -------------------------------------------
  // The current spendable cash behind a lot (company pot if managed, else the
  // private float). Read-only — never seeds, never mutates.
  CBZ.cityNpcAcct = function (lot) {
    const pot = companyPot(lot);
    if (pot) return pot.cash | 0;
    const b = lot && lot.building, owner = b && b.owner;
    return (owner && owner._acct) ? (owner._acct.cash | 0) : 0;
  };

  // Wipe just the private floats for a fresh run (company pots are companies.js's
  // to manage — we leave co.cash untouched).
  CBZ.cityWalletReset = function () {
    for (let i = 0; i < accts.length; i++) {
      const a = accts[i];
      if (a && a._owner) a._owner._acct = null;
    }
    // Detach via the owner back-ref we stash on seed, then clear the registry.
    accts.length = 0;
    noteAt = -1e9;
  };
}());
