/* ============================================================
   city/phone.js — "📱 PHONE": a read-only status / info hub for city mode.

   Press [P] in city mode to open a modal full of "apps" (cards) that mirror
   real game systems so every stat answers a "why":
     • WANTED   — stars, heat, crime label, body count, mask, heat-to-next-star
     • TERRITORY— per-gang district control, takeover leader, your share of 9
     • EMPIRE   — cash, bank, respect, home, car business notoriety
     • MARKETS  — sim/market.js's 6 category prices + sim/econstate.js's CPI/
                  activity/employment/treasury, each row with a tiny inline
                  sparkline (E3 legibility: the invisible economy, on your phone);
                  sibling cards 💱 CURRENCY EXCHANGE (M2), 🏦 CENTRAL BANKS
                  (M3: policy rate/independence/governor per country),
                  📉 INFLATION (M4: real π%/yr per country + sparkline,
                  republic sorted first), and 🏛 SOVEREIGN BONDS (M5: active
                  series by country — coupon, days to maturity, $ on offer —
                  BUY at par, your holdings) all ride here too
     • CREW     — your founded gang: name, live members, turf held
     • VITALS   — HP, hunger, tiredness, injuries

   Pure display: every CBZ.* read is feature-detected so the panel can never
   throw if a system isn't loaded. Follows the documented city modal pattern.

   Exposes: CBZ.cityOpenPhone.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  // ---- palette --------------------------------------------------------------
  const GREEN = "#7ed957", GOLD = "#ffd451", RED = "#ff5b5b", CYAN = "#7fd0ff", DIM = "#8a93a3";

  let panel = null, body = null, noticeBadge = null, open_ = false, lastRender = 0;
  const noticeLog = [];
  let noticeUnread = 0;
  const NOTICE_CAP = 40;
  const CONTROL_COPY_RE = /\[[A-Za-z0-9/\- ]{1,8}\]|\b(?:press|click|hold|tap)\b|\bLMB\b|\bRMB\b|Shift\+|\bWASD\b/i;
  const META_COPY_RE = /\b(?:NPC|HUD|UI|reticle|crosshair|respawn(?:ing)?|game over|tutorial|keybind|hotbar|controller|keyboard|mouse|frame ?rate|FPS|first[- ]person|third[- ]person)\b/i;
  // E6: which stock ticker (if any) has its detail view expanded in the
  // MARKETS app right now — null when every row is collapsed. A transient
  // one-line status message (trade success/failure) rides alongside it.
  let stockOpen = null, stockMsg = "";
  // M5: a transient one-line status message for the SOVEREIGN BONDS card's
  // BUY buttons — same idiom as stockMsg just above.
  let bondMsg = "";

  // ---- small helpers --------------------------------------------------------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function num(n, d) { return (typeof n === "number" && isFinite(n)) ? n : (d || 0); }
  function money(n) { return "$" + Math.round(num(n)).toLocaleString(); }
  function hex6(c) { return "#" + (num(c) >>> 0).toString(16).padStart(6, "0"); }
  function pct(v) { return Math.max(0, Math.min(100, Math.round(num(v)))) + "%"; }
  function clockLabel() {
    try { return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
    catch (e) { return "now"; }
  }
  function phoneSender(from, app) {
    const s = String(from || "").trim();
    if (!s || /^(status|alert|system)$/i.test(s)) return app === "news" ? "City Desk" : "Messages";
    if (/^objective$/i.test(s)) return "Dispatch";
    return s;
  }
  function updateNoticeBadge() {
    if (!noticeBadge) return;
    noticeBadge.textContent = noticeUnread > 0 ? String(Math.min(99, noticeUnread)) : "";
    noticeBadge.style.display = noticeUnread > 0 ? "inline-flex" : "none";
  }

  // Canonical non-campaign notification sink. It only writes into the handset;
  // it never creates a banner, toast, floating caption or world-space label.
  CBZ.cityPhoneNotify = function (payload) {
    if (typeof payload === "string") payload = { text: payload };
    payload = payload || {};
    const text = String(payload.text != null ? payload.text : (payload.body != null ? payload.body : "")).trim();
    if (!text || CONTROL_COPY_RE.test(text) || META_COPY_RE.test(text)) return null;
    if (typeof CBZ.cityPhoneWorthy === "function" && !CBZ.cityPhoneWorthy(text, payload, false)) return null;
    const app = String(payload.app || "messages").toLowerCase();
    const from = phoneSender(payload.from, app);
    const now = Date.now();
    const last = noticeLog.length ? noticeLog[noticeLog.length - 1] : null;
    if (last && last.text === text && last.from === from && now - last.born < 5000) {
      last.born = now; last.time = clockLabel();
      if (open_) render();
      return last;
    }
    const item = { app: app, from: from, text: text, time: clockLabel(), born: now };
    noticeLog.push(item);
    if (noticeLog.length > NOTICE_CAP) noticeLog.splice(0, noticeLog.length - NOTICE_CAP);
    if (!open_) noticeUnread++;
    updateNoticeBadge();
    if (open_) render();
    return item;
  };
  // Read-only seam for tests and other phone surfaces that want the same news.
  CBZ.cityPhoneNews = noticeLog;

  // a label / value row
  function row(label, value, color) {
    return "<div style='display:flex;justify-content:space-between;gap:10px;align-items:baseline;padding:2px 0'>" +
      "<span style='color:" + DIM + ";font-size:12px'>" + esc(label) + "</span>" +
      "<span style='color:" + (color || "#e8eef7") + ";font-weight:600;font-size:13px;text-align:right'>" + value + "</span>" +
      "</div>";
  }
  // a labelled progress bar
  function bar(frac, color, note) {
    frac = Math.max(0, Math.min(1, num(frac)));
    return "<div style='margin:6px 0 2px'>" +
      "<div style='height:8px;background:rgba(255,255,255,.08);border-radius:5px;overflow:hidden'>" +
      "<div style='height:100%;width:" + (frac * 100) + "%;background:" + (color || CYAN) + "'></div></div>" +
      (note ? "<div style='font-size:11px;color:" + DIM + ";margin-top:3px'>" + esc(note) + "</div>" : "") +
      "</div>";
  }
  // a card wrapper with a cyan header
  function card(header, inner) {
    return "<div style='background:rgba(255,255,255,.04);border-radius:10px;padding:10px 12px;margin-bottom:8px'>" +
      "<div style='color:" + CYAN + ";font-weight:700;font-size:13px;letter-spacing:.4px;margin-bottom:6px'>" + esc(header) + "</div>" +
      inner + "</div>";
  }
  function noticesApp() {
    if (!noticeLog.length) return "";
    let inner = "";
    const recent = noticeLog.slice(-14).reverse();
    for (let i = 0; i < recent.length; i++) {
      const n = recent[i];
      inner += "<div style='padding:7px 0;border-top:" + (i ? "1px solid rgba(255,255,255,.06)" : "0") + "'>" +
        "<div style='display:flex;justify-content:space-between;gap:10px;font-size:11px;color:" + DIM + "'>" +
        "<b style='color:" + (n.app === "news" ? CYAN : "#c9d2df") + "'>" + esc(n.from) + "</b><span>" + esc(n.time) + "</span></div>" +
        "<div style='font-size:13px;color:#e8eef7;line-height:1.3;margin-top:2px'>" + esc(n.text) + "</div></div>";
    }
    return card("📰 NEWS & MESSAGES", inner);
  }
  function stars(n) {
    n = Math.max(0, Math.min(5, Math.round(num(n))));
    return "<span style='color:" + GOLD + "'>" + "★".repeat(n) + "</span>" +
      "<span style='color:" + DIM + "'>" + "☆".repeat(5 - n) + "</span>";
  }

  // ---- the apps -------------------------------------------------------------
  function wantedApp() {
    const w = num(g.wanted), heat = num(g.heat);
    const T = (CBZ.CITY && CBZ.CITY.starHeat) || [0, 140, 420, 1100, 3200, 12000];
    let inner = row("Wanted level", stars(w));
    inner += row("Heat", Math.round(heat).toLocaleString(), GOLD);
    if (g.cityCrimeLabel) inner += row("Last crime", esc(g.cityCrimeLabel), RED);
    inner += row("Murders", num(g.cityMurders), RED);
    inner += row("Cop kills", num(g.cityCopKills), RED);
    inner += row("Identity", g.cityMasked ? "🎭 Masked (no ID)" : "Face showing", g.cityMasked ? GREEN : DIM);

    // heat progress to the next star
    if (w < 5) {
      const lo = num(T[w]), hi = num(T[w + 1], lo + 1);
      const frac = hi > lo ? (heat - lo) / (hi - lo) : 1;
      inner += bar(frac, RED, "Heat to " + (w + 1) + "★: " + Math.round(heat).toLocaleString() + " / " + hi.toLocaleString());
    } else {
      inner += "<div style='font-size:11px;color:" + RED + ";margin-top:4px'>MAXED OUT — the whole city is hunting you.</div>";
    }
    // flavor answering "why is 5★ hard?" (BUG FIX: the old "helicopter circling"
    // line was assigned first and then ALWAYS overwritten by this if/else —
    // a dead branch. Folded into the 4★ arm so the chopper actually shows.)
    let flavor = "";
    if (w >= 5) flavor = "✈️ AIRSTRIKE inbound — 5★ takes relentless carnage to hold.";
    else if (w === 4) flavor = "🚁 Helicopter circling overhead — one more spree and they call in an airstrike (5★).";
    if (flavor) inner += "<div style='font-size:11px;color:" + DIM + ";margin-top:4px'>" + esc(flavor) + "</div>";
    return card("🚨 WANTED", inner);
  }

  function territoryApp() {
    const ctrl = (typeof CBZ.cityZoneControl === "function") ? CBZ.cityZoneControl() : null;
    const total = ctrl ? num(ctrl.total, 9) : 9;
    const byGang = (ctrl && ctrl.byGang) || {};
    const mine = num(byGang["player"]);
    let inner = row("Districts held", mine + " / " + total, mine > 0 ? GREEN : DIM);
    inner += row("Neutral", ctrl ? num(ctrl.neutral) : "—", DIM);

    const leader = (typeof CBZ.cityTakeoverLeader === "function") ? CBZ.cityTakeoverLeader() : null;
    if (leader) {
      const isYou = leader.id === "player";
      inner += row("Takeover leader",
        esc(leader.name || leader.id) + " (" + num(leader.zones) + "/" + num(leader.total, total) + ")",
        isYou ? GREEN : GOLD);
    }

    const gangs = (CBZ.cityGangs || []).filter(function (x) { return x && !x.absorbed; });
    if (gangs.length) {
      inner += "<div style='margin-top:6px;border-top:1px solid rgba(255,255,255,.06);padding-top:6px'></div>";
      gangs.forEach(function (gn) {
        const held = num(byGang[gn.id], (gn.turf && gn.turf.length) || 0);
        const chip = "<span style='display:inline-block;width:10px;height:10px;border-radius:3px;background:" +
          hex6(gn.color) + ";margin-right:6px;vertical-align:middle'></span>";
        inner += "<div style='display:flex;justify-content:space-between;align-items:center;padding:2px 0;font-size:13px'>" +
          "<span>" + chip + esc(gn.name || gn.id) + (gn.isPlayer ? " <span style='color:" + GREEN + "'>(you)</span>" : "") + "</span>" +
          "<span style='color:" + DIM + ";font-weight:600'>" + held + "</span></div>";
      });
    }
    return card("🗺️ TERRITORY", inner);
  }

  function empireApp() {
    let inner = row("Cash", money(g.cash), GREEN);
    inner += row("Bank", money(g.cityBank), GREEN);
    inner += row("Respect", num(g.respect), "#c792ea");
    if (typeof CBZ.cityNetWorth === "function") {
      try { inner += row("Net worth", money(CBZ.cityNetWorth()), GOLD); } catch (e) {}
    }
    const home = g.cityHome;
    if (home) {
      let h = esc(home.name || "Home");
      if (home.tier != null) h += " · T" + esc(home.tier);
      if (home.sqft) h += " · " + esc(home.sqft) + " sqft";
      inner += row("Home", h, CYAN);
    } else {
      inner += row("Home", "None", DIM);
    }
    const biz = g.cityCarBiz;
    if (biz && (biz.owned || (biz.cars && biz.cars.length) || biz.notoriety)) {
      inner += row("Car yard", (biz.owned ? "Owned" : "Rented") +
        " · " + ((biz.cars && biz.cars.length) || 0) + " cars", CYAN);
      if (biz.notoriety) inner += row("Yard heat", num(biz.notoriety), RED);
    } else {
      inner += row("Car yard", "Not running", DIM);
    }
    return card("🏙️ EMPIRE", inner);
  }

  // ---- MARKETS: the phone's window into the invisible economy (E3 legibility) -
  //      sim/market.js's 6 category price levels + sim/econstate.js's CPI/
  //      activity/employment/treasury, one glance instead of six systems. Each
  //      row gets a tiny inline sparkline (last ≤48 hourly samples) drawn into
  //      a small <canvas> AFTER body.innerHTML is set (a fresh string can't
  //      carry live pixels) — see drawSparklines(), called from render().
  //      DATA/RENDER SPLIT ON PURPOSE: CBZ.market.rows()/CBZ.econState.summary()
  //      are the pure data layer (node-harness-testable); marketsHtml()/
  //      drawSparklines() are DOM/canvas-only and can't be exercised headless.
  function marketsHtml(rowsData, sum) {
    let inner = "";
    if (sum) {
      inner += row("CPI", sum.priceIndex.toFixed(2), CYAN);
      inner += row("Activity", sum.activity.toFixed(2), CYAN);
      inner += row("Employment", pct(sum.employment * 100), sum.employment > 0.8 ? GREEN : (sum.employment < 0.5 ? RED : GOLD));
      inner += row("Treasury", money(sum.treasury), GOLD);
      inner += "<div style='margin:6px 0;border-top:1px solid rgba(255,255,255,.06)'></div>";
    }
    rowsData.forEach(function (r) {
      const col = r.trend === "up" ? GOLD : (r.trend === "down" ? GREEN : DIM);
      const arrow = r.trend === "up" ? "▲" : (r.trend === "down" ? "▼" : "–");
      inner += "<div style='display:flex;justify-content:space-between;align-items:center;padding:3px 0'>" +
        "<span style='font-size:12px;color:" + DIM + "'>" + esc(r.label) + "</span>" +
        "<span style='display:flex;align-items:center;gap:8px'>" +
        "<span style='font-weight:600;font-size:13px;color:" + col + "'>&times;" + r.price.toFixed(2) + " " + arrow + "</span>" +
        "<canvas id='mktSpark_" + esc(r.cat) + "' width='56' height='18' style='display:block'></canvas>" +
        "</span></div>";
    });
    if (!rowsData.length) inner = "<div style='font-size:13px;color:" + DIM + "'>Market data unavailable.</div>";
    // E7: the LBX national index (sim/stocks.js) — a Dow-divisor index over
    // every listed company's price x sharesOutstanding, seeded to start at
    // exactly 100. Absent until at least one company has ever listed.
    const idx = (CBZ.stocks && typeof CBZ.stocks.indexQuote === "function") ? CBZ.stocks.indexQuote() : null;
    if (idx) {
      const idxCol = idx.trend === "up" ? GOLD : (idx.trend === "down" ? GREEN : DIM);
      const idxArrow = idx.trend === "up" ? "▲" : (idx.trend === "down" ? "▼" : "–");
      inner += "<div style='margin:6px 0;border-top:1px solid rgba(255,255,255,.06)'></div>";
      inner += row("LBX index", idx.value.toFixed(1) + " " + idxArrow, idxCol);
    }
    // E5 landed Bunbros alone (one read-only row); E6 made it tappable
    // (sim/stocks.js lists it once outlets exist — detail view: price,
    // sparkline, over/undervalued hint, BUY/SELL buttons, position + P&L).
    // E7: the FULL 8-company roster (+ any player IPOs), one row each —
    // summaryAll() replaces the single summary() read.
    const roster = (CBZ.corps && typeof CBZ.corps.summaryAll === "function") ? CBZ.corps.summaryAll() : [];
    if (roster.length) inner += "<div style='margin:6px 0;border-top:1px solid rgba(255,255,255,.06)'></div>";
    roster.forEach(function (co) {
      const coCol = co.cashTrend === "up" ? GOLD : (co.cashTrend === "down" ? GREEN : DIM);
      const coArrow = co.cashTrend === "up" ? "▲" : (co.cashTrend === "down" ? "▼" : "–");
      const tradable = !!(CBZ.stocks && typeof CBZ.stocks.quote === "function" && CBZ.stocks.quote(co.tickerSym));
      inner += "<div" + (tradable ? " data-stock='" + esc(co.tickerSym) + "' style='cursor:pointer'" : "") + ">" +
        row(co.tickerSym + " · " + co.name, money(co.dailyEarnings) + "/day " + coArrow, coCol) + "</div>";
      if (tradable && stockOpen === co.tickerSym) inner += stockDetailHtml(co.tickerSym);
    });
    return card("📈 MARKETS", inner);
  }
  // ---- STOCK DETAIL — sim/stocks.js's data layer (quote()/position()) laid
  // out the same card-with-rows way every other app here does. A tiny
  // <canvas> sparkline (painted post-render by drawStockSpark(), same
  // DOM/canvas-only split as drawSparklines() above) and five trade buttons.
  function tradeBtn(sym, action, n, label) {
    return "<div data-trade='" + esc(action) + "' data-sym='" + esc(sym) + "' data-n='" + n + "' " +
      "style='background:rgba(126,217,87,.14);border:1px solid #4a8a3a;border-radius:8px;padding:6px 10px;" +
      "font-size:12px;font-weight:700;color:#dff5d0;cursor:pointer'>" + esc(label) + "</div>";
  }
  function stockDetailHtml(sym) {
    const Q = CBZ.stocks.quote(sym);
    if (!Q) return "";
    const pos = (typeof CBZ.stocks.position === "function") ? CBZ.stocks.position(sym) : null;
    const hint = Q.valuation === "over" ? "Overvalued vs. fundamentals" :
      (Q.valuation === "under" ? "Undervalued vs. fundamentals" : "Fairly valued vs. fundamentals");
    const hintCol = Q.valuation === "over" ? RED : (Q.valuation === "under" ? GREEN : DIM);
    let inner = "<div style='margin:8px 0 4px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)'>";
    inner += row("Price", "$" + Q.price.toFixed(2), CYAN);
    inner += row("Fair value (anchor)", "$" + Q.anchor.toFixed(2), DIM);
    inner += "<div style='font-size:11px;color:" + hintCol + ";margin:2px 0 6px'>" + esc(hint) + "</div>";
    // E8: the founder line — sim/billionaires.js mints a persistent
    // shareholder NPC per company (co.founderSid); "estate-held" once one
    // has been assassinated without an heir (co.founderSid goes null).
    const foundCo = (CBZ.corps && typeof CBZ.corps.list === "function") ? CBZ.corps.list().find(function (c) { return c.tickerSym === sym; }) : null;
    if (foundCo && foundCo.founderSid && CBZ.billionaires && typeof CBZ.billionaires.netWorthOf === "function") {
      const fLive = CBZ.cityLedgerLive && CBZ.cityLedgerLive(foundCo.founderSid);
      const fEntry = !fLive && CBZ.cityLedgerEntry ? CBZ.cityLedgerEntry(foundCo.founderSid) : null;
      const fName = (fLive && fLive.name) || (fEntry && fEntry.name) || "Unknown";
      inner += row("Founder", fName + " · " + money(CBZ.billionaires.netWorthOf(foundCo.founderSid)), GOLD);
    } else if (foundCo && !foundCo.founderSid) {
      inner += row("Founder", "None (estate-held)", DIM);
    }
    inner += "<canvas id='stockSpark_" + esc(sym) + "' width='260' height='40' style='display:block;margin-bottom:8px'></canvas>";
    if (pos && pos.qty > 0) {
      inner += row("Position", pos.qty + " sh @ avg $" + pos.avgCost.toFixed(2));
      inner += row("Value", money(pos.value), CYAN);
      const pnlCol = pos.pnl >= 0 ? GREEN : RED;
      inner += row("P&L", (pos.pnl >= 0 ? "+" : "") + money(pos.pnl) + " (" + (pos.pnlPct * 100).toFixed(1) + "%)", pnlCol);
    } else {
      inner += "<div style='font-size:11px;color:" + DIM + ";margin:4px 0'>No position.</div>";
    }
    if (stockMsg) inner += "<div style='font-size:11px;color:" + GOLD + ";margin:4px 0'>" + esc(stockMsg) + "</div>";
    inner += "<div style='display:flex;flex-wrap:wrap;gap:6px;margin-top:6px'>";
    inner += tradeBtn(sym, "buy", 10, "BUY 10");
    inner += tradeBtn(sym, "buy", 100, "BUY 100");
    inner += tradeBtn(sym, "sell", 10, "SELL 10");
    inner += tradeBtn(sym, "sell", 100, "SELL 100");
    inner += tradeBtn(sym, "sellall", 0, "SELL ALL");
    inner += "</div></div>";
    return inner;
  }
  function drawStockSpark(sym) {
    if (typeof document === "undefined" || !document.getElementById) return;
    const cv = document.getElementById("stockSpark_" + sym);
    if (!cv || typeof cv.getContext !== "function") return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const Q = CBZ.stocks.quote(sym);
    const w = cv.width || 260, h = cv.height || 40;
    if (ctx.clearRect) ctx.clearRect(0, 0, w, h);
    const hist = Q && Q.history;
    if (!hist || hist.length < 2) return;
    const lo = Math.min.apply(null, hist), hi = Math.max.apply(null, hist);
    const span = (hi - lo) || 0.01;
    ctx.strokeStyle = Q.trend === "up" ? GOLD : (Q.trend === "down" ? GREEN : DIM);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    hist.forEach(function (v, i) {
      const x = (i / (hist.length - 1)) * w;
      const y = h - ((v - lo) / span) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  // paints each category's sparkline canvas from its history ring. Silently a
  // no-op outside a real DOM (no document / no live canvas context) — the node
  // e3 harness only exercises the data layer this feeds (rows()/history()).
  function drawSparklines(rowsData) {
    if (typeof document === "undefined" || !document.getElementById) return;
    rowsData.forEach(function (r) {
      const cv = document.getElementById("mktSpark_" + r.cat);
      if (!cv || typeof cv.getContext !== "function") return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const w = cv.width || 56, h = cv.height || 18;
      if (ctx.clearRect) ctx.clearRect(0, 0, w, h);
      const hist = r.hist;
      if (!hist || hist.length < 2) return;
      const lo = Math.min.apply(null, hist), hi = Math.max.apply(null, hist);
      const span = (hi - lo) || 0.01;
      ctx.strokeStyle = r.trend === "up" ? GOLD : (r.trend === "down" ? GREEN : DIM);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      hist.forEach(function (v, i) {
        const x = (i / (hist.length - 1)) * w;
        const y = h - ((v - lo) / span) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }

  // ---- M2: CURRENCY EXCHANGE — read-only (trading is a real-venue verb, at
  //      the airport FX counter / exchange desk — sim/forex.js) window onto
  //      the 4 foreign currencies' live LBD rate, same row+sparkline idiom
  //      as marketsHtml()/drawSparklines() above, reusing that exact shape.
  function fmtFxRate(r) { return r >= 1 ? r.toFixed(2) : r.toFixed(4); }
  function fxHtml(rowsData) {
    if (!rowsData || !rowsData.length) {
      return card("💱 CURRENCY EXCHANGE", "<div style='font-size:13px;color:" + DIM + "'>No exchange data available.</div>");
    }
    let inner = "<div style='font-size:11px;color:" + DIM + ";margin-bottom:4px'>Quoted vs the Liberty Dollar — trade at an airport FX counter or the exchange desk.</div>";
    rowsData.forEach(function (r) {
      const col = r.trend === "up" ? GOLD : (r.trend === "down" ? GREEN : DIM);
      const arrow = r.trend === "up" ? "▲" : (r.trend === "down" ? "▼" : "–");
      const perDollar = r.rate > 0 ? 1 / r.rate : 0;
      inner += "<div style='padding:3px 0'>" +
        "<div style='display:flex;justify-content:space-between;align-items:center'>" +
        "<span style='font-size:12px;color:" + DIM + "'>" + esc(r.id) + "</span>" +
        "<span style='display:flex;align-items:center;gap:8px'>" +
        "<span style='font-weight:600;font-size:13px;color:" + col + "'>1 " + esc(r.id) + " = $" + fmtFxRate(r.rate) + " " + arrow + "</span>" +
        "<canvas id='fxSpark_" + esc(r.id) + "' width='56' height='18' style='display:block'></canvas>" +
        "</span></div>" +
        "<div style='font-size:10px;color:" + DIM + ";text-align:right'>$1 &asymp; " +
        perDollar.toFixed(perDollar >= 100 ? 0 : (perDollar >= 1 ? 2 : 4)) + " " + esc(r.id) + "</div>" +
        "</div>";
    });
    return card("💱 CURRENCY EXCHANGE", inner);
  }
  // paints each currency's sparkline canvas from its history ring — same
  // DOM/canvas-only split as drawSparklines()/drawStockSpark() above (a
  // no-op outside a real DOM; the node harness only exercises CBZ.forex's
  // own data layer this feeds).
  function drawFxSparklines(rowsData) {
    if (typeof document === "undefined" || !document.getElementById) return;
    (rowsData || []).forEach(function (r) {
      const cv = document.getElementById("fxSpark_" + r.id);
      if (!cv || typeof cv.getContext !== "function") return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const w = cv.width || 56, h = cv.height || 18;
      if (ctx.clearRect) ctx.clearRect(0, 0, w, h);
      const hist = r.history;
      if (!hist || hist.length < 2) return;
      const lo = Math.min.apply(null, hist), hi = Math.max.apply(null, hist);
      const span = (hi - lo) || 0.01;
      ctx.strokeStyle = r.trend === "up" ? GOLD : (r.trend === "down" ? GREEN : DIM);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      hist.forEach(function (v, i) {
        const x = (i / (hist.length - 1)) * w;
        const y = h - ((v - lo) / span) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }

  // ---- M3: CENTRAL BANKS — read-only, one row per country: policy rate,
  //      independence badge, governor, and a captured/suspended flag.
  //      Reuses the exact row idiom every other card here uses; lives on
  //      the phone (not city/bank.js's own branch UI) because that branch
  //      is ONE physical building serving only the republic, while the
  //      phone already aggregates every country in one glanceable list —
  //      the same reasoning M2's own "💱 CURRENCY EXCHANGE" card documents
  //      for why IT lives here instead of only at the FX kiosks.
  function cbHtml(rowsData) {
    if (!rowsData || !rowsData.length) {
      return card("🏦 CENTRAL BANKS", "<div style='font-size:13px;color:" + DIM + "'>No central bank data available.</div>");
    }
    let inner = "";
    rowsData.forEach(function (r) {
      const flag = r.suspended ? " <span style='color:" + RED + "'>🔒 SUSPENDED</span>"
        : r.decreed ? " <span style='color:" + GOLD + "'>⚡ DECREED</span>" : "";
      const indColor = r.independence >= 0.6 ? GREEN : (r.independence >= 0.35 ? GOLD : RED);
      const label = esc(r.name) + (r.governorName ? " · " + esc(r.governorName) : "");
      inner += row(label, (r.policyRate * 100).toFixed(2) + "%" + flag) +
        "<div style='font-size:10px;color:" + DIM + ";text-align:right;margin:-2px 0 4px'>" +
        "independence <span style='color:" + indColor + "'>" + Math.round(r.independence * 100) + "%</span></div>";
    });
    return card("🏦 CENTRAL BANKS", inner);
  }

  // ---- M4: INFLATION — read-only, one row per country: π%/yr + a trailing
  //      sparkline, same row+sparkline idiom marketsHtml()/fxHtml()/cbHtml()
  //      above all use. The republic's own row sorts first (task brief:
  //      "Republic's CPI prominent") — every other country follows in
  //      sim/inflation.js's own list() order.
  function inflHtml(rowsData) {
    if (!rowsData || !rowsData.length) {
      return card("📉 INFLATION", "<div style='font-size:13px;color:" + DIM + "'>No inflation data available.</div>");
    }
    const sorted = rowsData.slice().sort(function (a, b) {
      if (a.id === "republic") return -1;
      if (b.id === "republic") return 1;
      return 0;
    });
    let inner = "";
    sorted.forEach(function (r) {
      const hot = r.pi > 0.05;
      const col = hot ? RED : (r.trend === "up" ? GOLD : (r.trend === "down" ? GREEN : DIM));
      const arrow = r.trend === "up" ? "▲" : (r.trend === "down" ? "▼" : "–");
      inner += "<div style='display:flex;justify-content:space-between;align-items:center;padding:3px 0'>" +
        "<span style='font-size:12px;color:" + DIM + "'>" + esc(r.name || r.id) + "</span>" +
        "<span style='display:flex;align-items:center;gap:8px'>" +
        "<span style='font-weight:600;font-size:13px;color:" + col + "'>" + (r.pi >= 0 ? "+" : "") + (r.pi * 100).toFixed(1) + "%/yr " + arrow + "</span>" +
        "<canvas id='inflSpark_" + esc(r.id) + "' width='56' height='18' style='display:block'></canvas>" +
        "</span></div>";
    });
    return card("📉 INFLATION", inner);
  }
  // paints each country's π sparkline canvas — same DOM/canvas-only split as
  // drawSparklines()/drawFxSparklines() above (a no-op outside a real DOM).
  function drawInflSparklines(rowsData) {
    if (typeof document === "undefined" || !document.getElementById) return;
    (rowsData || []).forEach(function (r) {
      const cv = document.getElementById("inflSpark_" + r.id);
      if (!cv || typeof cv.getContext !== "function") return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const w = cv.width || 56, h = cv.height || 18;
      if (ctx.clearRect) ctx.clearRect(0, 0, w, h);
      const hist = (CBZ.inflation && typeof CBZ.inflation.history === "function") ? CBZ.inflation.history(r.id) : [];
      if (!hist || hist.length < 2) return;
      const lo = Math.min.apply(null, hist), hi = Math.max.apply(null, hist);
      const span = (hi - lo) || 0.0001;
      ctx.strokeStyle = r.trend === "up" ? RED : (r.trend === "down" ? GREEN : DIM);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      hist.forEach(function (v, i) {
        const x = (i / (hist.length - 1)) * w;
        const y = h - ((v - lo) / span) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }

  // ---- M5: SOVEREIGN BONDS — the exchange UI's bond seam, right beside the
  //      MARKETS app's own stock trading (same "read-only rows + trade
  //      buttons" idiom E6/M2/M3/M4 already established on this phone): one
  //      row per ACTIVE series (country, coupon, days to maturity, $ still
  //      on offer this series) with BUY $1k/$10k buttons wired to
  //      CBZ.bonds.buy() (buys at par — the exact price every series
  //      auctions at), plus a compact "your holdings" summary. Coupon/
  //      maturity/default payouts already surface as ordinary cityFeed lines
  //      (sim/bonds.js's own feed calls) — no separate notification system
  //      needed here.
  function bondBtn(seriesId, amount, label) {
    return "<div data-bond='" + esc(seriesId) + "' data-bondamt='" + amount + "' " +
      "style='background:rgba(255,215,118,.14);border:1px solid #a0812f;border-radius:8px;padding:5px 9px;" +
      "font-size:11px;font-weight:700;color:#ffe9b8;cursor:pointer;display:inline-block;margin-right:6px'>" + esc(label) + "</div>";
  }
  function bondsHtml(rowsData, holdings) {
    if (!rowsData || !rowsData.length) {
      let inner = "<div style='font-size:13px;color:" + DIM + "'>No sovereign bonds on offer right now — auctions open when a country's treasury runs a deficit.</div>";
      return card("🏛 SOVEREIGN BONDS", inner);
    }
    let inner = "";
    rowsData.forEach(function (r) {
      inner += "<div style='padding:4px 0;border-top:1px solid rgba(255,255,255,.05)'>";
      inner += row(esc(r.countryName), (r.coupon * 100).toFixed(1) + "% · " + r.daysToMaturity + "d", GOLD);
      inner += "<div style='font-size:10px;color:" + DIM + ";margin:1px 0 4px'>" +
        money(r.available) + " available at par" + (r.playerHolding > 0 ? " · you hold " + money(r.playerHolding) : "") + "</div>";
      if (r.available >= 1000) {
        inner += bondBtn(r.id, 1000, "BUY $1k");
        if (r.available >= 10000) inner += bondBtn(r.id, 10000, "BUY $10k");
      } else if (r.available >= 1) {
        inner += bondBtn(r.id, Math.floor(r.available), "BUY REST");
      }
      inner += "</div>";
    });
    if (holdings && holdings.length) {
      inner += "<div style='margin:8px 0 4px;border-top:1px solid rgba(255,255,255,.08);padding-top:6px;font-size:11px;color:" + DIM + "'>Your holdings</div>";
      holdings.forEach(function (h) {
        const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(h.countryId) : null;
        const label = (rec ? rec.name : h.countryId) + (h.status !== "active" ? " (" + h.status + ")" : "");
        inner += row(label, money(h.amount) + " @ " + (h.coupon * 100).toFixed(1) + "%", h.status === "active" ? GREEN : DIM);
      });
    }
    if (bondMsg) inner += "<div style='font-size:11px;color:" + GOLD + ";margin-top:4px'>" + esc(bondMsg) + "</div>";
    return card("🏛 SOVEREIGN BONDS", inner);
  }

  function crewApp() {
    const pg = g.playerGang;
    if (pg && pg.founded) {
      let members = (pg.members && pg.members.length) || 0;
      if (typeof CBZ.cityPlayerGangMembers === "function") {
        try { members = CBZ.cityPlayerGangMembers().length; } catch (e) {}
      }
      const chip = "<span style='display:inline-block;width:10px;height:10px;border-radius:3px;background:" +
        hex6(pg.color) + ";margin-right:6px;vertical-align:middle'></span>";
      let inner = row("Name", chip + esc(pg.name || "Your crew"), GREEN);
      inner += row("Members", members, members > 0 ? GREEN : DIM);
      inner += row("Turf held", (pg.turf && pg.turf.length) || 0);
      if (pg.treasury != null) inner += row("Treasury", money(pg.treasury), GOLD);
      return card("👥 CREW", inner);
    }
    return card("👥 CREW",
      "<div style='font-size:13px;color:" + DIM + "'>No crew yet.</div>");
  }

  // ---- SERVICES: the phone's first ACTION app. Everything here is a real verb
  //      unlocked by what you OWN — the reason the property ladder matters. The
  //      Spire turns its roof into a helipad and its deck into a hangar, lighting
  //      up "Call Chopper" (aerial fast-travel / getaway) and "Call Airstrike"
  //      (your jet levels a target). Locked rows say WHY so the goal is legible.
  function svcBtn(svc, label, enabled, sub) {
    const bg = enabled ? "rgba(89,194,255,.16)" : "rgba(255,255,255,.04)";
    const bd = enabled ? "#3a7ab0" : "#2c3140";
    const col = enabled ? "#cfeaff" : DIM;
    const cursor = enabled ? "pointer" : "default";
    return "<div data-svc='" + svc + "' data-on='" + (enabled ? 1 : 0) + "' " +
      "style='background:" + bg + ";border:1px solid " + bd + ";border-radius:9px;padding:8px 11px;margin:4px 0;cursor:" + cursor + ";'>" +
      "<div style='color:" + col + ";font-weight:700;font-size:13px'>" + esc(label) + "</div>" +
      (sub ? "<div style='color:" + DIM + ";font-size:11px;margin-top:2px'>" + esc(sub) + "</div>" : "") +
      "</div>";
  }
  function servicesApp() {
    const s = (typeof CBZ.cityAirServices === "function") ? CBZ.cityAirServices() : null;
    let inner = "";
    if (s && s.riding) {
      inner += "<div style='font-size:12px;color:" + GREEN + ";margin-bottom:4px'>🚁 In the air — enjoy the ride.</div>";
    }
    // CHOPPER — comes free with the penthouse
    if (!s || !s.helipad) {
      inner += svcBtn("", "🚁 Call Chopper", false, "Locked — own the APEX PENTHOUSE; a chopper comes parked on its rooftop pad.");
    } else if (s.chopperActive) {
      inner += svcBtn("", "🚁 Chopper inbound…", false, "Walk under it to board. It flies you to your waypoint (or home).");
    } else if (s.chopperCD > 0) {
      inner += svcBtn("", "🚁 Chopper refueling", false, "Ready in " + s.chopperCD + "s.");
    } else {
      inner += svcBtn("chopper", "🚁 Call Chopper", true, "Aerial pickup → flies you to your map waypoint, else home.");
    }
    // HANGAR — the home a stolen F-22 needs. Two ways to own one: the penthouse
    //   deck hangar (bought at home [H]) OR the standalone airport Private Hangar
    //   (bought right here / [G] near the apron). Surface the airport one so the
    //   player can always find a way to buy a hangar without owning the tower.
    const ownsAirportHangar = !!(CBZ.cityStorage && CBZ.cityStorage.owns && (function () { try { return CBZ.cityStorage.owns("hangar"); } catch (e) { return false; } })());
    const hangarProp = (CBZ.cityStorage && CBZ.cityStorage.PROPERTIES) ? CBZ.cityStorage.PROPERTIES.find(function (p) { return p.id === "hangar"; }) : null;
    if (!s || !s.hangar) {
      if (ownsAirportHangar) {
        inner += svcBtn("", "🛩 Private Hangar — owned", false, "Empty hangar at the airport apron. STEAL the F-22 from the military base, then land it inside to keep it.");
      } else if (CBZ.cityStorage && CBZ.cityStorage.buy) {
        inner += svcBtn("buyhangar", "🛩 Buy Private Hangar — " + money(hangarProp ? hangarProp.cost : 1200000), true, "An airport apron hangar — the home a stolen F-22 needs. The penthouse also offers a deck hangar.");
      }
    }
    // AIRSTRIKE — needs a based F-22 (own a hangar, then steal & land the jet)
    if (!s || !s.hangar) {
      inner += svcBtn("", "🎯 Call Airstrike", false,
        "Locked — buy a private or penthouse hangar, steal the F-22, and land it inside to base it.");
    } else if (s.strikeCD > 0) {
      inner += svcBtn("", "🎯 Jet rearming", false, "Ready in " + s.strikeCD + "s.");
    } else {
      inner += svcBtn("strike", "🎯 Call Airstrike", true, "Bombs your waypoint (else your aim). " + money(s.strikeCost) + " · draws police heat.");
    }
    return card("📡 SERVICES", inner);
  }

  // ---- GIG WORK: the phone's honest-money app. The WHY: not every dollar has
  //      to come from a body — you can clock in. CBZ.cityGig (gigs.js, parallel
  //      build) owns the loop; this card is the dispatcher: it lists the gig
  //      lines you can pick up (Delivery / Rideshare / Smuggle), offers fresh
  //      jobs, and lets you ACCEPT one. Fully feature-detected: if cityGig isn't
  //      loaded the card simply says so — nothing else in the phone breaks.
  //
  //      Contract used (all optional, each guarded):
  //        CBZ.cityGig.active()        → the in-progress gig (or null/false)
  //        CBZ.cityGig.offer(kind)     → fresh offer(s) for a line; array or one def
  //        CBZ.cityGig.accept(def)     → take a specific offered def
  //        CBZ.cityGig.lines()         → [{kind,label,sub,pay?}] available gig lines
  //        CBZ.cityGig.cancel()        → drop the active gig
  const GIG_LINES = [
    { kind: "delivery", label: "📦 Delivery", sub: "grab a package · run it across town" },
    { kind: "taxi", label: "🚕 Rideshare", sub: "pick up a fare · drop them at their stop" },
    { kind: "smuggling", label: "🕶️ Smuggle run", sub: "off-book cargo · hot money, hotter heat" },
  ];
  // a clickable gig row. mode "offer" lists a line to fetch work for; mode
  // "accept" is a concrete offered def the player can take right now.
  function gigBtn(mode, key, label, enabled, sub) {
    const bg = enabled ? "rgba(126,217,87,.14)" : "rgba(255,255,255,.04)";
    const bd = enabled ? "#4a8a3a" : "#2c3140";
    const col = enabled ? "#dff5d0" : DIM;
    const cursor = enabled ? "pointer" : "default";
    return "<div data-gig='" + esc(mode) + "' data-gigkey='" + esc(key) + "' data-on='" + (enabled ? 1 : 0) + "' " +
      "style='background:" + bg + ";border:1px solid " + bd + ";border-radius:9px;padding:8px 11px;margin:4px 0;cursor:" + cursor + ";'>" +
      "<div style='color:" + col + ";font-weight:700;font-size:13px'>" + esc(label) + "</div>" +
      (sub ? "<div style='color:" + DIM + ";font-size:11px;margin-top:2px'>" + esc(sub) + "</div>" : "") +
      "</div>";
  }
  // the stage/phase of an active gig, read defensively across plausible field names.
  function gigStage(a) {
    if (!a) return "";
    return String(a.stage || a.phase || a.step || a.state || "active");
  }
  function gigStageHint(a) {
    const s = gigStage(a).toLowerCase();
    if (s.indexOf("pickup") >= 0 || s.indexOf("hail") >= 0 || s.indexOf("offered") >= 0) return "Head to the pickup — the spot's on your map.";
    if (s.indexOf("carry") >= 0 || s.indexOf("ride") >= 0 || s.indexOf("transit") >= 0 || s.indexOf("enroute") >= 0) return "Cargo aboard — get to the drop-off.";
    if (s.indexOf("drop") >= 0 || s.indexOf("deliver") >= 0) return "At the drop — hand it over.";
    return "Job in progress.";
  }
  // cache the last batch of offers we showed, keyed by index, so a click can
  // resolve to the exact def we listed (offers may be objects, not just kinds).
  let gigOffers = [];
  function gigApp() {
    const G = CBZ.cityGig;
    if (!G || typeof G !== "object") {
      return card("💼 GIG WORK",
        "<div style='font-size:13px;color:" + DIM + "'>No gig dispatch available right now.</div>");
    }
    let inner = "";
    // 1) ACTIVE JOB — if one's running, show it + a cancel.
    let active = null;
    try { active = (typeof G.active === "function") ? G.active() : null; } catch (e) { active = null; }
    if (active) {
      const k = String(active.kind || active.line || "gig");
      const line = GIG_LINES.find(function (l) { return l.kind === k; });
      const title = (line ? line.label : "💼 " + k) + (active.pay ? " · " + money(active.pay) : "");
      inner += "<div style='font-size:13px;color:" + GREEN + ";font-weight:700;margin-bottom:2px'>" + esc(title) + "</div>";
      inner += "<div style='font-size:11px;color:" + DIM + ";margin-bottom:6px'>" + esc(gigStageHint(active)) + "</div>";
      if (typeof G.cancel === "function") inner += gigBtn("cancel", k, "✖ Drop this gig", true, "Forfeit the run — no pay.");
      return card("💼 GIG WORK", inner);
    }
    // 2) FRESH OFFERS — if the player has fetched offers for a line, list them.
    if (gigOffers.length) {
      inner += "<div style='font-size:11px;color:" + DIM + ";margin-bottom:4px'>Available jobs:</div>";
      gigOffers.forEach(function (def, i) {
        const lbl = (def && (def.label || def.title)) || "Job #" + (i + 1);
        const sub = (def && (def.sub || def.desc)) || (def && def.pay ? money(def.pay) : "");
        inner += gigBtn("accept", String(i), "✔ " + lbl, true, sub);
      });
      inner += gigBtn("clear", "", "↩ Back to gig lines", true, "");
      return card("💼 GIG WORK", inner);
    }
    // 3) DEFAULT — the menu of gig lines to fetch work for.
    inner += "<div style='font-size:11px;color:" + DIM + ";margin-bottom:4px'>Clock in — pick a line of work:</div>";
    let lines = GIG_LINES;
    if (typeof G.lines === "function") {
      try {
        const ll = G.lines();
        if (Array.isArray(ll) && ll.length) lines = ll.map(function (l) {
          const base = GIG_LINES.find(function (b) { return b.kind === l.kind; });
          return { kind: l.kind, label: l.label || (base && base.label) || l.kind, sub: l.sub || (base && base.sub) || "" };
        });
      } catch (e) {}
    }
    lines.forEach(function (l) {
      inner += gigBtn("offer", l.kind, l.label, typeof G.offer === "function", l.sub);
    });
    return card("💼 GIG WORK", inner);
  }

  function vitalsApp() {
    const p = CBZ.player || {};
    const hp = num(p.hp, 0), maxHp = num(p.maxHp, 100);
    let inner = row("Health", Math.round(hp) + " / " + Math.round(maxHp), hp < maxHp * 0.35 ? RED : GREEN);
    inner += bar(maxHp ? hp / maxHp : 0, hp < maxHp * 0.35 ? RED : GREEN);
    if (g.hunger != null) {
      inner += row("Hunger", pct(g.hunger), num(g.hunger) < 25 ? RED : GREEN);
    }
    if (g.tired != null) {
      inner += row("Tiredness", pct(g.tired), num(g.tired) > 70 ? RED : DIM);
    }
    const injuries = [];
    if (p._legWound) injuries.push("🦵 Leg wound");
    if (p._bleeding) injuries.push("🩸 Bleeding");
    if (injuries.length) inner += row("Injuries", injuries.join(", "), RED);
    return card("❤️ VITALS", inner);
  }

  // ---- render ---------------------------------------------------------------
  function render() {
    if (!body) return;
    let html = noticesApp();
    let marketRows = [];
    let fxRows = [];
    try { html += servicesApp(); } catch (e) {}
    try { html += wantedApp(); } catch (e) {}
    try { html += territoryApp(); } catch (e) {}
    try { html += empireApp(); } catch (e) {}
    try {
      marketRows = (CBZ.market && typeof CBZ.market.rows === "function") ? CBZ.market.rows() : [];
      const sum = (CBZ.econState && typeof CBZ.econState.summary === "function") ? CBZ.econState.summary() : null;
      html += marketsHtml(marketRows, sum);
    } catch (e) {}
    try {
      fxRows = (CBZ.forex && typeof CBZ.forex.list === "function") ? CBZ.forex.list() : [];
      html += fxHtml(fxRows);
    } catch (e) {}
    try {
      const cbRows = (CBZ.centralbank && typeof CBZ.centralbank.list === "function") ? CBZ.centralbank.list() : [];
      html += cbHtml(cbRows);
    } catch (e) {}
    let inflRows = [];
    try {
      inflRows = (CBZ.inflation && typeof CBZ.inflation.list === "function") ? CBZ.inflation.list() : [];
      html += inflHtml(inflRows);
    } catch (e) {}
    try {
      const bondRows = (CBZ.bonds && typeof CBZ.bonds.list === "function") ? CBZ.bonds.list() : [];
      const bondHoldings = (CBZ.bonds && typeof CBZ.bonds.myHoldings === "function") ? CBZ.bonds.myHoldings() : [];
      html += bondsHtml(bondRows, bondHoldings);
    } catch (e) {}
    try { html += gigApp(); } catch (e) {}
    try { html += crewApp(); } catch (e) {}
    try { html += vitalsApp(); } catch (e) {}
    body.innerHTML = html;
    // sparkline canvases only exist now that innerHTML landed — paint them.
    try { drawSparklines(marketRows); } catch (e) {}
    try { drawFxSparklines(fxRows); } catch (e) {}
    try { drawInflSparklines(inflRows); } catch (e) {}
    try { if (stockOpen) drawStockSpark(stockOpen); } catch (e) {}
  }

  // ---- DOM ------------------------------------------------------------------
  function el() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "cityPhone";
    // z-index 40: the legacy-modal band — below the full map (60) and far below
    // the campaign handset (130), so a stale open can never cover either.
    panel.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "z-index:40;display:none;width:min(560px,92vw);max-height:88vh;overflow-y:auto;" +
      "background:rgba(16,18,24,.94);border:2px solid #2c3140;border-radius:16px;" +
      "padding:16px 18px;box-sizing:border-box;color:#e8eef7;" +
      "font-family:Fredoka,system-ui,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.5);pointer-events:auto";

    const head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px";
    head.innerHTML = "<div style='display:flex;align-items:center;gap:8px;font-size:20px;font-weight:800;letter-spacing:.5px'>📱 PHONE" +
      "<span id='cityPhoneUnread' style='display:none;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;box-sizing:border-box;border-radius:10px;background:#d64545;color:white;font-size:10px'>0</span></div>" +
      "<div style='font-size:12px;color:" + DIM + "'>" + esc(clockLabel()) + "</div>";
    panel.appendChild(head);
    noticeBadge = head.querySelector("#cityPhoneUnread");
    updateNoticeBadge();

    body = document.createElement("div");
    panel.appendChild(body);

    // SERVICES buttons fire real verbs. Each closes the phone so you watch the
    // chopper/jet do its thing. Feature-detected so a missing module is inert.
    panel.addEventListener("click", function (e) {
      const t = e.target && e.target.closest ? e.target.closest("[data-svc]") : null;
      if (t && t.getAttribute("data-on") === "1") {
        const svc = t.getAttribute("data-svc");
        if (svc === "chopper" && typeof CBZ.cityCallChopper === "function") { if (CBZ.cityCallChopper()) close(); }
        else if (svc === "strike" && typeof CBZ.cityCallAirstrike === "function") { if (CBZ.cityCallAirstrike()) close(); }
        else if (svc === "buyhangar" && CBZ.cityStorage && typeof CBZ.cityStorage.buy === "function") {
          try {
            const hp = (CBZ.cityStorage.PROPERTIES || []).find(function (p) { return p.id === "hangar"; });
            if (hp) CBZ.cityStorage.buy(hp);
          } catch (e) {}
          render();
        }
        else render();
        return;
      }
      // ---- GIG WORK clicks ----
      const gt = e.target && e.target.closest ? e.target.closest("[data-gig]") : null;
      if (gt && gt.getAttribute("data-on") === "1") {
        const G = CBZ.cityGig;
        const mode = gt.getAttribute("data-gig");
        const key = gt.getAttribute("data-gigkey");
        if (!G) { render(); return; }
        try {
          if (mode === "offer" && typeof G.offer === "function") {
            const res = G.offer(key);
            // offer() may return one def or an array of defs. If it returns
            // nothing truthy, assume it accepted/posted directly — just re-render.
            if (Array.isArray(res)) gigOffers = res.filter(Boolean);
            else if (res) gigOffers = [res];
            else gigOffers = [];
          } else if (mode === "accept" && typeof G.accept === "function") {
            const idx = parseInt(key, 10) || 0;
            const def = gigOffers[idx];
            if (def) { G.accept(def); }
            gigOffers = [];
            close();   // job's on — close the phone, go work it
            return;
          } else if (mode === "clear") {
            gigOffers = [];
          } else if (mode === "cancel" && typeof G.cancel === "function") {
            G.cancel();
            gigOffers = [];
          }
        } catch (err) { gigOffers = []; }
        render();
        return;
      }
      // ---- E6: STOCKS clicks — tap the BUN row to expand/collapse the
      // detail view; tap a BUY/SELL button to trade through sim/stocks.js.
      const sk = e.target && e.target.closest ? e.target.closest("[data-stock]") : null;
      if (sk) {
        const sym = sk.getAttribute("data-stock");
        stockOpen = (stockOpen === sym) ? null : sym;
        stockMsg = "";
        render();
        return;
      }
      const tr = e.target && e.target.closest ? e.target.closest("[data-trade]") : null;
      if (tr) {
        const sym = tr.getAttribute("data-sym");
        const action = tr.getAttribute("data-trade");
        const n = parseInt(tr.getAttribute("data-n"), 10) || 0;
        stockMsg = "";
        if (CBZ.stocks) {
          try {
            let res = null;
            if (action === "buy") res = CBZ.stocks.buy(sym, n);
            else if (action === "sell") res = CBZ.stocks.sell(sym, n);
            else if (action === "sellall" && typeof CBZ.stocks.sellAll === "function") res = CBZ.stocks.sellAll(sym);
            if (res && res.ok === false) {
              stockMsg = res.reason === "cash" ? "Not enough cash." :
                (res.reason === "shares-owned" ? "You only own " + (res.have || 0) + " shares." : "Trade failed.");
            }
          } catch (err) { stockMsg = "Trade failed."; }
        }
        render();
        return;
      }
      // ---- M5: SOVEREIGN BONDS clicks — BUY at par through sim/bonds.js. ----
      const bd = e.target && e.target.closest ? e.target.closest("[data-bond]") : null;
      if (bd) {
        const seriesId = bd.getAttribute("data-bond");
        const amt = parseInt(bd.getAttribute("data-bondamt"), 10) || 0;
        bondMsg = "";
        if (CBZ.bonds && typeof CBZ.bonds.buy === "function") {
          try {
            const res = CBZ.bonds.buy(seriesId, amt);
            if (res && res.ok === false) {
              bondMsg = res.reason === "cash" ? "Not enough cash." :
                (res.reason === "unavailable" ? "That series is no longer on offer." : "Purchase failed.");
            }
          } catch (err) { bondMsg = "Purchase failed."; }
        }
        render();
        return;
      }
    });

    document.body.appendChild(panel);
    return panel;
  }

  // ---- open / close ---------------------------------------------------------
  function open() {
    // MUTUAL EXCLUSION with the full map: taking the phone out puts the map
    // away first — the two overlays never stack (fullmap.open() reciprocates
    // via CBZ.cityClosePhone).
    if (CBZ.fullMap && CBZ.fullMap.active && CBZ.fullMap.close) {
      try { CBZ.fullMap.close(false); } catch (e) {}
    }
    if (CBZ.cityMenuOpen) return;
    open_ = true; CBZ.cityMenuOpen = true;
    el().style.display = "block";
    noticeUnread = 0;
    updateNoticeBadge();
    render();
    if (document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
  }
  function close() {
    if (!open_) return;   // no-op unless we own the menu lock (callers may probe)
    open_ = false;
    if (panel) panel.style.display = "none";
    CBZ.cityMenuOpen = false;
    // skip the relock while the full map owns the cursor (it opened over us)
    if (CBZ.requestLock && g.state === "playing" && !(CBZ.fullMap && CBZ.fullMap.active)) CBZ.requestLock();
  }
  CBZ.cityOpenPhone = open;
  CBZ.cityClosePhone = close;   // fullmap.js calls this when the map opens

  // ---- live re-render while open (~3/sec) -----------------------------------
  CBZ.onUpdate(50.5, function (dt) {
    if (g.mode !== "city" || !open_) return;
    lastRender += num(dt);
    if (lastRender < 0.33) return;
    lastRender = 0;
    render();
  });

  // ---- key: [P] toggles ------------------------------------------------------
  addEventListener("keydown", function (e) {
    if (g.mode !== "city" || g.state !== "playing") return;
    // The story campaign owns a physical, cross-mode phone (missions/messages/
    // news). Do not open the legacy city-dashboard modal on the same [P] press.
    if (CBZ.cityCampaignActive && CBZ.cityCampaignActive()) return;
    const k = (e.key || "").toLowerCase();
    if (open_) {
      if (k === "escape" || k === "p") { e.preventDefault(); close(); }
      return;
    }
    if (k === "p" && !e.repeat && !CBZ.cityMenuOpen && !(CBZ.player && CBZ.player.driving)) {
      e.preventDefault(); open();
    }
  });
})();
