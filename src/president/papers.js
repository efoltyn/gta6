/* ============================================================
   president/papers.js — THE PAGES OF THE PRESIDENT'S BRIEFING BOOK.

   OWNER (2026-10-28): "There's documents on the desk that go down past the
   bottom of the page, and you can't scroll. It shouldn't be a scroll, it
   should be changing pages or something realistic."

   So every page is ONE real page (PAGE_W x PAGE_H, a letter sheet's
   proportions) and everything on it is laid out to fit inside its margins.
   There is no scroll anywhere. A subject that does not fit one page is two
   pages. The book (city/president_book.js) binds them, turns them and puts
   your finger on them; this file only paints.

     brief     the morning: the date, the four numbers that matter, the war,
               what the papers say
     budget    what the state spends and takes; the boxes are the decisions
     trade     every good: made, used, the price; who we buy from and sell to
     cabinet   the five people under you, how loyal, and Fire
     home      the country's temper and what you can do about it
     world     the world map; tap a country
     country   the country you picked: who runs it, what it means to us, and
               what you can do to it

   The words are short and real. A box is a decision; nothing is greyed out
   and nothing is locked: what you can afford and who obeys decide what
   happens after you tick it.

   Canvas only, no THREE, no DOM beyond the canvas it is handed.
   PUBLIC  CBZ.presPapers = { PAGE_W, PAGE_H, MARGIN, order(S, me, ui),
     paint(ctx, id, S, me, ui) -> hits[], hit(hits, x, y), fmtBn, fmtPct,
     isCall, callerName }
============================================================ */
(function (root) {
  "use strict";
  const G = (typeof window !== "undefined" && window) || root;
  const CBZ = G.CBZ = G.CBZ || {};

  const PAGE_W = 768, PAGE_H = 1024, MARGIN = 56;
  const R = PAGE_W - MARGIN, B = PAGE_H - MARGIN;           // the right and bottom margins nothing crosses
  const SERIF = "Georgia, 'Times New Roman', serif";
  const MONO = "'Courier New', Courier, monospace";
  const INK = "#1c1d22", INK2 = "#55575f", RED = "#a3201c", BLUE = "#1f3f7a", GREEN = "#2c6a34", PAPER = "#f4f0e4";

  function W() { return CBZ.presWorld; }
  function H() { return CBZ.presHoller; }

  // ------------------------------------------------------------ formatting
  function fmtBn(v) {
    const a = Math.abs(v);
    if (a >= 1000) return (v < 0 ? "-" : "") + "$" + (a / 1000).toFixed(a >= 10000 ? 1 : 2) + " tn";
    return (v < 0 ? "-" : "") + "$" + a.toFixed(a >= 100 ? 0 : 1) + " bn";
  }
  function fmtPct(v, d) { return (v >= 0 ? "" : "-") + Math.abs(v).toFixed(d == null ? 1 : d) + "%"; }
  function fmtQ(g, q) { const v = q * (g.show || 1); return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2); }
  function fmtP(g, p) { const v = p * (g.pshow || 1); return "$" + (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v >= 100 ? v.toFixed(0) : v.toFixed(2)); }

  // ------------------------------------------------------------ paper stock
  let GRAIN = null;
  function grain() {
    if (GRAIN) return GRAIN;
    const c = document.createElement("canvas"); c.width = PAGE_W; c.height = PAGE_H;
    const x = c.getContext("2d");
    x.fillStyle = PAPER; x.fillRect(0, 0, PAGE_W, PAGE_H);
    let s = 12345;
    const rnd = function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    x.globalAlpha = 0.05;
    for (let i = 0; i < 1800; i++) { x.fillStyle = rnd() < 0.5 ? "#000" : "#fff"; x.fillRect(rnd() * PAGE_W, rnd() * PAGE_H, 1 + rnd() * 3, 1); }
    x.globalAlpha = 1;
    const g = x.createRadialGradient(PAGE_W / 2, PAGE_H / 2, PAGE_W * 0.35, PAGE_W / 2, PAGE_H / 2, PAGE_H * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(90,70,30,0.10)");
    x.fillStyle = g; x.fillRect(0, 0, PAGE_W, PAGE_H);
    GRAIN = c;
    return c;
  }

  // ------------------------------------------------------------ type
  /* Every line of text goes through T(), which shrinks a line that would run
     past the right margin rather than let it leave the page. */
  function T(x, s, X, Y, size, weight, col, align, family) {
    s = String(s);
    let fs = size;
    const fam = family || SERIF;
    x.font = (weight || "") + " " + fs + "px " + fam;
    const room = align === "right" ? X - MARGIN : align === "center" ? Math.min(X - MARGIN, R - X) * 2 : R - X;
    while (x.measureText(s).width > room && fs > 12) { fs -= 1; x.font = (weight || "") + " " + fs + "px " + fam; }
    x.fillStyle = col || INK; x.textAlign = align || "left"; x.textBaseline = "alphabetic";
    x.fillText(s, X, Y);
  }
  function rule(x, X0, X1, Y, col, wd) { x.strokeStyle = col || INK; x.lineWidth = wd || 2; x.beginPath(); x.moveTo(X0, Y); x.lineTo(X1, Y); x.stroke(); }
  // wrapped text that STOPS at a line limit (the caller gives the room it has)
  function wrap(x, s, X, Y, maxW, lh, size, weight, col, maxLines) {
    x.font = (weight || "") + " " + size + "px " + SERIF; x.fillStyle = col || INK; x.textAlign = "left"; x.textBaseline = "alphabetic";
    const words = String(s).split(" "); let line = "", y = Y, n = 0;
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (x.measureText(t).width > maxW && line) {
        if (maxLines && n + 1 >= maxLines) { x.fillText(line + "…", X, y); return y + lh; }
        x.fillText(line, X, y); line = w; y += lh; n++;
      } else line = t;
    }
    if (line) x.fillText(line, X, y);
    return y + lh;
  }
  // a box you tick: the decision
  function box(hits, x, X, Y, w, h, label, hitData, style) {
    const col = style === "war" ? RED : style === "go" ? GREEN : style === "dim" ? INK2 : BLUE;
    x.save();
    x.fillStyle = style === "on" ? "rgba(31,63,122,0.16)" : "rgba(255,255,255,0.4)";
    x.fillRect(X, Y, w, h);
    x.strokeStyle = col; x.lineWidth = 3; x.strokeRect(X + 1.5, Y + 1.5, w - 3, h - 3);
    if (label === "+" || label === "-") {
      // a plus and a minus drawn, not typed: a glyph this small reads as a speck
      x.lineWidth = 5; x.lineCap = "round"; x.beginPath();
      const cx = X + w / 2, cy = Y + h / 2, r = Math.min(w, h) * 0.24;
      x.moveTo(cx - r, cy); x.lineTo(cx + r, cy);
      if (label === "+") { x.moveTo(cx, cy - r); x.lineTo(cx, cy + r); }
      x.stroke();
    } else {
      let fs = Math.min(30, Math.floor(h * 0.48));
      x.font = "700 " + fs + "px " + SERIF;
      while (x.measureText(label).width > w - 18 && fs > 14) { fs -= 1; x.font = "700 " + fs + "px " + SERIF; }
      x.fillStyle = col; x.textAlign = "center"; x.textBaseline = "middle";
      x.fillText(label, X + w / 2, Y + h / 2 + 1);
    }
    x.restore();
    if (hitData) hits.push(Object.assign({ x: X, y: Y, w: w, h: h, label: label }, hitData));
  }
  function spark(x, arr, X, Y, w, h, col) {
    if (!arr || arr.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    x.strokeStyle = col || INK; x.lineWidth = 2.5; x.beginPath();
    arr.forEach(function (v, i) { const px = X + i / (arr.length - 1) * w, py = Y + h - (v - lo) / (hi - lo) * h; if (i) x.lineTo(px, py); else x.moveTo(px, py); });
    x.stroke();
  }
  // the page's head: the heading, a line under it, the date
  function header(x, title, sub, S) {
    x.drawImage(grain(), 0, 0);
    T(x, title, MARGIN, MARGIN + 46, 46, "700", INK);
    if (sub) T(x, sub, MARGIN, MARGIN + 84, 24, "italic", INK2);
    T(x, W().date(S.day).text, R, MARGIN + 84, 22, "", INK2, "right", MONO);
    rule(x, MARGIN, R, MARGIN + 102, INK, 3);
    return MARGIN + 150;
  }
  // a row: label left, value right-aligned on the value column
  const VAL_X = 520;
  function row(x, label, val, Y, col, sub) {
    // the label gives way to the value: it never runs under the number
    x.font = "700 28px " + MONO;
    const vw = x.measureText(String(val)).width;
    let ls = 27;
    x.font = ls + "px " + SERIF;
    while (ls > 15 && MARGIN + x.measureText(label).width + 18 > VAL_X - vw) { ls--; x.font = ls + "px " + SERIF; }
    T(x, label, MARGIN, Y, ls, "", INK2);
    T(x, val, VAL_X, Y, 28, "700", col || INK, "right", MONO);
    if (sub) T(x, sub, VAL_X + 18, Y, 21, "", INK2, "left", MONO);
  }
  function footer(x, n, of) { T(x, n + " / " + of, PAGE_W / 2, PAGE_H - 26, 18, "", INK2, "center", MONO); }

  // ============================================================ THE BRIEF
  function brief(x, hits, S, me, ui) {
    const c = S.c[me], PW = W();
    let y = header(x, "The Daily Brief", c.name, S);
    const g = (c.growth || 0) * 100;
    row(x, "Approval", fmtPct(c.approval, 0), y, c.approval < 40 ? RED : INK); spark(x, c.hist && c.hist.a, VAL_X + 24, y - 30, 150, 34, INK); y += 50;
    row(x, "The economy", (g >= 0 ? "+" : "") + g.toFixed(1) + "%", y, g < 0 ? RED : INK, "a year"); y += 50;
    row(x, "Out of work", fmtPct(c.u), y, c.u > Math.max(9, (c.uHab || 0) + 2) ? RED : INK); y += 50;
    row(x, "Prices", fmtPct(c.infl), y, c.infl > Math.max(6, (c.inflHab || 0) + 2) ? RED : INK, "a year"); y += 50;
    if (c.elections) { const d = c.nextElection - S.day; row(x, "The vote", d > 0 ? d + " days" : "today", y, PW.voteShare(S, c) < 50 ? RED : INK, "polling " + Math.round(PW.voteShare(S, c)) + "%"); y += 50; }
    rule(x, MARGIN, R, y - 14, INK2, 1); y += 34;
    // the wars
    if (c.war.length) {
      T(x, "AT WAR", MARGIN, y, 24, "700", RED, "left", MONO); y += 40;
      c.war.slice(0, 3).forEach(function (e) {
        const E = S.c[e];
        const held = S.p.filter(function (p) { return p.owner === me && p.ctl === e; }).length;
        const took = S.p.filter(function (p) { return p.owner === e && p.ctl === me; }).length;
        T(x, E.name + ".  " + (took ? "We hold " + took + " of their cities. " : "") + (held ? "They hold " + held + " of ours." : held || took ? "" : "No ground has changed hands."), MARGIN, y, 25, "", INK);
        y += 38;
      });
    } else { T(x, "At peace.", MARGIN, y, 26, "italic", INK2); y += 40; }
    { const Rm = PW.realm(S, me); if (Rm.conquered > 0) { T(x, "Ours: " + Rm.cities + " cities. Conquered " + Rm.conquered + " of " + Rm.rivals + ".", MARGIN, y, 24, "700", GREEN); y += 38; } }
    rule(x, MARGIN, R, y - 8, INK2, 1); y += 36;
    // what the papers say: the newest real things
    T(x, "THE PAPERS", MARGIN, y, 24, "700", INK2, "left", MONO); y += 42;
    const evs = H().feed(S, me, 24).filter(function (f) { return f.kind === "press"; });
    for (let i = 0; i < evs.length && y < B - 70; i++) {
      y = wrap(x, evs[i].text, MARGIN, y, R - MARGIN, 33, 25, "", i ? INK : INK, 2) + 10;
    }
  }

  // ============================================================ THE BUDGET
  function budget(x, hits, S, me, ui) {
    const c = S.c[me], PW = W(), v = PW.view(S, me);
    let y = header(x, "The Budget", "Percent of the economy", S);
    const BX = R - 196;                                   // the - and + boxes
    const line = function (label, val, col, actMinus, actPlus) {
      T(x, label, MARGIN, y, 27, "", INK);
      T(x, val, BX - 24, y, 29, "700", col || INK, "right", MONO);
      if (actMinus) box(hits, x, BX, y - 38, 88, 50, "-", { act: actMinus });
      if (actPlus) box(hits, x, BX + 104, y - 38, 88, 50, "+", { act: actPlus });
      y += 64;
    };
    PW.BUDGET.forEach(function (b) {
      const step = b.id === "welfare" ? 1 : 0.5;
      line(b.name, c.budget[b.id].toFixed(1), INK,
        { type: "budget", k: b.id, v: +Math.max(0, c.budget[b.id] - step).toFixed(2) },
        { type: "budget", k: b.id, v: +(c.budget[b.id] + step).toFixed(2) });
    });
    y += 6; rule(x, MARGIN, R, y - 40, INK2, 1);
    line("Taxes", c.tax.toFixed(0), INK, { type: "tax", v: c.tax - 1 }, { type: "tax", v: c.tax + 1 });
    line("Printing money", c.print.toFixed(1), c.print > 0 ? RED : INK, { type: "print", v: Math.max(0, c.print - 1) }, { type: "print", v: c.print + 1 });
    rule(x, MARGIN, R, y - 40, INK2, 1);
    const def = v.deficitGdp;
    row(x, def < 0 ? "We borrow" : "Surplus", fmtPct(Math.abs(def)), y, def < -5 ? RED : def >= 0 ? GREEN : INK, "of GDP"); y += 46;
    row(x, "Debt", fmtPct(v.debtGdp, 0), y, v.debtGdp > 120 ? RED : INK, "of GDP"); y += 46;
    row(x, "Ten-year bonds", fmtPct(c.yld, 2), y, c.crisis ? RED : INK, "rated " + c.rating); y += 46;
    if (c.crisis) { T(x, "Nobody is buying our bonds.", MARGIN, y, 25, "italic 700", RED); y += 40; }
    if (y < B - 60) box(hits, x, MARGIN, Math.min(y, B - 58), 300, 54, "Default", { act: { type: "default" } }, "war");
  }

  // ============================================================ TRADE
  function trade(x, hits, S, me, ui) {
    const c = S.c[me], PW = W();
    let y = header(x, "Trade", "What we make, use and pay", S);
    const cM = 400, cU = 500, cP = R;
    T(x, "MADE", cM, y, 18, "700", INK2, "right", MONO); T(x, "USED", cU, y, 18, "700", INK2, "right", MONO); T(x, "PRICE", cP, y, 18, "700", INK2, "right", MONO);
    y += 10; rule(x, MARGIN, R, y, INK, 2); y += 36;
    PW.GOODS.forEach(function (g, i) {
      const P = PW.worldPrice(S, g.id), d = (P / g.P0 - 1) * 100;
      T(x, g.name, MARGIN, y, 23, "700", INK);
      T(x, fmtQ(g, c.sup[i]), cM, y, 21, "", c.sup[i] >= c.dem[i] ? GREEN : INK, "right", MONO);
      T(x, fmtQ(g, c.dem[i]), cU, y, 21, "", INK, "right", MONO);
      T(x, fmtP(g, c.pl[i]) + (Math.abs(d) >= 10 ? " " + (d > 0 ? "+" : "") + d.toFixed(0) + "%" : ""), cP, y, 21, "700", Math.abs(d) > 25 ? RED : INK, "right", MONO);
      if (c.fill[i] < 0.97) T(x, "short", cM - 92, y, 18, "700", RED, "right", MONO);
      y += 40;
    });
    rule(x, MARGIN, R, y - 18, INK, 2); y += 22;
    const imp = [], exp = [];
    S.c.forEach(function (o) {
      if (!o.alive || o.id === c.id || !S.flow) return;
      let vi = 0, ve = 0;
      for (let g = 0; g < PW.GOODS.length; g++) { vi += S.flow[g][c.id][o.id] * S.P[g]; ve += S.flow[g][o.id][c.id] * S.P[g]; }
      imp.push({ c: o, v: vi * 0.365 }); exp.push({ c: o, v: ve * 0.365 });
    });
    imp.sort(function (a, b) { return b.v - a.v; }); exp.sort(function (a, b) { return b.v - a.v; });
    const mid = PAGE_W / 2 + 8;
    T(x, "WE BUY FROM", MARGIN, y, 18, "700", INK2, "left", MONO); T(x, "WE SELL TO", mid, y, 18, "700", INK2, "left", MONO);
    for (let k = 0; k < 3; k++) {
      y += 36;
      if (imp[k] && imp[k].v > 0.5) { T(x, imp[k].c.short, MARGIN, y, 22, "", INK); T(x, fmtBn(imp[k].v), mid - 26, y, 20, "", INK, "right", MONO); }
      if (exp[k] && exp[k].v > 0.5) { T(x, exp[k].c.short, mid, y, 22, "", INK); T(x, fmtBn(exp[k].v), R, y, 20, "", INK, "right", MONO); }
    }
  }

  // ============================================================ THE CABINET
  function cabinet(x, hits, S, me, ui) {
    const c = S.c[me], PW = W();
    let y = header(x, "The Cabinet", "Who carries out your orders", S);
    PW.ROLES.forEach(function (role) {
      const m = c.cab[role];
      T(x, PW.ROLE_TITLE[role], MARGIN, y, 21, "", INK2);
      T(x, m.name, MARGIN, y + 34, 29, "700", INK);
      // loyalty: a bar, no number
      const bw = 170, bx = 372;
      x.fillStyle = "rgba(0,0,0,0.12)"; x.fillRect(bx, y + 12, bw, 18);
      x.fillStyle = m.loyalty < 30 ? RED : m.loyalty < 55 ? "#a87a18" : GREEN; x.fillRect(bx, y + 12, bw * Math.max(0, Math.min(100, m.loyalty)) / 100, 18);
      T(x, m.loyalty < 30 ? "against you" : m.loyalty < 55 ? "unsure" : "loyal", bx, y + 52, 18, "italic", INK2);
      box(hits, x, R - 130, y - 4, 130, 52, "Fire", { act: { type: "fire", role: role }, role: role }, "war");
      y += 96;
    });
    rule(x, MARGIN, R, y - 26, INK2, 1); y += 14;
    T(x, "The army's hold on the state", MARGIN, y, 24, "", INK2);
    T(x, c.armyPower > 60 ? "dangerous" : c.armyPower > 35 ? "strong" : "normal", R, y, 24, "700", c.armyPower > 60 ? RED : INK, "right");
    y += 44;
    if (c.coupRisk > 0.05) { T(x, "There is talk among the colonels.", MARGIN, y, 24, "italic", RED); y += 40; }
  }

  // ============================================================ AT HOME
  function home(x, hits, S, me, ui) {
    const c = S.c[me];
    let y = header(x, "At Home", "The country's temper", S);
    row(x, "Unrest", c.unrest > 60 ? "dangerous" : c.unrest > 35 ? "rising" : "calm", y, c.unrest > 50 ? RED : INK); y += 48;
    row(x, "Freedom", Math.round(c.freedom) + " / 100", y, c.freedom < 40 ? RED : INK, c.regime); y += 48;
    const heat = c.heat, keys = Object.keys(heat).filter(function (k) { return heat[k] > 3; }).sort(function (a, b) { return heat[b] - heat[a]; });
    const word = { prices: "prices", war: "the war", crackdown: "the crackdown", scandal: "the scandal", plot: "the plot", pride: "the country" };
    row(x, "They are talking about", keys.length ? word[keys[0]] : "nothing much", y, INK); y += 48;
    if (c.martial) { T(x, "Martial law.", MARGIN, y, 26, "italic 700", RED); y += 40; }
    if (c.nukeProg > 0) { T(x, "The bomb: " + Math.round(c.nukeProg / 730 * 100) + "% there.", MARGIN, y, 25, "", RED); y += 40; }
    rule(x, MARGIN, R, y - 10, INK2, 1); y += 34;
    const A = [
      c.elections ? { l: "Postpone the election", a: { type: "postpone" }, s: "war" } : { l: "Restore elections", a: { type: "restoreElections" }, s: "go" },
      c.martial ? { l: "Lift martial law", a: { type: "martial", on: 0 }, s: "go" } : { l: "Declare martial law", a: { type: "martial", on: 1 }, s: "war" },
      { l: "Crack down", a: { type: "crackdown" }, s: "war" },
      { l: "Free the press", a: { type: "freePress" }, s: "go" },
      c.elections ? { l: "Cancel elections", a: { type: "cancelElections" }, s: "war" } : null,
      c.nukeProg > 0 || c.nukes > 0 ? null : { l: "Build the bomb", a: { type: "nukeProgram" }, s: "war" },
    ].filter(Boolean);
    const bw = (R - MARGIN - 20) / 2;
    A.forEach(function (o, i) { box(hits, x, MARGIN + (i % 2) * (bw + 20), y + Math.floor(i / 2) * 76, bw, 60, o.l, { act: o.a }, o.s); });
    y += Math.ceil(A.length / 2) * 76 + 24;
    // speak to the country: one line on the record
    if (y < B - 120) {
      T(x, "SAY IT IN PUBLIC", MARGIN, y, 18, "700", INK2, "left", MONO); y += 18;
      const O = H().options(S, me).slice(0, 4);
      O.forEach(function (o, i) { if (y + Math.floor(i / 2) * 70 + 56 < B) box(hits, x, MARGIN + (i % 2) * (bw + 20), y + Math.floor(i / 2) * 70, bw, 56, o.label, { act: o.act }, "dim"); });
    }
  }

  // ============================================================ THE WORLD
  /* The scenario's map (president/mapdraw.js: who holds what, the fronts,
     your colour and where it ends), the score, and under it the countries
     still in play, by name. A tap on either picks a country. */
  function MAPD() { return CBZ.presMap || (typeof require === "function" ? require("./mapdraw.js") : null); }
  const MAP = { y0: MARGIN + 116, h: 0 };
  function world(x, hits, S, me, ui) {
    const PW = W(), sc = PW.scen(S), Rm = PW.realm(S, me);
    let y = header(x, sc.id === "world" ? "The World" : sc.name, "Tap a country", S);
    const img = MAPD().image(S, me, { sel: ui.sel, theme: "paper" });
    // the frame fills the width, or the height it is allowed, whichever comes first
    const maxH = 470;
    let mw = R - MARGIN, mh = Math.round(mw * img.h / img.w);
    if (mh > maxH) { mh = maxH; mw = Math.round(mh * img.w / img.h); }
    const mx = MARGIN + Math.round((R - MARGIN - mw) / 2);
    MAP.y0 = y - 30; MAP.h = mh;
    x.imageSmoothingEnabled = false;
    if (img.cv) x.drawImage(img.cv, mx, MAP.y0, mw, mh);
    x.imageSmoothingEnabled = true;
    x.strokeStyle = INK; x.lineWidth = 2; x.strokeRect(mx, MAP.y0, mw, mh);
    hits.push({ x: mx, y: MAP.y0, w: mw, h: mh, fn: "map", mw: mw, mh: mh, fr: img.frame });
    y = MAP.y0 + mh + 40;
    // the score: how far your colour has spread
    T(x, "Ours: " + Rm.cities + " of " + Rm.of + " cities.  Conquered " + Rm.conquered + " of " + Rm.rivals + ".", MARGIN, y, 23, "700", INK);
    y += 44;
    // the countries still free: those at war with us, our allies, then by size; our puppets last
    const me0 = S.c[me];
    const rank = function (o) { return (me0.war.indexOf(o.id) >= 0 ? 1e6 : 0) + (o.lord === me ? -1e6 : 0) + (me0.allies.indexOf(o.id) >= 0 ? 1e5 : 0) + o.gdp; };
    const list = S.c.filter(function (o) { return o.alive && o.id !== me; }).sort(function (a, b) { return rank(b) - rank(a); });
    const colW = (R - MARGIN - 16) / 3, rowH = 44;
    const rows = Math.floor((B - y + 20) / rowH);
    list.slice(0, rows * 3).forEach(function (o, i) {
      const X = MARGIN + (i % 3) * (colW + 8), Y = y + Math.floor(i / 3) * rowH;
      x.fillStyle = o.lord >= 0 ? S.c[o.lord].color : o.color; x.fillRect(X, Y - 22, 10, 26);
      const tag = me0.war.indexOf(o.id) >= 0 ? RED : o.lord === me ? GREEN : ui.sel === o.id ? BLUE : INK;
      x.font = "700 21px " + SERIF; x.textAlign = "left"; x.fillStyle = tag; x.textBaseline = "alphabetic";
      let s2 = o.short; while (x.measureText(s2).width > colW - 22 && s2.length > 3) s2 = s2.slice(0, -1);
      x.fillText(s2, X + 18, Y);
      hits.push({ x: X, y: Y - 30, w: colW, h: rowH, fn: "pick", c: o.id });
    });
  }
  // the map under a tap on the world page -> a country in play, or null
  function mapPick(S, hit, px, py) {
    const fx = (px - hit.x) / hit.mw, fy = (py - hit.y) / hit.mh;
    if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return null;
    return MAPD().pick(S, fx, fy, hit.fr || MAPD().frame(S));
  }

  /* WHAT YOU CAN DO TO A COUNTRY: one list, for the country page and the
     phone's map card. Every entry is an action; nothing is greyed out. */
  function actions(S, me, t) {
    const PW = W(), mine = S.c[me], sel = S.c[t], out = [];
    if (!sel || !sel.alive || t === me) return out;
    const B2 = function (id, label, act, style) { out.push({ id: id, label: label, act: act, style: style }); };
    if (sel.lord === me) {
      B2("annex", "Annex them", { type: "annex", t: t }, "war");
      B2("release", "Set them free", { type: "release", t: t }, "go");
      return out;
    }
    const atWar = mine.war.indexOf(t) >= 0;
    if (atWar) {
      B2("posture", mine.posture[t] === "attack" ? "Hold the line" : "Attack", { type: "posture", t: t, v: mine.posture[t] === "attack" ? "hold" : "attack" }, "war");
      B2("surrender", "Demand surrender", { type: "surrender", t: t }, "war");
      B2("peace", "Offer peace", { type: "peace", t: t, terms: "white" }, "go");
      const tgt = PW.bestTarget(S, t);
      if (tgt) {
        B2("strike", "Bomb " + S.p[tgt.p].name, { type: "strike", t: t, p: tgt.p, what: tgt.what }, "war");
        B2("power", "Bomb their power", { type: "strike", t: t, p: tgt.p, what: "power" }, "war");
      }
    } else {
      B2("war", "Declare war", { type: "war", t: t }, "war");
      B2("ally", mine.allies.indexOf(t) >= 0 ? "Leave the alliance" : "Offer an alliance", mine.allies.indexOf(t) >= 0 ? { type: "leaveAlliance", t: t } : { type: "alliance", t: t }, mine.allies.indexOf(t) >= 0 ? "war" : "go");
      if (mine.deals.indexOf(t) < 0) B2("deal", "Offer a trade deal", { type: "deal", t: t }, "go");
      const topBuy = PW.topImport(S, mine, t);
      B2("tariff", "Tariff their " + PW.GOODS[PW.GI[topBuy]].name.toLowerCase(), { type: "tariff", t: t, good: topBuy, v: 0.25 });
      if (mine.tariffs[t]) B2("untariff", "Lift our tariffs", { type: "tariff", t: t, good: "all", v: 0 }, "go");
      B2("sanction", mine.sanctions.indexOf(t) >= 0 ? "Lift sanctions" : "Sanction them", { type: "sanction", t: t, on: mine.sanctions.indexOf(t) >= 0 ? 0 : 1 }, mine.sanctions.indexOf(t) >= 0 ? "go" : "war");
      B2("lend", "Lend $" + Math.round(sel.gdp * 0.12) + " bn", { type: "bailout", t: t, amt: Math.round(sel.gdp * 0.12), strings: "alliance" });
    }
    B2("threaten", "Threaten them", { type: "post", v: "threaten", t: t }, "war");
    if (mine.nukes > 0 || mine.nukeProg > 0) { const p = PW.biggestCity(S, t); if (p != null) B2("nuke", "Nuclear strike", { type: "nuke", t: t, p: p }, "war"); }
    B2("kill", "Have him killed", { type: "assassinate", t: t }, "war");
    return out;
  }

  // ============================================================ A COUNTRY
  function country(x, hits, S, me, ui) {
    const PW = W(), mine = S.c[me];
    const sel = ui.sel != null && S.c[ui.sel] && ui.sel !== me ? S.c[ui.sel] : null;
    if (!sel) {
      let y = header(x, "A Country", "Pick one on the world page", S);
      T(x, "Nothing picked.", MARGIN, y + 40, 28, "italic", INK2);
      return;
    }
    const t = sel.id;
    let y = header(x, sel.name, sel.leader.name + ", " + (sel.leader.title || "leader").toLowerCase(), S);
    const r = S.rel[me][t];
    const tags = [];
    if (mine.war.indexOf(t) >= 0) tags.push("AT WAR");
    if (sel.lord === me) tags.push("OUR PUPPET");
    else if (sel.lord >= 0) tags.push("PUPPET OF " + S.c[sel.lord].short.toUpperCase());
    if (mine.allies.indexOf(t) >= 0) tags.push("ALLY");
    if (mine.deals.indexOf(t) >= 0) tags.push("TRADE DEAL");
    if (mine.sanctions.indexOf(t) >= 0) tags.push("WE SANCTION THEM");
    if (sel.sanctions.indexOf(me) >= 0) tags.push("THEY SANCTION US");
    row(x, "Relations", r > 40 ? "friendly" : r > 10 ? "warm" : r > -10 ? "cool" : r > -40 ? "hostile" : "enemies", y, r < -30 ? RED : r > 30 ? GREEN : INK); y += 44;
    row(x, "Their economy", fmtBn(sel.gdp), y, INK); y += 44;
    row(x, "Their army", Math.round(sel.div) + " divisions", y, INK, sel.nukes > 0 ? sel.nukes + " warheads" : ""); y += 44;
    let vi = 0, ve = 0;
    if (S.flow) for (let g = 0; g < PW.GOODS.length; g++) { vi += S.flow[g][me][t] * S.P[g] * 0.365; ve += S.flow[g][t][me] * S.P[g] * 0.365; }
    row(x, "We buy / sell", fmtBn(vi) + " / " + fmtBn(ve), y, INK); y += 40;
    if (tags.length) { T(x, tags.join("   "), MARGIN, y, 19, "700", RED, "left", MONO); y += 34; }
    rule(x, MARGIN, R, y - 8, INK2, 1); y += 24;
    const bw = (R - MARGIN - 16) / 2, bh = 54;
    let k = 0;
    const Bx = function (label, act, style) {
      const X = MARGIN + (k % 2) * (bw + 16), Y = y + Math.floor(k / 2) * (bh + 12);
      if (Y + bh > B) return;
      box(hits, x, X, Y, bw, bh, label, { act: act }, style);
      k++;
    };
    actions(S, me, t).forEach(function (o) { Bx(o.label, o.act, o.style); });
  }

  // ============================================================ the book
  const PAINT = { brief: brief, budget: budget, trade: trade, cabinet: cabinet, home: home, world: world, country: country };
  const ORDER = ["brief", "budget", "trade", "cabinet", "home", "world", "country"];
  function order() { return ORDER.slice(); }
  function paint(x, id, S, me, ui) {
    const hits = [];
    x.save();
    try { PAINT[id](x, hits, S, me, ui || {}); } catch (e) { console.error("[papers]", id, e); }
    x.restore();
    footer(x, ORDER.indexOf(id) + 1, ORDER.length);
    return hits;
  }
  function hit(hits, px, py) {
    for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) return h; }
    return null;
  }
  // a matter that comes by phone: anything from abroad
  function isCall(m) { return typeof m.from === "string" && m.from.indexOf("leader:") === 0; }
  function callerName(S, me, m) {
    if (isCall(m)) { const id = +m.from.split(":")[1]; return H().leader(S, id) + ", " + H().cname(S, id); }
    const r = S.c[me].cab[m.from]; return r ? r.name : m.from;
  }

  CBZ.presPapers = { PAGE_W: PAGE_W, PAGE_H: PAGE_H, MARGIN: MARGIN, order: order, paint: paint, hit: hit, mapPick: mapPick, actions: actions,
    fmtBn: fmtBn, fmtPct: fmtPct, isCall: isCall, callerName: callerName };
  if (typeof module !== "undefined" && module.exports) module.exports = CBZ.presPapers;
})(typeof globalThis !== "undefined" ? globalThis : this);
