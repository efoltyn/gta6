/* ============================================================
   city/dissent.js — THE COUNTRY TURNS ON ITS PRESIDENT, AND YOU SEE IT
   COMING.

   OWNER: "SEE NEWS OF A MOVEMENT AGAINST HIM OR OF A COUP RISING".

   What existed: civilwar.js's coup is a blind 5% daily roll for a
   dictatorship in crisis (no warning, then the junta is at the door), and
   president_public.js stages a protest at the gate when approval is low.
   Nothing in between: no movement that grows, no army that cools, nothing a
   President could read and answer.

   THE LADDER (one per sitting player President, read off live state):
     unrest     the street. Approval under ~45, scandal, a war going badly,
                bombs on your own country push it up; a good speech, a
                concession and time with approval over 55 bring it down.
     movement   organised opposition. Grows out of sustained unrest; it has a
                leader with a real (minted) name who posts and rallies.
     army       military disloyalty. Grows while the movement is strong and
                the army is losing or unpaid in respect (approval under 30).
                A dictatorship's army turns faster (x1.3).
     coup       army at 80: troops move. The coup fires the NEXT day, so
                there is one day to act.
   Every step up is a story on NEWS ONE (via the presidency bus, "dissent"
   with a headline), a post on the phone's social feed, and at the sharp end
   a call on the President's phone. Every step is reversible.

   WHAT THE PRESIDENT CAN DO (all real orders through presidency.press):
     concede()   address the nation (the address order): unrest and movement
                 fall.
     crackdown() soldiers on the street (martial law, else curfew): the
                 movement breaks, the street gets angrier, and an army told
                 to fire on its own people at approval under 35 resents it.
     purge()     relieve the General: president_staff.js's dismiss("general"),
                 the one way any post is emptied (news, readiness, the
                 Chief's two names). A loyal General leaving calls relieved():
                 the plot loses its head, and a coup that fires within three
                 days FAILS. A disloyal one (or any, in a dictatorship) calls
                 plot(): he takes officers with him, the army climbs, and he
                 is the junta's man if the coup lands.
   THE GENERAL'S LOYALTY rides the army line every day
   (presidentStaff.armyLean): a sour General pushes it up, a loyal pick
   holds it under the coup mark.
     bunker()    get to a shelter (a waypoint to the nearest real bunker, or
                 warroom's own bunker verb if it has one). A coup that fires
                 while you are sheltered or abroad takes the capital but not
                 you: the country splits (civilwar's partial road).
   Otherwise the coup succeeds: civilwar stamps the junta general onto the
   seat and presidency.js's junta knock comes for you.

   civilwar.js still owns the coup itself (CBZ.civilwar.coup), and skips its
   blind roll for the seat this file is watching.

   2026-10-08 ONE MODEL (city/politics.js). The three lines are no longer
   counted here: unrest is the country's anger (politics.unrest()), the
   movement is the angriest group organising (politics.movement(), and its
   leader is one of them), the army line is 100 minus the Army's loyalty
   (politics.instLoyalty("army")). This file keeps the LADDER: the stages,
   the warnings, the coup day, the plotter, the answers. Its daily push on
   the army (a strong movement, a losing war, a sour General) is written
   into that one loyalty; what an order costs is politics.js's act table.

   PUBLIC: CBZ.dissent = { status, stage, owns, pressure, concede, crackdown,
     purge, bunker, inShelter, reset } + _tick/_daily/_state (tests).
   Bus (CBZ.presidency.emit): "dissent" {stage, name, text, headline,
     breaking, leader, day}.
   LOAD: after presidency.js / warroom.js / civilwar.js; every read is lazy.
============================================================ */
(function () {
  "use strict";
  const CBZ = window.CBZ;
  if (!CBZ || CBZ.dissent) return;
  const g = CBZ.game || (CBZ.game = {});

  const STAGES = ["calm", "unrest", "movement", "army", "coup"];
  const UP = { unrest: 35, movement: 40, army: 40, coup: 80 };      // a stage starts here
  const COUP_CANCEL = 60;                                           // the troops go back under this
  const PURGE_GUARD_DAYS = 3;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function day() { try { return CBZ.worldDay ? (CBZ.worldDay() | 0) : 0; } catch (e) { return 0; } }
  function P() { return CBZ.presidency || null; }
  function seat() {
    const h = (CBZ.gov && CBZ.gov.holds) ? CBZ.gov.holds() : null;
    return (h && h.kind === "country" && h.rec) ? h : null;
  }
  function emit(evt, payload) { const p = P(); if (p && p.emit) { try { p.emit(evt, payload); } catch (e) {} } }
  function polGet(id) { try { return CBZ.polity && CBZ.polity.get ? CBZ.polity.get(id) : null; } catch (e) { return null; } }
  function capitalName(rec) {
    const W = CBZ.polwar;
    try { const c = W && W.capitalOf ? W.capitalOf(rec.id) : null; const r = c ? polGet(c.id) : null; if (r && r.name) return r.name; } catch (e) {}
    return "the capital";
  }
  function losing(us) {
    const W = CBZ.polwar;
    if (!us || !W || !W.activeWarFor) return false;
    try {
      const w = W.activeWarFor(us);
      if (!w || w.ended) return false;
      const them = w.sides[0] === us ? w.sides[1] : w.sides[0];
      const a = W.militaryOf(us), b = W.militaryOf(them);
      if (!a || !b || !W._combatPower) return false;
      return W._combatPower(a) < W._combatPower(b) * 0.8;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- state
  function fresh() {
    return {
      seat: null, stage: 0, coupDay: null, lastDay: -1,
      leader: null, purgedDay: -99, plotter: null, conceded: 0, crackdowns: 0, coups: 0, lastCoup: null, log: [],
    };
  }
  // THE THREE LINES, read off the one model (never stored here)
  function Pol() { return CBZ.politics || null; }
  function nums() {
    const Po = Pol();
    if (!Po || !seat()) return { unrest: 0, movement: 0, army: 0 };
    return { unrest: Po.unrest(), movement: Po.movement(), army: 100 - Po.instLoyalty("army") };
  }
  function armyPush(da) { const Po = Pol(); if (Po && da) Po.instNudge("army", -da); }
  function S() { return g.dissentWorld || (g.dissentWorld = fresh()); }
  function reset() { g.dissentWorld = fresh(); }

  // the man (or woman) who leads the street: one of the angriest group
  // (city/politics.js angriest()), a minted name, stable per seat
  function leaderFor(seatId) {
    const s = S();
    if (s.leader) return s.leader;
    const Po = Pol();
    const A = Po && Po.angriest ? Po.angriest() : null;
    let rng = null;
    if (CBZ.seedStream) { try { rng = CBZ.seedStream("dissent:leader:" + seatId + ":" + day()); } catch (e) { rng = null; } }
    if (!rng) { let x = 0x2f6b ^ (day() * 977); rng = function () { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
    const gender = rng() < 0.45 ? "f" : "m";
    let name = null;
    if (CBZ.cityMintName) { try { name = CBZ.cityMintName(rng, gender); } catch (e) { name = null; } }
    if (!name) {
      const F = ["Ana", "Teo", "Mara", "Ilya", "Rosa", "Dario", "Lena", "Omar"], L = ["Varga", "Sato", "Moreno", "Kale", "Brandt", "Okoye", "Lind", "Duarte"];
      name = F[(rng() * F.length) | 0] + " " + L[(rng() * L.length) | 0];
    }
    s.leader = { name: name, gender: gender, group: A ? A.id : null, adj: A ? A.adj : null };
    return s.leader;
  }
  function generalName() {
    const p = P();
    try { const c = p && p.cabinet ? p.cabinet() : null; const gn = c && c.general; if (gn && !gn.dead) return gn.display || gn.name; } catch (e) {}
    return null;
  }

  // ---------------------------------------------------------------- the news
  function say(stage, name, headline, opts) {
    opts = opts || {};
    const s = S();
    const text = opts.text || headline;
    s.log.push({ day: day(), stage: stage, name: name, text: text });
    if (s.log.length > 24) s.log.shift();
    emit("dissent", {
      stage: stage, name: name, text: text, headline: headline, breaking: !!opts.breaking,
      leader: s.leader ? s.leader.name : null, day: day(), sub: opts.sub || "",
    });
  }
  function announceUp(to, rec) {
    const s = S();
    const ap = Math.round(rec.approval || 0);
    if (to === 1) say(1, "unrest", "Protests grow in " + capitalName(rec), { sub: "Approval at " + ap + "%" });
    else if (to === 2) {
      const L = leaderFor(rec.id);
      say(2, "movement", L.name + " leads a " + (L.adj ? L.adj + " " : "") + "movement against the President", { sub: "Rallies planned in " + capitalName(rec) });
    } else if (to === 3) {
      const gn = generalName();
      say(3, "army", "Generals meet without the President", { sub: gn ? gn + " was seen there" : "The army is uneasy", breaking: true });
    }
  }
  function announceDown(from) {
    if (from === 3) say(2, "army-calm", "The army stands behind the government");
    else if (from === 2) say(1, "movement-fades", "The opposition movement loses steam");
    else if (from === 1) say(0, "calm", "The streets are quiet again");
  }

  function evaluate(rec, d) {
    const s = S();
    const n = nums();
    let st = 0;
    if (n.unrest >= UP.unrest) st = 1;
    if (st >= 1 && n.movement >= UP.movement) st = 2;
    if (st >= 2 && n.army >= UP.army) st = 3;
    const was = s.stage;
    if (st > was) for (let k = was + 1; k <= st; k++) announceUp(k, rec);
    else if (st < was && was <= 3) announceDown(was);
    s.stage = Math.max(st, s.coupDay != null ? 4 : 0);
    // THE TROOPS MOVE: one day's warning
    if (st < 2) s.leader = null;                 // a new movement brings its own face
    if (s.coupDay == null && n.army >= UP.coup && st >= 3) {
      s.coupDay = d + 1;
      s.stage = 4;
      say(4, "coup-armed", "Troops seen moving near " + capitalName(rec), { sub: "The President has not been seen", breaking: true });
    } else if (s.coupDay != null && n.army < COUP_CANCEL) {
      s.coupDay = null;
      s.stage = st;
      say(st, "coup-off", "Troops return to barracks");
    }
  }

  // ---------------------------------------------------------------- the day
  function daily(d) {
    const h = seat();
    const s = S();
    if (!h || !h.rec) {
      if (s.seat) { const keep = s.coups; reset(); S().coups = keep; }
      return;
    }
    if (s.seat !== h.id) { const keep = s.coups; reset(); S().seat = h.id; S().coups = keep; }
    if (s.lastDay === d) return;
    s.lastDay = d;
    const rec = h.rec;
    const ap = rec.approval != null ? +rec.approval : 50;
    const lose = losing(h.id);
    const auth = /dictator|fascis|junta|monarch|communis/.test(String(rec.govType || "")) ? 1.3 : 1;
    // a war going badly is felt in the street (the one model's groups)
    const Po = Pol();
    if (lose && Po && Po.event) Po.event("losing", { all: -2.5 });
    // the army cools on a President the country has turned on
    const n = nums();
    let da = (n.movement > 40 ? (n.movement - 40) * 0.45 : -8) + (ap < 30 ? 5 : 0) + (lose ? 8 : 0);
    da *= auth;
    const lean = staffLean();
    da += lean.add;
    if (d - s.purgedDay < PURGE_GUARD_DAYS) da = Math.min(da, -10);
    armyPush(da);
    if (lean.cap != null && !s.plotter && Po && Po.instFloor) Po.instFloor("army", 100 - lean.cap);
    // the coup day
    if (s.coupDay != null && d >= s.coupDay) { fire(h, d); return; }
    evaluate(rec, d);
  }

  // ---------------------------------------------------------------- the coup
  function inShelter() {
    const Pl = CBZ.player;
    if (!Pl || !Pl.pos) return false;
    try { if (CBZ.strategicBunkerShelterAt && CBZ.strategicBunkerShelterAt(Pl.pos.x, Pl.pos.y, Pl.pos.z)) return true; } catch (e) {}
    try { if (CBZ.bunkerUnder && Pl.pos.y < -1 && CBZ.bunkerUnder(Pl.pos.x, Pl.pos.z)) return true; } catch (e) {}
    const W = CBZ.warroom;
    if (W && typeof W.inBunker === "function") { try { if (W.inBunker()) return true; } catch (e) {} }
    return false;
  }
  function abroad(us) {
    const Pl = CBZ.player, W = CBZ.warroom;
    if (!Pl || !Pl.pos || !W || !W.nationAt) return false;
    try { const n = W.nationAt(Pl.pos.x, Pl.pos.z); return !!(n && n !== us); } catch (e) { return false; }
  }
  function fire(h, d) {
    const s = S();
    const rec = h.rec;
    let kind;
    if (d - s.purgedDay <= PURGE_GUARD_DAYS) kind = "failure";
    else if (inShelter() || abroad(h.id)) kind = "partial";
    else kind = "success";
    s.coupDay = null;
    s.coups++;
    s.lastCoup = { day: d, kind: kind };
    let out = null;
    const CW = CBZ.civilwar;
    // the man who plotted it is the junta's General (a dismissed one, if any)
    if (CW && typeof CW.coup === "function") { try { out = CW.coup(h.id, kind, s.plotter ? s.plotter.sid : null); } catch (e) { out = null; } }
    if (kind === "failure") s.plotter = null;
    const Po = Pol();
    if (kind === "failure") {
      say(2, "coup-failed", "Coup attempt crushed in " + capitalName(rec), { sub: "The plotters are under arrest", breaking: true });
      if (Po) { Po.instFloor("army", 90); Po.event("coup", { fear: 20 }); }
    } else if (kind === "partial") {
      say(4, "coup-split", "The army splits, the country is at war with itself", { sub: "The President is safe", breaking: true });
      if (Po) { Po.instFloor("army", 80); Po.event("coup", { fear: 30 }); }
    } else {
      say(4, "coup", "The army seizes " + capitalName(rec), { sub: "The President is missing", breaking: true });
      if (Po) { Po.instFloor("army", 100); Po.event("coup", { fear: 60, all: 4 }); }
    }
    s.stage = 0;
    return { kind: kind, result: out };
  }

  // ---------------------------------------------------------------- the President's answers
  function press(key) {
    const p = P();
    if (!p || typeof p.press !== "function") return { ok: false, why: "Nobody is answering." };
    try { return p.press(key) || { ok: false, why: "" }; } catch (e) { return { ok: false, why: "It didn't go through." }; }
  }
  function concede() {
    if (!seat()) return { ok: false, why: "You do not hold the country." };
    const r = press("address");
    if (!r.ok) return r;
    // the deltas land in onOrder (the same order from the Situation Room counts too)
    return { ok: true, line: "Tomorrow I speak to the nation." };
  }
  function crackdown() {
    if (!seat()) return { ok: false, why: "You do not hold the country." };
    let r = press("martial");
    if (!r.ok) {
      const r2 = press("curfew");
      if (!r2.ok) return { ok: false, why: r.why || r2.why || "It can't be done." };
      r = r2;
      return { ok: true, line: "Curfew from dark. The streets will be empty." };
    }
    return { ok: true, line: "Soldiers on the streets by tonight." };
  }
  function purge() {
    if (!seat()) return { ok: false, why: "You do not hold the country." };
    const PS = CBZ.presidentStaff;
    if (!PS || !PS.dismiss) return { ok: false, why: "Nobody is answering." };
    if (!generalName()) return { ok: false, why: "There is no General to relieve." };
    return PS.dismiss("general", { via: "phone" });
  }
  // a loyal General left quietly: the plot has no head for three days
  function relieved() {
    const h = seat();
    if (!h) return false;
    const s = S();
    s.purgedDay = day();
    s.plotter = null;
    armyPush(-40);
    evaluate(h.rec, day());
    return true;
  }
  // a dismissed man took officers with him
  function plot(who) {
    const h = seat();
    if (!h) return false;
    const s = S();
    if (who && who.name) s.plotter = { name: who.name, sid: who.sid || null };
    s.purgedDay = -99;
    armyPush(who && who.push != null ? who.push : 25);
    evaluate(h.rec, day());
    return true;
  }
  function staffLean() {
    const PS = CBZ.presidentStaff;
    if (!PS || !PS.armyLean) return { add: 0, cap: null };
    try { const l = PS.armyLean() || {}; return { add: +l.add || 0, cap: l.cap != null ? +l.cap : null }; } catch (e) { return { add: 0, cap: null }; }
  }
  // the nearest real shelter: warroom's own bunker verb when it has one,
  // else a waypoint to the nearest registered bunker
  function bunker() {
    if (!seat()) return { ok: false, why: "You do not hold the country." };
    if (inShelter()) return { ok: true, line: "You're in the safest room in the country." };
    const W = CBZ.warroom;
    if (W && typeof W.bunker === "function") {
      try { const r = W.bunker(); if (r && r.ok !== false) return { ok: true, line: (r && r.line) || "The bunker is ready. Go now." }; } catch (e) {}
    }
    const L = CBZ.strategicBunkers || [], Pl = CBZ.player;
    let best = null, bd = Infinity;
    for (let i = 0; i < L.length; i++) {
      const b = L[i];
      if (!b || b.breached) continue;
      const I = b.interior || b.shell; if (!I) continue;
      const x = (I.minX + I.maxX) / 2, z = (I.minZ + I.maxZ) / 2;
      const dd = Pl && Pl.pos ? Math.hypot(x - Pl.pos.x, z - Pl.pos.z) : 0;
      if (dd < bd) { bd = dd; best = { x: b.door ? b.door.x : x, z: b.door ? b.door.z : z }; }
    }
    if (!best) return { ok: false, why: "There is no bunker we can reach." };
    if (CBZ.fullMap && CBZ.fullMap.setWaypoint) { try { CBZ.fullMap.setWaypoint(best.x, best.z, "Bunker"); } catch (e) {} }
    return { ok: true, line: "The bunker is on your map. Go now.", at: best };
  }

  // ---------------------------------------------------------------- the bus
  // a nudge from outside (the old three-number bump): unrest is the groups'
  // anger, the movement is fear's absence, the army is its loyalty
  function bump(du, dm, da) {
    const Po = Pol();
    if (!Po || !seat()) return;
    Po.event("dissent", { all: -(du || 0) / 2.5, fear: -(dm || 0), inst: { army: -(da || 0) } });
  }
  // every act and order is priced in city/politics.js; this file only
  // re-reads the ladder when something happened
  function onBus(evt, d) {
    if (!seat()) return;
    if (evt === "order" && d && d.ok) {
      if (d.key === "address") S().conceded++;
      else if (/^(martial|curfew|surge|crackdown)$/.test(d.key)) S().crackdowns++;
    }
    if (!/^(order|act|war-ended|war-declared|airstrike-ordered|nuke-launched)$/.test(evt)) return;
    const h = seat();
    if (h) evaluate(h.rec, day());
  }
  let hooked = false;
  function hook() {
    if (hooked) return;
    const p = P();
    if (!p || typeof p.on !== "function") return;
    hooked = true;
    try { p.on("*", function (payload, evt) { try { onBus(String(evt || ""), payload); } catch (e) {} }); } catch (e) {}
  }
  if (CBZ.onNewDay) CBZ.onNewDay(function (d) { hook(); try { daily(d); } catch (e) {} });
  let acc = 0;
  function tick(dt) {
    acc += dt || 0;
    if (acc < 2) return;
    acc = 0;
    hook();
  }
  if (CBZ.onAlways) CBZ.onAlways(46.6, tick);

  CBZ.dissent = {
    status: function () {
      const s = S(), n = nums();
      return {
        seat: s.seat, stage: s.stage, stageName: STAGES[s.stage] || "calm",
        unrest: Math.round(n.unrest), movement: Math.round(n.movement), army: Math.round(n.army), leaderGroup: s.leader ? s.leader.group : null,
        coupDay: s.coupDay, leader: s.leader ? s.leader.name : null, purgedDay: s.purgedDay,
        lastCoup: s.lastCoup, log: s.log.slice(),
      };
    },
    stage: function () { return seat() ? S().stage : 0; },
    owns: function (id) { const h = seat(); return !!(h && id && h.id === id); },
    // president_public.js's protest anger: the movement fills the street
    pressure: function () { if (!seat()) return 0; const n = nums(); return clamp(n.unrest / 100 * 0.3 + n.movement / 100 * 0.3, 0, 0.6); },
    nums: nums,
    concede: concede, crackdown: crackdown, purge: purge, bunker: bunker, inShelter: inShelter,
    relieved: relieved, plot: plot,
    bump: function (du, dm, da) { bump(du, dm, da); const h = seat(); if (h) evaluate(h.rec, day()); },
    reset: reset,
    _tick: tick, _daily: daily, _state: S, _fire: function () { const h = seat(); return h ? fire(h, day()) : null; }, _hook: hook,
  };
})();
