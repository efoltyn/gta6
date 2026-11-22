/* ============================================================
   games/casino.js — THE GOLDEN ACE, as a GAME PACKAGE.

   The reference package for core/packages.js: proves a whole venue
   game can live on the engine with zero engine forks. The standalone
   design draft (games/casino.html) was deleted 2026-09-27; its rules
   and math live on here, and THIS file is what ships in the city. Rules are identical:
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
   NO PANEL. You play standing at the thing: a table or a machine is a
   STATION with its verbs on it (deal, hit, stand, a bet on red, pull), the
   dealer is a person who says the count, your bet is chips on the felt and
   your stack sits by your hand. Every town casino's tables and machines
   (city/casino.js) are stations of this same game. The cage and the Shark
   are people you ask.
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
  let C = null;          // ctx: the flagship's once it is built, a venue-less one before that
  let V = null;          // flagship venue 3D refs {bj:[], rl, slots:[], npcs, cast}
  let S = null;          // persisted bag: {chips, debt, streak, stats}
  const THREE = window.THREE;
  function ctx() { return C || (C = CBZ.games.hubCtx("casino")); }
  function bag() {
    if (S) return S;
    S = ctx().state(() => ({ chips: 0, debt: 0, streak: 0, stats: { hands: 0, spins: 0, pulls: 0, biggestWin: 0, drinks: 0 } }));
    return S;
  }
  function save() { ctx().saveState(); }
  function fmt(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function cash() { return (CBZ.game && CBZ.game.cash) || 0; }
  function winStreak(profit) {
    const s = bag();
    if (profit > 0) { s.streak++; if (profit > s.stats.biggestWin) s.stats.biggestWin = profit; if (s.streak === LIMITS.COMP_STREAK) pitBossBark("hot"); }
    else if (profit < 0) s.streak = 0;
    save();
  }
  function bustWatch() {
    const s = bag();
    if (s.chips >= 5 || cash() >= 15) return;
    pitBossBark("cold");
  }
  // a label that prints as written (city/verbword.js would cut it to its verb)
  function asIs(s) { const VW = CBZ.cityVerbWord; if (VW && VW.keep) VW.keep(s); return s; }

  /* ======================= STATIONS =======================================
     OWNER: "No dashboards are needed. Everything can be existing."

     This game used to be played in an HTML panel at the bottom of the screen
     (a "floor" hub of buttons, a blackjack panel of +$5 / DEAL / HIT pills, a
     37-cell roulette grid of spans, a slots panel, a cage panel, a loan
     panel). The cards, chips, wheel and reels were already real; only the
     player's hands were on a panel. Now a STATION is a thing on a casino
     floor you stand at: a blackjack table, a roulette table, a slot machine.
     What you can do there is on the thing itself (city/interactions.js: E,
     I J K L, the wheel, a tap), the dealer says the count out loud, your
     bet is chips on the felt, and what you have left is the stack in front
     of you.

     A station: { kind "bj"|"rl"|"sl", x, y (floor), z, yaw, lot?, cast?,
     wheel?, reels? }. yaw's local +Z is the players' side (the fixture frame
     city/casino.js builds every table in), so one set of felt coordinates
     serves the Golden Ace and every town casino. */
  const STATIONS = [];                    // the flagship's (town ones live on city/casino.js's records)
  const NAME = { bj: "Blackjack", rl: "Roulette", sl: "Lucky 7s" };
  const STAND = { bj: 1.3, rl: 1.5, sl: 0.8 };    // how far out on the players' side you stand
  const REACH = { bj: 1.6, rl: 1.8, sl: 0.7 };
  function w2(st, lx, lz) { const c = Math.cos(st.yaw), s = Math.sin(st.yaw); return { x: st.x + lx * c + lz * s, z: st.z - lx * s + lz * c }; }
  function prep(st) {
    if (st._prep) return st;
    st._prep = true;
    const p = w2(st, 0, STAND[st.kind]);
    st.sx = p.x; st.sz = p.z;
    st.pos = { x: st.x, y: st.y + (st.kind === "sl" ? 1.3 : 1.0), z: st.z };   // where its card hangs
    return st;
  }
  function stationAt(px, pz, py) {
    let best = null, bd = 1e9;
    const scan = function (list) {
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const st = prep(list[i]);
        if (Math.abs(st.y - py) > 2.2) continue;
        const r = REACH[st.kind], dx = st.sx - px, dz = st.sz - pz, d = dx * dx + dz * dz;
        if (d < r * r && d < bd) { bd = d; best = st; }
      }
    };
    scan(STATIONS); scan(CBZ._casinoTables); scan(CBZ._casinoSlots);
    return best;
  }
  // the thing a round's cards and chips are laid on: a group in the table's own frame
  function stGroup(st) {
    const root = CBZ.scene;
    if (st.grp && st.grp.parent === root) return st.grp;
    st.grp = new THREE.Group(); st.grp.name = "casino-play";
    st.grp.position.set(st.x, st.y, st.z); st.grp.rotation.y = st.yaw;
    st.cards = new THREE.Group(); st.chips = new THREE.Group(); st.rack = new THREE.Group();
    st.grp.add(st.cards); st.grp.add(st.chips); st.grp.add(st.rack);
    st.dolly = null; st.face = null;
    root.add(st.grp);
    return st.grp;
  }
  function empty(grp) {
    if (!grp) return;
    while (grp.children.length) { const m = grp.children[0]; grp.remove(m); if (m.material && m.material._own) m.material.dispose(); }
  }
  function stDrop(st) {
    if (!st.grp) return;
    empty(st.cards); empty(st.chips); empty(st.rack);
    if (st.face) { st.face.tex.dispose(); st.face.m.material.dispose(); st.face.m.geometry.dispose(); }
    if (st.grp.parent) st.grp.parent.remove(st.grp);
    st.grp = st.cards = st.chips = st.rack = st.dolly = st.face = null;
  }

  /* ---- who is working the table ---- */
  function staffPed(x, z, re, r) {
    const peds = CBZ.cityPeds || [];
    let best = null, bd = r * r;
    for (let i = 0; i < peds.length; i++) {
      const p = peds[i];
      if (!p || p.dead || (p.ko || 0) > 0 || !p.pos || !re.test(String(p.job || ""))) continue;
      const dx = p.pos.x - x, dz = p.pos.z - z, d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  function scared(p) { return !!(p && (p.dead || p.surrender || p.poseHandsUp || p.rage || p._keepFree || p.state === "flee")); }
  // the person dealing at this table right now (null: nobody, so no game). A
  // town table's croupier is a posted body found by where he stands; looked
  // up at most twice a second.
  function dealerOf(st) {
    if (st.kind === "sl") return null;
    if (st.cast) {
      const h = V && V.cast && V.cast[st.cast];
      return h && !scared(h.ped) ? h : null;
    }
    const t = (CBZ.now || 0);
    if (st._dealAt != null && t - st._dealAt < 500) return st._deal;
    const d = w2(st, 0, st.kind === "rl" ? -0.95 : -0.85);
    const p = staffPed(d.x, d.z, /croupier|dealer/i, 2.2);
    st._dealAt = t; st._deal = p && !scared(p) ? p : null;
    return st._deal;
  }
  function sayOf(who, line, secs) {
    if (!who || !line) return;
    if (typeof who.say === "function") { who.say(line, secs || 2.8); return; }
    if (CBZ.citySay) { try { CBZ.citySay(who, line, null, { secs: secs || 2.8, force: true }); } catch (e) {} }
  }
  function tell(st, line, secs) { if (st) sayOf(dealerOf(st), line, secs); }
  function staffSay(tag, line) { sayOf(V && V.cast && V.cast[tag], line, 2.8); }

  /* ======================= BLACKJACK ====================================== */
  const SUITS = ["♠", "♥", "♦", "♣"];
  const CARD_WORD = { A: "an ace", 2: "a two", 3: "a three", 4: "a four", 5: "a five", 6: "a six", 7: "a seven", 8: "an eight", 9: "a nine", 10: "a ten", J: "a jack", Q: "a queen", K: "a king" };
  const STAKES = [25, 50, 100, 250, 500, 1000];
  let SHOE = [];
  function buildShoe() {
    SHOE = [];
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    for (let d = 0; d < 6; d++) for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) SHOE.push({ r: ranks[r], s });
    for (let i = SHOE.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = SHOE[i]; SHOE[i] = SHOE[j]; SHOE[j] = t; }
  }
  function draw() { if (SHOE.length < 78) { buildShoe(); tell(BJ.st, "Fresh shoe."); } return SHOE.pop(); }
  // phase: bet (nothing dealt) | deal (cards in the air) | player | dealer | done
  const BJ = { phase: "bet", st: null, hands: [], act: 0, dealer: [], dealerMeshes: [], stake: LIMITS.BJ_MIN, splitDone: false };
  function bjIdle() { return BJ.phase === "bet" || BJ.phase === "done"; }
  function bjTurn(st) { return BJ.st === st && BJ.phase === "player"; }
  function bjHand() { return BJ.hands[BJ.act]; }
  function handWord(cards) { const hv = handValue(cards); return (hv.soft && hv.v < 21 ? "soft " : "") + hv.v; }
  function stakeStep(dir) {
    const i = STAKES.indexOf(BJ.stake), cap = Math.min(LIMITS.BJ_MAX, bag().chips);
    if (dir > 0) { for (let k = Math.max(0, i + 1); k < STAKES.length; k++) if (STAKES[k] > BJ.stake) return STAKES[k] <= cap ? STAKES[k] : BJ.stake; return BJ.stake; }
    for (let k = STAKES.length - 1; k >= 0; k--) if (STAKES[k] < BJ.stake) return STAKES[k];
    return BJ.stake;
  }
  function bjDeal(st) {
    const s = bag();
    if (!bjIdle()) return;
    if (BJ.st && BJ.st !== st) clearRound(BJ.st);
    BJ.st = st;
    if (s.chips < BJ.stake) {
      if (s.chips >= LIMITS.BJ_MIN) { BJ.stake = stakeStep(-1); tell(st, "You haven't the chips for that. " + fmt(BJ.stake) + "?"); }
      else tell(st, "Chips play here. The cage sells them.");
      return;
    }
    s.chips -= BJ.stake; save();
    BJ.phase = "deal"; BJ.act = 0; BJ.splitDone = false;
    BJ.hands = [{ cards: [], bet: BJ.stake, done: false, meshes: [] }];
    BJ.dealer = []; BJ.dealerMeshes = [];
    clearRound(st);
    BJ.hands[0].cards.push(draw()); putCard(st, 0, BJ.hands[0].cards[0], true, 60);
    BJ.dealer.push(draw()); putCard(st, "D", BJ.dealer[0], true, 340);
    BJ.hands[0].cards.push(draw()); putCard(st, 0, BJ.hands[0].cards[1], true, 620);
    BJ.dealer.push(draw()); putCard(st, "D", BJ.dealer[1], false, 900);
    betChips(st, BJ.stake); rack(st);
    s.stats.hands++;
    setTimeout(() => {
      if (BJ.st !== st || BJ.phase !== "deal") return;
      const up = BJ.dealer[0], upTen = handValue([up]).v === 10 || up.r === "A";
      if (upTen && isNatural(BJ.dealer)) { bjFinish(true, false, true); return; }
      if (isNatural(BJ.hands[0].cards)) { bjFinish(false, false, true); return; }
      BJ.phase = "player";
      tell(st, "You have " + handWord(BJ.hands[0].cards) + ". I'm showing " + CARD_WORD[up.r] + ".");
    }, 1150);
  }
  function bjHit() {
    const st = BJ.st, h = bjHand(); if (!h || BJ.phase !== "player") return;
    h.cards.push(draw()); putCard(st, BJ.act, h.cards[h.cards.length - 1], true, 0);
    const v = handValue(h.cards).v;
    if (v > 21) { tell(st, v + ". Too many."); h.done = true; bjNext(); }
    else tell(st, handWord(h.cards) + ".");
  }
  function bjStand() { if (BJ.phase !== "player") return; bjHand().done = true; bjNext(); }
  function canDouble() { const h = bjHand(); return !!h && h.cards.length === 2 && bag().chips >= h.bet; }
  function bjDouble() {
    const s = bag(), h = bjHand();
    if (BJ.phase !== "player" || !canDouble()) return;
    s.chips -= h.bet; h.bet *= 2; save();
    betChips(BJ.st, BJ.hands.reduce((a, x) => a + x.bet, 0)); rack(BJ.st);
    h.cards.push(draw()); putCard(BJ.st, BJ.act, h.cards[h.cards.length - 1], true, 0);
    tell(BJ.st, "Doubled. " + handValue(h.cards).v + ".");
    h.done = true; BJ.phase = "deal"; setTimeout(function () { BJ.phase = "player"; bjNext(); }, 400);
  }
  function canSplit() {
    const h = BJ.hands[0];
    return !!h && !BJ.splitDone && BJ.hands.length === 1 && h.cards.length === 2 &&
      handValue([h.cards[0]]).v === handValue([h.cards[1]]).v && bag().chips >= h.bet;
  }
  function bjSplit() {
    const s = bag(), h = BJ.hands[0], st = BJ.st;
    if (BJ.phase !== "player" || !canSplit()) return;
    s.chips -= h.bet; save(); BJ.splitDone = true;
    const moved = h.cards.pop();
    BJ.hands.push({ cards: [moved], bet: h.bet, done: false, meshes: [] });
    splitCard(st);
    betChips(st, h.bet * 2); rack(st);
    const aces = h.cards[0].r === "A";
    BJ.phase = "deal";
    [0, 1].forEach((hi) => {
      setTimeout(() => { const hh = BJ.hands[hi]; hh.cards.push(draw()); putCard(st, hi, hh.cards[1], true, 0); if (aces) hh.done = true; }, 350 + hi * 350);
    });
    setTimeout(() => {
      BJ.phase = "player";
      if (aces) bjNext(); else { BJ.act = 0; tell(st, "Two hands. First one, " + handWord(BJ.hands[0].cards) + "."); }
    }, 1100);
  }
  function bjNext() {
    if (BJ.act < BJ.hands.length - 1 && !BJ.hands[BJ.act + 1].done) {
      BJ.act++;
      tell(BJ.st, "Second hand, " + handWord(bjHand().cards) + ".");
      return;
    }
    const anyLive = BJ.hands.some((h) => handValue(h.cards).v <= 21);
    bjFinish(false, !anyLive, false);
  }
  function bjFinish(dealerNatural, allBusted, skipDraw) {
    const st = BJ.st;
    BJ.phase = "dealer";
    turnHole();
    let delay = 700;
    if (!dealerNatural && !allBusted && !skipDraw) {
      (function loop() {
        if (handValue(BJ.dealer).v < 17) {
          setTimeout(() => { BJ.dealer.push(draw()); putCard(st, "D", BJ.dealer[BJ.dealer.length - 1], true, 0); loop(); }, delay);
          delay = 560; return;
        }
        setTimeout(bjSettle, delay + 260);
      })();
    } else setTimeout(bjSettle, 820);
  }
  function bjSettle() {
    const st = BJ.st;
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
      else if (naturalOK && isNatural(h.cards) && !isNatural(BJ.dealer)) tag = "Blackjack, pays three to two";
      else if (isNatural(BJ.dealer) && !isNatural(h.cards)) tag = "dealer has blackjack";
      else if (dv > 21) tag = "dealer busts on " + dv;
      else tag = pv > dv ? pv + " beats " + dv : (pv === dv ? "push on " + pv : dv + " beats " + pv);
      lines.push((BJ.hands.length > 1 ? (i ? "Second hand, " : "First hand, ") : "") + tag);
    });
    s.chips += totalRet;
    const profit = totalRet - totalBet;
    winStreak(profit); save();
    let line = lines.join(". ") + ".";
    line = line.charAt(0).toUpperCase() + line.slice(1);
    if (totalRet > 0 && profit !== 0) line += " " + fmt(totalRet) + " to you.";
    tell(st, line, 3.4);
    // the bet leaves the spot: paid into your stack, or raked
    if (st && st.chips) empty(st.chips);
    rack(st);
    if (CBZ.sfx && profit > 0) CBZ.sfx("coin");
    bustWatch();
  }

  /* ======================= ROULETTE ======================================= */
  const RL = { st: null, bets: {}, unit: 25, num: 17, spinning: false, hist: [] };
  const UNITS = [5, 25, 100];
  function rlStake() { let s = 0; for (const k in RL.bets) s += RL.bets[k]; return s; }
  function rlPlace(st, key) {
    if (RL.spinning) return;
    if (RL.st !== st) {
      if (RL.st && rlStake()) { tell(st, "You've money down at another wheel."); return; }
      RL.st = st;
    }
    const s = bag(), amt = Math.min(RL.unit, s.chips);
    if (amt <= 0) { tell(st, "No chips, no bet. The cage sells them."); return; }
    if (rlStake() + amt > LIMITS.RL_MAX) { tell(st, "Table limit is $" + LIMITS.RL_MAX + "."); return; }
    s.chips -= amt; RL.bets[key] = (RL.bets[key] || 0) + amt; save();
    layoutChips(st); rack(st);
    if (CBZ.sfx) CBZ.sfx("coin");
  }
  function rlClear(st) {
    if (RL.spinning || RL.st !== st || !rlStake()) return;
    bag().chips += rlStake(); RL.bets = {}; save();
    layoutChips(st); rack(st);
  }
  function rlSpin(st) {
    if (RL.spinning || RL.st !== st) return;
    if (!rlStake()) { tell(st, "Place your bets."); return; }
    RL.spinning = true; bag().stats.spins++; save();
    tell(st, "No more bets.");
    if (st.dolly) st.dolly.visible = false;
    const outcome = Math.floor(Math.random() * 37);
    spinWheel(st, outcome, () => rlSettle(st, outcome));
  }
  function rlSettle(st, n) {
    const s = bag(), stake = rlStake(), ret = rlPayout(RL.bets, n);
    s.chips += ret; RL.bets = {};
    const profit = ret - stake;
    RL.hist.unshift(n); if (RL.hist.length > 9) RL.hist.pop();
    winStreak(profit); save();
    tell(st, n + (n === 0 ? ", green" : (RED_SET[n] ? ", red" : ", black")) + "." + (ret > 0 ? " Paying " + fmt(ret) + "." : ""), 3.2);
    RL.spinning = false;
    layoutChips(st); placeDolly(st, n); rack(st);
    if (CBZ.sfx && ret > 0) CBZ.sfx("coin");
    bustWatch();
  }

  /* ======================= SLOTS ========================================== */
  const SL = { st: null, bet: 5, spinning: false, last: null };
  function slPull(st) {
    if (SL.spinning) return;
    const s = bag();
    SL.st = st;
    if (s.chips < SL.bet) { SL.last = null; slotFace(st, "NO CREDIT"); if (CBZ.sfx) CBZ.sfx("empty"); return; }
    s.chips -= SL.bet; s.stats.pulls++; save();
    SL.spinning = true; SL.last = null; slotFace(st);
    const stops = [Math.floor(Math.random() * 22), Math.floor(Math.random() * 22), Math.floor(Math.random() * 22)];
    spinReels(st, stops, () => slSettle(st, stops));
  }
  function slSettle(st, stops) {
    const s = bag(), syms = stops.map((k) => SLOT_STRIP[k]);
    const mult = slotPay(syms[0], syms[1], syms[2]), win = mult * SL.bet;
    SL.last = { syms, win };
    if (win > 0) { s.chips += win; if (CBZ.sfx) CBZ.sfx("coin"); }
    winStreak(win - SL.bet); save();
    SL.spinning = false;
    slotFace(st);
    bustWatch();
  }

  /* ======================= THE CAGE, THE SHARK ============================
     The cashier is a person behind bars and glass; the Shark is a man in a
     booth. What they do for you is asked of them. */
  function handed(who, then) {
    const p = who && who.ped ? who.ped : (who && who.pos && who.char ? who : null), Vb = CBZ.verbs;
    let S0 = null, done = false;
    const fin = function () { if (done) return; done = true; then(); };
    if (p && Vb && Vb.takeFrom) { try { S0 = Vb.takeFrom(CBZ.player, p, { at: "wristR", kind: "cash", pose: "card", dur: 0.55, onTaken: fin }); } catch (e) { S0 = null; } }
    if (!S0) fin();
  }
  function cageBuy(who, n) {
    if (!ctx().wallet.spend(n)) { sayOf(who, "That's " + fmt(n) + ". You're short."); return false; }
    sayOf(who, fmt(n) + " in chips. Good luck.");
    handed(who, function () { bag().chips += n; save(); if (CBZ.sfx) CBZ.sfx("coin"); });
    return true;
  }
  function cageOut(who) {
    const s = bag(); let amt = s.chips;
    if (amt <= 0) { sayOf(who, "You've nothing to cash."); return false; }
    s.chips = 0;
    const toShark = Math.min(amt, s.debt);
    if (toShark > 0) { s.debt -= toShark; amt -= toShark; }
    save();
    sayOf(who, toShark > 0 ? fmt(toShark) + " goes to the Shark's marker first." + (amt > 0 ? " " + fmt(amt) + " is yours." : "") : fmt(amt) + ". Count it in front of me.", 3.2);
    if (amt > 0) handed(who, function () { ctx().wallet.give(amt); if (CBZ.sfx) CBZ.sfx("coin"); });
    return true;
  }
  const CAGE_BUYS = [100, 500, 2500];
  // (id, label(), show(), run(who)) for whoever is behind a cage: the flagship's
  // cashier (a zone on her window) and a town casino's clerk (his counter rows)
  const CAGE_ASKS = CAGE_BUYS.map(function (n) {
    return { id: "buy" + n, label: function () { return "Buy " + fmt(n) + " in chips"; }, show: function () { return cash() >= n; }, run: function (who) { cageBuy(who, n); } };
  }).concat([
    { id: "cashout", label: function () { return "Cash out " + fmt(bag().chips); }, show: function () { return bag().chips > 0; }, run: function (who) { cageOut(who); } },
  ]);
  const SHARK = { askedAt: -1e9 };
  function sharkAsk() {
    const s = bag();
    if (s.debt > 0) { sharkSay("You still owe me " + fmt(s.debt) + ". Pay at the cage, then we talk."); return; }
    SHARK.askedAt = CBZ.now || 0;
    sharkSay("I'll front you " + LIMITS.LOAN_GIVE + " in chips. You owe me " + fmt(LIMITS.LOAN_OWE) + ".");
  }
  function sharkOffered() { return bag().debt <= 0 && (CBZ.now || 0) - SHARK.askedAt < 25000; }
  function sharkTake() {
    const s = bag();
    if (!sharkOffered()) return;
    SHARK.askedAt = -1e9;
    sharkSay("Don't make me come find you.");
    handed(V && V.shark, function () { s.chips += LIMITS.LOAN_GIVE; s.debt += LIMITS.LOAN_OWE; save(); });
  }

  /* ======================= THE VERBS ON A STATION =========================
     One zone for every table and machine on every floor. Its target is the
     station you are standing at; each verb says which kind it belongs to. */
  function chipsNote() {
    const s = bag();
    return (s.chips > 0 ? fmt(s.chips) + " in chips" : "no chips") + (s.debt > 0 ? ", " + fmt(s.debt) + " owed" : "");
  }
  // every verb of every kind of station: { kind, id, label(st), show(st), run(st), key }
  // key: "e" | "hold" (hold E) | "wheel" on the table itself; on the dealer
  // (a person: I J K L in this order) the same verbs, best first.
  const VERBS = [];
  (function () {
    const add = function (kind, id, key, label, show, run) { VERBS.push({ kind: kind, id: id, key: key, label: label, show: show, run: run }); };
    const open = function (st) { return !!dealerOf(st); };
    // ---- blackjack
    add("bj", "deal", "e", function (st) { return (BJ.phase === "done" && BJ.st === st ? "Same again, " : "Deal me in, ") + fmt(BJ.stake); },
      function (st) { return bjIdle() && open(st); }, bjDeal);
    add("bj", "more", "hold", function () { return "Bet " + fmt(stakeStep(1)); }, function (st) { return bjIdle() && open(st) && stakeStep(1) > BJ.stake; }, function () { BJ.stake = stakeStep(1); });
    add("bj", "less", "wheel", function () { return "Bet " + fmt(stakeStep(-1)); }, function (st) { return bjIdle() && open(st) && stakeStep(-1) < BJ.stake; }, function () { BJ.stake = stakeStep(-1); });
    add("bj", "hit", "e", function () { return "Hit"; }, bjTurn, bjHit);
    add("bj", "stand", "hold", function () { return "Stand"; }, bjTurn, bjStand);
    add("bj", "double", "wheel", function () { const h = bjHand(); return "Double down, " + fmt(h ? h.bet : 0) + " more"; }, function (st) { return bjTurn(st) && canDouble(); }, bjDouble);
    add("bj", "split", "wheel", function () { return "Split them"; }, function (st) { return bjTurn(st) && canSplit(); }, bjSplit);
    // ---- roulette
    const rlOpen = function (st) { return !RL.spinning && open(st); };
    const down = function (st) { return RL.st === st && rlStake() > 0; };
    add("rl", "spin", "e", function () { return "Spin it, " + fmt(rlStake()) + " down"; }, function (st) { return rlOpen(st) && down(st); }, rlSpin);
    const bet = function (id, key, slot, words) {
      add("rl", id, slot, function () { return fmt(RL.unit) + " on " + (typeof words === "function" ? words() : words); },
        slot === "e" ? function (st) { return rlOpen(st) && !down(st); } : (id === "red2" ? function (st) { return rlOpen(st) && down(st); } : rlOpen),
        function (st) { rlPlace(st, typeof key === "function" ? key() : key); });
    };
    bet("red", "red", "e", "red"); bet("black", "black", "hold", "black");
    bet("red2", "red", "wheel", "red"); bet("odd", "odd", "wheel", "odd"); bet("even", "even", "wheel", "even");
    bet("num", function () { return "n" + RL.num; }, "wheel", function () { return "number " + RL.num; });
    add("rl", "other", "wheel", function () { return "Another number"; }, rlOpen, function () { RL.num = (RL.num + 1 + Math.floor(Math.random() * 35)) % 37; });
    bet("low", "low", "wheel", "1 to 18"); bet("high", "high", "wheel", "19 to 36");
    bet("dz1", "dz1", "wheel", "the first dozen"); bet("dz2", "dz2", "wheel", "the second dozen"); bet("dz3", "dz3", "wheel", "the third dozen");
    add("rl", "unit", "wheel", function () { return "Play " + fmt(UNITS[(UNITS.indexOf(RL.unit) + 1) % UNITS.length]) + " chips"; }, rlOpen,
      function () { RL.unit = UNITS[(UNITS.indexOf(RL.unit) + 1) % UNITS.length]; });
    add("rl", "clear", "wheel", function () { return "Take the bets back"; }, function (st) { return rlOpen(st) && down(st); }, rlClear);
    // ---- slots
    add("sl", "pull", "e", function () { return "Pull, " + fmt(SL.bet); }, function () { return !SL.spinning; }, slPull);
    add("sl", "bet", "hold", function () { const b = LIMITS.SLOT_BETS; return "Play " + fmt(b[(b.indexOf(SL.bet) + 1) % b.length]) + " a pull"; },
      function () { return !SL.spinning; }, function (st) { const b = LIMITS.SLOT_BETS; SL.bet = b[(b.indexOf(SL.bet) + 1) % b.length]; SL.st = st; slotFace(st); });
  })();
  let wired = false;
  function wire() {
    const I = CBZ.interactions;
    if (wired || !I || !I.registerZone) return;
    wired = true;
    I.registerZone({
      id: "casino-play", kind: "casinoplay", prio: 9, driving: false,
      find: function (px, pz, c) {
        const py = c && c.pos ? c.pos.y : ((CBZ.player && CBZ.player.pos.y) || 0);
        return stationAt(px, pz, py);
      },
      options: VERBS.map(function (v, i) {
        const o = { id: "casino-" + v.kind + "-" + v.id, prio: 30 - i * 0.1, forceYes: true, campaignSafe: true,
          label: function (st) { return asIs(v.label(st)); },
          canShow: function (st) { return st.kind === v.kind && v.show(st); },
          onSelect: function (st) { v.run(st); } };
        if (v.key === "e") o.slot = "e";
        else if (v.key === "hold") { o.slot = "e"; o.hold = true; }
        else o.wheel = true;
        return o;
      }),
    });
    if (I.describe) I.describe("casinoplay", function (st) { return { label: NAME[st.kind] || "Table", note: chipsNote() }; });
  }
  // THE DEALER TAKES THE SAME WORDS. A person's options are I J K L on him, so
  // looking at the dealer you say Hit / Stand / Double to HIM; looking at the
  // felt, E hits and hold E stands. Hung on the man himself (registerFor) the
  // first time you sit at his table.
  function dealerBody(st) { const d = st ? dealerOf(st) : null; return d ? (d.ped || (d.pos && d.char ? d : null)) : null; }
  function giveDealerVerbs(st) {
    const I = CBZ.interactions, p = dealerBody(st);
    if (!p || p._casinoVerbs || !I || !I.registerFor) return;
    p._casinoVerbs = true;
    let n = 0;
    VERBS.forEach(function (v) {
      if (v.kind !== st.kind || v.id === "red2") return;
      I.registerFor(p, {
        id: "casino-dealer-" + v.kind + "-" + v.id, prio: 90 - (n++), forceYes: true, campaignSafe: true,
        label: function () { return asIs(v.label(liveSt)); },
        canShow: function () { return !!liveSt && liveSt.kind === v.kind && dealerBody(liveSt) === p && v.show(liveSt); },
        onSelect: function () { if (liveSt) v.run(liveSt); },
      });
    });
  }
  // THE CASHIER AND THE SHARK ARE PEOPLE: what you ask of them is on them (a
  // person in front of you is the card's target before any spot on the floor
  // is), as well as on the window and the booth.
  function giveCastVerbs() {
    const I = CBZ.interactions;
    if (!V || !I || !I.registerFor) return;
    const cashier = V.cast && V.cast.cashier && V.cast.cashier.ped;
    if (cashier && !cashier._casinoVerbs) {
      cashier._casinoVerbs = true;
      CAGE_ASKS.forEach(function (a, i) {
        I.registerFor(cashier, { id: "casino-cashier-" + a.id, prio: 90 - i, forceYes: true, campaignSafe: true,
          label: function () { return asIs(a.label()); }, canShow: function () { return !scared(cashier) && a.show(); },
          onSelect: function () { a.run(V && V.cast && V.cast.cashier); } });
      });
    }
    const shark = V.shark && V.shark.ped;
    if (shark && !shark._casinoVerbs) {
      shark._casinoVerbs = true;
      I.registerFor(shark, { id: "casino-shark-take", prio: 91, forceYes: true, campaignSafe: true,
        label: function () { return asIs("Take his marker, " + fmt(LIMITS.LOAN_GIVE) + " in chips"); }, canShow: sharkOffered, onSelect: sharkTake });
      I.registerFor(shark, { id: "casino-shark-ask", prio: 90, forceYes: true, campaignSafe: true,
        label: function () { return asIs("Ask him for a marker"); }, canShow: function () { return !sharkOffered(); }, onSelect: sharkAsk });
    }
  }
  // a town casino's cashier is the clerk behind its counter (city/shops.js rows)
  (CBZ._counterAsks || (CBZ._counterAsks = [])).push(function (v, lot, kind, add) {
    if (kind !== "casino") return;
    for (let i = 0; i < CAGE_ASKS.length; i++) {
      const a = CAGE_ASKS[i];
      if (a.show()) add("cage-" + a.id, a.label(), function (vv) { a.run(vv); });
    }
  });
  // your stack is on the felt while you are at a table; a floor you have
  // walked away from keeps nothing of yours on it
  let liveSt = null, tickT = 0;
  if (CBZ.onUpdate) CBZ.onUpdate(41.3, function (dt) {
    const g = CBZ.game, P = CBZ.player;
    if (!g || g.mode !== "city" || !P || !P.pos) { if (liveSt) { stDrop(liveSt); liveSt = null; } return; }
    wire();
    tickT -= dt; if (tickT > 0) return;
    tickT = 0.3;
    giveCastVerbs();
    const at = P.driving ? null : stationAt(P.pos.x, P.pos.z, P.pos.y);
    if (at && at !== liveSt) {
      const busy = liveSt && ((BJ.st === liveSt && !bjIdle()) || (RL.st === liveSt && (RL.spinning || rlStake() > 0)) || (SL.st === liveSt && SL.spinning));
      if (liveSt && !busy) { if (BJ.st === liveSt) { BJ.phase = "bet"; BJ.st = null; } stDrop(liveSt); liveSt = null; }
      if (!liveSt) { liveSt = at; stGroup(at); if (at.kind === "sl") slotFace(at); else { rack(at); giveDealerVerbs(at); } }
    } else if (at && at === liveSt && at.kind !== "sl") {
      giveDealerVerbs(at);
    } else if (!at && liveSt) {
      const far = Math.hypot(P.pos.x - liveSt.x, P.pos.z - liveSt.z) > 7;
      const busy = (BJ.st === liveSt && !bjIdle()) || (RL.st === liveSt && RL.spinning) || (SL.st === liveSt && SL.spinning);
      if (far && !busy) {
        // bets left on a wheel you walked away from come back to your stack
        if (RL.st === liveSt && rlStake() > 0) { bag().chips += rlStake(); RL.bets = {}; save(); }
        if (BJ.st === liveSt) { BJ.phase = "bet"; BJ.st = null; }
        stDrop(liveSt); liveSt = null;
      }
    }
  });

  /* ======================= THE CAST (real city peds) ===================== */
  /* Every dealer/croupier/cashier/guard/pit boss/shark/patron is a REAL city
     ped (the ones that put their hands up at gunpoint) requested via ctx.npc —
     role, role-relevant outfit, and in-world dialogue. If the engine facade
     hasn't landed yet, each call falls back to today's package-local rig at the
     SAME spot/pose so the venue still boots clean (Rule 1: backward-tolerant).
     Handles are parked on V.npcs so refs don't leak; teardown is engine-side.

     SPAWN TIMING: real peds need the LIVE arena (brain, gunpoint, death funnel),
     but a package builds at order 88 — during world-geometry assembly, BEFORE
     the arena root is published — so a build-time ctx.npc would fall back to a
     brainless dummy. So we QUEUE the cast at build and DRAIN it once the sim is
     live: on the first update() tick, or right away if the arena is already up
     (a world rebuild) or there's no facade at all (a bare harness → rig dummy). */
  function castNPC(ctx, spec, fallback) {
    const h = ctx.npc ? ctx.npc(spec) : (fallback ? fallback() : null);
    if (h && V && V.npcs) V.npcs.push(h);
    return h;
  }
  function arenaLive() { return !!(CBZ.city && CBZ.city.arena && CBZ.city.arena.root); }
  function queueCast(spec, fallback, tag) { if (V && V.pendingCast) V.pendingCast.push({ spec: spec, fallback: fallback, tag: tag }); }
  function drainCast(ctx) {
    if (!V || !V.pendingCast) return;
    const pend = V.pendingCast; V.pendingCast = null;   // null first → idempotent, never double-spawns
    for (let i = 0; i < pend.length; i++) {
      const h = castNPC(ctx, pend[i].spec, pend[i].fallback);
      if (pend[i].tag === "pitboss") V.pitBoss = h;
      else if (pend[i].tag === "shark") V.shark = h;
      else if (pend[i].tag) (V.cast || (V.cast = {}))[pend[i].tag] = h;
    }
  }
  function tryDrainCast(ctx) {
    if (!V || !V.pendingCast || !V.pendingCast.length) return;
    if (ctx.npc && !arenaLive()) return;                // real peds need the live arena — wait for a tick
    drainCast(ctx);
  }
  // Dialogue: [E] Talk cycles these lines via the engine's interaction system.
  // Short and real: dealers who have stood here too long, not a rules card.
  const DEALER_LINES = [[
    "Dealer stands on all seventeens.",
    "Insurance pays for the chandeliers.",
    "Eleven hours on my feet. Cards, sir?",
    "My feet hurt. Your call.",
  ], [
    "Cards don't run hot, friend. They run house.",
    "Nice hand. Now win it eight more times.",
    "Nine years dealing. Never played once.",
    "Tips are appreciated. Rent is due.",
  ]];
  const CROUPIER_LINES = [
    "Place your bets.",
    "The wheel doesn't take requests.",
    "Every system dies in that green slot.",
    "A man lost his car on this wheel last week.",
    "No hands on the table while it spins.",
  ];
  const CASHIER_LINES = [
    "Chips play. Cash doesn't.",
    "Count it in front of me, please.",
    "Big win or bad beat, it ends at this window.",
    "Nobody tips the cashier.",
  ];
  const GUARD_LINES = [
    "Hands where the cameras can see them.",
    "I watch the floor. The floor watches you.",
    "No trouble tonight.",
    "Keep walking, sir.",
  ];
  const PITBOSS_LINES = [
    "Table three's running warm. We notice warm.",
    "Win or lose, you're on camera. Do smile.",
    "The floor is extremely patient.",
    "You're up? Stay a while.",
  ];
  // The pit boss also BARKS live lines keyed to the player's night (read straight
  // off bag()): pointed when you're hot, cold when you're down. Deterministic pick
  // off the play counters (runtime flavor, no rng churn).
  const PITBOSS_HOT = [
    "Table's running warm. We notice warm.",
    "Enjoy it. The wheel has a long memory.",
    "A heater like that draws eyes. Mostly ours.",
  ];
  const PITBOSS_COLD = [
    "Rough shoe.",
    "Cold runs happen. To you, tonight.",
    "Go home, pal. Come back Friday.",
  ];
  function pickLine(pool, salt) { const s = bag().stats; return pool[(s.hands + s.spins + s.pulls + (salt || 0)) % pool.length]; }
  function pitBossBark(mood) { const h = V && V.pitBoss; if (h && h.say) h.say(pickLine(mood === "hot" ? PITBOSS_HOT : PITBOSS_COLD, mood === "hot" ? 0 : 1)); }
  function sharkSay(line) { const h = V && V.shark; if (h && h.say) h.say(line, 3.2); }

  /* ======================= WHAT IS ON THE FELT ============================
     Cards, bet chips, your own stack, the roulette dolly, a machine's face:
     real meshes in the station's own frame (stGroup), so the same code lays
     a hand at the Golden Ace and at a town casino. Table tops are 0.773 m. */
  const PAL_BRASS = 0xc9a227;
  const CHIP_COLS = { 5: 0xc22323, 25: 0x1c8a4e, 100: 0x26262c, 500: 0x6a3aa0, 1000: 0xc9a227 };
  const FELT_Y = 0.777, LAYOUT_Y = 0.762;
  let cardGeo = null, chipGeo = null; const cardTexCache = {}, chipMats = {};
  function cardTexture(c) {
    const key = c.r + c.s;
    if (cardTexCache[key]) return cardTexCache[key];
    const red = c.s === 1 || c.s === 2;
    cardTexCache[key] = ctx().canvasTex(128, 180, (g) => {
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
    backTex = backTex || ctx().canvasTex(128, 180, (g) => {
      g.fillStyle = "#6e1524"; g.fillRect(0, 0, 128, 180);
      g.strokeStyle = "#c9a227"; g.lineWidth = 3; g.strokeRect(7, 7, 114, 166);
      for (let y = 20; y < 170; y += 24) for (let x = 18; x < 118; x += 24) { g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 9, y); g.lineTo(x, y + 9); g.lineTo(x - 9, y); g.closePath(); g.stroke(); }
    });
    return backTex;
  }
  function chipMat(d) { return chipMats[d] || (chipMats[d] = new THREE.MeshLambertMaterial({ color: CHIP_COLS[d] })); }
  function clearRound(st) { if (!st) return; empty(st.cards); empty(st.chips); if (st.dolly) st.dolly.visible = false; }
  // hi: 0 | 1 = your hand, "D" = the dealer's
  function putCard(st, hi, card, faceUp, delayMs) {
    stGroup(st);
    cardGeo = cardGeo || new THREE.PlaneGeometry(0.088, 0.123);   // 1.4x a poker card: reads from the rail
    const mat = new THREE.MeshLambertMaterial({ map: faceUp ? cardTexture(card) : cardBack(), side: THREE.DoubleSide });
    mat._own = true;
    const m = new THREE.Mesh(cardGeo, mat);
    m.rotation.x = -Math.PI / 2; m.userData.card = card; m.userData.hole = !faceUp;
    const idx = hi === "D" ? BJ.dealer.length - 1 : BJ.hands[hi].cards.length - 1;
    m.position.set((hi === 1 ? 0.36 : 0) + 0.1 - idx * 0.05, FELT_Y + idx * 0.0008, hi === "D" ? -0.2 : 0.2 + idx * 0.018);
    m.visible = false;
    setTimeout(() => { m.visible = true; if (CBZ.sfx) { try { CBZ.sfx("pickup"); } catch (e) {} } }, delayMs || 0);
    if (hi === "D") BJ.dealerMeshes.push(m); else BJ.hands[hi].meshes.push(m);
    st.cards.add(m);
  }
  function turnHole() {
    const hole = BJ.dealerMeshes && BJ.dealerMeshes[1];
    if (hole && hole.userData.hole) { hole.material.map = cardTexture(hole.userData.card); hole.material.needsUpdate = true; hole.userData.hole = false; }
  }
  function splitCard(st) {
    const m = BJ.hands[0].meshes.pop();
    if (m) { BJ.hands[1].meshes.push(m); m.position.set(0.36 + 0.1, FELT_Y, 0.2); }
  }
  // stacks of chips by denomination, a column apiece, starting at (x, z)
  function stack(grp, amount, x, y, z, dx, maxEach) {
    chipGeo = chipGeo || new THREE.CylinderGeometry(0.0195, 0.0195, 0.0034, 16);   // a real 39 mm chip
    const denoms = [1000, 500, 100, 25, 5]; let col = 0;
    amount = Math.max(0, Math.floor(amount));
    for (const d of denoms) {
      let n = Math.floor(amount / d); amount -= n * d;
      n = Math.min(n, maxEach);
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(chipGeo, chipMat(d));
        m.position.set(x + col * dx, y + 0.0017 + i * 0.0035, z);
        grp.add(m);
      }
      if (n) col++;
    }
  }
  // your bet on the blackjack spot
  function betChips(st, amount) { stGroup(st); empty(st.chips); stack(st.chips, amount, -0.14, FELT_Y - 0.004, 0.13, -0.042, 8); }
  // what you have left, stacked on the felt at your right hand
  function rack(st) {
    if (!st || st.kind === "sl") return;
    stGroup(st); empty(st.rack);
    if (st.kind === "bj") stack(st.rack, bag().chips, 0.26, FELT_Y - 0.004, 0.3, 0.042, 14);
    else stack(st.rack, bag().chips, 0.92, LAYOUT_Y, 0.46, 0.042, 14);
  }
  /* THE ROULETTE LAYOUT, in the table's own frame (city/casino.js roulette():
     a 3 x 12 grid from x -0.2, cells 0.1167 x 0.22, the zero at the wheel
     end). A bet is chips on its square; the outside bets sit on the felt
     strip along the players' side, the dozens on the far one. */
  const GX0 = -0.2, CW = (2 * 1.25 - 1.1) / 12, CH = 0.22;
  function rlSpot(key) {
    if (key[0] === "n") {
      const n = parseInt(key.slice(1), 10);
      if (n === 0) return [GX0 - 0.07, 0];
      const c = Math.floor((n - 1) / 3), r = 3 - (n - c * 3);
      return [GX0 + (c + 0.5) * CW, (r - 1) * CH];
    }
    const near = { low: 1, even: 3, red: 5, black: 7, odd: 9, high: 11 };
    if (near[key] != null) return [GX0 + near[key] * CW, 0.43];
    const far = { dz1: 2, dz2: 6, dz3: 10 };
    if (far[key] != null) return [GX0 + far[key] * CW, -0.43];
    return [GX0 + 6 * CW, 0.43];
  }
  function layoutChips(st) {
    stGroup(st); empty(st.chips);
    if (RL.st !== st) return;
    for (const k in RL.bets) {
      if (!RL.bets[k]) continue;
      const p = rlSpot(k);
      stack(st.chips, RL.bets[k], p[0] - 0.02, LAYOUT_Y, p[1], 0.04, 8);
    }
  }
  // the croupier's marker on the number that came up
  function placeDolly(st, n) {
    stGroup(st);
    if (!st.dolly) {
      st.dolly = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.05, 12), new THREE.MeshPhongMaterial({ color: 0xf2efe6, shininess: 80 }));
      st.grp.add(st.dolly);
    }
    const p = rlSpot("n" + n);
    st.dolly.position.set(p[0] + 0.02, LAYOUT_Y + 0.025, p[1]);
    st.dolly.visible = true;
  }
  function pocketAngle(i) { return Math.PI / 2 - ((i + 0.5) / 37) * Math.PI * 2; }
  // the Golden Ace's rotor, turret and ball are live meshes; a town wheel is
  // part of its table's casting, so there the croupier's call is the result
  function spinWheel(st, outcome, done) {
    const W = st.wheel;
    if (!W) { setTimeout(done, 3200); return; }
    const idx = WHEEL_ORDER.indexOf(outcome);
    let t = 0, ballA = 0, R = W.rTrack || 0.372; const DUR = 5.2;
    const R0 = W.rTrack || 0.372, R1 = W.rPocket || 0.27;
    ctx().anim((dt) => {
      t += dt;
      const w = 2.6 * Math.max(0.22, 1 - (t / DUR) * 0.85);
      W.theta += w * dt; W.disc.rotation.z = W.theta; W.turret.rotation.y = W.theta;
      const target = pocketAngle(idx) + W.theta;
      if (t < 3.0) ballA -= (6.5 - t * 1.5) * dt;
      else if (t < DUR) {
        const k = (t - 3.0) / (DUR - 3.0); R = R0 - (R0 - R1) * k;
        const diff = ((target - ballA) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        ballA += diff * Math.min(1, dt * (1.5 + k * 6)) + w * dt * k;
      } else { ballA = target; R = R1; }
      W.ball.position.set(W.cx + Math.cos(ballA) * R, W.by, W.cz - Math.sin(ballA) * R);
      if (t >= DUR + 0.6) { done(); return false; }
    });
  }
  function slotStopAngle(k) { return ((k + 0.5) / 22) * Math.PI * 2; }
  function spinReels(st, stops, done) {
    const reels = st.reels;
    if (!reels) { setTimeout(done, 1500); return; }
    let t = 0; const stopT = [1.1, 1.6, 2.1], stopped = [false, false, false];
    ctx().anim((dt) => {
      t += dt; let all = true;
      for (let r = 0; r < 3; r++) {
        if (stopped[r]) continue;
        if (t < stopT[r]) { reels[r].rotation.x -= dt * 13; all = false; }
        else { const cur = reels[r].rotation.x, target = slotStopAngle(stops[r]); reels[r].rotation.x = target - Math.PI * 2 * Math.ceil((target - cur) / (Math.PI * 2)); stopped[r] = true; all = false; }
      }
      if (all && t > stopT[2] + 0.1) { done(); return false; }
    });
  }
  const SYM_COL = { CHR: "#c22", LEM: "#e8c62c", ORN: "#e8862c", BELL: "#d9a712", BAR: "#222", SEV: "#c22", DIA: "#3ec6d9" };
  function drawSym(gg, sy, cx, cy, s) {
    gg.fillStyle = SYM_COL[sy] || "#888";
    if (sy === "BAR" || sy === "SEV") { gg.font = "800 " + Math.round((sy === "BAR" ? 15 : 40) * s) + "px Verdana"; gg.textAlign = "center"; gg.textBaseline = "middle"; gg.fillText(sy === "BAR" ? "BAR" : "7", cx, cy); }
    else if (sy === "DIA") { gg.beginPath(); gg.moveTo(cx, cy - 15 * s); gg.lineTo(cx + 12 * s, cy); gg.lineTo(cx, cy + 15 * s); gg.lineTo(cx - 12 * s, cy); gg.closePath(); gg.fill(); }
    else { gg.beginPath(); gg.arc(cx, cy, 12 * s, 0, 7); gg.fill(); }
  }
  /* A MACHINE'S FACE. A reel machine (the Golden Ace) shows its symbols on
     its reels, so its face is the credit meter under the window. A video
     machine (every town casino) shows the three symbols on its screen. Both
     show the bet, what the last pull paid, and the chips you have in it. */
  function slotFace(st, msg) {
    stGroup(st);
    const video = !st.reels;
    if (!st.face) {
      const cv = document.createElement("canvas"); cv.width = 256; cv.height = video ? 160 : 44;
      const tex = new THREE.CanvasTexture(cv);
      const R = CBZ.renderer;
      if (R && THREE.SRGBColorSpace && R.outputColorSpace === THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex }));
      if (video) { m.scale.set(0.5, 0.31, 1); m.position.set(0, 1.34, 0.122); }
      else { m.scale.set(0.26, 0.045, 1); m.position.set(0, 1.215, 0.108); }
      st.grp.add(m);
      st.face = { cv: cv, tex: tex, m: m };
    }
    const cv = st.face.cv, gg = cv.getContext("2d"), mine = SL.st === st;
    gg.fillStyle = "#07090c"; gg.fillRect(0, 0, cv.width, cv.height);
    const last = mine ? SL.last : null;
    const meter = msg || (mine && SL.spinning ? "GOOD LUCK" : (last ? (last.win ? "WIN " + last.win : "NO WIN") : "BET " + SL.bet));
    if (video) {
      for (let i = 0; i < 3; i++) {
        gg.fillStyle = "#f4ead2"; gg.fillRect(14 + i * 78, 12, 72, 86);
        if (last) drawSym(gg, last.syms[i], 50 + i * 78, 55, 1.5);
        else if (!(mine && SL.spinning)) drawSym(gg, ["SEV", "BAR", "DIA"][i], 50 + i * 78, 55, 1.5);
      }
      gg.fillStyle = last && last.win ? "#ffd451" : "#ff6a4a";
      gg.font = "800 22px Verdana"; gg.textAlign = "left"; gg.textBaseline = "middle";
      gg.fillText(meter, 14, 122);
      gg.textAlign = "right"; gg.fillStyle = "#9fe0ff";
      gg.fillText("BET " + SL.bet, 242, 122);
      gg.fillStyle = "#cfd6dd"; gg.font = "700 16px Verdana"; gg.textAlign = "left";
      gg.fillText("CHIPS " + bag().chips.toLocaleString("en-US"), 14, 146);
    } else {
      gg.fillStyle = last && last.win ? "#ffd451" : "#ff6a4a";
      gg.font = "800 24px Verdana"; gg.textAlign = "center"; gg.textBaseline = "middle";
      gg.fillText(meter + "   " + bag().chips.toLocaleString("en-US"), 128, 23);
    }
    st.face.tex.needsUpdate = true;
  }

  /* THE FLOOR (2026-10-31 rebuild). The Golden Ace is drawn with the SAME
     furniture as every other casino in the world (city/casino.js's
     CBZ.casinoFixtures on gunstore.js's merged fixture kit): kidney blackjack
     felts with a padded rail, shoe and chip tray; a roulette table whose
     rotor, turret and ball are live meshes in the fixture's bowl; mechanical
     reel slots with real 22-stop reels behind the pay line; the brass cage on
     a panelled counter; the shark's tufted booth. Real metres throughout
     (table tops 0.77 m, cards 1.4x poker size so they read from the rail).
     The whole static floor is a handful of merged draw calls. */
  function carpetTex(ctx) {
    return ctx.canvasTex(256, 256, (gg) => {
      gg.fillStyle = "#2a0910"; gg.fillRect(0, 0, 256, 256);
      gg.strokeStyle = "rgba(170,132,40,.4)"; gg.lineWidth = 3;
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const x = 64 + i * 128, y = 64 + j * 128;
        gg.beginPath(); gg.moveTo(x, y - 44); gg.lineTo(x + 44, y); gg.lineTo(x, y + 44); gg.lineTo(x - 44, y); gg.closePath(); gg.stroke();
        gg.fillStyle = "rgba(20,70,66,.8)"; gg.beginPath(); gg.arc(x, y, 14, 0, 7); gg.fill();
        gg.fillStyle = "rgba(201,162,39,.7)"; gg.beginPath(); gg.arc(x, y, 5, 0, 7); gg.fill();
      }
      gg.strokeStyle = "rgba(90,20,30,.9)"; gg.lineWidth = 2;
      for (let q = 0; q <= 256; q += 128) { gg.beginPath(); gg.moveTo(q, 0); gg.lineTo(q, 256); gg.stroke(); gg.beginPath(); gg.moveTo(0, q); gg.lineTo(256, q); gg.stroke(); }
    }, (hxCarpet * 2 + 2) / 1.6, (hzCarpet * 2 + 2) / 1.6);
  }
  let hxCarpet = 8, hzCarpet = 6;
  function feltPrint(ctx) {
    // the printed legend on a blackjack felt: transparent, laid over the cloth
    return ctx.canvasTex(512, 200, (gg) => {
      gg.clearRect(0, 0, 512, 200);
      gg.strokeStyle = "rgba(240,226,180,.8)"; gg.lineWidth = 3;
      gg.beginPath(); gg.arc(256, -330, 470, 1.2, Math.PI - 1.2); gg.stroke();
      gg.fillStyle = "rgba(240,226,180,.9)"; gg.textAlign = "center"; gg.textBaseline = "middle";
      gg.font = "800 34px 'Trebuchet MS', sans-serif"; gg.fillText("BLACKJACK PAYS 3 TO 2", 256, 92);
      gg.font = "700 22px 'Trebuchet MS', sans-serif"; gg.fillStyle = "rgba(240,226,180,.7)";
      gg.fillText("DEALER MUST STAND ON ALL 17s", 256, 132);
      gg.font = "700 18px 'Trebuchet MS', sans-serif"; gg.fillText("INSURANCE PAYS 2 TO 1", 256, 166);
    });
  }
  function wheelTexture(ctx) {
    return ctx.canvasTex(512, 512, (gg) => {
      const Cc = 256, TAU = Math.PI * 2;
      gg.fillStyle = "#3a2210"; gg.beginPath(); gg.arc(Cc, Cc, 255, 0, TAU); gg.fill();
      for (let i = 0; i < 37; i++) {
        const n = WHEEL_ORDER[i], a0 = (i / 37) * TAU - Math.PI / 2, a1 = ((i + 1) / 37) * TAU - Math.PI / 2;
        gg.fillStyle = n === 0 ? "#0f7a44" : (RED_SET[n] ? "#a41f2f" : "#15181d");
        gg.beginPath(); gg.arc(Cc, Cc, 248, a0, a1); gg.arc(Cc, Cc, 150, a1, a0, true); gg.closePath(); gg.fill();
        // the pocket frets (brass separators)
        gg.strokeStyle = "#d8b552"; gg.lineWidth = 3;
        gg.beginPath(); gg.moveTo(Cc + Math.cos(a0) * 150, Cc + Math.sin(a0) * 150); gg.lineTo(Cc + Math.cos(a0) * 200, Cc + Math.sin(a0) * 200); gg.stroke();
        const am = (a0 + a1) / 2;
        gg.save(); gg.translate(Cc + Math.cos(am) * 226, Cc + Math.sin(am) * 226); gg.rotate(am + Math.PI / 2);
        gg.fillStyle = "#fff6e2"; gg.font = "800 22px 'Trebuchet MS'"; gg.textAlign = "center"; gg.textBaseline = "middle";
        gg.fillText(String(n), 0, 0); gg.restore();
      }
      gg.strokeStyle = "#d8b552"; gg.lineWidth = 3;
      gg.beginPath(); gg.arc(Cc, Cc, 200, 0, TAU); gg.stroke();
      // the cone: polished wood with four brass spokes
      const grd = gg.createRadialGradient(Cc, Cc, 20, Cc, Cc, 150);
      grd.addColorStop(0, "#7a4a22"); grd.addColorStop(1, "#2a1608");
      gg.fillStyle = grd; gg.beginPath(); gg.arc(Cc, Cc, 150, 0, TAU); gg.fill();
      gg.strokeStyle = "#c9a227"; gg.lineWidth = 6;
      for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2 + Math.PI / 4; gg.beginPath(); gg.moveTo(Cc + Math.cos(a) * 30, Cc + Math.sin(a) * 30); gg.lineTo(Cc + Math.cos(a) * 140, Cc + Math.sin(a) * 140); gg.stroke(); }
    });
  }

  function buildVenue(ctx, venue) {
    const THREE = ctx.THREE, g = venue.group;
    const FX = CBZ.casinoFixtures, KIT = CBZ.storeFixtureKit;
    V = { rl: null, npcs: [], pitBoss: null, shark: null, pendingCast: [], _venue: venue };
    // this floor's tables and machines, as stations (world coordinates)
    const O = venue.origin || { x: 0, z: 0 };
    for (let i = STATIONS.length - 1; i >= 0; i--) { stDrop(STATIONS[i]); STATIONS.splice(i, 1); }
    liveSt = null; BJ.phase = "bet"; BJ.st = null; RL.st = null; RL.bets = {}; RL.spinning = false; SL.st = null; SL.spinning = false;
    const lot = venue.lot, bld = lot && lot.building;
    const hx = lot ? Math.max(5, Math.min(8, lot.w / 2 - 1.6)) : 8;
    const hz = lot ? Math.max(4, Math.min(6, lot.d / 2 - 1.6)) : 6;
    // the floor and ceiling this room really has (the shell's slab, the
    // fit-out ceiling plane) so feet, felts and lamp drops all land
    const tops = bld && bld.floorTops;
    const ff = tops && tops[0] != null ? tops[0] + 0.03 : 0.02;
    const ceil = tops && tops[1] != null ? tops[1] - 0.212 : ff + 3.4;
    V.ff = ff;
    // the carpet: the house pattern, over the whole floor we dress
    {
      hxCarpet = hx; hzCarpet = hz;
      const carpet = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 + 2, hz * 2 + 2), new THREE.MeshLambertMaterial({ map: carpetTex(ctx) }));
      carpet.rotation.x = -Math.PI / 2; carpet.position.y = ff - 0.005; carpet.receiveShadow = true; g.add(carpet);
    }
    if (venue.kind === "dev") ctx.light(0, 4.5, 0, 0xffca72, 1.1, 18);
    const k = KIT ? KIT.create() : null;
    const printMat = new THREE.MeshLambertMaterial({ map: feltPrint(ctx), transparent: true, depthWrite: false });
    const printGeo = new THREE.PlaneGeometry(1.25, 0.49);

    // --- two blackjack tables; the dealer stands behind the flat edge (+z) ---
    [-hx * 0.5, hx * 0.5].forEach((cx, which) => {
      const cz = -hz * 0.4;
      // fixture frame: local +Z = the players' side = world -Z (yaw PI)
      if (k && FX) {
        FX.blackjack(k, { x: cx, z: cz, yaw: Math.PI }, ff);
        for (let j = 0; j < 5; j++) {
          const a = Math.PI * (0.15 + 0.7 * j / 4);
          const lx = -Math.cos(a) * 1.3, lz = -0.45 + Math.sin(a) * 1.22;
          FX.stool(k, cx - lx, cz - lz, 0.68, Math.atan2(lx, lz), ff);
        }
        FX.lamp(k, { x: cx, z: cz, yaw: 0, len: 1.8 }, ff, ceil);
      }
      const print = new THREE.Mesh(printGeo, printMat);
      print.rotation.x = -Math.PI / 2; print.position.set(cx, ff + 0.7735, cz + 0.12); print.renderOrder = 2; g.add(print);
      ctx.solid(cx - 1.02, cz - 0.52, cx + 1.02, cz + 0.5);
      STATIONS.push({ kind: "bj", x: O.x + cx, y: ff, z: O.z + cz, yaw: Math.PI, cast: "dealer" + which });
      queueCast({
        // role "dealer" → the facade dresses house waiter-blacks (the vest-and-collar
        // dealer read) and pins them behind the felt, hands over the table.
        role: "dealer", name: which ? "Dealer Vega" : "Dealer Marchetti",
        at: [cx, cz + 0.85], face: Math.PI, post: "pinned", pose: "deal",
        dialogue: DEALER_LINES[which],
      }, function () {
        const dealer = ctx.rig({ shirt: 0xe8dcc0, pants: 0x14100c, skin: which ? 0x8a5c34 : 0xc2905c, vest: 0x1c6e46 }).at(cx, cz + 0.85, Math.PI).deal();
        g.add(dealer.g); ctx.idle(dealer, which * 1.7); return dealer;
      }, "dealer" + which);
      ctx.light(cx, ff + 2.6, cz, 0xffd9a0, 0.8, 7);
    });

    // --- roulette: the fixture table, with a live rotor in its bowl ---
    {
      const cx = 0, cz = hz * 0.45;
      if (k && FX) {
        FX.roulette(k, { x: cx, z: cz, yaw: Math.PI }, ff, { noWheel: true });
        for (let j = 0; j < 4; j++) FX.stool(k, cx + 0.95 - j * 0.6, cz - 1.0, 0.68, 0, ff);
        FX.lamp(k, { x: cx, z: cz, yaw: 0, len: 2.2 }, ff, ceil);
      }
      // yaw PI turns the fixture's local x round: its wheel end lands at +x
      const wx = cx - (FX ? FX.wheelX() : -0.77), wz = cz, wy = ff + 0.856;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.345, 48), new THREE.MeshPhongMaterial({ map: wheelTexture(ctx), specular: 0x332211, shininess: 30 }));
      disc.rotation.x = -Math.PI / 2; disc.position.set(wx, wy, wz); g.add(disc);
      const turret = new THREE.Group(); turret.position.set(wx, wy, wz); g.add(turret);
      const brass = ctx.pmat(PAL_BRASS, 70);
      ctx.cyl(turret, 0, 0.02, 0, 0.05, 0.075, 0.04, brass, 16);           // the turret boss
      ctx.cyl(turret, 0, 0.065, 0, 0.012, 0.02, 0.07, brass, 8);           // spindle
      ctx.cyl(turret, 0, 0.105, 0, 0.02, 0.02, 0.012, brass, 10);          // finial
      for (let hh = 0; hh < 4; hh++) {
        const ha = hh * Math.PI / 2;
        ctx.box(turret, Math.cos(ha) * 0.06, 0.085, Math.sin(ha) * 0.06, 0.1, 0.01, 0.01, brass, -ha);
        ctx.cyl(turret, Math.cos(ha) * 0.11, 0.085, Math.sin(ha) * 0.11, 0.012, 0.012, 0.016, brass, 8);
      }
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), ctx.pmat(0xf4f4f0, 90));
      ball.position.set(wx + 0.37, wy + 0.012, wz); g.add(ball);
      ctx.solid(cx - 1.3, cz - 0.64, cx + 1.3, cz + 0.64);
      V.rl = { disc, turret, ball, theta: 0, cx: wx, cz: wz, by: wy + 0.012, rTrack: 0.372, rPocket: 0.27 };
      queueCast({
        // role "croupier" → house waiter-blacks at the wheel (seeded appearance
        // keeps him a distinct person from the blackjack dealers across the room).
        role: "croupier", name: "Croupier Dubois",
        at: [cx + 0.4, cz + 1.0], face: Math.PI, post: "pinned", pose: "deal",
        dialogue: CROUPIER_LINES,
      }, function () {
        const croup = ctx.rig({ shirt: 0xe8dcc0, pants: 0x14100c, skin: 0xd9a066, vest: 0x6e1524 }).at(cx + 0.4, cz + 1.0, Math.PI).deal();
        g.add(croup.g); ctx.idle(croup, 2.4); return croup;
      }, "croupier");
      queueCast({
        // role "pitboss" → charcoal exec suit (the facade's archetype path); folds
        // his arms over the pit and barks state-keyed lines (pitBossBark, below).
        role: "pitboss", name: "Mr. Calloway", post: "pinned", pose: "foldarms",
        at: [cx + 2.6, cz - 0.6], face: 2.6,
        dialogue: PITBOSS_LINES,
      }, function () {
        const boss = ctx.rig({ shirt: 0x14100c, pants: 0x14100c, skin: 0xd9a066, vest: 0x211a12, hair: 0x777c82 }).at(cx + 2.6, cz - 0.6, 2.6).fold();
        g.add(boss.g); ctx.idle(boss, 4.1); return boss;
      }, "pitboss");
      STATIONS.push({ kind: "rl", x: O.x + cx, y: ff, z: O.z + cz, yaw: Math.PI, cast: "croupier", wheel: V.rl });
      ctx.light(cx, ff + 2.6, cz, 0xffd9a0, 0.85, 8);
    }

    // --- slot bank: four reel machines shoulder to shoulder facing -x;
    //     the first machine's reels are the ones the panel spins ---
    const stripTex = ctx.canvasTex(48 * 22, 96, (gg) => {
      gg.fillStyle = "#f4ead2"; gg.fillRect(0, 0, 48 * 22, 96);
      for (let i = 0; i < 22; i++) {
        const x0 = i * 48, cx2 = x0 + 24, cy = 48, sy = SLOT_STRIP[i];
        gg.strokeStyle = "#d8c9a4"; gg.strokeRect(x0 + 1, 8, 46, 80);
        gg.fillStyle = { CHR: "#c22", LEM: "#e8c62c", ORN: "#e8862c", BELL: "#d9a712", BAR: "#222", SEV: "#c22", DIA: "#3ec6d9" }[sy];
        if (sy === "BAR" || sy === "SEV") { gg.font = "800 " + (sy === "BAR" ? 15 : 40) + "px Verdana"; gg.textAlign = "center"; gg.textBaseline = "middle"; gg.fillText(sy === "BAR" ? "BAR" : "7", cx2, cy); }
        else if (sy === "DIA") { gg.beginPath(); gg.moveTo(cx2, cy - 15); gg.lineTo(cx2 + 12, cy); gg.lineTo(cx2, cy + 15); gg.lineTo(cx2 - 12, cy); gg.closePath(); gg.fill(); }
        else { gg.beginPath(); gg.arc(cx2, cy, 12, 0, 7); gg.fill(); }
      }
    });
    const reelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.13, 32, 1, true);
    const reelMat = new THREE.MeshLambertMaterial({ map: stripTex });
    const sx = hx - 0.45;
    for (let i = 0; i < 4; i++) {
      const sz = -hz * 0.45 + i * 0.66;
      if (k && FX) {
        FX.slot(k, { x: sx, z: sz, yaw: -Math.PI / 2, hue: i }, ff, { reels: true });
        FX.stool(k, sx - 0.68, sz, 0.66, 0, ff);
      }
      const grp = new THREE.Group(); grp.position.set(sx, ff, sz); grp.rotation.y = -Math.PI / 2; g.add(grp);
      const reels = [];
      for (let r = 0; r < 3; r++) {
        const reel = new THREE.Mesh(reelGeo, reelMat);
        reel.rotation.z = Math.PI / 2; reel.rotation.x = slotStopAngle((i * 7 + r * 5) % 22);
        reel.position.set(-0.144 + r * 0.144, 1.34, -0.03); grp.add(reel); reels.push(reel);
      }
      ctx.solid(sx - 0.3, sz - 0.31, sx + 0.3, sz + 0.31);
      STATIONS.push({ kind: "sl", x: O.x + sx, y: ff, z: O.z + sz, yaw: -Math.PI / 2, reels: reels });
    }
    ctx.light(sx - 0.8, ff + 2.4, -hz * 0.45 + 1.0, 0xff9adf, 0.5, 5);

    // --- the cage: a panelled counter under brass bars and glass ---
    {
      const cx = -hx + 0.7, cz = -hz * 0.55;
      if (k && FX && FX.cage) FX.cage(k, { C: { x: cx + 0.6, z: cz, w: 0.62, d: 3.4, top: ff + 1.02, tx: 0, tz: -1 } }, ff);
      ctx.solid(cx + 0.27, cz - 1.75, cx + 0.93, cz + 1.75);
      queueCast({
        // "banker" job-hint → formal business fit (bizRecord) AND a sensible cage
        // occupation: the cage IS the house bank. Formal, distinct from floor staff.
        role: "cashier", name: "Cage. Okafor", outfit: "banker",
        at: [cx - 0.2, cz], face: Math.PI / 2, post: "pinned", pose: "stand",
        dialogue: CASHIER_LINES,
      }, function () {
        const cashier = ctx.rig({ shirt: 0xe8dcc0, pants: 0x22262c, skin: 0xd9a066, vest: 0x6e1524 }).at(cx - 0.2, cz, Math.PI / 2);
        g.add(cashier.g); ctx.idle(cashier, 1.1); return cashier;
      }, "cashier");
      queueCast({
        // role "guard" → job "security guard" → Guard Blacks, which carry NO cop
        // flag (cityOutfitIsCop stays false), so he never reads as police. Watchful.
        role: "guard", name: "Security",
        at: [cx + 1.6, cz + 2.2], face: 2.4, post: "pinned", pose: "foldarms",
        dialogue: GUARD_LINES,
      }, function () {
        const guard = ctx.rig({ shirt: 0x2c3038, pants: 0x14100c, skin: 0x704c28, cap: 0x2c3038 }).at(cx + 1.6, cz + 2.2, 2.4).fold();
        g.add(guard.g); ctx.idle(guard, 3.3); return guard;
      });
      ctx.zone({
        id: "cage", name: "The Cage", note: chipsNote, pos: [cx + 1.5, cz], at: [cx + 0.6, cz], y: ff + 1.35, r: 1.6,
        verbs: CAGE_ASKS.map(function (a) {
          return { id: a.id, label: function () { return asIs(a.label()); },
            canShow: function () { const h = V && V.cast && V.cast.cashier; return !!h && !scared(h.ped) && a.show(); },
            onSelect: function () { a.run(V && V.cast && V.cast.cashier); } };
        }),
      });
      ctx.light(cx + 1, ff + 2.6, cz, 0xffd48a, 0.8, 8);
    }

    // --- the shark's booth: a tufted oxblood banquette, a marble pedestal
    //     table with his lamp, his drink and his ashtray ---
    {
      const cx = hx - 1.4, cz = hz - 0.8;
      if (k) {
        // local frame: the shark sits at the origin facing local +Z (= world -z)
        k.frame(cx, ff, cz + 0.35, Math.PI);
        const LEA = 0x5a1418, LEAd = 0x3a0c10, WOOD = 0x2a1a10, BR = 0xc9a24a;
        k.box(0, 0.19, -0.04, 2.3, 0.38, 0.56, WOOD, "gloss");                 // plinth
        k.box(0, 0.43, -0.02, 2.24, 0.12, 0.6, LEA, "gloss");                  // seat cushion
        k.box(0, 0.495, 0.27, 2.2, 0.02, 0.04, LEAd, "gloss");                 // cushion welt
        k.box(0, 0.86, -0.3, 2.24, 0.74, 0.16, LEA, "gloss", -0.12);           // back, raked
        for (let i = -5; i <= 5; i++) k.box(i * 0.2, 0.86, -0.215, 0.012, 0.66, 0.02, LEAd, "gloss", -0.12);  // channel tufting
        k.box(0, 1.25, -0.36, 2.36, 0.06, 0.24, WOOD, "gloss");                // capping rail
        for (const e of [-1, 1]) {
          k.box(e * 1.2, 0.36, 0.2, 0.16, 0.72, 1.0, WOOD, "gloss");           // end panels (the booth wings)
          k.box(e * 1.2, 0.73, 0.2, 0.2, 0.03, 1.04, BR, "metal");
        }
        // the table: cast base, column, marble top with a brass edge
        k.cyl(0, 0.02, 0.75, 0.26, 0.3, 0.04, 0x1a1612, "metal", 0, 0, 0, 20);
        k.cyl(0, 0.38, 0.75, 0.045, 0.06, 0.68, 0x1a1612, "metal", 0, 0, 0, 12);
        k.cyl(0, 0.735, 0.75, 0.46, 0.46, 0.03, 0xe6e0d4, "gloss", 0, 0, 0, 32);
        k.torus(0, 0.735, 0.75, 0.46, 0.012, BR, "metal", Math.PI / 2, 0, 0, null, 32);
        // his lamp, his drink, his ashtray, the cigar
        k.cyl(-0.25, 0.76, 0.6, 0.05, 0.06, 0.02, BR, "metal", 0, 0, 0, 12);
        k.cyl(-0.25, 0.9, 0.6, 0.008, 0.008, 0.26, BR, "metal", 0, 0, 0, 6);
        k.cyl(-0.25, 1.04, 0.6, 0.06, 0.1, 0.1, 0xffc27a, "glow", 0, 0, 0, 14);
        k.cyl(0.18, 0.79, 0.62, 0.036, 0.032, 0.09, 0, "glass", 0, 0, 0, 12);
        k.cyl(0.18, 0.768, 0.62, 0.031, 0.031, 0.04, 0x9a5a1a, "gloss", 0, 0, 0, 12);  // the whisky in it
        k.cyl(0.05, 0.756, 0.92, 0.07, 0.06, 0.03, 0x1c1c22, "gloss", 0, 0, 0, 14);
        k.cyl(0.08, 0.774, 0.92, 0.008, 0.008, 0.12, 0x4a2a14, "solid", 0, 0, Math.PI / 2, 6);
      }
      ctx.solid(cx - 1.3, cz - 0.9, cx + 1.3, cz + 0.9);
      // No `dialogue` on purpose: what he does for you is the zone below (ask
      // him for a marker, take it); his terms go over his head via sharkSay().
      // role "shark" → the facade's high-roller look, seated in the booth.
      queueCast({
        role: "shark", name: "The Shark", post: "pinned", pose: "sit",
        at: [cx, cz + 0.35], face: Math.PI,
      }, function () {
        const shark = ctx.rig({ shirt: 0x39424e, pants: 0x14100c, skin: 0xb87c4c, hair: 0x555a60, shades: true }).at(cx, cz + 0.35, Math.PI).sit();
        shark.g.position.y -= 0.28; g.add(shark.g); ctx.idle(shark, 5.2); return shark;
      }, "shark");
      ctx.zone({
        id: "shark", name: "The Shark", note: chipsNote, pos: [cx, cz - 1.3], at: [cx, cz + 0.35], y: ff + 1.25, r: 1.6,
        verbs: [
          { id: "take", slot: "e", label: function () { return asIs("Take his marker, " + fmt(LIMITS.LOAN_GIVE) + " in chips"); }, canShow: function () { return !!(V && V.shark) && sharkOffered(); }, onSelect: sharkTake },
          { id: "ask", slot: "e", label: function () { return asIs("Ask him for a marker"); }, canShow: function () { return !!(V && V.shark) && !sharkOffered(); }, onSelect: sharkAsk },
        ],
      });
      ctx.light(cx - 0.25, ff + 1.3, cz - 0.25, 0xff9a4e, 0.6, 5.5);
    }
    if (k) {
      const fix = new THREE.Group(); fix.name = "casino-fixtures";
      k.build(fix); g.add(fix);
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
      ].forEach((p) => queueCast({ role: "patron", at: p.at, face: p.face, post: "ambient" }, null));
    }
    // Spawn the queued cast now if the sim is already live (rebuild) or there's no
    // facade (bare harness → rig dummies); otherwise the first update() tick drains
    // it once the arena is published (real peds — see the CAST section note).
    tryDrainCast(ctx);
  }

  /* ======================= REGISTER ======================================= */
  CBZ.games.register({
    id: "casino", title: "THE GOLDEN ACE",
    venue: { lotKind: "casino" },
    build(ctx, venue) { C = ctx; buildVenue(ctx, venue); buildShoe(); },
    // Drain the queued cast into REAL peds on the first live tick (the arena root
    // is published by now, so ctx.npc requisitions real peds instead of dummies).
    update(ctx) { if (V && ctx && ctx.venue === V._venue) tryDrainCast(ctx); },
    api: {
      rules: { handValue, settleBJ, rlPayout, slotPay, slotRTP, wheel: WHEEL_ORDER, red: RED_SET, strip: SLOT_STRIP },
      state: () => (S ? JSON.parse(JSON.stringify(S)) : null),
      // roster of the flagship cast (real peds via ctx.npc, or rig fallbacks) —
      // exposed for tools/probes to assert the cast built.
      cast: () => (V && V.npcs ? V.npcs.length : 0),
      bj: BJ, rl: RL, sl: SL,
      // the stations of every floor, and the one you are standing at
      stations: () => STATIONS.concat(CBZ._casinoTables || [], CBZ._casinoSlots || []).map(prep),
      at: () => liveSt,
      asks: { cage: CAGE_ASKS, deal: bjDeal, hit: bjHit, stand: bjStand, double: bjDouble, split: bjSplit, place: rlPlace, spin: rlSpin, clear: rlClear, pull: slPull },
    },
  });

})();
