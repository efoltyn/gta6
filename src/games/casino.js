/* ============================================================
   games/casino.js — THE GOLDEN ACE, as a GAME PACKAGE.

   The reference package for core/packages.js: proves a whole venue
   game can live on the engine with zero engine forks. The standalone
   design/dev version is games/casino.html (same rules, same math,
   gated by tools/casino-check.mjs) — THIS file is what ships in the
   city. Rules are identical:
     blackjack  6-deck shoe, dealer stands all 17s, BJ pays 3:2,
                double any two, split once (aces get one card)
     roulette   European single zero, true wheel order, straight 35:1,
                even-money 1:1, dozens/columns 2:1, zero kills outside
     slots      3 reels x 22 stops, exact 90.8% RTP by enumeration
   Economy: chips are PACKAGE state (persisted); cash is REAL city
   money — the cage converts (#6b faucet/sink). The shark fronts
   chips against a marker; the cage pays him first. Comps at 3 wins.
   WHY per object: cage=only chips play · tables/wheel/slots=the games
   · booth=bust recovery · pit boss=the house watches · bar comp=hot
   streak. Decor with no job: none.
   Interiors: order-88 claim marks the flagship casino lot; the
   city/casino.js dresser keeps the exterior and skips the interior.
   Every town casino's tables also route here: CBZ.cityOpenCasino is
   wrapped (marker: _pkgWrapped) so the old menu casino is retired.
   Revert: CBZ.CONFIG.PKG_CASINO = false.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || !window.THREE) return;

  /* ---------------- pure rules (identical to games/casino.html) ---------- */
  const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const RED_SET = {}; [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].forEach((n) => { RED_SET[n] = 1; });
  const SLOT_STRIP = ["CHR", "LEM", "BAR", "ORN", "CHR", "BELL", "LEM", "CHR", "ORN", "SEV", "LEM", "CHR", "BELL", "ORN", "LEM", "BAR", "CHR", "BELL", "ORN", "LEM", "DIA", "CHR"];
  const LIMITS = { BJ_MIN: 25, BJ_MAX: 1000, RL_MAX: 500, SLOT_BETS: [5, 10, 25], LOAN_GIVE: 300, LOAN_OWE: 450, COMP_STREAK: 3 };

  function handValue(cards) {
    let s = 0, ace = 0;
    for (const c of cards) {
      if (c.r === "A") { s += 1; ace = 1; }
      else if (c.r === "J" || c.r === "Q" || c.r === "K") s += 10;
      else s += parseInt(c.r, 10);
    }
    let soft = false;
    if (ace && s + 10 <= 21) { s += 10; soft = true; }
    return { v: s, soft };
  }
  function isNatural(cards) { return cards.length === 2 && handValue(cards).v === 21; }
  function settleBJ(hand, dealer, bet, naturalEligible) {
    const pv = handValue(hand).v, dv = handValue(dealer).v;
    if (pv > 21) return 0;
    if (naturalEligible && isNatural(hand)) return isNatural(dealer) ? bet : bet + bet * 1.5;
    if (isNatural(dealer)) return 0;
    if (dv > 21 || pv > dv) return bet * 2;
    if (pv === dv) return bet;
    return 0;
  }
  function rlPayout(bets, n) {
    let ret = 0; const red = !!RED_SET[n];
    for (const k in bets) {
      const amt = bets[k]; if (!amt) continue;
      if (k[0] === "n") { if (parseInt(k.slice(1), 10) === n) ret += amt * 36; continue; }
      if (n === 0) continue;
      if (k === "red" && red) ret += amt * 2;
      else if (k === "black" && !red) ret += amt * 2;
      else if (k === "even" && n % 2 === 0) ret += amt * 2;
      else if (k === "odd" && n % 2 === 1) ret += amt * 2;
      else if (k === "low" && n <= 18) ret += amt * 2;
      else if (k === "high" && n >= 19) ret += amt * 2;
      else if (k === "dz1" && n <= 12) ret += amt * 3;
      else if (k === "dz2" && n >= 13 && n <= 24) ret += amt * 3;
      else if (k === "dz3" && n >= 25) ret += amt * 3;
      else if (k === "col1" && n % 3 === 1) ret += amt * 3;
      else if (k === "col2" && n % 3 === 2) ret += amt * 3;
      else if (k === "col3" && n % 3 === 0) ret += amt * 3;
    }
    return ret;
  }
  function slotPay(a, b, c) {
    const ch = [a, b, c].filter((s) => s === "CHR").length;
    if (a === b && b === c) return { DIA: 500, SEV: 250, BAR: 40, BELL: 20, ORN: 12, LEM: 8, CHR: 6 }[a] || 0;
    if (ch === 2) return 2;
    if (ch === 1 && a === "CHR") return 1;
    return 0;
  }
  function slotRTP() {
    const N = SLOT_STRIP.length; let total = 0;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) for (let k = 0; k < N; k++)
      total += slotPay(SLOT_STRIP[i], SLOT_STRIP[j], SLOT_STRIP[k]);
    return total / (N * N * N);
  }

  /* ---------------- session state ---------------------------------------- */
  let C = null;          // ctx once mounted (or a hub ctx when only the panel runs)
  let V = null;          // flagship venue 3D refs {bj:[], rl, slots:[], gCards, gChips}
  let S = null;          // persisted bag: {chips, debt, streak, stats}
  function bag() {
    if (S) return S;
    S = C.state(() => ({ chips: 0, debt: 0, streak: 0, stats: { hands: 0, spins: 0, pulls: 0, biggestWin: 0, drinks: 0 } }));
    return S;
  }
  function save() { C.saveState(); }
  function fmt(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function chipsHUD() { return "chips <b>" + bag().chips.toLocaleString() + "</b> · cash <b>" + fmt(C.wallet.cash()) + "</b>" + (bag().debt ? " · <span style='color:#ff9aa2'>marker " + fmt(bag().debt) + "</span>" : ""); }
  function winStreak(profit) {
    const s = bag();
    if (profit > 0) { s.streak++; if (profit > s.stats.biggestWin) s.stats.biggestWin = profit; if (s.streak === LIMITS.COMP_STREAK) { C.hud.feed("Barman sends one over — on the house. Heater confirmed.", "#ffd166"); pitBossBark("hot"); } }
    else if (profit < 0) s.streak = 0;
    save();
  }
  function bustWatch() {
    const s = bag();
    if (s.chips >= 5 || C.wallet.cash() >= 15) return;
    C.hud.feed(s.debt > 0 ? "Broke AND carrying the Shark's marker. Bad night." : "Felt's closed to you — unless you visit the booth in the back.", "#ff9aa2");
    pitBossBark("cold");
  }

  /* ---------------- panel UI (engine panel, data-act delegation) ---------- */
  const BTN = "display:inline-block;margin:3px 6px 3px 0;padding:9px 16px;border-radius:11px;cursor:pointer;" +
    "font-weight:800;font-size:14px;user-select:none;";
  function btn(act, label, bg, dis) {
    return "<span data-act='" + act + "' style='" + BTN + "background:" + (bg || "#1c6b40") + ";" +
      (dis ? "opacity:.4;pointer-events:none;" : "") + "box-shadow:0 3px 0 rgba(0,0,0,.4);'>" + label + "</span>";
  }
  function head(title, sub) {
    return "<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:8px'>" +
      "<b style='letter-spacing:2px;color:#e8b64c'>" + title + "</b><span style='opacity:.7;font-size:12px'>" + sub + " · Esc closes</span></div>";
  }

  /* ======================= BLACKJACK ====================================== */
  let SHOE = [];
  function buildShoe() {
    SHOE = [];
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    for (let d = 0; d < 6; d++) for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) SHOE.push({ r: ranks[r], s });
    for (let i = SHOE.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = SHOE[i]; SHOE[i] = SHOE[j]; SHOE[j] = t; }
  }
  function draw() { if (SHOE.length < 78) { buildShoe(); C.hud.feed("Dealer shuffles a fresh shoe"); } return SHOE.pop(); }
  const BJ = { phase: "bet", hands: [], act: 0, dealer: [], stake: 0, splitDone: false, tableIx: 0 };
  function bjDeal() {
    const s = bag();
    if (BJ.stake < LIMITS.BJ_MIN) { C.hud.feed("Table minimum is $" + LIMITS.BJ_MIN, "#ff9aa2"); return; }
    if (s.chips < BJ.stake) { C.hud.feed("Not enough chips — the cage sells them.", "#ff9aa2"); return; }
    s.chips -= BJ.stake; save();
    BJ.phase = "player"; BJ.act = 0; BJ.splitDone = false;
    BJ.hands = [{ cards: [], bet: BJ.stake, done: false, meshes: [] }];
    BJ.dealer = []; BJ.dealerMeshes = [];
    v3ClearRound();
    BJ.hands[0].cards.push(draw()); v3Card(0, BJ.hands[0].cards[0], true, 60);
    BJ.dealer.push(draw()); v3Card("D", BJ.dealer[0], true, 340);
    BJ.hands[0].cards.push(draw()); v3Card(0, BJ.hands[0].cards[1], true, 620);
    BJ.dealer.push(draw()); v3Card("D", BJ.dealer[1], false, 900);
    v3Chips(BJ.stake);
    s.stats.hands++;
    setTimeout(() => {
      const up = BJ.dealer[0], upTen = handValue([up]).v === 10 || up.r === "A";
      if (upTen && isNatural(BJ.dealer)) { bjFinish(true, false, true); return; }
      if (isNatural(BJ.hands[0].cards)) { bjFinish(false, false, true); return; }
      renderBJ();
    }, 1150);
    renderBJ("Dealing…");
  }
  function bjHand() { return BJ.hands[BJ.act]; }
  function bjHit() { const h = bjHand(); h.cards.push(draw()); v3Card(BJ.act, h.cards[h.cards.length - 1], true, 0); if (handValue(h.cards).v > 21) { h.done = true; bjNext(); } else renderBJ(); }
  function bjStand() { bjHand().done = true; bjNext(); }
  function bjDouble() {
    const s = bag(), h = bjHand();
    if (h.cards.length !== 2 || s.chips < h.bet) return;
    s.chips -= h.bet; h.bet *= 2; save();
    h.cards.push(draw()); v3Card(BJ.act, h.cards[h.cards.length - 1], true, 0);
    h.done = true; setTimeout(bjNext, 400); renderBJ("Doubled down.");
  }
  function bjSplit() {
    const s = bag(), h = BJ.hands[0];
    if (BJ.splitDone || BJ.hands.length > 1 || h.cards.length !== 2) return;
    if (handValue([h.cards[0]]).v !== handValue([h.cards[1]]).v || s.chips < h.bet) return;
    s.chips -= h.bet; save(); BJ.splitDone = true;
    const moved = h.cards.pop();
    BJ.hands.push({ cards: [moved], bet: h.bet, done: false, meshes: [] });
    v3Split();
    const aces = h.cards[0].r === "A";
    [0, 1].forEach((hi) => {
      setTimeout(() => { const hh = BJ.hands[hi]; hh.cards.push(draw()); v3Card(hi, hh.cards[1], true, 0); if (aces) hh.done = true; }, 350 + hi * 350);
    });
    setTimeout(() => { if (aces) bjNext(); else { BJ.act = 0; renderBJ(); } }, 1100);
  }
  function bjNext() {
    if (BJ.act < BJ.hands.length - 1 && !BJ.hands[BJ.act + 1].done) { BJ.act++; renderBJ(); return; }
    const anyLive = BJ.hands.some((h) => handValue(h.cards).v <= 21);
    bjFinish(false, !anyLive, false);
  }
  function bjFinish(dealerNatural, allBusted, skipDraw) {
    BJ.phase = "dealer"; renderBJ("Dealer plays…");
    v3Reveal();
    let delay = 700;
    if (!dealerNatural && !allBusted && !skipDraw) {
      (function loop() {
        if (handValue(BJ.dealer).v < 17) {
          setTimeout(() => { BJ.dealer.push(draw()); v3Card("D", BJ.dealer[BJ.dealer.length - 1], true, 0); loop(); }, delay);
          delay = 560; return;
        }
        setTimeout(bjSettle, delay + 260);
      })();
    } else setTimeout(bjSettle, 820);
  }
  function bjSettle() {
    BJ.phase = "done";
    const s = bag(), naturalOK = BJ.hands.length === 1 && !BJ.splitDone;
    let totalBet = 0, totalRet = 0; const lines = [];
    BJ.hands.forEach((h, i) => {
      totalBet += h.bet;
      const ret = settleBJ(h.cards, BJ.dealer, h.bet, naturalOK);
      totalRet += ret;
      const pv = handValue(h.cards).v, dv = handValue(BJ.dealer).v;
      let tag;
      if (pv > 21) tag = "bust";
      else if (naturalOK && isNatural(h.cards) && !isNatural(BJ.dealer)) tag = "BLACKJACK — 3:2";
      else if (isNatural(BJ.dealer) && !isNatural(h.cards)) tag = "dealer blackjack";
      else if (dv > 21) tag = "dealer busts on " + dv;
      else tag = pv > dv ? pv + " beats " + dv : (pv === dv ? "push " + pv : dv + " beats " + pv);
      lines.push((BJ.hands.length > 1 ? "Hand " + (i + 1) + ": " : "") + tag);
    });
    s.chips += totalRet;
    const profit = totalRet - totalBet;
    winStreak(profit); save();
    if (lines.some((l) => l.indexOf("BLACKJACK") >= 0)) C.hud.toast("BLACKJACK! Pays 3:2");
    C.hud.feed("Blackjack: " + lines.join(" · ") + " (" + (profit >= 0 ? "+" : "−") + fmt(Math.abs(profit)).slice(1) + " chips)", profit > 0 ? "#ffd166" : "#e8dcc0");
    renderBJ(); bustWatch();
  }
  function renderBJ(msg) {
    let body = "";
    if (BJ.phase === "bet") {
      body = "<div style='margin:4px 0 8px'>Stake <b>" + fmt(BJ.stake) + "</b> · " + chipsHUD() + "</div>" +
        [5, 25, 100, 500].map((d) => btn("chip" + d, "+$" + d, "#5a3a1a")).join("") +
        btn("deal", "DEAL", "#c98f22", BJ.stake < LIMITS.BJ_MIN) + btn("clear", "Clear", "#26343c") + btn("hub", "Floor", "#26343c");
    } else if (BJ.phase === "player") {
      const h = bjHand(), hv = handValue(h.cards);
      body = "<div style='margin:4px 0 8px'>" + (BJ.hands.length > 1 ? "<b>Hand " + (BJ.act + 1) + "</b> — " : "") +
        "You: <b>" + hv.v + (hv.soft ? " soft" : "") + "</b> (" + h.cards.map(cardName).join(" ") + ") vs dealer " + cardName(BJ.dealer[0]) + "</div>" +
        btn("hit", "HIT", "#1c6b40") + btn("standp", "STAND", "#c98f22") +
        btn("dbl", "DOUBLE", "#7c1626", h.cards.length !== 2 || bag().chips < h.bet) +
        btn("split", "SPLIT", "#26343c", !(!BJ.splitDone && BJ.hands.length === 1 && h.cards.length === 2 && handValue([h.cards[0]]).v === handValue([h.cards[1]]).v && bag().chips >= h.bet));
    } else if (BJ.phase === "dealer") {
      body = "<div style='margin:8px 0'>" + (msg || "Dealer plays…") + "</div>";
    } else {
      body = "<div style='margin:4px 0 8px'>Dealer had <b>" + handValue(BJ.dealer).v + "</b> (" + BJ.dealer.map(cardName).join(" ") + ") · " + chipsHUD() + "</div>" +
        btn("deal", "REBET " + fmt(BJ.stake), "#c98f22", bag().chips < BJ.stake) + btn("changebet", "CHANGE BET", "#26343c") + btn("hub", "Floor", "#26343c");
    }
    C.hud.panel(head("BLACKJACK — 3:2 · DEALER STANDS 17", "$" + LIMITS.BJ_MIN + "–$" + LIMITS.BJ_MAX) + (msg && BJ.phase !== "dealer" ? "<div style='margin:2px 0 6px;opacity:.8'>" + msg + "</div>" : "") + body, {
      chip5: () => { bjChip(5); }, chip25: () => { bjChip(25); }, chip100: () => { bjChip(100); }, chip500: () => { bjChip(500); },
      deal: bjDeal, clear: () => { BJ.stake = 0; renderBJ(); }, changebet: () => { BJ.phase = "bet"; BJ.stake = 0; renderBJ(); },
      hit: bjHit, standp: bjStand, dbl: bjDouble, split: bjSplit, hub: openHub,
    });
  }
  function bjChip(d) { if (BJ.stake + d <= LIMITS.BJ_MAX && bag().chips >= BJ.stake + d) { BJ.stake += d; renderBJ(); } }
  const SUITS = ["♠", "♥", "♦", "♣"];
  function cardName(c) { return c.r + SUITS[c.s]; }
  /* ======================= ROULETTE ======================================= */
  const RL = { bets: {}, unit: 25, spinning: false, hist: [] };
  function rlStake() { let s = 0; for (const k in RL.bets) s += RL.bets[k]; return s; }
  function rlPlace(key) {
    if (RL.spinning) return;
    const s = bag(), amt = Math.min(RL.unit, s.chips);
    if (amt <= 0) { C.hud.feed("No chips — the cage sells them.", "#ff9aa2"); return; }
    if (rlStake() + amt > LIMITS.RL_MAX) { C.hud.feed("Table cap is $" + LIMITS.RL_MAX, "#ff9aa2"); return; }
    s.chips -= amt; RL.bets[key] = (RL.bets[key] || 0) + amt; save(); renderRL();
  }
  function rlClear() { if (RL.spinning) return; bag().chips += rlStake(); RL.bets = {}; save(); renderRL(); }
  function rlSpin() {
    if (RL.spinning || !rlStake()) { if (!rlStake()) C.hud.feed("Place a bet first.", "#ff9aa2"); return; }
    RL.spinning = true; bag().stats.spins++; save(); renderRL();
    const outcome = Math.floor(Math.random() * 37);
    if (V && V.rl) v3Wheel(outcome, () => rlSettle(outcome));
    else setTimeout(() => rlSettle(outcome), 1400);
  }
  function rlSettle(n) {
    const s = bag(), stake = rlStake(), ret = rlPayout(RL.bets, n);
    s.chips += ret; RL.bets = {};
    const profit = ret - stake;
    RL.hist.unshift(n); if (RL.hist.length > 9) RL.hist.pop();
    winStreak(profit); save();
    const name = n + (n === 0 ? " GREEN" : (RED_SET[n] ? " RED" : " BLACK"));
    if (profit >= 500) C.hud.toast("The wheel says " + name);
    C.hud.feed("Wheel: " + name + " — " + (ret > 0 ? "returned " + ret : "house takes it") + " (" + (profit >= 0 ? "+" : "−") + Math.abs(profit) + " chips)", profit > 0 ? "#ffd166" : "#e8dcc0");
    RL.spinning = false; renderRL(); bustWatch();
  }
  function rcell(label, key, bg, wide) {
    const amt = RL.bets[key];
    return "<span data-act='b_" + key + "' style='position:relative;display:inline-block;width:" + (wide ? 52 : 30) + "px;height:26px;line-height:26px;" +
      "text-align:center;margin:1px;border-radius:5px;background:" + bg + ";font-size:12px;font-weight:800;cursor:pointer'>" + label +
      (amt ? "<span style='position:absolute;right:-4px;top:-7px;background:#e8b64c;color:#3a2803;border-radius:9px;font-size:10px;padding:0 4px'>" + amt + "</span>" : "") + "</span>";
  }
  function renderRL() {
    let rows = "";
    for (let row = 0; row < 3; row++) {
      let r = row === 1 ? rcell("0", "n0", "#0f7a44") : "<span style='display:inline-block;width:30px;margin:1px'></span>";
      for (let col = 0; col < 12; col++) {
        const n = col * 3 + (3 - row);
        r += rcell(String(n), "n" + n, RED_SET[n] ? "#a41f2f" : "#1a1f24");
      }
      r += rcell("C" + (3 - row), "col" + (3 - row), "#2c4438");
      rows += "<div>" + r + "</div>";
    }
    rows += "<div>" + rcell("1st12", "dz1", "#2c4438", 1) + rcell("2nd12", "dz2", "#2c4438", 1) + rcell("3rd12", "dz3", "#2c4438", 1) +
      rcell("1-18", "low", "#2c4438", 1) + rcell("EVEN", "even", "#2c4438", 1) + rcell("RED", "red", "#a41f2f", 1) +
      rcell("BLK", "black", "#1a1f24", 1) + rcell("ODD", "odd", "#2c4438", 1) + rcell("19-36", "high", "#2c4438", 1) + "</div>";
    const hist = RL.hist.length ? "<div style='margin:4px 0;opacity:.85'>Last: " + RL.hist.map((h) => "<b style='color:" + (h === 0 ? "#3ad17a" : RED_SET[h] ? "#ff6b7a" : "#cfd6dd") + "'>" + h + "</b>").join(" ") + "</div>" : "";
    const body = "<div style='margin:2px 0 6px'>" + (RL.spinning ? "No more bets — ball's away…" : "On the felt <b>" + fmt(rlStake()) + "</b> · unit $" + RL.unit + " · " + chipsHUD()) + "</div>" +
      rows + hist +
      [5, 25, 100].map((d) => btn("unit" + d, "$" + d + (RL.unit === d ? " ✓" : ""), "#5a3a1a")).join("") +
      btn("spin", "SPIN", "#c98f22", RL.spinning || !rlStake()) + btn("clearrl", "CLEAR", "#26343c", RL.spinning || !rlStake()) + btn("hub", "Floor", "#26343c");
    const handlers = { spin: rlSpin, clearrl: rlClear, hub: openHub, unit5: () => { RL.unit = 5; renderRL(); }, unit25: () => { RL.unit = 25; renderRL(); }, unit100: () => { RL.unit = 100; renderRL(); } };
    ["red", "black", "even", "odd", "low", "high", "dz1", "dz2", "dz3", "col1", "col2", "col3"].forEach((k) => { handlers["b_" + k] = () => rlPlace(k); });
    for (let n = 0; n <= 36; n++) handlers["b_n" + n] = () => rlPlace("n" + n);
    C.hud.panel(head("EUROPEAN ROULETTE — SINGLE ZERO", "straight 35:1 · table cap $" + LIMITS.RL_MAX), handlers ? body : body, handlers);
  }

  /* ======================= SLOTS ========================================== */
  const SL = { bet: 5, spinning: false, last: null };
  function slPull() {
    if (SL.spinning) return;
    const s = bag();
    if (s.chips < SL.bet) { C.hud.feed("No chips — the cage sells them.", "#ff9aa2"); return; }
    s.chips -= SL.bet; s.stats.pulls++; save();
    SL.spinning = true; renderSL();
    const stops = [Math.floor(Math.random() * 22), Math.floor(Math.random() * 22), Math.floor(Math.random() * 22)];
    if (V && V.slots.length) v3Reels(stops, () => slSettle(stops));
    else setTimeout(() => slSettle(stops), 1100);
  }
  function slSettle(stops) {
    const s = bag(), syms = stops.map((k) => SLOT_STRIP[k]);
    const mult = slotPay(syms[0], syms[1], syms[2]), win = mult * SL.bet;
    SL.last = { syms, win };
    if (win > 0) {
      s.chips += win;
      if (mult >= 200) C.hud.toast("JACKPOT! " + syms.join(" "));
      C.hud.feed("Reels: " + syms.join(" · ") + " — pays " + mult + "x (+" + (win - SL.bet) + " chips)", "#ffd166");
    }
    winStreak(win - SL.bet); save();
    SL.spinning = false; renderSL(); bustWatch();
  }
  function renderSL() {
    const body = "<div style='margin:2px 0 8px'>" +
      (SL.last ? "Last: <b>" + SL.last.syms.join(" ") + "</b>" + (SL.last.win ? " — paid " + SL.last.win : " — nothing") + " · " : "") +
      "bet <b>$" + SL.bet + "</b> · " + chipsHUD() +
      "<br><span style='opacity:.6;font-size:12px'>DIA 500x · 7s 250x · BAR 40x · BELL 20x · fruit 12/8/6x · cherries small · 90.8% return</span></div>" +
      LIMITS.SLOT_BETS.map((b) => btn("sb" + b, "$" + b + (SL.bet === b ? " ✓" : ""), "#5a3a1a")).join("") +
      btn("pull", SL.spinning ? "SPINNING…" : "PULL", "#7c1626", SL.spinning) + btn("hub", "Floor", "#26343c");
    C.hud.panel(head("LUCKY 7s — 3 REEL", "the dome knows"), body, {
      pull: slPull, hub: openHub,
      sb5: () => { SL.bet = 5; renderSL(); }, sb10: () => { SL.bet = 10; renderSL(); }, sb25: () => { SL.bet = 25; renderSL(); },
    });
  }

  /* ======================= CAGE / SHARK / HUB ============================= */
  function renderCage() {
    const s = bag();
    const body = "<div style='margin:2px 0 8px'>" + chipsHUD() + "<br><span style='opacity:.65;font-size:12px'>Chips are the only money the felt takes. The cage pays the Shark first.</span></div>" +
      btn("buy100", "Buy 100", "#1c6b40", C.wallet.cash() < 100) + btn("buy250", "Buy 250", "#1c6b40", C.wallet.cash() < 250) +
      btn("buy1000", "Buy 1,000", "#1c6b40", C.wallet.cash() < 1000) +
      btn("cashout", "CASH OUT " + s.chips.toLocaleString(), "#c98f22", s.chips <= 0) + btn("hub", "Floor", "#26343c");
    C.hud.panel(head("THE CAGE", "cash ↔ chips"), body, {
      buy100: () => cageBuy(100), buy250: () => cageBuy(250), buy1000: () => cageBuy(1000), cashout: cageOut, hub: openHub,
    });
  }
  function cageBuy(n) { if (!C.wallet.spend(n, "Bought " + n + " chips")) return; bag().chips += n; save(); renderCage(); }
  function cageOut() {
    const s = bag(); let amt = s.chips; s.chips = 0;
    const toShark = Math.min(amt, s.debt);
    if (toShark > 0) { s.debt -= toShark; amt -= toShark; C.hud.feed("The cage routes " + fmt(toShark) + " to the Shark's marker", "#ff9aa2"); }
    if (amt > 0) C.wallet.give(amt, "Cashed out chips");
    save(); renderCage();
  }
  function renderShark() {
    sharkBark();                     // the ped mutters flavor; the loan PANEL below stays the primary [E]
    const s = bag();
    const body = s.debt > 0
      ? "<div style='margin:6px 0'>“You already carry my marker — <b>" + fmt(s.debt) + "</b>. Pay the cage. Then we talk.”</div>" + btn("hub", "Walk away", "#26343c")
      : "<div style='margin:6px 0'>“I'll front you <b>" + fmt(LIMITS.LOAN_GIVE) + "</b> in chips. You'll owe <b>" + fmt(LIMITS.LOAN_OWE) + "</b>. The house always pays me first.”</div>" +
        btn("takeloan", "Take the marker (+" + LIMITS.LOAN_GIVE + " chips)", "#7c1626") + btn("hub", "Walk away", "#26343c");
    C.hud.panel(head("THE SHARK", "vig is vig"), body, {
      hub: openHub,
      takeloan: () => { s.chips += LIMITS.LOAN_GIVE; s.debt += LIMITS.LOAN_OWE; save(); C.hud.feed("The Shark slides you " + LIMITS.LOAN_GIVE + " chips. You owe " + fmt(LIMITS.LOAN_OWE) + ".", "#ff9aa2"); openHub(); },
    });
  }
  function openHub() {
    const body = "<div style='margin:2px 0 8px'>" + chipsHUD() + "</div>" +
      btn("gobj", "Blackjack", "#1c6b40") + btn("gorl", "Roulette", "#a41f2f") + btn("gosl", "Slots", "#26343c") +
      btn("gocage", "The Cage", "#5a3a1a") + btn("goshark", "The Shark", "#7c1626") + btn("leave", "Step away", "#26343c");
    C.hud.panel(head("THE GOLDEN ACE", "pick a table"), body, {
      gobj: () => { BJ.phase = "bet"; BJ.stake = Math.max(BJ.stake, 0); renderBJ(); },
      gorl: renderRL, gosl: renderSL, gocage: renderCage, goshark: renderShark,
      leave: () => C.hud.closePanel(),
    });
  }

  /* ======================= THE CAST (real city peds) ===================== */
  /* Every dealer/croupier/cashier/guard/pit boss/shark/patron is a REAL city
     ped (the ones that put their hands up at gunpoint) requested via ctx.npc —
     role, role-relevant outfit, and in-world dialogue. If the engine facade
     hasn't landed yet, each call falls back to today's package-local rig at the
     SAME spot/pose so the venue still boots clean (Rule 1: backward-tolerant).
     Handles are parked on V.npcs so refs don't leak; teardown is engine-side. */
  function castNPC(ctx, spec, fallback) {
    const h = ctx.npc ? ctx.npc(spec) : (fallback ? fallback() : null);
    if (h && V && V.npcs) V.npcs.push(h);
    return h;
  }
  // Dialogue: [E] Talk cycles these lines via the engine's interaction system.
  // Golden Ace register — the house always wins, politely. Two dealers get
  // distinct sets so a full table doesn't read copy-pasted.
  const DEALER_LINES = [[
    "Dealer stands on all seventeens. The shoe doesn't care what you feel.",
    "Blackjack pays three to two. Insurance pays for the chandeliers.",
    "Fresh six-deck shoe, cut card's buried. Count it if you like — the pit counts you right back.",
    "Double when you're sure. This felt has heard a lot of sure.",
  ], [
    "Hit sixteen, stand on seventeen, lose with a smile. That's the whole game.",
    "Cards don't run hot or cold, friend. They run house.",
    "Nice hand. Now win it eight more times — that's when the felt starts to notice.",
    "You want a system? Mine's simple: I deal, you pay, we both stay polite.",
  ]];
  const CROUPIER_LINES = [
    "Single zero, true wheel, honest ball. That one green pocket is the whole business model.",
    "Place your bets... and no more bets. The wheel doesn't take requests.",
    "Red, black, odd, even — the zero quietly collects from all of them.",
    "Every system ever devised dies in that little green slot. Yours will keep it company.",
    "Thirty-six numbers, thirty-five to one. That missing number is the house's whole living.",
  ];
  const CASHIER_LINES = [
    "Chips play, cash doesn't. Nothing touches the felt until it's passed my window.",
    "Cashing out? If you carry the Shark's marker, the cage settles him first. House policy.",
    "Buy in here, color up here. Whatever the tables leave you, this is where it lands.",
    "Big win or bad beat, it all comes back to this counter. Everything here does.",
  ];
  const GUARD_LINES = [
    "Hands where the cameras can see them. Enjoy your evening.",
    "Cage stays behind the brass. You stay in front of it.",
    "I watch the floor. The floor watches you.",
    "No trouble tonight. There's never any trouble here.",
  ];
  const PITBOSS_LINES = [
    "Table three's running warm. We notice warm.",
    "Win or lose, you're on camera the whole time. Do smile.",
    "Nobody beats this floor for long. The floor is extremely patient.",
    "You're up? Wonderful. Stay a while — let it find its way home.",
    "Comps are for friends of the house. Keep playing; we'll see how friendly you get.",
  ];
  // The pit boss also BARKS live lines keyed to the player's night (read straight
  // off bag()): pointed when you're hot, cold when you're down. Deterministic pick
  // off the play counters (runtime flavor, no rng churn); guarded so it no-ops off
  // the flagship or before the facade lands.
  const PITBOSS_HOT = [
    "Table's running warm. We notice warm.",
    "Three on the trot — enjoy it. The wheel has a long memory.",
    "A heater like that draws eyes. Mostly ours.",
  ];
  const PITBOSS_COLD = [
    "Rough shoe. The cage still honors the Shark's marker, if it comes to that.",
    "Cold runs happen. To you, tonight, apparently.",
    "Down to felt lint? There's a booth in the back for exactly that.",
  ];
  const SHARK_LINES = [
    "Vig is vig. Nothing personal — all arithmetic.",
    "Everybody pays. The house first, me second, you whenever you can.",
    "Short again? The marker's right here. So am I.",
  ];
  function pickLine(pool, salt) { const s = bag().stats; return pool[(s.hands + s.spins + s.pulls + (salt || 0)) % pool.length]; }
  function pitBossBark(mood) { const h = V && V.pitBoss; if (h && h.say) h.say(pickLine(mood === "hot" ? PITBOSS_HOT : PITBOSS_COLD, mood === "hot" ? 0 : 1)); }
  function sharkBark() { const h = V && V.shark; if (h && h.say) h.say(pickLine(SHARK_LINES, bag().debt ? 2 : 0)); }

  /* ======================= FLAGSHIP VENUE (3D) ============================ */
  /* Card/chip/wheel/reel glue — every fn no-ops without the flagship venue. */
  const CHIP_COLS = { 5: 0xc22323, 25: 0x1c8a4e, 100: 0x26262c, 500: 0x6a3aa0, 1000: 0xc9a227 };
  let cardGeo = null, chipGeo = null; const cardTexCache = {};
  function cardTexture(c) {
    const key = c.r + c.s;
    if (cardTexCache[key]) return cardTexCache[key];
    const red = c.s === 1 || c.s === 2;
    cardTexCache[key] = C.canvasTex(128, 180, (g) => {
      g.fillStyle = "#f8f4ea"; g.fillRect(0, 0, 128, 180);
      g.strokeStyle = "#c9bfa4"; g.lineWidth = 4; g.strokeRect(2, 2, 124, 176);
      g.fillStyle = red ? "#b0242e" : "#1c1c22";
      g.font = "800 34px 'Trebuchet MS'"; g.textAlign = "left"; g.textBaseline = "top";
      g.fillText(c.r, 9, 6); g.font = "800 30px 'Trebuchet MS'"; g.fillText(SUITS[c.s], 9, 40);
      g.font = "800 64px 'Trebuchet MS'"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(SUITS[c.s], 64, 100);
    });
    return cardTexCache[key];
  }
  let backTex = null;
  function cardBack() {
    backTex = backTex || C.canvasTex(128, 180, (g) => {
      g.fillStyle = "#6e1524"; g.fillRect(0, 0, 128, 180);
      g.strokeStyle = "#c9a227"; g.lineWidth = 3; g.strokeRect(7, 7, 114, 166);
      for (let y = 20; y < 170; y += 24) for (let x = 18; x < 118; x += 24) { g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 9, y); g.lineTo(x, y + 9); g.lineTo(x - 9, y); g.closePath(); g.stroke(); }
    });
    return backTex;
  }
  function v3Table() { return V && V.bj[BJ.tableIx || 0]; }
  function v3ClearRound() { if (!V) return; while (V.gCards.children.length) V.gCards.remove(V.gCards.children[0]); while (V.gChips.children.length) V.gChips.remove(V.gChips.children[0]); }
  function v3Card(hi, card, faceUp, delayMs) {
    const T = v3Table(); if (!T) return;
    cardGeo = cardGeo || new C.THREE.PlaneGeometry(0.26, 0.365);
    const m = new C.THREE.Mesh(cardGeo, new C.THREE.MeshLambertMaterial({ map: faceUp ? cardTexture(card) : cardBack(), side: C.THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.userData.card = card; m.userData.hole = !faceUp;
    const idx = hi === "D" ? BJ.dealer.length - 1 : BJ.hands[hi].cards.length - 1;
    const spot = hi === "D" ? T.dealerSpot : (hi === 0 ? T.playerSpot : T.splitSpot);
    m.position.set(spot[0] - 0.55 + idx * 0.3, spot[1] + idx * 0.003, spot[2] + (hi === "D" ? 0 : idx * 0.06));
    m.visible = false;
    setTimeout(() => { m.visible = true; }, delayMs || 0);
    if (hi === "D") BJ.dealerMeshes.push(m); else BJ.hands[hi].meshes.push(m);
    V.gCards.add(m);
  }
  function v3Reveal() { if (!V || !BJ.dealerMeshes) return; const hole = BJ.dealerMeshes[1]; if (hole && hole.userData.hole) { hole.material.map = cardTexture(hole.userData.card); hole.material.needsUpdate = true; hole.userData.hole = false; } }
  function v3Split() { const T = v3Table(); if (!T) return; const m = BJ.hands[0].meshes.pop(); if (m) { BJ.hands[1].meshes.push(m); m.position.set(T.splitSpot[0] - 0.55, T.splitSpot[1], T.splitSpot[2]); } }
  function v3Chips(amount) {
    const T = v3Table(); if (!T) return;
    chipGeo = chipGeo || new C.THREE.CylinderGeometry(0.075, 0.075, 0.024, 12);
    const denoms = [1000, 500, 100, 25, 5]; let col = 0;
    for (const d of denoms) {
      let n = Math.floor(amount / d); amount -= n * d; n = Math.min(n, 8);
      for (let i = 0; i < n; i++) {
        const m = new C.THREE.Mesh(chipGeo, C.mat(CHIP_COLS[d]));
        m.position.set(T.betSpot[0] + col * 0.17, T.betSpot[1] + 0.015 + i * 0.026, T.betSpot[2]);
        V.gChips.add(m);
      }
      if (n) col++;
    }
  }
  function pocketAngle(i) { return Math.PI / 2 - ((i + 0.5) / 37) * Math.PI * 2; }
  function v3Wheel(outcome, done) {
    const W = V.rl, idx = WHEEL_ORDER.indexOf(outcome);
    let t = 0, ballA = 0, R = 0.85; const DUR = 5.2;
    C.anim((dt) => {
      t += dt;
      const w = 2.6 * Math.max(0.22, 1 - (t / DUR) * 0.85);
      W.theta += w * dt; W.disc.rotation.z = W.theta; W.turret.rotation.y = W.theta;
      const target = pocketAngle(idx) + W.theta;
      if (t < 3.0) ballA -= (6.5 - t * 1.5) * dt;
      else if (t < DUR) {
        const k = (t - 3.0) / (DUR - 3.0); R = 0.85 - 0.23 * k;
        const diff = ((target - ballA) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        ballA += diff * Math.min(1, dt * (1.5 + k * 6)) + w * dt * k;
      } else { ballA = target; R = 0.62; }
      W.ball.position.set(W.cx + Math.cos(ballA) * R, W.by, W.cz - Math.sin(ballA) * R);
      if (t >= DUR + 0.6) { done(); return false; }
    });
  }
  function slotStopAngle(k) { return ((k + 0.5) / 22) * Math.PI * 2; }
  function v3Reels(stops, done) {
    const M = V.slots[0];
    let t = 0; const stopT = [1.1, 1.6, 2.1], stopped = [false, false, false];
    C.anim((dt) => {
      t += dt; let all = true;
      for (let r = 0; r < 3; r++) {
        if (stopped[r]) continue;
        if (t < stopT[r]) { M.reels[r].rotation.x -= dt * 13; all = false; }
        else { const cur = M.reels[r].rotation.x, target = slotStopAngle(stops[r]); M.reels[r].rotation.x = target - Math.PI * 2 * Math.ceil((target - cur) / (Math.PI * 2)); stopped[r] = true; all = false; }
      }
      if (all && t > stopT[2] + 0.1) { done(); return false; }
    });
  }

  function buildVenue(ctx, venue) {
    const g = venue.group, PAL = { wood: 0x4a2e1c, woodD: 0x33200f, brass: 0xc9a227, feltG: 0x1c6e46, wine: 0x6e1524, slot: 0x232c38 };
    V = { bj: [], rl: null, slots: [], gCards: new ctx.THREE.Group(), gChips: new ctx.THREE.Group(), npcs: [], pitBoss: null, shark: null };
    g.add(V.gCards); g.add(V.gChips);
    const lot = venue.lot;
    const hx = lot ? Math.max(5, Math.min(8, lot.w / 2 - 1.6)) : 8;
    const hz = lot ? Math.max(4, Math.min(6, lot.d / 2 - 1.6)) : 6;
    if (venue.kind === "dev") { // dev pad: the harness mounts us on bare ground
      const pad = new ctx.THREE.Mesh(new ctx.THREE.PlaneGeometry(hx * 2 + 6, hz * 2 + 6), ctx.pmat(0x451018, 4));
      pad.rotation.x = -Math.PI / 2; pad.position.y = 0.02; g.add(pad);
      ctx.light(0, 4.5, 0, 0xffca72, 1.1, 18);
    }
    const feltTex = ctx.canvasTex(512, 288, (gg) => {
      gg.fillStyle = "#1c6e46"; gg.fillRect(0, 0, 512, 288);
      gg.strokeStyle = "rgba(255,246,226,.75)"; gg.lineWidth = 2;
      gg.beginPath(); gg.arc(256, -40, 250, 0.42, Math.PI - 0.42); gg.stroke();
      gg.fillStyle = "rgba(255,246,226,.85)"; gg.font = "800 22px 'Trebuchet MS'"; gg.textAlign = "center";
      gg.fillText("BLACKJACK PAYS 3 TO 2", 256, 148);
      for (let i = 0; i < 3; i++) { gg.beginPath(); gg.arc(128 + i * 128, 232, 26, 0, 7); gg.stroke(); }
    });
    // --- two blackjack tables, dealers behind ---
    [-hx * 0.5, hx * 0.5].forEach((cx, which) => {
      const cz = -hz * 0.4;
      ctx.box(g, cx, 0.5, cz, 3.4, 0.82, 1.9, ctx.mat(PAL.wood));
      ctx.cyl(g, cx - 1.7, 0.5, cz, 0.95, 0.95, 0.82, ctx.mat(PAL.wood), 14);
      ctx.cyl(g, cx + 1.7, 0.5, cz, 0.95, 0.95, 0.82, ctx.mat(PAL.wood), 14);
      const felt = new ctx.THREE.Mesh(new ctx.THREE.PlaneGeometry(3.36, 1.82), new ctx.THREE.MeshPhongMaterial({ map: feltTex, shininess: 3 }));
      felt.rotation.x = -Math.PI / 2; felt.rotation.z = Math.PI; felt.position.set(cx, 0.925, cz); g.add(felt);
      ctx.box(g, cx, 0.98, cz - 0.99, 3.4, 0.12, 0.14, ctx.mat(PAL.wine));
      ctx.box(g, cx, 0.99, cz + 0.86, 1.5, 0.1, 0.34, ctx.mat(PAL.woodD));
      [0xc22323, 0x1c8a4e, 0x222222, 0x6a3aa0, 0xc9a227].forEach((cc, ci) => ctx.cyl(g, cx - 0.56 + ci * 0.28, 1.06, cz + 0.86, 0.09, 0.09, 0.1, ctx.mat(cc), 10));
      ctx.box(g, cx + 1.15, 1.02, cz + 0.7, 0.42, 0.18, 0.3, ctx.pmat(0x14100c, 40)).rotation.y = -0.2;
      ctx.cyl(g, cx, 0.46, cz, 0.3, 0.42, 0.92, ctx.mat(PAL.woodD), 10);
      ctx.solid(cx - 2.6, cz - 0.95, cx + 2.6, cz + 0.95);
      for (let s = -1; s <= 1; s++) {
        ctx.cyl(g, cx + s * 1.15, 0.42, cz - 1.65, 0.08, 0.1, 0.84, ctx.mat(0x22262c), 8);
        ctx.cyl(g, cx + s * 1.15, 0.88, cz - 1.65, 0.27, 0.27, 0.1, ctx.mat(PAL.wine), 10);
      }
      const T = { cx, cz, dealerSpot: [cx, 0.94, cz + 0.35], playerSpot: [cx, 0.94, cz - 0.42], splitSpot: [cx + 1.05, 0.94, cz - 0.42], betSpot: [cx, 0.94, cz - 0.72] };
      V.bj.push(T);
      castNPC(ctx, {
        // role "dealer" → the facade dresses house waiter-blacks (the vest-and-collar
        // dealer read) and pins them behind the felt, hands over the table.
        role: "dealer", name: which ? "Dealer Vega" : "Dealer Marchetti",
        at: [cx, cz + 1.05], face: Math.PI, post: "pinned", pose: "deal",
        dialogue: DEALER_LINES[which],
      }, function () {
        const dealer = ctx.rig({ shirt: 0xe8dcc0, pants: 0x14100c, skin: which ? 0x8a5c34 : 0xc2905c, vest: 0x1c6e46 }).at(cx, cz + 1.05, Math.PI).deal();
        g.add(dealer.g); ctx.idle(dealer, which * 1.7); return dealer;
      });
      ctx.zone({ id: "bj" + which, label: "Blackjack — $25 min [The Golden Ace]", pos: [cx, cz - 1.65], r: 1.7, onUse: () => { BJ.tableIx = which; BJ.phase = "bet"; renderBJ(); } });
      ctx.light(cx, 3.2, cz, 0xffca72, 0.8, 8);
    });
    // --- roulette table + wheel ---
    {
      const cx = 0, cz = hz * 0.45;
      ctx.box(g, cx, 0.5, cz, 5.0, 0.86, 2.1, ctx.mat(PAL.wood));
      ctx.box(g, cx, 0.97, cz, 5.16, 0.1, 2.26, ctx.mat(PAL.woodD));
      const wheelTex = ctx.canvasTex(512, 512, (gg) => {
        const Cc = 256, TAU = Math.PI * 2;
        gg.fillStyle = "#33200f"; gg.beginPath(); gg.arc(Cc, Cc, 254, 0, TAU); gg.fill();
        for (let i = 0; i < 37; i++) {
          const n = WHEEL_ORDER[i], a0 = (i / 37) * TAU - Math.PI / 2, a1 = ((i + 1) / 37) * TAU - Math.PI / 2;
          gg.fillStyle = n === 0 ? "#0f7a44" : (RED_SET[n] ? "#a41f2f" : "#15181d");
          gg.beginPath(); gg.moveTo(Cc, Cc); gg.arc(Cc, Cc, 236, a0, a1); gg.closePath(); gg.fill();
          const am = (a0 + a1) / 2;
          gg.save(); gg.translate(Cc + Math.cos(am) * 208, Cc + Math.sin(am) * 208); gg.rotate(am + Math.PI / 2);
          gg.fillStyle = "#fff6e2"; gg.font = "800 24px 'Trebuchet MS'"; gg.textAlign = "center"; gg.textBaseline = "middle";
          gg.fillText(String(n), 0, 0); gg.restore();
        }
        gg.fillStyle = "#2a1a0c"; gg.beginPath(); gg.arc(Cc, Cc, 150, 0, TAU); gg.fill();
        gg.fillStyle = "#c9a227"; gg.beginPath(); gg.arc(Cc, Cc, 26, 0, TAU); gg.fill();
      });
      ctx.cyl(g, cx - 1.55, 1.06, cz, 0.98, 1.06, 0.18, ctx.mat(0x2a1a0c), 24);
      const disc = new ctx.THREE.Mesh(new ctx.THREE.CircleGeometry(0.92, 37), new ctx.THREE.MeshLambertMaterial({ map: wheelTex }));
      disc.rotation.x = -Math.PI / 2; disc.position.set(cx - 1.55, 1.165, cz); g.add(disc);
      const turret = new ctx.THREE.Group(); turret.position.set(cx - 1.55, 1.17, cz); g.add(turret);
      ctx.cyl(turret, 0, 0.12, 0, 0.1, 0.14, 0.24, ctx.mat(PAL.brass), 10);
      for (let hh = 0; hh < 4; hh++) { const ha = hh * Math.PI / 2; ctx.box(turret, Math.cos(ha) * 0.17, 0.24, Math.sin(ha) * 0.17, 0.22, 0.04, 0.04, ctx.mat(PAL.brass), ha); }
      const ball = new ctx.THREE.Mesh(new ctx.THREE.SphereGeometry(0.042, 8, 8), ctx.pmat(0xf4f4f0, 80));
      ball.position.set(cx - 1.55, 1.21, cz + 0.72); g.add(ball);
      ctx.solid(cx - 2.7, cz - 1.15, cx + 2.7, cz + 1.15);
      V.rl = { disc, turret, ball, theta: 0, cx: cx - 1.55, cz, by: 1.2 };
      castNPC(ctx, {
        // role "croupier" → house waiter-blacks at the wheel (seeded appearance
        // keeps him a distinct person from the blackjack dealers across the room).
        role: "croupier", name: "Croupier Dubois",
        at: [cx, cz + 1.5], face: Math.PI, post: "pinned", pose: "deal",
        dialogue: CROUPIER_LINES,
      }, function () {
        const croup = ctx.rig({ shirt: 0xe8dcc0, pants: 0x14100c, skin: 0xd9a066, vest: 0x6e1524 }).at(cx, cz + 1.5, Math.PI).deal();
        g.add(croup.g); ctx.idle(croup, 2.4); return croup;
      });
      V.pitBoss = castNPC(ctx, {
        // role "pitboss" → charcoal exec suit (the facade's archetype path); folds
        // his arms over the pit and barks state-keyed lines (pitBossBark, below).
        role: "pitboss", name: "Mr. Calloway", post: "pinned", pose: "foldarms",
        at: [cx + 2.6, cz - 0.6], face: 2.6,
        dialogue: PITBOSS_LINES,
      }, function () {
        const boss = ctx.rig({ shirt: 0x14100c, pants: 0x14100c, skin: 0xd9a066, vest: 0x211a12, hair: 0x777c82 }).at(cx + 2.6, cz - 0.6, 2.6).fold();
        g.add(boss.g); ctx.idle(boss, 4.1); return boss;
      });
      ctx.zone({ id: "roulette", label: "European Roulette [The Golden Ace]", pos: [cx, cz - 1.9], r: 1.9, onUse: renderRL });
      ctx.light(cx, 3.3, cz, 0xffca72, 0.85, 9);
    }
    // --- slot bank (first machine drives the 3D reels) ---
    const stripTex = ctx.canvasTex(48 * 22, 96, (gg) => {
      gg.fillStyle = "#f4ead2"; gg.fillRect(0, 0, 48 * 22, 96);
      for (let i = 0; i < 22; i++) {
        const x0 = i * 48, cx2 = x0 + 24, cy = 48, s = SLOT_STRIP[i];
        gg.strokeStyle = "#d8c9a4"; gg.strokeRect(x0 + 1, 8, 46, 80);
        gg.fillStyle = { CHR: "#c22", LEM: "#e8c62c", ORN: "#e8862c", BELL: "#d9a712", BAR: "#222", SEV: "#c22", DIA: "#3ec6d9" }[s];
        if (s === "BAR" || s === "SEV") { gg.font = "800 " + (s === "BAR" ? 15 : 40) + "px Verdana"; gg.textAlign = "center"; gg.textBaseline = "middle"; gg.fillText(s === "BAR" ? "BAR" : "7", cx2, cy); }
        else if (s === "DIA") { gg.beginPath(); gg.moveTo(cx2, cy - 15); gg.lineTo(cx2 + 12, cy); gg.lineTo(cx2, cy + 15); gg.lineTo(cx2 - 12, cy); gg.closePath(); gg.fill(); }
        else { gg.beginPath(); gg.arc(cx2, cy, 12, 0, 7); gg.fill(); }
      }
    });
    for (let i = 0; i < 4; i++) {
      const sx = hx - 0.6, sz = -hz * 0.6 + i * 1.5;
      const grp = new ctx.THREE.Group(); grp.position.set(sx, 0, sz); grp.rotation.y = -Math.PI / 2; g.add(grp);
      ctx.box(grp, 0, 0.45, 0, 0.9, 0.9, 0.62, ctx.mat(PAL.slot));
      ctx.box(grp, 0, 1.32, -0.05, 0.9, 0.85, 0.52, ctx.mat(PAL.slot));
      ctx.box(grp, 0, 2.05, -0.09, 0.9, 0.3, 0.44, ctx.emat(i % 2 ? 0xff4fa3 : 0x3ec6d9, 0.8));
      const reels = [];
      for (let r = 0; r < 3; r++) {
        const reel = new ctx.THREE.Mesh(new ctx.THREE.CylinderGeometry(0.155, 0.155, 0.16, 24, 1, true), new ctx.THREE.MeshLambertMaterial({ map: stripTex }));
        reel.rotation.z = Math.PI / 2; reel.position.set(-0.2 + r * 0.2, 1.42, 0.16); grp.add(reel); reels.push(reel);
      }
      ctx.solid(sx - 0.5, sz - 0.45, sx + 0.5, sz + 0.45);
      V.slots.push({ reels });
      ctx.zone({ id: "slot" + i, label: "Lucky 7s slots [The Golden Ace]", pos: [sx - 0.9, sz], r: 1.3, onUse: renderSL });
    }
    // --- cage + shark booth ---
    {
      const cx = -hx + 0.7, cz = -hz * 0.55;
      ctx.box(g, cx + 0.6, 0.55, cz, 0.7, 1.1, 3.4, ctx.mat(PAL.wood));
      ctx.box(g, cx + 0.6, 1.13, cz, 0.86, 0.08, 3.6, ctx.mat(PAL.brass));
      for (let bz = -1.6; bz <= 1.6; bz += 0.3) { if (Math.abs(bz) < 0.5) continue; ctx.cyl(g, cx + 0.6, 1.95, cz + bz, 0.035, 0.035, 1.6, ctx.mat(PAL.brass), 8); }
      ctx.box(g, cx + 0.6, 2.8, cz, 0.16, 0.14, 3.6, ctx.mat(PAL.brass));
      ctx.solid(cx + 0.25, cz - 1.8, cx + 0.95, cz + 1.8);
      castNPC(ctx, {
        // "banker" job-hint → formal business fit (bizRecord) AND a sensible cage
        // occupation: the cage IS the house bank. Formal, distinct from floor staff.
        role: "cashier", name: "Cage — Okafor", outfit: "banker",
        at: [cx - 0.2, cz], face: Math.PI / 2, post: "pinned", pose: "stand",
        dialogue: CASHIER_LINES,
      }, function () {
        const cashier = ctx.rig({ shirt: 0xe8dcc0, pants: 0x22262c, skin: 0xd9a066, vest: 0x6e1524 }).at(cx - 0.2, cz, Math.PI / 2);
        g.add(cashier.g); ctx.idle(cashier, 1.1); return cashier;
      });
      castNPC(ctx, {
        // role "guard" → job "security guard" → Guard Blacks, which carry NO cop
        // flag (cityOutfitIsCop stays false), so he never reads as police. Watchful.
        role: "guard", name: "Security",
        at: [cx + 1.6, cz + 2.2], face: 2.4, post: "pinned", pose: "foldarms",
        dialogue: GUARD_LINES,
      }, function () {
        const guard = ctx.rig({ shirt: 0x2c3038, pants: 0x14100c, skin: 0x704c28, cap: 0x2c3038 }).at(cx + 1.6, cz + 2.2, 2.4).fold();
        g.add(guard.g); ctx.idle(guard, 3.3); return guard;
      });
      ctx.zone({ id: "cage", label: "The Cage — buy in / cash out [The Golden Ace]", pos: [cx + 1.5, cz], r: 1.6, onUse: renderCage });
      ctx.light(cx + 1, 3.0, cz, 0xffd48a, 0.8, 8);
    }
    {
      const cx = hx - 1.4, cz = hz - 0.8;
      ctx.box(g, cx, 0.3, cz + 0.5, 3.0, 0.6, 0.7, ctx.mat(PAL.wine));
      ctx.box(g, cx, 0.75, cz + 0.75, 3.0, 0.9, 0.2, ctx.mat(PAL.wine));
      ctx.cyl(g, cx, 0.5, cz - 0.4, 0.12, 0.16, 1.0, ctx.mat(PAL.woodD), 8);
      ctx.cyl(g, cx, 1.02, cz - 0.4, 0.75, 0.75, 0.08, ctx.mat(PAL.wood), 12);
      ctx.cyl(g, cx, 1.2, cz - 0.15, 0.1, 0.14, 0.24, ctx.emat(0xffab66, 0.9), 8);
      ctx.solid(cx - 1.6, cz - 0.9, cx + 1.6, cz + 0.9);
      // No `dialogue` on purpose: his [E] is the LOAN PANEL (the ctx.zone below);
      // flavor is delivered via sharkBark() when that panel opens, so the panel
      // always wins the interaction. role "shark" → the facade's high-roller look,
      // seated in the booth.
      V.shark = castNPC(ctx, {
        role: "shark", name: "The Shark", post: "pinned", pose: "sit",
        at: [cx, cz + 0.35], face: Math.PI,
      }, function () {
        const shark = ctx.rig({ shirt: 0x39424e, pants: 0x14100c, skin: 0xb87c4c, hair: 0x555a60, shades: true }).at(cx, cz + 0.35, Math.PI).sit();
        shark.g.position.y -= 0.28; g.add(shark.g); ctx.idle(shark, 5.2); return shark;
      });
      ctx.zone({ id: "shark", label: "The Shark [The Golden Ace]", pos: [cx, cz - 1.3], r: 1.5, onUse: renderShark });
      ctx.light(cx, 1.7, cz - 0.1, 0xff9a4e, 0.6, 5.5);
    }
    // --- ambient patrons: real peds milling the slots/roulette so the floor
    //     breathes. Facade-only (no dialogue, no dummy fallback) — before ctx.npc
    //     lands the floor reads exactly as today. Spawn spots sit in open aisle,
    //     clear of the table/slot/cage colliders, and scale with the lot. ---
    if (ctx.npc) {
      // role "patron", post "ambient" → real peds that mill the floor with the
      // normal ped brain (the facade dresses them in the nightlife crowd's dress/
      // suit mix — the dressed-up casino crowd). Spawn spots sit in open aisle,
      // clear of the table/slot/cage colliders, and scale with the lot.
      [
        { at: [hx * 0.7, -hz * 0.05], face: Math.PI * 0.5 },      // by the slot bank
        { at: [hx * 0.28, hz * 0.16], face: Math.PI },            // fronting the wheel
        { at: [-hx * 0.28, -hz * 0.04], face: -Math.PI * 0.5 },   // open floor between tables
      ].forEach((p) => castNPC(ctx, { role: "patron", at: p.at, face: p.face, post: "ambient" }, null));
    }
  }

  /* ======================= REGISTER ======================================= */
  CBZ.CONFIG = CBZ.CONFIG || {};
  if (CBZ.CONFIG.PKG_CASINO == null) CBZ.CONFIG.PKG_CASINO = true;
  CBZ.games.register({
    id: "casino", title: "THE GOLDEN ACE",
    venue: { lotKind: "casino" },
    build(ctx, venue) { C = C || ctx; buildVenue(ctx, venue); buildShoe(); },
    update() {},
    api: {
      rules: { handValue, settleBJ, rlPayout, slotPay, slotRTP, wheel: WHEEL_ORDER, red: RED_SET, strip: SLOT_STRIP },
      open: () => { if (C) openHub(); },
      state: () => (S ? JSON.parse(JSON.stringify(S)) : null),
      // roster of the flagship cast (real peds via ctx.npc, or rig fallbacks) —
      // exposed for tools/probes to assert the cast built.
      cast: () => (V && V.npcs ? V.npcs.length : 0),
      bj: BJ, rl: RL, sl: SL,
    },
  });

  /* every OTHER casino's tables (city/casino.js zone -> cityOpenCasino) now
     open the package hub instead of the old activities.js menu casino. */
  const prevOpen = CBZ.cityOpenCasino || null;
  function wrapOpen() {
    if (!CBZ.cityOpenCasino || CBZ.cityOpenCasino._pkgWrapped) return;
    const inner = CBZ.cityOpenCasino;
    const wrapped = function () {
      if (CBZ.CONFIG.PKG_CASINO === false) { if (inner) inner.apply(this, arguments); return; }
      C = C || CBZ.games.hubCtx("casino");
      openHub();
    };
    wrapped._pkgWrapped = true;
    CBZ.cityOpenCasino = wrapped;
  }
  if (prevOpen) wrapOpen();
  // activities.js may define cityOpenCasino after us — cheap per-frame retry until wrapped
  if (CBZ.onUpdate && CBZ.PRIO) CBZ.onUpdate(CBZ.PRIO.after(CBZ.PRIO.LATE, 5), wrapOpen);
})();
