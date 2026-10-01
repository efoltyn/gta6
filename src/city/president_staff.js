/* ============================================================
   city/president_staff.js — THE PRESIDENT'S PEOPLE.

   OWNER (2026-10-01): "interaction is dumb. This whole hire and fire thing."

   What it was: a line of job-seekers queued in the Oval Office, each said a
   slogan, E hired him, "Send away" brought the same job back 45 s later with
   a new name. Firing was an order to the Chief of Staff about whoever you
   pointed at. Hiring cost nothing, firing changed nothing, and the Treasury
   Secretary (no body) could not be fired at all. All of that is deleted.

   HOW A PRESIDENCY WORKS NOW:
     • THE OFFICE COMES STAFFED. Day one: the full Secret Service detail
       (protection.js PRES_BASE; the service replaces a fallen agent on its
       own), a driver at the state car, the press secretary at her desk, and
       the cabinet presidency.js minted.
     • DISMISS IS ON THE PERSON. Q on the General / Director / Commissioner
       at the Situation Room table, on the press secretary, on the Chief of
       Staff: "Dismiss". Two lines over heads ("You're done, Brandt." /
       "You'll regret this, sir.") and he walks. Anyone not in the room
       (the Treasury Secretary has no body): the phone's Calls contact, from
       the pocket or from the desk phone's Dial, "I need your resignation".
     • IT COSTS SOMETHING, BY WHO IT IS:
         every post  a NEWS ONE story ("<title> <name> resigns" / "fired"),
                     an approval and scandal hit, and the person stays in the
                     world: a critic on Holler, a leak, or an enemy.
         General     readiness drops for days. Low loyalty or a dictatorship
                     and he plots: dissent.js's army climbs and HE is the
                     junta's man if the coup lands (civilwar.coup plotter).
                     A loyal man leaving calms the army (dissent.relieved).
         Director    the Bureau's running investigation stops.
         Press Sec   a story, and a leak if she knew too much.
     • A CHAIR IS FILLED BY A CHOICE, NOT A QUEUE. The Chief of Staff (or the
       phone, when you are out) has two names: "Two names for General.
       Okafor is loyal. Reyes is good." E takes the first, Q the second.
         loyal       loyalty 85 that never sinks under 50: fewer refusals
                     (statecraft's band leans his way), no coup risk, but
                     weaker results.
         good        better results (readiness, revenue, raids, the street),
                     but loyalty 55 and a grudge that grows every day.
       In a republic the Senate confirms cabinet picks; a crony at low
       approval can be voted down and it is on the news.
     • AN EMPTY CHAIR HURTS until it is filled: no General = readiness bleeds
       and martial law has nobody to give it to; no Director = no raids; no
       Commissioner = the street sours; no Treasury = the books leak; no
       Chief = nobody screens, folders do not get made; no press secretary =
       scandals go unanswered.
     • THE CHIEF'S STYLE decides what reaches your desk (president_office.js
       offer()): a loyal Chief screens (two folders at most, no calls from a
       sour officer); a good one lets everything through and tells you who
       is unhappy.
     • REFUSALS ARE REMEMBERED. Every "no" to an officer (Situation Room,
       desk phone, a folder sent back) is a "decision" on the presidency bus;
       his loyalty drops, and the General's loyalty feeds the army ladder.
     • THE PRESS SECRETARY IS NOT A BUTTON. When the scandal climbs she goes
       to the cameras by herself, once a day. Each briefing spends her
       credibility; after repeated scandals they barely move it.

   PUBLIC: CBZ.presidentStaff = { vacant, person, dismiss, nominee, pick,
     obedience, edge, armyLean, plotter, chiefStyle, chiefWarning, wire,
     audit } + _daily / _tick / _state (tests).
   Bus (CBZ.presidency.emit): "dismissal" {role, name, office, how, headline,
     sub, breaking}, "appointment" {role, name, headline}, "former" {kind,
     name, office, text, headline?}.
   Saved: CBZ.presidency.staff() (inside the presidency's own save).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.presidentStaff) return;
  const g = CBZ.game || (CBZ.game = {});

  const NEAR_R = 30;            // m from the desk: the office's people are posted while you are this close
  const BRIEF_AT = 25;          // scandal at which the press secretary goes to the cameras
  const RING_AGAIN = 120;       // s before a missed nomination call rings again

  const CABINET = ["chief", "general", "bureau", "police", "treasury"];
  const POSTS = CABINET.concat(["press"]);
  const TITLE = { chief: "Chief of Staff", general: "General", bureau: "Bureau Director", police: "Police Commissioner", treasury: "Treasury Secretary", press: "Press Secretary" };
  const FOR = { chief: "Chief of Staff", general: "General", bureau: "the Bureau", police: "Commissioner", treasury: "Treasury", press: "Press Secretary" };
  const JOB = {
    chief: { job: "chief of staff", archetype: "professional" },
    press: { job: "press secretary", archetype: "professional" },
  };
  const NEEDS_SENATE = { general: 1, bureau: 1, police: 1, treasury: 1 };

  let CLOCK = 0;
  const OUT = [];               // people walking out: { ped, t, door, max }
  const W = { chief: null, press: null, driver: null, ringAt: -1e9, greeted: null };

  // ---- seams --------------------------------------------------------------
  function Pz() { return CBZ.presidency || null; }
  function seat() { const p = Pz(); if (!p || typeof p.seat !== "function") return null; try { return p.seat(); } catch (e) { return null; } }
  function S() { const p = Pz(); return p && p.staff ? p.staff() : (g._presStaffStub || (g._presStaffStub = {})); }
  function day() { try { return CBZ.worldDay ? (CBZ.worldDay() | 0) : 0; } catch (e) { return 0; } }
  function playing() { return g.mode === "city" && g.state === "playing"; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function surname(n) { const a = String(n || "").trim().split(/\s+/); return a[a.length - 1] || String(n || ""); }
  function hash(s) { s = String(s); let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function h01(s) { return (hash(s) % 10007) / 10007; }
  function emit(evt, payload) { const p = Pz(); if (p && p.emit) { try { p.emit(evt, payload); } catch (e) {} } }
  function politics() { const w = CBZ.cityWorldEnsure ? CBZ.cityWorldEnsure() : null; return (w && w.politics) || g.cityPolitics || null; }
  function shock(n) { const h = seat(); if (h && CBZ.approvalShock) { try { CBZ.approvalShock(h.id, n); } catch (e) {} } }
  function scandal(n) { const pol = politics(); if (pol) pol.scandal = clamp((+pol.scandal || 0) + n, 0, 100); }
  function military() { const h = seat(), Wp = CBZ.polwar; try { return h && Wp && Wp.militaryOf ? Wp.militaryOf(h.id) : null; } catch (e) { return null; } }
  // a nudge never lifts a weak army up to the floor, it only stops a fall there
  function readiness(d, floor) {
    const m = military();
    if (!d || !m || !isFinite(m.readiness)) return;
    const f = floor == null ? 0.05 : floor;
    m.readiness = d < 0 ? Math.max(Math.min(m.readiness, f), m.readiness + d) : Math.min(1, m.readiness + d);
  }
  function authoritarian() { const h = seat(); return !!(h && h.rec && /dictator|fascis|junta|monarch|communis/.test(String(h.rec.govType || ""))); }
  function say(p, line, secs) { if (CBZ.citySay && p && p.group && !p.dead) { try { CBZ.citySay(p, line, "#e8e2cf", secs || 2.6); } catch (e) {} } }
  function cab() { const p = Pz(); try { return p && p.cabinet ? p.cabinet() || {} : {}; } catch (e) { return {}; } }
  // the live cabinet record (loyalty, trait, refused live there; presidency.js saves it)
  function rec(role) {
    if (role === "press") return S().press || null;
    const p = Pz();
    if (p && p.cabinetRecord) { try { return p.cabinetRecord(role); } catch (e) { return null; } }
    return null;
  }

  // ---- who sits where ---------------------------------------------------------
  function vacant(role) {
    if (role === "press") return !S().press;
    const c = cab()[role];
    return !c || !!c.dead;
  }
  function person(role) {
    if (role === "press") { const p = S().press; return p ? { name: p.name, gender: p.gender || "f", display: p.name, sid: p.sid || null } : null; }
    const c = cab()[role];
    return c && !c.dead ? { name: c.name, gender: c.gender, display: c.display || c.name, sid: c.sid } : null;
  }
  function loyaltyOf(role) { const r = rec(role); return r && isFinite(r.loyalty) ? +r.loyalty : 60; }
  function traitOf(role) { const r = rec(role); return r ? r.trait || null : null; }

  // ---- names: real ledger people ----------------------------------------------
  const FALLBACK_F = ["Ruth", "Elena", "Irene", "Nadia", "Clara", "Vera", "Miriam", "Helen"];
  const FALLBACK_M = ["Marcus", "Victor", "Daniel", "Tomas", "Adrian", "Simon", "Leon", "Oscar"];
  const FALLBACK_L = ["Okafor", "Reyes", "Lindqvist", "Moreau", "Castell", "Whitlock", "Serrano", "Adair", "Kovac", "Ashford", "Maddox", "Novak"];
  function mint(key, gender, job) {
    let rng = null;
    if (CBZ.seedStream) { try { rng = CBZ.seedStream("presstaff:" + key); } catch (e) { rng = null; } }
    if (!rng) { let x = hash(key) || 7; rng = function () { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }
    if (!gender) gender = rng() < 0.62 ? "m" : "f";
    let name = null;
    if (CBZ.cityMintName) { try { name = CBZ.cityMintName(rng, gender); } catch (e) { name = null; } }
    if (!name) name = (gender === "f" ? FALLBACK_F : FALLBACK_M)[(rng() * 8) | 0] + " " + FALLBACK_L[(rng() * FALLBACK_L.length) | 0];
    const obj = { _parked: true, nameKnown: true, kind: "civilian", archetype: "professional", name: name, gender: gender, job: job || "civil servant", wealth: 0.7, aggr: 0.2, cash: 300 };
    if (CBZ.cityPedStash) { try { CBZ.cityPedStash(obj); } catch (e) {} }
    return { name: name, gender: gender, sid: obj._sid || null };
  }

  // ---- DAY ONE: the office is staffed ------------------------------------------
  function ensureStaffed() {
    const s = S();
    if (s.staffed) return;
    s.staffed = true;
    if (!s.press) { const m = mint("press:" + (seat() ? seat().id : "x"), "f", "press secretary"); s.press = { name: m.name, gender: "f", sid: m.sid, day: day(), loyalty: 70, cred: 1, briefs: 0 }; }
    if (!s.driver) { const m = mint("driver:" + (seat() ? seat().id : "x"), "m", "chauffeur"); s.driver = { name: m.name, gender: "m", sid: m.sid }; }
    s.former = s.former || [];
    // the old job-line save fields mean nothing now
    delete s.agents; delete s.nextFor;
  }

  // ================================================================
  //  DISMISS
  // ================================================================
  const PLAYER_LINES = ["You're done, ", "Clear your desk, "];
  function replyLine(role, loyalty, how) {
    if (loyalty < 35) return role === "general" ? "You'll regret this, sir." : "You'll regret this.";
    if (loyalty < 55) return "As you wish.";
    return how === "phone" ? "You'll have it today, sir." : "It was an honour, sir.";
  }
  function dismiss(role, opts) {
    opts = opts || {};
    const h = seat();
    if (!h) return { ok: false, why: "You do not hold the country." };
    if (POSTS.indexOf(role) < 0) return { ok: false, why: "" };
    ensureStaffed();
    const who = person(role);
    if (!who) return { ok: false, why: "That chair is already empty." };
    const s = S(), r = rec(role) || {};
    const loyalty = isFinite(r.loyalty) ? +r.loyalty : 60;
    const trait = r.trait || null;
    const via = opts.via || "phone";
    // RESIGNS or FIRED: a man who still likes you goes quietly
    const how = loyalty >= 55 ? "resigns" : "fired";
    const line = replyLine(role, loyalty, via);
    const out = { ok: true, line: line, role: role, name: who.name, how: how };

    // the chair empties
    let body = null;
    if (role === "press") { s.press = null; body = W.press; W.press = null; }
    else {
      const p = Pz();
      if (p && p.vacateCabinet) { try { body = p.vacateCabinet(role, { keep: !!opts.ped }); } catch (e) { body = null; } }
      if (role === "chief") { body = W.chief; W.chief = null; }
    }
    if (body && typeof body === "object" && body.pos) {
      body._iopts = null;
      const delay = via === "face" ? 3.6 : 0;
      OUT.push({ ped: body, t: -delay, door: role === "chief" || role === "press" ? doorSpot() : null, max: role === "chief" || role === "press" ? 14 : 1.5 });
    }

    // THE PERSON STAYS IN THE WORLD
    const grudge = clamp(100 - loyalty + (trait === "able" ? 15 : 0) + (how === "fired" ? 10 : 0), 0, 100);
    const F = { role: role, office: TITLE[role], name: who.name, sid: who.sid || null, gender: who.gender || "m", day: day(), loyalty: loyalty,
      grudge: grudge, acts: 0, next: day() + 1, plotting: false, leak: false };
    s.former = s.former || [];
    s.former.push(F);
    if (s.former.length > 12) s.former.shift();

    // THE COST
    const sub = { general: "The army waits for a new commander", bureau: "The Bureau's investigation is shut down", police: "The force is without a chief",
      treasury: "Markets wait for a new Secretary", press: "The briefing room is empty", chief: "The West Wing is without a Chief of Staff" }[role];
    shock(role === "general" ? -2 : -1);
    scandal(how === "fired" ? 3 : 1);
    if (role === "general") {
      readiness(-0.12);
      s.shake = s.shake || {};
      s.shake.general = day() + 3;                     // readiness keeps bleeding for three days
      const D = CBZ.dissent;
      if (loyalty < 35 || authoritarian()) {
        // HE TAKES OFFICERS WITH HIM
        F.plotting = true; F.grudge = Math.max(F.grudge, 70);
        if (D && D.plot) { try { D.plot({ name: who.name, sid: who.sid || null }); } catch (e) {} }
      } else if (D && D.relieved) { try { D.relieved(); } catch (e) {} }
    } else if (role === "bureau") {
      const p = Pz();
      if (p && p.bureauStop) { try { p.bureauStop(); } catch (e) {} }
    } else if (role === "press") {
      // she knew what was said in this building
      const pr = r;
      if ((pr.cred != null && pr.cred < 0.7) || (pr.briefs | 0) >= 3 || loyalty < 45) { F.leak = true; F.next = day() + 1; }
      scandal(2);
    }
    if (s.nominee && s.nominee.role === role) s.nominee = null;
    s.retry = s.retry || {};
    s.retry[role] = day();                             // the Chief has names by tomorrow at the latest
    W.ringAt = CLOCK + 18;                             // ...and usually within the minute

    emit("dismissal", {
      role: role, name: who.name, office: TITLE[role], how: how, loyalty: loyalty,
      headline: TITLE[role] + " " + who.name + (how === "resigns" ? " resigns" : " fired"),
      sub: sub, breaking: role === "general", via: via,
    });
    return out;
  }
  // face to face: two lines over heads, then he walks
  function dismissFace(role, ped) {
    const who = person(role);
    if (!who) return null;
    const r = dismiss(role, { via: "face", ped: ped });
    if (!r.ok) return r;
    const mine = PLAYER_LINES[hash(role + who.name) % 2] + surname(who.name) + ".";
    if (CBZ.sayLines) { try { CBZ.sayLines([{ by: CBZ.player, line: mine, aloud: true }, { by: ped, line: r.line }], null); } catch (e) {} }
    else say(ped, r.line, 3);
    return r;
  }
  function wire(p, role) {
    if (!p || !CBZ.interactions || !CBZ.interactions.registerFor) return;
    CBZ.interactions.registerFor(p, { id: "pres-dismiss-" + role, prio: 6, campaignSafe: true, forceYes: true,
      label: "Dismiss", canShow: function () { return !!seat() && !p.dead && !vacant(role); },
      onSelect: function () { dismissFace(role, p); } });
  }

  // ================================================================
  //  TWO NAMES
  // ================================================================
  function speakerFor(role) {
    if (role !== "chief" && !vacant("chief")) { const c = person("chief"); return { name: c.name, role: "Chief of Staff", body: W.chief && !W.chief.dead ? W.chief : null }; }
    const vp = cab().vp;
    if (vp && vp.name) return { name: vp.display || vp.name, role: "Vice President", body: null };
    const pr = person("press");
    if (pr) return { name: pr.name, role: "Press Secretary", body: W.press && !W.press.dead ? W.press : null };
    return null;
  }
  function nominate(role) {
    const s = S();
    const n = (s.nominations = (s.nominations | 0) + 1);
    const gender = role === "press" ? "f" : null;
    const a = mint("nom:" + role + ":" + day() + ":" + n + ":a", gender, (JOB[role] && JOB[role].job) || TITLE[role].toLowerCase());
    let b = mint("nom:" + role + ":" + day() + ":" + n + ":b", gender, (JOB[role] && JOB[role].job) || TITLE[role].toLowerCase());
    if (surname(b.name) === surname(a.name)) b = mint("nom:" + role + ":" + day() + ":" + n + ":c", gender, TITLE[role].toLowerCase());
    s.nominee = { role: role, day: day(), names: [Object.assign({ trait: "loyal" }, a), Object.assign({ trait: "able" }, b)] };
    W.greeted = null;
    return s.nominee;
  }
  function nomineeLine(nm) {
    return "Two names for " + FOR[nm.role] + ". " + surname(nm.names[0].name) + " is loyal. " + surname(nm.names[1].name) + " is good.";
  }
  function senateSays(role, cand) {
    if (!NEEDS_SENATE[role] || authoritarian()) return true;
    const h = seat(), ap = h && h.rec && h.rec.approval != null ? +h.rec.approval : 50;
    const pFail = cand.trait === "loyal" ? (ap < 40 ? 0.45 : 0.15) : (ap < 30 ? 0.25 : 0.05);
    return h01("senate:" + role + ":" + cand.name + ":" + day()) >= pFail;
  }
  function pick(i) {
    const s = S(), nm = s.nominee;
    if (!nm || !seat()) return { ok: false, why: "That's settled, sir." };
    const c = nm.names[i ? 1 : 0];
    const role = nm.role;
    s.nominee = null;
    if (!senateSays(role, c)) {
      s.retry = s.retry || {};
      s.retry[role] = day() + 1;
      scandal(2);
      emit("appointment", { role: role, name: c.name, ok: false, headline: "Senate rejects " + c.name + " for " + TITLE[role] });
      return { ok: true, line: "The Senate voted " + surname(c.name) + " down. I'll have names tomorrow.", rejected: true };
    }
    const loyal = c.trait === "loyal";
    const who = { name: c.name, gender: c.gender, sid: c.sid, trait: c.trait, loyalty: loyal ? 85 : 55 };
    if (role === "press") s.press = { name: c.name, gender: "f", sid: c.sid, day: day(), trait: c.trait, loyalty: who.loyalty, cred: loyal ? 0.8 : 1.1, briefs: 0 };
    else { const p = Pz(); if (p && p.fillCabinet) p.fillCabinet(role, who); }
    if (s.retry) delete s.retry[role];
    emit("appointment", { role: role, name: c.name, ok: true, trait: c.trait,
      headline: c.name + (NEEDS_SENATE[role] && !authoritarian() ? " confirmed as " : " named ") + TITLE[role] });
    return { ok: true, line: loyal ? "I'll tell " + surname(c.name) + "." : surname(c.name) + " it is.", role: role, name: c.name };
  }
  // the next empty chair gets names (one at a time)
  function needNames() {
    const s = S();
    if (s.nominee || !seat()) return;
    const retry = s.retry || {};
    // the Chief's own chair first: nobody else brings names reliably without him
    const order = ["chief", "general", "bureau", "police", "treasury", "press"];
    for (let i = 0; i < order.length; i++) {
      const role = order[i];
      if (!vacant(role)) continue;
      if (retry[role] != null && retry[role] > day()) continue;
      nominate(role);
      return;
    }
  }
  // out of the office the names come by phone (phone_apps.js's own ring)
  function ringNames() {
    const s = S(), nm = s.nominee, A = CBZ.phoneApps;
    if (!nm || !A || !A.ring || CLOCK < W.ringAt) return;
    const sp = speakerFor(nm.role);
    if (!sp) return;
    W.ringAt = CLOCK + RING_AGAIN;
    const tag = nm.role + ":" + nm.day + ":" + nm.names[0].name;
    A.ring({ key: "names:" + tag, id: "names:" + nm.role, name: sp.name, role: sp.role, line: nomineeLine(nm),
      choices: [
        { id: "a", label: surname(nm.names[0].name), run: function () { return S().nominee === nm ? pick(0) : { ok: false, why: "That's settled, sir." }; } },
        { id: "b", label: surname(nm.names[1].name), run: function () { return S().nominee === nm ? pick(1) : { ok: false, why: "That's settled, sir." }; } },
      ] });
  }

  // ================================================================
  //  WHAT LOYALTY AND TALENT DO
  // ================================================================
  // statecraft's legitimacy band leans toward an officer who wants to obey
  function obedience(role) {
    if (vacant(role)) return 0;
    if (traitOf(role) === "loyal") return 0.12;
    return loyaltyOf(role) < 35 ? -0.1 : 0;
  }
  // how much better (or worse) the post's results are
  function edge(role) { if (vacant(role)) return 0; const t = traitOf(role); return t === "able" ? 0.12 : t === "loyal" ? -0.08 : 0; }
  // the General's loyalty on dissent.js's army ladder (per day)
  function armyLean() {
    if (vacant("general")) return { add: 0, cap: null };
    if (traitOf("general") === "loyal") return { add: -3, cap: 79 };
    const l = loyaltyOf("general");
    return { add: l < 40 ? (40 - l) * 0.3 : 0, cap: null };
  }
  function plotter() {
    const f = S().former || [];
    for (let i = f.length - 1; i >= 0; i--) if (f[i].plotting) return { name: f[i].name, sid: f[i].sid };
    return null;
  }
  function chiefStyle() {
    if (vacant("chief")) return "none";
    const t = traitOf("chief");
    return t === "loyal" ? "screen" : t === "able" ? "open" : "normal";
  }
  // an open-door Chief tells you who is unhappy
  function chiefWarning() {
    if (chiefStyle() !== "open") return "";
    const c = cab();
    for (const role of ["general", "bureau", "police", "treasury"]) {
      if (vacant(role)) continue;
      if (loyaltyOf(role) < 35) return (c[role].display || c[role].name) + " is unhappy, sir.";
    }
    return "";
  }

  // REFUSALS: every "no" to an officer (bus "decision") costs his loyalty
  function roleByName(name) {
    if (!name) return null;
    const c = cab();
    for (let i = 0; i < CABINET.length; i++) { const r = c[CABINET[i]]; if (r && !r.dead && (r.name === name || r.display === name)) return CABINET[i]; }
    const p = S().press;
    return p && p.name === name ? "press" : null;
  }
  function refused(role) {
    const r = rec(role);
    if (!r) return;
    r.refused = (r.refused | 0) + 1;
    const cost = r.trait === "able" ? 9 : r.trait === "loyal" ? 3 : 6;
    const floor = r.trait === "loyal" ? 50 : 0;
    r.loyalty = clamp((isFinite(r.loyalty) ? +r.loyalty : 60) - cost, floor, 100);
  }
  function onBus(evt, d) {
    if (evt !== "decision" || !d || d.choice !== "no") return;
    const role = roleByName(d.who);
    if (role) refused(role);
  }
  let hooked = false;
  function hook() {
    if (hooked) return;
    const p = Pz();
    if (!p || typeof p.on !== "function") return;
    hooked = true;
    try { p.on("*", function (payload, evt) { try { onBus(String(evt || ""), payload); } catch (e) {} }); } catch (e) {}
  }

  // ================================================================
  //  THE PRESS SECRETARY: consequences, not a button
  // ================================================================
  function brief() {
    const s = S(), pol = politics(), pr = s.press;
    if (!pr || !pol || s.pressDay === day()) return false;
    const before = +pol.scandal || 0;
    if (before < BRIEF_AT) return false;
    s.pressDay = day();
    const cred = clamp(pr.cred == null ? 1 : +pr.cred, 0.2, 1.2);
    const cut = Math.round(6 * cred * 10) / 10;
    pol.scandal = Math.max(0, before - cut);
    pr.briefs = (pr.briefs | 0) + 1;
    pr.cred = clamp(cred * (before >= 40 ? 0.78 : 0.88), 0.2, 1.2);   // every bad week spends her
    if (W.press) say(W.press, cred < 0.5 ? "They aren't listening any more." : "I'll handle them.", 2.4);
    emit("briefing", { name: pr.name, cut: cut,
      headline: cred < 0.5 ? "Briefing goes badly for " + pr.name : "White House briefing: " + pr.name + " takes questions",
      sub: cred < 0.5 ? "Reporters aren't buying it" : "\"The President is focused on the country.\"" });
    return true;
  }

  // ================================================================
  //  THE DAY
  // ================================================================
  const CRITIC = {
    general: ["He has never worn a uniform and it shows.", "I told him the truth. That's why I'm gone."],
    bureau: ["We were close. Ask him why he stopped us.", "Some files don't stay closed."],
    police: ["Watch the crime numbers this month.", "He wanted headlines, not police."],
    treasury: ["Ask him where the money goes.", "The books don't lie. He does."],
    press: ["I stood at that podium and said what I was told.", "I know what gets said in that building."],
    chief: ["Nobody tells him no and keeps their job.", "I ran that building. He runs it into the ground."],
  };
  function formerActs(d) {
    const s = S(), f = s.former || [];
    for (let i = 0; i < f.length; i++) {
      const F = f[i];
      // a man with no grudge goes quiet; a leak she was holding goes out anyway
      if ((F.grudge < 40 && !F.leak) || d < F.next) continue;
      F.next = d + 2 + (hash(F.name + d) % 3);
      F.acts++;
      const r = h01(F.name + ":" + d + ":" + F.acts);
      const who = F.office + " " + surname(F.name);
      if (F.plotting && F.acts <= 3) {
        if (CBZ.dissent && CBZ.dissent.plot) { try { CBZ.dissent.plot({ name: F.name, sid: F.sid, push: 8 }); } catch (e) {} }
        emit("former", { kind: "enemy", name: F.name, office: F.office, headline: "Former " + who + " seen with officers", text: "The army deserves better than this." });
        F.grudge = Math.max(40, F.grudge - 4);
        continue;
      }
      if (F.leak || (F.grudge >= 70 && r < 0.4)) {
        F.leak = false;
        scandal(5); shock(-1);
        emit("former", { kind: "leak", name: F.name, office: F.office, headline: "Former " + who + " leaks to the press", text: "They'll print what I gave them." });
      } else if (F.grudge >= 60 && r < 0.6 && CBZ.dissent && CBZ.dissent.stage && CBZ.dissent.stage() >= 1) {
        if (CBZ.dissent.bump) { try { CBZ.dissent.bump(4, 6, 0); } catch (e) {} }
        emit("former", { kind: "opposition", name: F.name, office: F.office, headline: F.name + " joins the opposition", text: "I'm with the people in the street now." });
      } else {
        const L = CRITIC[F.role] || CRITIC.chief;
        shock(-0.5);
        emit("former", { kind: "critic", name: F.name, office: F.office, text: L[(hash(F.name) + F.acts) % L.length] });
      }
      F.grudge -= 8;
    }
  }
  function daily(d) {
    if (!seat()) return;
    ensureStaffed();
    const s = S();
    const h = seat();
    // the officers drift: a good man's grudge grows, a loyal one stays put
    for (let i = 0; i < CABINET.length; i++) {
      const role = CABINET[i], r = rec(role);
      if (!r || vacant(role)) continue;
      if (!isFinite(r.loyalty)) r.loyalty = 60;
      if (r.trait === "able") r.loyalty = clamp(r.loyalty - 1.5, 0, 100);
      if (r.trait === "loyal") r.loyalty = Math.max(50, r.loyalty);
    }
    // what each post does for you, filled or empty
    if (vacant("general")) readiness(-0.03);
    else readiness(edge("general") > 0 ? 0.02 : edge("general") < 0 ? -0.01 : 0, 0.35);
    if (s.shake && s.shake.general != null) { if (d <= s.shake.general) readiness(-0.03); else delete s.shake.general; }
    if (h && h.rec) {
      if (vacant("treasury")) h.rec.treasury = Math.max(0, (h.rec.treasury || 0) - 2000);
      else if (edge("treasury") > 0) h.rec.treasury = (h.rec.treasury || 0) + 2500;
    }
    if (vacant("police")) shock(-0.5); else if (edge("police") > 0) shock(0.4);
    if (!vacant("bureau") && edge("bureau") > 0) {
      const p = Pz();
      if (p && p.bureauIntel && h01("intel:" + d) < 0.35) { try { p.bureauIntel(true); } catch (e) {} }
    }
    const pol = politics();
    if (vacant("press")) { if (pol && (+pol.scandal || 0) > 0) scandal(1.5); }
    else if (pol && (+pol.scandal || 0) < 15 && s.press) s.press.cred = clamp((s.press.cred == null ? 1 : s.press.cred) + 0.05, 0.2, 1.2);
    formerActs(d);
    needNames();
  }
  if (CBZ.onNewDay) CBZ.onNewDay(function (d) { hook(); try { daily(d); } catch (e) {} });

  // ================================================================
  //  BODIES IN THE OFFICE (president_office.js's frame)
  // ================================================================
  let _rec = null, _recAt = -9;
  function office() {
    if (_rec && CLOCK - _recAt < 1) return _rec;
    _recAt = CLOCK; _rec = null;
    if (!CBZ.presidentInteriorRooms) return null;
    let list = [];
    try { list = CBZ.presidentInteriorRooms() || []; } catch (e) { list = []; }
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r && r.key === "ovaloffice" && r.approach && r.landmarks && r.landmarks.presidentialDesk) { _rec = r; break; }
    }
    return _rec;
  }
  function toWorld(r, lx, lz) { const A = r.approach, L = -lx; return { x: A.x + A.nx * lz + A.tx * L, z: A.z + A.nz * lz + A.tz * L }; }
  function toLocal(r, wx, wz) { const A = r.approach, dx = wx - A.x, dz = wz - A.z; return { x: -(dx * A.tx + dz * A.tz), z: dx * A.nx + dz * A.nz }; }
  function spots(r) {
    const A = r.approach, half = A.span / 2, L = r.landmarks;
    const lp = L.arrivalPortal ? toLocal(r, L.arrivalPortal.x, L.arrivalPortal.z) : { x: 0, z: 6 };
    const side = half - 1.1, desk = L.presidentialDesk;
    return {
      door: L.staffDoor ? { x: L.staffDoor.x, z: L.staffDoor.z } : toWorld(r, 0, 1.0),
      chief: L.chiefSpot ? { x: L.chiefSpot.x, z: L.chiefSpot.z } : toWorld(r, side, lp.z + 0.9),
      press: L.pressSpot ? { x: L.pressSpot.x, z: L.pressSpot.z } : toWorld(r, Math.min(3.4, half - 1.4), Math.max(1.4, lp.z - 2.0)),
      faceIn: function (p) {
        if (desk) return Math.atan2(desk.x - p.x, desk.z - p.z);
        const c = toWorld(r, 0, toLocal(r, p.x, p.z).z); return Math.atan2(c.x - p.x, c.z - p.z);
      },
    };
  }
  function doorSpot() { const r = office(); return r ? spots(r).door : null; }
  function nearOffice(r) {
    const P = CBZ.player;
    if (!r || !P || !P.pos || P.dead || Math.abs((P.pos.y || 0) - r.floorY) > 3) return false;
    const d = r.landmarks.presidentialDesk;
    return Math.hypot(P.pos.x - d.x, P.pos.z - d.z) < NEAR_R;
  }
  function post(r, at, R, opts) {
    if (!CBZ.cityPostNpc) return null;
    const o = { job: R.job, archetype: R.archetype, aggr: 0.05, wealth: 0.7, floorY: r.floorY, src: "presstaff" };
    if (opts) for (const k in opts) if (opts[k] != null) o[k] = opts[k];
    let p = null;
    try { p = CBZ.cityPostNpc(at.x, at.z, o); } catch (e) { p = null; }
    // a staffer is his job: only his own verbs, no street Talk / Mug / Hire
    if (p) { p.organization = "state"; p.nameKnown = true; p._iOnly = true; }
    return p;
  }
  function unpost(p) {
    if (!p || p.dead) return;
    if (CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(p); return; } catch (e) {} }
    try { if (p.group && p.group.parent) p.group.parent.remove(p.group); const a = CBZ.cityPeds; if (a) { const i = a.indexOf(p); if (i >= 0) a.splice(i, 1); } } catch (e) {}
  }
  // the lane round the sofas from the staff door (interior_programs.js publishes it)
  function aisleTo(p, x, z) {
    const r = office(), L = r && r.landmarks;
    if (!L || !L.staffAisle0 || !L.staffAisle1) return [];
    const A = [L.staffAisle0, L.staffAisle1];
    const d = function (q, s) { return Math.hypot(q.x - s.x, q.z - s.z); };
    const fwd = d(p.pos, A[0]) <= d(p.pos, A[A.length - 1]) ? A : A.slice().reverse();
    const out = [];
    for (let i = 0; i < fwd.length; i++) if (d(fwd[i], { x: x, z: z }) < d(p.pos, { x: x, z: z }) + 0.5) out.push({ x: fwd[i].x, z: fwd[i].z });
    return out;
  }
  function walkTo(p, x, z) {
    if (!p || p.dead) return;
    p.controlled = true; p.staffPost = null;
    p.path = aisleTo(p, x, z).concat([{ x: x, z: z }]); p.finalGoal = { x: x, z: z };
    if (p.target && p.target.set) p.target.set(x, 0, z);
    p.state = "walk"; p.pause = 0;
  }
  function near(p, at, r) { return p && at && Math.hypot(p.pos.x - at.x, p.pos.z - at.z) < r; }

  // THE CHIEF: E is the day in one sentence; with names in hand, E is the
  // first name and the wheel the second; the wheel always has Dismiss.
  function postChief(r) {
    const c = person("chief");
    if (!c) return;
    const sp = spots(r);
    const p = post(r, sp.chief, JOB.chief, { pin: true, face: sp.faceIn(sp.chief), gender: c.gender });
    if (!p) return;
    p.name = c.name; p._presStaff = "chief";
    W.chief = p;
    if (!CBZ.interactions || !CBZ.interactions.registerFor) return;
    const nm = function () { const n = S().nominee; return n && speakerFor(n.role) && speakerFor(n.role).body === p ? n : null; };
    CBZ.interactions.registerFor(p, { id: "pres-chief-talk", slot: "e", prio: 30, campaignSafe: true, forceYes: true,
      label: "Talk", canShow: function () { return !!seat() && !nm(); },
      onSelect: function () {
        const O = CBZ.presidentOffice;
        let line = chiefWarning() || "Nothing that can't wait, sir.";
        if (!chiefWarning() && O && O.dayLine) { try { line = O.dayLine() || line; } catch (e) {} }
        say(p, line, Math.min(5, 2 + line.length * 0.04));
      } });
    CBZ.interactions.registerFor(p, { id: "pres-chief-name-a", slot: "e", prio: 50, campaignSafe: true, forceYes: true,
      label: function () { const n = nm(); return n ? surname(n.names[0].name) : ""; },
      canShow: function () { return !!seat() && !!nm(); },
      onSelect: function () { const r0 = pick(0); if (r0 && r0.line) say(p, r0.line, 2.6); } });
    CBZ.interactions.registerFor(p, { id: "pres-chief-name-b", prio: 45, campaignSafe: true, forceYes: true,
      label: function () { const n = nm(); return n ? surname(n.names[1].name) : ""; },
      canShow: function () { return !!seat() && !!nm(); },
      onSelect: function () { const r0 = pick(1); if (r0 && r0.line) say(p, r0.line, 2.6); } });
    wire(p, "chief");
  }
  function postPress(r) {
    const pr = S().press;
    if (!pr) return;
    const sp = spots(r).press;
    const p = post(r, sp, JOB.press, { pin: true, face: spots(r).faceIn(sp), gender: pr.gender || "f" });
    if (!p) return;
    p.name = pr.name; p._presStaff = "press";
    W.press = p;
    wire(p, "press");
  }
  function aideVisiting() {
    const O = CBZ.presidentOffice;
    if (!O || !O._M) return false;
    try { return !!(O.audit && O.audit().aide); } catch (e) { return false; }
  }
  // the driver waits at the state car (motorcade.js drives the column)
  function tickDriver() {
    const s = S(), M = CBZ.motorcade, P = CBZ.player;
    const car = s.driver && M && M.car ? M.car() : null;
    const busy = !!(M && M.active && M.active());
    const want = !!(car && car.pos && !busy && P && P.pos && Math.hypot(P.pos.x - car.pos.x, P.pos.z - car.pos.z) < 70 && Math.abs((P.pos.y || 0) - (car.pos.y || 0)) < 4);
    if (!want) { if (W.driver) { unpost(W.driver); W.driver = null; } return; }
    if (W.driver && !W.driver.dead) return;
    const h = car.heading != null ? car.heading : (car.group ? car.group.rotation.y : 0);
    const x = car.pos.x + Math.cos(h) * 1.6, z = car.pos.z - Math.sin(h) * 1.6;
    let p = null;
    try { p = CBZ.cityPostNpc(x, z, { job: "chauffeur", archetype: "professional", pin: true, face: h, floorY: car.pos.y || 0, src: "presstaff:driver" }); } catch (e) { p = null; }
    if (!p) return;
    p.name = s.driver.name; p.nameKnown = true; p.organization = "state"; p._presStaff = "driver"; p._iOnly = true;
    W.driver = p;
  }
  function releaseOffice() {
    if (W.chief) { unpost(W.chief); W.chief = null; }
    if (W.press) { unpost(W.press); W.press = null; }
  }

  // ---- TICK -----------------------------------------------------------------------
  let acc = 0;
  function tick(dt) {
    dt = dt || 0.016;
    CLOCK += dt;
    if (!playing()) return;
    hook();
    if (!seat()) { if (W.chief || W.press || W.driver) { releaseOffice(); if (W.driver) { unpost(W.driver); W.driver = null; } } return; }
    ensureStaffed();
    for (let i = OUT.length - 1; i >= 0; i--) {
      const o = OUT[i]; o.t += dt;
      if (o.t >= 0 && !o.walking && o.door && o.ped && !o.ped.dead) { o.walking = true; walkTo(o.ped, o.door.x, o.door.z); }
      if (!o.ped || o.ped.dead || (o.t > 0.5 && o.door && near(o.ped, o.door, 0.9)) || o.t > o.max) { if (o.ped && !o.ped.dead) unpost(o.ped); OUT.splice(i, 1); }
    }
    // A DEAD STAFFER STAYS DEAD: her desk, his chair, is empty from now on
    if (W.press && W.press.dead) { W.press = null; S().press = null; }
    if (W.chief && W.chief.dead) { W.chief = null; const c = rec("chief"); if (c) c.dead = true; }
    const r = office();
    // the Chief tells you the names when you come up to him
    const nm = S().nominee, P = CBZ.player;
    if (nm && W.chief && !W.chief.dead && W.greeted !== nm && P && P.pos && Math.hypot(P.pos.x - W.chief.pos.x, P.pos.z - W.chief.pos.z) < 4.5 && speakerFor(nm.role) && speakerFor(nm.role).body === W.chief) {
      W.greeted = nm;
      if (CBZ.sayLines) { try { CBZ.sayLines([{ by: W.chief, line: nomineeLine(nm) }], null); } catch (e) {} } else say(W.chief, nomineeLine(nm), 4);
    }
    acc += dt;
    if (acc < 0.5) return;
    acc = 0;
    tickDriver();
    brief();
    needNames();
    const inOffice = r && nearOffice(r);
    if (!inOffice) { if (W.chief || W.press) releaseOffice(); ringNames(); return; }
    // in the office, a Chief with names says them to your face; without him the phone rings
    if (nm && !(speakerFor(nm.role) && speakerFor(nm.role).body)) ringNames();
    if (aideVisiting()) { if (W.chief) { unpost(W.chief); W.chief = null; } }
    else if ((!W.chief || W.chief.dead) && !vacant("chief")) { W.chief = null; postChief(r); }
    if (!W.press && !vacant("press")) postPress(r);
  }
  if (CBZ.onUpdate) CBZ.onUpdate(36.25, tick);

  CBZ.presidentStaff = {
    vacant: vacant,
    person: person,
    has: function (role) { return !vacant(role); },
    dismiss: dismiss,
    dismissFace: dismissFace,
    nominee: function () { const n = S().nominee; return n ? { role: n.role, line: nomineeLine(n), names: n.names.map(function (c) { return { name: c.name, trait: c.trait }; }) } : null; },
    pick: pick,
    obedience: obedience, edge: edge, armyLean: armyLean, plotter: plotter,
    chiefStyle: chiefStyle, chiefWarning: chiefWarning,
    loyalty: loyaltyOf,
    wire: wire,
    former: function () { return (S().former || []).slice(); },
    audit: function () {
      const s = S(), out = { chief: !!W.chief, pressBody: !!W.press, press: s.press ? s.press.name : null, driver: s.driver ? s.driver.name : null,
        vacant: POSTS.filter(vacant), nominee: s.nominee ? s.nominee.role : null, former: (s.former || []).length, briefedToday: s.pressDay === day() };
      return out;
    },
    // tests
    _daily: daily, _tick: tick, _state: S, _hook: hook, _staff: ensureStaffed, _nominate: nominate, _ring: function () { W.ringAt = -1e9; ringNames(); },
  };
})();
