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

    // ---- THE TELLER LINE: a long counter, with glass + screens.
    // WHERE IT GOES CHANGED WITH THE VAULT. The counter used to sit 1.4 m off
    // the BACK WALL, because behind it was nothing. Behind it is now a
    // strongroom (BANK_VAULT_V1 cuts a partition rd metres in from that wall),
    // so a counter at the old depth would stand INSIDE the vault. It now seats
    // itself 1.9 m in front of the partition — which is also what puts the
    // teller posts the vault pass declared (1.15 m in front of the partition)
    // BEHIND their own counter, where a teller stands.
    const RVv = lot._vaultRoom;
    let counterDepth = 2 * halfIn - WT - 1.4;
    if (RVv) {
      // the partition's depth measured in the same door-relative frame `at()`
      // uses: project the vault's building-local plane onto the inward axis.
      const bOx = (lot.building.ox != null) ? lot.building.ox : cx;
      const bOz = (lot.building.oz != null) ? lot.building.oz : cz;
      const pWx = bOx + RVv.plx, pWz = bOz + RVv.plz;
      const partDepth = (pWx - cx) * inx + (pWz - cz) * inz + halfIn;
      counterDepth = Math.max(2.6, Math.min(counterDepth, partDepth - 1.9));
    }
    const cLen = Math.min(5.5, Math.max(2.6, 2 * halfTan - 3));
    const cwid = 0.7;
    const cc = at(counterDepth, 0);
    /* THE STAFF GAP. A 1.1 m counter is a solid collider and the strongroom is
       behind it, so an unbroken teller line is a wall between the player and
       the only door in this building worth opening. A real banking hall has a
       break at the end of the run that staff walk through, and putting ours in
       line with the vault door is what turns "the vault is unreachable" into
       "the vault is behind the counter" — which is the whole point of it being
       back there. Drawn as TWO runs so the gap is a real hole with no collider,
       never a decorative notch. */
    const GAPW = 1.7;
    const gapLat = RVv ? Math.max(-cLen / 2 + GAPW / 2, Math.min(cLen / 2 - GAPW / 2, RVv.lat || 0)) : null;
    const runs = (gapLat == null)
      ? [{ lat: 0, len: cLen }]
      : [{ lat: (-cLen / 2 + (gapLat - GAPW / 2)) / 2, len: Math.max(0, (gapLat - GAPW / 2) - (-cLen / 2)) },
         { lat: ((gapLat + GAPW / 2) + cLen / 2) / 2, len: Math.max(0, cLen / 2 - (gapLat + GAPW / 2)) }];
    for (const run of runs) {
      if (run.len < 0.35) continue;
      const rgw = Math.abs(tx) * run.len + Math.abs(tz) * cwid;
      const rgd = Math.abs(tz) * run.len + Math.abs(tx) * cwid;
      const rc = at(counterDepth, run.lat);
      const counter = box(rgw, 1.1, rgd, m.counter);
      counter.position.set(rc.x, 0.55, rc.z);
      counter.receiveShadow = true;
      group.add(counter);
      const cap = box(rgw + 0.08, 0.06, rgd + 0.08, m.brass);
      cap.position.set(rc.x, 1.13, rc.z);
      group.add(cap);
      // keep the counter solid so you walk UP to it, never through (height-gated)
      if (CBZ.colliders) CBZ.colliders.push({ minX: rc.x - rgw / 2, maxX: rc.x + rgw / 2, minZ: rc.z - rgd / 2, maxZ: rc.z + rgd / 2, y0: 0, y1: 1.15 });
      // the GLASS partition above the counter — registered as real city glass so
      // a heist round shatters it like any window (the bank's a target, after all).
      if (CBZ.cityRegisterGlass) {
        CBZ.cityRegisterGlass(group, rc.x + inx * 0.02, 1.75, rc.z + inz * 0.02, rgw - 0.1, 1.1, rgd - 0.1, 0, 0, null);
      } else {
        const gl = box(rgw - 0.1, 1.1, rgd - 0.1, m.glass);
        gl.position.set(rc.x, 1.75, rc.z); group.add(gl);
      }
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
    // ATM fascia front is +IN 0.26m. Keep 2.5cm of real air before the 4cm
    // screen slab so it cannot flicker with the fascia at any viewing angle.
    atmScreen.position.set(atmPos.x + inx * 0.305, 1.2, atmPos.z + inz * 0.305);
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

    // ---- THE VAULT.
    // This used to be SET DRESSING and the file said so: a 2 m slab, a 1.5 m
    // "door" that never moved, a brass hub, and a comment admitting the branch
    // owned a prop while heists.js owned an abstract drill meter. The owner's
    // ask deleted that arrangement — "real vaults in the back with massive
    // amounts that you can bomb your way into, that OPEN AS ROOMS just like
    // elevators and planes". So the vault is now a real strongroom built by the
    // BANK_VAULT_V1 pass below (a partition, an opening, a door that swings,
    // shelves, and money you carry out in your hands), and this lobby build
    // only has to point S.vault at it so cityBankVault()/cityBankVaultGlow()
    // keep answering for every existing consumer.
    if (lot._vaultRoom) {
      const RV = lot._vaultRoom;
      S.vault = { x: RV.x, z: RV.z, door: RV.leaf, doorMat: RV.doorMat, hub: RV.wheel, room: RV };
    } else if (CBZ.CONFIG.BANK_VAULT_V1 === false) {
      // FLAG OFF: the shipped set-dressing vault, byte-for-byte.
      const vlat = (deskPos.x - cx) * tx + (deskPos.z - cz) * tz;   // OPPOSITE the desk side
      const vaultPos = at(2 * halfIn - 1.0, vlat <= 0 ? Math.min(halfTan - 1.4, 2.2) : Math.max(-(halfTan - 1.4), -2.2));
      const vbody = box(2.0, 2.4, 0.5, m.vault);
      vbody.position.set(vaultPos.x, 1.2, vaultPos.z);
      vbody.rotation.y = Math.atan2(-inx, -inz);
      group.add(vbody);
      const vdoorMat = (CBZ.mat ? CBZ.mat(0x6a7480) : m.vaultDoor);
      const vdoor = box(1.5, 1.8, 0.14, vdoorMat);
      vdoor.position.set(vaultPos.x + inx * 0.22, 1.1, vaultPos.z + inz * 0.22);
      vdoor.rotation.y = vbody.rotation.y;
      group.add(vdoor);
      const hub = box(0.3, 0.3, 0.14, m.brass);
      hub.position.set(vaultPos.x + inx * 0.28, 1.1, vaultPos.z + inz * 0.28);
      hub.rotation.y = vbody.rotation.y;
      group.add(hub);
      S.vault = { x: vaultPos.x, z: vaultPos.z, door: vdoor, doorMat: vdoorMat, hub: hub };
    }
    if (CBZ.interiorTrackFixture) CBZ.interiorTrackFixture("bank-lobby", lot.building, group);
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
  // THE MACHINE HAS TO HAVE THE NOTES. A TAKE IS A TRANSFER (city/shops.js's
  // CBZ.cityTill), and that cuts both ways: an ATM dispensing your OWN money
  // is still a physical box with a cash cassette in it, and cassettes run
  // out. The cassette is a declared cash point on the ledger, so it is one
  // balance — the machine can be emptied by ordinary withdrawals, it refills
  // on the branch's own service run, and anything that wants to TAKE it (a
  // crowbar, a truck and a chain) asks the same ledger every other score in
  // the game asks. Real cassettes carry $20k-$200k; this one is derived, not
  // typed — see atmCassette().
  function atmCassette() {
    if (!S.lot) return null;
    if (S._atmBox) return S._atmBox;
    const TL = CBZ.cityTill;
    if (!TL || !TL.declare || !TL.districtCash) return null;
    // a branch's ATM is stocked out of the same district cash the branch's own
    // vault is derived from: one service run's worth (a day) of what this part
    // of town physically banks, split across the branches serving it. That
    // puts a downtown machine near the top of the real $20k-$200k band and a
    // projects machine near the bottom, with no number typed here.
    const box = { _atmOf: 0 };
    TL.declare(box, {
      name: "Meridian Trust ATM", kind: "atm", point: "vault",
      amount: function () { return box._atmBal; },
      drain: function (n) { box._atmBal = Math.max(0, box._atmBal - n); },
    });
    const dk = TL.districtOf(S.lot), dc = TL.districtCash(dk);
    box._atmOf = Math.max(2000, Math.round(dc.cash * 24 / Math.max(1, dc.branches)));
    box._atmBal = box._atmOf;
    box._atmSvc = 0;
    S._atmBox = box;
    return box;
  }
  // the service run: a machine is restocked on the same daily cadence the
  // rest of the ledger banks on. No timer of its own — it reads the clock.
  function atmService(box) {
    const day = (CBZ.dayCount ? CBZ.dayCount() : 0) | 0;
    if (box._atmSvc !== day) { box._atmSvc = day; box._atmBal = box._atmOf; }
  }
  function withdraw(amount, atMachine) {
    let amt = Math.min(amount || 500, num(g.cityBank, 0));
    if (amt <= 0) { note("Bank's empty.", 1.4); return; }
    if (atMachine) {
      const box = (CBZ.cityTill && CBZ.cityTill.take) ? atmCassette() : null;
      if (box) {
        atmService(box);
        const got = CBZ.cityTill.take(box, { max: amt, by: "player" });
        if (!(got.taken > 0)) { note("This machine's out of cash. Try the teller.", 2.2, { from: "Meridian Trust", app: "bank" }); return; }
        if (got.taken < amt) note("Machine could only dispense " + fmt$(got.taken) + ".", 2, { from: "Meridian Trust", app: "bank" });
        amt = got.taken;
      }
    }
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
    if (!o.approved || o.principal < MIN_PRINCIPAL) { note("Declined — " + (o.reason || "not approved") + ".", 2); return; }
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
    if (st.kind === "teller") return CBZ.touchActionPrompt ? CBZ.touchActionPrompt("e", "Teller", "◆") : "◆";
    if (st.kind === "atm") return CBZ.touchActionPrompt ? CBZ.touchActionPrompt("e", "ATM", "▣") : "▣";
    if (st.kind === "loan") return CBZ.touchActionPrompt ? CBZ.touchActionPrompt("e", "Loan", "◇") : "◇";
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
    if (st.kind === "atm") { withdraw(500, true); return; }
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

  /* ==========================================================================
     BANK_VAULT_V1 — THE VAULT IS A ROOM.   [CBZ.cityVaultRoom]

     OWNER (2026-08-02, verbatim): "banks need an overhaul so they have real
     tellers with some amount and then real vaults in the back with massive
     amounts that you can bomb your way into, THAT OPEN AS ROOMS just like
     elevators and planes — all these small rooms coded. these real full vaults
     should be in casinos too… ONLY NPCS OR PHYSICAL BOMBS CAN OPEN THEM… this
     is interaction/animation options and physical assets, not choreographed
     mini-missions. gta is fake, you do the mini missions that are
     choreographed — this is real."

     WHAT WAS THERE. Three boxes and a comment that called itself set dressing,
     plus heists.js's `drillTime: 9` — a progress bar you stood next to. Nine
     seconds of holding still, a number goes up, cash appears in your wallet.
     That is precisely the choreography the owner is describing.

     WHAT IT IS NOW, and every clause is a physical thing:
       • A REAL ROOM. A partition wall is cut across the back of the banking
         hall with ONE opening, the way city/interior_programs.js's divider()
         already cuts a floorplate, and the space behind it is a strongroom you
         can stand inside — shelving up the walls, banded bricks on the boards,
         a caged trolley, a strip light. You walk into it.
       • A DOOR THAT MOVES. A 0.42 m steel leaf on a hinge column, a boss, a
         spoked handwheel, six radial bolt lugs that withdraw as it swings. It
         has a COLLIDER while it is shut, and losing that collider is what
         "open" physically means. The swing is the elevators.js/aircraft_doors
         grammar the owner named: a phased arc, not a visibility toggle.
       • TWO WAYS IN, AND THEY ARE THE OWNER'S TWO. (1) PHYSICAL BOMBS: the
         door carries an armour pool and city/armored.js's crack pattern is
         copied exactly — we wrap CBZ.cityExplosion and feed real blast energy
         from an RPG, a grenade or a stack of C4 into it. Small arms do
         nothing; there is no lockpick, no minigame, no hold-to-drill.
         (2) AN NPC: a bank officer with his hands up at the door opens it,
         because that is how a vault is actually opened in a robbery. The
         PLAYER'S own claim goes through the ONE lock (CBZ.cityLock) and its
         `verb: "vault"` — which loyalty.js's apex rung has GRANTED since it
         shipped and which, until this line, nothing in the game consumed. A
         granted verb with no door was a stat fiction; this is its door.
       • MONEY YOU CARRY. Breaching does not pay you. It moves the branch's
         real CBZ.cityTill balance out of the ledger and onto the floor of the
         room as DUFFELS (city/inventory.js's CBZ.cashBags). You pick them up
         one at a time, you cannot sprint or aim while you hold one, and you
         walk them out yourself. Nothing auto-banks.

     THREE GRADES OF ROOM, and the grade comes from the MONEY, not from taste:
     shops.js's `cityTill.vaultTier(lot)` answers "branch | reserve | count"
     and this file reads it for the room size, the door's armour and the number
     of bags — so the city's cash centre is visibly the hardest door in the
     world BECAUSE it is the one holding tens of millions. Asymmetric polish,
     spent where doctrine LAW 1 says to spend it.

     DETERMINISM: every dimension and every shelf comes from the lot's own
     geometry and CBZ.hash01. No Math.random in this build path.
     ========================================================================= */
  if (CBZ.CONFIG.BANK_VAULT_V1 == null) CBZ.CONFIG.BANK_VAULT_V1 = true;
  if (CBZ.CONFIG.BANK_TELLERS_V1 == null) CBZ.CONFIG.BANK_TELLERS_V1 = true;

  const VAULTS = [];
  const VTALLY = { built: 0, breached: 0, blasted: 0, insider: 0, bags: 0, bagged: 0, refused: 0 };
  // armour pools, in the same units city/armored.js feeds its hull: one C4
  // charge (power 1.4) couples ~308, an RPG ~1.4, a grenade ~1.0. So a branch
  // strongroom is three charges, a casino count room four, and the city's cash
  // centre is a six-charge siege you cannot carry in one trip (explosives.js
  // tracks five planted at a time). The number IS the difficulty.
  const VHP = { branch: 820, count: 1120, reserve: 1900 };
  const VBLAST_TO_DOOR = 220;      // per unit of blast power, armored.js's rate
  const VBLAST_RANGE = 7.5;        // a charge further than this is not on the door
  const VSWING = 1.72;             // radians the leaf opens (~99 degrees)

  let VM = null;
  function vmats() {
    if (VM) return VM;
    VM = {
      steel: CBZ.cmat(0x5d6672),        // door leaf / frame
      steelD: CBZ.cmat(0x3c434d),       // shadowed steel
      steelL: CBZ.cmat(0x8b97a6),       // machined highlight
      brass: CBZ.cmat(0xcaa64a),        // wheel, plate
      wall: CBZ.cmat(0x4a5058),         // strongroom concrete
      shelf: CBZ.cmat(0x6d7681),        // steel shelving
      note: CBZ.cmat(0x5f9c52),         // banded notes
      band: CBZ.cmat(0xd8d2c0),
      lite: CBZ.cmat(0xdfe9ff, { emissive: 0xbcd0ff, ei: 0.85 }),
    };
    return VM;
  }
  function vbox(parent, w, h, d, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(CBZ.boxGeom(w, h, d), mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    m.castShadow = false; m.receiveShadow = false;
    parent.add(m);
    return m;
  }
  function vcyl(parent, rt, rb, h, seg, mat, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 16), mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) m.rotation.set(rx || 0, ry || 0, rz || 0);
    parent.add(m);
    return m;
  }

  /* THE DOOR ASSEMBLY, in a local frame where +Z is OUT of the vault (toward
     the room you stand in) and +X runs across the opening. It is built once
     into a pivot group whose origin is the HINGE EDGE, so opening is one
     rotation.y and the leaf sweeps out into the hall exactly like a real one.

     WHY A SLAB AND NOT A DISC. A circular leaf is the icon, but a circular
     leaf needs a circular hole cut in a rectangular partition, and this repo
     draws with boxes — the corners would show daylight into the strongroom. So
     the leaf FILLS the rectangular opening (which is what actually keeps the
     room dark and the collider honest) and carries the round boss, the
     handwheel and the radial boltwork on its face. Every cue that says VAULT
     is on the part you look at; the part that has to seal, seals. */
  function buildDoor(v) {
    const M2 = vmats();
    const pivot = new THREE.Group();
    const DW = v.dw, DH = v.dh, T = v.tier === "reserve" ? 0.52 : 0.40;
    // WHICH EDGE IT HANGS FROM is a per-lot fact, and it is authored by MOVING
    // THE LEAF, never by a negative scale: `scale.x = -1` mirrors the group,
    // which flips every child's face winding and lights the door inside-out
    // under r128's default single-sided materials.
    const S2 = v.hingeSign;                    // +1 hangs left, -1 hangs right
    const leaf = new THREE.Group();
    leaf.position.set(S2 * DW / 2, 0, 0);
    pivot.add(leaf);
    /* THE LEAF READS BY CONTRAST, NOT BY SIZE. The first pass drew the door in
       the same grey as the partition it sits in and the whole assembly went
       flat: a big slab you had to be told was a door. Real vault doors are
       nearly black machined steel inside a BRIGHT polished architrave, so the
       face goes dark, every edge that catches light gets a light bevel, and
       the boss/wheel/plate stack rises off it in three steps. */
    const doorMat = (CBZ.mat ? CBZ.mat(0x323a45) : M2.steelD);
    vbox(leaf, DW - 0.06, DH - 0.06, T, doorMat, 0, DH / 2, 0);
    // the bevel: a slightly larger, lighter plate BEHIND the face, so every
    // silhouette edge of the leaf is outlined against the dark centre.
    vbox(leaf, DW + 0.02, DH + 0.02, T - 0.10, M2.steelL, 0, DH / 2, -0.02);
    vbox(leaf, DW + 0.10, 0.09, T + 0.06, M2.steelL, 0, DH - 0.03, 0);   // head cap
    vbox(leaf, DW + 0.10, 0.09, T + 0.06, M2.steelL, 0, 0.05, 0);        // toe cap
    // a recessed inner panel — the step every armoured door has around its boss
    vbox(leaf, DW - 0.42, DH - 0.44, 0.06, M2.steel, 0, DH * 0.50, T / 2 + 0.02);
    // THE BOSS + THE WHEEL — the two shapes that say "vault" at a glance.
    const bossR = Math.min(0.86, DW * 0.40, DH * 0.30);
    vcyl(leaf, bossR, bossR, 0.13, 24, M2.steelL, 0, DH * 0.52, T / 2 + 0.09, Math.PI / 2, 0, 0);
    vcyl(leaf, bossR * 0.80, bossR * 0.80, 0.09, 24, M2.steel, 0, DH * 0.52, T / 2 + 0.16, Math.PI / 2, 0, 0);
    vcyl(leaf, bossR * 0.58, bossR * 0.58, 0.08, 24, M2.steelD, 0, DH * 0.52, T / 2 + 0.21, Math.PI / 2, 0, 0);
    const wheel = new THREE.Group();
    wheel.position.set(0, DH * 0.52, T / 2 + 0.30);
    const wr = bossR * 0.62;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(wr, 0.052, 6, 22), M2.brass);
    wheel.add(ring);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 4;
      vbox(wheel, wr * 2, 0.055, 0.055, M2.brass, 0, 0, 0, 0, 0, a);
    }
    vcyl(wheel, 0.10, 0.10, 0.16, 12, M2.brass, 0, 0, -0.04, Math.PI / 2, 0, 0);
    leaf.add(wheel);
    // BOLTWORK: six lugs around the rim. They stand PROUD of the leaf edge, so
    // when the door swings you see the bolts that were holding it — the single
    // detail that makes an open vault door read as unlocked rather than ajar.
    const lugs = [];
    for (let i = 0; i < 6; i++) {
      const t = (i / 5 - 0.5);
      const side = i % 2 ? 1 : -1;
      const lug = vcyl(leaf, 0.075, 0.075, 0.46, 10, M2.steelL,
        side * (DW / 2 - 0.03), DH * (0.22 + 0.28 * Math.abs(t) + (i > 2 ? 0.22 : 0)), 0,
        0, 0, Math.PI / 2);
      lugs.push(lug);
    }
    // the hinge column: three barrels stacked up the pivot edge
    for (let i = 0; i < 3; i++) {
      vcyl(pivot, 0.16, 0.16, 0.34, 12, M2.steelD, 0, DH * (0.16 + i * 0.34), 0);
    }
    vbox(pivot, 0.26, DH, 0.26, M2.steelD, 0, DH / 2, 0);
    // a recessed brass maker's plate down at handle height — the first draft
    // floated it above the wheel where it read as a stray yellow stripe.
    vbox(leaf, DW * 0.30, 0.11, 0.02, M2.steelD, 0, DH * 0.175, T / 2 + 0.005);
    vbox(leaf, DW * 0.26, 0.075, 0.03, M2.brass, 0, DH * 0.175, T / 2 + 0.02);
    v.leaf = leaf; v.wheel = wheel; v.doorMat = doorMat; v.lugs = lugs; v.pivot = pivot;
    return pivot;
  }

  /* THE ARCHITRAVE — the static steel surround the leaf shuts against. Drawn
     in the same world group as the pivot so the whole doorway is one object to
     show/hide, and it is what makes the opening read as engineered rather than
     as a hole somebody left in a wall. */
  function buildFrame(v, grp) {
    const M2 = vmats();
    const DW = v.dw, DH = v.dh;
    const f = new THREE.Group();
    // A MASSIVE DOOR NEEDS A MASSIVE JAMB. 0.22 m of steel read as a white
    // stick beside a 2.4 m leaf; the surround is now a 0.40 m stepped pier
    // either side, which is what actually carries a tonne of hinged steel and
    // what makes the doorway read as engineered rather than cut.
    // The bright reveal is a CHAMFER ON the pier, not a rail in front of it:
    // at z = 0.36 against a 0.58-deep pier it stood 0.17 m proud and the whole
    // surround photographed as scaffolding round the door.
    for (const s of [-1, 1]) {
      vbox(f, 0.40, DH + 0.42, 0.58, M2.steel, s * (DW / 2 + 0.20), (DH + 0.42) / 2, 0);
      vbox(f, 0.16, DH + 0.42, 0.16, M2.steelL, s * (DW / 2 + 0.20), (DH + 0.42) / 2, 0.26);
      vbox(f, 0.44, 0.10, 0.62, M2.steelD, s * (DW / 2 + 0.20), DH + 0.36, 0);   // pier cap
    }
    vbox(f, DW + 1.00, 0.34, 0.58, M2.steel, 0, DH + 0.25, 0);
    vbox(f, DW + 1.00, 0.14, 0.16, M2.steelL, 0, DH + 0.25, 0.26);
    vbox(f, DW + 1.00, 0.08, 0.58, M2.steelL, 0, 0.04, 0);          // sill plate
    grp.add(f);
    return f;
  }

  /* THE ROOM — partition + strongroom fit-out, drawn through the building's own
     b.lbox so it batches with the shell and gets real colliders, exactly the
     way city/casino.js dresses a gaming floor. Local coordinates; world is
     (b.ox + lx, ly, b.oz + lz). */
  function buildRoom(v, b, floorY) {
    const M2 = vmats();
    const hsh = function (i, salt) { return CBZ.hash01 ? CBZ.hash01(v.lot.cx + i * 0.31, v.lot.cz - i * 0.17, salt) : ((i * 0.137) % 1); };
    const nx = v.inx, nz = v.inz;              // unit INTO the room (away from the hall)
    const tx = -nz, tz = nx;                   // across the opening
    const WH = 3.0, WT2 = 0.30;                // partition height / thickness
    const half = v.rw / 2;
    const dw2 = v.dw / 2;
    // helper: local coords from (deep along +n from the partition plane, lateral)
    const P = function (deep, lat) {
      return { x: v.plx + nx * deep + tx * lat, z: v.plz + nz * deep + tz * lat };
    };
    const along = Math.abs(nx) > 0.5;          // partition spans Z when we face ±X
    const sizeAcross = function (across, thick) {
      return along ? { w: thick, d: across } : { w: across, d: thick };
    };
    // ---- THE PARTITION: two piers and a header, leaving ONE opening ---------
    const pier = half - dw2;
    if (pier > 0.25) {
      for (const s of [-1, 1]) {
        const p = P(0, s * (dw2 + pier / 2));
        const sz = sizeAcross(pier, WT2);
        b.lbox(p.x, floorY + WH / 2, p.z, sz.w, WH, sz.d, 0x4a5058, { solid: true, los: true });
      }
    }
    // the header over the doorway (so the opening is a hole, not a gap to the roof)
    if (WH - v.dh - 0.34 > 0.2) {
      const p = P(0, 0);
      const sz = sizeAcross(v.dw + 0.7, WT2);
      b.lbox(p.x, floorY + (v.dh + 0.34 + WH) / 2, p.z, sz.w, WH - v.dh - 0.34, sz.d, 0x4a5058, { solid: true, los: true });
    }
    // ---- THE SIDE WALLS: from the partition back to the building's own wall --
    for (const s of [-1, 1]) {
      const p = P(v.rd / 2, s * half);
      const sz = sizeAcross(WT2, v.rd);
      b.lbox(p.x, floorY + WH / 2, p.z, sz.w, WH, sz.d, 0x4a5058, { solid: true, los: true });
    }
    /* ---- FIT-OUT: shelving up the back and both flanks, loaded with bricks --
       A strongroom that is empty when you finally get the door off is a
       punchline, so the racks carry visible money BEFORE you touch anything —
       that is what makes the door worth blowing rather than a marker worth
       walking to.

       THE UPRIGHTS ARE THE DIFFERENCE BETWEEN A RACK AND FOUR FLOATING PLANKS.
       The first pass drew one post per side for the whole unit and the boards
       read as levitating; real shelving stands on a post at every bay end, so
       the posts are drawn per BAY and the boards land on them. */
    const SHELF_Y = [0.44, 1.06, 1.68, 2.30];
    const backD = v.rd - 0.55;
    const BAY = 1.15;                                 // one shelving bay
    let bricks = 0;
    const nBays = Math.max(2, Math.round((v.rw - 0.7) / BAY));
    // the back rack's posts, floor to top board
    for (let i = 0; i <= nBays; i++) {
      const lat = (i / nBays - 0.5) * (v.rw - 0.7);
      const up = P(backD, lat);
      const us = sizeAcross(0.075, 0.42);
      b.lbox(up.x, floorY + (SHELF_Y[SHELF_Y.length - 1] + 0.1) / 2, up.z, us.w, SHELF_Y[SHELF_Y.length - 1] + 0.1, us.d, 0x828c99, { cast: false });
    }
    // ...and the flank racks' posts
    for (const s of [-1, 1]) {
      const nF = Math.max(1, Math.round((v.rd - 1.2) / BAY));
      for (let i = 0; i <= nF; i++) {
        const dd = v.rd / 2 + 0.1 + (i / nF - 0.5) * (v.rd - 1.3);
        const up = P(dd, s * (half - 0.32));
        const us = sizeAcross(0.40, 0.075);
        b.lbox(up.x, floorY + (SHELF_Y[SHELF_Y.length - 1] + 0.1) / 2, up.z, us.w, SHELF_Y[SHELF_Y.length - 1] + 0.1, us.d, 0x828c99, { cast: false });
      }
    }
    for (let si = 0; si < SHELF_Y.length; si++) {
      const sy = SHELF_Y[si];
      if (sy > WH - 0.4) break;
      // the back run
      const bp = P(backD, 0);
      const bsz = sizeAcross(v.rw - 0.7, 0.44);
      b.lbox(bp.x, floorY + sy, bp.z, bsz.w, 0.045, bsz.d, 0x6d7681, { cast: false });
      // bricks are BUNDLES, so they are small and there are lots of them —
      // three across a bay reads as money, one big block reads as a crate.
      const per = Math.max(3, Math.min(14, Math.round((v.rw - 0.9) / 0.30)));
      for (let i = 0; i < per; i++) {
        if (hsh(si * 11 + i, "vshelf") < 0.16) continue;       // a gap here and there
        const lat = (i / Math.max(1, per - 1) - 0.5) * (v.rw - 1.0);
        const q = P(backD, lat);
        const qs = sizeAcross(0.22, 0.26);
        const stack = hsh(si * 31 + i, "vstack") < 0.42 ? 2 : 1;
        for (let k = 0; k < stack; k++) {
          b.lbox(q.x, floorY + sy + 0.075 + k * 0.13, q.z, qs.w, 0.12, qs.d, 0x5f9c52, { cast: false });
          b.lbox(q.x, floorY + sy + 0.075 + k * 0.13, q.z, qs.w * 0.26, 0.125, qs.d * 1.03, 0xd8d2c0, { cast: false });
          bricks++;
        }
      }
      // the flank runs
      for (const s of [-1, 1]) {
        const fp = P(v.rd / 2 + 0.1, s * (half - 0.32));
        const fsz = sizeAcross(0.40, v.rd - 1.3);
        b.lbox(fp.x, floorY + sy, fp.z, fsz.w, 0.045, fsz.d, 0x6d7681, { cast: false });
        const fper = Math.max(2, Math.min(9, Math.round((v.rd - 1.4) / 0.32)));
        for (let i = 0; i < fper; i++) {
          if (hsh(si * 23 + i * 3 + (s > 0 ? 1 : 0), "vflank") < 0.24) continue;
          const dd = v.rd / 2 + 0.1 + (i / Math.max(1, fper - 1) - 0.5) * (v.rd - 1.5);
          const q = P(dd, s * (half - 0.32));
          const qs = sizeAcross(0.26, 0.22);
          b.lbox(q.x, floorY + sy + 0.075, q.z, qs.w, 0.12, qs.d, 0x5f9c52, { cast: false });
          b.lbox(q.x, floorY + sy + 0.075, q.z, qs.w * 1.03, 0.125, qs.d * 0.26, 0xd8d2c0, { cast: false });
          bricks++;
        }
      }
    }
    v.bricks = bricks;
    // a caged trolley parked mid-floor (the thing the notes actually move on)
    const tp = P(v.rd * 0.45, (hsh(3, "vtroll") - 0.5) * Math.max(0, v.rw - 2.4));
    const ts = sizeAcross(0.86, 0.60);
    b.lbox(tp.x, floorY + 0.36, tp.z, ts.w, 0.06, ts.d, 0x6d7681, { cast: false });
    b.lbox(tp.x, floorY + 0.70, tp.z, ts.w * 0.9, 0.62, ts.d * 0.9, 0x5f9c52, { cast: false });
    // four castors under it — drawn in the WORLD axes the trolley's own top
    // was drawn in, so they cannot walk off it when the room faces ±X.
    for (let i = 0; i < 4; i++) {
      b.lbox(tp.x + (i % 2 ? 0.30 : -0.30), floorY + 0.18, tp.z + (i < 2 ? -0.20 : 0.20),
        0.06, 0.36, 0.06, 0x3c434d, { cast: false });
    }
    // the strip light: the reason the room is not a black hole when you open
    // it. A HOUSING and a tube, not one glowing slab — a bare emissive plank on
    // a ceiling reads as a hole in the roof.
    const lp = P(v.rd * 0.55, 0);
    const lw = Math.min(1.5, Math.max(0.7, v.rw - 1.4));
    const lh = sizeAcross(lw, 0.20);
    const lt2 = sizeAcross(lw - 0.14, 0.10);
    b.lbox(lp.x, floorY + WH - 0.09, lp.z, lh.w, 0.10, lh.d, 0x9aa3ae, { cast: false });
    b.lbox(lp.x, floorY + WH - 0.17, lp.z, lt2.w, 0.05, lt2.d, 0xdfe9ff, { emissive: 0xbcd0ff, ei: 0.95, cast: false });
    v.roomTag = P(v.rd * 0.5, 0);
  }

  /* CBZ.cityVaultRoom(lot, spec) — THE ONE CALL. city/bank.js's own pass uses
     it for every branch and for the reserve; city/casino.js uses it for the
     count room behind the cage. A third caller (a jeweller's back room, an
     evidence locker) costs a spec object and nothing else.
       spec: { tier, kind, till:{src,point}, name, lat, guard } */
  CBZ.cityVaultRoom = function (lot, spec) {
    if (CBZ.CONFIG.BANK_VAULT_V1 === false) return null;
    spec = spec || {};
    const b = lot && lot.building;
    if (!b || typeof b.lbox !== "function" || lot._vaultRoom) { if (b) VTALLY.refused++; return null; }
    const w = b.w, d = b.d, wt = b.wt != null ? b.wt : 0.3;
    const floorY = (b.floorTops && b.floorTops[0] != null) ? b.floorTops[0] : 0.14;
    const ox = b.ox != null ? b.ox : lot.cx, oz = b.oz != null ? b.oz : lot.cz;
    const door = b.door || { nx: 0, nz: 1 };
    // INTO the building from the street door, i.e. toward the back wall.
    const inx = -(door.nx || 0), inz = -(door.nz || (door.nx ? 0 : 1));
    const hx = w / 2 - wt, hz = d / 2 - wt;
    const hDeep = Math.abs(inx) * hx + Math.abs(inz) * hz;    // door wall → back wall
    const hTan = Math.abs(inx) * hz + Math.abs(inz) * hx;     // across
    // A ROOM YOU CAN STAND IN, OR NO ROOM AT ALL. A 2 m strongroom you clip
    // through is worse than the set dressing it replaces, so a building that
    // cannot hold one is REFUSED and counted (the audit's `refused`).
    const rd = Math.min(spec.tier === "reserve" ? 6.2 : 4.6, Math.max(2.9, hDeep * 0.55));
    const rw = Math.min(spec.tier === "reserve" ? 8.4 : 6.4, Math.max(3.4, hTan * 0.86));
    if (hDeep < rd + 2.6 || hTan < rw + 0.4) { VTALLY.refused++; return null; }
    const tier = spec.tier || "branch";
    const dw = Math.min(2.4, rw - 1.0), dh = tier === "reserve" ? 2.5 : 2.3;
    // the partition plane, in building-local coords: rd back from the far wall.
    // The lateral offset is CLAMPED to keep the whole room on the plate — a
    // caller asking for a corner it cannot have gets the nearest one it can,
    // never a strongroom hanging through the outside wall.
    const latRoom = Math.max(0, hTan - rw / 2 - 0.3);
    const lat = Math.max(-latRoom, Math.min(latRoom, spec.lat || 0));
    const tx = -inz, tz = inx;
    const plDeep = hDeep - rd;
    const v = {
      id: "vault:" + Math.round(lot.cx) + "," + Math.round(lot.cz),
      lot: lot, tier: tier, kind: spec.kind || "bank",
      name: spec.name || (b.name || "the vault"),
      inx: inx, inz: inz, rw: rw, rd: rd, dw: dw, dh: dh, lat: lat,
      plx: inx * plDeep + tx * lat, plz: inz * plDeep + tz * lat,
      till: spec.till || { src: lot, point: "vault" },
      hp0: VHP[tier] || VHP.branch, hp: VHP[tier] || VHP.branch,
      open: false, swing: 0, opening: 0, breached: false, bagsOut: false,
      bags: [], y: floorY, glow: 0,
    };
    v.x = ox + v.plx; v.z = oz + v.plz;
    // the strongroom's own centre, for spawning bags and aiming a camera
    v.rx = ox + v.plx + inx * (rd * 0.55);
    v.rz = oz + v.plz + inz * (rd * 0.55);

    // room shell + fit-out, clamped to the building's inner faces by the same
    // planner every interior program runs through.
    try {
      if (CBZ.interiorBounded) CBZ.interiorBounded(b, function () { buildRoom(v, b, floorY); return 1; }, "bank-vault");
      else buildRoom(v, b, floorY);
    } catch (e) { /* a half-drawn strongroom still has a door */ }

    // ---- the doorway: pivot + architrave, in world space so the leaf swings --
    const grp = new THREE.Group();
    grp.position.set(v.x, floorY, v.z);
    // local +Z must point OUT of the vault (back toward the hall) = -inward
    grp.rotation.y = Math.atan2(-inx, -inz);
    // the hash picks which edge hangs, so a city has left- and right-hung
    // vaults instead of one repeated prop.
    const hingeLeft = (CBZ.hash01 ? CBZ.hash01(lot.cx, lot.cz, "vhinge") : 0.5) < 0.5;
    v.hingeSign = hingeLeft ? 1 : -1;
    const pivot = buildDoor(v);
    pivot.position.set(-v.hingeSign * dw / 2, 0, 0.02);
    grp.add(pivot);
    buildFrame(v, grp);
    const root = (CBZ.city && CBZ.city.arena && CBZ.city.arena.root) || CBZ.scene;
    if (root) root.add(grp);
    v.group = grp;
    if (CBZ.interiorTrackFixture) { try { CBZ.interiorTrackFixture("bank-vault", b, grp); } catch (e) {} }

    // THE COLLIDER IS WHAT "SHUT" MEANS. Removing it is the whole mechanical
    // difference between a locked vault and an open one — no flag anywhere else
    // has to be told.
    v.col = { minX: v.x - Math.abs(tx) * dw / 2 - Math.abs(inx) * 0.3,
              maxX: v.x + Math.abs(tx) * dw / 2 + Math.abs(inx) * 0.3,
              minZ: v.z - Math.abs(tz) * dw / 2 - Math.abs(inz) * 0.3,
              maxZ: v.z + Math.abs(tz) * dw / 2 + Math.abs(inz) * 0.3,
              y0: floorY, y1: floorY + dh };
    if (CBZ.colliders) CBZ.colliders.push(v.col);

    lot._vaultRoom = v;
    VAULTS.push(v);
    VTALLY.built++;
    return v;
  };

  // ---- WHO IS IN THE ROOM WITH YOU -------------------------------------------
  // "Only NPCs or physical bombs can open them." This is the NPC half: a member
  // of this bank's own staff, within reach of the door, with their hands up.
  // It reuses peds.js's EXISTING gunpoint/surrender grammar wholesale — there is
  // no vault-specific duress state, and shaking somebody down at a vault is the
  // same act as shaking them down on the street.
  function insiderAt(v) {
    const list = CBZ.cityPeds;
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || p.dead || p.isPlayer || p.controlled || !p.pos) continue;
      if (!(p._vaultStaff === v.id || p._venueStaff === "bank" || p._venueStaff === "casino")) continue;
      if (!(p.surrender || p.gunpoint || p.poseHandsUp || (p.surrenderT || 0) > 0)) continue;
      const dx = p.pos.x - v.x, dz = p.pos.z - v.z;
      if (dx * dx + dz * dz > 9 * 9) continue;
      if (Math.abs((p.pos.y || 0) - v.y) > 2.6) continue;
      return p;
    }
    return null;
  }

  /* THE LOCK — ONE adoption of city/loyalty.js's CBZ.cityLock, and the first
     consumer its `vault` grant has ever had. `have` is this door's own key
     test (a bank officer under duress) and always wins, exactly as that
     function's contract states; route 4 is the apex rung — at that point in
     the game the manager opens the door because of who you are.
     `wasOpen: false` is deliberate and is the documented trap: this door was
     never open before this wave, so flipping LOYALTY_LOCKS off must leave it
     SHUT (and therefore still bomb-able), not hand out the reserve. */
  function vaultLock(v) {
    const dur = insiderAt(v);
    if (CBZ.cityLock) {
      const L = CBZ.cityLock({ id: v.id, label: v.tier === "reserve" ? "The cash centre" : "The vault",
                               verb: "vault", have: !!dur, wasOpen: false });
      L.insider = dur;
      return L;
    }
    return { open: !!dur, line: dur ? "" : "The vault is locked.", route: dur ? "key" : null, insider: dur };
  }

  // WHAT IS IN THERE right now, straight off the ONE ledger — never a number
  // typed here.
  function vaultHolds(v) {
    const TL = CBZ.cityTill;
    if (!TL || !TL.holds || !v.till || !v.till.src) return { amount: 0, of: 0 };
    try { return TL.holds(v.till.src, { point: v.till.point || "vault" }); }
    catch (e) { return { amount: 0, of: 0 }; }
  }

  /* THE MOMENT THE DOOR COMES OFF. Every consequence in here is a call to a
     system that already exists — the alarm, the panic field, the crime report,
     the building's own occupancy alarm — because a vault breach is not a new
     kind of event, it is the loudest instance of one the game already models. */
  function vaultBreach(v, how, by) {
    if (!v || v.open) return false;
    v.open = true; v.opening = 1; v.breached = (how !== "insider");
    v.hp = 0;
    VTALLY.breached++;
    if (how === "insider") VTALLY.insider++; else VTALLY.blasted++;
    // the leaf is free — drop the collider on the very frame it starts to move,
    // so the swing can never trap the player inside its own arc.
    if (v.col && CBZ.colliders) {
      const i = CBZ.colliders.indexOf(v.col);
      if (i >= 0) CBZ.colliders.splice(i, 1);
      if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
    }
    // THE MONEY LEAVES THE LEDGER AND LANDS ON THE FLOOR. take() is the ONE
    // transfer; cashBags.payout() is the ONE physicalisation. This file mints
    // nothing and pays the player nothing.
    const TL = CBZ.cityTill;
    let moved = 0;
    if (TL && TL.take && v.till && v.till.src) {
      try { moved = TL.take(v.till.src, { point: v.till.point || "vault", by: "player", rob: true }).taken || 0; }
      catch (e) { moved = 0; }
    }
    if (moved > 0 && CBZ.cashBags && CBZ.cashBags.payout) {
      const r = CBZ.cashBags.payout(v.rx, v.y, v.rz, moved, {
        src: v.id, srcName: v.name, spread: Math.min(1.9, v.rw * 0.28),
        cap: v.tier === "reserve" ? 18 : 10,
        flash: v.kind === "casino" ? 0xc9a227 : 0x5b8bff,
      });
      v.bags = r.bags; v.bagsOut = true;
      VTALLY.bags += r.bags.length; VTALLY.bagged += moved;
      big((v.tier === "reserve" ? "THE CASH CENTRE IS OPEN" : "VAULT OPEN") +
          " — " + fmt$(moved) + " in bags. Carry it out.");
    } else if (moved > 0) {
      if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(moved);
      big("VAULT OPEN — " + fmt$(moved) + ".");
    } else {
      big("VAULT OPEN — and it's empty. Somebody got here first.");
      note("They banked it. Come back when the branch has taken money in again.", 3);
    }
    // CONSEQUENCE. A blown vault door is the loudest thing that happens in a
    // bank; an insider-opened one is quieter but still a robbery in progress.
    const loud = how !== "insider";
    if (CBZ.cityAlarm && CBZ.city) CBZ.cityAlarm(v.x, v.z, loud ? 55 : 30, loud ? 2.2 : 1.3, CBZ.city.playerActor);
    if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(v.x, v.z, loud ? 1.8 : 1.0);
    if (CBZ.cityPanic && CBZ.city) CBZ.cityPanic(v.x, v.z, loud ? 2.2 : 1.2, CBZ.city.playerActor);
    if (CBZ.cityCrime) {
      try { CBZ.cityCrime(loud ? 260 : 180, { instant: true, x: v.x, z: v.z, type: "armed-robbery" }); } catch (e) {}
    }
    if (CBZ.cityForceStars) { try { CBZ.cityForceStars(v.tier === "reserve" ? 4 : 3); } catch (e) {} }
    if (CBZ.cityOccupyAlarm && v.lot && v.lot._occupancy) { try { CBZ.cityOccupyAlarm(v.lot, by || CBZ.player, 0); } catch (e) {} }
    if (CBZ.sfx) CBZ.sfx(loud ? "explosion" : "coin");
    if (CBZ.shake) CBZ.shake(loud ? 0.55 : 0.15);
    if (CBZ.cityHudDirty) CBZ.cityHudDirty();
    return true;
  }

  // BLAST COUPLING — city/armored.js's crackTruck pattern, applied to steel
  // that does not drive. Bullets never arrive here; only cityExplosion does.
  function vaultBlast(v, dmg, byPlayer) {
    if (!v || v.open) return;
    v.hp -= dmg;
    v.glow = Math.max(v.glow, Math.min(1, 1 - v.hp / v.hp0));
    if (v.hp <= 0) { vaultBreach(v, "blast", byPlayer ? CBZ.player : null); return; }
    if (byPlayer) {
      const pct = Math.max(0, Math.round(v.hp / v.hp0 * 100));
      note("The door held (" + pct + "%). It needs more than that.", 1.8);
    }
    if (CBZ.cityCrime) { try { CBZ.cityCrime(120, { x: v.x, z: v.z, type: "bombing" }); } catch (e) {} }
  }

  function installVaultBlastWrap() {
    const orig = CBZ.cityExplosion;
    if (typeof orig !== "function" || orig._vaultWrapped) return;
    const wrapped = function (x, z, opts) {
      const r = orig.apply(this, arguments);
      try {
        const damages = !opts || !opts.noDamage;
        if (damages && VAULTS.length && g.mode === "city") {
          const power = (opts && opts.power) || 1;
          const arm = VBLAST_RANGE * Math.max(1, power * 0.85);
          for (let i = 0; i < VAULTS.length; i++) {
            const v = VAULTS[i];
            if (v.open) continue;
            const dx = v.x - x, dz = v.z - z, dd = Math.hypot(dx, dz);
            if (dd > arm) continue;
            const falloff = 1 - dd / (arm + 0.01);
            vaultBlast(v, VBLAST_TO_DOOR * power * Math.max(0.25, falloff), !!(opts && opts.byPlayer));
          }
        }
      } catch (e) { /* a coupling failure must never break the shared blast chain */ }
      return r;
    };
    // THE EXPLOSION-WRAPPER LAW (CLAUDE.md): copy EVERY *Wrapped marker
    // forward, or the next sibling's idempotence guard fails and it re-wraps an
    // already-wrapped chain.
    for (const k in orig) if (/Wrapped$/.test(k)) wrapped[k] = orig[k];
    wrapped._vaultWrapped = true;
    wrapped._origVault = orig;
    CBZ.cityExplosion = wrapped;
  }

  // ---- the public verbs (city/interact.js registers the card) -----------------
  CBZ.cityVaultAt = function (px, pz, reach, py) {
    if (!VAULTS.length) return null;
    const r = reach || 3.4, r2 = r * r;
    let best = null, bd = r2;
    for (let i = 0; i < VAULTS.length; i++) {
      const v = VAULTS[i];
      if (v.open) continue;
      if (py != null && Math.abs(v.y - py) > 2.6) continue;
      const dx = v.x - px, dz = v.z - pz, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = v; }
    }
    return best;
  };
  CBZ.cityVaultLabel = function (v) {
    if (!v) return "";
    const L = vaultLock(v);
    if (L.open) return L.insider ? "Make them open the vault" : "Open the vault";
    return L.line || "The vault is locked";
  };
  CBZ.cityVaultCanOpen = function (v) { return !!(v && !v.open && vaultLock(v).open); };
  CBZ.cityVaultTry = function (v) {
    if (!v || v.open) return false;
    const L = vaultLock(v);
    if (!L.open) { note(L.line || "The vault is locked. Blow it, or find somebody who can open it.", 2.6); return false; }
    if (L.insider) {
      note("He works the timelock. It swings.", 2.0);
      // the man who opened it under a gun is a witness, and the room knows.
      if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(v.x, v.z, 0.9);
    }
    return vaultBreach(v, "insider", CBZ.player);
  };
  CBZ.cityVaultState = function (lot) {
    const v = lot && lot._vaultRoom;
    if (!v) return null;
    const h = vaultHolds(v);
    return { id: v.id, tier: v.tier, open: !!v.open, breached: !!v.breached,
             hp: Math.max(0, Math.round(v.hp)), hp0: v.hp0,
             holds: h.amount || 0, x: v.x, z: v.z, rx: v.rx, rz: v.rz,
             bags: v.bags.length, bagged: CBZ.cashBags ? CBZ.cashBags.heldFrom(v.id) : 0 };
  };
  CBZ.cityVaults = function () { return VAULTS.slice(); };

  /* ---- THE DRESS PASS --------------------------------------------------------
     Order 90, the same landmass slot city/casino.js dresses its floors in, so
     it sees every bank the mainland grid, the towns and the settlements built —
     not just the one branch this file's lobby machinery attaches to. It also
     runs BEFORE core/batch.js merges, which is the only reason the strongroom's
     shelving costs no draw calls. */
  function primaryBankLot(A) {
    if (!A) return null;
    let lot = A.bankLot || null;
    if (lot && lot.building && lot.building.shop && lot.building.shop.kind === "bank") return lot;
    const lots = A.lots || [];
    for (let i = 0; i < lots.length; i++) {
      const L = lots[i];
      if (L && L.building && L.building.shop && L.building.shop.kind === "bank") return L;
    }
    return null;
  }
  // WHAT A TELLER'S DRAWER HOLDS. Derived, never typed: a teller works one
  // hour of this branch's own share of the district's cash intake, floored at a
  // real opening float and capped where a real drawer is emptied into the safe.
  // The ATM cassette above is the same derivation over a day; this is over an
  // hour, which is exactly the difference between a machine and a person.
  function tellerFloat(lot) {
    const TL = CBZ.cityTill;
    if (!TL || !TL.districtCash || !TL.districtOf) return 2400;
    try {
      const dc = TL.districtCash(TL.districtOf(lot));
      const share = dc.cash / Math.max(1, dc.branches);
      return Math.max(1200, Math.min(25000, Math.round(share)));
    } catch (e) { return 2400; }
  }
  // one declared cash point per teller window, so "some amount in the drawer"
  // is a real balance on the ONE ledger and not a per-teller constant.
  function declareDrawer(lot, i, x, z) {
    const TL = CBZ.cityTill;
    if (!TL || !TL.declare) return null;
    const box2 = { _drawX: x, _drawZ: z };
    const of = tellerFloat(lot);
    box2._drawOf = of; box2._drawBal = of; box2._drawDay = -1;
    TL.declare(box2, {
      name: "teller drawer", kind: "bank", point: "register",
      amount: function () {
        // a drawer is counted out fresh each trading day — it reads the same
        // clock the rest of the ledger banks on, never a timer of its own.
        const day = (CBZ.dayCount ? CBZ.dayCount() : 0) | 0;
        if (box2._drawDay !== day) { box2._drawDay = day; box2._drawBal = box2._drawOf; }
        return box2._drawBal;
      },
      drain: function (n) { box2._drawBal = Math.max(0, box2._drawBal - n); },
    });
    return box2;
  }

  const DRAWERS = [];
  CBZ.cityBankDrawers = function () { return DRAWERS.slice(); };
  // THE DRAWER IS A REAL BALANCE OR IT IS A STAT FICTION. "Real tellers with
  // some amount" only means anything if the amount can leave, so this is the
  // verb (city/interact.js registers the card). It runs the SAME consequence
  // grammar interior_programs.js's loot and shops.js's stick-up already run —
  // cityScare on the person behind the glass, the contagious panic field, and
  // a crime through cityCrime. Nothing new is invented for a bank.
  CBZ.cityBankDrawerLabel = function (dr) {
    const TL = CBZ.cityTill;
    const h = (TL && dr) ? TL.holds(dr, {}) : null;
    return (h && h.amount > 0) ? ("Clear the drawer ($" + Math.round(h.amount).toLocaleString() + ")")
                               : "The drawer's been counted out";
  };
  CBZ.cityBankDrawerTake = function (dr) {
    const TL = CBZ.cityTill;
    if (!dr || !TL || !TL.take) return false;
    const r = TL.take(dr, { by: "player", rob: true });
    if (!(r.taken > 0)) { note("Empty. They already counted it out.", 1.7); return false; }
    // notes in your hand, through the ONE physicalisation call: a drawer is
    // always under the bag threshold, so this is wallet cash and the rule that
    // decides that lives in exactly one place.
    if (CBZ.cashBags && CBZ.cashBags.payout) CBZ.cashBags.payout(dr._drawX, 0, dr._drawZ, r.taken, { onFloor: false });
    else if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(r.taken);
    // the person whose window it is makes the decision every clerk in this game
    // already makes: freeze or bolt.
    const list = CBZ.cityPeds;
    if (list) for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || p.dead || p.isPlayer || !p.pos || p._venueStaff !== "bank") continue;
      const dx = p.pos.x - dr._drawX, dz = p.pos.z - dr._drawZ;
      if (dx * dx + dz * dz > 12 * 12) continue;
      if (p.job === "vault guard") { p.mem = CBZ.player; p.rage = CBZ.player; p.state = "fight"; p.alarmed = Math.max(p.alarmed || 0, 4); }
      else if (CBZ.cityScare) { try { CBZ.cityScare(p, CBZ.player, { bias: 0.3 }); } catch (e) {} }
    }
    if (CBZ.cityPanicRaise) CBZ.cityPanicRaise(dr._drawX, dr._drawZ, 1.1);
    if (CBZ.cityAlarm && CBZ.city) CBZ.cityAlarm(dr._drawX, dr._drawZ, 34, 1.5, CBZ.city.playerActor);
    if (CBZ.cityCrime) { try { CBZ.cityCrime(190, { instant: true, x: dr._drawX, z: dr._drawZ, type: "armed-robbery" }); } catch (e) {} }
    note("Took " + fmt$(r.taken) + " out of the window. The vault's where the money is.", 2.4);
    return true;
  };
  CBZ.cityBankDrawerAt = function (px, pz, reach, py) {
    const r = reach || 3.0, r2 = r * r;
    let best = null, bd = r2;
    for (let i = 0; i < DRAWERS.length; i++) {
      const dr = DRAWERS[i];
      if (py != null && Math.abs((dr.y || 0) - py) > 2.4) continue;
      const dx = dr._drawX - px, dz = dr._drawZ - pz, dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = dr; }
    }
    return best;
  };

  if (CBZ.addLandmass) CBZ.addLandmass(function (city) {
    if (CBZ.CONFIG.BANK_VAULT_V1 === false) return;
    const A = city || CBZ._settlementArena || (CBZ.city && CBZ.city.arena) || null;
    if (!A) return;
    VAULTS.length = 0; DRAWERS.length = 0;
    VTALLY.built = VTALLY.breached = VTALLY.blasted = VTALLY.insider = 0;
    VTALLY.bags = VTALLY.bagged = VTALLY.refused = 0;
    if (CBZ.cityStaffVenue) CBZ.cityStaffVenue("bank", { stations: 0, note: "a teller per window, a manager, a vault guard" });
    const TL = CBZ.cityTill;
    const primary = primaryBankLot(A);
    const seen = new Set();
    let stations = 0;
    const scan = function (arr) {
      if (!arr) return;
      for (const lot of arr) {
        if (!lot || lot.kind !== "bank" || !lot.building || lot.demolished) continue;
        const key = Math.round(lot.cx) + "," + Math.round(lot.cz);
        if (seen.has(key)) continue; seen.add(key);
        const tier = (TL && TL.vaultTier) ? (TL.vaultTier(lot) || "branch") : "branch";
        let v = null;
        try {
          // PUSH THE DOOR OFF THE CENTRELINE. The teller line runs across the
          // middle of a banking hall, and a vault door directly behind the
          // middle of it is a door you cannot walk to (the counter is a solid
          // collider). Offsetting the strongroom and cutting a staff gap in the
          // counter at the same lateral — see buildDisplays — is how a real
          // bank is laid out and is what makes the door REACHABLE at all.
          const side = (CBZ.hash01 ? CBZ.hash01(lot.cx, lot.cz, "vside") : 0.5) < 0.5 ? -1 : 1;
          v = CBZ.cityVaultRoom(lot, { tier: tier, kind: "bank",
                                       name: lot.building.name || "Meridian Trust",
                                       lat: side * 2.2,
                                       till: { src: lot, point: "vault" } });
        } catch (e) { v = null; }
        if (!v) continue;
        // ---- THE PEOPLE. A hall with a counter, a vault and nobody in it is
        // the "stage set" citystaff.js was written to end. These are POSTS —
        // pure data until you are 170 m away — which is the only reason a real
        // rig per teller window is affordable across every bank in the world.
        if (CBZ.CONFIG.BANK_TELLERS_V1 !== false && CBZ.cityStaffPost) {
          const b = lot.building;
          const ox = b.ox != null ? b.ox : lot.cx, oz = b.oz != null ? b.oz : lot.cz;
          const tx = -v.inz, tz = v.inx;
          // the teller line stands one metre in FRONT of the partition, facing
          // the way the public comes in — which is where the counter already is.
          const nT = Math.max(2, Math.min(3, Math.round(v.rw / 2.6)));
          for (let i = 0; i < nT; i++) {
            const latT = (nT > 1 ? (i / (nT - 1) - 0.5) : 0) * Math.min(4.2, v.rw - 1.2);
            const px = ox + v.plx - v.inx * 1.15 + tx * latT;
            const pz = oz + v.plz - v.inz * 1.15 + tz * latT;
            CBZ.cityStaffPost({
              venue: "bank", id: v.id + ":teller" + i, job: "bank teller",
              archetype: "merchant", x: px, z: pz,
              face: Math.atan2(-v.inx, -v.inz), pose: "table",
              opts: { wealth: 0.46, outfit: 0x2b3140, aggr: 0.08 },
              after: function (ped) { ped._vaultStaff = v.id; },
            });
            const dr = declareDrawer(lot, i, px, pz);
            if (dr) { dr.y = v.y; DRAWERS.push(dr); }
            stations++;
          }
          // the officer who can legally open the door, at the desk beside it
          const mx = ox + v.plx - v.inx * 2.6 + tx * (v.rw * 0.5 + 1.1);
          const mz = oz + v.plz - v.inz * 2.6 + tz * (v.rw * 0.5 + 1.1);
          CBZ.cityStaffPost({
            venue: "bank", id: v.id + ":manager", job: "bank manager",
            archetype: "professional", x: mx, z: mz,
            face: Math.atan2(-v.inx, -v.inz), pose: "table",
            opts: { wealth: 0.72, outfit: 0x1c2028, aggr: 0.14 },
            after: function (ped) { ped._vaultStaff = v.id; },
          });
          stations++;
          // and the man standing at the door itself. The reserve gets two.
          const nG = tier === "reserve" ? 2 : 1;
          for (let q = 0; q < nG; q++) {
            const gx = ox + v.plx - v.inx * 1.9 + tx * (q ? -1 : 1) * (v.dw / 2 + 0.9);
            const gz = oz + v.plz - v.inz * 1.9 + tz * (q ? -1 : 1) * (v.dw / 2 + 0.9);
            CBZ.cityStaffPost({
              venue: "bank", id: v.id + ":guard" + q, job: "vault guard",
              archetype: "security", x: gx, z: gz,
              face: Math.atan2(v.inx, v.inz), pose: "foldarms",
              opts: { wealth: 0.4, outfit: 0x23262c, aggr: 0.55, armed: true, weapon: "Pistol", hp: 150 },
              after: function (ped) { ped._vaultStaff = v.id; },
            });
            stations++;
          }
        }
      }
    };
    scan(A.shopLots); scan(A.lots);
    if (CBZ.cityStaffStations) CBZ.cityStaffStations("bank", stations);
    if (CBZ.markCollidersDirty) CBZ.markCollidersDirty();
  }, 90);

  /* ---- the vault tick: the swing, the heat glow, and nothing else ------------
     It early-outs on an empty registry, and the visibility gate keeps a city's
     worth of doorways off the draw list until you are near one. */
  CBZ.onUpdate(38.45, function (dt) {
    installVaultBlastWrap();       // cheap idempotent re-check (load order + hot reload)
    if (!VAULTS.length) return;
    if (!g || g.mode !== "city") return;
    const P = CBZ.player;
    const px = P ? P.pos.x : 0, pz = P ? P.pos.z : 0;
    for (let i = 0; i < VAULTS.length; i++) {
      const v = VAULTS[i];
      const near = Math.abs(v.x - px) < 70 && Math.abs(v.z - pz) < 70;
      if (v.group && v.group.visible !== near) v.group.visible = near;
      if (!near) continue;
      // THE ARC: a real vault door is slow and it is heavy. Ease out over ~2.6 s
      // (the elevators.js grammar — phased, never a visibility flip), and spin
      // the handwheel as the boltwork withdraws so the mechanism reads.
      if (v.opening > 0 && v.swing < VSWING) {
        v.swing = Math.min(VSWING, v.swing + dt * (0.55 + v.swing * 0.55));
        if (v.pivot) v.pivot.rotation.y = -v.hingeSign * v.swing;
        if (v.wheel) v.wheel.rotation.z -= dt * 5.2;
        if (v.lugs && v.swing > 0.12) {
          const back = Math.min(1, v.swing / 0.6);
          for (let q = 0; q < v.lugs.length; q++) v.lugs[q].scale.x = 1 - 0.7 * back;
        }
        if (v.swing >= VSWING) v.opening = 0;
      }
      // the door heats where the charges went off — the same read the old
      // drill glow gave, now driven by real damage instead of a timer.
      if (v.glow > 0 && v.doorMat && v.doorMat.emissive) {
        if (v.open) v.glow = Math.max(0, v.glow - dt * 0.35);
        const a = v.glow;
        try { v.doorMat.emissive.setRGB(0.42 * a, 0.13 * a, 0); } catch (e) {}
      }
    }
  });

  /* THE RATCHET (CLAUDE.md BLOCK LAW #5). `refused` is the honest failure of a
     room-in-a-building system — a bank whose floorplate cannot hold a
     strongroom you can stand in — and it may only ever go DOWN. `rooms` and
     `bagged` print beside it so a "fix" that simply stops building vaults
     cannot pass, and `holds`/`reserveHolds` are what make the owner's
     "10s or 100s of millions" a measurement rather than a claim. */
  CBZ.vaultAudit = function () {
    let open = 0, shut = 0, holds = 0, bricks = 0, reserveHolds = 0, hi = 0;
    const byTier = {};
    for (let i = 0; i < VAULTS.length; i++) {
      const v = VAULTS[i];
      byTier[v.tier] = (byTier[v.tier] | 0) + 1;
      bricks += v.bricks || 0;
      if (v.open) open++; else shut++;
      const h = vaultHolds(v).amount || 0;
      holds += h;
      if (h > hi) hi = h;
      if (v.tier === "reserve") reserveHolds = h;
    }
    const CB = CBZ.cashBags;
    return {
      rooms: VAULTS.length, byTier: byTier, open: open, shut: shut,
      refused: VTALLY.refused, built: VTALLY.built,
      breached: VTALLY.breached, blasted: VTALLY.blasted, insider: VTALLY.insider,
      bagsSpawned: VTALLY.bags, valueBagged: VTALLY.bagged,
      bagsLive: CB ? CB.count() : 0,
      holds: Math.round(holds), biggest: Math.round(hi), reserveHolds: Math.round(reserveHolds),
      shelfBricks: bricks, drawers: DRAWERS.length,
      hpBranch: VHP.branch, hpReserve: VHP.reserve,
    };
  };

  // ---- public storefront hook (contract [F]) + harness handles ----------------
  // is the bank live for this lot? interact.js feature-detects this to suppress
  // the dumb generic "Shop here" vendor verb when the branch self-prompts.
  CBZ.cityBankLive = function (lot) { return !!(S.built && S.lot && (!lot || lot === S.lot)); };
  CBZ.cityBankLot = function () { return (S.built && S.lot) || null; };
  // THE VAULT (contract for heists.js): where is the real steel vault, what is
  // IN it, and how to light it up mid-crack. heists.js drills THIS spot for
  // the BANK score so the grab happens at the actual vault, not just "the lot
  // centre".
  //
  // This used to end "the branch's own cash pool is untouched; the heist mints
  // its own bag" — an honest confession that the score came from nowhere and
  // that a branch could be drilled every night forever. A TAKE IS A TRANSFER
  // now: `holds` is the branch's real vault balance out of city/shops.js's
  // CBZ.cityTill (derived from what the businesses in this district actually
  // bank — which is why it lands inside the researched $120k-$250k band that
  // heists.js used to type by hand), and drilling it MOVES that balance. A
  // branch you emptied on Monday is a thin score on Tuesday.
  //
  // BANK_VAULT_V1 UPDATE: the branch no longer has to be BUILT (its lobby is
  // lazy and only ever attaches to one lot) for this to answer — the vault
  // rooms are dressed at world build for EVERY bank, so a heist cased at any
  // branch in the world gets the real steel. `open`/`hp` are published so
  // heists.js can watch the physical door instead of running a drill meter.
  CBZ.cityBankVault = function (lot) {
    const target = lot || (S.built && S.lot) || null;
    const v = (target && target._vaultRoom) || (VAULTS.length ? VAULTS[0] : null);
    if (v) {
      const h = vaultHolds(v);
      return { x: v.x, z: v.z, rx: v.rx, rz: v.rz, lot: v.lot, tier: v.tier,
               holds: h.amount || 0, of: h.of || 0, open: !!v.open, hp: Math.max(0, Math.round(v.hp)),
               hp0: v.hp0, bags: v.bags.length, id: v.id };
    }
    if (!(S.built && S.vault)) return null;
    const TL = CBZ.cityTill;
    const h = (TL && S.lot) ? TL.holds(S.lot, { point: "vault" }) : null;
    return { x: S.vault.x, z: S.vault.z, lot: S.lot || null, holds: h ? h.amount : 0, of: h ? h.of : 0, open: false };
  };
  // what is in the lobby machine right now (and what it holds when full) —
  // one read for a UI, a marker, or anybody who wants to crack it open.
  CBZ.cityBankATM = function () {
    const box = (S.built && S.lot) ? atmCassette() : null;
    if (!box) return null;
    atmService(box);
    const h = CBZ.cityTill.holds(box, {});
    return { holds: h.amount, of: box._atmOf, name: h.name };
  };
  // glow the vault door (0..1) while it's being drilled; 0 clears it. Safe no-op
  // if the branch isn't built (headless / not near a bank).
  CBZ.cityBankVaultGlow = function (amt, lot) {
    amt = Math.max(0, Math.min(1, +amt || 0));
    const v = (lot && lot._vaultRoom) || (S.lot && S.lot._vaultRoom) || (VAULTS.length ? VAULTS[0] : null);
    // the real door owns its own heat now (vaultBlast writes `glow` off actual
    // damage) — a caller can still force it, e.g. a scripted set piece.
    if (v) { v.glow = amt; return; }
    if (!(S.built && S.vault && S.vault.doorMat && S.vault.doorMat.emissive)) return;
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
