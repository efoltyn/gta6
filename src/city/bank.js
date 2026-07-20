/* ============================================================
   city/bank.js — MERIDIAN TRUST: the walk-in branch + the LOAN ENGINE.

   WHY (the explicit financial loop the rest of the economy was missing):
   the city already had a bank POOL (g.cityBank: deposit it so death can't
   drop it, withdraw a roll, bribe down a star) buried in the shops.js text
   menu, and Zillow already KNEW how to finance a house — but there was no
   place to BORROW, and no engine to service a loan. This module is both:

   • THE LOAN ENGINE (contract [E]) — CBZ.cityBankLoan = {offer,take,list,
     payExtra,tick}. It underwrites by NET WORTH + collateral, books loans
     into g.cityLoans (round-tripped through the world ledger — see the
     stampLoans/hydrateLoansFromLedger wraps at the foot of this IIFE, the
     outfits.js g.cityFit pattern), and a registered onUpdate tick AMORTIZES
     them: interest accrues on the balance, a level payment is auto-pulled
     from cash-then-bank every cycle (a real bill, like rent). Mortgages
     ~6%, personal ~12-18%, auto ~9%. Every number is NaN/negative/exploit
     guarded. zillow.js + realestate.js were ALREADY written to feature-
     detect this engine and route their mortgages through it (the {viaBank,
     loanId} shape they stamp); when we're absent they keep their legacy
     self-contained mortgage, so financing never breaks either way.
   • THE PAWN LOAN — CBZ.cityPawnLoan(item): a short-term loan ~40-60% of an
     item's fence value, the item held as COLLATERAL in g.cityPawnTickets.
     Repay principal+fee before it expires to redeem; let it lapse and the
     pawnbroker keeps the piece (pawnshop.js, a sibling module, consumes
     this). The WHY made physical: store the cash you got pawning the watch,
     borrow against the chain, finance the apartment with a real monthly note.

   • THE BRANCH — a real lobby you walk into: a teller line (counter + glass
     registered as shatterable city glass), an ATM by the door for a quick
     roll, a loan-officer desk that opens a focused apply panel, and the
     steel vault at the back. Shared materials/geometry, cached label
     sprites, the whole display visibility-gated by distance — the gunstore
     architecture, applied to money. Mode-gated + headless-guarded; the
     ENGINE itself mounts even headless so the financing chain resolves
     under the parse harness.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;                         // engine + fixtures both need the namespace
  const g = CBZ.game;

  // ---- money helpers (mirror mode.js + shops.js semantics exactly) ----------
  function fmt$(n) { n = Math.round(n || 0); return "$" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function num(n, d) { n = +n; return isFinite(n) ? n : (d || 0); }
  function note(t, s, opts) { if (CBZ.city && CBZ.city.note) CBZ.city.note(t, s, opts); }
  function big(t) { if (CBZ.city && CBZ.city.big) CBZ.city.big(t); }
  function econ() { return CBZ.cityEcon || null; }
  // net worth drives underwriting (the engine's "income proxy"); fall back to
  // liquid cash+bank if the econ module hasn't booted yet.
  function netWorth() {
    const e = econ();
    if (e && e.netWorth) { const nw = num(e.netWorth(), 0); if (isFinite(nw)) return nw; }
    return num(g.cash, 0) + num(g.cityBank, 0);
  }
  // pull `amt` from cash first, then bank. Returns the amount actually paid
  // (clamped to available) — never goes negative, never NaNs the wallet.
  function pull(amt) {
    amt = Math.max(0, Math.round(num(amt, 0)));
    if (amt <= 0) return 0;
    const have = num(g.cash, 0) + num(g.cityBank, 0);
    const paid = Math.min(amt, have);
    let owe = paid;
    const fromCash = Math.min(num(g.cash, 0), owe);
    g.cash = num(g.cash, 0) - fromCash; owe -= fromCash;
    if (owe > 0) g.cityBank = Math.max(0, num(g.cityBank, 0) - owe);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    return paid;
  }

  // ============================================================
  //  THE LOAN ENGINE  (CBZ.cityBankLoan — contract [E])
  // ------------------------------------------------------------
  //  g.cityLoans = [ { id, kind, principal, balance, rate, payment, termTicks,
  //                    paidTicks, accrued, purpose, ref } ]  — persisted on g.
  //  A "tick" is one INCOME cycle (TICK_SECS of game time): we amortize on the
  //  same cadence rent/upkeep run on, so a loan payment FEELS like the other
  //  recurring bills (config bankRate is per-second; loans bill per-cycle).
  // ------------------------------------------------------------
  const TICK_SECS = 45;          // one billing cycle (matches zillow INCOME_TICK)
  // RATES are the HEADLINE annual rates we quote/store (mortgage~6%, personal
  // 12-18%, auto~9%). We accrue PER CYCLE at rate/CYCLES_PER_YR — the SAME
  // divisor (240) zillow's legacy self-contained mortgage used (m.rate/240),
  // so a bank-backed mortgage costs exactly what the old one did per cycle and
  // the whole world economy stays balanced. The level payment is computed on
  // the per-cycle rate too, so offer + tick are fully self-consistent.
  const CYCLES_PER_YR = 240;
  // M3 (sim/centralbank.js): RATES used to be a flat headline-APR table.
  // Compatibility-first design (the M1 lesson — see that file's header):
  // every headline rate is now POLICY RATE + a fixed spread, never edited
  // directly. NEUTRAL_POLICY_RATE (4%) is centralbank.js's own documented
  // seed for every bank's policyRate at world-boot — so on day one (and in
  // every pre-M3 harness that never loads sim/centralbank.js at all, since
  // this file loads BEFORE it in index.html) headlineRate() falls back to
  // this exact constant and reproduces the old flat numbers BYTE-IDENTICAL:
  // mortgage 0.04+0.02=0.06, personal 0.04+0.11=0.15, auto 0.04+0.05=0.09.
  // pawn keeps its own flat 0 — that product is owned entirely by
  // pawnshop.js (see the big comment below) and was never a policy-linked
  // bank rate to begin with.
  const NEUTRAL_POLICY_RATE = 0.04;
  const RATE_SPREAD = { mortgage: 0.02, personal: 0.11, auto: 0.05, pawn: 0.0 };
  // the republic's live policy rate — guarded read, resolved at CALL time
  // (never at parse time: sim/centralbank.js loads AFTER this file). Absent
  // centralbank.js entirely, or before it's ticked once, this is exactly
  // NEUTRAL_POLICY_RATE — the whole point of the accessor design.
  function policyRate() {
    if (CBZ.centralbank && typeof CBZ.centralbank.rate === "function") {
      const r = CBZ.centralbank.rate("republic");
      if (isFinite(r)) return r;
    }
    return NEUTRAL_POLICY_RATE;
  }
  // headline rate for a loan purpose, right now: policy rate + that
  // product's fixed spread (never below 0 — a policy rate near zero still
  // prices a real spread, it just can't go negative on the player-facing side).
  function headlineRate(purpose) {
    const spread = RATE_SPREAD[purpose] != null ? RATE_SPREAD[purpose] : RATE_SPREAD.personal;
    return Math.max(0, policyRate() + spread);
  }
  // amortization horizon in billing cycles. Kept GAME-SCALE (a session, not a
  // 30-yr slog): a mortgage clears in a couple hundred cycles, a personal note
  // far quicker. The level-payment floor below keeps a low per-cycle rate from
  // stretching payoff past the term.
  const TERMS = { mortgage: 120, personal: 24, auto: 36 };
  // payment FLOOR (fraction of original principal per cycle) so a bank mortgage
  // retires on roughly the legacy zillow pace (it forced orig·minPaymentFrac);
  // the level payment is the larger of the amortizing payment and this floor.
  function minPayFrac() { return (econ() && econ().FINANCE && num(econ().FINANCE.minPaymentFrac, 0.04)) || 0.04; }
  function perCycle(rate) { return Math.max(0, num(rate, 0)) / CYCLES_PER_YR; }
  // the per-cycle payment we actually bill: amortizing payment, floored so the
  // loan can't outlive its term when the per-cycle rate is tiny.
  function paymentFor(principal, rate, n) {
    return Math.max(levelPayment(principal, rate, n), Math.ceil(Math.max(0, num(principal, 0)) * minPayFrac()));
  }
  const MIN_PRINCIPAL = 100;
  const MAX_LOANS = 12;          // sanity cap so the ledger can't be spammed
  // how much UNSECURED personal credit your net worth supports (a real bank
  // lends against capacity to repay, not thin air): a fraction of net worth
  // plus a tiny floor so a broke player can still get a small starter loan.
  const PERSONAL_CAP_FRAC = 0.55;
  const PERSONAL_FLOOR = 1500;
  const PERSONAL_HARD_CAP = 250000;

  function loans() { return (g.cityLoans = g.cityLoans || []); }
  function liveLoans() { const L = loans(); const out = []; for (let i = 0; i < L.length; i++) { const x = L[i]; if (x && num(x.balance, 0) > 1) out.push(x); } return out; }
  function loanById(id) { const L = loans(); for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === id) return L[i]; return null; }
  function totalOwed() { let s = 0; const L = liveLoans(); for (let i = 0; i < L.length; i++) s += num(L[i].balance, 0); return Math.round(s); }
  // existing debt service eats into new-loan capacity (you can't borrow your
  // whole net worth twice over).
  function outstandingPersonal() { let s = 0; const L = liveLoans(); for (let i = 0; i < L.length; i++) if (L[i].kind === "personal") s += num(L[i].balance, 0); return s; }

  // level payment for a fully-amortizing loan over n cycles: P·i / (1 − (1+i)^−n),
  // where i is the PER-CYCLE rate (headline APR / CYCLES_PER_YR). `rate` in is the
  // headline annual rate; r=0 (pawn) or absurd inputs fall back to straight-line
  // so it never NaNs.
  function levelPayment(principal, rate, n) {
    principal = Math.max(0, num(principal, 0));
    n = Math.max(1, Math.round(num(n, 1)));
    const i = perCycle(rate);
    if (principal <= 0) return 0;
    if (i <= 0) return Math.ceil(principal / n);
    const f = Math.pow(1 + i, -n);
    const denom = 1 - f;
    if (!isFinite(denom) || denom <= 1e-9) return Math.ceil(principal / n);
    const pay = principal * i / denom;
    return isFinite(pay) && pay > 0 ? Math.ceil(pay) : Math.ceil(principal / n);
  }

  // capacity for an UNSECURED personal loan given current standing.
  function personalCapacity() {
    const nw = Math.max(0, netWorth());
    let cap = Math.max(PERSONAL_FLOOR, nw * PERSONAL_CAP_FRAC);
    cap -= outstandingPersonal();                 // already-borrowed credit is spoken for
    return Math.max(0, Math.min(PERSONAL_HARD_CAP, Math.round(cap)));
  }

  // OFFER — a side-effect-free quote. purpose ∈ mortgage|personal|auto.
  // ctx (mortgage): { value, down, propertyId, category, kind, quote }.
  // Returns { approved, principal, rate, termTicks, payment, reason, purpose }.
  // CRITICAL: we stamp `purpose` ON the returned offer so take(offer) classifies
  // the loan correctly even when the caller (zillow.financeBuy) passes the offer
  // straight to take() without re-tagging it — otherwise a mortgage would book
  // as a personal loan and DISBURSE cash (a double-pay / free-house exploit).
  function rawOffer(purpose, principal, ctx) {
    purpose = (purpose === "mortgage" || purpose === "auto") ? purpose : "personal";
    ctx = ctx || {};
    principal = Math.max(0, Math.round(num(principal, 0)));
    const rate = headlineRate(purpose);
    const termTicks = TERMS[purpose] || TERMS.personal;
    const base = { approved: false, principal: principal, rate: rate, termTicks: termTicks, payment: 0, reason: "", purpose: purpose };

    if (!(principal >= MIN_PRINCIPAL)) { base.reason = "amount too small"; return base; }
    if (liveLoans().length >= MAX_LOANS) { base.reason = "too many open loans"; return base; }

    if (purpose === "mortgage") {
      // SECURED by the property: cap to the financeable balance (value − down,
      // and never above maxLTV of value). The collateral is the house, so we
      // approve broadly — the down payment is the underwriting gate (zillow
      // already pulls 20% down before it calls take()).
      const value = Math.max(0, num(ctx.value, 0));
      const down = Math.max(0, num(ctx.down, 0));
      const maxLTV = (econ() && econ().FINANCE && num(econ().FINANCE.maxLTV, 0.8)) || 0.8;
      let cap = principal;
      if (value > 0) cap = Math.min(cap, Math.round(value * maxLTV), Math.max(0, Math.round(value - down)));
      cap = Math.max(0, cap);
      if (cap < MIN_PRINCIPAL) { base.reason = "loan-to-value too high"; return base; }
      base.principal = cap;
      base.approved = true;
      base.payment = paymentFor(cap, rate, termTicks);
      return base;
    }

    if (purpose === "auto") {
      // SECURED by the vehicle: lend up to the car's value (ctx.value), the
      // ride is the collateral. Modest gate on net worth so it isn't free.
      const value = Math.max(0, num(ctx.value, principal));
      let cap = Math.min(principal, value > 0 ? value : principal);
      cap = Math.min(cap, Math.max(PERSONAL_FLOOR, netWorth() + value));   // can't borrow beyond reach
      cap = Math.max(0, Math.round(cap));
      if (cap < MIN_PRINCIPAL) { base.reason = "vehicle value too low"; return base; }
      base.principal = cap;
      base.approved = true;
      base.payment = paymentFor(cap, rate, termTicks);
      return base;
    }

    // PERSONAL — UNSECURED: underwrite against capacity (net worth − existing
    // personal debt). Decline cleanly if they're asking past their means.
    const cap = personalCapacity();
    if (cap < MIN_PRINCIPAL) { base.reason = "insufficient net worth for unsecured credit"; return base; }
    if (principal > cap) {
      // offer the most they QUALIFY for rather than a flat no — the panel shows it.
      base.principal = cap;
      base.approved = true;
      base.reason = "approved up to " + fmt$(cap);
      // rate climbs a touch when you're maxing your capacity (riskier borrower)
      base.rate = Math.min(0.18, rate + 0.03);
      base.payment = paymentFor(cap, base.rate, termTicks);
      return base;
    }
    base.approved = true;
    base.payment = paymentFor(principal, rate, termTicks);
    return base;
  }

  // ============================================================
  //  M3: RESERVE-REQUIREMENT CREDIT CAP — a system-wide ceiling layered on
  //  top of rawOffer()'s own per-loan underwriting above.
  //  CBZ.centralbank.creditHeadroom("republic", totalOwed()) answers "how
  //  much MORE credit can this system issue right now", off the central
  //  bank's own reserveReq/deposits bookkeeping (sim/centralbank.js) — this
  //  file is the ONE real credit-issuance ledger in the game today (no NPC
  //  loan book exists anywhere else yet), so "republic" is the one
  //  jurisdiction this cap actually binds against; see that file's own
  //  header for the documented scope note (a future wave that adds NPC
  //  credit sums it into the same totalOwed()-shaped read, zero shape
  //  change here). GUARDED: centralbank.js loads AFTER this file in
  //  index.html, and every pre-M3 harness never loads it at all — absent it,
  //  headroom is Infinity and this whole gate is a silent no-op (day one,
  //  and every existing loan-flow test, unchanged).
  // ------------------------------------------------------------
  function creditHeadroom() {
    if (!CBZ.centralbank || typeof CBZ.centralbank.creditHeadroom !== "function") return Infinity;
    const h = CBZ.centralbank.creditHeadroom("republic", totalOwed());
    return isFinite(h) ? Math.max(0, h) : Infinity;
  }
  function offer(purpose, principal, ctx) {
    const o = rawOffer(purpose, principal, ctx);
    if (!o.approved) return o;
    const headroom = creditHeadroom();
    if (o.principal > headroom) {
      if (headroom < MIN_PRINCIPAL) {
        // the reserve requirement fully binds — same refusal shape (approved:
        // false + a human reason) every other offer() decline already uses.
        o.approved = false; o.principal = 0; o.payment = 0;
        o.reason = "credit ceiling reached — the central bank's reserve requirement is binding";
        return o;
      }
      // partial room left: offer what the system can actually still lend,
      // same "approved up to X" UX the personal-capacity gate above uses.
      o.principal = Math.floor(headroom);
      o.payment = paymentFor(o.principal, o.rate, o.termTicks);
      o.reason = "approved up to " + fmt$(o.principal) + " — bank credit ceiling binding";
    }
    return o;
  }

  // TAKE — book an approved offer. Disburses to g.cash for personal/auto
  // (the money hits your pocket); MORTGAGE proceeds go to "escrow" (the seller
  // is paid by zillow's down+register flow — the engine only carries the debt,
  // exactly as zillow.financeBuy expects). Returns the loanId, or null.
  let _nextId = 1;
  function take(o) {
    if (!o || !o.approved) return null;
    const principal = Math.max(0, Math.round(num(o.principal, 0)));
    if (principal < MIN_PRINCIPAL) return null;
    if (liveLoans().length >= MAX_LOANS) return null;
    const kind = (o.purpose === "mortgage" || o.purpose === "auto") ? o.purpose
               : (o.kind === "mortgage" || o.kind === "auto" || o.kind === "personal") ? o.kind
               : "personal";
    const rate = Math.max(0, num(o.rate, headlineRate(kind)));
    const termTicks = Math.max(1, Math.round(num(o.termTicks, TERMS[kind] || TERMS.personal)));
    const payment = Math.max(1, Math.round(num(o.payment, paymentFor(principal, rate, termTicks))));
    const id = "loan" + (_nextId++) + "_" + (CBZ.now ? (CBZ.now | 0) : Date.now() % 1e7);
    const rec = { id: id, kind: kind, purpose: kind, principal: principal, balance: principal,
                  rate: rate, payment: payment, termTicks: termTicks, paidTicks: 0, accrued: 0,
                  ref: o.ref || (o.ctx && o.ctx.propertyId) || null };
    loans().push(rec);
    // DISBURSE: a mortgage's proceeds pay the seller through zillow's own flow,
    // so the engine must NOT also credit cash (that'd be a double-pay exploit).
    // Personal/auto cash lands in the player's pocket here.
    if (kind !== "mortgage") {
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(principal); else g.cash = num(g.cash, 0) + principal;
    }
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    return id;
  }

  // PAY EXTRA — knock down principal out of cash-then-bank. Used by the player
  // (loan desk) and by zillow (mortgage pay-down / sale payoff routes here so
  // the engine stays the single source of the balance). Closes at <= $1.
  function payExtra(id, amt) {
    const rec = loanById(id); if (!rec) return 0;
    amt = Math.max(0, Math.round(num(amt, 0)));
    if (amt <= 0) return 0;
    const due = Math.ceil(num(rec.balance, 0));
    const target = Math.min(amt, due);
    const paid = pull(target);
    rec.balance = Math.max(0, num(rec.balance, 0) - paid);
    if (rec.balance <= 1) { rec.balance = 0; closeLoan(rec); }
    return paid;
  }

  function closeLoan(rec) {
    rec.balance = 0;
    // splice it out of the ledger so list()/totalOwed stop counting it; zillow
    // detects the missing id and flips the property back to OWNED.
    const L = loans(); const i = L.indexOf(rec); if (i >= 0) L.splice(i, 1);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
  }

  // LIST — a shallow snapshot for HUD/zillow readers (live loans only).
  function list() {
    return liveLoans().map(function (r) {
      return { id: r.id, kind: r.kind, purpose: r.purpose, principal: r.principal,
               balance: Math.round(num(r.balance, 0)), rate: r.rate, payment: r.payment,
               termTicks: r.termTicks, paidTicks: r.paidTicks, ref: r.ref };
    });
  }

  // TICK — accrue interest + auto-pay the level payment from cash-then-bank,
  // once per billing cycle. A MISSED payment (you're broke) just lets interest
  // compound — the balance grows, the debt follows you. No repo/seizure here
  // (that'd reach into other systems); the spiraling balance IS the penalty.
  let _acc = 0;
  function tick(dt) {
    dt = num(dt, 0); if (dt <= 0) return;
    const L = loans(); if (!L.length) return;
    _acc += dt;
    if (_acc < TICK_SECS) return;
    let cycles = Math.floor(_acc / TICK_SECS);
    _acc -= cycles * TICK_SECS;
    if (cycles > 4) cycles = 4;               // catch-up clamp (tab was backgrounded)
    for (let c = 0; c < cycles; c++) {
      for (let i = L.length - 1; i >= 0; i--) {
        const rec = L[i];
        if (!rec || num(rec.balance, 0) <= 1) { if (rec) closeLoan(rec); continue; }
        // accrue this cycle's interest on the outstanding balance (per-cycle
        // rate = headline APR / CYCLES_PER_YR, matching zillow's legacy /240)
        const interest = Math.max(0, Math.round(num(rec.balance, 0) * perCycle(rec.rate)));
        rec.balance = num(rec.balance, 0) + interest;
        // auto-pay the level payment (never more than the full balance)
        const want = Math.min(Math.ceil(num(rec.balance, 0)), Math.max(1, num(rec.payment, 0)));
        const paid = pull(want);
        rec.balance = Math.max(0, num(rec.balance, 0) - paid);
        rec.paidTicks = num(rec.paidTicks, 0) + 1;
        if (paid < want && CBZ.player && !CBZ.player.dead && CBZ.city) {
          // a missed/partial note — surfaced quietly, once per cycle per loan
          note("Short on your " + rec.kind + " payment — interest is compounding (" + fmt$(rec.balance) + " owed).", 2.2);
        }
        if (rec.balance <= 1) { closeLoan(rec); big("" + (rec.kind === "mortgage" ? "Mortgage" : rec.kind === "auto" ? "Auto loan" : "Loan") + " paid off!"); }
      }
    }
  }

  // expose the engine IMMEDIATELY (before any THREE guard) so zillow.js /
  // realestate.js feature-detect + route mortgages through it even headless.
  CBZ.cityBankLoan = { offer: offer, take: take, list: list, payExtra: payExtra, tick: tick,
                       totalOwed: totalOwed, personalCapacity: personalCapacity };

  // ============================================================
  //  PERSIST the loan ledger via the EXISTING save hook (the outfits.js
  //  g.cityFit pattern, verbatim) — DEFINED ABOVE THE THREE GUARD so it runs
  //  headless + in MP, since worldstate.commit() (cash/bank/inventory/respect/
  //  weapons only) never wrote g.cityLoans: without this every active loan
  //  vanished on reload / MP join (free debt forgiveness) AND every bank-
  //  financed property went mortgage-free (zillow.js reads a missing loanId as
  //  "engine closed it → free & clear"). g.cityLoans now rides into the same
  //  world ledger worldstate.js saves to localStorage AND netpersist.js syncs
  //  to the server — one collector, no new store. Stamp onto the live ledger
  //  BEFORE the inner commit's save() runs; mirror back on a ledger object
  //  reference-change (fresh load / respawn / MP adopt). Wired into the engine
  //  onUpdate below (which fires even headless).
  function stampLoans() {
    const led = g.cityWorld;
    if (led && typeof led === "object") led.cityLoans = (g.cityLoans || []).map(function (r) { return Object.assign({}, r); });
  }
  let _ensureLoanSaveWraps_done = false;
  function ensureLoanSaveWraps() {
    // ONE-SHOT INSTALL (chain-growth fix): the old guard checked the
    // module flag on the CURRENT top-of-chain function, so once any
    // later module wrapped above us the flag vanished from the top and
    // we re-wrapped EVERY tick - ~20 such modules made the commit chain
    // grow unboundedly (stack overflow on save; found by the P5 full-
    // stack harness). A module-local boolean wraps exactly once, ever.
    if (_ensureLoanSaveWraps_done) return;
    _ensureLoanSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._loanWrap) {
      const w = function () { stampLoans(); return commit.apply(this, arguments); };
      w._loanWrap = true; CBZ.cityWorldCommit = w;
      // cityWorldCollect (the MP/persistence collector) points at the same inner
      // commit in worldstate.js — re-point it to the stamping wrap so the server
      // blob carries the loan ledger too.
      if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._loanWrap) {
        const col = CBZ.cityWorldCollect;
        const wc = function () { stampLoans(); return col.apply(this, arguments); };
        wc._loanWrap = true; CBZ.cityWorldCollect = wc;
      }
    }
  }
  // RESTORE side: worldstate.js's beginRun/adopt populate g.cityWorld BEFORE our
  // first city tick. Hydrate from the live ledger whenever its object REFERENCE
  // changes — covers fresh load, respawn, AND a multiplayer adopt (which swaps
  // the whole g.cityWorld object).
  let _hydratedLoanLedger = null;
  function hydrateLoansFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedLoanLedger) return;
    _hydratedLoanLedger = led;
    if (Array.isArray(led.cityLoans)) g.cityLoans = led.cityLoans.map(function (r) { return Object.assign({}, r); });
  }

  // ============================================================
  //  THE PAWN LOAN  (CBZ.cityPawnLoan — contract [E]; pawnshop.js consumes)
  // ------------------------------------------------------------
  //  A short-term collateral loan: hand over an item you OWN, get ~40-60% of
  //  its fence value in cash NOW, the ticket sits in g.cityPawnTickets. Repay
  //  principal + a flat fee before it expires to get the piece back; let it
  //  lapse and the broker keeps it (the spread + the forfeit risk is the cost
  //  of the quick cash vs. just SELLING it outright at the pawn haircut).
  // ------------------------------------------------------------
  const PAWN_FRAC = 0.5;         // loan = half the item's clean value (40-60% band)
  const PAWN_FEE_FRAC = 0.12;    // redeem fee on top of principal (the broker's cut)
  const PAWN_TERM_SECS = 600;    // ~10 minutes of game time to redeem before forfeit
  function pawnTickets() { return (g.cityPawnTickets = g.cityPawnTickets || []); }
  // value an item by its CLEAN catalog value (the loan is a fraction of it).
  function itemValue(name) {
    const e = econ(); if (!e || !e.ITEMS || !e.ITEMS[name]) return 0;
    return Math.max(0, num(e.ITEMS[name].value, 0));
  }
  // CBZ.cityPawnLoan(item) → { ok, ticketId, principal, redeem, reason }.
  // Pawnshop.js calls this once it's taken the item off the player's hands.
  function cityPawnLoan(name) {
    const e = econ();
    if (!e || !name) return { ok: false, reason: "no item" };
    if (!e.count || e.count(name) <= 0) return { ok: false, reason: "you don't have one to pawn" };
    const val = itemValue(name);
    if (val < 20) return { ok: false, reason: "not worth a loan" };
    const principal = Math.max(10, Math.round(val * PAWN_FRAC));
    const fee = Math.max(5, Math.round(principal * PAWN_FEE_FRAC));
    // take the item as collateral, hand over the cash
    if (e.take) e.take(name, 1);
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(principal); else g.cash = num(g.cash, 0) + principal;
    const id = "pawn" + (_nextId++);
    const ticket = { id: id, item: name, principal: principal, fee: fee, redeem: principal + fee,
                     expires: (CBZ.now || 0) + PAWN_TERM_SECS * 1000, t: PAWN_TERM_SECS };
    pawnTickets().push(ticket);
    if (CBZ.sfx) CBZ.sfx("coin");
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
    return { ok: true, ticketId: id, principal: principal, redeem: ticket.redeem, reason: "" };
  }
  // redeem a pawn ticket: pay principal+fee, get the item back. Returns bool.
  function cityPawnRedeem(id) {
    const T = pawnTickets(); let idx = -1;
    for (let i = 0; i < T.length; i++) if (T[i] && T[i].id === id) { idx = i; break; }
    if (idx < 0) return false;
    const t = T[idx];
    if ((num(g.cash, 0) + num(g.cityBank, 0)) < t.redeem) { note("Need " + fmt$(t.redeem) + " to redeem the " + t.item + ".", 2); return false; }
    pull(t.redeem);
    const e = econ(); if (e && e.add) e.add(t.item, 1);
    T.splice(idx, 1);
    if (CBZ.sfx) CBZ.sfx("coin");
    note("Redeemed your " + t.item + " for " + fmt$(t.redeem) + ".", 2);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }
  function cityPawnList() { return pawnTickets().map(function (t) { return { id: t.id, item: t.item, principal: t.principal, redeem: t.redeem, t: t.t }; }); }
  // NOTE: the pawn-loan engine is owned SOLELY by pawnshop.js (the in-world pawn
  // desk + the sole writer/ticker of g.cityPawnTickets). bank.js previously also
  // exported these and ticked the same array with an INCOMPATIBLE ticket shape,
  // which corrupted pawned items ("the broker kept your undefined"). Removed.
  // bank.js owns ONLY the mortgage/personal/auto loan engine (CBZ.cityBankLoan
  // over g.cityLoans). The local cityPawn* helpers below are now inert/unused.

  // pawn-ticket expiry runs on the engine tick too (forfeit lapsed tickets).
  function tickPawn(dt) {
    const T = pawnTickets(); if (!T.length) return;
    for (let i = T.length - 1; i >= 0; i--) {
      const t = T[i]; if (!t) { T.splice(i, 1); continue; }
      t.t = num(t.t, PAWN_TERM_SECS) - num(dt, 0);
      if (t.t <= 0) {
        T.splice(i, 1);
        note("Pawn ticket lapsed — the broker kept your " + t.item + ".", 2.4);
        if (CBZ.cityHudDirty) CBZ.cityHudDirty();
      }
    }
  }

  // ============================================================
  //  THE BRANCH (in-world fixtures + prompts) — needs THREE.
  // ------------------------------------------------------------
  const THREE = window.THREE;
  // engine tick must run even when fixtures can't (no THREE / no onUpdate yet):
  // register it on its own so loans amortize regardless of the branch build.
  if (CBZ.onUpdate) {
    CBZ.onUpdate(45.9, function (dt) {
      if (!g) return;
      // persistence plumbing runs regardless of play-state (and headless): the
      // save wraps must be installed so any commit stamps loans, and a ledger
      // swap (fresh load / respawn / MP adopt) must rehydrate g.cityLoans —
      // both before the THREE guard skips the in-world branch entirely.
      ensureLoanSaveWraps();
      hydrateLoansFromLedger();
      if (g.mode !== "city" || g.state !== "playing") return;
      tick(dt);
    });
  }
  if (!THREE || !CBZ.onUpdate) return;       // headless: engine is live, fixtures skipped

  const VIS_R = 55;          // the lobby fixtures draw only when you're near
  const REACH = 3.0;         // counter / ATM / desk are used at arm's length
  const LOOK_DOT = 0.5;      // you act on the station you're facing

  const S = { lot: null, bk: null, group: null, stations: [], built: false,
              arena: null, noLotArena: null, cur: null, prompt: null, lastTxt: "",
              cx: 0, cz: 0, panel: null, panelOpen: false, mode: "personal",
              pAmt: 0, pTerm: TERMS.personal, vault: null };

  // ---- shared materials (one each, _shared) ----------------------------------
  let M = null;
  function mats() {
    if (M) return M;
    M = {
      counter: CBZ.cmat(0x394250),                                  // teller counter stone
      brass: CBZ.cmat(0xcaa64a),                                    // brass trim / rails
      glass: CBZ.cmat(0xbfe9f7, { emissive: 0x3f8aa6, ei: 0.3 }),   // teller glass (fallback if no register)
      screen: CBZ.cmat(0x5b8bff, { emissive: 0x5b8bff, ei: 0.7 }),  // the trust's blue accent
      atm: CBZ.cmat(0x2c313a),                                      // ATM body
      atmFace: CBZ.cmat(0x141a22),                                  // ATM dark fascia
      desk: CBZ.cmat(0x3a2c20),                                     // loan-officer wood desk
      vault: CBZ.cmat(0x39414d),                                    // vault body
      vaultDoor: CBZ.cmat(0x6a7480),                                // vault door face
      green: CBZ.cmat(0x6ad08a, { emissive: 0x3a8a52, ei: 0.4 }),   // "approved" green
    };
    return M;
  }

  function tag(text, color, sx, sy) {
    if (!CBZ.makeLabelSprite) return null;
    const s = CBZ.makeLabelSprite(text, { color: color || "#bcd0ff" });
    s.scale.set(sx || 1.8, sy || 0.44, 1);
    return s;
  }
  function box(w, h, d, mat) {
    const m = new THREE.Mesh(CBZ.boxGeom(w, h, d), mat);
    m.castShadow = false; m.receiveShadow = false;
    return m;
  }

  // ---- build the lobby fixtures once per city --------------------------------
  // world-frame from the lot itself (no buildings.js anchor for "bank"): door
  // gives the inward normal; we lay the teller counter across the back wall, the
  // ATM by the entry, the loan desk on the open side, the vault in a back corner.
  function buildDisplays() {
    const m = mats(), bk = S.bk, lot = S.lot;
    const group = new THREE.Group();
    S.group = group;
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    root.add(group);

    const door = lot.building.door;
    const inx = num(door.nx, 0), inz = num(door.nz, 1);   // inward unit (one axis ~0)
    const tx = -inz, tz = inx;                            // wall tangent
    const w = num(lot.building.w, 10), d = num(lot.building.d, 10);
    const WT = 0.4;
    const halfIn = (Math.abs(inx) > Math.abs(inz) ? w : d) / 2;   // door wall → centre
    const halfTan = (Math.abs(inx) > Math.abs(inz) ? d : w) / 2;
    const cx = lot.cx, cz = lot.cz;
    S.cx = cx; S.cz = cz;

    // clamp a door-relative (depth into room, lateral along wall) point to floor
    function at(depth, lat) {
      let lx = inx * (depth - halfIn) + tx * lat;
      let lz = inz * (depth - halfIn) + tz * lat;
      lx = Math.min(w / 2 - WT - 0.7, Math.max(-w / 2 + WT + 0.7, lx));
      lz = Math.min(d / 2 - WT - 0.7, Math.max(-d / 2 + WT + 0.7, lz));
      return { x: cx + lx, z: cz + lz };
    }

    // ---- THE TELLER LINE: a long counter near the back, with glass + screens.
    // (the back wall is at depth ~2·halfIn − WT; seat the counter a little ahead.)
    const counterDepth = 2 * halfIn - WT - 1.4;
    const cLen = Math.min(5.5, Math.max(2.6, 2 * halfTan - 3));
    const cwid = 0.7;
    const cgw = Math.abs(tx) * cLen + Math.abs(tz) * cwid;
    const cgd = Math.abs(tz) * cLen + Math.abs(tx) * cwid;
    const cc = at(counterDepth, 0);
    const counter = box(cgw, 1.1, cgd, m.counter);
    counter.position.set(cc.x, 0.55, cc.z);
    counter.receiveShadow = true;
    group.add(counter);
    const cap = box(cgw + 0.08, 0.06, cgd + 0.08, m.brass);
    cap.position.set(cc.x, 1.13, cc.z);
    group.add(cap);
    // keep the counter solid so you walk UP to it, never through (height-gated)
    if (CBZ.colliders) CBZ.colliders.push({ minX: cc.x - cgw / 2, maxX: cc.x + cgw / 2, minZ: cc.z - cgd / 2, maxZ: cc.z + cgd / 2, y0: 0, y1: 1.15 });
    // the GLASS partition above the counter — registered as real city glass so
    // a heist round shatters it like any window (the bank's a target, after all).
    if (CBZ.cityRegisterGlass) {
      CBZ.cityRegisterGlass(group, cc.x + inx * 0.02, 1.75, cc.z + inz * 0.02, cgw - 0.1, 1.1, cgd - 0.1, 0, 0, null);
    } else {
      const gl = box(cgw - 0.1, 1.1, cgd - 0.1, m.glass);
      gl.position.set(cc.x, 1.75, cc.z); group.add(gl);
    }
    // three teller screens glowing along the counter (the blue trust accent)
    for (let i = 0; i < 3; i++) {
      const lat = (i - 1) * (cLen / 3.2);
      const sx = cc.x + tx * lat, sz = cc.z + tz * lat;
      const scr = box(0.34, 0.24, 0.05, m.screen);
      scr.position.set(sx + inx * 0.1, 1.28, sz + inz * 0.1);
      scr.rotation.y = Math.atan2(-inx, -inz);
      group.add(scr);
    }
    const tlabel = tag(bk.name, "#9fc0ff", 2.4, 0.5);
    if (tlabel) { tlabel.position.set(cc.x, 2.55, cc.z); group.add(tlabel); }
    S.stations.push({ kind: "teller", x: cc.x, z: cc.z, reach: REACH + 0.4 });

    // ---- THE ATM by the entrance (quick withdraw — a roll for the street).
    const atmPos = at(1.8, Math.min(halfTan - 1.0, 2.0));
    const atm = box(0.7, 1.6, 0.45, m.atm);
    atm.position.set(atmPos.x, 0.8, atmPos.z);
    atm.rotation.y = Math.atan2(-inx, -inz);
    group.add(atm);
    const face = box(0.5, 0.5, 0.08, m.atmFace);
    face.position.set(atmPos.x + inx * 0.22, 1.15, atmPos.z + inz * 0.22);
    face.rotation.y = atm.rotation.y;
    group.add(face);
    const atmScreen = box(0.34, 0.26, 0.04, m.screen);
    atmScreen.position.set(atmPos.x + inx * 0.25, 1.2, atmPos.z + inz * 0.25);
    atmScreen.rotation.y = atm.rotation.y;
    group.add(atmScreen);
    if (CBZ.colliders) CBZ.colliders.push({ minX: atmPos.x - 0.45, maxX: atmPos.x + 0.45, minZ: atmPos.z - 0.45, maxZ: atmPos.z + 0.45, y0: 0, y1: 1.6 });
    const atag = tag("ATM", "#9fe0ff", 1.0, 0.36);
    if (atag) { atag.position.set(atmPos.x, 1.85, atmPos.z); group.add(atag); }
    S.stations.push({ kind: "atm", x: atmPos.x, z: atmPos.z, reach: REACH });

    // ---- THE LOAN-OFFICER DESK on the open side (the apply-for-a-loan pod).
    const deskPos = at(Math.max(3.2, counterDepth - 2.6), -Math.min(halfTan - 1.2, 2.4));
    const desk = box(1.5, 0.78, 0.9, m.desk);
    desk.position.set(deskPos.x, 0.39, deskPos.z);
    desk.rotation.y = Math.atan2(-inx, -inz);
    desk.receiveShadow = true;
    group.add(desk);
    const monitor = box(0.4, 0.3, 0.05, m.screen);
    monitor.position.set(deskPos.x, 0.95, deskPos.z);
    monitor.rotation.y = desk.rotation.y;
    group.add(monitor);
    if (CBZ.colliders) CBZ.colliders.push({ minX: deskPos.x - 0.78, maxX: deskPos.x + 0.78, minZ: deskPos.z - 0.5, maxZ: deskPos.z + 0.5, y0: 0, y1: 0.82 });
    const dlabel = tag("Loans & Mortgages", "#bcffd0", 1.9, 0.42);
    if (dlabel) { dlabel.position.set(deskPos.x, 1.35, deskPos.z); group.add(dlabel); }
    S.stations.push({ kind: "loan", x: deskPos.x, z: deskPos.z, reach: REACH + 0.3 });

    // ---- THE VAULT door at the back corner (set dressing; the bank's anchor).
    const vlat = (deskPos.x - cx) * tx + (deskPos.z - cz) * tz;   // OPPOSITE the desk side
    const vaultPos = at(2 * halfIn - 1.0, vlat <= 0 ? Math.min(halfTan - 1.4, 2.2) : Math.max(-(halfTan - 1.4), -2.2));
    const vbody = box(2.0, 2.4, 0.5, m.vault);
    vbody.position.set(vaultPos.x, 1.2, vaultPos.z);
    vbody.rotation.y = Math.atan2(-inx, -inz);
    group.add(vbody);
    // the vault DOOR gets its OWN fresh material (not the _shared cmat) so a
    // heist can flash its emissive while drilling without bleeding the glow onto
    // every other prop that happens to share the vault-grey tone.
    const vdoorMat = (CBZ.mat ? CBZ.mat(0x6a7480) : m.vaultDoor);
    const vdoor = box(1.5, 1.8, 0.14, vdoorMat);
    vdoor.position.set(vaultPos.x + inx * 0.22, 1.1, vaultPos.z + inz * 0.22);
    vdoor.rotation.y = vbody.rotation.y;
    group.add(vdoor);
    const hub = box(0.3, 0.3, 0.14, m.brass);
    hub.position.set(vaultPos.x + inx * 0.28, 1.1, vaultPos.z + inz * 0.28);
    hub.rotation.y = vbody.rotation.y;
    group.add(hub);
    // remember the vault world spot + its door material so heists.js can LOCATE
    // the real vault to drill and glow it red while it's being cracked (the
    // heist owns the score arc; the branch owns the prop — one hook bridges them).
    S.vault = { x: vaultPos.x, z: vaultPos.z, door: vdoor, doorMat: vdoorMat, hub: hub };
  }

  // ---- the look-pick (which station are you facing within reach) -------------
  function pickStation() {
    const P = CBZ.player, B = S.bk.bounds;
    const px = P.pos.x, pz = P.pos.z;
    if (px < B.minX - 1.5 || px > B.maxX + 1.5 || pz < B.minZ - 1.5 || pz > B.maxZ + 1.5) return null;
    const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best = null, bestScore = -1;
    for (const st of S.stations) {
      const dx = st.x - px, dz = st.z - pz, dd = Math.hypot(dx, dz);
      if (dd > (st.reach || REACH) || dd < 0.05) continue;
      const dot = (dx / dd) * fx + (dz / dd) * fz;
      if (dot < LOOK_DOT) continue;
      const score = dot - dd * 0.05;
      if (score > bestScore) { bestScore = score; best = st; }
    }
    return best;
  }

  // ============================================================
  //  TELLER + ATM actions (mirror shops.js deposit/withdraw/bribe exactly)
  // ============================================================
  function deposit() {
    const c = num(g.cash, 0);
    if (c <= 0) { note("No cash on you to deposit.", 1.4); return; }
    g.cityBank = num(g.cityBank, 0) + c; g.cash = 0;
    if (CBZ.sfx) CBZ.sfx("coin");
    note("Deposited " + fmt$(c) + " — insured account balance " + fmt$(g.cityBank) + ".", 2.2, { from: "Meridian Trust", app: "bank" });
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
  }
  function withdraw(amount) {
    const amt = Math.min(amount || 500, num(g.cityBank, 0));
    if (amt <= 0) { note("Bank's empty.", 1.4); return; }
    g.cityBank = num(g.cityBank, 0) - amt;
    if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(amt); else g.cash = num(g.cash, 0) + amt;
    if (CBZ.sfx) CBZ.sfx("coin");
    note("Withdrew " + fmt$(amt) + ".", 1.6, { from: "Meridian Trust", app: "bank" });
    if (CBZ.cityWorldCommit) CBZ.cityWorldCommit();
  }
  function bribe() {
    const stars = num(g.wanted, 0) | 0;
    if (stars <= 0) { note("You're clean — nothing to pay off.", 1.4); return; }
    const base = (CBZ.CITY && CBZ.CITY.econ && CBZ.CITY.econ.bribeBase) || 150;
    const cost = base * stars;
    if (!(CBZ.city && CBZ.city.spend && CBZ.city.spend(cost))) { note("A bribe costs " + fmt$(cost) + " in cash right now.", 1.8); return; }
    const T = CBZ.CITY && CBZ.CITY.starHeat;
    if (T) g.heat = Math.max(0, T[Math.max(0, stars - 1)] - 1);
    if (CBZ.city && CBZ.city.addHeat) CBZ.city.addHeat(0);
    note("Paid off the cops — down to " + (stars - 1) + "★ (" + fmt$(cost) + ").", 2.2);
    if (CBZ.sfx) CBZ.sfx("coin");
  }

  // ============================================================
  //  THE LOAN APPLY PANEL (focused DOM, self-managed; gunstore prompt style)
  // ============================================================
  function clampPersonalAmt(v) {
    const cap = Math.max(0, personalCapacity());
    v = Math.max(MIN_PRINCIPAL, Math.round(num(v, MIN_PRINCIPAL)));
    return Math.min(v, Math.max(MIN_PRINCIPAL, cap));
  }
  function panelEl() {
    if (S.panel) return S.panel;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "bankLoanPanel";
    d.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;" +
      "background:rgba(13,16,21,.96);border:1px solid #3a4150;border-radius:16px;padding:18px 20px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;width:min(420px,86vw);box-shadow:0 18px 60px rgba(0,0,0,.6)";
    document.body.appendChild(d);
    S.panel = d;
    return d;
  }
  function openPanel() {
    const el = panelEl(); if (!el) return;
    S.panelOpen = true; CBZ.cityMenuOpen = true;
    S.mode = "personal"; S.pAmt = clampPersonalAmt(Math.max(PERSONAL_FLOOR, Math.round(personalCapacity() * 0.5)));
    S.pTerm = TERMS.personal;
    renderPanel();
    el.style.display = "block";
    if (CBZ.sfx) CBZ.sfx("door");
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function closePanel() {
    S.panelOpen = false; CBZ.cityMenuOpen = false;
    if (S.panel) S.panel.style.display = "none";
    if (CBZ.requestLock && g.state === "playing") CBZ.requestLock();
  }
  function renderPanel() {
    const el = S.panel; if (!el) return;
    const cap = personalCapacity();
    const amt = clampPersonalAmt(S.pAmt); S.pAmt = amt;
    const term = S.pTerm;
    const o = offer("personal", amt, {});
    const pay = o.approved ? o.payment : 0;
    const total = o.approved ? pay * term : 0;
    const open = liveLoans();
    let openRows = "";
    if (open.length) {
      openRows = "<div style='margin-top:12px;border-top:1px solid #2a313c;padding-top:10px'>" +
        "<div style='color:#9fb0c8;font-size:13px;margin-bottom:6px'>Your loans (auto-paid each cycle from cash → bank):</div>";
      for (const r of open) {
        openRows += "<div style='display:flex;justify-content:space-between;gap:10px;font-size:13px;margin:3px 0'>" +
          "<span>" + (r.kind === "mortgage" ? "Mortgage" : r.kind === "auto" ? "Auto" : "Personal") +
          " · " + fmt$(Math.round(r.balance)) + " left</span>" +
          "<button data-pay='" + r.id + "' style='cursor:pointer;background:#2b3340;border:1px solid #3a4150;color:#bcffd0;border-radius:8px;padding:2px 8px;font-family:inherit'>Pay $500</button></div>";
      }
      openRows += "</div>";
    }
    el.innerHTML =
      "<div style='font-size:20px;font-weight:600;margin-bottom:2px'>Meridian Trust — Lending</div>" +
      "<div style='color:#7f8794;font-size:13px;margin-bottom:14px'>Net worth " + fmt$(netWorth()) +
        " · unsecured credit up to <span style='color:#bcffd0'>" + fmt$(cap) + "</span></div>" +
      "<div style='display:flex;gap:8px;margin-bottom:14px'>" +
        "<div style='flex:1;background:#161b22;border:1px solid #2a313c;border-radius:10px;padding:10px'>" +
          "<div style='color:#9fb0c8;font-size:12px'>Personal loan</div>" +
          "<div style='display:flex;align-items:center;gap:8px;margin-top:8px'>" +
            "<button data-amt='-1000' style='cursor:pointer;background:#2b3340;border:1px solid #3a4150;color:#e8eef7;border-radius:8px;padding:4px 10px;font-family:inherit'>−</button>" +
            "<div style='flex:1;text-align:center;font-size:18px;color:#bcd0ff'>" + fmt$(amt) + "</div>" +
            "<button data-amt='1000' style='cursor:pointer;background:#2b3340;border:1px solid #3a4150;color:#e8eef7;border-radius:8px;padding:4px 10px;font-family:inherit'>+</button>" +
          "</div>" +
          "<div style='display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:#9fb0c8'>Term" +
            "<button data-term='-12' style='cursor:pointer;background:#2b3340;border:1px solid #3a4150;color:#e8eef7;border-radius:8px;padding:2px 8px;font-family:inherit'>−</button>" +
            "<span style='color:#e8eef7'>" + term + " cycles</span>" +
            "<button data-term='12' style='cursor:pointer;background:#2b3340;border:1px solid #3a4150;color:#e8eef7;border-radius:8px;padding:2px 8px;font-family:inherit'>+</button>" +
          "</div>" +
          "<div style='margin-top:10px;font-size:13px'>Rate <b style='color:#ffd166'>" + Math.round(o.rate * 100) + "%</b>" +
            " · payment <b style='color:#bcffd0'>" + fmt$(pay) + "</b>/cycle" +
            "<div style='color:#7f8794;font-size:12px;margin-top:2px'>~" + fmt$(total) + " over the term</div></div>" +
          "<button data-take='personal' style='cursor:pointer;width:100%;margin-top:10px;background:#1e7a44;border:1px solid #2a9c58;color:#eafff0;border-radius:10px;padding:8px;font-family:inherit;font-size:14px'>Borrow " + fmt$(amt) + "</button>" +
        "</div>" +
      "</div>" +
      "<div style='background:#161b22;border:1px solid #2a313c;border-radius:10px;padding:10px;font-size:13px;color:#9fb0c8'>" +
        "<b style='color:#bcd0ff'>Mortgage pre-approval:</b> financing a home? The realtor desk or property market books it through us — 20% down, ~6% on the balance, auto-paid each cycle." +
      "</div>" +
      openRows +
      "<div style='display:flex;justify-content:flex-end;gap:8px;margin-top:16px'>" +
        "<button data-close='1' style='cursor:pointer;background:#2b3340;border:1px solid #3a4150;color:#e8eef7;border-radius:10px;padding:8px 16px;font-family:inherit'>Close</button>" +
      "</div>";
    // wire the buttons (delegated each render — the panel is tiny)
    el.querySelectorAll("[data-amt]").forEach(function (b) { b.onclick = function () { S.pAmt = clampPersonalAmt(S.pAmt + (+b.getAttribute("data-amt"))); renderPanel(); }; });
    el.querySelectorAll("[data-term]").forEach(function (b) { b.onclick = function () { S.pTerm = Math.max(12, Math.min(120, S.pTerm + (+b.getAttribute("data-term")))); renderPanel(); }; });
    el.querySelectorAll("[data-pay]").forEach(function (b) { b.onclick = function () { payExtra(b.getAttribute("data-pay"), 500); renderPanel(); }; });
    const tk = el.querySelector("[data-take]"); if (tk) tk.onclick = function () { takePersonal(); };
    const cl = el.querySelector("[data-close]"); if (cl) cl.onclick = function () { closePanel(); };
  }
  function takePersonal() {
    const amt = clampPersonalAmt(S.pAmt);
    const o = offer("personal", amt, {});
    if (!o.approved || o.principal < MIN_PRINCIPAL) { note("Declined — " + (o.reason || "not approved") + ".", 2); if (CBZ.sfx) CBZ.sfx("glass"); return; }
    o.purpose = "personal"; o.termTicks = S.pTerm; o.payment = paymentFor(o.principal, o.rate, S.pTerm);
    const id = take(o);
    if (id) {
      big("Loan funded — " + fmt$(o.principal) + " in your pocket.");
      note("Borrowed " + fmt$(o.principal) + " at " + Math.round(o.rate * 100) + "% — " + fmt$(o.payment) + "/cycle auto-paid.", 2.6);
      renderPanel();
    }
  }

  // ---- the in-world prompt for the looked-at station -------------------------
  function promptText(st) {
    // The physical teller window, ATM and loan desk already identify the
    // station. Use only a quiet symbol—account details live in the bank panel
    // and phone, not in a paragraph pasted over the world. On touch the symbol
    // becomes a worded verb pill (tap fires the same [E] handler below).
    if (st.kind === "teller") return CBZ.touchActionPrompt ? CBZ.touchActionPrompt("e", "USE TELLER", "◆") : "◆";
    if (st.kind === "atm") return CBZ.touchActionPrompt ? CBZ.touchActionPrompt("e", "USE ATM", "▣") : "▣";
    if (st.kind === "loan") return CBZ.touchActionPrompt ? CBZ.touchActionPrompt("e", "LOAN DESK", "◇") : "◇";
    return "";
  }
  function actOn(st) {
    if (!st) return;
    if (st.kind === "teller") {
      // teller does the multi-action: deposit primary, but if you're wanted the
      // teller will pay it down (the shops.js bank semantics, one counter).
      if ((num(g.wanted, 0) | 0) > 0 && num(g.cash, 0) <= 0) bribe();
      else deposit();
      return;
    }
    if (st.kind === "atm") { withdraw(500); return; }
    if (st.kind === "loan") { openPanel(); return; }
  }

  function promptEl() {
    if (S.prompt) return S.prompt;
    if (typeof document === "undefined" || !document.body) return null;
    const d = document.createElement("div");
    d.id = "bankPrompt";
    d.style.cssText = "position:fixed;left:50%;bottom:150px;transform:translateX(-50%);z-index:46;display:none;" +
      "background:rgba(13,16,21,.9);border:1px solid #3a4150;border-radius:12px;padding:7px 14px;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;font-size:15px;pointer-events:auto;cursor:pointer;text-align:center;max-width:78vw";
    d.addEventListener("click", function () { if (S.cur) actOn(S.cur); });   // tap-to-act (mobile)
    document.body.appendChild(d);
    S.prompt = d;
    return d;
  }
  function showPrompt(txt) {
    const el = promptEl(); if (!el) return;
    if (txt !== S.lastTxt) { el.innerHTML = txt; S.lastTxt = txt; }
    if (el.style.display !== "block") el.style.display = "block";
  }
  function hidePrompt() {
    if (S.prompt && S.prompt.style.display !== "none") S.prompt.style.display = "none";
    S.cur = null;
  }

  // ---- find the bank lot + build once (self-healing, gunstore pattern) -------
  function ensure() {
    const arena = CBZ.city && CBZ.city.arena;
    if (S.built) {
      if (S.arena === arena) return true;
      // arena rebuilt (new run) — the old group died with the old root
      S.built = false; S.group = null; S.stations = []; S.cur = null; S.lot = null; S.bk = null;
    }
    if (!arena) return false;
    if (S.noLotArena === arena) return false;
    let lot = arena.bankLot || null;
    if (!(lot && lot.building && (lot.building.shop && lot.building.shop.kind === "bank"))) {
      lot = null;
      const lots = arena.lots || [];
      for (let i = 0; i < lots.length; i++) {
        const L = lots[i];
        if (L && L.building && L.building.shop && L.building.shop.kind === "bank") { lot = L; break; }
      }
      if (!lot && lots.length) { S.noLotArena = arena; return false; }
    }
    if (!lot) return false;
    // derive the walkable bounds the prompts gate on (no buildings.js anchor).
    const w = num(lot.building.w, 10), d = num(lot.building.d, 10), WT = 0.4;
    S.lot = lot;
    S.bk = { name: lot.building.name || "Meridian Trust",
             bounds: { minX: lot.cx - w / 2 + WT, maxX: lot.cx + w / 2 - WT, minZ: lot.cz - d / 2 + WT, maxZ: lot.cz + d / 2 - WT } };
    S.arena = arena;
    buildDisplays();
    S.built = true;
    return true;
  }

  // ---- per-frame: vis-gate fixtures + drive the prompt -----------------------
  CBZ.onUpdate(38.4, function (dt) {
    if (!g || g.mode !== "city") { if (S.group && S.group.visible) S.group.visible = false; hidePrompt(); if (S.panelOpen) closePanel(); return; }
    if (!ensure()) return;
    const P = CBZ.player;
    const dx = P.pos.x - S.cx, dz = P.pos.z - S.cz;
    const near = (dx * dx + dz * dz) < VIS_R * VIS_R;
    if (S.group && S.group.visible !== near) S.group.visible = near;
    if (!near || g.state !== "playing" || P.dead || P.driving) { hidePrompt(); if (S.panelOpen && (!near || P.dead || P.driving)) closePanel(); return; }
    if (S.panelOpen) { hidePrompt(); return; }     // panel up: in-world prompt yields
    if (CBZ.cityMenuOpen) { hidePrompt(); return; }
    const st = pickStation();
    if (!st) { hidePrompt(); return; }
    S.cur = st;
    showPrompt(promptText(st));
  });

  // [E] acts on the station you're facing. CAPTURE phase so the bank wins the
  // key over interact.js's bubble listener; stopImmediatePropagation keeps one
  // press from ALSO opening the clerk's counter menu (the gunstore pattern).
  addEventListener("keydown", function (e) {
    const k = (e.key || "").toLowerCase();
    if (S.panelOpen) { if (k === "escape" || k === "e") { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); e.stopPropagation(); closePanel(); } return; }
    if (!S.cur || !g || g.mode !== "city" || g.state !== "playing") return;
    if (CBZ.cityMenuOpen || (CBZ.player && (CBZ.player.driving || CBZ.player.dead))) return;
    if (k !== "e") return;
    e.preventDefault();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    e.stopPropagation();
    actOn(S.cur);
  }, true);

  // ---- public storefront hook (contract [F]) + harness handles ----------------
  // is the bank live for this lot? interact.js feature-detects this to suppress
  // the dumb generic "Shop here" vendor verb when the branch self-prompts.
  CBZ.cityBankLive = function (lot) { return !!(S.built && S.lot && (!lot || lot === S.lot)); };
  CBZ.cityBankLot = function () { return (S.built && S.lot) || null; };
  // THE VAULT (contract for heists.js): where is the real steel vault, and how to
  // light it up mid-crack. heists.js drills THIS spot for the BANK score so the
  // grab happens at the actual vault, not just "the lot centre". Heat/glow only —
  // the branch's own cash pool is untouched; the heist mints its own bag.
  CBZ.cityBankVault = function () {
    if (!(S.built && S.vault)) return null;
    return { x: S.vault.x, z: S.vault.z };
  };
  // glow the vault door (0..1) while it's being drilled; 0 clears it. Safe no-op
  // if the branch isn't built (headless / not near a bank).
  CBZ.cityBankVaultGlow = function (amt) {
    if (!(S.built && S.vault && S.vault.doorMat && S.vault.doorMat.emissive)) return;
    amt = Math.max(0, Math.min(1, +amt || 0));
    // a hot drilled-steel orange that ramps with progress
    const r = Math.round(0x66 * amt), gC = Math.round(0x22 * amt);
    try { S.vault.doorMat.emissive.setRGB(r / 255, gC / 255, 0); } catch (e) {}
  };
  // headless/harness handles for the in-world actions
  CBZ.cityBankDeposit = function () { deposit(); return true; };
  CBZ.cityBankWithdraw = function (amt) { withdraw(amt || 500); return true; };
  CBZ.cityBankApply = function (amt, term, purpose) {
    purpose = purpose || "personal";
    const o = offer(purpose, amt, {});
    if (!o.approved) return null;
    o.purpose = purpose; if (term) { o.termTicks = term; o.payment = paymentFor(o.principal, o.rate, term); }
    return take(o);
  };
})();
