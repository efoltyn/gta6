/* ============================================================
   city/betslip.js - THE ONE BET SLIP.

   Every wager in the city is written on this slip, at the venue that takes
   it: the Ironjaw Arena ringside and pit (city/arena_fights.js), the
   Southpaw Palace bookmaker (games/boxing.js), the APEX Night bookmaker
   (games/racing.js), the Speedway race book downtown
   (city/island_speedway.js) and the dog and horse windows at the racepark
   (below). There used to be five separately drawn betting screens (plus a
   sportsbook, fight-night and track-bet menu on the old Gang Life board,
   now deleted); they all did the same thing with different stake rules and
   none of them wrote the betting ledger.

   ONE FLOW:
     open(cfg)   the slip: pick a runner/side, set a stake, place it. The
                 slip takes the money (cfg.spend or the one wallet) and hands
                 the venue a ticket via cfg.onPlace(pick, stake, odds).
     settle(t, won, opts)  the venue calls this when ITS event ends. Pays
                 stake x odds on a win (opts.pay or CBZ.city.addCash) and
                 writes the worldstate betting record (cityEvent "bet").
   The venue keeps what only it knows: who is running, the odds, when the
   result is in, and what the bookmaker says.

   cfg = {
     key      remembers the last stake per venue
     title, sub
     picks    [{ id, label, odds, sub?, color? }]
     pick     preselected pick id
     stakes   preset stake list  OR  min/max/step/stake for a stepper
     ticket   text of a live ticket (shown on the slip)
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
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function note(m, s) { if (CBZ.city && CBZ.city.note) CBZ.city.note(m, s || 2.4); }
  function odd(o) { o = +o || 0; return (Math.round(o * 100) / 100).toFixed(o % 1 ? 2 : 1); }

  const lastStake = Object.create(null);
  let el = null, cfg = null, pickId = null, stake = 0, open_ = false, msg = "";

  function ensure() {
    if (el || typeof document === "undefined" || !document.body) return el;
    el = document.createElement("div");
    el.id = "betSlip";
    el.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;display:none;" +
      "width:min(460px,94vw);max-height:86vh;overflow:auto;box-sizing:border-box;padding:14px 18px 14px;" +
      "background:linear-gradient(180deg,rgba(24,22,18,.97),rgba(14,13,11,.97));border:1px solid rgba(232,182,76,.35);" +
      "border-radius:14px;color:#f3ecdc;font-family:Fredoka,system-ui,sans-serif;box-shadow:0 22px 60px rgba(0,0,0,.6);pointer-events:auto";
    el.addEventListener("click", function (e) {
      const b = e.target && e.target.closest ? e.target.closest("[data-act]") : null;
      if (!b || b.disabled) return;
      e.preventDefault(); e.stopPropagation();
      act(b.getAttribute("data-act"), b.getAttribute("data-v"));
    });
    document.body.appendChild(el);
    addEventListener("keydown", function (e) {
      if (!open_) return;
      if ((e.key || "").toLowerCase() === "escape") { e.preventDefault(); e.stopPropagation(); close(); }
    }, true);
    return el;
  }

  function stakeList() { return Array.isArray(cfg.stakes) && cfg.stakes.length ? cfg.stakes : null; }
  function curPick() { return (cfg.picks || []).find((p) => String(p.id) === String(pickId)) || null; }

  function act(a, v) {
    if (!cfg) return;
    if (a === "close") { close(); return; }
    if (a === "pick") { pickId = v; msg = ""; render(); return; }
    if (a === "stake") { stake = +v || stake; msg = ""; render(); return; }
    if (a === "down" || a === "up") {
      const step = cfg.step || 25, lo = cfg.min || step, hi = cfg.max || 5000;
      stake = Math.max(lo, Math.min(hi, stake + (a === "up" ? step : -step)));
      msg = ""; render(); return;
    }
    if (a === "skip") { const s = cfg.skip; close(true); if (s && s.fn) s.fn(); return; }
    if (a === "place") {
      if (cfg.locked) { msg = cfg.locked; render(); return; }
      const p = curPick();
      if (!p) { msg = "Pick one first."; render(); return; }
      const spend = cfg.spend || function (n) { return !!(CBZ.city && CBZ.city.spend && CBZ.city.spend(n)); };
      if (!spend(stake)) { msg = "You can't cover " + money(stake) + "."; render(); return; }
      if (cfg.key) lastStake[cfg.key] = stake;
      const onPlace = cfg.onPlace;
      close(true);
      if (onPlace) onPlace(p, stake, +p.odds);
    }
  }

  function btn(label, a, v, on, disabled, tone) {
    const bg = disabled ? "rgba(255,255,255,.04)" : on ? (tone || "#8a6a1f") : "rgba(255,255,255,.07)";
    return "<button data-act='" + a + "'" + (v != null ? " data-v='" + esc(v) + "'" : "") + (disabled ? " disabled" : "") +
      " style='border:1px solid " + (on ? "#e8b64c" : "#3c3a33") + ";background:" + bg + ";color:" + (disabled ? "#6d685c" : "#f3ecdc") +
      ";border-radius:9px;padding:7px 11px;margin:3px;cursor:" + (disabled ? "default" : "pointer") + ";font:600 13px Fredoka,system-ui,sans-serif'>" + label + "</button>";
  }

  function render() {
    if (!el || !cfg) return;
    const p = curPick();
    let h = "<div style='display:flex;justify-content:space-between;align-items:flex-start;gap:10px'>" +
      "<div><div style='font-size:19px;font-weight:700;color:#e8b64c'>" + esc(cfg.title || "Bet slip") + "</div>" +
      (cfg.sub ? "<div style='font-size:12px;color:#a59c88;margin-top:2px'>" + esc(cfg.sub) + "</div>" : "") + "</div>" +
      "<div style='text-align:right;font-size:11px;color:#a59c88'>CASH<div style='font-size:16px;font-weight:700;color:#7ed957'>" + money(g.cash || 0) + "</div></div></div>";
    if (cfg.ticket) h += "<div style='margin:8px 0 2px;font-size:13px;color:#ffd166'>" + esc(cfg.ticket) + "</div>";
    h += "<div style='margin:10px 0 4px;display:flex;flex-direction:column;gap:4px'>";
    for (const r of cfg.picks || []) {
      const on = p && String(p.id) === String(r.id);
      h += "<button data-act='pick' data-v='" + esc(r.id) + "' style='display:flex;justify-content:space-between;align-items:center;gap:10px;text-align:left;" +
        "border:1px solid " + (on ? "#e8b64c" : "#3c3a33") + ";background:" + (on ? "rgba(232,182,76,.16)" : "rgba(255,255,255,.04)") +
        ";color:#f3ecdc;border-radius:9px;padding:7px 10px;cursor:pointer;font:500 13.5px Fredoka,system-ui,sans-serif'>" +
        "<span><b style='color:" + (r.color || "#f3ecdc") + "'>" + esc(r.label) + "</b>" + (r.sub ? "<span style='display:block;font-size:11px;color:#a59c88'>" + esc(r.sub) + "</span>" : "") + "</span>" +
        "<b style='color:#e8b64c;white-space:nowrap'>" + odd(r.odds) + "x</b></button>";
    }
    h += "</div>";
    const list = stakeList();
    h += "<div style='margin:8px 0 2px;font-size:11px;color:#a59c88;text-transform:uppercase;letter-spacing:.06em'>Stake</div><div style='display:flex;flex-wrap:wrap;align-items:center'>";
    if (list) for (const s of list) h += btn(money(s), "stake", s, s === stake, (g.cash || 0) < s);
    else h += btn("-" + money(cfg.step || 25), "down") + "<b style='min-width:78px;text-align:center;font-size:16px;color:#ffd166'>" + money(stake) + "</b>" + btn("+" + money(cfg.step || 25), "up");
    h += "</div>";
    if (p) h += "<div style='font-size:12.5px;color:#cfc6b2;margin-top:6px'>" + esc(p.label) + " wins, the ticket pays " + money(Math.round(stake * p.odds)) + ".</div>";
    h += "<div style='display:flex;justify-content:flex-end;flex-wrap:wrap;margin-top:10px'>" +
      (cfg.skip ? btn(esc(cfg.skip.label || "No bet"), "skip") : "") +
      btn("Place bet", "place", null, true, !!cfg.locked || !p || (g.cash || 0) < stake, "#2f7d4a") +
      btn("Close", "close") + "</div>";
    if (msg || cfg.locked) h += "<div style='font-size:12.5px;color:#ffcf7a;margin-top:6px;min-height:1em'>" + esc(msg || cfg.locked) + "</div>";
    el.innerHTML = h;
  }

  function open(c) {
    if (!c || !ensure()) return false;
    if (open_) close(true);
    if (CBZ.cityCloseShop) CBZ.cityCloseShop();   // opened from a venue counter
    cfg = c; msg = "";
    const picks = cfg.picks || [];
    pickId = cfg.pick != null ? cfg.pick : (picks.length === 1 ? picks[0].id : null);
    const list = stakeList();
    const want = (cfg.key && lastStake[cfg.key]) || cfg.stake || (list ? list[0] : 50);
    stake = list ? (list.indexOf(want) >= 0 ? want : list[0]) : want;
    open_ = true;
    el.style.display = "block";
    CBZ.cityMenuOpen = true;
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    render();
    return true;
  }
  function close(quiet) {
    if (!open_) return;
    open_ = false;
    const done = cfg && cfg.onClose;
    cfg = null;
    if (el) { el.style.display = "none"; el.innerHTML = ""; }
    CBZ.cityMenuOpen = false;
    if (CBZ.requestLock && g.state === "playing") { try { CBZ.requestLock(); } catch (e) {} }
    if (done && !quiet) done();
  }

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

  CBZ.betSlip = { open, close: function () { close(); }, isOpen: function () { return open_; }, settle };

  /* ============================================================
     THE RACEPARK WINDOWS: dogs and horses at the "racepark" lot. A card of
     six runners with odds off their form; the race runs while you wait at
     the rail and the ticket settles at the finish. The track's own
     heat: a fixing rumour means the favourite sometimes gets pulled.
  ============================================================ */
  const HORSES = ["Copper Kettle", "Midnight Ledger", "Sal's Gamble", "Dockside Rose", "Iron Wager", "Lucky Ashtray", "Parade Rest", "Gin Rummy"];
  const DOGS = ["Tin Rabbit", "Knuckles", "Blue Streak", "Mrs Biscuit", "Nine Lives", "Rocket Sal", "Gravel", "Fast Eddie"];
  const TRACK = { card: null, ticket: null, runT: 0 };
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
  function trackBook(kind) {
    kind = kind === "dogs" ? "dogs" : "horses";
    if (TRACK.ticket) { note("Your ticket is on " + TRACK.ticket.label + ". Wait for the finish.", 2.2); return; }
    TRACK.card = newCard(kind);
    open({
      key: "track", title: kind === "dogs" ? "Dog track window" : "Horse track window",
      sub: "Next race, six runners. Win only.",
      picks: TRACK.card.runners.map((r) => ({ id: r.id, label: r.label, odds: r.odds, sub: kind === "dogs" ? "trap " + (+r.id + 1) : "post " + (+r.id + 1) })),
      stakes: [20, 50, 100, 250, 500],
      onPlace: function (p, s, o) {
        TRACK.ticket = { id: p.id, label: p.label, stake: s, odds: o, kind };
        TRACK.runT = 14 + Math.random() * 6;
        note("Ticket on " + p.label + ". They go off in a moment, stay by the rail.", 3);
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
      note(won ? (win.label + " wins it. Your ticket pays " + money(pay) + ".") : (win.label + " wins it. " + t.label + " ran out of the money."), 3.4);
    });
  }
})();
