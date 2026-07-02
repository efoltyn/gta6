/* ============================================================
   sim/currency.js — Stage M, step M1: THE MULTI-CURRENCY WALLET.

   MASTER-PLAN VI.8 (verbatim): "every money-bearing record (player, NPC
   ledger wallets, cohorts, gang treasuries, company financials, jurisdiction
   treasuries, EconState prices, casino chips) carries a `currency` field
   defaulting to its owning jurisdiction's; the player gets a multi-currency
   wallet map, with g.cash/g.cityBank becoming compatibility getters over
   wallet.LBD so the 1000+ existing call sites need zero edits and day one is
   observably unchanged."

   BUILD-PLAN M1 (verbatim): "sim/currency.js (new): multi-currency wallet
   map; g.cash/g.cityBank become LBD compatibility accessors — day one
   unchanged."

   THIS WAVE ships ONLY the wallet + the currency registry + the compat
   accessors. NO forex (M2), NO central banks (M3), NO inflation (M4) — every
   number below is a flat identity conversion (1 LBD = 1 LBD), so nothing
   observable changes for a player who never touches a foreign currency.

   ============================================================
   THE 5 CURRENCIES — one per country in CBZ.COUNTRIES + the republic
   (city/countries.js's X3 header: "5+ countries... currencyId placeholder").
   MASTER-PLAN VI.8 already names the republic's (Liberty Dollar / LBD) and
   two states-not-yet-countries (Costa Real / CRE, Westmark Krone / WMK) —
   those two are NOT registered here: city/polity.js's buildRecords() today
   files Costa del Este and Westmark as STATES of "republic" (see that file's
   header, "Costa del Este (Goldspire, Cape Harbor...)" under the republic
   country), not top-level CBZ.polity countries. BUILD-PLAN M2 ("Countries
   CRE/WMK registered") is the milestone that promotes them and registers
   those two currencies — doing it here early would mint a currency for a
   country that doesn't exist yet in the polity tree. The 5 REAL top-level
   countries this wave are exactly republic + veridia/kesh/solara/mbeya (the
   X3 registry, city/countries.js's CBZ.COUNTRIES + polity.js's hardcoded
   "republic"), so that's what gets 5 currencies:
     republic (Republic of Liberty)  -> LBD  "Liberty Dollar"   $   (the
       player's home currency and default wallet denomination — unchanged
       from today's plain "$"; MASTER-PLAN VI.8 names this one verbatim)
     veridia  (Republic of Veridia)  -> VDM  "Veridian Mark"    V$  (rich
       harbor-finance capital, goldspire-tier skyline — a hard-currency
       "mark" reads as the stable rich-neighbor note M6's dollarization
       endings will want)
     kesh     (Kingdom of Kesh)      -> KSD  "Kesh Dinar"       KD  (a
       monarchy — "dinar" is the classic royal/desert-treasury coinage name)
     solara   (Solara)               -> SOL  "Solara Sol"      S$  (a sunny
       island city-state; "Sol" doubles as sun/currency, plays with SOLara)
     mbeya    (Mbeya Federation)     -> MBS  "Mbeya Shilling"   MSh (poorest,
       savanna federation — "shilling" is the real-world East-African-
       federation coinage this culture reads as)
   Deterministic hand-authored data (task's own instruction: "no LCG
   needed") — no seeded RNG anywhere in this file.

   ============================================================
   THE WALLET — g.cityWallet = { [currencyId]: amount, ... }, sparse (a
   currency the player has never touched simply has no key — reads as 0
   via CBZ.currency.get(), exactly like a never-assigned plain number field
   read as undefined/0 everywhere in the old call sites). g.cityBankWallet is
   the parallel map backing g.cityBank (city/bank.js's "safe on death" pool)
   — same shape, same REPUBLIC-only semantics this wave (M1 does not give
   the bank foreign-currency accounts; that's forex-desk-adjacent M2+ work).

   COMPAT ACCESSORS (the heart of this step): g.cash and g.cityBank become
   Object.defineProperty accessors over wallet[REPUBLIC]/bankWallet[REPUBLIC]
   — a plain get/set passthrough, NOT the clamped CBZ.currency.add()/take()
   semantics below (a raw property assignment like `g.cash -= n` must do
   EXACTLY what a plain number field did: store whatever the expression
   computes, no implicit floor). CBZ.game (config.js:~48 `cash: 0`) is an
   ordinary object literal — configurable, not frozen/sealed/proxied — so
   redefining its `cash` (and adding a fresh accessor `cityBank`, which
   config.js never declared; every one of its 20+ writers instead does
   `g.cityBank = (g.cityBank||0) + x` and let the field spring into
   existence) is safe. Verified by grep across src/ (37 g.cash call sites,
   23 g.cityBank call sites): every one is a plain read, `+=`/`-=`, or `=`
   inside a function body — no `delete g.cash`, no `Object.assign(g, ...)`
   touching either field, no spread-then-restore of `g` itself, and
   `CBZ.game` is assigned exactly once (config.js) so every module's local
   `const g = CBZ.game` keeps pointing at the SAME object we patch.

   SPEND/EARN SEMANTICS MATCH TODAY EXACTLY, because they're untouched: the
   canonical faucet/sink (city/mode.js's CBZ.city.addCash/spend) still reads
   `g.cash||0` and writes `g.cash = ...` — those now silently round-trip
   through the wallet, byte-identical outcomes (addCash's Math.max(0,...)
   floor and spend's "refuse if short" check are THEIR code, never
   duplicated here — CBZ.currency.add()/take() below are a NEW, parallel API
   for M2+ (a forex desk crediting a foreign currency, a central bank
   printing WMK, etc.), not a replacement for the existing helpers.

   ============================================================
   TREASURY DENOMINATION (documented, no conversion math — that's M2's
   forex layer): city/polity.js's country/state/city records and
   sim/econstate.js's per-jurisdiction `treasury` are still PLAIN NUMBERS
   this wave (unedited) — every one of them denominates in its OWN
   country's currency, root-mapped by CBZ.currency.jurisdictionCurrency(id)
   below (walks CBZ.polity.countryOf(id) up to the country record's
   currencyId, defaulting to the republic's LBD when polity isn't loaded/
   the id is unregistered). Concretely today: libertyville + every republic
   state/city (Goldspire, Cape Harbor, Neon Reef, Foundry) + Fort Brandt all
   denominate in LBD (they're republic territory); veridiacity/keshtown/
   solaracity/mbeyacity's econstate jurisdictions denominate in VDM/KSD/SOL/
   MBS respectively. Cohort wallets (city/npcecon.js) and player-facing
   corporation/billionaire `.cash` (sim/corporations.js, sim/billionaires.js)
   stay REPUBLIC-denominated plain numbers this wave too — they're mainland-
   only constructs (per X3/X4's own scoping comments), so "their own
   currency" and "the republic's currency" are the same thing until a later
   wave gives the new countries their own cohorts/corporations. NONE of this
   is enforced by code yet (no conversion, no cross-currency reads) — it's
   the seam M2+ wires real forex math into.

   ============================================================
   PERSISTENCE: rides the SAME single ledger city/worldstate.js already
   saves to localStorage AND net/netpersist.js already syncs to the server
   (charBlob.ledger = CBZ.cityWorldCollect() — see that file's header) via
   the established "_xWrap" idiom (core/interfaces.js contract #6, copied
   verbatim from city/bank.js's cityLoans wrap): stamp the full wallet/bank
   maps onto g.cityWorld right before the existing commit/collect save hooks
   run, hydrate back out whenever that ledger object's REFERENCE changes
   (fresh load / respawn / MP adopt). worldstate.js itself is NOT edited —
   its own w.cash/w.bank mirrors keep working unchanged because they read/
   write g.cash/g.cityBank, which now transparently proxy the wallet.

   MIGRATION FALLS OUT OF THE ACCESSOR DESIGN, FOR FREE: an OLD save's
   ledger has a plain `w.cash` NUMBER and no `w.currencyWallet` map.
   worldstate.js's applyToGame() runs `g.cash = w.cash || 0` (unchanged
   code) — that assignment goes through OUR setter, landing the number at
   wallet.LBD. Our own hydrate-from-ledger step then finds no
   `led.currencyWallet` on that old ledger and leaves the just-seeded wallet
   alone (does NOT clobber it with an absent field) — net result:
   {LBD: n}, zero loss, no special-cased migration function required. A NEW
   save's ledger DOES carry `currencyWallet`/`currencyBank` (whatever keys —
   including any foreign-currency balance a later wave puts there) and
   round-trips the full map verbatim.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;
  if (!g) return;

  function num(n, d) { n = +n; return isFinite(n) ? n : (d || 0); }

  // ============================================================
  //  THE REGISTRY
  // ============================================================
  const REPUBLIC_CURRENCY = "LBD";

  const CURRENCIES = Object.create(null);
  function register(entry) {
    if (!entry || !entry.id) return null;
    if (CURRENCIES[entry.id]) return CURRENCIES[entry.id]; // idempotent-by-id, same convention as city/polity.js's registerCountry
    const rec = {
      id: entry.id,
      name: entry.name || entry.id,
      symbol: entry.symbol || "$",
      countryId: entry.countryId || null,
    };
    CURRENCIES[entry.id] = rec;
    return rec;
  }

  // the 5 launch currencies — see file header for the naming rationale.
  register({ id: "LBD", name: "Liberty Dollar", symbol: "$", countryId: "republic" });
  register({ id: "VDM", name: "Veridian Mark", symbol: "V$", countryId: "veridia" });
  register({ id: "KSD", name: "Kesh Dinar", symbol: "KD", countryId: "kesh" });
  register({ id: "SOL", name: "Solara Sol", symbol: "S$", countryId: "solara" });
  register({ id: "MBS", name: "Mbeya Shilling", symbol: "MSh", countryId: "mbeya" });

  function get(id) { return (id && CURRENCIES[id]) || null; }
  function list() { const out = []; for (const id in CURRENCIES) out.push(CURRENCIES[id]); return out; }

  // country id -> currency id, straight registry lookup (built-by-countryId
  // index, cheap enough to recompute — 5 entries this wave).
  function countryCurrency(countryId) {
    if (!countryId) return REPUBLIC_CURRENCY;
    for (const id in CURRENCIES) if (CURRENCIES[id].countryId === countryId) return id;
    return REPUBLIC_CURRENCY;
  }
  // jurisdiction id (an econstate.js registry key / a polity.js record id,
  // same id-space — city ids double as econstate jurisdiction ids per that
  // file's own header) -> currency id. Walks CBZ.polity.countryOf() up the
  // country/state/city tree; falls back to the republic's currency when
  // polity.js hasn't loaded yet or the id is unregistered (safe default,
  // matches "the republic's is the player's default" design intent).
  function jurisdictionCurrency(jurisdictionId) {
    if (CBZ.polity && CBZ.polity.countryOf) {
      const country = CBZ.polity.countryOf(jurisdictionId);
      if (country && country.id) return countryCurrency(country.id);
    }
    return REPUBLIC_CURRENCY;
  }

  function fmt(currencyId, amount) {
    const c = get(currencyId) || get(REPUBLIC_CURRENCY);
    return c.symbol + Math.round(num(amount, 0)).toLocaleString();
  }

  // ============================================================
  //  THE WALLET (player) + the parallel BANK map (city/bank.js's "cash
  //  safe on death" pool) — sparse maps, seeded lazily.
  // ============================================================
  function ensureWallet() {
    if (!g.cityWallet || typeof g.cityWallet !== "object") g.cityWallet = {};
    return g.cityWallet;
  }
  function ensureBankWallet() {
    if (!g.cityBankWallet || typeof g.cityBankWallet !== "object") g.cityBankWallet = {};
    return g.cityBankWallet;
  }

  function walletGet(id) { return num(ensureWallet()[id || REPUBLIC_CURRENCY], 0); }
  // add()/take() are a NEW parallel API (M2+ forex desks, central-bank
  // printing, etc.) — they intentionally MIRROR city/mode.js's addCash/spend
  // clamp semantics (floor-at-0 add; refuse-if-short take) so a future
  // caller gets the exact behaviour players already know from the LBD path,
  // but they are never called by any M1 code — g.cash/g.cityBank's own
  // accessors below are a plain passthrough, not routed through these.
  function walletAdd(id, amt) {
    id = id || REPUBLIC_CURRENCY;
    const w = ensureWallet();
    w[id] = Math.max(0, num(w[id], 0) + num(amt, 0));
    return w[id];
  }
  function walletTake(id, amt) {
    id = id || REPUBLIC_CURRENCY;
    const w = ensureWallet();
    const have = num(w[id], 0), n = num(amt, 0);
    if (have < n) return false;
    w[id] = have - n;
    return true;
  }
  function bankGet(id) { return num(ensureBankWallet()[id || REPUBLIC_CURRENCY], 0); }
  function bankAdd(id, amt) {
    id = id || REPUBLIC_CURRENCY;
    const w = ensureBankWallet();
    w[id] = Math.max(0, num(w[id], 0) + num(amt, 0));
    return w[id];
  }
  function bankTake(id, amt) {
    id = id || REPUBLIC_CURRENCY;
    const w = ensureBankWallet();
    const have = num(w[id], 0), n = num(amt, 0);
    if (have < n) return false;
    w[id] = have - n;
    return true;
  }

  // ============================================================
  //  COMPAT ACCESSORS — g.cash / g.cityBank become LBD passthroughs.
  //  Run at script-parse time (before ANY city-mode logic executes — every
  //  city/* module only DEFINES functions/onUpdate hooks at parse time,
  //  none touch g.cash/g.cityBank until a real game tick fires, long after
  //  every script on the page has loaded), so the redefinition always wins.
  //  A `__curXHooked` flag makes this idempotent against an accidental
  //  double-load without losing whatever the wallet already holds.
  // ============================================================
  if (!g.__curCashHooked) {
    const seedCash = g.cash; // config.js's `cash: 0` (or whatever's already there)
    const wallet = ensureWallet();
    if (wallet[REPUBLIC_CURRENCY] == null) wallet[REPUBLIC_CURRENCY] = num(seedCash, 0);
    try {
      Object.defineProperty(g, "cash", {
        configurable: true, enumerable: true,
        get: function () { return ensureWallet()[REPUBLIC_CURRENCY]; },
        set: function (v) { ensureWallet()[REPUBLIC_CURRENCY] = v; },
      });
      g.__curCashHooked = true;
    } catch (e) { try { console.error("[currency] could not hook g.cash", e); } catch (e2) {} }
  }
  if (!g.__curBankHooked) {
    const seedBank = g.cityBank; // undefined pre-hook — config.js never declares it
    const bankWallet = ensureBankWallet();
    if (bankWallet[REPUBLIC_CURRENCY] == null) bankWallet[REPUBLIC_CURRENCY] = num(seedBank, 0);
    try {
      Object.defineProperty(g, "cityBank", {
        configurable: true, enumerable: true,
        get: function () { return ensureBankWallet()[REPUBLIC_CURRENCY]; },
        set: function (v) { ensureBankWallet()[REPUBLIC_CURRENCY] = v; },
      });
      g.__curBankHooked = true;
    } catch (e) { try { console.error("[currency] could not hook g.cityBank", e); } catch (e2) {} }
  }

  // ============================================================
  //  PERSISTENCE — the "_xWrap" idiom (core/interfaces.js contract #6),
  //  copied verbatim from city/bank.js's cityLoans wrap. worldstate.js is
  //  NOT edited: its own commit()/applyToGame() read/write g.cash/g.cityBank
  //  (now wallet-backed) unchanged, so w.cash/w.bank keep mirroring the
  //  republic balance exactly like before. This wrap ADDITIONALLY stamps
  //  the full multi-currency maps so a foreign-currency balance (M2+) rides
  //  the same ledger instead of being silently dropped on save/reload.
  // ============================================================
  function stampWallet() {
    const led = g.cityWorld;
    if (led && typeof led === "object") {
      led.currencyWallet = Object.assign({}, ensureWallet());
      led.currencyBank = Object.assign({}, ensureBankWallet());
    }
  }
  let _ensureCurSaveWraps_done = false;
  function ensureCurSaveWraps() {
    if (_ensureCurSaveWraps_done) return; // one-shot install (see bank.js's identical guard + its "chain-growth fix" note)
    _ensureCurSaveWraps_done = true;
    const commit = CBZ.cityWorldCommit;
    if (typeof commit === "function" && !commit._curWrap) {
      const w = function () { stampWallet(); return commit.apply(this, arguments); };
      w._curWrap = true; CBZ.cityWorldCommit = w;
      if (CBZ.cityWorldCollect && !CBZ.cityWorldCollect._curWrap) {
        const col = CBZ.cityWorldCollect;
        const wc = function () { stampWallet(); return col.apply(this, arguments); };
        wc._curWrap = true; CBZ.cityWorldCollect = wc;
      }
    }
  }
  // restore side: hydrate from g.cityWorld whenever its object REFERENCE
  // changes (fresh load / respawn / MP adopt) — an OLD ledger (no
  // currencyWallet field) is deliberately left alone here; g.cash's own
  // setter already seeded wallet.LBD from w.cash by the time this runs
  // (worldstate.js's applyToGame/cityWorldAdopt fire from mode.js's build(),
  // synchronously, before this module's next tick) — see file header.
  let _hydratedCurLedger = null;
  function hydrateWalletFromLedger() {
    const led = g.cityWorld;
    if (!led || led === _hydratedCurLedger) return;
    _hydratedCurLedger = led;
    if (led.currencyWallet && typeof led.currencyWallet === "object") g.cityWallet = Object.assign({}, led.currencyWallet);
    if (led.currencyBank && typeof led.currencyBank === "object") g.cityBankWallet = Object.assign({}, led.currencyBank);
  }
  // no THREE dependency at all (pure data plumbing) — registered
  // unconditionally so it runs headless too, same as every other save-wrap
  // install tick. 45.91: the free slot right beside bank.js's own 45.9 (see
  // that file's identical tick) and before familytree.js's 45.92.
  if (CBZ.onUpdate) {
    CBZ.onUpdate(45.91, function () {
      ensureCurSaveWraps();
      hydrateWalletFromLedger();
    });
  }

  // ============================================================
  CBZ.currency = {
    REPUBLIC_CURRENCY: REPUBLIC_CURRENCY,
    register: register,
    get: get,
    list: list,
    countryCurrency: countryCurrency,
    jurisdictionCurrency: jurisdictionCurrency,
    fmt: fmt,
    wallet: ensureWallet,
    bankWallet: ensureBankWallet,
    walletGet: walletGet,
    walletAdd: walletAdd,
    walletTake: walletTake,
    bankGet: bankGet,
    bankAdd: bankAdd,
    bankTake: bankTake,
  };
})();
