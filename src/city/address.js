/* ============================================================
   city/address.js — THE NATIONAL ADDRESS. The President takes over every
   television in the country and says what he says.

   OWNER: "You can do the thing presidents can do where you take over all TVs
   for a national address, and then you get to choose many options for what
   to say, like 'the other party is illegal'."

   WHAT EXISTED. presidency.js had an "address" order: it paid for airtime,
   moved approval a few points and wrote one line on the phone. The press
   secretary already walked in on a bad news day ("The networks will give you
   ten minutes tonight"), the whip rang before a vote, the phone's "Address
   the protests" called it. Nothing was said and no screen changed. Now the
   same order (every one of those callers) puts the President on the air:

   1. ON AIR. The press secretary (or the Chief) is beside you: "Cameras are
      ready, sir." You are at the Press Briefing Room lectern or behind the
      Resolute desk (walk to either and the verb is on it), or wherever the
      order found you. NEWS ONE cuts to the live feed on its one canvas, which
      is every TV in the world: you, the flag behind you, the lower third
      ADDRESS TO THE NATION and the line you just said.
   2. WHAT YOU SAY is a short run of statements (3 to 5). Four come up at a
      time as reply buttons (the conversation surface every president
      exchange uses; keys 1-4 or a tap). They are not a script: each is a
      VERB over a TARGET the world has right now —
        declare <party/group> illegal     blame <group/nation> for <event>
        praise <institution>              announce <policy order>
        threaten <nation>                 call supporters to <place>
        promise <thing>                   apologise for <your own act>
        declare martial law               declare the election stolen
        concede                           resign
      — the parties, groups and nations that exist, the stories NEWS ONE
      actually ran, the orders you actually gave.
   3. EVERY STATEMENT IS AN ACT. It goes through CBZ.politics.act(kind,
      {target, by, ideology, institution, ...}) — the one political model
      (city/politics.js) owns what it does to loyalty, Congress, the courts
      and the news. Until that file is loaded the act falls back to what the
      game already had: statecraft's force-used (tyranny feeds scandal feeds
      approval), presidency orders for the policy moves, the ban written on
      the world's politics record, and a court that answers by statecraft's
      legitimacy. No second approval or loyalty model lives here.
   4. THE COUNTRY WATCHES. People near a TV turn to it and cheer or boo by
      where they stand; a room with a crowd round its set erupts; a mob or the
      crowd at the Mansion answers (city/mob.js). "Call supporters to the
      Capitol" puts a real crowd on the street (mob.js), and in a refused
      election it is the crowd city/transfer.js marches.
   5. AFTER. NEWS ONE runs the reaction off the boldest thing said ("President
      declares Democrats illegal in national address") and Holler fills up.

   PUBLIC: CBZ.address = { begin(opts), choose(i), options(), end(), live(),
     statements(ctx), act(kind, o), model(), places(), audit() }.
   Bus (CBZ.presidency.emit): "address" {phase:"start"|"end", set, said[],
     headline, holler}, "address-statement" {verb, kind, target, line, result}.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.address) return;
  const g = CBZ.game || (CBZ.game = {});

  const MIN_SAID = 3, MAX_SAID = 5;
  const BEAT_GAP = 2.6;          // s between the line landing and the next options
  const WATCH_R = 11;            // m: who is watching a set
  const STAFF_R = 14;            // m: the staffer who says "Cameras are ready"

  // ---------------------------------------------------------------- small things
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function day() { try { return CBZ.worldDay ? (CBZ.worldDay() | 0) : 0; } catch (e) { return 0; } }
  function h01(a, b, s) { return CBZ.hash01 ? CBZ.hash01(a, b, s) : ((Math.sin(a * 12.9898 + b * 78.233 + s) * 43758.5453) % 1 + 1) % 1; }
  function hashStr(s) { s = String(s || ""); let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function cap(s) { s = String(s || ""); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function surname(n) { const a = String(n || "").trim().split(/\s+/); return a[a.length - 1] || ""; }
  function Pz() { return CBZ.presidency || null; }
  function seat() { const p = Pz(); try { return p && p.seat ? p.seat() : null; } catch (e) { return null; } }
  function status() { const p = Pz(); try { return p && p.status ? p.status() || {} : {}; } catch (e) { return {}; } }
  function emit(evt, d) { const p = Pz(); if (p && p.emit) { try { p.emit(evt, d); } catch (e) {} } }
  function politicsRec() { const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null; return (w && w.politics) || g.cityPolitics || null; }
  function player() { return CBZ.player || null; }
  function playerName() {
    const O = CBZ.officials;
    if (O && O.identityOf) { try { const i = O.identityOf("player"); if (i && i.name) return i.name; } catch (e) {} }
    return (g.playerName || (CBZ.player && CBZ.player.name)) || "the President";
  }
  function presTitle() { return "President " + surname(playerName()); }
  function news(h, o) { const N = CBZ.news; if (N && N.push) { try { return N.push(h, o || {}); } catch (e) {} } return false; }
  function approval() { const h = seat(); return h && h.rec && isFinite(h.rec.approval) ? h.rec.approval : 50; }

  // ============================================================
  //  §1  THE MODEL, READ. CBZ.politics owns parties, groups, institutions
  //  and their loyalty; until it is loaded the readers below fall back to
  //  names the game can stand behind and numbers other systems own.
  // ============================================================
  function Pol() { return CBZ.politics || null; }
  function listOf(v) {
    if (!v) return [];
    if (typeof v === "function") { try { v = v(); } catch (e) { return []; } }
    if (Array.isArray(v)) return v;
    if (typeof v === "object") return Object.keys(v).map(function (k) { return Object.assign({ id: k }, v[k]); });
    return [];
  }
  // the two parties of Congress (politics.js: R and D, the President's own
  // party is congress().presParty)
  const PARTIES = {
    R: { id: "R", name: "Republicans", short: "Republican", color: "red" },
    D: { id: "D", name: "Democrats", short: "Democratic", color: "blue" },
  };
  // how each ideology dresses on the street (city/mob.js)
  const IDEO_COLOR = { com: 0xb01e1e, soc: 0xd2506a, dem: 0x1f4fa8, rep: 0xb3262c, ana: 0x1a1a1a, nazi: 0x2b2b2b, nat: 0x23365e, fas: 0x151515 };
  const IDEO_PARTY = { rep: "R", nat: "R", fas: "R", nazi: "R", dem: "D", soc: "D", com: "D", ana: "D" };
  function S() { return g.addressState || (g.addressState = { myParty: null, said: [], orders: [], acts: [], last: null, count: 0 }); }
  function congress() { const P = Pol(); try { return P && P.congress ? P.congress() : null; } catch (e) { return null; } }
  function parties() {
    const C = congress();
    let mine = C && C.presParty;
    if (!mine) {
      const st = S();
      if (!st.myParty) st.myParty = hashStr(String(CBZ.seed || g.seed || 1)) % 2 ? "R" : "D";
      mine = st.myParty;
    }
    const banned = {};
    if (C && Array.isArray(C.banned)) C.banned.forEach(function (k) { banned[k] = 1; });
    const pb = (politicsRec() && politicsRec().banned) || {};
    return ["R", "D"].map(function (k) {
      const P = PARTIES[k];
      return { id: k, name: P.name, short: P.short, color: P.color, mine: k === mine, banned: !!banned[k] || !!(pb[k] && !pb[k].blocked), seats: C ? C.seats[k] : null };
    });
  }
  function myParty() { const L = parties(); for (let i = 0; i < L.length; i++) if (L[i].mine) return L[i]; return L[0]; }
  function rivalParty() { const L = parties(); for (let i = 0; i < L.length; i++) if (!L[i].mine) return L[i]; return null; }
  // the people of the country, by what they believe: politics.js's eight
  // ideologies (share, loyalty to the President). Without the model, the
  // same eight with the President's approval as everyone's loyalty.
  const IDEO_FALLBACK = [["com", "Communists", 0.04], ["soc", "Socialists", 0.14], ["dem", "Democrats", 0.30], ["rep", "Republicans", 0.30], ["ana", "Anarchists", 0.03], ["nazi", "Neo-Nazis", 0.02], ["nat", "Nationalists", 0.12], ["fas", "Fascists", 0.05]];
  function groups() {
    const P = Pol();
    let L = [];
    if (P && P.groups) { try { L = P.groups() || []; } catch (e) { L = []; } }
    const mine = myParty().id;
    if (!L.length) {
      const a = approval();
      L = IDEO_FALLBACK.map(function (q) { return { id: q[0], name: q[1], share: q[2], loyalty: clamp(a + (IDEO_PARTY[q[0]] === mine ? 10 : -10), 0, 100) }; });
    }
    return L.map(function (q) {
      return { id: q.id, name: q.name || cap(q.id), share: isFinite(q.share) ? +q.share : 0.1, people: q.people || null,
        party: IDEO_PARTY[q.id] || null, loyalty: isFinite(q.loyalty) ? +q.loyalty : approval(), banned: !!q.banned, color: IDEO_COLOR[q.id] != null ? IDEO_COLOR[q.id] : null };
    });
  }
  // the services (politics.js: police, Army, Bureau, Agency, Secret Service)
  function institutions() {
    const P = Pol();
    let L = [];
    if (P && P.institutions) { try { L = P.institutions() || []; } catch (e) { L = []; } }
    if (L.length) return L.map(function (q) { return { id: q.id, name: q.name || cap(q.id), loyalty: isFinite(q.loyalty) ? +q.loyalty : 50 }; });
    const PS = CBZ.presidentStaff;
    const loy = function (role) { try { return PS && PS.loyalty ? PS.loyalty(role) : 60; } catch (e) { return 60; } };
    return [
      { id: "army", name: "The Army", loyalty: loy("general") },
      { id: "police", name: "The police", loyalty: loy("police") },
      { id: "fbi", name: "The Bureau", loyalty: loy("bureau") },
    ];
  }
  function nations() {
    const h = seat();
    const out = [];
    const L = CBZ.polity && CBZ.polity.list ? CBZ.polity.list("country") : [];
    for (let i = 0; i < L.length; i++) { const c = L[i]; if (!c || !c.name || (h && c.id === h.id)) continue; out.push({ id: c.id, name: c.name }); }
    return out;
  }
  // what happened lately, from what NEWS ONE actually ran
  function events() {
    const N = CBZ.news, out = [];
    let st = [];
    try { st = N && N.stories ? N.stories() : []; } catch (e) { st = []; }
    const seen = {};
    for (let i = st.length - 1; i >= 0 && out.length < 4; i--) {
      const s = st[i]; if (!s || !s.h) continue;
      const lc = s.h.toLowerCase();
      let label = null;
      if (/attack|bomb|terror|gunmen/.test(lc)) label = "the attack";
      else if (/airstrike|missile|war/.test(lc)) label = "the war";
      else if (/riot|break through|police line|force their way/.test(lc)) label = "the violence";
      else if (/murder|shooting|dead|killed/.test(lc)) label = "the killings";
      else if (/robbed|heist|crime|manhunt/.test(lc)) label = "the crime wave";
      else if (/tsunami|quake|volcano|fire|flood|tornado/.test(lc)) label = "the disaster";
      else if (/loses the election|election|vote|count/.test(lc)) label = "the election";
      else if (/protest|march|crowd/.test(lc)) label = "the unrest";
      else if (/index|stocks|prices|tax/.test(lc)) label = "the economy";
      if (label && !seen[label]) { seen[label] = 1; out.push({ label: label, from: s.h }); }
    }
    const T = CBZ.transfer && CBZ.transfer.state ? CBZ.transfer.state() : null;
    if (T && T.phase && T.phase !== "idle" && !seen["the election"]) out.unshift({ label: "the election", from: "the count" });
    if (!out.length) out.push({ label: "the state of this country", from: null });
    return out;
  }
  // the places a President can send people to
  function complex(id) { const L = CBZ.govComplexes; if (Array.isArray(L)) for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === id) return L[i]; return null; }
  function places() {
    const out = [];
    const T = CBZ.transfer;
    const cp = T && T.capitolPlan ? T.capitolPlan() : null;
    if (cp) out.push({ id: "capitol", name: "the Capitol", at: cp.muster, face: cp.face, route: cp.route, plan: cp });
    const m = complex("execmansion");
    if (m && m.gate) {
      const n = Math.hypot(m.gate.x - m.cx, m.gate.z - m.cz) || 1, ux = (m.gate.x - m.cx) / n, uz = (m.gate.z - m.cz) / n;
      out.push({ id: "mansion", name: "the Mansion", at: { x: m.gate.x + ux * 22, z: m.gate.z + uz * 22 }, face: Math.atan2(-ux, -uz) });
    }
    const ch = complex("cityhall");
    if (ch && ch.gate) out.push({ id: "cityhall", name: "City Hall", at: { x: ch.gate.x, z: ch.gate.z }, face: Math.atan2(ch.cx - ch.gate.x, ch.cz - ch.gate.z) });
    return out;
  }
  function model() {
    return { parties: parties(), groups: groups(), institutions: institutions(), nations: nations(), events: events(), places: places().map(function (p) { return { id: p.id, name: p.name }; }) };
  }

  // ============================================================
  //  §2  THE ACT. One door into the political model.
  // ============================================================
  // act(kind, o): kind is the statement's act ("ban", "blame", "praise",
  // "threaten", "rally", "promise", "apologise", "martial-law",
  // "election-stolen", "resign", "concede", "policy" ...). With the political
  // model loaded it becomes that model's grammar: a person verb (ban, insult,
  // praise, threaten), an order (through the presidency, which prices it
  // there), or a policy move. Without it, the fallback below.
  const PROMISE_VEC = { jobs: { welfare: 0.05 }, safety: { police: 0.04 }, taxes: { taxes: -0.05 }, peace: { war: -0.06 }, elections: { liberty: 0.05 } };
  const SORRY_VEC = { curfew: { police: -0.05, liberty: 0.05 }, martial: { police: -0.08, liberty: 0.08 }, taxup: { taxes: -0.05 }, crackdown: { police: -0.06, liberty: 0.06 },
    ban: { liberty: 0.06 }, strike: { war: -0.06 }, nuke: { war: -0.1 }, war: { war: -0.08 }, emergency: { liberty: 0.08 } };
  function tid(t) { return t && typeof t === "object" ? (t.id != null ? t.id : t.name) : t; }
  function politicsAct(P, kind, o) {
    const t = tid(o.target), hl = o.headline || null;
    const base = { by: "self", news: true, headline: hl };
    switch (kind) {
      case "ban": return P.act("ban", Object.assign(base, { target: t }));
      case "blame": return P.act("insult", Object.assign(base, { target: t, how: "blame" }));
      case "praise": return P.act("praise", Object.assign(base, { target: t, institution: o.institution || t }));
      case "threaten": return P.act("threaten", Object.assign(base, { target: t }));
      case "election-stolen": return P.act("insult", Object.assign(base, { target: tid(o.rival) || "D", how: "stolen", scale: 2 }));
      case "rally": return P.act("policy", Object.assign(base, { verbWord: "rally", vec: { nation: 0.04, liberty: -0.02 } }));
      case "promise": return P.act("policy", Object.assign(base, { verbWord: "promise", vec: PROMISE_VEC[t] || {} }));
      case "apologise": return P.act("policy", Object.assign(base, { verbWord: "apologise", vec: SORRY_VEC[t] || { liberty: 0.03 } }));
      // the count, answered: refusing it is an attack on the other party's win,
      // conceding it is a courtesy to them (transfer.js tells the news itself)
      case "refuse-concede": return P.act("insult", Object.assign(base, { target: (rivalParty() || {}).id || "D", how: "refuses to concede", news: false, headline: null }));
      case "concede": return P.act("praise", Object.assign(base, { target: (rivalParty() || {}).id || "D", how: "concedes", news: false, headline: null }));
      case "martial-law": { const r = press("martial"); return r && r.ok ? r : press("emergency"); }
      case "policy": return o.order ? press(o.order) : { ok: false, why: "No order." };
      case "resign": return fallbackAct("resign", o);
      default: return P.act(kind, Object.assign(base, o));
    }
  }
  function act(kind, o) {
    o = Object.assign({ by: "president", via: "address" }, o || {});
    const P = Pol();
    if (P && typeof P.act === "function" && seat()) {
      let r = null;
      try { r = politicsAct(P, kind, o); } catch (e) { r = { ok: false, why: String((e && e.message) || e) }; }
      r = r || { ok: true };
      // a kind the model has no word for (concede, refuse) is still the act it is
      if (r.ok === false && /unknown act|no seat/.test(String(r.why || ""))) r = fallbackAct(kind, o);
      if (r.ok !== false) recordAct(kind, o, "politics");
      return Object.assign({ via: "politics" }, r);
    }
    const r = fallbackAct(kind, o);
    if (r.ok !== false) recordAct(kind, o, "fallback");
    return Object.assign({ via: "fallback" }, r);
  }
  function recordAct(kind, o, via) {
    const s = S();
    s.acts.push({ kind: kind, target: o.target ? (o.target.id || o.target.name || o.target) : null, day: day(), via: via });
    if (s.acts.length > 24) s.acts.shift();
  }
  function forceUsed(n, why) { if (CBZ.gov && CBZ.gov.forceUsed) { try { CBZ.gov.forceUsed(n, why); } catch (e) {} } }
  function press(key) { const p = Pz(); if (!p || !p.press) return { ok: false, why: "No presidency." }; try { return p.press(key) || { ok: false }; } catch (e) { return { ok: false, why: "Refused." }; } }
  function legitimacy() { try { return CBZ.gov && CBZ.gov.legitimacy ? CBZ.gov.legitimacy() : 0.5; } catch (e) { return 0.5; } }
  const LATER = [];
  function later(secs, fn) { LATER.push({ t: CLOCK + secs, fn: fn }); }
  // WHAT THE GAME ALREADY HAD, used while politics.js is not loaded. Every
  // number moved here belongs to another system: tyranny (statecraft), the
  // orders (presidency), the seat (polity), the world's politics record.
  function fallbackAct(kind, o) {
    const pol = politicsRec();
    const t = o.target || {};
    switch (kind) {
      case "ban": {
        if (!t.id) return { ok: false, why: "Ban whom?" };
        if (pol) {
          pol.banned = pol.banned || {};
          pol.banned[t.id] = { day: day(), name: t.name || t.id, blocked: false };
        }
        forceUsed(14, "ban " + (t.name || t.id));
        // the courts answer by the legitimacy the country still grants you
        const L = legitimacy(), gov = (seat() && seat().rec && seat().rec.govType) || "democracy";
        if (gov === "democracy" || gov === "republic" || L < 0.55) {
          later(18, function () {
            const b = pol && pol.banned && pol.banned[t.id];
            if (!b || b.blocked) return;
            b.blocked = true;
            news("Supreme Court blocks the ban on the " + (t.name || t.id), { kind: "breaking", cat: "POLITICS", sub: "The justices call it unconstitutional" });
            emit("court", { kind: "ban-blocked", target: t.id, headline: "Supreme Court blocks the ban on the " + (t.name || t.id), holler: [{ kind: "press", text: "The Supreme Court has blocked the ban." }] });
          });
        }
        return { ok: true, banned: t.id };
      }
      case "martial-law": {
        const r = press("martial");
        if (!r.ok) { const r2 = press("emergency"); return r2.ok ? { ok: true, order: "emergency" } : { ok: false, why: r.why || r2.why }; }
        return { ok: true, order: "martial" };
      }
      case "policy": return o.order ? press(o.order) : { ok: false, why: "No order." };
      case "resign": {
        const h = seat(); if (!h) return { ok: false, why: "You hold nothing." };
        const rec = h.rec;
        rec.office.holder = rec.office.deputy || null;
        rec.office.deputy = null;
        if (!rec.office.holder) rec.vacuum = day();
        return { ok: true, resigned: true };
      }
      case "election-stolen": forceUsed(6, "stolen election claim"); return { ok: true };
      case "threaten": forceUsed(2, "threat"); return { ok: true };
      case "blame": return { ok: true };
      case "praise": return { ok: true };
      case "promise": return { ok: true };
      case "apologise": { if (pol && pol.scandal > 0) pol.scandal = clamp(pol.scandal - 4, 0, 100); return { ok: true }; }
      case "rally": return { ok: true };
      case "concede": return { ok: true };
      default: return { ok: true };
    }
  }

  // ============================================================
  //  §3  THE GRAMMAR. A statement is a verb over a target the world has.
  //  pleases: whose people cheer it ("mine", "theirs", "all", "none")
  //  heat: how big a story it is (the headline is the hottest thing said)
  // ============================================================
  function the(n) { return /^(the |a |an )/i.test(n) ? n : "the " + n; }
  function polName(n) { return String(n || "").replace(/^the /i, ""); }
  const PROMISES = [
    { id: "jobs", label: "Promise jobs", say: "A job for every pair of hands that wants one. Starting this month." },
    { id: "safety", label: "Promise safety", say: "Nobody in this country will be afraid to walk home. Not on my watch." },
    { id: "taxes", label: "Promise tax cuts", say: "Your taxes are coming down. That is a promise." },
    { id: "peace", label: "Promise peace", say: "I will bring our people home. I will end this." },
    { id: "elections", label: "Promise fair elections", say: "This country will vote, and every vote will count." },
  ];
  const POLICIES = [
    { order: "curfew", label: "Announce a curfew", say: "From tonight there is a curfew. Stay off the streets after dark." },
    { order: "taxdown", label: "Announce a tax cut", say: "I am cutting your taxes, as of tomorrow morning." },
    { order: "taxup", label: "Announce a tax rise", say: "We will all pay a little more. It is the only honest way." },
    { order: "police", label: "Fund the police", say: "I am putting more police on your streets. Starting tonight." },
    { order: "amnesty", label: "Announce an amnesty", say: "I am granting an amnesty. Come home. Start again." },
    { order: "guard", label: "Call out the Guard", say: "I have called out the National Guard to keep order." },
    { order: "wall", label: "Announce the wall", say: "We are building the wall. Every metre of it." },
  ];
  const APOLOGY = {
    curfew: "the curfew", martial: "the soldiers on our streets", taxup: "the tax rise", crackdown: "the crackdown",
    strike: "the airstrike", nuke: "what I did with that weapon", emergency: "the emergency powers", war: "the war",
    ban: "the ban",
  };
  // which orders the presidency would take right now (its own gates)
  function orderGates() {
    const p = Pz(), out = {};
    let L = null;
    try { L = p && p.buttons ? p.buttons() : null; } catch (e) { L = null; }
    if (!Array.isArray(L)) return null;
    for (let i = 0; i < L.length; i++) if (L[i] && L[i].key) out[L[i].key] = !!L[i].ok;
    return out;
  }
  function statements(ctx) {
    ctx = ctx || {};
    const out = [];
    const gates = orderGates();
    const pressOk = function (key) { return gates ? !!gates[key] : true; };
    const me = myParty(), rv = rivalParty();
    const T = CBZ.transfer && CBZ.transfer.state ? CBZ.transfer.state() : null;
    const lost = !!(T && (T.phase === "lost" || T.phase === "refused" || T.phase === "session"));
    const st = status();
    const ev = events();
    const recentAttack = !!(st.threat && (st.threat.armed || st.threat.members > 0)) || ev.some(function (e) { return e.label === "the attack"; });
    const said = ctx.said || [];
    const usedVerb = {};
    for (let i = 0; i < said.length; i++) usedVerb[said[i].verb + ":" + (said[i].tid || "")] = 1;
    const push = function (s) { if (!usedVerb[s.verb + ":" + (s.tid || "")]) out.push(s); };
    // ---- declare <party / group> illegal
    if (rv && !rv.banned) push({ verb: "ban", kind: "ban", tid: rv.id, target: { kind: "party", id: rv.id, name: rv.name },
      label: rv.name + " illegal", line: "The " + rv.name + " are an illegal organization. As of tonight, they are banned.",
      pleases: "mine", heat: 5, w: lost ? 7 : 2.5, headline: "President declares " + rv.name + " illegal in national address" });
    // any ideology the country has: the colder it is to you, the likelier
    const GR = groups().filter(function (q) { return !q.banned && q.share <= 0.16; });
    GR.sort(function (a, b) { return a.loyalty - b.loyalty; });
    for (let i = 0; i < GR.length && i < 3; i++) {
      const q = GR[i];
      push({ verb: "ban", kind: "ban", tid: q.id, target: { kind: "group", id: q.id, name: q.name },
        label: q.name + " illegal", line: "The " + q.name + " are banned in this country. As of tonight.",
        pleases: q.party === me.id ? "theirs" : "mine", heat: 4, w: clamp((50 - q.loyalty) / 12, 0.3, 3),
        headline: "President bans the " + q.name + " in national address" });
    }
    // ---- blame <group / nation / party> for <event>
    const blameable = [];
    if (rv) blameable.push({ kind: "party", id: rv.id, name: "the " + rv.name });
    const N = nations();
    if (N.length) blameable.push({ kind: "nation", id: N[0].id, name: N[0].name });
    if (GR.length) blameable.push({ kind: "group", id: GR[0].id, name: "the " + GR[0].name });
    if (recentAttack) blameable.unshift({ kind: "group", id: "cell", name: "the cell" });
    for (let i = 0; i < ev.length && i < 2; i++) {
      for (let j = 0; j < blameable.length && j < 2; j++) {
        const b = blameable[(i + j) % blameable.length], e = ev[i];
        push({ verb: "blame", kind: "blame", tid: b.id + ":" + e.label, target: { kind: b.kind, id: b.id, name: b.name }, event: e.label,
          label: "Blame " + polName(b.name) + (e.from ? " for " + e.label : ""), line: e.from ? cap(e.label) + " is on " + b.name + ". They did this to you." : cap(b.name) + (b.kind === "nation" ? " has" : " have") + " been working against this country. Not any more.",
          pleases: b.kind === "party" ? "mine" : "all", heat: b.kind === "nation" ? 3 : 2, w: (e.label === "the election" && b.kind === "party") ? 7 : (e.label === "the attack" ? 6 : 2.5),
          headline: "President blames " + polName(b.name) + (e.from ? " for " + e.label : "") });
      }
    }
    // ---- praise <institution>
    const I = institutions();
    for (let i = 0; i < I.length; i++) {
      const q = I[i];
      if (q.id === "press" || q.id === "courts") continue;
      push({ verb: "praise", kind: "praise", tid: q.id, target: { kind: "institution", id: q.id, name: q.name }, institution: q.id,
        label: "Praise " + polName(q.name), line: "I want to thank " + q.name + ". They have never let this country down.",
        pleases: "all", heat: 1, w: (recentAttack && (q.id === "army" || q.id === "police")) ? 4 : (lost && (q.id === "army" || q.id === "guard") ? 4 : 1.5),
        headline: "President praises " + polName(q.name) });
    }
    // ---- announce <policy order> — a real order, through the presidency
    for (let i = 0; i < POLICIES.length; i++) {
      const p = POLICIES[i];
      if (!pressOk(p.order)) continue;
      push({ verb: "announce", kind: "policy", tid: p.order, order: p.order, target: { kind: "policy", id: p.order, name: p.label },
        label: p.label, line: p.say, pleases: p.order === "taxup" || p.order === "curfew" ? "none" : p.order === "amnesty" ? "theirs" : "mine", heat: 2,
        w: (p.order === "curfew" || p.order === "guard") && recentAttack ? 4 : p.order === "taxdown" && approval() < 45 ? 3.5 : 1.4,
        headline: "President announces " + p.label.replace(/^(Announce|Fund|Call out) /, "").toLowerCase() });
    }
    // ---- threaten <nation>
    for (let i = 0; i < N.length && i < 2; i++) {
      push({ verb: "threaten", kind: "threaten", tid: N[i].id, target: { kind: "nation", id: N[i].id, name: N[i].name },
        label: "Threaten " + N[i].name, line: N[i].name + ", hear me. One more step and you will answer for it.",
        pleases: "mine", heat: 3, w: recentAttack ? 3.5 : 1.6, headline: "President threatens " + N[i].name });
    }
    // ---- call supporters to <place>
    const PL = places();
    for (let i = 0; i < PL.length; i++) {
      const p = PL[i];
      push({ verb: "rally", kind: "rally", tid: p.id, target: { kind: "place", id: p.id, name: p.name }, place: p.id,
        label: "Call supporters to " + p.name, line: "I am asking every one of you to come to " + p.name + ". Be there. Be loud.",
        pleases: "mine", heat: p.id === "capitol" && lost ? 5 : 2, w: p.id === "capitol" && lost ? 9 : (p.id === "mansion" ? 1.6 : 1.0),
        headline: "President calls supporters to " + p.name });
    }
    // ---- promise <thing>
    for (let i = 0; i < PROMISES.length; i++) {
      const p = PROMISES[i];
      push({ verb: "promise", kind: "promise", tid: p.id, target: { kind: "promise", id: p.id, name: p.label }, label: p.label, line: p.say,
        pleases: "all", heat: 1, w: approval() < 45 ? 2.4 : 1.6, headline: "President " + p.label.toLowerCase().replace("promise", "promises") });
    }
    // ---- apologise for <your own act>
    const acted = S().orders.concat(S().acts.map(function (a) { return a.kind === "ban" ? "ban" : null; })).filter(Boolean);
    for (let i = acted.length - 1, k = 0; i >= 0 && k < 2; i--) {
      const key = acted[i]; const what = APOLOGY[key];
      if (!what) continue;
      k++;
      push({ verb: "apologise", kind: "apologise", tid: key, target: { kind: "act", id: key, name: what },
        label: "Apologise for " + what.replace(/^the /, ""), line: "I was wrong about " + what + ". I am sorry.", pleases: "theirs", heat: 3,
        w: approval() < 40 ? 3.2 : 1.5, headline: "President apologises for " + what });
    }
    // ---- the big ones
    push({ verb: "martial", kind: "martial-law", tid: "", target: { kind: "nation", id: "home", name: "the country" },
      label: "Declare martial law", line: "As of midnight this country is under martial law.", pleases: "none", heat: 6,
      w: lost ? 3 : recentAttack ? 2.2 : 0.4, headline: "President declares martial law" });
    if (lost || (st.election && st.election.voteDay != null)) {
      push({ verb: "stolen", kind: "election-stolen", tid: "", target: { kind: "election", id: "election", name: "the election" },
        rival: rv ? rv.id : null,
      label: "The election was stolen", line: "This election was stolen. We won it, and they took it. We will not let them.",
        pleases: "mine", heat: 6, w: lost ? 10 : 0.6, headline: "President says the election was stolen" });
    }
    if (lost) push({ verb: "concede", kind: "concede", tid: "", target: { kind: "election", id: "election", name: "the election" },
      label: "Concede", line: "The people have spoken. I congratulate the winner, and I will hand over power in peace.",
      pleases: "theirs", heat: 5, w: 2.5, headline: "President concedes in national address" });
    push({ verb: "resign", kind: "resign", tid: "", target: { kind: "office", id: "presidency", name: "the presidency" },
      label: "Resign", line: "I will resign the presidency, effective at noon tomorrow.", pleases: "theirs", heat: 7,
      w: approval() < 25 ? 1.2 : 0.25, headline: "President resigns in national address" });
    return out;
  }
  // four at a time: the three likeliest (no verb twice), and after three
  // statements "Good night" is the fourth
  function pickOptions(said, beat) {
    const all = statements({ said: said });
    const scored = all.map(function (s, i) { return { s: s, v: s.w * (0.75 + 0.5 * h01(day() + beat * 7, i, hashStr(s.verb + s.tid) & 0xffff)) }; });
    scored.sort(function (a, b) { return b.v - a.v; });
    const out = [], verbs = {};
    for (let i = 0; i < scored.length && out.length < (said.length >= MIN_SAID ? 3 : 4); i++) {
      const s = scored[i].s;
      if (verbs[s.verb]) continue;
      verbs[s.verb] = 1; out.push(s);
    }
    if (said.length >= MIN_SAID) out.push({ verb: "end", label: "Good night", line: "Good night, and God bless this country." });
    return out;
  }

  // ============================================================
  //  §4  ON AIR
  // ============================================================
  let CLOCK = 0;
  const A = { live: false, set: null, said: [], opts: null, beat: 0, waitT: 0, phase: null, staff: null, token: 0, startedAt: 0, reactT: 0 };
  function nearStaff() {
    const P = player(); if (!P || !P.pos) return null;
    const L = CBZ.cityPeds || [];
    let best = null, bd = STAFF_R * STAFF_R;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      if (!p || p.dead || !p.pos || (p._presStaff !== "press" && p._presStaff !== "chief")) continue;
      const d = (p.pos.x - P.pos.x) * (p.pos.x - P.pos.x) + (p.pos.z - P.pos.z) * (p.pos.z - P.pos.z);
      if (d < bd || (d < STAFF_R * STAFF_R && p._presStaff === "press" && best && best._presStaff !== "press")) { bd = d; best = p; }
    }
    return best;
  }
  function rooms() { try { return CBZ.presidentInteriorRooms ? CBZ.presidentInteriorRooms() : []; } catch (e) { return []; } }
  function roomPoint(key, lm) {
    const R = rooms();
    for (let i = 0; i < R.length; i++) if (R[i] && R[i].key === key && R[i].landmarks && R[i].landmarks[lm]) return R[i].landmarks[lm];
    return null;
  }
  function podium() { return roomPoint("pressroom", "podium"); }
  function deskPt() { const O = CBZ.presidentOffice; try { return O && O.deskPoint ? O.deskPoint() : null; } catch (e) { return null; } }
  function whereSet() {
    const P = player(); if (!P || !P.pos) return "podium";
    const d = deskPt();
    if (d && Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < 4 && Math.abs((P.pos.y || 0) - (d.y || 0)) < 2.5) return "desk";
    return "podium";
  }
  function speak(line) {
    if (!line) return;
    if (CBZ.speech && CBZ.speech.lines && CBZ.player) { try { CBZ.speech.lines([{ by: CBZ.player, line: line, aloud: true }]); return; } catch (e) {} }
    if (CBZ.sayLines && CBZ.player) { try { CBZ.sayLines([{ by: CBZ.player, line: line, aloud: true }], null); } catch (e) {} }
  }
  function staffSay(ped, line) {
    if (!ped || !line) return;
    if (CBZ.citySay) { try { CBZ.citySay(ped, line, "#e8e2cf", 2.6); } catch (e) {} }
  }
  // begin(opts): the order has been given (presidency.js's address pad pays
  // for the airtime; the caller of press("address") ends up here)
  function begin(opts) {
    opts = opts || {};
    if (A.live) return { ok: false, why: "You are already on the air." };
    if (!seat() && !opts.force) return { ok: false, why: "Only the President takes the networks." };
    A.live = true; A.said = []; A.beat = 0; A.opts = null; A.phase = "intro"; A.waitT = 2.2; A.token++;
    A.set = opts.set || whereSet();
    A.startedAt = CLOCK; A.reason = opts.reason || null;
    A.staff = nearStaff();
    staffSay(A.staff, "Cameras are ready, sir.");
    const F = CBZ.flags;
    const N = CBZ.news;
    if (N && N.live) N.live({ kind: "address", who: presTitle(), set: A.set, flag: F && F.home ? F.home() : null, title: "Address to the nation", line: "" });
    S().count++;
    emit("address", { phase: "start", set: A.set, reason: A.reason });
    return { ok: true, set: A.set };
  }
  function showOptions() {
    A.opts = pickOptions(A.said, A.beat);
    A.phase = "choosing";
    const UI = CBZ.campaignUI;
    const tok = A.token, beat = A.beat;
    if (!UI || !UI.say) return;
    let pr = null;
    try { pr = UI.say(presTitle(), "", A.opts.map(function (s, i) { return { id: String(i), label: s.label }; }), { actor: CBZ.player }); } catch (e) { pr = null; }
    if (pr && pr.then) pr.then(function (v) {
      if (!A.live || A.token !== tok || A.beat !== beat || A.phase !== "choosing") return;
      if (v == null) { finish(true); return; }
      choose(+v);
    });
  }
  function choose(i) {
    if (!A.live || A.phase !== "choosing" || !A.opts) return null;
    const s = A.opts[i | 0];
    if (!s) return null;
    A.phase = "speaking";
    // picked by key, tap or from code: the reply buttons go either way
    if (CBZ.campaignUI && CBZ.campaignUI.clearDialogue) { try { CBZ.campaignUI.clearDialogue(); } catch (e) {} }
    if (s.verb === "end") { speak(s.line); setLine(s.line); A.waitT = 2.2; A.phase = "closing"; return s; }
    speak(s.line);
    setLine(s.line);
    // THE ACT
    const o = { target: s.target, by: "president", via: "address", ideology: myParty().id, institution: s.institution || null, event: s.event || null,
      place: s.place || null, order: s.order || null, line: s.line, headline: s.headline || null, rival: s.rival || null };
    const r = act(s.kind, o);
    const rec = { verb: s.verb, kind: s.kind, tid: s.tid, target: s.target, line: s.line, heat: s.heat, pleases: s.pleases, headline: s.headline, result: r, ok: r.ok !== false };
    A.said.push(rec);
    S().said.push({ verb: s.verb, tid: s.tid, day: day() });
    if (S().said.length > 30) S().said.shift();
    afterAct(s, r);
    react(s, r);
    emit("address-statement", { verb: s.verb, kind: s.kind, target: s.target ? s.target.id : null, line: s.line, result: r, beat: A.beat });
    A.beat++;
    A.waitT = BEAT_GAP;
    if (A.said.length >= MAX_SAID || s.verb === "resign" || s.verb === "concede") { A.phase = "closing"; A.waitT = 2.6; }
    return rec;
  }
  function setLine(line) { const N = CBZ.news; if (N && N.live) { try { N.live({ line: line }); } catch (e) {} } }
  // the acts that put bodies on the street or move the seat
  function afterAct(s, r) {
    if (r && r.ok === false) return;
    if (s.verb === "rally") rally(s.place, { stolen: A.said.some(function (x) { return x.verb === "stolen"; }) });
    if (s.verb === "ban" && s.target && s.target.kind === "party") opposition("ban", s.target.name);
    if (s.verb === "martial") opposition("martial", null);
    if (s.verb === "concede" && CBZ.transfer && CBZ.transfer.concede) { try { CBZ.transfer.concede("address"); } catch (e) {} }
    if (s.verb === "stolen" && CBZ.transfer && CBZ.transfer.claimStolen) { try { CBZ.transfer.claimStolen(); } catch (e) {} }
  }
  // CALL SUPPORTERS TO <PLACE>: a real crowd, out of the groups loyal to you
  function loyalGroups() {
    const me = myParty();
    const G = groups().filter(function (q) { return (q.loyalty || 0) >= 55 || q.party === me.id; });
    return G.length ? G : groups().slice(0, 2);
  }
  function crowdSize(G, stolen) {
    // souls: every loyal group sends a share of itself, more of it the more loyal
    const POP = 6000;          // the capital's reach on a day like this
    let n = 0;
    for (let i = 0; i < G.length; i++) n += (+G[i].share || 0.1) * POP * clamp(((G[i].loyalty || 50) - 40) / 60, 0.05, 1);
    return Math.round(clamp(n * (stolen ? 1.6 : 1), 40, 12000));
  }
  function slogansFor(stolen, side) {
    const sn = surname(playerName()).toUpperCase();
    if (side === "opposition") return ["NO KINGS", "RESPECT THE VOTE", "NOT MY PRESIDENT", "NO DICTATOR", "DEMOCRACY"];
    if (stolen) return ["STOP THE STEAL", (sn && sn.length <= 9 ? sn + " WON" : "WE WON"), "WE THE PEOPLE", "COUNT LEGAL VOTES", "TAKE IT BACK"];
    return ["FOUR MORE YEARS", (sn && sn.length <= 9 ? sn + " FOR US" : "WE STAND WITH YOU"), "WE STAND WITH YOU", "SAFE STREETS"];
  }
  function colorOf(p) {
    const c = p && p.color;
    if (typeof c === "number") return c;
    if (c === "red") return 0xb3262c; if (c === "blue") return 0x1f4fa8;
    if (typeof c === "string" && /^#?[0-9a-f]{6}$/i.test(c)) return parseInt(c.replace("#", ""), 16);
    return 0xb3262c;
  }
  function rally(placeId, o) {
    o = o || {};
    if (!CBZ.mob || !CBZ.mob.form) return null;
    const P = places().filter(function (p) { return p.id === placeId; })[0];
    if (!P || !P.at) return null;
    const me = myParty();
    const G = loyalGroups().map(function (q) { return { name: q.name, share: q.share, color: q.color != null ? q.color : colorOf(me), cap: q.party === me.id ? 0.6 : 0.25, shirt: q.party === me.id ? 0.35 : 0.15 }; });
    const stolen = !!o.stolen || !!(CBZ.transfer && CBZ.transfer.state && /refused|session/.test(CBZ.transfer.state().phase || ""));
    const size = crowdSize(loyalGroups(), stolen);
    const id = CBZ.mob.form({ at: P.at, face: P.face, size: size, side: "supporters", groups: G, slogans: slogansFor(stolen, "supporters"),
      flag: CBZ.flags && CBZ.flags.home ? CBZ.flags.home() : null, violent: stolen ? 0.55 : 0.1, anger: stolen ? 0.6 : 0.3,
      kind: stolen ? "march" : "rally", place: P.name,
      width: P.id === "capitol" ? 22 : 16 });
    if (!id) return null;
    S().lastRally = { id: id, place: P.id, day: day(), size: size };
    if (CBZ.transfer && CBZ.transfer.onRally) { try { CBZ.transfer.onRally(id, P.id, size); } catch (e) {} }
    else if (P.route) CBZ.mob.march(id, P.route, false);
    // a rally nobody marches is a few minutes of flags and chanting, then home
    later(240, function () {
      const T = CBZ.transfer && CBZ.transfer.state ? CBZ.transfer.state() : null;
      if (T && T.mob === id && !/done|idle/.test(T.phase)) return;
      if (CBZ.mob && CBZ.mob.stage(id) && CBZ.mob.stage(id) !== "breach" && CBZ.mob.stage(id) !== "inside") CBZ.mob.disperse(id, false);
    });
    return id;
  }
  // a ban or martial law brings the other side out to the Mansion gate
  function opposition(why, partyName) {
    if (!CBZ.mob || !CBZ.mob.form) return null;
    const P = places().filter(function (p) { return p.id === "mansion"; })[0];
    if (!P) return null;
    const rv = rivalParty();
    const G = groups().filter(function (q) { return (q.loyalty || 50) < 45 || (rv && q.party === rv.id); }).map(function (q) { return { name: q.name, share: q.share, color: q.color != null ? q.color : colorOf(rv), cap: 0.2, shirt: 0.3 }; });
    const size = Math.round(clamp((100 - approval()) * 30, 60, 6000));
    const sl = slogansFor(false, "opposition");
    if (why === "ban" && partyName) sl.unshift(("UNBAN THE " + polName(partyName).toUpperCase()).slice(0, 22));
    const id = CBZ.mob.form({ at: P.at, face: P.face, size: size, side: "opposition", groups: G.length ? G : [{ color: colorOf(rv), share: 1 }], slogans: sl,
      violent: 0.08, anger: 0.55, kind: "protest", place: "the Mansion", hold: true });
    // a night of it, then home (a few minutes of play)
    if (id) later(220, function () { if (CBZ.mob && CBZ.mob.stage(id)) CBZ.mob.disperse(id, false); });
    return id;
  }

  // ---- THE COUNTRY WATCHES: the people at the sets, the crowds outside
  function leanOf(p) {
    const P = Pol();
    if (P && typeof P.ideologyOf === "function") { try { const v = P.ideologyOf(p); if (isFinite(v)) return v; } catch (e) {} }
    if (P && typeof P.groupOf === "function") {
      try { const q = P.groupOf(p); if (q && isFinite(q.loyalty)) return (q.loyalty - 50) / 50; } catch (e) {}
    }
    // fallback: the country's split is the approval rating, person by person
    const id = p.id != null ? p.id : hashStr(p.name || "");
    return h01(id | 0, 77, 31) < approval() / 100 ? 0.6 : -0.6;
  }
  const CHEER = ["Yes!", "That's right!", "Finally!", "Tell them!", "About time."];
  const BOO = ["Boo!", "Liar!", "Unbelievable.", "Turn it off.", "Shame!"];
  function react(s, r) {
    const N = CBZ.news;
    const scr = N && N.screens ? N.screens() : [];
    const peds = CBZ.cityPeds || [];
    const B = CBZ.cityBrain;
    const props = CBZ.presidentPublic && CBZ.presidentPublic.props;
    let watchers = 0, cheered = 0, booed = 0;
    for (let k = 0; k < scr.length; k++) {
      const sc = scr[k];
      let here = 0;
      for (let i = 0; i < peds.length && here < 8; i++) {
        const p = peds[i];
        if (!p || p.dead || !p.pos || p.controlled || p._mob || p._presStaff || p.state === "flee") continue;
        if (Math.abs((p.pos.y || 0) - sc.y) > 4) continue;
        const dx = p.pos.x - sc.x, dz = p.pos.z - sc.z;
        if (dx * dx + dz * dz > WATCH_R * WATCH_R) continue;
        here++; watchers++;
        const lean = leanOf(p);
        const pleased = s.pleases === "all" ? true : s.pleases === "none" ? false : s.pleases === "mine" ? lean > 0 : lean < 0;
        if (B && B.perform) { try { B.perform(p, "cheer", { x: sc.x, z: sc.z }); } catch (e) {} }
        if (pleased) { cheered++; if (props && props.pose && (s.heat >= 3 || here <= 2)) { try { props.pose(p, "pubCheer"); p._addrPoseT = CLOCK + 2.6; POSED.push(p); } catch (e) {} } }
        else booed++;
        if (here <= 2 || s.heat >= 4) {
          const line = pleased ? CHEER[(hashStr(p.name) + A.beat) % CHEER.length] : BOO[(hashStr(p.name) + A.beat) % BOO.length];
          setTimeout(function () { if (CBZ.citySay && !p.dead) { try { CBZ.citySay(p, line, pleased ? "#cfe3ff" : "#ffb4a8", 2.2); } catch (e) {} } }, 300 + (here * 350));
        }
      }
      // a room full of people round one set: it erupts
      if (here >= 4 && CBZ.crowdVoiceAt) {
        try { CBZ.crowdVoiceAt(sc.x, sc.z, { y: sc.y, cheer: cheered > booed ? 0.85 : 0.3, boo: booed >= cheered ? 0.85 : 0.2, size: here * 4, force: true }); } catch (e) {}
      }
    }
    // the crowds already out: the mobs and the Mansion's speech crowd
    if (CBZ.mob && CBZ.mob.react) { try { CBZ.mob.react(s.pleases === "theirs" ? "boo" : s.heat >= 4 ? "roar" : "cheer"); } catch (e) {} }
    if (CBZ.presidentPublic && CBZ.presidentPublic.react) { try { CBZ.presidentPublic.react(s.pleases === "theirs" || s.pleases === "none" ? "boo" : "cheer"); } catch (e) {} }
    A.watchers = (A.watchers | 0) + watchers;
    return watchers;
  }
  const POSED = [];
  function tickPoses() {
    const props = CBZ.presidentPublic && CBZ.presidentPublic.props;
    for (let i = POSED.length - 1; i >= 0; i--) {
      const p = POSED[i];
      if (p.dead || CLOCK >= (p._addrPoseT || 0)) { if (!p.dead && props && props.pose) { try { props.pose(p, null); } catch (e) {} } POSED.splice(i, 1); }
    }
  }
  function finish(cut) {
    if (!A.live) return null;
    A.live = false; A.phase = null; A.opts = null;
    const N = CBZ.news;
    if (N && N.live) { try { N.live(null); } catch (e) {} }
    if (CBZ.campaignUI && CBZ.campaignUI.clearDialogue) { try { CBZ.campaignUI.clearDialogue(); } catch (e) {} }
    // the reaction: the hottest thing said is the story
    let top = null;
    for (let i = 0; i < A.said.length; i++) if (!top || (A.said[i].heat || 0) > (top.heat || 0)) top = A.said[i];
    const headline = cut && !A.said.length ? "The President walks off the air" : top ? top.headline : "The President addresses the nation";
    const breaking = !!(top && top.heat >= 4);
    news(headline, { kind: breaking ? "breaking" : "story", cat: "NATION", look: "politics", key: "addr:" + S().count, hold: 600, phone: breaking,
      sub: A.said.length > 1 ? A.said.length + " statements, live on every network" : "" });
    const holler = [{ kind: "press", text: headline + "." }];
    if (top) {
      const mine = top.pleases === "mine", theirs = top.pleases === "theirs";
      holler.push({ kind: "citizen", text: mine ? "Finally a President who says it out loud." : theirs ? "Didn't think I'd ever hear him say that." : "Did everyone just see that?" });
      holler.push({ kind: "citizen", text: mine ? "This is how a democracy dies. On live TV." : theirs ? "Too little, too late." : "My whole bar went silent." });
      if (top.verb === "threaten" && top.target && top.target.id) holler.push({ kind: "leader", cid: top.target.id, text: "We heard the President. We are not afraid." });
      if (top.verb === "ban") holler.push({ kind: "citizen", text: "I've voted " + (rivalParty() ? rivalParty().short : "the other way") + " my whole life. Am I a criminal now?" });
    }
    emit("address", { phase: "end", set: A.set, said: A.said.map(function (x) { return { verb: x.verb, kind: x.kind, target: x.target ? x.target.id : null, ok: x.ok }; }), headline: headline, breaking: breaking, holler: holler, cut: !!cut });
    A.last = { said: A.said.slice(), headline: headline, at: CLOCK };
    S().last = { headline: headline, day: day(), n: A.said.length };
    return A.last;
  }
  // remember the orders given, so an apology has something to be about
  let busWired = false;
  function wireBus() {
    if (busWired) return;
    const p = Pz(); if (!p || !p.on) return;
    busWired = true;
    try {
      p.on("order", function (e) {
        if (!e || !e.ok || !e.key || e.key === "address") return;
        const s = S(); s.orders.push(e.key); if (s.orders.length > 12) s.orders.shift();
      });
    } catch (e) {}
  }

  // ---- THE VERB ON THE LECTERN AND ON THE DESK
  let zonesWired = false;
  function wireZones() {
    if (zonesWired || !CBZ.interactions || !CBZ.interactions.registerZone) return;
    zonesWired = true;
    const I = CBZ.interactions;
    const go = function () {
      const r = press("address");
      if (r && r.ok === false && r.why) {
        const ped = nearStaff();
        if (ped) staffSay(ped, r.why);
        else if (CBZ.campaignUI && CBZ.campaignUI.say) { try { CBZ.campaignUI.say("Press Secretary", r.why, [], { phone: true }); } catch (e) {} }
      }
    };
    I.registerZone({
      id: "address-podium", kind: "addresspodium", radius: 1.6, prio: 17,
      find: function (px, pz) {
        if (A.live || !seat()) return null;
        const q = podium(), P = player();
        if (!q || !P || !P.pos || Math.abs((P.pos.y || 0) - q.y) > 1.4) return null;
        return Math.hypot(q.x - px, q.z - pz) < 1.6 ? { x: q.x, y: q.y, z: q.z, kind: "addresspodium" } : null;
      },
      options: [{ id: "address-podium-go", slot: "e", label: "Address the nation", onSelect: go }],
    });
    I.registerZone({
      id: "address-desk", kind: "addressdesk", radius: 1.8, prio: 8,
      find: function (px, pz) {
        if (A.live || !seat()) return null;
        const q = deskPt(), P = player();
        if (!q || !P || !P.pos || Math.abs((P.pos.y || 0) - (q.y || 0)) > 1.6) return null;
        return Math.hypot(q.x - px, q.z - pz) < 1.8 ? { x: q.x, y: q.y, z: q.z, kind: "addressdesk" } : null;
      },
      options: [{ id: "address-desk-go", label: "Address the nation", onSelect: go }],
    });
  }

  // ---- THE FRAME
  function tick(dt) {
    dt = Math.min(0.25, Math.max(0, dt || 0));
    CLOCK += dt;
    wireBus(); wireZones();
    for (let i = LATER.length - 1; i >= 0; i--) if (CLOCK >= LATER[i].t) { const f = LATER[i].fn; LATER.splice(i, 1); try { f(); } catch (e) {} }
    if (POSED.length) tickPoses();
    if (!A.live) return;
    // the seat went (resigned, removed): the feed cuts
    if (!seat() && A.phase !== "closing") { finish(true); return; }
    if (A.phase === "choosing") return;
    A.waitT -= dt;
    if (A.waitT > 0) return;
    if (A.phase === "closing") { finish(false); return; }
    if (A.phase === "intro") { speak("My fellow citizens."); setLine("My fellow citizens."); A.phase = "opening"; A.waitT = 2.0; return; }
    showOptions();
  }
  if (CBZ.onUpdate) CBZ.onUpdate(38.794, tick);

  CBZ.address = {
    begin: begin,
    choose: function (i) { return choose(i); },
    options: function () { return A.opts ? A.opts.map(function (s) { return { verb: s.verb, label: s.label, line: s.line, target: s.target ? s.target.id : null, kind: s.kind || null }; }) : null; },
    // the harness and touch pick by verb+target when the order on screen is not known
    pick: function (verb, tid) {
      if (!A.opts) return null;
      for (let i = 0; i < A.opts.length; i++) {
        const s = A.opts[i];
        if (s.verb === verb && (tid == null || s.tid === tid || (s.target && s.target.id === tid))) return choose(i);
      }
      return null;
    },
    // force a statement into the running address (its verb need not be among the four on screen)
    say: function (verb, tid) {
      if (!A.live) return null;
      const all = statements({ said: A.said });
      for (let i = 0; i < all.length; i++) {
        const s = all[i];
        if (s.verb === verb && (tid == null || s.tid === tid || (s.target && s.target.id === tid))) { A.opts = [s]; A.phase = "choosing"; return choose(0); }
      }
      return null;
    },
    end: function () { return finish(true); },
    live: function () { return A.live ? { set: A.set, phase: A.phase, said: A.said.length, beat: A.beat } : null; },
    statements: statements,
    act: act,
    model: model,
    places: places,
    parties: parties,
    groups: groups,
    institutions: institutions,
    myParty: myParty,
    rivalParty: rivalParty,
    rally: rally,
    audit: function () {
      return { live: !!A.live, phase: A.phase, said: A.said.length, count: S().count, last: S().last, watchers: A.watchers | 0,
        politics: !!(Pol() && Pol().act), myParty: myParty().id, banned: Object.keys((politicsRec() && politicsRec().banned) || {}) };
    },
    _tick: tick, _state: function () { return A; },
  };
})();
