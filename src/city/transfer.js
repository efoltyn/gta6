/* ============================================================
   city/transfer.js — THE TRANSFER OF POWER. Election night on every TV, and
   what a President does when the count goes against him.

   OWNER: "If you lose an election you can cause a Jan 6-like thing. Just
   make it cool and real: crowds of people, real mobs."

   WHAT EXISTED. elections.js already runs the President's race: a term on
   the calendar (28 days), a two-day campaign, polls that are snapshots of
   the real tally, a challenger who is a minted person with a name, and a
   count that moved the seat the instant it was tallied. presidency.js said
   "DEFEATED AT THE BALLOT" and the detail stood down at midnight. This file
   adds what sits between the count and the handover:

   1. ELECTION NIGHT. When the home country's race is counted, NEWS ONE's
      decision desk takes every screen (newsroom.js live "results"): the two
      names, the national share, and the cities called one by one off the
      real per-city tally, then the projection.
   2. THE COUNT IS HELD. If the sitting President is the player and he lost,
      elections.js does not move the seat; it waits for certification
      (elections.certify). The Chief comes in: "It's over, sir. They've
      called it for <name>." Concede, or refuse.
        concede  the count is certified now. The existing defeat path runs (a
                 private citizen; the game goes on).
        refuse   Congress meets at the Capitol to certify in a few minutes.
                 The press secretary has the cameras ready (city/address.js):
                 say the election was stolen, call your people to the
                 Capitol. Or say nothing, and the session certifies.
   3. THE CAPITOL. A crowd called there (city/mob.js) musters at the end of
      the mall: dressed by your loyal groups, flags, STOP THE STEAL boards.
      When the session opens it marches up the mall to a Capitol Police line
      at the foot of the steps. The line holds or breaks on numbers: the
      front's push against shields. Broken, the crowd pours through the doors
      and into the rotunda; the members in the chamber run for the far doors
      or get down behind their desks; the count is suspended.
   4. THE GUARD DECIDES. The General calls: the Guard is on the plaza, what
      are your orders? Whatever you say, it does what its loyalty says (the
      political model's loyalty, else your General's): a loyal Guard holds
      the Capitol for you; a Guard loyal to the Constitution clears it with
      gas and a line that walks the crowd out.
   5. THE ENDS.
        seized     the count is voided (elections.voidCount), the regime
                   becomes a dictatorship through regimes.js (the Mansion,
                   the detail and the flag change with it: president_regime.js
                   and flags.js already read govType), Congress is dissolved.
        convicted  Congress comes back and certifies that night. The House
                   impeaches for incitement, the marshals come (presidency's
                   own arrest path) and the jail is the ending.
        certified  the line held: the session certified with the crowd
                   outside, and you lost.
        conceded   peaceful.
   Every step is a story on NEWS ONE and a burst on Holler, and goes through
   the political model as an act (CBZ.address.act -> CBZ.politics.act).

   PUBLIC: CBZ.transfer = { state(), night(n), hold(n), concede(why), refuse(),
     claimStolen(), onRally(mobId, placeId, size), guardOrder(side),
     capitolPlan(), ballot(seatId), audit() } + _t(secs) (tests).
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.transfer) return;
  const g = CBZ.game || (CBZ.game = {});
  const CFG = (CBZ.CONFIG = CBZ.CONFIG || {});

  const REVEAL_GAP = 3.0;        // s between cities called on election night
  const CALL_HOLD = 9;           // s the projection stays on air
  const SESSION_DELAY = CFG.TRANSFER_SESSION_DELAY > 0 ? +CFG.TRANSFER_SESSION_DELAY : 150;   // s from refusal to the session
  const SESSION_LEN = 240;       // s Congress sits to certify
  const GUARD_ASK = 18;          // s after the breach: the General calls
  const GUARD_AUTO = 50;         // s after the breach: the Guard moves on its own
  const CLEAR_SECS = 45;         // s the Guard takes to clear the grounds
  const CONGRESS_RIGS = 14;      // members drawn in the chamber when you are near
  const CONGRESS_SEATS = 535;    // the members, as the news counts them

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function day() { try { return CBZ.worldDay ? (CBZ.worldDay() | 0) : 0; } catch (e) { return 0; } }
  function Pz() { return CBZ.presidency || null; }
  function seat() { const p = Pz(); try { return p && p.seat ? p.seat() : null; } catch (e) { return null; } }
  function emit(evt, d) { const p = Pz(); if (p && p.emit) { try { p.emit(evt, d); } catch (e) {} } }
  function news(h, o) { const N = CBZ.news; if (N && N.push) { try { return N.push(h, o || {}); } catch (e) {} } return false; }
  function act(kind, o) { const A = CBZ.address; if (A && A.act) { try { return A.act(kind, o) || {}; } catch (e) {} } return { ok: true }; }
  function surname(n) { const a = String(n || "").trim().split(/\s+/); return a[a.length - 1] || ""; }
  function complex(id) { const L = CBZ.govComplexes; if (Array.isArray(L)) for (let i = 0; i < L.length; i++) if (L[i] && L[i].id === id) return L[i]; return null; }
  function player() { const P = CBZ.player; return P && P.pos ? P.pos : null; }
  function person(role) {
    const PS = CBZ.presidentStaff;
    if (PS && PS.person) { try { const p = PS.person(role); if (p && p.name) return { name: p.name, role: role }; } catch (e) {} }
    const p = Pz(); let c = null; try { c = p && p.cabinet ? p.cabinet()[role] : null; } catch (e) { c = null; }
    return { name: (c && (c.display || c.name)) || (role === "chief" ? "Chief of Staff" : role === "general" ? "The General" : "Press Secretary"), role: role };
  }
  function homeId() {
    const h = seat(); if (h) return h.id;
    const T = st(); if (T.seatId) return T.seatId;
    const F = CBZ.flags; try { return F && F.home ? F.home() : "republic"; } catch (e) { return "republic"; }
  }

  // ---------------------------------------------------------------- state
  function fresh() { return { phase: "idle", seatId: null, winner: null, winnerSid: null, refusedT: 0, sessionAt: 0, sessionEnd: 0, suspended: false, breachT: 0, guard: null, guardOrder: null, outcome: null, mob: null, line: null, stolen: false, violence: false, log: [] }; }
  function st() { return g.transferState || (g.transferState = fresh()); }
  let CLOCK = 0;
  const NIGHT = { on: false, n: null, order: [], k: 0, t: 0, called: false, holdT: 0, pend: null };
  function log(what) { const T = st(); T.log.push({ what: what, t: +CLOCK.toFixed(1), day: day() }); if (T.log.length > 40) T.log.shift(); }
  function setPhase(p) { const T = st(); if (T.phase === p) return; T.phase = p; log(p); emit("transfer", { phase: p, winner: T.winner }); }

  // ============================================================
  //  §1  ELECTION NIGHT
  // ============================================================
  function night(n) {
    if (!n || !n.rec || n.rec.kind !== "country") return false;
    if (n.rec.id !== homeId() && !(n.candidates || []).some(function (c) { return c.player; })) return false;
    const blocs = (n.perBloc || []).slice();
    // the order the networks call them: the clearest margins first, a little shuffled by name
    blocs.sort(function (a, b) {
      const ma = Math.abs((a.votes[0] || 0) - (a.votes[1] || 0)) / Math.max(1, a.weight), mb = Math.abs((b.votes[0] || 0) - (b.votes[1] || 0)) / Math.max(1, b.weight);
      return mb - ma;
    });
    NIGHT.on = true; NIGHT.n = n; NIGHT.order = blocs; NIGHT.k = 0; NIGHT.t = 1.2; NIGHT.called = false; NIGHT.holdT = 0;
    const c = n.candidates;
    news("Polls close: the count begins", { kind: "breaking", cat: "ELECTION", sub: (c[0] ? c[0].name : "") + " against " + (c[1] ? c[1].name : ""), key: "night:" + n.day, hold: 600 });
    paintNight();
    return true;
  }
  function paintNight() {
    const N = CBZ.news; if (!N || !N.live || !NIGHT.n) return;
    const n = NIGHT.n, c = n.candidates;
    let va = 0, vb = 0, wa = 0, wb = 0;
    const D = [];
    for (let i = 0; i < NIGHT.order.length; i++) {
      const b = NIGHT.order[i], called = i < NIGHT.k;
      if (called) { va += b.votes[0] || 0; vb += b.votes[1] || 0; if ((b.votes[0] || 0) >= (b.votes[1] || 0)) wa++; else wb++; }
      D.push({ name: b.name, a: b.votes[0] || 0, b: b.votes[1] || 0, called: called });
    }
    const tot = va + vb || 1;
    const last = NIGHT.k > 0 ? NIGHT.order[NIGHT.k - 1] : null;
    const lastWin = last ? ((last.votes[0] || 0) >= (last.votes[1] || 0) ? c[0] : c[1]) : null;
    const W = c[n.winner];
    const me = function (x) { return x && x.player ? "President " + surname(x.name) : (x ? x.name : "?"); };
    N.live({
      kind: "results", title: "Election night", a: { name: me(c[0]), pct: NIGHT.k ? va / tot * 100 : 0, won: wa }, b: { name: me(c[1]), pct: NIGHT.k ? vb / tot * 100 : 0, won: wb },
      aColor: colorFor(c[0]), bColor: colorFor(c[1]), districts: D,
      reporting: NIGHT.k + " of " + NIGHT.order.length + " cities reporting",
      line: last ? surname(me(lastWin)) + " carries " + last.name : "Votes are being counted",
      call: NIGHT.called && W ? me(W).toUpperCase() + " WINS THE PRESIDENCY" : null,
    });
  }
  function colorFor(cand) {
    const A = CBZ.address;
    let p = null;
    try { p = A ? (cand && (cand.player || cand.type === "incumbent") ? A.myParty() : A.rivalParty()) : null; } catch (e) { p = null; }
    const c = p && p.color;
    return c === "blue" ? "#2f6fd6" : c === "red" ? "#d23b3b" : typeof c === "string" && /^#/.test(c) ? c : (cand && (cand.player || cand.type === "incumbent") ? "#d23b3b" : "#2f6fd6");
  }
  function tickNight(dt) {
    if (!NIGHT.on) return;
    NIGHT.t -= dt;
    if (NIGHT.t > 0) return;
    if (NIGHT.k < NIGHT.order.length) { NIGHT.k++; NIGHT.t = REVEAL_GAP; paintNight(); return; }
    if (!NIGHT.called) {
      NIGHT.called = true; NIGHT.t = CALL_HOLD; paintNight();
      const n = NIGHT.n, W = n.candidates[n.winner];
      const H = W ? (W.player ? "President " + surname(W.name) + " wins a second term" : W.name + " wins the presidency") : "The presidency is decided";
      news(H, { kind: "breaking", cat: "ELECTION", key: "call:" + n.day, hold: 900, phone: true });
      emit("election-call", { winner: W ? W.name : null, player: !!(W && W.player), headline: H,
        holler: [{ kind: "press", text: H + "." }, { kind: "citizen", text: W && W.player ? "Four more years. Told you." : "It's over. Thank God." }, { kind: "citizen", text: W && W.player ? "I can't believe this country." : "Wait for him to accept it. I'm not holding my breath." }] });
      return;
    }
    // the projection has been up long enough: back to the studio
    NIGHT.on = false;
    const N = CBZ.news; if (N && N.live) { try { N.live(null); } catch (e) {} }
    if (NIGHT.pend) { const f = NIGHT.pend; NIGHT.pend = null; try { f(); } catch (e) {} }
  }

  // ============================================================
  //  §2  THE HELD COUNT
  // ============================================================
  // elections.js asks before it moves a sitting player's seat to the winner
  function hold(n) {
    if (!n || !n.rec || n.rec.kind !== "country") return false;
    const T = st();
    if (T.phase !== "idle" && T.phase !== "done") return false;
    Object.assign(T, fresh());
    const W = n.candidates[n.winner];
    T.seatId = n.rec.id; T.winner = W ? W.name : "the challenger"; T.winnerSid = W ? W.sid : null;
    setPhase("lost");
    const ask = function () { askConcede(); };
    if (NIGHT.on) NIGHT.pend = ask; else ask();
    return true;
  }
  // A PERSON BRINGS IT: the aide at the desk when he is in the Oval
  // (president_office.js's matters engine), the phone in his pocket anywhere
  // else (phone_apps.js ring: the same caller, the same two answers)
  function offer(m) {
    const A = CBZ.phoneApps;
    if (m.via === "phone" && A && A.ring) {
      try {
        return A.ring({ key: m.id, id: m.id, name: m.who.name, role: m.who.role, line: m.line,
          choices: [
            { id: "yes", label: m.yes.label, run: function () { try { if (m.yes.run) m.yes.run(); } catch (e) {} return { ok: true, line: m.yes.reply || "Yes, sir." }; } },
            { id: "no", label: m.no.label, run: function () { try { if (m.no.run) m.no.run(); } catch (e) {} return { ok: true, line: m.no.reply || "Understood, sir." }; } },
          ],
          onMissed: m.ifIgnored || null });
      } catch (e) {}
    }
    const O = CBZ.presidentOffice;
    if (O && O.offer) { try { return O.offer(m); } catch (e) {} }
    return null;
  }
  function channel() {
    const O = CBZ.presidentOffice, P = player();
    let d = null; try { d = O && O.deskPoint ? O.deskPoint() : null; } catch (e) { d = null; }
    return d && P && Math.hypot(P.x - d.x, P.z - d.z) < 30 ? "aide" : "phone";
  }
  function askConcede() {
    const T = st();
    if (T.phase !== "lost") return;
    offer({
      id: "tr:concede:" + T.seatId + ":" + day() + ":" + (T.asks | 0), via: channel(), urgent: true, topic: "election", who: person("chief"), expires: 180,
      line: "It's over, sir. They've called it for " + T.winner + ".",
      yes: { label: "Concede", run: function () { concede("chief"); }, reply: "I'll call his people." },
      no: { label: "I won't concede", run: function () { refuse(); }, reply: "Then we need the cameras." },
    });
  }
  function concede(why) {
    const T = st();
    if (!/lost|refused|session/.test(T.phase)) return false;
    act("concede", { target: { kind: "election", id: T.seatId, name: "the election" }, by: "president", via: why || "concede" });
    news("President concedes to " + T.winner, { kind: "breaking", cat: "ELECTION", sub: "A peaceful transfer of power", key: "concede:" + T.seatId, hold: 900 });
    emit("concede", { winner: T.winner, headline: "President concedes to " + T.winner, holler: [{ kind: "press", text: "The President has conceded." }, { kind: "citizen", text: "Say what you like about him. He went quietly." }] });
    certifyNow("conceded");
    return true;
  }
  function refuse() {
    const T = st();
    if (T.phase !== "lost") return false;
    T.refusedT = CLOCK;
    T.sessionAt = CLOCK + SESSION_DELAY;
    setPhase("refused");
    act("refuse-concede", { target: { kind: "election", id: T.seatId, name: "the election" }, by: "president" });
    news("President refuses to concede", { kind: "breaking", cat: "ELECTION", sub: "Congress meets at the Capitol to certify the count", key: "refuse:" + T.seatId, hold: 900, phone: true });
    emit("refuse", { winner: T.winner, headline: "President refuses to concede", holler: [{ kind: "press", text: "The President will not concede. Congress certifies at the Capitol." }, { kind: "citizen", text: "Here we go." }, { kind: "citizen", text: "He won. They know he won." }] });
    // the press secretary has the cameras ready (the address is the next move)
    offer({
      id: "tr:cameras:" + T.seatId + ":" + day(), via: channel(), urgent: true, topic: "address", who: person("press"), expires: 160,
      line: "Cameras are ready, sir. The country is waiting to hear from you.",
      yes: { label: "Go on air", run: function () { if (CBZ.address && CBZ.address.begin) CBZ.address.begin({ reason: "refused" }); } },
      no: { label: "Not yet", reply: "They'll be ready when you are." },
    });
    return true;
  }
  function claimStolen() { const T = st(); T.stolen = true; if (T.mob && CBZ.mob) CBZ.mob.chant(T.mob, "Stop the steal! Stop the steal!"); return true; }
  function certifyNow(outcome) {
    const T = st();
    const E = CBZ.elections;
    let ok = false;
    if (E && E.certify) { try { ok = !!E.certify(T.seatId); } catch (e) { ok = false; } }
    T.outcome = outcome;
    setPhase("done");
    dropCongress();
    log("certified:" + outcome);
    return ok;
  }

  // ============================================================
  //  §3  THE CAPITOL
  // ============================================================
  function capitolPlan() {
    const cap = complex("capitol");
    if (!cap || !cap.seatPoint || !cap.gate) return null;
    const sp = cap.seatPoint, gt = cap.gate;
    const L = Math.hypot(gt.x - sp.x, gt.z - sp.z) || 1, nx = (gt.x - sp.x) / L, nz = (gt.z - sp.z) / L;   // outward, down the mall
    const door = { x: sp.x - nx * 4.2, z: sp.z - nz * 4.2 };
    const mall = Math.min(L - 14, 110);
    const P = function (d) { return { x: sp.x + nx * d, z: sp.z + nz * d }; };
    return {
      cap: cap, n: { x: nx, z: nz }, door: door, seat: { x: sp.x, z: sp.z },
      muster: P(mall), face: Math.atan2(-nx, -nz),
      route: [P(mall * 0.5), P(16), Object.assign(P(0), { door: true }), { x: door.x - nx * 10, z: door.z - nz * 10, inside: true }],
      line: { at: P(11), face: Math.atan2(nx, nz), width: 28 },
      insideAt: { x: door.x - nx * 22, z: door.z - nz * 22, r: 9 },
    };
  }
  // the chamber: the Senate Wing's house floor, read from the built shell
  function chamber() {
    const S = CBZ.govShells ? (function () { try { return CBZ.govShells(); } catch (e) { return []; } })() : [];
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (!s || !s.b || !s.site || s.site.id !== "capitol" || !/senate/i.test(s.name || "")) continue;
      const b = s.b, q = b._civicVoid;
      const y = Array.isArray(b.floorTops) ? b.floorTops[0] : 0;
      if (q && isFinite(q.x0)) return { x: (b.ox || 0) + (q.x0 + q.x1) / 2, z: (b.oz || 0) + (q.z0 + q.z1) / 2, y: y, hw: Math.abs(q.x1 - q.x0) / 2, hd: Math.abs(q.z1 - q.z0) / 2 };
      if (isFinite(b.ox)) return { x: b.ox, z: b.oz, y: y, hw: (b.w || 30) / 4, hd: (b.d || 30) / 4 };
    }
    const cap = complex("capitol");
    return cap ? { x: cap.cx - 80, z: cap.cz - 34, y: 0, hw: 8, hd: 6 } : null;
  }
  const CONG = { peds: [], fled: 0, hid: 0, posted: false };
  function postCongress() {
    if (CONG.posted || !CBZ.cityPostNpc) return;
    const P = player(), ch = chamber();
    if (!P || !ch || Math.hypot(P.x - ch.x, P.z - ch.z) > 170) return;
    CONG.posted = true;
    // THE MEMBERS ARE THE MODEL'S (politics.js congress().members): the named
    // senators whose seats the votes count sit in the chamber; harm one and
    // his seat moves. The ones politics.js already stands on the plaza stay there.
    const P2 = Pol();
    let mem = [];
    try { mem = P2 && P2.congress ? (P2.congress().members || []).filter(function (m) { return m.status === "sitting" && !m.body; }) : []; } catch (e) { mem = []; }
    for (let i = 0; i < CONGRESS_RIGS; i++) {
      const r = (i % 7) - 3, row = (i / 7) | 0;
      const x = ch.x + r * Math.min(1.6, ch.hw / 3.5), z = ch.z + (row - 0.5) * Math.min(2.2, ch.hd / 1.6);
      const m = mem[i] || null;
      let p = null;
      try { p = CBZ.cityPostNpc(x, z, { job: m ? "senator" : (i === 0 ? "presiding officer" : "congressional staffer"), archetype: "professional", kind: "civilian", pin: true, face: 0, floorY: ch.y, wealth: 0.8, aggr: 0.05, armed: false, gender: m ? m.gender : undefined, src: "transfer:congress" }); } catch (e) { p = null; }
      if (!p) continue;
      if (m) { p.name = (m.leader ? (m.party === "R" ? "Republican" : "Democratic") + " Leader " : "Senator ") + m.name; p.nameKnown = true; p._congress = m.sid; p._sid = m.sid; p._ideology = m.ideology; p.organization = "state"; }
      CONG.peds.push(p);
    }
  }
  function dropCongress() {
    for (let i = 0; i < CONG.peds.length; i++) { const p = CONG.peds[i]; if (p && !p.dead && CBZ.cityUnpostNpc) { try { CBZ.cityUnpostNpc(p); } catch (e) {} } }
    CONG.peds.length = 0; CONG.posted = false;
  }
  // the breach reaches the chamber: run for the far doors, or get down
  function congressScatter(from) {
    const B = CBZ.cityBrain;
    let fled = 0, hid = 0;
    for (let i = 0; i < CONG.peds.length; i++) {
      const p = CONG.peds[i]; if (!p || p.dead) continue;
      p.staffPost = null;
      const run = (i % 3) !== 2;
      if (B && B.perform) { try { B.perform(p, run ? "flee" : "cower", { x: from.x, z: from.z }); } catch (e) {} }
      else if (run && CBZ.cityFleeFrom) { try { CBZ.cityFleeFrom(p, from.x, from.z); } catch (e) {} }
      if (run) fled++; else hid++;
    }
    // the rest of the house, as the news counts it
    CONG.fled = Math.round(CONGRESS_SEATS * 0.82) + fled;
    CONG.hid = CONGRESS_SEATS - CONG.fled + hid;
  }

  // the crowd you called: if it is the Capitol and the count is refused, it marches
  function onRally(mobId, placeId, size) {
    const T = st();
    const M = CBZ.mob;
    if (!M || placeId !== "capitol") return false;
    const plan = capitolPlan(); if (!plan) return false;
    const contested = /refused|session/.test(T.phase);
    M.march(mobId, plan.route, false);
    if (!contested) return true;              // a rally on the mall, nothing more
    T.mob = mobId;
    // the Capitol Police are already on the steps
    if (!T.line) {
      T.line = M.line(mobId, { at: plan.line.at, face: plan.line.face, width: plan.line.width, n: 16, kind: "police", shields: true, gas: 5, retreat: plan.door });
    }
    if (M.inside) M.inside(mobId, plan.insideAt);
    if (T.phase === "session") startMarch();
    log("rally:" + mobId + ":" + size);
    return true;
  }
  function startMarch() {
    const T = st(), M = CBZ.mob;
    if (!T.mob || !M) return;
    const plan = capitolPlan(); if (!plan) return;
    if (M.stage(T.mob) === "rally") M.march(T.mob, plan.route, true);
  }
  function openSession() {
    const T = st();
    T.sessionEnd = CLOCK + SESSION_LEN;
    setPhase("session");
    news("Congress meets to certify the election", { kind: "story", cat: "NATION", sub: CONGRESS_SEATS + " members in the Capitol", key: "session:" + T.seatId, hold: 600 });
    postCongress();
    startMarch();
  }
  function onBreach() {
    const T = st();
    if (T.suspended) return;
    T.suspended = true; T.breachT = CLOCK; T.violence = true;
    const plan = capitolPlan();
    congressScatter(plan ? plan.door : { x: 0, z: 0 });
    news("Congress evacuated, the count is suspended", { kind: "breaking", cat: "NATION", sub: CONG.fled + " members led out, others sheltering in the chamber", key: "suspend:" + T.seatId, hold: 900, phone: true });
    emit("certification", { phase: "suspended", fled: CONG.fled, hid: CONG.hid, headline: "Congress evacuated, the count is suspended",
      holler: [{ kind: "press", text: "Lawmakers are being evacuated from the Capitol. The count is suspended." }, { kind: "citizen", text: "I'm watching the Capitol get overrun on live TV." }, { kind: "citizen", text: "This is our house. We took it back." }] });
    const P = Pol();
    // the country's verdict on an overrun Capitol: the one scandal, the
    // street's fear, the police who were overrun (politics.js's own event door)
    if (P && P.event) { try { P.event("insurrection", { scandal: 25, fear: 20, inst: { police: -10 } }); } catch (e) {} }
  }
  // CONGRESS DECIDES THE COUNT (city/politics.js vote): the President's
  // people in the chamber object; the objection carries only with a majority
  // that is his and loyal (or a chamber with his rivals gone).
  function congressCount(lean) {
    const P = Pol();
    if (!P || !P.vote) return { pass: false, yes: 0, no: 0, none: true };
    try { return P.vote("objection", { lean: lean }) || { pass: false, yes: 0, no: 0 }; } catch (e) { return { pass: false, yes: 0, no: 0 }; }
  }
  // ============================================================
  //  §4  THE GUARD
  // ============================================================
  function Pol() { return CBZ.politics && CBZ.politics.act ? CBZ.politics : null; }
  // the line the Guard needs to cross to turn on Congress for you: the
  // political model's own DEPLOY_MIN (the Army turns on its own people only
  // above it), else a General who is more yours than not
  function guardBar() { const P = Pol(); return P && isFinite(P.DEPLOY_MIN) ? P.DEPLOY_MIN : 60; }
  function guardLoyalty() {
    const P = Pol();
    if (P && P.instLoyalty && seat()) { try { const v = P.instLoyalty("army"); if (isFinite(v)) return v; } catch (e) {} }
    const A = CBZ.address;
    let I = [];
    try { I = A && A.institutions ? A.institutions() : []; } catch (e) { I = []; }
    for (let i = 0; i < I.length; i++) if (I[i].id === "guard" || I[i].id === "nationalguard") return I[i].loyalty;
    for (let i = 0; i < I.length; i++) if (I[i].id === "army" || I[i].id === "military") return I[i].loyalty;
    const PS = CBZ.presidentStaff;
    try { return PS && PS.loyalty ? PS.loyalty("general") : 50; } catch (e) { return 50; }
  }
  function askGuard() {
    const T = st();
    if (T.guard || T.guardAsked) return;
    T.guardAsked = true;
    offer({
      id: "tr:guard:" + T.seatId + ":" + day(), via: "phone", urgent: true, topic: "guard", who: person("general"), expires: GUARD_AUTO - GUARD_ASK,
      line: "The Capitol is overrun, sir. The Guard is on the plaza. Your orders?",
      yes: { label: "Hold it for us", run: function () { guardOrder("president"); } },
      no: { label: "Clear the building", run: function () { guardOrder("constitution"); } },
      ifIgnored: function () { guardOrder(null); },
    });
  }
  // the order is yours; the decision is the Guard's
  function guardOrder(side) {
    const T = st();
    if (T.guard || !/session|refused/.test(T.phase)) return null;
    T.guardOrder = side || "none";
    const L = guardLoyalty();
    const loyal = L >= guardBar();
    const decided = loyal ? (side === "constitution" ? "constitution" : "president") : "constitution";
    T.guard = decided; T.guardLoyalty = L;
    log("guard:" + decided + ":" + Math.round(L));
    const refusedYou = side === "president" && decided !== "president";
    act("guard-decision", { target: { kind: "institution", id: "guard", name: "the National Guard" }, institution: "guard", side: decided, ordered: side || null, loyalty: L });
    if (decided === "president") seize();
    else clear(refusedYou);
    return decided;
  }
  function seize() {
    const T = st();
    const M = CBZ.mob, plan = capitolPlan();
    // the Guard holds the Capitol for you: a line facing out, nobody gassed
    if (M && T.mob && plan) M.line(T.mob, { at: plan.line.at, face: plan.line.face, width: plan.line.width, n: 20, kind: "guard", hostile: false, gas: 0 });
    const E = CBZ.elections;
    if (E && E.voidCount) { try { E.voidCount(T.seatId); } catch (e) {} }
    const rec = CBZ.polity && CBZ.polity.get ? CBZ.polity.get(T.seatId) : null;
    let changed = false;
    if (rec && CBZ.regimes && CBZ.regimes.transition) { try { CBZ.regimes.transition(rec, "dictatorship", day(), -10); changed = true; } catch (e) {} }
    else if (CBZ.regimeDeclareDoctrine) { try { const r = CBZ.regimeDeclareDoctrine("dictatorship", { rec: rec }); changed = !!(r && r.ok); } catch (e) {} }
    if (rec && !changed) rec.govType = "dictatorship";
    const P = Pol();
    if (P) { try { P.act("emergency", { by: "self", news: false }); } catch (e) {} try { P.event("seize", { scandal: 20, fear: 30 }); } catch (e) {} }
    T.outcome = "seized";
    setPhase("done");
    news("The Guard holds the Capitol for the President", { kind: "breaking", cat: "NATION", sub: "Congress is dissolved, the count is void", key: "seize:" + T.seatId, hold: 1200, phone: true });
    emit("seized", { headline: "The Guard holds the Capitol for the President", holler: [{ kind: "press", text: "The National Guard has sided with the President. Congress is dissolved." }, { kind: "citizen", text: "Soldiers on the Capitol steps. Facing us." }, { kind: "citizen", text: "Four more years. Forever, apparently." }] });
    if (M && T.mob) { M.react("cheer", T.mob); setTimeout(function () { try { M.disperse(T.mob, false); } catch (e) {} }, 40000); }
    dropCongressLater();
  }
  function clear(refusedYou) {
    const T = st();
    const M = CBZ.mob, plan = capitolPlan();
    if (refusedYou) news("The Guard refuses the President's order", { kind: "breaking", cat: "NATION", key: "guardno:" + T.seatId, hold: 600 });
    // a Guard line comes out of the building and walks the crowd down the mall
    if (M && T.mob && plan) {
      M.line(T.mob, { at: { x: plan.door.x + plan.n.x * 2, z: plan.door.z + plan.n.z * 2 }, face: plan.line.face, width: 34, n: 26, kind: "guard", gas: 12, advance: 0.9 });
    }
    T.clearAt = CLOCK + CLEAR_SECS;
    setPhase("clearing");
    news("National Guard moves to clear the Capitol", { kind: "breaking", cat: "NATION", sub: "Tear gas on the plaza", key: "clear:" + T.seatId, hold: 900 });
    emit("guard", { side: "constitution", headline: "National Guard moves to clear the Capitol", holler: [{ kind: "press", text: "The Guard is clearing the Capitol." }, { kind: "citizen", text: "Gas everywhere. People running down the mall." }] });
  }
  function convict() {
    const T = st();
    // THE SENATE TRIES HIM (politics.js's impeach vote: two thirds to convict),
    // counted while he still holds the seat the votes are about
    const P = Pol();
    let v = null;
    if (P && P.vote && seat()) { try { v = P.vote("impeach"); } catch (e) { v = null; } }
    certifyNow("certified");
    news("Congress returns and certifies " + T.winner, { kind: "breaking", cat: "NATION", key: "certified:" + T.seatId, hold: 900 });
    const convicted = v ? !!v.pass : true;
    const tally = v && !v.none && (v.yes || v.no) ? ", " + v.yes + " to " + v.no : "";
    if (convicted) {
      T.outcome = "convicted";
      news("Senate convicts the President of inciting an insurrection" + tally, { kind: "breaking", cat: "POLITICS", key: "convict:" + T.seatId, hold: 900, phone: true });
      emit("impeached", { convicted: true, yes: v ? v.yes : null, no: v ? v.no : null, headline: "Senate convicts the President of inciting an insurrection",
        holler: [{ kind: "press", text: "Convicted. The marshals have a warrant." }, { kind: "citizen", text: "Lock him up." }, { kind: "citizen", text: "A show trial. History will remember." }] });
      const p = Pz();
      if (p && p.charge) { try { p.charge("Inciting an insurrection", "CONVICTED", true); } catch (e) {} }
    } else {
      T.outcome = "acquitted";
      news("Senate acquits the President" + tally, { kind: "breaking", cat: "POLITICS", key: "acquit:" + T.seatId, hold: 900 });
      emit("impeached", { convicted: false, yes: v ? v.yes : null, no: v ? v.no : null, headline: "Senate acquits the President",
        holler: [{ kind: "press", text: "Acquitted. Short of two thirds." }, { kind: "citizen", text: "He'll be back. Watch." }] });
    }
    log("trial:" + T.outcome);
  }
  function dropCongressLater() { setTimeout(function () { try { dropCongress(); } catch (e) {} }, 30000); }

  // ============================================================
  //  §5  THE FRAME
  // ============================================================
  function tick(dt) {
    dt = Math.min(0.25, Math.max(0, dt || 0));
    CLOCK += dt;
    tickNight(dt);
    const T = g.transferState;
    if (!T || T.phase === "idle" || T.phase === "done") return;
    const M = CBZ.mob;
    // nobody answered: the Chief asks again (the seat waits for an answer)
    if (T.phase === "lost" && !NIGHT.on) {
      if (!T.askAt) T.askAt = CLOCK + 90;
      else if (CLOCK >= T.askAt) { T.askAt = CLOCK + 90; T.asks = (T.asks | 0) + 1; askConcede(); }
    }
    if (T.phase === "refused" && CLOCK >= T.sessionAt) openSession();
    if (T.phase === "session" || T.phase === "clearing") {
      postCongress();
      const m = M && T.mob ? M.get(T.mob) : null;
      if (m && (m.stage === "confront" || m.stage === "breach" || m.stage === "inside")) T.violence = true;
      if (m && !T.suspended && (m.stage === "breach" || m.stage === "inside" || m.doorForced)) onBreach();
      if (T.suspended && !T.guard) {
        if (CLOCK - T.breachT >= GUARD_ASK) askGuard();
        if (CLOCK - T.breachT >= GUARD_AUTO) guardOrder(null);
      }
      if (T.phase === "clearing" && (CLOCK >= T.clearAt || !m || m.stage === "disperse")) { if (!m || CLOCK >= T.clearAt) convict(); else if (m.stage === "disperse" && CLOCK >= T.clearAt - CLEAR_SECS * 0.4) convict(); }
      if (T.phase === "session" && !T.suspended && CLOCK >= T.sessionEnd) endSession();
    }
  }
  // the session ends with the count in front of Congress: the objection is
  // voted; it fails (the count is certified) or carries (the count is thrown out)
  function endSession() {
    const T = st();
    const M = CBZ.mob;
    const v = congressCount(T.stolen ? -1.2 : -1.8);
    const tally = !v.none && (v.yes || v.no) ? ", " + v.yes + " to " + v.no : "";
    if (v.pass) {
      const E = CBZ.elections;
      if (E && E.voidCount) { try { E.voidCount(T.seatId); } catch (e) {} }
      T.outcome = "overturned";
      setPhase("done");
      dropCongressLater();
      news("Congress throws out the count" + tally, { kind: "breaking", cat: "NATION", sub: "The President stays in office", key: "overturned:" + T.seatId, hold: 1200, phone: true });
      emit("certification", { phase: "overturned", yes: v.yes, no: v.no, headline: "Congress throws out the count",
        holler: [{ kind: "press", text: "Congress has rejected the count. The President stays." }, { kind: "citizen", text: "They just cancelled an election. Out loud." }] });
      if (M && T.mob) { try { M.react("cheer", T.mob); M.disperse(T.mob, false); } catch (e) {} }
      return;
    }
    news("Congress certifies " + T.winner + " as President" + tally, { kind: "breaking", cat: "NATION", key: "certified:" + T.seatId, hold: 900 });
    emit("certification", { phase: "certified", yes: v.no, no: v.yes, headline: "Congress certifies " + T.winner + " as President", holler: [{ kind: "press", text: "Certified. " + T.winner + " will be sworn in." }] });
    const violent = T.violence;
    certifyNow("certified");
    if (M && T.mob) { try { M.disperse(T.mob, false); } catch (e) {} }
    if (violent) { const p = Pz(); if (p && p.charge) { try { p.charge("Inciting a riot", "CHARGED", false); } catch (e) {} } }
  }
  if (CBZ.onUpdate) CBZ.onUpdate(38.796, tick);

  CBZ.transfer = {
    state: function () {
      const T = st();
      return { phase: T.phase, seatId: T.seatId, winner: T.winner, suspended: T.suspended, guard: T.guard, guardOrder: T.guardOrder, guardLoyalty: T.guardLoyalty != null ? Math.round(T.guardLoyalty) : null,
        outcome: T.outcome, mob: T.mob, stolen: T.stolen, violence: T.violence, sessionIn: T.phase === "refused" ? Math.max(0, T.sessionAt - CLOCK) : null,
        sessionLeft: T.phase === "session" ? Math.max(0, T.sessionEnd - CLOCK) : null, congress: { fled: CONG.fled, hid: CONG.hid, drawn: CONG.peds.length }, night: NIGHT.on ? { k: NIGHT.k, of: NIGHT.order.length, called: NIGHT.called } : null };
    },
    night: night,
    hold: hold,
    concede: concede,
    refuse: refuse,
    claimStolen: claimStolen,
    onRally: onRally,
    guardOrder: guardOrder,
    capitolPlan: capitolPlan,
    chamber: chamber,
    // presidency.js's ballot settle asks: is this seat's count held, or kept by force?
    ballot: function (seatId) {
      const T = g.transferState;
      if (!T || T.seatId !== seatId) return null;
      if (T.outcome === "seized" || T.outcome === "overturned") return "seized";
      if (/lost|refused|session|clearing/.test(T.phase)) return "hold";
      return null;
    },
    audit: function () { return Object.assign({ log: st().log.slice(-12) }, CBZ.transfer.state()); },
    reset: function () { g.transferState = fresh(); NIGHT.on = false; dropCongress(); },
    _t: function (secs) { const n = Math.ceil((secs || 0) / 0.25); for (let i = 0; i < n; i++) tick(0.25); },
    _openSession: openSession,
    _tick: tick,
  };
})();
