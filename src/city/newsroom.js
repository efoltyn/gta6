/* ============================================================
   city/newsroom.js — NEWS ONE. The one news channel, on every TV.

   OWNER: "THE TV SHOWING NEWS SHOULD SHOW REAL NEWS, AND THERE SHOULD BE
   MORE TVS THROUGHOUT THE GAME".

   WHAT IT REPLACED. There were three broadcasts and two of them made things
   up: president_office.js painted its own channel (real stories, but only on
   the one set in the Oval), hitman_room.js painted "Water main break in
   Downtown" / "Heat wave expected this weekend" from a table of invented
   filler, and every apartment, hideout and crash pad in the fit-out had a
   blue glowing box with a red bar under it standing in for a picture.

   NOW: ONE STORE OF STORIES, ONE CANVAS, ONE TEXTURE, ONE MATERIAL. Every
   screen in the game is a plane carrying the same material; the canvas is
   repainted at most twice a second and only while a registered screen is
   near the player (beyond NEAR m nothing is painted at all). One 512x288
   upload, however many sets are on.

   WHERE STORIES COME FROM (every one is something that happened):
     - CBZ.news.push(headline, opts)       any file with a real headline
     - CBZ.news.event(type, data)          a NAMED event; the type is read
       generically (nuke / airstrike / war / declare / tsunami / quake /
       collapse / heist / arrest / escape / assassination ...), so a new
       system only has to name what it did
     - CBZ.onCityEvent (worldstate.js)     the city's event ledger, every type
     - the presidency bus, wildcard "*"    anything president_office.js does
                                           not already report itself
     - phone news (campaign_ui / phone.js) what the City Desk sends the phone
     - CBZ.onOfficialDeath (officials.js)  a mayor, governor, president dies
     - polled state, every 2 s: country wars (CBZ.polwar), gang wars
       (CBZ.cityGangs[].warWith), the wanted level (a chase, a manhunt, a
       suspect who got away), and the death ledger (CBZ.cityRecentDeaths:
       "Airstrike leaves 6 dead").
   When nothing has happened the bulletin reads the world as it is: the
   weather overhead, the real mayor and president by name and approval,
   murders this week, which crew holds the most districts, wars running,
   the market index, the roads round you. Nothing is invented.

   THE ONE TV PROP. tvParts() is the set: a 12 mm bezel, a thicker chin,
   the back housing, and a stand, a wall bracket or a ceiling drop. The
   fit-out (fitout.js B.tv) draws those parts into its merged buckets; tvSet()
   merges them into one mesh for authored rooms (the Oval, the prison
   dayroom). Both put the same shared screen on the front.

   PUBLIC: CBZ.news = { push, event, stories, current, texture, material,
     screen, watch, tvParts, tvSet, paintNow, audit }.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  const THREE = window.THREE;
  if (!CBZ || !THREE) return;
  const g = CBZ.game || (CBZ.game = {});

  // ---------------------------------------------------------------- tuning
  const W = 512, H = 288;
  const NEAR = 30;            // m: a screen this close (and this storey) is painted
  const CLOSE = 9;            // m: this close it is painted twice a second, else once
  const STOREY = 4.5;         // m of height difference that still counts as "this storey"
  const HOLD = 9;             // s a story stays on screen
  const BREAK_HOLD = 22;      // s a breaking story owns the screen
  const RECENT = 600;         // s a story stays in the rotation
  const POLL = 2;             // s between state polls
  const TICKER_PX = 30;       // ticker crawl, px per second

  let CLOCK = 0;

  // ---------------------------------------------------------------- text law
  // Signage law: no em dashes, no middle dots, plain words, short lines.
  function clean(s) {
    return String(s == null ? "" : s)
      .replace(/\s*[·•—–]\s*/g, ", ")
      .replace(/…/g, "...")
      .replace(/\((s|es)\)/g, "s")
      .replace(/[▲▼]/g, "")
      .replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ").trim();
  }
  function cap(s) { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function short(s, n) {
    s = clean(s);
    if (s.length <= n) return s;
    let cut = s.slice(0, n);
    const sp = cut.lastIndexOf(" ");
    if (sp > n * 0.6) cut = cut.slice(0, sp);
    return cut.replace(/[,:;]$/, "");
  }
  function money(n) {
    n = Math.round(+n || 0);
    if (Math.abs(n) >= 1e6) return "$" + (n / 1e6).toFixed(1).replace(/\.0$/, "") + " million";
    return "$" + n.toLocaleString("en-US");
  }
  function titleCase(s) { return String(s || "").toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }); }

  // ---------------------------------------------------------------- world reads
  function hour() { try { return CBZ.citySunHour ? +CBZ.citySunHour() : 12; } catch (e) { return 12; } }
  function day() { try { return CBZ.worldDay ? (CBZ.worldDay() | 0) : 0; } catch (e) { return 0; } }
  function player() { return CBZ.player || null; }
  function polity(id) {
    if (!id || !CBZ.polity || !CBZ.polity.get) return null;
    try { return CBZ.polity.get(id) || null; } catch (e) { return null; }
  }
  function polName(id) {
    if (!id || id === "player" || /^you$/i.test(String(id))) return null;
    if (typeof id === "object") return id.name || polName(id.id);
    const r = polity(id);
    if (r && r.name) return r.name;
    return /^[a-z]+$/.test(id) ? titleCase(id) : String(id);
  }
  function identity(sid) {
    const O = CBZ.officials;
    if (!sid || !O || !O.identityOf) return null;
    try { const i = O.identityOf(sid); return i && i.name && i.name !== "Someone" ? i : null; } catch (e) { return null; }
  }
  function officeRec(sid) {
    const O = CBZ.officials;
    if (!sid || !O || !O.officeOf) return null;
    try { const o = O.officeOf(sid); return o && o.rec ? o.rec : null; } catch (e) { return null; }
  }
  // the mayor's city and the president's country, by the real ledger
  function homeCity() {
    const st = g.officials || {};
    const rec = officeRec(st.mayorSid) || polity("libertyville");
    const who = identity(st.mayorSid);
    return { id: rec ? rec.id : null, name: rec && rec.name ? rec.name : "the city", rec: rec, mayor: who ? who.name : null };
  }
  function nation() {
    const st = g.officials || {};
    const rec = officeRec(st.presidentSid) || polity("republic");
    const who = identity(st.presidentSid);
    return { id: rec ? rec.id : null, name: rec && rec.name ? rec.name : null, rec: rec, president: who ? who.name : null };
  }
  function districtAt(x, z) {
    if (x == null || z == null || !isFinite(x) || !isFinite(z) || !CBZ.cityZoneAt) return null;
    try { const zn = CBZ.cityZoneAt(x, z); return zn && zn.name ? titleCase(zn.name) : null; } catch (e) { return null; }
  }
  function here() {
    const P = player();
    return P && P.pos ? districtAt(P.pos.x, P.pos.z) : null;
  }
  function placeOf(d) {
    d = d || {};
    const s = d.place && d.place.name ? d.place.name : (typeof d.place === "string" ? d.place : null)
      || d.where || d.at || d.district || d.city || d.target && typeof d.target === "string" && polName(d.target) || null;
    if (s) return clean(s);
    const p = d.pos || d.p || null;
    const x = d.x != null ? d.x : (p ? p.x : null), z = d.z != null ? d.z : (p ? p.z : null);
    return districtAt(x, z);
  }
  function inLoc(d, fallback) { const p = placeOf(d); return p ? " in " + p : (fallback || ""); }
  function gangName(id) {
    const L = CBZ.cityGangs || [];
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === id) return L[i].name || null;
    return null;
  }
  function the(name) { return /^(the |los |la |el )/i.test(name) ? name : "the " + name; }
  function presStatus() {
    const p = CBZ.presidency;
    if (!p || typeof p.status !== "function") return null;
    try { return p.status() || null; } catch (e) { return null; }
  }

  /* ========================================================================
     1. THE STORIES
     ======================================================================== */
  const N = {
    stories: [], cur: null, curAt: -1e9, breakingUntil: 0, keys: Object.create(null),
    amb: [], ambAt: -1e9, ambI: 0, rot: 0, lastPhone: -1e9,
    paintAt: -1e9, dirty: true, nearest: 1e9, painted: 0, pushed: 0, events: 0,
  };
  function seenKey(key, secs) {
    if (!key) return false;
    const t = N.keys[key];
    return t != null && CLOCK - t < secs;
  }
  function push(headline, opts) {
    opts = opts || {};
    const h = short(headline, 64);
    if (!h || h.length < 4) return false;
    if (opts.key && seenKey(opts.key, opts.hold != null ? opts.hold : 60)) return false;
    const up = h.toUpperCase();
    for (let i = N.stories.length - 1; i >= 0 && i >= N.stories.length - 8; i--) {
      if (N.stories[i].h.toUpperCase() === up && CLOCK - N.stories[i].t < 45) return false;
    }
    if (opts.key) N.keys[opts.key] = CLOCK;
    const s = {
      h: h, sub: short(opts.sub || "", 80), cat: clean(opts.cat || "").toUpperCase().slice(0, 12),
      kind: opts.kind === "breaking" ? "breaking" : "story", look: opts.look || null, t: CLOCK, day: day(),
    };
    N.stories.push(s);
    if (N.stories.length > 16) N.stories.shift();
    N.pushed++;
    if (s.kind === "breaking") {
      N.cur = s; N.curAt = CLOCK; N.breakingUntil = CLOCK + BREAK_HOLD;
      if (opts.phone && CLOCK - N.lastPhone > 60 && CBZ.phoneNotify) {
        N.lastPhone = CLOCK;
        try { CBZ.phoneNotify({ app: "news", from: "News One", text: h, priority: 1, tv: false }); } catch (e) {}
      }
    } else if (CLOCK >= N.breakingUntil) { N.cur = s; N.curAt = CLOCK; }
    N.dirty = true;
    return true;
  }

  // the rotation: what happened recently, with the state of the world
  // between stories (and alone, when nothing has happened)
  function rotate() {
    if (CLOCK < N.breakingUntil) return;
    if (N.cur && CLOCK - N.curAt < HOLD) return;
    const recent = [];
    for (let i = N.stories.length - 1; i >= 0 && recent.length < 6; i--) {
      if (CLOCK - N.stories[i].t < RECENT) recent.push(N.stories[i]);
    }
    N.rot++;
    let next = null;
    if (recent.length && (N.rot % 3) !== 0) {
      const i = N.cur ? recent.indexOf(N.cur) : -1;
      next = recent[(i + 1) % recent.length];
      if (next.kind === "breaking") next = Object.assign({}, next, { kind: "story" });
    } else {
      const A = ambientList();
      if (A.length) { N.ambI = (N.ambI + 1) % A.length; next = A[N.ambI]; }
      else if (recent.length) next = recent[0];
    }
    N.cur = next || fallback();
    N.curAt = CLOCK;
    N.dirty = true;
  }
  function fallback() {
    const hr = hour(), hh = Math.floor(hr);
    const part = hh < 5 ? "Overnight" : hh < 12 ? "Morning" : hh < 17 ? "Afternoon" : hh < 21 ? "Evening" : "Late";
    return { h: part + " news", sub: "", cat: "", kind: "story", ambient: true };
  }

  /* ---- the world as it is: never invented ------------------------------- */
  function ambientList() {
    if (CLOCK - N.ambAt < 20 && N.amb.length) return N.amb;
    N.ambAt = CLOCK;
    const out = [];
    const C = homeCity(), Na = nation();
    const hr = hour();
    const when = hr < 5 || hr >= 21 ? "tonight" : hr < 12 ? "this morning" : hr < 17 ? "this afternoon" : "this evening";
    const add = function (h, sub, cat, look) { if (h) out.push({ h: short(h, 64), sub: short(sub || "", 80), cat: cat, kind: "story", look: look || cat, ambient: true }); };

    // the weather overhead
    const Wt = CBZ.weather;
    if (Wt) {
      let h, sub = "";
      const rain = !!Wt.raining, snow = (Wt.snow || 0) > 0.4, over = Wt.overcast || 0, inten = Wt.intensity || 0;
      if (rain && snow) h = "Snow over " + C.name + " " + when;
      else if (rain && inten > 0.6) h = "Heavy rain over " + C.name + " " + when;
      else if (rain) h = "Rain over " + C.name + " " + when;
      else if (over > 0.6) h = "Grey skies over " + C.name + " " + when;
      else h = "Clear skies over " + C.name + " " + when;
      if ((Wt.wind || 0) > 0.6) sub = "Strong wind across the city";
      else if ((Wt.groundWater || 0) > 0.4) sub = "Standing water on the roads";
      else if ((Wt.snowCover || 0) > 0.4) sub = "Snow lying on the streets";
      add(h, sub, "WEATHER", "weather");
    }
    // the people in charge, by name, with the number they are judged on
    if (C.mayor) {
      const ap = C.rec && isFinite(C.rec.approval) ? Math.round(C.rec.approval) : null;
      add(ap != null ? "Mayor " + C.mayor + " at " + ap + "% approval" : C.mayor + " is Mayor of " + C.name, C.name + " City Hall", "CITY HALL", "politics");
    } else if (C.rec && C.rec.vacuum != null) add(C.name + " has no mayor", "The office is vacant", "CITY HALL", "politics");
    const ps = presStatus();
    if (ps && ps.seat) {
      add("President's approval at " + Math.round(ps.approval || 0) + "%", "Treasury at " + money(ps.treasury), "NATION", "poll");
    } else if (Na.president) {
      const ap = Na.rec && isFinite(Na.rec.approval) ? Math.round(Na.rec.approval) : null;
      add(ap != null ? "President " + Na.president + " at " + ap + "%" : Na.president + " leads " + (Na.name || "the country"), Na.name || "", "NATION", "politics");
    }
    // crime this week, from approval.js's own murder ring
    const AS = CBZ.approvalState;
    if (AS && AS.murders7d && C.id) {
      let m = 0; try { m = AS.murders7d(C.id) | 0; } catch (e) { m = 0; }
      if (m > 0) add(m === 1 ? "One murder in " + C.name + " this week" : m + " murders in " + C.name + " this week", "", "CRIME", "police");
    }
    // the streets: who holds the most districts, and who is fighting whom
    if (CBZ.cityTakeoverLeader) {
      let L = null; try { L = CBZ.cityTakeoverLeader(); } catch (e) { L = null; }
      if (L && L.name && L.zones > 0) add(cap(the(L.name)) + " hold " + L.zones + " of " + L.total + " districts", "", "STREETS", "turf");
    }
    const gw = gangWars();
    if (gw.length) add(cap(the(gw[0][0])) + " at war with " + the(gw[0][1]), gw.length > 1 ? (gw.length - 1) + " more gang wars running" : "", "STREETS", "turf");
    // wars between countries
    const wars = liveWars();
    for (let i = 0; i < wars.length && i < 2; i++) {
      const w = wars[i];
      const d = Math.max(1, day() - (w.startedDay | 0) + 1);
      add(polName(w.sides[0]) + " and " + polName(w.sides[1]) + " at war", "Day " + d + " of the fighting", "WAR", "war");
    }
    // the market
    const iq = indexQuote();
    if (iq) add("LBX index at " + iq.value.toFixed(1), iq.trend === "up" ? "Stocks rising" : iq.trend === "down" ? "Stocks falling" : "Stocks flat", "MARKETS", "market");
    // the roads round you
    const tr = traffic();
    if (tr) add(tr, "", "TRAFFIC", "traffic");
    if ((g.wanted | 0) > 0) { const d = here(); add("Police search " + (d || C.name) + " for a suspect", "", "CRIME", "police"); }
    N.amb = out;
    if (N.ambI >= out.length) N.ambI = 0;
    return out;
  }
  function gangWars() {
    const L = CBZ.cityGangs || [], out = [], seen = {};
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a || !a.warWith || a.absorbed) continue;
      const k = a.id < a.warWith ? a.id + "|" + a.warWith : a.warWith + "|" + a.id;
      if (seen[k]) continue;
      seen[k] = 1;
      const bn = gangName(a.warWith);
      if (a.name && bn) out.push([a.name, bn, k]);
    }
    return out;
  }
  function liveWars() {
    const PW = CBZ.polwar;
    if (!PW || !PW.allWars) return [];
    try { return PW.allWars() || []; } catch (e) { return []; }
  }
  function indexQuote() {
    const S = CBZ.stocks;
    if (!S || !S.indexQuote) return null;
    try { const q = S.indexQuote(); return q && isFinite(q.value) ? q : null; } catch (e) { return null; }
  }
  function traffic() {
    const P = player(), cars = CBZ.cityCars;
    if (!P || !P.pos || !cars || !cars.length || g.mode !== "city") return null;
    let moving = 0, all = 0;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (!c || c.dead || !c.group) continue;
      const p = c.group.position;
      if (Math.abs(p.x - P.pos.x) > 160 || Math.abs(p.z - P.pos.z) > 160) continue;
      all++;
      if (Math.abs(c.v || 0) > 2) moving++;
    }
    if (!all) return null;
    const d = here() || homeCity().name;
    if (moving >= 24) return "Heavy traffic in " + d;
    if (moving >= 8) return "Traffic moving in " + d;
    if (all - moving > moving * 2 && all > 10) return "Traffic at a standstill in " + d;
    return "Quiet roads in " + d;
  }

  /* ========================================================================
     2. NAMED EVENTS. A type is read by what it says, so a new system only
        has to name the thing it did.
     ======================================================================== */
  const IGNORE = /^(bullet-impact|bet|casino|transport|transport-delay|activity-payout|race-finish|hitman-contract|fight-result|motorcade|attack-armed)$/;
  const AGG = Object.create(null);         // per-kind counters for noisy events
  function aggregate(kind, d, secs, make) {
    let a = AGG[kind];
    if (!a || CLOCK - a.t0 > secs) {
      a = AGG[kind] = { t0: CLOCK, n: 0, place: null, reported: false };
    }
    a.n++;
    const p = placeOf(d);
    if (p) a.place = p;
    if (!a.reported) { a.reported = true; make(a, true); return; }
    // the count grew: the same story, updated, at most every 8 s
    if (a.n === 3 || a.n === 6 || a.n === 12) make(a, false);
  }
  function sidesOf(d) {
    let a = d.a || d.attacker || d.aggressor || d.from || d.side || null;
    let b = d.b || d.target || d.enemy || d.to || d.vs || d.against || null;
    if ((!a || !b) && Array.isArray(d.sides) && d.sides.length >= 2) { a = d.sides[0]; b = d.sides[1]; }
    return { a: a, b: b, an: a ? polName(a) || gangName(a) : null, bn: b ? polName(b) || gangName(b) : null };
  }
  function event(type, data) {
    const t = String(type || "").toLowerCase().replace(/[_\s:]+/g, "-");
    const d = data || {};
    if (!t || IGNORE.test(t)) return false;
    N.events++;
    const loc = inLoc(d);
    // ---- the biggest things first
    if (/nuke|nuclear|warhead/.test(t) || d.ordnance === "nuke" || d.nuke) {
      const s = sidesOf(d);
      const h = s.an && s.bn ? s.an + " fires a nuclear weapon at " + s.bn : "Nuclear blast" + (loc || " over " + homeCity().name);
      return push(h, { kind: "breaking", cat: "WAR", look: "nuke", key: "nuke:" + (placeOf(d) || ""), hold: 120, sub: "Radiation warning for the area", phone: false });
    }
    if (/cease-?fire|armistice|peace|war-?end|surrender/.test(t)) {
      const s = sidesOf(d);
      if (d.winner || d.loser) return push(polName(d.winner) + " wins the war with " + polName(d.loser), { kind: "breaking", cat: "WAR", look: "war", key: "warend:" + (d.id || d.winner + d.loser), hold: 600 });
      return push(s.an && s.bn ? s.an + " and " + s.bn + " stop fighting" : "Ceasefire declared", { kind: "breaking", cat: "WAR", look: "war", key: "peace:" + (s.an || "") + (s.bn || ""), hold: 300 });
    }
    if (/air-?strike|air-?raid|bomb|missile|sortie/.test(t) || d.airstrike) {
      return aggregate("airstrike", d, 40, function (a, first) {
        const where = a.place ? " on " + a.place : "";
        const h = first ? (/missile/.test(t) ? "Missile strike" + where : "Airstrike" + where) : a.n + " airstrikes" + where;
        const s = sidesOf(d);
        push(h, { kind: first ? "breaking" : "story", cat: "WAR", look: "strike", sub: s.an ? "Ordered by " + s.an : "", key: "air:" + a.t0 + ":" + a.n, hold: 5 });
      });
    }
    if (/declare|war/.test(t)) {
      const s = sidesOf(d);
      if (s.an && s.bn) return push(s.an + " declares war on " + s.bn, { kind: "breaking", cat: "WAR", look: "war", key: "war:" + [s.an, s.bn].sort().join("|"), hold: 900 });
      if (d.label || d.headline) return push(d.headline || d.label, { kind: "story", cat: "WAR", look: "war" });
      return push("Fighting" + (loc || " in " + homeCity().name), { cat: "WAR", look: "strike", key: "fight:" + loc, hold: 60 });
    }
    if (/tsunami/.test(t)) {
      const pk = +d.peak;
      return push("Tsunami hits the coast", { kind: "breaking", cat: "DISASTER", look: "tsunami", sub: pk > 0 ? "Waves up to " + Math.max(1, Math.round(pk)) + " metres" : "Move to high ground", key: "tsunami", hold: 120 });
    }
    if (/quake/.test(t)) {
      return push("Earthquake shakes " + (placeOf(d) || homeCity().name), { kind: "breaking", cat: "DISASTER", look: "quake", sub: d.magnitude > 0 ? "Magnitude " + (+d.magnitude).toFixed(1) : "", key: "quake", hold: 90 });
    }
    if (/volcan|erupt/.test(t)) return push("Volcano erupts", { kind: "breaking", cat: "DISASTER", look: "fire", sub: placeOf(d) || "", key: "volcano", hold: 120 });
    if (/tornado/.test(t)) return push("Tornado touches down" + loc, { kind: "breaking", cat: "DISASTER", look: "weather", key: "tornado", hold: 90 });
    if (/wildfire|fire/.test(t)) return push("Fire" + (loc || " in " + homeCity().name), { cat: "DISASTER", look: "fire", key: "fire:" + loc, hold: 60 });
    if (/collapse/.test(t) || d.collapse) {
      return aggregate("collapse", d, 60, function (a, first) {
        const where = a.place ? " in " + a.place : "";
        push(first ? "Building collapses" + where : a.n + " buildings down" + where, { kind: "breaking", cat: "DISASTER", look: "collapse", sub: d.storeys ? d.storeys + " storeys came down" : "", key: "col:" + a.t0 + ":" + a.n, hold: 5 });
      });
    }
    if (/explosion|blast/.test(t)) {
      return aggregate("explosion", d, 45, function (a, first) {
        const where = a.place ? " in " + a.place : "";
        push(first ? "Explosion" + where : a.n + " explosions" + where, { cat: "CITY", look: "fire", key: "exp:" + a.t0 + ":" + a.n, hold: 5 });
      });
    }
    if (/disaster/.test(t)) {
      const lb = clean(d.label || "");
      if (/air raid|bomb|strike/i.test(lb)) return event("airstrike", d);
      if (lb && lb.length < 40 && !/deploy|logged|response/i.test(lb)) return push(lb + loc, { cat: "DISASTER", look: "fire" });
      return false;
    }
    // ---- people
    if (/assassinat/.test(t)) {
      const lb = clean(d.label || "");
      if (lb && /assassinated|dead/i.test(lb)) return push(lb, { kind: "breaking", cat: "NATION", look: "politics", key: "dead:" + lb.toLowerCase(), hold: 300 });
      if (lb && lb !== "Contract completed") return push(lb + " is dead", { kind: "breaking", cat: "NATION", look: "politics", key: "dead:" + lb.toLowerCase(), hold: 300 });
      return push("Assassination" + (loc || " in " + homeCity().name), { kind: "breaking", cat: "CRIME", look: "police", key: "assn", hold: 60 });
    }
    if (/hitman-complete|contract-kill/.test(t)) return push("Police suspect a contract killing" + loc, { cat: "CRIME", look: "police", key: "hit", hold: 120 });
    if (/heist/.test(t)) {
      const NAMES = { store: "Corner store held up", liquor: "Pawn shop smash and grab", jewelry: "Jewelry store robbed", armored: "Armored truck cracked open", bank: "Bank robbed" };
      const h = NAMES[d.tier] || "Armed robbery";
      return push(h + loc, { kind: d.tier === "bank" || d.tier === "armored" ? "breaking" : "story", cat: "CRIME", look: "police", sub: d.take > 0 ? "Thieves escape with " + money(d.take) : "", key: "heist:" + d.tier, hold: 60 });
    }
    if (/jail-escape|escape|breakout/.test(t)) return push("Inmate breaks out of jail", { kind: "breaking", cat: "CRIME", look: "police", sub: "Police are searching the area", key: "escape", hold: 120 });
    if (/^arrest$/.test(t)) SEEN.arrestAt = CLOCK;
    if (/^arrest$/.test(t) && !d.title) return push("Suspect arrested" + (here() ? " in " + here() : ""), { cat: "CRIME", look: "police", key: "arrest", hold: 60 });
    if (/crime-reported|^crime$/.test(t)) {
      const lb = clean(d.crime || d.label || "");
      if (!lb || /trespass|loiter|jaywalk|noise|speeding/i.test(lb)) return false;
      return aggregate("crime:" + lb.toLowerCase(), d, 90, function (a, first) {
        if (!first) return;
        push(cap(lb.toLowerCase()) + " reported" + (a.place ? " in " + a.place : ""), { cat: "CRIME", look: "police", key: "crime:" + lb + a.t0, hold: 5 });
      });
    }
    if (/terror-threat/.test(t)) return push("Terror alert raised in " + homeCity().name, { cat: "SECURITY", look: "police", key: "terror", hold: 180 });
    if (/counterterror/.test(t)) return push("Police move on a terror cell", { cat: "SECURITY", look: "police", key: "ct", hold: 120 });
    if (/emergency/.test(t)) return push("State of emergency declared", { kind: "breaking", cat: "NATION", look: "politics", key: "emerg", hold: 300 });
    if (/^story$/.test(t) && d.label && /took the city/i.test(d.label)) return push("One crew now runs " + homeCity().name, { kind: "breaking", cat: "STREETS", look: "turf", key: "takeover", hold: 600 });
    if (/race-title/.test(t)) return push(clean(d.title || "Racing title") + " decided", { cat: "SPORT", look: "sport", key: "race:" + d.title, hold: 300 });
    if (/crash/.test(t)) {
      if (!(d.damage >= 6)) return false;
      return push("Serious crash" + loc, { cat: "TRAFFIC", look: "traffic", key: "crash", hold: 90 });
    }
    // ---- anything else that carries its own words
    const own = d.headline || d.title || d.label || null;
    if (own && typeof own === "string" && own.length > 6 && !/logged|contract|accepted|completed|\+\$/i.test(own)) {
      return push(own, { kind: d.breaking ? "breaking" : "story", cat: d.cat || "", key: "ev:" + t + ":" + own, hold: 60 });
    }
    return false;
  }

  /* phone news (the City Desk) -> a headline: the first sentence, the rest
     as the strap under it */
  function wire(text, from) {
    const s = clean(text);
    if (!s || s.length < 8) return false;
    if (/ was reported dead\. Cause:/i.test(s)) return false;     // the kill feed: counted by the death ledger instead
    const m = s.match(/^(.+?[.!?])\s+(.+)$/);
    let h = m ? m[1] : s, sub = m ? m[2] : "";
    h = h.replace(/[.]$/, "");
    if (h.length > 44 && h.indexOf(":") > 8) { sub = h.slice(h.indexOf(":") + 1).trim(); h = h.slice(0, h.indexOf(":")); }
    if (h.length > 54 && h.indexOf(",") > 8) { sub = h.slice(h.indexOf(",") + 1).trim(); h = h.slice(0, h.indexOf(",")); }
    const lc = s.toLowerCase();
    const look = /war|strike|bomb|army|troops|soldier/.test(lc) ? "war" : /police|arrest|raid|murder|shot|robbed|cell/.test(lc) ? "police"
      : /falls to|district|turf|crew|gang/.test(lc) ? "turf" : /president|mayor|election|vote|senate|court/.test(lc) ? "politics" : null;
    return push(h, { sub: sub, cat: look === "war" ? "WAR" : look === "police" ? "CRIME" : look === "turf" ? "STREETS" : look === "politics" ? "POLITICS" : "", look: look });
  }

  /* ========================================================================
     3. POLLED STATE: the things that change without anybody announcing it
     ======================================================================== */
  const SEEN = { wars: Object.create(null), gangWars: Object.create(null), wanted: 0, wantedPeak: 0, arrestAt: -1e9, deathT: 0, hooked: {} };
  function hook() {
    const H = SEEN.hooked;
    if (!H.city && typeof CBZ.onCityEvent === "function") {
      H.city = true;
      CBZ.onCityEvent(function (type, data) { try { event(type, data); } catch (e) {} });
    }
    if (!H.officials && typeof CBZ.onOfficialDeath === "function") {
      H.officials = true;
      CBZ.onOfficialDeath(function (rec, sid) {
        const who = identity(sid);
        const O = CBZ.officials;
        let title = "Official";
        try { title = O && O.titleFor ? O.titleFor(rec) : title; } catch (e) {}
        if (!who) return;
        push(title + " " + who.name + " is dead", { kind: "breaking", cat: "NATION", look: "politics", sub: rec && rec.name ? rec.name + " in mourning" : "", key: "dead:" + who.name.toLowerCase(), hold: 300 });
      });
    }
    const p = CBZ.presidency;
    if (!H.pres && p && typeof p.on === "function") {
      H.pres = true;
      // president_office.js reports its own moments in its own words; the
      // rest of the bus (new orders: airstrikes, wars, nukes) is read here
      const OFFICE = /^(sworn|order|decision|attack|attack-armed|raid|impeach|campaign|reelected|defeated|arrest|speech|protest|security|assassinated|lockdown|succession|cabinet-death|appearance|motorcade)$/;
      try { p.on("*", function (payload, evt) { if (!OFFICE.test(String(evt || ""))) event(evt, payload); }); } catch (e) {}
    }
  }
  function poll() {
    hook();
    // ---- wars between countries
    const wars = liveWars();
    const PW = CBZ.polwar;
    let all = wars;
    if (PW && PW.allWars) { try { all = PW.allWars({ all: true }) || wars; } catch (e) {} }
    for (let i = 0; i < all.length; i++) {
      const w = all[i];
      if (!w || !w.id || !w.sides) continue;
      const st = SEEN.wars[w.id];
      if (!st) {
        SEEN.wars[w.id] = { ended: !!w.ended };
        // a war already over or already old when we first look is history, not news
        if (!w.ended && day() - (w.startedDay | 0) <= 1) {
          const a = polName(w.aggressor || w.sides[0]), b = polName(w.aggressor === w.sides[1] ? w.sides[0] : w.sides[1]);
          push(a + " declares war on " + b, { kind: "breaking", cat: "WAR", look: "war", key: "war:" + [a, b].sort().join("|"), hold: 900 });
        }
      } else if (!st.ended && w.ended) {
        st.ended = true;
        if (w.winner && w.loser) push(polName(w.winner) + " wins the war with " + polName(w.loser), { kind: "breaking", cat: "WAR", look: "war", key: "warend:" + w.id, hold: 900 });
        else push("The war between " + polName(w.sides[0]) + " and " + polName(w.sides[1]) + " is over", { kind: "breaking", cat: "WAR", look: "war", key: "warend:" + w.id, hold: 900 });
      }
    }
    // ---- gang wars
    const gw = gangWars(), now = Object.create(null);
    for (let i = 0; i < gw.length; i++) {
      now[gw[i][2]] = 1;
      if (!SEEN.gangWars[gw[i][2]] && SEEN.gangPolled) push(cap(the(gw[i][0])) + " go to war with " + the(gw[i][1]), { cat: "STREETS", look: "turf", key: "gw:" + gw[i][2], hold: 300 });
    }
    SEEN.gangWars = now; SEEN.gangPolled = true;
    // ---- the wanted level: a chase, a manhunt, a suspect who got away
    const wv = g.mode === "city" ? (g.wanted | 0) : 0;
    if (wv !== SEEN.wanted) {
      const d = here(), where = d ? " in " + d : "";
      if (wv > SEEN.wanted) {
        if (wv >= 5) push("Army joins the manhunt" + where, { kind: "breaking", cat: "CRIME", look: "police", key: "w5", hold: 120 });
        else if (wv >= 4) push("Manhunt" + where, { kind: "breaking", cat: "CRIME", look: "police", sub: "Police helicopters overhead", key: "w4", hold: 120 });
        else if (wv >= 2 && SEEN.wanted < 2) push("Police chase" + where, { cat: "CRIME", look: "police", key: "w2", hold: 90 });
        SEEN.wantedPeak = Math.max(SEEN.wantedPeak, wv);
      } else if (wv === 0) {
        const P = player();
        if (SEEN.wantedPeak >= 2 && CLOCK - (SEEN.arrestAt || -1e9) > 8 && !(P && P.dead) && !g.dead) {
          push("Suspect gets away from police" + where, { cat: "CRIME", look: "police", key: "w0", hold: 120 });
        }
        SEEN.wantedPeak = 0;
      }
      SEEN.wanted = wv;
    }
    // ---- the death ledger: how many, and what of
    const D = CBZ.cityRecentDeaths;
    if (!SEEN.deathInit) {                     // history before we looked is not news
      SEEN.deathInit = true;
      SEEN.deathT = CBZ.now || 0;
      if (D) for (let i = 0; i < D.length; i++) if (D[i] && D[i].t > SEEN.deathT) SEEN.deathT = D[i].t;
    } else if (D && D.length) {
      const by = Object.create(null);
      let newest = SEEN.deathT;
      for (let i = 0; i < D.length; i++) {
        const e = D[i];
        if (!e || e.you || !(e.t > SEEN.deathT)) continue;
        if (e.t > newest) newest = e.t;
        const c = e.cause || "unknown";
        (by[c] = by[c] || []).push(e);
      }
      for (const c in by) deathStory(c, by[c]);
      SEEN.deathT = newest;
    }
  }
  const DEATHS = Object.create(null);
  function deathStory(cause, list) {
    let a = DEATHS[cause];
    if (!a || CLOCK - a.t0 > 60) a = DEATHS[cause] = { t0: CLOCK, n: 0, byYou: 0, said: 0 };
    a.n += list.length;
    for (let i = 0; i < list.length; i++) if (list[i].by === "You") a.byYou++;
    if (a.n < 2 || a.n < a.said * 2) return;
    a.said = a.n;
    // where: the strike's own district when it is fresh, else round you
    const ag = AGG[cause === "airstrike" ? "airstrike" : cause === "explosion" ? "explosion" : ""];
    const d = (ag && CLOCK - ag.t0 < 90 && ag.place) || here(), where = d ? " in " + d : "";
    const n = a.n;
    let h;
    if (cause === "murder" || (cause === "gunfire" && a.byYou >= n / 2)) h = "Shooting spree" + where + ", " + n + " dead";
    else if (cause === "gunfire") h = "Gunfight" + where + " leaves " + n + " dead";
    else if (cause === "airstrike") h = "Airstrike" + where + " kills " + n;
    else if (cause === "nuclear blast") h = "Nuclear blast kills " + n;
    else if (cause === "explosion") h = "Blast" + where + " kills " + n;
    else if (cause === "terrorist attack") h = "Terror attack" + where + ", " + n + " dead";
    else if (cause === "plane crash") h = "Plane crash" + where + ", " + n + " dead";
    else if (cause === "beaten") h = n + " beaten to death" + where;
    else if (cause === "car crash") h = n + " killed on the roads" + where;
    else if (cause === "police") h = "Police kill " + n + where;
    else if (cause === "fire") h = n + " dead in a fire" + where;
    else h = n + " dead" + where;
    const war = /air|nuclear|terror/.test(cause);
    push(h, { kind: n >= 5 ? "breaking" : "story", cat: cause === "car crash" ? "TRAFFIC" : war ? (cause === "terrorist attack" ? "SECURITY" : "WAR") : "CRIME", look: /air|nuclear|explosion|terror|plane/.test(cause) ? "strike" : "police", key: "deaths:" + cause + ":" + a.t0 + ":" + n, hold: 5 });
  }

  /* ========================================================================
     4. THE CANVAS, THE TEXTURE, THE MATERIAL (one of each, for every screen)
     ======================================================================== */
  let CV = null, CTX = null, TEX = null, MAT = null, PLANE = null;
  function ensureCanvas() {
    if (CV) return true;
    if (typeof document === "undefined") return false;
    CV = document.createElement("canvas"); CV.width = W; CV.height = H;
    CTX = CV.getContext("2d");
    TEX = new THREE.CanvasTexture(CV);
    if (THREE.sRGBEncoding != null) TEX.encoding = THREE.sRGBEncoding;     // match core/renderer.js
    TEX.anisotropy = 4;
    TEX.generateMipmaps = true;
    MAT = new THREE.MeshBasicMaterial({ map: TEX, color: 0xe2e2e2 });
    MAT.toneMapped = false;
    MAT._shared = true;
    PLANE = new THREE.PlaneGeometry(1, 1);
    PLANE._shared = true;
    try { paint(); } catch (e) {}
    return true;
  }
  function texture() { ensureCanvas(); return TEX; }
  function material() { ensureCanvas(); return MAT; }

  /* ---- the screens: weak registry, pruned when a screen leaves the scene -- */
  const SCREENS = [];
  function watch(obj) {
    if (!obj) return obj;
    if (SCREENS.indexOf(obj) < 0) SCREENS.push(obj);
    N.dirty = true;
    return obj;
  }
  // one screen: a plane w x h facing +z, carrying the shared picture
  function screen(w, h) {
    if (!ensureCanvas()) return null;
    const m = new THREE.Mesh(PLANE, MAT);
    m.scale.set(w, h, 1);
    m.castShadow = false; m.receiveShadow = false;
    m.userData.newsScreen = true;
    m.userData.transient = true;
    return watch(m);
  }
  function attached(o) {
    let p = o;
    for (let i = 0; i < 64 && p; i++) { if (p.isScene) return true; p = p.parent; }
    return false;
  }
  const _v = new THREE.Vector3();
  function nearestScreen() {
    const P = player();
    if (!P || !P.pos) return 1e9;
    let best = 1e9;
    for (let i = SCREENS.length - 1; i >= 0; i--) {
      const o = SCREENS[i];
      if (!o || !attached(o)) { SCREENS.splice(i, 1); continue; }
      if (o.visible === false) continue;
      o.getWorldPosition(_v);
      if (Math.abs(_v.y - P.pos.y) > STOREY + 1.5) continue;
      const d = Math.hypot(_v.x - P.pos.x, _v.z - P.pos.z);
      if (d < best) best = d;
    }
    return best;
  }

  /* ---- the painter ------------------------------------------------------- */
  function paint() {
    if (!CTX) return;
    const c = CTX, t = CLOCK;
    const s = N.cur || fallback();
    const look = s.look || lookOf(s.cat);
    // the studio: deep blue set, lit panels and a skyline strip
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0b1d3d"); bg.addColorStop(1, "#06101f");
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(90,140,220,.14)";
    for (let i = 0; i < 9; i++) c.fillRect(20 + i * 56, 26, 34, 150);
    c.fillStyle = "rgba(255,255,255,.05)";
    c.beginPath(); c.arc(150, 100, 86, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(160,200,255,.12)"; c.lineWidth = 1;
    for (let i = -3; i <= 3; i++) { c.beginPath(); c.ellipse(150, 100, 86, Math.abs(i) * 14 + 4, 0, 0, Math.PI * 2); c.stroke(); }
    c.fillStyle = "#0f2446";
    for (let i = 0; i < 16; i++) { const bh = 20 + ((i * 37) % 50); c.fillRect(i * 32, 176 - bh, 28, bh); }
    drawAnchor(c, 150, t);
    // the desk
    const dk = c.createLinearGradient(0, 178, 0, 240);
    dk.addColorStop(0, "#1a2f55"); dk.addColorStop(1, "#0a1428");
    c.fillStyle = dk; c.fillRect(40, 182, 230, 58);
    c.fillStyle = "#c0392b"; c.fillRect(40, 182, 230, 4);
    // over the shoulder: the footage, the poll, or the map
    drawFootage(c, s, look, t);
    // channel bug + LIVE + clock
    c.textBaseline = "middle"; c.textAlign = "left";
    c.fillStyle = "#c0392b"; c.fillRect(12, 10, 86, 24);
    c.fillStyle = "#fff"; c.font = "bold 15px Arial, sans-serif";
    c.fillText("NEWS ONE", 18, 23);
    c.fillStyle = "rgba(0,0,0,.55)"; c.fillRect(100, 10, 40, 24);
    c.fillStyle = (Math.floor(t * 2) % 2) ? "#ff4d3d" : "#b8332a"; c.beginPath(); c.arc(110, 22, 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff"; c.font = "bold 12px Arial, sans-serif"; c.fillText("LIVE", 117, 23);
    const hr = hour(), hh = Math.floor(hr), mm = Math.floor((hr - hh) * 60);
    c.fillStyle = "rgba(0,0,0,.55)"; c.fillRect(W - 70, 10, 58, 24);
    c.fillStyle = "#fff"; c.font = "bold 15px Arial, sans-serif"; c.textAlign = "center";
    c.fillText((hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm, W - 41, 23);
    // the lower third
    const brk = s.kind === "breaking" && t < N.breakingUntil;
    c.textAlign = "left";
    if (brk) {
      c.fillStyle = (Math.floor(t * 2) % 2) ? "#e0301e" : "#c0271a";
      c.fillRect(0, 200, 112, 26);
      c.fillStyle = "#fff"; c.font = "bold 15px Arial, sans-serif"; c.fillText("BREAKING", 12, 214);
    } else if (s.cat) {
      c.fillStyle = "#1d4f9c"; c.fillRect(0, 200, 112, 26);
      c.fillStyle = "#fff"; c.font = "bold 13px Arial, sans-serif"; c.fillText(s.cat.slice(0, 12), 12, 214);
    }
    c.fillStyle = "rgba(245,245,245,.96)"; c.fillRect(0, 226, W, 32);
    c.fillStyle = "#101010";
    fitText(c, s.h.toUpperCase(), 12, 243, W - 24, 19);
    if (s.sub) {
      c.fillStyle = "rgba(10,20,40,.82)"; c.fillRect(112, 200, W - 112, 26);
      c.fillStyle = "#dfe7f2"; c.font = "13px Arial, sans-serif";
      fitText(c, s.sub, 120, 214, W - 128, 13, true);
    }
    // the ticker
    c.fillStyle = "#0a0f19"; c.fillRect(0, 258, W, 30);
    c.fillStyle = "#f4c542"; c.fillRect(0, 258, 58, 30);
    c.fillStyle = "#0a0f19"; c.font = "bold 12px Arial, sans-serif"; c.fillText("LATEST", 8, 274);
    const txt = tickerItems().join("     ");
    c.save(); c.beginPath(); c.rect(60, 258, W - 60, 30); c.clip();
    c.fillStyle = "#e9eef5"; c.font = "14px Arial, sans-serif";
    const tw = Math.max(200, c.measureText(txt + "     ").width);
    const off = (t * TICKER_PX) % tw;
    c.fillText(txt, 66 - off, 274);
    c.fillText(txt, 66 - off + tw, 274);
    c.restore();
    // the glass: faint scanlines
    c.fillStyle = "rgba(0,0,0,.07)";
    for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
    N.painted++;
  }
  function lookOf(cat) {
    cat = String(cat || "");
    if (/WAR|SECURITY/.test(cat)) return "war";
    if (/CRIME/.test(cat)) return "police";
    if (/DISASTER/.test(cat)) return "fire";
    if (/WEATHER/.test(cat)) return "weather";
    if (/STREET/.test(cat)) return "turf";
    if (/MARKET|ECONOMY/.test(cat)) return "market";
    if (/TRAFFIC/.test(cat)) return "traffic";
    return "politics";
  }
  function fitText(c, s, x, y, maxW, size, light) {
    let sz = size;
    const f = function () { c.font = (light ? "" : "bold ") + sz + "px Arial, sans-serif"; };
    f();
    while (c.measureText(s).width > maxW && sz > 11) { sz--; f(); }
    if (c.measureText(s).width > maxW) { while (s.length > 4 && c.measureText(s + "...").width > maxW) s = s.slice(0, -1); s += "..."; }
    c.fillText(s, x, y);
  }
  function wrap(c, s, x, y, maxW, lh, maxLines) {
    const words = String(s).split(/\s+/);
    let line = "", n = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + " " + words[i] : words[i];
      if (c.measureText(test).width > maxW && line) {
        c.fillText(line, x, y); y += lh; n++;
        if (n >= maxLines) return y;
        line = words[i];
      } else line = test;
    }
    if (line) { c.fillText(line, x, y); y += lh; }
    return y;
  }
  function tickerItems() {
    const out = [];
    for (let i = N.stories.length - 1; i >= 0 && out.length < 6; i--) {
      if (CLOCK - N.stories[i].t < RECENT * 2) out.push(N.stories[i].h);
    }
    const A = ambientList();
    for (let i = 0; i < A.length && out.length < 10; i++) out.push(A[i].h);
    if (!out.length) out.push(fallback().h);
    return out;
  }
  function drawAnchor(c, cx, t) {
    const nod = Math.sin(t * 1.7) * 1.2, talk = (Math.floor(t * 6) % 3) ? 1 : 0;
    c.fillStyle = "#1b1f2a";
    c.beginPath();
    c.moveTo(cx - 62, 186); c.lineTo(cx - 50, 146); c.quadraticCurveTo(cx, 132, cx + 50, 146); c.lineTo(cx + 62, 186); c.closePath(); c.fill();
    c.fillStyle = "#f2f2f2";
    c.beginPath(); c.moveTo(cx - 13, 140); c.lineTo(cx, 166); c.lineTo(cx + 13, 140); c.closePath(); c.fill();
    c.fillStyle = "#8e2430";
    c.beginPath(); c.moveTo(cx - 4, 146); c.lineTo(cx + 4, 146); c.lineTo(cx + 6, 172); c.lineTo(cx, 178); c.lineTo(cx - 6, 172); c.closePath(); c.fill();
    c.fillStyle = "#c79a7a";
    c.fillRect(cx - 9, 124 + nod, 18, 18);
    c.beginPath(); c.ellipse(cx, 104 + nod, 21, 26, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#3a2a1f";
    c.beginPath(); c.ellipse(cx, 88 + nod, 22, 13, 0, Math.PI, Math.PI * 2); c.fill();
    c.fillRect(cx - 22, 86 + nod, 5, 14); c.fillRect(cx + 17, 86 + nod, 5, 14);
    c.fillStyle = "#2a1d16";
    c.fillRect(cx - 10, 101 + nod, 5, 3); c.fillRect(cx + 5, 101 + nod, 5, 3);
    c.fillRect(cx - 11, 96 + nod, 7, 2); c.fillRect(cx + 4, 96 + nod, 7, 2);
    c.fillStyle = "#7d3b34";
    c.fillRect(cx - 6, 116 + nod, 12, 2 + talk * 2);
  }

  /* ---- the footage box over the anchor's shoulder ------------------------ */
  const FX = 296, FY = 44, FW = 204, FH = 142;
  function drawFootage(c, s, look, t) {
    c.save();
    c.beginPath(); c.rect(FX, FY, FW, FH); c.clip();
    const sky = function (a, b) { const gr = c.createLinearGradient(0, FY, 0, FY + FH); gr.addColorStop(0, a); gr.addColorStop(1, b); c.fillStyle = gr; c.fillRect(FX, FY, FW, FH); };
    const skyline = function (col, base) {
      c.fillStyle = col;
      for (let i = 0; i < 12; i++) { const bh = 24 + ((i * 53) % 46); c.fillRect(FX + i * 18, FY + base - bh, 15, bh); }
      c.fillRect(FX, FY + base, FW, FH - base);
    };
    let label = "LIVE";
    if (look === "nuke") {
      sky("#3a1a0a", "#b24a12");
      skyline("#1a0c06", 118);
      const k = 0.9 + 0.1 * Math.sin(t * 2);
      c.fillStyle = "rgba(255,190,90," + (0.9 * k).toFixed(2) + ")";
      c.beginPath(); c.ellipse(FX + 102, FY + 44, 46, 26, 0, 0, Math.PI * 2); c.fill();
      c.fillRect(FX + 92, FY + 60, 20, 58);
      c.fillStyle = "rgba(255,240,200,.8)"; c.beginPath(); c.ellipse(FX + 102, FY + 44, 26, 12, 0, 0, Math.PI * 2); c.fill();
    } else if (look === "strike" || look === "war") {
      sky("#060a14", "#1a1622");
      skyline("#05070c", 112);
      const fl = (Math.floor(t * 3) % 3);
      for (let i = 0; i < 3; i++) {
        const x = FX + 30 + ((i * 71 + fl * 23) % 150), r = 10 + ((i + fl) % 3) * 6;
        const gr = c.createRadialGradient(x, FY + 104, 1, x, FY + 104, r * 2.2);
        gr.addColorStop(0, "rgba(255,230,160,.95)"); gr.addColorStop(0.4, "rgba(255,120,30,.7)"); gr.addColorStop(1, "rgba(255,80,0,0)");
        c.fillStyle = gr; c.fillRect(x - r * 2.2, FY + 104 - r * 2.2, r * 4.4, r * 4.4);
      }
      c.fillStyle = "rgba(60,60,70,.55)";
      for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(FX + 60 + i * 30, FY + 70 - i * 6, 22, 14, 0, 0, Math.PI * 2); c.fill(); }
      if (look === "war") label = "FRONT LINE";
    } else if (look === "fire" || look === "collapse") {
      sky("#1c1410", "#3a2414");
      skyline("#0d0a08", 116);
      c.fillStyle = "rgba(90,80,75,.6)";
      for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse(FX + 90 + Math.sin(t + i) * 6, FY + 92 - i * 14, 18 + i * 5, 10 + i * 3, 0, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = (Math.floor(t * 4) % 2) ? "#ff8a2a" : "#ffb347";
      c.beginPath(); c.moveTo(FX + 70, FY + 118); c.lineTo(FX + 88, FY + 84); c.lineTo(FX + 100, FY + 104); c.lineTo(FX + 112, FY + 80); c.lineTo(FX + 130, FY + 118); c.closePath(); c.fill();
    } else if (look === "tsunami") {
      sky("#2a3a48", "#5a7080");
      skyline("#1a2028", 112);
      c.fillStyle = "#16405a";
      c.beginPath(); c.moveTo(FX, FY + FH); c.lineTo(FX, FY + 60);
      c.quadraticCurveTo(FX + 70, FY + 20, FX + 120, FY + 70 + Math.sin(t * 2) * 4);
      c.quadraticCurveTo(FX + 160, FY + 100, FX + FW, FY + 96); c.lineTo(FX + FW, FY + FH); c.closePath(); c.fill();
      c.strokeStyle = "rgba(230,240,245,.8)"; c.lineWidth = 3;
      c.beginPath(); c.moveTo(FX + 10, FY + 55); c.quadraticCurveTo(FX + 70, FY + 18, FX + 118, FY + 66); c.stroke();
    } else if (look === "quake") {
      sky("#5a6470", "#8a8f94");
      c.save(); c.translate(FX + 100, FY + 118); c.rotate(Math.sin(t * 9) * 0.03);
      c.fillStyle = "#2a2d31";
      for (let i = 0; i < 12; i++) { const bh = 24 + ((i * 53) % 46); c.fillRect(-100 + i * 18, -bh, 15, bh); }
      c.restore();
      c.fillStyle = "#3a3530"; c.fillRect(FX, FY + 118, FW, FH);
      c.strokeStyle = "#141210"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(FX + 20, FY + 125); c.lineTo(FX + 70, FY + 132); c.lineTo(FX + 110, FY + 124); c.lineTo(FX + 180, FY + 136); c.stroke();
    } else if (look === "police") {
      sky("#070a12", "#121822");
      skyline("#0a0c10", 104);
      c.fillStyle = "#1c1f24"; c.fillRect(FX, FY + 104, FW, FH);
      c.fillStyle = "#e8e2c8"; for (let i = 0; i < 6; i++) c.fillRect(FX + 8 + i * 34, FY + 122, 18, 3);
      const on = Math.floor(t * 4) % 2;
      c.fillStyle = on ? "rgba(255,40,40,.9)" : "rgba(40,90,255,.9)";
      c.beginPath(); c.arc(FX + 70, FY + 108, 7, 0, Math.PI * 2); c.fill();
      c.fillStyle = on ? "rgba(40,90,255,.9)" : "rgba(255,40,40,.9)";
      c.beginPath(); c.arc(FX + 140, FY + 112, 7, 0, Math.PI * 2); c.fill();
      c.fillStyle = "rgba(255,255,255,.08)"; c.fillRect(FX, FY, FW, FH);
    } else if (look === "weather") {
      const Wt = CBZ.weather || {};
      const rain = !!Wt.raining, night = hour() < 6 || hour() >= 20;
      sky(night ? "#0a1222" : (rain ? "#5a6470" : "#5aa0e0"), night ? "#1a2232" : (rain ? "#8a929a" : "#bfe0f6"));
      if (!rain && !night) { c.fillStyle = "#ffe48a"; c.beginPath(); c.arc(FX + 160, FY + 36, 16, 0, Math.PI * 2); c.fill(); }
      skyline(night ? "#05080e" : "#2a3442", 118);
      if (rain) {
        c.strokeStyle = (Wt.snow || 0) > 0.4 ? "rgba(255,255,255,.8)" : "rgba(200,215,230,.55)"; c.lineWidth = 1;
        const o = (t * 60) % 14;
        for (let x = 0; x < FW + 20; x += 9) for (let y = -14; y < FH; y += 14) { c.beginPath(); c.moveTo(FX + x - 3, FY + y + o); c.lineTo(FX + x - 7, FY + y + o + 9); c.stroke(); }
      }
      label = "OUTSIDE";
    } else if (look === "turf") {
      drawTurfMap(c);
      label = "DISTRICTS";
    } else if (look === "market") {
      drawMarket(c);
      label = "LBX";
    } else if (look === "traffic") {
      sky("#1a2230", "#2a3240");
      c.fillStyle = "#24272c"; c.fillRect(FX, FY + 70, FW, FH);
      c.fillStyle = "#e8e2c8"; for (let i = 0; i < 7; i++) c.fillRect(FX + ((i * 32 + t * 20) % (FW + 20)) - 10, FY + 104, 16, 3);
      for (let i = 0; i < 8; i++) {
        const x = FX + ((i * 29 + t * (i & 1 ? 26 : -18)) % FW + FW) % FW;
        c.fillStyle = i & 1 ? "#ff3b30" : "#fff2c0";
        c.fillRect(x, FY + (i & 1 ? 92 : 116), 6, 3);
      }
    } else if (look === "poll") {
      drawPoll(c);
      label = "NEW POLL";
    } else {
      // politics / anything else: the topic card
      c.fillStyle = "rgba(8,18,36,.92)"; c.fillRect(FX, FY, FW, FH);
      c.fillStyle = "#1d4f9c"; c.fillRect(FX, FY, FW, 6);
      c.fillStyle = "#9fc4ff"; c.font = "bold 13px Arial, sans-serif"; c.textAlign = "left"; c.textBaseline = "alphabetic";
      c.fillText(s.cat || "TODAY", FX + 12, FY + 26);
      c.fillStyle = "#fff"; c.font = "bold 16px Arial, sans-serif";
      const yy = wrap(c, s.h, FX + 12, FY + 50, FW - 24, 19, 3);
      if (s.sub) { c.fillStyle = "#cfd8e6"; c.font = "13px Arial, sans-serif"; wrap(c, s.sub, FX + 12, yy + 4, FW - 24, 16, 2); }
      label = null;
    }
    c.restore();
    c.strokeStyle = "rgba(160,200,255,.35)"; c.lineWidth = 2; c.strokeRect(FX, FY, FW, FH);
    if (label) {
      c.font = "bold 11px Arial, sans-serif"; c.textAlign = "left"; c.textBaseline = "middle";
      const lw = c.measureText(label).width + 12;
      c.fillStyle = "rgba(0,0,0,.6)"; c.fillRect(FX + 6, FY + 6, lw, 16);
      c.fillStyle = "#fff"; c.fillText(label, FX + 12, FY + 14);
    }
  }
  function gangColor(id) {
    const L = CBZ.cityGangs || [];
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === id && L[i].color != null) {
      const v = typeof L[i].color === "number" ? L[i].color : parseInt(String(L[i].color).replace("#", ""), 16);
      if (isFinite(v)) return "#" + ("000000" + v.toString(16)).slice(-6);
    }
    if (id === "player") return "#f4c542";
    let h = 0; const s = String(id || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return "hsl(" + (Math.abs(h) % 360) + ",55%,48%)";
  }
  // the real district board: each zone where it is, in its owner's colour
  function drawTurfMap(c) {
    c.fillStyle = "#0c1626"; c.fillRect(FX, FY, FW, FH);
    let Z = null;
    try { Z = CBZ.cityZones ? CBZ.cityZones() : null; } catch (e) { Z = null; }
    if (!Z || !Z.length) return;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < Z.length; i++) { x0 = Math.min(x0, Z[i].cx); x1 = Math.max(x1, Z[i].cx); z0 = Math.min(z0, Z[i].cz); z1 = Math.max(z1, Z[i].cz); }
    const sx = (FW - 40) / Math.max(1, x1 - x0), sz = (FH - 44) / Math.max(1, z1 - z0), k = Math.min(sx, sz);
    c.textAlign = "center"; c.textBaseline = "middle";
    for (let i = 0; i < Z.length; i++) {
      const z = Z[i];
      const px = FX + 20 + (z.cx - x0) * k + ((FW - 40) - (x1 - x0) * k) / 2;
      const py = FY + 28 + (z.cz - z0) * k + ((FH - 44) - (z1 - z0) * k) / 2;
      c.fillStyle = z.owner ? gangColor(z.owner) : "#3a4454";
      c.beginPath(); c.arc(px, py, 13, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#fff"; c.font = "bold 8px Arial, sans-serif";
      c.fillText(String(z.name || "").slice(0, 9).toUpperCase(), px, py + 20 > FY + FH - 4 ? py - 18 : py + 20);
    }
  }
  const MKT = { pts: [], at: -1e9 };
  function drawMarket(c) {
    c.fillStyle = "#08111e"; c.fillRect(FX, FY, FW, FH);
    const q = indexQuote();
    if (q && CLOCK - MKT.at > 5) { MKT.at = CLOCK; MKT.pts.push(q.value); if (MKT.pts.length > 40) MKT.pts.shift(); }
    const P = MKT.pts;
    if (q) {
      c.fillStyle = "#fff"; c.font = "bold 24px Arial, sans-serif"; c.textAlign = "left"; c.textBaseline = "alphabetic";
      c.fillText(q.value.toFixed(1), FX + 12, FY + 50);
      c.fillStyle = q.trend === "up" ? "#6be38a" : q.trend === "down" ? "#ff6b5b" : "#cfd8e6";
      c.font = "bold 14px Arial, sans-serif"; c.fillText(q.trend === "up" ? "UP" : q.trend === "down" ? "DOWN" : "FLAT", FX + 110, FY + 48);
    }
    if (P.length > 1) {
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i < P.length; i++) { lo = Math.min(lo, P[i]); hi = Math.max(hi, P[i]); }
      const span = Math.max(0.5, hi - lo);
      c.strokeStyle = "#6be38a"; c.lineWidth = 2; c.beginPath();
      for (let i = 0; i < P.length; i++) {
        const x = FX + 12 + i * (FW - 24) / (P.length - 1), y = FY + FH - 14 - (P[i] - lo) / span * (FH - 76);
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.stroke();
    }
  }
  const POLLS = { prev: null, shown: null };
  function drawPoll(c) {
    c.fillStyle = "rgba(8,18,36,.92)"; c.fillRect(FX, FY, FW, FH);
    const ps = presStatus();
    if (!ps || !ps.seat) return;
    const ap = Math.round(ps.approval || 0);
    if (POLLS.shown !== N.cur) { POLLS.d = POLLS.prev == null ? 0 : ap - POLLS.prev; POLLS.prev = ap; POLLS.shown = N.cur; }
    const d = POLLS.d | 0;
    c.textAlign = "left"; c.textBaseline = "alphabetic";
    c.fillStyle = "#fff"; c.font = "bold 16px Arial, sans-serif"; c.fillText("APPROVAL", FX + 12, FY + 44);
    c.font = "bold 44px Arial, sans-serif"; c.fillText(ap + "%", FX + 12, FY + 94);
    c.fillStyle = d < 0 ? "#ff6b5b" : (d > 0 ? "#6be38a" : "#cfd8e6");
    c.font = "bold 15px Arial, sans-serif"; c.fillText(d === 0 ? "NO CHANGE" : (d < 0 ? "DOWN " + (-d) : "UP " + d), FX + 116, FY + 88);
    c.fillStyle = "rgba(255,255,255,.15)"; c.fillRect(FX + 12, FY + 110, FW - 24, 12);
    c.fillStyle = ap < 35 ? "#e0473a" : (ap < 50 ? "#f4c542" : "#4fb46b");
    c.fillRect(FX + 12, FY + 110, (FW - 24) * Math.max(0, Math.min(1, ap / 100)), 12);
  }

  /* ========================================================================
     5. THE ONE TV PROP
     ======================================================================== */
  /* tvParts(o): the set as boxes in TV space. u = across the screen, y = up
     from the screen's centre, v = toward the viewer (the bezel face is v=0).
     o.w screen width (m), o.mount "stand" | "wall" | "ceiling",
     o.base (stand) metres from the screen centre DOWN to what it stands on,
     o.reach (ceiling) metres from the screen centre UP to the ceiling.
     Returns { parts, sw, sh, depth } — depth: how far the screen face sits
     off the wall for a wall mount. */
  function tvParts(o) {
    o = o || {};
    const sw = Math.max(0.4, +o.w || 1.1), sh = sw * 9 / 16, B = 0.012;
    const P = [];
    const add = function (u, y, v, w, h, d, c, glow) { P.push({ u: u, y: y, v: v, w: w, h: h, d: d, c: c, glow: !!glow }); };
    add(0, 0, -0.015, sw + 2 * B, sh + 2 * B, 0.03, 0x0b0c0e);                          // the panel, 12 mm bezel
    add(0, -(sh / 2 + B + 0.008), -0.013, sw + 2 * B, 0.016, 0.026, 0x17191c);           // the chin
    add(sw * 0.28, -(sh / 2 + B + 0.008), 0.0005, 0.03, 0.004, 0.002, 0x9aa0a8);         // the maker's mark
    add(sw / 2 - 0.02, -(sh / 2 + B + 0.008), 0.0005, 0.008, 0.004, 0.002, 0xff3a2a, true);   // power light
    add(0, -sh * 0.04, -0.05, sw * 0.62, sh * 0.62, 0.04, 0x15171a);                      // back housing
    const mount = o.mount || "stand";
    let depth = 0.07;
    if (mount === "stand") {
      const base = Math.max(sh / 2 + 0.05, +o.base || sh / 2 + 0.1);
      const fw = Math.max(0.28, sw * 0.3);
      add(0, -base + 0.006, -0.03, fw, 0.012, 0.22, 0x1a1b1e);                             // foot plate
      const top = -sh * 0.2, bot = -base + 0.012;
      add(0, (top + bot) / 2, -0.058, 0.07, top - bot, 0.03, 0x1a1b1e);                    // neck
    } else if (mount === "wall") {
      add(0, -sh * 0.04, -0.085, Math.min(0.4, sw * 0.32), Math.min(0.3, sh * 0.4), 0.03, 0x2a2c30);   // bracket
      depth = 0.1;
    } else if (mount === "ceiling") {
      const reach = Math.max(sh / 2 + 0.1, +o.reach || sh / 2 + 0.6);
      const top = reach, bot = sh * 0.2;
      add(0, (top + bot) / 2, -0.05, 0.045, top - bot, 0.045, 0x202226);                  // drop pole
      add(0, reach - 0.006, -0.05, 0.18, 0.012, 0.18, 0x2a2c30);                           // ceiling plate
      add(0, sh * 0.14, -0.08, 0.16, 0.12, 0.03, 0x2a2c30);                                // tilt head
    }
    return { parts: P, sw: sw, sh: sh, depth: depth };
  }
  // the set as ONE mesh (one geometry per size, cached) + the shared screen
  const BODY = new Map();
  let BODY_MAT = null;
  function bodyGeo(key, T) {
    let geo = BODY.get(key);
    if (geo) return geo;
    const pos = [], nor = [], col = [], idx = [];
    const cc = new THREE.Color();
    for (let i = 0; i < T.parts.length; i++) {
      const p = T.parts[i];
      const bg = new THREE.BoxGeometry(p.w, p.h, p.d);
      bg.translate(p.u, p.y, p.v);
      const a = bg.attributes, base = pos.length / 3;
      cc.setHex(p.c);
      for (let k = 0; k < a.position.count; k++) {
        pos.push(a.position.getX(k), a.position.getY(k), a.position.getZ(k));
        nor.push(a.normal.getX(k), a.normal.getY(k), a.normal.getZ(k));
        col.push(cc.r, cc.g, cc.b);
      }
      const ix = bg.index.array;
      for (let k = 0; k < ix.length; k++) idx.push(base + ix[k]);
      bg.dispose();
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    geo._shared = true;
    BODY.set(key, geo);
    return geo;
  }
  /* tvSet(o): a THREE.Group whose origin is the centre of the screen face,
     facing +z. o as tvParts; for a wall mount place the group at the wall
     point + normal * T.depth (returned on group.userData.tv). */
  function tvSet(o) {
    o = o || {};
    const T = tvParts(o);
    const grp = new THREE.Group();
    grp.name = "news-tv";
    grp.userData.tv = T;
    grp.userData.transient = true;
    if (!BODY_MAT) {
      BODY_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
      BODY_MAT._shared = true;
    }
    const key = [T.sw.toFixed(3), o.mount || "stand", (+o.base || 0).toFixed(2), (+o.reach || 0).toFixed(2)].join("|");
    const body = new THREE.Mesh(bodyGeo(key, T), BODY_MAT);
    body.castShadow = false; body.receiveShadow = true;
    grp.add(body);
    const scr = screen(T.sw, T.sh);
    if (scr) { scr.position.z = 0.0015; grp.add(scr); }
    grp.userData.screen = scr;
    return grp;
  }

  /* ========================================================================
     6. THE FRAME LOOP: clock, rotation, polls, and a paint only when a
        screen is in the room with you
     ======================================================================== */
  let pollAcc = 0, nearAcc = 0;
  function tick(dt) {
    dt = Math.min(0.25, Math.max(0, dt || 0));
    CLOCK += dt;
    pollAcc += dt;
    if (pollAcc >= POLL) { pollAcc = 0; try { poll(); } catch (e) {} }
    if (!SCREENS.length || !CV) return;
    nearAcc += dt;
    if (nearAcc >= 0.25) { nearAcc = 0; N.nearest = nearestScreen(); }
    if (N.nearest > NEAR) return;
    rotate();
    const gap = N.nearest < CLOSE ? 0.5 : 1.0;
    if (CLOCK - N.paintAt < gap && !(N.dirty && CLOCK - N.paintAt > 0.2)) return;
    N.paintAt = CLOCK; N.dirty = false;
    try { paint(); TEX.needsUpdate = true; } catch (e) {}
  }
  if (typeof CBZ.onUpdate === "function") CBZ.onUpdate(48.5, tick);

  function paintNow() {
    if (!ensureCanvas()) return false;
    rotate();
    N.paintAt = CLOCK; N.dirty = false;
    paint(); TEX.needsUpdate = true;
    return true;
  }

  CBZ.news = {
    push: push,
    event: event,
    wire: wire,
    stories: function () { return N.stories.slice(); },
    current: function () { return N.cur || fallback(); },
    ambient: function () { N.ambAt = -1e9; return ambientList().slice(); },
    texture: texture,
    material: material,
    screen: screen,
    watch: watch,
    tvParts: tvParts,
    tvSet: tvSet,
    paintNow: paintNow,
    audit: function () {
      return {
        stories: N.stories.length, current: N.cur ? N.cur.h : null, screens: SCREENS.length,
        nearest: Math.round(N.nearest), painted: N.painted, pushed: N.pushed, events: N.events,
        hooked: Object.assign({}, SEEN.hooked), canvas: CV ? W + "x" + H : null,
      };
    },
    _poll: poll, _tick: tick,
  };
})();
