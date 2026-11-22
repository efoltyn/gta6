/* ============================================================
   city/betslip.js - THE ONE BET SLIP, and it is a piece of paper.

   Every wager in the city is written on this slip, at the venue that takes
   it: the Ironjaw Arena ringside and pit (city/arena_fights.js), the
   Southpaw Palace bookmaker (games/boxing.js) and the dog and horse windows
   at the racepark (below).

   WHAT IT WAS: an HTML card in the middle of the screen (rows of runner
   buttons, stake pills, PLACE BET, a cash readout) that froze the game
   behind it. WHAT IT IS: the window pushes a card across to you and you
   HOLD it (city/paper.js): the runners and what each pays, the one you have
   marked circled in pen, your stake and what the ticket returns. With it in
   your hands:
     Hand it in, $50 on <runner>    the bet is on; the paper in your hand is
                                    now your ticket, stamped
     Mark the next one              move the circle down the card
     Stake $100 / Stake $25         up and down the window's stakes
     Tear it up / No bet            (walking away from the window is no bet
                                    too; lowering the paper is not: Look at
                                    the slip brings it back up)
   The venue keeps what only it knows: who is running, the odds, when the
   result is in, and what the bookmaker says.

   cfg = {
     key      remembers the last stake per venue
     title, sub
     picks    [{ id, label, odds, sub? }]
     pick     preselected pick id
     stakes   preset stake list  OR  min/max/step/stake for a stepper
     ticket   text of a live ticket (written on the slip)
     locked   string: why no new ticket can be written right now
     spend    fn(n) -> bool (default CBZ.city.spend)
     onPlace  fn(pick, stake, odds)
     skip     { label, fn }   an extra "no bet" way out that continues a flow
     onClose  fn()
   }
   Exposes: CBZ.betSlip { open, close, isOpen, settle }, CBZ.cityTrackBook.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game || {};

  function money(n) { n = Math.round(+n || 0); return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US"); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 2.4); }
  function odd(o) { o = +o || 0; return (Math.round(o * 100) / 100).toFixed(o % 1 ? 2 : 1); }
  function asIs(s) { const VW = CBZ.cityVerbWord; if (VW && VW.keep) VW.keep(s); return s; }
  function say(who, text, secs) {
    if (who && !who.dead && CBZ.citySay) { try { CBZ.citySay(who, text, null, { secs: secs || 3, force: true }); return true; } catch (e) {} }
    return false;
  }

  const lastStake = Object.create(null);
  let cfg = null, pickId = null, stake = 0, open_ = false, msg = "";
  const at = { x: 0, z: 0, t: 0 };            // where and when the slip was pushed across to you
  const SLIP_HOLD = 120000, SLIP_REACH = 10;   // it is good for two minutes, at that window

  function stakeList() { return Array.isArray(cfg.stakes) && cfg.stakes.length ? cfg.stakes : null; }
  function curPick() { return cfg ? ((cfg.picks || []).find((p) => String(p.id) === String(pickId)) || null) : null; }
  // the stake one step up (dir 1) or down (dir -1) from the one written
  function stakeStep(dir) {
    const list = stakeList();
    if (list) {
      const i = list.indexOf(stake), k = Math.max(0, Math.min(list.length - 1, (i < 0 ? 0 : i) + dir));
      return list[k];
    }
    const step = cfg.step || 25, lo = cfg.min || step, hi = cfg.max || 5000;
    return Math.max(lo, Math.min(hi, stake + dir * step));
  }
  function nextPick() {
    const picks = cfg.picks || [];
    if (!picks.length) return;
    const i = picks.findIndex((p) => String(p.id) === String(pickId));
    pickId = picks[(i + 1) % picks.length].id;
    msg = ""; draw();
  }
  function setStake(dir) { stake = stakeStep(dir); msg = ""; draw(); }

  // ---- the slip itself: a sheet you hold (city/paper.js) ----
  function draw() {
    const K = CBZ.cityPaper;
    if (!K || !cfg) return false;
    const p = curPick(), lines = [];
    if (cfg.sub) lines.push({ text: cfg.sub, italic: true, dim: true });
    lines.push({ cols: ["", "PAYS"], head: true });
    for (const r of cfg.picks || []) {
      lines.push({ cols: [r.label + (r.sub ? "  (" + r.sub + ")" : ""), odd(r.odds) + " x"], mark: !!p && String(p.id) === String(r.id) });
    }
    lines.push({ gap: 14 });
    lines.push({ k: "STAKE", v: money(stake), big: true });
    if (p) lines.push({ k: "IF " + String(p.label).toUpperCase() + " WINS", v: money(Math.round(stake * p.odds)) });
    if (cfg.ticket) lines.push({ text: cfg.ticket });
    return K.show({
      key: "betslip", org: cfg.title || "Bet slip", title: "BET SLIP", ink: "#5a2418", tone: "#f6efdc",
      colw: [0.72, 0.28], lines: lines,
      foot: msg || cfg.locked || "Win only. Stakes are not returned.",
      // (putting the paper down is not tearing it up: a tap on a touch screen
      //  lowers any held paper, and the slip has to outlive that tap. It is
      //  still yours to mark or hand in until you put it away or walk off.)
    });
  }
  // the same paper, once it is handed in: your ticket
  function ticket(p, st, title) {
    const K = CBZ.cityPaper;
    if (!K) return;
    K.show({
      key: "betticket", org: title || "Bet slip", title: "TICKET", ink: "#5a2418", tone: "#f6efdc",
      lines: [{ k: "TO WIN", v: p.label }, { k: "STAKE", v: money(st) }, { k: "AT", v: odd(p.odds) + " x" }, { k: "RETURNS", v: money(Math.round(st * p.odds)), big: true }],
      foot: "Keep this ticket. No ticket, no pay.", stamp: "BET PLACED",
    });
    setTimeout(function () { if (CBZ.cityPaper) CBZ.cityPaper.down("betticket"); }, 3200);
  }

  function place() {
    if (!cfg) return;
    if (cfg.locked) { msg = cfg.locked; draw(); return; }
    const p = curPick();
    if (!p) { msg = "Mark one first."; draw(); return; }
    const spend = cfg.spend || function (n) { return !!(CBZ.city && CBZ.city.spend && CBZ.city.spend(n)); };
    if (!spend(stake)) { msg = "You can't cover " + money(stake) + "."; draw(); return; }
    if (cfg.key) lastStake[cfg.key] = stake;
    const onPlace = cfg.onPlace, st = stake, title = cfg.title;
    close(true, true);
    ticket(p, st, title);
    if (CBZ.sfx) { try { CBZ.sfx("coin"); } catch (e) {} }
    if (onPlace) onPlace(p, st, +p.odds);
  }
  function skip() { if (!cfg) return; const s = cfg.skip; close(true); if (s && s.fn) s.fn(); }

  function open(c) {
    if (!c || !CBZ.cityPaper) return false;
    if (open_) close(true);
    wire();
    cfg = c; msg = "";
    const picks = cfg.picks || [];
    pickId = cfg.pick != null ? cfg.pick : (picks.length ? picks[0].id : null);
    const list = stakeList();
    const want = (cfg.key && lastStake[cfg.key]) || cfg.stake || (list ? list[0] : 50);
    stake = list ? (list.indexOf(want) >= 0 ? want : list[0]) : want;
    open_ = true;
    const P = CBZ.player;
    at.x = P && P.pos ? P.pos.x : 0; at.z = P && P.pos ? P.pos.z : 0; at.t = (CBZ.now || 0);
    if (!draw()) { open_ = false; cfg = null; return false; }
    return true;
  }
  // quiet: no onClose (the flow goes on); keepPaper: the sheet is about to be redrawn as the ticket
  function close(quiet, keepPaper) {
    if (!open_) return;
    open_ = false;
    const done = cfg && cfg.onClose;
    cfg = null;
    if (!keepPaper && CBZ.cityPaper) CBZ.cityPaper.down("betslip");
    if (done && !quiet) done();
  }

  /* THE PEN. While the slip is in your hands its verbs are on it: a target
     at arm's length in front of you (city/interactions.js): I hands it in,
     K marks the next one, L raises the stake, the wheel has the rest, and a
     tap does the same. E, J, Esc and a tap lower a held paper
     (city/hitman_hands.js); the slip is still yours, and marking it or
     "Look at the slip" raises it again. */
  let wired = false;
  const tok = { x: 0, z: 0, pos: { x: 0, y: 1.3, z: 0 } };
  function wire() {
    const I = CBZ.interactions;
    if (wired || !I || !I.registerZone) return;
    wired = true;
    I.registerZone({
      // a "ped:" layer makes the card treat the slip like a person: its verbs
      // take I J K L (a thing's verbs are only E and the wheel, and E and J
      // are the keys that put a held paper down)
      id: "betslip", kind: "betslip", prio: 60, islands: true, layers: ["ped:slip"],
      find: function (px, pz) {
        const P = CBZ.player;
        if (!open_ || !P || !P.pos || Math.hypot(px - P.pos.x, pz - P.pos.z) > 2.5) return null;
        // ahead of you and a little to the left: the sheet stands on the right
        const yaw = CBZ.cam ? CBZ.cam.yaw : 0, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        tok.x = tok.pos.x = P.pos.x + fx * 1.4 + fz * 0.55;
        tok.z = tok.pos.z = P.pos.z + fz * 1.4 - fx * 0.55;
        tok.pos.y = (P.pos.y || 0) + 1.35;
        return tok;
      },
      options: [
        { id: "betslip-place", prio: 9, forceYes: true, campaignSafe: true,
          label: function () { const p = curPick(); return asIs("Hand it in, " + money(stake) + " on " + (p ? p.label : "")); },
          canShow: function () { return !!cfg && !!curPick() && !cfg.locked; }, onSelect: place },
        { id: "betslip-drop", prio: 8, forceYes: true, campaignSafe: true, label: function () { return asIs("Tear it up"); },
          canShow: function () { return !!cfg; }, onSelect: function () { close(); } },
        { id: "betslip-look", prio: 8.5, forceYes: true, campaignSafe: true, label: function () { return asIs("Look at the slip"); },
          canShow: function () { return !!cfg && !(CBZ.cityPaper && CBZ.cityPaper.isUp("betslip")); }, onSelect: function () { draw(); } },
        { id: "betslip-next", prio: 7, forceYes: true, campaignSafe: true, label: function () { return asIs("Mark the next one"); },
          canShow: function () { return !!cfg && (cfg.picks || []).length > 1; }, onSelect: nextPick },
        { id: "betslip-up", prio: 6, forceYes: true, campaignSafe: true, label: function () { return asIs("Stake " + money(stakeStep(1))); },
          canShow: function () { return !!cfg && stakeStep(1) !== stake; }, onSelect: function () { setStake(1); } },
        { id: "betslip-down", prio: 5, forceYes: true, campaignSafe: true, label: function () { return asIs("Stake " + money(stakeStep(-1))); },
          canShow: function () { return !!cfg && stakeStep(-1) !== stake; }, onSelect: function () { setStake(-1); } },
        { id: "betslip-skip", prio: 4, forceYes: true, campaignSafe: true, label: function () { return asIs((cfg && cfg.skip && cfg.skip.label) || "No bet"); },
          canShow: function () { return !!(cfg && cfg.skip); }, onSelect: skip },
      ],
    });
    if (I.describe) I.describe("betslip", function () { return { label: (cfg && cfg.title) || "Bet slip", note: money(g.cash || 0) + " on you" }; });
  }
  if (CBZ.onUpdate) CBZ.onUpdate(46.8, function () {
    if (!wired) wire();
    if (!open_) return;
    const P = CBZ.player;
    if (g.state !== "playing" || (P && P.dead)) { close(true); return; }
    // walked away from the window, or held it too long: no bet
    if ((CBZ.now || 0) - at.t > SLIP_HOLD || (P && P.pos && Math.hypot(P.pos.x - at.x, P.pos.z - at.z) > SLIP_REACH)) close();
  });

  // the venue's event is over: pay the ticket (if it won) and book it
  function settle(ticket, won, opts) {
    if (!ticket) return 0;
    opts = opts || {};
    const pay = won ? Math.round(ticket.stake * ticket.odds) : 0;
    if (pay > 0) {
      if (opts.pay) opts.pay(pay);
      else if (CBZ.city && CBZ.city.addCash) CBZ.city.addCash(pay);
    }
    if (CBZ.cityEvent) {
      CBZ.cityEvent("bet", { stake: ticket.stake, profit: pay - ticket.stake, faction: opts.faction || null, factionDelta: opts.faction ? (won ? -1 : 1) : 0 }, { silent: true });
    }
    return pay;
  }

  CBZ.betSlip = { open, close: function () { close(); }, isOpen: function () { return open_; }, settle, state: function () { return cfg ? { pick: pickId, stake: stake, picks: (cfg.picks || []).length } : null; } };

  /* ============================================================
     THE RACEPARK WINDOWS: dogs and horses at the "racepark" lot. A card of
     six runners with odds off their form; the race runs while you wait at
     the rail and the ticket settles at the finish. The track's own
     heat: a fixing rumour means the favourite sometimes gets pulled.
  ============================================================ */
  const HORSES = ["Copper Kettle", "Midnight Ledger", "Sal's Gamble", "Dockside Rose", "Iron Wager", "Lucky Ashtray", "Parade Rest", "Gin Rummy"];
  const DOGS = ["Tin Rabbit", "Knuckles", "Blue Streak", "Mrs Biscuit", "Nine Lives", "Rocket Sal", "Gravel", "Fast Eddie"];
  const TRACK = { card: null, ticket: null, runT: 0, who: null };
  function newCard(kind) {
    const names = (kind === "dogs" ? DOGS : HORSES).slice().sort(() => Math.random() - 0.5).slice(0, 6);
    const form = names.map(() => 0.5 + Math.random());
    const sum = form.reduce((a, b) => a + b, 0);
    return {
      kind, runners: names.map((n, i) => {
        const p = form[i] / sum;
        return { id: String(i), label: n, p, odds: Math.max(1.3, Math.round((0.86 / p) * 10) / 10) };
      }),
    };
  }
  function trackBook(kind, who) {
    kind = kind === "dogs" ? "dogs" : "horses";
    TRACK.who = who || null;
    if (TRACK.ticket) { if (!say(who, "Your ticket's on " + TRACK.ticket.label + ". Wait for the finish.")) note("Your ticket is on " + TRACK.ticket.label + ". Wait for the finish.", 2.2); return; }
    say(who, "Six going in the next. Mark your card.");
    TRACK.card = newCard(kind);
    open({
      key: "track", title: kind === "dogs" ? "Dog track window" : "Horse track window",
      sub: "Next race, six runners. Win only.",
      picks: TRACK.card.runners.map((r) => ({ id: r.id, label: r.label, odds: r.odds, sub: kind === "dogs" ? "trap " + (+r.id + 1) : "post " + (+r.id + 1) })),
      stakes: [20, 50, 100, 250, 500],
      onPlace: function (p, s, o) {
        TRACK.ticket = { id: p.id, label: p.label, stake: s, odds: o, kind };
        TRACK.runT = 14 + Math.random() * 6;
        if (!say(TRACK.who, p.label + ". They go off in a moment.")) note("Ticket on " + p.label + ". They go off in a moment.", 3);
      },
    });
  }
  CBZ.cityTrackBook = trackBook;
  if (CBZ.onUpdate) {
    CBZ.onUpdate(38.61, function (dt) {
      const t = TRACK.ticket; if (!t || g.mode !== "city") return;
      TRACK.runT -= dt;
      if (TRACK.runT > 0) return;
      const rs = TRACK.card.runners;
      let r = Math.random() * rs.reduce((a, b) => a + b.p, 0), win = rs[0];
      for (const x of rs) { r -= x.p; if (r <= 0) { win = x; break; } }
      TRACK.ticket = null;
      const won = win.id === t.id;
      const pay = settle(t, won, { faction: "casino" });
      if (CBZ.cityEvent) CBZ.cityEvent("race-finish", { race: t.kind === "dogs" ? "greyhound" : "horse", win: won, profit: pay - t.stake }, { silent: true });
      const line = won ? (win.label + " wins it. Your ticket pays " + money(pay) + ".") : (win.label + " wins it. " + t.label + " ran out of the money.");
      // the window calls it if you are still at it; otherwise you hear later
      const w = TRACK.who, P = CBZ.player;
      if (!(w && !w.dead && P && Math.hypot(w.pos.x - P.pos.x, w.pos.z - P.pos.z) < 14 && say(w, line, 3.6))) note(line, 3.4);
    });
  }
})();
