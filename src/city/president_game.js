/* ============================================================
   city/president_game.js — THE PRESIDENT GAME, IN THE REAL WHITE HOUSE.

   OWNER (2026-10-28): "It's horrible. The president doesn't have an actual
   body. You can't move around. You're just sitting at this desk." / "The
   windows are fake ... use the ACTUAL full White House from Gang City as the
   real world the president game runs in ... Load just that slice of the
   city." / "Real countries, real leaders."

   So games/president.html is now only the door: you pick a real country
   there, and it opens THIS page (index.html) with
       ?slice=estate&president=<country>&pseed=<n>
   which boots Gang City's Executive Mansion slice (core/slice.js "estate":
   the West Wing, the Oval Office, the residence, the grounds, the gate and
   the street outside, jail-sized) and starts the President origin by itself.
   You are a body (the shipped rig, its hands, its gait), in the chair behind
   the Resolute desk, and you stand up and walk wherever the building goes.

   WHAT THIS FILE OWNS: nothing you can see. It runs the real-world model
   (president/world.js on the real map, president/nations.js's countries and
   leaders, president/ai.js's other presidents) on a clock, and hands the
   world's business to the people and things that already carry the
   presidency in Gang City:
     a decision for you    president_office.js offer(): the phone rings (a
                           foreign leader, the Treasury, the central bank),
                           the General or an aide walks in, or a bill lies on
                           the desk in its folder; two answers, E / hold E
     the numbers, the map  city/president_book.js: the briefing book on the
                           desk (president/papers.js pages), boxes on the page
                           are orders
     what happened         the TV in the office (NEWS ONE, president_office
                           news())
     the men with guns     city/president_storm.js: a coup or an attempt on
                           your life is soldiers and gunmen in the building
   Gang City's own falls (its 7-day term, impeachment) are switched off for
   this game: the world model decides when you are out.

   Several presidents in one world still works: the lobby is
   games/president.html, and each president's page joins the same room here
   (president/net.js, lockstep; the host runs the clock).

   PUBLIC  CBZ.presGame = { on, state(), me(), submit(a), audit(), _step(n) }
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.presGame) return;
  const g = CBZ.game || (CBZ.game = {});
  const Q = new URLSearchParams(location.search);
  const KEY = (Q.get("president") || "").toLowerCase();
  if (!KEY) { CBZ.presGame = { on: false }; return; }

  // ---- this game, not Gang City's presidency, decides when you fall
  CBZ.CONFIG = CBZ.CONFIG || {};
  CBZ.CONFIG.PRESIDENCY_FALLS = false;          // presidency.js: no impeachment, no junta knock
  CBZ.CONFIG.PRESIDENT_TERM_DAYS = 0;           // officials.js: no 7-day city term
  document.documentElement.classList.add("pres-game");

  const DAY_SECS = Math.max(1, +(Q.get("daysecs") || 4));     // one day of the world every four seconds of play
  const PSEED = (+(Q.get("pseed") || 0) | 0) || 1 + ((Date.now() / 1000) | 0) % 99991;
  const ROOM = (Q.get("room") || "").toUpperCase();
  const HOST = Q.get("host") === "1";

  const A = { phase: "loading", started: false, t: 0, acc: 0, lastN: 0, seenM: {}, ver: 0, newsDay: -1, newsSeen: {}, ended: false, net: null, pending: [], why: null };
  let S = null, ME = -1;
  const UI = { me: -1, sel: null };

  // ---- the world's scripts: only this game pays for them
  function srcRoot() {
    const s = document.querySelector("script[src*='city/president_game.js']");
    return s ? s.src.replace(/city\/president_game\.js.*$/, "") : "src/";
  }
  const BUST = (function () { const s = document.querySelector("script[src*='city/president_game.js']"); const m = s && /\?v=([^&]+)/.exec(s.src); return m ? "?v=" + m[1] : ""; })();
  function loadSeq(list) {
    return list.reduce(function (p, rel) {
      return p.then(function () {
        return new Promise(function (res) {
          const s = document.createElement("script");
          s.src = srcRoot() + rel + BUST; s.async = false;
          s.onload = res; s.onerror = function () { console.warn("[presGame] could not load", rel); res(); };
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve());
  }
  const FILES = ["president/earth.js", "president/nations.js", "president/world.js", "president/ai.js", "president/holler.js", "president/papers.js"];
  if (ROOM) FILES.push("net/rooms.js", "president/net.js");
  const ready = loadSeq(FILES).then(function () { A.phase = "booting"; });

  // ---- straight into office: pick The President and press Play once the page is up
  const autoT = setInterval(function () {
    if (!CBZ.bootComplete || !g || g.state !== "title" || !CBZ.setCityOrigin) return;
    const play = document.getElementById("playBtn");
    if (!play) return;
    clearInterval(autoT);
    try { CBZ.setCityOrigin("president", true); } catch (e) {}
    play.click();
  }, 250);

  function PW() { return CBZ.presWorld; }
  function PO() { return CBZ.presidentOffice || null; }
  function c() { return S && S.c[ME]; }
  function seated() { const P = CBZ.presidency; try { const s = P && P.status ? P.status() : null; return !!(s && s.seat); } catch (e) { return false; } }

  // ---- the start: once you hold the seat in the Mansion
  function begin(W0) {
    const NA = CBZ.presNations;
    S = W0 || PW().create(PSEED);
    ME = S.c.findIndex(function (x) { return x.key === KEY; });
    if (ME < 0) ME = 0;
    UI.me = ME;
    if (!W0) PW().apply(S, { type: "seat", c: ME, who: "you" });
    A.started = true; A.phase = "playing";
    A.lastN = S.evN || 0;
    // the country in the Mansion's ledger is the real one
    try {
      const h = CBZ.gov && CBZ.gov.holds ? CBZ.gov.holds() : null;
      if (h && h.rec) { h.rec.name = S.c[ME].name; }
    } catch (e) {}
    if (CBZ.presBook) CBZ.presBook.setSource(bookSource());
    syncCabinet();
    A.ver++;
    news(S.c[ME].leader.title + " " + S.c[ME].leader.name + " starts the day in the Oval Office", { cat: S.c[ME].short.toUpperCase() });
  }

  // ---- every order goes through here (and, in a room, through the host)
  function submit(a) {
    if (!S || A.ended) return null;
    a.c = ME;
    if (A.net) {
      if (A.net.role === "host") A.pending.push(a); else A.net.send(a);
      return { ok: true, queued: true };
    }
    const r = PW().apply(S, a);
    afterStep();
    A.ver++;
    return r;
  }
  function stepDay() {
    const acts = A.pending.splice(0, A.pending.length);
    if (A.net && A.net.role === "host") A.net.tick(S.day, acts);
    PW().step(S, acts);
    if (A.net && A.net.role === "host" && S.day % 90 === 0) A.net.snapshot(S, { seats: A.seats || {} });
    afterStep();
  }

  // ---- the matters: who brings each one, and how
  const ROLE = { general: "general", treasury: "treasury", security: "bureau", bank: "bank", trade: "trade" };
  function personFor(m) {
    const H = CBZ.presHoller;
    if (CBZ.presPapers.isCall(m)) {
      const id = +m.from.split(":")[1];
      return { name: H.leader(S, id) + ", " + H.cname(S, id), role: "foreign" };
    }
    const who = c().cab[m.from];
    return { name: who ? who.name : "An aide", role: ROLE[m.from] || "aide" };
  }
  function noIndex(m) {
    for (let i = 1; i < m.opts.length; i++) if (m.opts[i].act && m.opts[i].act.type === "noop") return i;
    return m.opts.length > 1 ? 1 : -1;
  }
  function deliver(m) {
    const P = PO();
    if (!P || !P.offer || !seated()) return false;
    if (m.kind === "coup" || m.kind === "traitor" || m.kind === "hit") {
      if (CBZ.presStorm) return CBZ.presStorm.start(m, { state: function () { return S; }, me: ME, submit: submit, personFor: personFor });
      return false;
    }
    const line = CBZ.presHoller.line(S, ME, m);
    const ni = noIndex(m);
    const yes = m.opts[0], no = ni >= 0 ? m.opts[ni] : null;
    const days = Math.max(1, m.expires - S.day);
    const base = {
      id: "pw:" + m.id, topic: m.kind, who: personFor(m), line: line,
      expires: Math.max(40, days * DAY_SECS),
      urgent: !!m.critical || m.kind === "callToArms",
      yes: { label: yes.label, run: function () { submit({ type: "answer", m: m.id, o: 0 }); }, reply: replyFor(m, true) },
      no: no ? { label: no.label, run: function () { submit({ type: "answer", m: m.id, o: ni }); }, reply: replyFor(m, false) } : { label: "Not now" },
    };
    if (m.kind === "bill") {
      const b = m.data;
      base.via = "folder"; base.kind = "people";
      base.memo = { dept: "Congress", subject: b.name, body: billLines(b), rec: "Sign" };
      base.noVerb = "Veto";
    } else if (CBZ.presPapers.isCall(m)) {
      base.via = "phone"; base.kind = "people";
    } else {
      base.via = m.critical || m.kind === "callToArms" || m.kind === "opening" || m.kind === "target" ? "aide" : "any";
      base.kind = /yields|rates|tariffed|bailout/.test(m.kind) ? "economy" : /opening|target|callToArms|warning|unrest|polls/.test(m.kind) ? "security" : "people";
    }
    return !!P.offer(base);
  }
  function replyFor(m, yes) {
    const R = {
      opening: ["We move at dawn.", "As you wish."], target: ["Wheels up.", "We'll hold them."], unrest: ["We'll clear the square.", "We'll watch."],
      yields: ["I'll tell the markets.", "Then I'll find the money elsewhere."], rates: ["Thank you, sir.", "Noted, sir."], callToArms: ["We'll stand with them.", "They won't forget this."],
      warning: ["Done.", "I hope you're right, sir."], polls: ["It's done.", "Then we campaign."], tariffed: ["They'll feel it.", "Understood."],
      bailoutAsk: ["Thank you. We won't forget it.", "I understand."], bill: ["", ""],
    };
    const r = R[m.kind];
    return r ? (yes ? r[0] : r[1]) || null : null;
  }
  function billLines(b) {
    const out = ["It passed " + b.yes + " to " + b.no + "."];
    const B = PW().BUDGET;
    for (const k in b.fx) {
      const d = b.fx[k];
      if (k === "tax") out.push("Taxes " + (d > 0 ? "up " : "down ") + Math.abs(d) + " points.");
      else if (k === "freedom") out.push(d > 0 ? "Press and assembly protected in law." : "Detention without charge for thirty days.");
      else { const nm = (B.find(function (q) { return q.id === k; }) || { name: k }).name; out.push(nm + (d > 0 ? " up " : " down ") + Math.abs(d) + "% of GDP."); }
      if (out.length >= 3) break;
    }
    return out;
  }

  // ---- after a day: what reaches the room
  function afterStep() {
    const me = c(); if (!me) return;
    A.ver++;
    for (const m of me.matters) {
      if (A.seenM[m.id]) continue;
      if (deliver(m)) A.seenM[m.id] = 1;
    }
    // the log: refusals said by the person who refused; the news on the TV
    for (const e of S.log) {
      if (!(e.n > A.lastN)) continue;
      A.lastN = e.n;
      if (e.c === ME && e.k === "refused") refused(e);
      if (e.c === ME && e.k === "fall") end(e.why);
      if (e.k === "strike" && e.t === ME) warComesHome(e);
    }
    streetTemper(me);
    if (S.day !== A.newsDay) { A.newsDay = S.day; tvNews(); }
    if (S.over && S.over.winner === ME) end("won");
    if (S.day % 7 === 0) syncCabinet();
  }
  function refused(e) {
    const line = CBZ.presHoller.said(S, ME, e);
    const P = PO();
    if (!P || !line) return;
    const role = ROLE[e.role] || "aide";
    const who = c().cab[e.role];
    P.offer({ id: "pw:refused:" + e.n, via: "phone", topic: "refused", who: { name: who ? who.name : "An aide", role: role }, expires: 60,
      line: line, info: true, yes: { label: "Understood" }, no: { label: "Hang up" } });
  }
  // two headlines a day at most, the biggest first
  function tvNews() {
    const feed = CBZ.presHoller.feed(S, ME, 10).filter(function (f) { return f.kind === "press" && S.day - f.d <= 1; });
    let n = 0;
    for (const f of feed) {
      const k = f.d + ":" + f.text;
      if (A.newsSeen[k]) continue;
      A.newsSeen[k] = 1;
      news(f.text, { cat: "WORLD" });
      if (++n >= 2) break;
    }
  }
  /* THE WORLD COMES TO THE DOOR. What the world model says happened to this
     country is something he hears and sees from the Mansion, not a number:
       an enemy strike on the capital: jets over the city, bombs landing a few
         hundred metres out (systems/impactbus.js, the real blast), sirens, the
         detail getting him down
       the street boiling over (unrest): a crowd at the gate with signs
         (president_public.js's own protest, the pen across from the gate) */
  let raidAt = -999;
  function warComesHome(e) {
    const P = CBZ.player, me = c();
    if (!P || !P.pos || !CBZ.detonate || !me) return;
    if (e.p !== me.cap && !(S.p[e.p] && S.p[e.p].pop > 6)) return;     // the capital, or a big city near enough to hear
    if (S.day - raidAt < 6) return;
    raidAt = S.day;
    const n = e.p === me.cap ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const a = ((S.day * 7 + i * 131) % 360) * Math.PI / 180, d = 210 + ((S.day * 13 + i * 57) % 140);
      const x = P.pos.x + Math.sin(a) * d, z = P.pos.z + Math.cos(a) * d;
      setTimeout(function () { try { CBZ.detonate(x, null, z, "bomb", { byPlayer: false }); } catch (er) {} }, 2500 + i * 1700);
    }
    if (CBZ.sfxAt) { try { CBZ.sfxAt("siren", P.pos.x, P.pos.z, { volume: 0.45 }); } catch (er) {} }
    const PR = CBZ.protection;
    if (PR && PR.alarm) { try { PR.alarm(P.pos.x, P.pos.z, "air strike"); } catch (er) {} }
  }
  let protestDay = -999;
  function streetTemper(me) {
    const PP = CBZ.presidentPublic;
    if (!PP || !PP.protest || me.unrest < 45 || S.day - protestDay < 20) return;
    if (PP.protest(Math.round(6 + me.unrest / 6))) protestDay = S.day;
  }
  function news(text, o) { const P = PO(); if (P && P.news) { try { P.news(text, o || {}); } catch (e) {} } }
  // the people in the Mansion are the cabinet: the names on the book's cabinet
  // page are the General, the Treasury Secretary and the Bureau Director
  // standing in the building
  function syncCabinet() {
    const P = CBZ.presidency, me = c();
    if (!P || !P.cabinet || !me) return;
    let cab = null; try { cab = P.cabinet(); } catch (e) { cab = null; }
    if (!cab) return;
    for (const r in ROLE) { const k = ROLE[r]; if (cab[k] && cab[k].name && !cab[k].dead && me.cab[r]) me.cab[r].name = cab[k].name; }
  }

  // ---- the briefing book's pages
  function bookSource() {
    return {
      pages: function () { return CBZ.presPapers.order(); },
      paint: function (ctx, id) { return CBZ.presPapers.paint(ctx, id, S, ME, UI); },
      press: function (hit, x, y) {
        if (hit.act) {
          const a = JSON.parse(JSON.stringify(hit.act));
          const r = submit(a);
          // firing a cabinet member who has a body: he is dismissed in the building too
          if (a.type === "fire" && ROLE[a.role] && CBZ.presidentStaff && CBZ.presidentStaff.dismiss) {
            try { CBZ.presidentStaff.dismiss(ROLE[a.role], { quiet: true }); } catch (e) {}
          }
          return r;
        }
        if (hit.fn === "pick") { UI.sel = hit.c; hit.go = "country"; return true; }
        if (hit.fn === "map") { const t = CBZ.presPapers.mapPick(S, hit, x, y); if (t != null && t !== ME) { UI.sel = t; hit.go = "country"; } return true; }
        return true;
      },
      version: function () { return S ? S.day * 100000 + A.ver : 0; },
    };
  }

  // ---- the end: when you are out, or the last one standing
  const LINE = { won: "The last one standing.", election: "Voted out.", coup: "Overthrown.", assassinated: "Assassinated.", revolution: "Driven out by the street.",
    capitulated: "Your country surrendered.", resigned: "You signed it.", annexed: "Your country is gone.", shot: "Shot dead.", exile: "You got out. The country did not." };
  function end(why) {
    if (A.ended) return;
    A.ended = true; A.why = why;
    // a storm in the building plays out first: its own end calls this, after
    const delay = CBZ.presStorm && CBZ.presStorm.active && CBZ.presStorm.active() ? 2600 : 1600;
    setTimeout(function () { card(why); }, delay);
  }
  function card(why) {
    const me = c();
    const box = document.createElement("div");
    box.id = "presEnd";
    box.style.cssText = "position:fixed;inset:0;z-index:2147483100;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,6,10,.72)";
    const yrs = Math.floor(S.day / 365), dd = S.day % 365;
    box.innerHTML = "<div style='max-width:520px;width:100%;background:#f2ede0;color:#1c1d22;border-radius:6px;padding:26px 24px;font-family:Georgia,serif;box-shadow:0 30px 80px rgba(0,0,0,.6)'>" +
      "<h2 style='margin:0 0 6px;font:700 34px Georgia,serif'></h2><p style='margin:0 0 16px;opacity:.7'></p>" +
      "<a href='games/president.html' style='display:inline-block;padding:12px 22px;border-radius:999px;background:#c8a24a;color:#16120a;font:700 16px system-ui,sans-serif;text-decoration:none'>Again</a></div>";
    box.querySelector("h2").textContent = LINE[why] || "Out of office.";
    box.querySelector("p").textContent = (me ? me.name + ". " : "") + (yrs ? yrs + (yrs === 1 ? " year, " : " years, ") : "") + dd + " days in office.";
    document.body.appendChild(box);
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) {}
  }

  // ---- a room of presidents: the same world, one clock (the host's)
  function joinRoom() {
    const N = CBZ.presNet; if (!N) return;
    const name = Q.get("pname") || "President";
    let tries = 0;
    const go = function () {
      const relay = Q.get("relay") || null;
      A.net = HOST ? N.host({ name: name, code: ROOM, relay: relay }) : N.join(ROOM, { name: name, relay: relay });
      A.net.on("error", function () { A.net = null; if (++tries < 20) setTimeout(go, 1500); });
      if (HOST) {
        A.seats = {};
        A.net.on("seat", function (d) { A.seats[d.from] = { c: d.c, name: d.name }; if (S) PW().apply(S, { type: "seat", c: d.c, who: String(d.from) }); });
        A.net.on("need", function () { if (S) A.net.snapshot(S, { seats: A.seats }); });
        A.net.on("act", function (d) { const st = A.seats[d.from]; if (!st || !d.a) return; d.a.c = st.c; A.pending.push(d.a); });
      } else {
        A.net.on("open", function () { const NA = CBZ.presNations; A.net.seat(NA.list.findIndex(function (n) { return n.id === KEY; }), name); A.net.need(); });
        A.net.on("snap", function (d) { if (!A.started) { if (seated()) begin(d.S); else A.snapWaiting = d.S; return; } S = d.S; A.ver++; });
        A.net.on("tick", function (d) {
          if (!S) return;
          if (d.day !== S.day) { if (d.day > S.day) A.net.need(); return; }
          if (d.hold) { for (const a of d.acts || []) PW().apply(S, a); afterStep(); return; }
          PW().step(S, d.acts || []); afterStep();
        });
      }
    };
    go();
  }

  /* A MAN AT HIS DESK SEES HIS DESK, not the back of his own head (or his own
     face from across it): once he is in the chair the day starts in his own
     eyes, looking over the desk at the room. After that the view follows his
     hands as it does everywhere (systems/fpsmode.js viewForHands). */
  function eyes() {
    if (A.eyes) return;
    const P = CBZ.player, O = PO();
    if (!P || !P._propSeat || (O && O.placing && O.placing())) return;
    A.eyes = true;
    const dp = O && O.deskPoint ? O.deskPoint() : null;
    try { if (CBZ.setFPS) CBZ.setFPS(true); } catch (e) {}
    if (CBZ.cam) { if (dp) CBZ.cam.yaw = dp.heading + Math.PI; CBZ.cam.pitch = 0.4; }
    if (CBZ.fps) CBZ.fps.fp = -0.4;
  }
  // ---- the clock (it is not the frame: a background tab still runs a room's day)
  let lastT = 0;
  setInterval(function () {
    if (A.phase === "loading" || !PW()) return;
    const now = performance.now(), dt = lastT ? Math.min(1.5, (now - lastT) / 1000) : 0;
    lastT = now;
    if (!A.started) {
      if (g.mode === "city" && g.state === "playing" && seated()) {
        if (ROOM && !A.net) joinRoom();
        if (!ROOM || HOST) begin(null);
        else if (A.snapWaiting) begin(A.snapWaiting);
      }
      return;
    }
    if (A.ended) return;
    eyes();
    if (A.net && A.net.role !== "host") return;               // a guest steps on the host's ticks
    // the world waits while the game is paused or you are reading on the phone menu
    if (g.state !== "playing") return;
    A.acc += dt / DAY_SECS;
    let n = 0;
    while (A.acc >= 1 && n < 4) { A.acc -= 1; n++; stepDay(); }
    if (A.acc > 2) A.acc = 2;
  }, 100);
  // dying in the city is the end of this presidency
  if (CBZ.onUpdate) CBZ.onUpdate(39.2, function () {
    if (!A.started || A.ended) return;
    const P = CBZ.player;
    if (P && P.dead && !(CBZ.presStorm && CBZ.presStorm.active && CBZ.presStorm.active())) {
      submit({ type: "storm", won: false, why: "shot" });
      end("shot");
    }
  });

  CBZ.presGame = {
    on: true, key: KEY,
    state: function () { return S; }, me: function () { return ME; }, ui: UI,
    submit: submit, news: news, end: end,
    audit: function () {
      const me = c();
      return { phase: A.phase, started: A.started, ended: A.ended, why: A.why, day: S ? S.day : null, date: S ? PW().date(S.day).text : null,
        country: me ? me.name : null, leader: me ? me.leader.name : null, matters: me ? me.matters.map(function (m) { return m.kind; }) : [],
        delivered: Object.keys(A.seenM).length, net: A.net ? A.net.role : null, book: CBZ.presBook ? CBZ.presBook.audit() : null };
    },
    // harness: run the world on n days now
    _step: function (n) { for (let i = 0; i < (n | 0); i++) stepDay(); return S ? S.day : null; },
    _ready: ready,
  };
})();
