/* ============================================================
   systems/prisontrade.js — TRADE: TWO POCKETS ON ONE TABLE.

   OWNER (2026-09-30): the inventory shows only when you pick Trade on a
   person. Trade opens one view with two sides, your pockets and his. Either
   side can put ANY item into the deal. You OFFER (your things, and if you
   like some of his), or you REQUEST (his things) and he names what he wants
   for them. He says yes or no on real value, no fake prices.

   WHAT IS REAL HERE
     his side   his actual pockets: economy.js's rollLoadout (the same items a
                frisk or a lift takes off him) plus the stall item he sells.
     value      economy.js's ITEMS value, one cigarette = 1. What he adds on
                top of anything of HIS you ask for is the same ledger his stall
                price reads (econ.dealMod: trust, grudge, fear, his car's
                standing, heat on risky goods, the racket tab).
     doctrine   no officer takes cigarettes (economy.js's phone bridge); a clean
                officer does not deal with you at all. A bent one sells.
     the move   Accept moves the items for real: econ.takeItem/addItem on your
                side, his loadout on his. A deal he takes is trust; a gift is
                more of it.

   SCREEN: item renders (city/itemicons.js), the count on each, a tap puts one
   more into the deal (a tap on the tile in the deal takes one back). Four
   verb buttons: Offer, Request, Accept (only while he has named his price),
   Leave. What he says goes over his head (CBZ.prisonSay), never on the panel.

     CBZ.prisonTrade.open(actor) / close() / isOpen() / audit()
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ) return;
  const g = CBZ.game;

  const T = {
    a: null, mine: {}, theirs: {}, counter: null, root: null, sig: "",
  };
  const E = () => CBZ.econ || null;
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;";
    });
  }
  function say(a, line, secs) { if (line && CBZ.prisonSay) CBZ.prisonSay(a, line, { force: true, secs: secs || 2.4 }); }
  function guardish(a) { return !!a && (a.kind === "guard" || a.kind === "warden"); }
  function nameOf(a) {
    const n = a && a.data && a.data.name ? a.data.name.replace(/^the |^a |^an /, "") : "";
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : "";
  }

  // ---- the two pockets --------------------------------------------------------
  function myPocket() {
    const out = {};
    const inv = (g && g.inventory) || {};
    for (const k in inv) if ((inv[k] | 0) > 0 && !(E() && E().isService && E().isService(k))) out[k] = inv[k] | 0;
    return out;
  }
  function myCigs() { return (g && g.cigs) | 0; }
  function hisLoadout(a) {
    const e = E();
    if (!e || !a) return null;
    return a.loadout || (e.rollLoadout ? e.rollLoadout(a) : null);
  }
  function hisPocket(a) {
    const out = {};
    const L = hisLoadout(a);
    if (L) for (let i = 0; i < L.items.length; i++) out[L.items[i]] = (out[L.items[i]] || 0) + 1;
    // the stall: the thing he sells is on him too
    const o = a && a.data && a.data.offer;
    if (o && o.item && !(E() && E().isService && E().isService(o.item))) out[o.item] = (out[o.item] || 0) + 1;
    return out;
  }
  function hisCigs(a) { const L = hisLoadout(a); return L ? (L.cigs | 0) : 0; }

  // ---- who deals at all ----------------------------------------------------------
  function deals(a) {
    if (!a || a.dead || a.escaped) return false;
    if (a.kind === "warden") return false;
    if (a.kind === "guard") return !!(a.corrupt || (a.data && a.data.offer));
    return true;
  }
  CBZ.prisonTradeDeals = deals;

  // ---- value ---------------------------------------------------------------------
  function val(name) { const e = E(); return e && e.itemValue ? e.itemValue(name) : 2; }
  function sideValue(side) { let v = 0; for (const k in side) v += val(k) * side[k]; return v; }
  function keys(side) { const out = []; for (const k in side) if (side[k] > 0) out.push(k); return out; }
  // what he wants for what you are asking of him, in cigs
  function asking(a) {
    const want = keys(T.theirs);
    if (!want.length) return 0;
    let v = 0;
    for (const k in T.theirs) v += k === "cigs" ? T.theirs[k] : val(k) * T.theirs[k];
    const items = want.filter(function (k) { return k !== "cigs"; });
    const e = E();
    const mod = items.length && e && e.dealMod ? e.dealMod(a, items) : 0;
    return Math.max(1, Math.round(v + mod));
  }
  function giving() {
    let v = 0;
    for (const k in T.mine) v += k === "cigs" ? T.mine[k] : val(k) * T.mine[k];
    return v;
  }

  // ---- the move --------------------------------------------------------------------
  function execute(a) {
    const e = E();
    const L = hisLoadout(a);
    if (!e || !L) return false;
    // re-check both sides still hold what is on the table
    const mine = myPocket(), his = hisPocket(a);
    for (const k in T.mine) {
      if (k === "cigs") { if (T.mine[k] > myCigs()) return false; }
      else if ((mine[k] | 0) < T.mine[k]) return false;
    }
    for (const k in T.theirs) {
      if (k === "cigs") { if (T.theirs[k] > hisCigs(a)) return false; }
      else if ((his[k] | 0) < T.theirs[k]) return false;
    }
    // yours to him
    for (const k in T.mine) {
      const n = T.mine[k];
      if (k === "cigs") { e.addCigs(-n); L.cigs = (L.cigs | 0) + n; continue; }
      for (let i = 0; i < n; i++) if (e.takeItem(k)) L.items.push(k);
    }
    // his to you (the stall item first comes off the shelf, then his pockets)
    for (const k in T.theirs) {
      const n = T.theirs[k];
      if (k === "cigs") { L.cigs = Math.max(0, (L.cigs | 0) - n); e.addCigs(n); continue; }
      for (let i = 0; i < n; i++) {
        const j = L.items.indexOf(k);
        if (j >= 0) L.items.splice(j, 1);
        else if (a.data && a.data.offer && a.data.offer.item === k) a.data.offer = e.pickOffer ? e.pickOffer(a.data.pool) : null;
        e.addItem(k, 1);
        if (CBZ.pickupNote) CBZ.pickupNote(k, { rare: e.isRare ? e.isRare(k) : false });
      }
    }
    g.trades = (g.trades || 0) + 1;
    a.playerTrust = Math.min(14, (a.playerTrust || 0) + (keys(T.theirs).length ? 1 : 2));
    if (e.addRespect) e.addRespect(a, 1);
    if (guardish(a) && e.addLoyalty) e.addLoyalty(a, 2);
    if (CBZ.sfx) CBZ.sfx("coin");
    T.mine = {}; T.theirs = {}; T.counter = null;
    return true;
  }

  // ---- his answer -------------------------------------------------------------------
  const LINE = {
    yes: ["Deal.", "Done.", "Alright."],
    gift: ["Appreciate it.", "Huh. Thanks."],
    no: ["Not for that.", "No.", "Come on. More than that."],
    nothing: ["For what?"],
    cover: ["You can't cover it."],
    noCigs: ["Not smokes. Not from you."],
    clean: ["Walk away."],
  };
  let seq = 0;
  function pick(list) { seq++; return list[seq % list.length]; }
  function clean(a) { return a.kind === "guard" && !a.corrupt; }

  function offer() {
    const a = T.a;
    if (!a) return;
    T.counter = null;
    if (clean(a)) { say(a, pick(LINE.clean)); return; }
    if (guardish(a) && (T.mine.cigs | 0) > 0) { say(a, pick(LINE.noCigs)); return; }
    const give = giving(), ask = asking(a);
    if (!give && !ask) { say(a, pick(LINE.nothing)); return; }
    if (give >= ask) {
      const gift = !keys(T.theirs).length;
      if (execute(a)) say(a, pick(gift ? LINE.gift : LINE.yes));
      render();
      return;
    }
    // short: he says so, and how far
    say(a, pick(LINE.no));
  }
  // he names his price: your side fills with what covers it, cigs first
  function request() {
    const a = T.a;
    if (!a) return;
    if (clean(a)) { say(a, pick(LINE.clean)); return; }
    const ask = asking(a);
    if (!ask) { say(a, pick(LINE.nothing)); return; }
    const fill = {};
    let need = ask;
    const cigsOk = !guardish(a);
    if (cigsOk) {
      const c = Math.min(myCigs(), need);
      if (c > 0) { fill.cigs = c; need -= c; }
    }
    if (need > 0) {
      // the fewest of your things that cover the rest: the dearest first
      const mine = myPocket();
      const list = [];
      for (const k in mine) for (let i = 0; i < mine[k]; i++) list.push(k);
      list.sort(function (x, y) { return val(y) - val(x); });
      // one item that covers it alone, the cheapest such
      let one = null;
      for (let i = list.length - 1; i >= 0; i--) if (val(list[i]) >= need) { one = list[i]; break; }
      if (one) { fill[one] = 1; need = 0; }
      else for (let i = 0; i < list.length && need > 0; i++) { fill[list[i]] = (fill[list[i]] || 0) + 1; need -= val(list[i]); }
    }
    if (need > 0) { say(a, pick(LINE.cover)); return; }
    T.mine = fill;
    T.counter = { ask: ask };
    const ks = keys(fill);
    const words = ks.map(function (k) { return k === "cigs" ? String(fill.cigs) : (fill[k] > 1 ? fill[k] + " " + k : k); });
    say(a, words.join(" and ") + ".", 2.8);
    render();
  }
  function accept() {
    const a = T.a;
    if (!a || !T.counter) return;
    if (execute(a)) say(a, pick(LINE.yes));
    render();
  }

  // ---- the screen ----------------------------------------------------------------------
  function icon(name) {
    if (name === "cigs") return '<span class="ptr-cig"></span>';
    let h = "";
    try { h = CBZ.itemIconHtml ? CBZ.itemIconHtml(name, null, "md") : ""; } catch (e) { h = ""; }
    if (!h) { try { const src = CBZ.itemIcon ? CBZ.itemIcon(name, {}) : ""; if (src) h = "<img src='" + src + "' alt=''>"; } catch (e) { h = ""; } }
    return h || '<span class="ptr-none"></span>';
  }
  function tile(side, name, have, inDeal) {
    return '<button type="button" class="ptr-tile' + (inDeal ? " in" : "") + '" data-side="' + side + '" data-item="' + esc(name) +
      '" aria-label="' + esc(name === "cigs" ? "Cigarettes" : name) + '">' + icon(name) +
      '<span class="ptr-n">' + have + "</span>" + (inDeal ? '<span class="ptr-d">' + inDeal + "</span>" : "") + "</button>";
  }
  function sideHTML(side, pocket, cigs, deal) {
    let h = "";
    if (cigs > 0) h += tile(side, "cigs", cigs, deal.cigs | 0);
    const names = Object.keys(pocket).sort(function (x, y) { return val(y) - val(x); });
    for (let i = 0; i < names.length; i++) h += tile(side, names[i], pocket[names[i]], deal[names[i]] | 0);
    return h || '<span class="ptr-empty"></span>';
  }
  function build() {
    if (T.root) return T.root;
    const r = document.createElement("div");
    r.id = "prisonTrade";
    r.innerHTML =
      '<div class="ptr-card">' +
        '<div class="ptr-sides">' +
          '<div class="ptr-side"><div class="ptr-who ptr-me"></div><div class="ptr-grid" data-g="mine"></div></div>' +
          '<div class="ptr-side"><div class="ptr-who ptr-him"></div><div class="ptr-grid" data-g="theirs"></div></div>' +
        "</div>" +
        '<div class="ptr-acts">' +
          '<button type="button" class="ptr-act" data-act="offer">Offer</button>' +
          '<button type="button" class="ptr-act" data-act="request">Request</button>' +
          '<button type="button" class="ptr-act ptr-accept" data-act="accept">Accept</button>' +
          '<button type="button" class="ptr-act ptr-leave" data-act="leave">Leave</button>' +
        "</div>" +
      "</div>";
    document.body.appendChild(r);
    r.addEventListener("click", function (e) {
      const t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t || !r.contains(t)) return;
      e.preventDefault(); e.stopPropagation();
      const act = t.getAttribute("data-act");
      if (act === "offer") return offer();
      if (act === "request") return request();
      if (act === "accept") return accept();
      if (act === "leave") return close();
      const side = t.getAttribute("data-side"), item = t.getAttribute("data-item");
      if (side && item) bump(side, item);
    });
    T.root = r;
    return r;
  }
  // a tap puts one more of it on the table; past what there is it goes back to none.
  // cigarettes go on in handfuls once there are more than a few
  function bump(side, item) {
    const deal = side === "mine" ? T.mine : T.theirs;
    const have = side === "mine"
      ? (item === "cigs" ? myCigs() : (myPocket()[item] | 0))
      : (item === "cigs" ? hisCigs(T.a) : (hisPocket(T.a)[item] | 0));
    const cur = deal[item] | 0;
    const step = item === "cigs" && cur >= 5 ? 5 : 1;
    const nx = cur + step > have ? 0 : cur + step;
    if (nx) deal[item] = nx; else delete deal[item];
    T.counter = null;            // the table changed: his price is off it
    render();
  }
  function render() {
    if (!T.root || !T.a) return;
    const mine = myPocket(), his = hisPocket(T.a);
    const html = sideHTML("mine", mine, myCigs(), T.mine) + "\u0001" + sideHTML("theirs", his, hisCigs(T.a), T.theirs);
    const sig = html + "|" + (T.counter ? 1 : 0) + "|" + nameOf(T.a);
    if (sig === T.sig) return;
    T.sig = sig;
    const parts = html.split("\u0001");
    T.root.querySelector('[data-g="mine"]').innerHTML = parts[0];
    T.root.querySelector('[data-g="theirs"]').innerHTML = parts[1];
    T.root.querySelector(".ptr-me").textContent = "You";
    T.root.querySelector(".ptr-him").textContent = nameOf(T.a);
    T.root.querySelector(".ptr-accept").style.display = T.counter ? "" : "none";
  }

  function open(a) {
    if (!deals(a) || !g || g.mode !== "escape" || g.state !== "playing") return { ok: false, msg: "" };
    if (clean(a)) return { ok: false, msg: pick(LINE.clean) };
    T.a = a; T.mine = {}; T.theirs = {}; T.counter = null; T.sig = "";
    build();
    // the cursor is needed for the table; camera.js treats an open stash
    // (CBZ.invOpen) as a reason the lock dropped, not a pause
    CBZ.invOpen = true;
    try { if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
    T.root.classList.add("show");
    render();
    return { ok: true, msg: "" };
  }
  function close() {
    if (!T.a && !(T.root && T.root.classList.contains("show"))) return;
    T.a = null; T.mine = {}; T.theirs = {}; T.counter = null;
    if (T.root) T.root.classList.remove("show");
    CBZ.invOpen = false;
    // back to the game: take the mouse again on a keyboard
    if (!CBZ.touchMode) {
      try { const c = CBZ.renderer && CBZ.renderer.domElement; if (c && c.requestPointerLock && g.state === "playing") { const pr = c.requestPointerLock(); if (pr && pr.catch) pr.catch(function () {}); } } catch (e) {}
    }
  }
  function isOpen() { return !!T.a; }

  // walked off, he went down, the run stopped: the table folds
  CBZ.onAlways && CBZ.onAlways(97.5, function () {
    if (!T.a) return;
    const a = T.a, P = CBZ.player;
    const ap = a.group && a.group.position;
    if (!g || g.mode !== "escape" || g.state !== "playing" || a.dead || (a.ko > 0) || !ap || !P || !P.pos ||
        Math.hypot(ap.x - P.pos.x, ap.z - P.pos.z) > 4.5) { close(); return; }
    render();
  });
  addEventListener("keydown", function (e) {
    if (!T.a) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);

  CBZ.prisonTrade = {
    open: open, close: close, isOpen: isOpen,
    // probes: put items on the table by name, then offer/request/accept
    put: function (side, item, n) { const d = side === "mine" ? T.mine : T.theirs; if (n > 0) d[item] = n; else delete d[item]; T.counter = null; render(); },
    offer: offer, request: request, accept: accept,
    audit: function () {
      return { open: !!T.a, who: T.a ? nameOf(T.a) : null, mine: Object.assign({}, T.mine), theirs: Object.assign({}, T.theirs),
        counter: T.counter, his: T.a ? hisPocket(T.a) : null, hisCigs: T.a ? hisCigs(T.a) : 0, give: giving(), ask: T.a ? asking(T.a) : 0 };
    },
  };
})();
