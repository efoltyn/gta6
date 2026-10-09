/* ============================================================
   city/phone_apps.js — WHAT THE PHONE DOES. The logic under city/phone.js's
   screen: no DOM, no THREE, so tools/phone-check.mjs runs it in plain node.

   OWNER: "PHONE ADDED TO GANG CITY SO PRES CAN SEE NEWS, AND THEN ALSO CALL
   PEOPLE AND THINGS AND DECLARE WAR OVER IN-GAME FAKE TWITTER ETC".

   THREE APPS, ALL REAL:
     NEWS    NEWS ONE's own stories (city/newsroom.js): the same store every
             TV paints, read as a list. Nothing here writes a headline of its
             own; dissent.js, warroom.js, polwar.js, the presidency put them
             there by doing things.
     CALLS   people who exist. For a President: his General (war, airstrike,
             nuke, soldiers on the street), his Chief of Staff (the ride, the
             bunker, the address), the Director, the Commissioner, the
             Treasury Secretary and the press secretary; every one of them
             takes "I need your resignation" (president_staff.js dismiss).
             The Chief rings with two names for an empty chair. Every foreign head of
             state by name (threaten, make peace, offer a deal). For anyone:
             gang bosses (truce, threaten), your crew (come, hold, hit their
             stash), the people you met (their offers), your pilot and your
             jet if you own them, the gig dispatcher. Every answer runs the
             real verb (warroom, presidency.press, dissent, relations,
             polwar, gangs, playergang, dialogue, playerair, gigs) and the
             person says one short line back on the line (speech.phone).
             Calls come IN too: a leader's last warning, the General when
             war is declared on you, the Chief of Staff when the march is
             set, when the officers meet, when the troops move; the desk
             phone's own matters (president_office.cellCall) when you are
             away from the desk; a contact with work for you.
     HOLLER  the social feed (an invented name). Citizens, News One, foreign
             leaders and gangs post about what actually happened (the
             presidency bus and the city event ledger). You post from a few
             options tied to the moment, and the post IS the act: "Declare
             war on Kesh" declares it (warroom.war with that foe), "Threaten
             <leader>" moves relations and he answers, "Address the protests"
             is the address order, "Call out <gang>" provokes them. A big
             post is a headline on NEWS ONE ("President declares war on Kesh
             in a post"): every post and call goes out on the presidency bus
             as "social-post" / "phone-call" with a text field.

   The messages sink is here too: CBZ.cityPhoneNotify (every city system's
   one text channel). News goes to NEWS ONE's wire; a message from a person
   lands in Calls' recents.

   PUBLIC: CBZ.phoneApps = { news, recents, contacts, call, choose, hangup,
     conv, ringing, answer, decline, ring, feed, postOptions, post, unread,
     markRead, isPresident, audit } and CBZ.cityPhoneNotify / cityPhoneNews.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.phoneApps) return;
  const g = CBZ.game || (CBZ.game = {});

  let CLOCK = 0;
  const RING_SECS = 20, RING_GAP = 8, END_HOLD = 2.6;

  // ---------------------------------------------------------------- text law
  function clean(s) {
    return String(s == null ? "" : s)
      .replace(/\s*[·•—–]\s*/g, ", ").replace(/…/g, "...")
      .replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();
  }
  function money(n) { return "$" + Math.round(+n || 0).toLocaleString("en-US"); }
  function day() { try { return CBZ.worldDay ? (CBZ.worldDay() | 0) : 0; } catch (e) { return 0; } }
  function surname(n) { const a = String(n || "").trim().split(/\s+/); return a[a.length - 1] || n; }
  function strHash(s) { s = String(s || ""); let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0x7fffff; return h; }
  let SEQ = 0;
  function pick(list, salt) { return list.length ? list[(strHash(String(salt)) + SEQ) % list.length] : null; }

  // ---------------------------------------------------------------- world reads
  function W() { return CBZ.warroom || null; }
  function Pres() { return CBZ.presidency || null; }
  function us() { const w = W(); try { return w && w.nation ? w.nation() : null; } catch (e) { return null; } }
  function isPresident() { return !!us(); }
  function polGet(id) { try { return id && CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null; } catch (e) { return null; } }
  function countryName(id) { const r = polGet(id); return (r && r.name) || id || ""; }
  // "Kingdom of Kesh" -> "Kesh", "Mbeya Federation" -> "Mbeya"
  function shortName(id) {
    return clean(countryName(id)).replace(/^(the\s+)?(republic|kingdom|federation|empire|state|commonwealth|union)\s+of\s+/i, "")
      .replace(/\s+(federation|republic|kingdom|empire|union)$/i, "").trim() || countryName(id);
  }
  function rel(a, b) { try { return CBZ.relations && CBZ.relations.get ? (CBZ.relations.get(a, b) || 0) : 0; } catch (e) { return 0; } }
  function identity(sid) {
    const O = CBZ.officials;
    if (!sid || !O || !O.identityOf) return null;
    try { const i = O.identityOf(sid); return i && i.name && i.name !== "Someone" ? i : null; } catch (e) { return null; }
  }
  function leaderOf(cid) {
    const rec = polGet(cid);
    if (!rec) return null;
    const holder = rec.office ? rec.office.holder : null;
    const who = identity(holder);
    let title = "President";
    try { if (CBZ.officials && CBZ.officials.titleFor) title = CBZ.officials.titleFor(rec) || title; } catch (e) {}
    if (/monarch/.test(String(rec.govType || "")) && title === "President") title = "King";
    const name = who ? who.name : null;
    return { cid: cid, title: title, name: name, display: name ? title + " " + surname(name) : title + " of " + shortName(cid), full: name ? title + " " + name : title + " of " + shortName(cid) };
  }
  function foreignCountries() {
    const me = us();
    let l = [];
    try { l = CBZ.polity && CBZ.polity.list ? (CBZ.polity.list("country") || []) : []; } catch (e) { l = []; }
    return l.filter(function (c) { return c && c.id && c.id !== me && !c.dissolved; });
  }
  function enemy() { const w = W(); try { return w && w.enemy ? w.enemy() : null; } catch (e) { return null; } }
  function cabinet() { const p = Pres(); try { return p && p.cabinet ? p.cabinet() : {}; } catch (e) { return {}; } }
  function dissentStage() { try { return CBZ.dissent ? CBZ.dissent.stage() | 0 : 0; } catch (e) { return 0; } }
  function press(key) {
    const p = Pres();
    if (!p || !p.press) return { ok: false, why: "Nobody is answering." };
    try { return p.press(key) || { ok: false, why: "" }; } catch (e) { return { ok: false, why: "It didn't go through." }; }
  }
  function emit(evt, payload) {
    const p = Pres();
    if (p && p.emit) { try { p.emit(evt, payload); return; } catch (e) {} }
    if (CBZ.news && CBZ.news.event) { try { CBZ.news.event(evt, payload); } catch (e) {} }
  }
  function speak(line) {
    line = clean(line);
    if (!line) return;
    if (CBZ.speech && CBZ.speech.phone) { try { CBZ.speech.phone(line, { secs: 3.2 }); } catch (e) {} }
  }
  function playerName() {
    const i = identity("player");
    return i ? i.name : "You";
  }
  function gangs() { return (CBZ.cityGangs || []).filter(function (gn) { return gn && !gn.isPlayer && !gn.absorbed && gn.id !== "player" && gn.bossName && !(gn.boss && gn.boss.dead); }); }
  function gangById(id) { const l = CBZ.cityGangs || []; for (let i = 0; i < l.length; i++) if (l[i] && l[i].id === id) return l[i]; return null; }
  function crew() { try { return CBZ.cityPlayerGangMembers ? (CBZ.cityPlayerGangMembers() || []) : []; } catch (e) { return []; } }

  /* ========================================================================
     MESSAGES: the city's one text sink (was city/phone.js's)
     ======================================================================== */
  const CONTROL_COPY_RE = /\[[A-Za-z0-9/\- ]{1,8}\]|\b(?:press|click|hold|tap)\b|\bLMB\b|\bRMB\b|Shift\+|\bWASD\b/i;
  const META_COPY_RE = /\b(?:NPC|HUD|UI|reticle|crosshair|respawn(?:ing)?|game over|tutorial|keybind|hotbar|controller|keyboard|mouse|frame ?rate|FPS|first[- ]person|third[- ]person)\b/i;
  const notices = [];            // every accepted notice (tests read CBZ.cityPhoneNews)
  const recents = [];            // what Calls shows on top: missed calls, texts from people
  const UNREAD = { news: 0, calls: 0, social: 0 };
  let newsSeen = 0;
  function sender(from, app) {
    const s = clean(from);
    if (!s || /^(status|alert|system|messages?)$/i.test(s)) return app === "news" ? "City Desk" : "";
    if (/^objective$/i.test(s)) return "Dispatch";
    return s;
  }
  function addRecent(name, text, kind) {
    const last = recents[recents.length - 1];
    if (last && last.name === name && last.text === text && CLOCK - last.t < 5) { last.t = CLOCK; return last; }
    const r = { name: name, text: clean(text), kind: kind || "text", t: CLOCK, day: day() };
    recents.push(r);
    if (recents.length > 14) recents.shift();
    UNREAD.calls++;
    return r;
  }
  CBZ.cityPhoneNotify = function (payload) {
    if (typeof payload === "string") payload = { text: payload };
    payload = payload || {};
    const text = clean(payload.text != null ? payload.text : (payload.body != null ? payload.body : ""));
    if (!text || CONTROL_COPY_RE.test(text) || META_COPY_RE.test(text)) return null;
    if (typeof CBZ.cityPhoneWorthy === "function" && !CBZ.cityPhoneWorthy(text, payload, false)) return null;
    const app = String(payload.app || "messages").toLowerCase();
    const from = sender(payload.from, app);
    const item = { app: app, from: from, text: text, t: CLOCK };
    notices.push(item);
    if (notices.length > 40) notices.shift();
    if (app === "news") {
      // the City Desk's news is NEWS ONE's (city/newsroom.js); tv:false opts out
      if (payload.tv !== false && CBZ.news && CBZ.news.wire) { try { CBZ.news.wire(text, from); } catch (e) {} }
    } else if (from) addRecent(from, text, "text");
    return item;
  };
  CBZ.cityPhoneNews = notices;

  /* ========================================================================
     NEWS: NEWS ONE's store, newest first
     ======================================================================== */
  function news() {
    const N = CBZ.news;
    let list = [];
    if (N && N.stories) { try { list = N.stories() || []; } catch (e) { list = []; } }
    const out = [];
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      out.push({ h: clean(s.h), sub: clean(s.sub || ""), cat: s.cat || "", breaking: s.kind === "breaking", t: s.t });
    }
    if (!out.length) {
      for (let i = notices.length - 1; i >= 0; i--) if (notices[i].app === "news") out.push({ h: notices[i].text, sub: "", cat: "", breaking: false });
    }
    return out;
  }
  function newsCount() { const N = CBZ.news; try { return N && N.audit ? (N.audit().pushed | 0) : 0; } catch (e) { return 0; } }

  /* ========================================================================
     HOLLER: the social feed
     ======================================================================== */
  const feed = [];
  const CITIZENS = [];
  function citizen(i) {
    if (!CITIZENS.length) {
      let rng = null;
      if (CBZ.seedStream) { try { rng = CBZ.seedStream("phone:holler"); } catch (e) { rng = null; } }
      if (!rng) { let x = 0x7a11; rng = function () { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
      const F = ["Dana", "Marco", "Keisha", "Tomas", "Priya", "Jake", "Lucia", "Andre", "Mei", "Sam", "Rosa", "Eli"];
      const L = ["Reyes", "Novak", "Grant", "Okafor", "Lind", "Haas", "Moreno", "Clarke", "Duarte", "Sato", "Kale", "Brooks"];
      for (let k = 0; k < 12; k++) {
        let n = null;
        if (CBZ.cityMintName) { try { n = CBZ.cityMintName(rng, rng() < 0.5 ? "f" : "m"); } catch (e) { n = null; } }
        if (!n) n = F[(rng() * F.length) | 0] + " " + L[(rng() * L.length) | 0];
        const p = String(n).split(/\s+/);
        CITIZENS.push({ name: n, handle: "@" + (p[0][0] + (p[p.length - 1] || "")).toLowerCase().replace(/[^a-z0-9]/g, "") + (k * 7 + 3), kind: "citizen" });
      }
    }
    return CITIZENS[Math.abs(i | 0) % CITIZENS.length];
  }
  const PRESS = { name: "News One", handle: "@newsone", kind: "press" };
  function leaderAuthor(cid) {
    const L = leaderOf(cid);
    if (!L) return null;
    return { name: L.display, handle: "@" + shortName(cid).toLowerCase().replace(/[^a-z]/g, "") + "gov", kind: "leader", cid: cid };
  }
  function gangAuthor(gn) { return { name: gn.name, handle: "@" + String(gn.name || "crew").toLowerCase().replace(/[^a-z0-9]/g, ""), kind: "gang", gid: gn.id }; }
  function youAuthor() {
    if (isPresident()) return { name: "President " + surname(playerName()), handle: "@president", kind: "you" };
    const n = playerName();
    return { name: n, handle: "@" + String(n).toLowerCase().replace(/[^a-z0-9]/g, ""), kind: "you" };
  }
  function addPost(author, text, opts) {
    text = clean(text);
    if (!author || !text) return null;
    for (let i = feed.length - 1; i >= 0 && i >= feed.length - 10; i--) {
      if (feed[i].text === text && CLOCK - feed[i].t < 30) return null;
    }
    SEQ++;
    const p = { id: "h" + SEQ, name: author.name, handle: author.handle, kind: author.kind, text: text, t: CLOCK, day: day(), reply: !!(opts && opts.reply) };
    feed.push(p);
    if (feed.length > 40) feed.shift();
    if (author.kind !== "you") UNREAD.social++;
    return p;
  }
  // a post that lands a few seconds later (a reply, a leader answering)
  const LATER = [];
  function later(secs, fn) { LATER.push({ at: CLOCK + secs, fn: fn }); }

  // ---- the world posts about what happened ----
  function onBus(evt, d) {
    d = d || {};
    const me = us();
    const c = function (k) { return citizen(strHash(evt) + k + SEQ); };
    // ANY MOMENT MAY CARRY ITS OWN POSTS: [{kind:"press"|"citizen"|"leader", name?, text, cid?}].
    // The mob, the address and the transfer of power say what people would
    // post; this is the one place they land, a breath apart.
    if (Array.isArray(d.holler)) {
      for (let k = 0; k < d.holler.length && k < 6; k++) {
        const hp = d.holler[k];
        if (!hp || !hp.text) continue;
        const au = hp.kind === "press" ? PRESS : hp.kind === "leader" && hp.cid ? (leaderAuthor(hp.cid) || PRESS)
          : hp.name ? { name: hp.name, handle: "@" + String(hp.name).toLowerCase().replace(/[^a-z0-9]/g, ""), kind: "citizen" } : c(20 + k);
        if (k === 0) addPost(au, hp.text);
        else later(1.5 + k * 1.8, function () { addPost(au, hp.text); });
      }
    }
    switch (evt) {
      case "war-declared": {
        const a = d.attackerName ? shortName(d.attacker) : null, b = d.defenderName ? shortName(d.defender) : null;
        if (!a || !b) return;
        addPost(PRESS, a + " declares war on " + b + ".");
        if (d.byPlayer) {
          addPost(c(1), pick(["Not in my name.", "About time somebody stood up to them.", "My brother ships out tomorrow."], evt + b));
          const la = leaderAuthor(d.defender);
          if (la) later(4, function () { addPost(la, a + " will regret this.", { reply: true }); });
        } else if (d.defender === me) {
          addPost(c(2), pick(["They attacked us. Stay inside tonight.", "Sirens all over the city."], evt + a));
        }
        return;
      }
      case "war-ended":
        if (d.winnerName && d.loserName) addPost(PRESS, "The war between " + shortName(d.winner) + " and " + shortName(d.loser) + " is over.");
        addPost(c(1), "Thank God it's over.");
        return;
      case "airstrike":
        if (d.label) {
          addPost(PRESS, "Airstrike on " + d.label + ".");
          addPost(c(3), pick(["Heard the jets over " + d.label + ". My windows shook.", "Smoke over " + d.label + ". Is everyone ok?"], d.label));
        }
        return;
      case "nuke": {
        const where = d.label ? " near " + d.label : "";
        addPost(PRESS, "Nuclear blast" + where + ".");
        addPost(c(4), "Is this it?");
        const others = foreignCountries().filter(function (x) { return x.id !== d.attacker && x.id !== d.nation; });
        const o = others.length ? leaderAuthor(others[SEQ % others.length].id) : null;
        if (o && d.attackerName) later(5, function () { addPost(o, shortName(d.attacker) + " crossed a line nobody crosses.", { reply: true }); });
        return;
      }
      case "dissent": {
        const nm = String(d.name || "");
        if (nm === "unrest") addPost(c(5), pick(["Everyone I know is out on the street tonight.", "Prices up, wages down, and he gives speeches."], nm));
        else if (nm === "movement") {
          if (d.leader) addPost({ name: d.leader, handle: "@" + String(d.leader).toLowerCase().replace(/[^a-z]/g, ""), kind: "citizen" }, "We march tomorrow. Bring your neighbors.");
          addPost(c(6), "Thousands at the rally. This is real.");
        } else if (nm === "army") addPost(PRESS, "Sources say senior officers met last night without the President.");
        else if (nm === "coup-armed") { addPost(c(7), "Tanks on the ring road. What is going on?"); addPost(PRESS, d.headline || "Troops on the move."); }
        else if (nm === "coup") { addPost(PRESS, d.headline || "The army has taken power."); addPost(c(8), "Stay home. Soldiers everywhere."); }
        else if (nm === "coup-failed") addPost(PRESS, "Coup attempt crushed. The plotters are under arrest.");
        else if (nm === "coup-split") addPost(PRESS, "The army has split. Fighting reported.");
        else if (nm === "calm") addPost(c(10), "Quiet night for once.");
        return;
      }
      case "protest":
        if (d.phase === "start") addPost(c(11), d.groupName ? "The " + d.groupName.toLowerCase() + " are at the Mansion gate. It's packed." : "At the Mansion gate. It's packed.");
        return;
      // the President's people (city/president_staff.js)
      case "dismissal":
        if (d.headline) addPost(PRESS, d.headline + ".");
        addPost(c(9), d.role === "general" ? "He fired the General? Something is happening." : pick(["Another one gone.", "Who's left in there?"], evt + d.name));
        return;
      case "appointment":
        if (d.headline && d.ok === false) addPost(PRESS, d.headline + ".");
        return;
      case "former": {
        if (!d.name || !d.text) return;
        const who = { name: d.name, handle: "@" + String(d.name).toLowerCase().replace(/[^a-z]/g, ""), kind: "citizen" };
        addPost(who, d.text);
        if (d.kind === "leak" && d.headline) addPost(PRESS, d.headline + ".");
        return;
      }
      case "speech":
        if (+d.approvalDelta > 0.5) addPost(c(12), "Good speech. Didn't expect that.");
        else if (+d.approvalDelta < -0.5) addPost(c(12), "Same old lines.");
        return;
      case "impeach":
        addPost(PRESS, "Articles of impeachment filed against the President.");
        return;
      // THE ACT RECORD (city/politics.js): the groups that minded most say so
      // in their own voices; a Congress vote is a line from the press
      case "act": {
        const R0 = d.reactions || [];
        for (let i = 0; i < R0.length; i++) {
          const x = R0[i];
          if (!x || !x.text || !x.name) continue;
          later(1 + i * 2, function () { addPost({ name: x.name, handle: x.handle || ("@" + String(x.name).toLowerCase().replace(/[^a-z]/g, "")), kind: "citizen", group: x.group }, x.text); });
        }
        if (d.headline && d.news !== false) addPost(PRESS, d.headline + ".");
        return;
      }
      case "vote":
        if (d.headline) addPost(PRESS, d.headline + ".");
        return;
      default:
        return;
    }
  }
  function onCity(type, d) {
    const t = String(type || "").toLowerCase();
    d = d || {};
    if (/heist/.test(t) && (d.tier === "bank" || d.tier === "armored")) addPost(citizen(SEQ + 13), d.tier === "bank" ? "Somebody just hit the bank. Cops everywhere." : "Armored truck got cracked open on my street.");
    else if (/jail-escape|breakout/.test(t)) addPost(PRESS, "An inmate has broken out of jail.");
    else if (/quake/.test(t)) addPost(citizen(SEQ + 14), "Did everyone feel that?");
    else if (/tsunami/.test(t)) addPost(citizen(SEQ + 15), "Get to high ground. Now.");
  }

  // ---- what YOU can post (few, tied to the moment, and each one does it) ----
  function postOptions() {
    const out = [];
    const me = us();
    const Wr = W();
    if (me && Wr) {
      const foe = enemy();
      if (!foe) {
        let cw = null;
        try { cw = Wr.canWar ? Wr.canWar() : null; } catch (e) { cw = null; }
        if (cw && cw.ok) out.push({ id: "war:" + cw.foe, label: "Declare war on " + shortName(cw.foe) });
      } else {
        out.push({ id: "peace", label: "Offer " + shortName(foe) + " peace" });
      }
      // threaten the enemy, else whoever we get on with worst
      let tgt = foe, worst = Infinity;
      if (!tgt) foreignCountries().forEach(function (c) { const v = rel(me, c.id); if (v < worst) { worst = v; tgt = c.id; } });
      const L = tgt ? leaderOf(tgt) : null;
      if (L) out.push({ id: "threat:" + tgt, label: "Threaten " + L.display });
      if (dissentStage() >= 1) out.push({ id: "address", label: "Address the protests" });
    } else {
      // anyone: call out the crew whose blocks are nearest
      const P = CBZ.player;
      let best = null, bd = Infinity;
      gangs().forEach(function (gn) {
        const c = gn.center || (gn.turf && gn.turf[0]);
        if (!c || !P || !P.pos) { if (!best) best = gn; return; }
        const d = Math.hypot((c.x != null ? c.x : c.cx) - P.pos.x, (c.z != null ? c.z : c.cz) - P.pos.z);
        if (d < bd) { bd = d; best = gn; }
      });
      if (best) out.push({ id: "callout:" + best.id, label: "Call out " + best.name });
    }
    return out.slice(0, 3);
  }
  function post(id) {
    id = String(id || "");
    const me = us(), Wr = W();
    let r = { ok: false, why: "" }, text = "", headline = null, breaking = false;
    if (id.indexOf("war:") === 0 && me && Wr) {
      const foe = id.slice(4);
      r = Wr.war ? Wr.war({ foe: foe }) : r;
      if (r && r.ok) {
        text = "As of today we are at war with " + shortName(foe) + ". They chose this.";
        headline = "President declares war on " + shortName(foe) + " in a post"; breaking = true;
      }
    } else if (id === "peace" && me && Wr) {
      const foe = enemy();
      r = Wr.peace ? Wr.peace() : r;
      if (r && r.ok && foe) { text = "The war with " + shortName(foe) + " is over. Our people come home."; headline = "President ends the war with " + shortName(foe) + " in a post"; }
    } else if (id.indexOf("threat:") === 0 && me) {
      const cid = id.slice(7);
      const L = leaderOf(cid);
      if (!L || !CBZ.relations || !CBZ.relations.event) r = { ok: false, why: "Nobody to threaten." };
      else {
        // THE POST IS THE ACT (city/politics.js): a threat at a country
        const Po = CBZ.politics;
        let v;
        if (Po && Po.act && Po.owns && Po.owns(me)) { Po.act("threaten", { target: cid, by: "self", scale: 1.2 }); v = rel(me, cid); }
        else v = CBZ.relations.event(me, cid, "insult", 15);
        r = { ok: true };
        text = L.display + ", one more move against us and you will answer for it.";
        headline = "President threatens " + L.display + " in a post";
        const la = leaderAuthor(cid), ap = approvalOf(me);
        later(5, function () {
          if (v <= -85 && !enemy() && CBZ.polwar && CBZ.polwar.declareWar) {
            let w = null;
            try { w = CBZ.polwar.declareWar(cid, me, {}); } catch (e) { w = null; }
            if (w) { addPost(la, "So be it.", { reply: true }); return; }
          }
          addPost(la, ap < 40 ? "Big words from a man his own people want gone." : "We will see.", { reply: true });
        });
      }
    } else if (id === "address" && me) {
      r = CBZ.dissent ? CBZ.dissent.concede() : { ok: false, why: "" };
      if (r && r.ok) { text = "I hear you. Tonight I speak to the nation."; headline = "President promises to answer the protests"; }
    } else if (id.indexOf("callout:") === 0) {
      const gn = gangById(id.slice(8));
      if (!gn) r = { ok: false, why: "They're gone." };
      else {
        if (CBZ.cityGangProvoke) { try { CBZ.cityGangProvoke(gn.id, 0.6); } catch (e) {} }
        if (CBZ.cityGangAddStanding) { try { CBZ.cityGangAddStanding(gn.id, -10); } catch (e) {} }
        r = { ok: true };
        text = gn.name + ", stay off our blocks.";
        const ga = gangAuthor(gn);
        later(4, function () { addPost(ga, "Come find out.", { reply: true }); });
      }
    } else r = { ok: false, why: "" };
    if (!r || !r.ok) return { ok: false, why: clean((r && r.why) || "It didn't go out.") };
    const p = addPost(youAuthor(), text);
    emit("social-post", { text: text, by: youAuthor().name, option: id, headline: headline, breaking: breaking });
    return { ok: true, post: p, text: text, headline: headline };
  }
  function approvalOf(id) { const r = polGet(id); return r && r.approval != null ? +r.approval : 50; }

  /* ========================================================================
     CALLS
     ======================================================================== */
  function contacts() {
    const out = [];
    const me = us();
    if (me) {
      // every post that has somebody in it (city/president_staff.js); the
      // Treasury Secretary has no body anywhere, so this is how you reach him
      STAFF.forEach(function (s) {
        const c = staffPerson(s.id);
        if (c) out.push({ id: s.id, name: s.id === "general" ? (c.display || c.name) : c.name, role: s.role, kind: "staff" });
      });
    }
    if (crew().length) out.push({ id: "crew", name: (g.playerGang && g.playerGang.name) || "Crew", role: "Your crew", kind: "crew" });
    const D = CBZ.cityDialogue;
    if (D && D.contacts) {
      let l = [];
      try { l = D.contacts() || []; } catch (e) { l = []; }
      l.forEach(function (c) { out.push({ id: "met:" + c.id, name: c.name, role: c.friend ? "Friend" : (c.org ? String(c.org) : ""), kind: "met", pending: !!c.pending }); });
    }
    gangs().forEach(function (gn) { out.push({ id: "gang:" + gn.id, name: gn.bossName, role: gn.name, kind: "gang" }); });
    if (me) foreignCountries().forEach(function (c) { const L = leaderOf(c.id); if (L) out.push({ id: "leader:" + c.id, name: L.display, role: countryName(c.id), kind: "leader" }); });
    let air = null;
    try { air = CBZ.cityAirServices ? CBZ.cityAirServices() : null; } catch (e) { air = null; }
    if (air && air.helipad && !me) out.push({ id: "pilot", name: "Pilot", role: "Chopper", kind: "service" });
    if (air && air.hangar) out.push({ id: "jet", name: "Hangar", role: "F-22", kind: "service" });
    if (CBZ.cityGig) out.push({ id: "dispatch", name: "Dispatch", role: "Work", kind: "service" });
    return out;
  }
  function contactById(id) { const l = contacts(); for (let i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  const STAFF = [
    { id: "general", role: "General" }, { id: "chief", role: "Chief of Staff" }, { id: "bureau", role: "Bureau Director" },
    { id: "police", role: "Police Commissioner" }, { id: "treasury", role: "Treasury Secretary" }, { id: "cia", role: "CIA Director" },
    { id: "ss", role: "Secret Service Director" }, { id: "interior", role: "Interior Minister" }, { id: "press", role: "Press Secretary" },
  ];
  // the heads of the services take a quiet word: a deal off the books
  // (city/politics.js deal: their service's loyalty, a hidden scandal risk)
  const HEAD_INST = { general: "army", bureau: "fbi", police: "police", cia: "cia", ss: "ss" };
  function quietWord(role) {
    const Po = CBZ.politics;
    if (!Po || !Po.deal || !HEAD_INST[role]) return null;
    return { id: "deal", label: "Something for your people", run: function () { return Po.deal(HEAD_INST[role], { kind: "bribe", amount: 40000 }); } };
  }
  function staffPerson(role) {
    const PS = CBZ.presidentStaff;
    if (PS && PS.person) { try { return PS.person(role); } catch (e) { return null; } }
    const c = cabinet()[role];
    return c && !c.dead ? c : null;
  }
  // the one way to let somebody go by phone (city/president_staff.js)
  function resign(role) {
    return { id: "resign", label: "I need your resignation", run: function () {
      const PS = CBZ.presidentStaff;
      if (!PS || !PS.dismiss) return { ok: false, why: "Not over the phone." };
      return PS.dismiss(role, { via: "phone" });
    } };
  }
  // the answer on the line: his reply, or why it can't be done. An empty line
  // means the thing answers for itself (the pilot reads his own tasking back).
  function said(r, okLine) {
    if (r && r.ok) return r.line === "" ? "" : (r.line || okLine || "Done.");
    return (r && r.why) || "It can't be done.";
  }

  // what a person says when you ring him, and what you can say back
  function script(id) {
    const me = us(), Wr = W(), st = dissentStage();
    if (id === "general" && me && Wr) {
      const foe = enemy();
      const ch = [];
      // the army is plotting: letting him go is the first thing on the line
      if (st >= 3) ch.push(resign("general"));
      if (foe) ch.push({ id: "strike", label: "Airstrike", run: function () { return press("strike"); } });
      else {
        let cw = null;
        try { cw = Wr.canWar(); } catch (e) { cw = null; }
        if (cw && cw.ok) ch.push({ id: "war", label: "War on " + shortName(cw.foe), run: function () { return Wr.war({ foe: cw.foe }); } });
      }
      if (Wr.warheads && Wr.warheads() > 0) ch.push({ id: "nuke", label: "Nuke", run: function () { return press("nuke"); } });
      if (st >= 1 && ch.length < 3) ch.push({ id: "streets", label: "Clear the streets", run: function () { return CBZ.dissent.crackdown(); } });
      const line = st >= 3 ? "Yes?" : foe ? shortName(foe) + " is still fighting. Orders?" : "Go ahead, sir.";
      const out = ch.slice(0, st >= 3 ? 3 : 2);
      const qw = quietWord("general");
      if (qw && out.length < 3) out.push(qw);
      if (st < 3) out.push(resign("general"));
      return { line: line, choices: out };
    }
    if (id === "chief" && me) {
      const ch = [{ id: "ride", label: "Send the car", run: ride }];
      if (st >= 3 || enemy()) ch.push({ id: "bunker", label: "Get me to the bunker", run: function () { return CBZ.dissent ? CBZ.dissent.bunker() : { ok: false, why: "" }; } });
      if (st >= 1) ch.push({ id: "address", label: "Address the nation", run: function () { return CBZ.dissent.concede(); } });
      const line = st >= 4 ? "Sir, we need to move you. Now." : st >= 2 ? "The opposition is organised now, sir." : "Sir?";
      return { line: line, choices: ch.slice(0, 2).concat([resign("chief")]) };
    }
    // the rest of the cabinet and the press secretary: a word, and the one verb
    if (/^(bureau|police|treasury|cia|ss|interior|press)$/.test(id) && me) {
      const LINE = { bureau: "Director.", police: "Commissioner here.", treasury: "Treasury.", cia: "Langley.", ss: "Service.", interior: "Interior.", press: "Yes, sir?" };
      const qw = quietWord(id);
      return { line: LINE[id], choices: qw ? [qw, resign(id)] : [resign(id)] };
    }
    if (id.indexOf("leader:") === 0 && me) {
      const cid = id.slice(7);
      const v = rel(me, cid), atWar = enemy() === cid;
      const line = atWar ? "You have some nerve calling me." : v <= -40 ? "What do you want?" : v >= 30 ? "Good to hear from you, friend." : "I'm listening.";
      const ch = [{ id: "threaten", label: "Threaten", run: function () { return threaten(cid); } }];
      if (atWar) ch.push({ id: "peace", label: "Make peace", run: function () { const r = Wr.peace(); return r && r.ok ? { ok: true, line: "Fine. It's over." } : r; } });
      else ch.push({ id: "deal", label: "Offer a deal", run: function () { return deal(cid); } });
      return { line: line, choices: ch };
    }
    if (id.indexOf("gang:") === 0) {
      const gid = id.slice(5);
      let s = 0;
      try { s = CBZ.cityGangStanding ? CBZ.cityGangStanding(gid) : 0; } catch (e) { s = 0; }
      const line = s <= -40 ? "You got a death wish calling me?" : s >= 30 ? "What's up." : "Who is this?";
      return { line: line, choices: [
        { id: "truce", label: "Truce", run: function () {
          let cur = 0; try { cur = CBZ.cityGangStanding(gid); } catch (e) {}
          if (cur <= -60) return { ok: false, why: "Too late for that." };
          if (CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(gid, 15);
          return { ok: true, line: "Fine. Stay off our blocks." };
        } },
        { id: "threaten", label: "Threaten", run: function () {
          if (CBZ.cityGangProvoke) CBZ.cityGangProvoke(gid, 0.6);
          if (CBZ.cityGangAddStanding) CBZ.cityGangAddStanding(gid, -15);
          return { ok: true, line: "You just made a mistake." };
        } },
      ] };
    }
    if (id === "crew") {
      const order = function (k, line) { return function () { if (!CBZ.cityPlayerGangOrder) return { ok: false, why: "Nobody picked up." }; try { CBZ.cityPlayerGangOrder(k); } catch (e) {} return { ok: true, line: line }; }; };
      return { line: "Yeah, boss?", choices: [
        { id: "follow", label: "Come to me", run: order("follow", "On our way.") },
        { id: "hold", label: "Hold here", run: order("hold", "We'll hold it.") },
        { id: "raid", label: "Hit their stash", run: order("raid", "Say less.") },
      ] };
    }
    if (id.indexOf("met:") === 0) {
      const cid = id.slice(4), D = CBZ.cityDialogue;
      let c = null;
      try { const l = D && D.contacts ? D.contacts() : []; for (let i = 0; i < l.length; i++) if (l[i].id === cid) c = l[i]; } catch (e) { c = null; }
      if (!c || !c.pending) return { line: "Hey. Nothing for you right now.", choices: [] };
      return metOffer(c);
    }
    if (id === "pilot") return { line: "Where to?", choices: [{ id: "pickup", label: "Pick me up", run: function () { return CBZ.cityCallChopper && CBZ.cityCallChopper() ? { ok: true, line: "On my way." } : { ok: false, why: "Can't fly right now." }; } }] };
    if (id === "jet") return { line: "Hangar.", choices: [{ id: "strike", label: "Airstrike", run: function () { return CBZ.cityCallAirstrike && CBZ.cityCallAirstrike() ? { ok: true, line: "" } : { ok: false, why: "Jet can't go right now." }; } }] };
    if (id === "dispatch") {
      const G = CBZ.cityGig;
      let act = null;
      try { act = G && G.active ? G.active() : null; } catch (e) { act = null; }
      if (act) return { line: "You're already on a job.", choices: [{ id: "drop", label: "Drop it", run: function () { try { G.fail("dropped"); } catch (e) {} return { ok: true, line: "Your call." }; } }] };
      const job = function (kind) { return function () {
        let l = [];
        try { l = G.offer(kind) || []; } catch (e) { l = []; }
        if (!l.length) return { ok: false, why: "Nothing on the board." };
        let ok = false;
        try { ok = G.accept(l[0]); } catch (e) { ok = false; }
        return ok ? { ok: true, line: "It's yours. Pickup's marked." } : { ok: false, why: "Somebody took it." };
      }; };
      return { line: "Dispatch.", choices: [
        { id: "delivery", label: "Delivery", run: job("delivery") },
        { id: "taxi", label: "Rideshare", run: job("taxi") },
        { id: "smuggle", label: "Smuggle run", run: job("smuggle") },
      ] };
    }
    return { line: "", choices: [] };
  }
  function metOffer(c) {
    const p = c.pending, D = CBZ.cityDialogue;
    const line = p.kind === "job" ? "Got work. " + clean(p.title || "A job") + ", " + money(p.pay) + "." : "Meet me at " + clean(p.place || "the spot") + ".";
    const ans = function (yes, l) { return function () { let ok = false; try { ok = D.phoneAnswer(c.id, yes); } catch (e) { ok = false; } return ok ? { ok: true, line: l } : { ok: false, why: "Forget it then." }; }; };
    return { line: line, choices: [
      { id: "yes", label: p.kind === "job" ? "I'm in" : "I'll be there", run: ans(true, "Good.") },
      { id: "no", label: p.kind === "job" ? "Not my thing" : "Can't make it", run: ans(false, "Your loss.") },
    ] };
  }
  function ride() {
    const p = Pres(), Pl = CBZ.player;
    const site = p && p.site ? (function () { try { return p.site(); } catch (e) { return null; } })() : null;
    const near = site && Pl && Pl.pos && Math.hypot((site.cx || 0) - Pl.pos.x, (site.cz || 0) - Pl.pos.z) < 260;
    if (near && CBZ.motorcade && CBZ.motorcade.run) {
      let h = null;
      try { h = CBZ.motorcade.run({ principal: "player" }); } catch (e) { h = null; }
      if (h) return { ok: true, line: "The car's on the court, sir." };
    }
    if (CBZ.cityCallChopper && CBZ.cityCallChopper()) return { ok: true, line: "The helicopter's coming to you." };
    return { ok: false, why: "Nothing can get to you right now." };
  }
  function threaten(cid) {
    const me = us();
    if (!me || !CBZ.relations || !CBZ.relations.event) return { ok: false, why: "The line is dead." };
    const v = CBZ.relations.event(me, cid, "insult", 15);
    const L = leaderOf(cid);
    emit("phone-call", { text: "President threatens " + (L ? L.display : shortName(cid)) + " by phone", with: cid, headline: "President threatens " + (L ? L.display : shortName(cid)) + " by phone" });
    if (v <= -85 && !enemy() && CBZ.polwar && CBZ.polwar.declareWar) {
      let w = null;
      try { w = CBZ.polwar.declareWar(cid, me, {}); } catch (e) { w = null; }
      if (w) return { ok: true, line: "Then we settle it with guns." };
    }
    return { ok: true, line: v <= -60 ? "You'll regret saying that." : "That's beneath you." };
  }
  const DEAL_COST = 20000;
  function deal(cid) {
    const me = us(), rec = polGet(me);
    if (!rec || !CBZ.relations || !CBZ.relations.event) return { ok: false, why: "The line is dead." };
    if ((rec.treasury || 0) < DEAL_COST) return { ok: false, why: "Come back when you can pay." };
    rec.treasury -= DEAL_COST;
    CBZ.relations.event(me, cid, "trade", 15);
    const L = leaderOf(cid);
    emit("phone-call", { text: "President strikes a deal with " + (L ? L.display : shortName(cid)), with: cid, headline: shortName(me) + " and " + shortName(cid) + " strike a deal" });
    return { ok: true, line: "We can work with that." };
  }

  // ---- the call in progress (one at a time) ----
  let CONV = null;      // {id, name, role, line, choices:[{id,label,run}], incoming, state:"talk"|"done", reply, endAt}
  function publicConv() {
    if (!CONV) return null;
    return {
      id: CONV.id, name: CONV.name, role: CONV.role, line: CONV.line, incoming: !!CONV.incoming, state: CONV.state,
      reply: CONV.reply || "", since: CLOCK - CONV.t0,
      choices: CONV.state === "talk" ? CONV.choices.map(function (c) { return { id: c.id, label: c.label }; }) : [],
    };
  }
  function call(id) {
    if (CONV && CONV.state === "talk") return publicConv();
    const c = contactById(id);
    if (!c) return null;
    const s = script(id);
    CONV = { id: id, name: c.name, role: c.role, line: clean(s.line), choices: s.choices || [], incoming: false, state: "talk", t0: CLOCK, reply: "" };
    if (!CONV.choices.length) { CONV.state = "done"; CONV.endAt = CLOCK + END_HOLD; }
    speak(CONV.line);
    return publicConv();
  }
  function choose(choiceId) {
    if (!CONV || CONV.state !== "talk") return null;
    let ch = null;
    for (let i = 0; i < CONV.choices.length; i++) if (CONV.choices[i].id === choiceId) ch = CONV.choices[i];
    if (!ch) return null;
    let r = null;
    try { r = ch.run ? ch.run() : { ok: true }; } catch (e) { r = { ok: false, why: "The line went dead." }; }
    const line = clean(said(r));
    CONV.state = "done"; CONV.reply = line; CONV.endAt = CLOCK + END_HOLD; CONV.result = r;
    speak(line);
    emit("phone-call", { text: "Call with " + CONV.name + ": " + ch.label, with: CONV.id, choice: choiceId, ok: !!(r && r.ok) });
    return { ok: !!(r && r.ok), line: line, result: r };
  }
  function hangup() {
    if (!CONV) return false;
    if (CONV.state === "talk" && CONV.onMissed && CONV.incoming) { try { CONV.onMissed(); } catch (e) {} }
    CONV = null;
    return true;
  }

  // ---- incoming ----
  const QUEUE = [];
  let RINGING = null, lastRingEnd = -1e9;
  function ring(def) {
    if (!def || !def.name) return null;
    const key = def.key || (def.name + ":" + def.line);
    if (RINGING && RINGING.key === key) return RINGING;
    for (let i = 0; i < QUEUE.length; i++) if (QUEUE[i].key === key) return QUEUE[i];
    const r = { key: key, id: def.id || ("in:" + key), name: clean(def.name), role: clean(def.role || ""), line: clean(def.line), choices: def.choices || [], onMissed: def.onMissed || null, born: CLOCK };
    QUEUE.push(r);
    return r;
  }
  function ringing() { return RINGING ? { name: RINGING.name, role: RINGING.role, since: CLOCK - RINGING.t } : null; }
  function answer() {
    if (!RINGING) return null;
    const r = RINGING;
    RINGING = null; lastRingEnd = CLOCK;
    CONV = { id: r.id, name: r.name, role: r.role, line: r.line, choices: r.choices, incoming: true, state: r.choices.length ? "talk" : "done", t0: CLOCK, reply: "", onMissed: r.onMissed };
    if (!r.choices.length) CONV.endAt = CLOCK + END_HOLD + 1;
    speak(r.line);
    return publicConv();
  }
  function decline() {
    if (!RINGING) return false;
    const r = RINGING;
    RINGING = null; lastRingEnd = CLOCK;
    addRecent(r.name, "Missed call", "missed");
    if (r.onMissed) { try { r.onMissed(); } catch (e) {} }
    return true;
  }

  // ---- who calls you, and when ----
  const CALLED = {};          // key -> day it last rang
  function calledRecently(key, days) { return CALLED[key] != null && day() - CALLED[key] < days; }
  function staffCall(role, line, choices, key) {
    const cab = cabinet(), c = cab[role];
    if (!c || c.dead) return null;
    CALLED[key] = day();
    return ring({ key: key, id: role, name: role === "general" ? (c.display || c.name) : c.name, role: role === "general" ? "General" : "Chief of Staff", line: line, choices: choices });
  }
  function onBusCalls(evt, d) {
    d = d || {};
    const me = us();
    if (!me) return;
    if (evt === "dissent") {
      const D = CBZ.dissent;
      if (!D) return;
      if (d.name === "movement") staffCall("chief", "There's a march tomorrow. Thousands. Say something to them.", [
        { id: "address", label: "Address them", run: function () { return D.concede(); } },
        { id: "streets", label: "Clear the streets", run: function () { return D.crackdown(); } },
      ], "dissent:movement:" + day());
      else if (d.name === "army") staffCall("chief", "Officers met last night without you. The General was there.", [
        { id: "relieve", label: "Relieve him", run: function () { return D.purge(); } },
        { id: "leave", label: "Leave it", run: function () { return { ok: true, line: "I hope you're right." }; } },
      ], "dissent:army:" + day());
      // a General you put in yourself warns you; the one who was at the meeting does not
      else if (d.name === "coup-armed" && day() - (D.status().purgedDay | 0) < 10) staffCall("general", "Units are moving on the capital without my orders. Get to the bunker.", [
        { id: "bunker", label: "Bunker", run: function () { return D.bunker(); } },
        { id: "stay", label: "Hold them", run: function () { return { ok: true, line: "I'll try. Some of them won't listen." }; } },
      ], "dissent:coup:" + day());
      else if (d.name === "coup-armed") staffCall("chief", "Troops are moving on the capital. We have to go.", [
        { id: "bunker", label: "Bunker", run: function () { return D.bunker(); } },
        { id: "stay", label: "I stay", run: function () { return { ok: true, line: "Then God help us." }; } },
      ], "dissent:coup:" + day());
    } else if (evt === "war-declared" && d.defender === me && !d.byPlayer) {
      staffCall("general", "They hit first. I need orders.", [
        { id: "strike", label: "Hit back", run: function () { return press("strike"); } },
        { id: "hold", label: "Hold", run: function () { return { ok: true, line: "Holding." }; } },
      ], "war:" + (d.warId || d.attacker));
    }
  }
  function leaderThreats() {
    const me = us();
    if (!me) return;
    const foe = enemy();
    const l = foreignCountries();
    for (let i = 0; i < l.length; i++) {
      const cid = l[i].id;
      if (cid === foe || rel(me, cid) > -60 || calledRecently("threat:" + cid, 3)) continue;
      const L = leaderOf(cid);
      if (!L) continue;
      CALLED["threat:" + cid] = day();
      ring({ key: "threat:" + cid + ":" + day(), id: "leader:" + cid, name: L.display, role: countryName(cid), line: "Pull your forces back. This is your last warning.", choices: [
        { id: "backoff", label: "Back off", run: function () { if (CBZ.relations && CBZ.relations.event) CBZ.relations.event(me, cid, "trade", 8); return { ok: true, line: "Wise." }; } },
        { id: "makeme", label: "Make me", run: function () { return threaten(cid); } },
      ] });
      return;
    }
  }
  const RUNG_OFFERS = {};
  function contactOffers() {
    const D = CBZ.cityDialogue;
    if (!D || !D.contacts) return;
    let l = [];
    try { l = D.contacts() || []; } catch (e) { l = []; }
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (!c.pending) continue;
      const k = c.id + ":" + (c.pending.id || c.pending.title || c.pending.place || "");
      if (RUNG_OFFERS[k]) continue;
      RUNG_OFFERS[k] = true;
      const s = metOffer(c);
      ring({ key: "offer:" + k, id: "met:" + c.id, name: c.name, role: c.friend ? "Friend" : "", line: s.line, choices: s.choices });
      return;
    }
  }
  function deskCalls() {
    if (!isPresident()) return;
    const O = CBZ.presidentOffice;
    if (!O || !O.cellCall || RINGING || QUEUE.length || (CONV && CONV.state === "talk")) return;
    let c = null;
    try { c = O.cellCall(); } catch (e) { c = null; }
    if (!c) return;
    ring({ key: "desk:" + c.id, id: "desk:" + c.id, name: c.title || c.name, role: "", line: c.line,
      choices: c.choices.map(function (x) { return { id: x.id, label: x.label, run: function () { return { ok: true, line: c.answer(x.id) }; } }; }),
      onMissed: c.ignore });
  }

  let hookedBus = false, hookedCity = false;
  function hook() {
    const p = Pres();
    if (!hookedBus && p && p.on) {
      hookedBus = true;
      try { p.on("*", function (payload, evt) { try { onBus(String(evt || ""), payload); onBusCalls(String(evt || ""), payload); } catch (e) {} }); } catch (e) {}
    }
    if (!hookedCity && typeof CBZ.onCityEvent === "function") {
      hookedCity = true;
      try { CBZ.onCityEvent(function (type, data) { try { onCity(type, data); } catch (e) {} }); } catch (e) {}
    }
  }

  let slow = 0, threatAcc = 0;
  function tick(dt) {
    dt = Math.min(0.25, Math.max(0, dt || 0));
    CLOCK += dt;
    for (let i = LATER.length - 1; i >= 0; i--) if (CLOCK >= LATER[i].at) { const f = LATER[i].fn; LATER.splice(i, 1); try { f(); } catch (e) {} }
    // the conversation ends a beat after the last word
    if (CONV && CONV.state === "done" && CONV.endAt != null && CLOCK >= CONV.endAt) CONV = null;
    // ringing: one at a time, a gap between, unanswered = missed
    if (RINGING && CLOCK - RINGING.t > RING_SECS) decline();
    // a call queued by someone who has since left his post never rings
    const gone = function (r) { return !!r && STAFF.some(function (s) { return s.id === r.id; }) && !staffPerson(r.id); };
    if (gone(RINGING)) { RINGING = null; lastRingEnd = CLOCK; }
    while (QUEUE.length && gone(QUEUE[0])) QUEUE.shift();
    if (!RINGING && QUEUE.length && !(CONV && CONV.state === "talk") && CLOCK - lastRingEnd > RING_GAP) {
      RINGING = QUEUE.shift(); RINGING.t = CLOCK;
    }
    // the news badge: stories NEWS ONE pushed since the app was last read
    const nc = newsCount();
    if (nc > newsSeen) { UNREAD.news += nc - newsSeen; newsSeen = nc; }
    slow += dt;
    if (slow < 1) return;
    slow = 0;
    hook();
    if (g.mode !== "city") return;
    try { deskCalls(); } catch (e) {}
    try { contactOffers(); } catch (e) {}
    threatAcc += 1;
    if (threatAcc >= 45) { threatAcc = 0; try { leaderThreats(); } catch (e) {} }
  }
  if (CBZ.onAlways) CBZ.onAlways(50.4, tick);

  CBZ.phoneApps = {
    news: news,
    recents: function () { return recents.slice().reverse(); },
    contacts: contacts,
    call: call, choose: choose, hangup: hangup, conv: publicConv,
    ring: ring, ringing: ringing, answer: answer, decline: decline,
    feed: function () { return feed.slice().reverse().map(function (p) { return Object.assign({ age: CLOCK - p.t }, p); }); },
    postOptions: postOptions, post: post,
    unread: function () { return { news: UNREAD.news, calls: UNREAD.calls, social: UNREAD.social, total: UNREAD.news + UNREAD.calls + UNREAD.social + (RINGING ? 1 : 0) }; },
    markRead: function (app) { if (app in UNREAD) UNREAD[app] = 0; },
    isPresident: isPresident,
    audit: function () { return { posts: feed.length, recents: recents.length, notices: notices.length, queue: QUEUE.length, ringing: !!RINGING, conv: CONV ? CONV.id : null, hooked: hookedBus }; },
    // tests
    _tick: tick, _hook: hook, _onBus: onBus,
  };
})();
